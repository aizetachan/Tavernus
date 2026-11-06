/**
 * Catálogo de objetos del SRD 5.1 (System Reference Document 5.1, Wizards of the
 * Coast, licencia CC BY 4.0, como razas, clases y conjuros): el equipo entero
 * (37 armas, 12 armaduras y el escudo, munición, equipo de aventurero,
 * herramientas, focos, arreos y vehículos de tiro, comida y bebida, mercancías)
 * y un primer lote pequeño de objetos mágicos. Solo lo del SRD: nada de otros
 * libros. PLAN-OBJETOS §3.
 *
 * - **Nombres en castellano** y, de primer alias, el nombre SRD en inglés (el
 *   máster y el jugador lo buscan así). Los ids son los de siempre para lo que ya
 *   había (`it_daga`, `it_maza`…): las partidas guardadas los usan.
 * - **Precios en cobre** (la moneda más pequeña de `money.ts`: oro = 100,
 *   plata = 10). Lo que el SRD vende por paquetes (20 flechas por 1 po) va por
 *   pieza: una flecha, 5 de cobre. Los pesos, en libras como el SRD.
 * - **Objetos mágicos:** el SRD no les pone precio. Valor de la casa por rareza
 *   (`MAGIC_VALUE`), la mitad para lo que se gasta; la poción de curación sí lo
 *   tiene en la lista de equipo (50 po).
 * - **Monturas y vehículos** no son objetos que se lleven encima: van aparte
 *   (`SRD_MOUNTS`, `SRD_VEHICLES`) para cuando el comercio cree vehículos. Los
 *   arreos (silla, alforjas, pienso) sí son objetos.
 * - **Géneros:** `srdCatalog(genre)` da el mismo catálogo con nombres de ciencia
 *   ficción o postapocalípticos donde los hay (`GENRE_NAMES`), con las mismas
 *   reglas: la pistola de rayos usa el bloque de la ballesta ligera, como el ajuar
 *   (outfit.ts, `kitItemDef`).
 * - **Versión:** `SRD_CATALOG_VERSION`. Cualquier cambio en una definición de aquí
 *   la sube; `migrate` (engine.ts) pone las definiciones SRD de cada partida a la
 *   versión del código y no toca las propias de la campaña (`origin: 'custom'`).
 *   Los ids no se borran nunca: una partida vieja puede tener ese objeto.
 *
 * La forma de cada definición es el modelo de objetos 5e (model.ts, bloque A):
 * `type` es la categoría de reglas y `subtype` la afina; las variantes mágicas
 * +N llevan `base_id` (su base) y `unidentified` (se ven como la base). La poción
 * de curación va sin rareza: está en la lista de equipo del SRD y se reconoce.
 */

import type { AmmoType, ItemDef, ItemRarity, ItemSize, ItemSubtype, ItemType, WeaponProperty, WeaponSubtype } from '../../engine/model.js';
import { WEAPON_PROPERTIES } from '../../engine/items.js';

/** Sube con cualquier cambio de una definición de este fichero. */
export const SRD_CATALOG_VERSION = 1;

/** Una definición del catálogo SRD: el modelo de objetos (model.ts, bloque A) con el nombre SRD en inglés. */
export interface SrdItemDef extends ItemDef {
  origin: 'srd';
  /** Nombre SRD en inglés (también es el primer alias). */
  en: string;
}

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

/** Precio SRD en cobre. */
const gp = (n: number) => Math.round(n * 100);
const sp = (n: number) => n * 10;
const cp = (n: number) => n;

/** Tamaño por peso, salvo que la entrada diga otro. */
function sizeOf(weight: number): ItemSize {
  if (weight <= 0.5) return 'tiny';
  if (weight <= 3) return 'small';
  if (weight <= 15) return 'medium';
  if (weight <= 50) return 'large';
  return 'bulky';
}

type Extra = Partial<Omit<SrdItemDef, 'id' | 'name' | 'aliases' | 'en' | 'type' | 'value' | 'weight_lb'>>;

function def(id: string, name: string, en: string, aliases: string[], type: ItemType, value: number, weight_lb: number, extra: Extra = {}): SrdItemDef {
  const lower = en.toLowerCase();
  return {
    id, name, aliases: [lower, ...aliases.filter((a) => a.toLowerCase() !== lower)], en, type, value, weight_lb,
    size: extra.size ?? sizeOf(weight_lb),
    unique: false, origin: 'srd',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Armas (37)
// ---------------------------------------------------------------------------

type Dmg = 'bludgeoning' | 'piercing' | 'slashing';
type WeaponExtra = Extra & { range?: [number, number]; versatile_damage?: string; ammo_type?: AmmoType };

function weapon(
  id: string, name: string, en: string, aliases: string[], subtype: WeaponSubtype, value: number, weight: number,
  damage: string, damage_type: Dmg, properties: WeaponProperty[] = [], extra: WeaponExtra = {},
): SrdItemDef {
  const { range, versatile_damage, ammo_type, ...rest } = extra;
  const p = new Set(properties);
  const ranged = subtype.endsWith('ranged');
  const size: ItemSize = rest.size ?? (p.has('heavy') || p.has('two_handed') || p.has('reach') ? 'large' : p.has('light') ? 'small' : 'medium');
  return def(id, name, en, aliases, 'weapon', value, weight, {
    subtype, size,
    weapon: {
      damage, damage_type,
      // Las booleanas de siempre (el combate las lee) y la lista 5e entera.
      ...(p.has('finesse') ? { finesse: true } : {}),
      ...(ranged ? { ranged: true } : {}),
      ...(p.has('two_handed') ? { two_handed: true } : {}),
      // En el orden de WEAPON_PROPERTIES, el que deja normalizeItemDef (si no, cada arranque la «cambiaría»).
      properties: WEAPON_PROPERTIES.filter((x) => p.has(x)),
      ...(range ? { range } : {}),
      ...(versatile_damage ? { versatile_damage } : {}),
      ...(ammo_type ? { ammo_type } : {}),
    },
    ...rest,
  });
}

const WEAPONS: SrdItemDef[] = [
  // Sencillas cuerpo a cuerpo
  weapon('it_garrote', 'garrote', 'Club', ['porra', 'cachiporra'], 'simple_melee', sp(1), 2, '1d4', 'bludgeoning', ['light']),
  weapon('it_daga', 'daga', 'Dagger', ['cuchillo', 'puñal'], 'simple_melee', gp(2), 1, '1d4', 'piercing', ['finesse', 'light', 'thrown'], { range: [20, 60] }),
  weapon('it_gran_garrote', 'gran garrote', 'Greatclub', ['garrote grande', 'tranca'], 'simple_melee', sp(2), 10, '1d8', 'bludgeoning', ['two_handed']),
  weapon('it_hacha_mano', 'hacha de mano', 'Handaxe', ['hachuela'], 'simple_melee', gp(5), 2, '1d6', 'slashing', ['light', 'thrown'], { range: [20, 60] }),
  weapon('it_jabalina', 'jabalina', 'Javelin', ['venablo'], 'simple_melee', sp(5), 2, '1d6', 'piercing', ['thrown'], { range: [30, 120], size: 'large' }),
  weapon('it_martillo_ligero', 'martillo ligero', 'Light hammer', ['martillo'], 'simple_melee', gp(2), 2, '1d4', 'bludgeoning', ['light', 'thrown'], { range: [20, 60] }),
  weapon('it_maza', 'maza', 'Mace', [], 'simple_melee', gp(5), 4, '1d6', 'bludgeoning'),
  weapon('it_baston', 'bastón', 'Quarterstaff', ['vara', 'staff', 'baston'], 'simple_melee', sp(2), 4, '1d6', 'bludgeoning', ['versatile'], { versatile_damage: '1d8', size: 'large' }),
  weapon('it_hoz', 'hoz', 'Sickle', [], 'simple_melee', gp(1), 2, '1d4', 'slashing', ['light']),
  weapon('it_lanza', 'lanza', 'Spear', ['pica corta'], 'simple_melee', gp(1), 3, '1d6', 'piercing', ['thrown', 'versatile'], { range: [20, 60], versatile_damage: '1d8', size: 'large' }),
  // Sencillas a distancia
  weapon('it_ballesta_ligera', 'ballesta ligera', 'Light crossbow', ['ballesta'], 'simple_ranged', gp(25), 5, '1d8', 'piercing', ['ammunition', 'loading', 'two_handed'], { range: [80, 320], ammo_type: 'bolt' }),
  weapon('it_dardo', 'dardo', 'Dart', ['dardos'], 'simple_ranged', cp(5), 0.25, '1d4', 'piercing', ['finesse', 'thrown'], { range: [20, 60], size: 'tiny' }),
  weapon('it_arco_corto', 'arco corto', 'Shortbow', ['arco'], 'simple_ranged', gp(25), 2, '1d6', 'piercing', ['ammunition', 'two_handed'], { range: [80, 320], ammo_type: 'arrow' }),
  weapon('it_honda', 'honda', 'Sling', ['tirachinas'], 'simple_ranged', sp(1), 0, '1d4', 'bludgeoning', ['ammunition'], { range: [30, 120], ammo_type: 'bullet', size: 'tiny' }),
  // Marciales cuerpo a cuerpo
  weapon('it_hacha_batalla', 'hacha de batalla', 'Battleaxe', ['hacha de guerra'], 'martial_melee', gp(10), 4, '1d8', 'slashing', ['versatile'], { versatile_damage: '1d10' }),
  weapon('it_mangual', 'mangual', 'Flail', [], 'martial_melee', gp(10), 2, '1d8', 'bludgeoning'),
  weapon('it_guja', 'guja', 'Glaive', [], 'martial_melee', gp(20), 6, '1d10', 'slashing', ['heavy', 'reach', 'two_handed']),
  weapon('it_gran_hacha', 'gran hacha', 'Greataxe', ['hacha grande'], 'martial_melee', gp(30), 7, '1d12', 'slashing', ['heavy', 'two_handed']),
  weapon('it_mandoble', 'mandoble', 'Greatsword', ['espadón', 'espadon', 'espada a dos manos'], 'martial_melee', gp(50), 6, '2d6', 'slashing', ['heavy', 'two_handed']),
  weapon('it_alabarda', 'alabarda', 'Halberd', [], 'martial_melee', gp(20), 6, '1d10', 'slashing', ['heavy', 'reach', 'two_handed']),
  weapon('it_lanza_caballeria', 'lanza de caballería', 'Lance', ['lanza de justa'], 'martial_melee', gp(10), 6, '1d12', 'piercing', ['reach', 'special'], {
    description: 'Desventaja contra un enemigo a 5 pies; a dos manos si no se va montado.',
  }),
  weapon('it_espada_larga', 'espada larga', 'Longsword', ['espada'], 'martial_melee', gp(15), 3, '1d8', 'slashing', ['versatile'], { versatile_damage: '1d10' }),
  weapon('it_mazo', 'mazo', 'Maul', ['martillo de dos manos'], 'martial_melee', gp(10), 10, '2d6', 'bludgeoning', ['heavy', 'two_handed']),
  weapon('it_lucero_alba', 'lucero del alba', 'Morningstar', ['maza de pinchos'], 'martial_melee', gp(15), 4, '1d8', 'piercing'),
  weapon('it_pica', 'pica', 'Pike', [], 'martial_melee', gp(5), 18, '1d10', 'piercing', ['heavy', 'reach', 'two_handed'], { size: 'bulky' }),
  weapon('it_estoque', 'estoque', 'Rapier', [], 'martial_melee', gp(25), 2, '1d8', 'piercing', ['finesse']),
  weapon('it_cimitarra', 'cimitarra', 'Scimitar', ['sable'], 'martial_melee', gp(25), 3, '1d6', 'slashing', ['finesse', 'light']),
  weapon('it_espada_corta', 'espada corta', 'Shortsword', ['espada'], 'martial_melee', gp(10), 2, '1d6', 'piercing', ['finesse', 'light'], { size: 'medium' }),
  weapon('it_tridente', 'tridente', 'Trident', [], 'martial_melee', gp(5), 4, '1d6', 'piercing', ['thrown', 'versatile'], { range: [20, 60], versatile_damage: '1d8', size: 'large' }),
  weapon('it_pico_guerra', 'pico de guerra', 'War pick', ['pico'], 'martial_melee', gp(5), 2, '1d8', 'piercing'),
  weapon('it_martillo_guerra', 'martillo de guerra', 'Warhammer', [], 'martial_melee', gp(15), 2, '1d8', 'bludgeoning', ['versatile'], { versatile_damage: '1d10' }),
  weapon('it_latigo', 'látigo', 'Whip', ['latigo', 'fusta'], 'martial_melee', gp(2), 3, '1d4', 'slashing', ['finesse', 'reach'], { size: 'small' }),
  // Marciales a distancia
  weapon('it_cerbatana', 'cerbatana', 'Blowgun', [], 'martial_ranged', gp(10), 1, '1', 'piercing', ['ammunition', 'loading'], { range: [25, 100], ammo_type: 'needle', size: 'small' }),
  weapon('it_ballesta_mano', 'ballesta de mano', 'Hand crossbow', ['ballestilla'], 'martial_ranged', gp(75), 3, '1d6', 'piercing', ['ammunition', 'light', 'loading'], { range: [30, 120], ammo_type: 'bolt' }),
  weapon('it_ballesta_pesada', 'ballesta pesada', 'Heavy crossbow', [], 'martial_ranged', gp(50), 18, '1d10', 'piercing', ['ammunition', 'heavy', 'loading', 'two_handed'], { range: [100, 400], ammo_type: 'bolt' }),
  weapon('it_arco_largo', 'arco largo', 'Longbow', ['arco'], 'martial_ranged', gp(50), 2, '1d8', 'piercing', ['ammunition', 'heavy', 'two_handed'], { range: [150, 600], ammo_type: 'arrow' }),
  weapon('it_red', 'red', 'Net', [], 'martial_ranged', gp(1), 3, '0', 'bludgeoning', ['special', 'thrown'], {
    range: [5, 15], size: 'medium',
    description: 'No hace daño: la criatura Grande o menor que alcanza queda apresada hasta que se libra (FUE CD 10) o corta la red.',
  }),
];

// ---------------------------------------------------------------------------
// Armaduras (12) y escudo
// ---------------------------------------------------------------------------

/** Segundos para ponerse y quitarse la armadura (SRD: 1, 5 y 10 minutos; quitarse, 1, 1 y 5). */
const DON: Record<'light' | 'medium' | 'heavy', [number, number]> = { light: [60, 60], medium: [300, 60], heavy: [600, 300] };

function armor(
  id: string, name: string, en: string, aliases: string[], subtype: 'light' | 'medium' | 'heavy', value: number, weight: number,
  ac_base: number, stealth_disadvantage: boolean, str_min?: number,
): SrdItemDef {
  const dex_max = subtype === 'light' ? null : subtype === 'medium' ? 2 : 0;
  const [don_s, doff_s] = DON[subtype];
  return def(id, name, en, aliases, 'armor', value, weight, {
    subtype, size: 'large', equip_slot: 'body',
    armor: { ac_base, dex_max, stealth_disadvantage, ...(str_min ? { str_min } : {}), don_s, doff_s },
  });
}

const ARMORS: SrdItemDef[] = [
  armor('it_armadura_acolchada', 'armadura acolchada', 'Padded armor', ['acolchada', 'gambesón', 'gambeson'], 'light', gp(5), 8, 11, true),
  armor('it_armadura_cuero', 'armadura de cuero', 'Leather armor', ['cuero'], 'light', gp(10), 10, 11, false),
  armor('it_cuero_tachonado', 'armadura de cuero tachonado', 'Studded leather armor', ['cuero tachonado', 'tachonado'], 'light', gp(45), 13, 12, false),
  armor('it_armadura_pieles', 'armadura de pieles', 'Hide armor', ['pieles'], 'medium', gp(10), 12, 12, false),
  armor('it_camisote_malla', 'camisote de malla', 'Chain shirt', ['camisote'], 'medium', gp(50), 20, 13, false),
  armor('it_cota_escamas', 'cota de escamas', 'Scale mail', ['escamas'], 'medium', gp(50), 45, 14, true),
  armor('it_coraza', 'coraza', 'Breastplate', ['peto'], 'medium', gp(400), 20, 14, false),
  armor('it_media_armadura', 'media armadura', 'Half plate', ['media armadura de placas'], 'medium', gp(750), 40, 15, true),
  armor('it_cota_anillas', 'cota de anillas', 'Ring mail', ['anillas'], 'heavy', gp(30), 40, 14, true),
  armor('it_cota_malla', 'cota de malla', 'Chain mail', ['malla'], 'heavy', gp(75), 55, 16, true, 13),
  armor('it_armadura_bandas', 'armadura de bandas', 'Splint armor', ['bandas', 'tablillas'], 'heavy', gp(200), 60, 17, true, 15),
  armor('it_armadura_placas', 'armadura de placas', 'Plate armor', ['placas', 'armadura completa'], 'heavy', gp(1500), 65, 18, true, 15),
  def('it_escudo', 'escudo', 'Shield', ['rodela', 'broquel'], 'armor', gp(10), 6, { subtype: 'shield', size: 'medium', shield_bonus: 2 }),
];

// ---------------------------------------------------------------------------
// Munición (por pieza; el SRD la vende por paquetes)
// ---------------------------------------------------------------------------

const ammo = (id: string, name: string, en: string, aliases: string[], ammo_type: AmmoType, packValue: number, packWeight: number, pack: number): SrdItemDef =>
  def(id, name, en, aliases, 'ammunition', packValue / pack, packWeight / pack, { subtype: ammo_type, size: 'tiny' });

const AMMUNITION: SrdItemDef[] = [
  ammo('it_flechas', 'flecha', 'Arrow', ['flechas', 'arrows'], 'arrow', gp(1), 1, 20),
  ammo('it_virotes', 'virote', 'Crossbow bolt', ['virotes', 'saeta', 'saetas', 'bolts'], 'bolt', gp(1), 1.5, 20),
  ammo('it_balas_honda', 'bala de honda', 'Sling bullet', ['balas de honda', 'bala', 'balas', 'piedra de honda'], 'bullet', cp(4), 1.5, 20),
  ammo('it_agujas_cerbatana', 'aguja de cerbatana', 'Blowgun needle', ['agujas de cerbatana', 'aguja', 'agujas'], 'needle', gp(1), 1, 50),
];

// ---------------------------------------------------------------------------
// Equipo de aventurero
// ---------------------------------------------------------------------------

/** Equipo: `gear` con su subtipo (contenedor, luz, ropa o de aventurero) salvo que la entrada diga otro tipo. */
function g(id: string, name: string, en: string, aliases: string[], value: number, weight: number, extra: Extra & { type?: ItemType } = {}): SrdItemDef {
  const { type = 'gear', ...rest } = extra;
  const subtype: ItemSubtype | undefined = rest.subtype ?? (type !== 'gear' ? undefined : rest.container ? 'container' : rest.light_source ? 'light' : 'adventuring');
  return def(id, name, en, aliases, type, value, weight, { ...rest, ...(subtype ? { subtype } : {}) });
}
const box = (slots: number, max_weight_lb: number, max_size: ItemSize) => ({ container: { slots, max_weight_lb, max_size } });

const GEAR: SrdItemDef[] = [
  g('it_abaco', 'ábaco', 'Abacus', ['abaco'], gp(2), 2),
  g('it_acido', 'vial de ácido', 'Acid (vial)', ['ácido', 'acido', 'acid'], gp(25), 1, { type: 'consumable', size: 'tiny', description: 'Se lanza (20 pies) o se vierte: 2d6 de ácido.' }),
  g('it_fuego_alquimista', 'fuego de alquimista', 'Alchemist\'s fire (flask)', ['fuego alquímico', 'alchemist fire'], gp(50), 1, { type: 'consumable', size: 'small', description: 'Se lanza (20 pies): 1d4 de fuego por asalto hasta que se apaga (DES CD 10).' }),
  g('it_antitoxina', 'antitoxina', 'Antitoxin (vial)', ['antídoto', 'antidoto'], gp(50), 0, { type: 'consumable', size: 'tiny', description: 'Ventaja contra el veneno durante una hora.' }),
  g('it_mochila', 'mochila', 'Backpack', ['bolsa', 'macuto', 'zurrón'], gp(2), 5, { size: 'medium', equip_slot: 'back', container: { slots: 20, max_weight_lb: 60, max_size: 'medium' } }),
  g('it_canicas', 'bolsa de canicas de metal', 'Ball bearings (bag of 1,000)', ['canicas', 'bolas de metal', 'ball bearings'], gp(1), 2),
  g('it_barril', 'barril', 'Barrel', ['tonel', 'barrica'], gp(2), 70, { size: 'bulky', description: 'Cabe 40 galones de líquido o 4 pies cúbicos de sólido.' }),
  g('it_cesta', 'cesta', 'Basket', ['canasta', 'cesto'], sp(4), 2, { size: 'medium', ...box(10, 40, 'small') }),
  g('it_saco_dormir', 'saco de dormir', 'Bedroll', ['petate', 'jergón'], gp(1), 7),
  g('it_campana', 'campanilla', 'Bell', ['campana'], gp(1), 0, { size: 'tiny' }),
  g('it_manta', 'manta', 'Blanket', ['frazada'], sp(5), 3),
  g('it_polea', 'polipasto', 'Block and tackle', ['poleas', 'aparejo'], gp(1), 5),
  g('it_libro', 'libro', 'Book', ['tomo', 'volumen'], gp(25), 5, { size: 'small' }),
  g('it_botella', 'botella de cristal', 'Bottle, glass', ['botella'], gp(2), 2),
  g('it_cubo', 'cubo', 'Bucket', ['balde'], cp(5), 2, { size: 'medium', ...box(4, 20, 'small') }),
  g('it_abrojos', 'bolsa de abrojos', 'Caltrops (bag of 20)', ['abrojos', 'caltrops'], gp(1), 2),
  g('it_vela', 'vela', 'Candle', ['velas', 'cirio'], cp(1), 0, { size: 'tiny', light_source: true }),
  g('it_estuche_virotes', 'estuche de virotes', 'Case, crossbow bolt', ['carcaj de virotes'], gp(1), 1, { equip_slot: 'belt', ...box(1, 2, 'tiny') }),
  g('it_estuche_mapas', 'estuche de mapas', 'Case, map or scroll', ['portamapas', 'canuto'], gp(1), 1, box(10, 1, 'tiny')),
  g('it_cadena', 'cadena', 'Chain (10 feet)', ['cadenas'], gp(5), 10),
  g('it_tiza', 'tiza', 'Chalk (1 piece)', ['tizas'], cp(1), 0, { size: 'tiny' }),
  g('it_arcon', 'arcón', 'Chest', ['cofre', 'baúl', 'arca', 'arcon'], gp(5), 25, { size: 'large', ...box(30, 300, 'large') }),
  g('it_equipo_escalada', 'equipo de escalada', 'Climber\'s kit', ['escalada', 'climbers kit'], gp(25), 12, { type: 'tool', subtype: 'kit' }),
  g('it_ropa_comun', 'ropa común', 'Clothes, common', ['ropa', 'ropas'], sp(5), 3, { subtype: 'clothes', equip_slot: 'body' }),
  g('it_disfraz', 'disfraz', 'Clothes, costume', ['ropa de disfraz', 'costume'], gp(5), 4, { subtype: 'clothes', equip_slot: 'body' }),
  g('it_ropa_fina', 'ropa fina', 'Clothes, fine', ['ropas finas', 'traje'], gp(15), 6, { subtype: 'clothes', equip_slot: 'body' }),
  g('it_ropa_viaje', 'ropa de viaje', 'Clothes, traveler\'s', ['ropa de camino'], gp(2), 4, { subtype: 'clothes', equip_slot: 'body' }),
  g('it_palanca', 'palanca', 'Crowbar', ['pata de cabra', 'alzaprima'], gp(2), 5, { type: 'tool', size: 'medium' }),
  g('it_aparejo_pesca', 'aparejo de pesca', 'Fishing tackle', ['caña de pescar', 'caña', 'sedal'], gp(1), 4, { type: 'tool' }),
  g('it_petaca', 'petaca', 'Flask or tankard', ['jarra de metal', 'tankard', 'flask'], cp(2), 1),
  g('it_garfio', 'garfio de escalada', 'Grappling hook', ['garfio', 'gancho'], gp(2), 4, { type: 'tool' }),
  g('it_martillo', 'martillo de herramientas', 'Hammer', ['martillo de carpintero'], gp(1), 3, { type: 'tool' }),
  g('it_almadena', 'almádena', 'Hammer, sledge', ['marro', 'almadena'], gp(2), 10, { type: 'tool' }),
  g('it_equipo_sanador', 'kit de sanador', 'Healer\'s kit', ['botiquín', 'botiquin', 'healers kit'], gp(5), 3, { type: 'tool', subtype: 'kit', description: 'Diez usos: estabiliza a quien está a 0 PG sin tirar Medicina.' }),
  g('it_agua_bendita', 'agua bendita', 'Holy water (flask)', ['agua santa'], gp(25), 1, { type: 'consumable', size: 'small', description: 'Se lanza (20 pies): 2d6 radiante a infernales y muertos vivientes.' }),
  g('it_reloj_arena', 'reloj de arena', 'Hourglass', [], gp(25), 1),
  g('it_cepo', 'cepo de caza', 'Hunting trap', ['cepo', 'trampa'], gp(5), 25, { type: 'tool' }),
  g('it_tinta', 'frasco de tinta', 'Ink (1 ounce bottle)', ['tinta'], gp(10), 0, { size: 'tiny' }),
  g('it_pluma', 'pluma de escribir', 'Ink pen', ['pluma', 'cálamo'], cp(2), 0, { size: 'tiny' }),
  g('it_jarra', 'jarra de barro', 'Jug or pitcher', ['cántaro', 'jarro'], cp(2), 4),
  g('it_escalera', 'escalera de mano', 'Ladder (10-foot)', ['escalera'], sp(1), 25, { size: 'bulky' }),
  g('it_lampara', 'lámpara de aceite', 'Lamp', ['lámpara', 'lampara', 'candil'], sp(5), 1, { light_source: true }),
  g('it_linterna_sorda', 'linterna sorda', 'Lantern, bullseye', ['linterna de ojo de buey'], gp(10), 2, { light_source: true }),
  g('it_farol', 'farol', 'Lantern, hooded', ['linterna', 'farol de capucha'], gp(5), 2, { light_source: true }),
  g('it_candado', 'candado', 'Lock', ['cerradura'], gp(10), 1),
  g('it_lupa', 'lupa', 'Magnifying glass', ['lente de aumento'], gp(100), 0, { size: 'tiny' }),
  g('it_grilletes', 'grilletes', 'Manacles', ['esposas', 'cadenas de preso'], gp(2), 6),
  g('it_escudilla', 'escudilla de campaña', 'Mess kit', ['escudilla', 'plato'], sp(2), 1),
  g('it_espejo', 'espejo de acero', 'Mirror, steel', ['espejo'], gp(5), 0.5),
  g('it_aceite', 'frasco de aceite', 'Oil (flask)', ['aceite'], sp(1), 1, { type: 'consumable', subtype: 'oil', description: 'Combustible para la lámpara (6 horas) o, derramado y encendido, 5 de fuego.' }),
  g('it_papel', 'hoja de papel', 'Paper (one sheet)', ['papel'], sp(2), 0, { size: 'tiny' }),
  g('it_pergamino_blanco', 'hoja de pergamino', 'Parchment (one sheet)', ['pergamino en blanco', 'vitela'], sp(1), 0, { size: 'tiny' }),
  g('it_perfume', 'frasco de perfume', 'Perfume (vial)', ['perfume'], gp(5), 0, { size: 'tiny' }),
  g('it_pico_minero', 'pico de minero', 'Pick, miner\'s', ['piqueta'], gp(2), 10, { type: 'tool' }),
  g('it_piton', 'pitón de escalada', 'Piton', ['pitones', 'clavija'], cp(5), 0.25),
  g('it_veneno', 'vial de veneno', 'Poison, basic (vial)', ['veneno'], gp(100), 0, { type: 'consumable', subtype: 'poison', size: 'tiny', description: 'Untado en un arma (una acción): 1d4 de veneno al golpear, durante 1 minuto.' }),
  g('it_pertiga', 'pértiga', 'Pole (10-foot)', ['palo largo', 'pertiga'], cp(5), 7, { size: 'bulky' }),
  g('it_olla_hierro', 'olla de hierro', 'Pot, iron', ['olla', 'puchero'], gp(2), 10),
  g('it_bolsa', 'bolsa', 'Pouch', ['bolsita', 'faltriquera'], sp(5), 1, { equip_slot: 'belt', ...box(6, 6, 'tiny') }),
  g('it_carcaj', 'carcaj', 'Quiver', ['aljaba'], gp(1), 1, { equip_slot: 'belt', ...box(1, 2, 'tiny') }),
  g('it_ariete', 'ariete portátil', 'Ram, portable', ['ariete'], gp(4), 35, { type: 'tool' }),
  g('it_tunica', 'túnica', 'Robes', ['hábito', 'tunica'], gp(1), 4, { subtype: 'clothes', equip_slot: 'body' }),
  g('it_cuerda', 'cuerda de cáñamo', 'Rope, hempen (50 feet)', ['cuerda', 'soga'], gp(1), 10, { type: 'tool' }),
  g('it_cuerda_seda', 'cuerda de seda', 'Rope, silk (50 feet)', [], gp(10), 5, { type: 'tool' }),
  g('it_saco', 'saco', 'Sack', ['costal', 'talega'], cp(1), 0.5, { size: 'small', ...box(12, 30, 'medium') }),
  g('it_balanza', 'balanza de mercader', 'Scale, merchant\'s', ['balanza'], gp(5), 3),
  g('it_lacre', 'barra de lacre', 'Sealing wax', ['lacre'], sp(5), 0, { size: 'tiny' }),
  g('it_pala', 'pala', 'Shovel', ['azada'], gp(2), 5, { type: 'tool' }),
  g('it_silbato', 'silbato de señales', 'Signal whistle', ['silbato'], cp(5), 0, { size: 'tiny' }),
  g('it_anillo_sello', 'anillo de sello', 'Signet ring', ['sello'], gp(5), 0, { size: 'tiny' }),
  g('it_jabon', 'pastilla de jabón', 'Soap', ['jabón', 'jabon'], cp(2), 0, { size: 'tiny' }),
  g('it_libro_conjuros', 'libro de conjuros', 'Spellbook', ['grimorio', 'libro'], gp(50), 3, { type: 'tool' }),
  g('it_clavos_hierro', 'clavos de hierro', 'Spikes, iron (10)', ['escarpias'], gp(1), 5),
  g('it_catalejo', 'catalejo', 'Spyglass', ['anteojo'], gp(1000), 1),
  g('it_tienda', 'tienda de campaña', 'Tent, two-person', ['tienda', 'toldo'], gp(2), 20),
  g('it_yesca', 'yesquero', 'Tinderbox', ['yesca', 'pedernal', 'eslabón', 'mechero'], sp(5), 1, { type: 'tool' }),
  g('it_antorcha', 'antorcha', 'Torch', ['tea'], cp(1), 1, { size: 'small', light_source: true }),
  g('it_vial', 'vial', 'Vial', ['frasquito', 'redoma'], gp(1), 0, { size: 'tiny' }),
  g('it_odre', 'odre', 'Waterskin', ['cantimplora', 'bota de agua'], sp(2), 5),
  g('it_piedra_afilar', 'piedra de afilar', 'Whetstone', ['afiladera'], cp(1), 1),
];

// ---------------------------------------------------------------------------
// Focos (arcanos, druídicos, símbolos sagrados) y bolsa de componentes
// ---------------------------------------------------------------------------

/** Foco de lanzamiento; la bolsa de componentes es foco sin subtipo (sirve a cualquier lanzador que use componentes). */
const focus = (id: string, name: string, en: string, aliases: string[], subtype: 'arcane' | 'druidic' | 'holy' | null, value: number, weight: number, extra: Extra = {}) =>
  def(id, name, en, aliases, 'focus', value, weight, { ...(subtype ? { subtype } : {}), ...extra });

const FOCI: SrdItemDef[] = [
  focus('it_bolsa_componentes', 'bolsa de componentes', 'Component pouch', ['componentes'], null, gp(25), 2),
  focus('it_cristal_arcano', 'cristal arcano', 'Crystal', ['cristal'], 'arcane', gp(10), 1),
  focus('it_orbe', 'orbe', 'Orb', ['esfera'], 'arcane', gp(20), 3),
  focus('it_cetro_arcano', 'cetro arcano', 'Rod', ['cetro'], 'arcane', gp(10), 2),
  focus('it_baculo_arcano', 'báculo arcano', 'Staff', ['báculo', 'baculo'], 'arcane', gp(5), 4, { size: 'large' }),
  focus('it_varita_arcana', 'varita arcana', 'Wand', ['varita'], 'arcane', gp(10), 1),
  focus('it_muerdago', 'ramita de muérdago', 'Sprig of mistletoe', ['muérdago', 'muerdago'], 'druidic', gp(1), 0, { size: 'tiny' }),
  focus('it_totem', 'tótem', 'Totem', ['totem'], 'druidic', gp(1), 0, { size: 'tiny' }),
  focus('it_baculo_madera', 'bastón de madera', 'Wooden staff', ['báculo de madera'], 'druidic', gp(5), 4, { size: 'large' }),
  focus('it_varita_tejo', 'varita de tejo', 'Yew wand', ['varita'], 'druidic', gp(10), 1),
  focus('it_simbolo_sagrado', 'símbolo sagrado', 'Amulet', ['simbolo', 'holy symbol', 'amuleto sagrado'], 'holy', gp(5), 1, { size: 'tiny', equip_slot: 'neck' }),
  focus('it_emblema_sagrado', 'emblema sagrado', 'Emblem', ['emblema'], 'holy', gp(5), 0, { size: 'tiny' }),
  focus('it_relicario', 'relicario', 'Reliquary', ['reliquia'], 'holy', gp(5), 2),
];

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

const tool = (id: string, name: string, en: string, aliases: string[], subtype: 'artisan' | 'kit' | 'gaming' | 'instrument', value: number, weight: number, extra: Extra = {}) =>
  def(id, name, en, aliases, 'tool', value, weight, { subtype, ...extra });

const TOOLS: SrdItemDef[] = [
  tool('it_utiles_alquimista', 'útiles de alquimista', 'Alchemist\'s supplies', ['alquimia'], 'artisan', gp(50), 8),
  tool('it_utiles_cervecero', 'útiles de cervecero', 'Brewer\'s supplies', [], 'artisan', gp(20), 9),
  tool('it_utiles_caligrafo', 'útiles de calígrafo', 'Calligrapher\'s supplies', [], 'artisan', gp(10), 5),
  tool('it_herramientas_carpintero', 'herramientas de carpintero', 'Carpenter\'s tools', [], 'artisan', gp(8), 6),
  tool('it_herr_cartografo', 'herramientas de cartógrafo', 'Cartographer\'s tools', [], 'artisan', gp(15), 6),
  tool('it_herr_zapatero', 'herramientas de zapatero', 'Cobbler\'s tools', [], 'artisan', gp(5), 5),
  tool('it_utensilios_cocina', 'utensilios de cocina', 'Cook\'s utensils', ['cacharros'], 'artisan', gp(1), 8),
  tool('it_herr_vidriero', 'herramientas de vidriero', 'Glassblower\'s tools', [], 'artisan', gp(30), 5),
  tool('it_herr_joyero', 'herramientas de joyero', 'Jeweler\'s tools', [], 'artisan', gp(25), 2),
  tool('it_herr_peletero', 'herramientas de peletero', 'Leatherworker\'s tools', ['herramientas de curtidor'], 'artisan', gp(5), 5),
  tool('it_herr_albanil', 'herramientas de albañil', 'Mason\'s tools', ['herramientas de cantero'], 'artisan', gp(10), 8),
  tool('it_utiles_pintor', 'útiles de pintor', 'Painter\'s supplies', ['pinceles'], 'artisan', gp(10), 5),
  tool('it_herr_alfarero', 'herramientas de alfarero', 'Potter\'s tools', [], 'artisan', gp(10), 3),
  tool('it_herr_herrero', 'herramientas de herrero', 'Smith\'s tools', [], 'artisan', gp(20), 8),
  tool('it_herr_hojalatero', 'herramientas de hojalatero', 'Tinker\'s tools', ['herramientas de chapucero'], 'artisan', gp(50), 10),
  tool('it_herr_tejedor', 'herramientas de tejedor', 'Weaver\'s tools', [], 'artisan', gp(1), 5),
  tool('it_herr_tallista', 'herramientas de tallista', 'Woodcarver\'s tools', ['gubias'], 'artisan', gp(1), 5),
  tool('it_equipo_disfraz', 'kit de disfraz', 'Disguise kit', ['maquillaje'], 'kit', gp(25), 3),
  tool('it_equipo_falsificador', 'kit de falsificador', 'Forgery kit', ['falsificación'], 'kit', gp(15), 5),
  tool('it_dados', 'juego de dados', 'Dice set', ['dados'], 'gaming', sp(1), 0, { size: 'tiny' }),
  tool('it_naipes', 'baraja de naipes', 'Playing card set', ['naipes', 'cartas', 'baraja'], 'gaming', sp(5), 0, { size: 'tiny' }),
  tool('it_equipo_herborista', 'kit de herborista', 'Herbalism kit', ['herboristería', 'hierbas'], 'kit', gp(5), 3),
  tool('it_gaita', 'gaita', 'Bagpipes', [], 'instrument', gp(30), 6),
  tool('it_tambor', 'tambor', 'Drum', ['tamboril'], 'instrument', gp(6), 3),
  tool('it_salterio', 'salterio', 'Dulcimer', ['dulcémele'], 'instrument', gp(25), 10),
  tool('it_flauta', 'flauta', 'Flute', [], 'instrument', gp(2), 1),
  tool('it_laud', 'laúd', 'Lute', ['laud', 'instrumento'], 'instrument', gp(35), 2, { size: 'medium' }),
  tool('it_lira', 'lira', 'Lyre', [], 'instrument', gp(30), 2),
  tool('it_cuerno', 'cuerno', 'Horn', ['trompa'], 'instrument', gp(3), 2),
  tool('it_flauta_pan', 'flauta de pan', 'Pan flute', ['zampoña'], 'instrument', gp(12), 2),
  tool('it_chirimia', 'chirimía', 'Shawm', ['chirimia'], 'instrument', gp(2), 1),
  tool('it_viola', 'viola', 'Viol', ['vihuela'], 'instrument', gp(30), 1),
  tool('it_herr_navegante', 'herramientas de navegante', 'Navigator\'s tools', ['sextante'], 'kit', gp(25), 2),
  tool('it_equipo_envenenador', 'kit de envenenador', 'Poisoner\'s kit', [], 'kit', gp(50), 2),
  tool('it_ganzuas', 'herramientas de ladrón', 'Thieves\' tools', ['ganzuas', 'ganzúas', 'thieves tools'], 'kit', gp(25), 1, { size: 'small' }),
];

// ---------------------------------------------------------------------------
// Arreos y pienso (las monturas y vehículos, aparte: SRD_MOUNTS, SRD_VEHICLES)
// ---------------------------------------------------------------------------

const TACK: SrdItemDef[] = [
  g('it_bocado_brida', 'bocado y brida', 'Bit and bridle', ['brida', 'riendas'], gp(2), 1),
  g('it_pienso', 'ración de pienso', 'Feed (per day)', ['pienso', 'forraje', 'avena'], cp(5), 10, { type: 'consumable', subtype: 'food' }),
  g('it_silla_exotica', 'silla de montar exótica', 'Saddle, exotic', [], gp(60), 40),
  g('it_silla_militar', 'silla de montar militar', 'Saddle, military', [], gp(20), 30),
  g('it_albarda', 'albarda', 'Saddle, pack', ['silla de carga'], gp(5), 15),
  g('it_silla_montar', 'silla de montar', 'Saddle, riding', ['silla'], gp(10), 25),
  g('it_alforjas', 'alforjas', 'Saddlebags', [], gp(4), 8, { ...box(12, 30, 'small') }),
];

// ---------------------------------------------------------------------------
// Comida, bebida y alojamiento
// ---------------------------------------------------------------------------

const food = (id: string, name: string, en: string, aliases: string[], value: number, weight: number, extra: Extra = {}) =>
  def(id, name, en, aliases, 'consumable', value, weight, { subtype: 'food', ...extra });

const FOOD: SrdItemDef[] = [
  food('it_racion', 'ración', 'Rations (1 day)', ['raciones', 'comida', 'ration', 'víveres'], sp(5), 2, { size: 'small' }),
  food('it_cerveza', 'jarra de cerveza', 'Ale (mug)', ['cerveza', 'jarra', 'beer', 'ale'], cp(4), 1, { subtype: 'drink', size: 'small' }),
  food('it_cerveza_galon', 'galón de cerveza', 'Ale (gallon)', ['barrilito de cerveza'], sp(2), 8, { subtype: 'drink' }),
  food('it_pan', 'hogaza de pan', 'Bread (loaf)', ['pan', 'hogaza'], cp(2), 1),
  food('it_queso', 'cuña de queso', 'Cheese (hunk)', ['queso'], sp(1), 1),
  food('it_carne', 'trozo de carne', 'Meat (chunk)', ['carne', 'cecina'], sp(3), 1),
  food('it_vino', 'jarra de vino', 'Wine, common (pitcher)', ['vino', 'vino común'], sp(2), 4, { subtype: 'drink' }),
  food('it_vino_fino', 'botella de vino fino', 'Wine, fine (bottle)', ['vino fino', 'vino bueno'], gp(10), 2, { subtype: 'drink' }),
];

// ---------------------------------------------------------------------------
// Mercancías (por libra o por vara cuadrada, como el SRD)
// ---------------------------------------------------------------------------

const trade = (id: string, name: string, en: string, aliases: string[], value: number, weight: number) =>
  def(id, name, en, aliases, 'treasure', value, weight, { subtype: 'trade' });

const TRADE_GOODS: SrdItemDef[] = [
  trade('it_trigo', 'libra de trigo', 'Wheat (1 lb)', ['trigo', 'grano'], cp(1), 1),
  trade('it_harina_libra', 'libra de harina', 'Flour (1 lb)', ['harina'], cp(2), 1),
  trade('it_sal', 'libra de sal', 'Salt (1 lb)', ['sal'], cp(5), 1),
  trade('it_hierro', 'libra de hierro', 'Iron (1 lb)', ['hierro', 'lingote de hierro'], sp(1), 1),
  trade('it_lona', 'vara de lona', 'Canvas (1 sq. yd.)', ['lona'], sp(1), 1),
  trade('it_cobre_libra', 'libra de cobre', 'Copper (1 lb)', ['cobre en lingote'], sp(5), 1),
  trade('it_algodon', 'vara de tela de algodón', 'Cotton cloth (1 sq. yd.)', ['algodón', 'tela'], sp(5), 1),
  trade('it_jengibre', 'libra de jengibre', 'Ginger (1 lb)', ['jengibre'], gp(1), 1),
  trade('it_canela', 'libra de canela', 'Cinnamon (1 lb)', ['canela'], gp(2), 1),
  trade('it_pimienta', 'libra de pimienta', 'Pepper (1 lb)', ['pimienta'], gp(2), 1),
  trade('it_clavo', 'libra de clavo', 'Cloves (1 lb)', ['clavo de olor'], gp(3), 1),
  trade('it_plata_libra', 'libra de plata', 'Silver (1 lb)', ['plata en lingote', 'lingote de plata'], gp(5), 1),
  trade('it_lino', 'vara de lino', 'Linen (1 sq. yd.)', ['lino'], gp(5), 1),
  trade('it_seda', 'vara de seda', 'Silk (1 sq. yd.)', ['seda'], gp(10), 1),
  trade('it_azafran', 'libra de azafrán', 'Saffron (1 lb)', ['azafrán', 'azafran'], gp(15), 1),
  trade('it_oro_libra', 'libra de oro', 'Gold (1 lb)', ['oro en lingote', 'lingote de oro'], gp(50), 1),
  trade('it_platino_libra', 'libra de platino', 'Platinum (1 lb)', ['platino'], gp(500), 1),
];

// ---------------------------------------------------------------------------
// Objetos mágicos: un primer lote pequeño
// ---------------------------------------------------------------------------

type PricedRarity = Exclude<ItemRarity, 'artifact'>;

/** Valor de la casa por rareza, en cobre (el SRD no pone precio a la magia). Lo que se gasta, la mitad. */
export const MAGIC_VALUE: Record<PricedRarity, number> = {
  common: gp(50), uncommon: gp(250), rare: gp(2500), very_rare: gp(25000), legendary: gp(100000),
};
const magicValue = (r: PricedRarity, spent = false) => (spent ? MAGIC_VALUE[r] / 2 : MAGIC_VALUE[r]);

/** Cómo se ve una poción mágica sin identificar. */
const RED_POTION = { name: 'poción roja', description: 'Un líquido rojo que brilla al agitarlo.' };

const POTIONS: SrdItemDef[] = [
  // La de curación está en la lista de equipo del SRD (50 po): se compra en cualquier botica y se reconoce a la vista.
  // Sin rareza a propósito: con ella sería mágica y saldría «sin identificar» hasta un descanso (bloque A).
  def('it_pocion', 'poción de curación', 'Potion of healing', ['poción', 'pocion', 'potion'], 'consumable', gp(50), 0.5, { subtype: 'potion', size: 'small', heals: '2d4+2' }),
  def('it_pocion_mayor', 'poción de curación mayor', 'Potion of greater healing', ['poción mayor', 'pocion mayor'], 'consumable', magicValue('uncommon', true), 0.5, { subtype: 'potion', size: 'small', heals: '4d4+4', rarity: 'uncommon', unidentified: RED_POTION }),
  def('it_pocion_superior', 'poción de curación superior', 'Potion of superior healing', ['poción superior', 'pocion superior'], 'consumable', magicValue('rare', true), 0.5, { subtype: 'potion', size: 'small', heals: '8d4+8', rarity: 'rare', unidentified: RED_POTION }),
  def('it_pocion_suprema', 'poción de curación suprema', 'Potion of supreme healing', ['poción suprema', 'pocion suprema'], 'consumable', magicValue('very_rare', true), 0.5, { subtype: 'potion', size: 'small', heals: '10d4+20', rarity: 'very_rare', unidentified: RED_POTION }),
];

/** Pergamino de conjuro (SRD): rareza, CD y bono de ataque por nivel del conjuro. */
const SCROLL_TABLE: { level: number; rarity: PricedRarity; save_dc: number; attack_bonus: number }[] = [
  { level: 0, rarity: 'common', save_dc: 13, attack_bonus: 5 },
  { level: 1, rarity: 'common', save_dc: 13, attack_bonus: 5 },
  { level: 2, rarity: 'uncommon', save_dc: 13, attack_bonus: 5 },
  { level: 3, rarity: 'uncommon', save_dc: 15, attack_bonus: 7 },
  { level: 4, rarity: 'rare', save_dc: 15, attack_bonus: 7 },
  { level: 5, rarity: 'rare', save_dc: 17, attack_bonus: 9 },
  { level: 6, rarity: 'very_rare', save_dc: 17, attack_bonus: 9 },
  { level: 7, rarity: 'very_rare', save_dc: 18, attack_bonus: 10 },
  { level: 8, rarity: 'very_rare', save_dc: 18, attack_bonus: 10 },
  { level: 9, rarity: 'legendary', save_dc: 19, attack_bonus: 11 },
];

/** Uno por nivel: el conjuro concreto lo dice el ejemplar (`state.spell_id`), no la definición. */
const SCROLLS: SrdItemDef[] = SCROLL_TABLE.map((s) => def(
  `it_pergamino_${s.level}`,
  s.level === 0 ? 'pergamino de truco' : `pergamino de conjuro de nivel ${s.level}`,
  s.level === 0 ? 'Spell scroll (cantrip)' : `Spell scroll (level ${s.level})`,
  ['pergamino', 'pergamino de conjuro', 'spell scroll'],
  'scroll', magicValue(s.rarity, true), 0, {
    size: 'tiny', rarity: s.rarity,
    spell: { level: s.level, save_dc: s.save_dc, attack_bonus: s.attack_bonus },
    unidentified: { name: 'pergamino escrito', description: 'Un pergamino enrollado, con letra apretada y un sello de cera.' },
    description: 'Se lee para lanzar el conjuro escrito (el del ejemplar) sin componentes; se gasta. Si el conjuro es de nivel mayor del que puedes lanzar, prueba de tu característica de lanzamiento (CD 10 + nivel).',
  },
));

const PLUS_RARITY: Record<1 | 2 | 3, Record<'weapon' | 'armor' | 'shield', PricedRarity>> = {
  1: { weapon: 'uncommon', armor: 'rare', shield: 'uncommon' },
  2: { weapon: 'rare', armor: 'very_rare', shield: 'rare' },
  3: { weapon: 'very_rare', armor: 'legendary', shield: 'very_rare' },
};

/**
 * Una variante mágica +N de un objeto del catálogo: el mismo bloque con su bono (el +N lo suma el motor, bloque C;
 * la CA base y el `shield_bonus` no cambian). Id `<base>_<N>`, `base_id` la base; sin identificar se ve como la base.
 */
function plus(base: SrdItemDef, n: 1 | 2 | 3): SrdItemDef {
  const kind = base.type === 'armor' ? (base.subtype === 'shield' ? 'shield' : 'armor') : 'weapon';
  const rarity = PLUS_RARITY[n][kind];
  const value = base.type === 'ammunition' ? magicValue(rarity, true) / 10 : base.value + magicValue(rarity);
  const bonus = kind === 'weapon' ? { attack: n, damage: n } : { ac: n };
  return {
    ...structuredClone(base),
    id: `${base.id}_${n}`,
    base_id: base.id,
    name: `${base.name} +${n}`,
    en: `${base.en} +${n}`,
    aliases: [`${base.en.toLowerCase()} +${n}`, ...base.aliases.slice(1).map((a) => `${a} +${n}`)],
    value, rarity, bonus,
    unidentified: { name: base.name },
  };
}

const byId = (list: SrdItemDef[], id: string) => list.find((d) => d.id === id)!;
const PLUS_N = [1, 2, 3] as const;

const MAGIC_ARMS: SrdItemDef[] = [
  ...['it_daga', 'it_espada_larga', 'it_maza', 'it_arco_largo'].flatMap((id) => PLUS_N.map((n) => plus(byId(WEAPONS, id), n))),
  ...['it_armadura_cuero', 'it_cota_malla', 'it_escudo'].flatMap((id) => PLUS_N.map((n) => plus(byId(ARMORS, id), n))),
  ...['it_flechas', 'it_virotes'].flatMap((id) => PLUS_N.map((n) => plus(byId(AMMUNITION, id), n))),
];

const WONDROUS: SrdItemDef[] = [
  def('it_anillo_proteccion', 'anillo de protección', 'Ring of protection', ['anillo'], 'ring', magicValue('rare'), 0, {
    size: 'tiny', equip_slot: 'ring1', rarity: 'rare', attunement: true, bonus: { ac: 1 }, effects: [{ kind: 'save_bonus', value: 1 }],
    unidentified: { name: 'anillo de plata', description: 'Un aro de plata lisa, sin piedra.' },
    description: '+1 a la CA y a las tiradas de salvación mientras lo llevas sintonizado.',
  }),
  def('it_capa_proteccion', 'capa de protección', 'Cloak of protection', ['capa'], 'wondrous', magicValue('uncommon'), 1, {
    equip_slot: 'neck', rarity: 'uncommon', attunement: true, bonus: { ac: 1 }, effects: [{ kind: 'save_bonus', value: 1 }],
    unidentified: { name: 'capa de lana', description: 'Una capa de lana gruesa, de buena hechura.' },
    description: '+1 a la CA y a las tiradas de salvación mientras la llevas sintonizada.',
  }),
  def('it_bolsa_contencion', 'bolsa de contención', 'Bag of holding', ['bolsa mágica'], 'wondrous', magicValue('uncommon'), 15, {
    size: 'medium', rarity: 'uncommon', container: { slots: 60, max_weight_lb: 500, max_size: 'medium' },
    unidentified: { name: 'bolsa de tela', description: 'Una bolsa de tela de unos dos pies, más pesada de lo que parece.' },
    description: 'Por dentro es mucho más grande: hasta 500 libras y 64 pies cúbicos, y siempre pesa 15. Rota o del revés, lo de dentro se pierde en el plano astral.',
  }),
  def('it_varita_proyectiles', 'varita de proyectiles mágicos', 'Wand of magic missiles', ['varita'], 'wand', magicValue('uncommon'), 1, {
    size: 'small', rarity: 'uncommon', charges: { max: 7, recharge: { amount: '1d6+1', at: 'dawn' }, destroy_on_empty: true },
    spell: { level: 1, spell_id: 'magic_missile' },
    unidentified: { name: 'varita de madera oscura' },
    description: 'Siete cargas: lanza proyectil mágico (1 carga por nivel del conjuro, hasta 3). Recupera 1d6+1 al alba; si se gasta la última, 1d20 y con un 1 se deshace en cenizas.',
  }),
  def('it_botas_elficas', 'botas élficas', 'Boots of elvenkind', ['botas', 'botas elficas'], 'wondrous', magicValue('uncommon'), 1, {
    equip_slot: 'feet', rarity: 'uncommon', effects: [{ kind: 'advantage', on: 'stealth' }, { kind: 'note', text: 'Los pasos no hacen ruido.' }],
    unidentified: { name: 'botas de cuero blando' },
    description: 'Tus pasos no hacen ruido: ventaja en Sigilo para moverte en silencio.',
  }),
  def('it_capa_elfica', 'capa élfica', 'Cloak of elvenkind', ['capa', 'capa elfica'], 'wondrous', magicValue('uncommon'), 1, {
    equip_slot: 'neck', rarity: 'uncommon', attunement: true,
    effects: [{ kind: 'advantage', on: 'stealth' }, { kind: 'note', text: 'Con la capucha puesta, quien te busca con la vista tiene desventaja en Percepción.' }],
    unidentified: { name: 'capa gris con capucha' },
    description: 'Con la capucha puesta, ventaja en Sigilo para esconderte, y quien te busca con la vista tiene desventaja.',
  }),
];

// ---------------------------------------------------------------------------
// El catálogo
// ---------------------------------------------------------------------------

/** Todo el equipo SRD, en fantasía (los nombres del SRD). */
export const SRD_ITEMS: readonly SrdItemDef[] = [
  ...WEAPONS, ...ARMORS, ...AMMUNITION, ...GEAR, ...FOCI, ...TOOLS, ...TACK, ...FOOD, ...TRADE_GOODS,
  ...POTIONS, ...SCROLLS, ...MAGIC_ARMS, ...WONDROUS,
];

export const SRD_ITEM_IDS: ReadonlySet<string> = new Set(SRD_ITEMS.map((d) => d.id));

/** Lo que se compra y se vende en cualquier pueblo: nada mágico ni de mercancía al por mayor. */
export function isMundane(d: Pick<ItemDef, 'rarity'>): boolean {
  return !d.rarity;
}

// ---------------------------------------------------------------------------
// Variantes por género
// ---------------------------------------------------------------------------

export type CatalogGenre = 'fantasy' | 'scifi' | 'postapoc';
type Variant = [string, string[]];

/** Nombre (y alias) del objeto en ciencia ficción y en postapocalíptico. Mismas reglas; sin variante, el del SRD. */
export const GENRE_NAMES: Readonly<Record<string, Partial<Record<Exclude<CatalogGenre, 'fantasy'>, Variant>>>> = {
  // Armas
  it_garrote: { scifi: ['porra extensible', ['porra']], postapoc: ['tubería de plomo', ['tubería', 'tuberia', 'tubo']] },
  it_daga: { scifi: ['cuchillo de combate', ['cuchillo']], postapoc: ['cuchillo de monte', ['cuchillo']] },
  it_gran_garrote: { scifi: ['barra de acero', ['barra']], postapoc: ['barra de hierro', ['barra']] },
  it_hacha_mano: { scifi: ['hachuela táctica', ['hachuela']], postapoc: ['hachuela', ['hacha pequeña']] },
  it_jabalina: { scifi: ['arpón de mano', ['arpón', 'arpon']], postapoc: ['lanza arrojadiza', ['venablo']] },
  it_martillo_ligero: { scifi: ['martillo de impacto', ['martillo']], postapoc: ['martillo', ['martillo de obra']] },
  it_maza: { scifi: ['porra de choque', ['porra eléctrica']], postapoc: ['maza de chatarra', ['maza']] },
  it_baston: { scifi: ['bastón aturdidor', ['bastón', 'baston']], postapoc: ['palo', ['vara', 'bastón']] },
  it_hoz: { scifi: ['cuchilla curva', ['cuchilla']], postapoc: ['hoz oxidada', ['hoz']] },
  it_lanza: { scifi: ['lanza eléctrica', ['lanza']], postapoc: ['lanza de tubo', ['lanza']] },
  it_ballesta_ligera: { scifi: ['pistola de rayos', ['pistola', 'bláster', 'blaster']], postapoc: ['ballesta de chatarra', ['ballesta']] },
  it_dardo: { scifi: ['dardo arrojadizo', ['dardo']], postapoc: ['dardo', ['dardos']] },
  it_arco_corto: { scifi: ['pistola ligera', ['pistola']], postapoc: ['arco de poleas', ['arco']] },
  it_honda: { scifi: ['lanzador de bolas', ['lanzador']], postapoc: ['tirachinas', ['honda']] },
  it_hacha_batalla: { scifi: ['hacha de energía', ['hacha']], postapoc: ['hacha de bombero', ['hacha']] },
  it_mangual: { scifi: ['mangual de cadena', ['mangual']], postapoc: ['cadena con candado', ['cadena']] },
  it_guja: { scifi: ['guja de plasma', ['guja']], postapoc: ['cuchilla en pértiga', ['pértiga']] },
  it_gran_hacha: { scifi: ['hacha pesada de plasma', ['hacha pesada']], postapoc: ['gran hacha de chatarra', ['hacha grande']] },
  it_mandoble: { scifi: ['espada de plasma pesada', ['espada de plasma']], postapoc: ['sierra mecánica', ['motosierra', 'sierra']] },
  it_alabarda: { scifi: ['pica de energía', ['pica']], postapoc: ['pértiga con hoja', ['pértiga']] },
  it_lanza_caballeria: { scifi: ['lanza de carga', ['lanza']], postapoc: ['lanza de moto', ['lanza']] },
  it_espada_larga: { scifi: ['sable de energía', ['sable', 'espada']], postapoc: ['machete largo', ['machete']] },
  it_mazo: { scifi: ['martillo hidráulico', ['martillo']], postapoc: ['mazo de demolición', ['mazo']] },
  it_lucero_alba: { scifi: ['maza de pinchos', ['maza']], postapoc: ['bate con clavos', ['bate']] },
  it_pica: { scifi: ['pica larga', ['pica']], postapoc: ['pica de andamio', ['pica']] },
  it_estoque: { scifi: ['florete monofilamento', ['florete']], postapoc: ['estoque', ['espadín']] },
  it_cimitarra: { scifi: ['sable curvo', ['sable']], postapoc: ['machete', ['machete curvo']] },
  it_espada_corta: { scifi: ['cuchilla vibratoria', ['cuchilla']], postapoc: ['machete corto', ['machete']] },
  it_tridente: { scifi: ['tridente de pesca', ['tridente']], postapoc: ['tridente de pesca', ['tridente']] },
  it_pico_guerra: { scifi: ['piqueta', ['pico']], postapoc: ['pico de minero', ['pico']] },
  it_martillo_guerra: { scifi: ['martillo de guerra', ['martillo']], postapoc: ['mazo de acero', ['mazo']] },
  it_latigo: { scifi: ['látigo eléctrico', ['látigo', 'latigo']], postapoc: ['cable de acero', ['cable', 'látigo']] },
  it_cerbatana: { scifi: ['pistola de dardos', ['pistola']], postapoc: ['cerbatana', ['tubo']] },
  it_ballesta_mano: { scifi: ['pistola de bolsillo', ['pistola']], postapoc: ['ballesta de pistola', ['ballestilla']] },
  it_ballesta_pesada: { scifi: ['rifle de plasma', ['rifle']], postapoc: ['ballesta pesada', ['ballesta']] },
  it_arco_largo: { scifi: ['rifle de precisión', ['rifle']], postapoc: ['arco largo', ['arco']] },
  it_red: { scifi: ['red de captura', ['red']], postapoc: ['red', ['red de pesca']] },
  // Munición
  it_flechas: { scifi: ['cartucho', ['cartuchos', 'munición', 'balas']] },
  it_virotes: { scifi: ['célula de energía', ['células', 'celula', 'batería', 'munición']], postapoc: ['virote', ['virotes', 'saeta']] },
  it_balas_honda: { scifi: ['bola de acero', ['bolas', 'munición']], postapoc: ['tuerca', ['tuercas', 'piedra']] },
  it_agujas_cerbatana: { scifi: ['dardo sedante', ['dardos', 'aguja']], postapoc: ['aguja', ['agujas']] },
  // Armaduras
  it_armadura_acolchada: { scifi: ['traje acolchado', ['acolchado']], postapoc: ['ropa acolchada', ['acolchada']] },
  it_armadura_cuero: { scifi: ['chaqueta blindada', ['chaqueta']], postapoc: ['chupa de cuero', ['cuero', 'chupa']] },
  it_cuero_tachonado: { scifi: ['chaleco de kevlar', ['kevlar', 'chaleco']], postapoc: ['cuero con remaches', ['remaches']] },
  it_armadura_pieles: { scifi: ['mono de trabajo reforzado', ['mono']], postapoc: ['pieles', ['abrigo de pieles']] },
  it_camisote_malla: { scifi: ['malla de fibra', ['malla']], postapoc: ['chaleco de malla metálica', ['chaleco']] },
  it_cota_escamas: { scifi: ['placas ablativas', ['placas']], postapoc: ['armadura de chapas', ['chapas']] },
  it_coraza: { scifi: ['coraza de polímero', ['coraza']], postapoc: ['peto de chapa', ['peto']] },
  it_media_armadura: { scifi: ['armadura táctica', ['armadura']], postapoc: ['placas de chatarra', ['placas']] },
  it_cota_anillas: { scifi: ['peto antidisturbios', ['peto']], postapoc: ['chaleco de cadenas', ['cadenas']] },
  it_cota_malla: { scifi: ['armadura de combate', ['armadura']], postapoc: ['armadura de chatarra', ['chatarra']] },
  it_armadura_bandas: { scifi: ['exoarmadura ligera', ['exoarmadura']], postapoc: ['armadura antidisturbios', ['antidisturbios']] },
  it_armadura_placas: { scifi: ['servoarmadura', ['exoesqueleto']], postapoc: ['armadura pesada de chatarra', ['armadura pesada']] },
  it_escudo: { scifi: ['escudo de energía', ['escudo']], postapoc: ['escudo antidisturbios', ['escudo']] },
  // Equipo
  it_antorcha: { scifi: ['bengala', ['luz química']], postapoc: ['antorcha', ['tea']] },
  it_farol: { scifi: ['linterna', ['foco']], postapoc: ['lámpara de queroseno', ['lámpara', 'queroseno']] },
  it_lampara: { scifi: ['lámpara portátil', ['lámpara']], postapoc: ['candil', ['lámpara']] },
  it_linterna_sorda: { scifi: ['linterna de haz', ['linterna']], postapoc: ['linterna de dinamo', ['linterna']] },
  it_vela: { postapoc: ['cabo de vela', ['vela']] },
  it_yesca: { scifi: ['encendedor', ['mechero']], postapoc: ['mechero', ['encendedor']] },
  it_cuerda: { scifi: ['cable sintético', ['cable', 'cuerda']], postapoc: ['cuerda de nailon', ['cuerda']] },
  it_cuerda_seda: { scifi: ['cable de monofilamento', ['cable']], postapoc: ['cuerda de escalada', ['cuerda']] },
  it_racion: { scifi: ['ración de campaña', ['ración', 'racion']], postapoc: ['lata de conserva', ['lata', 'conserva']] },
  it_odre: { scifi: ['cantimplora', ['botella']], postapoc: ['garrafa de agua', ['garrafa', 'cantimplora']] },
  it_saco_dormir: { scifi: ['saco térmico', ['saco']], postapoc: ['saco de dormir', ['manta']] },
  it_tienda: { scifi: ['refugio hinchable', ['refugio']], postapoc: ['tienda de campaña', ['tienda']] },
  it_ganzuas: { scifi: ['kit de intrusión', ['kit de intrusión electrónica', 'ganzúas']], postapoc: ['ganzúas', ['ganzuas', 'alambres']] },
  it_equipo_sanador: { scifi: ['botiquín médico', ['botiquín', 'medkit']], postapoc: ['botiquín', ['botiquin']] },
  it_catalejo: { scifi: ['prismáticos electrónicos', ['prismáticos']], postapoc: ['prismáticos', ['prismaticos']] },
  it_libro_conjuros: { scifi: ['tableta de fórmulas', ['tableta']], postapoc: ['cuaderno de fórmulas', ['cuaderno']] },
  it_laud: { scifi: ['guitarra eléctrica', ['guitarra']], postapoc: ['guitarra', ['guitarra vieja']] },
  // Magia
  it_pocion: { scifi: ['estimulante médico', ['estimulante', 'inyector']], postapoc: ['jeringa de estimulante', ['jeringa', 'estimulante']] },
  it_pocion_mayor: { scifi: ['estimulante médico mayor', ['estimulante mayor']], postapoc: ['estimulante militar', ['jeringa militar']] },
  it_pocion_superior: { scifi: ['estimulante médico superior', ['estimulante superior']], postapoc: ['suero de antes', ['suero']] },
  it_pocion_suprema: { scifi: ['nanorregenerador', ['nanos']], postapoc: ['suero de laboratorio', ['suero']] },
};

/** El nombre de un objeto del catálogo en un género (el del SRD si no hay variante). Las +N, con el de su base. */
function inGenre(d: SrdItemDef, genre: CatalogGenre): SrdItemDef {
  const base = d.base_id ?? d.id;
  const v = genre === 'fantasy' ? undefined : GENRE_NAMES[base]?.[genre];
  if (!v) return structuredClone(d);
  const [name, aliases] = v;
  const suffix = d.base_id ? d.name.slice(d.name.lastIndexOf(' ')) : '';
  return {
    ...structuredClone(d),
    name: name + suffix,
    aliases: [d.aliases[0]!, ...aliases.map((a) => a + suffix)],
    ...(d.base_id && d.unidentified ? { unidentified: { ...d.unidentified, name } } : {}),
  };
}

const BY_GENRE = new Map<CatalogGenre, readonly SrdItemDef[]>();

/** El catálogo SRD de un género: mismas reglas e ids, nombres del género. */
export function srdCatalog(genre: CatalogGenre = 'fantasy'): readonly SrdItemDef[] {
  let list = BY_GENRE.get(genre);
  if (!list) { list = SRD_ITEMS.map((d) => inGenre(d, genre)); BY_GENRE.set(genre, list); }
  return list;
}

/** Una definición del catálogo en un género (copia), o undefined si el id no es del SRD. */
export function srdItem(id: string, genre: CatalogGenre = 'fantasy'): SrdItemDef | undefined {
  const d = srdCatalog(genre).find((x) => x.id === id);
  return d ? structuredClone(d) : undefined;
}

// ---------------------------------------------------------------------------
// Monturas y vehículos (no son objetos: el comercio de vehículos los usará)
// ---------------------------------------------------------------------------

export interface SrdMount { id: string; name: string; en: string; value: number; speed_ft: number; carrying_lb: number }

export const SRD_MOUNTS: readonly SrdMount[] = [
  { id: 'camel', name: 'camello', en: 'Camel', value: gp(50), speed_ft: 50, carrying_lb: 480 },
  { id: 'donkey', name: 'burro o mula', en: 'Donkey or mule', value: gp(8), speed_ft: 40, carrying_lb: 420 },
  { id: 'elephant', name: 'elefante', en: 'Elephant', value: gp(200), speed_ft: 40, carrying_lb: 1320 },
  { id: 'draft_horse', name: 'caballo de tiro', en: 'Horse, draft', value: gp(50), speed_ft: 40, carrying_lb: 540 },
  { id: 'riding_horse', name: 'caballo de monta', en: 'Horse, riding', value: gp(75), speed_ft: 60, carrying_lb: 480 },
  { id: 'mastiff', name: 'mastín', en: 'Mastiff', value: gp(25), speed_ft: 40, carrying_lb: 195 },
  { id: 'pony', name: 'poni', en: 'Pony', value: gp(30), speed_ft: 40, carrying_lb: 225 },
  { id: 'warhorse', name: 'caballo de guerra', en: 'Warhorse', value: gp(400), speed_ft: 60, carrying_lb: 540 },
];

export interface SrdVehicle { id: string; name: string; en: string; value: number; weight_lb?: number; speed_mph?: number; water: boolean }

export const SRD_VEHICLES: readonly SrdVehicle[] = [
  { id: 'carriage', name: 'carruaje', en: 'Carriage', value: gp(100), weight_lb: 600, water: false },
  { id: 'cart', name: 'carro', en: 'Cart', value: gp(15), weight_lb: 200, water: false },
  { id: 'chariot', name: 'carro de guerra', en: 'Chariot', value: gp(250), weight_lb: 100, water: false },
  { id: 'sled', name: 'trineo', en: 'Sled', value: gp(20), weight_lb: 300, water: false },
  { id: 'wagon', name: 'carreta', en: 'Wagon', value: gp(35), weight_lb: 400, water: false },
  { id: 'galley', name: 'galera', en: 'Galley', value: gp(30000), speed_mph: 4, water: true },
  { id: 'keelboat', name: 'barcaza', en: 'Keelboat', value: gp(3000), speed_mph: 1, water: true },
  { id: 'longship', name: 'drakkar', en: 'Longship', value: gp(10000), speed_mph: 3, water: true },
  { id: 'rowboat', name: 'bote de remos', en: 'Rowboat', value: gp(50), speed_mph: 1.5, water: true },
  { id: 'sailing_ship', name: 'velero', en: 'Sailing ship', value: gp(10000), speed_mph: 2, water: true },
  { id: 'warship', name: 'buque de guerra', en: 'Warship', value: gp(25000), speed_mph: 2.5, water: true },
];
