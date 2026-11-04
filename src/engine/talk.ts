/**
 * Cómo responde un NPC en un turno de charla (docs/CONVERSACION-REGLAS.md).
 * Antes de llamar a la IA, el motor decide en qué situación está la charla y
 * qué tiene que hacer el NPC, con reglas fijas:
 *
 *   1. señales: del estado (primer encuentro, trato, reputación, crimen, lo que
 *      acaba de hacer el PJ, misiones que puede dar o tiene en curso, las veces
 *      que ya se ha negado) y del texto del jugador (saludo, pregunta, lore,
 *      comercio, argumentar…), heurísticas;
 *   2. situación: la primera que se cumple por prioridad, y una secundaria;
 *   3. guion: pasos en orden, lo prohibido y la longitud, según el trato. Negarse
 *      deja siempre una salida (`wayOut`), y argumentar puede pedir tirada.
 *
 * El máster (prompt.ts) recibe el guion; el cierre (tools.ts, `talkProblems`)
 * comprueba lo comprobable. Si el texto no da señales, el máster puede
 * declarar otra situación (`talk_situation`) y el motor la valida contra el
 * estado. Todo sale del estado y de los datos: ninguna campaña aquí.
 */

import type { Character, GameEvent, Id, Npc } from './model.js';
import type { World } from './world.js';
import type { DialogueLine } from './moments.js';
import { talkTier, TALK_TIER_LABEL, type TalkTier } from './concerns.js';
import { knownBy, npcCrimeLine } from './crime.js';
import { alarmAt, ALARM_ES } from './alarm.js';
import { theftWith } from './stolen.js';
import { opinionOf } from './standing.js';
import { debtLine, openDebts } from './debts.js';
import { descriptorOf } from './narrate.js';
import { transcriptOf } from './conversation.js';
import { rumorsIn } from './rumors.js';
import { activeJobs } from './progress.js';
import { givenQuests, droppedAt } from './quests.js';
import { askedSince, holds, questStatus, storyOf, type StoryCondition } from './story.js';
import { npcTarget } from './scene.js';
import { talkPartner, TALK_GAP_S } from './trust.js';
import { narratorLine, type NarratorPlan } from './narrator.js';

export const TALK_SITUATIONS = ['danger', 'reaction', 'cold', 'errand', 'trade', 'offer', 'lore', 'question', 'greeting', 'farewell', 'chat'] as const;
export type TalkSituation = typeof TALK_SITUATIONS[number];

export const SITUATION_ES: Record<TalkSituation, string> = {
  danger: 'peligro o crimen', reaction: 'reacción a lo que acaba de hacer o decir', cold: 'trato hostil o receloso',
  errand: 'misión en curso o entrega', trade: 'comercio', offer: 'misión que puede dar', lore: 'pregunta de historia, lugares o gente',
  question: 'pregunta o petición', greeting: 'saludo', farewell: 'despedida', chat: 'charla sin más',
};

/** Palabras de lo que dice el NPC como mucho, por situación (la secundaria suma SECOND_WORDS). */
export const SITUATION_WORDS: Record<TalkSituation, number> = {
  danger: 40, reaction: 40, cold: 25, errand: 45, trade: 40, offer: 60, lore: 60, question: 45, greeting: 30, farewell: 20, chat: 40,
};
const SECOND_WORDS = 15;
/** Margen antes de pedir que lo recorte: el exceso típico en las partidas era de 18 palabras, no de un discurso. */
const WORDS_MARGIN = 25;

/** Una charla de antes es «de hace tiempo» pasadas 12 h de juego. */
const RETURNING_S = 12 * 3600;
/** Lo que el NPC acaba de ver hacer al PJ cuenta durante 15 min de juego. */
const RECENT_S = 15 * 60;
/** Quien da misiones la saca él solo a partir de que le haya contestado estas veces (antes, solo si se lo preguntan). */
const RIPE_TURNS = 2;
/** Líneas de la transcripción que se miran para contar esos turnos. */
const TALK_MEMORY_LINES = 24;
/** A partir de estas negativas seguidas, la siguiente corta la charla. */
const CUT_AFTER_REFUSALS = 2;
/** Salidas que se le dan como mucho al máster. */
const WAY_OUT_MAX = 3;
/** CD de una tirada social por lo delicado, según el trato. */
const SOCIAL_DC: Record<TalkTier, number> = { hostile: 20, wary: 17, stranger: 15, acquaintance: 12, friend: 10, ally: 10 };
const SOCIAL_SKILLS = new Set(['persuasion', 'deception', 'intimidation']);
/**
 * Escenas que cuenta el máster sin que el jugador haya dicho nada (apertura, llegada, gancho): lo que dice en ellas
 * un NPC no es una charla con el PJ, y no cuenta para que «lleven un rato hablando».
 */
const SCENE_TYPES = new Set(['prologue', 'master_intro', 'master_arrival', 'master_hook']);

// ---------------------------------------------------------------------------
// 1. Señales
// ---------------------------------------------------------------------------

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Lo que dice el texto del jugador. Heurísticas: valen como pista. */
export interface TextSignals {
  greeting: boolean; farewell: boolean; question: boolean; request: boolean; trade: boolean;
  asks_work: boolean; delivery: boolean; hostile: boolean; lore_word: boolean;
  /** Da razones, promete o se hace pasar por alguien: intenta convencerle. */
  argues: boolean;
  /** Le aprieta con lo que puede pasarle si no habla. */
  presses: boolean;
  /** Pregunta si le conoce o le pregunta quién es: «¿no sabes quién soy?», «¿quién eres?» (capa 2). */
  identity: boolean;
  /** Se presenta: «me llamo…», «mi nombre es…» («soy X» con su nombre lo mira `introduces`). */
  introduces: boolean;
  /** Le pregunta a él quién es o cómo se llama. */
  asks_who: boolean;
  /** Se disculpa o le calma: «vale, vale», «perdona», «no te enfades». */
  calm: boolean;
  /** Le adula. */
  flattery: boolean;
  /** Dice que sí o muestra interés: «sí», «vale», «cuéntame», «me interesa». */
  affirmative: boolean;
  /** Solo abre la charla: «hablar con Brenna», «voy a hablar con Garrán», sin decirle nada más. */
  opens: boolean;
}

const RE = {
  greeting: /\b(hola|buenas|buenos dias|saludos|que tal|ey|saludo|saludar|saludarle|saludarla)\b/,
  farewell: /\b(adios|hasta luego|hasta manana|hasta otra|hasta pronto|nos vemos|me voy|me marcho|cuidate|me despido|despedirme)\b/,
  question: /\b(pregunto|preguntar|preguntarle|le pregunto|sabes|sabe usted|conoces|has visto|has oido)\b/,
  request: /\b(necesito|me das|me dejas|me prestas|ayudame|puedes|podrias|quiero)\b/,
  trade: /\b(compr\w*|vend\w*|precio|cuanto (cuesta|vale|cobras|pides|es)|cuesta|me pones|ponme|sirveme|me sirves|pagar|(?:pido|pedir|pide|pedimos|ponnos) (?:una|un|dos|tres|otra|otro|algo de))\b/,
  asks_work: /\b(trabajo|encargo|recado|faena|tarea|necesitas (algo|ayuda)|en que (puedo|te puedo) ayudar|puedo ayudar|te ayudo|ayudarte|ayudarle|algo que hacer|que te (pasa|preocupa|ocurre)|que le (pasa|preocupa|ocurre)|algun problema)\b/,
  delivery: /\b(traigo|aqui tienes|aqui esta|toma|ya esta hecho|lo tengo|la tengo|he encontrado|lo he hecho|cumplido|entrego|vengo a cobrar)\b/,
  hostile: /\b(amenaz\w*|te mato|te voy a matar|cabron\w*|imbecil|idiota|estupid\w*|callate|maldit\w*|escoria|basura|inutil)\b/,
  lore_word: /\b(historia|leyenda|que se cuenta|que se dice|que paso|antiguamente|origen|cuentame|cuentanos)\b/,
  argues: /\b(te (juro|prometo|aseguro|interesa)|le (juro|prometo|aseguro)|mi palabra|confia en mi|fiate de mi|convenc\w*|persuad\w*|escuchame|piensalo|por tu bien|vengo de parte|me envia|me manda|entiende que|si me (cuentas|dices|ayudas)|a cambio)\b/,
  presses: /\b(si no me (dices|cuentas)|mas te vale|te aviso|te advierto|te arrepentiras|lo lamentaras|o te (cuento|mato|parto|rompo|arranco|corto|cuelgo)|o le cuento|le cuento a|o lo cuento)\b/,
  identity: /\b(sabes quien soy|sabe quien soy|sabeis quien soy|me conoces|me conoce|me recuerdas|me recuerda|te acuerdas de mi|se acuerda de mi|sabes como me llamo|sabe como me llamo)\b/,
  introduces: /\b(me llamo|mi nombre es|me llaman|puedes llamarme|llamame)\b/,
  asks_who: /\b(quien eres|quien es usted|como te llamas|como se llama usted|cual es tu nombre|tu nombre)\b/,
  calm: /\b(vale,? vale|tranquil[oa]|calma|calmate|perdon|perdona|perdone|disculpa|disculpe|lo siento|no te enfades|no se enfade|sin ofender|no queria (ofender|molestar)|no era mi intencion|tienes razon|tiene razon)\b/,
  flattery: /\b(eres (muy|la mejor|el mejor|un genio)|que (bien|bonit\w*|guap\w*) (te|le|lo|la)|admiro|me encanta (tu|su)|la mejor (cerveza|tabernera|del)|el mejor (herrero|de))\b/,
  affirmative: /^\s*(si|claro|vale|de acuerdo|por supuesto|cuentame|cuenteme|dime|digame|me interesa|adelante|venga|acepto|hecho|que necesitas|que necesita|en que consiste|de que se trata)\b/,
  opens: /^(?:(?:ir|voy|vamos|me acerco|acercarse|acercarme|acerco)\s+(?:a\s+)?)?(?:a\s+)?(?:hablar|charlar|saludar)(?:le|la)?(?:\s+(?:un rato\s+)?(?:con|a)\s+\p{L}+(?:\s+\p{L}+)?)?\s*[.!]?\s*$/u,
};

export function textSignals(text: string): TextSignals {
  const t = norm(text);
  return {
    greeting: RE.greeting.test(t), farewell: RE.farewell.test(t),
    question: /[?¿]/.test(text) || RE.question.test(t), request: RE.request.test(t), trade: RE.trade.test(t),
    asks_work: RE.asks_work.test(t), delivery: RE.delivery.test(t), hostile: RE.hostile.test(t), lore_word: RE.lore_word.test(t),
    argues: RE.argues.test(t), presses: RE.presses.test(t),
    identity: RE.identity.test(t), introduces: RE.introduces.test(t), asks_who: RE.asks_who.test(t),
    calm: RE.calm.test(t), flattery: RE.flattery.test(t), affirmative: RE.affirmative.test(t), opens: RE.opens.test(t.trim()),
  };
}

/** ¿Se presenta con su nombre? «Me llamo Pillin», «soy Pillin», «mi nombre es Pillin». */
export function introducesAs(text: string, pcName: string): boolean {
  const t = norm(text);
  const first = norm(pcName.split(/\s+/)[0] ?? '');
  if (first.length < 2) return false;
  return new RegExp(`\\b(me llamo|mi nombre es|me llaman|soy|llamame|puedes llamarme)\\s+${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t);
}

/** Un tema de lore que nombra el jugador, con lo que sabe de él todo el mundo. */
export interface TalkTopic { kind: 'place' | 'person' | 'rumor' | 'faction'; name: string; known: string }

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, '')}…`);
const bare = (name: string) => norm(name).replace(/^(el|la|los|las|un|una)\s+/, '').trim();
function names(t: string, name: string): boolean {
  const n = bare(name);
  return n.length >= 4 && new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(t);
}

/** Dónde se le encuentra a alguien (dónde vive y por dónde anda ahora): lo sabe todo el mundo en su pueblo. */
function whereFound(world: World, n: Npc): string {
  const at = (id: Id | undefined) => {
    const spot = id ? world.spots.get(id) : undefined;
    const loc = spot ? world.locations.get(spot.location_id) : undefined;
    return spot && loc ? (spot.name === loc.name ? loc.name : `${spot.name}, en ${loc.name}`) : '';
  };
  // Su casa, por la localización (la casona, no la alcoba de arriba).
  const homeSpot = n.home_spot_id ? world.spots.get(n.home_spot_id) : undefined;
  const home = homeSpot ? world.locations.get(homeSpot.location_id)?.name ?? '' : '';
  const now = at(n.location.id);
  const parts = [home ? `vive en ${home}` : '', now && now !== home ? `ahora anda por ${now}` : ''].filter(Boolean);
  return parts.length ? `; ${parts.join(', ')} (eso es público)` : '';
}

/**
 * Lugares, gente, rumores y facciones de los datos que nombra el texto (sin contar al NPC con quien habla). A la
 * gente se la reconoce por su nombre o por su oficio («el regidor»), con dónde se le encuentra.
 */
export function loreTopics(world: World, npc: Npc, text: string, nowG: number): TalkTopic[] {
  const t = norm(text);
  const out: TalkTopic[] = [];
  for (const l of world.locations.values()) if (names(t, l.name)) out.push({ kind: 'place', name: l.name, known: clip(l.description_base, 160) });
  for (const n of world.npcs.values()) {
    if (n.id === npc.id || n.mute) continue;
    const first = n.name.split(/\s+/)[0]!;
    const byRole = names(t, descriptorOf(world, n.id));
    if (names(t, n.name) || names(t, first) || byRole) {
      out.push({ kind: 'person', name: n.name, known: `${n.role}${n.status === 'dead' ? '; ha muerto' : whereFound(world, n)}` });
    }
  }
  const loc = world.spots.get(npc.location.id)?.location_id;
  if (loc) for (const r of rumorsIn(world, loc, nowG)) if (names(t, r.name)) out.push({ kind: 'rumor', name: r.name, known: `${r.hint} (habladuría, no hecho)` });
  for (const f of world.campaign.factions) if (names(t, f.name)) out.push({ kind: 'faction', name: f.name, known: clip(f.description, 160) });
  return out.slice(0, 3);
}

/** Una salida que deja una negativa: lo que se le dice al máster y los nombres por los que se reconoce al cierre. */
export interface WayOut { text: string; names: string[] }

/** Lo que el estado dice de este NPC con este PJ. */
export interface TalkState {
  first_meeting: boolean;
  /** Ya hablaron, pero hace más de 12 h de juego. */
  returning: boolean;
  knows_name: boolean;
  tier: TalkTier;
  opinion: number;
  /** Sabe de un crimen del PJ (crime.ts). */
  crime: boolean;
  /** Lo que le acaba de ver hacer: darle algo o atacarle (a él o a los suyos). */
  recent: 'gift' | 'attack' | null;
  busy: boolean;
  /** Títulos de lo que puede darle: misiones de la historia disponibles y encargos suyos del tablón. */
  can_offer: string[];
  /** Llevan un rato hablando: le ha contestado al menos RIPE_TURNS veces en turnos del jugador (la apertura no cuenta), o hablaron otro día. */
  talked: boolean;
  /** Tiene algo que darle y la charla ya da para sacarlo él solo: se han dicho algo más que un saludo y no acaba de pedirle otra. */
  ripe: boolean;
  /** Títulos de lo que el PJ tiene en curso de él o de los suyos. */
  pending: string[];
  /** Títulos de misiones de la historia que el PJ aún no puede coger: no se nombran. */
  locked: string[];
  debt: boolean;
  trades: boolean;
  /**
   * Lo suyo con el PJ, que el PJ ya sabe: la amenaza de su situación si es su antagonista, y la deuda que cobra o
   * que tiene. Es público entre los dos: si se lo pregunta, lo dice claro. null si no hay nada.
   */
  terms: string | null;
  /** La charla empieza ahora: no han hablado en los últimos 15 min de juego. */
  new_talk: boolean;
  /** Veces seguidas que se ha negado en esta charla. */
  refusals: number;
  /** Lo que le pedía cuando se negó, para no ofrecerlo otra vez en los botones. */
  refused_asks: string[];
  /** Por dónde puede seguir el PJ si se niega. Nunca el secreto. */
  way_out: WayOut[];
  /** Cómo se niega según los datos de la pista, si la hay: un gesto suyo en vez de una frase hecha. */
  refusal_note: string | null;
  /** Ya ha intentado una tirada social con él en esta charla. */
  social_tried: boolean;
  // --- docs/CONVERSACION-FLUJO.md ---
  /** Capa 2: qué sabe del PJ. */
  knows: TalkKnows;
  /** Sabe el nombre del PJ: por su situación (recíproca) o porque se le presentó (`npc.knows_name_of`). */
  knows_pc_name: boolean;
  /** Lo que sabe de él sin haberle hablado (su situación, la deuda, un crimen), o null. */
  heard_of: string | null;
  /** Capa 1: lo urgente, de lo más a lo menos. */
  flags: TalkFlag[];
  /** Capa 3: la escalada en esta charla (insultos y negativas, menos lo que la ha calmado). */
  escalation: Escalation;
  /** Lo último que dijo él en esta charla era una pregunta: lo que diga el PJ puede ser la respuesta. */
  npc_asked: boolean;
  /** Lo último que dijo él en esta charla dejaba caer un encargo: un «sí» del PJ es interés. */
  hinted: boolean;
  /** Le ha contestado ya en esta charla (turnos del jugador). */
  answers_now: number;
}

/** Capa 2: qué sabe el NPC del PJ (de más cerca a nada). */
export type TalkKnows = 'talking' | 'returning' | 'known' | 'heard' | 'none';
export const KNOWS_ES: Record<TalkKnows, string> = {
  talking: 'charla en curso', returning: 'ya se conocen, pero hace tiempo que no hablan', known: 'ya se conocen', heard: 'sabe de él sin haberle hablado', none: 'no le conoce de nada',
};

/** Capa 1: algo urgente para el NPC. `block`: no está para charlas, el turno es solo su reacción. */
export interface TalkFlag {
  kind: 'alarm' | 'attack' | 'crime' | 'caught' | 'stolen' | 'gift' | 'overdue' | 'busy';
  block: boolean;
  text: string;
}

/** Capa 3: la escalada (se mantiene la de la v1; una disculpa, un regalo o una salida creativa la bajan un escalón). */
export type Escalation = 'calm' | 'annoyed' | 'fed_up';
export const ESCALATION_ES: Record<Escalation, string> = { calm: 'tranquilo', annoyed: 'molesto', fed_up: 'harto' };

interface Call { name: string; input?: Record<string, unknown>; result?: unknown }
function callsOf(e: GameEvent): Call[] {
  const m = e.payload['master'] as { calls?: Call[] } | null | undefined;
  return Array.isArray(m?.calls) ? m.calls : [];
}
const failed = (c: Call) => String(c.result ?? '').startsWith('{"error"');

/** Lo que el PJ acaba de hacerle al NPC (o a los suyos), mirando sus eventos de los últimos minutos. */
function recentDeed(events: readonly GameEvent[], pc: Character, npc: Npc, nowG: number): TalkState['recent'] {
  const close = new Set([npc.id, ...(npc.bonds ?? []).filter((b) => b.kind !== 'rival').map((b) => b.npc_id)]);
  let deed: TalkState['recent'] = null;
  for (const e of events) {
    if (e.actor_id !== pc.id || nowG - e.timestamp_game_s > RECENT_S) continue;
    for (const c of callsOf(e)) {
      if (failed(c)) continue;
      if (c.name === 'attack' && close.has(String(c.input?.['target_id'] ?? '')) && (c.input?.['attacker_id'] ?? pc.id) === pc.id) return 'attack';
      if (c.name === 'transfer_item' && c.input?.['to_type'] === 'npc' && c.input?.['to_id'] === npc.id) deed = 'gift';
    }
  }
  return deed;
}

/** Lo suyo con el PJ (TalkState.terms): de su situación inicial y de sus deudas. */
function termsWith(world: World, pc: Character, npc: Npc, nowG: number): string | null {
  const s = pc.situation;
  const out: string[] = [];
  if (s && (s.antagonist_npc_id === npc.id || s.debt?.npc_id === npc.id || s.debt?.on_behalf_of === npc.id)) {
    out.push(`${s.threat.trim().replace(/[.]?$/, '.')} Si se cumple el plazo: ${s.clock_runs_out.trim()}`);
  }
  for (const d of openDebts(pc)) {
    if (d.npc_id === npc.id || d.on_behalf_of === npc.id) out.push(`${debtLine(world, d, nowG, (n) => n.name)}.`);
  }
  return out.length ? out.join(' ') : null;
}

type RawLine = { speaker?: string; npc_id?: Id; text?: string };

/** Lo que dijo este NPC en un evento. */
function saidBy(e: GameEvent, npcId: Id): string {
  const lines = (e.payload['lines'] as RawLine[] | undefined) ?? [];
  return lines.filter((l) => l.speaker === 'npc' && (l.npc_id === npcId || (!l.npc_id && e.payload['npc_id'] === npcId))).map((l) => l.text ?? '').join(' ');
}

/** Las negativas seguidas de este NPC en esta charla, de la última hacia atrás. Una respuesta de verdad las pone a cero. */
function refusalStreak(events: readonly GameEvent[], pc: Character, npc: Npc, nowG: number): string[] {
  const asks: string[] = [];
  let last = nowG;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.actor_id !== pc.id) continue;
    if (last - e.timestamp_game_s > TALK_GAP_S) break;
    const said = saidBy(e, npc.id);
    if (!said) continue;
    const t = norm(said);
    if (!REFUSES.test(t) && !ALREADY_SAID.test(t)) break;
    asks.push(e.input_text ?? '');
    last = e.timestamp_game_s;
  }
  return asks;
}

/** Lo que le ha bajado la tensión en un turno: una disculpa, un regalo o una salida que el máster declaró (talk_deescalate). */
function deescalated(e: GameEvent, npc: Npc): boolean {
  if (textSignals(e.input_text ?? '').calm) return true;
  return callsOf(e).some((c) => !failed(c) && (
    (c.name === 'transfer_item' && c.input?.['to_type'] === 'npc' && c.input?.['to_id'] === npc.id)
    || (c.name === 'log_event' && typeof c.input?.['talk_deescalate'] === 'string' && String(c.input['talk_deescalate']).trim() !== '')
  ));
}

/**
 * Capa 3: la escalada en esta charla (una hora de juego, como las negativas). Cada insulto o amenaza sube un escalón;
 * cada disculpa, regalo o salida creativa lo baja (decisión de Miguel, 06-11); las negativas seguidas suman encima.
 */
function escalationIn(events: readonly GameEvent[], pc: Character, npc: Npc, nowG: number, refusals: number): Escalation {
  const mine: GameEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.actor_id !== pc.id) continue;
    if (nowG - e.timestamp_game_s > TALK_GAP_S) break;
    if (e.payload['npc_id'] === npc.id || saidBy(e, npc.id)) mine.unshift(e);
  }
  let score = 0;
  for (const e of mine) {
    const tx = textSignals(e.input_text ?? '');
    if (deescalated(e, npc)) score = Math.max(0, score - 1);
    else if (tx.hostile || tx.presses) score += 1;
  }
  const total = score + Math.min(refusals, 2);
  return total >= 2 ? 'fed_up' : total === 1 ? 'annoyed' : 'calm';
}

/** Capa 2: qué sabe el NPC del PJ, si sabe su nombre y qué sabe de él sin haberle hablado. */
function knowsOf(pc: Character, npc: Npc, o: { spoke: boolean; talking: boolean; returning: boolean; terms: string | null; crime: string | null }): { knows: TalkKnows; name: boolean; heard: string | null } {
  const s = pc.situation;
  // Recíproco (decisión de Miguel, 06-11): si su situación dice que el PJ le conoce, él conoce al PJ y sabe su nombre.
  const bySituation = Boolean(s?.knows?.includes(npc.id));
  // La apertura los puso juntos: ya se han visto.
  const opened = Boolean(s?.with_npc_ids?.includes(npc.id));
  const name = bySituation || Boolean(npc.knows_name_of?.includes(pc.id));
  const heard = o.terms ? clip(o.terms, 220) : o.crime ? 'sabe lo que hizo (ver «LO PRIMERO» en su línea)' : null;
  const knows: TalkKnows = o.talking ? 'talking'
    : o.returning ? 'returning'
      : o.spoke || bySituation || opened ? 'known'
        : heard ? 'heard' : 'none';
  return { knows, name, heard };
}

/** Capa 1: lo urgente para el NPC, de lo más a lo menos. */
function flagsFor(world: World, pc: Character, npc: Npc, nowG: number, recent: TalkState['recent'], busy: boolean): TalkFlag[] {
  const out: TalkFlag[] = [];
  const loc = world.spots.get(npc.location.id)?.location_id;
  const alarm = alarmAt(world, loc, nowG);
  if (alarm) out.push({ kind: 'alarm', block: true, text: `${ALARM_ES[alarm.kind]}: ${alarm.text}. Solo reacciona a eso (huye, grita, ayuda, saca a la gente); si le preguntan por ello, contesta en una frase` });
  if (recent === 'attack') out.push({ kind: 'attack', block: true, text: 'le acaba de atacar a él o a los suyos: se defiende, huye o pide ayuda, según quién es' });
  const crime = knownBy(world, npc.id, pc.id);
  if (crime) {
    const grave = ['murder', 'armed_assault', 'assault'].includes(crime.incident.kind);
    out.push({ kind: 'crime', block: grave, text: grave ? 'sabe que ha matado o herido a alguien (ver «LO PRIMERO» en su línea): miedo o rabia, no le atiende como a un cliente; puede llamar a alguien' : 'sabe lo que ha hecho (ver «LO PRIMERO» en su línea): se lo echa en cara o se pone en guardia' });
  }
  const theft = theftWith(world, npc, pc);
  if (theft?.kind === 'caught') out.push({ kind: 'caught', block: false, text: `ve encima del actor ${theft.item}, que le robaron: se lo reclama ya (cómo, según vuestra relación y su carácter)` });
  else if (theft?.kind === 'suspects') out.push({ kind: 'stolen', block: false, text: `echa en falta ${theft.item} y sospecha del actor, que estaba cerca: se lo pregunta o se lo exige` });
  else if (theft) out.push({ kind: 'stolen', block: false, text: `echa en falta ${theft.item} y lo anda buscando: está alterado y pregunta si lo ha visto` });
  if (recent === 'gift') out.push({ kind: 'gift', block: false, text: 'le acaba de dar algo: lo agradece, se extraña o lo rechaza, según su carácter' });
  const overdue = openDebts(pc).find((d) => (d.npc_id === npc.id || d.on_behalf_of === npc.id) && d.due_game_s !== null && d.due_game_s <= nowG);
  if (overdue) out.push({ kind: 'overdue', block: false, text: `la deuda del actor ha vencido (${debtLine(world, overdue, nowG, (n) => n.name)}): lo primero, eso` });
  if (busy) out.push({ kind: 'busy', block: false, text: 'está hablando con otro: le pide que espere o le atiende a medias' });
  return out;
}

/** ¿Ha intentado ya convencerle con una tirada en esta charla? */
function triedSocial(events: readonly GameEvent[], pc: Character, npc: Npc, nowG: number): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.actor_id !== pc.id) continue;
    if (nowG - e.timestamp_game_s > TALK_GAP_S) return false;
    const roll = e.payload['requires_roll'] as { key?: string } | undefined;
    if (roll?.key && SOCIAL_SKILLS.has(roll.key) && e.payload['npc_id'] === npc.id) return true;
  }
  return false;
}

/** Las misiones que pide un requisito, ya al alcance del PJ. */
function questsAsked(world: World, pc: Character, cond: StoryCondition): string[] {
  if (cond.kind === 'any' || cond.kind === 'all') return cond.of.flatMap((x) => questsAsked(world, pc, x));
  if (cond.kind !== 'quest') return [];
  const q = storyOf(world)?.quests.find((x) => x.id === cond.quest_id);
  if (!q) return [];
  const s = questStatus(world, pc, q);
  return s === 'available' || s === 'active' || s === 'ready' ? [q.title] : [];
}

/**
 * Por dónde puede seguir el PJ cuando este NPC se niega, de lo más a mano a lo menos: lo que tiene a medias, un
 * encargo que puede darle, lo que abriría sus pistas, otra persona que sabe algo de ellas y lo que él quiere. Son
 * títulos y nombres, nunca lo que dice la pista. Con trato hostil no hay salida: se cierra en banda.
 */
export function wayOut(world: World, pc: Character, npc: Npc, st: Pick<TalkState, 'tier' | 'pending' | 'can_offer'>): { ways: WayOut[]; refusal: string | null } {
  if (st.tier === 'hostile') return { ways: [], refusal: null };
  const ways: WayOut[] = [];
  const add = (text: string, ...names: string[]) => { if (!ways.some((w) => w.text === text)) ways.push({ text, names }); };
  // Uno de cada, para que quepan caminos distintos.
  for (const t of st.pending.slice(0, 1)) add(`lo que tiene a medias: «${t}»`, t);
  if (st.tier !== 'wary') for (const t of st.can_offer.slice(0, 1)) add(`algo que puede hacer por él: «${t}»`, t);
  let refusal: string | null = null;
  const people: Npc[] = [];
  for (const clue of world.campaign.clues ?? []) {
    if (pc.clues.includes(clue.id)) continue;
    const sources = clue.sources ?? [];
    if (!clue.npc_ids?.includes(npc.id) && !sources.some((s) => s.npc_id === npc.id)) continue;
    for (const s of sources) {
      if (s.npc_id === npc.id) {
        if (!s.requires || holds(world, pc, s.requires)) continue;
        refusal ??= s.refusal ?? null;
        for (const t of questsAsked(world, pc, s.requires)) add(`lo que le haría hablar: cumplir «${t}»`, t);
      } else if (s.npc_id && (!s.requires || holds(world, pc, s.requires))) {
        const o = world.npcs.get(s.npc_id);
        if (o) people.push(o);
      }
    }
    if (!sources.length) for (const id of clue.npc_ids ?? []) { const o = id === npc.id ? null : world.npcs.get(id); if (o) people.push(o); }
  }
  for (const o of people) {
    if (o.status !== 'alive' || o.mute) continue;
    const name = pc.knows.includes(o.id) ? o.name : descriptorOf(world, o.id);
    add(`otra persona que sabe algo: ${name}, sin decir qué sabe`, name);
  }
  add('qué querría a cambio, sacado de lo que quiere él');
  return { ways: ways.slice(0, WAY_OUT_MAX), refusal };
}

export function talkState(world: World, events: readonly GameEvent[], pc: Character, npc: Npc, nowG: number): TalkState {
  const said = transcriptOf(events, pc.id, npc.id, 1);
  const mem = npc.memory.filter((m) => m.character_id === pc.id);
  const last = Math.max(said.at(-1)?.game_s ?? -Infinity, mem.at(-1)?.game_s ?? -Infinity);
  const close = new Set([npc.id, ...(npc.bonds ?? []).filter((b) => b.kind !== 'rival').map((b) => b.npc_id)]);
  const story = storyOf(world);
  const can_offer: string[] = [];
  const pending: string[] = [];
  const locked: string[] = [];
  // Un título que es también el nombre de un sitio o de alguien («El Granero Quemado»): nombrar el sitio no es nombrar la misión.
  const named = new Set([...world.locations.values(), ...world.spots.values(), ...world.npcs.values()].map((x) => bare(x.name)));
  for (const q of story?.quests ?? []) {
    // La principal de otra situación no es suya: ni se le ofrece ni hace falta callarla.
    if (q.main_for && !q.main_for.includes(pc.situation?.id ?? '')) continue;
    const s = questStatus(world, pc, q);
    if (s === 'locked') { if (!named.has(bare(q.title))) locked.push(q.title); continue; }
    if (s === 'available' && q.giver_npc_id === npc.id) can_offer.push(q.title);
    if ((s === 'active' || s === 'ready') && q.giver_npc_id && close.has(q.giver_npc_id) && !q.main_for) pending.push(q.title);
  }
  for (const j of activeJobs(world)) if (j.giver_npc_id === npc.id && !pc.completed_jobs.includes(j.id)) can_offer.push(j.title);
  for (const g of givenQuests(pc)) if (g.status === 'active' && droppedAt(pc, g.id) === null && g.giver_npc_id && close.has(g.giver_npc_id)) pending.push(g.title);
  const tier = talkTier(npc, pc);
  // Turnos del jugador en que ya le ha contestado (lo que dijo en la apertura o en una llegada no es charla con él);
  // lo hablado en otro momento (su memoria) también cuenta como charla previa.
  const played = events.filter((e) => !SCENE_TYPES.has(e.action_type));
  const lines = transcriptOf(played, pc.id, npc.id, TALK_MEMORY_LINES);
  const answers = new Set(lines.filter((l) => l.who === 'npc').map((l) => l.game_s)).size;
  const new_talk = !said.length || nowG - said.at(-1)!.game_s > RECENT_S;
  // Esta charla: las líneas seguidas, sin un hueco de más de 15 min de juego, hasta ahora.
  const now: typeof lines = [];
  if (!new_talk) {
    let prev = nowG;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (prev - lines[i]!.game_s > RECENT_S) break;
      now.unshift(lines[i]!);
      prev = lines[i]!.game_s;
    }
  }
  const answers_now = new Set(now.filter((l) => l.who === 'npc').map((l) => l.game_s)).size;
  const lastNpc = now.at(-1)?.who === 'npc' ? norm(now.at(-1)!.text) : '';
  const refused_asks = refusalStreak(events, pc, npc, nowG);
  // Ya se ha negado una vez: lo que tiene para él es justo la salida, no hace falta esperar otro turno.
  const talked = answers >= RIPE_TURNS || refused_asks.length > 0 || mem.some((m) => nowG - m.game_s > RECENT_S);
  // Madura (CONVERSACION-FLUJO, capa 4): dos respuestas en ESTA charla (o una negativa), nunca en su primer turno.
  // Ya no la abre él: la insinúa y espera a que el jugador muestre interés (decisión de Miguel, 06-11).
  const ripe = can_offer.length > 0 && !new_talk && (answers_now >= RIPE_TURNS || refused_asks.length > 0)
    && tier !== 'hostile' && tier !== 'wary' && !askedSince(world, pc, npc, nowG - RECENT_S);
  const out = wayOut(world, pc, npc, { tier, pending, can_offer });
  const terms = termsWith(world, pc, npc, nowG);
  const crimeLine = npcCrimeLine(world, npc, pc, nowG);
  const returning = last > -Infinity && nowG - last > RETURNING_S;
  const k = knowsOf(pc, npc, { spoke: said.length > 0 || mem.length > 0, talking: !new_talk, returning, terms, crime: crimeLine });
  const recent = recentDeed(events, pc, npc, nowG);
  const busy = Boolean(npc.talking_to && npc.talking_to.character_id !== pc.id);
  return {
    // Primera vez: ni han hablado ni se conocen por su situación o por la apertura.
    first_meeting: !said.length && !mem.length && k.knows !== 'known',
    returning,
    knows_name: pc.knows.includes(npc.id),
    tier,
    opinion: opinionOf(npc, pc.id),
    crime: crimeLine !== null,
    recent,
    busy,
    can_offer, talked, ripe, pending, locked,
    debt: openDebts(pc).some((d) => d.npc_id === npc.id || d.on_behalf_of === npc.id),
    trades: npc.sells.length > 0 || npc.buys.length > 0,
    terms,
    new_talk,
    refusals: refused_asks.length, refused_asks, way_out: out.ways, refusal_note: out.refusal,
    social_tried: triedSocial(events, pc, npc, nowG),
    knows: k.knows, knows_pc_name: k.name, heard_of: k.heard,
    flags: flagsFor(world, pc, npc, nowG, recent, busy),
    escalation: escalationIn(events, pc, npc, nowG, refused_asks.length),
    npc_asked: /\?\s*[»"”]?\s*$/.test(lastNpc),
    hinted: Boolean(lastNpc) && HINT.test(lastNpc),
    answers_now,
  };
}

/** Lo que dice un NPC cuando deja caer un encargo sin abrirlo (hueco D, «la insinúa»). Sobre texto normalizado. */
const HINT = /\b(si quieres|te interesa|me vendria bien|me haria falta|me hace falta|necesito a alguien|busco a alguien|unas monedas|ganarte|podrias echarme|una mano|un favor)\b/;

// ---------------------------------------------------------------------------
// 2. Situación
// ---------------------------------------------------------------------------

/** Capa 5: lo que le ha dicho el jugador, una intención por turno (docs/CONVERSACION-FLUJO.md). */
export const TALK_INTENTS = ['open', 'greeting', 'identity', 'answer', 'public', 'delicate', 'question', 'work', 'delivery', 'trade', 'favor', 'persuade', 'flattery', 'calm', 'insult', 'threat', 'farewell', 'chat'] as const;
export type TalkIntent = typeof TALK_INTENTS[number];
export const INTENT_ES: Record<TalkIntent, string> = {
  open: 'abre la charla', greeting: 'saludo', identity: 'quién es quién', answer: 'contesta a lo que él preguntó', public: 'pregunta por algo público',
  delicate: 'pregunta por algo delicado o de historia', question: 'pregunta', work: 'pide trabajo', delivery: 'entrega o da cuenta de un encargo',
  trade: 'comercio', favor: 'pide un favor', persuade: 'intenta convencerle o le aprieta', flattery: 'le adula', calm: 'se disculpa o le calma',
  insult: 'le insulta', threat: 'le amenaza', farewell: 'se despide', chat: 'comenta sin más',
};

/** Preguntas por lo que sabe todo el mundo: dónde, cuándo, cuánto, a qué hora. */
const PUBLIC_Q = /\b(donde|cuando|a que hora|cuanto|por donde|quien vive|quien es el|quien es la|como llego|como se va)\b/;

/**
 * Capa 5: la intención principal del turno. Va primero lo que cambia la charla (insulto, amenaza, entrega, comercio,
 * trabajo, quién es quién), luego las preguntas y, al final, saludar, abrir o comentar.
 */
export function intentOf(st: Pick<TalkState, 'pending' | 'npc_asked' | 'hinted'>, tx: TextSignals, topics: readonly TalkTopic[], text: string): TalkIntent {
  const t = norm(text);
  if (tx.presses && !tx.question) return 'threat';
  if (tx.hostile) return /\b(te mato|te voy a matar|amenaz\w*)\b/.test(t) ? 'threat' : 'insult';
  if (tx.delivery && st.pending.length) return 'delivery';
  if (tx.trade) return 'trade';
  if (tx.asks_work || (st.hinted && tx.affirmative)) return 'work';
  if (tx.identity || tx.introduces || tx.asks_who) return 'identity';
  if (tx.argues || tx.presses) return 'persuade';
  if (tx.farewell) return 'farewell';
  if (tx.calm) return 'calm';
  if (tx.flattery) return 'flattery';
  if (tx.question || tx.lore_word || topics.length) {
    if (tx.lore_word || topics.some((x) => x.kind === 'rumor' || x.kind === 'faction')) return 'delicate';
    if (PUBLIC_Q.test(t) || topics.some((x) => x.kind === 'person' || x.kind === 'place')) return 'public';
    return st.npc_asked && !/[?¿]/.test(text) ? 'answer' : 'question';
  }
  if (tx.request) return 'favor';
  if (st.npc_asked) return 'answer';
  if (tx.opens) return 'open';
  if (tx.greeting) return 'greeting';
  return 'chat';
}

/**
 * Situaciones que se cumplen, por prioridad (docs/CONVERSACION-REGLAS.md, §2). Desde el flujo de cinco capas
 * (CONVERSACION-FLUJO.md) son una etiqueta: el guion sale de los huecos (`talkHoles`). Se mantienen para la puerta de
 * las misiones (`askBlocked`, `offersNow`), la longitud y lo que declara el máster.
 */
export function situationsFor(st: TalkState, tx: TextSignals, topics: readonly TalkTopic[], talky = true): TalkSituation[] {
  const asks = tx.question || tx.request || tx.trade || topics.length > 0;
  const out: TalkSituation[] = [];
  if (st.crime || st.recent === 'attack' || (st.flags ?? []).some((f) => f.block)) out.push('danger');
  if (st.recent === 'gift' || tx.hostile) out.push('reaction');
  // El trato receloso es un filtro de tono (capa 3), no una situación: la pregunta se contesta igual. Hostil, sí.
  if (st.tier === 'hostile') out.push('cold');
  if (st.pending.length && (tx.delivery || !asks)) out.push('errand');
  if (tx.trade && st.trades) out.push('trade');
  const gives = st.can_offer.length > 0 || Boolean(st.terms);
  // Pide trabajo, o dice que sí a lo que él dejó caer: entonces sí sale (la madura solo se insinúa).
  const interest = tx.asks_work || Boolean(st.hinted && tx.affirmative);
  if (interest && gives) out.push('offer');
  if (topics.length && (tx.question || tx.lore_word)) out.push('lore');
  if (tx.question || tx.request || (tx.asks_work && !gives) || tx.identity || tx.asks_who) out.push('question');
  if (tx.greeting || (tx.opens && talky)) out.push('greeting');
  if (tx.farewell) out.push('farewell');
  if (!out.length) out.push('chat');
  return out;
}

/** ¿Es este turno pedirle ya una misión? Sí, si ha llegado a eso o lo declara el máster con la charla empezada. */
export function offersNow(p: TalkPlan, declared: unknown): boolean {
  if (p.talky === false) return false;
  return p.situation === 'offer' || p.second === 'offer' || (declared === 'offer' && !p.state.first_meeting && p.state.can_offer.length > 0);
}

/**
 * ¿Puede `npcId` pedirle ya algo al actor en este turno? Una misión solo sale de una charla con quien la pide que haya
 * llegado a eso (docs/CONVERSACION-REGLAS.md, §5): el jugador le habla a él en este turno y la situación es «offer»
 * (ha preguntado por trabajo o por lo que le pasa, o llevan un rato hablando). Estar cerca, la escena de apertura, un
 * combate o una acción que no va con él no bastan. `kind`: `story`, una misión de la historia escrita; `free`, un
 * encargo improvisado (give_quest), que vale también si el jugador le pide algo o ya llevan un rato; `accept`, el
 * jugador se ofrece o cambia de idea: basta con que le hable a él. null si puede; si no, el motivo.
 */
export function askBlocked(p: TalkPlan | null, npcId: Id, kind: 'story' | 'free' | 'accept'): string | null {
  if (!p || p.npc_id !== npcId) return 'el actor no está hablando con quien la pide en este turno (estar cerca no basta)';
  if (kind === 'accept') return null;
  const offer = p.situation === 'offer' || p.second === 'offer';
  if (offer || (kind === 'free' && (p.text.asks_work || p.text.request || p.state.talked))) return null;
  return p.state.first_meeting && !p.text.asks_work
    ? 'es la primera vez que hablan y el actor no ha preguntado por trabajo ni por lo que le pasa'
    : 'la charla aún no ha llegado a eso: el actor no ha preguntado por trabajo ni por lo que le pasa, y no llevan un rato hablando';
}

/** Lo que el motor ha decidido para el turno. */
export interface TalkPlan {
  npc_id: Id;
  situation: TalkSituation;
  second: TalkSituation | null;
  /** Ninguna señal clara: el máster puede declarar otra situación en log_event. */
  doubtful: boolean;
  state: TalkState;
  text: TextSignals;
  topics: TalkTopic[];
  /** Lo que escribe suena a hablarle (soundsLikeTalk); si no (pelea, se mueve…), no se le pide nada en este turno. */
  talky?: boolean;
  /** Capa 5: lo que le ha dicho (CONVERSACION-FLUJO). */
  intent?: TalkIntent;
  /** Nivel del NPC: `extra` (relleno, PLAN-NPC-RELLENO) recorre el mismo flujo con las capas recortadas. */
  level?: 'main' | 'extra';
  /** Capa 3: la escalada llega a cortar en este turno. */
  cut?: boolean;
  /** El nombre del actor, para que el NPC no lo use si no lo sabe (control al cierre). */
  pc_name?: string;
  /** Cuándo habla el narrador en este turno (narrator.ts); lo pone quien conoce la escena (prompt.ts, talkPlanFor). */
  narrator?: NarratorPlan;
}

/** Las seis intenciones que atiende un vecino de relleno; el resto, le despacha (PLAN-NPC-RELLENO). */
const EXTRA_INTENTS: ReadonlySet<TalkIntent> = new Set(['open', 'greeting', 'public', 'trade', 'delicate', 'identity', 'insult', 'threat', 'farewell']);

/** ¿Suena a que le habla a alguien? (comillas, saludo, pregunta, verbo de habla). */
const SPEECH = /[«"“?¿]|\b(habl\w*|digo|dice|le digo|pregunt\w*|salud\w*|charl\w*|cuent\w*)\b/;

/** El NPC al que va lo que dice el PJ: el que nombra, con quien habla o, si suena a charla, el único que tiene al lado. */
export function talkTarget(world: World, events: readonly GameEvent[], pc: Character, text: string, nowG: number): Npc | null {
  const t = npcTarget(world, events, pc, text, nowG);
  if (t) return t;
  if (!SPEECH.test(norm(text)) && !textSignals(text).greeting) return null;
  const spot = world.characterSpot(pc);
  if (!spot) return null;
  const near = [...world.npcs.values()].filter((n) => n.status === 'alive' && n.location.id === spot.id && !n.mute);
  return near.length === 1 ? near[0]! : null;
}

/** Una acción física, no una frase: desenvainar, acercarse, atacar, esconderse, moverse, coger o registrar algo. */
const PHYSICAL = /\b(desenvain\w*|envain\w*|empun\w*|blando|ataco|atacar|ataca|golpe\w*|apunal\w*|disparo|disparar|lanzo|lanzar|me acerco|acerco|me alejo|me escondo|escondo|me agacho|me muevo|me deslizo|me cuelo|voy|camino|corro|huyo|salto|trepo|entro|salgo|subo|bajo|cojo|agarro|robo|saco|registro|rebusco|forcejeo|sin que me (vea|vean|oiga|oigan)|sin que se (entere|enteren|de cuenta))\b/;

/**
 * ¿Es este turno hablarle a alguien? Sí si suena a charla (comillas, pregunta, verbo de habla, saludo, despedida o
 * pedir algo), o si no describe una acción física: «Sí, un día largo» en plena charla es contestarle.
 * «Desenvaino y me acerco sin que me vea» no: es otra acción, aunque tenga al lado a con quien hablaba.
 */
export function soundsLikeTalk(text: string): boolean {
  const tx = textSignals(text);
  const t = norm(text);
  return SPEECH.test(t) || tx.greeting || tx.farewell || tx.question || tx.request || tx.asks_work || !PHYSICAL.test(t);
}

/** El plan del turno, o null si no es una charla con un NPC. */
export function talkPlan(world: World, events: readonly GameEvent[], pc: Character, text: string, nowG: number): TalkPlan | null {
  const npc = talkTarget(world, events, pc, text, nowG);
  if (!npc || npc.status !== 'alive' || npc.mute) return null;
  return planWith(world, events, pc, npc, text, nowG);
}

/**
 * El plan de este turno con un NPC concreto, o null si lo que hace el jugador no es hablarle a él: no suena a charla,
 * o va con otro (le nombra, o habla con otro). Para saber si ese NPC puede pedirle algo ahora (askBlocked).
 */
export function talkPlanWith(world: World, events: readonly GameEvent[], pc: Character, npc: Npc, text: string, nowG: number): TalkPlan | null {
  if (npc.status !== 'alive' || npc.mute || !soundsLikeTalk(text)) return null;
  const other = npcTarget(world, events, pc, text, nowG);
  if (other && other.id !== npc.id) return null;
  return planWith(world, events, pc, npc, text, nowG);
}

function planWith(world: World, events: readonly GameEvent[], pc: Character, npc: Npc, text: string, nowG: number): TalkPlan {
  const state = talkState(world, events, pc, npc, nowG);
  const tx = textSignals(text);
  const topics = loreTopics(world, npc, text, nowG);
  const talky = soundsLikeTalk(text);
  const level = npc.tier === 'extra' ? 'extra' : 'main';
  const intent = intentOf(state, tx, topics, text);
  const all = situationsFor(state, tx, topics, talky);
  // Relleno: nunca misiones (capa 4); lo que no es de las seis, le despacha.
  const sits = level === 'extra' ? all.filter((s) => s !== 'offer' && s !== 'errand') : all;
  if (!sits.length) sits.push('chat');
  const textual = Object.values(tx).some(Boolean) || topics.length > 0;
  // Corta: harto y le vuelve a insultar o amenazar; el relleno, ya a la segunda.
  const hostileTurn = intent === 'insult' || intent === 'threat';
  const cut = hostileTurn && (state.escalation === 'fed_up' || (level === 'extra' && state.escalation !== 'calm'));
  return {
    npc_id: npc.id, situation: sits[0]!, second: sits[1] ?? null, doubtful: sits[0] === 'chat' && !textual, state, text: tx, topics, talky,
    intent: level === 'extra' && !EXTRA_INTENTS.has(intent) ? 'chat' : intent, level, cut, pc_name: pc.name,
  };
}

/** ¿Puede ser esta situación, según el estado? (para la que declare el máster). */
export function situationFits(s: TalkSituation, st: TalkState): string | null {
  if (s === 'danger' && !st.crime && st.recent !== 'attack' && !(st.flags ?? []).some((f) => f.block)) return 'no ha visto ningún crimen ni ataque del actor, ni hay alarma en el sitio';
  if (s === 'reaction' && !st.recent) return 'el actor no le ha dado ni hecho nada en estos minutos (si le insulta o amenaza, el texto ya lo dice)';
  if (s === 'cold' && st.tier !== 'hostile' && st.tier !== 'wary') return `su trato con el actor es ${TALK_TIER_LABEL[st.tier]}, no hostil ni receloso`;
  if (s === 'errand' && !st.pending.length) return 'el actor no tiene ninguna misión ni encargo suyo en curso';
  if (s === 'trade' && !st.trades) return 'no compra ni vende nada';
  if (s === 'offer' && !st.can_offer.length && !st.terms) return 'no tiene ninguna misión ni encargo que dar ahora';
  return null;
}

// ---------------------------------------------------------------------------
// 3. Guion
// ---------------------------------------------------------------------------

const quote = (xs: readonly string[]) => xs.map((x) => `«${x}»`).join(', ');

/** Lo prohibido en una situación. */
function forbidden(s: TalkSituation, p: TalkPlan): string[] {
  const st = p.state;
  const out = ['Inventar hechos (objetos, lugares, gente, precios, pistas) que no estén en el contexto.'];
  if (st.locked.length) out.push(`Nombrar o insinuar misiones que el actor aún no puede coger: ${quote(st.locked)}.`);
  if (s === 'greeting' && st.first_meeting) out.push('Encargos, historia del lugar, secretos o su vida entera: es un saludo.');
  if (st.can_offer.length && !givesWork(p)) out.push(`Nombrar o pedirle ${quote(st.can_offer)}: ${st.ripe ? 'como mucho lo deja caer, sin título, y espera a que muestre interés' : 'la charla aún no da para ello'}.`);
  if (st.knows && st.knows !== 'none') out.push('Preguntarle quién es: ya sabe de él.');
  if (!st.knows_pc_name && p.pc_name) out.push(`Llamarle ${p.pc_name}: no sabe su nombre.`);
  if (!p.text.question && !p.text.asks_work && !p.text.request) out.push('Contestar a algo que el actor no ha dicho («ya que lo preguntas…»), o poner en su boca lo que no ha escrito.');
  if (p.level === 'extra') out.push('Misiones, encargos, secretos o historia del pueblo: es un vecino, no sabe de eso.');
  if (s === 'question' || s === 'lore') out.push('Dejar la pregunta sin contestar o contestar otra cosa.');
  if (s === 'lore') out.push('Recitar como un libro.');
  if (s === 'offer') out.push('Listar condiciones o preguntar «¿aceptas?».');
  if (s === 'trade') out.push('Dar por cerrado un trato sin buy_item o sell_item. Servir o entregar lo que vende sin cobrarlo ni fiarlo.');
  if (s === 'cold') out.push('Lo delicado (secretos, lo que su trato no da). Negar lo público o lo suyo con el actor.');
  if (st.way_out.length && LADDER.includes(s)) out.push('Negarse sin dejar salida. «Mañana» o «ya veremos» no son una salida.');
  if (!st.new_talk) out.push('Volver a preguntarle para qué lo quiere.');
  return out;
}

/** Situaciones en las que puede negarse a algo delicado. */
const LADDER: readonly TalkSituation[] = ['question', 'lore', 'cold', 'chat'];

const waysText = (st: TalkState) => st.way_out.map((w) => w.text).join('; ');

/** Lo que hace con las negativas en este turno: la salida y, si ya se ha negado, cerrar el tema o cortar la charla. */
function refusalLines(p: TalkPlan, npcName: string): string[] {
  const st = p.state;
  if (!LADDER.includes(p.situation) || !st.way_out.length) return [];
  const ways = waysText(st);
  const note = st.refusal_note ? ` Cómo se niega él (a su manera, no lo copies): ${st.refusal_note}.` : '';
  if (st.refusals >= CUT_AFTER_REFUSALS) return [`Ya se ha negado ${st.refusals} veces. Si vuelve sobre lo mismo, se acabó: una sola frase de ${npcName}, que no sigue con esto y qué haría falta (${ways}), y vuelve a lo suyo. Bájale la confianza (npc_trust harass). La charla termina aquí.`];
  if (st.refusals === 1) return [`Ya se ha negado una vez. Si vuelve sobre lo mismo, lo cierra en una frase, sin repetir lo que dijo, y le deja claro qué haría falta: ${ways}.`];
  return [`Si se niega a algo delicado, la salida, sin contar el secreto: ${ways}.${note}`];
}

/** ¿Pide tirada este turno? Cuando intenta convencerle o le aprieta con algo delicado, una vez por charla. */
function socialLine(p: TalkPlan): string | null {
  const st = p.state;
  if (!(p.text.argues || p.text.presses) || !LADDER.includes(p.situation) || st.tier === 'hostile') return null;
  if (st.social_tried) return 'Ya lo ha intentado con una tirada en esta charla: no pidas otra.';
  const skill = p.text.presses ? 'intimidation' : 'persuasion o, si lo que dice es mentira, deception';
  return `Intenta ${p.text.presses ? 'apretarle' : 'convencerle'}. Si lo que pide es delicado, no contestes aún: cierra con requires_roll (skill ${skill}, CD ${SOCIAL_DC[st.tier]}) y narra solo el momento previo. Si es público o sin importancia, contesta sin tirada.`;
}

/**
 * La línea del contexto al resolver una tirada social con quien habla (prompt.ts, «Resultado de la tirada»). Con
 * éxito da el camino, no el secreto; con fallo se cierra. El servidor ya ha movido la confianza (trust.ts).
 */
export function socialOutcomeLine(world: World, events: readonly GameEvent[], pc: Character, skill: string, success: boolean | null, nowG: number): string | null {
  if (!SOCIAL_SKILLS.has(skill) || success === null) return null;
  const npc = talkPartner(world, pc);
  if (!npc) return null;
  const name = pc.knows.includes(npc.id) ? npc.name : descriptorOf(world, npc.id);
  if (!success) return `Tirada social fallida: ${name} se cierra y lo nota como insistencia. No da nada nuevo.`;
  const ways = waysText(talkState(world, events, pc, npc, nowG));
  const grudge = skill === 'intimidation' ? ' Lo dice de mala gana y no se lo perdona.' : '';
  return `Tirada social con éxito: ${name} no cuenta lo que calla (su confianza no llega), pero cede algo y lo dice en lines: por dónde seguir (${ways}).${grudge}`;
}

/** Palabras como mucho de lo que dice un vecino de relleno: dos frases. */
const EXTRA_WORDS = 25;

/** Palabras como mucho de lo que dice el NPC con este plan. */
export function planWords(p: { situation: TalkSituation; second: TalkSituation | null; level?: 'main' | 'extra' }): number {
  if (p.level === 'extra') return EXTRA_WORDS;
  return SITUATION_WORDS[p.situation] + (p.second ? SECOND_WORDS : 0);
}

/** Los cinco huecos del guion, en el orden en que habla (CONVERSACION-FLUJO). null: vacío, no se dice. */
export interface TalkHoles { A: string | null; B: string | null; C: string | null; D: string | null; E: string | null }

export const HOLE_ES: Record<keyof TalkHoles, string> = { A: 'lo urgente', B: 'reconocimiento', C: 'respuesta', D: 'misión', E: 'cierre' };

/** ¿Le da una misión en este turno? Solo si la pide o dice que sí a lo que él dejó caer (y tiene qué darle). */
export function givesWork(p: TalkPlan): boolean {
  return p.level !== 'extra' && (p.situation === 'offer' || p.second === 'offer');
}

/** Hueco B: cómo se dirige a él, según lo que sabe del PJ (capa 2). */
function holeB(p: TalkPlan): string | null {
  const st = p.state;
  const name = p.pc_name ?? 'el actor';
  const named = st.knows_pc_name ? `Le llama ${name}.` : 'No sabe su nombre: no lo usa (le llama por lo que ve).';
  switch (st.knows) {
    case 'talking': return null;
    case 'none':
      if (p.intent === 'open' || p.intent === 'greeting') {
        return p.level === 'extra' ? 'Un saludo corto y frío, de quien no le conoce.'
          : 'Saludo de extraño, según su carácter. Se presenta si su oficio lo pide (atiende un negocio) o si es amable; si no, no.';
      }
      return 'Como mucho un gesto o una mirada de quien no le conoce: sin saludo largo.';
    case 'heard':
      return `Sabe de él sin haberle hablado (${st.heard_of}): le trata por eso. Nunca le pregunta quién es. ${named}`;
    case 'known':
    case 'returning':
      return `Le reconoce${st.knows === 'returning' ? ' y nota que hacía tiempo' : ''}: ya se conocen. ${named} Sin presentarse otra vez ni preguntarle quién es.`;
  }
}

/** Hueco C: la respuesta a lo que le ha dicho (capa 5), con el filtro de su trato (capa 3). */
function holeC(p: TalkPlan): string | null {
  const st = p.state;
  const tier = st.tier;
  const friendly = tier === 'friend' || tier === 'ally';
  const name = p.pc_name ?? 'el actor';
  const known = st.knows_pc_name ? `${name}${st.heard_of ? `; ${st.heard_of}` : ''}` : st.heard_of;
  const join = (xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
  if (p.level === 'extra' && p.intent === 'chat') return 'Le despacha en una frase: tiene faena. No sabe de historias ni de misiones.';
  switch (p.intent ?? 'chat') {
    case 'open': return 'Una invitación corta, según su oficio: qué quiere, qué le pone, qué le trae. Nada más.';
    case 'greeting': return st.knows === 'talking' ? 'Devuelve el saludo, sin más.' : null;
    case 'identity':
      if (p.text.introduces) return 'Se le presenta: toma nota de su nombre y desde ahora lo usa.';
      if (p.text.asks_who && !p.text.identity) return 'Le pregunta quién es él: se presenta (nombre y oficio) o se niega, según su carácter y su trato.';
      return known ? `Sabe quién es: ${known}. Lo dice claro, en la primera frase, sin contradecir lo que ya dijo.`
        : 'No le conoce: lo dice, y le pregunta quién es.';
    case 'answer': return 'Le ha contestado a lo que él le preguntó: reacciona a esa respuesta antes de cambiar de tema.';
    case 'public': return join([
      'Contesta: es público (dónde vive o anda alguien, precios, horarios). Seco si su trato es frío, pero lo contesta en la primera frase.',
      p.topics.length ? `Lo que sabe todo el mundo: ${p.topics.map((t) => `${t.name} (${t.known})`).join('; ')}.` : '',
      p.level === 'extra' ? '' : 'Si no lo sabe, lo dice y, si alguien de aquí lo sabe, dice a quién preguntar.',
    ]);
    case 'delicate':
      if (p.level === 'extra') return 'No sabe de eso: lo dice y remite a alguien de los que conoce («pregúntaselo a…»).';
      return join([
        p.topics.length ? `Lo que sabe todo el mundo: ${p.topics.map((t) => `${t.name} (${t.known})`).join('; ')}. Luego su opinión o su miedo.` : 'Primera frase: contesta (sí, no o no lo sé).',
        tier === 'stranger' || tier === 'wary' ? 'Lo delicado, no: con palabras suyas y sin frase hecha, y deja una salida.'
          : tier === 'acquaintance' ? 'Lo delicado: duda, pide un motivo o algo a cambio.'
            : 'Lo delicado, lo que su trato permite (lo que «contaría a este nivel» en su línea).',
      ]);
    case 'question': return join([
      'Primera frase: contesta (sí, no o no lo sé; «eso no te lo digo», solo para lo delicado, nunca para lo público).',
      tier === 'stranger' || tier === 'wary' ? 'Si es delicado, no lo cuenta, con palabras suyas, y deja una salida.'
        : tier === 'acquaintance' ? 'Si es delicado, pide un motivo o algo a cambio.' : 'Si lo sabe, lo cuenta con su opinión.',
    ]);
    case 'trade': return st.trades
      ? 'Primera frase: el precio exacto de su lista (Vende/Compra en su línea). Si se lo da, lo cobra al servirlo (buy_item en el mismo turno) o se lo fía con set_debt; si no, no se lo da. Regatear, solo con tirada de Persuasión.'
      : 'No vende ni compra eso: lo dice y, si lo sabe, a quién ir.';
    case 'work':
    case 'delivery': return null; // lo da el hueco D
    case 'favor': return 'Sí, no o qué querría a cambio, según su trato.';
    case 'persuade': return 'Si lo que pide es delicado, decide la tirada (ver abajo); si es público o sin importancia, contesta sin tirada.';
    case 'flattery': return 'Reacciona al halago según su carácter: lo agradece o le suena a pelota (npc_trust flattery).';
    case 'calm': return st.escalation !== 'calm' || tier === 'hostile'
      ? `Se disculpa o le calma: lo acepta a su manera (un rencoroso lo nota, pero no se ablanda del todo) y la tensión baja un escalón${tier === 'hostile' ? ' (npc_trust calm)' : ''}.`
      : 'Le quita hierro: contesta con naturalidad.';
    case 'insult': return p.cut ? null : 'Reacciona al insulto según su carácter: se ofende, se planta o le avisa. Bájale la confianza (npc_trust insult).';
    case 'threat': return p.cut ? null : 'Reacciona a la amenaza según quién es: se asusta, se planta o la devuelve. npc_trust threat.';
    case 'farewell': return 'Una frase de despedida, con su carácter.';
    case 'chat': return st.knows === 'talking' || friendly ? 'Sigue la charla: contesta a lo que dice y saca UN tema suyo de lo que le ronda hoy, el más fuerte.' : 'Contesta a lo que dice, breve, con su carácter.';
  }
}

/** Hueco D: la misión (capa 4). Nunca en el relleno. */
function holeD(p: TalkPlan): string | null {
  if (p.level === 'extra') return null;
  const st = p.state;
  const friendly = st.tier === 'friend' || st.tier === 'ally';
  if (p.intent === 'delivery' && st.pending.length) {
    return `Si trae lo que pidió (${quote(st.pending)}), lo reconoce y cierra la entrega con su tool (story_quest turn_in, complete_job o finish_quest); si no lo trae, se lo dice. ${friendly ? 'Lo agradece de corazón.' : 'Sin rodeos.'}`;
  }
  if (p.intent === 'work' || givesWork(p)) {
    if (st.can_offer.length) return `Le da UNA: ${quote(st.can_offer.slice(0, 1))}. La cuenta como la cuenta él (qué le pasa, por qué no va él, qué paga) y la registra en este mismo turno (story_quest ask o give_quest). Sin listar condiciones ni «¿aceptas?».`;
    if (st.terms) return 'Lo que tiene para él es su trato («Lo suyo con el actor»): qué tiene que hacer, dónde y para quién, dicho claro y a su manera. Nada de «no lo cuento» ni «lo decide otro»: es suyo y el actor ya lo sabe. Lo que gana si lo hace y lo que pasa si no. Ya está en su Diario: nada de give_quest ni story_quest.';
    return 'No tiene trabajo que dar: lo dice y, si hay tablón o alguien que paga, le remite allí.';
  }
  const opening = p.intent === 'open' || p.intent === 'greeting' || (st.new_talk && p.intent === 'chat');
  if (opening && st.terms) return 'Le recuerda lo suyo en una frase: lo que debe y el plazo.';
  if ((opening || p.intent === 'farewell') && st.pending.length) return `Pregunta cómo va ${quote(st.pending.slice(0, 1))}, en una frase${friendly ? ', y se nota que le importa' : ''}.`;
  if (p.intent === 'farewell' && st.debt) return 'Le recuerda lo que le debe.';
  // Madura: la insinúa al final y espera a que el jugador muestre interés (decisión de Miguel, 06-11).
  if (st.ripe && p.talky !== false && !['farewell', 'trade', 'insult', 'threat'].includes(p.intent ?? '')) {
    return 'Al final, como quien no quiere la cosa, deja caer que le vendría bien una mano con algo suyo, sin título ni detalles. No lo abre: espera a que el jugador muestre interés.';
  }
  return null;
}

/** Hueco E: el cierre. */
function holeE(p: TalkPlan, d: string | null): string | null {
  const st = p.state;
  if (p.cut) return 'Corta la charla: una frase, le da la espalda o le echa, y vuelve a lo suyo. Bájale la confianza (npc_trust harass). La charla termina aquí.';
  if (st.tier === 'hostile') return 'Puede cortar la charla o echarle.';
  if (d && st.ripe) return null; // la insinuación es lo último
  if (p.level === 'extra') return null;
  if (st.knows === 'none' && (p.intent === 'open' || p.intent === 'greeting')) return 'Pregunta quién es o qué le trae.';
  if (st.tier === 'wary' && st.new_talk && !['open', 'greeting'].includes(p.intent ?? '')) return 'Pregunta qué quiere y por qué.';
  if (st.tier === 'wary' && !st.new_talk) return 'No le vuelvas a preguntar para qué lo quiere: eso ya está preguntado.';
  if (p.intent === 'chat' && st.knows !== 'talking') return st.tier === 'stranger' ? 'Tantea: pregunta de dónde viene o qué busca.' : 'Le pregunta algo a él.';
  return null;
}

/** Los cinco huecos del turno (CONVERSACION-FLUJO). Un peligro deja solo A; cortar deja solo E. */
export function talkHoles(p: TalkPlan): TalkHoles {
  const flags = p.state.flags ?? [];
  const block = flags.find((f) => f.block);
  if (block) return { A: `${block.text}. Nada de charla, comercio ni misiones.`, B: null, C: null, D: null, E: null };
  const first = flags.filter((f) => !f.block).slice(0, 2);
  const A = first.length ? `Primera frase: ${first.map((f) => f.text).join('; además, ')}.` : null;
  if (p.cut) return { A, B: null, C: null, D: null, E: holeE(p, null) };
  const D = holeD(p);
  return { A, B: holeB(p), C: holeC(p), D, E: holeE(p, D) };
}

/** El bloque del contexto del máster. */
export function talkScript(world: World, pc: Character, p: TalkPlan): string {
  const npc = world.npc(p.npc_id);
  const st = p.state;
  const name = pc.knows.includes(npc.id) ? npc.name : `el NPC [${npc.id}]`;
  const plan = { ...p, pc_name: p.pc_name ?? pc.name };
  const holes = talkHoles(plan);
  const who = [
    st.first_meeting ? 'primera vez que hablan' : st.returning ? 'ya se conocen, pero hace tiempo que no hablan' : 'ya han hablado',
    `trato ${TALK_TIER_LABEL[st.tier]}`,
    st.opinion ? `opinión ${st.opinion > 0 ? '+' : ''}${st.opinion}` : '',
    st.escalation && st.escalation !== 'calm' ? `está ${ESCALATION_ES[st.escalation]}` : '',
    st.busy ? 'OCUPADO con otro: lo dice y atiende a medias o le pide que espere, salvo peligro' : '',
  ].filter(Boolean).join('; ');
  const blocked = (st.flags ?? []).some((f) => f.block);
  return [
    `## Cómo responde ${name} en este turno (situación: ${p.situation})`,
    `Situación: ${SITUATION_ES[p.situation]}${p.second ? `; además, ${SITUATION_ES[p.second]}` : ''}. ${who[0]!.toUpperCase()}${who.slice(1)}.`,
    `Lo que le dice el actor: ${INTENT_ES[plan.intent ?? 'chat']}. Qué sabe de él: ${KNOWS_ES[st.knows ?? 'none']}${st.knows_pc_name ? `, y sabe su nombre (${plan.pc_name})` : ', sin saber su nombre'}.`,
    plan.level === 'extra' ? 'Es un vecino de relleno: no sabe nada de la historia, no da misiones y no nombra a nadie que no esté en el contexto. Dos frases como mucho.' : '',
    st.terms && !blocked ? `Lo suyo con el actor (el actor ya lo sabe; si pregunta por ello, lo dice claro; ya está en su Diario, no es un encargo nuevo): ${st.terms}` : '',
    blocked ? '' : 'Lo público no se niega nunca: dónde vive o trabaja alguien del sitio, precios y horarios, y lo suyo con el actor. Lo delicado son los secretos y lo que su trato no da.',
    'Este guion manda sobre las reglas generales de conversación. Lo que dice va por huecos, en este orden; los vacíos no se dicen:',
    ...(Object.keys(holes) as (keyof TalkHoles)[]).map((k) => `${k} (${HOLE_ES[k]}): ${holes[k] ?? 'vacío.'}`),
    ...(blocked || p.cut ? [] : refusalLines(plan, name)),
    blocked || p.cut ? '' : socialLine(plan) ?? '',
    `Prohibido: ${forbidden(p.situation, plan).join(' ')}`,
    `Longitud: lo que dice, ${planWords(plan)} palabras como mucho, en lines.`,
    p.narrator ? narratorLine(p.narrator) : '',
    st.escalation && st.escalation !== 'calm' && !p.cut ? 'Si el actor le da una salida perspicaz o creativa a lo que le molesta (no una disculpa ni un regalo: esos ya cuentan solos), pon en talk_deescalate de log_event qué ha hecho, en una frase; el servidor lo comprueba. Si no, null.' : '',
    p.doubtful ? `Si el jugador busca otra cosa (${TALK_SITUATIONS.filter((x) => x !== 'chat').join(', ')}), pon esa en talk_situation de log_event y responde con su regla; si no, talk_situation null.` : 'talk_situation de log_event: null.',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// 4. Control al cierre
// ---------------------------------------------------------------------------

const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;

/** Negarse a contar («eso no te lo digo», «no lo cuento en una mesa»). Sobre texto normalizado. */
const REFUSES = /\b(no te lo (digo|cuento|voy a decir|voy a contar|repito)|no te voy a (decir|contar)|eso no (te lo digo|lo digo|lo cuento|se dice|se cuenta|se le cuenta|te importa|es asunto tuyo|es cosa tuya)|no se le cuenta|no lo cuento|no lo digo|no es asunto tuyo|no es cosa tuya|no te incumbe|de eso no (hablo|se habla)|no hablo de eso)\b/;
/** Remitir a lo ya dicho: para las negativas seguidas es lo mismo. */
const ALREADY_SAID = /\b(ya te lo he dicho|te lo he dicho ya|ya te he (dicho|contestado)|ya me lo has preguntado)\b/;
/** Lo que deja una salida: qué hacer o a quién acudir. «Mañana» no, que no lleva a ningún sitio. */
const WAY_WORDS = /\b(primero|antes|cuando|trae|traeme|traes|lleva|llevale|vuelve|vuelves|ve a|ve al|ve con|habla con|preguntale|pregunta a|pregunta al|busca a|si me|si traes|hazme|ayudame|a cambio|encargo|ganate)\b/;
/** Preguntarle quién es («¿y tú quién eres?»). Sobre texto normalizado. */
const WHO_ARE_YOU = /\b(y tu quien eres|quien eres|quien (demonios|diablos|narices) eres|quien te crees|de donde sales tu|y usted quien es|quien es usted)\b/;
/** Decir que no le conoce. */
const DOESNT_KNOW = /\b(no se quien eres|no te conozco|ni idea de quien eres|no tengo ni idea de quien|no se quien es usted|no le conozco)\b/;
/** Dar por hecho que le han preguntado algo. */
export const PRESUMES = /\b(ya que (lo |me lo )?(preguntas|pregunta|mencionas|pides)|como me (pides|preguntas)|ya que me lo (pides|preguntas)|puesto que preguntas)\b/;
/** Volver a preguntar para qué lo quiere. */
const WHY_AGAIN = /\b(para que (lo )?(quieres|preguntas)|por que (lo )?(quieres saber|preguntas)|y tu (para|por) que)\b/;

/** ¿Lo que dice (normalizado) deja una salida? */
function leavesWayOut(said: string, st: TalkState): boolean {
  return WAY_WORDS.test(said) || st.way_out.some((w) => w.names.some((x) => names(said, x)));
}

/** ¿Esta respuesta es la negativa que corta la charla? Quien cierra el turno deja al NPC libre. */
export function endsTalk(p: TalkPlan, lines: readonly DialogueLine[]): boolean {
  // Harto (capa 3): el guion ya decía que corta.
  if (p.cut && lines.some((l) => l.speaker === 'npc' && (!l.npc_id || l.npc_id === p.npc_id))) return true;
  if (p.state.refusals < CUT_AFTER_REFUSALS || !LADDER.includes(p.situation)) return false;
  const said = norm(lines.filter((l) => l.speaker === 'npc' && (!l.npc_id || l.npc_id === p.npc_id)).map((l) => l.text).join(' '));
  return REFUSES.test(said) || ALREADY_SAID.test(said);
}

const askWords = (s: string) => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));

/**
 * Los botones sin lo que ya se le ha negado: lo mismo que le pedía y, tras cortar la charla, cualquier otra pregunta
 * a ese NPC. Dar o entregar sigue valiendo: es justo lo que puede abrirla.
 */
export function withoutRefused(world: World, p: TalkPlan, suggested: readonly string[]): string[] {
  const npc = world.npc(p.npc_id);
  const asks = p.state.refused_asks.map(askWords);
  const cut = p.state.refusals >= CUT_AFTER_REFUSALS;
  return suggested.filter((s) => {
    const w = askWords(s);
    if (w.size && asks.some((a) => [...w].filter((x) => a.has(x)).length / w.size >= 0.6)) return false;
    return !(cut && /^(preguntar|insistir|exigir|presionar|pedir|volver a preguntar)\b/.test(norm(s)) && names(norm(s), npc.name.split(/\s+/)[0]!));
  });
}

/**
 * Lo que el cierre incumple del plan, o []. `declared`: la situación que pone
 * el máster en log_event (null si ninguna). `pendingRoll`: pide tirada, así que
 * la respuesta llega después.
 */
export function talkProblems(p: TalkPlan, input: { lines: readonly DialogueLine[]; narration: string; declared: string | null; pendingRoll: boolean; npcName: string }): string[] {
  const out: string[] = [];
  let plan: { situation: TalkSituation; second: TalkSituation | null; level?: 'main' | 'extra' } = p;
  if (input.declared && input.declared !== p.situation) {
    const d = TALK_SITUATIONS.find((x) => x === input.declared);
    if (!d) return [`talk_situation «${input.declared}» no existe: usa ${TALK_SITUATIONS.join(', ')} o null.`];
    const why = situationFits(d, p.state);
    if (why) return [`talk_situation «${d}» no encaja: ${why}. Responde con la regla de «${p.situation}» y talk_situation null.`];
    plan = { situation: d, second: null, ...(p.level ? { level: p.level } : {}) };
  }
  if (input.pendingRoll) return out;
  const said = input.lines.filter((l) => l.speaker === 'npc' && (!l.npc_id || l.npc_id === p.npc_id)).map((l) => l.text).join(' ');
  // El comercio no: servir ya es contestar al pedido (el cobro lo mira servedWithoutPay, closecheck.ts).
  const answers: TalkSituation[] = ['question', 'lore', 'offer', 'errand', 'greeting'];
  // Lo que dice entre comillas en la narración también es contestar («Brenna te mira. «¿Qué va a ser?»»).
  const quoted = /«[^»]{2,}»/.test(input.narration);
  if (answers.includes(plan.situation) && !said.trim() && !quoted) out.push(`${input.npcName} no dice nada y le toca contestar (${SITUATION_ES[plan.situation]}): pon su respuesta en lines.`);
  const t = norm(`${said} ${input.narration}`);
  const leaked = p.state.locked.filter((title) => names(t, title));
  if (leaked.length) out.push(`Nombras ${quote(leaked)}, una misión que el actor aún no puede coger: quítala.`);
  if (plan.situation === 'greeting' && p.state.first_meeting && !p.text.asks_work) {
    const offered = p.state.can_offer.filter((title) => names(norm(said), title));
    if (offered.length) out.push(`Es un primer saludo y ${input.npcName} ya suelta ${quote(offered)}: eso, cuando pregunte o venga a cuento.`);
  } else if (plan.situation !== 'offer' && !givesWork(p)) {
    // Capa 4: la misión sale cuando la pide o dice que sí a lo que él dejó caer; madura, solo se insinúa sin título.
    const offered = p.state.can_offer.filter((title) => names(norm(said), title));
    if (offered.length) out.push(`${input.npcName} suelta ${quote(offered)} sin que el actor la pida: como mucho la deja caer, sin título, y espera a que muestre interés.`);
  }
  const ns = norm(said);
  // Capa 2: si sabe de él, no le pregunta quién es; si no sabe su nombre, no lo usa; y no se contradice.
  if (p.state.knows && p.state.knows !== 'none' && WHO_ARE_YOU.test(ns)) {
    out.push(`${input.npcName} le pregunta quién es, pero ya sabe de él (${KNOWS_ES[p.state.knows]}${p.state.heard_of ? `: ${p.state.heard_of}` : ''}): que le trate por lo que sabe.`);
  }
  if ((p.state.knows_pc_name || p.state.heard_of) && p.text.identity && DOESNT_KNOW.test(ns)) {
    out.push(`${input.npcName} dice que no le conoce, pero sí sabe de él: que lo diga claro.`);
  }
  const pcFirst = p.pc_name?.split(/\s+/)[0];
  if (pcFirst && p.state.knows_pc_name === false && !p.text.introduces && names(ns, pcFirst)) {
    out.push(`${input.npcName} le llama ${pcFirst}, pero no sabe su nombre: que no lo use.`);
  }
  // Contestar a algo que el actor no ha dicho («Ya que lo preguntas», partida «Humo y ceniza»).
  if (!p.text.question && !p.text.asks_work && !p.text.request && !p.text.affirmative && PRESUMES.test(ns)) {
    out.push(`${input.npcName} contesta a algo que el actor no ha preguntado: responde a lo que ha dicho de verdad.`);
  }
  // Lo público y lo suyo con el actor no se niegan: lo que pregunta es dónde está alguien, o su trato con él.
  const asksTerms = Boolean(p.state.terms) && (p.text.asks_work || p.text.request || p.text.question || plan.situation === 'offer');
  const asksPublic = p.topics.some((x) => x.kind === 'person' || x.kind === 'place') && (p.text.question || plan.situation === 'lore');
  // Insultado, atacado o ya hostil, puede cerrarse en banda: la escalada (insulto, hostigar, amenaza, pelea) sigue su curso.
  const calm = plan.situation !== 'danger' && plan.situation !== 'reaction' && p.state.tier !== 'hostile';
  if (calm && (asksTerms || asksPublic) && REFUSES.test(ns)) {
    out.push(`${input.npcName} se niega a contar algo público${asksTerms ? ' o su trato con el actor («Lo suyo con el actor»)' : ''}: eso se dice, aunque sea seco. Contesta.`);
  } else if (calm && LADDER.includes(plan.situation) && p.state.way_out.length && REFUSES.test(ns) && !leavesWayOut(ns, p.state)) {
    out.push(`${input.npcName} se niega sin dejar salida: que diga qué haría falta, sin contar el secreto (${waysText(p.state)}).`);
  }
  if (!p.state.new_talk && WHY_AGAIN.test(ns)) out.push(`${input.npcName} ya le preguntó para qué lo quiere: no lo repitas, contesta.`);
  const max = planWords(plan);
  const n = words(said);
  if (n > max + WORDS_MARGIN) out.push(`${input.npcName} dice ${n} palabras y el guion pide ${max} como mucho: recórtalo.`);
  return out;
}

/** ¿El NPC contesta como si le hubieran preguntado algo («ya que lo preguntas»)? Para la línea del actor inventada (tools.ts). */
export function npcPresumes(lines: readonly DialogueLine[], npcId: Id): boolean {
  return PRESUMES.test(norm(lines.filter((l) => l.speaker === 'npc' && (!l.npc_id || l.npc_id === npcId)).map((l) => l.text).join(' ')));
}
