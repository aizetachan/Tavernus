import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUDFLARE_MODEL, Limiter, MIN_INTERVAL_MS, Illustrator, PollinationsQueue, cloudflareFromEnv, POLLINATIONS_BASE, STYLE, illustratorOf, imagesEnabled, pollinationsUrl, retryAfterMs,
  sceneKey, sceneOf, scenePrompt, sceneSeed, type SceneInput,
} from '../src/ai/illustrate.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import type { FirstVisit } from '../src/engine/engine.js';
import { bootEngine, fakeTime } from './helpers.js';

const TABERNA: SceneInput = {
  location_id: 'loc_taberna', name: 'Taberna del Jabalí',
  description: 'Una sala baja de vigas negras, con olor a cerveza rancia y humo de leña.', light: 'twilight', indoor: true,
};
const PLAZA: SceneInput = { location_id: 'loc_plaza', name: 'Plaza del Pozo', description: 'La plaza empedrada de Brezal.', light: 'day', indoor: false };
const CLARO: SceneInput = { location_id: 'loc_claro', name: 'Claro del Roble', description: 'Un claro amplio rodeado de fresnos.', light: 'night_moon', indoor: false };

/** fetch simulado: nunca toca la red; responde en orden lo que se le pase y luego 200 con un JPEG. */
function fakeFetch(now: () => number, script: Response[] = []) {
  const calls: { url: string; at: number; auth: string | null }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), at: now(), auth: new Headers(init?.headers).get('authorization') });
    return script.shift() ?? new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

/** Reloj y espera simulados: `sleep(ms)` salta el reloj hasta su instante, sin timers reales. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => { const target = t + ms; await Promise.resolve(); t = Math.max(t, target); },
  };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-img-')); });
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('prompt y seed deterministas', () => {
  it('la misma escena da el mismo prompt, la misma seed y la misma URL', () => {
    expect(scenePrompt(TABERNA)).toBe(scenePrompt({ ...TABERNA }));
    expect(scenePrompt(TABERNA)).toContain('Taberna del Jabalí (interior)');
    expect(scenePrompt(TABERNA)).toContain('vigas negras');
    expect(scenePrompt(TABERNA)).toContain(STYLE);
    expect(scenePrompt(TABERNA)).toContain('dusk');
    expect(sceneSeed('demo', 'loc_taberna')).toBe(sceneSeed('demo', 'loc_taberna'));
    expect(sceneSeed('demo', 'loc_taberna')).not.toBe(sceneSeed('demo', 'loc_plaza'));
    expect(sceneSeed('demo', 'loc_taberna')).not.toBe(sceneSeed(1234, 'loc_taberna'));
    const seed = sceneSeed('demo', 'loc_taberna');
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 31);
    const url = pollinationsUrl(scenePrompt(TABERNA), seed);
    expect(url).toBe(pollinationsUrl(scenePrompt(TABERNA), seed));
    expect(url.startsWith(POLLINATIONS_BASE)).toBe(true);
    expect(url).toContain(`?width=768&height=512&seed=${seed}`);
    expect(url).not.toContain('nologo');
    expect(decodeURIComponent(url.slice(POLLINATIONS_BASE.length, url.indexOf('?')))).toBe(scenePrompt(TABERNA));
    expect(sceneKey('loc_taberna', seed)).toBe(`loc_taberna-${seed}`);
  });

  it('recorta descripciones largas y no depende de espacios sobrantes', () => {
    const long = { ...PLAZA, description: `${'palabra '.repeat(80)}  fin` };
    expect(scenePrompt(long).length).toBeLessThan(400);
    expect(scenePrompt({ ...PLAZA, description: '  La plaza   empedrada de Brezal. ' })).toBe(scenePrompt(PLAZA));
  });

  it('Retry-After en segundos o como fecha', () => {
    expect(retryAfterMs('30', 0)).toBe(30_000);
    expect(retryAfterMs(new Date(90_000).toUTCString(), 0)).toBe(90_000);
    expect(retryAfterMs(null, 0)).toBeNull();
    expect(retryAfterMs('pronto', 0)).toBeNull();
  });

  it('solo con IMAGES=on, en cualquier modo', () => {
    expect(imagesEnabled({}, 'live')).toBe(false);
    expect(imagesEnabled({ IMAGES: 'off' }, 'live')).toBe(false);
    expect(imagesEnabled({ IMAGES: 'on' }, 'live')).toBe(true);
    expect(imagesEnabled({ IMAGES: 'ON' }, 'replay')).toBe(true);
    expect(imagesEnabled({ IMAGES: 'on' }, 'offline')).toBe(true);
    expect(imagesEnabled({ IMAGES: 'off' }, 'offline')).toBe(false);
  });
});

describe('caché', () => {
  it('anónimo: descarga sin cabecera ni nologo', async () => {
    const f = fakeFetch(() => Date.now());
    const ill = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', fetch: f.fetch, log: () => {} });
    const img = await ill.illustrate(TABERNA, 'ch_ana');
    const url = pollinationsUrl(scenePrompt(TABERNA), sceneSeed('demo', 'loc_taberna'));
    expect(f.calls).toEqual([{ url, at: expect.any(Number), auth: null }]);
    expect(img?.url).toBe(url);
    expect(img?.file).toBe(`loc_taberna-${sceneSeed('demo', 'loc_taberna')}.jpg`);
    expect(ill.imageFor('loc_taberna')).toEqual(img);
  });

  it('con clave descarga una sola vez por escena, en memoria y en disco', async () => {
    const f = fakeFetch(() => Date.now());
    const seen: string[] = [];
    const ill = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', apiKey: 'sk_test', fetch: f.fetch, minIntervalMs: 0, log: () => {} });
    ill.onIllustrated((r) => seen.push(r.character_id));
    // Dos PJs llegan a la vez y un tercero después: una sola petición.
    const [a, b] = await Promise.all([ill.illustrate(TABERNA, 'ch_ana'), ill.illustrate(TABERNA, 'ch_bo')]);
    const c = await ill.illustrate(TABERNA, 'ch_cid');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.auth).toBe('Bearer sk_test');
    expect(f.calls[0]!.url).toContain('nologo=true');
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect(seen.sort()).toEqual(['ch_ana', 'ch_bo', 'ch_cid']);
    const seed = sceneSeed('demo', 'loc_taberna');
    expect(a?.file).toBe(`loc_taberna-${seed}.jpg`);
    expect((await stat(join(dir, a!.file!))).size).toBe(4);
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(index)).toEqual([`loc_taberna-${seed}`]);

    // Otro proceso con el mismo directorio: ni una petición más.
    const f2 = fakeFetch(() => Date.now());
    const again = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', apiKey: 'sk_test', fetch: f2.fetch, minIntervalMs: 0, log: () => {} });
    await again.load();
    expect(again.imageFor('loc_taberna')?.file).toBe(a!.file);
    expect(await again.illustrate(TABERNA, 'ch_ana')).toEqual(a);
    expect(f2.calls).toHaveLength(0);
  });

  it('si falla no muestra nada ni guarda, y se reintenta pasado el enfriamiento', async () => {
    const clock = fakeClock(0);
    const f = fakeFetch(clock.now, [new Response('boom', { status: 500 })]);
    const ill = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', apiKey: 'k', fetch: f.fetch, ...clock, minIntervalMs: 0, failureCooldownMs: 60_000, log: () => {} });
    expect(await ill.illustrate(TABERNA, 'ch_ana')).toBeNull();
    expect(ill.imageFor('loc_taberna')).toBeNull();
    await expect(stat(join(dir, 'index.json'))).rejects.toThrow();
    expect(await ill.illustrate(TABERNA, 'ch_ana')).toBeNull(); // aún enfriando: sin petición
    expect(f.calls).toHaveLength(1);
    await clock.sleep(60_000);
    expect((await ill.illustrate(TABERNA, 'ch_ana'))?.file).toMatch(/\.jpg$/);
    expect(f.calls).toHaveLength(2);
  });
});

describe('cola', () => {
  it('una petición cada vez, al menos 45 s después de que termine la anterior', async () => {
    const clock = fakeClock(1_000_000);
    const f = fakeFetch(clock.now);
    const ill = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', fetch: f.fetch, ...clock, log: () => {} });
    await Promise.all([ill.illustrate(TABERNA), ill.illustrate(PLAZA), ill.illustrate(CLARO)]);
    expect(f.calls).toHaveLength(3);
    const at = f.calls.map((c) => c.at);
    expect(at[0]).toBe(1_000_000);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  it('en 402/429 espera lo que diga Retry-After y reintenta', async () => {
    const clock = fakeClock(0);
    const f = fakeFetch(clock.now, [
      new Response('', { status: 429, headers: { 'retry-after': '120' } }),
      new Response('', { status: 402, headers: { 'retry-after': '1' } }),
    ]);
    const ill = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', apiKey: 'k', fetch: f.fetch, ...clock, log: () => {} });
    expect((await ill.illustrate(TABERNA))?.file).toMatch(/^loc_taberna-\d+\.jpg$/);
    // Retry-After + 1 s de margen, pero nunca menos que el mínimo (el «Retry-After: 1» de Pollinations).
    expect(f.calls.map((c) => c.at)).toEqual([0, 121_000, 121_000 + MIN_INTERVAL_MS]);
  });

  it('una petición colgada o un error de red se reintentan', async () => {
    const clock = fakeClock(0);
    let n = 0;
    const flaky = (async () => {
      n++;
      if (n === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      if (n === 2) throw new TypeError('fetch failed');
      return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }) as unknown as typeof fetch;
    const ill = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', fetch: flaky, ...clock, log: () => {} });
    expect((await ill.illustrate(TABERNA))?.file).toMatch(/\.jpg$/);
    expect(n).toBe(3);
    expect(clock.now()).toBe(2 * MIN_INTERVAL_MS);
  });

  it('dos partidas con la misma cola (el límite es por IP) se esperan', async () => {
    const clock = fakeClock(0);
    const f = fakeFetch(clock.now);
    const queue = new PollinationsQueue();
    const a = new Illustrator({ queue, dir: join(dir, 'a'), worldSeed: 'demo', fetch: f.fetch, ...clock, log: () => {} });
    const b = new Illustrator({ queue, dir: join(dir, 'b'), worldSeed: 'otra', fetch: f.fetch, ...clock, log: () => {} });
    await Promise.all([a.illustrate(TABERNA), b.illustrate(TABERNA)]);
    expect(f.calls.map((c) => c.at)).toEqual([0, MIN_INTERVAL_MS]);
  });

  it('la descarga que tarda cuenta desde que termina', async () => {
    const clock = fakeClock(0);
    const calls: number[] = [];
    const slow = (async () => {
      calls.push(clock.now());
      await clock.sleep(6_000); // Pollinations tarda unos segundos en generar
      return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }) as unknown as typeof fetch;
    const ill = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', fetch: slow, ...clock, log: () => {} });
    await Promise.all([ill.illustrate(TABERNA), ill.illustrate(PLAZA)]);
    expect(calls).toEqual([0, 6_000 + MIN_INTERVAL_MS]);
  });
});

describe('disparador en el motor', () => {
  it('avisa la primera llegada al crear personaje y al viajar, y solo la primera', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time, { deterministic: true });
    const visits: FirstVisit[] = [];
    engine.onFirstVisit((v) => visits.push(v));
    const r = await engine.createCharacter('u1', 'Ana');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(visits).toEqual([{ character_id: r.character.id, location_id: engine.world.characterSpot(r.character)!.location_id, game_s: engine.gameNow() }]);

    // Kael ya conoce la taberna y la plaza: solo el claro es nuevo.
    await engine.act('ch_kael', 'ir al claro del roble');
    time.advanceGame(4 * 3600);
    await engine.tick();
    expect(visits.filter((v) => v.character_id === 'ch_kael').map((v) => v.location_id)).toEqual(['loc_claro']);
    await engine.act('ch_kael', 'ir a la taberna');
    time.advanceGame(4 * 3600);
    await engine.tick();
    await engine.act('ch_kael', 'ir al claro del roble');
    time.advanceGame(4 * 3600);
    await engine.tick();
    expect(visits.filter((v) => v.character_id === 'ch_kael')).toHaveLength(1);
  });

  it('el gestor engancha el ilustrador solo con IMAGES=on, también en offline', async () => {
    const noApi: MasterFactory = (engine) => new Master(engine, { client: offlineClient() });
    const f = fakeFetch(() => Date.now());
    const games = new GameManager({
      root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local'), IMAGES: 'on' }, masterFor: noApi, engine: { deterministic: false }, log: () => {},
      illustrator: { fetch: f.fetch, minIntervalMs: 0, queue: new PollinationsQueue() },
    });
    try {
      const live = await games.create({ name: 'Con imágenes', mode: 'live', character: { name: 'Ana' } });
      const engine = await games.open(live.game.slug);
      const ill = illustratorOf(engine);
      expect(ill).not.toBeNull();
      expect(ill!.keyed).toBe(false);
      const ana = engine.world.character(live.character_id!);
      const loc = engine.world.characterSpot(ana)!.location_id;
      const img = await ill!.illustrate(sceneOf(engine, loc)); // la misma que encoló la llegada de Ana
      expect(img?.url).toContain(`seed=${sceneSeed('demo', loc)}`);
      expect(ill!.imageFor(loc)).toEqual(img);
      expect(img?.file).toMatch(/\.jpg$/);
      expect(await stat(join(games.paths(live.game).dir, 'images', img!.file!))).toBeTruthy();
      expect(f.calls).toHaveLength(1);

      const off = await games.create({ name: 'Sin red', mode: 'offline', character: { name: 'Bo' } });
      expect(illustratorOf(await games.open(off.game.slug))).not.toBeNull();
      expect(f.calls).toHaveLength(2); // la llegada de Bo también se ilustra en offline

      const apagado = new GameManager({
        root: join(dir, 'games-off'), env: { DATA_DIR: join(dir, 'local-off') }, masterFor: noApi, engine: { deterministic: false }, log: () => {},
        illustrator: { fetch: f.fetch, minIntervalMs: 0, queue: new PollinationsQueue() },
      });
      try {
        const sin = await apagado.create({ name: 'Sin imágenes', mode: 'offline', character: { name: 'Cas' } });
        expect(illustratorOf(await apagado.open(sin.game.slug))).toBeNull();
      } finally {
        await apagado.closeAll();
      }
    } finally {
      await games.closeAll();
    }
  });
});

describe('Cloudflare Workers AI', () => {
  const CF = { accountId: 'acc123', apiToken: 'tok_test' };
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const cfOk = () => Response.json({ success: true, errors: [], result: { image: JPEG.toString('base64') } });

  /** fetch simulado que separa Cloudflare (POST) de Pollinations (GET) y responde en orden lo que se le pase a cada uno. */
  function routedFetch(cfScript: (() => Response)[] = []) {
    const cf: { url: string; auth: string | null; body: unknown }[] = [];
    const polli: string[] = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('https://api.cloudflare.com/')) {
        cf.push({ url: u, auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
        return (cfScript.shift() ?? cfOk)();
      }
      polli.push(u);
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }) as unknown as typeof fetch;
    return { fetch: fn, cf, polli };
  }

  const make = (f: ReturnType<typeof routedFetch>, cloudflare: typeof CF | null = CF) => new Illustrator({
    queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2), dir, worldSeed: 'demo', fetch: f.fetch,
    minIntervalMs: 0, cloudflare, log: () => {},
  });

  it('las credenciales salen del entorno solo si están las dos', () => {
    expect(cloudflareFromEnv({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' })).toEqual({ apiToken: 't', accountId: 'a' });
    expect(cloudflareFromEnv({ CLOUDFLARE_API_TOKEN: 't' })).toBeNull();
    expect(cloudflareFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: '  ' })).toBeNull();
  });

  it('con credenciales es el principal y el base64 acaba en el fichero de la caché', async () => {
    const f = routedFetch();
    const ill = make(f);
    expect(ill.provider).toBe('cloudflare');
    const img = await ill.illustrate(TABERNA, 'ch_ana');
    const seed = sceneSeed('demo', 'loc_taberna');
    expect(f.polli).toHaveLength(0);
    expect(f.cf).toEqual([{
      url: `https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/${CLOUDFLARE_MODEL}`,
      auth: 'Bearer tok_test',
      body: { prompt: scenePrompt(TABERNA), steps: 4 },
    }]);
    expect(img?.provider).toBe('cloudflare');
    expect(img?.file).toBe(`${sceneKey('loc_taberna', seed)}.jpg`);
    expect(await readFile(join(dir, img!.file))).toEqual(JPEG);
    // Caché: ni una petición más.
    await ill.illustrate(TABERNA, 'ch_bo');
    expect(f.cf).toHaveLength(1);
  });

  it('cuota agotada (429): cae a Pollinations y no vuelve a Cloudflare hasta mañana', async () => {
    const f = routedFetch([() => new Response('{}', { status: 429 })]);
    const ill = make(f);
    const img = await ill.illustrate(TABERNA);
    expect(img?.provider).toBe('pollinations');
    expect(f.polli).toEqual([pollinationsUrl(scenePrompt(TABERNA), sceneSeed('demo', 'loc_taberna'))]);
    expect((await readFile(join(dir, img!.file))).length).toBe(2);
    await ill.illustrate(PLAZA);
    expect(f.cf).toHaveLength(1);
    expect(f.polli).toHaveLength(2);
  });

  it('success:false: cae a Pollinations y la siguiente escena vuelve a probar Cloudflare', async () => {
    const f = routedFetch([() => Response.json({ success: false, errors: [{ code: 5006, message: 'Internal error' }], result: null }, { status: 500 })]);
    const ill = make(f);
    expect((await ill.illustrate(TABERNA))?.provider).toBe('pollinations');
    expect((await ill.illustrate(PLAZA))?.provider).toBe('cloudflare');
    expect(f.cf).toHaveLength(2);
    expect(f.polli).toHaveLength(1);
  });

  it('cuota agotada en errors[] también desactiva Cloudflare', async () => {
    const f = routedFetch([() => Response.json({ success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] }, { status: 400 })]);
    const ill = make(f);
    expect((await ill.illustrate(TABERNA))?.provider).toBe('pollinations');
    expect((await ill.illustrate(PLAZA))?.provider).toBe('pollinations');
    expect(f.cf).toHaveLength(1);
  });

  it('sin credenciales sigue con Pollinations', async () => {
    const f = routedFetch();
    const ill = make(f, null);
    expect(ill.provider).toBe('pollinations');
    expect((await ill.illustrate(TABERNA))?.provider).toBe('pollinations');
    expect(f.cf).toHaveLength(0);
    expect(f.polli).toHaveLength(1);
  });

  it('no lanza más de 2 a la vez', async () => {
    let active = 0, peak = 0;
    const slow = (async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return cfOk();
    }) as unknown as typeof fetch;
    const ill = new Illustrator({ queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2), dir, worldSeed: 'demo', fetch: slow, cloudflare: CF, log: () => {} });
    const scenes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...PLAZA, location_id: `loc_${id}` }));
    const imgs = await Promise.all(scenes.map((s) => ill.illustrate(s)));
    expect(imgs.every((i) => i?.provider === 'cloudflare')).toBe(true);
    expect(peak).toBe(2);
  });

  it('el gestor elige Cloudflare con las variables del entorno', async () => {
    const noApi: MasterFactory = (engine) => new Master(engine, { client: offlineClient() });
    const f = routedFetch();
    const games = new GameManager({
      root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local'), IMAGES: 'on', CLOUDFLARE_API_TOKEN: 'tok_test', CLOUDFLARE_ACCOUNT_ID: 'acc123' },
      masterFor: noApi, engine: { deterministic: false }, log: () => {},
      illustrator: { fetch: f.fetch, minIntervalMs: 0, queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2) },
    });
    try {
      const live = await games.create({ name: 'Con Cloudflare', mode: 'live', character: { name: 'Ana' } });
      const engine = await games.open(live.game.slug);
      const ill = illustratorOf(engine)!;
      expect(ill.provider).toBe('cloudflare');
      const loc = engine.world.characterSpot(engine.world.character(live.character_id!))!.location_id;
      expect((await ill.illustrate(sceneOf(engine, loc)))?.provider).toBe('cloudflare');
      expect(f.cf).toHaveLength(1);
      expect(f.polli).toHaveLength(0);
    } finally {
      await games.closeAll();
    }
  });
});
