/**
 * Planos escritos de una campaña: congelarlos y sacar sus referencias para pintar el fondo (docs/ARTE.md).
 *
 *   node --import tsx scripts/plans.ts freeze [campaña]      copia los planos generados al manifiesto ("maps")
 *   node --import tsx scripts/plans.ts freeze [campaña] --sync  tras cambiar la campaña: rehace lo cambiado, quita lo que ya no está
 *   node --import tsx scripts/plans.ts reference [campaña]   dibuja cada plano del manifiesto sin cuadrícula
 *   node --import tsx scripts/plans.ts format [campaña]      reescribe el manifiesto con el formato de freeze
 *
 * Incluye los tramos de camino (travel.ts): los crea igual que el motor, uno por cada salida entre localizaciones
 * de al menos MIN_DISTANCE_M (las únicas donde puede haber un encuentro), para dejarlos congelados y pintados.
 *
 * `freeze` guarda el plano entero con límites que ya incluyen lo oculto y todos los puntos: así el tablero no
 * crece al descubrir algo y el fondo pintado encaja siempre en el mismo rectángulo. No pisa un plano que ya esté
 * en el manifiesto (con --force, sí).
 *
 * `reference` deja en <carpeta>/plano/referencia/ dos ficheros por localización, a la medida del fondo
 * (40 px por metro, máx. 2048 px de lado):
 *   <loc>.png        suelos lisos, paredes, puertas y muebles, sin cuadrícula ni fichas ni lo oculto: la base para pintar;
 *   <loc>-guia.png   lo mismo con cada punto marcado y su nombre, para saber qué es cada cosa.
 * Necesita Google Chrome para pasar el SVG a PNG; si no lo encuentra, deja solo los .svg.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { World } from '../src/engine/world.js';
import { generateMap, mapInputOf } from '../src/adapters/web/mapgen.js';
import { clipMap } from '../src/adapters/web/board.js';
import { assetsRoot } from '../src/ai/assets.js';
import { ensureWaypoint, MIN_DISTANCE_M } from '../src/engine/travel.js';
import type { LocationMap, MapPoint, MapProp } from '../src/data/seed/maps.js';

const [cmd, campaign = 'brezal', ...flags] = process.argv.slice(2);
const dir = join(assetsRoot(), campaign);
const manifestFile = join(dir, 'manifest.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Píxeles por metro del fondo y lado máximo (docs/ARTE.md). */
const PX_PER_M = 40, MAX_SIDE = 2048;

const world = new World(authoredSeed(campaign));
// Tramos de camino posibles: uno por salida larga entre dos localizaciones.
for (const ex of [...world.exits.values()]) {
  // Una salida bloqueada (el Cerco de Ceniza) no se recorre: no hay viaje ni encuentro en ella.
  if (ex.state['blocked_by'] || ex.state['locked']) continue;
  if (ex.distance_m >= MIN_DISTANCE_M && world.locationOfSpot(ex.from_spot_id).id !== world.locationOfSpot(ex.to_spot_id).id) ensureWaypoint(world, ex.id);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { maps?: Record<string, LocationMap>; [k: string]: unknown };

/**
 * Sin --sync: congela lo que aún no está (lo escrito no se toca; --force lo rehace todo).
 * Con --sync (tras cambiar los datos de la campaña): lo que sigue igual se queda con su fondo; lo que ha cambiado se
 * vuelve a congelar y pierde el fondo, que ya no encajaría (hay que repintarlo); lo que ya no existe se quita.
 */
function freeze(): void {
  const maps = (manifest.maps ??= {});
  const backgrounds = (manifest['map_backgrounds'] ??= {}) as Record<string, string>;
  const sync = flags.includes('--sync');
  for (const loc of world.locations.values()) {
    const base = generateMap(mapInputOf(world, loc.id));
    const fresh = { ...base, bounds: clipMap(base, world.spotsOf(loc.id)).bounds };
    const old = maps[loc.id];
    if (old && JSON.stringify(old) === JSON.stringify(fresh)) { console.log(`${loc.id}: igual`); continue; }
    if (old && !sync && !flags.includes('--force')) { console.log(`${loc.id}: ya escrito, no se toca`); continue; }
    maps[loc.id] = fresh;
    const stale = old && backgrounds[loc.id];
    if (stale) delete backgrounds[loc.id];
    console.log(`${loc.id}: ${old ? 'cambiado, congelado de nuevo' : 'congelado'}, ${r1(fresh.bounds.w)} × ${r1(fresh.bounds.h)} m${stale ? ' (fondo quitado: hay que repintarlo)' : ''}`);
  }
  if (sync) {
    for (const id of Object.keys(maps)) {
      if (world.locations.has(id)) continue;
      delete maps[id];
      delete backgrounds[id];
      console.log(`${id}: ya no existe, quitado`);
    }
  }
  writeFileSync(manifestFile, pretty(manifest) + '\n');
}

/** JSON legible: lo que cabe en una línea (un punto, un mueble) va en una línea. */
function pretty(v: unknown, indent = ''): string {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || flat.length + indent.length <= 120) return flat;
  const inner = indent + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(',\n')}\n${indent}}`;
}

function reference(): void {
  const out = join(dir, 'plano', 'referencia');
  mkdirSync(out, { recursive: true });
  const chrome = existsSync(CHROME);
  for (const [id, map] of Object.entries(manifest.maps ?? {})) {
    if (!world.locations.has(id)) { console.warn(`${id}: no está en la campaña`); continue; }
    const k = Math.min(PX_PER_M, MAX_SIDE / Math.max(map.bounds.w, map.bounds.h));
    const W = Math.round(map.bounds.w * k), H = Math.round(map.bounds.h * k);
    for (const guide of [false, true]) {
      const name = guide ? `${id}-guia` : id;
      writeFileSync(join(out, `${name}.svg`), svg(map, world.spotsOf(id), k, W, H, guide));
      if (chrome) shot(join(out, `${name}.svg`), join(out, `${name}.png`), W, H);
    }
    console.log(`${id}: ${W} × ${H} px (${r1(k)} px/m)`);
  }
}

/** SVG a PNG con Chrome sin ventana, al tamaño exacto. */
function shot(svgFile: string, pngFile: string, W: number, H: number): void {
  const html = svgFile.replace(/\.svg$/, '.html');
  writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:#000}</style>${readFileSync(svgFile, 'utf8')}`);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, `--screenshot=${pngFile}`, `file://${html}`], { stdio: 'ignore' });
  execFileSync('rm', [html]);
}

// --- Dibujo: el de renderBoard (src/adapters/web/page.ts) sin cuadrícula, fichas, salidas ni velo de luz. ---

const GROUND: Record<string, { base: string; line?: string; dot?: string }> = {
  void: { base: '#15110d' }, wood: { base: '#6a4f35', line: '#4f3a26' }, stone: { base: '#55504a', line: '#3f3b36' },
  cobble: { base: '#5f5850', dot: '#4a443e' }, grass: { base: '#46542f', dot: '#3a4727' }, dirt: { base: '#7a6243', dot: '#665136' },
  water: { base: '#2f5566', line: '#4f7a8a' },
};

/** Suelo liso, sin el dibujo de losas o tablas: que la referencia no parezca una cuadrícula. */
function flat(ground: string): string { return (GROUND[ground] ?? GROUND['void']!).base; }

function r1(n: number): number { return Math.round(n * 10) / 10; }
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function svg(m: LocationMap, spots: { id: string; name: string; x: number; y: number; hidden?: boolean }[], k: number, W: number, H: number, guide: boolean): string {
  const bd = m.bounds;
  const X = (x: number) => (x - bd.x) * k, Y = (y: number) => (bd.y + bd.h - y) * k;
  const poly = (pts: MapPoint[]) => pts.map((q, i) => (i ? 'L' : 'M') + r1(X(q[0])) + ' ' + r1(Y(q[1]))).join(' ');
  const shown = <T extends { requires_spot?: string }>(xs: T[]) => xs.filter((x) => !x.requires_spot);
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  o.push(`<rect width="${W}" height="${H}" fill="${flat(m.background)}"/>`);
  for (const a of shown(m.areas)) {
    if (a.polygon) o.push(`<path d="${poly(a.polygon)} Z" fill="${flat(a.ground)}"/>`);
    else if (a.path) o.push(`<path d="${poly(a.path)}" fill="none" stroke="${flat(a.ground)}" stroke-width="${r1((a.width || 1.5) * k)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const props = shown(m.props).filter((p) => p.kind !== 'text');
  for (const p of props) if (p.kind === 'building') o.push(propSvg(p, X, Y, k));
  for (const p of props) if (p.kind !== 'building') o.push(propSvg(p, X, Y, k));
  const ww = r1(Math.max(4, 0.32 * k));
  for (const w of shown(m.walls)) o.push(`<path d="${poly(w.points)}" fill="none" stroke="#0e0a07" stroke-width="${ww}" stroke-linecap="square" stroke-linejoin="miter"/>`);
  for (const d of shown(m.doors)) {
    o.push(`<path d="${poly([d.from, d.to])}" stroke="#0e0a07" stroke-width="${r1(ww * 0.9)}"/>`);
    o.push(`<path d="${poly([d.from, d.to])}" stroke="#a07a4a" stroke-width="${r1(ww * 0.5)}"/>`);
  }
  if (guide) {
    for (const p of shown(m.props)) if ((p.kind === 'building' || p.kind === 'text') && p.label) {
      const cx = p.kind === 'building' ? p.x + (p.w || 0) / 2 : p.x, cy = p.kind === 'building' ? p.y + (p.h || 0) / 2 : p.y;
      o.push(`<text x="${r1(X(cx))}" y="${r1(Y(cy))}" font-family="sans-serif" font-size="14" font-style="italic" text-anchor="middle" fill="#cfc4ae" stroke="#000" stroke-width="3" paint-order="stroke">${esc(p.label)}</text>`);
    }
    const fs = r1(Math.max(12, Math.min(18, 0.45 * k)));
    for (const s of spots) {
      const color = s.hidden ? '#e07a62' : '#f0c060';
      o.push(`<circle cx="${r1(X(s.x))}" cy="${r1(Y(s.y))}" r="${r1(Math.max(5, 0.3 * k))}" fill="${color}" stroke="#000" stroke-width="2"/>`);
      o.push(`<text x="${r1(X(s.x))}" y="${r1(Y(s.y) - Math.max(9, 0.45 * k))}" font-family="sans-serif" font-size="${fs}" font-weight="700" text-anchor="middle" fill="${color}" stroke="#000" stroke-width="3" paint-order="stroke">${esc(s.name + (s.hidden ? ' (oculto)' : ''))}</text>`);
    }
  }
  o.push('</svg>');
  return o.join('');
}

function propSvg(p: MapProp, X: (x: number) => number, Y: (y: number) => number, k: number): string {
  const W = (m: number) => r1(m * k);
  const R = (x: number, y: number, w: number, h: number, fill: string, stroke?: string | null, sw?: number, extra = '') =>
    `<rect x="${r1(X(x))}" y="${r1(Y(y + h))}" width="${W(w)}" height="${W(h)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : ''}${extra}/>`;
  const C = (x: number, y: number, r: number, fill: string, stroke?: string, sw?: number) =>
    `<circle cx="${r1(X(x))}" cy="${r1(Y(y))}" r="${r1(Math.max(1.5, r * k))}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : ''}/>`;
  const w = p.w || 0, h = p.h || 0, r = p.r || 0;
  switch (p.kind) {
    case 'table': return R(p.x, p.y, w, h, '#7d5b3a', '#2a1d12', 1.2);
    case 'chair': return R(p.x, p.y, w, h, '#5d4229', '#2a1d12', 1);
    case 'counter': return R(p.x, p.y, w, h, '#5a3d24', '#1e140c', 1.5);
    case 'shelf': return R(p.x, p.y, w, h, '#3d2b1b', '#1e140c', 1);
    case 'round_table': return C(p.x, p.y, r, '#7d5b3a', '#2a1d12', 1.2);
    case 'stool': return C(p.x, p.y, r, '#5d4229', '#2a1d12', 1);
    case 'barrel': return C(p.x, p.y, r, '#7a5532', '#2a1d12', 1.2) + C(p.x, p.y, r * 0.55, 'none', '#4a321c', 1);
    case 'crate': return R(p.x, p.y, w, h, '#86663f', '#2a1d12', 1.2) +
      `<path d="M${r1(X(p.x))} ${r1(Y(p.y))} L${r1(X(p.x + w))} ${r1(Y(p.y + h))} M${r1(X(p.x + w))} ${r1(Y(p.y))} L${r1(X(p.x))} ${r1(Y(p.y + h))}" stroke="#4a321c" stroke-width="1"/>`;
    case 'fireplace': return R(p.x, p.y, w, h, '#3b3532', '#1a1715', 1.5) + R(p.x + w * 0.2, p.y + h * 0.1, w * 0.6, h * 0.5, '#c4602a', null, 0, ' opacity=".85"') +
      C(p.x + w / 2, p.y + h * 0.35, Math.min(w, h) * 0.18, '#f0a24a');
    case 'bed': return R(p.x, p.y, w, h, '#6b5a4a', '#2a1d12', 1.2) + R(p.x + w * 0.1, p.y + h * 0.72, w * 0.8, h * 0.2, '#d9cdb5') + R(p.x + w * 0.05, p.y + h * 0.05, w * 0.9, h * 0.6, '#5a4a6e', null, 0, ' opacity=".8"');
    case 'chest': return R(p.x, p.y, w, h, '#7a5532', '#2a1d12', 1.2) + R(p.x + w * 0.42, p.y + h * 0.3, w * 0.16, h * 0.4, '#c9a85b');
    case 'rug': return R(p.x, p.y, w, h, '#7a3b2c', '#c9a85b', 1, ' opacity=".85"') + R(p.x + w * 0.1, p.y + h * 0.15, w * 0.8, h * 0.7, 'none', '#c9a85b', 0.8, ' opacity=".7"');
    case 'trapdoor': return R(p.x, p.y, w, h, '#4a3420', '#1e140c', 1.5) + C(p.x + w / 2, p.y + h * 0.75, Math.min(w, h) * 0.12, 'none', '#9a8a70', 1.2);
    case 'stairs': {
      let s = R(p.x, p.y, w, h, '#5a4430', '#1e140c', 1.2);
      for (let i = 1; i < 8; i++) s += `<line x1="${r1(X(p.x))}" x2="${r1(X(p.x + w))}" y1="${r1(Y(p.y + h * i / 8))}" y2="${r1(Y(p.y + h * i / 8))}" stroke="#2a1d12" stroke-width="1"/>`;
      return s;
    }
    case 'well': return C(p.x, p.y, r, '#6d6a66', '#2b2926', 2) + C(p.x, p.y, r * 0.6, '#1d2a30', '#2b2926', 1);
    case 'notice': return R(p.x, p.y, w, h, '#9a7a4e', '#2a1d12', 1.2);
    case 'building': return R(p.x, p.y, w, h, '#2c2420', '#0f0b08', 2.5);
    case 'tree': return C(p.x, p.y, r, '#2f3f22', '#1f2a16', 1.5) + C(p.x - r * 0.25, p.y + r * 0.2, r * 0.55, '#3a4d2a') + C(p.x, p.y, Math.max(0.25, r * 0.12), '#4a3420');
    case 'rock': return `<ellipse cx="${r1(X(p.x))}" cy="${r1(Y(p.y))}" rx="${W(r)}" ry="${W(r * 0.72)}" fill="#77756c" stroke="#3d3c37" stroke-width="1.5"/>`;
    case 'bush': return C(p.x, p.y, r, '#3e5230', '#26331d', 1) + C(p.x - r * 0.3, p.y, r * 0.15, '#8a2f3a') + C(p.x + r * 0.3, p.y + r * 0.25, r * 0.15, '#8a2f3a');
  }
  return '';
}

if (cmd === 'freeze') freeze();
else if (cmd === 'reference') reference();
else if (cmd === 'format') writeFileSync(manifestFile, pretty(manifest) + '\n');
else { console.error('Uso: plans.ts freeze|reference|format [campaña] [--force]'); process.exit(1); }
