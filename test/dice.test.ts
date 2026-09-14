import { describe, expect, it } from 'vitest';
import { abilityModifier, proficiencyBonus, rollD20, rollExpr, seededRng } from '../src/engine/dice.js';

describe('dados', () => {
  it('evalúa expresiones y da un desglose', () => {
    const rng = seededRng(7);
    const r = rollExpr('2d6+3', rng);
    expect(r.rolls).toHaveLength(2);
    expect(r.total).toBe(r.rolls[0]! + r.rolls[1]! + 3);
    expect(r.breakdown).toMatch(/^2d6 \[\d, \d\] \+ 3 = \d+$/);
    expect(rollExpr('5', rng).total).toBe(5);
    expect(rollExpr('1d8-1', rng).total).toBeGreaterThanOrEqual(0);
    const kh = rollExpr('4d6kh3', rng);
    expect(kh.rolls).toHaveLength(4);
    expect(kh.total).toBe([...kh.rolls].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
    expect(() => rollExpr('hola')).toThrow();
    expect(() => rollExpr('999d999999')).toThrow();
  });

  it('d20 con ventaja, desventaja y CD; 20 y 1 naturales', () => {
    const rng = seededRng(3);
    const r = rollD20(5, 15, 'advantage', rng);
    expect(r.d20s).toHaveLength(2);
    expect(r.total).toBe(Math.max(...r.d20s) + 5);
    expect(r.success).toBe(r.total >= 15 || r.natural === 20);
    const d = rollD20(0, 10, 'disadvantage', rng);
    expect(d.total).toBe(Math.min(...d.d20s));
    // Fuerza naturales con un rng fijo.
    const always20 = () => 0.999;
    expect(rollD20(-10, 30, 'none', always20)).toMatchObject({ natural: 20, success: true });
    const always1 = () => 0;
    expect(rollD20(30, 5, 'none', always1)).toMatchObject({ natural: 1, success: false });
    expect(rollD20(2, null, 'none', always1).success).toBeNull();
  });

  it('modificadores 5e', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(15)).toBe(2);
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(4)).toBe(2);
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(17)).toBe(6);
  });
});
