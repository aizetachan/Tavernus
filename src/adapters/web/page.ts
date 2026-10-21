/** Página del adaptador web: HTML, CSS y JS en un solo string para que funcione igual con tsx y con dist/. */

export const PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavernus</title>
<style>
  :root {
    --bg: #17130f; --panel: #211b15; --panel-2: #2a221a; --line: #3a2f24;
    --text: #ece3d4; --muted: #a8998a; --accent: #d9a35b; --accent-ink: #1b140c;
    --master: #2a2219; --system: #1d1915; --player: #3b2c1b; --error: #e07a62;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 16px/1.55 Georgia, 'Iowan Old Style', serif; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
  header h1 { font-size: 18px; margin: 0; letter-spacing: .04em; color: var(--accent); font-weight: normal; }
  header .spacer { flex: 1; }
  header .menu { color: var(--muted); text-decoration: none; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; font-size: 14px; }
  header .menu:hover { color: var(--accent); border-color: var(--accent); }
  #game-name { color: var(--muted); font-size: 14px; font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }
  select, button, input { font: inherit; color: inherit; }
  select { background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
  #toggle-sheet { display: none; }
  main { flex: 1; display: flex; min-height: 0; }
  #play { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  /* Ilustración de la escena: columna central a toda altura, entre el chat y el panel del tablero y la hoja. */
  #scene { position: relative; flex: 0 1 40%; min-width: 0; margin: 0; padding: 16px; border-left: 1px solid var(--line); background: #0f0c09; display: flex; flex-direction: column; }
  #scene[hidden] { display: none; }
  #scene img { flex: 1; min-height: 0; width: 100%; object-fit: contain; object-position: center; border-radius: 8px; cursor: zoom-in; transition: opacity .4s; }
  #scene.loading img { opacity: 0; }
  #scene figcaption { flex: 0 0 auto; padding-top: 8px; color: var(--muted); font-size: 14px; font-style: italic; text-align: center; }
  body.scene-big #scene { position: fixed; inset: 64px 24px 24px; z-index: 20; flex: none; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
  body.scene-big #scene img { cursor: zoom-out; }
  #scene.loading figcaption::after { content: ' — ilustrando…'; color: var(--muted); }
  #log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 720px; padding: 10px 14px; border-radius: 8px; white-space: normal; word-wrap: break-word; }
  .msg p { margin: 0 0 .6em; } .msg p:last-child { margin: 0; }
  .master { background: var(--master); border-left: 3px solid var(--accent); }
  .system { background: var(--system); color: var(--muted); font-family: ui-monospace, Consolas, monospace; font-size: 13.5px; border: 1px solid var(--line); }
  .player { background: var(--player); align-self: flex-end; font-style: italic; }
  .error { color: var(--error); }
  .decisive { color: var(--error); font-size: 14px; margin-top: 6px; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .actions button, .chips button { background: var(--panel-2); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; cursor: pointer; font-size: 14px; }
  .actions button:hover:not(:disabled), .chips button:hover:not(:disabled) { border-color: var(--accent); }
  .actions button.roll { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: bold; }
  button:disabled { opacity: .45; cursor: default; }
  #thinking { padding: 0 16px 6px; color: var(--muted); font-style: italic; min-height: 1.6em; }
  .chips { display: flex; gap: 6px; padding: 0 16px 8px; overflow-x: auto; }
  .chips button { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; white-space: nowrap; }
  form { display: flex; gap: 8px; padding: 0 16px 16px; }
  form input { flex: 1; min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  form input:focus { outline: none; border-color: var(--accent); }
  form button { background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 8px; padding: 0 18px; cursor: pointer; font-weight: bold; }
  aside { width: 380px; border-left: 1px solid var(--line); background: var(--panel); overflow-y: auto; padding: 16px; }
  aside h2 { font-size: 16px; margin: 0 0 4px; color: var(--accent); font-weight: normal; }
  aside .desc { color: var(--muted); font-size: 14px; margin-bottom: 12px; white-space: pre-line; }
  aside .fields { display: flex; flex-wrap: wrap; gap: 10px; }
  aside .field { flex: 1 1 100%; } aside .field.inline { flex: 1 1 calc(50% - 10px); }
  aside .field b { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: normal; }
  aside .field span { font-size: 14px; white-space: pre-line; }
  aside .footer { margin-top: 14px; font-size: 12px; color: var(--muted); }
  #board { position: relative; margin: 0 0 14px; padding-bottom: 14px; border-bottom: 1px solid var(--line); transition: opacity .2s; }
  #board:empty { display: none; }
  #board.busy { opacity: .45; pointer-events: none; }
  #board .where { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; line-height: 1.3; }
  #board .where b { color: var(--accent); font-weight: normal; font-size: 16px; }
  #board .where span { color: var(--muted); font-size: 13px; flex: 1; }
  #board .where button { background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 0 8px; cursor: pointer; font-size: 13px; color: var(--muted); }
  #board .where button:hover { border-color: var(--accent); color: var(--text); }
  #board svg { display: block; margin: 0 auto; background: #15110d; border: 1px solid var(--line); border-radius: 6px; }
  #board svg text { font-family: Georgia, 'Iowan Old Style', serif; paint-order: stroke; stroke: #120d09; stroke-width: 3px; stroke-linejoin: round; pointer-events: none; }
  #board .spot { cursor: pointer; }
  #board .spot.here { cursor: default; }
  #board .spot .hit { fill: rgba(0,0,0,.001); stroke: none; }
  #board .spot text { pointer-events: auto; }
  #board .spot:hover .label, #board .spot.here .label { fill: var(--accent); }
  #board .prop[data-spot] { cursor: pointer; }
  #board .prop[data-spot]:hover { filter: brightness(1.3); }
  #board .label { fill: var(--text); font-size: 11px; text-anchor: middle; }
  #board .who { fill: #cdbfa8; font-size: 10px; font-style: italic; text-anchor: middle; }
  #board .prop-label { fill: #cdbfa8; font-size: 10px; text-anchor: middle; font-style: italic; opacity: .85; }
  #board .token { pointer-events: none; }
  #board .token .disc { fill: #221a13; }
  #board .token text { font-weight: bold; text-anchor: middle; dominant-baseline: central; stroke-width: 0; }
  #board .token.vague { opacity: .7; } #board .token.hint { opacity: .4; }
  #board .token.vague .ring, #board .token.hint .ring { stroke-dasharray: 3 2; }
  #board .route { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 4 4; pointer-events: none; }
  #board .exit { cursor: pointer; }
  #board .exit .path { stroke: #e9dcc4; stroke-width: 1.6; stroke-dasharray: 5 3; }
  #board .exit .hit { stroke: transparent; stroke-width: 16; }
  #board .exit text { fill: #e9dcc4; font-size: 11px; pointer-events: auto; }
  #board .exit:hover text { fill: var(--accent); } #board .exit:hover .path { stroke: var(--accent); }
  #board .exit.blocked { cursor: default; }
  #board .exit.blocked .path { stroke: var(--error); } #board .exit.blocked text { fill: var(--error); }
  #board .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; color: var(--muted); }
  #board .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid; margin-right: 4px; vertical-align: -1px; background: #221a13; }
  #board .tip { position: absolute; z-index: 30; display: none; max-width: 260px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; font-size: 13px; line-height: 1.4; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
  #board .tip b { color: var(--accent); font-weight: normal; }
  #board .tip div { margin-top: 3px; } #board .tip .hint { color: var(--muted); font-style: italic; font-size: 12px; }
  #map { position: relative; margin: 0 0 14px; padding-bottom: 14px; border-bottom: 1px solid var(--line); transition: opacity .2s; }
  #map:empty { display: none; }
  #map.busy { opacity: .45; pointer-events: none; }
  #map .where { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; margin-bottom: 6px; line-height: 1.3; }
  #map .where b { color: var(--accent); font-weight: normal; font-size: 16px; white-space: nowrap; }
  #map .where span.sub { color: var(--muted); font-size: 13px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #map .where .btns { margin-left: auto; display: flex; gap: 4px; white-space: nowrap; }
  #map .where button { background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 0 8px; cursor: pointer; font-size: 13px; color: var(--muted); }
  #map .where button:hover { border-color: var(--accent); color: var(--text); }
  #map .where button.on { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
  #map svg { display: block; margin: 0 auto; background: #1a1611; border: 1px solid var(--line); border-radius: 6px; }
  #map svg text { font-family: Georgia, 'Iowan Old Style', serif; paint-order: stroke; stroke: #120d09; stroke-width: 3px; stroke-linejoin: round; pointer-events: none; }
  #map .road { stroke: #a89778; stroke-width: 2.2; fill: none; }
  #map .road.blocked { stroke: var(--error); stroke-dasharray: 6 4; }
  #map .road-hit { stroke: transparent; stroke-width: 14; fill: none; }
  #map .dist { fill: #cdbfa8; font-size: 10px; text-anchor: middle; font-style: italic; }
  #map .place { cursor: pointer; }
  #map .place.here, #map .place.zone { cursor: default; }
  #map .place .disc { stroke: #0e0a07; stroke-width: 1.5; }
  #map .place.heard .disc { stroke-dasharray: 4 3; opacity: .55; }
  #map .place.here .disc { stroke: var(--accent); stroke-width: 2.5; }
  #map .place .glyph { fill: #ece3d4; opacity: .8; pointer-events: none; }
  #map .place.heard .glyph { opacity: .35; }
  #map .place .name { fill: var(--text); font-size: 11px; text-anchor: middle; }
  #map .place.heard .name { fill: var(--muted); font-style: italic; }
  #map .place.outside .name { fill: var(--muted); }
  #map .place:hover .name, #map .place.here .name { fill: var(--accent); }
  #map .token { pointer-events: none; }
  #map .token .disc { fill: #221a13; }
  #map .token text { font-weight: bold; text-anchor: middle; dominant-baseline: central; stroke-width: 0; }
  #map .token.unseen { opacity: .65; } #map .token.unseen .ring { stroke-dasharray: 3 2; }
  #map .route { stroke: #6fbf6f; stroke-width: 2; stroke-dasharray: 4 4; pointer-events: none; }
  #map .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; color: var(--muted); }
  #map .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid; margin-right: 4px; vertical-align: -1px; background: #221a13; }
  #map .legend i.heard { border-style: dashed; border-color: var(--muted); }
  #map .tip { position: absolute; z-index: 30; display: none; max-width: 260px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; font-size: 13px; line-height: 1.4; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
  #map .tip b { color: var(--accent); font-weight: normal; }
  #map .tip div { margin-top: 3px; } #map .tip .hint { color: var(--muted); font-style: italic; font-size: 12px; }
  body.map-big #map { position: fixed; inset: 64px 24px 24px; z-index: 21; margin: 0; padding: 14px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
  body.board-big #board { position: fixed; inset: 64px 24px 24px; z-index: 20; margin: 0; padding: 14px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
  @media (max-width: 820px) {
    #toggle-sheet { display: inline-block; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    aside { display: none; position: fixed; inset: 53px 0 0 0; width: auto; z-index: 5; border-left: 0; }
    body.show-sheet aside { display: block; }
    main { flex-direction: column; }
    #scene { flex: 0 0 32vh; padding: 8px 12px; border-left: 0; border-bottom: 1px solid var(--line); }
    #scene figcaption { padding-top: 4px; font-size: 13px; }
    #log { padding: 12px 16px; }
  }
</style>
</head>
<body>
<header>
  <a class="menu" href="/" title="Volver al menú de partidas">← Menú</a>
  <h1>Tavernus</h1>
  <span id="game-name"></span>
  <select id="character" aria-label="Personaje"></select>
  <span class="spacer"></span>
  <button id="toggle-sheet" type="button">Hoja</button>
</header>
<main>
  <section id="play">
    <div id="log" aria-live="polite"></div>
    <div id="thinking"></div>
    <div class="chips">
      <button data-cmd="look">/look</button><button data-cmd="where">/where</button><button data-cmd="who">/who</button>
      <button data-cmd="inventory">/inventory</button><button data-cmd="recap">/recap</button><button data-cmd="time">/time</button>
      <button data-cmd="tablon">/tablon</button><button data-cmd="progress">/progress</button>
    </div>
    <form id="form" autocomplete="off">
      <input id="input" placeholder="¿Qué haces?" aria-label="Acción">
      <button type="submit">Enviar</button>
    </form>
  </section>
  <figure id="scene" hidden><img alt=""><figcaption></figcaption></figure>
  <aside id="side"><div id="board"></div><div id="map"></div><div id="sheet"></div></aside>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var game = params.get('game');
  if (!game) { location.replace('/'); return; }
  /** Todas las rutas /api/* llevan la partida activa. */
  function api(path) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 'game=' + encodeURIComponent(game); }
  var MODE_LABEL = { live: 'real', offline: 'offline', record: 'grabando', replay: 'demo' };
  fetch('/api/games').then(function (r) { return r.json(); }).then(function (d) {
    var g = (d.games || []).filter(function (x) { return x.slug === game; })[0];
    if (!g) return;
    $('game-name').textContent = g.name + ' · ' + (MODE_LABEL[g.mode] || g.mode);
    document.title = g.name + ' — Tavernus';
  }).catch(function () {});
  var log = $('log'), input = $('input'), select = $('character'), thinking = $('thinking');
  var current = null, stream = null, busy = false, dots = null;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function escapeHtml(s) { return s.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function format(text) {
    return escapeHtml(text).split(/\n{2,}/).map(function (p) {
      return '<p>' + p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function scroll() { log.scrollTop = log.scrollHeight; }
  function spendButtons() { log.querySelectorAll('.actions button').forEach(function (b) { b.disabled = true; }); }

  function add(kind, text, extra) {
    var div = document.createElement('div');
    div.className = 'msg ' + kind + (extra && extra.error ? ' error' : '');
    div.innerHTML = format(text);
    log.appendChild(div);
    scroll();
    return div;
  }

  function renderMessage(m, live) {
    var div = add(m.kind, m.text);
    if (m.decisive_s) {
      var d = document.createElement('div');
      d.className = 'decisive';
      d.textContent = '⏳ Tienes ' + m.decisive_s + ' segundos para reaccionar. Si no, la amenaza se cumple.';
      div.appendChild(d);
    }
    if (!m.roll && !(m.suggested && m.suggested.length)) return;
    if (live) spendButtons();
    var row = document.createElement('div');
    row.className = 'actions';
    if (m.roll) {
      var b = document.createElement('button');
      b.className = 'roll';
      b.textContent = '🎲 Tirar' + (m.roll.dc ? ' · CD ' + m.roll.dc : '');
      b.onclick = function () { spendButtons(); roll(); };
      row.appendChild(b);
    } else {
      m.suggested.forEach(function (a) {
        var b = document.createElement('button');
        b.textContent = a;
        b.onclick = function () { spendButtons(); act(a); };
        row.appendChild(b);
      });
    }
    div.appendChild(row);
    if (!live) row.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    scroll();
  }

  function setBusy(on) {
    busy = on;
    input.disabled = on;
    $('board').classList.toggle('busy', on);
    $('map').classList.toggle('busy', on);
    document.querySelectorAll('.chips button, form button').forEach(function (b) { b.disabled = on; });
    clearInterval(dots);
    if (!on) { thinking.textContent = ''; input.focus(); return; }
    var n = 0;
    thinking.textContent = 'El narrador está pensando';
    dots = setInterval(function () { n = (n + 1) % 4; thinking.textContent = 'El narrador está pensando' + '.'.repeat(n); }, 400);
  }

  function post(path, body) {
    body.character = current;
    return fetch(api(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, text: 'No hay conexión con el servidor.' }; });
  }

  function handleReply(r) {
    if (!r.ok) add('system', '✗ ' + r.text, { error: true });
    else if (r.text) add('system', r.text);
  }

  function act(text) {
    if (busy) return;
    add('player', text);
    setBusy(true);
    post('/api/act', { text: text }).then(handleReply).finally(function () { setBusy(false); loadSheet(); });
  }
  function roll() {
    if (busy) return;
    setBusy(true);
    post('/api/roll', {}).then(handleReply).finally(function () { setBusy(false); loadSheet(); });
  }
  function command(name) {
    if (busy) return;
    post('/api/command', { name: name }).then(handleReply);
  }

  function loadSheet() {
    if (!current) return;
    loadBoard();
    fetch(api('/api/sheet?character=' + encodeURIComponent(current))).then(function (r) { return r.json(); }).then(function (s) {
      if (!s.title) return;
      var html = '<h2>' + escapeHtml(s.title) + '</h2><div class="desc">' + escapeHtml(s.description) + '</div><div class="fields">';
      s.fields.forEach(function (f) {
        html += '<div class="field' + (f.inline ? ' inline' : '') + '"><b>' + escapeHtml(f.name) + '</b><span>' + escapeHtml(f.value) + '</span></div>';
      });
      $('sheet').innerHTML = html + '</div><div class="footer">' + escapeHtml(s.footer) + '</div>';
    }).catch(function () {});
  }

  // --- Tablero de la localización ------------------------------------------
  // Plano tipo mesa de juego: casillas de 1,5 m, suelos, paredes, puertas,
  // muebles y fichas. Coordenadas del motor en metros, +y al norte.
  // Ilustración de la localización actual (IMAGES=on): sobre el chat, cambia al llegar a otra.
  var scene = $('scene'), sceneImg = scene.querySelector('img'), sceneCap = scene.querySelector('figcaption');
  var sceneSrc = null, sceneTimer = null;
  function showScene(s) {
    if (!s) { scene.hidden = true; sceneSrc = null; sceneImg.removeAttribute('src'); return; }
    sceneCap.textContent = s.name;
    sceneImg.alt = 'Ilustración: ' + s.name;
    if (s.src === sceneSrc) return;
    sceneSrc = s.src;
    scene.classList.add('loading'); scene.hidden = false;
    sceneImg.src = s.src;
  }
  sceneImg.addEventListener('load', function () { scene.classList.remove('loading'); });
  // La imagen la sirve el propio servidor (data/games/<slug>/images): si no carga, se oculta.
  sceneImg.addEventListener('error', function () { if (sceneSrc) scene.hidden = true; });
  // Clic en la ilustración: a pantalla grande; otro clic o Esc la devuelve a su columna.
  sceneImg.addEventListener('click', function () { document.body.classList.toggle('scene-big'); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') document.body.classList.remove('scene-big'); });
  function loadScene() {
    if (!current) return;
    var id = current;
    clearTimeout(sceneTimer);
    sceneTimer = setTimeout(function () {
      fetch(api('/api/scene?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && id === current) showScene(d.image);
      }).catch(function () {});
    }, 250);
  }

  var board = $('board'), boardData = null, boardSeq = 0, boardTimer = null;
  var LIGHT = { day: 'de día', twilight: 'penumbra', night_moon: 'noche con luna', night_dark: 'noche cerrada' };
  var DARK = { day: 0, twilight: 0.16, night_moon: 0.38, night_dark: 0.58 };
  var RING = { actor: '#d9a35b', character: '#9cb08a', npc: '#c97b5a' };
  var GROUND = {
    void: { base: '#15110d' }, wood: { base: '#6a4f35', line: '#4f3a26' }, stone: { base: '#55504a', line: '#3f3b36' },
    cobble: { base: '#5f5850', dot: '#4a443e' }, grass: { base: '#46542f', dot: '#3a4727' }, dirt: { base: '#7a6243', dot: '#665136' },
    water: { base: '#2f5566', line: '#4f7a8a' }
  };

  var PROP_ES = {
    table: 'mesa', round_table: 'mesa redonda', chair: 'silla', stool: 'taburete', counter: 'mostrador', shelf: 'estantería',
    fireplace: 'chimenea', barrel: 'barril', crate: 'caja', bed: 'cama', chest: 'arcón', rug: 'alfombra', stairs: 'escalera',
    trapdoor: 'trampilla', well: 'pozo', notice: 'tablón de avisos', building: 'edificio', tree: 'árbol', rock: 'roca', bush: 'arbusto'
  };
  function propName(p) { var n = p.label || PROP_ES[p.kind] || p.kind; return n.charAt(0).toUpperCase() + n.slice(1); }

  function fmtM(d) { return (d >= 100 ? Math.round(d) : Math.round(d * 10) / 10) + ' m'; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function initial(label) { var t = label.replace(/^(el|la|los|las|un|una)\s+/i, ''); return t.charAt(0).toUpperCase(); }

  function loadBoard() {
    if (!current) return;
    loadMap();
    var seq = ++boardSeq, id = current;
    fetch(api('/api/board?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      if (seq !== boardSeq || id !== current) return;
      if (!b || !b.location || !b.map) { board.innerHTML = ''; boardData = null; return; }
      renderBoard(b);
      clearTimeout(boardTimer);
      if (b.actor.transit) boardTimer = setTimeout(loadBoard, 2000);
    }).catch(function () {});
  }

  function patterns(k) {
    var p = '';
    var px = function (m) { return r1(Math.max(2, m * k)); };
    p += '<pattern id="g-wood" patternUnits="userSpaceOnUse" width="' + px(2.4) + '" height="' + px(0.4) + '"><rect width="100%" height="100%" fill="' + GROUND.wood.base + '"/>' +
      '<path d="M0 ' + px(0.4) + ' H' + px(2.4) + ' M' + px(1.6) + ' 0 V' + px(0.4) + '" stroke="' + GROUND.wood.line + '" stroke-width="1"/></pattern>';
    p += '<pattern id="g-stone" patternUnits="userSpaceOnUse" width="' + px(1) + '" height="' + px(1) + '"><rect width="100%" height="100%" fill="' + GROUND.stone.base + '"/>' +
      '<rect width="' + px(1) + '" height="' + px(1) + '" fill="none" stroke="' + GROUND.stone.line + '" stroke-width="1"/></pattern>';
    p += '<pattern id="g-cobble" patternUnits="userSpaceOnUse" width="' + px(0.7) + '" height="' + px(0.7) + '"><rect width="100%" height="100%" fill="' + GROUND.cobble.base + '"/>' +
      '<circle cx="' + px(0.35) + '" cy="' + px(0.35) + '" r="' + px(0.26) + '" fill="none" stroke="' + GROUND.cobble.dot + '" stroke-width="1"/></pattern>';
    p += '<pattern id="g-grass" patternUnits="userSpaceOnUse" width="' + px(1.2) + '" height="' + px(1.2) + '"><rect width="100%" height="100%" fill="' + GROUND.grass.base + '"/>' +
      '<circle cx="' + px(0.3) + '" cy="' + px(0.4) + '" r="1" fill="' + GROUND.grass.dot + '"/><circle cx="' + px(0.9) + '" cy="' + px(0.95) + '" r="1.2" fill="' + GROUND.grass.dot + '"/></pattern>';
    p += '<pattern id="g-dirt" patternUnits="userSpaceOnUse" width="' + px(1) + '" height="' + px(1) + '"><rect width="100%" height="100%" fill="' + GROUND.dirt.base + '"/>' +
      '<circle cx="' + px(0.25) + '" cy="' + px(0.7) + '" r="1" fill="' + GROUND.dirt.dot + '"/></pattern>';
    p += '<pattern id="g-water" patternUnits="userSpaceOnUse" width="' + px(1.6) + '" height="' + px(0.8) + '"><rect width="100%" height="100%" fill="' + GROUND.water.base + '"/>' +
      '<path d="M0 ' + px(0.4) + ' q' + px(0.4) + ' -' + px(0.2) + ' ' + px(0.8) + ' 0 t' + px(0.8) + ' 0" fill="none" stroke="' + GROUND.water.line + '" stroke-width="1"/></pattern>';
    p += '<pattern id="g-void" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="' + GROUND.void.base + '"/></pattern>';
    p += '<marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#e9dcc4"/></marker>';
    p += '<marker id="arr-x" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#e07a62"/></marker>';
    return '<defs>' + p + '</defs>';
  }

  function propSvg(p, X, Y, k) {
    var W = function (m) { return r1(m * k); };
    var R = function (x, y, w, h, fill, stroke, sw, extra) {
      return '<rect x="' + r1(X(x)) + '" y="' + r1(Y(y + h)) + '" width="' + W(w) + '" height="' + W(h) + '" fill="' + fill + '"' +
        (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 1) + '"' : '') + (extra || '') + '/>';
    };
    var C = function (x, y, r, fill, stroke, sw) {
      return '<circle cx="' + r1(X(x)) + '" cy="' + r1(Y(y)) + '" r="' + r1(Math.max(1.5, r * k)) + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 1) + '"' : '') + '/>';
    };
    var w = p.w || 0, h = p.h || 0, r = p.r || 0, s = '';
    switch (p.kind) {
      case 'table': return R(p.x, p.y, w, h, '#7d5b3a', '#2a1d12', 1.2);
      case 'chair': return R(p.x, p.y, w, h, '#5d4229', '#2a1d12', 1);
      case 'counter': return R(p.x, p.y, w, h, '#5a3d24', '#1e140c', 1.5);
      case 'shelf': return R(p.x, p.y, w, h, '#3d2b1b', '#1e140c', 1);
      case 'round_table': return C(p.x, p.y, r, '#7d5b3a', '#2a1d12', 1.2);
      case 'stool': return C(p.x, p.y, r, '#5d4229', '#2a1d12', 1);
      case 'barrel': return C(p.x, p.y, r, '#7a5532', '#2a1d12', 1.2) + C(p.x, p.y, r * 0.55, 'none', '#4a321c', 1);
      case 'crate': return R(p.x, p.y, w, h, '#86663f', '#2a1d12', 1.2) +
        '<path d="M' + r1(X(p.x)) + ' ' + r1(Y(p.y)) + ' L' + r1(X(p.x + w)) + ' ' + r1(Y(p.y + h)) + ' M' + r1(X(p.x + w)) + ' ' + r1(Y(p.y)) + ' L' + r1(X(p.x)) + ' ' + r1(Y(p.y + h)) + '" stroke="#4a321c" stroke-width="1"/>';
      case 'fireplace': return R(p.x, p.y, w, h, '#3b3532', '#1a1715', 1.5) + R(p.x + w * 0.2, p.y + h * 0.1, w * 0.6, h * 0.5, '#c4602a', null, 0, ' opacity=".85"') +
        C(p.x + w / 2, p.y + h * 0.35, Math.min(w, h) * 0.18, '#f0a24a');
      case 'bed': return R(p.x, p.y, w, h, '#6b5a4a', '#2a1d12', 1.2) + R(p.x + w * 0.1, p.y + h * 0.72, w * 0.8, h * 0.2, '#d9cdb5') + R(p.x + w * 0.05, p.y + h * 0.05, w * 0.9, h * 0.6, '#5a4a6e', null, 0, ' opacity=".8"');
      case 'chest': return R(p.x, p.y, w, h, '#7a5532', '#2a1d12', 1.2) + R(p.x + w * 0.42, p.y + h * 0.3, w * 0.16, h * 0.4, '#c9a85b');
      case 'rug': return R(p.x, p.y, w, h, '#7a3b2c', '#c9a85b', 1, ' opacity=".85"') + R(p.x + w * 0.1, p.y + h * 0.15, w * 0.8, h * 0.7, 'none', '#c9a85b', 0.8, ' opacity=".7"');
      case 'trapdoor': return R(p.x, p.y, w, h, '#4a3420', '#1e140c', 1.5) + C(p.x + w / 2, p.y + h * 0.75, Math.min(w, h) * 0.12, 'none', '#9a8a70', 1.2);
      case 'stairs':
        s = R(p.x, p.y, w, h, '#5a4430', '#1e140c', 1.2);
        for (var i = 1; i < 8; i++) s += '<line x1="' + r1(X(p.x)) + '" x2="' + r1(X(p.x + w)) + '" y1="' + r1(Y(p.y + h * i / 8)) + '" y2="' + r1(Y(p.y + h * i / 8)) + '" stroke="#2a1d12" stroke-width="1"/>';
        return s;
      case 'well': return C(p.x, p.y, r, '#6d6a66', '#2b2926', 2) + C(p.x, p.y, r * 0.6, '#1d2a30', '#2b2926', 1);
      case 'notice': return R(p.x, p.y, w, h, '#9a7a4e', '#2a1d12', 1.2);
      case 'building':
        s = R(p.x, p.y, w, h, '#2c2420', '#0f0b08', 2.5);
        if (p.label) s += '<text class="prop-label" x="' + r1(X(p.x + w / 2)) + '" y="' + r1(Y(p.y + h / 2) + 4) + '">' + escapeHtml(p.label) + '</text>';
        return s;
      case 'tree': return C(p.x, p.y, r, '#2f3f22', '#1f2a16', 1.5) + C(p.x - r * 0.25, p.y + r * 0.2, r * 0.55, '#3a4d2a') + C(p.x, p.y, Math.max(0.25, r * 0.12), '#4a3420');
      case 'rock': return '<ellipse cx="' + r1(X(p.x)) + '" cy="' + r1(Y(p.y)) + '" rx="' + W(r) + '" ry="' + W(r * 0.72) + '" fill="#77756c" stroke="#3d3c37" stroke-width="1.5"/>';
      case 'bush': return C(p.x, p.y, r, '#3e5230', '#26331d', 1) + C(p.x - r * 0.3, p.y, r * 0.15, '#8a2f3a') + C(p.x + r * 0.3, p.y + r * 0.25, r * 0.15, '#8a2f3a');
      case 'text': return '<text class="prop-label" x="' + r1(X(p.x)) + '" y="' + r1(Y(p.y)) + '">' + escapeHtml(p.label || '') + '</text>';
    }
    return '';
  }

  function poly(points, X, Y) { return points.map(function (q, i) { return (i ? 'L' : 'M') + r1(X(q[0])) + ' ' + r1(Y(q[1])); }).join(' '); }

  function renderBoard(b) {
    boardData = b;
    var m = b.map, bd = m.bounds;
    var big = document.body.classList.contains('board-big');
    // El tablero vacío no ocupa sitio: se mide la columna (o el modal si está ampliado).
    var W = big ? board.clientWidth - 32 : $('side').clientWidth - 32;
    if (!(W >= 200)) W = Math.max(200, Math.min(window.innerWidth - 32, 360));
    var maxH = big ? Math.max(320, window.innerHeight - 200) : W * 1.15;
    var k = W / bd.w;
    if (bd.h * k > maxH) k = maxH / bd.h;
    var SW = r1(bd.w * k), H = r1(bd.h * k);
    var X = function (x) { return (x - bd.x) * k; };
    var Y = function (y) { return (bd.y + bd.h - y) * k; };
    var o = [];
    o.push('<svg width="' + SW + '" height="' + H + '" viewBox="0 0 ' + SW + ' ' + H + '" role="img" aria-label="Plano de ' + escapeHtml(b.location.name) + '">');
    o.push(patterns(k));
    o.push('<rect width="' + SW + '" height="' + H + '" fill="url(#g-' + m.background + ')"/>');

    // Suelos.
    m.areas.forEach(function (a) {
      if (a.polygon) o.push('<path d="' + poly(a.polygon, X, Y) + ' Z" fill="url(#g-' + a.ground + ')"/>');
      else if (a.path) o.push('<path d="' + poly(a.path, X, Y) + '" fill="none" stroke="url(#g-' + a.ground + ')" stroke-width="' + r1((a.width || 1.5) * k) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    });

    // Cuadrícula de casillas, centrada en el origen del motor.
    var cm = m.cell_m || 1.5, gs = [];
    for (var gx = (Math.ceil((bd.x - cm / 2) / cm) + 0.5) * cm; gx < bd.x + bd.w; gx += cm) gs.push('M' + r1(X(gx)) + ' 0 V' + H);
    for (var gy = (Math.ceil((bd.y - cm / 2) / cm) + 0.5) * cm; gy < bd.y + bd.h; gy += cm) gs.push('M0 ' + r1(Y(gy)) + ' H' + SW);
    o.push('<path d="' + gs.join(' ') + '" stroke="#0d0906" stroke-opacity=".35" stroke-width="1" fill="none"/>');

    // Muebles y elementos (los edificios antes que el resto).
    var seen = {};
    b.spots.forEach(function (s) { seen[s.id] = true; });
    var drawProp = function (p, i) {
      if (p.kind === 'text') { o.push(propSvg(p, X, Y, k)); return; }
      var link = p.spot_id && seen[p.spot_id] ? ' data-spot="' + escapeHtml(p.spot_id) + '"' : '';
      o.push('<g class="prop" data-prop="' + i + '"' + link + '>' + propSvg(p, X, Y, k) + '</g>');
    };
    m.props.forEach(function (p, i) { if (p.kind === 'building') drawProp(p, i); });
    m.props.forEach(function (p, i) { if (p.kind !== 'building') drawProp(p, i); });

    // Paredes y puertas.
    var ww = r1(Math.max(4, 0.32 * k));
    m.walls.forEach(function (w) { o.push('<path d="' + poly(w.points, X, Y) + '" fill="none" stroke="#0e0a07" stroke-width="' + ww + '" stroke-linecap="square" stroke-linejoin="miter"/>'); });
    m.doors.forEach(function (d) {
      o.push('<path d="' + poly([d.from, d.to], X, Y) + '" stroke="#0e0a07" stroke-width="' + r1(ww * 0.9) + '"/>');
      o.push('<path d="' + poly([d.from, d.to], X, Y) + '" stroke="#a07a4a" stroke-width="' + r1(ww * 0.5) + '"/>');
    });

    // Luz: cuanto más oscuro, más velo.
    var dark = DARK[b.location.light] || 0;
    if (dark) o.push('<rect width="' + SW + '" height="' + H + '" fill="#07050a" opacity="' + dark + '" pointer-events="none"/>');

    // Salidas: flecha desde su punto hacia el borde del plano, alejándose del centro.
    var cxp = SW / 2, cyp = H / 2, EDGE = 6;
    var byFrom = {};
    b.exits.forEach(function (e) { (byFrom[e.from_spot_id] = byFrom[e.from_spot_id] || []).push(e); });
    b.spots.forEach(function (sp) {
      var list = byFrom[sp.id];
      if (!list) return;
      var px = X(sp.x), py = Y(sp.y);
      var dx = px - cxp, dy = py - cyp, len = Math.hypot(dx, dy);
      if (len < 1) { dx = 0; dy = 1; len = 1; }
      list.forEach(function (e, i) {
        var a = (i - (list.length - 1) / 2) * 0.45;
        var ux = (dx * Math.cos(a) - dy * Math.sin(a)) / len, uy = (dx * Math.sin(a) + dy * Math.cos(a)) / len;
        var tx = ux > 0 ? (SW - EDGE - px) / ux : ux < 0 ? (EDGE - px) / ux : Infinity;
        var ty = uy > 0 ? (H - EDGE - py) / uy : uy < 0 ? (EDGE - py) / uy : Infinity;
        var t = Math.min(tx, ty), ex = px + ux * t, ey = py + uy * t;
        var side = tx < ty ? (ux > 0 ? 'right' : 'left') : (uy > 0 ? 'bottom' : 'top');
        var lx, ly, anchor;
        if (side === 'right') { lx = ex - 4; ly = ey - 7; anchor = 'end'; }
        else if (side === 'left') { lx = ex + 4; ly = ey - 7; anchor = 'start'; }
        else { anchor = ex < SW / 2 ? 'start' : 'end'; lx = ex + (anchor === 'start' ? 8 : -8); ly = side === 'top' ? 14 : H - 6; }
        var label = '→ ' + e.to_location_name + ' · ' + fmtM(e.distance_m) + (e.blocked ? ' · bloqueada' : '');
        var start = Math.min(14, t / 3);
        var seg = 'x1="' + r1(px + ux * start) + '" y1="' + r1(py + uy * start) + '" x2="' + r1(ex) + '" y2="' + r1(ey) + '"';
        o.push('<g class="exit' + (e.blocked ? ' blocked' : '') + '" data-exit="' + escapeHtml(e.id) + '" data-side="' + side + '">' +
          '<line class="hit" ' + seg + '/><line class="path" marker-end="url(#' + (e.blocked ? 'arr-x' : 'arr') + ')" ' + seg + '/>' +
          '<text x="' + r1(lx) + '" y="' + r1(ly) + '" text-anchor="' + anchor + '">' + escapeHtml(label) + '</text></g>');
      });
    });

    // Ruta en curso.
    if (b.actor.transit) {
      var nxt = b.spots.filter(function (s) { return s.id === b.actor.transit.to_spot_id; })[0];
      if (nxt) o.push('<line class="route" x1="' + r1(X(b.actor.x)) + '" y1="' + r1(Y(b.actor.y)) + '" x2="' + r1(X(nxt.x)) + '" y2="' + r1(Y(nxt.y)) + '"/>');
    }

    // Fichas por punto: el actor (si está quieto) y los presentes quietos.
    var tokR = Math.max(7, Math.min(0.42 * cm * k, 17));
    var tokens = {};
    var push = function (spotId, t) { (tokens[spotId] = tokens[spotId] || []).push(t); };
    if (!b.actor.transit) push(b.actor.spot_id, { kind: 'actor', level: 'full', label: b.actor.name });
    b.presences.forEach(function (p) { if (!p.moving) push(p.spot_id, p); });
    var token = function (t, x, y) {
      var ring = RING[t.kind], letter = t.level === 'full' ? initial(t.label) : '?';
      var rr = t.level === 'hint' ? tokR * 0.75 : tokR;
      return '<g class="token ' + t.kind + ' ' + t.level + '"><circle class="disc" cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(rr) + '"/>' +
        '<circle class="ring" cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(rr - Math.max(1.5, rr * 0.14)) + '" fill="none" stroke="' + ring + '" stroke-width="' + r1(Math.max(2, rr * 0.26)) + '"/>' +
        (t.kind === 'actor' ? '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(rr + 2.5) + '" fill="none" stroke="' + ring + '" stroke-opacity=".45" stroke-width="2"/>' : '') +
        '<text x="' + r1(x) + '" y="' + r1(y) + '" fill="' + ring + '" font-size="' + r1(rr * 0.95) + '">' + escapeHtml(letter) + '</text></g>';
    };

    b.spots.forEach(function (sp) {
      var px = X(sp.x), py = Y(sp.y);
      var here = !b.actor.transit && sp.id === b.actor.spot_id;
      var ts = tokens[sp.id] || [];
      var spread = ts.length > 1 ? tokR * 1.15 : 0;
      var markR = Math.max(8, (ts.length ? tokR + spread : tokR * 0.6) + 2);
      o.push('<g class="spot' + (here ? ' here' : '') + '" data-spot="' + escapeHtml(sp.id) + '">');
      o.push('<circle class="hit" cx="' + r1(px) + '" cy="' + r1(py) + '" r="' + r1(markR) + '"/>');
      o.push('<text class="label" x="' + r1(px) + '" y="' + r1(py + markR + 8) + '">' + escapeHtml(sp.name) + '</text>');
      var others = ts.filter(function (t) { return t.kind !== 'actor'; });
      if (others.length) {
        var who = others.map(function (t) { return t.label; }).join(', ');
        if (who.length > 36) who = who.slice(0, 35) + '…';
        o.push('<text class="who" x="' + r1(px) + '" y="' + r1(py + markR + 20) + '">' + escapeHtml(who) + '</text>');
      }
      o.push('</g>');
      ts.forEach(function (t, i) {
        var a = -Math.PI / 2 + (2 * Math.PI * i) / ts.length;
        o.push(token(t, px + Math.cos(a) * spread, py + Math.sin(a) * spread));
      });
    });
    // Quien va de camino, en su posición interpolada.
    b.presences.filter(function (p) { return p.moving; }).forEach(function (p) { o.push(token(p, X(p.x), Y(p.y))); });
    if (b.actor.transit) o.push(token({ kind: 'actor', level: 'full', label: b.actor.name }, X(b.actor.x), Y(b.actor.y)));
    o.push('</svg>');

    var where = '<div class="where"><b>' + escapeHtml(b.location.name) + '</b><span>· ' + escapeHtml(LIGHT[b.location.light] || b.location.light) +
      (b.actor.transit ? ' · de camino a ' + escapeHtml(b.actor.transit.destination_name) : '') + '</span>' +
      '<button type="button" data-toggle-big title="' + (big ? 'Volver al panel (Esc)' : 'Ver el tablero en grande') + '">' + (big ? 'Cerrar' : 'Ampliar') + '</button></div>';
    var legend = '<div class="legend"><span><i style="border-color:' + RING.actor + '"></i>tú</span><span><i style="border-color:' + RING.character + '"></i>personaje</span>' +
      '<span><i style="border-color:' + RING.npc + '"></i>PNJ</span><span>? lo intuyes</span><span>pasa el ratón para ver qué hay</span>' +
      '<span>casilla ' + String(cm).replace('.', ',') + ' m</span></div>';
    board.innerHTML = where + o.join('') + legend + '<div class="tip"></div>';

    // Ninguna etiqueta se sale del plano (solo si se ve y se puede medir).
    var clamp = function (t) {
      var bb = t.getBBox();
      if (!bb.width) return;
      var sx = bb.x < 2 ? 2 - bb.x : bb.x + bb.width > SW - 2 ? SW - 2 - bb.x - bb.width : 0;
      var sy = bb.y < 2 ? 2 - bb.y : bb.y + bb.height > H - 2 ? H - 2 - bb.y - bb.height : 0;
      if (sx) t.setAttribute('x', r1(Number(t.getAttribute('x')) + sx));
      if (sy) t.setAttribute('y', r1(Number(t.getAttribute('y')) + sy));
    };
    board.querySelectorAll('svg text').forEach(function (t) { if (!t.closest('.token') && !t.closest('.exit')) clamp(t); });
    // Rótulos de salida: dentro del plano y sin pisar los nombres de los puntos; si chocan, se deslizan por el borde.
    var labels = [].slice.call(board.querySelectorAll('svg .label, svg .who, svg .token')).map(function (t) { return t.getBBox(); });
    var hits = function (a) { return labels.some(function (l) { return a.x < l.x + l.width + 3 && l.x < a.x + a.width + 3 && a.y < l.y + l.height + 2 && l.y < a.y + a.height + 2; }); };
    board.querySelectorAll('svg .exit').forEach(function (g) {
      var t = g.querySelector('text');
      clamp(t);
      if (!t.getBBox().width || !hits(t.getBBox())) return;
      var along = g.getAttribute('data-side') === 'top' || g.getAttribute('data-side') === 'bottom' ? 'x' : 'y';
      var x0 = Number(t.getAttribute('x')), y0 = Number(t.getAttribute('y'));
      for (var d = 6; d <= 240; d += 6) {
        for (var sgn = 1; sgn >= -1; sgn -= 2) {
          t.setAttribute('x', r1(along === 'x' ? x0 + sgn * d : x0));
          t.setAttribute('y', r1(along === 'y' ? y0 + sgn * d : y0));
          var bb = t.getBBox();
          if (bb.x >= 2 && bb.x + bb.width <= SW - 2 && bb.y >= 2 && bb.y + bb.height <= H - 2 && !hits(bb)) return;
        }
      }
      t.setAttribute('x', r1(x0)); t.setAttribute('y', r1(y0));
    });
  }

  // --- Mapa de zona y región ------------------------------------------------
  // Grafo de lugares conocidos por el PJ, dispuesto en el servidor desde los
  // datos de la partida (/api/map). Solo personajes encima: verde tú, azul
  // aliados y neutrales, rojo hostiles.
  var mapEl = $('map'), mapData = null, mapSeq = 0;
  var mapView = store('tavernus.mapview') === 'world' ? 'world' : 'zone';
  var RING_MAP = { self: '#6fbf6f', ally: '#5b9bd5', hostile: '#e0564a' };
  var KIND = {
    town: { fill: '#7d6440', name: 'poblado' }, forest: { fill: '#3f6b3a', name: 'bosque' }, cave: { fill: '#4a4a56', name: 'cueva' },
    water: { fill: '#2f5566', name: 'agua' }, sand: { fill: '#9a8a5a', name: 'arena' }, wild: { fill: '#6b7a3a', name: 'campo' }, place: { fill: '#5a5048', name: 'lugar' }
  };
  var ZONE_KIND = { town: 'ciudad', city: 'ciudad', village: 'aldea', forest: 'bosque', cave: 'cueva', dungeon: 'mazmorra', mountain: 'montaña', coast: 'costa', road: 'camino', wild: 'campo' };

  function loadMap() {
    if (!current) return;
    var seq = ++mapSeq, id = current;
    fetch(api('/api/map?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (seq !== mapSeq || id !== current) return;
      if (!m || !m.zone) { mapEl.innerHTML = ''; mapData = null; return; }
      renderMap(m);
    }).catch(function () {});
  }

  function glyph(kind, x, y, r) {
    var g = r * 0.55;
    switch (kind) {
      case 'town': return '<path class="glyph" d="M' + r1(x - g) + ' ' + r1(y + g * 0.9) + ' V' + r1(y) + ' L' + r1(x) + ' ' + r1(y - g) + ' L' + r1(x + g) + ' ' + r1(y) + ' V' + r1(y + g * 0.9) + ' Z"/>';
      case 'forest': return '<path class="glyph" d="M' + r1(x) + ' ' + r1(y - g) + ' L' + r1(x + g) + ' ' + r1(y + g * 0.5) + ' H' + r1(x - g) + ' Z"/><rect class="glyph" x="' + r1(x - g * 0.18) + '" y="' + r1(y + g * 0.5) + '" width="' + r1(g * 0.36) + '" height="' + r1(g * 0.5) + '"/>';
      case 'cave': return '<path class="glyph" d="M' + r1(x - g) + ' ' + r1(y + g * 0.8) + ' V' + r1(y) + ' A' + r1(g) + ' ' + r1(g) + ' 0 0 1 ' + r1(x + g) + ' ' + r1(y) + ' V' + r1(y + g * 0.8) + ' Z"/>';
      case 'water': return '<path class="glyph" d="M' + r1(x - g) + ' ' + r1(y) + ' q' + r1(g / 2) + ' -' + r1(g / 2) + ' ' + r1(g) + ' 0 t' + r1(g) + ' 0" fill="none" stroke="#ece3d4" stroke-width="2" opacity=".8"/>';
      case 'wild': return '<path class="glyph" d="M' + r1(x - g) + ' ' + r1(y + g * 0.6) + ' q' + r1(g * 0.6) + ' -' + r1(g * 1.4) + ' ' + r1(g * 1.2) + ' 0 q' + r1(g * 0.3) + ' -' + r1(g * 0.6) + ' ' + r1(g * 0.8) + ' 0 Z"/>';
      case 'sand': return '<circle class="glyph" cx="' + r1(x - g * 0.4) + '" cy="' + r1(y + g * 0.3) + '" r="1.5"/><circle class="glyph" cx="' + r1(x + g * 0.4) + '" cy="' + r1(y - g * 0.2) + '" r="1.5"/><circle class="glyph" cx="' + r1(x) + '" cy="' + r1(y + g * 0.6) + '" r="1.2"/>';
    }
    return '';
  }

  function mapToken(t, x, y, rr) {
    var ring = RING_MAP[t.relation] || RING_MAP.ally, letter = t.level === 'full' || t.relation === 'self' || t.kind === 'character' ? initial(t.label) : '?';
    return '<g class="token' + (t.seen ? '' : ' unseen') + '"><circle class="disc" cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(rr) + '"/>' +
      '<circle class="ring" cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(rr - 1.8) + '" fill="none" stroke="' + ring + '" stroke-width="2.4"/>' +
      (t.relation === 'self' ? '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(rr + 2.5) + '" fill="none" stroke="' + ring + '" stroke-opacity=".45" stroke-width="2"/>' : '') +
      '<text x="' + r1(x) + '" y="' + r1(y) + '" fill="' + ring + '" font-size="' + r1(rr * 0.95) + '">' + escapeHtml(letter) + '</text></g>';
  }

  function renderMap(m) {
    mapData = m;
    var view = mapView === 'world' ? m.world : m.zone, bd = view.bounds, isWorld = mapView === 'world';
    var big = document.body.classList.contains('map-big');
    var W = big ? mapEl.clientWidth - 32 : $('side').clientWidth - 32;
    if (!(W >= 200)) W = Math.max(200, Math.min(window.innerWidth - 32, 360));
    var maxH = big ? Math.max(320, window.innerHeight - 200) : W * 0.9;
    var k = W / bd.w;
    if (bd.h * k > maxH) k = maxH / bd.h;
    var SW = r1(bd.w * k), H = r1(bd.h * k);
    var X = function (x) { return (x - bd.x) * k; };
    var Y = function (y) { return (bd.y + bd.h - y) * k; };
    var nodeR = big ? 16 : 13, tokR = big ? 9 : 7.5;
    var byId = {};
    view.nodes.forEach(function (n) { byId[n.id] = n; });
    var at = function (p) { return isWorld ? byId[p.zone_id] : byId[p.location_id]; };
    var ends = function (pt) { return pt ? [isWorld ? byId[pt.from_zone_id] : byId[pt.from_location_id], isWorld ? byId[pt.to_zone_id] : byId[pt.to_location_id]] : [null, null]; };
    var o = [];
    o.push('<svg width="' + SW + '" height="' + H + '" viewBox="0 0 ' + SW + ' ' + H + '" role="img" aria-label="Mapa de ' + escapeHtml(isWorld ? m.region.name : m.zone.name) + '">');
    // Caminos.
    view.edges.forEach(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b) return;
      var seg = 'x1="' + r1(X(a.x)) + '" y1="' + r1(Y(a.y)) + '" x2="' + r1(X(b.x)) + '" y2="' + r1(Y(b.y)) + '"';
      o.push('<g class="edge" data-edge="' + escapeHtml(e.id) + '"><line class="road-hit" ' + seg + '/><line class="road' + (e.blocked ? ' blocked' : '') + '" ' + seg + '/>' +
        '<text class="dist" x="' + r1((X(a.x) + X(b.x)) / 2) + '" y="' + r1((Y(a.y) + Y(b.y)) / 2 - 4) + '">' + escapeHtml(fmtM(e.distance_m) + (e.blocked ? ' · bloqueado' : '')) + '</text></g>');
    });
    // Ruta del actor entre dos lugares.
    var tr = ends(m.actor.transit);
    if (tr[0] && tr[1] && tr[0] !== tr[1]) o.push('<line class="route" x1="' + r1(X(tr[0].x)) + '" y1="' + r1(Y(tr[0].y)) + '" x2="' + r1(X(tr[1].x)) + '" y2="' + r1(Y(tr[1].y)) + '"/>');
    // Fichas por nodo (quien va de camino entre dos lugares va aparte, sobre el camino).
    var tokens = {}, onRoad = [];
    m.presences.forEach(function (p) {
      var pe = ends(p.transit);
      if (pe[0] && pe[1] && pe[0] !== pe[1]) { onRoad.push({ p: p, a: pe[0], b: pe[1] }); return; }
      var n = at(p);
      if (n) (tokens[n.id] = tokens[n.id] || []).push(p);
    });
    // Lugares.
    view.nodes.forEach(function (n) {
      var px = X(n.x), py = Y(n.y), r = n.outside ? nodeR * 0.75 : nodeR;
      var ts = tokens[n.id] || [];
      var cls = 'place' + (n.here ? ' here' : '') + (n.known === 'heard_of' ? ' heard' : '') + (n.outside ? ' outside' : '') + (isWorld ? ' zone' : '');
      o.push('<g class="' + cls + '" data-node="' + escapeHtml(n.id) + '">');
      o.push('<circle class="disc" cx="' + r1(px) + '" cy="' + r1(py) + '" r="' + r1(r) + '" fill="' + (KIND[n.kind] || KIND.place).fill + '"/>');
      o.push(glyph(n.kind, px, py, r));
      o.push('<text class="name" x="' + r1(px) + '" y="' + r1(py + r + (ts.length ? tokR * 2.2 : 0) + 12) + '">' + escapeHtml(n.name) + '</text>');
      o.push('</g>');
      ts.forEach(function (t, i) {
        var a = Math.PI * 0.5 + (2 * Math.PI * i) / ts.length, d = r + tokR * 0.9;
        o.push(mapToken(t, px + Math.cos(a) * d, py + Math.sin(a) * d, tokR));
      });
    });
    onRoad.forEach(function (x) {
      var pr = x.p.transit.progress;
      o.push(mapToken(x.p, X(x.a.x) + (X(x.b.x) - X(x.a.x)) * pr, Y(x.a.y) + (Y(x.b.y) - Y(x.a.y)) * pr, tokR));
    });
    o.push('</svg>');

    var title = isWorld ? m.region.name : m.zone.name;
    var sub = isWorld ? 'región' : (ZONE_KIND[m.zone.kind] || m.zone.kind);
    var where = '<div class="where"><b>' + escapeHtml(title) + '</b><span class="sub">· ' + escapeHtml(sub) + '</span><span class="btns">' +
      '<button type="button" data-view="zone"' + (isWorld ? '' : ' class="on"') + '>Zona</button><button type="button" data-view="world"' + (isWorld ? ' class="on"' : '') + '>Región</button>' +
      '<button type="button" data-map-big title="' + (big ? 'Volver al panel (Esc)' : 'Ver el mapa en grande') + '">' + (big ? 'Cerrar' : 'Ampliar') + '</button></span></div>';
    var legend = '<div class="legend"><span><i style="border-color:' + RING_MAP.self + '"></i>tú</span><span><i style="border-color:' + RING_MAP.ally + '"></i>aliado o neutral</span>' +
      '<span><i style="border-color:' + RING_MAP.hostile + '"></i>hostil</span><span><i class="heard"></i>de oídas</span>' + (isWorld ? '' : '<span>clic: ir allí</span>') + '</div>';
    mapEl.innerHTML = where + o.join('') + legend + '<div class="tip"></div>';
    // Ningún rótulo fuera del dibujo.
    mapEl.querySelectorAll('svg .name, svg .dist').forEach(function (t) {
      var bb = t.getBBox();
      if (!bb.width) return;
      var sx = bb.x < 2 ? 2 - bb.x : bb.x + bb.width > SW - 2 ? SW - 2 - bb.x - bb.width : 0;
      var sy = bb.y < 2 ? 2 - bb.y : bb.y + bb.height > H - 2 ? H - 2 - bb.y - bb.height : 0;
      if (sx) t.setAttribute('x', r1(Number(t.getAttribute('x')) + sx));
      if (sy) t.setAttribute('y', r1(Number(t.getAttribute('y')) + sy));
    });
  }

  function mapNodeById(id) { var v = mapView === 'world' ? mapData.world : mapData.zone; return v.nodes.filter(function (n) { return n.id === id; })[0]; }
  function mapTipFor(target) {
    var m = mapData, ne = target.closest('[data-node]'), ee = target.closest('[data-edge]');
    if (ne) {
      var n = mapNodeById(ne.getAttribute('data-node'));
      if (!n) return '';
      var isWorld = mapView === 'world';
      var state = n.here ? 'estás aquí' : n.known === 'visited' ? 'visitado' : 'de oídas';
      var h = '<b>' + escapeHtml(n.name) + '</b> <span class="hint">· ' + state + '</span>';
      var kind = isWorld ? '' : (KIND[n.kind] || KIND.place).name;
      if (n.outside && n.zone_id) { var z = m.world.nodes.filter(function (w) { return w.id === n.zone_id; })[0]; kind += (kind ? ', ' : '') + 'en ' + (z ? z.name : 'otra zona'); }
      if (kind) h += '<div class="hint">' + escapeHtml(kind) + '</div>';
      var who = m.presences.filter(function (p) { return p.relation !== 'self' && (isWorld ? p.zone_id === n.id : p.location_id === n.id) && !p.transit; });
      if (who.length) h += '<div>' + (n.here ? 'Ves' : 'Allí') + ': ' + escapeHtml(who.map(function (p) { return p.label + (p.relation === 'hostile' ? ' (hostil)' : ''); }).join(', ')) + '</div>';
      if (!n.here && !isWorld) h += '<div class="hint">Clic: ir allí</div>';
      return h;
    }
    if (ee) {
      var v = mapView === 'world' ? m.world : m.zone;
      var e = v.edges.filter(function (x) { return x.id === ee.getAttribute('data-edge'); })[0];
      if (!e) return '';
      var a = mapNodeById(e.from), b = mapNodeById(e.to);
      return '<b>Camino</b><div>' + escapeHtml((a ? a.name : '') + ' — ' + (b ? b.name : '') + ', ' + fmtM(e.distance_m)) + (e.blocked ? '. Bloqueado.' : '.') + '</div>';
    }
    return '';
  }
  function toggleMapBig(on) {
    document.body.classList.toggle('map-big', on);
    if (mapData) renderMap(mapData);
  }
  mapEl.addEventListener('mousemove', function (ev) {
    var tip = mapEl.querySelector('.tip');
    if (!tip || !mapData) return;
    var html = mapTipFor(ev.target);
    if (!html) { tip.style.display = 'none'; return; }
    if (tip.innerHTML !== html) tip.innerHTML = html;
    tip.style.display = 'block';
    var r = mapEl.getBoundingClientRect();
    var x = ev.clientX - r.left + mapEl.scrollLeft + 14, y = ev.clientY - r.top + mapEl.scrollTop + 16;
    if (x + tip.offsetWidth > mapEl.scrollWidth) x = Math.max(0, x - tip.offsetWidth - 28);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  mapEl.addEventListener('mouseleave', function () { var tip = mapEl.querySelector('.tip'); if (tip) tip.style.display = 'none'; });
  mapEl.addEventListener('click', function (ev) {
    var vb = ev.target.closest('[data-view]');
    if (vb) { mapView = vb.getAttribute('data-view'); store('tavernus.mapview', mapView); if (mapData) renderMap(mapData); return; }
    if (ev.target.closest('[data-map-big]')) { toggleMapBig(!document.body.classList.contains('map-big')); return; }
    if (busy || !mapData || mapView === 'world') return;
    var ne = ev.target.closest('[data-node]');
    if (!ne) return;
    var n = mapNodeById(ne.getAttribute('data-node'));
    if (n && !n.here) act('Ir a ' + n.name);
  });

  function spotById(id) { return boardData && boardData.spots.filter(function (s) { return s.id === id; })[0]; }
  function exitById(id) { return boardData && boardData.exits.filter(function (e) { return e.id === id; })[0]; }
  function isHere(sp) { return !boardData.actor.transit && sp.id === boardData.actor.spot_id; }

  function tipFor(target) {
    var b = boardData;
    var pe = target.closest('[data-prop]'), se = target.closest('[data-spot]'), ee = target.closest('[data-exit]');
    var prop = pe ? b.map.props[Number(pe.getAttribute('data-prop'))] : null;
    if (prop && !se) return '<b>' + escapeHtml(propName(prop)) + '</b>';
    if (se) {
      var sp = spotById(se.getAttribute('data-spot'));
      if (!sp) return '';
      var here = isHere(sp);
      var ps = b.presences.filter(function (p) { return p.spot_id === sp.id && !p.moving; });
      var h = '<b>' + escapeHtml(sp.name) + '</b> <span class="hint">· ' + (here ? 'estás aquí' : fmtM(Math.hypot(sp.x - b.actor.x, sp.y - b.actor.y))) + '</span>';
      if (prop) h = '<b>' + escapeHtml(propName(prop)) + '</b> <span class="hint">· ' + escapeHtml(sp.name) + (here ? ', estás aquí' : ', ' + fmtM(Math.hypot(sp.x - b.actor.x, sp.y - b.actor.y))) + '</span>';
      h += '<div>' + escapeHtml(sp.description) + '</div>';
      if (sp.items.length) h += '<div>Objetos: ' + escapeHtml(sp.items.join(', ')) + '</div>';
      if (sp.nodes.length) h += '<div>Recursos: ' + escapeHtml(sp.nodes.join(', ')) + '</div>';
      if (ps.length) h += '<div>Ves: ' + escapeHtml(ps.map(function (p) { return p.label; }).join(', ')) + '</div>';
      if (!here) h += '<div class="hint">Clic: ir allí</div>';
      return h;
    }
    if (ee) {
      var e = exitById(ee.getAttribute('data-exit'));
      if (!e) return '';
      var from = spotById(e.from_spot_id);
      var h2 = '<b>Salida a ' + escapeHtml(e.to_location_name) + '</b>';
      h2 += '<div>Desde ' + escapeHtml(from ? from.name : '') + ' hasta ' + escapeHtml(e.to_spot_name) + ', ' + fmtM(e.distance_m) + '.</div>';
      h2 += e.blocked ? '<div>Bloqueada: ' + escapeHtml(e.blocked_by || '') + '.</div>' : '<div class="hint">Clic: salir hacia allí</div>';
      return h2;
    }
    return '';
  }

  function toggleBig(on) {
    document.body.classList.toggle('board-big', on);
    if (boardData) renderBoard(boardData);
  }

  board.addEventListener('mousemove', function (ev) {
    var tip = board.querySelector('.tip');
    if (!tip || !boardData) return;
    var html = tipFor(ev.target);
    if (!html) { tip.style.display = 'none'; return; }
    if (tip.innerHTML !== html) tip.innerHTML = html;
    tip.style.display = 'block';
    var r = board.getBoundingClientRect();
    var x = ev.clientX - r.left + board.scrollLeft + 14, y = ev.clientY - r.top + board.scrollTop + 16;
    if (x + tip.offsetWidth > board.scrollWidth) x = Math.max(0, x - tip.offsetWidth - 28);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  board.addEventListener('mouseleave', function () { var tip = board.querySelector('.tip'); if (tip) tip.style.display = 'none'; });
  board.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-toggle-big]')) { toggleBig(!document.body.classList.contains('board-big')); return; }
    if (busy || !boardData) return;
    var se = ev.target.closest('[data-spot]'), ee = ev.target.closest('[data-exit]');
    if (se) {
      var sp = spotById(se.getAttribute('data-spot'));
      if (sp && !isHere(sp)) act('Ir a ' + sp.name);
    } else if (ee) {
      var e = exitById(ee.getAttribute('data-exit'));
      if (e && !e.blocked) act('Salir hacia ' + e.to_location_name);
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (document.body.classList.contains('board-big')) toggleBig(false);
    if (document.body.classList.contains('map-big')) toggleMapBig(false);
  });
  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (boardData) renderBoard(boardData); if (mapData) renderMap(mapData); }, 150); });

  function connect(id) {
    current = id;
    store('tavernus.character.' + game, id);
    if (stream) stream.close();
    log.innerHTML = '';
    board.innerHTML = ''; boardData = null; clearTimeout(boardTimer); document.body.classList.remove('board-big');
    mapEl.innerHTML = ''; mapData = null; document.body.classList.remove('map-big');
    showScene(null);
    stream = new EventSource(api('/api/stream?character=' + encodeURIComponent(id)));
    stream.addEventListener('history', function (e) {
      log.innerHTML = '';
      var h = JSON.parse(e.data);
      h.forEach(function (m, i) { renderMessage(m, i === h.length - 1); });
      if (!h.length) command('look');
    });
    stream.addEventListener('message', function (e) { renderMessage(JSON.parse(e.data), true); loadBoard(); loadScene(); });
    stream.addEventListener('sheet', loadSheet);
    stream.addEventListener('scene', function (e) { showScene(JSON.parse(e.data)); });
    loadSheet();
    loadScene();
    input.focus();
  }

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    if (text.charAt(0) === '/') { add('player', text); command(text.split(/\s+/)[0]); }
    else if (text === 'tirar' || text === 'roll') { add('player', text); spendButtons(); roll(); }
    else act(text);
  });
  document.querySelectorAll('.chips button').forEach(function (b) {
    b.addEventListener('click', function () { command(b.dataset.cmd); });
  });
  select.addEventListener('change', function () { connect(select.value); });
  $('toggle-sheet').addEventListener('click', function () { document.body.classList.toggle('show-sheet'); if (boardData) renderBoard(boardData); if (mapData) renderMap(mapData); });

  fetch(api('/api/characters')).then(function (r) { return r.json(); }).then(function (list) {
    list.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      select.appendChild(o);
    });
    var saved = params.get('character') || store('tavernus.character.' + game);
    var start = list.some(function (c) { return c.id === saved; }) ? saved : (list[0] && list[0].id);
    if (start) { select.value = start; connect(start); }
  });
})();
</script>
</body>
</html>
`;
