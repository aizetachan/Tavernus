// Borra un canal por nombre; el bot lo recrea limpio al arrancar. Uso: node --env-file=.env scripts/discord-reset-channel.mjs crear-personaje
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const name = process.argv[2];
if (!name) { console.error('falta el nombre del canal'); process.exit(1); }
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.DISCORD_GUILD_ID);
  const chans = await g.channels.fetch();
  const ch = chans.find((x) => x?.name === name && x.type === ChannelType.GuildText);
  if (ch) { await ch.delete('reset'); console.log('borrado', name); } else console.log('no existe', name);
  await c.destroy();
});
await c.login(process.env.DISCORD_TOKEN);
