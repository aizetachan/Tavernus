/**
 * Inventario y capacidad (SPEC §5.2–§5.4). Nada es infinito. El servidor
 * decide si algo cabe; el master solo narra el resultado.
 */

import type { CarrySlot, Character, EquipSlot, Id, ItemDef, ItemInstance, ItemRarity, ItemSize, ItemType, Placement, Spot } from './model.js';
import { EQUIP_SLOTS } from './model.js';
import { DAMAGE_ES, RARITY_ES, WEAPON_PROPERTIES, magicView, WEAPON_PROPERTY_ES, attunementText, bonusText, chargesLeft, chargesText, effectText, isIdentifiedBy, isMagic, itemName, needsAttunement, spellText, weaponProperties } from './items.js';
import { coinPieces, currencyOf, fmtMoney } from './money.js';
import { samePlacement, slotKey, type World } from './world.js';

const SIZE_RANK: Record<ItemSize, number> = { tiny: 0, small: 1, medium: 2, large: 3, bulky: 4 };

export type TransferError =
  | { code: 'not_found'; id: Id }
  | { code: 'bad_quantity' }
  | { code: 'not_reachable'; reason: string }
  | { code: 'fixed' }
  | { code: 'no_space'; reason: string; options: string[]; /** Cuántas sí caben, si caben algunas de la pila. */ fits?: number }
  | { code: 'invalid_slot'; reason: string };

export type TransferResult =
  | { ok: true; moved: ItemInstance; remaining: ItemInstance | null; /** Monedas que había dentro y pasan al PJ que lo coge (outfit.ts). */ coins?: number }
  | { ok: false; error: TransferError };

/** Quién lleva algo que está en `p`, subiendo por los contenedores: un PJ, un NPC o nadie (suelo, vehículo). */
export function carrierOf(world: World, p: Placement): { type: 'character' | 'npc'; id: Id } | null {
  let at: Placement = p;
  for (let g = 0; g < 32; g++) {
    if (at.type === 'character' || at.type === 'npc') return { type: at.type, id: at.id };
    if (at.type !== 'container') return null;
    const box = world.itemInstances.get(at.id);
    if (!box) return null;
    at = box.location;
  }
  return null;
}

/**
 * Las monedas sueltas en una bolsa (`state.coins`, outfit.ts) son dinero: cuando la bolsa llega a
 * un PJ (en la mano, al cinto o dentro de su mochila) pasan a sus monedas. Mira también lo que va
 * dentro. Devuelve cuántas.
 */
function pocketCoins(world: World, inst: ItemInstance): number {
  const who = carrierOf(world, inst.location);
  if (who?.type !== 'character') return 0;
  const c = world.characters.get(who.id);
  if (!c) return 0;
  let total = 0;
  const walk = (i: ItemInstance, depth: number) => {
    const n = i.state['coins'];
    if (typeof n === 'number' && n > 0) { total += n; delete i.state['coins']; world.touch('item_instances', i.id); }
    if (depth < 8) for (const inner of world.itemsIn({ type: 'container', id: i.id })) walk(inner, depth + 1);
  };
  walk(inst, 0);
  if (total > 0) { c.coins += total; world.touch('characters', c.id); }
  return total;
}

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
      const used = inside.reduce((a, i) => a + instanceWeight(world, i), 0);
      const max = cdef.container.max_weight_lb;
      if (used + def.weight_lb * quantity > max) {
        const fits = Math.floor((max - used) / def.weight_lb);
        return {
          code: 'no_space',
          reason: `${cdef.name} lleva ${used} de ${max} lb y ${def.name}${quantity > 1 ? ` ×${quantity}` : ''} pesa ${def.weight_lb * quantity} lb`,
          options: [...(fits > 0 ? [`guardar solo ${fits}`] : []), 'sacar algo pesado', 'llevarlo en la mano'],
          ...(fits > 0 ? { fits } : {}),
        };
      }
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
  const coins = pocketCoins(world, moved);
  return { ok: true, moved, remaining, ...(coins ? { coins } : {}) };
}

/**
 * Lo que lleva un NPC, para el máster, con IDs para transfer_item: «bolsa de cuero con 3 de plata
 * [ii_x] (dentro: navaja [ii_y], yesca y pedernal [ii_z])». Sin esto el máster lo inventa.
 */
export function npcCarryList(world: World, npcId: Id): string[] {
  const label = (i: ItemInstance): string => {
    const d = world.itemDef(i.item_id);
    const coins = i.state['coins'];
    const money = typeof coins === 'number' && coins > 0 ? ` con ${fmtMoney(coins, currencyOf(world.campaign))}` : '';
    const inside = d.container ? world.itemsIn({ type: 'container', id: i.id }) : [];
    return `${d.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}${money} [${i.id}]${inside.length ? ` (dentro: ${inside.map(label).join(', ')})` : ''}`;
  };
  return world.itemsIn({ type: 'npc', id: npcId }).map(label);
}

const COUNT_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

/**
 * Cuánto coge de una pila quien dice «coger agua»: una. Se lleva más si lo dice: un número o el plural («las
 * antorchas», «todas»). El agua del pozo no sube entera a la mano por pedir agua.
 */
export function takeAmount(what: string, stack: number): number {
  const t = what.trim().toLowerCase();
  if (/^(?:tod[oa]s?|los|las)\b/.test(t)) return stack;
  const first = t.split(/\s+/)[0] ?? '';
  const n = /^\d+$/.test(first) ? Number(first) : COUNT_WORDS[first] ?? 1;
  return Math.max(1, Math.min(n, stack));
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

/**
 * Inventario con identificadores, para el master: dónde está cada ejemplar. El nombre es el que ve el PJ (un objeto
 * mágico sin identificar sale con su nombre genérico y `unidentified: true`).
 */
export interface DetailedItem { instance_id: Id; item_id: Id; name: string; quantity: number; where: string; unidentified?: true }
export function inventoryDetailed(world: World, characterId: Id): DetailedItem[] {
  const out: DetailedItem[] = [];
  const label = (s: CarrySlot) => s.kind === 'hand' ? (s.which === 'both' ? 'ambas manos' : s.which === 'main' ? 'mano principal' : 'mano secundaria') : s.kind === 'pocket' ? 'bolsillo' : `equipado:${s.slot}`;
  const entry = (i: ItemInstance, where: string): DetailedItem => {
    const d = world.itemDef(i.item_id);
    return { instance_id: i.id, item_id: d.id, name: itemName(d, i, characterId), quantity: i.quantity, where, ...(isIdentifiedBy(d, i, characterId) ? {} : { unidentified: true as const }) };
  };
  for (const i of directlyCarried(world, characterId)) {
    if (i.location.type !== 'character') continue;
    const def = world.itemDef(i.item_id);
    out.push(entry(i, label(i.location.slot)));
    if (def.container) {
      for (const inner of world.itemsIn({ type: 'container', id: i.id })) out.push(entry(inner, `dentro de ${itemName(def, i, characterId)} [${i.id}]`));
    }
  }
  return out;
}

/** Lo que llevan los contenedores del PJ frente a lo que aguantan, para que el máster no cuente otra cosa. */
export function containerLoads(world: World, characterId: Id): string[] {
  return directlyCarried(world, characterId).flatMap((i) => {
    const def = world.itemDef(i.item_id);
    if (!def.container) return [];
    const inside = world.itemsIn({ type: 'container', id: i.id });
    return [`${def.name} [${i.id}]: lleva ${inside.reduce((a, x) => a + instanceWeight(world, x), 0)} de ${def.container.max_weight_lb} lb, ${inside.length} de ${def.container.slots} huecos`];
  });
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

export { DAMAGE_ES };

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
  /** Imagen escrita del objeto (la pone la web, src/adapters/web/itemart.ts); sin ella, el icono. */
  art?: string;
  /** Objeto mágico identificado: su rareza (la web puede teñir el borde). */
  rarity?: ItemRarity;
  /** Objeto mágico que el PJ aún no ha identificado: nombre genérico y sin sus propiedades mágicas. */
  unidentified?: true;
  /** Pide sintonía, y si la tiene con este PJ. */
  attunement?: { attuned: boolean };
  /** Cargas que le quedan y su máximo. */
  charges?: { left: number; max: number };
}
export interface PackView {
  hands: { main: PackItem | null; off: PackItem | null; both: boolean };
  equipped: { slot: EquipSlot; item: PackItem | null }[];
  pockets: { items: PackItem[]; slots: number };
  containers: { id: Id; name: string; items: PackItem[]; slots: number; max_weight_lb: number }[];
}

const EQUIP_AT: Record<EquipSlot, string> = { head: 'la cabeza', body: 'el cuerpo', hands: 'las manos', feet: 'los pies', neck: 'el cuello', ring1: 'un dedo', ring2: 'un dedo', back: 'la espalda', belt: 'el cinturón' };
const SIZE_ES: Record<ItemSize, string> = { tiny: 'diminuto', small: 'pequeño', medium: 'mediano', large: 'grande', bulky: 'voluminoso: ocupa las dos manos' };
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const TYPE_ICON: Record<ItemType, PackIcon> = {
  weapon: 'weapon', armor: 'armor', ammunition: 'bow', gear: 'misc', tool: 'tool', focus: 'treasure', consumable: 'food',
  scroll: 'quest', wand: 'weapon', rod: 'weapon', staff: 'weapon', ring: 'ring1', wondrous: 'treasure',
  treasure: 'treasure', coin: 'treasure', quest: 'quest', container: 'container', misc: 'misc',
};

/** Para qué sirve un objeto sin descripción propia, por su tipo. */
const TYPE_ABOUT: Record<ItemType, string> = {
  weapon: 'Un arma: empúñala para atacar con ella.',
  armor: 'Una armadura: póntela en el cuerpo y cambia tu CA.',
  ammunition: 'Munición: la gasta un arma a distancia al disparar.',
  gear: 'Equipo de viaje.',
  tool: 'Una herramienta: sirve para hacer algo con ella.',
  focus: 'Un foco para lanzar conjuros.',
  consumable: 'Se gasta al usarlo.',
  scroll: 'Un pergamino con un conjuro escrito: se gasta al leerlo.',
  wand: 'Una varita: guarda un poder que se gasta y se recupera.',
  rod: 'Un cetro con un poder propio.',
  staff: 'Un bastón con un poder propio.',
  ring: 'Un anillo: se lleva en un dedo.',
  wondrous: 'Un objeto con un poder propio.',
  quest: 'Tiene que ver con una historia: guárdalo bien.',
  treasure: 'Un objeto de valor: se puede vender o cambiar.',
  coin: 'Dinero.',
  container: 'Guarda otras cosas dentro.',
  misc: 'Un objeto corriente.',
};

function packIcon(def: ItemDef): PackIcon {
  if (def.weapon) return def.weapon.ranged ? 'bow' : 'weapon';
  if (def.shield_bonus) return 'shield';
  if (def.armor) return 'armor';
  if (def.light_source) return 'light';
  if (def.container) return 'container';
  if (def.heals) return 'potion';
  if (def.equip_slot) return def.equip_slot;
  if (def.subtype === 'potion') return 'potion';
  return TYPE_ICON[def.type];
}

/**
 * La ficha de un objeto, sacada de sus datos: vale para cualquier campaña. `viewerId` es quien lo mira: un objeto
 * mágico que no ha identificado sale con su nombre genérico y sin lo mágico (rareza, bonos, cargas, efectos).
 */
function packItem(world: World, i: ItemInstance, viewerId: Id): PackItem {
  const d = world.itemDef(i.item_id);
  const known = isIdentifiedBy(d, i, viewerId);
  const name = itemName(d, i, viewerId);
  const props: string[] = [];
  let stat: string | undefined;
  const magic: Pick<PackItem, 'rarity' | 'unidentified' | 'attunement' | 'charges'> = {};
  if (isMagic(d) && !known) {
    magic.unidentified = true;
    props.push('mágico: sin identificar');
  } else if (isMagic(d)) {
    magic.rarity = d.rarity!;
    props.push(`mágico, ${RARITY_ES[d.rarity!]}`);
  }
  if (d.weapon) {
    const v = d.weapon.versatile_damage ? ` (${d.weapon.versatile_damage} a dos manos)` : '';
    stat = `Daño ${d.weapon.damage}${v} ${DAMAGE_ES[d.weapon.damage_type] ?? d.weapon.damage_type}`;
    const wp = weaponProperties(d);
    if (d.weapon.ranged && !wp.has('ammunition') && !wp.has('thrown')) props.push('a distancia');
    for (const p of WEAPON_PROPERTIES) {
      if (!wp.has(p)) continue;
      const range = (p === 'thrown' || p === 'ammunition') && d.weapon.range ? ` (${d.weapon.range[0]}/${d.weapon.range[1]} pies)` : '';
      props.push(WEAPON_PROPERTY_ES[p] + range);
    }
  } else if (d.armor) {
    stat = `CA ${d.armor.ac_base}${d.armor.dex_max === null ? ' + DES' : d.armor.dex_max > 0 ? ` + DES (máx. ${d.armor.dex_max})` : ''}`;
    if (d.armor.stealth_disadvantage) props.push('desventaja en Sigilo');
    if (d.armor.str_min) props.push(`pide FUE ${d.armor.str_min}`);
  } else if (d.shield_bonus) stat = `+${d.shield_bonus} a la CA en la mano`;
  if (known) {
    props.push(...bonusText(d));
    if (needsAttunement(d)) {
      const attuned = i.state.attuned_to === viewerId;
      magic.attunement = { attuned };
      props.push(attuned ? 'sintonizado contigo' : attunementText(d)!);
    }
    const left = chargesLeft(d, i);
    if (left !== null && d.charges) { props.push(chargesText(d, i)!); magic.charges = { left, max: d.charges.max }; }
    const sp = spellText(d, i);
    if (sp) props.push(`conjuro: ${sp}`);
    for (const e of d.effects ?? []) props.push(effectText(e));
    if (d.effect) props.push(`al usarlo: ${effectText(d.effect)}${d.duration_s ? ` durante ${fmtDuration(d.duration_s)}` : ''}`);
    if (d.heals) props.push(`cura ${d.heals} PG`);
    if (d.cursed && i.state.attuned_to) props.push('maldito: no te lo puedes quitar');
  }
  if (d.light_source) props.push(i.state.lit === true ? 'encendida: da luz' : 'da luz si la enciendes');
  if (d.container) props.push(`${d.container.slots} huecos, hasta ${d.container.max_weight_lb} lb`);
  if (d.equip_slot) props.push(`se lleva en ${EQUIP_AT[d.equip_slot]}`);
  props.push(SIZE_ES[d.size]);
  if (d.unique) props.push('único');
  if (d.value > 0 && known) props.push(`vale ${thousands(d.value)} monedas`);
  const about = !known
    ? (d.unidentified?.description ?? 'Hay algo raro en él: no sabes qué hace hasta identificarlo.')
    : d.description ?? (d.shield_bonus ? 'Un escudo: llévalo en la otra mano para defenderte.' : d.light_source ? 'Da luz donde está oscuro.'
      : d.type === 'consumable' && d.heals ? 'Se gasta al usarla y te devuelve puntos de golpe.' : TYPE_ABOUT[d.type]);
  return {
    id: i.id, label: i.quantity > 1 ? `${name} ×${i.quantity}` : name, name, quantity: i.quantity,
    icon: packIcon(d), weight_lb: Math.round(instanceWeight(world, i) * 100) / 100,
    ...(d.equip_slot ? { equip_slot: d.equip_slot } : {}), ...(stat ? { stat } : {}), props, about, ...magic,
  };
}

/** Una duración en segundos de juego, en palabras: «1 hora», «10 minutos». */
function fmtDuration(s: number): string {
  if (s % 86400 === 0) return s === 86400 ? '1 día' : `${s / 86400} días`;
  if (s % 3600 === 0) return s === 3600 ? '1 hora' : `${s / 3600} horas`;
  if (s % 60 === 0) return s === 60 ? '1 minuto' : `${s / 60} minutos`;
  return `${s} segundos`;
}

/** La mochila con cada hueco (libres incluidos) y la ficha de cada objeto: la web la pinta y la reordena arrastrando. */
export function packView(world: World, characterId: Id): PackView {
  const c = world.character(characterId);
  const item = (i: ItemInstance): PackItem => packItem(world, i, c.id);
  const view: PackView = { hands: { main: null, off: null, both: false }, equipped: EQUIP_SLOTS.map((slot) => ({ slot, item: null })), pockets: { items: [], slots: world.campaign.capacity_rules.pockets_slots }, containers: [] };
  for (const i of directlyCarried(world, c.id)) {
    if (i.location.type !== 'character') continue;
    const s = i.location.slot;
    if (s.kind === 'hand') { if (s.which === 'both') { view.hands.main = item(i); view.hands.both = true; } else view.hands[s.which] = item(i); }
    else if (s.kind === 'pocket') view.pockets.items.push(item(i));
    else { const e = view.equipped.find((x) => x.slot === s.slot); if (e) e.item = item(i); }
    const def = world.itemDef(i.item_id);
    if (def.container) view.containers.push({ id: i.id, name: itemName(def, i, c.id), items: world.itemsIn({ type: 'container', id: i.id }).map(item), slots: def.container.slots, max_weight_lb: def.container.max_weight_lb });
  }
  return view;
}

export function inventoryView(world: World, characterId: Id): InventoryView {
  const c = world.character(characterId);
  const view: InventoryView = { hands: { main: null, off: null }, equipped: {}, pockets: [], containers: [], coins: c.coins, encumbrance: encumbrance(world, c) };
  const label = (i: ItemInstance) => { const n = itemName(world.itemDef(i.item_id), i, c.id); return i.quantity > 1 ? `${n} ×${i.quantity}` : n; };
  for (const i of directlyCarried(world, c.id)) {
    if (i.location.type !== 'character') continue;
    const s = i.location.slot;
    const def = world.itemDef(i.item_id);
    if (s.kind === 'hand') {
      if (s.which === 'both') { view.hands.main = label(i); view.hands.off = label(i); } else view.hands[s.which] = label(i);
    } else if (s.kind === 'pocket') view.pockets.push(label(i));
    else view.equipped[s.slot] = label(i);
    if (def.container) view.containers.push({ name: itemName(def, i, c.id), id: i.id, items: world.itemsIn({ type: 'container', id: i.id }).map(label), slots: def.container.slots });
  }
  return view;
}

/**
 * Un ejemplar tal como lo ve el máster al examinarlo con un personaje (`get_item`): lo de siempre más categoría,
 * cifra (daño o CA), propiedades y lo mágico. Lo que el personaje no ha identificado sale con su nombre genérico,
 * `magic: 'objeto mágico sin identificar'` y sin `item_id` (que delataría qué es) ni el estado mágico del ejemplar.
 */
export function itemView(world: World, instanceId: Id, viewerId: Id): Record<string, unknown> {
  const i = world.itemInstance(instanceId);
  const d = world.itemDef(i.item_id);
  const known = isIdentifiedBy(d, i, viewerId);
  const card = packItem(world, i, viewerId);
  const nameOf = (id: Id) => world.characters.get(id)?.name ?? world.npcs.get(id)?.name ?? id;
  const { identified_by: _ib, attuned_to: _at, charges: _ch, ...plainState } = i.state;
  return {
    instance_id: i.id, ...(known ? { item_id: d.id } : {}), name: card.name, type: d.type, ...(d.subtype ? { subtype: d.subtype } : {}),
    size: d.size, weight_lb: d.weight_lb, quantity: i.quantity, ...(card.stat ? { stat: card.stat } : {}), props: card.props,
    ...(isMagic(d) ? { magic: magicView(d, i, viewerId, nameOf) } : {}),
    state: plainState, location: i.location, container: d.container ?? null,
  };
}
