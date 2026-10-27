/**
 * Combate y equilibrio de NPC (combat.ts, bloque D). Sale de la partida del
 * 27-10-2026 (Obsidian, «Revisión partida 2026-10-27», §4 y plan D):
 * Leodhin, mago de nivel 1 con 8 PG, mata a Hugo en la barra del Jabalí. Hugo
 * solo atacó en 3 de los 6 turnos del PJ, nunca con su multiataque, y un
 * bastonazo a 0 PG lo mató. Aquí, lo que el motor garantiza ahora.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext, systemPrompt } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { dueNpcTurns, lethalBlow, npcTurn } from '../src/engine/combat.js';
import { npcFate, NPC_WAKE_S } from '../src/engine/death.js';
import { allIncidents, resist } from '../src/engine/crime.js';
import { encounterAt } from '../src/engine/encounter.js';
import { orderOf, setNpcOrder } from '../src/engine/npcorders.js';
import { ARCHETYPES } from '../src/worldgen/skeleton.js';
import type { Character, GameEvent, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

/** El mundo nace a las 18:00 del día 0; la cena del Jabalí empieza a las 19:00. */
const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string };
interface Call { name: string; input: Record<string, unknown>; result: string }

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  return { engine, time };
}

/** Lo retiene allí (orden go larga) para que su horario no se lo lleve durante el test. */
function hold(engine: Engine, n: Npc, spotId: string): void {
  n.location = { type: 'spot', id: spotId };
  expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spotId, minutes: 600 }, engine.gameNow()).ok).toBe(true);
}

/**
 * La barra del Jabalí a las 19:20 con Leodhin y Hugo. `crowd`: también Brenna
 * y Garrán (como en la partida); sin él, solos, para contar los turnos de Hugo.
 */
async function laBarra(opts: { crowd?: boolean; doro?: boolean } = {}) {
  const { engine, time } = await boot();
  time.advanceGame(80 * 60);
  await engine.tick();
  const r = await engine.createCharacter('u_leo', 'Leodhin', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  const leo = r.character;
  leo.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(leo.id, true);
  const [hugo, brenna, garran, doro] = ['npc_hugo', 'npc_brenna', 'npc_garran', 'npc_doro'].map((id) => engine.world.npc(id)) as [Npc, Npc, Npc, Npc];
  hold(engine, hugo, 'sp_tab_barra');
  hold(engine, brenna, opts.crowd ? 'sp_tab_barra' : 'sp_he_fragua');
  hold(engine, garran, opts.crowd ? 'sp_tab_barra' : 'sp_pl_tablon');
  hold(engine, doro, opts.doro ? 'sp_tab_barra' : 'sp_pl_porton');
  // El máster offline, con dados con semilla (los ataques de los NPC los tira él).
  engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(11) }));
  return { engine, time, leo, hugo, brenna, garran, doro };
}

/** Un turno del PJ por el flujo real: la acción (el máster pide la tirada de ataque) y la tirada. */
async function turn(engine: Engine, c: Character, text: string): Promise<GameEvent[]> {
  const from = engine.events.all().at(-1)?.seq ?? 0;
  const a = await engine.act(c.id, text);
  expect(a.requires_roll?.kind).toBe('attack');
  // El objetivo del máster offline es el primero que pelea: aquí, Hugo (ataca a quien nombra la acción).
  expect(a.requires_roll?.target).toBe('npc_hugo');
  await engine.rollPending(c.id);
  return engine.events.all().filter((e) => e.seq > from);
}

const callsIn = (events: GameEvent[]): Call[] => events.flatMap((e) => ((e.payload['master'] as { calls?: Call[] } | null)?.calls ?? []));
const hugoAttacks = (events: GameEvent[]) => callsIn(events).filter((c) => c.name === 'attack' && c.input['attacker_id'] === 'npc_hugo' && !c.result.startsWith('{"error"'));

function ctxFor(engine: Engine, c: Character, extra: Partial<ToolContext> = {}): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], ...extra };
}
function tool(ctx: ToolContext, name: string, input: Record<string, unknown>): ToolOut {
  return JSON.parse(executeTool(ctx, name, input)) as ToolOut;
}
function close(over: Record<string, unknown>): Record<string, unknown> {
  return {
    narration_private: 'Retrocedes un paso.', observable: null, observable_vague: null, loudness: 1, tags: 'combat', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
    decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null,
    names_learned: null, places_learned: null, introduces_self: false, target_character_id: null, observable_target: null, lines: null, ...over,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('golpe letal o no letal (lethalBlow)', () => {
  it('contundente o «pegar» deja inconsciente; «lo mato», cortante o perforante sin decir lo contrario, mata', () => {
    expect(lethalBlow('ataco a Hugo con el bastón', 'bludgeoning')).toBe(false);
    expect(lethalBlow('le doy un puñetazo', 'bludgeoning')).toBe(false);
    expect(lethalBlow('le pego con la espada', 'slashing')).toBe(false);
    expect(lethalBlow('quiero reducirle sin matarle', 'slashing')).toBe(false);
    expect(lethalBlow('no lo mates, déjalo inconsciente', 'piercing')).toBe(false);
    expect(lethalBlow('lo mato con el bastón', 'bludgeoning')).toBe(true);
    expect(lethalBlow('remátalo', 'bludgeoning')).toBe(true);
    expect(lethalBlow('le clavo la daga', 'piercing')).toBe(true);
    expect(lethalBlow('ataco al matón', 'slashing')).toBe(true);
  });
});

describe('Hugo actúa en todos sus turnos (partida del 27-10, seq 72–89)', () => {
  it('en cada turno del PJ, Hugo ataca aunque el máster no lo haga, y el máster lo cuenta', async () => {
    const { engine, leo, hugo } = await laBarra();
    // Que Leodhin aguante los turnos y que su bastón entre siempre (d20 = 11, +1 contra CA 12).
    leo.hp_max = 200; leo.hp_current = 200;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    for (let i = 1; i <= 4; i++) {
      const evs = await turn(engine, leo, 'ataco a Hugo con el bastón');
      expect(hugo.status).toBe('alive');
      // Un turno de Hugo por turno del PJ, ni más ni menos, y queda en el registro del combate.
      const mine = hugoAttacks(evs);
      expect(mine, `turno ${i}`).toHaveLength(1);
      expect(mine[0]!.input['target_id']).toBe(leo.id);
      // La narración lo cuenta (el máster offline no lo hace: lo añade el motor).
      const outcome = evs.find((e) => e.action_type === 'master_roll_outcome')!;
      expect(outcome.narration_private).toMatch(/[Ee]l herrero te ataca con martillo de fragua/);
    }
    const loc = engine.world.spot(hugo.location.id).location_id;
    const enc = encounterAt(engine.world, engine.events.recentInLocation(loc, 400), loc, engine.gameNow())!;
    expect(enc.log.filter((x) => x.kind === 'attack' && x.actor_id === 'npc_hugo')).toHaveLength(4);
  });

  it('el contexto del máster le dice quién tiene que actuar en este turno', async () => {
    const { engine, leo } = await laBarra();
    leo.hp_max = 200; leo.hp_current = 200;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await turn(engine, leo, 'ataco a Hugo con el bastón');
    const ctx = actionContext(engine, leo, 'ataco a Hugo otra vez');
    expect(ctx).toMatch(/## Turno de los NPC hostiles\n- el herrero \[npc_hugo\] ataca a el actor/);
    expect(systemPrompt(engine.world.campaign)).toMatch(/Golpe no letal/);
  });

  it('un bastonazo que le deja a 0 PG lo deja inconsciente, no muerto: el motor lo anuncia con su causa', async () => {
    const { engine, leo, hugo } = await laBarra();
    hugo.stats!.hp = 1;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const evs = await turn(engine, leo, 'ataco a Hugo con el bastón');
    expect(hugo.status).toBe('unconscious');
    expect(hugo.death).toBeUndefined();
    expect(npcFate(hugo)).toMatchObject({ fate: 'unconscious', by_id: leo.id, cause: expect.stringMatching(/^Leodhin \(bast/i) });
    expect(evs.some((e) => e.action_type === 'npc_death')).toBe(false);
    const down = evs.find((e) => e.action_type === 'npc_down')!;
    expect(down.payload['down']).toMatchObject({ fate: 'unconscious', by_id: leo.id, cause: hugo.down!.cause });
    expect(down.observable).toMatch(/^Hugo se desploma, inconsciente, por el golpe de Leodhin\./);
    // Caído, ya no ataca: ni en este turno ni en el siguiente.
    expect(hugoAttacks(evs)).toHaveLength(0);
    expect(dueNpcTurns(engine.world, [leo.id], new Set())).toHaveLength(0);
    // En la cabecera del combate, «Inconsciente».
    const loc = engine.world.spot(hugo.location.id).location_id;
    const enc = encounterAt(engine.world, engine.events.recentInLocation(loc, 400), loc, engine.gameNow());
    expect(enc?.fighters.find((f) => f.id === 'npc_hugo')?.state ?? 'out').toBe('out');
  });

  it('con «lo mato», el mismo bastonazo le mata', async () => {
    const { engine, leo, hugo } = await laBarra();
    hugo.stats!.hp = 1;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const evs = await turn(engine, leo, 'ataco a Hugo con el bastón, lo mato');
    expect(hugo.status).toBe('dead');
    const death = evs.find((e) => e.action_type === 'npc_death')!;
    expect(death.payload['death']).toMatchObject({ fate: 'dead', by_id: leo.id });
    expect(npcFate(hugo)).toMatchObject({ fate: 'dead', by_id: leo.id });
  });

  it('pasado el rato vuelve en sí con 1 PG; atado, sigue sin moverse ni pelear', async () => {
    const { engine, time, leo, hugo } = await laBarra();
    hugo.stats!.hp = 1;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await turn(engine, leo, 'ataco a Hugo con el bastón');
    vi.restoreAllMocks();
    expect(tool(ctxFor(engine, leo), 'restrain_npc', { npc_id: 'npc_hugo', release: null })).toMatchObject({ ok: true, bound: true });
    const from = engine.events.all().at(-1)!.seq;
    time.advanceGame(NPC_WAKE_S + 60);
    await engine.tick();
    expect(hugo.status).toBe('alive');
    expect(hugo.stats!.hp).toBe(1);
    expect(engine.events.all().filter((e) => e.seq > from).find((e) => e.action_type === 'npc_wake')?.observable).toMatch(/Hugo abre los ojos y vuelve en sí, atado/);
    // Atado: no hace su turno, no ataca y su horario no se lo lleva.
    expect(dueNpcTurns(engine.world, [leo.id], new Set())).toHaveLength(0);
    expect(tool(ctxFor(engine, leo), 'attack', { attacker_id: 'npc_hugo', target_id: leo.id, advantage: 'none' }).error).toMatch(/está atado/);
    expect(setNpcOrder(engine.world, { npc_id: 'npc_hugo', order: 'go', spot_id: 'sp_he_fragua', minutes: 10 }, engine.gameNow()).ok).toBe(false);
  });

  it('rematar a quien está inconsciente le mata siempre y es una muerte grave, sin PX', async () => {
    const { engine, leo, hugo } = await laBarra();
    hugo.stats!.hp = 1;
    hugo.attitude.by_character[leo.id] = 'hostile'; // empezó Hugo: tumbarle no es crimen
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await turn(engine, leo, 'ataco a Hugo con el bastón');
    expect(hugo.status).toBe('unconscious');
    const xp = leo.xp;
    const r = tool(ctxFor(engine, leo, { action_text: 'le doy otro bastonazo en el suelo' }), 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    expect(r).toMatchObject({ hit: true, helpless: true, target_dead: true, murder: true, xp_gained: 0 });
    expect(hugo.status).toBe('dead');
    expect(leo.xp).toBe(xp);
    expect(allIncidents(engine.world).some((i) => i.victim_id === 'npc_hugo' && i.kind === 'murder')).toBe(true);
  });
});

describe('el turno de los NPC al cerrar (tools)', () => {
  it('si el máster no hace atacar al hostil, lo hace el motor: rechaza una vez con el resultado y, si no lo cuenta, lo añade', async () => {
    const { engine, leo, hugo } = await laBarra();
    leo.hp_max = 200; leo.hp_current = 200;
    hugo.attitude.by_character[leo.id] = 'hostile';
    const ctx = ctxFor(engine, leo, { action_text: 'ataco a Hugo con el bastón' });
    tool(ctx, 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    const first = tool(ctx, 'log_event', close({ narration_private: 'Le das con el bastón. Hugo se tambalea.' }));
    expect(first.error).toMatch(/^Turno de los NPC hostiles: no se lo pueden saltar\. El servidor ya lo ha resuelto/);
    expect(first.error).toMatch(/[Ee]l herrero te ataca con martillo de fragua/);
    expect(ctx.engine_calls).toHaveLength(1);
    // Segunda vez: no ataca otra vez; la narración no lo cuenta, así que lo añade el motor.
    const second = tool(ctx, 'log_event', close({ narration_private: 'Le das con el bastón.' }));
    expect(second).toMatchObject({ ok: true });
    expect(ctx.closed!.narration_private).toMatch(/Le das con el bastón\.\n\n[Ee]l herrero te ataca/);
    expect(ctx.forced_turns).toHaveLength(1);
  });

  it('si el máster ya lo contó (attack del NPC), no hay rechazo; y un NPC no ataca dos veces en el mismo turno', async () => {
    const { engine, leo, hugo } = await laBarra();
    leo.hp_max = 200; leo.hp_current = 200;
    hugo.attitude.by_character[leo.id] = 'hostile';
    const ctx = ctxFor(engine, leo, { action_text: 'ataco a Hugo' });
    tool(ctx, 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    expect(tool(ctx, 'attack', { attacker_id: 'npc_hugo', target_id: leo.id, advantage: 'none' }).error).toBeUndefined();
    expect(tool(ctx, 'attack', { attacker_id: 'npc_hugo', target_id: leo.id, advantage: 'none' }).error).toMatch(/ya ha hecho su turno/);
    expect(tool(ctx, 'log_event', close({ narration_private: 'Hugo te devuelve el golpe.' }))).toMatchObject({ ok: true });
    expect(ctx.forced_turns ?? []).toHaveLength(0);
  });

  it('con una tirada pendiente no hay turno de NPC (acaba al tirar), ni con la amenaza que se abre', async () => {
    const { engine, leo, hugo } = await laBarra();
    hugo.attitude.by_character[leo.id] = 'hostile';
    const ctx = ctxFor(engine, leo);
    tool(ctx, 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    expect(tool(ctx, 'log_event', close({ requires_roll_kind: 'attack', requires_roll_key: 'melee', requires_roll_target: 'npc_hugo' }))).toMatchObject({ ok: true });
    const ctx2 = ctxFor(engine, leo);
    tool(ctx2, 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    expect(tool(ctx2, 'log_event', close({ decisive_threat: 'Hugo levanta el martillo sobre tu cabeza', decisive_npc_id: 'npc_hugo' }))).toMatchObject({ ok: true });
    expect([...(ctx.forced_turns ?? []), ...(ctx2.forced_turns ?? [])]).toHaveLength(0);
  });

  it('los que intervienen por el crimen (C) pelean solos: si atacan a Doro, Hugo, su amigo, entra y ataca', async () => {
    const { engine, leo, hugo, doro } = await laBarra({ doro: true });
    leo.hp_max = 200; leo.hp_current = 200;
    const ctx = ctxFor(engine, leo, { action_text: 'ataco al guardia' });
    tool(ctx, 'attack', { attacker_id: leo.id, target_id: 'npc_doro', advantage: 'none' });
    expect(doro.attitude.by_character[leo.id]).toBe('hostile');
    expect(hugo.attitude.by_character[leo.id]).toBe('hostile');
    // Como el máster: reescribe mientras el cierre lo rechace (aquí también el control de testigos de C).
    for (let i = 0; i < 5 && !ctx.closed; i++) tool(ctx, 'log_event', close({ narration_private: 'Le das al guardia.' }));
    expect(ctx.closed).toBeTruthy();
    expect(new Set((ctx.forced_turns ?? []).map((f) => f.npc_id))).toEqual(new Set(['npc_hugo', 'npc_doro']));
  });

  it('el multiataque del bloque SRD va entero en una llamada', async () => {
    const { engine, leo, hugo } = await laBarra();
    leo.hp_max = 200; leo.hp_current = 200;
    hugo.stats = { ...ARCHETYPES.thug, hp_max: 32 };
    expect(hugo.stats.multiattack).toBe(2);
    const r = npcTurn(engine.world, 'npc_hugo', leo.id, 'none', seededRng(3));
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.attacks).toHaveLength(2);
  });
});

describe('quien pelea no sigue su horario', () => {
  it('el herrero que se lanza a la puerta contra el PJ no se vuelve al yunque entre turnos', async () => {
    const { engine } = await boot();
    const r = await engine.createCharacter('u_leo', 'Leodhin', { class_id: 'wizard' });
    if (!r.ok) throw new Error(r.reason);
    const leo = r.character;
    leo.hp_max = 200; leo.hp_current = 200;
    leo.location = { type: 'spot', id: 'sp_he_puerta' };
    const hugo = engine.world.npc('npc_hugo');
    delete (hugo as Npc & { order?: unknown }).order;
    hugo.location = { type: 'spot', id: 'sp_he_fragua' };
    hugo.attitude.by_character[leo.id] = 'hostile';
    const ctx = ctxFor(engine, leo);
    // Desde la puerta, a distancia: un Proyectil mágico que le hace poco.
    tool(ctx, 'apply_damage', { target_id: 'npc_hugo', amount: 2, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    for (let i = 0; i < 3 && !ctx.closed; i++) tool(ctx, 'log_event', close({}));
    expect(ctx.forced_turns?.[0]).toMatchObject({ npc_id: 'npc_hugo', moved_to: 'sp_he_puerta' });
    await engine.tick();
    expect(hugo.location.id).toBe('sp_he_puerta');
  });
});

describe('la autoridad, con apoyo', () => {
  it('si se resiste, Garrán pelea y Doro acude desde el portón, ya hostil', async () => {
    const { engine, leo, garran, doro } = await laBarra({ crowd: true });
    tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    expect(leo.wanted?.arrest?.npc_id).toBe('npc_garran');
    resist(engine.world, leo, engine.gameNow());
    expect(garran.attitude.by_character[leo.id]).toBe('hostile');
    expect(doro.attitude.by_character[leo.id]).toBe('hostile');
    expect(orderOf(doro)).toMatchObject({ kind: 'go', spot_id: 'sp_tab_barra' });
  });
});

describe('bloques por rol de Brezal', () => {
  it('el herrero lleva martillo de fragua y mandil; el alguacil, jubón; nadie es invulnerable', async () => {
    const { engine } = await boot();
    const hugo = engine.world.npc('npc_hugo').stats!;
    expect(hugo).toMatchObject({ ac: 12, attack_name: 'martillo de fragua', damage: '1d8+2', damage_type: 'bludgeoning' });
    expect(engine.world.npc('npc_garran').stats).toMatchObject({ ac: 13 });
    expect(engine.world.npc('npc_hal').stats).toMatchObject({ ranged: true, multiattack: 2 });
    for (const n of engine.world.npcs.values()) expect((n as Npc & { essential?: unknown }).essential).toBeUndefined();
  });
});
