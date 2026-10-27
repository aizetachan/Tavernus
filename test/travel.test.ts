import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike, SceneHints } from '../src/engine/engine.js';
import { estimateTravel, moveTo } from '../src/engine/movement.js';
import {
  aheadUntil, journeyOf, parseTravel, rollTravelEncounter, travelEncounterChance, travelNote, waypointSpotId,
} from '../src/engine/travel.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { bootEngine, fakeTime, freshWorld } from './helpers.js';

const NO_ENCOUNTER = () => 0.99;

/** Máster de prueba: apunta las pistas de escena y el contexto que montaría prompt.ts. */
function recorder(engine: Engine) {
  const calls: { text: string; hints: SceneHints | null; context: string }[] = [];
  const master: MasterLike = {
    async resolve(actor, text, roll, intro, scene) {
      calls.push({ text, hints: engine.sceneHints(actor.id), context: actionContext(engine, actor, text, roll, intro, scene) });
      return {
        ok: true, usage: {}, calls: [], context: '', model: 'stub',
        closed: { narration_private: 'El master narra.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: ['Continuar el viaje'], requires_roll: null },
      };
    },
  };
  return { master, calls };
}

/** Kael en el portón de la plaza, a 600 m del claro; Mira fuera de escena (en la taberna). */
async function atGate(opts: Parameters<typeof bootEngine>[1] = {}, time = fakeTime()) {
  const { engine } = await bootEngine(time, { rng: NO_ENCOUNTER, ...opts });
  engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_pl_porton' };
  engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_chimenea' };
  return { engine, time };
}

/** Deja que la cola procese lo que el motor encoló (escena de llegada o de encuentro). */
async function drain(engine: Engine, id = 'ch_kael') { await engine.act(id, 'inventario'); }

const forceEncounters = (engine: Engine, chance: number) => { engine.world.location('loc_claro').state['travel_encounter_chance'] = chance; };

describe('viaje rápido', () => {
  it('la llegada es inmediata en tiempo real y el reloj del PJ queda en la hora de llegada', async () => {
    const { engine } = await atGate();
    const t0 = engine.gameNow();
    const expected = estimateTravel(engine.world, 'ch_kael', 'sp_cl_sendero', 'walk', t0)!;
    expect(expected).toBeGreaterThan(5 * 60); // ~7 min de juego (~2,5 min reales antes)

    const r = await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(r.ok).toBe(true);
    const kael = engine.world.character('ch_kael');
    // Sin avanzar el reloj real: ya está en el claro, sin tránsito.
    expect(engine.gameNow()).toBe(t0);
    expect(kael.transit).toBeNull();
    expect(engine.world.spot(kael.location.id).location_id).toBe('loc_claro');
    // El tiempo de juego sí ha corrido para él.
    expect(engine.nowFor(kael)).toBeCloseTo(t0 + expected, 5);
    expect(aheadUntil(kael)).toBeCloseTo(t0 + expected, 5);
    const arrived = engine.events.all().find((e) => e.action_type === 'arrived')!;
    expect(arrived.timestamp_game_s).toBeCloseTo(t0 + expected, 0);
    expect(arrived.narration_private).toMatch(/Has tardado 7 min de camino/);
    expect(await engine.command('ch_kael', '/time')).toMatch(/por delante del reloj del mundo/);
  });

  it('movimiento dentro de la localización sigue siendo en tiempo real', async () => {
    const { engine, time } = await atGate();
    await engine.act('ch_kael', 'ir al pozo');
    const kael = engine.world.character('ch_kael');
    expect(kael.transit?.destination_spot_id).toBe('sp_pl_pozo');
    expect(aheadUntil(kael)).toBeNull();
    time.advanceGame(kael.transit!.arrives_game_s - kael.transit!.departed_game_s + 1);
    await engine.tick();
    expect(kael.location.id).toBe('sp_pl_pozo');
  });

  it('el reloj del PJ se alcanza: luego vuelve a ser el del mundo', async () => {
    const { engine, time } = await atGate();
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    const kael = engine.world.character('ch_kael');
    const until = aheadUntil(kael)!;
    time.advanceGame(until - engine.gameNow() + 30);
    await engine.tick();
    expect(aheadUntil(kael)).toBeNull();
    expect(engine.nowFor(kael)).toBe(engine.gameNow());
  });

  it('dos PJs en la plaza: uno viaja y vuelve, actúa sin espera y su reloj queda igualado al del otro', async () => {
    const { engine } = await atGate();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_pl_pozo' }; // Mira se queda en la plaza
    engine.setPresence('ch_mira', true);
    const kael = engine.world.character('ch_kael');
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(aheadUntil(kael)).not.toBeNull(); // en el claro, solo: va por delante
    await engine.act('ch_kael', 'ir al pozo');
    expect(engine.world.spot(kael.location.id).location_id).toBe('loc_plaza');

    // De vuelta con Mira: su hora es la de ella, sin «has llegado antes» ni espera.
    expect(aheadUntil(kael)).toBeNull();
    expect(engine.nowFor('ch_kael')).toBe(engine.nowFor('ch_mira'));
    const r = await engine.act('ch_kael', 'mirar');
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/⏳/);
    expect(await engine.command('ch_kael', '/time')).toBe(await engine.command('ch_mira', '/time'));
  });

  it('llega a donde ya hay otro PJ con una hora anterior: actúa en el acto, también la tirada', async () => {
    const { engine } = await atGate();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_cl_roble' }; // Mira ya está en el claro
    engine.setPresence('ch_mira', true);
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(engine.world.spot(engine.world.character('ch_kael').location.id).location_id).toBe('loc_claro');
    expect(engine.nowFor('ch_kael')).toBe(engine.nowFor('ch_mira'));
    expect((await engine.act('ch_kael', 'mirar')).ok).toBe(true);
    expect((await engine.act('ch_mira', 'mirar')).ok).toBe(true);
    expect((await engine.rollPending('ch_kael')).text).not.toMatch(/⏳/);
  });

  it('adelantado y con alguien detrás, sí puede marcharse', async () => {
    const { engine } = await atGate({ deterministic: true });
    engine.attachMaster(recorder(engine).master);
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_cl_roble' };
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    const r = await engine.act('ch_kael', 'salir hacia la plaza del pozo');
    expect(r.ok).toBe(true);
    expect(engine.world.spot(engine.world.character('ch_kael').location.id).location_id).toBe('loc_plaza');
  });

  it('con nadie más mirando en el destino sigue por delante, sin esperar', async () => {
    const { engine } = await atGate();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_cl_roble' };
    engine.setPresence('ch_mira', true);
    engine.setAway('ch_mira', true); // cerró la pestaña: su PJ se queda, pero no hay hora que compartir
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(aheadUntil(engine.world.character('ch_kael'))).not.toBeNull();
    expect((await engine.act('ch_kael', 'mirar')).ok).toBe(true);
  });

  it('un PJ guardado como conectado no cuenta al cargar: nadie está conectado hasta que abre su pestaña', async () => {
    expect(makeSeed().characters.find((c) => c.id === 'ch_mira')!.connected).toBe(true); // así quedó guardada
    const { engine } = await atGate({ offline: true });
    const mira = engine.world.character('ch_mira');
    expect(mira.connected).toBe(false);
    expect(mira.veiled).toBe(false); // un reinicio no duerme a nadie
    expect(mira.status).toBe('active');
    mira.location = { type: 'spot', id: 'sp_cl_roble' };
    // Sin pestaña de Mira, Kael llega al claro con su hora y actúa.
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(aheadUntil(engine.world.character('ch_kael'))).not.toBeNull();
    expect((await engine.act('ch_kael', 'mirar')).ok).toBe(true);
    // Si el adaptador la da por ida sin haber vuelto, llega el velo como siempre.
    engine.setPresence('ch_mira', false);
    expect(mira.veiled).toBe(true);
    expect(mira.status).toBe('asleep');
  });
});

describe('encuentros por el camino', () => {
  it('la tirada es determinista con la semilla: misma semilla, mismo resultado; unas salen y otras no', () => {
    const outcomes: (string | null)[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const run = () => {
        const { world, clock, t0 } = freshWorld();
        world.character('ch_kael').location = { type: 'spot', id: 'sp_pl_porton' };
        const r = moveTo(world, 'ch_kael', 'sp_cl_sendero', 'walk', t0);
        if (!r.ok) throw new Error('sin ruta');
        const e = rollTravelEncounter(world, clock, r.transit, seededRng(seed));
        return e ? `${e.entry.id}@${Math.round(e.at_game_s)}` : null;
      };
      const a = run();
      expect(run()).toBe(a);
      outcomes.push(a);
    }
    expect(outcomes.some((o) => o !== null)).toBe(true);
    expect(outcomes.some((o) => o === null)).toBe(true);
  });

  it('más de noche, menos con cuidado, nada al cruzar una puerta', () => {
    const { world, clock, t0 } = freshWorld();
    world.character('ch_kael').location = { type: 'spot', id: 'sp_pl_porton' };
    const day0 = Math.floor(t0 / GAME_DAY) * GAME_DAY;
    const at = (h: number, pace: 'walk' | 'stealth') => {
      const r = moveTo(world, 'ch_kael', 'sp_cl_sendero', pace, day0 + h * GAME_HOUR);
      if (!r.ok) throw new Error('sin ruta');
      world.character('ch_kael').transit = null;
      return travelEncounterChance(world, clock, r.transit).chance;
    };
    expect(at(23, 'walk')).toBeGreaterThan(at(12, 'walk'));
    expect(at(12, 'stealth')).toBeLessThan(at(12, 'walk'));
    expect(at(12, 'walk')).toBeGreaterThan(0);
    world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_puerta' };
    const door = moveTo(world, 'ch_kael', 'sp_pl_taberna', 'walk', t0);
    if (!door.ok) throw new Error('sin ruta');
    expect(travelEncounterChance(world, clock, door.transit).chance).toBe(0);
  });

  it('si sale, el viaje se para en el punto de camino y el master narra con el encuentro delante', async () => {
    const { engine } = await atGate({ rng: () => 0.5, deterministic: true }); // 0,5: sale el encuentro (forzado a 1), no el imprevisto de la acción
    engine.world.npc('npc_lobo').location = { type: 'spot', id: 'sp_tab_habitacion' }; // sin el lobo hostil del claro, la salida es trivial
    forceEncounters(engine, 1);
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    const t0 = engine.gameNow();
    const total = estimateTravel(engine.world, 'ch_kael', 'sp_cl_sendero', 'walk', t0)!;

    await engine.act('ch_kael', 'salir hacia el claro del roble');
    await drain(engine);
    const kael = engine.world.character('ch_kael');
    expect(kael.location.id).toBe(waypointSpotId('ex_plaza_claro'));
    expect(engine.world.location('loc_way_ex_plaza_claro').name).toBe('Camino entre Plaza del Pozo y Claro del Roble');
    expect(journeyOf(kael)).toMatchObject({ destination_spot_id: 'sp_cl_sendero', encounter_id: 'find' });
    // A mitad del tramo, en juego; sin esperar en real.
    expect(engine.nowFor(kael)).toBeCloseTo(t0 + total / 2, 0);

    const ev = engine.events.all().find((e) => e.action_type === 'travel_encounter')!;
    expect(ev.narration_private).toMatch(/^🛤️ A medio camino hacia Claro del Roble \(quedan 300 m/);
    const scene = calls.find((c) => c.hints?.travel?.kind === 'encounter')!;
    expect(scene).toBeDefined();
    expect(scene.context).toContain('## Encuentro en el camino');
    expect(scene.context).toMatch(/Le quedan 300 m/);
    expect(scene.context).toContain('Un hallazgo junto al camino');
    expect(scene.context).toContain('«Continuar el viaje»');
  });

  it('«Continuar el viaje» tras el encuentro llega al destino y cuenta todo el trayecto', async () => {
    const { engine } = await atGate({ rng: () => 0 });
    forceEncounters(engine, 1);
    const t0 = engine.gameNow();
    const total = estimateTravel(engine.world, 'ch_kael', 'sp_cl_sendero', 'walk', t0)!;
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(engine.world.character('ch_kael').location.id).toBe(waypointSpotId('ex_plaza_claro'));
    // Sin master: lo dice la plantilla.
    expect(engine.events.all().find((e) => e.action_type === 'travel_encounter')!.narration_private).toContain('«Continuar el viaje»');

    const r = await engine.act('ch_kael', 'Continuar el viaje');
    expect(r.ok).toBe(true);
    const kael = engine.world.character('ch_kael');
    expect(kael.location.id).toBe('sp_cl_sendero');
    expect(kael.transit).toBeNull();
    expect(journeyOf(kael)).toBeNull();
    expect(engine.nowFor(kael)).toBeCloseTo(t0 + total, 0);
    // Una sola escena intermedia: la continuación no vuelve a tirar.
    expect(engine.events.all().filter((e) => e.action_type === 'travel_encounter')).toHaveLength(1);
    expect(engine.events.all().filter((e) => e.action_type === 'arrived').at(-1)!.narration_private).toMatch(/Has tardado 7 min de camino/);
    // Sin viaje a medias, continuar no hace nada.
    expect((await engine.act('ch_kael', 'continuar el viaje')).text).toBe('No tienes ningún viaje a medias.');
  });

  it('el punto de camino se reutiliza y desde él se puede volver', async () => {
    const { engine } = await atGate({ rng: () => 0.5, deterministic: true }); // 0,5: sale el encuentro (forzado a 1), no el imprevisto de la acción
    engine.world.npc('npc_lobo').location = { type: 'spot', id: 'sp_tab_habitacion' }; // sin el lobo hostil del claro, la salida es trivial
    engine.attachMaster(recorder(engine).master);
    forceEncounters(engine, 1);
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    const r = await engine.act('ch_kael', 'salir hacia la plaza del pozo');
    expect(r.ok).toBe(true);
    expect(engine.world.character('ch_kael').location.id).toBe('sp_pl_porton');
    expect(journeyOf(engine.world.character('ch_kael'))).toBeNull();
    const spots = engine.world.spots.size;
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(engine.world.character('ch_kael').location.id).toBe(waypointSpotId('ex_plaza_claro'));
    expect(engine.world.spots.size).toBe(spots);
  });

  it('sin encuentro no hay escena intermedia: llegada directa', async () => {
    const { engine } = await atGate({ rng: () => 0 });
    forceEncounters(engine, 0);
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(engine.world.character('ch_kael').location.id).toBe('sp_cl_sendero');
    expect(engine.events.all().some((e) => e.action_type === 'travel_encounter')).toBe(false);
    expect(engine.world.locations.has('loc_way_ex_plaza_claro')).toBe(false);
  });

  it('la tabla de la campaña manda sobre la de por defecto', async () => {
    const { engine } = await atGate({ rng: () => 0 });
    forceEncounters(engine, 1);
    (engine.world.campaign as unknown as { encounters: unknown }).encounters = { forest: [{ id: 'fantasma', what: 'Un fantasma.', teaser: 'Hace frío de golpe.' }] };
    await engine.act('ch_kael', 'salir hacia el claro del roble');
    expect(journeyOf(engine.world.character('ch_kael'))?.encounter_id).toBe('fantasma');
    expect(engine.events.all().find((e) => e.action_type === 'travel_encounter')!.narration_private).toContain('Hace frío de golpe.');
  });
});

describe('ritmo y tiempo en la narración', () => {
  it('«viajar con cuidado hacia X» va con sigilo: más tiempo de juego', async () => {
    const { engine } = await atGate();
    const t0 = engine.gameNow();
    const walk = estimateTravel(engine.world, 'ch_kael', 'sp_cl_sendero', 'walk', t0)!;
    const careful = estimateTravel(engine.world, 'ch_kael', 'sp_cl_sendero', 'stealth', t0)!;
    const r = await engine.act('ch_kael', 'viajar con cuidado hacia el claro del roble');
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/con cuidado/);
    expect(engine.world.character('ch_kael').location.id).toBe('sp_cl_sendero');
    expect(engine.nowFor('ch_kael')).toBeCloseTo(t0 + careful, 0);
    expect(careful).toBeGreaterThan(walk * 1.5);
  });

  it('reconoce las frases de viaje', () => {
    expect(parseTravel('Continuar el viaje')).toEqual({ kind: 'continue', careful: false });
    expect(parseTravel('sigo mi camino con cuidado')).toEqual({ kind: 'continue', careful: true });
    expect(parseTravel('Viajar con cuidado hacia Claro del Roble')).toEqual({ kind: 'careful', target: 'claro del roble' });
    expect(parseTravel('salgo hacia el claro con cuidado')).toEqual({ kind: 'careful', target: 'el claro' });
    expect(parseTravel('salir hacia el claro')).toBeNull();
  });

  it('la nota de llegada dice cuánto ha costado y si cambia la luz', () => {
    const { clock, t0 } = freshWorld();
    const day0 = Math.floor(t0 / GAME_DAY) * GAME_DAY;
    expect(travelNote(clock, day0 + 18 * GAME_HOUR, day0 + 20 * GAME_HOUR + 10 * 60)).toBe('Has tardado 2 h 10 min de camino; anochece. Son las 20:10.');
    expect(travelNote(clock, day0 + 10 * GAME_HOUR, day0 + 10 * GAME_HOUR + 7 * 60)).toBe('Has tardado 7 min de camino. Son las 10:07.');
    expect(travelNote(clock, day0 + 10 * GAME_HOUR, day0 + 10 * GAME_HOUR + 20)).toBe('');
  });
});
