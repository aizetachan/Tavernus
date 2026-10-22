/**
 * Deudas y prendas: lo que un PJ debe a un NPC deja de vivir solo en la
 * narración y en `npc.memory` y pasa a ser estado del mundo, con cantidad,
 * plazo y, si dejó algo a cambio, la prenda que el NPC guarda.
 *
 *   - set_debt: anota (o corrige) lo que debe a un NPC: «la cuenta, 1.000».
 *   - pawn_item: le deja un objeto en prenda. El objeto pasa al NPC y queda
 *     ligado a la deuda; si es a cambio de algo que vende (una noche de
 *     posada), se lo entrega fiado y la deuda es su precio.
 *   - settle_debt: paga con monedas (todo o parte), la salda trabajando o la
 *     da por perdida (el NPC se queda la prenda). Al saldarla, la prenda vuelve.
 *
 * Una deuda abierta por NPC: lo nuevo con el mismo NPC se suma a ella. Las
 * saldadas se guardan unas pocas, para el Diario. Viven en `character.debts`
 * (propiedad opcional): viajan con el snapshot sin migración.
 */

import { transferItem } from './inventory.js';
import type { Character, Debt, Id, Npc, Placement } from './model.js';
import { deliverGoods } from './progress.js';
import type { World } from './world.js';

const DAY_S = 24 * 3600;
/** Saldadas que se conservan para el Diario. */
export const SETTLED_KEPT = 10;
export const SETTLE_HOW = ['coins', 'work', 'forfeit'] as const;
export type SettleHow = (typeof SETTLE_HOW)[number];

export function openDebts(c: Character): Debt[] {
  return (c.debts ?? []).filter((d) => !d.settled);
}

export function debtWith(c: Character, npcId: Id): Debt | undefined {
  return openDebts(c).find((d) => d.npc_id === npcId);
}

/** 1000 → «1.000» (como se escribe en castellano). */
export function fmtCoins(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** «vence mañana», «vence hoy a las 20:00», «vence en 3 días», «vencida»; null sin plazo. */
export function dueText(dueGameS: number | null, nowGameS: number): string | null {
  if (dueGameS === null) return null;
  if (dueGameS <= nowGameS) return 'vencida';
  const days = Math.floor(dueGameS / DAY_S) - Math.floor(nowGameS / DAY_S);
  if (days === 0) {
    const m = Math.floor((dueGameS % DAY_S) / 60);
    return `vence hoy a las ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  return days === 1 ? 'vence mañana' : `vence en ${days} días`;
}

/** «Debes 1.000 a Marisa Quijano, vence mañana, prenda: espada larga». */
export function debtLine(world: World, d: Debt, nowGameS: number, npcName: (n: Npc) => string, withIds = false): string {
  const npc = world.npcs.get(d.npc_id);
  const who = npc ? `${npcName(npc)}${withIds ? ` [${npc.id}]` : ''}` : d.npc_id;
  const pawn = d.collateral_instance_id ? world.itemInstances.get(d.collateral_instance_id) : undefined;
  const pawnName = pawn ? `${world.itemDef(pawn.item_id).name}${withIds ? ` [${pawn.id}]` : ''}` : null;
  return [`Debes ${fmtCoins(d.amount)} a ${who}`, dueText(d.due_game_s, nowGameS), pawnName ? `prenda: ${pawnName}` : null].filter(Boolean).join(', ');
}

function store(c: Character): Debt[] {
  c.debts ??= [];
  return c.debts;
}

function newDebt(c: Character, npcId: Id, nowGameS: number): Debt {
  const d: Debt = { id: `db_${npcId}_${Math.round(nowGameS).toString(36)}`, npc_id: npcId, amount: 0, reason: '', due_game_s: null, created_game_s: nowGameS };
  store(c).push(d);
  return d;
}

function validAmount(n: unknown): number | null {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 && v <= 1_000_000 ? v : null;
}

/** Anota lo que debe a un NPC o corrige la deuda abierta con él (cantidad, motivo, plazo). */
export function setDebt(world: World, c: Character, input: { npc_id: Id; amount: unknown; reason: string; due_game_s: number | null }, nowGameS: number): { ok: true; debt: Debt; existing: boolean } | { ok: false; error: string } {
  const npc = world.npcs.get(input.npc_id);
  if (!npc) return { ok: false, error: `no existe el NPC ${input.npc_id}` };
  const amount = validAmount(input.amount);
  if (amount === null) return { ok: false, error: 'amount debe ser un número entero de monedas mayor que 0' };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'reason vacío: di por qué se debe («la cuenta de la posada»)' };
  const cur = debtWith(c, npc.id);
  const d = cur ?? newDebt(c, npc.id, nowGameS);
  d.amount = amount;
  d.reason = reason.slice(0, 160);
  d.due_game_s = input.due_game_s;
  world.touch('characters', c.id);
  return { ok: true, debt: d, existing: Boolean(cur) };
}

/**
 * Deja un objeto del PJ en prenda a un NPC (que ya está a su alcance). Con
 * `for_item_id`, a cambio de algo de su lista de venta, que se entrega fiado:
 * la deuda sube su precio. Sin él, la prenda garantiza la deuda abierta con
 * ese NPC o una nueva de `amount`.
 */
export function pawnItem(world: World, c: Character, input: { npc_id: Id; instance_id: Id; for_item_id: Id | null; amount: unknown; reason: string; due_game_s: number | null }, nowGameS: number): { ok: true; debt: Debt; item: string; received: string | null; unlocked: string[] } | { ok: false; error: string } {
  const npc = world.npcs.get(input.npc_id);
  if (!npc) return { ok: false, error: `no existe el NPC ${input.npc_id}` };
  const inst = world.itemInstances.get(input.instance_id);
  if (!inst || !world.itemsCarriedBy(c.id).some((i) => i.id === inst.id)) return { ok: false, error: `${c.name} no lleva ${input.instance_id}: la prenda tiene que ser algo suyo (IDs en el inventario del contexto)` };
  const cur = debtWith(c, npc.id);
  if (cur?.collateral_instance_id) return { ok: false, error: `${npc.name} ya guarda una prenda de ${c.name} por esa deuda` };
  const offer = input.for_item_id ? npc.sells.find((s) => s.item_id === input.for_item_id) : undefined;
  if (input.for_item_id && !offer) return { ok: false, error: `${npc.name} no vende ${input.for_item_id}: mira su lista «Vende» en el contexto` };
  const amount = offer ? offer.price : validAmount(input.amount) ?? (cur ? 0 : null);
  if (amount === null) return { ok: false, error: 'sin for_item_id hace falta amount (lo que garantiza la prenda) o una deuda ya anotada con set_debt' };

  const from = inst.location;
  const moved = transferItem(world, inst.id, { type: 'npc', id: npc.id });
  if (!moved.ok) return { ok: false, error: `no se pudo dar la prenda: ${moved.error.code}${'reason' in moved.error ? ` (${moved.error.reason})` : ''}` };
  let received: string | null = null;
  let unlocked: string[] = [];
  if (offer) {
    const g = deliverGoods(world, c, npc, offer.item_id, 1);
    if (!g.ok) {
      transferItem(world, moved.moved.id, from);
      return { ok: false, error: g.reason };
    }
    received = g.item; unlocked = g.unlocked;
  }
  const d = cur ?? newDebt(c, npc.id, nowGameS);
  d.amount += amount;
  d.reason = [cur?.reason, input.reason.trim() || (received ? received : 'prenda')].filter(Boolean).join('; ').slice(0, 160);
  if (input.due_game_s !== null) d.due_game_s = input.due_game_s;
  d.collateral_instance_id = moved.moved.id;
  world.touch('characters', c.id);
  return { ok: true, debt: d, item: world.itemDef(moved.moved.item_id).name, received, unlocked };
}

/** Devuelve la prenda al PJ: a una mano libre, al bolsillo o, si no cabe, al suelo de su punto. */
function returnCollateral(world: World, c: Character, instanceId: Id): string | null {
  const inst = world.itemInstances.get(instanceId);
  if (!inst) return null;
  const name = world.itemDef(inst.item_id).name;
  const slots: Placement[] = [
    { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } },
    { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } },
    { type: 'character', id: c.id, slot: { kind: 'hand', which: 'both' } },
    { type: 'character', id: c.id, slot: { kind: 'pocket' } },
  ];
  for (const to of slots) if (transferItem(world, inst.id, to).ok) return name;
  const spot = world.characterSpot(c);
  if (spot && transferItem(world, inst.id, { type: 'spot', id: spot.id }).ok) return `${name} (en el suelo: no le caben las manos)`;
  return null;
}

/**
 * Salda (o rebaja) la deuda abierta con un NPC. coins: paga `amount` (o todo)
 * con sus monedas; si queda algo, sigue abierta y la prenda no vuelve. work:
 * saldada por trabajo hecho. forfeit: la da por perdida y el NPC se queda la
 * prenda. Lo saldado se guarda para el Diario.
 */
export function settleDebt(world: World, c: Character, input: { npc_id: Id; how: string; amount: unknown }, nowGameS: number): { ok: true; paid: number; remaining: number; returned: string | null; kept: string | null; settled: boolean } | { ok: false; error: string } {
  const d = debtWith(c, input.npc_id);
  if (!d) return { ok: false, error: `${c.name} no debe nada a ${world.npcs.get(input.npc_id)?.name ?? input.npc_id}` };
  if (!SETTLE_HOW.includes(input.how as SettleHow)) return { ok: false, error: `how debe ser ${SETTLE_HOW.join(', ')}` };
  const how = input.how as SettleHow;
  let paid = 0;
  if (how === 'coins') {
    const want = input.amount == null ? d.amount : validAmount(input.amount);
    if (want === null) return { ok: false, error: 'amount debe ser un número de monedas mayor que 0, o null para pagarlo todo' };
    paid = Math.min(want, d.amount);
    if (c.coins < paid) return { ok: false, error: `${c.name} tiene ${fmtCoins(c.coins)} monedas y hacen falta ${fmtCoins(paid)}` };
    c.coins -= paid;
    d.amount -= paid;
  } else d.amount = 0;
  let returned: string | null = null;
  let kept: string | null = null;
  const settled = d.amount <= 0;
  if (settled) {
    d.settled = { game_s: nowGameS, how };
    if (d.collateral_instance_id) {
      const inst = world.itemInstances.get(d.collateral_instance_id);
      if (how === 'forfeit') kept = inst ? world.itemDef(inst.item_id).name : null;
      else returned = returnCollateral(world, c, d.collateral_instance_id);
    }
    const done = store(c).filter((x) => x.settled);
    if (done.length > SETTLED_KEPT) c.debts = store(c).filter((x) => x !== done[0]);
  }
  world.touch('characters', c.id);
  return { ok: true, paid, remaining: d.amount, returned, kept, settled };
}
