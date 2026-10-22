/**
 * Texto para la voz: de la narración del máster (marcas, iconos, atajos, rayas y «») a trozos que
 * se leen en alto, cada uno con su voz (narrador o diálogo) y, si se sabe, su hablante.
 *
 * Funciones puras y autocontenidas: la web las incrusta tal cual en la página con toString()
 * (src/adapters/web/tts.ts), así que no pueden usar nada de fuera de su propio cuerpo salvo
 * llamarse entre ellas.
 */

export interface SpeechLine {
  /** 'npc' | 'actor' (modo novela, src/ai/tools.ts) u otro rótulo. */
  speaker?: string | null;
  npc_id?: string | null;
  /** Nombre visible del hablante, si el servidor lo añade. */
  name?: string | null;
  text: string;
}

export interface SpeechPart {
  kind: 'narrator' | 'dialogue';
  /** Quién habla (nombre, npc_id o 'actor'); null si no se sabe. */
  speaker: string | null;
  text: string;
  /** Empieza un párrafo nuevo: el lector deja una pausa más larga antes. */
  para: boolean;
}

/** Quita lo que no se lee: marcas de Markdown, iconos, atajos (/look), y adapta dados y siglas. Conserva rayas y comillas. */
export function speechMarkup(raw: string): string {
  let t = String(raw || '').replace(/\r\n?/g, '\n');
  t = t.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/__(.+?)__/gs, '$1').replace(/`+([^`]*)`+/g, '$1');
  t = t.replace(/(^|[\s(«"“])[*_]([^*_\n]+)[*_](?=$|[\s.,;:!?)»"”])/gm, '$1$2');
  t = t.replace(/^[ \t]*(#{1,6}|>|[-*•·▸►◦])[ \t]+/gm, '');
  // Iconos: pictogramas, banderas, selectores de variante y uniones; y unos cuantos símbolos sueltos.
  t = t.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}︎️‍⃣]/gu, '');
  t = t.replace(/[✓✗✔✘★☆◆◇■□●○♦♥♠♣]/g, '');
  t = t.replace(/\s*(→|⇒|->|=>)\s*/g, ', ');
  // Atajos de la interfaz: /look, /tablon...
  t = t.replace(/(^|[\s(])\/[a-záéíóúñü_]+\b/gim, '$1');
  // Dados y siglas de reglas: 1d20+3 → 1 de 20 más 3; CD 15 → dificultad 15; PG → puntos de golpe.
  t = t.replace(/\b(\d*)[dD](\d+)\b/g, function (_m: string, n: string, f: string) { return (n ? n + ' de ' : 'de ') + f; });
  t = t.replace(/(\d)\s*\+\s*(\d)/g, '$1 más $2').replace(/(\d)\s*[-−]\s*(\d)/g, '$1 menos $2').replace(/\s=\s/g, ', total ');
  t = t.replace(/\bCD\s*(\d+)/g, 'dificultad $1').replace(/\bCA\s*(\d+)/g, 'armadura $1').replace(/\bPG\b/g, 'puntos de golpe');
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[[\]{}<>|~^]/g, ' ');
  return t;
}

/**
 * Trozos en orden de lectura. Párrafos separados por línea en blanco; dentro, las rayas de diálogo
 * (—Hola —dijo él—. Pasa) y las comillas «» “” "" separan diálogo de narración; una raya en mitad
 * de una frase narrada (el bosque —oscuro— calla) es un inciso y se lee como pausa. Con `lines`
 * (modo novela), cada parlamento toma su hablante.
 */
export function speechParts(raw: string, lines?: SpeechLine[] | null): SpeechPart[] {
  const out: SpeechPart[] = [];
  const paragraphs = speechMarkup(raw).split(/\n[ \t]*\n+/);
  for (const para of paragraphs) {
    // Saltos simples dentro del párrafo: frase aparte.
    const p = para.split('\n').map(function (l) { return l.trim(); }).filter(Boolean)
      .map(function (l) { return /[.!?…:;,»”"—]$/.test(l) ? l : l + '.'; }).join(' ');
    if (!p) continue;
    const parts: { kind: 'narrator' | 'dialogue'; text: string }[] = [];
    let kind = 'narrator' as 'narrator' | 'dialogue';
    let buf = '';
    let paren = false; // raya de inciso abierta en narración
    let tag = false; // acotación del narrador abierta dentro de un diálogo
    let quote = ''; // comilla que cerrará el diálogo («, “ o ")
    const flush = function (next: 'narrator' | 'dialogue') { parts.push({ kind, text: buf }); buf = ''; kind = next; };
    for (let i = 0; i < p.length; i++) {
      const c = p.charAt(i);
      const isDash = c === '—' || c === '―' || (c === '–' && (i === 0 || p.charAt(i - 1) === ' ' || p.charAt(i + 1) === ' ' || /[.,;:!?]/.test(p.charAt(i + 1))));
      if (quote) {
        const closes = (quote === '«' && c === '»') || (quote === '“' && c === '”') || (quote === '"' && c === '"');
        if (closes) { quote = ''; flush('narrator'); continue; }
        if (isDash) { buf += ', '; continue; }
        buf += c;
        continue;
      }
      if (c === '«' || c === '“' || c === '"') { quote = c === '«' ? '«' : c === '“' ? '“' : '"'; flush('dialogue'); continue; }
      if (isDash) {
        const more = /[\p{L}\p{N}]/u.test(p.slice(i + 1));
        // Dentro del diálogo, la raya abre la acotación del narrador (—Hola —dijo él—. Pasa).
        if (kind === 'dialogue') { flush('narrator'); tag = true; continue; }
        // Y la siguiente la cierra: si queda algo, vuelve a hablar el personaje.
        if (tag) { tag = false; if (more) flush('dialogue'); continue; }
        if (paren) { buf += ', '; paren = false; continue; }
        const before = buf.trim();
        if (more && (!before || /[:.!?…]$/.test(before))) { flush('dialogue'); continue; }
        buf += ', ';
        paren = true;
        continue;
      }
      buf += c;
    }
    parts.push({ kind, text: buf });
    // Puntuación al principio de un trozo (el «.» de «—dijo él—.») cierra el anterior.
    const clean: { kind: 'narrator' | 'dialogue'; text: string }[] = [];
    for (const part of parts) {
      let text = part.text.replace(/\s+/g, ' ').trim();
      const lead = /^[\s.,;:!?…]+/.exec(text);
      if (lead && clean.length) {
        const prev = clean[clean.length - 1];
        const mark = lead[0].replace(/[\s,]/g, '').charAt(0);
        if (mark && prev) prev.text = prev.text.replace(/[\s,;:]+$/, '') + (/[.!?…]$/.test(prev.text) ? '' : mark);
      }
      text = text.replace(/^[\s.,;:…]+/, '').replace(/(\s*,)+\s*$/, '').replace(/,\s*,/g, ',').replace(/\s+([.,;:!?…])/g, '$1').trim();
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const last = clean[clean.length - 1];
      if (last && last.kind === part.kind) last.text += ' ' + text;
      else clean.push({ kind: part.kind, text });
    }
    clean.forEach(function (c, i) {
      if (!/[.!?…:;»”"]$/.test(c.text)) c.text += i < clean.length - 1 && c.kind === 'narrator' && clean[i + 1]!.kind === 'dialogue' ? ':' : '.';
      if (/^[a-záéíóúñü]/.test(c.text) && (i === 0 || c.kind === 'dialogue')) c.text = c.text.charAt(0).toUpperCase() + c.text.slice(1);
      out.push({ kind: c.kind, speaker: null, text: c.text, para: i === 0 });
    });
  }
  // Hablantes del modo novela: cada parlamento, por orden, al trozo de diálogo que lo contiene.
  if (lines && lines.length) {
    const norm = function (s: string) { return String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9ñ]+/g, ' ').trim(); };
    let from = 0;
    let last: { text: string; speaker: string | null } | null = null;
    for (const part of out) {
      if (part.kind !== 'dialogue') continue;
      const pt = norm(part.text);
      // Un parlamento partido por la acotación (—Déjalo —ríe ella—. Es solo...) sigue siendo del mismo.
      if (last && pt && last.text.indexOf(pt) >= 0) { part.speaker = last.speaker; continue; }
      for (let j = from; j < lines.length; j++) {
        const lt = norm(lines[j]!.text);
        if (!lt || !pt) continue;
        if (pt.indexOf(lt) >= 0 || lt.indexOf(pt) >= 0 || pt.slice(0, 16) === lt.slice(0, 16)) {
          const l = lines[j]!;
          part.speaker = l.name || l.npc_id || (l.speaker === 'actor' ? 'actor' : l.speaker || null);
          last = { text: lt, speaker: part.speaker };
          from = j + 1;
          break;
        }
      }
    }
  }
  return out;
}

/** Texto limpio para una sola voz: párrafos separados por línea en blanco, rayas y comillas convertidas en pausas. */
export function speechText(raw: string): string {
  const paras: string[] = [];
  for (const part of speechParts(raw)) {
    if (part.para || !paras.length) paras.push(part.text);
    else paras[paras.length - 1] += ' ' + part.text;
  }
  return paras.join('\n\n');
}

/**
 * Trozos de como mucho `max` caracteres, cortados por frases (y si una frase no cabe, por comas
 * y luego por palabras). Chrome corta las locuciones de más de ~15 s; así cada una es corta.
 */
export function speechChunks(text: string, max?: number): string[] {
  const limit = max && max > 20 ? max : 220;
  const sentences = String(text || '').match(/[^.!?…]+[.!?…]+[»”"]?\s*|[^.!?…]+$/g) || [];
  const pieces: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= limit) { pieces.push(s); continue; }
    let cur = '';
    for (const clause of s.split(/(?<=[,;:])\s+/)) {
      if (clause.length > limit) {
        for (const w of clause.split(/\s+/)) {
          if (cur && (cur + ' ' + w).length > limit) { pieces.push(cur); cur = ''; }
          cur = cur ? cur + ' ' + w : w;
        }
        continue;
      }
      if (cur && (cur + ' ' + clause).length > limit) { pieces.push(cur); cur = ''; }
      cur = cur ? cur + ' ' + clause : clause;
    }
    if (cur) pieces.push(cur);
  }
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if (last && (last + ' ' + piece).length <= limit) out[out.length - 1] = last + ' ' + piece;
    else out.push(piece);
  }
  return out;
}
