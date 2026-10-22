import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipSynopsis, synopsisOf } from '../src/games/manager.js';

const ev = (action_type: string, narration_private: string | null) => JSON.stringify({ action_type, narration_private });

describe('sinopsis de la partida para el menú', () => {
  it('toma la última narración del máster, no la de un movimiento posterior', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-syn-'));
    const file = join(dir, 'demo.events.jsonl');
    await writeFile(file, [ev('master', 'Primera escena.'), ev('master', 'Te acercas a la barra. Brenna levanta la vista.'), ev('arrived', 'Llegas a la puerta.'), ''].join('\n'));
    expect(await synopsisOf(file)).toBe('Te acercas a la barra. Brenna levanta la vista.');
  });

  it('sin narración del máster usa la última que haya; sin fichero, null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-syn-'));
    const file = join(dir, 'demo.events.jsonl');
    await writeFile(file, [ev('arrived', 'Llegas a la taberna.'), ev('passed', null)].join('\n'));
    expect(await synopsisOf(file)).toBe('Llegas a la taberna.');
    expect(await synopsisOf(join(dir, 'no-existe.jsonl'))).toBeNull();
  });

  it('recorta a frases enteras y, si una sola es larguísima, corta en una palabra', () => {
    const long = 'Una frase corta. ' + 'Otra frase que sigue y sigue '.repeat(12) + 'hasta el final.';
    expect(clipSynopsis(long)).toBe('Una frase corta.');
    const one = 'palabra '.repeat(60).trim();
    const out = clipSynopsis(one);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(262);
  });
});
