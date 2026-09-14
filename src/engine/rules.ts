/**
 * Reglas 5e SRD mínimas para tiradas (SPEC §4.2): skills, salvaciones y
 * modificadores. El servidor calcula; el LLM nunca.
 */

import { abilityModifier, proficiencyBonus, rollD20, type Advantage, type CheckResult, type Rng } from './dice.js';
import type { Character } from './model.js';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const SKILLS: Record<string, { ability: Ability; es: string }> = {
  acrobatics: { ability: 'dex', es: 'Acrobacias' },
  animal_handling: { ability: 'wis', es: 'Trato con animales' },
  arcana: { ability: 'int', es: 'Arcanos' },
  athletics: { ability: 'str', es: 'Atletismo' },
  deception: { ability: 'cha', es: 'Engaño' },
  history: { ability: 'int', es: 'Historia' },
  insight: { ability: 'wis', es: 'Perspicacia' },
  intimidation: { ability: 'cha', es: 'Intimidación' },
  investigation: { ability: 'int', es: 'Investigación' },
  medicine: { ability: 'wis', es: 'Medicina' },
  nature: { ability: 'int', es: 'Naturaleza' },
  perception: { ability: 'wis', es: 'Percepción' },
  performance: { ability: 'cha', es: 'Interpretación' },
  persuasion: { ability: 'cha', es: 'Persuasión' },
  religion: { ability: 'int', es: 'Religión' },
  sleight_of_hand: { ability: 'dex', es: 'Juego de manos' },
  stealth: { ability: 'dex', es: 'Sigilo' },
  survival: { ability: 'wis', es: 'Supervivencia' },
};

export const ABILITY_ES: Record<Ability, string> = { str: 'Fuerza', dex: 'Destreza', con: 'Constitución', int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma' };

export type CheckKind = 'skill' | 'save' | 'ability' | 'attack';

export function skillModifier(c: Character, skill: string): number {
  const def = SKILLS[skill];
  if (!def) throw new Error(`skill desconocida: ${skill}`);
  const base = abilityModifier(c.abilities[def.ability]) + (c.practice_bonus[skill] ?? 0);
  const pb = proficiencyBonus(c.level);
  if (c.proficiencies.expert.includes(skill)) return base + pb * 2;
  if (c.proficiencies.skills.includes(skill)) return base + pb;
  return base;
}

export function saveModifier(c: Character, ability: Ability): number {
  return abilityModifier(c.abilities[ability]) + (c.proficiencies.saves.includes(ability) ? proficiencyBonus(c.level) : 0);
}

/** Modificador para una tirada del PJ. `key`: skill 5e, característica, o 'melee'/'ranged' para ataques. */
export function modifierFor(c: Character, kind: CheckKind, key: string): { modifier: number; label: string } {
  switch (kind) {
    case 'skill': return { modifier: skillModifier(c, key), label: SKILLS[key]?.es ?? key };
    case 'save': return { modifier: saveModifier(c, key as Ability), label: `salvación de ${ABILITY_ES[key as Ability] ?? key}` };
    case 'ability': return { modifier: abilityModifier(c.abilities[key as Ability] ?? 10), label: ABILITY_ES[key as Ability] ?? key };
    case 'attack': {
      const ab: Ability = key === 'ranged' || key === 'finesse' ? 'dex' : 'str';
      return { modifier: abilityModifier(c.abilities[ab]) + proficiencyBonus(c.level), label: key === 'ranged' ? 'ataque a distancia' : 'ataque cuerpo a cuerpo' };
    }
  }
}

export function characterCheck(c: Character, kind: CheckKind, key: string, dc: number | null, advantage: Advantage, rng?: Rng): CheckResult & { label: string } {
  const { modifier, label } = modifierFor(c, kind, key);
  return { ...rollD20(modifier, dc, advantage, rng), label };
}

/** Clase de Armadura (SPEC §4.2): armadura equipada + DES (con tope) + escudo en mano. */
export function armorClass(world: { itemsIn: (p: { type: 'character'; id: string; slot: { kind: 'equipped'; slot: 'body' } | { kind: 'hand'; which: 'main' | 'off' | 'both' } }) => { item_id: string }[]; itemDef: (id: string) => { armor?: { ac_base: number; dex_max: number | null }; shield_bonus?: number } }, c: Character): number {
  const dex = abilityModifier(c.abilities.dex);
  const body = world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'equipped', slot: 'body' } })[0];
  const armor = body ? world.itemDef(body.item_id).armor : undefined;
  let ac = armor ? armor.ac_base + (armor.dex_max === null ? dex : Math.min(dex, armor.dex_max)) : 10 + dex;
  for (const which of ['main', 'off', 'both'] as const) {
    for (const i of world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'hand', which } })) ac += world.itemDef(i.item_id).shield_bonus ?? 0;
  }
  return ac;
}

export function passivePerception(c: Character): number {
  return 10 + skillModifier(c, 'perception');
}
