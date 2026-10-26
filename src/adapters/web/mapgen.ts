/**
 * Plano de cada localización, generado de los datos del motor: no hay planos
 * dibujados a mano. Sin IA: sale de interior o exterior, ambiente, zona,
 * nombre, alias y etiquetas de cada punto, y de una semilla (la del mundo, o
 * un hash estable del id de la campaña). Reconoce el tipo de lugar (taberna,
 * casa, tienda, plaza, calle, bosque, cueva, muelle; si no, interior o
 * exterior genérico) y aplica su plantilla de variación: forma y holgura de
 * la sala o del área, suelo, tabiques y puertas, muebles de relleno y
 * ambiente (charcos, hierba, chimenea encendida o apagada). Cada punto pone
 * su mueble del catálogo al lado, enlazado con `spot_id`.
 *
 * Determinista: misma semilla y mismos datos, mismo plano; otra semilla, otro
 * plano con los mismos puntos. Rápido: milisegundos.
 *
 * Lo que no cambia con la semilla: nada se pone encima de un punto visible ni
 * en el camino recto entre dos de ellos (ni entre un punto y su puerta o su
 * borde de salida), y cada salida es una puerta o un hueco en el borde más
 * cercano a su punto.
 *
 * Lo que sale de un punto oculto lleva `requires_spot` y no cuenta para los
 * límites ni empuja a los demás muebles; el relleno, los tabiques y el
 * ambiente tampoco lo tienen en cuenta. Si el PJ no lo ha descubierto, el
 * tablero lo quita y el plano queda igual que si ese punto no existiera.
 */

import { seededRng, type Rng } from '../../engine/dice.js';
import type { Id } from '../../engine/model.js';
import type { World } from '../../engine/world.js';
import { rect, type Ground, type LocationMap, type MapArea, type MapPoint, type MapProp, type PropKind } from '../../data/seed/maps.js';

export interface MapGenSpot { id: Id; name: string; aliases: string[]; tags: string[]; x: number; y: number; hidden: boolean }
export interface MapGenInput {
  location: { id: Id; name: string; indoor: boolean; ambience?: { light?: string; smell?: string }; tags?: string[] };
  zone?: { name: string; kind: string } | null;
  spots: MapGenSpot[];
  /** Salidas desde puntos de esta localización. */
  exits?: { id: Id; from_spot_id: Id; to_location_id: Id; to_location_name: string }[];
  /** Semilla del mundo: con los mismos datos, cada semilla da otro plano. Sin ella, 0. */
  seed?: number;
}

/**
 * Semilla de los planos de una campaña: la del mundo si la tiene (la del
 * generador de mundos, `generation.seed`), si no un hash estable de su id.
 */
export function mapSeedOf(world: World): number {
  const c = world.campaign as unknown as { id: Id; world_seed?: unknown; seed?: unknown; generation?: { seed?: unknown } };
  const s = c.world_seed ?? c.seed ?? c.generation?.seed;
  if (typeof s === 'number' && Number.isFinite(s)) return Math.trunc(s) >>> 0;
  return hash(typeof s === 'string' && s ? s : c.id);
}

/** Lo que el generador lee del mundo para una localización. */
export function mapInputOf(world: World, locationId: Id, seed: number = mapSeedOf(world)): MapGenInput {
  const loc = world.location(locationId);
  const spots = world.spotsOf(loc.id);
  const exits: NonNullable<MapGenInput['exits']> = [];
  for (const s of spots) {
    for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
      const to = world.spots.get(to_spot_id);
      const dest = to && world.locations.get(to.location_id);
      if (dest && dest.id !== loc.id) exits.push({ id: exit.id, from_spot_id: s.id, to_location_id: dest.id, to_location_name: dest.name });
    }
  }
  // Etiquetas y tipo de plantilla de la localización si el mundo los tiene (los del generador de mundos).
  const extra = loc as unknown as { tags?: unknown; kind?: unknown };
  const tags = [...(Array.isArray(extra.tags) ? extra.tags.map(String) : []), ...(typeof extra.kind === 'string' ? [extra.kind] : [])];
  // Un tramo de camino (travel.ts) se llama «Camino entre <A> y <B>»: sus nombres («Plaza…») no dicen cómo es él.
  // Se plantea como camino de su zona (la más agreste de las dos).
  const name = loc.state['waypoint'] ? 'camino' : loc.name;
  return { location: { ...loc, name, tags }, zone: world.zones.get(loc.zone_id) ?? null, spots, exits, seed };
}

type Feature = PropKind | 'water' | 'pond' | 'dirt' | 'gate';
type Box = { x0: number; y0: number; x1: number; y1: number };
type Side = 'n' | 's' | 'e' | 'w';
type Seg = [MapPoint, MapPoint];
/** Sala: su caja, el entrante si es en L, y el contorno (antihorario). */
interface Room { box: Box; notch: Box | null; poly: MapPoint[] }
interface Occupied { box: Box; hidden: boolean }

/** Palabras (sin tildes) que dan cada elemento; vale también el plural en -s o -es. En orden de dibujo. */
const RULES: [Feature, string[]][] = [
  ['building', ['casa', 'cabana', 'herreria', 'taberna', 'posada', 'tienda', 'establo', 'granero', 'molino', 'templo', 'capilla', 'iglesia', 'torre', 'choza', 'house', 'inn', 'tavern', 'shop', 'smithy']],
  ['water', ['agua', 'arroyo', 'rio', 'riachuelo', 'regato', 'acequia', 'canal', 'stream', 'river', 'water']],
  ['pond', ['charca', 'estanque', 'lago', 'laguna', 'pond', 'lake']],
  ['dirt', ['sendero', 'camino', 'senda', 'vereda', 'trocha', 'path', 'road', 'trail']],
  ['rug', ['alfombra', 'rug']],
  ['counter', ['barra', 'mostrador', 'bar', 'counter']],
  ['fireplace', ['chimenea', 'hogar', 'fogon', 'hoguera', 'fogata', 'brasero', 'fuego', 'fireplace', 'hearth', 'campfire']],
  ['table', ['mesa', 'table']],
  ['bed', ['cama', 'jergon', 'catre', 'litera', 'lecho', 'habitacion', 'dormitorio', 'alcoba', 'bed', 'bedroom']],
  ['well', ['pozo', 'fuente', 'well', 'fountain']],
  ['notice', ['tablon', 'anuncios', 'avisos', 'cartel', 'notice', 'board']],
  ['tree', ['arbol', 'roble', 'fresno', 'pino', 'haya', 'encina', 'olmo', 'sauce', 'castano', 'abeto', 'tree', 'oak']],
  ['rock', ['piedra', 'roca', 'pena', 'penasco', 'penon', 'rock', 'boulder']],
  ['bush', ['arbusto', 'matorral', 'zarza', 'bayas', 'bush']],
  ['barrel', ['barril', 'tonel', 'cuba', 'barrel']],
  ['crate', ['caja', 'cajon', 'crate']],
  ['chest', ['cofre', 'arcon', 'baul', 'chest']],
  ['shelf', ['estante', 'estanteria', 'alacena', 'despensa', 'armario', 'shelf']],
  ['stairs', ['escalera', 'escalinata', 'stairs']],
  ['trapdoor', ['trampilla', 'trapdoor']],
  ['chair', ['silla', 'sillon', 'chair']],
  ['stool', ['taburete', 'banqueta', 'stool']],
  ['gate', ['puerta', 'porton', 'entrada', 'verja', 'muralla', 'door', 'gate']],
];
/** Se dibujan antes que el resto: dan el contorno (puertas, edificios, agua, senderos). */
const FIRST: ReadonlySet<Feature> = new Set<Feature>(['building', 'water', 'dirt', 'gate']);
const STONE = ['cueva', 'caverna', 'gruta', 'mina', 'mazmorra', 'cripta', 'sotano', 'bodega', 'calabozo', 'celda', 'templo', 'castillo', 'torre', 'catacumba', 'cave', 'dungeon', 'crypt', 'cellar'];
const TOWN = ['plaza', 'calle', 'mercado', 'ciudad', 'pueblo', 'aldea', 'villa', 'town', 'city', 'village'];
const SAND = ['desierto', 'playa', 'arena', 'desert', 'beach'];
const FOREST = ['bosque', 'claro', 'arboleda', 'selva', 'forest', 'woods', 'jungle'];
export type PlaceKind = 'town' | 'forest' | 'cave' | 'water' | 'sand' | 'wild' | 'place';
const WILD = ['campo', 'prado', 'colina', 'monte', 'montana', 'valle', 'paramo', 'brezal', 'cumbre', 'ladera', 'pradera', 'field', 'hill', 'mountain', 'valley', 'moor', 'meadow'];
function kindOfWords(t: Set<string>, indoor: boolean): PlaceKind {
  if (hasAny(t, STONE)) return 'cave';
  if (hasAny(t, TOWN) || (indoor && hasAny(t, RULES[0]![1]))) return 'town';
  if (hasAny(t, FOREST)) return 'forest';
  if (hasAny(t, RULES[1]![1]) || hasAny(t, RULES[2]![1])) return 'water';
  if (hasAny(t, SAND)) return 'sand';
  if (hasAny(t, WILD)) return 'wild';
  return 'place';
}
/**
 * Tipo de un lugar (localización o zona) para el mapa de región: primero por
 * su nombre, si no por el tipo de su zona. Mismas listas de palabras que el
 * plano generado. 'place' cuando no se reconoce nada.
 */
export function classifyPlace(name: string, zoneKind?: string | null, indoor = false): PlaceKind {
  const own = kindOfWords(words(name), indoor);
  if (own !== 'place') return own;
  const byZone = zoneKind ? kindOfWords(words(zoneKind), false) : 'place';
  if (byZone !== 'place') return byZone;
  return indoor ? 'town' : 'place';
}

// --- Tipos de lugar y sus plantillas -------------------------------------------

/** Tipo de lugar para el plano; cada uno varía a su manera. */
export type PlaceType = 'tavern' | 'house' | 'shop' | 'square' | 'street' | 'forest' | 'cave' | 'dock' | 'indoor' | 'outdoor';
const PLACE_WORDS: [PlaceType, string[]][] = [
  ['dock', ['muelle', 'puerto', 'embarcadero', 'malecon', 'atracadero', 'darsena', 'dock', 'pier', 'harbor', 'harbour', 'wharf']],
  ['cave', ['cueva', 'caverna', 'gruta', 'mina', 'mazmorra', 'cripta', 'catacumba', 'sotano', 'cave', 'cavern', 'dungeon', 'crypt', 'mine', 'cellar']],
  ['tavern', ['taberna', 'posada', 'meson', 'cantina', 'hosteria', 'tavern', 'inn', 'alehouse', 'pub']],
  ['shop', ['tienda', 'herreria', 'botica', 'taller', 'almacen', 'panaderia', 'comercio', 'shop', 'store', 'smithy', 'forge', 'workshop']],
  ['house', ['casa', 'cabana', 'choza', 'vivienda', 'granja', 'caserio', 'house', 'cabin', 'hut', 'cottage', 'home', 'farmhouse']],
  ['square', ['plaza', 'mercado', 'plazuela', 'square', 'market', 'marketplace']],
  ['street', ['calle', 'callejon', 'avenida', 'ronda', 'arrabal', 'street', 'alley', 'lane', 'avenue']],
  ['forest', ['bosque', 'claro', 'arboleda', 'selva', 'soto', 'forest', 'woods', 'glade', 'clearing', 'jungle']],
];
const INTERIOR: readonly PlaceType[] = ['tavern', 'house', 'shop', 'indoor'];

/**
 * Tipo de lugar de una localización: por su nombre y sus etiquetas, si no por
 * su zona. Un tipo de interior en un exterior (o al revés) cae al más
 * parecido; lo desconocido, a interior o exterior genérico.
 */
export function placeTypeOf(input: Pick<MapGenInput, 'location' | 'zone'>): PlaceType {
  const indoor = input.location.indoor;
  const fit = (t: PlaceType): PlaceType => (t === 'cave' || INTERIOR.includes(t) === indoor ? t : indoor ? 'indoor' : 'square');
  const own = words(input.location.name, ...(input.location.tags ?? []));
  for (const [t, ws] of PLACE_WORDS) if (hasAny(own, ws)) return fit(t);
  const zone = words(input.zone?.name, input.zone?.kind);
  for (const [t, ws] of PLACE_WORDS) if (!INTERIOR.includes(t) && hasAny(zone, ws)) return fit(t);
  if (!indoor && hasAny(zone, TOWN)) return 'street';
  return indoor ? 'indoor' : 'outdoor';
}

type Shape = 'rect' | 'L' | 'irregular';
type Filler = 'round_set' | 'table_set' | 'barrels' | 'crate' | 'shelf' | 'chest' | 'bed' | 'rug' | 'tree' | 'rock' | 'bush';
type Range = [number, number];
interface Template {
  /** Suelo de la sala o del área; null: sin área, se ve el fondo. */
  floors: (Ground | null)[];
  /** Fondo fuera de las áreas (interiores: nada). */
  backgrounds: Ground[];
  shapes: Shape[];
  /** Holgura alrededor de los puntos, por lado (m). */
  margin: Range;
  /** Tabiques que cruzan la sala con un vano, y tabiques cortos desde la pared. */
  dividers: Range;
  stubs: Range;
  /** Relleno y su peso; cuánto por cada 20 m². */
  fill: [Filler, number][];
  density: Range;
  /** Borde exterior: árboles, edificios o rocas; fondo (m) y hueco entre edificios. */
  ring?: { kind: 'tree' | 'building' | 'rock'; depth: Range; gap: Range };
  puddles: Range;
  grass: Range;
  dirt: Range;
}
const NONE: Range = [0, 0];
const TEMPLATES: Record<PlaceType, Template> = {
  tavern: {
    floors: ['wood', 'wood', 'wood', 'stone'], backgrounds: ['void'], shapes: ['rect', 'rect', 'L'], margin: [1.5, 3.75],
    dividers: NONE, stubs: [0, 1], fill: [['round_set', 4], ['table_set', 2], ['barrels', 2], ['rug', 1], ['crate', 1], ['shelf', 1]],
    density: [1, 1.8], puddles: NONE, grass: NONE, dirt: NONE,
  },
  house: {
    floors: ['wood', 'wood', 'stone'], backgrounds: ['void'], shapes: ['rect', 'L', 'L'], margin: [1.5, 3],
    dividers: [0, 1], stubs: [0, 1], fill: [['bed', 2], ['chest', 2], ['shelf', 2], ['table_set', 2], ['rug', 2], ['barrels', 1], ['crate', 1]],
    density: [0.8, 1.4], puddles: NONE, grass: NONE, dirt: NONE,
  },
  shop: {
    floors: ['wood', 'stone'], backgrounds: ['void'], shapes: ['rect', 'rect', 'L'], margin: [1.5, 3],
    dividers: NONE, stubs: [0, 1], fill: [['shelf', 4], ['crate', 3], ['barrels', 2], ['chest', 1], ['table_set', 1]],
    density: [1.2, 2], puddles: NONE, grass: NONE, dirt: NONE,
  },
  indoor: {
    floors: ['wood', 'stone'], backgrounds: ['void'], shapes: ['rect', 'rect', 'L'], margin: [1.5, 3],
    dividers: NONE, stubs: [0, 1], fill: [['crate', 2], ['barrels', 2], ['shelf', 2], ['chest', 1], ['table_set', 1]],
    density: [0.6, 1.2], puddles: NONE, grass: NONE, dirt: NONE,
  },
  cave: {
    floors: ['stone'], backgrounds: ['void'], shapes: ['rect', 'L', 'L'], margin: [2, 4],
    dividers: NONE, stubs: [1, 3], fill: [['rock', 5], ['crate', 1], ['chest', 1]],
    density: [0.6, 1.4], puddles: [1, 4], grass: NONE, dirt: NONE,
  },
  square: {
    floors: ['cobble', 'cobble', 'stone'], backgrounds: ['dirt', 'grass', 'cobble'], shapes: ['rect', 'irregular', 'irregular'], margin: [3, 6],
    dividers: NONE, stubs: NONE, fill: [['barrels', 2], ['crate', 2], ['tree', 1], ['bush', 1]],
    density: [0.12, 0.3], ring: { kind: 'building', depth: [3, 6], gap: [0.5, 3] }, puddles: [0, 3], grass: [1, 3], dirt: NONE,
  },
  street: {
    floors: ['cobble', 'dirt'], backgrounds: ['dirt', 'grass'], shapes: ['rect', 'irregular'], margin: [2, 4],
    dividers: NONE, stubs: NONE, fill: [['barrels', 2], ['crate', 2], ['bush', 1]],
    density: [0.15, 0.4], ring: { kind: 'building', depth: [3, 5], gap: [0.5, 2.5] }, puddles: [1, 4], grass: [0, 2], dirt: NONE,
  },
  forest: {
    floors: [null], backgrounds: ['grass'], shapes: ['irregular', 'irregular', 'rect'], margin: [3, 6],
    dividers: NONE, stubs: NONE, fill: [['tree', 2], ['bush', 3], ['rock', 2]],
    density: [0.12, 0.3], ring: { kind: 'tree', depth: [3, 6], gap: NONE }, puddles: [0, 1], grass: NONE, dirt: [1, 3],
  },
  dock: {
    floors: [null], backgrounds: ['dirt', 'cobble'], shapes: ['rect'], margin: [2.5, 4],
    dividers: NONE, stubs: NONE, fill: [['crate', 3], ['barrels', 3]],
    density: [0.4, 0.8], puddles: [0, 2], grass: NONE, dirt: NONE,
  },
  outdoor: {
    floors: [null], backgrounds: ['grass', 'grass', 'dirt'], shapes: ['irregular', 'rect'], margin: [3, 5],
    dividers: NONE, stubs: NONE, fill: [['rock', 2], ['bush', 2], ['tree', 1]],
    density: [0.08, 0.25], puddles: [0, 1], grass: NONE, dirt: [1, 3],
  },
};
/** La cueva al aire libre (boca, hondonada): área de piedra rodeada de rocas. */
const CAVE_OUT: Template = {
  floors: ['stone'], backgrounds: ['dirt', 'grass'], shapes: ['irregular'], margin: [3, 5],
  dividers: NONE, stubs: NONE, fill: [['rock', 3], ['bush', 1]],
  density: [0.1, 0.25], ring: { kind: 'rock', depth: [2, 4], gap: NONE }, puddles: [1, 3], grass: NONE, dirt: NONE,
};

const BIG = ['viejo', 'grande', 'centenario', 'enorme', 'old', 'big'];
const DIRS: MapPoint[] = [[0, 1], [1, 0], [0, -1], [-1, 0], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071], [-0.7071, 0.7071]];
/** Radio de una ficha más un poco de aire. */
const TOKEN = 0.6;
/** Medio ancho del paso libre entre puntos. */
const PATH = 0.45;

export function generateMap(input: MapGenInput): LocationMap {
  return new MapGen(input).run();
}

function words(...texts: (string | undefined)[]): Set<string> {
  const norm = texts.filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set(norm.split(/[^a-z0-9]+/).filter(Boolean));
}
function hasAny(tok: Set<string>, ws: string[]): boolean {
  return ws.some((w) => tok.has(w) || tok.has(w + 's') || tok.has(w + 'es'));
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
const snapDown = (v: number) => Math.floor(v / 0.75) * 0.75;
const snapUp = (v: number) => Math.ceil(v / 0.75) * 0.75;
const between = (rand: Rng, [a, b]: Range) => a + rand() * (b - a);
const intBetween = (rand: Rng, [a, b]: Range) => a + Math.floor(rand() * (b - a + 1));
function pick<T>(rand: Rng, xs: readonly T[]): T { return xs[Math.floor(rand() * xs.length)]!; }
function weighted<T>(rand: Rng, xs: readonly [T, number][]): T {
  let r = rand() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [x, w] of xs) if ((r -= w) < 0) return x;
  return xs[xs.length - 1]![0];
}
function shuffle<T>(rand: Rng, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [xs[i], xs[j]] = [xs[j]!, xs[i]!]; }
  return xs;
}

/** Caja alrededor de unos puntos con holgura por lado [oeste, sur, este, norte], en la rejilla de 0,75 m. */
function boxAround(pts: { x: number; y: number }[], margin: number | [number, number, number, number], min: number): Box {
  const [mw, ms, me, mn] = typeof margin === 'number' ? [margin, margin, margin, margin] : margin;
  let x0 = Math.min(...pts.map((p) => p.x)) - mw, x1 = Math.max(...pts.map((p) => p.x)) + me;
  let y0 = Math.min(...pts.map((p) => p.y)) - ms, y1 = Math.max(...pts.map((p) => p.y)) + mn;
  if (x1 - x0 < min) { const c = (x0 + x1) / 2; x0 = c - min / 2; x1 = c + min / 2; }
  if (y1 - y0 < min) { const c = (y0 + y1) / 2; y0 = c - min / 2; y1 = c + min / 2; }
  return { x0: snapDown(x0), y0: snapDown(y0), x1: snapUp(x1), y1: snapUp(y1) };
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Generador pseudoaleatorio con semilla (mulberry32): mismo texto, misma secuencia. */
export function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Geometría -------------------------------------------------------------------

function segDist(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function cross(o: MapPoint, a: MapPoint, b: MapPoint): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function segSegDist(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): number {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
function boxDist(b: Box, x: number, y: number): number {
  return Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
}
function boxGap(a: Box, b: Box): number {
  return Math.hypot(Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), Math.max(a.y0 - b.y1, b.y0 - a.y1, 0));
}
function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
}
/** ¿Cruza el segmento la caja? (Liang–Barsky) */
function segHitsBox(a: MapPoint, b: MapPoint, r: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a[0] - r.x0) && clip(dx, r.x1 - a[0]) && clip(-dy, a[1] - r.y0) && clip(dy, r.y1 - a[1]);
}
function segBoxDist(a: MapPoint, b: MapPoint, r: Box): number {
  if (segHitsBox(a, b, r)) return 0;
  const corners: MapPoint[] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  return Math.min(boxDist(r, a[0], a[1]), boxDist(r, b[0], b[1]), ...corners.map((c) => segDist(c, a, b)));
}
function circleBox(x: number, y: number, r: number): Box { return { x0: x - r, y0: y - r, x1: x + r, y1: y + r }; }
function propBox(p: MapProp): Box {
  return p.r !== undefined ? circleBox(p.x, p.y, p.r) : { x0: p.x, y0: p.y, x1: p.x + (p.w ?? 0), y1: p.y + (p.h ?? 0) };
}
function unionBox(bs: Box[]): Box {
  return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
}
function inPoly(x: number, y: number, poly: MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function edgesOf(poly: MapPoint[]): Seg[] {
  return poly.map((p, i): Seg => [p, poly[(i + 1) % poly.length]!]);
}
function polyEdgeDist(x: number, y: number, poly: MapPoint[]): number {
  return Math.min(...edgesOf(poly).map(([a, b]) => segDist([x, y], a, b)));
}
/** Mismo polígono en sentido antihorario (con +y al norte), sin vértices repetidos. */
function ccw(poly: MapPoint[]): MapPoint[] {
  const pts = poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]!; return Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6; });
  let a = 0;
  for (const [p, q] of edgesOf(pts)) a += p[0] * q[1] - q[0] * p[1];
  return a < 0 ? pts.reverse() : pts;
}
/** Sala en L: la caja sin el entrante de una esquina. */
function lPoly(b: Box, n: Box): MapPoint[] {
  const w = n.x0 === b.x0, s = n.y0 === b.y0;
  const sw: MapPoint[] = w && s ? [[b.x0, n.y1], [n.x1, n.y1], [n.x1, b.y0]] : [[b.x0, b.y0]];
  const se: MapPoint[] = !w && s ? [[n.x0, b.y0], [n.x0, n.y1], [b.x1, n.y1]] : [[b.x1, b.y0]];
  const ne: MapPoint[] = !w && !s ? [[b.x1, n.y0], [n.x0, n.y0], [n.x0, b.y1]] : [[b.x1, b.y1]];
  const nw: MapPoint[] = w && !s ? [[n.x1, b.y1], [n.x1, n.y0], [b.x0, n.y0]] : [[b.x0, b.y1]];
  return [...sw, ...se, ...ne, ...nw];
}
/** Mancha irregular (charco, hierba): polígono alrededor de un centro. */
function blob(rand: Rng, x: number, y: number, r: number): MapPoint[] {
  const n = 7 + Math.floor(rand() * 3), a0 = rand() * Math.PI * 2, pts: MapPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * Math.PI * 2) / n, f = 0.7 + rand() * 0.45;
    pts.push([r2(x + r * f * Math.cos(a)), r2(y + r * f * Math.sin(a))]);
  }
  return pts;
}
function sideDist(b: Box, p: { x: number; y: number }, side: Side): number {
  return side === 'n' ? b.y1 - p.y : side === 's' ? p.y - b.y0 : side === 'e' ? b.x1 - p.x : p.x - b.x0;
}
function nearestSide(b: Box, p: { x: number; y: number }): Side {
  return (['s', 'n', 'w', 'e'] as Side[]).reduce((best, k) => (Math.abs(sideDist(b, p, k)) < Math.abs(sideDist(b, p, best)) ? k : best), 's');
}
const NORMAL: Record<Side, MapPoint> = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
function fitsRoom(room: Room, b: Box, pad: number): boolean {
  const m = room.box;
  if (b.x0 < m.x0 + pad - 1e-9 || b.x1 > m.x1 - pad + 1e-9 || b.y0 < m.y0 + pad - 1e-9 || b.y1 > m.y1 - pad + 1e-9) return false;
  return !room.notch || !boxesOverlap(b, room.notch, pad - 1e-9);
}

/** Puntos extremos de todo lo dibujado (para los límites del plano). */
export function mapExtent(m: Pick<LocationMap, 'areas' | 'walls' | 'doors' | 'props'>): MapPoint[] {
  const pts: MapPoint[] = [];
  for (const a of m.areas) {
    const w = (a.width ?? 0) / 2;
    for (const [x, y] of a.polygon ?? a.path ?? []) pts.push([x - w, y - w], [x + w, y + w]);
  }
  for (const w of m.walls) pts.push(...w.points);
  for (const d of m.doors) pts.push(d.from, d.to);
  for (const p of m.props) {
    if (p.r !== undefined) pts.push([p.x - p.r, p.y - p.r], [p.x + p.r, p.y + p.r]);
    else pts.push([p.x, p.y], [p.x + (p.w ?? 0), p.y + (p.h ?? 0)]);
  }
  return pts;
}

// --- Generador ---------------------------------------------------------------------

class MapGen {
  private readonly indoor: boolean;
  private readonly type: PlaceType;
  private readonly tpl: Template;
  private readonly spots: MapGenSpot[];
  private readonly pub: MapGenSpot[];
  private readonly feats = new Map<Id, Feature[]>();
  private readonly toks = new Map<Id, Set<string>>();
  private readonly spotRng = new Map<Id, Rng>();
  /** Sala (interior) o área (exterior) alrededor de los puntos visibles. */
  private readonly main: Box;
  private room: Room | null = null;
  /** Exteriores: forma del área (rectángulo o irregular). */
  private areaPoly: MapPoint[] = [];
  private floor: Ground = 'wood';
  private background: Ground = 'void';
  private readonly center: MapPoint;
  private readonly exitTo = new Map<Id, string>();
  private readonly annexes = new Map<Id, Room>();
  private readonly buildings = new Map<Id, { x: number; y: number; w: number; h: number; side: Side }>();
  private readonly occ: Occupied[] = [];
  /** Caminos rectos que nada tapa: entre cada par de puntos visibles y de cada punto a su salida. */
  private readonly paths: Seg[] = [];
  /** Tabiques: el relleno no se pone encima. */
  private readonly blockers: Seg[] = [];
  /** Manchas de suelo (hierba, tierra, charcos): debajo de senderos y agua. */
  private readonly patches: MapArea[] = [];
  /** Alfombras de relleno: debajo de los muebles. */
  private readonly under: MapProp[] = [];
  /** Senderos que salen del plano: al final llegan justo al borde. */
  private readonly edgeTrails: { area: MapArea; side: Side }[] = [];
  private readonly out: Pick<LocationMap, 'areas' | 'walls' | 'doors' | 'props'> = { areas: [], walls: [], doors: [], props: [] };
  private readonly theme: Set<string>;

  constructor(private readonly input: MapGenInput) {
    this.indoor = input.location.indoor;
    this.type = placeTypeOf(input);
    this.tpl = this.type === 'cave' && !this.indoor ? CAVE_OUT : TEMPLATES[this.type];
    this.spots = [...input.spots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.pub = this.spots.filter((s) => !s.hidden);
    for (const e of [...(input.exits ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!this.exitTo.has(e.from_spot_id)) this.exitTo.set(e.from_spot_id, e.to_location_name);
    }
    this.theme = words(input.location.name, input.zone?.name, input.zone?.kind, input.location.ambience?.smell);
    for (const s of this.spots) {
      const tok = words(s.name, ...s.aliases, ...s.tags);
      const feats = RULES.filter(([, ws]) => hasAny(tok, ws)).map(([f]) => f);
      // Con salida: puerta en la pared (dentro) o en el edificio de delante (fuera).
      if (this.exitTo.has(s.id) && !feats.includes('gate') && (this.indoor || feats.includes('building'))) feats.push('gate');
      this.toks.set(s.id, tok);
      this.feats.set(s.id, feats);
    }
    const base = this.pub.length ? this.pub : [{ x: 0, y: 0 }];
    this.center = [base.reduce((a, s) => a + s.x, 0) / base.length, base.reduce((a, s) => a + s.y, 0) / base.length];
    const lay = this.rand('margins');
    const margins = [0, 1, 2, 3].map(() => snapUp(between(lay, this.tpl.margin))) as [number, number, number, number];
    this.main = boxAround(base, margins, this.indoor ? 6 : 12);
    for (let i = 0; i < this.pub.length; i++) {
      for (let j = i + 1; j < this.pub.length; j++) this.paths.push([[this.pub[i]!.x, this.pub[i]!.y], [this.pub[j]!.x, this.pub[j]!.y]]);
    }
  }

  /** Secuencia propia de cada parte: lo de un punto oculto no altera lo demás. */
  private rand(key: string): Rng {
    return seededRng(hash(`${this.input.seed ?? 0}|${this.input.location.id}|${key}`));
  }
  private rngOf(s: MapGenSpot): Rng {
    let r = this.spotRng.get(s.id);
    if (!r) this.spotRng.set(s.id, (r = this.rand('spot|' + s.id)));
    return r;
  }

  run(): LocationMap {
    const lay = this.rand('layout');
    if (this.indoor) this.buildRoom(lay); else this.buildArea(lay);
    const floors = this.out.areas.length;
    if (this.indoor) for (const s of this.spots) this.roomOf(s);
    for (const s of this.spots) for (const f of this.feats.get(s.id)!) if (FIRST.has(f)) this.feature(f, s);
    if (!this.indoor) this.outdoorExits();
    for (const s of this.spots) for (const f of this.feats.get(s.id)!) if (!FIRST.has(f)) this.feature(f, s);
    if (this.indoor) this.partitions(this.rand('walls'));
    else if (this.tpl.ring) this.ring(this.rand('ring'));
    this.ambient(this.rand('ambient'));
    this.fill(this.rand('fill'));
    this.out.areas.splice(floors, 0, ...this.patches);
    this.out.props.unshift(...this.under);

    // Límites: el marco y lo que se ve sin descubrir nada.
    const m = this.main;
    const visible = {
      areas: this.out.areas.filter((x) => !x.requires_spot), walls: this.out.walls.filter((x) => !x.requires_spot),
      doors: this.out.doors.filter((x) => !x.requires_spot), props: this.out.props.filter((x) => !x.requires_spot),
    };
    const pad = this.indoor ? 1.2 : 0;
    const pts: MapPoint[] = [[m.x0 - pad, m.y0 - pad], [m.x1 + pad, m.y1 + pad], ...mapExtent(visible)];
    const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
    const x1 = Math.max(...pts.map((p) => p[0])), y1 = Math.max(...pts.map((p) => p[1]));
    const bounds = { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) };
    for (const { area, side } of this.edgeTrails) {
      const path = area.path!, end = path[path.length - 1]!, h = (area.width ?? 0) / 2;
      path[path.length - 1] = side === 'n' ? [end[0], r2(bounds.y + bounds.h - h)] : side === 's' ? [end[0], r2(bounds.y + h)]
        : side === 'e' ? [r2(bounds.x + bounds.w - h), end[1]] : [r2(bounds.x + h), end[1]];
    }
    return { cell_m: 1.5, bounds, background: this.background, ...this.out };
  }

  // --- Forma -----------------------------------------------------------------------

  private buildRoom(lay: Rng): void {
    const b = this.main;
    const notch = pick(lay, this.tpl.shapes) === 'L' ? this.pickNotch(lay, b) : null;
    const poly = notch ? lPoly(b, notch) : rect(b.x0, b.y0, b.x1, b.y1);
    this.room = { box: b, notch, poly };
    const floor = pick(lay, this.tpl.floors) ?? 'wood';
    this.floor = this.type === 'indoor' && hasAny(this.theme, STONE) ? 'stone' : floor;
    this.out.areas.push({ ground: this.floor, polygon: poly });
    this.out.walls.push({ points: [...poly, poly[0]!] });
  }

  /** Entrante de la L: una esquina sin puntos visibles ni caminos entre ellos. */
  private pickNotch(rand: Rng, b: Box): Box | null {
    const W = b.x1 - b.x0, H = b.y1 - b.y0;
    for (const c of shuffle(rand, ['sw', 'se', 'ne', 'nw'])) {
      for (let k = 0; k < 3; k++) {
        const w = snapDown(W * between(rand, [0.25, 0.5])), h = snapDown(H * between(rand, [0.25, 0.5]));
        if (w < 2.25 || h < 2.25) continue;
        const west = c[1] === 'w', south = c[0] === 's';
        const n = { x0: west ? b.x0 : b.x1 - w, x1: west ? b.x0 + w : b.x1, y0: south ? b.y0 : b.y1 - h, y1: south ? b.y0 + h : b.y1 };
        if (this.pub.some((s) => boxDist(n, s.x, s.y) < 1.5)) continue;
        if (this.paths.some(([p, q]) => segBoxDist(p, q, n) < 0.9)) continue;
        return n;
      }
    }
    return null;
  }

  private buildArea(lay: Rng): void {
    const b = this.main, t = this.tpl;
    const shape = pick(lay, t.shapes);
    this.areaPoly = shape === 'irregular' ? this.irregular(lay, b) : rect(b.x0, b.y0, b.x1, b.y1);
    const floor = pick(lay, t.floors);
    const bgs = t.backgrounds.filter((g) => g !== floor);
    this.background = this.type === 'outdoor' && hasAny(this.theme, SAND) ? 'dirt' : pick(lay, bgs.length ? bgs : t.backgrounds);
    if (floor) this.out.areas.push({ ground: floor, polygon: this.areaPoly });
    if (this.type === 'dock') this.dock(lay);
  }

  /**
   * Contorno irregular: estrella alrededor del centro de la caja, que nunca
   * deja fuera un punto visible (cada vértice llega como poco hasta los puntos
   * de su lado, con aire).
   */
  private irregular(rand: Rng, b: Box): MapPoint[] {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
    const n = 10 + Math.floor(rand() * 5), step = (Math.PI * 2) / n, a0 = rand() * step;
    const pts: MapPoint[] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + i * step + (rand() - 0.5) * step * 0.3;
      const ux = Math.cos(a), uy = Math.sin(a);
      // Radio de la elipse inscrita en la caja en esa dirección, con mordiscos.
      let r = (1 / Math.hypot(ux / rx, uy / ry)) * (0.8 + rand() * 0.35);
      for (const s of this.pub) {
        const dx = s.x - cx, dy = s.y - cy, d = Math.hypot(dx, dy);
        let da = Math.abs(Math.atan2(dy, dx) - a) % (Math.PI * 2);
        if (da > Math.PI) da = Math.PI * 2 - da;
        if (da <= step * 1.2) r = Math.max(r, (d + 2) / Math.cos(Math.min(da, step * 1.2) / 2) / Math.cos(step / 2));
      }
      pts.push([r2(cx + r * ux), r2(cy + r * uy)]);
    }
    return pts;
  }

  /** Muelle: agua por un lado (el del punto del agua si lo hay), pasarela de tablas y embarcaderos. */
  private dock(rand: Rng): void {
    const b = this.main;
    const wet = this.pub.find((s) => hasAny(this.toks.get(s.id)!, [...RULES[1]![1], 'barco', 'bote', 'barca', 'boat', 'ship', 'muelle', 'pier']));
    const side: Side = wet ? nearestSide(b, wet) : pick(rand, ['n', 's', 'e', 'w'] as Side[]);
    const depth = between(rand, [5, 9]), walk = snapUp(between(rand, [1.5, 3]));
    const strip = (v0: number, v1: number): Box => side === 'n' ? { x0: b.x0, y0: b.y1 + v0, x1: b.x1, y1: b.y1 + v1 }
      : side === 's' ? { x0: b.x0, y0: b.y0 - v1, x1: b.x1, y1: b.y0 - v0 }
      : side === 'e' ? { x0: b.x1 + v0, y0: b.y0, x1: b.x1 + v1, y1: b.y1 } : { x0: b.x0 - v1, y0: b.y0, x1: b.x0 - v0, y1: b.y1 };
    const box = (r: Box) => rect(r2(r.x0), r2(r.y0), r2(r.x1), r2(r.y1));
    this.out.areas.push({ ground: 'water', polygon: box(strip(0, depth)) });
    this.out.areas.push({ ground: 'wood', polygon: box(strip(-walk, 0)) });
    const along = side === 'n' || side === 's' ? [b.x0, b.x1] : [b.y0, b.y1];
    const piers = intBetween(rand, [1, 3]);
    let cursor = along[0]! + 1;
    for (let i = 0; i < piers; i++) {
      const w = between(rand, [1.5, 2.5]), len = between(rand, [3, depth - 1]);
      const u = cursor + rand() * Math.max(0, (along[1]! - 1 - w - cursor) / (piers - i));
      if (u + w > along[1]! - 1) break;
      const s = strip(0, len);
      this.out.areas.push({ ground: 'wood', polygon: box(side === 'n' || side === 's' ? { ...s, x0: u, x1: u + w } : { ...s, y0: u, y1: u + w }) });
      cursor = u + w + 1.5;
    }
  }

  // --- Cada elemento ---------------------------------------------------------

  private feature(f: Feature, s: MapGenSpot): void {
    const room = this.indoor ? this.roomOf(s) : null;
    const tok = this.toks.get(s.id)!, feats = this.feats.get(s.id)!, rand = this.rngOf(s);
    switch (f) {
      case 'counter': {
        const len = between(rand, [1.2, 2.1]);
        const c = this.slot(s, room, (_dx, dy) => (dy !== 0 && Math.abs(dy) >= 0.7 ? [len, 0.3] : [0.3, len]));
        this.rectProp('counter', c.x - c.hw, c.y - c.hh, c.hw * 2, c.hh * 2, s, s.name);
        return;
      }
      case 'fireplace': {
        const lit = this.lit(tok, rand);
        if (room) { this.hugOrSlot('fireplace', s, room, between(rand, [1.5, 2.2]), 0.8, 3.5)!.lit = lit; return; }
        const c = this.slot(s, null, () => [0.5, 0.5]);
        this.rectProp('fireplace', c.x - 0.5, c.y - 0.5, 1, 1, s, s.name).lit = lit;
        return;
      }
      case 'table': {
        if (hasAny(tok, ['redonda', 'round'])) {
          const c = this.slot(s, room, () => [1.3, 0.75]);
          this.roundProp('round_table', c.x, c.y, 0.75, s, s.name);
          this.roundProp('stool', c.x - 1.05, c.y, 0.25, s);
          this.roundProp('stool', c.x + 1.05, c.y, 0.25, s);
          return;
        }
        const long = between(rand, [1.2, 1.7]);
        const c = this.slot(s, room, (dx) => (Math.abs(dx) >= 0.7 ? [0.45, long - 0.2] : [long - 0.2, 0.45]));
        const across = c.hh > c.hw;
        const w = across ? 0.9 : long, h = across ? long : 0.9;
        this.rectProp('table', c.x - w / 2, c.y - h / 2, w, h, s, s.name);
        if (across) {
          this.rectProp('chair', c.x - 0.25, c.y + h / 2 + 0.05, 0.5, 0.45, s);
          this.rectProp('chair', c.x - 0.25, c.y - h / 2 - 0.5, 0.5, 0.45, s);
        } else {
          this.rectProp('chair', c.x - w / 2 - 0.5, c.y - 0.25, 0.45, 0.5, s);
          this.rectProp('chair', c.x + w / 2 + 0.05, c.y - 0.25, 0.45, 0.5, s);
        }
        return;
      }
      case 'bed': this.hugOrSlot('bed', s, room, 1.0, 1.9, 3.5); return;
      case 'chest': this.hugOrSlot('chest', s, room, 1.0, 0.55, 3); return;
      case 'shelf': this.hugOrSlot('shelf', s, room, between(rand, [1.8, 2.6]), 0.35, 3.5); return;
      case 'stairs': this.hugOrSlot('stairs', s, room, 1.4, 3, 3.5); return;
      case 'notice':
        if (room) this.hugOrSlot('notice', s, room, 1.6, 0.35, 3.5);
        else { const c = this.slot(s, null, () => [0.8, 0.18]); this.rectProp('notice', c.x - 0.8, c.y - 0.18, 1.6, 0.35, s, s.name); }
        return;
      case 'well': case 'rock': case 'bush': case 'tree': case 'stool': {
        if (f === 'tree' && room) return;
        const base = f === 'well' ? 0.85 : f === 'rock' ? 1.0 : f === 'bush' ? 0.7 : f === 'stool' ? 0.25 : hasAny(tok, BIG) ? 2.6 : 1.8;
        const r = f === 'well' || f === 'stool' ? base : r2(base * between(rand, [0.85, 1.15]));
        const c = this.slot(s, room, () => [r, r]);
        this.roundProp(f, c.x, c.y, r, s, s.name);
        return;
      }
      case 'barrel': {
        const c = this.slot(s, room, () => [0.75, 0.35]);
        this.roundProp('barrel', c.x - 0.38, c.y, 0.35, s, s.name);
        this.roundProp('barrel', c.x + 0.38, c.y, 0.35, s, s.name);
        return;
      }
      case 'crate': { const c = this.slot(s, room, () => [0.45, 0.45]); this.rectProp('crate', c.x - 0.45, c.y - 0.45, 0.9, 0.9, s, s.name); return; }
      case 'chair': { const c = this.slot(s, room, () => [0.25, 0.25]); this.rectProp('chair', c.x - 0.25, c.y - 0.23, 0.5, 0.45, s, s.name); return; }
      // Bajo la ficha: se pisan.
      case 'rug': this.rectProp('rug', s.x - 1.3, s.y - 0.9, 2.6, 1.8, s, s.name, false); return;
      case 'trapdoor': this.rectProp('trapdoor', s.x - 0.5, s.y - 0.5, 1, 1, s, s.name, false); return;
      case 'pond': {
        const r = r2(between(rand, [1.8, 2.6]));
        const c = this.slot(s, room, () => [r, r]);
        this.out.areas.push({ ground: 'water', polygon: blob(rand, c.x, c.y, r), ...this.req(s) });
        this.occ.push({ box: circleBox(c.x, c.y, r), hidden: s.hidden });
        return;
      }
      case 'water': if (!room) this.stream(s, hasAny(tok, ['rio', 'river']) ? 4 : 2.4); return;
      case 'dirt': if (!room) this.trail(s); return;
      case 'building': if (!room) this.building(s); return;
      case 'gate':
        if (room) this.doorOn(room, s, between(rand, [1, 1.8]), rand);
        else if (feats.includes('building')) this.buildingDoor(s);
        else this.gateWall(s);
        return;
      case 'round_table': case 'text': return;
    }
  }

  /** Chimenea u hoguera: apagada o encendida si el punto lo dice; si no, según la luz del sitio. */
  private lit(tok: Set<string>, rand: Rng): boolean {
    if (hasAny(tok, ['apagada', 'apagado', 'fria', 'frio', 'cold', 'cenizas'])) return false;
    if (hasAny(tok, ['brasas', 'encendida', 'encendido', 'llamas', 'lumbre', 'lit', 'burning'])) return true;
    const light = this.input.location.ambience?.light;
    if (this.indoor && light && light !== 'natural') return light !== 'day';
    return rand() < 0.5;
  }

  /** Cuarto del punto: la sala, o un anexo propio si es un punto oculto fuera de ella. */
  private roomOf(s: MapGenSpot): Room {
    const room = this.room!, m = room.box;
    if (!s.hidden || fitsRoom(room, { x0: s.x, y0: s.y, x1: s.x, y1: s.y }, 0.3)) return room;
    const known = this.annexes.get(s.id);
    if (known) return known;
    const req = { requires_spot: s.id };
    let annex: Room, door: Seg | null = null;
    const n = room.notch;
    if (n && boxDist(n, s.x, s.y) === 0 && boxDist(m, s.x, s.y) === 0) {
      // En el entrante de la L: el entrante es su cuarto, con puerta a la sala por el lado más cercano.
      annex = { box: n, notch: null, poly: rect(n.x0, n.y0, n.x1, n.y1) };
      const inner: Seg[] = [];
      if (n.y1 < m.y1) inner.push([[n.x0, n.y1], [n.x1, n.y1]]);
      if (n.y0 > m.y0) inner.push([[n.x0, n.y0], [n.x1, n.y0]]);
      if (n.x1 < m.x1) inner.push([[n.x1, n.y0], [n.x1, n.y1]]);
      if (n.x0 > m.x0) inner.push([[n.x0, n.y0], [n.x0, n.y1]]);
      const e = inner.sort((a, b) => segDist([s.x, s.y], ...a) - segDist([s.x, s.y], ...b))[0];
      if (e) door = this.doorAlong(e, s, 1);
    } else {
      // Se pega a la sala por el lado en que más sobresale, con una puerta que solo se ve al descubrirlo.
      const a = boxAround([s], 2.25, 4.5);
      const out = { n: s.y - m.y1, s: m.y0 - s.y, e: s.x - m.x1, w: m.x0 - s.x };
      const side = (Object.keys(out) as Side[]).reduce((b, k) => (out[k] > out[b] ? k : b), 'n');
      // Cerca de la sala (la holgura de la sala varía con la semilla): se alarga hasta tocarla.
      const gap = side === 'n' ? a.y0 - m.y1 : side === 's' ? m.y0 - a.y1 : side === 'e' ? a.x0 - m.x1 : m.x0 - a.x1;
      if (gap <= 4.5) {
        if (side === 'n') a.y0 = m.y1; else if (side === 's') a.y1 = m.y0; else if (side === 'e') a.x0 = m.x1; else a.x1 = m.x0;
        ({ annex, door } = this.attach(a, side, s));
      } else annex = { box: a, notch: null, poly: rect(a.x0, a.y0, a.x1, a.y1) };
    }
    this.annexes.set(s.id, annex);
    this.out.areas.push({ ground: this.floor, polygon: annex.poly, ...req });
    this.out.walls.push({ points: [...annex.poly, annex.poly[0]!], ...req });
    if (door) this.out.doors.push({ from: door[0], to: door[1], ...req });
    return annex;
  }

  /**
   * Anexo pegado a un lado de la sala. Si ese lado tiene el entrante de la L
   * delante, el anexo lo rellena hasta la sala (sin huecos entre los dos), y
   * la puerta va en la pared que comparten.
   */
  private attach(a: Box, side: Side, s: MapGenSpot): { annex: Room; door: Seg | null } {
    const m = this.room!.box, n = this.room!.notch;
    const ns = side === 'n' || side === 's';
    const at = side === 'n' ? m.y1 : side === 's' ? m.y0 : side === 'e' ? m.x1 : m.x0;
    const sign = side === 'n' || side === 'e' ? 1 : -1;
    const world = (u: number, v: number): MapPoint => (ns ? [r2(u), r2(at + sign * v)] : [r2(at + sign * v), r2(u)]);
    const [au0, au1] = ns ? [a.x0, a.x1] : [a.y0, a.y1];
    const depth = ns ? a.y1 - a.y0 : a.x1 - a.x0;
    const su = ns ? s.x : s.y;
    let fill: { u0: number; u1: number; d: number } | null = null;
    const onSide = n && (side === 'n' ? n.y1 === m.y1 : side === 's' ? n.y0 === m.y0 : side === 'e' ? n.x1 === m.x1 : n.x0 === m.x0);
    if (n && onSide) {
      const [nu0, nu1] = ns ? [n.x0, n.x1] : [n.y0, n.y1];
      const u0 = Math.max(au0, nu0), u1 = Math.min(au1, nu1);
      if (u1 - u0 > 0.01) fill = { u0, u1, d: ns ? n.y1 - n.y0 : n.x1 - n.x0 };
    }
    const local: MapPoint[] = fill
      ? [[fill.u0, -fill.d], [fill.u1, -fill.d], [fill.u1, 0], [au1, 0], [au1, depth], [au0, depth], [au0, 0], [fill.u0, 0]]
      : [[au0, 0], [au1, 0], [au1, depth], [au0, depth]];
    const poly = ccw(local.map(([u, v]) => world(u, v)));
    // La puerta: en la pared del fondo del entrante si cabe; si no, en el tramo del lado que no tapa el entrante.
    const door = (u0: number, u1: number, v: number): Seg | null => {
      if (u1 - u0 < 1.5) return null;
      const c = clamp(su, u0 + 0.75, u1 - 0.75);
      return [world(c - 0.5, v), world(c + 0.5, v)];
    };
    let d: Seg | null = null;
    if (fill) d = door(fill.u0, fill.u1, -fill.d);
    if (!d) {
      const free: [number, number][] = fill ? [[au0, fill.u0], [fill.u1, au1]] : [[au0, au1]];
      const best = free.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0]!;
      d = door(best[0], best[1], 0);
    }
    return { annex: { box: a, notch: null, poly }, door: d };
  }

  /** Puerta de `width` sobre una pared, lo más cerca posible del punto. */
  private doorAlong([a, b]: Seg, s: MapGenSpot, width: number, jitter = 0): Seg | null {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), h = width / 2;
    if (len < width + 0.3) return null;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const t = clamp((s.x - a[0]) * ux + (s.y - a[1]) * uy + jitter, h + 0.15, len - h - 0.15);
    return [[r2(a[0] + ux * (t - h)), r2(a[1] + uy * (t - h))], [r2(a[0] + ux * (t + h)), r2(a[1] + uy * (t + h))]];
  }

  /** Puerta en la pared de la sala más cercana al punto, de ancho y sitio algo variables. */
  private doorOn(room: Room, s: MapGenSpot, width: number, rand: Rng): void {
    const edges = edgesOf(room.poly).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= width + 0.3);
    edges.sort((p, q) => segDist([s.x, s.y], ...p) - segDist([s.x, s.y], ...q));
    const e = edges[0];
    if (!e) return;
    const d = this.doorAlong(e, s, r2(width), (rand() - 0.5) * 0.8);
    if (!d) return;
    this.out.doors.push({ from: d[0], to: d[1], ...this.req(s) });
    if (!s.hidden) this.paths.push([[s.x, s.y], [(d[0][0] + d[1][0]) / 2, (d[0][1] + d[1][1]) / 2]]);
  }

  /**
   * Hueco junto al punto: prueba las ocho direcciones (en un orden propio de
   * cada punto) y se queda con la más despejada de puntos, muebles y caminos;
   * dentro del cuarto si lo hay. `dims` da la media anchura y media altura
   * según la dirección.
   */
  private slot(s: MapGenSpot, room: Room | null, dims: (dx: number, dy: number) => [number, number]) {
    const rand = this.rngOf(s), k = Math.floor(rand() * 4);
    const dirs = [...DIRS.slice(k, 4), ...DIRS.slice(0, k), ...DIRS.slice(4 + k), ...DIRS.slice(4, 4 + k)];
    let best = { x: s.x, y: s.y, hw: 0.5, hh: 0.5 }, bestScore = -Infinity;
    for (const [dx, dy] of dirs) {
      const [hw, hh] = dims(dx, dy);
      const d = Math.abs(dx) * hw + Math.abs(dy) * hh + TOKEN + 0.1;
      const x = s.x + dx * d, y = s.y + dy * d;
      let score = Math.min(3, this.clearance(x, y, Math.max(hw, hh), s));
      if (room && !fitsRoom(room, { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh }, 0.15)) score -= 1000;
      if (score > bestScore + 1e-9) { bestScore = score; best = { x, y, hw, hh }; }
    }
    if (room) {
      best.x = clamp(best.x, room.box.x0 + 0.15 + best.hw, room.box.x1 - 0.15 - best.hw);
      best.y = clamp(best.y, room.box.y0 + 0.15 + best.hh, room.box.y1 - 0.15 - best.hh);
    }
    return best;
  }

  /** Distancia libre a otros puntos, muebles y caminos. Un punto visible no tiene en cuenta lo oculto. */
  private clearance(x: number, y: number, r: number, s: MapGenSpot): number {
    let c = Infinity;
    for (const o of s.hidden ? this.spots : this.pub) if (o.id !== s.id) c = Math.min(c, Math.hypot(o.x - x, o.y - y) - TOKEN - r);
    for (const o of this.occ) if (s.hidden || !o.hidden) c = Math.min(c, boxDist(o.box, x, y) - r);
    for (const [a, b] of this.paths) c = Math.min(c, segDist([x, y], a, b) - r - PATH);
    return c;
  }

  /** Contra la pared más cercana si está a menos de `maxDist`, sin tapar el punto; si no, al lado del punto. */
  private hugOrSlot(kind: PropKind, s: MapGenSpot, room: Room | null, along: number, depth: number, maxDist: number): MapProp {
    if (room) {
      const p: MapPoint = [s.x, s.y];
      const edges = edgesOf(room.poly)
        .filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= along + 0.2 && segDist(p, a, b) <= maxDist)
        .sort((e, f) => segDist(p, ...e) - segDist(p, ...f));
      for (const [a, b] of edges) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
        const u = (s.x - a[0]) * ux + (s.y - a[1]) * uy;
        // Centrado en el punto si cabe delante de él; si no, a un lado o al otro.
        for (const t of [u - along / 2, u + TOKEN + 0.1, u - TOKEN - 0.1 - along]) {
          const t0 = clamp(t, 0.1, len - 0.1 - along);
          const r = this.hugBox(a, ux, uy, t0, along, depth);
          if (boxDist(r, s.x, s.y) < TOKEN - 0.05) continue;
          return this.rectProp(kind, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, s, s.name);
        }
      }
    }
    const c = this.slot(s, room, () => [along / 2, depth / 2]);
    return this.rectProp(kind, c.x - along / 2, c.y - depth / 2, along, depth, s, s.name);
  }

  /** Rectángulo contra una pared (antihoraria: el interior a la izquierda), de `t` a `t + along`. */
  private hugBox(a: MapPoint, ux: number, uy: number, t: number, along: number, depth: number): Box {
    const nx = -uy, ny = ux;
    const p0: MapPoint = [a[0] + ux * t, a[1] + uy * t], p1: MapPoint = [a[0] + ux * (t + along), a[1] + uy * (t + along)];
    const xs = [p0[0], p1[0], p0[0] + nx * depth, p1[0] + nx * depth], ys = [p0[1], p1[1], p0[1] + ny * depth, p1[1] + ny * depth];
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  // --- Tabiques ----------------------------------------------------------------

  /** Tabiques con vano que cruzan la sala y tabiques cortos desde la pared, sin cortar caminos ni tapar puntos ni puertas. */
  private partitions(rand: Rng): void {
    const room = this.room!, b = room.box;
    const ok = (a: MapPoint, c: MapPoint) =>
      this.pub.every((s) => segDist([s.x, s.y], a, c) > 1.0) &&
      this.out.doors.every((d) => d.requires_spot || segSegDist(a, c, d.from, d.to) > 0.9) &&
      this.occ.every((o) => o.hidden || segBoxDist(a, c, o.box) > 0.15);

    for (let i = intBetween(rand, this.tpl.dividers), tries = 0; i > 0 && tries < 12; tries++) {
      const vertical = rand() < 0.5;
      const [lo, hi] = vertical ? [b.x0, b.x1] : [b.y0, b.y1];
      if (hi - lo < 6) continue;
      const c = snapDown(between(rand, [lo + 2.5, hi - 2.5]));
      // Tramo dentro de la sala (la L lo acorta).
      let [s0, s1] = vertical ? [b.y0, b.y1] : [b.x0, b.x1];
      const n = room.notch;
      if (n && (vertical ? c > n.x0 && c < n.x1 : c > n.y0 && c < n.y1)) {
        if (vertical) { if (n.y0 === b.y0) s0 = n.y1; else s1 = n.y0; } else { if (n.x0 === b.x0) s0 = n.x1; else s1 = n.x0; }
      }
      const pt = (t: number): MapPoint => (vertical ? [c, r2(t)] : [r2(t), c]);
      // Los caminos que lo cruzan pasan todos por el vano.
      const hits: number[] = [];
      for (const [p, q] of this.paths) {
        const [pa, qa] = vertical ? [p[0], q[0]] : [p[1], q[1]];
        if ((pa - c) * (qa - c) >= 0) continue;
        const t = (c - pa) / (qa - pa);
        hits.push(vertical ? p[1] + t * (q[1] - p[1]) : p[0] + t * (q[0] - p[0]));
      }
      const width = between(rand, [1, 1.5]);
      let g0: number, g1: number;
      if (hits.length) {
        g0 = Math.min(...hits) - 0.6; g1 = Math.max(...hits) + 0.6;
        if (g1 - g0 < width) { const m = (g0 + g1) / 2; g0 = m - width / 2; g1 = m + width / 2; }
        if (g1 - g0 > 2.4) continue;
      } else {
        g0 = between(rand, [s0 + 0.8, s1 - 0.8 - width]); g1 = g0 + width;
      }
      if (g0 < s0 + 0.6 || g1 > s1 - 0.6) continue;
      const parts: Seg[] = [[pt(s0), pt(g0)], [pt(g1), pt(s1)]];
      if (!parts.every(([p, q]) => ok(p, q))) continue;
      for (const seg of parts) { this.out.walls.push({ points: seg }); this.blockers.push(seg); }
      this.out.doors.push({ from: pt(g0), to: pt(g1) });
      i--;
    }

    const edges = edgesOf(room.poly).filter(([a, c]) => Math.hypot(c[0] - a[0], c[1] - a[1]) >= 3);
    if (!edges.length) return;
    for (let i = intBetween(rand, this.tpl.stubs), tries = 0; i > 0 && tries < 12; tries++) {
      const [a, c] = weighted(rand, edges.map((e): [Seg, number] => [e, Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1])]));
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / len, uy = (c[1] - a[1]) / len;
      const t = snapDown(between(rand, [1.2, len - 1.2])), l = between(rand, [1.2, 3.5]);
      const p: MapPoint = [r2(a[0] + ux * t), r2(a[1] + uy * t)], q: MapPoint = [r2(p[0] - uy * l), r2(p[1] + ux * l)];
      if (!fitsRoom(room, { x0: Math.min(p[0], q[0]), y0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), y1: Math.max(p[1], q[1]) }, -0.01)) continue;
      if (this.paths.some(([m, n]) => segSegDist(p, q, m, n) < 0.7)) continue;
      if (!ok(p, q) || this.blockers.some(([m, n]) => segSegDist(p, q, m, n) < 1.2)) continue;
      this.out.walls.push({ points: [p, q] });
      this.blockers.push([p, q]);
      i--;
    }
  }

  // --- Exteriores --------------------------------------------------------------

  /** Hacia fuera: del centro de los puntos visibles hacia el punto (al sur si coincide). */
  private away(s: MapGenSpot): MapPoint {
    const dx = s.x - this.center[0], dy = s.y - this.center[1], l = Math.hypot(dx, dy);
    return l < 0.5 ? [0, -1] : [dx / l, dy / l];
  }
  private axis(s: MapGenSpot): Side {
    const [ax, ay] = this.away(s);
    return Math.abs(ax) >= Math.abs(ay) ? (ax >= 0 ? 'e' : 'w') : (ay >= 0 ? 'n' : 's');
  }
  /** Lado por el que sale: el borde más cercano si tiene salida; si no, hacia fuera. */
  private exitSide(s: MapGenSpot): Side {
    return this.exitTo.has(s.id) ? nearestSide(this.main, s) : this.axis(s);
  }
  /** Del punto al borde de su lado, y un trecho más allá (por el borde de árboles o casas). */
  private toEdge(s: MapGenSpot, side: Side, beyond = 6): MapPoint {
    const m = this.main;
    return side === 'n' ? [s.x, m.y1 + beyond] : side === 's' ? [s.x, m.y0 - beyond] : side === 'e' ? [m.x1 + beyond, s.y] : [m.x0 - beyond, s.y];
  }

  /**
   * Salidas al aire libre sin puerta ni sendero propio: hueco hacia el borde
   * más cercano (nada lo tapa) y, en el campo, una vereda hasta él.
   */
  private outdoorExits(): void {
    for (const s of this.pub) {
      if (!this.exitTo.has(s.id)) continue;
      const feats = this.feats.get(s.id)!;
      if (feats.includes('building') || feats.includes('gate') || feats.includes('dirt')) continue;
      const end = this.toEdge(s, nearestSide(this.main, s));
      this.paths.push([[s.x, s.y], end]);
      if (this.type === 'forest' || this.type === 'outdoor' || this.type === 'cave') {
        const area: MapArea = { ground: 'dirt', path: [[r2(s.x), r2(s.y)], [r2(end[0]), r2(end[1])]], width: 1.6 };
        this.out.areas.push(area);
        this.edgeTrails.push({ area, side: nearestSide(this.main, s) });
      }
    }
  }

  /** Arroyo o río: franja que cruza el plano pasando junto al punto, por el lado de fuera. */
  private stream(s: MapGenSpot, width: number): void {
    const m = this.main, side = this.axis(s), rand = this.rngOf(s), h = width / 2, ext = 6;
    const off = between(rand, [1.8, 2.8]), path: MapPoint[] = [];
    if (side === 'e' || side === 'w') {
      const x = s.x + (side === 'e' ? off : -off), y0 = m.y0 - ext, span = m.y1 - m.y0 + 2 * ext, n = Math.max(3, Math.ceil(span / 6));
      for (let i = 0; i <= n; i++) path.push([r2(x + (i % n ? (rand() - 0.5) * 1.6 : 0)), r2(y0 + h + ((span - width) * i) / n)]);
    } else {
      const y = s.y + (side === 'n' ? off : -off), x0 = m.x0 - ext, span = m.x1 - m.x0 + 2 * ext, n = Math.max(3, Math.ceil(span / 6));
      for (let i = 0; i <= n; i++) path.push([r2(x0 + h + ((span - width) * i) / n), r2(y + (i % n ? (rand() - 0.5) * 1.6 : 0))]);
    }
    this.out.areas.push({ ground: 'water', path, width, ...this.req(s) });
  }

  /** Sendero: de un trecho hacia el centro, por el punto, hasta el borde (el más cercano si es la salida). */
  private trail(s: MapGenSpot): void {
    const w = r2(between(this.rngOf(s), [1.6, 2.2]));
    const path: MapPoint[] = [];
    const inward = Math.min(4, Math.hypot(s.x - this.center[0], s.y - this.center[1]) * 0.5);
    const [ax, ay] = this.away(s);
    if (inward > 0.5) path.push([r2(s.x - ax * inward), r2(s.y - ay * inward)]);
    path.push([r2(s.x), r2(s.y)]);
    const side = this.exitSide(s), end = this.toEdge(s, side);
    path.push([r2(end[0]), r2(end[1])]);
    const area: MapArea = { ground: 'dirt', path, width: w, ...this.req(s) };
    this.out.areas.push(area);
    this.edgeTrails.push({ area, side });
    if (!s.hidden) for (let i = 1; i < path.length; i++) this.paths.push([path[i - 1]!, path[i]!]);
  }

  /** Edificio detrás del punto (por el lado de su salida), con el nombre de adonde lleva si la tiene; sin tapar otros puntos. */
  private building(s: MapGenSpot): void {
    const rand = this.rngOf(s), gap = 0.9, along = r2(between(rand, [5.5, 9])), depth = r2(between(rand, [4, 6]));
    const first = this.exitSide(s);
    const sides = [first, ...(['n', 'e', 's', 'w'] as Side[]).filter((x) => x !== first)];
    const shift = (rand() - 0.5) * (along - 2.5);
    const at = (side: Side) => side === 'n' ? { x: s.x - along / 2 + shift, y: s.y + gap, w: along, h: depth }
      : side === 's' ? { x: s.x - along / 2 + shift, y: s.y - gap - depth, w: along, h: depth }
      : side === 'e' ? { x: s.x + gap, y: s.y - along / 2 + shift, w: depth, h: along }
      : { x: s.x - gap - depth, y: s.y - along / 2 + shift, w: depth, h: along };
    const side = sides.find((k) => { const b = at(k); return this.pub.every((o) => o.id === s.id || boxDist({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }, o.x, o.y) > TOKEN + 0.3); }) ?? first;
    const b = at(side);
    this.buildings.set(s.id, { ...b, side });
    this.rectProp('building', b.x, b.y, b.w, b.h, s, this.exitTo.get(s.id) ?? s.name);
  }

  private buildingDoor(s: MapGenSpot): void {
    const b = this.buildings.get(s.id);
    if (!b) return;
    if (b.side === 'n' || b.side === 's') {
      const y = b.side === 'n' ? b.y : b.y + b.h;
      this.out.doors.push({ from: [r2(s.x - 0.7), r2(y)], to: [r2(s.x + 0.7), r2(y)], ...this.req(s) });
    } else {
      const x = b.side === 'e' ? b.x : b.x + b.w;
      this.out.doors.push({ from: [r2(x), r2(s.y - 0.7)], to: [r2(x), r2(s.y + 0.7)], ...this.req(s) });
    }
  }

  /** Portón al aire libre: un tramo de muro junto al punto, por el lado de su salida, con la puerta en medio; no corta caminos. */
  private gateWall(s: MapGenSpot): void {
    const rand = this.rngOf(s), side = this.exitSide(s), gate = r2(between(rand, [1, 1.75]));
    let left = between(rand, [4, 8]), right = between(rand, [4, 8]);
    const ns = side === 'n' || side === 's';
    const at = r2((ns ? s.y : s.x) + (side === 'n' || side === 'e' ? 1 : -1));
    const pt = (u: number): MapPoint => (ns ? [r2(s.x + u), at] : [at, r2(s.y + u)]);
    const cuts = (u0: number, u1: number) => this.paths.some(([a, b]) => segSegDist(pt(u0), pt(u1), a, b) < 0.3);
    while (left > gate + 0.6 && cuts(-left, -gate)) left -= 0.75;
    while (right > gate + 0.6 && cuts(gate, right)) right -= 0.75;
    this.out.walls.push({ points: [pt(-left), pt(right)], ...this.req(s) });
    this.out.doors.push({ from: pt(-gate), to: pt(gate), ...this.req(s) });
    if (!s.hidden) this.paths.push([[s.x, s.y], this.toEdge(s, side)]);
  }

  /** Borde del área: árboles o rocas fuera del claro, o casas en fila por los lados (con huecos y sin tapar salidas). */
  private ring(rand: Rng): void {
    const t = this.tpl.ring!, m = this.main;
    if (t.kind === 'building') { this.buildingRows(rand, t.depth, t.gap); return; }
    const d = [0, 1, 2, 3].map(() => between(rand, t.depth));
    const outer: Box = { x0: m.x0 - d[0]!, y0: m.y0 - d[1]!, x1: m.x1 + d[2]!, y1: m.y1 + d[3]! };
    const strips = this.strips();
    const placed: { x: number; y: number; r: number }[] = [];
    const tree = t.kind === 'tree', spacing = tree ? 3.4 : 3;
    const band = (outer.x1 - outer.x0) * (outer.y1 - outer.y0) - (m.x1 - m.x0) * (m.y1 - m.y0) * 0.7;
    const want = Math.round(band / (spacing * spacing));
    for (let tries = 0, n = 0; n < want && tries < want * 4; tries++) {
      const x = between(rand, [outer.x0, outer.x1]), y = between(rand, [outer.y0, outer.y1]);
      const r = r2(tree ? between(rand, [1.1, 2]) : between(rand, [0.7, 1.5]));
      if (inPoly(x, y, this.areaPoly)) continue;
      if (this.pub.some((s) => Math.hypot(s.x - x, s.y - y) < r + 1.5)) continue;
      if (this.paths.some(([a, b]) => segDist([x, y], a, b) < r + 0.8)) continue;
      if (this.occ.some((o) => !o.hidden && boxDist(o.box, x, y) < r + 0.3)) continue;
      if (strips.some((a) => a.path!.some((p, i) => i > 0 && segDist([x, y], a.path![i - 1]!, p) < r + (a.width ?? 0) / 2 + 0.3))) continue;
      if (this.out.doors.some((dd) => !dd.requires_spot && segDist([x, y], dd.from, dd.to) < r + 1.5)) continue;
      if (placed.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + r) * (tree ? 0.8 : 1.05))) continue;
      placed.push({ x, y, r });
      this.out.props.push({ kind: t.kind, x: r2(x), y: r2(y), r });
      n++;
    }
  }

  /** Casas en fila junto a los lados del área (en una calle, solo los dos largos). */
  private buildingRows(rand: Rng, depth: Range, gap: Range): void {
    const m = this.main, strips = this.strips();
    const sides: Side[] = this.type === 'street' ? (m.x1 - m.x0 >= m.y1 - m.y0 ? ['n', 's'] : ['e', 'w']) : ['n', 'e', 's', 'w'];
    const placed: Box[] = [];
    for (const side of sides) {
      const ns = side === 'n' || side === 's';
      const [lo, hi] = ns ? [m.x0, m.x1] : [m.y0, m.y1];
      let u = lo + between(rand, [0, 2]);
      while (u < hi - 3) {
        const w = Math.min(between(rand, [4, 9]), hi - u), d = between(rand, depth), off = between(rand, [0, 0.6]);
        const b: Box = side === 'n' ? { x0: u, y0: m.y1 + off, x1: u + w, y1: m.y1 + off + d }
          : side === 's' ? { x0: u, y0: m.y0 - off - d, x1: u + w, y1: m.y0 - off }
          : side === 'e' ? { x0: m.x1 + off, y0: u, x1: m.x1 + off + d, y1: u + w } : { x0: m.x0 - off - d, y0: u, x1: m.x0 - off, y1: u + w };
        const free = w >= 3 &&
          this.pub.every((s) => boxDist(b, s.x, s.y) > TOKEN + 0.4) &&
          this.paths.every(([a, c]) => segBoxDist(a, c, b) > 0.5) &&
          this.occ.every((o) => o.hidden || boxGap(o.box, b) > 0.4) &&
          strips.every((a) => a.path!.every((p, i) => i === 0 || segBoxDist(a.path![i - 1]!, p, b) > (a.width ?? 0) / 2 + 0.2)) &&
          this.out.doors.every((dd) => dd.requires_spot || segBoxDist(dd.from, dd.to, b) > 1) &&
          placed.every((o) => boxGap(o, b) > 0.3);
        if (free) {
          placed.push(b);
          this.out.props.push({ kind: 'building', x: r2(b.x0), y: r2(b.y0), w: r2(b.x1 - b.x0), h: r2(b.y1 - b.y0) });
          u += w + between(rand, gap);
        } else u += 1.5;
      }
    }
    for (const b of placed) this.occ.push({ box: b, hidden: false });
  }

  /** Franjas visibles (agua y senderos): no se tapan. */
  private strips(): MapArea[] {
    return this.out.areas.filter((a) => a.path && !a.requires_spot);
  }

  // --- Ambiente y relleno ------------------------------------------------------------

  /** ¿Está el sitio dentro de la sala o del área? */
  private inside(b: Box, pad: number): boolean {
    if (this.room) return fitsRoom(this.room, b, pad);
    const m = this.main;
    if (b.x0 < m.x0 || b.x1 > m.x1 || b.y0 < m.y0 || b.y1 > m.y1) return false;
    return inPoly((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, this.areaPoly);
  }

  /** Charcos, matas de hierba y calvas de tierra: suelo que se pisa, sin tapar puntos ni muebles. */
  private ambient(rand: Rng): void {
    const t = this.tpl, m = this.main;
    const spot = (r: number, edge: boolean): MapPoint | null => {
      for (let k = 0; k < 15; k++) {
        const x = between(rand, [m.x0, m.x1]), y = between(rand, [m.y0, m.y1]);
        if (!this.inside(circleBox(x, y, r), 0.1)) continue;
        if (edge && !this.room && polyEdgeDist(x, y, this.areaPoly) > 2.5) continue;
        if (this.pub.some((s) => Math.hypot(s.x - x, s.y - y) < r + 0.4)) continue;
        if (this.occ.some((o) => !o.hidden && boxDist(o.box, x, y) < r + 0.1)) continue;
        return [x, y];
      }
      return null;
    };
    for (let i = intBetween(rand, t.puddles); i > 0; i--) {
      const r = between(rand, [0.35, 0.9]), p = spot(r, false);
      if (p) this.patches.push({ ground: 'water', polygon: blob(rand, p[0], p[1], r) });
    }
    for (let i = intBetween(rand, t.grass); i > 0; i--) {
      const r = between(rand, [0.8, 2.2]), p = spot(r, true);
      if (p) this.patches.unshift({ ground: 'grass', polygon: blob(rand, p[0], p[1], r) });
    }
    for (let i = intBetween(rand, t.dirt); i > 0; i--) {
      const r = between(rand, [1, 2.5]), p = spot(r, false);
      if (p) this.patches.unshift({ ground: 'dirt', polygon: blob(rand, p[0], p[1], r) });
    }
  }

  /** Muebles de relleno según la plantilla: sin puntos, caminos, tabiques, puertas ni otros muebles debajo. */
  private fill(rand: Rng): void {
    const t = this.tpl, m = this.main;
    let area = (m.x1 - m.x0) * (m.y1 - m.y0);
    if (this.room?.notch) { const n = this.room.notch; area -= (n.x1 - n.x0) * (n.y1 - n.y0); }
    const want = Math.round((area / 20) * between(rand, t.density));
    const strips = this.strips();
    for (let i = 0; i < want; i++) {
      const kind = weighted(rand, t.fill);
      for (let k = 0; k < 20; k++) {
        const g = this.filler(kind, rand);
        if (!g) continue;
        const { props, walkable, hug } = g, b = unionBox(props.map(propBox));
        if (!this.inside(b, hug ? -0.01 : 0.15)) continue;
        if (this.pub.some((s) => boxDist(b, s.x, s.y) < TOKEN + 0.1)) continue;
        if (!walkable && this.paths.some(([a, c]) => segBoxDist(a, c, b) < PATH + 0.05)) continue;
        if (this.blockers.some(([a, c]) => segBoxDist(a, c, b) < 0.15)) continue;
        if (this.occ.some((o) => !o.hidden && boxesOverlap(o.box, b, walkable ? -0.01 : 0.15))) continue;
        if (this.out.doors.some((d) => !d.requires_spot && segBoxDist(d.from, d.to, b) < 1)) continue;
        if (strips.some((a) => a.path!.some((p, j) => j > 0 && segBoxDist(a.path![j - 1]!, p, b) < (a.width ?? 0) / 2 + 0.2))) continue;
        if (walkable) this.under.push(...props);
        else { this.out.props.push(...props); this.occ.push({ box: b, hidden: false }); }
        break;
      }
    }
  }

  /** Un mueble de relleno (o un grupo: mesa con taburetes, barriles juntos), en un sitio al azar o contra una pared. */
  private filler(kind: Filler, rand: Rng): { props: MapProp[]; walkable?: boolean; hug?: boolean } | null {
    const m = this.main, x = between(rand, [m.x0, m.x1]), y = between(rand, [m.y0, m.y1]);
    const R = (k: PropKind, px: number, py: number, w: number, h: number): MapProp => ({ kind: k, x: r2(px), y: r2(py), w: r2(w), h: r2(h) });
    const C = (k: PropKind, px: number, py: number, r: number): MapProp => ({ kind: k, x: r2(px), y: r2(py), r: r2(r) });
    const wall = (k: PropKind, along: number, depth: number): { props: MapProp[]; hug: boolean } | null => {
      if (!this.room) return null;
      const edges = edgesOf(this.room.poly).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= along + 0.4);
      if (!edges.length) return null;
      const [a, b] = weighted(rand, edges.map((e): [Seg, number] => [e, Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1])]));
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r = this.hugBox(a, (b[0] - a[0]) / len, (b[1] - a[1]) / len, between(rand, [0.2, len - along - 0.2]), along, depth);
      return { props: [R(k, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)], hug: true };
    };
    switch (kind) {
      case 'round_set': {
        const r = between(rand, [0.55, 0.8]), n = intBetween(rand, [2, 4]), a0 = rand() * Math.PI * 2;
        const props = [C('round_table', x, y, r)];
        for (let i = 0; i < n; i++) { const a = a0 + (i * Math.PI * 2) / n; props.push(C('stool', x + (r + 0.35) * Math.cos(a), y + (r + 0.35) * Math.sin(a), 0.25)); }
        return { props };
      }
      case 'table_set': {
        const long = between(rand, [1.2, 1.8]), short = between(rand, [0.8, 1]), across = rand() < 0.5;
        const w = across ? short : long, h = across ? long : short, n = intBetween(rand, [1, 2]);
        const props = [R('table', x - w / 2, y - h / 2, w, h)];
        for (let i = 0; i < n; i++) {
          const f = n === 1 ? 0 : i === 0 ? -0.25 : 0.25;
          if (across) { props.push(R('chair', x - w / 2 - 0.5, y + f * h - 0.25, 0.45, 0.5), R('chair', x + w / 2 + 0.05, y + f * h - 0.25, 0.45, 0.5)); }
          else { props.push(R('chair', x + f * w - 0.25, y + h / 2 + 0.05, 0.5, 0.45), R('chair', x + f * w - 0.25, y - h / 2 - 0.5, 0.5, 0.45)); }
        }
        return { props };
      }
      case 'barrels': {
        const r = between(rand, [0.3, 0.4]), n = intBetween(rand, [1, 3]);
        const at: MapPoint[] = [[0, 0], [2 * r + 0.05, 0], [r + 0.03, 1.75 * r]];
        if (this.room && rand() < 0.5) {
          const w = wall('barrel', (2 * r + 0.05) * Math.min(n, 2), 2 * r);
          if (!w) return null;
          const b = propBox(w.props[0]!), props: MapProp[] = [];
          const horiz = b.x1 - b.x0 >= b.y1 - b.y0;
          for (let i = 0; i < Math.min(n, 2); i++) props.push(C('barrel', horiz ? b.x0 + r + i * (2 * r + 0.05) : (b.x0 + b.x1) / 2, horiz ? (b.y0 + b.y1) / 2 : b.y0 + r + i * (2 * r + 0.05), r));
          return { props, hug: true };
        }
        return { props: at.slice(0, n).map(([dx, dy]) => C('barrel', x + dx, y + dy, r)) };
      }
      case 'crate': {
        const s = between(rand, [0.7, 1]), props = [R('crate', x, y, s, s)];
        if (rand() < 0.4) props.push(R('crate', x + s + 0.05, y + (rand() - 0.5) * 0.3, s * 0.85, s * 0.85));
        return { props };
      }
      case 'shelf': return wall('shelf', between(rand, [1.6, 3]), between(rand, [0.35, 0.45]));
      case 'chest': return this.room ? wall('chest', between(rand, [0.9, 1.1]), between(rand, [0.5, 0.6])) : { props: [R('chest', x, y, 1, 0.55)] };
      case 'bed': return wall('bed', 1, 1.9);
      case 'rug': return { props: [R('rug', x, y, between(rand, [1.6, 3]), between(rand, [1.2, 2]))], walkable: true };
      case 'tree': return this.room ? null : { props: [C('tree', x, y, between(rand, [1.1, 1.9]))] };
      case 'rock': return { props: [C('rock', x, y, this.room ? between(rand, [0.4, 0.9]) : between(rand, [0.6, 1.2]))] };
      case 'bush': return this.room ? null : { props: [C('bush', x, y, between(rand, [0.5, 0.8]))] };
    }
  }

  // --- Salida --------------------------------------------------------------------

  private req(s: MapGenSpot): { requires_spot?: Id } {
    return s.hidden ? { requires_spot: s.id } : {};
  }

  private rectProp(kind: PropKind, x: number, y: number, w: number, h: number, s: MapGenSpot, label?: string, blocks = true): MapProp {
    const p: MapProp = { kind, x: r2(x), y: r2(y), w: r2(w), h: r2(h), spot_id: s.id, ...this.req(s) };
    if (label) p.label = label;
    this.out.props.push(p);
    if (blocks) this.occ.push({ box: { x0: x, y0: y, x1: x + w, y1: y + h }, hidden: s.hidden });
    return p;
  }

  private roundProp(kind: PropKind, x: number, y: number, r: number, s: MapGenSpot, label?: string): void {
    const p: MapProp = { kind, x: r2(x), y: r2(y), r, spot_id: s.id, ...this.req(s) };
    if (label) p.label = label;
    this.out.props.push(p);
    this.occ.push({ box: circleBox(x, y, r), hidden: s.hidden });
  }
}
