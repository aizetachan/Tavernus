import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.DISCORD_GUILD_ID);
  const me = await g.members.fetchMe();
  console.log('rol/permisos globales:', me.permissions.toArray().join(', '));
  console.log('roles:', me.roles.cache.map(r => `${r.name}(pos ${r.position})`).join(', '));
  const chans = await g.channels.fetch();
  for (const ch of chans.values()) {
    if (!ch || ch.type !== ChannelType.GuildText) continue;
    const p = ch.permissionsFor(me);
    console.log(`#${ch.name} id=${ch.id} view=${p.has('ViewChannel')} send=${p.has('SendMessages')} manageMsg=${p.has('ManageMessages')} pin=${p.has('PinMessages') } overwrites=${ch.permissionOverwrites.cache.size}`);
  }
  await c.destroy();
});
await c.login(process.env.DISCORD_TOKEN);
