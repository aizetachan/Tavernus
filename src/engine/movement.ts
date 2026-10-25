/**
 * Movimiento (SPEC §3.2.3, §3.2.4). Nunca instantáneo, misma fórmula para todos.
 *
 *   tiempo_juego = distancia / (velocidad × terreno × condiciones × ritmo) + entry_cost
 *
 * Dijkstra sobre el grafo de puntos: dentro de una localización todos los
 * puntos se conectan entre sí (distancia euclídea); entre localizaciones solo
 * por salidas. El servidor calcula; el master solo narra.
 */

import type { Character, Id, Pace, Spot, Transit, TransitLeg, Vehicle } from './model.js';
import type { World } from './world.js';
import { encumbrance } from './inventory.js';

export type MoveError =
  | { code: 'unknown_spot'; spot_id: Id }
  | { code: 'already_there' }
  | { code: 'no_route'; from: Id; to: Id }
  | { code: 'spot_full'; spot_id: Id; capacity: number }
  | { code: 'not_active'; status: Character['status'] }
  | { code: 'not_driver'; vehicle_id: Id }
  | { code: 'cannot_move'; reason: string }
  | { code: 'locked'; spot_id: Id; key_item_id: Id | null };

export type MoveResult =
  | { ok: true; transit: Transit; total_s: number }
  | { ok: false; error: MoveError };

/** Posición actual, interpolada si va de camino. */
export interface Position {
  spot_id: Id;              // último punto alcanzado
  next_spot_id: Id | null;  // hacia dónde va en este tramo
  progress: number;         // 0-1 dentro del tramo actual
  x: number;
  y: number;
  location_id: Id;
}

const FT_PER_BASE = 30;

/** m/s efectivos del PJ (o del vehículo que lo lleva). */
export function speedMps(world: World, c: Character, pace: Pace): number {
  const rules = world.campaign.movement_rules;
  let ft = Math.max(0, c.speed_ft - encumbrance(world, c).speed_penalty_ft);
  let cond = c.condition_speed_factor;
  if (c.location.type === 'vehicle') {
    const v = world.vehicle(c.location.id);
    ft = v.speed_ft;
    cond = 1;
  }
  return rules.base_speed_mps * (ft / FT_PER_BASE) * rules.pace[pace] * cond;
}

export function distance(a: Spot, b: Spot): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function occupants(world: World, spotId: Id): number {
  return world.charactersAt(spotId).length + world.npcsAt(spotId).length;
}

function vehicleCanEnter(v: Vehicle | null, spot: Spot): boolean {
  if (!v || v.terrain_allowed.length === 0) return true;
  return spot.tags.some((t) => v.terrain_allowed.includes(t));
}

function spotVisibleTo(spot: Spot, c: Character): boolean {
  return !spot.hidden || spot.discovered_by.includes(c.id);
}

/**
 * Punto cerrado con llave para este PJ: `state.locked === true` y ni lo tiene
 * abierto (`state.unlocked_for`, p. ej. al pagar la noche) ni lleva encima la
 * llave (`state.key_item_id`). Salir de él nunca está cerrado.
 */
export function spotLockedFor(world: World, spot: Spot, c: Character): boolean {
  if (spot.state['locked'] !== true) return false;
  const open = spot.state['unlocked_for'];
  if (Array.isArray(open) && open.includes(c.id)) return false;
  const key = spot.state['key_item_id'];
  return !(typeof key === 'string' && world.itemsCarriedBy(c.id).some((i) => i.item_id === key));
}

interface Edge { to: Id; distance_m: number; duration_s: number; via_exit_id?: Id }

function edgesFrom(world: World, c: Character, vehicle: Vehicle | null, spot: Spot, speed: number, ignoreBlocks = false): Edge[] {
  const out: Edge[] = [];
  for (const v of world.spotsOf(spot.location_id)) {
    if (v.id === spot.id || !spotVisibleTo(v, c) || !vehicleCanEnter(vehicle, v) || spotLockedFor(world, v, c)) continue;
    const d = distance(spot, v);
    out.push({ to: v.id, distance_m: d, duration_s: d / (speed * v.terrain_multiplier) + v.entry_cost_s });
  }
  for (const { exit, to_spot_id } of world.exitsFrom(spot.id)) {
    if (!ignoreBlocks && (exit.state.blocked_by || exit.state.locked)) continue;
    const v = world.spot(to_spot_id);
    if (!spotVisibleTo(v, c) || !vehicleCanEnter(vehicle, v)) continue;
    out.push({
      to: v.id,
      distance_m: exit.distance_m,
      duration_s: exit.distance_m / (speed * exit.terrain_multiplier) + v.entry_cost_s,
      via_exit_id: exit.id,
    });
  }
  return out;
}

/** Semilla de Dijkstra: un punto con un coste inicial ya pagado. */
interface Seed { spot_id: Id; cost_s: number; partial?: TransitLeg }

function dijkstra(world: World, c: Character, vehicle: Vehicle | null, seeds: Seed[], target: Id, speed: number, ignoreBlocks = false):
  { legs: TransitLeg[]; total_s: number } | null {
  const dist = new Map<Id, number>();
  const prev = new Map<Id, { from: Id; edge: Edge } | { seed: Seed }>();
  const done = new Set<Id>();
  const frontier: { id: Id; cost: number }[] = [];
  for (const s of seeds) {
    dist.set(s.spot_id, s.cost_s);
    prev.set(s.spot_id, { seed: s });
    frontier.push({ id: s.spot_id, cost: s.cost_s });
  }
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const { id, cost } = frontier.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    if (id === target) break;
    for (const e of edgesFrom(world, c, vehicle, world.spot(id), speed, ignoreBlocks)) {
      const nc = cost + e.duration_s;
      if (nc < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nc);
        prev.set(e.to, { from: id, edge: e });
        frontier.push({ id: e.to, cost: nc });
      }
    }
  }
  if (!done.has(target)) return null;

  const legs: TransitLeg[] = [];
  let cur = target;
  for (;;) {
    const p = prev.get(cur)!;
    if ('seed' in p) { if (p.seed.partial) legs.unshift(p.seed.partial); break; }
    const leg: TransitLeg = {
      from_spot_id: p.from, to_spot_id: cur, distance_m: p.edge.distance_m,
      duration_s: p.edge.duration_s, ends_game_s: 0,
    };
    if (p.edge.via_exit_id) leg.via_exit_id = p.edge.via_exit_id;
    legs.unshift(leg);
    cur = p.from;
  }
  return { legs, total_s: dist.get(target)! };
}

/**
 * Posición actual de un PJ. Si está en tránsito, interpola sobre el tramo en
 * curso a partir del reloj de juego.
 */
export function positionOf(world: World, c: Character, nowGameS: number): Position {
  const here = world.characterSpot(c)!;
  const t = c.transit;
  if (!t) return { spot_id: here.id, next_spot_id: null, progress: 0, x: here.x, y: here.y, location_id: here.location_id };
  let start = t.departed_game_s;
  for (const leg of t.legs) {
    if (nowGameS < leg.ends_game_s) {
      const progress = Math.max(0, Math.min(1, (nowGameS - start) / leg.duration_s));
      const a = world.spot(leg.from_spot_id);
      const b = world.spot(leg.to_spot_id);
      const sameLoc = a.location_id === b.location_id;
      return {
        spot_id: a.id, next_spot_id: b.id, progress,
        x: sameLoc ? a.x + (b.x - a.x) * progress : a.x,
        y: sameLoc ? a.y + (b.y - a.y) * progress : a.y,
        location_id: a.location_id,
      };
    }
    start = leg.ends_game_s;
  }
  const last = world.spot(t.destination_spot_id);
  return { spot_id: last.id, next_spot_id: null, progress: 0, x: last.x, y: last.y, location_id: last.location_id };
}

/** Coloca al PJ (y su vehículo si conduce) en un punto. */
function place(world: World, c: Character, spotId: Id): void {
  if (c.location.type === 'vehicle') {
    const v = world.vehicle(c.location.id);
    v.location = { type: 'spot', id: spotId };
    world.touch('vehicles', v.id);
  } else {
    c.location = { type: 'spot', id: spotId };
  }
}

export interface SettleResult {
  /** Puntos alcanzados en este asentamiento, en orden. */
  reached: { spot_id: Id; at_game_s: number; via_exit_id?: Id }[];
  arrived: boolean;
}

/**
 * Consolida los tramos ya completados según el reloj. Se llama en cada tick
 * y antes de cualquier acción del PJ. Idempotente.
 */
export function settleTransit(world: World, c: Character, nowGameS: number): SettleResult {
  const result: SettleResult = { reached: [], arrived: false };
  const t = c.transit;
  if (!t) return result;
  const remaining: TransitLeg[] = [];
  for (const leg of t.legs) {
    if (leg.ends_game_s <= nowGameS && remaining.length === 0) {
      place(world, c, leg.to_spot_id);
      const r: SettleResult['reached'][number] = { spot_id: leg.to_spot_id, at_game_s: leg.ends_game_s };
      if (leg.via_exit_id) r.via_exit_id = leg.via_exit_id;
      result.reached.push(r);
    } else {
      remaining.push(leg);
    }
  }
  if (remaining.length === 0) {
    c.transit = null;
    result.arrived = true;
  } else if (remaining.length !== t.legs.length) {
    c.transit = { ...t, legs: remaining };
  }
  if (result.reached.length || result.arrived) world.touch('characters', c.id);
  return result;
}

/**
 * Planifica y arranca un desplazamiento. Si el PJ ya iba de camino, parte de
 * su posición interpolada: puede volver sobre sus pasos o seguir, lo que salga
 * más corto.
 */
export function moveTo(world: World, characterId: Id, targetSpotId: Id, pace: Pace, nowGameS: number): MoveResult {
  const c = world.character(characterId);
  if (c.status !== 'active') return { ok: false, error: { code: 'not_active', status: c.status } };
  const target = world.spots.get(targetSpotId);
  if (!target) return { ok: false, error: { code: 'unknown_spot', spot_id: targetSpotId } };

  let vehicle: Vehicle | null = null;
  if (c.location.type === 'vehicle') {
    vehicle = world.vehicle(c.location.id);
    if (vehicle.owner_id !== c.id) return { ok: false, error: { code: 'not_driver', vehicle_id: vehicle.id } };
  }

  settleTransit(world, c, nowGameS);
  const pos = positionOf(world, c, nowGameS);
  const speed = speedMps(world, c, pace);
  if (speed <= 0) return { ok: false, error: { code: 'cannot_move', reason: 'speed is 0' } };

  const seeds: Seed[] = [];
  if (c.transit && pos.next_spot_id) {
    // A medio tramo: dos semillas, volver o seguir, con el coste que queda.
    const leg = c.transit.legs[0]!;
    const back = leg.duration_s * pos.progress;
    const fwd = leg.duration_s * (1 - pos.progress);
    const mk = (from: Id, to: Id, d: number, dur: number): TransitLeg => {
      const l: TransitLeg = { from_spot_id: from, to_spot_id: to, distance_m: d, duration_s: dur, ends_game_s: 0 };
      if (leg.via_exit_id) l.via_exit_id = leg.via_exit_id;
      return l;
    };
    seeds.push({ spot_id: leg.from_spot_id, cost_s: back, partial: mk(pos.spot_id, leg.from_spot_id, leg.distance_m * pos.progress, back) });
    seeds.push({ spot_id: leg.to_spot_id, cost_s: fwd, partial: mk(pos.spot_id, leg.to_spot_id, leg.distance_m * (1 - pos.progress), fwd) });
  } else {
    if (pos.spot_id === targetSpotId) return { ok: false, error: { code: 'already_there' } };
    seeds.push({ spot_id: pos.spot_id, cost_s: 0 });
  }

  if (!spotVisibleTo(target, c)) return { ok: false, error: { code: 'unknown_spot', spot_id: targetSpotId } };
  if (spotLockedFor(world, target, c)) return { ok: false, error: { code: 'locked', spot_id: target.id, key_item_id: typeof target.state['key_item_id'] === 'string' ? target.state['key_item_id'] : null } };
  if (target.capacity !== null && occupants(world, target.id) >= target.capacity) {
    return { ok: false, error: { code: 'spot_full', spot_id: target.id, capacity: target.capacity } };
  }

  const route = dijkstra(world, c, vehicle, seeds, targetSpotId, speed);
  if (!route) return { ok: false, error: { code: 'no_route', from: pos.spot_id, to: targetSpotId } };

  // Sellar instantes de fin de cada tramo.
  let t = nowGameS;
  for (const leg of route.legs) { t += leg.duration_s; leg.ends_game_s = t; }
  const transit: Transit = {
    origin_spot_id: pos.spot_id,
    destination_spot_id: targetSpotId,
    pace,
    legs: route.legs,
    departed_game_s: nowGameS,
    arrives_game_s: t,
  };
  c.transit = transit;
  world.touch('characters', c.id);
  return { ok: true, transit, total_s: route.total_s };
}

/**
 * Interrumpe el viaje. El PJ queda en el punto más cercano del tramo en curso
 * (los tramos completados ya se han asentado). Devuelve dónde ha quedado.
 */
export function interruptTransit(world: World, c: Character, nowGameS: number): Id {
  settleTransit(world, c, nowGameS);
  if (!c.transit) return world.characterSpot(c)!.id;
  const pos = positionOf(world, c, nowGameS);
  const leg = c.transit.legs[0]!;
  const stop = pos.progress >= 0.5 ? leg.to_spot_id : leg.from_spot_id;
  place(world, c, stop);
  c.transit = null;
  world.touch('characters', c.id);
  return stop;
}

/** Lo que tarda y recorre un acercamiento dentro de la localización (approachSpot). */
export interface Approach { from_spot_id: Id; to_spot_id: Id; distance_m: number; duration_s: number }

/**
 * Acercamiento dentro de la misma localización: lo que hace el motor cuando
 * el PJ habla o trata con alguien que está a unos metros (el máster lo narró
 * como si estuvieran juntos). Mismo cálculo de tiempo que moveTo, pero el PJ
 * queda ya en el punto: unos segundos de juego que caben en la propia acción.
 * null si no aplica (en camino, a caballo, otra localización, cerrado, lleno).
 */
export function approachSpot(world: World, c: Character, targetSpotId: Id): Approach | null {
  if (c.status !== 'active' || c.transit || c.location.type !== 'spot') return null;
  const here = world.characterSpot(c);
  const target = world.spots.get(targetSpotId);
  if (!here || !target || here.id === target.id || here.location_id !== target.location_id) return null;
  if (!spotVisibleTo(target, c) || spotLockedFor(world, target, c)) return null;
  if (target.capacity !== null && occupants(world, target.id) >= target.capacity) return null;
  const speed = speedMps(world, c, 'walk');
  if (speed <= 0) return null;
  const duration_s = distance(here, target) / (speed * target.terrain_multiplier) + target.entry_cost_s;
  place(world, c, target.id);
  world.touch('characters', c.id);
  return { from_spot_id: here.id, to_spot_id: target.id, distance_m: Math.round(distance(here, target) * 10) / 10, duration_s };
}

/** Tiempo de viaje estimado sin arrancarlo. */
export function estimateTravel(world: World, characterId: Id, targetSpotId: Id, pace: Pace, nowGameS: number): number | null {
  const c = world.character(characterId);
  const pos = positionOf(world, c, nowGameS);
  const vehicle = c.location.type === 'vehicle' ? world.vehicle(c.location.id) : null;
  const target = world.spots.get(targetSpotId);
  if (!target) return null;
  const r = dijkstra(world, c, vehicle, [{ spot_id: pos.spot_id, cost_s: 0 }], targetSpotId, speedMps(world, c, pace));
  return r ? r.total_s : null;
}

/**
 * Ruta como si no hubiera salidas bloqueadas ni cerradas: sirve para saber
 * hasta dónde puede llegar el PJ antes de toparse con una (goto.ts). Los
 * tramos no llevan instantes sellados. null si ni así hay camino.
 */
export function routeIgnoringBlocks(world: World, characterId: Id, targetSpotId: Id, pace: Pace, nowGameS: number): TransitLeg[] | null {
  const c = world.character(characterId);
  const pos = positionOf(world, c, nowGameS);
  const vehicle = c.location.type === 'vehicle' ? world.vehicle(c.location.id) : null;
  if (!world.spots.has(targetSpotId) || pos.spot_id === targetSpotId) return null;
  return dijkstra(world, c, vehicle, [{ spot_id: pos.spot_id, cost_s: 0 }], targetSpotId, speedMps(world, c, pace), true)?.legs ?? null;
}
