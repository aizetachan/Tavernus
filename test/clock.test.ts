import { describe, expect, it } from 'vitest';
import { GameClock, Ticker, GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import { makeSeed, SEED_REAL_EPOCH_MS, SEED_GAME_EPOCH_S } from '../src/data/seed/demo.js';

const clock = GameClock.fromCampaign(makeSeed().campaign);

describe('GameClock', () => {
  it('arranca en la época configurada', () => {
    expect(clock.gameNow(SEED_REAL_EPOCH_MS)).toBe(SEED_GAME_EPOCH_S);
  });

  it('8 h reales = 1 día de juego (ratio 3)', () => {
    const later = clock.gameNow(SEED_REAL_EPOCH_MS + 8 * 3600 * 1000);
    expect(later - SEED_GAME_EPOCH_S).toBe(GAME_DAY);
    expect(clock.realToGame(20 * 60)).toBe(GAME_HOUR);
    expect(clock.gameToReal(8 * GAME_HOUR)).toBe(2 * 3600 + 40 * 60);
  });

  it('realAt invierte gameNow', () => {
    const g = SEED_GAME_EPOCH_S + 12345;
    expect(clock.gameNow(clock.realAt(g))).toBeCloseTo(g, 6);
  });

  it('calcula fecha, hora y luz', () => {
    const d = clock.dateTime(SEED_GAME_EPOCH_S);
    expect(d).toMatchObject({ day_index: 0, hour: 8, minute: 0, weekday: 'Lunes', month: 'Brotes', day_of_month: 1, year: 1 });
    expect(clock.outdoorLight(SEED_GAME_EPOCH_S)).toBe('day');
    expect(clock.outdoorLight(5.5 * GAME_HOUR)).toBe('twilight');
    expect(clock.outdoorLight(23 * GAME_HOUR)).toBe('night_moon');
    expect(clock.outdoorLight(20.5 * GAME_HOUR)).toBe('twilight');
    const d2 = clock.dateTime(GAME_DAY * 31 + 3 * GAME_HOUR);
    expect(d2).toMatchObject({ weekday: 'Jueves', month: 'Espigas', day_of_month: 2, hour: 3 });
    expect(clock.format(SEED_GAME_EPOCH_S)).toBe('Lunes 1 de Brotes, año 1, 08:00');
  });
});

describe('Ticker', () => {
  it('recupera ticks perdidos en orden y sin duplicar', () => {
    const seen: number[] = [];
    const t = new Ticker('minute', 60, { last_tick_game_s: 0 }, (s) => seen.push(s));
    expect(t.run(59)).toBe(0);
    expect(t.run(180)).toBe(3);
    expect(seen).toEqual([60, 120, 180]);
    expect(t.run(180)).toBe(0);
    expect(t.run(200)).toBe(0);
    expect(t.run(240)).toBe(1);
    expect(t.snapshot()).toEqual({ last_tick_game_s: 240 });
  });

  it('respeta el tope por ejecución', () => {
    const t = new Ticker('x', 1, { last_tick_game_s: 0 }, () => undefined, 5);
    expect(t.run(1000)).toBe(5);
    expect(t.lastTick).toBe(5);
  });
});
