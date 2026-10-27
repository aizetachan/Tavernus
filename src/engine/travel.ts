/**
 * Viaje rápido y encuentros por el camino (SPEC §3.2.3).
 *
 * El tiempo de juego del trayecto se sigue calculando igual (movement.ts),
 * pero el jugador no lo espera en tiempo real: al salir hacia otra
 * localización llega en el acto y su reloj queda adelantado.
 *
 * Decisión de diseño: reloj propio por PJ, nunca un reloj global movido.
 *   - El reloj del mundo sigue ligado al real (clock.ts) y es el mismo para
 *     todos; nadie lo adelanta.
 *   - Cada PJ guarda `ahead_until_game_s`: el instante de juego al que ha
 *     llegado viajando. Su «ahora» es max(reloj del mundo, ese instante). Al
 *     llegar, el viaje queda hecho y su ahora es la hora de llegada; mientras
 *     el mundo no la alcanza, su reloj está quieto en esa hora (vive en una
 *     burbuja: lo que haga allí no hace correr su reloj salvo otro viaje).
 *   - Multijugador: nadie espera a nadie. Quien llega viajando a donde ya hay
 *     otro PJ activo y conectado (no ausente) con una hora anterior iguala su
 *     reloj al de él, o al del mundo, y actúa en el acto (Engine.joinClock):
 *     los minutos que «pierde» no se notan. El que estaba nunca salta tiempo.
 *   - Con el sitio vacío de otros PJs (el bosque, el camino) o si nadie más
 *     mira, sigue con su hora adelantada; tampoco espera.
 *
 * Encuentros: por trayecto entre localizaciones, una tirada con el rng del
 * motor contra una probabilidad por tipo de zona, distancia, luz y ritmo. Si
 * sale, el viaje se para en un punto de camino reutilizable por salida (una
 * localización de un solo punto, a mitad de la salida) y el master narra la
 * escena con el encuentro delante; luego «Continuar el viaje» llega al destino.
 */

import type { GameClock } from '../clock/clock.js';
import type { Rng } from './dice.js';
import type { Character, Exit, Id, Location, Pace, Spot, Transit } from './model.js';
import { fmtDuration } from './narrate.js';
import type { World } from './world.js';

/** Una entrada de la tabla de encuentros. `what` es para el master; `teaser`, lo primero que nota el jugador. */
export interface EncounterEntry {
  id: string;
  what: string;
  teaser?: string;
  /** Peso relativo dentro de su tabla (1 por defecto). */
  weight?: number;
  /** Solo de día o solo de noche (con penumbra cuenta como noche). */
  when?: 'day' | 'night';
  /** Peso de noche multiplicado por esto (por defecto 1). */
  night_weight?: number;
}

/** `campaign.encounters`: tabla por tipo de zona (`zone.kind`); `'*'` vale para cualquiera. */
export type EncounterTable = Record<string, EncounterEntry[]>;

/** Encuentro que ha salido en un trayecto. */
export interface TravelEncounter {
  entry: EncounterEntry;
  chance: number;
  roll: number;
  zone_kind: string;
  exit_id: Id;
  waypoint_spot_id: Id;
  origin_spot_id: Id;
  destination_spot_id: Id;
  /** Instante de juego del encuentro (reloj del PJ). */
  at_game_s: number;
  /** Lo que queda hasta el destino. */
  remaining_m: number;
  remaining_s: number;
}

/** Viaje a medias por un encuentro. Se borra al llegar a cualquier sitio que no sea un punto de camino. */
export interface PausedJourney {
  destination_spot_id: Id;
  origin_spot_id: Id;
  pace: Pace;
  started_game_s: number;
  waypoint_spot_id: Id;
  encounter_id: string;
}

/** Lo que el motor pone delante del master en un viaje (SceneHints.travel). */
export type TravelHint =
  | { kind: 'encounter'; encounter: TravelEncounter }
  | { kind: 'arrival'; departed_game_s: number; arrived_game_s: number };

type Traveller = Character & { ahead_until_game_s?: number; journey?: PausedJourney | null };

/** Margen para considerar que dos PJs viven la misma hora (s de juego). */
export const SAME_TIME_TOLERANCE_S = 60;

// ---------------------------------------------------------------------------
// Reloj propio del PJ
// ---------------------------------------------------------------------------

export function aheadUntil(c: Character): number | null {
  const v = (c as Traveller).ahead_until_game_s;
  return typeof v === 'number' ? v : null;
}

/** Ahora del PJ: el del mundo, o la hora a la que llegó si va por delante. */
export function nowFor(c: Character, worldNowS: number): number {
  return Math.max(worldNowS, aheadUntil(c) ?? -Infinity);
}

/** Adelanta el reloj del PJ hasta `gameS` (si queda por delante del mundo). */
export function setAhead(c: Character, gameS: number, worldNowS: number): void {
  const t = c as Traveller;
  if (gameS > worldNowS) t.ahead_until_game_s = gameS;
  else delete t.ahead_until_game_s;
}

/** El mundo ya ha alcanzado al PJ: borra la marca. true si había algo que borrar. */
export function clearAheadIfCaught(c: Character, worldNowS: number): boolean {
  const a = aheadUntil(c);
  if (a === null || a > worldNowS) return false;
  delete (c as Traveller).ahead_until_game_s;
  return true;
}

export function journeyOf(c: Character): PausedJourney | null {
  return (c as Traveller).journey ?? null;
}

export function setJourney(c: Character, j: PausedJourney | null): void {
  if (j) (c as Traveller).journey = j;
  else delete (c as Traveller).journey;
}

/** ¿Cruza a otra localización este tránsito? Solo esos son viaje rápido con encuentro. */
export function crossesLocations(t: Transit): boolean {
  return t.legs.some((l) => l.via_exit_id !== undefined);
}

export function isWaypoint(spot: Spot): boolean {
  return spot.tags.includes('waypoint');
}

// ---------------------------------------------------------------------------
// Probabilidad y tabla
// ---------------------------------------------------------------------------

/** Base por tipo de zona: poblado casi nada, campo abierto algo, lo salvaje más. */
function baseChance(kind: string): number {
  if (/town|village|city|aldea|pueblo|ciudad|villa/.test(kind)) return 0.03;
  if (/dungeon|cave|ruin|mazmorra|cueva|ruina/.test(kind)) return 0.25;
  if (/mountain|swamp|marsh|wild|desert|monta|pantano|cienaga|desierto/.test(kind)) return 0.2;
  if (/forest|wood|jungle|bosque|selva|arboleda/.test(kind)) return 0.15;
  return 0.1; // camino, campo, río…
}

const PACE_FACTOR: Record<Pace, number> = { stealth: 0.4, walk: 1, run: 1.2 };
/** Distancia de referencia: a 500 m la base cuenta entera; el factor se topa en ×2. */
const REF_DISTANCE_M = 500;
/** Por debajo de esto (entre localizaciones) no hay encuentro: una puerta, un portal. */
export const MIN_DISTANCE_M = 100;
const MAX_CHANCE = 0.75;

function zoneKindOf(world: World, loc: Location): string {
  return world.zones.get(loc.zone_id)?.kind ?? '';
}

/** El tramo entre localizaciones más largo del trayecto: ahí cae el encuentro. */
function encounterLegIndex(t: Transit): number {
  let best = -1;
  for (let i = 0; i < t.legs.length; i++) {
    const l = t.legs[i]!;
    if (l.via_exit_id === undefined) continue;
    if (best < 0 || l.distance_m > t.legs[best]!.distance_m) best = i;
  }
  return best;
}

/** Zona «más salvaje» de los dos extremos de una salida (la que da más probabilidad). */
function wilderSide(world: World, exit: Exit): { loc: Location; kind: string } {
  const a = world.locationOfSpot(exit.from_spot_id);
  const b = world.locationOfSpot(exit.to_spot_id);
  const ka = zoneKindOf(world, a);
  const kb = zoneKindOf(world, b);
  return baseChance(kb) >= baseChance(ka) ? { loc: b, kind: kb } : { loc: a, kind: ka };
}

function isNight(clock: GameClock, gameS: number): boolean {
  return clock.outdoorLight(gameS) !== 'day';
}

/**
 * Probabilidad de encuentro de este trayecto. `location.state.travel_encounter_chance`
 * (0-1) en cualquiera de los dos extremos manda: sirve para forzarlo o quitarlo.
 * Si no: base de la zona × distancia (entre localizaciones) × luz × ritmo.
 */
export function travelEncounterChance(world: World, clock: GameClock, t: Transit): { chance: number; leg_index: number; zone_kind: string } {
  const i = encounterLegIndex(t);
  if (i < 0) return { chance: 0, leg_index: -1, zone_kind: '' };
  const leg = t.legs[i]!;
  const exit = world.exit(leg.via_exit_id!);
  const side = wilderSide(world, exit);
  for (const loc of [world.locationOfSpot(leg.to_spot_id), world.locationOfSpot(leg.from_spot_id)]) {
    const v = loc.state['travel_encounter_chance'];
    if (typeof v === 'number' && Number.isFinite(v)) return { chance: Math.max(0, Math.min(1, v)), leg_index: i, zone_kind: side.kind };
  }
  const crossM = t.legs.filter((l) => l.via_exit_id !== undefined).reduce((a, l) => a + l.distance_m, 0);
  if (crossM < MIN_DISTANCE_M) return { chance: 0, leg_index: i, zone_kind: side.kind }; // cruzar una puerta no es un viaje
  const dist = Math.min(2, crossM / REF_DISTANCE_M);
  const mid = leg.ends_game_s - leg.duration_s / 2;
  const light = clock.outdoorLight(mid);
  const lightF = light === 'day' ? 1 : light === 'twilight' ? 1.5 : 2;
  const chance = Math.min(MAX_CHANCE, baseChance(side.kind) * dist * lightF * PACE_FACTOR[t.pace]);
  return { chance, leg_index: i, zone_kind: side.kind };
}

/** Tabla por defecto, válida para cualquier mundo: el master pone los nombres y el detalle. */
export const DEFAULT_ENCOUNTERS: EncounterEntry[] = [
  {
    id: 'bandits', weight: 2, night_weight: 2,
    teaser: 'Voces delante, en mitad del camino. Te cortan el paso.',
    what: 'Bandidos en el camino: dos o tres salteadores cortan el paso y piden peaje o lo que lleve encima. No atacan de entrada: amenazan y dejan reaccionar (pagar, negociar, huir, pelear). Si hay pelea, con stats sensatos para el nivel del PJ.',
  },
  {
    id: 'traveller', weight: 2, when: 'day',
    teaser: 'Alguien viene por el camino en sentido contrario y te saluda con la mano.',
    what: 'Un viajero que va en sentido contrario se para a charlar. Trae un rumor de la zona: uno de los rumores del contexto si encaja, o siembra uno nuevo con plant_rumor. Que sea alguien concreto (oficio, prisa, algo que lleva) y que se despida pronto.',
  },
  {
    id: 'find', weight: 2,
    teaser: 'Algo junto al camino te hace parar.',
    what: 'Un hallazgo junto al camino: huellas recientes, restos de un campamento, un fardo abandonado o algo que no debería estar ahí. Acorde con la zona y con las pistas pendientes si alguna encaja (sin regalarla). Si es un objeto, créalo con tools; si pide examinarlo, tirada.',
  },
  {
    id: 'animal', weight: 3,
    teaser: 'Un crujido entre la maleza, muy cerca del camino.',
    what: 'Un animal de la zona se cruza en el camino (un jabalí, un lobo solitario, un ciervo, un perro asilvestrado…). Puede huir, observar o embestir según lo que haga el PJ. Combate solo si el PJ lo busca o el animal está acorralado.',
  },
];

/** Tabla para un tipo de zona: `campaign.encounters[kind]`, luego `['*']`, luego la de por defecto. */
export function encounterTable(world: World, kind: string): EncounterEntry[] {
  const camp = world.campaign as typeof world.campaign & { encounters?: EncounterTable };
  const t = camp.encounters;
  const own = t?.[kind] ?? t?.['*'];
  if (own?.length) return own;
  if (/town|village|city|aldea|pueblo|ciudad|villa/.test(kind)) return DEFAULT_ENCOUNTERS.filter((e) => e.id !== 'bandits');
  return DEFAULT_ENCOUNTERS;
}

export function pickEntry(table: EncounterEntry[], night: boolean, rng: Rng): EncounterEntry | null {
  const fit = table.filter((e) => !e.when || (e.when === 'night') === night);
  const weights = fit.map((e) => (e.weight ?? 1) * (night ? e.night_weight ?? 1 : 1));
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (let i = 0; i < fit.length; i++) {
    r -= weights[i]!;
    if (r < 0) return fit[i]!;
  }
  return fit.at(-1) ?? null;
}

/**
 * Tirada de encuentro de un trayecto ya planificado (tránsito con sus
 * instantes sellados). null si no cruza de localización, si sale de un punto
 * de camino (es la continuación de un viaje que ya tuvo su encuentro) o si no
 * sale la tirada.
 */
export function rollTravelEncounter(world: World, clock: GameClock, t: Transit, rng: Rng): TravelEncounter | null {
  const origin = world.spots.get(t.origin_spot_id);
  if (!origin || isWaypoint(origin)) return null;
  const { chance, leg_index, zone_kind } = travelEncounterChance(world, clock, t);
  if (leg_index < 0 || chance <= 0) return null;
  const roll = rng();
  if (roll >= chance) return null;
  const leg = t.legs[leg_index]!;
  const at = leg.ends_game_s - leg.duration_s / 2;
  const entry = pickEntry(encounterTable(world, zone_kind), isNight(clock, at), rng);
  if (!entry) return null;
  const after = t.legs.slice(leg_index + 1).reduce((a, l) => a + l.distance_m, 0);
  return {
    entry, chance, roll, zone_kind,
    exit_id: leg.via_exit_id!,
    waypoint_spot_id: waypointSpotId(leg.via_exit_id!),
    origin_spot_id: t.origin_spot_id,
    destination_spot_id: t.destination_spot_id,
    at_game_s: at,
    remaining_m: Math.round(leg.distance_m / 2 + after),
    remaining_s: t.arrives_game_s - at,
  };
}

// ---------------------------------------------------------------------------
// Punto de camino
// ---------------------------------------------------------------------------

export function waypointSpotId(exitId: Id): Id { return `sp_way_${exitId}`; }

/**
 * Punto de camino de una salida: una localización de un solo punto a mitad de
 * la salida, con dos salidas de ida (a cada extremo, la mitad de distancia).
 * Se crea la primera vez y se reutiliza. Las salidas no son bidireccionales:
 * nadie enruta a través de él; solo se sale de él.
 */
export function ensureWaypoint(world: World, exitId: Id): Spot {
  const spotId = waypointSpotId(exitId);
  const existing = world.spots.get(spotId);
  if (existing) return existing;
  const exit = world.exit(exitId);
  const a = world.locationOfSpot(exit.from_spot_id);
  const b = world.locationOfSpot(exit.to_spot_id);
  const side = wilderSide(world, exit);
  const locId = `loc_way_${exitId}`;
  const loc: Location = {
    id: locId, zone_id: side.loc.zone_id, name: `Camino entre ${a.name} y ${b.name}`,
    description_base: `El camino que une ${a.name} y ${b.name}, a medio trecho de los dos.`,
    default_spot_id: spotId, indoor: false, ambience: { light: 'natural', noise: 1 },
    state: { waypoint: true }, discovery: {},
  };
  const spot: Spot = {
    id: spotId, location_id: locId, name: 'un tramo del camino', aliases: ['camino', 'el camino'],
    description: 'Tierra pisada y la vista abierta hacia los dos lados.',
    x: 0, y: 0, capacity: null, hidden: false, discovered_by: [], state: {},
    tags: ['waypoint', 'road'], terrain_multiplier: exit.terrain_multiplier, entry_cost_s: 0, links: [],
  };
  world.locations.set(loc.id, loc);
  world.spots.set(spot.id, spot);
  world.touch('locations', loc.id);
  world.touch('spots', spot.id);
  for (const [suffix, to] of [['a', exit.from_spot_id], ['b', exit.to_spot_id]] as const) {
    const e: Exit = {
      id: `ex_way_${exitId}_${suffix}`, from_spot_id: spotId, to_spot_id: to,
      distance_m: exit.distance_m / 2, terrain_multiplier: exit.terrain_multiplier, bidirectional: false, state: {},
    };
    world.exits.set(e.id, e);
    world.touch('exits', e.id);
  }
  return spot;
}

/**
 * Corta el tránsito en el encuentro: los tramos de antes se mantienen y el
 * del encuentro acaba en el punto de camino, a mitad de la salida.
 */
export function stopAtEncounter(world: World, c: Character, enc: TravelEncounter): void {
  const t = c.transit!;
  ensureWaypoint(world, enc.exit_id);
  const i = t.legs.findIndex((l) => l.via_exit_id === enc.exit_id);
  const leg = t.legs[i]!;
  const half = { ...leg, to_spot_id: enc.waypoint_spot_id, distance_m: leg.distance_m / 2, duration_s: leg.duration_s / 2, ends_game_s: enc.at_game_s };
  c.transit = { ...t, destination_spot_id: enc.waypoint_spot_id, legs: [...t.legs.slice(0, i), half], arrives_game_s: enc.at_game_s };
  world.touch('characters', c.id);
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

const CONTINUE = /^(?:continuar|continuo|contin[uú]o|seguir|sigo|reanudar|reanudo)\s+(?:el\s+|mi\s+)?(?:viaje|camino)(?:\s+con\s+cuidado)?$/;
const CAREFUL = /^(?:viajar|viajo|ir|voy|salir|salgo|partir|parto|marcharme|me marcho)\s+con\s+cuidado\s+(?:hacia|a|al|hasta|para|rumbo a)\s+(.+)$|^(?:viajar|viajo|ir|voy|salir|salgo|partir|parto)\s+(?:hacia|a|al|hasta|para|rumbo a)\s+(.+?)\s+con\s+cuidado$/;

export type TravelIntent = { kind: 'continue'; careful: boolean } | { kind: 'careful'; target: string };

/** «Continuar el viaje» y «viajar con cuidado hacia X» (o «salir hacia X con cuidado»). */
export function parseTravel(text: string): TravelIntent | null {
  const t = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  if (CONTINUE.test(t)) return { kind: 'continue', careful: /con cuidado$/.test(t) };
  const m = t.match(CAREFUL);
  if (m) return { kind: 'careful', target: (m[1] ?? m[2]!).trim() };
  return null;
}

const LIGHT_WORD = { day: 0, twilight: 1, night_moon: 2, night_dark: 2 } as const;

/** Cómo ha cambiado la luz por el camino: «anochece», «ya es de noche», «amanece»… o ''. */
function lightChange(clock: GameClock, fromS: number, toS: number): string {
  const a = LIGHT_WORD[clock.outdoorLight(fromS)];
  const b = LIGHT_WORD[clock.outdoorLight(toS)];
  if (a === b) return '';
  const evening = clock.dateTime(toS).hour >= 12;
  if (b === 2) return 'ya es de noche';
  if (b === 1) return evening ? 'anochece' : 'clarea';
  return 'ya es de día';
}

/** «Has tardado 2 h de camino; anochece.» Vacío si el trayecto ha durado menos de un minuto. */
export function travelNote(clock: GameClock, departedS: number, arrivedS: number): string {
  const d = arrivedS - departedS;
  if (d < 60) return '';
  const change = lightChange(clock, departedS, arrivedS);
  return `Has tardado ${fmtDuration(d)} de camino${change ? `; ${change}` : ''}. Son las ${clock.format(arrivedS).slice(-5)}.`;
}

/** Lo primero que lee el jugador al pararse en el camino. */
export function encounterTeaser(world: World, enc: TravelEncounter): string {
  const dest = world.locationOfSpot(enc.destination_spot_id);
  return `🛤️ A medio camino hacia ${dest.name} (quedan ${enc.remaining_m} m, unos ${fmtDuration(enc.remaining_s)}). ${enc.entry.teaser ?? 'Algo te hace parar.'}`;
}

/** Bloque del contexto del master para un viaje (prompt.ts). */
export function travelBlock(world: World, clock: GameClock, h: TravelHint): string {
  if (h.kind === 'arrival') {
    const note = travelNote(clock, h.departed_game_s, h.arrived_game_s);
    return `## Viaje\n${note || 'Trayecto corto.'} El servidor ya ha contado ese tiempo: menciónalo de pasada si importa (la luz, el cansancio), sin hacerle esperar.`;
  }
  const e = h.encounter;
  const origin = world.locationOfSpot(e.origin_spot_id);
  const destSpot = world.spot(e.destination_spot_id);
  const dest = world.location(destSpot.location_id);
  return [
    '## Encuentro en el camino',
    `Iba de ${origin.name} hacia ${destSpot.name} (${dest.name}) y se ha parado a medio camino, en ${world.locationOfSpot(e.waypoint_spot_id).name}. Le quedan ${e.remaining_m} m, unos ${fmtDuration(e.remaining_s)} de juego. Son las ${clock.format(e.at_game_s).slice(-5)}.`,
    `Qué es: ${e.entry.what}`,
    `Ya ha leído: «${e.entry.teaser ?? 'Algo te hace parar.'}». Esto NO es una llegada normal: haz que el encuentro ocurra ahora delante de él, concreto y acorde con la zona y la hora, y deja que reaccione (no decidas por él). Gente u objetos nuevos, con tools.`,
    'Cuando la escena lo permita, incluye «Continuar el viaje» entre las acciones sugeridas: lo resuelve el servidor y llega al destino. No lo muevas tú. Si prefiere volver, «Salir hacia ' + origin.name + '».',
  ].join('\n');
}

/** Acciones tras pararse en el camino, sin master. */
export function encounterSuggestions(world: World, enc: TravelEncounter): string[] {
  const origin = world.locationOfSpot(enc.origin_spot_id);
  return ['Continuar el viaje', `Salir hacia ${origin.name}`];
}

