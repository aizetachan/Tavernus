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
import { boardState } from '../src/adapters/web/board.js';
import { actionContext, systemPrompt } from '../src/ai/prompt.js';
import { extraSpotNow, extraStagger, EXTRA_STAGGER_S } from '../src/engine/schedule.js';
import { placeExtraAt } from '../src/engine/extras.js';
import { encounterTable, encounterWhat } from '../src/engine/travel.js';
import { inventedPeople } from '../src/engine/invented.js';
import { extraReply } from '../src/engine/extratalk.js';
import { coinsOf } from '../src/engine/money.js';
import { setFact } from '../src/engine/worldfacts.js';
import { generateSeed, TONES } from '../src/worldgen/index.js';
import { buildSkeleton } from '../src/worldgen/skeleton.js';

/** El mundo nace a las 18:00 del día 0 de juego. */
const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const H = 3600;
const seedNow = () => authoredSeed('brezal', { now: new Date(EPOCH) });

async function boot(repo = new MemoryRepository(), seed: WorldSnapshot = seedNow(), deterministic = false) {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo, campaignId: 'brezal', seed, now: time.now, deterministic, fastTravel: false });
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
    expect(marta.kit).toBe('baker');
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
    // 23:30: Anselmo vuelve a su ronda (pasea entre el portón y la barricada).
    await at(engine, time, 1, 23.5);
    expect(['sp_pl_porton', 'sp_li_barricada']).toContain(spotOf(engine, 'npc_x_anselmo'));
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
    // who_is_here no la trae; al de la ronda, en el portón, sí se le ve.
    engine.world.npc('npc_x_anselmo').location = { type: 'spot', id: 'sp_pl_porton' };
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

  it('un oficio que nombra un sitio es un error: «voy a la casona» se leería como hablar con la criada', () => {
    const s = base();
    s.npcs.find((n) => n.id === 'npc_x_herminia')!.role = 'criada de la casona';
    expect(extraProblems(s).join(' ')).toMatch(/npc_x_herminia: su oficio .* nombra un sitio \(casona\)/);
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

// ---------------------------------------------------------------------------
// Fase 2: minimapa, contexto del máster, horario escalonado, paseos, encuentros y gente inventada
// ---------------------------------------------------------------------------

function closeWith(over: Record<string, unknown>): Record<string, unknown> {
  return {
    narration_private: 'Asientes.', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
    decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null,
    names_learned: null, places_learned: null, introduces_self: false, target_character_id: null, observable_target: null, lines: null, ...over,
  };
}

describe('relleno, fase 2: minimapa', () => {
  it('el tablero trae a la panadera como vecino de relleno, por su oficio y sin marca de misión', async () => {
    const { engine, time } = await boot();
    await at(engine, time, 1, 7);
    const pc = await newPc(engine, 'Pillin');
    pc.location = { type: 'spot', id: 'sp_pl_pozo' };
    const b = boardState(engine, pc.id);
    const marta = b.presences.find((p) => p.id === 'npc_x_marta')!;
    expect(marta).toMatchObject({ kind: 'npc', extra: true, spot_id: 'sp_pl_horno', label: 'la panadera' });
    expect(marta.lead).toBeUndefined();
    // Los principales no llevan la marca.
    expect(b.presences.find((p) => p.id === 'npc_garran')?.extra).toBeUndefined();
    // Los de las casas no salen.
    expect(b.presences.some((p) => p.id === 'npc_x_anselmo')).toBe(false);
  });

  it('el relleno va y viene sin dejar avisos ni líneas en el chat', async () => {
    const { engine, time } = await boot();
    const from = engine.events.all().at(-1)?.seq ?? 0;
    await at(engine, time, 1, 7);
    await at(engine, time, 1, 16);
    await at(engine, time, 1, 23.5);
    const moves = engine.events.all().filter((e) => e.seq > from && e.action_type === 'npc_move');
    expect(moves.some((e) => String(e.payload['npc_id']).startsWith('npc_x_'))).toBe(false);
    // Los principales siguen avisando.
    expect(moves.some((e) => e.payload['npc_id'] === 'npc_doro')).toBe(true);
  });
});

describe('relleno, fase 2: horario escalonado y paseos', () => {
  it('cada vecino cambia de franja a su hora, entre 40 minutos antes y 40 después; con la misma semilla, la misma hora', () => {
    const seed = seedNow();
    const ss = seed.npcs.filter(isExtra).map((n) => extraStagger(n));
    for (const s of ss) expect(Math.abs(s)).toBeLessThanOrEqual(EXTRA_STAGGER_S);
    expect(new Set(ss).size).toBeGreaterThan(5);
    expect(extraStagger({ id: 'npc_x_marta' })).toBe(extraStagger({ id: 'npc_x_marta' }));
  });

  it('a las 14:00 no se ha movido todo el pueblo a la vez; a las 14:45, sí', async () => {
    const { engine, time } = await boot();
    // Los que cambian de punto por la tarde y no pasean.
    const changing = ['npc_x_fermina', 'npc_x_ciro', 'npc_x_gil', 'npc_x_remedios', 'npc_x_ines', 'npc_x_herminia', 'npc_x_ramiro', 'npc_x_anselmo'];
    const afternoon = (id: string) => {
      const r = (engine.world.npc(id) as unknown as { routine: { day?: string; afternoon?: string } }).routine;
      return r.afternoon ?? r.day;
    };
    await at(engine, time, 1, 13.25);
    expect(changing.filter((id) => spotOf(engine, id) === afternoon(id))).toEqual([]);
    await at(engine, time, 1, 14);
    expect(changing.filter((id) => spotOf(engine, id) === afternoon(id)).length).toBeLessThan(changing.length);
    await at(engine, time, 1, 14.75);
    for (const id of changing) expect(spotOf(engine, id), id).toBe(afternoon(id));
  });

  it('Pía pasea entre el pozo, el tablón y el callejón por la mañana, y nunca sale de ellos', async () => {
    const { engine, time } = await boot();
    const seen = new Set<string>();
    for (const h of [7, 7.5, 8, 8.5]) {
      await at(engine, time, 1, h);
      seen.add(spotOf(engine, 'npc_x_pia'));
      expect(extraSpotNow(engine.world, engine.world.npc('npc_x_pia'), engine.gameNow())).toBe(spotOf(engine, 'npc_x_pia'));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const s of seen) expect(['sp_pl_pozo', 'sp_pl_tablon', 'sp_pl_callejon']).toContain(s);
  });

  it('un vecino puesto en un sitio (un encuentro de camino) no pasea ni sigue su horario mientras dura', async () => {
    const { engine, time } = await boot();
    await at(engine, time, 1, 7);
    const pia = engine.world.npc('npc_x_pia');
    expect(placeExtraAt(engine.world, pia, 'sp_pl_taberna', engine.gameNow())).toBe(true);
    await at(engine, time, 1, 7.4);
    expect(spotOf(engine, 'npc_x_pia')).toBe('sp_pl_taberna');
  });
});

describe('relleno, fase 2: contexto del máster', () => {
  it('cada vecino presente va en una línea, sin su historia entera, con su guion y lo que lleva', async () => {
    const { engine, time } = await boot();
    await at(engine, time, 1, 7);
    const pc = await newPc(engine, 'Pillin');
    pc.location = { type: 'spot', id: 'sp_pl_pozo' };
    const ctx = actionContext(engine, pc, 'miro alrededor');
    expect(ctx).toMatch(/## Gente de relleno aquí \(solo existen estos/);
    expect(ctx).toMatch(/- la panadera \[npc_x_marta\] \(el actor no sabe su nombre, que es Marta\), en el horno/);
    expect(ctx).toMatch(/Guion: seco; sirve para: vende lo suyo; lo que no sabe, lo remite a /);
    expect(ctx).toMatch(/Vende: pan gris \[it_pan_gris\]/);
    expect(ctx).toMatch(/\[ii_marta_pan\]/);
    // Su historia no: solo el aspecto.
    expect(ctx).not.toContain('comen y se van');
    // Y no va en «Presentes» con la ficha entera.
    expect(ctx).not.toMatch(/- NPC la panadera \[npc_x_marta\]/);
  });

  it('el prompt de sistema lleva la regla GENTE', () => {
    expect(systemPrompt(seedNow().campaign)).toMatch(/GENTE: solo existen las personas del contexto/);
  });

  it('who_is_here y get_npc dicen que es de relleno', async () => {
    const { engine, time } = await boot();
    await at(engine, time, 1, 7);
    const pc = await newPc(engine, 'Pillin');
    pc.location = { type: 'spot', id: 'sp_pl_pozo' };
    const here = tool(engine, pc, 'who_is_here', { unused: null }) as unknown as { id: string; tier?: string }[];
    expect(here.find((x) => x.id === 'npc_x_marta')?.tier).toBe('extra');
    expect(here.find((x) => x.id === 'npc_garran')?.tier).toBeUndefined();
    const marta = tool(engine, pc, 'get_npc', { npc_id: 'npc_x_marta' });
    expect(marta['tier']).toBe('extra');
    expect((marta['script'] as { trade: string }).trade).toBe('baker');
  });
});

describe('relleno, fase 2: encuentros de camino', () => {
  it('el vecino del camino de Brezal es un vecino de relleno de verdad', async () => {
    const { engine, time } = await boot();
    await at(engine, time, 1, 10);
    const entry = encounterTable(engine.world, 'town').find((e) => e.id === 'vecino')!;
    expect(entry.extra).toBe(true);
    const enc = { entry, chance: 1, roll: 0, zone_kind: 'town', exit_id: 'x', waypoint_spot_id: 'sp_pl_pozo', origin_spot_id: 'sp_pl_pozo', destination_spot_id: 'sp_mo_puerta', at_game_s: engine.gameNow(), remaining_m: 10, remaining_s: 10, extra_id: 'npc_x_benito' };
    expect(encounterWhat(engine.world, enc)).toMatch(/^Benito \[npc_x_benito\], labrador \(Manos agrietadas/);
    expect(encounterWhat(engine.world, enc)).not.toContain('{extra}');
  });
});

describe('relleno, fase 2: gente inventada', () => {
  /** El turno 89 de «Humo y ceniza» (VPS, día 1, 19:03). */
  const SEQ_89 = 'Preguntas a los vecinos qué es la cena del Jabalí. Un labrador de manos agrietadas te contesta sin levantar la vista del plato: guiso, pan gris y cerveza, cada noche mientras dure la niebla. Una mujer de chal al fondo mira hacia la puerta, como quien espera a alguien que no llega.';

  async function tavernAt(h: number) {
    const { engine, time } = await boot();
    await at(engine, time, 1, h);
    const pc = await newPc(engine, 'Pillin');
    pc.location = { type: 'spot', id: 'sp_tab_barra' };
    const ctx: ToolContext = { engine, actor: pc, nowGameS: engine.nowFor(pc), rng: seededRng(3), closed: null, rolls: [], progress: [], action_text: 'preguntar a los parroquianos qué es la cena del jabalí' };
    const log = (over: Record<string, unknown>) => JSON.parse(executeTool(ctx, 'log_event', closeWith(over))) as { ok?: boolean; error?: string };
    return { engine, pc, ctx, log };
  }

  it('fuera de la cena, «un labrador te contesta» se rechaza una vez, con quién hay de verdad', async () => {
    const { log } = await tavernAt(22.5);
    const r = log({ narration_private: SEQ_89 });
    expect(r.error).toMatch(/Gente que no existe: «un labrador» que habla/);
    expect(r.error).toMatch(/Aquí están: .*Brenna|Aquí están: .*tabernera/);
    // Una sola vez.
    expect(log({ narration_private: SEQ_89 }).ok).toBe(true);
  });

  it('en la cena, con Benito delante, la misma narración pasa', async () => {
    const { engine, log } = await tavernAt(19.5);
    expect(engine.world.spot(spotOf(engine, 'npc_x_benito')).location_id).toBe('loc_taberna');
    expect(log({ narration_private: SEQ_89 }).error ?? '').not.toMatch(/Gente que no existe/);
  });

  it('mandar al actor a alguien que no existe se rechaza: «un labrador» sin labrador, «el alcalde», «Tomás»', () => {
    const vocabulary = new Set(['brenna', 'doro', 'jabali']);
    const base = { texts: [''], lines: [] as string[], presentRoles: ['tabernera', 'guardia'], allRoles: ['tabernera', 'guardia', 'herrero', 'labrador'], vocabulary };
    expect(inventedPeople({ ...base, suggestions: ['Preguntar a un labrador de la taberna'] })).toEqual([{ kind: 'referral', text: 'un labrador' }]);
    expect(inventedPeople({ ...base, suggestions: ['Preguntar al herrero'] })).toEqual([]);
    expect(inventedPeople({ ...base, suggestions: ['Preguntar al alcalde'] })).toEqual([{ kind: 'referral', text: 'el alcalde' }]);
    expect(inventedPeople({ ...base, lines: ['Ya que lo preguntas. El de la puerta, Tomás, no ha cenado.'], suggestions: [] })).toEqual([{ kind: 'name', text: 'Tomás' }]);
  });

  it('el fondo sin cara pasa: la sala llena, alguien que ríe, una mujer que mira, la multitud que murmura', () => {
    const vocabulary = new Set(['brenna']);
    expect(inventedPeople({
      texts: ['La sala está llena de vecinos; alguien ríe al fondo. Una mujer de chal mira hacia la puerta. Unos vecinos murmuran que eso es cosa de Brenna.'],
      lines: [], suggestions: ['Hablar con Brenna'], presentRoles: ['tabernera'], allRoles: ['tabernera'], vocabulary,
    })).toEqual([]);
  });

  it('los nombres que salen en los datos no son inventos', async () => {
    const { log } = await tavernAt(22.5);
    const r = log({ narration_private: 'Brenna asiente.', lines: [{ speaker: 'npc_brenna', text: 'Eso pregúntaselo a Ilse, la de las hierbas.', to: 'all' }], npc_id: 'npc_brenna' });
    expect(r.error ?? '').not.toMatch(/Gente que no existe/);
  });
});

// ---------------------------------------------------------------------------
// Fase 3: la charla con el relleno, sin IA (extratalk.ts)
// ---------------------------------------------------------------------------

describe('relleno, fase 3: charla sin máster', () => {
  /** Brezal sin máster: lo que conteste, lo contesta el motor. Día 1, 7:00; el PJ junto a `spot`. */
  async function morning(spot: string) {
    // Con los atajos del motor (como en la partida de verdad): la charla con el relleno es uno de ellos.
    const { engine, time } = await boot(new MemoryRepository(), seedNow(), true);
    await at(engine, time, 1, 7);
    const pc = await newPc(engine, 'Pillin');
    pc.location = { type: 'spot', id: spot };
    engine.setPresence(pc.id, true);
    const talk = async (text: string) => {
      const from = engine.events.all().at(-1)?.seq ?? 0;
      const r = await engine.act(pc.id, text);
      // La respuesta del vecino (detrás pueden ir avisos de la historia).
      const ev = engine.events.all().filter((e) => e.seq > from && e.actor_id === pc.id && e.action_type === 'master').at(-1);
      return { text: r.text, ev, line: ((ev?.payload['lines'] as { text: string }[] | undefined) ?? [])[0]?.text ?? null };
    };
    return { engine, pc, talk };
  }

  it('saludar a la panadera: un saludo seco y lo que vende, del motor y sin máster', async () => {
    const { talk } = await morning('sp_pl_horno');
    const r = await talk('Hola, panadera');
    expect(r.ev?.tags).toContain('extra');
    expect(r.ev?.payload['master']).toBeNull();
    expect(r.line).toMatch(/Pan gris.*2 de cobre/);
    expect(r.text).toMatch(/^La panadera contesta sin levantar la vista\./);
  });

  it('«dame un pan» después de hablar con ella: se lo vende, con sus monedas y su existencia', async () => {
    const { engine, pc, talk } = await morning('sp_pl_horno');
    await talk('¿Cuánto vale el pan, panadera?');
    const coins = coinsOf(engine.world, pc.id);
    const r = await talk('Dame un pan');
    expect(r.ev?.payload['bought']).toBe('pan gris ×1');
    expect(coinsOf(engine.world, pc.id)).toBe(coins - 2);
    expect(engine.world.itemsCarriedBy(pc.id).some((i) => i.item_id === 'it_pan_gris')).toBe(true);
    const left = [...engine.world.itemInstances.values()].filter((i) => i.item_id === 'it_pan_gris' && i.location.type === 'npc' && i.location.id === 'npc_x_marta').reduce((n, i) => n + i.quantity, 0);
    expect(left).toBe(5);
  });

  it('lo que no sabe, lo dice y remite a quien sabe; a la segunda le despacha; luego ya no le hace caso', async () => {
    const { pc, talk } = await morning('sp_pl_horno');
    const a = await talk('Panadera, ¿qué sabes del granero quemado?');
    expect(a.line).toMatch(/Brenna|Mateo|Ni idea/);
    if (a.line?.includes('Brenna')) expect(pc.knows).toContain('npc_brenna');
    const b = await talk('Panadera, ¿y de la niebla?');
    expect(TRADES.baker.lines.brush).toContain(b.line);
    const c = await talk('Panadera, ¿y del regidor?');
    expect(c.line).toBeNull();
    expect(c.text).toMatch(/ya no te hace caso/);
    // Lo suyo sí lo sigue contestando.
    const d = await talk('Panadera, ¿cuánto vale el pan?');
    expect(d.line).toMatch(/2 de cobre/);
  });

  it('la niña dice dónde está la curandera, y el PJ aprende su nombre; de la mujer del granero, nada', async () => {
    const { engine, pc, talk } = await morning('sp_pl_pozo');
    pc.location = { type: 'spot', id: spotOf(engine, 'npc_x_pia') };
    const r = await talk('Oye, niña, ¿dónde está la curandera?');
    expect(r.line).toMatch(/Ilse, la curandera: ahora está en Casa de las hierbas/);
    expect(pc.knows).toContain('npc_ilse');
    const y = await talk('Niña, ¿dónde está la mujer del ascua?');
    expect(y.line ?? '').not.toMatch(/Granero/);
  });

  it('la beata dice a qué hora es la misa', async () => {
    const { talk } = await morning('sp_pl_pozo');
    const r = await talk('Beata, ¿a qué hora es la misa?');
    expect(r.line).toBe('La misa del pozo: cada día a las 20:00, en el pozo.');
  });

  it('nunca da una misión, aunque se la pidan', async () => {
    const { talk } = await morning('sp_pl_horno');
    const r = await talk('Panadera, ¿tienes algún trabajo para mí?');
    expect(r.ev?.tags).toContain('extra');
    expect(r.ev?.payload['story_quest']).toBeUndefined();
  });

  it('amenazar o insultar no es charla simple: va al máster', () => {
    return morning('sp_pl_horno').then(({ engine, pc }) => {
      expect(extraReply(engine.world, engine.events.all(), pc, 'Panadera, dame el pan o te parto la cara', engine.nowFor(pc))).toBeNull();
      expect(extraReply(engine.world, engine.events.all(), pc, 'Panadera, eres una inútil', engine.nowFor(pc))).toBeNull();
    });
  });

  it('a quien le pegó, le tiene miedo: no le atiende y se va a su casa', async () => {
    const { engine, pc, talk } = await morning('sp_pl_horno');
    const marta = engine.world.npc('npc_x_marta');
    marta.attitude.by_character[pc.id] = 'hostile';
    const r = await talk('Hola, panadera');
    expect(TRADES.baker.lines.afraid).toContain(r.line);
    expect(r.text).toMatch(/se aparta de ti y se marcha/);
    expect(spotOf(engine, 'npc_x_marta')).toBe('sp_pl_casas');
  });

  it('si sabe que le robó, se lo echa en cara', async () => {
    const { engine, pc, talk } = await morning('sp_pl_horno');
    (engine.world.campaign as unknown as { incidents: unknown[] }).incidents = [{
      id: 'inc_t', kind: 'theft', severity: 1, game_s: engine.gameNow(), updated_game_s: engine.gameNow(), location_id: 'loc_plaza', spot_id: 'sp_pl_horno',
      perpetrator_id: pc.id, perpetrator_name: pc.name, victim_id: 'npc_x_marta', victim_name: 'Marta', weapon: null, crowd: null,
      knowers: [{ npc_id: 'npc_x_marta', how: 'saw' }], announced: 1, narrated_to: [], crowd_alert_game_s: null, rep_applied: 0, infamy_applied: 0,
    }];
    const r = await talk('Hola, panadera');
    expect(TRADES.baker.lines.accuse).toContain(r.line);
  });

  it('una noticia que sabe la cuenta al saludar, una vez', async () => {
    const { engine, talk } = await morning('sp_pl_horno');
    setFact(engine.world, { id: 'npc_dead:npc_hugo', text: 'Han encontrado muerto al herrero en la fragua.', by: null, subject: 'npc_hugo', location_id: 'loc_herreria', game_s: engine.gameNow(), knowers: [{ npc_id: 'npc_x_marta', how: 'told', from: null, game_s: engine.gameNow() }] });
    const a = await talk('Hola, panadera');
    expect(a.line).toMatch(/Han encontrado muerto al herrero en la fragua/);
    const b = await talk('Buenos días, panadera');
    expect(b.line ?? '').not.toMatch(/herrero/);
  });
});

// ---------------------------------------------------------------------------
// Fase 5: relleno en los mundos generados (worldgen/extras.ts)
// ---------------------------------------------------------------------------

describe('relleno, fase 5: mundos generados', () => {
  const gen = (seed: number, setting: string) => generateSeed({ seed, tone: TONES[seed % TONES.length]!, setting, client: null, env: { MASTER_MODE: 'offline' } });
  const SETTINGS = ['fantasía medieval', 'ciencia ficción en una estación espacial', 'postapocalíptico tras el colapso'];

  it('cada género monta su relleno, con oficio de su género, horario, casa cerrada y llave; y pasa el validador', async () => {
    for (const setting of SETTINGS) {
      for (const seed of [1, 2, 3]) {
        const s = await gen(seed, setting);
        expect(validateSnapshot(s), `${setting} ${seed}`).toEqual([]);
        const ex = s.npcs.filter(isExtra);
        if ((s.campaign as unknown as { generation: { settlement: string } }).generation.settlement === 'pueblo abandonado') continue;
        expect(ex.length, `${setting} ${seed}`).toBeGreaterThan(1);
        const home = s.spots.find((sp) => sp.tags.includes('dwelling'))!;
        expect(home.state).toMatchObject({ locked: true, key_item_id: 'it_llave_casas' });
        expect(s.item_instances.some((i) => i.item_id === 'it_llave_casas' && i.location.type === 'npc')).toBe(true);
        for (const n of ex) {
          expect(n.home_spot_id, n.id).toBe(home.id);
          expect(Object.values((n as unknown as { routine: Record<string, string> }).routine)).toContain(home.id);
          expect(n.script.refer_to.length, n.id).toBe(1);
        }
      }
    }
  });

  it('la misma semilla da los mismos vecinos; los principales no cambian por tenerlos', async () => {
    const a = await gen(7, SETTINGS[0]!);
    const b = await gen(7, SETTINGS[0]!);
    expect(a.npcs.filter(isExtra).map((n) => `${n.id}:${n.role}:${n.location.id}`)).toEqual(b.npcs.filter(isExtra).map((n) => `${n.id}:${n.role}:${n.location.id}`));
    const sk = buildSkeleton({ seed: 7, tone: TONES[7 % TONES.length]!, setting: SETTINGS[0]! });
    expect(a.npcs.filter((n) => !isExtra(n)).map((n) => n.id)).toEqual(sk.npcs.map((n) => n.id));
  });

  it('los nombres son del género del mundo y no se repiten con los de los principales', async () => {
    const s = await gen(2, SETTINGS[1]!);
    const ex = s.npcs.filter(isExtra);
    const principals = new Set(s.npcs.filter((n) => !isExtra(n)).map((n) => n.name.split(' ')[0]));
    for (const n of ex) expect(principals.has(n.name)).toBe(false);
    expect(new Set(ex.map((n) => n.name)).size).toBe(ex.length);
  });

  it('el pueblo abandonado tiene uno como mucho', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = await gen(seed, SETTINGS[0]!);
      if ((s.campaign as unknown as { generation: { settlement: string } }).generation.settlement !== 'pueblo abandonado') continue;
      expect(s.npcs.filter(isExtra).length).toBeLessThanOrEqual(1);
      return;
    }
  });
});
