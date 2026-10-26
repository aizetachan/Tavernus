/**
 * Diario en la web: la vista del motor (src/engine/journal.ts) con los retratos
 * de los NPC que ya estén ilustrados, y el aviso de una línea que sustituye en
 * el hilo a los mensajes de tablón y de progreso («Tablón actualizado · ver en
 * el Diario»).
 *
 *   GET /api/journal?character=ID
 *
 * El SSE manda `journal` (sin datos) cuando cambia algo que el diario recoge;
 * la página vuelve a pedirlo y compara `version` con la última que vio.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../../engine/engine.js';
import { journalOf, type Journal, type JournalConversation, type JournalQuest } from '../../engine/journal.js';
import type { GameEvent, Id } from '../../engine/model.js';
import { illustratorOf } from '../../ai/illustrate.js';

export interface WebJournal extends Journal {
  conversations: (JournalConversation & { portrait: string | null })[];
}

/** Aviso discreto en el hilo en lugar de una burbuja; `tab` es la pestaña a la que lleva. */
export interface WebNotice { text: string; link: string; tab: 'journal' }

export function journalView(engine: Engine, characterId: Id, slug: string): WebJournal {
  const j = journalOf(engine, characterId);
  const ill = illustratorOf(engine);
  // Lo que el jugador no debe ver ni en el navegador: los caminos (son para el máster), quién se le opone,
  // qué pasa si vence el plazo y los rumores sueltos de cada misión (lo relevante va en el resumen).
  const open = (q: JournalQuest): JournalQuest => ({ ...q, paths: [], antagonist: null, rumors: [], clock: q.clock ? { ...q.clock, runs_out: '' } : null });
  return {
    ...j,
    quests: { active: j.quests.active.map(open), completed: j.quests.completed.map(open) },
    conversations: j.conversations.map((c) => {
      const img = ill?.entityImage('portrait', c.npc_id) ?? null;
      return { ...c, portrait: img ? `/images/${img.file}?game=${encodeURIComponent(slug)}` : null };
    }),
  };
}

export function handleJournalRequest(engine: Engine, _req: IncomingMessage, res: ServerResponse, url: URL, slug: string): void {
  const id = url.searchParams.get('character');
  if (!id || !engine.world.characters.has(id)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, text: 'No existe ese personaje.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(journalView(engine, id, slug)));
}

/**
 * Eventos que no van al hilo como burbuja sino como aviso de una línea: la
 * rotación del tablón y los avisos de progreso (pista, encargo, logro,
 * práctica). Lo demás (tiradas, anuncios, narración) sigue igual. null = burbuja.
 */
export function noticeOf(e: Pick<GameEvent, 'action_type' | 'narration_private' | 'observable'>): WebNotice | null {
  if (e.action_type === 'board') return { text: 'Tablón actualizado', link: 'ver en el Diario', tab: 'journal' };
  if (/^progress_/.test(e.action_type)) {
    const text = (e.narration_private || e.observable || '').replace(/\s+/g, ' ').trim();
    const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
    return { text: first.replace(/[.]$/, ''), link: 'ver en el Diario', tab: 'journal' };
  }
  return null;
}

/** ¿Cambia este evento algo que el diario recoge? (Para avisar por el stream.) */
export function touchesJournal(e: Pick<GameEvent, 'action_type' | 'payload' | 'tags'>): boolean {
  if (/^(board|progress_|announcement|arrived|character_joined|master_arrival|master_intro|roll|travel_encounter|take|take_out|harvest)/.test(e.action_type)) return true;
  if (Array.isArray(e.payload['lines']) && (e.payload['lines'] as unknown[]).length) return true;
  if (typeof e.payload['npc_id'] === 'string' || e.payload['attack'] || typeof e.payload['item_id'] === 'string') return true;
  return e.tags.includes('combat') || e.tags.includes('job') || e.tags.includes('milestone');
}
