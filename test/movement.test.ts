import { describe, expect, it } from 'vitest';
import { estimateTravel, interruptTransit, moveTo, positionOf, settleTransit, speedMps } from '../src/engine/movement.js';
import { freshWorld } from './helpers.js';

describe('movimiento', () => {
  it('dentro de una localización: tiempo = distancia / velocidad', () => {
    const { world, t0 } = freshWorld();
    const r = moveTo(world, 'ch_kael', 'sp_tab_mesa', 'walk', t0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // barra (6,2) → mesa (10,6): 5.657 m a 1.5 m/s
    expect(r.total_s).toBeCloseTo(Math.hypot(4, 4) / 1.5, 5);
    expect(r.transit.legs).toHaveLength(1);
    expect(world.character('ch_kael').transit).not.toBeNull();
  });

  it('correr tarda la mitad; sigilo el doble', () => {
    const { world, t0 } = freshWorld();
    const walk = estimateTravel(world, 'ch_kael', 'sp_tab_mesa', 'walk', t0)!;
    expect(estimateTravel(world, 'ch_kael', 'sp_tab_mesa', 'run', t0)).toBeCloseTo(walk / 2, 6);
    expect(estimateTravel(world, 'ch_kael', 'sp_tab_mesa', 'stealth', t0)).toBeCloseTo(walk * 2, 6);
  });

  it('entre localizaciones: Dijkstra por salidas con tramos internos', () => {
    const { world, t0 } = freshWorld();
    const r = moveTo(world, 'ch_kael', 'sp_cl_roble', 'walk', t0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = 1.5;
    const expected =
      Math.hypot(6, 2) / v +                 // barra → puerta
      3 / v +                                // salida taberna → plaza
      Math.hypot(30, 20) / v +               // puerta taberna → portón
      600 / (v * 0.9) +                      // camino al claro
      Math.hypot(25, 15) / v;                // sendero → roble
    expect(r.total_s).toBeCloseTo(expected, 3);
    expect(r.transit.legs.map((l) => l.to_spot_id)).toEqual(['sp_tab_puerta', 'sp_pl_taberna', 'sp_pl_porton', 'sp_cl_sendero', 'sp_cl_roble']);
    expect(r.transit.legs[1]!.via_exit_id).toBe('ex_tab_plaza');
  });

  it('el mismo origen y velocidad dan el mismo tiempo; distinto origen, proporcional', () => {
    const { world, t0 } = freshWorld();
    const kael = world.character('ch_kael');
    const mira = world.character('ch_mira');
    mira.location = { type: 'spot', id: 'sp_cl_sendero' };
    kael.location = { type: 'spot', id: 'sp_cl_piedra' };
    const tMira = estimateTravel(world, 'ch_mira', 'sp_cl_roble', 'walk', t0)!;
    const tKael = estimateTravel(world, 'ch_kael', 'sp_cl_roble', 'walk', t0)!;
    expect(tMira).toBeCloseTo(Math.hypot(25, 15) / 1.5, 5);
    expect(tKael).toBeCloseTo(Math.hypot(13, 5) / 1.5, 5);
    kael.location = { type: 'spot', id: 'sp_cl_sendero' };
    expect(estimateTravel(world, 'ch_kael', 'sp_cl_roble', 'walk', t0)).toBeCloseTo(tMira, 6);
  });

  it('asienta tramos con el reloj, interpola la posición y emite la llegada', () => {
    const { world, t0 } = freshWorld();
    const r = moveTo(world, 'ch_kael', 'sp_pl_pozo', 'walk', t0);
    if (!r.ok) throw new Error('move failed');
    const c = world.character('ch_kael');
    // A mitad del primer tramo sigue "en" la barra pero con progreso.
    const half = t0 + r.transit.legs[0]!.duration_s / 2;
    const p = positionOf(world, c, half);
    expect(p.spot_id).toBe('sp_tab_barra');
    expect(p.next_spot_id).toBe('sp_tab_puerta');
    expect(p.progress).toBeCloseTo(0.5, 5);
    expect(p.x).toBeCloseTo(3, 5);
    expect(p.y).toBeCloseTo(1, 5);

    // Tras el segundo tramo está en la plaza.
    const afterTwo = r.transit.legs[1]!.ends_game_s + 0.01;
    const s = settleTransit(world, c, afterTwo);
    expect(s.reached.map((x) => x.spot_id)).toEqual(['sp_tab_puerta', 'sp_pl_taberna']);
    expect(s.arrived).toBe(false);
    expect(world.characterSpot(c)!.id).toBe('sp_pl_taberna');
    expect(c.transit!.legs).toHaveLength(1);

    const s2 = settleTransit(world, c, r.transit.arrives_game_s);
    expect(s2.arrived).toBe(true);
    expect(c.transit).toBeNull();
    expect(world.characterSpot(c)!.id).toBe('sp_pl_pozo');
    expect(settleTransit(world, c, r.transit.arrives_game_s + 100)).toEqual({ reached: [], arrived: false });
  });

  it('cambiar de destino a mitad de tramo parte de la posición actual', () => {
    const { world, t0 } = freshWorld();
    const r = moveTo(world, 'ch_kael', 'sp_tab_mesa', 'walk', t0);
    if (!r.ok) throw new Error('move failed');
    const half = t0 + r.transit.legs[0]!.duration_s / 2;
    // Volver a la barra desde mitad de camino cuesta la mitad del tramo.
    const back = moveTo(world, 'ch_kael', 'sp_tab_barra', 'walk', half);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.total_s).toBeCloseTo(r.total_s / 2, 5);
    expect(back.transit.legs).toHaveLength(1);
    expect(back.transit.legs[0]!.distance_m).toBeCloseTo(Math.hypot(4, 4) / 2, 5);
  });

  it('interrumpir deja al PJ en el extremo más cercano del tramo', () => {
    const { world, t0 } = freshWorld();
    const r = moveTo(world, 'ch_kael', 'sp_tab_mesa', 'walk', t0);
    if (!r.ok) throw new Error('move failed');
    const c = world.character('ch_kael');
    expect(interruptTransit(world, c, t0 + r.total_s * 0.3)).toBe('sp_tab_barra');
    const r2 = moveTo(world, 'ch_kael', 'sp_tab_mesa', 'walk', t0);
    if (!r2.ok) throw new Error('move failed');
    expect(interruptTransit(world, c, t0 + r2.total_s * 0.8)).toBe('sp_tab_mesa');
    expect(c.transit).toBeNull();
  });

  it('no encuentra ruta a puntos ocultos no descubiertos, sí tras descubrirlos', () => {
    const { world, t0 } = freshWorld();
    const r = moveTo(world, 'ch_kael', 'sp_tab_trampilla', 'walk', t0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('unknown_spot');
    world.spot('sp_tab_trampilla').discovered_by.push('ch_kael');
    expect(moveTo(world, 'ch_kael', 'sp_tab_trampilla', 'walk', t0).ok).toBe(true);
  });

  it('respeta la capacidad del punto', () => {
    const { world, t0 } = freshWorld();
    world.spot('sp_tab_trampilla').discovered_by.push('ch_kael', 'ch_mira');
    world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_trampilla' };
    const r = moveTo(world, 'ch_kael', 'sp_tab_trampilla', 'walk', t0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ code: 'spot_full', spot_id: 'sp_tab_trampilla', capacity: 1 });
  });

  it('una salida bloqueada corta la ruta', () => {
    const { world, t0 } = freshWorld();
    world.exit('ex_plaza_claro').state.blocked_by = 'derrumbe';
    const r = moveTo(world, 'ch_kael', 'sp_cl_roble', 'walk', t0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_route');
  });

  it('a lomos de un vehículo se usa su velocidad y solo conduce el dueño', () => {
    const { world, t0 } = freshWorld();
    const kael = world.character('ch_kael');
    const mula = world.vehicle('vh_mula');
    kael.location = { type: 'vehicle', id: mula.id };
    expect(moveTo(world, 'ch_kael', 'sp_pl_pozo', 'walk', t0).ok).toBe(false);
    mula.owner_id = kael.id;
    expect(speedMps(world, kael, 'walk')).toBeCloseTo(1.5 * 40 / 30, 6);
    const r = moveTo(world, 'ch_kael', 'sp_pl_pozo', 'walk', t0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    settleTransit(world, kael, r.transit.arrives_game_s);
    expect(mula.location.id).toBe('sp_pl_pozo');
    expect(world.characterSpot(kael)!.id).toBe('sp_pl_pozo');
    expect(world.charactersAt('sp_pl_pozo').map((c) => c.id).sort()).toEqual(['ch_kael', 'ch_mira']);
  });

  it('un PJ dormido no se mueve', () => {
    const { world, t0 } = freshWorld();
    world.character('ch_kael').status = 'asleep';
    const r = moveTo(world, 'ch_kael', 'sp_tab_mesa', 'walk', t0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_active');
  });
});
