/**
 * Reacciones entre jugadores (docs/MULTIJUGADOR.md, «Reacciones»). Lo que un PJ
 * le hace a otro con las manos (agarrarlo, arrastrarlo, empujarlo, atacarlo)
 * no lo decide quien actúa ni el máster: el afectado lo ve en su hilo y elige
 * dejarse o resistirse. Dejarse sale sin tirada; resistirse, con la tirada
 * enfrentada del SRD (agarrar y empujar: Atletismo contra el mejor de
 * Atletismo o Acrobacias del otro; atacar: tirada de ataque contra su CA).
 * Si no responde a tiempo, se resiste por instinto (la regla manda, como el
 * ausente que se defiende).
 *
 * Funciones puras sobre el mundo; el motor (engine.ts) guarda la petición en
 * el afectado (`Character.reactions`), emite los eventos y resuelve.
 */

import { normalize } from './aliases.js';
import type { Advantage, CheckResult, Rng } from './dice.js';
import { parseTrivial } from './fastpath.js';
import type { Character, Id, Reaction, ReactionKind } from './model.js';
import { aEs } from './narrate.js';
import { characterCheck, skillModifier, SKILLS } from './rules.js';
import type { World } from './world.js';

/** Lo que tiene el afectado para decidir (ms reales). Bastante para leer y pensar; poco para no dejar parado a quien actúa. */
export const REACTION_TTL_MS = 90 * 1000;
/** Lo que dura «agarrado» sin otra cosa que lo quite (segundos de juego). */
export const GRAPPLE_S = 10 * 60;
/** Lo que dura «derribado»: levantarse cuesta poco (segundos de juego). */
export const PRONE_S = 60;

/** Lo que pide el actor sobre otro PJ, reconocido por el motor. */
export interface ReactionIntent {
  kind: ReactionKind;
  target: Character;
  /** Qué intenta, en infinitivo y para el afectado: «agarrarte y llevarte a la taberna». */
  attempt: string;
  /** Adónde se lo lleva si sale bien (arrastrar, llevar). */
  dest_spot_id: Id | null;
  /** Empujar para tirarle al suelo (derribado) en vez de apartarle. */
  prone: boolean;
}

// Verbos sobre texto en minúsculas y sin tildes (la ñ se queda).
const ATTACK = /\b(?:atac\w*|golpe(?:o|a|ar\w*)|peg(?:o|a|ar|arle|arla|arlo)|apunal\w*|acuchill\w*|dispar\w*|hiero|herir\w*|mat(?:o|ar|arle|arla|arlo)|abofete\w*|apale\w*|ensart\w*|lanz(?:o|ar)\s+(?:un|una|mi)\s+\w+\s+contra)\b/;
const ATTACK_NOUN = /\b(?:punetazo|puñetazo|patada|bofetada|tortazo|cabezazo|codazo|rodillazo|guantazo|golpe|tajo|navajazo|espadazo|flechazo|mamporro|sopapo|estocada)s?\b/;
const GRAPPLE = /\b(?:agarr\w*|coj(?:o|e)|coger(?:le|la|lo)?|sujet\w*|inmoviliz\w*|arrastr\w*|llev(?:o|ar|arme|arle|arla|arlo)|levant(?:o|ar)|carg(?:o|ar)\s+con|abraz\w*|plac(?:o|ar|arle|arla|arlo)|at(?:o|ar)|tir(?:o|ar)\s+de|me\s+(?:la|lo)\s+llevo)\b/;
const SHOVE = /\b(?:empuj\w*|apart(?:o|ar|arle|arla|arlo)|derrib\w*|zancadill\w*|tumb(?:o|ar)|tir(?:o|ar)(?:le|la|lo)?\s+al\s+suelo|ech(?:o|ar))\b/;
/** Lo que corta la frase entre el verbo y el nombre: otra acción, otra persona. */
const CLAUSE_BREAK = /\s(?:y|e|pero|que|mientras|con|junto|para|porque|luego|despues)\s/;
/** Destino tras el nombre: «… a la taberna para tomar algo». */
const DEST = /\b(?:a|al|hasta|hacia)\s+((?:la|el|los|las)\s+)?([a-zñ0-9 ]+?)(?=\s+(?:para|a\s+(?:tomar|beber|comer|ver|hablar|por)|y|e|que|mientras|porque|con)\b|$)/;

function plain(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»"“”¡!¿?]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Otros PJ en la sala del actor, vivos, que no sean él. */
function presentOthers(world: World, actor: Character): Character[] {
  const here = world.characterSpot(actor)?.location_id;
  return [...world.characters.values()].filter((o) => o.id !== actor.id && o.status !== 'dead' && o.status !== 'retired' && world.characterSpot(o)?.location_id === here);
}

/**
 * ¿Hace el actor algo con las manos sobre otro PJ presente? «agarro a Mira y
 * la llevo a la taberna», «le doy un puñetazo a Mira», «empujo a Mira al
 * suelo». El nombre va tras «a» y el verbo en la misma frase, como mucho a
 * cinco palabras y sin otra acción en medio («cojo la jarra y se la doy a Mira»
 * no es agarrar a Mira). null si no.
 */
export function parseReaction(world: World, actor: Character, text: string): ReactionIntent | null {
  const t = plain(text);
  if (!t) return null;
  for (const o of presentOthers(world, actor)) {
    const name = plain(o.name);
    if (!name) continue;
    const at = new RegExp(`(^|[^a-zñ0-9])(?:a|al)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zñ0-9])`).exec(t);
    if (!at) continue;
    const before = t.slice(0, at.index + at[1]!.length);
    // La frase del nombre: desde el último corte (punto, coma, «y»…) y como mucho cinco palabras.
    const clause = (before.split(/[.,;:]/).at(-1) ?? '').trim();
    const cut = clause.split(CLAUSE_BREAK).at(-1)!.trim();
    const window = cut.split(' ').slice(-5).join(' ');
    const kind: ReactionKind | null = ATTACK.test(window) || ATTACK_NOUN.test(window) ? 'attack' : SHOVE.test(window) ? 'shove' : GRAPPLE.test(window) ? 'grapple' : null;
    if (!kind) continue;
    const after = t.slice(at.index + at[0].length);
    const prone = kind === 'shove' && /\b(?:suelo|derrib\w*|tumb\w*|zancadill\w*)\b/.test(`${window} ${after}`);
    const dest = kind === 'grapple' ? destination(world, actor, after) : null;
    return { kind, target: o, attempt: attemptText(world, kind, dest, prone), dest_spot_id: dest, prone };
  }
  return null;
}

/** El sitio al que se lo lleva, si lo dice y existe para el actor (como «ir a …»). */
function destination(world: World, actor: Character, after: string): Id | null {
  const m = DEST.exec(after);
  if (!m) return null;
  const what = `${m[1] ?? ''}${m[2]!}`.trim();
  if (!normalize(what)) return null;
  const move = parseTrivial(world, actor, `ir a ${what}`);
  if (!move || move.kind !== 'move' || move.spot_id === world.characterSpot(actor)?.id) return null;
  return move.spot_id;
}

/** Qué intenta, para el afectado: «agarrarte y llevarte a la taberna», «empujarte», «atacarte». */
export function attemptText(world: World, kind: ReactionKind, destSpotId: Id | null, prone = false): string {
  if (kind === 'attack') return 'atacarte';
  if (kind === 'shove') return prone ? 'tirarte al suelo de un empujón' : 'apartarte de un empujón';
  if (!destSpotId) return 'agarrarte';
  const spot = world.spots.get(destSpotId);
  const loc = spot ? world.locations.get(spot.location_id) : undefined;
  // Al sitio por su nombre; a la entrada de una localización, por el de la localización.
  const where = spot && loc && loc.default_spot_id !== spot.id ? spot.name : loc?.name ?? spot?.name ?? '';
  return `agarrarte y llevarte ${aEs(where)}`;
}

/** Skills de la tirada enfrentada (SRD): agarrar y empujar, Atletismo contra el mejor de Atletismo o Acrobacias. */
export function contestOf(r: Pick<Reaction, 'kind' | 'contest'>): { actor: string; target: string[] } {
  if (r.contest && SKILLS[r.contest.actor] && r.contest.target.some((k) => SKILLS[k])) return { actor: r.contest.actor, target: r.contest.target.filter((k) => SKILLS[k]) };
  return { actor: 'athletics', target: ['athletics', 'acrobatics'] };
}

export interface ContestOutcome {
  actor: CheckResult & { label: string };
  target: CheckResult & { label: string };
  /** Gana quien actúa; el empate deja las cosas como estaban (SRD), así que lo pierde. */
  success: boolean;
}

/** Tirada enfrentada: quien actúa con su skill y el afectado con la mejor de las suyas. */
export function contest(actor: Character, target: Character, r: Pick<Reaction, 'kind' | 'contest'>, rng?: Rng, actorAdvantage: Advantage = 'none'): ContestOutcome {
  const c = contestOf(r);
  const best = [...c.target].sort((a, b) => skillModifier(target, b) - skillModifier(target, a))[0]!;
  const a = characterCheck(actor, 'skill', c.actor, null, actorAdvantage, rng);
  const t = characterCheck(target, 'skill', best, null, 'none', rng);
  return { actor: a, target: t, success: a.total > t.total };
}

/** Peticiones vivas que alguien ha recibido. */
export function reactionsOf(c: Character, nowMs: number): Reaction[] {
  return (c.reactions ?? []).filter((r) => r.expires_real_ms > nowMs);
}

/** Busca una petición por id entre las de todos (la recibe un PJ). */
export function findReaction(world: World, reactionId: Id): { reaction: Reaction; to: Character } | null {
  for (const c of world.characters.values()) {
    const r = c.reactions?.find((x) => x.id === reactionId);
    if (r) return { reaction: r, to: c };
  }
  return null;
}

/** La petición que un PJ ha hecho y aún espera respuesta (como mucho una). */
export function pendingFrom(world: World, fromId: Id): { reaction: Reaction; to: Character } | null {
  for (const c of world.characters.values()) {
    const r = c.reactions?.find((x) => x.from_id === fromId);
    if (r) return { reaction: r, to: c };
  }
  return null;
}

export function dropReaction(world: World, to: Character, reactionId: Id): void {
  to.reactions = (to.reactions ?? []).filter((r) => r.id !== reactionId);
  if (!to.reactions.length) delete to.reactions;
  world.touch('characters', to.id);
}

/** ¿Acepta con sus palabras? «vale», «sí, vamos», «me dejo». Lo demás es resistirse. */
export function readsAsAccept(text: string): boolean {
  return /^(?:vale|venga|si|sí|claro|de acuerdo|ok|okey|vamos|me dejo|dejo que|bueno|va|por supuesto|encantad[oa])\b/i.test(plain(text));
}

/** «1:30» para los avisos. */
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
