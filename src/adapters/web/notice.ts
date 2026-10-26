/**
 * Avisos de sistema en el hilo (estilo WhatsApp: «Fulano ha salido del grupo»):
 * una línea centrada, pequeña y apagada, fuera de la ficción. Qué evento es
 * aviso lo decide el motor (src/engine/notices.ts); aquí se le da forma.
 *
 * Para emitir uno: desde el motor, `payload: { notice: 'all' | 'others' }`; desde
 * el servidor, un mensaje con `notice: webNotice(texto)` (y `kind: 'system'`).
 */

import type { GameEvent, Id } from '../../engine/model.js';
import { threadKind } from '../../engine/notices.js';

/** Pestaña del cajón a la que lleva el enlace de un aviso. */
export type NoticeTab = 'journal' | 'sheet' | 'bag';

/** Aviso de una línea: `link` + `tab`, un enlace a esa pestaña; `tone` tiñe el texto (una tirada que sale bien o mal). */
export interface WebNotice { text: string; link?: string; tab?: NoticeTab; tone?: 'good' | 'bad' }

/** Construye un aviso con el texto limpio: sin negritas ni saltos de línea y, si es una sola frase, sin punto final. */
export function webNotice(text: string, opts: Omit<WebNotice, 'text'> = {}): WebNotice {
  const clean = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return { text: /[.!?;:]\s/.test(clean) ? clean : clean.replace(/(?<!\.)\.$/, ''), ...opts };
}

/** Bien o mal, si el texto lo dice (tiradas, salvaciones, intercambios que fallan). */
export function toneOf(text: string): WebNotice['tone'] {
  if (/^✗/.test(text) || /→\s*(falla|fallo)\b/i.test(text)) return 'bad';
  if (/→\s*(impacta|éxito|crítico)\b/i.test(text) || /^✓/.test(text)) return 'good';
  return undefined;
}

type NoticeEvent = Pick<GameEvent, 'action_type' | 'narration_private' | 'observable'> & Partial<Pick<GameEvent, 'actor_id' | 'payload' | 'tags'>>;

/**
 * El aviso que ve `readerId` en lugar de una burbuja, o null si es narración.
 * El tablón y el progreso llevan al Diario. `text` es lo que le llega a ese
 * lector (por defecto, lo del actor o, si no hay, lo observable).
 */
export function noticeOf(e: NoticeEvent, readerId: Id | null = e.actor_id ?? null, text?: string): WebNotice | null {
  if (e.action_type === 'board') return webNotice('Tablón actualizado', { link: 'ver en el Diario', tab: 'journal' });
  const isActor = readerId !== null && readerId === e.actor_id;
  const shown = text ?? ((isActor ? e.narration_private : e.observable) || e.narration_private || e.observable || '');
  if (/^progress_/.test(e.action_type)) {
    const flat = shown.replace(/\s+/g, ' ').trim();
    const first = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
    return webNotice(first.replace(/[.]$/, ''), { link: 'ver en el Diario', tab: 'journal' });
  }
  const kind = threadKind({ action_type: e.action_type, actor_id: e.actor_id ?? null, payload: e.payload ?? {}, narration_private: e.narration_private, tags: e.tags ?? [] }, readerId, shown);
  if (kind !== 'notice' || !shown.trim()) return null;
  const tone = toneOf(shown);
  return webNotice(shown, tone ? { tone } : {});
}
