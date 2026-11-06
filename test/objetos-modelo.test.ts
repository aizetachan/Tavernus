/**
 * Modelo de objetos 5e (PLAN-OBJETOS §2, src/engine/items.ts): categorías, propiedades de arma y armadura, magia
 * (rareza, sintonía, bonos, cargas, efectos, maldición), pergaminos, pociones y el estado de cada ejemplar. Sin
 * reglas de juego (eso es el bloque C): aquí, que el modelo valida, que las partidas guardadas se migran y que el
 * máster y la mochila ven lo que el PJ sabe. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { makeSeed } from '../src/data/seed/demo.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { inventoryDetailed, inventoryView, packView, spawnItem } from '../src/engine/inventory.js';
import { armorCategory, baseIdOf, chargesLeft, fillItemDefFrom, isIdentifiedBy, itemDefErrors, itemName, normalizeItemDef, spellText, weaponCategory, weaponProperties } from '../src/engine/items.js';
import { validateSnapshot } from '../src/worldgen/validate.js';
import type { ItemDef, ItemInstance, WorldSnapshot } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const base = { aliases: [], size: 'small', weight_lb: 1, value: 100, unique: false, origin: 'srd' } as const;
const def = (d: Partial<ItemDef> & Pick<ItemDef, 'id' | 'name' | 'type'>): ItemDef => ({ ...base, ...d }) as ItemDef;
const inst = (item_id: string, state: ItemInstance['state'] = {}): ItemInstance => ({ id: `ii_${item_id}`, item_id, quantity: 1, location: { type: 'spot', id: 'sp_x' }, state });

/** Objetos mágicos de prueba (no son el catálogo: eso es el bloque B). */
const VARITA = def({
  id: 'it_varita_prueba', name: 'varita de proyectiles mágicos', type: 'wand', rarity: 'uncommon',
  charges: { max: 7, recharge: { amount: '1d6+1', at: 'dawn' }, destroy_on_empty: true },
  spell: { spell_id: 'magic_missile', level: 1 }, unidentified: { name: 'vara de tejo', description: 'Una vara fina, tibia al tacto.' },
});
const ANILLO = def({
  id: 'it_anillo_prueba', name: 'anillo de protección', type: 'ring', size: 'tiny', rarity: 'rare', attunement: true,
  bonus: { ac: 1 }, effects: [{ kind: 'save_bonus', value: 1 }], equip_slot: 'ring1',
});
const ESPADA = def({
  id: 'it_espada_prueba', name: 'espada larga +1', type: 'weapon', subtype: 'martial_melee', size: 'medium', rarity: 'uncommon',
  weapon: { damage: '1d8', damage_type: 'slashing', properties: ['versatile'], versatile_damage: '1d10' }, bonus: { attack: 1, damage: 1 },
  unidentified: { name: 'espada larga' },
});
const CAPA = def({
  id: 'it_capa_prueba', name: 'capa del ahorcado', type: 'wondrous', rarity: 'rare', attunement: { classes: ['wizard'], spellcaster: true },
  effects: [{ kind: 'advantage', on: 'stealth' }], cursed: { description: 'aprieta el cuello y no se suelta' },
});
const POCION = def({
  id: 'it_pocion_prueba', name: 'poción de invisibilidad', type: 'consumable', subtype: 'potion', rarity: 'very_rare',
  effect: { kind: 'condition', condition: 'invisible' }, duration_s: 3600,
});
const MAGIC = [VARITA, ANILLO, ESPADA, CAPA, POCION];

describe('modelo de objetos: ayudas puras', () => {
  it('propiedades de arma: la lista y las booleanas de siempre, juntas', () => {
    const daga = def({ id: 'd', name: 'daga', type: 'weapon', weapon: { damage: '1d4', damage_type: 'piercing', finesse: true, properties: ['light', 'thrown'], range: [20, 60] } });
    expect([...weaponProperties(daga)].sort()).toEqual(['finesse', 'light', 'thrown']);
    expect(weaponCategory(daga)).toBeNull();
    expect(weaponCategory(ESPADA)).toBe('martial');
    expect(weaponProperties(def({ id: 'x', name: 'cuerda', type: 'gear' })).size).toBe(0);
  });

  it('la categoría de la armadura sale de su subtipo o, sin él, de sus datos', () => {
    const arm = (dex_max: number | null) => def({ id: 'a', name: 'a', type: 'armor', armor: { ac_base: 12, dex_max, stealth_disadvantage: false } });
    expect(armorCategory(arm(null))).toBe('light');
    expect(armorCategory(arm(2))).toBe('medium');
    expect(armorCategory(arm(0))).toBe('heavy');
    expect(armorCategory(def({ id: 'e', name: 'escudo', type: 'armor', shield_bonus: 2 }))).toBe('shield');
    expect(armorCategory(def({ id: 'p', name: 'peto', type: 'armor', subtype: 'medium', armor: { ac_base: 14, dex_max: null, stealth_disadvantage: false } }))).toBe('medium');
    expect(armorCategory(def({ id: 'c', name: 'cuerda', type: 'gear' }))).toBeNull();
  });

  it('identificar: lo corriente se conoce siempre; lo mágico, solo quien está en identified_by', () => {
    const cuerda = def({ id: 'c', name: 'cuerda', type: 'gear' });
    expect(isIdentifiedBy(cuerda, inst('c'), null)).toBe(true);
    expect(isIdentifiedBy(VARITA, inst(VARITA.id), 'ch_a')).toBe(false);
    expect(isIdentifiedBy(VARITA, inst(VARITA.id, { identified_by: ['ch_a'] }), 'ch_a')).toBe(true);
    expect(isIdentifiedBy(VARITA, inst(VARITA.id, { identified_by: ['ch_a'] }), 'ch_b')).toBe(false);
    // Nombre: el suyo, el de `unidentified` o uno genérico por tipo (o subtipo).
    expect(itemName(VARITA, inst(VARITA.id), 'ch_b')).toBe('vara de tejo');
    expect(itemName(ANILLO, inst(ANILLO.id), 'ch_b')).toBe('anillo');
    expect(itemName(POCION, inst(POCION.id), 'ch_b')).toBe('poción');
    expect(itemName(ANILLO, inst(ANILLO.id, { identified_by: ['ch_b'] }), 'ch_b')).toBe('anillo de protección');
  });

  it('cargas: llenas si el ejemplar no dice nada; nunca por encima del máximo', () => {
    expect(chargesLeft(VARITA, inst(VARITA.id))).toBe(7);
    expect(chargesLeft(VARITA, inst(VARITA.id, { charges: 2 }))).toBe(2);
    expect(chargesLeft(VARITA, inst(VARITA.id, { charges: 99 }))).toBe(7);
    expect(chargesLeft(ANILLO, inst(ANILLO.id))).toBeNull();
  });
});

describe('modelo de objetos: validación', () => {
  const spells = (id: string) => id === 'magic_missile';
  it('los objetos de prueba y las semillas de siempre validan', () => {
    for (const d of MAGIC) expect(itemDefErrors(d, spells), d.id).toEqual([]);
    expect(validateSnapshot(makeSeed())).toEqual([]);
    expect(validateSnapshot(authoredSeed('brezal', { now: new Date(Date.UTC(2026, 9, 22, 12)) }))).toEqual([]);
  });

  it('rechaza lo que no casa', () => {
    const errs = (d: Partial<ItemDef>) => itemDefErrors(def({ id: 'x', name: 'x', type: 'misc', ...d }), spells);
    expect(errs({ type: 'weapon', subtype: 'heavy' }).join()).toMatch(/subtipo «heavy» no vale/);
    expect(errs({ type: 'weapon', weapon: { damage: '1d8', damage_type: 'slashing', properties: ['versatile'] } }).join()).toMatch(/versatile_damage/);
    expect(errs({ type: 'weapon', weapon: { damage: '1d6', damage_type: 'piercing', properties: ['ammunition'], range: [80, 320] } }).join()).toMatch(/ammo_type/);
    expect(errs({ type: 'weapon', weapon: { damage: '1d4', damage_type: 'piercing', properties: ['thrown'] } }).join()).toMatch(/alcance/);
    expect(errs({ type: 'weapon', weapon: { damage: '1d4', damage_type: 'piercing', finesse: true, properties: ['light'] } }).join()).toMatch(/sutil/);
    expect(errs({ charges: { max: 3 } }).join()).toMatch(/no tiene rareza/);
    expect(errs({ type: 'scroll', rarity: 'common', spell: { spell_id: 'no_existe', level: 1 } }).join()).toMatch(/no está en el catálogo/);
    expect(errs({ type: 'ammunition' }).join()).toMatch(/munición sin subtipo/);
    expect(errs({ duration_s: 60 }).join()).toMatch(/duration_s sin effect/);
    expect(errs({ rarity: 'mythic' as never }).join()).toMatch(/rareza/);
  });

  it('pergamino de nivel N: el conjuro va en el ejemplar, existe y es de ese nivel', () => {
    const PERG = def({ id: 'it_perg1', name: 'pergamino de conjuro (nivel 1)', type: 'scroll', rarity: 'common', spell: { level: 1, save_dc: 13, attack_bonus: 5 } });
    expect(itemDefErrors(PERG, spells)).toEqual([]);
    expect(itemDefErrors({ ...PERG, type: 'wand' }, spells).join()).toMatch(/solo un pergamino/);
    expect(spellText(PERG, inst(PERG.id, { spell_id: 'magic_missile' }))).toBe('Proyectil mágico (nivel 1)');
    expect(spellText(PERG, inst(PERG.id))).toBe('un conjuro de nivel 1');
    const snap = makeSeed();
    snap.item_defs.push(PERG, VARITA);
    const at = { type: 'spot' as const, id: 'sp_tab_barra' };
    snap.item_instances.push(
      { id: 'ii_ok', item_id: PERG.id, quantity: 1, location: at, state: { spell_id: 'magic_missile' } },
      { id: 'ii_nivel', item_id: PERG.id, quantity: 1, location: at, state: { spell_id: 'dispel_magic' } },
      { id: 'ii_nada', item_id: PERG.id, quantity: 1, location: at, state: { spell_id: 'no_existe' } },
      { id: 'ii_fijo', item_id: VARITA.id, quantity: 1, location: at, state: { spell_id: 'magic_missile' } },
    );
    const errs = validateSnapshot(snap).join('\n');
    expect(errs).not.toMatch(/ii_ok/);
    expect(errs).toMatch(/ii_nivel: dispel_magic es de nivel 3 y el pergamino de nivel 1/);
    expect(errs).toMatch(/ii_nada: el conjuro no_existe no está/);
    expect(errs).toMatch(/ii_fijo: lleva spell_id, pero it_varita_prueba no deja el conjuro/);
  });

  it('base_id: la variante dice de qué arma SRD sale; si la base está en la partida, es del mismo tipo', () => {
    expect(baseIdOf(ESPADA)).toBe(ESPADA.id);
    expect(baseIdOf({ ...ESPADA, base_id: 'it_daga' })).toBe('it_daga');
    const snap = makeSeed();
    snap.item_defs.push({ ...ESPADA, base_id: 'it_daga' }, { ...VARITA, id: 'it_v2', base_id: 'it_daga' }, { ...ANILLO, id: 'it_a2', base_id: 'it_a2' }, { ...ANILLO, id: 'it_a3', base_id: 'it_fuera_de_la_partida' });
    const errs = validateSnapshot(snap).join('\n');
    expect(errs).not.toMatch(/it_espada_prueba: su base/);
    expect(errs).toMatch(/it_v2: su base it_daga es de otro tipo/);
    expect(errs).toMatch(/it_a2: base_id apunta a sí mismo/);
    expect(errs).not.toMatch(/it_a3/);
  });

  it('el estado del ejemplar: quién lo conoce, a quién está sintonizado, sus cargas y su dueño existen', () => {
    const snap = makeSeed();
    snap.item_defs.push(VARITA, ANILLO);
    snap.item_instances.push(
      { id: 'ii_v', item_id: VARITA.id, quantity: 1, location: { type: 'spot', id: 'sp_tab_barra' }, state: { identified_by: ['ch_kael', 'ch_nadie'], charges: 8, attuned_to: 'ch_kael' } },
      { id: 'ii_a', item_id: ANILLO.id, quantity: 1, location: { type: 'spot', id: 'sp_tab_barra' }, state: { attuned_to: 'ch_kael', owner_id: 'npc_nadie' } },
    );
    const errs = validateSnapshot(snap).join('\n');
    expect(errs).toMatch(/ii_v: identified_by/);
    expect(errs).toMatch(/ii_v: cargas 8/);
    expect(errs).toMatch(/ii_v: sintonizado, pero .* no pide sintonía/);
    expect(errs).toMatch(/ii_a: su dueño npc_nadie no existe/);
    expect(errs).not.toMatch(/ii_a: sintonizado/);
  });
});

describe('modelo de objetos: migración de partidas guardadas', () => {
  const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
  /**
   * Objetos propios de la prueba (`origin: 'custom'`), para que la sincronización del catálogo SRD (bloque B) no los
   * toque y aquí se pruebe solo el relleno desde la semilla y la deducción de los datos, traiga lo que traiga makeSeed().
   */
  const c = (d: Partial<ItemDef> & Pick<ItemDef, 'id' | 'name' | 'type'>): ItemDef => def({ origin: 'custom', ...d });
  const OLD: ItemDef[] = [
    c({ id: 'it_t_daga', name: 'daga vieja', type: 'weapon', weapon: { damage: '1d4', damage_type: 'piercing', finesse: true } }),
    c({ id: 'it_t_antorcha', name: 'antorcha vieja', type: 'misc', light_source: true }),
    c({ id: 'it_t_malla', name: 'malla vieja', type: 'armor', size: 'large', armor: { ac_base: 16, dex_max: 0, stealth_disadvantage: true } }),
    c({ id: 'it_t_cuero', name: 'cuero viejo', type: 'armor', size: 'large', armor: { ac_base: 11, dex_max: null, stealth_disadvantage: false } }),
    c({ id: 'it_t_escamas', name: 'escamas viejas', type: 'armor', size: 'large', armor: { ac_base: 14, dex_max: 2, stealth_disadvantage: true } }),
    c({ id: 'it_t_arco', name: 'arco viejo', type: 'weapon', size: 'large', weapon: { damage: '1d6', damage_type: 'piercing', ranged: true, two_handed: true } }),
    c({ id: 'it_t_escudo', name: 'escudo viejo', type: 'armor', size: 'medium', shield_bonus: 2 }),
    c({ id: 'it_t_mochila', name: 'mochila vieja', type: 'container', size: 'medium', container: { slots: 20, max_weight_lb: 60, max_size: 'medium' } }),
  ];
  /** Una partida guardada con los tipos viejos y sin nada del modelo nuevo; la semilla de hoy ya lo trae. */
  async function bootOld(): Promise<{ engine: Engine; seed: WorldSnapshot }> {
    const saved = makeSeed();
    const seed = makeSeed();
    saved.item_defs.push(...structuredClone(OLD));
    seed.item_defs.push(...structuredClone(OLD));
    const sd = (id: string) => seed.item_defs.find((d) => d.id === id)!;
    Object.assign(sd('it_t_daga'), { subtype: 'simple_melee' });
    sd('it_t_daga').weapon!.properties = ['finesse', 'light', 'thrown'];
    sd('it_t_daga').weapon!.range = [20, 60];
    Object.assign(sd('it_t_antorcha'), { type: 'gear', subtype: 'light' });
    Object.assign(sd('it_t_malla'), { subtype: 'heavy' });
    sd('it_t_malla').armor!.str_min = 13;
    // Lo que la partida ya tiene no lo pisa la semilla.
    Object.assign(sd('it_t_mochila'), { type: 'gear', subtype: 'container' });
    saved.item_defs.find((d) => d.id === 'it_t_mochila')!.subtype = 'adventuring';
    const repo = new MemoryRepository();
    await repo.saveSnapshot(saved);
    const time = fakeTime(EPOCH);
    const engine = await Engine.boot({ repo, campaignId: saved.campaign.id, seed, now: time.now, deterministic: true, fastTravel: false });
    return { engine, seed };
  }

  it('rellena lo que la semilla trae, deduce lo que sale de los datos y no pisa nada', async () => {
    const { engine } = await bootOld();
    const d = (id: string) => engine.world.itemDef(id);
    // La lista de propiedades queda en el orden de WEAPON_PROPERTIES (normalizeItemDef), venga como venga.
    expect(d('it_t_daga')).toMatchObject({ subtype: 'simple_melee', weapon: { finesse: true, properties: ['light', 'finesse', 'thrown'], range: [20, 60] } });
    // Tipo viejo genérico → el de la semilla.
    expect(d('it_t_antorcha')).toMatchObject({ type: 'gear', subtype: 'light' });
    expect(d('it_t_malla')).toMatchObject({ subtype: 'heavy', armor: { str_min: 13 } });
    // Deducido de sus datos, sin semilla: el cuero es ligera; las escamas, intermedia; el arco, a dos manos.
    expect(d('it_t_cuero').subtype).toBe('light');
    expect(d('it_t_escamas').subtype).toBe('medium');
    expect(d('it_t_arco').weapon!.properties).toEqual(['two_handed']);
    // El escudo no es armadura de cuerpo: su subtipo lo pone el catálogo, no la deducción.
    expect(d('it_t_escudo').subtype).toBeUndefined();
    // Lo que ya tenía la partida se queda (pero el tipo genérico viejo sí pasa al de la semilla).
    expect(d('it_t_mochila')).toMatchObject({ type: 'gear', subtype: 'adventuring' });
    // Y el mundo migrado sigue validando.
    expect(validateSnapshot(engine.world.snapshot())).toEqual([]);
  });

  it('es idempotente: una segunda pasada no cambia nada', async () => {
    const { engine, seed } = await bootOld();
    for (const d of engine.world.itemDefs.values()) {
      const before = JSON.stringify(d);
      const sd = seed.item_defs.find((x) => x.id === d.id);
      expect(sd ? fillItemDefFrom(d, sd) : false, d.id).toBe(false);
      expect(normalizeItemDef(d), d.id).toBe(false);
      expect(JSON.stringify(d)).toBe(before);
    }
  });
});

describe('modelo de objetos: lo que ven el máster y la mochila', () => {
  async function boot() {
    const seed = makeSeed();
    seed.item_defs.push(...MAGIC);
    const time = fakeTime();
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: time.now, deterministic: true, fastTravel: false });
    const kael = engine.world.character('ch_kael');
    const pocket = { type: 'character' as const, id: kael.id, slot: { kind: 'pocket' as const } };
    const ids: Record<string, string> = {};
    for (const d of MAGIC) {
      const r = spawnItem(engine.world, d.id, 1, pocket);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      ids[d.id] = r.moved.id;
    }
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(7), closed: null, rolls: [], progress: [] };
    const getItem = (id: string) => JSON.parse(executeTool(ctx, 'get_item', { instance_id: id })) as Record<string, unknown>;
    return { engine, kael, ids, getItem, ctx };
  }

  it('sin identificar: nombre genérico, «objeto mágico sin identificar» y nada que delate qué es', async () => {
    const { engine, kael, ids, getItem } = await boot();
    const v = getItem(ids[VARITA.id]!);
    expect(v).toMatchObject({ name: 'vara de tejo', type: 'wand', magic: 'objeto mágico sin identificar' });
    expect(v['item_id']).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/proyectil|cargas|poco común|varita de/i);
    // La espada sigue pareciendo una espada: su daño se ve, su +1 no.
    const e = getItem(ids[ESPADA.id]!);
    expect(e).toMatchObject({ name: 'espada larga', stat: 'Daño 1d8 (1d10 a dos manos) cortante' });
    expect(JSON.stringify(e)).not.toMatch(/\+1/);
    // La mochila y el inventario del máster, igual.
    const card = packView(engine.world, kael.id).pockets.items.find((i) => i.id === ids[VARITA.id])!;
    expect(card).toMatchObject({ name: 'vara de tejo', unidentified: true, about: 'Una vara fina, tibia al tacto.' });
    expect(card.rarity).toBeUndefined();
    expect(card.props).toContain('mágico: sin identificar');
    expect(card.props.join()).not.toMatch(/vale/);
    const det = inventoryDetailed(engine.world, kael.id).find((i) => i.instance_id === ids[ANILLO.id])!;
    expect(det).toMatchObject({ name: 'anillo', unidentified: true });
    expect(inventoryView(engine.world, kael.id).pockets).toContain('poción');
  });

  it('identificado: rareza, sintonía, bonos, cargas, conjuro y efectos', async () => {
    const { engine, kael, ids, getItem } = await boot();
    for (const id of Object.values(ids)) engine.world.itemInstance(id).state.identified_by = [kael.id];
    engine.world.itemInstance(ids[VARITA.id]!).state.charges = 3;
    const v = getItem(ids[VARITA.id]!);
    expect(v).toMatchObject({ item_id: VARITA.id, name: 'varita de proyectiles mágicos', magic: { rarity: 'poco común', charges: '3/7 cargas, recupera 1d6+1 al alba', spell: 'Proyectil mágico (nivel 1)' } });
    // El estado mágico del ejemplar no sale crudo: va dentro de `magic`, ya leído.
    expect(v['state']).toEqual({});
    const a = getItem(ids[ANILLO.id]!);
    expect(a['magic']).toMatchObject({ rarity: 'raro', attunement: 'pide sintonía', attuned_to: null, attuned_to_you: false, bonus: ['+1 a la CA'], effects: ['+1 a las salvaciones'] });
    const card = (id: string) => packView(engine.world, kael.id).pockets.items.find((i) => i.id === id)!;
    expect(card(ids[VARITA.id]!)).toMatchObject({ rarity: 'uncommon', charges: { left: 3, max: 7 } });
    expect(card(ids[ANILLO.id]!)).toMatchObject({ attunement: { attuned: false } });
    expect(card(ids[ANILLO.id]!).props).toEqual(expect.arrayContaining(['mágico, raro', 'pide sintonía', '+1 a la CA', '+1 a las salvaciones']));
    expect(card(ids[POCION.id]!).props).toContain('al usarlo: queda invisible durante 1 hora');
    expect(card(ids[CAPA.id]!).props).toContain('pide sintonía (wizard o un lanzador de conjuros)');
    expect(card(ids[CAPA.id]!).props).toContain('ventaja en Sigilo');
  });

  it('la maldición no se ve hasta que alguien lo sintoniza', async () => {
    const { engine, kael, ids, getItem } = await boot();
    const capa = engine.world.itemInstance(ids[CAPA.id]!);
    capa.state.identified_by = [kael.id];
    expect(JSON.stringify(getItem(capa.id))).not.toMatch(/maldi|aprieta/);
    capa.state.attuned_to = kael.id;
    expect(getItem(capa.id)['magic']).toMatchObject({ attuned_to: kael.name, attuned_to_you: true, cursed: 'aprieta el cuello y no se suelta' });
    expect(packView(engine.world, kael.id).pockets.items.find((i) => i.id === capa.id)!.props).toEqual(expect.arrayContaining(['sintonizado contigo', 'maldito: no te lo puedes quitar']));
  });

  it('get_character no delata el item_id de lo que el PJ no ha identificado', async () => {
    const { ids, ctx } = await boot();
    const out = JSON.parse(executeTool(ctx, 'get_character', { character_id: 'ch_kael' })) as { inventory: { instance_id: string; item_id?: string }[] };
    expect(out.inventory.find((i) => i.instance_id === ids[VARITA.id])!.item_id).toBeUndefined();
    expect(out.inventory.find((i) => i.instance_id === 'ii_kael_daga')!.item_id).toBe('it_daga');
  });
});
