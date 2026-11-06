/**
 * Catálogo SRD de objetos (src/data/srd/items.ts, src/data/catalog.ts; PLAN-OBJETOS §3). Las tablas de aquí
 * están copiadas a mano del SRD 5.1 (precio, peso, daño, CA) y no salen del módulo: si una definición se
 * desvía del SRD, falla. Más: todas las definiciones validan en los tres géneros; Brezal, la demo y un mundo
 * generado arrancan con el catálogo; la partida guarda solo lo que usa; y una partida vieja se pone al día sin
 * tocar lo propio de la campaña. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { CATALOG, catalogFor, COMMON_ITEMS, compactSnapshot, syncCatalog } from '../src/data/catalog.js';
import { GENRE_NAMES, SRD_CATALOG_VERSION, SRD_ITEMS, SRD_MOUNTS, SRD_VEHICLES, srdCatalog, type SrdItemDef } from '../src/data/srd/items.js';
import { spellById } from '../src/data/srd/spells.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { rollExpr } from '../src/engine/dice.js';
import { ITEM_TYPES, itemDefErrors, normalizeItemDef } from '../src/engine/items.js';
import { Engine } from '../src/engine/engine.js';
import type { ItemDef, WorldSnapshot } from '../src/engine/model.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { TRADE_ITEMS } from '../src/worldgen/fill.js';
import { generateSeed } from '../src/worldgen/index.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 10, 6, 12, 0, 0);
const byEn = new Map(SRD_ITEMS.map((d) => [d.en, d]));
const en = (name: string): SrdItemDef => {
  const d = byEn.get(name);
  if (!d) throw new Error(`no está en el catálogo: ${name}`);
  return d;
};

// Precio SRD en cobre.
const GP = 100, SP = 10;

/** Armas del SRD 5.1: [nombre, precio en cobre, peso, daño, tipo, propiedades, alcance]. */
const WEAPONS: [string, number, number, string, string, string[], [number, number]?][] = [
  ['Club', 1 * SP, 2, '1d4', 'bludgeoning', ['light']],
  ['Dagger', 2 * GP, 1, '1d4', 'piercing', ['finesse', 'light', 'thrown'], [20, 60]],
  ['Greatclub', 2 * SP, 10, '1d8', 'bludgeoning', ['two_handed']],
  ['Handaxe', 5 * GP, 2, '1d6', 'slashing', ['light', 'thrown'], [20, 60]],
  ['Javelin', 5 * SP, 2, '1d6', 'piercing', ['thrown'], [30, 120]],
  ['Light hammer', 2 * GP, 2, '1d4', 'bludgeoning', ['light', 'thrown'], [20, 60]],
  ['Mace', 5 * GP, 4, '1d6', 'bludgeoning', []],
  ['Quarterstaff', 2 * SP, 4, '1d6', 'bludgeoning', ['versatile']],
  ['Sickle', 1 * GP, 2, '1d4', 'slashing', ['light']],
  ['Spear', 1 * GP, 3, '1d6', 'piercing', ['thrown', 'versatile'], [20, 60]],
  ['Light crossbow', 25 * GP, 5, '1d8', 'piercing', ['ammunition', 'loading', 'two_handed'], [80, 320]],
  ['Dart', 5, 0.25, '1d4', 'piercing', ['finesse', 'thrown'], [20, 60]],
  ['Shortbow', 25 * GP, 2, '1d6', 'piercing', ['ammunition', 'two_handed'], [80, 320]],
  ['Sling', 1 * SP, 0, '1d4', 'bludgeoning', ['ammunition'], [30, 120]],
  ['Battleaxe', 10 * GP, 4, '1d8', 'slashing', ['versatile']],
  ['Flail', 10 * GP, 2, '1d8', 'bludgeoning', []],
  ['Glaive', 20 * GP, 6, '1d10', 'slashing', ['heavy', 'reach', 'two_handed']],
  ['Greataxe', 30 * GP, 7, '1d12', 'slashing', ['heavy', 'two_handed']],
  ['Greatsword', 50 * GP, 6, '2d6', 'slashing', ['heavy', 'two_handed']],
  ['Halberd', 20 * GP, 6, '1d10', 'slashing', ['heavy', 'reach', 'two_handed']],
  ['Lance', 10 * GP, 6, '1d12', 'piercing', ['reach', 'special']],
  ['Longsword', 15 * GP, 3, '1d8', 'slashing', ['versatile']],
  ['Maul', 10 * GP, 10, '2d6', 'bludgeoning', ['heavy', 'two_handed']],
  ['Morningstar', 15 * GP, 4, '1d8', 'piercing', []],
  ['Pike', 5 * GP, 18, '1d10', 'piercing', ['heavy', 'reach', 'two_handed']],
  ['Rapier', 25 * GP, 2, '1d8', 'piercing', ['finesse']],
  ['Scimitar', 25 * GP, 3, '1d6', 'slashing', ['finesse', 'light']],
  ['Shortsword', 10 * GP, 2, '1d6', 'piercing', ['finesse', 'light']],
  ['Trident', 5 * GP, 4, '1d6', 'piercing', ['thrown', 'versatile'], [20, 60]],
  ['War pick', 5 * GP, 2, '1d8', 'piercing', []],
  ['Warhammer', 15 * GP, 2, '1d8', 'bludgeoning', ['versatile']],
  ['Whip', 2 * GP, 3, '1d4', 'slashing', ['finesse', 'reach']],
  ['Blowgun', 10 * GP, 1, '1', 'piercing', ['ammunition', 'loading'], [25, 100]],
  ['Hand crossbow', 75 * GP, 3, '1d6', 'piercing', ['ammunition', 'light', 'loading'], [30, 120]],
  ['Heavy crossbow', 50 * GP, 18, '1d10', 'piercing', ['ammunition', 'heavy', 'loading', 'two_handed'], [100, 400]],
  ['Longbow', 50 * GP, 2, '1d8', 'piercing', ['ammunition', 'heavy', 'two_handed'], [150, 600]],
  ['Net', 1 * GP, 3, '0', 'bludgeoning', ['special', 'thrown'], [5, 15]],
];

/** Armaduras del SRD 5.1: [nombre, precio, peso, CA base, tope DES, desventaja en Sigilo, FUE mínima]. */
const ARMORS: [string, number, number, number, number | null, boolean, number?][] = [
  ['Padded armor', 5 * GP, 8, 11, null, true],
  ['Leather armor', 10 * GP, 10, 11, null, false],
  ['Studded leather armor', 45 * GP, 13, 12, null, false],
  ['Hide armor', 10 * GP, 12, 12, 2, false],
  ['Chain shirt', 50 * GP, 20, 13, 2, false],
  ['Scale mail', 50 * GP, 45, 14, 2, true],
  ['Breastplate', 400 * GP, 20, 14, 2, false],
  ['Half plate', 750 * GP, 40, 15, 2, true],
  ['Ring mail', 30 * GP, 40, 14, 0, true],
  ['Chain mail', 75 * GP, 55, 16, 0, true, 13],
  ['Splint armor', 200 * GP, 60, 17, 0, true, 15],
  ['Plate armor', 1500 * GP, 65, 18, 0, true, 15],
];

/** Una muestra del equipo de aventurero, herramientas y comida: [nombre, precio, peso]. */
const GEAR: [string, number, number][] = [
  ['Backpack', 2 * GP, 5], ['Bedroll', 1 * GP, 7], ['Candle', 1, 0], ['Chain (10 feet)', 5 * GP, 10], ['Chest', 5 * GP, 25],
  ['Crowbar', 2 * GP, 5], ['Grappling hook', 2 * GP, 4], ['Healer\'s kit', 5 * GP, 3], ['Lantern, hooded', 5 * GP, 2],
  ['Oil (flask)', 1 * SP, 1], ['Rations (1 day)', 5 * SP, 2], ['Rope, hempen (50 feet)', 1 * GP, 10], ['Rope, silk (50 feet)', 10 * GP, 5],
  ['Sack', 1, 0.5], ['Spellbook', 50 * GP, 3], ['Spyglass', 1000 * GP, 1], ['Tinderbox', 5 * SP, 1], ['Torch', 1, 1],
  ['Waterskin', 2 * SP, 5], ['Barrel', 2 * GP, 70], ['Ladder (10-foot)', 1 * SP, 25], ['Potion of healing', 50 * GP, 0.5],
  ['Component pouch', 25 * GP, 2], ['Amulet', 5 * GP, 1], ['Orb', 20 * GP, 3],
  ['Thieves\' tools', 25 * GP, 1], ['Smith\'s tools', 20 * GP, 8], ['Herbalism kit', 5 * GP, 3], ['Lute', 35 * GP, 2], ['Dice set', 1 * SP, 0],
  ['Ale (mug)', 4, 1], ['Saddle, riding', 10 * GP, 25], ['Feed (per day)', 5, 10], ['Silk (1 sq. yd.)', 10 * GP, 1],
];

const TYPES = new Set<string>(ITEM_TYPES);
const SIZES = new Set(['tiny', 'small', 'medium', 'large', 'bulky']);

describe('el catálogo SRD', () => {
  it('las 37 armas, con precio, peso, daño y propiedades del SRD', () => {
    const weapons = SRD_ITEMS.filter((d) => d.type === 'weapon' && !d.rarity);
    expect(weapons).toHaveLength(37);
    const count = (s: string) => weapons.filter((d) => d.subtype === s).length;
    expect([count('simple_melee'), count('simple_ranged'), count('martial_melee'), count('martial_ranged')]).toEqual([10, 4, 18, 5]);
    for (const [name, value, weight, damage, type, props, range] of WEAPONS) {
      const d = en(name);
      expect({ value: d.value, weight: d.weight_lb, damage: d.weapon?.damage, type: d.weapon?.damage_type }, name).toEqual({ value, weight, damage, type });
      expect([...(d.weapon!.properties ?? [])].sort(), name).toEqual([...props].sort());
      expect(d.weapon!.range, name).toEqual(range);
      // Lo que el motor ya lee (sutil, a distancia, a dos manos) sale de las propiedades.
      expect(!!d.weapon!.finesse, name).toBe(props.includes('finesse'));
      expect(!!d.weapon!.two_handed, name).toBe(props.includes('two_handed'));
      expect(!!d.weapon!.ranged, name).toBe(d.subtype!.endsWith('ranged'));
      if (props.includes('versatile')) expect(d.weapon!.versatile_damage, name).toMatch(/^1d(8|10)$/);
      if (props.includes('ammunition')) expect(d.weapon!.ammo_type, name).toBeTruthy();
    }
  });

  it('las 12 armaduras y el escudo, con CA, tope de DES, Sigilo y fuerza del SRD', () => {
    const armors = SRD_ITEMS.filter((d) => d.type === 'armor' && !d.rarity);
    expect(armors).toHaveLength(13);
    for (const [name, value, weight, ac, dexMax, stealth, strMin] of ARMORS) {
      const d = en(name);
      expect({ value: d.value, weight: d.weight_lb, ac: d.armor?.ac_base, dex: d.armor?.dex_max, stealth: d.armor?.stealth_disadvantage, str: d.armor?.str_min, slot: d.equip_slot }, name)
        .toEqual({ value, weight, ac, dex: dexMax, stealth, str: strMin, slot: 'body' });
      // Ponerse y quitarse: 1, 5 y 10 minutos; quitarse, 1, 1 y 5.
      const don = { light: [60, 60], medium: [300, 60], heavy: [600, 300] }[d.subtype as 'light'];
      expect([d.armor?.don_s, d.armor?.doff_s], name).toEqual(don);
    }
    const shield = en('Shield');
    expect({ value: shield.value, weight: shield.weight_lb, bonus: shield.shield_bonus }).toEqual({ value: 10 * GP, weight: 6, bonus: 2 });
  });

  it('la munición va por pieza al precio del paquete del SRD', () => {
    expect([en('Arrow').value, en('Arrow').weight_lb]).toEqual([5, 0.05]);
    expect([en('Crossbow bolt').value, en('Crossbow bolt').weight_lb]).toEqual([5, 0.075]);
    expect(en('Sling bullet').value * 20).toBeCloseTo(4);
    expect(en('Blowgun needle').value * 50).toBeCloseTo(100);
    // Cada arma de munición tiene la suya en el catálogo.
    const ammoTypes = new Set<string | undefined>(SRD_ITEMS.filter((d) => d.type === 'ammunition').map((d) => d.subtype));
    for (const w of SRD_ITEMS.filter((d) => d.weapon?.ammo_type)) expect(ammoTypes.has(w.weapon!.ammo_type), w.en).toBe(true);
  });

  it('el equipo, las herramientas, la comida y las mercancías, a precio y peso del SRD', () => {
    for (const [name, value, weight] of GEAR) expect([en(name).value, en(name).weight_lb], name).toEqual([value, weight]);
    expect(SRD_ITEMS.filter((d) => d.type === 'gear').length).toBeGreaterThanOrEqual(60);
    const tools = (sub: string) => SRD_ITEMS.filter((d) => d.type === 'tool' && d.subtype === sub).length;
    expect([tools('artisan'), tools('gaming'), tools('instrument')]).toEqual([17, 2, 10]);
    expect(SRD_ITEMS.filter((d) => d.subtype === 'trade')).toHaveLength(17);
    expect(SRD_MOUNTS).toHaveLength(8);
    expect(SRD_VEHICLES).toHaveLength(11);
  });

  it('el lote mágico: pociones, pergaminos por nivel, +1/+2/+3, anillo, capas, bolsa, varita y botas', () => {
    expect(['Potion of healing', 'Potion of greater healing', 'Potion of superior healing', 'Potion of supreme healing'].map((n) => en(n).heals))
      .toEqual(['2d4+2', '4d4+4', '8d4+8', '10d4+20']);
    const scrolls = SRD_ITEMS.filter((d) => d.type === 'scroll');
    expect(scrolls.map((d) => d.spell!.level)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(scrolls.map((d) => d.spell!.save_dc)).toEqual([13, 13, 13, 15, 15, 17, 17, 18, 18, 19]);
    expect(scrolls.map((d) => d.spell!.attack_bonus)).toEqual([5, 5, 5, 7, 7, 9, 9, 10, 10, 11]);
    expect(en('Longsword +2')).toMatchObject({ rarity: 'rare', bonus: { attack: 2, damage: 2 }, weapon: { damage: '1d8' }, base_id: 'it_espada_larga', unidentified: { name: 'espada larga' } });
    expect(en('Chain mail +1')).toMatchObject({ rarity: 'rare', bonus: { ac: 1 }, armor: { ac_base: 16 }, base_id: 'it_cota_malla' });
    expect(en('Shield +3')).toMatchObject({ rarity: 'very_rare', bonus: { ac: 3 }, shield_bonus: 2 });
    expect(en('Arrow +1')).toMatchObject({ rarity: 'uncommon', bonus: { attack: 1, damage: 1 } });
    expect(en('Ring of protection')).toMatchObject({ rarity: 'rare', attunement: true, bonus: { ac: 1 }, effects: [{ kind: 'save_bonus', value: 1 }] });
    expect(en('Cloak of protection')).toMatchObject({ rarity: 'uncommon', attunement: true, bonus: { ac: 1 }, effects: [{ kind: 'save_bonus', value: 1 }] });
    expect(en('Bag of holding')).toMatchObject({ weight_lb: 15, container: { max_weight_lb: 500 } });
    expect(en('Wand of magic missiles')).toMatchObject({ charges: { max: 7, recharge: { amount: '1d6+1', at: 'dawn' }, destroy_on_empty: true }, spell: { spell_id: 'magic_missile' } });
    expect(spellById(en('Wand of magic missiles').spell!.spell_id!)).toBeTruthy();
    expect(en('Boots of elvenkind').attunement).toBeUndefined();
    expect(en('Cloak of elvenkind').attunement).toBe(true);
    expect(en('Boots of elvenkind').effects).toContainEqual({ kind: 'advantage', on: 'stealth' });
    // La poción de curación se compra y se reconoce: sin rareza (no sale «sin identificar»).
    expect(en('Potion of healing').rarity).toBeUndefined();
  });

  it('todas las definiciones validan, en los tres géneros', () => {
    for (const genre of ['fantasy', 'scifi', 'postapoc'] as const) {
      const list = catalogFor(genre);
      const ids = list.map((d) => d.id);
      expect(new Set(ids).size, `${genre}: ids repetidos`).toBe(ids.length);
      const names = list.map((d) => d.name.toLowerCase());
      expect(names.filter((n, i) => names.indexOf(n) !== i), `${genre}: nombres repetidos`).toEqual([]);
      for (const d of list as (ItemDef & Partial<SrdItemDef>)[]) {
        const tag = `${genre} ${d.id}`;
        // La validación del modelo (bloque A): subtipos, propiedades, alcance, munición, magia con rareza, conjuros.
        expect(itemDefErrors(d, (id) => !!spellById(id)), tag).toEqual([]);
        // Ya en la forma que deja migrate: si no, cada arranque la «cambiaría» y la partida la guardaría.
        expect(normalizeItemDef(structuredClone(d)), tag).toBe(false);
        expect(d.id, tag).toMatch(/^it_[a-z0-9_]+$/);
        expect(d.name.trim(), tag).not.toBe('');
        expect(d.name, tag).toBe(d.name.trim());
        expect(TYPES.has(d.type), tag).toBe(true);
        expect(SIZES.has(d.size), tag).toBe(true);
        expect(Number.isFinite(d.value) && d.value >= 0, tag).toBe(true);
        expect(Number.isFinite(d.weight_lb) && d.weight_lb >= 0, tag).toBe(true);
        expect(d.aliases.every((a) => a.trim() !== ''), tag).toBe(true);
        if (d.weapon) expect(() => rollExpr(d.weapon!.damage), tag).not.toThrow();
        if (d.weapon?.versatile_damage) expect(() => rollExpr(d.weapon!.versatile_damage!), tag).not.toThrow();
        if (d.heals) expect(() => rollExpr(d.heals!), tag).not.toThrow();
        if (d.container) expect(d.container.slots > 0 && d.container.max_weight_lb > 0, tag).toBe(true);
        if (d.type === 'armor' && !d.shield_bonus) expect(d.armor, tag).toBeTruthy();
        if (d.origin === 'srd') {
          // El nombre SRD en inglés va de primer alias (el máster y el jugador lo buscan así).
          expect(d.aliases[0], tag).toBe(d.en!.toLowerCase());
          if (['scroll', 'wand', 'ring', 'wondrous'].includes(d.type) || d.bonus) expect(d.rarity, tag).toBeTruthy();
          if (d.rarity && d.rarity !== 'common') expect(d.unidentified?.name, tag).toBeTruthy();
        }
      }
    }
  });

  it('mismos ids que antes para lo que ya había, y TRADE_ITEMS sin magia', () => {
    const old = ['it_mochila', 'it_antorcha', 'it_cuerda', 'it_daga', 'it_hacha', 'it_madera', 'it_bayas', 'it_pocion', 'it_cofre', 'it_barril',
      'it_pescado', 'it_cerveza', 'it_racion', 'it_armadura_cuero', 'it_cota_escamas', 'it_cota_malla', 'it_escudo', 'it_espada_larga',
      'it_espada_corta', 'it_estoque', 'it_maza', 'it_baston', 'it_gran_hacha', 'it_hacha_mano', 'it_arco_corto', 'it_flechas', 'it_ganzuas',
      'it_libro_conjuros', 'it_bolsa_componentes', 'it_simbolo_sagrado', 'it_laud', 'it_noche_posada', 'it_llave_cuarto'];
    const ids = new Set(CATALOG.map((d) => d.id));
    for (const id of old) expect(ids.has(id), id).toBe(true);
    for (const d of TRADE_ITEMS) expect(d.rarity, d.id).toBeUndefined();
    // El catálogo de las campañas escritas, sin magia; el de los mundos generados, con ella.
    expect(CATALOG.some((d) => d.rarity)).toBe(false);
    expect(catalogFor('fantasy').some((d) => d.id === 'it_varita_proyectiles')).toBe(true);
    // Las cosas de la casa no pisan ids del SRD.
    const srd = new Set(SRD_ITEMS.map((d) => d.id));
    for (const d of COMMON_ITEMS) expect(srd.has(d.id), d.id).toBe(false);
  });

  it('las variantes de género: mismas reglas, otro nombre; solo ids del catálogo', () => {
    const srd = new Set(SRD_ITEMS.map((d) => d.id));
    for (const id of Object.keys(GENRE_NAMES)) expect(srd.has(id), id).toBe(true);
    const fantasy = srdCatalog('fantasy').find((d) => d.id === 'it_ballesta_ligera')!;
    const scifi = srdCatalog('scifi').find((d) => d.id === 'it_ballesta_ligera')!;
    expect(scifi.name).toBe('pistola de rayos');
    expect(scifi.weapon).toEqual(fantasy.weapon);
    expect(scifi.aliases[0]).toBe('light crossbow');
    expect(srdCatalog('postapoc').find((d) => d.id === 'it_espada_larga_2')).toMatchObject({ name: 'machete largo +2', unidentified: { name: 'machete largo' } });
    // Sin variante, el nombre del SRD.
    expect(srdCatalog('scifi').find((d) => d.id === 'it_abaco')!.name).toBe('ábaco');
  });
});

describe('el catálogo en las partidas', () => {
  async function boot(seed: WorldSnapshot, repo = new MemoryRepository()) {
    const time = fakeTime(EPOCH);
    const engine = await Engine.boot({ repo, campaignId: seed.campaign.id, seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
    return { engine, repo };
  }

  it('Brezal, la demo y un mundo generado arrancan con el catálogo y su versión; la magia del SRD, solo en el generado', async () => {
    const seeds = [
      authoredSeed('brezal', { now: new Date(EPOCH) }),
      makeSeed(),
      await generateSeed({ seed: 7, tone: 'grim', setting: 'Una estación espacial minera en el cinturón.', client: null, now: () => new Date(EPOCH) }),
    ];
    for (const seed of seeds) {
      const { engine } = await boot(seed);
      const w = engine.world;
      expect(w.campaign.catalog_version, seed.campaign.id).toBe(SRD_CATALOG_VERSION);
      // La magia del SRD es para los mundos generados; una campaña escrita escribe la suya como objetos propios
      // (Miguel, 2026-11-06: en Brezal, pocos, enigmáticos y del lore). Así el máster no la saca con spawn_item.
      const generated = !!seed.campaign.generation;
      for (const d of SRD_ITEMS) expect(w.itemDefs.has(d.id), `${seed.campaign.id}: ${d.id}`).toBe(generated || !d.rarity);
      // Todo lo que hay en el mundo tiene su definición.
      for (const i of w.itemInstances.values()) expect(w.itemDefs.has(i.item_id), `${seed.campaign.id}: ${i.id}`).toBe(true);
    }
    const scifi = await boot(seeds[2]!);
    expect(scifi.engine.world.itemDef('it_ballesta_ligera').name).toBe('pistola de rayos');
  });

  it('la partida guarda solo lo que usa y lo propio; al volver a abrirla está todo', async () => {
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    const { engine, repo } = await boot(seed);
    const saved = (await repo.loadSnapshot(seed.campaign.id))!;
    const savedIds = new Set(saved.item_defs.map((d) => d.id));
    // Fuera lo que nadie lleva (la alabarda), dentro lo que hay en el mundo (la poción del cofre) y lo propio de Brezal.
    expect(savedIds.has('it_alabarda')).toBe(false);
    expect(savedIds.has('it_pocion')).toBe(true);
    expect(savedIds.has('it_llave_vharn')).toBe(true);
    expect(savedIds.has('it_madera')).toBe(true);
    expect(saved.item_defs.length).toBeLessThan(engine.world.itemDefs.size / 2);
    const again = await boot(seed, repo);
    expect(again.engine.world.itemDefs.size).toBe(engine.world.itemDefs.size);
    expect(again.engine.world.itemDef('it_alabarda').weapon?.damage).toBe('1d10');
    // Al volver a abrirla tampoco aparece la magia del SRD.
    expect(again.engine.world.itemDefs.has('it_espada_larga_1')).toBe(false);
  });

  it('compactSnapshot guarda una definición SRD cambiada en la partida', () => {
    const snap = makeSeed();
    syncCatalog(snap);
    const halberd = snap.item_defs.find((d) => d.id === 'it_alabarda')!;
    expect(compactSnapshot(snap).item_defs.some((d) => d.id === 'it_alabarda')).toBe(false);
    halberd.description = 'La alabarda del capitán, con una muesca.';
    expect(compactSnapshot(snap).item_defs.some((d) => d.id === 'it_alabarda')).toBe(true);
  });

  it('una partida vieja: las definiciones SRD se ponen al día; las propias de la campaña, no', () => {
    const snap = makeSeed();
    const mochila = snap.item_defs.find((d) => d.id === 'it_mochila')!;
    mochila.value = 400; // el precio de antes del catálogo SRD
    const cerveza = snap.item_defs.find((d) => d.id === 'it_cerveza')!;
    Object.assign(cerveza, { origin: 'custom', value: 99, name: 'cerveza de la casa' });
    snap.item_defs = snap.item_defs.filter((d) => d.id !== 'it_alabarda');
    delete snap.campaign.catalog_version;
    expect(syncCatalog(snap)).toBe(true);
    expect(snap.campaign.catalog_version).toBe(SRD_CATALOG_VERSION);
    expect(snap.item_defs.find((d) => d.id === 'it_mochila')!.value).toBe(200);
    expect(snap.item_defs.find((d) => d.id === 'it_cerveza')).toMatchObject({ value: 99, name: 'cerveza de la casa' });
    expect(snap.item_defs.some((d) => d.id === 'it_alabarda')).toBe(true);
    // Ya al día: nada que guardar.
    expect(syncCatalog(snap)).toBe(false);
  });

  it('un mundo de ciencia ficción viejo recibe los nombres de su género y conserva el viejo de alias', async () => {
    const seed = await generateSeed({ seed: 7, tone: 'grim', setting: 'Una estación espacial minera en el cinturón.', client: null, now: () => new Date(EPOCH) });
    const xbow = seed.item_defs.find((d) => d.id === 'it_ballesta_ligera')!;
    Object.assign(xbow, structuredClone(CATALOG.find((d) => d.id === 'it_ballesta_ligera')!));
    delete seed.campaign.catalog_version;
    syncCatalog(seed);
    const now = seed.item_defs.find((d) => d.id === 'it_ballesta_ligera')!;
    expect(now.name).toBe('pistola de rayos');
    expect(now.aliases).toContain('ballesta ligera');
  });
});
