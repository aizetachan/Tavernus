/**
 * El catálogo común de objetos: el equipo del SRD (src/data/srd/items.ts) más
 * unas pocas cosas cotidianas que el SRD no trae y que usan la demo, Brezal y el
 * generador (leña, bayas, truchas, el hacha de leñador, el cofre de la posada) y
 * los cuartos de alquiler (worldgen/rooms.ts). PLAN-OBJETOS §3.
 *
 * Tres piezas para las partidas:
 *
 * - `catalogFor(genre)`: el catálogo de un género (nombres de ciencia ficción o
 *   postapocalípticos donde los hay, mismas reglas).
 * - `syncCatalog(snapshot)`: al arrancar (engine.ts, `migrate`), pone las
 *   definiciones SRD de la partida a la versión del código
 *   (`campaign.catalog_version`) y añade las que falten. Las propias de la campaña
 *   (`origin: 'custom'`, aunque usen un id del SRD) no se tocan.
 * - `compactSnapshot(snapshot)`: al guardar, quita las definiciones SRD que son
 *   iguales a las del código y que ningún objeto del mundo usa: el resto se lee
 *   del código al arrancar (`syncCatalog`). Así el catálogo entero no se copia en
 *   cada partida (unos 250 objetos, más de 100 KB por mundo).
 *
 * Los ids del catálogo no se borran nunca (una partida guardada puede nombrarlos
 * en un encargo, una tienda o un recurso sin tener el objeto).
 */

import type { ItemDef, WorldSnapshot } from '../engine/model.js';
import { ROOM_ITEMS } from '../worldgen/rooms.js';
import { SRD_CATALOG_VERSION, SRD_ITEM_IDS, srdCatalog, type CatalogGenre } from './srd/items.js';

export type { CatalogGenre } from './srd/items.js';
export { SRD_CATALOG_VERSION } from './srd/items.js';

/** Cosas de todos los días que el SRD no trae. Son de la casa (`custom`): las partidas las guardan. */
export const COMMON_ITEMS: readonly ItemDef[] = [
  { id: 'it_hacha', name: 'hacha de leñador', aliases: ['hacha', 'axe'], type: 'tool', size: 'medium', weight_lb: 4, value: 500, unique: false, weapon: { damage: '1d6', damage_type: 'slashing' }, description: 'Para cortar leña; en un apuro, también sirve de arma.', origin: 'custom' },
  { id: 'it_madera', name: 'leña', aliases: ['madera', 'tronco', 'wood', 'leños'], type: 'misc', size: 'medium', weight_lb: 5, value: 5, unique: false, origin: 'custom' },
  { id: 'it_bayas', name: 'bayas', aliases: ['baya', 'berries', 'frutos'], type: 'consumable', size: 'tiny', weight_lb: 0.1, value: 2, unique: false, origin: 'custom' },
  { id: 'it_pescado', name: 'trucha', aliases: ['pescado', 'pez', 'truchas', 'fish'], type: 'consumable', size: 'small', weight_lb: 1, value: 5, unique: false, origin: 'custom' },
  { id: 'it_cofre', name: 'cofre de la posada', aliases: ['cofre', 'arcón', 'chest'], type: 'container', size: 'bulky', weight_lb: 60, value: 0, unique: false, container: { slots: 30, max_weight_lb: 200, max_size: 'large', fixed: true }, origin: 'custom' },
];

/** Cachés: el catálogo de cada género no cambia en la vida del proceso. */
const FULL = new Map<CatalogGenre, readonly ItemDef[]>();

/** El catálogo común de un género: SRD, cosas de la casa y cuartos de alquiler. */
export function catalogFor(genre: CatalogGenre = 'fantasy'): readonly ItemDef[] {
  let list = FULL.get(genre);
  if (!list) { list = [...srdCatalog(genre), ...COMMON_ITEMS, ...ROOM_ITEMS]; FULL.set(genre, list); }
  return list;
}

/** El catálogo común en fantasía (el de la demo, Brezal y la creación de personaje). */
export const CATALOG: readonly ItemDef[] = catalogFor('fantasy');

/** El género del mundo para el catálogo: el del generador, o fantasía. */
export function catalogGenre(snap: Pick<WorldSnapshot, 'campaign'>): CatalogGenre {
  const g = snap.campaign.generation?.genre;
  return g === 'scifi' || g === 'postapoc' ? g : 'fantasy';
}

/** JSON con las claves ordenadas: dos definiciones iguales dan el mismo texto aunque el orden de sus campos cambie. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
    : x));
}

const CANON = new Map<CatalogGenre, Map<string, string>>();
function canonOf(genre: CatalogGenre): Map<string, string> {
  let m = CANON.get(genre);
  if (!m) { m = new Map(srdCatalog(genre).map((d) => [d.id, canonical(d)])); CANON.set(genre, m); }
  return m;
}

/**
 * Pone el catálogo SRD de la partida al día con el código. Si la versión de la
 * partida no es la del código, cada definición SRD guardada se cambia por la del
 * código (si cambia de nombre, el viejo queda de alias: el jugador lo conoce así);
 * siempre se añaden las que falten (no se guardan: ver `compactSnapshot`). Las
 * `custom` no se tocan. Devuelve si hay algo que guardar.
 */
export function syncCatalog(snap: WorldSnapshot): boolean {
  const genre = catalogGenre(snap);
  const outdated = snap.campaign.catalog_version !== SRD_CATALOG_VERSION;
  const index = new Map(snap.item_defs.map((d, i) => [d.id, i]));
  let changed = false;
  for (const code of srdCatalog(genre)) {
    const i = index.get(code.id);
    if (i === undefined) { snap.item_defs.push(structuredClone(code)); continue; }
    const cur = snap.item_defs[i]!;
    if (!outdated || cur.origin !== 'srd') continue;
    const next = structuredClone(code) as ItemDef;
    const old = cur.name.trim().toLowerCase();
    if (old && old !== next.name.toLowerCase() && !next.aliases.some((a) => a.toLowerCase() === old)) next.aliases.push(cur.name);
    if (canonical(next) !== canonical(cur)) { snap.item_defs[i] = next; changed = true; }
  }
  if (outdated) { snap.campaign.catalog_version = SRD_CATALOG_VERSION; changed = true; }
  return changed;
}

/**
 * El snapshot para guardar: sin las definiciones SRD que son iguales a las del
 * código y que ningún objeto del mundo usa. No cambia el mundo en memoria.
 */
export function compactSnapshot(snap: WorldSnapshot): WorldSnapshot {
  const canon = canonOf(catalogGenre(snap));
  const used = new Set(snap.item_instances.map((i) => i.item_id));
  const item_defs = snap.item_defs.filter((d) => {
    if (d.origin !== 'srd' || !SRD_ITEM_IDS.has(d.id) || used.has(d.id)) return true;
    return canon.get(d.id) !== canonical(d);
  });
  return item_defs.length === snap.item_defs.length ? snap : { ...snap, item_defs };
}
