import type { Character, Id, ItemDef, ItemInstance, Placement, WorldSnapshot } from './model.js';
import { genreOfCampaign, KIT_PURSE_ID, kitItemDef } from './outfit.js';
import type { World } from './world.js';

/**
 * Dinero. El valor se guarda en la moneda más pequeña (lo que hay en cada
 * bolsa, `state.coins`, los precios y las recompensas: cobre, como el catálogo
 * SRD), pero se cuenta, se
 * pesa y se enseña en monedas de cada valor: 1500 son 15 de oro, no mil
 * quinientas piezas en el bolsillo (partida del 27-10: 1700 monedas pesaban
 * 34 lb y dejaban «cargado» a un mago al empezar).
 *
 * Cada campaña puede traer las suyas (`campaign.currency`, de mayor a menor
 * valor; la última vale 1). Sin ellas, las del SRD: oro = 10 de plata = 100 de
 * cobre. Se lleva siempre el menor número de monedas posible (el cambio se da
 * solo), y eso es lo que pesa.
 */

export interface Denomination {
  /** Metal o nombre de la moneda, en singular: «oro», «plata», «cobre». */
  name: string;
  /** Lo que vale en la moneda más pequeña. */
  value: number;
}

export const DEFAULT_CURRENCY: readonly Denomination[] = [
  { name: 'oro', value: 100 },
  { name: 'plata', value: 10 },
  { name: 'cobre', value: 1 },
];

/** Con lo que empieza un PJ nuevo si la campaña no dice otra cosa: unas pocas monedas (1 de oro y 5 de plata). */
export const DEFAULT_STARTING_COINS = 150;

/** Las monedas de la campaña, de mayor a menor valor. */
export function currencyOf(campaign: { currency?: readonly Denomination[] } | null | undefined): readonly Denomination[] {
  const cur = campaign?.currency?.filter((d) => d.value >= 1);
  return cur?.length ? [...cur].sort((a, b) => b.value - a.value) : DEFAULT_CURRENCY;
}

/** Cuántas monedas de cada valor hacen `total`, con el menor número de piezas. Solo las que hay. */
export function coinBreakdown(total: number, cur: readonly Denomination[] = DEFAULT_CURRENCY): { name: string; count: number }[] {
  let left = Math.max(0, Math.round(total));
  const out: { name: string; count: number }[] = [];
  for (const d of cur) {
    const n = Math.floor(left / d.value);
    if (n > 0) { out.push({ name: d.name, count: n }); left -= n * d.value; }
  }
  return out;
}

/** Piezas que hay en la bolsa: lo que pesa. */
export function coinPieces(total: number, cur: readonly Denomination[] = DEFAULT_CURRENCY): number {
  return coinBreakdown(total, cur).reduce((a, x) => a + x.count, 0);
}

/** «15 de oro», «2 de plata y 4 de cobre», «1 de oro, 3 de plata y 2 de cobre»; «nada» si es 0. */
export function fmtMoney(total: number, cur: readonly Denomination[] = DEFAULT_CURRENCY): string {
  const parts = coinBreakdown(total, cur).map((x) => `${x.count} de ${x.name}`);
  if (!parts.length) return 'nada';
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Dinero en lo que escribe el jugador: «3 de oro», «2 monedas de plata y 5 de
 * cobre», «10 oro». Un número con «monedas» a secas va en la moneda más
 * pequeña («20 monedas»). null si no habla de dinero.
 */
export function parseMoney(text: string, cur: readonly Denomination[] = DEFAULT_CURRENCY): number | null {
  const t = norm(text);
  const names = cur.map((d) => norm(d.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let total = 0;
  let found = false;
  const re = new RegExp(`(\\d+)\\s*(?:monedas?\\s+|piezas?\\s+)?(?:de\\s+)?(${names.join('|')})\\b`, 'g');
  for (const m of t.matchAll(re)) {
    const d = cur[names.indexOf(m[2]!)]!;
    total += Number(m[1]) * d.value;
    found = true;
  }
  if (found) return total;
  const plain = /(\d+)\s*(?:monedas?|mo|piezas?)\b/.exec(t);
  return plain ? Number(plain[1]) : null;
}

/** fmtMoney con las monedas de la campaña del mundo. */
export function money(world: { campaign: { currency?: readonly Denomination[] } }, total: number): string {
  return fmtMoney(total, currencyOf(world.campaign));
}

// ---------------------------------------------------------------------------
// El dinero vive en bolsas (PLAN-OBJETOS §5, bloque D)
// ---------------------------------------------------------------------------
//
// Nadie tiene un número de monedas: tiene bolsas (u otras cosas) con monedas
// dentro (`ItemInstance.state.coins`). El dinero de un PJ o de un NPC es la suma
// de lo que lleva encima, bolsas dentro de la mochila incluidas. Así se le puede
// robar la bolsa o parte de lo que hay dentro, perderla al morir (cae con el
// cuerpo) o esconder una segunda bolsa. Pagar saca de la bolsa más a mano y
// sigue por las demás; cobrar mete en la más a mano, y quien no lleva ninguna
// recibe una (la del ajuar, outfit.ts). Vale igual para PJ y para NPC.

/** Quién lleva algo: un PJ o un NPC, por su id. null si no es ninguno de los dos. */
function holderOf(world: World, id: Id): { type: 'character' | 'npc'; id: Id } | null {
  if (world.characters.has(id)) return { type: 'character', id };
  if (world.npcs.has(id)) return { type: 'npc', id };
  return null;
}

/** Monedas que hay en un ejemplar (sin bajar a lo que contiene). */
export function coinsAt(i: ItemInstance): number {
  const c = i.state['coins'];
  return typeof c === 'number' && c > 0 ? Math.floor(c) : 0;
}

/** Monedas que hay en un ejemplar y en todo lo que contiene (la bolsa dentro de la mochila). */
export function coinsWithin(world: World, i: ItemInstance): number {
  let total = 0;
  const walk = (x: ItemInstance, depth: number) => {
    total += coinsAt(x);
    if (depth < 8) for (const inner of world.itemsIn({ type: 'container', id: x.id })) walk(inner, depth + 1);
  };
  walk(i, 0);
  return total;
}

/** ¿Es una bolsa de dinero? Lo que ya guarda monedas (aunque esté vacía) o la bolsa del ajuar. */
export function isPurse(i: ItemInstance): boolean {
  return typeof i.state['coins'] === 'number' || i.item_id === KIT_PURSE_ID;
}

/** Lo más a mano primero: en la mano, al cinto, en el bolsillo, el resto del equipo; luego lo de dentro, por capas. */
function reachRank(i: ItemInstance): number {
  if (i.location.type !== 'character') return 0;
  const s = i.location.slot;
  if (s.kind === 'hand') return 0;
  if (s.kind === 'equipped' && s.slot === 'belt') return 1;
  if (s.kind === 'pocket') return 2;
  return 3;
}

/** Todo lo que lleva un PJ o NPC, lo más a mano primero (por capas: encima, dentro de lo de encima…). */
function carriedByReach(world: World, holderId: Id): ItemInstance[] {
  const h = holderOf(world, holderId);
  if (!h) return [];
  const out: ItemInstance[] = [];
  let layer = [...world.itemInstances.values()]
    .filter((i) => i.location.type === h.type && i.location.id === h.id)
    .sort((a, b) => reachRank(a) - reachRank(b));
  for (let depth = 0; layer.length && depth < 8; depth++) {
    out.push(...layer);
    const next: ItemInstance[] = [];
    for (const box of layer) if (world.itemDefs.get(box.item_id)?.container) next.push(...world.itemsIn({ type: 'container', id: box.id }));
    layer = next;
  }
  return out;
}

/** Las bolsas que lleva un PJ o NPC, la más a mano primero. */
export function pursesOf(world: World, holderId: Id): ItemInstance[] {
  return carriedByReach(world, holderId).filter(isPurse);
}

/** El dinero que lleva un PJ o NPC: la suma de sus bolsas, en la moneda más pequeña. */
export function coinsOf(world: World, holderId: Id): number {
  return carriedByReach(world, holderId).reduce((a, i) => a + coinsAt(i), 0);
}

let purseSeq = 0;

/** La definición de la bolsa del ajuar en el mundo; la añade si la campaña no la trae. */
function purseDef(world: World): ItemDef {
  const have = world.itemDefs.get(KIT_PURSE_ID);
  if (have) return have;
  const def = kitItemDef('purse', genreOfCampaign(world.campaign));
  world.itemDefs.set(def.id, def);
  world.touch('item_defs', def.id);
  return def;
}

/** Una bolsa nueva para un PJ (al cinto; si ya lleva algo ahí, en el bolsillo) o un NPC, con `coins` dentro. */
export function newPurse(world: World, holderId: Id, coins = 0): ItemInstance {
  const h = holderOf(world, holderId);
  if (!h) throw new Error(`newPurse: ${holderId} no es un PJ ni un NPC`);
  const def = purseDef(world);
  let location: Placement = { type: 'npc', id: h.id };
  if (h.type === 'character') {
    const beltTaken = [...world.itemInstances.values()].some((i) => i.location.type === 'character' && i.location.id === h.id && i.location.slot.kind === 'equipped' && i.location.slot.slot === 'belt');
    location = { type: 'character', id: h.id, slot: beltTaken ? { kind: 'pocket' } : { kind: 'equipped', slot: 'belt' } };
  }
  const base = `ii_bolsa_${h.id.replace(/^(ch|npc)_/, '')}`;
  let id = base;
  while (world.itemInstances.has(id)) id = `${base}_${Date.now().toString(36)}${(++purseSeq).toString(36)}`;
  const inst: ItemInstance = { id, item_id: def.id, quantity: 1, location, state: { coins: Math.max(0, Math.floor(coins)) } };
  world.itemInstances.set(inst.id, inst);
  world.touch('item_instances', inst.id);
  return inst;
}

/** Su bolsa más a mano; si no lleva ninguna, le da una vacía. */
export function ensurePurse(world: World, holderId: Id): ItemInstance {
  return pursesOf(world, holderId)[0] ?? newPurse(world, holderId, 0);
}

/** Mete monedas en un ejemplar concreto (una bolsa). */
export function addToPurse(world: World, purse: ItemInstance, amount: number): void {
  purse.state['coins'] = coinsAt(purse) + Math.max(0, Math.floor(amount));
  world.touch('item_instances', purse.id);
}

/**
 * Cobrar: mete `amount` en la bolsa más a mano de un PJ o NPC (si no lleva
 * ninguna, le da una). Devuelve la bolsa.
 */
export function receive(world: World, toId: Id, amount: number): ItemInstance {
  const purse = ensurePurse(world, toId);
  addToPurse(world, purse, amount);
  return purse;
}

/**
 * Pagar: saca `amount` de la bolsa más a mano y sigue por las demás. Todo o
 * nada: si no le llega, no toca nada y dice cuánto lleva. Con `toId` (PJ o
 * NPC), el dinero pasa a su bolsa; sin él, sale del mundo (una multa).
 */
export function pay(world: World, fromId: Id, amount: number, toId?: Id | null): { ok: true; paid: number } | { ok: false; have: number } {
  const n = Math.max(0, Math.floor(amount));
  const have = coinsOf(world, fromId);
  if (have < n) return { ok: false, have };
  if (n === 0 || toId === fromId) return { ok: true, paid: n };
  let left = n;
  for (const i of carriedByReach(world, fromId)) {
    if (left <= 0) break;
    const c = coinsAt(i);
    if (!c) continue;
    const take = Math.min(c, left);
    i.state['coins'] = c - take;
    world.touch('item_instances', i.id);
    left -= take;
  }
  if (toId) receive(world, toId, n);
  return { ok: true, paid: n };
}

/** Saca monedas de una bolsa concreta (robar parte, sacar de la escondida): lo que haya, hasta `amount`. Devuelve cuántas. */
export function takeFromPurse(world: World, purse: ItemInstance, amount: number): number {
  const n = Math.min(coinsAt(purse), Math.max(0, Math.floor(amount)));
  if (n > 0) { purse.state['coins'] = coinsAt(purse) - n; world.touch('item_instances', purse.id); }
  return n;
}

/** Deja el dinero de un PJ o NPC en `amount` (pruebas y administración): mete o saca de sus bolsas. */
export function setCoins(world: World, holderId: Id, amount: number): void {
  const diff = Math.max(0, Math.floor(amount)) - coinsOf(world, holderId);
  if (diff > 0) receive(world, holderId, diff);
  else if (diff < 0) pay(world, holderId, -diff);
  else ensurePurse(world, holderId);
}

/**
 * Partidas de antes de las bolsas: el dinero de cada PJ era un número
 * (`Character.coins`). Pasa a una bolsa nueva al cinto, una vez (el campo se
 * borra). Al muerto sin dinero no se le da bolsa: la recibirá al cobrar.
 * Devuelve si ha cambiado algo.
 */
export function migrateLegacyCoins(snap: WorldSnapshot): boolean {
  let changed = false;
  for (const c of snap.characters as (Character & { coins?: unknown })[]) {
    if (!('coins' in c)) continue;
    const coins = typeof c.coins === 'number' && c.coins > 0 ? Math.floor(c.coins) : 0;
    delete c.coins;
    changed = true;
    if (coins === 0 && c.status === 'dead') continue;
    if (!snap.item_defs.some((d) => d.id === KIT_PURSE_ID)) snap.item_defs.push(kitItemDef('purse', genreOfCampaign(snap.campaign)));
    const beltTaken = snap.item_instances.some((i) => i.location.type === 'character' && i.location.id === c.id && i.location.slot.kind === 'equipped' && i.location.slot.slot === 'belt');
    const base = `ii_bolsa_${c.id.replace(/^ch_/, '')}`;
    let id = base;
    for (let k = 2; snap.item_instances.some((i) => i.id === id); k++) id = `${base}_${k}`;
    snap.item_instances.push({ id, item_id: KIT_PURSE_ID, quantity: 1, location: { type: 'character', id: c.id, slot: beltTaken ? { kind: 'pocket' } : { kind: 'equipped', slot: 'belt' } }, state: { coins } });
  }
  return changed;
}
