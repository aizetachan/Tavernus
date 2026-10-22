import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { AZURE_DEFAULTS, azureSsml, hashIndex, narratorFromEnv, type NarratorProvider, type SpeechRequest } from '../src/ai/narrator.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { setNarratorForTests } from '../src/adapters/web/tts.js';

describe('narratorFromEnv', () => {
  it('por defecto, la voz del navegador (sin proveedor de servidor)', () => {
    expect(narratorFromEnv({})).toBeNull();
    expect(narratorFromEnv({ TTS_PROVIDER: 'browser' })).toBeNull();
  });

  it('azure sin clave o región avisa; con ellas llama al REST con SSML', async () => {
    expect(() => narratorFromEnv({ TTS_PROVIDER: 'azure' })).toThrow(/AZURE_SPEECH_KEY/);
    expect(() => narratorFromEnv({ TTS_PROVIDER: 'nube' })).toThrow(/desconocido/);
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;
    const p = narratorFromEnv({ TTS_PROVIDER: 'azure', AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'westeurope' }, fake)!;
    const audio = await p.synthesize([{ text: 'Hola', role: 'narrator', speaker: null }]);
    expect([...audio]).toEqual([1, 2, 3]);
    expect(calls[0]!.url).toBe('https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    expect((calls[0]!.init.headers as Record<string, string>)['ocp-apim-subscription-key']).toBe('k');
    expect(String(calls[0]!.init.body)).toContain(`<voice name="${AZURE_DEFAULTS.narrator}">`);
  });
});

describe('azureSsml', () => {
  it('una voz por trozo, el mismo NPC siempre con la misma, y el texto escapado', () => {
    const voiceFor = (r: SpeechRequest) => (r.role === 'narrator' ? 'N' : `V${hashIndex(r.speaker ?? '', 3)}`);
    const ssml = azureSsml([
      { text: 'La posada <cruje> & calla.', role: 'narrator', speaker: null },
      { text: '¿Quién va?', role: 'dialogue', speaker: 'Doro' },
      { text: 'Fuera.', role: 'dialogue', speaker: 'Doro' },
    ], voiceFor, 1.1);
    expect(ssml).toContain('&lt;cruje&gt; &amp; calla');
    expect(ssml.match(/<voice name="V\d">/g)).toHaveLength(2);
    expect(new Set(ssml.match(/<voice name="V\d">/g)).size).toBe(1);
    expect(ssml).toContain('<prosody rate="+10%">');
  });
});

describe('ruta /api/tts', () => {
  const noApi: MasterFactory = (engine) => new Master(engine, { client: offlineClient() });
  let dir: string;
  let games: GameManager;
  let web: WebServer;
  let base: string;
  let synthesized: SpeechRequest[][];

  const fakeProvider: NarratorProvider = {
    id: 'fake', label: 'Falso', contentType: 'audio/mpeg', ext: 'mp3',
    voiceFor: (r) => (r.role === 'narrator' ? 'narrador' : `npc-${r.speaker}`),
    async synthesize(parts) { synthesized.push(parts); return Buffer.from('ID3-audio'); },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-tts-'));
    synthesized = [];
    games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    setNarratorForTests(undefined);
    await web.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('en modo navegador, la config lo dice y no sintetiza', async () => {
    setNarratorForTests(null);
    expect(await (await fetch(`${base}/api/tts/config`)).json()).toMatchObject({ provider: 'browser' });
    const { game } = await games.create({ name: 'Voz', mode: 'offline' });
    expect((await post(`/api/tts?game=${game.slug}`, { text: 'Hola' })).status).toBe(409);
  });

  it('con proveedor, devuelve el audio y lo cachea por hash en <partida>/audio', async () => {
    setNarratorForTests(fakeProvider);
    expect(await (await fetch(`${base}/api/tts/config`)).json()).toMatchObject({ provider: 'fake' });
    const { game } = await games.create({ name: 'Voz', mode: 'offline' });
    const body = { parts: [{ text: 'La puerta cruje.', role: 'narrator' }, { text: '¿Quién va?', role: 'dialogue', speaker: 'Doro' }] };
    const r1 = await post(`/api/tts?game=${game.slug}`, body);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await r1.arrayBuffer()).toString()).toBe('ID3-audio');
    const r2 = await post(`/api/tts?game=${game.slug}`, body);
    expect(r2.status).toBe(200);
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0]!.map((p) => p.speaker)).toEqual([null, 'Doro']);
    const files = await readdir(join(games.paths((await games.get(game.slug))!).dir, 'audio'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.mp3$/);
  });

  it('rechaza partidas que no existen y textos vacíos', async () => {
    setNarratorForTests(fakeProvider);
    expect((await post('/api/tts?game=nada', { text: 'Hola' })).status).toBe(404);
    const { game } = await games.create({ name: 'Voz', mode: 'offline' });
    expect((await post(`/api/tts?game=${game.slug}`, { text: '  ' })).status).toBe(400);
    expect((await post(`/api/tts?game=${game.slug}`, { text: 'x'.repeat(3001) })).status).toBe(400);
    expect(synthesized).toHaveLength(0);
  });

  it('la página lleva el narrador de voz', async () => {
    const { game } = await games.create({ name: 'Voz', mode: 'offline' });
    const page = await (await fetch(`${base}/?game=${game.slug}`)).text();
    expect(page).toContain('window.TavernusTTS');
    expect(page).toContain('TavernusTTS.attach(div, m)');
    expect(page).not.toMatch(/^export function/m);
  });
});
