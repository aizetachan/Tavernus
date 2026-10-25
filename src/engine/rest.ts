/**
 * Descansos (SRD; SPEC §9.1; issue #23). Deterministas, sin IA:
 *
 *   - Corto: 1 h de juego. Gasta dados de golpe (d de su clase + CON cada
 *     uno) hasta curarse o quedarse sin ellos, o los que pida, y recupera los
 *     recursos de clase de descanso corto.
 *   - Largo: 8 h de juego. PG completos, recupera la mitad de sus dados de
 *     golpe (mínimo uno) y todos los recursos. Uno cada 24 h de juego, y hace
 *     falta tener al menos 1 PG.
 *
 * El tiempo corre en el reloj propio del PJ (travel.ts): descansar es como un
 * viaje rápido, sale al acabar y su reloj queda adelantado. Si comparte sitio
 * con otro PJ despierto que va por detrás, espera a que el reloj le alcance.
 *
 * No se descansa con una amenaza delante (fastpath.ts, `tension`). En un sitio
 * inseguro el descanso puede interrumpirse: por la agenda (algo ruidoso
 * empieza en el lugar mientras duerme) o por la tabla de encuentros nocturnos
 * de la zona. En un cuarto alquilado con su llave, en un sitio marcado
 * `safe_rest` o en casa de un aliado, es seguro.
 */

import type { GameClock } from '../clock/clock.js';
import { GAME_DAY, GAME_HOUR, GAME_MINUTE } from '../clock/clock.js';
import { abilityModifier, rollDie, type Rng } from './dice.js';
import { encounterChance } from './fastpath.js';
import type { Character, Id, Npc } from './model.js';
import { attitudeOf } from './combat.js';
import { allScheduled, nextStart, routineOf } from './schedule.js';
import { encounterTable, pickEntry, type EncounterEntry } from './travel.js';
import type { World } from './world.js';

export const SHORT_REST_S = GAME_HOUR;
export const LONG_REST_S = 8 * GAME_HOUR;
export const LONG_REST_EVERY_S = GAME_DAY;
/** Ruido de un evento de la agenda que despierta a quien duerme en el lugar. */
const NOISY = 0.3;

// ---------------------------------------------------------------------------
// Recursos de clase (SRD, niveles bajos)
// ---------------------------------------------------------------------------

export interface ClassResource { key: string; label: string; max: number; recharge: 'short' | 'long' }

const FULL_CASTER_SLOTS = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2]];
const HALF_CASTER_SLOTS = [[], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2]];

function slots(level: number, table: number[][], recharge: 'short' | 'long' = 'long'): ClassResource[] {
  const row = table[Math.min(level, table.length) - 1] ?? [];
  return row.map((n, i) => ({ key: `slot_${i + 1}`, label: `espacios de conjuro de nivel ${i + 1}`, max: n, recharge }));
}

/** Recursos que gasta y recupera al descansar, según clase y nivel. */
export function classResources(c: Character): ClassResource[] {
  const L = c.level;
  const cha = Math.max(1, abilityModifier(c.abilities.cha));
  switch (c.class_id) {
    case 'fighter': return [{ key: 'second_wind', label: 'Tomar aliento', max: 1, recharge: 'short' }, ...(L >= 2 ? [{ key: 'action_surge', label: 'Oleada de acción', max: 1, recharge: 'short' as const }] : [])];
    case 'barbarian': return [{ key: 'rage', label: 'Furia', max: L >= 6 ? 4 : L >= 3 ? 3 : 2, recharge: 'long' }];
    case 'bard': return [{ key: 'bardic_inspiration', label: 'Inspiración bárdica', max: cha, recharge: L >= 5 ? 'short' : 'long' }, ...slots(L, FULL_CASTER_SLOTS)];
    case 'cleric': return [...(L >= 2 ? [{ key: 'channel_divinity', label: 'Canalizar divinidad', max: 1, recharge: 'short' as const }] : []), ...slots(L, FULL_CASTER_SLOTS)];
    case 'druid': return [...(L >= 2 ? [{ key: 'wild_shape', label: 'Forma salvaje', max: 2, recharge: 'short' as const }] : []), ...slots(L, FULL_CASTER_SLOTS)];
    case 'monk': return L >= 2 ? [{ key: 'ki', label: 'Puntos de ki', max: L, recharge: 'short' }] : [];
    case 'paladin': return [{ key: 'lay_on_hands', label: 'Imposición de manos (PG)', max: 5 * L, recharge: 'long' }, { key: 'divine_sense', label: 'Sentido divino', max: 1 + cha, recharge: 'long' }, ...slots(L, HALF_CASTER_SLOTS)];
    case 'ranger': return slots(L, HALF_CASTER_SLOTS);
    case 'sorcerer': return [...(L >= 2 ? [{ key: 'sorcery_points', label: 'Puntos de hechicería', max: L, recharge: 'long' as const }] : []), ...slots(L, FULL_CASTER_SLOTS)];
    case 'warlock': return [{ key: 'slot_pact', label: 'espacios de pacto', max: L >= 2 ? 2 : 1, recharge: 'short' }];
    case 'wizard': return [{ key: 'arcane_recovery', label: 'Recuperación arcana', max: 1, recharge: 'long' }, ...slots(L, FULL_CASTER_SLOTS)];
    default: return [];
  }
}

export function restState(c: Character): NonNullable<Character['rest']> {
  return (c.rest ??= { hit_dice_used: 0, used: {}, last_long_rest_game_s: null });
}

export function hitDiceLeft(c: Character): number {
  return Math.max(0, c.level - restState(c).hit_dice_used);
}

/** Recursos con lo que le queda: «Tomar aliento 1/1 (corto)». */
export function resourceLines(c: Character): string[] {
  const used = restState(c).used;
  return classResources(c).map((r) => `${r.label} ${Math.max(0, r.max - (used[r.key] ?? 0))}/${r.max} (${r.recharge === 'short' ? 'corto' : 'largo'})`);
}

/** Gasta usos de un recurso de clase (lo pide el máster). */
export function spendResource(world: World, c: Character, key: string, amount = 1): { ok: true; left: number; label: string } | { ok: false; error: string } {
  const r = classResources(c).find((x) => x.key === key);
  if (!r) return { ok: false, error: `${c.name} no tiene ese recurso. Tiene: ${classResources(c).map((x) => x.key).join(', ') || 'ninguno'}` };
  const st = restState(c);
  const n = Math.max(1, Math.floor(amount));
  const left = r.max - (st.used[key] ?? 0);
  if (left < n) return { ok: false, error: `no le quedan usos de ${r.label} (${left}/${r.max}); se recuperan con un descanso ${r.recharge === 'short' ? 'corto' : 'largo'}` };
  st.used[key] = (st.used[key] ?? 0) + n;
  world.touch('characters', c.id);
  return { ok: true, left: left - n, label: r.label };
}

// ---------------------------------------------------------------------------
// Dónde se descansa
// ---------------------------------------------------------------------------

/** Por qué es seguro descansar aquí, o null si no lo es. */
export function safeRest(world: World, c: Character): string | null {
  const spot = world.characterSpot(c);
  if (!spot) return null;
  const loc = world.location(spot.location_id);
  const key = spot.state['key_item_id'];
  if (typeof key === 'string' && world.itemsCarriedBy(c.id).some((i) => i.item_id === key)) return 'un cuarto cerrado con tu llave';
  if (spot.tags.includes('safe_rest') || loc.state['safe_rest'] === true) return 'un sitio resguardado';
  if (loc.indoor) {
    const host = [...world.npcs.values()].find((n) => n.status === 'alive' && world.spot(n.location.id).location_id === loc.id && allyHome(world, n, c, loc.id));
    if (host) return `la casa de ${c.knows.includes(host.id) ? host.name : 'alguien que te aprecia'}`;
  }
  return null;
}

function allyHome(world: World, n: Npc, c: Character, locId: Id): boolean {
  const a = attitudeOf(n, c.id);
  if (a === 'allied') return true;
  const night = routineOf(n)?.night;
  return a === 'friendly' && Boolean(night && world.spots.get(night)?.location_id === locId);
}

// ---------------------------------------------------------------------------
// Descansar
// ---------------------------------------------------------------------------

export type RestKind = 'short' | 'long';

export interface RestInterruption {
  at_game_s: number;
  /** Agenda (algo ruidoso empieza aquí) o un encuentro de la tabla. */
  kind: 'schedule' | 'encounter';
  what: string;
  teaser: string;
  entry?: EncounterEntry;
  chance: number;
  roll: number;
}

export interface RestPlan {
  kind: RestKind;
  start_game_s: number;
  end_game_s: number;
  safe: string | null;
  interruption: RestInterruption | null;
}

/** Puede descansar ahora? Devuelve el motivo si no. */
export function cannotRest(c: Character, kind: RestKind, nowG: number): string | null {
  if (c.status === 'dead') return 'Estás muerto.';
  if (c.status === 'unconscious') return 'Estás inconsciente.';
  if (kind === 'long') {
    if (c.hp_current < 1) return 'Con 0 PG no puedes descansar.';
    const last = restState(c).last_long_rest_game_s;
    if (last !== null && nowG < last + LONG_REST_EVERY_S) return `Ya hiciste un descanso largo hace menos de 24 h de juego: podrás de nuevo dentro de ${Math.ceil((last + LONG_REST_EVERY_S - nowG) / GAME_HOUR)} h. Un descanso corto sí puedes.`;
  }
  return null;
}

/**
 * Planea el descanso: cuándo acaba y si algo lo interrumpe. En sitio seguro,
 * nada. Si no: lo primero que empiece ruidoso en la agenda del lugar o, con la
 * probabilidad de encuentro del lugar (doble de noche y en descanso largo), un
 * encuentro de la tabla de su zona en un momento al azar.
 */
export function planRest(world: World, clock: GameClock, c: Character, kind: RestKind, nowG: number, rng: Rng): RestPlan {
  const dur = kind === 'long' ? LONG_REST_S : SHORT_REST_S;
  const plan: RestPlan = { kind, start_game_s: nowG, end_game_s: nowG + dur, safe: safeRest(world, c), interruption: null };
  if (plan.safe) return plan;
  const spot = world.characterSpot(c)!;
  const loc = world.location(spot.location_id);
  // Agenda: lo ruidoso que empiece aquí mientras descansa.
  let first: RestInterruption | null = null;
  for (const e of allScheduled(world)) {
    if (e.location_id !== loc.id || (e.effects.noise ?? 0) < NOISY) continue;
    const s = nextStart(world, e, nowG);
    if (s === null || s >= plan.end_game_s || (first && s >= first.at_game_s)) continue;
    first = { at_game_s: s, kind: 'schedule', what: e.description, teaser: e.start_text ?? `Te despierta el ruido: empieza ${e.title}.`, chance: 1, roll: 0 };
  }
  // Encuentro: la tabla de la zona, de noche si lo es.
  const base = encounterChance(world, loc);
  const night = clock.outdoorLight(nowG) !== 'day';
  const chance = Math.min(0.6, kind === 'long' ? base * 2 : night ? base * 1.5 : base);
  const roll = rng();
  if (roll < chance) {
    const at = nowG + Math.max(10 * GAME_MINUTE, Math.floor(rng() * dur));
    const kindZone = world.zones.get(loc.zone_id)?.kind ?? '';
    const entry = pickEntry(encounterTable(world, kindZone), clock.outdoorLight(at) !== 'day', rng);
    if (entry && (!first || at < first.at_game_s)) first = { at_game_s: at, kind: 'encounter', what: entry.what, teaser: entry.teaser ?? 'Algo te despierta.', entry, chance, roll };
  }
  plan.interruption = first;
  return plan;
}

export interface RestResult {
  kind: RestKind;
  /** Hasta dónde llegó (el final o la interrupción). */
  end_game_s: number;
  completed: boolean;
  healed: number;
  dice_spent: number;
  dice_regained: number;
  recovered: string[];
}

/**
 * Aplica el descanso planeado. Interrumpido: el tiempo pasa hasta la
 * interrupción y no da beneficios (un descanso largo cortado tras más de 1 h
 * cuenta como uno corto sin gastar dados).
 */
export function applyRest(world: World, c: Character, plan: RestPlan, rng: Rng, opts: { dice?: number } = {}): RestResult {
  const st = restState(c);
  const end = plan.interruption?.at_game_s ?? plan.end_game_s;
  const out: RestResult = { kind: plan.kind, end_game_s: end, completed: !plan.interruption, healed: 0, dice_spent: 0, dice_regained: 0, recovered: [] };
  const resources = classResources(c);
  const recover = (which: 'short' | 'long') => {
    for (const r of resources) {
      if ((which === 'short' && r.recharge !== 'short') || !(st.used[r.key] ?? 0)) continue;
      delete st.used[r.key];
      out.recovered.push(r.label);
    }
  };
  if (plan.kind === 'long' && out.completed) {
    out.healed = c.hp_max - c.hp_current;
    c.hp_current = c.hp_max;
    out.dice_regained = Math.min(st.hit_dice_used, Math.max(1, Math.floor(c.level / 2)));
    st.hit_dice_used -= out.dice_regained;
    recover('long');
    st.last_long_rest_game_s = plan.start_game_s;
  } else if (plan.kind === 'short' && out.completed) {
    const con = abilityModifier(c.abilities.con);
    const want = opts.dice ?? Infinity;
    while (out.dice_spent < want && hitDiceLeft(c) > 0 && c.hp_current < c.hp_max) {
      const hp = Math.max(0, rollDie(c.hit_die, rng) + con);
      st.hit_dice_used += 1; out.dice_spent += 1;
      const before = c.hp_current;
      c.hp_current = Math.min(c.hp_max, c.hp_current + hp);
      out.healed += c.hp_current - before;
    }
    recover('short');
  } else if (plan.kind === 'long' && end - plan.start_game_s >= SHORT_REST_S) {
    recover('short');
  }
  world.touch('characters', c.id);
  return out;
}

/** «descanso corto», «descansar», «dormir», «descanso largo»… null si no es un descanso. Con «gastando N dados», cuántos. */
export function parseRest(text: string): { kind: RestKind; dice: number | null } | null {
  const t = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dice = /(\d+)\s*dados?/.exec(t);
  const n = dice ? Number(dice[1]) : null;
  if (/^(dormir|duermo|me duermo|me echo a dormir|echarme a dormir|descanso largo|descansar (?:toda la noche|ocho horas|8 h)|sleep|long rest)\b/.test(t)) return { kind: 'long', dice: null };
  if (/^(descanso corto|descansar|descanso|descanso un rato|me siento a descansar|short rest|rest)\b/.test(t)) return { kind: 'short', dice: n };
  return null;
}
