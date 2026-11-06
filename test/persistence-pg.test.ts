/**
 * Bloque G (docs/PLAN-OBJETOS.md §8): el mundo de cada partida en PostgreSQL (PGlite en los tests), como
 * documentos JSONB. El mismo mundo tras guardar y cargar en JSON y en la base; cada guardado, una transacción con
 * solo lo que cambió; el gestor de partidas con WORLD_STORE=pg; y el paso de partidas de JSON a la base y vuelta.
 */
import { mkdtemp, rm, stat, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { memoryDb, type Db } from '../src/db/db.js';
import { JsonFileRepository, readJsonWorld, writeJsonWorld } from '../src/persistence/jsonfile.js';
import { exportWorld, importWorld, PgRepository } from '../src/persistence/pg.js';
import { splitDiagnostics } from '../src/persistence/diagnostics.js';
import { journalOf } from '../src/engine/journal.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { recordClient } from '../src/ai/cache.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { PgWorldStore, worldStoreFromEnv } from '../src/games/worlds.js';
import { compareWorlds, worldStoreCommand } from '../src/games/world-cli.js';
import { fakeTime } from './helpers.js';

let db: Db;
beforeAll(async () => { db = await memoryDb(); });
afterAll(async () => { await db.close(); });

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function tmp(): Promise<string> { const d = await mkdtemp(join(tmpdir(), 'tavernus-pg-')); dirs.push(d); return d; }

function bulkyMaster(): MasterLike {
  let n = 0;
  return {
    async resolve(_actor, text) {
      n++;
      return {
        ok: true, usage: {}, calls: [], model: 'stub', context: `CONTEXTO-${n} ` + 'x'.repeat(2000),
        closed: {
          narration_private: `Narración de «${text}» (${n}).`, observable: `Algo pasa (${n}).`, observable_vague: null, loudness: 1,
          tags: [], suggested_actions: [], requires_roll: n % 4 === 0 ? { kind: 'skill', key: 'perception', dc: 12, advantage: 'none' } : null,
        },
      };
    },
  };
}

const ACTIONS = ['busco huellas en el suelo', 'pregunto al tabernero por el camino', 'examino la chimenea con cuidado', 'escucho las conversaciones'];

async function play(repo: JsonFileRepository | PgRepository, turns: number) {
  const time = fakeTime();
  const engine = await Engine.boot({ repo, campaignId: 'demo', seed: makeSeed(), now: time.now, deterministic: false });
  for (const c of engine.world.characters.values()) c.connected = true;
  engine.attachMaster(bulkyMaster());
  for (let i = 0; i < turns; i++) {
    await engine.act(i % 3 === 2 ? 'ch_mira' : 'ch_kael', ACTIONS[i % ACTIONS.length]!);
    time.advanceGame(40);
    if (i % 8 === 7) await engine.tick();
  }
  await engine.flush();
  return { engine, time };
}

function bootState(e: Engine) {
  const pcs = ['ch_kael', 'ch_mira'];
  return {
    // Las definiciones de objetos, por id: el mundo se guarda sin el catálogo del código y lo repone al arrancar (bloque B), en otro orden.
    world: JSON.parse(JSON.stringify({ ...e.world.snapshot(), item_defs: [...e.world.snapshot().item_defs].sort((a, b) => a.id.localeCompare(b.id)) })) as unknown,
    order: Object.fromEntries(Object.entries(e.world.snapshot()).filter(([k, v]) => Array.isArray(v) && k !== 'item_defs').map(([k, v]) => [k, (v as { id: string }[]).map((x) => x.id)])),
    events: e.events.all().map((x) => JSON.parse(JSON.stringify(splitDiagnostics(x).event)) as unknown),
    lastSeq: e.events.lastSeq,
    pending: pcs.map((id) => e.pendingRoll(id)),
    moments: [...(e as unknown as { seenMoments: Set<string> }).seenMoments].sort(),
    threads: pcs.map((id) => e.events.forCharacter(id, null).map((d) => d.text)),
    journals: pcs.map((id) => JSON.parse(JSON.stringify(journalOf(e, id))) as unknown),
  };
}

describe('PgRepository', () => {
  it('el mismo mundo tras guardar y cargar en JSON y en la base, y el que seguía vivo', async () => {
    const dir = await tmp();
    const { engine: live, time } = await play(new JsonFileRepository(dir), 30);
    // A la base, tal cual.
    await importWorld(db, 'mismo-mundo', readJsonWorld(dir, 'demo')!);
    const fromJson = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now, deterministic: false });
    const fromPg = await Engine.boot({ repo: new PgRepository(db, 'mismo-mundo'), campaignId: 'demo', now: time.now, deterministic: false });
    for (const c of live.world.characters.values()) c.connected = false;
    const expected = bootState(live);
    expect(bootState(fromJson)).toEqual(expected);
    expect(bootState(fromPg)).toEqual(expected);
    // El contexto del máster está en la base, pero no se carga.
    expect(fromPg.events.all().some((e) => 'context' in ((e.payload['master'] as object | null) ?? {}))).toBe(false);
    expect((await exportWorld(db, 'mismo-mundo'))!.events.filter((e) => String((e.payload['master'] as { context?: string } | null)?.context ?? '').startsWith('CONTEXTO-')).length).toBe(30);
  });

  it('una partida jugada en la base arranca igual que seguía, y numera donde iba', async () => {
    const { engine: live, time } = await play(new PgRepository(db, 'jugada-en-pg'), 25);
    expect(live.events.lastSeq).toBeGreaterThan(25);
    const again = await Engine.boot({ repo: new PgRepository(db, 'jugada-en-pg'), campaignId: 'demo', now: time.now, deterministic: false });
    for (const c of live.world.characters.values()) c.connected = false;
    expect(bootState(again)).toEqual(bootState(live));
    again.attachMaster(bulkyMaster());
    expect((await again.act('ch_kael', 'miro alrededor')).event!.seq).toBe(live.events.lastSeq + 1);
    // Y las partidas no se mezclan: otra clave, otro mundo.
    expect(await new PgRepository(db, 'otra').loadSnapshot('demo')).toBeNull();
  });

  it('cada guardado es una transacción con solo lo que cambió', async () => {
    const statements: { sql: string; rows: number }[] = [];
    const spy: Db = {
      ...db, kind: db.kind, close: () => db.close(),
      query: (sql, params) => db.query(sql, params),
      tx: (fn) => db.tx((q) => fn({
        query: (sql, params) => {
          const json = params?.[1];
          statements.push({ sql, rows: typeof json === 'string' && json.startsWith('[') ? (JSON.parse(json) as unknown[]).length : 0 });
          return q.query(sql, params);
        },
      })),
    };
    const time = fakeTime();
    const engine = await Engine.boot({ repo: new PgRepository(spy, 'lotes'), campaignId: 'demo', seed: makeSeed(), now: time.now, deterministic: false });
    await engine.flush();
    const whole = statements.filter((s) => s.sql.includes('insert into world_entities')).reduce((n, s) => n + s.rows, 0);
    statements.length = 0;
    await engine.act('ch_kael', 'soltar daga');
    await engine.flush();
    const upserts = statements.filter((s) => s.sql.includes('insert into world_entities'));
    expect(upserts.length).toBeGreaterThanOrEqual(1);
    const changed = upserts.reduce((n, s) => n + s.rows, 0);
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(whole / 10);
    const doc = await db.query<{ doc: { location: unknown } }>(`select doc from world_entities where world_id = 'lotes' and collection = 'item_instances' and id = 'ii_kael_daga'`);
    expect(doc[0]!.doc.location).toEqual({ type: 'spot', id: 'sp_tab_barra' });
  });

  it('un cambio en la campaña reescribe solo las claves que cambiaron', async () => {
    const repo = new PgRepository(db, 'campana');
    const seed = makeSeed();
    await repo.saveSnapshot(seed);
    const versions = async () => new Map((await db.query<{ id: string; xmin: string }>(
      `select id, xmin::text as xmin from world_entities where world_id = 'campana' and collection = '_campaign'`)).map((r) => [r.id, r.xmin]));
    const before = await versions();
    expect(before.size).toBe(Object.keys(seed.campaign).length);
    const changed = { ...seed.campaign, name: 'Otra campaña' };
    await repo.write('demo', [{ collection: 'campaign', id: seed.campaign.id, doc: changed }]);
    const after = await versions();
    const rewritten = [...after].filter(([k, x]) => before.get(k) !== x).map(([k]) => k);
    expect(rewritten).toEqual(['name']);
    // Y se carga entera, con sus claves.
    expect((await repo.loadSnapshot('demo'))!.campaign).toEqual(JSON.parse(JSON.stringify(changed)));
    // Una clave que desaparece se borra; también desde otro repositorio que acaba de cargar el mundo.
    const { name: _n, ...without } = changed;
    void _n;
    const r2 = new PgRepository(db, 'campana');
    await r2.loadSnapshot('demo');
    await r2.write('demo', [{ collection: 'campaign', id: seed.campaign.id, doc: without }]);
    expect('name' in (await r2.loadSnapshot('demo'))!.campaign).toBe(false);
  });

  it('las bajas se borran, el orden de las entidades se conserva y una transacción fallida no deja nada', async () => {
    const repo = new PgRepository(db, 'bajas');
    const seed = makeSeed();
    await repo.saveSnapshot(seed);
    const npcs = seed.npcs.map((n) => n.id);
    const gone = npcs[0]!;
    await repo.write('demo', [{ collection: 'npcs', id: gone, doc: null }, { collection: 'npcs', id: 'npc_nuevo', doc: { ...seed.npcs[1]!, id: 'npc_nuevo' } }]);
    const snap = (await repo.loadSnapshot('demo'))!;
    expect(snap.npcs.map((n) => n.id)).toEqual([...npcs.slice(1), 'npc_nuevo']);
    expect(snap.vehicles).toEqual(seed.vehicles);
    // Un documento que la base no admite (una clave con el carácter nulo) tumba el lote entero: la baja que iba
    // antes en la misma transacción tampoco se hace.
    const bad = repo.write('demo', [{ collection: 'npcs', id: npcs[2]!, doc: null }, { collection: 'npcs', id: npcs[1]!, doc: { ...seed.npcs[1]!, ['a b']: 1 } }]);
    await expect(bad).rejects.toThrow();
    expect((await repo.loadSnapshot('demo'))!.npcs.map((n) => n.id)).toContain(npcs[2]);
    // Lo que no se puede pasar a JSON se rechaza como promesa, no al llamar (el motor no lo espera).
    await expect(repo.write('demo', [{ collection: 'npcs', id: 'x', doc: 1n as unknown }])).rejects.toThrow();
    // El carácter nulo, que JSONB no admite, se cambia en vez de perder el guardado.
    await repo.write('demo', [{ collection: 'npcs', id: npcs[1]!, doc: { ...seed.npcs[1]!, name: 'Con\0nulo' } }]);
    expect((await repo.loadSnapshot('demo'))!.npcs.find((n) => n.id === npcs[1])!.name).toBe('Con�nulo');
  });
});

/** Nunca la API real: el cliente offline (y «record» graba lo que responde). */
const noApi: MasterFactory = (engine, game, paths, rng) => {
  const client = game.mode === 'record' ? recordClient(offlineClient(), paths.cache) : offlineClient();
  return new Master(engine, { client, ...(rng ? { rng } : {}) });
};

describe('WORLD_STORE=pg en el gestor de partidas', () => {
  it('lee la variable', () => {
    expect(worldStoreFromEnv({})).toBe('json');
    expect(worldStoreFromEnv({ WORLD_STORE: 'pg' })).toBe('pg');
    expect(() => worldStoreFromEnv({ WORLD_STORE: 'sqlite' })).toThrow(/WORLD_STORE/);
  });

  it('crea, graba, convierte en demo, reinicia y borra con el mundo en la base', async () => {
    const dir = await tmp();
    const games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
    games.useWorldStore(new PgWorldStore(db, () => {}));
    try {
      const { game, character_id } = await games.create({ name: 'Grabación en la base', mode: 'record', character: { name: 'Rhea' } });
      const engine = await games.open(game.slug);
      await engine.act(character_id!, 'me acerco a la barra');
      const played = engine.events.lastSeq;
      // Nada en la carpeta de datos: el mundo está en la base, y la foto de arranque también.
      const p = games.paths(game);
      expect(await stat(join(p.data, `${game.campaign_id}.world.json`)).then(() => true, () => false)).toBe(false);
      const keys = (await db.query<{ world_id: string }>(`select distinct world_id from world_entities where world_id like $1 order by world_id`, [`${game.slug}%`])).map((r) => r.world_id);
      expect(keys).toEqual([game.slug, `${game.slug}/initial`]);
      const info = await games.info(game);
      expect(info.characters).toContain('Rhea');

      await games.convertToDemo(game.slug);
      const replay = await games.open(game.slug);
      expect(replay.world.characters.has(character_id!)).toBe(true);
      expect(replay.events.lastSeq).toBeLessThan(played);
      expect((await exportWorld(db, `${game.slug}/recorded`))!.events.at(-1)!.seq).toBe(played);

      await replay.act(character_id!, 'me acerco a la barra');
      await games.resetDemo(game.slug);
      expect((await games.open(game.slug)).events.lastSeq).toBeLessThan(played);

      await games.delete(game.slug);
      expect(await db.query(`select 1 from world_entities where world_id = $1 or world_id like $2`, [game.slug, `${game.slug}/%`])).toEqual([]);
    } finally { await games.closeAll(); }
  });

  it('una partida de antes (en su carpeta) pasa a la base al abrirla, sin tocar sus ficheros', async () => {
    const dir = await tmp();
    const root = join(dir, 'games');
    const before = new GameManager({ root, env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
    const { game, character_id } = await before.create({ name: 'De antes', mode: 'offline', character: { name: 'Odo' } });
    await (await before.open(game.slug)).act(character_id!, 'me acerco a la barra');
    const seq = (await before.open(game.slug)).events.lastSeq;
    await before.closeAll();
    const p = before.paths(game);
    const mtime = (await stat(join(p.data, `${game.campaign_id}.world.json`))).mtimeMs;

    const after = new GameManager({ root, env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
    after.useWorldStore(new PgWorldStore(db, () => {}));
    try {
      expect((await after.info(game)).characters).toContain('Odo');
      const engine = await after.open(game.slug);
      expect(engine.events.lastSeq).toBe(seq);
      expect(engine.world.characters.has(character_id!)).toBe(true);
      await engine.act(character_id!, 'miro alrededor');
      await engine.flush();
      expect((await stat(join(p.data, `${game.campaign_id}.world.json`))).mtimeMs).toBe(mtime);
      expect((await exportWorld(db, game.slug))!.events.at(-1)!.seq).toBe(seq + 1);
    } finally { await after.closeAll(); }
  });
});

describe('paso de partidas entre JSON y la base', () => {
  it('to-pg, check y to-json: la vuelta da el mismo mundo, sin tocar el origen', async () => {
    const dir = await tmp();
    await play(new JsonFileRepository(join(dir, 'origen')), 12);
    // El origen en el formato de antes (contexto dentro de cada evento): así se prueba también la conversión.
    const w = readJsonWorld(join(dir, 'origen'), 'demo')!;
    const legacy = join(dir, 'antes');
    await cp(join(dir, 'origen'), legacy, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(legacy, 'demo.events.jsonl'), w.events.map((e) => JSON.stringify(e) + '\n').join(''));
    await rm(join(legacy, 'demo.context.jsonl'));
    const before = await stat(join(legacy, 'demo.events.jsonl'));

    const url = `pglite:${join(dir, 'pgdata')}`;
    const out: string[] = [];
    const log = (m: string) => out.push(m);
    expect(await worldStoreCommand(['to-pg', legacy, '--key', 'mi-partida', '--db', url], {}, log)).toBe(0);
    expect(out.join('\n')).toMatch(/el mismo mundo en los ficheros y en la base/);
    expect(await worldStoreCommand(['to-json', 'mi-partida', join(dir, 'vuelta'), '--db', url], {}, log)).toBe(0);
    // No pisa una carpeta con mundo sin --force.
    expect(await worldStoreCommand(['to-json', 'mi-partida', legacy, '--db', url], {}, log)).toBe(1);

    expect((await stat(join(legacy, 'demo.events.jsonl'))).mtimeMs).toBe(before.mtimeMs);
    const back = readJsonWorld(join(dir, 'vuelta'), 'demo')!;
    expect(compareWorlds(w, back)).toEqual([]);
    // Y la vuelta arranca.
    const e = await Engine.boot({ repo: new JsonFileRepository(join(dir, 'vuelta')), campaignId: 'demo', now: fakeTime().now, deterministic: false });
    expect(e.events.lastSeq).toBe(w.events.at(-1)!.seq);
  });

  it('writeJsonWorld y readJsonWorld se entienden', async () => {
    const dir = await tmp();
    await play(new JsonFileRepository(join(dir, 'a')), 6);
    const w = readJsonWorld(join(dir, 'a'), 'demo')!;
    await writeJsonWorld(join(dir, 'b'), w);
    expect(compareWorlds(w, readJsonWorld(join(dir, 'b'), 'demo')!)).toEqual([]);
  });
});
