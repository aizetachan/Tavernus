/**
 * Adaptador de Discord (SPEC §11.2). Solo traduce: canal por jugador
 * (#pov-<nombre>), hoja viva (#hoja-<nombre>), #tablon para lo público,
 * #crear-personaje, #ooc, #reportes con ⚠️. Ninguna regla de juego vive aquí.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, ModalBuilder, Partials, PermissionFlagsBits,
  REST, Routes, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type ModalSubmitInteraction, type Message, type TextChannel, type PartialMessage, type MessageReaction, type PartialMessageReaction, type User, type PartialUser,
} from 'discord.js';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import type { Engine } from '../../engine/engine.js';
import type { GameEvent, Id } from '../../engine/model.js';
import { renderSheet } from './sheet.js';
import { WELCOME, POV_COMMANDS, joinDm } from './texts.js';
import { CreationWizard } from './creation.js';
import { illustratorOf, type SceneImage } from '../../ai/illustrate.js';
import type { CharacterSpec } from '../../engine/engine.js';

export interface DiscordOptions {
  token: string;
  guildId: string;
  /** Usuario admin: único con acceso a #reportes. */
  adminUserId?: string;
  /** Intervalo del tick del reloj, en ms reales. SPEC §1.3: cada minuto. */
  tickMs?: number;
}

const REPORT_EMOJI = '⚠️';
/** Voces (decisión de Santy, sesión 3): sistema en gris oscuro, master en azul. */
const COLOR_SYSTEM = 0x36393f;
const COLOR_MASTER = 0x3b82f6;
const MASTER_TYPES = new Set(['master', 'master_roll_outcome', 'master_intro', 'master_arrival']);
const SYSTEM_TITLES: Record<string, string> = { roll: '🎲 Tirada', arrived: 'Viaje', passed: 'Viaje', character_joined: 'Llegada', admin_fix: 'Admin', board: 'Tablón' };
const COMMANDS = [
  ['look', 'Mira a tu alrededor'], ['where', 'Dónde estás'], ['who', 'Quién ves'], ['inventory', 'Tu inventario'],
  ['recap', 'Lo que te has perdido'], ['time', 'Hora del mundo'], ['sheet', 'Tu hoja'],
  ['tablon', 'Encargos del tablón'], ['progress', 'Tu reputación, pistas y práctica'],
] as const;
const ADMIN_DELETE = 'admin-borrar';
const ADMIN_STATUS = 'estado';
const HEARTBEAT_FILE = 'logs/heartbeat.json';
const LAST_EXIT_FILE = 'logs/last-exit.txt';

export function slug(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export class DiscordAdapter {
  private client: Client;
  private guild!: Guild;
  private povChannels = new Map<Id, TextChannel>();
  private sheetChannels = new Map<Id, TextChannel>();
  private sheetMessages = new Map<Id, string>();
  private sheetTimers = new Map<Id, NodeJS.Timeout>();
  /** message id → event, para los reportes ⚠️. */
  private messageEvents = new Map<string, GameEvent>();
  /** Último mensaje con botones por PJ: se le quitan cuando llega uno nuevo. */
  private lastButtons = new Map<Id, Message>();
  private reportThreads = new Map<string, string>();
  /** Ilustraciones que llegaron antes de existir el #pov (PJ recién creado). */
  private pendingScenes = new Map<Id, SceneImage>();
  private tablon: TextChannel | null = null;
  private reportes: TextChannel | null = null;
  private timer: NodeJS.Timeout | null = null;
  private wizard = new CreationWizard((userId, name, spec, i) => this.finishCreation(userId, name, spec, i));

  constructor(private readonly engine: Engine, private readonly opts: DiscordOptions) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
  }

  async start(): Promise<void> {
    const { client, engine } = this;
    client.once(Events.ClientReady, async () => {
      this.guild = await client.guilds.fetch(this.opts.guildId);
      await this.guild.members.fetch();
      await this.ensureCommonChannels();
      for (const c of engine.world.characters.values()) await this.ensurePlayerChannels(c.id);
      await this.registerCommands();
      this.syncPresences();
      this.timer = setInterval(() => { void engine.tick(); void this.writeHeartbeat(); }, this.opts.tickMs ?? 60_000);
      console.log(`[discord] listo como ${client.user?.tag} en ${this.guild.name}`);
      await this.announceBoot().catch((e) => console.error('[discord] aviso de arranque:', e));
      await this.writeHeartbeat();
    });

    client.on(Events.MessageCreate, (m) => { void this.onMessage(m).catch((e) => console.error('[discord] mensaje:', e)); });
    client.on(Events.InteractionCreate, async (i) => {
      try {
        if ((i.isButton() || i.isStringSelectMenu()) && this.wizard.handles(i.customId)) { await this.wizard.handle(i); return; }
        if (i.isButton()) { await this.onButton(i); return; }
        if (i.isModalSubmit()) { await this.onModal(i); return; }
        if (!i.isChatInputCommand()) return;
        if (i.commandName === ADMIN_DELETE) { await this.onAdminDelete(i); return; }
        if (i.commandName === ADMIN_STATUS) { await this.onStatus(i); return; }
        const c = engine.characterByUser(i.user.id);
        if (!c) { await i.reply({ content: 'Aún no tienes personaje. Escribe tu nombre en #crear-personaje.', flags: MessageFlags.Ephemeral }); return; }
        if (i.commandName === 'sheet') { await i.reply({ embeds: [renderSheet(engine, c.id)], flags: MessageFlags.Ephemeral }); return; }
        const text = await engine.command(c.id, i.commandName);
        await i.reply({ embeds: [this.systemEmbed(text)], flags: MessageFlags.Ephemeral });
      } catch (e) {
        console.error('[discord] interacción:', e);
      }
    });
    process.on('unhandledRejection', (e) => console.error('[discord] rechazo no capturado:', e));
    // Cortes de red (Mac dormido, wifi): discord.js reconecta solo si el error no tumba el proceso.
    client.on(Events.Error, (e) => console.error('[discord] error de cliente:', e.message));
    client.on(Events.ShardError, (e) => console.error('[discord] error de conexión:', e.message));
    client.on(Events.ShardDisconnect, () => console.warn('[discord] desconectado; reintentando…'));
    client.on(Events.ShardResume, () => console.log('[discord] reconectado'));
    client.on(Events.PresenceUpdate, (_old, p) => {
      const c = p.userId ? engine.characterByUser(p.userId) : null;
      if (c) engine.setPresence(c.id, p.status === 'online' || p.status === 'idle' || p.status === 'dnd');
    });
    client.on(Events.GuildMemberAdd, (member) => {
      void (async () => {
        if (member.user.bot || member.guild.id !== this.opts.guildId) return;
        const create = this.guild.channels.cache.find((c) => c.name === 'crear-personaje');
        const text = joinDm(this.guild.name, create ? `<#${create.id}>` : '#crear-personaje');
        try {
          await member.send(text);
        } catch {
          // Privados cerrados: aviso breve en #crear-personaje que se borra solo.
          if (create?.type === ChannelType.GuildText) {
            const m = await (create as TextChannel).send({ content: `<@${member.id}>`, embeds: [this.systemEmbed(text)], allowedMentions: { users: [member.id] } }).catch(() => null);
            if (m) setTimeout(() => { void m.delete().catch(() => undefined); }, 10 * 60 * 1000);
          }
        }
      })().catch((e) => console.error('[discord] bienvenida:', e));
    });
    client.on(Events.MessageReactionAdd, (r, u) => { void this.onReaction(r, u).catch((e) => console.error('[discord] reacción:', e)); });

    engine.onDelivery((d) => {
      const ch = this.povChannels.get(d.character_id);
      if (!ch) return;
      const components = d.event.actor_id === d.character_id ? this.actionButtons(d.event) : [];
      // Master: texto normal (se lee mejor en el móvil, decisión de Santy). Sistema: recuadro gris.
      const isMaster = MASTER_TYPES.has(d.event.action_type);
      const embeds = isMaster ? [] : [this.systemEmbed(d.text, SYSTEM_TITLES[d.event.action_type] ?? 'Sistema')];
      const stale = this.lastButtons.get(d.character_id);
      if (stale && MASTER_TYPES.has(d.event.action_type)) { this.lastButtons.delete(d.character_id); void stale.edit({ components: [] }).catch(() => undefined); }
      // Sin menciones (decisión de Santy): cada jugador pone su #pov en "Todos los mensajes".
      const decisive = d.event.payload['decisive'] as { window_s: number } | undefined;
      const content = isMaster ? `${d.text.slice(0, 1900)}${decisive && d.event.actor_id === d.character_id ? `\n-# ⏳ Tienes ${decisive.window_s} segundos para reaccionar. Si no, la amenaza se cumple.` : ''}` : '';
      void ch.send({ content, embeds, components }).then((msg) => {
        this.messageEvents.set(msg.id, d.event);
        if (components.length) this.lastButtons.set(d.character_id, msg);
      });
    });
    illustratorOf(engine)?.onIllustrated((r) => {
      if (this.povChannels.has(r.character_id)) void this.sendScene(r.character_id, r.image);
      else this.pendingScenes.set(r.character_id, r.image);
    });
    // Retrato del NPC en el primer encuentro (momento del motor); solo ese, no en cada conversación.
    illustratorOf(engine)?.onEntity((r) => {
      if (r.image.kind === 'portrait' && r.moment_key && r.character_id && this.povChannels.has(r.character_id)) void this.sendPortrait(r.character_id, r.image);
    });
    engine.events.onEvent((e) => {
      if (e.visibility === 'public' && this.tablon) void this.tablon.send(e.observable ?? e.narration_private);
    });
    engine.world.onChange((ch) => {
      if (ch.collection === 'characters') this.scheduleSheet(ch.id);
      else if (ch.collection === 'item_instances') for (const id of this.sheetChannels.keys()) this.scheduleSheet(id);
    });

    await client.login(this.opts.token);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.engine.flush();
    await this.client.destroy();
  }

  // --- Canales ---------------------------------------------------------------

  private async findOrCreate(name: string, opts: { privateTo?: string[]; readOnly?: boolean; welcome?: string; welcomeAsSystem?: boolean; components?: ActionRowBuilder<ButtonBuilder>[] } = {}): Promise<TextChannel> {
    const me = this.client.user!.id;
    const existing = this.guild.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildText) as TextChannel | undefined;
    if (existing) {
      if (opts.readOnly) await existing.permissionOverwrites.edit(this.guild.roles.everyone, { SendMessages: false }).catch(() => undefined);
      if (opts.welcome) await this.ensureWelcome(existing, opts.welcome, opts.components, opts.welcomeAsSystem);
      return existing;
    }
    let permissionOverwrites: { id: string; allow?: bigint[]; deny?: bigint[] }[] | undefined;
    if (opts.privateTo) {
      permissionOverwrites = [
        { id: this.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
        ...opts.privateTo.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] })),
      ];
    } else if (opts.readOnly) {
      permissionOverwrites = [
        { id: this.guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] },
        { id: me, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
      ];
    }
    const ch = await this.guild.channels.create({ name, type: ChannelType.GuildText, ...(permissionOverwrites ? { permissionOverwrites } : {}) });
    if (opts.welcome) await this.ensureWelcome(ch, opts.welcome, opts.components, opts.welcomeAsSystem);
    return ch;
  }

  /** Primer mensaje del canal explicando cómo funciona. Se fija si el bot tiene permiso; si no, queda como primer mensaje. */
  private async ensureWelcome(ch: TextChannel, text: string, components: ActionRowBuilder<ButtonBuilder>[] = [], asSystem = false): Promise<void> {
    const recent = await ch.messages.fetch({ limit: 20 });
    const head = text.slice(0, 40);
    const mine = recent.find((m) => m.author.id === this.client.user!.id && (m.content.startsWith(head) || m.embeds[0]?.description?.startsWith(head)));
    if (mine) {
      if (!asSystem && (mine.content !== text || (components.length > 0 && mine.components.length === 0))) await mine.edit({ content: text, components }).catch(() => undefined);
      return;
    }
    const msg = asSystem
      ? await ch.send({ embeds: [this.systemEmbed(text)] })
      : await ch.send({ content: text, components });
    await msg.pin().catch(() => undefined);
  }

  private async ensureCommonChannels(): Promise<void> {
    this.tablon = await this.findOrCreate('tablon', { welcome: WELCOME['tablon']! });
    await this.findOrCreate('ooc', { welcome: WELCOME['ooc']! });
    const createRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('create:open').setLabel('Crear personaje').setStyle(ButtonStyle.Success).setEmoji('🎲'),
    );
    await this.findOrCreate('crear-personaje', { readOnly: true, welcome: WELCOME['crear-personaje']!, components: [createRow] });
    this.reportes = await this.findOrCreate('reportes', { privateTo: this.opts.adminUserId ? [this.opts.adminUserId] : [], welcome: WELCOME['reportes']! });
  }

  private async ensurePlayerChannels(characterId: Id): Promise<void> {
    const c = this.engine.world.character(characterId);
    const member = this.guild.members.cache.get(c.user_id);
    if (!member) { console.warn(`[discord] ${c.name}: usuario ${c.user_id} no está en el servidor`); return; }
    // Apodo de servidor = nombre del personaje, para que las menciones se lean con su nombre (no funciona con el dueño del servidor).
    if (member.displayName !== c.name) await member.setNickname(c.name, 'nombre del personaje').catch(() => undefined);
    const pov = await this.findOrCreate(`pov-${slug(c.name)}`, { privateTo: [c.user_id], welcome: POV_COMMANDS, welcomeAsSystem: true });
    const sheet = await this.findOrCreate(`hoja-${slug(c.name)}`, { privateTo: [c.user_id] });
    this.povChannels.set(c.id, pov);
    this.sheetChannels.set(c.id, sheet);
    // La hoja es el último mensaje del bot en #hoja; fijarla es opcional (requiere el permiso "Fijar mensajes").
    const recent = await sheet.messages.fetch({ limit: 10 });
    const mine = recent.find((m) => m.author.id === this.client.user!.id && m.embeds.length > 0);
    if (mine) this.sheetMessages.set(c.id, mine.id);
    else {
      const msg = await sheet.send({ embeds: [renderSheet(this.engine, c.id)] });
      await msg.pin().catch(() => undefined);
      this.sheetMessages.set(c.id, msg.id);
    }
  }

  private async deletePlayerChannels(characterId: Id, name: string): Promise<void> {
    for (const prefix of ['pov', 'hoja']) {
      const ch = this.guild.channels.cache.find((c) => c.name === `${prefix}-${slug(name)}` && c.type === ChannelType.GuildText);
      if (ch) await ch.delete('personaje borrado por el admin').catch((e) => console.warn('[discord] no pude borrar', ch.name, (e as Error).message));
    }
    this.povChannels.delete(characterId);
    this.sheetChannels.delete(characterId);
    this.sheetMessages.delete(characterId);
  }

  private scheduleSheet(characterId: Id): void {
    if (!this.sheetChannels.has(characterId)) return;
    const prev = this.sheetTimers.get(characterId);
    if (prev) clearTimeout(prev);
    this.sheetTimers.set(characterId, setTimeout(() => {
      this.sheetTimers.delete(characterId);
      void this.updateSheet(characterId);
    }, 1000));
  }

  private async updateSheet(characterId: Id): Promise<void> {
    const ch = this.sheetChannels.get(characterId);
    const id = this.sheetMessages.get(characterId);
    if (!ch || !id) return;
    try {
      const msg = await ch.messages.fetch(id);
      await msg.edit({ embeds: [renderSheet(this.engine, characterId)] });
    } catch (e) {
      console.warn(`[discord] no pude actualizar la hoja de ${characterId}:`, (e as Error).message);
    }
  }

  private syncPresences(): void {
    for (const c of this.engine.world.characters.values()) {
      const m = this.guild.members.cache.get(c.user_id);
      const s = m?.presence?.status;
      this.engine.setPresence(c.id, s === 'online' || s === 'idle' || s === 'dnd');
    }
  }

  private async registerCommands(): Promise<void> {
    const rest = new REST().setToken(this.opts.token);
    const body = COMMANDS.map(([name, desc]) => new SlashCommandBuilder().setName(name).setDescription(desc).toJSON());
    body.push(new SlashCommandBuilder().setName(ADMIN_STATUS).setDescription('Admin: estado del bot, del narrador y de la conexión').toJSON());
    body.push(new SlashCommandBuilder().setName(ADMIN_DELETE).setDescription('Admin: borra un personaje y sus canales')
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre del personaje').setRequired(true)).toJSON());
    await rest.put(Routes.applicationGuildCommands(this.client.user!.id, this.opts.guildId), { body });
  }

  // --- Mensajes --------------------------------------------------------------

  private async onMessage(m: Message): Promise<void> {
    if (m.author.bot || !m.guild || m.guild.id !== this.opts.guildId) return;
    const channel = m.channel as TextChannel;

    if (channel.name === 'crear-personaje') return; // solo lectura: se crea con el botón

    // Reply a un mensaje ya reportado → comentario del reporte.
    if (m.reference?.messageId && this.reportThreads.has(m.reference.messageId)) {
      await this.appendReport(m.reference.messageId, `${m.author.username}: ${m.content}`);
      await m.react('📝');
      return;
    }

    const c = this.engine.characterByUser(m.author.id);
    if (!c) return;
    if (channel.id !== this.povChannels.get(c.id)?.id) return;

    if (m.content.startsWith('/')) {
      await m.reply({ embeds: [this.systemEmbed(await this.engine.command(c.id, m.content.split(/\s+/)[0]!))] });
      return;
    }
    const r = await this.withTyping(channel, () => this.engine.act(c.id, m.content));
    if (!r.ok) await m.reply({ embeds: [this.systemEmbed(`✗ ${r.text}`)] });
    else if (!r.event) await m.reply({ embeds: [this.systemEmbed(r.text)] }); // respuestas sin evento (consultas)
    // Con evento, la narración llega por la entrega (onDelivery), con sus botones.
  }

  // --- Botones y admin ---------------------------------------------------------

  /** Solo color, sin etiqueta (decisión de Santy): azul = narrador, gris = sistema. */
  /** Mantiene el "escribiendo…" de Discord (dura ~10 s por aviso) mientras dura el trabajo. */
  private async withTyping<T>(ch: TextChannel | undefined, fn: () => Promise<T>): Promise<T> {
    if (!ch) return fn();
    const ping = () => { void ch.sendTyping().catch(() => undefined); };
    ping();
    const timer = setInterval(ping, 8000);
    try { return await fn(); } finally { clearInterval(timer); }
  }

  /** Ilustración de la escena (IMAGES=on): recuadro de sistema con el JPEG descargado como adjunto. */
  private async sendScene(characterId: Id, image: SceneImage): Promise<void> {
    const ch = this.povChannels.get(characterId);
    if (!ch) return;
    const ill = illustratorOf(this.engine);
    if (!ill) return;
    const embed = new EmbedBuilder().setColor(COLOR_SYSTEM).setTitle(image.name).setImage(`attachment://${image.file}`);
    await ch.send({ embeds: [embed], files: [{ attachment: ill.pathOf(image), name: image.file }] })
      .catch((e) => console.error('[discord] ilustración:', e));
  }

  /** Retrato del primer encuentro: recuadro pequeño con el nombre y el JPEG como miniatura. */
  private async sendPortrait(characterId: Id, image: SceneImage): Promise<void> {
    const ch = this.povChannels.get(characterId);
    const ill = illustratorOf(this.engine);
    if (!ch || !ill) return;
    const embed = new EmbedBuilder().setColor(COLOR_SYSTEM).setTitle(image.name).setThumbnail(`attachment://${image.file}`);
    await ch.send({ embeds: [embed], files: [{ attachment: ill.pathOf(image), name: image.file }] })
      .catch((e) => console.error('[discord] retrato:', e));
  }

  private masterEmbed(text: string): EmbedBuilder {
    return new EmbedBuilder().setColor(COLOR_MASTER).setDescription(text.slice(0, 4000));
  }

  private systemEmbed(text: string, _title = 'Sistema'): EmbedBuilder {
    return new EmbedBuilder().setColor(COLOR_SYSTEM).setDescription(text.slice(0, 4000));
  }

  /** Botones bajo la narración: 🎲 si hay tirada pendiente, y acciones sugeridas (SPEC §4.10). */
  private actionButtons(e: GameEvent): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const buttons: ButtonBuilder[] = [];
    if (e.payload['requires_roll']) {
      // Con tirada pendiente solo se ofrece el dado: la acción ya está decidida (decisión de Santy).
      buttons.push(new ButtonBuilder().setCustomId(`roll:${e.actor_id}`).setLabel('Tirar').setEmoji('🎲').setStyle(ButtonStyle.Primary));
      return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
    }
    const suggested = Array.isArray(e.payload['suggested_actions']) ? (e.payload['suggested_actions'] as string[]) : [];
    for (const a of suggested.slice(0, 4)) {
      const label = a.slice(0, 80);
      buttons.push(new ButtonBuilder().setCustomId(`act:${label}`.slice(0, 100)).setLabel(label).setStyle(ButtonStyle.Secondary));
    }
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
    return rows;
  }

  private async onButton(i: ButtonInteraction): Promise<void> {
    if (i.customId.startsWith('roll:') || i.customId.startsWith('act:')) {
      const c = this.engine.characterByUser(i.user.id);
      if (!c) { await i.reply({ content: 'No tienes personaje.', flags: MessageFlags.Ephemeral }); return; }
      await i.update({ components: [] }); // los botones se gastan al pulsarlos
      const ch = this.povChannels.get(c.id);
      if (i.customId.startsWith('roll:')) {
        const r = await this.withTyping(ch, () => this.engine.rollPending(c.id));
        if (!r.ok && ch) await ch.send({ embeds: [this.systemEmbed(`✗ ${r.text}`)] });
      } else {
        const textAction = i.customId.slice(4);
        if (ch) await ch.send(`> ${textAction}`);
        const r = await this.withTyping(ch, () => this.engine.act(c.id, textAction));
        if (!r.ok && ch) await ch.send({ embeds: [this.systemEmbed(`✗ ${r.text}`)] });
      }
      return;
    }
    if (i.customId !== 'create:open') return;
    const existing = this.engine.characterByUser(i.user.id);
    if (existing) {
      const pov = this.povChannels.get(existing.id);
      await i.reply({ content: `Ya tienes personaje: **${existing.name}**. Tu canal es ${pov ? `<#${pov.id}>` : '#pov-' + slug(existing.name)}.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder().setCustomId('create:modal').setTitle('Crear personaje').addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Nombre del personaje').setStyle(TextInputStyle.Short)
          .setMinLength(2).setMaxLength(24).setPlaceholder('Kael, Mira, Ánxela do Mar…').setRequired(true),
      ),
    );
    await i.showModal(modal);
  }

  private async onModal(i: ModalSubmitInteraction): Promise<void> {
    if (i.customId !== 'create:modal') return;
    const name = i.fields.getTextInputValue('name').trim();
    if (this.engine.characterByUser(i.user.id)) { await i.reply({ content: 'Ya tienes personaje.', flags: MessageFlags.Ephemeral }); return; }
    await this.wizard.start(i, name);
  }

  private async finishCreation(userId: string, name: string, spec: CharacterSpec, i: ButtonInteraction): Promise<void> {
    await i.update({ content: 'Un momento…', components: [] });
    const r = await this.engine.createCharacter(userId, name, spec);
    if (!r.ok) { await i.editReply({ content: r.reason, components: [] }); return; }
    await this.ensurePlayerChannels(r.character.id);
    this.engine.setPresence(r.character.id, true);
    const pov = this.povChannels.get(r.character.id);
    const povRef = pov ? `<#${pov.id}>` : '#pov-' + slug(r.character.name);
    const camp = this.engine.world.campaign;
    const welcome = (camp.welcome || `Bienvenido a ${camp.name}, {name}.`).replaceAll('{name}', r.character.name);
    await i.editReply({ content: '', embeds: [this.masterEmbed(`${welcome}\n\nSigue en ${povRef}.`)], components: [] });
    // El efímero se borra solo pasados unos minutos: el jugador ya está en su #pov y el canal queda limpio.
    setTimeout(() => { void i.deleteReply().catch(() => undefined); }, 5 * 60 * 1000);
    if (pov) {
      const intro = await this.withTyping(pov, () => this.engine.introduce(r.character.id)); // el master narra la llegada; llega por onDelivery
      if (!intro) await pov.send({ embeds: [this.systemEmbed(await this.engine.command(r.character.id, '/look'), 'Llegada')] });
      const scene = this.pendingScenes.get(r.character.id);
      if (scene) { this.pendingScenes.delete(r.character.id); await this.sendScene(r.character.id, scene); }
    }
  }

  // --- Salud y seguimiento ---------------------------------------------------

  /** Latido cada minuto: si el proceso muere, el siguiente arranque sabe cuánto estuvo fuera. */
  private async writeHeartbeat(): Promise<void> {
    await writeFile(HEARTBEAT_FILE, JSON.stringify({ ts: Date.now(), events: this.engine.events.lastSeq })).catch(() => undefined);
  }

  /** Aviso en #reportes al arrancar: limpio, o tras una caída con motivo y tiempo fuera. */
  private async announceBoot(): Promise<void> {
    if (!this.reportes) return;
    const hb = await readFile(HEARTBEAT_FILE, 'utf8').then((t) => JSON.parse(t) as { ts: number }).catch(() => null);
    const exit = await readFile(LAST_EXIT_FILE, 'utf8').catch(() => null);
    const down = hb ? Math.round((Date.now() - hb.ts) / 60000) : null;
    let text: string;
    if (exit) {
      const code = exit.match(/code=(\d+)/)?.[1] ?? '?';
      const reason = exit.split('\n').find((l) => /Error|error/.test(l))?.trim().slice(0, 300) ?? 'sin detalle en el log';
      text = code === '0'
        ? `🔄 Reinicio limpio. En marcha de nuevo${down !== null ? ` tras ${down} min` : ''}.`
        : `⚠️ **El bot se cayó** (código ${code}) y el vigilante lo ha relanzado.${down !== null ? ` Estuvo fuera unos ${down} min.` : ''}\nMotivo: \`${reason}\``;
      await unlink(LAST_EXIT_FILE).catch(() => undefined);
    } else {
      text = down !== null && down > 5
        ? `⚠️ En marcha, pero el último latido fue hace ${down} min: el bot estuvo parado sin que el vigilante lo registrara (Mac apagado o proceso detenido a mano).`
        : '✅ Bot en marcha.';
    }
    await this.reportes.send({ embeds: [this.systemEmbed(text)] });
  }

  private async onStatus(i: ChatInputCommandInteraction): Promise<void> {
    if (i.user.id !== this.opts.adminUserId) { await i.reply({ content: 'Solo el admin puede ver el estado.', flags: MessageFlags.Ephemeral }); return; }
    const h = this.engine.health();
    const mins = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
    const chars = [...this.engine.world.characters.values()].filter((c) => c.user_id.match(/^\d+$/));
    const online = chars.filter((c) => c.connected).length;
    const lines = [
      `**En marcha** desde hace ${mins(Date.now() - h.started_ms)}.`,
      `**Discord**: latencia ${this.client.ws.ping} ms.`,
      `**Narrador** (${this.engine.world.campaign.master.model}, esfuerzo ${this.engine.world.campaign.master.effort}): ${h.ok_1h} respuestas en la última hora${h.avg_ms_1h !== null ? `, media ${(h.avg_ms_1h / 1000).toFixed(1)} s` : ''}; ${h.err_1h} errores.`,
      h.last_error ? `Último error: hace ${mins(Date.now() - h.last_error.ts)} · ${h.last_error.reason} · \`${h.last_error.message.slice(0, 150)}\`` : 'Sin errores del narrador desde el arranque.',
      `**Jugadores**: ${chars.length} personajes, ${online} conectados.`,
      `**Mundo**: ${this.engine.clock.format(this.engine.gameNow())} · ${this.engine.events.lastSeq} eventos.`,
    ];
    await i.reply({ embeds: [this.systemEmbed(lines.join('\n'))], flags: MessageFlags.Ephemeral });
  }

  private async onAdminDelete(i: ChatInputCommandInteraction): Promise<void> {
    const userId = i.user.id;
    const name = i.options.getString('nombre', true);
    if (userId !== this.opts.adminUserId) { await i.reply({ content: 'Solo el admin puede hacer eso.', flags: MessageFlags.Ephemeral }); return; }
    const c = [...this.engine.world.characters.values()].find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!c) { await i.reply({ content: `No hay ningún personaje llamado «${name}».`, flags: MessageFlags.Ephemeral }); return; }
    await this.deletePlayerChannels(c.id, c.name);
    await this.engine.deleteCharacter(c.id);
    await i.reply({ content: `Borrado **${c.name}** y sus canales. Su jugador puede volver a empezar en #crear-personaje.`, flags: MessageFlags.Ephemeral });
  }

  // --- Reportes ⚠️ (SPEC §11.2) ----------------------------------------------

  private async onReaction(r: MessageReaction | PartialMessageReaction, u: User | PartialUser): Promise<void> {
    if (u.bot || r.emoji.name !== REPORT_EMOJI) return;
    const msg = r.message.partial ? await r.message.fetch() : r.message;
    if (msg.author?.id !== this.client.user!.id) return;
    if (this.reportThreads.has(msg.id)) return;
    const event = this.messageEvents.get(msg.id);
    const reporter = this.engine.characterByUser(u.id);
    await this.openReport(msg, event ?? null, reporter?.name ?? u.username ?? u.id);
  }

  private async openReport(msg: Message | PartialMessage, event: GameEvent | null, reporter: string): Promise<void> {
    if (!this.reportes) return;
    const embed = new EmbedBuilder()
      .setTitle(`Reporte de ${reporter}`)
      .setDescription((msg.content ?? '').slice(0, 1000) || '(sin texto)')
      .addFields(
        { name: 'Mensaje', value: msg.url },
        ...(event ? [
          { name: 'Evento', value: `${event.id} · ${event.action_type} · ${event.location_id}/${event.spot_id ?? '—'}`, inline: false },
          { name: 'Entrada', value: (event.input_text ?? '—').slice(0, 200), inline: true },
          { name: 'Actor', value: event.actor_id ?? '—', inline: true },
          { name: 'Entregado a', value: event.delivered_to.map((d) => `${d.character_id} (${d.level})`).join(', ') || '—', inline: false },
        ] : []),
      )
      .setTimestamp(new Date());
    const head = await this.reportes.send({ embeds: [embed] });
    const thread = await head.startThread({ name: `${reporter} · ${event?.action_type ?? 'sin evento'} · ${new Date().toISOString().slice(5, 16)}` });
    this.reportThreads.set(msg.id, thread.id);
    await msg.react('👀').catch(() => undefined);
  }

  private async appendReport(messageId: string, text: string): Promise<void> {
    const threadId = this.reportThreads.get(messageId);
    if (!threadId) return;
    const thread = await this.guild.channels.fetch(threadId);
    if (thread?.isThread()) await thread.send(text.slice(0, 1990));
  }
}
