/**
 * Inventario y capacidad (SPEC §5.2–§5.4). Nada es infinito. El servidor
 * decide si algo cabe; el master solo narra el resultado.
 */

import type { CarrySlot, Character, EquipSlot, Id, ItemDef, ItemInstance, ItemSize, Placement, Spot } from './model.js';
import { EQUIP_SLOTS } from './model.js';
import { coinPieces, currencyOf } from './money.js';
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
  // Pesan las piezas (15 de oro), no el valor en cobre (1500).
  let weight = coinPieces(c.coins, currencyOf(world.campaign)) / rules.coins_per_lb;
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
/** Huecos de equipo en castellano, para los avisos. */
const SLOT_ES: Record<string, string> = { head: 'la cabeza', body: 'el cuerpo', hands: 'las manos (guantes)', feet: 'los pies', neck: 'el cuello', ring1: 'un dedo', ring2: 'un dedo', back: 'la espalda', belt: 'el cinturón' };

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
          if (def.equip_slot !== slot.slot) return { code: 'invalid_slot', reason: `${def.name} no se puede llevar en ${SLOT_ES[slot.slot] ?? slot.slot}` };
          if (quantity !== 1) return { code: 'invalid_slot', reason: 'solo puedes equipar uno' };
          const busy = carried.some((i) => i.location.type === 'character' && slotKey(i.location.slot) === slotKey(slot));
          if (busy) return { code: 'no_space', reason: `ya llevas algo en ${SLOT_ES[slot.slot] ?? slot.slot}`, options: ['quitártelo primero'] };
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

/** Gasta unidades de un ejemplar (se bebe, se come, se quema): baja la cantidad y, a cero, desaparece. Devuelve lo que queda. */
export function consumeItem(world: World, instanceId: Id, quantity = 1): { ok: true; left: number } | { ok: false; error: string } {
  const inst = world.itemInstances.get(instanceId);
  if (!inst) return { ok: false, error: `no existe el ejemplar ${instanceId}` };
  const q = Math.max(1, Math.floor(quantity));
  if (inst.quantity < q) return { ok: false, error: `solo hay ${inst.quantity}` };
  inst.quantity -= q;
  if (inst.quantity === 0) world.remove('item_instances', inst.id);
  else world.touch('item_instances', inst.id);
  return { ok: true, left: inst.quantity };
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
  /** `slots`: cuántos objetos caben (pilas incluidas). */
  containers: { name: string; id: Id; items: string[]; slots: number }[];
  coins: number;
  encumbrance: Encumbrance;
}

/** Daño en español, para la ficha de los objetos y las respuestas de info.ts. */
export const DAMAGE_ES: Record<string, string> = {
  bludgeoning: 'contundente', piercing: 'perforante', slashing: 'cortante', fire: 'fuego', cold: 'frío', lightning: 'rayo',
  thunder: 'trueno', poison: 'veneno', acid: 'ácido', necrotic: 'necrótico', radiant: 'radiante', force: 'fuerza', psychic: 'psíquico',
};

/** Icono con que la web pinta un objeto: sale de sus datos (tipo y propiedades), nunca de su nombre. */
export type PackIcon = 'weapon' | 'bow' | 'shield' | 'armor' | 'light' | 'potion' | 'food' | 'container' | 'tool' | 'quest' | 'treasure' | 'misc' | EquipSlot;

/**
 * Un objeto de la mochila tal como lo ve la web: su ejemplar (para moverlo), su rótulo («antorcha ×3») y su
 * ficha (peso, daño o CA, propiedades y para qué sirve), que la web enseña al pasar por encima o al tocarlo.
 */
export interface PackItem {
  id: Id;
  label: string;
  name: string;
  quantity: number;
  icon: PackIcon;
  /** Peso del ejemplar entero: la pila y lo que lleve dentro. */
  weight_lb: number;
  /** Hueco de equipo en que encaja (la web lo resalta al arrastrar). */
  equip_slot?: EquipSlot;
  /** La cifra principal, si la tiene: «Daño 1d8 cortante», «CA 11 + DES», «+2 a la CA en la mano». */
  stat?: string;
  props: string[];
  about: string;
}
export interface PackView {
  hands: { main: PackItem | null; off: PackItem | null; both: boolean };
  equipped: { slot: EquipSlot; item: PackItem | null }[];
  pockets: { items: PackItem[]; slots: number };
  containers: { id: Id; name: string; items: PackItem[]; slots: number }[];
}

const EQUIP_AT: Record<EquipSlot, string> = { head: 'la cabeza', body: 'el cuerpo', hands: 'las manos', feet: 'los pies', neck: 'el cuello', ring1: 'un dedo', ring2: 'un dedo', back: 'la espalda', belt: 'el cinturón' };
const SIZE_ES: Record<ItemSize, string> = { tiny: 'diminuto', small: 'pequeño', medium: 'mediano', large: 'grande', bulky: 'voluminoso: ocupa las dos manos' };
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function packIcon(def: ItemDef): PackIcon {
  if (def.weapon) return def.weapon.ranged ? 'bow' : 'weapon';
  if (def.shield_bonus) return 'shield';
  if (def.armor) return 'armor';
  if (def.light_source) return 'light';
  if (def.container) return 'container';
  if (def.heals) return 'potion';
  if (def.equip_slot) return def.equip_slot;
  return ({ consumable: 'food', tool: 'tool', quest: 'quest', treasure: 'treasure', weapon: 'weapon', armor: 'armor', container: 'container', misc: 'misc' } as const)[def.type];
}

/** La ficha de un objeto, sacada de sus datos: vale para cualquier campaña. */
function packItem(world: World, i: ItemInstance): PackItem {
  const d = world.itemDef(i.item_id);
  const props: string[] = [];
  let stat: string | undefined;
  if (d.weapon) {
    stat = `Daño ${d.weapon.damage} ${DAMAGE_ES[d.weapon.damage_type] ?? d.weapon.damage_type}`;
    if (d.weapon.finesse) props.push('sutil: con FUE o DES');
    if (d.weapon.ranged) props.push('a distancia');
    if (d.weapon.two_handed) props.push('a dos manos');
  } else if (d.armor) {
    stat = `CA ${d.armor.ac_base}${d.armor.dex_max === null ? ' + DES' : d.armor.dex_max > 0 ? ` + DES (máx. ${d.armor.dex_max})` : ''}`;
    if (d.armor.stealth_disadvantage) props.push('desventaja en Sigilo');
  } else if (d.shield_bonus) stat = `+${d.shield_bonus} a la CA en la mano`;
  if (d.heals) props.push(`cura ${d.heals} PG`);
  if (d.light_source) props.push(i.state.lit === true ? 'encendida: da luz' : 'da luz si la enciendes');
  if (d.container) props.push(`${d.container.slots} huecos, hasta ${d.container.max_weight_lb} lb`);
  if (d.equip_slot) props.push(`se lleva en ${EQUIP_AT[d.equip_slot]}`);
  props.push(SIZE_ES[d.size]);
  if (d.unique) props.push('único');
  if (d.value > 0) props.push(`vale ${thousands(d.value)} monedas`);
  const about = d.description ?? (d.shield_bonus ? 'Un escudo: llévalo en la otra mano para defenderte.' : d.light_source ? 'Da luz donde está oscuro.' : ({
    weapon: 'Un arma: empúñala para atacar con ella.',
    armor: 'Una armadura: póntela en el cuerpo y cambia tu CA.',
    consumable: d.heals ? 'Se gasta al usarla y te devuelve puntos de golpe.' : 'Se gasta al usarlo.',
    tool: 'Una herramienta: sirve para hacer algo con ella.',
    quest: 'Tiene que ver con una historia: guárdalo bien.',
    treasure: 'Un objeto de valor: se puede vender o cambiar.',
    container: 'Guarda otras cosas dentro.',
    misc: 'Un objeto corriente.',
  } as const)[d.type]);
  return {
    id: i.id, label: i.quantity > 1 ? `${d.name} ×${i.quantity}` : d.name, name: d.name, quantity: i.quantity,
    icon: packIcon(d), weight_lb: Math.round(instanceWeight(world, i) * 100) / 100,
    ...(d.equip_slot ? { equip_slot: d.equip_slot } : {}), ...(stat ? { stat } : {}), props, about,
  };
}

/** La mochila con cada hueco (libres incluidos) y la ficha de cada objeto: la web la pinta y la reordena arrastrando. */
export function packView(world: World, characterId: Id): PackView {
  const c = world.character(characterId);
  const item = (i: ItemInstance): PackItem => packItem(world, i);
  const view: PackView = { hands: { main: null, off: null, both: false }, equipped: EQUIP_SLOTS.map((slot) => ({ slot, item: null })), pockets: { items: [], slots: world.campaign.capacity_rules.pockets_slots }, containers: [] };
  for (const i of directlyCarried(world, c.id)) {
    if (i.location.type !== 'character') continue;
    const s = i.location.slot;
    if (s.kind === 'hand') { if (s.which === 'both') { view.hands.main = item(i); view.hands.both = true; } else view.hands[s.which] = item(i); }
    else if (s.kind === 'pocket') view.pockets.items.push(item(i));
    else { const e = view.equipped.find((x) => x.slot === s.slot); if (e) e.item = item(i); }
    const def = world.itemDef(i.item_id);
    if (def.container) view.containers.push({ id: i.id, name: def.name, items: world.itemsIn({ type: 'container', id: i.id }).map(item), slots: def.container.slots });
  }
  return view;
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
    if (def.container) view.containers.push({ name: def.name, id: i.id, items: world.itemsIn({ type: 'container', id: i.id }).map(label), slots: def.container.slots });
  }
  return view;
}
