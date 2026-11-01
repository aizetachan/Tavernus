import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { sheetView } from '../src/adapters/sheet-view.js';
import { GameClock } from '../src/clock/clock.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { setAhead, frozenAt } from '../src/engine/travel.js';
import { nextEscalation } from '../src/engine/story.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { JsonFileRepository } from '../src/persistence/jsonfile.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { bootEngine, fakeTime } from './helpers.js';

const H = 3600;

/** Kael y Mira en la barra; Mira, con su pestaña abierta solo si `withMira`. */
async function bar(withMira = true) {
  const time = fakeTime();
  const { engine, repo } = await bootEngine(time, { offline: true });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(kael.id, true);
  if (withMira) engine.setPresence(mira.id, true);
  await engine.tick();
  return { engine, repo, time, kael, mira };
}

describe('el reloj de juego', () => {
  it('parado no avanza y al reanudar sigue sin saltos', () => {
    const cal = makeSeed().campaign.calendar;
    const clock = new GameClock(3, 0, 0, cal);
    expect(clock.gameNow(1000)).toBe(3);
    clock.pause(1000);
    expect(clock.gameNow(9_000_000)).toBe(3);
    expect(clock.gameNow(500)).toBe(1.5); // lo anterior a la pausa no cambia
    expect(clock.resume(9_000_000)).toBe(8_999_000);
    expect(clock.gameNow(9_000_000)).toBe(3);
    expect(clock.gameNow(9_001_000)).toBe(6);
  });
});

describe('un jugador solo', () => {
  it('se desconecta 2 horas reales y al volver es la misma hora de juego', async () => {
    const { engine, time, kael, mira } = await bar(false);
    mira.connected = false;
    const before = engine.nowFor(kael);
    engine.setAway(kael.id, true);
    expect(engine.clock.paused).toBe(true);
    time.advanceReal(2 * H);
    await engine.tick();
    expect(engine.gameNow()).toBe(before);
    expect(engine.nowFor(kael)).toBe(before);
    expect(await engine.welcomeBack(kael.id)).toBeNull();
    engine.setAway(kael.id, false);
    expect(engine.clock.paused).toBe(false);
    expect(engine.gameNow()).toBe(before);
    expect(engine.nowFor(kael)).toBe(before);
    expect(frozenAt(kael)).toBeNull();
    time.advanceGame(H);
    expect(engine.gameNow()).toBe(before + H);
  });

  it('el velo sigue llegando a los 30 min, con el mundo parado', async () => {
    const { engine, time, kael, mira } = await bar(false);
    mira.connected = false;
    engine.setAway(kael.id, true);
    engine.setPresence(kael.id, false);
    time.advanceReal(31 * 60);
    await engine.tick();
    expect(kael.veiled).toBe(true);
    expect(kael.status).toBe('asleep');
  });

  it('si había dormido, al irse el mundo le alcanza y él no pierde nada', async () => {
    const { engine, time, kael, mira } = await bar(false);
    mira.connected = false;
    const t0 = engine.gameNow();
    setAhead(kael, t0 + 8 * H, t0);
    engine.setAway(kael.id, true);
    expect(engine.gameNow()).toBe(t0 + 8 * H);
    time.advanceReal(H);
    await engine.tick();
    expect(engine.gameNow()).toBe(t0 + 8 * H);
    engine.setAway(kael.id, false);
    expect(engine.nowFor(kael)).toBe(t0 + 8 * H);
  });

  it('la ventana decisiva espera: al volver le queda lo que tenía', async () => {
    const { engine, time, kael, mira } = await bar(false);
    mira.connected = false;
    const calls: string[] = [];
    const m: MasterLike = { async resolve(_a, text) { calls.push(text); return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: { narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } }; } };
    engine.attachMaster(m);
    kael.decisive = { opened_real_ms: time.now() - 30_000, window_s: 60, threat: 'el lobo salta', npc_id: null, event_id: 'ev_x' };
    engine.setAway(kael.id, true);
    time.advanceReal(H);
    await engine.tick();
    expect(calls).toEqual([]);
    engine.setAway(kael.id, false);
    await engine.tick();
    expect(calls).toEqual([]);
    expect(time.now() - kael.decisive!.opened_real_ms).toBe(30_000);
  });
});

describe('dos jugadores, uno se va', () => {
  it('el otro sigue 3 horas de juego; el que vuelve se iguala y recibe el resumen', async () => {
    const { engine, time, kael, mira } = await bar();
    await engine.act(mira.id, 'mirar');
    const left = engine.nowFor(mira);
    engine.setAway(mira.id, true);
    expect(engine.clock.paused).toBe(false);
    time.advanceGame(3 * H);
    await engine.tick();
    expect(engine.nowFor(mira)).toBe(left);
    expect(engine.nowFor(kael)).toBe(left + 3 * H);
    // La cabecera de quien está fuera no avanza; la del que juega, sí.
    expect(sheetView(engine, mira.id).footer).toBe(engine.clock.format(left));
    expect(sheetView(engine, kael.id).footer).toBe(engine.clock.format(left + 3 * H));

    const recap = await engine.welcomeBack(mira.id);
    expect(recap?.action_type).toBe('recap');
    expect(recap?.narration_private).toContain('**El tiempo.** Para ti no ha pasado');
    expect(recap?.narration_private).toContain('El mundo ha seguido 3 h sin ti');
    expect(engine.nowFor(mira)).toBe(left + 3 * H);
    engine.setAway(mira.id, false);
    expect(engine.nowFor(mira)).toBe(left + 3 * H);
    // Una recarga no repite el resumen.
    expect(await engine.welcomeBack(mira.id)).toBeNull();
    // El máster sabe que acaba de volver; un rato después, ya no.
    expect(actionContext(engine, mira, 'mirar')).toContain('ACABA DE VOLVER');
    time.advanceGame(H);
    expect(actionContext(engine, mira, 'mirar')).not.toContain('ACABA DE VOLVER');
  });

  it('a quien está fuera no le saltan ganchos de hora: esperan a alguien que lo vea', async () => {
    const { engine, time, kael, mira } = await bar();
    const calls: string[] = [];
    engine.attachMaster({ async resolve(actor, text) { calls.push(`${actor.id}: ${text}`); return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: { narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } }; } });
    const t0 = engine.gameNow();
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    (engine.world.campaign.hooks ??= []).push({ id: 'hk_prueba', location_id: 'loc_taberna', trigger: { kind: 'time', at_game_s: t0 + 60 }, what: 'llega un mensajero', for_character_id: mira.id, created_game_s: t0, expires_game_s: null });
    engine.setAway(mira.id, true);
    time.advanceGame(600);
    await engine.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([]);
    engine.setAway(mira.id, false);
    await engine.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(['ch_mira: (sucede: llega un mensajero)']);
  });

  it('lo suyo no le corre: estados, cárcel, enfriamiento del descanso, deudas y plazos se aplazan', async () => {
    const { engine, time, mira } = await bar();
    const t0 = engine.nowFor(mira);
    mira.conditions.push({ name: 'envenenado', source: 'prueba', expires_game_s: t0 + H });
    mira.rest = { hit_dice_used: 0, used: {}, last_long_rest_game_s: t0 - H };
    mira.debts = [{ id: 'db', npc_id: 'npc_brenna', amount: 10, reason: 'prueba', due_game_s: t0 + 5 * H, created_game_s: t0 }];
    mira.jailed = { until_game_s: t0 + H, spot_id: 'sp_tab_barra', reason: 'prueba' };
    engine.setAway(mira.id, true);
    time.advanceGame(3 * H);
    await engine.tick();
    expect(mira.conditions.map((x) => x.name)).toContain('envenenado');
    expect(mira.jailed).not.toBeNull();
    engine.setAway(mira.id, false);
    expect(mira.conditions.find((x) => x.name === 'envenenado')!.expires_game_s).toBe(t0 + 4 * H);
    expect(mira.rest!.last_long_rest_game_s).toBe(t0 + 2 * H);
    expect(mira.debts![0]!.due_game_s).toBe(t0 + 8 * H);
    expect(mira.jailed!.until_game_s).toBe(t0 + 4 * H);
  });

  it('cuando se va también el otro, el mundo se para; al volver el primero no se reanuda hasta entrar', async () => {
    const { engine, time, kael, mira } = await bar();
    const t0 = engine.gameNow();
    engine.setAway(mira.id, true);
    time.advanceGame(H);
    engine.setAway(kael.id, true);
    expect(engine.clock.paused).toBe(true);
    time.advanceReal(H);
    await engine.welcomeBack(mira.id);
    expect(engine.nowFor(mira)).toBe(t0 + H); // se iguala a donde se paró el mundo, no más
    engine.setAway(mira.id, false);
    expect(engine.clock.paused).toBe(false);
    expect(engine.gameNow()).toBe(t0 + H);
    expect(engine.nowFor(kael)).toBe(t0 + H); // el que se fue el último no ha perdido nada
  });

  it('volver sin haber perdido nada no da resumen ni aviso', async () => {
    const { engine, time, mira } = await bar();
    engine.setAway(mira.id, true);
    time.advanceReal(5);
    expect(await engine.welcomeBack(mira.id)).toBeNull();
    engine.setAway(mira.id, false);
    expect(actionContext(engine, mira, 'mirar')).not.toContain('ACABA DE VOLVER');
  });
});

describe('agenda y amenaza', () => {
  async function brezal(time = fakeTime()) {
    const seed = authoredSeed('brezal', { now: new Date(time.now()) });
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: time.now, deterministic: false });
    const r = await engine.createCharacter('web:ana', 'Ana');
    if (!r.ok) throw new Error('no se pudo crear el PJ');
    return { engine, time, pc: r.character };
  }

  it('con el mundo parado la amenaza y la agenda no avanzan; con alguien jugando, sí', async () => {
    const { engine, time, pc } = await brezal();
    engine.setPresence(pc.id, true);
    await engine.tick();
    const next = nextEscalation(engine.world, engine.gameNow())!;
    expect(next.escalation.id).toBe('esc_tos');
    engine.setAway(pc.id, true);
    expect(engine.clock.paused).toBe(true);
    await engine.tick();
    const seq = engine.events.lastSeq;
    const places = () => [...engine.world.npcs.values()].map((n) => n.location.id);
    const people = places();
    time.advanceGame(200 * H);
    await engine.tick();
    expect(nextEscalation(engine.world, engine.gameNow())!.escalation.id).toBe('esc_tos');
    expect(nextEscalation(engine.world, engine.gameNow())!.in_s).toBe(next.in_s);
    expect(engine.events.lastSeq).toBe(seq); // ni agenda, ni tablón, ni charlas
    expect(places()).toEqual(people);
    engine.setAway(pc.id, false);
    time.advanceGame(next.in_s + 60);
    await engine.tick();
    expect(nextEscalation(engine.world, engine.gameNow())!.escalation.id).toBe('esc_lobos');
  });

  it('con otro jugando, amenaza y agenda siguen; al ausente le llega en el resumen', async () => {
    const { engine, time, pc } = await brezal();
    const r = await engine.createCharacter('web:tor', 'Tor');
    if (!r.ok) throw new Error('no se pudo crear el PJ');
    const tor = r.character;
    engine.setPresence(pc.id, true);
    engine.setPresence(tor.id, true);
    await engine.tick();
    await engine.act(pc.id, 'dormir');
    const next = nextEscalation(engine.world, engine.gameNow())!;
    engine.setAway(pc.id, true);
    const left = engine.nowFor(pc);
    time.advanceGame(next.in_s + 2 * H);
    await engine.tick();
    expect(nextEscalation(engine.world, engine.gameNow())!.escalation.id).toBe('esc_lobos');
    expect(engine.nowFor(pc)).toBe(left);
    const recap = await engine.welcomeBack(pc.id);
    expect(recap?.narration_private).toContain('El mundo ha seguido');
    expect(engine.nowFor(pc)).toBe(engine.gameNow());
  });

  it('dormir adelanta la amenaza: mira el reloj del PJ presente más adelantado', async () => {
    const { engine, pc } = await brezal();
    engine.setPresence(pc.id, true);
    await engine.tick();
    const next = nextEscalation(engine.world, engine.gameNow())!;
    setAhead(pc, engine.gameNow() + next.in_s + 60, engine.gameNow());
    await engine.tick();
    expect(nextEscalation(engine.world, engine.gameNow())!.escalation.id).toBe('esc_lobos');
  });

  it('un PJ ausente que iba por delante no la adelanta', async () => {
    const { engine, pc } = await brezal();
    const t0 = engine.gameNow();
    setAhead(pc, t0 + 100 * H, t0);
    pc.connected = false;
    await engine.tick();
    expect(nextEscalation(engine.world, engine.gameNow())!.escalation.id).toBe('esc_tos');
  });
});

describe('partida guardada', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-reloj-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  /** Kael en la barra, en disco: lo que se guarda es lo que carga el siguiente arranque. */
  async function saved(time: ReturnType<typeof fakeTime>) {
    const repo = new JsonFileRepository(dir);
    const engine = await Engine.boot({ repo, campaignId: 'demo', seed: makeSeed(), now: time.now, deterministic: false });
    const kael = engine.world.character('ch_kael');
    engine.setPresence(kael.id, true);
    time.advanceGame(2 * H);
    await engine.tick();
    return { engine, repo, kael };
  }
  const reboot = (repo: JsonFileRepository, time: ReturnType<typeof fakeTime>, pauseOnBoot = false) => Engine.boot({ repo, campaignId: 'demo', seed: makeSeed(), now: time.now, deterministic: false, pauseOnBoot });

  it('en pausa se reanuda sin saltos ni duplicar tickers', async () => {
    const time = fakeTime();
    const { engine, repo, kael } = await saved(time);
    engine.setAway(kael.id, true);
    await engine.tick();
    await engine.flush();
    const t = engine.gameNow();
    const seqBefore = engine.events.lastSeq;
    const ticker = await repo.loadTicker('demo', 'minute');

    time.advanceReal(24 * H);
    const again = await reboot(new JsonFileRepository(dir), time);
    expect(again.clock.paused).toBe(true);
    expect(again.gameNow()).toBe(t);
    const k = again.world.character('ch_kael');
    expect(again.nowFor(k)).toBe(t);
    await again.tick();
    expect(again.events.lastSeq).toBe(seqBefore);
    expect(await repo.loadTicker('demo', 'minute')).toEqual(ticker);

    again.setPresence(k.id, true);
    again.setAway(k.id, false);
    expect(again.clock.paused).toBe(false);
    expect(again.gameNow()).toBe(t);
    time.advanceGame(10 * 60);
    await again.tick();
    expect((await repo.loadTicker('demo', 'minute'))!.last_tick_game_s).toBe(ticker!.last_tick_game_s + 10 * 60);
    // Un segundo arranque no vuelve a saltar.
    await again.flush();
    const third = await reboot(new JsonFileRepository(dir), time);
    expect(third.gameNow()).toBe(t + 10 * 60);
  });

  it('un PJ recién creado que ya nace conectado también pone en marcha un reloj parado al cargar', async () => {
    const time = fakeTime();
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed: makeSeed(), now: time.now, deterministic: false, pauseOnBoot: true });
    expect(engine.clock.paused).toBe(true);
    const r = await engine.createCharacter('web:ana', 'Ana');
    if (!r.ok) throw new Error('no se pudo crear el PJ');
    engine.setPresence(r.character.id, true);
    expect(engine.clock.paused).toBe(false);
  });

  it('con el servidor apagado tampoco corre: al cargar se queda en el último minuto procesado', async () => {
    const time = fakeTime();
    const { engine, repo, kael } = await saved(time);
    await engine.flush();
    const last = (await repo.loadTicker('demo', 'minute'))!.last_tick_game_s;
    time.advanceReal(10 * H);
    const again = await reboot(new JsonFileRepository(dir), time, true);
    expect(again.clock.paused).toBe(true);
    expect(again.gameNow()).toBe(last);
    await again.tick();
    expect((await repo.loadTicker('demo', 'minute'))!.last_tick_game_s).toBe(last);
    const k = again.world.character(kael.id);
    expect(frozenAt(k)).toBe(last);
    again.setPresence(k.id, true);
    expect(again.clock.paused).toBe(false);
    expect(frozenAt(k)).toBeNull();
    expect(again.gameNow()).toBe(last);
  });
});
