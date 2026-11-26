/**
 * Ley, combate y reacciones tras las tres tandas de pruebas del 25-11-2026 (docs/PLAN-ARREGLOS-2026-11-26.md,
 * paquete B). Cada caso reproduce un turno de los transcripts con el mundo en memoria y sin modelo (funciones del
 * motor, tools a mano o el máster offline).
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { conflictVerdict, resolveConflict, stolenOf } from '../src/engine/conflict.js';
import { allIncidents, inFightWith, reportIncident } from '../src/engine/crime.js';
import { hasTag } from '../src/engine/standing.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { seededRng } from '../src/engine/dice.js';
import type { GameEvent } from '../src/engine/model.js';
import type { Character, ItemDef, ItemInstance, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

const MARTILLO: ItemDef = { id: 't_martillo_cinto', name: 'martillo ligero', aliases: ['martillo'], type: 'weapon', size: 'small', weight_lb: 2, value: 2, unique: false, origin: 'custom', weapon: { damage: '1d4', damage_type: 'bludgeoning' } };

async function boot(rng: () => number = () => 0.99) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng });
  const r = await engine.createCharacter('u_bruno', 'Bruno', { class_id: 'barbarian' });
  if (!r.ok) throw new Error(r.reason);
  return { engine, time, c: engine.world.character(r.character.id) };
}

/** Lo pone allí y lo retiene (orden larga) para que su horario no se lo lleve. */
function hold(engine: Engine, n: Npc, spot: string): void {
  n.location = { type: 'spot', id: spot };
  expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spot, minutes: 600 }, engine.gameNow()).ok).toBe(true);
}

/** El martillo del cinto de Hugo (en la partida lo llevaba encima). */
function martillo(engine: Engine, hugo: Npc): ItemInstance {
  if (!engine.world.itemDefs.has(MARTILLO.id)) engine.world.itemDefs.set(MARTILLO.id, MARTILLO);
  const inst: ItemInstance = { id: 'ii_t_martillo_cinto', item_id: MARTILLO.id, quantity: 1, location: { type: 'npc', id: hugo.id }, state: {} };
  engine.world.itemInstances.set(inst.id, inst);
  return inst;
}

/** La herrería: Bruno y Hugo en el banco de trabajo, sin más gente (la autoridad, lejos). */
async function herreria(rng?: () => number) {
  const b = await boot(rng);
  const hugo = b.engine.world.npc('npc_hugo');
  hold(b.engine, hugo, 'sp_he_banco');
  b.c.location = { type: 'spot', id: 'sp_he_banco' };
  return { ...b, hugo };
}

describe('(15) desarmar o quitar algo en una pelea abierta no es robo', () => {
  it('Opus, violento 1652, turnos 3 y 4: agarra a Hugo (Atletismo 11) y luego le quita el martillo (Atletismo 12): ni robo ni «ladrón» ni «te buscan» por robo', async () => {
    const { engine, c, hugo } = await herreria();
    const w = engine.world;
    const now = engine.gameNow();
    // Turno 3: le agarra por la pechera. Sin relación, es una agresión y Hugo se lanza contra él.
    const grab = conflictVerdict(w, [], c, hugo, 'grab', null, now)!;
    const g = resolveConflict(w, c, hugo, grab, { total: 11, natural: 6, npc_total: 4 }, now);
    expect(g.response).toBe('crime');
    expect(g.incident?.kind).toBe('assault');
    expect(g.incident?.knowers.find((k) => k.npc_id === hugo.id)?.response).toBe('fight');
    expect(inFightWith(w, c, hugo, now)).toBe(true);
    // Turno 4: le arranca el martillo del cinto en plena pelea.
    const inst = martillo(engine, hugo);
    const snatch = conflictVerdict(w, [], c, hugo, 'snatch', inst, now + 30)!;
    const s = resolveConflict(w, c, hugo, snatch, { total: 30, natural: 7, npc_total: 4 }, now + 30);
    expect(s.response).toBe('disarm');
    expect(s.incident).toBeNull();
    expect(s.facts).toMatch(/no es un robo/);
    expect(s.moved?.instance_id).toBe(inst.id);
    expect(w.itemsCarriedBy(c.id).some((i) => i.id === inst.id)).toBe(true);
    // Ni incidente de robo, ni etiqueta, ni buscado por robo; y Hugo no lo «echa en falta» luego: sabe quién lo tiene.
    expect(allIncidents(w).filter((i) => i.kind === 'theft' || i.kind === 'theft_attempt')).toHaveLength(0);
    expect(hasTag(w, c, 'ladron')).toBe(false);
    expect(c.wanted?.reason ?? '').not.toMatch(/rob/);
    expect(stolenOf(w.itemInstances.get(inst.id)!)?.noticed_game_s).toBe(now + 30);
  });

  it('transfer_item o take_coins en la pelea (reportIncident de un robo) no abren incidente; fuera de la pelea, sí', async () => {
    const { engine, c, hugo } = await herreria();
    const w = engine.world;
    const now = engine.gameNow();
    expect(inFightWith(w, c, hugo, now)).toBe(false);
    // Hostil con él (le ha atacado o se ha lanzado contra él): pelea.
    hugo.attitude.by_character[c.id] = 'hostile';
    expect(reportIncident(w, { kind: 'theft', perpetrator_id: c.id, victim_id: hugo.id }, now)).toBeNull();
    expect(allIncidents(w)).toHaveLength(0);
    // Inconsciente ya no pelea: registrarle es un robo como siempre.
    hugo.status = 'unconscious';
    expect(reportIncident(w, { kind: 'theft', perpetrator_id: c.id, victim_id: hugo.id }, now)?.kind).toBe('theft');
  });

  it('sin pelea, arrancarle algo sigue siendo delito (robo), como antes', async () => {
    const { engine, c, hugo } = await herreria();
    const w = engine.world;
    const now = engine.gameNow();
    const inst = martillo(engine, hugo);
    const v = conflictVerdict(w, [], c, hugo, 'snatch', inst, now)!;
    const r = resolveConflict(w, c, hugo, v, { total: 30, natural: 15, npc_total: 4 }, now);
    expect(r.response).toBe('crime');
    expect(r.incident?.kind).toBe('theft');
  });
});

/** Lo que vio el máster en una llamada (el contexto) y las tools que llamó, del evento de su cierre. */
function masterOf(e: GameEvent): { context: string; calls: { name: string; input: Record<string, unknown> }[] } {
  const m = e.payload['master'] as { context?: string; calls?: { name: string; input: Record<string, unknown> }[] } | null;
  return { context: m?.context ?? '', calls: m?.calls ?? [] };
}

describe('(12) la represalia del NPC tras un éxito del jugador pasa por su tirada', () => {
  it('Opus, violento 1652, turno 3: agarra a Hugo (Atletismo, éxito) y Hugo le pega con el martillo: un turno de Hugo con tirada y daño reales, como hecho en el contexto del cierre', async () => {
    const { engine, c, hugo } = await herreria(seededRng(4));
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
    c.hp_max = 40; c.hp_current = 40; // que aguante el golpe, sea cual sea el dado
    const hp = c.hp_current;
    const hugoHp = hugo.hp_current;
    const a = await engine.act(c.id, 'Agarro a Hugo por la pechera y lo acerco al mostrador. Como vuelvas a esconderme algo, le rompo las piernas a Garrán.');
    expect(a.requires_roll).toMatchObject({ kind: 'skill', key: 'athletics' });
    expect(a.requires_roll?.conflict?.npc_id).toBe(hugo.id);
    const from = engine.events.all().at(-1)!.seq;
    const r = await engine.rollPending(c.id);
    expect(r.ok).toBe(true);
    // Hugo se lanza contra él (la agresión) y pega YA, con su tirada: el daño es el de su ataque, no uno de palabra.
    const outcome = engine.events.all().filter((e) => e.seq > from && e.action_type === 'master_roll_outcome').at(-1)!;
    const m = masterOf(outcome);
    expect(m.context).toMatch(/Represalia, ya resuelta por el servidor con su tirada/);
    const told = /(?:Hugo|El herrero) te ataca con ([^.]+?) y (te da \((\d+)\)|falla)/.exec(m.context);
    expect(told).not.toBeNull();
    const dmg = told![3] ? Number(told![3]) : 0;
    expect(c.hp_current).toBe(hp - dmg);
    expect(m.context).toMatch(/no llames a attack ni a apply_damage/);
    expect(hugo.hp_current).toBe(hugoHp);
    // Un solo turno de Hugo: el cierre no le hace atacar otra vez (ni el máster ni el servidor).
    const attacks = m.calls.filter((x) => x.name === 'attack' && x.input['attacker_id'] === hugo.id);
    expect(attacks).toHaveLength(0);
  });

  it('sin pelea ni nadie que se lance contra él, una tirada no trae golpes del motor', async () => {
    const { engine, c, hugo } = await herreria();
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
    const hp = c.hp_current;
    // Un amigo que le empuja en broma: la relación decide que no es delito y nadie pelea.
    hugo.attitude.by_character[c.id] = 'friendly';
    const a = await engine.act(c.id, 'Trepo por la viga de la fragua para mirar qué hay encima');
    if (a.requires_roll) await engine.rollPending(c.id);
    expect(c.hp_current).toBe(hp);
  });
});

export type { Character };

describe('(3) golpe que acaba en robo y cargo equivocado', () => {
  it('violento 1051, acción 32: «le hundo el puño en las costillas y le arranco la camisa» no es una acción conflictiva (va el ataque primero) y la camisa no se roba', async () => {
    const { engine, c } = await boot();
    const mateo = engine.world.npc('npc_mateo');
    hold(engine, mateo, 'sp_mo_sacos');
    c.location = { type: 'spot', id: 'sp_mo_sacos' };
    const { conflictPlan } = await import('../src/engine/conflict.js');
    const now = engine.gameNow();
    expect(conflictPlan(engine.world, [], c, 'Le hundo el puño en las costillas al molinero y, cuando se doble, le arranco la camisa para que sepa quién manda aquí.', now)).toBeNull();
    // Sin golpe, arrancarle la camisa es agarrarle (agresión), no robarle.
    expect(conflictPlan(engine.world, [], c, 'Le arranco la camisa al molinero', now)?.kind).toBe('grab');
    // Lo que sí lleva y vale, sigue siendo arrebatárselo.
    expect(conflictPlan(engine.world, [], c, 'le arranco la bolsa al molinero', now)?.kind).toBe('snatch');
  });

  it('el alto cita lo que lo provoca (el intento de robo al molinero), no lo más grave de la lista (lo de Hugo)', async () => {
    const { engine, c } = await boot();
    const w = engine.world;
    const [hugo, mateo, garran] = ['npc_hugo', 'npc_mateo', 'npc_garran'].map((id) => w.npc(id)) as [Npc, Npc, Npc];
    // Antes: le pegó a Hugo con la gran hacha en la herrería, delante de Garrán; se fue y la detención quedó en el aire.
    hold(engine, hugo, 'sp_he_banco'); hold(engine, garran, 'sp_he_banco');
    c.location = { type: 'spot', id: 'sp_he_banco' };
    reportIncident(w, { kind: 'armed_assault', perpetrator_id: c.id, victim_id: hugo.id, weapon: 'gran hacha' }, engine.gameNow());
    expect(c.wanted?.arrest?.npc_id).toBe(garran.id);
    c.wanted!.arrest = null;
    // Ahora, en el molino, intenta robarle a Mateo delante de Garrán.
    hold(engine, mateo, 'sp_mo_sacos'); hold(engine, garran, 'sp_mo_sacos');
    c.location = { type: 'spot', id: 'sp_mo_sacos' };
    const from = engine.events.all().at(-1)?.seq ?? 0;
    reportIncident(w, { kind: 'theft_attempt', perpetrator_id: c.id, victim_id: mateo.id }, engine.gameNow() + 60);
    await engine.tick();
    const arrest = engine.events.all().filter((e) => e.seq > from && e.action_type === 'arrest').at(-1)!;
    expect(arrest).toBeTruthy();
    expect(arrest.narration_private).toMatch(/Te acusa de esto: Bruno intentó robarle (a Mateo|al molinero) en los sacos de harina \(El molino\); y además, atacó (a Hugo|al herrero) \(gran hacha\)/);
  });
});

describe('(6) un solo «¡Alto!» por detención', () => {
  /** Bruno le pega a Hugo en la herrería con Garrán delante. `narrated`: el cierre del máster ya ha dado el alto. */
  async function detencion(narrated: boolean) {
    const { engine, c } = await boot();
    const w = engine.world;
    const [hugo, garran] = ['npc_hugo', 'npc_garran'].map((id) => w.npc(id)) as [Npc, Npc];
    hold(engine, hugo, 'sp_he_banco'); hold(engine, garran, 'sp_he_banco');
    c.location = { type: 'spot', id: 'sp_he_banco' };
    const from = engine.events.all().at(-1)?.seq ?? 0;
    reportIncident(w, { kind: 'assault', perpetrator_id: c.id, victim_id: hugo.id }, engine.gameNow());
    engine.events.emit({
      actor_id: c.id, action_type: 'master', input_text: 'le pego a Hugo', observable: null, tags: ['master'],
      narration_private: narrated ? 'Le cruzas la cara a Hugo. Garrán se levanta del banco con la porra en la mano: «¡Alto ahí! Quedas detenido.»' : 'Le cruzas la cara a Hugo, que retrocede contra el yunque.',
      payload: { master: null },
    });
    await engine.tick();
    const mine = engine.events.all().filter((e) => e.seq > from && (e.actor_id === c.id || e.payload['target_character_id'] === c.id));
    const text = (e: GameEvent) => e.actor_id === c.id ? e.narration_private : String(e.payload['observable_target'] ?? '');
    return { mine, altos: mine.map(text).join('\n').match(/¡Alto/g)?.length ?? 0, arrest: mine.find((e) => e.action_type === 'arrest')! };
  }

  it('si el máster ya lo ha narrado, ni el incidente ni el alto del motor lo repiten', async () => {
    const { altos, arrest } = await detencion(true);
    expect(altos).toBe(1);
    expect(arrest.narration_private).toMatch(/^(Garrán|El alguacil) te detiene\. Te acusa de esto/);
  });

  it('si no lo ha narrado, lo da el motor, una vez', async () => {
    const { altos, arrest } = await detencion(false);
    expect(altos).toBe(1);
    expect(arrest.narration_private).toMatch(/«¡Alto! Quedas detenido\.»/);
  });
});

describe('(10) el preso, la huida y el traslado', () => {
  it('Opus, violento 1652: cae ante la autoridad y le encierran; su primer turno en la celda cuenta el traslado, y la autoridad no le obedece', async () => {
    const { engine, c } = await boot();
    const w = engine.world;
    const { crimeContext } = await import('../src/engine/crime.js');
    const [garran, doro] = ['npc_garran', 'npc_doro'].map((id) => w.npc(id)) as [Npc, Npc];
    hold(engine, garran, 'sp_pl_tablon'); hold(engine, doro, 'sp_pl_tablon');
    c.location = { type: 'spot', id: 'sp_pl_tablon' };
    reportIncident(w, { kind: 'armed_assault', perpetrator_id: c.id, victim_id: garran.id, weapon: 'gran hacha' }, engine.gameNow());
    expect(c.wanted?.arrest).toBeTruthy();
    // La maza de Garrán le tumba: a 0 PG delante de quien le detenía.
    c.hp_current = 0; c.status = 'unconscious';
    await engine.tick();
    expect(c.jailed).toMatchObject({ spot_id: 'sp_ca_calabozo', from_spot_id: 'sp_pl_tablon', unconscious: true });
    expect(c.jailed?.told).toBeFalsy();
    const ctx = crimeContext(w, c, engine.nowFor(c))!;
    expect(ctx).toMatch(/ES SU PRIMER TURNO EN LA CELDA: empieza la narración por el traslado.*despierta en .*inconsciente desde el tablón/);
    expect(ctx).toMatch(/La autoridad no obedece al preso/);
    // Vuelve en sí y actúa: el máster (offline) narra su turno y desde entonces el traslado ya está contado.
    c.status = 'active'; c.hp_current = 1;
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(2) }));
    const r = await engine.act(c.id, 'Me levanto del jergón y miro la reja');
    expect(r.ok).toBe(true);
    expect(c.jailed?.told).toBe(true);
    expect(crimeContext(w, c, engine.nowFor(c))).not.toMatch(/PRIMER TURNO EN LA CELDA/);
  });

  /** En plena pelea en la plaza con Garrán, hostil (se resistió), y un alto en pie. */
  async function pelea() {
    const { engine, c } = await boot();
    const w = engine.world;
    const garran = w.npc('npc_garran');
    hold(engine, garran, 'sp_pl_tablon');
    c.location = { type: 'spot', id: 'sp_pl_tablon' };
    c.hp_max = 60; c.hp_current = 60;
    reportIncident(w, { kind: 'assault', perpetrator_id: c.id, victim_id: garran.id }, engine.gameNow());
    garran.attitude.by_character[c.id] = 'hostile';
    engine.events.emit({ actor_id: c.id, action_type: 'master', input_text: 'le pego a Garrán', narration_private: 'Le das un empujón a Garrán.', observable: null, tags: ['master', 'combat'], payload: { master: null } });
    engine.attachMaster({ resolve: async () => ({ ok: false, reason: 'test', message: '' }) });
    const roll = (text: string, key: string) => (engine as unknown as { resolveRoll(c: Character, p: unknown): Promise<unknown> }).resolveRoll(c, { text, roll: { kind: 'skill', key, dc: 13, advantage: 'none' }, event_id: 'ev_x', seq: 0 });
    return { engine, c, garran, roll };
  }

  it('rompejuegos 1051: Acrobacias 16 para zafarse y salir corriendo: los hostiles no le alcanzan en ese turno y el alto queda en el aire', async () => {
    const { engine, c, roll } = await pelea();
    const by = c.wanted!.arrest!.npc_id;
    const hp = c.hp_current;
    await roll('Le suelto el brazo y salgo corriendo hacia el alguacil, gritando que tengo el frasco como prueba', 'acrobatics');
    expect(c.hp_current).toBe(hp);
    // Se le ha escapado a quien le detenía: ya no hay alto que negociar (si le vuelve a ver, va a por él, como a quien huye).
    expect(c.wanted?.resisted_by).toContain(by);
    expect(c.wanted?.arrest?.npc_id === by && !c.wanted.arrest.resisted).toBe(false);
    expect(engine.events.all().some((e) => e.action_type === 'npc_retaliation')).toBe(false);
  });

  it('una tirada que no le saca de ahí (Intimidar con éxito) no frena el turno de los hostiles: le pegan con su tirada', async () => {
    const { engine, c, roll } = await pelea();
    const hp = c.hp_current;
    await roll('¡Un paso más y te parto el yelmo, perro del regidor!', 'intimidation');
    const hit = engine.events.all().filter((e) => e.action_type === 'npc_retaliation').at(-1);
    expect(hit?.narration_private).toMatch(/(Garrán|El alguacil) te ataca con/);
    const dmg = /te da \((\d+)\)/.exec(hit!.narration_private)?.[1];
    expect(c.hp_current).toBe(hp - Number(dmg ?? 0));
  });
});
