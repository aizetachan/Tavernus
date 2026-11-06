/**
 * Alarmas de un sitio (docs/CONVERSACION-FLUJO.md, capa 1): fuego, derrumbe, inundación, pelea… Mientras dura, los NPC
 * de esa localización no están para charlas: el guion de la charla solo deja su reacción (talk.ts, bandera bloqueante).
 *
 * La ponen dos cosas (decisión de Miguel, 06-11): un suceso del mundo definido en los datos (efecto `alarm` de una
 * regla, worldrules.ts) o el máster con la tool `set_alarm`, para lo que surge en la partida. Las dos escriben lo
 * mismo: `location.state.alarm`. Nada de una campaña concreta.
 */

import type { Id } from './model.js';
import type { World } from './world.js';

export const ALARM_KINDS = ['fire', 'collapse', 'flood', 'fight', 'other'] as const;
export type AlarmKind = typeof ALARM_KINDS[number];

export const ALARM_ES: Record<AlarmKind, string> = { fire: 'fuego', collapse: 'derrumbe', flood: 'inundación', fight: 'pelea', other: 'alarma' };

/** Lo que guarda `location.state.alarm`. */
export interface Alarm {
  kind: AlarmKind;
  /** Lo que pasa, para el máster: «arde el tejado de paja del establo». */
  text: string;
  since_game_s: number;
  /** Cuándo se acaba sola; null, hasta que alguien la quite. */
  until_game_s: number | null;
  /** Quién la puso: una regla de la campaña o el máster. */
  by: 'rule' | 'master';
}

function isAlarm(x: unknown): x is Alarm {
  const a = x as Partial<Alarm> | null;
  return Boolean(a && typeof a === 'object' && typeof a.kind === 'string' && typeof a.text === 'string');
}

/** La alarma en curso de una localización, o null (las que han caducado no cuentan). */
export function alarmAt(world: World, locationId: Id | null | undefined, nowG: number): Alarm | null {
  const loc = locationId ? world.locations.get(locationId) : undefined;
  const a = loc?.state['alarm'];
  if (!isAlarm(a)) return null;
  if (a.until_game_s !== null && a.until_game_s !== undefined && nowG >= a.until_game_s) return null;
  return a;
}

/** Pone (o cambia) la alarma de una localización. `minutes` null: hasta que se quite. */
export function setAlarm(world: World, locationId: Id, a: { kind: AlarmKind; text: string; minutes: number | null; by: Alarm['by'] }, nowG: number): Alarm {
  const loc = world.locations.get(locationId);
  if (!loc) throw new Error(`La localización ${locationId} no existe.`);
  const alarm: Alarm = { kind: a.kind, text: a.text.trim(), since_game_s: nowG, until_game_s: a.minutes && a.minutes > 0 ? nowG + a.minutes * 60 : null, by: a.by };
  loc.state['alarm'] = alarm;
  world.touch('locations', loc.id);
  return alarm;
}

/** Quita la alarma de una localización. Devuelve si había una. */
export function clearAlarm(world: World, locationId: Id): boolean {
  const loc = world.locations.get(locationId);
  if (!loc || !('alarm' in loc.state)) return false;
  delete loc.state['alarm'];
  world.touch('locations', loc.id);
  return true;
}

/** La línea del contexto del máster, o null. */
export function alarmLine(a: Alarm | null): string | null {
  return a ? `ALARMA (${ALARM_ES[a.kind]}): ${a.text}. Nadie está para charlas: quien está aquí huye, grita, ayuda o se defiende. Se quita con set_alarm clear cuando se acabe.` : null;
}
