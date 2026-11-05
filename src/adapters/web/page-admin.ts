/**
 * Panel del administrador (/admin/usuarios): usuarios con sus partidas y personajes, cambiar contraseñas,
 * dar o quitar administración, desactivar o borrar cuentas, crear una, asignar partidas a un usuario y lo
 * último que se ha hecho desde aquí. Rutas en server.ts (`handleAdmin`, /api/admin/…).
 */

import { HEAD } from './page-access.js';
import { PASSWORD_MIN } from '../../accounts/accounts.js';

const CSS = String.raw`
  .box.wide { max-width: 980px; }
  nav.top { display: flex; gap: 8px 16px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
  h2 { font: 700 17px/1.3 var(--display); margin: 26px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-weight: 600; font-size: 12px; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
  td { padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr.u { cursor: pointer; }
  tr.u:hover td { background: var(--hover); }
  tr.u.on td { background: rgba(230,183,90,.06); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; margin-left: 6px; }
  .tag.admin { background: rgba(230,183,90,.16); color: var(--accent); }
  .tag.off { background: rgba(255,107,94,.14); color: var(--error); }
  .detail td { background: rgba(255,255,255,.02); }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
  .cols h3 { font: 600 13px/1.3 var(--sans); color: var(--muted); margin: 4px 0 6px; }
  .cols ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
  .actions input { width: 220px; height: 30px; margin: 0; display: inline-block; }
  .row-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .row-form input { width: 180px; height: 32px; margin: 0; display: inline-block; }
  .ok { color: var(--ok); font-size: 13px; }
  .log li { font-size: 13px; color: var(--muted); }
  .log b { color: var(--text); font-weight: 500; }
  @media (max-width: 720px) { .hide-sm { display: none; } table { font-size: 13px; } }`;

export function adminPage(): string {
  return HEAD('Administración — Tavernus', CSS) + String.raw`<div class="box wide">
  <nav class="top"><a href="/">← Partidas</a><a href="/admin/estado">Estado del servidor</a></nav>
  <h1>Administración</h1>
  <p>Usuarios, sus personajes y sus partidas. Borrar un usuario no toca el mundo de ninguna partida: las suyas quedan sin dueño y puedes asignarlas a otro.</p>

  <h2>Usuarios</h2>
  <div id="users"><p class="muted">Cargando…</p></div>
  <div class="row-form" style="margin-top:12px">
    <input type="text" id="new-u" placeholder="Usuario nuevo" autocomplete="off" aria-label="Nombre del usuario nuevo">
    <input type="password" id="new-p" placeholder="Contraseña (${PASSWORD_MIN} o más)" autocomplete="new-password" aria-label="Contraseña del usuario nuevo">
    <button class="btn ghost sm" type="button" id="new-go">Crear usuario</button>
    <span class="error" id="new-err" role="alert"></span>
  </div>

  <h2>Partidas</h2>
  <div id="games"><p class="muted">Cargando…</p></div>

  <h2>Lo último</h2>
  <ul class="log" id="log"></ul>
</div>
<script>
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso) { if (!iso) return 'nunca'; try { return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
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
  var open = null, me = null;

  function loadUsers() {
    call('GET', '/api/admin/users').then(function (d) {
      if (!d.ok) { $('users').innerHTML = '<p class="error">' + esc(d.text) + '</p>'; return; }
      me = d.me;
      if (!d.users.length) { $('users').innerHTML = '<p class="muted">Aún no hay usuarios.</p>'; }
      else {
        var t = document.createElement('table');
        t.innerHTML = '<thead><tr><th>Usuario</th><th class="hide-sm">Alta</th><th>Último acceso</th><th class="num">Partidas</th><th class="num">Personajes</th></tr></thead><tbody></tbody>';
        var tb = t.querySelector('tbody');
        d.users.forEach(function (u) {
          var tr = document.createElement('tr'); tr.className = 'u' + (open === u.id ? ' on' : '');
          tr.innerHTML = '<td><b>' + esc(u.username) + '</b>' + (u.is_admin ? '<span class="tag admin">admin</span>' : '') + (u.disabled ? '<span class="tag off">desactivado</span>' : '') + '</td>' +
            '<td class="hide-sm">' + esc(day(u.created_at)) + '</td><td>' + esc(day(u.last_seen_at || u.last_login_at)) + '</td>' +
            '<td class="num">' + u.games + '</td><td class="num">' + u.characters + '</td>';
          tr.addEventListener('click', function () { open = open === u.id ? null : u.id; loadUsers(); });
          tb.appendChild(tr);
          if (open === u.id) {
            var dr = document.createElement('tr'); dr.className = 'detail';
            var td = document.createElement('td'); td.colSpan = 5; td.innerHTML = '<p class="muted">Cargando…</p>';
            dr.appendChild(td); tb.appendChild(dr);
            detail(u, td);
          }
        });
        $('users').innerHTML = ''; $('users').appendChild(t);
      }
      $('log').innerHTML = d.log.map(function (l) { return '<li>' + esc(day(l.at)) + ': <b>' + esc(l.admin) + '</b> ' + esc(l.action) + (l.target ? ' <b>' + esc(l.target) + '</b>' : '') + '</li>'; }).join('') || '<li>Nada todavía.</li>';
    });
  }

  function detail(u, td) {
    call('GET', '/api/admin/users/' + u.id).then(function (d) {
      if (!d.ok) { td.innerHTML = '<p class="error">' + esc(d.text) + '</p>'; return; }
      var chars = d.characters.map(function (c) {
        return '<li><b>' + esc(c.name) + '</b>' + (c.games.length ? '<span class="muted"> en ' + c.games.map(function (g) { return esc(g.name); }).join(', ') + '</span>' : '') + '</li>';
      }).join('') || '<li class="muted">Ninguno.</li>';
      var games = d.games.map(function (g) {
        return '<li><a href="/?game=' + encodeURIComponent(g.slug) + '">' + esc(g.name) + '</a>' + (g.owner ? '<span class="muted"> (suya)</span>' : '<span class="muted"> (invitado)</span>') + '</li>';
      }).join('') || '<li class="muted">Ninguna.</li>';
      td.innerHTML = '<div class="cols"><div><h3>Personajes de su biblioteca</h3><ul>' + chars + '</ul></div><div><h3>Partidas</h3><ul>' + games + '</ul></div></div>' +
        '<div class="actions"><input type="password" placeholder="Contraseña nueva" autocomplete="new-password" aria-label="Contraseña nueva para ' + esc(u.username) + '">' +
        '<button class="btn ghost sm" data-a="pw">Cambiar contraseña</button>' +
        (u.id === me ? '' : '<button class="btn ghost sm" data-a="admin">' + (u.is_admin ? 'Quitar admin' : 'Hacer admin') + '</button>' +
          '<button class="btn ghost sm" data-a="off">' + (u.disabled ? 'Reactivar' : 'Desactivar') + '</button>' +
          '<button class="btn ghost sm" data-a="del">Borrar</button>') +
        '<span class="error" role="alert"></span><span class="ok"></span></div>';
      var err = td.querySelector('.error'), ok = td.querySelector('.ok');
      function done(r, msg) { if (!r.ok) { err.textContent = r.text; ok.textContent = ''; return; } err.textContent = ''; ok.textContent = msg; loadGames(); setTimeout(loadUsers, 900); }
      td.querySelectorAll('button[data-a]').forEach(function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var a = b.dataset.a;
          if (a === 'pw') {
            var p = td.querySelector('input').value;
            call('POST', '/api/admin/users/' + u.id, { password: p }).then(function (r) { if (r.ok) td.querySelector('input').value = ''; done(r, 'Contraseña cambiada. Sus sesiones abiertas se han cerrado.'); });
          } else if (a === 'admin') {
            call('POST', '/api/admin/users/' + u.id, { admin: !u.is_admin }).then(function (r) { done(r, 'Hecho.'); });
          } else if (a === 'off') {
            call('POST', '/api/admin/users/' + u.id, { disabled: !u.disabled }).then(function (r) { done(r, 'Hecho.'); });
          } else if (a === 'del') {
            if (!armed(b)) return;
            call('DELETE', '/api/admin/users/' + u.id).then(function (r) { if (r.ok) open = null; done(r, 'Borrado.'); });
          }
        });
      });
      td.addEventListener('click', function (ev) { ev.stopPropagation(); });
    });
  }

  function loadGames() {
    call('GET', '/api/admin/games').then(function (d) {
      if (!d.ok) { $('games').innerHTML = '<p class="error">' + esc(d.text) + '</p>'; return; }
      if (!d.games.length) { $('games').innerHTML = '<p class="muted">No hay partidas.</p>'; return; }
      var t = document.createElement('table');
      t.innerHTML = '<thead><tr><th>Partida</th><th>Dueño</th><th class="hide-sm">Juegan</th><th>Asignar a</th></tr></thead><tbody></tbody>';
      var tb = t.querySelector('tbody');
      d.games.forEach(function (g) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td><a href="/?game=' + encodeURIComponent(g.slug) + '">' + esc(g.name) + '</a><div class="muted">' + esc(g.characters.join(', ') || 'sin personajes') + '</div></td>' +
          '<td>' + (g.owner ? esc(g.owner.username) : '<span class="muted">sin dueño</span>') + '</td>' +
          '<td class="hide-sm">' + (esc(g.players.join(', ')) || '<span class="muted">nadie con cuenta</span>') + '</td>' +
          '<td><div class="row-form"><input type="text" placeholder="usuario" aria-label="Usuario al que asignar ' + esc(g.name) + '"><button class="btn ghost sm">Asignar</button></div><span class="error" role="alert"></span></td>';
        var inp = tr.querySelector('input'), err = tr.querySelector('.error');
        tr.querySelector('button').addEventListener('click', function () {
          call('POST', '/api/admin/games/assign', { game: g.slug, user: inp.value.trim() }).then(function (r) {
            if (!r.ok) { err.textContent = r.text; return; }
            loadGames(); loadUsers();
          });
        });
        tb.appendChild(tr);
      });
      $('games').innerHTML = ''; $('games').appendChild(t);
    });
  }

  $('new-go').addEventListener('click', function () {
    call('POST', '/api/admin/users', { username: $('new-u').value.trim(), password: $('new-p').value }).then(function (r) {
      if (!r.ok) { $('new-err').textContent = r.text; return; }
      $('new-err').textContent = ''; $('new-u').value = ''; $('new-p').value = '';
      loadUsers();
    });
  });
  loadUsers();
  loadGames();
})();
</script>
</body></html>`;
}
