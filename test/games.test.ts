import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { recordClient } from '../src/ai/cache.js';
import { GameManager, MAIN_SLUG, INITIAL_DEMO_SLUG, type MasterFactory } from '../src/games/manager.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';

/**
 * Nunca la API real: «live» responde el cliente offline y «record» graba lo
 * que responde el offline, con la caché de la propia partida.
 */
const noApi: MasterFactory = (engine, game, paths, rng) => {
  const client = game.mode === 'record' ? recordClient(offlineClient(), paths.cache) : offlineClient();
  return new Master(engine, { client, ...(rng ? { rng } : {}) });
};

let dir: string;
const managers: GameManager[] = [];

function manager(env: NodeJS.ProcessEnv = {}): GameManager {
  const m = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local'), ...env }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
  managers.push(m);
  return m;
}

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-games-')); });
afterEach(async () => {
  for (const m of managers.splice(0)) await m.closeAll();
  await rm(dir, { recursive: true, force: true });
});

const exists = (p: string) => stat(p).then(() => true, () => false);

describe('gestor de partidas', () => {
  it('migra DATA_DIR como partida principal sin mover sus ficheros', async () => {
    await mkdir(join(dir, 'local'), { recursive: true });
    await writeFile(join(dir, 'local', 'demo.events.jsonl'), '');
    const games = manager({ MASTER_MODE: 'offline' });
    expect(await games.init()).toEqual({ migrated: true, demo: false });
    const [main] = await games.list();
    expect(main).toMatchObject({ slug: MAIN_SLUG, main: true, mode: 'offline', demo: false });
    const m = (await games.get(MAIN_SLUG))!;
    expect(games.paths(m).data).toBe(join(dir, 'local'));
    // Ya hay partidas: no vuelve a migrar.
    expect(await games.init()).toEqual({ migrated: false, demo: false });
  });

  it('empaqueta la caché existente como demo inicial', async () => {
    const cache = join(dir, 'local', 'master-cache');
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'abc.json'), '{}');
    const games = manager();
    expect(await games.init()).toEqual({ migrated: true, demo: true });
    const demo = (await games.list()).find((g) => g.slug === INITIAL_DEMO_SLUG)!;
    expect(demo).toMatchObject({ demo: true, mode: 'replay', cache_entries: 1 });
    expect(await exists(join(dir, 'games', INITIAL_DEMO_SLUG, 'master-cache', 'abc.json'))).toBe(true);
  });

  it('crea y lista partidas con su personaje', async () => {
    const games = manager();
    const { game, character_id } = await games.create({ name: 'La noche del Brezal', mode: 'offline', character: { name: 'Aldo', class_id: 'rogue', race_id: 'elf' } });
    expect(game.slug).toBe('la-noche-del-brezal');
    expect(character_id).toMatch(/^ch_aldo_/);
    const again = await games.create({ name: 'La noche del Brezal', mode: 'live' });
    expect(again.game.slug).toBe('la-noche-del-brezal-2');

    const list = await games.list();
    expect(list.map((g) => g.slug).sort()).toEqual(['la-noche-del-brezal', 'la-noche-del-brezal-2']);
    const first = list.find((g) => g.slug === 'la-noche-del-brezal')!;
    expect(first.characters).toContain('Aldo');
    expect(first.mode).toBe('offline');

    const engine = await games.open(game.slug);
    expect(engine.world.character(character_id!).class_id).toBe('rogue');
  });

  it('rechaza datos malos sin dejar carpeta', async () => {
    const games = manager();
    await expect(games.create({ name: '  ', mode: 'offline' })).rejects.toThrow(/nombre/);
    await expect(games.create({ name: 'X', mode: 'replay' as never })).rejects.toThrow(/Modo/);
    await expect(games.create({ name: 'Dup', mode: 'offline', character: { name: 'Kael' } })).rejects.toThrow(/en uso/);
    expect(await games.list()).toEqual([]);
    expect(await readdir(join(dir, 'games'))).toEqual([]);
  });

  it('abre dos partidas a la vez sin mezclar datos', async () => {
    const games = manager();
    const a = await games.create({ name: 'A', mode: 'offline', character: { name: 'Aria' } });
    const b = await games.create({ name: 'B', mode: 'offline', character: { name: 'Bruno' } });
    const ea = await games.open(a.game.slug);
    const eb = await games.open(b.game.slug);
    expect(ea).not.toBe(eb);
    expect(await games.open(a.game.slug)).toBe(ea);

    expect(ea.world.characters.has(a.character_id!)).toBe(true);
    expect(ea.world.characters.has(b.character_id!)).toBe(false);
    expect(eb.world.characters.has(a.character_id!)).toBe(false);

    const r = await ea.act(a.character_id!, 'miro a mi alrededor con calma');
    expect(r.ok).toBe(true);
    expect(ea.events.lastSeq).toBeGreaterThan(eb.events.lastSeq);

    // Se cierran y se vuelven a abrir desde disco con lo suyo.
    const seqA = ea.events.lastSeq;
    await games.closeAll();
    const ea2 = await games.open(a.game.slug);
    expect(ea2).not.toBe(ea);
    expect(ea2.events.lastSeq).toBe(seqA);
    expect(ea2.world.characters.has(b.character_id!)).toBe(false);
  });

  it('borra la partida y cierra su motor', async () => {
    const games = manager();
    const { game } = await games.create({ name: 'Efímera', mode: 'offline' });
    let closed = '';
    games.onClose((slug) => { closed = slug; });
    await games.delete(game.slug);
    expect(closed).toBe(game.slug);
    expect(games.isOpen(game.slug)).toBe(false);
    expect(await exists(join(dir, 'games', game.slug))).toBe(false);
    await expect(games.delete(game.slug)).rejects.toThrow(/No existe/);
  });

  it('borrar la principal no toca los datos de DATA_DIR', async () => {
    await mkdir(join(dir, 'local'), { recursive: true });
    const games = manager({ MASTER_MODE: 'offline' });
    await games.init();
    await games.open(MAIN_SLUG);
    await games.delete(MAIN_SLUG);
    expect(await exists(join(dir, 'local', 'demo.world.json'))).toBe(true);
  });

  it('convierte una grabación en demo que empieza como la grabación', async () => {
    const games = manager();
    const { game, character_id } = await games.create({ name: 'Grabación', mode: 'record', character: { name: 'Rhea' } });
    expect(game.dice_seed).not.toBeNull();
    expect(game.initial_dir).toBe('initial');
    const engine = await games.open(game.slug);
    await engine.act(character_id!, 'me acerco a la barra');
    const seqPlayed = engine.events.lastSeq;
    const cached = (await games.info(game)).cache_entries;
    expect(cached).toBeGreaterThan(0);

    await expect(games.convertToDemo('no-existe')).rejects.toThrow(/No existe/);
    const demo = await games.convertToDemo(game.slug);
    expect(demo).toMatchObject({ mode: 'replay', demo: true });
    expect(games.isOpen(game.slug)).toBe(false);
    await expect(games.convertToDemo(game.slug)).rejects.toThrow(/ya es una demo/);

    // Lo jugado queda aparte; la demo arranca desde la foto inicial, con el mismo PJ y la caché.
    const p = games.paths(demo);
    expect(await exists(join(p.dir, 'recorded', 'demo.world.json'))).toBe(true);
    const replay = await games.open(game.slug);
    expect(replay.world.characters.has(character_id!)).toBe(true);
    expect(replay.events.lastSeq).toBeLessThan(seqPlayed);
    expect((await games.info(demo)).cache_entries).toBe(cached);

    // Y se puede volver a empezar.
    await replay.act(character_id!, 'me acerco a la barra');
    await games.resetDemo(game.slug);
    const fresh = await games.open(game.slug);
    expect(fresh.events.lastSeq).toBeLessThan(seqPlayed);
  });

  it('solo convierte grabaciones', async () => {
    const games = manager();
    const { game } = await games.create({ name: 'Normal', mode: 'offline' });
    await expect(games.convertToDemo(game.slug)).rejects.toThrow(/Solo las grabaciones/);
  });
});

describe('rutas web con ?game', () => {
  let games: GameManager;
  let web: WebServer;
  let base: string;

  beforeEach(async () => {
    games = manager();
    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await web.stop(); });

  const get = (path: string) => fetch(base + path);
  const post = (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('sirve el menú sin game y la partida con game', async () => {
    const menu = await (await get('/')).text();
    expect(menu).toContain('Nueva partida');
    const { game } = await games.create({ name: 'Uno', mode: 'offline' });
    const page = await (await get(`/?game=${game.slug}`)).text();
    expect(page).toContain('← Menú');
    const missing = await fetch(`${base}/?game=nada`, { redirect: 'manual' });
    expect(missing.status).toBe(302);
  });

  it('sin game devuelve 400 en todas las rutas de juego', async () => {
    for (const path of ['/api/characters', '/api/stream?character=ch_kael', '/api/sheet?character=ch_kael', '/api/board?character=ch_kael']) {
      const r = await get(path);
      expect(r.status, path).toBe(400);
      expect(((await r.json()) as { text: string }).text).toMatch(/game/);
    }
    for (const path of ['/api/act', '/api/roll', '/api/command']) {
      expect((await post(path, { character: 'ch_kael', text: 'hola', name: 'look' })).status, path).toBe(400);
    }
    expect((await get('/api/characters?game=no-existe')).status).toBe(404);
  });

  it('crea, juega y lista por la API sin mezclar partidas', async () => {
    const r = await post('/api/games', { name: 'Web', mode: 'offline', character: 'Wena', race: 'dwarf', class: 'cleric' });
    const created = (await r.json()) as { ok: boolean; game: { slug: string }; character_id: string };
    expect(created.ok).toBe(true);
    const other = (await (await post('/api/games', { name: 'Otra', mode: 'offline' })).json()) as { game: { slug: string } };

    const chars = (await (await get(`/api/characters?game=${created.game.slug}`)).json()) as { id: string; name: string }[];
    expect(chars.map((c) => c.name)).toContain('Wena');
    const otherChars = (await (await get(`/api/characters?game=${other.game.slug}`)).json()) as { name: string }[];
    expect(otherChars.map((c) => c.name)).not.toContain('Wena');

    const g = `?game=${created.game.slug}`;
    expect((await post(`/api/act${g}`, { character: created.character_id, text: 'saludo a la tabernera' })).status).toBe(200);
    expect((await post(`/api/command${g}`, { character: created.character_id, name: 'look' })).status).toBe(200);
    expect((await get(`/api/sheet${g}&character=${created.character_id}`)).status).toBe(200);
    expect((await get(`/api/board${g}&character=${created.character_id}`)).status).toBe(200);
    expect((await post(`/api/act?game=${other.game.slug}`, { character: created.character_id, text: 'x' })).status).toBe(404);

    // El stream entrega el historial de esa partida.
    const ctrl = new AbortController();
    const stream = await fetch(`${base}/api/stream${g}&character=${created.character_id}`, { signal: ctrl.signal });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const first = new TextDecoder().decode((await stream.body!.getReader().read()).value);
    expect(first).toContain('event: history');
    ctrl.abort();

    const list = (await (await get('/api/games')).json()) as { games: { slug: string; characters: string[] }[]; options: { races: unknown[] }; api_key: boolean };
    expect(list.games.map((x) => x.slug).sort()).toEqual([created.game.slug, other.game.slug].sort());
    expect(list.options.races.length).toBeGreaterThan(0);
  });

  it('valida la creación y borra, convierte y reinicia por la API', async () => {
    expect((await post('/api/games', { name: 'Mal', mode: 'replay' })).status).toBe(400);
    expect((await post('/api/games', { name: '', mode: 'offline' })).status).toBe(400);

    const rec = (await (await post('/api/games', { name: 'Rec', mode: 'record', character: 'Remo' })).json()) as { game: { slug: string; dice_seed: number | null } };
    expect(rec.game.dice_seed).not.toBeNull();
    const demo = await post(`/api/games/demo?game=${rec.game.slug}`);
    expect(((await demo.json()) as { game: { demo: boolean; mode: string } }).game).toMatchObject({ demo: true, mode: 'replay' });
    expect((await post(`/api/games/reset?game=${rec.game.slug}`)).status).toBe(200);
    expect((await post('/api/games/demo')).status).toBe(400);

    const del = await fetch(`${base}/api/games?game=${rec.game.slug}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await fetch(`${base}/api/games?game=${rec.game.slug}`, { method: 'DELETE' })).status).toBe(404);
  });
});
