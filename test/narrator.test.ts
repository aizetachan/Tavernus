import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { AZURE_DEFAULTS, azureSsml, ELEVENLABS_DEFAULTS, hashIndex, NarratorOutOfCredits, narratorFromEnv, stripId3, type NarratorProvider, type SpeechRequest } from '../src/ai/narrator.js';
import type { AudioTagger } from '../src/ai/audiotags.js';
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

describe('ElevenLabs', () => {
  it('sin clave avisa; con ella pide cada voz por separado y junta los mp3 en uno', async () => {
    expect(() => narratorFromEnv({ TTS_PROVIDER: 'elevenlabs' })).toThrow(/ELEVENLABS_API_KEY/);
    const calls: { url: string; init: RequestInit }[] = [];
    let n = 0;
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      n++;
      return new Response(new Uint8Array([n, n]), { status: 200 });
    }) as unknown as typeof fetch;
    const p = narratorFromEnv({ TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k', TTS_VOICE_NARRATOR: 'narr', TTS_VOICES_NPC: 'brenna' }, fake)!;
    expect(p.id).toBe('elevenlabs');
    const audio = await p.synthesize([
      { text: 'La luna asoma.', role: 'narrator', speaker: null },
      { text: 'Entre los robles.', role: 'narrator', speaker: null },
      { text: '¿Qué te pongo?', role: 'dialogue', speaker: 'npc_brenna' },
    ]);
    // Dos narraciones seguidas van juntas: dos peticiones, una por voz, y el audio encadenado.
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/narr?output_format=mp3_44100_128',
      'https://api.elevenlabs.io/v1/text-to-speech/brenna?output_format=mp3_44100_128',
    ]);
    expect([...audio]).toEqual([1, 1, 2, 2]);
    expect((calls[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('k');
    const body = JSON.parse(String(calls[0]!.init.body)) as { text: string; model_id: string; voice_settings?: unknown };
    expect(body).toEqual({ text: 'La luna asoma.\n\nEntre los robles.', model_id: ELEVENLABS_DEFAULTS.model });
    // La voz y el modelo forman parte de la clave de la caché.
    expect(p.voiceFor({ text: 'x', role: 'narrator', speaker: null })).toBe(`narr@${ELEVENLABS_DEFAULTS.model}@1`);
  });

  it('al unir los mp3, quita la etiqueta ID3 de todos menos el primero', () => {
    const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 3, 9, 9, 9]);
    expect([...stripId3(Buffer.concat([tag, Buffer.from([0xff, 0xfb])]))]).toEqual([0xff, 0xfb]);
    expect([...stripId3(Buffer.from([0xff, 0xfb, 1]))]).toEqual([0xff, 0xfb, 1]);
  });

  it('un error de la API se convierte en una excepción con el código', async () => {
    const fake = (async () => new Response('invalid_api_key', { status: 401 })) as unknown as typeof fetch;
    const p = narratorFromEnv({ TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'mala', TTS_RATE: '1.5' }, fake)!;
    await expect(p.synthesize([{ text: 'Hola', role: 'narrator', speaker: null }])).rejects.toThrow(/ElevenLabs 401/);
    // La velocidad se limita al rango que admite ElevenLabs.
    expect(p.voiceFor({ text: 'x', role: 'narrator', speaker: null })).toBe(`${ELEVENLABS_DEFAULTS.narrator}@${ELEVENLABS_DEFAULTS.model}@1.2`);
  });

  it('sin créditos lanza NarratorOutOfCredits (402 y el antiguo 401 quota_exceeded)', async () => {
    for (const [status, body] of [[402, '{"detail":{"code":"insufficient_credits"}}'], [401, '{"detail":{"status":"quota_exceeded"}}']] as const) {
      const fake = (async () => new Response(body, { status })) as unknown as typeof fetch;
      const p = narratorFromEnv({ TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' }, fake)!;
      await expect(p.synthesize([{ text: 'Hola', role: 'narrator', speaker: null }])).rejects.toBeInstanceOf(NarratorOutOfCredits);
    }
  });

  it('solo eleven_v3 entiende acotaciones de voz', () => {
    expect(narratorFromEnv({ TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' })!.audioTags).toBe(false);
    expect(narratorFromEnv({ TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k', ELEVENLABS_MODEL: 'eleven_v3' })!.audioTags).toBe(true);
    expect(narratorFromEnv({ TTS_PROVIDER: 'azure', AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'r' })!.audioTags).toBeFalsy();
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

  it('con un proveedor de acotaciones, sintetiza el texto etiquetado; sin él, el original', async () => {
    const tagger: AudioTagger = { model: 'falso', tag: async (parts) => parts.map((p) => ({ ...p, text: `[whispers] ${p.text}` })) };
    const { game } = await games.create({ name: 'Voz', mode: 'offline' });
    const body = { parts: [{ text: 'Silencio.', role: 'narrator' }] };
    setNarratorForTests({ ...fakeProvider, audioTags: true }, tagger);
    expect((await post(`/api/tts?game=${game.slug}`, body)).status).toBe(200);
    setNarratorForTests(fakeProvider, tagger);
    expect((await post(`/api/tts?game=${game.slug}`, body)).status).toBe(200);
    expect(synthesized.map((s) => s[0]!.text)).toEqual(['[whispers] Silencio.', 'Silencio.']);
  });

  it('sin créditos responde 402 y la config pasa a la voz del navegador', async () => {
    let calls = 0;
    setNarratorForTests({ ...fakeProvider, async synthesize() { calls++; throw new NarratorOutOfCredits('sin créditos'); } });
    const { game } = await games.create({ name: 'Voz', mode: 'offline' });
    const r = await post(`/api/tts?game=${game.slug}`, { text: 'Hola' });
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ code: 'no_credits' });
    expect(await (await fetch(`${base}/api/tts/config`)).json()).toMatchObject({ provider: 'browser' });
    // Mientras dure, ni se le vuelve a pedir.
    expect((await post(`/api/tts?game=${game.slug}`, { text: 'Otra' })).status).toBe(402);
    expect(calls).toBe(1);
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
