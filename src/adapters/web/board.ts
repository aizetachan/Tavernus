/**
 * Tablero de la localización actual (web): datos planos desde el motor, sin
 * IA. La página los pinta como SVG. Solo lo que el PJ puede saber: puntos no
 * ocultos (o descubiertos por él) y presentes filtrados por su percepción.
 * El plano sale de la caché (mapcache.ts, generado por mapgen.ts con la
 * semilla de la campaña) y se recorta aquí a lo que ve el PJ.
 *
 *   GET /api/board?character=ID[&mapseed=N]
 *   GET /api/board/background?character=ID   fondo pintado del plano donde está el PJ (JPEG), si lo hay
 *
 * `mapseed` (depuración): genera el plano con esa semilla, sin caché ni tocar
 * la campaña. Vale también en la URL de la página (`/play?game=…&mapseed=7`):
 * se lee del Referer de la petición del tablero.
 *
 * Ruta en server.ts: añade esta línea junto a la de /api/sheet (dentro de `handle`):
 *   if (req.method === 'GET' && url.pathname === '/api/board') { handleBoardRequest(engine, req, res, url); return; }
 */

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../../engine/engine.js';
import type { Id, LightLevel, Location, PerceptionLevel, Spot } from '../../engine/model.js';
import { positionOf } from '../../engine/movement.js';
import { descriptorOf } from '../../engine/narrate.js';
import { lightAt, perceive } from '../../engine/perception.js';
import { describeNode } from '../../engine/resources.js';
import type { LocationMap, MapPoint } from '../../data/seed/maps.js';
import { assetsFor, writtenMapBackground } from '../../ai/assets.js';
import { mapCacheOf } from './mapcache.js';
import { generateMap, mapExtent, mapInputOf } from './mapgen.js';
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
  /**
   * Fondo pintado del plano (docs/ARTE.md), o null. Cubre `bounds`, los del plano escrito, que ya incluyen lo
   * oculto: así no se mueve al descubrir algo. Lleva el suelo, las paredes y los muebles; lo oculto no (`secret`).
   */
  background: { src: string; bounds: LocationMap['bounds'] } | null;
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

export interface BoardOptions {
  /** Depuración: semilla del plano en vez de la de la campaña (sin caché). */
  mapSeed?: number | undefined;
}

export function boardState(engine: Engine, characterId: Id, opts: BoardOptions = {}): BoardState {
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
  const base = opts.mapSeed === undefined ? cache.get(loc.id).map : generateMap(mapInputOf(world, loc.id, opts.mapSeed));
  const neighbors = cache.neighborsOf(loc.id, visibleIds);
  const destLoc = c.transit ? world.spots.get(c.transit.destination_spot_id)?.location_id : undefined;
  if (destLoc && destLoc !== loc.id && !neighbors.includes(destLoc)) neighbors.push(destLoc);
  cache.preloadFor(c.id);
  const painted = opts.mapSeed === undefined && writtenMapBackground(assetsFor(world.campaign.id), world.campaign.id, loc.id);

  return {
    location: { id: loc.id, name: loc.name, description: loc.description_base, light: lightAt(engine.clock, loc, nowG), indoor: loc.indoor },
    // Primero lo que ve (puntos ocultos), luego lo que ya conoce (muebles de los puntos donde ha estado o hecho algo).
    map: revealMap(clipMap(base, visible), visible, revealTrackerOf(engine).seenBy(c.id), pos.spot_id),
    background: painted ? { src: `/api/board/background?character=${encodeURIComponent(c.id)}&loc=${encodeURIComponent(loc.id)}`, bounds: base.bounds } : null,
    spots,
    exits,
    actor: { id: c.id, name: c.name, spot_id: pos.spot_id, x: pos.x, y: pos.y, transit },
    presences,
    neighbors,
  };
}

/**
 * Plano de la localización para este PJ, generado de sus puntos visibles con
 * la semilla dada. Sin caché; el tablero usa la de mapcache.
 */
export function mapFor(loc: Location, visibleSpots: Spot[], seed = 0): LocationMap {
  return clipMap(generateMap({ location: loc, spots: visibleSpots, seed }), visibleSpots);
}

/**
 * Recorta el plano a lo que ve el PJ: quita lo que pide un punto que no ve.
 * Lo que pedía un punto que ya ve queda marcado `secret` (el fondo pintado no
 * lo lleva y la página lo dibuja encima). Los límites del plano ya no cuentan
 * lo oculto; crecen con lo que se descubre, y siempre caben todos los puntos
 * visibles.
 */
export function clipMap(base: LocationMap, visibleSpots: Spot[]): LocationMap {
  const ids = new Set(visibleSpots.map((s) => s.id));
  const ok = (r: { requires_spot?: Id }) => !r.requires_spot || ids.has(r.requires_spot);
  const strip = <T extends { requires_spot?: Id }>(xs: T[]): T[] =>
    xs.filter(ok).map((x) => { const { requires_spot: r, ...rest } = x; return (r ? { ...rest, secret: true } : rest) as T; });
  const out: LocationMap = { ...base, areas: strip(base.areas), walls: strip(base.walls), doors: strip(base.doors), props: strip(base.props) };
  out.bounds = grow(base.bounds, mapExtent(out));
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

function labelFor(level: PerceptionLevel, full: string): string {
  if (level === 'full') return full;
  if (level === 'vague') return 'figura';
  return 'movimiento';
}

export function handleBoardRequest(engine: Engine, req: IncomingMessage, res: ServerResponse, url: URL): void {
  const id = url.searchParams.get('character');
  if (!id || !engine.world.characters.has(id)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, text: 'No existe ese personaje.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(boardState(engine, id, { mapSeed: mapSeedParam(url, req) })));
}

/** Fondo pintado del plano donde está el PJ; 404 si no hay. `loc` solo sirve para que la caché cambie al cambiar de sitio. */
export async function handleBoardBackgroundRequest(engine: Engine, res: ServerResponse, url: URL): Promise<void> {
  const id = url.searchParams.get('character');
  const world = engine.world;
  const c = id ? world.characters.get(id) : undefined;
  const loc = c ? positionOf(world, c, engine.gameNow()).location_id : null;
  const file = loc ? writtenMapBackground(assetsFor(world.campaign.id), world.campaign.id, loc) : null;
  let bytes: Buffer | null = null;
  if (file) { try { bytes = await readFile(file); } catch { /* sin fichero */ } }
  if (!bytes) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, text: 'Sin fondo.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' });
  res.end(bytes);
}

/** `mapseed` de la consulta o, si no, de la página que pide el tablero (Referer). */
function mapSeedParam(url: URL, req: IncomingMessage): number | undefined {
  let raw = url.searchParams.get('mapseed');
  const ref = req.headers?.referer;
  if (raw === null && ref) { try { raw = new URL(ref).searchParams.get('mapseed'); } catch { /* sin Referer válido */ } }
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : undefined;
}
