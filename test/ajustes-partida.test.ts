/**
 * Ajustes de la partida y cuentas, fase 1 del plan de la reunión del 11-11-2026
 * (docs/PLAN-REUNION-2026-11-11.md): la dificultad y el modo de muerte son de
 * la mesa y los fija el anfitrión; el Chat entre jugadores llega a toda la mesa
 * o solo a quien oiga, según el ajuste; y la contraseña olvidada se recupera
 * sin correo con el código de recuperación.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { systemPrompt } from '../src/ai/prompt.js';
import { Accounts, normalizeRecoveryCode } from '../src/accounts/accounts.js';
import { memoryDb, type Db } from '../src/db/db.js';
import { DbCatalog } from '../src/db/catalog.js';
import { damageCharacter } from '../src/engine/death.js';
import { DEFAULT_GAME_SETTINGS, gameSettingsOf } from '../src/engine/model.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { bootEngine, fakeTime } from './helpers.js';

const PASS = 'contraseña-de-pruebas';

describe('ajustes de la mesa', () => {
  it('lo que falte o no valga, por defecto', () => {
    expect(gameSettingsOf(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(gameSettingsOf({ difficulty: 'deadly', death_mode: 'raro', chat_reach: 'hearing' })).toEqual({ difficulty: 'deadly', death_mode: 'casual', chat_reach: 'hearing' });
  });

  it('la dificultad de la mesa manda sobre la del máster de la campaña en el prompt', async () => {
    const { engine } = await bootEngine(fakeTime(), { settings: { ...DEFAULT_GAME_SETTINGS, difficulty: 'deadly' } });
    expect(systemPrompt(engine.world.campaign, { difficulty: engine.world.settings.difficulty })).toContain('Dificultad: deadly.');
    expect(systemPrompt(engine.world.campaign)).toContain(`Dificultad: ${engine.world.campaign.master.difficulty}.`);
  });

  it('el modo de muerte es de la mesa: con hardcore, el personaje muere en hardcore aunque su ficha diga casual', async () => {
    const { engine } = await bootEngine(fakeTime(), { settings: { ...DEFAULT_GAME_SETTINGS, death_mode: 'hardcore' } });
    const kael = engine.world.character('ch_kael');
    expect(kael.death_mode).toBe('casual');
    damageCharacter(engine.world, kael, 999, { cause: 'una roca' });
    await engine.tick();
    expect(kael.status).toBe('dead');
    expect(kael.death?.mode).toBe('hardcore');
  });

  it('chat a toda la mesa: la frase llega a quien está en otro sitio; solo a quien oiga, no', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    const mira = engine.world.character('ch_mira');
    const kaelLoc = engine.world.characterSpot(kael)!.location_id;
    const far = [...engine.world.spots.values()].find((s) => s.location_id !== kaelLoc)!;
    mira.location = { type: 'spot', id: far.id };
    const got: { id: string; text: string | null }[] = [];
    engine.onDelivery((d) => got.push({ id: d.character_id, text: d.text }));

    engine.setSettings({ ...DEFAULT_GAME_SETTINGS, chat_reach: 'all' });
    const r = await engine.say(kael.id, '¿Dónde andas?');
    expect(r.ok).toBe(true);
    expect(r.event!.visibility).toBe('public');
    expect(got.find((g) => g.id === mira.id)?.text).toBe('Kael dice: «¿Dónde andas?»');

    got.length = 0;
    engine.setSettings({ ...DEFAULT_GAME_SETTINGS, chat_reach: 'hearing' });
    const r2 = await engine.say(kael.id, 'Ahora no me oyes');
    expect(r2.ok).toBe(true);
    expect(r2.event!.visibility).toBe('location');
    expect(got.find((g) => g.id === mira.id)).toBeUndefined();

    // Dirigido a alguien que está lejos, con «a toda la mesa»: solo a él (y a quien habla), no a toda la sala.
    engine.setSettings({ ...DEFAULT_GAME_SETTINGS, chat_reach: 'all' });
    got.length = 0;
    const r3 = await engine.say(kael.id, 'Ven a la taberna', { to: mira.id });
    expect(r3.ok).toBe(true);
    expect(r3.event!.visibility).toBe('private');
    expect(got.map((g) => g.id).sort()).toEqual([kael.id, mira.id].sort());
  });
});

describe('el gestor guarda los ajustes y el motor los aplica en caliente', () => {
  let dir: string;
  const managers: GameManager[] = [];
  const noApi: MasterFactory = (engine) => new Master(engine, { client: offlineClient() });
  const manager = () => {
    const m = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
    managers.push(m);
    return m;
  };
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-ajustes-')); });
  afterEach(async () => { for (const m of managers.splice(0)) await m.closeAll(); await rm(dir, { recursive: true, force: true }); });

  it('al crear, lo que se pida (y por defecto el resto); después, updateSettings cambia la partida abierta', async () => {
    const games = manager();
    const { game } = await games.create({ name: 'Mesa dura', mode: 'offline', settings: { difficulty: 'hard' } });
    expect(game.settings).toEqual({ difficulty: 'hard', death_mode: 'casual', chat_reach: 'all' });
    expect((await games.list()).find((g) => g.slug === game.slug)?.settings).toEqual(game.settings);
    const engine = await games.open(game.slug);
    expect(engine.world.settings).toEqual(game.settings);
    const after = await games.updateSettings(game.slug, { death_mode: 'hardcore', chat_reach: 'hearing' });
    expect(after).toEqual({ difficulty: 'hard', death_mode: 'hardcore', chat_reach: 'hearing' });
    expect(engine.world.settings).toEqual(after);
    expect((await games.get(game.slug))?.settings).toEqual(after);
    // Una partida sin ajustes (de antes) lista los de por defecto.
    const old = await games.create({ name: 'De antes', mode: 'offline' });
    expect((await games.list()).find((g) => g.slug === old.game.slug)?.settings).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('en la base, la columna settings guarda y devuelve los ajustes', async () => {
    const db = await memoryDb();
    try {
      const catalog = new DbCatalog(db, join(dir, 'games'));
      const m = { version: 1 as const, slug: 'mesa', name: 'Mesa', created_at: new Date().toISOString(), last_opened_at: null, campaign_id: 'brezal', mode: 'offline' as const, demo: false, main: false, data_dir: 'data', cache_dir: 'master-cache', dice_seed: null, initial_dir: null, character_id: null, settings: { difficulty: 'easy' as const, death_mode: 'hardcore' as const, chat_reach: 'hearing' as const } };
      await catalog.put(m);
      expect((await catalog.get('mesa'))?.settings).toEqual(m.settings);
    } finally { await db.close(); }
  });
});

describe('código de recuperación', () => {
  let db: Db;
  let accounts: Accounts;
  beforeAll(async () => { db = await memoryDb(); });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.query('delete from users'); accounts = new Accounts(db); });

  it('se emite una vez, cambia la contraseña sin correo y se gasta; con o sin guiones', async () => {
    const u = await accounts.register('Santi', PASS);
    const code = await accounts.issueRecoveryCode(u.id);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(normalizeRecoveryCode(' kx7p-9qmd zr4t h2wb ')).toBe('KX7P9QMDZR4TH2WB');
    const [row] = await db.query<{ recovery_hash: string | null }>('select recovery_hash from users where id = $1', [u.id]);
    expect(row!.recovery_hash).not.toContain(code.replace(/-/g, ''));
    // Código equivocado: mismo error que con un usuario que no existe, y no cambia nada.
    await expect(accounts.recoverWithCode('Santi', 'AAAA-BBBB-CCCC-DDDD', 'otra-contraseña-larga')).rejects.toMatchObject({ status: 401 });
    await expect(accounts.recoverWithCode('nadie', code, 'otra-contraseña-larga')).rejects.toMatchObject({ status: 401 });
    expect(await accounts.authenticate('Santi', PASS)).toMatchObject({ id: u.id });
    // Con el código (tecleado en minúsculas y sin guiones) cambia la contraseña y entra con la nueva.
    const back = await accounts.recoverWithCode('santi', code.toLowerCase().replace(/-/g, ''), 'otra-contraseña-larga');
    expect(back.id).toBe(u.id);
    expect(await accounts.authenticate('Santi', 'otra-contraseña-larga')).toMatchObject({ id: u.id });
    await expect(accounts.authenticate('Santi', PASS)).rejects.toMatchObject({ status: 401 });
    // Gastado: no vale dos veces.
    await expect(accounts.recoverWithCode('Santi', code, 'la-tercera-contraseña')).rejects.toMatchObject({ status: 401 });
  });

  it('uno nuevo con la contraseña actual (el anterior deja de valer); con otra contraseña, no', async () => {
    const u = await accounts.register('Miguel', PASS);
    const first = await accounts.issueRecoveryCode(u.id);
    await expect(accounts.renewRecoveryCode(u.id, 'no-es-esta')).rejects.toMatchObject({ field: 'current' });
    const second = await accounts.renewRecoveryCode(u.id, PASS);
    expect(second).not.toBe(first);
    await expect(accounts.recoverWithCode('Miguel', first, 'otra-contraseña-larga')).rejects.toMatchObject({ status: 401 });
    expect((await accounts.recoverWithCode('Miguel', second, 'otra-contraseña-larga')).id).toBe(u.id);
  });
});
