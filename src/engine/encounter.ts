/**
 * Encuentro en curso en una localización: lo que la web enseña como combate
 * (cabecera, turnos, avisos de inicio y fin). Sin estado propio: sale del log
 * de eventos y del mundo, así que es el mismo para todos los jugadores del
 * sitio y sobrevive a un reinicio.
 *
 *   - Hay combate si algún evento de combate (etiqueta `combat`, un ataque
 *     resuelto o daño aplicado por el máster) cae dentro de COMBAT_WINDOW_S de
 *     juego, como la escena tensa del motor (scene.ts, Engine.recentTags).
 *   - Empieza en el primero de la cadena de eventos de combate sin huecos
 *     mayores que esa ventana; acaba cuando pasa la ventana sin ninguno o
 *     cuando caen todos los NPC del combate (y no hubo golpes entre PJ), tras
 *     COMBAT_SETTLE_S para que se vea el golpe final.
 *   - Combatientes: los PJ del sitio que juegan (conectados o ausentes, como en
 *     las rondas) o que han golpeado o recibido; los NPC que atacan o reciben
 *     golpes y los NPC vivos con bloque de combate hostiles a alguno de ellos.
 *   - Iniciativa (SPEC §9.3, solo desempate y orden): d20 + DES, tirada con
 *     semilla del evento que abrió el combate; la misma para todos.
 */

import { abilityModifier, seededRng } from './dice.js';
import { isStable } from './death.js';
import type { Character, GameEvent, Id, Npc } from './model.js';
import type { World } from './world.js';

/** Sin eventos de combate en este tiempo de juego, el combate se da por acabado (como Engine.recentTags). */
export const COMBAT_WINDOW_S = 600;
/** Caídos todos los NPC, el combate sigue este rato de juego (unos segundos reales) antes de acabar. */
export const COMBAT_SETTLE_S = 30;
/** Cuántas entradas del registro corto se guardan. */
export const COMBAT_LOG_MAX = 8;

export type FighterState = 'ok' | 'hurt' | 'bloodied' | 'down' | 'stable' | 'dead';

export interface Fighter {
  id: Id;
  kind: 'pc' | 'npc';
  /** Total de iniciativa (d20 + modificador). */
  initiative: number;
  hp: number;
  hp_max: number;
  state: FighterState;
  /** PJ ausente (su jugador se fue): se defiende solo. */
  away?: boolean;
}

export type EncounterEntry =
  | { seq: number; kind: 'attack'; actor_id: Id; target_id: Id; hit: boolean; damage: number; down: boolean; dead: boolean }
  | { seq: number; kind: 'damage' | 'heal'; actor_id: null; target_id: Id; amount: number }
  | { seq: number; kind: 'down' | 'dead' | 'stabilized' | 'revived'; actor_id: null; target_id: Id };

export interface Encounter {
  location_id: Id;
  /** Evento que lo abrió: identifica el combate (`${location_id}:${started_seq}`). */
  started_seq: number;
  started_game_s: number;
  last_game_s: number;
  /**
   * Intercambios terminados: acciones o rondas que el máster ya ha narrado (la que pide una tirada termina al
   * tirar). La ronda en juego es la siguiente.
   */
  exchanges: number;
  /** En orden de iniciativa. */
  fighters: Fighter[];
  /** Lo último que ha pasado, del más antiguo al más reciente. */
  log: EncounterEntry[];
}

export function encounterKey(e: Encounter): string { return `${e.location_id}:${e.started_seq}`; }

interface ToolCall { name: string; input: Record<string, unknown>; result: unknown }

function callsOf(e: GameEvent): ToolCall[] {
  const m = e.payload['master'] as { calls?: ToolCall[] } | null | undefined;
  return Array.isArray(m?.calls) ? m.calls : [];
}

/** El resultado de un tool, sin error; el máster lo guarda como el JSON que le devolvió executeTool. */
function okResult(r: unknown): Record<string, unknown> | null {
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return null; } }
  return r && typeof r === 'object' && !('error' in r) ? r as Record<string, unknown> : null;
}

/** Lo que el evento aporta al registro del combate. */
function entriesOf(e: GameEvent): EncounterEntry[] {
  const out: EncounterEntry[] = [];
  const atk = e.payload['attack'] as { target_id: Id; hit: boolean; down: boolean; dead: boolean; damage?: number } | undefined;
  if (atk && e.actor_id) out.push({ seq: e.seq, kind: 'attack', actor_id: e.actor_id, target_id: atk.target_id, hit: atk.hit, damage: atk.damage ?? 0, down: atk.down, dead: atk.dead });
  for (const c of callsOf(e)) {
    const r = okResult(c.result);
    if (!r) continue;
    const target = String(c.input['target_id'] ?? '');
    if (!target) continue;
    if (c.name === 'attack') {
      out.push({ seq: e.seq, kind: 'attack', actor_id: String(c.input['attacker_id'] ?? ''), target_id: target, hit: r['hit'] === true, damage: Number(r['damage']) || 0, down: r['target_down'] === true, dead: r['target_dead'] === true });
    } else if (c.name === 'apply_damage' || c.name === 'heal') {
      out.push({ seq: e.seq, kind: c.name === 'heal' ? 'heal' : 'damage', actor_id: null, target_id: target, amount: Math.max(0, Math.floor(Number(c.input['amount']) || 0)) });
    }
  }
  if (e.actor_id) {
    if (e.action_type === 'down') out.push({ seq: e.seq, kind: 'down', actor_id: null, target_id: e.actor_id });
    else if (e.action_type === 'death') out.push({ seq: e.seq, kind: 'dead', actor_id: null, target_id: e.actor_id });
    else if (e.action_type === 'stabilized') out.push({ seq: e.seq, kind: 'stabilized', actor_id: null, target_id: e.actor_id });
    else if (e.action_type === 'revived') out.push({ seq: e.seq, kind: 'revived', actor_id: null, target_id: e.actor_id });
  }
  return out;
}

/** ¿Cuenta como combate? Lo mismo que mira la escena tensa, más los golpes que el máster resuelve con tools. */
export function isCombatEvent(e: GameEvent): boolean {
  if (e.tags.includes('combat') || e.payload['attack']) return true;
  return callsOf(e).some((c) => (c.name === 'attack' || c.name === 'apply_damage') && okResult(c.result));
}

function stateOf(hp: number, max: number): FighterState {
  if (hp >= max) return 'ok';
  return hp * 2 > max ? 'hurt' : 'bloodied';
}

function pcState(c: Character): FighterState {
  if (c.status === 'dead') return 'dead';
  if (c.status === 'unconscious' && c.hp_current === 0) return isStable(c) ? 'stable' : 'down';
  return stateOf(c.hp_current, c.hp_max);
}

function npcState(n: Npc): FighterState {
  if (n.status === 'dead' || !n.stats || n.stats.hp === 0) return 'dead';
  return stateOf(n.stats.hp, n.stats.hp_max);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * El combate en curso en esa localización, o null. `events`: los últimos de la
 * localización (EventLog.recentInLocation), en orden. `keepAlive`: hay una ronda
 * abierta en el sitio; mientras dure, el combate no caduca por tiempo.
 */
export function encounterAt(world: World, events: readonly GameEvent[], locationId: Id, nowGameS: number, keepAlive = false): Encounter | null {
  const fights = events.filter((e) => e.location_id === locationId && isCombatEvent(e));
  const last = fights.at(-1);
  if (!last || (!keepAlive && nowGameS - last.timestamp_game_s >= COMBAT_WINDOW_S)) return null;
  let start = fights.length - 1;
  while (start > 0 && fights[start]!.timestamp_game_s - fights[start - 1]!.timestamp_game_s < COMBAT_WINDOW_S) start--;
  const first = fights[start]!;
  const span = events.filter((e) => e.location_id === locationId && e.seq >= first.seq);
  const log = span.flatMap(entriesOf);

  const involved = new Set<Id>();
  for (const x of log) { if (x.actor_id) involved.add(x.actor_id); involved.add(x.target_id); }
  for (const e of span) if (e.actor_id && isCombatEvent(e)) involved.add(e.actor_id);
  const here = (c: Character) => !c.transit && c.status !== 'retired' && world.characterSpot(c)?.location_id === locationId
    && (c.connected || Boolean(c.away) || involved.has(c.id));
  const npcHere = (n: Npc) => world.spots.get(n.location.id)?.location_id === locationId;
  const pcs = [...world.characters.values()].filter(here);
  if (!pcs.length) return null;
  // NPC del combate: los que golpean o reciben (y siguen aquí, vivos o muertos) y los hostiles con bloque de combate.
  const npcs = [...world.npcs.values()].filter((n) => npcHere(n) && n.stats && (involved.has(n.id)
    || (n.status === 'alive' && pcs.some((c) => (n.attitude.by_character[c.id] ?? n.attitude.default) === 'hostile'))));
  // Caídos todos los NPC del combate (y sin golpes entre PJ): se acabó, aunque la ventana siga abierta.
  const pvp = log.some((x) => x.kind === 'attack' && world.characters.has(x.actor_id) && world.characters.has(x.target_id));
  if (npcs.length && !pvp && npcs.every((n) => n.status !== 'alive') && nowGameS - last.timestamp_game_s >= COMBAT_SETTLE_S) return null;

  const rng = (id: Id) => seededRng(hash(`${first.id}:${id}`));
  const roll = (id: Id, mod: number) => 1 + Math.floor(rng(id)() * 20) + mod;
  const fighters: (Fighter & { mod: number; name: string })[] = [
    ...pcs.map((c) => {
      const mod = abilityModifier(c.abilities.dex);
      return { id: c.id, kind: 'pc' as const, initiative: roll(c.id, mod), hp: c.hp_current, hp_max: c.hp_max, state: pcState(c), ...(c.away ? { away: true } : {}), mod, name: c.name };
    }),
    ...npcs.map((n) => ({ id: n.id, kind: 'npc' as const, initiative: roll(n.id, 0), hp: n.stats!.hp, hp_max: n.stats!.hp_max, state: npcState(n), mod: 0, name: n.name })),
  ];
  fighters.sort((a, b) => b.initiative - a.initiative || b.mod - a.mod || a.name.localeCompare(b.name));

  return {
    location_id: locationId,
    started_seq: first.seq,
    started_game_s: first.timestamp_game_s,
    last_game_s: last.timestamp_game_s,
    exchanges: span.filter((e) => e.actor_id && world.characters.has(e.actor_id)
      && ((e.action_type === 'master' && !e.payload['requires_roll']) || e.action_type === 'master_roll_outcome')).length,
    fighters: fighters.map(({ mod: _m, name: _n, ...f }) => f),
    log: log.slice(-COMBAT_LOG_MAX),
  };
}
