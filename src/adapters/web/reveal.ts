/**
 * Lo que cada PJ ha ido descubriendo del plano. Los muebles y elementos de un
 * punto no están a la vista desde el principio: aparecen cuando el PJ ha
 * interactuado con ese punto (ha estado allí o ha hecho algo allí). Suelos,
 * paredes, puertas, edificios y árboles del paisaje se ven siempre; los
 * objetos sueltos (ítems) nunca se dibujan, van en el tooltip.
 *
 * Uso en boardState, sobre el plano ya recortado por visibilidad:
 *   map: revealMap(plano, visible, revealTrackerOf(engine).seenBy(c.id), pos.spot_id)
 *
 * Memoria del proceso: se reconstruye con lo que pase desde que arranca el
 * servidor (más el punto actual de cada PJ). Persistirlo pide un campo en el
 * modelo del personaje.
 */

import type { Id, Spot, GameEvent, Character } from '../../engine/model.js';
import type { LocationMap, MapProp, PropKind } from '../../data/seed/maps.js';

/** Lo mínimo del motor que hace falta (para poder probarlo sin arrancar uno). */
export interface RevealEngine {
  events: { onEvent(l: (e: GameEvent) => void): unknown };
  world: {
    characters: Map<Id, Character>;
    characterSpot(c: Character): Spot | null;
    onChange(l: (ch: { collection: string; id: Id }) => void): unknown;
  };
}

/** Se ven sin haber interactuado: forman el paisaje, no son cosas del sitio. */
const ALWAYS: ReadonlySet<PropKind> = new Set<PropKind>(['building', 'tree', 'text']);

export class RevealTracker {
  private readonly seen = new Map<Id, Set<Id>>();

  constructor(engine: RevealEngine) {
    const world = engine.world;
    const markWhereIs = (c: Character) => { const s = world.characterSpot(c); if (s) this.mark(c.id, s.id); };
    for (const c of world.characters.values()) markWhereIs(c);
    // Cualquier cosa que haga el PJ en un punto (mirar, coger, hablar, llegar…).
    engine.events.onEvent((e) => { if (e.actor_id && e.spot_id) this.mark(e.actor_id, e.spot_id); });
    // Cada vez que cambia el PJ (llega a un tramo, se mueve), su punto actual.
    world.onChange((ch) => {
      if (ch.collection !== 'characters') return;
      const c = world.characters.get(ch.id);
      if (c) markWhereIs(c);
    });
  }

  mark(characterId: Id, spotId: Id): void {
    let s = this.seen.get(characterId);
    if (!s) { s = new Set(); this.seen.set(characterId, s); }
    s.add(spotId);
  }

  seenBy(characterId: Id): ReadonlySet<Id> {
    return this.seen.get(characterId) ?? new Set();
  }
}

const trackers = new WeakMap<object, RevealTracker>();

/** Un rastreador por motor, creado la primera vez que se pide. */
export function revealTrackerOf(engine: RevealEngine): RevealTracker {
  let t = trackers.get(engine);
  if (!t) { t = new RevealTracker(engine); trackers.set(engine, t); }
  return t;
}

/** Centro de un mueble, en metros. */
function centerOf(p: MapProp): [number, number] {
  if (p.r !== undefined) return [p.x, p.y];
  return [p.x + (p.w ?? 0) / 2, p.y + (p.h ?? 0) / 2];
}

/** Punto al que pertenece un mueble: el suyo si lo tiene; si no, el punto visible más cercano. */
export function ownerSpot(p: MapProp, visibleSpots: readonly Spot[]): Id | null {
  if (p.spot_id) return p.spot_id;
  const [x, y] = centerOf(p);
  let best: Spot | null = null;
  let bestD = Infinity;
  for (const s of visibleSpots) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best?.id ?? null;
}

/**
 * Deja en el plano solo los muebles de puntos con los que el PJ ha
 * interactuado (o del punto donde está ahora). Paredes, puertas y suelos no se
 * tocan.
 */
export function revealMap(map: LocationMap, visibleSpots: readonly Spot[], seen: ReadonlySet<Id>, hereSpotId: Id | null): LocationMap {
  const known = new Set(seen);
  if (hereSpotId) known.add(hereSpotId);
  const props = map.props.filter((p) => {
    if (ALWAYS.has(p.kind)) return true;
    const owner = ownerSpot(p, visibleSpots);
    return owner !== null && known.has(owner);
  });
  return { ...map, props };
}
