/**
 * Relleno semántico del esqueleto (PLAN: capa 3). Tres llamadas a la API, cada
 * una con salida estructurada (output_config.format con un JSON Schema
 * estricto y pequeño; nunca prefill):
 *
 *   1. mundo:        campaña, Biblia, leyes, nombres y descripciones de lugares y puntos
 *   2. gente:        NPC, comercio, pistas, encargos, facción y logro (lee lo de 1)
 *   3. situaciones:  la situación inicial de cada PJ y las de reserva (lee 1 y 2)
 *
 * Por qué partes: la API compila cada esquema a una gramática con un tamaño
 * máximo, y el relleno entero en un solo esquema lo pasaba (400 «compiled
 * grammar is too large»). Cada parte se valida y se reintenta una vez con sus
 * errores. Si aun así una parte no cabe, esa parte se pide como JSON sin
 * gramática (el esquema va en el prompt) y se valida igual; queda en el log.
 * Lo que no necesita al modelo lo pone el código: ids de los encargos por
 * orden, precios dentro de bandas, actitudes y horas por defecto.
 *
 * Sin API (modo offline, sin clave o en tests) sale un relleno determinista
 * de plantilla (offline.ts): menos literario, igual de jugable.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Attitude, Id, ItemDef } from '../engine/model.js';
import { makeSeed } from '../data/seed/demo.js';
import { PLACES, type Genre } from './catalog.js';
import { offlineFill } from './offline.js';
import { ROOM_ITEMS } from './rooms.js';
import { ARCHETYPES, skeletonSpots, SRD_STAT_RANGES, type Skeleton, type SkLocation, type SkNpc, type Tone } from './skeleton.js';

export { offlineFill } from './offline.js';

export const DEFAULT_WORLDGEN_MODEL = 'claude-sonnet-5-5';
export const SPARE_SITUATIONS = 2;

/** Lo que se sabe de un PJ al generar el mundo. `hook`: lo que el jugador cuenta de por qué viene (opcional). */
export interface PcBrief { name: string; race?: string; class_name?: string; hook?: string }

export interface SituationFill {
  /** Nombre del PJ; vacío en las de reserva. */
  for_name: string;
  why_here: string; wants: string; threat: string;
  clock_days: number; clock_runs_out: string;
  antagonist_npc_id: Id; start_spot_id: Id;
  /** Hora de juego (0-23) a la que empieza. */
  start_hour: number;
  paths: string[]; opening: string;
}

/** Parte 1: el mundo. */
export interface WorldPart {
  campaign_name: string;
  /** Nombre del asentamiento (zona, región y orígenes salen de aquí). */
  town_name: string;
  premise: string;
  welcome: string;
  bible: string[];
  laws: string[];
  locations: { id: Id; name: string; description: string; spots: { id: Id; name: string; description: string }[] }[];
}

/** Parte 2: la gente y la trama. */
export interface PeoplePart {
  npcs: { id: Id; name: string; description: string; motivation: string; secret: string; attitude: string }[];
  /** Comercio: qué compra o vende cada NPC y a qué precio. */
  trade: { npc_id: Id; buys_or_sells: string; item_id: Id; price: number }[];
  clues: { title: string; how: string; location_ids: Id[]; npc_ids: Id[] }[];
  /** En el orden de los encargos del esqueleto; la id la pone el código. */
  jobs: { id: Id; title: string; text: string; giver_npc_id: Id }[];
  faction: { name: string; description: string };
  achievement: { title: string; announcement: string; reward_item_name: string };
}

/** Parte 3: las situaciones iniciales. */
export interface SituationsPart { situations: SituationFill[] }

/** El relleno entero (lo que valida `validateFill` y consume `buildSnapshot`). */
export type WorldFill = WorldPart & PeoplePart & SituationsPart;

export type PartName = 'world' | 'people' | 'situations';

// ---------------------------------------------------------------------------
// Catálogo: los objetos de la semilla demo que se pueden comprar y vender.
// ---------------------------------------------------------------------------

const DEMO_ITEMS = makeSeed().item_defs;
/** Objetos del catálogo común (todo menos lo único de la demo). */
export const CATALOG: readonly ItemDef[] = [...DEMO_ITEMS.filter((d) => !d.unique), ...ROOM_ITEMS];
/** Lo que un NPC puede comprar o vender. */
export const TRADE_ITEMS: readonly ItemDef[] = CATALOG.filter((d) => d.value > 0 && !d.container?.fixed && !d.service);

export const ATTITUDES: readonly Attitude[] = ['hostile', 'unfriendly', 'neutral', 'friendly', 'allied'];

// ---------------------------------------------------------------------------
// Esquemas (strict: additionalProperties false y todo requerido)
// ---------------------------------------------------------------------------

const str = { type: 'string' } as const;
const strs = { type: 'array', items: str } as const;
const int = { type: 'integer' } as const;
const arr = (items: unknown) => ({ type: 'array', items });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const PART_SCHEMAS: Record<PartName, Record<string, unknown>> = {
  world: obj({
    campaign_name: str, town_name: str, premise: str, welcome: str, bible: strs, laws: strs,
    locations: arr(obj({ id: str, name: str, description: str, spots: arr(obj({ id: str, name: str, description: str })) })),
  }),
  people: obj({
    npcs: arr(obj({ id: str, name: str, description: str, motivation: str, secret: str, attitude: str })),
    trade: arr(obj({ npc_id: str, buys_or_sells: str, item_id: str, price: int })),
    clues: arr(obj({ title: str, how: str, location_ids: strs, npc_ids: strs })),
    jobs: arr(obj({ title: str, text: str, giver_npc_id: str })),
    faction: obj({ name: str, description: str }),
    achievement: obj({ title: str, announcement: str, reward_item_name: str }),
  }),
  situations: obj({
    situations: arr(obj({
      for_name: str, why_here: str, wants: str, threat: str, clock_days: int, clock_runs_out: str,
      antagonist_npc_id: str, start_spot_id: str, start_hour: int, paths: strs, opening: str,
    })),
  }),
};

/**
 * Medida de un esquema: su JSON serializado. No es el tamaño de la gramática
 * que compila la API, pero crece con él: el relleno entero en un esquema
 * (3034 caracteres) ya no cabía y uno de 3010 cabía por poco. Cada parte debe
 * quedar muy por debajo.
 */
export function schemaChars(schema: unknown): number { return JSON.stringify(schema).length; }
/** Lo que hoy cabe seguro, con margen (≈60 % de lo último que cupo). */
export const MAX_PART_SCHEMA_CHARS = 1800;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const TONE_ES: Record<Tone, string> = {
  epic: 'épico: grandes fuerzas en juego, gente corriente ante algo mayor',
  grim: 'sombrío: fantasía oscura, decisiones con precio, nada es gratis',
  comedy: 'cómico: situaciones absurdas tratadas con seriedad, personajes excéntricos, sin romper el mundo',
  horror: 'terror: lo inquietante crece despacio, lo que no se ve asusta más',
  pulp: 'pulp: acción, villanos con carisma, secretos y persecuciones',
};

export const GENRE_DEFAULT: Record<Genre, string> = {
  fantasy: 'Fantasía medieval de baja magia.',
  scifi: 'Ciencia ficción de frontera: colonias pobres, naves viejas, corporaciones lejanas.',
  postapoc: 'Postapocalíptico: el mundo cayó hace una generación; se vive de la chatarra y del agua.',
};

const COMMON = [
  'Eres el diseñador de mundos de un juego de rol por chat (D&D 5e, en castellano) con un máster IA.',
  'Te dan el esqueleto de una región inicial ya decidido por código: el tipo de asentamiento (no tiene por qué haber posada ni posadero), sus localizaciones y puntos, NPC por papel, encargos y cuántas pistas. No cambias la estructura: le pones nombres, prosa y verdad. Respeta el género de la ambientación (fantasía, ciencia ficción o postapocalíptico) en nombres, objetos y verdades. Usa exactamente las ids que te dan.',
  'Estilo: castellano de España, frases cortas, nada de clichés ("un aire de misterio"). Coherencia interna por encima de todo.',
].join('\n');

export const PART_SYSTEM: Record<PartName, string> = {
  world: [COMMON, '', 'En esta parte escribes el mundo:',
    '- Nombre de la campaña, nombre del asentamiento, premisa (2-3 frases, sin desvelar la Biblia) y una bienvenida mística de 2-3 líneas en voz del máster que contenga {name} (se sustituye por el nombre del PJ).',
    '- Biblia: 5-10 verdades ocultas del mundo, frases cortas y concretas: la verdad que nadie cuenta entera. Lo que se escriba después (secretos, pistas, amenazas) se apoyará en ellas, así que deja ganchos para la gente del esqueleto.',
    '- Leyes del mundo: 4-6 frases sobre lo que en este mundo no puede pasar por mucho que el jugador lo pida (magia, tecnología, muerte, límites del cuerpo), adaptadas a la ambientación.',
    '- Cada localización (todas, una vez cada una, con todos sus puntos) y cada punto: nombre propio cuando toque (los edificios con dueño y los exteriores tienen nombre; "la barra" no) y una descripción de una frase, concreta y sensorial. Los puntos que llevan a otra localización (leads_to) se nombran por adónde llevan ("la puerta de la Lonja Vieja"). Los nombres de punto no se repiten dentro de su localización y los de localización no se repiten. Conserva en el nombre de cada punto la palabra de su plantilla (barra, pozo, tablón, portón…): con ella lo nombran los jugadores y se dibuja el plano.',
  ].join('\n'),
  people: [COMMON, '', 'En esta parte escribes la gente y la trama, sobre el mundo ya escrito (te lo dan):',
    '- Cada NPC del esqueleto, una vez: nombre único, descripción física de 1-2 frases con un gesto propio, motivación, un secreto coherente con la Biblia y actitud por defecto (hostile, unfriendly, neutral, friendly o allied; la bestia, hostile). La bestia se nombra con artículo indeterminado ("un lobo de lomo cano"), sin secreto, y no comercia.',
    '- Comercio (trade): para dos o tres NPC a los que les cuadre comerciar, qué compran y venden (buys_or_sells: "buys" o "sells") del catálogo, con precios enteros cercanos al valor. Lo que dan los recursos del campo, alguien lo compra.',
    '- Pistas: exactamente las que pide el esqueleto. Título corto y "how" para el máster: cómo se obtiene (acción, tirada y CD 10-16) y qué revela. Ancla cada una a una localización (location_ids) o a un NPC que no sea la bestia (npc_ids). Juntas apuntan a la verdad central de la Biblia.',
    '- Encargos: uno por cada encargo del esqueleto y en el mismo orden, coherente con su tipo (deliver: entregar el objeto y la cantidad indicados; visit: ir al punto y volver a contarlo; narrative: un favor que el máster resuelve en ficción). Título y texto de tablón en una o dos frases, y quién lo pide (un NPC que no sea la bestia).',
    '- Facción local y logro (título, anuncio con {name}, y el nombre del objeto que se gana). El logro da además el punto oculto punto_del_logro. Los cuartos_de_alquiler están a la vista y cerrados con llave: se alquilan por noches a quien atiende el lugar.',
  ].join('\n'),
  situations: [COMMON, '', 'En esta parte escribes las situaciones iniciales, sobre el mundo y la gente ya escritos (te los dan). Una por cada PJ de la lista y además ' + SPARE_SITUATIONS + ' de reserva con for_name vacío para quien llegue después. Es el porqué personal del PJ, no "estás en una taberna":',
    '- why_here: por qué está aquí ahora, en segunda persona, concreto, enlazado a la Biblia sin destriparla.',
    '- wants: lo que quiere conseguir. threat: lo que le amenaza a él personalmente.',
    '- clock_days (entero, 1-14) y clock_runs_out: qué pasa si vence el plazo.',
    '- antagonist_npc_id: un NPC cercano de la lista (no la bestia) que se le opone, abiertamente o no.',
    '- start_spot_id y start_hour (0-23): dónde y a qué hora empieza, lo que pida su historia: despertar en una celda, desembarcar en el muelle, salir de la mina al amanecer, un funeral, un mercado a punto de cerrar… Solo de los puntos para situaciones. Una posada solo si la historia lo pide. Las situaciones de un mismo mundo empiezan en sitios distintos.',
    '- paths: exactamente tres caminos posibles y distintos (por ejemplo: enfrentarse, negociar o pactar, investigar o huir), cada uno una frase con un primer paso concreto en este mundo.',
    '- opening: lo que le está pasando en el primer instante, en el cuerpo o los sentidos, y que pide una decisión.',
    'Si el jugador cuenta algo de su PJ (hook), úsalo y no lo contradigas.',
  ].join('\n'),
};

/** Lo común del esqueleto para cualquier parte. */
function baseView(sk: Skeleton) {
  return { tono: TONE_ES[sk.tone], ambientacion: sk.setting || GENRE_DEFAULT[sk.genre], genero: sk.genre, asentamiento: sk.settlement.label };
}
const pcView = (pcs: PcBrief[]) => pcs.map((p) => ({ nombre: p.name, ...(p.race ? { raza: p.race } : {}), ...(p.class_name ? { clase: p.class_name } : {}), ...(p.hook ? { hook: p.hook } : {}) }));

/** Prompt de cada parte: el esqueleto que le toca y lo ya escrito. */
export function partPrompt(part: PartName, sk: Skeleton, pcs: PcBrief[], done: { world?: WorldPart; people?: PeoplePart } = {}): string {
  const w = done.world, p = done.people;
  const locNames = w ? w.locations.map((l) => ({ id: l.id, nombre: l.name })) : undefined;
  const spotName = (id: Id) => w?.locations.flatMap((l) => l.spots).find((s) => s.id === id)?.name ?? skeletonSpots(sk).find((s) => s.id === id)?.name ?? id;
  const npcs = sk.npcs.map((n: SkNpc) => ({ id: n.id, papel: n.role_label, en: spotName(n.spot_id), ...(n.role === 'beast' ? { bestia: true } : {}) }));
  let view: Record<string, unknown>;
  if (part === 'world') {
    view = {
      ...baseView(sk),
      localizaciones: sk.locations.map((l: SkLocation) => ({
        id: l.id, tipo: l.label, zona: l.zone_id === 'zn_town' ? 'asentamiento' : 'afueras', interior: l.indoor,
        puntos: l.spots.map((s) => ({ id: s.id, plantilla: s.name, tags: s.tags, ...(s.hidden ? { oculto: true } : {}), ...(s.leads_to ? { leads_to: s.leads_to } : {}) })),
      })),
      npcs: npcs.map(({ papel }) => papel),
    };
  } else if (part === 'people') {
    view = {
      ...baseView(sk),
      mundo: w && { campaña: w.campaign_name, asentamiento: w.town_name, premisa: w.premise, biblia: w.bible, localizaciones: locNames },
      npcs,
      recursos: sk.resources.map((r) => ({ en: spotName(r.spot_id), da: r.item_id })),
      encargos: sk.jobs.map((j) => ({ tipo: j.kind, ...(j.deliver ? { entregar: j.deliver } : {}), ...(j.visit_spot_id ? { ir_a: spotName(j.visit_spot_id) } : {}), recompensa: j.reward_coins })),
      pistas: sk.clue_count,
      punto_del_logro: spotName(sk.reward_spot_id),
      cuartos_de_alquiler: skeletonSpots(sk).filter((s) => s.locked).map((s) => spotName(s.id)),
      catalogo: TRADE_ITEMS.map((d) => ({ id: d.id, nombre: d.name, valor: d.value })),
    };
  } else {
    const loc = new Map(sk.locations.flatMap((l) => l.spots.map((s) => [s.id, l.id] as const)));
    view = {
      ...baseView(sk),
      mundo: w && { asentamiento: w.town_name, premisa: w.premise, biblia: w.bible },
      gente: p ? p.npcs.map((n) => ({ id: n.id, nombre: n.name, papel: sk.npcs.find((x) => x.id === n.id)?.role_label, motivacion: n.motivation, secreto: n.secret })) : npcs,
      puntos_para_situaciones: sk.situation_spot_ids.map((id) => ({ id, nombre: spotName(id), lugar: locNames?.find((l) => l.id === loc.get(id))?.nombre ?? loc.get(id) })),
      personajes: pcView(pcs),
    };
  }
  return `${part === 'world' ? 'Esqueleto del mundo' : 'Lo que necesitas del mundo'} (JSON):\n${JSON.stringify(view)}\n\nRellena esta parte según el esquema.`;
}

// ---------------------------------------------------------------------------
// Partir, normalizar y juntar
// ---------------------------------------------------------------------------

export function splitFill(f: WorldFill): { world: WorldPart; people: PeoplePart; situations: SituationsPart } {
  return {
    world: { campaign_name: f.campaign_name, town_name: f.town_name, premise: f.premise, welcome: f.welcome, bible: f.bible, laws: f.laws, locations: f.locations },
    people: { npcs: f.npcs, trade: f.trade, clues: f.clues, jobs: f.jobs, faction: f.faction, achievement: f.achievement },
    situations: { situations: f.situations },
  };
}

export function assembleFill(world: WorldPart, people: PeoplePart, situations: SituationsPart): WorldFill {
  return { ...world, ...people, ...situations };
}

/** Lo que el código pone sin preguntar al modelo en la parte de gente: ids de encargos, bandas de precios, actitudes. */
export function normalizePeople(sk: Skeleton, p: PeoplePart): PeoplePart {
  const value = new Map(TRADE_ITEMS.map((d) => [d.id, d.value]));
  return {
    ...p,
    npcs: p.npcs.map((n) => {
      const beast = sk.npcs.find((x) => x.id === n.id)?.role === 'beast';
      const att = String(n.attitude ?? '').trim().toLowerCase();
      return { ...n, secret: n.secret ?? '', attitude: beast ? 'hostile' : (ATTITUDES as readonly string[]).includes(att) ? att : 'neutral' };
    }),
    trade: p.trade.map((t) => {
      const v = value.get(t.item_id);
      const dir = /^(b|compr)/i.test(String(t.buys_or_sells ?? '').trim()) ? 'buys' : 'sells';
      const price = v === undefined ? t.price : Math.min(Math.max(Math.round(Number(t.price) || v), Math.max(1, Math.round(v * 0.5))), Math.max(2, v * 3));
      return { ...t, buys_or_sells: dir, price };
    }),
    jobs: p.jobs.map((j, i) => ({ ...j, id: sk.jobs[i]?.id ?? j.id ?? `job_${i + 1}` })),
  };
}

/** En las situaciones: plazo dentro de [1, 30] y, si la hora no vale, la que da el tipo de lugar. */
export function normalizeSituations(sk: Skeleton, s: SituationsPart): SituationsPart {
  const kindOf = new Map(sk.locations.flatMap((l) => l.spots.map((x) => [x.id, l.kind] as const)));
  return {
    situations: s.situations.map((x) => {
      const h = Number(x.start_hour);
      const kind = kindOf.get(x.start_spot_id);
      const hours = kind ? (PLACES[kind] as { hours?: number[] }).hours : undefined;
      return {
        ...x, for_name: x.for_name ?? '',
        clock_days: Math.min(30, Math.max(1, Math.round(Number(x.clock_days) || 3))),
        start_hour: Number.isInteger(h) && h >= 0 && h <= 23 ? h : hours?.[0] ?? 9,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';

function checker() {
  const errs: string[] = [];
  const once = <V>(what: string, expected: Iterable<Id>, got: V[], idOf: (v: V) => Id) => {
    const want = new Set(expected);
    const seen = new Map<Id, number>();
    for (const g of got) {
      const id = idOf(g);
      if (!want.has(id)) errs.push(`${what}: la id ${id} no existe en el esqueleto.`);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const id of want) {
      const n = seen.get(id) ?? 0;
      if (n === 0) errs.push(`${what}: falta ${id}.`);
      if (n > 1) errs.push(`${what}: ${id} aparece ${n} veces.`);
    }
  };
  const unique = (what: string, names: string[]) => {
    const seen = new Set<string>();
    for (const n of names) {
      if (blank(n)) { errs.push(`${what}: hay un nombre vacío.`); continue; }
      if (seen.has(norm(n))) errs.push(`${what}: el nombre «${n}» está repetido.`);
      seen.add(norm(n));
    }
  };
  return { errs, once, unique };
}

const isPerson = (sk: Skeleton, id: Id) => sk.npcs.some((n) => n.id === id && n.role !== 'beast');

export function validateWorld(sk: Skeleton, f: WorldPart): string[] {
  const { errs, once, unique } = checker();
  for (const k of ['campaign_name', 'town_name', 'premise', 'welcome'] as const) if (blank(f[k])) errs.push(`${k} está vacío.`);
  if (!Array.isArray(f.bible) || f.bible.length < 5 || f.bible.length > 10) errs.push(`La Biblia debe tener entre 5 y 10 verdades (tiene ${f.bible?.length ?? 0}).`);
  if (!Array.isArray(f.laws) || f.laws.length < 3 || f.laws.length > 8) errs.push(`Las leyes del mundo deben ser entre 3 y 8 (hay ${f.laws?.length ?? 0}).`);
  once('localizaciones', sk.locations.map((l) => l.id), f.locations ?? [], (l) => l.id);
  unique('localizaciones', (f.locations ?? []).map((l) => l.name));
  for (const l of f.locations ?? []) {
    const sl = sk.locations.find((x) => x.id === l.id);
    if (!sl) continue;
    once(`puntos de ${l.id}`, sl.spots.map((s) => s.id), l.spots ?? [], (s) => s.id);
    unique(`puntos de ${l.id}`, (l.spots ?? []).map((s) => s.name));
  }
  return errs;
}

export function validatePeople(sk: Skeleton, f: PeoplePart): string[] {
  const { errs, once, unique } = checker();
  const locIds = new Set(sk.locations.map((l) => l.id));
  const npcIds = new Map(sk.npcs.map((n) => [n.id, n]));
  const tradeIds = new Set(TRADE_ITEMS.map((d) => d.id));
  if (blank(f.faction?.name)) errs.push('La facción no tiene nombre.');
  if (blank(f.achievement?.title) || blank(f.achievement?.reward_item_name)) errs.push('El logro necesita título y objeto.');
  once('NPC', npcIds.keys(), f.npcs ?? [], (n) => n.id);
  unique('NPC', (f.npcs ?? []).map((n) => n.name));
  for (const n of f.npcs ?? []) {
    const sn = npcIds.get(n.id);
    if (!sn) continue;
    if (blank(n.description) || blank(n.motivation)) errs.push(`${n.id}: falta descripción o motivación.`);
    if (sn.role !== 'beast' && blank(n.secret)) errs.push(`${n.id}: falta el secreto.`);
    if (!(ATTITUDES as readonly string[]).includes(n.attitude)) errs.push(`${n.id}: actitud no válida «${n.attitude}» (${ATTITUDES.join(', ')}).`);
    const s = sn.stats;
    const [acLo, acHi] = SRD_STAT_RANGES.ac, [hpLo, hpHi] = SRD_STAT_RANGES.hp, [abLo, abHi] = SRD_STAT_RANGES.attack_bonus;
    if (s.ac < acLo || s.ac > acHi || s.hp_max < hpLo || s.hp_max > hpHi || s.attack_bonus < abLo || s.attack_bonus > abHi
      || !(SRD_STAT_RANGES.xp as readonly number[]).includes(s.xp) || !/^\d+d\d+([+-]\d+)?$/.test(s.damage) || !(sn.archetype in ARCHETYPES)) {
      errs.push(`${n.id}: estadísticas fuera de los rangos SRD.`);
    }
  }
  for (const t of f.trade ?? []) {
    if (!isPerson(sk, t.npc_id)) errs.push(`comercio: ${t.npc_id} no existe o no comercia.`);
    if (t.buys_or_sells !== 'buys' && t.buys_or_sells !== 'sells') errs.push(`comercio de ${t.npc_id}: buys_or_sells debe ser "buys" o "sells" (es «${t.buys_or_sells}»).`);
    if (!tradeIds.has(t.item_id)) errs.push(`comercio de ${t.npc_id}: el objeto ${t.item_id} no está en el catálogo.`);
    if (!Number.isInteger(t.price) || t.price <= 0) errs.push(`comercio de ${t.npc_id}: el precio de ${t.item_id} debe ser un entero positivo (es ${t.price}).`);
  }
  if ((f.clues ?? []).length !== sk.clue_count) errs.push(`Hacen falta exactamente ${sk.clue_count} pistas (hay ${f.clues?.length ?? 0}).`);
  unique('pistas', (f.clues ?? []).map((c) => c.title));
  (f.clues ?? []).forEach((c, i) => {
    if (blank(c.how)) errs.push(`pista ${i + 1}: falta el «cómo».`);
    if ((c.location_ids ?? []).length + (c.npc_ids ?? []).length === 0) errs.push(`pista ${i + 1}: necesita al menos un ancla (localización o NPC).`);
    for (const id of c.location_ids ?? []) if (!locIds.has(id)) errs.push(`pista ${i + 1}: la localización ${id} no existe.`);
    for (const id of c.npc_ids ?? []) if (!isPerson(sk, id)) errs.push(`pista ${i + 1}: el NPC ${id} no existe o no habla.`);
  });
  once('encargos', sk.jobs.map((j) => j.id), f.jobs ?? [], (j) => j.id);
  for (const j of f.jobs ?? []) {
    if (blank(j.title) || blank(j.text)) errs.push(`${j.id}: falta título o texto.`);
    if (!isPerson(sk, j.giver_npc_id)) errs.push(`${j.id}: quien lo pide (${j.giver_npc_id}) no existe o no habla.`);
  }
  return errs;
}

export function validateSituations(sk: Skeleton, f: SituationsPart, pcs: PcBrief[]): string[] {
  const errs: string[] = [];
  const sits = f.situations ?? [];
  if (sits.filter((s) => blank(s.for_name)).length < 1) errs.push('Falta al menos una situación de reserva (for_name vacío).');
  for (const p of pcs) {
    const n = sits.filter((s) => norm(s.for_name ?? '') === norm(p.name)).length;
    if (n !== 1) errs.push(`Hace falta exactamente una situación para «${p.name}» (hay ${n}).`);
  }
  for (const s of sits) {
    const who = s.for_name || 'reserva';
    if (!isPerson(sk, s.antagonist_npc_id)) errs.push(`situación de ${who}: el antagonista ${s.antagonist_npc_id} no existe o no es una persona.`);
    if (!sk.situation_spot_ids.includes(s.start_spot_id)) errs.push(`situación de ${who}: el punto ${s.start_spot_id} no vale para empezar.`);
    if (!Number.isInteger(s.clock_days) || s.clock_days < 1 || s.clock_days > 30) errs.push(`situación de ${who}: clock_days debe ser un entero de 1 a 30 (es ${s.clock_days}).`);
    if (!Number.isInteger(s.start_hour) || s.start_hour < 0 || s.start_hour > 23) errs.push(`situación de ${who}: start_hour debe ser un entero de 0 a 23 (es ${s.start_hour}).`);
    if (!Array.isArray(s.paths) || s.paths.length !== 3 || s.paths.some(blank)) errs.push(`situación de ${who}: hacen falta exactamente tres caminos.`);
    for (const k of ['why_here', 'wants', 'threat', 'clock_runs_out', 'opening'] as const) if (blank(s[k])) errs.push(`situación de ${who}: ${k} está vacío.`);
  }
  return errs;
}

/** Errores del relleno entero contra el esqueleto. Vacío = válido. */
export function validateFill(sk: Skeleton, f: WorldFill, pcs: PcBrief[]): string[] {
  return [...validateWorld(sk, f), ...validatePeople(sk, f), ...validateSituations(sk, f, pcs)];
}

// ---------------------------------------------------------------------------
// Llamadas a la API
// ---------------------------------------------------------------------------

/** Mismo contrato que el MasterClient: un falso en tests, el SDK (en streaming) en real. */
export interface FillClient {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
}

export function liveFillClient(timeoutMs = 600_000): FillClient {
  const sdk = new Anthropic({ timeout: timeoutMs, maxRetries: 2 });
  // Salida larga: en streaming para no chocar con los límites de una petición sin stream.
  return { create: ({ stream: _s, ...p }) => sdk.beta.messages.stream(p).finalMessage() };
}

/** $ por millón de tokens (entrada, salida). */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25],
};
export function costUsd(model: string, input: number, output: number): number {
  const [i, o] = PRICES[model] ?? PRICES[DEFAULT_WORLDGEN_MODEL]!;
  return Math.round(((input * i + output * o) / 1e6) * 10000) / 10000;
}

export interface FillResult {
  fill: WorldFill;
  model: string;
  /** Llamadas hechas (3 si todo valió a la primera). 0 offline. */
  attempts: number;
  usage: { input: number; output: number };
  cost_usd: number;
  /** Partes que se pidieron sin gramática estricta porque no cabía. */
  unstrict: PartName[];
}

export interface FillOptions {
  /** Sin cliente: offline. */
  client?: FillClient | null;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  log?: (msg: string) => void;
}

export class FillError extends Error {
  constructor(message: string, readonly errors: string[] = []) { super(message); }
}

/** ¿Es el 400 de «la gramática compilada es demasiado grande»? */
export function isGrammarTooLarge(e: unknown): boolean {
  const err = e as { status?: number; message?: string } | null;
  return !!err && err.status === 400 && /grammar is too large/i.test(String(err.message ?? ''));
}

/** El objeto JSON de una respuesta sin gramática: quita ```json y texto alrededor. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

interface CallState { client: FillClient; model: string; effort: 'low' | 'medium' | 'high'; log: (m: string) => void; calls: number; usage: { input: number; output: number }; cost: number; models: Set<string>; unstrict: PartName[] }

/** Una parte: una llamada (dos si hay que corregir), estricta mientras quepa. */
async function callPart<T>(st: CallState, part: PartName, prompt: string, check: (raw: T) => { value: T; errors: string[] }): Promise<T> {
  const schema = PART_SCHEMAS[part];
  const safeguards: Partial<Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>> = st.model.startsWith('claude-haiku')
    ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
  let strict = true;
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const system = strict ? PART_SYSTEM[part]
      : `${PART_SYSTEM[part]}\n\nResponde SOLO con un objeto JSON válido, sin texto antes ni después, que cumpla este JSON Schema:\n${JSON.stringify(schema)}`;
    const t0 = Date.now();
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await st.client.create({
        model: st.model, max_tokens: 16000, ...safeguards,
        output_config: { effort: st.effort, ...(strict ? { format: { type: 'json_schema' as const, schema } } : {}) },
        system, messages,
      });
    } catch (e) {
      if (strict && isGrammarTooLarge(e)) {
        st.log(`[worldgen] ${part}: la gramática estricta no cabe; pido JSON sin gramática y lo valido igual`);
        strict = false;
        st.unstrict.push(part);
        attempt--;
        continue;
      }
      throw e;
    }
    st.calls++;
    st.models.add(res.model);
    const input = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    st.usage.input += input;
    st.usage.output += res.usage.output_tokens;
    st.cost += costUsd(res.model, input, res.usage.output_tokens);
    st.log(`[worldgen] ${part}, intento ${attempt}: ${res.model}, ${input} in / ${res.usage.output_tokens} out, ${Math.round((Date.now() - t0) / 1000)} s, ${res.stop_reason}${strict ? '' : ' (sin gramática)'}`);
    if (res.stop_reason === 'refusal') throw new FillError(`el modelo se negó a escribir ${part === 'world' ? 'el mundo' : part === 'people' ? 'la gente' : 'las situaciones'}: ${res.stop_details?.explanation ?? 'sin explicación'}`);
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    let raw: T | null = null;
    try { raw = (strict ? JSON.parse(text) : extractJson(text)) as T; } catch { lastErrors = [res.stop_reason === 'max_tokens' ? 'La respuesta se cortó por max_tokens.' : 'La respuesta no es JSON válido.']; }
    if (raw) {
      const { value, errors } = check(raw);
      if (!errors.length) return value;
      lastErrors = errors;
    }
    st.log(`[worldgen] ${part} no valida: ${lastErrors.join(' | ')}`);
    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: `Esta parte tiene estos errores:\n- ${lastErrors.join('\n- ')}\n\nDevuelve el JSON completo de esta parte corregido, con todo lo demás igual.` });
  }
  throw new FillError(`${part === 'world' ? 'el mundo' : part === 'people' ? 'la gente' : 'las situaciones'} no valida(n) tras corregir una vez`, lastErrors);
}

/** Rellena el esqueleto: con cliente, tres partes (cada una con su reintento); sin él, offline. */
export async function fillWorld(sk: Skeleton, pcs: PcBrief[], opts: FillOptions = {}): Promise<FillResult> {
  if (!opts.client) {
    const fill = offlineFill(sk, pcs);
    const errs = validateFill(sk, fill, pcs);
    if (errs.length) throw new FillError('El relleno offline no valida (bug).', errs);
    return { fill, model: 'offline', attempts: 0, usage: { input: 0, output: 0 }, cost_usd: 0, unstrict: [] };
  }
  const st: CallState = {
    client: opts.client, model: opts.model ?? DEFAULT_WORLDGEN_MODEL, effort: opts.effort ?? 'medium', log: opts.log ?? (() => {}),
    calls: 0, usage: { input: 0, output: 0 }, cost: 0, models: new Set(), unstrict: [],
  };
  const world = await callPart<WorldPart>(st, 'world', partPrompt('world', sk, pcs), (w) => ({ value: w, errors: validateWorld(sk, w) }));
  const people = await callPart<PeoplePart>(st, 'people', partPrompt('people', sk, pcs, { world }), (raw) => {
    const value = normalizePeople(sk, { ...raw, npcs: raw.npcs ?? [], trade: raw.trade ?? [], jobs: raw.jobs ?? [] });
    return { value, errors: validatePeople(sk, value) };
  });
  const situations = await callPart<SituationsPart>(st, 'situations', partPrompt('situations', sk, pcs, { world, people }), (raw) => {
    const value = normalizeSituations(sk, { situations: raw.situations ?? [] });
    return { value, errors: validateSituations(sk, value, pcs) };
  });
  return {
    fill: assembleFill(world, people, situations), model: [...st.models].join(' + ') || st.model, attempts: st.calls,
    usage: st.usage, cost_usd: Math.round(st.cost * 10000) / 10000, unstrict: st.unstrict,
  };
}
