/**
 * Caché de planos por localización, en memoria, una por motor. Guarda el plano
 * entero (con lo que pide puntos ocultos); el recorte por lo que ve cada PJ se
 * hace después, al servirlo.
 *
 * Se invalida sola: si cambian los puntos, las salidas, la localización o su
 * zona, se borra el plano de las localizaciones afectadas y se vuelve a hacer
 * en segundo plano. Y precarga: cuando un PJ llega a una localización o sale
 * de viaje, deja hechos los planos de las vecinas (a un salto por sus salidas)
 * y del destino, para que al cruzar la puerta el plano ya esté listo aunque
 * algún día lo genere algo lento.
 */

import type { Engine } from '../../engine/engine.js';
import type { Id } from '../../engine/model.js';
import { positionOf } from '../../engine/movement.js';
import type { LocationMap } from '../../data/seed/maps.js';
import { generateMap, mapInputOf } from './mapgen.js';
import { assetsFor, writtenMap } from '../../ai/assets.js';

export interface CachedMap {
  /** Plano entero, generado con la semilla de la campaña: sus límites no incluyen lo oculto y se amplían al descubrirlo. */
  map: LocationMap;
}

type EngineLike = Pick<Engine, 'world' | 'gameNow'>;

export class MapCache {
  private readonly maps = new Map<Id, CachedMap>();
  /** Punto, salida o localización → localizaciones cuyo plano depende de ello. */
  private readonly deps = new Map<Id, Set<Id>>();
  private readonly queued = new Set<Id>();
  private readonly off: () => void;
  /** Planos generados desde que existe la caché (para tests y diagnóstico). */
  generatedCount = 0;

  constructor(private readonly engine: EngineLike) {
    const world = engine.world;
    this.off = world.onChange(({ collection, id, doc }) => {
      switch (collection) {
        case 'spots': {
          const locs = new Set(this.deps.get(id));
          const s = doc as { location_id?: Id } | null;
          if (s?.location_id) locs.add(s.location_id);
          for (const l of locs) this.invalidate(l);
          return;
        }
        case 'exits': {
          const locs = new Set(this.deps.get(id));
          const e = doc as { from_spot_id?: Id; to_spot_id?: Id } | null;
          for (const sid of [e?.from_spot_id, e?.to_spot_id]) {
            const sp = sid ? world.spots.get(sid) : undefined;
            if (sp) locs.add(sp.location_id);
          }
          for (const l of locs) this.invalidate(l);
          return;
        }
        case 'locations':
          for (const l of new Set([id, ...(this.deps.get(id) ?? [])])) this.invalidate(l);
          return;
        case 'zones':
          for (const l of [...this.maps.keys()]) if (world.locations.get(l)?.zone_id === id) this.invalidate(l);
          return;
        case 'characters':
          this.preloadFor(id);
          return;
        case 'campaign':
          // La semilla del mundo puede haber cambiado: todos de nuevo.
          for (const l of [...this.maps.keys()]) this.invalidate(l);
          return;
      }
    });
  }

  dispose(): void { this.off(); }

  has(locationId: Id): boolean { return this.maps.has(locationId); }

  /** Plano de la localización: de la caché, o hecho ahora si no está. */
  get(locationId: Id): CachedMap {
    const hit = this.maps.get(locationId);
    if (hit) return hit;
    const built = this.build(locationId);
    this.maps.set(locationId, built);
    return built;
  }

  invalidate(locationId: Id): void {
    if (!this.maps.delete(locationId)) return;
    // Lo que estaba hecho sigue hecho: se rehace por detrás.
    this.queue([locationId]);
  }

  /** Localizaciones a un salto por las salidas de sus puntos (o solo de `fromSpots`). */
  neighborsOf(locationId: Id, fromSpots?: Set<Id>): Id[] {
    const world = this.engine.world;
    const own = new Set(world.spotsOf(locationId).map((s) => s.id).filter((s) => !fromSpots || fromSpots.has(s)));
    const out = new Set<Id>();
    for (const e of world.exits.values()) {
      let to: Id | null = null;
      if (own.has(e.from_spot_id)) to = e.to_spot_id;
      else if (e.bidirectional && own.has(e.to_spot_id)) to = e.from_spot_id;
      const loc = to ? world.spots.get(to)?.location_id : undefined;
      if (loc && loc !== locationId) out.add(loc);
    }
    return [...out].sort();
  }

  /**
   * Precarga lo que rodea al PJ: su localización, las vecinas y el destino si
   * va de viaje. Devuelve las que ha puesto en cola o ya tenía.
   */
  preloadFor(characterId: Id): Id[] {
    const world = this.engine.world;
    const c = world.characters.get(characterId);
    if (!c || c.status === 'dead' || c.status === 'retired') return [];
    let here: Id;
    try { here = positionOf(world, c, this.engine.gameNow()).location_id; } catch { return []; }
    const locs = [here, ...this.neighborsOf(here)];
    const dest = c.transit ? world.spots.get(c.transit.destination_spot_id)?.location_id : undefined;
    if (dest && !locs.includes(dest)) locs.push(dest);
    this.queue(locs);
    return locs;
  }

  /** Genera en segundo plano (tras el evento en curso) lo que falte. */
  queue(locationIds: Id[]): void {
    const todo = locationIds.filter((l) => !this.maps.has(l) && !this.queued.has(l) && this.engine.world.locations.has(l));
    if (!todo.length) return;
    for (const l of todo) this.queued.add(l);
    setImmediate(() => {
      for (const l of todo) {
        this.queued.delete(l);
        if (!this.engine.world.locations.has(l)) continue;
        try { this.get(l); } catch { /* se intentará al pedirlo */ }
      }
    });
  }

  private build(locationId: Id): CachedMap {
    // Plano escrito por el equipo (datos LocationMap del manifiesto de la campaña): manda sobre el generado.
    const campaign = this.engine.world.campaign.id;
    const written = writtenMap(assetsFor(campaign), campaign, locationId);
    if (written) return { map: structuredClone(written) };
    const input = mapInputOf(this.engine.world, locationId);
    for (const dep of [...input.spots.map((s) => s.id), ...(input.exits ?? []).flatMap((e) => [e.id, e.to_location_id])]) {
      let set = this.deps.get(dep);
      if (!set) this.deps.set(dep, (set = new Set()));
      set.add(locationId);
    }
    this.generatedCount++;
    return { map: generateMap(input) };
  }
}

const caches = new WeakMap<object, MapCache>();

/** La caché de planos de este motor (se crea la primera vez que se pide). */
export function mapCacheOf(engine: EngineLike): MapCache {
  let c = caches.get(engine);
  if (!c) caches.set(engine, (c = new MapCache(engine)));
  return c;
}
