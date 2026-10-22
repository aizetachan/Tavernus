/**
 * Activos escritos: imágenes y planos hechos a mano por el equipo, que mandan
 * sobre lo generado (docs/ARTE.md). Cada campaña puede traer un manifiesto en
 *
 *   assets/campaigns/<carpeta>/manifest.json
 *
 * que dice qué fichero (relativo a esa carpeta) representa cada vista, retrato,
 * objeto o descubrimiento, y qué plano (datos LocationMap, no un dibujo) tiene
 * cada localización. `campaigns` lista los ids de campaña (`campaign.id`) a los
 * que sirve, así la misma carpeta vale para la demo y para Brezal escrito.
 *
 * Quien lo usa:
 *   - el ilustrador (src/ai/illustrate.ts): antes de pedir nada a una IA mira
 *     aquí; si hay activo escrito lo copia a la carpeta de imágenes de la
 *     partida y lo sirve como cualquier otra imagen (web por /images, Discord
 *     como adjunto);
 *   - la caché de planos (src/adapters/web/mapcache.ts): si la localización
 *     tiene plano escrito, se usa ese y no se genera.
 *
 * La carpeta no se sirve tal cual (no está en public/): así una vista del
 * sótano o un plano con la trampilla no se filtran antes de descubrirlos.
 * Hoy el servidor solo sirve JPEG, así que las imágenes se entregan en .jpg.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Id } from '../engine/model.js';
import type { LocationMap } from '../data/seed/maps.js';

/** Qué muestra una imagen escrita; los mismos nombres que `ImageKind` del ilustrador. */
export type AssetKind = 'scene' | 'portrait' | 'item' | 'discovery' | 'combat';

export interface AssetManifest {
  /** Ids de campaña a los que sirve. */
  campaigns: Id[];
  /** Carpeta del manifiesto (absoluta); la pone el cargador. */
  dir: string;
  /** Vistas por id de localización. */
  scene?: Record<Id, string>;
  /** Retratos por id de NPC, `master` (el narrador) o `pc:<race_id>-<class_id>` (PJ por raza y clase). */
  portrait?: Record<Id, string>;
  /** Objetos por id de definición (`it_…`). */
  item?: Record<Id, string>;
  /** Descubrimientos por punto oculto (`sp_…`) o pista (`clue_…`). */
  discovery?: Record<Id, string>;
  /** Escenas de combate por NPC (pocas veces hace falta). */
  combat?: Record<Id, string>;
  /** Mapa de región (imagen); la web aún no lo pinta. */
  region_map?: string;
  /** Planos a mano por localización, como datos. */
  maps?: Record<Id, LocationMap>;
  /** Fondo opcional de cada plano (imagen); el tablero aún no lo pinta. */
  map_backgrounds?: Record<Id, string>;
}

/** Formatos que el servidor sabe servir hoy. */
const SERVABLE = new Set(['.jpg', '.jpeg']);

/** Carpeta de activos: ASSETS_DIR o `assets/campaigns` en la raíz del repo (vale desde src/ y desde dist/). */
export function assetsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const custom = env['ASSETS_DIR']?.trim();
  return custom ? resolve(custom) : fileURLToPath(new URL('../../assets/campaigns/', import.meta.url));
}

const loaded = new Map<string, AssetManifest[]>();

/** Manifiestos bajo `root` (uno por subcarpeta con manifest.json). Se leen una vez por raíz. */
export function loadManifests(root: string = assetsRoot(), log: (m: string) => void = (m) => console.warn(m)): AssetManifest[] {
  const hit = loaded.get(root);
  if (hit) return hit;
  const out: AssetManifest[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { /* sin activos */ }
  for (const d of dirs) {
    const file = join(root, d, 'manifest.json');
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AssetManifest>;
      if (!Array.isArray(raw.campaigns) || !raw.campaigns.length) { log(`[activos] ${file}: falta "campaigns"`); continue; }
      out.push({ ...raw, campaigns: raw.campaigns, dir: join(root, d) });
    } catch (e) {
      log(`[activos] ${file}: ${(e as Error).message}`);
    }
  }
  loaded.set(root, out);
  return out;
}

/** Olvida lo leído (tests, o tras subir activos nuevos sin reiniciar). */
export function forgetManifests(): void { loaded.clear(); }

/** El manifiesto de esa campaña, si lo hay. */
export function assetsFor(campaignId: Id, root?: string): AssetManifest | null {
  return loadManifests(root).find((m) => m.campaigns.includes(campaignId)) ?? null;
}

/** Ruta absoluta de un fichero del manifiesto; null si se sale de su carpeta, no es servible o no existe. */
function fileOf(m: AssetManifest, rel: string | undefined): string | null {
  if (!rel) return null;
  const abs = resolve(m.dir, rel);
  if (!abs.startsWith(resolve(m.dir) + sep)) return null;
  if (!SERVABLE.has(extname(abs).toLowerCase())) return null;
  return existsSync(abs) ? abs : null;
}

/**
 * Imagen escrita para lo que se va a ilustrar: prueba los ids en orden (el de
 * la entidad primero, luego los alternativos, como `pc:human-fighter`).
 */
export function writtenImage(m: AssetManifest | null, kind: AssetKind | (string & {}), ids: Id[]): { id: Id; file: string; rel: string } | null {
  if (!m) return null;
  const table = m[kind as AssetKind];
  if (!table) return null;
  for (const id of ids) {
    const rel = table[id];
    const file = fileOf(m, rel);
    if (rel && file) return { id, file, rel };
  }
  return null;
}

/** Plano escrito de la localización; null si se genera. */
export function writtenMap(m: AssetManifest | null, locationId: Id): LocationMap | null {
  return m?.maps?.[locationId] ?? null;
}

/** Imagen del mapa de región, si la hay. */
export function writtenRegionMap(m: AssetManifest | null): string | null {
  return m ? fileOf(m, m.region_map) : null;
}

/** Fondo del plano de la localización, si lo hay. */
export function writtenMapBackground(m: AssetManifest | null, locationId: Id): string | null {
  return m ? fileOf(m, m.map_backgrounds?.[locationId]) : null;
}
