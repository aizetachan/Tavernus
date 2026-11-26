/**
 * Arreglo 37 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete G): rendirse es rendirse; el cargo cita lo que pasó; amenazar
 * con un arma y arrebatar algo con violencia tienen consecuencia. Casos de las tandas 4 y 5 (20261126-0418 y -0442):
 * rompejuegos T17, impredecible T10 y T11, pícaro T3 y T4, pareja pícaro B38 y B39, violento T5, T20, T22, T25 y T37.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine, type MasterLike, type MasterResolution } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { conflictPlan, conflictVerdict, resolveConflict } from '../src/engine/conflict.js';
import { allIncidents, arrestAttempt, arrestCharge, incidentText, parseArmedThreat, parseSurrender, readsAsResisting, reportAssault, reportIncident, reportThreat } from '../src/engine/crime.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import type { Character, ItemDef, ItemInstance, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

afterEach(() => { vi.restoreAllMocks(); });

async function boot(name = 'Fiona', cls = 'barbarian') {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  engine.world.campaign.law = { ...engine.world.campaign.law, enforcers: ['npc_doro'] };
  const r = await engine.createCharacter(`u_${name.toLowerCase()}`, name, { class_id: cls });
  if (!r.ok) throw new Error(r.reason);
  return { engine, time, c: engine.world.character(r.character.id) };
}

function hold(engine: Engine, n: Npc, spot: string): void {
  n.location = { type: 'spot', id: spot };
  expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spot, minutes: 600 }, engine.gameNow()).ok).toBe(true);
}

type Close = Partial<Extract<MasterResolution, { ok: true }>['closed']>;
function scripted(engine: Engine): string[] {
  const seen: string[] = [];
  const m: MasterLike = {
    async resolve(_actor, text) {
      seen.push(text);
      const closed: Close = {};
      return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: { narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null, ...closed } };
    },
  };
  engine.attachMaster(m);
  return seen;
}

/** Impredecible T9 y T10: intentó robarle a Ilse en el pozo, delante de Doro, que le da el alto. */
async function alto() {
  const b = await boot();
  const w = b.engine.world;
  const [doro, ilse] = ['npc_doro', 'npc_ilse'].map((id) => w.npc(id)) as [Npc, Npc];
  hold(b.engine, doro, 'sp_pl_pozo');
  hold(b.engine, ilse, 'sp_pl_pozo');
  b.c.location = { type: 'spot', id: 'sp_pl_pozo' };
  reportIncident(w, { kind: 'theft_attempt', perpetrator_id: b.c.id, victim_id: ilse.id, spot_id: 'sp_pl_pozo' }, b.engine.gameNow());
  for (const i of allIncidents(w)) i.narrated_to.push(b.c.id);
  await b.engine.tick();
  expect(b.c.wanted?.arrest).toMatchObject({ npc_id: 'npc_doro', announced: true });
  return { ...b, doro, ilse };
}

describe('(37) rendirse es rendirse', () => {
  it('lee la rendición en cualquier parte de la frase, también los botones en segunda persona', () => {
    for (const t of [
      'Entregarte sin resistir', // pícaro T3
      'Entregarte a Doro', // pareja pícaro B38
      'Soltar la vela y levantar las manos', // rompejuegos T17
      'Vale, voy con vosotros.',
      'Me rindo.',
      'Dejo la espada corta sobre la tabla y me entrego.',
      'Levanto las manos despacio: no me resisto.',
      'Suelto el hacha y me entrego.',
      'me entrego',
    ]) expect(parseSurrender(t), t).toBe(true);
    for (const t of [
      'No me entrego.',
      'Me planto ante Doro con la mano en el bolsillo y le susurro: «Si me entregas, el regidor se entera de que te quedaste con mi daga, Doro».', // B39
      'Antes muerto que rendirme.',
      'Hugo, ¿a qué espera el alguacil? Te pongo el hacha en el cuello y me cuentas qué guardaba mi padre, o yo mismo te entrego a él.',
      'Esperar a que Ilse hable',
    ]) expect(parseSurrender(t), t).toBe(false);
  });

  it('rendirse no es resistirse ni gasta el intento de ganar tiempo', () => {
    expect(readsAsResisting('Suelto el hacha y me entrego.')).toBe(false);
    const c = { wanted: { arrest: { npc_id: 'npc_doro', since_game_s: 0, announced: true, resisted: false, attempts: 1 } } } as unknown as Character;
    // Ya gastó su intento: otro «ganar tiempo» haría actuar a la autoridad; rendirse, no.
    expect(arrestAttempt(c, 'stall', 'Soltar la vela y levantar las manos', 10)).toBe(false);
    expect(c.wanted!.arrest!.attempts).toBe(1);
    expect(arrestAttempt(c, 'stall', 'Garrán, nada de multas: te doy mi palabra de que pago.', 10)).toBe(true);
  });

  it('impredecible T10 y T11, pícaro T3 y T4: con el botón de entregarse se entrega, sin «ya te ha avisado una vez» ni máster', async () => {
    const { engine, c } = await alto();
    const seen = scripted(engine);
    const r = await engine.act(c.id, 'Entregarte sin resistir');
    expect(r.text).not.toMatch(/ya te ha avisado/);
    expect(seen).toHaveLength(0);
    expect(c.wanted).toBeNull();
  });

  it('rompejuegos T17: «Soltar la vela y levantar las manos» también es entregarse', async () => {
    const { engine, c } = await alto();
    const seen = scripted(engine);
    const r = await engine.act(c.id, 'Soltar la vela y levantar las manos');
    expect(r.text).not.toMatch(/ya te ha avisado/);
    expect(seen).toHaveLength(0);
    expect(c.wanted).toBeNull();
  });
});

describe('(37) el cargo cita lo que pasó', () => {
  it('violento T5: agarrar al molinero del brazo es «has agarrado al molinero», no «has golpeado»', async () => {
    const { engine, c } = await boot();
    const w = engine.world;
    const mateo = w.npc('npc_mateo');
    hold(engine, mateo, 'sp_mo_sacos');
    c.location = { type: 'spot', id: 'sp_mo_sacos' };
    const now = engine.gameNow();
    const v = conflictVerdict(w, [], c, mateo, 'grab', null, now)!;
    const res = resolveConflict(w, c, mateo, v, { total: 19, natural: 14, npc_total: 3 }, now);
    expect(res.response).toBe('crime');
    const i = res.incident!;
    expect(i.kind).toBe('assault');
    const you = incidentText(w, i, true);
    expect(you).toMatch(/has agarrado/);
    expect(you).not.toMatch(/golpead/);
    expect(incidentText(w, i, false)).toMatch(/agarró/);
    // Si luego le golpea, el cargo pasa a ser el golpe.
    reportAssault(w, c, mateo, 'puños', now + 30);
    expect(incidentText(w, i, true)).toMatch(/has golpeado/);
  });
});

const HACHA: ItemDef = { id: 't_gran_hacha', name: 'gran hacha', aliases: ['hacha'], type: 'weapon', size: 'large', weight_lb: 7, value: 30, unique: false, origin: 'custom', weapon: { damage: '1d12', damage_type: 'slashing' } };
const GARROTE: ItemDef = { id: 't_garrote', name: 'garrote', aliases: ['palo'], type: 'weapon', size: 'medium', weight_lb: 2, value: 1, unique: false, origin: 'custom', weapon: { damage: '1d4', damage_type: 'bludgeoning' } };

function give(engine: Engine, def: ItemDef, to: ItemInstance['location']): ItemInstance {
  const w = engine.world;
  if (!w.itemDefs.has(def.id)) w.itemDefs.set(def.id, def);
  const inst: ItemInstance = { id: `ii_${def.id}`, item_id: def.id, quantity: 1, location: to, state: {} };
  w.itemInstances.set(inst.id, inst);
  return inst;
}

async function molino() {
  const b = await boot();
  const mateo = b.engine.world.npc('npc_mateo');
  hold(b.engine, mateo, 'sp_mo_sacos');
  b.c.location = { type: 'spot', id: 'sp_mo_sacos' };
  return { ...b, mateo };
}

describe('(37) amenazar con un arma y arrebatar con violencia tienen consecuencia', () => {
  it('violento T20, T22 y T37: la amenaza con el arma que lleva es una agresión, una sola vez, con el arma en el cargo', async () => {
    const { engine, c, mateo } = await molino();
    const w = engine.world;
    give(engine, HACHA, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'both' } });
    const t20 = 'Me giro hacia el molinero con el hacha en alto: ¡Habla ya, o te hago cenizas el saco de encima!';
    const t22 = 'Lo suelto de golpe y le aprieto el hacha contra el pecho: ¡Respira y habla, o el próximo que suba al desván eres tú!';
    const th = parseArmedThreat(w, c, t20, mateo);
    expect(th).toMatchObject({ npc: mateo, weapon: 'gran hacha' });
    expect(parseArmedThreat(w, c, t22, mateo)?.weapon).toBe('gran hacha');
    const now = engine.gameNow();
    const i = reportThreat(w, c, mateo, th!.weapon, now);
    expect(i).toMatchObject({ kind: 'assault', deed: 'threat' });
    expect(incidentText(w, i!, true)).toMatch(/has amenazado al molinero con un arma \(gran hacha\)/);
    // La segunda amenaza no suma otro incidente.
    expect(reportThreat(w, c, mateo, 'gran hacha', now + 60)).toBeNull();
    expect(allIncidents(w).filter((x) => x.perpetrator_id === c.id)).toHaveLength(1);
    // Lo que sabe Mateo: le tiene miedo o le odia, no le atiende como si nada.
    expect(i!.knowers.some((k) => k.npc_id === mateo.id)).toBe(true);
  });

  it('violento T37: con el garrote en la mano también; sin arma que lleve, o sin amenaza, no', async () => {
    const { engine, c, mateo } = await molino();
    const w = engine.world;
    const t37 = 'Me acerco a los sacos con el garrote en la mano: tú, molinero, dime quién estuvo en Vharn esa noche o te parto la rueda contra la cabeza.';
    expect(parseArmedThreat(w, c, t37, mateo)).toBeNull(); // no lleva garrote
    give(engine, GARROTE, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } });
    expect(parseArmedThreat(w, c, t37, mateo)?.weapon).toBe('garrote');
    expect(parseArmedThreat(w, c, 'Le enseño el garrote al molinero y le pregunto por Vharn.', mateo)).toBeNull();
    expect(parseArmedThreat(w, c, 'Le golpeo con el garrote o te parto la cara.', mateo)).toBeNull(); // eso es un ataque
  });

  it('violento T25: agarrar el garrote del molinero y tirarlo de una patada es arrebatárselo (con su delito), no nada', async () => {
    const { engine, c, mateo } = await molino();
    const w = engine.world;
    give(engine, GARROTE, { type: 'npc', id: mateo.id });
    const t25 = 'Agarro el garrote del molinero antes de que lo alce y lo tiro al suelo de una patada: ¡Ni se te ocurra, o te parto el brazo! Luego busco las botas de la sombra del techo.';
    const p = conflictPlan(w, [], c, t25, engine.gameNow());
    expect(p?.kind).toBe('snatch');
    expect(p?.npc_id).toBe(mateo.id);
    // Un golpe sin quitarle nada sigue siendo un ataque (arreglo 3).
    expect(conflictPlan(w, [], c, 'Le doy una patada al molinero.', engine.gameNow())).toBeNull();
  });

  it('el cargo de una amenaza sale en el alto', async () => {
    const { engine, c, mateo } = await molino();
    const w = engine.world;
    const doro = w.npc('npc_doro');
    hold(engine, doro, 'sp_mo_sacos');
    reportThreat(w, c, mateo, 'gran hacha', engine.gameNow());
    expect(arrestCharge(w, c, doro.id)?.charge).toMatch(/^amenazó al molinero con un arma \(gran hacha\)|^amenazó a Mateo con un arma \(gran hacha\)/);
  });
});
