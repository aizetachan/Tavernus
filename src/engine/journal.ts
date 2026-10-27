/**
 * Diario del personaje (como el de Neverwinter Nights u Oblivion): una vista
 * derivada de lo que el motor ya guarda, sin IA y sin estado propio. Lo que
 * sale de aquí se pinta en la pestaña «Diario» de la web y vale para cualquier
 * cliente.
 *
 *   - Misiones: los encargos del tablón que el PJ ha visto o aceptado (con su
 *     estado), su situación inicial como misión principal (con el reloj), el
 *     logro con las pistas como objetivos y los rumores vigentes como «se dice».
 *     Las deudas con NPCs (debts.ts), con su plazo y su prenda, también son
 *     misiones: saldarlas es el objetivo.
 *     Lo que ha cambiado más recientemente va primero; las completadas, aparte.
 *   - Conversaciones: por NPC, cada intercambio sacado de los eventos con
 *     `payload.lines` (fecha, dónde, qué dijo el jugador y qué respondió), más
 *     lo que ese NPC recuerda del PJ (`npc.memory`).
 *   - Crónica: resumen por día de juego, por plantilla, del log de eventos.
 *     El prólogo (prologue.ts) abre la del primer día como entrada `chapter`.
 *   - Lugares: localizaciones conocidas con su estado de descubrimiento.
 *
 * Qué encargos ha «visto» el PJ: los que leyó en el tablón (quests.ts,
 * `boardSeen`: de pie ante él o con /tablon) y los que habló con quien los
 * pide. Que estén clavados en la plaza no basta.
 *
 * Cada misión dice de dónde le vino (`origin`: te lo pide X, de oídas, el
 * tablón, por tu cuenta) y qué ha cambiado y por qué (`history`: alta, pasos,
 * cierre), para que el jugador no tenga que adivinarlo. El historial de la
 * historia escrita sale de `character.story.log` (story.ts); el de lo demás,
 * de los eventos y del estado del PJ.
 */

import { GAME_DAY } from '../clock/clock.js';
import type { Engine } from './engine.js';
import { characterFacts } from './facts.js';
import { debtLine } from './debts.js';
import { money } from './money.js';
import type { Character, GameEvent, Id, Npc } from './model.js';
import type { DialogueLine } from './moments.js';
import { maskUnknownNames } from './narrate.js';
import { activeJobs } from './progress.js';
import { rumorsHeardBy, rumorsIn, type Rumor } from './rumors.js';
import { characterStory, questsOf } from './story.js';
import { boardSeen, droppedAt, givenQuests } from './quests.js';

export type QuestStatus = 'available' | 'active' | 'completed' | 'expired';

export interface JournalStep { text: string; done: boolean }

/** De dónde le vino la misión al PJ. */
export interface JournalOrigin {
  kind: 'giver' | 'heard' | 'board' | 'self';
  /** «Te lo pide Ilse», «En el Jabalí se comenta que…», «Aviso del tablón»… */
  text: string;
  /** Dónde estaba (si se sabe). */
  where: string | null;
}

/** Un cambio en una misión: qué pasó, cuándo y por qué. `key` es estable (la web marca lo no leído). */
export interface JournalChange {
  key: string;
  game_s: number;
  when: string;
  /** Corta, para la lista: «18:07» si es hoy; si no, «3 de Brotes, 18:07». */
  short: string;
  kind: 'added' | 'accepted' | 'step' | 'completed' | 'failed' | 'expired' | 'dropped';
  /** Qué pasó: «Nueva misión», «✔ Sacar agua del pozo»… */
  text: string;
  why: string | null;
}

export interface JournalRumor {
  id: Id;
  name: string;
  hint: string;
  where: string | null;
  /** «lo dice Kael» si lo afirmó un PJ; null si es habladuría. */
  said_by: string | null;
  mentions: number;
  when: string;
}

export interface JournalQuest {
  id: Id;
  kind: 'main' | 'job' | 'achievement' | 'debt' | 'story' | 'given';
  /** Se puede dejar desde el Diario (encargos del tablón y misiones dadas, en curso). */
  droppable?: boolean;
  title: string;
  text: string;
  status: QuestStatus;
  /** Quién lo pide (nombre si el PJ lo conoce; si no, su oficio). */
  giver: string | null;
  giver_npc_id: Id | null;
  reward: string | null;
  seen_game_s: number | null;
  seen: string | null;
  completed_game_s: number | null;
  completed: string | null;
  /** Último cambio (lo que ordena la lista). */
  updated_game_s: number;
  updated: string;
  steps: JournalStep[];
  /** Solo la principal: días que quedan y qué pasa si vence. */
  clock: { days_left: number; deadline: string; runs_out: string } | null;
  antagonist: { id: Id; name: string; role: string } | null;
  paths: string[];
  rumors: JournalRumor[];
  /** La principal va siempre arriba. */
  pinned: boolean;
  /** De dónde le vino (null en la principal y en el logro, que son del PJ desde el principio). */
  origin: JournalOrigin | null;
  /** Qué ha cambiado y por qué, del más antiguo al más reciente. */
  history: JournalChange[];
  /**
   * Resumen para el jugador, sin datos ocultos: de qué va (una frase), qué toca
   * ahora (el primer objetivo pendiente) y lo último relevante que le han dicho
   * (frases de quien la pide o que hablan de lo mismo). Lo pinta el Diario y el
   * recuadro de seguimiento del panel.
   */
  summary: { text: string; next: string | null; told: { who: string; said: string; when: string }[] };
}

export interface JournalExchange {
  seq: number;
  game_s: number;
  when: string;
  location_id: Id;
  location: string;
  /** Lo que dijo o hizo el jugador. */
  said: string[];
  /** Lo que respondió el NPC. */
  replied: string[];
}

export interface JournalConversation {
  npc_id: Id;
  name: string;
  role: string;
  known: boolean;
  exchanges: JournalExchange[];
  memory: { when: string; note: string }[];
  last_game_s: number;
}

export type ChronicleKind = 'chapter' | 'place' | 'person' | 'item' | 'roll' | 'combat' | 'progress' | 'rumor' | 'travel' | 'board' | 'note';

export interface ChronicleEntry { game_s: number; time: string; kind: ChronicleKind; text: string }

export interface ChronicleDay {
  day_index: number;
  label: string;
  summary: string;
  entries: ChronicleEntry[];
}

export interface JournalPlace {
  id: Id;
  name: string;
  zone: string;
  status: 'visited' | 'heard_of';
  here: boolean;
  first_visit: string | null;
}

export interface Journal {
  character: { id: Id; name: string };
  now: string;
  /** Cambia cuando hay algo nuevo que leer (para el indicador de novedad). */
  version: string;
  quests: { active: JournalQuest[]; completed: JournalQuest[] };
  rumors: JournalRumor[];
  conversations: JournalConversation[];
  chronicle: ChronicleDay[];
  places: JournalPlace[];
}

const STOP = new Set(['para', 'como', 'desde', 'hasta', 'hacia', 'entre', 'sobre', 'sin', 'con', 'una', 'unos', 'unas', 'del', 'los', 'las', 'que', 'por', 'pero', 'cada', 'este', 'esta', 'esto', 'tras', 'ante', 'antes', 'donde', 'quien', 'quién', 'algo', 'nada', 'nadie', 'alguien', 'todo', 'toda', 'más', 'menos', 'otro', 'otra']);
const DAY_S = GAME_DAY;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Palabras con peso de un texto, sin tildes ni plurales simples, para casar textos entre sí. */
function keywords(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(s).match(/[a-zñ]{4,}/g) ?? []) {
    if (STOP.has(w)) continue;
    out.add(w.replace(/(es|s)$/, '').slice(0, 6));
  }
  return out;
}
function shares(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

const EMPTY_SUMMARY = (): JournalQuest['summary'] => ({ text: '', next: null, told: [] });

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
/** «a» + nombre de sitio, con contracción: «al arroyo», «a la fragua». */
function aPlace(name: string): string { return /^el /i.test(name) ? `al ${name.slice(3)}` : `a ${name}`; }
function firstSentence(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = /^(.{12,}?[.!?…])(\s|$)/.exec(t);
  return (m ? m[1]! : t).slice(0, 160);
}

/**
 * Nombre con que el PJ conoce a un NPC, para ir dentro de una frase: el suyo
 * si lo sabe y, si no, su oficio con artículo («te lo pide la tabernera», no
 * «Tabernera»). Suelto, como etiqueta, va con `cap`.
 */
export function npcLabel(c: Character, npc: Npc): string {
  if (c.knows.includes(npc.id)) return npc.name;
  return /^(el|la|los|las) /i.test(npc.role) ? npc.role : /a$/.test(npc.role) ? `la ${npc.role}` : `el ${npc.role}`;
}

/** Etiqueta suelta (lista de conversaciones, «lo pide»): el nombre o el oficio con mayúscula, sin artículo. */
export function npcTag(c: Character, npc: Npc): string {
  return c.knows.includes(npc.id) ? npc.name : cap(npc.role);
}

/** Texto de un evento tal como lo leyó el actor, con sus parlamentos. */
function eventText(e: GameEvent): string {
  const lines = Array.isArray(e.payload['lines']) ? (e.payload['lines'] as DialogueLine[]).map((l) => l.text) : [];
  return [e.input_text ?? '', e.narration_private, ...lines].join('\n');
}


export function journalOf(engine: Engine, characterId: Id): Journal {
  const w = engine.world;
  const c = w.character(characterId);
  const clock = engine.clock;
  const nowS = engine.nowFor(c);
  const fmt = (s: number) => clock.format(s);
  const dayLabel = (s: number) => { const d = clock.dateTime(s); return `${d.weekday} ${d.day_of_month} de ${d.month}, año ${d.year}`; };
  const hhmm = (s: number) => { const d = clock.dateTime(s); return `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`; };

  const all = engine.events.all();
  /** Un texto escrito para cualquiera, con los nombres que este PJ no sabe cambiados por cómo los ve (y la mayúscula de cada frase). */
  const masked = (t: string) => maskUnknownNames(w, c.id, t).replace(/(^|[.!?…]\s+)(\p{Ll})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
  /** Lo que el PJ percibió o hizo, en orden. */
  const mine = all.filter((e) => e.actor_id === c.id || e.delivered_to.some((d) => d.character_id === c.id));
  const born = mine[0]?.timestamp_game_s ?? nowS;
  const maxSeq = mine.at(-1)?.seq ?? 0;

  // --- Misiones --------------------------------------------------------------
  const jobs = w.campaign.jobs;
  const onBoard = new Set(activeJobs(w).map((j) => j.id));
  /** Leídos en el tablón (de pie ante él o con /tablon), con la hora de la primera vez. */
  const seenAt = new Map<Id, number>(Object.entries(boardSeen(c)));
  const locName = (id: Id | null | undefined) => (id ? w.locations.get(id)?.name ?? null : null);

  const completedAt = new Map<Id, number>();
  for (const e of mine) {
    if (e.action_type !== 'progress_job' || e.actor_id !== c.id) continue;
    const j = jobs.find((x) => e.narration_private.includes(x.title) && !completedAt.has(x.id));
    if (j) completedAt.set(j.id, e.timestamp_game_s);
  }

  /**
   * Cuándo se metió en un encargo: basta hablar de él con quien lo pide, sin
   * decir «acepto» (quests.ts). Si lo dejó desde el Diario, solo cuenta lo que
   * hable después.
   */
  const engagedAt = new Map<Id, number>();
  /** La primera vez que lo habló con quien lo pide, aunque luego lo dejara: desde entonces lo conoce. */
  const toldAt = new Map<Id, number>();
  for (const e of mine) {
    if (e.actor_id !== c.id || !/^master/.test(e.action_type)) continue;
    const kw = keywords(eventText(e));
    for (const j of jobs) {
      if (engagedAt.has(j.id) || (!seenAt.has(j.id) && !onBoard.has(j.id))) continue;
      const giverHere = e.payload['npc_id'] === j.giver_npc_id || (Array.isArray(e.payload['lines']) && (e.payload['lines'] as DialogueLine[]).some((l) => l.npc_id === j.giver_npc_id));
      if (!giverHere || !shares(keywords(j.title), kw)) continue;
      if (!toldAt.has(j.id)) toldAt.set(j.id, e.timestamp_game_s);
      if (e.timestamp_game_s > (droppedAt(c, j.id) ?? -Infinity)) engagedAt.set(j.id, e.timestamp_game_s);
    }
  }

  const carried = (itemId: Id) => w.itemsCarriedBy(c.id).filter((i) => i.item_id === itemId).reduce((a, i) => a + i.quantity, 0);
  const visitedSpots = new Set(mine.filter((e) => e.actor_id === c.id && e.spot_id).map((e) => e.spot_id as Id));
  const rumorsOf = rumorList(w, c, nowS, fmt);
  const linked = new Set<Id>();
  const questRumors = (texts: string[]) => {
    const kw = keywords(texts.join(' '));
    return rumorsOf.filter((r) => { const hit = shares(keywords(`${r.name} ${r.hint} ${r.where ?? ''}`), kw); if (hit) linked.add(r.id); return hit; });
  };

  const quests: JournalQuest[] = [];
  const today = Math.floor(nowS / DAY_S);
  const short = (s: number) => { const d = clock.dateTime(s); return Math.floor(s / DAY_S) === today ? hhmm(s) : `${d.day_of_month} de ${d.month}, ${hhmm(s)}`; };
  const at = (s: number) => ({ game_s: s, when: fmt(s), short: short(s) });
  for (const j of jobs) {
    const done = c.completed_jobs.includes(j.id);
    const engaged = engagedAt.get(j.id) ?? null;
    const seen = seenAt.get(j.id) ?? toldAt.get(j.id) ?? null;
    if (!done && seen === null) continue;
    const completed = done ? completedAt.get(j.id) ?? engaged ?? seen ?? born : null;
    const status: QuestStatus = done ? 'completed' : engaged !== null ? 'active' : onBoard.has(j.id) ? 'available' : 'expired';
    const giver = w.npcs.get(j.giver_npc_id) ?? null;
    const steps: JournalStep[] = [];
    if (j.kind === 'deliver' && j.deliver) {
      const def = w.itemDefs.get(j.deliver.item_id);
      steps.push({ text: `Conseguir ${j.deliver.quantity} × ${def?.name ?? j.deliver.item_id}`, done: done || carried(j.deliver.item_id) >= j.deliver.quantity });
      steps.push({ text: `Entregarlo a ${giver ? npcLabel(c, giver) : 'quien lo pide'}`, done });
    } else if (j.kind === 'visit' && j.visit_spot_id) {
      const sp = w.spots.get(j.visit_spot_id);
      const loc = sp ? w.locations.get(sp.location_id) : undefined;
      steps.push({ text: `Ir ${aPlace(sp?.name ?? j.visit_spot_id)}${loc ? ` (${loc.name})` : ''}`, done: done || visitedSpots.has(j.visit_spot_id) });
      steps.push({ text: `Volver a contárselo a ${giver ? npcLabel(c, giver) : 'quien lo pide'}`, done });
    } else {
      steps.push({ text: `Cumplirlo y decírselo a ${giver ? npcLabel(c, giver) : 'quien lo pide'}`, done });
    }
    const updated = Math.max(seen ?? 0, engaged ?? 0, completed ?? 0, born);
    const who = giver ? npcLabel(c, giver) : 'quien lo pide';
    const history: JournalChange[] = [];
    const fromBoard = seenAt.has(j.id);
    if (seen !== null) history.push({ key: `${j.id}:added`, ...at(seen), kind: 'added', text: fromBoard ? 'Lo lees en el tablón' : 'Te lo cuenta quien lo pide', why: fromBoard ? `aviso del tablón: lo pide ${who}` : `hablaste de ello con ${who}` });
    const told = toldAt.get(j.id) ?? null, left = droppedAt(c, j.id);
    for (const t of [told, engaged]) {
      if (t !== null && !history.some((x) => x.key === `${j.id}:accepted:${t}`)) history.push({ key: `${j.id}:accepted:${t}`, ...at(t), kind: 'accepted', text: 'Te pones con ello', why: `hablaste de ello con ${who}` });
    }
    if (left !== null && told !== null) history.push({ key: `${j.id}:dropped:${left}`, ...at(left), kind: 'dropped', text: 'Lo dejas', why: 'desde el Diario' });
    history.sort((x, y) => x.game_s - y.game_s);
    if (j.kind === 'visit' && j.visit_spot_id) {
      const went = mine.find((e) => e.actor_id === c.id && e.spot_id === j.visit_spot_id && e.timestamp_game_s >= (seen ?? born));
      if (went) history.push({ key: `${j.id}:step:visit`, ...at(went.timestamp_game_s), kind: 'step', text: `✔ ${steps[0]!.text}`, why: `llegaste a ${w.spots.get(j.visit_spot_id)?.name ?? 'el sitio'}` });
    }
    if (completed !== null) history.push({ key: `${j.id}:completed`, ...at(completed), kind: 'completed', text: 'Encargo cumplido', why: `se lo ${j.kind === 'deliver' ? 'entregaste' : 'contaste'} a ${who}` });
    else if (status === 'expired') history.push({ key: `${j.id}:expired`, ...at(Math.max(seen ?? born, engaged ?? born)), kind: 'expired', text: 'Ya no está en el tablón', why: 'el tablón cambió' });
    quests.push({
      id: j.id, kind: 'job', title: j.title, text: masked(j.text), status, droppable: status === 'active',
      origin: fromBoard ? { kind: 'board', text: 'Aviso del tablón', where: null } : { kind: 'giver', text: `Te lo pide ${who}`, where: null }, history,
      giver: giver ? npcTag(c, giver) : null, giver_npc_id: giver?.id ?? null,
      reward: `${money(w, j.reward_coins)}${j.reward_reputation ? ` · +${j.reward_reputation} de reputación` : ''}`,
      seen_game_s: seen, seen: seen === null ? null : fmt(seen),
      completed_game_s: completed, completed: completed === null ? null : fmt(completed),
      updated_game_s: updated, updated: fmt(updated),
      steps, clock: null, antagonist: null, paths: [], rumors: questRumors([j.title, j.text]), pinned: false, summary: EMPTY_SUMMARY(),
    });
  }

  // La situación inicial (mundos generados): la misión principal, con su reloj.
  const s = c.situation;
  if (s) {
    const ant = w.npcs.get(s.antagonist_npc_id);
    const deadline = s.deadline_game_s ?? born + s.clock_days * DAY_S;
    const left = Math.ceil((deadline - nowS) / DAY_S);
    const expired = nowS >= deadline;
    quests.push({
      id: 'main', kind: 'main', title: 'Lo que te trae aquí', text: s.why_here, status: expired ? 'expired' : 'active', origin: null,
      history: [{ key: 'main:added', ...at(born), kind: 'added', text: 'Llegas con esto entre manos', why: null }],
      giver: null, giver_npc_id: null, reward: null,
      seen_game_s: born, seen: fmt(born), completed_game_s: null, completed: null,
      updated_game_s: born, updated: fmt(born),
      steps: [{ text: s.wants, done: false }],
      clock: { days_left: Math.max(0, left), deadline: fmt(deadline), runs_out: s.clock_runs_out },
      antagonist: ant && c.knows.includes(ant.id) ? { id: ant.id, name: ant.name, role: ant.role } : null,
      paths: [...s.paths], rumors: questRumors([s.why_here, s.wants, s.threat, ...s.paths]), pinned: true, summary: EMPTY_SUMMARY(),
    });
  }

  // El logro de la campaña: las pistas obtenidas son sus objetivos.
  const a = w.campaign.achievement;
  if (a && w.campaign.clues.length) {
    const got = c.achievements.find((x) => x.id === a.id);
    const faction = w.campaign.factions.find((f) => f.id === a.faction_id)?.name ?? a.faction_id;
    const rep = c.reputation[a.faction_id] ?? 0;
    const clueEvents = mine.filter((e) => e.action_type === 'progress_clue' && e.actor_id === c.id);
    const clueTimes = clueEvents.map((e) => e.timestamp_game_s);
    const achTime = mine.find((e) => e.action_type === 'progress_achievement' && e.actor_id === c.id)?.timestamp_game_s ?? null;
    const steps: JournalStep[] = c.clues.map((id) => ({ text: `Pista: ${w.campaign.clues.find((x) => x.id === id)?.title ?? id}`, done: true }));
    const missing = Math.max(0, a.clues_required - c.clues.length);
    if (missing > 0) steps.push({ text: `${missing} pista${missing === 1 ? '' : 's'} más por descubrir`, done: false });
    steps.push({ text: `Reputación en ${faction}: ${rep} de ${a.reputation_required}`, done: rep >= a.reputation_required });
    const updated = Math.max(born, ...clueTimes, achTime ?? 0);
    const achHistory: JournalChange[] = clueEvents.map((e, i) => ({ key: `${a.id}:clue:${e.seq}`, ...at(e.timestamp_game_s), kind: 'step' as const, text: `✔ ${e.narration_private.replace(/\s*\(\d+\/\d+\).*$/, '').replace(/[.]$/, '')}`, why: i === 0 ? 'cada pista cuenta para el logro' : null }));
    if (got) achHistory.push({ key: `${a.id}:completed`, ...at(achTime ?? updated), kind: 'completed', text: 'Logro conseguido', why: `${a.clues_required} pistas y reputación ${a.reputation_required} en ${faction}` });
    quests.push({
      id: a.id, kind: 'achievement', title: a.title, text: `Lo que se cuenta de quien lo consigue, en ${faction}.`, status: got ? 'completed' : c.clues.length ? 'active' : 'available',
      origin: null, history: achHistory,
      giver: null, giver_npc_id: null, reward: null,
      seen_game_s: born, seen: fmt(born), completed_game_s: got ? achTime ?? updated : null, completed: got ? fmt(achTime ?? updated) : null,
      updated_game_s: updated, updated: fmt(updated),
      steps, clock: null, antagonist: null, paths: [], rumors: [], pinned: false, summary: EMPTY_SUMMARY(),
    });
  }

  // Deudas: abiertas con su plazo y su prenda; las saldadas, como completadas.
  for (const d of c.debts ?? []) {
    const npc = w.npcs.get(d.npc_id);
    const who = npc ? npcLabel(c, npc) : d.npc_id;
    const pawn = d.collateral_instance_id ? w.itemInstances.get(d.collateral_instance_id) : undefined;
    const pawnName = pawn ? w.itemDef(pawn.item_id).name : null;
    const settled = d.settled ?? null;
    const steps: JournalStep[] = settled
      ? [{ text: settled.how === 'coins' ? 'Pagada' : settled.how === 'work' ? 'Saldada con trabajo' : `Perdida: ${who} se quedó ${pawnName ?? 'la prenda'}`, done: true }]
      : [{ text: `Pagar ${money(w, d.amount)} a ${who} (o saldarla de otro modo)`, done: false }, ...(pawnName ? [{ text: `Recuperar la prenda: ${pawnName}`, done: false }] : [])];
    const updated = Math.max(d.created_game_s, settled?.game_s ?? 0);
    const left = d.due_game_s === null ? null : Math.ceil((d.due_game_s - nowS) / DAY_S);
    const debtHistory: JournalChange[] = [{ key: `${d.id}:added`, ...at(d.created_game_s), kind: 'added', text: 'Contraes la deuda', why: cap(d.reason) }];
    if (settled) debtHistory.push({ key: `${d.id}:completed`, ...at(settled.game_s), kind: 'completed', text: steps[0]!.text, why: null });
    quests.push({
      id: d.id, kind: 'debt', title: `Deuda con ${who}`, origin: { kind: 'giver', text: `Se la debes a ${who}`, where: null }, history: debtHistory, text: settled ? cap(d.reason) : `${debtLine(w, d, nowS, (n) => npcLabel(c, n))}. ${cap(d.reason)}.`,
      status: settled ? 'completed' : 'active', giver: who, giver_npc_id: npc?.id ?? null, reward: null,
      seen_game_s: d.created_game_s, seen: fmt(d.created_game_s),
      completed_game_s: settled?.game_s ?? null, completed: settled ? fmt(settled.game_s) : null,
      updated_game_s: updated, updated: fmt(updated), steps,
      clock: !settled && d.due_game_s !== null ? { days_left: Math.max(0, left ?? 0), deadline: fmt(d.due_game_s), runs_out: pawnName ? `${who} puede quedarse la prenda (${pawnName}).` : `${who} te la reclamará.` } : null,
      antagonist: null, paths: [], rumors: [], pinned: false, summary: EMPTY_SUMMARY(),
    });
  }

  // Lo que le ha pedido un NPC fuera del tablón (give_quest): en curso sin aceptar; si la dejó, disponible.
  for (const g of givenQuests(c)) {
    const giver = g.giver_npc_id ? w.npcs.get(g.giver_npc_id) ?? null : null;
    const dropped = g.status === 'active' && droppedAt(c, g.id) !== null;
    const status: QuestStatus = g.status === 'completed' ? 'completed' : g.status === 'failed' ? 'expired' : dropped ? 'available' : 'active';
    const closed = g.status !== 'active' ? g.updated_game_s : null;
    const gHistory: JournalChange[] = [{ key: `${g.id}:added`, ...at(g.given_game_s), kind: 'added', text: 'Nueva misión', why: g.origin_text ?? (giver ? `te lo pide ${npcLabel(c, giver)}` : null) }];
    const left = droppedAt(c, g.id);
    if (left !== null) gHistory.push({ key: `${g.id}:dropped:${left}`, ...at(left), kind: 'dropped', text: 'La dejas', why: 'desde el Diario' });
    if (closed !== null) gHistory.push({ key: `${g.id}:${g.status}`, ...at(closed), kind: g.status === 'completed' ? 'completed' : 'failed', text: g.status === 'completed' ? 'Misión cumplida' : 'Misión fallida', why: g.closed_why ?? null });
    quests.push({
      id: g.id, kind: 'given', title: g.title, text: masked(g.text), status, droppable: status === 'active',
      origin: g.heard ? { kind: 'heard', text: g.origin_text, where: locName(g.location_id) } : giver ? { kind: 'giver', text: g.origin_text ?? `Te lo pide ${npcLabel(c, giver)}`, where: locName(g.location_id) } : null,
      history: gHistory,
      giver: giver && !g.heard ? npcTag(c, giver) : null, giver_npc_id: giver?.id ?? null, reward: g.reward,
      seen_game_s: g.given_game_s, seen: fmt(g.given_game_s), completed_game_s: closed, completed: closed === null ? null : fmt(closed),
      updated_game_s: g.updated_game_s, updated: fmt(g.updated_game_s),
      steps: [{ text: g.objective ? masked(g.objective) : `Cumplirlo y decírselo a ${giver ? npcLabel(c, giver) : 'quien lo pide'}`, done: g.status === 'completed' }],
      clock: null, antagonist: null, paths: [], rumors: questRumors([g.title, g.text]), pinned: false, summary: EMPTY_SUMMARY(),
    });
  }

  // Historia escrita (story.ts): las misiones que el PJ conoce, con los pasos dados y el de ahora (los siguientes, no).
  // Lo que pasó y por qué sale del registro del PJ (story.log); en partidas de antes, de los avisos de progreso.
  const cst = characterStory(c);
  const storyTimes = mine.filter((e) => e.action_type === 'progress_story' && e.actor_id === c.id);
  for (const v of questsOf(w, c)) {
    const q = v.quest;
    const log = (cst.log ?? []).filter((x) => x.quest_id === q.id);
    const told = storyTimes.filter((e) => e.narration_private.includes(`«${q.title}»`)).map((e) => e.timestamp_game_s);
    const opened = log.find((x) => x.kind === 'open')?.game_s;
    const seen = opened ?? told[0] ?? born;
    const closedAt = log.find((x) => x.kind === 'done')?.game_s;
    const completed = v.status === 'completed' ? closedAt ?? told.at(-1) ?? seen : null;
    const updated = Math.max(seen, ...log.map((x) => x.game_s), ...storyTimes.filter((e) => e.narration_private.includes(q.title)).map((e) => e.timestamp_game_s));
    const giver = q.giver_npc_id ? w.npcs.get(q.giver_npc_id) ?? null : null;
    const o = cst.origins?.[q.id];
    const r = q.reward;
    const history: JournalChange[] = log.map((x) => ({
      key: `${q.id}:${x.kind}:${x.step_id ?? ''}:${x.game_s}`, ...at(x.game_s),
      kind: x.kind === 'open' ? 'added' : x.kind === 'done' ? 'completed' : x.kind,
      text: x.kind === 'open' ? 'Nueva misión' : x.kind === 'done' ? 'Misión cumplida' : x.kind === 'expired' ? 'Se cierra' : `✔ ${masked(q.steps.find((st) => st.id === x.step_id)?.text ?? x.step_id ?? '')}`,
      why: x.why || null,
    }));
    if (!log.length) history.push({ key: `${q.id}:added`, ...at(seen), kind: 'added', text: 'Nueva misión', why: null });
    quests.push({
      id: q.id, kind: 'story', title: `${['', 'I', 'II', 'III'][q.act]} · ${q.title}`, text: masked(q.text), status: v.status,
      // De oídas: nadie se la ha pedido aún; no se pone «lo pide X».
      giver: giver && o?.kind !== 'heard' ? npcTag(c, giver) : null, giver_npc_id: giver?.id ?? null,
      origin: o ? { kind: o.kind, text: masked(o.text), where: locName(o.location_id) } : giver ? { kind: 'giver', text: `Te lo pide ${npcLabel(c, giver)}`, where: null } : null, history,
      reward: [r.coins ? money(w, r.coins) : '', r.reputation ? `+${r.reputation} de reputación` : '', r.xp ? `${r.xp} PX` : ''].filter(Boolean).join(' · ') || null,
      seen_game_s: seen, seen: fmt(seen), completed_game_s: completed, completed: completed === null ? null : fmt(completed),
      updated_game_s: updated, updated: fmt(updated),
      steps: v.steps.map((s) => ({ text: masked(s.step.text), done: s.done })),
      clock: null, antagonist: null, paths: [], rumors: questRumors([q.title, q.text]), pinned: false, summary: EMPTY_SUMMARY(),
    });
  }

  const byRecent = (x: JournalQuest, y: JournalQuest) => Number(y.pinned) - Number(x.pinned) || y.updated_game_s - x.updated_game_s || x.title.localeCompare(y.title);
  const active = quests.filter((q) => q.status !== 'completed').sort(byRecent);
  const completed = quests.filter((q) => q.status === 'completed').sort((x, y) => (y.completed_game_s ?? 0) - (x.completed_game_s ?? 0));

  // --- Conversaciones --------------------------------------------------------
  const convs = new Map<Id, JournalConversation>();
  for (const e of mine) {
    if (e.actor_id !== c.id) continue;
    const raw = e.payload['lines'];
    if (!Array.isArray(raw) || !raw.length) continue;
    const lines = raw as DialogueLine[];
    const said = lines.filter((l) => l.speaker === 'actor').map((l) => l.text);
    if (!said.length && e.input_text && !e.input_text.startsWith('(')) said.push(e.input_text);
    const npcIds = [...new Set(lines.filter((l) => l.speaker === 'npc' && l.npc_id).map((l) => l.npc_id as Id))];
    for (const id of npcIds) {
      const npc = w.npcs.get(id);
      if (!npc) continue;
      const replied = lines.filter((l) => l.speaker === 'npc' && l.npc_id === id).map((l) => l.text);
      if (!replied.length) continue;
      let conv = convs.get(id);
      if (!conv) {
        conv = { npc_id: id, name: npcTag(c, npc), role: npc.role, known: c.knows.includes(id), exchanges: [], memory: [], last_game_s: 0 };
        convs.set(id, conv);
      }
      conv.exchanges.push({
        seq: e.seq, game_s: e.timestamp_game_s, when: fmt(e.timestamp_game_s), location_id: e.location_id,
        location: w.locations.get(e.location_id)?.name ?? e.location_id, said: [...said], replied,
      });
      conv.last_game_s = Math.max(conv.last_game_s, e.timestamp_game_s);
    }
  }
  for (const conv of convs.values()) {
    const npc = w.npc(conv.npc_id);
    conv.memory = npc.memory.filter((m) => m.character_id === c.id).map((m) => ({ when: fmt(m.game_s), note: m.note }));
  }
  const conversations = [...convs.values()].sort((x, y) => y.last_game_s - x.last_game_s);

  // Resumen de cada misión: de qué va, qué toca ahora y lo relevante que le han dicho.
  const replies = conversations.flatMap((conv) => conv.exchanges.flatMap((x) => x.replied.map((said) => ({ npc_id: conv.npc_id, who: conv.name, said, game_s: x.game_s, when: x.when }))));
  for (const q of [...active, ...completed]) {
    const kw = keywords([q.title, q.text, ...q.steps.map((st) => st.text)].join(' '));
    // Lo que le dijo quien la pide (o, sin quien la pida, frases que hablan de lo mismo). El logro no cita a nadie.
    const told = q.kind === 'achievement' ? [] : replies
      .filter((r) => (q.giver_npc_id ? r.npc_id === q.giver_npc_id : shares(keywords(r.said), kw)))
      .filter((r) => r.game_s >= (q.seen_game_s ?? 0))
      .sort((x, y) => x.game_s - y.game_s)
      .slice(-2)
      .map((r) => ({ who: r.who, said: r.said, when: r.when }));
    const pending = q.steps.find((st) => !st.done)?.text ?? null;
    q.summary = {
      text: q.kind === 'main' ? (c.situation?.wants ? `${cap(c.situation.wants)}` : firstSentence(q.text)) : firstSentence(q.text),
      next: q.status === 'completed' || q.status === 'expired' || (q.kind === 'main' && pending === c.situation?.wants) ? null : pending,
      told,
    };
  }

  // --- Crónica ---------------------------------------------------------------
  const chronicle = chronicleOf(engine, c, mine, { dayLabel, hhmm, fmt });

  // --- Lugares ---------------------------------------------------------------
  const hereLoc = w.characterSpot(c)?.location_id ?? null;
  const firstVisit = new Map<Id, number>();
  for (const e of mine) {
    if (e.actor_id !== c.id || !/^(arrived|character_joined|master_arrival|master_intro)$/.test(e.action_type)) continue;
    if (!firstVisit.has(e.location_id)) firstVisit.set(e.location_id, e.timestamp_game_s);
  }
  const places: JournalPlace[] = [...w.locations.values()]
    .filter((l) => l.discovery[c.id] === 'visited' || l.discovery[c.id] === 'heard_of')
    .map((l) => ({
      id: l.id, name: l.name, zone: w.zones.get(l.zone_id)?.name ?? '', status: l.discovery[c.id] as 'visited' | 'heard_of', here: l.id === hereLoc,
      first_visit: firstVisit.has(l.id) ? fmt(firstVisit.get(l.id)!) : null,
    }))
    .sort((x, y) => Number(y.here) - Number(x.here) || (x.status === y.status ? x.name.localeCompare(y.name) : x.status === 'visited' ? -1 : 1));

  const memoryCount = [...w.npcs.values()].reduce((n, npc) => n + npc.memory.filter((m) => m.character_id === c.id).length, 0);
  return {
    character: { id: c.id, name: c.name },
    now: fmt(nowS),
    version: `${maxSeq}.${[...active, ...completed].reduce((n, q) => n + q.history.length, 0)}.${c.completed_jobs.length}.${c.clues.length}.${rumorsOf.length}.${memoryCount}.${engagedAt.size}.${givenQuests(c).map((g) => `${g.status[0]}${droppedAt(c, g.id) ?? ''}`).join('')}.${(c.debts ?? []).map((d) => `${d.amount}${d.settled ? 's' : ''}`).join('-')}`,
    quests: { active, completed },
    rumors: rumorsOf.filter((r) => !linked.has(r.id)),
    conversations, chronicle, places,
  };
}

/** Rumores que el PJ conoce: los que corren donde está y los que él mismo provocó en otros sitios. */
function rumorList(w: Engine['world'], c: Character, nowS: number, fmt: (s: number) => string): JournalRumor[] {
  const here = w.characterSpot(c)?.location_id;
  const seen = new Set<Id>();
  const out: Rumor[] = [];
  for (const r of [...(here ? rumorsIn(w, here, nowS) : []), ...rumorsHeardBy(w, c.id, nowS, here)]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out.sort((x, y) => y.origin.game_s - x.origin.game_s).map((r) => ({
    id: r.id, name: r.name, hint: r.hint, where: r.where, said_by: r.said_by?.name ?? null, mentions: r.mentions, when: fmt(r.origin.game_s),
  }));
}

/** Crónica por día de juego, por plantilla: lugares, gente, objetos, tiradas, combates y progreso. */
function chronicleOf(engine: Engine, c: Character, mine: readonly GameEvent[], f: { dayLabel: (s: number) => string; hhmm: (s: number) => string; fmt: (s: number) => string }): ChronicleDay[] {
  const w = engine.world;
  const days = new Map<number, ChronicleDay>();
  const dayOf = (s: number) => {
    const idx = Math.floor(s / DAY_S);
    let d = days.get(idx);
    if (!d) { d = { day_index: idx, label: f.dayLabel(s), summary: '', entries: [] }; days.set(idx, d); }
    return d;
  };
  const add = (s: number, kind: ChronicleKind, text: string) => {
    const d = dayOf(s);
    if (d.entries.some((x) => x.kind === kind && x.text === text)) return;
    d.entries.push({ game_s: s, time: f.hhmm(s), kind, text });
  };
  const metNpc = new Set<Id>();
  const talkedToday = new Set<string>();
  let lastLoc: Id | null = null;
  let joinedAt: number | null = null;
  const locName = (id: Id) => w.locations.get(id)?.name ?? id;

  for (const e of mine) {
    const t = e.timestamp_game_s;
    const own = e.actor_id === c.id;
    const day = Math.floor(t / DAY_S);
    switch (true) {
      case e.action_type === 'character_joined' && own:
        add(t, 'place', `Llegas a ${locName(e.location_id)}.`);
        lastLoc = e.location_id;
        joinedAt = t;
        break;
      case e.action_type === 'prologue' && own: {
        // La primera página: va antes que la llegada aunque se escriba un instante después.
        const title = typeof e.payload['title'] === 'string' ? e.payload['title'] : 'Prólogo';
        add(joinedAt === null ? t : Math.min(t, joinedAt), 'chapter', `${title}. ${firstSentence(e.narration_private)}`);
        break;
      }
      case /^(arrived|master_arrival)$/.test(e.action_type) && own: {
        if (e.location_id !== lastLoc) {
          const sp = e.spot_id ? w.spots.get(e.spot_id) : undefined;
          add(t, 'place', `Llegas a ${locName(e.location_id)}${sp ? `, ${sp.name}` : ''}.`);
          lastLoc = e.location_id;
        }
        break;
      }
      case e.action_type === 'travel_encounter' && own:
        add(t, 'travel', `En el camino: ${firstSentence(e.narration_private)}`);
        break;
      case e.action_type === 'roll' && own:
        add(t, 'roll', e.narration_private.replace(/^🎲\s*/, ''));
        break;
      // Caer, salvarse, morir y volver (death.ts).
      case e.action_type === 'down' && own: {
        const cause = (e.payload['down'] as { cause?: string } | undefined)?.cause;
        add(t, 'combat', `Caes a 0 PG en ${locName(e.location_id)}${cause ? ` (${cause})` : ''}.`);
        break;
      }
      case /^(stabilized|revived)$/.test(e.action_type) && own: {
        const r = e.payload['rescue'] as { by?: string | null; via?: string } | undefined;
        add(t, 'combat', r?.via === 'save' ? 'Sales adelante tú solo: vuelves en ti con 1 PG.'
          : e.action_type === 'stabilized' ? `${r?.by ? `${r.by} te estabiliza` : 'Te estabilizas'}: dejas de morirte.`
          : `Vuelves en ti${r?.by && r.by !== c.name ? `: te salvó ${r.by}` : ''}.`);
        break;
      }
      case e.action_type === 'death' && own: {
        const d = e.payload['death'] as { spot_id?: Id; left?: string[]; coins_left?: number; mode?: string } | undefined;
        const sp = d?.spot_id ? w.spots.get(d.spot_id) : undefined;
        const left = [...(d?.left ?? []), ...(d?.coins_left ? [money(w, d.coins_left)] : [])];
        add(t, 'combat', `Mueres en ${locName(e.location_id)}${sp ? `, ${sp.name}` : ''}. Tu cuerpo queda allí${left.length ? ` con ${left.join(', ')}` : ''}.`);
        break;
      }
      case e.action_type === 'respawn' && own: {
        const r = e.payload['respawn'] as { mode?: string; spot_id?: Id; body_spot_id?: Id; left?: string[]; coins_left?: number; penalty?: { label: string; amount: number } | null } | undefined;
        const sp = r?.spot_id ? w.spots.get(r.spot_id) : undefined;
        const body = r?.body_spot_id ? w.spots.get(r.body_spot_id) : undefined;
        const lost = (r?.left?.length || r?.coins_left) && body ? (r?.mode === 'hardcore' ? ` Lo que llevabas quedó en ${body.name}, al alcance de cualquiera.` : ` Tus cosas te esperan en ${body.name}.`) : '';
        add(t, 'chapter', `Vuelves de la muerte${sp ? ` en ${sp.name}` : ''}.${lost}${r?.penalty ? ` Pierdes ${r.penalty.amount} de ${r.penalty.label}.` : ''}`);
        break;
      }
      case /^(loot|recover)$/.test(e.action_type) && own:
        add(t, 'item', firstSentence(e.narration_private));
        break;
      case /^progress_/.test(e.action_type) && own:
        add(t, 'progress', e.narration_private);
        break;
      case e.action_type === 'announcement':
        add(t, 'note', e.observable ?? e.narration_private);
        break;
      case e.action_type === 'board': {
        const titles = [...(e.observable ?? '').matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]!);
        add(t, 'board', titles.length ? `El tablón cambia: ${titles.join(', ')}.` : 'El tablón cambia.');
        break;
      }
      default: {
        if (!own) break;
        if (e.payload['attack']) {
          const atk = e.payload['attack'] as { target_id: Id; hit: boolean; down: boolean; dead: boolean };
          const target = w.npcs.get(atk.target_id);
          add(t, 'combat', `Combate con ${target ? npcLabel(c, target) : 'alguien'}: ${atk.dead ? 'cae muerto' : atk.down ? 'cae' : atk.hit ? 'le alcanzas' : 'fallas el golpe'}.`);
        } else if (e.tags.includes('combat') && /^master/.test(e.action_type)) {
          add(t, 'combat', `Combate: ${firstSentence(e.narration_private)}`);
        }
        const item = e.payload['item_id'];
        if (typeof item === 'string' && /^(take|take_out|harvest)$/.test(e.action_type)) add(t, 'item', `Consigues ${w.itemDefs.get(item)?.name ?? item}.`);
        if (e.action_type === 'harvest') add(t, 'item', firstSentence(e.narration_private));
        const lines = Array.isArray(e.payload['lines']) ? (e.payload['lines'] as DialogueLine[]) : [];
        const npcIds = new Set<Id>(lines.filter((l) => l.speaker === 'npc' && l.npc_id).map((l) => l.npc_id as Id));
        if (typeof e.payload['npc_id'] === 'string' && /^master/.test(e.action_type)) npcIds.add(e.payload['npc_id'] as Id);
        for (const id of npcIds) {
          const npc = w.npcs.get(id);
          if (!npc) continue;
          const label = npcLabel(c, npc);
          if (!metNpc.has(id)) {
            metNpc.add(id);
            add(t, 'person', `Conoces a ${label}${c.knows.includes(id) ? ` (${npc.role})` : ''} en ${locName(e.location_id)}.`);
          } else if (!talkedToday.has(`${day}:${id}`)) {
            add(t, 'person', `Hablas con ${label} en ${locName(e.location_id)}.`);
          }
          talkedToday.add(`${day}:${id}`);
        }
      }
    }
  }
  for (const r of (w.campaign as { rumors?: Rumor[] }).rumors ?? []) {
    if (r.origin.actor_id === c.id) add(r.origin.game_s, 'rumor', `Se dice: «${r.name}». ${r.hint}`);
  }
  for (const fact of characterFacts(c)) add(fact.game_s, 'note', `Cuentas de ti: ${fact.text}`);

  const out = [...days.values()].sort((x, y) => y.day_index - x.day_index);
  for (const d of out) {
    d.entries.sort((x, y) => x.game_s - y.game_s || Number(y.kind === 'chapter') - Number(x.kind === 'chapter'));
    const n = (k: ChronicleKind) => d.entries.filter((e) => e.kind === k).length;
    const bits = [
      n('place') ? `${n('place')} lugar${n('place') === 1 ? '' : 'es'}` : '',
      n('person') ? `${n('person')} conversaci${n('person') === 1 ? 'ón' : 'ones'}` : '',
      n('item') ? `${n('item')} objeto${n('item') === 1 ? '' : 's'}` : '',
      n('roll') ? `${n('roll')} tirada${n('roll') === 1 ? '' : 's'}` : '',
      n('combat') ? 'combate' : '',
      n('progress') ? 'progreso' : '',
    ].filter(Boolean);
    d.summary = bits.join(' · ');
  }
  return out;
}
