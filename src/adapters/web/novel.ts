/**
 * El hilo de la partida como un chat (page.ts): cada mensaje es una burbuja con el
 * avatar de quien habla. A la izquierda el narrador (un «ente» con su retrato) y
 * los NPCs; a la derecha el propio PJ, con su color. No hay burbujas de «prompt»:
 * lo que escribe el jugador sale como lo que su PJ dice (los parlamentos `lines`
 * del cierre) o, si no habla, como lo que hace. Mensajes seguidos de quien sea
 * se agrupan como en un móvil (avatar y nombre solo en el primero).
 *
 * Los momentos ilustrados (retrato del primer encuentro, objeto, combate,
 * descubrimiento) y la escena de cada sitio son mensajes del narrador con imagen,
 * en su sitio del hilo.
 *
 * NOVEL_STYLE va dentro del <style> de la página y NOVEL_JS dentro de su script:
 * usa lo de ese ámbito (log, format, initial, scroll, openLightbox, act, roll,
 * spendButtons, add). Las sesiones de voz se enganchan a `.msg.master` y su `.who`.
 */

import { proseWithout, type DialogueLine } from '../../engine/moments.js';

/** El jugador contado en estilo indirecto («Preguntas a la posadera por…»): sobra si su frase ya va como burbuja. */
const ACTOR_REPORTED = /^(?:le\s+|les\s+)?(?:preguntas|dices|respondes|contestas|comentas|cuentas|explicas|pides|saludas|replicas|insistes|murmuras|susurras|añades|propones|ofreces|gritas)\b/i;
/** Un personaje contado en estilo indirecto («Marisa te explica que…»): el contenido ya está en su burbuja. */
const REPORTED = /\b(?:dice|responde|contesta|explica|cuenta|asegura|murmura|susurra|advierte|añade|insiste|aclara|admite|reconoce|confiesa|replica|pregunta|comenta)\s+(?:que|si|por|cómo|qué|quién|dónde|cuándo)\b/i;

/** Términos con contenido (4+ letras, sin tildes), recortados a 5 letras para que «rellena» y «rellenas» casen. */
function terms(s: string): string[] {
  return (s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-zñ]{4,}/g) ?? []).map((t) => t.slice(0, 5));
}

/** ¿Este trozo repite lo que dice alguna línea? Al menos la mitad de sus términos (y 2 o más) están en una misma línea. */
function echoes(clause: string, lines: readonly DialogueLine[]): boolean {
  const own = [...new Set(terms(clause))];
  if (own.length < 2) return false;
  return lines.some((l) => {
    const said = new Set(terms(l.text));
    const hit = own.filter((t) => said.has(t)).length;
    return hit >= 2 && hit / own.length >= 0.5;
  });
}

/**
 * Prosa del narrador para el hilo: solo lo no verbal. Quita las citas literales de
 * `lines` (proseWithout) y, frase a frase (y por cláusulas tras «:» o «;»), lo que
 * repite un parlamento: estilo indirecto del jugador si su frase va aparte
 * («Preguntas a…», «Le dices…»), estilo indirecto de un personaje («te explica
 * que…») y lo que se solapa en palabras con alguna línea. Puede quedar vacía:
 * entonces no se pinta burbuja del narrador.
 */
export function cleanProse(narration: string, lines: readonly DialogueLine[]): string {
  const base = proseWithout(narration, lines);
  if (!lines.length) return base;
  const actorSpeaks = lines.some((l) => l.speaker === 'actor');
  /** Lo que queda de una cláusula: entera, recortada antes del verbo de habla, o nada. */
  const keep = (clause: string): string => {
    let t = clause.trim();
    if (!t) return '';
    if (actorSpeaks && ACTOR_REPORTED.test(t)) return '';
    const r = REPORTED.exec(t);
    if (r) {
      // «Brenna llega por detrás, secándose las manos, y le explica que…»: se queda el gesto.
      const before = t.slice(0, r.index).replace(/(?:,\s*)?(?:\by\s+)?(?:\b(?:te|le|les|nos|se)\s+)?$/i, '').replace(/[,\s]+$/, '');
      if (before.split(/\s+/).length < 3) return '';
      t = before;
    }
    return echoes(t, lines) ? '' : t;
  };
  return base.split('\n').map((para) => {
    const sentences = para.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [];
    return sentences.map((s) => {
      const parts = s.split(/\s*[:;]\s*|\s+—\s+/);
      const kept = parts.map(keep);
      if (kept.every((k, i) => k === parts[i]!.trim())) return s.trim();
      const text = kept.filter(Boolean).join(', ').trim().replace(/[,\s]+$/, '');
      if (!text) return '';
      return /[.!?…]$/.test(text) ? text : `${text}.`;
    }).filter(Boolean).join(' ');
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Un trozo del turno en el orden en que pasa: narración o un parlamento (índice en `lines`; `text` si es solo un trozo de la línea).
 * `lead`: la narración presenta el parlamento que sigue («Adiel deja la jarra y se vuelve hacia ti:») y se pinta pegada a él.
 */
export type NovelBlock = { kind: 'prose'; text: string; lead?: true } | { kind: 'line'; line: number; text?: string };

/** Una cita tal como aparece en la narración: dónde empieza y acaba y qué dice. */
interface QuoteSpan { start: number; end: number; text: string }

const SPEECH_VERB = /^(?:dice|dijo|responde|respondió|contesta|contestó|murmura|murmuró|susurra|susurró|añade|añadió|pregunta|preguntó|replica|replicó|insiste|insistió|explica|explicó|comenta|comentó|grita|gritó|suelta|soltó|sigue|siguió|repite|repitió|advierte|advirtió|admite|admitió|concede|concedió)\b/i;

/**
 * Citas de la narración, en orden: «…», “…”, "…" y rayas de diálogo. En una
 * tira de rayas («—Me quemé —dice, y vuelve al trapo—. Como todo el mundo.»)
 * los trozos que empiezan por un verbo de habla son acotación (prosa) y el
 * resto es parlamento.
 */
function quoteSpans(narration: string): QuoteSpan[] {
  const out: QuoteSpan[] = [];
  const re = /[«“]\s*([^»”]+?)\s*[»”]|"([^"\n]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(narration))) {
    const text = (m[1] ?? m[2] ?? '').trim();
    if (text) out.push({ start: m.index, end: m.index + m[0].length, text });
  }
  let base = 0;
  for (const para of narration.split('\n')) {
    const first = para.search(/(?:^|[.!?…]\s+)—/);
    if (first >= 0) {
      const dashAt = para.indexOf('—', first);
      const parts = para.slice(dashAt).split('—');
      let pos = dashAt;
      for (let i = 1; i < parts.length; i++) {
        pos += 1; // la raya
        const raw = parts[i]!;
        const text = raw.trim().replace(/^[.,;:]+\s*/, '').trim();
        if (text && !SPEECH_VERB.test(text)) {
          const s = base + pos + (raw.length - raw.replace(/^[\s.,;:]+/, '').length);
          if (!out.some((q) => s >= q.start && s < q.end)) out.push({ start: s, end: base + pos + raw.trimEnd().length, text });
        }
        pos += raw.length;
      }
    }
    base += para.length + 1;
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Cuánto de la cita está dicho en la línea (0-1): proporción de sus términos. */
function overlap(span: string, line: string): number {
  const own = [...new Set(terms(span))];
  if (!own.length) return 0;
  const said = new Set(terms(line));
  return own.filter((t) => said.has(t)).length / own.length;
}

/** Prosa sin comillas huérfanas ni rayas sueltas. */
function stripQuoteMarks(text: string): string {
  return text.replace(/[«»“”"]/g, '').replace(/^\s*—\s*/, '').replace(/\s*—\s*([.,;:!?])/g, '$1').replace(/\s*—\s*$/, '').replace(/(^|\s)—(\s|$)/g, '$1$2').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

/**
 * El turno en orden, a partir de las citas que el máster escribe en la narración.
 * Cada cita se atribuye a la línea de `lines` que más la contiene (sirve aunque
 * un personaje diga su frase en dos trozos); si ninguna línea casa, va a la
 * última persona que habló. La prosa entre citas pasa por cleanProse. Las
 * líneas que no aparecen citadas: las del jugador delante, el resto al final.
 * La prosa vacía entre dos parlamentos no genera bloque. La prosa que termina en
 * dos puntos justo antes de lo que dice un personaje lo presenta (`lead`).
 */
export function novelBlocks(narration: string, lines: readonly DialogueLine[]): NovelBlock[] {
  const out: NovelBlock[] = [];
  const placed = new Set<number>();
  const prose = (segment: string) => {
    const t = stripQuoteMarks(cleanProse(segment, lines));
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev?.kind === 'prose') prev.text = `${prev.text} ${t}`;
    else out.push({ kind: 'prose', text: t });
  };
  const spans = lines.length ? quoteSpans(narration) : [];
  /** Qué líneas aparecen citadas (al menos en parte) en algún sitio de la narración. */
  const cited = lines.map((l) => spans.some((q) => overlap(q.text, l.text) >= 0.6));
  let cursor = 0;
  let lastSpeaker = -1;
  for (const q of spans) {
    if (q.start < cursor) continue;
    let best = -1, score = 0;
    lines.forEach((l, i) => { const o = overlap(q.text, l.text); if (o > score) { best = i; score = o; } });
    if (score < 0.6) {
      const npcOnly = lines.map((l, i) => (l.speaker === 'npc' ? i : -1)).filter((i) => i >= 0);
      best = lastSpeaker >= 0 ? lastSpeaker : npcOnly.length === 1 ? npcOnly[0]! : -1;
    }
    if (best < 0) continue; // nadie a quien atribuirlo: se queda en la prosa
    prose(narration.slice(cursor, q.start));
    const whole = overlap(lines[best]!.text, q.text) >= 0.95;
    out.push(whole ? { kind: 'line', line: best } : { kind: 'line', line: best, text: q.text });
    placed.add(best);
    lastSpeaker = best;
    cursor = q.end;
    // Las líneas siguientes que no aparecen citadas en ningún sitio van pegadas a esta.
    for (let j = best + 1; j < lines.length && !placed.has(j) && !cited[j] && lines[j]!.speaker !== 'actor'; j++) {
      out.push({ kind: 'line', line: j });
      placed.add(j);
      lastSpeaker = j;
    }
  }
  prose(narration.slice(cursor));
  const missing = lines.map((_, i) => i).filter((i) => !placed.has(i));
  const front = missing.filter((i) => lines[i]!.speaker === 'actor').map((i): NovelBlock => ({ kind: 'line', line: i }));
  const back = missing.filter((i) => lines[i]!.speaker !== 'actor').map((i): NovelBlock => ({ kind: 'line', line: i }));
  const all = [...front, ...out, ...back];
  all.forEach((b, i) => {
    const next = all[i + 1];
    if (b.kind === 'prose' && /:$/.test(b.text) && next?.kind === 'line' && lines[next.line]?.speaker !== 'actor') b.lead = true;
  });
  return all;
}

/**
 * Lo que lee el narrador de voz: los bloques tal como se pintan, con cada parlamento entre «». Lo que dice el propio
 * jugador no se lee: ya lo ha escrito él. Con `others`, las líneas del actor son de otro jugador y sí se leen.
 */
export function blocksSpeech(blocks: readonly NovelBlock[], lines: readonly DialogueLine[], others = false): string {
  return blocks
    .filter((b) => b.kind === 'prose' || others || lines[b.line]?.speaker !== 'actor')
    .map((b) => (b.kind === 'prose' ? b.text : `«${b.text ?? lines[b.line]!.text}»`)).join(' ');
}

export const NOVEL_STYLE = String.raw`
  /* Hilo tipo chat: avatar + burbuja; el PJ a la derecha. */
  #log { gap: 4px; }
  .msg.row { display: flex; align-items: flex-start; gap: 8px; max-width: min(640px, 100%); margin-top: 10px; }
  .msg.row.cont { margin-top: 0; }
  .msg.row.mine { align-self: flex-end; flex-direction: row-reverse; }
  .msg.row > .col { min-width: 0; display: flex; flex-direction: column; }
  .msg.row.mine > .col { align-items: flex-end; }
  .msg.row .body { position: relative; padding: 7px 12px 8px; border-radius: 18px; line-height: 1.47; }
  .msg.row:not(.cont):not(.mine) .body { border-top-left-radius: 5px; }
  .msg.row.mine:not(.cont) .body { border-top-right-radius: 5px; }
  .msg.row.master .body, .msg.row.npc .body { background: var(--control); color: var(--text); font: inherit; letter-spacing: inherit; }
  .msg.row.mine .body { background: var(--accent); color: var(--accent-ink); box-shadow: 0 8px 24px rgba(233,169,78,.16), inset 0 1px 1px rgba(255,255,255,.25); }
  .msg.row.mine.act .body { font-style: italic; }
  /* La frase del narrador que presenta a quien habla, dentro de su misma burbuja. */
  .msg.row .lead { margin: 0 0 3px; font-style: italic; color: var(--muted); }
  .msg.row.pending { opacity: .55; }
  /* «Escribiendo…»: la burbuja del máster con tres puntos mientras se espera la respuesta, como en los chats. */
  .msg.held { display: none !important; }
  .msg.row.typing .who { display: none; }
  .msg.row.typing .body { display: flex; align-items: center; gap: 5px; height: 34px; padding: 0 14px; }
  .msg.row.typing .body i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); animation: nv-typing 1s ease-in-out infinite; }
  .msg.row.typing .body i:nth-child(2) { animation-delay: .15s; }
  .msg.row.typing .body i:nth-child(3) { animation-delay: .3s; }
  @keyframes nv-typing { 0%, 60%, 100% { opacity: .35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-4px); } }
  @media (prefers-reduced-motion: reduce) { .msg.row.typing .body i { animation: none; opacity: .7; } }
  .msg.row .who { display: flex; align-items: center; gap: 6px; margin: 0 0 2px; font-size: 12.5px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--accent); }
  .msg.row.npc .who { color: var(--npc, #e6a587); }
  .msg.row.cont .who .nm { display: none; }
  .msg.row.cont .who:not(:has(.tts-say)) { display: none; }
  /* Mensaje de otro jugador al que se puede responder: la flechita (⌄) en la esquina, al pasar el ratón o con el menú abierto. */
  .msg.row.replyable .body { transition: transform .15s ease; }
  #log:has(.msg.row.swiping) { overflow-x: hidden; }
  .msg.row.replyable.swiping .body { transition: none; }
  .msg-more { position: absolute; top: 3px; right: 4px; display: grid; place-items: center; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 0 14px 0 10px;
    background: radial-gradient(ellipse at 70% 30%, var(--control) 55%, transparent 80%); color: var(--muted); opacity: 0; transition: opacity .12s ease; cursor: pointer; }
  .msg-more svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .msg-more:hover { color: var(--text); }
  .msg.row.replyable:hover .msg-more, .msg.row.replyable.menu-open .msg-more, .msg-more:focus-visible { opacity: 1; }
  #msg-menu { position: fixed; z-index: 60; min-width: 190px; padding: 6px; border-radius: 14px; background: var(--bubble, #232526); border: 1px solid var(--line); box-shadow: var(--window-shadow, 0 12px 32px rgba(0,0,0,.5)); }
  #msg-menu[hidden] { display: none; }
  #msg-menu button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 40px; padding: 6px 12px; border: 0; border-radius: 10px; background: transparent; color: var(--text); font: 500 14px/1.2 var(--sans); text-align: left; }
  #msg-menu button:hover, #msg-menu button:focus-visible { background: var(--hover); outline: none; }
  #msg-menu svg { width: 18px; height: 18px; flex: none; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  #msg-menu [data-do="reply"] svg { stroke: var(--accent); }
  /* En táctil: el gesto horizontal es nuestro (deslizar para responder) y la pulsación larga no selecciona texto. */
  @media (hover: none) {
    .msg.row.replyable .body { touch-action: pan-y; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  }
  .msg.row.replyable.swipe-ok .body { box-shadow: -3px 0 0 var(--accent); }
  .msg.row .decisive { align-self: flex-start; }
  .msg.row .actions { margin-top: 8px; }
  .nv-av { position: relative; width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 50%; overflow: hidden; font-size: 13px; font-weight: 600;
    color: var(--npc, #e6a587); background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1.5px currentColor; }
  .msg.row.cont .nv-av { visibility: hidden; height: 0; }
  .msg.row.master .nv-av { color: var(--accent); background: radial-gradient(circle at 50% 40%, rgba(247,201,121,.35), rgba(233,169,78,.08) 70%); }
  .msg.row.mine .nv-av { color: var(--accent); background: var(--accent-tint); }
  .nv-av svg { width: 16px; height: 16px; }
  .nv-av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .6s; }
  .nv-av img.on { opacity: 1; }
  /* Avisos fuera de la ficción (tiradas, progreso, consultas): centrados, discretos. */
  .msg.system { align-self: center; max-width: min(560px, 100%); margin: 8px 0 2px; }
  .overheard { align-self: flex-start; margin: 10px 0 -4px 42px; font-size: 12px; font-style: italic; color: var(--muted); }
  .msg.system .body { padding: 8px 12px; border-radius: 14px; font-size: 12.5px; }
  /* Imágenes del narrador (escena, retrato, objeto…): bajo su avatar, como una foto en el chat. */
  .msg.scene, .msg.moment { margin: 4px 0 0 42px; animation: nv-in .5s ease-out; }
  .msg.scene { width: min(560px, calc(100% - 42px)); }
  /* La vista del sitio dentro de la burbuja del narrador que cuenta la llegada, como una foto en un mensaje. */
  /* Con foto: el mismo margen arriba que a los lados (4 px) y un clic en la foto la amplía. */
  .msg.row.has-place .body { width: min(520px, 100%); padding-top: 4px; }
  .place-shot { position: relative; display: block; width: calc(100% + 16px); margin: 0 -8px 8px; padding: 0; border: 0; border-radius: 14px; overflow: hidden;
    aspect-ratio: 16 / 9; background: var(--platter); cursor: zoom-in; }
  .place-shot img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .5s; }
  .place-shot.ready img { opacity: 1; }
  @keyframes nv-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .moment .shot { position: relative; display: block; width: 220px; aspect-ratio: 4 / 5; padding: 0; border: 0; border-radius: 18px; overflow: hidden; background: var(--platter); cursor: zoom-in; box-shadow: var(--control-shadow); }
  .moment.item .shot { width: 200px; aspect-ratio: 1; }
  .moment.combat, .moment.discovery { width: min(560px, calc(100% - 42px)); }
  .moment.combat .shot, .moment.discovery .shot { width: 100%; aspect-ratio: 16 / 9; }
  .moment img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .7s; }
  .moment.ready img { opacity: 1; }
  .moment .shot::after { content: ''; position: absolute; inset: 55% 0 0; background: linear-gradient(transparent, rgba(0,0,0,.65)); pointer-events: none; }
  .moment figcaption { position: absolute; left: 14px; right: 14px; bottom: 12px; z-index: 1; text-align: left; }
  .moment figcaption b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .moment figcaption span { font-size: 12px; font-weight: 500; color: var(--muted); }
  #log > .actions { margin: 6px 0 0 42px; }
  /* Prólogo y «Donde lo dejamos»: página de libro, centrada, con título de capítulo. */
  .msg.chapter { position: relative; align-self: center; width: min(600px, 100%); margin: 18px 0 14px; padding: 22px 28px 14px; border-radius: 8px;
    background: linear-gradient(180deg, rgba(247,231,201,.07), rgba(247,231,201,.025)); box-shadow: inset 0 0 0 1px rgba(233,169,78,.18); animation: nv-in .6s ease-out; }
  .msg.chapter .who { display: flex; justify-content: center; font: 600 11px/1 var(--sans); letter-spacing: .22em; text-transform: uppercase; color: var(--muted); }
  .msg.chapter .who .tts-say { position: absolute; top: 14px; right: 14px; margin: 0; }
  .msg.chapter h2 { margin: 10px 0 16px; text-align: center; font: 500 22px/1.25 Georgia, 'Iowan Old Style', 'Palatino Linotype', serif; letter-spacing: .01em; color: var(--accent); }
  .msg.chapter h2::after { content: ''; display: block; width: 44px; height: 1px; margin: 14px auto 0; background: currentColor; opacity: .45; }
  .msg.chapter .body { font: 16px/1.65 Georgia, 'Iowan Old Style', 'Palatino Linotype', serif; color: var(--text); text-align: justify; hyphens: auto; }
  .msg.chapter .body p { margin: 0 0 .8em; text-indent: 1.4em; }
  .msg.chapter .body p:first-child, .msg.chapter.recap .body p { text-indent: 0; }
  .msg.chapter.prologue .body p:first-child::first-letter { float: left; font-size: 3.2em; line-height: .86; padding: 5px 8px 0 0; color: var(--accent); }
  .msg.chapter.recap .body strong { font-weight: 600; color: var(--accent); }
  #journal .en.chapter > span:last-child { font-family: Georgia, 'Iowan Old Style', serif; font-style: italic; color: var(--accent); }
  @media (max-width: 820px) { .msg.chapter { padding: 18px 18px 10px; } .msg.chapter .body { font-size: 15px; text-align: left; } }
  @media (max-width: 820px) {
    .msg.row { max-width: 100%; }
    .nv-av { width: 30px; height: 30px; }
    .msg.scene, .msg.moment, #log > .actions { margin-left: 38px; }
    .moment .shot { width: 180px; } .moment.item .shot { width: 160px; }
  }
`;

export const NOVEL_JS = String.raw`
  // --- Hilo tipo chat ------------------------------------------------------------
  /** Quién habla: el narrador y el propio PJ (llega con «cast» al conectar). */
  var cast = { master: { id: 'master', name: 'El Narrador', avatar: null }, me: { id: '', name: '', avatar: null } };
  /** Retratos ya hechos por id (NPC, PJ o «master»); llegan en los mensajes y por el evento «portrait». */
  var portraits = {};
  var MOMENT_LABEL = { portrait: 'Retrato', item: 'Objeto', combat: 'Combate', discovery: 'Descubrimiento', manual: 'Momento' };
  var NPC_COLORS = ['#e6a587', '#8fc7a0', '#9bb8ef', '#d7a6e3', '#e3c27a', '#7fd0d0', '#ef9a9a'];
  function npcColor(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return NPC_COLORS[h % NPC_COLORS.length]; }

  function putPortrait(span, src) {
    var old = span.querySelector('img');
    if (old && old.getAttribute('src') === src) return;
    var img = document.createElement('img');
    img.alt = '';
    img.addEventListener('load', function () { img.classList.add('on'); if (old) old.remove(); });
    img.addEventListener('error', function () { img.remove(); });
    img.src = src;
    span.appendChild(img);
  }
  function avatarOf(who) {
    var span = document.createElement('span');
    span.className = 'nv-av';
    span.setAttribute('data-portrait', who.id);
    span.setAttribute('aria-hidden', 'true');
    if (who.id === 'master') span.innerHTML = '<svg class="i"><use href="#i-spark"/></svg>';
    else span.textContent = initial(who.name || '?');
    var src = who.avatar || portraits[who.id];
    if (src) putPortrait(span, src);
    return span;
  }

  /**
   * Una burbuja del hilo. kind: master | npc | mine. Si el mensaje anterior es de la
   * misma persona, se agrupa (sin repetir avatar ni nombre).
   */
  function chatRow(kind, who, html, extra) {
    var div = document.createElement('div');
    div.className = 'msg row ' + kind + (extra && extra.act ? ' act' : '') + (extra && extra.pending ? ' pending' : '');
    var key = kind + ':' + who.id;
    var prev = log.lastElementChild;
    if (prev && prev.getAttribute('data-who') === key) div.classList.add('cont');
    div.setAttribute('data-who', key);
    if (kind === 'npc') div.style.setProperty('--npc', npcColor(who.id));
    div.appendChild(avatarOf(who));
    var col = document.createElement('div');
    col.className = 'col';
    var body = document.createElement('div');
    body.className = 'body';
    if (kind !== 'mine') {
      var w = document.createElement('div');
      w.className = 'who';
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = who.name;
      w.appendChild(nm);
      body.appendChild(w);
    }
    body.insertAdjacentHTML('beforeend', html);
    col.appendChild(body);
    div.appendChild(col);
    log.appendChild(div);
    return div;
  }
  function meWho() { return { id: cast.me.id || current, name: cast.me.name || '', avatar: cast.me.avatar }; }
  /** Lo que escribe el jugador, mientras el narrador piensa: se sustituye por lo que su PJ dice o hace. */
  function pendingMine(text) { chatRow('mine', meWho(), format(text), { act: true, pending: true }); scroll(); }
  function clearPending() { log.querySelectorAll('.msg.row.pending').forEach(function (d) { d.remove(); }); }
  /**
   * «Escribiendo…»: antes de cada burbuja que no es del jugador (narrador o personaje) se ven sus tres puntos, con
   * su avatar, como en los chats. La primera respuesta del turno, al menos TYPING_MS (dos vueltas de la animación),
   * contando los puntos del narrador que ya se veían mientras se esperaba; las siguientes, entre 1,5 y 2 s según lo
   * largas que sean. Los mensajes del stream y el fin de la espera pasan por la misma cola, en orden (inChat, afterChat).
   */
  var TYPING_MS = 2000, typingSince = 0, chatQueue = Promise.resolve(), turnShown = false;
  /** Los puntos del narrador al final del hilo (on) o fuera (off): mientras se espera la respuesta. */
  function typing(on) {
    log.querySelectorAll('.msg.row.typing').forEach(function (d) { d.remove(); });
    typingSince = on ? Date.now() : 0;
    if (!on) return;
    var row = chatRow('master', cast.master, '<i></i><i></i><i></i>');
    typingRow(row, cast.master && cast.master.name || 'El narrador');
    scroll();
  }
  function typingRow(row, name) {
    row.classList.add('typing');
    row.setAttribute('role', 'status');
    row.setAttribute('aria-label', name + ' está escribiendo');
  }
  /** Los puntos de quien habla en esa burbuja: la misma fila, con su avatar, y los puntos en vez del texto. */
  function typingLike(row) {
    var t = row.cloneNode(true);
    t.classList.remove('held');
    t.removeAttribute('data-seq');
    var col = t.querySelector('.col');
    if (col) col.innerHTML = '<div class="body"><i></i><i></i><i></i></div>';
    var nm = row.querySelector('.who .nm');
    typingRow(t, nm ? nm.textContent : 'Alguien');
    log.appendChild(t);
    scroll();
    return t;
  }
  function typingMs(row) {
    var n = ((row.querySelector('.body') || row).textContent || '').length;
    return Math.max(1500, Math.min(2000, 1200 + n * 4));
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms)); }); }
  /**
   * Enseña lo nuevo del turno (lo que no estaba en «old») poco a poco: lo del jugador y lo que no es una burbuja,
   * enseguida; cada burbuja de otro, tras sus puntos. La voz empieza con la primera burbuja.
   */
  function revealTurn(old) {
    var els = [].filter.call(log.children, function (e) { return !old.has(e) && !e.classList.contains('typing'); });
    els.forEach(function (x) { x.classList.add('held'); });
    var first = true;
    return els.reduce(function (p, x) {
      return p.then(function () {
        if (!x.classList.contains('row') || x.classList.contains('mine')) { x.classList.remove('held'); scroll(); return; }
        var dots = log.querySelector('.msg.row.typing'), ms;
        if (first && dots && typingSince && x.classList.contains('master')) ms = TYPING_MS - (Date.now() - typingSince);
        else { if (dots) dots.remove(); typingLike(x); ms = first && typingSince ? TYPING_MS - (Date.now() - typingSince) : typingMs(x); ms = Math.max(ms, 1500); }
        return wait(ms).then(function () {
          log.querySelectorAll('.msg.row.typing').forEach(function (d) { d.remove(); });
          x.classList.remove('held');
          scroll();
          if (first) { first = false; if (window.TavernusTTS) TavernusTTS.fresh(); }
        });
      });
    }, Promise.resolve());
  }
  /** Hace fn en su turno de la cola (fn puede devolver una promesa: la cola la espera). */
  function inChat(fn) { queueChat(fn, function () { return false; }); }
  /**
   * Fin de la espera: en su turno de la cola, sin más espera si ya salió algo del turno; si no (la respuesta llegó
   * y el stream no trajo nada), también espera a que los puntos cumplan su tiempo.
   */
  function afterChat(fn) { queueChat(fn, function () { return !turnShown; }); }
  function queueChat(fn, mustWait) {
    chatQueue = chatQueue.then(function () {
      return wait(mustWait() && typingSince ? typingSince + TYPING_MS - Date.now() : 0);
    }).then(fn).catch(function (e) { console.error(e); });
  }

  /** La burbuja que cuenta la llegada a un sitio: queda marcada con él y lleva su vista si ya existe. */
  function placeIn(row, p) {
    row.setAttribute('data-place', p.location_id);
    if (p.src) placeShot(row, p);
  }
  /** La vista recién pintada entra en las burbujas de llegada a ese sitio que aún no la tienen. */
  function placeReady(p) {
    if (!p || !p.src) return;
    log.querySelectorAll('.msg.row[data-place]').forEach(function (row) { if (row.getAttribute('data-place') === p.location_id) placeShot(row, p); });
  }
  function placeShot(row, p) {
    var body = row.querySelector('.body');
    if (!body || body.querySelector('.place-shot')) return;
    row.classList.add('has-place');
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'place-shot'; b.title = 'Ver en grande';
    b.innerHTML = '<img alt="">';
    var img = b.querySelector('img');
    img.alt = 'Ilustración: ' + (p.name || '');
    var atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    img.addEventListener('load', function () { b.classList.add('ready'); if (atEnd) scroll(); sceneDot(); });
    // Si no carga, se quita la foto y queda la burbuja como estaba.
    img.addEventListener('error', function () { b.remove(); row.classList.remove('has-place'); });
    b.addEventListener('click', function () { openLightbox({ src: p.src, name: p.name || '' }); });
    img.src = p.src;
    // Arriba del todo: la foto, con el mismo margen por arriba que por los lados; debajo, el nombre y el texto.
    body.insertBefore(b, body.firstChild);
  }

  /**
   * Aviso de sistema (notice.ts), como «Fulano ha salido del grupo» en WhatsApp: una línea centrada sin burbuja.
   * Si lleva enlace, abre su pestaña (el Diario); si es una tirada, el dado del botón cae en lo que ha salido.
   * Los de misiones (alta, paso, cierre) van destacados, con el porqué debajo; la subida de nivel, con lo que gana.
   */
  function addNotice(n, other) {
    var div = document.createElement('div');
    div.className = 'msg notice' + (n.tone ? ' tone-' + n.tone : '') + (n.quest ? ' quest q-' + n.quest.event : '') + (n.level ? ' quest q-level' : '');
    div.setAttribute('role', 'status');
    var s = document.createElement('span');
    s.textContent = n.text;
    div.appendChild(s);
    if (n.link) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'link'; b.textContent = n.link;
      b.addEventListener('click', function () { goTab(n.tab || 'journal'); });
      div.appendChild(b);
    }
    if (n.quest && n.quest.why) {
      var why = document.createElement('small');
      why.className = 'why'; why.textContent = n.quest.why;
      div.appendChild(why);
    }
    // Subida de nivel: lo que gana, una línea por apartado.
    if (n.level) n.level.gains.forEach(function (g) {
      var li = document.createElement('small');
      li.className = 'why'; li.textContent = g;
      div.appendChild(li);
    });
    log.appendChild(div);
    if (!other) diceShown(n.text);
    scroll();
    return div;
  }

  /** Un mensaje del stream en el hilo: lo del PJ a la derecha, la narración y los NPCs a la izquierda. */
  /** Prólogo o «Donde lo dejamos» (docs/PROLOGO.md): una página de libro a todo el ancho, sin avatar, con su título. */
  var CHAPTER_KICKER = { prologue: 'Prólogo', recap: 'Recapitulación' };
  /** Remate de libro tras el capítulo: filetes, volutas y un rombo, en el dorado de la casa. */
  var CHAPTER_ORNAMENT = '<div class="orn" aria-hidden="true"><svg viewBox="0 0 200 30">' +
    '<path d="M14 15h50M136 15h50"/><circle cx="9" cy="15" r="1.6" fill="currentColor" stroke="none"/><circle cx="191" cy="15" r="1.6" fill="currentColor" stroke="none"/>' +
    '<path d="M64 15c5-7 13-7 16-1-2 6-9 6-10 1M136 15c-5-7-13-7-16-1 2 6 9 6 10 1"/>' +
    '<path d="M82 15h8M110 15h8"/><path d="M100 6l7 9-7 9-7-9z" fill="currentColor" fill-opacity=".9"/><path d="M100 1v3M100 26v3"/></svg></div>';
  function addChapter(m) {
    var div = document.createElement('article');
    div.className = 'msg chapter ' + m.chapter.kind;
    div.setAttribute('data-seq', String(m.seq));
    div.innerHTML = '<div class="who"><span class="kicker"></span></div><h2></h2><div class="body">' + format(m.text) + '</div>' + CHAPTER_ORNAMENT;
    div.querySelector('.kicker').textContent = CHAPTER_KICKER[m.chapter.kind] || '';
    div.querySelector('h2').textContent = m.chapter.title;
    log.appendChild(div);
    if (window.TavernusTTS) TavernusTTS.attach(div, m);
    scroll();
  }

  /** Opciones ya usadas: queda marcada la que coincide con lo que hizo el jugador (también al restaurar el historial). */
  function markChosen(text) {
    var rows = log.querySelectorAll('.actions'), row = rows[rows.length - 1], t = String(text).trim().toLowerCase();
    if (!row) return;
    row.querySelectorAll('button').forEach(function (b) { if (b.textContent.trim().toLowerCase() === t) b.classList.add('chosen'); });
  }

  /** Un mensaje del stream. Con «animate» (lo que llega en vivo), sus burbujas salen tras sus puntos: devuelve cuándo acaba. */
  function chatMessage(m, live, animate) {
    if (busy) turnShown = true;
    var since = typingSince;
    typing(false);
    // Lo que ya había (el mensaje pendiente del jugador se quita al pintar el turno: no vale como marca).
    var old = new Set(log.children);
    try { chatTurn(m, live); } catch (e) { console.error(e); }
    var shown;
    if (animate) {
      // Los puntos del narrador que ya se veían siguen (y cuentan) hasta la primera burbuja.
      if (since) { typing(true); typingSince = since; }
      shown = revealTurn(old);
    } else shown = Promise.resolve();
    return shown.then(function () {
      // Si el turno sigue (otra respuesta en camino), los puntos vuelven al rato: sin parpadeo cuando era la última.
      // La siguiente respuesta cuenta su espera desde ahora.
      if (!busy) return;
      typingSince = Date.now();
      setTimeout(function () { if (busy && !log.querySelector('.msg.row.typing')) { var t = typingSince; typing(true); typingSince = t; } }, 600);
    });
  }
  function chatTurn(m, live) {
    if (m.combat) { fightMark(m.combat); return; }
    if (m.scene) { showScene(m.scene); return; }
    if (m.chapter) { addChapter(m); return; }
    if (m.input) { clearPending(); markChosen(m.input); }
    var before = log.lastElementChild;
    var lines = m.lines || [], main = null;
    var say = function (l, lead) {
      // A quién se lo dice (modo Decir dirigido): una línea pequeña encima de la frase.
      if (l.to && !lead) lead = 'a ' + l.to;
      if (l.speaker === 'actor') return chatRow('mine', meWho(), (l.to ? '<div class="lead">a ' + escapeHtml(l.to) + '</div>' : '') + escapeHtml(l.text));
      if (l.avatar) portraits[l.id] = l.avatar;
      return chatRow('npc', { id: l.id, name: l.name, avatar: l.avatar }, (lead ? '<div class="lead">' + escapeHtml(lead) + '</div>' : '') + escapeHtml(l.text));
    };
    var narrate = function (text) {
      if (m.narrator || m.kind === 'master') return chatRow('master', cast.master, format(text));
      return add('system', text, m.dice === 'other' ? { other: true } : undefined);
    };
    // Si el jugador no habla en este turno, su mensaje es lo que ha hecho (en cursiva).
    if (m.input && !lines.some(function (l) { return l.speaker === 'actor'; })) chatRow('mine', meWho(), format(m.input), { act: true });
    if (m.notice) {
      // Un aviso no es narración: su línea y, debajo, lo que traiga (momentos, opciones, oferta).
      main = addNotice(m.notice, m.dice === 'other');
    } else if (m.blocks && m.blocks.length) {
      // El turno en su orden real: narrador, personaje, narrador… cada trozo en su burbuja.
      // La frase que presenta a quien habla (lead) va dentro de la burbuja de ese personaje.
      var lead = null;
      m.blocks.forEach(function (b) {
        if (b.kind === 'prose' && b.lead) { lead = b.text; return; }
        if (b.kind === 'prose') { var r = narrate(b.text); if (!main) main = r; }
        else if (lines[b.line]) say(b.text ? Object.assign({}, lines[b.line], { text: b.text }) : lines[b.line], lead);
        else if (lead) { var rl = narrate(lead); if (!main) main = rl; }
        lead = null;
      });
    } else {
      // Mensajes sin bloques (anteriores): las frases del jugador primero, luego narración y el resto.
      var cut = 0;
      while (cut < lines.length && lines[cut].speaker === 'actor') cut++;
      lines.slice(0, cut).forEach(say);
      var narration = m.lines ? (m.prose || '') : m.text;
      if (narration) main = narrate(narration);
      lines.slice(cut).forEach(say);
    }
    var last = log.lastElementChild;
    // Sin narración (todo era diálogo): el turno cuelga de su última burbuja.
    if (!main) main = last;
    if (!last || !main) return;
    if (m.place && main.classList.contains('row')) placeIn(main, m.place);
    last.setAttribute('data-seq', String(m.seq));
    // La voz lee la narración y los parlamentos del turno desde la burbuja del narrador.
    var div = main.classList.contains('master') ? main : last;
    if (window.TavernusTTS && !m.notice) {
      TavernusTTS.attach(div, m);
      // Cualquier avatar de este turno (narrador o personajes) lo lee.
      var rows = [], e = before ? before.nextElementSibling : log.firstElementChild;
      while (e) { if (e.classList.contains('row')) rows.push(e); e = e.nextElementSibling; }
      if (TavernusTTS.bindAvatars) TavernusTTS.bindAvatars(rows, div);
    }
    if (m.moments) m.moments.forEach(function (x) { showMoment(x, m.seq); });
    var host = log.lastElementChild;
    if (m.decisive_s) {
      var d = document.createElement('div');
      d.className = 'decisive';
      d.textContent = '⏳ Tienes ' + m.decisive_s + ' segundos para reaccionar. Si no, la amenaza se cumple.';
      (main.querySelector('.col') || main).appendChild(d);
    }
    if (m.overheard) {
      // Conversación ajena: «Escuchas» encima y el botón para unirse en cualquier momento.
      var tag = document.createElement('div');
      tag.className = 'overheard';
      tag.textContent = m.overheard.well ? 'Escuchas la conversación con ' + m.overheard.npc : 'Oyes de lejos la conversación con ' + m.overheard.npc;
      var first = before ? before.nextElementSibling : log.firstElementChild;
      if (first) log.insertBefore(tag, first);
      var jr = document.createElement('div');
      jr.className = 'actions party';
      var jb = document.createElement('button');
      jb.type = 'button'; jb.textContent = m.overheard.join;
      jb.onclick = function () { jb.classList.add('chosen'); jb.disabled = true; act(m.overheard.join); };
      jr.appendChild(jb);
      host.parentNode.insertBefore(jr, host.nextSibling);
      if (!live) jb.disabled = true;
    }
    if (m.reply_to) replyable(m.reply_to, before, main);
    if (m.offer) partyButtons(m, host, live);
    if (m.reaction) reactionButtons(m.reaction, host);
    if (m.reaction_wait) reactionWait(m.reaction_wait, main);
    if (m.reaction_done) closeReaction(m.reaction_done);
    if (!m.roll && !(m.suggested && m.suggested.length)) { scroll(); return; }
    if (live) spendButtons();
    var row = document.createElement('div');
    row.className = 'actions';
    if (m.roll) {
      var b = document.createElement('button');
      b.className = 'roll';
      b.innerHTML = D20_ICON;
      b.title = 'Tirar d20' + (m.roll.dc ? ' · CD ' + m.roll.dc : ''); b.setAttribute('aria-label', 'Tirar el dado de veinte caras' + (m.roll.dc ? ', dificultad ' + m.roll.dc : ''));
      b.onclick = function () { b.classList.add('chosen'); rollBtn = b; spendButtons(); roll(); };
      row.appendChild(b);
    } else {
      m.suggested.forEach(function (a) {
        var b = document.createElement('button');
        b.textContent = a;
        b.onclick = function () { b.classList.add('chosen'); spendButtons(); act(a); };
        row.appendChild(b);
      });
    }
    host.parentNode.insertBefore(row, host.nextSibling);
    if (!live) row.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    scroll();
  }

  /** Oferta de otro jugador (party.ts): «Aceptar» o «Rechazar» mientras siga en pie. */
  function partyButtons(m, host, live) {
    var row = document.createElement('div');
    row.className = 'actions party';
    var btn = function (label, fn, cls) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
      b.onclick = function () { b.classList.add('chosen'); row.querySelectorAll('button').forEach(function (x) { x.disabled = true; }); fn(); };
      row.appendChild(b);
    };
    btn('Aceptar', function () { answerOffer(m.offer.id, true); }, 'accept');
    btn('Rechazar', function () { answerOffer(m.offer.id, false); });
    host.parentNode.insertBefore(row, host.nextSibling);
    if (!live || !m.offer.open) row.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  }

  /**
   * Otro jugador te habla (party.ts): nada fijo debajo, como en WhatsApp. Sus burbujas de este turno llevan una
   * flechita (⌄) en la esquina al pasar el ratón; abre un menú con «Responder» (modo Decir hacia él, con la cita
   * encima del cuadro) e «Ignorar» (quita la flechita; no hace nada en el juego). En el móvil, un toque o una
   * pulsación larga abren el mismo menú, y deslizar la burbuja a la derecha responde directamente.
   */
  function replyable(to, before, main) {
    var rows = [], e = before ? before.nextElementSibling : log.firstElementChild;
    for (; e; e = e.nextElementSibling) if (e.getAttribute('data-who') === 'npc:' + to.id) rows.push(e);
    // Un cierre del máster que te tiene de objetivo no trae burbuja suya: la flechita va en la narración.
    if (!rows.length && main && main.classList.contains('row')) rows.push(main);
    rows.forEach(function (r) {
      var body = r.querySelector('.body');
      if (!body || body.querySelector('.msg-more')) return;
      r.classList.add('replyable');
      r._replyTo = { id: to.id, name: to.name };
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'msg-more';
      b.setAttribute('aria-label', 'Opciones del mensaje de ' + to.name); b.setAttribute('aria-haspopup', 'menu');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      body.appendChild(b);
    });
  }
  /** Lo que dice la burbuja, sin el nombre, la frase que la presenta ni sus botones: para la cita. */
  function rowText(row) {
    var c = row.querySelector('.body').cloneNode(true);
    c.querySelectorAll('.who, .lead, button, .decisive').forEach(function (x) { x.remove(); });
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function replyToRow(row) {
    closeMsgMenu();
    if (row && row._replyTo) replyTo(row._replyTo, rowText(row));
  }
  function ignoreRow(row) {
    closeMsgMenu();
    if (!row) return;
    row.classList.remove('replyable');
    row.classList.add('ignored');
    var b = row.querySelector('.msg-more'); if (b) b.remove();
  }
  var msgMenu = null, msgMenuRow = null;
  function closeMsgMenu() {
    if (msgMenuRow) { msgMenuRow.classList.remove('menu-open'); var a = msgMenuRow.querySelector('.msg-more'); if (a) a.setAttribute('aria-expanded', 'false'); }
    msgMenuRow = null;
    if (msgMenu) msgMenu.hidden = true;
  }
  function openMsgMenu(row) {
    if (!row || !row.classList.contains('replyable')) return;
    if (msgMenuRow === row) { closeMsgMenu(); return; }
    closeMsgMenu();
    if (!msgMenu) {
      msgMenu = document.createElement('div');
      msgMenu.id = 'msg-menu'; msgMenu.setAttribute('role', 'menu'); msgMenu.hidden = true;
      msgMenu.innerHTML = '<button type="button" role="menuitem" data-do="reply"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 8V4l-7 7 7 7v-4c5 0 8.5 1.6 11 5-1-5-4-10-11-11z"/></svg><span>Responder</span></button>' +
        '<button type="button" role="menuitem" data-do="ignore"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/></svg><span>Ignorar</span></button>';
      msgMenu.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        var r = msgMenuRow;
        if (b.getAttribute('data-do') === 'reply') replyToRow(r); else ignoreRow(r);
      });
      msgMenu.addEventListener('keydown', function (ev) {
        var items = [].slice.call(msgMenu.querySelectorAll('button')), i = items.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
        else if (ev.key === 'Escape' || ev.key === 'Tab') { var a = msgMenuRow && msgMenuRow.querySelector('.msg-more'); closeMsgMenu(); if (a && ev.key === 'Escape') a.focus(); }
      });
      document.body.appendChild(msgMenu);
    }
    msgMenuRow = row;
    row.classList.add('menu-open');
    var arrow = row.querySelector('.msg-more');
    if (arrow) arrow.setAttribute('aria-expanded', 'true');
    msgMenu.querySelector('[data-do="reply"] span').textContent = 'Responder a ' + row._replyTo.name;
    msgMenu.hidden = false;
    // Bajo la flechita, alineado a la derecha de la burbuja; si no cabe debajo, encima.
    var r = (arrow || row.querySelector('.body')).getBoundingClientRect(), mw = msgMenu.offsetWidth, mh = msgMenu.offsetHeight;
    var left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    var top = r.bottom + 4 + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh - 4) : r.bottom + 4;
    msgMenu.style.left = left + 'px'; msgMenu.style.top = top + 'px';
    msgMenu.querySelector('button').focus({ preventScroll: true });
  }
  // Cierra al pulsar fuera, al desplazar el hilo o al cambiar el tamaño.
  document.addEventListener('pointerdown', function (ev) {
    if (!msgMenuRow || ev.target.closest('#msg-menu') || ev.target.closest('.msg-more')) return;
    // Otro toque en la misma burbuja lo cierra el propio toque (abrir ⇄ cerrar).
    if (ev.pointerType === 'touch' && msgMenuRow.contains(ev.target)) return;
    closeMsgMenu();
  }, true);
  log.addEventListener('scroll', function () { if (msgMenuRow) closeMsgMenu(); });
  window.addEventListener('resize', function () { if (msgMenuRow) closeMsgMenu(); });
  /**
   * Gestos en las burbujas a las que se puede responder: la flechita (ratón o teclado); en táctil, un toque o una
   * pulsación larga abren el menú y deslizar a la derecha responde. Los botones de dentro (voz, foto) van a lo suyo.
   */
  var press = null, LONG_PRESS_MS = 450, SWIPE_PX = 56;
  function replyRowOf(ev) { var r = ev.target.closest && ev.target.closest('.msg.row.replyable'); return r && log.contains(r) ? r : null; }
  log.addEventListener('click', function (ev) {
    var more = ev.target.closest('.msg-more');
    if (more) { ev.stopPropagation(); openMsgMenu(more.closest('.msg.row')); return; }
    var row = replyRowOf(ev);
    if (!row || !press || press.row !== row) return;
    var p = press; press = null;
    if (p.type !== 'touch' || p.done || ev.target.closest('button, a, input')) return;
    openMsgMenu(row);
  });
  log.addEventListener('pointerdown', function (ev) {
    var row = replyRowOf(ev);
    press = row ? { row: row, type: ev.pointerType, x: ev.clientX, y: ev.clientY, dx: 0, done: false, timer: 0 } : null;
    if (!press || press.type !== 'touch' || ev.target.closest('button, a, input')) return;
    var p = press;
    p.timer = setTimeout(function () { if (press === p && !p.dx) { p.done = true; openMsgMenu(row); } }, LONG_PRESS_MS);
  });
  log.addEventListener('pointermove', function (ev) {
    var p = press;
    if (!p || p.type !== 'touch' || p.done) return;
    var dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(p.timer); if (!p.dx) press = null; return; }
    if (dx > 8 || p.dx) {
      clearTimeout(p.timer);
      p.dx = Math.max(0, Math.min(dx, SWIPE_PX + 24));
      p.row.classList.add('swiping');
      p.row.classList.toggle('swipe-ok', p.dx >= SWIPE_PX);
      p.row.querySelector('.body').style.transform = 'translateX(' + p.dx + 'px)';
    }
  });
  function endPress(ev) {
    var p = press;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.dx) return;
    var body = p.row.querySelector('.body');
    p.row.classList.remove('swiping', 'swipe-ok');
    body.style.transform = '';
    p.done = true;
    if (ev.type === 'pointerup' && p.dx >= SWIPE_PX) replyToRow(p.row);
  }
  log.addEventListener('pointerup', endPress);
  log.addEventListener('pointercancel', function (ev) { endPress(ev); press = null; });
  // La pulsación larga del sistema (menú de copiar, del navegador) no sale encima del nuestro.
  log.addEventListener('contextmenu', function (ev) { if (press && press.type === 'touch' && replyRowOf(ev)) ev.preventDefault(); });

  /**
   * Reacciones (reactions.ts): otro jugador intenta algo sobre ti. «Dejarse», «Resistirse» o tus palabras,
   * con la cuenta atrás; al acabar el tiempo te resistes por instinto. Siguen activos tras recargar
   * mientras la petición esté en pie.
   */
  var reactionTimers = {};
  function countdown(id, el, until, fmt) {
    var tick = function () {
      var left = Math.max(0, Math.round((until - Date.now()) / 1000));
      el.textContent = fmt(Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'), left);
      if (!left) { clearInterval(reactionTimers[id]); delete reactionTimers[id]; }
    };
    clearInterval(reactionTimers[id]);
    tick();
    reactionTimers[id] = setInterval(tick, 1000);
  }
  function reactionButtons(r, host) {
    var box = document.createElement('div');
    box.className = 'actions party reaction';
    box.setAttribute('data-reaction', r.id);
    var open = r.open && r.expires_ms > Date.now();
    var send = function (answer, text) {
      box.querySelectorAll('button, input').forEach(function (x) { x.disabled = true; });
      answerReaction(r.id, answer, text);
    };
    var btn = function (label, answer, cls) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
      b.onclick = function () { b.classList.add('chosen'); send(answer, ''); };
      box.appendChild(b);
    };
    btn('Dejarse', 'accept', 'accept');
    btn('Resistirse', 'resist');
    // Sin <form>: el cuadro de la página habilita y deshabilita todos los botones de formulario al esperar.
    var f = document.createElement('div');
    f.className = 'reply';
    f.innerHTML = '<input type="text" maxlength="300" placeholder="O responde con tus palabras…" aria-label="Tu respuesta"><button type="button">Enviar</button>';
    var submit = function () { var v = f.querySelector('input').value.trim(); if (v) send(null, v); };
    f.querySelector('button').onclick = submit;
    f.querySelector('input').onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } };
    box.appendChild(f);
    var left = document.createElement('span');
    left.className = 'left';
    box.appendChild(left);
    host.parentNode.insertBefore(box, host.nextSibling);
    if (!open) { closeReaction(r.id); return; }
    countdown(r.id, left, r.expires_ms, function (t, s) { return s ? 'Decide en ' + t + ' · si no, te resistes por instinto' : 'Se acabó el tiempo: te resistes por instinto'; });
  }
  function reactionWait(r, main) {
    var d = document.createElement('div');
    d.className = 'decisive waiting';
    d.setAttribute('data-reaction', r.id);
    (main && (main.querySelector('.col') || main) || log).appendChild(d);
    if (!r.open || r.expires_ms <= Date.now()) { d.textContent = r.name + ' ya ha decidido.'; return; }
    countdown(r.id, d, r.expires_ms, function (t, s) { return s ? '⏳ Esperando a que ' + r.name + ' decida… ' + t : '⏳ ' + r.name + ' no ha respondido: se resiste por instinto.'; });
  }
  /** Ya decidido: fuera la cuenta atrás y los botones de esa petición. */
  function closeReaction(id) {
    clearInterval(reactionTimers[id]); delete reactionTimers[id];
    log.querySelectorAll('[data-reaction="' + id + '"]').forEach(function (el) {
      el.classList.add('done');
      el.querySelectorAll('button, input').forEach(function (x) { x.disabled = true; });
      var left = el.classList.contains('waiting') ? el : el.querySelector('.left');
      if (left) left.textContent = el.classList.contains('waiting') ? 'Ya ha decidido.' : 'Decidido.';
    });
  }

  function setCast(c) {
    if (!c) return;
    cast = c;
    if (c.master.avatar) portraits[c.master.id] = c.master.avatar;
    if (c.me.avatar) portraits[c.me.id] = c.me.avatar;
  }
  function setPortrait(p) {
    if (!p || !p.id || !p.src) return;
    portraits[p.id] = p.src;
    if (cast.master.id === p.id) cast.master.avatar = p.src;
    if (cast.me.id === p.id) cast.me.avatar = p.src;
    log.querySelectorAll('.nv-av').forEach(function (s) { if (s.getAttribute('data-portrait') === p.id) putPortrait(s, p.src); });
  }
  /** Imagen de un momento junto a su evento (o al final si el evento ya no está en el hilo). Una vez por clave. */
  function showMoment(x, seq) {
    if (!x || !x.src) return;
    var dup = false;
    log.querySelectorAll('[data-moment]').forEach(function (f) { if (f.getAttribute('data-moment') === x.key) dup = true; });
    if (dup) return;
    var fig = document.createElement('figure');
    fig.className = 'msg moment ' + x.kind;
    fig.setAttribute('data-moment', x.key);
    fig.setAttribute('data-for', String(seq));
    fig.innerHTML = '<button type="button" class="shot" title="Ver en grande"><img alt=""><figcaption><b></b><span></span></figcaption></button>';
    var img = fig.querySelector('img'), name = x.name || '';
    fig.querySelector('figcaption b').textContent = name;
    fig.querySelector('figcaption span').textContent = MOMENT_LABEL[x.kind] || 'Ilustración';
    img.alt = (MOMENT_LABEL[x.kind] || 'Ilustración') + ': ' + name;
    var atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    img.addEventListener('load', function () { fig.classList.add('ready'); if (atEnd) scroll(); });
    img.addEventListener('error', function () { fig.remove(); });
    fig.querySelector('.shot').addEventListener('click', function () { openLightbox({ src: x.src, name: name }); });
    img.src = x.src;
    var host = null;
    log.querySelectorAll('.msg[data-seq]').forEach(function (d) { if (d.getAttribute('data-seq') === String(seq)) host = d; });
    if (!host) { log.appendChild(fig); return; }
    var ref = host;
    while (ref.nextElementSibling && ref.nextElementSibling.getAttribute('data-for') === String(seq)) ref = ref.nextElementSibling;
    ref.parentNode.insertBefore(fig, ref.nextSibling);
  }
`;
