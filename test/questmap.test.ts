/**
 * El mapa de misiones de la wiki (src/wiki/questmap.ts) sale de los datos de la historia: este test falla si la
 * imagen o la tabla de `wiki/Misiones/Mapa de misiones.md` no están al día (se arregla con `npm run wiki:misiones`).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brezalQuestMap, MAP_PAGE, MAP_SVG, questGraph, TABLE_SECTION } from '../src/wiki/questmap.js';
import { replaceSection } from '../src/wiki/carries.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import type { Story } from '../src/engine/story.js';

const norm = (s: string) => s.replace(/\r\n/g, '\n');

describe('mapa de misiones de la wiki', () => {
  it('la imagen y la tabla están al día con los datos (si no: npm run wiki:misiones)', () => {
    const { svg, table } = brezalQuestMap();
    expect(norm(readFileSync(MAP_SVG, 'utf8'))).toBe(norm(svg));
    const page = norm(readFileSync(MAP_PAGE, 'utf8'));
    expect(page).toBe(norm(replaceSection(page, TABLE_SECTION, table)));
  });

  it('las flechas salen de los requisitos: hace falta (todas) o basta una (alguna)', () => {
    const snap = authoredSeed('brezal');
    const g = questGraph((snap.campaign as typeof snap.campaign & { story: Story }).story, snap);
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: 'q_perro', to: 'q_sotano', kind: 'all' },
      { from: 'q_cadena', to: 'q_final_templar', kind: 'all' },
      { from: 'q_noche', to: 'q_tobias', kind: 'any' },
    ]));
    const perro = g.nodes.find((n) => n.id === 'q_perro')!;
    expect(perro).toMatchObject({ giver: 'Brenna', min_level: 1, level: 2, phases: 2, secondary: 1, outcomes: 5, depth: 0 });
    expect(g.nodes.find((n) => n.id === 'q_final_templar')!.depth).toBe(3);
  });
});
