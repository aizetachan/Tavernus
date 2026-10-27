/**
 * Caer, salvarse o morir, y volver (SPEC §4.7, §10; issue #23). Reglas SRD:
 *
 *   - A 0 PG el PJ queda inconsciente y tira salvaciones contra muerte (d20,
 *     10 o más es éxito). Tres éxitos le estabilizan; tres fallos le matan. Un
 *     1 natural cuenta como dos fallos; un 20 natural le devuelve 1 PG. Daño a
 *     0 PG es un fallo (dos si es crítico); si el daño que sobra iguala sus PG
 *     máximos, muere en el acto.
 *   - Las tira el servidor, sin IA: una por ronda en escena tensa con rondas
 *     y, fuera de rondas, una por minuto de juego si hay amenaza (cada diez si
 *     no la hay).
 *   - Estable (tres éxitos, Medicina CD 10 o cualquier curación): deja de
 *     tirar y a las 1d4 horas de juego recupera 1 PG.
 *   - Un ausente no muere ausente (docs/MULTIJUGADOR.md, «Desconexiones»): si
 *     cae, o está cayendo cuando se va, queda estable; el daño no le suma fallos.
 *
 * La muerte nunca es permanente: deja el cuerpo en el sitio (un contenedor
 * fijo, «cuerpo de X», con lo que llevaba y sus monedas) y, pasada la espera
 * de su modo (`death_mode`), el PJ vuelve en el punto de reaparición de la
 * campaña con la mitad de sus PG. Casual: lo suyo le espera en el cuerpo y
 * solo él puede cogerlo. Hardcore: espera menos, vuelve con una característica
 * rebajada y el cuerpo queda para quien lo saquee.
 *
 * Aquí solo hay estado del mundo; los avisos, narraciones y el Diario los
 * pone el motor leyendo este estado (Engine.announceDeathStates).
 */

import { GameClock, GAME_HOUR, GAME_MINUTE } from '../clock/clock.js';
import { abilityModifier, rollDie, type Rng } from './dice.js';
import { directlyCarried } from './inventory.js';
import type { CarrySlot, Character, DeathRules, Id, ItemDef, ItemInstance, Npc } from './model.js';
import { ABILITY_ES, type Ability } from './rules.js';
import { adjustTrust } from './trust.js';
import type { World } from './world.js';

export const DEFAULT_DEATH_RULES: DeathRules = {
  casual_respawn_wait_s: 2 * 3600,
  hardcore_respawn_wait_s: 30 * 60,
  hardcore_ability_penalty: 1,
  respawn_spot_id: null,
  respawn_story: '',
};

/** Cada cuánto tira el servidor fuera de rondas (s de juego): con amenaza y sin ella. */
export const SAVE_EVERY_THREAT_S = GAME_MINUTE;
export const SAVE_EVERY_CALM_S = 10 * GAME_MINUTE;
export const STABLE = 'estable';
const BODY_DEF_PREFIX = 'it_cuerpo_';

export function deathRules(world: World): DeathRules {
  return { ...DEFAULT_DEATH_RULES, ...(world.campaign.death_rules ?? {}) };
}

/** Dónde vuelve un PJ: el punto de la campaña o, si no tiene, el primer punto de inicio. */
export function respawnSpotId(world: World): Id {
  const id = deathRules(world).respawn_spot_id;
  return id && world.spots.has(id) ? id : world.campaign.starting_points[0]!.spot_id;
}

export function respawnWaitS(world: World, mode: Character['death_mode']): number {
  const r = deathRules(world);
  return mode === 'hardcore' ? r.hardcore_respawn_wait_s : r.casual_respawn_wait_s;
}

/** Cayendo: a 0 PG, inconsciente y tirando salvaciones. */
export function isDying(c: Character): boolean {
  return c.status === 'unconscious' && c.hp_current === 0 && Boolean(c.dying) && c.dying!.stable_until_game_s === null;
}

export function isStable(c: Character): boolean {
  return c.status === 'unconscious' && c.hp_current === 0 && (c.dying?.stable_until_game_s != null || c.conditions.some((x) => x.name === STABLE));
}

export function worldNow(world: World): number {
  return GameClock.fromCampaign(world.campaign).gameNow();
}

// ---------------------------------------------------------------------------
// Daño y curación
// ---------------------------------------------------------------------------

export interface DamageOutcome {
  /** Ha caído a 0 PG con este golpe. */
  down: boolean;
  /** Ha muerto (daño masivo o tercer fallo). El cuerpo ya está en el sitio. */
  died: boolean;
  /** Fallos de salvación sumados por recibir daño a 0 PG. */
  failures: number;
  /** Bajo el velo: no recibe daño. */
  blocked: boolean;
}

/**
 * Aplica daño a un PJ con las reglas de 0 PG. `crit`: el golpe fue crítico
 * (dos fallos si ya estaba a 0 PG). Devuelve qué ha pasado; el motor lo cuenta.
 */
export function damageCharacter(world: World, c: Character, amount: number, opts: { crit?: boolean; cause: string; nowGameS?: number }): DamageOutcome {
  const out: DamageOutcome = { down: false, died: false, failures: 0, blocked: false };
  if (c.status === 'dead') return out;
  if (c.veiled) return { ...out, blocked: true };
  const nowG = opts.nowGameS ?? worldNow(world);
  let left = Math.max(0, Math.floor(amount));
  if (left === 0) return out;
  const fromTemp = Math.min(c.hp_temp, left);
  c.hp_temp -= fromTemp; left -= fromTemp;
  if (left === 0) { world.touch('characters', c.id); return out; }
  if (c.hp_current > 0) {
    const over = left - c.hp_current;
    c.hp_current = Math.max(0, c.hp_current - left);
    if (c.hp_current > 0) { world.touch('characters', c.id); return out; }
    // Daño masivo: lo que sobra iguala sus PG máximos. Un ausente no muere ausente.
    if (over >= c.hp_max && !c.away) { die(world, c, nowG, opts.cause); return { ...out, down: true, died: true }; }
    fall(world, c, nowG, opts.cause);
    return { ...out, down: true };
  }
  // Ya estaba a 0 PG.
  if (c.away) { world.touch('characters', c.id); return out; }
  if (left >= c.hp_max) { die(world, c, nowG, opts.cause); return { ...out, died: true }; }
  const d = c.dying ?? newDying(nowG, opts.cause);
  if (d.stable_until_game_s !== null) { d.stable_until_game_s = null; c.conditions = c.conditions.filter((x) => x.name !== STABLE); }
  out.failures = opts.crit ? 2 : 1;
  d.fail += out.failures;
  c.dying = d;
  if (d.fail >= 3) { die(world, c, nowG, opts.cause); return { ...out, died: true }; }
  world.touch('characters', c.id);
  return out;
}

function newDying(nowG: number, cause: string): NonNullable<Character['dying']> {
  return { success: 0, fail: 0, since_game_s: nowG, next_game_s: nowG + SAVE_EVERY_THREAT_S, stable_until_game_s: null, saved_by: null, cause };
}

/** Cae a 0 PG: inconsciente y tirando salvaciones (o estable si su jugador no está). */
function fall(world: World, c: Character, nowG: number, cause: string): void {
  c.hp_current = 0;
  c.status = 'unconscious';
  c.transit = null;
  c.decisive = null;
  c.dying = newDying(nowG, cause);
  if (c.away) stabilize(world, c, nowG, null, 'cayó estando ausente: no muere ausente');
  world.touch('characters', c.id);
}

/**
 * Devuelve PG a un PJ. Si estaba a 0 PG, despierta (SRD: cualquier curación)
 * y deja de tirar salvaciones. `by`: quién le cura (para el Diario).
 */
export function healCharacter(world: World, c: Character, amount: number, by: string | null = null, via: 'heal' | 'save' | 'rest' = 'heal'): { revived: boolean } {
  if (c.status === 'dead') return { revived: false };
  const n = Math.max(0, Math.floor(amount));
  if (n === 0) return { revived: false };
  const wasDown = c.hp_current === 0;
  c.hp_current = Math.min(c.hp_max, c.hp_current + n);
  let revived = false;
  if (wasDown && c.hp_current > 0) {
    revived = true;
    if (c.status === 'unconscious') c.status = 'active';
    c.conditions = c.conditions.filter((x) => x.name !== STABLE);
    // Se guarda hasta que el motor cuente quién le salvó; luego se borra.
    if (c.dying) c.dying = { ...c.dying, saved_by: by ?? c.dying.saved_by, revived: via };
  }
  world.touch('characters', c.id);
  return { revived };
}

/**
 * Estabiliza a un PJ a 0 PG (tres éxitos, Medicina CD 10, ausente): deja de
 * tirar y recupera 1 PG a las 1d4 horas de juego.
 */
export function stabilize(world: World, c: Character, nowG: number, by: string | null, source = 'estabilizado', rng?: Rng): boolean {
  if (c.status !== 'unconscious' || c.hp_current > 0) return false;
  const d = c.dying ?? newDying(nowG, 'a 0 PG');
  if (d.stable_until_game_s !== null) return false;
  d.stable_until_game_s = nowG + rollDie(4, rng) * GAME_HOUR;
  d.saved_by = by ?? d.saved_by;
  c.dying = d;
  if (!c.conditions.some((x) => x.name === STABLE)) c.conditions.push({ name: STABLE, source, expires_game_s: null });
  world.touch('characters', c.id);
  return true;
}

/** Un ausente que cae o está cayendo queda estable: no muere ausente. */
export function stabilizeIfAway(world: World, c: Character, nowG: number = worldNow(world)): void {
  if (!c.away || c.hp_current > 0 || c.status !== 'unconscious') return;
  stabilize(world, c, nowG, null, 'cayó estando ausente: no muere ausente');
}

// ---------------------------------------------------------------------------
// Salvaciones contra muerte
// ---------------------------------------------------------------------------

export interface DeathSave {
  natural: number;
  outcome: 'success' | 'fail' | 'revive';
  success: number;
  fail: number;
  stable: boolean;
  died: boolean;
}

/** Una salvación contra muerte (SRD). Aplica el resultado y lo devuelve. */
export function rollDeathSave(world: World, c: Character, nowG: number, rng?: Rng): DeathSave | null {
  if (!isDying(c) || c.away || c.veiled) return null;
  const d = c.dying!;
  const natural = rollDie(20, rng);
  const out: DeathSave = { natural, outcome: natural >= 10 ? 'success' : 'fail', success: d.success, fail: d.fail, stable: false, died: false };
  if (natural === 20) {
    out.outcome = 'revive';
    healCharacter(world, c, 1, null, 'save');
    return out;
  }
  if (natural >= 10) d.success += 1;
  else d.fail += natural === 1 ? 2 : 1;
  out.success = d.success; out.fail = d.fail;
  if (d.fail >= 3) { die(world, c, nowG, d.cause); out.died = true; return out; }
  if (d.success >= 3) { stabilize(world, c, nowG, null, 'tres salvaciones contra muerte', rng); out.stable = true; return out; }
  world.touch('characters', c.id);
  return out;
}

/** El estabilizado ha cumplido sus 1d4 horas: recupera 1 PG y despierta. */
export function wakeIfRested(world: World, c: Character, nowG: number): boolean {
  if (!isStable(c) || c.dying?.stable_until_game_s == null || c.dying.stable_until_game_s > nowG) return false;
  healCharacter(world, c, 1, c.dying.saved_by, 'rest');
  return true;
}

/** Medicina CD 10 sobre un PJ que está cayendo (lo tira quien le atiende). */
export function medicineDc(): number { return 10; }

// ---------------------------------------------------------------------------
// Muerte, cuerpo y vuelta
// ---------------------------------------------------------------------------

export interface BodyState {
  owner_id: Id;
  mode: 'casual' | 'hardcore';
  coins: number;
  /** Dónde lo llevaba (para devolverlo a su sitio si lo recoge él). */
  slots: Record<Id, CarrySlot>;
  died_game_s: number;
}

function bodyDef(world: World, c: Character, left: boolean): ItemDef {
  const id = BODY_DEF_PREFIX + c.id;
  const name = left ? `las cosas de ${c.name}` : `cuerpo de ${c.name}`;
  const low = c.name.toLowerCase();
  const def: ItemDef = {
    id, name, type: 'container', size: 'bulky', weight_lb: 150, value: 0, unique: true, origin: 'custom',
    aliases: left ? ['cosas', 'pertenencias', 'fardo', `cosas de ${low}`, low] : ['cuerpo', 'cadáver', 'cadaver', `cuerpo de ${low}`, low],
    container: { slots: 99, max_weight_lb: 9999, max_size: 'bulky', fixed: true },
  };
  world.itemDefs.set(id, def);
  world.touch('item_defs', id);
  return def;
}

export function bodyStateOf(i: ItemInstance): BodyState | null {
  const s = i.state['body'] as BodyState | undefined;
  return s && typeof s.owner_id === 'string' ? s : null;
}

/** El cuerpo (o las cosas que dejó) que contiene este ejemplar, subiendo por contenedores; null si no está en uno. */
export function bodyHolding(world: World, instanceId: Id): ItemInstance | null {
  let i = world.itemInstances.get(instanceId);
  for (let g = 0; i && g < 32; g++) {
    if (bodyStateOf(i)) return i;
    if (i.location.type !== 'container') return null;
    i = world.itemInstances.get(i.location.id);
  }
  return null;
}

/**
 * ¿Puede `actor` coger cosas de ese cuerpo? Siempre su dueño; los demás, solo
 * si murió en hardcore (casual: lo suyo le espera a él).
 */
export function canLoot(world: World, actorId: Id, body: ItemInstance): { ok: true } | { ok: false; reason: string } {
  const b = bodyStateOf(body);
  if (!b || b.owner_id === actorId || b.mode === 'hardcore') return { ok: true };
  const owner = world.characters.get(b.owner_id);
  return { ok: false, reason: `son las cosas de ${owner?.name ?? 'otro jugador'}: murió en modo casual y le esperan a él` };
}

/**
 * Muere: el cuerpo queda en el sitio con todo lo que llevaba y sus monedas;
 * el PJ pasa a `dead` y espera su vuelta. `respawn_real_ms` lo fija el motor
 * al anunciarlo (aquí no hay reloj real).
 */
export function die(world: World, c: Character, nowG: number, cause: string): void {
  const spot = world.characterSpot(c) ?? world.spot(respawnSpotId(world));
  const def = bodyDef(world, c, false);
  const body: ItemInstance = {
    id: `ii_body_${c.id}_${Math.floor(nowG)}`, item_id: def.id, quantity: 1, location: { type: 'spot', id: spot.id },
    state: { body: { owner_id: c.id, mode: c.death_mode, coins: c.coins, slots: {}, died_game_s: nowG } satisfies BodyState },
  };
  world.itemInstances.set(body.id, body);
  const left: string[] = [];
  const slots: Record<Id, CarrySlot> = {};
  for (const i of directlyCarried(world, c.id)) {
    if (i.location.type === 'character') slots[i.id] = i.location.slot;
    i.location = { type: 'container', id: body.id };
    world.touch('item_instances', i.id);
    const d = world.itemDef(i.item_id);
    left.push(i.quantity > 1 ? `${d.name} ×${i.quantity}` : d.name);
  }
  (body.state['body'] as BodyState).slots = slots;
  world.touch('item_instances', body.id);
  c.death = { died_game_s: nowG, died_real_ms: 0, respawn_real_ms: 0, mode: c.death_mode, spot_id: spot.id, body_instance_id: body.id, cause, left, coins_left: c.coins };
  c.coins = 0;
  c.status = 'dead';
  c.hp_current = 0;
  c.hp_temp = 0;
  c.transit = null;
  c.decisive = null;
  c.following = null;
  c.conditions = [];
  c.dying = null;
  world.touch('characters', c.id);
}

/** Característica que pierde un hardcore al volver: la más alta (la que más se nota). */
export function penaltyAbility(c: Character): Ability {
  const order: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  return order.reduce((best, a) => (c.abilities[a] > c.abilities[best] ? a : best), order[0]!);
}

export interface Respawn {
  spot_id: Id;
  hp: number;
  mode: 'casual' | 'hardcore';
  /** Hardcore: la característica rebajada y cuánto. */
  penalty: { ability: Ability; label: string; amount: number } | null;
  /** Lo que se quedó en el cuerpo (casual: le espera; hardcore: quizá ya no esté). */
  left: string[];
  coins_left: number;
  body_spot_id: Id;
}

/** Vuelve: en el punto de reaparición, con la mitad de sus PG; el cuerpo pasa a ser «las cosas de X». */
export function respawn(world: World, c: Character): Respawn | null {
  if (c.status !== 'dead' || !c.death) return null;
  const d = c.death;
  const spotId = respawnSpotId(world);
  c.location = { type: 'spot', id: spotId };
  c.status = 'active';
  c.hp_current = Math.max(1, Math.ceil(c.hp_max / 2));
  c.dying = null;
  c.conditions = [];
  let penalty: Respawn['penalty'] = null;
  if (d.mode === 'hardcore') {
    const amount = deathRules(world).hardcore_ability_penalty;
    if (amount > 0) {
      const a = penaltyAbility(c);
      c.abilities[a] = Math.max(1, c.abilities[a] - amount);
      c.ability_penalties = { ...(c.ability_penalties ?? {}), [a]: (c.ability_penalties?.[a] ?? 0) + amount };
      penalty = { ability: a, label: ABILITY_ES[a], amount };
      if (a === 'con') c.hp_max = Math.max(1, c.hp_max - (abilityModifier(c.abilities.con + amount) - abilityModifier(c.abilities.con)) * c.level);
      c.hp_current = Math.min(c.hp_current, c.hp_max);
    }
  }
  // El cuerpo se lo llevaron (casual: lo están reanimando); lo que llevaba queda donde cayó.
  const body = d.body_instance_id ? world.itemInstances.get(d.body_instance_id) : undefined;
  if (body) {
    const empty = world.itemsIn({ type: 'container', id: body.id }).length === 0 && (bodyStateOf(body)?.coins ?? 0) === 0;
    if (empty) world.remove('item_instances', body.id);
    else { bodyDef(world, c, true); world.touch('item_instances', body.id); }
  }
  const out: Respawn = { spot_id: spotId, hp: c.hp_current, mode: d.mode, penalty, left: d.left, coins_left: d.coins_left, body_spot_id: d.spot_id };
  c.death = null;
  world.touch('characters', c.id);
  return out;
}

/**
 * Recoge lo que hay en un cuerpo: el dueño lo devuelve a donde lo llevaba (si
 * el sitio sigue libre); quien saquea, a sus manos, bolsillos o contenedores.
 * Lo que no cabe se queda. Las monedas, siempre.
 */
export function lootBody(world: World, actor: Character, body: ItemInstance, put: (instanceId: Id) => boolean): { taken: string[]; coins: number; left: number } {
  const b = bodyStateOf(body)!;
  const taken: string[] = [];
  for (const i of world.itemsIn({ type: 'container', id: body.id })) {
    const name = world.itemDef(i.item_id).name;
    const slot = b.owner_id === actor.id ? b.slots[i.id] : undefined;
    const back = slot && world.itemsIn({ type: 'character', id: actor.id, slot }).length === 0;
    if (back) { i.location = { type: 'character', id: actor.id, slot: slot! }; world.touch('item_instances', i.id); taken.push(name); continue; }
    if (put(i.id)) taken.push(name);
  }
  const coins = b.coins;
  actor.coins += coins;
  b.coins = 0;
  world.touch('characters', actor.id);
  const left = world.itemsIn({ type: 'container', id: body.id }).length;
  if (left === 0 && world.characters.get(b.owner_id)?.status !== 'dead') world.remove('item_instances', body.id);
  else world.touch('item_instances', body.id);
  return { taken, coins, left };
}

/** Cuerpos (o cosas dejadas) en un punto. */
export function bodiesAt(world: World, spotId: Id): ItemInstance[] {
  return world.itemsIn({ type: 'spot', id: spotId }).filter((i) => bodyStateOf(i));
}

// ---------------------------------------------------------------------------
// Muerte de un NPC
// ---------------------------------------------------------------------------

/**
 * Un NPC muere (a 0 PG en combate o por daño): se queda donde cae, como cuerpo
 * (sigue en su punto con `status: 'dead'`), lo que llevaba cae al suelo y deja
 * de hablar con nadie. El motor lo anuncia una vez a quien esté y hace
 * reaccionar al sitio (engine.announceDeathStates). Devuelve false si ya
 * estaba muerto.
 */
export function killNpc(world: World, n: Npc, nowG: number, by: { id: Id; name: string } | null, cause: string): boolean {
  if (n.status === 'dead') return false;
  n.status = 'dead';
  if (n.stats) n.stats.hp = 0;
  n.talking_to = null;
  n.death = { died_game_s: nowG, by_id: by?.id ?? null, by_name: by?.name ?? null, cause, told: false };
  for (const i of world.itemsIn({ type: 'npc', id: n.id })) { i.location = { type: 'spot', id: n.location.id }; world.touch('item_instances', i.id); }
  world.touch('npcs', n.id);
  return true;
}

/** Lo que se cuenta de una muerte de NPC y quién la ha visto (engine.announceNpcDeath). */
export interface NpcDeathReport {
  /** Para todos los presentes: «la guardia» o su nombre lo pone cada lector (events.ts). */
  observable: string;
  /** Para quien lo mató, si es un PJ: en segunda persona. */
  killer_text: string | null;
  /** NPC presentes que lo han visto (ya recuerdan quién fue y le miran peor). */
  witnesses: Id[];
}

/**
 * La muerte de un NPC vista desde el sitio: el cuerpo queda en su punto, la
 * gente de la agenda que hay allí se aparta y los NPC presentes recuerdan
 * para siempre quién fue (memoria de importancia 3) y le miran peor (si eran
 * neutrales o mejor, pasan a recelar). Sin IA: el máster lo lee después en el
 * contexto.
 */
export function npcDeathReport(world: World, n: Npc, crowd: string | null, nowG: number, opts: { crime?: boolean } = {}): NpcDeathReport {
  const d = n.death!;
  const spot = world.spot(n.location.id);
  const killer = d.by_id ? world.characters.get(d.by_id) ?? null : null;
  const seen: Id[] = [];
  for (const o of world.npcs.values()) {
    if (o.id === n.id || o.id === d.by_id || o.status !== 'alive' || world.spot(o.location.id).location_id !== spot.location_id) continue;
    seen.push(o.id);
    if (!killer) continue;
    // Si ya lo recuerda (crime.ts lo apunta en el acto), no se repite.
    const note = `Vio cómo ${killer.name} mataba a ${n.name} en ${spot.name}.`;
    if (!o.memory.some((m) => m.character_id === killer.id && m.note === note)) o.memory.push({ character_id: killer.id, game_s: nowG, note, importance: 3 });
    const a = o.attitude.by_character[killer.id] ?? o.attitude.default;
    if (a === 'neutral' || a === 'friendly' || a === 'allied') o.attitude.by_character[killer.id] = 'unfriendly';
    // Ver un crimen resta confianza aunque luego se le pase el recelo (trust.ts).
    adjustTrust(world, o, killer, 'witnessed_crime', nowG);
    world.touch('npcs', o.id);
  }
  const by = d.by_name ? ` por el golpe de ${d.by_name}` : '';
  // Si es un crimen, la reacción de la sala la cuenta el evento del incidente (crime.ts), no esto.
  const around = opts.crime ? '' : crowd ? ` ${cap(crowd)} se apartan del cuerpo; alguien grita y otros salen a toda prisa.` : seen.length ? ' Quienes están cerca se quedan mirando el cuerpo, sin moverse.' : '';
  return {
    observable: `☠ ${n.name} cae al suelo y ya no se mueve: ha muerto${by}. El cuerpo queda en ${spot.name}.${around}`,
    killer_text: killer ? `☠ ${n.name} cae al suelo y ya no se mueve: ha muerto por tu golpe. El cuerpo queda en ${spot.name}.${around}` : null,
    witnesses: seen,
  };
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** NPC muertos cuyo cuerpo está en este punto. */
export function deadNpcsAt(world: World, spotId: Id): Npc[] {
  return [...world.npcs.values()].filter((n) => n.status === 'dead' && n.location.id === spotId);
}

/** «el cuerpo de Doro» (o de «la guardia», si el lector no sabe su nombre). */
export function npcBodyName(label: string): string {
  return `el cuerpo de ${label}`;
}
