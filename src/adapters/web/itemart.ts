/**
 * Arte de los objetos en la mochila: si la campaña trae una imagen escrita del
 * objeto (src/ai/assets.ts, `item` del manifiesto), la casilla la enseña en lugar
 * del icono. Nunca se genera nada: lo que no tiene imagen sigue con su icono, y no
 * depende de IMAGES=on.
 *
 *   GET /api/item-art?character=ID&item=ITEM_ID   la imagen (JPEG o PNG transparente)
 *
 * Solo se sirve la de un objeto que ese PJ lleva encima (en la mano, puesto, en un
 * bolsillo o dentro de lo que lleva): así no se destripa lo que aún no ha encontrado.
 */

import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname } from 'node:path';
import type { Engine } from '../../engine/engine.js';
import type { Id } from '../../engine/model.js';
import { inventoryDetailed, type PackItem, type PackView } from '../../engine/inventory.js';
import { assetsFor, writtenImage } from '../../ai/assets.js';

/** Fichero escrito del tipo de objeto, si lo hay. */
export function itemArtFile(engine: Engine, itemId: Id): string | null {
  return writtenImage(assetsFor(engine.world.campaign.id), 'item', [itemId])?.file ?? null;
}

/** La mochila con `art` (la URL de la imagen) en cada objeto que tiene imagen escrita. */
export function withItemArt<P extends PackView>(engine: Engine, pack: P, characterId: Id, slug: string | null): P {
  const w = engine.world;
  const art = (it: PackItem | null): PackItem | null => {
    if (!it) return it;
    const inst = w.itemInstances.get(it.id);
    if (!inst || !itemArtFile(engine, inst.item_id)) return it;
    const q = new URLSearchParams({ ...(slug ? { game: slug } : {}), character: characterId, item: inst.item_id });
    return { ...it, art: `/api/item-art?${q.toString()}` };
  };
  return {
    ...pack,
    hands: { ...pack.hands, main: art(pack.hands.main), off: art(pack.hands.off) },
    equipped: pack.equipped.map((e) => ({ ...e, item: art(e.item) })),
    pockets: { ...pack.pockets, items: pack.pockets.items.map((x) => art(x)!) },
    containers: pack.containers.map((c) => ({ ...c, items: c.items.map((x) => art(x)!) })),
  };
}

export async function handleItemArtRequest(engine: Engine, res: ServerResponse, url: URL): Promise<void> {
  const id = url.searchParams.get('character');
  const item = url.searchParams.get('item');
  const c = id ? engine.world.characters.get(id) : undefined;
  const carried = !!c && !!item && inventoryDetailed(engine.world, c.id).some((x) => x.item_id === item);
  const file = carried ? itemArtFile(engine, item!) : null;
  let bytes: Buffer | null = null;
  if (file) { try { bytes = await readFile(file); } catch { /* sin fichero */ } }
  if (!bytes) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, text: 'Sin imagen.' }));
    return;
  }
  res.writeHead(200, { 'content-type': extname(file!).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg', 'cache-control': 'private, max-age=3600' });
  res.end(bytes);
}
