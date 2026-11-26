/**
 * La conversación (fase 5 del plan de la reunión del 11-11-2026, docs/PLAN-REUNION-2026-11-11.md), con la decisión
 * «B más comillas»: tres modos en la web (Hacer, Decir y Chat); en Hacer, lo entrecomillado es lo que dice el
 * personaje, tal cual; en Decir, todo el texto es su frase. El narrador no tiene burbuja propia en las charlas (su
 * acotación va dentro de la burbuja del NPC); «hablar con X» empieza por el saludo; y los vecinos de relleno contestan
 * a «mirar a X» con cómo se les ve y cambian de gesto.
 */

import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { actionContext, talkPlanFor } from '../src/ai/prompt.js';
import { Master, type MasterClient } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine } from '../src/engine/engine.js';
import { isExtra } from '../src/engine/extras.js';
import type { DialogueLine } from '../src/engine/moments.js';
import type { Character } from '../src/engine/model.js';
import { asSpeech, isQuoted, missingQuotes, playerInputLines, splitSaidDone } from '../src/engine/speech.js';
import { offersNow, talkScript } from '../src/engine/talk.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { bootEngine, fakeTime } from './helpers.js';

const npc = (text: string, extra: Partial<DialogueLine> = {}): DialogueLine => ({ speaker: 'npc', npc_id: 'npc_brenna', text, ...extra });

describe('lo dicho y lo hecho (speech.ts)', () => {
  it('separa lo entrecomillado de lo demás, con «», "" y “”', () => {
    expect(splitSaidDone('me acerco a Brenna y le digo "¿Has visto a Hugo?"')).toEqual({ said: ['¿Has visto a Hugo?'], done: 'me acerco a Brenna y le digo', speech_only: false });
    expect(splitSaidDone('«Gracias por todo», y me voy a la taberna')).toEqual({ said: ['Gracias por todo'], done: 'y me voy a la taberna', speech_only: false });
    expect(splitSaidDone('“Hola”. Me siento. “¿Qué hay de nuevo?”').said).toEqual(['Hola', '¿Qué hay de nuevo?']);
    // Sin comillas: todo es lo que hace. Solo comillas: solo habla.
    expect(splitSaidDone('pregunto a Brenna si tiene trabajo')).toEqual({ said: [], done: 'pregunto a Brenna si tiene trabajo', speech_only: false });
    expect(splitSaidDone('«hola, Brenna»')).toEqual({ said: ['hola, Brenna'], done: '', speech_only: true });
    // Una « sin cerrar llega hasta el final.
    expect(splitSaidDone('le digo «vete de aquí').said).toEqual(['vete de aquí']);
  });

  it('el modo Decir envuelve el texto en comillas; una raya o unas comillas ya puestas no se doblan', () => {
    expect(asSpeech('hola, Brenna')).toBe('«hola, Brenna»');
    expect(asSpeech('— hola')).toBe('«hola»');
    expect(asSpeech('"hola"')).toBe('"hola"');
    expect(asSpeech('  ')).toBe('');
  });

  it('una frase es lo dicho si es uno de los fragmentos, sin contar mayúsculas, acentos ni puntuación', () => {
    expect(isQuoted('¿Has visto a Hugo?', ['¿Has visto a Hugo?'])).toBe(true);
    expect(isQuoted('has visto a hugo', ['¿Has visto a Hugo?'])).toBe(true);
    expect(isQuoted('Brenna, ¿tienes trabajo?', ['¿Has visto a Hugo?'])).toBe(false);
    expect(missingQuotes(['Hola', '¿Qué hay?'], ['hola.'])).toEqual(['¿Qué hay?']);
  });

  it('al máster: sin comillas, como siempre; con ellas, «Dice» y «Hace»; solo comillas, solo habla', () => {
    expect(playerInputLines('miro alrededor')).toEqual(['«miro alrededor»']);
    const both = playerInputLines('me acerco a Brenna y le digo "¿Has visto a Hugo?"');
    expect(both[1]).toBe('Dice: «¿Has visto a Hugo?»');
    expect(both[2]).toBe('Hace: me acerco a Brenna y le digo');
    expect(both[3]).toContain('palabra por palabra');
    const only = playerInputLines('«hola, Brenna»');
    expect(only[0]).toBe('Dice: «hola, Brenna»');
    expect(only[1]).toContain('No le muevas');
  });
});

describe('los tres modos en el motor', () => {
  async function kael() {
    const time = fakeTime();
    const { engine } = await bootEngine(time, { deterministic: true, rng: () => 0.99 });
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
    return { engine, time, c: engine.world.character('ch_kael') };
  }

  it('Decir: el texto va entre comillas al narrador, y el contexto dice que es su frase literal', async () => {
    const { engine, c } = await kael();
    const before = engine.events.all().length;
    const r = await engine.act(c.id, 'hola, Brenna', { mode: 'say' });
    expect(r.ok).toBe(true);
    const mine = engine.events.all().slice(before).filter((e) => e.actor_id === c.id && e.action_type !== 'say');
    expect(mine.some((e) => e.input_text === '«hola, Brenna»')).toBe(true);
    expect(engine.events.all().slice(before).some((e) => e.action_type === 'say')).toBe(false);
    const ctx = actionContext(engine, c, '«hola, Brenna»');
    expect(ctx).toContain('## Acción del jugador\nDice: «hola, Brenna»');
    expect(ctx).toContain('Es su frase literal');
    expect(await engine.act(c.id, '   ', { mode: 'say' })).toEqual({ ok: false, text: '¿Qué dices?' });
  });

  it('Hacer: unas comillas van al narrador (lo que dice su personaje); la raya, solo en la sala con Brenna, también (arreglo 35)', async () => {
    const { engine, c } = await kael();
    const before = engine.events.all().length;
    await engine.act(c.id, '«hola, Brenna»');
    expect(engine.events.all().slice(before).some((e) => e.action_type === 'say')).toBe(false);
    // Sin otro jugador que la oiga y con un NPC delante, la raya no es chat: se la contesta el NPC (scene.ts, dashForNpc).
    const mid = engine.events.all().length;
    await engine.act(c.id, '— hola a todos');
    expect(engine.events.all().slice(mid).some((e) => e.action_type === 'say')).toBe(false);
    expect(engine.events.all().slice(mid).some((e) => e.actor_id === c.id && e.input_text === '«hola a todos»')).toBe(true);
  });
});

describe('el cierre con comillas: lo dicho es exactamente lo entrecomillado', () => {
  async function talking() {
    const time = fakeTime();
    const { engine } = await bootEngine(time, { deterministic: true, rng: () => 0.99 });
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
    await engine.act('ch_kael', 'Hola, Brenna');
    time.advanceGame(30);
    return { engine, c: engine.world.character('ch_kael') };
  }

  function close(engine: Engine, c: Character, text: string, lines: DialogueLine[], narration: string) {
    const p = talkPlanFor(engine, c, text);
    const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: text, ...(p ? { talk: p } : {}) };
    const res = JSON.parse(executeTool(ctx, 'log_event', {
      narration_private: narration, observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
      requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: 'npc_brenna', lines,
    })) as { ok?: boolean; error?: string };
    return { res, closed: ctx.closed };
  }

  it('una línea del actor que no es lo entrecomillado se quita, y el fragmento que falta se añade delante de la respuesta', async () => {
    const { engine, c } = await talking();
    const text = 'me acerco a la barra y le digo "¿Has visto a Hugo?"';
    const { res, closed } = close(engine, c, text, [{ speaker: 'actor', text: 'Vengo de lejos y busco posada' }, npc('Esta mañana no.')], 'Te acercas a la barra. «Vengo de lejos y busco posada». Brenna niega con la cabeza.');
    expect(res).toEqual({ ok: true, closed: true });
    // Se acerca (algo físico): narración normal, y lo dicho es solo lo entrecomillado.
    expect(closed!.lines).toEqual([{ speaker: 'actor', text: '¿Has visto a Hugo?' }, npc('Esta mañana no.')]);
    expect(closed!.narration_private).not.toContain('Vengo de lejos');
    expect(closed!.narration_private).toContain('«¿Has visto a Hugo?»');
    expect(closed!.narration_private).toBe('«¿Has visto a Hugo?» Te acercas a la barra. Brenna niega con la cabeza. «Esta mañana no.»');
  });

  it('la línea del actor que es lo entrecomillado se queda tal cual; sin comillas, vale lo de siempre (sus palabras)', async () => {
    const { engine, c } = await talking();
    const quoted = close(engine, c, 'le digo "¿Has visto a Hugo?"', [{ speaker: 'actor', text: '¿Has visto a Hugo?' }, npc('No.')], '');
    expect(quoted.closed!.lines).toEqual([{ speaker: 'actor', text: '¿Has visto a Hugo?' }, npc('No.')]);
    const plain = close(engine, c, 'le pregunto si ha visto a Hugo', [{ speaker: 'actor', text: '¿Has visto a Hugo?' }, npc('No.')], '');
    expect(plain.closed!.lines).toEqual([{ speaker: 'actor', text: '¿Has visto a Hugo?' }, npc('No.')]);
  });
});

describe('«hablar con X» empieza por el saludo', () => {
  it('al abrir la charla la situación es el saludo, sin segunda; el guion lo dice y no se da misión aunque el máster la declare', async () => {
    const { engine } = await bootEngine(fakeTime(), { deterministic: true, rng: () => 0.99 });
    const c = engine.world.character('ch_kael');
    const p = talkPlanFor(engine, c, 'ir a hablar con Brenna')!;
    expect(p.intent).toBe('open');
    expect(p.situation).toBe('greeting');
    expect(p.second).toBeNull();
    expect(offersNow(p, 'offer')).toBe(false);
    expect(talkScript(engine.world, c, p)).toContain('ni misión, ni venta, ni encargo ni trato en este turno');
  });

  it('con la charla ya empezada, lo que pide manda', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time, { deterministic: true, rng: () => 0.99 });
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
    await engine.act('ch_kael', 'Hola, Brenna');
    time.advanceGame(30);
    const c = engine.world.character('ch_kael');
    const p = talkPlanFor(engine, c, '¿Me pones una cerveza?')!;
    expect(p.state.new_talk).toBe(false);
    expect(p.situation).not.toBe('greeting');
  });
});

describe('los vecinos de relleno con vida', () => {
  const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
  const H = 3600;

  /** Cliente que contesta a `write` (sin tools) con los textos dados, en orden, y al resto como el offline. */
  function writer(texts: string[], seen: string[] = []): MasterClient {
    const off = offlineClient();
    return {
      async create(p) {
        if (p.tools) return off.create(p);
        seen.push(String(p.messages[0]!.content));
        const text = texts.shift() ?? '';
        return { id: 'msg_w', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 200, output_tokens: 60 } } as unknown as Anthropic.Beta.BetaMessage;
      },
    };
  }

  /** Brezal, día 1 a las 7:00, el PJ junto al horno de la panadera (Marta). */
  async function morning(client?: MasterClient) {
    const time = fakeTime(EPOCH);
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: true, fastTravel: false });
    if (client) engine.attachMaster(new Master(engine, { client }));
    time.advanceGame(24 * H + 7 * H - engine.gameNow());
    await engine.tick();
    const r = await engine.createCharacter('u_pillin', 'Pillin', { class_id: 'rogue' });
    if (!r.ok) throw new Error(r.reason);
    const pc = r.character;
    pc.location = { type: 'spot', id: 'sp_pl_horno' };
    engine.setPresence(pc.id, true);
    const talk = async (text: string) => {
      const from = engine.events.all().at(-1)?.seq ?? 0;
      const res = await engine.act(pc.id, text);
      const ev = engine.events.all().filter((e) => e.seq > from && e.actor_id === pc.id && e.action_type === 'master').at(-1);
      return { text: res.text, ev, line: ((ev?.payload['lines'] as { text: string }[] | undefined) ?? [])[0]?.text ?? null };
    };
    return { engine, pc, talk };
  }

  it('«miro a la panadera»: cómo se le ve y qué hace, del motor, sin frase suya y sin cansarla', async () => {
    const { engine, talk } = await morning();
    const marta = engine.world.npc('npc_x_marta');
    if (!isExtra(marta)) throw new Error('Marta no es de relleno');
    const r = await talk('miro a la panadera');
    expect(r.ev?.tags).toContain('extra');
    expect(r.ev?.tags).not.toContain('extra_offtopic');
    expect(r.line).toBeNull();
    expect(r.ev?.narration_private).toMatch(/^La panadera: /);
    expect(r.ev?.narration_private).toContain(marta.script.look!);
    // Su historia no se ve mirando.
    expect(r.ev?.narration_private).not.toContain(marta.script.story.slice(0, 30));
    expect(r.ev?.observable).toBe('Pillin mira a Marta.');
    // Mirarla no cuenta: sigue contestando como la primera vez.
    const a = await talk('Hola, panadera');
    expect(a.line).toMatch(/Pan gris/);
  });

  it('con máster, la primera mirada le pide cómo se le ve (una vez) y se guarda en el vecino', async () => {
    const seen: string[] = [];
    const look = 'Una mujer de brazos fuertes y delantal blanco de harina, el pelo recogido con un trapo. Saca los panes del horno con una pala larga.';
    const { engine, talk } = await morning(writer([look], seen));
    const first = await talk('miro a la panadera');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('NO la cuentes');
    expect(first.ev?.narration_private).toContain(look);
    const marta = engine.world.npc('npc_x_marta');
    expect(isExtra(marta) && marta.script.look).toBe(look);
    expect(isExtra(marta) && marta.script.look_written).toBe(true);
    await talk('me fijo en la panadera');
    expect(seen).toHaveLength(1);
  });

  it('cada respuesta con un gesto distinto, de los de su carácter', async () => {
    const { talk } = await morning();
    const gestures = new Set<string>();
    for (const t of ['Hola, panadera', 'Panadera, ¿qué sabes del granero quemado?', 'Panadera, ¿cuánto vale el pan?', 'Hola otra vez, panadera']) {
      const r = await talk(t);
      const m = /^La panadera contesta (.+)\.$/.exec(r.text.split(' «')[0]!);
      if (m) gestures.add(m[1]!);
    }
    expect(gestures.size).toBeGreaterThan(1);
    for (const g of gestures) expect(['sin levantar la vista', 'sin dejar lo que hace', 'con un gruñido', 'de mala gana', 'sin mirarte apenas']).toContain(g);
  });
});
