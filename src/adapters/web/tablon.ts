/**
 * Tablón en la web (issue #19): los encargos que el motor tiene en el tablón ahora, con quién los pide, recompensa y
 * plazo, y los que el PJ ya cogió. Sale de los mismos datos que /tablon (progress.ts, quests.ts) y del Diario
 * (journal.ts) para saber qué cogió: un encargo se coge hablando de él con quien lo pide.
 *
 *   GET  /api/tablon?character=ID   la vista, sin tocar nada (el aviso de nuevos del panel)
 *   POST /api/tablon/read {character}   abrir el Tablón es leerlo, como /tablon: entran en el Diario, con su aviso
 *
 * El plazo es el del propio tablón: al salir de él un encargo no se puede cobrar (completeJob), así que se dice cuándo.
 */

import { GAME_DAY } from '../../clock/clock.js';
import type { Engine } from '../../engine/engine.js';
import { journalOf, type JournalQuest } from '../../engine/journal.js';
import type { Id, Job } from '../../engine/model.js';
import { money } from '../../engine/money.js';
import { maskUnknownNames } from '../../engine/narrate.js';
import { activeJobs, leavesBoardAt } from '../../engine/progress.js';
import { boardSeen } from '../../engine/quests.js';

export interface TablonJob {
  id: Id;
  title: string;
  text: string;
  giver: { id: Id; name: string; role: string } | null;
  reward: string;
  /** Hasta cuándo vale, en palabras del jugador. */
  deadline: string;
  /** Ya no está en el tablón: no se puede cobrar hasta que vuelva a salir. */
  off_board?: boolean;
  steps: { text: string; done: boolean }[];
  /** Aún no lo había leído. */
  fresh: boolean;
}

export interface WebTablon {
  /** Dónde está el tablón de la campaña; null si ningún sitio lo tiene (se lee igual, con /tablon). */
  place: { spot: string; location: string; here: boolean } | null;
  available: TablonJob[];
  /** Los que el PJ ha cogido y siguen abiertos. */
  taken: TablonJob[];
  /** Los que ya cumplió: cada encargo suma una vez. */
  done: TablonJob[];
}

/** «5 h» o «2 días» de juego. */
function leftText(s: number): string {
  const h = Math.max(1, Math.ceil(s / 3600));
  if (h < 48) return `${h} h`;
  return `${Math.round(s / GAME_DAY)} días`;
}

/**
 * La vista del tablón para un PJ. `justRead`: los que acaba de leer al abrirlo, que aún se marcan como nuevos.
 */
export function tablonView(engine: Engine, characterId: Id, justRead: readonly Id[] = []): WebTablon {
  const w = engine.world;
  const c = w.character(characterId);
  const nowG = engine.gameNow();
  const seen = boardSeen(c);
  const quests = journalOf(engine, characterId).quests;
  const asQuest = (id: Id, list: readonly JournalQuest[]) => list.find((q) => q.kind === 'job' && q.id === id);
  const onBoard = activeJobs(w);
  const view = (j: Job, deadline: string, steps: TablonJob['steps'] = []): TablonJob => {
    const npc = w.npcs.get(j.giver_npc_id);
    return {
      id: j.id, title: j.title, text: maskUnknownNames(w, c.id, j.text),
      // El aviso firma: leído, se sabe quién lo pide (quests.ts, readBoard).
      giver: npc ? { id: npc.id, name: npc.name, role: npc.role } : null,
      reward: `${money(w, j.reward_coins)}${j.reward_reputation ? ` · +${j.reward_reputation} de reputación` : ''}`,
      deadline, steps, fresh: seen[j.id] === undefined || justRead.includes(j.id),
    };
  };
  const untilChange = (j: Job): string => {
    const at = leavesBoardAt(w, j.id, nowG);
    if (at === null) return 'Sin plazo: sigue en el tablón';
    const when = engine.clock.format(at).replace(/, año \d+/, '');
    return `Hasta el ${when.charAt(0).toLowerCase()}${when.slice(1)} · quedan ${leftText(at - nowG)} de juego`;
  };
  const onBoardIds = new Set(onBoard.map((j) => j.id));
  const taken = w.campaign.jobs.flatMap((j) => {
    const q = asQuest(j.id, quests.active);
    if (!q || q.status !== 'active') return [];
    const off = !onBoardIds.has(j.id);
    return [{ ...view(j, off ? 'Ya no está en el tablón: hasta que vuelva a salir, no se puede cobrar' : untilChange(j), q.steps), ...(off ? { off_board: true } : {}) }];
  });
  const takenIds = new Set(taken.map((j) => j.id));
  const spot = [...w.spots.values()].find((s) => s.tags.includes('notice'));
  return {
    place: spot ? { spot: spot.name, location: w.locations.get(spot.location_id)?.name ?? '', here: w.characterSpot(c)?.id === spot.id } : null,
    available: onBoard.filter((j) => !takenIds.has(j.id) && !c.completed_jobs.includes(j.id)).map((j) => view(j, untilChange(j))),
    taken,
    done: w.campaign.jobs.filter((j) => c.completed_jobs.includes(j.id)).map((j) => view(j, 'Cumplido', asQuest(j.id, quests.completed)?.steps ?? [])),
  };
}

export const TABLON_STYLE = String.raw`
  #tablon-side:empty { display: none; }
  #cube-menu .bub.tablon { background: #b59ad6; color: #221533; }
  #tablon .tb-where { margin: 0 0 14px; font-size: 13px; color: var(--muted); }
  #tablon .tb-where b { color: var(--text); font-weight: 600; }
  #tablon h3 { display: flex; align-items: baseline; gap: 6px; margin: 18px 0 8px; font: 700 14px/1.2 var(--display); }
  #tablon h3 span { font: 500 12px/1 var(--sans); color: var(--muted); }
  #tablon .tb-job { margin: 0 0 10px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--bubble); }
  #tablon .tb-job.fresh { border-color: rgba(230,183,90,.5); }
  #tablon .tb-job.off, #tablon .tb-job.done { opacity: .72; }
  #tablon .tb-job b { display: block; font-size: 14.5px; font-weight: 600; }
  #tablon .tb-job b i { margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: var(--accent-tint); color: var(--accent); font: 600 11px/1.4 var(--sans); }
  #tablon .tb-job p { margin: 4px 0 8px; font-size: 13.5px; line-height: 1.45; }
  #tablon .tb-job dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; font-size: 12.5px; }
  #tablon .tb-job dt { color: var(--muted); }
  #tablon .tb-job dd { margin: 0; }
  #tablon .tb-job ul { margin: 8px 0 0; padding: 0 0 0 18px; font-size: 13px; }
  #tablon .tb-job li.ok { color: var(--muted); text-decoration: line-through; }
  #tablon .tb-ask { height: 32px; margin-top: 10px; padding: 0 14px; border: 1px solid rgba(230,183,90,.45); border-radius: 999px; background: var(--accent-tint); color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  #tablon .tb-ask:hover { background: rgba(230,183,90,.24); }
`;

export const TABLON_JS = String.raw`
  // --- Tablón (tablon.ts): los encargos del motor, en el cajón; la fila del panel avisa de los que no se han leído. ---
  var tablonSeq = 0;
  /** Los recién leídos siguen marcados como nuevos mientras el cajón siga abierto (cada aviso del motor lo vuelve a pedir). */
  var tablonNew = {};
  function tablonJobHtml(j, ctx) {
    var who = j.giver ? j.giver.name + (j.giver.role ? ' (' + j.giver.role + ')' : '') : '';
    var h = '<article class="tb-job' + (j.fresh ? ' fresh' : '') + (j.off_board ? ' off' : '') + (ctx === 'done' ? ' done' : '') + '"><b>' + escapeHtml(j.title) + (j.fresh ? '<i>Nuevo</i>' : '') + '</b><p>' + escapeHtml(j.text) + '</p><dl>' +
      (who ? '<dt>Lo pide</dt><dd>' + escapeHtml(who) + '</dd>' : '') + '<dt>Recompensa</dt><dd>' + escapeHtml(j.reward) + '</dd>' +
      (ctx === 'done' ? '' : '<dt>Plazo</dt><dd>' + escapeHtml(j.deadline) + '</dd>') + '</dl>';
    if (ctx === 'taken' && j.steps.length) h += '<ul>' + j.steps.map(function (s) { return '<li' + (s.done ? ' class="ok"' : '') + '>' + escapeHtml(s.text) + '</li>'; }).join('') + '</ul>';
    if (ctx === 'available' && j.giver) h += '<button type="button" class="tb-ask" data-ask="' + escapeHtml('Hablo con ' + j.giver.name + ' sobre «' + j.title + '»') + '">Preguntar a ' + escapeHtml(j.giver.name) + '</button>';
    return h + '</article>';
  }
  function renderTablon(t) {
    var p = t.place, h = p ? '<p class="tb-where"><b>' + escapeHtml(p.spot.charAt(0).toUpperCase() + p.spot.slice(1)) + '</b>' + (p.location ? ' de ' + escapeHtml(p.location) : '') + (p.here ? ' · estás delante' : '') + '</p>' : '';
    h += '<h3>Disponibles <span>' + t.available.length + '</span></h3>' + (t.available.length ? t.available.map(function (j) { return tablonJobHtml(j, 'available'); }).join('') : '<p class="empty">No queda ninguno por coger: el tablón cambia cada día.</p>');
    h += '<h3>Los que has cogido <span>' + t.taken.length + '</span></h3>' + (t.taken.length ? t.taken.map(function (j) { return tablonJobHtml(j, 'taken'); }).join('') : '<p class="empty">Ninguno. Un encargo se coge hablando de él con quien lo pide.</p>');
    if (t.done.length) h += '<h3>Cumplidos <span>' + t.done.length + '</span></h3>' + t.done.map(function (j) { return tablonJobHtml(j, 'done'); }).join('');
    $('tablon').innerHTML = h;
  }
  /** La fila del panel y el punto del menú: cuántos hay y cuántos sin leer. */
  function tablonBadge(t) {
    var fresh = t.available.filter(function (j) { return j.fresh; }).length, n = t.available.length;
    if (!n && !t.taken.length) { $('tablon-side').innerHTML = ''; }
    else $('tablon-side').innerHTML = '<button type="button" class="prow" data-tablon><span class="ico"><svg class="i"><use href="#i-board"/></svg></span><span class="tt"><b>Tablón</b><small>' +
      escapeHtml([n + (n === 1 ? ' encargo' : ' encargos'), fresh ? fresh + ' sin leer' : '', t.taken.length ? t.taken.length + ' en curso' : ''].filter(Boolean).join(' · ')) + '</small></span></button>';
    var dot = document.querySelector('#cube-menu [data-open="tablon"] .dotnew');
    if (dot) { dot.hidden = !fresh; cubeNew(); }
    var tab = document.querySelector('[data-dr="tablon"]');
    if (tab) tab.classList.toggle('new', Boolean(fresh));
  }
  /** Pide la vista; con el cajón del Tablón abierto, además lo lee (entran en el Diario, como con /tablon). */
  function loadTablon() {
    if (!current) return;
    var seq = ++tablonSeq, id = current, reading = drawerKey === 'tablon' && !drawer.hidden;
    (reading ? post('/api/tablon/read', {}) : fetch(api('/api/tablon?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; })).then(function (t) {
      if (id !== current || !t || !t.available) return;
      // La respuesta que los lee puede llegar después de otra más nueva, y solo ella sabe cuáles son nuevos: esa se pinta igual.
      var marked = false;
      if (reading) t.available.forEach(function (j) { if (j.fresh) { tablonNew[j.id] = 1; marked = true; } else if (tablonNew[j.id]) j.fresh = true; });
      if (seq !== tablonSeq && !marked) return;
      renderTablon(t);
      tablonBadge(reading ? { available: t.available.map(function (j) { return Object.assign({}, j, { fresh: false }); }), taken: t.taken } : t);
    }).catch(function () {});
  }
  document.addEventListener('click', function (ev) {
    var open = ev.target.closest('[data-tablon]');
    if (open) { showSide(false); openDrawer('tablon'); return; }
    var ask = ev.target.closest('#tablon [data-ask]');
    if (ask) { closeDrawer(); showSide(false); input.value = ask.getAttribute('data-ask'); input.focus(); }
  });
`;
