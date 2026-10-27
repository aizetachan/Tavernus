/**
 * Órdenes de los NPC: lo que un NPC decide en la ficción y el motor cumple sin
 * IA. El máster la fija (set_npc_order, tools.ts) cuando el NPC acepta o
 * decide; desde ahí la aplica el servidor en cada asentamiento (engine.ts,
 * settleAll), de forma determinista:
 *
 *   - follow: va con un PJ entre puntos y localizaciones hasta que la orden
 *     acaba (lo despiden, cumple el encargo, peligro, se le acaba el tiempo).
 *   - go: se va a un punto (o a donde está el objetivo de su encargo) de
 *     verdad, y allí se queda un rato.
 *   - stay: se queda donde está hasta una hora; luego vuelve a su horario.
 *
 * Cualquiera puede llevar un encargo («curar al herido»): lo hace en cuanto
 * está en la misma localización que su objetivo (o, sin objetivo, al llegar).
 * Mientras tiene orden, su horario y la agenda le dejan en paz (schedule.ts).
 *
 * Los NPC se mueven al instante, como en la agenda, y lo ven llegar y
 * marcharse quienes estén en cada sitio (eventos npc_move, aviso de una línea
 * en la web). La orden va en `npc.order`, como propiedad opcional (sin tocar
 * el modelo), para que un reinicio no la pierda.
 */

import { GAME_MINUTE } from '../clock/clock.js';
import type { Rng } from './dice.js';
import type { EmitInput } from './events.js';
import type { Character, Id, Npc, Spot } from './model.js';
import type { Position } from './movement.js';
import type { World } from './world.js';
import { attitudeOf } from './combat.js';
import { opinionOf, refusesHelp } from './standing.js';
import { healCharacter, isDying, stabilize } from './death.js';
import { transferItem } from './inventory.js';

export type NpcTaskKind = 'act' | 'heal' | 'stabilize' | 'give';
export const NPC_TASK_KINDS: readonly NpcTaskKind[] = ['act', 'heal', 'stabilize', 'give'];

/** Encargo que el NPC ha aceptado hacer. */
export interface NpcTask {
  kind: NpcTaskKind;
  /** Lo que hace, en tercera persona y sin su nombre: «se arrodilla junto a Mira y le venda la herida». */
  text: string;
  /** Sobre quién (PJ o NPC). Sin objetivo, lo hace al llegar (solo con go). */
  target_id: Id | null;
  /** heal: PG que devuelve (si falta, un cuarto de sus PG máximos). */
  amount?: number | null;
  /** give: el ejemplar que entrega. */
  item_instance_id?: Id | null;
}

export type NpcOrder =
  | { kind: 'follow'; character_id: Id; since_game_s: number; until_game_s: number; task: NpcTask | null; hp_at_start: number | null }
  | { kind: 'go'; spot_id: Id; since_game_s: number; until_game_s: number; task: NpcTask | null }
  | { kind: 'stay'; spot_id: Id; since_game_s: number; until_game_s: number; task: NpcTask | null };

/** Lo que dura seguir a alguien si el máster no dice otra cosa. */
export const FOLLOW_DEFAULT_MIN = 4 * 60;
/** Lo que se queda donde ha ido si el máster no dice otra cosa. */
export const STAY_DEFAULT_MIN = 60;
/** Al acabar de acompañar o de hacer el encargo, se queda un poco antes de volver a lo suyo. */
export const LINGER_S = 10 * GAME_MINUTE;
export const MAX_ORDER_MIN = 24 * 60;

type OrderNpc = Npc & { order?: NpcOrder | null };

export function orderOf(n: Npc): NpcOrder | null { return (n as OrderNpc).order ?? null; }

function setOrder(world: World, n: Npc, o: NpcOrder | null): void {
  if (o) (n as OrderNpc).order = o; else delete (n as OrderNpc).order;
  world.touch('npcs', n.id);
}

/** Quién sigue a un PJ. */
export function followersOf(world: World, characterId: Id): Npc[] {
  return [...world.npcs.values()].filter((n) => { const o = orderOf(n); return o?.kind === 'follow' && o.character_id === characterId && n.status === 'alive'; });
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

function posOf(s: Spot): Position {
  return { spot_id: s.id, next_spot_id: null, progress: 0, x: s.x, y: s.y, location_id: s.location_id };
}

/** «al pozo», «a la barra». */
function aEs(name: string): string { return /^el /i.test(name) ? `al ${name.slice(3)}` : `a ${name}`; }
/** «del pozo», «de la barra». */
function deEs(name: string): string { return /^el /i.test(name) ? `del ${name.slice(3)}` : `de ${name}`; }

function nameOf(world: World, id: Id | null): string {
  if (!id) return 'alguien';
  return world.characters.get(id)?.name ?? world.npcs.get(id)?.name ?? id;
}

/** «Ilse se arrodilla junto a Mira.» desde «se arrodilla junto a Mira». */
function taskSentence(n: Npc, t: NpcTask, world: World): string {
  const raw = t.text.trim().replace(/[.\s]+$/, '');
  const fallback: Record<NpcTaskKind, string> = { act: 'hace lo que había dicho', heal: `cura a ${nameOf(world, t.target_id)}`, stabilize: `atiende a ${nameOf(world, t.target_id)}`, give: `le da algo a ${nameOf(world, t.target_id)}` };
  const body = raw || fallback[t.kind];
  return `${body.toLowerCase().startsWith(n.name.toLowerCase()) ? body : `${n.name} ${body.charAt(0).toLowerCase()}${body.slice(1)}`}.`;
}

/** Una línea para el contexto del máster y get_npc. */
export function orderLine(world: World, n: Npc, nowS: number): string | null {
  const o = orderOf(n);
  if (!o) return null;
  const task = o.task ? `; encargo: ${o.task.text || o.task.kind}${o.task.target_id ? ` (${nameOf(world, o.task.target_id)})` : ''}` : '';
  const left = Math.max(0, Math.round((o.until_game_s - nowS) / GAME_MINUTE));
  if (o.kind === 'follow') return `va con ${nameOf(world, o.character_id)} a donde vaya (el servidor la mueve con él)${task}; ${left} min como mucho`;
  if (o.kind === 'go') return `de camino ${aEs(world.spots.get(o.spot_id)?.name ?? o.spot_id)}${task}`;
  return `se queda en ${world.spots.get(o.spot_id)?.name ?? o.spot_id} ${left} min más${task}; luego vuelve a lo suyo`;
}

// ---------------------------------------------------------------------------
// Alta (tool del máster)
// ---------------------------------------------------------------------------

export interface OrderInput {
  npc_id: Id;
  order: 'follow' | 'go' | 'stop';
  /** follow: a quién sigue. */
  character_id?: Id | null;
  /** go: adónde (punto). Sin él, al punto del objetivo del encargo. */
  spot_id?: Id | null;
  task?: NpcTask | null;
  /** follow: duración máxima; go: lo que se queda allí. */
  minutes?: number | null;
}

export type OrderResult = { ok: true; order: NpcOrder | null; npc: Npc } | { ok: false; error: string };

function validTask(world: World, t: NpcTask | null | undefined, order: 'follow' | 'go'): { task: NpcTask | null } | { error: string } {
  if (!t) return { task: null };
  if (!NPC_TASK_KINDS.includes(t.kind)) return { error: `task_kind debe ser ${NPC_TASK_KINDS.join(' | ')}` };
  const target = t.target_id || null;
  if (target && !world.characters.has(target) && !world.npcs.has(target)) return { error: `no existe ${target}` };
  if (!target && (t.kind !== 'act' || order === 'follow')) return { error: order === 'follow' && t.kind === 'act' ? 'un encargo al seguir a alguien necesita task_target_id (sobre quién lo hace, para saber cuándo ha llegado)' : `${t.kind} necesita task_target_id` };
  if (t.kind === 'stabilize' && !world.characters.has(target!)) return { error: 'stabilize es para un PJ caído' };
  if (t.kind === 'give') {
    const inst = t.item_instance_id ? world.itemInstances.get(t.item_instance_id) : null;
    if (!inst) return { error: 'give necesita task_item_id (ID del ejemplar que entrega)' };
    if (!world.characters.has(target!)) return { error: 'give es para entregárselo a un PJ' };
  }
  const amount = t.amount == null || !Number.isFinite(Number(t.amount)) ? null : Math.max(1, Math.floor(Number(t.amount)));
  return { task: { kind: t.kind, text: (t.text ?? '').trim().slice(0, 200), target_id: target, ...(amount != null ? { amount } : {}), ...(t.item_instance_id ? { item_instance_id: t.item_instance_id } : {}) } };
}

/** Fija (o quita) la orden de un NPC. No mueve a nadie: lo hace `tickOrders` al asentar. */
export function setNpcOrder(world: World, input: OrderInput, nowS: number): OrderResult {
  const n = world.npcs.get(input.npc_id);
  if (!n) return { ok: false, error: `no existe el NPC ${input.npc_id}` };
  if (n.status !== 'alive') return { ok: false, error: `${n.name} no puede (${n.status})` };
  if (input.order === 'stop') {
    const prev = orderOf(n);
    // Despedido: se queda un poco donde está y vuelve a lo suyo.
    setOrder(world, n, prev ? { kind: 'stay', spot_id: n.location.id, since_game_s: nowS, until_game_s: nowS + LINGER_S, task: null } : null);
    return { ok: true, order: orderOf(n), npc: n };
  }
  const mins = input.minutes == null || !Number.isFinite(Number(input.minutes)) ? null : Math.max(1, Math.min(MAX_ORDER_MIN, Math.round(Number(input.minutes))));
  if (input.order === 'follow') {
    const c = input.character_id ? world.characters.get(input.character_id) : undefined;
    if (!c) return { ok: false, error: `no existe el personaje ${input.character_id}` };
    if (c.status === 'dead' || c.status === 'retired') return { ok: false, error: `${c.name} no está para que le sigan` };
    if (world.characterSpot(c)?.location_id !== world.spot(n.location.id).location_id) return { ok: false, error: `${n.name} no está donde ${c.name}: no puede ir con él` };
    if (attitudeOf(n, c.id) === 'hostile') return { ok: false, error: `${n.name} es hostil a ${c.name}: no le acompaña` };
    if (refusesHelp(n, c.id)) return { ok: false, error: `${n.name} no se fía de ${c.name} (opinión ${opinionOf(n, c.id)}): no le acompaña` };
    const t = validTask(world, input.task, 'follow');
    if ('error' in t) return { ok: false, error: t.error };
    setOrder(world, n, { kind: 'follow', character_id: c.id, since_game_s: nowS, until_game_s: nowS + (mins ?? FOLLOW_DEFAULT_MIN) * GAME_MINUTE, task: t.task, hp_at_start: n.stats?.hp ?? null });
    return { ok: true, order: orderOf(n), npc: n };
  }
  const t = validTask(world, input.task, 'go');
  if ('error' in t) return { ok: false, error: t.error };
  let spotId = input.spot_id || null;
  if (!spotId && t.task?.target_id) spotId = spotOf(world, t.task.target_id)?.id ?? null;
  if (!spotId) return { ok: false, error: 'go necesita target_spot_id, target_location_id o un encargo con objetivo' };
  if (!world.spots.has(spotId)) return { ok: false, error: `no existe el punto ${spotId}` };
  setOrder(world, n, { kind: 'go', spot_id: spotId, since_game_s: nowS, until_game_s: nowS + (mins ?? STAY_DEFAULT_MIN) * GAME_MINUTE, task: t.task });
  return { ok: true, order: orderOf(n), npc: n };
}

/** Lo que dura la escena de apertura con quien la protagoniza antes de que vuelva a su horario. */
export const OPENING_HOLD_MIN = 30;

/**
 * Lleva a un NPC a un punto y lo retiene allí un rato (orden `go`, luego
 * `stay`): la apertura de una situación (claimSituation) cuenta que está con
 * el PJ, así que tiene que estar, aunque su horario diga otra cosa. Lo mueve
 * `tickOrders` al asentar, antes de que el máster narre la apertura, con su
 * `npc_move` para quien lo vea irse o llegar.
 */
export function holdNpcAt(world: World, n: Npc, spotId: Id, nowS: number, minutes = OPENING_HOLD_MIN): boolean {
  if (n.status !== 'alive' || !world.spots.has(spotId)) return false;
  n.talking_to = null;
  setOrder(world, n, { kind: 'go', spot_id: spotId, since_game_s: nowS, until_game_s: nowS + minutes * GAME_MINUTE, task: null });
  return true;
}

function spotOf(world: World, id: Id): Spot | null {
  const c = world.characters.get(id);
  if (c) return world.characterSpot(c);
  const n = world.npcs.get(id);
  return n ? world.spots.get(n.location.id) ?? null : null;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/** Emite un evento a la hora de juego dada; con `after`, nunca antes del último evento de ese PJ. */
export type OrderEmit = (input: EmitInput, atGameS: number, after?: Character | null) => void;

/**
 * Cumple las órdenes hasta `nowS`: quien sigue a alguien se pone donde está
 * él (si ya ha llegado), quien va a un sitio llega, se hacen los encargos y se
 * cierran las órdenes que han acabado. `nowFor` da la hora de un PJ (puede ir
 * por delante del mundo tras un viaje rápido).
 */
export function tickOrders(world: World, nowS: number, emit: OrderEmit, nowFor: (c: Character) => number = () => nowS, rng?: Rng): void {
  for (const n of world.npcs.values()) {
    const o = orderOf(n);
    if (!o) continue;
    if (n.status !== 'alive') { setOrder(world, n, null); continue; }
    if (o.kind === 'follow') { follow(world, n, o, nowS, emit, nowFor, rng); continue; }
    if (o.kind === 'go') {
      if (world.spots.has(o.spot_id) && o.spot_id !== n.location.id) moveNpc(world, n, o.spot_id, nowS, emit, null);
      const stay: NpcOrder = { kind: 'stay', spot_id: n.location.id, since_game_s: nowS, until_game_s: o.until_game_s, task: o.task };
      setOrder(world, n, stay);
      // Sin objetivo, el encargo es llegar y hacerlo.
      if (stay.task && !stay.task.target_id) { emitTask(world, n, stay.task, nowS, emit, null); setOrder(world, n, { ...stay, task: null }); }
      else if (stay.task) tryTask(world, n, stay, nowS, emit, rng, null);
      continue;
    }
    if (nowS >= o.until_game_s) { setOrder(world, n, null); continue; }
    if (o.task) tryTask(world, n, o, nowS, emit, rng, null);
  }
}

function follow(world: World, n: Npc, o: Extract<NpcOrder, { kind: 'follow' }>, nowS: number, emit: OrderEmit, nowFor: (c: Character) => number, rng?: Rng): void {
  const leader = world.characters.get(o.character_id);
  const at = leader ? nowFor(leader) : nowS;
  /** Se acaba: se queda un poco donde está y vuelve a lo suyo. Con `why`, se lo cuenta a quien lo vea y al que acompañaba. */
  const end = (why: string | null) => {
    setOrder(world, n, { kind: 'stay', spot_id: n.location.id, since_game_s: at, until_game_s: at + LINGER_S, task: null });
    if (why === null || !leader) return;
    const spot = world.spot(n.location.id);
    emit({
      actor_id: null, at: posOf(spot), action_type: 'npc_order_end', narration_private: '', observable: `${n.name} deja de acompañar a ${leader.name}${why}.`, tags: ['npc', 'deterministic'],
      payload: { master: null, notice: 'all', npc_id: n.id, target_character_id: leader.id, observable_target: `${n.name} deja de acompañarte${why}.`, observable_vague: 'Alguien se aparta.' },
    }, at, leader);
  };
  if (!leader || leader.status === 'dead' || leader.status === 'retired') { end(null); return; }
  if (leader.away) { end(''); return; }
  if (at >= o.until_game_s) { end(': tiene que volver a lo suyo'); return; }
  if (attitudeOf(n, leader.id) === 'hostile') { end(''); return; }
  // Peligro: si le hacen daño mientras le acompaña, se aparta.
  if (o.hp_at_start != null && n.stats && n.stats.hp < o.hp_at_start) { end(': le han hecho daño y se aparta'); return; }
  if (leader.transit) return; // aún de camino: va con él y llegan juntos
  const spot = world.characterSpot(leader);
  if (!spot) return;
  if (spot.id !== n.location.id) moveNpc(world, n, spot.id, at, emit, leader);
  if (o.task && tryTask(world, n, o, at, emit, rng, leader)) end(null); // encargo cumplido: se queda un poco y vuelve a lo suyo
}

/** Hace el encargo si el objetivo está en su localización. true si lo ha hecho (o ya no tiene sentido). */
function tryTask(world: World, n: Npc, o: Extract<NpcOrder, { kind: 'follow' | 'stay' }>, nowS: number, emit: OrderEmit, rng: Rng | undefined, leader: Character | null): boolean {
  const t = o.task!;
  const target = spotOf(world, t.target_id!);
  const pc = world.characters.get(t.target_id!);
  if (!target || target.location_id !== world.spot(n.location.id).location_id || pc?.transit) return false;
  if (target.id !== n.location.id) moveNpc(world, n, target.id, nowS, emit, null);
  const done = () => { if (o.kind === 'stay') setOrder(world, n, { ...o, task: null }); return true; };
  if (pc && pc.status === 'dead') return done(); // ya no hay nada que hacer
  let extra = '';
  if (t.kind === 'heal') {
    if (pc) {
      const r = healCharacter(world, pc, t.amount ?? Math.max(1, Math.ceil(pc.hp_max / 4)), n.name);
      extra = r.revived ? '' : ` ${pc.name} queda a ${pc.hp_current}/${pc.hp_max} PG.`;
    } else {
      const other = world.npc(t.target_id!);
      if (other.stats) { other.stats.hp = Math.min(other.stats.hp_max, other.stats.hp + (t.amount ?? Math.max(1, Math.ceil(other.stats.hp_max / 4)))); world.touch('npcs', other.id); }
    }
  } else if (t.kind === 'stabilize' && pc) {
    if (isDying(pc)) stabilize(world, pc, nowS, n.name, `estabilizado por ${n.name}`, rng);
  } else if (t.kind === 'give' && pc && t.item_instance_id) {
    const r = transferItem(world, t.item_instance_id, { type: 'character', id: pc.id, slot: { kind: 'pocket' } });
    if (!r.ok) transferItem(world, t.item_instance_id, { type: 'spot', id: target.id });
  }
  emitTask(world, n, t, nowS, emit, leader, extra);
  return done();
}

function emitTask(world: World, n: Npc, t: NpcTask, nowS: number, emit: OrderEmit, leader: Character | null, extra = ''): void {
  const spot = world.spot(n.location.id);
  const text = taskSentence(n, t, world) + extra;
  const target = t.target_id && world.characters.has(t.target_id) ? t.target_id : null;
  emit({
    actor_id: null, at: posOf(spot), action_type: 'npc_task', narration_private: '', observable: text, tags: ['npc', 'deterministic'],
    payload: { master: null, npc_id: n.id, ...(target ? { target_character_id: target } : {}), observable_vague: 'Alguien se afana en algo.' },
  }, nowS, leader ?? (target ? world.characters.get(target) : null));
}

/** Mueve un NPC al instante y lo cuenta a quien lo vea salir o llegar. Con `leader`, va con él. */
function moveNpc(world: World, n: Npc, toId: Id, atS: number, emit: OrderEmit, leader: Character | null): void {
  const from = world.spot(n.location.id);
  const to = world.spot(toId);
  n.location = { type: 'spot', id: to.id };
  n.talking_to = null;
  world.touch('npcs', n.id);
  const base = { actor_id: null, action_type: 'npc_move', narration_private: '', tags: ['npc', 'deterministic'] };
  const payload = (vague: string) => ({ master: null, notice: 'all', npc_id: n.id, observable_vague: vague });
  const withLeader = leader ? ` con ${leader.name}` : '';
  if (from.location_id === to.location_id) {
    emit({ ...base, at: posOf(to), observable: `${n.name} va${withLeader} ${aEs(to.name)}.`, payload: payload(`Alguien cruza hacia ${to.name}.`) }, atS, leader);
    return;
  }
  emit({ ...base, at: posOf(from), observable: `${n.name} se va ${deEs(from.name)}${withLeader}.`, payload: payload('Una figura se marcha.') }, atS, leader);
  emit({ ...base, at: posOf(to), observable: `${n.name} llega${withLeader} ${aEs(to.name)}.`, payload: payload(`Una figura llega ${aEs(to.name)}.`) }, atS, leader);
}

// ---------------------------------------------------------------------------
// Cierre del máster: el NPC dice que va y no consta
// ---------------------------------------------------------------------------

/** Lo que dice un NPC al aceptar acompañar o ir, sin tildes: «te sigo», «tú delante», «voy contigo». */
const SAYS_GOES = /\b(te sigo|te acompano|voy contigo|ire contigo|vamos juntos|tu delante|ve delante|ve tu delante|guiame|llevame|detras de ti|ahora voy|ya voy|enseguida voy|voy para alla|voy ahora)\b/i;
/** Lo que narra el máster de él, sin tildes: «te sigue», «sale detrás de ti». */
const NARRATED_GOES = /\b(te sigue|te acompana|va contigo|viene contigo|sale (?:detras de ti|contigo)|camina a tu lado|echa a andar (?:tras|detras de) ti)\b/i;
const QUOTED = /«[^»]*»|“[^”]*”|"[^"\n]*"/g;

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Si el cierre dice que un NPC va con el actor o a algún sitio (en sus líneas,
 * en lo citado o en la narración) sin orden que lo cumpla, la frase que lo
 * dice; si no, null.
 */
export function promisedMove(input: { npcLines: string[]; narration: string; hasOrder: boolean; ordered: boolean }): string | null {
  if (input.hasOrder || input.ordered) return null;
  for (const l of [...input.npcLines, ...(input.narration.match(QUOTED) ?? [])]) { const m = SAYS_GOES.exec(norm(l)); if (m) return m[0]; }
  const m = NARRATED_GOES.exec(norm(input.narration.replace(QUOTED, ' ')));
  return m ? m[0] : null;
}

export function promisedMoveRejection(npcName: string, phrase: string): string {
  return `La narración dice que ${npcName} va («${phrase}»), pero no consta: sin orden el servidor la deja donde está y no se mueve. Si acepta acompañar al actor, set_npc_order con order=follow (y el encargo, si va a hacer algo, como curar a alguien); si se va ella a otro sitio, order=go. Si no va, que no lo diga. Luego vuelve a cerrar con log_event.`;
}
