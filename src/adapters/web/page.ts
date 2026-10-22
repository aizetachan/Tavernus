/** Página del adaptador web: HTML, CSS y JS en un solo string para que funcione igual con tsx y con dist/. */

import { VOICE_SCRIPT, VOICE_STYLE } from './voice-input.js';
import { NOVEL_JS, NOVEL_STYLE } from './novel.js';
import { TTS_SCRIPT, TTS_STYLE } from './tts.js';
import { SFX_SCRIPT, SFX_STYLE } from './sfx.js';

export const PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavernus</title>
<style>
  /* Vidrio espacial (Figma, propuesta 4 · versión B): fondo plano, una ventana esmerilada por zona,
     vidrio solo en los controles flotantes, sin trazos; el volumen sale de la luz de arriba y la sombra. */
  :root {
    --bg: #07080b; --text: #f5f5f7; --muted: rgba(235,235,245,.62); --faint: rgba(235,235,245,.36);
    --accent: #e9a94e; --accent-ink: #1a1205; --accent-tint: rgba(233,169,78,.16); --glow: #f7c979;
    --platter: rgba(255,255,255,.045); --control: rgba(255,255,255,.08); --hover: rgba(255,255,255,.12); --sep: rgba(255,255,255,.08);
    --error: #ff453b; --ok: #30d159; --info: #63d1ff; --rec: #e05a4a;
    --line: rgba(255,255,255,.08); --panel: #121318; --panel-2: rgba(255,255,255,.08);
    --window: linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.035));
    --window-shadow: 0 48px 120px rgba(0,0,0,.42), 0 10px 30px rgba(0,0,0,.14), inset 0 1.5px 2px rgba(255,255,255,.10), inset 0 0 32px rgba(255,255,255,.025);
    --control-shadow: 0 14px 36px rgba(0,0,0,.26), 0 2px 8px rgba(0,0,0,.10), inset 0 1px 1.5px rgba(255,255,255,.12);
    --sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif;
    --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 15px/1.47 var(--sans); letter-spacing: -.01em; display: flex; flex-direction: column; -webkit-font-smoothing: antialiased; }
  select, button, input { font: inherit; color: inherit; letter-spacing: inherit; }
  button { cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  svg.i { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .glass { background: var(--control); box-shadow: var(--control-shadow); -webkit-backdrop-filter: blur(14px) saturate(1.5); backdrop-filter: blur(14px) saturate(1.5); }
  .window { background: var(--window); box-shadow: var(--window-shadow); -webkit-backdrop-filter: blur(48px) saturate(1.4); backdrop-filter: blur(48px) saturate(1.4); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* Barra superior: dos pastillas de vidrio y la hora en el centro. */
  header { position: relative; display: flex; align-items: center; gap: 12px; padding: 16px 20px 0; min-height: 60px; }
  header .bar { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 14px 0 6px; border-radius: 999px; min-width: 0; }
  header .menu { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: var(--text); text-decoration: none; background: var(--control); }
  header .menu:hover { background: var(--hover); }
  header h1 { margin: 0; font: 600 15px/1 Georgia, 'Iowan Old Style', serif; letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
  header .div { width: 1px; height: 18px; background: var(--sep); }
  #game-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 26vw; }
  .badge { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 999px; background: var(--control); color: var(--muted); font-size: 12px; font-weight: 500; white-space: nowrap; }
  .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .badge.offline { color: var(--info); } .badge.live { color: var(--ok); } .badge.record { color: var(--rec); } .badge.replay { color: var(--accent); }
  .badge[hidden] { display: none; }
  #clock { position: absolute; left: 50%; top: 21px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  #clock:empty { display: none; }
  header .spacer { flex: 1; }
  #party { display: flex; align-items: center; padding: 4px; border-radius: 999px; }
  #party:empty { display: none; }
  #party button { width: 32px; height: 32px; margin-left: -6px; border-radius: 50%; border: 0; background: #1b1c22; color: var(--muted); font-size: 12px; font-weight: 600; box-shadow: 0 0 0 2px var(--bg); }
  #party button:first-child { margin-left: 0; }
  #party button:hover { color: var(--text); }
  #party button.on { color: var(--accent); background: #2a2216; box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--accent); position: relative; z-index: 1; }

  main { flex: 1; display: flex; gap: 16px; min-height: 0; padding: 12px 20px 20px; }

  /* El chat ocupa todo el centro: una ventana, con la conversación en una columna de lectura. */
  #play { flex: 1; display: flex; flex-direction: column; min-width: 0; border-radius: 34px; overflow: hidden; }
  .chat-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px 14px; }
  .chat-head .dot { width: 40px; height: 40px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--accent-tint); color: var(--accent); }
  .chat-head .t { min-width: 0; }
  #place { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #place-sub { font-size: 12px; font-weight: 500; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  #place-sub::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }
  #place-sub:empty::before { display: none; }
  #log { flex: 1; overflow-y: auto; padding: 8px max(20px, calc((100% - 720px) / 2)) 12px; display: flex; flex-direction: column; gap: 14px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.14) transparent; }
  .msg { max-width: 560px; word-wrap: break-word; }
  .msg .body { padding: 12px 14px; border-radius: 20px; }
  .msg p { margin: 0 0 .6em; } .msg p:last-child { margin: 0; }
  .msg .who { display: flex; align-items: center; gap: 5px; margin: 0 0 6px 2px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
  .master .body { background: var(--control); border-top-left-radius: 6px; line-height: 1.53; }
  .player { align-self: flex-end; }
  .player .body { background: var(--accent); color: var(--accent-ink); border-top-right-radius: 6px; box-shadow: 0 8px 24px rgba(233,169,78,.18), inset 0 1px 1px rgba(255,255,255,.25); }
  .system .body { background: var(--platter); color: var(--muted); font: 13px/1.5 var(--mono); letter-spacing: 0; white-space: normal; }
  .msg.error .body { color: var(--error); }
  .decisive { display: inline-flex; gap: 6px; margin-top: 8px; padding: 6px 10px; border-radius: 12px; background: rgba(255,69,59,.12); color: #ff8a80; font-size: 13px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .actions button, .chips button { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--control); font-size: 13px; font-weight: 500; white-space: nowrap; }
  .actions button:hover:not(:disabled), .chips button:hover:not(:disabled) { background: var(--hover); }
  .actions button.roll { background: var(--accent); color: var(--accent-ink); font-weight: 600; box-shadow: 0 8px 24px rgba(233,169,78,.25); }
  /* Ilustración de la escena: va dentro del chat; un clic la abre en grande. */
  .msg.scene { width: 100%; margin: 0; }
  .scene .shot { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0; border: 0; border-radius: 20px; overflow: hidden; background: var(--platter); cursor: zoom-in; }
  .scene img { display: block; width: 100%; height: 100%; object-fit: cover; transition: opacity .4s; }
  .scene.loading img { opacity: 0; }
  .scene .shot::after { content: ''; position: absolute; inset: 55% 0 0; background: linear-gradient(transparent, rgba(0,0,0,.6)); pointer-events: none; }
  .scene figcaption { position: absolute; left: 18px; bottom: 16px; z-index: 1; text-align: left; }
  .scene figcaption b { display: block; font-weight: 600; }
  .scene figcaption span { font-size: 12px; font-weight: 500; color: var(--muted); }
  .scene.loading figcaption span::after { content: ' · ilustrando…'; }
  .scene .zoom { position: absolute; top: 12px; right: 12px; z-index: 1; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--text); }
  #lightbox { position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 72px 40px 40px; background: rgba(5,5,13,.6); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); }
  #lightbox[hidden] { display: none; }
  #lightbox img { max-width: min(1120px, 100%); max-height: calc(100% - 60px); border-radius: 28px; box-shadow: var(--window-shadow); }
  #lightbox .cap { display: flex; gap: 12px; align-items: baseline; font-size: 12px; font-weight: 500; color: var(--muted); }
  #lightbox .cap b { font-size: 15px; font-weight: 600; color: var(--text); }
  #lightbox .close { position: absolute; top: 32px; right: 32px; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%; color: var(--text); }
  #thinking { min-height: 0; padding: 0 max(20px, calc((100% - 720px) / 2)); color: var(--muted); font-size: 13px; }
  #thinking:not(:empty) { padding-bottom: 8px; }
  .compose { padding: 8px max(14px, calc((100% - 720px) / 2)) 16px; }
  .chips { display: flex; gap: 8px; padding-bottom: 10px; overflow-x: auto; scrollbar-width: none; }
  .chips button { font-family: var(--mono); font-size: 12px; letter-spacing: 0; color: var(--muted); }
  form { display: flex; align-items: center; gap: 8px; height: 48px; padding: 6px; border-radius: 999px; background: var(--control); box-shadow: inset 0 1px 1.5px rgba(255,255,255,.08); }
  form input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 0; background: transparent; outline: none; }
  form input::placeholder { color: var(--faint); }
  form:focus-within { box-shadow: inset 0 1px 1.5px rgba(255,255,255,.08), 0 0 0 1.5px rgba(233,169,78,.55); }
  form button { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--accent); color: var(--accent-ink); box-shadow: 0 6px 18px rgba(233,169,78,.3); }

  /* Panel lateral: una ventana con la ficha arriba y pestañas Tablero / Mapa / Hoja. */
  aside { width: 380px; flex: none; display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 34px; overflow-y: auto; scrollbar-width: none; }
  .card { padding: 16px; border-radius: 26px; background: var(--platter); }
  .card:empty { display: none; }
  .card .top { display: flex; align-items: center; gap: 12px; }
  .card .av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--accent); background: var(--accent-tint); box-shadow: inset 0 0 0 1.5px rgba(233,169,78,.6); font-size: 17px; font-weight: 600; }
  .card .name { font-size: 20px; line-height: 25px; font-weight: 600; letter-spacing: -.02em; }
  .card .sub { font-size: 12px; font-weight: 500; color: var(--muted); }
  .card .hp { margin-top: 14px; display: flex; justify-content: space-between; font-size: 12px; font-weight: 500; color: var(--muted); }
  .card .hp b { color: var(--text); font-weight: 500; }
  .card .bar { height: 6px; margin-top: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
  .card .bar i { display: block; height: 100%; border-radius: 3px; background: var(--ok); }
  .card .bar i.low { background: var(--accent); } .card .bar i.crit { background: var(--error); }
  .card .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 12px; }
  .card .stats div { padding: 8px 4px; border-radius: 14px; background: var(--platter); text-align: center; font-size: 15px; font-weight: 600; }
  .card .stats small { display: block; font-size: 11px; font-weight: 500; color: var(--faint); }
  .tabs { display: flex; padding: 3px; border-radius: 999px; background: var(--platter); }
  .tabs button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 500; }
  .tabs button:hover { color: var(--text); }
  .tabs button.on { background: var(--control); color: var(--text); box-shadow: 0 2px 8px rgba(0,0,0,.2), inset 0 1px 1px rgba(255,255,255,.1); }
  .pane { padding: 12px; border-radius: 24px; background: var(--platter); }
  .pane[hidden] { display: none; }
  .pane .none { display: none; margin: 4px; color: var(--faint); font-size: 13px; }
  .pane > div:empty + .none { display: block; }
  #sheet h2 { font-size: 15px; margin: 0 0 2px; font-weight: 600; }
  #sheet .desc { color: var(--muted); font-size: 13px; margin-bottom: 12px; white-space: pre-line; }
  #sheet .fields { display: flex; flex-wrap: wrap; gap: 8px; }
  #sheet .field { flex: 1 1 100%; padding: 10px 12px; border-radius: 14px; background: var(--platter); } #sheet .field.inline { flex: 1 1 calc(50% - 8px); }
  #sheet .field b { display: block; margin-bottom: 2px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  #sheet .field span { font-size: 13px; white-space: pre-line; }
  #sheet .footer { margin-top: 12px; font-size: 12px; color: var(--faint); }
  .where button { height: 26px; border: 0; border-radius: 999px; padding: 0 10px; background: var(--control); color: var(--muted); font-size: 12px; font-weight: 500; }
  .where button:hover { background: var(--hover); color: var(--text); }
  .where button.on { color: var(--accent-ink); background: var(--accent); }
  #board, #map { position: relative; transition: opacity .2s; }
  #board.busy, #map.busy { opacity: .45; pointer-events: none; }
  #board .where, #map .where { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 0 2px 10px; line-height: 1.3; }
  #board .where b, #map .where b { font-weight: 600; white-space: nowrap; }
  #board .where span { color: var(--muted); font-size: 12px; flex: 1; }
  #map .where span.sub { color: var(--muted); font-size: 12px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #map .where .btns { margin-left: auto; display: flex; gap: 4px; white-space: nowrap; }
  #board svg, #map svg { display: block; margin: 0 auto; background: #0c0d11; border-radius: 16px; }
  #board svg text, #map svg text { font-family: var(--sans); paint-order: stroke; stroke: #0a0a0d; stroke-width: 3px; stroke-linejoin: round; pointer-events: none; }
  #board .spot { cursor: pointer; }
  #board .spot.here { cursor: default; }
  #board .spot .hit { fill: rgba(0,0,0,.001); stroke: none; }
  #board .spot text { pointer-events: auto; }
  #board .spot:hover .label, #board .spot.here .label { fill: var(--accent); }
  #board .prop[data-spot] { cursor: pointer; }
  #board .prop[data-spot]:hover { filter: brightness(1.3); }
  #board .label { fill: var(--text); font-size: 11px; text-anchor: middle; }
  #board .who { fill: #cfcfd6; font-size: 10px; font-style: italic; text-anchor: middle; }
  #board .prop-label { fill: #cfcfd6; font-size: 10px; text-anchor: middle; font-style: italic; opacity: .85; }
  #board .token { pointer-events: none; }
  #board .token .disc { fill: #17181d; }
  #board .token text { font-weight: bold; text-anchor: middle; dominant-baseline: central; stroke-width: 0; }
  #board .token.vague { opacity: .7; } #board .token.hint { opacity: .4; }
  #board .token.vague .ring, #board .token.hint .ring { stroke-dasharray: 3 2; }
  #board .route { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 4 4; pointer-events: none; }
  #board .exit { cursor: pointer; }
  #board .exit .path { stroke: #e9e4da; stroke-width: 1.6; stroke-dasharray: 5 3; }
  #board .exit .hit { stroke: transparent; stroke-width: 16; }
  #board .exit text { fill: #e9e4da; font-size: 11px; pointer-events: auto; }
  #board .exit:hover text { fill: var(--accent); } #board .exit:hover .path { stroke: var(--accent); }
  #board .exit.blocked { cursor: default; }
  #board .exit.blocked .path { stroke: var(--error); } #board .exit.blocked text { fill: var(--error); }
  #board .legend, #map .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 10px 2px 0; font-size: 11.5px; color: var(--faint); }
  #board .legend i, #map .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid; margin-right: 4px; vertical-align: -1px; background: #17181d; }
  #map .legend i.heard { border-style: dashed; border-color: var(--muted); }
  #board .tip, #map .tip { position: absolute; z-index: 30; display: none; max-width: 260px; padding: 8px 11px; border-radius: 14px; background: rgba(28,29,35,.92); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); box-shadow: var(--control-shadow); font-size: 12.5px; line-height: 1.4; pointer-events: none; }
  #board .tip b, #map .tip b { color: var(--accent); font-weight: 600; }
  #board .tip div, #map .tip div { margin-top: 3px; } #board .tip .hint, #map .tip .hint { color: var(--muted); font-size: 12px; }
  #map .road { stroke: #8f8a80; stroke-width: 2.2; fill: none; }
  #map .road.blocked { stroke: var(--error); stroke-dasharray: 6 4; }
  #map .road-hit { stroke: transparent; stroke-width: 14; fill: none; }
  #map .dist { fill: #cfcfd6; font-size: 10px; text-anchor: middle; font-style: italic; }
  #map .place { cursor: pointer; }
  #map .place.here, #map .place.zone { cursor: default; }
  #map .place .disc { stroke: #0a0a0d; stroke-width: 1.5; }
  #map .place.heard .disc { stroke-dasharray: 4 3; opacity: .55; }
  #map .place.here .disc { stroke: var(--accent); stroke-width: 2.5; }
  #map .place .glyph { fill: #f5f5f7; opacity: .8; pointer-events: none; }
  #map .place.heard .glyph { opacity: .35; }
  #map .place .name { fill: var(--text); font-size: 11px; text-anchor: middle; }
  #map .place.heard .name { fill: var(--muted); font-style: italic; }
  #map .place.outside .name { fill: var(--muted); }
  #map .place:hover .name, #map .place.here .name { fill: var(--accent); }
  #map .token { pointer-events: none; }
  #map .token .disc { fill: #17181d; }
  #map .token text { font-weight: bold; text-anchor: middle; dominant-baseline: central; stroke-width: 0; }
  #map .token.unseen { opacity: .65; } #map .token.unseen .ring { stroke-dasharray: 3 2; }
  #map .route { stroke: #6fbf6f; stroke-width: 2; stroke-dasharray: 4 4; pointer-events: none; }
  /* Tablero o mapa en grande: una hoja de vidrio sobre la partida atenuada. */
  body.map-big::after, body.board-big::after { content: ''; position: fixed; inset: 0; z-index: 19; background: rgba(5,5,13,.55); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
  body.map-big #map, body.board-big #board { position: fixed; inset: 64px 24px 24px; z-index: 21; margin: 0; padding: 16px 18px; border-radius: 34px; overflow: auto; background: linear-gradient(180deg, #1a1b21, #121318); box-shadow: var(--window-shadow); }
  /* Indicador de novedad en la pestaña del Diario. */
  .tabs button, .mtabs button { position: relative; }
  .tabs button.new::after, .mtabs button.new::after { content: ''; position: absolute; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--bg), 0 0 10px var(--glow); }
  .tabs button.new::after { top: 6px; right: 10px; }
  .mtabs button.new::after { top: 8px; right: 18px; }
  /* Aviso de una línea en el hilo (tablón, progreso): nada de burbuja, solo un enlace al Diario. */
  .msg.notice { align-self: center; display: flex; flex-wrap: wrap; justify-content: center; gap: 0 6px; margin: 6px 0 0; font-size: 12px; font-weight: 500; color: var(--faint); text-align: center; }
  .msg.notice .link { border: 0; padding: 0; background: none; color: var(--accent); font-size: 12px; font-weight: 500; }
  .msg.notice .link::before { content: '· '; color: var(--faint); }
  .msg.notice .link:hover { text-decoration: underline; }
  /* Diario: misiones, conversaciones, crónica y lugares. */
  #journal .jnav { display: flex; gap: 4px; padding: 3px; margin: 0 0 10px; border-radius: 999px; background: var(--platter); }
  #journal .jnav button { flex: 1; height: 28px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 500; }
  #journal .jnav button.on { background: var(--control); color: var(--text); box-shadow: 0 2px 8px rgba(0,0,0,.2), inset 0 1px 1px rgba(255,255,255,.1); }
  #journal h3 { display: flex; align-items: baseline; gap: 6px; margin: 14px 2px 8px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  #journal h3:first-child { margin-top: 2px; }
  #journal h3 span { font-weight: 500; letter-spacing: 0; text-transform: none; }
  #journal .empty { margin: 4px 2px 10px; color: var(--faint); font-size: 13px; }
  #journal details { margin: 0 0 6px; border-radius: 16px; background: var(--platter); overflow: hidden; }
  #journal details[open] { background: rgba(255,255,255,.06); }
  #journal summary { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; list-style: none; }
  #journal summary::-webkit-details-marker { display: none; }
  #journal summary .tt { flex: 1; min-width: 0; }
  #journal summary b { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #journal summary small { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #journal summary .st { flex: none; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--control); color: var(--muted); font-size: 11px; font-weight: 600; line-height: 20px; white-space: nowrap; }
  #journal .q.active summary .st { color: var(--accent); background: var(--accent-tint); }
  #journal .q.completed summary .st { color: var(--ok); background: rgba(48,209,89,.14); }
  #journal .q.expired summary .st { color: var(--faint); }
  #journal .q.main summary .st { color: var(--accent-ink); background: var(--accent); }
  #journal .q.main summary b { color: var(--accent); }
  #journal summary .chev { flex: none; width: 14px; height: 14px; color: var(--faint); transition: transform .2s; }
  #journal details[open] summary .chev { transform: rotate(90deg); }
  #journal .qb { padding: 0 12px 12px; font-size: 13px; }
  #journal .qb p { margin: 0 0 8px; }
  #journal .qb .muted { color: var(--muted); }
  #journal .clock { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 8px; padding: 5px 10px; border-radius: 999px; background: var(--accent-tint); color: var(--accent); font-size: 12px; font-weight: 600; }
  #journal .clock.late { background: rgba(255,69,59,.14); color: #ff8a80; }
  #journal .steps { margin: 0 0 8px; padding: 0; list-style: none; }
  #journal .steps li { display: flex; gap: 8px; padding: 3px 0; }
  #journal .steps li::before { content: ''; flex: none; width: 14px; height: 14px; margin-top: 3px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--faint); }
  #journal .steps li.done { color: var(--muted); text-decoration: line-through; }
  #journal .steps li.done::before { background: var(--ok); box-shadow: none; }
  #journal .paths b, #journal .mem b { display: block; margin: 8px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  #journal .paths ol { margin: 0 0 8px; padding-left: 18px; color: var(--muted); }
  #journal .paths li { padding: 2px 0; }
  #journal .rumor { margin: 0 0 8px; padding: 8px 10px; border-radius: 12px; background: var(--platter); color: var(--muted); font-size: 12.5px; font-style: italic; }
  #journal .rumor b { color: var(--text); font-style: normal; font-weight: 600; }
  #journal .rumor small { display: block; margin-top: 3px; font-style: normal; color: var(--faint); }
  #journal .dates { margin-top: 6px; font-size: 11.5px; color: var(--faint); }
  #journal .pt { position: relative; flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; overflow: hidden; background: rgba(255,255,255,.06); color: var(--npc, #e6a587); box-shadow: inset 0 0 0 1.5px currentColor; font-size: 13px; font-weight: 600; }
  #journal .pt img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #journal .ex { padding: 0 12px 10px; }
  #journal .exh { padding: 8px 0; border-top: 1px solid var(--sep); }
  #journal .exh .when { display: block; margin-bottom: 4px; font-size: 11.5px; color: var(--faint); }
  #journal .exh .me, #journal .exh .them { position: relative; margin: 3px 0; padding-left: 14px; font-size: 13px; }
  #journal .exh .me { color: var(--muted); }
  #journal .exh .me::before, #journal .exh .them::before { content: ''; position: absolute; left: 2px; top: 7px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  #journal .exh .them::before { background: var(--npc, #e6a587); }
  #journal .mem { padding: 6px 12px 12px; border-top: 1px solid var(--sep); }
  #journal .mem ul { margin: 0; padding-left: 16px; color: var(--muted); font-size: 12.5px; }
  #journal .mem li { padding: 2px 0; }
  #journal .mem small { color: var(--faint); }
  #journal .day summary b { white-space: normal; }
  #journal .en { display: flex; gap: 10px; padding: 5px 12px; font-size: 13px; }
  #journal .en:last-child { padding-bottom: 12px; }
  #journal .en .t { flex: none; width: 38px; font-family: var(--mono); font-size: 11.5px; color: var(--faint); letter-spacing: 0; padding-top: 2px; }
  #journal .en.progress { color: var(--accent); } #journal .en.combat { color: #ff8a80; } #journal .en.roll { color: var(--muted); } #journal .en.rumor, #journal .en.note { color: var(--muted); font-style: italic; }
  #journal .pl { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin-bottom: 6px; border-radius: 14px; background: var(--platter); }
  #journal .pl i { flex: none; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--muted); background: #17181d; }
  #journal .pl.visited i { border-color: var(--ok); } #journal .pl.heard_of i { border-style: dashed; }
  #journal .pl.here i { border-color: var(--accent); box-shadow: 0 0 8px var(--glow); }
  #journal .pl b { display: block; font-size: 13.5px; font-weight: 600; } #journal .pl small { color: var(--muted); font-size: 12px; }
  .mtabs { display: none; }
  @media (max-width: 820px) {
    header { padding: 10px 12px 0; min-height: 52px; gap: 8px; }
    header .bar { padding-right: 12px; gap: 10px; }
    header h1, header .div { display: none; }
    #game-name { max-width: 40vw; }
    #clock { display: none; }
    main { padding: 8px 8px 84px; }
    #play { border-radius: 28px; }
    .chat-head { padding: 12px 14px 10px; }
    #log { padding: 6px 14px 10px; }
    #thinking { padding: 0 14px; }
    .compose { padding: 6px 10px 10px; }
    aside { display: none; width: auto; flex: 1; border-radius: 28px; }
    body.tab-side #play { display: none; }
    body.tab-side aside { display: flex; }
    .mtabs { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 10; display: flex; padding: 4px; border-radius: 999px; }
    .mtabs button { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 52px; justify-content: center; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-size: 11px; font-weight: 500; }
    .mtabs button.on { color: var(--accent); background: var(--control); }
    aside .tabs { display: none; }
    body.map-big #map, body.board-big #board { inset: 12px; }
  }
${VOICE_STYLE}
${TTS_STYLE}
${SFX_STYLE}
${NOVEL_STYLE}
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-back" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
  <symbol id="i-max" viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></symbol>
  <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M5 5h14v10H9l-4 4z"/></symbol>
  <symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></symbol>
  <symbol id="i-map" viewBox="0 0 24 24"><path d="M9 4l-5 2v14l5-2 6 2 5-2V4l-5 2z"/><path d="M9 4v14M15 6v14"/></symbol>
  <symbol id="i-sheet" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M10 12h5M10 16h5"/></symbol>
  <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/></symbol>
  <symbol id="i-chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol>
</svg>
<header>
  <div class="bar glass">
    <a class="menu" href="/" title="Volver al menú de partidas" aria-label="Volver al menú de partidas"><svg class="i"><use href="#i-back"/></svg></a>
    <h1>Tavernus</h1>
    <span class="div"></span>
    <span id="game-name"></span>
    <span id="game-mode" class="badge" hidden></span>
  </div>
  <div id="clock" class="glass"></div>
  <span class="spacer"></span>
  <div id="party" class="glass" role="group" aria-label="Personaje"></div>
  <select id="character" class="vh" aria-label="Personaje" tabindex="-1"></select>
</header>
<main>
  <section id="play" class="window">
    <div class="chat-head">
      <span class="dot"><svg class="i"><use href="#i-pin"/></svg></span>
      <div class="t"><div id="place">Tavernus</div><div id="place-sub"></div></div>
    </div>
    <div id="log" aria-live="polite"></div>
    <div id="thinking"></div>
    <div class="compose">
      <div class="chips">
        <button data-cmd="look">/look</button><button data-cmd="where">/where</button><button data-cmd="who">/who</button>
        <button data-cmd="inventory">/inventory</button><button data-cmd="recap">/recap</button><button data-cmd="time">/time</button>
        <button data-cmd="tablon">/tablon</button><button data-cmd="progress">/progress</button>
      </div>
      <form id="form" autocomplete="off">
        <input id="input" placeholder="¿Qué haces?" aria-label="Acción">
        <button type="submit" aria-label="Enviar" title="Enviar"><svg class="i"><use href="#i-send"/></svg></button>
      </form>
    </div>
  </section>
  <aside id="side" class="window">
    <div id="card" class="card"></div>
    <div class="tabs" role="tablist">
      <button type="button" data-tab="board"><svg class="i"><use href="#i-grid"/></svg>Tablero</button>
      <button type="button" data-tab="map"><svg class="i"><use href="#i-map"/></svg>Mapa</button>
      <button type="button" data-tab="sheet"><svg class="i"><use href="#i-sheet"/></svg>Hoja</button>
      <button type="button" data-tab="journal"><svg class="i"><use href="#i-book"/></svg>Diario</button>
    </div>
    <div class="pane" data-pane="board"><div id="board"></div><p class="none">Este lugar no tiene tablero.</p></div>
    <div class="pane" data-pane="map"><div id="map"></div><p class="none">Aún no hay mapa de la zona.</p></div>
    <div class="pane" data-pane="sheet"><div id="sheet"></div><p class="none">Cargando la hoja…</p></div>
    <div class="pane" data-pane="journal"><div id="journal"></div><p class="none">El diario está en blanco.</p></div>
  </aside>
</main>
<nav class="mtabs glass" aria-label="Vistas">
  <button type="button" data-mtab="play"><svg class="i"><use href="#i-chat"/></svg>Partida</button>
  <button type="button" data-mtab="board"><svg class="i"><use href="#i-grid"/></svg>Tablero</button>
  <button type="button" data-mtab="map"><svg class="i"><use href="#i-map"/></svg>Mapa</button>
  <button type="button" data-mtab="sheet"><svg class="i"><use href="#i-sheet"/></svg>Hoja</button>
  <button type="button" data-mtab="journal"><svg class="i"><use href="#i-book"/></svg>Diario</button>
</nav>
<div id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Ilustración ampliada">
  <img alt="">
  <div class="cap"><b></b><span></span><span>Esc para cerrar</span></div>
  <button type="button" class="close glass" aria-label="Cerrar" title="Cerrar (Esc)"><svg class="i"><use href="#i-x"/></svg></button>
</div>
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
    $('game-name').textContent = g.name;
    var badge = $('game-mode');
    badge.textContent = MODE_LABEL[g.mode] || g.mode; badge.className = 'badge ' + g.mode; badge.hidden = false;
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

  var SPARK = '<svg class="i" style="width:12px;height:12px"><use href="#i-spark"/></svg>';
  /** Un mensaje: la burbuja (.body) y, debajo, lo que se le añada (aviso, acciones). El del máster lleva su rótulo. */
  function add(kind, text, extra) {
    var div = document.createElement('div');
    div.className = 'msg ' + kind + (extra && extra.error ? ' error' : '');
    div.innerHTML = (kind === 'master' ? '<div class="who">' + SPARK + 'Máster</div>' : '') + '<div class="body">' + format(text) + '</div>';
    log.appendChild(div);
    scroll();
    return div;
  }
${NOVEL_JS}
  /** Cada mensaje del stream entra en el hilo tipo chat (novel.ts): avatar, burbuja, botones e imágenes. */
  function renderMessage(m, live) { chatMessage(m, live); }

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
    // Sin burbuja de «prompt»: mientras piensa el narrador se ve atenuado; luego lo sustituye lo que el PJ dice o hace.
    pendingMine(text);
    setBusy(true);
    post('/api/act', { text: text }).then(handleReply).finally(function () { clearPending(); setBusy(false); loadSheet(); });
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
      renderCard(s);
    }).catch(function () {});
  }

  /** Ficha de arriba del panel, la hora y la cabecera del chat, sacadas de la hoja viva. */
  function renderCard(s) {
    var t = s.title.split(' · '), combat = (s.fields.filter(function (f) { return f.name === 'Combate'; })[0] || {}).value || '';
    var num = function (re) { var m = combat.match(re); return m ? m : null; };
    var hp = num(/PG (\d+)\/(\d+)/), ca = num(/CA (\d+)/), sp = num(/Velocidad (\d+) ft/), pp = num(/Percepción pasiva (\d+)/);
    var lvl = (t[2] || '').replace(/[^0-9]/g, '');
    var pct = hp ? Math.max(0, Math.min(100, Math.round(100 * Number(hp[1]) / Number(hp[2])))) : 0;
    var stat = function (v, k) { return '<div>' + escapeHtml(v) + '<small>' + k + '</small></div>'; };
    $('card').innerHTML = '<div class="top"><span class="av">' + escapeHtml(initial(t[0] || '?')) + '</span><div><div class="name">' + escapeHtml(t[0] || '') + '</div>' +
      '<div class="sub">' + escapeHtml(t.slice(1).join(' · ')) + '</div></div></div>' +
      (hp ? '<div class="hp"><span>Puntos de golpe</span><b>' + hp[1] + ' / ' + hp[2] + '</b></div><div class="bar"><i class="' + (pct <= 25 ? 'crit' : pct <= 50 ? 'low' : '') + '" style="width:' + pct + '%"></i></div>' : '') +
      '<div class="stats">' + stat(ca ? ca[1] : '—', 'CA') + stat(sp ? String(Math.round(Number(sp[1]) * 0.3)) + ' m' : '—', 'Vel.') + stat(pp ? pp[1] : '—', 'Perc.') + stat(lvl || '—', 'Nivel') + '</div>';
    $('clock').innerHTML = s.footer ? '<svg class="i" style="width:14px;height:14px"><use href="#i-clock"/></svg>' + escapeHtml(s.footer) : '';
    // «despierto · Taberna, La barra»: el lugar a la cabecera del chat y el estado debajo.
    var d = s.description.split('\n')[0], i = d.indexOf(' · ');
    var where = i >= 0 ? d.slice(i + 3) : d, state = i >= 0 ? d.slice(0, i) : '';
    var comma = where.indexOf(', ');
    $('place').textContent = comma >= 0 ? where.slice(0, comma) : where;
    $('place-sub').textContent = [comma >= 0 ? where.slice(comma + 2) : '', state, t[0]].filter(Boolean).join(' · ');
  }

  // --- Tablero de la localización ------------------------------------------
  // Plano tipo mesa de juego: casillas de 1,5 m, suelos, paredes, puertas,
  // muebles y fichas. Coordenadas del motor en metros, +y al norte.
  // Ilustración de la localización actual (IMAGES=on): entra en el chat como una tarjeta al llegar a otro sitio;
  // un clic la abre en grande (Esc, la X o un clic fuera la cierran).
  var sceneSrc = null, sceneLast = null, sceneTimer = null;
  var lightbox = $('lightbox'), lbImg = lightbox.querySelector('img');
  function showScene(s) {
    sceneLast = s;
    if (!s) { sceneSrc = null; return; }
    if (s.src === sceneSrc) return;
    sceneSrc = s.src;
    var fig = document.createElement('figure');
    fig.className = 'msg scene loading';
    fig.innerHTML = '<button type="button" class="shot" title="Ver en grande"><img alt=""><figcaption><b></b><span>Escena</span></figcaption>' +
      '<span class="zoom glass"><svg class="i"><use href="#i-max"/></svg></span></button>';
    var img = fig.querySelector('img');
    fig.querySelector('figcaption b').textContent = s.name;
    img.alt = 'Ilustración: ' + s.name;
    img.addEventListener('load', function () { fig.classList.remove('loading'); scroll(); });
    // La imagen la sirve el propio servidor (data/games/<slug>/images): si no carga, se quita.
    img.addEventListener('error', function () { fig.remove(); });
    fig.querySelector('.shot').addEventListener('click', function () { openLightbox(s); });
    img.src = s.src;
    log.appendChild(fig);
    scroll();
  }
  function openLightbox(s) {
    lbImg.src = s.src; lbImg.alt = 'Ilustración: ' + s.name;
    lightbox.querySelector('.cap b').textContent = s.name;
    lightbox.querySelector('.cap span').textContent = $('clock').textContent;
    lightbox.hidden = false;
    lightbox.querySelector('.close').focus();
  }
  function closeLightbox() { lightbox.hidden = true; }
  lightbox.addEventListener('click', function (ev) { if (ev.target !== lbImg) closeLightbox(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeLightbox(); });
  /**
   * La escena es un mensaje del hilo (llega por el stream, en su sitio, y se queda en el historial).
   * Esto solo avisa al servidor para que la pinte si aún no existe (partidas de antes de IMAGES=on).
   */
  function loadScene() {
    if (!current) return;
    var id = current;
    clearTimeout(sceneTimer);
    sceneTimer = setTimeout(function () { fetch(api('/api/scene?character=' + encodeURIComponent(id))).catch(function () {}); }, 250);
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
    var W = big ? board.clientWidth - 32 : $('side').clientWidth - 44;
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
    var W = big ? mapEl.clientWidth - 32 : $('side').clientWidth - 44;
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

  // --- Diario -----------------------------------------------------------------
  // Misiones (activas / completadas), conversaciones por personaje, crónica por
  // día y lugares, servido por /api/journal desde los datos del motor. El
  // stream avisa con «journal» cuando cambia algo; un punto en la pestaña marca
  // lo que no se ha leído (la versión vista se guarda en localStorage).
  var journalEl = $('journal'), journalData = null, journalSeq = 0;
  var JSECTIONS = [['quests', 'Misiones'], ['talks', 'Charlas'], ['chronicle', 'Crónica'], ['places', 'Lugares']];
  var journalSection = JSECTIONS.some(function (s) { return s[0] === store('tavernus.journal.section'); }) ? store('tavernus.journal.section') : 'quests';
  var JSTATUS = { available: 'disponible', active: 'en curso', completed: 'completada', expired: 'caducada' };

  function journalKey() { return 'tavernus.journal.seen.' + game + '.' + current; }
  function journalVisible() { return tab === 'journal' && (document.body.classList.contains('tab-side') || !window.matchMedia('(max-width: 820px)').matches); }
  function setJournalNew(on) { document.querySelectorAll('[data-tab="journal"], [data-mtab="journal"]').forEach(function (b) { b.classList.toggle('new', on); }); }
  function markJournalSeen() { if (!journalData) return; store(journalKey(), journalData.version); setJournalNew(false); }

  function loadJournal() {
    if (!current) return;
    var seq = ++journalSeq, id = current;
    fetch(api('/api/journal?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (seq !== journalSeq || id !== current || !j || !j.character) return;
      journalData = j;
      renderJournal(j);
      if (journalVisible()) markJournalSeen();
      else setJournalNew(store(journalKey()) !== j.version);
    }).catch(function () {});
  }

  var CHEV = '<svg class="i chev"><use href="#i-chev"/></svg>';
  function questHtml(q) {
    var sub = [q.giver && q.kind !== 'debt' ? 'lo pide ' + q.giver : '', q.reward || '', q.kind === 'main' ? 'misión principal' : '', q.kind === 'achievement' ? 'logro' : '', q.kind === 'debt' ? 'deuda' : ''].filter(Boolean).join(' · ');
    var h = '<details class="q ' + q.status + (q.kind === 'main' ? ' main' : '') + '"' + (q.pinned ? ' open' : '') + '><summary><span class="st">' + escapeHtml(JSTATUS[q.status] || q.status) + '</span>' +
      '<span class="tt"><b>' + escapeHtml(q.title) + '</b>' + (sub ? '<small>' + escapeHtml(sub) + '</small>' : '') + '</span>' + CHEV + '</summary><div class="qb">';
    if (q.text) h += '<p>' + escapeHtml(q.text) + '</p>';
    if (q.clock) {
      var late = q.clock.days_left <= 0;
      h += '<div class="clock' + (late ? ' late' : '') + '"><svg class="i" style="width:13px;height:13px"><use href="#i-clock"/></svg>' + (late ? 'Plazo vencido' : 'Quedan ' + q.clock.days_left + (q.clock.days_left === 1 ? ' día' : ' días')) + ' · vence ' + escapeHtml(q.clock.deadline) + '</div>';
      h += '<p class="muted">Si vence: ' + escapeHtml(q.clock.runs_out) + '</p>';
    }
    if (q.antagonist) h += '<p class="muted">Se te opone: <b>' + escapeHtml(q.antagonist.name) + '</b> (' + escapeHtml(q.antagonist.role) + ')</p>';
    if (q.steps.length) h += '<ul class="steps">' + q.steps.map(function (s) { return '<li class="' + (s.done ? 'done' : '') + '">' + escapeHtml(s.text) + '</li>'; }).join('') + '</ul>';
    if (q.paths.length) h += '<div class="paths"><b>Caminos</b><ol>' + q.paths.map(function (p) { return '<li>' + escapeHtml(p) + '</li>'; }).join('') + '</ol></div>';
    q.rumors.forEach(function (r) { h += rumorHtml(r); });
    var dates = [q.seen ? (q.kind === 'job' ? 'Visto en el tablón: ' : 'Desde: ') + q.seen : '', q.completed ? 'Completada: ' + q.completed : ''].filter(Boolean);
    if (dates.length) h += '<div class="dates">' + escapeHtml(dates.join(' · ')) + '</div>';
    return h + '</div></details>';
  }
  function rumorHtml(r) {
    return '<div class="rumor"><b>' + (r.said_by ? 'Lo dice ' + escapeHtml(r.said_by) + ':' : 'Se dice:') + '</b> «' + escapeHtml(r.name) + '». ' + escapeHtml(r.hint) +
      (r.where ? ' Dónde, según dicen: ' + escapeHtml(r.where) + '.' : '') + '<small>' + escapeHtml(r.when) + (r.mentions > 1 ? ' · ha salido ' + r.mentions + ' veces' : '') + '</small></div>';
  }
  function talkHtml(c, i) {
    var color = npcColor(c.npc_id);
    var pt = '<span class="pt" style="--npc:' + color + '">' + (c.portrait ? '<img alt="" src="' + escapeHtml(c.portrait) + '">' : escapeHtml(initial(c.name))) + '</span>';
    var last = c.exchanges[c.exchanges.length - 1];
    var h = '<details class="talk" style="--npc:' + color + '"' + (i === 0 ? ' open' : '') + '><summary>' + pt + '<span class="tt"><b>' + escapeHtml(c.name) + '</b><small>' +
      escapeHtml([c.known ? c.role : 'nombre desconocido', c.exchanges.length + (c.exchanges.length === 1 ? ' intercambio' : ' intercambios'), last ? last.when : ''].filter(Boolean).join(' · ')) + '</small></span>' + CHEV + '</summary><div class="ex">';
    c.exchanges.forEach(function (x) {
      h += '<div class="exh"><span class="when">' + escapeHtml(x.when + ' · ' + x.location) + '</span>' +
        x.said.map(function (s) { return '<div class="me">' + escapeHtml(s) + '</div>'; }).join('') +
        x.replied.map(function (s) { return '<div class="them">' + escapeHtml(s) + '</div>'; }).join('') + '</div>';
    });
    h += '</div>';
    if (c.memory.length) h += '<div class="mem"><b>Lo que recuerda de ti</b><ul>' + c.memory.map(function (m) { return '<li>' + escapeHtml(m.note) + ' <small>' + escapeHtml(m.when) + '</small></li>'; }).join('') + '</ul></div>';
    return h + '</details>';
  }
  function dayHtml(d, i) {
    return '<details class="day"' + (i === 0 ? ' open' : '') + '><summary><span class="tt"><b>' + escapeHtml(d.label) + '</b>' + (d.summary ? '<small>' + escapeHtml(d.summary) + '</small>' : '') + '</span>' + CHEV + '</summary>' +
      d.entries.map(function (e) { return '<div class="en ' + e.kind + '"><span class="t">' + escapeHtml(e.time) + '</span><span>' + escapeHtml(e.text) + '</span></div>'; }).join('') + '</details>';
  }
  function placeHtml(p) {
    var sub = [p.zone, p.here ? 'estás aquí' : p.status === 'visited' ? 'visitado' : 'de oídas', p.first_visit ? 'desde ' + p.first_visit : ''].filter(Boolean).join(' · ');
    return '<div class="pl ' + p.status + (p.here ? ' here' : '') + '"><i></i><span><b>' + escapeHtml(p.name) + '</b><small>' + escapeHtml(sub) + '</small></span></div>';
  }

  function renderJournal(j) {
    var h = '<div class="jnav">' + JSECTIONS.map(function (s) { return '<button type="button" data-jsec="' + s[0] + '"' + (s[0] === journalSection ? ' class="on"' : '') + '>' + s[1] + '</button>'; }).join('') + '</div>';
    if (journalSection === 'quests') {
      h += '<h3>Activas <span>' + j.quests.active.length + '</span></h3>';
      h += j.quests.active.length ? j.quests.active.map(questHtml).join('') : '<p class="empty">Nada entre manos. Mira el tablón o habla con la gente.</p>';
      if (j.rumors.length) h += '<h3>Se dice</h3>' + j.rumors.map(rumorHtml).join('');
      h += '<h3>Completadas <span>' + j.quests.completed.length + '</span></h3>';
      h += j.quests.completed.length ? j.quests.completed.map(questHtml).join('') : '<p class="empty">Todavía ninguna.</p>';
    } else if (journalSection === 'talks') {
      h += '<h3>Conversaciones <span>' + j.conversations.length + '</span></h3>';
      h += j.conversations.length ? j.conversations.map(talkHtml).join('') : '<p class="empty">Aún no has hablado con nadie.</p>';
    } else if (journalSection === 'chronicle') {
      h += '<h3>Crónica <span>' + j.chronicle.length + (j.chronicle.length === 1 ? ' día' : ' días') + '</span></h3>';
      h += j.chronicle.length ? j.chronicle.map(dayHtml).join('') : '<p class="empty">Todavía no ha pasado nada.</p>';
    } else {
      h += '<h3>Lugares <span>' + j.places.length + '</span></h3>';
      h += j.places.length ? j.places.map(placeHtml).join('') : '<p class="empty">No conoces ningún sitio.</p>';
    }
    journalEl.innerHTML = h;
  }
  journalEl.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-jsec]');
    if (!b) return;
    journalSection = b.getAttribute('data-jsec'); store('tavernus.journal.section', journalSection);
    if (journalData) renderJournal(journalData);
  });
  /** Abre una pestaña del panel desde el hilo (en el móvil, la vista entera). */
  function goTab(t) { if (window.matchMedia('(max-width: 820px)').matches) setMobile(t); else setTab(t); }

  function connect(id) {
    current = id;
    store('tavernus.character.' + game, id);
    if (stream) stream.close();
    log.innerHTML = '';
    board.innerHTML = ''; boardData = null; clearTimeout(boardTimer); document.body.classList.remove('board-big');
    mapEl.innerHTML = ''; mapData = null; document.body.classList.remove('map-big');
    journalEl.innerHTML = ''; journalData = null; setJournalNew(false);
    showScene(null);
    $('card').innerHTML = ''; $('sheet').innerHTML = '';
    renderParty();
    if (window.TavernusSfx) TavernusSfx.character(id);
    stream = new EventSource(api('/api/stream?character=' + encodeURIComponent(id)));
    stream.addEventListener('history', function (e) {
      log.innerHTML = '';
      var h = JSON.parse(e.data);
      h.forEach(function (m, i) { renderMessage(m, i === h.length - 1); });
      if (!h.some(function (m) { return !m.scene; })) command('look');
    });
    stream.addEventListener('cast', function (e) { setCast(JSON.parse(e.data)); });
    stream.addEventListener('message', function (e) { var m = JSON.parse(e.data); renderMessage(m, true); if (window.TavernusTTS) TavernusTTS.fresh(); if (window.TavernusSfx) TavernusSfx.cue(m.sfx); loadBoard(); loadScene(); });
    stream.addEventListener('sheet', loadSheet);
    stream.addEventListener('moment', function (e) { var x = JSON.parse(e.data); showMoment(x, x.seq); });
    stream.addEventListener('portrait', function (e) { setPortrait(JSON.parse(e.data)); });
    stream.addEventListener('journal', loadJournal);
    loadSheet();
    loadScene();
    loadJournal();
    input.focus();
  }

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    // Ni las consultas ni la tirada salen como mensaje del jugador: solo su respuesta.
    if (text.charAt(0) === '/') command(text.split(/\s+/)[0]);
    else if (text === 'tirar' || text === 'roll') { spendButtons(); roll(); }
    else act(text);
  });
  document.querySelectorAll('.chips button').forEach(function (b) {
    b.addEventListener('click', function () { command(b.dataset.cmd); });
  });
  select.addEventListener('change', function () { connect(select.value); });

  // Pestañas del panel (Tablero, Mapa, Hoja). En el móvil, la barra de abajo elige entre la partida y una de ellas.
  var tab = ['board', 'map', 'sheet', 'journal'].indexOf(store('tavernus.tab')) >= 0 ? store('tavernus.tab') : 'board';
  function setTab(t) {
    tab = t; store('tavernus.tab', t);
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    document.querySelectorAll('.pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== t; });
    if (t === 'board' && boardData) renderBoard(boardData);
    if (t === 'map' && mapData) renderMap(mapData);
    if (journalVisible()) markJournalSeen();
  }
  function setMobile(v) {
    document.body.classList.toggle('tab-side', v !== 'play');
    document.querySelectorAll('.mtabs [data-mtab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mtab') === v); });
    if (v !== 'play') setTab(v);
  }
  document.querySelectorAll('.tabs [data-tab]').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
  document.querySelectorAll('.mtabs [data-mtab]').forEach(function (b) { b.addEventListener('click', function () { setMobile(b.getAttribute('data-mtab')); }); });
  setTab(tab); setMobile('play');

  /** Avatares del grupo arriba a la derecha: cambian de personaje como el desplegable (que queda oculto). */
  function renderParty() {
    var party = $('party');
    party.innerHTML = '';
    [].forEach.call(select.options, function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = initial(o.textContent); b.title = o.textContent;
      b.setAttribute('aria-pressed', o.value === current ? 'true' : 'false');
      if (o.value === current) b.className = 'on';
      b.addEventListener('click', function () { if (o.value !== current) { select.value = o.value; connect(o.value); } });
      party.appendChild(b);
    });
  }

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
${VOICE_SCRIPT}
${TTS_SCRIPT}
${SFX_SCRIPT}
</body>
</html>
`;
