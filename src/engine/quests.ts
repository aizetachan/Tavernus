/**
 * Misiones que se aceptan solas. Cuando un NPC le da al PJ un encargo o le
 * pide algo concreto en la conversación, la misión entra en el Diario «en
 * curso» sin que el jugador diga «acepto»; hacerla o no ya es cosa suya.
 *
 *   - Encargos del tablón: basta hablar del encargo con quien lo pide
 *     (journal.ts, engagedAt).
 *   - Historia escrita (story.ts): se abren con sus condiciones, sin aceptar.
 *   - Lo que pide un NPC fuera del tablón: el máster llama a `give_quest` y
 *     queda aquí, en el PJ, con su texto, quién la da, el objetivo y la
 *     recompensa si se dijo. El aviso «Nueva misión: …» sale en el hilo.
 *
 * El jugador puede dejar una misión desde el Diario («Dejar esta misión»): un
 * encargo del tablón vuelve a «disponible» (si sigue en el tablón) y una
 * misión dada, también; si se vuelve a hablar de ella, se retoma.
 *
 * Todo vive en propiedades opcionales del personaje, sin tocar model.ts:
 * `given_quests?: GivenQuest[]`, `dropped_quests?: DroppedQuest[]`.
 */

import { normalize } from './aliases.js';
import type { Character, Id } from './model.js';
import type { World } from './world.js';

export interface GivenQuest {
  id: Id;
  title: string;
  text: string;
  giver_npc_id: Id | null;
  objective: string | null;
  reward: string | null;
  status: 'active' | 'completed' | 'failed';
  given_game_s: number;
  updated_game_s: number;
}

export interface DroppedQuest { id: Id; game_s: number }

type Holder = Character & { given_quests?: GivenQuest[]; dropped_quests?: DroppedQuest[] };

/** Tope de misiones dadas por PJ (las cerradas más antiguas se olvidan antes). */
export const MAX_GIVEN = 30;

export function givenQuests(c: Character): readonly GivenQuest[] { return (c as Holder).given_quests ?? []; }

/** Cuándo dejó el PJ esta misión (la última vez), o null. */
export function droppedAt(c: Character, questId: Id): number | null {
  return (c as Holder).dropped_quests?.find((d) => d.id === questId)?.game_s ?? null;
}

export interface GiveInput {
  title: string;
  text: string;
  giver_npc_id?: Id | null;
  objective?: string | null;
  reward?: string | null;
}

/**
 * Registra una misión dada por un NPC. Si ya tiene una con el mismo título y
 * del mismo NPC, la devuelve (`existing`) y, si la había dejado, la retoma.
 */
export function giveQuest(world: World, c: Character, input: GiveInput, nowS: number): { ok: true; quest: GivenQuest; existing: boolean } | { ok: false; error: string } {
  const title = input.title.trim().replace(/^[«"]|[»"]$/g, '');
  const text = input.text.trim();
  if (!title) return { ok: false, error: 'falta el título' };
  if (!text) return { ok: false, error: 'falta de qué va' };
  const giver = input.giver_npc_id && input.giver_npc_id !== 'null' ? input.giver_npc_id : null;
  if (giver && !world.npcs.has(giver)) return { ok: false, error: `${giver} no es un NPC` };
  const h = c as Holder;
  const list = h.given_quests ??= [];
  const same = list.find((q) => normalize(q.title) === normalize(title) && q.giver_npc_id === giver);
  if (same) {
    if (droppedAt(c, same.id) !== null) h.dropped_quests = h.dropped_quests!.filter((d) => d.id !== same.id);
    if (same.status !== 'active') same.status = 'active';
    same.updated_game_s = nowS;
    world.touch('characters', c.id);
    return { ok: true, quest: same, existing: true };
  }
  const slug = normalize(title).replace(/ /g, '_').slice(0, 24) || 'mision';
  let id = `gq_${slug}`;
  for (let n = 2; list.some((q) => q.id === id); n++) id = `gq_${slug}_${n}`;
  const clean = (v: string | null | undefined) => (v && v !== 'null' && v.trim() ? v.trim() : null);
  const quest: GivenQuest = {
    id, title, text, giver_npc_id: giver, objective: clean(input.objective), reward: clean(input.reward),
    status: 'active', given_game_s: nowS, updated_game_s: nowS,
  };
  list.push(quest);
  while (list.length > MAX_GIVEN) {
    const i = list.findIndex((q) => q.status !== 'active');
    list.splice(i < 0 ? 0 : i, 1);
  }
  world.touch('characters', c.id);
  return { ok: true, quest, existing: false };
}

/** Cierra una misión dada: cumplida o fallida. */
export function finishQuest(world: World, c: Character, questId: Id, outcome: 'completed' | 'failed', nowS: number): { ok: true; quest: GivenQuest } | { ok: false; error: string } {
  const q = givenQuests(c).find((x) => x.id === questId || normalize(x.title) === normalize(questId));
  if (!q) return { ok: false, error: `el actor no tiene la misión ${questId}` };
  q.status = outcome;
  q.updated_game_s = nowS;
  world.touch('characters', c.id);
  return { ok: true, quest: q };
}

/**
 * El jugador deja una misión (encargo del tablón o misión dada). La misión
 * principal, las deudas y la historia escrita no se dejan.
 */
export function dropQuest(world: World, c: Character, questId: Id, nowS: number): { ok: true; title: string } | { ok: false; error: string } {
  const given = givenQuests(c).find((q) => q.id === questId);
  const job = world.campaign.jobs.find((j) => j.id === questId);
  if (!given && !job) return { ok: false, error: 'Esa misión no se puede dejar.' };
  if (given && given.status !== 'active') return { ok: false, error: 'Esa misión ya está cerrada.' };
  if (job && c.completed_jobs.includes(job.id)) return { ok: false, error: 'Ese encargo ya está cumplido.' };
  const h = c as Holder;
  h.dropped_quests = [...(h.dropped_quests ?? []).filter((d) => d.id !== questId), { id: questId, game_s: nowS }].slice(-50);
  if (given) given.updated_game_s = nowS;
  world.touch('characters', c.id);
  return { ok: true, title: given?.title ?? job!.title };
}

/** Bloque del contexto del máster: lo que el PJ tiene entre manos por encargo de alguien. */
export function givenContext(world: World, c: Character): string | null {
  const open = givenQuests(c).filter((q) => q.status === 'active' && droppedAt(c, q.id) === null);
  if (!open.length) return null;
  const who = (id: Id | null) => (id ? world.npcs.get(id)?.name ?? id : 'nadie en concreto');
  return ['## Misiones que le han dado', ...open.map((q) => `- [${q.id}] «${q.title}» (de ${who(q.giver_npc_id)}): ${q.objective ?? q.text}${q.reward ? ` · recompensa: ${q.reward}` : ''}`),
    'Cuando la cumpla o ya no se pueda, finish_quest con su ID.'].join('\n');
}
