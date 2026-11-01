/**
 * Arranque (SPEC §14.3). Un solo proceso: motor + reloj + adaptador.
 *
 *   - Con --web: la web, el producto, en http://localhost:WEB_PORT (3000).
 *     Abre con un menú de partidas (src/games/manager.ts) en GAMES_DIR (./data/games); la
 *     primera vez, la partida de DATA_DIR pasa a ser «principal» con el modo de MASTER_MODE.
 *   - Sin --web: REPL local en la terminal (fase 1 sin cliente).
 *   - Con GOOGLE_CLOUD_PROJECT: persistencia en Firestore; si no, ficheros JSON en DATA_DIR (./data/local).
 *   - MASTER_MODE=live|record|replay|offline: máster real, grabado, reproducido o sin API (src/ai/mode.ts).
 *   - IMAGES=on: ilustración de cada localización al pisarla por primera vez (Pollinations; src/ai/illustrate.ts).
 */

import { Engine } from './engine/engine.js';
import { makeSeed } from './data/seed/demo.js';
import type { Repository } from './persistence/repository.js';
import { JsonFileRepository } from './persistence/jsonfile.js';
import { FirestoreRepository } from './persistence/firestore.js';
import { startRepl } from './adapters/repl.js';
import { startWeb } from './adapters/web/server.js';
import { Master } from './ai/master.js';
import { masterCacheDir, masterModeFromEnv, masterOptionsFor } from './ai/mode.js';
import { GameManager } from './games/manager.js';
import { attachIllustrator, cloudflareFromEnv, imagesEnabled, Illustrator } from './ai/illustrate.js';
import { join } from 'node:path';

async function main(): Promise<void> {
  const env = process.env;
  if (process.argv.includes('--web')) {
    // La web lleva sus propias partidas (JSON por carpeta); el REPL sigue con un motor único.
    const games = new GameManager({ root: env['GAMES_DIR'] ?? './data/games', env });
    await games.init();
    console.log(`[boot] partidas en ${games.root}`);
    await startWeb(games, Number(env['WEB_PORT'] ?? 3000));
    // Ya cerrada y guardada: salir aunque quede algún temporizador vivo (si no, node --watch y systemd esperan).
    process.exit(0);
  }

  const repo: Repository = env['GOOGLE_CLOUD_PROJECT']
    ? new FirestoreRepository(env['GOOGLE_CLOUD_PROJECT'])
    : new JsonFileRepository(env['DATA_DIR'] ?? './data/local');
  console.log(`[boot] persistencia: ${env['GOOGLE_CLOUD_PROJECT'] ? 'firestore' : 'json'}`);

  const engine = await Engine.boot({ repo, campaignId: env['CAMPAIGN_ID'] ?? 'demo', seed: makeSeed() });
  console.log(`[boot] ${engine.world.campaign.name} — ${engine.clock.format(engine.gameNow())} — ${engine.world.characters.size} PJs, ${engine.events.lastSeq} eventos`);
  const mode = masterModeFromEnv(env);
  if (Master.configured(mode)) {
    engine.attachMaster(new Master(engine, masterOptionsFor(mode, env)));
    const m = engine.world.campaign.master;
    console.log(`[boot] master: modo ${mode}${mode === 'offline' ? ' (sin API)' : ` — ${m.model} (esfuerzo ${m.effort})`}${mode === 'record' || mode === 'replay' ? `, caché en ${masterCacheDir(env)}` : ''}`);
  } else {
    console.log(`[boot] master: sin ANTHROPIC_API_KEY (modo ${mode}), narración plana`);
  }

  if (imagesEnabled(env, mode)) {
    const ill = attachIllustrator(engine, new Illustrator({
      dir: join(env['DATA_DIR'] ?? './data/local', 'images'), worldSeed: engine.world.campaign.id, apiKey: env['POLLINATIONS_API_KEY'] ?? null,
      cloudflare: cloudflareFromEnv(env),
    }));
    const polli = `Pollinations ${ill.keyed ? 'con clave' : 'anónimo (con logo, 1 cada 45 s)'}`;
    console.log(`[boot] ilustraciones: ${ill.provider === 'cloudflare' ? `Cloudflare Workers AI (reserva: ${polli})` : polli}`);
  }

  await startRepl(engine);
}

main().catch((e) => { console.error(e); process.exit(1); });
