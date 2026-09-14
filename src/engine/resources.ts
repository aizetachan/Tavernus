/**
 * Nodos de recurso (SPEC §3.2.5). Se agotan y se regeneran con el reloj.
 * La tirada la hará el master en fase 2; aquí el servidor resuelve rendimiento
 * y estado. `harvest` recibe el resultado de la tirada ya hecho.
 */

import type { Character, Id, ResourceNode } from './model.js';
import { spawnItem, type TransferResult } from './inventory.js';
import type { World } from './world.js';

/** Estado de regeneración 0–1 en un instante de juego. */
export function regenState(node: ResourceNode, nowGameS: number): number {
  if (node.last_harvested_game_s === null) return 1;
  const elapsed = Math.max(0, nowGameS - node.last_harvested_game_s);
  const regen = node.regen_time_s > 0 ? elapsed / node.regen_time_s : 1;
  return Math.min(1, node.regen_state_at_harvest + regen);
}

export type HarvestResult =
  | { ok: true; quantity: number; regen_before: number; regen_after: number; item: TransferResult }
  | { ok: false; code: 'not_here' | 'depleted' | 'missing_tool' | 'failed_check' | 'not_active'; regen: number };

/**
 * Extrae del nodo. `checkPassed` es el resultado de la tirada (skill vs dc)
 * que decide el master/servidor. Con éxito, rinde `yield_max × regen_state`
 * y el nodo baja en proporción (a 0 si es destructivo).
 */
export function harvest(world: World, c: Character, nodeId: Id, checkPassed: boolean, nowGameS: number): HarvestResult {
  const node = world.resourceNode(nodeId);
  const regen = regenState(node, nowGameS);
  if (c.status !== 'active') return { ok: false, code: 'not_active', regen };
  if (world.characterSpot(c)?.id !== node.spot_id) return { ok: false, code: 'not_here', regen };
  if (node.tool_required && !world.itemsCarriedBy(c.id).some((i) => i.item_id === node.tool_required)) {
    return { ok: false, code: 'missing_tool', regen };
  }
  const quantity = Math.floor(node.yield_max * regen);
  if (quantity < 1) return { ok: false, code: 'depleted', regen };
  if (!checkPassed) return { ok: false, code: 'failed_check', regen };

  const after = node.destructive ? 0 : Math.max(0, regen - quantity / node.yield_max);
  node.last_harvested_game_s = nowGameS;
  node.regen_state_at_harvest = after;
  world.touch('resource_nodes', node.id);

  // El recurso cae a las manos si están libres; si no, al suelo del punto.
  let item = spawnItem(world, node.resource_item_id, quantity, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } });
  if (!item.ok) item = spawnItem(world, node.resource_item_id, quantity, { type: 'spot', id: node.spot_id });
  return { ok: true, quantity, regen_before: regen, regen_after: after, item };
}

/** Descripción del nodo según su estado, para narración plana. */
export function describeNode(node: ResourceNode, nowGameS: number): string {
  const r = regenState(node, nowGameS);
  if (r >= 0.99) return `${node.name}, intacto`;
  if (r >= 0.5) return `${node.name}, a medio recuperar`;
  if (r > 0) return `${node.name}, casi agotado`;
  return `${node.name}, agotado`;
}
