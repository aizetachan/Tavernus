/**
 * Combate en la web: el estado que el servidor manda a cada jugador implicado
 * (SSE `combat`) y cómo lo pinta la página.
 *
 *   - combatView: el encuentro (engine/encounter.ts) visto por un PJ, con los
 *     nombres como los conoce, sus PV exactos y los de los demás PJ, solo el
 *     estado de los NPC, de quién es el turno y el registro corto en texto.
 *   - El turno sale de la ronda abierta del motor (escena tensa, scene.ts) y de
 *     las acciones en vuelo en el sitio (la cola que ya pintaba «Esperando a…»).
 *   - La página: al empezar, aviso en el hilo y tono rojo (cabeceras y cuadro
 *     de escribir); arriba, la cabecera de combate con la insignia ⚔ y los
 *     luchadores (retrato, nombre, barra y PV; de los NPC, su estado); en el
 *     hilo, «Ronda N» al empezar cada ronda y la marca de turno con su reloj.
 *     Al acabar, aviso de fin y vuelta al tono normal.
 *   - combatRecordsView: el registro de combates de un PJ, que se abre desde Ajustes.
 */

import type { SceneNotice } from '../../engine/engine.js';
import type { Encounter, EncounterEntry, FighterState, PastEncounter } from '../../engine/encounter.js';
import type { Id } from '../../engine/model.js';
import { descriptorOf } from '../../engine/narrate.js';
import { pcName } from '../../engine/party.js';
import type { World } from '../../engine/world.js';

export type TurnKind = 'you' | 'wait' | 'other' | 'resolving' | 'down';

export interface CombatFighterView {
  id: Id;
  name: string;
  side: 'pc' | 'npc';
  me: boolean;
  initiative: number;
  state: FighterState;
  /** «8/12 PV» para los PJ; «Herido», «Malherido»… para los NPC (sus PV no se ven). */
  label: string;
  /** Vida que queda, de 0 a 1 (en los NPC, por tramos). */
  hp_frac: number;
  /** En la ronda: ya ha actuado, le falta o es quien actúa ahora. */
  turn: 'acted' | 'pending' | 'acting' | null;
  avatar: string | null;
  away?: boolean;
}

export interface CombatView {
  active: true;
  /** Identifica el combate (localización y evento que lo abrió). */
  key: string;
  place: string;
  round: number;
  turn: { kind: TurnKind; who: string[]; text: string; deadline_ms: number | null };
  fighters: CombatFighterView[];
  log: { seq: number; text: string; tone: 'hit' | 'miss' | 'down' | 'heal' | 'info' }[];
}

export interface CombatEnd { active: false; key: string; why: 'ended' | 'left' }

/** Lo que el servidor sabe del turno en el sitio: la ronda abierta, quién actúa (en orden) y qué ronda se está narrando. */
export interface TurnContext {
  round: SceneNotice | null;
  /** PJ con una acción en vuelo en la localización, por orden de llegada. */
  busy: Id[];
  /** PJ de la ronda que el máster está narrando (ya cerrada). */
  resolving: Id[];
  avatar?: (id: Id) => string | null;
}

const STATE_LABEL: Record<FighterState, string> = { ok: 'Ileso', hurt: 'Herido', bloodied: 'Malherido', down: 'Caído', stable: 'Estable', out: 'Inconsciente', dead: 'Muerto' };
const NPC_FRAC: Record<FighterState, number> = { ok: 1, hurt: 0.75, bloodied: 0.35, down: 0, stable: 0, out: 0, dead: 0 };

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function list(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

/** Nombre de un combatiente para ese jugador: los PJ por su nombre; un NPC, por su nombre si lo conoce o por su descriptor. */
export function fighterName(world: World, viewerId: Id, id: Id): string {
  const c = world.characters.get(id);
  if (c) return pcName(world, viewerId, c);
  const n = world.npcs.get(id);
  if (!n) return 'alguien';
  return world.characters.get(viewerId)?.knows.includes(n.id) ? n.name : descriptorOf(world, n.id);
}

function entryText(world: World, viewerId: Id, x: EncounterEntry): { text: string; tone: CombatView['log'][number]['tone'] } {
  const nm = (id: Id) => cap(fighterName(world, viewerId, id));
  switch (x.kind) {
    case 'attack': {
      const tail = x.dead ? ' y cae muerto' : x.ko ? ' y cae inconsciente' : x.down ? ' y cae' : '';
      return x.hit
        ? { text: `${nm(x.actor_id)} → ${nm(x.target_id)}: impacta${x.damage ? `, ${x.damage} de daño` : ''}${tail}`, tone: x.down || x.dead ? 'down' : 'hit' }
        : { text: `${nm(x.actor_id)} → ${nm(x.target_id)}: falla`, tone: 'miss' };
    }
    case 'damage': return { text: `${nm(x.target_id)} recibe ${x.amount} de daño`, tone: 'hit' };
    case 'heal': return { text: `${nm(x.target_id)} recupera ${x.amount} PV`, tone: 'heal' };
    case 'down': return { text: `${nm(x.target_id)} cae a 0 PV`, tone: 'down' };
    case 'dead': return { text: `${nm(x.target_id)} muere`, tone: 'down' };
    case 'stabilized': return { text: `${nm(x.target_id)} queda estable`, tone: 'info' };
    case 'revived': return { text: `${nm(x.target_id)} vuelve en sí`, tone: 'heal' };
  }
}

/** De quién es el turno, visto por ese jugador. */
export function turnOf(world: World, viewerId: Id, enc: Encounter, ctx: TurnContext): CombatView['turn'] {
  const nm = (id: Id) => cap(fighterName(world, viewerId, id));
  const me = enc.fighters.find((f) => f.id === viewerId);
  const deadline = ctx.round?.open ? ctx.round.deadline_ms : null;
  if (me && (me.state === 'down' || me.state === 'stable' || me.state === 'dead')) {
    return { kind: 'down', who: [], text: me.state === 'dead' ? 'Has caído: solo puedes mirar' : 'Estás inconsciente: no puedes actuar', deadline_ms: deadline };
  }
  if (ctx.round?.open) {
    const waiting = ctx.round.waiting.filter((id) => id !== viewerId).map(nm);
    if (!ctx.round.acted.includes(viewerId)) return { kind: 'you', who: waiting, text: waiting.length ? `Te toca (y a ${list(waiting)})` : 'Te toca', deadline_ms: deadline };
    if (waiting.length) return { kind: 'wait', who: waiting, text: `Esperando a ${list(waiting)}`, deadline_ms: deadline };
    return { kind: 'resolving', who: [], text: 'El narrador resuelve la ronda', deadline_ms: null };
  }
  if (ctx.resolving.length) return { kind: 'resolving', who: ctx.resolving.filter((id) => id !== viewerId).map(nm), text: 'El narrador resuelve la ronda', deadline_ms: null };
  const first = ctx.busy[0];
  if (first === viewerId) return { kind: 'resolving', who: [], text: 'El narrador resuelve tu acción', deadline_ms: null };
  if (first) return { kind: 'other', who: [nm(first)], text: `Turno de ${nm(first)}: está actuando`, deadline_ms: null };
  return { kind: 'you', who: [], text: 'Te toca', deadline_ms: null };
}

/** Lo último que un PJ vio de su combate: dónde, con qué rivales, en qué ronda y a qué hora de juego. */
export interface FightTrail { key: string; location_id: Id; rivals: Id[]; round: number; game_s: number }

/** Un rival que sigue al PJ a otra localización en menos de esto (juego) es el mismo combate que sigue. */
export const FIGHT_FOLLOW_S = 120;

/**
 * El aviso de un combate que aparece para un PJ y desde qué ronda cuenta. Si es el mismo que traía (otra
 * localización, algún rival de antes en pie y a menos de FIGHT_FOLLOW_S), no es nuevo: «El combate sigue en…» y la
 * ronda continúa (`round_offset`, lo que se suma a la del encuentro nuevo). Si no, «Empieza el combate» o, si ya
 * llevaba un rato, «Hay un combate en curso». Partida del 04-11-2026: Doro siguió a Cat del callejón a la Casa de
 * las hierbas y salió «Hay un combate en curso» con la ronda otra vez en 1.
 */
export function fightStart(enc: Encounter, view: CombatView, trail: FightTrail | null, nowGameS: number): { text: string; round_offset: number } {
  const rivals = enc.fighters.filter((f) => f.kind === 'npc' && f.state !== 'dead' && f.state !== 'out').map((f) => f.id);
  const follows = trail !== null && trail.key !== view.key && trail.location_id !== enc.location_id
    && nowGameS - trail.game_s < FIGHT_FOLLOW_S && rivals.some((id) => trail.rivals.includes(id));
  if (follows) return { text: `⚔ El combate sigue en ${view.place}`, round_offset: Math.max(0, trail.round - 1) };
  // Recién abierto (menos de dos minutos de juego): empieza; si no, ya estaba en marcha cuando llega este PJ.
  const fresh = nowGameS - enc.started_game_s < 120;
  return { text: fresh ? `⚔ Empieza el combate en ${view.place}` : `⚔ Hay un combate en curso en ${view.place}`, round_offset: 0 };
}

/** El combate visto por un PJ; null si ese PJ no está en él. */
export function combatView(world: World, enc: Encounter, viewerId: Id, ctx: TurnContext): CombatView | null {
  if (!enc.fighters.some((f) => f.id === viewerId)) return null;
  const turn = turnOf(world, viewerId, enc, ctx);
  const acted = new Set(ctx.round?.open ? ctx.round.acted : ctx.resolving);
  const pending = new Set(ctx.round?.open ? ctx.round.waiting : []);
  const acting = ctx.round?.open || ctx.resolving.length ? null : ctx.busy[0] ?? null;
  return {
    active: true,
    key: `${enc.location_id}:${enc.started_seq}`,
    place: world.location(enc.location_id).name,
    round: enc.exchanges + 1,
    turn,
    fighters: enc.fighters.map((f) => {
      const pc = f.kind === 'pc';
      return {
        id: f.id, name: f.id === viewerId ? 'Tú' : cap(fighterName(world, viewerId, f.id)), side: f.kind, me: f.id === viewerId, initiative: f.initiative, state: f.state,
        label: pc && f.state !== 'dead' ? `${f.hp}/${f.hp_max} PV` : STATE_LABEL[f.state],
        hp_frac: pc ? Math.max(0, Math.min(1, f.hp / Math.max(1, f.hp_max))) : NPC_FRAC[f.state],
        turn: f.id === acting ? 'acting' : acted.has(f.id) ? 'acted' : pending.has(f.id) ? 'pending' : null,
        avatar: ctx.avatar?.(f.id) ?? null,
        ...(f.away ? { away: true } : {}),
      };
    }),
    log: enc.log.map((x) => ({ seq: x.seq, ...entryText(world, viewerId, x) })),
  };
}

export interface CombatRecordView {
  key: string;
  place: string;
  /** Cuándo empezó, en hora de juego («lunes 1 de Brotes, 18:02»). */
  when: string;
  entries: { seq: number; text: string; tone: CombatView['log'][number]['tone'] }[];
}

/** El registro de combates de un PJ (Ajustes → Registro de combates), con los nombres como los conoce él. */
export function combatRecordsView(world: World, history: readonly PastEncounter[], viewerId: Id, fmtGameTime: (s: number) => string): CombatRecordView[] {
  return history.map((h) => ({
    key: h.key,
    place: world.locations.get(h.location_id)?.name ?? 'algún sitio',
    when: fmtGameTime(h.started_game_s),
    entries: h.log.map((x) => ({ seq: x.seq, ...entryText(world, viewerId, x) })),
  }));
}

export const FIGHT_STYLE = String.raw`
  /* Combate (fight.ts): tono rojo mientras dura (cabecera de la partida, la de combate y el cuadro de escribir, en todos
     los temas), los luchadores arriba y, en el hilo, los avisos de inicio, de ronda y la marca de turno. */
  :root { --fight: #e0604f; --fight-ink: #ffd9d2; --fight-tint: rgba(224,96,79,.14); --fight-line: rgba(224,96,79,.38); --fight-bg: #2a1512; --fight-bg2: #1a1110; --fight-box: #241311; }
  :root body.in-combat .chat-head { background: var(--fight-bg); border-bottom-color: var(--fight-line); box-shadow: 0 1px 0 var(--fight-line), 0 1px 6px rgba(0,0,0,.35); }
  :root body.in-combat form { background: var(--fight-bg); border-top-color: var(--fight-line); }
  body.in-combat .chat-body::after { content: ''; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 90px rgba(224,96,79,.13); }
  body.in-combat form input { box-shadow: inset 0 0 0 1px rgba(224,96,79,.25); }
  body.fight-flash .chat-body::after { animation: fight-flash 1.4s ease-out; }
  @keyframes fight-flash { 0% { box-shadow: inset 0 0 160px rgba(224,96,79,.55); } 100% { box-shadow: inset 0 0 90px rgba(224,96,79,.13); } }
  /* Cabecera de combate: solo los luchadores; encima, sobre la raya que la separa de la de la partida, la insignia ⚔. */
  #fight { position: relative; z-index: 3; flex: none; padding: 12px max(10px, calc((100% - 980px) / 2)) 8px; background: linear-gradient(180deg, var(--fight-bg), var(--fight-bg2)); border-top: 1px solid var(--fight-line); border-bottom: 1px solid var(--fight-line); box-shadow: 0 4px 12px rgba(0,0,0,.4); color: var(--text); }
  #fight[hidden] { display: none; }
  #fight.enter { animation: fight-in .45s cubic-bezier(.2,.8,.2,1); }
  @keyframes fight-in { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: none; } }
  #fight .fx-badge { position: absolute; left: 50%; top: 0; transform: translate(-50%, -50%); display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--fight); color: #2a0b06; font-size: 12px; line-height: 1; }
  #fight .fx-order { display: flex; justify-content: safe center; gap: 6px; margin: 0; padding: 2px 0; list-style: none; overflow-x: auto; scrollbar-width: none; }
  #fight .fx-order::-webkit-scrollbar { display: none; }
  #fight .fx-f { flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 94px; max-width: 150px; padding: 4px 8px 5px; border: 1px solid transparent; border-radius: 8px; background: rgba(255,255,255,.05); }
  #fight .fx-f.me { background: rgba(230,183,90,.05); border-color: var(--accent); }
  #fight .fx-f.acting { border-color: rgba(230,183,90,.5); }
  #fight .fx-f.npc { cursor: pointer; }
  #fight .fx-f.st-dead, #fight .fx-f.st-down, #fight .fx-f.st-stable, #fight .fx-f.st-out { opacity: .55; }
  #fight .fx-f .who { display: flex; align-items: center; justify-content: center; gap: 4px; max-width: 100%; min-width: 0; }
  #fight .fx-f .av { width: 16px; height: 16px; flex: none; display: grid; place-items: center; border-radius: 50%; overflow: hidden; background: #22262a center / cover; color: var(--muted); font-size: 7.5px; font-weight: 700; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); }
  #fight .fx-f.pc .av { color: var(--accent); background-color: #2a1d05; box-shadow: inset 0 0 0 1px rgba(230,183,90,.65); }
  #fight .fx-f.npc .av { color: #ff9d94; background-color: #2b1412; box-shadow: inset 0 0 0 1px rgba(224,96,79,.7); }
  #fight .fx-f .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; line-height: 1; }
  #fight .fx-f .mark { flex: none; font-size: 11px; line-height: 1; }
  #fight .fx-f .mark.acted { color: var(--ok); }
  #fight .fx-f .mark.pending { color: var(--accent); font-size: 8px; animation: fight-pulse 1.2s ease-in-out infinite; }
  @keyframes fight-pulse { 50% { opacity: .35; } }
  #fight .fx-f .bar { width: 100%; height: 4px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; }
  #fight .fx-f .bar i { display: block; height: 100%; border-radius: 999px; background: var(--ok); }
  #fight .fx-f .bar i.low { background: var(--accent); } #fight .fx-f .bar i.crit { background: var(--error); }
  #fight .fx-f .hp { font-size: 11px; line-height: 1; color: var(--muted); white-space: nowrap; }
  /* En el hilo: aviso de inicio y de ronda (granate), de fin (gris) y la marca de turno, con el reloj de la ronda. */
  .msg.notice.fightmark { padding: 3px 10px 4px; border: 1px solid rgba(224,96,79,.4); background: var(--fight-box); color: var(--fight-ink); font-size: 12px; font-weight: 600; }
  .msg.notice.fightmark.round { background: var(--fight-bg); }
  .msg.notice.fightmark.end { border-color: var(--sep); background: #161a1b; color: #b8b1a6; }
  .msg.turnmark { align-self: center; display: inline-flex; align-items: center; gap: 6px; margin: 2px 0; padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #e9c7bf; background: rgba(224,96,79,.1); box-shadow: inset 0 0 0 1px rgba(224,96,79,.28); font-variant-numeric: tabular-nums; }
  .msg.turnmark.you { color: var(--accent-ink); background: var(--accent); box-shadow: none; }
  .msg.turnmark.wait, .msg.turnmark.resolving, .msg.turnmark.down { color: var(--muted); background: rgba(255,255,255,.04); box-shadow: inset 0 0 0 1px var(--sep); }
  /* Registro de combates (Ajustes): un cuadro con los combates del PJ, del más reciente al más antiguo. */
  #fight-log-box { width: min(480px, calc(100vw - 32px)); max-height: min(80vh, 640px); padding: 0; border: 1px solid var(--line); border-radius: 18px; background: var(--bubble, #232526); color: var(--text); box-shadow: var(--window-shadow, 0 12px 32px rgba(0,0,0,.5)); }
  #fight-log-box::backdrop { background: rgba(0,0,0,.55); }
  #fight-log-box .hd { display: flex; align-items: center; gap: 8px; padding: 14px 14px 10px 18px; border-bottom: 1px solid var(--sep); }
  #fight-log-box h2 { flex: 1; margin: 0; font: 600 16px/1.3 var(--sans); }
  #fight-log-box .x { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: rgba(255,255,255,.06); color: var(--text); cursor: pointer; }
  #fight-log-box .bd { max-height: calc(min(80vh, 640px) - 60px); overflow-y: auto; padding: 6px 18px 16px; }
  #fight-log-box section { padding: 10px 0; border-bottom: 1px solid var(--sep); }
  #fight-log-box section:last-child { border-bottom: 0; }
  #fight-log-box h3 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
  #fight-log-box h3 small { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-weight: 400; }
  #fight-log-box ol { margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 1.55; }
  #fight-log-box li { color: #cfc8be; }
  #fight-log-box li.hit { color: #f0b3a3; } #fight-log-box li.down { color: #ff8a7d; font-weight: 600; } #fight-log-box li.heal { color: #8fd8a8; } #fight-log-box li.miss { color: var(--muted); }
  #fight-log-box .none { margin: 18px 0; color: var(--muted); font-size: 13.5px; text-align: center; }
  @media (max-width: 820px) {
    #fight .fx-f { min-width: 90px; }
    #fight .fx-f .nm { font-size: 13.5px; }
  }
`;

/**
 * Va en el script de la página (page.ts), con su ámbito: $, log, inChat, escapeHtml, scroll, input, api, current.
 * El estado llega por SSE «combat»; los avisos de inicio y fin, como mensajes del hilo (m.combat).
 */
export const FIGHT_SCRIPT = String.raw`
  var fight = null, fightTurnKey = null, fightTimer = null, fightRoundShown = null;
  function fightInitials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  /** Lo último del hilo antes de los puntos de «escribiendo», para meter algo justo ahí. */
  function fightInsert(div) {
    var dots = log.querySelector('.msg.row.typing');
    if (dots) log.insertBefore(div, dots); else log.appendChild(div);
  }
  /** Aviso de inicio o fin en el hilo (mensaje del servidor con m.combat). */
  function fightMark(c) {
    var div = document.createElement('div');
    div.className = 'msg notice fightmark ' + c.phase;
    div.setAttribute('role', 'status');
    div.textContent = c.text;
    // El aviso de inicio va delante de la ronda y de la marca de turno si ya se habían pintado.
    if (c.phase === 'start') {
      var first = null, el = log.lastElementChild;
      while (el && (el.classList.contains('turnmark') || el.classList.contains('round'))) { first = el; el = el.previousElementSibling; }
      if (first) log.insertBefore(div, first); else log.appendChild(div);
    } else log.appendChild(div);
    scroll();
    return div;
  }
  /**
   * En el hilo, al empezar cada ronda, el aviso «Ronda N»; debajo, la marca de turno: «Te toca» (con el reloj de la
   * ronda si lo hay), «Esperando a…», «Turno de…». Si lo último del hilo ya es una marca, se cambia en vez de apilar otra.
   */
  function fightTurnMark(t, round) {
    if (fightRoundShown !== round) {
      fightRoundShown = round;
      var r = document.createElement('div');
      r.className = 'msg notice fightmark round';
      r.setAttribute('role', 'status');
      r.textContent = 'Ronda ' + round;
      fightInsert(r);
      fightTurnKey = null;
    }
    var key = round + '|' + t.kind + '|' + t.text;
    if (key === fightTurnKey) return;
    fightTurnKey = key;
    var dots = log.querySelector('.msg.row.typing');
    var lastEl = dots ? dots.previousElementSibling : log.lastElementChild;
    var div = lastEl && lastEl.classList.contains('turnmark') ? lastEl : document.createElement('div');
    // Las marcas que quedan atrás no llevan reloj: solo cuenta la última.
    Array.prototype.forEach.call(log.querySelectorAll('.msg.turnmark .tm-clock'), function (c) { c.textContent = ''; });
    div.className = 'msg turnmark ' + t.kind;
    div.setAttribute('role', 'status');
    div.innerHTML = '<span>' + escapeHtml(t.kind === 'you' ? 'Te toca' : t.text) + '</span><span class="tm-clock"></span>';
    if (!div.parentNode) fightInsert(div);
    fightClock();
    scroll();
  }
  /** El reloj de la ronda, dentro de la marca de turno: «Te toca · 0:42». */
  function fightClock() {
    var marks = log.querySelectorAll('.msg.turnmark .tm-clock');
    var el = marks[marks.length - 1];
    if (!el) return;
    var d = fight && fight.turn.deadline_ms;
    if (!d) { el.textContent = ''; return; }
    var left = Math.max(0, Math.round((d - Date.now()) / 1000));
    el.textContent = '· ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  }
  function renderFight() {
    var el = $('fight');
    clearInterval(fightTimer);
    if (!fight) { el.hidden = true; el.innerHTML = ''; return; }
    var f = fight;
    var order = f.fighters.map(function (x) {
      var pct = Math.round(x.hp_frac * 100), cls = pct <= 25 ? ' crit' : pct <= 50 ? ' low' : '';
      var mark = x.turn === 'acted' ? '<span class="mark acted" title="Ya ha actuado">✓</span>' : x.turn === 'pending' ? '<span class="mark pending" title="Le falta actuar">●</span>' : '';
      var av = x.avatar ? '<span class="av" style="background-image:url(\'' + escapeHtml(x.avatar) + '\')"></span>' : '<span class="av">' + escapeHtml(fightInitials(x.name)) + '</span>';
      // Los PJ, con sus PV; los NPC, sin números: su estado (Ileso, Herido, Malherido…).
      var hp = x.side === 'pc' ? x.label.replace(/ PV$/, '') : x.label;
      return '<li class="fx-f ' + x.side + (x.me ? ' me' : '') + ' st-' + x.state + (x.turn === 'acting' ? ' acting' : '') + '" title="' + escapeHtml(x.name + ', ' + x.label + (x.away ? ', ausente' : '')) + '">'
        + '<span class="who">' + av + '<span class="nm">' + escapeHtml(x.name) + '</span>' + mark + '</span>'
        + '<span class="bar"><i class="' + cls + '" style="width:' + pct + '%"></i></span>'
        + '<span class="hp">' + escapeHtml(hp + (x.away ? ' · ausente' : '')) + '</span></li>';
    }).join('');
    el.innerHTML = '<span class="fx-badge" role="img" aria-label="Combate">⚔️</span>'
      + '<ol class="fx-order" aria-label="Luchadores">' + order + '</ol>';
    el.hidden = false;
    fightClock();
    if (f.turn.deadline_ms) fightTimer = setInterval(fightClock, 1000);
  }
  /** Estado del combate (SSE «combat»): entra en su turno de la cola del hilo, para ir a la par de la narración. */
  function showFight(s) {
    inChat(function () {
      var was = fight;
      fight = s && s.active ? s : null;
      document.body.classList.toggle('in-combat', Boolean(fight));
      input.placeholder = fight ? '⚔ ¿Qué haces?' : '¿Qué haces?';
      if (fight && (!was || was.key !== fight.key)) {
        fightRoundShown = null;
        var el = $('fight'); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
        document.body.classList.remove('fight-flash'); void document.body.offsetWidth; document.body.classList.add('fight-flash');
        setTimeout(function () { document.body.classList.remove('fight-flash'); }, 1500);
      }
      if (!fight) { fightTurnKey = null; fightRoundShown = null; }
      renderFight();
      if (typeof renderRound === 'function') renderRound();
      if (fight) fightTurnMark(fight.turn, fight.round);
    });
  }
  /** Registro de combates (Ajustes): lo que pasó en cada combate de este PJ, del más reciente al más antiguo. */
  var fightLogBox = null;
  function openFightLog() {
    if (!fightLogBox) {
      fightLogBox = document.createElement('dialog');
      fightLogBox.id = 'fight-log-box';
      fightLogBox.setAttribute('aria-label', 'Registro de combates');
      fightLogBox.innerHTML = '<div class="hd"><h2>Registro de combates</h2><button type="button" class="x" aria-label="Cerrar" title="Cerrar"><svg class="i"><use href="#i-x"/></svg></button></div><div class="bd"></div>';
      fightLogBox.querySelector('.x').addEventListener('click', function () { fightLogBox.close(); });
      fightLogBox.addEventListener('click', function (ev) { if (ev.target === fightLogBox) fightLogBox.close(); });
      document.body.appendChild(fightLogBox);
    }
    var bd = fightLogBox.querySelector('.bd');
    bd.innerHTML = '<p class="none">Cargando…</p>';
    if (!fightLogBox.open) fightLogBox.showModal();
    fetch(api('/api/combats?character=' + encodeURIComponent(current))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var list = j && j.combats || [];
      bd.innerHTML = list.length ? list.map(function (c) {
        return '<section><h3>' + escapeHtml(c.place) + '<small>' + escapeHtml(c.when) + '</small></h3><ol>'
          + c.entries.map(function (l) { return '<li class="' + l.tone + '">' + escapeHtml(l.text) + '</li>'; }).join('') + '</ol></section>';
      }).join('') : '<p class="none">Aún no has estado en ningún combate.</p>';
    }).catch(function () { bd.innerHTML = '<p class="none">No se ha podido cargar el registro.</p>'; });
  }
`;
