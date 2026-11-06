/**
 * Modelo de objetos 5e (SPEC §5.1, PLAN-OBJETOS §2): tablas y ayudas puras sobre `ItemDef` e `ItemInstance`.
 * Aquí no hay reglas de juego (bonos en la tirada, sintonizar, gastar cargas): solo qué es cada cosa, cómo se lee
 * y cómo la ve cada personaje. Vale para cualquier campaña: todo sale de los datos del objeto.
 */

import { spellById } from '../data/srd/spells.js';
import type { ArmorSubtype, Id, ItemDef, ItemEffect, ItemInstance, ItemRarity, ItemSubtype, ItemType, RechargeAt, WeaponProperty } from './model.js';
import { ABILITY_ES, SKILLS, type Ability } from './rules.js';

/** Daño en español, para la ficha de los objetos y las respuestas de info.ts. */
export const DAMAGE_ES: Record<string, string> = {
  bludgeoning: 'contundente', piercing: 'perforante', slashing: 'cortante', fire: 'fuego', cold: 'frío', lightning: 'rayo',
  thunder: 'trueno', poison: 'veneno', acid: 'ácido', necrotic: 'necrótico', radiant: 'radiante', force: 'fuerza', psychic: 'psíquico',
};

/** Una habilidad, una característica, 'saves' o 'initiative', en español. */
function onES(on: string): string {
  return SKILLS[on]?.es ?? ABILITY_ES[on as Ability] ?? ({ saves: 'las salvaciones', initiative: 'la iniciativa' } as Record<string, string>)[on] ?? on;
}
const dmgES = (t: string) => DAMAGE_ES[t] ?? t;

/** Qué subtipos valen para cada tipo (tabla de PLAN-OBJETOS §2.1). Un tipo sin subtipos no admite ninguno. */
export const SUBTYPES: Record<ItemType, readonly ItemSubtype[]> = {
  weapon: ['simple_melee', 'simple_ranged', 'martial_melee', 'martial_ranged'],
  armor: ['light', 'medium', 'heavy', 'shield'],
  ammunition: ['arrow', 'bolt', 'bullet', 'needle'],
  gear: ['adventuring', 'clothes', 'light', 'container'],
  tool: ['artisan', 'kit', 'gaming', 'instrument', 'vehicle'],
  focus: ['arcane', 'druidic', 'holy'],
  consumable: ['food', 'drink', 'potion', 'poison', 'oil'],
  treasure: ['gem', 'art', 'trade'],
  scroll: [], wand: [], rod: [], staff: [], ring: [], wondrous: [], coin: [], quest: [], container: [], misc: [],
};

export const ITEM_TYPES = Object.keys(SUBTYPES) as ItemType[];
export const WEAPON_PROPERTIES: readonly WeaponProperty[] = ['light', 'heavy', 'finesse', 'thrown', 'two_handed', 'versatile', 'reach', 'loading', 'ammunition', 'special'];
export const ITEM_RARITIES: readonly ItemRarity[] = ['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact'];
export const RECHARGE_AT: readonly RechargeAt[] = ['dawn', 'dusk', 'short_rest', 'long_rest'];
export const EFFECT_KINDS: readonly ItemEffect['kind'][] = ['resist', 'immune', 'condition_immunity', 'advantage', 'disadvantage', 'speed', 'light', 'darkvision', 'save_bonus', 'ability_score', 'condition', 'note'];

export const RARITY_ES: Record<ItemRarity, string> = {
  common: 'común', uncommon: 'poco común', rare: 'raro', very_rare: 'muy raro', legendary: 'legendario', artifact: 'artefacto',
};

export const WEAPON_PROPERTY_ES: Record<WeaponProperty, string> = {
  light: 'ligera', heavy: 'pesada', finesse: 'sutil: con FUE o DES', thrown: 'arrojadiza', two_handed: 'a dos manos',
  versatile: 'versátil', reach: 'alcance: 10 pies', loading: 'recarga', ammunition: 'usa munición', special: 'especial',
};

const RECHARGE_ES: Record<RechargeAt, string> = { dawn: 'al alba', dusk: 'al anochecer', short_rest: 'tras un descanso corto', long_rest: 'tras un descanso largo' };

/** Nombre genérico de un objeto sin identificar, por su tipo (y subtipo, si lo afina). */
const UNIDENTIFIED_ES: Record<ItemType, string> = {
  weapon: 'arma', armor: 'armadura', ammunition: 'munición', gear: 'objeto', tool: 'herramienta', focus: 'foco',
  consumable: 'frasco', scroll: 'pergamino', wand: 'varita', rod: 'cetro', staff: 'bastón', ring: 'anillo',
  wondrous: 'objeto extraño', treasure: 'objeto de valor', coin: 'moneda', quest: 'objeto', container: 'recipiente', misc: 'objeto',
};
const UNIDENTIFIED_SUB_ES: Partial<Record<ItemSubtype, string>> = { shield: 'escudo', potion: 'poción', arrow: 'flecha', bolt: 'virote', oil: 'frasco de aceite', poison: 'frasco' };

/** Las propiedades de un arma: la lista 5e y las booleanas de siempre, juntas. Vacío si no es un arma. */
export function weaponProperties(def: ItemDef): Set<WeaponProperty> {
  const w = def.weapon;
  const out = new Set<WeaponProperty>(w?.properties ?? []);
  if (w?.finesse) out.add('finesse');
  if (w?.two_handed) out.add('two_handed');
  return out;
}

/** Si el arma es sencilla o marcial (de `subtype`); null si no lo dice (las campañas sin categorías). */
export function weaponCategory(def: ItemDef): 'simple' | 'martial' | null {
  if (!def.weapon || !def.subtype) return null;
  return def.subtype.startsWith('simple_') ? 'simple' : def.subtype.startsWith('martial_') ? 'martial' : null;
}

/**
 * Categoría de una armadura o escudo: la de `subtype`, o deducida de sus datos (escudo; sin tope de DES, ligera;
 * con tope mayor que 0, intermedia; con tope 0, pesada). Null si no es armadura ni escudo.
 */
export function armorCategory(def: ItemDef): ArmorSubtype | null {
  if (def.subtype === 'light' || def.subtype === 'medium' || def.subtype === 'heavy' || def.subtype === 'shield') return def.subtype;
  if (def.shield_bonus && !def.armor) return 'shield';
  if (!def.armor) return null;
  const m = def.armor.dex_max;
  return m === null ? 'light' : m > 0 ? 'medium' : 'heavy';
}

/** De qué definición SRD sale (para competencias con armas concretas): `base_id`, o la propia `id`. */
export function baseIdOf(def: ItemDef): Id {
  return def.base_id ?? def.id;
}

/** Objeto mágico: tiene rareza. */
export function isMagic(def: ItemDef): boolean {
  return def.rarity !== undefined;
}

export function needsAttunement(def: ItemDef): boolean {
  return def.attunement !== undefined && def.attunement !== false;
}

/** Si ese personaje sabe qué es: los objetos corrientes, siempre; los mágicos, si está en `identified_by`. */
export function isIdentifiedBy(def: ItemDef, inst: ItemInstance, viewerId: Id | null): boolean {
  if (!isMagic(def)) return true;
  return viewerId !== null && (inst.state.identified_by ?? []).includes(viewerId);
}

/** Cargas que le quedan (llenas si el ejemplar no lo dice); null si no tiene cargas. */
export function chargesLeft(def: ItemDef, inst: ItemInstance): number | null {
  if (!def.charges) return null;
  const n = inst.state.charges;
  return typeof n === 'number' ? Math.max(0, Math.min(def.charges.max, n)) : def.charges.max;
}

/** El nombre que ve ese personaje: el de verdad o, sin identificar, el de `unidentified` o uno genérico. */
export function itemName(def: ItemDef, inst: ItemInstance, viewerId: Id | null): string {
  if (isIdentifiedBy(def, inst, viewerId)) return def.name;
  return def.unidentified?.name ?? (def.subtype && UNIDENTIFIED_SUB_ES[def.subtype]) ?? UNIDENTIFIED_ES[def.type] ?? 'objeto';
}

/** La condición de sintonía, en una frase. */
export function attunementText(def: ItemDef): string | null {
  const a = def.attunement;
  if (a === undefined || a === false) return null;
  if (a === true) return 'pide sintonía';
  const who = [...(a.classes?.length ? [a.classes.join(', ')] : []), ...(a.spellcaster ? ['un lanzador de conjuros'] : [])];
  return `pide sintonía${who.length ? ` (${who.join(' o ')})` : ''}${a.note ? `: ${a.note}` : ''}`;
}

/** Un efecto, en una frase corta. */
export function effectText(e: ItemEffect): string {
  switch (e.kind) {
    case 'resist': return `resistencia al daño ${dmgES(e.damage_type)}`;
    case 'immune': return `inmunidad al daño ${dmgES(e.damage_type)}`;
    case 'condition_immunity': return `no puede quedar ${e.condition}`;
    case 'advantage': return `ventaja en ${onES(e.on)}`;
    case 'disadvantage': return `desventaja en ${onES(e.on)}`;
    case 'speed': return `${e.ft >= 0 ? '+' : ''}${e.ft} pies de velocidad`;
    case 'light': return `da luz a ${e.radius_ft} pies`;
    case 'darkvision': return `visión en la oscuridad a ${e.ft} pies`;
    case 'save_bonus': return `${e.value >= 0 ? '+' : ''}${e.value} a las salvaciones`;
    case 'ability_score': return `${ABILITY_ES[e.ability]} ${e.value}`;
    case 'condition': return `queda ${e.condition}`;
    case 'note': return e.text;
  }
}

/** Los bonos mágicos, en texto: «+1 al ataque», «+2 a la CA». */
export function bonusText(def: ItemDef): string[] {
  const b = def.bonus;
  if (!b) return [];
  const s = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
  return [
    ...(b.attack ? [`${s(b.attack)} al ataque`] : []), ...(b.damage ? [`${s(b.damage)} al daño`] : []), ...(b.ac ? [`${s(b.ac)} a la CA`] : []),
    ...(b.save_dc ? [`${s(b.save_dc)} a la CD de tus conjuros`] : []), ...(b.spell_attack ? [`${s(b.spell_attack)} al ataque de conjuro`] : []),
  ];
}

/** El conjuro de un pergamino o varita: «proyectil mágico (nivel 1)». */
export function spellText(def: ItemDef): string | null {
  if (!def.spell) return null;
  const sp = spellById(def.spell.spell_id);
  return `${sp?.name ?? def.spell.spell_id} (${def.spell.level === 0 ? 'truco' : `nivel ${def.spell.level}`})`;
}

export function chargesText(def: ItemDef, inst: ItemInstance): string | null {
  const left = chargesLeft(def, inst);
  if (left === null || !def.charges) return null;
  const r = def.charges.recharge;
  return `${left}/${def.charges.max} cargas${r ? `, recupera ${r.amount} ${RECHARGE_ES[r.at]}` : ''}`;
}

/**
 * Lo mágico de un ejemplar tal como lo ve un personaje (lo que devuelve `get_item` en `magic`). Null si no es mágico.
 * Sin identificar, solo eso. La maldición no se ve hasta que alguien lo sintoniza (SRD: identificar no la descubre).
 */
export function magicView(def: ItemDef, inst: ItemInstance, viewerId: Id | null, nameOf: (id: Id) => string = (id) => id): string | Record<string, unknown> | null {
  if (!isMagic(def)) return null;
  if (!isIdentifiedBy(def, inst, viewerId)) return 'objeto mágico sin identificar';
  const attuned = inst.state.attuned_to ?? null;
  return {
    rarity: RARITY_ES[def.rarity!],
    ...(needsAttunement(def) ? { attunement: attunementText(def), attuned_to: attuned ? nameOf(attuned) : null, attuned_to_you: attuned !== null && attuned === viewerId } : {}),
    ...(def.bonus ? { bonus: bonusText(def) } : {}),
    ...(def.charges ? { charges: chargesText(def, inst) } : {}),
    ...(def.effects?.length ? { effects: def.effects.map(effectText) } : {}),
    ...(def.spell ? { spell: spellText(def) } : {}),
    ...(def.cursed && attuned ? { cursed: def.cursed.description ?? (def.cursed.effects?.map(effectText).join('; ') || 'maldito') } : {}),
  };
}

/**
 * Lo que `migrate` hace con cada definición guardada (idempotente): la lista de propiedades del arma desde las
 * booleanas de siempre y la categoría de la armadura desde sus datos. Nunca cambia `type`. Devuelve si cambió algo.
 */
export function normalizeItemDef(def: ItemDef): boolean {
  let changed = false;
  if (def.weapon) {
    const props = weaponProperties(def);
    if (def.weapon.ammo_type && def.weapon.ranged) props.add('ammunition');
    const list = WEAPON_PROPERTIES.filter((p) => props.has(p));
    const cur = def.weapon.properties ?? [];
    if (list.length && (list.length !== cur.length || list.some((p, i) => cur[i] !== p))) { def.weapon.properties = list; changed = true; }
  }
  if ((def.type === 'armor' || def.armor || def.shield_bonus) && !def.subtype) {
    const cat = armorCategory(def);
    if (cat && def.type === 'armor') { def.subtype = cat; changed = true; }
  }
  return changed;
}

/** Campos de la definición que la semilla rellena en una partida guardada si faltan (migrate). */
const FILLABLE: readonly (keyof ItemDef)[] = ['subtype', 'base_id', 'rarity', 'attunement', 'bonus', 'charges', 'effects', 'cursed', 'unidentified', 'spell', 'effect', 'duration_s'];
const LEGACY_TYPES: readonly ItemType[] = ['misc', 'container', 'consumable', 'tool'];

/**
 * Rellena en una definición guardada lo que la semilla de la campaña ya trae y la partida no (solo huecos: nunca
 * pisa un valor). El tipo, solo si la partida tiene uno de los viejos genéricos y la semilla uno más fino.
 */
export function fillItemDefFrom(cur: ItemDef, seed: ItemDef): boolean {
  let changed = false;
  if (seed.type !== cur.type && LEGACY_TYPES.includes(cur.type) && !LEGACY_TYPES.includes(seed.type)) { cur.type = seed.type; changed = true; }
  for (const k of FILLABLE) {
    if (cur[k] === undefined && seed[k] !== undefined) { (cur as unknown as Record<string, unknown>)[k] = structuredClone(seed[k]); changed = true; }
  }
  if (cur.weapon && seed.weapon) {
    for (const k of ['properties', 'range', 'versatile_damage', 'ammo_type'] as const) {
      if (cur.weapon[k] === undefined && seed.weapon[k] !== undefined) { (cur.weapon as Record<string, unknown>)[k] = structuredClone(seed.weapon[k]); changed = true; }
    }
  }
  if (cur.armor && seed.armor) {
    for (const k of ['str_min', 'don_s', 'doff_s'] as const) {
      if (cur.armor[k] === undefined && seed.armor[k] !== undefined) { cur.armor[k] = seed.armor[k]; changed = true; }
    }
  }
  return changed;
}

/** Errores de modelo de una definición (validate.ts los junta con los del mundo). */
export function itemDefErrors(d: ItemDef, spellExists: (id: string) => boolean): string[] {
  const errs: string[] = [];
  if (!(d.type in SUBTYPES)) errs.push(`${d.id}: tipo «${d.type}» desconocido.`);
  else if (d.subtype !== undefined && !SUBTYPES[d.type].includes(d.subtype)) errs.push(`${d.id}: el subtipo «${d.subtype}» no vale para ${d.type}.`);
  if (d.weapon) {
    for (const p of d.weapon.properties ?? []) if (!WEAPON_PROPERTIES.includes(p)) errs.push(`${d.id}: propiedad de arma «${p}» desconocida.`);
    const props = weaponProperties(d);
    if (d.weapon.properties && d.weapon.finesse && !d.weapon.properties.includes('finesse')) errs.push(`${d.id}: es sutil pero su lista de propiedades no lo dice.`);
    if (d.weapon.properties && d.weapon.two_handed && !d.weapon.properties.includes('two_handed')) errs.push(`${d.id}: es a dos manos pero su lista de propiedades no lo dice.`);
    if (props.has('versatile') !== (d.weapon.versatile_damage !== undefined)) errs.push(`${d.id}: un arma versátil lleva su daño a dos manos (versatile_damage), y solo ella.`);
    const r = d.weapon.range;
    if (r && !(r.length === 2 && r[0] > 0 && r[1] >= r[0])) errs.push(`${d.id}: el alcance va como [normal, largo] en pies, con largo ≥ normal.`);
    if ((props.has('thrown') || props.has('ammunition')) && !r) errs.push(`${d.id}: un arma arrojadiza o de munición necesita su alcance (range).`);
    if (props.has('ammunition') && !d.weapon.ammo_type) errs.push(`${d.id}: usa munición pero no dice cuál (ammo_type).`);
  } else if (d.subtype && SUBTYPES.weapon.includes(d.subtype)) errs.push(`${d.id}: tiene subtipo de arma pero no su bloque weapon.`);
  if (d.type === 'armor' && d.subtype && d.subtype !== 'shield' && !d.armor) errs.push(`${d.id}: armadura sin su bloque armor.`);
  if (d.subtype === 'shield' && !d.shield_bonus) errs.push(`${d.id}: escudo sin shield_bonus.`);
  if (d.armor?.str_min !== undefined && !(Number.isInteger(d.armor.str_min) && d.armor.str_min > 0 && d.armor.str_min <= 30)) errs.push(`${d.id}: str_min debe ser una puntuación de Fuerza.`);
  if (d.rarity !== undefined && !ITEM_RARITIES.includes(d.rarity)) errs.push(`${d.id}: rareza «${d.rarity}» desconocida.`);
  const magicOnly = (['attunement', 'bonus', 'charges', 'cursed', 'unidentified'] as const).filter((k) => d[k] !== undefined && d[k] !== false);
  if (magicOnly.length && d.rarity === undefined) errs.push(`${d.id}: ${magicOnly.join(', ')} son de objetos mágicos y no tiene rareza.`);
  if (d.charges) {
    if (!(Number.isInteger(d.charges.max) && d.charges.max > 0)) errs.push(`${d.id}: el máximo de cargas debe ser un entero positivo.`);
    if (d.charges.recharge && !RECHARGE_AT.includes(d.charges.recharge.at)) errs.push(`${d.id}: recarga «${d.charges.recharge.at}» desconocida.`);
    if (d.charges.recharge && !/^(\d+|\d*d\d+([+-]\d+)?)$/.test(d.charges.recharge.amount)) errs.push(`${d.id}: la recarga va en dados o número («1d6+1»).`);
  }
  for (const e of [...(d.effects ?? []), ...(d.cursed?.effects ?? []), ...(d.effect ? [d.effect] : [])]) {
    if (!EFFECT_KINDS.includes(e.kind)) errs.push(`${d.id}: efecto «${(e as { kind: string }).kind}» desconocido.`);
  }
  if (d.duration_s !== undefined && !d.effect) errs.push(`${d.id}: duration_s sin effect.`);
  if (d.spell) {
    if (!spellExists(d.spell.spell_id)) errs.push(`${d.id}: el conjuro ${d.spell.spell_id} no está en el catálogo.`);
    if (!(Number.isInteger(d.spell.level) && d.spell.level >= 0 && d.spell.level <= 9)) errs.push(`${d.id}: el nivel del conjuro va de 0 a 9.`);
  }
  if (d.type === 'ammunition' && !d.subtype) errs.push(`${d.id}: munición sin subtipo (arrow, bolt…).`);
  return errs;
}
