import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetManifests } from '../src/ai/assets.js';
import { handleItemArtRequest, withItemArt } from '../src/adapters/web/itemart.js';
import { packView, spawnItem } from '../src/engine/inventory.js';
import { bootEngine } from './helpers.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/** Respuesta mínima: guarda estado, cabeceras y cuerpo. */
function fakeRes() {
  const r = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) };
  const res = {
    writeHead(s: number, h: Record<string, string>) { r.status = s; r.headers = h; return res; },
    end(b?: Buffer | string) { r.body = Buffer.isBuffer(b) ? b : Buffer.from(b ?? ''); return res; },
  };
  return { res: res as unknown as ServerResponse, r };
}

describe('arte de los objetos en la mochila', () => {
  let root: string;
  const prevEnv = process.env['ASSETS_DIR'];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tavernus-itemart-'));
    const dir = join(root, 'campaigns', 'demo');
    await mkdir(join(dir, 'objeto'), { recursive: true });
    await writeFile(join(dir, 'objeto', 'it_daga.png'), PNG);
    // it_cuerda está en el manifiesto pero su fichero no existe: sigue con icono.
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ campaigns: ['demo'], item: { it_daga: 'objeto/it_daga.png', it_cuerda: 'objeto/it_cuerda.png' } }));
    process.env['ASSETS_DIR'] = join(root, 'campaigns');
    forgetManifests();
  });
  afterEach(async () => {
    if (prevEnv === undefined) delete process.env['ASSETS_DIR']; else process.env['ASSETS_DIR'] = prevEnv;
    forgetManifests();
    await rm(root, { recursive: true, force: true });
  });

  it('la casilla lleva la imagen solo si el objeto la tiene, y solo se sirve si el PJ lo lleva', async () => {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    const w = engine.world;
    const pocket = { type: 'character', id: 'ch_kael', slot: { kind: 'pocket' } } as const;
    const daga = spawnItem(w, 'it_daga', 1, pocket);
    // La cuerda no cabe en un bolsillo: a la otra mano.
    const cuerda = spawnItem(w, 'it_cuerda', 1, { type: 'character', id: 'ch_kael', slot: { kind: 'hand', which: 'off' } });
    expect([daga, cuerda]).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);

    const pack = withItemArt(engine, packView(w, 'ch_kael'), 'ch_kael', 'demo');
    const items = [pack.hands.main, pack.hands.off, ...pack.equipped.map((e) => e.item), ...pack.pockets.items, ...pack.containers.flatMap((c) => c.items)].filter((x) => x !== null);
    expect(items.some((x) => w.itemInstances.get(x.id)?.item_id === 'it_cuerda')).toBe(true);
    const withArt = items.filter((x) => x.art);
    // Las dagas (la que trae Kael y la nueva) llevan su imagen; lo demás, el icono.
    expect(withArt.length).toBeGreaterThan(0);
    expect(withArt.every((x) => w.itemInstances.get(x.id)?.item_id === 'it_daga')).toBe(true);
    expect(withArt[0]!.art).toBe('/api/item-art?game=demo&character=ch_kael&item=it_daga');
    expect(items.filter((x) => w.itemInstances.get(x.id)?.item_id !== 'it_daga').every((x) => !x.art)).toBe(true);

    const ok = fakeRes();
    await handleItemArtRequest(engine, ok.res, new URL('http://x/api/item-art?character=ch_kael&item=it_daga'));
    expect(ok.r.status).toBe(200);
    expect(ok.r.headers['content-type']).toBe('image/png');
    expect(ok.r.body).toEqual(PNG);

    // Otro PJ que no la lleva, o un objeto sin imagen: nada.
    const other = fakeRes();
    await handleItemArtRequest(engine, other.res, new URL('http://x/api/item-art?character=ch_mira&item=it_daga'));
    expect(other.r.status).toBe(404);
    const noArt = fakeRes();
    await handleItemArtRequest(engine, noArt.res, new URL('http://x/api/item-art?character=ch_kael&item=it_cuerda'));
    expect(noArt.r.status).toBe(404);
  });
});
