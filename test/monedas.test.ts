/**
 * El dinero vive en bolsas (PLAN-OBJETOS §5, bloque D; src/engine/money.ts). Antes el dinero de un PJ era un
 * número que nadie le podía quitar; ahora va en su bolsa al cinto, como el de los NPC: pagar saca de la bolsa
 * más a mano, cobrar mete en ella, se le puede robar la bolsa o parte de lo que hay dentro, y al morir la bolsa
 * cae con el cuerpo. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { allIncidents } from '../src/engine/crime.js';
import { bodiesAt, bodyStateOf, damageCharacter } from '../src/engine/death.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { encumbrance, transferItem } from '../src/engine/inventory.js';
import type { Character, WorldSnapshot } from '../src/engine/model.js';
import { coinsOf, migrateLegacyCoins, newPurse, pay, pursesOf, receive, setCoins } from '../src/engine/money.js';
import { KIT_PURSE_ID } from '../src/engine/outfit.js';
import { buyFromNpc } from '../src/engine/progress.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { bootEngine, fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function brezal(repo = new MemoryRepository(), seed: WorldSnapshot = authoredSeed('brezal', { now: new Date(EPOCH) })) {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo, campaignId: seed.campaign.id, seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  return { engine, time, repo, seed };
}

async function newPc(engine: Engine, name: string, class_id = 'rogue'): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id });
  if (!r.ok) throw new Error(r.reason);
  return r.character;
}

function ctxFor(engine: Engine, c: Character, extra: Partial<ToolContext> = {}): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], ...extra };
}
type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string };
const tool = (ctx: ToolContext, name: string, input: Record<string, unknown>) => JSON.parse(executeTool(ctx, name, input)) as ToolOut;

describe('la bolsa del PJ', () => {
  it('todo PJ nuevo empieza con su dinero en una bolsa al cinto', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    const [purse, ...rest] = pursesOf(engine.world, c.id);
    expect(rest).toHaveLength(0);
    expect(purse!.item_id).toBe(KIT_PURSE_ID);
    expect(purse!.location).toEqual({ type: 'character', id: c.id, slot: { kind: 'equipped', slot: 'belt' } });
    expect(purse!.state['coins']).toBe(engine.world.campaign.starting_coins);
    expect(coinsOf(engine.world, c.id)).toBe(engine.world.campaign.starting_coins);
    // Ya no hay número suelto en la ficha.
    expect('coins' in c).toBe(false);
  });

  it('pagar saca de la bolsa más a mano y sigue por la escondida; todo o nada', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    const w = engine.world;
    const belt = pursesOf(w, c.id)[0]!;
    // Una segunda bolsa escondida en la mochila.
    const pack = w.itemsCarriedBy(c.id).find((i) => w.itemDef(i.item_id).container && i.id !== belt.id)!;
    const hidden = newPurse(w, c.id, 0); // una segunda bolsa…
    hidden.location = { type: 'container', id: pack.id }; // …que pasa a su mochila
    hidden.state['coins'] = 1000;
    expect(pursesOf(w, c.id).map((p) => p.id)).toEqual([belt.id, hidden.id]);
    expect(coinsOf(w, c.id)).toBe(150 + 1000);
    expect(pay(w, c.id, 5000)).toEqual({ ok: false, have: 1150 });
    expect(coinsOf(w, c.id)).toBe(1150);
    expect(pay(w, c.id, 200)).toEqual({ ok: true, paid: 200 });
    expect(belt.state['coins']).toBe(0);
    expect(hidden.state['coins']).toBe(950);
    // Cobrar mete en la más a mano, aunque esté vacía.
    receive(w, c.id, 30);
    expect(belt.state['coins']).toBe(30);
  });

  it('comprar pasa el dinero de su bolsa a la del vendedor', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    const w = engine.world;
    const brenna = w.npc('npc_brenna');
    c.location = { type: 'spot', id: brenna.location.id };
    const npcBefore = coinsOf(w, brenna.id);
    const r = buyFromNpc(w, c, brenna.id, brenna.sells[0]!.item_id, 1);
    expect(r.ok).toBe(true);
    const price = r.ok ? r.total : 0;
    expect(coinsOf(w, c.id)).toBe(150 - price);
    expect(coinsOf(w, brenna.id)).toBe(npcBefore + price);
  });

  it('las monedas pesan dentro de su bolsa', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    const before = encumbrance(engine.world, c).weight_lb;
    setCoins(engine.world, c.id, 150 + 50 * 100); // +50 de oro: 1 lb
    expect(encumbrance(engine.world, c).weight_lb).toBeCloseTo(before + 1, 5);
  });
});

describe('robar dinero', () => {
  it('take_coins saca parte de la bolsa de Garrán: el resto se queda, y si se nota es un robo', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    engine.world.npc('npc_garran').location = { type: 'spot', id: c.location.id };
    const ctx = ctxFor(engine, c, { action_text: 'le robo unas monedas de la bolsa a Garrán', roll_category: 'fallo' });
    const r = tool(ctx, 'take_coins', { instance_id: 'ii_garran_bolsa', amount: 100, to_instance_id: null });
    expect(r).toMatchObject({ ok: true, took: '1 de oro', left_in_purse: '3 de oro y 3 de plata' });
    expect(engine.world.itemInstance('ii_garran_bolsa').state['coins']).toBe(330);
    expect(coinsOf(engine.world, c.id)).toBe(250);
    expect(allIncidents(engine.world).some((i) => i.kind === 'theft' && i.victim_id === 'npc_garran')).toBe(true);
    // Pide más de lo que hay: se lleva lo que queda.
    const all = tool(ctxFor(engine, c, { action_text: 'cojo el resto', roll_category: 'exito_claro' }), 'take_coins', { instance_id: 'ii_garran_bolsa', amount: 1000, to_instance_id: null });
    expect(all).toMatchObject({ ok: true, took: '3 de oro y 3 de plata', left_in_purse: 'nada' });
    expect(tool(ctx, 'take_coins', { instance_id: 'ii_garran_bolsa', amount: 1, to_instance_id: null }).error).toBe('empty');
  });

  it('con una buena tirada nadie lo nota; lejos, no llega', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    const garran = engine.world.npc('npc_garran');
    const far = tool(ctxFor(engine, c, { action_text: 'le robo a Garrán' }), 'take_coins', { instance_id: 'ii_garran_bolsa', amount: 10, to_instance_id: null });
    if (garran.location.id !== c.location.id) expect(far.error).toBe('not_reachable');
    garran.location = { type: 'spot', id: c.location.id };
    const r = tool(ctxFor(engine, c, { action_text: 'le robo a Garrán', roll_category: 'exito_claro' }), 'take_coins', { instance_id: 'ii_garran_bolsa', amount: 10, to_instance_id: null });
    expect(r.ok).toBe(true);
    expect(allIncidents(engine.world).some((i) => i.kind === 'theft' && i.victim_id === 'npc_garran')).toBe(false);
  });

  it('esconder dinero: de la bolsa del cinto a otra suya; sin destino, no mueve nada', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    const w = engine.world;
    const belt = pursesOf(w, c.id)[0]!;
    const pack = w.itemsCarriedBy(c.id).find((i) => w.itemDef(i.item_id).container && i.id !== belt.id)!;
    const hidden = newPurse(w, c.id, 0);
    hidden.location = { type: 'container', id: pack.id };
    const ctx = ctxFor(engine, c, { action_text: 'escondo 1 de oro en la bolsa de la mochila' });
    expect(tool(ctx, 'take_coins', { instance_id: belt.id, amount: 100, to_instance_id: null }).error).toBe('own_purse');
    expect(tool(ctx, 'take_coins', { instance_id: belt.id, amount: 100, to_instance_id: hidden.id })).toMatchObject({ ok: true, took: '1 de oro' });
    expect([belt.state['coins'], hidden.state['coins']]).toEqual([50, 100]);
    expect(coinsOf(w, c.id)).toBe(150);
  });

  it('quitarle la bolsa a un NPC: el dinero va dentro y el PJ lo lleva', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    engine.world.npc('npc_garran').location = { type: 'spot', id: c.location.id };
    const r = tool(ctxFor(engine, c, { action_text: 'le robo la bolsa a Garrán', roll_category: 'fallo' }), 'transfer_item', { instance_id: 'ii_garran_bolsa', to_type: 'character', to_id: c.id, slot: 'hand_off' });
    expect(r).toMatchObject({ ok: true, coins_found: '4 de oro y 3 de plata' });
    expect(engine.world.itemInstance('ii_garran_bolsa').state['coins']).toBe(430);
    expect(coinsOf(engine.world, c.id)).toBe(150 + 430);
    expect(coinsOf(engine.world, 'npc_garran')).toBe(0);
  });
});

describe('robar a otro jugador', () => {
  async function pair() {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    const mira = engine.world.character('ch_mira');
    kael.location = { type: 'spot', id: 'sp_pl_pozo' };
    mira.location = { type: 'spot', id: 'sp_pl_pozo' };
    for (const c of [kael, mira]) engine.setConnected(c.id, true);
    return { engine, kael, mira };
  }

  it('sin su reacción, ni parte de la bolsa ni la bolsa entera', async () => {
    const { engine, kael, mira } = await pair();
    const ctx = ctxFor(engine, kael, { action_text: 'le robo unas monedas a Mira' });
    expect(tool(ctx, 'take_coins', { instance_id: 'ii_mira_bolsa', amount: 100, to_instance_id: null }).error).toBe('needs_reaction');
    expect(tool(ctx, 'transfer_item', { instance_id: 'ii_mira_bolsa', to_type: 'character', to_id: kael.id, slot: 'pocket' }).error).toBe('needs_reaction');
    expect(coinsOf(engine.world, mira.id)).toBe(1500);
  });

  it('en el desenlace de su reacción, si la pierde (o la acepta), el máster puede sacarle las monedas', async () => {
    const { engine, kael, mira } = await pair();
    let got: ToolOut | null = null;
    const master: MasterLike = {
      resolve: async (c) => {
        got = tool(ctxFor(engine, c, { action_text: 'le robo unas monedas a Mira' }), 'take_coins', { instance_id: 'ii_mira_bolsa', amount: 500, to_instance_id: null });
        return { ok: true, closed: { narration_private: 'Le sacas unas monedas.', observable: 'Kael se arrima a Mira.', observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null }, usage: {}, calls: [], context: '', model: 'test' };
      },
    };
    engine.attachMaster(master);
    const ctx = ctxFor(engine, kael, { action_text: 'le robo unas monedas a Mira' });
    expect(tool(ctx, 'request_reaction', { target_character_id: mira.id, kind: 'other', attempt: 'sacarte unas monedas de la bolsa', destination_spot_id: null, actor_skill: 'sleight_of_hand', target_skills: 'perception' })).toMatchObject({ pending_reaction: true });
    await engine.answerReaction(mira.id, mira.reactions![0]!.id, 'accept');
    expect(got).toMatchObject({ ok: true, took: '5 de oro' });
    expect([coinsOf(engine.world, kael.id), coinsOf(engine.world, mira.id)]).toEqual([2000, 1000]);
    // Fuera del desenlace, otra vez no.
    expect(tool(ctx, 'take_coins', { instance_id: 'ii_mira_bolsa', amount: 100, to_instance_id: null }).error).toBe('needs_reaction');
  });

  it('dar monedas a otro PJ las pasa de bolsa a bolsa', async () => {
    const { engine, kael, mira } = await pair();
    const off = engine.offer(kael.id, mira.id, { instance_id: null, coins: 300 });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    await engine.answerOffer(mira.id, off.offer.id, true);
    expect([coinsOf(engine.world, kael.id), coinsOf(engine.world, mira.id)]).toEqual([1200, 1800]);
    expect(engine.world.itemInstance('ii_mira_bolsa').state['coins']).toBe(1800);
  });
});

describe('morir', () => {
  it('la bolsa cae con el cuerpo; en hardcore, quien saquea se la lleva con el dinero dentro', async () => {
    const { engine } = await bootEngine(fakeTime(), { rng: () => 0.99 });
    const kael = engine.world.character('ch_kael');
    const mira = engine.world.character('ch_mira');
    mira.location = { type: 'spot', id: 'sp_tab_barra' };
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    kael.death_mode = 'hardcore';
    damageCharacter(engine.world, kael, 40, { cause: 'una roca' });
    await engine.tick();
    expect(kael.status).toBe('dead');
    const body = bodiesAt(engine.world, 'sp_tab_barra')[0]!;
    expect(engine.world.itemInstance('ii_kael_bolsa').location).toEqual({ type: 'container', id: body.id });
    expect(kael.death!.coins_left).toBe(1500);
    expect(bodyStateOf(body)!.coins).toBe(0);
    expect(coinsOf(engine.world, kael.id)).toBe(0);
    const r = await engine.act(mira.id, 'saquear el cuerpo de Kael');
    expect(r.text).toMatch(/bolsa de cuero con 15 de oro/);
    expect(coinsOf(engine.world, mira.id)).toBe(3000);
  });

  it('los cuerpos de antes de las bolsas siguen dando sus monedas sueltas', async () => {
    const { engine } = await bootEngine(fakeTime(), { rng: () => 0.99 });
    const kael = engine.world.character('ch_kael');
    const mira = engine.world.character('ch_mira');
    for (const c of [kael, mira]) c.location = { type: 'spot', id: 'sp_tab_barra' };
    kael.death_mode = 'hardcore';
    damageCharacter(engine.world, kael, 40, { cause: 'una roca' });
    await engine.tick();
    const body = bodiesAt(engine.world, 'sp_tab_barra')[0]!;
    bodyStateOf(body)!.coins = 70; // como guardaba el cuerpo antes
    const r = await engine.act(mira.id, 'saquear el cuerpo de Kael');
    expect(r.text).toMatch(/7 de plata/);
    expect(coinsOf(engine.world, mira.id)).toBe(1500 + 1500 + 70);
  });
});

describe('partidas guardadas de antes', () => {
  it('el número de monedas de cada PJ pasa a una bolsa al cinto, una vez, sin perder nada', async () => {
    const repo = new MemoryRepository();
    const { engine, seed } = await brezal(repo);
    const c = await newPc(engine, 'Nia');
    const snap = structuredClone(engine.world.snapshot());
    // Como estaba guardada: el dinero en la ficha y sin bolsa.
    snap.item_instances = snap.item_instances.filter((i) => !(i.location.type === 'character' && i.location.id === c.id && i.item_id === KIT_PURSE_ID));
    (snap.characters.find((x) => x.id === c.id) as Character & { coins?: number }).coins = 1234;
    await repo.saveSnapshot(snap);
    const again = await Engine.boot({ repo, campaignId: seed.campaign.id, seed, now: fakeTime(EPOCH).now, deterministic: true });
    const c2 = again.world.character(c.id);
    expect('coins' in c2).toBe(false);
    expect(coinsOf(again.world, c.id)).toBe(1234);
    expect(pursesOf(again.world, c.id)[0]!.location).toEqual({ type: 'character', id: c.id, slot: { kind: 'equipped', slot: 'belt' } });
    // Una sola vez.
    const after = again.world.snapshot();
    expect(migrateLegacyCoins(after)).toBe(false);
    expect(pursesOf(again.world, c.id)).toHaveLength(1);
  });

  it('el muerto sin dinero no recibe bolsa; con el cinto ocupado, va al bolsillo', () => {
    const snap = authoredSeed('brezal', { now: new Date(EPOCH) });
    const base = { id: 'ch_a', status: 'active', location: { type: 'spot', id: 'sp_x' } } as unknown as Character;
    snap.characters.push({ ...base, coins: 50 } as Character, { ...base, id: 'ch_b', status: 'dead', coins: 0 } as Character);
    snap.item_instances.push({ id: 'ii_cinto', item_id: KIT_PURSE_ID, quantity: 1, location: { type: 'character', id: 'ch_a', slot: { kind: 'equipped', slot: 'belt' } }, state: {} });
    expect(migrateLegacyCoins(snap)).toBe(true);
    const mine = snap.item_instances.filter((i) => i.location.type === 'character' && ['ch_a', 'ch_b'].includes(i.location.id));
    expect(mine.map((i) => [i.id, i.location.type === 'character' ? i.location.slot.kind : '', i.state['coins']])).toEqual([['ii_cinto', 'equipped', undefined], ['ii_bolsa_a', 'pocket', 50]]);
  });
});

describe('quien no lleva bolsa', () => {
  it('cobrar le da una; pagar sin ninguna no le llega', async () => {
    const { engine } = await brezal();
    const c = await newPc(engine, 'Nia');
    const w = engine.world;
    for (const p of pursesOf(w, c.id)) w.remove('item_instances', p.id);
    expect(coinsOf(w, c.id)).toBe(0);
    expect(pay(w, c.id, 1)).toEqual({ ok: false, have: 0 });
    const purse = receive(w, c.id, 40);
    expect(purse.location).toEqual({ type: 'character', id: c.id, slot: { kind: 'equipped', slot: 'belt' } });
    expect(coinsOf(w, c.id)).toBe(40);
    // Y la bolsa se puede soltar: el dinero se queda en el suelo, dentro.
    expect(transferItem(w, purse.id, { type: 'spot', id: c.location.id }).ok).toBe(true);
    expect(coinsOf(w, c.id)).toBe(0);
  });
});
