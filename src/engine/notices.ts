/**
 * Aviso de sistema frente a narración. El narrador solo describe la escena; lo
 * informativo (quién entra o sale, adónde va cada uno, objetos que cambian de
 * mano, tiradas, progreso, el paso del tiempo) sale en el hilo como aviso, igual
 * que «Fulano ha salido del grupo» en WhatsApp: una línea centrada y apagada.
 *
 * Para emitir un aviso desde el motor basta marcar el evento:
 * `payload: { notice: 'all' }` (aviso para todos) u `'others'` (aviso para los
 * testigos; el actor lo lee como narración). Sin marca decide la tabla por
 * `action_type`. La web lo pinta con `noticeOf` (src/adapters/web/notice.ts).
 */

import type { GameEvent, Id } from './model.js';

/** A quién le llega como aviso: a todos, solo a los testigos o solo al actor. */
export type NoticeScope = 'all' | 'others' | 'actor';
export type ThreadKind = 'notice' | 'narration';

/**
 * Tipos que son aviso. Lo que queda fuera (máster, diálogo, llegadas con
 * descripción, ambiente de la agenda, caídas y muertes) es narración.
 */
const NOTICE_TYPES: Record<string, NoticeScope> = {
  // Tiradas y mecánica.
  roll: 'all', death_save: 'all', decisive_expired: 'all', budget_exhausted: 'all', admin_fix: 'all',
  // Tablón, logros y progreso.
  board: 'all', announcement: 'all',
  // Gente que va y viene.
  character_joined: 'all', move: 'all', passed: 'all', arrived: 'all', stop: 'all', rebound: 'all', npc_move: 'all',
  away: 'all', back: 'all', party_notice: 'all',
  // La llegada que narra el máster: escena para quien llega; para los demás, «Fulano entra en la taberna».
  master_arrival: 'others', master_intro: 'others',
  follow: 'all', unfollow: 'all', follow_move: 'all', help: 'all',
  // Turnos de conversación con un NPC.
  npc_join: 'all', npc_leave: 'all', npc_wait: 'all', npc_busy: 'all', npc_free: 'all',
  // Objetos que cambian de mano.
  take: 'all', take_out: 'all', drop: 'all', put: 'all',
  offer: 'all', offer_accepted: 'all', offer_declined: 'all', offer_failed: 'all', offer_expired: 'all', offer_cancelled: 'all',
  // Lo que obtiene el actor; los demás solo oyen el trabajo («se oyen golpes»).
  harvest: 'actor',
  // El paso del tiempo.
  wait: 'all', rest: 'all', sleep: 'all', wake: 'all',
};

type Classifiable = Pick<GameEvent, 'action_type' | 'actor_id' | 'payload'> & Partial<Pick<GameEvent, 'narration_private' | 'tags'>>;

function scopeOf(e: Classifiable): NoticeScope | null {
  const mark = e.payload['notice'];
  if (mark === 'all' || mark === 'others' || mark === 'actor') return mark;
  if (/^progress_/.test(e.action_type)) return 'all';
  // Si alguien habla (un NPC saluda al que llega), es escena: sus palabras van en su burbuja.
  if (Array.isArray(e.payload['lines']) && (e.payload['lines'] as unknown[]).length) return null;
  return NOTICE_TYPES[e.action_type] ?? (e.payload['notice_for_others'] === true ? 'others' : null);
}

/**
 * Cómo lee `readerId` este evento en su hilo. `text` es lo que le llega (por
 * defecto, la narración privada si es el actor). Una llegada que describe el
 * sitio (la plantilla, o varias líneas) sigue siendo narración para quien llega;
 * «Llegas a la barra.» a secas, o lo que ha costado el viaje, es aviso.
 */
export function threadKind(e: Classifiable, readerId: Id | null, text?: string): ThreadKind {
  const scope = scopeOf(e);
  if (!scope) return 'narration';
  const isActor = readerId !== null && readerId === e.actor_id;
  if (scope === 'others' && isActor) return 'narration';
  if (scope === 'actor' && !isActor) return 'narration';
  if (isActor && (e.action_type === 'arrived' || e.action_type === 'character_joined')) {
    const own = text ?? e.narration_private ?? '';
    if (own.includes('\n') || e.tags?.includes('deterministic')) return 'narration';
  }
  return 'notice';
}
