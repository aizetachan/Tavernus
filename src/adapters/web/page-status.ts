/**
 * /admin/estado: cómo va el servidor y qué han reportado los jugadores (issue #18, docs/DESPLIEGUE.md).
 * HTML hecho en el servidor y sin scripts, con el contexto de cada reporte plegado. Todo lo que viene de
 * una partida (lo que escribe el jugador, la narración, los nombres) pasa por `esc`: el administrador
 * tiene la cookie que importa, así que un reporte no puede meterle nada en esta página.
 */
import { HEAD } from './page-access.js';
import type { Report, StoredReport } from './report.js';
import type { Totals } from './status.js';

export interface StatusData {
  started_at: number;
  now: number;
  /** Zona horaria en que se muestran las horas (la del cupo, BUDGET_TZ). */
  tz: string;
  version: string | null;
  access: string;
  games: { slug: string; name: string; mode: string; players: string[] }[];
  hour: Totals;
  today: Totals;
  reports: { total: number; items: StoredReport[] };
}

/** Lo largo se recorta en la página; el JSON del reporte lo tiene entero. */
const MAX_TOOL_TEXT = 2000;
const MAX_CONTEXT = 20_000;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const STYLE = `<style>
  body { padding: 24px 16px 64px; }
  .box.status { max-width: 960px; }
  h2 { font: 700 15px/1.3 var(--display); margin: 26px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 7px 10px 7px 0; border-top: 1px solid var(--line); vertical-align: top; }
  thead th { border-top: 0; color: var(--muted); font-weight: 500; font-size: 13px; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bad { color: var(--error); font-weight: 600; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0 0; font-size: 14px; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; }
  .scroll-x { overflow-x: auto; }
  .topbar { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  details.report { border-top: 1px solid var(--line); padding: 10px 0; }
  details.report > summary { cursor: pointer; display: grid; gap: 2px; }
  details.report > summary .head { color: var(--muted); font-size: 13px; }
  details.report > summary .said { color: var(--text); overflow-wrap: anywhere; }
  .ctx { margin: 12px 0 4px; padding-left: 12px; border-left: 2px solid var(--line); display: grid; gap: 10px; font-size: 14px; }
  .ctx h3 { margin: 0 0 2px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .ctx p { margin: 0; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .ctx details > summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  pre { margin: 6px 0 0; padding: 10px; border-radius: 10px; background: var(--bubble); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d9d2c6; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; overflow-y: auto; }
  code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>`;

function dateFn(tz: string): (ms: number) => string {
  return (ms) => {
    try { return new Date(ms).toLocaleString('es-ES', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' }); } catch { return new Date(ms).toISOString(); }
  };
}

function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} días`;
}

function count(n: number): string { return n.toLocaleString('es-ES'); }
function usd(n: number): string { return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`; }
function clip(s: string, max: number): string { return s.length > max ? `${s.slice(0, max)}\n… (recortado: el resto está en el fichero del reporte)` : s; }
function pretty(v: unknown): string { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? ''; }

function gamesTable(games: StatusData['games']): string {
  const on = games.filter((g) => g.players.length).sort((a, b) => b.players.length - a.players.length);
  const off = games.length - on.length;
  const rows = on.map((g) => `<tr><td>${esc(g.name)} <span class="muted">${esc(g.slug)}</span></td><td>${esc(g.mode)}</td><td class="n">${g.players.length}</td><td>${g.players.map(esc).join(', ')}</td></tr>`).join('');
  return (on.length
    ? `<div class="scroll-x"><table><thead><tr><th>Partida</th><th>Modo</th><th class="n">Conectados</th><th>Quién</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p>No hay nadie conectado.</p>')
    + (on.length && off ? `<p class="muted">${off === 1 ? 'Otra partida' : `Otras ${off} partidas`} sin nadie conectado.</p>` : '');
}

function activityTable(h: Totals, d: Totals): string {
  const row = (label: string, a: string, b: string, bad = false) => `<tr><td>${label}</td><td class="n${bad && a !== '0' ? ' bad' : ''}">${a}</td><td class="n${bad && b !== '0' ? ' bad' : ''}">${b}</td></tr>`;
  const note = d.unpriced ? `<p class="muted">Hoy, ${count(d.unpriced)} llamadas de modelos sin precio conocido no cuentan en el coste.</p>` : '';
  return `<div class="scroll-x"><table><thead><tr><th></th><th class="n">Última hora</th><th class="n">Hoy</th></tr></thead><tbody>${
    row('Acciones de los jugadores', count(h.actions), count(d.actions))
  }${row('Llamadas al máster', count(h.master_calls), count(d.master_calls))
  }${row('Errores del máster', count(h.master_errors), count(d.master_errors), true)
  }${row('Acciones con error del servidor', count(h.action_errors), count(d.action_errors), true)
  }${row('Tokens', count(h.tokens), count(d.tokens))
  }${row('Coste estimado del máster', usd(h.usd), usd(d.usd))
  }</tbody></table></div>${note}`;
}

/** Lo que el motor guarda del máster en el evento (engine.ts, resolveWithMaster). Un evento sin él lo resolvió el motor. */
interface MasterMeta {
  model?: string;
  usage?: { input?: number; output?: number; cache_read?: number; cache_write?: number; iterations?: number; ms?: number };
  calls?: { name?: string; input?: unknown; result?: string }[];
  context?: string;
  actor?: { model?: string; input?: number; output?: number };
}

function eventContext(r: Report): string {
  const e = r.event;
  if (!e) return '<p>Sin evento: este PJ aún no había vivido nada.</p>';
  const m = (e.payload['master'] ?? null) as MasterMeta | null;
  const u = m?.usage;
  const out: string[] = [];
  out.push(`<div><h3>Evento</h3><p>seq ${esc(e.seq)} · <code>${esc(e.action_type)}</code> · ${e.tags.length ? esc(e.tags.join(', ')) : 'sin etiquetas'}</p></div>`);
  if (e.input_text) out.push(`<div><h3>Lo que hizo el jugador</h3><p>${esc(e.input_text)}</p></div>`);
  if (e.narration_private) out.push(`<div><h3>Narración</h3><p>${esc(e.narration_private)}</p></div>`);
  if (r.read && r.read.text !== e.narration_private) out.push(`<div><h3>Lo que leyó este PJ (${esc(r.read.level)})</h3><p>${esc(r.read.text)}</p></div>`);
  if (m) {
    const tokens = u ? `entrada ${count(u.input ?? 0)}, salida ${count(u.output ?? 0)}, caché leída ${count(u.cache_read ?? 0)}, caché escrita ${count(u.cache_write ?? 0)}` : 'sin datos';
    const turns = u?.iterations ? ` · ${u.iterations} ${u.iterations === 1 ? 'vuelta' : 'vueltas'}` : '';
    const ms = u?.ms ? ` · ${count(u.ms)} ms` : '';
    const actor = m.actor ? `<p>Actor: ${esc(m.actor.model)} (entrada ${count(m.actor.input ?? 0)}, salida ${count(m.actor.output ?? 0)})</p>` : '';
    out.push(`<div><h3>Máster</h3><p>${esc(m.model ?? 'modelo desconocido')}${turns}${ms}</p><p>Tokens: ${tokens}</p>${actor}</div>`);
    const calls = m.calls ?? [];
    if (calls.length) {
      out.push(`<div><h3>Tools (${calls.length})</h3>${calls.map((c) => `<details><summary><code>${esc(c.name)}</code></summary><pre>${esc(clip(pretty(c.input), MAX_TOOL_TEXT))}</pre><pre>${esc(clip(pretty(c.result), MAX_TOOL_TEXT))}</pre></details>`).join('')}</div>`);
    }
    if (m.context) out.push(`<details><summary>Contexto que recibió el máster</summary><pre>${esc(clip(m.context, MAX_CONTEXT))}</pre></details>`);
  } else {
    out.push('<div><h3>Máster</h3><p>No intervino: lo resolvió el motor.</p></div>');
  }
  if (r.recent.length > 1) {
    out.push(`<details><summary>Lo que había vivido antes</summary><pre>${esc(r.recent.map((x) => `#${x.seq} ${x.action_type}: ${clip(x.text, 300)}`).join('\n\n'))}</pre></details>`);
  }
  return out.join('');
}

function reportItem(item: StoredReport, date: (ms: number) => string): string {
  const r = item.report;
  if (!r) return `<details class="report"><summary><span class="head">${esc(item.game_name)} · <code>${esc(item.file)}</code></span><span class="said">No se ha podido leer este reporte.</span></summary></details>`;
  const when = Date.parse(r.at);
  return `<details class="report"><summary>`
    + `<span class="head">${esc(Number.isNaN(when) ? r.at : date(when))} · ${esc(item.game_name)} · ${esc(r.character?.name)}${r.general ? ' · algo va mal' : ` · evento ${esc(r.seq)}`}</span>`
    + `<span class="said">${esc(r.text)}</span></summary>`
    + `<div class="ctx">${eventContext(r)}`
    + `<div><h3>Datos</h3><p>Partida <code>${esc(item.slug)}</code> · PJ <code>${esc(r.character?.id)}</code> · versión ${esc(r.server_version ?? 'desconocida')}</p>`
    + `<p>Hora en su navegador: ${esc(r.client_at ?? 'no la mandó')}</p>`
    + (r.user_agent ? `<p>Navegador: ${esc(r.user_agent)}</p>` : '')
    + `<p>Fichero: <code>${esc(item.slug)}/reports/${esc(item.file)}</code></p></div>`
    + `</div></details>`;
}

export function statusPage(d: StatusData): string {
  const date = dateFn(d.tz);
  const more = d.reports.total - d.reports.items.length;
  return `${HEAD('Estado · Tavernus')}${STYLE}
<main class="box wide status">
  <div class="eyebrow">Tavernus</div>
  <h1>Estado del servidor</h1>
  <dl class="facts">
    <dt>En marcha desde</dt><dd>${esc(date(d.started_at))} (${esc(ago(d.now - d.started_at))})</dd>
    <dt>Versión</dt><dd>${esc(d.version ?? 'desconocida')}</dd>
    <dt>Acceso</dt><dd>${esc(d.access)}</dd>
    <dt>Horas en</dt><dd>${esc(d.tz)}</dd>
  </dl>
  <div class="topbar"><a class="btn ghost sm" href="/admin/estado">Actualizar</a><a class="btn ghost sm" href="/">Partidas</a></div>
  <h2>Jugadores conectados</h2>
  ${gamesTable(d.games)}
  <h2>Actividad</h2>
  ${activityTable(d.hour, d.today)}
  <h2>Reportes (${count(d.reports.total)})</h2>
  ${d.reports.items.length ? d.reports.items.map((x) => reportItem(x, date)).join('') : '<p>Nadie ha reportado nada.</p>'}
  ${more > 0 ? `<p class="muted">Solo salen los ${count(d.reports.items.length)} más recientes. Los otros ${count(more)} están en <code>&lt;partida&gt;/reports/</code>.</p>` : ''}
</main>
</body>
</html>
`;
}
