/**
 * Narrador de voz de la web: un altavoz en cada narración del máster que la lee en alto, el ajuste
 * «leer automáticamente» que encadena las nuevas, y un botón de parar.
 *
 * Dos modos, según TTS_PROVIDER (src/ai/narrator.ts):
 *   - browser (por defecto): speechSynthesis del navegador, sin servidor ni coste; elige la mejor voz
 *     en castellano que haya y la recuerda. El diálogo va con otra voz (o, si solo hay una, otro tono).
 *   - nube (azure): POST /api/tts?game=SLUG {parts: [{text, role, speaker}]} devuelve la narración en un
 *     solo audio (narrador y personajes con voces distintas), cacheado por hash en
 *     data/games/<slug>/audio; se reproduce con <audio> y Media Session, que sigue sonando con la
 *     pantalla apagada mejor que speechSynthesis.
 *
 * page.ts solo interpola TTS_STYLE dentro de su <style>, TTS_SCRIPT tras su <script> y llama a
 * TavernusTTS.attach / .fresh al pintar un mensaje; server.ts manda /api/tts* a handleTtsRequest.
 * La limpieza del texto (src/ai/speech.ts) se incrusta tal cual con toString(): la misma en los tests.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameManager } from '../../games/manager.js';
import { NarratorOutOfCredits, narratorFromEnv, type NarratorProvider, type SpeechRequest, type SpeechRole } from '../../ai/narrator.js';
import { audioTaggerFromEnv, type AudioTagger } from '../../ai/audiotags.js';
import { speechChunks, speechMarkup, speechParts, speechText } from '../../ai/speech.js';

/** Las funciones de speech.ts como fuente JS para la página. `__name` lo añade tsx (keepNames) y aquí no existe. */
export const TTS_SHARED = [
  'var __name = function (f) { return f; };',
  speechMarkup.toString(), speechParts.toString(), speechText.toString(), speechChunks.toString(),
].map((s) => s.replace(/^export\s+/, '')).join('\n');

const MAX_TEXT = 3000;

let provider: NarratorProvider | null | undefined;
let providerError: string | null = null;
let sentChars = 0;
let tagger: AudioTagger | null | undefined;
/** El proveedor con cada modelo que el jugador ha elegido en la página. */
const variants = new Map<string, NarratorProvider>();
/** Sin créditos en el proveedor: hasta entonces (ms) ni se le pide audio y la página usa la voz del navegador. */
let noCreditsUntil = 0;
const NO_CREDITS_RETRY_MS = 30 * 60_000;

function current(): NarratorProvider | null {
  if (provider !== undefined) return provider;
  try { provider = narratorFromEnv(process.env); } catch (e) {
    provider = null;
    providerError = (e as Error).message;
    console.error('[tts]', providerError, '— se usa la voz del navegador.');
  }
  return provider;
}

/** El proveedor con el modelo pedido, si es uno de los que ofrece; si no, el de la partida. */
function withModel(p: NarratorProvider, model: unknown): NarratorProvider {
  if (typeof model !== 'string' || !p.withModel || !p.models?.some((m) => m.id === model) || p.models[0]!.id === model) return p;
  let v = variants.get(model);
  if (!v) { v = p.withModel(model); variants.set(model, v); }
  return v;
}

/** Acotaciones de voz solo si el proveedor las entiende (Eleven v3). */
function currentTagger(p: NarratorProvider): AudioTagger | null {
  if (!p.audioTags) return null;
  if (tagger === undefined) {
    tagger = audioTaggerFromEnv(process.env);
    if (tagger) console.log(`[tts] acotaciones de voz con ${tagger.model}`);
  }
  return tagger;
}

/** Para los tests: otro proveedor (o ninguno) y otro etiquetador sin tocar el entorno. */
export function setNarratorForTests(p: NarratorProvider | null | undefined, t: AudioTagger | null = null): void {
  provider = p; providerError = null; sentChars = 0; tagger = p === undefined ? undefined : t; noCreditsUntil = 0; variants.clear();
}

/**
 *   GET  /api/tts/config               {provider, label}: 'browser' si la voz la pone el navegador
 *   POST /api/tts?game=SLUG            {parts: [{text, role, speaker}]} → audio (mp3), cacheado en <partida>/audio
 */
export async function handleTtsRequest(req: IncomingMessage, res: ServerResponse, url: URL, games: GameManager): Promise<void> {
  const p = current();
  const broke = !!p && Date.now() < noCreditsUntil;
  if (req.method === 'GET' && url.pathname === '/api/tts/config') {
    if (p && broke) { json(res, 200, { provider: 'browser', label: 'Voz del navegador', error: `${p.label} sin créditos: de momento, voz del navegador.` }); return; }
    json(res, 200, { provider: p ? p.id : 'browser', label: p ? p.label : 'Voz del navegador', ...(p?.models ? { models: p.models } : {}), ...(providerError ? { error: providerError } : {}) });
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/api/tts') { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
  if (!p) { json(res, 409, { ok: false, text: 'TTS_PROVIDER=browser: la voz la pone el navegador.' }); return; }
  if (broke) { json(res, 402, { ok: false, code: 'no_credits', text: `${p.label} sin créditos.` }); return; }
  const slug = url.searchParams.get('game');
  const m = slug ? await games.get(slug) : null;
  if (!m) { json(res, 404, { ok: false, text: 'No existe esa partida.' }); return; }
  const body = await readJson(req);
  const parts = partsOf(body);
  const chars = parts.reduce((n, x) => n + x.text.length, 0);
  if (!parts.length || chars > MAX_TEXT) { json(res, 400, { ok: false, text: `Texto vacío o de más de ${MAX_TEXT} caracteres.` }); return; }
  const v = withModel(p, body['model']);
  const tags = currentTagger(v);
  // La clave sale del texto original: lo ya generado se sirve sin volver a etiquetar.
  const key = createHash('sha256').update(v.id + (tags ? `\ntags:${tags.model}` : '') + parts.map((x) => `\n${v.voiceFor(x)}\n${x.text}`).join('')).digest('hex').slice(0, 32);
  const dir = join(games.paths(m).dir, 'audio');
  const file = join(dir, `${key}.${v.ext}`);
  let bytes: Buffer | null = await readFile(file).catch(() => null);
  if (!bytes) {
    const limit = Number(process.env['TTS_MAX_CHARS'] ?? 200_000);
    if (sentChars + chars > limit) { json(res, 429, { ok: false, text: `Límite TTS_MAX_CHARS (${limit}) alcanzado en este arranque.` }); return; }
    sentChars += chars;
    try { bytes = await v.synthesize(tags ? await tags.tag(parts) : parts); } catch (e) {
      console.error('[tts]', (e as Error).message);
      if (e instanceof NarratorOutOfCredits) {
        noCreditsUntil = Date.now() + NO_CREDITS_RETRY_MS;
        json(res, 402, { ok: false, code: 'no_credits', text: `${p.label} sin créditos.` });
        return;
      }
      json(res, 502, { ok: false, text: 'El proveedor de voz no responde.' });
      return;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
  }
  res.writeHead(200, { 'content-type': v.contentType, 'content-length': bytes.length, 'cache-control': 'private, max-age=86400' });
  res.end(bytes);
}

/** {parts: [{text, role, speaker}]} o un solo {text, role, speaker}; como mucho 50 trozos. */
function partsOf(body: Record<string, unknown>): SpeechRequest[] {
  const list = Array.isArray(body['parts']) ? (body['parts'] as unknown[]) : [body];
  const out: SpeechRequest[] = [];
  for (const raw of list.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r['text'] === 'string' ? r['text'].replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    const role: SpeechRole = r['role'] === 'dialogue' ? 'dialogue' : 'narrator';
    out.push({ text, role, speaker: typeof r['speaker'] === 'string' ? r['speaker'].slice(0, 80) : null });
  }
  return out;
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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

export const TTS_STYLE = String.raw`
  /* Narrador de voz: altavoz en el rótulo de cada narración y controles en la cabecera del chat. */
  /* Escuchar una narración: se pulsa el avatar del bocadillo; mientras lee, el avatar late en ámbar. */
  .msg.tts-able > .nv-av { cursor: pointer; transition: box-shadow .2s, transform .15s; }
  .msg.tts-able > .nv-av:hover, .msg.tts-able > .nv-av:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent), 0 0 0 5px var(--accent-tint); }
  .msg.tts-able > .nv-av:active { transform: scale(.94); }
  /* Mientras habla, el borde ámbar del avatar late con la voz: --lvl (0-1) lo mueve el script con cada palabra
     (voz del navegador) o con el volumen real del audio (voz en la nube). */
  .msg .nv-av.tts-voice, .msg.tts-able > .nv-av.tts-voice:hover { --lvl: 0; box-shadow: 0 0 0 2px var(--accent), 0 0 0 calc(2px + var(--lvl) * 9px) rgba(233,169,78, calc(.12 + var(--lvl) * .38)); transition: none; }
  @media (prefers-reduced-motion: reduce) { .nv-av.tts-voice { box-shadow: 0 0 0 2px var(--accent); } }
  .msg .who .tts-say { margin-left: auto; display: grid; place-items: center; width: 28px; height: 28px; margin-top: -6px; margin-bottom: -6px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--muted); }
  .msg .who .tts-say:hover { background: var(--hover); color: var(--text); }
  .msg.tts-on .who .tts-say { color: var(--accent); background: var(--accent-tint); }
  .msg.tts-on .body { box-shadow: inset 0 0 0 1.5px rgba(233,169,78,.45); }
  .tts-say .bars, .tts-stop .bars { display: none; }
  .msg.tts-on .tts-say .spk { display: none; }
  .msg.tts-on .tts-say .bars, .tts-stop .bars { display: flex; }
  .tts-bars i { transform-origin: 50% 100%; animation: tts-eq 1s ease-in-out infinite; }
  .tts-bars i:nth-child(2) { animation-delay: -.3s; } .tts-bars i:nth-child(3) { animation-delay: -.6s; }
  @keyframes tts-eq { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
  @media (prefers-reduced-motion: reduce) { .tts-bars i { animation: none; } }
  .tts-bars { display: flex; align-items: flex-end; gap: 2px; height: 12px; }
  .tts-bars i { display: block; width: 3px; height: 12px; border-radius: 1px; background: currentColor; }
  .chat-head .tts { margin-left: auto; position: relative; display: flex; align-items: center; gap: 6px; flex: none; }
  .tts > button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--control); color: var(--muted); font-size: 12px; font-weight: 500; white-space: nowrap; }
  .tts > button:hover { background: var(--hover); color: var(--text); }
  .tts > button.on { background: var(--accent-tint); color: var(--accent); }
  .tts > .tts-stop { color: var(--accent-ink); background: var(--accent); }
  .tts > .tts-stop:hover { background: var(--glow); color: var(--accent-ink); }
  .tts > .tts-stop[hidden] { display: none; }
  .tts > .tts-more { width: 32px; padding: 0; justify-content: center; }
  .tts-pop { position: absolute; top: 40px; right: 0; z-index: 30; width: 280px; padding: 14px; border-radius: 22px; background: rgba(28,29,35,.94); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); box-shadow: var(--window-shadow); font-size: 13px; }
  .tts-pop[hidden] { display: none; }
  .tts-pop label { display: block; margin: 0 0 10px; color: var(--muted); font-size: 12px; font-weight: 500; }
  .tts-pop label.row { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; }
  .tts-pop [hidden], .sfx-pop [hidden] { display: none !important; }
  /* Controles con la piel de la aplicación (también en el panel de sonido): desplegable propio, interruptores y
     deslizador dorado con lo recorrido relleno (--p lo pone el script). */
  .tts-pop select { display: none; }
  .tts-sel { position: relative; margin-top: 6px; }
  .tts-sel > button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--control); color: var(--text); font-size: 13px; text-align: left; }
  .tts-sel > button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tts-sel > button svg { width: 14px; height: 14px; flex: none; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform .15s ease; }
  .tts-sel > button[aria-expanded=true] { border-color: rgba(230,183,90,.55); }
  .tts-sel > button[aria-expanded=true] svg { transform: rotate(180deg); }
  .tts-sel > div { position: absolute; top: 42px; left: 0; right: 0; z-index: 2; display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow-y: auto; padding: 6px; border-radius: 12px; background: rgba(20,21,24,.97); box-shadow: 0 12px 28px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.08); }
  .tts-sel > div[hidden] { display: none; }
  .tts-sel > div button { min-height: 34px; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 13px; text-align: left; }
  .tts-sel > div button:hover, .tts-sel > div button:focus-visible { outline: none; background: rgba(255,255,255,.07); }
  .tts-sel > div button.on { background: var(--accent-tint); color: var(--accent); }
  .tts-pop input[type=checkbox], .sfx-pop input[type=checkbox] { -webkit-appearance: none; appearance: none; position: relative; flex: none; width: 34px; height: 20px; margin: 0; border-radius: 999px; background: rgba(255,255,255,.14); cursor: pointer; transition: background .15s ease; }
  .tts-pop input[type=checkbox]::before, .sfx-pop input[type=checkbox]::before { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #e9e4dc; box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: transform .15s ease; }
  .tts-pop input[type=checkbox]:checked, .sfx-pop input[type=checkbox]:checked { background: var(--accent); }
  .tts-pop input[type=checkbox]:checked::before, .sfx-pop input[type=checkbox]:checked::before { transform: translateX(14px); background: #fff8ea; }
  .tts-pop input[type=checkbox]:focus-visible, .sfx-pop input[type=checkbox]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tts-pop label.row, .sfx-pop label.row { gap: 10px; line-height: 1.35; }
  .tts-pop input[type=range], .sfx-pop input[type=range] { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 4px; margin: 12px 0 6px; border-radius: 999px; cursor: pointer;
    background: linear-gradient(var(--accent), var(--accent)) 0 0 / var(--p, 50%) 100% no-repeat, rgba(255,255,255,.14); }
  .tts-pop input[type=range]::-webkit-slider-thumb, .sfx-pop input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff8ea; box-shadow: 0 0 0 3px rgba(230,183,90,.35), 0 1px 3px rgba(0,0,0,.5); }
  .tts-pop input[type=range]::-moz-range-thumb, .sfx-pop input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border: 0; border-radius: 50%; background: #fff8ea; box-shadow: 0 0 0 3px rgba(230,183,90,.35), 0 1px 3px rgba(0,0,0,.5); }
  .tts-pop .note { margin: 6px 0 0; color: var(--faint); font-size: 11.5px; line-height: 1.4; }
  .tts-pop .note:empty { display: none; }
  .tts-hint { align-self: center; padding: 6px 12px; border-radius: 12px; background: var(--platter); color: var(--muted); font-size: 12.5px; }
  @media (max-width: 820px) {
    .tts > .tts-auto span { display: none; }
    .tts > button { padding: 0 10px; }
  }
`;

const SPEAKER_ICON = '<svg class="i spk" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const BARS = '<span class="tts-bars bars"><i></i><i></i><i></i></span>';

export const TTS_SCRIPT = String.raw`<script>
(function () {
  var log = document.getElementById('log');
  if (!log) return;
  ${TTS_SHARED}
  var params = new URLSearchParams(location.search), game = params.get('game');
  var synth = window.speechSynthesis || null;
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  var SPEAKER = '${SPEAKER_ICON}', BARS = '${BARS}';

  var provider = 'browser', providerLabel = 'Voz del navegador';
  // Modelos de la nube que se pueden elegir (ElevenLabs v3 / v2); el primero es el de la partida.
  var models = [];
  function cloudModel() { var m = store('tavernus.tts.model'); return models.some(function (x) { return x.id === m; }) ? m : (models[0] ? models[0].id : ''); }
  /** Lee la voz de la nube (ElevenLabs…) si el servidor la tiene y no se ha elegido una del navegador en el selector. */
  function cloud() { return provider !== 'browser' && store('tavernus.tts.engine') !== 'browser'; }
  var auto = store('tavernus.tts.auto') === '1';
  var rate = Number(store('tavernus.tts.rate')) || 1;
  // Volumen de la voz: 75 % de partida, por encima del ambiente (50 %) y de la música (25 %) de sfx.ts.
  var vol = (function (v) { var n = Number(v); return v === null || v === '' || !isFinite(n) ? 0.75 : Math.max(0, Math.min(1, n)); })(store('tavernus.tts.volume'));
  var awake = store('tavernus.tts.awake') === '1';
  var queue = [];          // divs de narraciones pendientes
  // --- El borde del avatar late con la voz ------------------------------------------------------------
  var voiceAv = null, clickedAv = null, lvl = 0, lastBeat = 0, raf = null, analyser = null, actx = null, abuf = null, vgain = null;
  /** El avatar que late: el que se pulsó o, si no, el visible más cercano de esa narración (las agrupadas no lo muestran). */
  function avatarFor(div) {
    var n = div;
    while (n && n.classList.contains('cont')) n = n.previousElementSibling;
    return n && n.classList.contains('row') ? n.querySelector('.nv-av') : null;
  }
  function setVoiceAv(av) {
    if (voiceAv === av) return;
    if (voiceAv) { voiceAv.classList.remove('tts-voice'); voiceAv.style.removeProperty('--lvl'); }
    voiceAv = av;
    if (av) av.classList.add('tts-voice');
  }
  /** Un golpe de voz (una palabra): el borde salta y se va apagando. */
  function beat(v) { lvl = Math.max(lvl, v); lastBeat = Date.now(); }
  function pulseLoop() {
    raf = null;
    if (!playing || !voiceAv) return;
    if (analyser) {
      analyser.getByteTimeDomainData(abuf);
      var sum = 0;
      for (var i = 0; i < abuf.length; i++) { var x = (abuf[i] - 128) / 128; sum += x * x; }
      beat(Math.min(1, Math.sqrt(sum / abuf.length) * 4.5));
    } else if (Date.now() - lastBeat > 380) {
      // La voz no avisa de las palabras: un ritmo de habla parecido.
      beat(.45 + Math.random() * .45);
    }
    lvl *= .86;
    voiceAv.style.setProperty('--lvl', lvl.toFixed(3));
    raf = requestAnimationFrame(pulseLoop);
  }
  function startPulse() { if (!raf) raf = requestAnimationFrame(pulseLoop); }
  /** Voz en la nube: el volumen real del <audio> con un analizador (se crea dentro de un gesto, en unlock). */
  function hookAnalyser() {
    if (analyser || !audio) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
      var src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser(); analyser.fftSize = 512;
      abuf = new Uint8Array(analyser.fftSize);
      // El analizador mide la voz antes del volumen (el pulso del avatar no cambia); la ganancia sí funciona en iOS.
      vgain = actx.createGain(); vgain.gain.value = vol;
      src.connect(analyser); analyser.connect(vgain); vgain.connect(actx.destination);
      audio.volume = 1;
    } catch (e) { analyser = null; vgain = null; }
  }
  var playing = null;      // { div, steps, i }
  var justAttached = null; // la que acaba de pintarse (para «leer automáticamente»)
  var audio = null, prefetch = null, lock = null;

  /* ---------- Voces del navegador ---------- */
  var FEMALE = /elvira|ximena|abril|helena|laura|m[oó]nica|paulina|sabina|luc[ií]a|irene|esperanza|triana|vera|estrella|arabella|isabella|marisol|paloma|dalia|larissa|francisca|camila|elena|catalina|valentina|salom[eé]|marta|carmen|conchita|soledad|ana\b|ines|in[eé]s|female|mujer/i;
  var MALE = /[aá]lvaro|pablo|jorge|juan|diego|carlos|ra[uú]l|arnau|dar[ií]o|el[ií]as|\bnil\b|sa[uú]l|teo\b|tom[aá]s|gerardo|enrique|alonso|lorenzo|rodrigo|trist[aá]n|andr[eé]s|enrique|male|hombre/i;
  function gender(v) { return FEMALE.test(v.name) ? 'f' : MALE.test(v.name) ? 'm' : '?'; }
  function spanish() { return synth ? synth.getVoices().filter(function (v) { return /^es([-_]|$)/i.test(v.lang); }) : []; }
  function score(v) {
    var n = v.name, s = /^es[-_]ES/i.test(v.lang) ? 30 : 10;
    if (/natural|neural/i.test(n)) s += 60;           // Edge: voces neuronales de Azure
    if (/google/i.test(n)) s += 35;                    // Chrome: voces en línea de Google
    if (/premium|enhanced|mejorad|siri/i.test(n)) s += 45; // Safari: voces mejoradas
    if (/online/i.test(n)) s += 10;
    if (/compact|eloquence|grandma|grandpa|abuel|rocko|shelley|flo\b|reed|sandy|eddy/i.test(n)) s -= 40;
    return s;
  }
  function ranked() { return spanish().sort(function (a, b) { return score(b) - score(a); }); }
  function byURI(uri) { return spanish().filter(function (v) { return v.voiceURI === uri; })[0] || null; }
  function narratorVoice() { return byURI(store('tavernus.tts.voice')) || ranked()[0] || null; }
  /** Voz de los personajes: la elegida, o la mejor de otro género que el narrador; cada hablante, siempre la misma. */
  function npcVoices() {
    var chosen = byURI(store('tavernus.tts.npcvoice'));
    if (chosen) return [chosen];
    var nv = narratorVoice(), list = ranked().filter(function (v) { return v !== nv && score(v) >= score(nv || v) - 40; });
    var other = list.filter(function (v) { return nv && gender(v) !== gender(nv) && gender(v) !== '?'; });
    return (other.length ? other.concat(list.filter(function (v) { return other.indexOf(v) < 0; })) : list).slice(0, 4);
  }
  /** Cada hablante, por orden de aparición, toma la siguiente voz libre; acabadas las voces, la misma con otro tono. */
  var speakers = {}, nSpeakers = 0;
  var PITCH = [1, 0.85, 1.18, 0.92, 1.1, 0.8, 1.25];
  function voiceFor(step) {
    if (step.kind === 'narrator') return { voice: narratorVoice(), pitch: 1 };
    var key = step.speaker || '?';
    if (!(key in speakers)) speakers[key] = nSpeakers++;
    var n = speakers[key], pool = npcVoices();
    if (!pool.length) return { voice: narratorVoice(), pitch: PITCH[(n + 1) % PITCH.length] };
    return { voice: pool[n % pool.length], pitch: PITCH[Math.floor(n / pool.length) % PITCH.length] };
  }

  /* ---------- Cola de lectura ---------- */
  /** En el navegador, frases cortas (Chrome corta a los ~15 s); en la nube, la narración entera en un solo audio. */
  function stepsOf(div, read) {
    // m.speech: el turno tal como se pinta en el hilo (bloques de novel.ts, en orden); si no, la narración.
    // read: solo la parte de una burbuja (al pulsar su avatar), con las líneas del turno para saber quién habla.
    var m = read || div.ttsMsg, parts = speechParts(m.speech || m.text, m.lines), steps = [];
    if (cloud()) return [{ cloud: parts.map(function (p) { return { text: p.text, role: p.kind, speaker: p.speaker }; }) }];
    parts.forEach(function (p) { speechChunks(p.text, 200).forEach(function (c) { steps.push({ kind: p.kind, speaker: p.speaker, text: c }); }); });
    return steps;
  }
  function speak(div) { stop(); queue = [div]; next(); }
  /** Solo lo que dice una burbuja (y las suyas seguidas): se marca en la burbuja y next() lo recoge. */
  function speakOwn(row, read) { stop(); row.ttsOnce = read; queue = [row]; next(); }
  function enqueue(div) {
    if (queue.indexOf(div) < 0 && (!playing || playing.div !== div)) queue.push(div);
    if (!playing) next(); else if (cloud()) audioFor(div);
  }
  function next() {
    if (playing) playing.div.classList.remove('tts-on');
    playing = null;
    while (queue.length && !document.body.contains(queue[0])) queue.shift();
    var div = queue.shift();
    if (!div) { setVoiceAv(null); clickedAv = null; ui(); release(); return; }
    var read = div.ttsOnce || null;
    delete div.ttsOnce;
    playing = { div: div, read: read, steps: stepsOf(div, read), i: 0 };
    div.classList.add('tts-on');
    setVoiceAv(clickedAv && document.body.contains(clickedAv) ? clickedAv : avatarFor(div));
    lvl = 0; lastBeat = Date.now(); startPulse();
    ui(); keepAwake();
    if (div.getBoundingClientRect().top > log.getBoundingClientRect().bottom || div.getBoundingClientRect().bottom < log.getBoundingClientRect().top) div.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    step();
  }
  function step() {
    var p = playing;
    if (!p) return;
    if (p.i >= p.steps.length) { next(); return; }
    var s = p.steps[p.i++];
    if (cloud()) sayCloud(s, p); else sayBrowser(s, p);
  }
  function stop() {
    queue = [];
    var p = playing;
    playing = null;
    if (p) p.div.classList.remove('tts-on');
    setVoiceAv(null); clickedAv = null;
    if (synth) synth.cancel();
    if (audio) { audio.pause(); audio.removeAttribute('src'); }
    prefetch = null;
    ui(); release();
  }

  function sayBrowser(s, p) {
    if (!synth) { hint('Este navegador no puede leer en alto.'); stop(); return; }
    var u = new SpeechSynthesisUtterance(s.text), v = voiceFor(s);
    if (v.voice) { u.voice = v.voice; u.lang = v.voice.lang; } else u.lang = 'es-ES';
    u.pitch = v.pitch; u.rate = rate; u.volume = vol;
    u.onend = function () { if (playing === p) step(); };
    u.onboundary = function (e) { if (playing === p && (!e.name || e.name === 'word')) beat(.75 + Math.random() * .25); };
    u.onerror = function (e) {
      if (playing !== p) return;
      if (e.error === 'not-allowed') { hint('Toca la página una vez para que el navegador deje leer en alto.'); stop(); return; }
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      step();
    };
    if (synth.paused) synth.resume();
    synth.speak(u);
  }

  /** Audio de una narración (pedido una vez: la siguiente de la cola se pide mientras suena la actual). */
  function audioFor(div, read) {
    read = read || null;
    if (prefetch && prefetch.div === div && prefetch.read === read) return prefetch.blob;
    var parts = stepsOf(div, read)[0].cloud;
    var blob = fetch('/api/tts?game=' + encodeURIComponent(game), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts: parts, model: cloudModel() || undefined }) })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.blob(); });
    blob.catch(function () {});
    prefetch = { div: div, read: read, blob: blob };
    return blob;
  }
  function sayCloud(s, p) {
    if (!audio) {
      audio = new Audio();
      audio.addEventListener('ended', function () { if (playing) step(); });
    }
    var got = audioFor(p.div, p.read);
    if (queue[0]) audioFor(queue[0]);
    got.then(function (blob) {
      if (playing !== p) return;
      if (audio.src) URL.revokeObjectURL(audio.src);
      audio.src = URL.createObjectURL(blob);
      audio.playbackRate = rate;
      applyVolume();
      mediaSession();
      hookAnalyser();
      if (actx && actx.state === 'suspended') actx.resume();
      return audio.play();
    }).catch(function (e) {
      if (playing !== p) return;
      if (e && e.name === 'NotAllowedError') { hint('Toca la página una vez para que el navegador deje reproducir audio.'); stop(); return; }
      // La nube falla (o se queda sin créditos): esta narración y las siguientes, con la voz del navegador.
      hint(e && e.message === '402' ? 'El narrador de voz se ha quedado sin créditos; sigo con la voz del navegador.' : 'El narrador de voz no responde; sigo con la voz del navegador.');
      provider = 'browser'; fillVoices();
      p.steps = stepsOf(p.div, p.read); p.i = 0;
      step();
    });
  }
  function mediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Narración del máster', artist: 'Tavernus', album: document.title });
    try {
      navigator.mediaSession.setActionHandler('pause', stop);
      navigator.mediaSession.setActionHandler('stop', stop);
      navigator.mediaSession.setActionHandler('nexttrack', function () { if (playing) next(); });
    } catch (e) {}
  }

  /* Pantalla encendida mientras lee (opcional): la forma segura de que el móvil no corte la voz del navegador. */
  function keepAwake() {
    if (!awake || lock || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {});
  }
  function release() { if (lock && !auto) { lock.release().catch(function () {}); lock = null; } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (playing || auto)) keepAwake(); });

  /* ---------- Interfaz ---------- */
  var hintTimer = null;
  function hint(text) {
    var h = document.querySelector('.tts-hint');
    if (!h) { h = document.createElement('div'); h.className = 'tts-hint'; log.appendChild(h); }
    h.textContent = text;
    log.scrollTop = log.scrollHeight;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { if (h.parentNode) h.remove(); }, 8000);
  }
  var head = document.querySelector('.chat-head'), box = document.createElement('div');
  box.className = 'tts';
  box.innerHTML =
    '<button type="button" class="tts-stop" hidden title="Parar la lectura" aria-label="Parar la lectura">' + BARS + 'Parar</button>' +
    '<button type="button" class="tts-auto" aria-pressed="false" title="Leer en alto cada narración nueva">' + SPEAKER + '<span>Leer solo</span></button>' +
    '<button type="button" class="tts-more" title="Voz del narrador" aria-label="Voz del narrador" aria-expanded="false"><svg class="i" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>' +
    '<div class="tts-pop" hidden>' +
      '<label><select data-k="voice" aria-label="Voz del narrador"></select></label>' +
      '<label>Personajes<select data-k="npcvoice"></select></label>' +
      '<label>Volumen<input type="range" min="0" max="1" step="0.05" data-k="volume"></label>' +
      '<label>Velocidad <b class="rate"></b><input type="range" min="0.7" max="1.5" step="0.05" data-k="rate"></label>' +
      '<label class="row"><input type="checkbox" data-k="auto">Leer automáticamente las narraciones nuevas</label>' +
      '<label class="row"><input type="checkbox" data-k="awake">Mantener la pantalla encendida mientras lee</label>' +
      '<p class="note"></p>' +
    '</div>';
  if (head) head.appendChild(box); else return;
  var stopBtn = box.querySelector('.tts-stop'), autoBtn = box.querySelector('.tts-auto'), moreBtn = box.querySelector('.tts-more'), pop = box.querySelector('.tts-pop');

  function ui() {
    stopBtn.hidden = !playing;
    autoBtn.classList.toggle('on', auto);
    autoBtn.setAttribute('aria-pressed', auto ? 'true' : 'false');
    pop.querySelector('[data-k=auto]').checked = auto;
  }
  function fillVoices() {
    var browser = !cloud(), list = ranked(), nv = narratorVoice();
    var opt = function (v) { return '<option value="' + v.voiceURI.replace(/"/g, '&quot;') + '">' + v.name.replace(/</g, '&lt;') + ' · ' + v.lang + '</option>'; };
    var sv = pop.querySelector('[data-k=voice]'), sn = pop.querySelector('[data-k=npcvoice]');
    // Con voz en la nube, es la primera opción (y la marcada mientras se use); las del navegador quedan como alternativa.
    var clouds = provider === 'browser' ? [] : models.length ? models : [{ id: '', label: providerLabel }];
    sv.innerHTML = clouds.map(function (m, i) { return '<option value="cloud' + (m.id ? ':' + m.id : '') + '">' + m.label.replace(/</g, '&lt;') + (i === 0 ? ' · voz de la partida' : '') + '</option>'; }).join('') +
      (list.map(opt).join('') || (provider === 'browser' ? '<option value="">Sin voces en castellano</option>' : ''));
    sn.innerHTML = '<option value="">Automática (otra voz u otro tono)</option>' + list.map(opt).join('');
    if (!browser) sv.value = 'cloud' + (cloudModel() ? ':' + cloudModel() : ''); else if (nv) sv.value = nv.voiceURI;
    sn.value = byURI(store('tavernus.tts.npcvoice')) ? store('tavernus.tts.npcvoice') : '';
    sn.closest('label').hidden = !browser;
    pop.querySelector('.rate').textContent = rate.toFixed(2).replace(/0$/, '') + '×';
    pop.querySelector('[data-k=rate]').value = String(rate);
    pop.querySelector('[data-k=volume]').value = String(vol);
    pop.querySelector('[data-k=awake]').checked = awake;
    pop.querySelector('.note').textContent = browser
      ? (list.length ? list.length + ' voces en castellano en este navegador. Las «Natural» de Edge (escritorio) son las que mejor suenan.' : 'Este navegador no ofrece voces en castellano; leerá con la voz por defecto.')
      : '';
  }
  /** Desplegable de la aplicación sobre un select (que sigue con el valor y avisa con «change»). */
  function niceSelect(sel) {
    var wrap = document.createElement('div'); wrap.className = 'tts-sel'; sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    var btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
    var menu = document.createElement('div'); menu.setAttribute('role', 'listbox'); menu.hidden = true;
    wrap.appendChild(btn); wrap.appendChild(menu);
    function show(open) {
      if (open) {
        menu.innerHTML = '';
        Array.prototype.forEach.call(sel.options, function (o, i) {
          var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'option'); b.textContent = o.text;
          if (i === sel.selectedIndex) { b.className = 'on'; b.setAttribute('aria-selected', 'true'); }
          b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); show(false); btn.focus(); });
          menu.appendChild(b);
        });
      }
      menu.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var on = menu.querySelector('.on') || menu.firstChild; if (on) { on.focus(); on.scrollIntoView({ block: 'nearest' }); } }
    }
    btn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); show(menu.hidden); });
    menu.addEventListener('keydown', function (ev) {
      var items = Array.prototype.slice.call(menu.children), i = items.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (items.length) items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      if (ev.key === 'Escape') { ev.stopPropagation(); show(false); btn.focus(); }
    });
    pop.addEventListener('click', function (ev) { if (!wrap.contains(ev.target)) show(false); });
    return function paint() { var o = sel.options[sel.selectedIndex]; btn.firstChild.textContent = o ? o.text : ''; };
  }
  var paintSelects = ['voice', 'npcvoice'].map(function (k) { return niceSelect(pop.querySelector('[data-k=' + k + ']')); });
  var baseFill = fillVoices;
  fillVoices = function () { baseFill(); paintSelects.forEach(function (f) { f(); }); paintRanges(); };
  /** Lo recorrido de cada deslizador, en dorado (aquí y en el panel de sonido). */
  function paintRanges() {
    document.querySelectorAll('.tts-pop input[type=range], .sfx-pop input[type=range]').forEach(function (r) {
      var min = Number(r.min) || 0, max = Number(r.max) || 1;
      r.style.setProperty('--p', Math.max(0, Math.min(100, (Number(r.value) - min) / (max - min) * 100)) + '%');
    });
  }
  document.addEventListener('input', function (ev) { if (ev.target.matches && ev.target.matches('input[type=range]')) paintRanges(); });
  document.addEventListener('click', function () { requestAnimationFrame(paintRanges); });
  if (synth) { fillVoices(); if (synth.addEventListener) synth.addEventListener('voiceschanged', fillVoices); else synth.onvoiceschanged = fillVoices; }

  /** iOS y Chrome solo dejan hablar tras un gesto: una locución vacía dentro del clic «desbloquea» la voz. */
  function unlock() {
    if (synth && !cloud() && !playing) { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); }
    if (cloud() && !audio) { audio = new Audio(); audio.addEventListener('ended', function () { if (playing) step(); }); }
  }
  function lastMaster() { var l = log.querySelectorAll('.msg.master'); return l.length ? l[l.length - 1] : null; }
  function setAuto(on) {
    auto = on; store('tavernus.tts.auto', on ? '1' : '0');
    if (on) { unlock(); var last = lastMaster(); if (last && !playing && last.ttsMsg) speak(last); keepAwake(); }
    else release();
    ui();
  }
  stopBtn.addEventListener('click', stop);
  autoBtn.addEventListener('click', function () { setAuto(!auto); });
  moreBtn.addEventListener('click', function (ev) { ev.stopPropagation(); pop.hidden = !pop.hidden; moreBtn.setAttribute('aria-expanded', String(!pop.hidden)); if (!pop.hidden) fillVoices(); });
  // La página puede llevar el botón y el panel a otro sitio (el engranaje del panel): se cierra al tocar fuera de los tres.
  document.addEventListener('click', function (ev) { if (!pop.hidden && !box.contains(ev.target) && !pop.contains(ev.target) && !moreBtn.contains(ev.target)) { pop.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); } });
  pop.addEventListener('change', function (ev) {
    var k = ev.target.getAttribute('data-k');
    if (k === 'voice') { if (ev.target.value.indexOf('cloud') === 0) { store('tavernus.tts.engine', 'cloud'); if (ev.target.value.length > 6) store('tavernus.tts.model', ev.target.value.slice(6)); } else { store('tavernus.tts.engine', 'browser'); store('tavernus.tts.voice', ev.target.value); } stop(); }
    if (k === 'npcvoice') store('tavernus.tts.npcvoice', ev.target.value);
    if (k === 'rate') { rate = Number(ev.target.value) || 1; store('tavernus.tts.rate', String(rate)); }
    if (k === 'auto') setAuto(ev.target.checked);
    if (k === 'awake') { awake = ev.target.checked; store('tavernus.tts.awake', awake ? '1' : '0'); if (awake && (playing || auto)) keepAwake(); else if (lock) { lock.release().catch(function () {}); lock = null; } }
    fillVoices();
  });
  /** Volumen de la voz en la nube: con la ganancia si ya pasa por la Web Audio; si no, el del <audio>. */
  function applyVolume() { if (vgain) vgain.gain.value = vol; else if (audio) audio.volume = vol; }
  pop.addEventListener('input', function (ev) {
    if (ev.target.getAttribute('data-k') !== 'volume') return;
    vol = Math.max(0, Math.min(1, Number(ev.target.value) || 0)); store('tavernus.tts.volume', String(vol)); applyVolume();
  });
  pop.addEventListener('input', function (ev) { if (ev.target.getAttribute('data-k') === 'rate') pop.querySelector('.rate').textContent = Number(ev.target.value).toFixed(2).replace(/0$/, '') + '×'; });

  // Al cambiar de personaje el chat se vacía: lo que se leía ya no está.
  new MutationObserver(function () { if (playing && !document.body.contains(playing.div)) stop(); }).observe(log, { childList: true });

  fetch('/api/tts/config').then(function (r) { return r.json(); }).then(function (c) {
    provider = c.provider || 'browser'; providerLabel = c.label || providerLabel; models = Array.isArray(c.models) ? c.models : [];
    if (provider === 'browser' && !synth) { box.hidden = true; return; }
    fillVoices();
  }).catch(function () {});
  ui();

  window.TavernusTTS = {
    /** page.ts: cada mensaje pintado. Las narraciones del máster llevan su altavoz. */
    attach: function (div, m) {
      if (!m || (m.kind !== 'master' && !m.narrator) || !m.text) return;
      div.ttsMsg = m;
      justAttached = div;
      setTimeout(function () { if (justAttached === div) justAttached = null; }, 0);
      // Los capítulos no tienen avatar: llevan el altavoz de siempre en su rótulo. El resto se escucha pulsando
      // cualquier avatar del turno (bindAvatars, que llama novel.ts).
      if (div.querySelector('.nv-av')) return;
      var who = div.querySelector('.who');
      if (!who) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tts-say'; b.title = 'Leer en alto'; b.setAttribute('aria-label', 'Leer en alto');
      b.innerHTML = SPEAKER + BARS;
      b.addEventListener('click', function () { if (playing && playing.div === div) stop(); else { unlock(); speak(div); } });
      who.appendChild(b);
    },
    /**
     * novel.ts: los bocadillos de un turno (narrador y personajes). Su avatar es el botón de escuchar: lee solo lo que
     * dice esa burbuja (row.ttsOwn) y las suyas que la siguen sin avatar, no lo de otros personajes. Si ya la está
     * leyendo, para.
     */
    bindAvatars: function (rows, div) {
      if (!div || !div.ttsMsg) return;
      rows.forEach(function (row) {
        var av = row.querySelector('.nv-av');
        if (!av || row.classList.contains('mine') || av.getAttribute('data-tts') === '1') return;
        av.setAttribute('data-tts', '1');
        row.classList.add('tts-able');
        av.setAttribute('role', 'button'); av.tabIndex = 0;
        av.title = 'Escuchar'; av.setAttribute('aria-label', 'Escuchar este momento');
        var go = function () {
          if (playing && playing.div === row) { stop(); return; }
          var said = [], who = row.getAttribute('data-who'), n = row;
          while (n && n.getAttribute('data-who') === who) { if (n.ttsOwn) said.push(n.ttsOwn); n = n.nextElementSibling; if (n && !n.classList.contains('cont')) break; }
          if (!said.length) return;
          unlock(); speakOwn(row, { speech: said.join('\n\n'), lines: div.ttsMsg.lines }); clickedAv = av; setVoiceAv(av);
        };
        av.addEventListener('click', go);
        av.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    },
    /** page.ts: llegó un mensaje en directo (no del historial). Con «leer automáticamente», a la cola. */
    fresh: function () { if (auto && justAttached) { enqueue(justAttached); justAttached = null; } },
    stop: stop,
  };
})();
</script>`;
