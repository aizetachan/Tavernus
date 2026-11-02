import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetsFor, assetsRoot, forgetManifests, loadManifests, writtenImage, writtenMap, writtenMapBackground, type AssetManifest } from '../src/ai/assets.js';
import { attachIllustrator, Illustrator, PollinationsQueue, sceneOf, sceneSeed } from '../src/ai/illustrate.js';
import { mapCacheOf } from '../src/adapters/web/mapcache.js';
import { rect, type LocationMap } from '../src/data/seed/maps.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager } from '../src/games/manager.js';
import { createWebServer } from '../src/adapters/web/server.js';
import { bootEngine, fakeTime } from './helpers.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const HAND = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

const PLANO: LocationMap = {
  cell_m: 1.5, bounds: { x: -2, y: -2, w: 16, h: 12 }, background: 'void',
  areas: [{ ground: 'wood', polygon: rect(-2, -2, 14, 10) }], walls: [{ points: rect(-2, -2, 14, 10) }], doors: [{ from: [-1, -2], to: [1, -2] }],
  props: [{ kind: 'counter', x: 5, y: 1, w: 3, h: 1, spot_id: 'sp_tab_barra', label: 'la barra' }],
};

describe('activos escritos', () => {
  let root: string;
  let dir: string;
  const prevEnv = process.env['ASSETS_DIR'];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tavernus-activos-'));
    dir = join(root, 'partida');
    const brezal = join(root, 'campaigns', 'brezal');
    await mkdir(join(brezal, 'vista'), { recursive: true });
    await mkdir(join(brezal, 'retrato'), { recursive: true });
    await mkdir(join(brezal, 'objeto', 'png'), { recursive: true });
    await writeFile(join(brezal, 'objeto', 'png', 'it_llave_vharn.png'), PNG);
    await writeFile(join(brezal, 'vista', 'loc_plaza.jpg'), HAND);
    await writeFile(join(brezal, 'retrato', 'pc-human-fighter.jpg'), HAND);
    await writeFile(join(brezal, 'retrato', 'npc_doro.png'), HAND);
    await writeFile(join(brezal, 'manifest.json'), JSON.stringify({
      campaigns: ['brezal', 'demo'],
      scene: { loc_plaza: 'vista/loc_plaza.jpg', loc_claro: 'vista/loc_claro.jpg', loc_taberna: '../../fuera.jpg' },
      portrait: { 'pc:human-fighter': 'retrato/pc-human-fighter.jpg', npc_doro: 'retrato/npc_doro.png' },
      item: { it_llave_vharn: 'objeto/png/it_llave_vharn.png' },
      maps: { loc_taberna: PLANO },
    }));
    forgetManifests();
  });
  afterEach(async () => {
    if (prevEnv === undefined) delete process.env['ASSETS_DIR']; else process.env['ASSETS_DIR'] = prevEnv;
    forgetManifests();
    await rm(root, { recursive: true, force: true });
  });

  function make(assets: AssetManifest | null) {
    const urls: string[] = [];
    const ill = new Illustrator({
      queue: new PollinationsQueue(), dir, worldSeed: 'demo', minIntervalMs: 0, log: () => {},
      fetch: (async (url: string) => { urls.push(url); return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }); }) as typeof fetch,
    });
    ill.assets = assets;
    return { ill, urls };
  }

  it('el manifiesto se busca por id de campaña y solo da ficheros JPEG que existen dentro de su carpeta', () => {
    const m = assetsFor('demo', join(root, 'campaigns'));
    expect(m?.campaigns).toEqual(['brezal', 'demo']);
    expect(assetsFor('otra', join(root, 'campaigns'))).toBeNull();
    expect(writtenImage(m, 'scene', ['loc_plaza'])?.rel).toBe('vista/loc_plaza.jpg');
    expect(writtenImage(m, 'scene', ['loc_claro'])).toBeNull(); // no subido todavía
    expect(writtenImage(m, 'scene', ['loc_taberna'])).toBeNull(); // se sale de la carpeta
    expect(writtenImage(m, 'portrait', ['npc_doro'])).toBeNull(); // PNG: solo los objetos
    expect(writtenImage(m, 'item', ['it_llave_vharn'])?.rel).toBe('objeto/png/it_llave_vharn.png');
    expect(writtenImage(m, 'portrait', ['ch_kael', 'pc:human-fighter'])?.id).toBe('pc:human-fighter');
    expect(writtenMap(m, 'demo', 'loc_taberna')).toEqual(PLANO);
    expect(writtenMap(m, 'demo', 'loc_plaza')).toBeNull();
    expect(loadManifests(join(root, 'no-hay'))).toEqual([]);
  });

  it('con activo escrito no se genera: se copia a la partida y manda sobre lo que ya estaba en caché', async () => {
    // Antes, sin activos: la escena se genera y queda en el índice.
    const before = make(null);
    const generated = await before.ill.illustrate({ location_id: 'loc_plaza', name: 'Plaza', description: 'x', light: 'day', indoor: false });
    expect(before.urls).toHaveLength(1);
    expect(generated?.provider).toBe('pollinations');

    const { ill, urls } = make(assetsFor('demo', join(root, 'campaigns')));
    const img = await ill.illustrate({ location_id: 'loc_plaza', name: 'Plaza', description: 'x', light: 'day', indoor: false });
    expect(urls).toHaveLength(0);
    expect(ill.requests).toBe(0);
    expect(img).toMatchObject({ provider: 'written', url: 'asset:vista/loc_plaza.jpg', file: `loc_plaza-${sceneSeed('demo', 'loc_plaza')}-escrito.jpg` });
    expect(await readFile(ill.pathOf(img!))).toEqual(HAND);
    expect(ill.imageFor('loc_plaza')).toBe(img);
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as Record<string, { provider: string }>;
    expect(Object.values(index).map((v) => v.provider)).toEqual(['written']);

    // Retrato de PJ por raza y clase, a través de los ids alternativos.
    const pc = await ill.illustrateEntity({ kind: 'portrait', entity_id: 'ch_kael', name: 'Kael', location_id: 'loc_plaza', prompt: 'p', asset_ids: ['pc:human-fighter'] });
    expect(pc?.provider).toBe('written');
    expect(urls).toHaveLength(0);
  });

  it('un objeto en PNG se copia a la partida como PNG, con su transparencia', async () => {
    const { ill, urls } = make(assetsFor('brezal', join(root, 'campaigns')));
    const img = await ill.illustrateEntity({ kind: 'item', entity_id: 'it_llave_vharn', name: 'llave', location_id: 'loc_plaza', prompt: 'p' });
    expect(urls).toHaveLength(0);
    expect(img).toMatchObject({ provider: 'written', url: 'asset:objeto/png/it_llave_vharn.png' });
    expect(img?.file).toMatch(/^item-it_llave_vharn-\d+-escrito\.png$/);
    expect(await readFile(ill.pathOf(img!))).toEqual(PNG);
  });

  it('al abrir una partida antigua, lo generado que ahora tiene activo pasa a ser el activo, y las copias se refrescan', async () => {
    // Antes del arte: la plaza y Doro, generados; un descubrimiento ya escrito con una copia vieja.
    const before = make(null);
    await before.ill.illustrate({ location_id: 'loc_plaza', name: 'Plaza', description: 'x', light: 'day', indoor: false });
    await before.ill.illustrate({ location_id: 'loc_claro', name: 'Claro', description: 'x', light: 'day', indoor: false });
    const brezal = join(root, 'campaigns', 'brezal');
    await mkdir(join(brezal, 'descubrimiento'), { recursive: true });
    await writeFile(join(brezal, 'descubrimiento', 'clue_pozo.jpg'), HAND);
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as Record<string, { file: string }>;
    index['discovery-ev_9-1'] = { key: 'discovery-ev_9-1', location_id: 'loc_plaza', name: 'el pozo', kind: 'discovery', entity_id: 'ev_9', seed: 1, prompt: 'p', provider: 'written', url: 'asset:descubrimiento/clue_pozo.jpg', file: 'discovery-ev_9-1-escrito.jpg' } as never;
    await writeFile(join(dir, 'discovery-ev_9-1-escrito.jpg'), JPEG);
    await writeFile(join(dir, 'index.json'), JSON.stringify(index));

    // Llega el arte: al abrir la partida, sin pedir nada a nadie.
    const { ill, urls } = make(assetsFor('demo', join(root, 'campaigns')));
    await ill.load();
    expect(urls).toHaveLength(0);
    const plaza = ill.imageFor('loc_plaza')!;
    expect(plaza).toMatchObject({ provider: 'written', url: 'asset:vista/loc_plaza.jpg' });
    expect(await readFile(ill.pathOf(plaza))).toEqual(HAND);
    expect(ill.imageFor('loc_claro')?.provider).toBe('pollinations'); // sin activo: como estaba
    const pozo = ill.entityImage('discovery', 'ev_9')!;
    expect(await readFile(ill.pathOf(pozo))).toEqual(HAND); // la copia vieja, refrescada
    const saved = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as Record<string, { provider: string; url: string }>;
    expect(Object.values(saved).filter((v) => v.provider === 'written').map((v) => v.url).sort()).toEqual(['asset:descubrimiento/clue_pozo.jpg', 'asset:vista/loc_plaza.jpg']);
  });

  it('sin manifiesto o sin el fichero, se genera como hoy', async () => {
    const { ill, urls } = make(assetsFor('demo', join(root, 'campaigns')));
    const claro = await ill.illustrate({ location_id: 'loc_claro', name: 'Claro', description: 'x', light: 'day', indoor: false });
    expect(claro?.provider).toBe('pollinations');
    expect(urls).toHaveLength(1);
    const doro = await ill.illustrateEntity({ kind: 'portrait', entity_id: 'npc_doro', name: 'Doro', location_id: 'loc_plaza', prompt: 'p' });
    expect(doro?.provider).toBe('pollinations');
    expect(urls).toHaveLength(2);
  });

  it('enganchado al motor: toma el manifiesto de su campaña, y el plano escrito sustituye al generado', async () => {
    process.env['ASSETS_DIR'] = join(root, 'campaigns');
    forgetManifests();
    const { engine } = await bootEngine(fakeTime());
    const fresh = new Illustrator({ queue: new PollinationsQueue(), dir, worldSeed: 'demo', log: () => {}, fetch: (async () => { throw new Error('no debería pedir'); }) as typeof fetch });
    attachIllustrator(engine, fresh);
    expect(fresh.assets?.campaigns).toContain('demo');
    const img = await fresh.illustrate(sceneOf(engine, 'loc_plaza'));
    expect(img?.provider).toBe('written');
    expect(fresh.requests).toBe(0);

    const cache = mapCacheOf(engine);
    expect(cache.get('loc_taberna').map).toEqual(PLANO);
    expect(cache.generatedCount).toBe(0);
    expect(cache.get('loc_plaza').map).not.toEqual(PLANO);
    expect(cache.generatedCount).toBe(1);
  });

  it('plan_campaigns: los planos y sus fondos solo valen para esas campañas; el fondo, solo con plano escrito', async () => {
    const brezal = join(root, 'campaigns', 'brezal');
    await mkdir(join(brezal, 'plano'), { recursive: true });
    await writeFile(join(brezal, 'plano', 'loc_taberna.jpg'), HAND);
    await writeFile(join(brezal, 'plano', 'loc_plaza.jpg'), HAND);
    await writeFile(join(brezal, 'manifest.json'), JSON.stringify({
      campaigns: ['brezal', 'demo'], plan_campaigns: ['brezal'],
      maps: { loc_taberna: PLANO }, map_backgrounds: { loc_taberna: 'plano/loc_taberna.jpg', loc_plaza: 'plano/loc_plaza.jpg' },
    }));
    forgetManifests();
    const m = assetsFor('demo', join(root, 'campaigns'));
    expect(writtenMap(m, 'brezal', 'loc_taberna')).toEqual(PLANO);
    expect(writtenMap(m, 'demo', 'loc_taberna')).toBeNull();
    expect(writtenMapBackground(m, 'brezal', 'loc_taberna')).toBe(join(brezal, 'plano', 'loc_taberna.jpg'));
    expect(writtenMapBackground(m, 'demo', 'loc_taberna')).toBeNull();
    expect(writtenMapBackground(m, 'brezal', 'loc_plaza')).toBeNull(); // sin plano escrito, el fondo no encajaría
  });
});

describe('el manifiesto de Brezal del repositorio', () => {
  it('cada ruta de imagen tiene su fichero, y los objetos van en PNG', () => {
    forgetManifests();
    const m = assetsFor('brezal', assetsRoot({}));
    expect(m).not.toBeNull();
    const missing: string[] = [];
    for (const kind of ['scene', 'portrait', 'item', 'discovery', 'combat'] as const) {
      for (const [id, rel] of Object.entries(m![kind] ?? {})) {
        if (!existsSync(join(m!.dir, rel)) || !writtenImage(m, kind, [id])) missing.push(`${kind}:${id} → ${rel}`);
      }
    }
    for (const rel of [m!.region_map, ...Object.values(m!.map_backgrounds ?? {})]) if (rel && !existsSync(join(m!.dir, rel))) missing.push(rel);
    expect(missing).toEqual([]);
    expect(Object.values(m!.item ?? {}).every((rel) => rel.endsWith('.png'))).toBe(true);
    forgetManifests();
  });
});

describe('/images sirve JPEG y PNG', () => {
  it('cada uno con su tipo; otros formatos, no', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-imagenes-'));
    const games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: (e) => new Master(e, { client: offlineClient() }), engine: { deterministic: false }, log: () => {}, budget: null });
    const web = createWebServer(games, { tickMs: 3_600_000 });
    try {
      await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
      const { game } = await games.create({ name: 'Imágenes', mode: 'offline' });
      const images = join(games.paths(game).dir, 'images');
      await mkdir(images, { recursive: true });
      await writeFile(join(images, 'item-it_llave-1-escrito.png'), PNG);
      await writeFile(join(images, 'loc_plaza-1-escrito.jpg'), HAND);
      await writeFile(join(images, 'otra.gif'), HAND);
      const png = await fetch(`${base}/images/item-it_llave-1-escrito.png?game=${game.slug}`);
      expect(png.status).toBe(200);
      expect(png.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await png.arrayBuffer())).toEqual(PNG);
      const jpg = await fetch(`${base}/images/loc_plaza-1-escrito.jpg?game=${game.slug}`);
      expect(jpg.headers.get('content-type')).toBe('image/jpeg');
      expect((await fetch(`${base}/images/otra.gif?game=${game.slug}`)).status).toBe(404);
    } finally {
      await web.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
