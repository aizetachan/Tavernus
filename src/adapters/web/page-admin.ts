/**
 * Panel del administrador, una sola página cuya ruta decide la vista (rutas y API en server.ts, `handleAdmin`):
 *
 *   /admin/usuarios            todos los usuarios, crear una cuenta y lo último que se ha hecho
 *   /admin/usuarios/<id>       un usuario: sus partidas (con enlace a cada una) y su biblioteca de personajes
 *                              (ficha, renombrar, borrar); contraseña, administración, desactivar, borrar
 *   /admin/partidas            todas las partidas, con filtro por usuario (dueño o con asiento)
 *   /admin/partidas/<partida>  una partida: dueño (asignar), asientos con su usuario y su personaje, abrirla
 *
 * Es para vigilar y probar las partidas: desde aquí el administrador abre cualquiera y entra como jugador
 * administrador (docs/MULTIJUGADOR.md, «Administración»).
 */

import { HEAD } from './page-access.js';
import { PASSWORD_MIN } from '../../accounts/accounts.js';

const CSS = String.raw`
  .box.wide { max-width: 980px; }
  nav.top { display: flex; gap: 8px 18px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; font-size: 14px; }
  nav.top a[aria-current] { color: var(--text); font-weight: 600; text-decoration: none; }
  .back { display: inline-block; margin-bottom: 6px; font-size: 13px; }
  h1 .tag { vertical-align: middle; }
  h2 { font: 700 17px/1.3 var(--display); margin: 26px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-weight: 600; font-size: 12px; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
  td { padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr.u:hover td { background: var(--hover); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; margin-left: 6px; }
  .tag.admin { background: rgba(230,183,90,.16); color: var(--accent); }
  .tag.off { background: rgba(255,107,94,.14); color: var(--error); }
  .tag.host { background: rgba(255,255,255,.08); color: var(--muted); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
  .actions input, .row-form input { width: 200px; height: 32px; margin: 0; display: inline-block; }
  .row-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .tools { gap: 6px; }
  .ok { color: var(--ok); font-size: 13px; }
  .log li { font-size: 13px; color: var(--muted); }
  .log b { color: var(--text); font-weight: 500; }
  .info { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 14px; margin: 6px 0 0; }
  .info dt { color: var(--muted); } .info dd { margin: 0; }
  .dot { display: inline-block; vertical-align: middle; }
  dialog { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 16px; padding: 22px; max-width: 520px; width: calc(100% - 32px); }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  dialog h3 { font: 800 19px/1.2 var(--display); margin: 0 0 4px; }
  .sheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 14px 0; }
  .sheet div { background: var(--bubble); border-radius: 10px; padding: 8px 10px; font-size: 13px; }
  .sheet b { display: block; font-size: 16px; }
  .sheet small { color: var(--muted); }
  .ab { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
  .ab span { background: var(--bubble); border-radius: 8px; padding: 4px 8px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  @media (max-width: 720px) { .hide-sm { display: none; } table { font-size: 13px; } }`;

export function adminPage(): string {
  return HEAD('Administración — Tavernus', CSS) + String.raw`<div class="box wide">
  <nav class="top"><a href="/">← Partidas</a><a href="/admin/usuarios" data-nav="usuarios">Usuarios</a><a href="/admin/partidas" data-nav="partidas">Partidas</a><a href="/admin/estado">Estado del servidor</a></nav>
  <div id="view"><p class="muted">Cargando…</p></div>
</div>
<dialog id="sheet"></dialog>
<script>
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso) { if (!iso) return 'nunca'; try { return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function call(method, path, body) {
    return fetch(path, { method: method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, text: 'No hay conexión con el servidor.' }; });
  }
  function armed(b) {
    if (b.classList.contains('armed')) return true;
    b.classList.add('armed'); b.dataset.label = b.textContent; b.textContent = '¿Seguro?';
    setTimeout(function () { if (b.classList.contains('armed')) { b.classList.remove('armed'); b.textContent = b.dataset.label; } }, 4000);
    return false;
  }
  var MODE = { live: 'Claude', offline: 'Offline', record: 'Grabando', replay: 'Demo' };
  var view = $('view');
  function fail(text) { view.innerHTML = '<p class="error">' + esc(text) + '</p>'; }
  function userLink(u) { return u ? '<a href="/admin/usuarios/' + encodeURIComponent(u.id) + '">' + esc(u.username) + '</a>' : '<span class="muted">sin dueño</span>'; }
  function gameLink(g) { return '<a href="/admin/partidas/' + encodeURIComponent(g.slug) + '">' + esc(g.name) + '</a>'; }
  function playLink(slug, label) { return '<a class="btn ghost sm" href="/?game=' + encodeURIComponent(slug) + '">' + esc(label || 'Abrir') + '</a>'; }
  function tags(u) { return (u.is_admin ? '<span class="tag admin">admin</span>' : '') + (u.disabled ? '<span class="tag off">desactivado</span>' : ''); }
  function nav(which) { document.querySelectorAll('nav.top a[data-nav]').forEach(function (a) { if (a.getAttribute('data-nav') === which) a.setAttribute('aria-current', 'page'); }); }

  // --- Usuarios ---------------------------------------------------------------------------------
  function usersView() {
    nav('usuarios');
    document.title = 'Usuarios — Administración — Tavernus';
    call('GET', '/api/admin/users').then(function (d) {
      if (!d.ok) return fail(d.text);
      var h = '<h1>Usuarios</h1><p>Cada usuario tiene sus partidas y sus personajes. Abre uno para verlos y gestionarlos. Borrar un usuario no toca el mundo de ninguna partida: las suyas quedan sin dueño y puedes asignarlas a otro.</p>';
      if (!d.users.length) h += '<p class="muted">Aún no hay usuarios.</p>';
      else {
        h += '<table><thead><tr><th>Usuario</th><th class="hide-sm">Alta</th><th>Último acceso</th><th class="num">Partidas</th><th class="num">Personajes</th></tr></thead><tbody>';
        d.users.forEach(function (u) {
          h += '<tr class="u"><td><b>' + userLink(u) + '</b>' + tags(u) + '</td><td class="hide-sm">' + esc(day(u.created_at)) + '</td><td>' + esc(day(u.last_seen_at || u.last_login_at)) + '</td>' +
            '<td class="num"><a href="/admin/partidas?usuario=' + encodeURIComponent(u.username) + '">' + u.games + '</a></td><td class="num">' + u.characters + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      h += '<div class="row-form" style="margin-top:14px"><input type="text" id="new-u" placeholder="Usuario nuevo" autocomplete="off" aria-label="Nombre del usuario nuevo">' +
        '<input type="password" id="new-p" placeholder="Contraseña (${PASSWORD_MIN} o más)" autocomplete="new-password" aria-label="Contraseña del usuario nuevo">' +
        '<button class="btn ghost sm" type="button" id="new-go">Crear usuario</button><span class="error" id="new-err" role="alert"></span></div>';
      h += '<h2>Lo último</h2><ul class="log">' + (d.log.map(function (l) { return '<li>' + esc(day(l.at)) + ': <b>' + esc(l.admin) + '</b> ' + esc(l.action) + (l.target ? ' <b>' + esc(l.target) + '</b>' : '') + '</li>'; }).join('') || '<li>Nada todavía.</li>') + '</ul>';
      view.innerHTML = h;
      $('new-go').addEventListener('click', function () {
        call('POST', '/api/admin/users', { username: $('new-u').value.trim(), password: $('new-p').value }).then(function (r) {
          if (!r.ok) { $('new-err').textContent = r.text; return; }
          location.href = '/admin/usuarios/' + encodeURIComponent(r.user.id);
        });
      });
    });
  }

  // --- Un usuario -------------------------------------------------------------------------------
  function userView(id) {
    nav('usuarios');
    call('GET', '/api/admin/users/' + encodeURIComponent(id)).then(function (d) {
      if (!d.ok) return fail(d.text);
      var u = d.user, me = d.me;
      document.title = u.username + ' — Administración — Tavernus';
      var races = {}, classes = {};
      (d.options && d.options.races || []).forEach(function (r) { races[r.id] = r.name; });
      (d.options && d.options.classes || []).forEach(function (c) { classes[c.id] = c.name; });
      var h = '<a class="back" href="/admin/usuarios">← Usuarios</a><h1>' + esc(u.username) + tags(u) + '</h1>' +
        '<dl class="info"><dt>Alta</dt><dd>' + esc(day(u.created_at)) + '</dd><dt>Último acceso</dt><dd>' + esc(day(u.last_seen_at || u.last_login_at)) + '</dd></dl>' +
        '<div class="actions"><input type="password" id="pw" placeholder="Contraseña nueva" autocomplete="new-password" aria-label="Contraseña nueva para ' + esc(u.username) + '">' +
        '<button class="btn ghost sm" data-a="pw">Cambiar contraseña</button>' +
        (u.id === me ? '' : '<button class="btn ghost sm" data-a="admin">' + (u.is_admin ? 'Quitar admin' : 'Hacer admin') + '</button>' +
          '<button class="btn ghost sm" data-a="off">' + (u.disabled ? 'Reactivar' : 'Desactivar') + '</button>' +
          '<button class="btn ghost sm" data-a="del">Borrar usuario</button>') +
        '<span class="error" id="u-err" role="alert"></span><span class="ok" id="u-ok"></span></div>';
      h += '<h2>Partidas</h2>';
      if (!d.games.length) h += '<p class="muted">No tiene partidas.</p>';
      else {
        h += '<table><thead><tr><th>Partida</th><th>Papel</th><th></th></tr></thead><tbody>';
        d.games.forEach(function (g) { h += '<tr><td><b>' + gameLink(g) + '</b></td><td>' + (g.owner ? 'Es su partida' : 'Tiene asiento') + '</td><td class="num">' + playLink(g.slug) + '</td></tr>'; });
        h += '</tbody></table>';
      }
      h += '<h2>Personajes de la biblioteca</h2>';
      if (!d.characters.length) h += '<p class="muted">No tiene personajes guardados.</p>';
      else {
        h += '<table><thead><tr><th>Personaje</th><th class="hide-sm">Raza y clase</th><th>Juega en</th><th></th></tr></thead><tbody>';
        d.characters.forEach(function (c, i) {
          h += '<tr data-c="' + i + '"><td><b class="cname">' + esc(c.name) + '</b></td><td class="hide-sm">' + esc([races[c.race_id] || c.race_id, classes[c.class_id] || c.class_id].filter(Boolean).join(', ') || 'sin elegir') + '</td>' +
            '<td>' + (c.games.length ? c.games.map(gameLink).join(', ') : '<span class="muted">ninguna partida</span>') + '</td>' +
            '<td class="num"><div class="tools"><button class="btn ghost sm" data-c="sheet">Ficha</button><button class="btn ghost sm" data-c="rename">Renombrar</button><button class="btn ghost sm" data-c="del">Borrar</button></div><span class="error" role="alert"></span></td></tr>';
        });
        h += '</tbody></table>';
      }
      view.innerHTML = h;
      var err = $('u-err'), ok = $('u-ok');
      function done(r, msg, then) { if (!r.ok) { err.textContent = r.text; ok.textContent = ''; return; } err.textContent = ''; ok.textContent = msg; setTimeout(then || function () { userView(id); }, 700); }
      view.querySelectorAll('button[data-a]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.a;
          if (a === 'pw') call('POST', '/api/admin/users/' + u.id, { password: $('pw').value }).then(function (r) { done(r, 'Contraseña cambiada. Sus sesiones abiertas se han cerrado.'); });
          else if (a === 'admin') call('POST', '/api/admin/users/' + u.id, { admin: !u.is_admin }).then(function (r) { done(r, 'Hecho.'); });
          else if (a === 'off') call('POST', '/api/admin/users/' + u.id, { disabled: !u.disabled }).then(function (r) { done(r, 'Hecho.'); });
          else if (a === 'del') { if (!armed(b)) return; call('DELETE', '/api/admin/users/' + u.id).then(function (r) { done(r, 'Borrado.', function () { location.href = '/admin/usuarios'; }); }); }
        });
      });
      view.querySelectorAll('tr[data-c]').forEach(function (tr) {
        var c = d.characters[Number(tr.dataset.c)], cerr = tr.querySelector('.error');
        var api = '/api/admin/users/' + u.id + '/characters/' + c.id;
        tr.querySelector('[data-c=sheet]').addEventListener('click', function () {
          call('GET', api).then(function (r) { if (!r.ok) { cerr.textContent = r.text; return; } sheet(r.character, r.preview); });
        });
        tr.querySelector('[data-c=rename]').addEventListener('click', function () {
          var cell = tr.querySelector('.cname');
          if (cell.querySelector('input')) return;
          cell.innerHTML = '<span class="row-form"><input type="text" value="' + esc(c.name) + '" aria-label="Nombre nuevo de ' + esc(c.name) + '"><button class="btn ghost sm">Guardar</button><button class="btn ghost sm" data-x>Cancelar</button></span>';
          var inp = cell.querySelector('input'); inp.focus(); inp.select();
          function save() { call('POST', api, { name: inp.value }).then(function (r) { if (!r.ok) { cerr.textContent = r.text; return; } userView(id); }); }
          cell.querySelector('button').addEventListener('click', save);
          inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') cell.textContent = c.name; });
          cell.querySelector('[data-x]').addEventListener('click', function () { cell.textContent = c.name; });
        });
        tr.querySelector('[data-c=del]').addEventListener('click', function (ev) {
          if (!armed(ev.currentTarget)) return;
          call('DELETE', api).then(function (r) { if (!r.ok) { cerr.textContent = r.text; return; } userView(id); });
        });
      });
    });
  }

  /** La ficha de un personaje de la biblioteca: lo que vería al crearlo (resumen del asistente). */
  function sheet(c, p) {
    var dlg = $('sheet');
    var h = '<h3>' + esc(c.name) + '</h3>';
    if (!p) h += '<p class="muted">No se puede calcular la ficha de este personaje.</p>';
    else {
      h += '<p class="muted">' + esc(p.race + ', ' + p.class_name + ', ' + p.background + '. Muerte ' + (p.death_mode === 'hardcore' ? 'definitiva' : 'casual') + '.') + '</p>';
      h += '<div class="sheet"><div><small>Puntos de golpe</small><b>' + p.hp_max + '</b></div><div><small>Clase de armadura</small><b>' + p.ac + '</b></div><div><small>Velocidad</small><b>' + p.speed_ft + ' pies</b></div><div><small>Percepción pasiva</small><b>' + p.passive_perception + '</b></div></div>';
      h += '<div class="ab">' + p.abilities.map(function (a) { return '<span>' + esc(a.short) + ' ' + a.total + ' (' + (a.modifier >= 0 ? '+' : '') + a.modifier + ')</span>'; }).join('') + '</div>';
      h += '<p class="muted">Habilidades: ' + esc(p.skills.map(function (s) { return s.name + ' ' + (s.modifier >= 0 ? '+' : '') + s.modifier; }).join(', ') || 'ninguna') + '.</p>';
      h += '<p class="muted">Equipo: ' + esc(p.equipment.map(function (e) { return e.name + (e.quantity > 1 ? ' (' + e.quantity + ')' : ''); }).join(', ') || 'nada') + '.</p>';
    }
    if (c.appearance) h += '<p>' + esc(c.appearance) + '</p>';
    if (c.hook) h += '<p class="muted">' + esc(c.hook) + '</p>';
    h += '<div class="foot"><button class="btn ghost" type="button" id="sheet-x">Cerrar</button></div>';
    dlg.innerHTML = h;
    $('sheet-x').addEventListener('click', function () { dlg.close(); });
    dlg.showModal();
  }

  // --- Partidas ---------------------------------------------------------------------------------
  function gamesView() {
    nav('partidas');
    document.title = 'Partidas — Administración — Tavernus';
    call('GET', '/api/admin/games').then(function (d) {
      if (!d.ok) return fail(d.text);
      var q = new URLSearchParams(location.search).get('usuario') || '';
      view.innerHTML = '<h1>Partidas</h1><p>Todas las partidas del servidor. Abre una para entrar en ella como administrador: tendrás tu propio personaje y podrás mirar y jugar con cualquiera de los suyos.</p>' +
        '<div class="row-form"><input type="text" id="q" placeholder="Filtrar por usuario" value="' + esc(q) + '" aria-label="Filtrar por usuario (dueño o con asiento)"><span class="muted" id="count"></span></div><div id="list"></div>';
      var inp = $('q');
      function render() {
        var f = fold(inp.value.trim());
        var list = d.games.filter(function (g) { return !f || (g.owner && fold(g.owner.username).indexOf(f) >= 0) || g.players.some(function (p) { return fold(p.username).indexOf(f) >= 0; }); });
        $('count').textContent = f ? list.length + ' de ' + d.games.length : d.games.length + ' partidas';
        if (!list.length) { $('list').innerHTML = '<p class="muted">' + (d.games.length ? 'Ninguna partida de ese usuario.' : 'No hay partidas.') + '</p>'; return; }
        var h = '<table><thead><tr><th>Partida</th><th class="hide-sm">Máster</th><th>Dueño</th><th>Juegan</th><th class="hide-sm">Última vez</th><th></th></tr></thead><tbody>';
        list.forEach(function (g) {
          h += '<tr class="u"><td><b>' + gameLink(g) + '</b><div class="muted">' + esc(g.characters.join(', ') || 'sin personajes') + '</div></td>' +
            '<td class="hide-sm">' + esc(MODE[g.mode] || g.mode) + (g.demo ? ' (demo)' : '') + (g.obsolete ? '<span class="tag off">obsoleta</span>' : '') + '</td><td>' + userLink(g.owner) + '</td>' +
            '<td>' + (g.players.length ? g.players.map(userLink).join(', ') : '<span class="muted">nadie con cuenta</span>') + '</td>' +
            '<td class="hide-sm">' + esc(day(g.last_opened_at || g.created_at)) + '</td><td class="num">' + (g.obsolete ? '' : playLink(g.slug)) + '</td></tr>';
        });
        $('list').innerHTML = h + '</tbody></table>';
      }
      inp.addEventListener('input', render);
      render();
    });
  }

  // --- Una partida ------------------------------------------------------------------------------
  function gameView(slug) {
    nav('partidas');
    call('GET', '/api/admin/games/' + encodeURIComponent(slug)).then(function (d) {
      if (!d.ok) return fail(d.text);
      var g = d.game;
      document.title = g.name + ' — Administración — Tavernus';
      var h = '<a class="back" href="/admin/partidas">← Partidas</a><h1>' + esc(g.name) + (g.demo ? '<span class="tag host">demo</span>' : '') + (g.obsolete ? '<span class="tag off">obsoleta</span>' : '') + '</h1>' +
        '<dl class="info"><dt>Máster</dt><dd>' + esc(MODE[g.mode] || g.mode) + '</dd><dt>Creada</dt><dd>' + esc(day(g.created_at)) + '</dd><dt>Última vez</dt><dd>' + esc(day(g.last_opened_at)) + '</dd>' +
        '<dt>Personajes</dt><dd>' + esc(g.characters.join(', ') || 'ninguno') + '</dd></dl>' +
        (g.obsolete
          ? '<p class="muted">Partida de antes de que el mundo se guardara en la base: se conserva tal como quedó, en su carpeta, pero ya no se abre.</p>'
          : '<div class="actions">' + playLink(g.slug, 'Abrir la partida') + '<a class="btn ghost sm" href="/invitaciones?game=' + encodeURIComponent(g.slug) + '">Invitaciones</a></div>');
      h += '<h2>Dueño</h2><p>' + (d.owner ? userLink(d.owner) : '<span class="muted">Sin dueño.</span>') + '</p>' +
        '<div class="row-form"><input type="text" id="assign" placeholder="Usuario" aria-label="Usuario al que asignar la partida"><button class="btn ghost sm" id="assign-go">Asignar a este usuario</button><span class="error" id="assign-err" role="alert"></span></div>';
      h += '<h2>Asientos</h2>';
      if (!d.seats.length) h += '<p class="muted">Sin asientos todavía.</p>';
      else {
        h += '<table><thead><tr><th>Asiento</th><th>Personaje</th><th>Usuario</th><th class="hide-sm">Última vez</th></tr></thead><tbody>';
        d.seats.forEach(function (s) {
          h += '<tr><td>' + esc(s.label) + (s.host ? '<span class="tag host">anfitrión</span>' : '') + '</td>' +
            '<td><span class="dot' + (s.online ? ' on' : '') + '" title="' + (s.online ? 'En línea' : 'Sin conexión') + '"></span> ' + (s.character_name ? esc(s.character_name) : '<span class="muted">libre</span>') + '</td>' +
            '<td>' + (s.user ? userLink(s.user) : '<span class="muted">nadie</span>') + '</td><td class="hide-sm">' + esc(day(s.last_seen_at)) + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      view.innerHTML = h;
      $('assign-go').addEventListener('click', function () {
        call('POST', '/api/admin/games/assign', { game: g.slug, user: $('assign').value.trim() }).then(function (r) {
          if (!r.ok) { $('assign-err').textContent = r.text; return; }
          gameView(slug);
        });
      });
    });
  }

  var path = location.pathname.replace(/\/+$/, ''), m;
  if ((m = /^\/admin\/usuarios\/([^/]+)$/.exec(path))) userView(decodeURIComponent(m[1]));
  else if ((m = /^\/admin\/partidas\/([^/]+)$/.exec(path))) gameView(decodeURIComponent(m[1]));
  else if (path === '/admin/partidas') gamesView();
  else usersView();
})();
</script>
</body></html>`;
}
