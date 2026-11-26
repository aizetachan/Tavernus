/**
 * Arreglo 43 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete E): el epílogo de Brezal dice «Amanece el sexto día» una sola
 * vez (antes salía en la escena del Lindero y en el aviso público, seguidos: pausado, líneas 414 y 416 del transcript
 * de data/local/autoplay/20261126-0418) y el alba llega antes que el resumen de lo jugado. Sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { claimSituation } from '../src/worldgen/index.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: false, fastTravel: false });
  const r = await engine.createCharacter('u_fen', 'Fen', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  r.character.connected = true;
  return { engine, time, c: r.character };
}

describe('arreglo 43: epílogo veraz', () => {
  it('«Amanece el sexto día» una sola vez, también para quien está en el Lindero, y antes que el resumen', async () => {
    const { engine, time, c } = await boot();
    c.location = { type: 'spot', id: 'sp_li_niebla' };
    const from = engine.events.all().at(-1)?.seq ?? 0;
    time.advanceGame(109 * 3600);
    await engine.tick();
    const evs = engine.events.all().filter((e) => e.seq > from);
    const text = (e: (typeof evs)[number]) => `${e.narration_private ?? ''}\n${e.observable ?? ''}`;
    const dawn = evs.filter((e) => /Amanece el sexto día/.test(text(e)));
    expect(dawn).toHaveLength(1);
    expect(text(dawn[0]!).match(/Amanece el sexto día/g)).toHaveLength(1);
    expect(evs.some((e) => e.observable === 'La niebla del Lindero está donde estaba, quieta, sin olor.')).toBe(true);
    const recap = evs.find((e) => e.actor_id === c.id && /queda abierta/.test(e.narration_private));
    expect(recap).toBeDefined();
    expect(dawn[0]!.seq).toBeLessThan(recap!.seq);
  });
});
