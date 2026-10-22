/**
 * Juez de partidas automáticas: lee el log de eventos de una partida y anota los errores del máster
 * por turno, en dos capas:
 *   (a) detectores deterministas, sin coste: leen los eventos y los resultados de los tools;
 *   (b) un juez modelo (JUDGE_MODEL, por defecto Haiku) con una lista de comprobación cerrada y JSON estricto.
 *
 *   npm run judge -- --run data/local/autoplay/<fecha>            todas las partidas del resumen → report.md
 *   npm run judge -- --run data/local/autoplay/<fecha> --no-model solo los detectores (gratis)
 *   npm run judge -- --run … --reuse-model                        repite los detectores y conserva lo del juez modelo (gratis)
 *   npm run judge -- --game data/games/auto-<fecha>-1             una partida suelta
 *   npm run judge -- --run … --dry-run                            juez falso, sin API
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import type { GameEvent, WorldSnapshot } from '../src/engine/model.js';
import { liveClient, type MasterClient, type ToolCallRecord } from '../src/ai/master.js';
import { costUsd, usd, type TokenUsage } from './bench-prices.js';
import { dealWithoutState, outcomeMismatch, rollCategory, ROLL_CATEGORY } from '../src/engine/closecheck.js';
import type { AutoplayRun, GameSummary, PlayerTurn } from './autoplay.js';

// ---------------------------------------------------------------------------
// Tipos de error
// ---------------------------------------------------------------------------

export const DET_TYPES = {
  tool_fallido_narrado: { label: 'Tool fallido narrado como hecho', severity: 3 },
  lugar_inventado: { label: 'Punto o salida inventada (rechazada)', severity: 2 },
  npc_fuera_de_alcance: { label: 'NPC fuera de alcance', severity: 2 },
  prenda_sin_estado: { label: 'Memoria de NPC sin estado detrás (prenda, deuda, trato)', severity: 3 },
  trato_sin_estado: { label: 'Trato narrado sin tool que lo registre (closecheck)', severity: 3 },
  desenlace_contra_tirada: { label: 'Desenlace que no respeta la tirada (closecheck)', severity: 2 },
  tirada_trivial: { label: 'Tirada pedida para algo trivial', severity: 1 },
  sugerida_repetida: { label: 'Acción sugerida que repite la anterior', severity: 1 },
  narracion_larga: { label: 'Narración por encima del tope', severity: 1 },
  cierre_irregular: { label: 'Cierre sin log_event o por tope de tools', severity: 2 },
  master_sin_respuesta: { label: 'El máster no respondió', severity: 3 },
} as const;

export const MODEL_TYPES = {
  incoherencia_contexto: { label: 'Incoherencia con el contexto', def: 'la narración contradice la escena, el inventario, la ficha, lo ya narrado o el estado: personas que no están, objetos que el PJ no tiene, lugares que no existen, hora o luz imposibles.' },
  npc_fuera_de_personaje: { label: 'NPC fuera de personaje', def: 'un NPC habla o actúa en contra de su descripción o motivación, o suelta su secreto sin motivo.' },
  promesa_sin_estado: { label: 'Promesa o trato sin estado', def: 'el máster narra un trato, deuda, pago, prenda, entrega o recompensa como hecho, pero ningún tool del turno lo respalda (buy_item, sell_item, transfer_item, set_debt, pawn_item, settle_debt, complete_job).' },
  regla_mal_aplicada: { label: 'Regla de juego mal aplicada', def: 'tirada con habilidad o CD absurdas, éxito o fallo narrado al revés de lo que dice el dado, daño o PG mal contados, o una acción arriesgada resuelta sin tirada.' },
  imposible_sin_ingenio: { label: 'Respuesta a lo imposible sin ingenio', def: 'el jugador pide algo imposible o que no existe y el máster se lo concede sin más, se lo inventa, o lo corta en seco sin ofrecer nada interesante a cambio.' },
  inventiva_mal_gestionada: { label: 'Inventiva del jugador mal gestionada', def: 'el jugador intenta algo creativo o pícaro (mentir, regatear, colarse, amenazar, pedir fiado, empeñar) y el máster lo ignora, lo resuelve sin consecuencias o le da la razón sin tirada cuando la merece.' },
} as const;

export type DetType = keyof typeof DET_TYPES;
export type ModelType = keyof typeof MODEL_TYPES;
export type ErrorType = DetType | ModelType;

export const TYPE_LABEL: Record<ErrorType, string> = {
  ...Object.fromEntries(Object.entries(DET_TYPES).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(MODEL_TYPES).map(([k, v]) => [k, v.label])),
} as Record<ErrorType, string>;

export interface Finding {
  type: ErrorType;
  layer: 'det' | 'model';
  turn: number;
  event_id: string | null;
  severity: number;
  detail: string;
  /** Cita literal (de la narración, del tool o de la memoria anotada). */
  quote: string;
  /** Juez modelo: ¿la cita aparece de verdad en el turno? */
  quote_ok?: boolean;
  game?: string;
}

/** Un turno del máster: un evento suyo con lo que lo rodea. */
export interface Turn {
  index: number;
  event_id: string;
  action_type: string;
  input_text: string | null;
  narration: string;
  suggested: string[];
  requires_roll: { kind: string; key: string; dc: number | null } | null;
  tags: string[];
  calls: ToolCallRecord[];
  tool_errors: { name: string; error: string }[];
  npc_id: string | null;
  lines: { speaker: string; text: string }[];
  context: string;
  usage: TokenUsage | null;
  model: string | null;
  /** Tirada que precede a un master_roll_outcome. */
  roll: { label: string; total: number; dc: number | null; success: boolean | null; natural?: number } | null;
  /** Del jugador automático (si hay resumen). */
  player?: { mode: PlayerTurn['mode']; impulse: string | null; ok: boolean } | null;
  /** Instante de juego del evento (para saber qué deudas había ya abiertas). */
  game_s?: number;
}

// ---------------------------------------------------------------------------
// Eventos → turnos
// ---------------------------------------------------------------------------

export function turnsFromEvents(events: readonly GameEvent[], characterId: string, actions: readonly PlayerTurn[] = []): Turn[] {
  const byEvent = new Map<string, PlayerTurn>();
  for (const a of actions) for (const id of a.event_ids) byEvent.set(id, a);
  const turns: Turn[] = [];
  let lastRoll: Turn['roll'] = null;
  for (const e of events) {
    if (e.actor_id !== characterId) continue;
    if (e.action_type === 'roll') {
      const r = e.payload['roll'] as { label?: string; total?: number; dc?: number | null; success?: boolean | null; natural?: number } | undefined;
      const req = turns.at(-1)?.requires_roll;
      lastRoll = r ? { label: r.label ?? '', total: r.total ?? 0, dc: req?.dc ?? null, success: r.success ?? null, ...(r.natural ? { natural: r.natural } : {}) } : null;
      continue;
    }
    const m = e.payload['master'] as { model?: string; usage?: TokenUsage; calls?: ToolCallRecord[]; context?: string } | null | undefined;
    if (!m) continue;
    const p = e.payload;
    const a = byEvent.get(e.id);
    turns.push({
      index: turns.length, event_id: e.id, action_type: e.action_type, input_text: e.input_text,
      narration: e.narration_private, suggested: (p['suggested_actions'] as string[] | undefined) ?? [],
      requires_roll: (p['requires_roll'] as Turn['requires_roll'] | undefined) ?? null,
      tags: e.tags, calls: m.calls ?? [], tool_errors: (p['tool_errors'] as Turn['tool_errors'] | undefined) ?? [],
      npc_id: (p['npc_id'] as string | undefined) ?? null, lines: (p['lines'] as Turn['lines'] | undefined) ?? [],
      context: m.context ?? '', usage: m.usage ?? null, model: m.model ?? null,
      roll: e.action_type === 'master_roll_outcome' ? lastRoll : null,
      player: a ? { mode: a.mode, impulse: a.impulse, ok: a.ok } : null,
      game_s: e.timestamp_game_s,
    });
    if (e.action_type === 'master_roll_outcome') lastRoll = null;
  }
  return turns;
}

// ---------------------------------------------------------------------------
// (a) Detectores deterministas
// ---------------------------------------------------------------------------

/** Tope de palabras de la narración según la longitud de la campaña (prompt.ts pide 60-90 en «short»). */
export const NARRATION_CAP_WORDS: Record<string, number> = { short: 140, medium: 260, long: 420 };

const NEGATION = /\b(no|nunca|sin|ni|tampoco|nadie|nada|niega|rechaza|imposible|apenas|intentas|intenta)\b/i;
/** Verbos que narran el efecto de cada tool de escritura como hecho. */
const EFFECT: Record<string, RegExp> = {
  transfer_item: /\b(te (da|entrega|tiende|pasa|vende|cobra)|recibes|coges|tomas|guardas|le das|le entregas|entregas|pagas)\b/i,
  buy_item: /\b(te (da|entrega|tiende|pasa|vende|cobra)|recibes|compras|pagas|guardas)\b/i,
  sell_item: /\b(vendes|te (paga|da)|cobras|le (das|entregas))\b/i,
  pawn_item: /\b(empeñas|en prenda|le (das|dejas|entregas)|te (da|entrega|fía))\b/i,
  spawn_item: /\b(encuentras|recibes|aparece|te (da|entrega))\b/i,
  move_to: /\b(llegas|entras|cruzas|alcanzas|te plantas|subes|bajas)\b/i,
  attack: /\b(golpeas|impactas|hieres|derribas|alcanzas|le (das|clavas|abres))\b/i,
  apply_damage: /\b(sangr\w*|herid[ao]|golpe|cae)\b/i,
  heal: /\b(curas|sanas|recuperas|cierras la herida)\b/i,
  set_debt: /\b(fiad[oa]|apunta|anota|te lo fía|deuda)\b/i,
  settle_debt: /\b(saldad[ao]|pagas|liquidas|cancelas la deuda)\b/i,
  discover_spot: /\b(descubres|encuentras|hallas)\b/i,
  grant_clue: /\b(descubres|averiguas|te das cuenta|comprendes)\b/i,
  complete_job: /\b(cobras|recompensa|te paga)\b/i,
};
const WRITE = new Set(Object.keys(EFFECT).concat(['update_spot_state', 'update_location_state', 'harvest', 'add_condition', 'remove_condition']));
const STATE_TOOLS = new Set(['set_debt', 'pawn_item', 'settle_debt', 'transfer_item', 'buy_item', 'sell_item', 'complete_job']);
/** La memoria da un trato por cerrado (no basta con que se hable de una deuda: eso es contexto, no estado). */
// Límites de palabra con letras acentuadas: \b de JS no ve «ó» como letra y no corta tras «fió» o «entregó».
const DEAL_DONE = /(?<!\p{L})(dejó (\p{L}+ )*en prenda|empeñó|le (dio|entregó|pagó|vendió|compró|fió|debe)|le fía|quedó a deber|aceptó (el trato|la prenda|el pago|la oferta|el fiado)|acordaron|cerraron el trato|trato hecho|(apuntó|anotó) (la|una|su) deuda)(?!\p{L})/iu;
/** Ofertas, preguntas y negativas: lo que la memoria cuenta pero no se ha cerrado. */
const DEAL_OPEN = /(?<!\p{L})(ofreció|propuso|pidió|pregunt\p{L}*|exig\p{L}*|intent\p{L}*|reclam\p{L}*|no (la |lo )?acept\p{L}*|rechaz\p{L}*|sin que|evaluando|consider\p{L}*)(?!\p{L})/iu;
/** Acciones cortas que no merecen tirada (aunque una CD alta sí podría tener sentido). */
const TRIVIAL = /^(saludo|me siento|me presento|espero|camino|entro|salgo|miro alrededor|pido (de )?(beber|comer|una|un)|me acerco|ir |voy )/i;
const TRIVIAL_MAX_WORDS = 8;

const isError = (result: string) => result.startsWith('{"error"');
const errorCode = (result: string): string => { try { const r = JSON.parse(result) as { error?: unknown }; return typeof r.error === 'string' ? r.error : ''; } catch { return ''; } };
const sentences = (t: string) => t.split(/(?<=[.!?…»])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»"“”'.,;:!?¡¿()]/g, ' ').replace(/\s+/g, ' ').trim();
}
function jaccard(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2)); const B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const finding = (t: Turn, type: DetType, detail: string, quote: string): Finding => ({ type, layer: 'det', turn: t.index, event_id: t.event_id, severity: DET_TYPES[type].severity, detail, quote: clip(quote) });

/** Tool de escritura que falló (y no se repitió bien) cuyo efecto la narración da por hecho. */
export function detectFailedToolNarrated(t: Turn): Finding[] {
  const out: Finding[] = [];
  const failed = new Map<string, string>();
  for (const c of t.calls) {
    if (!WRITE.has(c.name)) continue;
    if (isError(c.result)) failed.set(c.name, c.result); else failed.delete(c.name);
  }
  for (const f of t.tool_errors) if (!t.calls.some((c) => c.name === f.name && !isError(c.result))) failed.set(f.name, f.error);
  for (const [name, err] of failed) {
    const re = EFFECT[name];
    if (!re) continue;
    const s = sentences(t.narration).find((x) => re.test(x) && !NEGATION.test(x));
    if (s) out.push(finding(t, 'tool_fallido_narrado', `${name} falló (${clip(errorCode(err) || err, 80)}) y la narración lo da por hecho`, s));
  }
  return out;
}

/** El motor rechazó un lugar inventado en log_event, o move_to a un punto que no existe. */
export function detectInventedPlace(t: Turn): Finding[] {
  const out: Finding[] = [];
  for (const c of t.calls) {
    if (c.name === 'log_event' && /La narración cita/.test(c.result)) {
      const cited = /cita (.+?), que no existe/.exec(c.result)?.[1] ?? '';
      out.push(finding(t, 'lugar_inventado', `log_event rechazado por citar ${cited}`, String(c.input['narration_private'] ?? '')));
    } else if (errorCode(c.result) === 'unknown_spot') {
      out.push(finding(t, 'lugar_inventado', `${c.name} a un punto desconocido: ${String(c.input['target_spot_id'] ?? '')}`, String(c.input['target_spot_id'] ?? '')));
    }
  }
  return out;
}

export function detectNpcOutOfReach(t: Turn): Finding[] {
  return t.calls.filter((c) => errorCode(c.result) === 'not_reachable').map((c) => {
    let reason = '';
    try { reason = String((JSON.parse(c.result) as { detail?: { reason?: string } }).detail?.reason ?? ''); } catch { /* sin detalle */ }
    return finding(t, 'npc_fuera_de_alcance', `${c.name}: ${reason || 'fuera de alcance'}`, reason || c.result);
  });
}

/**
 * Memoria de NPC que da por cerrado un trato (prenda, pago, fiado) sin ningún tool de estado
 * en el turno y, si hay estado final, sin deuda con ese NPC. Ofertas y negativas no cuentan.
 */
export function detectPromiseWithoutState(t: Turn, state?: WorldSnapshot | null, characterId?: string): Finding[] {
  const out: Finding[] = [];
  for (const c of t.calls) {
    if (c.name !== 'log_event' || isError(c.result)) continue;
    const note = String(c.input['npc_memory_note'] ?? '');
    const npc = String(c.input['npc_id'] ?? '');
    if (!note || !DEAL_DONE.test(note) || DEAL_OPEN.test(note)) continue;
    if (t.calls.some((x) => STATE_TOOLS.has(x.name) && !isError(x.result))) continue;
    const pc = state?.characters.find((x) => x.id === characterId);
    if (pc && npc && (pc.debts ?? []).some((d) => d.npc_id === npc)) continue;
    out.push(finding(t, 'prenda_sin_estado', `memoria de ${npc || 'un NPC'} sin tool de estado en el turno${pc ? ' ni deuda al final' : ''}`, note));
  }
  return out;
}

/**
 * Lo que el motor rechaza ahora en el cierre (src/engine/closecheck.ts), aplicado al turno grabado:
 * un trato narrado sin tool de trato, o un desenlace que no encaja con la categoría de la tirada.
 */
export function detectDealWithoutState(t: Turn, state?: WorldSnapshot | null, characterId?: string): Finding[] {
  const ok = t.calls.filter((c) => c.name !== 'log_event' && !isError(c.result)).map((c) => c.name);
  const pc = state?.characters.find((x) => x.id === characterId);
  const open = (pc?.debts ?? []).some((d) => d.created_game_s <= (t.game_s ?? Infinity) && (!d.settled || d.settled.game_s >= (t.game_s ?? 0)));
  const words = dealWithoutState({ narration: t.narration, lines: t.lines as never, okTools: ok, pendingRoll: t.requires_roll !== null, hasOpenDebt: open });
  return words.length ? [finding(t, 'trato_sin_estado', `cita ${words.map((w) => `«${w}»`).join(', ')} sin set_debt/pawn_item/transfer_item en el turno`, sentences(t.narration).find((s) => words.some((w) => norm(s).includes(w))) ?? t.narration)] : [];
}

export function detectOutcomeMismatch(t: Turn): Finding[] {
  // Los ataques los resuelve el motor (impacto y daño): una flecha perdida no es «perder lo esencial».
  if (!t.roll || /^ataque/i.test(t.roll.label)) return [];
  const cat = rollCategory(t.roll);
  const words = outcomeMismatch(cat, t.narration);
  return cat && words.length ? [finding(t, 'desenlace_contra_tirada', `${ROLL_CATEGORY[cat].label} (${t.roll.label} ${t.roll.total}${t.roll.dc !== null ? ` vs CD ${t.roll.dc}` : ''}) narrado con ${words.map((w) => `«${w}»`).join(', ')}`, sentences(t.narration).find((s) => words.some((w) => norm(s).includes(w))) ?? t.narration)] : [];
}

export function detectTrivialRoll(t: Turn): Finding[] {
  const r = t.requires_roll;
  if (!r || r.kind === 'attack') return [];
  const action = (t.input_text ?? '').trim();
  if (r.dc !== null && r.dc <= 5) return [finding(t, 'tirada_trivial', `${r.kind} ${r.key} con CD ${r.dc}`, action || t.narration)];
  if (TRIVIAL.test(action) && action.split(/\s+/).length <= TRIVIAL_MAX_WORDS && (r.dc === null || r.dc <= 10)) return [finding(t, 'tirada_trivial', `${r.kind} ${r.key} CD ${r.dc ?? '—'} para «${clip(action, 60)}»`, action)];
  return [];
}

/** Una acción sugerida que es la misma que el jugador acaba de hacer. */
export function detectRepeatedSuggestion(t: Turn): Finding[] {
  const action = t.input_text?.trim();
  if (!action) return [];
  const s = t.suggested.find((x) => norm(x) === norm(action) || jaccard(x, action) >= 0.8);
  return s ? [finding(t, 'sugerida_repetida', `sugiere «${clip(s, 60)}» justo después de «${clip(action, 60)}»`, s)] : [];
}

export function detectLongNarration(t: Turn, capWords: number): Finding[] {
  const words = t.narration.split(/\s+/).filter(Boolean).length;
  return words > capWords ? [finding(t, 'narracion_larga', `${words} palabras (tope ${capWords})`, t.narration.slice(0, 160))] : [];
}

export function detectIrregularClose(t: Turn): Finding[] {
  const tag = t.tags.find((x) => x === 'no_log_event' || x === 'max_iterations');
  return tag ? [finding(t, 'cierre_irregular', tag, t.narration.slice(0, 160))] : [];
}

export function runDetectors(turns: readonly Turn[], opts: { state?: WorldSnapshot | null; characterId?: string; capWords?: number } = {}): Finding[] {
  const cap = opts.capWords ?? NARRATION_CAP_WORDS['short']!;
  return turns.flatMap((t) => [
    ...detectFailedToolNarrated(t), ...detectInventedPlace(t), ...detectNpcOutOfReach(t),
    ...detectPromiseWithoutState(t, opts.state, opts.characterId), ...detectDealWithoutState(t, opts.state, opts.characterId), ...detectOutcomeMismatch(t),
    ...detectTrivialRoll(t), ...detectRepeatedSuggestion(t),
    ...detectLongNarration(t, cap), ...detectIrregularClose(t),
  ]);
}

/** Acciones del jugador que no tuvieron respuesta del máster (salen del resumen, no del log). */
export function detectNoResponse(actions: readonly PlayerTurn[]): Finding[] {
  return actions.filter((a) => !a.ok && /narrador no responde/i.test(a.engine_text ?? '')).map((a) => ({
    type: 'master_sin_respuesta' as const, layer: 'det' as const, turn: -a.i, event_id: null, severity: DET_TYPES.master_sin_respuesta.severity,
    detail: `acción ${a.i} sin respuesta`, quote: clip(a.text),
  }));
}

// ---------------------------------------------------------------------------
// (b) Juez modelo
// ---------------------------------------------------------------------------

export const JUDGE_SYSTEM = [
  'Revisas partidas de un juego de rol por chat en castellano entre un jugador automático y el narrador (el máster). Señala SOLO errores claros del máster, de esta lista cerrada:',
  ...Object.entries(MODEL_TYPES).map(([k, v]) => `- ${k}: ${v.def}`),
  'No señales estilo, gustos ni errores del jugador. Ante la duda, no lo señales: nada de entradas «para comprobar» ni que digan que no hay error. Cada error lleva el número de turno, una cita literal copiada de la narración del máster de ese turno (como mucho 200 caracteres) y una frase de por qué.',
  'Devuelve SOLO un objeto JSON, sin texto alrededor: {"findings":[{"turn":<número>,"type":"<tipo de la lista>","severity":<1 leve, 2 claro, 3 grave>,"quote":"<cita literal>","why":"<una frase>"}]}. Sin errores: {"findings":[]}.',
].join('\n');

/** Escena del contexto del máster sin lo que sobra para juzgar (hora, últimos eventos, la acción repetida). */
export function sceneExtract(context: string, max = 1400): string {
  const keep = context.split(/\n(?=## )/).filter((s) => !/^## (Tiempo|Últimos eventos|Acción del jugador|Resultado de la tirada)/.test(s.trim()));
  return clip(keep.join('\n').trim(), max);
}

export function turnBlock(t: Turn): string {
  const lines = [`### Turno ${t.index} (${t.action_type.replace('master_', '').replace('master', 'acción')})`];
  if (t.input_text) lines.push(`Jugador: «${t.input_text}»${t.player?.mode === 'own' ? ` [acción propia${t.player.impulse ? `: ${t.player.impulse}` : ''}]` : ''}`);
  if (t.roll) lines.push(`Tirada: ${t.roll.label} = ${t.roll.total}${t.roll.dc !== null ? ` vs CD ${t.roll.dc}` : ''} → ${t.roll.success === null ? '—' : t.roll.success ? 'éxito' : 'fallo'}${t.roll.natural ? ` (natural ${t.roll.natural})` : ''}`);
  if (t.context) lines.push(`Escena:\n${sceneExtract(t.context)}`);
  if (t.calls.length) lines.push(`Tools: ${t.calls.filter((c) => c.name !== 'log_event' || isError(c.result)).map((c) => `${c.name}(${clip(JSON.stringify(c.input), 90)}) → ${isError(c.result) ? `ERROR ${clip(c.result, 100)}` : 'ok'}`).join('; ') || 'solo log_event'}`);
  lines.push(`Máster: ${t.narration}`);
  if (t.suggested.length) lines.push(`Sugeridas: ${t.suggested.join(' | ')}`);
  if (t.requires_roll) lines.push(`Pide tirada: ${t.requires_roll.kind} ${t.requires_roll.key} CD ${t.requires_roll.dc ?? '—'}`);
  return lines.join('\n');
}

export function judgePrompt(header: string, turns: readonly Turn[]): string {
  return `${header}\n\n${turns.map(turnBlock).join('\n\n')}\n\nRevisa estos turnos (${turns.map((t) => t.index).join(', ')}) y devuelve el JSON.`;
}

/** Entradas que el propio juez desmiente en su «por qué» («no hay error claro», «es coherente», «se retira»). */
export const RETRACTED = /\b(no hay (ningún )?error|no es (un )?error|sin error|es coherente|coherente con la escena|se retira|lo dejo solo como comprobación|no (presenta|tiene) (ningún )?error|no procede|se descarta)\b/i;

/**
 * Parseo estricto pero tolerante con el envoltorio: admite ```json …``` o texto alrededor del objeto.
 * Descarta (y cuenta) entradas con tipo fuera de la lista, turno fuera del lote o sin cita.
 */
export function parseJudge(text: string, turns: readonly Turn[]): { findings: Finding[]; dropped: string[]; error: string | null } {
  const body = text.replace(/```(?:json)?/gi, '');
  const a = body.indexOf('{'); const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return { findings: [], dropped: [], error: 'sin JSON' };
  let raw: unknown;
  try { raw = JSON.parse(body.slice(a, b + 1)); } catch (e) { return { findings: [], dropped: [], error: `JSON inválido: ${(e as Error).message}` }; }
  const list = (raw as { findings?: unknown }).findings;
  if (!Array.isArray(list)) return { findings: [], dropped: [], error: 'falta findings[]' };
  const byIndex = new Map(turns.map((t) => [t.index, t]));
  const findings: Finding[] = []; const dropped: string[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const type = String(x?.['type'] ?? '');
    const turn = Number(x?.['turn']);
    const quote = String(x?.['quote'] ?? '').trim();
    const t = byIndex.get(turn);
    if (!(type in MODEL_TYPES)) { dropped.push(`tipo desconocido: ${type}`); continue; }
    if (!t) { dropped.push(`turno fuera del lote: ${String(x?.['turn'])}`); continue; }
    if (!quote) { dropped.push(`sin cita (turno ${turn})`); continue; }
    if (RETRACTED.test(String(x['why'] ?? ''))) { dropped.push(`retirado por el propio juez (turno ${turn})`); continue; }
    const sev = Math.min(3, Math.max(1, Math.round(Number(x['severity']) || 2)));
    const hay = norm([t.narration, t.input_text ?? '', ...t.suggested, ...t.lines.map((l) => l.text)].join(' '));
    findings.push({ type: type as ModelType, layer: 'model', turn, event_id: t.event_id, severity: sev, detail: clip(String(x['why'] ?? ''), 240), quote: clip(quote), quote_ok: hay.includes(norm(quote)) });
  }
  return { findings, dropped, error: null };
}

/** Juez falso: un hallazgo en el primer turno con acción propia del lote (cita sus primeras palabras); si no, nada. */
export function dryJudgeClient(): MasterClient {
  return {
    async create(params) {
      const prompt = params.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      const m = /### Turno (\d+)[^\n]*\nJugador: [^\n]*\[acción propia[^\n]*\n(?:[\s\S]*?)\nMáster: ([^\n]+)/.exec(prompt);
      const findings = m ? [{ turn: Number(m[1]), type: 'inventiva_mal_gestionada', severity: 1, quote: m[2]!.split(/\s+/).slice(0, 8).join(' '), why: '[dry-run] hallazgo de ejemplo' }] : [];
      return {
        id: 'msg_dry_judge', type: 'message', role: 'assistant', model: params.model, content: [{ type: 'text', text: JSON.stringify({ findings }) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: Math.round(prompt.length / 3.5), output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

// ---------------------------------------------------------------------------
// Una partida
// ---------------------------------------------------------------------------

export interface GameJudgement {
  slug: string;
  character: string;
  actions: number;
  turns: number;
  findings: Finding[];
  /** Turnos para el top 10 (con su texto literal). */
  turn_text: Record<number, { action: string | null; narration: string }>;
  judge: { usage: TokenUsage; cost_usd: number | null; calls: number; parse_errors: string[]; dropped: string[] };
  cost_usd: number | null;
}

interface LoadedGame { slug: string; events: GameEvent[]; state: WorldSnapshot | null; characterId: string; character: string }

export function loadGame(dir: string, characterId?: string): LoadedGame {
  const manifest = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8')) as { slug: string; campaign_id: string; data_dir: string; character_id: string | null };
  const data = resolve(dir, manifest.data_dir);
  const evFile = join(data, `${manifest.campaign_id}.events.jsonl`);
  const events = existsSync(evFile) ? readFileSync(evFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as GameEvent) : [];
  const wFile = join(data, `${manifest.campaign_id}.world.json`);
  const state = existsSync(wFile) ? JSON.parse(readFileSync(wFile, 'utf8')) as WorldSnapshot : null;
  const id = characterId ?? manifest.character_id ?? events.find((e) => e.payload['master'])?.actor_id ?? '';
  return { slug: manifest.slug, events, state, characterId: id, character: state?.characters.find((c) => c.id === id)?.name ?? id };
}

export const TURNS_PER_JUDGE_CALL = 10;

export async function judgeGame(dir: string, opts: { summary?: GameSummary; client?: MasterClient | null; model: string; log?: (s: string) => void }): Promise<GameJudgement> {
  const g = loadGame(dir, opts.summary?.character.id);
  const actions = opts.summary?.actions ?? [];
  const turns = turnsFromEvents(g.events, g.characterId, actions);
  const cap = NARRATION_CAP_WORDS[g.state?.campaign.master.narration_length ?? 'short'] ?? NARRATION_CAP_WORDS['short']!;
  const findings = [...runDetectors(turns, { state: g.state, characterId: g.characterId, capWords: cap }), ...detectNoResponse(actions)];
  const judge = { usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd: 0 as number | null, calls: 0, parse_errors: [] as string[], dropped: [] as string[] };

  if (opts.client && turns.length) {
    const pc = g.state?.characters.find((c) => c.id === g.characterId);
    const npcIds = new Set(turns.map((t) => t.npc_id).filter((x): x is string => Boolean(x)));
    const npcs = (g.state?.npcs ?? []).filter((n) => npcIds.has(n.id)).map((n) => `- ${n.name} [${n.id}], ${n.role}: ${clip(n.description, 160)} Quiere: ${clip(n.motivation, 120)}`);
    const header = [
      `## Personaje\n${pc ? `${pc.name}, ${pc.class_name}. ${clip(pc.backstory ?? '', 700)}` : g.character}`,
      npcs.length ? `## NPC que hablan en la partida\n${npcs.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    for (let i = 0; i < turns.length; i += TURNS_PER_JUDGE_CALL) {
      const batch = turns.slice(i, i + TURNS_PER_JUDGE_CALL);
      // Sin pensamiento: con él, Haiku gastaba el tope de salida antes de escribir el JSON.
      const res = await opts.client.create({ model: opts.model, max_tokens: 3000, thinking: { type: 'disabled' }, system: JUDGE_SYSTEM, messages: [{ role: 'user', content: judgePrompt(header, batch) }] });
      judge.calls++;
      judge.usage.input += res.usage.input_tokens; judge.usage.output += res.usage.output_tokens;
      judge.usage.cache_read += res.usage.cache_read_input_tokens ?? 0; judge.usage.cache_write += res.usage.cache_creation_input_tokens ?? 0;
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
      const parsed = parseJudge(text, batch);
      if (parsed.error) judge.parse_errors.push(`turnos ${batch[0]!.index}-${batch.at(-1)!.index}: ${parsed.error} (stop_reason ${res.stop_reason})`);
      judge.dropped.push(...parsed.dropped);
      findings.push(...parsed.findings);
    }
    judge.cost_usd = costUsd(judge.usage, opts.model);
  }
  for (const f of findings) f.game = g.slug;
  opts.log?.(`  ${g.slug}: ${turns.length} turnos, ${findings.filter((f) => f.layer === 'det').length} det + ${findings.filter((f) => f.layer === 'model').length} juez${judge.calls ? ` (${usd(judge.cost_usd, 4)})` : ''}`);
  const turn_text: GameJudgement['turn_text'] = {};
  for (const t of turns) turn_text[t.index] = { action: t.input_text, narration: t.narration };
  return { slug: g.slug, character: g.character, actions: actions.length || turns.filter((t) => t.input_text).length, turns: turns.length, findings, turn_text, judge, cost_usd: opts.summary?.cost_usd ?? null };
}

// ---------------------------------------------------------------------------
// Informe agregado
// ---------------------------------------------------------------------------

const ALL_TYPES = [...Object.keys(DET_TYPES), ...Object.keys(MODEL_TYPES)] as ErrorType[];
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

export function buildReport(games: readonly GameJudgement[], run: AutoplayRun | null, title: string): string {
  const all = games.flatMap((g) => g.findings);
  const actions = games.reduce((a, g) => a + g.actions, 0);
  const judgeCost = games.reduce<number | null>((a, g) => (a === null || g.judge.cost_usd === null ? null : a + g.judge.cost_usd), 0);
  const playCost = run?.totals.cost_usd ?? null;
  const out: string[] = [`# Informe de partidas automáticas · ${title}`, ''];
  if (run) out.push(`${run.dry_run ? '**Dry-run** (clientes falsos, sin API). ' : ''}${run.games.length} partidas × ${run.actions_per_game} acciones · máster ${run.models.master} · jugador ${run.models.player} · mundo ${run.models.worldgen} · juez ${run.models.judge} · semilla ${run.seed}.`, '');
  out.push(`**${all.length} errores** en ${actions} acciones (${actions ? ((all.length / actions) * 100).toFixed(0) : '—'} por cada 100). Coste: partidas ${usd(playCost, 4)} + juez ${usd(judgeCost, 4)} = **${usd(playCost === null || judgeCost === null ? null : playCost + judgeCost, 4)}**.`, '');

  out.push('## Errores por tipo', '', '| Tipo | Capa | Errores | Partidas | Por 100 acciones |', '|---|---|---:|---:|---:|');
  for (const type of ALL_TYPES) {
    const fs = all.filter((f) => f.type === type);
    if (!fs.length) continue;
    out.push(`| ${TYPE_LABEL[type]} (\`${type}\`) | ${type in DET_TYPES ? 'determinista' : 'juez'} | ${fs.length} | ${new Set(fs.map((f) => f.game)).size} | ${actions ? ((fs.length / actions) * 100).toFixed(1) : '—'} |`);
  }
  const unverified = all.filter((f) => f.layer === 'model' && f.quote_ok === false).length;
  if (unverified) out.push('', `${unverified} hallazgos del juez citan un texto que no aparece literal en el turno (marcados con ⚠ abajo).`);

  out.push('', '## Por partida', '', '| Partida | Personaje | Acciones | Deterministas | Juez | Coste partida | Coste juez |', '|---|---|---:|---:|---:|---:|---:|');
  for (const g of games) out.push(`| ${g.slug} | ${esc(g.character)} | ${g.actions} | ${g.findings.filter((f) => f.layer === 'det').length} | ${g.findings.filter((f) => f.layer === 'model').length} | ${usd(g.cost_usd, 4)} | ${usd(g.judge.cost_usd, 4)} |`);

  // Top 10: los turnos con más gravedad acumulada (los hallazgos con cita verificada pesan entero; los dudosos, la mitad).
  const byTurn = new Map<string, { g: GameJudgement; turn: number; fs: Finding[]; score: number }>();
  for (const g of games) for (const f of g.findings) {
    if (f.turn < 0) continue;
    const k = `${g.slug}#${f.turn}`;
    const e = byTurn.get(k) ?? { g, turn: f.turn, fs: [], score: 0 };
    e.fs.push(f); e.score += f.quote_ok === false ? f.severity / 2 : f.severity;
    byTurn.set(k, e);
  }
  const top = [...byTurn.values()].sort((a, b) => b.score - a.score || a.g.slug.localeCompare(b.g.slug) || a.turn - b.turn).slice(0, 10);
  out.push('', '## Top 10 turnos', '');
  for (const [i, e] of top.entries()) {
    const tt = e.g.turn_text[e.turn];
    out.push(`### ${i + 1}. ${e.g.slug} · turno ${e.turn} (gravedad ${e.score})`, '');
    if (tt?.action) out.push(`> **Jugador:** ${esc(tt.action)}`, '>');
    out.push(`> **Máster:** ${esc(clip(tt?.narration ?? '', 600))}`, '');
    for (const f of e.fs) out.push(`- **${TYPE_LABEL[f.type]}** (${f.layer === 'det' ? 'determinista' : 'juez'}, ${f.severity}): ${esc(f.detail)} — «${esc(f.quote)}»${f.quote_ok === false ? ' ⚠ cita no literal' : ''}`);
    out.push('');
  }
  const problems = games.flatMap((g) => [...g.judge.parse_errors.map((p) => `${g.slug}: ${p}`), ...g.judge.dropped.map((d) => `${g.slug}: descartado (${d})`)]);
  if (problems.length) out.push('## Avisos del juez', '', ...problems.map((p) => `- ${esc(p)}`), '');
  if (run?.errors?.length) out.push('## Partidas que no terminaron', '', ...run.errors.map((p) => `- ${esc(p)}`), '');

  out.push('## Coste', '');
  if (run) {
    const t = run.totals;
    out.push(`- Máster: ${usd(t.master_usd, 4)} (${t.master_calls} llamadas, ${usd(t.master_usd === null || !t.actions ? null : t.master_usd / t.actions, 5)} por acción)`);
    out.push(`- Jugador: ${usd(t.player_usd, 4)}`, `- Mundos: ${usd(t.worldgen_usd, 4)}`);
  }
  out.push(`- Juez: ${usd(judgeCost, 4)} (${games.reduce((a, g) => a + g.judge.calls, 0)} llamadas)`, `- **Total: ${usd(playCost === null || judgeCost === null ? (run ? null : judgeCost) : playCost + judgeCost, 4)}**`, '');
  return out.join('\n');
}

/**
 * Juzga todas las partidas de una tanda. Con `reuseModel`, los hallazgos del juez modelo salen del
 * findings.json anterior (y su coste) y solo se repiten los detectores: afinar detectores no gasta.
 */
export async function judgeRun(opts: { runDir: string; model: string; dryRun: boolean; useModel: boolean; reuseModel?: boolean; client?: MasterClient; log?: (s: string) => void }): Promise<{ findings: Finding[]; judge_cost_usd: number | null; file: string; games: GameJudgement[] }> {
  const run = JSON.parse(readFileSync(join(opts.runDir, 'summary.json'), 'utf8')) as AutoplayRun;
  const previous = opts.reuseModel ? JSON.parse(readFileSync(join(opts.runDir, 'findings.json'), 'utf8')) as Omit<GameJudgement, 'turn_text'>[] : [];
  const client = !opts.useModel || opts.reuseModel ? null : opts.dryRun ? dryJudgeClient() : opts.client ?? liveClient(120_000);
  const games: GameJudgement[] = [];
  for (const s of run.games) {
    const g = await judgeGame(s.dir, { summary: s, client, model: opts.model, ...(opts.log ? { log: opts.log } : {}) });
    const old = previous.find((p) => p.slug === g.slug);
    if (old) {
      const kept = old.findings.filter((f) => f.layer === 'model' && !RETRACTED.test(f.detail));
      g.findings.push(...kept);
      g.judge = { ...old.judge, dropped: [...old.judge.dropped, ...old.findings.filter((f) => f.layer === 'model' && RETRACTED.test(f.detail)).map((f) => `retirado por el propio juez (turno ${f.turn})`)] };
    }
    games.push(g);
  }
  const file = join(opts.runDir, 'report.md');
  writeFileSync(file, buildReport(games, run, run.stamp));
  writeFileSync(join(opts.runDir, 'findings.json'), JSON.stringify(games.map(({ turn_text: _t, ...g }) => g), null, 2));
  const judgeCost = games.reduce<number | null>((a, g) => (a === null || g.judge.cost_usd === null ? null : a + g.judge.cost_usd), 0);
  return { findings: games.flatMap((g) => g.findings), judge_cost_usd: judgeCost, file, games };
}

async function main() {
  const { values } = parseArgs({
    options: { run: { type: 'string' }, game: { type: 'string' }, 'no-model': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, live: { type: 'boolean', default: false }, 'reuse-model': { type: 'boolean', default: false } },
  });
  const model = process.env['JUDGE_MODEL']?.trim() || 'claude-haiku-5-5';
  const useModel = !values['no-model'] && (values['dry-run'] || values.live);
  if (!values['no-model'] && !values['dry-run'] && !values.live) console.log('Sin --live solo corren los detectores deterministas (gratis); el juez modelo cuesta ~0,15 céntimos por cada 10 turnos con Haiku.');
  const log = (s: string) => console.log(s);
  if (values.run) {
    const r = await judgeRun({ runDir: resolve(values.run), model, dryRun: values['dry-run'], useModel, reuseModel: values['reuse-model'], log });
    console.log(`${r.findings.length} errores, juez ${usd(r.judge_cost_usd, 4)} → ${r.file}`);
  } else if (values.game) {
    const g = await judgeGame(resolve(values.game), { client: useModel ? (values['dry-run'] ? dryJudgeClient() : liveClient(120_000)) : null, model, log });
    const file = join(resolve(values.game), 'report.md');
    writeFileSync(file, buildReport([g], null, g.slug));
    console.log(`${g.findings.length} errores → ${file}`);
  } else {
    throw new Error('Indica --run <carpeta del piloto> o --game <carpeta de partida>.');
  }
}

if (process.argv[1] && /judge\.ts$/.test(process.argv[1])) {
  main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
}
