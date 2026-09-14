import { describe, expect, it } from 'vitest';
import { GAME_HOUR } from '../src/clock/clock.js';
import { bandFor, hearingRadius, perceive, visionRadius, witnesses } from '../src/engine/perception.js';
import { positionOf } from '../src/engine/movement.js';
import { freshWorld } from './helpers.js';

describe('percepción', () => {
  it('bandas por múltiplo del radio', () => {
    expect(bandFor(10, 30)).toBe('full');
    expect(bandFor(45, 30)).toBe('vague');
    expect(bandFor(80, 30)).toBe('hint');
    expect(bandFor(100, 30)).toBe('none');
    expect(bandFor(5, 0)).toBe('none');
  });

  it('radio de visión: luz × habilidad; antorcha y visión en la oscuridad', () => {
    const { world } = freshWorld();
    const kael = world.character('ch_kael'); // PP 11 → ×1.05
    const mira = world.character('ch_mira'); // PP 14 → ×1.2
    expect(visionRadius(world, kael, 'day')).toBeCloseTo(31.5, 5);
    expect(visionRadius(world, mira, 'day')).toBeCloseTo(36, 5);
    expect(visionRadius(world, mira, 'night_dark')).toBeCloseTo(1.8, 5);
    // Con antorcha encendida en el bolsillo: (30×0.2 + 10) × 1.2 = 19.2
    world.itemInstance('ii_mira_antorcha').state['lit'] = true;
    expect(visionRadius(world, mira, 'night_dark')).toBeCloseTo(19.2, 5);
    kael.darkvision = true;
    expect(visionRadius(world, kael, 'night_dark')).toBe(18);
    kael.status = 'asleep';
    expect(visionRadius(world, kael, 'day')).toBeCloseTo(6.3, 5);
    expect(hearingRadius(world, mira, 0.5)).toBeCloseTo(12, 5);
  });

  it('mismo punto: detalle completo; lejos: figura; otra localización: nada', () => {
    const { world, clock, t0 } = freshWorld();
    const kael = world.character('ch_kael');
    const mira = world.character('ch_mira');
    // Distintas localizaciones.
    expect(perceive(world, clock, kael, positionOf(world, mira, t0), t0).level).toBe('none');
    // Mira en el portón (30,20), Kael en la puerta de la taberna (0,0): 36 m de día.
    mira.location = { type: 'spot', id: 'sp_pl_porton' };
    kael.location = { type: 'spot', id: 'sp_pl_taberna' };
    const p = perceive(world, clock, kael, positionOf(world, mira, t0), t0);
    expect(p.sight).toBe('vague');   // 36 / 31.5 = 1.14
    expect(p.sound).toBe('hint');    // oído 20×0.8×1.05 = 16.8 → 36/16.8 = 2.1
  });

  it('el sonido escala con el volumen: un grito se oye desde el otro lado de la plaza', () => {
    const { world, clock, t0 } = freshWorld();
    const kael = world.character('ch_kael');
    const mira = world.character('ch_mira');
    mira.location = { type: 'spot', id: 'sp_pl_porton' };
    kael.location = { type: 'spot', id: 'sp_pl_taberna' };
    const at = positionOf(world, mira, t0);
    expect(perceive(world, clock, kael, at, t0, 0.15).sound).toBe('none');  // susurro
    expect(perceive(world, clock, kael, at, t0, 1).sound).toBe('hint');     // 36 / 16.8 = 2.14
    expect(perceive(world, clock, kael, at, t0, 5).sound).toBe('full');     // grito
  });

  it('de noche en la plaza no se ve al que está al otro lado, pero con antorcha propia sí algo', () => {
    const { world, clock, t0 } = freshWorld();
    const night = t0 + 15 * GAME_HOUR; // 23:00
    const kael = world.character('ch_kael');
    const mira = world.character('ch_mira');
    mira.location = { type: 'spot', id: 'sp_pl_porton' };
    kael.location = { type: 'spot', id: 'sp_pl_taberna' };
    const at = positionOf(world, mira, night);
    // noche con luna: 30×0.25×1.05 = 7.9 → 36 m = ×4.6 → none por vista, hint por oído
    const p = perceive(world, clock, kael, at, night);
    expect(p.sight).toBe('none');
    expect(p.level).toBe('hint');
    // Kael enciende una antorcha: (6+10)×1.05 = 16.8 → 36/16.8 → hint por vista
    world.itemInstance('ii_kael_antorchas').state['lit'] = true;
    expect(perceive(world, clock, kael, at, night).sight).toBe('hint');
  });

  it('un punto oculto no descubierto no se ve, pero se oye', () => {
    const { world, clock, t0 } = freshWorld();
    const kael = world.character('ch_kael');
    const mira = world.character('ch_mira');
    mira.location = { type: 'spot', id: 'sp_tab_trampilla' };
    const p = perceive(world, clock, kael, positionOf(world, mira, t0), t0);
    expect(p.sight).toBe('none');
    expect(p.sound).toBe('full');
    world.spot('sp_tab_trampilla').discovered_by.push('ch_kael');
    expect(perceive(world, clock, kael, positionOf(world, mira, t0), t0).sight).toBe('full');
  });

  it('un enlace que bloquea la vista deja solo el oído, amortiguado', () => {
    const { world, clock, t0 } = freshWorld();
    world.spot('sp_tab_barra').links.push({ to_spot_id: 'sp_tab_mesa', blocks_sight: true, muffles: 0.9 });
    const kael = world.character('ch_kael');
    const mira = world.character('ch_mira');
    mira.location = { type: 'spot', id: 'sp_tab_mesa' };
    const p = perceive(world, clock, kael, positionOf(world, mira, t0), t0);
    expect(p.sight).toBe('none');
    // oído: 20×0.7×1.05×0.1 = 1.47 → 5.66 m = ×3.85 → none
    expect(p.sound).toBe('none');
    expect(perceive(world, clock, kael, positionOf(world, mira, t0), t0, 5).sound).toBe('full');
  });

  it('witnesses devuelve solo a quien percibe algo, excluyendo al actor', () => {
    const { world, clock, t0 } = freshWorld();
    const kael = world.character('ch_kael');
    const w = witnesses(world, clock, positionOf(world, kael, t0), t0, 1, kael.id);
    expect(w).toHaveLength(0);
    world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_mesa' };
    const w2 = witnesses(world, clock, positionOf(world, kael, t0), t0, 1, kael.id);
    expect(w2.map((x) => [x.character.id, x.perceived.level])).toEqual([['ch_mira', 'full']]);
  });
});
