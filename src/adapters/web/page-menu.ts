/** Menú de partidas de la web: crear, continuar, demos y grabaciones. Un solo string, como page.ts. */

export const MENU = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavernus</title>
<style>
  /* Vidrio espacial (Figma, P0B): héroe a sangre con la taberna, controles de vidrio y tarjetas sin trazos. */
  :root {
    --bg: #07080b; --text: #f5f5f7; --muted: rgba(235,235,245,.62); --faint: rgba(235,235,245,.36);
    --accent: #e9a94e; --accent-ink: #1a1205; --accent-tint: rgba(233,169,78,.16);
    --platter: rgba(255,255,255,.045); --control: rgba(255,255,255,.08); --hover: rgba(255,255,255,.12);
    --error: #ff453b; --ok: #30d159; --info: #63d1ff; --rec: #e05a4a;
    --window: linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.035));
    --window-shadow: 0 48px 120px rgba(0,0,0,.42), 0 10px 30px rgba(0,0,0,.14), inset 0 1.5px 2px rgba(255,255,255,.10), inset 0 0 32px rgba(255,255,255,.025);
    --control-shadow: 0 14px 36px rgba(0,0,0,.26), 0 2px 8px rgba(0,0,0,.10), inset 0 1px 1.5px rgba(255,255,255,.12);
    --sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--bg); color: var(--text); font: 15px/1.47 var(--sans); letter-spacing: -.01em; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  input, select, button { font: inherit; color: inherit; letter-spacing: inherit; }
  button { cursor: pointer; border: 0; }
  button:disabled { opacity: .5; cursor: default; }
  svg.i { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .glass { background: var(--control); box-shadow: var(--control-shadow); -webkit-backdrop-filter: blur(14px) saturate(1.5); backdrop-filter: blur(14px) saturate(1.5); }
  .window { background: var(--window); box-shadow: var(--window-shadow); -webkit-backdrop-filter: blur(48px) saturate(1.4); backdrop-filter: blur(48px) saturate(1.4); }
  /* La taberna al amanecer ocupa la pantalla; abajo se funde con el fondo. */
  .backdrop { position: fixed; inset: 0; z-index: -1; background: url(/assets/taberna.jpg) center 40% / cover no-repeat var(--bg); }
  .backdrop::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(7,8,11,.72), rgba(7,8,11,.15) 55%, transparent), linear-gradient(180deg, rgba(7,8,11,.35), transparent 30%, rgba(7,8,11,.55) 62%, var(--bg) 96%); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 999px; font-weight: 600; white-space: nowrap; }
  .btn.primary { background: var(--accent); color: var(--accent-ink); box-shadow: 0 8px 24px rgba(233,169,78,.3), inset 0 1px 1px rgba(255,255,255,.3); }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.06); }
  .btn.glass:hover:not(:disabled) { background: var(--hover); }
  .btn.sm { height: 36px; padding: 0 14px; font-size: 14px; }
  header { display: flex; align-items: center; gap: 10px; padding: 22px 40px; }
  header h1 { margin: 0; flex: 1; font: 600 20px/1 Georgia, 'Iowan Old Style', serif; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); }
  .pill { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--muted); }
  .pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .pill.off::before { background: var(--info); }
  .hero { max-width: 620px; padding: 44px 40px 0; min-height: calc(58vh - 88px); }
  .hero[hidden] { display: none; }
  .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
  .hero h2 { margin: 10px 0 14px; font-size: clamp(34px, 5vw, 52px); line-height: 1.12; font-weight: 700; letter-spacing: -.03em; text-shadow: 0 2px 24px rgba(0,0,0,.4); overflow-wrap: anywhere; }
  .hero .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
  .hero p { margin: 14px 0 22px; color: var(--muted); max-width: 480px; }
  .hero .cta { display: flex; flex-wrap: wrap; gap: 10px; }
  .badge { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; background: rgba(0,0,0,.35); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); color: var(--muted); font-size: 12px; font-weight: 500; white-space: nowrap; }
  .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .badge.live { color: var(--ok); } .badge.offline { color: var(--info); } .badge.record { color: var(--rec); } .badge.replay { color: var(--accent); }
  .avs { display: inline-flex; }
  .avs span { width: 26px; height: 26px; margin-left: -6px; display: grid; place-items: center; border-radius: 50%; background: #1b1c22; box-shadow: 0 0 0 2px var(--bg); color: var(--muted); font-size: 11px; font-weight: 600; }
  .avs span:first-child { margin-left: 0; }
  .avs span:nth-child(3n+1) { color: var(--info); } .avs span:nth-child(3n+2) { color: var(--ok); } .avs span:nth-child(3n) { color: var(--accent); }
  main { padding: 24px 40px 48px; }
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .seg { display: inline-flex; padding: 3px; border-radius: 999px; }
  .seg button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; white-space: nowrap; border-radius: 999px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 500; }
  .seg button:hover { color: var(--text); }
  .seg button.on { background: var(--hover); color: var(--text); box-shadow: inset 0 1px 1px rgba(255,255,255,.1); }
  .bar .hint { margin-left: auto; font-size: 12px; color: var(--faint); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
  .gcard { display: flex; flex-direction: column; padding: 8px; border-radius: 30px; min-width: 0; }
  .thumb { position: relative; height: 130px; border-radius: 22px; overflow: hidden; background: url(/assets/taberna.jpg) center 45% / 240% no-repeat #111; }
  .thumb::after { content: ''; position: absolute; inset: 0; background: var(--tint, rgba(7,8,11,.25)); mix-blend-mode: multiply; }
  .thumb.live { --tint: rgba(48,100,70,.55); background-position: 30% 40%; }
  .thumb.offline { --tint: rgba(40,80,120,.6); background-position: 70% 35%; }
  .thumb.record { --tint: rgba(120,40,30,.55); background-position: 50% 30%; }
  .thumb.replay { --tint: rgba(120,80,20,.4); background-position: 45% 45%; }
  .thumb .badge { position: absolute; top: 10px; left: 10px; z-index: 1; }
  .gcard .info { padding: 14px 10px 10px; }
  .gcard .name { font-size: 18px; font-weight: 600; letter-spacing: -.02em; overflow-wrap: anywhere; }
  .gcard .meta { margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--muted); }
  .gcard .foot { position: relative; display: flex; align-items: center; gap: 8px; margin-top: auto; padding: 4px 6px 6px 10px; }
  .gcard .foot .avs { flex: 1; }
  .more { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: var(--control); }
  .more:hover { background: var(--hover); }
  .menu-pop { position: absolute; right: 8px; bottom: 48px; z-index: 5; display: flex; flex-direction: column; min-width: 200px; padding: 6px; border-radius: 18px; background: rgba(30,31,37,.94); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); box-shadow: var(--control-shadow); }
  .menu-pop[hidden] { display: none; }
  .menu-pop button { text-align: left; height: 36px; padding: 0 12px; border-radius: 12px; background: transparent; font-size: 14px; }
  .menu-pop button:hover:not(:disabled) { background: var(--hover); }
  .menu-pop button.danger { color: #ff8a80; }
  .menu-pop button.danger.armed { background: rgba(255,69,59,.16); }
  .gcard.new { align-items: center; justify-content: center; min-height: 262px; gap: 6px; background: transparent; box-shadow: none; outline: 1.5px dashed rgba(255,255,255,.14); outline-offset: -1.5px; color: var(--text); text-align: center; }
  .gcard.new:hover { background: var(--platter); }
  .gcard.new .plus { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 6px; border-radius: 50%; background: var(--control); }
  .gcard.new small { color: var(--muted); font-size: 12px; }
  .empty { grid-column: 1 / -1; margin: 8px 2px; color: var(--muted); font-size: 14px; }
  .error { color: #ff8a80; font-size: 14px; }
  /* Nueva partida: hoja de vidrio sobre el menú atenuado. */
  #sheet { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 24px; background: rgba(5,5,13,.55); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
  #sheet[hidden] { display: none; }
  #new { position: relative; width: min(560px, 100%); max-height: calc(100vh - 48px); overflow-y: auto; padding: 26px 26px 22px; border-radius: 34px; background: linear-gradient(180deg, #1c1d23, #131418); box-shadow: var(--window-shadow); }
  #new h2 { margin: 0 0 4px; font-size: 22px; font-weight: 700; letter-spacing: -.02em; }
  #new .lead { margin: 0 0 14px; color: var(--muted); font-size: 14px; }
  #new .x { position: absolute; top: 18px; right: 18px; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: var(--control); }
  label { display: block; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--faint); margin: 14px 0 6px; }
  input[type=text], input[type=number], select { width: 100%; height: 42px; padding: 0 14px; border: 0; border-radius: 14px; background: var(--control); outline: none; }
  select option { background: #1c1d23; }
  input::placeholder { color: var(--faint); }
  input:focus, select:focus { box-shadow: 0 0 0 1.5px rgba(233,169,78,.6); }
  .row { display: flex; gap: 8px; } .row > * { flex: 1; min-width: 0; }
  .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .modes label { margin: 0; cursor: pointer; padding: 10px 12px; border-radius: 16px; background: var(--platter); color: var(--text); font-size: 14px; font-weight: 600; letter-spacing: 0; text-transform: none; }
  .modes label small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; line-height: 1.35; margin-top: 3px; }
  .modes.two { grid-template-columns: repeat(2, 1fr); }
  .modes input { margin: 0 6px 0 0; accent-color: var(--accent); }
  #world-opts[hidden], #hook-row[hidden] { display: none; }
  .gen-note { margin-top: 10px; }
  .modes label:has(input:checked) { background: var(--accent-tint); box-shadow: inset 0 0 0 1.5px rgba(233,169,78,.55); }
  details { margin-top: 12px; color: var(--muted); font-size: 14px; }
  summary { cursor: pointer; }
  .submit { margin-top: 20px; display: flex; align-items: center; gap: 12px; }
  .note { font-size: 13px; color: var(--muted); letter-spacing: 0; text-transform: none; font-weight: 400; }
  .warn { color: #ffb38a; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30; padding: 10px 16px; border-radius: 999px; background: rgba(30,31,37,.94); box-shadow: var(--control-shadow); color: #ff8a80; font-size: 14px; }
  #toast[hidden] { display: none; }
  @media (max-width: 760px) {
    header { padding: 14px 16px; }
    header h1 { font-size: 16px; }
    header .pill { display: none; }
    .hero { padding: 24px 16px 0; min-height: 0; }
    main { padding: 24px 16px 40px; }
    .bar { flex-wrap: wrap; } .bar .hint { display: none; }
    .seg { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
    .seg button { padding: 0 11px; }
    .seg button svg { display: none; }
    .modes { grid-template-columns: 1fr; }
    .row { flex-wrap: wrap; } .row > input { flex-basis: 100%; }
    #new { padding: 22px 18px 18px; border-radius: 28px; }
  }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></symbol>
  <symbol id="i-more" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></symbol>
  <symbol id="i-rec" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></symbol>
</svg>
<div class="backdrop" aria-hidden="true"></div>
<header>
  <h1>Tavernus</h1>
  <span id="status" class="pill glass" hidden></span>
  <button id="open-new" class="btn primary" type="button"><svg class="i"><use href="#i-plus"/></svg>Nueva partida</button>
</header>
<section class="hero" id="hero" hidden>
  <div class="eyebrow">Continúa tu historia</div>
  <h2 id="hero-name"></h2>
  <div class="meta" id="hero-meta"></div>
  <p id="hero-text"></p>
  <div class="cta"><button id="hero-open" class="btn primary" type="button"><svg class="i"><use href="#i-play"/></svg>Continuar partida</button></div>
</section>
<main>
  <div class="bar">
    <div class="seg glass" role="tablist">
      <button type="button" data-list="continue" class="on"><svg class="i"><use href="#i-book"/></svg>Partidas · <span id="n-continue">0</span></button>
      <button type="button" data-list="demos"><svg class="i"><use href="#i-play"/></svg>Demos · <span id="n-demos">0</span></button>
      <button type="button" data-list="recordings"><svg class="i"><use href="#i-rec"/></svg>Grabaciones · <span id="n-recordings">0</span></button>
    </div>
    <span class="hint" id="list-hint">La última jugada primero</span>
  </div>
  <div class="grid" id="list"></div>
</main>
<div id="sheet" hidden>
  <section id="new" role="dialog" aria-modal="true" aria-labelledby="new-title">
    <button class="x" type="button" id="close-new" aria-label="Cerrar"><svg class="i"><use href="#i-x"/></svg></button>
    <h2 id="new-title">Nueva partida</h2>
    <p class="lead" id="new-lead">Empieza en la taberna de la semilla, con los personajes de siempre y, si quieres, uno tuyo.</p>
    <form id="new-form" autocomplete="off">
      <label for="g-name">Nombre de la partida</label>
      <input id="g-name" type="text" maxlength="60" placeholder="La noche del Brezal" required>
      <label>Mundo</label>
      <div class="modes two">
        <label><input type="radio" name="world" value="demo" checked>Brezal (demo)<small>Campaña escrita: la aldea de siempre, con su historia en tres actos y tu personaje con un porqué.</small></label>
        <label><input type="radio" name="world" value="generated">Mundo nuevo (generado)<small>Otro lugar, otra historia, y tu personaje con un porqué.</small></label>
      </div>
      <div id="world-opts" hidden>
        <div class="row">
          <div><label for="g-tone">Tono</label><select id="g-tone"></select></div>
          <div><label for="g-wseed">Semilla del mundo <span class="note">(vacía: al azar)</span></label><input id="g-wseed" type="number" min="0" max="4294967295" step="1" placeholder="al azar"></div>
        </div>
        <label for="g-setting">Ambientación <span class="note">(opcional)</span></label>
        <input id="g-setting" type="text" maxlength="300" placeholder="Fantasía oscura, ciencia ficción, postapocalíptico…">
        <p id="world-test" class="note warn" hidden>En offline es un mundo de prueba: la estructura cambia con la semilla, pero nombres y textos son de plantilla. Para un mundo escrito por Claude, elige «Real».</p>
      </div>
      <label>Máster</label>
      <div class="modes">
        <label><input type="radio" name="mode" value="live" checked>Real<small>Claude narra en cada acción (gasta tokens).</small></label>
        <label><input type="radio" name="mode" value="offline">Offline<small>Sin API: narración plana y gratis.</small></label>
        <label><input type="radio" name="mode" value="record">Grabar demo<small>Real, y guarda cada respuesta para repetirla.</small></label>
      </div>
      <p id="key-warn" class="note warn" hidden>No hay ANTHROPIC_API_KEY: en real o grabando, el máster narrará en plano.</p>
      <label for="g-char">Tu personaje <span class="note">(opcional)</span></label>
      <div class="row">
        <input id="g-char" type="text" maxlength="24" placeholder="Nombre">
        <select id="g-race" aria-label="Raza"></select>
        <select id="g-class" aria-label="Clase"></select>
      </div>
      <div id="hook-row" hidden>
        <label for="g-hook">¿Qué le trae aquí? <span class="note">(opcional: si lo dejas vacío, el mundo se lo inventa)</span></label>
        <input id="g-hook" type="text" maxlength="400" placeholder="Busca a su hermano, que vino a este pueblo y no volvió">
      </div>
      <label for="g-look">Cómo se ve <span class="note">(opcional: de ahí sale su retrato; luego puedes pedir otro)</span></label>
      <input id="g-look" type="text" maxlength="300" placeholder="Pelo cobrizo trenzado, cicatriz en la ceja, capa de lana verde">
      <details>
        <summary>Más opciones</summary>
        <label for="g-seed">Semilla de dados <span class="note">(vacía: al azar; al grabar se elige una sola)</span></label>
        <input id="g-seed" type="number" min="0" max="4294967295" step="1" placeholder="p. ej. 1234">
      </details>
      <div class="submit">
        <button class="btn primary" type="submit">Crear y jugar</button>
        <span id="new-error" class="error" role="alert"></span>
      </div>
      <p id="gen-note" class="note gen-note" hidden></p>
    </form>
  </section>
</div>
<div id="toast" role="alert" hidden></div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MODE = { live: 'real', offline: 'offline', record: 'grabando', replay: 'demo' };
  var apiKey = true, modeTouched = false, lists = { continue: [], demos: [], recordings: [] }, tab = 'continue';

  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; }
  }
  /** «hace 4 min», «ayer»… y, si es de hace más de una semana, la fecha. */
  function ago(iso) {
    var t = Date.parse(iso);
    if (!t) return fmt(iso);
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'ahora mismo';
    if (m < 60) return 'hace ' + m + ' min';
    var h = Math.round(m / 60);
    if (h < 24) return 'hace ' + h + ' h';
    var d = Math.round(h / 24);
    return d === 1 ? 'ayer' : d < 7 ? 'hace ' + d + ' días' : fmt(iso);
  }
  function open(slug, character) {
    location.href = '/?game=' + encodeURIComponent(slug) + (character ? '&character=' + encodeURIComponent(character) : '');
  }
  function call(method, path) {
    return fetch(path, { method: method }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, text: 'No hay conexión con el servidor.' }; });
  }
  var toastTimer = null;
  function toast(text) { var t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 5000); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(id) { return '<svg class="i"><use href="#' + id + '"/></svg>'; }
  function button(text, cls, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); onClick(b); });
    return b;
  }
  function avatars(names) {
    var w = el('span', 'avs');
    names.slice(0, 5).forEach(function (n) { var a = el('span', '', n.charAt(0).toUpperCase()); a.title = n; w.appendChild(a); });
    return w;
  }
  function badge(g) { return el('span', 'badge ' + g.mode, (MODE[g.mode] || g.mode) + (g.main ? ' · principal' : '')); }
  function when(g) { return g.last_opened_at ? 'Jugada ' + ago(g.last_opened_at) : 'Creada ' + ago(g.created_at) + ' · sin jugar'; }

  /** Borrar pide un segundo clic en 4 s, sin diálogos del navegador. */
  function deleteButton(g) {
    var timer = null;
    return button('Borrar', 'danger', function (b) {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = '¿Seguro? Pulsa otra vez';
        timer = setTimeout(function () { b.classList.remove('armed'); b.textContent = 'Borrar'; }, 4000);
        return;
      }
      clearTimeout(timer); b.disabled = true;
      call('DELETE', '/api/games?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) toast(r.text); load(); });
    });
  }
  /** Acciones de cada lista: la principal es «Abrir»; el resto va en el menú «…». */
  function extras(g) {
    if (tab === 'demos') return [
      button('Jugar desde el principio', '', function (b) {
        b.disabled = true;
        call('POST', '/api/games/reset?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) { toast(r.text); load(); } else open(g.slug); });
      }),
      deleteButton(g),
    ];
    if (tab === 'recordings') return [
      button('Convertir en demo', '', function (b) {
        b.disabled = true;
        call('POST', '/api/games/demo?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) toast(r.text); load(); });
      }),
      deleteButton(g),
    ];
    return [deleteButton(g)];
  }

  function card(g) {
    var c = el('article', 'gcard window');
    var th = el('div', 'thumb ' + g.mode); th.appendChild(badge(g)); c.appendChild(th);
    // Cada partida enseña otro rincón del paisaje, siempre el mismo para la misma partida.
    var h = 0; for (var i = 0; i < g.slug.length; i++) h = (h * 31 + g.slug.charCodeAt(i)) >>> 0;
    th.style.backgroundPosition = (h % 101) + '% ' + (25 + (h >> 8) % 40) + '%';
    var info = el('div', 'info');
    info.appendChild(el('div', 'name', g.name));
    var meta = [when(g)];
    if (g.mode === 'record' || g.mode === 'replay') meta.push(g.cache_entries + ' respuestas grabadas');
    if (g.world) meta.push((g.world.template ? 'mundo de plantilla' : 'mundo generado') + ' · semilla ' + g.world.seed);
    var m = el('div', 'meta', meta.join(' · ')); m.title = m.textContent;
    info.appendChild(m);
    c.appendChild(info);
    var foot = el('div', 'foot');
    foot.appendChild(avatars(g.characters));
    var pop = el('div', 'menu-pop'); pop.hidden = true;
    extras(g).forEach(function (b) { pop.appendChild(b); });
    var more = el('button', 'more'); more.type = 'button'; more.title = 'Más acciones'; more.setAttribute('aria-label', 'Más acciones'); more.innerHTML = icon('i-more');
    more.addEventListener('click', function (ev) { ev.stopPropagation(); var was = pop.hidden; closeMenus(); pop.hidden = !was; });
    var openB = el('button', 'btn sm glass'); openB.type = 'button'; openB.innerHTML = icon('i-play') + 'Abrir';
    openB.addEventListener('click', function () { open(g.slug); });
    foot.appendChild(more); foot.appendChild(openB); foot.appendChild(pop);
    c.appendChild(foot);
    return c;
  }
  function closeMenus() { document.querySelectorAll('.menu-pop').forEach(function (p) { p.hidden = true; }); }
  document.addEventListener('click', closeMenus);

  var EMPTY = {
    continue: 'Aún no hay partidas.',
    demos: 'La carpeta de demos está vacía. Graba una partida y conviértela en demo.',
    recordings: 'No hay grabaciones. Crea una partida en modo «Grabar demo».',
  };
  function render() {
    var grid = $('list'), games = lists[tab];
    grid.innerHTML = '';
    document.querySelectorAll('.seg [data-list]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-list') === tab); });
    if (!games.length && tab !== 'continue') grid.appendChild(el('p', 'empty', EMPTY[tab]));
    games.forEach(function (g) { grid.appendChild(card(g)); });
    if (tab === 'continue') {
      var n = el('button', 'gcard new');
      n.type = 'button';
      n.innerHTML = '<span class="plus">' + icon('i-plus') + '</span><b>Nueva partida</b><small>Real, offline o grabando una demo</small>';
      n.addEventListener('click', openNew);
      grid.appendChild(n);
    }
  }
  document.querySelectorAll('.seg [data-list]').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-list'); render(); }); });

  /** El héroe: la última partida jugada (no demo ni grabación), para seguir con un clic. */
  function hero(g) {
    $('hero').hidden = !g;
    if (!g) return;
    $('hero-name').textContent = g.name;
    var meta = $('hero-meta');
    meta.innerHTML = '';
    meta.appendChild(badge(g));
    if (g.characters.length) meta.appendChild(avatars(g.characters));
    meta.appendChild(el('span', '', [g.characters.join(', '), when(g).toLowerCase()].filter(Boolean).join(' · ')));
    $('hero-text').textContent = g.characters.length ? 'Tu grupo te espera en la taberna, donde lo dejasteis.' : 'La partida está lista: entra y crea tu personaje.';
    $('hero-open').onclick = function () { open(g.slug); };
  }

  function load() {
    return fetch('/api/games').then(function (r) { return r.json(); }).then(function (d) {
      apiKey = d.api_key;
      var st = $('status');
      st.hidden = false;
      st.textContent = apiKey ? 'Máster con Claude disponible' : 'Sin clave de API: solo offline';
      st.classList.toggle('off', !apiKey);
      // Sin clave, lo sensato por defecto es offline (si el usuario no ha elegido otra cosa).
      if (!apiKey && !modeTouched) document.querySelector('input[name=mode][value=offline]').checked = true;
      keyWarn();
      if (!$('g-race').options.length) {
        d.options.races.forEach(function (r) { $('g-race').add(new Option(r.name, r.id)); });
        d.options.classes.forEach(function (c) { $('g-class').add(new Option(c.name, c.id)); });
        (d.options.tones || []).forEach(function (t) { $('g-tone').add(new Option(t.name, t.id)); });
      }
      var games = d.games;
      lists.continue = games.filter(function (g) { return !g.demo && g.mode !== 'record'; });
      lists.demos = games.filter(function (g) { return g.demo; });
      lists.recordings = games.filter(function (g) { return !g.demo && g.mode === 'record'; });
      $('n-continue').textContent = lists.continue.length;
      $('n-demos').textContent = lists.demos.length;
      $('n-recordings').textContent = lists.recordings.length;
      hero(lists.continue[0]);
      render();
    }).catch(function () { $('list').innerHTML = '<p class="error">No hay conexión con el servidor.</p>'; });
  }

  function mode() { var c = document.querySelector('input[name=mode]:checked'); return c ? c.value : 'live'; }
  function keyWarn() {
    $('key-warn').hidden = apiKey || mode() === 'offline';
    $('world-test').hidden = !(mode() === 'offline' || !apiKey);
  }
  document.querySelectorAll('input[name=mode]').forEach(function (r) { r.addEventListener('change', function () { modeTouched = true; keyWarn(); }); });

  /** Mundo: la semilla demo o uno generado (con tono, ambientación, semilla y el porqué del PJ). */
  function generated() { var c = document.querySelector('input[name=world]:checked'); return !!c && c.value === 'generated'; }
  function worldChanged() {
    var gen = generated();
    $('world-opts').hidden = !gen;
    $('hook-row').hidden = !gen;
    $('new-lead').textContent = gen
      ? 'Un mundo distinto cada vez: un puerto, una mina, un monasterio, una caravana… con su gente, sus secretos y una situación inicial para tu personaje.'
      : 'Empieza en la taberna de la semilla, con los personajes de siempre y, si quieres, uno tuyo.';
  }
  document.querySelectorAll('input[name=world]').forEach(function (r) { r.addEventListener('change', worldChanged); });

  function openNew() { $('sheet').hidden = false; $('g-name').focus(); }
  function closeNew() { $('sheet').hidden = true; }
  $('open-new').addEventListener('click', openNew);
  $('close-new').addEventListener('click', closeNew);
  $('sheet').addEventListener('click', function (ev) { if (ev.target === $('sheet')) closeNew(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeNew(); closeMenus(); } });

  $('new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var submit = e.target.querySelector('button[type=submit]');
    $('new-error').textContent = '';
    submit.disabled = true;
    var gen = generated();
    var body = { name: $('g-name').value, mode: mode(), character: $('g-char').value, race: $('g-race').value, class: $('g-class').value, appearance: $('g-look').value, dice_seed: $('g-seed').value };
    if (gen) {
      body.world = { seed: $('g-wseed').value, tone: $('g-tone').value, setting: $('g-setting').value };
      body.hook = $('g-hook').value;
    }
    // Generar con Claude tarda: el botón lo dice y una nota explica cuánto.
    var label = submit.textContent, note = $('gen-note');
    if (gen) {
      submit.textContent = 'Generando mundo…';
      note.hidden = false;
      note.textContent = mode() === 'offline' ? 'Mundo de prueba, sin API: es un momento.' : 'Claude está escribiendo el lugar, su gente y tu situación inicial. Suele tardar uno o dos minutos.';
    }
    function done() { submit.disabled = false; submit.textContent = label; note.hidden = true; }
    fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) { $('new-error').textContent = r.text; done(); return; }
        // Pediste a Claude y salió de plantilla (sin clave de API): se dice antes de entrar.
        if (gen && mode() !== 'offline' && r.game.world && r.game.world.template) {
          note.hidden = false;
          note.textContent = 'Sin clave de API: el mundo ha salido en modo plantilla (nombres y textos de prueba). Entrando…';
          setTimeout(function () { open(r.game.slug, r.character_id); }, 3500);
          return;
        }
        open(r.game.slug, r.character_id);
      })
      .catch(function () { $('new-error').textContent = 'No hay conexión con el servidor.'; done(); });
  });

  load();
})();
</script>
</body>
</html>
`;
