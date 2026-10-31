import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { waitUntil } from './helpers.js';

/**
 * Arranque de un PJ nuevo: se anuncia donde de verdad empieza (su situación
 * inicial) y su hilo empieza en el prólogo, sin la llegada genérica ni los NPC
 * colocándose en su horario delante.
 */
const noApi: MasterFactory = (engine) => new Master(engine, { client: offlineClient() });

let dir: string;
let games: GameManager;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tavernus-opening-'));
  games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
});
afterEach(async () => {
  await games.closeAll();
  await rm(dir, { recursive: true, force: true });
});

describe('arranque de un personaje nuevo', () => {
  it('se anuncia en el punto de su situación inicial, no en el de inicio genérico', async () => {
    // En Brezal, un guerrero empieza en la herrería (hijo del herrero de Vharn).
    const { game, character_id } = await games.create({ name: 'Forja', mode: 'offline', character: { name: 'Aren', class_id: 'fighter', race_id: 'human' } });
    const engine = await games.open(game.slug);
    const c = engine.world.character(character_id!);
    expect(c.situation?.start_spot_id).toBe('sp_he_banco');
    expect(c.location).toEqual({ type: 'spot', id: 'sp_he_banco' });
    const joined = engine.events.all().find((e) => e.action_type === 'character_joined' && e.actor_id === c.id)!;
    expect(joined.spot_id).toBe('sp_he_banco');
    expect(engine.world.location('loc_taberna').discovery[c.id]).not.toBe('visited');
    expect(engine.world.location('loc_herreria').discovery[c.id]).toBe('visited');
  });

  describe('en la web', () => {
    let web: WebServer;
    let base: string;
    beforeEach(async () => {
      web = createWebServer(games, { tickMs: 3_600_000 });
      await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
    });
    afterEach(async () => { await web.stop(); });

    /** Primer bloque del stream: el historial que recibe la página al conectar. */
    async function history(slug: string, character: string): Promise<{ chapter?: { kind: string }; scene?: unknown; seq: number }[]> {
      const ctrl = new AbortController();
      const r = await fetch(`${base}/api/stream?game=${slug}&character=${character}`, { signal: ctrl.signal });
      const reader = r.body!.getReader();
      let text = '';
      while (!/event: history\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
      ctrl.abort();
      return JSON.parse(/event: history\ndata: (.*)\n\n/.exec(text)![1]!);
    }

    it('el hilo empieza en el prólogo, también tras reabrir la partida', async () => {
      const r = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Forja web', mode: 'offline', character: 'Aren', race: 'human', class: 'fighter' }) });
      const { game, character_id } = (await r.json()) as { game: { slug: string }; character_id: string };
      const engine = await games.open(game.slug);
      // Espera a que el motor termine la presentación (prólogo y primera escena).
      await waitUntil(() => expect(engine.events.all().some((e) => e.action_type === 'master_intro' && e.actor_id === character_id)).toBe(true));
      const prologue = engine.events.all().find((e) => e.action_type === 'prologue' && e.actor_id === character_id)!;
      expect(prologue).toBeDefined();
      // Antes del prólogo el motor ya ha emitido cosas que el PJ percibe (su llegada y los NPC colocándose).
      expect(engine.events.forCharacter(character_id, null).some((d) => d.event.seq < prologue.seq)).toBe(true);

      const live = await history(game.slug, character_id);
      expect(live[0]?.chapter?.kind).toBe('prologue');
      expect(live.every((m) => m.seq >= prologue.seq)).toBe(true);

      // Tras un reinicio, el historial se reconstruye del log con la misma regla.
      await games.close(game.slug);
      const again = await history(game.slug, character_id);
      expect(again[0]?.chapter?.kind).toBe('prologue');
    });
  });
});
