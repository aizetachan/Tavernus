/**
 * Mundo en memoria (SPEC §14.2.5). Carga un snapshot, mantiene índices y
 * avisa de cada cambio para que la capa de persistencia lo escriba.
 */

import type {
  Campaign, CarrySlot, Character, Exit, Id, ItemDef, ItemInstance, Location, Npc,
  Placement, Region, ResourceNode, Spot, Vehicle, WorldSnapshot, Zone,
} from './model.js';

export type Collection =
  | 'campaign' | 'regions' | 'zones' | 'locations' | 'spots' | 'exits'
  | 'characters' | 'npcs' | 'vehicles' | 'item_defs' | 'item_instances' | 'resource_nodes';

export interface ChangeListener {
  (change: { collection: Collection; id: Id; doc: unknown | null }): void;
}

export class World {
  readonly campaign: Campaign;
  readonly regions = new Map<Id, Region>();
  readonly zones = new Map<Id, Zone>();
  readonly locations = new Map<Id, Location>();
  readonly spots = new Map<Id, Spot>();
  readonly exits = new Map<Id, Exit>();
  readonly characters = new Map<Id, Character>();
  readonly npcs = new Map<Id, Npc>();
  readonly vehicles = new Map<Id, Vehicle>();
  readonly itemDefs = new Map<Id, ItemDef>();
  readonly itemInstances = new Map<Id, ItemInstance>();
  readonly resourceNodes = new Map<Id, ResourceNode>();

  private listeners: ChangeListener[] = [];

  constructor(snapshot: WorldSnapshot) {
    this.campaign = snapshot.campaign;
    for (const r of snapshot.regions) this.regions.set(r.id, r);
    for (const z of snapshot.zones) this.zones.set(z.id, z);
    for (const l of snapshot.locations) this.locations.set(l.id, l);
    for (const s of snapshot.spots) this.spots.set(s.id, s);
    for (const e of snapshot.exits) this.exits.set(e.id, e);
    for (const c of snapshot.characters) this.characters.set(c.id, c);
    for (const n of snapshot.npcs) this.npcs.set(n.id, n);
    for (const v of snapshot.vehicles) this.vehicles.set(v.id, v);
    for (const d of snapshot.item_defs) this.itemDefs.set(d.id, d);
    for (const i of snapshot.item_instances) this.itemInstances.set(i.id, i);
    for (const n of snapshot.resource_nodes) this.resourceNodes.set(n.id, n);
    this.validate();
  }

  onChange(l: ChangeListener): () => void {
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }

  /** Marca un documento como modificado (ya mutado en sitio). */
  touch(collection: Collection, id: Id): void {
    const doc = this.get(collection, id);
    for (const l of this.listeners) l({ collection, id, doc });
  }

  remove(collection: Collection, id: Id): void {
    this.map(collection).delete(id);
    for (const l of this.listeners) l({ collection, id, doc: null });
  }

  private get(collection: Collection, id: Id): unknown | null {
    if (collection === 'campaign') return this.campaign;
    return this.map(collection).get(id) ?? null;
  }

  private map(collection: Exclude<Collection, 'campaign'> | 'campaign'): Map<Id, unknown> {
    switch (collection) {
      case 'regions': return this.regions;
      case 'zones': return this.zones;
      case 'locations': return this.locations;
      case 'spots': return this.spots;
      case 'exits': return this.exits;
      case 'characters': return this.characters;
      case 'npcs': return this.npcs;
      case 'vehicles': return this.vehicles;
      case 'item_defs': return this.itemDefs;
      case 'item_instances': return this.itemInstances;
      case 'resource_nodes': return this.resourceNodes;
      case 'campaign': throw new Error('campaign is not a map');
    }
  }

  // --- Lookups con error claro -------------------------------------------

  spot(id: Id): Spot { return must(this.spots.get(id), 'spot', id); }
  location(id: Id): Location { return must(this.locations.get(id), 'location', id); }
  zone(id: Id): Zone { return must(this.zones.get(id), 'zone', id); }
  exit(id: Id): Exit { return must(this.exits.get(id), 'exit', id); }
  character(id: Id): Character { return must(this.characters.get(id), 'character', id); }
  npc(id: Id): Npc { return must(this.npcs.get(id), 'npc', id); }
  vehicle(id: Id): Vehicle { return must(this.vehicles.get(id), 'vehicle', id); }
  itemDef(id: Id): ItemDef { return must(this.itemDefs.get(id), 'item_def', id); }
  itemInstance(id: Id): ItemInstance { return must(this.itemInstances.get(id), 'item_instance', id); }
  resourceNode(id: Id): ResourceNode { return must(this.resourceNodes.get(id), 'resource_node', id); }

  locationOfSpot(spotId: Id): Location { return this.location(this.spot(spotId).location_id); }

  spotsOf(locationId: Id): Spot[] {
    return [...this.spots.values()].filter((s) => s.location_id === locationId);
  }

  exitsFrom(spotId: Id): { exit: Exit; to_spot_id: Id }[] {
    const out: { exit: Exit; to_spot_id: Id }[] = [];
    for (const e of this.exits.values()) {
      if (e.from_spot_id === spotId) out.push({ exit: e, to_spot_id: e.to_spot_id });
      else if (e.bidirectional && e.to_spot_id === spotId) out.push({ exit: e, to_spot_id: e.from_spot_id });
    }
    return out;
  }

  /** PJs cuyo punto actual es `spotId` (a pie o a bordo de un vehículo que está ahí). */
  charactersAt(spotId: Id): Character[] {
    return [...this.characters.values()].filter((c) => this.characterSpot(c)?.id === spotId);
  }

  charactersAboard(vehicleId: Id): Character[] {
    return [...this.characters.values()].filter((c) => c.location.type === 'vehicle' && c.location.id === vehicleId);
  }

  charactersInLocation(locationId: Id): Character[] {
    return [...this.characters.values()].filter((c) => this.characterSpot(c)?.location_id === locationId);
  }

  npcsAt(spotId: Id): Npc[] {
    return [...this.npcs.values()].filter((n) => n.location.id === spotId);
  }

  /** Punto en el que está un PJ, resolviendo si va a bordo de un vehículo. */
  characterSpot(c: Character): Spot | null {
    if (c.location.type === 'spot') return this.spots.get(c.location.id) ?? null;
    const v = this.vehicles.get(c.location.id);
    return v ? this.spots.get(v.location.id) ?? null : null;
  }

  itemsIn(p: Placement): ItemInstance[] {
    return [...this.itemInstances.values()].filter((i) => samePlacement(i.location, p));
  }

  /** Todo lo que lleva un PJ, en cualquier slot y en cualquier contenedor anidado. */
  itemsCarriedBy(characterId: Id): ItemInstance[] {
    const direct = [...this.itemInstances.values()].filter(
      (i) => i.location.type === 'character' && i.location.id === characterId,
    );
    const out = [...direct];
    const queue = direct.filter((i) => this.itemDef(i.item_id).container);
    while (queue.length) {
      const c = queue.pop()!;
      for (const i of this.itemsIn({ type: 'container', id: c.id })) {
        out.push(i);
        if (this.itemDef(i.item_id).container) queue.push(i);
      }
    }
    return out;
  }

  /** Punto en el que acaba estando un ítem, subiendo por contenedores. */
  spotOfItem(i: ItemInstance): Spot | null {
    let p: Placement = i.location;
    for (let guard = 0; guard < 32; guard++) {
      switch (p.type) {
        case 'spot': return this.spots.get(p.id) ?? null;
        case 'character': {
          const c = this.characters.get(p.id);
          return c ? this.characterSpot(c) : null;
        }
        case 'npc': { const n = this.npcs.get(p.id); return n ? this.spots.get(n.location.id) ?? null : null; }
        case 'vehicle': { const v = this.vehicles.get(p.id); return v ? this.spots.get(v.location.id) ?? null : null; }
        case 'container': { const c = this.itemInstances.get(p.id); if (!c) return null; p = c.location; break; }
      }
    }
    return null;
  }

  snapshot(): WorldSnapshot {
    return {
      campaign: this.campaign,
      regions: [...this.regions.values()],
      zones: [...this.zones.values()],
      locations: [...this.locations.values()],
      spots: [...this.spots.values()],
      exits: [...this.exits.values()],
      characters: [...this.characters.values()],
      npcs: [...this.npcs.values()],
      vehicles: [...this.vehicles.values()],
      item_defs: [...this.itemDefs.values()],
      item_instances: [...this.itemInstances.values()],
      resource_nodes: [...this.resourceNodes.values()],
    };
  }

  /** Comprobaciones de integridad referencial al cargar. Falla pronto. */
  private validate(): void {
    for (const z of this.zones.values()) must(this.regions.get(z.region_id), 'region', z.region_id);
    for (const l of this.locations.values()) {
      must(this.zones.get(l.zone_id), 'zone', l.zone_id);
      const d = must(this.spots.get(l.default_spot_id), 'spot', l.default_spot_id);
      if (d.location_id !== l.id) throw new Error(`default_spot ${d.id} not in location ${l.id}`);
    }
    for (const s of this.spots.values()) {
      must(this.locations.get(s.location_id), 'location', s.location_id);
      for (const ln of s.links) must(this.spots.get(ln.to_spot_id), 'spot', ln.to_spot_id);
    }
    for (const e of this.exits.values()) {
      const a = must(this.spots.get(e.from_spot_id), 'spot', e.from_spot_id);
      const b = must(this.spots.get(e.to_spot_id), 'spot', e.to_spot_id);
      if (a.location_id === b.location_id) throw new Error(`exit ${e.id} joins spots of the same location`);
    }
    for (const c of this.characters.values()) {
      if (c.location.type === 'spot') must(this.spots.get(c.location.id), 'spot', c.location.id);
      else must(this.vehicles.get(c.location.id), 'vehicle', c.location.id);
    }
    for (const n of this.npcs.values()) must(this.spots.get(n.location.id), 'spot', n.location.id);
    for (const v of this.vehicles.values()) must(this.spots.get(v.location.id), 'spot', v.location.id);
    for (const i of this.itemInstances.values()) {
      must(this.itemDefs.get(i.item_id), 'item_def', i.item_id);
      if (i.quantity < 1) throw new Error(`item_instance ${i.id} has quantity ${i.quantity}`);
      const p = i.location;
      switch (p.type) {
        case 'spot': must(this.spots.get(p.id), 'spot', p.id); break;
        case 'character': must(this.characters.get(p.id), 'character', p.id); break;
        case 'npc': must(this.npcs.get(p.id), 'npc', p.id); break;
        case 'vehicle': must(this.vehicles.get(p.id), 'vehicle', p.id); break;
        case 'container': {
          const c = must(this.itemInstances.get(p.id), 'item_instance', p.id);
          if (!this.itemDef(c.item_id).container) throw new Error(`item ${c.id} is not a container`);
          if (c.id === i.id) throw new Error(`item ${i.id} contains itself`);
          break;
        }
      }
    }
    for (const n of this.resourceNodes.values()) {
      must(this.spots.get(n.spot_id), 'spot', n.spot_id);
      must(this.itemDefs.get(n.resource_item_id), 'item_def', n.resource_item_id);
    }
    if (this.campaign.starting_points.length === 0) throw new Error('campaign has no starting points');
    for (const p of this.campaign.starting_points) must(this.spots.get(p.spot_id), 'spot', p.spot_id);
  }
}

/** Igualdad de emplazamiento. Para PJs distingue el slot (mano, bolsillo, equipado). */
export function samePlacement(a: Placement, b: Placement): boolean {
  if (a.type !== b.type || a.id !== b.id) return false;
  if (a.type === 'character' && b.type === 'character') return slotKey(a.slot) === slotKey(b.slot);
  return true;
}

export function slotKey(s: CarrySlot): string {
  switch (s.kind) {
    case 'hand': return `hand:${s.which}`;
    case 'pocket': return 'pocket';
    case 'equipped': return `equipped:${s.slot}`;
  }
}

function must<T>(v: T | undefined, kind: string, id: Id): T {
  if (v === undefined) throw new Error(`${kind} not found: ${id}`);
  return v;
}
