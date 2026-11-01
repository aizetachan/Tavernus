/**
 * Páginas del acceso por invitación (access.ts): «pide una invitación», crear tu
 * personaje en un asiento libre (con el asistente de page-creation.ts) y, para el anfitrión, los asientos de una partida
 * con sus enlaces. Pequeñas y sin dependencias, con el mismo aire que el menú.
 */

import type { ChargenCatalog } from '../../engine/chargen.js';
import { CHARGEN_CSS, CHARGEN_JS } from './page-creation.js';

export const HEAD = (title: string, css = '') => String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
<meta name="theme-color" content="#141617">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/assets/icon-512.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<style>
  :root {
    --bg: #0e0f10; --panel: #141617; --bubble: #1f2426; --text: #ece7df; --muted: #9a948a;
    --accent: #e6b75a; --accent-ink: #2a1d05; --glow: #f0c56b; --line: rgba(255,255,255,.08); --hover: rgba(255,255,255,.06);
    --error: #ff6b5e; --ok: #4fbf7a;
    --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --display: Manrope, Inter, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { background: var(--bg); color: var(--text); font: 15px/1.5 var(--sans); -webkit-font-smoothing: antialiased; padding: 32px 16px; }
  input, select, button { font: inherit; color: inherit; }
  button { cursor: pointer; border: 0; }
  button:disabled { opacity: .5; cursor: default; }
  .box { max-width: 560px; margin: 0 auto; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 24px; }
  .box.wide { max-width: 820px; }
  h1 { font: 800 22px/1.2 var(--display); margin: 0 0 6px; }
  .eyebrow { color: var(--accent); font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
  p { margin: 8px 0; color: var(--muted); }
  label { display: block; margin: 12px 0 0; font-size: 13px; color: var(--muted); }
  input[type=text], select { display: block; width: 100%; margin-top: 4px; height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bubble); }
  .check { display: flex; gap: 8px; align-items: center; margin-top: 14px; color: var(--text); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 999px; font-size: 14px; font-weight: 600; text-decoration: none; }
  .btn.primary { background: var(--accent); color: var(--accent-ink); }
  .btn.primary:hover:not(:disabled) { background: var(--glow); }
  .btn.ghost { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); font-weight: 500; }
  .btn.ghost:hover:not(:disabled) { background: var(--hover); }
  .btn.sm { height: 30px; padding: 0 12px; font-size: 13px; }
  .foot { display: flex; gap: 10px; justify-content: flex-end; align-items: center; margin-top: 20px; }
  .error { color: var(--error); font-size: 13px; min-height: 1em; }
  .seat { border-top: 1px solid var(--line); padding: 14px 0; display: grid; gap: 6px; }
  .seat .top { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .seat b { font-weight: 600; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #555; flex: none; }
  .dot.on { background: var(--ok); box-shadow: 0 0 0 3px rgba(79,191,122,.18); }
  .muted { color: var(--muted); font-size: 13px; }
  .link { display: flex; gap: 8px; align-items: center; }
  .link input { flex: 1; min-width: 0; height: 32px; font: 12.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d9d2c6; }
  .tools { display: flex; gap: 8px; flex-wrap: wrap; }
  a { color: var(--accent); }
  @media (max-width: 520px) { .box { padding: 18px; } }
${css}</style>
</head>
<body>
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** JSON dentro de <script>: sin cierres de etiqueta. */
const data = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Sin enlace válido: no se ve nada de ninguna partida. */
export function invitePage(reason: string | null = null): string {
  return HEAD('Tavernus — por invitación') + String.raw`<div class="box">
  <span class="eyebrow">Tavernus</span>
  <h1>Esta mesa es por invitación</h1>
  <p>${esc(reason ?? 'Para jugar necesitas el enlace que te pasa quien organiza la partida. Ábrelo en este navegador y entrarás directamente con tu personaje.')}</p>
  <p class="muted">Si ya tenías enlace y deja de funcionar, puede que lo hayan renovado: pide el nuevo.</p>
</div>
</body></html>`;
}

export interface JoinPageInput {
  game: { slug: string; name: string };
  options: ChargenCatalog;
  /** PJ ya en la partida, para empezar a su lado. */
  others: { id: string; name: string }[];
}

/** Asiento libre: el invitado crea su personaje y entra. */
export function joinPage(input: JoinPageInput): string {
  return HEAD(`${input.game.name} — tu personaje`, CHARGEN_CSS) + String.raw`<div class="box">
  <span class="eyebrow">${esc(input.game.name)}</span>
  <h1>Te han invitado a la partida</h1>
  <p>Crea tu personaje. Este enlace queda ligado a él: guárdalo para volver desde otro dispositivo.</p>
  <div id="cg" class="cg"></div>
</div>
<script>
${CHARGEN_JS}
(function () {
  var D = ${data(input)};
  function $(id) { return document.getElementById(id); }
  // Empezar junto a otro PJ: va al final del resumen.
  var near = null;
  if (D.others.length) {
    near = document.createElement('label');
    near.className = 'check';
    near.innerHTML = '<input type="checkbox" id="near-on" checked> Empezar junto a <select id="near" style="width:auto;display:inline-block;height:32px;margin:0 0 0 4px"></select>';
    D.others.forEach(function (c) { var x = document.createElement('option'); x.value = c.id; x.textContent = c.name; near.querySelector('select').appendChild(x); });
  }
  var slug = encodeURIComponent(D.game.slug);
  tavernusChargen($('cg'), {
    options: D.options,
    previewUrl: '/api/character/preview?game=' + slug,
    confirmLabel: 'Entrar en la partida',
    showHook: function () { return true; },
    summaryExtra: near,
    onConfirm: function (p, ui) {
      p.near = near && $('near-on').checked ? $('near').value : null;
      fetch('/api/seat/claim?game=' + slug, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
        .then(function (r) { return r.json(); })
        .then(function (r) { if (!r.ok) { ui.fail(r.text); return; } location.href = '/?game=' + slug; })
        .catch(function () { ui.fail('No hay conexión con el servidor.'); });
    }
  }).open();
})();
</script>
</body></html>`;
}

/** Anfitrión: los asientos de una partida, sus enlaces y quién está conectado. */
export function seatsPage(slug: string): string {
  return HEAD('Invitaciones — Tavernus') + String.raw`<div class="box wide">
  <span class="eyebrow"><a href="/">← Partidas</a></span>
  <h1 id="title">Invitaciones</h1>
  <p>Un enlace por asiento. Pásale a cada persona el suyo: al abrirlo queda ligada a ese personaje y no puede actuar por otro. Un asiento libre deja crear personaje a quien entre. «Renovar» invalida el enlace anterior y saca a quien lo usaba.</p>
  <div id="seats"><p class="muted">Cargando…</p></div>
  <div class="foot"><span class="error" id="err" role="alert"></span><button class="btn ghost" type="button" id="add">Añadir asiento libre</button><a class="btn primary" id="play" href="/?game=">Ir a la partida</a></div>
</div>
<script>
(function () {
  var slug = ${data(slug)};
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  $('play').href = '/?game=' + encodeURIComponent(slug);
  function call(method, path, body) {
    return fetch(path, { method: method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, text: 'No hay conexión con el servidor.' }; });
  }
  function ago(iso) {
    if (!iso) return 'sin usar';
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 2 ? 'ahora' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' d';
  }
  function load() {
    call('GET', '/api/seats?game=' + encodeURIComponent(slug)).then(function (d) {
      if (!d.ok) { $('seats').innerHTML = '<p class="error">' + esc(d.text) + '</p>'; return; }
      $('title').textContent = 'Invitaciones · ' + d.game.name;
      document.title = 'Invitaciones · ' + d.game.name;
      var box = $('seats'); box.innerHTML = '';
      d.seats.forEach(function (s) {
        var url = location.origin + s.link;
        var div = document.createElement('div'); div.className = 'seat';
        div.innerHTML = '<div class="top"><span class="dot' + (s.online ? ' on' : '') + '" title="' + (s.online ? 'En línea' : 'Sin conexión') + '"></span>' +
          '<b>' + esc(s.character_name || 'Asiento libre') + '</b><span class="muted">' + (s.label !== s.character_name ? esc(s.label) + ' · ' : '') + (s.online ? 'en línea' : 'último uso: ' + ago(s.last_seen_at)) + '</span></div>' +
          '<div class="link"><input type="text" readonly value="' + esc(url) + '" aria-label="Enlace de ' + esc(s.character_name || s.label) + '">' +
          '<button class="btn ghost sm" data-copy>Copiar</button><button class="btn ghost sm" data-regen>Renovar</button></div>';
        div.querySelector('[data-copy]').addEventListener('click', function (ev) {
          var inp = div.querySelector('input'); inp.select();
          (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).catch(function () { document.execCommand('copy'); });
          ev.target.textContent = 'Copiado'; setTimeout(function () { ev.target.textContent = 'Copiar'; }, 1500);
        });
        div.querySelector('[data-regen]').addEventListener('click', function (ev) {
          if (!ev.target.classList.contains('armed')) { ev.target.classList.add('armed'); ev.target.textContent = '¿Seguro?'; return; }
          ev.target.disabled = true;
          call('POST', '/api/seats/regenerate?game=' + encodeURIComponent(slug), { seat: s.id }).then(function (r) { if (!r.ok) $('err').textContent = r.text; load(); });
        });
        box.appendChild(div);
      });
      if (!d.seats.length) box.innerHTML = '<p class="muted">Aún no hay asientos.</p>';
    });
  }
  $('add').addEventListener('click', function () {
    call('POST', '/api/seats?game=' + encodeURIComponent(slug), {}).then(function (r) { if (!r.ok) $('err').textContent = r.text; load(); });
  });
  load();
  setInterval(load, 15000);
})();
</script>
</body></html>`;
}
