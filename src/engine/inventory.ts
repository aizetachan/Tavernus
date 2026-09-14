/**
 * Inventario y capacidad (SPEC §5.2–§5.4). Nada es infinito. El servidor
 * decide si algo cabe; el master solo narra el resultado.
 */

import type { CarrySlot, Character, Id, ItemDef, ItemInstance, ItemSize, Placement, Spot } from './model.js';
import { EQUIP_SLOTS } from './model.js';
import { samePlacement, slotKey, type World } from './world.js';

const SIZE_RANK: Record<ItemSize, number> = { tiny: 0, small: 1, medium: 2, large: 3, bulky: 4 };

export type TransferError =
  | { code: 'not_found'; id: Id }
  | { code: 'bad_quantity' }
  | { code: 'not_reachable'; reason: string }
  | { code: 'fixed' }
  | { code: 'no_space'; reason: string; options: string[] }
  | { code: 'invalid_slot'; reason: string };

export type TransferResult =
  | { ok: true; moved: ItemInstance; remaining: ItemInstance | null }
  | { ok: false; error: TransferError };

export function sizeFits(item: ItemSize, max: ItemSize): boolean {
  return SIZE_RANK[item] <= SIZE_RANK[max];
}

/** Peso de un ejemplar (stack completo). */
export function instanceWeight(world: World, i: ItemInstance): number {
  const def = world.itemDef(i.item_id);
  let w = def.weight_lb * i.quantity;
  if (def.container) for (const inner of world.itemsIn({ type: 'container', id: i.id })) w += instanceWeight(world, inner);
  return w;
}

export interface Encumbrance {
  weight_lb: number;
  max_lb: number;
  level: 'ok' | 'encumbered' | 'heavily' | 'immobile';
  speed_penalty_ft: number;
}

export function encumbrance(world: World, c: Character): Encumbrance {
  const rules = world.campaign.capacity_rules;
  let weight = c.coins / rules.coins_per_lb;
  for (const i of directlyCarried(world, c.id)) weight += instanceWeight(world, i);
  const str = c.abilities.str;
  const max = str * rules.carry_per_str;
  let level: Encumbrance['level'] = 'ok';
  let penalty = 0;
  if (weight > max) { level = 'immobile'; penalty = c.speed_ft; }
  else if (weight > str * rules.heavily_at) { level = 'heavily'; penalty = 20; }
  else if (weight > str * rules.encumbered_at) { level = 'encumbered'; penalty = 10; }
  return { weight_lb: weight, max_lb: max, level, speed_penalty_ft: penalty };
}

/** Punto físico en el que está un destino. */
export function spotOfPlacement(world: World, p: Placement): Spot | null {
  switch (p.type) {
    case 'spot': return world.spots.get(p.id) ?? null;
    case 'character': { const c = world.characters.get(p.id); return c ? world.characterSpot(c) : null; }
    case 'npc': { const n = world.npcs.get(p.id); return n ? world.spots.get(n.location.id) ?? null : null; }
    case 'vehicle': { const v = world.vehicles.get(p.id); return v ? world.spots.get(v.location.id) ?? null : null; }
    case 'container': { const i = world.itemInstances.get(p.id); return i ? world.spotOfItem(i) : null; }
  }
}

/** Ítems que un PJ lleva directamente (sin bajar a contenedores). */
export function directlyCarried(world: World, characterId: Id): ItemInstance[] {
  return [...world.itemInstances.values()].filter((i) => i.location.type === 'character' && i.location.id === characterId);
}

function handsUsed(world: World, characterId: Id): Set<'main' | 'off'> {
  const used = new Set<'main' | 'off'>();
  for (const i of directlyCarried(world, characterId)) {
    if (i.location.type !== 'character' || i.location.slot.kind !== 'hand') continue;
    const w = i.location.slot.which;
    if (w === 'both') { used.add('main'); used.add('off'); } else used.add(w);
  }
  return used;
}

/**
 * Comprueba si `def × quantity` cabe en el destino. No muta nada.
 * Devuelve null si cabe, o el error explicando por qué no.
 */
export function checkFits(world: World, def: ItemDef, quantity: number, to: Placement, exclude?: Id): TransferError | null {
  const rules = world.campaign.capacity_rules;
  switch (to.type) {
    case 'spot': {
      if (!world.spots.has(to.id)) return { code: 'not_found', id: to.id };
      return null; // el suelo no se llena
    }
    case 'npc':
    case 'vehicle':
      return null; // capacidad de NPCs y vehículos: fase 3
    case 'container': {
      const cont = world.itemInstances.get(to.id);
      if (!cont) return { code: 'not_found', id: to.id };
      const cdef = world.itemDef(cont.item_id);
      if (!cdef.container) return { code: 'invalid_slot', reason: `${cdef.name} no es un contenedor` };
      if (def.size === 'bulky') return { code: 'no_space', reason: `${def.name} es demasiado voluminoso para cualquier contenedor`, options: ['llevarlo en las dos manos', 'dejarlo en el suelo'] };
      if (!sizeFits(def.size, cdef.container.max_size)) return { code: 'no_space', reason: `${def.name} no cabe en ${cdef.name} por tamaño`, options: ['llevarlo en la mano', 'dejarlo en el suelo'] };
      const inside = world.itemsIn(to).filter((i) => i.id !== exclude);
      const stacks = inside.length + (inside.some((i) => i.item_id === def.id && !def.unique) ? 0 : 1);
      if (stacks > cdef.container.slots) return { code: 'no_space', reason: `${cdef.name} está lleno`, options: ['sacar algo', 'llevarlo en la mano', 'dejarlo en el suelo'] };
      const weight = inside.reduce((a, i) => a + instanceWeight(world, i), 0) + def.weight_lb * quantity;
      if (weight > cdef.container.max_weight_lb) return { code: 'no_space', reason: `${cdef.name} no aguanta tanto peso`, options: ['sacar algo pesado', 'llevarlo en la mano'] };
      return null;
    }
    case 'character': {
      const c = world.characters.get(to.id);
      if (!c) return { code: 'not_found', id: to.id };
      const slot = to.slot;
      const carried = directlyCarried(world, c.id).filter((i) => i.id !== exclude);
      switch (slot.kind) {
        case 'hand': {
          const used = handsUsed(world, c.id);
          if (exclude) {
            const ex = world.itemInstances.get(exclude);
            if (ex && ex.location.type === 'character' && ex.location.id === c.id && ex.location.slot.kind === 'hand') {
              const w = ex.location.slot.which;
              if (w === 'both') { used.delete('main'); used.delete('off'); } else used.delete(w);
            }
          }
          if (def.size === 'bulky' && slot.which !== 'both') return { code: 'invalid_slot', reason: `${def.name} necesita las dos manos` };
          if (def.size !== 'bulky' && slot.which === 'both') return { code: 'invalid_slot', reason: `${def.name} se lleva con una mano` };
          if (quantity > 1 && !sizeFits(def.size, 'small')) return { code: 'invalid_slot', reason: 'solo puedes llevar uno en la mano' };
          const need: ('main' | 'off')[] = slot.which === 'both' ? ['main', 'off'] : [slot.which];
          for (const h of need) if (used.has(h)) return { code: 'no_space', reason: 'tienes las manos ocupadas', options: ['soltar lo que llevas', 'guardar algo'] };
          return null;
        }
        case 'pocket': {
          if (!sizeFits(def.size, 'small')) return { code: 'no_space', reason: `${def.name} no cabe en un bolsillo`, options: ['llevarlo en la mano', 'guardarlo en la mochila'] };
          const inPockets = carried.filter((i) => i.location.type === 'character' && i.location.slot.kind === 'pocket');
          const stacks = inPockets.length + (inPockets.some((i) => i.item_id === def.id && !def.unique) ? 0 : 1);
          if (stacks > rules.pockets_slots) return { code: 'no_space', reason: 'no te quedan bolsillos libres', options: ['guardarlo en la mochila', 'llevarlo en la mano'] };
          return null;
        }
        case 'equipped': {
          if (!EQUIP_SLOTS.includes(slot.slot)) return { code: 'invalid_slot', reason: `slot ${slot.slot} no existe` };
          if (def.equip_slot !== slot.slot) return { code: 'invalid_slot', reason: `${def.name} no se puede llevar en ${slot.slot}` };
          if (quantity !== 1) return { code: 'invalid_slot', reason: 'solo puedes equipar uno' };
          const busy = carried.some((i) => i.location.type === 'character' && slotKey(i.location.slot) === slotKey(slot));
          if (busy) return { code: 'no_space', reason: `ya llevas algo en ${slot.slot}`, options: ['quitártelo primero'] };
          return null;
        }
      }
    }
  }
}

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/**
 * Mueve `quantity` unidades de un ejemplar a un destino. Atómico: o se hace
 * entero o no se toca nada (SPEC §5.3). Un ítem siempre está en un solo sitio.
 *
 * Reglas:
 *  - Origen y destino deben compartir punto físico (nada se teletransporta).
 *  - Contenedores fijos (cofres, altares) no se mueven.
 *  - Nunca se mete un contenedor dentro de sí mismo ni de algo que contiene.
 *  - Los stacks del mismo ítem no único se fusionan en el destino.
 */
export function transferItem(world: World, instanceId: Id, to: Placement, quantity?: number): TransferResult {
  const inst = world.itemInstances.get(instanceId);
  if (!inst) return { ok: false, error: { code: 'not_found', id: instanceId } };
  const def = world.itemDef(inst.item_id);
  const qty = quantity ?? inst.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > inst.quantity) return { ok: false, error: { code: 'bad_quantity' } };
  if (def.container?.fixed) return { ok: false, error: { code: 'fixed' } };
  if (samePlacement(inst.location, to)) return { ok: false, error: { code: 'not_reachable', reason: 'ya está ahí' } };

  const fromSpot = world.spotOfItem(inst);
  const toSpot = spotOfPlacement(world, to);
  if (!fromSpot || !toSpot) return { ok: false, error: { code: 'not_reachable', reason: 'origen o destino sin posición' } };
  if (fromSpot.id !== toSpot.id) return { ok: false, error: { code: 'not_reachable', reason: 'no está a tu alcance' } };

  // Ciclos de contención.
  if (to.type === 'container') {
    let p: Placement = to;
    for (let g = 0; g < 32 && p.type === 'container'; g++) {
      if (p.id === inst.id) return { ok: false, error: { code: 'invalid_slot', reason: 'no puedes meter un contenedor dentro de sí mismo' } };
      p = world.itemInstance(p.id).location;
    }
  }

  const fits = checkFits(world, def, qty, to, inst.id);
  if (fits) return { ok: false, error: fits };

  // Fusionar con un stack existente del mismo ítem en el destino.
  const existing = !def.unique && Object.keys(inst.state).length === 0
    ? world.itemsIn(to).find((i) => i.id !== inst.id && i.item_id === inst.item_id && Object.keys(i.state).length === 0)
    : undefined;

  let moved: ItemInstance;
  let remaining: ItemInstance | null = null;
  if (qty === inst.quantity) {
    if (existing) {
      existing.quantity += qty;
      world.remove('item_instances', inst.id);
      world.touch('item_instances', existing.id);
      moved = existing;
    } else {
      inst.location = to;
      world.touch('item_instances', inst.id);
      moved = inst;
    }
  } else {
    inst.quantity -= qty;
    world.touch('item_instances', inst.id);
    remaining = inst;
    if (existing) {
      existing.quantity += qty;
      world.touch('item_instances', existing.id);
      moved = existing;
    } else {
      moved = { id: newId('ii'), item_id: inst.item_id, quantity: qty, location: to, state: {} };
      world.itemInstances.set(moved.id, moved);
      world.touch('item_instances', moved.id);
    }
  }
  return { ok: true, moved, remaining };
}

/** Crea un ejemplar nuevo en un destino (botín, recursos, tiendas). */
export function spawnItem(world: World, itemId: Id, quantity: number, to: Placement): TransferResult {
  const def = world.itemDef(itemId);
  const fits = checkFits(world, def, quantity, to);
  if (fits) return { ok: false, error: fits };
  const existing = !def.unique ? world.itemsIn(to).find((i) => i.item_id === itemId && Object.keys(i.state).length === 0) : undefined;
  if (existing) {
    existing.quantity += quantity;
    world.touch('item_instances', existing.id);
    return { ok: true, moved: existing, remaining: null };
  }
  const inst: ItemInstance = { id: newId('ii'), item_id: itemId, quantity, location: to, state: {} };
  world.itemInstances.set(inst.id, inst);
  world.touch('item_instances', inst.id);
  return { ok: true, moved: inst, remaining: null };
}

/** Inventario con identificadores, para el master: dónde está cada ejemplar. */
export function inventoryDetailed(world: World, characterId: Id): { instance_id: Id; item_id: Id; name: string; quantity: number; where: string }[] {
  const out: { instance_id: Id; item_id: Id; name: string; quantity: number; where: string }[] = [];
  const label = (s: CarrySlot) => s.kind === 'hand' ? (s.which === 'both' ? 'ambas manos' : s.which === 'main' ? 'mano principal' : 'mano secundaria') : s.kind === 'pocket' ? 'bolsillo' : `equipado:${s.slot}`;
  for (const i of directlyCarried(world, characterId)) {
    if (i.location.type !== 'character') continue;
    const def = world.itemDef(i.item_id);
    out.push({ instance_id: i.id, item_id: def.id, name: def.name, quantity: i.quantity, where: label(i.location.slot) });
    if (def.container) {
      for (const inner of world.itemsIn({ type: 'container', id: i.id })) {
        const d = world.itemDef(inner.item_id);
        out.push({ instance_id: inner.id, item_id: d.id, name: d.name, quantity: inner.quantity, where: `dentro de ${def.name} [${i.id}]` });
      }
    }
  }
  return out;
}

/** Vista resumida del inventario de un PJ, para /inventory y la hoja viva. */
export interface InventoryView {
  hands: { main: string | null; off: string | null };
  equipped: Partial<Record<string, string>>;
  pockets: string[];
  containers: { name: string; id: Id; items: string[] }[];
  coins: number;
  encumbrance: Encumbrance;
}

export function inventoryView(world: World, characterId: Id): InventoryView {
  const c = world.character(characterId);
  const view: InventoryView = { hands: { main: null, off: null }, equipped: {}, pockets: [], containers: [], coins: c.coins, encumbrance: encumbrance(world, c) };
  const label = (i: ItemInstance) => { const d = world.itemDef(i.item_id); return i.quantity > 1 ? `${d.name} ×${i.quantity}` : d.name; };
  for (const i of directlyCarried(world, c.id)) {
    if (i.location.type !== 'character') continue;
    const s = i.location.slot;
    const def = world.itemDef(i.item_id);
    if (s.kind === 'hand') {
      if (s.which === 'both') { view.hands.main = label(i); view.hands.off = label(i); } else view.hands[s.which] = label(i);
    } else if (s.kind === 'pocket') view.pockets.push(label(i));
    else view.equipped[s.slot] = label(i);
    if (def.container) view.containers.push({ name: def.name, id: i.id, items: world.itemsIn({ type: 'container', id: i.id }).map(label) });
  }
  return view;
}
