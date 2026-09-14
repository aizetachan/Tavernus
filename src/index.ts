/**
 * Arranque (SPEC §14.3). Un solo proceso: motor + reloj + adaptador.
 *
 *   - Con DISCORD_TOKEN y DISCORD_GUILD_ID: bot de Discord.
 *   - Sin ellos: REPL local en la terminal (fase 1 sin cliente).
 *   - Con GOOGLE_CLOUD_PROJECT: persistencia en Firestore; si no, ficheros JSON en DATA_DIR (./data/local).
 */

import { Engine } from './engine/engine.js';
import { makeSeed } from './data/seed/demo.js';
import type { Repository } from './persistence/repository.js';
import { JsonFileRepository } from './persistence/jsonfile.js';
import { FirestoreRepository } from './persistence/firestore.js';
import { DiscordAdapter } from './adapters/discord/bot.js';
import { startRepl } from './adapters/repl.js';
import { Master } from './ai/master.js';

async function main(): Promise<void> {
  const env = process.env;
  const repo: Repository = env['GOOGLE_CLOUD_PROJECT']
    ? new FirestoreRepository(env['GOOGLE_CLOUD_PROJECT'])
    : new JsonFileRepository(env['DATA_DIR'] ?? './data/local');
  console.log(`[boot] persistencia: ${env['GOOGLE_CLOUD_PROJECT'] ? 'firestore' : 'json'}`);

  const engine = await Engine.boot({ repo, campaignId: env['CAMPAIGN_ID'] ?? 'demo', seed: makeSeed() });
  console.log(`[boot] ${engine.world.campaign.name} — ${engine.clock.format(engine.gameNow())} — ${engine.world.characters.size} PJs, ${engine.events.lastSeq} eventos`);
  if (Master.configured()) {
    engine.attachMaster(new Master(engine));
    console.log(`[boot] master: ${engine.world.campaign.master.model} (esfuerzo ${engine.world.campaign.master.effort})`);
  } else {
    console.log('[boot] master: sin ANTHROPIC_API_KEY, narración plana');
  }

  if (env['DISCORD_TOKEN'] && env['DISCORD_GUILD_ID']) {
    const bot = new DiscordAdapter(engine, {
      token: env['DISCORD_TOKEN'], guildId: env['DISCORD_GUILD_ID'],
      ...(env['DISCORD_ADMIN_ID'] ? { adminUserId: env['DISCORD_ADMIN_ID'] } : {}),
    });
    const stop = async () => { await bot.stop(); process.exit(0); };
    process.on('SIGINT', () => { void stop(); });
    process.on('SIGTERM', () => { void stop(); });
    await bot.start();
  } else {
    await startRepl(engine);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
