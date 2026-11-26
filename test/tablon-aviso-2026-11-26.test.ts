/**
 * Arreglo 42 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete E): el tablón no se vuelca a mitad de escena. Antes, a las
 * 00:00 salía como narración pública «📜 Tablón de Brezal, Martes 2 de Brotes, año 1, 00:00:» con la lista entera en
 * viñetas (pausado T12, impredecible T6 y T23, deudor T33 en data/local/autoplay/20261126-*). Ahora es un aviso corto;
 * la lista, al leerlo, sin «•» ni «—»; y los encargos del día no cambian entre dos lecturas. Sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { activeJobs, rotateBoard } from '../src/engine/progress.js';
import { GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  const r = await engine.createCharacter('u_mira', 'Mira', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  return { engine, time, mira: r.character };
}

describe('arreglo 42: el tablón como aviso, la lista al leerlo', () => {
  it('al cambiar el día: una línea corta, sin hora, sin lista y sin viñetas', async () => {
    const { engine, time } = await boot();
    const from = engine.events.all().at(-1)?.seq ?? 0;
    const now = engine.gameNow();
    time.advanceGame((Math.floor(now / GAME_DAY) + 1) * GAME_DAY - now + 60);
    await engine.tick();
    const boards = engine.events.all().filter((e) => e.seq > from && e.action_type === 'board');
    expect(boards).toHaveLength(1);
    const b = boards[0]!;
    expect(b.observable).toBe('Hay avisos nuevos en el tablón de Plaza del Pozo.');
    expect(b.observable).not.toMatch(/[•·—]|\d\d:\d\d|\*\*/);
    expect(b.location_id).toBe('loc_plaza');
    expect((b.payload['job_ids'] as string[])).toEqual(activeJobs(engine.world).map((j) => j.id));
  });

  it('/tablon da la lista: un encargo por línea, sin «•» ni «—»', async () => {
    const { engine, mira } = await boot();
    const text = await engine.command(mira.id, '/tablon');
    const jobs = activeJobs(engine.world);
    expect(text.split('\n')).toHaveLength(jobs.length);
    for (const j of jobs) expect(text).toContain(`**${j.title}**: `);
    expect(text).not.toMatch(/[•·—]/);
    expect(text).toMatch(/Paga \d+ de (plata|cobre)[^;]*; lo pide [^.]+\./);
  });

  it('los encargos no cambian entre dos lecturas del mismo día; al día siguiente, sí', async () => {
    const { engine, time, mira } = await boot();
    const day = Math.floor(engine.gameNow() / GAME_DAY);
    const first = await engine.command(mira.id, '/tablon');
    // Más tarde, el mismo día (y aunque algo fuerce la rotación de ese día: sale lo mismo).
    const toLate = day * GAME_DAY + 23 * GAME_HOUR - engine.gameNow();
    if (toLate > 0) time.advanceGame(toLate);
    await engine.tick();
    expect(await engine.command(mira.id, '/tablon')).toBe(first);
    expect(rotateBoard(engine.world, engine.gameNow())).toBeNull();
    rotateBoard(engine.world, engine.gameNow(), true);
    expect(await engine.command(mira.id, '/tablon')).toBe(first);
    // Pasada la medianoche, rota.
    time.advanceGame(2 * GAME_HOUR);
    await engine.tick();
    expect(await engine.command(mira.id, '/tablon')).not.toBe(first);
  });
});
