/** Menú de partidas de la web: crear, continuar, demos y grabaciones. Un solo string, como page.ts. */

export const MENU = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tavernus</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
<meta name="theme-color" content="#141617">
<style>
  /* Estilo B5 (lienzo «Tavernus · Pantalla de partida»): tus partidas como los chats de WhatsApp. A la izquierda
     la lista; a la derecha la partida elegida o la creación de una nueva. En el móvil, la lista a pantalla completa,
     un botón flotante para crear y la creación como una hoja que sube desde abajo. */
  :root {
    --bg: #0e0f10; --panel: #141617; --chat: #0b0d0c; --bubble: #1f2426;
    --text: #ece7df; --muted: #9a948a; --faint: #8a847a;
    --accent: #e6b75a; --accent-ink: #2a1d05; --accent-tint: rgba(230,183,90,.14); --glow: #f0c56b;
    --platter: #1a1d1f; --control: #1d2022; --hover: rgba(255,255,255,.06); --sep: rgba(255,255,255,.06); --line: rgba(255,255,255,.08);
    --error: #ff6b5e; --ok: #4fbf7a; --info: #63d1ff; --rec: #e05a4a;
    --shadow: 0 12px 32px rgba(0,0,0,.55);
    --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --display: Manrope, Inter, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: flex; background: var(--bg); color: var(--text); font: 15px/1.47 var(--sans); -webkit-font-smoothing: antialiased; overflow: hidden; }
  input, select, button, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
  button { cursor: pointer; border: 0; }
  button:disabled { opacity: .5; cursor: default; }
  svg.i { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; white-space: nowrap; text-decoration: none; }
  .btn.primary { background: var(--accent); color: var(--accent-ink); }
  .btn.primary:hover:not(:disabled) { background: var(--glow); }
  .btn.ghost { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); font-weight: 500; }
  .btn.ghost:hover:not(:disabled) { background: var(--hover); }
  .btn.danger { color: #ff9d94; }
  .btn.danger.armed { background: rgba(255,107,94,.16); box-shadow: none; }
  .btn.sm { height: 32px; padding: 0 12px; font-size: 13px; }
  .btn svg.i, .ib svg.i { width: 16px; height: 16px; }
  .ib { display: inline-grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 50%; background: transparent; color: #b8b1a6; }
  .ib:hover { background: var(--hover); color: var(--text); }
  /* La imagen de cada partida: un rincón de la taberna, siempre el mismo para la misma partida. */
  .art { background-color: #1b1712; }

  /* Lista de partidas. */
  aside { flex: 0 0 400px; display: flex; flex-direction: column; min-width: 0; background: var(--panel); border-right: 1px solid var(--sep); }
  .head { display: flex; align-items: center; gap: 12px; padding: 16px 12px 10px 16px; }
  .mark { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 9px; background: var(--accent-tint); color: var(--accent); font: 800 18px/1 var(--display); }
  h1 { margin: 0; flex: 1; font: 800 20px/1.2 var(--display); letter-spacing: -.02em; }
  #status { display: flex; align-items: center; gap: 6px; padding: 0 16px 10px; font-size: 12.5px; color: var(--muted); }
  #status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  #status.off::before { background: var(--info); }
  #status[hidden] { display: none; }
  .search { margin: 0 12px 10px; display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 12px; border-radius: 10px; background: var(--control); color: var(--muted); }
  .search input, .search input[type=text] { flex: 1; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent; color: var(--text); outline: none; font-size: 14px; }
  .search input::placeholder { color: var(--faint); }
  .filters { display: flex; gap: 8px; padding: 0 12px 10px; overflow-x: auto; scrollbar-width: none; }
  .filters button { flex: none; height: 32px; padding: 0 14px; border-radius: 999px; background: transparent; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); color: var(--muted); font-size: 13px; font-weight: 500; }
  .filters button.on { background: var(--accent-tint); box-shadow: inset 0 0 0 1px rgba(230,183,90,.3); color: var(--accent); }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.12) transparent; }
  #resume { display: none; }
  .row { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 76px; padding: 10px 12px 10px 16px; border-bottom: 1px solid rgba(255,255,255,.05); background: transparent; color: var(--text); text-align: left; }
  .row:hover { background: rgba(255,255,255,.03); }
  .row.on { background: rgba(255,255,255,.06); }
  .row .pic { width: 52px; height: 52px; flex: none; border-radius: 50%; }
  .row .tt { min-width: 0; flex: 1; }
  .row .l1 { display: flex; align-items: center; gap: 8px; }
  .row .l1 b { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .l1 time { margin-left: auto; flex: none; font-size: 12px; color: var(--muted); }
  .row .l2 { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 13px; color: var(--muted); }
  .row .l2 span:first-child { min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-flex; align-items: center; gap: 5px; flex: none; font-size: 12px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .badge.live { color: var(--ok); } .badge.offline { color: var(--info); } .badge.record { color: var(--rec); } .badge.replay { color: var(--accent); }
  .row .more { display: none; }
  .menu-pop { position: absolute; right: 12px; top: 56px; z-index: 5; display: flex; flex-direction: column; min-width: 220px; padding: 6px; border-radius: 14px; background: var(--bubble); box-shadow: var(--shadow); }
  .menu-pop[hidden] { display: none; }
  .menu-pop button { text-align: left; height: 32px; padding: 0 12px; border-radius: 10px; background: transparent; font-size: 14px; }
  .menu-pop button:hover:not(:disabled) { background: var(--hover); }
  .menu-pop button.danger { color: #ff9d94; }
  .menu-pop button.danger.armed { background: rgba(255,107,94,.16); }
  .empty { margin: 14px 16px; color: var(--muted); font-size: 14px; }
  .error { color: #ff9d94; font-size: 14px; }
  #fab { display: none; }

  /* La partida elegida. */
  main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--chat); }
  #pick { flex: 1; min-height: 0; overflow-y: auto; }
  #pick[hidden] { display: none; }
  /* La imagen ocupa toda la columna, con la casa en su centro; el texto va encima, abajo a la izquierda. */
  #pick { position: relative; }
  .hero { position: relative; min-height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 40px 0; }
  .hero::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(11,13,12,.86) 0%, rgba(11,13,12,.6) 32%, rgba(11,13,12,.12) 62%, rgba(11,13,12,0) 80%), linear-gradient(to top, rgba(11,13,12,.5), rgba(11,13,12,0) 35%); }
  .hero .cap { position: relative; z-index: 1; padding: 0 40px; display: flex; flex-direction: column; gap: 8px; }
  .hero > .body, .hero > .intro { position: relative; z-index: 1; }
  .eyebrow { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .hero h2 { margin: 0; font: 800 clamp(28px, 3.4vw, 36px)/1.1 var(--display); letter-spacing: -.02em; overflow-wrap: anywhere; text-shadow: 0 2px 18px rgba(0,0,0,.5); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chips span { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 999px; background: rgba(14,15,16,.72); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); font-size: 12.5px; color: #d9d3c8; }
  .chips .badge { height: 28px; padding: 0 10px; border-radius: 999px; background: rgba(14,15,16,.72); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
  .body { max-width: 760px; padding: 18px 40px 0; display: flex; flex-direction: column; gap: 16px; }
  .cta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .gear-wrap { position: relative; display: inline-flex; }
  .ib.gear { width: 32px; height: 32px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
  .gear-wrap .menu-pop { left: 50%; right: auto; top: 52px; transform: translateX(-50%); min-width: 140px; }
  .gear-wrap .menu-pop button { text-align: center; white-space: nowrap; padding: 0 16px; }
  .kv-t { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .facts { color: var(--muted); font-size: 13.5px; }
  .intro { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; max-width: 520px; padding: 18px 40px 0; }
  .intro p { margin: 0; color: var(--muted); }

  /* Nueva partida, en la misma columna (en el móvil, una hoja desde abajo). */
  /* Escritorio: una modal centrada sobre el menú atenuado (no hace falta más sitio). */
  #new { position: fixed; top: 50%; left: 50%; z-index: 30; width: min(640px, calc(100vw - 48px)); max-height: min(860px, calc(100vh - 48px)); transform: translate(-50%, -50%); display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 24px 64px rgba(0,0,0,.6); overflow: hidden; }
  #new[hidden] { display: none; }
  #new-scrim { display: none; position: fixed; inset: 0; z-index: 29; border: 0; background: rgba(5,6,6,.62); }
  body.new-open #new-scrim { display: block; }
  .grab { display: none; }
  .new-head { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 0 16px 0 24px; border-bottom: 1px solid var(--sep); flex: none; }
  .new-head h2 { margin: 0; font: 700 18px/1.2 var(--display); letter-spacing: -.02em; }
  .new-head .ib { margin-left: auto; background: rgba(255,255,255,.06); color: var(--text); }
  #new-form { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0; }
  .new-body { flex: 1; min-height: 0; overflow-y: auto; }
  .new-in { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 20px; }
  .lead { margin: 0; color: var(--muted); font-size: 14px; }
  .fld { display: flex; flex-direction: column; gap: 8px; }
  .lbl { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .lbl .note { text-transform: none; letter-spacing: 0; font-weight: 400; }
  label.sub { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--muted); }
  input[type=text], input[type=number], select { width: 100%; height: 46px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--control); color: var(--text); outline: none; font-size: 15px; }
  select option { background: #1d2022; }
  input::placeholder { color: var(--faint); }
  input:focus, select:focus { border-color: rgba(230,183,90,.6); }
  .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .synopsis { margin: 2px 0 0; max-width: 620px; font-size: 15px; line-height: 1.5; color: #d9d3c8; text-shadow: 0 1px 10px rgba(0,0,0,.6); }
  .meta-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .avs { display: flex; align-items: center; }
  .avs span { display: grid; place-items: center; width: 30px; height: 30px; margin-left: -6px; border-radius: 50%; background: #22262a; border: 2px solid var(--chat); box-shadow: inset 0 0 0 1.5px currentColor; font-size: 12px; font-weight: 600; }
  .avs span:first-child { margin-left: 0; }
  .avs .c0 { color: var(--accent); } .avs .c1 { color: #8fe3ad; } .avs .c2 { color: #9ccbff; } .avs .c3 { color: #e6a587; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .opt { position: relative; display: flex; flex-direction: column; gap: 4px; min-height: 88px; padding: 12px 14px; border-radius: 14px; background: var(--platter); box-shadow: inset 0 0 0 1px var(--line); cursor: pointer; }
  .opt input { position: absolute; opacity: 0; pointer-events: none; }
  .opt b { font-size: 14.5px; font-weight: 600; }
  .opt small { font-size: 12.5px; line-height: 1.4; color: var(--muted); }
  .opt:has(input:checked) { background: rgba(230,183,90,.08); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .opt:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  #world-opts, #hook-row { display: flex; flex-direction: column; gap: 10px; }
  #world-opts[hidden], #hook-row[hidden] { display: none; }
  .note { font-size: 13px; color: var(--muted); }
  .warn { color: #ffb38a; }
  details { border-radius: 12px; background: var(--platter); box-shadow: inset 0 0 0 1px var(--sep); padding: 0 14px; }
  summary { display: flex; align-items: center; min-height: 48px; font-size: 14px; font-weight: 500; cursor: pointer; }
  details label.sub { padding: 0 0 14px; }
  .new-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 24px; border-top: 1px solid var(--sep); background: var(--panel); flex: none; }
  .new-foot .grow { flex: 1; min-width: 160px; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30; padding: 10px 16px; border-radius: 999px; background: var(--bubble); box-shadow: var(--shadow); color: #ff9d94; font-size: 14px; }
  #toast[hidden] { display: none; }
  /* Al entrar en una partida: fundido a negro. */
  body::after { content: ''; position: fixed; inset: 0; z-index: 200; background: #000; opacity: 0; pointer-events: none; transition: opacity .45s ease; }
  body.leaving::after { opacity: 1; pointer-events: auto; }

  /* Escritorio: la imagen ocupa toda la pantalla y el panel de partidas flota encima como cristal (liquid glass):
     gris claro translúcido, el fondo desenfocado detrás y brillos suaves de luz. Sin bordes. */
  @media (min-width: 821px) {
    main { position: fixed; inset: 0; z-index: 0; }
    body.new-open main { z-index: 3; }
    .hero .cap, .hero > .body, .hero > .intro { padding-left: 440px; }
    .hero::after { background: linear-gradient(90deg, rgba(11,13,12,.25) 0, rgba(11,13,12,.25) 400px, rgba(11,13,12,.82) 400px, rgba(11,13,12,.55) 720px, rgba(11,13,12,.1) 1000px, rgba(11,13,12,0) 1200px), linear-gradient(to top, rgba(11,13,12,.5), rgba(11,13,12,0) 35%); }
    aside { position: relative; z-index: 2; border-right: 0; isolation: isolate;
      background:
        radial-gradient(120% 55% at 0% 0%, rgba(255,255,255,.07), rgba(255,255,255,0) 60%),
        radial-gradient(90% 40% at 100% 100%, rgba(255,255,255,.04), rgba(255,255,255,0) 70%),
        linear-gradient(180deg, rgba(10,11,12,.66), rgba(10,11,12,.74));
      -webkit-backdrop-filter: blur(36px) saturate(1.3); backdrop-filter: blur(36px) saturate(1.3); }
    .search { background: rgba(255,255,255,.07); }
    .row { border-bottom-color: rgba(255,255,255,.07); }
    .row:hover { background: rgba(255,255,255,.06); }
    .row.on { background: rgba(255,255,255,.09); }
    .row .l2, .row .l1 time, #status { color: #c9c3b9; }
    .filters button { box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); color: #d9d3c8; }
  }
  @media (max-width: 820px) {
    aside { flex: 1; border-right: 0; }
    main { display: none; }
    body.new-open main { display: flex; position: fixed; inset: 0; z-index: 20; background: transparent; }
    body.new-open #pick { display: none; }
    #new { top: 64px; left: 0; right: 0; bottom: 0; width: auto; max-height: none; transform: none; border: 0; border-radius: 20px 20px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.5); }
    .grab { display: block; align-self: center; width: 40px; height: 4px; margin: 8px 0 0; border-radius: 999px; background: rgba(255,255,255,.2); }
    .new-head { min-height: 52px; padding: 0 8px 0 16px; }
    .new-in { padding: 8px 16px 20px; }
    .grid3, .grid2 { grid-template-columns: 1fr; }
    .opt { min-height: 0; }
    .new-foot { padding: 10px 16px calc(14px + env(safe-area-inset-bottom)); }
    .new-foot .btn.primary { width: 100%; }
    .new-foot .btn.ghost { display: none; }
    .new-foot .grow:has(#new-error:empty) { display: none; }
    #open-new { display: none; }
    #fab { position: fixed; right: 16px; bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 10; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px 0 10px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-weight: 600; box-shadow: 0 8px 20px rgba(0,0,0,.5); }
    .scroll { padding-bottom: 96px; }
    #resume { position: relative; display: block; height: 190px; margin: 4px 12px 14px; border-radius: 18px; overflow: hidden; color: var(--text); text-decoration: none; box-shadow: 0 4px 14px rgba(0,0,0,.45); width: calc(100% - 24px); text-align: left; }
    #resume[hidden] { display: none; }
    #resume::after { content: ''; position: absolute; inset: 25% 0 0; background: linear-gradient(to top, rgba(11,13,12,.95), rgba(11,13,12,0)); }
    #resume .cap { position: absolute; left: 16px; right: 16px; bottom: 14px; z-index: 1; display: flex; flex-direction: column; gap: 4px; }
    #resume b { font: 800 20px/1.2 var(--display); letter-spacing: -.02em; }
    #resume .go { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: #d9d3c8; }
    #resume .go span:first-child { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #resume .go span:last-child { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 10px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-size: 13px; font-weight: 600; }
    .row .more { display: inline-grid; }
  }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/></symbol>
  <symbol id="i-more" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></symbol>
</svg>
<aside>
  <div class="head">
    <span class="mark" aria-hidden="true">T</span>
    <h1>Tavernus</h1>
    <button id="open-new" class="btn primary sm" type="button"><svg class="i"><use href="#i-plus"/></svg>Nueva partida</button>
  </div>
  <div id="status" hidden></div>
  <label class="search"><svg class="i"><use href="#i-search"/></svg><span class="vh">Buscar partidas</span><input id="q" type="text" placeholder="Buscar partidas" autocomplete="off"></label>
  <div class="filters" role="tablist" aria-label="Tipo de partida">
    <button type="button" role="tab" data-list="continue" class="on">Partidas · <span id="n-continue">0</span></button>
    <button type="button" role="tab" data-list="demos">Demos · <span id="n-demos">0</span></button>
    <button type="button" role="tab" data-list="recordings">Grabaciones · <span id="n-recordings">0</span></button>
  </div>
  <div class="scroll">
    <button type="button" id="resume" class="art" hidden><span class="cap"><span class="eyebrow">Continúa tu historia</span><b id="resume-name"></b><span class="go"><span id="resume-meta"></span><span><svg class="i" style="width:14px;height:14px"><use href="#i-play"/></svg>Continuar</span></span></span></button>
    <div id="list"></div>
  </div>
  <button type="button" id="fab"><svg class="i"><use href="#i-plus"/></svg>Nueva partida</button>
</aside>
<main>
  <section id="pick" aria-live="polite"></section>
  <button type="button" id="new-scrim" aria-label="Cerrar"></button>
  <section id="new" role="dialog" aria-labelledby="new-title" hidden>
    <span class="grab" aria-hidden="true"></span>
    <div class="new-head">
      <h2 id="new-title">Nueva partida</h2>
      <button class="ib" type="button" id="close-new" aria-label="Cerrar"><svg class="i"><use href="#i-x"/></svg></button>
    </div>
    <form id="new-form" autocomplete="off">
      <div class="new-body"><div class="new-in">
        <p class="lead" id="new-lead">Empieza en la taberna de la semilla, con los personajes de siempre y, si quieres, uno tuyo.</p>
        <label class="fld"><span class="lbl">Nombre de la partida</span>
          <input id="g-name" type="text" maxlength="60" placeholder="La noche del Brezal" required></label>
        <div class="fld" role="radiogroup" aria-labelledby="lbl-world">
          <span class="lbl" id="lbl-world">Mundo</span>
          <div class="grid2">
            <label class="opt"><input type="radio" name="world" value="demo" checked><b>Brezal (demo)</b><small>Campaña escrita: la aldea de siempre, con su historia en tres actos y tu personaje con un porqué.</small></label>
            <label class="opt"><input type="radio" name="world" value="generated"><b>Mundo nuevo (generado)</b><small>Otro lugar, otra historia, y tu personaje con un porqué.</small></label>
          </div>
        </div>
        <div id="world-opts" hidden>
          <div class="grid2">
            <label class="sub">Tono<select id="g-tone"></select></label>
            <label class="sub">Semilla del mundo · vacía: al azar<input id="g-wseed" type="number" min="0" max="4294967295" step="1" placeholder="al azar"></label>
          </div>
          <label class="sub">Ambientación · opcional<input id="g-setting" type="text" maxlength="300" placeholder="Fantasía oscura, ciencia ficción, postapocalíptico…"></label>
          <p id="world-test" class="note warn" hidden>En offline es un mundo de prueba: la estructura cambia con la semilla, pero nombres y textos son de plantilla. Para un mundo escrito por Claude, elige «Real».</p>
        </div>
        <div class="fld" role="radiogroup" aria-labelledby="lbl-master">
          <span class="lbl" id="lbl-master">Máster</span>
          <div class="grid3">
            <label class="opt"><input type="radio" name="mode" value="live" checked><b>Real</b><small>Claude narra cada acción. Gasta tokens.</small></label>
            <label class="opt"><input type="radio" name="mode" value="offline"><b>Offline</b><small>Sin API: narración sencilla y gratis.</small></label>
            <label class="opt"><input type="radio" name="mode" value="record"><b>Grabar demo</b><small>Real, y guarda cada respuesta para repetirla.</small></label>
          </div>
          <p id="key-warn" class="note warn" hidden>No hay ANTHROPIC_API_KEY: en real o grabando, el máster narrará en plano.</p>
        </div>
        <div class="fld">
          <span class="lbl">Tu personaje <span class="note">· opcional</span></span>
          <div class="grid3">
            <label class="sub">Nombre<input id="g-char" type="text" maxlength="24" placeholder="Aren"></label>
            <label class="sub">Raza<select id="g-race"></select></label>
            <label class="sub">Clase<select id="g-class"></select></label>
          </div>
          <div id="hook-row" hidden>
            <label class="sub">¿Qué le trae aquí? · si lo dejas vacío, el mundo se lo inventa<input id="g-hook" type="text" maxlength="400" placeholder="Busca a su hermano, que vino a este pueblo y no volvió"></label>
          </div>
          <label class="sub">Cómo se ve · de aquí sale su retrato; luego puedes pedir otro<input id="g-look" type="text" maxlength="300" placeholder="Pelo cobrizo trenzado, cicatriz en la ceja, capa de lana verde"></label>
        </div>
        <details>
          <summary>Opciones avanzadas</summary>
          <label class="sub">Semilla de dados · vacía: al azar; al grabar se elige una sola<input id="g-seed" type="number" min="0" max="4294967295" step="1" placeholder="p. ej. 1234"></label>
        </details>
        <p id="gen-note" class="note" hidden></p>
      </div></div>
      <div class="new-foot">
        <span class="grow"><span id="new-error" class="error" role="alert"></span></span>
        <button class="btn ghost sm" type="button" id="cancel-new">Cancelar</button>
        <button class="btn primary" type="submit">Crear y jugar</button>
      </div>
    </form>
  </section>
</main>
<div id="toast" role="alert" hidden></div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MODE = { live: 'Máster real', offline: 'Offline', record: 'Grabando', replay: 'Demo' };
  var apiKey = true, modeTouched = false, lists = { continue: [], demos: [], recordings: [] }, tab = 'continue', selected = null, query = '';
  var mobile = function () { return window.matchMedia('(max-width: 820px)').matches; };

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
  /** Hora corta para la lista, como en WhatsApp: «21:40», «ayer», «12 oct». */
  function stamp(iso) {
    var t = Date.parse(iso);
    if (!t) return '';
    var d = new Date(t), now = new Date(), days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (days === 0) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'ayer';
    if (days < 7) return d.toLocaleDateString('es-ES', { weekday: 'short' });
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }
  /** Solo la fecha: «21 oct 2026». */
  function day(iso) { try { return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; } }
  /** Entrar en una partida: fundido a negro y, al terminar, la página de la partida (que aparece desde negro). */
  function open(slug, character) {
    var url = '/?game=' + encodeURIComponent(slug) + (character ? '&character=' + encodeURIComponent(character) : '');
    if (document.body.classList.contains('leaving')) return;
    document.body.classList.add('leaving');
    setTimeout(function () { location.href = url; }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 480);
  }
  // Si se vuelve con «atrás» y el navegador restaura la página, se quita el negro.
  window.addEventListener('pageshow', function () { document.body.classList.remove('leaving'); });
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
  function badge(g) { return el('span', 'badge ' + g.mode, (MODE[g.mode] || g.mode) + (g.main ? ' · principal' : '')); }
  function when(g) { return g.last_opened_at ? 'Jugada ' + ago(g.last_opened_at) : 'Creada ' + ago(g.created_at) + ' · sin jugar'; }
  /**
   * La taberna es por ahora la imagen de todas las partidas. Se encuadra para que la casa quede en el centro del
   * hueco en cualquier pantalla: la imagen cubre el hueco (y, en las miniaturas, se acerca data-zoom veces) y se
   * desplaza en píxeles para llevar el centro de la casa al centro. Si no cabe, se queda lo más cerca posible.
   */
  var ART = { w: 1920, h: 1071, x: 0.497, y: 0.324 };
  function art(node) {
    node.style.backgroundImage = 'url(/assets/taberna.jpg)';
    node.style.backgroundRepeat = 'no-repeat';
    fitArt(node);
  }
  function fitArt(node) {
    var W = node.clientWidth, H = node.clientHeight;
    if (!W || !H) return;
    var zoom = Number(node.getAttribute('data-zoom')) || 1;
    // data-left: lo que tapa el panel de cristal a la izquierda; la casa se centra en lo que queda a la vista.
    var L = window.matchMedia('(max-width: 820px)').matches ? 0 : Number(node.getAttribute('data-left')) || 0;
    var cx = L + (W - L) / 2, cy = H / 2;
    // Lo justo para cubrir el hueco y, además, para que la casa pueda ponerse en ese centro sin dejar bordes vacíos.
    var k = Math.max(W / ART.w, H / ART.h, cy / (ART.y * ART.h), (H - cy) / ((1 - ART.y) * ART.h), cx / (ART.x * ART.w), (W - cx) / ((1 - ART.x) * ART.w)) * zoom;
    var iw = ART.w * k, ih = ART.h * k;
    var clamp = function (v, lo) { return Math.min(0, Math.max(lo, v)); };
    var x = clamp(cx - ART.x * iw, W - iw), y = clamp(cy - ART.y * ih, H - ih);
    node.style.backgroundSize = Math.round(iw) + 'px ' + Math.round(ih) + 'px';
    node.style.backgroundPosition = Math.round(x) + 'px ' + Math.round(y) + 'px';
  }
  var fitTimer = null;
  window.addEventListener('resize', function () { clearTimeout(fitTimer); fitTimer = setTimeout(function () { document.querySelectorAll('.art').forEach(fitArt); }, 100); });
  function summary(g) {
    var bits = [];
    if (g.characters.length) bits.push(g.characters.join(', '));
    if (g.mode === 'record' || g.mode === 'replay') bits.push(g.cache_entries + ' respuestas grabadas');
    if (g.world) bits.push(g.world.template ? 'mundo de plantilla' : 'mundo generado');
    return bits.join(' · ') || 'Sin personajes todavía';
  }

  /** Borrar pide un segundo clic en 4 s, sin diálogos del navegador. */
  function deleteButton(g, cls) {
    var timer = null;
    return button('Borrar', cls, function (b) {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = '¿Seguro? Pulsa otra vez';
        timer = setTimeout(function () { b.classList.remove('armed'); b.textContent = 'Borrar'; }, 4000);
        return;
      }
      clearTimeout(timer); b.disabled = true;
      call('DELETE', '/api/games?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) toast(r.text); if (selected === g.slug) selected = null; load(); });
    });
  }
  /** Acciones de cada lista además de «Abrir»: en el detalle (escritorio) o en el menú «⋮» de la fila (móvil). */
  function extras(g, cls) {
    if (tab === 'demos') return [
      button('Jugar desde el principio', cls, function (b) {
        b.disabled = true;
        call('POST', '/api/games/reset?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) { toast(r.text); load(); } else open(g.slug); });
      }),
      deleteButton(g, cls + ' danger'),
    ];
    if (tab === 'recordings') return [
      button('Convertir en demo', cls, function (b) {
        b.disabled = true;
        call('POST', '/api/games/demo?game=' + encodeURIComponent(g.slug)).then(function (r) { if (!r.ok) toast(r.text); load(); });
      }),
      deleteButton(g, cls + ' danger'),
    ];
    return [deleteButton(g, cls + ' danger')];
  }

  function row(g) {
    var r = el('div', 'row' + (g.slug === selected ? ' on' : ''));
    r.setAttribute('role', 'button'); r.tabIndex = 0;
    r.setAttribute('aria-label', g.name + '. ' + when(g));
    var pic = el('span', 'pic art'); pic.setAttribute('data-zoom', '2.6'); r.appendChild(pic); art(pic);
    var tt = el('span', 'tt');
    var l1 = el('span', 'l1'); l1.appendChild(el('b', '', g.name)); l1.appendChild(el('time', '', stamp(g.last_opened_at || g.created_at))); tt.appendChild(l1);
    var l2 = el('span', 'l2'); l2.appendChild(el('span', '', summary(g))); l2.appendChild(badge(g)); tt.appendChild(l2);
    r.appendChild(tt);
    var pop = el('div', 'menu-pop'); pop.hidden = true;
    extras(g, '').forEach(function (b) { pop.appendChild(b); });
    var more = el('button', 'ib more'); more.type = 'button'; more.setAttribute('aria-label', 'Más acciones'); more.innerHTML = icon('i-more');
    more.addEventListener('click', function (ev) { ev.stopPropagation(); var was = pop.hidden; closeMenus(); pop.hidden = !was; });
    r.appendChild(more); r.appendChild(pop);
    var go = function () { if (mobile()) open(g.slug); else { selected = g.slug; closeNew(); render(); } };
    r.addEventListener('click', go);
    r.addEventListener('dblclick', function () { open(g.slug); });
    r.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (ev.key === 'Enter' && g.slug === selected) open(g.slug); else go(); } });
    return r;
  }
  function closeMenus() { document.querySelectorAll('.menu-pop').forEach(function (p) { p.hidden = true; }); }
  document.addEventListener('click', closeMenus);

  var EMPTY = {
    continue: 'Aún no hay partidas. Crea la primera con «Nueva partida».',
    demos: 'La carpeta de demos está vacía. Graba una partida y conviértela en demo.',
    recordings: 'No hay grabaciones. Crea una partida en modo «Grabar demo».',
  };
  var CTA = { continue: 'Continuar partida', demos: 'Jugar la demo', recordings: 'Abrir la grabación' };
  var EYEBROW = { continue: 'Continúa tu historia', demos: 'Demo jugable', recordings: 'Grabación' };

  /** La partida elegida, a la derecha: imagen, en qué punto está, «Continuar» y el grupo. */
  function detail(g, first) {
    var p = $('pick');
    p.innerHTML = '';
    if (!g) {
      var hero = el('div', 'hero art'); hero.setAttribute('data-left', '400');
      hero.innerHTML = '<div class="cap"><span class="eyebrow">Tavernus</span><h2>Rol por chat con un máster de IA</h2></div>';
      p.appendChild(hero);
      var box = el('div', 'intro');
      box.appendChild(el('p', '', EMPTY[tab]));
      if (tab === 'continue') box.appendChild(button('Nueva partida', 'btn primary', openNew));
      hero.appendChild(box);
      art(hero);
      return;
    }
    var hero2 = el('div', 'hero art'); hero2.setAttribute('data-left', '400');
    var cap = el('div', 'cap');
    cap.appendChild(el('span', 'eyebrow', tab === 'continue' && !first ? 'Partida en curso' : EYEBROW[tab]));
    cap.appendChild(el('h2', '', g.name));
    var chips = el('div', 'chips');
    chips.appendChild(badge(g));
    chips.appendChild(el('span', '', when(g)));
    if (g.world) chips.appendChild(el('span', '', (g.world.template ? 'Mundo de plantilla' : 'Mundo generado') + ' · semilla ' + g.world.seed));
    if (g.mode === 'record' || g.mode === 'replay') chips.appendChild(el('span', '', g.cache_entries + ' respuestas grabadas'));
    cap.appendChild(chips);
    if (g.synopsis) cap.appendChild(el('p', 'synopsis', g.synopsis));
    else if (tab === 'continue') cap.appendChild(el('p', 'synopsis', g.characters.length ? 'Tu grupo te espera donde lo dejasteis.' : 'La partida está lista: entra y crea tu personaje.'));
    hero2.appendChild(cap);
    p.appendChild(hero2);
    var body = el('div', 'body');
    var cta = el('div', 'cta');
    var go = el('button', 'btn primary'); go.type = 'button'; go.innerHTML = icon('i-play') + CTA[tab];
    go.addEventListener('click', function () { open(g.slug); });
    cta.appendChild(go);
    // Ajustes de la partida: un botón redondo con su menú (de momento, borrar; en demos y grabaciones, sus extras).
    var wrap = el('span', 'gear-wrap');
    var gear = el('button', 'ib gear'); gear.type = 'button'; gear.innerHTML = icon('i-gear');
    gear.title = 'Ajustes de la partida'; gear.setAttribute('aria-label', gear.title); gear.setAttribute('aria-haspopup', 'menu'); gear.setAttribute('aria-expanded', 'false');
    var menu = el('div', 'menu-pop'); menu.hidden = true; menu.setAttribute('role', 'menu');
    extras(g, '').forEach(function (b) { b.setAttribute('role', 'menuitem'); menu.appendChild(b); });
    gear.addEventListener('click', function (ev) { ev.stopPropagation(); var was = menu.hidden; closeMenus(); menu.hidden = !was; gear.setAttribute('aria-expanded', String(was)); });
    wrap.appendChild(gear); wrap.appendChild(menu);
    cta.appendChild(wrap);
    body.appendChild(cta);
    var meta = el('div', 'meta-line');
    if (g.characters.length) {
      var avs = el('span', 'avs'); avs.setAttribute('aria-label', 'Grupo: ' + g.characters.join(', '));
      g.characters.forEach(function (n, i) { var a = el('span', 'c' + (i % 4), n.charAt(0).toUpperCase()); a.title = n; avs.appendChild(a); });
      meta.appendChild(avs);
    }
    meta.appendChild(el('span', 'facts', 'Creada el ' + day(g.created_at)));
    body.appendChild(meta);
    hero2.appendChild(body);
    art(hero2);
  }

  function visible() {
    var q = query.trim().toLowerCase();
    return lists[tab].filter(function (g) { return !q || g.name.toLowerCase().indexOf(q) >= 0 || g.characters.join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  function render() {
    var box = $('list'), games = visible();
    box.innerHTML = '';
    document.querySelectorAll('.filters [data-list]').forEach(function (b) { var on = b.getAttribute('data-list') === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (!games.some(function (g) { return g.slug === selected; })) selected = games[0] ? games[0].slug : null;
    if (!games.length) box.appendChild(el('p', 'empty', query ? 'Ninguna partida coincide.' : EMPTY[tab]));
    games.forEach(function (g) { box.appendChild(row(g)); });
    box.querySelectorAll('.art').forEach(fitArt);
    var g = games.filter(function (x) { return x.slug === selected; })[0];
    detail(g, g && lists.continue[0] && g.slug === lists.continue[0].slug);
    // Móvil: la última partida jugada, en grande arriba, para seguir con un toque.
    var last = tab === 'continue' && !query ? lists.continue[0] : null, resume = $('resume');
    resume.hidden = !last;
    if (last) {
      art(resume);
      $('resume-name').textContent = last.name;
      $('resume-meta').textContent = [MODE[last.mode], when(last)].join(' · ');
      resume.onclick = function () { open(last.slug); };
    }
  }
  document.querySelectorAll('.filters [data-list]').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-list'); selected = null; render(); }); });
  $('q').addEventListener('input', function () { query = $('q').value; render(); });

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
      render();
      if (!games.length && !mobile()) openNew();
    }).catch(function () { $('list').innerHTML = '<p class="error empty">No hay conexión con el servidor.</p>'; });
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

  function openNew() {
    $('new').hidden = false;
    document.body.classList.add('new-open');
    setTimeout(function () { $('g-name').focus(); }, 30);
  }
  function closeNew() {
    if ($('new').hidden) return;
    $('new').hidden = true;
    document.body.classList.remove('new-open');
    render();
  }
  $('open-new').addEventListener('click', openNew);
  $('fab').addEventListener('click', openNew);
  $('close-new').addEventListener('click', closeNew);
  $('cancel-new').addEventListener('click', closeNew);
  $('new-scrim').addEventListener('click', closeNew);
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
