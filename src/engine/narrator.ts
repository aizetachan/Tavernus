/**
 * Cuándo habla el narrador en una charla (docs/CONVERSACION-REGLAS.md, §7). Si solo hablan, se ven las
 * conversaciones: burbujas de los personajes y nada más. El narrador entra cuando pasa algo más que hablar.
 * El motor lo decide por reglas, antes de llamar al máster y otra vez al cierre con los tools del turno:
 *
 *   - `full`:   pasa algo más que hablar: el jugador hace algo físico, desenlace de una tirada, combate o un
 *               alto que llega, llegada o escena, incidente pendiente, la charla empieza (presentación), cambio
 *               de punto o de localización. Narración normal.
 *   - `beat`:   es charla, pero algo pequeño cambia: confianza o actitud, una misión que se da o se cierra, algo
 *               que cambia de mano, alguien que llega o se va. Una acotación de BEAT_WORDS palabras como mucho.
 *   - `silent`: charla sin más. Solo `lines`; el gesto de quien habla, si lo hay, en su `beat` (DialogueLine).
 *
 * Va al final del guion de la charla (talk.ts, tras el hueco E). El cierre (ai/tools.ts) lo hace cumplir sin pedir reescrituras: en `silent` la narración se vacía (si es una
 * frase corta que presenta a quien habla, pasa a su acotación) y en `beat` se recorta. Sin campaña aquí.
 */

import type { Character, Id, Npc } from './model.js';
import type { World } from './world.js';
import type { DialogueLine } from './moments.js';
import type { TalkPlan } from './talk.js';
import { dueNpcTurns } from './combat.js';
import { pendingIncidents } from './crime.js';
import { descriptorOf } from './narrate.js';

export type NarratorMode = 'silent' | 'beat' | 'full';

/** Palabras como mucho de la acotación del narrador en `beat` (y de la frase que pasa a acotación en `silent`). */
export const BEAT_WORDS = 15;
/** Palabras como mucho del `beat` de una línea (el gesto de quien habla). */
export const LINE_BEAT_WORDS = 12;

/** Lo que el motor ha decidido para el narrador, con el motivo (para el contexto y para depurar). */
export interface NarratorPlan { mode: NarratorMode; why: string }

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wordCount = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Verbos de una acción física del jugador, en primera persona (sobre texto normalizado y sin lo que va entre
 * comillas, que es lo que dice). «Me acerco», «saco la daga», «levanto las manos»: algo más que hablar.
 */
const PHYSICAL = new RegExp('\\b(' + [
  // Sin palabras que también son nombres o se dicen hablando: «el robo», «el camino», «busco trabajo», «espero que…», «me siento mal».
  'ataco', 'golpeo', 'le pego', 'te pego', 'apunalo', 'disparo', 'lanzo', 'arrojo', 'tiro (?:el|la|los|las|una?|mi)', 'desenvaino', 'desenfundo',
  'saco (?:el|la|mi|una?) \\w+', 'empuno', 'agarro', 'empujo', 'forcejeo', 'placo', 'derribo', 'rompo', 'pateo', 'muerdo',
  'huyo', 'corro', 'escapo', 'trepo', 'escalo', 'me escondo', 'me agacho', 'me lanzo', 'me abalanzo',
  'me acerco', 'me alejo', 'me aparto', 'retrocedo', 'avanzo', 'me voy', 'me marcho', 'entro', 'salgo', 'subo', 'bajo (?:a|al|por|la|las|los|el)', 'cruzo', 'voy (?:al|hacia|hasta)',
  'abro', 'cierro', 'registro', 'rebusco', 'examino', 'inspecciono', 'miro alrededor', 'le robo', 'cojo', 'recojo', 'guardo (?:el|la|mi|las|los)',
  'levanto las manos', 'me rindo', 'me entrego', 'suelto (?:el|la|mi) \\w+', 'me levanto', 'duermo',
].join('|') + ')\\b');

/** Lo que el jugador escribe sin lo que va entre comillas (lo que dice en voz alta). */
function unquoted(text: string): string {
  return text.replace(/[«“"][^«»“”"]*[»”"]?/g, ' ');
}

/**
 * ¿Hace algo más que hablar? Un verbo de acción física fuera de las comillas. Más estricto que `soundsLikeTalk`
 * (talk.ts), que decide si hay guion de charla: «Saco la daga y le digo "quieta"» le habla, y por eso tiene guion,
 * pero el narrador cuenta la daga.
 */
export function physicalAction(text: string): boolean {
  return PHYSICAL.test(norm(unquoted(text)));
}

/** Tools que son algo más que hablar: el turno pasa a `full`. */
const FULL_TOOLS = new Set([
  'move_to', 'attack', 'apply_damage', 'heal', 'stabilize', 'add_condition', 'remove_condition', 'use_item', 'spawn_item', 'cast_spell',
  'discover_spot', 'harvest', 'update_spot_state', 'update_location_state', 'take_rest', 'report_incident', 'restrain_npc', 'request_reaction',
]);
/** Tools de algo pequeño que cambia en la charla: el turno pasa a `beat` (si no era `full`). */
const BEAT_TOOLS = new Set([
  'npc_trust', 'transfer_item', 'give_coins', 'buy_item', 'sell_item', 'pawn_item', 'set_debt', 'settle_debt',
  'story_quest', 'give_quest', 'finish_quest', 'complete_job', 'set_npc_order',
]);

const RANK: Record<NarratorMode, number> = { silent: 0, beat: 1, full: 2 };
const louder = (a: NarratorPlan, b: NarratorPlan): NarratorPlan => (RANK[b.mode] > RANK[a.mode] ? b : a);

/** Lo que pasa en el turno y no sale del plan de charla: lo que el motor ya sabe antes de llamar al máster. */
export interface TurnSignals {
  /** Desenlace de una tirada, apertura, llegada, gancho, ventana decisiva caducada. */
  scene?: string | null;
  /** Gancho, imprevisto, viaje o recado, descanso cortado: algo ocurre además de la charla. */
  happening?: string | null;
}

/**
 * El modo del narrador antes de llamar al máster. Sin plan de charla, `full` (no es una charla). Con plan: las
 * señales de estado (combate, alto, incidente, sitio) y de texto (acción física, entregar, comprar, despedirse).
 */
export function narratorMode(world: World, pc: Character, text: string, plan: TalkPlan | null, nowG: number, sig: TurnSignals = {}): NarratorPlan {
  if (sig.scene) return { mode: 'full', why: sig.scene };
  if (!plan) return { mode: 'full', why: 'no es una charla' };
  if (sig.happening) return { mode: 'full', why: sig.happening };
  if (physicalAction(text)) return { mode: 'full', why: 'el jugador hace algo más que hablar' };
  // Capa 1 del flujo de charla (talk.ts): una alarma en el sitio o un ataque son algo más que hablar; saber de un crimen
  // o echar algo en falta, no (bajo un alto sin resistencia, si solo hablan, se ven las conversaciones).
  const flag = (plan.state.flags ?? []).find((f) => f.kind === 'alarm' || f.kind === 'attack');
  if (flag) return { mode: 'full', why: flag.kind === 'alarm' ? 'hay una alarma en el sitio' : 'le acaba de atacar' };
  if (dueNpcTurns(world, [pc.id], new Set()).length) return { mode: 'full', why: 'combate: un NPC hostil actúa' };
  if (pc.decisive) return { mode: 'full', why: 'ventana decisiva abierta' };
  const arrest = pc.wanted?.arrest;
  if (arrest && !arrest.announced) return { mode: 'full', why: 'la autoridad da el alto' };
  if (arrest?.resisted) return { mode: 'full', why: 'se ha resistido al alto' };
  if (pendingIncidents(world, pc, nowG).length) return { mode: 'full', why: 'incidente pendiente de contar' };
  const npc = world.npcs.get(plan.npc_id);
  const here = world.characterSpot(pc)?.id;
  if (npc && here && npc.location.id !== here) return { mode: 'full', why: 'se acerca a quien habla (cambio de punto)' };
  if (plan.state.new_talk) return { mode: 'full', why: 'la charla empieza (presentación)' };
  const st = plan.state;
  const tx = plan.text;
  if (st.recent === 'gift') return { mode: 'beat', why: 'reacciona a lo que le ha dado' };
  if ((st.flags ?? []).some((f) => f.kind === 'caught')) return { mode: 'beat', why: 've encima lo que le robaron' };
  if (plan.cut) return { mode: 'beat', why: 'corta la charla' };
  if (tx.hostile) return { mode: 'beat', why: 'insulto o amenaza: cambia la actitud' };
  if (tx.delivery && st.pending.length) return { mode: 'beat', why: 'entrega de un encargo' };
  if (tx.trade && st.trades) return { mode: 'beat', why: 'compra o venta' };
  // Si la saca él solo (la charla «madura», talk.ts), aún no se sabe si la da: lo dice el cierre (story_quest, give_quest).
  if ((plan.situation === 'offer' || plan.second === 'offer') && tx.asks_work) return { mode: 'beat', why: 'le da una misión' };
  if (plan.situation === 'farewell') return { mode: 'beat', why: 'se despide' };
  return { mode: 'silent', why: 'charla sin más' };
}

/**
 * El modo al cierre: el de antes, subido por lo que ha pasado en el turno (nunca bajado). Un ataque, un
 * desplazamiento, un acercamiento o un turno forzado de un NPC lo pasan a `full`; un cambio de confianza, de manos
 * o de misión, a `beat`. Una tirada pedida: ataque, `full`; otra, `beat` (el momento previo).
 */
export function closingMode(before: NarratorPlan, turn: { okTools: readonly string[]; roll?: { kind: string } | null; approached?: boolean; forcedTurns?: number; decisive?: boolean; incident?: boolean }): NarratorPlan {
  let out = before;
  const full = turn.okTools.find((t) => FULL_TOOLS.has(t));
  if (full) out = louder(out, { mode: 'full', why: `tool ${full}` });
  if (turn.approached) out = louder(out, { mode: 'full', why: 'se acerca a quien habla' });
  if (turn.forcedTurns) out = louder(out, { mode: 'full', why: 'turno de un NPC en combate' });
  if (turn.decisive) out = louder(out, { mode: 'full', why: 'ventana decisiva' });
  if (turn.incident) out = louder(out, { mode: 'full', why: 'incidente pendiente' });
  if (turn.roll) out = louder(out, turn.roll.kind === 'attack' ? { mode: 'full', why: 'tirada de ataque' } : { mode: 'beat', why: 'tirada pendiente' });
  const beat = turn.okTools.find((t) => BEAT_TOOLS.has(t));
  if (beat) out = louder(out, { mode: 'beat', why: `tool ${beat}` });
  return out;
}

/** La línea del contexto del máster, dentro del bloque de la charla (prompt.ts). */
export function narratorLine(p: NarratorPlan): string {
  if (p.mode === 'silent') return 'Narrador en este turno: en silencio, solo lines (narration_private ""). El gesto de quien habla, si hace falta, en el beat de su línea (12 palabras como mucho).';
  if (p.mode === 'beat') return `Narrador en este turno: una acotación de ${BEAT_WORDS} palabras como mucho (${p.why}); lo dicho, en lines. El gesto de quien habla, en el beat de su línea.`;
  return `Narrador en este turno: narración normal (${p.why}).`;
}

// ---------------------------------------------------------------------------
// Al cierre: la narración según el modo
// ---------------------------------------------------------------------------

/** Frases que el narrador no dice en una charla: lo que alguien no dice, o que todo sigue igual. */
const NARRATOR_FILLER = /\b(sigue|continua|permanece) (sin (decir|hablar|abrir la boca|moverse)|callad[oa]s?|en silencio)|no dice (nada|ni una palabra)|guarda silencio|(la|el) (plaza|sala|taberna|calle|gente|pueblo) (espera|aguarda|contiene el aliento)\b/;

/** Frases de un texto, con su puntuación. */
export function sentencesOf(text: string): string[] {
  return (text.replace(/\s+/g, ' ').trim().match(/[^.!?…:]+(?:[.!?…:]+|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Cómo se reconoce en la narración a quien habla: su nombre, su nombre de pila y lo que se ve de él. */
export function speakerRefs(world: World, npc: Npc): string[] {
  return [npc.name, npc.name.split(/\s+/)[0]!, descriptorOf(world, npc.id)].map(norm).map((r) => r.replace(/^(el|la|los|las|un|una)\s+/, '').trim()).filter((r) => r.length >= 3);
}

const mentions = (text: string, refs: readonly string[]) => { const t = norm(text); return refs.some((r) => t.includes(r)); };

/** Una acotación lista para la burbuja: sin comillas ni espacios de más, en una frase. */
function asBeat(text: string): string {
  return text.replace(/[«»“”"]/g, '').replace(/\s+/g, ' ').trim();
}

/** El `beat` que escribe el máster en una línea: sin comillas, y si pasa de LINE_BEAT_WORDS, hasta la primera pausa que quepa o nada. */
export function clipLineBeat(raw: string): string {
  const t = asBeat(raw).replace(/^[(\[—-]\s*|\s*[)\]—-]$/g, '').trim();
  if (!t) return '';
  if (wordCount(t) <= LINE_BEAT_WORDS) return t;
  const cut = t.split(/(?<=[,;:.])\s+/);
  let out = '';
  for (const part of cut) {
    const next = out ? `${out} ${part}` : part;
    if (wordCount(next) > LINE_BEAT_WORDS) break;
    out = next;
  }
  return out.replace(/[,;]$/, '').trim();
}

/** Lo que queda de la narración en el cierre según el modo, y lo que se ha quitado (para `payload.master.narrator`). */
export interface NarratorCut {
  narration: string;
  /** La frase que pasa a acotación de la primera línea de ese NPC (silent). */
  beat?: { npc_id: Id; text: string };
  dropped: string;
}

/**
 * Aplica el modo a la narración ya sin frases repetidas. `full`: igual. `beat`: la primera frase que no sea
 * relleno, de BEAT_WORDS palabras como mucho (si es más larga, hasta la última pausa que quepa). `silent`: vacía;
 * si es una frase corta que nombra o presenta a quien habla (primera línea de NPC), pasa a su acotación.
 * Sin líneas de NPC no se toca: la narración es lo único que hay (el control de «no contesta» es otro).
 */
export function applyNarratorMode(mode: NarratorMode, narration: string, lines: readonly DialogueLine[], refsOf: (npcId: Id) => string[]): NarratorCut {
  const text = narration.replace(/\s+/g, ' ').trim();
  const first = lines.find((l) => l.speaker === 'npc' && l.npc_id);
  if (mode === 'full' || !text || !first) return { narration: narration.trim(), dropped: '' };
  const kept = sentencesOf(text).filter((s) => !NARRATOR_FILLER.test(norm(s)) && !/[«“"]/.test(s));
  if (mode === 'silent') {
    const one = kept.join(' ');
    const presents = kept.length === 1 && wordCount(one) <= BEAT_WORDS && (/:$/.test(one) || mentions(one, refsOf(first.npc_id!)));
    if (presents && !first.beat) return { narration: '', beat: { npc_id: first.npc_id!, text: asBeat(one) }, dropped: '' };
    return { narration: '', dropped: text };
  }
  const pick = kept[0] ?? '';
  let out = pick;
  if (wordCount(pick) > BEAT_WORDS) {
    out = '';
    for (const part of pick.split(/(?<=[,;:])\s+/)) {
      const next = out ? `${out} ${part}` : part;
      if (wordCount(next) > BEAT_WORDS) break;
      out = next;
    }
    out = out.replace(/[,;]$/, '').trim();
    if (out && !/[.!?…:]$/.test(out)) out = `${out}.`;
  }
  return { narration: out, dropped: text === out ? '' : text };
}
