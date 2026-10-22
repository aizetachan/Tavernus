/**
 * Relleno semántico del esqueleto (PLAN: capa 3). Una llamada a la API con
 * salida estructurada (output_config.format con JSON Schema estricto; nunca
 * prefill) pone nombres, prosa, Biblia, leyes, NPC completos, pistas,
 * encargos, facción, logro y la situación inicial de cada PJ. Se valida
 * contra el esqueleto y, si algo falla, se reintenta una vez con los errores.
 *
 * El esquema es fijo y escueto a propósito: la API compila el JSON Schema a
 * una gramática con un tamaño máximo, y uno con enums de ids, zonas, orígenes,
 * alias y olores lo pasaba (400 «compiled grammar is too large»). Las ids van
 * como texto y las comprueba `validateFill`; lo que se deriva bien por código
 * (zonas, región, orígenes, alias, nombre del ataque) lo pone index.ts.
 *
 * Sin API (modo offline, sin clave o en tests) sale un relleno determinista
 * de plantilla (offline.ts): menos literario, igual de jugable.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Attitude, Id, ItemDef } from '../engine/model.js';
import { makeSeed } from '../data/seed/demo.js';
import type { Genre } from './catalog.js';
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

/** Lo que devuelve el relleno (y valida `validateFill`). Misma forma que el esquema. */
export interface WorldFill {
  campaign_name: string;
  /** Nombre del pueblo (zona, región y orígenes salen de aquí). */
  town_name: string;
  premise: string;
  welcome: string;
  bible: string[];
  laws: string[];
  faction: { name: string; description: string };
  achievement: { title: string; announcement: string; reward_item_name: string };
  locations: { id: Id; name: string; description: string; spots: { id: Id; name: string; description: string }[] }[];
  npcs: { id: Id; name: string; description: string; motivation: string; secret: string; attitude: string }[];
  /** Comercio: qué compra o vende cada NPC y a qué precio. */
  trade: { npc_id: Id; buys_or_sells: string; item_id: Id; price: number }[];
  clues: { title: string; how: string; location_ids: Id[]; npc_ids: Id[] }[];
  jobs: { id: Id; title: string; text: string; giver_npc_id: Id }[];
  situations: SituationFill[];
}

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
// Esquema (strict: additionalProperties false y todo requerido)
// ---------------------------------------------------------------------------

const str = { type: 'string' } as const;
const strs = { type: 'array', items: str } as const;
const int = { type: 'integer' } as const;
const arr = (items: unknown) => ({ type: 'array', items });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

const FILL_SCHEMA = obj({
  campaign_name: str, town_name: str, premise: str, welcome: str,
  bible: strs, laws: strs,
  faction: obj({ name: str, description: str }),
  achievement: obj({ title: str, announcement: str, reward_item_name: str }),
  locations: arr(obj({ id: str, name: str, description: str, spots: arr(obj({ id: str, name: str, description: str })) })),
  npcs: arr(obj({ id: str, name: str, description: str, motivation: str, secret: str, attitude: str })),
  trade: arr(obj({ npc_id: str, buys_or_sells: str, item_id: str, price: int })),
  clues: arr(obj({ title: str, how: str, location_ids: strs, npc_ids: strs })),
  jobs: arr(obj({ id: str, title: str, text: str, giver_npc_id: str })),
  situations: arr(obj({
    for_name: str, why_here: str, wants: str, threat: str, clock_days: int, clock_runs_out: str,
    antagonist_npc_id: str, start_spot_id: str, start_hour: int, paths: strs, opening: str,
  })),
});

/** Esquema del relleno. Fijo (ver la cabecera); la firma admite el esqueleto por si vuelve a depender de él. */
export function fillSchema(_sk: Skeleton): Record<string, unknown> {
  return FILL_SCHEMA;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const TONE_ES: Record<Tone, string> = {
  epic: 'épico: grandes fuerzas en juego, gente corriente ante algo mayor',
  grim: 'sombrío: fantasía oscura, decisiones con precio, nada es gratis',
  comedy: 'cómico: situaciones absurdas tratadas con seriedad, personajes excéntricos, sin romper el mundo',
  horror: 'terror: lo inquietante crece despacio, lo que no se ve asusta más',
  pulp: 'pulp: acción, villanos con carisma, secretos y persecuciones',
};

export const FILL_SYSTEM = [
  'Eres el diseñador de mundos de un juego de rol por chat (D&D 5e, en castellano) con un máster IA.',
  'Te dan el esqueleto de una región inicial ya decidido por código: el tipo de asentamiento (no tiene por qué haber posada ni posadero), sus localizaciones, puntos con sus coordenadas, salidas, NPC por papel, encargos y cuántas pistas. Respeta el género de la ambientación (fantasía, ciencia ficción o postapocalíptico) en nombres, objetos y verdades. No cambias la estructura: le pones nombres, prosa y verdad. Usa exactamente las ids que te dan: cada localización (con todos sus puntos), NPC y encargo aparece una sola vez con su id; item_id solo del catálogo; start_spot_id solo de puntos_para_situaciones; antagonistas, anclas de pistas y quien pide un encargo, NPC que no sean la bestia.',
  '',
  'Qué escribes:',
  '- Nombre de la campaña, nombre del pueblo, premisa (2-3 frases, sin desvelar la Biblia) y una bienvenida mística de 2-3 líneas en voz del máster que contenga {name} (se sustituye por el nombre del PJ).',
  '- Biblia: 5-10 verdades ocultas del mundo, frases cortas y concretas. Son la verdad que nadie cuenta entera; todo secreto, pista y amenaza debe ser coherente con ellas y apoyarse en al menos una.',
  '- Leyes del mundo: 4-6 frases sobre lo que en este mundo no puede pasar por mucho que el jugador lo pida (magia, tecnología, muerte, límites del cuerpo), adaptadas a la ambientación.',
  '- Cada localización y cada punto: nombre propio cuando toque (los edificios con dueño y los exteriores tienen nombre; "la barra" no) y una descripción de una frase, concreta y sensorial. Los puntos que llevan a otra localización (leads_to) se nombran por adónde llevan ("la puerta de la Lonja Vieja"). Los nombres de punto no se repiten dentro de su localización y los de localización no se repiten. Conserva en el nombre de cada punto la palabra de su plantilla (barra, pozo, tablón, portón…): con ella lo nombran los jugadores y se dibuja el plano.',
  '- Cada NPC: nombre único, descripción física de 1-2 frases con un gesto propio, motivación, un secreto coherente con la Biblia y actitud por defecto (hostile, unfriendly, neutral, friendly o allied; la bestia, hostile). La bestia se nombra con artículo indeterminado ("un lobo de lomo cano") y no comercia.',
  '- Comercio (trade): para dos o tres NPC a los que les cuadre comerciar, qué compran y venden (buys_or_sells: "buys" o "sells") del catálogo, con precios enteros positivos cercanos al valor. Lo que dan los recursos del campo, alguien lo compra.',
  '- Pistas: exactamente las que pide el esqueleto. Título corto y "how" para el máster: cómo se obtiene (acción, tirada y CD 10-16) y qué revela. Ancla cada una a una localización (location_ids) o a un NPC (npc_ids). Juntas apuntan a la verdad central de la Biblia.',
  '- Encargos: uno por cada id del esqueleto, coherente con su tipo (deliver: entregar el objeto y la cantidad indicados; visit: ir al punto y volver a contarlo; narrative: un favor que el máster resuelve en ficción). Título y texto de tablón en una o dos frases, y quién lo pide.',
  '- Facción local y logro (título, anuncio con {name}, y el nombre del objeto que se gana). El logro da además el punto oculto punto_del_logro. Los puntos de cuartos_de_alquiler están a la vista y cerrados con llave: se alquilan por noches a quien atiende el lugar.',
  '',
  'Situación inicial (lo más importante): una por cada PJ de la lista y además ' + SPARE_SITUATIONS + ' de reserva con for_name vacío para quien llegue después. Es el porqué personal del PJ, no "estás en una taberna":',
  '- why_here: por qué está aquí ahora, en segunda persona, concreto, enlazado a la Biblia sin destriparla.',
  '- wants: lo que quiere conseguir. threat: lo que le amenaza a él personalmente.',
  '- clock_days (entero, 1-14) y clock_runs_out: qué pasa si vence el plazo.',
  '- antagonist_npc_id: un NPC cercano de la lista (no la bestia) que se le opone, abiertamente o no.',
  '- start_spot_id y start_hour (0-23): dónde y a qué hora empieza, lo que pida su historia: despertar en una celda, desembarcar en el muelle, salir de la mina al amanecer, un funeral, un mercado a punto de cerrar… Una posada solo si la historia lo pide. Las situaciones de un mismo mundo empiezan en sitios distintos.',
  '- paths: exactamente tres caminos posibles y distintos (por ejemplo: enfrentarse, negociar o pactar, investigar o huir), cada uno una frase con un primer paso concreto en este mundo.',
  '- opening: lo que le está pasando en el primer instante, en el cuerpo o los sentidos, y que pide una decisión.',
  'Si el jugador cuenta algo de su PJ (hook), úsalo y no lo contradigas.',
  '',
  'Estilo: castellano de España, frases cortas, nada de clichés ("un aire de misterio"), nada de explicar la Biblia en la premisa. Coherencia interna por encima de todo.',
].join('\n');

export const GENRE_DEFAULT: Record<Genre, string> = {
  fantasy: 'Fantasía medieval de baja magia.',
  scifi: 'Ciencia ficción de frontera: colonias pobres, naves viejas, corporaciones lejanas.',
  postapoc: 'Postapocalíptico: el mundo cayó hace una generación; se vive de la chatarra y del agua.',
};

/** Lo que el modelo necesita del esqueleto: estructura sin ruido. */
export function fillPrompt(sk: Skeleton, pcs: PcBrief[]): string {
  const view = {
    tono: TONE_ES[sk.tone],
    ambientacion: sk.setting || GENRE_DEFAULT[sk.genre],
    genero: sk.genre,
    asentamiento: sk.settlement.label,
    localizaciones: sk.locations.map((l: SkLocation) => ({
      id: l.id, tipo: l.label, zona: l.zone_id === 'zn_town' ? 'asentamiento' : 'afueras', interior: l.indoor,
      puntos: l.spots.map((s) => ({ id: s.id, plantilla: s.name, tags: s.tags, x: s.x, y: s.y, ...(s.hidden ? { oculto: true } : {}), ...(s.leads_to ? { leads_to: s.leads_to } : {}) })),
    })),
    salidas: sk.exits.map((e) => ({ de: e.from_spot_id, a: e.to_spot_id, metros: e.distance_m })),
    npcs: sk.npcs.map((n: SkNpc) => ({ id: n.id, papel: n.role_label, en: n.spot_id, combate: n.archetype })),
    recursos: sk.resources.map((r) => ({ en: r.spot_id, da: r.item_id })),
    encargos: sk.jobs,
    pistas: sk.clue_count,
    puntos_para_situaciones: sk.situation_spot_ids,
    punto_del_logro: sk.reward_spot_id,
    cuartos_de_alquiler: skeletonSpots(sk).filter((s) => s.locked).map((s) => s.id),
    catalogo: TRADE_ITEMS.map((d) => ({ id: d.id, nombre: d.name, valor: d.value })),
    personajes: pcs.map((p) => ({ nombre: p.name, ...(p.race ? { raza: p.race } : {}), ...(p.class_name ? { clase: p.class_name } : {}), ...(p.hook ? { hook: p.hook } : {}) })),
  };
  return `Esqueleto del mundo (JSON):\n${JSON.stringify(view)}\n\nRellena el mundo según el esquema.`;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Errores del relleno contra el esqueleto. Vacío = válido. */
export function validateFill(sk: Skeleton, f: WorldFill, pcs: PcBrief[]): string[] {
  const errs: string[] = [];
  const locIds = new Set(sk.locations.map((l) => l.id));
  const npcIds = new Map(sk.npcs.map((n) => [n.id, n]));
  const person = (id: Id) => npcIds.has(id) && npcIds.get(id)!.role !== 'beast';
  const tradeIds = new Set(TRADE_ITEMS.map((d) => d.id));
  const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';
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

  for (const k of ['campaign_name', 'town_name', 'premise', 'welcome'] as const) if (blank(f[k])) errs.push(`${k} está vacío.`);
  if (f.bible.length < 5 || f.bible.length > 10) errs.push(`La Biblia debe tener entre 5 y 10 verdades (tiene ${f.bible.length}).`);
  if (f.laws.length < 3 || f.laws.length > 8) errs.push(`Las leyes del mundo deben ser entre 3 y 8 (hay ${f.laws.length}).`);
  if (blank(f.faction.name)) errs.push('La facción no tiene nombre.');
  if (blank(f.achievement.title) || blank(f.achievement.reward_item_name)) errs.push('El logro necesita título y objeto.');

  once('localizaciones', locIds, f.locations, (l) => l.id);
  unique('localizaciones', f.locations.map((l) => l.name));
  for (const l of f.locations) {
    const sl = sk.locations.find((x) => x.id === l.id);
    if (!sl) continue;
    once(`puntos de ${l.id}`, sl.spots.map((s) => s.id), l.spots, (s) => s.id);
    unique(`puntos de ${l.id}`, l.spots.map((s) => s.name));
  }

  once('NPC', npcIds.keys(), f.npcs, (n) => n.id);
  unique('NPC', f.npcs.map((n) => n.name));
  for (const n of f.npcs) {
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
  for (const t of f.trade) {
    if (!person(t.npc_id)) errs.push(`comercio: ${t.npc_id} no existe o no comercia.`);
    if (t.buys_or_sells !== 'buys' && t.buys_or_sells !== 'sells') errs.push(`comercio de ${t.npc_id}: buys_or_sells debe ser "buys" o "sells" (es «${t.buys_or_sells}»).`);
    if (!tradeIds.has(t.item_id)) errs.push(`comercio de ${t.npc_id}: el objeto ${t.item_id} no está en el catálogo.`);
    if (!Number.isInteger(t.price) || t.price <= 0) errs.push(`comercio de ${t.npc_id}: el precio de ${t.item_id} debe ser un entero positivo (es ${t.price}).`);
  }

  if (f.clues.length !== sk.clue_count) errs.push(`Hacen falta exactamente ${sk.clue_count} pistas (hay ${f.clues.length}).`);
  unique('pistas', f.clues.map((c) => c.title));
  f.clues.forEach((c, i) => {
    if (blank(c.how)) errs.push(`pista ${i + 1}: falta el «cómo».`);
    if (c.location_ids.length + c.npc_ids.length === 0) errs.push(`pista ${i + 1}: necesita al menos un ancla (localización o NPC).`);
    for (const id of c.location_ids) if (!locIds.has(id)) errs.push(`pista ${i + 1}: la localización ${id} no existe.`);
    for (const id of c.npc_ids) if (!person(id)) errs.push(`pista ${i + 1}: el NPC ${id} no existe o no habla.`);
  });

  once('encargos', sk.jobs.map((j) => j.id), f.jobs, (j) => j.id);
  for (const j of f.jobs) {
    if (blank(j.title) || blank(j.text)) errs.push(`${j.id}: falta título o texto.`);
    if (!person(j.giver_npc_id)) errs.push(`${j.id}: quien lo pide (${j.giver_npc_id}) no existe o no habla.`);
  }

  const spare = f.situations.filter((s) => blank(s.for_name)).length;
  if (spare < 1) errs.push('Falta al menos una situación de reserva (for_name vacío).');
  for (const p of pcs) {
    const n = f.situations.filter((s) => norm(s.for_name) === norm(p.name)).length;
    if (n !== 1) errs.push(`Hace falta exactamente una situación para «${p.name}» (hay ${n}).`);
  }
  for (const s of f.situations) {
    const who = s.for_name || 'reserva';
    if (!person(s.antagonist_npc_id)) errs.push(`situación de ${who}: el antagonista ${s.antagonist_npc_id} no existe o no es una persona.`);
    if (!sk.situation_spot_ids.includes(s.start_spot_id)) errs.push(`situación de ${who}: el punto ${s.start_spot_id} no vale para empezar.`);
    if (!Number.isInteger(s.clock_days) || s.clock_days < 1 || s.clock_days > 30) errs.push(`situación de ${who}: clock_days debe ser un entero de 1 a 30 (es ${s.clock_days}).`);
    if (!Number.isInteger(s.start_hour) || s.start_hour < 0 || s.start_hour > 23) errs.push(`situación de ${who}: start_hour debe ser un entero de 0 a 23 (es ${s.start_hour}).`);
    if (s.paths.length !== 3 || s.paths.some(blank)) errs.push(`situación de ${who}: hacen falta exactamente tres caminos.`);
    for (const k of ['why_here', 'wants', 'threat', 'clock_runs_out', 'opening'] as const) if (blank(s[k])) errs.push(`situación de ${who}: ${k} está vacío.`);
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Llamada a la API
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
  attempts: number;
  usage: { input: number; output: number };
  cost_usd: number;
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

/** Rellena el esqueleto: con cliente, una llamada (dos si hay que corregir); sin él, offline. */
export async function fillWorld(sk: Skeleton, pcs: PcBrief[], opts: FillOptions = {}): Promise<FillResult> {
  if (!opts.client) {
    const fill = offlineFill(sk, pcs);
    const errs = validateFill(sk, fill, pcs);
    if (errs.length) throw new FillError('El relleno offline no valida (bug).', errs);
    return { fill, model: 'offline', attempts: 0, usage: { input: 0, output: 0 }, cost_usd: 0 };
  }
  const model = opts.model ?? DEFAULT_WORLDGEN_MODEL;
  const log = opts.log ?? (() => {});
  const usage = { input: 0, output: 0 };
  let cost = 0;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: fillPrompt(sk, pcs) }];
  const safeguards: Partial<Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>> = model.startsWith('claude-haiku')
    ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const res = await opts.client.create({
      model, max_tokens: 32000, ...safeguards,
      output_config: { effort: opts.effort ?? 'medium', format: { type: 'json_schema', schema: fillSchema(sk) } },
      system: FILL_SYSTEM,
      messages,
    });
    const input = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    usage.input += input;
    usage.output += res.usage.output_tokens;
    cost += costUsd(res.model, input, res.usage.output_tokens);
    log(`[worldgen] intento ${attempt}: ${res.model}, ${input} in / ${res.usage.output_tokens} out, ${Math.round((Date.now() - t0) / 1000)} s, ${res.stop_reason}`);
    if (res.stop_reason === 'refusal') throw new FillError(`El modelo rechazó generar el mundo: ${res.stop_details?.explanation ?? 'sin explicación'}`);
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    let fill: WorldFill | null = null;
    try { fill = JSON.parse(text) as WorldFill; } catch { lastErrors = [res.stop_reason === 'max_tokens' ? 'La respuesta se cortó por max_tokens.' : 'La respuesta no es JSON válido.']; }
    if (fill) {
      lastErrors = validateFill(sk, fill, pcs);
      if (!lastErrors.length) return { fill, model: res.model, attempts: attempt, usage, cost_usd: Math.round(cost * 10000) / 10000 };
    }
    log(`[worldgen] el relleno no valida: ${lastErrors.join(' | ')}`);
    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: `El relleno tiene estos errores:\n- ${lastErrors.join('\n- ')}\n\nDevuelve el JSON completo corregido, con todo lo demás igual.` });
  }
  throw new FillError('El relleno no valida tras corregirlo una vez.', lastErrors);
}
