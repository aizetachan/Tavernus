/**
 * Ajuar de los NPC (src/engine/outfit.ts). Partida «Humo y ceniza» (VPS, 2026-11): el PJ le robó a Garrán «la
 * bolsa de cuero» con buenas tiradas y la bolsa no existía. Ahora toda persona lleva al empezar algo real que
 * robar o encontrar: una bolsa con monedas, cosas de su oficio y su arma; y las monedas de la bolsa pasan al PJ
 * que la coge. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { allIncidents } from '../src/engine/crime.js';
import { carrierOf, npcCarryList, transferItem } from '../src/engine/inventory.js';
import { KIT_PURSE_ID, kitOf, OUTFIT_VERSION, outfitNpcs, purseCoins, weaponFor } from '../src/engine/outfit.js';
import { killNpc } from '../src/engine/death.js';
import { generateSeed } from '../src/worldgen/index.js';
import { makeSeed } from '../src/data/seed/demo.js';
import type { Character, ItemInstance, WorldSnapshot } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(seed: WorldSnapshot = authoredSeed('brezal', { now: new Date(EPOCH) }), repo = new MemoryRepository()) {
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

/** Lo que lleva un NPC, bajando a sus contenedores. */
function carried(engine: Engine, npcId: string): ItemInstance[] {
  return [...engine.world.itemInstances.values()].filter((i) => carrierOf(engine.world, i.location)?.id === npcId);
}
const names = (engine: Engine, npcId: string) => carried(engine, npcId).map((i) => engine.world.itemDef(i.item_id).name);
const purseOf = (engine: Engine, npcId: string) => carried(engine, npcId).find((i) => engine.world.itemDef(i.item_id).container);

describe('el ajuar de Brezal', () => {
  it('toda persona con estadísticas lleva algo robable; los animales, nada', async () => {
    const { engine } = await boot();
    for (const n of engine.world.npcs.values()) {
      expect(n.outfitted, n.id).toBe(OUTFIT_VERSION);
      if (n.mute) { expect(carried(engine, n.id), n.id).toEqual([]); continue; }
      if (!n.stats) continue;
      const purse = purseOf(engine, n.id);
      expect(purse, `${n.id} lleva bolsa`).toBeDefined();
      // Algo más que la bolsa: cosas de su oficio.
      expect(carried(engine, n.id).length, n.id).toBeGreaterThanOrEqual(2);
    }
    // Todos llevan dinero, salvo Ysolde, que vive en las ruinas.
    for (const id of ['npc_brenna', 'npc_doro', 'npc_osric', 'npc_garran', 'npc_ilse', 'npc_hugo', 'npc_mateo', 'npc_tobias', 'npc_hal', 'npc_ursula']) {
      expect(Number(purseOf(engine, id)!.state['coins']), id).toBeGreaterThan(0);
    }
    expect(purseOf(engine, 'npc_ysolde')!.state['coins']).toBeUndefined();
  });

  it('Garrán lleva la bolsa del diezmo, su trenza, su silbato, su maza y la llave del arcón', async () => {
    const { engine } = await boot();
    const bolsa = engine.world.itemInstance('ii_garran_bolsa');
    expect(engine.world.itemDef(bolsa.item_id).name).toBe('bolsa de cuero');
    expect(bolsa.state['coins']).toBe(430);
    const inside = engine.world.itemsIn({ type: 'container', id: bolsa.id }).map((i) => engine.world.itemDef(i.item_id).name);
    expect(inside).toEqual(expect.arrayContaining(['trenza de esparto', 'silbato de hueso', 'mendrugo de pan']));
    expect(names(engine, 'npc_garran')).toEqual(expect.arrayContaining(['maza', 'llave del arcón del regidor']));
    // Una sola bolsa: la escrita; el ajuar no le pone otra.
    expect(carried(engine, 'npc_garran').filter((i) => engine.world.itemDef(i.item_id).container)).toHaveLength(1);
    // El máster lo ve con su dinero y lo que hay dentro.
    expect(npcCarryList(engine.world, 'npc_garran').join(', ')).toMatch(/bolsa de cuero con 4 de oro y 3 de plata \[ii_garran_bolsa\] \(dentro: trenza de esparto/);
  });

  it('cada oficio con lo suyo: llaves de la tabernera, anillo del regidor, martillo del herrero, arco del cazador', async () => {
    const { engine } = await boot();
    expect(names(engine, 'npc_brenna')).toContain('manojo de llaves');
    expect(names(engine, 'npc_osric')).toEqual(expect.arrayContaining(['anillo de sello', 'manojo de llaves', 'estoque']));
    expect(names(engine, 'npc_hugo')).toEqual(expect.arrayContaining(['martillo', 'puñado de clavos']));
    expect(names(engine, 'npc_hal')).toEqual(expect.arrayContaining(['arco corto', 'sedal y anzuelos']));
    expect(names(engine, 'npc_doro')).toEqual(expect.arrayContaining(['lanza', 'silbato de hueso']));
    expect(names(engine, 'npc_ilse')).toEqual(expect.arrayContaining(['manojo de hierbas secas', 'tónico de corteza']));
    expect(names(engine, 'npc_ysolde')).toContain('amuleto de hueso');
    // Quien no pelea no lleva arma a la vista.
    for (const id of ['npc_brenna', 'npc_ilse', 'npc_mateo', 'npc_tobias', 'npc_ursula']) {
      expect(carried(engine, id).some((i) => engine.world.itemDef(i.item_id).type === 'weapon'), id).toBe(false);
    }
    // El regidor, rico; el cazador, pobre.
    expect(Number(purseOf(engine, 'npc_osric')!.state['coins'])).toBeGreaterThan(Number(purseOf(engine, 'npc_hal')!.state['coins']));
  });
});

describe('robar la bolsa', () => {
  it('quitarle la bolsa a Garrán: las monedas pasan al PJ, la bolsa queda vacía y, si se nota, es un robo', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    engine.world.npc('npc_garran').location = { type: 'spot', id: c.location.id };
    const before = c.coins;
    const ctx = ctxFor(engine, c, { action_text: 'le robo la bolsa a Garrán', roll_category: 'fallo' });
    const r = tool(ctx, 'transfer_item', { instance_id: 'ii_garran_bolsa', to_type: 'character', to_id: c.id, slot: 'hand_off' });
    expect(r.ok).toBe(true);
    expect(r['coins_found']).toBe('4 de oro y 3 de plata');
    expect(c.coins).toBe(before + 430);
    const bolsa = engine.world.itemInstance('ii_garran_bolsa');
    expect(bolsa.state['coins']).toBeUndefined();
    // Lo de dentro viaja con la bolsa.
    expect(carrierOf(engine.world, engine.world.itemInstance('ii_garran_esparto').location)).toEqual({ type: 'character', id: c.id });
    expect(allIncidents(engine.world).some((i) => i.kind === 'theft' && i.victim_id === 'npc_garran')).toBe(true);
  });

  it('sacar algo de su bolsa también es robarle a él', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia');
    engine.world.npc('npc_garran').location = { type: 'spot', id: c.location.id };
    const ctx = ctxFor(engine, c, { action_text: 'le robo la trenza de la bolsa', roll_category: 'fallo' });
    const r = tool(ctx, 'transfer_item', { instance_id: 'ii_garran_esparto', to_type: 'character', to_id: c.id, slot: 'hand_off' });
    expect(r.ok).toBe(true);
    expect(allIncidents(engine.world).some((i) => i.kind === 'theft' && i.victim_id === 'npc_garran')).toBe(true);
  });

  it('la bolsa de un muerto cae al suelo con su dinero, y quien la coge se lo queda', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Nia', 'fighter');
    const hugo = engine.world.npc('npc_hugo');
    hugo.location = { type: 'spot', id: c.location.id };
    const purse = purseOf(engine, 'npc_hugo')!;
    const coins = Number(purse.state['coins']);
    killNpc(engine.world, hugo, engine.gameNow(), null, 'un mal golpe');
    expect(purse.location).toEqual({ type: 'spot', id: c.location.id });
    const before = c.coins;
    // Las manos del guerrero van ocupadas: la bolsa, al bolsillo.
    const r = transferItem(engine.world, purse.id, { type: 'character', id: c.id, slot: { kind: 'pocket' } });
    expect(r.ok && r.coins).toBe(coins);
    expect(c.coins).toBe(before + coins);
  });

  it('lo robado no se repone al volver a arrancar', async () => {
    const repo = new MemoryRepository();
    const { engine, seed } = await boot(undefined, repo);
    const c = await newPc(engine, 'Nia');
    engine.world.npc('npc_garran').location = { type: 'spot', id: c.location.id };
    expect(transferItem(engine.world, 'ii_garran_bolsa', { type: 'character', id: c.id, slot: { kind: 'pocket' } }).ok).toBe(true);
    const total = engine.world.itemInstances.size;
    // La memoria de los tests no aplica las escrituras sueltas: se guarda la foto entera, como haría la base.
    await repo.saveSnapshot(engine.world.snapshot());
    const again = await Engine.boot({ repo, campaignId: seed.campaign.id, seed, now: fakeTime(EPOCH).now, deterministic: true });
    expect(again.world.itemInstances.size).toBe(total);
    expect(carrierOf(again.world, again.world.itemInstance('ii_garran_bolsa').location)).toEqual({ type: 'character', id: c.id });
    expect([...again.world.itemInstances.values()].filter((i) => carrierOf(again.world, i.location)?.id === 'npc_garran' && again.world.itemDef(i.item_id).container)).toHaveLength(0);
  });
});

describe('partidas de antes del ajuar', () => {
  it('al arrancar, Garrán recupera la bolsa escrita y los demás reciben su ajuar, una sola vez', () => {
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    // Una partida guardada antes: sin la bolsa de Garrán, sin su trenza ni la definición de la bolsa, nadie con ajuar.
    const old = structuredClone(seed);
    old.item_instances = old.item_instances.filter((i) => i.id !== 'ii_garran_bolsa' && i.id !== 'ii_garran_esparto');
    old.item_defs = old.item_defs.filter((d) => d.id !== KIT_PURSE_ID && d.id !== 'it_esparto');
    for (const n of old.npcs) delete n.outfitted;
    expect(outfitNpcs(old, seed)).toBe(true);
    const bolsa = old.item_instances.find((i) => i.id === 'ii_garran_bolsa')!;
    expect(bolsa.state['coins']).toBe(430);
    expect(old.item_instances.filter((i) => i.location.type === 'container' && i.location.id === bolsa.id).length).toBeGreaterThanOrEqual(3);
    expect(old.item_instances.filter((i) => i.location.type === 'npc' && i.location.id === 'npc_garran' && i.item_id === KIT_PURSE_ID)).toHaveLength(1);
    const size = old.item_instances.length;
    expect(outfitNpcs(old, seed)).toBe(false);
    expect(old.item_instances).toHaveLength(size);
  });

  it('un NPC muerto no recibe nada', () => {
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    const snap = structuredClone(seed);
    for (const n of snap.npcs) delete n.outfitted;
    snap.item_instances = snap.item_instances.filter((i) => !i.id.startsWith('ii_kit_'));
    const hugo = snap.npcs.find((n) => n.id === 'npc_hugo')!;
    hugo.status = 'dead';
    outfitNpcs(snap);
    expect(snap.item_instances.some((i) => i.location.type === 'npc' && i.location.id === 'npc_hugo')).toBe(false);
  });
});

describe('la regla es agnóstica', () => {
  it('el ajuar sale del oficio, o del campo kit', () => {
    expect(kitOf({ role: 'Posadera' }).id).toBe('innkeeper');
    expect(kitOf({ role: 'capitana de la guardia' }).id).toBe('guard');
    expect(kitOf({ role: 'hermano portero' }).id).toBe('priest');
    expect(kitOf({ role: 'mecánica' }).id).toBe('smith');
    expect(kitOf({ role: 'médico' }).id).toBe('healer');
    expect(kitOf({ role: 'jabalí' }).id).toBe('animal');
    expect(kitOf({ role: 'perro', mute: true }).id).toBe('animal');
    expect(kitOf({ role: 'zapatero remendón' }).id).toBe('smith');
    expect(kitOf({ role: 'alguacil y recaudador' }).id).toBe('money');
    expect(kitOf({ role: 'alguacil y recaudador', kit: 'guard' }).id).toBe('guard');
    expect(kitOf({ role: 'alguien raro' }).id).toBe('commoner');
  });

  it('las monedas se miden por lo que lleva un PJ al empezar y no cambian entre arranques', () => {
    expect(purseCoins('npc_x', 'none', 150)).toBe(0);
    const poor = purseCoins('npc_x', 'poor', 150), rich = purseCoins('npc_x', 'rich', 150);
    expect(poor).toBeGreaterThanOrEqual(7);
    expect(poor).toBeLessThanOrEqual(30);
    expect(rich).toBeGreaterThanOrEqual(300);
    expect(purseCoins('npc_x', 'rich', 150)).toBe(rich);
    // Una campaña con monedas diez veces más finas: diez veces más piezas.
    expect(purseCoins('npc_x', 'rich', 1500)).toBeGreaterThanOrEqual(rich * 10 - 10);
  });

  it('el arma sale del nombre del ataque, si es un arma de verdad', () => {
    const defs = makeSeed().item_defs;
    expect(weaponFor('maza corta', defs)?.id).toBe('it_maza');
    expect(weaponFor('arco', defs)?.id).toBe('it_arco_corto');
    expect(weaponFor('cuchillo', defs)?.id).toBe('it_daga');
    expect(weaponFor('jarra', defs)).toBeNull();
    expect(weaponFor('llama de la Brasa', defs)).toBeNull();
  });

  it('un mundo generado offline: cada persona con bolsa y cosas; con nombres de su género', async () => {
    for (const setting of ['Fantasía medieval de baja magia.', 'Una estación espacial minera en el cinturón.']) {
      const seed = await generateSeed({ seed: 2024, tone: 'grim', setting, client: null, now: () => new Date(EPOCH), characters: [{ name: 'Ana' }] });
      const { engine } = await boot(seed);
      const scifi = seed.campaign.generation?.genre === 'scifi';
      expect(scifi).toBe(setting.includes('espacial'));
      for (const n of engine.world.npcs.values()) {
        const mine = carried(engine, n.id);
        if (kitOf(n).id === 'animal') { expect(mine, n.id).toEqual([]); continue; }
        const purse = mine.find((i) => i.item_id === KIT_PURSE_ID);
        expect(purse, `${setting}: ${n.id} (${n.role})`).toBeDefined();
        expect(engine.world.itemDef(purse!.item_id).name).toBe(scifi ? 'riñonera' : 'bolsa de cuero');
        expect(mine.length, n.id).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('la demo también: Brenna y Doro llevan algo', async () => {
    const { engine } = await boot(makeSeed());
    for (const n of engine.world.npcs.values()) {
      if (kitOf(n).id === 'animal') continue;
      expect(carried(engine, n.id).length, n.id).toBeGreaterThanOrEqual(2);
    }
  });
});
