/**
 * Entrar o crear cuenta (/entrar): nombre de usuario y contraseña, sin correo. Con una invitación pendiente
 * (`?invite=<partida>/<token>`), tras entrar el asiento queda ligado a la cuenta y se va a la partida.
 * En modo `invite` solo se crea cuenta desde una invitación.
 */

import type { AccessMode } from './access.js';
import { data, esc, HEAD } from './page-access.js';
import { PASSWORD_MIN } from '../../accounts/accounts.js';

export interface AccountPageInput {
  mode: AccessMode;
  /** Invitación pendiente: nombre de la partida y «<partida>/<token>». */
  invite: { game: string; value: string } | null;
  /** A dónde volver tras entrar. */
  next: string | null;
}

const CSS = String.raw`
  body { display: flex; min-height: 100vh; align-items: center; padding: 24px 16px;
    background: radial-gradient(1200px 600px at 50% -10%, rgba(230,183,90,.10), transparent 60%), var(--bg); }
  .box { width: 100%; max-width: 420px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .brand img { width: 36px; height: 36px; border-radius: 9px; }
  .brand b { font: 800 20px/1 var(--display); letter-spacing: -.01em; }
  .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; margin: 16px 0 4px; border-radius: 999px; background: var(--bubble); }
  .tabs button { height: 34px; border-radius: 999px; background: transparent; color: var(--muted); font-weight: 600; font-size: 14px; }
  .tabs button[aria-selected=true] { background: var(--panel); color: var(--text); box-shadow: inset 0 0 0 1px var(--line); }
  .tabs[hidden] { display: none; }
  form .btn { width: 100%; height: 42px; margin-top: 18px; }
  .hint { font-size: 12.5px; color: var(--muted); margin: 6px 0 0; }
  .invite { margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; background: rgba(230,183,90,.08); box-shadow: inset 0 0 0 1px rgba(230,183,90,.25); color: var(--text); font-size: 14px; }
  .error { margin-top: 10px; }
  .wiki { text-align: center; margin-top: 16px; font-size: 13px; }
  [hidden] { display: none !important; }`;

export function accountPage(input: AccountPageInput): string {
  const canRegister = input.mode !== 'invite' || Boolean(input.invite);
  return HEAD('Entrar — Tavernus', CSS) + String.raw`<div class="box">
  <div class="brand"><img src="/assets/icon-192.png" alt=""><b>Tavernus</b></div>
  <h1 id="title">Entra en la taberna</h1>
  <p>Rol por chat con un máster de IA. Con tu cuenta ves tus partidas y tus personajes desde cualquier dispositivo.</p>
  ${input.invite ? `<p class="invite">Te han invitado a <b>${esc(input.invite.game)}</b>. Entra o crea tu cuenta y el asiento quedará tuyo.</p>` : ''}
  <div class="tabs" role="tablist" ${canRegister ? '' : 'hidden'}>
    <button type="button" role="tab" id="t-login" aria-selected="true">Entrar</button>
    <button type="button" role="tab" id="t-register" aria-selected="false">Crear cuenta</button>
  </div>
  <form id="form" autocomplete="on" novalidate>
    <label>Nombre de usuario<input type="text" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24" required></label>
    <p class="hint" id="u-hint" hidden>Entre 3 y 24 letras, cifras, puntos o guiones, sin espacios. Es el nombre con el que entras, no el de tu personaje.</p>
    <label>Contraseña<input type="password" id="password" name="password" autocomplete="current-password" maxlength="200" required></label>
    <p class="hint" id="p-hint" hidden>Al menos ${PASSWORD_MIN} caracteres. No hay recuperación por correo: si la olvidas, quien administra el servidor puede ponerte una nueva.</p>
    <label id="l-again" hidden>Repite la contraseña<input type="password" id="again" autocomplete="new-password" maxlength="200"></label>
    <div class="error" id="err" role="alert"></div>
    <button class="btn primary" type="submit" id="go">Entrar</button>
  </form>
  ${canRegister ? '' : '<p class="hint">Este servidor es por invitación: para crear cuenta necesitas el enlace que te pasa quien organiza la partida.</p>'}
  <p class="wiki"><a href="/wiki/">Leer la wiki del mundo</a></p>
</div>
<script>
(function () {
  var D = ${data({ invite: input.invite?.value ?? null, next: input.next })};
  function $(id) { return document.getElementById(id); }
  var registering = false;
  function mode(reg) {
    registering = reg;
    $('t-login').setAttribute('aria-selected', String(!reg));
    $('t-register').setAttribute('aria-selected', String(reg));
    $('title').textContent = reg ? 'Crea tu cuenta' : 'Entra en la taberna';
    $('go').textContent = reg ? 'Crear cuenta' : 'Entrar';
    $('u-hint').hidden = $('p-hint').hidden = $('l-again').hidden = !reg;
    $('password').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    $('err').textContent = '';
  }
  $('t-login').addEventListener('click', function () { mode(false); });
  $('t-register').addEventListener('click', function () { mode(true); });
  // Quien llega con una invitación casi siempre es nuevo.
  if (D.invite && !$('t-register').closest('[hidden]')) mode(true);
  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var u = $('username').value.trim(), p = $('password').value;
    if (!u || !p) { $('err').textContent = 'Escribe tu nombre de usuario y tu contraseña.'; return; }
    if (registering && p !== $('again').value) { $('err').textContent = 'Las dos contraseñas no coinciden.'; return; }
    $('go').disabled = true; $('err').textContent = '';
    fetch(registering ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, password: p, invite: D.invite, next: D.next })
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) { $('go').disabled = false; $('err').textContent = r.text || 'No se pudo.'; return; }
      if (r.text) { try { sessionStorage.setItem('tavernus.notice', r.text); } catch (e) {} }
      location.href = r.next || '/';
    }).catch(function () { $('go').disabled = false; $('err').textContent = 'No hay conexión con el servidor.'; });
  });
  $('username').focus();
})();
</script>
</body></html>`;
}
