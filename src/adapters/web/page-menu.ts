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
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/assets/icon-512.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
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
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 18px; border-radius: 999px; font-size: 14.5px; font-weight: 600; white-space: nowrap; text-decoration: none; }
  .btn.primary { background: var(--accent); color: var(--accent-ink); }
  .btn.primary:hover:not(:disabled) { background: var(--glow); }
  .btn.ghost { background: transparent; color: var(--text); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); font-weight: 500; }
  .btn.ghost:hover:not(:disabled) { background: var(--hover); }
  .btn.danger { color: #ff9d94; }
  .btn.danger.armed { background: rgba(255,107,94,.16); box-shadow: none; }
  .btn.sm { height: 40px; padding: 0 16px; font-size: 14px; }
  .btn svg.i, .ib svg.i { width: 18px; height: 18px; }
  .ib { display: inline-grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: 50%; background: transparent; color: #b8b1a6; }
  .ib:hover { background: var(--hover); color: var(--text); }
  /* La imagen de cada partida: un rincón de la taberna, siempre el mismo para la misma partida. */
  .art { background-color: #1b1712; }

  /* Lista de partidas. */
  /* Tabla de tablones pintados (public/menu-madera.jpg, se repite hacia abajo sin corte) dentro de un marco de la misma
     madera bañada en oro, con esquineras de remaches (public/menu-marco.png), en 9 piezas: las esquinas no se deforman
     y cada lado es un tramo que empalma consigo mismo y se repite en bloques, sin estirarse, sea cual sea el alto.
     --frame es lo que mide una esquina; el marco tiene 3/4 de eso de grosor. El relieve: el marco proyecta sombra
     sobre los tablones (que quedan hundidos) y el panel, sobre la imagen. */
  aside { --frame: clamp(52px, 4.4vw, 64px); position: relative; isolation: isolate; flex: 0 0 440px; display: flex; flex-direction: column; min-width: 0;
    padding: calc(var(--frame) * .82) calc(var(--frame) * .8); border-right: 0; background: transparent; }
  aside::before { content: ''; position: absolute; inset: calc(var(--frame) * .5); z-index: -1;
    background: linear-gradient(180deg, rgba(14,10,6,.5), rgba(14,10,6,.66)), url(/assets/menu-madera.jpg?v=2) center top / 760px auto repeat #2a1d12;
    box-shadow: inset 0 0 40px rgba(0,0,0,.6); }
  aside::after { content: ''; position: absolute; inset: 0; z-index: 3; pointer-events: none;
    border: var(--frame) solid transparent; border-image: url(/assets/menu-marco.png?v=8) 110 / var(--frame) round;
    filter: drop-shadow(3px 6px 6px rgba(0,0,0,.75)) drop-shadow(0 0 14px rgba(0,0,0,.45)); }
  /* Dentro del marco ya hay margen: los bloques del panel van más pegados a él. */
  aside .head { gap: 8px; padding: 10px 6px 12px; }
  /* Todo lo translúcido del panel (buscador, filtros, partidas, botón de música) lleva el mismo relleno oscuro y
     desenfoca los tablones de detrás, como un cristal ahumado. */
  aside { --glass: rgba(10,8,6,.5); --glass-hover: rgba(10,8,6,.62); --glass-on: rgba(10,8,6,.72); }
  aside .search, aside .row, aside .btn.ghost {
    background: var(--glass); -webkit-backdrop-filter: blur(10px) saturate(1.1); backdrop-filter: blur(10px) saturate(1.1); }
  aside .search { flex: 1; margin: 0; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
  aside .btn.ghost:hover:not(:disabled), aside .btn.ghost[aria-expanded=true] { background: var(--glass-hover); }
  /* Buscador y, a su derecha, Ajustes: un menú con las listas (partidas, demos, grabaciones) y cuántas hay. */
  .searchrow { position: relative; display: flex; gap: 8px; margin: 0 6px 12px; }
  /* Buscador, música y Ajustes: 40 px de alto (los botones, redondos de 40 × 40). */
  .searchrow .btn, #music { width: 40px; height: 40px; padding: 0; }
  aside .search { height: 40px; border-radius: 12px; }
  aside .search input, aside .search input[type=text] { height: 38px; }
  .filters.menu, .dd-menu { position: absolute; top: 48px; right: 0; z-index: 5; display: flex; flex-direction: column; gap: 2px; min-width: 210px; padding: 6px;
    border-radius: 14px; background: rgba(14,11,8,.9); box-shadow: 0 12px 28px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.08);
    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
  .filters.menu[hidden], .dd-menu[hidden] { display: none; }
  .filters.menu button, .dd-menu button { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 36px; padding: 0 12px; border-radius: 10px;
    background: transparent; box-shadow: none; color: var(--text); font-size: 13.5px; font-weight: 500; }
  .filters.menu button:hover, .dd-menu button:hover { background: rgba(255,255,255,.07); }
  .filters.menu button span:last-child { color: var(--muted); font-variant-numeric: tabular-nums; }
  .filters.menu button.on, .dd-menu button.on { background: var(--accent-tint); box-shadow: none; color: var(--accent); }
  .filters.menu button.on span:last-child { color: var(--accent); }
  .new-wrap { display: flex; justify-content: center; padding: 6px 0 14px; }
  /* Cada partida, una tarjeta oscura con las esquinas redondeadas, separada del marco y de las demás. */
  aside .scroll { padding: 2px 6px 8px; }
  aside .row { padding: 12px 14px; margin-bottom: 8px; border-radius: 14px; border-bottom: 0; }
  aside .row:hover { background: var(--glass-hover); }
  aside .row.on { background: rgba(146,108,34,.82); box-shadow: none; text-shadow: 0 1px 2px rgba(0,0,0,.45); }
  aside .row.on .l2, aside .row.on .l1 time { color: #f3ead8; }
  /* Sobre el dorado, el estado en crema; solo la bolita conserva su color, con un aro oscuro para que destaque. */
  aside .row.on .badge { color: #f6efe0; }
  aside .row.on .badge::before { box-shadow: 0 0 0 1.5px rgba(0,0,0,.35); }
  aside .row.on .badge.live::before { background: var(--ok); } aside .row.on .badge.offline::before { background: var(--info); }
  aside .row.on .badge.record::before { background: var(--rec); } aside .row.on .badge.replay::before { background: var(--glow); }
  .head { display: flex; align-items: center; gap: 12px; padding: 16px 12px 10px 16px; }
  .mark { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 9px; background: var(--accent-tint); color: var(--accent); font: 800 18px/1 var(--display); overflow: hidden; }
  .mark img { display: block; width: 100%; height: 100%; object-fit: cover; }
  h1 { margin: 0; flex: 1; font: 800 20px/1.2 var(--display); letter-spacing: -.02em; }
  /* El nombre, en letras de madera dorada (public/logo-tavernus.png): 24 px de alto, con su sombra sobre los tablones. */
  h1 .logo { display: block; height: 24px; width: auto; filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
  /* Estado del máster: solo la bolita y el texto, en verde, arriba a la izquierda sobre la imagen, fuera del panel. */
  #status { position: fixed; top: 22px; left: 470px; z-index: 4; display: flex; align-items: center; gap: 6px;
    font-size: 11.5px; font-weight: 600; color: var(--ok); text-shadow: 0 1px 3px rgba(0,0,0,.8); }
  #status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
  #status.off { color: var(--info); }
  body.new-open #status { display: none; }
  #status[hidden] { display: none; }
  .search { margin: 0 12px 10px; display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 12px; border-radius: 10px; background: var(--control); color: var(--muted); }
  .search input, .search input[type=text] { flex: 1; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent; color: var(--text); outline: none; font-size: 14px; }
  .search input::placeholder { color: var(--faint); }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.12) transparent; }
  #resume { display: none; }
  .row { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 76px; padding: 10px 12px 10px 16px; border-bottom: 1px solid rgba(255,255,255,.05); background: transparent; color: var(--text); text-align: left; }
  .row:hover { background: rgba(255,255,255,.03); }
  .row.on { background: rgba(255,255,255,.06); }
  .row .pic { width: 52px; height: 52px; flex: none; border-radius: 50%; box-shadow: 0 0 0 3px var(--ring, rgba(255,255,255,.25)); }
  .row .tt { min-width: 0; flex: 1; }
  .row .l1 { display: flex; align-items: center; gap: 8px; }
  .row .l1 b { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .l1 time { margin-left: auto; flex: none; font-size: 12px; color: var(--muted); }
  .row .l2 { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 13px; color: var(--muted); }
  .row .l2 span:first-child { min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-flex; align-items: center; gap: 5px; flex: none; font-size: 12px; font-weight: 500; color: var(--muted); white-space: nowrap; }
  .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .badge.live { color: var(--ok); } .badge.offline { color: var(--info); } .badge.record { color: var(--rec); } .badge.replay { color: var(--accent); }
  /* Solo la bolita (el tipo de máster va en el title): algo mayor y con un halo de su color. */
  .badge.dot { position: relative; gap: 0; font-size: 0; padding: 4px; margin: -4px; cursor: default; }
  .badge.dot::before { width: 8px; height: 8px; }
  /* El tipo de máster, en un globo al pasar el ratón (o al enfocarla con el teclado). */
  .badge.dot[data-tip]:hover::after, .badge.dot[data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; top: 50%; right: calc(100% + 8px); transform: translateY(-50%); z-index: 40;
    padding: 5px 9px; border-radius: 8px; background: rgba(14,15,16,.96); box-shadow: 0 6px 18px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.08);
    color: var(--text); font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: none; white-space: nowrap; pointer-events: none; }
  .eyebrow .badge.dot { margin-left: 10px; vertical-align: middle; }
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
  .ib.gear { width: 40px; height: 40px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
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
  label.sub, div.sub { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--muted); }
  input[type=text], input[type=number], select { width: 100%; height: 46px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--control); color: var(--text); outline: none; font-size: 15px; }
  select option { background: #1d2022; }
  /* Nombre de la partida y, a su derecha, los invitados (plazas para amigos): icono, cuántos y un menú. */
  .name-grid { display: grid; grid-template-columns: minmax(0, 1fr) 104px 46px; gap: 8px; }
  /* Botón cuadrado de icono (Opciones avanzadas, Aspecto) con su ventanita sin velo debajo. */
  .popwrap { position: relative; }
  .sq-btn { position: relative; display: grid; place-items: center; width: 46px; height: 46px; border: 1px solid var(--line); border-radius: 12px; background: var(--control); color: var(--muted); }
  .sq-btn:hover, .sq-btn[aria-expanded=true] { color: var(--text); border-color: rgba(230,183,90,.55); }
  .sq-btn.set { color: var(--accent); }
  .sq-btn.set::after { content: ''; position: absolute; top: 6px; right: 6px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .dd-menu.pop { top: 52px; width: 300px; gap: 10px; padding: 14px; }
  .dd-menu.pop b { font-size: 14px; font-weight: 600; color: var(--text); }
  .dd-menu.pop .note { margin: 0; font-size: 12.5px; line-height: 1.45; }
  .char-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) 46px; gap: 8px; align-items: end; }
  .seats { position: relative; }
  .seats-btn { display: flex; align-items: center; gap: 10px; width: 100%; height: 46px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--control); color: var(--text); font-size: 15px; }
  .seats-btn svg.i { color: var(--muted); }
  .seats-btn span { flex: 1; text-align: left; font-variant-numeric: tabular-nums; }
  .seats-btn .chev { width: 16px; height: 16px; transition: transform .15s ease; }
  .seats-btn[aria-expanded=true] { border-color: rgba(230,183,90,.55); }
  .seats-btn[aria-expanded=true] .chev { transform: rotate(180deg); }
  .seats .dd-menu { top: 52px; min-width: 170px; }
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
  .opt b { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 600; color: var(--text); }
  .opt b svg.i { width: 17px; height: 17px; color: var(--muted); }
  .opt:has(input:checked) b svg.i { color: var(--accent); }
  /* Desplegables propios (Raza, Clase, Tono): un botón como los campos, con su chevron, y el menú de la aplicación.
     El select de verdad sigue debajo, oculto, con el valor. */
  .fsel { position: relative; }
  .fsel-btn { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; height: 46px; padding: 0 14px;
    border: 1px solid var(--line); border-radius: 12px; background: var(--control); color: var(--text); font-size: 15px; text-align: left; }
  .fsel-btn span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fsel-btn svg.i { width: 16px; height: 16px; flex: none; color: var(--muted); transition: transform .15s ease; }
  .fsel-btn[aria-expanded=true] { border-color: rgba(230,183,90,.55); }
  .fsel-btn[aria-expanded=true] svg.i { transform: rotate(180deg); }
  .fsel .dd-menu { top: 52px; left: 0; right: 0; min-width: 0; max-height: 300px; overflow-y: auto; }
  .sub.death { margin: 6px 0 4px; }
  .opt small { font-size: 12.5px; line-height: 1.4; color: var(--muted); }
  /* Tarjeta con portada: la imagen arriba, con el mismo margen que el texto y esquinas redondeadas, y debajo el
     título y dos líneas. */
  .opt.cover { padding-top: 14px; }
  .opt.cover .pic { display: block; height: 96px; margin: 0 0 8px; border-radius: 10px; background: #1b1712 center / cover no-repeat; }
  .opt.cover:not(:has(input:checked)) .pic { filter: saturate(.75) brightness(.85); }
  .opt:has(input:checked) { background: rgba(230,183,90,.08); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .opt:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  #world-opts, #hook-row { display: flex; flex-direction: column; gap: 10px; }
  #world-opts[hidden], #hook-row[hidden] { display: none; }
  .note { font-size: 13px; color: var(--muted); }
  .warn { color: #ffb38a; }
  .new-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 24px; border-top: 1px solid var(--sep); background: var(--panel); flex: none; }
  .new-foot .grow { flex: 1; min-width: 160px; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30; padding: 10px 16px; border-radius: 999px; background: var(--bubble); box-shadow: var(--shadow); color: #ff9d94; font-size: 14px; }
  #toast[hidden] { display: none; }
  /* Al entrar en una partida: fundido a negro. */
  body::after { content: ''; position: fixed; inset: 0; z-index: 200; background: #000; opacity: 0; pointer-events: none; transition: opacity .45s ease; }
  body.leaving::after { opacity: 1; pointer-events: auto; transition: opacity 1.8s ease 1.9s; }
  /* Al entrar en una partida, la madera se vuelve tecnología: encima del panel hay una copia con los mismos tablones
     y el mismo marco en versión tecnológica (public/menu-madera-tech.jpg, public/menu-marco-tech.png, misma geometría).
     Aparece subiendo su opacidad y luego se desvanece mientras toda la pantalla se funde a negro; después, la partida. */
  .tech { position: absolute; inset: 0; z-index: 4; pointer-events: none; opacity: 0; }
  .tech::before { content: ''; position: absolute; inset: calc(var(--frame) * .5);
    background: linear-gradient(180deg, rgba(8,10,12,.35), rgba(8,10,12,.5)), url(/assets/menu-madera-tech.jpg) center top / 760px auto repeat #141617; }
  .tech::after { content: ''; position: absolute; inset: 0; border: var(--frame) solid transparent;
    border-image: url(/assets/menu-marco-tech.png) 110 / var(--frame) round; filter: drop-shadow(0 0 10px rgba(99,209,255,.35)); }
  body.leaving .tech { animation: tech 3.7s ease-in-out forwards; }
  /* Lo de dentro del panel se va enseguida; la madera y el marco, cuando la versión tecnológica ya los tapa, para
     que al desvanecerse esta no asome nada debajo. */
  aside > .head, aside > .searchrow, aside > .scroll, aside > #fab { transition: opacity .6s ease; }
  body.leaving aside > .head, body.leaving aside > .searchrow, body.leaving aside > .scroll, body.leaving aside > #fab { opacity: 0; }
  body.leaving aside::before, body.leaving aside::after { opacity: 0; transition: opacity .3s linear 1.5s; }
  body.leaving main, body.leaving #status { opacity: 0; transition: opacity 2.2s ease; }
  @keyframes tech { 0% { opacity: 0; } 40% { opacity: 1; } 55% { opacity: 1; } 100% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { body.leaving .tech { animation: none; } }

  /* Escritorio: la imagen ocupa toda la pantalla y la tabla de partidas queda encima, con su sombra. */
  @media (min-width: 821px) {
    main { position: fixed; inset: 0; z-index: 0; }
    .hero .cap, .hero > .body, .hero > .intro { padding-left: 480px; }
    .hero::after { background: linear-gradient(90deg, rgba(11,13,12,.25) 0, rgba(11,13,12,.25) 440px, rgba(11,13,12,.82) 440px, rgba(11,13,12,.55) 760px, rgba(11,13,12,.1) 1000px, rgba(11,13,12,0) 1200px), linear-gradient(to top, rgba(11,13,12,.5), rgba(11,13,12,0) 35%); }
    aside { z-index: 2; }
    .search { background: rgba(255,255,255,.07); }
    .row { border-bottom-color: rgba(255,255,255,.07); }
    .row:hover { background: rgba(255,255,255,.06); }
    .row.on { background: rgba(255,255,255,.09); }
    .row .l2, .row .l1 time { color: #c9c3b9; }
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
    .char-row { grid-template-columns: minmax(0, 1fr) 46px; }
    .char-row > :nth-child(2), .char-row > :nth-child(3) { grid-column: 1 / -1; }
    .opt { min-height: 0; }
    .new-foot { padding: 10px 16px calc(14px + env(safe-area-inset-bottom)); }
    .new-foot .btn.primary { width: 100%; }
    .new-foot .btn.ghost { display: none; }
    .new-foot .grow:has(#new-error:empty) { display: none; }
    #open-new { display: none; }
    #status { top: auto; left: 16px; bottom: calc(28px + env(safe-area-inset-bottom)); }
    #fab { position: fixed; right: 16px; bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 10; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 18px 0 14px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-weight: 600; box-shadow: 0 8px 20px rgba(0,0,0,.5); }
    .scroll { padding-bottom: 96px; }
    #resume { position: relative; display: block; height: 190px; margin: 4px 12px 14px; border-radius: 18px; overflow: hidden; color: var(--text); text-decoration: none; box-shadow: 0 4px 14px rgba(0,0,0,.45); width: calc(100% - 24px); text-align: left; }
    #resume[hidden] { display: none; }
    #resume::after { content: ''; position: absolute; inset: 25% 0 0; background: linear-gradient(to top, rgba(11,13,12,.95), rgba(11,13,12,0)); }
    #resume .cap { position: absolute; left: 16px; right: 16px; bottom: 14px; z-index: 1; display: flex; flex-direction: column; gap: 4px; }
    #resume b { font: 800 20px/1.2 var(--display); letter-spacing: -.02em; }
    #resume .go { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: #d9d3c8; }
    #resume .go span:first-child { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #resume .go span:last-child { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px 0 14px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-size: 14px; font-weight: 600; }
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
  <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.2A5 5 0 0 1 21.5 19"/></symbol>
  <symbol id="i-chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></symbol>
  <symbol id="i-portrait" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="10" r="3.2"/><path d="M6.5 19a5.5 5.5 0 0 1 11 0"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/></symbol>
  <symbol id="i-offline" viewBox="0 0 24 24"><path d="M2 8.5a15 15 0 0 1 4.2-2.6M10 4.6A15 15 0 0 1 22 8.5"/><path d="M5 12a10 10 0 0 1 3.2-2M13.5 9.6A10 10 0 0 1 19 12"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/><path d="M3 3l18 18"/></symbol>
  <symbol id="i-rec" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></symbol>
  <symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></symbol>
  <symbol id="i-music-off" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/></symbol>
</svg>
<aside>
  <div class="tech" aria-hidden="true"></div>
  <div class="head">
    <span class="mark" aria-hidden="true"><img src="/assets/icono.jpg" alt=""></span>
    <h1><img class="logo" src="/assets/logo-tavernus.png" alt="Tavernus" width="111" height="24"></h1>
    <button id="music" class="btn ghost sm" type="button" aria-pressed="true" title="Música del menú" aria-label="Música del menú"><svg class="i"><use href="#i-music"/></svg></button>
  </div>
  <div class="searchrow">
    <label class="search"><svg class="i"><use href="#i-search"/></svg><span class="vh">Buscar partidas</span><input id="q" type="text" placeholder="Buscar partidas" autocomplete="off"></label>
    <button id="lists-btn" class="btn ghost sm" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="lists-menu" title="Ajustes: qué partidas ver" aria-label="Ajustes: qué partidas ver"><svg class="i"><use href="#i-gear"/></svg></button>
    <div id="lists-menu" class="filters menu" role="menu" aria-label="Qué partidas ver" hidden>
      <button type="button" role="menuitemradio" data-list="continue" class="on"><span>Partidas</span><span id="n-continue">0</span></button>
      <button type="button" role="menuitemradio" data-list="demos"><span>Demos</span><span id="n-demos">0</span></button>
      <button type="button" role="menuitemradio" data-list="recordings"><span>Grabaciones</span><span id="n-recordings">0</span></button>
    </div>
  </div>
  <div class="scroll">
    <button type="button" id="resume" class="art" hidden><span class="cap"><span class="eyebrow">Continúa tu historia</span><b id="resume-name"></b><span class="go"><span id="resume-meta"></span><span><svg class="i" style="width:14px;height:14px"><use href="#i-play"/></svg>Continuar</span></span></span></button>
    <div id="list"></div>
    <div class="new-wrap"><button id="open-new" class="btn primary sm" type="button"><svg class="i"><use href="#i-plus"/></svg>Nueva partida</button></div>
  </div>
  <button type="button" id="fab"><svg class="i"><use href="#i-plus"/></svg>Nueva partida</button>
</aside>
<div id="status" hidden></div>
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
        <div class="fld name-grid">
          <label class="lbl" for="g-name">Nombre de la partida</label>
          <span class="lbl" id="lbl-seats" title="Un enlace de invitación por plaza; luego puedes añadir más en «Invitaciones»">Invitados</span>
          <span></span>
          <input id="g-name" type="text" maxlength="60" placeholder="La noche del Brezal" required>
          <div class="seats">
            <input id="g-seats" type="hidden" value="0">
            <button id="seats-btn" class="seats-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="seats-menu" aria-labelledby="lbl-seats seats-n"><svg class="i" aria-hidden="true"><use href="#i-users"/></svg><span id="seats-n">0</span><svg class="i chev" aria-hidden="true"><use href="#i-chevron"/></svg></button>
            <div id="seats-menu" class="dd-menu" role="menu" aria-label="Invitados" hidden><button type="button" role="menuitemradio" data-seats="0" class="on" aria-checked="true"><span>Sin invitados</span></button><button type="button" role="menuitemradio" data-seats="1" aria-checked="false"><span>1 invitado</span></button><button type="button" role="menuitemradio" data-seats="2" aria-checked="false"><span>2 invitados</span></button><button type="button" role="menuitemradio" data-seats="3" aria-checked="false"><span>3 invitados</span></button><button type="button" role="menuitemradio" data-seats="4" aria-checked="false"><span>4 invitados</span></button><button type="button" role="menuitemradio" data-seats="5" aria-checked="false"><span>5 invitados</span></button><button type="button" role="menuitemradio" data-seats="6" aria-checked="false"><span>6 invitados</span></button><button type="button" role="menuitemradio" data-seats="7" aria-checked="false"><span>7 invitados</span></button></div>
          </div>
          <div class="popwrap">
            <button id="adv-btn" class="sq-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="adv-pop" title="Opciones avanzadas" aria-label="Opciones avanzadas"><svg class="i"><use href="#i-gear"/></svg></button>
            <div id="adv-pop" class="dd-menu pop" role="dialog" aria-label="Opciones avanzadas" hidden>
              <b>Opciones avanzadas</b>
              <label class="sub">Semilla de dados · vacía: al azar; al grabar se elige una sola<input id="g-seed" type="number" min="0" max="4294967295" step="1" placeholder="p. ej. 1234"></label>
            </div>
          </div>
        </div>
        <div class="fld">
          <span class="lbl">Tu personaje <span class="note">· opcional</span></span>
          <div class="char-row">
            <label class="sub">Nombre<input id="g-char" type="text" maxlength="24" placeholder="Aren"></label>
            <label class="sub">Raza<select id="g-race"></select></label>
            <label class="sub">Clase<select id="g-class"></select></label>
            <div class="sub"><span id="lbl-look">Aspecto</span>
              <div class="popwrap">
                <button id="look-btn" class="sq-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="look-pop" aria-labelledby="lbl-look" title="Cómo se ve tu personaje"><svg class="i"><use href="#i-portrait"/></svg></button>
                <div id="look-pop" class="dd-menu pop" role="dialog" aria-labelledby="look-title" hidden>
                  <b id="look-title">Cómo se ve</b>
                  <p class="note">Descríbelo en pocas palabras: pelo, cara, ropa, algún rasgo. De aquí sale su retrato; luego puedes pedir otro.</p>
                  <input id="g-look" type="text" maxlength="300" placeholder="Pelo cobrizo trenzado, cicatriz en la ceja, capa de lana verde">
                </div>
              </div>
            </div>
          </div>
          <div id="hook-row" hidden>
            <label class="sub">¿Qué le trae aquí? · si lo dejas vacío, el mundo se lo inventa<input id="g-hook" type="text" maxlength="400" placeholder="Busca a su hermano, que vino a este pueblo y no volvió"></label>
          </div>
        </div>
        <div class="fld" role="radiogroup" aria-labelledby="lbl-world">
          <span class="lbl" id="lbl-world">Mundo</span>
          <div class="grid2">
            <label class="opt cover"><input type="radio" name="world" value="demo" checked><span class="pic" style="background-image:url(/assets/mundo-brezal.jpg)"></span><b>Brezal (demo)</b><small>Descubre la aventura: la aldea del Brezal y su historia en tres actos.</small></label>
            <label class="opt cover"><input type="radio" name="world" value="generated"><span class="pic" style="background-image:url(/assets/mundo-generado.jpg)"></span><b>Mundo nuevo (generado)</b><small>Otro lugar, otra historia, y tu personaje con un porqué.</small></label>
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
            <label class="opt"><input type="radio" name="mode" value="live" checked><b><svg class="i"><use href="#i-spark"/></svg>Real</b><small>Claude narra cada acción. Gasta tokens.</small></label>
            <label class="opt"><input type="radio" name="mode" value="offline"><b><svg class="i"><use href="#i-offline"/></svg>Offline</b><small>Sin API: narración sencilla y gratis.</small></label>
            <label class="opt"><input type="radio" name="mode" value="record"><b><svg class="i"><use href="#i-rec"/></svg>Grabar demo</b><small>Real, y guarda cada respuesta para repetirla.</small></label>
          </div>
          <p id="key-warn" class="note warn" hidden>No hay ANTHROPIC_API_KEY: en real o grabando, el máster narrará en plano.</p>
        </div>
        <div class="fld">
          <div class="sub death" role="radiogroup" aria-labelledby="lbl-death"><span class="lbl" id="lbl-death">Muerte <span class="note">· nadie muere para siempre: elige cuánto cuesta volver</span></span>
            <div class="grid2">
              <label class="opt cover"><input type="radio" name="death" value="casual" checked><span class="pic" style="background-image:url(/assets/muerte-casual.jpg)"></span><b>Casual</b><small>Vuelve a las 2 h con lo suyo esperándole.</small></label>
              <label class="opt cover"><input type="radio" name="death" value="hardcore"><span class="pic" style="background-image:url(/assets/muerte-hardcore.jpg)"></span><b>Hardcore</b><small>Vuelve a los 30 min, sin nada y más débil.</small></label>
            </div>
          </div>
        </div>
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
  /** Entrar en una partida: la madera se vuelve tecnología y se funde a negro; luego, la página de la partida (que aparece desde negro). */
  function open(slug, character) {
    var url = '/?game=' + encodeURIComponent(slug) + (character ? '&character=' + encodeURIComponent(character) : '');
    if (document.body.classList.contains('leaving')) return;
    document.body.classList.add('leaving');
    if (window.menuMusicOut) window.menuMusicOut(3500);
    setTimeout(function () { location.href = url; }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3800);
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
  /** El tipo de máster como bolita de su color; el nombre, al pasar el ratón (y para lectores de pantalla). */
  function badge(g) {
    var b = el('span', 'badge dot ' + g.mode), t = (MODE[g.mode] || g.mode) + (g.main ? ' · principal' : '');
    b.setAttribute('data-tip', t); b.setAttribute('aria-label', 'Máster: ' + t); b.setAttribute('role', 'img');
    return b;
  }
  function when(g) { return g.last_opened_at ? 'Jugada ' + ago(g.last_opened_at) : 'Creada ' + ago(g.created_at) + ' · sin jugar'; }
  /**
   * La taberna es por ahora la imagen de todas las partidas. Se encuadra para que la casa quede en el centro del
   * hueco en cualquier pantalla: la imagen cubre el hueco (y, en las miniaturas, se acerca data-zoom veces) y se
   * desplaza en píxeles para llevar el centro de la casa hacia el centro, sin salirse de la imagen.
   */
  var ART = { w: 2560, h: 1440, x: 0.71, y: 0.45 };
  function art(node) {
    node.style.backgroundImage = 'url(/assets/taberna.jpg?v=3)';
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
    // Lo justo para cubrir el hueco (sin ampliar de más por centrar): la casa va tan cerca del centro como deje el borde.
    var k = Math.max(W / ART.w, H / ART.h) * zoom;
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
    // Partidas a las que te uniste con un enlace: solo se abren (las gestiona quien las creó).
    if (g.host === false) return [];
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
    return [invitesButton(g, cls), deleteButton(g, cls + ' danger')];
  }
  /** Asientos y enlaces de invitación de la partida (page-access.ts). */
  function invitesButton(g, cls) {
    return button('Invitaciones', cls, function () { location.href = '/invitaciones?game=' + encodeURIComponent(g.slug); });
  }

  /**
   * El aro de cada partida: un color de la paleta sacado de su nombre interno (siempre el mismo para la misma
   * partida); si dos de la lista coinciden, la segunda toma el siguiente libre, para que nunca se repitan.
   */
  var RINGS = ['#4fbf7a', '#63d1ff', '#e05a4a', '#b07cf0', '#f0a030', '#f06fa8', '#2fc8b8', '#a8d84a', '#6f8cff', '#ffffff'];
  function ringsFor(games) {
    var used = {}, out = {};
    games.forEach(function (g) {
      var h = 0;
      for (var i = 0; i < g.slug.length; i++) h = (h * 31 + g.slug.charCodeAt(i)) >>> 0;
      var k = h % RINGS.length, n = 0;
      while (used[k] && n++ < RINGS.length) k = (k + 1) % RINGS.length;
      used[k] = true; out[g.slug] = RINGS[k];
    });
    return out;
  }
  function row(g, ring) {
    var r = el('div', 'row' + (g.slug === selected ? ' on' : ''));
    r.setAttribute('role', 'button'); r.tabIndex = 0;
    r.setAttribute('aria-label', g.name + '. ' + when(g));
    var pic = el('span', 'pic art'); pic.setAttribute('data-zoom', '2.6'); if (ring) pic.style.setProperty('--ring', ring); r.appendChild(pic); art(pic);
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
    var eb = el('span', 'eyebrow', tab === 'continue' && !first ? 'Partida en curso' : EYEBROW[tab]);
    eb.appendChild(badge(g));
    cap.appendChild(eb);
    cap.appendChild(el('h2', '', g.name));
    var chips = el('div', 'chips');
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
    document.querySelectorAll('.filters [data-list]').forEach(function (b) { var on = b.getAttribute('data-list') === tab; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    if (!games.some(function (g) { return g.slug === selected; })) selected = games[0] ? games[0].slug : null;
    if (!games.length) box.appendChild(el('p', 'empty', query ? 'Ninguna partida coincide.' : EMPTY[tab]));
    var rings = ringsFor(games);
    games.forEach(function (g) { box.appendChild(row(g, rings[g.slug])); });
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
  /** Ventanitas sin velo (Aspecto, Opciones avanzadas): se abren con su botón y se cierran al pulsar fuera o con Esc. */
  function popover(btnId, popId, focusId) {
    var btn = $(btnId), pop = $(popId);
    function show(open) { pop.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open && focusId) $(focusId).focus(); }
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); show(pop.hidden); });
    pop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    pop.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' || (ev.key === 'Enter' && ev.target.tagName === 'INPUT')) { ev.preventDefault(); ev.stopPropagation(); show(false); btn.focus(); } });
    document.addEventListener('click', function () { if (!pop.hidden) show(false); });
  }
  popover('look-btn', 'look-pop', 'g-look');
  popover('adv-btn', 'adv-pop', 'g-seed');
  $('g-look').addEventListener('input', function () { $('look-btn').classList.toggle('set', !!$('g-look').value.trim()); });
  $('g-seed').addEventListener('input', function () { $('adv-btn').classList.toggle('set', !!$('g-seed').value.trim()); });
  /** Cambia un select por el desplegable de la aplicación; el select sigue con el valor (y avisa con «change»). */
  function fancySelect(sel) {
    var wrap = el('div', 'fsel'); sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    sel.hidden = true;
    var btn = el('button', 'fsel-btn'); btn.type = 'button'; btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    var lab = sel.closest('label'); if (lab && lab.firstChild && lab.firstChild.nodeType === 3) btn.setAttribute('aria-label', lab.firstChild.textContent.trim());
    btn.innerHTML = '<span></span>' + icon('i-chevron');
    var menu = el('div', 'dd-menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
    wrap.appendChild(btn); wrap.appendChild(menu);
    function paint() { var o = sel.options[sel.selectedIndex]; btn.firstChild.textContent = o ? o.text : ''; }
    function show(open) {
      if (open) {
        menu.innerHTML = '';
        Array.prototype.forEach.call(sel.options, function (o, i) {
          var b = el('button', i === sel.selectedIndex ? 'on' : ''); b.type = 'button'; b.setAttribute('role', 'menuitemradio');
          b.setAttribute('aria-checked', i === sel.selectedIndex ? 'true' : 'false'); b.appendChild(el('span', '', o.text));
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
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      if (ev.key === 'Escape') { ev.stopPropagation(); show(false); btn.focus(); }
    });
    document.addEventListener('click', function () { if (!menu.hidden) show(false); });
    sel.addEventListener('change', paint);
    new MutationObserver(paint).observe(sel, { childList: true });
    paint();
  }
  ['g-race', 'g-class', 'g-tone'].forEach(function (id) { fancySelect($(id)); });
  function seatsMenu(open) {
    $('seats-menu').hidden = !open;
    $('seats-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var on = $('seats-menu').querySelector('.on'); if (on) on.focus(); }
  }
  $('seats-btn').addEventListener('click', function (ev) { ev.stopPropagation(); seatsMenu($('seats-menu').hidden); });
  $('seats-menu').querySelectorAll('[data-seats]').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var n = b.getAttribute('data-seats');
      $('g-seats').value = n; $('seats-n').textContent = n;
      $('seats-menu').querySelectorAll('[data-seats]').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
      seatsMenu(false); $('seats-btn').focus();
    });
  });
  $('seats-menu').addEventListener('keydown', function (ev) {
    var items = Array.prototype.slice.call($('seats-menu').querySelectorAll('[data-seats]')), i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    if (ev.key === 'Escape') { ev.stopPropagation(); seatsMenu(false); $('seats-btn').focus(); }
  });
  document.addEventListener('click', function (ev) { if (!$('seats-menu').hidden && !$('seats-menu').contains(ev.target)) seatsMenu(false); });
  function listsMenu(open) {
    $('lists-menu').hidden = !open;
    $('lists-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $('lists-btn').addEventListener('click', function (ev) { ev.stopPropagation(); listsMenu($('lists-menu').hidden); });
  document.addEventListener('click', function (ev) { if (!$('lists-menu').hidden && !$('lists-menu').contains(ev.target)) listsMenu(false); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('lists-menu').hidden) { listsMenu(false); $('lists-btn').focus(); } });
  document.querySelectorAll('.filters [data-list]').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-list'); selected = null; listsMenu(false); render(); }); });
  $('q').addEventListener('input', function () { query = $('q').value; render(); });

  function load() {
    return fetch('/api/games').then(function (r) { return r.json(); }).then(function (d) {
      apiKey = d.api_key;
      var st = $('status');
      st.hidden = false;
      st.textContent = apiKey ? 'Claude disponible' : 'Solo offline';
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

  // El formulario y su velo cuelgan del body, no de <main>: así el velo oscurece también el panel lateral y el
  // formulario queda en el centro de la pantalla, por encima de todo.
  document.body.appendChild($('new-scrim')); document.body.appendChild($('new'));
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
    var body = { name: $('g-name').value, mode: mode(), character: $('g-char').value, race: $('g-race').value, class: $('g-class').value, appearance: $('g-look').value, death_mode: (document.querySelector('input[name=death]:checked') || { value: 'casual' }).value, dice_seed: $('g-seed').value, seats: Math.max(0, Math.min(7, parseInt($('g-seats').value, 10) || 0)) };
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

  // Música del menú (public/music/menu-instrumental.mp3): en bucle y baja. El navegador no deja sonar nada antes
  // de que la persona toque la página, así que, si no puede empezar sola, empieza al primer clic o tecla.
  // El botón la silencia y se recuerda en este navegador.
  (function () {
    var KEY = 'tavernus.menuMusic';
    var btn = $('music');
    var on = true;
    try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}
    var audio = new Audio('/music/menu-instrumental.mp3');
    audio.loop = true; audio.preload = 'auto'; audio.volume = 0;
    var fade = null;
    function ramp(to, ms, then) {
      clearInterval(fade);
      var from = audio.volume, t0 = Date.now();
      fade = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / ms);
        audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
        if (k >= 1) { clearInterval(fade); if (then) then(); }
      }, 50);
    }
    function play() {
      if (!on || !audio.paused) return;
      var p = audio.play();
      if (p && p.then) p.then(function () { ramp(0.35, 2500); }, function () {});
      else ramp(0.35, 2500);
    }
    function paint() {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.querySelector('use').setAttribute('href', on ? '#i-music' : '#i-music-off');
      btn.title = on ? 'Silenciar la música' : 'Poner la música';
    }
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      on = !on;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
      paint();
      if (on) play(); else ramp(0, 400, function () { audio.pause(); });
    });
    // Al entrar en una partida: la música se desvanece con la transición y, si sonaba, la partida arranca la suya.
    window.menuMusicOut = function (ms) {
      try { if (on) sessionStorage.setItem('tavernus.introMusic', '1'); } catch (e) {}
      if (!audio.paused) ramp(0, ms, function () { audio.pause(); });
    };
    function firstTouch() {
      document.removeEventListener('pointerdown', firstTouch, true);
      document.removeEventListener('keydown', firstTouch, true);
      play();
    }
    document.addEventListener('pointerdown', firstTouch, true);
    document.addEventListener('keydown', firstTouch, true);
    paint();
    play();
  })();

  load();
})();
</script>
</body>
</html>
`;
