import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarStudio, avatarPrompt, avatarVariation, avatarsOf, cleanLook, MAX_LOOK, versionEntity } from '../src/ai/avatar.js';
import { Illustrator, illustratorOf, Limiter, PollinationsQueue, styleBible } from '../src/ai/illustrate.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { bootEngine } from './helpers.js';

const STYLE = styleBible({ tone: 'grim' });
const KAEL = { name: 'Kael', race: 'enano', class_name: 'guerrero', look: 'barba roja trenzada' };

/** fetch simulado: cada imagen distinta (para ver qué versión es cuál) y nunca toca la red. */
function fakeFetch(fail = () => false) {
  let n = 0;
  const fn = vi.fn(async () => (fail() ? new Response('no', { status: 500 }) : new Response(new Uint8Array([0xff, 0xd8, n++, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } })));
  return fn as unknown as typeof fetch;
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-avatar-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('prompt del avatar', () => {
  it('es determinista y distinto en cada versión', () => {
    const prompts = [1, 2, 3, 4, 5, 6, 7, 8].map((v) => avatarPrompt(KAEL, STYLE, { version: v }));
    expect(prompts).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((v) => avatarPrompt(KAEL, STYLE, { version: v })));
    expect(new Set(prompts).size).toBe(prompts.length);
    for (const p of prompts) {
      expect(p.startsWith('Portrait of Kael, enano guerrero. barba roja trenzada.')).toBe(true);
      expect(p.endsWith(`${STYLE}. no text, no watermark`)).toBe(true);
    }
    expect(avatarVariation(1)).toBe('');
    expect(avatarVariation(2)).not.toBe(avatarVariation(3));
  });

  it('el texto del jugador entra limpio, entre la raza y clase y la biblia de estilo', () => {
    const raw = '  Pelirroja {con} gafas <script>alert(1)</script>\n y capa [verde]  ' + 'x'.repeat(500);
    const look = cleanLook(raw);
    expect(look).not.toMatch(/[<>{}[\]\n]/);
    expect(look.length).toBeLessThanOrEqual(MAX_LOOK);
    const p = avatarPrompt({ ...KAEL, look: raw }, STYLE, { version: 3, described: true });
    const parts = p.split('. ');
    expect(parts[0]).toBe('Portrait of Kael, enano guerrero');
    expect(parts[1]).toContain('Pelirroja con gafas script alert(1) /script y capa verde');
    expect(p.indexOf(STYLE)).toBeGreaterThan(p.indexOf('Pelirroja'));
    expect(p.endsWith(`${STYLE}. no text, no watermark`)).toBe(true);
    // Lo describe el jugador: solo cambia la pose, no la luz ni el atuendo.
    expect(parts[2]).toBe(avatarVariation(3, true));
  });

  it('la versión 1 es el propio PJ (comparte retrato con portraitOf); las demás, entidades aparte', () => {
    expect(versionEntity('ch_kael', 1)).toBe('ch_kael');
    expect(versionEntity('ch_kael', 4)).toBe('ch_kael~v4');
  });
});

describe('estudio de avatares', () => {
  async function studioFor(opts: { limit?: number; gameLimit?: number; now?: () => number; fail?: () => boolean } = {}) {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    const ill = new Illustrator({ dir, worldSeed: 'demo', fetch: fakeFetch(opts.fail), minIntervalMs: 0, queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2), log: () => {} });
    const studio = new AvatarStudio(engine, ill, { dir, log: () => {}, ...opts });
    return { engine, ill, studio };
  }

  it('límite diario por personaje con mensaje claro; al día siguiente se puede otra vez', async () => {
    let t = Date.UTC(2026, 9, 22, 10);
    const { studio } = await studioFor({ limit: 2, now: () => t });
    await studio.ensure('ch_kael');
    await studio.settled('ch_kael');
    // La primera no cuenta.
    expect(studio.view('ch_kael')).toMatchObject({ used: 0, left: 2, chosen: 1 });
    for (let i = 0; i < 2; i++) {
      expect((await studio.regenerate('ch_kael')).ok).toBe(true);
      // De una en una.
      expect(await studio.regenerate('ch_kael')).toMatchObject({ ok: false, status: 409 });
      await studio.settled('ch_kael');
    }
    const r = await studio.regenerate('ch_kael');
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect(r.ok ? '' : r.text).toMatch(/2 retratos hoy.*medianoche UTC/);
    expect(studio.view('ch_kael')).toMatchObject({ used: 2, left: 0, chosen: 3 });
    t += 24 * 3600_000;
    expect(studio.view('ch_kael')).toMatchObject({ used: 0, left: 2 });
    expect((await studio.regenerate('ch_kael')).ok).toBe(true);
  });

  it('también hay tope por partida, y lo que falla no cuenta', async () => {
    let failing = false;
    const { studio } = await studioFor({ limit: 5, gameLimit: 1, fail: () => failing });
    failing = true;
    expect((await studio.regenerate('ch_kael')).ok).toBe(true);
    await studio.settled('ch_kael');
    expect(studio.view('ch_kael')).toMatchObject({ used: 0, versions: [{ v: 1 }] });
    expect(studio.view('ch_kael')!.error).toMatch(/no se ha contado/);
    failing = false;
    expect((await studio.regenerate('ch_kael')).ok).toBe(true);
    await studio.settled('ch_kael');
    expect(await studio.regenerate('ch_mira')).toMatchObject({ ok: false, status: 429 });
  });

  it('describirlo guarda el aspecto y pinta con él; elegir fija la versión en el ilustrador', async () => {
    const { engine, ill, studio } = await studioFor();
    const r = await studio.describe('ch_kael', 'Cabeza rapada y tatuajes azules');
    expect(r.ok).toBe(true);
    await studio.settled('ch_kael');
    expect(engine.world.character('ch_kael').appearance).toBe('Cabeza rapada y tatuajes azules');
    const view = studio.view('ch_kael')!;
    const described = view.versions.find((v) => v.source === 'describe')!;
    expect(described).toMatchObject({ look: 'Cabeza rapada y tatuajes azules', chosen: true });
    expect(ill.entityImage('portrait', 'ch_kael')?.file).toBe(described.file);
    expect(ill.entityImage('portrait', 'ch_kael')?.prompt).toContain('Cabeza rapada y tatuajes azules');
    expect(await studio.describe('ch_kael', ' ')).toMatchObject({ ok: false, status: 400 });
    expect(await studio.choose('ch_kael', 99)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('avatar en la web', () => {
  let web: { server: import('node:http').Server; stop(): Promise<void> } | null = null;
  afterEach(async () => { await web?.stop(); web = null; });

  async function readSse(res: Response, until: (events: { type: string; data: unknown }[]) => boolean) {
    const reader = res.body!.getReader();
    const events: { type: string; data: unknown }[] = [];
    let buf = '';
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const type = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (type && data) events.push({ type, data: JSON.parse(data) });
      }
    }
    return events;
  }

  it('nace con avatar desde su aspecto; la versión elegida se guarda y es la del cast del stream', async () => {
    const { GameManager } = await import('../src/games/manager.js');
    const { createWebServer } = await import('../src/adapters/web/server.js');
    const make = () => new GameManager({
      root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local'), IMAGES: 'on' }, log: () => {},
      masterFor: (engine) => new Master(engine, { client: offlineClient() }), engine: { deterministic: true },
      illustrator: { fetch: fakeFetch(), minIntervalMs: 0, queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2) },
    });
    let games = make();
    const { game, character_id } = await games.create({ name: 'Retratos', mode: 'offline', character: { name: 'Ana', appearance: 'trenza negra y capa gris' } });
    const id = character_id!;
    let engine = await games.open(game.slug);
    expect(engine.world.character(id).appearance).toBe('trenza negra y capa gris');
    await avatarsOf(engine)!.settled(id);
    const first = illustratorOf(engine)!.entityImage('portrait', id)!;
    expect(first.prompt).toContain('trenza negra y capa gris');

    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web!.server.listen(0, '127.0.0.1', resolve));
    let base = `http://127.0.0.1:${(web.server.address() as import('node:net').AddressInfo).port}`;
    const url = () => `${base}/api/avatar?game=${game.slug}&character=${id}`;
    const post = async (body: unknown) => (await fetch(url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<{ ok: boolean; chosen: number; pending: number | null; versions: { v: number; src: string | null; chosen: boolean }[] }>;

    expect(await post({ action: 'regenerate' })).toMatchObject({ ok: true, pending: 2 });
    await avatarsOf(engine)!.settled(id);
    const listed = await (await fetch(url())).json() as Awaited<ReturnType<typeof post>>;
    expect(listed).toMatchObject({ ok: true, chosen: 2, pending: null });
    expect(listed.versions.map((v) => v.v)).toEqual([1, 2]);
    expect(listed.versions[0]!.src).toContain(first.file);
    expect(await post({ action: 'choose', v: 1 })).toMatchObject({ ok: true, chosen: 1 });
    expect(await post({ action: 'nada' })).toMatchObject({ ok: false });

    const cast = async () => {
      const ctrl = new AbortController();
      const res = await fetch(`${base}/api/stream?game=${game.slug}&character=${id}`, { signal: ctrl.signal });
      const ev = await readSse(res, (e) => e.some((x) => x.type === 'cast'));
      ctrl.abort();
      return ev.find((x) => x.type === 'cast')!.data as { me: { id: string; avatar: string | null } };
    };
    expect((await cast()).me.avatar).toContain(first.file);
    expect(await post({ action: 'choose', v: 2 })).toMatchObject({ ok: true, chosen: 2 });
    const second = listed.versions[1]!.src!;
    expect((await cast()).me.avatar).toBe(second);

    // Tras reiniciar el servidor la elegida sigue siendo la 2.
    await web.stop(); web = null;
    games = make();
    engine = await games.open(game.slug);
    await avatarsOf(engine)!.ready;
    expect(second).toContain(illustratorOf(engine)!.entityImage('portrait', id)!.file);
    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web!.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as import('node:net').AddressInfo).port}`;
    expect((await cast()).me.avatar).toBe(second);
    // Y se puede volver a la 1 aunque al arrancar estuviera fijada la 2.
    expect(await post({ action: 'choose', v: 1 })).toMatchObject({ ok: true, chosen: 1 });
    expect((await cast()).me.avatar).toContain(first.file);
    await games.closeAll();
  });
});
