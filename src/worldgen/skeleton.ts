/**
 * Esqueleto de la región inicial (PLAN: capa 1, determinista por semilla).
 *
 * De {seed, tone, setting} sale, solo con código y un PRNG con semilla, la
 * estructura del mundo: el género por la ambientación, un tipo de asentamiento
 * del catálogo (aldea, puerto, ciudad amurallada, mina, monasterio, caravana,
 * fortaleza, mercado, pueblo abandonado, cuevas, puerto espacial, refugio…)
 * elegido con pesos por tono, sus lugares y papeles con cantidades al azar
 * dentro de rangos, dos exteriores, salidas con distancias, recursos,
 * encargos y cuántas pistas. Nada de nombres propios ni prosa: eso lo pone el
 * relleno (fill.ts). Dónde y a qué hora empieza cada PJ lo decide su
 * situación inicial, no la plantilla. Misma semilla → mismo esqueleto.
 */

import { seededRng, type Rng } from '../engine/dice.js';
import type { Campaign, Id, NpcStats } from '../engine/model.js';
import { EXIT_PLACES, genreOf, PLACES, ROLES, SETTLEMENTS, type Archetype, type Genre, type PlaceKind, type RoleId, type SettlementType, type SpotTpl } from './catalog.js';

export type Tone = Campaign['tone'];
export const TONES: readonly Tone[] = ['epic', 'grim', 'comedy', 'horror', 'pulp'];

export interface SkeletonInput { seed: number; tone: Tone; setting: string }

export interface SkSpot {
  id: Id;
  /** Clave de plantilla (barra, muelle…), para el relleno y los tests. */
  key: string;
  /** Nombre genérico de plantilla; el relleno lo afina conservando la palabra clave. */
  name: string;
  aliases: string[];
  tags: string[];
  x: number;
  y: number;
  hidden: boolean;
  dc_to_find?: number;
  capacity?: number;
  entry_cost_s?: number;
  terrain_multiplier?: number;
  /** Salida hacia otra localización: el nombre lo completa el relleno ("la puerta de la lonja"). */
  leads_to?: Id;
  /** Cuarto de alquiler, cerrado con llave (rooms.ts): nadie empieza ni vive dentro. */
  locked?: boolean;
}

export interface SkLocation {
  id: Id;
  kind: PlaceKind;
  /** Nombre genérico del tipo de lugar ("el muelle"). */
  label: string;
  zone_id: Id;
  indoor: boolean;
  light: 'twilight' | 'natural';
  noise: number;
  default_spot_id: Id;
  spots: SkSpot[];
}

export interface SkExit { id: Id; from_spot_id: Id; to_spot_id: Id; distance_m: number; terrain_multiplier: number }

export interface SkNpc {
  id: Id;
  role: RoleId | 'beast';
  /** Papel en castellano, para el máster y el relleno. */
  role_label: string;
  spot_id: Id;
  archetype: Archetype;
  stats: NpcStats;
  passive_perception: number;
  hostile: boolean;
}

export interface SkResource {
  id: Id; spot_id: Id; item_id: Id; yield_max: number; destructive: boolean; skill: string; dc: number; tool_required: Id | null;
}

export interface SkJob {
  id: Id;
  kind: 'deliver' | 'visit' | 'narrative';
  deliver?: { item_id: Id; quantity: number };
  visit_spot_id?: Id;
  reward_coins: number;
  reward_reputation: number;
}

export interface Skeleton {
  version: 2;
  seed: number;
  tone: Tone;
  setting: string;
  genre: Genre;
  settlement: { type: SettlementType; label: string };
  campaign_id: Id;
  region_id: Id;
  zones: { id: Id; kind: 'town' | 'wild' }[];
  locations: SkLocation[];
  exits: SkExit[];
  npcs: SkNpc[];
  resources: SkResource[];
  jobs: SkJob[];
  clue_count: number;
  faction_id: Id;
  /** Puntos de inicio genéricos para quien llegue sin situación (el origen lo escribe index.ts). */
  start_spot_ids: Id[];
  /** Dónde puede empezar una situación inicial: cualquier punto visible que no sea un paso ni un punto de inicio genérico. */
  situation_spot_ids: Id[];
  /** Punto oculto que se gana con el logro (nunca el cuarto de alquiler, que se paga). */
  reward_spot_id: Id;
  /** Objetos sueltos en un punto. */
  items: { id: Id; item_id: Id; quantity: number; spot_id: Id }[];
}

// ---------------------------------------------------------------------------
// Bloques de combate (SRD 5e, CR 0-3). El relleno no los toca.
// ---------------------------------------------------------------------------

export const ARCHETYPES: Record<Archetype, Omit<NpcStats, 'hp_max'>> = {
  commoner: { ac: 10, hp: 4, attack_bonus: 2, damage: '1d4', damage_type: 'bludgeoning', attack_name: 'garrote', xp: 10 },
  guard: { ac: 16, hp: 11, attack_bonus: 3, damage: '1d6+1', damage_type: 'piercing', attack_name: 'lanza', xp: 25 },
  noble: { ac: 15, hp: 9, attack_bonus: 3, damage: '1d8', damage_type: 'piercing', attack_name: 'estoque', xp: 25 },
  acolyte: { ac: 10, hp: 9, attack_bonus: 2, damage: '1d4', damage_type: 'bludgeoning', attack_name: 'garrote', xp: 50 },
  bandit: { ac: 12, hp: 11, attack_bonus: 3, damage: '1d6+1', damage_type: 'slashing', attack_name: 'cimitarra', xp: 25 },
  scout: { ac: 13, hp: 16, attack_bonus: 4, damage: '1d6+2', damage_type: 'piercing', attack_name: 'espada corta', xp: 100 },
  thug: { ac: 11, hp: 32, attack_bonus: 4, damage: '1d6+2', damage_type: 'bludgeoning', attack_name: 'maza', xp: 100 },
  priest: { ac: 13, hp: 27, attack_bonus: 2, damage: '1d6', damage_type: 'bludgeoning', attack_name: 'maza', xp: 450 },
  veteran: { ac: 17, hp: 58, attack_bonus: 5, damage: '1d8+3', damage_type: 'slashing', attack_name: 'espada larga', xp: 700 },
  mage: { ac: 10, hp: 9, attack_bonus: 4, damage: '1d10', damage_type: 'fire', attack_name: 'descarga de fuego', xp: 100 },
  wolf: { ac: 13, hp: 11, attack_bonus: 4, damage: '2d4+2', damage_type: 'piercing', attack_name: 'mordisco', xp: 50 },
  boar: { ac: 11, hp: 11, attack_bonus: 3, damage: '1d6+1', damage_type: 'slashing', attack_name: 'colmillos', xp: 50 },
};

/** Rangos válidos de un bloque SRD de nivel bajo (lo comprueba el validador). */
export const SRD_STAT_RANGES = { ac: [8, 20], hp: [1, 70], attack_bonus: [0, 8], xp: [0, 10, 25, 50, 100, 200, 450, 700] } as const;

const BEAST_LABEL = { wolf: 'lobo', boar: 'jabalí' } as const;
/** Exteriores con agua de pesca. */
const FISHING: PlaceKind[] = ['river', 'coast', 'swamp'];

// ---------------------------------------------------------------------------

/** Esqueleto determinista. Misma entrada → mismo resultado, byte a byte. */
export function buildSkeleton(input: SkeletonInput): Skeleton {
  const seed = input.seed >>> 0;
  const rng = seededRng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = <V>(xs: readonly V[]): V => xs[Math.floor(rng() * xs.length)]!;
  const jit = (v: number, d = 1.2) => Math.round((v + (rng() * 2 - 1) * d) * 10) / 10;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  // Género por la ambientación; tipo de asentamiento con pesos por tono.
  const genre = genreOf(input.setting);
  const types = (Object.keys(SETTLEMENTS) as SettlementType[]).filter((t) => SETTLEMENTS[t].genre === genre);
  const weights = types.map((t) => (SETTLEMENTS[t] as { weight?: Partial<Record<Tone, number>> }).weight?.[input.tone] ?? 1);
  let roll = rng() * weights.reduce((a, w) => a + w, 0);
  const type = types[weights.findIndex((w) => (roll -= w) < 0)] ?? types[0]!;
  const def = SETTLEMENTS[type];

  const nPlaces = int(def.places[0], def.places[1]);
  const town: PlaceKind[] = [...def.required];
  for (const k of shuffle(def.optional as readonly PlaceKind[], rng)) if (town.length < nPlaces && !town.includes(k)) town.push(k);
  const wildKinds = shuffle(def.wild as readonly PlaceKind[], rng).slice(0, 2);

  const zTown = 'zn_town', zWild = 'zn_wild';
  const locations: SkLocation[] = [];
  for (const kind of [...town, ...wildKinds]) {
    const tpl = PLACES[kind];
    const scale = tpl.indoor ? 0.9 + rng() * 0.4 : 0.8 + rng() * 0.6;
    const spots = tpl.spots.map((t: SpotTpl, i): SkSpot => ({
      id: `sp_${kind}_${t.key}`, key: t.key, name: t.name, aliases: [...t.aliases], tags: [...t.tags],
      x: i === 0 ? t.x : jit(t.x * scale), y: i === 0 ? t.y : jit(t.y * scale), hidden: t.hidden ?? false,
      ...(t.dc !== undefined ? { dc_to_find: t.dc } : {}),
      ...(t.capacity !== undefined ? { capacity: t.capacity } : {}),
      ...(t.entry_cost_s !== undefined ? { entry_cost_s: t.entry_cost_s } : {}),
      ...(t.terrain !== undefined ? { terrain_multiplier: t.terrain } : {}),
      ...(t.locked ? { locked: true } : {}),
    }));
    locations.push({
      id: `loc_${kind}`, kind, label: tpl.label, zone_id: town.includes(kind) ? zTown : zWild, indoor: tpl.indoor,
      light: tpl.indoor ? 'twilight' : 'natural', noise: tpl.noise, default_spot_id: spots[0]!.id, spots,
    });
  }
  const loc = (k: PlaceKind) => locations.find((l) => l.kind === k)!;
  const exits: SkExit[] = [];
  const link = (from: SkSpot, to: SkSpot, d: number, terrain = 1) => {
    exits.push({ id: `ex_${exits.length + 1}`, from_spot_id: from.id, to_spot_id: to.id, distance_m: d, terrain_multiplier: terrain });
  };
  /** Un punto nuevo en `from` que lleva a `to`, en el borde de su plano. */
  const access = (from: SkLocation, to: SkLocation, angle: number, far: boolean): SkSpot => {
    const xs = from.spots.map((s) => s.x), ys = from.spots.map((s) => s.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const r = Math.max(6, Math.hypot(Math.max(...xs) - cx, Math.max(...ys) - cy)) + (far ? 4 : 1.5);
    const inside = to.zone_id === zTown && to.indoor;
    const s: SkSpot = {
      id: `sp_${from.kind}_to_${to.kind}`, key: `hacia_${to.kind}`,
      name: inside ? `la puerta ${/^el /.test(to.label) ? `del ${to.label.slice(3)}` : `de ${to.label}`}` : `el camino hacia ${to.label}`,
      aliases: [inside ? 'puerta' : 'camino', to.label.replace(/^(el|la|los|las)\s+/, '')], tags: [inside ? 'door' : 'road'],
      x: r1(cx + Math.cos(angle) * r), y: r1(cy + Math.sin(angle) * r), hidden: false, leads_to: to.id,
    };
    from.spots.push(s);
    return s;
  };

  // El centro (primer lugar fijo) da a todos los demás del asentamiento.
  const hub = locations[0]!;
  const spokes = locations.filter((l) => l.zone_id === zTown && l !== hub);
  spokes.forEach((l, i) => {
    const a = (i / spokes.length) * Math.PI * 2 + rng() * 0.4;
    link(l.spots[0]!, access(hub, l, a, false), l.indoor ? int(2, 6) : int(20, 60));
  });

  // Al exterior: desde el lugar de salida (portón, muelle, bocamina…) o, si no hay, desde el centro.
  const exitPlace = EXIT_PLACES.map((k) => locations.find((l) => l.kind === k && l.zone_id === zTown)).find(Boolean) ?? hub;
  const [w1, w2] = [loc(wildKinds[0]!), loc(wildKinds[1]!)];
  link(access(exitPlace, w1, rng() * Math.PI * 2, true), w1.spots[0]!, int(5, 9) * 100, 0.9);
  w1.spots[0]!.leads_to = exitPlace.id;
  if (rng() < 0.5) {
    link(access(w1, w2, rng() * Math.PI * 2, true), w2.spots[0]!, int(3, 7) * 100, 0.85);
    w2.spots[0]!.leads_to = w1.id;
  } else {
    link(access(exitPlace, w2, rng() * Math.PI * 2 + Math.PI, true), w2.spots[0]!, int(7, 12) * 100, 0.85);
    w2.spots[0]!.leads_to = exitPlace.id;
  }

  // NPC por papel: los fijos y, de la bolsa, primero los que tienen casa en este asentamiento.
  const nNpcs = int(def.npcs[0], def.npcs[1]);
  const housed = (r: RoleId) => ROLES[r].homes.some((h) => town.includes(h));
  const pool = shuffle(def.roles_optional as readonly RoleId[], rng).sort((a, b) => Number(housed(b)) - Number(housed(a)));
  const roles: RoleId[] = [...def.roles_required as readonly RoleId[]];
  for (const r of pool) if (roles.length < nNpcs && !roles.includes(r)) roles.push(r);
  const used = new Set<Id>();
  const freeSpot = (l: SkLocation, prefer?: string): SkSpot => {
    const ok = (s: SkSpot) => !s.hidden && !s.leads_to && !s.locked && !used.has(s.id);
    const want = l.spots.find((s) => s.key === prefer && ok(s));
    const rest = l.spots.filter((s, i) => ok(s) && i > 0);
    const s = want ?? (rest.length ? pick(rest) : l.spots[0]!);
    used.add(s.id);
    return s;
  };
  const npcs: SkNpc[] = [];
  const npc = (id: Id, role: RoleId | 'beast', label: string, spot: SkSpot, archetype: Archetype, hostile = false) => {
    const a = ARCHETYPES[archetype];
    const hp = Math.max(1, Math.round(a.hp * (0.8 + rng() * 0.4)));
    npcs.push({ id, role, role_label: label, spot_id: spot.id, archetype, stats: { ...a, hp_max: hp, hp }, passive_perception: int(10, 15), hostile });
  };
  for (const r of roles) {
    const role = ROLES[r] as { label: string; archetype: Archetype; homes: readonly PlaceKind[]; spot?: string };
    const home = role.homes.map((h) => locations.find((l) => l.kind === h && l.zone_id === zTown)).find(Boolean) ?? hub;
    npc(`npc_${r}`, r, role.label, freeSpot(home, role.spot), role.archetype);
  }
  const beasts = (def as { beasts?: readonly ('wolf' | 'boar')[] }).beasts;
  if (beasts?.length && rng() < 0.75) {
    const b = pick(beasts);
    npc('npc_beast', 'beast', BEAST_LABEL[b], freeSpot(w2), b, true);
  }

  // Recursos de los exteriores (ítems del catálogo común).
  const resources: SkResource[] = [];
  for (const w of [w1, w2]) {
    for (const s of w.spots) {
      if (s.hidden || s.leads_to) continue;
      const id = `rn_${w.kind}_${s.key}`;
      if (s.tags.includes('tree') && w.kind === 'forest') resources.push({ id, spot_id: s.id, item_id: 'it_madera', yield_max: 6, destructive: true, skill: 'athletics', dc: 10, tool_required: 'it_hacha' });
      else if (s.tags.includes('bush')) resources.push({ id, spot_id: s.id, item_id: 'it_bayas', yield_max: 5, destructive: false, skill: 'survival', dc: 8, tool_required: null });
      else if ((s.tags.includes('water') || s.tags.includes('pond')) && FISHING.includes(w.kind)) resources.push({ id, spot_id: s.id, item_id: 'it_pescado', yield_max: 4, destructive: false, skill: 'survival', dc: 11, tool_required: null });
    }
  }

  // Encargos: entregar algo que da el campo (si da algo), ir a mirar un punto de fuera y, a veces, uno narrativo.
  const jobs: SkJob[] = [];
  if (resources.length) { const r = pick(resources); jobs.push({ id: 'job_1', kind: 'deliver', deliver: { item_id: r.item_id, quantity: int(4, 10) }, reward_coins: int(5, 10) * 100, reward_reputation: 1 }); }
  const far = [...w1.spots, ...w2.spots].filter((s) => !s.hidden && !s.leads_to && !exits.some((e) => e.from_spot_id === s.id || e.to_spot_id === s.id));
  jobs.push({ id: `job_${jobs.length + 1}`, kind: 'visit', visit_spot_id: (far.length ? pick(far) : w2.spots[0]!).id, reward_coins: int(5, 9) * 100, reward_reputation: 1 });
  const nJobs = int(2, 3);
  while (jobs.length < nJobs) jobs.push({ id: `job_${jobs.length + 1}`, kind: 'narrative', reward_coins: int(6, 12) * 100, reward_reputation: int(1, 2) });

  // Lo que se gana con el logro: un punto oculto del asentamiento (la trampilla de la posada…) o un escondrijo nuevo en el centro.
  // El cuarto de la posada no: está a la vista, cerrado, y se alquila.
  const hiddenInTown = locations.filter((l) => l.zone_id === zTown).flatMap((l) => l.spots.filter((s) => s.hidden));
  let reward = hiddenInTown.length ? pick(hiddenInTown) : null;
  if (!reward) {
    const near = hub.spots[1] ?? hub.spots[0]!;
    reward = { id: `sp_${hub.kind}_escondrijo`, key: 'escondrijo', name: 'el escondrijo', aliases: ['escondrijo'], tags: ['chest'], x: jit(near.x), y: jit(near.y + 3), hidden: true, dc_to_find: 15, capacity: 2 };
    hub.spots.push(reward);
  }

  // Objetos sueltos: una poción en algún mueble del pueblo y, si el bosque da leña, un hacha a mano.
  const furniture = locations.filter((l) => l.zone_id === zTown).flatMap((l) => l.spots)
    .filter((s) => !s.hidden && !s.leads_to && !s.locked && s.tags.some((t) => ['chest', 'shelf', 'table', 'counter', 'crate'].includes(t)));
  const items: Skeleton['items'] = [{ id: 'ii_pocion', item_id: 'it_pocion', quantity: 1, spot_id: (furniture.length ? pick(furniture) : hub.spots[0]!).id }];
  const woodcut = resources.find((r) => r.tool_required === 'it_hacha');
  if (woodcut) items.push({ id: 'ii_hacha', item_id: 'it_hacha', quantity: 1, spot_id: locations.find((l) => l.spots.some((s) => s.id === woodcut.spot_id))!.spots[0]!.id });

  // Inicio genérico (quien llegue sin situación): el centro, la salida y la entrada de otro lugar.
  const others = spokes.filter((l) => l !== exitPlace);
  const start_spot_ids = [...new Set([hub.spots[0]!.id, exitPlace.spots[0]!.id, (others.length ? pick(others) : hub).spots[0]!.id])];
  const situation_spot_ids = locations.flatMap((l) => l.spots).filter((s) => !s.hidden && !s.leads_to && !s.locked && !start_spot_ids.includes(s.id)).map((s) => s.id);

  return {
    version: 2, seed, tone: input.tone, setting: input.setting.trim(), genre, settlement: { type, label: def.label },
    campaign_id: `w${seed.toString(36)}`, region_id: 'rg_region',
    zones: [{ id: zTown, kind: 'town' }, { id: zWild, kind: 'wild' }],
    locations, exits, npcs, resources, jobs,
    clue_count: int(3, 5), faction_id: 'fac_local',
    start_spot_ids, situation_spot_ids, reward_spot_id: reward.id, items,
  };
}

function shuffle<V>(xs: readonly V[], rng: Rng): V[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Todos los puntos del esqueleto. */
export function skeletonSpots(sk: Skeleton): SkSpot[] { return sk.locations.flatMap((l) => l.spots); }
