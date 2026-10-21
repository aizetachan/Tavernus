import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Master, type MasterClient } from '../src/ai/master.js';
import { offlineClient, offlineLogEvent, parseContext, OFFLINE_MODEL } from '../src/ai/offline.js';
import { recordClient, replayClient, requestHash, stripTimestamps } from '../src/ai/cache.js';
import { masterClientFor, masterCacheDir, masterModeFromEnv, needsApiKey } from '../src/ai/mode.js';
import { actionContext, systemPrompt } from '../src/ai/prompt.js';
import { MASTER_TOOLS } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { moveTo } from '../src/engine/movement.js';
import { bootEngine, fakeTime } from './helpers.js';

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function msg(content: Anthropic.Beta.BetaContentBlock[], id = 'msg_1'): Anthropic.Beta.BetaMessage {
  return {
    id, type: 'message', role: 'assistant', model: 'claude-opus-5', content, stop_reason: 'tool_use', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
const logEvent = (priv: string): Anthropic.Beta.BetaToolUseBlock => ({
  type: 'tool_use', id: 'tu_log', name: 'log_event', input: {
    narration_private: priv, observable: null, observable_vague: null, loudness: 1, tags: 'test', suggested_actions: 'Una | Otra',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null,
  },
});

/** Cliente contado: devuelve siempre la misma respuesta y apunta cuántas veces lo llaman. */
function countingClient(response = msg([logEvent('Respuesta real.')])) {
  const calls: Params[] = [];
  const client: MasterClient = { async create(p) { calls.push(structuredClone(p)); return response; } };
  return { client, calls };
}

function params(context: string, extra: Partial<Params> = {}): Params {
  return {
    model: 'claude-opus-5', max_tokens: 100,
    system: [{ type: 'text', text: 'sistema' }],
    tools: MASTER_TOOLS,
    messages: [{ role: 'user', content: context }],
    ...extra,
  };
}

describe('cliente offline', () => {
  it('lee el contexto real: actor, puntos, salidas y NPCs', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const ctx = actionContext(engine, kael, 'me acerco a la barra');
    const p = parseContext(ctx);
    expect(p.actor).toBe('Kael');
    expect(p.action).toBe('me acerco a la barra');
    expect(p.scene).toBe('action');
    expect(p.spots.length).toBeGreaterThan(1);
    expect(p.spots.some((s) => s.here)).toBe(true);
    expect(p.exits.length).toBeGreaterThan(0);
    expect(p.npcs.map((n) => n.id)).toContain('npc_brenna');
  });

  it('cierra en una sola iteración sin API, con narración breve y 2-3 acciones sacadas del contexto', async () => {
    const { engine } = await bootEngine();
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(1) }));
    const r = await engine.act('ch_kael', 'Me acerco a la barra');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Haces me acerco a la barra. Nada cambia.');
    expect(r.requires_roll).toBeUndefined();
    expect(r.event!.observable).toBeNull();
    expect(r.suggested_actions!.length).toBeGreaterThanOrEqual(2);
    expect(r.suggested_actions!.length).toBeLessThanOrEqual(3);
    // Las sugerencias salen de lo que hay en el contexto (un NPC, un punto, una salida).
    const ctx = r.event!.payload['master'] as { context: string; model: string; usage: { iterations: number; input: number } };
    const names = [...engine.world.spotsOf('loc_taberna').map((s) => s.name), ...[...engine.world.npcs.values()].map((n) => n.name), ...[...engine.world.locations.values()].map((l) => l.name)];
    for (const s of r.suggested_actions!) expect(names.some((n) => s.endsWith(n))).toBe(true);
    expect(ctx.model).toBe(OFFLINE_MODEL);
    expect(ctx.usage.iterations).toBe(1);
    expect(ctx.usage.input).toBe(0);
  });

  it('es determinista: el mismo contexto produce el mismo cierre', () => {
    const ctx = '## Localización: X (loc_x)\nPuntos:\n- la barra [sp_a] ← actor aquí: ...\n- la mesa [sp_b] a 3 m: ...\n\n## Actor: Ana [ch_ana]\n\n## Acción del jugador\n«miro la mesa»';
    expect(offlineLogEvent(ctx)).toEqual(offlineLogEvent(ctx));
    expect(offlineLogEvent(ctx)).toMatchObject({ narration_private: 'Haces miro la mesa. Nada cambia.', observable: null, suggested_actions: 'Ir a la mesa | Mirar alrededor' });
  });

  it('"ataco" pide una tirada de ataque contra un NPC presente y el servidor la resuelve', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_arroyo' };
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(2) }));
    const r = await engine.act('ch_kael', 'ataco al lobo');
    expect(r.ok).toBe(true);
    expect(r.requires_roll).toMatchObject({ kind: 'attack', key: 'melee', target: 'npc_lobo' });
    expect(engine.pendingRoll('ch_kael')).not.toBeNull();
    const r2 = await engine.rollPending('ch_kael');
    expect(r2.ok).toBe(true);
    expect(r2.text).toMatch(/Nada más cambia/);
    expect(engine.pendingRoll('ch_kael')).toBeNull();
    expect(engine.world.npc('npc_lobo').attitude.by_character['ch_kael']).toBe('hostile');
  });

  it('"atacar" sin nadie a quien atacar cierra sin tirada', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_sendero' };
    engine.world.npc('npc_lobo').status = 'dead';
    engine.attachMaster(new Master(engine, { client: offlineClient() }));
    const r = await engine.act('ch_kael', 'quiero atacar a alguien');
    expect(r.ok).toBe(true);
    expect(r.requires_roll).toBeUndefined();
    expect(r.text).toMatch(/no hay nadie/);
  });

  it('narra la primera escena y la llegada sin API', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.attachMaster(new Master(engine, { client: offlineClient() }));
    const c = await engine.createCharacter('u1', 'Ana');
    if (!c.ok) throw new Error(c.reason);
    const intro = await engine.introduce(c.character.id);
    expect(intro?.ok).toBe(true);
    expect(intro!.text).toMatch(/^Abres los ojos en /);
    // El offline no mueve a nadie: el desplazamiento lo pone el motor y la llegada la narra el offline.
    expect(moveTo(engine.world, 'ch_kael', 'sp_tab_mesa', 'walk', engine.gameNow()).ok).toBe(true);
    time.advanceGame(60);
    await engine.tick();
    await engine.act('ch_kael', 'inventario');
    const ev = engine.events.all().find((e) => e.action_type === 'master_arrival');
    expect(ev?.narration_private).toMatch(/^Llegas a /);
  });
});

describe('hash de la petición', () => {
  it('ignora la hora de juego y las marcas de los eventos, pero no el resto', () => {
    const a = '## Tiempo\nLunes 3 de Brumal, año 12, 09:15. Luz: día. 1 h real = 3 h de juego.\n\n## Últimos eventos que el actor ha percibido\n- [Lunes 3 de Brumal, año 12, 09:10] Entras.\n\n## Acción del jugador\n«miro»';
    const b = a.replace('09:15', '14:40').replace('Luz: día', 'Luz: noche').replace('09:10', '14:35');
    expect(stripTimestamps(a)).toBe(stripTimestamps(b));
    expect(requestHash(params(a))).toBe(requestHash(params(b)));
    expect(requestHash(params(a))).not.toBe(requestHash(params(a.replace('«miro»', '«salto»'))));
    expect(requestHash(params(a))).not.toBe(requestHash(params(a, { model: 'otro' })));
  });

  it('no depende del orden de las claves', () => {
    const p1 = params('x');
    const p2 = { messages: p1.messages, tools: p1.tools, system: p1.system, max_tokens: 100, model: p1.model } as Params;
    expect(requestHash(p1)).toBe(requestHash(p2));
  });
});

describe('record y replay', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-cache-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('record: llama una vez, guarda <hash>.json y luego sirve de la caché', async () => {
    const { client: inner, calls } = countingClient();
    const rec = recordClient(inner, dir);
    const p = params('## Tiempo\nLunes, 09:15. Luz: día.\n\n## Acción del jugador\n«miro»');
    const r1 = await rec.create(p);
    const r2 = await rec.create(params('## Tiempo\nLunes, 21:40. Luz: noche.\n\n## Acción del jugador\n«miro»'));
    expect(calls).toHaveLength(1);
    expect(r2).toEqual(r1);
    const files = await readdir(dir);
    expect(files).toEqual([`${requestHash(p)}.json`]);
    const saved = JSON.parse(await readFile(join(dir, files[0]!), 'utf8')) as { action: string; response: { content: unknown[] } };
    expect(saved.action).toBe('Acción del jugador: «miro»');
    expect(saved.response.content).toHaveLength(1);
    await rec.create(params('## Acción del jugador\n«salto»'));
    expect(calls).toHaveLength(2);
  });

  it('replay: sirve lo grabado y, si falta, cae al offline avisando por consola', async () => {
    const { client: inner } = countingClient(msg([logEvent('Grabado.')]));
    await recordClient(inner, dir).create(params('## Acción del jugador\n«miro»'));
    const warnings: string[] = [];
    const rep = replayClient(dir, undefined, (m) => warnings.push(m));
    const hit = await rep.create(params('## Acción del jugador\n«miro»'));
    expect((hit.content[0] as Anthropic.Beta.BetaToolUseBlock).input).toMatchObject({ narration_private: 'Grabado.' });
    expect(warnings).toHaveLength(0);
    const miss = await rep.create(params('## Actor: Ana [ch_ana]\n\n## Acción del jugador\n«salto»'));
    expect(miss.model).toBe(OFFLINE_MODEL);
    expect((miss.content[0] as Anthropic.Beta.BetaToolUseBlock).input).toMatchObject({ narration_private: 'Haces salto. Nada cambia.' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/sin caché/);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('record con el Master: la segunda partida idéntica no llama a la API', async () => {
    const { client: inner, calls } = countingClient();
    const play = async () => {
      const { engine } = await bootEngine();
      engine.attachMaster(new Master(engine, { client: recordClient(inner, dir) }));
      return engine.act('ch_kael', 'miro a Brenna');
    };
    const a = await play();
    const b = await play();
    expect(a.text).toBe('Respuesta real.');
    expect(b.text).toBe('Respuesta real.');
    expect(calls).toHaveLength(1);
    // Lo que se guarda es la petición completa que vio la API (system cacheado, tools).
    expect(calls[0]!.system).toEqual([{ type: 'text', text: expect.stringContaining('el Narrador'), cache_control: { type: 'ephemeral', ttl: '1h' } }]);
    expect(await readdir(dir)).toHaveLength(1);
  });
});

describe('MASTER_MODE', () => {
  it('lee el modo del entorno; un valor raro avisa y cae a live', () => {
    const warnings: string[] = [];
    expect(masterModeFromEnv({}, (m) => warnings.push(m))).toBe('live');
    expect(masterModeFromEnv({ MASTER_MODE: 'offline' })).toBe('offline');
    expect(masterModeFromEnv({ MASTER_MODE: ' Replay ' })).toBe('replay');
    expect(masterModeFromEnv({ MASTER_MODE: 'record' })).toBe('record');
    expect(masterModeFromEnv({ MASTER_MODE: 'cualquiera' }, (m) => warnings.push(m))).toBe('live');
    expect(warnings).toHaveLength(1);
  });

  it('configured() es true sin clave en los modos sin API', () => {
    const key = process.env['ANTHROPIC_API_KEY'];
    const tok = process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    try {
      expect(Master.configured('offline')).toBe(true);
      expect(Master.configured('replay')).toBe(true);
      expect(Master.configured('live')).toBe(false);
      expect(Master.configured('record')).toBe(false);
      expect(Master.configured()).toBe(false);
    } finally {
      if (key !== undefined) process.env['ANTHROPIC_API_KEY'] = key;
      if (tok !== undefined) process.env['ANTHROPIC_AUTH_TOKEN'] = tok;
    }
    expect(needsApiKey('offline')).toBe(false);
    expect(needsApiKey('record')).toBe(true);
  });

  it('la caché va en DATA_DIR/master-cache salvo MASTER_CACHE_DIR; offline y replay no construyen el SDK', async () => {
    expect(masterCacheDir({})).toBe(join('./data/local', 'master-cache'));
    expect(masterCacheDir({ DATA_DIR: '/tmp/x' })).toBe(join('/tmp/x', 'master-cache'));
    expect(masterCacheDir({ MASTER_CACHE_DIR: '/c' })).toBe('/c');
    expect(masterClientFor('live', {})).toBeNull();
    const off = masterClientFor('offline', {});
    expect(off).not.toBeNull();
    const res = await off!.create(params('## Acción del jugador\n«miro»'));
    expect(res.model).toBe(OFFLINE_MODEL);
    const { engine } = await bootEngine();
    const sp = systemPrompt(engine.world.campaign);
    expect(sp).toContain('el Narrador'); // el modo no cambia el prompt: el motor sigue igual
  });
});
