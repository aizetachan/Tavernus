/**
 * Reloj global del mundo (SPEC §1.3).
 *
 * Un único reloj ligado al real con ratio fijo. Nadie lo mueve a mano: el
 * tiempo de juego se deriva siempre de (real_epoch_ms, game_epoch_s, ratio).
 * Guardar esos tres valores es suficiente para reconstruirlo tras un reinicio.
 */

import type { Calendar, Campaign, LightLevel } from '../engine/model.js';

export const GAME_MINUTE = 60;
export const GAME_HOUR = 3600;
export const GAME_DAY = 24 * GAME_HOUR;

export interface GameDateTime {
  day_index: number;      // días desde el inicio de la campaña (0-based)
  hour: number;           // 0-23
  minute: number;         // 0-59
  second: number;
  weekday: string;
  month: string;
  day_of_month: number;   // 1-based
  year: number;           // 1-based
}

export class GameClock {
  constructor(
    private readonly ratio: number,
    private readonly realEpochMs: number,
    private readonly gameEpochS: number,
    private readonly calendar: Calendar,
  ) {
    if (ratio <= 0) throw new Error('time_ratio must be > 0');
  }

  static fromCampaign(c: Campaign): GameClock {
    return new GameClock(c.time_ratio, c.real_epoch_ms, c.game_epoch_s, c.calendar);
  }

  get timeRatio(): number { return this.ratio; }

  /** Segundos de juego en un instante real. */
  gameNow(realMs: number = Date.now()): number {
    return this.gameEpochS + ((realMs - this.realEpochMs) / 1000) * this.ratio;
  }

  /** Instante real (ms) en que el reloj de juego marcará `gameS`. */
  realAt(gameS: number): number {
    return this.realEpochMs + ((gameS - this.gameEpochS) / this.ratio) * 1000;
  }

  /** Duración: real → juego. */
  realToGame(realSeconds: number): number { return realSeconds * this.ratio; }

  /** Duración: juego → real. */
  gameToReal(gameSeconds: number): number { return gameSeconds / this.ratio; }

  dateTime(gameS: number): GameDateTime {
    const total = Math.max(0, Math.floor(gameS));
    const dayIndex = Math.floor(total / GAME_DAY);
    const rem = total - dayIndex * GAME_DAY;
    const hour = Math.floor(rem / GAME_HOUR);
    const minute = Math.floor((rem % GAME_HOUR) / GAME_MINUTE);
    const second = rem % GAME_MINUTE;

    const dayNames = this.calendar.day_names.length ? this.calendar.day_names : ['día'];
    const weekday = dayNames[dayIndex % dayNames.length]!;

    const months = this.calendar.months.length ? this.calendar.months : [{ name: 'mes', days: 30 }];
    const yearLen = months.reduce((a, m) => a + m.days, 0);
    const year = Math.floor(dayIndex / yearLen) + 1;
    let dayInYear = dayIndex % yearLen;
    let month = months[0]!;
    for (const m of months) {
      if (dayInYear < m.days) { month = m; break; }
      dayInYear -= m.days;
    }
    return { day_index: dayIndex, hour, minute, second, weekday, month: month.name, day_of_month: dayInYear + 1, year };
  }

  /** Nivel de luz exterior según la hora (SPEC §9.2). Fases de luna → v2. */
  outdoorLight(gameS: number): LightLevel {
    const { hour, minute } = this.dateTime(gameS);
    const h = hour + minute / 60;
    const { sunrise_h, sunset_h, twilight_h } = this.calendar;
    if (h >= sunrise_h && h < sunset_h) return 'day';
    if (h >= sunrise_h - twilight_h && h < sunrise_h) return 'twilight';
    if (h >= sunset_h && h < sunset_h + twilight_h) return 'twilight';
    return 'night_moon';
  }

  /** Formato corto para narración y logs. */
  format(gameS: number): string {
    const d = this.dateTime(gameS);
    const hh = String(d.hour).padStart(2, '0');
    const mm = String(d.minute).padStart(2, '0');
    return `${d.weekday} ${d.day_of_month} de ${d.month}, año ${d.year}, ${hh}:${mm}`;
  }
}

/**
 * Ticker persistente (SPEC §14.2.4). Guarda el último instante de juego
 * procesado; al llamar a `run` ejecuta todos los ticks pendientes hasta `now`
 * en orden, sin saltar ni duplicar aunque el proceso haya estado parado.
 */
export interface TickerState { last_tick_game_s: number; }

export class Ticker {
  constructor(
    public readonly name: string,
    /** Intervalo entre ticks, en segundos de juego. */
    public readonly every_s: number,
    private state: TickerState,
    private readonly onTick: (tickGameS: number) => void,
    /** Tope de ticks por llamada para no bloquear si el hueco es enorme. */
    private readonly maxPerRun: number = 10_000,
  ) {
    if (every_s <= 0) throw new Error('every_s must be > 0');
  }

  get lastTick(): number { return this.state.last_tick_game_s; }

  /** Ejecuta ticks pendientes. Devuelve cuántos corrió. */
  run(nowGameS: number): number {
    let count = 0;
    while (this.state.last_tick_game_s + this.every_s <= nowGameS && count < this.maxPerRun) {
      this.state.last_tick_game_s += this.every_s;
      this.onTick(this.state.last_tick_game_s);
      count++;
    }
    return count;
  }

  snapshot(): TickerState { return { ...this.state }; }
}
