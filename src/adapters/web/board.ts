/**
 * Tablero de la localización actual (web): datos planos desde el motor, sin
 * IA. La página los pinta como SVG. Solo lo que el PJ puede saber: puntos no
 * ocultos (o descubiertos por él) y presentes filtrados por su percepción.
 * El plano sale de la caché (mapcache.ts: dibujado a mano o generado por
 * mapgen.ts) y se recorta aquí a lo que ve el PJ.
 *
 *   GET /api/board?character=ID
 *
 * Ruta en server.ts: añade esta línea junto a la de /api/sheet (dentro de `handle`):
 *   if (req.method === 'GET' && url.pathname === '/api/board') { handleBoardRequest(engine, req, res, url); return; }
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../../engine/engine.js';
import type { Id, LightLevel, Location, PerceptionLevel, Spot } from '../../engine/model.js';
import { positionOf } from '../../engine/movement.js';
import { descriptorOf } from '../../engine/narrate.js';
import { lightAt, perceive } from '../../engine/perception.js';
import { describeNode } from '../../engine/resources.js';
import { DEMO_MAPS, type LocationMap, type MapPoint } from '../../data/seed/maps.js';
import { mapCacheOf } from './mapcache.js';
import { generateMap, mapExtent } from './mapgen.js';
import { revealMap, revealTrackerOf } from './reveal.js';

export interface BoardSpot {
  id: Id;
  name: string;
  description: string;
  x: number;
  y: number;
  items: string[];
  nodes: string[];
}

export interface BoardExit {
  id: Id;
  from_spot_id: Id;
  to_location_id: Id;
  to_location_name: string;
  to_spot_id: Id;
  to_spot_name: string;
  distance_m: number;
  blocked: boolean;
  /** Motivo si está bloqueada: texto del bloqueo o «cerrada con llave». */
  blocked_by: string | null;
}

export interface BoardPresence {
  id: Id;
  kind: 'character' | 'npc';
  spot_id: Id;
  x: number;
  y: number;
  level: PerceptionLevel;
  /** Nombre si lo conoce, descriptor si lo ve bien, «figura» o «movimiento» según la banda. */
  label: string;
  asleep: boolean;
  moving: boolean;
}

export interface BoardState {
  location: { id: Id; name: string; description: string; light: LightLevel; indoor: boolean };
  /** Plano: suelo, paredes, puertas y muebles; sin lo que dependa de puntos que el PJ no ve ni los muebles de puntos con los que aún no ha interactuado (reveal.ts). */
  map: LocationMap;
  spots: BoardSpot[];
  exits: BoardExit[];
  actor: {
    id: Id;
    name: string;
    spot_id: Id;
    x: number;
    y: number;
    transit: { to_spot_id: Id; to_spot_name: string; destination_spot_id: Id; destination_name: string; progress: number } | null;
  };
  presences: BoardPresence[];
  /**
   * Localizaciones con el plano ya hecho o en preparación: las vecinas por las
   * salidas que ve el PJ y su destino si va de camino. Hueco para que la página
   * pueda pedirlas por adelantado si algún día hiciera falta.
   */
  neighbors: Id[];
}

export function boardState(engine: Engine, characterId: Id): BoardState {
  const world = engine.world;
  const c = world.character(characterId);
  const nowG = engine.gameNow();
  const pos = positionOf(world, c, nowG);
  const loc = world.location(pos.location_id);

  const visible = world.spotsOf(loc.id).filter((s) => !s.hidden || s.discovered_by.includes(c.id));
  const visibleIds = new Set(visible.map((s) => s.id));

  const spots: BoardSpot[] = visible.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    x: s.x,
    y: s.y,
    items: world.itemsIn({ type: 'spot', id: s.id }).map((i) => {
      const d = world.itemDef(i.item_id);
      return i.quantity > 1 ? `${d.name} ×${i.quantity}` : d.name;
    }),
    nodes: [...world.resourceNodes.values()].filter((n) => n.spot_id === s.id).map((n) => describeNode(n, nowG)),
  }));

  const exits: BoardExit[] = [];
  for (const s of visible) {
    for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
      const toSpot = world.spot(to_spot_id);
      const dest = world.location(toSpot.location_id);
      const blockedBy = exit.state.blocked_by ? String(exit.state.blocked_by) : exit.state.locked ? 'cerrada con llave' : null;
      exits.push({
        id: exit.id,
        from_spot_id: s.id,
        to_location_id: dest.id,
        to_location_name: dest.name,
        to_spot_id: toSpot.id,
        to_spot_name: toSpot.name,
        distance_m: exit.distance_m,
        blocked: blockedBy !== null,
        blocked_by: blockedBy,
      });
    }
  }

  const presences: BoardPresence[] = [];
  for (const other of world.characters.values()) {
    if (other.id === c.id || other.status === 'dead' || other.status === 'retired') continue;
    const opos = positionOf(world, other, nowG);
    if (opos.location_id !== loc.id || !visibleIds.has(opos.spot_id)) continue;
    const p = perceive(world, engine.clock, c, opos, nowG);
    if (p.level === 'none') continue;
    presences.push({
      id: other.id, kind: 'character', spot_id: opos.spot_id, x: opos.x, y: opos.y, level: p.level,
      label: labelFor(p.level, c.knows.includes(other.id) ? other.name : descriptorOf(world, other.id)),
      asleep: other.status === 'asleep', moving: other.transit !== null,
    });
  }
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive') continue;
    const ns = world.spot(n.location.id);
    if (ns.location_id !== loc.id || !visibleIds.has(ns.id)) continue;
    const p = perceive(world, engine.clock, c, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowG);
    if (p.level === 'none') continue;
    presences.push({
      id: n.id, kind: 'npc', spot_id: ns.id, x: ns.x, y: ns.y, level: p.level,
      label: labelFor(p.level, c.knows.includes(n.id) ? n.name : descriptorOf(world, n.id)),
      asleep: false, moving: false,
    });
  }

  let transit: BoardState['actor']['transit'] = null;
  if (c.transit && pos.next_spot_id) {
    const next = world.spot(pos.next_spot_id);
    const dest = world.spot(c.transit.destination_spot_id);
    transit = { to_spot_id: next.id, to_spot_name: next.name, destination_spot_id: dest.id, destination_name: dest.name, progress: pos.progress };
  }

  const cache = mapCacheOf(engine);
  const base = cache.get(loc.id);
  const neighbors = cache.neighborsOf(loc.id, visibleIds);
  const destLoc = c.transit ? world.spots.get(c.transit.destination_spot_id)?.location_id : undefined;
  if (destLoc && destLoc !== loc.id && !neighbors.includes(destLoc)) neighbors.push(destLoc);
  cache.preloadFor(c.id);

  return {
    location: { id: loc.id, name: loc.name, description: loc.description_base, light: lightAt(engine.clock, loc, nowG), indoor: loc.indoor },
    // Primero lo que ve (puntos ocultos), luego lo que ya conoce (muebles de los puntos donde ha estado o hecho algo).
    map: revealMap(clipMap(base.map, visible, base.generated), visible, revealTrackerOf(engine).seenBy(c.id), pos.spot_id),
    spots,
    exits,
    actor: { id: c.id, name: c.name, spot_id: pos.spot_id, x: pos.x, y: pos.y, transit },
    presences,
    neighbors,
  };
}

/**
 * Plano de la localización para este PJ: el de la demo si existe, si no uno
 * generado de sus puntos visibles. Sin caché; el tablero usa la de mapcache.
 */
export function mapFor(loc: Location, visibleSpots: Spot[], maps: Record<Id, LocationMap> = DEMO_MAPS): LocationMap {
  const hand = maps[loc.id];
  if (hand) return clipMap(hand, visibleSpots, false);
  return clipMap(generateMap({ location: loc, spots: visibleSpots }), visibleSpots, true);
}

/**
 * Recorta el plano a lo que ve el PJ: quita lo que pide un punto que no ve y
 * ajusta los límites. Uno dibujado a mano se ciñe a lo que queda si se quitó
 * algo (un hueco vacío delataría el cuarto oculto); uno generado ya no cuenta
 * lo oculto en sus límites, y crece con lo que se descubre. Siempre caben
 * todos los puntos visibles.
 */
export function clipMap(base: LocationMap, visibleSpots: Spot[], generated: boolean): LocationMap {
  const ids = new Set(visibleSpots.map((s) => s.id));
  const ok = (r: { requires_spot?: Id }) => !r.requires_spot || ids.has(r.requires_spot);
  const strip = <T extends { requires_spot?: Id }>(xs: T[]): T[] =>
    xs.filter(ok).map((x) => { const { requires_spot: _r, ...rest } = x; return rest as T; });
  const out: LocationMap = { ...base, areas: strip(base.areas), walls: strip(base.walls), doors: strip(base.doors), props: strip(base.props) };
  const hiddenSomething = out.areas.length + out.walls.length + out.doors.length + out.props.length
    < base.areas.length + base.walls.length + base.doors.length + base.props.length;
  if (generated) out.bounds = grow(base.bounds, mapExtent(out));
  else if (hiddenSomething) out.bounds = shrinkBounds(out, visibleSpots);
  out.bounds = grow(out.bounds, visibleSpots.flatMap((s): MapPoint[] => [[s.x - SPOT_PAD, s.y - SPOT_PAD], [s.x + SPOT_PAD, s.y + SPOT_PAD]]));
  return out;
}

/** Aire alrededor de cada punto: que su ficha no quede cortada en el borde. */
const SPOT_PAD = 1.2;

function grow(b: LocationMap['bounds'], pts: MapPoint[]): LocationMap['bounds'] {
  if (!pts.length) return b;
  const x0 = Math.min(b.x, ...pts.map((p) => p[0])), y0 = Math.min(b.y, ...pts.map((p) => p[1]));
  const x1 = Math.max(b.x + b.w, ...pts.map((p) => p[0])), y1 = Math.max(b.y + b.h, ...pts.map((p) => p[1]));
  if (x0 === b.x && y0 === b.y && x1 === b.x + b.w && y1 === b.y + b.h) return b;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Lo dibujado a mano, ceñido a lo que queda tras quitar lo oculto. */
function shrinkBounds(m: LocationMap, spots: Spot[]): LocationMap['bounds'] {
  const pts: MapPoint[] = [...spots.map((s): MapPoint => [s.x, s.y]), ...mapExtent(m)];
  const pad = 1.2, b = m.bounds;
  const x0 = Math.max(b.x, Math.min(...pts.map((p) => p[0])) - pad);
  const y0 = Math.max(b.y, Math.min(...pts.map((p) => p[1])) - pad);
  const x1 = Math.min(b.x + b.w, Math.max(...pts.map((p) => p[0])) + pad);
  const y1 = Math.min(b.y + b.h, Math.max(...pts.map((p) => p[1])) + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function labelFor(level: PerceptionLevel, full: string): string {
  if (level === 'full') return full;
  if (level === 'vague') return 'figura';
  return 'movimiento';
}

export function handleBoardRequest(engine: Engine, _req: IncomingMessage, res: ServerResponse, url: URL): void {
  const id = url.searchParams.get('character');
  if (!id || !engine.world.characters.has(id)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, text: 'No existe ese personaje.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(boardState(engine, id)));
}
