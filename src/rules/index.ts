/**
 * Índice local de reglas oficiales (PHB/DMG) generado por scripts/ingest-rules.ts.
 * Búsqueda léxica BM25 sobre tokens normalizados (sin acentos, minúsculas, stemming
 * ligero inglés/español). Sin embeddings ni llamadas externas: el máster solo recibe
 * unos pocos fragmentos recortados, nunca el manual.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type BookId = 'phb' | 'dmg';
export const BOOK_NAMES: Record<string, string> = { phb: "Player's Handbook", dmg: "Dungeon Master's Guide" };

export interface RuleChunk { id: string; book: string; title: string; page: number; text: string }
export interface RuleHit { id: string; book: string; title: string; page: number; text: string; score: number }

export interface RulesIndex {
  chunks: RuleChunk[];
  /** término → [índice de fragmento, frecuencia ponderada] */
  postings: Map<string, Array<[number, number]>>;
  tokens: string[][];
  lengths: number[];
  avgLen: number;
}

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;
const SNIPPET_CHARS = 600;

const STOPWORDS = new Set([
  // inglés
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'is', 'are', 'be', 'it', 'its', 'this', 'that',
  'you', 'your', 'can', 'if', 'do', 'does', 'how', 'what', 'when', 'which', 'who', 'into', 'than', 'then', 'there', 'their', 'they', 'them', 'has', 'have',
  // español
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'u', 'en', 'con', 'por', 'para', 'que', 'se', 'su', 'sus', 'es',
  'como', 'cuando', 'cual', 'quien', 'lo', 'le', 'les', 'mas', 'muy', 'sin', 'sobre', 'entre',
]);

/** Minúsculas y sin acentos ni diacríticos. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[’`´]/g, "'");
}

/** Stemming ligero, el mismo para inglés y español (se aplica igual a índice y consulta). */
export function stem(word: string): string {
  let w = word.replace(/'s$/, '').replace(/'/g, '');
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (/(ies|ied)$/.test(w) && w.length > 4) w = w.slice(0, -3) + 'y';
  else {
    const m = /(mente|ments|ment|iendo|ando|ados|adas|idos|idas|ings|ing|edly|ado|ada|ido|ida|ed|es|s)$/.exec(w);
    if (m) {
      const suf = m[1]!;
      const base = w.slice(0, -suf.length);
      const okS = suf !== 's' || !/(ss|us|is)$/.test(w);
      const okEs = suf !== 'es' || /[sxzh]$/.test(base);
      if (base.length >= 3 && okS && okEs) w = base;
      else if (suf === 'es' && w.length > 4) w = w.slice(0, -1); // "grapples" → "grapple", "acciones" → "accione"
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Tokens con su posición en el texto original (para recortar el fragmento). */
function scan(text: string): Array<{ term: string; start: number; end: number }> {
  const out: Array<{ term: string; start: number; end: number }> = [];
  for (const m of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
    const n = normalize(m[0]).replace(/^'+|'+$/g, '');
    if (!n || STOPWORDS.has(n)) continue;
    out.push({ term: stem(n), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function tokenize(text: string): string[] {
  return scan(text).map((t) => t.term);
}

export function buildIndex(chunks: RuleChunk[]): RulesIndex {
  const postings = new Map<string, Array<[number, number]>>();
  const tokens: string[][] = [];
  const lengths: number[] = [];
  chunks.forEach((c, i) => {
    const toks = tokenize(c.text);
    tokens.push(toks);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const titleToks = tokenize(c.title);
    for (const t of titleToks) tf.set(t, (tf.get(t) ?? 0) + TITLE_WEIGHT);
    lengths.push(toks.length + titleToks.length * TITLE_WEIGHT);
    for (const [t, n] of tf) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = []));
      p.push([i, n]);
    }
  });
  const avgLen = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  return { chunks, postings, tokens, lengths, avgLen };
}

let current: RulesIndex = buildIndex([]);

/** Carga todos los <libro>.json de dir. Si el directorio no existe o un fichero está roto, sigue sin fallar. */
export function loadRules(dir: string): RulesIndex {
  const chunks: RuleChunk[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
        if (!Array.isArray(data)) continue;
        for (const c of data as RuleChunk[]) if (c && typeof c.text === 'string') chunks.push({ id: String(c.id), book: String(c.book), title: String(c.title ?? ''), page: Number(c.page) || 0, text: c.text });
      } catch { /* fichero ilegible: se ignora */ }
    }
  }
  current = buildIndex(chunks);
  return current;
}

export interface SearchOptions { book?: string | null | undefined; limit?: number | undefined }

export function searchRules(query: string, opts: SearchOptions = {}, index: RulesIndex = current): RuleHit[] {
  const limit = Math.max(1, opts.limit ?? 3);
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || index.chunks.length === 0) return [];
  const N = index.chunks.length;
  const scores = new Map<number, number>();
  for (const t of terms) {
    const p = index.postings.get(t);
    if (!p) continue;
    const idf = Math.log(1 + (N - p.length + 0.5) / (p.length + 0.5));
    for (const [doc, tf] of p) {
      if (opts.book && index.chunks[doc]!.book !== opts.book) continue;
      const norm = tf + K1 * (1 - B + B * (index.lengths[doc]! / (index.avgLen || 1)));
      scores.set(doc, (scores.get(doc) ?? 0) + idf * ((tf * (K1 + 1)) / norm));
    }
  }
  // Bonus de proximidad: términos consecutivos de la consulta que aparecen juntos ("long rest").
  if (terms.length > 1) {
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
    const qt = tokenize(query);
    for (const [doc, s] of ranked) {
      const toks = index.tokens[doc]!;
      let pairs = 0;
      for (let i = 0; i + 1 < toks.length; i++) for (let q = 0; q + 1 < qt.length; q++) if (toks[i] === qt[q] && toks[i + 1] === qt[q + 1]) pairs++;
      const titleHit = qt.every((t) => tokenize(index.chunks[doc]!.title).includes(t));
      scores.set(doc, s * (1 + 0.15 * Math.min(pairs, 4) + (titleHit ? 0.3 : 0)));
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([doc, score]) => {
      const c = index.chunks[doc]!;
      return { id: c.id, book: c.book, title: c.title, page: c.page, text: snippet(c.text, terms), score: Math.round(score * 100) / 100 };
    });
}

/** Recorta ~600 caracteres alrededor de la zona con más términos de la consulta. */
export function snippet(text: string, terms: string[], max = SNIPPET_CHARS): string {
  if (text.length <= max) return text;
  const want = new Set(terms);
  const hits = scan(text).filter((t) => want.has(t.term));
  let center = 0;
  if (hits.length) {
    let best = -1;
    for (let i = 0; i < hits.length; i++) {
      const inWin = hits.filter((h) => h.start >= hits[i]!.start && h.end <= hits[i]!.start + max * 0.7);
      const score = new Set(inWin.map((h) => h.term)).size * 100 + inWin.length;
      if (score > best) { best = score; center = Math.round((hits[i]!.start + inWin.at(-1)!.end) / 2); }
    }
  }
  let start = Math.max(0, Math.min(center - Math.floor(max / 2), text.length - max));
  let end = Math.min(text.length, start + max);
  if (start > 0) { const sp = text.indexOf(' ', start); if (sp > 0 && sp < start + 40) start = sp + 1; }
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > end - 40) end = sp; }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Texto compacto para el máster: una cabecera por fragmento y el recorte. */
export function formatRuleHits(query: string, hits: RuleHit[], index: RulesIndex = current): string {
  if (index.chunks.length === 0) return 'No hay manuales indexados (falta ejecutar npm run rules:ingest). Resuelve con tu criterio y las reglas del contexto.';
  if (hits.length === 0) return `Sin resultados en los manuales para "${query}". Prueba con otros términos en inglés o resuelve con tu criterio.`;
  return hits.map((h) => `[${(BOOK_NAMES[h.book] ?? h.book)}, p. ${h.page}${h.title ? ` — ${h.title}` : ''}]\n${h.text}`).join('\n\n');
}
