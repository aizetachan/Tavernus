/**
 * Arreglos 25 y 26 (tanda 5, INFORME-PASADA-4-2026-11-26): vender a quien compra y cobrar los encargos del tablón.
 *
 * En la tanda 5 el deudor intentó vender la cuerda y las antorchas a Brenna y a Ilse (que no las compran) y el
 * recolector, bayas y truchas que había dejado en el arroyo; el cronista dio por entregada la leña sin llevarla y dejó
 * el agua de Ilse en el brocal. El motor no fallaba, pero no decía quién compra, cuánto pide el encargo ni que es en
 * mano. Aquí: vender a Lucio y a Brenna, el hint con quién compra, el encargo con la cantidad justa, con menos y sin
 * quien lo pidió delante, la charla que sabe que está listo para cobrar y el agua en la mano de Ilse. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { spawnItem } from '../src/engine/inventory.js';
import { coinsOf } from '../src/engine/money.js';
import { buyersOf, buyPrice, stockCount } from '../src/engine/shop.js';
import { jobReadiness } from '../src/engine/progress.js';
import { talkState } from '../src/engine/talk.js';
import { characterStory } from '../src/engine/story.js';
import { claimSituation } from '../src/worldgen/index.js';
import type { Character, Placement } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(deterministic = true) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic, fastTravel: false, rng: () => 0.99 });
  return { engine, time };
}

/** Un PJ con las manos y los bolsillos vacíos, en un punto. */
async function newPc(engine: Engine, name: string, spot: string): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  r.character.location = { type: 'spot', id: spot };
  for (const i of engine.world.itemsCarriedBy(r.character.id)) if (i.location.type === 'character' && i.location.slot.kind !== 'equipped') engine.world.remove('item_instances', i.id);
  return r.character;
}

const hand = (c: Character): Placement => ({ type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } });

/** Pone en su mano `q` de un objeto (sin la regla de peso: lo que importa aquí es que lo lleva). */
function give(engine: Engine, c: Character, itemId: string, q: number): string {
  const spot = engine.world.characterSpot(c)!.id;
  const r = spawnItem(engine.world, itemId, q, { type: 'spot', id: spot });
  if (!r.ok) throw new Error(r.error.code);
  r.moved.location = hand(c);
  engine.world.touch('item_instances', r.moved.id);
  return r.moved.id;
}

function ctxFor(engine: Engine, c: Character): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
}
type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string };
const tool = (engine: Engine, c: Character, name: string, input: Record<string, unknown>) => JSON.parse(executeTool(ctxFor(engine, c), name, input)) as ToolOut;
const carried = (engine: Engine, c: Character, itemId: string) => engine.world.itemsCarriedBy(c.id).filter((i) => i.item_id === itemId).reduce((a, i) => a + i.quantity, 0);
const npcHas = (engine: Engine, npcId: string, itemId: string) => engine.world.itemsIn({ type: 'npc', id: npcId }).filter((i) => i.item_id === itemId).reduce((a, i) => a + i.quantity, 0);

describe('arreglo 25: quién compra en Brezal', () => {
  it('Lucio y Brenna compran con lista, siempre por debajo de lo que venden', async () => {
    const { engine } = await boot();
    const w = engine.world;
    const lucio = w.npc('npc_lucio');
    const brenna = w.npc('npc_brenna');
    for (const id of ['it_cuerda', 'it_antorcha', 'it_garfio', 'it_farol', 'it_kit_hook', 'it_kit_ring']) expect(lucio.buys.some((b) => b.item_id === id), id).toBe(true);
    for (const id of ['it_madera', 'it_bayas', 'it_pescado', 'it_huevo']) expect(brenna.buys.some((b) => b.item_id === id), id).toBe(true);
    for (const n of [lucio, brenna]) for (const b of n.buys) {
      const sells = n.sells.find((s) => s.item_id === b.item_id)?.price;
      if (sells !== undefined) expect(b.price, `${n.name}: ${b.item_id}`).toBeLessThan(sells);
    }
    // Lo que compra de todo a la mitad tampoco pasa de la mitad de lo que él lo vende: la ración vale 50 en el
    // catálogo, Mateo la vende a 8 y Lucio a 12; si la pagara a 25, comprar a Mateo y venderle a él sería negocio.
    lucio.buys = lucio.buys.filter((b) => b.item_id !== 'it_racion');
    expect(buyPrice(w, lucio, 'it_racion')).toBe(6);
  });

  it('vender la cuerda a Lucio: la cuerda pasa a su estante y las monedas, de su bolsa a la del PJ', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Fiona', 'sp_ti_mostrador');
    const rope = give(engine, c, 'it_cuerda', 1);
    const ropes = carried(engine, c, 'it_cuerda');
    const before = { pc: coinsOf(engine.world, c.id), lucio: coinsOf(engine.world, 'npc_lucio'), stock: stockCount(engine.world, engine.world.npc('npc_lucio'), 'it_cuerda') };
    const r = tool(engine, c, 'sell_item', { character_id: c.id, npc_id: 'npc_lucio', instance_id: rope, quantity: null });
    expect(r).toMatchObject({ ok: true, sold: 'cuerda de cáñamo ×1' });
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThan(120); // por debajo de lo que la vende él
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.id === rope)).toBe(false);
    expect(carried(engine, c, 'it_cuerda')).toBe(ropes - 1);
    expect(stockCount(engine.world, engine.world.npc('npc_lucio'), 'it_cuerda')).toBe(before.stock + 1);
    expect(coinsOf(engine.world, c.id)).toBe(before.pc + (r.total as number));
    expect(coinsOf(engine.world, 'npc_lucio')).toBe(before.lucio - (r.total as number));
  });

  it('vender bayas a Brenna en la barra: se las queda y paga su precio', async () => {
    const { engine } = await boot();
    const brenna = engine.world.npc('npc_brenna');
    const c = await newPc(engine, 'Ciro', brenna.location.id);
    const berries = give(engine, c, 'it_bayas', 5);
    const coins = coinsOf(engine.world, c.id);
    const r = tool(engine, c, 'sell_item', { character_id: c.id, npc_id: 'npc_brenna', instance_id: berries, quantity: null });
    expect(r).toMatchObject({ ok: true, sold: 'bayas ×5' });
    expect(coinsOf(engine.world, c.id)).toBe(coins + (r.total as number));
    expect(r.total).toBe(5);
    expect(carried(engine, c, 'it_bayas')).toBe(0);
    expect(npcHas(engine, 'npc_brenna', 'it_bayas')).toBe(5);
  });

  it('venderle la cuerda a Ilse o a Brenna da el hint con quién la compra (deudor, turnos 11 y 21)', async () => {
    const { engine } = await boot();
    const ilse = engine.world.npc('npc_ilse');
    const c = await newPc(engine, 'Fiona', ilse.location.id);
    const rope = give(engine, c, 'it_cuerda', 1);
    const r = tool(engine, c, 'sell_item', { character_id: c.id, npc_id: 'npc_ilse', instance_id: rope, quantity: null });
    expect(r.error).toMatch(/^Ilse no compra cuerda de cáñamo\. Ilse compra bayas, agua del pozo\. Lo compra Lucio Cendal \[npc_lucio\] \(el buhonero, en /);
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.id === rope)).toBe(true);
    // Brenna, en la barra: tampoco, y dice lo que sí compra.
    const brenna = engine.world.npc('npc_brenna');
    c.location = { type: 'spot', id: brenna.location.id };
    const r2 = tool(engine, c, 'sell_item', { character_id: c.id, npc_id: 'npc_brenna', instance_id: rope, quantity: null });
    expect(r2.error).toContain('Brenna no compra cuerda de cáñamo. Brenna compra leña, bayas, trucha');
    expect(r2.error).toContain('Lucio Cendal [npc_lucio]');
    // Quién compra truchas: Brenna, Mateo, y Lucio a la mitad de lo que valen (después de los que la tienen en su lista).
    expect(buyersOf(engine.world, 'it_pescado').map((b) => b.npc.id)).toEqual(['npc_brenna', 'npc_mateo', 'npc_lucio']);
  });

  it('lo que dejó en el arroyo no se vende (recolector, turnos 12 y 39): el hint lo dice', async () => {
    const { engine } = await boot();
    const ilse = engine.world.npc('npc_ilse');
    const c = await newPc(engine, 'Ciro', ilse.location.id);
    const r0 = spawnItem(engine.world, 'it_bayas', 5, { type: 'spot', id: 'sp_cl_arroyo' });
    if (!r0.ok) throw new Error('bayas');
    const r = tool(engine, c, 'sell_item', { character_id: c.id, npc_id: 'npc_ilse', instance_id: r0.moved.id, quantity: null });
    expect(r.error).toMatch(/^bayas no lo lleva encima: solo se vende lo que lleva el actor/);
  });
});

describe('arreglo 26: los encargos del tablón se cierran y se pagan', () => {
  it('la leña con la cantidad justa delante de Brenna: se la da, cobra y sube la reputación', async () => {
    const { engine } = await boot();
    const w = engine.world;
    w.campaign.board.active_job_ids = ['job_lena', 'job_bayas', 'job_ronda'];
    const brenna = w.npc('npc_brenna');
    const c = await newPc(engine, 'Elmo', brenna.location.id);
    give(engine, c, 'it_madera', 10);
    const coins = coinsOf(w, c.id);
    const job = w.campaign.jobs.find((j) => j.id === 'job_lena')!;
    expect(jobReadiness(w, c, job)).toMatchObject({ ready: true, line: expect.stringContaining('listo para cobrar: lleva 10 de leña delante de Brenna') });
    const r = tool(engine, c, 'complete_job', { character_id: c.id, job_id: 'job_lena', npc_id: 'npc_brenna' });
    expect(r).toMatchObject({ ok: true });
    expect(coinsOf(w, c.id)).toBe(coins + job.reward_coins);
    expect(carried(engine, c, 'it_madera')).toBe(0);
    expect(npcHas(engine, 'npc_brenna', 'it_madera')).toBe(10);
    expect(c.completed_jobs).toContain('job_lena');
    expect((r.events as string[])[0]).toContain('Encargo completado: Leña para la posada');
    // Una vez.
    expect(tool(engine, c, 'complete_job', { character_id: c.id, job_id: 'job_lena', npc_id: 'npc_brenna' }).error).toMatch(/ya lo completó/);
  });

  it('con menos leña de la que pide, el hint dice cuánto pide, cuánto lleva y cuánto falta', async () => {
    const { engine } = await boot();
    const w = engine.world;
    w.campaign.board.active_job_ids = ['job_lena'];
    const brenna = w.npc('npc_brenna');
    const c = await newPc(engine, 'Elmo', brenna.location.id);
    give(engine, c, 'it_madera', 3);
    const coins = coinsOf(w, c.id);
    const r = tool(engine, c, 'complete_job', { character_id: c.id, job_id: 'job_lena', npc_id: 'npc_brenna' });
    expect(r.error).toBe('aún no: pide 10 de leña y el actor lleva 3 encima: faltan 7. Solo cuenta lo que lleva encima (manos, cinto, mochila), no lo que dejó en otro sitio');
    expect(carried(engine, c, 'it_madera')).toBe(3);
    expect(coinsOf(w, c.id)).toBe(coins);
    expect(c.completed_jobs).not.toContain('job_lena');
  });

  it('«ya están en la posada» desde la plaza (cronista, turnos 14 y 34): sin leña ni Brenna delante no se cobra, y dice dónde está', async () => {
    const { engine } = await boot();
    const w = engine.world;
    w.campaign.board.active_job_ids = ['job_lena'];
    const c = await newPc(engine, 'Elmo', 'sp_pl_tablon');
    const r = tool(engine, c, 'complete_job', { character_id: c.id, job_id: 'job_lena', npc_id: 'npc_brenna' });
    // reachNpc (tools.ts) corta antes: Brenna no está en la escena.
    expect(r.error).toBeTruthy();
    // A Osric, que no lo pidió: el hint dice quién.
    const job = w.campaign.jobs.find((j) => j.id === 'job_lena')!;
    give(engine, c, 'it_madera', 10);
    expect(jobReadiness(w, c, job)).toEqual({ ready: false, line: expect.stringMatching(/^lleva 10 de leña, lo que pide; falta llevárselo: Brenna no está con el actor \(está en Taberna del Jabalí\): se le entrega en mano y en persona$/) });
    const osric = w.npc('npc_osric');
    c.location = { type: 'spot', id: osric.location.id };
    expect(tool(engine, c, 'complete_job', { character_id: c.id, job_id: 'job_lena', npc_id: 'npc_osric' }).error).toBe('lo pidió Brenna [npc_brenna]: se le entrega a quien lo pidió, en mano');
  });

  it('la charla con Brenna sabe que el encargo está a medias y si está listo para cobrar', async () => {
    const { engine } = await boot();
    const w = engine.world;
    w.campaign.board.active_job_ids = ['job_lena', 'job_bayas', 'job_ronda'];
    const brenna = w.npc('npc_brenna');
    const c = await newPc(engine, 'Elmo', brenna.location.id);
    const st0 = talkState(w, engine.events.all(), c, brenna, engine.nowFor(c));
    expect(st0.can_offer).toContain('Leña para la posada');
    expect(st0.pending).not.toContain('Leña para la posada');
    give(engine, c, 'it_madera', 4);
    const st1 = talkState(w, engine.events.all(), c, brenna, engine.nowFor(c));
    expect(st1.can_offer).not.toContain('Leña para la posada');
    expect(st1.pending).toContain('Leña para la posada');
    expect(st1.jobs).toEqual(['«Leña para la posada»: pide 10 de leña y el actor lleva 4 encima: faltan 6. Solo cuenta lo que lleva encima (manos, cinto, mochila), no lo que dejó en otro sitio']);
    give(engine, c, 'it_madera', 6);
    const st2 = talkState(w, engine.events.all(), c, brenna, engine.nowFor(c));
    expect(st2.jobs[0]).toContain('listo para cobrar: lleva 10 de leña delante de Brenna; complete_job job_lena con npc_id npc_brenna');
  });

  it('el agua del pozo en la mano de Ilse cierra «El agua turbia» y cobra; dejada en el brocal, no (cronista, turnos 3 y 4)', async () => {
    const { engine, time } = await boot(false);
    const r0 = await engine.createCharacter('u_elmo', 'Elmo', { class_id: 'warlock' });
    if (!r0.ok) throw new Error(r0.reason);
    const c = r0.character;
    claimSituation(engine.world, c.id, engine.gameNow());
    c.abilities.str = 18;
    await engine.tick();
    const ilse = engine.world.npc('npc_ilse');
    c.location = { type: 'spot', id: ilse.location.id };
    // Saca el agua del pozo.
    const water = engine.world.itemInstance('ii_agua_pozo');
    expect(tool(engine, c, 'transfer_item', { instance_id: water.id, to_type: 'character', to_id: c.id, slot: 'hand_main', equip_slot: null, quantity: 1 }).error).toBeUndefined();
    await engine.tick();
    // Ilse se la pide en escena.
    ilse.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c), ripe: true };
    time.advanceGame(5);
    await engine.tick();
    expect(characterStory(c).open).toContain('q_agua');
    // La deja en el brocal: «El frasco en el brocal no sabe nada de lo que has visto».
    const mine = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_agua_pozo')!;
    expect(tool(engine, c, 'transfer_item', { instance_id: mine.id, to_type: 'spot', to_id: 'sp_pl_pozo', slot: null, equip_slot: null, quantity: null }).error).toBeUndefined();
    await engine.tick();
    expect(characterStory(c).done).not.toContain('q_agua');
    // La recoge y se la pone en la mano.
    const back = engine.world.itemsIn({ type: 'spot', id: 'sp_pl_pozo' }).find((i) => i.item_id === 'it_agua_pozo')!;
    expect(tool(engine, c, 'transfer_item', { instance_id: back.id, to_type: 'character', to_id: c.id, slot: 'hand_main', equip_slot: null, quantity: 1 }).error).toBeUndefined();
    const coins = coinsOf(engine.world, c.id);
    const held = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_agua_pozo')!;
    expect(tool(engine, c, 'transfer_item', { instance_id: held.id, to_type: 'npc', to_id: 'npc_ilse', slot: null, equip_slot: null, quantity: 1 }).error).toBeUndefined();
    await engine.tick();
    expect(characterStory(c).done).toContain('q_agua');
    expect(c.clues).toContain('clue_ilse');
    expect(coinsOf(engine.world, c.id)).toBe(coins + 50);
  });
});
