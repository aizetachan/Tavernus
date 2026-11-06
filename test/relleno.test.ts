/**
 * NPC de relleno, fase 1 (docs/PLAN-NPC-RELLENO.md): el modelo, el catálogo de oficios, los doce vecinos de Brezal,
 * sus horarios y eventos, las casas que no se ven desde fuera, el validador y la migración de partidas empezadas.
 */
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { BREZAL } from '../src/data/campaigns/brezal/index.js';
import { expandAuthored } from '../src/data/campaigns/format.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine } from '../src/engine/engine.js';
import { extraNpc, extraProblems, isExtra, MAX_EXTRAS_PER_SPOT, TRADES, type ExtraDef } from '../src/engine/extras.js';
import { witnessesAt } from '../src/engine/crime.js';
import { perceive } from '../src/engine/perception.js';
import { allScheduled } from '../src/engine/schedule.js';
import type { Character, ItemInstance, WorldSnapshot } from '../src/engine/model.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { validateSnapshot } from '../src/worldgen/validate.js';
import { fakeTime } from './helpers.js';

/** El mundo nace a las 18:00 del día 0 de juego. */
const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const H = 3600;
const seedNow = () => authoredSeed('brezal', { now: new Date(EPOCH) });

async function boot(repo = new MemoryRepository(), seed: WorldSnapshot = seedNow()) {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo, campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  return { engine, time, repo };
}

/** Avanza el juego hasta la hora `h` (0-24) del día `day` y deja correr el horario. */
async function at(engine: Engine, time: ReturnType<typeof fakeTime>, day: number, h: number): Promise<void> {
  const target = day * 24 * H + h * H;
  time.advanceGame(target - engine.gameNow());
  await engine.tick();
}

async function newPc(engine: Engine, name: string): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  return r.character;
}

function tool(engine: Engine, c: Character, name: string, input: Record<string, unknown>): Record<string, unknown> {
  const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(3), closed: null, rolls: [], progress: [] };
  return JSON.parse(executeTool(ctx, name, input)) as Record<string, unknown>;
}

const spotOf = (engine: Engine, id: string) => engine.world.npc(id).location.id;
const posAt = (engine: Engine, spotId: string) => {
  const s = engine.world.spot(spotId);
  return { spot_id: s.id, next_spot_id: null, progress: 0, x: s.x, y: s.y, location_id: s.location_id };
};

describe('relleno: montaje desde la plantilla de su oficio', () => {
  it('Brezal trae doce vecinos de relleno, con su oficio, su guion y sin secretos ni misiones', () => {
    const seed = seedNow();
    const extras = seed.npcs.filter(isExtra);
    expect(extras).toHaveLength(12);
    expect(seed.npcs.filter((n) => !isExtra(n)).map((n) => n.id)).toContain('npc_brenna');
    const marta = extras.find((n) => n.id === 'npc_x_marta')!;
    expect(marta.role).toBe('panadera');
    expect(marta.script.trade).toBe('baker');
    expect(marta.script.service).toBe('sell');
    expect(marta.script.lines.greet.length).toBeGreaterThan(0);
    // Las frases propias pisan las del oficio solo en su hueco.
    expect(marta.script.lines.dunno[0]).toContain('Brenna');
    expect(marta.script.lines.brush).toEqual(TRADES.baker.lines.brush);
    expect(marta.sells).toEqual([{ item_id: 'it_pan_gris', price: 2 }]);
    expect(marta.secret).toBe('');
    expect(marta.knowledge).toBeUndefined();
    expect(marta.noncombatant).toBe(true);
    expect(marta.stats?.hp).toBe(4);
    expect(marta.home_spot_id).toBe('sp_pl_casas');
    expect(marta.kit).toBe('commoner');
    expect(marta.wealth).toBe('modest');
    // El oficio con otras palabras y el género.
    expect(extras.find((n) => n.id === 'npc_x_ines')!.role).toBe('zagala');
    expect(extras.find((n) => n.id === 'npc_x_remedios')!.role).toBe('beata');
    expect(extras.find((n) => n.id === 'npc_x_anselmo')!.kit).toBe('guard');
    // Una niña es más frágil.
    expect(extras.find((n) => n.id === 'npc_x_pia')!.stats?.hp).toBe(2);
    // Sin bolsa: el kit de niño del ajuar (outfit.ts) lleva sus cosas sueltas.
    expect(extras.find((n) => n.id === 'npc_x_pia')!.kit).toBe('child');
    // Fermina y Ramiro, matrimonio (crime.ts: quien hace daño a uno se las ve con el otro).
    expect(extras.find((n) => n.id === 'npc_x_fermina')!.bonds).toEqual([{ npc_id: 'npc_x_ramiro', kind: 'kin' }]);
  });

  it('el mismo oficio cambia de nombre con el género del mundo', () => {
    const def: ExtraDef = { id: 'npc_x_a', name: 'A', trade: 'laborer', gender: 'f', look: '', story: '', routine: {}, home_spot_id: 'sp' };
    expect(extraNpc(def, 'fantasy', 'sp').role).toBe('labradora');
    expect(extraNpc(def, 'scifi', 'sp').role).toBe('operaria');
    expect(extraNpc({ ...def, trade: 'child' }, 'postapoc', 'sp').role).toBe('niña');
  });

  it('nacen en el punto de su franja: a las 18:00, el de la tarde', () => {
    const seed = seedNow();
    const at = (id: string) => seed.npcs.find((n) => n.id === id)!.location.id;
    expect(at('npc_x_marta')).toBe('sp_pl_horno');
    expect(at('npc_x_gil')).toBe('sp_pl_taberna');
    expect(at('npc_x_remedios')).toBe('sp_pl_casas');
  });

  it('lo que venden lo llevan encima, con su id de verdad', () => {
    const seed = seedNow();
    const on = (id: string) => seed.item_instances.filter((i) => i.location.type === 'npc' && i.location.id === id).map((i) => `${i.item_id}×${i.quantity}`);
    expect(on('npc_x_marta')).toContain('it_pan_gris×6');
    expect(on('npc_x_marta')).toContain('it_llave_casas×1');
    expect(on('npc_x_gil')).toContain('it_madera×4');
    expect(on('npc_x_anselmo')).toContain('it_farol_aceite×1');
  });
});

describe('relleno: eventos y multitud', () => {
  it('el relleno que va a un evento entra en sus asistentes y sale de la multitud sin cara', () => {
    const seed = seedNow();
    const ev = (id: string) => ((seed.campaign as WorldSnapshot['campaign'] & { schedule: { id: string; npc_ids: string[]; crowd: { label: string; count: number }[] }[] }).schedule).find((e) => e.id === id)!;
    const original = (id: string) => BREZAL.campaign.schedule.find((e) => e.id === id)!;
    // Lucio, el buhonero (bloque E), cena en el Jabalí: va escrito en la agenda, antes que el relleno.
    expect(ev('se_cena').npc_ids).toEqual(['npc_hugo', 'npc_lucio', 'npc_x_benito', 'npc_x_ciro', 'npc_x_gil', 'npc_x_damian']);
    expect(ev('se_cena').crowd[0]).toEqual({ label: 'vecinos', count: 6 });
    expect(ev('se_mercado').crowd[0]!.count).toBe(18);
    expect(ev('se_misa').crowd[0]!.count).toBe(10);
    expect(ev('se_prueba_niebla').crowd[0]!.count).toBe(1);
    // Los datos escritos no se tocan: se monta sobre una copia.
    expect(original('se_cena').crowd[0]!.count).toBe(10);
    expect(original('se_cena').npc_ids).toEqual(['npc_hugo', 'npc_lucio']);
  });

  it('un evento que no existe en la agenda es un error de los datos', () => {
    const bad = { ...BREZAL, extras: [{ ...BREZAL.extras![0]!, attends: ['se_no_existe'] }] };
    expect(() => expandAuthored(bad, new Date(EPOCH))).toThrow(/se_no_existe/);
  });
});

describe('relleno: horario', () => {
  it('cada vecino está donde dice su rutina en cada franja, y va a sus eventos', async () => {
    const { engine, time } = await boot();
    // Día 1, 7:00: mañana, sin eventos.
    await at(engine, time, 1, 7);
    expect(spotOf(engine, 'npc_x_marta')).toBe('sp_pl_horno');
    expect(spotOf(engine, 'npc_x_benito')).toBe('sp_pl_camino_molino');
    expect(spotOf(engine, 'npc_x_fermina')).toBe('sp_mo_rueda');
    expect(spotOf(engine, 'npc_x_anselmo')).toBe('sp_pl_casas');
    expect(spotOf(engine, 'npc_x_ines')).toBe('sp_co_redil');
    // 10:00: el mercado. Marta va al pozo, con Pía.
    await at(engine, time, 1, 10);
    expect(spotOf(engine, 'npc_x_marta')).toBe('sp_pl_pozo');
    expect(spotOf(engine, 'npc_x_pia')).toBe('sp_pl_pozo');
    // 16:00: tarde.
    await at(engine, time, 1, 16);
    expect(spotOf(engine, 'npc_x_marta')).toBe('sp_pl_horno');
    expect(spotOf(engine, 'npc_x_fermina')).toBe('sp_pl_pozo');
    expect(spotOf(engine, 'npc_x_anselmo')).toBe('sp_pl_tablon');
    expect(spotOf(engine, 'npc_x_gil')).toBe('sp_pl_taberna');
    // 19:30: la cena del Jabalí.
    await at(engine, time, 1, 19.5);
    const cena = allScheduled(engine.world).find((e) => e.id === 'se_cena')!;
    for (const id of ['npc_x_benito', 'npc_x_ciro', 'npc_x_gil', 'npc_x_damian']) expect(spotOf(engine, id)).toBe(cena.spot_id);
    // 22:30: la prueba de la niebla; el resto, en casa.
    await at(engine, time, 1, 22.5);
    expect(spotOf(engine, 'npc_x_anselmo')).toBe('sp_li_barricada');
    expect(spotOf(engine, 'npc_x_ramiro')).toBe('sp_li_barricada');
    expect(spotOf(engine, 'npc_x_benito')).toBe('sp_pl_casas');
    // 23:30: Anselmo vuelve al portón.
    await at(engine, time, 1, 23.5);
    expect(spotOf(engine, 'npc_x_anselmo')).toBe('sp_pl_porton');
  });
});

describe('relleno: las casas no se ven desde fuera', () => {
  it('quien duerme en las casas no se percibe desde la plaza; desde dentro, sí', async () => {
    const { engine, time } = await boot();
    await at(engine, time, 1, 23.5);
    const pc = await newPc(engine, 'Pillin');
    pc.location = { type: 'spot', id: 'sp_pl_pozo' };
    const now = engine.gameNow();
    expect(spotOf(engine, 'npc_x_marta')).toBe('sp_pl_casas');
    expect(perceive(engine.world, engine.clock, pc, posAt(engine, 'sp_pl_casas'), now).level).toBe('none');
    // who_is_here no la trae; al portón (Anselmo) sí se le ve.
    const here = tool(engine, pc, 'who_is_here', { unused: null }) as unknown as { id: string }[];
    expect(here.map((x) => x.id)).not.toContain('npc_x_marta');
    expect(here.map((x) => x.id)).toContain('npc_x_anselmo');
    // Dentro, sí.
    pc.location = { type: 'spot', id: 'sp_pl_casas' };
    expect(perceive(engine.world, engine.clock, pc, posAt(engine, 'sp_pl_casas'), now).level).not.toBe('none');
  });

  it('las casas están cerradas: sin la llave, no se entra', async () => {
    const { engine } = await boot();
    const pc = await newPc(engine, 'Pillin');
    pc.location = { type: 'spot', id: 'sp_pl_pozo' };
    const r = tool(engine, pc, 'move_to', { character_id: pc.id, target_spot_id: 'sp_pl_casas', target_location_id: null, pace: 'walk' });
    expect(r['error']).toBe('locked');
  });

  it('desde las casas no se ve un robo en la plaza; una muerte sí se oye', async () => {
    const { engine, time } = await boot();
    await at(engine, time, 1, 23.5);
    const pozo = engine.world.spot('sp_pl_pozo');
    expect(witnessesAt(engine.world, pozo, 'theft', []).map((n) => n.id)).not.toContain('npc_x_marta');
    expect(witnessesAt(engine.world, pozo, 'murder', []).map((n) => n.id)).toContain('npc_x_marta');
  });
});

describe('relleno: validador', () => {
  const base = () => seedNow();
  const marta = (s: WorldSnapshot) => s.npcs.find((n) => n.id === 'npc_x_marta')!;

  it('Brezal pasa el validador', () => {
    expect(validateSnapshot(base())).toEqual([]);
  });

  it('un oficio desconocido no se monta', () => {
    expect(() => extraNpc({ id: 'x', name: 'X', trade: 'astronauta' as never, look: '', story: '', routine: {}, home_spot_id: 'sp' }, 'fantasy', 'sp')).toThrow(/astronauta/);
    const s = base();
    marta(s).script!.trade = 'astronauta';
    expect(extraProblems(s).join(' ')).toMatch(/oficio «astronauta»/);
  });

  it('remitir a alguien que no existe, o a otro de relleno, es un error', () => {
    const s = base();
    marta(s).script!.refer_to = ['npc_nadie', 'npc_x_gil'];
    const errs = extraProblems(s).join(' ');
    expect(errs).toMatch(/npc_nadie, que no existe/);
    expect(errs).toMatch(/npc_x_gil, que también es de relleno/);
  });

  it(`más de ${MAX_EXTRAS_PER_SPOT} de relleno en un punto y franja es un error`, () => {
    const s = base();
    for (const id of ['npc_x_marta', 'npc_x_benito', 'npc_x_ciro', 'npc_x_ramiro', 'npc_x_damian']) {
      (s.npcs.find((n) => n.id === id) as { routine?: Record<string, string> }).routine = { day: 'sp_pl_tablon' };
    }
    expect(extraProblems(s).join(' ')).toMatch(/5 en sp_pl_tablon por la mañana/);
  });

  it('sin casa, o con el nombre de un principal, es un error', () => {
    const s = base();
    marta(s).home_spot_id = 'sp_no_existe';
    marta(s).name = 'Brenna';
    const errs = extraProblems(s).join(' ');
    expect(errs).toMatch(/necesita una casa/);
    expect(errs).toMatch(/se llama como un personaje principal/);
  });
});

describe('relleno: partidas empezadas antes', () => {
  /** La semilla de antes del relleno: sin vecinos, sin lo que llevan y con la agenda de entonces. */
  function oldSeed(): WorldSnapshot {
    return authoredSeed === undefined ? seedNow() : (() => {
      const s = expandAuthored({ ...BREZAL, extras: [] }, new Date(EPOCH));
      s.item_instances = s.item_instances.filter((i) => !(i.location.type === 'npc' && i.location.id.startsWith('npc_x_')));
      return s;
    })();
  }

  it('al arrancar con la semilla nueva, entra el relleno con lo que lleva y su sitio en los eventos; una segunda vez no duplica nada', async () => {
    const repo = new MemoryRepository();
    const first = await boot(repo, oldSeed());
    expect([...first.engine.world.npcs.values()].some(isExtra)).toBe(false);
    await first.engine.flush();

    const second = await boot(repo, seedNow());
    const w = second.engine.world;
    expect([...w.npcs.values()].filter(isExtra)).toHaveLength(12);
    const carried = (id: string) => [...w.itemInstances.values()].filter((i: ItemInstance) => i.location.type === 'npc' && i.location.id === id);
    expect(carried('npc_x_marta').map((i) => i.item_id)).toEqual(expect.arrayContaining(['it_pan_gris', 'it_llave_casas']));
    const cena = allScheduled(w).find((e) => e.id === 'se_cena')!;
    expect(cena.npc_ids).toContain('npc_x_benito');
    expect(cena.crowd[0]!.count).toBe(6);

    // Le roban el pan a Marta antes de volver a arrancar: no se le repone.
    const pan = carried('npc_x_marta').find((i) => i.item_id === 'it_pan_gris')!;
    pan.location = { type: 'spot', id: 'sp_pl_pozo' };
    w.touch('item_instances', pan.id);
    await second.engine.flush();

    const third = await boot(repo, seedNow());
    const w3 = third.engine.world;
    expect([...w3.npcs.values()].filter(isExtra)).toHaveLength(12);
    expect([...w3.itemInstances.values()].filter((i) => i.item_id === 'it_pan_gris' && i.location.type === 'npc')).toHaveLength(0);
    const cena3 = allScheduled(w3).find((e) => e.id === 'se_cena')!;
    expect(cena3.npc_ids.filter((id) => id === 'npc_x_benito')).toHaveLength(1);
    expect(cena3.crowd[0]!.count).toBe(6);
  });
});
