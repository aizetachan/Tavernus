/** Menú de partidas de la web: crear, continuar, demos y grabaciones. Un solo string, como page.ts. */

export const MENU = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavernus</title>
<style>
  :root {
    --bg: #17130f; --panel: #211b15; --panel-2: #2a221a; --line: #3a2f24;
    --text: #ece3d4; --muted: #a8998a; --accent: #d9a35b; --accent-ink: #1b140c;
    --error: #e07a62; --ok: #9fb27a; --rec: #d0745a;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--bg); color: var(--text); font: 16px/1.55 Georgia, 'Iowan Old Style', serif; min-height: 100vh; }
  header { padding: 28px 16px 8px; text-align: center; }
  header h1 { margin: 0; font-weight: normal; font-size: 30px; letter-spacing: .08em; color: var(--accent); }
  header p { margin: 4px 0 0; color: var(--muted); font-style: italic; }
  main { max-width: 1060px; margin: 0 auto; padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; min-width: 0; }
  section h2 { margin: 0 0 4px; font-weight: normal; font-size: 19px; color: var(--accent); letter-spacing: .03em; }
  section .lead { margin: 0 0 12px; color: var(--muted); font-size: 14px; }
  label { display: block; font-size: 14px; color: var(--muted); margin: 10px 0 4px; }
  input, select, button { font: inherit; color: inherit; }
  input[type=text], input[type=number], select { width: 100%; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; }
  input:focus, select:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
  .row { display: flex; gap: 10px; } .row > * { flex: 1; min-width: 0; }
  .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .modes label { margin: 0; cursor: pointer; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--panel-2); color: var(--text); font-size: 15px; }
  .modes label small { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.35; margin-top: 2px; }
  .modes input { margin: 0 6px 0 0; accent-color: var(--accent); }
  .modes label:has(input:checked) { border-color: var(--accent); }
  details { margin-top: 10px; color: var(--muted); font-size: 14px; }
  summary { cursor: pointer; }
  button { cursor: pointer; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 5px 12px; }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  button.primary:hover:not(:disabled) { color: var(--accent-ink); filter: brightness(1.08); }
  button.danger:hover:not(:disabled), button.danger.armed { border-color: var(--error); color: var(--error); }
  .submit { margin-top: 14px; display: flex; align-items: center; gap: 12px; }
  .note { font-size: 13.5px; color: var(--muted); }
  .warn { color: var(--rec); }
  .error { color: var(--error); font-size: 14px; }
  ul.games { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  ul.games li { border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; background: var(--panel-2); display: flex; gap: 10px; align-items: center; }
  ul.games .info { flex: 1; min-width: 0; }
  ul.games .name { font-size: 16px; overflow-wrap: anywhere; }
  ul.games .meta { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
  ul.games .actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .badge { display: inline-block; font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; margin-left: 6px; color: var(--muted); vertical-align: 2px; }
  .badge.live { color: var(--accent); border-color: #6b5233; }
  .badge.record { color: var(--rec); border-color: #6b3a2c; }
  .badge.replay { color: var(--ok); border-color: #4a5636; }
  .empty { color: var(--muted); font-style: italic; font-size: 14.5px; margin: 4px 0; }
  @media (max-width: 760px) {
    main { grid-template-columns: 1fr; }
    .modes { grid-template-columns: 1fr; }
    .row { flex-wrap: wrap; } .row > input { flex-basis: 100%; }
    ul.games li { flex-wrap: wrap; }
    ul.games .actions { width: 100%; justify-content: flex-start; }
  }
</style>
</head>
<body>
<header>
  <h1>Tavernus</h1>
  <p>Elige partida, o empieza una.</p>
</header>
<main>
  <section id="new">
    <h2>Nueva partida</h2>
    <p class="lead">Empieza en la taberna de la semilla, con los personajes de siempre y, si quieres, uno tuyo.</p>
    <form id="new-form" autocomplete="off">
      <label for="g-name">Nombre de la partida</label>
      <input id="g-name" type="text" maxlength="60" placeholder="La noche del Brezal" required>
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
      <details>
        <summary>Más opciones</summary>
        <label for="g-seed">Semilla de dados <span class="note">(vacía: al azar; al grabar se elige una sola)</span></label>
        <input id="g-seed" type="number" min="0" max="4294967295" step="1" placeholder="p. ej. 1234">
      </details>
      <div class="submit">
        <button class="primary" type="submit">Crear y jugar</button>
        <span id="new-error" class="error" role="alert"></span>
      </div>
    </form>
  </section>

  <section id="continue">
    <h2>Continuar</h2>
    <p class="lead">Partidas guardadas, la última jugada primero.</p>
    <ul class="games" id="list-continue"></ul>
  </section>

  <section id="demos">
    <h2>Demos</h2>
    <p class="lead">Partidas grabadas que se repiten sin gastar tokens (lo que no esté grabado se narra en plano).</p>
    <ul class="games" id="list-demos"></ul>
  </section>

  <section id="recordings">
    <h2>Grabaciones</h2>
    <p class="lead">Partidas reales que van guardando las respuestas. Al terminar, conviértelas en demo.</p>
    <ul class="games" id="list-recordings"></ul>
  </section>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MODE = { live: 'real', offline: 'offline', record: 'grabando', replay: 'demo' };
  var apiKey = true, modeTouched = false;

  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; }
  }
  function open(slug, character) {
    location.href = '/?game=' + encodeURIComponent(slug) + (character ? '&character=' + encodeURIComponent(character) : '');
  }
  function call(method, path) {
    return fetch(path, { method: method }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, text: 'No hay conexión con el servidor.' }; });
  }
  function button(text, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener('click', function () { onClick(b); });
    return b;
  }
  /** Borrar pide un segundo clic en 4 s, sin diálogos del navegador. */
  function deleteButton(g) {
    var timer = null;
    return button('Borrar', 'danger', function (b) {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = '¿Seguro? Borrar';
        timer = setTimeout(function () { b.classList.remove('armed'); b.textContent = 'Borrar'; }, 4000);
        return;
      }
      clearTimeout(timer); b.disabled = true;
      call('DELETE', '/api/games?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) alert(r.text); load(); });
    });
  }

  function item(g, actions) {
    var li = document.createElement('li');
    var info = document.createElement('div'); info.className = 'info';
    var name = document.createElement('div'); name.className = 'name';
    name.textContent = g.name;
    var badge = document.createElement('span'); badge.className = 'badge ' + g.mode; badge.textContent = MODE[g.mode] || g.mode;
    name.appendChild(badge);
    if (g.main) { var m = document.createElement('span'); m.className = 'badge'; m.textContent = 'principal'; name.appendChild(m); }
    var meta = document.createElement('div'); meta.className = 'meta';
    var bits = [(g.last_opened_at ? 'jugada ' + fmt(g.last_opened_at) : 'creada ' + fmt(g.created_at))];
    if (g.characters.length) bits.push(g.characters.join(', '));
    if (g.mode === 'record' || g.mode === 'replay') bits.push(g.cache_entries + ' respuestas grabadas');
    meta.textContent = bits.join(' · ');
    meta.title = meta.textContent;
    info.appendChild(name); info.appendChild(meta);
    var act = document.createElement('div'); act.className = 'actions';
    actions.forEach(function (a) { act.appendChild(a); });
    li.appendChild(info); li.appendChild(act);
    return li;
  }

  function fill(ul, games, empty, actionsFor) {
    ul.innerHTML = '';
    if (!games.length) { var p = document.createElement('p'); p.className = 'empty'; p.textContent = empty; ul.appendChild(p); return; }
    games.forEach(function (g) { ul.appendChild(item(g, actionsFor(g))); });
  }

  function load() {
    return fetch('/api/games').then(function (r) { return r.json(); }).then(function (d) {
      apiKey = d.api_key;
      // Sin clave, lo sensato por defecto es offline (si el usuario no ha elegido otra cosa).
      if (!apiKey && !modeTouched) document.querySelector('input[name=mode][value=offline]').checked = true;
      keyWarn();
      if (!$('g-race').options.length) {
        d.options.races.forEach(function (r) { $('g-race').add(new Option(r.name, r.id)); });
        d.options.classes.forEach(function (c) { $('g-class').add(new Option(c.name, c.id)); });
      }
      var games = d.games;
      fill($('list-continue'), games.filter(function (g) { return !g.demo && g.mode !== 'record'; }), 'Aún no hay partidas. Crea una a la izquierda.', function (g) {
        return [button('Abrir', 'primary', function () { open(g.slug); }), deleteButton(g)];
      });
      fill($('list-demos'), games.filter(function (g) { return g.demo; }), 'La carpeta de demos está vacía. Graba una partida y conviértela en demo.', function (g) {
        return [
          button('Abrir', 'primary', function () { open(g.slug); }),
          button('Desde el principio', '', function (b) {
            b.disabled = true;
            call('POST', '/api/games/reset?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) { alert(r.text); load(); } else open(g.slug); });
          }),
          deleteButton(g),
        ];
      });
      fill($('list-recordings'), games.filter(function (g) { return !g.demo && g.mode === 'record'; }), 'No hay grabaciones. Crea una partida en modo «Grabar demo».', function (g) {
        return [
          button('Abrir', 'primary', function () { open(g.slug); }),
          button('Convertir en demo', '', function (b) {
            b.disabled = true;
            call('POST', '/api/games/demo?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) alert(r.text); load(); });
          }),
          deleteButton(g),
        ];
      });
    }).catch(function () { $('list-continue').innerHTML = '<p class="error">No hay conexión con el servidor.</p>'; });
  }

  function mode() { var c = document.querySelector('input[name=mode]:checked'); return c ? c.value : 'live'; }
  function keyWarn() { $('key-warn').hidden = apiKey || mode() === 'offline'; }
  document.querySelectorAll('input[name=mode]').forEach(function (r) { r.addEventListener('change', function () { modeTouched = true; keyWarn(); }); });

  $('new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var submit = e.target.querySelector('button[type=submit]');
    $('new-error').textContent = '';
    submit.disabled = true;
    var body = { name: $('g-name').value, mode: mode(), character: $('g-char').value, race: $('g-race').value, class: $('g-class').value, dice_seed: $('g-seed').value };
    fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r.ok) { $('new-error').textContent = r.text; submit.disabled = false; return; }
        open(r.game.slug, r.character_id);
      })
      .catch(function () { $('new-error').textContent = 'No hay conexión con el servidor.'; submit.disabled = false; });
  });

  load();
})();
</script>
</body>
</html>
`;
