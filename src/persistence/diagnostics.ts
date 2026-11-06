/**
 * Lo que el juego guarda en cada evento y no vuelve a leer nunca: el contexto que vio el máster
 * (`payload.master.context`, el prompt entero de esa llamada). Es el 75-80 % del registro (en las partidas
 * automáticas del 31-10, 5,9 de 7,6 MB). Solo lo leen las herramientas de análisis (scripts/judge.ts).
 *
 * Por eso la persistencia lo guarda aparte y no lo carga al arrancar: `loadEvents` devuelve los eventos sin él.
 * El resto del evento sí se carga entero: el historial del hilo, el diario, el prólogo, las transcripciones con
 * cada NPC y la comprobación de lo que el PJ ha percibido leen el registro desde el principio de la partida
 * (docs/PLAN-OBJETOS.md §8, «Punto de control»).
 */

import type { GameEvent } from '../engine/model.js';

/** El evento sin el contexto del máster, y el contexto (o `undefined` si no lo llevaba). */
export function splitDiagnostics(e: GameEvent): { event: GameEvent; context: unknown } {
  const master = e.payload?.['master'];
  if (!master || typeof master !== 'object' || !('context' in master)) return { event: e, context: undefined };
  const { context, ...rest } = master as Record<string, unknown>;
  return { event: { ...e, payload: { ...e.payload, master: rest } }, context };
}

/** El evento con su contexto de vuelta (para las herramientas de análisis y para pasar partidas de un sitio a otro). */
export function joinDiagnostics(e: GameEvent, context: unknown): GameEvent {
  if (context === undefined) return e;
  const master = e.payload?.['master'];
  if (!master || typeof master !== 'object') return e;
  return { ...e, payload: { ...e.payload, master: { ...(master as Record<string, unknown>), context } } };
}
