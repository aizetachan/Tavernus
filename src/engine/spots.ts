/**
 * Los rincones que conoce cada PJ (docs/SPEC.md, §3.2, regla 4b).
 *
 * Un punto está en `discovered_by` del PJ cuando lo conoce. Al llegar a un
 * sitio conoce solo lo que se ve desde donde está:
 *
 *   - de un vistazo (`glanceSees`): los puntos con `visible_from` que incluye
 *     el suyo y, sin ese campo, los de la misma estancia (sin un enlace que
 *     tape la vista, `links[].blocks_sight`). Lo oculto, nunca;
 *   - mirando alrededor (`lookAround`): además los de la estancia que el
 *     vistazo no alcanza (`visible_from` deja fuera la mesa en penumbra) y lo
 *     oculto que su Percepción pasiva iguala (`dc_to_find`);
 *   - si alguien se lo nombra o lo cuenta la narración (`spotsNamedIn`);
 *   - buscando con una tirada (Percepción o Investigación contra la CD) o
 *     porque se lo enseñan: `discover_spot`.
 *
 * Sugerencias, tablero, mapa y contexto del máster solo usan lo conocido.
 * Andar hasta un punto no oculto que aún no conoce sí puede: al llegar, lo ve.
 */

import type { Character, Id, Spot, WorldSnapshot } from './model.js';
import type { World } from './world.js';

/** ¿Hay entre los dos puntos un enlace que tape la vista (en cualquiera de los dos sentidos)? */
function sightBlocked(a: Spot, b: Spot): boolean {
  const l = a.links.find((x) => x.to_spot_id === b.id) ?? b.links.find((x) => x.to_spot_id === a.id);
  return l?.blocks_sight === true;
}

/** ¿Se ve `to` de un vistazo desde `from`? */
export function glanceSees(from: Spot, to: Spot): boolean {
  if (from.id === to.id) return true;
  if (to.hidden) return false;
  if (to.visible_from) return to.visible_from.includes(from.id);
  return !sightBlocked(from, to);
}

/** ¿Lo ve mirando alrededor? Lo de la estancia, aunque el vistazo no lo alcance; lo oculto, no. */
function lookSees(from: Spot, to: Spot): boolean {
  return glanceSees(from, to) || (!to.hidden && !sightBlocked(from, to));
}

export function knowsSpot(c: Character, s: Spot): boolean {
  return s.discovered_by.includes(c.id);
}

/** Apunta el punto como conocido por el PJ. true si no lo conocía. */
export function discoverSpot(world: World, c: Character, s: Spot): boolean {
  if (s.discovered_by.includes(c.id)) return false;
  s.discovered_by.push(c.id);
  world.touch('spots', s.id);
  return true;
}

/** Lo que ve de un vistazo desde `at` (donde está o por donde pasa) queda conocido. Devuelve lo nuevo. */
export function seeFrom(world: World, c: Character, at: Spot): Spot[] {
  return world.spotsOf(at.location_id).filter((s) => glanceSees(at, s) && discoverSpot(world, c, s));
}

/** Lo que ve desde donde está. Dormido o en el suelo no ve nada. */
export function noteSight(world: World, c: Character): Spot[] {
  if (c.status !== 'active') return [];
  const at = world.characterSpot(c);
  return at ? seeFrom(world, c, at) : [];
}

/** Los puntos de un sitio que conoce el PJ (antes, apunta lo que tiene delante). */
export function knownSpots(world: World, c: Character, locationId: Id): Spot[] {
  noteSight(world, c);
  return world.spotsOf(locationId).filter((s) => knowsSpot(c, s));
}

/** Los que hay y aún no ha visto (no ocultos): los encuentra mirando alrededor o andando. */
export function unseenSpots(world: World, c: Character, locationId: Id): Spot[] {
  return world.spotsOf(locationId).filter((s) => !s.hidden && !knowsSpot(c, s));
}

/** Los ocultos que aún no ha encontrado: solo buscando o si se los enseñan. */
export function hiddenSpots(world: World, c: Character, locationId: Id): Spot[] {
  return world.spotsOf(locationId).filter((s) => s.hidden && !knowsSpot(c, s));
}

/** ¿Mirar alrededor le enseñaría algo que aún no ve (sin contar lo oculto)? */
export function lookWouldReveal(world: World, c: Character): boolean {
  const at = world.characterSpot(c);
  return !!at && unseenSpots(world, c, at.location_id).some((s) => lookSees(at, s));
}

/** Lo oculto que puede encontrar buscando desde donde está: lo de su estancia que aún no conoce. */
export function searchableSpots(world: World, c: Character): Spot[] {
  const at = world.characterSpot(c);
  if (!at) return [];
  return hiddenSpots(world, c, at.location_id).filter((s) => s.id === at.id || !sightBlocked(at, s));
}

/**
 * Mirar alrededor: lo de la estancia y lo oculto que alcanza su Percepción
 * pasiva (sin tirada). Devuelve lo que descubre.
 */
export function lookAround(world: World, c: Character): Spot[] {
  const at = world.characterSpot(c);
  if (!at) return [];
  return world.spotsOf(at.location_id).filter((s) => {
    const sees = lookSees(at, s) || (s.hidden && s.dc_to_find !== undefined && c.passive_perception >= s.dc_to_find && !sightBlocked(at, s));
    return sees && discoverSpot(world, c, s);
  });
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** El nombre de un punto sin el artículo: «la mesa del fondo» → «mesa del fondo». */
function bareName(s: Spot): string {
  return norm(s.name).replace(/^(el|la|los|las|un|una)\s+/, '').trim();
}

/** Puntos de un sitio que un texto nombra por su nombre («la trampilla de la mesa del fondo»): quien lo oye ya sabe que están. */
export function spotsNamedIn(world: World, locationId: Id, text: string): Spot[] {
  const t = norm(text);
  if (!t.trim()) return [];
  return world.spotsOf(locationId).filter((s) => {
    const n = bareName(s);
    return n.length >= 4 && new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(t);
  });
}

/**
 * Partidas de antes de que los rincones se descubrieran: cada PJ conserva los
 * puntos no ocultos de los sitios donde ha estado (y del que está). Una vez
 * por partida (`campaign.spot_sight`).
 */
export function migrateSpotSight(snap: WorldSnapshot): boolean {
  if (snap.campaign.spot_sight) return false;
  snap.campaign.spot_sight = true;
  const locOfSpot = new Map(snap.spots.map((s) => [s.id, s.location_id] as const));
  for (const c of snap.characters) {
    const here = c.location.type === 'spot' ? locOfSpot.get(c.location.id) : undefined;
    const been = new Set(snap.locations.filter((l) => l.discovery?.[c.id] === 'visited').map((l) => l.id));
    if (here) been.add(here);
    for (const s of snap.spots) if (!s.hidden && been.has(s.location_id) && !s.discovered_by.includes(c.id)) s.discovered_by.push(c.id);
  }
  return true;
}
