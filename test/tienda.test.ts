/**
 * Tiendas (src/engine/shop.ts, PLAN-OBJETOS §6). Un NPC con tienda vende de existencias reales (ejemplares en sus
 * estantes, contenedores fijos con `owner_id`), compra con el dinero de su bolsa y coger de sus estantes sin pagar
 * es robo. En Brezal, Lucio Cendal, el buhonero atrapado por el Cerco, que no repone. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { allIncidents } from '../src/engine/crime.js';
import { carrierOf, spawnItem } from '../src/engine/inventory.js';
import { buyFromNpc, sellToNpc } from '../src/engine/progress.js';
import { coinsOf, setCoins } from '../src/engine/money.js';
import { openShops, restockShops, shopClosed, shopLines, stockCount, stockOf, stockOwnerOf } from '../src/engine/shop.js';
import { validateSnapshot } from '../src/worldgen/validate.js';
import { generateSeed } from '../src/worldgen/index.js';
import { GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import type { Character, WorldSnapshot } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
/** Las 18:00 del primer día (Brezal empieza a esa hora): la tienda está abierta. */
const OPEN = 18 * GAME_HOUR;

async function boot(seed: WorldSnapshot = authoredSeed('brezal', { now: new Date(EPOCH) })) {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  return { engine, time };
}

async function newPc(engine: Engine, name: string, spot = 'sp_ti_mostrador'): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  r.character.location = { type: 'spot', id: spot };
  // Mano y bolsillos libres para lo que compre.
  for (const i of engine.world.itemsCarriedBy(r.character.id)) if (i.location.type === 'character' && i.location.slot.kind !== 'equipped') engine.world.remove('item_instances', i.id);
  return r.character;
}

function ctxFor(engine: Engine, c: Character, extra: Partial<ToolContext> = {}): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], ...extra };
}
type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string };
const tool = (ctx: ToolContext, name: string, input: Record<string, unknown>) => JSON.parse(executeTool(ctx, name, input)) as ToolOut;

describe('la tienda del buhonero en Brezal', () => {
  it('la campaña valida, con su local, sus estantes y el dueño en la ley', async () => {
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    expect(validateSnapshot(seed)).toEqual([]);
    const { engine } = await boot(seed);
    const a = engine.world.npc('npc_lucio');
    expect(a.shop).toMatchObject({ location_id: 'loc_tienda', restock: 'none', hours: [9, 19] });
    expect(engine.world.campaign.law?.owners?.some((o) => o.npc_id === 'npc_lucio' && o.location_ids.includes('loc_tienda'))).toBe(true);
    // Sus llaves abren la trastienda; su bolsa lleva lo que ha ido cobrando.
    expect(engine.world.spot('sp_ti_trastienda').state['key_item_id']).toBe('it_llaves_cendal');
    expect(carrierOf(engine.world, engine.world.itemInstance('ii_cendal_llaves').location)).toEqual({ type: 'npc', id: 'npc_lucio' });
    expect(coinsOf(engine.world, a.id)).toBe(600);
    expect(stockCount(engine.world, a, 'it_cuerda')).toBe(2);
    expect(stockCount(engine.world, a, 'it_sal')).toBe(2);
  });

  it('lo mágico es poco y del lore: la tapa del cuenco de cuna la lleva Lucio encima y no está a la venta', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    const a = engine.world.npc('npc_lucio');
    setCoins(engine.world, c.id, 10_000);
    const tapa = engine.world.itemInstance('ii_cendal_tapa');
    expect(carrierOf(engine.world, tapa.location)).toEqual({ type: 'npc', id: 'npc_lucio' });
    expect(engine.world.itemDef('it_tapa_cuna').rarity).toBe('uncommon');
    // En la tienda no hay nada mágico: ni pociones ni pergaminos.
    expect(stockOf(engine.world, a).filter((i) => engine.world.itemDef(i.item_id).rarity)).toEqual([]);
    expect(shopLines(engine.world, a, c).map((l) => l.item_id)).not.toContain('it_tapa_cuna');
    expect(buyFromNpc(engine.world, c, a.id, 'it_tapa_cuna', 1, OPEN)).toMatchObject({ ok: false });
    // Su secreto de aliado la nombra; el de Ilse, que al cuenco le falta la tapa.
    expect(a.knowledge!.find((k) => k.tier === 'ally')!.text).toMatch(/tapa redonda de hierro negro/);
    expect(engine.world.npc('npc_ilse').knowledge!.find((k) => k.tier === 'ally')!.text).toMatch(/le falta su tapa de hierro frío/);
  });

  it('comprar baja las existencias y no crea nada; lo pagado va a su bolsa', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    const a = engine.world.npc('npc_lucio');
    setCoins(engine.world, c.id, 1000);
    // Cuerdas que hay en el mundo: las mismas antes y después (pasan del estante a sus manos).
    const ropes = () => [...engine.world.itemInstances.values()].filter((i) => i.item_id === 'it_cuerda').reduce((s, i) => s + i.quantity, 0);
    const before = ropes();
    const r = buyFromNpc(engine.world, c, a.id, 'it_cuerda', 1, OPEN);
    expect(r).toMatchObject({ ok: true, item: 'cuerda de cáñamo', quantity: 1 });
    expect(stockCount(engine.world, a, 'it_cuerda')).toBe(1);
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === 'it_cuerda' && i.location.type === 'character')).toBe(true);
    expect(ropes()).toBe(before);
    if (!r.ok) throw new Error();
    expect(coinsOf(engine.world, c.id)).toBe(1000 - r.total);
    expect(coinsOf(engine.world, a.id)).toBe(600 + r.total);
  });

  it('sin existencias no se vende, aunque esté en su lista; y no vende más de lo que le queda', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    const a = engine.world.npc('npc_lucio');
    setCoins(engine.world, c.id, 5000);
    expect(buyFromNpc(engine.world, c, a.id, 'it_garfio', 2, OPEN)).toEqual({ ok: false, reason: 'a Lucio Cendal solo le queda 1 de garfio de abordaje' });
    expect(buyFromNpc(engine.world, c, a.id, 'it_garfio', 1, OPEN).ok).toBe(true);
    expect(buyFromNpc(engine.world, c, a.id, 'it_garfio', 1, OPEN)).toEqual({ ok: false, reason: 'a Lucio Cendal no le queda garfio de abordaje' });
    // Lo de la trastienda también se vende desde el mostrador (sin entrar).
    expect(buyFromNpc(engine.world, c, a.id, 'it_sal', 1, OPEN).ok).toBe(true);
    expect(stockCount(engine.world, a, 'it_sal')).toBe(1);
    // La vista de la tienda ya no lo enseña.
    expect(shopLines(engine.world, a, c).map((l) => l.item_id)).not.toContain('it_garfio');
  });

  it('no repone: el valle está sellado', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    const a = engine.world.npc('npc_lucio');
    setCoins(engine.world, c.id, 5000);
    buyFromNpc(engine.world, c, a.id, 'it_farol', 1, OPEN);
    restockShops(engine.world, OPEN + 3 * GAME_DAY);
    expect(stockCount(engine.world, a, 'it_farol')).toBe(0);
  });

  it('fuera de su horario, o fuera de su tienda, no atiende', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    const a = engine.world.npc('npc_lucio');
    setCoins(engine.world, c.id, 1000);
    expect(shopClosed(a, 22 * GAME_HOUR)).toMatch(/abre de 9 a 19/);
    expect(buyFromNpc(engine.world, c, a.id, 'it_tiza', 1, GAME_DAY + 7 * GAME_HOUR)).toMatchObject({ ok: false });
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    expect(buyFromNpc(engine.world, c, a.id, 'it_tiza', 1, OPEN)).toEqual({ ok: false, reason: 'hay que ir a la tienda de Lucio Cendal' });
  });

  it('venderle algo lo pone en sus estantes y le paga de su bolsa; si no le llega, no compra', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    const a = engine.world.npc('npc_lucio');
    setCoins(engine.world, c.id, 0);
    // Una piel (en su lista, a 120) y un hacha (no está en su lista: la mitad de lo que vale).
    const piel = spawnItem(engine.world, 'it_piel', 1, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } });
    if (!piel.ok) throw new Error();
    const r = sellToNpc(engine.world, c, a.id, piel.moved.id, 1, OPEN);
    expect(r).toMatchObject({ ok: true, item: 'piel de lobo', quantity: 1 });
    if (!r.ok) throw new Error();
    expect(coinsOf(engine.world, c.id)).toBe(r.total);
    expect(coinsOf(engine.world, a.id)).toBe(600 - r.total);
    expect(stockCount(engine.world, a, 'it_piel')).toBe(1);
    expect(stockOwnerOf(engine.world, engine.world.itemInstance(piel.moved.id))?.id).toBe('npc_lucio');
    const hacha = spawnItem(engine.world, 'it_hacha', 1, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } });
    if (!hacha.ok) throw new Error();
    expect(sellToNpc(engine.world, c, a.id, hacha.moved.id, 1, OPEN)).toMatchObject({ ok: true, total: 250 });
    // Una copa de plata vale 40 de oro: la mitad no le llega.
    const copa = spawnItem(engine.world, 'it_libro_cuentas', 1, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } });
    if (!copa.ok) throw new Error();
    expect(sellToNpc(engine.world, c, a.id, copa.moved.id, 1, OPEN)).toMatchObject({ ok: false });
    engine.world.itemDefs.set('it_joya', { id: 'it_joya', name: 'joya', aliases: [], type: 'treasure', size: 'tiny', weight_lb: 0, value: 10000, unique: false, origin: 'custom' });
    const joya = spawnItem(engine.world, 'it_joya', 1, { type: 'character', id: c.id, slot: { kind: 'pocket' } });
    if (!joya.ok) throw new Error();
    const cash = coinsOf(engine.world, a.id);
    expect(sellToNpc(engine.world, c, a.id, joya.moved.id, 1, OPEN)).toMatchObject({ ok: false, reason: expect.stringMatching(/no le llega/) });
    expect(coinsOf(engine.world, a.id)).toBe(cash);
    expect(carrierOf(engine.world, engine.world.itemInstance(joya.moved.id).location)).toEqual({ type: 'character', id: c.id });
  });

  it('coger algo del estante sin pagar es robo, con el buhonero delante', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia', 'sp_ti_estantes');
    const ctx = ctxFor(engine, c, { action_text: 'cojo la tiza del estante', roll_category: 'fallo' });
    const r = tool(ctx, 'transfer_item', { instance_id: 'ii_cendal_tiza', to_type: 'character', to_id: c.id, slot: 'hand_main', quantity: 1 });
    expect(r.ok).toBe(true);
    const inc = allIncidents(engine.world).find((i) => i.kind === 'theft' && i.victim_id === 'npc_lucio');
    expect(inc).toBeDefined();
    expect(inc!.knowers.some((k) => k.npc_id === 'npc_lucio')).toBe(true);
    // Ya no le vende (crime.ts, refusesService).
    setCoins(engine.world, c.id, 1000);
    expect(buyFromNpc(engine.world, c, 'npc_lucio', 'it_antorcha', 1, OPEN)).toMatchObject({ ok: false });
  });

  it('robar del carro con el buhonero dentro de la tienda: robo, pero él no lo ve', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia', 'sp_pl_carro');
    const ctx = ctxFor(engine, c, { action_text: 'cojo un odre del carro', roll_category: 'fallo' });
    expect(tool(ctx, 'transfer_item', { instance_id: 'ii_cendal_odres', to_type: 'character', to_id: c.id, slot: 'hand_main', quantity: 1 }).ok).toBe(true);
    const inc = allIncidents(engine.world).find((i) => i.kind === 'theft' && i.victim_id === 'npc_lucio');
    expect(inc).toBeDefined();
    expect(inc!.knowers.some((k) => k.npc_id === 'npc_lucio')).toBe(false);
  });

  it('el botón de comprar de la web: sin máster, con su evento', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    setCoins(engine.world, c.id, 100);
    const r = await engine.shopBuy(c.id, 'npc_lucio', 'it_antorcha', 2);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/^Compras 2 × antorcha a Lucio Cendal por/);
    expect(stockCount(engine.world, engine.world.npc('npc_lucio'), 'it_antorcha')).toBe(4);
    const bad = await engine.shopBuy(c.id, 'npc_lucio', 'it_farol', 1);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/^Faltan/);
  });
});

describe('tiendas en mundos generados', () => {
  it('el mercader recibe estante con lo que vende y repone cada día', async () => {
    // El primer mundo generado (sin API) que tenga mercader, posadero o lonjero con algo que vender.
    let seed: WorldSnapshot | null = null;
    for (let s = 1; s < 60 && !seed; s++) {
      const snap = await generateSeed({ seed: s, tone: 'grim', setting: '', client: null, now: () => new Date(EPOCH) });
      if (snap.npcs.some((n) => n.shop)) seed = snap;
    }
    if (!seed) throw new Error('ningún mundo con tienda');
    const shops = seed.npcs.filter((n) => n.shop);
    expect(shops.length).toBeGreaterThan(0);
    expect(validateSnapshot(seed)).toEqual([]);
    expect(openShops(seed)).toBe(false); // idempotente
    const { engine } = await boot(seed);
    const m = engine.world.npc(shops[0]!.id);
    const goods = m.sells.filter((s) => !engine.world.itemDef(s.item_id).service);
    expect(stockOf(engine.world, m).length).toBeGreaterThan(0);
    const first = goods[0]!.item_id;
    const had = stockCount(engine.world, m, first);
    for (const i of stockOf(engine.world, m).filter((x) => x.item_id === first)) engine.world.remove('item_instances', i.id);
    expect(stockCount(engine.world, m, first)).toBe(0);
    restockShops(engine.world, 0); // primer aviso: apunta el día
    restockShops(engine.world, 2 * GAME_DAY);
    expect(had).toBeGreaterThan(0);
    expect(stockCount(engine.world, m, first)).toBe(4);
  });

  it('un NPC sin tienda sigue como siempre: vende de su lista sin contar existencias', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia', 'sp_tab_barra');
    setCoins(engine.world, c.id, 100);
    expect(engine.world.npc('npc_brenna').shop).toBeUndefined();
    expect(buyFromNpc(engine.world, c, 'npc_brenna', 'it_cerveza', 1, OPEN)).toMatchObject({ ok: true });
    expect(buyFromNpc(engine.world, c, 'npc_brenna', 'it_cerveza', 1, OPEN)).toMatchObject({ ok: true });
  });
});
