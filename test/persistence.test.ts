import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { JsonFileRepository } from '../src/persistence/jsonfile.js';
import { fakeTime } from './helpers.js';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe('JsonFileRepository', () => {
  it('guarda el mundo, los eventos y los tickers, y reanuda desde ahí', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-'));
    const time = fakeTime();
    const e1 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', seed: makeSeed(), now: time.now });
    await e1.act('ch_kael', 'soltar daga');
    await e1.act('ch_kael', 'ir a la mesa');
    time.advanceGame(120);
    await e1.tick();

    const e2 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now });
    expect(e2.world.itemInstance('ii_kael_daga').location).toEqual({ type: 'spot', id: 'sp_tab_barra' });
    expect(e2.world.characterSpot(e2.world.character('ch_kael'))!.id).toBe('sp_tab_mesa');
    expect(e2.events.lastSeq).toBe(4); // tablón + soltar + mover + llegar
    const next = await e2.act('ch_kael', 'mirar');
    expect(next.event!.seq).toBe(5);
    const ticker = await new JsonFileRepository(dir).loadTicker('demo', 'minute');
    expect(ticker).not.toBeNull();
  });
});
