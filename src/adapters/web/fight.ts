/**
 * Combate en la web: el estado que el servidor manda a cada jugador implicado
 * (SSE `combat`) y cómo lo pinta la página.
 *
 *   - combatView: el encuentro (engine/encounter.ts) visto por un PJ, con los
 *     nombres como los conoce, sus PV exactos y los de los demás PJ, solo el
 *     estado de los NPC, de quién es el turno y el registro corto en texto.
 *   - El turno sale de la ronda abierta del motor (escena tensa, scene.ts) y de
 *     las acciones en vuelo en el sitio (la cola que ya pintaba «Esperando a…»).
 *   - La página: al empezar, aviso en el hilo y tono de combate; arriba, la
 *     cabecera fija (ronda, orden de iniciativa con avatares, PV o estado,
 *     registro plegable); en el hilo, una marca cada vez que cambia el turno.
 *     Al acabar, aviso de fin y vuelta al tono normal.
 */

import type { SceneNotice } from '../../engine/engine.js';
import type { Encounter, EncounterEntry, FighterState } from '../../engine/encounter.js';
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

const STATE_LABEL: Record<FighterState, string> = { ok: 'Ileso', hurt: 'Herido', bloodied: 'Malherido', down: 'Caído', stable: 'Estable', dead: 'Muerto' };
const NPC_FRAC: Record<FighterState, number> = { ok: 1, hurt: 0.75, bloodied: 0.35, down: 0, stable: 0, dead: 0 };

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
      const tail = x.dead ? ' y cae muerto' : x.down ? ' y cae' : '';
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

export const FIGHT_STYLE = String.raw`
  /* Combate (fight.ts): tono rojo mientras dura, cabecera fija sobre el hilo y marcas de turno en él. */
  :root { --fight: #e0604f; --fight-ink: #ffd9d2; --fight-tint: rgba(224,96,79,.14); --fight-line: rgba(224,96,79,.38); }
  body.in-combat .chat-head { border-bottom-color: var(--fight-line); box-shadow: 0 1px 0 var(--fight-line), 0 1px 6px rgba(0,0,0,.35); }
  body.in-combat .chat-body::after { content: ''; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 90px rgba(224,96,79,.13); }
  body.in-combat form { border-top-color: var(--fight-line); }
  body.in-combat form input { box-shadow: inset 0 0 0 1px rgba(224,96,79,.25); }
  body.fight-flash .chat-body::after { animation: fight-flash 1.4s ease-out; }
  @keyframes fight-flash { 0% { box-shadow: inset 0 0 160px rgba(224,96,79,.55); } 100% { box-shadow: inset 0 0 90px rgba(224,96,79,.13); } }
  #fight { position: relative; z-index: 2; flex: none; padding: 8px max(16px, calc((100% - 980px) / 2)) 8px; background: linear-gradient(180deg, #2a1512, #1a1110); border-bottom: 1px solid var(--fight-line); box-shadow: 0 4px 12px rgba(0,0,0,.4); color: var(--text); }
  #fight[hidden] { display: none; }
  #fight.enter { animation: fight-in .45s cubic-bezier(.2,.8,.2,1); }
  @keyframes fight-in { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: none; } }
  #fight .fx-top { display: flex; align-items: center; gap: 8px; min-height: 26px; }
  #fight .fx-badge { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 999px; background: var(--fight); color: #2a0b06; font: 800 11.5px/1 var(--display); letter-spacing: .04em; text-transform: uppercase; flex: none; }
  #fight .fx-round { font: 700 13px/1 var(--display); color: var(--fight-ink); flex: none; }
  #fight .fx-turn { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: #e9c7bf; }
  #fight .fx-turn.you { color: var(--accent); }
  #fight .fx-turn.you::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: var(--accent); vertical-align: 1px; animation: fight-pulse 1.2s ease-in-out infinite; }
  #fight .fx-turn.down { color: var(--muted); }
  @keyframes fight-pulse { 50% { opacity: .35; } }
  #fight .fx-clock { font: 600 12.5px/1 var(--mono); color: #e9c7bf; flex: none; }
  #fight .fx-logbtn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border: 0; border-radius: 999px; background: rgba(255,255,255,.07); color: #e9c7bf; font-size: 12px; font-weight: 500; flex: none; }
  #fight .fx-logbtn:hover { background: rgba(255,255,255,.12); }
  #fight .fx-logbtn::after { content: '▾'; font-size: 10px; transition: transform .2s; }
  #fight .fx-logbtn[aria-expanded="true"]::after { transform: rotate(180deg); }
  #fight .fx-order { display: flex; gap: 6px; margin: 8px 0 0; padding: 0 0 2px; list-style: none; overflow-x: auto; scrollbar-width: none; }
  #fight .fx-order::-webkit-scrollbar { display: none; }
  #fight .fx-f { position: relative; display: flex; align-items: center; gap: 7px; flex: none; min-width: 0; padding: 4px 9px 4px 4px; border-radius: 999px; background: rgba(255,255,255,.05); border: 1px solid transparent; }
  #fight .fx-f.me { background: rgba(230,183,90,.1); }
  #fight .fx-f.acting, #fight .fx-f.turn-now { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(230,183,90,.18); }
  #fight .fx-f.st-dead, #fight .fx-f.st-down, #fight .fx-f.st-stable { opacity: .55; }
  #fight .fx-f .ini { position: absolute; left: -2px; top: -4px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 999px; background: #120b0a; border: 1px solid var(--fight-line); color: var(--fight-ink); font: 700 9.5px/14px var(--sans); text-align: center; }
  #fight .fx-f .av { position: relative; width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 50%; overflow: hidden; background: #22262a; background-size: cover; background-position: center; color: var(--muted); font-size: 11.5px; font-weight: 700; box-shadow: inset 0 0 0 2px rgba(255,255,255,.12); }
  #fight .fx-f.pc .av { color: var(--accent); background-color: #2a1d05; box-shadow: inset 0 0 0 2px rgba(230,183,90,.6); }
  #fight .fx-f.npc .av { color: #ff9d94; background-color: #2b1412; box-shadow: inset 0 0 0 2px rgba(224,96,79,.65); }
  #fight .fx-f .tx { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  #fight .fx-f .nm { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; line-height: 1.1; }
  #fight .fx-f .hp { display: flex; align-items: center; gap: 6px; font-size: 11px; line-height: 1; color: var(--muted); white-space: nowrap; }
  #fight .fx-f .bar { width: 42px; height: 4px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; flex: none; }
  #fight .fx-f .bar i { display: block; height: 100%; border-radius: 999px; background: var(--ok); }
  #fight .fx-f .bar i.low { background: var(--accent); } #fight .fx-f .bar i.crit { background: var(--error); }
  #fight .fx-f .mark { margin-left: 4px; font-size: 11px; line-height: 1; }
  #fight .fx-f .mark.pending { font-size: 8px; vertical-align: 1px; animation: fight-pulse 1.2s ease-in-out infinite; }
  #fight .fx-f .mark.acted { color: var(--ok); } #fight .fx-f .mark.pending { color: var(--accent); }
  #fight .fx-log { margin: 8px 0 0; padding: 6px 10px; list-style: none; border-radius: 10px; background: rgba(0,0,0,.25); font-size: 12.5px; line-height: 1.5; max-height: 132px; overflow-y: auto; }
  #fight .fx-log[hidden] { display: none; }
  #fight .fx-log li { color: #cfc8be; }
  #fight .fx-log li.hit { color: #f0b3a3; } #fight .fx-log li.down { color: #ff8a7d; font-weight: 600; } #fight .fx-log li.heal { color: #8fd8a8; } #fight .fx-log li.miss { color: var(--muted); }
  #fight .fx-log .none { color: var(--muted); font-style: italic; }
  /* En el hilo: aviso de inicio y de fin (sobre el aviso del sistema) y la marca de cada turno. */
  .msg.notice.fightmark { gap: 6px; border-color: var(--fight-line); background: #241311; color: var(--fight-ink); font-weight: 600; }
  .msg.notice.fightmark.end { border-color: var(--sep); background: #161a1b; color: #b8b1a6; }
  .msg.turnmark { align-self: center; display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 2px; padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #e9c7bf; background: rgba(224,96,79,.1); box-shadow: inset 0 0 0 1px rgba(224,96,79,.28); }
  .msg.turnmark.you { color: var(--accent-ink); background: var(--accent); box-shadow: none; }
  .msg.turnmark.wait, .msg.turnmark.resolving, .msg.turnmark.down { color: var(--muted); background: rgba(255,255,255,.04); box-shadow: inset 0 0 0 1px var(--sep); }
  @media (max-width: 820px) {
    #fight { padding: 6px 10px 6px; }
    #fight .fx-round { font-size: 12.5px; }
    #fight .fx-turn { font-size: 12.5px; }
    #fight .fx-logbtn { padding: 0 8px; font-size: 11.5px; }
    #fight .fx-order { margin-top: 6px; }
    #fight .fx-f { padding: 3px 8px 3px 3px; gap: 6px; }
    #fight .fx-f .av { width: 28px; height: 28px; }
    #fight .fx-f .nm { max-width: 76px; font-size: 12px; }
    #fight .fx-f .bar { width: 30px; }
  }
`;

/**
 * Va en el script de la página (page.ts), con su ámbito: $, log, inChat, escapeHtml, scroll, input.
 * El estado llega por SSE «combat»; los avisos de inicio y fin, como mensajes del hilo (m.combat).
 */
export const FIGHT_SCRIPT = String.raw`
  var fight = null, fightTurnKey = null, fightTimer = null, fightLogOpen = false;
  try { fightLogOpen = localStorage.getItem('tavernus.fightlog') === '1'; } catch (e) {}
  function fightInitials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  /** Aviso de inicio o fin en el hilo (mensaje del servidor con m.combat). */
  function fightMark(c) {
    var div = document.createElement('div');
    div.className = 'msg notice fightmark ' + c.phase;
    div.setAttribute('role', 'status');
    div.textContent = c.text;
    // El aviso de inicio va delante de la marca de turno si esta ya se había pintado.
    var lastEl = log.lastElementChild;
    if (c.phase === 'start' && lastEl && lastEl.classList.contains('turnmark')) log.insertBefore(div, lastEl); else log.appendChild(div);
    scroll();
    return div;
  }
  /** Marca de turno en el hilo: si lo último del hilo ya es una marca, se cambia en lugar de apilar otra. */
  function fightTurnMark(t, round) {
    var key = round + '|' + t.kind + '|' + t.text;
    if (key === fightTurnKey) return;
    fightTurnKey = key;
    var dots = log.querySelector('.msg.row.typing');
    var lastEl = dots ? dots.previousElementSibling : log.lastElementChild;
    var div = lastEl && lastEl.classList.contains('turnmark') ? lastEl : document.createElement('div');
    div.className = 'msg turnmark ' + t.kind;
    div.setAttribute('role', 'status');
    div.textContent = (t.kind === 'you' ? 'Ronda ' + round + ' · ' : '') + t.text;
    if (!div.parentNode) { if (dots) log.insertBefore(div, dots); else log.appendChild(div); }
    scroll();
  }
  function fightClock() {
    var el = document.querySelector('#fight .fx-clock');
    if (!el) return;
    var d = fight && fight.turn.deadline_ms;
    if (!d) { el.textContent = ''; return; }
    var left = Math.max(0, Math.round((d - Date.now()) / 1000));
    el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
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
      var now = (f.turn.kind === 'you' && x.me) || x.turn === 'acting';
      return '<li class="fx-f ' + x.side + (x.me ? ' me' : '') + ' st-' + x.state + (now ? ' turn-now' : '') + '" title="' + escapeHtml(x.name + ' · iniciativa ' + x.initiative + ' · ' + x.label + (x.away ? ' · ausente' : '')) + '">'
        + '<span class="ini">' + x.initiative + '</span>' + av
        + '<span class="tx"><span class="nm">' + escapeHtml(x.name) + mark + '</span>'
        + '<span class="hp"><span class="bar"><i class="' + cls + '" style="width:' + pct + '%"></i></span>' + escapeHtml(x.label) + '</span></span></li>';
    }).join('');
    var logHtml = f.log.length ? f.log.slice().reverse().map(function (l) { return '<li class="' + l.tone + '">' + escapeHtml(l.text) + '</li>'; }).join('') : '<li class="none">Aún no ha habido golpes.</li>';
    el.innerHTML = '<div class="fx-top"><span class="fx-badge">⚔ Combate</span><span class="fx-round">Ronda ' + f.round + '</span>'
      + '<span class="fx-turn ' + f.turn.kind + '" role="status">' + escapeHtml(f.turn.text) + '</span><span class="fx-clock"></span>'
      + '<button type="button" class="fx-logbtn" aria-expanded="' + fightLogOpen + '" aria-controls="fx-log" title="Últimas acciones">Registro</button></div>'
      + '<ol class="fx-order" aria-label="Orden de iniciativa">' + order + '</ol>'
      + '<ol class="fx-log" id="fx-log"' + (fightLogOpen ? '' : ' hidden') + ' aria-label="Últimas acciones">' + logHtml + '</ol>';
    el.querySelector('.fx-logbtn').addEventListener('click', function () {
      fightLogOpen = !fightLogOpen;
      try { localStorage.setItem('tavernus.fightlog', fightLogOpen ? '1' : '0'); } catch (e) {}
      renderFight();
    });
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
        var el = $('fight'); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
        document.body.classList.remove('fight-flash'); void document.body.offsetWidth; document.body.classList.add('fight-flash');
        setTimeout(function () { document.body.classList.remove('fight-flash'); }, 1500);
      }
      if (!fight) fightTurnKey = null;
      renderFight();
      if (typeof renderRound === 'function') renderRound();
      if (fight) fightTurnMark(fight.turn, fight.round);
    });
  }
`;
