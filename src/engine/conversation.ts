/**
 * Conversación en curso, sin IA. El PJ está hablando con un NPC si sus últimos
 * turnos son diálogo con ese NPC (sus `lines` o el `npc_id` del cierre), en el
 * mismo punto y sin moverse ni pelear entre medias. Se rompe al moverse, al
 * cambiar de interlocutor, al combatir o tras un turno sin diálogo.
 *
 * En conversación el narrador solo entra cuando aporta (prompt.ts, regla
 * CONVERSACIÓN): una frase que presenta a quien va a hablar la primera vez, una
 * acción concreta que cambia la escena o algo relevante para el jugador. El
 * cierre se comprueba aquí (conversationCheck) y tools.ts lo rechaza una vez si
 * la narración es larga o repite gestos ya narrados en la misma conversación.
 */

import type { GameEvent, Id } from './model.js';
import type { DialogueLine } from './moments.js';

export interface Conversation {
  npc_id: Id;
  /** Turnos de diálogo con ese NPC ya cerrados; la acción en curso es el turno turns + 1. */
  turns: number;
  /** Si el NPC ya ha hablado en esta conversación (entonces no se le presenta otra vez). */
  npc_spoke: boolean;
  /** Gestos ya narrados en la conversación (claves de GESTURES): repetirlos es relleno. */
  gestures: string[];
}

/** Tope de palabras de narración (sin las citas) en un turno de conversación. */
export const CONVERSATION_MAX_WORDS = 40;
/** El desenlace de una tirada es relevante por definición: algo más de margen. */
export const CONVERSATION_MAX_WORDS_ROLL = 60;
/**
 * Un gesto repetido junto a una acción concreta no es un turno de relleno: si
 * el resto de la prosa (las frases sin gesto repetido) llega a estas palabras,
 * pasa. Partida del 27-10, seq 96: «Brenna no levanta la vista de la jarra.
 * Cuenta cien monedas…, deja una llave de hierro…» se rechazaba entero.
 */
export const CONVERSATION_FILLER_REST_WORDS = 8;

/** Desplazamientos: llegar, pasar por un sitio, entrar en la partida. */
const MOVES = new Set(['arrived', 'passed', 'move', 'master_arrival', 'master_intro', 'character_joined', 'travel_encounter']);
/** Lo que no es un turno del jugador: no cuenta ni rompe. */
const SKIP = /^(roll|board|announcement|progress_)/;
const COMBAT_TOOLS = new Set(['attack', 'apply_damage']);

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Gestos de relleno típicos, normalizados (sin tildes). Narrar uno la primera
 * vez puede presentar a alguien («deja la jarra y se vuelve hacia ti:»);
 * volver a él en la misma conversación es relleno.
 */
export const GESTURES: Record<string, RegExp> = {
  pano: /\b(pano|trapo)\b/,
  jarra: /\bjarras?\b/,
  vaso: /\b(vasos?|copas?)\b/,
  mirada: /\b(te mira\w*|mirada|mira(?:r|ndo)te|te observa\w*|levanta la vista|aparta la vista|sin apartar|clava los ojos)\b/,
  hombros: /\bencog\w* de hombros\b/,
  cabeza: /\b(asiente|niega con la cabeza|ladea la cabeza)\b/,
  ceno: /\bfrunce\w* el ceno\b/,
  suspiro: /\bsuspir\w*\b/,
  sonrisa: /\b(sonri\w*|sonrisa)\b/,
  manos: /\bapoya\w* (las manos|los codos|un dedo|el codo)\b/,
};

/** Narración sin las citas: lo que dice el narrador. */
export function narratorProse(narration: string): string {
  return narration.replace(/«[^»]*»|“[^”]*”|"[^"\n]*"/g, ' ').replace(/\s+/g, ' ').trim();
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

/** Frases de la prosa, por su puntuación final. */
function sentences(prose: string): string[] {
  return prose.split(/(?<=[.;!?…])\s+/).map((x) => x.trim()).filter(Boolean);
}

/** Claves de GESTURES que aparecen en el texto. */
export function gesturesIn(text: string): string[] {
  const t = norm(narratorProse(text));
  return Object.keys(GESTURES).filter((k) => GESTURES[k]!.test(t));
}

function linesOf(e: Pick<GameEvent, 'payload'>): DialogueLine[] {
  const raw = e.payload['lines'];
  return Array.isArray(raw) ? (raw as DialogueLine[]).filter((l) => l && typeof l.text === 'string') : [];
}

/** Con quién habla el PJ en un cierre: el npc_id del cierre o, si no, el último NPC que habla. */
export function interlocutorOf(npcId: Id | null | undefined, lines: readonly DialogueLine[]): Id | null {
  if (npcId) return npcId;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.speaker === 'npc' && lines[i]!.npc_id) return lines[i]!.npc_id!;
  return null;
}

function calls(e: Pick<GameEvent, 'payload'>): { name: string; result: string }[] {
  const m = e.payload['master'] as { calls?: { name: string; result: string }[] } | null | undefined;
  return Array.isArray(m?.calls) ? m!.calls : [];
}
const okCall = (c: { result: string }) => !String(c.result).startsWith('{"error"');

function combat(e: GameEvent): boolean {
  if (e.tags.includes('combat') || e.payload['attack']) return true;
  if ((e.payload['requires_roll'] as { kind?: string } | undefined)?.kind === 'attack') return true;
  return calls(e).some((c) => COMBAT_TOOLS.has(c.name) && okCall(c));
}

function moved(e: GameEvent): boolean {
  return MOVES.has(e.action_type) || e.tags.includes('movement') || calls(e).some((c) => c.name === 'move_to' && okCall(c));
}

/**
 * La conversación en curso del PJ a partir de sus eventos, del más reciente
 * hacia atrás. `here` es dónde está ahora: un turno en otro punto la corta.
 * Las tiradas y la petición de tirada (salvo un ataque) no cuentan ni cortan:
 * la petición y su desenlace son el mismo turno. Null si no hay conversación.
 */
export function conversationOf(events: readonly GameEvent[], actorId: Id, here: { location_id: Id; spot_id: Id | null }): Conversation | null {
  let npc: Id | null = null;
  let turns = 0;
  let spoke = false;
  const gestures = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.actor_id !== actorId) continue;
    if (combat(e)) break;
    if (SKIP.test(e.action_type)) continue;
    if (moved(e) || e.location_id !== here.location_id || (here.spot_id && e.spot_id && e.spot_id !== here.spot_id)) break;
    const lines = linesOf(e);
    const who = interlocutorOf(typeof e.payload['npc_id'] === 'string' ? (e.payload['npc_id'] as Id) : null, lines);
    const pendingRoll = Boolean(e.payload['requires_roll']);
    if (!who) { if (pendingRoll) continue; break; }
    if (npc && who !== npc) break;
    npc = who;
    for (const g of gesturesIn(e.narration_private)) gestures.add(g);
    if (lines.some((l) => l.speaker === 'npc' && l.npc_id === who)) spoke = true;
    if (!pendingRoll) turns++;
  }
  return npc && turns > 0 ? { npc_id: npc, turns, npc_spoke: spoke, gestures: [...gestures] } : null;
}

/** Bloque corto del contexto del máster (prompt.ts). */
export function conversationBlock(c: Conversation, name: string): string {
  return [
    `## En conversación con ${name} (turno ${c.turns + 1})`,
    `Si la acción sigue la charla con ${name}, aplica CONVERSACIÓN: narration_private vacía, o solo una acción concreta, algo relevante para el jugador${c.npc_spoke ? '' : ' o una frase que presente a quien va a hablar, terminada en dos puntos'}. ${c.npc_spoke ? 'Ya ha hablado en esta conversación: no la presentes otra vez.' : ''}`.trim(),
    c.gestures.length ? `Gestos ya narrados (no los repitas): ${c.gestures.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

export type ConversationProblem =
  | { kind: 'empty' }
  | { kind: 'long'; words: number; max: number }
  | { kind: 'filler'; gestures: string[] };

/**
 * Comprueba un cierre en conversación. Solo si el cierre sigue hablando con
 * el mismo NPC y el turno no es un ataque ni un desplazamiento. Narración vacía
 * con lines está bien; vacía y sin lines, no. Larga (más de
 * CONVERSATION_MAX_WORDS sin contar las citas; CONVERSATION_MAX_WORDS_ROLL si
 * narra el desenlace de una tirada) o con gestos ya narrados, no. Afinado con
 * fdd, los-kiwis y el piloto 20261022-0929: ningún turno fuera de conversación.
 * Desde la partida del 27-10: el tope solo cuenta si alguien habla, el gesto de
 * otro NPC no es relleno y un gesto repetido junto a una acción concreta pasa.
 */
export function conversationCheck(input: {
  conversation: Conversation | null;
  narration: string;
  lines: readonly DialogueLine[];
  npcId: Id | null;
  okTools: readonly string[];
  attack?: boolean;
  rollOutcome?: boolean;
  /** Nombres de los demás NPC del sitio (no el interlocutor): su gesto es una reacción nueva, no relleno (seq 95: Garrán te mira de reojo). */
  others?: readonly string[];
}): ConversationProblem | null {
  const c = input.conversation;
  if (!c || input.attack || input.okTools.some((t) => t === 'move_to' || COMBAT_TOOLS.has(t))) return null;
  const who = interlocutorOf(input.npcId, input.lines);
  if (who !== c.npc_id && !(who === null && !narratorProse(input.narration))) return null;
  const prose = narratorProse(input.narration);
  if (!prose) return input.lines.length ? null : { kind: 'empty' };
  const words = wordCount(prose);
  const max = input.rollOutcome ? CONVERSATION_MAX_WORDS_ROLL : CONVERSATION_MAX_WORDS;
  // Sin nadie que hable (ni lines ni citas) el turno no es charla, es una acción narrada («esperar a que se acueste
  // el pueblo», seq 39): el tope de palabras no aplica. El relleno de gestos, sí.
  const talk = input.lines.length > 0 || prose !== input.narration.replace(/\s+/g, ' ').trim();
  if (talk && words > max) return { kind: 'long', words, max };
  const spaced = (t: string) => ` ${norm(t).replace(/[^a-zñ0-9]+/g, ' ').trim()} `;
  const others = (input.others ?? []).map(spaced).filter((o) => o.trim().length > 2);
  const repeated = new Set<string>();
  let rest = 0;
  for (const sentence of sentences(prose)) {
    const g = gesturesIn(sentence).filter((x) => c.gestures.includes(x));
    const n = spaced(sentence);
    if (g.length && !others.some((o) => n.includes(o))) g.forEach((x) => repeated.add(x));
    else rest += wordCount(sentence);
  }
  return repeated.size && rest < CONVERSATION_FILLER_REST_WORDS ? { kind: 'filler', gestures: [...repeated] } : null;
}

export function conversationRejection(p: ConversationProblem, name: string): string {
  const fix = `Deja narration_private en lo que aporta (una acción concreta y visible, algo relevante para el jugador o una frase que presente a quien habla, terminada en dos puntos) o vacíala, y pon lo dicho en lines.`;
  if (p.kind === 'empty') return `Estás en conversación con ${name} y el cierre no trae nada: pon al menos su respuesta en lines (narration_private puede ir vacía).`;
  if (p.kind === 'long') return `Estás en conversación con ${name}: la narración tiene ${p.words} palabras sin contar lo dicho (tope ${p.max}). ${fix}`;
  return `Estás en conversación con ${name}: la narración repite gestos ya narrados (${p.gestures.join(', ')}), que son relleno. ${fix}`;
}

/**
 * Narración que se guarda cuando el máster deja fuera lo dicho (en
 * conversación narration_private puede ir vacía o ser solo la presentación):
 * las frases del actor delante, la prosa y las de los NPC detrás, como citas.
 * Así el historial, el recap y el contexto del máster siguen teniendo el
 * diálogo, y la web (novel.ts) atribuye cada cita a su línea sin burbuja del
 * narrador. Si la narración ya trae citas, no se toca.
 */
export function narrationWithLines(narration: string, lines: readonly DialogueLine[]): string {
  const prose = narration.trim();
  if (!lines.length || /[«“"]/.test(prose)) return prose;
  const q = (l: DialogueLine) => `«${l.text.trim()}»`;
  return [...lines.filter((l) => l.speaker === 'actor').map(q), prose, ...lines.filter((l) => l.speaker !== 'actor').map(q)].filter(Boolean).join(' ');
}
