import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECIPE_KEYS, renderRecipe, recipeInfo, SFX_SCRIPT, SFX_STYLE, handleSfxRequest, setSoundProviderForTests, AMBIENT_TRACKS } from '../src/adapters/web/sfx.js';
import { SOUND_KEYS } from '../src/adapters/web/soundmap.js';
import { SOUND_PROMPTS, SFX_AI_ENABLED, soundProviderFromEnv, elevenLabsSound, worldCostUSD, type SoundProvider } from '../src/ai/sound.js';
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

describe('pistas de ambiente con licencia libre (public/sfx/ambient)', () => {
  it('cada pista está en ogg y mp3, pesa poco y está atribuida en LICENSES', async () => {
    const licenses = await readFile(new URL('../public/sfx/LICENSES', import.meta.url), 'utf8');
    for (const t of AMBIENT_TRACKS) {
      expect(SOUND_KEYS, t.key).toContain(t.key);
      for (const ext of ['ogg', 'mp3']) {
        const { size } = await stat(new URL(`../public/sfx/ambient/${t.key}.${ext}`, import.meta.url));
        expect(size, `${t.key}.${ext}`).toBeGreaterThan(50_000);
        expect(size, `${t.key}.${ext}`).toBeLessThan(1_500_000);
      }
      expect(licenses, t.key).toContain(`ambient/${t.key}.ogg`);
      expect(licenses, t.key).toContain(t.url);
      expect(licenses, t.key).toContain(t.author);
    }
  });

  it('la taberna, la plaza y la herrería tienen pista grabada', () => {
    for (const k of ['ambiente-taberna', 'ambiente-plaza', 'ambiente-herreria']) expect(AMBIENT_TRACKS.map((t) => t.key)).toContain(k);
  });
});

describe('proveedor de IA (desactivado, para más adelante)', () => {
  afterEach(() => setSoundProviderForTests(undefined));

  it('desactivado: ni con SFX_PROVIDER y clave hay proveedor', () => {
    expect(SFX_AI_ENABLED).toBe(false);
    expect(soundProviderFromEnv({ ELEVENLABS_API_KEY: 'x', STABILITY_API_KEY: 'y' })).toBeNull();
    expect(soundProviderFromEnv({ SFX_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' })).toBeNull();
    expect(soundProviderFromEnv({ SFX_PROVIDER: 'stability', STABILITY_API_KEY: 'k' })).toBeNull();
  });

  it('encendido a propósito: hace falta elegirlo en el entorno', () => {
    expect(soundProviderFromEnv({ ELEVENLABS_API_KEY: 'x', STABILITY_API_KEY: 'y' }, true)).toBeNull();
    expect(soundProviderFromEnv({ SFX_PROVIDER: 'off' }, true)).toBeNull();
    expect(() => soundProviderFromEnv({ SFX_PROVIDER: 'elevenlabs' }, true)).toThrow(/ELEVENLABS_API_KEY/);
    expect(soundProviderFromEnv({ SFX_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' }, true)?.id).toBe('elevenlabs');
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
    expect(worldCostUSD('stability')).toBeCloseTo(Object.keys(SOUND_PROMPTS).length * 0.08, 5);
  });

  it('/api/sfx: estado sin IA y 404 para lo que se sintetiza; con proveedor, genera una vez y cachea', async () => {
    const { engine } = await bootEngine();
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-sfx-'));
    const out = () => {
      const r = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) };
      const res = { writeHead(s: number, h: Record<string, string>) { r.status = s; r.headers = h; return res; }, end(b?: string | Buffer) { r.body = Buffer.from(b ?? ''); } };
      return { r, res: res as never };
    };
    // Biblioteca de prueba: dos pistas grabadas en ambient/ (ogg y mp3) y, en la raíz, un fichero del equipo que tapa una.
    const lib = await mkdtemp(join(tmpdir(), 'tavernus-sfxlib-'));
    await mkdir(join(lib, 'ambient'), { recursive: true });
    for (const k of ['ambiente-taberna', 'ambiente-plaza']) for (const ext of ['ogg', 'mp3']) await writeFile(join(lib, 'ambient', `${k}.${ext}`), 'x');
    await writeFile(join(lib, 'ambiente-plaza.mp3'), 'ID3equipo');
    process.env['SFX_LIBRARY_DIR'] = lib;
    try {
      setSoundProviderForTests(null);
      let o = out();
      await handleSfxRequest(engine, o.res, new URL('http://x/api/sfx?game=g&character=ch_kael'), dir);
      const state = JSON.parse(o.r.body.toString());
      expect(state).toMatchObject({ ambience: 'ambiente-taberna', ai: false });
      expect(state.files).toEqual(expect.arrayContaining(['ambiente-taberna', 'ambiente-plaza']));
      // Créditos solo de lo grabado que suena: la plaza la tapa el fichero de la raíz.
      expect(state.credits.map((c: { key: string }) => c.key)).toEqual(['ambiente-taberna']);
      for (const [fmt, type] of [['ogg', 'audio/ogg'], ['mp3', 'audio/mpeg']] as const) {
        o = out();
        await handleSfxRequest(engine, o.res, new URL(`http://x/api/sfx?game=g&key=ambiente-taberna&fmt=${fmt}`), dir);
        expect(o.r.status).toBe(200);
        expect(o.r.headers['content-type']).toBe(type);
      }
      o = out();
      await handleSfxRequest(engine, o.res, new URL('http://x/api/sfx?game=g&key=ambiente-plaza&fmt=ogg'), dir);
      expect(o.r.body.toString()).toBe('ID3equipo');
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
      const after = JSON.parse(o.r.body.toString());
      expect(after.ai).toBe(true);
      expect(after.files[0]).toBe('ambiente-lluvia');
    } finally {
      delete process.env['SFX_LIBRARY_DIR'];
      await rm(lib, { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
