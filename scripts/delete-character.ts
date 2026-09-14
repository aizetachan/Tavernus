/** Uso: node --env-file=.env --import tsx scripts/delete-character.ts "Nombre" — borra el PJ del mundo y sus canales de Discord. */
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { Engine } from '../src/engine/engine.js';
import { JsonFileRepository } from '../src/persistence/jsonfile.js';
import { slug } from '../src/adapters/discord/bot.js';
import { makeSeed } from '../src/data/seed/demo.js';

const name = process.argv[2];
if (!name) { console.error('falta el nombre'); process.exit(1); }
const engine = await Engine.boot({ repo: new JsonFileRepository(process.env["DATA_DIR"] ?? "./data/local"), campaignId: process.env["CAMPAIGN_ID"] ?? "demo", seed: makeSeed() });
const c = [...engine.world.characters.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
if (!c) { console.error('no existe', name); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async () => {
  const g = await client.guilds.fetch(process.env['DISCORD_GUILD_ID']!);
  const chans = await g.channels.fetch();
  for (const prefix of ['pov', 'hoja']) {
    const ch = chans.find((x) => x?.name === `${prefix}-${slug(c.name)}` && x.type === ChannelType.GuildText);
    if (ch) { await ch.delete(); console.log('borrado canal', ch.name); }
  }
  await engine.deleteCharacter(c.id);
  console.log('borrado personaje', c.name);
  await client.destroy();
});
await client.login(process.env['DISCORD_TOKEN']);
