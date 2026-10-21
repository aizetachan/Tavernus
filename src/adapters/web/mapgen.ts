/**
 * Plano generado para una localización sin plano dibujado (DEMO_MAPS). Sin IA:
 * sale de los datos del motor (interior o exterior, ambiente, zona, y nombre,
 * alias y etiquetas de cada punto). Reconoce palabras clave y pone el mueble
 * del catálogo junto a su punto, enlazado con `spot_id`. Determinista (mismos
 * datos, mismo plano) y rápido: milisegundos.
 *
 * Lo que sale de un punto oculto lleva `requires_spot` y no cuenta para los
 * límites ni empuja a los demás muebles: si el PJ no lo ha descubierto, el
 * tablero lo quita y el plano queda igual que si ese punto no existiera.
 */

import type { Id } from '../../engine/model.js';
import type { World } from '../../engine/world.js';
import { rect, type Ground, type LocationMap, type MapPoint, type MapProp, type PropKind } from '../../data/seed/maps.js';

export interface MapGenSpot { id: Id; name: string; aliases: string[]; tags: string[]; x: number; y: number; hidden: boolean }
export interface MapGenInput {
  location: { id: Id; name: string; indoor: boolean; ambience?: { smell?: string } };
  zone?: { name: string; kind: string } | null;
  spots: MapGenSpot[];
  /** Salidas desde puntos de esta localización. */
  exits?: { id: Id; from_spot_id: Id; to_location_id: Id; to_location_name: string }[];
}

/** Lo que el generador lee del mundo para una localización. */
export function mapInputOf(world: World, locationId: Id): MapGenInput {
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
  return { location: loc, zone: world.zones.get(loc.zone_id) ?? null, spots, exits };
}

type Feature = PropKind | 'water' | 'pond' | 'dirt' | 'gate';
type Box = { x0: number; y0: number; x1: number; y1: number };
type Side = 'n' | 's' | 'e' | 'w';
interface Occupied { x: number; y: number; r: number; hidden: boolean }

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
  ['bed', ['cama', 'jergon', 'catre', 'litera', 'lecho', 'bed']],
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
const BIG = ['viejo', 'grande', 'centenario', 'enorme', 'old', 'big'];
const DIRS: MapPoint[] = [[0, 1], [1, 0], [0, -1], [-1, 0], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071], [-0.7071, 0.7071]];
/** Radio de una ficha más un poco de aire. */
const TOKEN = 0.6;

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

function boxAround(pts: { x: number; y: number }[], margin: number, min: number): Box {
  let x0 = Math.min(...pts.map((p) => p.x)) - margin, x1 = Math.max(...pts.map((p) => p.x)) + margin;
  let y0 = Math.min(...pts.map((p) => p.y)) - margin, y1 = Math.max(...pts.map((p) => p.y)) + margin;
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

function segDist(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
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

class MapGen {
  private readonly indoor: boolean;
  private readonly spots: MapGenSpot[];
  private readonly pub: MapGenSpot[];
  private readonly main: Box;
  private readonly center: MapPoint;
  private readonly exitTo = new Map<Id, string>();
  private readonly annexes = new Map<Id, Box>();
  private readonly buildings = new Map<Id, { x: number; y: number; w: number; h: number; side: Side }>();
  private readonly occ: Occupied[] = [];
  private readonly out: Pick<LocationMap, 'areas' | 'walls' | 'doors' | 'props'> = { areas: [], walls: [], doors: [], props: [] };
  private readonly theme: Set<string>;

  constructor(private readonly input: MapGenInput) {
    this.indoor = input.location.indoor;
    this.spots = [...input.spots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.pub = this.spots.filter((s) => !s.hidden);
    const base = this.pub.length ? this.pub : [{ x: 0, y: 0 }];
    this.main = this.indoor ? boxAround(base, 2.25, 6) : boxAround(base, 4, 12);
    this.center = [base.reduce((a, s) => a + s.x, 0) / base.length, base.reduce((a, s) => a + s.y, 0) / base.length];
    for (const e of [...(input.exits ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!this.exitTo.has(e.from_spot_id)) this.exitTo.set(e.from_spot_id, e.to_location_name);
    }
    this.theme = words(input.location.name, input.zone?.name, input.zone?.kind, input.location.ambience?.smell);
  }

  run(): LocationMap {
    const m = this.main;
    if (this.indoor) {
      this.out.areas.push({ ground: hasAny(this.theme, STONE) ? 'stone' : 'wood', polygon: rect(m.x0, m.y0, m.x1, m.y1) });
      this.out.walls.push({ points: [...rect(m.x0, m.y0, m.x1, m.y1), [m.x0, m.y0]] });
    }
    for (const s of this.spots) {
      if (this.indoor) this.roomOf(s);
      const tok = words(s.name, ...s.aliases, ...s.tags);
      const feats = RULES.filter(([, ws]) => hasAny(tok, ws)).map(([f]) => f);
      // Con salida: puerta en la pared (dentro) o en el edificio de delante (fuera).
      if (this.exitTo.has(s.id) && !feats.includes('gate') && (this.indoor || feats.includes('building'))) feats.push('gate');
      for (const f of feats) this.feature(f, s, tok, feats);
    }
    if (!this.indoor && hasAny(this.theme, FOREST)) this.forestEdge();

    let background: Ground = 'void';
    if (!this.indoor) background = hasAny(this.theme, TOWN) ? 'cobble' : hasAny(this.theme, SAND) ? 'dirt' : 'grass';

    // Límites: el marco y lo que se ve sin descubrir nada.
    const visible = {
      areas: this.out.areas.filter((x) => !x.requires_spot), walls: this.out.walls.filter((x) => !x.requires_spot),
      doors: this.out.doors.filter((x) => !x.requires_spot), props: this.out.props.filter((x) => !x.requires_spot),
    };
    const pad = this.indoor ? 1.2 : 0;
    const pts: MapPoint[] = [[m.x0 - pad, m.y0 - pad], [m.x1 + pad, m.y1 + pad], ...mapExtent(visible)];
    const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
    const x1 = Math.max(...pts.map((p) => p[0])), y1 = Math.max(...pts.map((p) => p[1]));
    return { cell_m: 1.5, bounds: { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) }, background, ...this.out };
  }

  // --- Cada elemento ---------------------------------------------------------

  private feature(f: Feature, s: MapGenSpot, tok: Set<string>, feats: Feature[]): void {
    const room = this.indoor ? this.roomOf(s) : null;
    switch (f) {
      case 'counter': {
        const c = this.slot(s, room, (_dx, dy) => (dy !== 0 && Math.abs(dy) >= 0.7 ? [1.5, 0.3] : [0.3, 1.5]));
        this.rectProp('counter', c.x - c.hw, c.y - c.hh, c.hw * 2, c.hh * 2, s, s.name);
        return;
      }
      case 'fireplace':
        if (room) this.hugOrSlot('fireplace', s, room, 1.8, 0.8, 3.5);
        else { const c = this.slot(s, null, () => [0.5, 0.5]); this.rectProp('fireplace', c.x - 0.5, c.y - 0.5, 1, 1, s, s.name); }
        return;
      case 'table': {
        if (hasAny(tok, ['redonda', 'round'])) {
          const c = this.slot(s, room, () => [1.3, 0.75]);
          this.roundProp('round_table', c.x, c.y, 0.75, s, s.name);
          this.roundProp('stool', c.x - 1.05, c.y, 0.25, s);
          this.roundProp('stool', c.x + 1.05, c.y, 0.25, s);
          return;
        }
        const c = this.slot(s, room, (dx) => (Math.abs(dx) >= 0.7 ? [0.45, 1.2] : [1.2, 0.45]));
        const across = c.hh > c.hw;
        const w = across ? 0.9 : 1.4, h = across ? 1.4 : 0.9;
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
      case 'shelf': this.hugOrSlot('shelf', s, room, 2.4, 0.35, 3.5); return;
      case 'stairs': this.hugOrSlot('stairs', s, room, 1.4, 3, 3.5); return;
      case 'notice':
        if (room) this.hugOrSlot('notice', s, room, 1.6, 0.35, 3.5);
        else { const c = this.slot(s, null, () => [0.8, 0.18]); this.rectProp('notice', c.x - 0.8, c.y - 0.18, 1.6, 0.35, s, s.name); }
        return;
      case 'well': case 'rock': case 'bush': case 'tree': case 'stool': {
        const r = f === 'well' ? 0.85 : f === 'rock' ? 1.0 : f === 'bush' ? 0.7 : f === 'stool' ? 0.25 : hasAny(tok, BIG) ? 2.6 : 1.8;
        if (f === 'tree' && room) return;
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
        const c = this.slot(s, room, () => [2.2, 2.2]);
        const poly: MapPoint[] = [];
        for (let i = 0; i < 8; i++) poly.push([r2(c.x + 2.2 * Math.cos((i * Math.PI) / 4)), r2(c.y + 2.2 * Math.sin((i * Math.PI) / 4))]);
        this.out.areas.push({ ground: 'water', polygon: poly, ...this.req(s) });
        this.occ.push({ x: c.x, y: c.y, r: 2.2, hidden: s.hidden });
        return;
      }
      case 'water': if (!room) this.stream(s, hasAny(tok, ['rio', 'river']) ? 4 : 2.4); return;
      case 'dirt': if (!room) this.trail(s); return;
      case 'building': if (!room) this.building(s); return;
      case 'gate':
        if (room) this.doorOn(room, s, 1.5);
        else if (feats.includes('building')) this.buildingDoor(s);
        else this.gateWall(s);
        return;
      case 'round_table': case 'text': return;
    }
  }

  /** Cuarto del punto: la sala, o un anexo propio si es un punto oculto fuera de ella. */
  private roomOf(s: MapGenSpot): Box {
    const m = this.main;
    if (!s.hidden || (s.x > m.x0 + 0.3 && s.x < m.x1 - 0.3 && s.y > m.y0 + 0.3 && s.y < m.y1 - 0.3)) return m;
    const known = this.annexes.get(s.id);
    if (known) return known;
    const a = boxAround([s], 2.25, 4.5);
    // Se pega a la sala por el lado en que más sobresale, con una puerta que solo se ve al descubrirlo.
    const out = { n: s.y - m.y1, s: m.y0 - s.y, e: s.x - m.x1, w: m.x0 - s.x };
    const side = (Object.keys(out) as Side[]).reduce((b, k) => (out[k] > out[b] ? k : b), 'n');
    let shared: { from: MapPoint; to: MapPoint } | null = null;
    if (side === 'n' && a.y0 <= m.y1) { a.y0 = m.y1; shared = this.sharedDoor('x', m.y1, a, s); }
    if (side === 's' && a.y1 >= m.y0) { a.y1 = m.y0; shared = this.sharedDoor('x', m.y0, a, s); }
    if (side === 'e' && a.x0 <= m.x1) { a.x0 = m.x1; shared = this.sharedDoor('y', m.x1, a, s); }
    if (side === 'w' && a.x1 >= m.x0) { a.x1 = m.x0; shared = this.sharedDoor('y', m.x0, a, s); }
    this.annexes.set(s.id, a);
    this.out.areas.push({ ground: hasAny(this.theme, STONE) ? 'stone' : 'wood', polygon: rect(a.x0, a.y0, a.x1, a.y1), requires_spot: s.id });
    this.out.walls.push({ points: [...rect(a.x0, a.y0, a.x1, a.y1), [a.x0, a.y0]], requires_spot: s.id });
    if (shared) this.out.doors.push({ ...shared, requires_spot: s.id });
    return a;
  }

  private sharedDoor(axis: 'x' | 'y', at: number, a: Box, s: MapGenSpot): { from: MapPoint; to: MapPoint } | null {
    const m = this.main;
    const lo = axis === 'x' ? Math.max(a.x0, m.x0) : Math.max(a.y0, m.y0);
    const hi = axis === 'x' ? Math.min(a.x1, m.x1) : Math.min(a.y1, m.y1);
    if (hi - lo < 1.5) return null;
    const c = clamp(axis === 'x' ? s.x : s.y, lo + 0.75, hi - 0.75);
    return axis === 'x' ? { from: [r2(c - 0.5), at], to: [r2(c + 0.5), at] } : { from: [at, r2(c - 0.5)], to: [at, r2(c + 0.5)] };
  }

  /**
   * Hueco junto al punto: prueba las ocho direcciones (norte primero) y se
   * queda con la más despejada; dentro del cuarto si lo hay. `dims` da la
   * media anchura y media altura según la dirección.
   */
  private slot(s: MapGenSpot, room: Box | null, dims: (dx: number, dy: number) => [number, number]) {
    let best = { x: s.x, y: s.y, hw: 0.5, hh: 0.5 }, bestScore = -Infinity;
    for (const [dx, dy] of DIRS) {
      const [hw, hh] = dims(dx, dy);
      const d = Math.abs(dx) * hw + Math.abs(dy) * hh + TOKEN + 0.1;
      const x = s.x + dx * d, y = s.y + dy * d;
      let score = Math.min(3, this.clearance(x, y, Math.max(hw, hh), s));
      if (room && (x - hw < room.x0 + 0.15 || x + hw > room.x1 - 0.15 || y - hh < room.y0 + 0.15 || y + hh > room.y1 - 0.15)) score -= 1000;
      if (score > bestScore + 1e-9) { bestScore = score; best = { x, y, hw, hh }; }
    }
    if (room) {
      best.x = clamp(best.x, room.x0 + 0.15 + best.hw, room.x1 - 0.15 - best.hw);
      best.y = clamp(best.y, room.y0 + 0.15 + best.hh, room.y1 - 0.15 - best.hh);
    }
    return best;
  }

  /** Distancia libre a otros puntos y muebles. Un punto visible no tiene en cuenta lo oculto. */
  private clearance(x: number, y: number, r: number, s: MapGenSpot): number {
    let c = Infinity;
    for (const o of s.hidden ? this.spots : this.pub) if (o.id !== s.id) c = Math.min(c, Math.hypot(o.x - x, o.y - y) - TOKEN - r);
    for (const o of this.occ) if (s.hidden || !o.hidden) c = Math.min(c, Math.hypot(o.x - x, o.y - y) - o.r - r);
    return c;
  }

  /** Contra la pared más cercana si está a menos de `maxDist`; si no, al lado del punto. */
  private hugOrSlot(kind: PropKind, s: MapGenSpot, room: Box | null, along: number, depth: number, maxDist: number): void {
    if (room) {
      const side = nearestSide(room, s);
      if (sideDist(room, s, side) <= maxDist) {
        if (side === 'n' || side === 's') {
          const x = clamp(s.x - along / 2, room.x0 + 0.1, room.x1 - 0.1 - along);
          this.rectProp(kind, x, side === 'n' ? room.y1 - depth : room.y0, along, depth, s, s.name);
        } else {
          const y = clamp(s.y - along / 2, room.y0 + 0.1, room.y1 - 0.1 - along);
          this.rectProp(kind, side === 'e' ? room.x1 - depth : room.x0, y, depth, along, s, s.name);
        }
        return;
      }
    }
    const c = this.slot(s, room, () => [along / 2, depth / 2]);
    this.rectProp(kind, c.x - along / 2, c.y - depth / 2, along, depth, s, s.name);
  }

  private doorOn(room: Box, s: MapGenSpot, width: number): void {
    const side = nearestSide(room, s), h = width / 2;
    if (side === 'n' || side === 's') {
      const y = side === 'n' ? room.y1 : room.y0, c = clamp(s.x, room.x0 + h + 0.15, room.x1 - h - 0.15);
      this.out.doors.push({ from: [r2(c - h), y], to: [r2(c + h), y], ...this.req(s) });
    } else {
      const x = side === 'e' ? room.x1 : room.x0, c = clamp(s.y, room.y0 + h + 0.15, room.y1 - h - 0.15);
      this.out.doors.push({ from: [x, r2(c - h)], to: [x, r2(c + h)], ...this.req(s) });
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

  /** Arroyo o río: franja que cruza el plano pasando junto al punto, por el lado de fuera. */
  private stream(s: MapGenSpot, width: number): void {
    const m = this.main, side = this.axis(s), rand = rng(this.input.location.id + '|' + s.id), h = width / 2;
    const path: MapPoint[] = [];
    if (side === 'e' || side === 'w') {
      const x = s.x + (side === 'e' ? 2.2 : -2.2), n = Math.max(2, Math.ceil((m.y1 - m.y0) / 6));
      for (let i = 0; i <= n; i++) path.push([r2(x + (i % n ? (rand() - 0.5) * 1.4 : 0)), r2(m.y0 + h + ((m.y1 - m.y0 - width) * i) / n)]);
    } else {
      const y = s.y + (side === 'n' ? 2.2 : -2.2), n = Math.max(2, Math.ceil((m.x1 - m.x0) / 6));
      for (let i = 0; i <= n; i++) path.push([r2(m.x0 + h + ((m.x1 - m.x0 - width) * i) / n), r2(y + (i % n ? (rand() - 0.5) * 1.4 : 0))]);
    }
    this.out.areas.push({ ground: 'water', path, width, ...this.req(s) });
  }

  /** Sendero: del borde del plano, por el punto, un trecho hacia el centro. */
  private trail(s: MapGenSpot): void {
    const m = this.main, [ax, ay] = this.away(s), w = 2;
    const tx = ax > 0 ? (m.x1 - w / 2 - s.x) / ax : ax < 0 ? (m.x0 + w / 2 - s.x) / ax : Infinity;
    const ty = ay > 0 ? (m.y1 - w / 2 - s.y) / ay : ay < 0 ? (m.y0 + w / 2 - s.y) / ay : Infinity;
    const t = Math.min(tx, ty);
    const inward = Math.min(4, Math.hypot(s.x - this.center[0], s.y - this.center[1]) * 0.5);
    const path: MapPoint[] = [];
    if (inward > 0.5) path.push([r2(s.x - ax * inward), r2(s.y - ay * inward)]);
    path.push([r2(s.x), r2(s.y)]);
    if (t > 0.5) path.push([r2(s.x + ax * t), r2(s.y + ay * t)]);
    if (path.length < 2) path.push([r2(s.x), r2(s.y - 3)]);
    this.out.areas.push({ ground: 'dirt', path, width: w, ...this.req(s) });
  }

  /** Edificio detrás del punto, con el nombre de adonde lleva su salida si la tiene. */
  private building(s: MapGenSpot): void {
    const side = this.axis(s), gap = 0.9, along = 7, depth = 5;
    const b = side === 'n' ? { x: s.x - along / 2, y: s.y + gap, w: along, h: depth }
      : side === 's' ? { x: s.x - along / 2, y: s.y - gap - depth, w: along, h: depth }
      : side === 'e' ? { x: s.x + gap, y: s.y - along / 2, w: depth, h: along }
      : { x: s.x - gap - depth, y: s.y - along / 2, w: depth, h: along };
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

  /** Portón al aire libre: un tramo de muro por fuera del punto con la puerta en medio. */
  private gateWall(s: MapGenSpot): void {
    const side = this.axis(s), half = 6, gate = 1.5;
    if (side === 'n' || side === 's') {
      const y = r2(s.y + (side === 'n' ? 1 : -1));
      this.out.walls.push({ points: [[r2(s.x - half), y], [r2(s.x + half), y]], ...this.req(s) });
      this.out.doors.push({ from: [r2(s.x - gate), y], to: [r2(s.x + gate), y], ...this.req(s) });
    } else {
      const x = r2(s.x + (side === 'e' ? 1 : -1));
      this.out.walls.push({ points: [[x, r2(s.y - half)], [x, r2(s.y + half)]], ...this.req(s) });
      this.out.doors.push({ from: [x, r2(s.y - gate)], to: [x, r2(s.y + gate)], ...this.req(s) });
    }
  }

  /** Bosque: árboles por el borde, sin tapar puntos, muebles, caminos ni agua. */
  private forestEdge(): void {
    const m = this.main, rand = rng('forest|' + this.input.location.id), step = 5.5, inset = 1.5;
    const strips = this.out.areas.filter((a) => a.path && !a.requires_spot);
    const ring: MapPoint[] = [];
    for (let x = m.x0 + inset; x <= m.x1 - inset; x += step) ring.push([x, m.y0 + inset], [x, m.y1 - inset]);
    for (let y = m.y0 + inset + step; y <= m.y1 - inset - step; y += step) ring.push([m.x0 + inset, y], [m.x1 - inset, y]);
    for (const [bx, by] of ring) {
      const x = bx + (rand() - 0.5) * 2, y = by + (rand() - 0.5) * 2, r = 1.2 + rand() * 0.6;
      if (this.pub.some((s) => Math.hypot(s.x - x, s.y - y) < r + 2)) continue;
      if (this.occ.some((o) => !o.hidden && Math.hypot(o.x - x, o.y - y) < r + o.r + 0.4)) continue;
      if (strips.some((a) => a.path!.some((p, i) => i > 0 && segDist([x, y], a.path![i - 1]!, p) < r + (a.width ?? 0) / 2 + 0.3))) continue;
      this.out.props.push({ kind: 'tree', x: r2(x), y: r2(y), r: r2(r) });
    }
  }

  // --- Salida --------------------------------------------------------------------

  private req(s: MapGenSpot): { requires_spot?: Id } {
    return s.hidden ? { requires_spot: s.id } : {};
  }

  private rectProp(kind: PropKind, x: number, y: number, w: number, h: number, s: MapGenSpot, label?: string, blocks = true): void {
    const p: MapProp = { kind, x: r2(x), y: r2(y), w: r2(w), h: r2(h), spot_id: s.id, ...this.req(s) };
    if (label) p.label = label;
    this.out.props.push(p);
    if (blocks) this.occ.push({ x: x + w / 2, y: y + h / 2, r: Math.max(w, h) / 2, hidden: s.hidden });
  }

  private roundProp(kind: PropKind, x: number, y: number, r: number, s: MapGenSpot, label?: string): void {
    const p: MapProp = { kind, x: r2(x), y: r2(y), r, spot_id: s.id, ...this.req(s) };
    if (label) p.label = label;
    this.out.props.push(p);
    this.occ.push({ x, y, r, hidden: s.hidden });
  }
}

function sideDist(b: Box, p: { x: number; y: number }, side: Side): number {
  return side === 'n' ? b.y1 - p.y : side === 's' ? p.y - b.y0 : side === 'e' ? b.x1 - p.x : p.x - b.x0;
}
function nearestSide(b: Box, p: { x: number; y: number }): Side {
  return (['s', 'n', 'w', 'e'] as Side[]).reduce((best, k) => (Math.abs(sideDist(b, p, k)) < Math.abs(sideDist(b, p, best)) ? k : best), 's');
}
