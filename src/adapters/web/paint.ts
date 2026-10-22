/**
 * Pincel en la web: un botón junto al micrófono que pide una ilustración del
 * momento actual del PJ (src/ai/paint.ts). La imagen llega por el stream como un
 * `moment` más y se coloca junto a su turno; mientras, el turno lleva un marcador
 * «Pintando…».
 *
 *   GET  /api/illustrate?game=SLUG&character=ID   si hay pincel, cuántas quedan hoy y lo ya pintado (para el historial)
 *   POST /api/illustrate?game=SLUG&character=ID   pinta el último turno: 202 con {seq, key} y la imagen por SSE
 *                                                 200 si ese turno ya estaba pintado (no gasta), 429 al agotar límite o cuota,
 *                                                 503 sin IMAGES=on, 409 si aún no hay turno que pintar
 * Si la generación falla, el stream manda `paint` {key, ok: false, text}.
 *
 * page.ts interpola PAINT_STYLE en su <style>, PAINT_JS dentro de su script (usa
 * showMoment, api, current…) y llama a paintConnect(stream) al abrir cada stream.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../../engine/engine.js';
import type { Id } from '../../engine/model.js';
import { illustratorOf, type SceneImage } from '../../ai/illustrate.js';
import { gameDayOf, paintKey, paintMomentOf, PaintLimits } from '../../ai/paint.js';

interface PaintState { limits: PaintLimits; pending: Map<string, number> }
const states = new WeakMap<Engine, PaintState>();

/** Límites y pinceladas en curso de una partida; `make` solo cuenta la primera vez (tests). */
export function paintStateOf(engine: Engine, make: () => PaintLimits = () => new PaintLimits()): PaintState {
  let s = states.get(engine);
  if (!s) { s = { limits: make(), pending: new Map() }; states.set(engine, s); }
  return s;
}

function src(img: SceneImage, slug: string): string {
  return `/images/${img.file}?game=${encodeURIComponent(slug)}`;
}

function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

export async function handlePaintRequest(engine: Engine, req: IncomingMessage, res: ServerResponse, url: URL, slug: string, streams: Map<Id, Set<ServerResponse>>): Promise<void> {
  const id = url.searchParams.get('character');
  if (!id || !engine.world.characters.has(id)) { json(res, 404, { ok: false, text: 'No existe ese personaje.' }); return; }
  const ill = illustratorOf(engine);
  const state = paintStateOf(engine);
  const day = gameDayOf(engine.gameNow());

  if (req.method === 'GET') {
    const painted: { seq: number; key: string; kind: 'manual'; entity_id: Id; name: string; src: string }[] = [];
    if (ill) {
      for (const d of engine.events.forCharacter(id, null)) {
        const { key, entity_id } = paintKey(id, d.event.seq);
        const img = ill.entityImage('manual', entity_id);
        if (img) painted.push({ seq: d.event.seq, key, kind: 'manual', entity_id, name: img.name, src: src(img, slug) });
      }
    }
    const pending = [...state.pending].filter(([k]) => k.startsWith(`manual:${id}:`)).map(([key, seq]) => ({ key, seq }));
    json(res, 200, { enabled: ill !== null, left: state.limits.left(id, day), per_day: state.limits.perDay, painted, pending });
    return;
  }
  if (req.method !== 'POST') { json(res, 405, { ok: false, text: 'Usa GET o POST.' }); return; }
  for await (const _ of req) { /* el cuerpo no se usa */ }

  if (!ill) { json(res, 503, { ok: false, text: 'Las ilustraciones están apagadas en esta partida (IMAGES=on en el .env).' }); return; }
  const m = paintMomentOf(engine, id);
  if (!m) { json(res, 409, { ok: false, text: 'Aún no ha pasado nada que pintar: juega un turno primero.' }); return; }
  const from = { character_id: id, event_seq: m.seq, moment_key: m.key };

  // Ese turno ya está pintado (o pintándose): la misma imagen, sin gastar otra.
  const done = ill.entityImage('manual', m.input.entity_id);
  if (done || state.pending.has(m.key)) {
    if (done) void ill.illustrateEntity(m.input, from); // vuelve a avisar por el stream, desde la caché
    json(res, 200, {
      ok: true, seq: m.seq, key: m.key, cached: true, left: state.limits.left(id, day),
      moment: done ? { seq: m.seq, key: m.key, kind: 'manual', entity_id: m.input.entity_id, name: done.name, src: src(done, slug) } : null,
    });
    return;
  }
  if (ill.cloudflareExhausted) {
    json(res, 429, { ok: false, text: 'Se ha agotado la cuota diaria de ilustraciones. El pincel vuelve tras la medianoche UTC.', retry_after_s: null });
    return;
  }
  const verdict = state.limits.take(id, day);
  if (!verdict.ok) {
    json(res, 429, { ok: false, text: verdict.text, retry_after_s: verdict.retry_after_s }, verdict.retry_after_s ? { 'retry-after': String(verdict.retry_after_s) } : {});
    return;
  }
  state.pending.set(m.key, m.seq);
  void ill.illustrateEntity(m.input, from).then((img) => {
    state.pending.delete(m.key);
    if (img) return;
    state.limits.refund(id, day);
    const data = JSON.stringify({ key: m.key, seq: m.seq, ok: false, text: 'No se pudo pintar este momento. Prueba otra vez en unos minutos.' });
    for (const s of streams.get(id) ?? []) s.write(`event: paint\ndata: ${data}\n\n`);
  });
  json(res, 202, { ok: true, seq: m.seq, key: m.key, cached: false, left: verdict.left });
}

export const PAINT_STYLE = String.raw`
  /* Pincel: botón de vidrio junto al micrófono; el turno pintándose lleva un lienzo con brillo que pasa. */
  form .brush { flex: none; width: 44px; height: 44px; margin: -4px 0; border-radius: 50%; background: transparent; color: var(--muted); box-shadow: none; transition: color .2s, background .2s; }
  form .brush:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  form .brush svg.i { width: 18px; height: 18px; }
  form .brush.wait { color: var(--accent); background: var(--accent-tint); }
  .moment.manual { width: min(560px, calc(100% - 42px)); }
  .moment.manual .shot { width: 100%; aspect-ratio: 16 / 9; }
  .moment.painting .shot { display: grid; place-items: center; cursor: default; color: var(--accent);
    background: linear-gradient(105deg, var(--platter) 35%, rgba(247,201,121,.13) 50%, var(--platter) 65%) 0 0 / 250% 100%; animation: paint-wet 1.8s linear infinite; }
  .moment.painting .wet svg.i { width: 28px; height: 28px; opacity: .8; animation: paint-bob 1.8s ease-in-out infinite; }
  .moment.painting figcaption span { color: var(--muted); }
  .moment.again .shot { animation: paint-again 1.1s ease-out; }
  @keyframes paint-wet { from { background-position: 100% 0; } to { background-position: -150% 0; } }
  @keyframes paint-bob { 50% { transform: translateY(-4px) rotate(-8deg); } }
  @keyframes paint-again { from { box-shadow: 0 0 0 0 rgba(233,169,78,.6); } to { box-shadow: 0 0 0 14px rgba(233,169,78,0); } }
  @media (prefers-reduced-motion: reduce) { .moment.painting .shot, .moment.painting .wet svg.i, .moment.again .shot { animation: none; } }
`;

export const PAINT_JS = String.raw`
  // --- Pincel: ilustrar el momento actual (paint.ts) ---------------------------
  var BRUSH = '<svg class="i" viewBox="0 0 24 24"><path d="M14.5 4.5l5 5L11 18l-5-5z"/><path d="M17 2l5 5-2.5 2.5-5-5z"/><path d="M6 13c-2 0-3.5 1.6-3.5 3.6 0 1.4-.6 2.6-1.5 3.4 1.2.7 2.6 1 4 1 2.8 0 5-2.2 5-5"/></svg>';
  var brush = document.createElement('button');
  brush.type = 'button'; brush.className = 'brush'; brush.innerHTML = BRUSH; brush.hidden = true;
  brush.title = 'Pintar este momento'; brush.setAttribute('aria-label', 'Pintar este momento');
  $('form').insertBefore(brush, $('form').querySelector('button[type=submit]'));

  function byAttr(attr, value) {
    var found = null;
    log.querySelectorAll('[' + attr + ']').forEach(function (f) { if (f.getAttribute(attr) === value) found = f; });
    return found;
  }
  function paintNote(text) { var d = add('system', text); d.classList.add('paint-note'); }
  /** Marcador «Pintando…» bajo el turno (como showMoment), hasta que llega la imagen. */
  function paintPlaceholder(key, seq) {
    if (byAttr('data-paint', key) || byAttr('data-moment', key)) return;
    var fig = document.createElement('figure');
    fig.className = 'msg moment manual painting';
    fig.setAttribute('data-paint', key);
    fig.setAttribute('data-for', String(seq));
    fig.innerHTML = '<div class="shot" role="status"><span class="wet">' + BRUSH + '</span><figcaption><b>Pintando…</b><span>Momento</span></figcaption></div>';
    var host = byAttr('data-seq', String(seq));
    if (!host) { log.appendChild(fig); scroll(); return; }
    var ref = host;
    while (ref.nextElementSibling && ref.nextElementSibling.getAttribute('data-for') === String(seq)) ref = ref.nextElementSibling;
    ref.parentNode.insertBefore(fig, ref.nextSibling);
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 400) fig.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function paintDone(key) { var p = byAttr('data-paint', key); if (p) p.remove(); }
  function paintAgain(fig) {
    fig.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    fig.classList.remove('again'); void fig.offsetWidth; fig.classList.add('again');
  }
  // La imagen entra por showMoment (stream o caché): sustituye al marcador, con su fundido.
  new MutationObserver(function (ms) {
    ms.forEach(function (m) { m.addedNodes.forEach(function (n) {
      var k = n.getAttribute && n.getAttribute('data-moment');
      if (k && k.indexOf('manual:') === 0) paintDone(k);
    }); });
  }).observe(log, { childList: true });

  brush.addEventListener('click', function () {
    if (!current || busy || brush.classList.contains('wait')) return;
    brush.classList.add('wait');
    fetch(api('/api/illustrate?character=' + encodeURIComponent(current)), { method: 'POST' })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (x) {
        var d = x.d;
        if (!d.ok) { paintNote(d.text || 'No se pudo pintar.'); if (x.status === 503) brush.hidden = true; return; }
        var fig = byAttr('data-moment', d.key);
        if (fig) { paintAgain(fig); return; }
        if (d.moment) { showMoment(d.moment, d.seq); var f = byAttr('data-moment', d.key); if (f) paintAgain(f); return; }
        var p = byAttr('data-paint', d.key);
        if (p) { paintAgain(p); return; }
        paintPlaceholder(d.key, d.seq);
      })
      .catch(function () { paintNote('No se pudo pedir la ilustración.'); })
      .then(function () { brush.classList.remove('wait'); });
  });

  /** Al abrir cada stream: si hay pincel, lo ya pintado vuelve a su turno y lo que se está pintando, su marcador. */
  function paintConnect(s) {
    s.addEventListener('history', function () {
      var id = current;
      fetch(api('/api/illustrate?character=' + encodeURIComponent(id))).then(function (r) { return r.json(); }).then(function (d) {
        if (id !== current) return;
        brush.hidden = !d.enabled;
        (d.painted || []).forEach(function (x) { showMoment(x, x.seq); });
        (d.pending || []).forEach(function (x) { paintPlaceholder(x.key, x.seq); });
      }).catch(function () {});
    });
    s.addEventListener('paint', function (e) {
      var x = JSON.parse(e.data);
      if (x.ok === false) { paintDone(x.key); paintNote(x.text); }
    });
  }
`;
