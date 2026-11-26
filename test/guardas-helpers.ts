/**
 * Utilidades de los tests de las guardas del cierre (PLAN-ARREGLOS-2026-11-26, paquete A): un contexto de tools
 * para Kael en el mundo de demo, el log_event mínimo y las demás guardas ya gastadas, para que cada test vea solo
 * la suya (cada una rechaza una vez y luego deja pasar).
 */
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine } from '../src/engine/engine.js';

/** Contadores de rechazo de todas las guardas del cierre, en su tope. */
const SPENT: Partial<ToolContext> = {
  place_rejections: 1, deal_rejections: 1, outcome_rejections: 1, conversation_rejections: 1, others_rejections: 1, death_rejections: 2,
  shared_rejections: 2, order_rejections: 1, repeat_rejections: 1, receive_rejections: 1, invented_rejections: 1, moved_rejections: 1,
  stolen_rejections: 1, served_rejections: 1, coins_rejections: 1, magic_rejections: 1, strike_rejections: 1, incident_rejections: 2,
  spot_rejections: 1, talk_rejections: 1, hidden_rejections: 1, decisive_rejections: 1, npc_turn_rejections: 1, conflict_rejections: 1,
  state_rejections: 1, failed_rejections: 1, reaction_rejections: 1, hit_rejections: 1, debt_rejections: 1,
  credit_rejections: 1, meeting_rejections: 1, rule_rejections: 1, job_rejections: 1,
  presence_rejections: 1, homonym_rejections: 1, hands_rejections: 1,
};

export type Guard = 'served_rejections' | 'shared_rejections' | 'state_rejections' | 'failed_rejections' | 'reaction_rejections' | 'hit_rejections' | 'debt_rejections'
  | 'credit_rejections' | 'meeting_rejections' | 'rule_rejections' | 'job_rejections'
  | 'presence_rejections' | 'homonym_rejections' | 'hands_rejections';

/** Contexto de Kael con todas las guardas gastadas menos `only`. */
export function ctxOnly(engine: Engine, only: Guard, extra: Partial<ToolContext> = {}, actorId = 'ch_kael'): ToolContext {
  const actor = engine.world.character(actorId);
  const spent = { ...SPENT };
  delete spent[only];
  return { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [], ...spent, ...extra };
}

export const logEvent = (narration: string, extra: Record<string, unknown> = {}) => ({
  narration_private: narration, observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: 'Esperar',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
  decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false, lines: null, ...extra,
});

export const run = (ctx: ToolContext, name: string, input: Record<string, unknown>) => JSON.parse(executeTool(ctx, name, input)) as { ok?: boolean; closed?: boolean; error?: string; hint?: string } & Record<string, unknown>;

/** El cierre se rechaza con `match` y, a la segunda, el mismo cierre pasa. */
export function rejectsOnceThenPasses(ctx: ToolContext, close: Record<string, unknown>): string {
  const first = run(ctx, 'log_event', close);
  if (!first.error) throw new Error(`no se ha rechazado: ${JSON.stringify(first)}`);
  if (ctx.closed) throw new Error('el cierre rechazado ha quedado como cerrado');
  const second = run(ctx, 'log_event', close);
  if (!second.ok || !second.closed) throw new Error(`la segunda no pasa: ${JSON.stringify(second)}`);
  return first.error;
}
