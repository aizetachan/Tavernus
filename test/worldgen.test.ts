import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine.js';
import { moveTo, settleTransit } from '../src/engine/movement.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { buildSkeleton, claimSituation, generateSeed, offlineFill, TONES, validateFill, type FillClient, type WorldFill } from '../src/worldgen/index.js';
import { SETTLEMENTS } from '../src/worldgen/catalog.js';
import { SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import { fillWorld, fillSchema } from '../src/worldgen/fill.js';
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

  function fake(replies: WorldFill[]): FillClient & { calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
    const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    return {
      calls,
      async create(p) {
        calls.push(structuredClone(p));
        const f = replies[calls.length - 1]!;
        return {
          id: `m${calls.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
          content: [{ type: 'text', text: JSON.stringify(f), citations: null }],
          usage: { input_tokens: 5000, output_tokens: 8000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        } as unknown as Anthropic.Beta.BetaMessage;
      },
    };
  }

  it('salida estructurada con esquema estricto, sin prefill; reintenta una vez con los errores', async () => {
    const bad = offlineFill(sk, pcs);
    bad.npcs[1]!.name = bad.npcs[0]!.name;
    const client = fake([bad, offlineFill(sk, pcs)]);
    const r = await fillWorld(sk, pcs, { client, model: 'claude-sonnet-5-5' });
    expect(r.attempts).toBe(2);
    expect(r.usage).toEqual({ input: 10000, output: 16000 });
    expect(r.cost_usd).toBeCloseTo(2 * (5000 * 2 + 8000 * 10) / 1e6, 6);
    const [first, second] = client.calls;
    expect(first!.output_config?.format).toEqual({ type: 'json_schema', schema: fillSchema(sk) });
    expect(first!.messages.at(-1)!.role).toBe('user');
    expect(second!.messages.at(-1)!.role).toBe('user');
    expect(String(second!.messages.at(-1)!.content)).toMatch(/repetido/);
  });

  it('se rinde si tras corregir sigue mal', async () => {
    const bad = offlineFill(sk, pcs);
    bad.situations = [];
    await expect(fillWorld(sk, pcs, { client: fake([bad, bad]) })).rejects.toThrow(/no valida/);
  });

  it('el esquema es estricto: todo objeto cierra propiedades y las exige todas', () => {
    const walk = (s: unknown): void => {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (o['type'] === 'object') {
        expect(o['additionalProperties']).toBe(false);
        expect([...(o['required'] as string[])].sort()).toEqual(Object.keys(o['properties'] as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    walk(fillSchema(sk));
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
    expect(info.world).toEqual({ seed: 31337, tone: 'horror' });
    // Al reabrir arranca de lo guardado, no de la demo.
    await games.close(game.slug);
    const again = await games.open(game.slug);
    expect(again.world.campaign.id).toBe(game.campaign_id);
    expect(again.world.character(character_id!).situation).toEqual(c.situation);
    const saved = JSON.parse(await readFile(join(games.paths(game).dir, 'world.seed.json'), 'utf8'));
    expect(saved.campaign.generation.seed).toBe(31337);
  });

  it('valida la semilla y el tono', async () => {
    await expect(games.create({ name: 'X', mode: 'offline', world: { seed: -1 } })).rejects.toThrow(/semilla/);
    await expect(games.create({ name: 'X', mode: 'offline', world: { tone: 'kawaii' } })).rejects.toThrow(/Tono/);
  });
});
