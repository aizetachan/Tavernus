import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { resolveAttack } from '../src/engine/combat.js';
import { seededRng } from '../src/engine/dice.js';
import { COMBAT_SETTLE_S, COMBAT_WINDOW_S, encounterAt } from '../src/engine/encounter.js';
import type { Engine } from '../src/engine/engine.js';
import type { Id } from '../src/engine/model.js';
import { GameManager } from '../src/games/manager.js';
import { combatView, type CombatView, type TurnContext } from '../src/adapters/web/fight.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Kael y Mira en la barra, con Brenna (CA 10, 9 PG) al lado. */
async function bar() {
  const time = fakeTime();
  const { engine } = await bootEngine(time);
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  const brenna = engine.world.npc('npc_brenna');
  kael.location = { type: 'spot', id: brenna.location.id };
  mira.location = { type: 'spot', id: brenna.location.id };
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  // Los eventos, con el reloj del motor (falso): emit usa el real si no se le pasa.
  const emit = engine.events.emit.bind(engine.events);
  engine.events.emit = (input, realMs = time.now()) => emit(input, realMs);
  const loc = engine.world.spot(brenna.location.id).location_id;
  return { engine, time, kael, mira, brenna, loc };
}

const at = (engine: Engine, loc: Id, keepAlive = false) => encounterAt(engine.world, engine.events.recentInLocation(loc, 400), loc, engine.gameNow(), keepAlive);

/** Un golpe de un PJ como lo deja el motor tras la tirada (evento «roll» con payload.attack). */
function strike(engine: Engine, attacker: Id, target: Id, seed = 7) {
  const r = resolveAttack(engine.world, attacker, target, 'advantage', seededRng(seed));
  if ('error' in r) throw new Error(r.error);
  engine.events.emit({ actor_id: attacker, action_type: 'roll', narration_private: '🎲 Ataque', observable: null, tags: ['roll'], payload: { attack: { target_id: target, hit: r.hit, down: r.target_down, dead: r.target_dead, damage: r.damage } } });
  return r;
}

const idle: TurnContext = { round: null, busy: [], resolving: [] };

describe('encuentro (encounter.ts)', () => {
  it('sin eventos de combate no hay combate; uno con la etiqueta lo abre con los PJ del sitio', async () => {
    const { engine, kael, mira, loc } = await bar();
    expect(at(engine, loc)).toBeNull();
    engine.events.emit({ actor_id: kael.id, action_type: 'master', input_text: 'le doy un bofetón a Mira', narration_private: 'Le cruzas la cara.', observable: 'Kael abofetea a Mira.', tags: ['master', 'combat'] });
    const e = at(engine, loc)!;
    expect(e).not.toBeNull();
    expect(e.fighters.map((f) => f.id).sort()).toEqual([kael.id, mira.id].sort());
    expect(e.exchanges).toBe(1);
    // Brenna no está en el combate hasta que alguien la ataca (o se vuelve hostil).
    expect(e.fighters.some((f) => f.kind === 'npc')).toBe(false);
  });

  it('un golpe a un NPC lo mete en el combate, con su registro; la iniciativa es la misma en cada cálculo y va en orden', async () => {
    const { engine, kael, brenna, loc } = await bar();
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Te lanzas contra Brenna.', observable: null, tags: ['master', 'combat'] });
    const r = strike(engine, kael.id, brenna.id);
    const e = at(engine, loc)!;
    expect(e.fighters.map((f) => f.id)).toContain(brenna.id);
    expect(e.log.at(-1)).toMatchObject({ kind: 'attack', actor_id: kael.id, target_id: brenna.id, hit: r.hit, damage: r.damage });
    const again = at(engine, loc)!;
    expect(again.fighters.map((f) => [f.id, f.initiative])).toEqual(e.fighters.map((f) => [f.id, f.initiative]));
    const ini = e.fighters.map((f) => f.initiative);
    expect([...ini].sort((a, b) => b - a)).toEqual(ini);
  });

  it('la ronda cuenta intercambios terminados: el que pide tirada termina al tirar', async () => {
    const { engine, kael, brenna, loc } = await bar();
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Te lanzas contra Brenna.', observable: null, tags: ['master', 'combat'], payload: { requires_roll: { kind: 'attack', key: 'melee', dc: null, target: brenna.id } } });
    expect(at(engine, loc)!.exchanges).toBe(0);
    strike(engine, kael.id, brenna.id);
    engine.events.emit({ actor_id: kael.id, action_type: 'master_roll_outcome', narration_private: 'Le das.', observable: null, tags: ['master', 'combat'] });
    expect(at(engine, loc)!.exchanges).toBe(1);
  });

  it('los ataques que resuelve el máster con tools (attack, apply_damage, heal) entran en el registro', async () => {
    const { engine, kael, mira, brenna, loc } = await bar();
    engine.events.emit({
      actor_id: kael.id, action_type: 'master', narration_private: 'Brenna te arrea con la jarra.', observable: null, tags: ['master'],
      payload: { master: { calls: [
        // El máster guarda el resultado tal como se lo devuelve executeTool: JSON en texto.
        { name: 'attack', input: { attacker_id: brenna.id, target_id: kael.id }, result: JSON.stringify({ hit: true, damage: 3, target_down: false, target_dead: false }) },
        { name: 'heal', input: { target_id: mira.id, amount: 2 }, result: { ok: true } },
        { name: 'attack', input: { attacker_id: brenna.id, target_id: mira.id }, result: JSON.stringify({ error: 'no puede' }) },
      ] } },
    });
    const e = at(engine, loc)!;
    expect(e.log).toEqual([
      expect.objectContaining({ kind: 'attack', actor_id: brenna.id, target_id: kael.id, hit: true, damage: 3 }),
      expect.objectContaining({ kind: 'heal', target_id: mira.id, amount: 2 }),
    ]);
  });

  it('acaba al pasar la ventana sin golpes (salvo con una ronda abierta) y cuando caen todos los NPC', async () => {
    const { engine, time, kael, brenna, loc } = await bar();
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Te lanzas contra Brenna.', observable: null, tags: ['master', 'combat'] });
    strike(engine, kael.id, brenna.id);
    time.advanceGame(COMBAT_WINDOW_S + 1);
    expect(at(engine, loc)).toBeNull();
    expect(at(engine, loc, true)).not.toBeNull();
    time.advanceGame(-COMBAT_WINDOW_S);
    brenna.status = 'dead'; brenna.stats!.hp = 0;
    // El golpe final se ve un momento; luego se acaba.
    expect(at(engine, loc)).not.toBeNull();
    time.advanceGame(COMBAT_SETTLE_S);
    expect(at(engine, loc)).toBeNull();
  });

  it('acaba también cuando caen todos los PJ que pelearon, aunque el NPC siga en pie', async () => {
    const { engine, time, kael, brenna, loc } = await bar();
    strike(engine, kael.id, brenna.id);
    kael.status = 'unconscious'; kael.hp_current = 0;
    expect(at(engine, loc)).not.toBeNull();
    time.advanceGame(COMBAT_SETTLE_S);
    expect(at(engine, loc)).toBeNull();
    expect(brenna.status).toBe('alive');
  });

  it('con golpes entre PJ sigue aunque no quede ningún NPC en pie', async () => {
    const { engine, kael, mira, brenna, loc } = await bar();
    strike(engine, kael.id, brenna.id);
    strike(engine, mira.id, kael.id, 3);
    brenna.status = 'dead'; brenna.stats!.hp = 0;
    const e = at(engine, loc)!;
    expect(e.fighters.find((f) => f.id === brenna.id)?.state).toBe('dead');
  });

  it('solo cuenta a los PJ que están en el sitio', async () => {
    const { engine, kael, mira, loc } = await bar();
    mira.location = { type: 'spot', id: [...engine.world.spots.values()].find((s) => s.location_id !== loc)!.id };
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Golpe.', observable: null, tags: ['master', 'combat'] });
    expect(at(engine, loc)!.fighters.map((f) => f.id)).toEqual([kael.id]);
  });
});

describe('vista del combate por jugador (fight.ts)', () => {
  it('cada uno se ve como «Tú» con sus PV; los NPC sin PV y con el nombre que conoce', async () => {
    const { engine, kael, mira, brenna, loc } = await bar();
    kael.knows = kael.knows.filter((k) => k !== brenna.id);
    mira.knows = [...new Set([...mira.knows, brenna.id])];
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Te lanzas contra Brenna.', observable: null, tags: ['master', 'combat'] });
    strike(engine, kael.id, brenna.id);
    const e = at(engine, loc)!;
    const vk = combatView(engine.world, e, kael.id, idle)!;
    const vm = combatView(engine.world, e, mira.id, idle)!;
    expect(vk.key).toBe(vm.key);
    expect(vk.round).toBe(2);
    expect(vk.fighters.map((f) => f.id)).toEqual(vm.fighters.map((f) => f.id));
    const me = vk.fighters.find((f) => f.me)!;
    expect(me).toMatchObject({ id: kael.id, name: 'Tú', side: 'pc', label: `${kael.hp_current}/${kael.hp_max} PV` });
    expect(vk.fighters.find((f) => f.id === mira.id)!.label).toBe(`${mira.hp_current}/${mira.hp_max} PV`);
    const bk = vk.fighters.find((f) => f.id === brenna.id)!, bm = vm.fighters.find((f) => f.id === brenna.id)!;
    expect(bk.label).not.toMatch(/PV/);
    expect(bk.name).not.toBe('Brenna');
    expect(bm.name).toBe('Brenna');
    expect(vk.log.at(-1)!.text).toMatch(/^Kael → .+: (impacta|falla)/);
  });

  it('el turno: te toca, esperando a otro, otro está actuando, el narrador resuelve, caído', async () => {
    const { engine, kael, mira, loc } = await bar();
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Golpe.', observable: null, tags: ['master', 'combat'] });
    const e = at(engine, loc)!;
    const turn = (viewer: Id, ctx: TurnContext) => combatView(engine.world, e, viewer, ctx)!.turn;
    const round = { kind: 'round' as const, location_id: loc, n: 2, acted: [kael.id], waiting: [mira.id], deadline_ms: Date.now() + 30_000, open: true };
    expect(turn(kael.id, { ...idle, round })).toMatchObject({ kind: 'wait', text: 'Esperando a Mira', deadline_ms: round.deadline_ms });
    expect(turn(mira.id, { ...idle, round })).toMatchObject({ kind: 'you', text: 'Te toca' });
    expect(turn(kael.id, { ...idle, busy: [mira.id] })).toMatchObject({ kind: 'other', who: ['Mira'], text: 'Turno de Mira: está actuando' });
    expect(turn(mira.id, { ...idle, busy: [mira.id] })).toMatchObject({ kind: 'resolving', text: 'El narrador resuelve tu acción' });
    expect(turn(mira.id, { ...idle, resolving: [kael.id, mira.id] })).toMatchObject({ kind: 'resolving' });
    expect(turn(kael.id, idle)).toMatchObject({ kind: 'you' });
    const marks = combatView(engine.world, e, kael.id, { ...idle, round })!.fighters;
    expect(marks.find((f) => f.id === kael.id)!.turn).toBe('acted');
    expect(marks.find((f) => f.id === mira.id)!.turn).toBe('pending');
    mira.status = 'unconscious'; mira.hp_current = 0;
    const down = at(engine, loc)!;
    expect(combatView(engine.world, down, mira.id, idle)!.turn.kind).toBe('down');
  });
});

describe('combate en la web (SSE «combat»)', () => {
  let dir: string;
  let web: WebServer | undefined;
  afterEach(async () => { await web?.stop(); web = undefined; if (dir) await rm(dir, { recursive: true, force: true }); });

  async function readSse(res: Response, until: (text: string) => boolean, ms = 4000): Promise<string> {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const deadline = Date.now() + ms;
    while (!until(text) && Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, deadline - Date.now())))]);
      if (!chunk || chunk.done) break;
      text += dec.decode(chunk.value);
    }
    reader.releaseLock();
    return text;
  }
  const combats = (text: string): (CombatView | { active: false; why?: string })[] => [...text.matchAll(/event: combat\ndata: (.*)\n\n/g)].map((m) => JSON.parse(m[1]!));

  it('llega a los dos jugadores del sitio, se actualiza con cada acción y avisa al empezar y al acabar', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-fight-'));
    const time = fakeTime(Date.now());
    const games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: (e) => new Master(e, { client: offlineClient() }), engine: { deterministic: false, now: time.now }, log: () => {}, budget: null });
    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web!.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
    const { game, character_id: lia } = await games.create({ name: 'Pelea', mode: 'offline', campaign_id: 'demo', character: { name: 'Lia' } });
    const tor = await games.addCharacter(game.slug, 'web:test:2', { name: 'Tor' }, { near: lia });
    const g = `?game=${game.slug}`;
    const engine = await games.open(game.slug);
    const brenna = engine.world.npc('npc_brenna');
    // Que aguante el primer golpe (si cae, el combate acaba enseguida: eso se prueba al final).
    brenna.stats!.hp = brenna.stats!.hp_max = 200;
    for (const id of [lia, tor]) engine.world.character(id).location = { type: 'spot', id: brenna.location.id };
    // Kael y Mira, los PJ de la semilla de la demo, no tienen jugador.
    for (const id of ['ch_kael', 'ch_mira']) engine.setPresence(id, false);
    const post = (path: string, body: unknown) => fetch(`${base}${path}${g}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const liaStream = await fetch(`${base}/api/stream${g}&character=${lia}`);
    const torStream = await fetch(`${base}/api/stream${g}&character=${tor}`);
    // Cada PJ nuevo se presenta primero (prólogo); hasta entonces su hilo no recibe nada más.
    const ready = (t: string) => t.includes('event: presence') && (!t.includes('event: opening') || t.includes('"chapter":{"kind":"prologue"'));
    await readSse(liaStream, ready, 10_000);
    await readSse(torStream, ready, 10_000);

    // Lia ataca a Brenna: el máster (offline) pide la tirada y el motor resuelve el golpe.
    expect((await post('/api/act', { character: lia, text: 'ataco a Brenna' })).status).toBe(200);
    expect((await post('/api/roll', { character: lia })).status).toBe(200);
    // Con la acción de Lia aún en curso, Tor ve «está actuando»: se espera a que acabe.
    const torText = await readSse(torStream, (t) => combats(t).some((c) => c.active && c.log.length > 0 && c.turn.kind === 'you'), 8000);
    const liaText = await readSse(liaStream, (t) => combats(t).some((c) => c.active && c.log.length > 0), 8000);
    for (const text of [torText, liaText]) {
      expect(text).toContain('"combat":{"phase":"start","text":"⚔ Empieza el combate en ');
      const last = combats(text).filter((c): c is CombatView => c.active).at(-1)!;
      expect(last.fighters.map((f) => f.id).sort()).toEqual([lia, tor, brenna.id].sort());
      // El golpe de Lia y, si ya ha llegado la narración, el turno de Brenna, que se defiende sola (combat.ts).
      expect(last.log.some((x) => /^Lia → .+: (impacta|falla)/.test(x.text))).toBe(true);
      expect(last.log.at(-1)!.text).toMatch(/^(Lia → .+|La tabernera → Lia): (impacta|falla)/);
    }
    const forTor = combats(torText).filter((c): c is CombatView => c.active).at(-1)!;
    const forLia = combats(liaText).filter((c): c is CombatView => c.active).at(-1)!;
    expect(forTor.key).toBe(forLia.key);
    expect(forTor.fighters.find((f) => f.me)!.id).toBe(tor);
    expect(forLia.fighters.find((f) => f.me)!.id).toBe(lia);
    expect(forTor.turn.kind).toBe('you');

    // Una conexión nueva recibe el combate en curso nada más conectar.
    const again = await fetch(`${base}/api/stream${g}&character=${tor}`);
    expect(combats(await readSse(again, (t) => t.includes('event: combat'))).at(-1)).toMatchObject({ active: true, key: forTor.key });
    await again.body!.cancel();

    // Cae Brenna (el único NPC): fin del combate para los dos.
    brenna.status = 'dead'; brenna.stats!.hp = 0;
    time.advanceGame(COMBAT_SETTLE_S + 60);
    engine.world.touch('npcs', brenna.id);
    for (const s of [torStream, liaStream]) {
      const end = await readSse(s, (t) => t.includes('"why":"ended"'));
      expect(end).toContain('"combat":{"phase":"end","text":"Fin del combate."}');
      expect(combats(end).at(-1)).toMatchObject({ active: false, why: 'ended', key: forTor.key });
    }
    await torStream.body!.cancel();
    await liaStream.body!.cancel();
  }, 40_000);
});
