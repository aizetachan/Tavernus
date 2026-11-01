import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameManager } from '../src/games/manager.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import type { AccessOptions } from '../src/adapters/web/access.js';
import { previewCharacter, resolveCharacterSpec, type CharacterPreview } from '../src/engine/chargen.js';
import type { CharacterSpec } from '../src/engine/engine.js';
import { armorClass, type Ability } from '../src/engine/rules.js';
import { BACKGROUNDS, CLASSES, RACES } from '../src/data/srd/index.js';
import { CATALOG } from '../src/worldgen/fill.js';
import { bootEngine } from './helpers.js';

const ABILITIES: Record<Ability, number> = { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 };
const ROGUE = { race: 'elf', class: 'rogue', background: 'criminal', abilities: ABILITIES, skills: ['acrobatics', 'athletics', 'insight', 'investigation'], death_mode: 'hardcore' };
const ROGUE_SPEC: CharacterSpec = { race_id: 'elf', class_id: 'rogue', background_id: 'criminal', abilities: ABILITIES, skills: ROGUE.skills, death_mode: 'hardcore' };

describe('validación de lo elegido (chargen)', () => {
  it('toda combinación de raza, clase y trasfondo deja habilidades de clase que elegir', () => {
    for (const r of RACES) for (const k of CLASSES) for (const b of BACKGROUNDS) {
      const check = resolveCharacterSpec({ race_id: r.id, class_id: k.id, background_id: b.id });
      expect(check.ok, `${r.id} ${k.id} ${b.id}`).toBe(true);
    }
  });

  it('nombra el paso de cada combinación inválida', () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ race_id: 'orco' }, 'race', 'no válidos'],
      [{ class_id: 'nigromante' }, 'class', 'no válidos'],
      [{ background_id: 'pirata' }, 'background', 'no válidos'],
      [{ abilities: { ...ABILITIES, str: 15 } }, 'abilities', 'array estándar'],
      // Texto que ordena como el array: «15» + 1 sería «151».
      [{ abilities: { str: '8', dex: '15', con: '13', int: '12', wis: '10', cha: '14' } }, 'abilities', 'array estándar'],
      [{ abilities: [15, 14, 13, 12, 10, 8] }, 'abilities', 'array estándar'],
      [{ abilities: 'todo a 18' }, 'abilities', 'array estándar'],
      [{ class_id: 'fighter', background_id: 'soldier', skills: ['survival'] }, 'skills', 'Elige 2'],
      [{ class_id: 'fighter', background_id: 'soldier', skills: 'survival' }, 'skills', 'Elige 2'],
      // Repetidas: sin esto, dos «survival» valían por dos y el PJ se quedaba con una.
      [{ class_id: 'fighter', background_id: 'soldier', skills: ['survival', 'survival'] }, 'skills', 'No repitas'],
      [{ class_id: 'fighter', background_id: 'soldier', skills: ['survival', 'arcana'] }, 'skills', 'no es una habilidad'],
      [{ class_id: 'fighter', background_id: 'soldier', skills: ['survival', 'athletics'] }, 'skills', 'ya la tienes'],
      [{ race_id: 'elf', class_id: 'fighter', background_id: 'noble', skills: ['survival', 'perception'] }, 'skills', 'ya la tienes'],
      [{ death_mode: 'inmortal' }, 'death', 'modo de muerte'],
    ];
    for (const [spec, field, reason] of cases) {
      expect(resolveCharacterSpec(spec as Partial<CharacterSpec>), JSON.stringify(spec)).toMatchObject({ ok: false, field, reason: expect.stringContaining(reason) });
    }
    expect(previewCharacter('X', ROGUE_SPEC, CATALOG)).toMatchObject({ ok: false, field: 'name' });
  });

  it('el motor rechaza igual: no es solo cosa de la web', async () => {
    const { engine } = await bootEngine();
    expect(await engine.createCharacter('u1', 'Tam', { class_id: 'fighter', background_id: 'soldier', skills: ['survival', 'survival'] })).toMatchObject({ ok: false, reason: expect.stringContaining('No repitas') });
    expect(await engine.createCharacter('u1', 'Tam', { death_mode: 'inmortal' as 'casual' })).toMatchObject({ ok: false, reason: expect.stringContaining('modo de muerte') });
    expect(engine.characterByUser('u1')).toBeNull();
  });

  it('el resumen dice lo mismo que el personaje que se crea, en todas las clases y razas', async () => {
    const { engine } = await bootEngine();
    let n = 0;
    for (const k of CLASSES) for (const r of RACES) {
      const spec = { race_id: r.id, class_id: k.id };
      const name = `Prueba ${++n}`;
      const p = previewCharacter(name, spec, [...engine.world.itemDefs.values()]);
      if (!p.ok) throw new Error(p.reason);
      const made = await engine.createCharacter(`u${n}`, name, spec);
      if (!made.ok) throw new Error(made.reason);
      const c = made.character;
      const where = `${r.id} ${k.id}`;
      expect(p.preview.hp_max, where).toBe(c.hp_max);
      expect(p.preview.ac, where).toBe(armorClass(engine.world, c));
      expect(p.preview.speed_ft, where).toBe(c.speed_ft);
      expect(p.preview.passive_perception, where).toBe(c.passive_perception);
      expect(p.preview.saves.filter((s) => s.proficient).map((s) => s.id).sort(), where).toEqual([...c.proficiencies.saves].sort());
      expect(p.preview.skills.map((s) => s.id).sort(), where).toEqual([...c.proficiencies.skills].sort());
      // El equipo, esté donde esté (manos, mochila…).
      const has = (item: string) => {
        const inPack = [...engine.world.itemInstances.values()].filter((i) => i.item_id === item && (JSON.stringify(i.location).includes(c.id) || engine.world.itemInstances.get((i.location as { id: string }).id)?.location.id === c.id));
        return inPack.reduce((a, i) => a + i.quantity, 0);
      };
      for (const e of p.preview.equipment) {
        const def = [...engine.world.itemDefs.values()].find((d) => d.name === e.name)!;
        expect(has(def.id), `${where}: ${e.name}`).toBe(e.quantity);
      }
    }
  });
});

describe('creación por la web', () => {
  let dir: string;
  let games: GameManager;
  let web: WebServer;
  let base: string;
  let worldgens = 0;

  async function start(access?: AccessOptions) {
    games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: () => null, engine: { deterministic: false }, log: () => {},
      worldgen: async () => { worldgens++; throw new Error('no debe generar'); } });
    web = createWebServer(games, { tickMs: 3_600_000, ...(access ? { access } : {}) });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
  }
  const browser = () => {
    const jar = new Map<string, string>();
    const headers = () => ({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/json' });
    const keep = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv!.indexOf('='); jar.set(kv!.slice(0, i), kv!.slice(i + 1)); } return r; };
    return {
      get: (path: string) => fetch(base + path, { redirect: 'manual', headers: headers() }).then(keep),
      post: (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: headers(), body: JSON.stringify(body) }).then(keep),
    };
  };

  beforeEach(async () => { worldgens = 0; dir = await mkdtemp(join(tmpdir(), 'tavernus-chargen-')); });
  afterEach(async () => { await web?.stop(); await games?.closeAll(); await rm(dir, { recursive: true, force: true }); });

  it('el menú recibe el catálogo completo y dice si el personaje es opcional', async () => {
    await start();
    expect(await (await browser().get('/')).text()).toContain('tavernusChargen');
    const d = (await (await browser().get('/api/games')).json()) as { options: { races: { description: string }[]; classes: { skill_count: number; skill_from: string[]; recommended: number[]; equipment?: unknown }[]; backgrounds: { skills: string[] }[]; standard_array: number[]; skills: Record<string, string> }; character_optional: boolean };
    expect(d.options.races).toHaveLength(RACES.length);
    expect(d.options.backgrounds).toHaveLength(BACKGROUNDS.length);
    expect(d.options.classes.find((c) => c.skill_count === 4)!.skill_from).toContain('stealth');
    expect(d.options.standard_array).toEqual([15, 14, 13, 12, 10, 8]);
    expect(d.options.skills['stealth']).toBe('Sigilo');
    expect(d.options.classes[0]).not.toHaveProperty('equipment');
    expect(d.character_optional).toBe(true);
  });

  it('la vista previa calcula sin crear nada y explica qué paso falla', async () => {
    await start();
    const b = browser();
    const r = await b.post('/api/character/preview', { name: '  Tam  ', ...ROGUE });
    expect(r.status).toBe(200);
    const p = ((await r.json()) as { preview: CharacterPreview }).preview;
    // Elfo: +2 DES → 17. Cuero 11 + 3. d8 + CON 1.
    expect(p).toMatchObject({ name: 'Tam', race: 'Elfo', class_name: 'Pícaro', background: 'Criminal', death_mode: 'hardcore', hp_max: 9, ac: 14, speed_ft: 30, darkvision: true });
    expect(p.abilities.find((a) => a.id === 'dex')).toMatchObject({ total: 17, modifier: 3 });
    expect(p.saves.filter((s) => s.proficient).map((s) => s.id)).toEqual(['dex', 'int']);
    expect(p.skills.map((s) => s.id).sort()).toEqual(['acrobatics', 'athletics', 'deception', 'insight', 'investigation', 'perception', 'stealth']);
    expect(p.equipment).toContainEqual({ name: 'armadura de cuero', quantity: 1 });
    expect(p.equipment).toContainEqual({ name: 'daga', quantity: 2 });
    expect((await games.list())).toHaveLength(0);

    for (const [body, field] of [
      [{ name: 'T', ...ROGUE }, 'name'],
      [{ name: 'Tam', ...ROGUE, race: 7 }, 'race'],
      [{ name: 'Tam', ...ROGUE, background: 'pirata' }, 'background'],
      [{ name: 'Tam', ...ROGUE, abilities: { ...ABILITIES, dex: '15' } }, 'abilities'],
      [{ name: 'Tam', ...ROGUE, skills: ['stealth', 'acrobatics', 'athletics', 'insight'] }, 'skills'],
      [{ name: 'Tam', ...ROGUE, death_mode: 'inmortal' }, 'death'],
    ] as const) {
      const bad = await b.post('/api/character/preview', body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(await bad.json(), JSON.stringify(body)).toMatchObject({ ok: false, field });
    }
  });

  it('Nueva partida crea el PJ completo y lo inválido no deja partida ni gasta un mundo', async () => {
    await start();
    const b = browser();
    const made = (await (await b.post('/api/games', { name: 'Mesa', mode: 'offline', character: 'Tam', ...ROGUE })).json()) as { ok: boolean; game: { slug: string }; character_id: string };
    expect(made.ok).toBe(true);
    const c = (await games.open(made.game.slug)).world.character(made.character_id);
    expect(c).toMatchObject({ name: 'Tam', race_id: 'elf', class_id: 'rogue', background_id: 'criminal', death_mode: 'hardcore', hp_max: 9, abilities: { ...ABILITIES, dex: 17 } });
    expect(c.proficiencies.skills).toEqual(expect.arrayContaining(ROGUE.skills));

    for (const bad of [{ race: 'orco' }, { abilities: { ...ABILITIES, str: 15 } }, { skills: ['stealth'] }, { background: 7 }, { death_mode: 'inmortal' }, { race: 0 }, { abilities: false }, { skills: 0 }, { character: 'X' }]) {
      const r = await b.post('/api/games', { name: 'Mal', mode: 'offline', character: 'Tom', ...ROGUE, ...bad, world: {} });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(worldgens).toBe(0);
    expect((await readdir(join(dir, 'games'))).filter((x) => x !== made.game.slug)).toEqual([]);
  });

  it('el invitado sigue el mismo flujo: valida, no ocupa el asiento si falla y su nombre no se repite', async () => {
    const access: AccessOptions = { mode: 'invite', adminToken: 'token-de-admin-para-tests', secret: 'secreto-de-tests' };
    await start(access);
    const host = browser();
    await host.get(`/admin?token=${access.adminToken}`);
    const made = (await (await host.post('/api/games', { name: 'Mesa', mode: 'offline', character: 'Aren', seats: 1 })).json()) as { game: { slug: string }; character_id: string };
    const g = `?game=${made.game.slug}`;
    const seats = (await (await host.get(`/api/seats${g}`)).json()) as { seats: { character_id: string | null; link: string }[] };
    const free = seats.seats.find((s) => !s.character_id)!;

    // Sin enlace, nada.
    expect((await browser().post(`/api/character/preview${g}`, { name: 'Tam', ...ROGUE })).status).toBe(403);

    const friend = browser();
    await friend.get(free.link);
    const page = await (await friend.get(`/${g}`)).text();
    expect(page).toContain('tavernusChargen');
    expect(page).toContain('"backgrounds"');

    expect((await friend.post(`/api/character/preview${g}`, { name: 'Tam', ...ROGUE })).status).toBe(200);
    const taken = await friend.post(`/api/character/preview${g}`, { name: 'aren', ...ROGUE });
    expect(taken.status).toBe(400);
    expect(await taken.json()).toMatchObject({ field: 'name', text: expect.stringContaining('en uso') });

    expect((await friend.post(`/api/seat/claim${g}`, { name: 'Tam', ...ROGUE, skills: ['stealth', 'acrobatics', 'athletics', 'insight'] })).status).toBe(400);
    expect((await friend.post(`/api/seat/claim${g}`, { name: 'Tam', ...ROGUE, abilities: { ...ABILITIES, str: 15 } })).status).toBe(400);
    expect(((await (await host.get(`/api/seats${g}`)).json()) as typeof seats).seats.filter((s) => !s.character_id)).toHaveLength(1);

    const claim = (await (await friend.post(`/api/seat/claim${g}`, { name: 'Tam', ...ROGUE, near: made.character_id })).json()) as { ok: boolean; character_id: string };
    expect(claim.ok).toBe(true);
    const engine = await games.open(made.game.slug);
    expect(engine.world.character(claim.character_id)).toMatchObject({ background_id: 'criminal', death_mode: 'hardcore', abilities: { ...ABILITIES, dex: 17 } });
    expect(engine.world.characterSpot(engine.world.character(claim.character_id))!.id).toBe(engine.world.characterSpot(engine.world.character(made.character_id))!.id);
  });
});
