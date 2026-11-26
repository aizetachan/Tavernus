import { describe, expect, it } from 'vitest';
import { conflictKindOf } from '../src/engine/conflict.js';
import { readsAsTheft } from '../src/engine/crime.js';

// Tanda 5 (26-11-2026), deudor 32: «Saco mis monedas de la bolsa y las escondo al fondo de la mochila, bajo la ropa fina,
// por si alguien me roba.» El máster lo leyó como robo a la tabernera. Temer un robo no es robar.
describe('temer que le roben no es robar', () => {
  const fear = [
    'Saco mis monedas de la bolsa y las escondo al fondo de la mochila, bajo la ropa fina, por si alguien me roba.',
    'Guardo la plata en la bota, que no me roben esta noche.',
    'Me aparto del jornalero por si me roba la bolsa.',
    'Cuento las monedas con miedo a que me roben.',
  ];
  it('conflictKindOf no lo lee como robo', () => {
    for (const t of fear) expect(conflictKindOf(t), t).toBeNull();
  });
  it('readsAsTheft tampoco', () => {
    for (const t of fear) expect(readsAsTheft(t), t).toBe(false);
  });
  it('robar de verdad sigue siendo robar', () => {
    expect(conflictKindOf('Le robo la bolsa a la tabernera sin que se dé cuenta.')).toBe('steal');
    expect(readsAsTheft('Le robo la bolsa a la tabernera sin que se dé cuenta.')).toBe(true);
    expect(readsAsTheft('Meto la mano en su bolsa y me quedo tres monedas.')).toBe(true);
  });
});
