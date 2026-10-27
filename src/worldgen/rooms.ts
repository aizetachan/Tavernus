/**
 * Cuartos de alquiler en mundos generados. La habitación de la posada es un
 * punto visible cerrado con llave (`state.locked`, `state.key_item_id`); quien
 * atiende la posada vende «noche de posada», un servicio que al comprarse
 * (buy_item) o fiarse a cambio de una prenda (pawn_item) entrega la llave y
 * abre el cuarto para ese PJ (progress.ts, deliverGoods). Antes la habitación
 * era el premio oculto del logro y en un mundo generado no se podía dormir.
 *
 * `migrateRentableRooms` arregla las partidas ya generadas al abrirlas: la
 * habitación premio pasa a visible y cerrada, el premio pasa a otro punto
 * oculto (la trampilla) y el posadero empieza a vender la noche.
 */

import type { ItemDef, Npc, Spot, WorldSnapshot } from '../engine/model.js';

export const ROOM_KEY_ITEM_ID = 'it_llave_cuarto';
export const ROOM_NIGHT_ITEM_ID = 'it_noche_posada';
export const ROOM_NIGHT_PRICE = 20;

export const ROOM_ITEMS: readonly ItemDef[] = [
  { id: ROOM_KEY_ITEM_ID, name: 'llave del cuarto', aliases: ['llave', 'llave del cuarto', 'llave de la habitación'], type: 'tool', size: 'tiny', weight_lb: 0.1, value: 0, unique: false, origin: 'custom' },
  { id: ROOM_NIGHT_ITEM_ID, name: 'noche de posada', aliases: ['noche', 'cuarto', 'habitación', 'cama'], type: 'misc', size: 'tiny', weight_lb: 0, value: ROOM_NIGHT_PRICE, unique: false, origin: 'custom', service: { gives_item_id: ROOM_KEY_ITEM_ID } },
];

/** Estado de una habitación de alquiler: cerrada, se abre con su llave. */
export function lockedRoomState(): Record<string, unknown> {
  return { locked: true, key_item_id: ROOM_KEY_ITEM_ID };
}

/** Un cuarto de alquiler en la plantilla: un punto con cama (tag `bed`) de una posada. */
export function isRentableRoom(s: Pick<Spot, 'id' | 'tags'>): boolean {
  return s.tags.includes('bed') && /^sp_inn_/.test(s.id);
}

/** Quién vende la noche: el posadero de esa localización o, si no, cualquiera que esté en ella. */
export function roomSeller(npcs: readonly Npc[], spots: readonly Spot[], locationId: string): Npc | undefined {
  const here = npcs.filter((n) => spots.find((s) => s.id === n.location.id)?.location_id === locationId && n.status === 'alive');
  return here.find((n) => /posader|tabern|mesoner/i.test(n.role)) ?? here[0];
}

/** Partidas generadas antes de los cuartos de alquiler. Devuelve si ha cambiado algo. */
export function migrateRentableRooms(snap: WorldSnapshot): boolean {
  if (!snap.campaign.generation) return false;
  let changed = false;
  for (const d of ROOM_ITEMS) if (!snap.item_defs.some((x) => x.id === d.id)) { snap.item_defs.push(structuredClone(d)); changed = true; }
  const ach = snap.campaign.achievement;
  for (const room of snap.spots.filter(isRentableRoom)) {
    if (room.state['locked'] !== undefined) continue;
    const seller = roomSeller(snap.npcs, snap.spots, room.location_id);
    if (!seller) continue;
    if (ach.reward_spot_id === room.id) {
      // El premio pasa a otro punto oculto: el de la misma posada (la trampilla) o el de cualquier sitio.
      const hidden = snap.spots.filter((s) => s.hidden && s.id !== room.id && !isRentableRoom(s));
      const next = hidden.find((s) => s.location_id === room.location_id) ?? hidden[0];
      ach.reward_spot_id = next?.id ?? null;
      // El anuncio hablaba de abrir la habitación: se quitan las frases que la nombran.
      const words = [room.name, ...room.aliases].map((w) => w.toLowerCase()).filter((w) => w.length >= 5);
      const kept = ach.announcement.split(/(?<=[.!?])\s+/).filter((f) => !words.some((w) => f.toLowerCase().includes(w)));
      if (kept.length && kept.join(' ').includes('{name}')) ach.announcement = kept.join(' ');
    }
    room.hidden = false;
    room.state = { ...room.state, ...lockedRoomState() };
    // Su puerta se ve desde la sala (spots.ts).
    room.visible_from ??= snap.spots.filter((s) => s.location_id === room.location_id && s.id !== room.id && !s.hidden).map((s) => s.id);
    if (!seller.sells.some((x) => x.item_id === ROOM_NIGHT_ITEM_ID)) seller.sells.push({ item_id: ROOM_NIGHT_ITEM_ID, price: ROOM_NIGHT_PRICE });
    changed = true;
  }
  return changed;
}
