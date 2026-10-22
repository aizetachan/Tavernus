import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine.js';
import { moveTo, settleTransit } from '../src/engine/movement.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameError, GameManager, type MasterFactory } from '../src/games/manager.js';
import { createWebServer } from '../src/adapters/web/server.js';
import { buildSkeleton, buildSnapshot, claimSituation, generateSeed, offlineFill, TONES, validateFill, type FillClient, type WorldFill } from '../src/worldgen/index.js';
import { SETTLEMENTS } from '../src/worldgen/catalog.js';
import { SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import { assembleFill, extractJson, fillWorld, MAX_PART_SCHEMA_CHARS, PART_SCHEMAS, schemaChars, splitFill, TRADE_ITEMS, type PeoplePart } from '../src/worldgen/fill.js';
import { generateMap, mapInputOf } from '../src/adapters/web/mapgen.js';
import { fakeTime } from './helpers.js';

const IN = { tone: 'grim' as const, setting: 'Fantasía medieval de baja magia.' };
const EPOCH = () => new Date(SEED_REAL_EPOCH_MS);
const SETTINGS = ['', 'Fantasía oscura', 'Ciencia ficción de frontera', 'Postapocalíptico'];

describe('esqueleto', () => {
  it('misma semilla, mismo esqueleto; distinta semilla, distinto', () => {
    const a = buildSkeleton({ seed: 42, ...IN });
    expect(JSON.stringify(buildSkeleton({ seed: 42, ...IN }))).toBe(JSON.stringify(a));
    expect(JSON.stringify(buildSkeleton({ seed: 43, ...IN }))).not.toBe(JSON.stringify(a));
  });

  it('cada asentamiento respeta su tipo: lugares fijos, cantidades en rango, dos exteriores y todo conectado', () => {
    for (let seed = 0; seed < 60; seed++) {
      const tone = TONES[seed % TONES.length]!;
      const sk = buildSkeleton({ seed, tone, setting: SETTINGS[seed % SETTINGS.length]! });
      const def = SETTLEMENTS[sk.settlement.type];
      expect(def.genre).toBe(sk.genre);
      const town = sk.locations.filter((l) => l.zone_id === 'zn_town');
      expect(town.length).toBeGreaterThanOrEqual(def.places[0]);
      expect(town.length).toBeLessThanOrEqual(def.places[1]);
      for (const k of def.required) expect(town.some((l) => l.kind === k)).toBe(true);
      expect(sk.locations.filter((l) => l.zone_id === 'zn_wild')).toHaveLength(2);
      const people = sk.npcs.filter((n) => n.role !== 'beast');
      expect(people.length).toBeGreaterThanOrEqual(def.npcs[0]);
      expect(people.length).toBeLessThanOrEqual(def.npcs[1]);
      for (const r of def.roles_required) expect(people.some((n) => n.role === r)).toBe(true);
      expect(sk.clue_count).toBeGreaterThanOrEqual(3);
      expect(sk.clue_count).toBeLessThanOrEqual(5);
      expect(sk.jobs.length).toBeGreaterThanOrEqual(2);
      expect(sk.jobs.length).toBeLessThanOrEqual(3);
      for (const l of sk.locations) for (const s of l.spots) expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
      // Grafo de localizaciones por salidas: conexo.
      const locOf = new Map(sk.locations.flatMap((l) => l.spots.map((s) => [s.id, l.id] as const)));
      const seen = new Set([sk.locations[0]!.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const e of sk.exits) {
          const [a, b] = [locOf.get(e.from_spot_id)!, locOf.get(e.to_spot_id)!];
          if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; }
        }
      }
      expect(seen.size).toBe(sk.locations.length);
      expect(validateFill(sk, offlineFill(sk, [{ name: 'Ana' }]), [{ name: 'Ana' }])).toEqual([]);
    }
  });

  it('diez semillas seguidas: al menos cuatro tipos de asentamiento y tres lugares de inicio distintos', () => {
    for (const tone of TONES) {
      const types = new Set<string>(), starts = new Set<string>();
      for (let seed = 100; seed < 110; seed++) {
        const sk = buildSkeleton({ seed, tone, setting: '' });
        types.add(sk.settlement.type);
        const s = offlineFill(sk, [{ name: 'Ana' }]).situations[0]!;
        starts.add(sk.locations.find((l) => l.spots.some((p) => p.id === s.start_spot_id))!.kind);
      }
      expect(types.size, `tono ${tone}: ${[...types].join(', ')}`).toBeGreaterThanOrEqual(4);
      expect(starts.size, `tono ${tone}: ${[...starts].join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('ninguna semilla repite la demo (posada + plaza + bosque) y la posada es una opción, no la base', () => {
    let withInn = 0;
    for (let seed = 0; seed < 200; seed++) {
      const sk = buildSkeleton({ seed, tone: TONES[seed % TONES.length]!, setting: '' });
      const kinds = sk.locations.map((l) => l.kind).sort().join(',');
      expect(kinds).not.toBe('forest,inn,square');
      if (sk.locations.some((l) => l.kind === 'inn')) withInn++;
    }
    expect(withInn).toBeLessThan(100);
  });

  it('la ambientación elige el género: ciencia ficción y postapocalíptico tienen sus propios lugares', () => {
    const sf = buildSkeleton({ seed: 5, tone: 'pulp', setting: 'Ciencia ficción: una luna minera al borde de la galaxia' });
    expect(sf.genre).toBe('scifi');
    expect(['space_port', 'mining_station']).toContain(sf.settlement.type);
    const pa = buildSkeleton({ seed: 5, tone: 'grim', setting: 'Postapocalíptico, cuarenta años después de la guerra' });
    expect(pa.genre).toBe('postapoc');
    expect(pa.locations.some((l) => ['shelter', 'scrap_market', 'barricade', 'garage'].includes(l.kind))).toBe(true);
  });
});

describe('validador', () => {
  const sk = buildSkeleton({ seed: 7, ...IN });
  const pcs = [{ name: 'Ana' }];
  const ok = () => offlineFill(sk, pcs);

  it('el relleno offline es válido', () => {
    expect(validateFill(sk, ok(), pcs)).toEqual([]);
  });

  it('rechaza ids inexistentes', () => {
    const f = ok();
    f.situations[0]!.antagonist_npc_id = 'npc_nadie';
    f.clues[0]!.location_ids = ['loc_atlantida'];
    f.jobs[0]!.giver_npc_id = 'npc_fantasma';
    const errs = validateFill(sk, f, pcs).join('\n');
    expect(errs).toMatch(/npc_nadie/);
    expect(errs).toMatch(/loc_atlantida/);
    expect(errs).toMatch(/npc_fantasma/);
  });

  it('rechaza nombres repetidos', () => {
    const f = ok();
    f.npcs[1]!.name = f.npcs[0]!.name;
    f.locations[1]!.name = f.locations[0]!.name.toUpperCase();
    const errs = validateFill(sk, f, pcs).join('\n');
    expect(errs).toMatch(/NPC: el nombre .* está repetido/);
    expect(errs).toMatch(/localizaciones: el nombre .* está repetido/);
  });

  it('rechaza precios no positivos, situaciones sin tres caminos y PJ sin situación', () => {
    const f = ok();
    f.trade[0]!.price = 0;
    f.situations[0]!.paths = ['solo uno'];
    expect(validateFill(sk, f, pcs).join('\n')).toMatch(/entero positivo[\s\S]*tres caminos/);
    expect(validateFill(sk, ok(), [{ name: 'Ana' }, { name: 'Bruno' }]).join('\n')).toMatch(/«Bruno»/);
  });
});

describe('relleno con la API (cliente falso)', () => {
  const sk = buildSkeleton({ seed: 11, ...IN });
  const pcs = [{ name: 'Ana' }];
  const parts = () => splitFill(offlineFill(sk, pcs));

  /** Responde en orden: un objeto es la respuesta JSON; un Error, el fallo de la API. */
  function fake(replies: (object | Error)[]): FillClient & { calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
    const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    return {
      calls,
      async create(p) {
        calls.push(structuredClone(p));
        const r = replies[calls.length - 1]!;
        if (r instanceof Error) throw r;
        return {
          id: `m${calls.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(r), citations: null }],
          usage: { input_tokens: 2000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        } as unknown as Anthropic.Beta.BetaMessage;
      },
    };
  }
  const grammarError = () => Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"The compiled grammar is too large, which would cause performance issues."}}'), { status: 400 });

  it('tres partes, cada una con su esquema estricto pequeño y sin prefill; reintenta solo la parte que falla', async () => {
    const { world, people, situations } = parts();
    const bad = structuredClone(people);
    bad.npcs[1]!.name = bad.npcs[0]!.name;
    const client = fake([world, bad, people, situations]);
    const r = await fillWorld(sk, pcs, { client, model: 'claude-sonnet-5-5' });
    expect(r.attempts).toBe(4);
    expect(r.usage).toEqual({ input: 8000, output: 12000 });
    expect(r.cost_usd).toBeCloseTo((8000 * 2 + 12000 * 10) / 1e6, 6);
    expect(client.calls.map((c) => c.output_config?.format)).toEqual([
      { type: 'json_schema', schema: PART_SCHEMAS.world }, { type: 'json_schema', schema: PART_SCHEMAS.people },
      { type: 'json_schema', schema: PART_SCHEMAS.people }, { type: 'json_schema', schema: PART_SCHEMAS.situations },
    ]);
    for (const c of client.calls) expect(c.messages.at(-1)!.role).toBe('user');
    expect(String(client.calls[2]!.messages.at(-1)!.content)).toMatch(/repetido/);
    // La gente lee el mundo ya escrito; las situaciones, el mundo y la gente.
    expect(String(client.calls[1]!.messages[0]!.content)).toContain(world.town_name);
    expect(String(client.calls[3]!.messages[0]!.content)).toContain(people.npcs[0]!.name);
    expect(validateFill(sk, r.fill, pcs)).toEqual([]);
  });

  it('cada esquema cabe con margen en lo que hoy acepta la API, y todos son estrictos', () => {
    const walk = (s: unknown): void => {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (o['type'] === 'object') {
        expect(o['additionalProperties']).toBe(false);
        expect([...(o['required'] as string[])].sort()).toEqual(Object.keys(o['properties'] as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    for (const [name, schema] of Object.entries(PART_SCHEMAS)) {
      walk(schema);
      expect(schemaChars(schema), name).toBeLessThanOrEqual(MAX_PART_SCHEMA_CHARS);
    }
  });

  it('el código pone ids de encargos, precios en banda, actitudes y horas sin preguntar al modelo', async () => {
    const { world, people, situations } = parts();
    const loose = structuredClone(people) as PeoplePart & { jobs: { id?: string }[] };
    for (const j of loose.jobs) delete j.id;
    loose.trade[0]!.price = 999999;
    loose.trade[0]!.buys_or_sells = 'compra';
    loose.npcs[0]!.attitude = 'amistosa';
    const sits = structuredClone(situations);
    sits.situations[0]!.start_hour = 77;
    const r = await fillWorld(sk, pcs, { client: fake([world, loose, sits]) });
    expect(r.attempts).toBe(3);
    expect(r.fill.jobs.map((j) => j.id)).toEqual(sk.jobs.map((j) => j.id));
    expect(r.fill.trade[0]!.price).toBeLessThanOrEqual(TRADE_ITEMS.find((d) => d.id === r.fill.trade[0]!.item_id)!.value * 3);
    expect(r.fill.trade[0]!.buys_or_sells).toBe('buys');
    expect(r.fill.npcs[0]!.attitude).toMatch(/neutral|hostile/);
    expect(r.fill.situations[0]!.start_hour).toBeGreaterThanOrEqual(0);
    expect(r.fill.situations[0]!.start_hour).toBeLessThanOrEqual(23);
  });

  it('si una parte no cabe como gramática, la pide como JSON sin gramática y la valida igual', async () => {
    const { world, people, situations } = parts();
    const logs: string[] = [];
    const client = fake([world, grammarError(), people, situations]);
    const r = await fillWorld(sk, pcs, { client, log: (m) => logs.push(m) });
    expect(r.unstrict).toEqual(['people']);
    expect(client.calls[2]!.output_config?.format).toBeUndefined();
    expect(String(client.calls[2]!.system)).toContain('JSON Schema');
    expect(logs.join(' ')).toMatch(/no cabe/);
    expect(validateFill(sk, r.fill, pcs)).toEqual([]);
  });

  it('MASTER_MODEL=Haiku no cambia el modelo de los mundos (WORLDGEN_MODEL o Sonnet); sin clave sale de plantilla y lo dice', async () => {
    const { world, people, situations } = parts();
    const client = fake([world, people, situations]);
    await generateSeed({ seed: 11, ...IN, characters: pcs, client, env: { MASTER_MODEL: 'claude-haiku-5-5', ANTHROPIC_API_KEY: 'x' }, now: EPOCH });
    expect(client.calls.map((c) => c.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
    const c2 = fake([world, people, situations]);
    await generateSeed({ seed: 11, ...IN, characters: pcs, client: c2, env: { WORLDGEN_MODEL: 'claude-opus-5-5' }, now: EPOCH });
    expect(c2.calls[0]!.model).toBe('claude-opus-5-5');
    const logs: string[] = [];
    const snap = await generateSeed({ seed: 11, ...IN, characters: pcs, env: { MASTER_MODE: 'live', MASTER_MODEL: 'claude-haiku-5-5' }, log: (m) => logs.push(m), now: EPOCH });
    expect(snap.campaign.generation?.model).toBe('offline');
    expect(logs.join(' ')).toMatch(/sin clave de API/);
  });

  it('el JSON sin gramática se lee aunque venga entre ```json y con texto alrededor', () => {
    expect(extractJson('Aquí va:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('se rinde si tras corregir sigue mal', async () => {
    const { world, people } = parts();
    const bad = { situations: [] };
    await expect(fillWorld(sk, pcs, { client: fake([world, people, bad, bad]) })).rejects.toThrow(/no valida/);
  });

  it('juntar las tres partes da el mismo mundo que el relleno entero', () => {
    const f = offlineFill(sk, pcs);
    const p = splitFill(f);
    const gen = { seed: 11, tone: 'grim' as const, setting: '', model: 'offline', generated_at: new Date(SEED_REAL_EPOCH_MS).toISOString(), attempts: 0, usage: { input: 0, output: 0 }, cost_usd: 0, skeleton_version: sk.version };
    expect(buildSnapshot(sk, assembleFill(p.world, p.people, p.situations), gen)).toEqual(buildSnapshot(sk, f, gen));
  });
});

describe('mundo generado en el motor', () => {
  it('arranca offline y un PJ recorre todas las localizaciones', async () => {
    const seed = await generateSeed({ seed: 2024, ...IN, client: null, now: EPOCH, characters: [{ name: 'Ana' }] });
    expect(seed.campaign.bible!.length).toBeGreaterThanOrEqual(5);
    expect(seed.campaign.laws!.length).toBeGreaterThanOrEqual(3);
    expect(seed.campaign.generation).toMatchObject({ seed: 2024, model: 'offline', attempts: 0 });
    const time = fakeTime();
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: time.now, deterministic: false });
    const r = await engine.createCharacter('u1', 'Ana');
    if (!r.ok) throw new Error(r.reason);
    const c = engine.world.character(r.character.id);
    for (const loc of engine.world.locations.values()) {
      if (c.location.id === loc.default_spot_id) continue;
      const m = moveTo(engine.world, c.id, loc.default_spot_id, 'run', engine.gameNow());
      expect(m.ok, `ir a ${loc.name}`).toBe(true);
      if (!m.ok) continue;
      time.advanceGame(m.total_s + 1);
      settleTransit(engine.world, c, engine.gameNow());
      expect(engine.world.characterSpot(c)!.location_id).toBe(loc.id);
    }
    // Y cada localización sale dibujada sola en el tablero (plano generado de sus puntos y tags).
    for (const loc of engine.world.locations.values()) expect(generateMap(mapInputOf(engine.world, loc.id)).areas.length).toBeGreaterThan(0);
  });

  it('dos semillas dan mundos distintos', async () => {
    const a = await generateSeed({ seed: 1, ...IN, client: null });
    const b = await generateSeed({ seed: 2, ...IN, client: null });
    expect(a.campaign.id).not.toBe(b.campaign.id);
    expect(JSON.stringify(a.spots.map((s) => [s.x, s.y]))).not.toBe(JSON.stringify(b.spots.map((s) => [s.x, s.y])));
  });

  it('la situación inicial llega al personaje y a la primera escena del máster', async () => {
    const seed = await generateSeed({ seed: 77, ...IN, client: null, now: EPOCH, characters: [{ name: 'Ana' }] });
    const time = fakeTime();
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: time.now, deterministic: false });
    const contexts: string[] = [];
    const off = offlineClient();
    engine.attachMaster(new Master(engine, { client: { create: (p) => { contexts.push(String(p.messages[0]!.content)); return off.create(p); } } }));
    const r = await engine.createCharacter('u1', 'Ana');
    if (!r.ok) throw new Error(r.reason);
    const s = claimSituation(engine.world, r.character.id, engine.gameNow());
    const c = engine.world.character(r.character.id);
    expect(s).not.toBeNull();
    expect(c.situation).toEqual(s);
    expect(c.situation!.deadline_game_s).toBe(engine.gameNow() + c.situation!.clock_days * 86400);
    expect(c.location).toEqual({ type: 'spot', id: s!.start_spot_id });
    // El mundo nace a la hora de su situación.
    expect(Math.floor((engine.gameNow() % 86400) / 3600)).toBe(s!.start_hour);
    expect(c.knows).toContain(s!.antagonist_npc_id);
    expect(c.backstory).toContain(s!.why_here);
    // La de Ana sale de la bolsa; quedan las de reserva.
    expect(engine.world.campaign.situations!.every((x) => x.for_name === '')).toBe(true);
    const intro = await engine.introduce(c.id);
    expect(intro?.ok).toBe(true);
    expect(contexts.at(-1)).toContain(s!.why_here);
    // Otro PJ sin nombre previsto: una de reserva.
    const r2 = await engine.createCharacter('u2', 'Bruno');
    if (!r2.ok) throw new Error(r2.reason);
    expect(claimSituation(engine.world, r2.character.id, engine.gameNow())?.why_here).toBeTruthy();
  });
});

describe('menú: nueva partida en un mundo generado', () => {
  let dir: string;
  let games: GameManager;
  const noApi: MasterFactory = (engine, _g, _p, rng) => new Master(engine, { client: offlineClient(), ...(rng ? { rng } : {}) });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-worldgen-'));
    games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
  });
  afterEach(async () => { await games.closeAll(); await rm(dir, { recursive: true, force: true }); });

  it('crea la partida con su mundo guardado, Biblia y leyes, y el PJ con su situación', async () => {
    const { game, character_id } = await games.create({
      name: 'Prueba', mode: 'offline', character: { name: 'Ana', class_id: 'rogue', hook: 'Busca a su hermano.' }, world: { seed: '31337', tone: 'horror', setting: '' },
    });
    expect(game.world).toMatchObject({ seed: 31337, tone: 'horror', model: 'offline' });
    expect(game.campaign_id).toBe('w' + (31337).toString(36));
    const engine = await games.open(game.slug);
    expect(engine.world.campaign.bible!.length).toBeGreaterThan(0);
    const c = engine.world.character(character_id!);
    expect(c.situation?.start_spot_id).toBe(c.location.id);
    expect(c.backstory).toMatch(/^Busca a su hermano\./);
    const info = (await games.list())[0]!;
    expect(info.world).toEqual({ seed: 31337, tone: 'horror', template: true });
    // Al reabrir arranca de lo guardado, no de la demo.
    await games.close(game.slug);
    const again = await games.open(game.slug);
    expect(again.world.campaign.id).toBe(game.campaign_id);
    expect(again.world.character(character_id!).situation).toEqual(c.situation);
    const saved = JSON.parse(await readFile(join(games.paths(game).dir, 'world.seed.json'), 'utf8'));
    expect(saved.campaign.generation.seed).toBe(31337);
  });

  it('si la generación falla: 502 con la causa corta, en el gestor y por HTTP, y sin carpeta a medias', async () => {
    const failing = new GameManager({
      root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {},
      worldgen: async () => { throw Object.assign(new Error('400 The compiled grammar is too large, which would cause performance issues.'), { status: 400 }); },
    });
    const err = await failing.create({ name: 'Rota', mode: 'live', world: { tone: 'grim' } }).catch((e: unknown) => e as GameError);
    expect(err).toBeInstanceOf(GameError);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/^No se pudo generar el mundo: el esquema es demasiado grande/);
    expect(await readdir(join(dir, 'games')).catch(() => [])).not.toContain('rota');
    const web = createWebServer(failing, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    try {
      const r = await fetch(`http://127.0.0.1:${(web.server.address() as AddressInfo).port}/api/games`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rota', mode: 'live', world: { tone: 'grim' } }),
      });
      expect(r.status).toBe(502);
      expect(await r.json()).toMatchObject({ ok: false, text: expect.stringMatching(/^No se pudo generar el mundo/) });
    } finally {
      await web.stop();
      await failing.closeAll();
    }
  });

  it('valida la semilla y el tono', async () => {
    await expect(games.create({ name: 'X', mode: 'offline', world: { seed: -1 } })).rejects.toThrow(/semilla/);
    await expect(games.create({ name: 'X', mode: 'offline', world: { tone: 'kawaii' } })).rejects.toThrow(/Tono/);
  });
});
