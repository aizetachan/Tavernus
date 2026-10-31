/**
 * Cómo responde un NPC en un turno de charla (docs/CONVERSACION-REGLAS.md).
 * Antes de llamar a la IA, el motor decide en qué situación está la charla y
 * qué tiene que hacer el NPC, con reglas fijas:
 *
 *   1. señales: del estado (primer encuentro, trato, reputación, crimen, lo que
 *      acaba de hacer el PJ, misiones que puede dar o tiene en curso) y del
 *      texto del jugador (saludo, pregunta, lore, comercio…), heurísticas;
 *   2. situación: la primera que se cumple por prioridad, y una secundaria;
 *   3. guion: pasos en orden, lo prohibido y la longitud, según el trato.
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
import { npcCrimeLine } from './crime.js';
import { opinionOf } from './standing.js';
import { debtLine, openDebts } from './debts.js';
import { descriptorOf } from './narrate.js';
import { transcriptOf } from './conversation.js';
import { rumorsIn } from './rumors.js';
import { activeJobs } from './progress.js';
import { givenQuests, droppedAt } from './quests.js';
import { askedSince, questStatus, storyOf } from './story.js';
import { npcTarget } from './scene.js';

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

/** Una charla de antes es «de hace tiempo» pasadas 12 h de juego. */
const RETURNING_S = 12 * 3600;
/** Lo que el NPC acaba de ver hacer al PJ cuenta durante 15 min de juego. */
const RECENT_S = 15 * 60;
/** Quien da misiones la saca él solo a partir de que le haya contestado estas veces (antes, solo si se lo preguntan). */
const RIPE_TURNS = 2;
/** Líneas de la transcripción que se miran para contar esos turnos. */
const TALK_MEMORY_LINES = 24;

// ---------------------------------------------------------------------------
// 1. Señales
// ---------------------------------------------------------------------------

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Lo que dice el texto del jugador. Heurísticas: valen como pista. */
export interface TextSignals {
  greeting: boolean; farewell: boolean; question: boolean; request: boolean; trade: boolean;
  asks_work: boolean; delivery: boolean; hostile: boolean; lore_word: boolean;
}

const RE = {
  greeting: /\b(hola|buenas|buenos dias|saludos|que tal|ey|saludo|saludar|saludarle|saludarla)\b/,
  farewell: /\b(adios|hasta luego|hasta manana|hasta otra|hasta pronto|nos vemos|me voy|me marcho|cuidate|me despido|despedirme)\b/,
  question: /\b(pregunto|preguntar|preguntarle|le pregunto|sabes|sabe usted|conoces|has visto|has oido)\b/,
  request: /\b(necesito|me das|me dejas|me prestas|ayudame|puedes|podrias|quiero)\b/,
  trade: /\b(compr\w*|vend\w*|precio|cuanto (cuesta|vale|cobras|pides|es)|cuesta|me pones|ponme|pagar)\b/,
  asks_work: /\b(trabajo|encargo|recado|faena|tarea|necesitas (algo|ayuda)|en que (puedo|te puedo) ayudar|puedo ayudar|te ayudo|ayudarte|ayudarle|algo que hacer|que te (pasa|preocupa|ocurre)|que le (pasa|preocupa|ocurre)|algun problema)\b/,
  delivery: /\b(traigo|aqui tienes|aqui esta|toma|ya esta hecho|lo tengo|la tengo|he encontrado|lo he hecho|cumplido|entrego|vengo a cobrar)\b/,
  hostile: /\b(amenaz\w*|te mato|te voy a matar|cabron\w*|imbecil|idiota|estupid\w*|callate|maldit\w*|escoria|basura|inutil)\b/,
  lore_word: /\b(historia|leyenda|que se cuenta|que se dice|que paso|antiguamente|origen|cuentame|cuentanos)\b/,
};

export function textSignals(text: string): TextSignals {
  const t = norm(text);
  return {
    greeting: RE.greeting.test(t), farewell: RE.farewell.test(t),
    question: /[?¿]/.test(text) || RE.question.test(t), request: RE.request.test(t), trade: RE.trade.test(t),
    asks_work: RE.asks_work.test(t), delivery: RE.delivery.test(t), hostile: RE.hostile.test(t), lore_word: RE.lore_word.test(t),
  };
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
}

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
  // Turnos en que ya le ha contestado; lo hablado en otro momento (su memoria) también cuenta como charla previa.
  const answers = new Set(transcriptOf(events, pc.id, npc.id, TALK_MEMORY_LINES).filter((l) => l.who === 'npc').map((l) => l.game_s)).size;
  const talked = answers >= RIPE_TURNS || mem.some((m) => nowG - m.game_s > RECENT_S);
  const ripe = can_offer.length > 0 && talked && tier !== 'hostile' && tier !== 'wary' && !askedSince(world, pc, npc, nowG - RECENT_S);
  return {
    first_meeting: !said.length && !mem.length,
    returning: last > -Infinity && nowG - last > RETURNING_S,
    knows_name: pc.knows.includes(npc.id),
    tier,
    opinion: opinionOf(npc, pc.id),
    crime: npcCrimeLine(world, npc, pc, nowG) !== null,
    recent: recentDeed(events, pc, npc, nowG),
    busy: Boolean(npc.talking_to && npc.talking_to.character_id !== pc.id),
    can_offer, ripe, pending, locked,
    debt: openDebts(pc).some((d) => d.npc_id === npc.id || d.on_behalf_of === npc.id),
    trades: npc.sells.length > 0 || npc.buys.length > 0,
    terms: termsWith(world, pc, npc, nowG),
    new_talk: !said.length || nowG - said.at(-1)!.game_s > RECENT_S,
  };
}

// ---------------------------------------------------------------------------
// 2. Situación
// ---------------------------------------------------------------------------

/** Situaciones que se cumplen, por prioridad (docs/CONVERSACION-REGLAS.md, §2). */
export function situationsFor(st: TalkState, tx: TextSignals, topics: readonly TalkTopic[]): TalkSituation[] {
  const asks = tx.question || tx.request || tx.trade || topics.length > 0;
  const out: TalkSituation[] = [];
  if (st.crime || st.recent === 'attack') out.push('danger');
  if (st.recent === 'gift' || tx.hostile) out.push('reaction');
  if (st.tier === 'hostile' || st.tier === 'wary') out.push('cold');
  if (st.pending.length && (tx.delivery || !asks)) out.push('errand');
  if (tx.trade && st.trades) out.push('trade');
  const gives = st.can_offer.length > 0 || Boolean(st.terms);
  if (tx.asks_work && gives) out.push('offer');
  if (topics.length && (tx.question || tx.lore_word)) out.push('lore');
  if (tx.question || tx.request || (tx.asks_work && !gives)) out.push('question');
  // Llevan un rato hablando: lo saca él, si no se está despidiendo ni comprando.
  if (st.ripe && !tx.farewell && !tx.trade && !out.includes('offer')) out.push('offer');
  if (tx.greeting) out.push('greeting');
  if (tx.farewell) out.push('farewell');
  if (!out.length) out.push('chat');
  return out;
}

/** ¿Es este turno pedirle ya una misión? Sí, si ha llegado a eso o lo declara el máster con la charla empezada. */
export function offersNow(p: TalkPlan, declared: unknown): boolean {
  return p.situation === 'offer' || p.second === 'offer' || (declared === 'offer' && !p.state.first_meeting && p.state.can_offer.length > 0);
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
}

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

/** El plan del turno, o null si no es una charla con un NPC. */
export function talkPlan(world: World, events: readonly GameEvent[], pc: Character, text: string, nowG: number): TalkPlan | null {
  const npc = talkTarget(world, events, pc, text, nowG);
  if (!npc || npc.status !== 'alive' || npc.mute) return null;
  const state = talkState(world, events, pc, npc, nowG);
  const tx = textSignals(text);
  const topics = loreTopics(world, npc, text, nowG);
  const all = situationsFor(state, tx, topics);
  const textual = Object.values(tx).some(Boolean) || topics.length > 0;
  return { npc_id: npc.id, situation: all[0]!, second: all[1] ?? null, doubtful: all[0] === 'chat' && !textual, state, text: tx, topics };
}

/** ¿Puede ser esta situación, según el estado? (para la que declare el máster). */
export function situationFits(s: TalkSituation, st: TalkState): string | null {
  if (s === 'danger' && !st.crime && st.recent !== 'attack') return 'no ha visto ningún crimen ni ataque del actor';
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

/** Pasos en orden para una situación, según el trato y la reputación. */
function steps(s: TalkSituation, p: TalkPlan, npcName: string): string[] {
  const st = p.state;
  const tier = st.tier;
  const friendly = tier === 'friend' || tier === 'ally';
  switch (s) {
    case 'danger': return [
      'Lo primero es lo que sabe o acaba de ver (ver «LO PRIMERO» en su línea, o el ataque): miedo, rabia, huir, llamar a alguien o plantarse, según quién es.',
      'Nada de charla normal ni de atenderle como a un cliente.',
    ];
    case 'reaction': return [
      st.recent === 'gift' ? 'Primera frase: reacciona a lo que le ha dado (lo agradece, se extraña, lo rechaza si no lo quiere), según su carácter.'
        : 'Primera frase: reacciona al insulto o la amenaza (se ofende, se asusta, se planta o le echa), según su carácter.',
      'Si queda sitio, contesta a lo que le haya pedido.',
      st.recent === 'gift' ? 'Si el regalo le importa, súbele la confianza (npc_trust).' : 'Bájale la confianza (npc_trust); si va a más, puede cortar la charla.',
    ];
    case 'cold': return tier === 'hostile'
      ? ['Corto, frío o amenazante. No da nada gratis.', 'Puede cortar la charla o echarle.']
      : [
        'Lo mínimo, en frases completas. Lo público (dónde vive o trabaja alguien, precios, lo suyo con el actor) lo contesta, seco, pero lo contesta.',
        st.new_talk ? 'Pregunta qué quiere y por qué.' : 'No le vuelvas a preguntar para qué lo quiere: eso ya está preguntado.',
      ];
    case 'errand': return [
      p.text.delivery ? `Si trae lo que pidió (${quote(st.pending)}), lo reconoce y cierra la entrega con su tool (story_quest turn_in, complete_job o finish_quest); si no lo trae, se lo dice.`
        : `Pregunta cómo va ${quote(st.pending)}${friendly ? ', y se nota que le importa' : ''}.`,
      friendly ? 'Agradece o se preocupa, con su carácter.' : 'Sin rodeos: lo suyo es que se haga.',
    ];
    case 'trade': return [
      'Primera frase: el precio exacto de su lista (Vende/Compra en su línea).',
      'Regatear solo con tirada de Persuasión. Un trato no está cerrado sin buy_item o sell_item.',
    ];
    case 'offer': return !st.can_offer.length ? [
      'Lo que tiene para él es su trato («Lo suyo con el actor»): qué tiene que hacer, dónde y para quién, dicho claro y a su manera. Nada de «no lo cuento» ni «lo decide otro»: es suyo y el actor ya lo sabe.',
      'Lo que gana si lo hace y lo que pasa si no. No es un encargo nuevo: ya está en su Diario, así que nada de give_quest ni story_quest para esto.',
    ] : [
      `Lo que puede darle: ${quote(st.can_offer)}. Cuenta el problema como lo cuenta él: qué le pasa y qué se juega.`,
      'Por qué no lo hace él.',
      'La recompensa, si la hay. Regístralo en este mismo turno (story_quest ask o give_quest).',
    ];
    case 'lore': return [
      `Lo que sabe todo el mundo: ${p.topics.map((t) => `${t.name} (${t.known})`).join('; ')}.`,
      'Su opinión o su miedo sobre eso.',
      tier === 'stranger' ? 'Lo delicado, no: a un forastero no se le cuenta.' : 'Lo delicado, solo lo que su trato permite (lo que «contaría a este nivel» en su línea).',
    ];
    case 'question': return [
      'Primera frase: contesta (sí, no o no lo sé; «eso no te lo digo», solo para lo delicado, nunca para lo público).',
      tier === 'stranger' ? 'Si lo sabe y es delicado, lo esquiva («eso no se le cuenta a un forastero»).'
        : tier === 'acquaintance' ? 'Si lo sabe y es delicado, pide un motivo o algo a cambio.'
          : 'Si lo sabe, lo cuenta con su opinión; lo que no le toca contar, a medias.',
      'Si no lo sabe, lo dice y, si alguien de aquí lo sabe, dice a quién preguntar.',
    ];
    case 'greeting': return st.first_meeting ? [
      'Devuelve el saludo según su carácter.',
      'Se presenta si su oficio lo pide (quien atiende un negocio) o si es amable; si no, no.',
      'Pregunta quién es o qué le trae.',
    ] : [
      st.knows_name || friendly ? `Le saluda${st.returning ? ' notando que hacía tiempo' : ''}, por su nombre si lo sabe.` : `Devuelve el saludo${st.returning ? ' notando que hacía tiempo' : ''}, sin presentarse otra vez.`,
      tier === 'stranger' ? 'Pregunta qué le trae.' : 'Recuerda lo último que hablaron (Recuerda de… en su línea) y le pregunta por ello.',
      friendly ? `Saca él un tema: ${st.pending.length ? `cómo va ${quote(st.pending)}` : 'algo de lo que le ronda hoy'}.` : '',
    ].filter(Boolean);
    case 'farewell': return [
      'Una frase de despedida, con su carácter.',
      st.debt ? 'Le recuerda lo que le debe.' : st.pending.length ? `Puede recordarle ${quote(st.pending)}.` : '',
    ].filter(Boolean);
    case 'chat': return [
      'Saca UN tema suyo de lo que le ronda hoy (su agenda, lo que ha visto, su gente, lo que se dice), el más fuerte.',
      tier === 'stranger' ? 'Tantea: pregunta de dónde viene o qué busca.' : 'Le pregunta algo a él.',
      st.can_offer.length && tier !== 'stranger' ? `Si viene a cuento, puede insinuar ${quote(st.can_offer)}.` : '',
    ].filter(Boolean);
  }
}

/** Lo prohibido en una situación. */
function forbidden(s: TalkSituation, p: TalkPlan): string[] {
  const st = p.state;
  const out = ['Inventar hechos (objetos, lugares, gente, precios, pistas) que no estén en el contexto.'];
  if (st.locked.length) out.push(`Nombrar o insinuar misiones que el actor aún no puede coger: ${quote(st.locked)}.`);
  if (s === 'greeting' && st.first_meeting) out.push('Encargos, historia del lugar, secretos o su vida entera: es un saludo.');
  if (st.can_offer.length && s !== 'offer' && p.second !== 'offer') out.push(`Pedirle ${quote(st.can_offer)} todavía: la charla aún no da para ello.`);
  if (s === 'question' || s === 'lore') out.push('Dejar la pregunta sin contestar o contestar otra cosa.');
  if (s === 'lore') out.push('Recitar como un libro.');
  if (s === 'offer') out.push('Listar condiciones o preguntar «¿aceptas?».');
  if (s === 'trade') out.push('Dar por cerrado un trato sin buy_item o sell_item.');
  if (s === 'cold') out.push('Lo delicado (secretos, lo que su trato no da). Negar lo público o lo suyo con el actor.');
  if (!st.new_talk) out.push('Volver a preguntarle para qué lo quiere.');
  return out;
}

/** Palabras como mucho de lo que dice el NPC con este plan. */
export function planWords(p: { situation: TalkSituation; second: TalkSituation | null }): number {
  return SITUATION_WORDS[p.situation] + (p.second ? SECOND_WORDS : 0);
}

/** El bloque del contexto del máster. */
export function talkScript(world: World, pc: Character, p: TalkPlan): string {
  const npc = world.npc(p.npc_id);
  const st = p.state;
  const name = pc.knows.includes(npc.id) ? npc.name : `el NPC [${npc.id}]`;
  const who = [
    st.first_meeting ? 'primera vez que hablan' : st.returning ? 'ya se conocen, pero hace tiempo que no hablan' : 'ya han hablado',
    `trato ${TALK_TIER_LABEL[st.tier]}`,
    st.opinion ? `opinión ${st.opinion > 0 ? '+' : ''}${st.opinion}` : '',
    st.busy ? 'OCUPADO con otro: lo dice y atiende a medias o le pide que espere, salvo peligro' : '',
  ].filter(Boolean).join('; ');
  const second = p.second ? steps(p.second, p, name).slice(0, 2) : [];
  return [
    `## Cómo responde ${name} en este turno (situación: ${p.situation})`,
    `Situación: ${SITUATION_ES[p.situation]}${p.second ? `; además, ${SITUATION_ES[p.second]}` : ''}. ${who[0]!.toUpperCase()}${who.slice(1)}.`,
    st.terms ? `Lo suyo con el actor (el actor ya lo sabe; si pregunta por ello, lo dice claro; ya está en su Diario, no es un encargo nuevo): ${st.terms}` : '',
    'Lo público no se niega nunca: dónde vive o trabaja alguien del sitio, precios y horarios, y lo suyo con el actor. Lo delicado son los secretos y lo que su trato no da.',
    'Este guion manda sobre las reglas generales de conversación. Pasos, en orden:',
    ...steps(p.situation, p, name).map((x, i) => `${i + 1}. ${x}`),
    ...(second.length ? [`Después, si cabe (${SITUATION_ES[p.second!]}):`, ...second.map((x) => `- ${x}`)] : []),
    `Prohibido: ${forbidden(p.situation, p).join(' ')}`,
    `Longitud: lo que dice, ${planWords(p)} palabras como mucho, en lines.`,
    p.doubtful ? `Si el jugador busca otra cosa (${TALK_SITUATIONS.filter((x) => x !== 'chat').join(', ')}), pon esa en talk_situation de log_event y responde con su regla; si no, talk_situation null.` : 'talk_situation de log_event: null.',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// 4. Control al cierre
// ---------------------------------------------------------------------------

const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;

/** Negarse a contar («eso no te lo digo», «no lo cuento en una mesa»). Sobre texto normalizado. */
const REFUSES = /\b(no te lo (digo|cuento|voy a decir|repito)|eso no (te lo digo|se dice|se cuenta|te importa|es asunto tuyo)|no lo cuento|no es asunto tuyo|no te incumbe)\b/;
/** Volver a preguntar para qué lo quiere. */
const WHY_AGAIN = /\b(para que (lo )?(quieres|preguntas)|por que (lo )?(quieres saber|preguntas)|y tu (para|por) que)\b/;

/**
 * Lo que el cierre incumple del plan, o []. `declared`: la situación que pone
 * el máster en log_event (null si ninguna). `pendingRoll`: pide tirada, así que
 * la respuesta llega después.
 */
export function talkProblems(p: TalkPlan, input: { lines: readonly DialogueLine[]; narration: string; declared: string | null; pendingRoll: boolean; npcName: string }): string[] {
  const out: string[] = [];
  let plan: { situation: TalkSituation; second: TalkSituation | null } = p;
  if (input.declared && input.declared !== p.situation) {
    const d = TALK_SITUATIONS.find((x) => x === input.declared);
    if (!d) return [`talk_situation «${input.declared}» no existe: usa ${TALK_SITUATIONS.join(', ')} o null.`];
    const why = situationFits(d, p.state);
    if (why) return [`talk_situation «${d}» no encaja: ${why}. Responde con la regla de «${p.situation}» y talk_situation null.`];
    plan = { situation: d, second: null };
  }
  if (input.pendingRoll) return out;
  const said = input.lines.filter((l) => l.speaker === 'npc' && (!l.npc_id || l.npc_id === p.npc_id)).map((l) => l.text).join(' ');
  const answers: TalkSituation[] = ['question', 'lore', 'offer', 'trade', 'errand', 'greeting'];
  if (answers.includes(plan.situation) && !said.trim()) out.push(`${input.npcName} no dice nada y le toca contestar (${SITUATION_ES[plan.situation]}): pon su respuesta en lines.`);
  const t = norm(`${said} ${input.narration}`);
  const leaked = p.state.locked.filter((title) => names(t, title));
  if (leaked.length) out.push(`Nombras ${quote(leaked)}, una misión que el actor aún no puede coger: quítala.`);
  if (plan.situation === 'greeting' && p.state.first_meeting && !p.text.asks_work) {
    const offered = p.state.can_offer.filter((title) => names(norm(said), title));
    if (offered.length) out.push(`Es un primer saludo y ${input.npcName} ya suelta ${quote(offered)}: eso, cuando pregunte o venga a cuento.`);
  }
  const ns = norm(said);
  // Lo público y lo suyo con el actor no se niegan: lo que pregunta es dónde está alguien, o su trato con él.
  const asksTerms = Boolean(p.state.terms) && (p.text.asks_work || p.text.request || p.text.question || plan.situation === 'offer');
  const asksPublic = p.topics.some((x) => x.kind === 'person' || x.kind === 'place') && (p.text.question || plan.situation === 'lore');
  // Insultado, atacado o ya hostil, puede cerrarse en banda: la escalada (insulto, hostigar, amenaza, pelea) sigue su curso.
  const calm = plan.situation !== 'danger' && plan.situation !== 'reaction' && p.state.tier !== 'hostile';
  if (calm && (asksTerms || asksPublic) && REFUSES.test(ns)) {
    out.push(`${input.npcName} se niega a contar algo público${asksTerms ? ' o su trato con el actor («Lo suyo con el actor»)' : ''}: eso se dice, aunque sea seco. Contesta.`);
  }
  if (!p.state.new_talk && WHY_AGAIN.test(ns)) out.push(`${input.npcName} ya le preguntó para qué lo quiere: no lo repitas, contesta.`);
  const max = planWords(plan);
  const n = words(said);
  if (n > max + 10) out.push(`${input.npcName} dice ${n} palabras y el guion pide ${max} como mucho: recórtalo.`);
  return out;
}
