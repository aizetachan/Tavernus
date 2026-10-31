import { describe, expect, it } from 'vitest';
import { draftSpec, finalAbilities, nextAbility, recommendedAbilities, remainingArrayValues, skillChoices, type CharacterDraft } from '../src/engine/creation.js';
import { bootEngine } from './helpers.js';

describe('creación de personaje sin cliente', () => {
  it('repartir el array a mano va pidiendo la siguiente característica y quita los valores usados', () => {
    expect(nextAbility()).toBe('str');
    expect(remainingArrayValues()).toEqual([15, 14, 13, 12, 10, 8]);
    const abilities = { str: 8, dex: 15 };
    expect(nextAbility(abilities)).toBe('con');
    expect(remainingArrayValues(abilities)).toEqual([14, 13, 12, 10]);
  });

  it('las habilidades que dan la raza y el trasfondo no se ofrecen', () => {
    const c = skillChoices({ race_id: 'elf', class_id: 'rogue', background_id: 'criminal' })!;
    expect(c.fixed.sort()).toEqual(['deception', 'perception', 'stealth']);
    expect(c.count).toBe(4);
    expect(c.options.map((o) => o.id)).not.toContain('stealth');
    expect(c.options.find((o) => o.id === 'acrobatics')?.label).toBe('Acrobacias');
    expect(skillChoices({})).toBeNull();
  });

  it('sin todos los pasos no hay ficha; con ellos, el motor la acepta', async () => {
    const draft: CharacterDraft = { name: 'Tam', race_id: 'elf', class_id: 'rogue', background_id: 'criminal' };
    expect(draftSpec(draft)).toBeNull();
    expect(finalAbilities(draft)).toBeNull();
    draft.abilities = recommendedAbilities('rogue')!;
    expect(Object.values(draft.abilities).sort((a, b) => b - a)).toEqual([15, 14, 13, 12, 10, 8]);
    draft.skills = skillChoices(draft)!.options.slice(0, 4).map((o) => o.id);
    const spec = draftSpec(draft)!;
    expect(spec.death_mode).toBe('casual');
    const { engine } = await bootEngine();
    const r = await engine.createCharacter('u1', draft.name, spec);
    if (!r.ok) throw new Error(r.reason);
    expect(r.character.abilities).toEqual(finalAbilities(draft));
  });
});
