/**
 * Encuentro en curso en una localización: lo que la web enseña como combate
 * (cabecera, turnos, avisos de inicio y fin). Sin estado propio: sale del log
 * de eventos y del mundo, así que es el mismo para todos los jugadores del
 * sitio y sobrevive a un reinicio (partida del 04-11-2026: un robo pillado y un
 * forcejeo abrían y cerraban «combates» sin que nadie pegara a nadie).
 *
 *   - Hay combate solo con hostilidad real (`hostilityOf`): un ataque resuelto
 *     (tirada con `payload.attack`, tool `attack`, reacción `attack` entre
 *     jugadores), daño a un NPC (o de un conjuro a otro PJ), un incidente
 *     (crime.ts) en el que alguien responde `fight` o una resistencia a la
 *     autoridad. La etiqueta `combat` que pone el máster no abre nada: es
 *     tensión (scene.ts), como `threat`. Las tiradas de sigilo, Juego de manos o
 *     sociales tampoco.
 *   - Sigue abierto mientras quede un hostil: un NPC vivo con bloque de combate
 *     y actitud `hostile` hacia un PJ del sitio, o golpes entre PJ. Acaba en
 *     cuanto no queda ninguno (caídos, muertos, idos del sitio o calmados con
 *     npc_trust `calm` tras una disculpa, una persuasión o una intimidación),
 *     tras COMBAT_SETTLE_S desde el último golpe para que se vea; también
 *     cuando caen todos los PJ que pelearon. COMBAT_WINDOW_S sin un solo golpe
 *     es solo la red de seguridad (salvo con una ronda abierta).
 *   - Un encuentro empieza en el primer evento hostil de su cadena y su clave
 *     (`${location_id}:${started_seq}`) no cambia mientras dure. Si el log
 *     muestra que acabó (todos los NPC que pelearon, caídos o calmados; sin
 *     golpes entre PJ ni otro hostil al acecho) y luego alguien vuelve a
 *     atacar, es otro encuentro.
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

/** Red de seguridad: sin un golpe en este tiempo de juego, el combate se da por acabado aunque quede un hostil quieto. */
export const COMBAT_WINDOW_S = 600;
/** Sin hostiles, el combate sigue este rato de juego desde el último golpe (unos segundos reales) antes de acabar. */
export const COMBAT_SETTLE_S = 30;
/** Cuántas entradas del registro corto se guardan. */
export const COMBAT_LOG_MAX = 8;

/** `out`: un NPC inconsciente (golpe no letal); `down`/`stable`: un PJ a 0 PG. */
export type FighterState = 'ok' | 'hurt' | 'bloodied' | 'down' | 'stable' | 'out' | 'dead';

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
  | { seq: number; kind: 'attack'; actor_id: Id; target_id: Id; hit: boolean; damage: number; down: boolean; dead: boolean; /** Cae inconsciente, no muerto. */ ko?: boolean }
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
  const atk = e.payload['attack'] as { target_id: Id; hit: boolean; down: boolean; dead: boolean; damage?: number; ko?: boolean } | undefined;
  if (atk && e.actor_id) out.push({ seq: e.seq, kind: 'attack', actor_id: e.actor_id, target_id: atk.target_id, hit: atk.hit, damage: atk.damage ?? 0, down: atk.down, dead: atk.dead, ...(atk.ko ? { ko: true } : {}) });
  for (const c of callsOf(e)) {
    const r = okResult(c.result);
    if (!r) continue;
    const target = String(c.input['target_id'] ?? '');
    if (!target) continue;
    if (c.name === 'attack') {
      out.push({ seq: e.seq, kind: 'attack', actor_id: String(c.input['attacker_id'] ?? ''), target_id: target, hit: r['hit'] === true, damage: Number(r['damage']) || 0, down: r['target_down'] === true, dead: r['target_dead'] === true, ...(r['knocked_out'] === true ? { ko: true } : {}) });
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

/**
 * Lo que un evento dice de la hostilidad. `open`: hay hostilidad real (abre o
 * mantiene un combate). `npcs`: NPC que entran en la pelea; `out`: NPC que
 * salen de ella (caídos, muertos o calmados); `pvp`: golpes entre PJ;
 * `actors`: quién pega o recibe.
 */
export interface Hostility { open: boolean; npcs: Id[]; out: Id[]; pvp: boolean; actors: Id[] }

/** Lo que guarda el evento `incident` (Engine.announceIncidents) o el de resistirse a la autoridad. */
interface IncidentPayload { reactions?: { npc_id: Id; response: string }[]; resisted?: boolean }

export function hostilityOf(world: World, e: GameEvent): Hostility {
  const h: Hostility = { open: false, npcs: [], out: [], pvp: false, actors: [] };
  const isNpc = (id: Id) => world.npcs.has(id);
  const isPc = (id: Id) => world.characters.has(id);
  const hit = (actor: Id, target: Id, down: boolean) => {
    h.open = true;
    h.actors.push(actor, target);
    for (const id of new Set([actor, target])) if (isNpc(id)) h.npcs.push(id);
    if (isPc(actor) && isPc(target) && actor !== target) h.pvp = true;
    if (down && isNpc(target)) h.out.push(target);
  };
  const atk = e.payload['attack'] as { target_id: Id; down?: boolean; dead?: boolean } | undefined;
  if (atk && e.actor_id) hit(e.actor_id, atk.target_id, Boolean(atk.down || atk.dead));
  const calls = callsOf(e).filter((c) => okResult(c.result));
  const struck = calls.some((c) => c.name === 'cast_spell' || c.name === 'attack');
  for (const c of calls) {
    const r = okResult(c.result)!;
    const target = String(c.input['target_id'] ?? '');
    if (c.name === 'attack' && target) hit(String(c.input['attacker_id'] ?? ''), target, r['target_down'] === true || r['target_dead'] === true);
    // Daño a un NPC es agresión; a un PJ, solo si viene de un conjuro o un golpe del mismo turno (una trampa o una caída no son combate).
    else if (c.name === 'apply_damage' && target && (isNpc(target) || (struck && e.actor_id && isPc(e.actor_id)))) {
      hit(e.actor_id ?? target, target, false);
    } else if (c.name === 'npc_trust' && c.input['change'] === 'calm') h.out.push(String(c.input['npc_id'] ?? ''));
  }
  // Reacción `attack` entre jugadores, ya resuelta (Engine.resolveReaction): ataca `from`; el actor del evento es el atacado.
  const re = e.payload['reaction'] as { kind?: string; from?: Id; to?: Id } | undefined;
  if (re?.kind === 'attack' && re.from && re.to && (e.action_type === 'reaction_accepted' || e.action_type === 'reaction_resisted')) hit(re.from, re.to, false);
  // Un incidente en el que alguien se lanza a pelear, o una resistencia a la autoridad (crime.ts). Los demás (gritar, avisar) no.
  const inc = e.payload['incident'] as IncidentPayload | undefined;
  const fighters = (inc?.reactions ?? []).filter((r) => r.response === 'fight').map((r) => r.npc_id).filter(isNpc);
  if (fighters.length || inc?.resisted === true) {
    h.open = true;
    h.npcs.push(...fighters);
    if (e.actor_id) h.actors.push(e.actor_id);
  }
  if (e.action_type === 'npc_down' || e.action_type === 'npc_death') h.out.push(String(e.payload['npc_id'] ?? ''));
  return h;
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
  if (n.status === 'unconscious') return 'out';
  if (n.status === 'dead' || !n.stats || n.stats.hp === 0) return 'dead';
  return stateOf(n.stats.hp, n.stats.hp_max);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * NPC que mantienen vivo el combate (o lo empiezan: tools.ts `fightingHere`, prompt.ts «Turno de los NPC hostiles»):
 * en pie, con bloque de combate, en la localización y hostiles a alguno de esos PJ.
 */
export function hostilesAt(world: World, locationId: Id, pcs: readonly Character[]): Npc[] {
  return [...world.npcs.values()].filter((n) => n.status === 'alive' && n.stats && world.spots.get(n.location.id)?.location_id === locationId
    && pcs.some((c) => (n.attitude.by_character[c.id] ?? n.attitude.default) === 'hostile'));
}

/**
 * ¿Algún evento reciente (`events`: los últimos de la localización) de los últimos COMBAT_WINDOW_S de juego lleva la
 * etiqueta `combat`? La etiqueta sola no abre combate, pero con un hostil vivo delante basta para que ataque él primero
 * (tools.ts `fightingHere`, prompt.ts «Turno de los NPC hostiles»), como Engine.recentTags para la escena tensa.
 */
export function recentCombatTag(events: readonly GameEvent[], nowGameS: number): boolean {
  return events.some((e) => nowGameS - e.timestamp_game_s < COMBAT_WINDOW_S && e.tags.includes('combat'));
}

interface Chain { first: GameEvent; last: GameEvent; npcs: Set<Id>; out: Set<Id>; pvp: boolean; ended: boolean }

/**
 * La cadena de eventos hostiles del encuentro más reciente. Se corta con un
 * hueco de COMBAT_WINDOW_S o cuando el log dice que acabó: todos los NPC que
 * pelearon han salido (caídos, muertos o calmados), sin golpes entre PJ, pasado
 * COMBAT_SETTLE_S del último golpe y sin otro hostil al acecho (`lurking`: uno
 * que nunca peleó en ella; si lo hay, el combate seguía y no se corta).
 */
function lastChain(world: World, events: readonly GameEvent[], lurking: ReadonlySet<Id>): Chain | null {
  let ch: Chain | null = null;
  for (const e of events) {
    const h = hostilityOf(world, e);
    if (h.open) {
      const t = e.timestamp_game_s;
      const prev: Chain | null = ch;
      const stale = prev !== null && t - prev.last.timestamp_game_s >= COMBAT_WINDOW_S;
      const over = prev !== null && prev.ended && t - prev.last.timestamp_game_s >= COMBAT_SETTLE_S && ![...lurking].some((id) => !prev.npcs.has(id));
      const cur: Chain = !prev || stale || over ? { first: e, last: e, npcs: new Set(), out: new Set(), pvp: false, ended: false } : prev;
      cur.last = e;
      for (const id of h.npcs) { cur.npcs.add(id); cur.out.delete(id); }
      if (h.pvp) cur.pvp = true;
      ch = cur;
    }
    if (!ch) continue;
    for (const id of h.out) ch.out.add(id);
    const c: Chain = ch;
    c.ended = !c.pvp && c.npcs.size > 0 && [...c.npcs].every((id) => c.out.has(id));
  }
  return ch;
}

/**
 * El combate en curso en esa localización, o null. `events`: los últimos de la
 * localización (EventLog.recentInLocation), en orden. `keepAlive`: hay una ronda
 * abierta en el sitio; mientras dure, el combate no caduca por tiempo (sí al
 * quedarse sin hostiles).
 */
export function encounterAt(world: World, events: readonly GameEvent[], locationId: Id, nowGameS: number, keepAlive = false): Encounter | null {
  const local = events.filter((e) => e.location_id === locationId);
  const present = [...world.characters.values()].filter((c) => !c.transit && c.status !== 'retired' && world.characterSpot(c)?.location_id === locationId);
  const chain = lastChain(world, local, new Set(hostilesAt(world, locationId, present).map((n) => n.id)));
  if (!chain) return null;
  const { first, last } = chain;
  if (!keepAlive && nowGameS - last.timestamp_game_s >= COMBAT_WINDOW_S) return null;
  const span = local.filter((e) => e.seq >= first.seq);
  const log = span.flatMap(entriesOf);

  const involved = new Set<Id>();
  for (const x of log) { if (x.actor_id) involved.add(x.actor_id); involved.add(x.target_id); }
  for (const e of span) for (const id of hostilityOf(world, e).actors) involved.add(id);
  const pcs = present.filter((c) => c.connected || Boolean(c.away) || involved.has(c.id));
  if (!pcs.length) return null;
  const npcHere = (n: Npc) => world.spots.get(n.location.id)?.location_id === locationId;
  const hostiles = hostilesAt(world, locationId, pcs);
  // NPC del combate: los que golpean o reciben (y siguen aquí, vivos o muertos) y los hostiles con bloque de combate.
  const npcs = [...world.npcs.values()].filter((n) => npcHere(n) && n.stats && (involved.has(n.id) || hostiles.includes(n)));
  const settled = nowGameS - last.timestamp_game_s >= COMBAT_SETTLE_S;
  // Sin hostiles (caídos, muertos, idos o calmados) y sin golpes entre PJ: se acabó en cuanto se ve el último golpe.
  if (!hostiles.length && !chain.pvp && settled) return null;
  // Caídos todos los PJ que pelearon (en el suelo o muertos): también se acabó; los NPC no rematan a quien está caído.
  const fought = pcs.filter((c) => involved.has(c.id));
  if (fought.length && fought.every((c) => c.status === 'unconscious' || c.status === 'dead') && settled) return null;

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

/** Un combate ya visto por un PJ, para el registro (Ajustes → Registro de combates). */
export interface PastEncounter {
  key: string;
  location_id: Id;
  started_game_s: number;
  /** Todo lo que pasó, del más antiguo al más reciente (sin recortar). */
  log: EncounterEntry[];
}

/**
 * Los combates en los que ha estado un PJ, del más reciente al más antiguo: cada cadena de eventos de combate
 * hostiles (hostilityOf) de una localización sin huecos mayores que COMBAT_WINDOW_S (como encounterAt) en la que ese PJ golpeó, recibió
 * o actuó. Como todo aquí, sale del log: no guarda nada aparte.
 */
export function combatHistory(world: World, events: readonly GameEvent[], viewerId: Id, max = 30): PastEncounter[] {
  const chains = new Map<Id, GameEvent[][]>();
  for (const e of events) {
    if (!hostilityOf(world, e).open) continue;
    const list = chains.get(e.location_id) ?? [];
    const cur = list.at(-1);
    if (cur && e.timestamp_game_s - cur.at(-1)!.timestamp_game_s < COMBAT_WINDOW_S) cur.push(e);
    else list.push([e]);
    chains.set(e.location_id, list);
  }
  const out: PastEncounter[] = [];
  for (const [loc, list] of chains) {
    for (const chain of list) {
      const first = chain[0]!, last = chain.at(-1)!;
      const span = events.filter((e) => e.location_id === loc && e.seq >= first.seq && e.seq <= last.seq);
      const log = span.flatMap(entriesOf);
      const mine = log.some((x) => x.actor_id === viewerId || x.target_id === viewerId) || chain.some((e) => e.actor_id === viewerId);
      if (mine && log.length) out.push({ key: `${loc}:${first.seq}`, location_id: loc, started_game_s: first.timestamp_game_s, log });
    }
  }
  return out.sort((a, b) => b.started_game_s - a.started_game_s).slice(0, max);
}
