/**
 * Avatar del PJ en la web (src/ai/avatar.ts):
 *
 *   GET  /api/avatar?game=SLUG&character=ID   versiones, la elegida, la que se está pintando y cuántas quedan hoy
 *   POST /api/avatar?game=SLUG&character=ID   {action: 'regenerate'}            «Otro»
 *                                             {action: 'describe', prompt}      «Descríbelo»
 *                                             {action: 'choose', v}             volver a una versión
 *
 * El panel (AVATAR_STYLE, AVATAR_SCRIPT) va suelto en la página de juego: pone la
 * imagen elegida en el círculo de la ficha y, al pulsarlo, abre el panel. Lo que
 * se ve en el hilo cambia solo: al elegir, el servidor manda «portrait» por el stream.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Engine } from '../../engine/engine.js';
import { avatarsOf, MAX_LOOK, type AvatarResult, type AvatarView } from '../../ai/avatar.js';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_000) break;
  }
  try {
    const v: unknown = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Lo que recibe la página: cada versión con su URL en /images. */
export function avatarJson(view: AvatarView, slug: string) {
  return {
    ok: true, enabled: true, ...view,
    versions: view.versions.map((v) => ({ v: v.v, source: v.source, look: v.look, chosen: v.chosen, src: v.file ? `/images/${v.file}?game=${encodeURIComponent(slug)}` : null })),
  };
}

export async function handleAvatarRequest(engine: Engine, req: IncomingMessage, res: ServerResponse, url: URL, slug: string): Promise<void> {
  const studio = avatarsOf(engine);
  const id = url.searchParams.get('character') ?? '';
  if (!studio) { json(res, 200, { ok: true, enabled: false, text: 'Las ilustraciones están apagadas en este servidor (IMAGES=on en .env).' }); return; }
  await studio.ready;
  if (req.method === 'GET') {
    const view = studio.view(id);
    if (!view) { json(res, 404, { ok: false, text: 'Ese personaje no existe.' }); return; }
    json(res, 200, avatarJson(view, slug));
    return;
  }
  if (req.method !== 'POST') { json(res, 405, { ok: false, text: 'Usa GET o POST.' }); return; }
  const body = await readBody(req);
  let r: AvatarResult;
  switch (body['action']) {
    case 'regenerate': r = await studio.regenerate(id); break;
    case 'describe': r = await studio.describe(id, typeof body['prompt'] === 'string' ? body['prompt'] : ''); break;
    case 'choose': r = await studio.choose(id, Number(body['v'])); break;
    default: json(res, 400, { ok: false, text: 'Acción no válida (regenerate, describe o choose).' }); return;
  }
  if (!r.ok) { json(res, r.status, { ok: false, text: r.text }); return; }
  json(res, 200, avatarJson(r.view, slug));
}

export const AVATAR_STYLE = `
  .card .av.has-img { padding: 0; overflow: hidden; }
  .card .av.has-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card .av.tappable { cursor: pointer; position: relative; transition: box-shadow .15s; }
  .card .av.tappable:hover, .card .av.tappable:focus-visible { box-shadow: inset 0 0 0 2px var(--accent), 0 0 0 3px var(--accent-tint); outline: none; }
  .card .av.painting::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent); animation: av-spin 1s linear infinite; }
  @keyframes av-spin { to { transform: rotate(360deg); } }
  #avatar-dlg { position: fixed; inset: 0; z-index: 45; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(5,5,13,.6); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
  #avatar-dlg[hidden] { display: none; }
  #avatar-dlg .box { position: relative; width: min(440px, 100%); max-height: calc(100% - 16px); overflow: auto; padding: 20px; border-radius: 28px; background: var(--panel); box-shadow: var(--window-shadow); }
  #avatar-dlg h2 { margin: 0 40px 14px 0; font-size: 17px; font-weight: 600; }
  #avatar-dlg .close { position: absolute; top: 14px; right: 14px; display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 50%; color: var(--text); background: var(--control); cursor: pointer; }
  #avatar-dlg .big { position: relative; width: min(240px, 70vw); aspect-ratio: 1; margin: 0 auto; border-radius: 24px; overflow: hidden; display: grid; place-items: center; background: var(--accent-tint); color: var(--accent); font-size: 64px; font-weight: 600; }
  #avatar-dlg .big img { width: 100%; height: 100%; object-fit: cover; }
  #avatar-dlg .big .wait { position: absolute; inset: auto 0 0 0; padding: 8px; font-size: 12px; font-weight: 500; text-align: center; color: var(--text); background: rgba(0,0,0,.55); }
  #avatar-dlg .thumbs { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 14px 0 4px; }
  #avatar-dlg .thumbs button { width: 52px; height: 52px; padding: 0; border: 0; border-radius: 14px; overflow: hidden; cursor: pointer; background: var(--control); color: var(--muted); font-size: 11px; box-shadow: inset 0 0 0 1px var(--sep); }
  #avatar-dlg .thumbs button img { width: 100%; height: 100%; object-fit: cover; display: block; }
  #avatar-dlg .thumbs button[aria-pressed="true"] { box-shadow: 0 0 0 2.5px var(--accent); }
  #avatar-dlg .thumbs button:disabled { cursor: default; }
  #avatar-dlg .row { display: flex; gap: 8px; margin-top: 14px; }
  #avatar-dlg textarea { flex: 1; min-height: 64px; resize: vertical; padding: 10px 12px; border: 0; border-radius: 14px; font: inherit; font-size: 16px; color: var(--text); background: var(--control); box-shadow: inset 0 0 0 1px var(--sep); }
  #avatar-dlg textarea:focus { outline: none; box-shadow: inset 0 0 0 1.5px var(--accent); }
  #avatar-dlg .btn { min-height: 40px; padding: 0 16px; border: 0; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; color: var(--text); background: var(--control); }
  #avatar-dlg .btn.primary { color: var(--accent-ink); background: var(--accent); }
  #avatar-dlg .btn:disabled { opacity: .45; cursor: default; }
  #avatar-dlg label { display: block; margin-top: 16px; font-size: 12px; font-weight: 600; color: var(--muted); }
  #avatar-dlg .msg-line { min-height: 18px; margin-top: 10px; font-size: 12px; color: var(--muted); }
  #avatar-dlg .msg-line.error { color: var(--error); }
  #avatar-dlg .left { font-size: 12px; color: var(--faint); align-self: center; margin-left: auto; }
`;

/** Script suelto: no toca el de la página; lee el PJ del desplegable #character y la partida de la URL. */
export const AVATAR_SCRIPT = `
<div id="avatar-dlg" hidden role="dialog" aria-modal="true" aria-labelledby="avatar-title">
  <div class="box">
    <h2 id="avatar-title">Tu avatar</h2>
    <button type="button" class="close" aria-label="Cerrar" title="Cerrar (Esc)">✕</button>
    <div class="big"></div>
    <div class="thumbs" role="group" aria-label="Versiones"></div>
    <div class="row"><button type="button" class="btn" data-av="regenerate" title="Otra versión con la misma descripción">Otro</button><span class="left"></span></div>
    <label for="avatar-look">Descríbelo</label>
    <div class="row"><textarea id="avatar-look" maxlength="${MAX_LOOK}" placeholder="Cómo quieres que se vea: pelo, ropa, rasgos, gesto…"></textarea></div>
    <div class="row"><button type="button" class="btn primary" data-av="describe">Pintar así</button></div>
    <div class="msg-line" aria-live="polite"></div>
  </div>
</div>
<script>
(function () {
  var game = new URLSearchParams(location.search).get('game');
  if (!game) return;
  var dlg = document.getElementById('avatar-dlg'), card = document.getElementById('card'), select = document.getElementById('character');
  var big = dlg.querySelector('.big'), thumbs = dlg.querySelector('.thumbs'), line = dlg.querySelector('.msg-line'), look = document.getElementById('avatar-look');
  var views = {}, poll = null, busy = false, lastFetch = {};
  function api(id) { return '/api/avatar?game=' + encodeURIComponent(game) + '&character=' + encodeURIComponent(id); }
  function current() { return select && select.value; }
  function chosenSrc(v) { var c = v && v.versions.filter(function (x) { return x.chosen && x.src; })[0]; return c ? c.src : null; }
  function say(text, error) { line.textContent = text || ''; line.classList.toggle('error', !!error); }

  /** El círculo de la ficha: la imagen elegida (o la inicial) y el acceso al panel. */
  function paintCard() {
    var av = card.querySelector('.top .av');
    if (!av) return;
    var v = views[current()], src = chosenSrc(v);
    if (!av.classList.contains('tappable')) {
      av.classList.add('tappable');
      av.setAttribute('role', 'button'); av.tabIndex = 0;
      av.title = 'Tu avatar: cambiarlo o describirlo'; av.setAttribute('aria-label', av.title);
      av.addEventListener('click', open);
      av.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }
    av.classList.toggle('painting', !!(v && v.pending !== null));
    var img = av.querySelector('img');
    if (src) {
      if (!img) { av.dataset.initial = av.textContent; av.textContent = ''; img = document.createElement('img'); img.alt = ''; av.appendChild(img); }
      if (img.getAttribute('src') !== src) img.src = src;
      av.classList.add('has-img');
    } else if (img) { img.remove(); av.textContent = av.dataset.initial || ''; av.classList.remove('has-img'); }
    // El botón del PJ en la cabecera (grupo), igual.
    var pb = document.querySelector('#party button.on');
    if (pb) { pb.style.backgroundImage = src ? 'url("' + src + '")' : ''; pb.style.backgroundSize = 'cover'; pb.style.color = src ? 'transparent' : ''; }
  }

  function render() {
    var v = views[current()];
    if (!v) return;
    var src = chosenSrc(v), pending = v.pending !== null;
    var avEl = card.querySelector('.top .av'), initial = avEl ? (avEl.dataset.initial || avEl.textContent) : '?';
    big.innerHTML = src ? '<img alt="Avatar elegido">' : '';
    if (src) big.querySelector('img').src = src; else big.textContent = initial || '?';
    if (pending) { var w = document.createElement('div'); w.className = 'wait'; w.textContent = 'Pintando la versión ' + v.pending + '…'; big.appendChild(w); }
    thumbs.innerHTML = '';
    v.versions.forEach(function (x) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', x.chosen ? 'true' : 'false');
      b.title = 'Versión ' + x.v + (x.source === 'describe' ? ' (descrita): ' + x.look : x.source === 'auto' ? ' (la primera)' : '') + (x.chosen ? ' · elegida' : '');
      b.setAttribute('aria-label', b.title);
      if (x.src) { var i = document.createElement('img'); i.alt = ''; i.src = x.src; b.appendChild(i); b.addEventListener('click', function () { if (!x.chosen) send({ action: 'choose', v: x.v }); }); }
      else { b.textContent = '…'; b.disabled = true; }
      thumbs.appendChild(b);
    });
    dlg.querySelector('.left').textContent = 'Te quedan ' + v.left + ' hoy';
    dlg.querySelectorAll('[data-av]').forEach(function (b) { b.disabled = busy || pending || v.left <= 0; });
    if (v.error) say(v.error, true);
    else if (pending) say('El retrato tarda unos segundos (más si va por la reserva). Puedes cerrar: aparecerá solo.');
    else if (v.left <= 0) say('Has llegado al límite de retratos de hoy; mañana podrás pedir más.');
    else if (!line.classList.contains('error')) say('');
  }

  function apply(v) {
    if (!v || !v.enabled) return;
    views[v.character_id] = v;
    paintCard();
    if (!dlg.hidden) render();
    clearTimeout(poll);
    if (v.pending !== null) poll = setTimeout(function () { load(v.character_id); }, 3000);
  }

  function load(id) {
    if (!id) return;
    lastFetch[id] = Date.now();
    fetch(api(id)).then(function (r) { return r.json(); }).then(function (v) {
      if (v && v.enabled === false) { views[id] = null; if (!dlg.hidden) say(v.text, true); return; }
      if (v && v.ok) apply(v);
    }).catch(function () {});
  }

  function send(body) {
    var id = current();
    if (!id || busy) return;
    busy = true; say('');
    if (views[id]) render();
    fetch(api(id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (v) { busy = false; if (v.ok) { if (body.action === 'describe') look.value = ''; apply(v); } else { say(v.text || 'No se pudo.', true); if (views[id]) render(); } })
      .catch(function () { busy = false; say('No hay conexión con el servidor.', true); if (views[id]) render(); });
  }

  function open() {
    dlg.hidden = false;
    say('');
    var v = views[current()];
    if (v) render(); else { big.textContent = '…'; thumbs.innerHTML = ''; }
    load(current());
  }
  function close() { dlg.hidden = true; }

  dlg.querySelector('.close').addEventListener('click', close);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !dlg.hidden) close(); });
  dlg.querySelector('[data-av="regenerate"]').addEventListener('click', function () { send({ action: 'regenerate' }); });
  dlg.querySelector('[data-av="describe"]').addEventListener('click', function () {
    var t = look.value.trim();
    if (t.length < 3) { say('Escribe cómo quieres que se vea (unas pocas palabras bastan).', true); look.focus(); return; }
    send({ action: 'describe', prompt: t });
  });

  // La ficha se repinta con cada cambio de la hoja: se vuelve a poner la imagen. Un PJ nuevo se pide una vez
  // (y de nuevo cada medio minuto mientras no tenga retrato: el primero llega de fondo tras crearlo).
  new MutationObserver(function () {
    var id = current();
    if (!id) return;
    var v = views[id];
    if (v === undefined || (v && !chosenSrc(v) && v.pending === null && Date.now() - (lastFetch[id] || 0) > 30000)) load(id);
    paintCard();
  }).observe(card, { childList: true });
})();
</script>
`;
