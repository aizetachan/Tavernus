/**
 * Confianza de cada NPC en cada PJ, por niveles (extraño, conocido, amigo,
 * aliado). Decide qué parte de lo que sabe el NPC (`npc.knowledge`) llega al
 * máster: lo que no ha desbloqueado el PJ no está en su contexto, así que no lo
 * puede soltar (Obsidian, «Revisión partida 2026-10-27», bloque B).
 *
 * Por debajo hay puntos (`npc.trust[pj]`):
 *   - Suben con lo que se hace por él: misiones (+3), encargos del tablón y
 *     recados que le llegan en mano (+2), sin tope; y en la charla, tiradas sociales con éxito (+1), regalos (+1) y
 *     favores (+2) y adulación (+1, si su carácter la agradece), con tope por
 *     conversación (TALK_CAP). Así un extraño sigue
 *     siendo un extraño al acabar la primera charla, por mucho que tire.
 *   - Bajan con amenazas, mentiras descubiertas, insultos, hostigamiento (insistir
 *     cuando ya dijo que no), adular a quien no lo soporta y crímenes, sin tope.
 *   - La actitud del NPC hacia ese PJ manda encima: hostil o recelosa lo deja en
 *     extraño; amistosa da como mínimo amigo; aliada, aliado.
 *
 * El nivel sale siempre de `trustTier(npc, pj)`, a partir del estado del NPC.
 * Cuando haya opinión numérica con umbrales (bloque I), basta con cambiar esa
 * función para que lea la opinión: el resto (prompt, pistas, condiciones) no
 * mira los puntos.
 */

import type { Character, Id, Npc, NpcKnowledge, NpcTrust, TrustTier } from './model.js';
import type { World } from './world.js';

export const TRUST_TIERS: readonly TrustTier[] = ['stranger', 'acquaintance', 'friend', 'ally'];

/** Nombre de cada nivel, para el máster y el jugador. */
export const TRUST_LABEL: Record<TrustTier, string> = { stranger: 'extraño', acquaintance: 'conocido', friend: 'amigo', ally: 'aliado' };

/** Puntos que hacen falta para cada nivel. */
export const TRUST_THRESHOLD: Record<TrustTier, number> = { stranger: 0, acquaintance: 2, friend: 5, ally: 9 };

/**
 * Lo más que se gana en una sola conversación (tiradas, regalos y favores juntos). Con 1, un extraño no pasa de
 * extraño en la primera charla (conocido pide 2): lo que abre la historia pide varias charlas o hechos.
 */
export const TALK_CAP = 1;

/** Dos charlas a menos de esto cuentan como la misma conversación (no vale despedirse y volver). */
export const TALK_GAP_S = 3600;

/** Qué mueve la confianza y cuánto. Las de la charla (`talk`) van con tope por conversación. */
export const TRUST_CHANGES = {
  social_roll: { delta: 1, talk: true },
  gift: { delta: 1, talk: true },
  favor: { delta: 2, talk: true },
  /** Adularle: sube si su carácter lo agradece; a quien no lo soporta (`npc.dislikes_flattery`) le resta, como un insulto. */
  flattery: { delta: 1, talk: true },
  job: { delta: 2, talk: false },
  /** Un recado que le llega en mano (lo dice la historia escrita): le presenta al PJ con algo hecho. */
  errand: { delta: 2, talk: false },
  quest: { delta: 3, talk: false },
  insult: { delta: -1, talk: false },
  /** Hostigarle: insistir cuando ya dijo que no, presionarle una y otra vez. Resta cada vez. */
  harass: { delta: -1, talk: false },
  threat: { delta: -2, talk: false },
  lie_caught: { delta: -2, talk: false },
  witnessed_crime: { delta: -3, talk: false },
  attacked: { delta: -5, talk: false },
} as const satisfies Record<string, { delta: number; talk: boolean }>;
export type TrustChange = keyof typeof TRUST_CHANGES;

/** Las que puede pedir el máster con npc_trust (las demás las aplica el motor solo). */
export const MASTER_TRUST_CHANGES = ['favor', 'gift', 'flattery', 'insult', 'harass', 'threat', 'lie_caught'] as const satisfies readonly TrustChange[];

/** La adulación con quien no la soporta: resta, sin tope, como un insulto. */
const FLATTERY_DISLIKED = { delta: -1, talk: false } as const;

export const tierRank = (t: TrustTier): number => TRUST_TIERS.indexOf(t);

/** Lo que sabe un NPC por niveles. Sin `knowledge` (mundos generados, partidas de antes), su secreto cuenta como de amigo. */
export function knowledgeOf(n: Npc): NpcKnowledge[] {
  if (n.knowledge) return n.knowledge;
  return n.secret?.trim() ? [{ tier: 'friend', text: n.secret }] : [];
}

export function trustPoints(n: Npc, characterId: Id): number {
  return n.trust?.[characterId]?.points ?? 0;
}

/** El nivel de confianza del NPC con este PJ, a partir de su estado (puntos y actitud). */
export function trustTier(n: Npc, characterId: Id): TrustTier {
  const att = n.attitude.by_character[characterId];
  if (att === 'hostile' || att === 'unfriendly') return 'stranger';
  const pts = trustPoints(n, characterId);
  let tier: TrustTier = 'stranger';
  for (const t of TRUST_TIERS) if (pts >= TRUST_THRESHOLD[t]) tier = t;
  const floor: TrustTier | null = att === 'allied' ? 'ally' : att === 'friendly' ? 'friend' : null;
  return floor && tierRank(floor) > tierRank(tier) ? floor : tier;
}

export function trustAtLeast(n: Npc, characterId: Id, tier: TrustTier): boolean {
  return tierRank(trustTier(n, characterId)) >= tierRank(tier);
}

/** Lo que este NPC le contaría a este PJ ahora mismo; el resto no sale de aquí. */
export function knowledgeFor(n: Npc, characterId: Id): NpcKnowledge[] {
  const t = tierRank(trustTier(n, characterId));
  return knowledgeOf(n).filter((k) => tierRank(k.tier) <= t);
}

/** Cuánto le falta para el siguiente nivel, o null si ya es aliado o si la actitud lo bloquea. */
export function nextTier(n: Npc, characterId: Id): { tier: TrustTier; points: number } | null {
  const att = n.attitude.by_character[characterId];
  if (att === 'hostile' || att === 'unfriendly') return null;
  const cur = tierRank(trustTier(n, characterId));
  const next = TRUST_TIERS[cur + 1];
  return next ? { tier: next, points: Math.max(0, TRUST_THRESHOLD[next] - trustPoints(n, characterId)) } : null;
}

/** El nivel con el que contaría lo siguiente que calla a este PJ, o null si ya lo cuenta todo. */
export function heldBackTier(n: Npc, characterId: Id): TrustTier | null {
  const t = tierRank(trustTier(n, characterId));
  const ranks = knowledgeOf(n).map((k) => tierRank(k.tier)).filter((r) => r > t);
  return ranks.length ? TRUST_TIERS[Math.min(...ranks)]! : null;
}

export interface TrustResult {
  npc_id: Id;
  change: TrustChange;
  /** Lo que se ha aplicado de verdad (0 si el tope de la charla ya estaba lleno). */
  delta: number;
  points: number;
  before: TrustTier;
  after: TrustTier;
}

/**
 * Mueve la confianza del NPC en el PJ. Lo que se gana en la charla va con tope por conversación: la de
 * `talking_to`, o la última si fue hace menos de TALK_GAP_S. Las bajadas no tienen tope.
 */
export function adjustTrust(world: World, n: Npc, c: Character, change: TrustChange, nowS: number): TrustResult {
  const rule = change === 'flattery' && n.dislikes_flattery ? FLATTERY_DISLIKED : TRUST_CHANGES[change];
  const before = trustTier(n, c.id);
  const st: NpcTrust = (n.trust ??= {})[c.id] ??= { points: 0 };
  let delta: number = rule.delta;
  if (rule.talk && delta > 0) {
    const since = n.talking_to && (n.talking_to.character_id === c.id || n.talking_to.with?.includes(c.id)) ? n.talking_to.since_game_s : nowS;
    const same = st.talk && (st.talk.since_game_s === since || nowS - st.talk.last_game_s < TALK_GAP_S);
    const gained = same ? st.talk!.gained : 0;
    delta = Math.max(0, Math.min(delta, TALK_CAP - gained));
    st.talk = { since_game_s: same ? st.talk!.since_game_s : since, gained: gained + delta, last_game_s: nowS };
  }
  st.points += delta;
  world.touch('npcs', n.id);
  return { npc_id: n.id, change, delta, points: st.points, before, after: trustTier(n, c.id) };
}

/** El NPC con quien habla el PJ ahora, si hay uno. */
export function talkPartner(world: World, c: Character): Npc | null {
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive' || !n.talking_to) continue;
    if (n.talking_to.character_id === c.id || n.talking_to.with?.includes(c.id)) return n;
  }
  return null;
}

/** Habilidades sociales que suben la confianza al salir bien (Intimidación no: asusta, no gana). */
const WINNING_SKILLS = new Set(['persuasion', 'performance', 'insight']);

/**
 * Una tirada social en la charla: Persuasión, Interpretación o Perspicacia con éxito suben (con tope); Intimidar
 * resta siempre, salga o no; un Engaño que falla es una mentira descubierta; una Persuasión que falla cuenta como
 * insistir. Con éxito nunca salta niveles: da el camino, no el secreto (talk.ts, `socialOutcomeLine`).
 */
export function trustFromRoll(world: World, c: Character, skill: string, success: boolean | null, nowS: number): TrustResult | null {
  const n = talkPartner(world, c);
  if (!n) return null;
  if (skill === 'intimidation') return adjustTrust(world, n, c, 'threat', nowS);
  if (skill === 'deception' && success === false) return adjustTrust(world, n, c, 'lie_caught', nowS);
  if (skill === 'persuasion' && success === false) return adjustTrust(world, n, c, 'harass', nowS);
  if (WINNING_SKILLS.has(skill) && success === true) return adjustTrust(world, n, c, 'social_roll', nowS);
  return null;
}

/** Aviso al jugador cuando cambia de nivel (solo entonces: los puntos no se enseñan). `who`: cómo llama el PJ al NPC. */
export function trustNotice(who: string, r: TrustResult): string | null {
  if (r.before === r.after) return null;
  const Who = who.charAt(0).toUpperCase() + who.slice(1);
  return tierRank(r.after) > tierRank(r.before) ? `${Who} se fía más de ti: ahora te tiene por ${TRUST_LABEL[r.after]}.`
    : `${Who} se fía menos de ti: vuelves a ser ${r.after === 'stranger' ? 'un extraño' : TRUST_LABEL[r.after]} para ${who}.`;
}
