/**
 * Ir a un sitio es llegar y entrar. «Voy a la taberna» desde la plaza no se
 * queda en la puerta de fuera: el motor busca el punto de llegada dentro de
 * la localización (el de entrada) y la ruta entera por puntos y salidas, y la
 * recorre en una sola acción con el viaje rápido (travel.ts).
 *
 * Qué se puede nombrar como destino:
 *   - un punto de la localización donde está el PJ;
 *   - una localización que conoce (visitada, oída) o que tiene a la vista por
 *     una salida, por su nombre o el de su punto de llegada;
 *   - un NPC que conoce («ir a ver a Hugo»): va a donde está.
 * Un punto de aquí que es la puerta de otra localización («la puerta de la
 * taberna», alias «taberna») cede ante esa localización salvo que el texto
 * nombre la puerta («ir a la puerta de la taberna» se queda fuera).
 *
 * El viaje se corta antes solo si el mundo lo interrumpe (cutRoute): una
 * salida bloqueada (el Cerco), un gancho para el PJ en un sitio de paso, un
 * evento de la agenda en marcha en un sitio de paso o alguien hostil allí. El
 * encuentro del camino lo tira el viaje rápido como siempre.
 */

import { normalize } from './aliases.js';
import { attitudeOf } from './combat.js';
import { matchHooks } from './hooks.js';
import type { Character, Exit, Id, Location, Pace, Spot, TransitLeg } from './model.js';
import { estimateTravel, positionOf, routeIgnoringBlocks } from './movement.js';
import { activeIn } from './schedule.js';
import type { World } from './world.js';

/** Palabras que nombran la puerta misma: entonces se va a la puerta, no adentro. */
const DOOR_WORDS = /\b(puerta|umbral|entrada|porton|portal|verja|reja|fachada)\b/;

interface Cand { key: string; names: string[] }

/** 2 = nombre exacto (o alias); 1 = todas las palabras del texto están en el nombre; 0 = no. */
export function nameScore(query: string, names: string[]): number {
  const q = normalize(query);
  if (!q) return 0;
  const qw = q.split(' ');
  let best = 0;
  for (const raw of names) {
    const n = normalize(raw);
    if (!n) continue;
    if (n === q) return 2;
    if (qw.every((w) => n.split(' ').includes(w))) best = 1;
  }
  return best;
}

function visible(s: Spot, c: Character): boolean {
  return !s.hidden || s.discovered_by.includes(c.id);
}

function isWaypointLoc(loc: Location): boolean {
  return loc.state['waypoint'] === true;
}

/** Salidas que llevan de fuera a dentro de una localización, con su punto de llegada. */
function entrancesOf(world: World, locId: Id): { exit: Exit; from_spot_id: Id; to_spot_id: Id }[] {
  const out: { exit: Exit; from_spot_id: Id; to_spot_id: Id }[] = [];
  for (const e of world.exits.values()) {
    const a = world.spots.get(e.from_spot_id);
    const b = world.spots.get(e.to_spot_id);
    if (!a || !b) continue;
    if (b.location_id === locId && a.location_id !== locId) out.push({ exit: e, from_spot_id: a.id, to_spot_id: b.id });
    else if (e.bidirectional && a.location_id === locId && b.location_id !== locId) out.push({ exit: e, from_spot_id: b.id, to_spot_id: a.id });
  }
  return out;
}

/** Localizaciones vecinas: a las que se sale desde algún punto de aquí (sin puntos de camino). */
export function neighbours(world: World, c: Character, locId: Id): Location[] {
  const out = new Map<Id, Location>();
  for (const s of world.spotsOf(locId)) {
    for (const { to_spot_id } of world.exitsFrom(s.id)) {
      const dest = world.spot(to_spot_id);
      const loc = world.location(dest.location_id);
      if (loc.id !== locId && visible(dest, c) && !isWaypointLoc(loc)) out.set(loc.id, loc);
    }
  }
  return [...out.values()];
}

/**
 * Punto de llegada dentro de una localización: el de la entrada más barata
 * desde donde está el PJ. `reachable: false` si todas las rutas cruzan algo
 * bloqueado (entonces es la que habría sin bloqueos). null si no hay ninguna.
 */
export function entrySpot(world: World, c: Character, locId: Id, pace: Pace, nowGameS: number): { spot_id: Id; reachable: boolean } | null {
  const landings = [...new Set(entrancesOf(world, locId).map((e) => e.to_spot_id))].filter((id) => visible(world.spot(id), c));
  let best: { spot_id: Id; cost: number } | null = null;
  for (const id of landings) {
    const t = estimateTravel(world, c.id, id, pace, nowGameS);
    if (t !== null && (!best || t < best.cost)) best = { spot_id: id, cost: t };
  }
  if (best) return { spot_id: best.spot_id, reachable: true };
  for (const id of landings) if (routeIgnoringBlocks(world, c.id, id, pace, nowGameS)) return { spot_id: id, reachable: false };
  const def = world.spots.get(world.location(locId).default_spot_id);
  return def ? { spot_id: def.id, reachable: false } : null;
}

/** Localizaciones que el PJ puede nombrar como destino desde aquí. */
function namedLocations(world: World, c: Character, hereLocId: Id): Location[] {
  const out = new Map<Id, Location>();
  for (const l of neighbours(world, c, hereLocId)) out.set(l.id, l);
  for (const l of world.locations.values()) {
    if (l.id === hereLocId || isWaypointLoc(l)) continue;
    const d = l.discovery[c.id];
    if (d === 'visited' || d === 'heard_of') out.set(l.id, l);
  }
  return [...out.values()];
}

export interface Destination { spot_id: Id; location_id: Id; via: 'spot' | 'location' | 'npc'; npc_id?: Id }

/**
 * A dónde lleva «ir a <target>». `spotsHere`: también cuentan los puntos de
 * aquí (con «salir hacia…», no). null si no resuelve a exactamente un sitio.
 */
export function resolveDestination(world: World, c: Character, target: string, opts: { spotsHere: boolean; pace?: Pace; nowGameS: number }): Destination | null {
  const here = world.characterSpot(c);
  if (!here) return null;
  const pace = opts.pace ?? 'walk';
  const locs = namedLocations(world, c, here.location_id);
  const doorNamed = DOOR_WORDS.test(normalize(target));
  const cands: Cand[] = [];
  for (const l of locs) cands.push({ key: `loc:${l.id}`, names: [l.name] });
  // Los puntos de llegada de las vecinas, por su nombre (como antes): llevan a ese punto.
  for (const s of world.spotsOf(here.location_id)) {
    for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
      if (exit.state.blocked_by || exit.state.locked) continue;
      const dest = world.spot(to_spot_id);
      if (dest.location_id === here.location_id || !visible(dest, c) || isWaypointLoc(world.location(dest.location_id))) continue;
      cands.push({ key: `spot:${dest.id}`, names: [dest.name, ...dest.aliases] });
    }
  }
  if (opts.spotsHere) {
    for (const s of world.spotsOf(here.location_id)) {
      if (!visible(s, c)) continue;
      // Puerta de otra localización que el texto nombra por ella («la taberna»): cuenta como esa localización.
      const door = doorNamed ? null : neighboursFromSpot(world, c, s).find((l) => nameScore(target, [l.name]) > 0);
      cands.push({ key: door ? `loc:${door.id}` : `spot:${s.id}`, names: [s.name, ...s.aliases] });
    }
  }
  let best = 0;
  let keys = new Set<string>();
  for (const cand of cands) {
    const sc = nameScore(target, cand.names);
    if (sc === 0 || sc < best) continue;
    if (sc > best) { best = sc; keys = new Set(); }
    keys.add(cand.key);
  }
  const dests = new Map<Id, Destination>();
  for (const k of keys) {
    const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (kind === 'spot') { dests.set(id, { spot_id: id, location_id: world.spot(id).location_id, via: 'spot' }); continue; }
    const e = entrySpot(world, c, id, pace, opts.nowGameS);
    // Cerrada justo delante (el Cerco desde la barricada): no hay a dónde avanzar; eso lo resuelven la barrera o el máster.
    if (e && !e.reachable && !blockedOnRoute(world, c, e.spot_id, pace, opts.nowGameS)) continue;
    if (e) dests.set(e.spot_id, { spot_id: e.spot_id, location_id: id, via: 'location' });
  }
  if (dests.size !== 1) {
    // Una localización y uno de sus puntos a la vez («la plaza» y «la plaza mayor»): manda la localización.
    const byLoc = new Set([...dests.values()].map((d) => d.location_id));
    const loc = [...dests.values()].find((d) => d.via === 'location');
    if (!(byLoc.size === 1 && loc)) return null;
    return loc.spot_id === here.id ? null : loc;
  }
  const d = [...dests.values()][0]!;
  return d.spot_id === here.id ? null : d;
}

function neighboursFromSpot(world: World, c: Character, s: Spot): Location[] {
  const out: Location[] = [];
  for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
    if (exit.state.blocked_by || exit.state.locked) continue;
    const dest = world.spot(to_spot_id);
    if (dest.location_id !== s.location_id && visible(dest, c)) out.push(world.location(dest.location_id));
  }
  return out;
}

/** «Salir» a secas: a la única vecina de fuera (desde un interior) o a la única vecina. */
export function exitDestination(world: World, c: Character, nowGameS: number): Destination | null {
  const here = world.characterSpot(c);
  if (!here) return null;
  const hereLoc = world.location(here.location_id);
  const open = neighbours(world, c, hereLoc.id).filter((l) => entrySpot(world, c, l.id, 'walk', nowGameS)?.reachable);
  const outdoor = hereLoc.indoor ? open.filter((l) => !l.indoor) : [];
  const pick = outdoor.length === 1 ? outdoor[0]! : open.length === 1 ? open[0]! : null;
  if (!pick) return null;
  const e = entrySpot(world, c, pick.id, 'walk', nowGameS);
  return e ? { spot_id: e.spot_id, location_id: pick.id, via: 'location' } : null;
}

/** «Entrar» a secas: por la única salida de este punto, o de esta localización hacia un interior. */
export function enterDestination(world: World, c: Character, nowGameS: number): Destination | null {
  const here = world.characterSpot(c);
  if (!here) return null;
  const fromHere = neighboursFromSpot(world, c, here).filter((l) => !isWaypointLoc(l));
  const indoor = neighbours(world, c, here.location_id).filter((l) => l.indoor);
  const pick = fromHere.length === 1 ? fromHere[0]! : indoor.length === 1 ? indoor[0]! : null;
  if (!pick) return null;
  const e = entrySpot(world, c, pick.id, 'walk', nowGameS);
  return e?.reachable ? { spot_id: e.spot_id, location_id: pick.id, via: 'location' } : null;
}

/** «Ir a ver a Hugo»: a donde está un NPC que el PJ conoce. */
export function npcDestination(world: World, c: Character, who: string): Destination | null {
  const q = normalize(who);
  if (!q) return null;
  const found = [...world.npcs.values()].filter((n) => {
    if (n.status !== 'alive' || !c.knows.includes(n.id) || n.location.type !== 'spot') return false;
    const name = normalize(n.name);
    return name === q || name.split(' ')[0] === q;
  });
  if (found.length !== 1) return null;
  const n = found[0]!;
  const spot = world.spot(n.location.id);
  if (spot.id === world.characterSpot(c)?.id) return null;
  return { spot_id: spot.id, location_id: spot.location_id, via: 'npc', npc_id: n.id };
}

// ---------------------------------------------------------------------------
// Cortes del viaje
// ---------------------------------------------------------------------------

export type RouteCut =
  | { kind: 'blocked'; spot_id: Id; exit_id: Id; text: string }
  | { kind: 'hook' | 'event' | 'hostile'; spot_id: Id; location_id: Id; text: string; run_key?: string };

type Passer = Character & { passed_runs?: string[] };

/** Marca un evento de la agenda como ya visto de paso: no vuelve a parar al PJ. */
export function notePassedRun(c: Character, key: string): void {
  const p = c as Passer;
  p.passed_runs = [...(p.passed_runs ?? []).filter((k) => k !== key), key].slice(-12);
}

/**
 * ¿Algo para el viaje antes del destino? Mira las localizaciones de paso (no
 * la de salida ni la de llegada, que tienen su propia escena): un gancho para
 * el PJ, un evento de la agenda en marcha que aún no ha visto, alguien hostil.
 * Devuelve el punto donde se queda (el de entrada a ese sitio).
 */
export function interruptionOnRoute(world: World, c: Character, legs: TransitLeg[]): RouteCut | null {
  if (!legs.length) return null;
  const startLoc = world.spot(legs[0]!.from_spot_id).location_id;
  const endLoc = world.spot(legs.at(-1)!.to_spot_id).location_id;
  const seen = new Set((c as Passer).passed_runs ?? []);
  for (const leg of legs) {
    if (!leg.via_exit_id) continue;
    const spot = world.spot(leg.to_spot_id);
    const loc = world.location(spot.location_id);
    if (loc.id === startLoc || loc.id === endLoc) continue;
    if (matchHooks(world, { kind: 'location', location_id: loc.id, character_id: c.id }).length) {
      return { kind: 'hook', spot_id: spot.id, location_id: loc.id, text: `Al pasar por ${loc.name} algo te hace parar.` };
    }
    const run = activeIn(world, loc.id, leg.ends_game_s).find(({ event, run: r }) => !seen.has(`${event.id}@${r.start_s}`));
    if (run) {
      return { kind: 'event', spot_id: spot.id, location_id: loc.id, run_key: `${run.event.id}@${run.run.start_s}`, text: `Al pasar por ${loc.name} te encuentras con ${run.event.title}.` };
    }
    const hostile = [...world.npcs.values()].find((n) => n.status === 'alive' && n.location.type === 'spot'
      && world.spot(n.location.id).location_id === loc.id && attitudeOf(n, c.id) === 'hostile');
    if (hostile) return { kind: 'hostile', spot_id: spot.id, location_id: loc.id, text: `Al llegar a ${loc.name} te paras en seco: no estás solo.` };
  }
  return null;
}

/**
 * Sin ruta abierta hasta el destino: hasta dónde se llega antes de la primera
 * salida bloqueada o cerrada. null si no hay camino ni ignorando bloqueos, o
 * si el bloqueo está en esta misma localización (no hay viaje que hacer: lo
 * resuelven la barrera o el master).
 */
export function blockedOnRoute(world: World, c: Character, targetSpotId: Id, pace: Pace, nowGameS: number): RouteCut | null {
  const legs = routeIgnoringBlocks(world, c.id, targetSpotId, pace, nowGameS);
  if (!legs) return null;
  const here = positionOf(world, c, nowGameS).spot_id;
  for (const leg of legs) {
    if (!leg.via_exit_id) continue;
    const exit = world.exit(leg.via_exit_id);
    if (!exit.state.blocked_by && !exit.state.locked) continue;
    if (world.spot(leg.from_spot_id).location_id === world.spot(here).location_id) return null;
    const beyond = world.locationOfSpot(leg.to_spot_id).name;
    const why = typeof exit.state.blocked_by === 'string' ? exit.state.blocked_by : 'está cerrado';
    return { kind: 'blocked', spot_id: leg.from_spot_id, exit_id: exit.id, text: `Llegas hasta ${world.spot(leg.from_spot_id).name}: el paso hacia ${beyond} no se puede cruzar (${why}).` };
  }
  return null;
}

/** La línea con la que se entra: «Cruzas la puerta de la taberna y entras en Taberna del Jabalí.» */
export function crossingLine(world: World, exitId: Id | undefined, arrivedSpotId: Id): string {
  const loc = world.locationOfSpot(arrivedSpotId);
  if (!exitId) return '';
  const exit = world.exits.get(exitId);
  if (!exit) return '';
  const fromId = exit.to_spot_id === arrivedSpotId ? exit.from_spot_id : exit.to_spot_id;
  const from = world.spots.get(fromId);
  if (!from) return '';
  const name = loc.name.replace(/^(El|La|Los|Las) /, (m) => m.toLowerCase());
  if (loc.indoor) return `Cruzas ${from.name} y entras en ${name}.`;
  const to = name.startsWith('el ') ? `al ${name.slice(3)}` : `a ${name}`;
  return world.location(from.location_id).indoor ? `Sales ${to}.` : '';
}
