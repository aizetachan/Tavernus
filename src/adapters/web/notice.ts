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
import type { QuestChange } from '../../engine/progress.js';

/** Pestaña del cajón a la que lleva el enlace de un aviso. */
export type NoticeTab = 'journal' | 'sheet' | 'bag';

/**
 * Aviso de una línea: `link` + `tab`, un enlace a esa pestaña; `tone` tiñe el texto (una tirada que sale bien o mal).
 * Los de misiones (`quest`) se pintan más visibles: qué ha pasado (alta, paso, cierre) y, debajo, por qué. El de una
 * misión que nos acaban de pedir (`declinable`) deja decir que no (POST /api/quest/answer).
 * La subida de nivel (`level`), igual de visible, con lo que gana debajo, una línea por apartado.
 */
export interface WebNotice { text: string; link?: string; tab?: NoticeTab; tone?: 'good' | 'bad'; quest?: { id: Id; event: QuestChange['event']; why: string; declinable?: boolean }; level?: { level: number; gains: string[] } }

const QUEST_HEAD: Record<QuestChange['event'], string> = {
  rumor: 'Hemos oído algo', offered: 'Nos piden ayuda', declined: 'Dijimos que no', open: 'Nueva misión', available: 'Encargo en el Diario', step: 'Paso cumplido',
  ready: 'Lista para entregar', changed: 'La misión cambia', warned: 'Queda poco', done: 'Misión cumplida', failed: 'Se perdió', expired: 'Misión cerrada', dropped: 'Misión dejada',
};

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
  // El tablón cambia, pero sus encargos no entran en el Diario hasta que el PJ lo lee.
  if (e.action_type === 'board') return webNotice('Hay avisos nuevos en el tablón de la plaza: pásate a leerlos');
  const q = e.payload?.['quest'] as QuestChange | undefined;
  if (/^progress_/.test(e.action_type) && q && QUEST_HEAD[q.event]) {
    // Un rumor es lo que se oye en el sitio: una línea de ambiente, sin enlace ni entrada en el Diario.
    if (q.event === 'rumor') return webNotice(q.why);
    if (q.event === 'warned' || q.event === 'failed') return { text: `${QUEST_HEAD[q.event]} · «${q.title}»`, link: 'ver en el Diario', tab: 'journal', quest: { id: q.id, event: q.event, why: q.why.charAt(0).toUpperCase() + q.why.slice(1) } };
    const what = q.event === 'step' && q.step ? `${q.title}: ${q.step}` : `«${q.title}»`;
    return { text: `${QUEST_HEAD[q.event]} · ${what}`, link: 'ver en el Diario', tab: 'journal', quest: { id: q.id, event: q.event, why: q.why.charAt(0).toUpperCase() + q.why.slice(1), ...(q.declinable ? { declinable: true } : {}) } };
  }
  const isActor = readerId !== null && readerId === e.actor_id;
  // Subida de nivel (levels.ts): quien sube ve lo que gana y va a su Hoja; los demás, una línea.
  const up = e.payload?.['level_up'] as { level: number; head: string; gains: string[] } | undefined;
  if (e.action_type === 'progress_level' && up) {
    return isActor ? { text: `⬆ ${up.head}`, link: 'ver en la Hoja', tab: 'sheet', level: { level: up.level, gains: up.gains } } : webNotice(e.observable ?? up.head);
  }
  const shown = text ?? ((isActor ? e.narration_private : e.observable) || e.narration_private || e.observable || '');
  if (e.action_type === 'progress_level') return webNotice(shown, { link: 'ver en la Hoja', tab: 'sheet' });
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
