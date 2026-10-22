/**
 * Hechos de personaje: lo que el jugador inventa de su propio personaje y el
 * máster acepta («mi padre era herrero en la capital», «busco a mi hermana,
 * que se fue con unos cómicos»). Solo tocan a ese personaje: su pasado, sus
 * recuerdos, su gente fuera de escena. Son verdad para él, no para el mundo
 * compartido; lo que el jugador afirma del mundo va como rumor (rumors.ts,
 * con `said_by`). Un hecho no da objetos, monedas, competencias ni favores:
 * si el jugador quiere sacarle partido, el máster pide tirada o pone un coste.
 *
 * Se guardan en el personaje como propiedad opcional (`character.facts`), sin
 * tocar el modelo: viajan con el snapshot y se persisten al tocar el personaje.
 */

import type { Character, Id } from './model.js';
import type { World } from './world.js';

export const FACT_KINDS = ['background', 'memory', 'relationship'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface CharacterFact {
  id: Id;
  kind: FactKind;
  /** En tercera persona, una frase: «Su padre era herrero en la capital y le enseñó a juzgar el acero». */
  text: string;
  game_s: number;
  /** Acción del jugador en la que lo contó. */
  action: string | null;
}

export const FACTS_PER_DAY = 5;
export const MAX_FACTS = 24;
/** Cuántos van en el contexto de cada acción; el resto, con get_character. */
export const FACTS_IN_CONTEXT = 8;
const DAY_S = 24 * 3600;

function store(c: Character): CharacterFact[] {
  const ch = c as Character & { facts?: CharacterFact[] };
  ch.facts ??= [];
  return ch.facts;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

export function characterFacts(c: Character): readonly CharacterFact[] {
  return (c as Character & { facts?: CharacterFact[] }).facts ?? [];
}

export function recordFact(world: World, characterId: Id, input: { kind: string; text: string; action?: string | null }, nowGameS: number): { ok: true; fact: CharacterFact; existing: boolean } | { ok: false; error: string } {
  const c = world.characters.get(characterId);
  if (!c) return { ok: false, error: `no existe el personaje ${characterId}` };
  const text = (input.text ?? '').trim();
  if (!FACT_KINDS.includes(input.kind as FactKind)) return { ok: false, error: `kind debe ser uno de ${FACT_KINDS.join(', ')}` };
  if (!text) return { ok: false, error: 'text vacío: di qué ha contado de sí' };
  if (text.length > 240) return { ok: false, error: 'text demasiado largo (máx. 240 caracteres)' };
  const facts = store(c);
  const same = facts.find((f) => norm(f.text) === norm(text));
  if (same) return { ok: true, fact: same, existing: true };
  const today = Math.floor(nowGameS / DAY_S);
  if (facts.filter((f) => Math.floor(f.game_s / DAY_S) === today).length >= FACTS_PER_DAY) return { ok: false, error: `ya ha contado ${FACTS_PER_DAY} cosas de sí hoy: lo demás queda en la conversación, sin guardarlo` };
  if (facts.length >= MAX_FACTS) return { ok: false, error: `el personaje ya tiene ${MAX_FACTS} hechos guardados` };
  const fact: CharacterFact = {
    id: `cf_${Math.round(nowGameS).toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: input.kind as FactKind, text, game_s: nowGameS, action: input.action?.trim() || null,
  };
  facts.push(fact);
  world.touch('characters', c.id);
  return { ok: true, fact, existing: false };
}
