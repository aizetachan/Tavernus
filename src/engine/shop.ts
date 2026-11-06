/**
 * Tiendas (PLAN-OBJETOS §6.2): un NPC con `shop` vende de existencias reales y compra con el dinero de su bolsa.
 *
 *  - **Existencias:** ejemplares de verdad dentro de contenedores fijos («estantes») que son suyos
 *    (`state.owner_id` igual a su id), en los puntos `shop.stock_spot_ids`. Comprar los saca de ahí y los pone en
 *    las manos del PJ: no se crea nada. Sin existencias, «no le queda».
 *  - **Vender:** lo vendido pasa a sus estantes y el pago sale de su bolsa (la del ajuar, `state.coins`). Si no le
 *    llega, no compra.
 *  - **Robar:** coger algo de un contenedor con dueño sin pagar es robo (`stockOwnerOf`, tools.ts y engine.ts).
 *  - **Horario:** `shop.hours`; fuera de hora no atiende, aunque esté.
 *  - **Reponer:** `daily` repone cada día lo que vende hasta `restock_max` (viene de fuera); `none` no repone nunca
 *    (Brezal: el valle está sellado; solo entra lo que le venden).
 *  - **Mundos generados:** `openShops` da tienda a mercaderes, posaderos y lonjeros con lo que ya venden, sin
 *    texto escrito a mano.
 *
 * Un NPC sin `shop` comercia como siempre (progress.ts): `sells` sin existencias contadas.
 *
 * El dinero va de bolsa a bolsa con `coinsOf`, `pay` y `receive` (money.ts, bloque D): lo que cobra el tendero
 * entra en su bolsa y lo que paga sale de ella.
 */

import { GAME_DAY, GAME_HOUR } from '../clock/clock.js';
import { checkFits, consumeItem, spawnItem } from './inventory.js';
import type { Character, Id, ItemDef, ItemInstance, Npc, NpcShop, Placement, WorldSnapshot } from './model.js';
import { isIdentifiedBy, itemName } from './items.js';
import { kitOf } from './outfit.js';
import { priceFor } from './standing.js';
import type { World } from './world.js';

// ---------------------------------------------------------------------------
// Existencias
// ---------------------------------------------------------------------------

/** Dueño de un contenedor fijo (estante, arcón del carro): `state.owner_id`. */
function ownerField(i: ItemInstance): Id | null {
  const o = i.state['owner_id'];
  return typeof o === 'string' && o ? o : null;
}

/**
 * De quién es algo que está en un estante con dueño (sube por los contenedores hasta el suelo). null si no es de
 * nadie o si alguien lo lleva encima (eso es otro robo: inventory.ts, carrierOf).
 */
export function stockOwnerOf(world: World, inst: ItemInstance): Npc | null {
  let at: Placement = inst.location;
  for (let g = 0; g < 16; g++) {
    if (at.type !== 'container') return null;
    const box = world.itemInstances.get(at.id);
    if (!box) return null;
    const owner = ownerField(box);
    if (owner) return world.npcs.get(owner) ?? null;
    at = box.location;
  }
  return null;
}

/** Sus estantes: contenedores fijos suyos en los puntos de su tienda. */
export function shelvesOf(world: World, npc: Npc): ItemInstance[] {
  const shop = npc.shop;
  if (!shop) return [];
  return shop.stock_spot_ids.flatMap((id) => world.itemsIn({ type: 'spot', id }))
    .filter((i) => ownerField(i) === npc.id && world.itemDef(i.item_id).container);
}

/** Lo que tiene a la venta: lo que hay dentro de sus estantes. */
export function stockOf(world: World, npc: Npc): ItemInstance[] {
  return shelvesOf(world, npc).flatMap((s) => world.itemsIn({ type: 'container', id: s.id }));
}

/** Cuántos le quedan de un objeto. */
export function stockCount(world: World, npc: Npc, itemId: Id): number {
  return stockOf(world, npc).filter((i) => i.item_id === itemId).reduce((a, i) => a + i.quantity, 0);
}

/** Precio de lista de lo que vende: el de `sells` o, sin él, lo que vale. */
export function listPrice(world: World, npc: Npc, itemId: Id): number {
  return npc.sells.find((s) => s.item_id === itemId)?.price ?? world.itemDef(itemId).value;
}

/** Lo que paga por un objeto que le venden (precio de lista, sin la opinión), o null si no lo compra. */
export function buyPrice(world: World, npc: Npc, itemId: Id): number | null {
  const listed = npc.buys.find((b) => b.item_id === itemId);
  if (listed) return listed.price;
  const def = world.itemDef(itemId);
  const share = npc.shop?.buys_any;
  if (!share || def.value <= 0 || def.unique || def.type === 'quest' || def.container?.fixed || def.service) return null;
  return Math.max(1, Math.floor(def.value * share));
}

/** Hora del día (0-24) de un instante de juego. */
function hourOf(nowG: number): number { return (((nowG % GAME_DAY) + GAME_DAY) % GAME_DAY) / GAME_HOUR; }

/** Si la tienda está cerrada a esa hora, por qué («La tienda está cerrada: abre a las 9.»); si abre, null. */
export function shopClosed(npc: Npc, nowG: number | undefined): string | null {
  const h = npc.shop?.hours;
  if (!h || nowG === undefined) return null;
  const now = hourOf(nowG);
  const open = h[0] <= h[1] ? now >= h[0] && now < h[1] : now >= h[0] || now < h[1];
  return open ? null : `${npc.name} no atiende a estas horas: abre de ${h[0]} a ${h[1]}`;
}

/** ¿Está el PJ en su tienda (y él también)? Si no, por qué. */
export function shopReach(world: World, npc: Npc, c: Character): string | null {
  const shop = npc.shop!;
  const here = world.characterSpot(c)?.location_id;
  if (here !== shop.location_id) return `hay que ir a la tienda de ${npc.name}`;
  if (world.spots.get(npc.location.id)?.location_id !== shop.location_id) return `${npc.name} no está en su tienda`;
  if (npc.status !== 'alive') return `${npc.name} no puede atenderte`;
  return null;
}

/**
 * Cambia de sitio un ejemplar (o parte) sin la regla de alcance de transferItem: lo que el tendero alcanza tras el
 * mostrador. Se junta con una pila igual del destino. null si no cabe.
 */
function relocate(world: World, inst: ItemInstance, to: Placement, qty: number): ItemInstance | null {
  const def = world.itemDef(inst.item_id);
  if (checkFits(world, def, qty, to, inst.id)) return null;
  const plain = !def.unique && Object.keys(inst.state).length === 0;
  const same = plain ? world.itemsIn(to).find((i) => i.id !== inst.id && i.item_id === inst.item_id && Object.keys(i.state).length === 0) : undefined;
  if (qty === inst.quantity) {
    if (same) { same.quantity += qty; world.remove('item_instances', inst.id); world.touch('item_instances', same.id); return same; }
    inst.location = to; world.touch('item_instances', inst.id);
    return inst;
  }
  if (same) { inst.quantity -= qty; world.touch('item_instances', inst.id); same.quantity += qty; world.touch('item_instances', same.id); return same; }
  // Parte de una pila: se crea en el destino con su estado y se resta del origen (spawnItem si no tiene estado).
  if (plain) {
    const r = spawnItem(world, inst.item_id, qty, to);
    if (!r.ok) return null;
    consumeItem(world, inst.id, qty);
    return r.moved;
  }
  return null;
}

/** Dónde se le da al PJ lo que compra: en la mano, en la otra o en el bolsillo (un bulto, con las dos). */
export function handsFor(world: World, c: Character, def: ItemDef): Placement[] {
  void world;
  return def.size === 'bulky'
    ? [{ type: 'character', id: c.id, slot: { kind: 'hand', which: 'both' } }]
    : [
      { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } },
      { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } },
      { type: 'character', id: c.id, slot: { kind: 'pocket' } },
    ];
}

/**
 * Saca `q` de un objeto de sus estantes y lo pone en las manos del PJ (o, si no le cabe, en el suelo de donde está).
 * No crea nada. Falla si no le quedan bastantes.
 */
export function takeFromStock(world: World, npc: Npc, c: Character, itemId: Id, q: number): { ok: true } | { ok: false; reason: string } {
  const have = stockCount(world, npc, itemId);
  const def = world.itemDef(itemId);
  if (have <= 0) return { ok: false, reason: `a ${npc.name} no le queda ${def.name}` };
  if (have < q) return { ok: false, reason: `a ${npc.name} solo le ${have === 1 ? 'queda 1' : `quedan ${have}`} de ${def.name}` };
  const spot = world.characterSpot(c);
  let left = q;
  for (const inst of stockOf(world, npc).filter((i) => i.item_id === itemId)) {
    if (left <= 0) break;
    const n = Math.min(left, inst.quantity);
    const placed = [...handsFor(world, c, def), ...(spot ? [{ type: 'spot', id: spot.id } as Placement] : [])]
      .some((to) => relocate(world, inst, to, n) !== null);
    if (!placed) return { ok: false, reason: 'no hay dónde ponerlo' };
    left -= n;
  }
  return left <= 0 ? { ok: true } : { ok: false, reason: 'no hay dónde ponerlo' };
}

/** Pone en sus estantes lo que le venden. Devuelve false si no cabe en ninguno. */
export function putInStock(world: World, npc: Npc, inst: ItemInstance, q: number): boolean {
  return shelvesOf(world, npc).some((s) => relocate(world, inst, { type: 'container', id: s.id }, q) !== null);
}

// ---------------------------------------------------------------------------
// La vista de la tienda (web y máster)
// ---------------------------------------------------------------------------

export interface ShopLine {
  item_id: Id;
  name: string;
  quantity: number;
  /** Precio por unidad para este PJ (con lo que piense de él). */
  price: number;
  /** Para qué sirve, en una frase, si el objeto la trae. */
  description?: string;
  /** Servicio (una noche de posada): no se cuenta, siempre hay. */
  service?: boolean;
}

/** Lo que vende ahora a este PJ: sus existencias agrupadas, y sus servicios. */
export function shopLines(world: World, npc: Npc, c: Character): ShopLine[] {
  const by = new Map<Id, { n: number; first: ItemInstance }>();
  for (const i of stockOf(world, npc)) { const g = by.get(i.item_id); if (g) g.n += i.quantity; else by.set(i.item_id, { n: i.quantity, first: i }); }
  const lines: ShopLine[] = [...by].map(([item_id, { n: quantity, first }]) => {
    const def = world.itemDef(item_id);
    // Lo mágico sin identificar, con el nombre que ve este PJ (items.ts): el tendero no sabe más que él.
    const known = isIdentifiedBy(def, first, c.id);
    const description = known ? def.description : def.unidentified?.description;
    return { item_id, name: itemName(def, first, c.id), quantity, price: priceFor(npc, c.id, listPrice(world, npc, item_id), 'buy'), ...(description ? { description } : {}) };
  });
  for (const s of npc.sells) {
    const def = world.itemDefs.get(s.item_id);
    if (def?.service) lines.push({ item_id: def.id, name: def.name, quantity: 1, price: priceFor(npc, c.id, s.price, 'buy'), service: true });
  }
  // Lo que más hay, primero; a igualdad, lo barato.
  return lines.sort((a, b) => Number(Boolean(a.service)) - Number(Boolean(b.service)) || a.price - b.price || a.name.localeCompare(b.name));
}

/** La tienda del sitio donde está el PJ (la de quien atiende aquí), o null. */
export function shopHere(world: World, c: Character): Npc | null {
  const loc = world.characterSpot(c)?.location_id;
  if (!loc) return null;
  return [...world.npcs.values()].find((n) => n.shop?.location_id === loc && n.status === 'alive') ?? null;
}

// ---------------------------------------------------------------------------
// Reponer
// ---------------------------------------------------------------------------

/**
 * Reposición diaria de las tiendas `daily`: cada cosa que vende (no los servicios) vuelve a `restock_max` (3 por
 * defecto) en su primer estante. Las `none` no reponen nunca. Devuelve si ha cambiado algo.
 */
export function restockShops(world: World, nowG: number): boolean {
  const day = Math.floor(nowG / GAME_DAY);
  let changed = false;
  for (const npc of world.npcs.values()) {
    const shop = npc.shop;
    if (!shop || shop.restock !== 'daily' || npc.status === 'dead' || npc.status === 'missing') continue;
    if (shop.last_restock_day === undefined) { shop.last_restock_day = day; world.touch('npcs', npc.id); continue; }
    if (shop.last_restock_day >= day) continue;
    shop.last_restock_day = day;
    world.touch('npcs', npc.id);
    const shelf = shelvesOf(world, npc)[0];
    if (!shelf) continue;
    const max = shop.restock_max ?? 3;
    for (const s of npc.sells) {
      const def = world.itemDefs.get(s.item_id);
      if (!def || def.service || def.unique) continue;
      const missing = max - stockCount(world, npc, def.id);
      if (missing > 0 && spawnItem(world, def.id, missing, { type: 'container', id: shelf.id }).ok) changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Mundos generados
// ---------------------------------------------------------------------------

/** El estante de una tienda generada, por género. */
export const SHELF_ITEM_ID = 'it_estante_tienda';
function shelfDef(genre: string | undefined): ItemDef {
  const [name, aliases] = genre === 'scifi' ? ['expositor', ['expositor', 'vitrina', 'estante', 'mercancía']]
    : genre === 'postapoc' ? ['puesto de chatarra', ['puesto', 'mostrador', 'estante', 'mercancía']]
    : ['estante de la tienda', ['estante', 'estantes', 'mercancía', 'género', 'puesto']];
  return {
    id: SHELF_ITEM_ID, name, aliases, type: 'container', size: 'bulky', weight_lb: 80, value: 0, unique: false, origin: 'custom',
    container: { slots: 40, max_weight_lb: 400, max_size: 'bulky', fixed: true },
    description: 'Lo que el tendero tiene a la venta. Se compra; cogerlo sin pagar es robar.',
  };
}

/** Quién pone tienda en un mundo generado: mercaderes, posaderos y lonjeros (por su ajuar u oficio). */
const SHOPKEEPER_KITS = new Set(['merchant', 'innkeeper']);
const SHOPKEEPER_ROLE = /(lonjer|pescader|tender|mercader|buhoner|chatarrer)/;

/** Cuántos tiene al empezar de algo que vende, según lo que vale: lo barato abunda. */
function startingStock(value: number): number { return value <= 10 ? 6 : value <= 100 ? 4 : value <= 1000 ? 2 : 1; }

/**
 * Da tienda a los NPC de un mundo generado que venden algo y son de oficio de tienda: un estante suyo en su punto
 * con lo que venden (del catálogo que ya trae el mundo) y reposición diaria. Idempotente: quien ya tiene tienda no
 * se toca. No se aplica a campañas escritas: allí la tienda se escribe (Brezal, el buhonero). Devuelve si cambia algo.
 */
export function openShops(snap: WorldSnapshot): boolean {
  if (!snap.campaign.generation) return false;
  const defs = new Map(snap.item_defs.map((d) => [d.id, d]));
  const plainRole = (r: string) => r.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let changed = false;
  for (const n of snap.npcs) {
    // El relleno (extras.ts) vende de lo que lleva encima, sin estante.
    if (n.shop || n.status === 'dead' || n.status === 'missing' || n.mute || n.tier === 'extra') continue;
    const goods = n.sells.filter((s) => { const d = defs.get(s.item_id); return d && !d.service && !d.unique; });
    if (!goods.length) continue;
    if (!SHOPKEEPER_KITS.has(kitOf(n).id) && !SHOPKEEPER_ROLE.test(plainRole(n.role))) continue;
    const spot = snap.spots.find((s) => s.id === n.location.id);
    if (!spot) continue;
    if (!defs.has(SHELF_ITEM_ID)) { const d = shelfDef(snap.campaign.generation.genre); snap.item_defs.push(d); defs.set(d.id, d); }
    const shelfId = `ii_tienda_${n.id.replace(/^npc_/, '')}`;
    if (!snap.item_instances.some((i) => i.id === shelfId)) {
      snap.item_instances.push({ id: shelfId, item_id: SHELF_ITEM_ID, quantity: 1, location: { type: 'spot', id: spot.id }, state: { owner_id: n.id } });
      for (const g of goods) {
        snap.item_instances.push({ id: `${shelfId}_${g.item_id.replace(/^it_/, '')}`, item_id: g.item_id, quantity: startingStock(defs.get(g.item_id)!.value), location: { type: 'container', id: shelfId }, state: {} });
      }
    }
    n.shop = { location_id: spot.location_id, stock_spot_ids: [spot.id], restock: 'daily', restock_max: 4, buys_any: 0.5 };
    changed = true;
  }
  return changed;
}

/** Las tiendas de una campaña escrita que la partida aún no tiene (partidas de antes): el campo, de la semilla. */
export function shopsFromSeed(snap: WorldSnapshot, seed: WorldSnapshot | undefined): boolean {
  if (!seed) return false;
  let changed = false;
  for (const sn of seed.npcs) {
    if (!sn.shop) continue;
    const n = snap.npcs.find((x) => x.id === sn.id);
    if (n && !n.shop) { n.shop = structuredClone(sn.shop) as NpcShop; changed = true; }
  }
  return changed;
}
