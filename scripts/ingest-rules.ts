/**
 * Ingesta de los manuales (PHB y DMG) a un índice local de fragmentos.
 *
 *   npm run rules:ingest                       # lee data/local/manuals/{phb,dmg}.pdf
 *   npm run rules:ingest -- --phb ruta.pdf --dmg ruta.pdf [--out data/local/rules]
 *
 * Uso privado: el texto extraído se queda en data/local/rules (ignorado por git).
 * Los PDF son escaneos con capa OCR: no hacemos OCR propio; las páginas sin texto
 * se registran y se saltan. El OCR rompe palabras ("m ultiverse", "disint eg ration"),
 * así que se unen los trozos por geometría y luego se resegmenta con un diccionario inglés
 * (paquete word-list) y las frecuencias del propio corpus.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import wordListPath from 'word-list';

interface Chunk { id: string; book: string; title: string; page: number; text: string }
interface Line { text: string; size: number; page: number; edge: boolean }
interface PageInfo { lines: Line[]; chars: number }

const BOOKS: Record<string, { title: string; file: string }> = {
  phb: { title: "Player's Handbook", file: join('data', 'local', 'manuals', 'phb.pdf') },
  dmg: { title: "Dungeon Master's Guide", file: join('data', 'local', 'manuals', 'dmg.pdf') },
};

const TARGET_WORDS = 400;
const MAX_WORDS = 500;
const MIN_WORDS = 80;
const OVERLAP_WORDS = 40;

function args(): { out: string; files: Record<string, string> } {
  const a = process.argv.slice(2);
  const files: Record<string, string> = Object.fromEntries(Object.entries(BOOKS).map(([k, v]) => [k, v.file]));
  let out = process.env['RULES_DIR'] ?? join('data', 'local', 'rules');
  for (let i = 0; i < a.length; i++) {
    const k = a[i]!.replace(/^--/, '');
    const v = a[i + 1];
    if (v === undefined) break;
    if (k === 'out') out = v;
    else if (k in BOOKS) files[k] = v;
    else continue;
    i++;
  }
  return { out, files };
}

// --- Extracción ------------------------------------------------------------

interface TextItem { str: string; transform: number[]; width: number; hasEOL: boolean }

export async function extract(file: string): Promise<PageInfo[]> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0, disableFontFace: true }).promise;
  const pages: PageInfo[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const height = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    const lines: Line[] = [];
    let cur = '';
    let curSize = 0;
    let curY = 0;
    let lastEnd: number | null = null;
    let pendingSpace = false;
    const flush = () => {
      const text = cur.replace(/\s+/g, ' ').trim();
      if (text) lines.push({ text, size: curSize, page: p, edge: curY < height * 0.07 || curY > height * 0.93 });
      cur = ''; curSize = 0; lastEnd = null; pendingSpace = false;
    };
    for (const raw of tc.items) {
      if (!('str' in raw)) continue;
      const it = raw as TextItem;
      const size = Math.hypot(it.transform[0]!, it.transform[1]!) || 1;
      const x = it.transform[4]!;
      const y = it.transform[5]!;
      if (cur && Math.abs(y - curY) > size * 0.6) flush();
      if (!it.str.trim()) {
        if (cur) pendingSpace = true;
        if (it.hasEOL) flush();
        continue;
      }
      if (cur) {
        const gap = lastEnd === null ? 1 : (x - lastEnd) / size;
        // Hueco real entre palabras ≈ 0,25 em; los cortes del OCR dentro de una palabra ≈ 0,05 em.
        if (gap < -1) { flush(); } else if ((pendingSpace && gap > 0.15) || gap > 0.15) cur += ' ';
      }
      if (!cur) curY = y;
      cur += it.str;
      curSize = Math.max(curSize, size);
      lastEnd = x + it.width;
      pendingSpace = false;
      if (it.hasEOL) flush();
    }
    flush();
    pages.push({ lines, chars: lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0) });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

// --- Reparación de palabras partidas ---------------------------------------
//
// El OCR mete espacios dentro de las palabras ("m ultiverse"), los quita entre palabras
// ("ofyour") o los pone en otro sitio ("am elee"). Para cada tramo de texto sin puntuación
// se busca, por programación dinámica sobre caracteres, la segmentación más probable:
// palabras del diccionario (con su frecuencia en el corpus) y respetando en lo posible
// los espacios originales. Quitar un espacio cuesta poco; inventar uno cuesta algo más.

/** Palabras de una o dos letras válidas: las del diccionario de una o dos letras son casi todas ruido ("er", "em"). */
const SHORT_WORDS = new Set(['a', 'i', 'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'ox', 'so', 'to', 'up', 'us', 'we', 'ac', 'dc', 'dm', 'hp', 'xp', 'gp', 'sp', 'cp', 'ep', 'pp', 'ft', 'lb']);
/** Terminaciones sueltas que el diccionario acepta como palabra pero aquí casi siempre son un trozo. */
const FRAGMENTS = new Set(['ing', 'ion', 'ers', 'ent', 'ous', 'ive', 'ble', 'ted', 'ses', 'ces', 'ity', 'ure', 'ily', 'ism', 'nce', 'tion', 'ment', 'ness']);
const CONTRACTIONS = /'(s|t|re|ll|ve|d|m)$/;

const REMOVE_SPACE = -5;
const REMOVE_LETTER_SPACE = -1; // entre letras sueltas: versalitas espaciadas ("C h a p t e r")
const ADD_SPACE = -6;
const NOT_IN_DICT = -6;
const MAX_WORD = 24;

export interface Vocab { dict: Set<string>; counts: Map<string, number>; total: number; memo: Map<string, number> }

const key = (frag: string) => frag.toLowerCase().replace(/[’`·]/g, "'");

export function countWords(texts: Iterable<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of texts) for (const w of t.split(/[^A-Za-z'’·]+/)) {
    const k = key(w).replace(/^'+|'+$/g, '');
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function makeVocab(dict: Iterable<string>, counts: Map<string, number>): Vocab {
  let total = 0;
  for (const n of counts.values()) total += n;
  return { dict: new Set(dict), counts, total: Math.max(total, 1), memo: new Map() };
}

function inDict(k: string, v: Vocab): boolean {
  const base = k.replace(CONTRACTIONS, '');
  if (base.includes("'")) return false;
  if (base.length <= 2) return SHORT_WORDS.has(base);
  return v.dict.has(base) && !FRAGMENTS.has(base);
}

const FUNCTION_WORDS = ['a', 'an', 'as', 'at', 'by', 'if', 'in', 'is', 'it', 'of', 'on', 'or', 'to', 'the', 'you', 'your', 'and', 'for', 'that', 'this', 'with'];

/** Palabra funcional pegada a otra del diccionario: el pegote típico del OCR. */
function gluedFunctionWord(k: string, v: Vocab): boolean {
  return FUNCTION_WORDS.some((f) => k.length > f.length + 1 && k.startsWith(f) && inDict(k.slice(f.length), v));
}

/** Log-probabilidad aproximada de que `k` sea una palabra (minúsculas). */
function wordScore(k: string, v: Vocab): number {
  const hit = v.memo.get(k);
  if (hit !== undefined) return hit;
  const n = v.counts.get(k) ?? 0;
  const logP = Math.log((n + 0.5) / v.total);
  let s: number;
  if (inDict(k, v)) s = logP;
  else if (k.length <= 2) s = logP + 2 * NOT_IN_DICT; // letras sueltas y pares que no son palabra ("s", "tw")
  else if (gluedFunctionWord(k, v)) s = logP + 3 * NOT_IN_DICT; // "ofthe", "ifyou": frecuentes pero son dos palabras
  else if (n > 0) s = logP + (n >= 20 ? NOT_IN_DICT / 3 : NOT_IN_DICT); // términos del juego y nombres propios ("darkvision", "Tiamat")
  else s = -15 - 2 * k.length;
  v.memo.set(k, s);
  return s;
}

/** Segmenta un tramo de letras. `breaks`: posiciones con espacio en el original y lo que cuesta quitarlo. */
function segmentRun(chars: string, breaks: Map<number, number>, v: Vocab): number[] {
  const L = chars.length;
  const lower = key(chars);
  const best = new Float64Array(L + 1).fill(-Infinity);
  const from = new Int32Array(L + 1);
  best[0] = 0;
  for (let p = 1; p <= L; p++) {
    for (let q = Math.max(0, p - MAX_WORD); q < p; q++) {
      if (best[q] === -Infinity) continue;
      let s = best[q]! + (q === 0 || breaks.has(q) ? 0 : ADD_SPACE);
      let ok = true;
      for (let k = q + 1; k < p; k++) {
        if (!breaks.has(k)) continue;
        // No se pega una mayúscula tras una minúscula ("Dungeon Master"), salvo en versalitas.
        if (/[a-z]/.test(chars[k - 1]!) && /[A-Z]/.test(chars[k]!) && /[a-z]/.test(chars.slice(q, p))) { ok = false; break; }
        s += breaks.get(k)!;
      }
      if (!ok) continue;
      const w = lower.slice(q, p);
      if (w.startsWith("'") || w.endsWith("'")) continue;
      s += wordScore(w, v);
      if (s > best[p]!) { best[p] = s; from[p] = q; }
    }
  }
  const cuts: number[] = [];
  for (let p = L; p > 0; p = from[p]!) cuts.push(from[p]!);
  return cuts.reverse().slice(1);
}

/** Repara los espacios de un texto: une trozos, separa palabras pegadas y mueve espacios mal puestos. */
export function repairWords(text: string, v: Vocab): string {
  const out: string[] = [];
  let run: string[] = [];
  let runPre = '';
  const flush = (post = '') => {
    if (run.length) {
      const chars = run.join('');
      const breaks = new Map<number, number>();
      let pos = 0;
      run.slice(0, -1).forEach((t, i) => { pos += t.length; breaks.set(pos, t.length === 1 && run[i + 1]!.length === 1 ? REMOVE_LETTER_SPACE : REMOVE_SPACE); });
      const words: string[] = [];
      let last = 0;
      for (const c of [...segmentRun(chars, breaks, v), chars.length]) { words.push(chars.slice(last, c)); last = c; }
      words[0] = runPre + words[0]!;
      words[words.length - 1] += post;
      out.push(...words);
    } else if (runPre || post) out.push(runPre + post);
    run = [];
    runPre = '';
  };
  for (const t of text.split(' ')) {
    if (!t) continue;
    // Solo la primera tanda de letras entra en el tramo; lo que sigue ("-believe", "—a", ",") lo cierra.
    // Así "m ake-believe" se une, pero "5th", "1d6" o "d20" no se pegan a nada.
    const m = /^([^A-Za-z'’·]*)([A-Za-z'’·]+)(.*)$/.exec(t);
    if (!m || /\d/.test(m[1]!) || /^\d/.test(m[3]!)) { flush(); out.push(t); continue; }
    const [, pre, core, post] = m as unknown as [string, string, string, string];
    if (pre) { flush(); runPre = pre; } // la puntuación corta el tramo
    run.push(core);
    if (post) flush(post);
  }
  flush();
  return out.join(' ');
}

// --- Troceo ----------------------------------------------------------------

interface Section { title: string; words: { w: string; page: number }[] }

function bodySize(pages: PageInfo[]): number {
  const hist = new Map<number, number>();
  for (const p of pages) for (const l of p.lines) {
    const s = Math.round(l.size * 2) / 2;
    hist.set(s, (hist.get(s) ?? 0) + l.text.length);
  }
  return [...hist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/** Quita cabeceras/pies repetidos (en el borde de la página y en muchas páginas). */
export function dropRunningLines(pages: PageInfo[]): void {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
  const seen = new Map<string, Set<number>>();
  for (const p of pages) for (const l of p.lines) if (l.edge) {
    const k = norm(l.text);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(l.page);
  }
  for (const p of pages) p.lines = p.lines.filter((l) => {
    if (!l.edge) return true;
    if (/^[\d\s|]+$/.test(l.text)) return false; // número de página
    return (seen.get(norm(l.text))?.size ?? 0) < 4;
  });
}

function sections(pages: PageInfo[], body: number, v: Vocab): Section[] {
  const out: Section[] = [];
  let cur: Section = { title: '', words: [] };
  let carry = ''; // guion de fin de línea pendiente
  const CONNECTORS = new Set(['with', 'from', 'into', 'than', 'that', 'your', 'their', 'this', 'when', 'what']);
  /** Título si la línea parece un encabezado: letra mayor que el cuerpo, corta y sin pinta de frase ni de fila de tabla. */
  const headingOf = (l: Line): string | null => {
    if (l.size < body * 1.25 || l.text.length > 80 || /\.{4,}/.test(l.text)) return null;
    const t = repairWords(l.text, v).replace(/(\w)- (\w)/g, '$1-$2').replace(/[_\-–—=:.·,]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^\d+\s/.test(t) || /[,;]$/.test(t) || (t.match(/[A-Za-z]/g)?.length ?? 0) < 3) return null;
    const words = t.split(' ');
    if (words.length > 10 || words.filter((w) => /^[a-z]{4,}/.test(w) && !CONNECTORS.has(w)).length >= 2) return null;
    return t;
  };
  for (const p of pages) for (const l of p.lines) {
    const title = headingOf(l);
    if (title) {
      if (carry) { cur.words.push({ w: carry.trim(), page: l.page }); carry = ''; }
      if (cur.words.length === 0) cur.title = cur.title ? `${cur.title} ${title}` : title;
      else { out.push(cur); cur = { title, words: [] }; }
      continue;
    }
    let text = l.text.replace(/([A-Za-z])·([A-Za-z])/g, "$1'$2");
    if (carry) text = carry + text;
    carry = '';
    const m = /([A-Za-z]+)-$/.exec(text);
    if (m) { carry = m[1]! + ' '; text = text.slice(0, -m[0].length); } // la mitad pasa a la línea siguiente; repairWords decide si une
    for (const w of text.split(/\s+/)) if (w) cur.words.push({ w, page: l.page });
  }
  if (carry) cur.words.push({ w: carry.trim(), page: pages.at(-1)?.lines.at(-1)?.page ?? 1 });
  if (cur.words.length) out.push(cur);
  // Reparación por sección (conservando la página de cada palabra resultante).
  for (const s of out) {
    const fixed = repairWords(s.words.map((x) => x.w).join(' '), v).split(' ');
    const pagesOf: number[] = [];
    let i = 0;
    for (const w of fixed) {
      pagesOf.push(s.words[Math.min(i, s.words.length - 1)]!.page);
      let len = 0;
      while (i < s.words.length && len < w.length) { len += s.words[i]!.w.length; i++; }
    }
    s.words = fixed.map((w, k) => ({ w, page: pagesOf[k]! }));
  }
  return out;
}

function chunkSections(book: string, secs: Section[]): Chunk[] {
  // Fusiona secciones muy cortas con la siguiente (el título secundario queda en el texto).
  const merged: Section[] = [];
  for (const s of secs) {
    const prev = merged.at(-1);
    if (prev && prev.words.length < MIN_WORDS && prev.words.length + s.words.length <= MAX_WORDS) {
      if (s.title) prev.words.push({ w: `${s.title}.`, page: s.words[0]?.page ?? prev.words.at(-1)?.page ?? 1 });
      prev.words.push(...s.words);
      if (!prev.title) prev.title = s.title;
    } else merged.push({ title: s.title, words: [...s.words] });
  }
  const chunks: Chunk[] = [];
  let lastTitle = '';
  for (const s of merged) {
    if (s.title) lastTitle = s.title;
    const title = s.title || lastTitle;
    const ws = s.words;
    if (ws.length === 0) continue;
    const step = TARGET_WORDS - OVERLAP_WORDS;
    for (let start = 0; start < ws.length; start += step) {
      const end = ws.length - start <= MAX_WORDS ? ws.length : start + TARGET_WORDS;
      const slice = ws.slice(start, end);
      chunks.push({ id: `${book}-${String(chunks.length + 1).padStart(4, '0')}`, book, title, page: slice[0]!.page, text: slice.map((x) => x.w).join(' ') });
      if (end === ws.length) break;
    }
  }
  return chunks;
}

// --- Idioma ----------------------------------------------------------------

function language(text: string): string {
  const words = text.toLowerCase().split(/[^a-záéíóúñ]+/);
  const en = new Set(['the', 'and', 'of', 'to', 'you', 'is', 'that', 'with', 'your', 'are']);
  const es = new Set(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'con', 'una']);
  let e = 0, s = 0;
  for (const w of words) { if (en.has(w)) e++; if (es.has(w)) s++; }
  return e > s * 2 ? 'inglés' : s > e * 2 ? 'español' : 'mixto';
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const { out, files } = args();
  mkdirSync(out, { recursive: true });
  const extracted: Record<string, PageInfo[]> = {};
  for (const [book, file] of Object.entries(files)) {
    if (!existsSync(file)) { console.error(`[${book}] no existe ${file}; se omite`); continue; }
    const t0 = Date.now();
    const pages = await extract(file);
    extracted[book] = pages;
    const empty = pages.map((p, i) => (p.chars < 20 ? i + 1 : 0)).filter(Boolean);
    console.log(`[${book}] ${pages.length} páginas: ${pages.length - empty.length} con texto, ${empty.length} sin texto${empty.length ? ` (${empty.join(', ')})` : ''} — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  for (const pages of Object.values(extracted)) dropRunningLines(pages);

  // Vocabulario: diccionario inglés + frecuencias del propio corpus (para términos del juego y nombres propios).
  // Dos pasadas: las frecuencias del texto roto infravaloran las palabras que el OCR suele partir
  // ("melee", "spellcasting"); en la segunda se cuentan sobre el texto ya reparado.
  const dict = readFileSync(wordListPath, 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
  const books = Object.entries(extracted).map(([book, pages]) => ({ book, pages, body: bodySize(pages) }));
  let vocab = makeVocab(dict, countWords(books.flatMap((b) => b.pages.flatMap((p) => p.lines.map((l) => l.text)))));
  const firstPass = books.map((b) => sections(b.pages, b.body, vocab));
  vocab = makeVocab(dict, countWords(firstPass.flatMap((secs) => secs.map((s) => `${s.title} ${s.words.map((w) => w.w).join(' ')}`))));

  for (const { book, pages, body } of books) {
    const secs = sections(pages, body, vocab);
    const chunks = chunkSections(book, secs);
    const path = join(out, `${book}.json`);
    writeFileSync(path, JSON.stringify(chunks));
    const titled = secs.filter((s) => s.title).length;
    const sample = chunks.slice(0, 40).map((c) => c.text).join(' ');
    console.log(`[${book}] cuerpo ${body} pt, ${titled} encabezados, ${chunks.length} fragmentos, idioma ${language(sample)}, ${(statSync(path).size / 1024).toFixed(0)} KB → ${path}`);
  }
}

if (/ingest-rules.ts$/.test(process.argv[1] ?? '')) main().catch((e) => { console.error(e); process.exit(1); });
