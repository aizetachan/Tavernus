/**
 * Arreglo 41 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete E): la línea de aproximación del motor («Te acercas al
 * caldero.») solo si llega. Los cinco turnos de las tandas 4 y 5 (data/local/autoplay/20261126-0418/transcripts) con
 * su acción y la narración que vino detrás. Sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { World } from '../src/engine/world.js';
import { approachLine } from '../src/engine/narrate.js';

const w = new World(authoredSeed('brezal', { now: new Date(Date.UTC(2026, 9, 22, 12)) }));

const CASES = [
  {
    turn: 'charlatán T6', spot: 'sp_cu_caldero',
    action: 'Ilse, me dijiste antes que Osric tiene oídos hasta en el pozo. Abre, que quiero saber cuánto más sabes de ese regidor.',
    narration: 'Oyes pasos lentos dentro. Ilse arrastra los pies hasta el otro lado de la puerta y se queda pegada a la madera, sin descorrer la tranca.',
  },
  {
    turn: 'metódico T6', spot: 'sp_cu_caldero',
    action: 'Llamar a la puerta de la Casa de las hierbas',
    narration: 'Recorres el callejón hasta la puerta entornada de la Casa de las hierbas y llamas con los nudillos.',
  },
  {
    turn: 'metódico T28', spot: 'sp_cu_camastro',
    action: 'Seguir hasta la Casa de las hierbas',
    narration: 'Cruzas los veinte pasos del callejón con el olor a hierbas cocidas espesándose.',
  },
  {
    turn: 'impredecible T2', spot: 'sp_pl_pozo',
    action: 'Suelto la muñeca de Ilse de un tirón y me largo hacia la taberna. Mejor cantar que responder: ¡Brenna, dime dónde canta la gente aquí!',
    narration: '«¡Brenna, dime dónde canta la gente aquí!» Cruzas la plaza a la carrera y te paras en el umbral de la Taberna del Jabalí.',
  },
  {
    turn: 'violento T19', spot: 'sp_mo_sacos',
    action: 'Hugo, ¿quién está ahí fuera? Abro la puerta de un empujón y saco el hacha: si es el alguacil, le parto el escudo.',
    narration: 'Cruzas el molino con el hacha en la mano y llegas a la puerta enharinada.',
  },
];

describe('arreglo 41: «Te acercas a…» solo si llega', () => {
  for (const k of CASES) {
    it(`${k.turn}: sin línea (con la narración que vino y sin ella)`, () => {
      expect(approachLine(w, k.spot, k.action, k.narration)).toBeNull();
      expect(approachLine(w, k.spot, k.action)).toBeNull();
    });
  }

  it('cuando la acción va adonde dice la frase, la línea sale', () => {
    expect(approachLine(w, 'sp_cu_caldero', 'Ilse, ¿qué estás cociendo hoy?')).toBe('Te acercas al caldero.');
    expect(approachLine(w, 'sp_pl_pozo', 'coger agua')).toBe('Te acercas al pozo.');
    expect(approachLine(w, 'sp_tab_barra', 'Brenna, ponme una cerveza, que vengo seco')).toBe('Te acercas a la barra.');
    // Nombrar el propio punto no lo estorba.
    expect(approachLine(w, 'sp_cu_caldero', 'Miro qué hay en el caldero')).toBe('Te acercas al caldero.');
  });
});
