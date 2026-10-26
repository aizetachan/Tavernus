/** Página del adaptador web: HTML, CSS y JS en un solo string para que funcione igual con tsx y con dist/. */

import { VOICE_SCRIPT, VOICE_STYLE } from './voice-input.js';
import { NOVEL_JS, NOVEL_STYLE } from './novel.js';
import { TTS_SCRIPT, TTS_STYLE } from './tts.js';
import { SFX_SCRIPT, SFX_STYLE } from './sfx.js';
import { PAINT_JS, PAINT_STYLE } from './paint.js';
import { AVATAR_SCRIPT, AVATAR_STYLE } from './avatar.js';

export const PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavernus</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
<meta name="theme-color" content="#141617">
<style>
  /* Estilo B5 (lienzo de diseño «Tavernus · Pantalla de partida»): como WhatsApp, un panel con la partida
     a la izquierda y el chat a la derecha. Fondos planos, burbujas con sombra, Manrope en los títulos.
     Hoja, Diario y Mochila salen del cubo junto a Enviar y se abren en la misma columna del chat. */
  :root {
    --bg: #0e0f10; --panel: #141617; --chat: #0b0d0c; --bubble: #1f2426; --mine: #4a2f17; --mine-ink: #f6e9d6;
    --text: #ece7df; --muted: #9a948a; --faint: #8a847a;
    --accent: #e6b75a; --accent-ink: #2a1d05; --accent-tint: rgba(230,183,90,.14); --glow: #f0c56b;
    --platter: #1a1d1f; --control: #1d2022; --hover: rgba(255,255,255,.07); --sep: rgba(255,255,255,.06); --line: rgba(255,255,255,.08);
    --error: #ff6b5e; --ok: #4fbf7a; --info: #63d1ff; --rec: #e05a4a; --panel-2: rgba(255,255,255,.08);
    --window-shadow: 0 12px 32px rgba(0,0,0,.55); --control-shadow: 0 4px 12px rgba(0,0,0,.45);
    --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --display: Manrope, Inter, system-ui, sans-serif;
    --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 15px/1.47 var(--sans); display: flex; -webkit-font-smoothing: antialiased; overflow: hidden; }
  select, button, input, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
  button { cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  svg.i { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .glass { background: rgba(14,15,16,.75); box-shadow: var(--control-shadow); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .ib { display: inline-grid; place-items: center; width: 32px; height: 32px; flex: none; border: 0; border-radius: 50%; background: transparent; color: #b8b1a6; text-decoration: none; }
  .ib:hover { background: var(--hover); color: var(--text); }
  .ib[hidden] { display: none; }
  .ib svg.i { width: 16px; height: 16px; }
  .sec-t { display: flex; align-items: center; gap: 8px; padding: 14px 14px 6px 16px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .sec-t span { margin-left: auto; font-weight: 500; letter-spacing: 0; text-transform: none; font-size: 12px; }

  /* Panel de la partida. */
  aside { flex: 0 0 380px; display: flex; flex-direction: column; min-width: 0; background: var(--panel); border-right: 1px solid var(--sep); }
  .side-head { display: flex; align-items: center; gap: 10px; padding: 14px 8px 10px 16px; flex: none; }
  .side-head .mark { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 9px; background: var(--accent-tint); color: var(--accent); font: 800 18px/1 var(--display); text-decoration: none; overflow: hidden; }
  .side-head .mark img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .side-head .t { min-width: 0; flex: 1; }
  #game-name { display: block; font: 700 18px/1.2 var(--display); letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .side-head .sub { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; }
  .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .badge.offline { color: var(--info); } .badge.live { color: var(--ok); } .badge.record { color: var(--rec); } .badge.replay { color: var(--accent); }
  .badge[hidden] { display: none; }
  #side-close { display: none; }
  .side-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.12) transparent; }

  /* Ficha del personaje: pulsarla abre la Hoja; el círculo abre el avatar. */
  .card { display: block; padding: 6px 16px 14px; border-bottom: 1px solid var(--sep); cursor: pointer; }
  .card:empty { display: none; }
  .card:hover { background: rgba(255,255,255,.02); }
  .card .top { display: flex; align-items: center; gap: 12px; }
  .card .av { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--accent); background: #2a1d05; box-shadow: inset 0 0 0 2px var(--accent); font-size: 17px; font-weight: 600; }
  .card .who { min-width: 0; flex: 1; }
  .card .name { font: 700 16px/1.3 var(--display); letter-spacing: -.02em; }
  .card .sub { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .hpbox { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 13px; font-weight: 600; }
  .card .bar { width: 96px; height: 4px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; }
  .card .bar i { display: block; height: 100%; border-radius: 999px; background: var(--ok); }
  .card .bar i.low { background: var(--accent); } .card .bar i.crit { background: var(--error); }
  .card .stats { display: flex; gap: 6px; margin-top: 10px; }
  .card .stats div { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 6px 0; border-radius: 10px; background: var(--platter); border: 1px solid var(--sep); font-size: 15px; font-weight: 600; white-space: nowrap; }
  .card .stats small { font-size: 10.5px; font-weight: 400; color: var(--muted); }

  /* Tablero y mapa del sitio. */
  .views { display: flex; align-items: center; gap: 4px; padding: 12px 12px 8px 16px; }
  .views b { margin-right: auto; font: 700 15px/1.2 var(--display); letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--platter); flex: none; }
  .seg button { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 500; }
  .seg button.on { background: rgba(255,255,255,.1); color: var(--text); }
  .pane { margin: 0 12px 4px; }
  .pane[hidden] { display: none; }
  .pane .none { display: none; margin: 4px; color: var(--faint); font-size: 13px; }
  .pane > div:empty + .none { display: block; }
  .where button { height: 26px; border: 0; border-radius: 999px; padding: 0 10px; background: var(--control); color: var(--muted); font-size: 12px; font-weight: 500; }
  .where button:hover { background: rgba(255,255,255,.1); color: var(--text); }
  .where button.on { color: var(--accent-ink); background: var(--accent); }
  #board, #map { position: relative; transition: opacity .2s; }
  #board.busy, #map.busy { opacity: .45; pointer-events: none; }
  #board .where, #map .where { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 0 2px 8px; line-height: 1.3; font-size: 13px; }
  #board .where b, #map .where b { font-weight: 600; white-space: nowrap; }
  #board .where span { color: var(--muted); font-size: 12px; flex: 1; }
  #map .where span.sub { color: var(--muted); font-size: 12px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #map .where .btns { margin-left: auto; display: flex; gap: 4px; white-space: nowrap; }
  #board svg, #map svg { display: block; margin: 0 auto; background: #101411; border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
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
  #board .legend, #map .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 8px 2px 0; font-size: 11.5px; color: var(--faint); }
  #board .legend i, #map .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid; margin-right: 4px; vertical-align: -1px; background: #17181d; }
  #map .legend i.heard { border-style: dashed; border-color: var(--muted); }
  #board .tip, #map .tip { position: absolute; z-index: 30; display: none; max-width: 260px; padding: 8px 11px; border-radius: 12px; background: #1f2426; box-shadow: var(--window-shadow); font-size: 12.5px; line-height: 1.4; pointer-events: none; }
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
  /* Tablero o mapa en grande: una hoja sobre la partida atenuada. */
  body.map-big::after, body.board-big::after { content: ''; position: fixed; inset: 0; z-index: 19; background: rgba(5,6,6,.6); }
  body.map-big #map, body.board-big #board { position: fixed; inset: 40px; z-index: 21; margin: 0; padding: 16px 18px; border-radius: 20px; overflow: auto; background: var(--panel); box-shadow: var(--window-shadow); }

  /* Listas del panel: «Cerca de ti» y la misión, filas como las de WhatsApp. */
  .prow { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 8px 14px 8px 16px; border: 0; border-bottom: 1px solid rgba(255,255,255,.05); background: transparent; color: var(--text); text-align: left; }
  button.prow:hover { background: rgba(255,255,255,.04); }
  .prow.here { background: rgba(230,183,90,.08); }
  .prow:disabled { opacity: 1; cursor: default; }
  #board .where b { display: none; }
  .prow .ico { display: grid; place-items: center; width: 38px; height: 38px; flex: none; border-radius: 50%; background: var(--control); border: 1px solid var(--line); color: #b8b1a6; font-size: 13px; font-weight: 600; }
  .prow.here .ico { background: var(--accent-tint); border-color: rgba(230,183,90,.3); color: var(--accent); }
  .prow .ico.npc { color: var(--npc, #e6a587); background: rgba(255,255,255,.04); border-color: currentColor; }
  .prow .tt { min-width: 0; flex: 1; }
  .prow .tt b { display: block; font-size: 14.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prow .tt small { display: block; margin-top: 2px; font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prow .m { flex: none; font-size: 12px; color: var(--muted); }
  .prow.here .m { color: var(--accent); font-weight: 500; }
  .prow .prog { display: flex; align-items: center; gap: 8px; margin-top: 7px; }
  .prow .prog i { flex: 1; height: 4px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; }
  .prow .prog i span { display: block; height: 100%; background: var(--accent); }
  .prow .prog small { margin: 0; font-size: 11px; }
  .pill-new { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; margin-left: 6px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-size: 10.5px; font-weight: 600; vertical-align: 1px; }
  #near:empty, #quest:empty { display: none; }

  /* Chat. */
  #play { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; background: var(--chat); }
  .chat-head { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 12px 0 18px; flex: none; background: var(--panel); border-bottom: 1px solid var(--sep); box-shadow: 0 1px 4px rgba(0,0,0,.35); }
  #to-side { display: none; }
  .chat-head .dot { width: 40px; height: 40px; flex: none; display: grid; place-items: center; border-radius: 50%; overflow: hidden; background: var(--accent-tint); color: var(--accent); }
  .chat-head .dot img { width: 100%; height: 100%; object-fit: cover; filter: saturate(.85); }
  .chat-head .t { min-width: 0; flex: 1; }
  #place { font: 700 16px/1.2 var(--display); letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #place-sub { margin-top: 1px; font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #party { display: flex; align-items: center; flex: none; }
  #party:empty { display: none; }
  #party button { width: 30px; height: 30px; margin-left: -8px; border-radius: 50%; border: 2px solid var(--panel); background: #22262a; color: var(--muted); font-size: 11.5px; font-weight: 600; background-position: center; }
  #party button:first-child { margin-left: 0; }
  #party button:hover { color: var(--text); position: relative; z-index: 2; }
  #party button.on { color: var(--accent); background-color: #2a1d05; border-color: var(--accent); position: relative; z-index: 1; }
  /* Presencia (docs/MULTIJUGADOR.md): los demás jugadores, con punto verde si están en línea; en la hoja, una línea cada uno. */
  #presence { display: flex; align-items: center; flex: none; gap: 2px; }
  #presence:empty { display: none; }
  #presence span { position: relative; width: 30px; height: 30px; margin-left: -6px; display: grid; place-items: center; border-radius: 50%; border: 2px solid var(--panel); background: #22262a; color: var(--muted); font-size: 11.5px; font-weight: 600; cursor: default; }
  #presence span:first-child { margin-left: 0; }
  #presence span.on { color: var(--text); }
  #presence span.here { box-shadow: 0 0 0 1.5px rgba(230,183,90,.55); }
  #presence span::after { content: ''; position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border-radius: 50%; background: #5b5f62; border: 2px solid var(--panel); }
  #presence span.on::after { background: #4fbf7a; }
  #group { margin: 0 0 14px; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.03); border: 1px solid var(--sep); }
  #group:empty { display: none; }
  #group h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  #group div { display: flex; align-items: center; gap: 8px; font-size: 13.5px; padding: 2px 0; }
  #group i { width: 8px; height: 8px; border-radius: 50%; background: #5b5f62; flex: none; }
  #group i.on { background: #4fbf7a; }
  .chat-body { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* Fondo con motivos tenues, como el papel de WhatsApp. */
  .chat-body::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .08; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='900' fill='none' stroke='%23e6b75a' stroke-width='1.1' stroke-linecap='round' stroke-linejoin='round'%3E%3Cg transform='translate(537 498) rotate(-31 12 12) scale(1.67)'%3E%3Ccircle cx='7.5' cy='12' r='4'/%3E%3Cpath d='M11.5 12H21M18 12v3M15 12v2'/%3E%3C/g%3E%3Cg transform='translate(61 201) rotate(4 12 12) scale(1.45)'%3E%3Cpath d='M6 5h11a2 2 0 0 1 2 2v12H8a2 2 0 0 1-2-2z'/%3E%3Cpath d='M6 5a2 2 0 0 0-2 2v2h2M10 10h6M10 13h6M10 16h4'/%3E%3C/g%3E%3Cg transform='translate(364 463) rotate(5 12 12) scale(1.18)'%3E%3Ccircle cx='12' cy='14' r='6'/%3E%3Cpath d='M9.5 5h5L12 8z'/%3E%3C/g%3E%3Cg transform='translate(579 105) rotate(5 12 12) scale(1.44)'%3E%3Cpath d='M10 3h4M10.5 3v5L6 16a4 4 0 0 0 3.5 5h5a4 4 0 0 0 3.5-5L13.5 8V3'/%3E%3Cpath d='M8 15h8'/%3E%3C/g%3E%3Cg transform='translate(100 604) rotate(5 12 12) scale(1.21)'%3E%3Cpath d='M6 21L18 6'/%3E%3Cpath d='M14 4c3-1 6 1 6 4-2 0-4 1-5 3l-3-3c1-2 2-3 2-4z'/%3E%3C/g%3E%3Cg transform='translate(402 777) rotate(-10 12 12) scale(1.57)'%3E%3Cpath d='M4 20h16'/%3E%3Cpath d='M6 20c1-6 3-11 7-16 1 4 3 7 5 9-2 1-3 3-3 7'/%3E%3Cpath d='M10 14l1 .5'/%3E%3C/g%3E%3Cg transform='translate(440 155) rotate(-11 12 12) scale(1.14)'%3E%3Cpath d='M6 16v-5a6 6 0 0 1 12 0v5h-2v3H8v-3z'/%3E%3Ccircle cx='9.5' cy='11.5' r='1.3'/%3E%3Ccircle cx='14.5' cy='11.5' r='1.3'/%3E%3C/g%3E%3Cg transform='translate(478 667) rotate(22 12 12) scale(1.15)'%3E%3Cpath d='M4 17h16l1-10-5 4-4-6-4 6-5-4z'/%3E%3Cpath d='M4 20h16'/%3E%3C/g%3E%3Cg transform='translate(256 625) rotate(-7 12 12) scale(1.23)'%3E%3Cpath d='M6 5h11a2 2 0 0 1 2 2v12H8a2 2 0 0 1-2-2z'/%3E%3Cpath d='M6 5a2 2 0 0 0-2 2v2h2M10 10h6M10 13h6M10 16h4'/%3E%3C/g%3E%3Cg transform='translate(248 132) rotate(-5 12 12) scale(1.34)'%3E%3Cpath d='M6 21L18 6'/%3E%3Cpath d='M14 4c3-1 6 1 6 4-2 0-4 1-5 3l-3-3c1-2 2-3 2-4z'/%3E%3C/g%3E%3Cg transform='translate(599 829) rotate(13 12 12) scale(1.43)'%3E%3Cpath d='M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z'/%3E%3Cpath d='M12 7v10M8 11h8'/%3E%3C/g%3E%3Cg transform='translate(123 725) rotate(32 12 12) scale(1.29)'%3E%3Cpath d='M12 2l9 5v10l-9 5-9-5V7z'/%3E%3Cpath d='M12 2v6M3 7l9 5 9-5M12 12v10M7.5 9.5l4.5 8 4.5-8z'/%3E%3C/g%3E%3Cg transform='translate(627 394) rotate(26 12 12) scale(1.49)'%3E%3Cpath d='M15 4a8 8 0 1 0 5 13A7 7 0 0 1 15 4z'/%3E%3C/g%3E%3Cg transform='translate(642 264) rotate(10 12 12) scale(1.65)'%3E%3Cpath d='M14.5 3.5L20 3l-.5 5.5L9 19l-4-4z'/%3E%3Cpath d='M5 15l-2 2 4 4 2-2M7.5 12.5l4 4'/%3E%3C/g%3E%3Cg transform='translate(666 642) rotate(-21 12 12) scale(1.47)'%3E%3Cpath d='M4 17h16l1-10-5 4-4-6-4 6-5-4z'/%3E%3Cpath d='M4 20h16'/%3E%3C/g%3E%3Cg transform='translate(516 302) rotate(22 12 12) scale(1.22)'%3E%3Cpath d='M6 16v-5a6 6 0 0 1 12 0v5h-2v3H8v-3z'/%3E%3Ccircle cx='9.5' cy='11.5' r='1.3'/%3E%3Ccircle cx='14.5' cy='11.5' r='1.3'/%3E%3C/g%3E%3Cg transform='translate(104 405) rotate(-11 12 12) scale(1.15)'%3E%3Cpath d='M10 3h4M10.5 3v5L6 16a4 4 0 0 0 3.5 5h5a4 4 0 0 0 3.5-5L13.5 8V3'/%3E%3Cpath d='M8 15h8'/%3E%3C/g%3E%3Cg transform='translate(828 520) rotate(-35 12 12) scale(1.39)'%3E%3Ccircle cx='7.5' cy='12' r='4'/%3E%3Cpath d='M11.5 12H21M18 12v3M15 12v2'/%3E%3C/g%3E%3Cg transform='translate(470 38) rotate(21 12 12) scale(1.19)'%3E%3Cpath d='M4 20h16'/%3E%3Cpath d='M6 20c1-6 3-11 7-16 1 4 3 7 5 9-2 1-3 3-3 7'/%3E%3Cpath d='M10 14l1 .5'/%3E%3C/g%3E%3Cg transform='translate(829 180) rotate(26 12 12) scale(1.18)'%3E%3Cpath d='M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z'/%3E%3Cpath d='M12 7v10M8 11h8'/%3E%3C/g%3E%3Cg transform='translate(657 519) rotate(19 12 12) scale(1.62)'%3E%3Cpath d='M15 4a8 8 0 1 0 5 13A7 7 0 0 1 15 4z'/%3E%3C/g%3E%3Cg transform='translate(753 72) rotate(-12 12 12) scale(1.12)'%3E%3Cpath d='M14.5 3.5L20 3l-.5 5.5L9 19l-4-4z'/%3E%3Cpath d='M5 15l-2 2 4 4 2-2M7.5 12.5l4 4'/%3E%3C/g%3E%3Cg transform='translate(223 449) rotate(26 12 12) scale(1.40)'%3E%3Cpath d='M12 2l9 5v10l-9 5-9-5V7z'/%3E%3Cpath d='M12 2v6M3 7l9 5 9-5M12 12v10M7.5 9.5l4.5 8 4.5-8z'/%3E%3C/g%3E%3Cg transform='translate(777 752) rotate(-21 12 12) scale(1.66)'%3E%3Ccircle cx='12' cy='14' r='6'/%3E%3Cpath d='M9.5 5h5L12 8z'/%3E%3C/g%3E%3C/svg%3E"); background-size: 900px 900px; }
  #log { position: relative; flex: 1; overflow-y: auto; padding: 16px max(24px, calc((100% - 980px) / 2)) 16px; display: flex; flex-direction: column; gap: 6px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.14) transparent; }
  .msg { max-width: 720px; word-wrap: break-word; }
  #log > * { flex-shrink: 0; }
  .msg .body { padding: 8px 12px 7px; border-radius: 12px; box-shadow: 0 1px 1px rgba(0,0,0,.45); }
  .msg p { margin: 0 0 .6em; } .msg p:last-child { margin: 0; }
  .msg .who { display: flex; align-items: center; gap: 5px; margin: 0 0 2px; font-size: 13px; font-weight: 600; color: var(--accent); }
  .master .body { background: var(--bubble); border-top-left-radius: 4px; }
  .player { align-self: flex-end; }
  .player .body { background: var(--mine); color: var(--mine-ink); border-top-right-radius: 4px; }
  .system .body { background: #161a1b; border: 1px solid var(--sep); color: #b8b1a6; font-size: 12.5px; white-space: normal; }
  .msg.error .body { color: var(--error); }
  .decisive { display: inline-flex; gap: 6px; margin-top: 8px; padding: 6px 10px; border-radius: 10px; background: rgba(255,107,94,.12); color: #ff9d94; font-size: 13px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .actions button, .chips button { display: inline-flex; align-items: center; height: 32px; padding: 0 14px; border: 1px solid rgba(230,183,90,.25); border-radius: 999px; background: rgba(20,22,23,.9); color: #e6c98a; font-size: 13px; font-weight: 500; white-space: nowrap; box-shadow: 0 1px 1px rgba(0,0,0,.4); }
  .actions button:hover:not(:disabled), .chips button:hover:not(:disabled) { background: #22262a; }
  .actions button.roll { background: var(--accent); border-color: transparent; color: var(--accent-ink); font-weight: 600; }
  /* Ilustración de la escena: dentro del chat; un clic la abre en grande. */
  .msg.scene { width: 100%; margin: 0; }
  .scene .shot { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0; border: 0; border-radius: 12px; overflow: hidden; background: var(--platter); cursor: zoom-in; box-shadow: 0 1px 1px rgba(0,0,0,.45); }
  .scene img { display: block; width: 100%; height: 100%; object-fit: cover; transition: opacity .4s; }
  .scene.loading img { opacity: 0; }
  .scene .shot::after { content: ''; position: absolute; inset: 55% 0 0; background: linear-gradient(transparent, rgba(0,0,0,.6)); pointer-events: none; }
  .scene figcaption { position: absolute; left: 16px; bottom: 14px; z-index: 1; text-align: left; }
  .scene figcaption b { display: block; font-weight: 600; }
  .scene figcaption span { font-size: 12px; font-weight: 500; color: #d9d3c8; }
  .scene.loading figcaption span::after { content: ' · ilustrando…'; }
  .scene .zoom { position: absolute; top: 10px; right: 10px; z-index: 1; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: var(--text); }
  #lightbox { position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 72px 40px 40px; background: rgba(5,6,6,.85); }
  #lightbox[hidden] { display: none; }
  #lightbox img { max-width: min(1120px, 100%); max-height: calc(100% - 60px); border-radius: 16px; box-shadow: var(--window-shadow); }
  #lightbox .cap { display: flex; gap: 12px; align-items: baseline; font-size: 12px; font-weight: 500; color: var(--muted); }
  #lightbox .cap b { font-size: 15px; font-weight: 600; color: var(--text); }
  #lightbox .close { position: absolute; top: 28px; right: 28px; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; color: var(--text); }

  /* Redacción: atajos, cuadro de texto, micrófono y pincel, el cubo y Enviar. */
  .compose { position: relative; z-index: 3; flex: none; background: var(--chat); }
  .chips { display: flex; gap: 8px; padding: 8px max(16px, calc((100% - 980px) / 2)) 10px; overflow-x: auto; scrollbar-width: none; }
  .chips button { border-color: rgba(255,255,255,.1); color: #b8b1a6; font-family: var(--mono); font-size: 12px; letter-spacing: 0; }
  body.drawer-open .chips { display: none; }
  /* Al ancho del hilo (#log): el campo y sus botones no ocupan toda la pantalla. */
  form { display: flex; align-items: center; gap: 6px; margin: 0; padding: 8px max(24px, calc((100% - 980px) / 2)); background: var(--panel); border-top: 1px solid var(--sep); }
  form input { flex: 1; min-width: 0; height: 36px; padding: 0 16px; border: 0; border-radius: 10px; background: var(--control); outline: none; font-size: 15px; }
  form input::placeholder { color: var(--faint); }
  form input:focus { box-shadow: 0 0 0 1.5px rgba(230,183,90,.55); }
  form button { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border: 0; border-radius: 50%; background: transparent; color: #b8b1a6; }
  form button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  form button[type=submit] { background: var(--accent); color: var(--accent-ink); }
  form button[type=submit]:hover:not(:disabled) { background: var(--glow); color: var(--accent-ink); }
  form button[type=submit] svg.i { width: 16px; height: 16px; }
  #cube svg.i { width: 18px; height: 18px; }
  #cube.on { background: var(--accent-tint); color: var(--accent); box-shadow: inset 0 0 0 1.5px rgba(230,183,90,.5); }
  #cube { position: relative; }
  #cube.new::after { content: ''; position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--panel); }

  /* Menú del cubo: Hoja, Diario y Mochila. */
  #cube-menu { position: absolute; right: 58px; bottom: 66px; z-index: 25; width: 270px; padding: 6px; border-radius: 16px; background: var(--bubble); border: 1px solid var(--line); box-shadow: var(--window-shadow); }
  #cube-menu[hidden] { display: none; }
  #cube-menu button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 6px 10px; border: 0; border-radius: 12px; background: transparent; color: var(--text); text-align: left; }
  #cube-menu button:hover, #cube-menu button:focus-visible { background: var(--hover); outline: none; }
  #cube-menu .bub { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 50%; }
  #cube-menu .bub svg.i { stroke-width: 2; }
  #cube-menu .bub.sheet { background: var(--accent); color: var(--accent-ink); }
  #cube-menu .bub.journal { background: #6cc7b8; color: #0d2a26; }
  #cube-menu .bub.pack { background: #e0956a; color: #2e1607; }
  #cube-menu b { display: flex; align-items: center; font-size: 14.5px; font-weight: 600; }
  #cube-menu small { display: block; font-size: 12px; color: var(--muted); }
  #cube-menu .dotnew { width: 8px; height: 8px; margin-left: 8px; border-radius: 50%; background: var(--accent); }
  #cube-menu .dotnew[hidden] { display: none; }
  #cube-scrim { display: none; }

  /* Hoja, Diario y Mochila, en la misma columna del chat. */
  #drawer { position: absolute; top: 24px; bottom: 16px; left: 50%; z-index: 5; width: min(760px, calc(100% - 48px)); transform: translateX(-50%); display: flex; flex-direction: column; background: var(--panel); border-radius: 18px; border: 1px solid var(--line); box-shadow: 0 24px 64px rgba(0,0,0,.6); overflow: hidden; }
  #drawer[hidden] { display: none; }
  #drawer-scrim { position: absolute; inset: 0; z-index: 4; display: block; border: 0; background: rgba(5,6,6,.62); }
  #drawer-scrim[hidden] { display: none; }
  .dr-grab { display: none; }
  .dr-head { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 8px 12px 8px 16px; border-bottom: 1px solid var(--sep); flex: none; flex-wrap: wrap; }
  .dr-back { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px 0 8px; border: 0; border-radius: 999px; background: rgba(255,255,255,.06); color: var(--text); font-size: 13px; font-weight: 500; }
  .dr-back:hover { background: rgba(255,255,255,.1); }
  #dr-title { margin: 0 0 0 4px; font: 700 16px/1.2 var(--display); letter-spacing: -.02em; }
  .dr-head .seg { margin-left: auto; }
  .dr-head { padding-left: 20px; }
  .dr-head .seg button { position: relative; }
  .dr-head .seg button.new::after { content: ''; position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .dr-x { display: none; }
  .dr-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.12) transparent; }
  .dr-pane { max-width: 720px; margin: 0 auto; padding: 16px 16px 28px; }
  .dr-pane[hidden] { display: none; }
  .dr-pane .none { display: none; color: var(--faint); font-size: 13px; }
  .dr-pane > div:empty + .none { display: block; }
  .kv-t { margin: 18px 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .kv-t:first-child { margin-top: 0; }

  /* Hoja. */
  .sh-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
  .sh-head .av { width: 60px; height: 60px; flex: none; display: grid; place-items: center; border-radius: 50%; overflow: hidden; background: #2a1d05; box-shadow: inset 0 0 0 2px var(--accent); color: var(--accent); font-size: 22px; font-weight: 600; }
  .sh-head .av img { width: 100%; height: 100%; object-fit: cover; }
  .sh-head h2 { margin: 0; font: 700 20px/1.2 var(--display); letter-spacing: -.02em; }
  .sh-head p { margin: 3px 0 0; font-size: 13px; color: var(--muted); white-space: pre-line; }
  .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 10px 4px; border-radius: 12px; background: var(--platter); border: 1px solid var(--sep); text-align: center; }
  .tile b { font-size: 17px; font-weight: 600; }
  .tile small { font-size: 11px; color: var(--muted); }
  .tile.death { border-color: #6b3a36; background: rgba(120, 40, 36, 0.18); }
  #card .respawn { margin-top: 8px; padding: 6px 10px; border-radius: 10px; font-size: 12px; color: #e8c9c4; background: rgba(120, 40, 36, 0.25); }
  .tile.wide { grid-column: 1 / -1; align-items: stretch; text-align: left; padding: 12px 14px; gap: 8px; }
  .tile.wide .l { display: flex; font-size: 13px; color: #b8b1a6; } .tile.wide .l b { margin-left: auto; font-size: 13px; color: var(--text); }
  .tile.wide .bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; }
  .tile.wide .bar i { display: block; height: 100%; border-radius: 999px; background: var(--ok); }
  .tile.wide .bar i.low { background: var(--accent); } .tile.wide .bar i.crit { background: var(--error); }
  .tile.wide small { font-size: 12px; }
  .ab { gap: 2px; }
  .ab small:first-child { font-weight: 600; }
  .ab b { font: 800 22px/1.1 var(--display); }
  .ab.save { border-color: rgba(230,183,90,.3); } .ab.save small:first-child { color: var(--accent); }
  .lines > div { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 4px; border-bottom: 1px solid rgba(255,255,255,.05); font-size: 14.5px; }
  .lines .v { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 30px; padding: 0 8px; border-radius: 8px; background: var(--accent-tint); color: #e6c98a; font-weight: 600; }
  .lines .v.plain { background: rgba(255,255,255,.06); color: #d9d3c8; font-weight: 500; font-size: 13px; }
  .sh-foot { margin-top: 16px; font-size: 12px; color: var(--faint); }

  /* Mochila. */
  .items > div { display: flex; align-items: center; gap: 12px; min-height: 52px; border-bottom: 1px solid rgba(255,255,255,.05); }
  .items .tag { display: grid; place-items: center; width: 38px; height: 38px; flex: none; border-radius: 10px; background: var(--control); border: 1px solid var(--line); color: #b8b1a6; }
  .items .tag.eq { background: var(--accent-tint); border-color: rgba(230,183,90,.28); color: var(--accent); }
  .items .tt { min-width: 0; flex: 1; font-size: 14.5px; }
  .items .tt small { display: block; font-size: 12.5px; color: var(--muted); }
  .items .empty { min-height: 0; padding: 6px 0; border: 0; color: var(--faint); font-size: 13px; }

  /* Diario (contenido de journal.ts), con el aire del resto. */
  #journal .jnav { display: flex; gap: 8px; margin: 0 0 14px; overflow-x: auto; scrollbar-width: none; }
  #journal .jnav button { flex: none; height: 32px; padding: 0 14px; border: 1px solid rgba(255,255,255,.08); border-radius: 999px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 500; }
  #journal .jnav button.on { background: var(--accent-tint); border-color: rgba(230,183,90,.3); color: var(--accent); }
  #journal h3 { display: flex; align-items: baseline; gap: 6px; margin: 16px 2px 8px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  #journal h3:first-child { margin-top: 2px; }
  #journal h3 span { font-weight: 500; letter-spacing: 0; text-transform: none; }
  #journal .empty { margin: 4px 2px 10px; color: var(--faint); font-size: 13px; }
  #journal details { margin: 0 0 6px; border-radius: 12px; background: var(--platter); border: 1px solid var(--sep); overflow: hidden; }
  #journal details[open] { background: #1d2124; }
  #journal summary { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; list-style: none; }
  #journal summary::-webkit-details-marker { display: none; }
  #journal summary .tt { flex: 1; min-width: 0; }
  #journal summary b { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #journal summary small { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #journal summary .st { flex: none; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--control); color: var(--muted); font-size: 11px; font-weight: 600; line-height: 20px; white-space: nowrap; }
  #journal .q.active summary .st { color: var(--accent); background: var(--accent-tint); }
  #journal .q.completed summary .st { color: var(--ok); background: rgba(79,191,122,.14); }
  #journal .q.expired summary .st { color: var(--faint); }
  #journal .q.main summary .st { color: var(--accent-ink); background: var(--accent); }
  #journal .q.main summary b { color: var(--accent); }
  #journal summary .chev { flex: none; width: 14px; height: 14px; color: var(--faint); transition: transform .2s; }
  #journal details[open] summary .chev { transform: rotate(90deg); }
  #journal .qb { padding: 0 12px 12px; font-size: 13px; }
  #journal .qb p { margin: 0 0 8px; }
  #journal .qb .muted { color: var(--muted); }
  #journal .clock { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 8px; padding: 5px 10px; border-radius: 999px; background: var(--accent-tint); color: var(--accent); font-size: 12px; font-weight: 600; }
  #journal .clock.late { background: rgba(255,107,94,.14); color: #ff9d94; }
  #journal .steps { margin: 0 0 8px; padding: 0; list-style: none; }
  #journal .steps li { display: flex; gap: 8px; padding: 3px 0; }
  #journal .steps li::before { content: ''; flex: none; width: 14px; height: 14px; margin-top: 3px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--faint); }
  #journal .steps li.done { color: var(--muted); text-decoration: line-through; }
  #journal .steps li.done::before { background: var(--ok); box-shadow: none; }
  #journal .paths b, #journal .mem b { display: block; margin: 8px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  #journal .paths ol { margin: 0 0 8px; padding-left: 18px; color: var(--muted); }
  #journal .paths li { padding: 2px 0; }
  #journal .rumor { margin: 0 0 8px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.04); color: var(--muted); font-size: 12.5px; font-style: italic; }
  #journal .rumor b { color: var(--text); font-style: normal; font-weight: 600; }
  #journal .rumor small { display: block; margin-top: 3px; font-style: normal; color: var(--faint); }
  #journal .dates { margin-top: 6px; font-size: 11.5px; color: var(--faint); }
  /* Misiones: icono por estado, seguir una, novedad, resumen y lo que te dijeron. */
  .qi { position: relative; flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: var(--control); color: var(--muted); }
  .qi svg.i { width: 16px; height: 16px; }
  .qi.active { background: var(--accent-tint); color: var(--accent); }
  .qi.completed { background: rgba(79,191,122,.14); color: var(--ok); }
  .qi.expired { color: var(--faint); opacity: .7; }
  #journal .qdrop { margin-top: 8px; background: none; border: 1px solid var(--line); color: var(--faint); border-radius: 8px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }
  #journal .qdrop:hover { color: var(--text); }
  .qi.main { background: var(--accent); color: var(--accent-ink); }
  .qi .nw { position: absolute; top: -3px; right: -3px; width: 12px; height: 12px; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--panel); }
  .qi .nw svg.i { width: 9px; height: 9px; stroke-width: 2.4; }
  #journal .q.isnew { box-shadow: inset 0 0 0 1.5px rgba(230,183,90,.45); }
  #journal .orig { margin: 0 0 8px; font-size: 12.5px; color: var(--muted); }
  #journal .orig b { color: var(--faint); font-weight: 600; }
  #journal .hist { margin: 4px 0 8px; padding: 0; list-style: none; border-top: 1px solid var(--sep); }
  #journal .hist > b { display: block; margin: 8px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  #journal .hist li { display: flex; gap: 8px; padding: 3px 0; font-size: 12.5px; color: var(--muted); }
  #journal .hist li .t { flex: none; min-width: 40px; max-width: 120px; color: var(--faint); font-size: 11.5px; padding-top: 1px; font-variant-numeric: tabular-nums; }
  #journal .hist li small { display: block; color: var(--faint); }
  #journal .hist li.unseen { color: var(--text); }
  #journal .hist li.unseen .t { color: var(--accent); }
  #journal .hist li.unseen::before { content: ''; flex: none; width: 6px; height: 6px; margin: 6px -4px 0 0; border-radius: 50%; background: var(--accent); }
  /* Indicador de misiones en el panel: punto con el número de altas y check con el de pasos y cierres sin leer. */
  .qflag { position: relative; display: inline-grid; place-items: center; width: 18px; height: 18px; color: var(--faint); }
  .qflag svg.i { width: 15px; height: 15px; }
  .qflag.on { color: var(--accent); }
  .qbadge { display: inline-flex; align-items: center; gap: 4px; margin-left: 2px; }
  .qbadge i { display: inline-flex; align-items: center; gap: 2px; height: 17px; padding: 0 6px; border-radius: 999px; font-style: normal; font-size: 11px; font-weight: 700; letter-spacing: 0; line-height: 17px; }
  .qbadge i.dot { background: var(--accent); color: var(--accent-ink); }
  .qbadge i.dot::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .qbadge i.chk { background: rgba(79,191,122,.18); color: var(--ok); }
  #to-side.new::after { content: ''; position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--panel); }
  #to-side { position: relative; }
  #journal summary .trk { flex: none; display: grid; place-items: center; width: 30px; height: 30px; margin: -4px -4px -4px 0; border: 0; border-radius: 50%; background: transparent; color: var(--faint); cursor: pointer; }
  #journal summary .trk:hover { background: var(--hover); color: var(--text); }
  #journal summary .trk.on { color: var(--accent); }
  #journal summary .trk.on svg { fill: currentColor; }
  #journal .qb .sum { margin: 0 0 8px; color: var(--text); }
  #journal .qb .now { display: flex; gap: 6px; margin: 0 0 8px; color: var(--accent); font-weight: 600; }
  #journal .qb .now::before { content: '→'; }
  #journal .told { margin: 0 0 6px; padding: 7px 10px; border-left: 2px solid rgba(230,183,90,.45); border-radius: 0 10px 10px 0; background: rgba(255,255,255,.035); font-size: 12.5px; color: var(--muted); }
  #journal .told b { color: var(--text); font-weight: 600; }
  #journal .told small { display: block; margin-top: 2px; color: var(--faint); }
  #journal .qb .rw { margin-top: 6px; font-size: 11.5px; color: var(--faint); }
  #journal details.rumors summary b { font-size: 13px; }
  .sec-row { display: flex; align-items: center; gap: 6px; padding-right: 10px; }
  .sec-row .sec-t { flex: 1; min-width: 0; }
  .qnew { display: inline-flex; align-items: center; gap: 4px; height: 22px; margin-left: 6px; padding: 0 8px; border: 0; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font: 600 11px/1 var(--sans); cursor: pointer; vertical-align: 1px; }
  .qnew svg.i { width: 11px; height: 11px; stroke-width: 2.2; }
  .qchip { flex: none; margin: 8px 12px 0 6px; padding: 0; border: 0; background: none; cursor: pointer; }
  /* «Cerca de ti» solo en el tablero o el mapa ampliados, como columna junto al plano. */
  body:not(.board-big):not(.map-big) #near { display: none; }
  body.board-big #near, body.map-big #near { position: fixed; top: 40px; right: 40px; bottom: 40px; z-index: 22; width: 300px; overflow: auto; padding: 14px 10px; border-radius: 0 20px 20px 0; background: var(--panel); box-shadow: inset 1px 0 0 var(--sep); }
  body.board-big #board, body.map-big #map { right: 340px; border-radius: 20px 0 0 20px; }
  body.board-big #near .sec-b, body.map-big #near .sec-b { display: block !important; }
  #journal .pt { position: relative; flex: none; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; overflow: hidden; background: rgba(255,255,255,.06); color: var(--npc, #e6a587); box-shadow: inset 0 0 0 1.5px currentColor; font-size: 13px; font-weight: 600; }
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
  #journal .en.progress { color: var(--accent); } #journal .en.combat { color: #ff9d94; } #journal .en.roll { color: var(--muted); } #journal .en.rumor, #journal .en.note { color: var(--muted); font-style: italic; }
  #journal .pl { display: flex; align-items: center; gap: 10px; padding: 9px 12px; margin-bottom: 6px; border-radius: 12px; background: var(--platter); border: 1px solid var(--sep); }
  #journal .pl i { flex: none; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--muted); background: #17181d; }
  #journal .pl.visited i { border-color: var(--ok); } #journal .pl.heard_of i { border-style: dashed; }
  #journal .pl.here i { border-color: var(--accent); box-shadow: 0 0 8px var(--glow); }
  #journal .pl b { display: block; font-size: 13.5px; font-weight: 600; } #journal .pl small { color: var(--muted); font-size: 12px; }
  /* Aviso de una línea en el hilo (tablón, progreso): nada de burbuja, solo un enlace al Diario. */
  .msg.notice { align-self: center; display: flex; flex-wrap: wrap; justify-content: center; gap: 0 6px; margin: 6px 0 0; padding: 5px 12px; border-radius: 8px; background: #161a1b; border: 1px solid var(--sep); box-shadow: 0 1px 1px rgba(0,0,0,.4); font-size: 12.5px; font-weight: 500; color: #b8b1a6; text-align: center; }
  .msg.notice .link { border: 0; padding: 0; background: none; color: var(--accent); font-size: 12.5px; font-weight: 500; }
  .msg.notice .link::before { content: '· '; color: var(--faint); }
  .msg.notice .link:hover { text-decoration: underline; }
  /* Avisos de misión: destacados, con lo que ha pasado y, debajo, por qué. */
  .msg.notice.quest { max-width: min(92%, 520px); padding: 7px 14px; border-color: rgba(230,183,90,.45); background: #1f1b12; color: var(--text); font-size: 13px; }
  .msg.notice.quest > span:first-child::before { content: '✦ '; color: var(--accent); }
  .msg.notice.q-step > span:first-child::before, .msg.notice.q-done > span:first-child::before { content: '✔ '; color: var(--ok); }
  .msg.notice.q-done { border-color: rgba(79,191,122,.5); background: #142019; }
  .msg.notice.q-failed > span:first-child::before, .msg.notice.q-expired > span:first-child::before, .msg.notice.q-dropped > span:first-child::before { content: '✕ '; color: var(--faint); }
  .msg.notice.q-failed, .msg.notice.q-expired, .msg.notice.q-dropped { border-color: var(--sep); background: #161a1b; }
  .msg.notice .why { flex-basis: 100%; margin-top: 2px; font-size: 12px; font-weight: 400; color: var(--muted); }

  /* Móvil: el chat a pantalla completa; el panel, una vista aparte; Hoja, Diario y Mochila suben desde abajo. */
  @media (max-width: 820px) {
    aside { display: none; flex: 1; border-right: 0; }
    body.show-side aside { display: flex; }
    body.show-side #play { display: none; }
    #side-close { display: inline-grid; }
    #to-side { display: inline-grid; }
    .chat-head { height: auto; min-height: 60px; padding: 8px 8px 8px 6px; gap: 8px; }
    .chat-head .dot { width: 38px; height: 38px; }
    #party button { width: 28px; height: 28px; }
    #log { padding: 12px 10px 8px; }
    #thinking { padding: 0 12px; }
    .chips { padding: 8px 12px; }
    form { padding: 8px 8px calc(8px + env(safe-area-inset-bottom)) 12px; }
    form input { border-radius: 21px; }
    #cube-scrim { position: absolute; inset: 0; z-index: 24; display: block; border: 0; background: rgba(5,6,6,.6); }
    #cube-scrim[hidden] { display: none; }
    #cube-menu { right: 50px; left: auto; bottom: 74px; width: auto; padding: 0; background: transparent; border: 0; box-shadow: none; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
    #cube-menu[hidden] { display: none; }
    #cube-menu button { flex-direction: row-reverse; width: auto; min-height: 32px; padding: 0; gap: 10px; background: transparent; }
    #cube-menu button:hover { background: transparent; }
    #cube-menu .bub { width: 32px; height: 32px; box-shadow: 0 6px 16px rgba(0,0,0,.55); }
    #cube-menu .lbl { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 999px; background: var(--bubble); box-shadow: 0 4px 12px rgba(0,0,0,.5); }
    #cube-menu small { display: none; }
    #drawer-scrim { position: absolute; inset: 0; z-index: 4; display: block; border: 0; background: rgba(5,6,6,.6); }
    #drawer-scrim[hidden] { display: none; }
    #drawer { top: 24px; bottom: 0; left: 0; width: 100%; transform: none; z-index: 5; border: 0; border-radius: 20px 20px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.5); }
    .dr-grab { display: block; align-self: center; width: 40px; height: 4px; margin: 8px 0 0; border-radius: 999px; background: rgba(255,255,255,.2); }
    #dr-title { display: none; }
    .dr-head { padding-left: 16px; }
    .dr-head .seg { margin-left: 0; }
    body.map-big #map, body.board-big #board { inset: 12px; bottom: 42vh; border-radius: 20px 20px 0 0; }
    body.board-big #near, body.map-big #near { top: auto; left: 12px; right: 12px; bottom: 12px; width: auto; height: calc(42vh - 12px); border-radius: 0 0 20px 20px; box-shadow: inset 0 1px 0 var(--sep); }
  }
${VOICE_STYLE}
${TTS_STYLE}
${SFX_STYLE}
${AVATAR_STYLE}
${NOVEL_STYLE}
${PAINT_STYLE}
  /* B5 sobre los módulos (novel, tts, sfx, voz, pincel, avatar): mismas piezas, otra piel. */
  .msg.row { gap: 8px; margin-top: 8px; max-width: min(760px, 100%); }
  .msg.scene, .moment.combat, .moment.discovery, .moment.manual { width: min(640px, calc(100% - 42px)); }
  .msg.system { max-width: min(720px, 100%); }
  .msg.row .body { padding: 8px 12px 7px; border-radius: 12px; box-shadow: 0 1px 1px rgba(0,0,0,.45); }
  .msg.row:not(.cont):not(.mine) .body { border-top-left-radius: 4px; }
  .msg.row.mine:not(.cont) .body { border-top-right-radius: 4px; }
  .msg.row.master .body, .msg.row.npc .body { background: var(--bubble); }
  .msg.row.mine .body { background: var(--mine); color: var(--mine-ink); box-shadow: 0 1px 1px rgba(0,0,0,.45); }
  .msg.row .who { font-size: 13px; }
  .msg.row.master .who { color: var(--accent); }
  .nv-av { width: 34px; height: 34px; box-shadow: 0 1px 2px rgba(0,0,0,.5), inset 0 0 0 1.5px currentColor; }
  .msg.row.master .nv-av { background: #22262a; }
  .msg.row.mine .nv-av { background: #2a1d05; }
  .msg.system { margin: 8px 0 2px; }
  .msg.system .body { background: #161a1b; border: 1px solid var(--sep); color: #b8b1a6; box-shadow: 0 1px 1px rgba(0,0,0,.4); border-radius: 8px; }
  .moment .shot, .scene .shot { border-radius: 12px; box-shadow: 0 1px 1px rgba(0,0,0,.45); }
  .msg.chapter { border-radius: 12px; background: var(--bubble); box-shadow: 0 1px 1px rgba(0,0,0,.45), inset 0 0 0 1px rgba(230,183,90,.18); }
  .msg.chapter h2 { font: 800 22px/1.25 var(--display); letter-spacing: -.02em; }
  .msg.chapter .body { font: 16px/1.65 var(--sans); background: none; box-shadow: none; text-align: left; hyphens: manual; }
  #journal .en.chapter > span:last-child { font-family: var(--sans); }
  /* Sonido y narrador en la cabecera del chat: botones redondos, sin texto. */
  .chat-head .sfx { margin-left: 0; height: 32px; background: transparent; }
  .chat-head .sfx + .tts { margin-left: 0; }
  .chat-head .tts { margin-left: 0; gap: 2px; }
  .sfx > button, .tts > button { height: 32px; background: transparent; }
  .sfx > .sfx-toggle span, .tts > .tts-auto span { display: none; }
  .sfx > .sfx-toggle { width: 32px; padding: 0; justify-content: center; border-radius: 50%; }
  .sfx > .sfx-more { width: 22px; padding: 0; border-radius: 50%; }
  .tts > .tts-auto, .tts > .tts-more { width: 32px; padding: 0; justify-content: center; border-radius: 50%; }
  .tts > .tts-stop { border-radius: 999px; }
  .sfx.on { background: transparent; }
  .sfx.on > .sfx-toggle, .tts > button.on { background: var(--accent-tint); }
  .tts-pop, .sfx-pop { top: 44px; border-radius: 16px; background: var(--bubble); box-shadow: var(--window-shadow); }
  /* Hacer / Decir: lo que escribes lo hace tu personaje (al narrador) o lo dice tal cual (a los demás, sin narrador). */
  form button.mode { width: auto; min-width: 58px; white-space: nowrap; height: 32px; padding: 0 10px; border-radius: 16px; font: 600 12.5px/1 var(--sans); letter-spacing: 0; background: var(--control); color: #b8b1a6; }
  form button.mode[hidden] { display: none; }
  form button.mode.say { background: var(--accent-tint); color: var(--accent); box-shadow: inset 0 0 0 1.5px rgba(230,183,90,.45); }
  form button.mode .to { display: inline-block; max-width: 110px; margin-left: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; font-weight: 500; }
  form.say input { box-shadow: 0 0 0 1.5px rgba(230,183,90,.35); }
  /* Otro jugador escribiendo y la ronda de una escena tensa: una línea encima del cuadro. */
  /* «Esperando a <jugador>» cuando la acción va en cola (multijugador); el resto de la espera son los puntos del hilo. */
  #thinking { position: relative; min-height: 0; padding: 0 max(24px, calc((100% - 980px) / 2)); color: var(--muted); font-size: 13px; }
  #thinking:not(:empty) { padding-bottom: 8px; }
  #typing { padding: 2px 18px 0; font-size: 12.5px; font-style: italic; color: var(--muted); min-height: 0; }
  #presence span.away { opacity: .45; filter: grayscale(1); }
  .round-banner { margin: 6px 16px 0; padding: 7px 12px; border-radius: 12px; font: 600 13px/1.3 var(--sans); background: rgba(214,96,74,.14); color: #f0b3a3; box-shadow: inset 0 0 0 1px rgba(214,96,74,.35); }
  .round-banner.mine { background: var(--accent-tint); color: var(--accent); box-shadow: inset 0 0 0 1px rgba(230,183,90,.35); }
  .actions.party button.accept { background: var(--accent); color: var(--accent-ink); }
  /* Micrófono y pincel dentro del cuadro de redacción, del mismo tamaño que el cubo. */
  form .mic, form .brush { width: 32px; height: 32px; margin: 0; }
  form .mic svg.i, form .brush svg.i { width: 18px; height: 18px; }

  /* Entrada en la partida. Mientras carga (body.boot): el cuadro de texto encogido a la izquierda con un brillo de
     carga, la ventana del chat vacía y reducida a una franja abajo, y el panel sin contenido. Al llegar el historial
     (body.entered): el cuadro crece, la ventana se abre hacia arriba, los mensajes aparecen con un fundido y los
     bloques del panel entran uno tras otro con un pequeño rebote. */
  .inwrap { max-width: 100%; transition: max-width .65s cubic-bezier(.2,.8,.2,1); }
  .chat-body { clip-path: inset(0 0 0 0); transition: clip-path .75s cubic-bezier(.22,.9,.25,1) .1s; }
  #log { transition: opacity .55s ease .7s; }
  body.boot .inwrap { max-width: 48px; }
  body.boot form input { color: transparent; pointer-events: none; background: linear-gradient(100deg, rgba(255,255,255,.05) 30%, rgba(240,197,107,.22) 50%, rgba(255,255,255,.05) 70%) 0 0 / 300% 100%; animation: boot-shine 1.2s linear infinite; }
  body.boot form input::placeholder { color: transparent; }
  .inwrap .mic { transition: opacity .3s ease .55s; }
  body.boot .inwrap .mic { opacity: 0; pointer-events: none; transition: none; }
  body.boot .chat-body { clip-path: inset(calc(100% - 1px) 0 0 0); opacity: 0; }
  /* El cuadro y la ventana no se ven mientras carga: aparecen justo al empezar a moverse. */
  .chat-body { transition: clip-path .75s cubic-bezier(.22,.9,.25,1) .1s, opacity .15s ease .1s; }
  .inwrap { transition: max-width .65s cubic-bezier(.2,.8,.2,1), opacity .15s ease; }
  body.boot .inwrap { opacity: 0; }
  /* Mientras se monta todo es negro (no gris); cuando ya está montado, panel, cabecera y barra vuelven a su gris. */
  .chat-body { background: var(--chat); }
  aside, .chat-head, form, #play, .compose { transition: background-color .8s ease; }
  body.boot aside, body.boot .chat-head, body.boot form, body.boot #play, body.boot .compose,
  body.entered aside, body.entered .chat-head, body.entered form, body.entered #play, body.entered .compose { background-color: #000; box-shadow: none; }
  body.boot aside, body.boot .chat-head, body.boot form, body.boot #play, body.boot .compose { transition: none; }
  body.boot #log, body.boot #thinking, body.boot .chips { opacity: 0; }
  body.boot .side-head, body.boot .side-scroll > *, body.boot .chat-head > * { opacity: 0; }
  /* Llegada desde el menú: la página aparece desde negro. */
  body::before { content: ''; position: fixed; inset: 0; z-index: 100; background: #000; pointer-events: none; animation: from-black .7s ease 1.2s both; }
  @keyframes from-black { from { opacity: 1; } to { opacity: 0; visibility: hidden; } }
  @keyframes boot-shine { from { background-position: 100% 0; } to { background-position: -50% 0; } }
  @keyframes enter-pop { 0% { opacity: 0; transform: translateY(16px) scale(.98); } 65% { opacity: 1; transform: translateY(-4px) scale(1.005); } 82% { transform: translateY(1.5px); } 100% { opacity: 1; transform: none; } }
  @keyframes enter-fade { from { opacity: 0; } to { opacity: 1; } }
  body.entered .side-head, body.entered .side-scroll > * { animation: enter-pop .62s cubic-bezier(.2,.8,.25,1) both; }
  body.entered .side-head { animation-delay: .15s; }
  body.entered #card { animation-delay: .25s; }
  body.entered .views { animation-delay: .35s; }
  body.entered .pane { animation-delay: .43s; }
  body.entered #near { animation-delay: .53s; }
  body.entered #quest { animation-delay: .63s; }
  body.entered .chat-head > * { animation: enter-fade .45s ease .25s both; }
  body.entered .chips { animation: enter-fade .45s ease .85s both; }
  body.boot form > button { opacity: 0; }
  body.entered form > button { animation: enter-fade .35s ease both; }
  body.entered form > button:nth-of-type(1) { animation-delay: 0.68s; }
  body.entered form > button:nth-of-type(2) { animation-delay: 0.78s; }
  body.entered form > button:nth-of-type(3) { animation-delay: 0.88s; }
  body.entered form > button:nth-of-type(4) { animation-delay: 0.98s; }
  body.entered form > button:nth-of-type(5) { animation-delay: 1.08s; }
  body.entered #card .stats > div { animation: enter-pop .55s cubic-bezier(.2,.8,.25,1) both; }
  body.entered #card .stats > div:nth-child(1) { animation-delay: 0.38s; }
  body.entered #card .stats > div:nth-child(2) { animation-delay: 0.45s; }
  body.entered #card .stats > div:nth-child(3) { animation-delay: 0.52s; }
  body.entered #card .stats > div:nth-child(4) { animation-delay: 0.59s; }
  body.entered #card .stats > div:nth-child(5) { animation-delay: 0.66s; }
  body.entered #near, body.entered #quest { animation: none; }
  body.entered .sec-t, body.entered .sec-b > .prow { animation: enter-pop .55s cubic-bezier(.2,.8,.25,1) both; }
  body.entered #near .sec-t { animation-delay: .58s; }
  body.entered #near .sec-b > .prow:nth-child(1) { animation-delay: 0.64s; }
  body.entered #near .sec-b > .prow:nth-child(2) { animation-delay: 0.70s; }
  body.entered #near .sec-b > .prow:nth-child(3) { animation-delay: 0.76s; }
  body.entered #near .sec-b > .prow:nth-child(4) { animation-delay: 0.82s; }
  body.entered #near .sec-b > .prow:nth-child(5) { animation-delay: 0.88s; }
  body.entered #near .sec-b > .prow:nth-child(6) { animation-delay: 0.94s; }
  body.entered #near .sec-b > .prow:nth-child(7) { animation-delay: 1.00s; }
  body.entered #near .sec-b > .prow:nth-child(8) { animation-delay: 1.06s; }
  body.entered #quest .sec-t { animation-delay: 1.1s; }
  body.entered #quest .sec-b > .prow { animation-delay: 1.16s; }
  body.entered .chips { animation: none; }
  body.boot .chips button { opacity: 0; }
  body.entered .chips button { animation: enter-pop .5s cubic-bezier(.2,.8,.25,1) both; }
  body.entered .chips button:nth-child(1) { animation-delay: 0.95s; }
  body.entered .chips button:nth-child(2) { animation-delay: 1.00s; }
  body.entered .chips button:nth-child(3) { animation-delay: 1.05s; }
  body.entered .chips button:nth-child(4) { animation-delay: 1.10s; }
  body.entered .chips button:nth-child(5) { animation-delay: 1.15s; }
  body.entered .chips button:nth-child(6) { animation-delay: 1.20s; }
  body.entered .chips button:nth-child(7) { animation-delay: 1.25s; }
  body.entered .chips button:nth-child(8) { animation-delay: 1.30s; }
  body.entered .chips button:nth-child(9) { animation-delay: 1.35s; }
  body.entered .chips button:nth-child(10) { animation-delay: 1.40s; }
  @media (prefers-reduced-motion: reduce) {
    .inwrap, .chat-body, #log { transition: none; }
    body.boot form input { animation: none; }
    body::before { animation-duration: .01s; }
    body.entered .side-head, body.entered .side-scroll > *, body.entered .chat-head > *, body.entered .chips, body.entered .chips button, body.entered form > button, body.entered #card .stats > div, body.entered .sec-t, body.entered .sec-b > .prow { animation: none; }
  }
  /* Avisos del sistema (tiradas, consultas): una pastilla centrada de color muy suave; verde si sale bien, azul si
     es neutro y rojo si sale mal. */
  .msg.system { margin: 8px 0 2px; }
  .msg.system .body { display: inline-block; padding: 5px 14px; border-radius: 999px; font-size: 13px; line-height: 1.45; box-shadow: none; background: rgba(99,170,255,.09); border: 1px solid rgba(99,170,255,.22); color: #b4d3f7; }
  .msg.system.tone-good .body { background: rgba(79,191,122,.10); border-color: rgba(79,191,122,.26); color: #a6dfbb; }
  .msg.system.tone-bad .body, .msg.system.error .body { background: rgba(255,107,94,.10); border-color: rgba(255,107,94,.26); color: #ffb0a8; }
  /* Tirar: un botón redondo solo con el icono del d20, que se balancea de vez en cuando para invitar a pulsarlo. */
  .actions button.roll { width: 40px; height: 40px; padding: 0; justify-content: center; border-radius: 50%; }
  .actions button.roll svg.d20 { width: 24px; height: 24px; stroke-width: 1.6; }
  .actions button.roll:not(:disabled) svg.d20 { animation: d20-wiggle 2.4s ease-in-out infinite; transform-origin: 50% 55%; }
  .actions button.roll:not(:disabled):hover svg.d20 { animation-duration: .6s; }
  @keyframes d20-wiggle { 0%, 70%, 100% { transform: rotate(0); } 76% { transform: rotate(-16deg); } 84% { transform: rotate(14deg); } 92% { transform: rotate(-6deg); } }
  .actions button.roll svg.d20 rect { fill: none; transition: fill .15s; }
  .actions button.roll svg.d20 circle, .actions button.roll svg.d20 text { fill: currentColor; stroke: none; }
  .actions button.roll svg.d20 text { font: 800 9px/1 var(--display); }
  /* Hover: el botón se ilumina y la cara del dado se vuelve blanca, con el borde y los puntos negros. */
  .actions button.roll:hover:not(:disabled) { background: var(--glow); }
  .actions button.roll:hover:not(:disabled) svg.d20 rect, .actions button.roll.rolling svg.d20 rect, .actions button.roll.landed svg.d20 rect { fill: #fff; stroke: #2a1d05; }
  .actions button.roll:hover:not(:disabled) svg.d20 circle, .actions button.roll.rolling svg.d20 circle, .actions button.roll.landed svg.d20 circle, .actions button.roll.landed svg.d20 text { fill: #2a1d05; }
  .actions button.roll.rolling svg.d20 { animation: die-shake .24s linear infinite; }
  .actions button.roll.landed:disabled { opacity: 1; background: var(--accent); color: var(--accent-ink); }
  .actions button.roll.landed svg.d20 { animation: die-land .4s cubic-bezier(.2,1.5,.35,1); }
  @keyframes die-shake { 0% { transform: rotate(-14deg) translateY(0); } 25% { transform: rotate(10deg) translateY(-1.5px); } 50% { transform: rotate(-8deg) translateY(.5px); } 75% { transform: rotate(14deg) translateY(-1px); } 100% { transform: rotate(-14deg) translateY(0); } }
  @keyframes die-land { 0% { transform: scale(.8) rotate(-12deg); } 100% { transform: none; } }
  @media (prefers-reduced-motion: reduce) { .actions button.roll svg.d20 { animation: none !important; } }
  /* Opciones usadas: desaparecen las que no se eligieron; la elegida queda, desactivada y marcada. */
  .actions button:disabled:not(.chosen) { display: none; }
  .actions:not(:has(button:enabled)):not(:has(button.chosen)) { display: none; }
  .actions button.chosen:disabled { opacity: .75; border-color: rgba(230,183,90,.45); color: #e6c98a; }
  .actions button.chosen:disabled:not(.roll)::before { content: '✓'; margin-right: 6px; color: var(--accent); }
  .actions button.roll.chosen:disabled { background: var(--accent-tint); color: #e6c98a; }
  .actions button.roll.landed.chosen:disabled { opacity: 1; background: var(--accent-tint); color: #e6c98a; }
  /* Ya tirado: la cara blanca, muy transparente (estado desactivado). */
  .actions button.roll.landed svg.d20 rect { fill: rgba(255,255,255,.12); stroke: rgba(230,183,90,.55); }
  .actions button.roll.landed svg.d20 circle, .actions button.roll.landed svg.d20 text { fill: #e6c98a; }
  /* Secciones plegables del panel. */
  .col-t { display: inline-flex; align-items: center; gap: 6px; min-width: 0; margin-right: auto; padding: 4px 6px 4px 0; border: 0; background: transparent; color: var(--text); text-align: left; }
  .col-t b { font: 700 15px/1.2 var(--display); letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .col-t .chev, .sec-t .chev { width: 14px; height: 14px; color: var(--faint); transform: rotate(90deg); transition: transform .2s; }
  button.sec-t { width: 100%; border: 0; background: transparent; cursor: pointer; text-align: left; }
  button.sec-t:hover, .col-t:hover { color: var(--text); }
  body.col-view .col-t .chev, body.col-near #near .sec-t .chev, body.col-quest #quest .sec-t .chev { transform: none; }
  body.col-view .pane, body.col-view .views .seg { display: none; }
  body.col-near #near .sec-b, body.col-quest #quest .sec-b { display: none; }
  /* Tablero y mapa: un clic los amplía; en el panel no hace falta el botón. */
  body:not(.board-big) #board [data-toggle-big], body:not(.map-big) #map [data-map-big] { display: none; }
  body:not(.board-big) #board svg, body:not(.map-big) #map svg { cursor: zoom-in; }
  /* Micrófono dentro del cuadro de texto, a la derecha. */
  .inwrap { position: relative; flex: 1; min-width: 0; display: flex; }
  .inwrap input { padding-right: 48px; }
  .inwrap .mic { position: absolute; right: 3px; top: 50%; transform: translateY(-50%); width: 28px !important; height: 28px !important; }
  /* El cubo se vuelve X mientras el menú o el contenido están abiertos: ese botón es el que cierra. */
  #cube .ic-x { display: none; }
  #cube.on .ic-x { display: block; } #cube.on .ic-cube { display: none; }
  /* Engranaje del panel: ajustes de la voz del narrador. */
  #side-gear { position: relative; display: inline-flex; }
  #side-gear .tts-more { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #b8b1a6; }
  #side-gear .tts-more:hover { background: var(--hover); color: var(--text); }
  #side-gear .tts-pop { top: 46px; right: 0; z-index: 40; }
  /* Narrador y sonido: un grupo ámbar, redondeado sin ser redondo. */
  .chat-head .tts { order: 3; margin-left: 0; gap: 0; }
  .chat-head .sfx { order: 4; margin-left: -12px; }
  .chat-head .tts > button, .chat-head .sfx > button { height: 32px; border-radius: 0; background: var(--accent-tint); color: var(--accent); }
  .chat-head .tts > button:hover, .chat-head .sfx > button:hover { background: rgba(230,183,90,.24); color: var(--glow); }
  .chat-head .tts > button:first-child:not([hidden]), .chat-head .tts > .tts-stop[hidden] + .tts-auto { border-radius: 12px 0 0 12px; }
  .chat-head .tts > .tts-auto { width: 32px; padding: 0; justify-content: center; }
  .chat-head .tts > .tts-auto:not(.on) { color: var(--muted); background: rgba(230,183,90,.07); }
  .chat-head .sfx > .sfx-toggle { width: 32px; padding: 0; justify-content: center; border-left: 1px solid rgba(230,183,90,.18); }
  .chat-head .sfx:not(.on) > .sfx-toggle { color: var(--muted); background: rgba(230,183,90,.07); }
  .chat-head .sfx > .sfx-more { width: 26px; padding: 0; border-radius: 0 12px 12px 0; border-left: 1px solid rgba(230,183,90,.18); }
  .chat-head .sfx, .chat-head .sfx.on { height: 32px; background: transparent; border-radius: 12px; }
  #party { order: 2; margin-right: 6px; }
  @media (max-width: 820px) {
    .sfx > .sfx-toggle, .tts > .tts-auto { width: 32px; }
    .nv-av { width: 28px; height: 28px; }
    .msg.scene, .msg.moment, #log > .actions { margin-left: 36px; }
    form .mic, form .brush { width: 38px; }
  }
</style>
</head>
<body class="boot">
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-back" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></symbol>
  <symbol id="i-home" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M22 2l-7 20-4-9-9-4z"/><path d="M22 2L11 13"/></symbol>
  <symbol id="i-cube" viewBox="0 0 24 24"><path d="M9 6V5a3 3 0 0 1 6 0v1"/><path d="M5 10a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M8 13h8v4H8zM12 13v2"/></symbol>
  <symbol id="i-max" viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></symbol>
  <symbol id="i-q-available" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/><path d="M12 8.5v4M12 15.5v.01"/></symbol>
  <symbol id="i-q-active" viewBox="0 0 24 24"><path d="M6 21V4M6 4h10l-2 4 2 4H6"/></symbol>
  <symbol id="i-q-completed" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/></symbol>
  <symbol id="i-q-expired" viewBox="0 0 24 24"><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/></symbol>
  <symbol id="i-star" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></symbol>
  <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></symbol>
  <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></symbol>
  <symbol id="i-map" viewBox="0 0 24 24"><path d="M9 4l-5 2v14l5-2 6 2 5-2V4l-5 2z"/><path d="M9 4v14M15 6v14"/></symbol>
  <symbol id="i-sheet" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></symbol>
  <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></symbol>
  <symbol id="i-pack" viewBox="0 0 24 24"><path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/></symbol>
  <symbol id="i-board" viewBox="0 0 24 24"><path d="M4 4h16v12H4z"/><path d="M8 20h8M12 16v4M8 8h8M8 12h5"/></symbol>
  <symbol id="i-hand" viewBox="0 0 24 24"><path d="M7 11V6a2 2 0 0 1 4 0v5M11 10V4a2 2 0 0 1 4 0v6M15 10V6a2 2 0 0 1 4 0v7a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4a1.8 1.8 0 0 1 3-2L7 13"/></symbol>
  <symbol id="i-coin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3H15"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></symbol>
  <symbol id="i-chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol>
  <symbol id="i-invite" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></symbol>
  <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></symbol>
</svg>
<aside id="side" aria-label="La partida">
  <div class="side-head">
    <a class="mark" href="/" title="Volver al menú de partidas" aria-label="Tavernus: volver al menú de partidas"><img src="/assets/icono.jpg" alt=""></a>
    <div class="t">
      <span id="game-name">Tavernus</span>
      <div class="sub"><span id="game-mode" class="badge" hidden></span><span id="game-when"></span></div>
    </div>
    <a class="ib" id="side-invites" href="#" hidden title="Invitaciones: enlaces para tus amigos" aria-label="Invitaciones"><svg class="i"><use href="#i-invite"/></svg></a>
    <span id="side-gear"></span>
    <button type="button" class="ib" id="side-close" title="Volver al chat" aria-label="Volver al chat"><svg class="i"><use href="#i-chat"/></svg></button>
  </div>
  <div class="side-scroll">
    <div id="card" class="card" title="Abrir la hoja de personaje"></div>
    <div class="views">
      <button type="button" class="col-t" data-col="view" aria-expanded="true"><svg class="i chev"><use href="#i-chev"/></svg><b id="view-place">Tablero</b></button>
      <div class="seg" role="tablist" aria-label="Vista del sitio">
        <button type="button" role="tab" data-view-tab="board">Tablero</button>
        <button type="button" role="tab" data-view-tab="map">Mapa</button>
      </div>
    </div>
    <div class="pane" data-pane="board"><div id="board"></div><p class="none">Este lugar no tiene tablero.</p></div>
    <div class="pane" data-pane="map"><div id="map"></div><p class="none">Aún no hay mapa de la zona.</p></div>
    <div id="near"></div>
    <div id="quest"></div>
  </div>
</aside>
<main id="play">
  <div class="chat-head">
    <button type="button" class="ib" id="to-side" title="La partida: ficha, tablero y mapa" aria-label="Abrir la partida: ficha, tablero y mapa"><svg class="i"><use href="#i-grid"/></svg></button>
    <span class="dot" id="scene-dot"><svg class="i"><use href="#i-pin"/></svg></span>
    <div class="t"><div id="place">Tavernus</div><div id="place-sub"></div></div>
    <div id="presence" role="status" aria-label="Quién más juega"></div>
    <div id="party" role="group" aria-label="Personaje"></div>
    <select id="character" class="vh" aria-label="Personaje" tabindex="-1"></select>
  </div>
  <div class="chat-body">
    <div id="log" aria-live="polite"></div>
    <div id="thinking" role="status"></div>
    <button type="button" id="drawer-scrim" hidden aria-label="Cerrar y volver a la conversación"></button>
    <section id="drawer" hidden aria-labelledby="dr-title">
      <span class="dr-grab" aria-hidden="true"></span>
      <div class="dr-head">
        <h2 id="dr-title">Hoja</h2>
        <div class="seg" role="tablist" aria-label="Contenido de la partida">
          <button type="button" role="tab" data-dr="sheet">Hoja</button>
          <button type="button" role="tab" data-dr="journal">Diario</button>
          <button type="button" role="tab" data-dr="pack">Mochila</button>
        </div>
      </div>
      <div class="dr-body">
        <div class="dr-pane" data-drpane="sheet"><div id="group" aria-live="polite"></div><div id="sheet"></div><p class="none">Cargando la hoja…</p></div>
        <div class="dr-pane" data-drpane="journal"><div id="journal"></div><p class="none">El diario está en blanco.</p></div>
        <div class="dr-pane" data-drpane="pack"><div id="pack"></div><p class="none">Cargando la mochila…</p></div>
      </div>
    </section>
  </div>
  <div class="compose">
    <div id="round" class="round-banner" hidden role="status"></div>
    <div id="typing" class="typing" hidden aria-live="polite"></div>
    <div class="chips">
      <button data-cmd="look">/look</button><button data-cmd="where">/where</button><button data-cmd="who">/who</button>
      <button data-cmd="inventory">/inventory</button><button data-cmd="recap">/recap</button><button data-cmd="time">/time</button>
      <button data-cmd="tablon">/tablon</button><button data-cmd="progress">/progress</button>
    </div>
    <form id="form" autocomplete="off">
      <button type="button" id="saymode" class="mode" hidden aria-pressed="false" title="Hacer: el narrador cuenta lo que haces. Decir: tu personaje lo dice tal cual, al instante y sin narrador.">Hacer</button>
      <span class="inwrap"><input id="input" placeholder="¿Qué haces?" aria-label="Acción"></span>
      <button type="button" id="cube" aria-haspopup="menu" aria-expanded="false" aria-controls="cube-menu" title="Hoja, diario y mochila" aria-label="Menú de la partida: hoja, diario y mochila"><svg class="i ic-cube"><use href="#i-cube"/></svg><svg class="i ic-x"><use href="#i-x"/></svg></button>
      <button type="submit" aria-label="Enviar" title="Enviar"><svg class="i"><use href="#i-send"/></svg></button>
    </form>
  </div>
  <button type="button" id="cube-scrim" hidden aria-label="Cerrar el menú"></button>
  <div id="cube-menu" role="menu" aria-label="Menú de la partida" hidden>
    <button type="button" role="menuitem" data-open="sheet"><span class="bub sheet"><svg class="i"><use href="#i-sheet"/></svg></span><span><b class="lbl">Hoja</b><small>Características y habilidades</small></span></button>
    <button type="button" role="menuitem" data-open="journal"><span class="bub journal"><svg class="i"><use href="#i-book"/></svg></span><span><b class="lbl">Diario<i class="dotnew" hidden></i></b><small>Misiones, charlas, crónica y lugares</small></span></button>
    <button type="button" role="menuitem" data-open="pack"><span class="bub pack"><svg class="i"><use href="#i-pack"/></svg></span><span><b class="lbl">Mochila</b><small id="pack-sub">Lo que llevas encima</small></span></button>
  </div>
</main>
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
  var MODE_LABEL = { live: 'Máster real', offline: 'Offline', record: 'Grabando', replay: 'Demo' };
  // Quién soy en esta partida: anfitrión (puede cambiar de PJ) o jugador ligado a su asiento (access.ts).
  var session = fetch(api('/api/session')).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  session.then(function (d) {
    var g = d && d.game;
    if (!g) return;
    $('game-name').textContent = g.name;
    var badge = $('game-mode');
    badge.textContent = MODE_LABEL[g.mode] || g.mode; badge.className = 'badge ' + g.mode; badge.hidden = false;
    document.title = g.name + ' — Tavernus';
    // El anfitrión reparte los enlaces de invitación desde la propia partida (page-access.ts).
    if (d.role === 'admin') {
      var inv = $('side-invites');
      inv.href = '/invitaciones?game=' + encodeURIComponent(g.slug);
      inv.hidden = false;
    }
  }).catch(function () {});
  var log = $('log'), input = $('input'), select = $('character'), thinking = $('thinking');
  /** Entrada en la partida: al llegar el historial (con un mínimo para que se vea la carga) se quita body.boot y
   *  se pone body.entered, que abre la ventana del chat, ensancha el cuadro y hace entrar el panel (ver CSS). */
  var bootStart = Date.now(), entered = false;
  function enterGame() {
    if (entered) return;
    entered = true;
    setTimeout(function () {
      document.body.classList.remove('boot');
      document.body.classList.add('entered');
      setTimeout(function () { scroll(); input.focus(); }, 760);
      setTimeout(function () { document.body.classList.remove('entered'); }, 2600);
    }, Math.max(0, 2200 - (Date.now() - bootStart)));
  }
  setTimeout(enterGame, 6000);
  var current = null, stream = null, busy = false;

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
  /** Tono de un aviso del sistema: bueno (verde), normal (azul) o malo (rojo), por el resultado que anuncia. */
  function toneOf(text, extra) {
    if (extra && extra.error) return 'bad';
    var t = String(text || '');
    if (/^✗/.test(t) || /→\s*(falla|fallo)\b/i.test(t)) return 'bad';
    if (/→\s*(impacta|éxito)\b/i.test(t) || /^✓/.test(t)) return 'good';
    return 'info';
  }
  // Icono del botón de tirar: un dado clásico con sus puntos, el que todo el mundo asocia a «tirar».
  var D20_ICON = '<svg class="i d20" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle data-p="tl" cx="8.3" cy="8.3" r="1.5"/><circle data-p="tr" cx="15.7" cy="8.3" r="1.5"/><circle data-p="ml" cx="8.3" cy="12" r="1.5" style="display:none"/><circle data-p="mr" cx="15.7" cy="12" r="1.5" style="display:none"/><circle data-p="c" cx="12" cy="12" r="1.5"/><circle data-p="bl" cx="8.3" cy="15.7" r="1.5"/><circle data-p="br" cx="15.7" cy="15.7" r="1.5"/><text x="12" y="12.6" text-anchor="middle" dominant-baseline="middle" style="display:none">20</text></svg>';
  /** Caras del dado: qué puntos se ven con cada valor del 1 al 6. */
  var DIE_FACES = { 1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'] };
  function dieFace(svg, n) {
    svg.querySelector('text').style.display = 'none';
    svg.querySelectorAll('[data-p]').forEach(function (c) { c.style.display = DIE_FACES[n].indexOf(c.getAttribute('data-p')) >= 0 ? '' : 'none'; });
  }
  /** Al tirar, los puntos saltan de cara en cara; al llegar el resultado (aviso «🎲 … d20 [N]») se queda en él:
   *  del 1 al 6 con sus puntos y, por encima, con el número en la cara (un d6 no tiene más puntos). */
  var rollBtn = null, rolling = null;
  function startRoll(b) {
    stopRoll();
    if (!b || !b.querySelector('svg.d20')) return;
    var svg = b.querySelector('svg.d20');
    b.classList.add('rolling');
    rolling = { b: b, svg: svg, start: Date.now(), t: setInterval(function () { dieFace(svg, 1 + Math.floor(Math.random() * 6)); }, 80) };
  }
  function landRoll(n) {
    if (!rolling) return;
    var r = rolling; rolling = null;
    setTimeout(function () {
      clearInterval(r.t);
      r.b.classList.remove('rolling');
      if (n >= 1 && n <= 6) dieFace(r.svg, n);
      else { r.svg.querySelectorAll('[data-p]').forEach(function (c) { c.style.display = 'none'; }); var t = r.svg.querySelector('text'); t.textContent = String(n); t.style.display = ''; }
      r.b.classList.add('landed');
      r.b.title = 'Ha salido ' + n;
    }, Math.max(0, 700 - (Date.now() - r.start)));
  }
  function stopRoll() { if (!rolling) return; clearInterval(rolling.t); rolling.b.classList.remove('rolling'); dieFace(rolling.svg, 5); rolling = null; }
  /** Un mensaje: la burbuja (.body) y, debajo, lo que se le añada (aviso, acciones). El del máster lleva su rótulo. */
  function add(kind, text, extra) {
    var div = document.createElement('div');
    div.className = 'msg ' + kind + (extra && extra.error ? ' error' : '') + (kind === 'system' ? ' tone-' + toneOf(text, extra) : '');
    div.innerHTML = (kind === 'master' ? '<div class="who">' + SPARK + 'Máster</div>' : '') + '<div class="body">' + format(text) + '</div>';
    log.appendChild(div);
    if (kind === 'system' && /🎲/.test(text)) {
      var rb = log.querySelectorAll('.actions button.roll'); if (rb.length) rb[rb.length - 1].classList.add('chosen');
      var rolled = String(text).match(/d20\s*\[(\d+)/);
      if (rolled) landRoll(Number(rolled[1])); else stopRoll();
    }
    scroll();
    return div;
  }
${NOVEL_JS}
${PAINT_JS}
  /** Cada mensaje del stream entra en el hilo tipo chat (novel.ts): avatar, burbuja, botones e imágenes. */
  function renderMessage(m, live, animate) { var shown = chatMessage(m, live, animate); sceneDot(); return shown; }
  /** La última ilustración del sitio hace de foto del «chat» en la cabecera, como en WhatsApp. */
  function sceneDot() {
    var imgs = log.querySelectorAll('.msg.scene img, .place-shot img'), last = imgs[imgs.length - 1], dot = $('scene-dot');
    var src = last && last.getAttribute('src');
    if (!src || dot.getAttribute('data-src') === src) return;
    dot.setAttribute('data-src', src);
    dot.innerHTML = '<img alt="">';
    dot.querySelector('img').src = src;
  }

  function setBusy(on) {
    busy = on;
    input.disabled = on;
    $('board').classList.toggle('busy', on);
    $('map').classList.toggle('busy', on);
    document.querySelectorAll('.chips button, form button').forEach(function (b) { b.disabled = on; });
    // Mientras se espera: los puntos del narrador en el hilo (novel.ts) y, si la acción va en cola, a quién se espera.
    turnShown = false;
    if (on) waitingFor = [];
    typing(on);
    renderWaiting();
    if (!on) input.focus();
  }
  /** Mientras la acción espera en la cola del sitio detrás de la de otro jugador, se dice a quién (SSE «queue»). */
  var waitingFor = [];
  function renderWaiting() { thinking.textContent = busy && waitingFor.length ? 'Esperando a ' + waitingFor.join(' y ') + '…' : ''; }

  /** Los demás jugadores: en la cabecera, sus iniciales con un punto (verde = en línea); en la hoja, una línea cada uno. */
  function renderPresence(list) {
    var box = $('presence'), group = $('group');
    box.innerHTML = ''; group.innerHTML = '';
    // Hacer / Decir solo tiene sentido con más jugadores en la partida; en solitario, todo va al narrador.
    var alone = !list || !list.length;
    $('saymode').hidden = alone;
    if (alone && sayMode) setSayMode(false);
    if (!list || !list.length) return;
    list.forEach(function (p) {
      var sp = document.createElement('span');
      sp.textContent = initial(p.name);
      sp.className = (p.online ? 'on' : '') + (p.where === 'here' ? ' here' : '') + (p.away ? ' away' : '');
      sp.title = p.text;
      sp.setAttribute('aria-label', p.text);
      box.appendChild(sp);
    });
    group.innerHTML = '<h4>Tu grupo</h4>' + list.map(function (p) { return '<div><i class="' + (p.online ? 'on' : '') + '"></i>' + escapeHtml(p.text) + '</div>'; }).join('');
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
    post('/api/act', { text: text }).then(function (r) {
      // Después de lo que el turno haya traído por el stream (y de sus puntos).
      afterChat(function () {
        // «hablar con <otro jugador>» sin frase: el servidor no lo narra; abre el modo Decir hacia él.
        if (r.ok && r.say_to) { setSayMode(true, r.say_to); add('system', r.text); } else handleReply(r);
        clearPending(); setBusy(false); loadSheet();
      });
    });
  }

  // --- Entre jugadores: Hacer / Decir (party.ts) -----------------------------------
  /** Decir: lo escrito es la frase literal del PJ; llega al instante a quien la oiga, sin narrador ni coste. */
  var sayMode = false, sayTo = null;
  function setSayMode(on, to) {
    sayMode = on; sayTo = on ? (to || null) : null;
    var b = $('saymode');
    b.classList.toggle('say', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = on ? 'Decir' + (sayTo ? '<span class="to"></span>' : '') : 'Hacer';
    if (sayTo) b.querySelector('.to').textContent = 'a ' + sayTo.name;
    $('form').classList.toggle('say', on);
    input.placeholder = on ? (sayTo ? '¿Qué le dices a ' + sayTo.name + '?' : '¿Qué dices?') : '¿Qué haces?';
    input.setAttribute('aria-label', on ? 'Lo que dices' : 'Acción');
    input.focus();
  }
  // «Aren está escribiendo…» (SSE «typing»; caduca sola) y aviso propio, como mucho cada 2,5 s.
  var typers = {}, typingTimer = null, lastTyping = 0;
  function showTyping(t) {
    typers[t.id] = { name: t.name, until: Date.now() + (t.ms || 4000) };
    renderTyping();
  }
  function renderTyping() {
    clearTimeout(typingTimer);
    var now = Date.now(), names = [];
    Object.keys(typers).forEach(function (id) { if (typers[id].until > now) names.push(typers[id].name); else delete typers[id]; });
    var el = $('typing');
    el.hidden = !names.length;
    el.textContent = names.length ? names.join(' y ') + (names.length > 1 ? ' están' : ' está') + ' escribiendo…' : '';
    if (names.length) typingTimer = setTimeout(renderTyping, 1000);
  }
  input.addEventListener('input', function () {
    var v = input.value.trim();
    if (!v || v.charAt(0) === '/' || Date.now() - lastTyping < 2500) return;
    lastTyping = Date.now();
    post('/api/typing', {});
  });
  // Ronda en escena tensa: «Ronda 2 · faltan Aren y Lys · 0:42».
  var roundTimer = null, roundData = null;
  function showRound(r) {
    roundData = r && r.open ? r : null;
    clearInterval(roundTimer);
    renderRound();
    if (roundData) roundTimer = setInterval(renderRound, 1000);
  }
  function renderRound() {
    var el = $('round');
    if (!roundData) { el.hidden = true; return; }
    var left = Math.max(0, Math.round((roundData.deadline_ms - Date.now()) / 1000));
    var w = roundData.waiting || [];
    var who = roundData.acted ? (w.length ? 'faltan ' + w.join(' y ') : 'resolviendo') : 'te toca' + (w.length ? ' (y a ' + w.join(' y ') + ')' : '');
    el.hidden = false;
    el.classList.toggle('mine', !roundData.acted);
    el.textContent = 'Ronda ' + roundData.n + ' · ' + who + ' · ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    if (!left) clearInterval(roundTimer);
  }
  function say(text) {
    post('/api/say', { text: text, to: sayTo ? sayTo.id : null }).then(function (r) { if (!r.ok) handleReply(r); });
  }
  function answerOffer(id, accept) {
    post('/api/offer', { offer: id, accept: accept }).then(function (r) { if (!r.ok) handleReply(r); loadSheet(); });
  }
  function roll() {
    if (busy) return;
    setBusy(true);
    var rbs = log.querySelectorAll('.actions button.roll');
    startRoll(rollBtn || rbs[rbs.length - 1]); rollBtn = null;
    post('/api/roll', {}).then(function (r) { afterChat(function () { if (!r.ok) stopRoll(); handleReply(r); setBusy(false); loadSheet(); }); });
  }
  function command(name) {
    if (busy) return;
    post('/api/command', { name: name }).then(handleReply);
  }

  var sheetData = null;
  function loadSheet() {
    if (!current) return;
    loadBoard();
    fetch(api('/api/sheet?character=' + encodeURIComponent(current))).then(function (r) { return r.json(); }).then(function (s) {
      if (!s.title) return;
      sheetData = s;
      renderCard(s);
      renderSheet(s);
      renderPack(s);
    }).catch(function () {});
  }

  function field(s, name) { return (s.fields.filter(function (f) { return f.name === name; })[0] || {}).value || ''; }
  /** Caída y muerte (death.ts): salvaciones, estable o cuenta atrás hasta volver. */
  var DEATH_MODE = { casual: 'Casual: si mueres, vuelves a las 2 h con lo tuyo esperándote.', hardcore: 'Hardcore: si mueres, vuelves a los 30 min, sin nada y con una característica rebajada.' };
  function deathBlock(s) {
    var d = s.death;
    if (!d) return '';
    if (d.state === 'dead') return '<div class="tile wide death"><span class="l">☠ Muerto · vuelves en ' + escapeHtml(d.respawn_place || '') + '<b data-respawn="' + Number(d.respawn_real_ms || 0) + '">—</b></span><small>' + escapeHtml(DEATH_MODE[d.mode] || '') + '</small></div>';
    if (d.state === 'dying') return '<div class="tile wide death"><span class="l">A 0 PG, cayendo<b>' + d.success + ' ✔ · ' + d.fail + ' ✖</b></span><small>El servidor tira tus salvaciones contra muerte: tres éxitos te estabilizan, tres fallos te matan.</small></div>';
    if (d.state === 'stable') return '<div class="tile wide death"><span class="l">Inconsciente, estable<b>' + escapeHtml(d.stable_until ? 'hacia las ' + d.stable_until : '') + '</b></span><small>Recobras el sentido con 1 PG; si alguien te cura, antes.</small></div>';
    return '<p class="sh-foot" style="margin-top:8px">Modo de muerte · ' + escapeHtml(DEATH_MODE[d.mode] || d.mode) + '</p>';
  }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }
  setInterval(function () {
    document.querySelectorAll('[data-respawn]').forEach(function (el) {
      var at = Number(el.getAttribute('data-respawn'));
      el.textContent = at ? (at > Date.now() ? fmtLeft(at - Date.now()) : 'volviendo…') : '—';
    });
  }, 1000);
  function combatOf(s) {
    var c = field(s, 'Combate'), m = function (re) { var x = c.match(re); return x ? x : null; };
    var hp = m(/PG (\d+)\/(\d+)/), ca = m(/CA (\d+)/), sp = m(/Velocidad (\d+) ft/), pp = m(/Percepción pasiva (\d+)/), cond = m(/Condiciones: (.+)/);
    var pct = hp ? Math.max(0, Math.min(100, Math.round(100 * Number(hp[1]) / Number(hp[2])))) : 0;
    return { hp: hp, ca: ca ? ca[1] : '—', speed: sp ? String(Math.round(Number(sp[1]) * 0.3)) + ' m' : '—', pp: pp ? pp[1] : '—', cond: cond ? cond[1] : '', pct: pct, cls: pct <= 25 ? 'crit' : pct <= 50 ? 'low' : '' };
  }
  /** «12.0 / 150 lb · cargado» → «12/150». */
  function loadShort(s) { var m = field(s, 'Carga').match(/([\d.]+)\s*\/\s*([\d.]+)/); return m ? Math.round(Number(m[1])) + '/' + Math.round(Number(m[2])) : '—'; }

  /** Ficha de arriba del panel (pulsarla abre la Hoja), la hora y la cabecera del chat, sacadas de la hoja viva. */
  function renderCard(s) {
    var t = s.title.split(' · '), c = combatOf(s);
    var lvl = (t[2] || '').replace(/[^0-9]/g, '');
    var stat = function (v, k) { return '<div>' + escapeHtml(v) + '<small>' + k + '</small></div>'; };
    $('card').innerHTML = '<div class="top"><span class="av">' + escapeHtml(initial(t[0] || '?')) + '</span><div class="who"><div class="name">' + escapeHtml(t[0] || '') + '</div>' +
      '<div class="sub">' + escapeHtml(t.slice(1).join(' · ')) + '</div></div>' +
      (c.hp ? '<div class="hpbox"><span>' + c.hp[1] + ' / ' + c.hp[2] + '</span><span class="bar"><i class="' + c.cls + '" style="width:' + c.pct + '%"></i></span></div>' : '') + '</div>' +
      '<div class="stats">' + stat(c.ca, 'CA') + stat(c.speed, 'Vel.') + stat(c.pp, 'Perc.') + stat(lvl || '—', 'Nivel') + stat(loadShort(s), 'Carga') + '</div>' +
      (s.death && s.death.state === 'dead' ? '<div class="respawn">☠ Muerto · vuelves en <b data-respawn="' + Number(s.death.respawn_real_ms || 0) + '">—</b></div>'
        : s.death && s.death.state === 'dying' ? '<div class="respawn">A 0 PG · salvaciones ' + s.death.success + ' ✔ · ' + s.death.fail + ' ✖</div>' : '');
    // «despierto · Taberna, La barra»: el lugar a la cabecera del chat; debajo, la hora, el rincón y el estado.
    var d = s.description.split('\n')[0], i = d.indexOf(' · ');
    var where = i >= 0 ? d.slice(i + 3) : d, state = i >= 0 ? d.slice(0, i) : '';
    var comma = where.indexOf(', ');
    var placeName = comma >= 0 ? where.slice(0, comma) : where;
    $('place').textContent = placeName;
    $('view-place').textContent = placeName;
    $('place-sub').textContent = [s.footer, comma >= 0 ? where.slice(comma + 2) : '', state !== 'despierto' ? state : '', s.description.split('\n')[1] || ''].filter(Boolean).join(' · ');
    var coins = field(s, 'Monedas');
    $('pack-sub').textContent = [loadShort(s) !== '—' ? 'Carga ' + loadShort(s) + ' lb' : '', coins ? coins + ' monedas' : ''].filter(Boolean).join(' · ') || 'Lo que llevas encima';
  }

  var ABILS = ['FUE', 'DES', 'CON', 'INT', 'SAB', 'CAR'];
  function mod(n) { var m = Math.floor((Number(n) - 10) / 2); return (m >= 0 ? '+' : '−') + Math.abs(m); }
  /** Hoja: vida y defensas, características (con las salvaciones marcadas) y habilidades. */
  function renderSheet(s) {
    var t = s.title.split(' · '), c = combatOf(s), abl = field(s, 'Características'), sk = field(s, 'Habilidades');
    var av = $('card').querySelector('.av img');
    var h = '<div class="sh-head"><span class="av">' + (av ? '<img alt="" src="' + escapeHtml(av.getAttribute('src')) + '">' : escapeHtml(initial(t[0] || '?'))) + '</span><div><h2>' + escapeHtml(t[0] || '') + '</h2>' +
      '<p>' + escapeHtml(t.slice(1).join(' · ')) + '\n' + escapeHtml(s.description) + '</p></div></div>';
    h += '<div class="tiles">';
    if (c.hp) h += '<div class="tile wide"><span class="l">Puntos de golpe<b>' + c.hp[1] + ' / ' + c.hp[2] + '</b></span><span class="bar"><i class="' + c.cls + '" style="width:' + c.pct + '%"></i></span>' + (c.cond ? '<small>Condiciones: ' + escapeHtml(c.cond) + '</small>' : '') + '</div>';
    h += '<div class="tile"><b>' + escapeHtml(c.ca) + '</b><small>CA</small></div><div class="tile"><b>' + escapeHtml(c.speed) + '</b><small>Velocidad</small></div><div class="tile"><b>' + escapeHtml(c.pp) + '</b><small>Percepción pasiva</small></div></div>';
    var dz = deathBlock(s);
    if (dz) h += dz.indexOf('<div') === 0 ? '<div class="tiles">' + dz + '</div>' : dz;
    var rest = field(s, 'Descanso');
    if (rest) h += '<p class="sh-foot" style="margin-top:8px">' + escapeHtml(rest).replace(/\n/g, '<br>') + '</p>';
    var scores = {};
    ABILS.forEach(function (a) { var m = abl.match(new RegExp(a + ' (\\d+)')); if (m) scores[a] = m[1]; });
    var saves = (abl.split('\n')[1] || '').replace(/^Salvaciones:\s*/, '');
    var saveSet = {};
    saves.split(' · ').forEach(function (x) { var k = x.trim().slice(0, 3).toUpperCase(); if (k) saveSet[k] = true; });
    if (Object.keys(scores).length) {
      h += '<div class="kv-t">Características</div><div class="tiles">';
      ABILS.forEach(function (a) {
        if (!scores[a]) return;
        h += '<div class="tile ab' + (saveSet[a] ? ' save' : '') + '"><small>' + a + (saveSet[a] ? ' · salv.' : '') + '</small><b>' + mod(scores[a]) + '</b><small>' + scores[a] + '</small></div>';
      });
      h += '</div>';
      if (saves && saves !== '—') h += '<p class="sh-foot" style="margin-top:8px">Salvaciones: ' + escapeHtml(saves) + '</p>';
    } else if (abl) h += '<div class="kv-t">Características</div><p>' + escapeHtml(abl) + '</p>';
    var skills = sk && sk !== '—' ? sk.split(' · ') : [];
    h += '<div class="kv-t">Habilidades</div>';
    h += skills.length ? '<div class="lines">' + skills.map(function (x) {
      var m = x.match(/^(.*)\s([+−-]\d+)$/);
      return '<div>' + escapeHtml(m ? m[1] : x) + (m ? '<span class="v">' + escapeHtml(m[2]) + '</span>' : '') + '</div>';
    }).join('') + '</div>' : '<p class="sh-foot">Sin habilidades con competencia.</p>';
    h += '<p class="sh-foot">' + escapeHtml(s.footer) + '</p>';
    $('sheet').innerHTML = h;
  }

  var PACK_FIELDS = { Manos: 1, Bolsillos: 1, Equipado: 1, Monedas: 1, Carga: 1 };
  var SLOT_ES = { back: 'a la espalda', body: 'puesto', armor: 'armadura', head: 'cabeza', belt: 'cinturón', waist: 'cintura', feet: 'pies', hands: 'manos', neck: 'cuello', ring: 'anillo', shield: 'escudo', cloak: 'capa', shoulder: 'al hombro' };
  /** Mochila: carga y monedas arriba; lo que tienes en las manos, equipado, en los bolsillos y en cada contenedor. */
  function renderPack(s) {
    var known = { Combate: 1, 'Características': 1, Habilidades: 1, Descanso: 1, Muerte: 1 };
    var list = function (v) { return v && v !== '—' && v !== 'vacía' ? v.split(', ') : []; };
    var rows = function (items, eq) {
      if (!items.length) return '<div class="empty">Nada.</div>';
      return items.map(function (x) {
        var k = x.indexOf(': '), name = k > 0 && eq ? x.slice(k + 2) : x, where = k > 0 && eq ? (SLOT_ES[x.slice(0, k)] || x.slice(0, k)) : '';
        return '<div><span class="tag' + (eq ? ' eq' : '') + '"><svg class="i"><use href="#' + (eq ? 'i-hand' : 'i-pack') + '"/></svg></span><span class="tt">' + escapeHtml(name) + (where ? '<small>' + escapeHtml(where) + '</small>' : '') + '</span></div>';
      }).join('');
    };
    var carga = field(s, 'Carga'), coins = field(s, 'Monedas');
    var h = '<div class="tiles"><div class="tile wide"><span class="l">Carga<b>' + escapeHtml(carga || '—') + '</b></span></div>' +
      '<div class="tile" style="grid-column: span 3"><b>' + escapeHtml(coins || '0') + '</b><small>Monedas</small></div></div>';
    var hands = field(s, 'Manos').split(' / ').filter(function (x) { return x && x !== '—'; });
    h += '<div class="kv-t">En las manos</div><div class="items">' + rows(hands, false) + '</div>';
    h += '<div class="kv-t">Equipado</div><div class="items">' + rows(field(s, 'Equipado').split('\n').filter(function (x) { return x && x !== '—'; }), true) + '</div>';
    h += '<div class="kv-t">Bolsillos</div><div class="items">' + rows(list(field(s, 'Bolsillos')), false) + '</div>';
    s.fields.forEach(function (f) {
      if (known[f.name] || PACK_FIELDS[f.name]) return;
      h += '<div class="kv-t">' + escapeHtml(f.name) + '</div><div class="items">' + rows(list(f.value), false) + '</div>';
    });
    $('pack').innerHTML = h;
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
    lightbox.querySelector('.cap span').textContent = (sheetData ? sheetData.footer : '');
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
      if (!b || !b.location || !b.map) { board.innerHTML = ''; boardData = null; $('near').innerHTML = ''; return; }
      renderBoard(b);
      renderNear(b);
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
    var W = big ? board.clientWidth - 32 : $('side').clientWidth - 26;
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

    // Fondo pintado (plano escrito): lleva suelos, paredes y muebles. Encima solo va lo que estaba oculto (secret);
    // los muebles pintados siguen ahí, invisibles, para pasar el ratón y clicar.
    var bg = b.background, painted = function (x) { return bg && !x.secret; };
    if (bg) o.push('<image href="' + escapeHtml(api(bg.src)) + '" x="' + r1(X(bg.bounds.x)) + '" y="' + r1(Y(bg.bounds.y + bg.bounds.h)) + '" width="' + r1(bg.bounds.w * k) + '" height="' + r1(bg.bounds.h * k) + '" preserveAspectRatio="none"/>');

    // Suelos.
    m.areas.forEach(function (a) {
      if (painted(a)) return;
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
      if (p.kind === 'text') { if (!painted(p)) o.push(propSvg(p, X, Y, k)); return; }
      var link = p.spot_id && seen[p.spot_id] ? ' data-spot="' + escapeHtml(p.spot_id) + '"' : '';
      o.push('<g class="prop" data-prop="' + i + '"' + link + (painted(p) ? ' opacity="0"' : '') + '>' + propSvg(p, X, Y, k) + '</g>');
    };
    m.props.forEach(function (p, i) { if (p.kind === 'building') drawProp(p, i); });
    m.props.forEach(function (p, i) { if (p.kind !== 'building') drawProp(p, i); });

    // Paredes y puertas.
    var ww = r1(Math.max(4, 0.32 * k));
    m.walls.forEach(function (w) { if (painted(w)) return; o.push('<path d="' + poly(w.points, X, Y) + '" fill="none" stroke="#0e0a07" stroke-width="' + ww + '" stroke-linecap="square" stroke-linejoin="miter"/>'); });
    m.doors.forEach(function (d) {
      if (painted(d)) return;
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
        // Sin rótulo: el tablero solo nombra personajes. El destino sale al pasar el ratón (title) y la flecha sigue siendo clicable.
        o.push('<g class="exit' + (e.blocked ? ' blocked' : '') + '" data-exit="' + escapeHtml(e.id) + '" data-side="' + side + '"><title>' + escapeHtml(label) + '</title>' +
          '<line class="hit" ' + seg + '/><line class="path" marker-end="url(#' + (e.blocked ? 'arr-x' : 'arr') + ')" ' + seg + '/></g>');
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
      // El tablero solo nombra personajes: el nombre del punto no se pinta (sale en el tooltip y en «Cerca de ti»).
      o.push('<circle class="hit" cx="' + r1(px) + '" cy="' + r1(py) + '" r="' + r1(markR) + '"><title>' + escapeHtml(sp.name) + '</title></circle>');
      if (ts.length) {
        var who = ts.map(function (t) { return t.kind === 'actor' ? 'tú' : t.label + (t.away ? ' (ausente)' : '') + (t.talking_with ? (t.talking_with === 'tú' ? ' (contigo)' : ' (con ' + t.talking_with.replace(/^tú y /, 'contigo y ') + ')') : ''); }).join(', ');
        if (who.length > 40) who = who.slice(0, 39) + '…';
        o.push('<text class="who" x="' + r1(px) + '" y="' + r1(py + markR + 10) + '">' + escapeHtml(who) + '</text>');
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
      if (!t) return; // las salidas ya no llevan rótulo (el tablero solo nombra personajes)
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
    var W = big ? mapEl.clientWidth - 32 : $('side').clientWidth - 26;
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
    if (!document.body.classList.contains('map-big')) { if (mapData && ev.target.closest('svg')) toggleMapBig(true); return; }
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
    if (!document.body.classList.contains('board-big')) { if (boardData && ev.target.closest('svg')) toggleBig(true); return; }
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
  function journalVisible() { return drawerKey === 'journal'; }
  /** Novedades en el diario: punto en el cubo, en «Diario» del menú y en su pestaña. */
  function setJournalNew(on) {
    document.querySelectorAll('[data-dr="journal"]').forEach(function (b) { b.classList.toggle('new', on); });
    $('cube').classList.toggle('new', on);
    var dot = document.querySelector('#cube-menu .dotnew');
    if (dot) dot.hidden = !on;
  }
  function markJournalSeen() {
    if (!journalData) return;
    store(journalKey(), journalData.version); setJournalNew(false);
    // Abrir el Diario quita el indicador de misiones del panel.
    markChangesSeen(journalData);
    if (journalSection === 'quests') markQuestsSeen(journalData);
  }

  function loadJournal() {
    if (!current) return;
    var seq = ++journalSeq, id = current;
    fetch(api('/api/journal?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (seq !== journalSeq || id !== current || !j || !j.character) return;
      journalData = j;
      renderJournal(j);
      renderQuest(j);
      if (journalVisible()) markJournalSeen();
      else setJournalNew(store(journalKey()) !== j.version);
    }).catch(function () {});
  }

  var CHEV = '<svg class="i chev"><use href="#i-chev"/></svg>';

  // Misión seguida (la del recuadro del panel) y misiones ya vistas, por partida y PJ (localStorage).
  function trackKey() { return 'tavernus.track.' + game + '.' + current; }
  function qseenKey() { return 'tavernus.qseen.' + game + '.' + current; }
  function qseen() { try { return JSON.parse(store(qseenKey()) || 'null'); } catch (e) { return null; } }
  /** Misiones que el PJ aún no ha mirado. La primera vez, todas las de ahora cuentan como vistas. */
  function newQuests(j) {
    var all = j.quests.active.concat(j.quests.completed), seen = qseen();
    if (!seen) { store(qseenKey(), JSON.stringify(all.map(function (q) { return q.id + ':' + q.status; }))); return []; }
    return all.filter(function (q) { return q.status !== 'expired' && seen.indexOf(q.id + ':' + q.status) < 0; });
  }
  function markQuestsSeen(j) { store(qseenKey(), JSON.stringify(j.quests.active.concat(j.quests.completed).map(function (q) { return q.id + ':' + q.status; }))); }
  // Cambios en las misiones (altas, pasos, cierres) que el jugador aún no ha visto en el Diario. Se dan por vistos al abrirlo.
  function hseenKey() { return 'tavernus.qhist.' + game + '.' + current; }
  function questChanges(j) { return j.quests.active.concat(j.quests.completed).reduce(function (a, q) { return a.concat(q.history || []); }, []); }
  /** Cambios sin ver. La primera vez cuenta todo: el que empieza ve marcada su primera misión. */
  function unseenChanges(j) {
    var seen = null;
    try { seen = JSON.parse(store(hseenKey()) || 'null'); } catch (e) { seen = null; }
    seen = seen || [];
    return questChanges(j).filter(function (c) { return seen.indexOf(c.key) < 0; });
  }
  function markChangesSeen(j) { store(hseenKey(), JSON.stringify(questChanges(j).map(function (c) { return c.key; }).slice(-600))); }
  /** Punto con el número de misiones nuevas y check con el de pasos o cierres, para el icono de misiones del panel. */
  function questBadge(unseen) {
    var added = unseen.filter(function (c) { return c.kind === 'added'; }).length;
    var steps = unseen.filter(function (c) { return c.kind === 'step' || c.kind === 'completed' || c.kind === 'accepted'; }).length;
    var tip = [added ? added + (added === 1 ? ' misión nueva' : ' misiones nuevas') : '', steps ? steps + (steps === 1 ? ' paso cumplido' : ' pasos cumplidos') : ''].filter(Boolean).join(' y ');
    return { added: added, steps: steps, html: (added || steps) ? '<span class="qbadge" title="' + escapeHtml(tip) + ' (abre el Diario)">' + (added ? '<i class="dot">' + added + '</i>' : '') + (steps ? '<i class="chk">✓' + steps + '</i>' : '') + '</span>' : '' };
  }
  /** La seguida: la que eligió el jugador si sigue abierta; si no, la principal o la primera en curso. */
  function trackedQuest(j) {
    var qs = j.quests.active, id = store(trackKey());
    var live = qs.filter(function (x) { return x.status === 'active'; });
    return qs.filter(function (x) { return x.id === id && x.status !== 'expired'; })[0] || live.filter(function (x) { return x.kind === 'main'; })[0] || live[0] || qs.filter(function (x) { return x.status !== 'expired'; })[0] || null;
  }
  function questIcon(q, isNew) {
    return '<span class="qi ' + q.status + (q.kind === 'main' && q.status === 'active' ? ' main' : '') + '" title="' + escapeHtml(JSTATUS[q.status] || q.status) + '"><svg class="i"><use href="#i-q-' + q.status + '"/></svg>' +
      (isNew ? '<span class="nw"><svg class="i"><use href="#i-spark"/></svg></span>' : '') + '</span>';
  }
  function questHtml(q, ctx) {
    var isNew = ctx && ctx.fresh.indexOf(q.id) >= 0, tracked = ctx && ctx.tracked === q.id;
    var o = q.origin, changed = ctx ? ctx.unseen.filter(function (c) { return (q.history || []).some(function (x) { return x.key === c.key; }); }) : [];
    var whence = q.kind === 'main' ? 'misión principal' : q.kind === 'achievement' ? 'logro' : q.kind === 'debt' ? 'deuda'
      : o && o.kind === 'heard' ? 'de oídas' : o && o.kind === 'board' ? 'tablón' + (q.giver ? ' · lo pide ' + q.giver : '') : q.giver ? 'lo pide ' + q.giver : o && o.kind === 'self' ? 'por tu cuenta' : '';
    var sub = [JSTATUS[q.status] || q.status, whence].filter(Boolean).join(' · ');
    var open = tracked || isNew || changed.length > 0;
    var h = '<details class="q ' + q.status + (q.kind === 'main' ? ' main' : '') + (isNew ? ' isnew' : '') + '"' + (open ? ' open' : '') + '><summary>' + questIcon(q, isNew) +
      '<span class="tt"><b>' + escapeHtml(q.title) + (isNew ? '<span class="pill-new">Nueva</span>' : '') + '</b><small>' + escapeHtml(sub) + '</small></span>' +
      (q.status === 'completed' || q.status === 'expired' ? '' : '<button type="button" class="trk' + (tracked ? ' on' : '') + '" data-track="' + escapeHtml(q.id) + '" title="' + (tracked ? 'La sigues en el panel' : 'Seguir en el panel') + '" aria-pressed="' + tracked + '"><svg class="i"><use href="#i-star"/></svg></button>') +
      CHEV + '</summary><div class="qb">';
    var s = q.summary || { text: q.text, next: null, told: [] };
    if (s.text) h += '<p class="sum">' + escapeHtml(s.text) + '</p>';
    if (s.next) h += '<div class="now">' + escapeHtml(s.next) + '</div>';
    if (q.clock && q.status !== 'completed') {
      var late = q.clock.days_left <= 0;
      h += '<div class="clock' + (late ? ' late' : '') + '"><svg class="i" style="width:13px;height:13px"><use href="#i-clock"/></svg>' + (late ? 'Plazo vencido' : 'Quedan ' + q.clock.days_left + (q.clock.days_left === 1 ? ' día' : ' días')) + '</div>';
    }
    (s.told || []).forEach(function (t) { h += '<div class="told"><b>' + escapeHtml(t.who) + ':</b> «' + escapeHtml(t.said) + '»<small>' + escapeHtml(t.when) + '</small></div>'; });
    if (q.steps.length > 1) h += '<ul class="steps">' + q.steps.map(function (st) { return '<li class="' + (st.done ? 'done' : '') + '">' + escapeHtml(st.text) + '</li>'; }).join('') + '</ul>';
    if (o && o.text) h += '<div class="orig"><b>Cómo te llegó:</b> ' + escapeHtml(o.text) + (o.where ? ' <span>(' + escapeHtml(o.where) + ')</span>' : '') + '</div>';
    var hist = (q.history || []).slice(-6).reverse();
    if (hist.length) {
      var unseenKeys = changed.map(function (c) { return c.key; });
      h += '<ul class="hist"><b>Qué ha pasado</b>' + hist.map(function (x) {
        return '<li class="' + x.kind + (unseenKeys.indexOf(x.key) >= 0 ? ' unseen' : '') + '"><span class="t" title="' + escapeHtml(x.when) + '">' + escapeHtml(x.short || x.when) + '</span><span>' + escapeHtml(x.text) + (x.why ? '<small>' + escapeHtml(x.why) + '</small>' : '') + '</span></li>';
      }).join('') + '</ul>';
    }
    var foot = [q.reward ? 'Recompensa: ' + q.reward : '', q.completed ? 'Completada: ' + q.completed : ''].filter(Boolean).join(' · ');
    if (foot) h += '<div class="rw">' + escapeHtml(foot) + '</div>';
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

  /** «Dejar esta misión» al pie de las que se pueden dejar (encargos y misiones dadas en curso). */
  function withDrop(html, q) {
    if (!q.droppable) return html;
    var btn = '<button type="button" class="qdrop" data-drop="' + escapeHtml(q.id) + '">Dejar esta misión</button>';
    var end = html.lastIndexOf('</div></details>');
    return end < 0 ? html : html.slice(0, end) + btn + html.slice(end);
  }
  function renderJournal(j) {
    var h = '<div class="jnav">' + JSECTIONS.map(function (s) { return '<button type="button" data-jsec="' + s[0] + '"' + (s[0] === journalSection ? ' class="on"' : '') + '>' + s[1] + '</button>'; }).join('') + '</div>';
    if (journalSection === 'quests') {
      var tq = trackedQuest(j), ctx = { fresh: newQuests(j).map(function (q) { return q.id; }), tracked: tq ? tq.id : null, unseen: unseenChanges(j) };
      var render = function (q) { return withDrop(questHtml(q, ctx), q); };
      h += '<h3>Activas <span>' + j.quests.active.length + '</span></h3>';
      h += j.quests.active.length ? j.quests.active.map(render).join('') : '<p class="empty">Nada entre manos. Mira el tablón o habla con la gente.</p>';
      h += '<h3>Completadas <span>' + j.quests.completed.length + '</span></h3>';
      h += j.quests.completed.length ? j.quests.completed.map(render).join('') : '<p class="empty">Todavía ninguna.</p>';
      if (j.rumors.length) h += '<details class="rumors"><summary><span class="tt"><b>Se dice</b><small>' + j.rumors.length + (j.rumors.length === 1 ? ' rumor' : ' rumores') + '</small></span>' + CHEV + '</summary><div class="qb">' + j.rumors.map(rumorHtml).join('') + '</div></details>';
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
    var d = ev.target.closest('[data-drop]');
    if (d) {
      ev.preventDefault(); d.disabled = true;
      post('/api/quest/drop', { quest: d.getAttribute('data-drop') }).then(function (r) { if (r && !r.ok) handleReply(r); loadJournal(); });
      return;
    }
    // Estrella: seguir esta misión en el recuadro del panel.
    var t = ev.target.closest('[data-track]');
    if (t) {
      ev.preventDefault(); ev.stopPropagation();
      store(trackKey(), t.getAttribute('data-track'));
      if (journalData) { renderJournal(journalData); renderQuest(journalData); }
      return;
    }
    var b = ev.target.closest('[data-jsec]');
    if (!b) return;
    journalSection = b.getAttribute('data-jsec'); store('tavernus.journal.section', journalSection);
    if (journalData) renderJournal(journalData);
    if (journalData && journalSection === 'quests') { markQuestsSeen(journalData); renderQuest(journalData); }
  });
  /** Abre algo desde el hilo: Hoja, Diario o Mochila en la columna del chat; tablero o mapa en el panel. */
  function goTab(t) {
    if (t === 'sheet' || t === 'journal' || t === 'pack') { openDrawer(t); return; }
    if (t === 'board' || t === 'map') { setView(t); showSide(true); }
  }

  function connect(id) {
    current = id;
    store('tavernus.character.' + game, id);
    if (stream) stream.close();
    log.innerHTML = '';
    board.innerHTML = ''; boardData = null; clearTimeout(boardTimer); document.body.classList.remove('board-big');
    mapEl.innerHTML = ''; mapData = null; document.body.classList.remove('map-big');
    journalEl.innerHTML = ''; journalData = null; setJournalNew(false);
    showScene(null);
    $('card').innerHTML = ''; $('sheet').innerHTML = ''; $('pack').innerHTML = ''; $('near').innerHTML = ''; $('quest').innerHTML = '';
    sheetData = null;
    var dot = $('scene-dot'); dot.removeAttribute('data-src'); dot.innerHTML = '<svg class="i"><use href="#i-pin"/></svg>';
    renderParty();
    if (window.TavernusSfx) TavernusSfx.character(id);
    stream = new EventSource(api('/api/stream?character=' + encodeURIComponent(id)));
    // Personaje nuevo presentándose: su hilo empieza en el prólogo, que llega por el stream; no se pide /look.
    var opening = false;
    stream.addEventListener('opening', function () { opening = true; });
    stream.addEventListener('history', function (e) {
      log.innerHTML = '';
      var h = JSON.parse(e.data);
      h.forEach(function (m, i) { renderMessage(m, i === h.length - 1); });
      if (!opening && !h.some(function (m) { return !m.scene; })) command('look');
      enterGame();
    });
    stream.addEventListener('cast', function (e) { setCast(JSON.parse(e.data)); });
    stream.addEventListener('message', function (e) {
      var m = JSON.parse(e.data);
      inChat(function () {
        if (window.TavernusSfx) TavernusSfx.cue(m.sfx);
        loadBoard(); loadScene();
        return renderMessage(m, true, true);
      });
    });
    stream.addEventListener('sheet', loadSheet);
    stream.addEventListener('moment', function (e) { var x = JSON.parse(e.data); showMoment(x, x.seq); });
    stream.addEventListener('portrait', function (e) { setPortrait(JSON.parse(e.data)); });
    stream.addEventListener('place', function (e) { var p = JSON.parse(e.data); inChat(function () { placeReady(p); }); });
    paintConnect(stream);
    stream.addEventListener('journal', loadJournal);
    stream.addEventListener('presence', function (e) { renderPresence(JSON.parse(e.data)); });
    stream.addEventListener('typing', function (e) { showTyping(JSON.parse(e.data)); });
    stream.addEventListener('round', function (e) { showRound(JSON.parse(e.data)); });
    stream.addEventListener('queue', function (e) { waitingFor = JSON.parse(e.data).waiting_for || []; renderWaiting(); });
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
    // Los de depuración en offline llevan argumento («/time +2h», «/daño 5»); los demás, solo el nombre.
    if (text.charAt(0) === '/') command(/^\/(time|da[ñn]o)\s/i.test(text) ? text.trim() : text.split(/\s+/)[0]);
    else if (sayMode || (!$('saymode').hidden && /^[—–«"“-]/.test(text))) say(text);
    else if (text === 'tirar' || text === 'roll') { spendButtons(); roll(); }
    else act(text);
  });
  // Hacer ⇄ Decir; con destinatario, el primer toque lo quita y el segundo vuelve a Hacer.
  $('saymode').addEventListener('click', function () { if (sayMode && sayTo) setSayMode(true, null); else setSayMode(!sayMode); });
  document.querySelectorAll('.chips button').forEach(function (b) {
    b.addEventListener('click', function () { command(b.dataset.cmd); });
  });
  select.addEventListener('change', function () { connect(select.value); });

  // --- Panel: tablero o mapa; en el móvil, el panel es una vista aparte ---------------
  var view = store('tavernus.view') === 'map' ? 'map' : 'board';
  function setView(v) {
    view = v; store('tavernus.view', v);
    document.querySelectorAll('[data-view-tab]').forEach(function (b) { var on = b.getAttribute('data-view-tab') === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelectorAll('.pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== v; });
    if (v === 'board' && boardData) renderBoard(boardData);
    if (v === 'map' && mapData) renderMap(mapData);
  }
  function showSide(on) {
    if (!window.matchMedia('(max-width: 820px)').matches) return;
    document.body.classList.toggle('show-side', on);
    if (on) { if (view === 'board' && boardData) renderBoard(boardData); if (view === 'map' && mapData) renderMap(mapData); }
  }
  document.querySelectorAll('[data-view-tab]').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view-tab')); }); });
  $('to-side').addEventListener('click', function () { showSide(true); });
  $('side-close').addEventListener('click', function () { showSide(false); });
  // La ficha abre la Hoja; su círculo, el avatar (avatar.ts).
  $('card').addEventListener('click', function (ev) { if (!ev.target.closest('.av')) { showSide(false); openDrawer('sheet'); } });
  setView(view);

  // --- «Cerca de ti» y la misión, en el panel ----------------------------------------
  /** Quién está a la vista y los rincones del sitio, del más cercano al más lejano (datos del tablero). */
  function renderNear(b) {
    var rows = [], dist = function (sp) { return Math.hypot(sp.x - b.actor.x, sp.y - b.actor.y); };
    b.presences.filter(function (p) { return !p.moving && p.level !== 'hint'; }).forEach(function (p) {
      var sp = spotById(p.spot_id), d = sp ? dist(sp) : 0;
      rows.push({ d: d - 0.01, html: '<button type="button" class="prow" data-talk="' + escapeHtml(p.label) + '"><span class="ico npc" style="--npc:' + (p.kind === 'character' ? '#9cb08a' : '#e6a587') + '">' + escapeHtml(p.level === 'full' ? initial(p.label) : '?') + '</span>' +
        '<span class="tt"><b>' + escapeHtml(p.label) + '</b><small>' + escapeHtml(sp ? sp.name : '') + '</small></span><span class="m">' + (d < 1.6 ? 'Aquí' : fmtM(d)) + '</span></button>' });
    });
    b.spots.forEach(function (sp) {
      var here = isHere(sp), d = dist(sp);
      rows.push({ d: here ? -1 : d, html: '<button type="button" class="prow' + (here ? ' here' : '') + '" data-go="' + escapeHtml(sp.id) + '"' + (here ? ' disabled' : '') + '><span class="ico"><svg class="i"><use href="#i-pin"/></svg></span>' +
        '<span class="tt"><b>' + escapeHtml(sp.name) + '</b><small>' + escapeHtml(sp.description || '') + '</small></span><span class="m">' + (here ? 'Aquí' : fmtM(d)) + '</span></button>' });
    });
    rows.sort(function (x, y) { return x.d - y.d; });
    $('near').innerHTML = rows.length ? '<button type="button" class="sec-t" data-col="near" aria-expanded="' + !document.body.classList.contains('col-near') + '"><svg class="i chev"><use href="#i-chev"/></svg>Cerca de ti<span>' + rows.length + '</span></button><div class="sec-b">' + rows.slice(0, 8).map(function (r) { return r.html; }).join('') + '</div>' : '';
  }
  $('near').addEventListener('click', function (ev) {
    var go = ev.target.closest('[data-go]'), talk = ev.target.closest('[data-talk]');
    // «Cerca de ti» vive en el tablero o el mapa ampliados: al elegir algo, se cierra para ver el hilo.
    if (go || talk) {
      if (document.body.classList.contains('board-big')) toggleBig(false);
      if (document.body.classList.contains('map-big')) toggleMapBig(false);
    }
    if (go && !busy) { var sp = spotById(go.getAttribute('data-go')); if (sp && !isHere(sp)) { showSide(false); act('Ir a ' + sp.name); } }
    if (talk) { showSide(false); input.value = 'Hablo con ' + talk.getAttribute('data-talk') + ': '; input.focus(); }
  });
  /** La misión en curso (la fijada o la primera activa): título, plazo y pasos hechos; abre el Diario. */
  /**
   * Recuadro de misión del panel: la que el jugador sigue (estrella en el Diario) o, si no eligió, la principal.
   * Con el estado como icono, lo que toca ahora y el plazo; si hay misiones nuevas, una pastilla para verlas.
   */
  function renderQuest(j) {
    var live = j.quests.active.filter(function (x) { return x.status === 'active'; }), q = trackedQuest(j);
    // Indicador en el icono de misiones: altas (punto) y pasos o cierres (check) sin ver; se quita al abrir el Diario.
    var badge = questBadge(unseenChanges(j)), on = badge.added + badge.steps > 0;
    var chip = on ? '<button type="button" class="qchip" data-qnew title="Ver qué ha cambiado en el Diario">' + badge.html + '</button>' : '';
    $('to-side').classList.toggle('new', on);
    var h = '<div class="sec-row"><button type="button" class="sec-t" data-col="quest" aria-expanded="' + !document.body.classList.contains('col-quest') + '"><svg class="i chev"><use href="#i-chev"/></svg>' +
      '<span class="qflag' + (on ? ' on' : '') + '" data-qnew title="Misiones: abre el Diario"><svg class="i"><use href="#i-q-active"/></svg></span>Misión' + (live.length > 1 ? '<span>' + live.length + ' en curso</span>' : '') + '</button>' + chip + '</div><div class="sec-b">';
    if (!q) { $('quest').innerHTML = h + '<button type="button" class="prow" data-quest><span class="ico"><svg class="i"><use href="#i-board"/></svg></span><span class="tt"><b>Nada entre manos</b><small>Mira el tablón o habla con la gente</small></span></button></div>'; return; }
    var done = q.steps.filter(function (s) { return s.done; }).length, total = q.steps.length;
    var s = q.summary || { text: '', next: null };
    var line = s.next || s.text || '';
    var when = q.clock ? (q.clock.days_left <= 0 ? 'plazo vencido' : 'quedan ' + q.clock.days_left + (q.clock.days_left === 1 ? ' día' : ' días')) : '';
    h += '<button type="button" class="prow" data-quest title="Abrir en el Diario">' + questIcon(q, false) + '<span class="tt"><b>' + escapeHtml(q.title) + '</b>' +
      (line ? '<small>' + escapeHtml(line) + '</small>' : '') +
      (total > 1 ? '<span class="prog"><i><span style="width:' + Math.round(100 * done / total) + '%"></span></i><small>' + done + ' de ' + total + (when ? ' · ' + escapeHtml(when) : '') + '</small></span>' : (when ? '<small>' + escapeHtml(when) + '</small>' : '')) + '</span></button>';
    $('quest').innerHTML = h + '</div>';
  }
  /** Cabeceras plegables del panel (tablero, cerca, misión); se recuerda cuáles están cerradas. */
  function setCol(k, closed) {
    document.body.classList.toggle('col-' + k, closed);
    store('tavernus.col.' + k, closed ? '1' : '0');
    document.querySelectorAll('[data-col="' + k + '"]').forEach(function (b) { b.setAttribute('aria-expanded', closed ? 'false' : 'true'); });
    if (!closed && k === 'view') { if (view === 'board' && boardData) renderBoard(boardData); if (view === 'map' && mapData) renderMap(mapData); }
  }
  ['view', 'near', 'quest'].forEach(function (k) { if (store('tavernus.col.' + k) === '1') setCol(k, true); });
  $('side').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-col]');
    if (b) { var k = b.getAttribute('data-col'); setCol(k, !document.body.classList.contains('col-' + k)); }
  });
  $('quest').addEventListener('click', function (ev) {
    // La pastilla de novedades y el recuadro abren el Diario en Misiones (allí se ven marcadas las nuevas).
    if (ev.target.closest('[data-qnew]') || ev.target.closest('[data-quest]')) {
      ev.stopPropagation();
      journalSection = 'quests'; store('tavernus.journal.section', journalSection);
      showSide(false); openDrawer('journal');
    }
  });

  // --- El cubo: Hoja, Diario y Mochila en la misma columna del chat ---------------------
  var cube = $('cube'), cubeMenu = $('cube-menu'), drawer = $('drawer'), drawerKey = null;
  var DR_TITLE = { sheet: 'Hoja', journal: 'Diario', pack: 'Mochila' };
  function setMenu(on) {
    cubeMenu.hidden = !on; $('cube-scrim').hidden = !on;
    cube.setAttribute('aria-expanded', on ? 'true' : 'false');
    cube.classList.toggle('on', on || !!drawerKey);
    if (on) { var first = cubeMenu.querySelector('button'); if (first) first.focus(); }
  }
  function openDrawer(k) {
    drawerKey = k; setMenu(false);
    drawer.hidden = false; $('drawer-scrim').hidden = false;
    document.body.classList.add('drawer-open');
    $('dr-title').textContent = k === 'sheet' && sheetData ? 'Hoja de ' + sheetData.title.split(' · ')[0] : DR_TITLE[k];
    document.querySelectorAll('[data-dr]').forEach(function (b) { var on = b.getAttribute('data-dr') === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelectorAll('[data-drpane]').forEach(function (p) { p.hidden = p.getAttribute('data-drpane') !== k; });
    cube.classList.add('on');
    cube.setAttribute('aria-label', 'Cerrar ' + DR_TITLE[k].toLowerCase()); cube.title = 'Cerrar';
    if (k === 'sheet' && sheetData) renderSheet(sheetData);
    if (k === 'journal') {
      // Se pinta con las novedades marcadas y, ya vistas, dejan de contar en el recuadro del panel.
      if (journalData) renderJournal(journalData);
      markJournalSeen();
      if (journalData) renderQuest(journalData);
    }
  }
  function closeDrawer() {
    drawerKey = null;
    drawer.hidden = true; $('drawer-scrim').hidden = true;
    document.body.classList.remove('drawer-open');
    cube.classList.remove('on');
    cube.setAttribute('aria-label', 'Menú de la partida: hoja, diario y mochila'); cube.title = 'Hoja, diario y mochila';
    input.focus();
  }
  cube.addEventListener('click', function () {
    if (drawerKey) { closeDrawer(); return; }
    setMenu(cubeMenu.hidden);
  });
  $('cube-scrim').addEventListener('click', function () { setMenu(false); });
  cubeMenu.addEventListener('click', function (ev) { var b = ev.target.closest('[data-open]'); if (b) openDrawer(b.getAttribute('data-open')); });
  document.querySelectorAll('[data-dr]').forEach(function (b) { b.addEventListener('click', function () { openDrawer(b.getAttribute('data-dr')); }); });
  $('drawer-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('click', function (ev) { if (!cubeMenu.hidden && !ev.target.closest('#cube-menu') && !ev.target.closest('#cube')) setMenu(false); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !lightbox.hidden) return;
    if (!cubeMenu.hidden) { setMenu(false); cube.focus(); }
    else if (drawerKey && !document.body.classList.contains('board-big') && !document.body.classList.contains('map-big')) closeDrawer();
  });
  // El micrófono y el pincel se añaden delante de Enviar (voice-input.ts, paint.ts): el cubo, siempre pegado a Enviar.
  document.addEventListener('DOMContentLoaded', function () {
    var f = $('form');
    f.insertBefore(cube, f.querySelector('button[type=submit]'));
    var mic = f.querySelector('.mic');
    if (mic) document.querySelector('.inwrap').appendChild(mic);
    // Ajustes de la voz (tts.ts): el engranaje va en la cabecera del panel, donde estaba la casa.
    var more = document.querySelector('.chat-head .tts-more'), pop = document.querySelector('.chat-head .tts-pop'), gear = $('side-gear');
    if (more && pop) {
      more.innerHTML = '<svg class="i"><use href="#i-gear"/></svg>';
      more.title = 'Ajustes de la voz del narrador'; more.setAttribute('aria-label', more.title);
      gear.appendChild(more); gear.appendChild(pop);
    }
  });

  /** Avatares del grupo arriba a la derecha: cambian de personaje como el desplegable (que queda oculto). */
  function renderParty() {
    var party = $('party');
    party.innerHTML = '';
    if (document.body.classList.contains('bound')) { $('game-when').textContent = ''; return; }
    [].forEach.call(select.options, function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = initial(o.textContent); b.title = o.textContent;
      b.setAttribute('aria-pressed', o.value === current ? 'true' : 'false');
      if (o.value === current) b.className = 'on';
      b.addEventListener('click', function () { if (o.value !== current) { select.value = o.value; connect(o.value); } });
      party.appendChild(b);
    });
    var n = select.options.length;
    $('game-when').textContent = n > 1 ? '· ' + n + ' en el grupo' : '';
  }

  Promise.all([session, fetch(api('/api/characters')).then(function (r) { return r.json(); })]).then(function (both) {
    var me = both[0] || {}, list = both[1] || [];
    // Invitado ligado a su asiento: sin selector; solo su PJ.
    if (me.can_switch === false && me.character_id) {
      list = list.filter(function (c) { return c.id === me.character_id; });
      document.body.classList.add('bound');
    }
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
${AVATAR_SCRIPT}
</body>
</html>
`;
