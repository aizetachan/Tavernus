/**
 * Mapa de misiones de la wiki, generado de los datos de la historia (story.ts), nunca dibujado a mano: qué misión
 * abre cuál, quién la da y dónde, el nivel que pide y si va por fases, con cuántas vías y desenlaces.
 *
 *   npm run wiki:misiones
 *
 * escribe `wiki/Imágenes/Mapa de misiones.svg` (se ve igual en Obsidian y en la web) y la sección «Todas las
 * misiones» de `wiki/Misiones/Mapa de misiones.md`. test/questmap.test.ts falla si no están al día.
 *
 * Sirve para cualquier historia (`questGraph(story, snapshot)`); la wiki es la de Brezal.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BREZAL } from '../data/campaigns/brezal/index.js';
import { expandAuthored } from '../data/campaigns/format.js';
import type { Id, WorldSnapshot } from '../engine/model.js';
import type { Story, StoryCondition, StoryQuest } from '../engine/story.js';
import { replaceSection } from './carries.js';

export interface QuestNode {
  id: Id;
  title: string;
  act: number;
  level: number;
  min_level: number;
  /** Principal: la de una situación inicial (la tiene desde el principio). */
  main: boolean;
  /** Final excluyente (grupo). */
  exclusive: string | null;
  /** Quién la da y dónde está al empezar («Brenna, en la barra (Taberna del Jabalí)»). */
  giver: string | null;
  where: string | null;
  /** Lo que pide para abrirse, en palabras («Ceniza se ha perdido» o la pista «…»). */
  requires: string | null;
  phases: number;
  secondary: number;
  ways: number;
  outcomes: number;
  /** Columna: cuántas misiones hay que cumplir antes, como mínimo, en la cadena más larga. */
  depth: number;
}

export interface QuestEdge { from: Id; to: Id; /** `any`: basta esta o la otra; `all`: hace falta. */ kind: 'all' | 'any' }

export interface QuestGraph { nodes: QuestNode[]; edges: QuestEdge[] }

/** Misiones que pide una condición, con si hace falta (all) o basta una (any). */
function questDeps(c: StoryCondition | undefined, mode: 'all' | 'any' = 'all'): { id: Id; kind: 'all' | 'any' }[] {
  if (!c) return [];
  switch (c.kind) {
    case 'quest': return [{ id: c.quest_id, kind: mode }];
    case 'all': return c.of.flatMap((x) => questDeps(x, mode));
    case 'any': return c.of.flatMap((x) => questDeps(x, c.of.length > 1 ? 'any' : mode));
    default: return [];
  }
}

/** El requisito en palabras, para la tabla. */
function describe(c: StoryCondition, snap: WorldSnapshot, title: (id: Id) => string): string {
  const npc = (id: Id) => snap.npcs.find((n) => n.id === id)?.name ?? id;
  switch (c.kind) {
    case 'quest': return `«${title(c.quest_id)}»`;
    case 'clue': return `la pista «${snap.campaign.clues.find((x) => x.id === c.clue_id)?.title ?? c.clue_id}»`;
    case 'level': return `nivel ${c.at_least}`;
    case 'knows': return `conocer a ${npc(c.npc_id)}`;
    case 'trust': return `que ${npc(c.npc_id)} se fíe (${c.at_least})`;
    case 'reputation': return `reputación ${c.at_least}`;
    case 'fact': return `que haya pasado «${c.id}»`;
    case 'step': return `un paso de «${title(c.quest_id)}»`;
    case 'any': return c.of.map((x) => describe(x, snap, title)).join(' o ');
    case 'all': return c.of.map((x) => describe(x, snap, title)).join(' y ');
    case 'not': return `que no: ${describe(c.of, snap, title)}`;
    default: return c.kind;
  }
}

export function questGraph(story: Story, snap: WorldSnapshot): QuestGraph {
  const byId = new Map(story.quests.map((q) => [q.id, q]));
  const title = (id: Id) => byId.get(id)?.title ?? id;
  const edges: QuestEdge[] = [];
  for (const q of story.quests) {
    const seen = new Set<Id>();
    for (const d of questDeps(q.requires)) if (byId.has(d.id) && !seen.has(d.id)) { seen.add(d.id); edges.push({ from: d.id, to: q.id, kind: d.kind }); }
  }
  // Columna: la cadena más larga de misiones que hay que cumplir antes.
  const depth = new Map<Id, number>();
  const depthOf = (id: Id, stack: Set<Id> = new Set()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const d = Math.max(0, ...edges.filter((e) => e.to === id).map((e) => depthOf(e.from, stack) + 1));
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  const spotName = (id: Id) => snap.spots.find((s) => s.id === id);
  const nodes = story.quests.map((q: StoryQuest): QuestNode => {
    const g = q.giver_npc_id ? snap.npcs.find((n) => n.id === q.giver_npc_id) : undefined;
    const sp = g ? spotName(g.location.id) : undefined;
    const loc = sp ? snap.locations.find((l) => l.id === sp.location_id) : undefined;
    const steps = [...q.steps, ...(q.on_npc_dead ?? []).flatMap((r) => (r.outcome === 'reroute' ? r.steps ?? [] : []))];
    return {
      id: q.id, title: q.title, act: q.act, level: q.level, min_level: q.min_level ?? 1, main: !!q.main_for?.length, exclusive: q.exclusive ?? null,
      giver: g ? g.name : null, where: sp ? `${sp.name}${loc ? ` (${loc.name})` : ''}` : null,
      requires: q.requires ? describe(q.requires, snap, title) : null,
      phases: (q.phases ?? []).filter((p) => !p.secondary).length, secondary: (q.phases ?? []).filter((p) => p.secondary).length,
      ways: steps.reduce((n, s) => n + (s.ways?.length ?? 0), 0), outcomes: q.outcomes?.length ?? 0, depth: depthOf(q.id),
    };
  });
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const W = 270, H = 100, GAP_X = 86, GAP_Y = 16, PAD = 28, HEAD = 64;
const ACT_COLOR: Record<number, string> = { 1: '#6fae8a', 2: '#d29a4a', 3: '#c8605a' };
const MAIN_COLOR = '#8f8ad6';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Columnas: las principales a la izquierda; las demás, por la cadena de misiones que piden antes. */
function columns(g: QuestGraph): { title: string; ids: Id[] }[] {
  const others = g.nodes.filter((n) => !n.main);
  const max = Math.max(0, ...others.map((n) => n.depth));
  const names = ['Desde el principio', 'Tras una misión', 'Tras dos misiones', 'Tras tres misiones', 'Tras cuatro misiones'];
  const cols = [{ title: 'Principales (según la situación)', ids: g.nodes.filter((n) => n.main).map((n) => n.id) }];
  for (let d = 0; d <= max; d++) cols.push({ title: names[d] ?? `Tras ${d} misiones`, ids: others.filter((n) => n.depth === d).map((n) => n.id) });
  // Menos cruces: cada misión, a la altura media de las que la abren (en orden de acto si no hay).
  const row = new Map<Id, number>();
  for (const col of cols) {
    const key = (id: Id) => {
      const from = g.edges.filter((e) => e.to === id).map((e) => row.get(e.from)).filter((x): x is number => x !== undefined);
      const n = g.nodes.find((x) => x.id === id)!;
      return from.length ? from.reduce((a, b) => a + b, 0) / from.length : n.act * 100 + g.nodes.indexOf(n) / 100;
    };
    col.ids.sort((a, b) => key(a) - key(b));
    col.ids.forEach((id, i) => row.set(id, i));
  }
  return cols.filter((c) => c.ids.length);
}

export function questMapSvg(g: QuestGraph, caption: string): string {
  const cols = columns(g);
  const rows = Math.max(...cols.map((c) => c.ids.length));
  const width = PAD * 2 + cols.length * W + (cols.length - 1) * GAP_X;
  const legendH = 70;
  const height = PAD + HEAD + rows * (H + GAP_Y) + legendH;
  const pos = new Map<Id, { x: number; y: number }>();
  cols.forEach((c, ci) => c.ids.forEach((id, ri) => pos.set(id, { x: PAD + ci * (W + GAP_X), y: PAD + HEAD + ri * (H + GAP_Y) })));
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Georgia, 'Times New Roman', serif">`);
  out.push(`<title>${esc(caption)}</title>`);
  out.push('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#b9ad94"/></marker></defs>');
  out.push(`<rect width="${width}" height="${height}" fill="#1c1a16"/>`);
  out.push(`<text x="${PAD}" y="${PAD + 4}" font-size="18" fill="#efe6d2" font-weight="bold">${esc(caption)}</text>`);
  cols.forEach((c, ci) => out.push(`<text x="${PAD + ci * (W + GAP_X)}" y="${PAD + 40}" font-size="12" fill="#b9ad94" letter-spacing="1">${esc(c.title.toUpperCase())}</text>`));
  // Flechas: de quien abre a lo que abre.
  for (const e of g.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 4, y2 = b.y + H / 2, mid = (x1 + x2) / 2;
    out.push(`<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" fill="none" stroke="#b9ad94" stroke-width="1.6"${e.kind === 'any' ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#arrow)" opacity="0.85"/>`);
  }
  for (const n of g.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const color = n.main ? MAIN_COLOR : ACT_COLOR[n.act] ?? '#999';
    const level = n.min_level < n.level ? `Nivel ${n.level} (desde ${n.min_level})` : `Nivel ${n.level}`;
    const act = n.main ? 'Principal' : `Acto ${['', 'I', 'II', 'III'][n.act]}`;
    const head = n.main ? level : `${act}. ${level}`;
    const extra = [n.phases ? `${n.phases} fases${n.secondary ? ` + ${n.secondary} secundaria${n.secondary > 1 ? 's' : ''}` : ''}` : '', n.ways ? `${n.ways} vías` : '', n.outcomes ? `${n.outcomes} desenlaces` : '', n.exclusive ? 'final excluyente' : ''].filter(Boolean).join(', ');
    const who = n.giver ? `Lo pide ${n.giver}` : 'La tiene desde el principio';
    const where = n.giver && n.where ? `En ${n.where}` : n.main ? 'Según la situación inicial' : '';
    out.push(`<g transform="translate(${p.x},${p.y})">`);
    out.push(`<rect width="${W}" height="${H}" rx="8" fill="#2a2620" stroke="${color}" stroke-width="${n.exclusive ? 2.4 : 1.4}"/>`);
    out.push(`<rect width="6" height="${H}" rx="3" fill="${color}"/>`);
    out.push(`<text x="16" y="21" font-size="13.5" font-weight="bold" fill="#efe6d2">${esc(clip(n.title, 30))}</text>`);
    out.push(`<text x="16" y="39" font-size="11" fill="#cfc4ad">${esc(clip(head, 44))}</text>`);
    out.push(`<text x="16" y="55" font-size="11" fill="#cfc4ad">${esc(clip(who, 44))}</text>`);
    if (where) out.push(`<text x="16" y="70" font-size="11" fill="#cfc4ad">${esc(clip(where, 46))}</text>`);
    if (extra) out.push(`<text x="16" y="88" font-size="10.5" fill="${color}">${esc(clip(extra, 48))}</text>`);
    out.push('</g>');
  }
  // Leyenda.
  const ly = height - legendH + 18;
  const item = (x: number, color: string, label: string) => `<rect x="${x}" y="${ly - 10}" width="12" height="12" rx="2" fill="${color}"/><text x="${x + 18}" y="${ly}" font-size="12" fill="#cfc4ad">${esc(label)}</text>`;
  out.push(item(PAD, MAIN_COLOR, 'Principal'), item(PAD + 110, ACT_COLOR[1]!, 'Acto I'), item(PAD + 200, ACT_COLOR[2]!, 'Acto II'), item(PAD + 295, ACT_COLOR[3]!, 'Acto III'));
  out.push(`<line x1="${PAD + 400}" y1="${ly - 4}" x2="${PAD + 440}" y2="${ly - 4}" stroke="#b9ad94" stroke-width="1.6" marker-end="url(#arrow)"/><text x="${PAD + 448}" y="${ly}" font-size="12" fill="#cfc4ad">hace falta para abrirla</text>`);
  out.push(`<line x1="${PAD + 610}" y1="${ly - 4}" x2="${PAD + 650}" y2="${ly - 4}" stroke="#b9ad94" stroke-width="1.6" stroke-dasharray="6 5" marker-end="url(#arrow)"/><text x="${PAD + 658}" y="${ly}" font-size="12" fill="#cfc4ad">basta una de ellas</text>`);
  out.push(`<text x="${PAD}" y="${ly + 26}" font-size="11" fill="#8f856f">${esc('Generado de los datos de la historia (src/wiki/questmap.ts). El nivel entre paréntesis es el mínimo para que te la pidan.')}</text>`);
  out.push('</svg>');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Tabla
// ---------------------------------------------------------------------------

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function questTable(g: QuestGraph): string {
  const opens = (id: Id) => g.edges.filter((e) => e.from === id).map((e) => `«${g.nodes.find((n) => n.id === e.to)!.title}»`);
  const order = [...g.nodes].sort((a, b) => Number(b.main) - Number(a.main) || a.act - b.act || a.depth - b.depth);
  const rows = order.map((n) => {
    const act = n.main ? 'Principal' : ['', 'I', 'II', 'III'][n.act]!;
    const level = n.min_level < n.level ? `${n.level} (desde ${n.min_level})` : `${n.level}`;
    const who = n.giver ? `${n.giver}${n.where ? `, en ${n.where}` : ''}` : 'Desde el principio';
    const shape = [n.phases ? `${n.phases} fases${n.secondary ? ` y ${n.secondary} secundaria${n.secondary > 1 ? 's' : ''}` : ''}` : '', n.ways ? `${n.ways} vías` : '', n.outcomes ? `${n.outcomes} desenlaces` : '', n.exclusive ? 'final excluyente' : ''].filter(Boolean).join(', ');
    return `| ${cell(n.title)} | ${act} | ${level} | ${cell(who)} | ${cell(n.requires ?? 'Nada')} | ${cell(opens(n.id).join(', ') || 'Nada')} | ${cell(shape || 'Pasos')} |`;
  });
  return [
    '*Sale de los datos de la historia: no se edita a mano (`npm run wiki:misiones`).*',
    '',
    '| Misión | Acto | Nivel | Quién la pide y dónde | Se abre con | Abre | Forma |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Brezal
// ---------------------------------------------------------------------------

export const MAP_SVG = 'wiki/Imágenes/Mapa de misiones.svg';
export const MAP_PAGE = 'wiki/Misiones/Mapa de misiones.md';
export const TABLE_SECTION = 'Todas las misiones';

/** El mapa de Brezal: la campaña recién empezada (los NPC en su sitio de salida). */
export function brezalQuestMap(): { svg: string; table: string } {
  const snap = expandAuthored(BREZAL, new Date(Date.UTC(2026, 0, 1, 12)));
  const story = (snap.campaign as WorldSnapshot['campaign'] & { story: Story }).story;
  const g = questGraph(story, snap);
  return { svg: questMapSvg(g, 'Brezal: mapa de misiones'), table: questTable(g) };
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? '.');
  const { svg, table } = brezalQuestMap();
  await writeFile(resolve(root, MAP_SVG), svg, 'utf8');
  const page = resolve(root, MAP_PAGE);
  await writeFile(page, replaceSection(await readFile(page, 'utf8'), TABLE_SECTION, table), 'utf8');
  console.log(`[wiki] mapa de misiones: ${MAP_SVG} y la tabla de ${MAP_PAGE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
