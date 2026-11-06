/**
 * Pasar mundos de partida entre ficheros JSON y la base (WORLD_STORE=pg; docs/DESPLIEGUE.md, «El mundo en la
 * base»). Nunca escribe en la carpeta de origen; `to-json` no pisa una carpeta con mundo sin `--force`.
 *
 *   npm run world-store -- to-pg <carpeta-de-datos> [--campaign <id>] [--key <world_id>]
 *   npm run world-store -- to-json <world_id> <carpeta-de-datos> [--force]
 *   npm run world-store -- check <carpeta-de-datos> [--campaign <id>] [--key <world_id>]
 *   npm run world-store -- games [GAMES_DIR]        todas las partidas (su mundo, foto de arranque y lo grabado)
 *
 * En el VPS, con lo compilado: node dist/index.js --world-store <orden> …
 * La base: DATABASE_URL (o --db <url>); sin ella, el PGlite local de GAMES_DIR/.pgdata, el mismo que usa la web
 * en modo `open`.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dbUrlFromEnv, describeDbUrl, openDb, type Db } from '../db/db.js';
import { DbCatalog } from '../db/catalog.js';
import { FileCatalog } from './catalog.js';
import type { GameManifest } from './manager.js';
import { readJsonWorld, writeJsonWorld } from '../persistence/jsonfile.js';
import { exportWorld, hasWorld, importWorld, type WorldDump } from '../persistence/pg.js';
import { splitDiagnostics } from '../persistence/diagnostics.js';
import { worldKey } from './worlds.js';

const USAGE = `Uso:
  world-store to-pg <carpeta-de-datos> [--campaign <id>] [--key <world_id>]
  world-store to-json <world_id> <carpeta-de-datos> [--force]
  world-store check <carpeta-de-datos> [--campaign <id>] [--key <world_id>]
  world-store games [GAMES_DIR]
Opciones: --db <url> (si no, DATABASE_URL o PGlite en GAMES_DIR/.pgdata).`;

/** La campaña de una carpeta de datos: la del único <id>.world.json que haya. */
export function campaignOf(dir: string): string {
  const ids = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.world.json')).map((f) => f.slice(0, -'.world.json'.length)) : [];
  if (ids.length !== 1) throw new Error(ids.length ? `${dir} tiene varios mundos (${ids.join(', ')}): di cuál con --campaign` : `no hay ningún <id>.world.json en ${dir}`);
  return ids[0]!;
}

/** JSON con las claves ordenadas: para comparar sin que importe el orden de las claves (JSONB lo cambia). */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** Diferencias entre dos mundos enteros (vacío si son el mismo). */
export function compareWorlds(a: WorldDump, b: WorldDump): string[] {
  const out: string[] = [];
  const sa = a.snapshot as unknown as Record<string, unknown>, sb = b.snapshot as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    const x = sa[k], y = sb[k];
    if (canon(x) === canon(y)) continue;
    if (Array.isArray(x) && Array.isArray(y)) {
      const ids = (l: unknown[]) => l.map((d) => (d as { id: string }).id);
      if (canon(ids(x)) !== canon(ids(y))) { out.push(`${k}: distinto orden o distintas entidades`); continue; }
      const bad = x.filter((d, i) => canon(d) !== canon(y[i])).map((d) => (d as { id: string }).id);
      out.push(`${k}: ${bad.length} distintas (${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''})`);
    } else out.push(`${k}: distinto`);
  }
  if (a.events.length !== b.events.length) out.push(`eventos: ${a.events.length} frente a ${b.events.length}`);
  else {
    const bad = a.events.filter((e, i) => canon(e) !== canon(b.events[i])).map((e) => e.seq);
    if (bad.length) out.push(`eventos: ${bad.length} distintos (seq ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''})`);
  }
  if (canon(a.tickers) !== canon(b.tickers)) out.push('tickers: distintos');
  return out;
}

/** Sin eventos con seq repetido (la base se queda con el primero): para comparar lo que de verdad se pasó. */
function dedupe(w: WorldDump): WorldDump {
  const seen = new Set<number>();
  return { ...w, events: w.events.filter((e) => !seen.has(e.seq) && Boolean(seen.add(e.seq))) };
}

function size(w: WorldDump): string {
  const light = w.events.reduce((n, e) => n + JSON.stringify(splitDiagnostics(e).event).length, 0);
  return `${w.snapshot.characters.length} PJ, ${w.snapshot.npcs.length} NPC, ${w.events.length} eventos (${(light / 1024).toFixed(0)} KB sin el contexto del máster)`;
}

export async function worldStoreCommand(argv: string[], env: NodeJS.ProcessEnv, log: (m: string) => void = (m) => console.log(m)): Promise<number> {
  const at = argv.indexOf('--world-store');
  const { values, positionals } = parseArgs({
    args: at >= 0 ? argv.slice(at + 1) : argv,
    allowPositionals: true,
    options: { campaign: { type: 'string' }, key: { type: 'string' }, db: { type: 'string' }, force: { type: 'boolean' } },
  });
  const [cmd, ...rest] = positionals;
  const gamesRoot = resolve(cmd === 'games' && rest[0] ? rest[0] : env['GAMES_DIR'] ?? './data/games');
  const url = values.db ?? dbUrlFromEnv(env, gamesRoot, 'open');
  if (!cmd || !['to-pg', 'to-json', 'check', 'games'].includes(cmd) || !url) { log(USAGE); return 2; }
  const db = await openDb(url);
  log(`[mundos] base: ${describeDbUrl(url)}`);
  try {
    if (cmd === 'to-pg' || cmd === 'check') {
      const dir = resolve(rest[0] ?? '');
      if (!rest[0]) { log(USAGE); return 2; }
      const campaign = values.campaign ?? campaignOf(dir);
      const key = values.key ?? campaign;
      const w = readJsonWorld(dir, campaign);
      if (!w) { log(`[mundos] no hay mundo «${campaign}» en ${dir}`); return 1; }
      if (cmd === 'to-pg') {
        const r = await importWorld(db, key, w);
        log(`[mundos] ${dir} → «${key}»: ${size(w)}${r.skipped ? `; ${r.skipped} eventos con seq repetido, fuera` : ''}`);
      }
      return await check(db, key, w, log);
    }
    if (cmd === 'to-json') {
      const [key, out] = rest;
      if (!key || !out) { log(USAGE); return 2; }
      const w = await exportWorld(db, key);
      if (!w) { log(`[mundos] no hay mundo «${key}» en la base`); return 1; }
      const dir = resolve(out);
      if (existsSync(join(dir, `${w.snapshot.campaign.id}.world.json`)) && !values.force) {
        log(`[mundos] ${dir} ya tiene un mundo «${w.snapshot.campaign.id}»; para sustituirlo, --force`);
        return 1;
      }
      await writeJsonWorld(dir, w);
      log(`[mundos] «${key}» → ${dir}: ${size(w)}`);
      const back = readJsonWorld(dir, w.snapshot.campaign.id)!;
      const diff = compareWorlds(w, back);
      for (const d of diff) log(`  ✗ ${d}`);
      return diff.length ? 1 : 0;
    }
    return await games(db, gamesRoot, log);
  } finally {
    await db.close();
  }
}

async function check(db: Db, key: string, w: WorldDump, log: (m: string) => void): Promise<number> {
  const back = await exportWorld(db, key);
  if (!back) { log(`[mundos] «${key}» no está en la base`); return 1; }
  const diff = compareWorlds(dedupe(w), back);
  if (!diff.length) { log(`[mundos] «${key}»: el mismo mundo en los ficheros y en la base`); return 0; }
  for (const d of diff) log(`  ✗ ${d}`);
  return 1;
}

/** Todas las partidas del catálogo (la base y las carpetas): el mundo de cada una, su foto de arranque y lo grabado. */
async function games(db: Db, root: string, log: (m: string) => void): Promise<number> {
  const bySlug = new Map<string, GameManifest>();
  for (const m of await new FileCatalog(root).all()) bySlug.set(m.slug, m);
  for (const m of await new DbCatalog(db, root).all()) bySlug.set(m.slug, m);
  let bad = 0, moved = 0;
  for (const m of bySlug.values()) {
    const dir = join(root, m.slug);
    const data = resolve(dir, m.data_dir);
    const places: [string, string][] = [[worldKey(m.slug, 'data'), data], [worldKey(m.slug, 'initial'), join(dir, 'initial')], [worldKey(m.slug, 'recorded'), join(dir, 'recorded')]];
    for (const [key, folder] of places) {
      const w = readJsonWorld(folder, m.campaign_id);
      if (!w) continue;
      if (await hasWorld(db, key)) { log(`[mundos] «${key}» ya está en la base: no se toca`); continue; }
      await importWorld(db, key, w);
      moved++;
      log(`[mundos] ${folder} → «${key}»: ${size(w)}`);
      bad += await check(db, key, w, log);
    }
  }
  log(`[mundos] ${moved} mundos pasados a la base${bad ? `, ${bad} con diferencias` : ''}`);
  return bad ? 1 : 0;
}
