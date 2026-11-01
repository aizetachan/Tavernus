/**
 * Al volver (issue #19, docs/MULTIJUGADOR.md, «Al volver»): la tarjeta «Mientras no estabas» y la línea «Hasta aquí
 * habías leído». Sale del log, por punto de vista, sin máster: solo lo que este PJ percibió (`delivered_to`) y con los
 * nombres como los conoce.
 *
 * Punto de partida: `Character.read_seq`, lo último que el jugador tuvo delante (lo dice la página con el latido). No
 * vale `last_seen_event_id`: `connected` sigue en true 30 min tras irse y se comería esa media hora. En partidas de
 * antes, sin marca, se cuenta desde su último turno.
 *
 * Umbral: la ausencia cuenta a partir de 30 min (AWAY_CARD_MS), los mismos que `setConnected` tarda en darle por
 * desconectado y velarlo. Con menos (una recarga, un rato fuera) no hay tarjeta: solo la línea de no leídos.
 */

import type { Engine } from '../../engine/engine.js';
import type { Character, GameEvent, Id } from '../../engine/model.js';
import type { DialogueLine } from '../../engine/moments.js';
import { pcLabel } from '../../engine/party.js';
import { firstSentence, lastOwnEvent } from '../../engine/prologue.js';
import { noticeOf, type NoticeTab } from './notice.js';

/** Fuera de línea al menos esto para que salga la tarjeta: lo que tarda `setConnected` en velarlo (SPEC §9.1). */
export const AWAY_CARD_MS = 30 * 60 * 1000;

export interface AwayCard {
  /** Cuánto ha estado fuera, en palabras («2 h 10 min»). */
  away: string;
  /** Dónde sigue su personaje. */
  where: string | null;
  /** Quién llegó y quién se fue. */
  people: string[];
  /** Qué pasó en su sitio y lo que le pasó a él. */
  here: string[];
  /** Qué le dijeron (o dijeron delante de él). */
  said: { who: string; text: string; to_me: boolean }[];
  /** Misiones y progreso que han cambiado, con enlace a su pestaña. */
  changes: { text: string; why?: string; link: string; tab: NoticeTab }[];
  /** El tablón ha cambiado. */
  board: boolean;
  /** Cuántas cosas no caben en la tarjeta (siguen en el hilo). */
  more: number;
}

const MAX_PEOPLE = 6;
const MAX_HERE = 6;
const MAX_SAID = 5;
const MAX_CHANGES = 8;
const MAX_TEXT = 160;

/** Gente que va y viene (notices.ts). */
const COMES_AND_GOES = /^(away|back|arrived|character_joined|move|passed|stop|rebound|master_arrival|master_intro|npc_move|npc_order_end|npc_join|npc_leave|follow|unfollow|follow_move)$/;
/** Lo que le llega a su nombre sin que actúe: de lo suyo, solo esto es noticia. El resto de sus eventos ya lo vio. */
const HAPPENS_TO_ME = /^(offer_cancelled|offer_expired|unfollow|npc_free|down|stabilized|revived|death|respawn|master_line)$/;
const SAY = new Set(['say', 'shout', 'whisper']);
/** Comentarios al pasar (chatter.ts), capítulos y turnos de presencia sin texto: no son noticia. */
const NOT_NEWS = /^(chatter|prologue|recap)$/;

function short(text: string): string {
  const one = firstSentence(text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim());
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 1).trimEnd()}…` : one;
}

/** «35 min», «2 h 10 min», «3 días». */
export function awayText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h >= 48) return `${Math.round(h / 24)} días`;
  const rest = min % 60;
  return rest && h < 10 ? `${h} h ${rest} min` : `${h} h`;
}

/**
 * ¿Vuelve de una ausencia de verdad? Cuánto ha estado fuera, o null si no llega al umbral. Hay que preguntarlo antes de
 * despertarlo. `veiled` sin `away` es que se fue antes de que hubiera marca o de un reinicio: ya pasó el umbral, y
 * lleva fuera desde lo último que leyó.
 */
export function awayFor(engine: Engine, c: Character, thresholdMs = AWAY_CARD_MS): number | null {
  const now = engine.now();
  if (c.away) { const ms = now - c.away.since_real_ms; return ms >= thresholdMs ? ms : null; }
  if (!c.veiled) return null;
  const from = unreadFrom(engine, c);
  const seen = from === null ? undefined : engine.events.all().find((e) => e.seq === from);
  return Math.max(thresholdMs, seen ? now - seen.timestamp_real_ms : 0);
}

/** Desde qué evento contar lo que no ha visto. null si no ha llegado a jugar. */
export function unreadFrom(engine: Engine, c: Character): number | null {
  return c.read_seq ?? lastOwnEvent(engine, c.id)?.seq ?? null;
}

/** Lo que dicen las líneas de un turno y a quién, si lo oye bien (party.ts, novel.ts). */
function saidIn(engine: Engine, e: GameEvent, reader: Id): AwayCard['said'] {
  const w = engine.world;
  const lines = Array.isArray(e.payload['lines']) ? e.payload['lines'] as DialogueLine[] : [];
  const out: AwayCard['said'] = [];
  const say = e.payload['say'] as { to: Id | null } | undefined;
  for (const l of lines) {
    if (l.speaker === 'npc' && l.npc_id && w.npcs.has(l.npc_id) && (l.to === reader || e.payload['target_character_id'] === reader)) {
      const npc = w.npcs.get(l.npc_id)!;
      const known = w.characters.get(reader)?.knows.includes(npc.id) ?? false;
      out.push({ who: known ? npc.name : npc.role.charAt(0).toUpperCase() + npc.role.slice(1), text: l.text, to_me: true });
    } else if (SAY.has(e.action_type) && l.speaker === 'actor' && e.actor_id) {
      const actor = w.characters.get(e.actor_id);
      if (actor) out.push({ who: pcLabel(w, reader, actor), text: l.text, to_me: say?.to === reader });
    }
  }
  return out;
}

/** Lo percibido por este PJ después de `fromSeq`, agrupado. Sin nada que contar, todas las listas vacías. */
export function awayCard(engine: Engine, c: Character, fromSeq: number, awayMs: number): AwayCard {
  const w = engine.world;
  const pcs: string[] = [], npcs: string[] = [], urgent: string[] = [], here: string[] = [];
  const said: AwayCard['said'] = [];
  const changes: AwayCard['changes'] = [];
  let board = false;
  for (const d of engine.events.forCharacter(c.id, null)) {
    const e = d.event;
    if (e.seq <= fromSeq || NOT_NEWS.test(e.action_type) || d.level === 'hint') continue;
    const mine = e.actor_id === c.id;
    const notice = noticeOf(e, c.id, d.text);
    if (/^progress_/.test(e.action_type) && mine) {
      if (notice?.link && notice.tab) changes.push({ text: notice.text, ...(notice.quest?.why ? { why: notice.quest.why } : {}), link: notice.link, tab: notice.tab });
      else if (notice) here.push(notice.text);
      continue;
    }
    if (mine && !HAPPENS_TO_ME.test(e.action_type)) continue;
    if (e.action_type === 'board') { board = true; continue; }
    if (SAY.has(e.action_type) && d.level !== 'full') continue;
    const lines = saidIn(engine, e, c.id);
    if (lines.length) { said.push(...lines); continue; }
    if (COMES_AND_GOES.test(e.action_type)) { (e.actor_id && w.characters.has(e.actor_id) ? pcs : npcs).push(short(d.text)); continue; }
    const aimed = (e.payload['attack'] as { target_id?: Id } | undefined)?.target_id === c.id || e.payload['target_character_id'] === c.id;
    (mine || aimed || e.tags.includes('combat') ? urgent : here).push(short(d.text));
  }
  // Los demás jugadores que han entrado o salido en otro sitio: no se perciben, pero la web los avisa fuera de la ficción.
  const lastMove = new Map<Id, string>();
  for (const e of engine.events.all()) {
    if (e.seq <= fromSeq || !e.actor_id || e.actor_id === c.id || (e.action_type !== 'away' && e.action_type !== 'back')) continue;
    const other = w.characters.get(e.actor_id);
    if (other && !e.delivered_to.some((x) => x.character_id === c.id)) lastMove.set(other.id, `${other.name} ${e.action_type === 'back' ? 'ha vuelto' : 'se ha marchado'}`);
  }
  pcs.push(...lastMove.values());

  const uniq = (xs: string[]) => [...new Set(xs)];
  const peopleAll = [...uniq(pcs), ...uniq(npcs)];
  const hereAll = uniq([...urgent, ...here]);
  const spot = w.characterSpot(c);
  return {
    away: awayText(awayMs),
    where: spot?.name ?? null,
    // Delante, los jugadores y lo que le toca de cerca; lo que no cabe sigue en el hilo.
    people: peopleAll.slice(0, MAX_PEOPLE),
    here: hereAll.slice(0, MAX_HERE),
    said: said.slice(-MAX_SAID),
    changes: changes.slice(-MAX_CHANGES),
    board,
    more: Math.max(0, peopleAll.length - MAX_PEOPLE) + Math.max(0, hereAll.length - MAX_HERE) + Math.max(0, said.length - MAX_SAID) + Math.max(0, changes.length - MAX_CHANGES),
  };
}

export function awayCardEmpty(card: AwayCard): boolean {
  return !card.people.length && !card.here.length && !card.said.length && !card.changes.length && !card.board;
}

export const AWAY_STYLE = String.raw`
  .msg.unread-line { align-self: stretch; display: flex; align-items: center; gap: 10px; margin: 10px 0; color: var(--accent); font-size: 12px; font-weight: 600; }
  .msg.unread-line::before, .msg.unread-line::after { content: ''; flex: 1; height: 1px; background: rgba(230,183,90,.4); }
  .msg.away-card { align-self: center; width: min(94%, 560px); margin: 12px 0 6px; padding: 12px 16px 14px; border-radius: 14px; border: 1px solid rgba(230,183,90,.45); background: #1f1b12; color: var(--text); font-size: 13.5px; line-height: 1.45; }
  .away-card h3 { margin: 0; font: 700 15px/1.25 var(--display); color: #f1d9a4; }
  .away-card .sub { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
  .away-card h4 { margin: 10px 0 2px; font-size: 11.5px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; color: var(--muted); }
  .away-card ul { margin: 0; padding: 0; list-style: none; }
  .away-card li { margin: 2px 0; }
  .away-card li small { display: block; font-size: 12px; color: var(--muted); }
  .away-card li b { font-weight: 600; }
  .away-card .link, .away-card .more { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-size: 12.5px; cursor: pointer; }
  .away-card li .link { margin-left: 6px; }
  .away-card .link:hover, .away-card .more:hover { text-decoration: underline; }
  .away-card .foot { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; }
`;

export const AWAY_JS = String.raw`
  // --- Al volver (whileaway.ts): la tarjeta «Mientras no estabas» y la línea «Hasta aquí habías leído». ---------
  /** Lo último que el jugador ha tenido delante (va con el latido) y lo último que ha llegado al hilo. */
  var readSeq = 0, serverRead = null, lastShownSeq = 0;
  /** Se está leyendo desde la línea: lo que llega no baja el hilo hasta que se llega al final o se actúa. */
  var unreadHold = false, unreadAnchorUntil = 0;
  function unreadLine() { return log.querySelector('.unread-line'); }
  function addUnreadLine() {
    if (unreadLine()) return null;
    var div = document.createElement('div');
    div.className = 'msg unread-line'; div.setAttribute('role', 'separator');
    div.textContent = 'Hasta aquí habías leído';
    log.appendChild(div);
    return div;
  }
  function clearUnread() { var l = unreadLine(); if (l) l.remove(); unreadHold = false; }
  /** Con lo no leído más largo que la pantalla, se abre por la línea; si cabe, se queda abajo, donde se lee entero. */
  function anchorUnread() {
    var l = unreadLine();
    if (!l || log.querySelector('.unread-line ~ .away-card') || log.scrollHeight - l.offsetTop <= log.clientHeight) return;
    unreadHold = true; unreadAnchorUntil = Date.now() + 5000;
    l.scrollIntoView({ block: 'start' });
  }
  function holdUnread() {
    if (!unreadHold) return false;
    var l = unreadLine();
    if (l && Date.now() < unreadAnchorUntil) l.scrollIntoView({ block: 'start' });
    return true;
  }
  log.addEventListener('scroll', function () { if (unreadHold && Date.now() >= unreadAnchorUntil && log.scrollHeight - log.scrollTop - log.clientHeight < 40) unreadHold = false; });
  function noteRead() { if (!document.hidden && lastShownSeq > readSeq) readSeq = lastShownSeq; }
  /** Índice del primer mensaje sin leer del historial, o -1. */
  function firstUnread(h) {
    var from = Math.max(serverRead === null ? 0 : serverRead, readSeq);
    if (serverRead === null && !readSeq) return -1;
    for (var i = 0; i < h.length; i++) if ((h[i].seq || 0) > from) return i;
    return -1;
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { anchorUnread(); noteRead(); } });
  /** Un mensaje en vivo: con la pestaña oculta, lo que llega va tras la línea. */
  function liveUnread(m) {
    if (document.hidden && !m.away_card) addUnreadLine();
    if ((m.seq || 0) > lastShownSeq) lastShownSeq = m.seq;
    noteRead();
  }
  function awayList(title, items) { return items.length ? '<h4>' + title + '</h4><ul>' + items.join('') + '</ul>' : ''; }
  function addAwayCard(c) {
    var li = function (t) { return '<li>' + escapeHtml(t) + '</li>'; };
    var said = c.said.map(function (s) { return '<li><b>' + escapeHtml(s.who) + (s.to_me ? ' te dijo' : ' dijo') + ':</b> «' + escapeHtml(s.text) + '»</li>'; });
    var changes = c.changes.map(function (x) {
      return '<li>' + escapeHtml(x.text) + '<button type="button" class="link" data-away-tab="' + escapeHtml(x.tab) + '">' + escapeHtml(x.link) + '</button>' + (x.why ? '<small>' + escapeHtml(x.why) + '</small>' : '') + '</li>';
    });
    var div = document.createElement('section');
    div.className = 'msg away-card'; div.setAttribute('aria-label', 'Mientras no estabas');
    div.innerHTML = '<h3>Mientras no estabas</h3><p class="sub">Has estado fuera ' + escapeHtml(c.away) + (c.where ? ' · sigues en ' + escapeHtml(c.where) : '') + '</p>' +
      awayList('Misiones y progreso', changes) + awayList('Te dijeron', said) + awayList('En tu sitio', c.here.map(li)) + awayList('Quién llegó y quién se fue', c.people.map(li)) +
      '<div class="foot">' + (c.board ? '<button type="button" class="link" data-away-tab="tablon">Hay avisos nuevos en el tablón</button>' : '') +
      '<button type="button" class="link" data-away-tab="journal">Abrir el Diario</button>' +
      (unreadLine() ? '<button type="button" class="more" data-away-read>' + (c.more ? 'Y ' + c.more + ' cosas más: leer' : 'Leer') + ' desde donde lo dejaste</button>' : '') + '</div>';
    log.appendChild(div);
    unreadHold = false;
    scroll();
  }
  log.addEventListener('click', function (ev) {
    var tab = ev.target.closest('[data-away-tab]');
    if (tab) { goTab(tab.getAttribute('data-away-tab')); return; }
    if (ev.target.closest('[data-away-read]')) { var l = unreadLine(); if (l) { unreadHold = true; unreadAnchorUntil = 0; l.scrollIntoView({ block: 'start' }); } }
  });
`;
