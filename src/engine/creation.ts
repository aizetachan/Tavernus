/**
 * Creación de personaje con SRD (SPEC §4.6, §4.8), sin cliente: el borrador, lo que queda por
 * elegir en cada paso y los textos que lo explican. Cada cliente pinta los pasos a su manera y
 * manda `draftSpec(borrador)` a `Engine.createCharacter`, que es quien valida de verdad.
 *
 * Orden de los pasos: raza, clase, trasfondo, características, habilidades y modo de muerte.
 */

import { ABILITIES, backgroundById, classById, raceById, STANDARD_ARRAY } from '../data/srd/index.js';
import type { CharacterSpec } from './engine.js';
import { SKILLS, type Ability } from './rules.js';

export interface CharacterDraft {
  name: string;
  race_id?: string;
  class_id?: string;
  background_id?: string;
  abilities?: Partial<Record<Ability, number>>;
  skills?: string[];
  death_mode?: 'casual' | 'hardcore';
}

export const CREATION_STEPS = [
  { id: 'race', title: 'Raza', hint: 'Lo que eres desde que naciste.' },
  { id: 'class', title: 'Clase', hint: 'Lo que sabes hacer.' },
  { id: 'background', title: 'Trasfondo', hint: 'Lo que hacías antes de esto.' },
  { id: 'abilities', title: 'Características', hint: 'Se reparten los valores 15, 14, 13, 12, 10 y 8 (los bonus de raza se suman después).' },
  { id: 'skills', title: 'Habilidades', hint: 'Las que ya te dan la raza y el trasfondo no se eligen.' },
  { id: 'death', title: 'Si mueres', hint: 'Nunca es para siempre, pero hay dos maneras.' },
] as const;

export const DEATH_MODE_TEXT: Record<'casual' | 'hardcore', string> = {
  casual: 'Vuelves a las 2 horas reales con todo lo que llevabas.',
  hardcore: 'Vuelves a la media hora, pero lo que llevabas queda donde caíste y pierdes algo de fuerza hasta subir de nivel.',
};

/** El reparto del array estándar que recomienda la clase. */
export function recommendedAbilities(classId: string): Record<Ability, number> | null {
  const k = classById(classId);
  return k ? Object.fromEntries(ABILITIES.map((a, n) => [a, k.recommended[n]])) as Record<Ability, number> : null;
}

/** La siguiente característica sin valor, para repartir el array a mano; `undefined` si ya están todas. */
export function nextAbility(abilities: CharacterDraft['abilities'] = {}): Ability | undefined {
  return ABILITIES.find((a) => abilities[a] === undefined);
}

/** Los valores del array estándar que aún no se han usado. */
export function remainingArrayValues(abilities: CharacterDraft['abilities'] = {}): number[] {
  const used = Object.values(abilities);
  return STANDARD_ARRAY.filter((v) => !used.includes(v));
}

/** Las habilidades que ya vienen dadas y entre cuáles elegir, según raza, clase y trasfondo. */
export function skillChoices(draft: Pick<CharacterDraft, 'race_id' | 'class_id' | 'background_id'>): { fixed: string[]; options: { id: string; label: string }[]; count: number } | null {
  const k = draft.class_id ? classById(draft.class_id) : undefined;
  if (!k) return null;
  const fixed = [...new Set([...(draft.background_id ? backgroundById(draft.background_id)?.skills ?? [] : []), ...(draft.race_id ? raceById(draft.race_id)?.skills ?? [] : [])])];
  const options = k.skill_choices.from.filter((s) => !fixed.includes(s)).map((s) => ({ id: s, label: SKILLS[s]!.es }));
  return { fixed, options, count: Math.min(k.skill_choices.count, options.length) };
}

/** Las características finales, con los bonus de raza sumados: lo que enseña el resumen antes de confirmar. */
export function finalAbilities(draft: CharacterDraft): Record<Ability, number> | null {
  const r = draft.race_id ? raceById(draft.race_id) : undefined;
  if (!r || nextAbility(draft.abilities) !== undefined) return null;
  return Object.fromEntries(ABILITIES.map((a) => [a, draft.abilities![a]! + (r.ability_bonus[a] ?? 0)])) as Record<Ability, number>;
}

/** El borrador listo para `Engine.createCharacter`, o `null` si falta algún paso obligatorio. Sin modo de muerte, casual. */
export function draftSpec(draft: CharacterDraft): CharacterSpec | null {
  if (!draft.race_id || !draft.class_id || !draft.background_id || nextAbility(draft.abilities) !== undefined) return null;
  return {
    race_id: draft.race_id, class_id: draft.class_id, background_id: draft.background_id,
    abilities: draft.abilities as Record<Ability, number>, skills: draft.skills ?? [], death_mode: draft.death_mode ?? 'casual',
  };
}
