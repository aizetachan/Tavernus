/**
 * Asistente de creación de personaje por botones y menús (SPEC §4.6, §4.8,
 * §11.2.1). Todo efímero: solo lo ve el jugador. El servidor valida al final.
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder,
  type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction,
} from 'discord.js';
import type { CharacterSpec } from '../../engine/engine.js';
import { ABILITY_ES, SKILLS, type Ability } from '../../engine/rules.js';
import { ABILITIES, BACKGROUNDS, CLASSES, RACES, STANDARD_ARRAY, backgroundById, classById, raceById } from '../../data/srd/index.js';

interface Draft {
  name: string;
  race_id?: string;
  class_id?: string;
  background_id?: string;
  abilities?: Partial<Record<Ability, number>>;
  skills?: string[];
  death_mode?: 'casual' | 'hardcore';
}

type Reply = { content: string; components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] };
type AnyInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

export class CreationWizard {
  private drafts = new Map<string, Draft>();

  constructor(private readonly onConfirm: (userId: string, name: string, spec: CharacterSpec, i: ButtonInteraction) => Promise<void>) {}

  /** Tras el modal del nombre. */
  async start(i: ModalSubmitInteraction, name: string): Promise<void> {
    this.drafts.set(i.user.id, { name });
    await i.reply({ ...this.raceStep(), flags: MessageFlags.Ephemeral });
  }

  handles(customId: string): boolean { return customId.startsWith('cc:'); }

  async handle(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    const d = this.drafts.get(i.user.id);
    if (!d) { await i.reply({ content: 'Se perdió el borrador. Vuelve a pulsar «Crear personaje».', flags: MessageFlags.Ephemeral }); return; }
    const id = i.customId;
    const value = i.isStringSelectMenu() ? i.values[0]! : '';

    if (id === 'cc:race') { d.race_id = value; await i.update(this.classStep()); return; }
    if (id === 'cc:class') { d.class_id = value; await i.update(this.backgroundStep()); return; }
    if (id === 'cc:bg') { d.background_id = value; await i.update(this.abilitiesStep(d)); return; }
    if (id === 'cc:abil:rec') {
      const k = classById(d.class_id!)!;
      d.abilities = Object.fromEntries(ABILITIES.map((a, n) => [a, k.recommended[n]]));
      await i.update(this.skillsStep(d)); return;
    }
    if (id === 'cc:abil:custom') { d.abilities = {}; await i.update(this.abilityPick(d)); return; }
    if (id.startsWith('cc:abil:pick:')) {
      const ab = id.slice('cc:abil:pick:'.length) as Ability;
      d.abilities = { ...d.abilities, [ab]: Number(value) };
      const next = ABILITIES.find((a) => d.abilities![a] === undefined);
      await i.update(next ? this.abilityPick(d) : this.skillsStep(d)); return;
    }
    if (id === 'cc:skills') { d.skills = i.isStringSelectMenu() ? [...i.values] : []; await i.update(this.deathStep()); return; }
    if (id === 'cc:death:casual' || id === 'cc:death:hardcore') { d.death_mode = id.endsWith('hardcore') ? 'hardcore' : 'casual'; await i.update(this.summaryStep(d)); return; }
    if (id === 'cc:cancel') { this.drafts.delete(i.user.id); await i.update({ content: 'Borrador descartado. Pulsa «Crear personaje» cuando quieras empezar de nuevo.', components: [] }); return; }
    if (id === 'cc:restart') { this.drafts.set(i.user.id, { name: d.name }); await i.update(this.raceStep()); return; }
    if (id === 'cc:confirm' && i.isButton()) {
      const spec: CharacterSpec = {
        race_id: d.race_id!, class_id: d.class_id!, background_id: d.background_id!,
        abilities: d.abilities as Record<Ability, number>, skills: d.skills ?? [], death_mode: d.death_mode ?? 'casual',
      };
      this.drafts.delete(i.user.id);
      await this.onConfirm(i.user.id, d.name, spec, i);
      return;
    }
  }

  // --- pasos ---------------------------------------------------------------

  private select(customId: string, placeholder: string, options: { value: string; label: string; description?: string }[], min = 1, max = 1): ActionRowBuilder<StringSelectMenuBuilder> {
    const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(min).setMaxValues(max)
      .addOptions(options.slice(0, 25).map((o) => ({ value: o.value, label: o.label.slice(0, 100), ...(o.description ? { description: o.description.slice(0, 100) } : {}) })));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  private raceStep(): Reply {
    return { content: '**1/6 · Raza.** Lo que eres desde que naciste.', components: [this.select('cc:race', 'Elige raza', RACES.map((r) => ({ value: r.id, label: r.name, description: r.description })))] };
  }

  private classStep(): Reply {
    return { content: '**2/6 · Clase.** Lo que sabes hacer.', components: [this.select('cc:class', 'Elige clase', CLASSES.map((c) => ({ value: c.id, label: c.name, description: c.description })))] };
  }

  private backgroundStep(): Reply {
    return { content: '**3/6 · Trasfondo.** Lo que hacías antes de esto.', components: [this.select('cc:bg', 'Elige trasfondo', BACKGROUNDS.map((b) => ({ value: b.id, label: b.name, description: b.description })))] };
  }

  private abilitiesStep(d: Draft): Reply {
    const k = classById(d.class_id!)!;
    const rec = ABILITIES.map((a, n) => `${ABILITY_ES[a].slice(0, 3).toUpperCase()} ${k.recommended[n]}`).join(' · ');
    return {
      content: `**4/6 · Características.** Se reparten los valores 15, 14, 13, 12, 10 y 8 (los bonus de raza se suman después).\nRecomendado para ${k.name}: ${rec}`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('cc:abil:rec').setLabel('Usar el recomendado').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cc:abil:custom').setLabel('Repartirlos yo').setStyle(ButtonStyle.Secondary),
      )],
    };
  }

  private abilityPick(d: Draft): Reply {
    const used = Object.values(d.abilities ?? {}) as number[];
    const remaining = [...STANDARD_ARRAY].filter((v) => { const n = used.filter((u) => u === v).length; return n < STANDARD_ARRAY.filter((x) => x === v).length; });
    const ab = ABILITIES.find((a) => d.abilities![a] === undefined)!;
    const done = ABILITIES.filter((a) => d.abilities![a] !== undefined).map((a) => `${ABILITY_ES[a]} ${d.abilities![a]}`).join(', ');
    return {
      content: `**4/6 · Características.** ${done ? `Hasta ahora: ${done}.\n` : ''}Valor para **${ABILITY_ES[ab]}**:`,
      components: [this.select(`cc:abil:pick:${ab}`, `${ABILITY_ES[ab]}`, remaining.map((v) => ({ value: String(v), label: String(v) })))],
    };
  }

  private skillsStep(d: Draft): Reply {
    const k = classById(d.class_id!)!;
    const fixed = new Set([...(backgroundById(d.background_id!)?.skills ?? []), ...(raceById(d.race_id!)?.skills ?? [])]);
    const options = k.skill_choices.from.filter((s) => !fixed.has(s)).map((s) => ({ value: s, label: SKILLS[s]!.es }));
    const n = Math.min(k.skill_choices.count, options.length);
    return {
      content: `**5/6 · Habilidades.** Ya tienes ${[...fixed].map((s) => SKILLS[s]?.es ?? s).join(' y ') || 'ninguna fija'}. Elige **${n}** más de ${k.name}:`,
      components: [this.select('cc:skills', `Elige ${n}`, options, n, n)],
    };
  }

  private deathStep(): Reply {
    return {
      content: '**6/6 · Si mueres.** Nunca es para siempre, pero hay dos maneras.\n**Casual:** vuelves a las 2 horas reales con todo lo que llevabas.\n**Hardcore:** vuelves a la media hora, pero lo que llevabas queda donde caíste y pierdes algo de fuerza hasta subir de nivel.',
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('cc:death:casual').setLabel('Casual').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cc:death:hardcore').setLabel('Hardcore').setStyle(ButtonStyle.Danger),
      )],
    };
  }

  private summaryStep(d: Draft): Reply {
    const r = raceById(d.race_id!)!; const k = classById(d.class_id!)!; const b = backgroundById(d.background_id!)!;
    const ab = ABILITIES.map((a) => `${ABILITY_ES[a].slice(0, 3).toUpperCase()} ${(d.abilities![a] ?? 0) + (r.ability_bonus[a] ?? 0)}`).join(' · ');
    const skills = [...new Set([...b.skills, ...r.skills, ...(d.skills ?? [])])].map((s) => SKILLS[s]?.es ?? s).join(', ');
    return {
      content: `**${d.name}**, ${r.name.toLowerCase()} ${k.name.toLowerCase()}, ${b.name.toLowerCase()}.\n${ab}\nHabilidades: ${skills}.\nMuerte: ${d.death_mode}.`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('cc:confirm').setLabel('Entrar en el mundo').setStyle(ButtonStyle.Success).setEmoji('🎲'),
        new ButtonBuilder().setCustomId('cc:restart').setLabel('Empezar de nuevo').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cc:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
      )],
    };
  }
}
