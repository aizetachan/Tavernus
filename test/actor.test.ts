/**
 * Director y actor en los turnos de conversación (src/ai/actor.ts, docs/CONVERSACION.md):
 * el máster decide los hechos y cierra; el actor reescribe lo que dice el NPC con su voz,
 * sin ver el secreto, y sus líneas pasan por el control del cierre.
 */
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Master, type MasterClient } from '../src/ai/master.js';
import { actorConfigFromEnv, actorProblems, applyActorLines, DEFAULT_ACTOR_MODEL, parseActorReply, secretLeaks } from '../src/ai/actor.js';
import { actionContext, systemPrompt } from '../src/ai/prompt.js';
import { masterOptionsFor } from '../src/ai/mode.js';
import { npcConcerns, talkTier } from '../src/engine/concerns.js';
import { transcriptOf } from '../src/engine/conversation.js';
import type { GameEvent } from '../src/engine/model.js';
import { seededRng } from '../src/engine/dice.js';
import { bootEngine } from './helpers.js';

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function msg(content: Anthropic.Beta.BetaContentBlock[], model = 'claude-haiku-5-5', stop: Anthropic.Beta.BetaStopReason = 'tool_use'): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
const use = (name: string, input: Record<string, unknown>): Anthropic.Beta.BetaToolUseBlock => ({ type: 'tool_use', id: `tu_${name}`, name, input });
const text = (t: string): Anthropic.Beta.BetaTextBlock => ({ type: 'text', text: t, citations: null } as Anthropic.Beta.BetaTextBlock);
const say = (...lines: string[]) => msg([text(JSON.stringify({ lines }))], 'claude-sonnet-5-5', 'end_turn');

/** Cierre del director: Kael pregunta a Brenna y ella contesta lo justo. */
const close = (npcLines: string[], extra: Record<string, unknown> = {}) => use('log_event', {
  narration_private: `Brenna deja la jarra: ${npcLines.map((l) => `«${l}»`).join(' ')}`, observable: `Kael habla con Brenna. ${npcLines.map((l) => `«${l}»`).join(' ')}`, observable_vague: null,
  loudness: 1, tags: 'social', suggested_actions: 'Pedir una cerveza', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null,
  npc_id: 'npc_brenna', lines: [{ speaker: 'actor', npc_id: null, text: '¿Qué tal el día?' }, ...npcLines.map((t) => ({ speaker: 'npc', npc_id: 'npc_brenna', text: t }))],
  ...extra,
});

/** Cliente falso con dos guiones: el del director (con tools) y el del actor (con formato JSON). */
function fakeClient(director: Anthropic.Beta.BetaMessage[], actor: Anthropic.Beta.BetaMessage[]) {
  const requests: { kind: 'director' | 'actor'; p: Params }[] = [];
  const client: MasterClient = {
    async create(p) {
      const kind = p.output_config?.format ? 'actor' : 'director';
      requests.push({ kind, p: structuredClone(p) });
      const next = (kind === 'actor' ? actor : director).shift();
      if (!next) throw new Error(`guion del ${kind} agotado`);
      return next;
    },
  };
  return { client, requests, actorCalls: () => requests.filter((r) => r.kind === 'actor') };
}

const ACTOR = { model: 'claude-sonnet-5-5', effort: 'low' as const };

describe('actor de los NPC', () => {
  it('el director decide, el actor pone las palabras: cambian lines, la narración y lo observable', async () => {
    const { engine } = await bootEngine();
    const { client, actorCalls } = fakeClient(
      [msg([close(['Igual que ayer.'])])],
      [say('Igual que ayer, chico: ceniza en las jarras y nadie que pague a tiempo.', '¿Y tú qué? No tienes cara de quedarte mucho.')],
    );
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: ACTOR }));
    const r = await engine.act('ch_kael', 'Le pregunto a Brenna qué tal el día');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('ceniza en las jarras');
    expect(r.text).toContain('¿Y tú qué?');
    expect(r.text).not.toContain('«Igual que ayer.»');
    const ev = engine.events.all().filter((e) => e.actor_id === 'ch_kael').at(-1)!;
    const lines = ev.payload['lines'] as { speaker: string; text: string }[];
    expect(lines.map((l) => l.speaker)).toEqual(['actor', 'npc', 'npc']);
    expect(ev.observable).toContain('¿Y tú qué?');
    // Gasto del actor aparte, en el evento.
    const actor = (ev.payload['master'] as { actor?: { model: string; kept_draft: boolean; calls: number } }).actor!;
    expect(actor).toMatchObject({ model: 'claude-sonnet-5-5', kept_draft: false, calls: 1 });
    // La petición del actor: modelo, esfuerzo, JSON, system cacheado y el borrador del director.
    const p = actorCalls()[0]!.p;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(p.tools).toBeUndefined();
    expect((p.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    const ctx = p.messages[0]!.content as string;
    expect(ctx).toContain('«Igual que ayer.»');
    expect(ctx).toContain('Tu personaje: Brenna, tabernera');
    expect(ctx).toContain('Le ronda hoy');
  });

  it('el secreto del NPC no llega al actor', async () => {
    const { engine } = await bootEngine();
    const { client, actorCalls } = fakeClient([msg([close(['Eso pasó hace mucho.'])])], [say('Eso pasó hace mucho, y aquí nadie quiere acordarse.')]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: ACTOR }));
    await engine.act('ch_kael', 'Le pregunto a Brenna por el incendio de Vharn');
    const ctx = actorCalls()[0]!.p.messages[0]!.content as string;
    expect(ctx).not.toContain(engine.world.npc('npc_brenna').secret);
    expect(ctx).not.toMatch(/no fue un accidente/);
  });

  it('si el actor suelta el secreto dos veces, se queda el borrador del director', async () => {
    const { engine } = await bootEngine();
    const leak = 'Yo estuve allí la noche del incendio y sé que no fue un accidente: sé quién encendió el fuego.';
    const { client, actorCalls } = fakeClient([msg([close(['Eso pasó hace mucho.'])])], [say(leak), say(leak)]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: ACTOR }));
    const r = await engine.act('ch_kael', 'Le pregunto a Brenna por el incendio');
    expect(actorCalls()).toHaveLength(2);
    expect(actorCalls()[1]!.p.messages.at(-1)!.content).toMatch(/^Rehazlo: Dices cosas que tu personaje no cuenta/);
    expect(r.text).toContain('Eso pasó hace mucho.');
    expect(r.text).not.toContain('accidente');
    const ev = engine.events.all().filter((e) => e.actor_id === 'ch_kael').at(-1)!;
    expect((ev.payload['master'] as { actor: { kept_draft: boolean } }).actor.kept_draft).toBe(true);
  });

  it('el control del cierre revisa al actor: un nombre que el jugador no sabe se rehace', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    kael.knows = kael.knows.filter((id) => id !== 'npc_doro');
    const { client, actorCalls } = fakeClient(
      [msg([close(['El guardia sabe más.'])])],
      [say('Pregúntale a Doro, que se pasa el día mirando el camino.'), say('Pregúntale al guardia del portón, que se pasa el día mirando el camino.')],
    );
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: ACTOR }));
    const r = await engine.act('ch_kael', 'Le pregunto a Brenna quién vigila el camino');
    expect(actorCalls()[1]!.p.messages.at(-1)!.content).toMatch(/Nombras a Doro/);
    expect(r.text).toContain('guardia del portón');
    expect(r.text).not.toContain('Doro');
  });

  it('si el NPC se presenta, el jugador aprende su nombre', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    kael.knows = kael.knows.filter((id) => id !== 'npc_brenna');
    const { client } = fakeClient([msg([close(['Bienvenido.'])])], [say('Bienvenido, forastero. Me llamo Brenna y esta barra es mía.')]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: ACTOR }));
    await engine.act('ch_kael', 'Saludo a la tabernera');
    expect(kael.knows).toContain('npc_brenna');
  });

  it('sin turno de conversación no hay actor: tirada pendiente o nadie habla', async () => {
    const { engine } = await bootEngine();
    const { client, actorCalls } = fakeClient(
      [
        msg([close(['A ver qué me cuentas.'], { requires_roll_kind: 'skill', requires_roll_key: 'persuasion', requires_roll_dc: 15, requires_roll_advantage: 'none', suggested_actions: '' })]),
        msg([use('log_event', { narration_private: 'Miras la sala.', observable: null, observable_vague: null, loudness: 1, tags: 'exploration', suggested_actions: '', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, lines: null })]),
      ],
      [],
    );
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: ACTOR }));
    await engine.act('ch_kael', 'Intento convencer a Brenna de que me fíe');
    await engine.act('ch_mira', 'Miro la sala');
    expect(actorCalls()).toHaveLength(0);
  });

  it('si el actor falla (error de la API), el turno sigue con el borrador', async () => {
    const { engine } = await bootEngine();
    const client: MasterClient = {
      async create(p) {
        if (p.output_config?.format) throw new Error('529 overloaded');
        return msg([close(['Igual que ayer.'])]);
      },
    };
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: ACTOR }));
    const r = await engine.act('ch_kael', 'Qué tal el día');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Igual que ayer.');
  });

  it('con un cliente inyectado (offline, tests) no hay actor salvo que se pida; ACTOR_MODEL lo configura o lo apaga', async () => {
    const { engine } = await bootEngine();
    expect(new Master(engine, { client: { create: async () => msg([]) } }).actor).toBeNull();
    expect(masterOptionsFor('offline').actor).toBeUndefined();
    expect(actorConfigFromEnv({})).toEqual({ model: DEFAULT_ACTOR_MODEL, effort: 'low' });
    expect(actorConfigFromEnv({ ACTOR_MODEL: 'claude-haiku-5-5', ACTOR_EFFORT: 'medium' })).toEqual({ model: 'claude-haiku-5-5', effort: 'medium' });
    expect(actorConfigFromEnv({ ACTOR_MODEL: 'off' })).toBeNull();
  });
});

describe('piezas del actor', () => {
  it('lee el JSON del actor aunque venga con vallas, y limpia acotaciones y comillas', () => {
    expect(parseActorReply('```json\n{"lines": ["«Hola.»", "*se ríe* Pasa, pasa."]}\n```')).toEqual(['Hola.', 'Pasa, pasa.']);
    expect(parseActorReply('no es json')).toEqual([]);
  });

  it('secretLeaks: palabras raras o nombres del secreto que no estaban en lo permitido', () => {
    const secret = 'Vio a Osric Malvez prender el granero para tapar el robo de la plata.';
    expect(secretLeaks(secret, 'Fue Osric, yo lo vi.', '')).toContain('osric');
    expect(secretLeaks(secret, 'Lo del granero... lo vi prender.', '')).toEqual(expect.arrayContaining(['granero', 'prender']));
    // Una sola palabra rara no basta: puede salir por casualidad.
    expect(secretLeaks(secret, 'El granero está ahí al lado.', '')).toEqual([]);
    expect(secretLeaks(secret, 'El granero ardió, ya lo sabes.', 'el granero quemado')).toEqual([]);
  });

  it('un trato que el director no cerró se rehace', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const n = engine.world.npc('npc_brenna');
    const closed = { narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null, decisive: null, npc_id: n.id, lines: [{ speaker: 'npc' as const, npc_id: n.id, text: 'No fío.' }] };
    expect(actorProblems(engine, kael, n, ['Venga, te lo apunto y me lo pagas mañana.'], closed, [])[0]).toMatch(/trato/);
    expect(actorProblems(engine, kael, n, ['Aquí no se fía, chico. Primero las monedas.'], closed, [])).toEqual([]);
  });

  it('applyActorLines cambia la primera cita del borrador por las nuevas y quita las demás', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const n = engine.world.npc('npc_brenna');
    const closed = {
      narration_private: '«¿Hay cerveza?» Brenna asiente. «Treinta.» Y vuelve al paño. «Para ti.»', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null, decisive: null, npc_id: n.id,
      lines: [{ speaker: 'actor' as const, text: '¿Hay cerveza?' }, { speaker: 'npc' as const, npc_id: n.id, text: 'Treinta.' }, { speaker: 'npc' as const, npc_id: n.id, text: 'Para ti.' }],
    };
    const out = applyActorLines(engine, kael, n, closed, ['Hay, y fresca. Treinta la jarra.', '¿Vienes de lejos?']);
    expect(out.narration_private).toBe('«¿Hay cerveza?» Brenna asiente. «Hay, y fresca. Treinta la jarra.» «¿Vienes de lejos?» Y vuelve al paño.');
    expect(out.lines!.map((l) => l.text)).toEqual(['¿Hay cerveza?', 'Hay, y fresca. Treinta la jarra.', '¿Vienes de lejos?']);
  });
});

describe('transcripción y agenda', () => {
  const ev = (seq: number, actor: string, lines: unknown[]): GameEvent => ({ seq, actor_id: actor, timestamp_game_s: seq * 60, payload: { lines } } as unknown as GameEvent);

  it('transcriptOf: lo dicho entre ese PJ y ese NPC, literal, en orden y con tope', () => {
    const events = [
      ev(1, 'ch_kael', [{ speaker: 'actor', text: 'Hola.' }, { speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué va a ser?' }]),
      ev(2, 'ch_mira', [{ speaker: 'actor', text: 'Yo nada.' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Pues nada.' }]),
      ev(3, 'ch_kael', [{ speaker: 'actor', text: 'Cerveza.' }, { speaker: 'npc', npc_id: 'npc_doro', text: 'Yo también.' }]),
      ev(4, 'ch_mira', [{ speaker: 'pc', character_id: 'ch_kael', text: 'Dos.' }, { speaker: 'npc', npc_id: 'npc_brenna', to: 'ch_kael', text: 'Marchando.' }, { speaker: 'npc', npc_id: 'npc_brenna', to: 'ch_mira', text: 'Tú paga.' }]),
    ];
    expect(transcriptOf(events, 'ch_kael', 'npc_brenna').map((l) => `${l.who}:${l.text}`)).toEqual(['pc:Hola.', 'npc:¿Qué va a ser?', 'pc:Dos.', 'npc:Marchando.']);
    expect(transcriptOf(events, 'ch_kael', 'npc_brenna', 2).map((l) => l.text)).toEqual(['Dos.', 'Marchando.']);
  });

  it('npcConcerns: sus encargos del tablón, lo que le debe el PJ y el nivel de trato, sin datos de ninguna campaña', async () => {
    const { engine } = await bootEngine();
    const w = engine.world;
    const kael = w.character('ch_kael');
    kael.debts = [{ id: 'd1', npc_id: 'npc_brenna', amount: 30, reason: 'una cerveza fiada', due_game_s: null, created_game_s: 0 }];
    const c = npcConcerns(w, w.npc('npc_brenna'), kael, engine.gameNow()).join(' ');
    expect(c).toMatch(/Ha puesto en el tablón .*«/);
    expect(c).toContain('una cerveza fiada');
    expect(talkTier(w.npc('npc_brenna'), kael)).toBe('stranger');
    w.npc('npc_brenna').memory.push({ character_id: kael.id, game_s: 0, note: 'Pidió cerveza.', importance: 1 });
    expect(talkTier(w.npc('npc_brenna'), kael)).toBe('acquaintance');
    w.npc('npc_brenna').attitude.by_character[kael.id] = 'friendly';
    expect(talkTier(w.npc('npc_brenna'), kael)).toBe('friend');
    w.npc('npc_brenna').attitude.by_character[kael.id] = 'unfriendly';
    expect(talkTier(w.npc('npc_brenna'), kael)).toBe('wary');
  });

  it('el contexto del máster lleva la transcripción y lo que le ronda al NPC de la conversación', async () => {
    const { engine } = await bootEngine();
    const { client } = fakeClient([msg([close(['Igual que ayer.'])])], []);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1), actor: null }));
    await engine.act('ch_kael', 'Qué tal el día, Brenna');
    const ctx = actionContext(engine, engine.world.character('ch_kael'), '¿Y la cerveza?');
    expect(ctx).toContain('Lo último que se han dicho, literal');
    expect(ctx).toContain('NPC: «Igual que ayer.»');
    expect(ctx).toContain('Le ronda hoy');
  });
});

describe('system prompt', () => {
  it('reglas de conversación siempre; la de la voz, solo con actor; la longitud no cuenta lo dicho', async () => {
    const { engine } = await bootEngine();
    const c = engine.world.campaign;
    const plain = systemPrompt(c);
    const withActor = systemPrompt(c, { actor: true });
    expect(plain).toContain('NPC QUE CONVERSAN');
    expect(plain).toContain('Nunca recites el tablón');
    expect(plain).not.toContain('VOZ DE LOS NPC');
    expect(withActor).toContain('VOZ DE LOS NPC');
    expect(plain).not.toContain('Mejor un mensaje corto');
  });
});
