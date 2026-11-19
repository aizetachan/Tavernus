/**
 * Tiradas ocultas y reacciones solo a lo que se nota (fase 3 del plan de la
 * reunión del 11-11-2026, docs/PLAN-REUNION-2026-11-11.md). Como en D&D:
 * Percepción, Perspicacia, Investigación y Sigilo las tira el servidor sin que
 * el jugador vea el dado (ve el chip «🎲 Percepción» y la narración de lo que
 * nota); y robar o espiar a otro jugador no le pregunta si se deja: tirada
 * enfrentada oculta, y solo si lo nota decide él («Lo notas: …»).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Master, type MasterClient } from '../src/ai/master.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { HIDDEN_SKILLS, isHiddenRoll } from '../src/engine/rolls.js';
import { bootEngine, fakeTime } from './helpers.js';

afterEach(() => { vi.restoreAllMocks(); });

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function msg(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content, stop_reason: 'tool_use', stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
const use = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Anthropic.Beta.BetaToolUseBlock => ({ type: 'tool_use', id, name, input });
const logEvent = (priv: string, obs: string | null, extra: Record<string, unknown> = {}) => use('log_event', {
  narration_private: priv, observable: obs, observable_vague: obs ? 'Una figura hace algo.' : null, loudness: 1, tags: 'exploration',
  suggested_actions: 'Mirar la barra | Hablar con Brenna', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null,
  ...extra,
});

function fakeClient(script: Anthropic.Beta.BetaMessage[]) {
  const requests: Params[] = [];
  const client: MasterClient = {
    async create(p) {
      requests.push(structuredClone(p));
      const next = script.shift();
      if (!next) throw new Error('script agotado');
      return next;
    },
  };
  return { client, requests };
}

function collect(engine: Engine) {
  const out = new Map<string, Delivery[]>();
  engine.onDelivery((d) => out.set(d.character_id, [...(out.get(d.character_id) ?? []), d]));
  return (id: string) => out.get(id) ?? [];
}

/** Kael y Mira juntos en la barra. */
async function together(rng?: () => number) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, rng ? { rng } : {});
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  for (const c of [kael, mira]) { c.location = { type: 'spot', id: 'sp_tab_barra' }; engine.setConnected(c.id, true); }
  return { engine, time, kael, mira, seen: collect(engine) };
}

function ctxFor(engine: Engine, actorId: string, text: string): ToolContext {
  const c = engine.world.character(actorId);
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: text } as ToolContext;
}

describe('tiradas ocultas', () => {
  it('Percepción, Perspicacia, Investigación y Sigilo son las ocultas', () => {
    expect([...HIDDEN_SKILLS].sort()).toEqual(['insight', 'investigation', 'perception', 'stealth']);
    expect(isHiddenRoll({ kind: 'skill', key: 'perception' })).toBe(true);
    expect(isHiddenRoll({ kind: 'skill', key: 'athletics' })).toBe(false);
    expect(isHiddenRoll({ kind: 'attack', key: 'melee' })).toBe(false);
  });

  it('el máster pide Percepción: sin botón, el servidor tira al momento, el jugador ve solo «🎲 Percepción» y el máster narra con «TIRADA OCULTA»', async () => {
    const { engine, kael, mira, seen } = await together();
    const { client, requests } = fakeClient([
      msg([logEvent('Recorres la sala con la mirada.', 'Kael mira a su alrededor.', { requires_roll_kind: 'skill', requires_roll_key: 'perception', requires_roll_dc: 12, requires_roll_advantage: 'none' })]),
      msg([logEvent('Nada llama tu atención; la sala sigue a lo suyo.', null)]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(5) }));
    const r = await engine.act(kael.id, 'miro si alguien me vigila');
    expect(r.ok).toBe(true);
    // La acción vuelve ya con la narración del resultado: no hay tirada pendiente ni botón de dado.
    expect(r.text).toBe('Nada llama tu atención; la sala sigue a lo suyo.');
    expect(r.requires_roll).toBeUndefined();
    expect(engine.pendingRoll(kael.id)).toBeNull();
    const asked = engine.events.all().find((e) => e.action_type === 'master' && e.actor_id === kael.id)!;
    expect(asked.payload['requires_roll']).toBeUndefined();
    // El chip: solo la etiqueta, solo para quien tira.
    const chip = engine.events.all().find((e) => e.action_type === 'roll')!;
    expect(chip.narration_private).toBe('🎲 Percepción');
    expect(chip.observable).toBeNull();
    expect(chip.delivered_to.map((d) => d.character_id)).toEqual([kael.id]);
    expect(seen(mira.id).some((d) => /🎲/.test(d.text ?? ''))).toBe(false);
    expect(seen(kael.id).some((d) => d.text === '🎲 Percepción')).toBe(true);
    // El máster recibió el resultado como oculto, con la regla de no delatar el fallo.
    const second = String(requests[1]!.messages[0]!.content);
    expect(second).toContain('## Resultado de la tirada');
    expect(second).toContain('TIRADA OCULTA');
    expect(engine.events.all().find((e) => e.action_type === 'master_roll_outcome')).toBeDefined();
  });

  it('Sigilo oculto con éxito deja al PJ a escondidas (sneak), sin enseñar el dado', async () => {
    const { engine, kael } = await together();
    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    const { client } = fakeClient([
      msg([logEvent('Te pegas a la pared.', null, { requires_roll_kind: 'skill', requires_roll_key: 'stealth', requires_roll_dc: 10, requires_roll_advantage: 'none' })]),
      msg([logEvent('Nadie se fija en ti.', null)]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(5) }));
    const r = await engine.act(kael.id, 'me escondo tras la barra sin que me vean');
    expect(r.ok).toBe(true);
    expect(kael.sneak).not.toBeNull();
    const chip = engine.events.all().find((e) => e.action_type === 'roll')!;
    expect(chip.narration_private).toBe('🎲 Sigilo');
  });

  it('una tirada a la vista (Atletismo) sigue pidiendo el botón', async () => {
    const { engine, kael } = await together();
    const { client } = fakeClient([
      msg([logEvent('Tomas carrerilla.', 'Kael toma carrerilla.', { requires_roll_kind: 'skill', requires_roll_key: 'athletics', requires_roll_dc: 12, requires_roll_advantage: 'none' })]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(5) }));
    const r = await engine.act(kael.id, 'salto la barra');
    expect(r.requires_roll).toEqual({ kind: 'skill', key: 'athletics', dc: 12, advantage: 'none' });
    expect(engine.pendingRoll(kael.id)).not.toBeNull();
  });
});

describe('robar o espiar a otro jugador: tirada enfrentada oculta, sin preguntarle', () => {
  /** d20 de quien actúa y luego el del afectado. */
  const dice = (...values: number[]) => { let i = 0; return () => (i < values.length ? values[i++]! : 0.5); };

  it('si no lo nota: nadie le pregunta, el actor ve su chip y puede quitarle algo en el mismo turno', async () => {
    const { engine, kael, mira, seen } = await together(dice(0.99, 0.01));
    const item = engine.world.itemsCarriedBy(mira.id)[0]!;
    const ctx = ctxFor(engine, kael.id, 'le robo algo del bolsillo a Mira sin que lo note');
    const out = JSON.parse(executeTool(ctx, 'request_reaction', { target_character_id: mira.id, kind: 'other', attempt: 'quitarte algo del bolsillo', destination_spot_id: null, actor_skill: 'sleight_of_hand', target_skills: 'perception' })) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, success: true, unnoticed: true });
    expect(out['pending_reaction']).toBeUndefined();
    expect(mira.reactions ?? []).toHaveLength(0);
    expect(ctx.stealth_won?.has(mira.id)).toBe(true);
    // Lo que ve cada uno: Kael su chip sin número; Mira, nada.
    expect(seen(kael.id).map((d) => d.text)).toContain('🎲 Juego de manos');
    expect(seen(mira.id)).toHaveLength(0);
    // Y se lo lleva ahora, sin el «needs_reaction» de antes.
    const moved = JSON.parse(executeTool(ctx, 'transfer_item', { instance_id: item.id, to_type: 'character', to_id: kael.id, quantity: null, slot: null, equip_slot: null })) as Record<string, unknown>;
    // (si no le cabe, el error es de sitio, no de permiso)
    expect(moved['error']).not.toBe('needs_reaction');
    expect(moved['error'] === undefined || moved['error'] === 'no_space').toBe(true);
  });

  it('si lo nota: no se lleva nada, el actor lo sabe, y Mira recibe la petición con «Lo notas» delante', async () => {
    const { engine, kael, mira, seen } = await together(dice(0.01, 0.99));
    const item = engine.world.itemsCarriedBy(mira.id)[0]!;
    const ctx = ctxFor(engine, kael.id, 'le robo algo del bolsillo a Mira sin que lo note');
    const out = JSON.parse(executeTool(ctx, 'request_reaction', { target_character_id: mira.id, kind: 'other', attempt: 'quitarte algo del bolsillo', destination_spot_id: null, actor_skill: 'sleight_of_hand', target_skills: 'perception' })) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, success: false, noticed: true, pending_reaction: true });
    expect(ctx.stealth_won?.has(mira.id) ?? false).toBe(false);
    const blocked = JSON.parse(executeTool(ctx, 'transfer_item', { instance_id: item.id, to_type: 'character', to_id: kael.id, quantity: null, slot: null, equip_slot: null })) as Record<string, unknown>;
    expect(blocked['error']).toBe('needs_reaction');
    expect(mira.reactions?.[0]).toMatchObject({ from_id: kael.id, kind: 'other', noticed: true });
    // La petición sale tras la narración del máster (announcePending); aquí la forzamos.
    (engine as unknown as { announcePending(id: string): void }).announcePending(kael.id);
    const req = seen(mira.id).find((d) => d.event.action_type === 'reaction_request')!;
    expect(req.text).toMatch(/^Lo notas: Kael intenta quitarte algo del bolsillo\. ¿Te dejas o te resistes\?/);
  });

  it('lo que se nota (agarrar, arrebatar con Atletismo) sigue siendo una reacción normal', async () => {
    const { engine, kael, mira } = await together();
    const ctx = ctxFor(engine, kael.id, 'le arranco la bolsa del cinto a Mira');
    const out = JSON.parse(executeTool(ctx, 'request_reaction', { target_character_id: mira.id, kind: 'other', attempt: 'arrancarte la bolsa del cinto', destination_spot_id: null, actor_skill: 'athletics', target_skills: 'athletics,acrobatics' })) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, pending_reaction: true });
    expect(out['success']).toBeUndefined();
    expect(mira.reactions?.[0]?.noticed).toBeUndefined();
  });
});
