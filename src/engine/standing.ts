/**
 * Lo que el mundo piensa de cada PJ (bloque I, «Hechos y reglas del mundo»),
 * en dos piezas a la manera de Baldur's Gate 3:
 *
 *   - **Opinión** numérica de cada NPC con cada PJ, como la aprobación de BG3.
 *     Cambia ±1, ±5 o ±10 según el hecho, y solo si el NPC lo sabe: lo vio, o
 *     le llegó de boca en boca (worldrules.ts). Los umbrales mueven la actitud
 *     que ya existe (un paso por umbral, sin pisar lo que hayan puesto el
 *     crimen o la historia), y cambian la CD social, los precios, si te atiende
 *     o te ayuda y si quiere hablar contigo. En multijugador, cada PJ la suya.
 *   - **Etiquetas** del PJ: las de raza, clase y trasfondo, y las que gana con
 *     lo que hace (*asesino*, *salvó a Ceniza*), declaradas en los datos de la
 *     campaña (`campaign.tags`). El máster las ve; cada NPC reacciona a las
 *     suyas según sus datos (`npc.tag_reactions`), y algunas abren una opción
 *     con tirada, como las líneas de diálogo con etiqueta de BG3.
 *
 * Módulo hoja (solo tipos y datos SRD): lo usan story.ts (condiciones `tag` y
 * `opinion`), crime.ts y progress.ts (servicio y precios) sin ciclos.
 */

import { BACKGROUNDS } from '../data/srd/index.js';
import type { Attitude, Character, EarnedTag, Id, Npc, OpinionEntry, TagDef, TagReaction } from './model.js';
import type { World } from './world.js';

export type { EarnedTag, OpinionEntry, TagDef, TagReaction } from './model.js';

// ---------------------------------------------------------------------------
// Opinión
// ---------------------------------------------------------------------------

/** Cuánto cambia según lo grande del hecho (como BG3): un gesto, algo que importa, algo que no se olvida. */
export const OPINION_STEPS = [1, 5, 10] as const;
export const OPINION_MIN = -100;
export const OPINION_MAX = 100;
const LOG_MAX = 8;

/**
 * Umbrales. Cada uno mueve la actitud un paso al cruzarlo (arriba o abajo):
 *   ≥ +40 aliado · ≥ +10 amistoso · entre medias, lo que ya hubiera · ≤ −10 receloso · ≤ −40 hostil.
 * Además: ≤ −10 no le ayuda; ≤ −30 no le vende ni le aloja; ≤ −50 no quiere hablar con él y se va.
 */
export const OPINION_THRESHOLDS = { allied: 40, friendly: 10, wary: -10, refuses: -30, hostile: -40, leaves: -50 } as const;

const RANK: Record<Attitude, number> = { hostile: 0, unfriendly: 1, neutral: 2, friendly: 3, allied: 4 };
const BY_RANK: Attitude[] = ['hostile', 'unfriendly', 'neutral', 'friendly', 'allied'];

function entryOf(n: Npc, characterId: Id): OpinionEntry | undefined { return n.opinion?.[characterId]; }

export function opinionOf(n: Npc, characterId: Id): number { return entryOf(n, characterId)?.value ?? 0; }

/** Escalón de la opinión: −2, −1, 0, +1, +2 (los pasos de actitud que suma). */
export function opinionBand(v: number): number {
  const t = OPINION_THRESHOLDS;
  return v >= t.allied ? 2 : v >= t.friendly ? 1 : v <= t.hostile ? -2 : v <= t.wary ? -1 : 0;
}

export interface OpinionChange { npc_id: Id; character_id: Id; from: number; to: number; delta: number; why: string; attitude: { from: Attitude; to: Attitude } | null }

/**
 * Cambia la opinión de un NPC con un PJ. Si cruza un umbral, la actitud se
 * mueve un paso por umbral desde la que tuviera (no se recalcula: lo que haya
 * puesto el crimen o la historia sigue contando). Devuelve el cambio, o null si no hay.
 */
export function changeOpinion(world: World, n: Npc, c: Character, delta: number, why: string, nowS: number): OpinionChange | null {
  if (!delta) return null;
  n.opinion ??= {};
  const e = (n.opinion[c.id] ??= { value: 0, log: [] });
  const from = e.value;
  const to = Math.max(OPINION_MIN, Math.min(OPINION_MAX, from + delta));
  if (to === from) return null;
  e.value = to;
  e.log = [...e.log, { delta: to - from, why, game_s: nowS }].slice(-LOG_MAX);
  let attitude: OpinionChange['attitude'] = null;
  const steps = opinionBand(to) - opinionBand(from);
  if (steps) {
    const cur = n.attitude.by_character[c.id] ?? n.attitude.default;
    const next = BY_RANK[Math.max(0, Math.min(4, RANK[cur] + steps))]!;
    if (next !== cur) { n.attitude.by_character[c.id] = next; attitude = { from: cur, to: next }; }
  }
  world.touch('npcs', n.id);
  return { npc_id: n.id, character_id: c.id, from, to, delta: to - from, why, attitude };
}

/** Los motivos más recientes de la opinión, para el máster: «+10 le devolvió a Ceniza». */
export function opinionReasons(n: Npc, characterId: Id, limit = 3): string[] {
  return (entryOf(n, characterId)?.log ?? []).slice(-limit).reverse().map((x) => `${x.delta > 0 ? '+' : ''}${x.delta} ${x.why}`);
}

/**
 * Nivel de confianza de un NPC con un PJ, de 0 a 4, sacado de la opinión y la
 * actitud. Para quien pida confianza por niveles (pistas y secretos que se ganan):
 *   0 desconfía (receloso u hostil, u opinión por debajo de 0) · 1 te trata (lo normal) ·
 *   2 se fía (≥ +10) · 3 confía (≥ +25) · 4 confidente (≥ +50).
 */
export function trustLevel(world: World, npcId: Id, characterId: Id): 0 | 1 | 2 | 3 | 4 {
  const n = world.npcs.get(npcId);
  if (!n) return 0;
  const v = opinionOf(n, characterId);
  const att = n.attitude.by_character[characterId] ?? n.attitude.default;
  if (v < 0 || RANK[att] < RANK.neutral) return 0;
  return v >= 50 ? 4 : v >= 25 ? 3 : v >= 10 ? 2 : 1;
}

export const TRUST_LABELS = ['desconfía', 'te trata', 'se fía', 'confía', 'confidente'] as const;

/** Skills sociales: su CD se ajusta por la opinión del NPC con quien se habla. */
export const SOCIAL_SKILLS: ReadonlySet<string> = new Set(['persuasion', 'deception', 'intimidation', 'performance']);

/** Lo que suma la opinión a la CD social contra ese NPC: −1 por cada 5 puntos a favor, +1 por cada 5 en contra (±5 como mucho). */
export function socialDcShift(n: Npc, characterId: Id): number {
  const steps = Math.max(-5, Math.min(5, Math.round(opinionOf(n, characterId) / 5)));
  return steps === 0 ? 0 : -steps;
}

/** Factor de precio por la opinión: ≥ +40, un 20 % menos; ≥ +10, un 10 %; ≤ −10, un 20 % más. Al venderle, al revés. */
export function priceFactor(n: Npc, characterId: Id, mode: 'buy' | 'sell'): number {
  const v = opinionOf(n, characterId);
  const f = v >= OPINION_THRESHOLDS.allied ? 0.8 : v >= OPINION_THRESHOLDS.friendly ? 0.9 : v <= OPINION_THRESHOLDS.wary ? 1.2 : 1;
  return mode === 'buy' ? f : 2 - f;
}

/** El precio para este PJ (en la moneda más pequeña), nunca menos de 1 si costaba algo. */
export function priceFor(n: Npc, characterId: Id, base: number, mode: 'buy' | 'sell'): number {
  if (base <= 0) return base;
  return Math.max(1, Math.round(base * priceFactor(n, characterId, mode)));
}

/** Si no le vende, ni le compra, ni le aloja por lo que piensa de él, por qué; si no, null. */
export function opinionRefusal(n: Npc, c: Character): string | null {
  return opinionOf(n, c.id) <= OPINION_THRESHOLDS.refuses ? `${n.name} no quiere tratos con ${c.name}: no le soporta` : null;
}

/** ¿Le echa una mano (acompañarle, ayudarle)? No, por debajo de −10. */
export function refusesHelp(n: Npc, characterId: Id): boolean { return opinionOf(n, characterId) <= OPINION_THRESHOLDS.wary; }

/** ¿No quiere ni hablar con él? Por debajo de −50: se da la vuelta y se va. */
export function wontTalk(n: Npc, characterId: Id): boolean { return opinionOf(n, characterId) <= OPINION_THRESHOLDS.leaves; }

/** Lo que cambia la opinión en el trato, en una frase para el máster (null si nada). */
export function opinionEffects(n: Npc, characterId: Id): string | null {
  const v = opinionOf(n, characterId);
  if (!v) return null;
  const dc = socialDcShift(n, characterId);
  const price = priceFactor(n, characterId, 'buy');
  const bits = [
    dc ? `CD social ${dc > 0 ? '+' : ''}${dc} (ya la suma el servidor: pon la CD base)` : '',
    price !== 1 ? `precios ${price < 1 ? '−' : '+'}${Math.round(Math.abs(1 - price) * 100)} %` : '',
    wontTalk(n, characterId) ? 'NO QUIERE HABLAR con el actor: se da la vuelta y se va' : opinionOf(n, characterId) <= OPINION_THRESHOLDS.refuses ? 'no le vende ni le aloja' : refusesHelp(n, characterId) ? 'no le ayuda ni le acompaña' : '',
    v >= OPINION_THRESHOLDS.allied ? 'le ayuda aunque le cueste' : v >= OPINION_THRESHOLDS.friendly ? 'le trata con confianza' : '',
  ].filter(Boolean);
  return bits.join('; ') || null;
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export type TagKind = 'race' | 'class' | 'background' | 'earned';

export interface CharacterTag { id: Id; label: string; kind: TagKind; fact_id?: Id | null; why?: string }

/** Etiquetas de origen: `raza:elf`, `clase:wizard`, `trasfondo:sage` (ids SRD). */
export const raceTag = (id: string) => `raza:${id}`;
export const classTag = (id: string) => `clase:${id}`;
export const backgroundTag = (id: string) => `trasfondo:${id}`;

export function tagDefs(world: World): TagDef[] {
  return (world.campaign as typeof world.campaign & { tags?: TagDef[] }).tags ?? [];
}

export function tagLabel(world: World, id: Id): string {
  return tagDefs(world).find((t) => t.id === id)?.label ?? id.replace(/^[a-z]+:/, '').replace(/[_-]/g, ' ');
}

/** Todas las del PJ: las de origen (raza, clase, trasfondo) y las ganadas. */
export function tagsOf(world: World, c: Character): CharacterTag[] {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const born: CharacterTag[] = [
    { id: raceTag(c.race_id), label: lower(c.race), kind: 'race' },
    { id: classTag(c.class_id), label: lower(c.class_name), kind: 'class' },
  ];
  const bg = BACKGROUNDS.find((b) => b.id === c.background_id);
  if (c.background_id) born.push({ id: backgroundTag(c.background_id), label: lower(bg?.name ?? c.background_id), kind: 'background' });
  return [...born, ...(c.tags ?? []).map((t): CharacterTag => ({ id: t.id, label: tagLabel(world, t.id), kind: 'earned', fact_id: t.fact_id, why: t.why }))];
}

export function hasTag(world: World, c: Character, id: Id): boolean { return tagsOf(world, c).some((t) => t.id === id); }

/** Gana una etiqueta (la apunta con su porqué y el hecho que la dio). true si no la tenía. */
export function earnTag(world: World, c: Character, id: Id, why: string, factId: Id | null, nowS: number): boolean {
  if (hasTag(world, c, id)) return false;
  c.tags = [...(c.tags ?? []), { id, game_s: nowS, why, fact_id: factId }];
  world.touch('characters', c.id);
  return true;
}

export function dropTag(world: World, c: Character, id: Id): boolean {
  if (!(c.tags ?? []).some((t) => t.id === id)) return false;
  c.tags = (c.tags ?? []).filter((t) => t.id !== id);
  world.touch('characters', c.id);
  return true;
}

/**
 * ¿Sabe ese NPC que el PJ tiene esa etiqueta? Las de origen se ven (o se
 * notan) teniéndole delante; las ganadas, si sabe el hecho que la dio
 * (`knows(factId)`) o si no salen de ningún hecho. Nunca por adivinación.
 */
export function npcKnowsTag(world: World, n: Npc, c: Character, tag: CharacterTag, knows: (factId: Id) => boolean): boolean {
  if (tag.kind !== 'earned') {
    const here = world.characterSpot(c)?.location_id;
    return !c.transit && !!here && world.spots.get(n.location.id)?.location_id === here;
  }
  return tag.fact_id ? knows(tag.fact_id) : true;
}

/** Reacciones de un NPC a las etiquetas del PJ que sabe que tiene. */
export function tagReactionsFor(world: World, n: Npc, c: Character, knows: (factId: Id) => boolean): { reaction: TagReaction; tag: CharacterTag }[] {
  if (!n.tag_reactions?.length) return [];
  const tags = tagsOf(world, c);
  return n.tag_reactions.flatMap((r) => {
    const tag = tags.find((t) => t.id === r.tag);
    return tag && npcKnowsTag(world, n, c, tag, knows) ? [{ reaction: r, tag }] : [];
  });
}
