/**
 * Mapa de zona y de región (web): el grafo de localizaciones y zonas con lo
 * que cada PJ conoce, dispuesto solo a partir de los datos de la partida
 * (nada dibujado a mano; vale para la demo y para cualquier mundo generado).
 *
 *   GET /api/map?character=ID
 *
 * Qué se dibuja (por PJ):
 *   - visited:  `loc.discovery[pj] === 'visited'` (lo pone el motor al llegar).
 *   - heard_of: `discovery === 'heard_of'` (semilla o `places_learned` del
 *               máster), o destino de una salida que parte de una localización
 *               visitada (la misma regla que aliases.ts y el tablero, que ya
 *               enseñan el nombre del destino), o donde está otro jugador.
 *   - lo demás no existe para él.
 *
 * Dos vistas con los mismos datos: la zona del PJ (sus localizaciones y las
 * vecinas directas de otras zonas, marcadas `outside`) y la región (sus zonas,
 * con los caminos entre zonas agregados por par).
 *
 * Disposición: muelles sobre el grafo COMPLETO de la zona o la región, con
 * semilla fija, y luego se filtra a lo conocido: descubrir un lugar no mueve
 * los demás. Se cachea por motor y se invalida si cambian localizaciones,
 * zonas o salidas.
 *
 * Presencias: solo personajes. El actor (`self`), los otros jugadores siempre
 * (`ally`, son el grupo) y los NPC que el actor percibe en su localización
 * (`hostile` si su actitud hacia él es hostil, `ally` si no).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../../engine/engine.js';
import type { Character, Id, PerceptionLevel } from '../../engine/model.js';
import type { World } from '../../engine/world.js';
import { attitudeOf } from '../../engine/combat.js';
import { positionOf } from '../../engine/movement.js';
import { descriptorOf } from '../../engine/narrate.js';
import { perceive } from '../../engine/perception.js';
import { classifyPlace, rng, type PlaceKind } from './mapgen.js';

export type Known = 'visited' | 'heard_of';

export interface MapNode {
  id: Id;
  name: string;
  kind: PlaceKind;
  known: Known;
  /** Unidades abstractas de la disposición (no metros); la página escala. */
  x: number;
  y: number;
  here: boolean;
  /** Vista de zona: localización conocida de otra zona, unida por salida directa. */
  outside?: boolean;
  /** Vista de zona: zona a la que pertenece la localización. */
  zone_id?: Id;
}

export interface MapEdge {
  id: Id;
  from: Id;
  to: Id;
  distance_m: number;
  blocked: boolean;
}

export interface MapBounds { x: number; y: number; w: number; h: number }

export interface MapView { nodes: MapNode[]; edges: MapEdge[]; bounds: MapBounds }

export interface MapTransit {
  from_location_id: Id;
  to_location_id: Id;
  from_zone_id: Id;
  to_zone_id: Id;
  progress: number;
}

export interface MapPresence {
  id: Id;
  kind: 'character' | 'npc';
  relation: 'self' | 'ally' | 'hostile';
  label: string;
  location_id: Id;
  zone_id: Id;
  /** El actor lo percibe ahora (los otros jugadores van aunque no). */
  seen: boolean;
  level: PerceptionLevel;
  moving: boolean;
  /** De camino entre dos localizaciones (si va dentro de una, null). */
  transit: MapTransit | null;
}

export interface RegionMapState {
  region: { id: Id; name: string };
  zone: { id: Id; name: string; kind: string } & MapView;
  world: MapView;
  actor: { id: Id; name: string; location_id: Id; zone_id: Id; transit: MapTransit | null };
  presences: MapPresence[];
}

// ---------------------------------------------------------------------------
// Conocimiento
// ---------------------------------------------------------------------------

/**
 * Lo que un PJ conoce de cada localización. `extra` son localizaciones que se
 * dan por conocidas de oídas aunque no lo diga el mundo (donde están sus compañeros).
 */
export function knowledgeOf(world: World, c: Character, extra: Iterable<Id> = []): Map<Id, Known> {
  const out = new Map<Id, Known>();
  for (const loc of world.locations.values()) {
    const d = loc.discovery[c.id];
    if (d === 'visited' || d === 'heard_of') out.set(loc.id, d);
  }
  for (const [id, k] of [...out]) {
    if (k !== 'visited') continue;
    for (const s of world.spotsOf(id)) {
      for (const { to_spot_id } of world.exitsFrom(s.id)) {
        const dest = world.spots.get(to_spot_id)?.location_id;
        if (dest && !out.has(dest)) out.set(dest, 'heard_of');
      }
    }
  }
  for (const id of extra) if (world.locations.has(id) && !out.has(id)) out.set(id, 'heard_of');
  return out;
}

function best(a: Known | undefined, b: Known | undefined): Known | undefined {
  if (a === 'visited' || b === 'visited') return 'visited';
  return a ?? b;
}

// ---------------------------------------------------------------------------
// Disposición
// ---------------------------------------------------------------------------

export interface LayoutEdge { from: Id; to: Id; distance_m: number }

/** Separación de referencia entre nodos, en unidades de la disposición. */
const K = 12;
const ITERATIONS = 300;

/** Longitud ideal de un camino: crece con el logaritmo de la distancia real, para que 3 m y 600 m quepan en el mismo dibujo. */
export function idealLength(distanceM: number): number {
  return K * (0.8 + Math.log10(1 + Math.max(0, distanceM)));
}

/**
 * Coloca los nodos de un grafo por muelles (Fruchterman-Reingold con longitud
 * ideal por arista). Determinista: mismo grafo y misma semilla, mismas
 * coordenadas. Los nodos se tratan en orden alfabético de id.
 */
export function layoutGraph(ids: Iterable<Id>, edges: LayoutEdge[], seed: string): Map<Id, { x: number; y: number }> {
  const order = [...new Set(ids)].sort();
  const n = order.length;
  const pos = new Map<Id, { x: number; y: number }>();
  if (n === 0) return pos;
  if (n === 1) { pos.set(order[0]!, { x: 0, y: 0 }); return pos; }
  const rand = rng(`layout:${seed}`);
  const index = new Map(order.map((id, i) => [id, i]));
  const radius = K * Math.max(1.5, n * 0.5);
  const x = order.map((_, i) => radius * Math.cos((2 * Math.PI * i) / n) + (rand() - 0.5) * K * 0.5);
  const y = order.map((_, i) => radius * Math.sin((2 * Math.PI * i) / n) + (rand() - 0.5) * K * 0.5);
  const springs = edges
    .filter((e) => index.has(e.from) && index.has(e.to) && e.from !== e.to)
    .map((e) => ({ a: index.get(e.from)!, b: index.get(e.to)!, len: idealLength(e.distance_m) }));
  const dx = new Array<number>(n).fill(0), dy = new Array<number>(n).fill(0);
  for (let it = 0; it < ITERATIONS; it++) {
    const temp = K * 2 * (1 - it / ITERATIONS) + 0.1;
    dx.fill(0); dy.fill(0);
    // Repulsión entre todos: separa componentes y evita solapes.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = x[i]! - x[j]!, vy = y[i]! - y[j]!;
        let d = Math.hypot(vx, vy);
        if (d < 0.01) { vx = 0.01 * (i - j); vy = 0.01; d = Math.hypot(vx, vy); }
        const f = (K * K) / d;
        dx[i]! += (vx / d) * f; dy[i]! += (vy / d) * f;
        dx[j]! -= (vx / d) * f; dy[j]! -= (vy / d) * f;
      }
    }
    // Muelles: cada camino tira hacia su longitud ideal.
    for (const s of springs) {
      const vx = x[s.b]! - x[s.a]!, vy = y[s.b]! - y[s.a]!;
      const d = Math.max(0.01, Math.hypot(vx, vy));
      const f = ((d - s.len) * d) / s.len;
      dx[s.a]! += (vx / d) * f; dy[s.a]! += (vy / d) * f;
      dx[s.b]! -= (vx / d) * f; dy[s.b]! -= (vy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(dx[i]!, dy[i]!);
      if (d < 0.001) continue;
      const step = Math.min(d, temp);
      x[i]! += (dx[i]! / d) * step; y[i]! += (dy[i]! / d) * step;
    }
  }
  // Centrado en el origen y redondeado: coordenadas estables y legibles.
  const cx = x.reduce((a, b) => a + b, 0) / n, cy = y.reduce((a, b) => a + b, 0) / n;
  order.forEach((id, i) => pos.set(id, { x: Math.round((x[i]! - cx) * 100) / 100, y: Math.round((y[i]! - cy) * 100) / 100 }));
  return pos;
}

/** Cuadro que contiene los nodos, con aire alrededor. */
function boundsOf(nodes: { x: number; y: number }[], pad = K * 0.9): MapBounds {
  if (!nodes.length) return { x: -pad, y: -pad, w: 2 * pad, h: 2 * pad };
  const x0 = Math.min(...nodes.map((p) => p.x)) - pad, x1 = Math.max(...nodes.map((p) => p.x)) + pad;
  const y0 = Math.min(...nodes.map((p) => p.y)) - pad, y1 = Math.max(...nodes.map((p) => p.y)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------------------
// Caché de disposiciones por motor
// ---------------------------------------------------------------------------

type EngineLike = Pick<Engine, 'world'>;

class LayoutCache {
  private readonly layouts = new Map<string, Map<Id, { x: number; y: number }>>();
  /** Disposiciones calculadas desde que existe la caché (tests y diagnóstico). */
  computed = 0;

  constructor(engine: EngineLike) {
    engine.world.onChange(({ collection }) => {
      if (collection === 'locations' || collection === 'zones' || collection === 'exits' || collection === 'spots') this.layouts.clear();
    });
  }

  get(key: string, build: () => Map<Id, { x: number; y: number }>): Map<Id, { x: number; y: number }> {
    let l = this.layouts.get(key);
    if (!l) { l = build(); this.layouts.set(key, l); this.computed++; }
    return l;
  }
}

const caches = new WeakMap<object, LayoutCache>();

export function layoutCacheOf(engine: EngineLike): LayoutCache {
  let c = caches.get(engine);
  if (!c) caches.set(engine, (c = new LayoutCache(engine)));
  return c;
}

// ---------------------------------------------------------------------------
// Estado del mapa
// ---------------------------------------------------------------------------

function isBlocked(e: { state: { blocked_by?: string; locked?: boolean } }): boolean {
  return Boolean(e.state.blocked_by) || e.state.locked === true;
}

/** Salidas como aristas entre localizaciones (una por salida, con su distancia). */
function locationEdges(world: World): (MapEdge & { from_zone: Id; to_zone: Id })[] {
  const out: (MapEdge & { from_zone: Id; to_zone: Id })[] = [];
  for (const e of world.exits.values()) {
    const a = world.spots.get(e.from_spot_id), b = world.spots.get(e.to_spot_id);
    if (!a || !b || a.location_id === b.location_id) continue;
    const la = world.locations.get(a.location_id), lb = world.locations.get(b.location_id);
    if (!la || !lb) continue;
    out.push({ id: e.id, from: la.id, to: lb.id, distance_m: e.distance_m, blocked: isBlocked(e), from_zone: la.zone_id, to_zone: lb.zone_id });
  }
  return out;
}

function labelFor(level: PerceptionLevel, full: string): string {
  if (level === 'full') return full;
  if (level === 'vague') return 'figura';
  return 'movimiento';
}

export function regionMapState(engine: Engine, characterId: Id): RegionMapState {
  const world = engine.world;
  const c = world.character(characterId);
  const nowG = engine.gameNow();
  const pos = positionOf(world, c, nowG);
  const hereLoc = world.location(pos.location_id);
  const hereZone = world.zone(hereLoc.zone_id);
  const region = world.regions.get(hereZone.region_id) ?? { id: hereZone.region_id, name: hereZone.region_id };
  const zoneOf = (locId: Id) => world.location(locId).zone_id;

  // Los otros jugadores revelan dónde están.
  const others = [...world.characters.values()].filter((o) => o.id !== c.id && o.status !== 'dead' && o.status !== 'retired');
  const otherPos = new Map(others.map((o) => [o.id, positionOf(world, o, nowG)]));
  const known = knowledgeOf(world, c, [...otherPos.values()].map((p) => p.location_id));

  const allEdges = locationEdges(world);
  const cache = layoutCacheOf(engine);

  // --- Vista de zona: todas las localizaciones de la zona y las vecinas directas de otras zonas.
  const zoneLocIds = new Set([...world.locations.values()].filter((l) => l.zone_id === hereZone.id).map((l) => l.id));
  const zoneGraphIds = new Set(zoneLocIds);
  for (const e of allEdges) {
    if (zoneLocIds.has(e.from) && !zoneLocIds.has(e.to)) zoneGraphIds.add(e.to);
    if (zoneLocIds.has(e.to) && !zoneLocIds.has(e.from)) zoneGraphIds.add(e.from);
  }
  const zoneEdgesAll = allEdges.filter((e) => zoneGraphIds.has(e.from) && zoneGraphIds.has(e.to));
  const zoneLayout = cache.get(`zone:${hereZone.id}`, () => layoutGraph(zoneGraphIds, zoneEdgesAll, hereZone.id));
  const zoneNodes: MapNode[] = [];
  for (const id of [...zoneGraphIds].sort()) {
    const k = known.get(id);
    if (!k) continue;
    const loc = world.location(id);
    const p = zoneLayout.get(id)!;
    const node: MapNode = { id, name: loc.name, kind: classifyPlace(loc.name, world.zones.get(loc.zone_id)?.kind, loc.indoor), known: k, x: p.x, y: p.y, here: id === hereLoc.id, zone_id: loc.zone_id };
    if (!zoneLocIds.has(id)) node.outside = true;
    zoneNodes.push(node);
  }
  const zoneEdges: MapEdge[] = zoneEdgesAll
    .filter((e) => known.has(e.from) && known.has(e.to))
    .map(({ id, from, to, distance_m, blocked }) => ({ id, from, to, distance_m, blocked }));

  // --- Vista de región: zonas y caminos entre zonas agregados por par.
  const regionZones = [...world.zones.values()].filter((z) => z.region_id === region.id);
  const regionZoneIds = new Set(regionZones.map((z) => z.id));
  const pairs = new Map<string, { from: Id; to: Id; distance_m: number; blocked: boolean }>();
  for (const e of allEdges) {
    if (e.from_zone === e.to_zone || !regionZoneIds.has(e.from_zone) || !regionZoneIds.has(e.to_zone)) continue;
    const [a, b] = e.from_zone < e.to_zone ? [e.from_zone, e.to_zone] : [e.to_zone, e.from_zone];
    const key = `${a}|${b}`;
    const cur = pairs.get(key);
    if (!cur) pairs.set(key, { from: a, to: b, distance_m: e.distance_m, blocked: e.blocked });
    else { cur.distance_m = Math.min(cur.distance_m, e.distance_m); cur.blocked = cur.blocked && e.blocked; }
  }
  const regionLayout = cache.get(`region:${region.id}`, () => layoutGraph(regionZoneIds, [...pairs.values()], region.id));
  const zoneKnown = new Map<Id, Known>();
  for (const [locId, k] of known) {
    const z = zoneOf(locId);
    if (regionZoneIds.has(z)) zoneKnown.set(z, best(zoneKnown.get(z), k)!);
  }
  const worldNodes: MapNode[] = [];
  for (const z of [...regionZones].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const k = zoneKnown.get(z.id);
    if (!k) continue;
    const p = regionLayout.get(z.id)!;
    worldNodes.push({ id: z.id, name: z.name, kind: classifyPlace(z.name, z.kind), known: k, x: p.x, y: p.y, here: z.id === hereZone.id });
  }
  const worldEdges: MapEdge[] = [...pairs.entries()]
    .filter(([, e]) => zoneKnown.has(e.from) && zoneKnown.has(e.to))
    .map(([key, e]) => ({ id: key, ...e }));

  // --- Presencias.
  const transitOf = (ch: Character, p: ReturnType<typeof positionOf>): MapTransit | null => {
    if (!ch.transit || !p.next_spot_id) return null;
    const next = world.spot(p.next_spot_id);
    if (next.location_id === p.location_id) return null;
    return { from_location_id: p.location_id, to_location_id: next.location_id, from_zone_id: zoneOf(p.location_id), to_zone_id: zoneOf(next.location_id), progress: p.progress };
  };
  const actorTransit = transitOf(c, pos);
  const presences: MapPresence[] = [{
    id: c.id, kind: 'character', relation: 'self', label: c.name, location_id: hereLoc.id, zone_id: hereZone.id,
    seen: true, level: 'full', moving: c.transit !== null, transit: actorTransit,
  }];
  const visibleSpotIds = new Set(world.spotsOf(hereLoc.id).filter((s) => !s.hidden || s.discovered_by.includes(c.id)).map((s) => s.id));
  for (const o of others) {
    const op = otherPos.get(o.id)!;
    const p = op.location_id === hereLoc.id && visibleSpotIds.has(op.spot_id) ? perceive(world, engine.clock, c, op, nowG) : null;
    presences.push({
      id: o.id, kind: 'character', relation: 'ally', label: o.name, location_id: op.location_id, zone_id: zoneOf(op.location_id),
      seen: p !== null && p.level !== 'none', level: p?.level ?? 'none', moving: o.transit !== null, transit: transitOf(o, op),
    });
  }
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive') continue;
    const ns = world.spot(n.location.id);
    if (ns.location_id !== hereLoc.id || !visibleSpotIds.has(ns.id)) continue;
    const p = perceive(world, engine.clock, c, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowG);
    if (p.level === 'none') continue;
    presences.push({
      id: n.id, kind: 'npc', relation: attitudeOf(n, c.id) === 'hostile' ? 'hostile' : 'ally',
      label: labelFor(p.level, c.knows.includes(n.id) ? n.name : descriptorOf(world, n.id)),
      location_id: hereLoc.id, zone_id: hereZone.id, seen: true, level: p.level, moving: false, transit: null,
    });
  }

  return {
    region: { id: region.id, name: region.name },
    zone: { id: hereZone.id, name: hereZone.name, kind: hereZone.kind, nodes: zoneNodes, edges: zoneEdges, bounds: boundsOf(zoneNodes) },
    world: { nodes: worldNodes, edges: worldEdges, bounds: boundsOf(worldNodes) },
    actor: { id: c.id, name: c.name, location_id: hereLoc.id, zone_id: hereZone.id, transit: actorTransit },
    presences,
  };
}

export function handleMapRequest(engine: Engine, _req: IncomingMessage, res: ServerResponse, url: URL): void {
  const id = url.searchParams.get('character');
  if (!id || !engine.world.characters.has(id)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, text: 'No existe ese personaje.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(regionMapState(engine, id)));
}
