/**
 * Rumores: la improvisación del máster con presupuesto. Cuando el jugador pide
 * algo plausible que no está en los datos («busco el tesoro de la croqueta
 * dorada»), el máster no lo crea ni lo niega en seco: siembra lo que «se dice»
 * de ello. Un rumor no es un punto, ni un objeto, ni un NPC; es una entidad a
 * resolución mínima (nombre, de qué va, dónde dicen que está) que circula por
 * una localización. La regla de que solo existe lo que está en los datos sigue
 * intacta: lo que existe es el rumor, no la cosa.
 *
 * Se guardan en la campaña como propiedad opcional (`campaign.rumors`), igual
 * que los ganchos (hooks.ts): viajan con el snapshot y se persisten al tocar la
 * campaña. Cada uno lleva su procedencia (quién lo provocó, con qué acción, en
 * qué lugar y a qué hora de juego); el evento de esa acción se encuentra en el
 * registro por actor + input_text con timestamp_game_s justo después de `origin.game_s`.
 *
 * El jugador también siembra: si su personaje afirma o inventa algo del mundo
 * compartido («he oído que en el pozo hay un pasadizo»), el rumor lleva
 * `said_by` y se cuenta como «lo dice Kael», no como «se dice». Tampoco es
 * verdad hasta que el mundo lo confirme (el Director, con criterio de autor).
 *
 * Presupuesto: RUMORS_PER_DAY rumores nuevos por personaje y día de juego.
 * Repetir uno que ya corre aquí no gasta: suma una mención.
 *
 * El Director (futuro, fuera de la partida y sin prisa) es quien los convierte
 * en historia. Recorre los rumores `open` y decide con criterio de autor:
 *   - Señal: las menciones (los jugadores vuelven a preguntar), cuántos PJs
 *     distintos lo han tocado, si encaja con la premisa y con los hilos vivos.
 *   - Conversión, según `kind`: `quest` → un encargo en el tablón (Job) con
 *     quien lo pide; `person` → un NPC en algún sitio de la región; `place` →
 *     una localización o un punto oculto creados por worldgen; `item` → una
 *     definición de objeto y un ejemplar escondido en un sitio concreto;
 *     `rumor` → una pista (Clue) anclada a un NPC o a un lugar. Siempre a
 *     través del motor, como cualquier dato, nunca en la narración.
 *   - Cierre: `status = 'threaded'` y `thread = { kind, id }` con lo creado; a
 *     partir de ahí el máster lo ve como dato real y el rumor deja de salir.
 *   - Lo que no encaja se deja morir: caduca a los RUMOR_LIFETIME_DAYS días y
 *     queda como `faded` (historia del mundo, no contexto).
 */

import type { Id } from './model.js';
import type { World } from './world.js';

export const RUMOR_KINDS = ['rumor', 'place', 'person', 'item', 'quest'] as const;
export type RumorKind = (typeof RUMOR_KINDS)[number];

export interface Rumor {
  id: Id;
  kind: RumorKind;
  /** Cómo lo llama la gente: «el tesoro de la croqueta dorada». */
  name: string;
  /** Lo que se dice, en una frase. Para el máster: puede contarlo como habladuría, nunca como hecho. */
  hint: string;
  /** Dónde dicen que está, en palabras de la gente; null si nadie lo sabe. Nunca es un punto real. */
  where: string | null;
  /** Si lo afirmó un personaje jugador, quién; null si es habladuría del mundo. */
  said_by: { id: Id; name: string } | null;
  /** Localización por la que circula. */
  location_id: Id;
  status: 'open' | 'threaded' | 'faded';
  /** Veces que ha vuelto a salir en la partida. */
  mentions: number;
  origin: { actor_id: Id; game_s: number; location_id: Id; action: string | null };
  expires_game_s: number;
  /** Lo que el Director creó con él, cuando lo convierta en hilo. */
  thread?: { kind: string; id: Id } | null;
}

export interface RumorInput {
  kind: string;
  name: string;
  hint: string;
  where?: string | null;
  location_id: Id;
  actor_id: Id;
  action?: string | null;
  /** El propio personaje lo afirma o lo inventa. */
  said_by_actor?: boolean;
}

export const RUMORS_PER_DAY = 3;
export const RUMOR_LIFETIME_DAYS = 7;
export const MAX_RUMORS_PER_LOCATION = 10;
/** Tope de lo guardado; al pasarlo se olvidan los más viejos que ya no corren. */
const MAX_STORED = 200;
const DAY_S = 24 * 3600;

function store(world: World): Rumor[] {
  const camp = world.campaign as typeof world.campaign & { rumors?: Rumor[] };
  camp.rumors ??= [];
  return camp.rumors;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const day = (s: number) => Math.floor(s / DAY_S);

export function allRumors(world: World): readonly Rumor[] { return store(world); }

function live(r: Rumor, nowGameS: number): boolean {
  return r.status === 'open' && r.expires_game_s > nowGameS;
}

/** Rumores que corren ahora por una localización. */
export function rumorsIn(world: World, locationId: Id, nowGameS: number): Rumor[] {
  return store(world).filter((r) => r.location_id === locationId && live(r, nowGameS));
}

/** Rumores vigentes que provocó este personaje en otros sitios: los conoce y puede volver a ellos. */
export function rumorsHeardBy(world: World, characterId: Id, nowGameS: number, exceptLocationId?: Id): Rumor[] {
  return store(world).filter((r) => r.origin.actor_id === characterId && r.location_id !== exceptLocationId && live(r, nowGameS));
}

/** Rumores nuevos que este personaje ha provocado hoy (día de juego) y cuántos le quedan. */
export function rumorBudget(world: World, characterId: Id, nowGameS: number): { used: number; left: number; limit: number } {
  const today = day(nowGameS);
  const used = store(world).filter((r) => r.origin.actor_id === characterId && day(r.origin.game_s) === today).length;
  return { used, left: Math.max(0, RUMORS_PER_DAY - used), limit: RUMORS_PER_DAY };
}

export function plantRumor(world: World, input: RumorInput, nowGameS: number): { ok: true; rumor: Rumor; existing: boolean } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  const hint = (input.hint ?? '').trim();
  const where = (input.where ?? '').trim() || null;
  if (!RUMOR_KINDS.includes(input.kind as RumorKind)) return { ok: false, error: `kind debe ser uno de ${RUMOR_KINDS.join(', ')}` };
  if (!name) return { ok: false, error: 'name vacío: di cómo lo llama la gente' };
  if (name.length > 80) return { ok: false, error: 'name demasiado largo (máx. 80 caracteres)' };
  if (!hint) return { ok: false, error: 'hint vacío: di qué se cuenta' };
  if (hint.length > 300) return { ok: false, error: 'hint demasiado largo (máx. 300 caracteres)' };
  if (where && where.length > 120) return { ok: false, error: 'where demasiado largo (máx. 120 caracteres)' };
  if (!world.locations.has(input.location_id)) return { ok: false, error: `no existe la localización ${input.location_id}` };
  const actor = world.characters.get(input.actor_id);
  if (!actor) return { ok: false, error: `no existe el personaje ${input.actor_id}` };

  const here = rumorsIn(world, input.location_id, nowGameS);
  const same = here.find((r) => norm(r.name) === norm(name));
  if (same) {
    same.mentions++;
    world.touch('campaign', world.campaign.id);
    return { ok: true, rumor: same, existing: true };
  }
  const budget = rumorBudget(world, input.actor_id, nowGameS);
  if (budget.left === 0) return { ok: false, error: `presupuesto agotado: ${budget.limit} rumores nuevos por personaje y día de juego. Retoma uno de los que ya corren o responde en ficción sin sembrar nada.` };
  if (here.length >= MAX_RUMORS_PER_LOCATION) return { ok: false, error: 'demasiados rumores corriendo aquí; retoma uno de los que ya hay' };

  const rumor: Rumor = {
    id: `rm_${Math.round(nowGameS).toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: input.kind as RumorKind, name, hint, where,
    said_by: input.said_by_actor ? { id: actor.id, name: actor.name } : null,
    location_id: input.location_id, status: 'open', mentions: 1,
    origin: { actor_id: input.actor_id, game_s: nowGameS, location_id: input.location_id, action: input.action?.trim() || null },
    expires_game_s: nowGameS + RUMOR_LIFETIME_DAYS * DAY_S,
    thread: null,
  };
  const all = store(world);
  all.push(rumor);
  for (const r of all) if (r.status === 'open' && r.expires_game_s <= nowGameS) r.status = 'faded';
  if (all.length > MAX_STORED) {
    const drop = new Set(all.filter((r) => r.status !== 'open').slice(0, all.length - MAX_STORED));
    all.splice(0, all.length, ...all.filter((r) => !drop.has(r)));
  }
  world.touch('campaign', world.campaign.id);
  return { ok: true, rumor, existing: false };
}

const KIND_ES: Record<RumorKind, string> = { rumor: 'habladuría', place: 'lugar', person: 'persona', item: 'objeto', quest: 'empresa' };

/** Una línea para el contexto del máster. */
export function describeRumor(r: Rumor): string {
  const hint = r.hint.replace(/^se dice que\s+/i, '');
  return `«${r.name}» (${KIND_ES[r.kind]}): ${r.said_by ? `lo dice ${r.said_by.name}, sin confirmar:` : 'se dice que'} ${/[.!?…»"]$/.test(hint) ? hint : `${hint}.`}${r.where ? ` Dónde, según dicen: ${r.where}.` : ''}${r.mentions > 1 ? ` Ha salido ${r.mentions} veces.` : ''} [${r.id}]`;
}
