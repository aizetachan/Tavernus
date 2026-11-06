/**
 * Acciones conflictivas contra un NPC (conflict.ts, docs/CONFLICTOS-NPC.md): el
 * veredicto puro. Dónde lleva el objeto, en qué estado está el NPC respecto al
 * PJ, quién es el PJ para él, la relación, el perfil y la tabla de hurtar. Con
 * Brezal, sin IA. Los casos salen de «Humo y ceniza» (VPS, 06-11).
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import {
  awareness, carriedOn, conflictOutcome, conflictProfile, conflictVerdict, namesItem, npcContest, pcKnownAs, relationOf, setGuard, stealCell,
  type Awareness, type CarriedOn,
} from '../src/engine/conflict.js';
import { changeOpinion } from '../src/engine/standing.js';
import type { Character, ItemDef, ItemInstance, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Brezal con Pillin, pícaro con la deuda, en la mesa del fondo del Jabalí con Garrán (como en la partida). */
async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  const r = await engine.createCharacter('u_pillin', 'Pillin', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  const c = engine.world.character(r.character.id);
  return { engine, time, c };
}

const DEFS: ItemDef[] = [
  { id: 't_anillo', name: 'anillo de plata', aliases: ['anillo', 'anillos'], type: 'treasure', size: 'tiny', weight_lb: 0, value: 20, unique: false, origin: 'custom', equip_slot: 'ring1' },
  { id: 't_martillo', name: 'martillo de fragua', aliases: ['martillo'], type: 'weapon', size: 'medium', weight_lb: 4, value: 2, unique: false, origin: 'custom', weapon: { damage: '1d8', damage_type: 'bludgeoning' } },
  { id: 't_bolsa', name: 'bolsa de cuero', aliases: ['bolsa'], type: 'container', size: 'small', weight_lb: 0.5, value: 1, unique: false, origin: 'custom', container: { slots: 4, max_weight_lb: 5, max_size: 'tiny' } },
  { id: 't_moneda', name: 'moneda de plata vieja', aliases: ['moneda'], type: 'treasure', size: 'tiny', weight_lb: 0, value: 5, unique: false, origin: 'custom' },
  { id: 't_fardo', name: 'fardo', aliases: ['fardo'], type: 'container', size: 'large', weight_lb: 2, value: 1, unique: false, origin: 'custom', container: { slots: 10, max_weight_lb: 40, max_size: 'medium' } },
  { id: 't_copa', name: 'copa de oro', aliases: ['copa'], type: 'treasure', size: 'small', weight_lb: 1, value: 5000, unique: false, origin: 'custom' },
];

let n = 0;
function give(engine: Engine, holder: Npc | ItemInstance, itemId: string, state: Record<string, unknown> = {}): ItemInstance {
  const w = engine.world;
  for (const d of DEFS) if (!w.itemDefs.has(d.id)) w.itemDefs.set(d.id, d);
  const inst: ItemInstance = { id: `ii_t${++n}`, item_id: itemId, quantity: 1, location: 'passive_perception' in holder ? { type: 'npc', id: holder.id } : { type: 'container', id: holder.id }, state };
  w.itemInstances.set(inst.id, inst);
  return inst;
}

function put(spot: string, ...who: (Character | Npc)[]): void { for (const x of who) x.location = { type: 'spot', id: spot }; }

describe('dónde lo lleva', () => {
  it('se deduce del objeto: anillo puesto, martillo al cinto, bolsa al cinto, lo de dentro, dentro', async () => {
    const { engine } = await boot();
    const osric = engine.world.npc('npc_osric');
    const anillo = give(engine, osric, 't_anillo');
    const martillo = give(engine, osric, 't_martillo');
    const bolsa = give(engine, osric, 't_bolsa');
    const moneda = give(engine, bolsa, 't_moneda');
    const fardo = give(engine, osric, 't_fardo');
    const enFardo = give(engine, fardo, 't_moneda');
    const ons: CarriedOn[] = [anillo, martillo, bolsa, moneda, enFardo].map((i) => carriedOn(engine.world, i));
    expect(ons).toEqual(['worn', 'belt', 'belt', 'inside', 'pack']);
    expect(carriedOn(engine.world, engine.world.itemInstances.get('ii_llave_arcon')!)).toBe('pocket');
  });

  it('el ejemplar manda si lo dice: el sello en la mano', async () => {
    const { engine } = await boot();
    const sello = give(engine, engine.world.npc('npc_osric'), 't_moneda', { on: 'hand' });
    expect(carriedOn(engine.world, sello)).toBe('hand');
  });
});

describe('la tabla de hurtar', () => {
  const rows: [CarriedOn, boolean, Awareness, string][] = [
    ['belt', false, 'helpless', 'none'], ['belt', false, 'unaware', 'passive'], ['belt', false, 'alert', 'contest'], ['belt', false, 'watching', 'contest-'], ['belt', false, 'guarded', 'no'],
    ['inside', false, 'unaware', 'passive-'], ['inside', false, 'alert', 'contest-'], ['inside', false, 'watching', 'no'],
    ['pack', false, 'unaware', 'passive'], ['pack', false, 'alert', 'contest-'], ['pack', false, 'watching', 'no'],
    ['worn', false, 'helpless', 'none'], ['worn', false, 'unaware', 'no'], ['worn', false, 'watching', 'no'],
    ['hand', false, 'unaware', 'snatch'], ['hand', false, 'helpless', 'none'],
    ['belt', true, 'unaware', 'passive-'], ['belt', true, 'alert', 'snatch'],
  ];
  for (const [on, big, aw, want] of rows) {
    it(`${on}${big ? ' (grande)' : ''}, ${aw}: ${want}`, () => {
      const c = stealCell(on, big, aw);
      const got = !c.ok ? ('snatch' in c && c.snatch ? 'snatch' : 'no') : `${c.against}${c.adv < 0 ? '-' : ''}`;
      expect(got).toBe(want);
    });
  }
});

describe('quién es el PJ para el NPC y qué relación tienen', () => {
  it('Garrán le conoce por la situación (le cobra); Osric solo de oídas (compró la deuda); Hugo, nada', async () => {
    const { engine, c } = await boot();
    const k = (id: string) => pcKnownAs(engine.world, [], engine.world.npc(id), c);
    expect(k('npc_garran')).toMatchObject({ as: 'met', name: 'Pillin', knows_name: true });
    expect(k('npc_osric').as).toBe('heard');
    expect(k('npc_osric').knows_name).toBe(false);
    expect(k('npc_hugo')).toMatchObject({ as: 'nothing', knows_name: false });
    expect(k('npc_hugo').name).not.toBe('Pillin');
  });

  it('la relación: ninguna con un extraño; íntima con +40 de opinión; buena con +10; mala con −10', async () => {
    const { engine, c } = await boot();
    const brenna = engine.world.npc('npc_brenna');
    expect(relationOf(brenna, c)).toBe('none');
    changeOpinion(engine.world, brenna, c, 10, 'le ayudó', engine.gameNow());
    expect(relationOf(brenna, c)).toBe('good');
    changeOpinion(engine.world, brenna, c, 10, 'le ayudó', engine.gameNow());
    changeOpinion(engine.world, brenna, c, 10, 'le ayudó', engine.gameNow());
    changeOpinion(engine.world, brenna, c, 10, 'le ayudó', engine.gameNow());
    expect(relationOf(brenna, c)).toBe('intimate');
    const hugo = engine.world.npc('npc_hugo');
    changeOpinion(engine.world, hugo, c, -10, 'le insultó', engine.gameNow());
    expect(relationOf(hugo, c)).toBe('none');
  });

  it('el perfil sale de los datos', async () => {
    const { engine } = await boot();
    const p = (id: string, loc: string) => conflictProfile(engine.world, engine.world.npc(id), loc);
    expect(p('npc_garran', 'loc_taberna')).toBe('authority');
    expect(p('npc_brenna', 'loc_taberna')).toBe('owner');
    expect(p('npc_brenna', 'loc_plaza')).toBe('common');
    expect(p('npc_hugo', 'loc_taberna')).toBe('fighter');
    expect(p('npc_osric', 'loc_plaza')).toBe('fighter');
    expect(p('npc_ursula', 'loc_plaza')).toBe('brave');
    expect(p('npc_tobias', 'loc_plaza')).toBe('timid');
    engine.world.npc('npc_tobias').child = true;
    expect(p('npc_tobias', 'loc_plaza')).toBe('child');
  });

  it('Atletismo del NPC: su ataque menos 2; +0 si no pelea', async () => {
    const { engine } = await boot();
    expect(npcContest(engine.world.npc('npc_hugo'))).toBe(2);
    expect(npcContest(engine.world.npc('npc_brenna'))).toBe(0);
  });
});

describe('el estado del NPC respecto al PJ', () => {
  it('hablando con él le está mirando; si va a escondidas y supera su pasiva, desprevenido; tras pillarle, en guardia', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    const now = engine.gameNow();
    expect(awareness(engine.world, [], c, garran, now)).toBe('alert');
    garran.talking_to = { character_id: c.id, since_game_s: now };
    expect(awareness(engine.world, [], c, garran, now)).toBe('watching');
    c.sneak = { total: 22, game_s: now, spot_id: 'sp_tab_mesa' };
    expect(awareness(engine.world, [], c, garran, now)).toBe('unaware');
    c.sneak = { total: 11, game_s: now, spot_id: 'sp_tab_mesa' };
    expect(awareness(engine.world, [], c, garran, now)).toBe('watching');
    setGuard(engine.world, garran, c.id, now, 'le pilló');
    expect(awareness(engine.world, [], c, garran, now)).toBe('guarded');
    garran.status = 'unconscious';
    expect(awareness(engine.world, [], c, garran, now)).toBe('helpless');
  });
});

describe('el veredicto, con los casos de «Humo y ceniza»', () => {
  it('27-33: oculto detrás de Garrán, la llave: Juego de manos con ventaja contra su pasiva (12)', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    c.sneak = { total: 22, game_s: engine.gameNow(), spot_id: 'sp_tab_mesa' };
    const v = conflictVerdict(engine.world, [], c, garran, 'steal', engine.world.itemInstances.get('ii_llave_arcon')!, engine.gameNow())!;
    expect(v.possible).toBe(true);
    expect(v.roll).toMatchObject({ key: 'sleight_of_hand', against: 'passive', dc: 12, advantage: 'advantage' });
    expect(v.profile).toBe('authority');
  });

  it('63: los anillos de los dedos de Osric, hablando con él: no se puede, sin tirada', async () => {
    const { engine, c } = await boot();
    const osric = engine.world.npc('npc_osric');
    put('sp_pl_tablon', c, osric);
    osric.talking_to = { character_id: c.id, since_game_s: engine.gameNow() };
    const anillo = give(engine, osric, 't_anillo');
    const v = conflictVerdict(engine.world, [], c, osric, 'steal', anillo, engine.gameNow())!;
    expect(v.possible).toBe(false);
    expect(v.roll).toBeNull();
    expect(v.reason).toMatch(/puesto/);
    expect(v.needs).toMatch(/inconsciente/);
    // Tampoco de un tirón.
    expect(conflictVerdict(engine.world, [], c, osric, 'snatch', anillo, engine.gameNow())!.possible).toBe(false);
  });

  it('93: el martillo de fragua de Hugo, a su lado: a escondidas no; arrebatarlo, Atletismo contra +2', async () => {
    const { engine, c } = await boot();
    const hugo = engine.world.npc('npc_hugo');
    put('sp_tab_barra', c, hugo);
    const martillo = give(engine, hugo, 't_martillo');
    const v = conflictVerdict(engine.world, [], c, hugo, 'steal', martillo, engine.gameNow())!;
    expect(v.possible).toBe(false);
    expect(v.needs).toMatch(/arrebat/);
    const s = conflictVerdict(engine.world, [], c, hugo, 'snatch', martillo, engine.gameNow())!;
    expect(s.roll).toMatchObject({ key: 'athletics', against: 'contest', npc_mod: 2 });
  });

  it('en guardia, nada de hurtos', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    setGuard(engine.world, garran, c.id, engine.gameNow(), 'le pilló');
    const v = conflictVerdict(engine.world, [], c, garran, 'steal', engine.world.itemInstances.get('ii_llave_arcon')!, engine.gameNow())!;
    expect(v.possible).toBe(false);
    expect(v.awareness).toBe('guarded');
  });

  it('lo que vale mucho cuesta más: +2 a la CD', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    c.sneak = { total: 22, game_s: engine.gameNow(), spot_id: 'sp_tab_mesa' };
    const copa = give(engine, garran, 't_copa');
    expect(conflictVerdict(engine.world, [], c, garran, 'steal', copa, engine.gameNow())!.roll?.dc).toBe(14);
  });

  it('empujar y agarrar: Atletismo enfrentado; tocar, sin tirada', async () => {
    const { engine, c } = await boot();
    const brenna = engine.world.npc('npc_brenna');
    put('sp_tab_barra', c, brenna);
    expect(conflictVerdict(engine.world, [], c, brenna, 'shove', null, engine.gameNow())!.roll).toMatchObject({ key: 'athletics', npc_mod: 0 });
    expect(conflictVerdict(engine.world, [], c, brenna, 'touch', null, engine.gameNow())).toMatchObject({ possible: true, roll: null });
  });

  it('lo que no lleva él no se le quita', async () => {
    const { engine, c } = await boot();
    const hugo = engine.world.npc('npc_hugo');
    expect(conflictVerdict(engine.world, [], c, hugo, 'steal', engine.world.itemInstances.get('ii_llave_arcon')!, engine.gameNow())!.possible).toBe(false);
  });
});

describe('el resultado de la tirada', () => {
  it('éxito, casi (fallo por 4 desprevenido), le pilla (por 5) y con la mano dentro (1 natural)', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    c.sneak = { total: 22, game_s: engine.gameNow(), spot_id: 'sp_tab_mesa' };
    const v = conflictVerdict(engine.world, [], c, garran, 'steal', engine.world.itemInstances.get('ii_llave_arcon')!, engine.gameNow())!;
    expect(conflictOutcome(v, 12, 7, null)).toBe('success');
    expect(conflictOutcome(v, 8, 3, null)).toBe('near_miss');
    expect(conflictOutcome(v, 7, 2, null)).toBe('caught');
    expect(conflictOutcome(v, 15, 1, null)).toBe('caught_red_handed');
  });

  it('en la enfrentada, el empate lo pierde quien actúa', async () => {
    const { engine, c } = await boot();
    const hugo = engine.world.npc('npc_hugo');
    put('sp_tab_barra', c, hugo);
    const v = conflictVerdict(engine.world, [], c, hugo, 'shove', null, engine.gameNow())!;
    expect(conflictOutcome(v, 14, 10, 14)).toBe('caught');
    expect(conflictOutcome(v, 15, 10, 14)).toBe('success');
  });

  it('lee el objeto por su nombre o sus alias, en plural también', () => {
    expect(namesItem('robarle los anillos de los dedos', DEFS[0]!)).toBe(true);
    expect(namesItem('robarle el martillo de fragua', DEFS[1]!)).toBe(true);
    expect(namesItem('robarle la bolsa', DEFS[1]!)).toBe(false);
  });
});
