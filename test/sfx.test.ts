import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECIPE_KEYS, renderRecipe, recipeInfo, SFX_SCRIPT, SFX_STYLE, handleSfxRequest, setSoundProviderForTests } from '../src/adapters/web/sfx.js';
import { SOUND_KEYS } from '../src/adapters/web/soundmap.js';
import { SOUND_PROMPTS, soundProviderFromEnv, elevenLabsSound, worldCostUSD, type SoundProvider } from '../src/ai/sound.js';
import { PAGE } from '../src/adapters/web/page.js';
import { bootEngine } from './helpers.js';

const SR = 8000; // basta para comprobar las recetas sin gastar tiempo

describe('recetas procedurales', () => {
  it('cada clave del catálogo suena: muestras finitas, no mudas y sin saturar', () => {
    for (const k of RECIPE_KEYS) {
      const d = renderRecipe(k, SR)!;
      let peak = 0, energy = 0, finite = true;
      for (const v of d) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); energy += v * v; }
      expect(finite, k).toBe(true);
      expect(peak, k).toBeGreaterThan(0.1);
      expect(peak, k).toBeLessThanOrEqual(1);
      expect(energy / d.length, k).toBeGreaterThan(1e-5);
    }
  });

  it('los efectos son cortos y los ambientes son bucles largos', () => {
    for (const k of RECIPE_KEYS) {
      const info = recipeInfo(k)!, sec = renderRecipe(k, SR)!.length / SR;
      if (k.startsWith('ambiente-')) { expect(info.loop, k).toBe(true); expect(sec, k).toBeGreaterThanOrEqual(8); }
      else { expect(info.loop, k).toBe(false); expect(sec, k).toBeLessThan(4); expect(info.next, k).toBeGreaterThan(0); }
    }
  });

  it('el bucle no tiene salto: el empalme no es mayor que los saltos normales del propio sonido', () => {
    for (const k of RECIPE_KEYS.filter((x) => x.startsWith('ambiente-'))) {
      const d = renderRecipe(k, SR)!;
      let maxStep = 0;
      for (let i = 1; i < d.length; i++) maxStep = Math.max(maxStep, Math.abs(d[i]! - d[i - 1]!));
      expect(Math.abs(d[0]! - d[d.length - 1]!), k).toBeLessThanOrEqual(maxStep);
    }
  });

  it('determinista: misma clave, mismas muestras', () => {
    expect(Array.from(renderRecipe('puerta-abrir', SR)!.slice(0, 2000))).toEqual(Array.from(renderRecipe('puerta-abrir', SR)!.slice(0, 2000)));
  });

  it('hay receta y descripción para la IA de cada clave que emite soundmap', () => {
    for (const k of SOUND_KEYS) { expect(RECIPE_KEYS, k).toContain(k); expect(SOUND_PROMPTS[k], k).toBeDefined(); }
  });
});

describe('página', () => {
  it('lleva el gestor de sonido y los ganchos', () => {
    expect(PAGE).toContain(SFX_STYLE.trim().slice(0, 40));
    expect(PAGE).toContain('window.TavernusSfx');
    expect(PAGE).toContain('TavernusSfx.cue(');
    expect(PAGE).toContain('TavernusSfx.character(');
    expect(SFX_SCRIPT).toContain('localStorage');
  });
});

describe('proveedor de IA (apagado por defecto)', () => {
  afterEach(() => setSoundProviderForTests(undefined));

  it('sin SFX_PROVIDER no hay proveedor aunque haya claves', () => {
    expect(soundProviderFromEnv({ ELEVENLABS_API_KEY: 'x', STABILITY_API_KEY: 'y' })).toBeNull();
    expect(soundProviderFromEnv({ SFX_PROVIDER: 'off' })).toBeNull();
    expect(() => soundProviderFromEnv({ SFX_PROVIDER: 'elevenlabs' })).toThrow(/ELEVENLABS_API_KEY/);
    expect(soundProviderFromEnv({ SFX_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' })?.id).toBe('elevenlabs');
  });

  it('ElevenLabs: pide el bucle para los ambientes y la duración pedida', async () => {
    let body: Record<string, unknown> = {};
    const p = elevenLabsSound('k', async (_url, init) => { body = JSON.parse(init.body as string); return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new ArrayBuffer(4) }; });
    await p.generate('ambiente-taberna', SOUND_PROMPTS['ambiente-taberna']!);
    expect(body['loop']).toBe(true);
    expect(body['model_id']).toBe('eleven_text_to_sound_v2');
    expect(body['duration_seconds']).toBe(22);
  });

  it('coste por mundo (27 claves, una vez): céntimos con ElevenLabs, unos 2 $ con Stable Audio', () => {
    expect(worldCostUSD('elevenlabs')).toBeLessThan(0.5);
    expect(worldCostUSD('stability')).toBeCloseTo(27 * 0.08, 5);
  });

  it('/api/sfx: estado sin IA y 404 para lo que se sintetiza; con proveedor, genera una vez y cachea', async () => {
    const { engine } = await bootEngine();
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-sfx-'));
    const out = () => {
      const r = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) };
      const res = { writeHead(s: number, h: Record<string, string>) { r.status = s; r.headers = h; return res; }, end(b?: string | Buffer) { r.body = Buffer.from(b ?? ''); } };
      return { r, res: res as never };
    };
    // Biblioteca vacía: así hay claves que se sintetizan (la del repositorio ya tiene fichero para todas).
    const lib = await mkdtemp(join(tmpdir(), 'tavernus-sfxlib-'));
    process.env['SFX_LIBRARY_DIR'] = lib;
    try {
      setSoundProviderForTests(null);
      let o = out();
      await handleSfxRequest(engine, o.res, new URL('http://x/api/sfx?game=g&character=ch_kael'), dir);
      expect(JSON.parse(o.r.body.toString())).toMatchObject({ ambience: 'ambiente-taberna', ai: false });
      o = out();
      await handleSfxRequest(engine, o.res, new URL('http://x/api/sfx?game=g&key=ambiente-lluvia'), dir);
      expect(o.r.status).toBe(404);
      o = out();
      await handleSfxRequest(engine, o.res, new URL('http://x/api/sfx?game=g&key=..%2F..%2Fsecreto'), dir);
      expect(o.r.status).toBe(404);

      let calls = 0;
      const fake: SoundProvider = { id: 'fake', label: 'Fake', ext: 'mp3', contentType: 'audio/mpeg', async generate() { calls += 1; return Buffer.from('ID3fake'); } };
      setSoundProviderForTests(fake);
      for (let i = 0; i < 2; i++) {
        o = out();
        await handleSfxRequest(engine, o.res, new URL('http://x/api/sfx?game=g&key=ambiente-lluvia'), dir);
        expect(o.r.status).toBe(200);
        expect(o.r.headers['content-type']).toBe('audio/mpeg');
      }
      expect(calls).toBe(1);
      expect((await readFile(join(dir, 'sfx', 'ambiente-lluvia.mp3'))).toString()).toBe('ID3fake');
      o = out();
      await handleSfxRequest(engine, o.res, new URL('http://x/api/sfx?game=g&character=ch_kael'), dir);
      expect(JSON.parse(o.r.body.toString())).toMatchObject({ ai: true, files: ['ambiente-lluvia'] });
    } finally {
      delete process.env['SFX_LIBRARY_DIR'];
      await rm(lib, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
