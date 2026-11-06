/**
 * Arranque (SPEC §14.3). Un solo proceso: motor + reloj + adaptador.
 *
 *   - Con --web: la web, el producto, en http://localhost:WEB_PORT (3000).
 *     Abre con un menú de partidas (src/games/manager.ts) en GAMES_DIR (./data/games); la
 *     primera vez, la partida de DATA_DIR pasa a ser «principal» con el modo de MASTER_MODE.
 *   - Sin --web: REPL local en la terminal (fase 1 sin cliente).
 *   - Con GOOGLE_CLOUD_PROJECT: persistencia en Firestore; con WORLD_STORE=pg, en PostgreSQL (DATABASE_URL);
 *     si no, ficheros JSON en DATA_DIR (./data/local). En la web, WORLD_STORE vale para todas las partidas.
 *   - MASTER_MODE=live|record|replay|offline: máster real, grabado, reproducido o sin API (src/ai/mode.ts).
 *   - IMAGES=on: ilustración de cada localización al pisarla por primera vez (Pollinations; src/ai/illustrate.ts).
 */

import { Engine } from './engine/engine.js';
import { makeSeed } from './data/seed/demo.js';
import type { Repository } from './persistence/repository.js';
import { JsonFileRepository } from './persistence/jsonfile.js';
import { FirestoreRepository } from './persistence/firestore.js';
import { PgRepository } from './persistence/pg.js';
import { PgWorldStore, worldStoreFromEnv } from './games/worlds.js';
import { dbUrlFromEnv, openDb } from './db/db.js';
import { startRepl } from './adapters/repl.js';
import { startWeb } from './adapters/web/server.js';
import { Master } from './ai/master.js';
import { masterCacheDir, masterModeFromEnv, masterOptionsFor } from './ai/mode.js';
import { GameManager } from './games/manager.js';
import { attachIllustrator, cloudflareFromEnv, imagesEnabled, Illustrator } from './ai/illustrate.js';
import { join } from 'node:path';

async function main(): Promise<void> {
  const env = process.env;
  if (process.argv.includes('--admin')) {
    // Primer administrador (o uno más) sin navegador: src/accounts/cli.ts.
    const { adminCommand } = await import('./accounts/cli.js');
    process.exit(await adminCommand(process.argv, env));
  }
  if (process.argv.includes('--world-store')) {
    // Pasar mundos de partida entre ficheros JSON y la base (WORLD_STORE=pg): src/games/world-cli.ts.
    const { worldStoreCommand } = await import('./games/world-cli.js');
    process.exit(await worldStoreCommand(process.argv, env));
  }
  if (process.argv.includes('--web')) {
    // La web lleva sus propias partidas (catálogo en la base, mundo de cada una en su carpeta); el REPL sigue con un motor único.
    const games = new GameManager({ root: env['GAMES_DIR'] ?? './data/games', env });
    await games.init();
    console.log(`[boot] partidas en ${games.root}`);
    await startWeb(games, Number(env['WEB_PORT'] ?? 3000));
    // Ya cerrada y guardada: salir aunque quede algún temporizador vivo (si no, node --watch y systemd esperan).
    process.exit(0);
  }

  const dataDir = env['DATA_DIR'] ?? './data/local';
  const campaignId = env['CAMPAIGN_ID'] ?? 'demo';
  // WORLD_STORE=pg: el mundo en PostgreSQL (DATABASE_URL, o PGlite en DATA_DIR/.pgdata), con la clave de la campaña.
  const store = worldStoreFromEnv(env);
  const db = store === 'pg' ? await openDb(dbUrlFromEnv(env, dataDir, 'open')!) : null;
  if (db) {
    const ref = { key: campaignId, dir: dataDir, campaignId };
    await new PgWorldStore(db).prepare(ref);
  }
  const repo: Repository = env['GOOGLE_CLOUD_PROJECT']
    ? new FirestoreRepository(env['GOOGLE_CLOUD_PROJECT'])
    : db ? new PgRepository(db, campaignId) : new JsonFileRepository(dataDir);
  console.log(`[boot] persistencia: ${env['GOOGLE_CLOUD_PROJECT'] ? 'firestore' : db ? `postgresql (${db.kind})` : 'json'}`);

  const engine = await Engine.boot({ repo, campaignId, seed: makeSeed() });
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
