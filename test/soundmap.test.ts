import { describe, it, expect } from 'vitest';
import { cuesFor, floorOf, ambienceOf, isDoor, placeOf, soundCuesOf, currentAmbience, SOUND_KEYS, type Place } from '../src/adapters/web/soundmap.js';
import { RECIPE_KEYS } from '../src/adapters/web/sfx.js';
import { bootEngine, freshWorld } from './helpers.js';
import type { Delivery } from '../src/engine/events.js';

const taberna: Place = { location_id: 'loc_taberna', indoor: true, floor: 'madera', ambience: 'taberna' };
const plaza: Place = { location_id: 'loc_plaza', indoor: false, floor: 'piedra', ambience: 'plaza' };

describe('cuesFor (evento → claves de sonido)', () => {
  it('salir de la taberna: pasos sobre madera, puerta que abre y cierra, y el ambiente de fuera', () => {
    expect(cuesFor({ type: 'move', here: taberna, crossing: { to: plaza, door: true } }))
      .toEqual(['pasos-madera', 'puerta-abrir', 'puerta-cerrar', 'ambiente-plaza']);
  });

  it('entrar desde la plaza: pasos en piedra, puerta y ambiente de taberna', () => {
    expect(cuesFor({ type: 'move', here: plaza, crossing: { to: taberna, door: true } }))
      .toEqual(['pasos-piedra', 'puerta-abrir', 'puerta-cerrar', 'ambiente-taberna']);
  });

  it('cruzar sin puerta no suena a puerta; moverse dentro del mismo sitio son solo pasos', () => {
    const bosque: Place = { location_id: 'loc_claro', indoor: false, floor: 'tierra', ambience: 'bosque' };
    expect(cuesFor({ type: 'move', here: bosque, crossing: { to: { ...bosque, location_id: 'loc_otro' }, door: false } })).toEqual(['pasos-tierra', 'ambiente-bosque']);
    expect(cuesFor({ type: 'move', here: taberna })).toEqual(['pasos-madera']);
  });

  it('el máster que mueve con move_to suena igual que el atajo', () => {
    expect(cuesFor({ type: 'master', here: taberna, calls: ['move_to'], crossing: { to: plaza, door: true } }))
      .toEqual(cuesFor({ type: 'move', here: taberna, crossing: { to: plaza, door: true } }));
  });

  it('llegar fija el ambiente; entrar en la partida, también', () => {
    expect(cuesFor({ type: 'arrived', here: plaza })).toEqual(['pasos-piedra', 'ambiente-plaza']);
    expect(cuesFor({ type: 'master_arrival', here: plaza })).toEqual(['pasos-piedra', 'ambiente-plaza']);
    expect(cuesFor({ type: 'character_joined', here: taberna })).toEqual(['ambiente-taberna']);
  });

  it('coger y soltar; el dinero suena a moneda', () => {
    expect(cuesFor({ type: 'take', here: taberna })).toEqual(['objeto-coger']);
    expect(cuesFor({ type: 'take', here: taberna, coins: true })).toEqual(['moneda']);
    expect(cuesFor({ type: 'drop', here: taberna })).toEqual(['objeto-soltar']);
    expect(cuesFor({ type: 'master', here: taberna, calls: ['buy_item'] })).toEqual(['moneda']);
  });

  it('tirada, ataque y daño', () => {
    expect(cuesFor({ type: 'roll', here: taberna, roll: { success: true } })).toEqual(['dado']);
    expect(cuesFor({ type: 'roll', here: taberna, attack: { hit: true, down: true } })).toEqual(['dado', 'espada-golpe', 'dano']);
    expect(cuesFor({ type: 'roll', here: taberna, attack: { hit: false, down: false } })).toEqual(['dado', 'espada-fallo']);
    expect(cuesFor({ type: 'master', here: taberna, calls: ['roll_check', 'apply_damage'] })).toEqual(['dado', 'dano']);
  });

  it('sin sonido para lo que no lo merece', () => {
    for (const type of ['look', 'say', 'shout', 'whisper', 'wait', 'sleep', 'wake', 'stop', 'passed', 'progress_level'] as const) {
      expect(cuesFor({ type, here: taberna }), type).toEqual([]);
    }
    expect(cuesFor({ type: 'master', here: taberna, calls: ['get_location', 'who_is_here', 'log_event'] })).toEqual([]);
  });

  it('todas las claves que puede emitir tienen receta en el catálogo del navegador', () => {
    for (const k of SOUND_KEYS) expect(RECIPE_KEYS, k).toContain(k);
  });
});

describe('suelo, ambiente y puertas desde los datos del mundo', () => {
  it('suelo: interior de madera, plaza empedrada, claro de tierra, arroyo de agua', () => {
    const { world } = freshWorld();
    expect(floorOf(world, world.spot('sp_tab_barra'))).toBe('madera');
    expect(floorOf(world, world.spot('sp_pl_pozo'))).toBe('piedra');
    expect(floorOf(world, world.spot('sp_cl_roble'))).toBe('tierra');
    expect(floorOf(world, world.spot('sp_cl_arroyo'))).toBe('agua');
  });

  it('el suelo explícito en location.state.floor manda', () => {
    const { world } = freshWorld();
    world.location('loc_taberna').state['floor'] = 'piedra';
    expect(floorOf(world, world.spot('sp_tab_barra'))).toBe('piedra');
  });

  it('ambiente: taberna, plaza y bosque de día; de noche cambia fuera y no dentro', () => {
    const { world, clock, t0 } = freshWorld();
    const e = { clock };
    expect(ambienceOf(world, e, world.location('loc_taberna'), t0)).toBe('taberna');
    expect(ambienceOf(world, e, world.location('loc_plaza'), t0)).toBe('plaza');
    expect(ambienceOf(world, e, world.location('loc_claro'), t0)).toBe('bosque');
    const night = t0 + 15 * 3600; // 08:00 + 15 h = 23:00
    expect(ambienceOf(world, e, world.location('loc_plaza'), night)).toBe('plaza-noche');
    expect(ambienceOf(world, e, world.location('loc_claro'), night)).toBe('bosque-noche');
    expect(ambienceOf(world, e, world.location('loc_taberna'), night)).toBe('taberna');
  });

  it('la herrería suena a fragua aunque sea un interior ruidoso; otro interior tranquilo, a interior', () => {
    const { world, clock, t0 } = freshWorld();
    const e = { clock };
    const loc = world.location('loc_taberna');
    loc.name = 'La herrería';
    expect(ambienceOf(world, e, loc, t0)).toBe('herreria');
    expect(ambienceOf(world, e, loc, t0 + 15 * 3600)).toBe('herreria');
    loc.name = 'La casa del molinero';
    loc.ambience.noise = 0.1;
    expect(ambienceOf(world, e, loc, t0)).toBe('interior');
    const fuera = world.location('loc_plaza');
    fuera.name = 'La forja del camino';
    expect(ambienceOf(world, e, fuera, t0)).toBe('herreria');
  });

  it('la lluvia (location.state.weather) tapa el ambiente de fuera', () => {
    const { world, clock, t0 } = freshWorld();
    world.location('loc_plaza').state['weather'] = 'lluvia fina';
    expect(ambienceOf(world, { clock }, world.location('loc_plaza'), t0)).toBe('lluvia');
  });

  it('puerta: entre interior y exterior sí; el portón también; entre dos puntos del camino, no', () => {
    const { world } = freshWorld();
    expect(isDoor(world, 'sp_tab_puerta', 'sp_pl_taberna')).toBe(true);
    expect(isDoor(world, 'sp_pl_porton', 'sp_cl_sendero')).toBe(true);
    expect(isDoor(world, 'sp_pl_pozo', 'sp_cl_sendero')).toBe(false);
  });

  it('placeOf junta lo anterior', () => {
    const { world, clock, t0 } = freshWorld();
    expect(placeOf(world, { clock }, 'sp_tab_barra', t0)).toEqual(taberna);
  });
});

describe('con el motor', () => {
  it('Kael sale de la taberna a la plaza: el evento de partida lleva pasos, puerta y ambiente de la plaza', async () => {
    const { engine } = await bootEngine();
    const got = new Map<string, string[]>();
    engine.onDelivery((d: Delivery) => { if (d.character_id === 'ch_kael' && d.event.actor_id === 'ch_kael') got.set(d.event.action_type, soundCuesOf(engine, d.event)); });
    const r = await engine.act('ch_kael', 'ir a el pozo');
    expect(r.ok).toBe(true);
    expect(got.get('move')).toEqual(['pasos-madera', 'puerta-abrir', 'puerta-cerrar', 'ambiente-plaza']);
  });

  it('ambiente actual del PJ para quien abre la página', async () => {
    const { engine } = await bootEngine();
    expect(currentAmbience(engine, 'ch_kael')).toBe('ambiente-taberna');
    expect(currentAmbience(engine, 'ch_mira')).toBe('ambiente-plaza');
    expect(currentAmbience(engine, 'nadie')).toBeNull();
  });
});
