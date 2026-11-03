/**
 * El aspecto de la wiki: la plantilla de cada página, la hoja de estilos y el buscador del navegador.
 * Mismos colores y tipografías que la web (page-access.ts); todo estático, sin nada del servidor.
 */
import { escapeHtml } from './markdown.js';

export interface LayoutInput {
  title: string;
  description: string | null;
  /** Migas desde la portada: [{ title, url }], sin la propia página. */
  crumbs: Array<{ title: string; url: string }>;
  /** Secciones de la barra, con la activa marcada. */
  sections: Array<{ title: string; url: string; active: boolean }>;
  /** Encabezados h2 de la página, para el índice lateral. */
  headings: Array<{ id: string; text: string }>;
  backlinks: Array<{ title: string; url: string }>;
  html: string;
  /** Versión de wiki.css y wiki.js (hash de su contenido): el navegador los guarda un día y así no se queda con los viejos. */
  version: string;
}

export function layout(p: LayoutInput): string {
  const nav = p.sections.map((s) => `<a href="${s.url}"${s.active ? ' class="on"' : ''}>${escapeHtml(s.title)}</a>`).join('');
  const crumbs = p.crumbs.map((c) => `<a href="${c.url}">${escapeHtml(c.title)}</a>`).join('<span>›</span>');
  const toc = p.headings.length > 1
    ? `<nav class="toc"><p>En esta página</p>${p.headings.map((h) => `<a href="#${h.id}">${escapeHtml(h.text)}</a>`).join('')}</nav>`
    : '';
  const back = p.backlinks.length
    ? `<section class="backlinks"><h2>Enlazan aquí</h2><ul>${p.backlinks.map((b) => `<li><a href="${b.url}">${escapeHtml(b.title)}</a></li>`).join('')}</ul></section>`
    : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)} · Wiki de Tavernus</title>
${p.description ? `<meta name="description" content="${escapeHtml(p.description)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
<meta name="theme-color" content="#141617">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/wiki/wiki.css?v=${p.version}">
</head>
<body>
<header class="top">
  <a class="brand" href="/wiki/"><img src="/assets/favicon-32.png" alt="" width="22" height="22">Tavernus <span>wiki</span></a>
  <nav class="sections">${nav}</nav>
  <div class="search" role="search">
    <input id="q" type="search" placeholder="Buscar en la wiki" autocomplete="off" aria-label="Buscar en la wiki">
    <div id="results" hidden></div>
  </div>
  <a class="play" href="/">Jugar</a>
</header>
<div class="page">
  <article>
    ${crumbs ? `<p class="crumbs">${crumbs}</p>` : ''}
    <h1>${escapeHtml(p.title)}</h1>
    ${p.description ? `<p class="desc">${escapeHtml(p.description)}</p>` : ''}
    <div class="content">
${p.html}
    </div>
    ${back}
  </article>
  <aside>${toc}</aside>
</div>
<footer>La wiki de <a href="/">Tavernus</a> y de su demo, Brezal sellada. Para quien diseña y prueba el juego: los secretos van plegados.</footer>
<script src="/wiki/wiki.js?v=${p.version}" defer></script>
</body>
</html>
`;
}

export const CSS = String.raw`
:root {
  --bg: #0e0f10; --panel: #141617; --bubble: #1f2426; --text: #ece7df; --muted: #9a948a; --faint: #8a847a;
  --accent: #e6b75a; --accent-ink: #2a1d05; --accent-tint: rgba(230,183,90,.14); --glow: #f0c56b;
  --line: rgba(255,255,255,.08); --hover: rgba(255,255,255,.06); --control: #1d2022;
  --info: #63d1ff; --ok: #4fbf7a; --error: #ff6b5e; --warn: #e6b75a; --quote: #b9a7e0; --example: #9cb08a;
  --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --display: Manrope, Inter, system-ui, sans-serif;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 72px; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--bg); color: var(--text); font: 15.5px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 2px; }
img { max-width: 100%; height: auto; }

.top { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 14px; padding: 10px 20px; background: rgba(14,15,16,.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 8px; font: 800 17px/1 var(--display); color: var(--text); white-space: nowrap; }
.brand span { color: var(--accent); font-weight: 600; }
.brand:hover { text-decoration: none; }
.sections { display: flex; gap: 2px; flex-wrap: wrap; }
.sections a { padding: 6px 10px; border-radius: 8px; color: var(--muted); font-size: 14px; font-weight: 500; }
.sections a:hover { background: var(--hover); color: var(--text); text-decoration: none; }
.sections a.on { color: var(--accent); background: var(--accent-tint); }
.search { position: relative; margin-left: auto; flex: 0 1 300px; }
.search input { width: 100%; height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--line); background: var(--control); color: var(--text); font: inherit; font-size: 14px; outline: none; }
.search input:focus { border-color: var(--accent); }
#results { position: absolute; top: 40px; right: 0; width: min(520px, calc(100vw - 32px)); max-height: 70vh; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.55); padding: 6px; }
#results a { display: block; padding: 8px 10px; border-radius: 8px; color: var(--text); }
#results a:hover, #results a.sel { background: var(--hover); text-decoration: none; }
#results b { display: block; font-weight: 600; }
#results small { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
#results small.where { color: var(--accent); font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; }
#results mark { background: var(--accent-tint); color: var(--glow); border-radius: 3px; padding: 0 1px; }
#results .none { padding: 10px; color: var(--muted); }
.play { padding: 7px 14px; border-radius: 9px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: 14px; white-space: nowrap; }
.play:hover { background: var(--glow); text-decoration: none; }

.page { display: grid; grid-template-columns: minmax(0, 780px) 240px; gap: 40px; justify-content: center; padding: 28px 20px 48px; }
aside { position: sticky; top: 72px; align-self: start; }
.toc { border-left: 1px solid var(--line); padding-left: 14px; font-size: 13.5px; }
.toc p { margin: 0 0 6px; color: var(--accent); font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.toc a { display: block; padding: 3px 0; color: var(--muted); }
.toc a:hover { color: var(--text); text-decoration: none; }

.crumbs { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
.crumbs span { margin: 0 6px; color: var(--faint); }
article h1 { font: 800 32px/1.15 var(--display); margin: 0 0 8px; letter-spacing: -.01em; }
.desc { margin: 0 0 20px; color: var(--muted); font-size: 16.5px; line-height: 1.5; }
.content { overflow-wrap: anywhere; }
.content h2 { font: 700 22px/1.25 var(--display); margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.content h3 { font: 700 17px/1.3 var(--display); margin: 24px 0 8px; }
.content h4 { font: 600 15px/1.3 var(--sans); margin: 18px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 12.5px; }
.content h2 a.anchor, .content h3 a.anchor, .content h4 a.anchor { color: inherit; }
.content h2 a.anchor:hover, .content h3 a.anchor:hover, .content h4 a.anchor:hover { text-decoration: none; }
.content h2 a.anchor:hover::after, .content h3 a.anchor:hover::after { content: ' #'; color: var(--faint); font-weight: 400; }
.content p { margin: 0 0 12px; }
.content ul, .content ol { margin: 0 0 12px; padding-left: 24px; }
.content li { margin: 3px 0; }
.content li > p { margin: 0; }
.content hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }
.content blockquote { margin: 0 0 12px; padding: 4px 16px; border-left: 3px solid var(--quote); color: var(--muted); }
.content code { font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; background: var(--control); padding: 1px 5px; border-radius: 5px; }
.content pre { background: var(--control); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; overflow: auto; }
.content pre code { background: none; padding: 0; }
.content table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14.5px; }
.content th, .content td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--line); }
.content th { color: var(--muted); font-weight: 600; font-size: 12.5px; text-transform: uppercase; letter-spacing: .05em; }
.content th:empty, .content thead:has(th:empty:only-child) { display: none; }
.content img { display: block; border-radius: 12px; margin: 6px 0 10px; }
.content p > img:only-child { margin: 12px auto; }
.content p > img + em { display: block; margin: -2px 0 6px; color: var(--muted); font-size: 13.5px; text-align: center; }
.content figure { margin: 12px 0 18px; }
.content figure img { margin: 0 auto; }
.content figcaption { margin-top: 8px; color: var(--muted); font-size: 13.5px; font-style: italic; text-align: center; }
.content em { font-style: italic; }
.content .missing { color: var(--text); border-bottom: 1px dotted var(--faint); }

.callout { margin: 0 0 16px; border: 1px solid var(--line); border-left: 3px solid var(--info); border-radius: 12px; background: var(--panel); padding: 10px 16px 2px; }
.callout-title, .callout summary { margin: 0 0 6px; font-weight: 600; color: var(--text); }
.callout summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; padding: 2px 0 8px; }
.callout summary::-webkit-details-marker { display: none; }
.callout summary::before { content: '▸'; color: var(--accent); font-size: 13px; transition: transform .15s; }
.callout[open] > summary::before { transform: rotate(90deg); }
.callout-body > :last-child { margin-bottom: 12px; }
.callout.abstract, .callout.summary, .callout.tldr, .callout.info, .callout.note { border-left-color: var(--info); }
.callout.example { border-left-color: var(--example); }
.callout.question, .callout.help, .callout.faq, .callout.tip, .callout.hint { border-left-color: var(--ok); }
.callout.warning, .callout.caution, .callout.attention { border-left-color: var(--warn); }
.callout.danger, .callout.error, .callout.bug, .callout.failure, .callout.fail { border-left-color: var(--error); }
.callout.quote, .callout.cite { border-left-color: var(--quote); font-style: italic; }
details.callout.warning > summary::after { content: 'spoiler'; margin-left: auto; color: var(--warn); font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.callout.ficha { float: right; width: 300px; max-width: 100%; margin: 0 0 16px 24px; padding: 12px 14px 4px; border-left-color: var(--accent); background: var(--bubble); font-size: 14px; }
.callout.ficha img { margin: 0 0 10px; width: 100%; border-radius: 10px; }
.callout.ficha table { font-size: 13.5px; margin-bottom: 8px; }
.callout.ficha td { padding: 4px 6px; }
.callout.ficha td:first-child { color: var(--muted); white-space: nowrap; width: 1%; }
.callout.ficha thead { display: none; }

.backlinks { clear: both; margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--line); }
.backlinks h2 { margin: 0 0 8px; font: 600 12.5px/1 var(--sans); color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
.backlinks ul { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 14px; }
footer { padding: 22px 20px 36px; text-align: center; color: var(--faint); font-size: 13px; border-top: 1px solid var(--line); }

@media (max-width: 1080px) { .page { grid-template-columns: minmax(0, 780px); } aside { display: none; } }
@media (max-width: 720px) {
  .top { flex-wrap: wrap; gap: 8px 12px; padding: 10px 16px; }
  .sections { order: 3; width: 100%; gap: 0; overflow-x: auto; }
  .search { flex: 1 1 140px; }
  .page { padding: 20px 16px 40px; }
  article h1 { font-size: 26px; }
  .callout.ficha { float: none; width: 100%; margin: 0 0 16px; }
}
`;

/** Buscador: baja search.json la primera vez y filtra en el navegador. */
export const JS = String.raw`(function () {
  var q = document.getElementById('q'), box = document.getElementById('results');
  if (!q || !box) return;
  var pages = null, loading = null, sel = -1, timer = 0;
  function fold(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function esc(s) { return s.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function load() {
    if (pages || loading) return loading;
    loading = fetch('/wiki/search.json').then(function (r) { return r.json(); }).then(function (list) {
      pages = list.map(function (p) { return { p: p, t: fold(p.t), d: fold(p.d || ''), a: fold((p.a || []).join(' ')), x: fold(p.x || '') }; });
    });
    return loading;
  }
  function snippet(p, terms) {
    var i = -1, len = 0;
    for (var k = 0; k < terms.length; k++) { var j = p.x.indexOf(terms[k]); if (j >= 0 && (i < 0 || j < i)) { i = j; len = terms[k].length; } }
    if (i < 0) return p.p.d ? esc(p.p.d) : '';
    var from = Math.max(0, i - 70), to = Math.min(p.p.x.length, i + len + 90);
    var s = (from > 0 ? '…' : '') + esc(p.p.x.slice(from, to)) + (to < p.p.x.length ? '…' : '');
    terms.forEach(function (t) { s = s.replace(new RegExp('(' + t.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
    return s;
  }
  function search(text) {
    var terms = fold(text).split(/\s+/).filter(Boolean);
    if (!terms.length) { box.hidden = true; box.innerHTML = ''; return; }
    var hits = [];
    pages.forEach(function (p) {
      var score = 0;
      for (var k = 0; k < terms.length; k++) {
        var t = terms[k], s = 0;
        if (p.t.indexOf(t) >= 0) s += p.t === t ? 30 : 12;
        if (p.a.indexOf(t) >= 0) s += 10;
        if (p.d.indexOf(t) >= 0) s += 4;
        var n = p.x.split(t).length - 1; if (n) s += Math.min(n, 4);
        if (!s) return;
        score += s;
      }
      hits.push({ p: p, score: score });
    });
    hits.sort(function (a, b) { return b.score - a.score || a.p.p.t.localeCompare(b.p.p.t); });
    sel = -1;
    box.innerHTML = hits.length
      ? hits.slice(0, 12).map(function (h) {
          return '<a href="' + h.p.p.u + '"><small class="where">' + esc(h.p.p.s) + '</small><b>' + esc(h.p.p.t) + '</b><small>' + snippet(h.p, terms) + '</small></a>';
        }).join('')
      : '<div class="none">Nada con «' + esc(text) + '».</div>';
    box.hidden = false;
  }
  function move(d) {
    var items = box.querySelectorAll('a'); if (!items.length) return;
    sel = (sel + d + items.length) % items.length;
    items.forEach(function (a, i) { a.classList.toggle('sel', i === sel); });
    items[sel].scrollIntoView({ block: 'nearest' });
  }
  q.addEventListener('focus', function () { load(); });
  q.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { load().then(function () { search(q.value); }); }, 80);
  });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { var a = box.querySelector('a.sel') || box.querySelector('a'); if (a) location.href = a.href; }
    else if (e.key === 'Escape') { q.value = ''; box.hidden = true; q.blur(); }
  });
  document.addEventListener('click', function (e) { if (!box.contains(e.target) && e.target !== q) box.hidden = true; });
  q.addEventListener('focus', function () { if (box.innerHTML) box.hidden = false; });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== q && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  });
})();
`;
