/**
 * El arranque de un personaje (fase 6 del plan de la reunión del 11-11-2026,
 * docs/PLAN-REUNION-2026-11-11.md): que empiece narrando y no avisando. El
 * prólogo lo escribe el máster (con un segundo intento si el primero no vale;
 * la plantilla solo después, con el motivo apuntado); la primera escena es
 * más larga y nombra a los otros jugadores presentes; los «Hemos oído…» que la
 * historia suelta mientras el personaje se presenta van al Diario, no al hilo.
 */

import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { actionContext } from '../src/ai/prompt.js';
import { Master, type MasterClient } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { checkPrologue, PROLOGUE_WORDS, prologueRetryLine } from '../src/engine/prologue.js';
import { silentInThread } from '../src/adapters/web/server.js';
import { bootEngine, fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Cliente que contesta a `write` (sin tools) con los textos dados, en orden, y al resto como el offline. */
function writer(texts: string[], seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []): MasterClient {
  const off = offlineClient();
  return {
    async create(p) {
      if (p.tools) return off.create(p);
      seen.push(p);
      const text = texts.shift() ?? '';
      return { id: 'msg_w', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 400, output_tokens: 220 } } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => (i % 9 === 8 ? 'palabra.' : 'palabra')).join(' ');

async function brezal(client: MasterClient, seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.5 });
  engine.attachMaster(new Master(engine, { client }));
  const r = await engine.createCharacter('u_pillin', 'Pillin', { class_id: 'fighter' });
  if (!r.ok) throw new Error(r.reason);
  return { engine, time, c: r.character, seen };
}

describe('el prólogo lo escribe el máster', () => {
  it('mide lo que vale y dice por qué no', () => {
    expect(checkPrologue('')).toMatchObject({ text: null, reason: 'empty' });
    expect(checkPrologue(words(20))).toMatchObject({ text: null, reason: 'short', words: 20 });
    expect(checkPrologue(words(PROLOGUE_WORDS.max + 100))).toMatchObject({ text: null, reason: 'long' });
    // Un poco largo (hasta 80 por encima) vale: antes se tiraba a la plantilla.
    expect(checkPrologue(words(PROLOGUE_WORDS.max + 60)).text).not.toBeNull();
    expect(prologueRetryLine('long', 250)).toContain('se pasó de largo (250 palabras)');
  });

  it('si el primero no vale, un segundo intento diciéndole por qué; con el segundo bueno, es del máster', async () => {
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    const { engine, c } = await brezal(writer([words(PROLOGUE_WORDS.max + 150), words(90)], seen), seen);
    await engine.introduce(c.id);
    const p = engine.events.all().find((e) => e.action_type === 'prologue' && e.actor_id === c.id)!;
    expect(p.payload).toMatchObject({ source: 'master', master: { attempts: 2 } });
    expect(seen).toHaveLength(2);
    expect(String(seen[1]!.messages[0]!.content)).toContain('se pasó de largo');
    expect(String(seen[0]!.messages[0]!.content)).not.toContain('se pasó de largo');
  });

  it('si tampoco vale el segundo, la plantilla, con el motivo apuntado', async () => {
    const { engine, c } = await brezal(writer(['', '']));
    await engine.introduce(c.id);
    const p = engine.events.all().find((e) => e.action_type === 'prologue' && e.actor_id === c.id)!;
    expect(p.payload).toMatchObject({ source: 'template', fallback: 'empty', attempts: 2 });
  });
});

describe('la primera escena', () => {
  it('pide dos o tres párrafos de 120 a 180 palabras, quién anda por aquí y los otros jugadores por su nombre', async () => {
    const { engine } = await bootEngine(fakeTime());
    const kael = engine.world.character('ch_kael');
    const mira = engine.world.character('ch_mira');
    mira.location = { type: 'spot', id: kael.location.id };
    const ctx = actionContext(engine, kael, '(primera escena)', undefined, { origin: 'Llega de viaje.', welcome: 'Bienvenido.', prologue: 'Es de noche en la taberna.' });
    expect(ctx).toContain('## Primera escena');
    expect(ctx).toContain('entre 120 y 180 palabras');
    expect(ctx).toContain('OTROS JUGADORES presentes, cada uno por su nombre');
    expect(ctx).not.toContain('50 palabras como máximo');
    // Mira consta como jugadora presente en el contexto.
    expect(ctx).toMatch(/Mira .*JUGADOR/);
  });
});

describe('los rumores de la presentación no van al hilo', () => {
  it('mientras se presenta, los «Hemos oído…» llevan on_join (la web los calla); tras la primera escena, ya no', async () => {
    const { engine, c } = await brezal(offlineClient());
    await engine.tick();
    const during = engine.events.all().filter((e) => e.action_type === 'progress_story' && e.actor_id === c.id && (e.payload['quest'] as { event?: string } | undefined)?.event === 'rumor');
    expect(during.length).toBeGreaterThan(0);
    for (const e of during) { expect(e.tags).toContain('on_join'); expect(silentInThread(e)).toBe(true); }
    await engine.introduce(c.id);
    // Lo que la historia le cuente ahora, al hilo como siempre.
    const before = engine.events.all().length;
    await engine.act(c.id, 'miro alrededor');
    await engine.tick();
    const after = engine.events.all().slice(before).filter((e) => e.actor_id === c.id && /^progress_/.test(e.action_type));
    for (const e of after) expect(e.tags).not.toContain('on_join');
    expect(silentInThread({ tags: ['progress', 'story'] } as never)).toBe(false);
  });
});
