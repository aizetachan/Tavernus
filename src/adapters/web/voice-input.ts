/**
 * Dictado por voz en el chat de la web: un botón de micrófono junto al cuadro
 * «¿Qué haces?» que usa la Web Speech API del navegador (SpeechRecognition o
 * webkitSpeechRecognition). Sin servidor ni coste: el reconocimiento lo hace el
 * navegador. Si no lo soporta (Firefox, algunos WebView) el botón no aparece.
 *
 * page.ts solo interpola VOICE_STYLE dentro de su <style> y VOICE_SCRIPT tras
 * su <script>; el botón y el ajuste «enviar al terminar» los crea este script.
 *
 * La normalización del dictado vive como fuente JS (NORMALIZE_JS) para que el
 * navegador y los tests ejecuten exactamente el mismo código.
 */

/** Normaliza lo dictado: sin muletillas al principio, mayúscula inicial y «barra look» → «/look». */
const NORMALIZE_JS = String.raw`function normalizeDictation(raw) {
  var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Muletillas al principio, encadenadas o no («eh, vale, pues…»). Si solo hay muletilla, se queda.
  var FILLER = /^(?:e+h+|e+m+|m{2,}h*|a+h+|vale|bueno|pues|venga|o sea|ok(?:ay|ey)?|okey)(?:[\s,.;:!¡?¿…-]+|$)/i;
  for (var guard = 0; guard < 8; guard++) {
    var t = s.replace(FILLER, '').trim();
    if (!t || t === s) break;
    s = t;
  }
  // Atajos: «barra look», «comando inventario», «slash where» → /look, /inventory, /where.
  var CMD = /^(?:barra|comando|slash|\/)\s*([a-záéíóúüñ]+)[\s.,;:!?¡¿…]*$/i;
  var ALIAS = {
    look: ['look', 'luk', 'luc', 'luke', 'lu', 'mirar', 'mira', 'ver'],
    where: ['where', 'guer', 'güer', 'huer', 'wer', 'donde', 'dónde'],
    who: ['who', 'ju', 'hu', 'quien', 'quién', 'quienes', 'quiénes'],
    inventory: ['inventory', 'inventario', 'inventori'],
    recap: ['recap', 'ricap', 'resumen'],
    time: ['time', 'taim', 'hora', 'tiempo'],
    tablon: ['tablon', 'tablón'],
    progress: ['progress', 'progreso'],
  };
  var m = CMD.exec(s);
  if (m) {
    var word = m[1].toLowerCase();
    for (var cmd in ALIAS) if (ALIAS[cmd].indexOf(word) >= 0) return '/' + cmd;
    return '/' + word.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  // «tira los dados» → «tirar», que el chat ya entiende como tirada.
  if (/^(?:tira|tirar|tiro|roll)(?: (?:los |el |un )?dados?)?[\s.!¡]*$/i.test(s)) return 'tirar';
  // Mayúscula en la primera letra (saltando ¿ ¡ « y comillas).
  var i = s.search(/[a-záéíóúüñ]/i);
  if (i >= 0) s = s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
  return s;
}`;

export const normalizeDictation = new Function(NORMALIZE_JS + '\nreturn normalizeDictation;')() as (raw: string) => string;

export const VOICE_STYLE = String.raw`
  /* Dictado: micrófono de vidrio dentro del cuadro de acción; escuchando, se enciende con un pulso discreto. */
  form .mic { flex: none; width: 44px; height: 44px; margin: -4px 0; border-radius: 50%; background: transparent; color: var(--muted); box-shadow: none; transition: color .2s, background .2s; }
  form .mic:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  form .mic svg.i { width: 18px; height: 18px; }
  form .mic.on { background: rgba(224,90,74,.18); color: var(--rec); animation: mic-pulse 1.6s ease-out infinite; }
  @keyframes mic-pulse { 0% { box-shadow: 0 0 0 0 rgba(224,90,74,.45); } 100% { box-shadow: 0 0 0 12px rgba(224,90,74,0); } }
  @media (prefers-reduced-motion: reduce) { form .mic.on { animation: none; box-shadow: 0 0 0 2px rgba(224,90,74,.5); } }
  #input.voice-interim { color: var(--muted); font-style: italic; }
  .chips .voice-auto { font-family: var(--sans); }
  .chips .voice-auto[aria-pressed="true"] { color: var(--accent); background: var(--accent-tint); }
`;

export const VOICE_SCRIPT = String.raw`<script>
(function () {
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var form = document.getElementById('form'), input = document.getElementById('input'), log = document.getElementById('log');
  if (!Rec || !form || !input) return;
  ${NORMALIZE_JS}
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // Idioma: el de la campaña si la API lo da (language: 'es' | 'en' | 'es-MX'…); si no, el de la página.
  var LOCALE = { es: 'es-ES', en: 'en-US' };
  function locale(l) { l = String(l || '').trim(); return l.indexOf('-') > 0 ? l : (LOCALE[l.toLowerCase()] || 'es-ES'); }
  var lang = locale(document.documentElement.getAttribute('data-voice-lang') || document.documentElement.lang);
  var game = new URLSearchParams(location.search).get('game');
  fetch('/api/games').then(function (r) { return r.json(); }).then(function (d) {
    var g = (d.games || []).filter(function (x) { return x.slug === game; })[0];
    var l = g && (g.language || (g.campaign && g.campaign.language));
    if (l) lang = locale(l);
  }).catch(function () {});

  var MIC = '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
  var mic = document.createElement('button');
  mic.type = 'button'; mic.className = 'mic'; mic.innerHTML = MIC;
  form.insertBefore(mic, form.querySelector('button[type=submit]'));

  // Ajuste «enviar al terminar de hablar»: una pastilla al final de los atajos.
  var auto = store('tavernus.voice.autosend') === '1';
  var chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'voice-auto'; chip.textContent = 'Voz: enviar al terminar';
  chip.title = 'Al dejar de hablar, envía lo dictado sin esperar a que lo revises';
  var chips = document.querySelector('.chips');
  if (chips) chips.appendChild(chip);
  function paint() {
    chip.setAttribute('aria-pressed', auto ? 'true' : 'false');
    mic.setAttribute('aria-pressed', rec ? 'true' : 'false');
    mic.classList.toggle('on', !!rec);
    mic.title = rec ? 'Escuchando… toca para terminar' : 'Dictar la acción';
    mic.setAttribute('aria-label', rec ? 'Dejar de escuchar' : 'Dictar la acción');
  }
  chip.addEventListener('click', function () { auto = !auto; store('tavernus.voice.autosend', auto ? '1' : '0'); paint(); });

  var lastNote = '';
  /** Aviso corto dentro del chat, con la misma burbuja que los mensajes del sistema. */
  function note(text) {
    if (!log || text === lastNote) return;
    lastNote = text;
    var div = document.createElement('div');
    div.className = 'msg system voice-note';
    var body = document.createElement('div');
    body.className = 'body'; body.textContent = text;
    div.appendChild(body); log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  var ERRORS = {
    'not-allowed': 'Sin permiso para el micrófono. Actívalo en los ajustes del sitio del navegador para dictar.',
    'service-not-allowed': 'El dictado está desactivado en este dispositivo (en iPhone: Ajustes › General › Teclado › Dictado).',
    'audio-capture': 'No encuentro ningún micrófono.',
    'network': 'El dictado del navegador necesita conexión a internet.',
    'language-not-supported': 'El navegador no sabe dictar en este idioma.',
  };

  var rec = null, base = '', heard = '';
  function start() {
    if (!window.isSecureContext) { note('El dictado solo funciona con https (o en localhost).'); return; }
    var r;
    try { r = new (window.SpeechRecognition || window.webkitSpeechRecognition)(); } catch (e) { return; }
    rec = r; heard = ''; lastNote = '';
    base = input.value.trim();
    r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    r.onresult = function (ev) {
      var fin = '', tmp = '';
      for (var i = 0; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fin += t; else tmp += t;
      }
      heard = (fin + tmp).trim();
      input.value = (base ? base + ' ' : '') + heard;
      input.classList.toggle('voice-interim', !!tmp);
    };
    r.onerror = function (ev) { if (ERRORS[ev.error]) note(ERRORS[ev.error]); };
    r.onend = function () { if (rec === r) finish(); };
    try { r.start(); } catch (e) { rec = null; }
    paint();
  }
  function finish() {
    rec = null;
    input.classList.remove('voice-interim');
    paint();
    if (!heard) { input.value = base; return; }
    var said = normalizeDictation(heard);
    input.value = base ? base + ' ' + said : said;
    heard = '';
    if (auto && input.value.trim()) {
      if (form.requestSubmit) form.requestSubmit(); else form.querySelector('button[type=submit]').click();
    } else {
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    }
  }
  // El toque del jugador arranca el reconocimiento directamente: Safari iOS y Chrome Android lo exigen para pedir el micrófono.
  mic.addEventListener('click', function () { if (rec) rec.stop(); else start(); });
  // Si escribe a mano mientras escucha, manda el teclado.
  input.addEventListener('keydown', function () { if (rec) { var r = rec; rec = null; heard = ''; r.abort(); input.classList.remove('voice-interim'); paint(); } });
  paint();
})();
</script>`;
