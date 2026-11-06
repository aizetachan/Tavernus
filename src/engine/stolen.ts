/**
 * Lo robado sin testigos (docs/CONVERSACION-FLUJO.md, capa 1; decisión de Miguel del 06-11: «que echen en falta cosas
 * que le han robado y las busquen»).
 *
 * El robo lo marca el plan de conflictos (docs/CONFLICTOS-NPC.md §8): el ejemplar robado guarda en `state.stolen` de
 * quién era, cuándo, el total de la tirada de Juego de manos y quién estaba cerca. Este módulo solo lo lee y apunta
 * lo que sigue:
 *
 *   1. notarlo: al cambiar de actividad (como mucho una vez por hora de juego), su Percepción pasiva contra el total
 *      de la tirada; si no llega, no lo nota esa vez;
 *   2. sospechar: del primer PJ que estaba cerca;
 *   3. buscarlo: mientras le falte, la charla lo lleva en la primera frase (talk.ts, bandera `stolen`);
 *   4. reconocerlo: si lo ve encima del PJ (en la mano o puesto), la bandera pasa a `caught` y manda la reacción del
 *      plan de conflictos.
 */

import type { Character, Id, ItemInstance, Npc } from './model.js';
import type { World } from './world.js';

/** `item.state.stolen`: la forma es la del plan de conflictos; los tres últimos campos los pone este módulo. */
export interface StolenMark {
  /** De quién era. */
  from_npc_id: Id;
  /** Cuándo se lo quitaron (juego). */
  game_s: number;
  /** Total de la tirada de Juego de manos: la CD para notarlo. */
  roll_total: number;
  /** Quién estaba cerca (PJ y NPC). */
  near: Id[];
  /** Cuándo lo echó en falta; sin campo, aún no. */
  noticed_game_s?: number;
  /** De quién sospecha (un PJ que estaba cerca), si de alguien. */
  suspect_id?: Id | null;
  /** Última vez que lo intentó notar, para no tirar más de una vez por hora. */
  checked_game_s?: number;
}

/** Cada cuánto vuelve a mirar si le falta algo: un cambio de actividad (una hora de juego). */
export const NOTICE_EVERY_S = 3600;

export function stolenMark(i: ItemInstance): StolenMark | null {
  const s = i.state?.['stolen'] as Partial<StolenMark> | undefined;
  return s && typeof s.from_npc_id === 'string' && typeof s.game_s === 'number' ? (s as StolenMark) : null;
}

/** Lo que le han robado a un NPC y aún no ha vuelto a él. */
export function stolenFrom(world: World, npcId: Id): { item: ItemInstance; mark: StolenMark }[] {
  const out: { item: ItemInstance; mark: StolenMark }[] = [];
  for (const item of world.itemInstances.values()) {
    const mark = stolenMark(item);
    if (!mark || mark.from_npc_id !== npcId) continue;
    if (item.location.type === 'npc' && item.location.id === npcId) continue;
    out.push({ item, mark });
  }
  return out;
}

/**
 * Pasada del motor (engine.ts, con los incidentes): cada NPC despierto que aún no ha notado un robo lo intenta una vez
 * por hora de juego, con su Percepción pasiva contra la tirada. Devuelve los que lo notan en esta pasada.
 */
export function noticeThefts(world: World, nowG: number): { npc: Npc; item: ItemInstance; mark: StolenMark }[] {
  const out: { npc: Npc; item: ItemInstance; mark: StolenMark }[] = [];
  for (const item of world.itemInstances.values()) {
    const mark = stolenMark(item);
    if (!mark || mark.noticed_game_s !== undefined) continue;
    const npc = world.npcs.get(mark.from_npc_id);
    if (!npc || npc.status !== 'alive' || npc.down || (item.location.type === 'npc' && item.location.id === npc.id)) continue;
    if (nowG - (mark.checked_game_s ?? mark.game_s) < NOTICE_EVERY_S) continue;
    mark.checked_game_s = nowG;
    if (npc.passive_perception >= mark.roll_total) {
      mark.noticed_game_s = nowG;
      mark.suspect_id = mark.near.find((id) => world.characters.has(id)) ?? null;
      out.push({ npc, item, mark });
    }
    world.touch('item_instances', item.id);
  }
  return out;
}

/** ¿Lo lleva a la vista el PJ? En la mano o puesto; en un bolsillo o en la mochila, no se ve. */
export function carriedInSight(world: World, pc: Character, item: ItemInstance): boolean {
  const p = item.location;
  return p.type === 'character' && p.id === pc.id && (p.slot.kind === 'hand' || p.slot.kind === 'equipped');
}

/**
 * Lo que sabe este NPC de sus cosas robadas, para la charla con este PJ: `caught` si ve encima del PJ algo suyo que
 * ha echado en falta; `suspects` si sospecha de él; `missing` si lo echa en falta sin saber quién. null si nada.
 */
export function theftWith(world: World, npc: Npc, pc: Character): { kind: 'caught' | 'suspects' | 'missing'; item: string } | null {
  let best: { kind: 'caught' | 'suspects' | 'missing'; item: string } | null = null;
  const rank = { caught: 3, suspects: 2, missing: 1 } as const;
  for (const { item, mark } of stolenFrom(world, npc.id)) {
    if (mark.noticed_game_s === undefined) continue;
    const name = world.itemDefs.get(item.item_id)?.name ?? 'algo suyo';
    const kind = carriedInSight(world, pc, item) ? 'caught' : mark.suspect_id === pc.id ? 'suspects' : 'missing';
    if (!best || rank[kind] > rank[best.kind]) best = { kind, item: name };
  }
  return best;
}
