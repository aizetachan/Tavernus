/**
 * Reglas de los objetos en el motor (PLAN-OBJETOS §4, src/engine/itemrules.ts): competencia con armas y armaduras,
 * propiedades de arma, munición, fuerza mínima, bonos mágicos, sintonización, identificar, pergaminos, cargas,
 * pociones y el cierre que no deja narrar magia que el motor no ha aplicado. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { resolveAttack } from '../src/engine/combat.js';
import { magicWithoutTool } from '../src/engine/closecheck.js';
import { seededRng, type Rng } from '../src/engine/dice.js';
import {
  activeEffects, ammoFor, applyItemEffect, armorBlocksSpells, armorSpeedPenalty, attackProfile, attune, attunedItems, canAttune, castFromCharges,
  combineAdvantage, copyScroll, damageAfterResistance, endAttunement, gearAdvantage, gearLines, identify, itemSaveBonus, MAX_ATTUNED, reachCheck,
  refreshCharges, spellItemBonus, spendCharges, timesBetween, unproficientArmor, useScroll, weaponProficient, type AttackProfile,
} from '../src/engine/itemrules.js';
import { itemName } from '../src/engine/items.js';
import { castSpell, spellsOf } from '../src/engine/levels.js';
import { armorClass, characterCheck } from '../src/engine/rules.js';
import type { Character, CarrySlot, ItemDef, ItemInstance } from '../src/engine/model.js';
import type { World } from '../src/engine/world.js';
import { GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import { bootEngine } from './helpers.js';

const base = { aliases: [], size: 'medium', weight_lb: 1, value: 100, unique: false, origin: 'srd' } as const;
const def = (d: Partial<ItemDef> & Pick<ItemDef, 'id' | 'name' | 'type'>): ItemDef => ({ ...base, ...d }) as ItemDef;

/** Objetos de prueba con la forma del modelo (bloque A); el catálogo de verdad es del bloque B. */
const DEFS: ItemDef[] = [
  def({ id: 't_espada_larga', name: 'espada larga', type: 'weapon', subtype: 'martial_melee', weapon: { damage: '1d8', damage_type: 'slashing', properties: ['versatile'], versatile_damage: '1d10' } }),
  def({ id: 't_espada_mas1', name: 'espada larga +1', type: 'weapon', subtype: 'martial_melee', base_id: 'it_espada_larga', rarity: 'uncommon', bonus: { attack: 1, damage: 1 }, weapon: { damage: '1d8', damage_type: 'slashing', properties: ['versatile'], versatile_damage: '1d10' }, unidentified: { name: 'espada larga' } }),
  def({ id: 't_gran_hacha', name: 'gran hacha', type: 'weapon', subtype: 'martial_melee', weapon: { damage: '1d12', damage_type: 'slashing', properties: ['heavy', 'two_handed'] } }),
  def({ id: 't_daga', name: 'daga', type: 'weapon', subtype: 'simple_melee', size: 'small', weapon: { damage: '1d4', damage_type: 'piercing', properties: ['finesse', 'light', 'thrown'], range: [20, 60] } }),
  def({ id: 't_hacha_mano', name: 'hacha de mano', type: 'weapon', subtype: 'simple_melee', size: 'small', weapon: { damage: '1d6', damage_type: 'slashing', properties: ['light', 'thrown'], range: [20, 60] } }),
  def({ id: 't_lanza_larga', name: 'guja', type: 'weapon', subtype: 'martial_melee', weapon: { damage: '1d10', damage_type: 'slashing', properties: ['heavy', 'reach', 'two_handed'] } }),
  def({ id: 't_arco', name: 'arco corto', type: 'weapon', subtype: 'simple_ranged', weapon: { damage: '1d6', damage_type: 'piercing', ranged: true, properties: ['ammunition', 'two_handed'], range: [80, 320], ammo_type: 'arrow' } }),
  def({ id: 't_flecha', name: 'flecha', type: 'ammunition', subtype: 'arrow', size: 'tiny', weight_lb: 0.05 }),
  def({ id: 't_virote', name: 'virote', type: 'ammunition', subtype: 'bolt', size: 'tiny', weight_lb: 0.05 }),
  def({ id: 't_malla', name: 'cota de malla', type: 'armor', subtype: 'heavy', size: 'large', equip_slot: 'body', armor: { ac_base: 16, dex_max: 0, stealth_disadvantage: true, str_min: 13 } }),
  def({ id: 't_escamas', name: 'cota de escamas', type: 'armor', size: 'large', equip_slot: 'body', armor: { ac_base: 14, dex_max: 2, stealth_disadvantage: true } }),
  def({ id: 't_cuero_mas1', name: 'armadura de cuero +1', type: 'armor', subtype: 'light', size: 'large', equip_slot: 'body', rarity: 'rare', bonus: { ac: 1 }, armor: { ac_base: 11, dex_max: null, stealth_disadvantage: false } }),
  def({ id: 't_escudo', name: 'escudo', type: 'armor', subtype: 'shield', shield_bonus: 2 }),
  def({ id: 't_anillo', name: 'anillo de protección', type: 'ring', size: 'tiny', rarity: 'rare', attunement: true, equip_slot: 'ring1', bonus: { ac: 1 }, effects: [{ kind: 'save_bonus', value: 1 }], unidentified: { name: 'anillo de plata' } }),
  def({ id: 't_botas', name: 'botas élficas', type: 'wondrous', size: 'small', rarity: 'uncommon', equip_slot: 'feet', effects: [{ kind: 'advantage', on: 'stealth' }] }),
  def({ id: 't_capa_maldita', name: 'capa del ahorcado', type: 'wondrous', rarity: 'rare', attunement: true, equip_slot: 'back', cursed: { effects: [{ kind: 'disadvantage', on: 'saves' }], description: 'no se quita' } }),
  def({ id: 't_varita_guerra', name: 'varita del mago de guerra +1', type: 'wand', size: 'small', rarity: 'uncommon', attunement: { spellcaster: true }, bonus: { spell_attack: 1 } }),
  def({ id: 't_varita_proyectiles', name: 'varita de proyectiles mágicos', type: 'wand', size: 'small', rarity: 'uncommon', charges: { max: 7, recharge: { amount: '1d6+1', at: 'dawn' }, destroy_on_empty: true }, spell: { spell_id: 'magic_missile', level: 1 }, unidentified: { name: 'vara de tejo' } }),
  def({ id: 't_perg_proyectil', name: 'pergamino de proyectil mágico', type: 'scroll', size: 'tiny', rarity: 'common', spell: { spell_id: 'magic_missile', level: 1 } }),
  def({ id: 't_perg_bola', name: 'pergamino de bola de fuego', type: 'scroll', size: 'tiny', rarity: 'uncommon', spell: { spell_id: 'fireball', level: 3 } }),
  def({ id: 't_perg_curar', name: 'pergamino de curar heridas', type: 'scroll', size: 'tiny', rarity: 'common', spell: { spell_id: 'cure_wounds', level: 1 } }),
  // Pergamino genérico por nivel, con el conjuro en el ejemplar (como lo hace el catálogo del bloque B).
  def({ id: 't_perg_nivel1', name: 'pergamino de conjuro de nivel 1', type: 'scroll', size: 'tiny', rarity: 'common', spell: { level: 1, save_dc: 13, attack_bonus: 5 } as NonNullable<ItemDef['spell']> }),
  def({ id: 't_pocion_fuego', name: 'poción de resistencia al fuego', type: 'consumable', subtype: 'potion', size: 'tiny', rarity: 'uncommon', effect: { kind: 'resist', damage_type: 'fire' }, duration_s: 3600 }),
  def({ id: 't_pocion_invis', name: 'poción de invisibilidad', type: 'consumable', subtype: 'potion', size: 'tiny', rarity: 'very_rare', effect: { kind: 'condition', condition: 'invisible' }, duration_s: 3600 }),
];

const fixed = (x: number): Rng => () => x; // 0 → saca 1 en el dado; 0.99 → el máximo

async function setup() {
  const { engine } = await bootEngine();
  const world = engine.world;
  for (const d of DEFS) world.itemDefs.set(d.id, d);
  const kael = world.character('ch_kael');
  // Manos vacías y nada puesto: cada prueba le da lo suyo.
  for (const i of [...world.itemInstances.values()]) if (i.location.type === 'character' && i.location.id === kael.id && i.location.slot.kind !== 'equipped') world.itemInstances.delete(i.id);
  for (const i of [...world.itemInstances.values()]) if (i.location.type === 'character' && i.location.id === kael.id && i.location.slot.kind === 'equipped' && i.location.slot.slot === 'body') world.itemInstances.delete(i.id);
  kael.picks = {}; // sin estilo de combate: las cifras de los tests salen solo de los objetos
  const brenna = world.npc('npc_brenna');
  brenna.location = { type: 'spot', id: 'sp_tab_barra' };
  kael.location = { type: 'spot', id: 'sp_tab_barra' };
  return { engine, world, kael, brenna };
}

let n = 0;
function give(world: World, c: Character, itemId: string, slot: CarrySlot, extra: Partial<ItemInstance> = {}): ItemInstance {
  const inst: ItemInstance = { id: `ii_t${n++}`, item_id: itemId, quantity: 1, location: { type: 'character', id: c.id, slot }, state: {}, ...extra };
  world.itemInstances.set(inst.id, inst);
  return inst;
}
const MAIN = { kind: 'hand', which: 'main' } as const;
const OFF = { kind: 'hand', which: 'off' } as const;
const BOTH = { kind: 'hand', which: 'both' } as const;
const POCKET = { kind: 'pocket' } as const;
const BODY = { kind: 'equipped', slot: 'body' } as const;
const prof = (p: AttackProfile | { error: string }) => { if ('error' in p) throw new Error(p.error); return p; };

describe('competencia con armas y armaduras (§4.1)', () => {
  it('el guerrero suma su competencia con un arma marcial; el mago no, y su ataque lo nota', async () => {
    const { world, kael, brenna } = await setup();
    give(world, kael, 't_espada_larga', MAIN);
    expect(prof(attackProfile(world, kael)).proficient).toBe(true);
    kael.class_id = 'wizard';
    const p = prof(attackProfile(world, kael));
    expect(p.proficient).toBe(false);
    expect(p.notes.join()).toMatch(/sin competencia/);
    // El d20 de la tirada lleva solo FUE (+2), sin el +2 de competencia.
    const r = resolveAttack(world, kael.id, brenna.id, 'none', fixed(0.5));
    if ('error' in r) throw new Error(r.error);
    expect(r.attack_total).toBe(11 + 2);
  });

  it('competencia con armas concretas: el pícaro con el estoque y la espada larga, también con su variante +1 (base_id)', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'rogue';
    expect(weaponProficient(kael, world.itemDef('t_gran_hacha'))).toBe(false);
    expect(weaponProficient(kael, { ...world.itemDef('t_espada_larga'), id: 'it_espada_larga' })).toBe(true);
    expect(weaponProficient(kael, world.itemDef('t_espada_mas1'))).toBe(true);
    // El elfo sabe de arcos por su raza, aunque su clase no.
    kael.class_id = 'wizard'; kael.race_id = 'elf';
    expect(weaponProficient(kael, { ...world.itemDef('t_arco'), id: 'it_arco_corto', subtype: 'simple_ranged' })).toBe(true);
    // Sin categoría (una campaña sin subtipos), como siempre: con competencia.
    expect(weaponProficient(kael, world.itemDef('it_daga'))).toBe(true);
  });

  it('armadura sin competencia: desventaja en FUE y DES, en los ataques, y sin conjuros', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    give(world, kael, 't_malla', BODY);
    expect(unproficientArmor(world, kael).map((d) => d.name)).toEqual(['cota de malla']);
    expect(gearAdvantage(world, kael, 'skill', 'athletics')).toBe('disadvantage');
    expect(gearAdvantage(world, kael, 'save', 'dex')).toBe('disadvantage');
    expect(gearAdvantage(world, kael, 'skill', 'arcana')).toBe('none');
    expect(prof(attackProfile(world, kael)).advantage).toBe('disadvantage');
    expect(armorBlocksSpells(world, kael)).toMatch(/no puede lanzar conjuros/);
    // La tirada de verdad (con el mundo) va con desventaja: dos d20, el menor.
    const roll = characterCheck(kael, 'skill', 'athletics', 10, 'none', fixed(0.5), world);
    expect(roll.d20s).toHaveLength(2);
    // Sin el mundo (vista previa), sin cambios.
    expect(characterCheck(kael, 'skill', 'athletics', 10, 'none', fixed(0.5)).d20s).toHaveLength(1);
    // El guerrero con la misma cota, nada.
    kael.class_id = 'fighter';
    expect(unproficientArmor(world, kael)).toEqual([]);
    expect(armorBlocksSpells(world, kael)).toBeNull();
  });

  it('la cota de escamas (intermedia por su tope de DES, sin subtipo) pone desventaja en Sigilo', async () => {
    const { world, kael } = await setup();
    give(world, kael, 't_escamas', BODY);
    expect(gearAdvantage(world, kael, 'skill', 'stealth')).toBe('disadvantage');
    expect(gearAdvantage(world, kael, 'skill', 'perception')).toBe('none');
  });
});

describe('propiedades de arma (§4.2)', () => {
  it('versátil: a dos manos o con la otra libre, el dado mayor; con escudo, el normal', async () => {
    const { world, kael } = await setup();
    give(world, kael, 't_espada_larga', MAIN);
    expect(prof(attackProfile(world, kael)).damage).toBe('1d10');
    give(world, kael, 't_escudo', OFF);
    expect(prof(attackProfile(world, kael)).damage).toBe('1d8');
  });

  it('pesada: un mediano ataca con desventaja', async () => {
    const { world, kael } = await setup();
    give(world, kael, 't_gran_hacha', BOTH);
    expect(prof(attackProfile(world, kael)).advantage).toBe('none');
    kael.race_id = 'halfling';
    expect(prof(attackProfile(world, kael)).advantage).toBe('disadvantage');
  });

  it('ligera: con dos armas ligeras ataca con la otra mano sin sumar su FUE al daño; sin dos ligeras, no', async () => {
    const { world, kael } = await setup();
    give(world, kael, 't_daga', MAIN);
    give(world, kael, 't_hacha_mano', OFF);
    const off = prof(attackProfile(world, kael, { hand: 'off' }));
    expect(off.name).toBe('hacha de mano');
    expect(off.damage_mod).toBe(0);
    expect(prof(attackProfile(world, kael)).damage_mod).toBe(2);
    // Con el estilo de combate con dos armas, sí la suma.
    kael.picks = { ...(kael.picks ?? {}), fighting_style: ['two_weapon'] };
    expect(prof(attackProfile(world, kael, { hand: 'off' })).damage_mod).toBe(2);
    const { world: w2, kael: k2 } = await setup();
    give(w2, k2, 't_espada_larga', MAIN);
    give(w2, k2, 't_daga', OFF);
    expect(attackProfile(w2, k2, { hand: 'off' })).toEqual({ error: expect.stringMatching(/dos armas ligeras/) });
  });

  it('alcance: el arma cuerpo a cuerpo no llega a otro punto; la de alcance, a 3 m; la arrojadiza, con su alcance y desventaja en el largo', () => {
    const melee = { ranged: false, thrown: false, reach: false, range: null, name: 'maza' } as unknown as AttackProfile;
    expect(reachCheck(melee, true, 0)).toMatchObject({ ok: true, mode: 'melee', advantage: 'none' });
    expect(reachCheck(melee, false, 5)).toMatchObject({ ok: false });
    expect(reachCheck({ ...melee, reach: true }, false, 3)).toMatchObject({ ok: true, mode: 'melee' });
    const thrown = { ...melee, thrown: true, range: [20, 60] as [number, number], name: 'daga' };
    expect(reachCheck(thrown, false, 5)).toMatchObject({ ok: true, advantage: 'none' });
    expect(reachCheck(thrown, false, 12)).toMatchObject({ ok: true, advantage: 'disadvantage' });
    expect(reachCheck(thrown, false, 30)).toMatchObject({ ok: false });
    // A quemarropa con un arco, desventaja.
    expect(reachCheck({ ...melee, ranged: true, range: [80, 320] }, true, 0)).toMatchObject({ ok: true, advantage: 'disadvantage' });
  });

  it('una daga lanzada a otro punto de la sala cae junto al objetivo; un golpe de espada no llega', async () => {
    const { world, kael, brenna } = await setup();
    brenna.location = { type: 'spot', id: 'sp_tab_mesa' }; // a unos 5,7 m de la barra
    const daga = give(world, kael, 't_daga', MAIN);
    const r = resolveAttack(world, kael.id, brenna.id, 'none', seededRng(3));
    if ('error' in r) throw new Error(r.error);
    expect(world.itemInstance(daga.id).location).toEqual({ type: 'spot', id: 'sp_tab_mesa' });
    expect(r.notes?.join()).toMatch(/queda en el suelo/);
    give(world, kael, 't_espada_larga', MAIN);
    expect(resolveAttack(world, kael.id, brenna.id, 'none', seededRng(3))).toEqual({ error: expect.stringMatching(/cuerpo a cuerpo/) });
  });
});

describe('munición (§4.3)', () => {
  it('cada disparo gasta una flecha; la mitad queda en el suelo del objetivo, y sin flechas no hay disparo', async () => {
    const { world, kael, brenna } = await setup();
    brenna.location = { type: 'spot', id: 'sp_tab_mesa' };
    give(world, kael, 't_arco', BOTH);
    give(world, kael, 't_virote', POCKET, { quantity: 5 }); // no le sirve a un arco
    const flechas = give(world, kael, 't_flecha', POCKET, { quantity: 4 });
    expect(ammoFor(world, kael, world.itemDef('t_arco'))?.id).toBe(flechas.id);
    const shoot = () => { const r = resolveAttack(world, kael.id, brenna.id, 'none', fixed(0)); if ('error' in r) throw new Error(r.error); return r; };
    expect(shoot().ammo_left).toBe(3);
    expect(shoot().ammo_left).toBe(2);
    const onFloor = () => world.itemsIn({ type: 'spot', id: 'sp_tab_mesa' }).filter((i) => i.item_id === 't_flecha').reduce((a, i) => a + i.quantity, 0);
    expect(onFloor()).toBe(1);
    shoot(); shoot();
    expect(onFloor()).toBe(2); // de cuatro disparos, dos se recuperan
    expect(world.itemInstances.has(flechas.id)).toBe(false);
    expect(resolveAttack(world, kael.id, brenna.id, 'none', fixed(0))).toEqual({ error: expect.stringMatching(/munición/) });
  });
});

describe('fuerza mínima de la armadura pesada (§4.4)', () => {
  it('sin la FUE que pide, −10 pies; con ella, nada', async () => {
    const { world, kael } = await setup();
    give(world, kael, 't_malla', BODY);
    kael.abilities.str = 12;
    expect(armorSpeedPenalty(world, kael)).toBe(10);
    expect(gearLines(world, kael).join()).toMatch(/FUE 13/);
    kael.abilities.str = 13;
    expect(armorSpeedPenalty(world, kael)).toBe(0);
  });
});

describe('bonos mágicos (§4.5)', () => {
  it('arma +1: suma al ataque y al daño', async () => {
    const { world, kael } = await setup();
    give(world, kael, 't_espada_larga', MAIN);
    const plain = prof(attackProfile(world, kael));
    give(world, kael, 't_espada_mas1', MAIN);
    world.itemInstances.forEach((i) => { if (i.item_id === 't_espada_larga') world.itemInstances.delete(i.id); });
    const magic = prof(attackProfile(world, kael));
    expect(magic.attack_bonus).toBe(plain.attack_bonus + 1);
    expect(magic.damage_mod).toBe(plain.damage_mod + 1);
  });

  it('armadura +1 en la CA; el anillo de protección solo sintonizado (CA y salvaciones)', async () => {
    const { world, kael } = await setup();
    const before = armorClass(world, kael);
    give(world, kael, 't_cuero_mas1', BODY);
    expect(armorClass(world, kael)).toBe(11 + 1 + 1); // cuero 11 + DES 1 + 1 mágico
    const ring = give(world, kael, 't_anillo', { kind: 'equipped', slot: 'ring1' });
    expect(armorClass(world, kael)).toBe(13);
    expect(itemSaveBonus(world, kael)).toBe(0);
    expect(attune(world, kael, ring)).toEqual({ ok: true });
    expect(armorClass(world, kael)).toBe(14);
    expect(itemSaveBonus(world, kael)).toBe(1);
    expect(before).toBeLessThan(14);
  });

  it('la varita del mago de guerra suma al ataque de sus conjuros (sintonizada)', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    const w = give(world, kael, 't_varita_guerra', MAIN);
    expect(spellItemBonus(world, kael)).toEqual({ save_dc: 0, attack: 0 });
    expect(attune(world, kael, w)).toEqual({ ok: true });
    expect(spellItemBonus(world, kael)).toEqual({ save_dc: 0, attack: 1 });
    spellsOf(kael).cantrips = ['fire_bolt'];
    const plain = castSpell(kael, 'fire_bolt', {}, fixed(0.5));
    const boosted = castSpell(kael, 'fire_bolt', { bonus: spellItemBonus(world, kael) }, fixed(0.5));
    if (!plain.ok || !boosted.ok) throw new Error('no lanza');
    expect(boosted.attack).toBe(plain.attack + 1);
  });
});

describe('sintonización (§4.6)', () => {
  it('tres como mucho; lo que no la pide no se sintoniza; sintonizarse identifica', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    const items = [give(world, kael, 't_anillo', POCKET), give(world, kael, 't_varita_guerra', POCKET), give(world, kael, 't_anillo', POCKET), give(world, kael, 't_anillo', POCKET)];
    expect(itemName(world.itemDef('t_anillo'), items[0]!, kael.id)).toBe('anillo de plata');
    for (const i of items.slice(0, MAX_ATTUNED)) expect(attune(world, kael, i)).toEqual({ ok: true });
    expect(itemName(world.itemDef('t_anillo'), items[0]!, kael.id)).toBe('anillo de protección');
    expect(attunedItems(world, kael)).toHaveLength(3);
    expect(canAttune(world, kael, items[3]!)).toMatch(/máximo/);
    expect(canAttune(world, kael, give(world, kael, 't_espada_larga', POCKET))).toMatch(/no pide sintonía/);
    expect(endAttunement(world, kael, items[0]!)).toEqual({ ok: true });
    expect(attune(world, kael, items[3]!)).toEqual({ ok: true });
    expect(gearLines(world, kael).join()).toMatch(/Sintonizado con .*\(3\/3\)/);
  });

  it('la condición de sintonía (lanzador) y la maldición, que pone su efecto y no se suelta', async () => {
    const { world, kael } = await setup();
    const w = give(world, kael, 't_varita_guerra', MAIN);
    expect(canAttune(world, kael, w)).toMatch(/lanzador/);
    const capa = give(world, kael, 't_capa_maldita', { kind: 'equipped', slot: 'back' });
    expect(attune(world, kael, capa)).toEqual({ ok: true });
    expect(activeEffects(world, kael)).toContainEqual({ kind: 'disadvantage', on: 'saves' });
    expect(gearAdvantage(world, kael, 'save', 'wis')).toBe('disadvantage');
    expect(endAttunement(world, kael, capa)).toEqual({ ok: false, error: expect.stringMatching(/maldito/) });
  });

  it('el efecto puesto de unas botas: ventaja en Sigilo (sin sintonía); en el bolsillo, nada', async () => {
    const { world, kael } = await setup();
    const botas = give(world, kael, 't_botas', POCKET);
    expect(gearAdvantage(world, kael, 'skill', 'stealth')).toBe('none');
    botas.location = { type: 'character', id: kael.id, slot: { kind: 'equipped', slot: 'feet' } };
    expect(gearAdvantage(world, kael, 'skill', 'stealth')).toBe('advantage');
    // Con la cota de escamas, se anulan.
    give(world, kael, 't_escamas', BODY);
    expect(gearAdvantage(world, kael, 'skill', 'stealth')).toBe('none');
    expect(combineAdvantage('advantage', 'disadvantage', 'advantage')).toBe('none');
  });
});

describe('identificar (§4.7)', () => {
  it('sin identificar se ve con el nombre de fuera; identificado, el de verdad, solo para quien lo identifica', async () => {
    const { world, kael } = await setup();
    const v = give(world, kael, 't_varita_proyectiles', POCKET);
    expect(itemName(world.itemDef(v.item_id), v, kael.id)).toBe('vara de tejo');
    expect(identify(world, kael, v)).toBe(true);
    expect(itemName(world.itemDef(v.item_id), v, kael.id)).toBe('varita de proyectiles mágicos');
    expect(itemName(world.itemDef(v.item_id), v, 'ch_mira')).toBe('vara de tejo');
    expect(identify(world, kael, v)).toBe(false);
  });
});

describe('pergaminos (§4.8)', () => {
  it('de su lista y de su nivel: sale sin espacio, con la CD de la tabla, y el pergamino se gasta', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    const p = give(world, kael, 't_perg_proyectil', POCKET);
    const r = useScroll(world, kael, p, seededRng(1));
    if (!r.ok) throw new Error(r.error);
    expect(r.cast).toMatchObject({ cast_level: 1, save_dc: 13, attack: 5, check: null });
    expect(r.cast.roll?.expr).toBe('3d4+3');
    expect(world.itemInstances.has(p.id)).toBe(false);
    expect(kael.rest?.used ?? {}).toEqual({}); // no gasta espacios
  });

  it('de nivel mayor: prueba CD 10 + nivel; si falla, se pierde sin efecto; si sale, con la CD de su nivel', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    const a = give(world, kael, 't_perg_bola', POCKET);
    const fail = useScroll(world, kael, a, fixed(0));
    expect(fail).toMatchObject({ ok: false, consumed: true });
    expect(world.itemInstances.has(a.id)).toBe(false);
    const b = give(world, kael, 't_perg_bola', POCKET);
    const ok = useScroll(world, kael, b, fixed(0.99));
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.cast).toMatchObject({ cast_level: 3, save_dc: 15, attack: 7 });
    expect(ok.cast.check?.dc).toBe(13);
  });

  it('si no es de su lista no puede leerlo y no se gasta; quien no lanza conjuros, tampoco', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    const p = give(world, kael, 't_perg_curar', POCKET);
    expect(useScroll(world, kael, p)).toMatchObject({ ok: false, consumed: false });
    expect(world.itemInstances.has(p.id)).toBe(true);
    kael.class_id = 'fighter';
    expect(useScroll(world, kael, give(world, kael, 't_perg_proyectil', POCKET))).toMatchObject({ ok: false, consumed: false });
  });

  it('el pergamino genérico por nivel lleva su conjuro en el ejemplar', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    const p = give(world, kael, 't_perg_nivel1', POCKET, { state: { spell_id: 'magic_missile' } });
    const r = useScroll(world, kael, p, seededRng(2));
    if (!r.ok) throw new Error(r.error);
    expect(r.cast.spell.id).toBe('magic_missile');
    expect(useScroll(world, kael, give(world, kael, 't_perg_nivel1', POCKET))).toMatchObject({ ok: false, error: expect.stringMatching(/no dice qué conjuro/) });
  });

  it('el mago lo copia a su libro con Arcanos; salga o no, el pergamino se pierde', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    spellsOf(kael).known = [];
    const r = copyScroll(world, kael, give(world, kael, 't_perg_proyectil', POCKET), 5, fixed(0.99));
    expect(r).toMatchObject({ ok: true, copied: true });
    expect(spellsOf(kael).known).toContain('magic_missile');
    const again = copyScroll(world, kael, give(world, kael, 't_perg_proyectil', POCKET), 5, fixed(0.99));
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/ya está en su libro/) });
    kael.class_id = 'cleric';
    expect(copyScroll(world, kael, give(world, kael, 't_perg_curar', POCKET), 5)).toMatchObject({ ok: false, error: expect.stringMatching(/libro de conjuros/) });
  });
});

describe('cargas (§4.9)', () => {
  it('la varita gasta cargas (una de más sube un nivel), se recarga al alba y, al vaciarse, con un 1 se deshace', async () => {
    const { world, kael } = await setup();
    kael.class_id = 'wizard';
    const v = give(world, kael, 't_varita_proyectiles', MAIN);
    const t0 = 10 * GAME_HOUR; // las 10 de la mañana del día 0
    const r = castFromCharges(world, kael, v, 2, t0, { save_dc: 13, attack: 5 }, seededRng(4));
    if (!r.ok) throw new Error(r.error);
    expect(r.cast.cast_level).toBe(2);
    expect(r.cast.roll?.expr).toBe('3d4+3+1d4+1');
    expect(r.left).toBe(5);
    expect(spendCharges(world, v, 6, t0 + GAME_HOUR)).toMatchObject({ ok: false, error: expect.stringMatching(/solo tiene 5/) });
    // Al alba siguiente recupera 1d6+1 (con el dado al mínimo, 2).
    expect(timesBetween(t0, t0 + GAME_DAY, 6)).toBe(1);
    expect(refreshCharges(world, v, t0 + GAME_DAY, fixed(0))).toBe(7);
    // Vaciarla: con un 1 en el d20, se deshace.
    const empty = spendCharges(world, v, 7, t0 + GAME_DAY, fixed(0));
    expect(empty).toEqual({ ok: true, left: 0, destroyed: true });
    expect(world.itemInstances.has(v.id)).toBe(false);
  });
});

describe('pociones y efectos (§4.10)', () => {
  it('la poción pone su condición con duración; la de resistencia al fuego parte el daño de fuego a la mitad', async () => {
    const { world, kael } = await setup();
    const fx = applyItemEffect(world, kael, world.itemDef('t_pocion_invis'), 1000);
    expect(fx).toEqual({ name: 'invisible', expires_game_s: 1000 + 3600 });
    expect(kael.conditions.map((c) => c.name)).toContain('invisible');
    expect(damageAfterResistance(world, kael, 9, 'fire')).toBe(9);
    applyItemEffect(world, kael, world.itemDef('t_pocion_fuego'), 1000);
    expect(damageAfterResistance(world, kael, 9, 'fire')).toBe(4);
    expect(damageAfterResistance(world, kael, 9, 'cold')).toBe(9);
  });
});

describe('las tools del máster', () => {
  async function tools() {
    const s = await setup();
    const ctx: ToolContext = { engine: s.engine, actor: s.kael, nowGameS: s.engine.nowFor(s.kael), rng: seededRng(7), closed: null, rolls: [], progress: [] };
    const call = (name: string, input: Record<string, unknown>) => JSON.parse(executeTool(ctx, name, input)) as Record<string, unknown>;
    return { ...s, ctx, call };
  }

  it('use_item con una poción de efecto: se gasta y el motor pone la condición', async () => {
    const { world, kael, call } = await tools();
    const p = give(world, kael, 't_pocion_invis', POCKET);
    const r = call('use_item', { instance_id: p.id, quantity: null, target_id: null });
    expect(r).toMatchObject({ ok: true, effect: expect.stringMatching(/invisible/) });
    expect(kael.conditions.some((c) => c.name === 'invisible')).toBe(true);
    expect(world.itemInstances.has(p.id)).toBe(false);
  });

  it('use_item con la varita: gasta cargas, tira el conjuro y la identifica', async () => {
    const { world, kael, call } = await tools();
    kael.class_id = 'wizard';
    const v = give(world, kael, 't_varita_proyectiles', MAIN);
    const r = call('use_item', { instance_id: v.id, quantity: 1, target_id: null });
    expect(r).toMatchObject({ ok: true, charges_left: 6, spell: 'Proyectil mágico' });
    expect(String(r['roll'])).toMatch(/daño/);
    expect(itemName(world.itemDef(v.item_id), v, kael.id)).toBe('varita de proyectiles mágicos');
  });

  it('use_scroll: lanza el pergamino; con armadura sin competencia, no', async () => {
    const { world, kael, call } = await tools();
    kael.class_id = 'wizard';
    const p = give(world, kael, 't_perg_proyectil', POCKET);
    expect(call('use_scroll', { instance_id: p.id, mode: 'cast', target_id: null })).toMatchObject({ ok: true, spell: 'Proyectil mágico' });
    give(world, kael, 't_malla', BODY);
    const q = give(world, kael, 't_perg_proyectil', POCKET);
    expect(call('use_scroll', { instance_id: q.id, mode: 'cast', target_id: null })).toMatchObject({ error: expect.stringMatching(/no puede lanzar conjuros/) });
    expect(world.itemInstances.has(q.id)).toBe(true);
  });

  it('attune_item: una hora de descanso corto con el objeto y queda sintonizado (lo ve la ficha)', async () => {
    const { world, kael, call } = await tools();
    const ring = give(world, kael, 't_anillo', { kind: 'equipped', slot: 'ring1' });
    const r = call('attune_item', { instance_id: ring.id, mode: 'attune' });
    expect(r).toMatchObject({ ok: true, attuned: true, name: 'anillo de protección' });
    expect(ring.state.attuned_to).toBe(kael.id);
    const sheet = call('get_character', { character_id: kael.id });
    expect(String(sheet['gear'])).toMatch(/Sintonizado con anillo de protección/);
    expect(call('attune_item', { instance_id: ring.id, mode: 'end' })).toMatchObject({ ok: true });
  });

  it('cast_spell con armadura sin competencia no sale', async () => {
    const { world, kael, call } = await tools();
    kael.class_id = 'wizard';
    spellsOf(kael).cantrips = ['fire_bolt'];
    give(world, kael, 't_malla', BODY);
    expect(call('cast_spell', { spell: 'fire_bolt', slot_level: null, ritual: null, target_id: null })).toMatchObject({ error: expect.stringMatching(/sin saber llevarlo/) });
  });
});

describe('el cierre no deja narrar magia que el motor no ha aplicado (§4.11)', () => {
  const atHand = { scroll: true, potion: true, charged: true, attunable: true };
  it('poción, pergamino, varita y sintonía narrados sin su tool: se rechaza', () => {
    expect(magicWithoutTool({ narration: 'Te bebes la poción de un trago y tu cuerpo se desvanece.', okTools: [], atHand })).toMatch(/bebes la pocion/);
    expect(magicWithoutTool({ narration: 'Lees el pergamino en voz alta; las letras arden.', okTools: [], atHand })).toMatch(/lees el pergamino/);
    expect(magicWithoutTool({ narration: 'La varita escupe tres dardos de luz.', okTools: [], atHand })).toMatch(/varita escupe/);
    expect(magicWithoutTool({ narration: 'Tras una hora con el anillo entre los dedos, quedas sintonizado.', okTools: [], atHand })).toMatch(/sintonizado/);
  });
  it('con su tool, en negativo, en intención o sin el objeto a mano: no', () => {
    expect(magicWithoutTool({ narration: 'Te bebes la poción.', okTools: ['use_item'], atHand })).toBeNull();
    expect(magicWithoutTool({ narration: 'No te bebes la poción todavía.', okTools: [], atHand })).toBeNull();
    expect(magicWithoutTool({ narration: 'Lees el pergamino del tablón: una lista de encargos.', okTools: [], atHand: { ...atHand, scroll: false } })).toBeNull();
    expect(magicWithoutTool({ narration: 'Dice «bebe la poción, chico».', okTools: [], atHand })).toBeNull();
    expect(magicWithoutTool({ narration: 'Te bebes la poción.', okTools: [], atHand, pendingRoll: true })).toBeNull();
  });
});
