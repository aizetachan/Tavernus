/**
 * Entrar o crear cuenta (/entrar): nombre de usuario y contraseña, sin correo. Con una invitación pendiente
 * (`?invite=<partida>/<token>`), tras entrar el asiento queda ligado a la cuenta y se va a la partida.
 * En modo `invite` solo se crea cuenta desde una invitación.
 *
 * Sin correo no hay «te mandamos un enlace»: al crear la cuenta el servidor da un código de recuperación
 * (una sola vez; aquí se enseña en grande antes de seguir) y «¿Has olvidado la contraseña?» abre el tercer
 * modo, Recuperar: usuario, código y contraseña nueva (POST /api/auth/recover), que entra y da un código nuevo.
 */

import type { AccessMode } from './access.js';
import { data, esc, HEAD } from './page-access.js';
import { PASSWORD_MIN } from '../../accounts/accounts.js';

export interface AccountPageInput {
  mode: AccessMode;
  /** Invitación pendiente: nombre de la partida, «<partida>/<token>» y si el asiento aún no es de ninguna cuenta. */
  invite: { game: string; value: string; free: boolean } | null;
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
  .alt { margin: 14px 0 0; text-align: center; font-size: 13.5px; }
  .alt a { color: var(--accent); }
  /* El código de recuperación, grande y fácil de copiar. */
  .code { margin: 14px 0 0; padding: 16px 12px; border-radius: 12px; background: var(--bubble); box-shadow: inset 0 0 0 1px var(--line); text-align: center;
    font: 700 22px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .08em; color: var(--accent); user-select: all; -webkit-user-select: all; overflow-wrap: anywhere; }
  .warn { margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; background: rgba(230,183,90,.08); box-shadow: inset 0 0 0 1px rgba(230,183,90,.25); color: var(--text); font-size: 14px; }
  #code-box .btn { width: 100%; height: 42px; margin-top: 12px; }
  #code-copy { background: var(--bubble); color: var(--text); }
  [hidden] { display: none !important; }`;

export function accountPage(input: AccountPageInput): string {
  // En `invite` solo se crea cuenta con un enlace cuyo asiento no sea aún de nadie; con uno ya usado, solo entrar.
  const canRegister = input.mode !== 'invite' || Boolean(input.invite?.free);
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
    <label id="l-code" hidden>Código de recuperación<input type="text" id="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="XXXX-XXXX-XXXX-XXXX"></label>
    <p class="hint" id="c-hint" hidden>El que te dimos al crear la cuenta (o al generarlo en «Tu cuenta»). Con o sin guiones.</p>
    <label><span id="p-label">Contraseña</span><input type="password" id="password" name="password" autocomplete="current-password" maxlength="200" required></label>
    <p class="hint" id="p-hint" hidden>Al menos ${PASSWORD_MIN} caracteres. No hay recuperación por correo: guarda el código de recuperación que te daremos, o pide a quien organiza tu partida que te ponga una nueva.</p>
    <label id="l-again" hidden>Repite la contraseña<input type="password" id="again" autocomplete="new-password" maxlength="200"></label>
    <div class="error" id="err" role="alert"></div>
    <button class="btn primary" type="submit" id="go">Entrar</button>
  </form>
  <p class="alt" id="forgot-p"><a href="#" id="forgot">¿Has olvidado la contraseña?</a></p>
  <p class="alt" id="back-p" hidden><a href="#" id="back">Volver a entrar</a></p>
  ${canRegister ? '' : '<p class="hint" id="inv-hint">Este servidor es por invitación: para crear cuenta necesitas el enlace que te pasa quien organiza la partida.</p>'}
  <div id="code-box" hidden>
    <div class="code" id="code-out" aria-live="polite"></div>
    <p class="warn">Guárdalo: es la única forma de cambiar la contraseña si la olvidas. El anterior ya no vale.</p>
    <button class="btn" type="button" id="code-copy">Copiar</button>
    <button class="btn primary" type="button" id="code-done">Lo he guardado</button>
  </div>
  <p class="wiki"><a href="/wiki/">Leer la wiki del mundo</a></p>
</div>
<script>
(function () {
  var D = ${data({ invite: input.invite?.value ?? null, next: input.next })};
  function $(id) { return document.getElementById(id); }
  // Tres modos: 'login', 'register' y 'recover' (contraseña olvidada: usuario, código de recuperación y contraseña nueva).
  var at = 'login';
  var TITLE = { login: 'Entra en la taberna', register: 'Crea tu cuenta', recover: 'Recupera tu cuenta' };
  var GO = { login: 'Entrar', register: 'Crear cuenta', recover: 'Cambiar la contraseña y entrar' };
  function mode(m) {
    at = m;
    var reg = m === 'register', rec = m === 'recover';
    $('t-login').setAttribute('aria-selected', String(m === 'login'));
    $('t-register').setAttribute('aria-selected', String(reg));
    $('title').textContent = TITLE[m];
    $('go').textContent = GO[m];
    $('u-hint').hidden = $('p-hint').hidden = !reg;
    $('l-again').hidden = !(reg || rec);
    $('l-code').hidden = $('c-hint').hidden = !rec;
    $('p-label').textContent = rec ? 'Contraseña nueva' : 'Contraseña';
    $('password').setAttribute('autocomplete', reg || rec ? 'new-password' : 'current-password');
    $('forgot-p').hidden = m !== 'login';
    $('back-p').hidden = !rec;
    $('err').textContent = '';
  }
  $('t-login').addEventListener('click', function () { mode('login'); });
  $('t-register').addEventListener('click', function () { mode('register'); });
  $('forgot').addEventListener('click', function (ev) { ev.preventDefault(); mode('recover'); ($('username').value ? $('code') : $('username')).focus(); });
  $('back').addEventListener('click', function (ev) { ev.preventDefault(); mode('login'); $('username').focus(); });
  // Quien llega con una invitación casi siempre es nuevo.
  if (D.invite && !$('t-register').closest('[hidden]')) mode('register');
  // El código, tal como lo escriban: mayúsculas y en grupos de cuatro con guiones (si no mide 16, va tal cual y el servidor dirá).
  function cleanCode(v) {
    var raw = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return raw.length === 16 ? raw.replace(/(.{4})(?=.)/g, '$1-') : raw;
  }
  // El código de recuperación se enseña una sola vez: en grande, con «Copiar», y se sigue al pulsar «Lo he guardado».
  function showCode(code, next) {
    $('form').hidden = true; document.querySelector('.tabs').hidden = true;
    $('forgot-p').hidden = $('back-p').hidden = true;
    var inv = document.querySelector('.invite'); if (inv) inv.hidden = true;
    var ih = $('inv-hint'); if (ih) ih.hidden = true;
    $('title').textContent = 'Guarda tu código de recuperación';
    $('code-out').textContent = code;
    $('code-box').hidden = false;
    $('code-done').addEventListener('click', function () { location.href = next; });
    $('code-copy').focus();
  }
  $('code-copy').addEventListener('click', function () {
    var b = $('code-copy'), code = $('code-out').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(function () { b.textContent = 'Copiado'; }, function () {
      var r = document.createRange(); r.selectNodeContents($('code-out')); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { document.execCommand('copy'); b.textContent = 'Copiado'; } catch (e) { b.textContent = 'Cópialo a mano'; }
    });
    setTimeout(function () { b.textContent = 'Copiar'; }, 1800);
  });
  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var u = $('username').value.trim(), p = $('password').value, rec = at === 'recover', reg = at === 'register';
    if (!u || !p) { $('err').textContent = rec ? 'Escribe tu nombre de usuario, el código y la contraseña nueva.' : 'Escribe tu nombre de usuario y tu contraseña.'; return; }
    var code = rec ? cleanCode($('code').value) : '';
    if (rec && !code) { $('err').textContent = 'Escribe tu código de recuperación.'; return; }
    if ((reg || rec) && p !== $('again').value) { $('err').textContent = 'Las dos contraseñas no coinciden.'; return; }
    $('go').disabled = true; $('err').textContent = '';
    var body = rec ? { username: u, code: code, password: p, next: D.next } : { username: u, password: p, invite: D.invite, next: D.next };
    fetch(rec ? '/api/auth/recover' : reg ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) { $('go').disabled = false; $('err').textContent = r.text || 'No se pudo.'; if (r.field === 'code') $('code').focus(); return; }
      if (r.text) { try { sessionStorage.setItem('tavernus.notice', r.text); } catch (e) {} }
      var next = r.next || '/';
      if (r.recovery_code) { showCode(r.recovery_code, next); return; }
      location.href = next;
    }).catch(function () { $('go').disabled = false; $('err').textContent = 'No hay conexión con el servidor.'; });
  });
  $('username').focus();
})();
</script>
</body></html>`;
}
