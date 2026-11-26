/**
 * Arreglo 31 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete G): `conflictKindOf` y `readsAsTheft` más estrechos. Robar
 * solo con el verbo y el blanco («le quito», «le arrebato», «meto la mano en su bolsa», «le robo»); lanzar un conjuro,
 * lanzarse a un sitio, saltar, pescar, dar algo en la mano o un codazo para llamar la atención no son robo ni ataque.
 * Los casos salen de los transcripts de las tandas 4 y 5 (data/local/autoplay/20261126-0418 y -0442).
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { attentionNudge, conflictKindOf, conflictPlan, readsAsBlow } from '../src/engine/conflict.js';
import { readsAsTheft } from '../src/engine/crime.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import type { ItemDef, ItemInstance, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Lo que el motor leía como robo o ataque y no lo es. */
const INNOCENT: [string, string][] = [
  ['rompejuegos T31', 'Saco de un tirón la bolsa de componentes y lanzo Vuelo, invento cualquier cosa para ganar altura y sobrevolar la niebla hasta la Torre de Ámbar.'],
  ['rompejuegos T33', 'Me zafo del alguacil de un tirón, le suelto un Proyectil mágico al aire y grito: ¡Vuela, Vharn, que te busco! Luego corro hacia el Soto.'],
  ['impredecible T9', 'Me bajo del brocal de un salto, agarro la vela caída de Ilse del agua y se la planto en la mano: «Reza tú, que yo busco el roble del Soto a cantos rodados».'],
  ['el roble no es robar', 'Voy a buscar el roble del Soto.'],
  ['me lanzo al pozo', 'Me lanzo al pozo a por el fondo, que ahí está la Brasa.'],
  ['lanzo un conjuro', 'Lanzo Proyectil mágico al aire para asustar a los cuervos.'],
  ['pescar', 'Me siento en el arroyo y pesco con la caña que me dejó Hal.'],
  ['saltar', 'Salto la valla del corral y sigo hacia el molino.'],
  ['dar algo en la mano', 'Le planto la vela en la mano a Ilse y le digo que rece ella.'],
  ['dárselo', 'Saco la carta y se la doy a Ilse.'],
  ['codazo para llamar la atención', 'Le doy un codazo a Elmo para llamarle la atención y señalo la puerta.'],
  ['palmada en el hombro', 'Le doy una palmada en el hombro a Hugo, amistoso.'],
  ['una manga no es mangar', 'Me remango la manga y sigo trabajando.'],
  ['coger lo suyo', 'Cojo mi bolsa y me la cuelgo al hombro.'],
];

/** Lo que sí es robar, arrebatar, agarrar o tocar, y lo sigue siendo. */
const REAL: [string, string, ReturnType<typeof conflictKindOf>][] = [
  ['pareja pícaro B37', 'Me cuelo tras la barra mientras Brenna sirve, y le birlo la llave de la puerta trasera del cuarto del fondo.', 'steal'],
  ['pareja pícaro B9', 'Mientras Garrán se levanta, deslizo la mano hacia el bolsillo de Ciro y le saco la bolsa de monedas sin que se note.', 'steal'],
  ['arreglo 29', 'Le robo la bolsa a la tabernera sin que se dé cuenta.', 'steal'],
  ['meter la mano', 'Meto la mano en su bolsa y me quedo tres monedas.', 'steal'],
  ['le quito', 'Le quito la llave a Osric mientras duerme.', 'steal'],
  ['de un tirón, con blanco', 'Le quito la bolsa de un tirón y echo a correr.', 'snatch'],
  ['le arrebato', 'Le arrebato el farol al sereno.', 'snatch'],
  // Rompejuegos T15: «le arranco la vela de la mano» es arrebatar, aunque luego se lance al pozo (el análisis lo leyó por
  // «me lanzo al pozo», pero el jugador escribe el tirón a Ilse: eso sí es un conflicto).
  ['rompejuegos T15', 'Me salto la charla con Ilse: le arranco la vela de la mano y me lanzo al pozo a por el fondo, que ahí está la Brasa y no pienso esperar al amanecer.', 'snatch'],
  ['robo y conjuro', 'Le robo la bolsa al sereno y lanzo un conjuro de Luz para despistar.', 'steal'],
  ['violento T5', 'Me incorporo de golpe entre los sacos, agarro a Mateo por el brazo y gruño: «Dime quién fue».', 'grab'],
  ['le cojo del brazo', 'Le cojo del brazo y no le dejo irse.', 'grab'],
  ['le empujo', 'Le empujo contra la barra.', 'shove'],
  ['le toco el pelo', 'Le toco el pelo.', 'touch'],
];

describe('(31) conflictKindOf y readsAsTheft más estrechos', () => {
  it('lo inocente no es robo, ni arrebatar, ni agarrar', () => {
    for (const [name, t] of INNOCENT) {
      expect(conflictKindOf(t), name).toBeNull();
      expect(readsAsTheft(t), name).toBe(false);
    }
  });

  it('lo que es robar o pelearse lo sigue siendo', () => {
    for (const [name, t, kind] of REAL) {
      expect(conflictKindOf(t), name).toBe(kind);
      expect(readsAsTheft(t), name).toBe(kind === 'steal' || kind === 'snatch');
    }
  });

  it('un codazo o una palmada para llamar la atención no es un golpe (pareja metódico M15)', () => {
    const m15 = 'Le doy un codazo a Elmo: ¿y tú qué opinas de Ilse?';
    expect(attentionNudge(m15)).toBe(true);
    expect(readsAsBlow(m15)).toBe(false);
    expect(readsAsBlow('Le doy un codazo a Elmo para que me mire.')).toBe(false);
    // Los golpes de verdad lo siguen siendo.
    expect(readsAsBlow('Le hundo el puño en las costillas al molinero.')).toBe(true);
    expect(readsAsBlow('Le doy un codazo en la cara con todas mis fuerzas.')).toBe(true);
    expect(attentionNudge('Le doy un puñetazo a Elmo.')).toBe(false);
  });
});

const VELA: ItemDef = { id: 't_vela_misa', name: 'vela de cera', aliases: ['vela'], type: 'misc', size: 'tiny', weight_lb: 0.1, value: 0, unique: false, origin: 'custom' };
const BOLSA: ItemDef = { id: 't_bolsa_sereno', name: 'bolsa de cuero', aliases: ['bolsa'], type: 'container', size: 'small', weight_lb: 0.5, value: 1, unique: false, origin: 'custom', container: { slots: 4, max_weight_lb: 5, max_size: 'tiny' } };

async function plaza() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  const r = await engine.createCharacter('u_lope', 'Lope', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  const c = engine.world.character(r.character.id);
  const w = engine.world;
  const put = (n: Npc, spot: string) => {
    n.location = { type: 'spot', id: spot };
    expect(setNpcOrder(w, { npc_id: n.id, order: 'go', spot_id: spot, minutes: 600 }, engine.gameNow()).ok).toBe(true);
  };
  const give = (def: ItemDef, n: Npc, on: string) => {
    if (!w.itemDefs.has(def.id)) w.itemDefs.set(def.id, def);
    const inst: ItemInstance = { id: `ii_${def.id}`, item_id: def.id, quantity: 1, location: { type: 'npc', id: n.id }, state: { on } };
    w.itemInstances.set(inst.id, inst);
    return inst;
  };
  const ilse = w.npc('npc_ilse');
  const sereno = w.npc('npc_x_anselmo');
  put(ilse, 'sp_pl_pozo');
  put(sereno, 'sp_pl_pozo');
  give(VELA, ilse, 'hand');
  give(BOLSA, sereno, 'belt');
  c.location = { type: 'spot', id: 'sp_pl_pozo' };
  return { engine, c, ilse, sereno };
}

describe('(31) conflictPlan con los casos reales, en la plaza del pozo', () => {
  it('impredecible T9: recoger la vela caída y plantársela en la mano a Ilse no es robarle', async () => {
    const { engine, c } = await plaza();
    const t = 'Me bajo del brocal de un salto, agarro la vela caída de Ilse del agua y se la planto en la mano: «Reza tú, que yo busco el roble del Soto a cantos rodados».';
    expect(conflictPlan(engine.world, [], c, t, engine.gameNow())).toBeNull();
  });

  it('rompejuegos T31: sacar de un tirón la bolsa de componentes y lanzar Vuelo no es arrebatarle la bolsa al sereno', async () => {
    const { engine, c } = await plaza();
    const t = 'Saco de un tirón la bolsa de componentes y lanzo Vuelo, invento cualquier cosa para ganar altura y sobrevolar la niebla hasta la Torre de Ámbar.';
    expect(conflictPlan(engine.world, [], c, t, engine.gameNow())).toBeNull();
    // Agarrar su bolsa de cuero, en cambio, sí es quitársela.
    expect(conflictPlan(engine.world, [], c, 'Agarro la bolsa de cuero del sereno', engine.gameNow())?.kind).toBe('steal');
  });

  it('rompejuegos T33: zafarse de un tirón y soltar un Proyectil mágico al aire no es robarle a nadie', async () => {
    const { engine, c } = await plaza();
    const t = 'Me zafo del alguacil de un tirón, le suelto un Proyectil mágico al aire y grito: ¡Vuela, Vharn, que te busco! Luego corro hacia el Soto.';
    expect(conflictPlan(engine.world, [], c, t, engine.gameNow())).toBeNull();
  });

  it('arrancarle la vela de la mano a Ilse sí es arrebatársela', async () => {
    const { engine, c, ilse } = await plaza();
    const p = conflictPlan(engine.world, [], c, 'Le arranco la vela de la mano a Ilse.', engine.gameNow());
    expect(p?.kind).toBe('snatch');
    expect(p?.npc_id).toBe(ilse.id);
  });
});

describe('(31) «de golpe» es de repente', () => {
  it('violento T5 y T22: «me incorporo de golpe», «lo suelto de golpe» no son un golpe', () => {
    expect(readsAsBlow('Me incorporo de golpe entre los sacos, agarro a Mateo por el brazo y gruño.')).toBe(false);
    expect(readsAsBlow('Lo suelto de golpe y le aprieto el hacha contra el pecho.')).toBe(false);
    expect(readsAsBlow('Le doy un golpe en la cabeza.')).toBe(true);
  });
});
