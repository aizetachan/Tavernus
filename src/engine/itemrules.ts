/**
 * Reglas de los objetos en el motor (PLAN-OBJETOS §4, SRD 5.1): competencia con
 * armas y armaduras, propiedades de arma, munición, fuerza mínima, bonos
 * mágicos, sintonización, identificar, pergaminos, cargas y efectos.
 *
 * Todo sale de los datos del objeto (ItemDef, el modelo de items.ts) y de la
 * clase y la raza del PJ (src/data/srd/index.ts). Un objeto sin esos datos
 * sigue como antes: un arma sin categoría se usa con competencia, una armadura
 * sin fuerza mínima no frena. Así una campaña con objetos sencillos no cambia.
 *
 * El máster no aplica efectos: los aplica este módulo y él los narra.
 */

import { classById, raceById, SCROLL_TABLE } from '../data/srd/index.js';
import { spellById, type SpellDef } from '../data/srd/spells.js';
import { GAME_DAY, GAME_HOUR } from '../clock/clock.js';
import { abilityModifier, rollD20, rollDie, rollExpr, type Advantage, type CheckResult, type Rng } from './dice.js';
import type { Character, Id, ItemDef, ItemEffect, ItemInstance } from './model.js';
import { spawnItem } from './inventory.js';
import { armorCategory, baseIdOf, chargesLeft, effectText, isIdentifiedBy, itemName, needsAttunement, weaponCategory, weaponProperties } from './items.js';
import { casterOf, effectsOf, maxSpellLevel, rollSpellDice, spellsOf } from './levels.js';
import { SKILLS, type Ability, type CheckKind } from './rules.js';
import type { World } from './world.js';

// ---------------------------------------------------------------------------
// Ventaja y desventaja
// ---------------------------------------------------------------------------

/** Ventaja y desventaja se anulan (SRD): con una de cada, ninguna. */
export function combineAdvantage(...xs: Advantage[]): Advantage {
  const adv = xs.includes('advantage'), dis = xs.includes('disadvantage');
  return adv && dis ? 'none' : adv ? 'advantage' : dis ? 'disadvantage' : 'none';
}

// ---------------------------------------------------------------------------
// Competencia
// ---------------------------------------------------------------------------

export const isShield = (d: ItemDef): boolean => armorCategory(d) === 'shield';

/** Competencias de un PJ por su clase y su raza: categorías y armas concretas (ids del catálogo). */
export function proficienciesOf(c: Character): { weapons: Set<string>; armor: Set<string> } {
  const cls = classById(c.class_id), race = raceById(c.race_id);
  return {
    weapons: new Set([...(cls?.weapons ?? []), ...(race?.weapons ?? [])]),
    armor: new Set([...(cls?.armor ?? []), ...(race?.armor ?? [])]),
  };
}

/** ¿Sabe usar esta arma? Por categoría o por el arma concreta (la SRD de la que sale). Sin categoría, sí. */
export function weaponProficient(c: Character, d: ItemDef): boolean {
  const cat = weaponCategory(d);
  if (!cat) return true;
  const p = proficienciesOf(c).weapons;
  return p.has(cat) || p.has(baseIdOf(d)) || p.has(d.id);
}

export function armorProficient(c: Character, d: ItemDef): boolean {
  const cat = armorCategory(d);
  return !cat || proficienciesOf(c).armor.has(cat);
}

/** Armadura puesta y escudos en la mano. */
function wornArmor(world: World, c: Character): ItemDef[] {
  const out: ItemDef[] = [];
  const body = world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'equipped', slot: 'body' } })[0];
  if (body && world.itemDef(body.item_id).armor) out.push(world.itemDef(body.item_id));
  for (const which of ['main', 'off', 'both'] as const) {
    for (const i of world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'hand', which } })) if (isShield(world.itemDef(i.item_id))) out.push(world.itemDef(i.item_id));
  }
  return out;
}

/** Lo que lleva puesto o embrazado sin saber llevarlo. */
export function unproficientArmor(world: World, c: Character): ItemDef[] {
  return wornArmor(world, c).filter((d) => !armorProficient(c, d));
}

/** Con armadura o escudo sin competencia no se lanzan conjuros (SRD). El motivo, o null. */
export function armorBlocksSpells(world: World, c: Character): string | null {
  const bad = unproficientArmor(world, c);
  return bad.length ? `${c.name} lleva ${bad.map((d) => d.name).join(' y ')} sin saber llevar${bad.length > 1 ? 'los' : 'lo'}: así no puede lanzar conjuros. Que se lo quite primero.` : null;
}

/**
 * Lo que el equipo pone a una tirada del PJ: desventaja en FUE y DES con
 * armadura sin competencia, en Sigilo con la armadura que la impone, y la
 * ventaja o desventaja de los efectos de lo que lleva (botas élficas).
 */
export function gearAdvantage(world: World, c: Character, kind: CheckKind, key: string): Advantage {
  const ability: Ability | null = kind === 'skill' ? SKILLS[key]?.ability ?? null
    : kind === 'attack' ? (key === 'ranged' || key === 'finesse' ? 'dex' : 'str')
    : (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).includes(key as Ability) ? key as Ability : null;
  const out: Advantage[] = [];
  if ((ability === 'str' || ability === 'dex') && unproficientArmor(world, c).length) out.push('disadvantage');
  if (kind === 'skill' && key === 'stealth' && wornArmor(world, c).some((d) => d.armor?.stealth_disadvantage)) out.push('disadvantage');
  const on = (target: string) => target === key || (kind === 'save' && target === 'saves') || (kind !== 'attack' && target === ability);
  for (const e of activeEffects(world, c)) {
    if (e.kind === 'advantage' && on(e.on)) out.push('advantage');
    if (e.kind === 'disadvantage' && on(e.on)) out.push('disadvantage');
  }
  return combineAdvantage(...out);
}

/** Lo que suman a las salvaciones los objetos activos (anillo y capa de protección). */
export function itemSaveBonus(world: World, c: Character): number {
  return activeEffects(world, c).reduce((a, e) => a + (e.kind === 'save_bonus' ? e.value : 0), 0);
}

// ---------------------------------------------------------------------------
// Velocidad: fuerza mínima y efectos
// ---------------------------------------------------------------------------

/**
 * Pies de velocidad que pierde (o gana, en negativo) por lo que lleva: −10 con
 * una armadura sin la fuerza que pide (SRD), y los efectos de velocidad.
 */
export function armorSpeedPenalty(world: World, c: Character): number {
  const body = world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'equipped', slot: 'body' } })[0];
  const min = body ? world.itemDef(body.item_id).armor?.str_min : undefined;
  const effects = activeEffects(world, c).reduce((a, e) => a + (e.kind === 'speed' ? e.ft : 0), 0);
  return (min && c.abilities.str < min ? 10 : 0) - effects;
}

// ---------------------------------------------------------------------------
// Objetos activos: sintonía, identificar y efectos puestos
// ---------------------------------------------------------------------------

/** ¿Le da algo ahora a este PJ? Lo que pide sintonía, solo si está sintonizado con él. */
export function itemActiveFor(inst: ItemInstance, d: ItemDef, c: Character): boolean {
  return !needsAttunement(d) || inst.state.attuned_to === c.id;
}

/** Lo que lleva puesto o en la mano y le da algo ahora (un anillo en la mochila no protege). */
export function activeItems(world: World, c: Character): { inst: ItemInstance; def: ItemDef }[] {
  const out: { inst: ItemInstance; def: ItemDef }[] = [];
  for (const inst of world.itemInstances.values()) {
    if (inst.location.type !== 'character' || inst.location.id !== c.id || inst.location.slot.kind === 'pocket') continue;
    const def = world.itemDef(inst.item_id);
    if (itemActiveFor(inst, def, c)) out.push({ inst, def });
  }
  return out;
}

/** Los efectos de lo que lleva activo, con la maldición de lo sintonizado. */
export function activeEffects(world: World, c: Character): ItemEffect[] {
  return activeItems(world, c).flatMap(({ inst, def }) => [...(def.effects ?? []), ...(def.cursed && inst.state.attuned_to === c.id ? def.cursed.effects ?? [] : [])]);
}

/**
 * Lo que queda del daño de un tipo con lo que lleva y lo que se ha tomado:
 * 0 si es inmune, la mitad si resiste (SRD, hacia abajo).
 */
export function damageAfterResistance(world: World, c: Character, amount: number, damageType: string): number {
  const t = damageType.toLowerCase();
  const fx = activeEffects(world, c);
  const named = (e: ItemEffect) => c.conditions.some((x) => x.name === effectText(e));
  if (fx.some((e) => e.kind === 'immune' && e.damage_type === t) || named({ kind: 'immune', damage_type: t })) return 0;
  if (fx.some((e) => e.kind === 'resist' && e.damage_type === t) || named({ kind: 'resist', damage_type: t })) return Math.floor(amount / 2);
  return amount;
}

export const MAX_ATTUNED = 3;

/** Los objetos con los que está sintonizado (estén donde estén). */
export function attunedItems(world: World, c: Character): ItemInstance[] {
  return [...world.itemInstances.values()].filter((i) => i.state.attuned_to === c.id);
}

/** ¿Puede sintonizarse con él? El motivo si no. */
export function canAttune(world: World, c: Character, inst: ItemInstance): string | null {
  const d = world.itemDef(inst.item_id);
  if (!needsAttunement(d)) return `${d.name} no pide sintonía: funciona sin más.`;
  if (inst.state.attuned_to === c.id) return `${c.name} ya está sintonizado con ${d.name}.`;
  if (inst.state.attuned_to) return `${d.name} está sintonizado con otra persona: hasta que lo deje, no.`;
  if (typeof d.attunement === 'object') {
    if (d.attunement.classes?.length && !d.attunement.classes.includes(c.class_id)) return `${d.name} solo se sintoniza con ${d.attunement.note ?? d.attunement.classes.join(', ')}.`;
    if (d.attunement.spellcaster && !casterOf(c)) return `${d.name} pide un lanzador de conjuros.`;
  }
  if (attunedItems(world, c).length >= MAX_ATTUNED) return `${c.name} ya está sintonizado con ${MAX_ATTUNED} objetos, el máximo: tendría que dejar uno.`;
  return null;
}

/** Sintoniza (tras un descanso corto con el objeto en las manos). Sintonizarse también lo identifica. */
export function attune(world: World, c: Character, inst: ItemInstance): { ok: true } | { ok: false; error: string } {
  const why = canAttune(world, c, inst);
  if (why) return { ok: false, error: why };
  inst.state.attuned_to = c.id;
  identify(world, c, inst);
  world.touch('item_instances', inst.id);
  return { ok: true };
}

/** Deja la sintonía. Un objeto maldito no se suelta. */
export function endAttunement(world: World, c: Character, inst: ItemInstance): { ok: true } | { ok: false; error: string } {
  const d = world.itemDef(inst.item_id);
  if (inst.state.attuned_to !== c.id) return { ok: false, error: `${c.name} no está sintonizado con ${d.name}.` };
  if (d.cursed) return { ok: false, error: `${d.name} está maldito: no se deja de sintonizar así (hace falta quitar la maldición).` };
  inst.state.attuned_to = null;
  world.touch('item_instances', inst.id);
  return { ok: true };
}

/** Le dice al PJ qué es. Devuelve si no lo sabía. */
export function identify(world: World, c: Character, inst: ItemInstance): boolean {
  const by = inst.state.identified_by ?? [];
  if (by.includes(c.id)) return false;
  inst.state.identified_by = [...by, c.id];
  world.touch('item_instances', inst.id);
  return true;
}

// ---------------------------------------------------------------------------
// El arma con la que ataca
// ---------------------------------------------------------------------------

/** Arma a distancia de verdad (arco, ballesta, honda): no la arrojadiza, que también es cuerpo a cuerpo. */
const isRangedWeapon = (d: ItemDef) => Boolean(d.weapon?.ranged) || weaponProperties(d).has('ammunition');

export interface AttackProfile {
  name: string;
  instance_id: Id | null;
  damage: string;
  damage_type: string;
  ability: 'str' | 'dex';
  ability_mod: number;
  proficient: boolean;
  /** Bono mágico del arma (y de la munición) al ataque y al daño. */
  magic_attack: number;
  magic_damage: number;
  /** Lo que suma al d20 sin la competencia: característica, estilo y magia. */
  attack_bonus: number;
  /** Lo que suma al daño: la característica (con la otra mano, solo si resta) y la magia. */
  damage_mod: number;
  ranged: boolean;
  thrown: boolean;
  reach: boolean;
  /** Alcance normal y largo en pies (arrojadizas y a distancia). */
  range: [number, number] | null;
  needs_ammo: boolean;
  ammo: ItemInstance | null;
  /** La ventaja o desventaja que pone el equipo (pesada para un pequeño, armadura sin competencia…). */
  advantage: Advantage;
  notes: string[];
  off_hand: boolean;
}

function handWeapon(world: World, c: Character, which: 'main' | 'off' | 'both'): ItemInstance | null {
  for (const i of world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'hand', which } })) if (world.itemDef(i.item_id).weapon) return i;
  return null;
}

/** La munición que le sirve a esta arma (la de su `ammo_type`), si la lleva encima. */
export function ammoFor(world: World, c: Character, d: ItemDef): ItemInstance | null {
  const want = d.weapon?.ammo_type ?? null;
  return world.itemsCarriedBy(c.id).find((i) => {
    const a = world.itemDef(i.item_id);
    return a.type === 'ammunition' && (!want || a.subtype === want) && i.quantity > 0;
  }) ?? null;
}

/** Tamaño de la raza (SRD): mediano y gnomo son pequeños. */
export function isSmall(c: Character): boolean {
  return raceById(c.race_id)?.size === 'small';
}

/**
 * Con qué ataca el PJ y qué suma. `hand: 'off'`: con la otra mano (dos armas
 * ligeras, SRD). `mode`: cuerpo a cuerpo o a distancia, que decide si un arma
 * arrojadiza se lanza. Sin arma, puños.
 */
export function attackProfile(world: World, c: Character, opts: { hand?: 'main' | 'off'; mode?: 'melee' | 'ranged' } = {}): AttackProfile | { error: string } {
  const offHand = opts.hand === 'off';
  let inst: ItemInstance | null;
  if (offHand) {
    inst = handWeapon(world, c, 'off');
    const main = handWeapon(world, c, 'main');
    if (!inst) return { error: `${c.name} no lleva arma en la otra mano.` };
    if (!main || !weaponProperties(world.itemDef(main.item_id)).has('light') || !weaponProperties(world.itemDef(inst.item_id)).has('light')) return { error: 'Para atacar con la otra mano hacen falta dos armas ligeras, una en cada mano (SRD).' };
  } else inst = handWeapon(world, c, 'main') ?? handWeapon(world, c, 'both') ?? handWeapon(world, c, 'off');
  const d = inst ? world.itemDef(inst.item_id) : null;
  const props = d ? weaponProperties(d) : new Set<string>();
  const str = abilityModifier(c.abilities.str), dex = abilityModifier(c.abilities.dex);
  const ranged = d ? isRangedWeapon(d) : false;
  const thrown = props.has('thrown') && opts.mode === 'ranged' && !ranged;
  const ability: 'str' | 'dex' = ranged ? 'dex' : props.has('finesse') && dex > str ? 'dex' : 'str';
  const mod = ability === 'dex' ? dex : str;
  const notes: string[] = [];
  const adv: Advantage[] = [];
  const proficient = d ? weaponProficient(c, d) : true;
  if (!proficient) notes.push(`sin competencia con ${d!.name}: no suma su bono de competencia`);
  if (props.has('heavy') && isSmall(c)) { adv.push('disadvantage'); notes.push('arma pesada en manos de alguien pequeño: desventaja'); }
  if (unproficientArmor(world, c).length) { adv.push('disadvantage'); notes.push('armadura sin competencia: desventaja'); }
  const active = d && inst ? itemActiveFor(inst, d, c) : false;
  let magicAtk = active ? d!.bonus?.attack ?? 0 : 0, magicDmg = active ? d!.bonus?.damage ?? 0 : 0;
  // Versátil: a dos manos (o con la otra mano libre), el dado mayor.
  let damage = d?.weapon?.damage ?? '1';
  if (d?.weapon?.versatile_damage && !offHand && !thrown) {
    const both = inst!.location.type === 'character' && inst!.location.slot.kind === 'hand' && inst!.location.slot.which === 'both';
    const offFree = !world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } }).length;
    if (both || offFree) { damage = d.weapon.versatile_damage; notes.push('versátil, a dos manos'); }
  }
  const needsAmmo = props.has('ammunition');
  const ammo = needsAmmo ? ammoFor(world, c, d!) : null;
  if (ammo) { const a = world.itemDef(ammo.item_id); magicAtk += a.bonus?.attack ?? 0; magicDmg += a.bonus?.damage ?? 0; }
  // Con la otra mano no se suma la característica al daño, salvo que reste o con el estilo de dos armas.
  const dmgAbility = offHand && mod > 0 && !effectsOf(c).some((e) => e.two_weapon) ? 0 : mod;
  const style = ranged ? effectsOf(c).reduce((a, e) => a + (e.ranged_attack ?? 0), 0) : 0;
  return {
    name: d?.name ?? 'puños', instance_id: inst?.id ?? null, damage, damage_type: d?.weapon?.damage_type ?? 'bludgeoning',
    ability, ability_mod: mod, proficient, magic_attack: magicAtk, magic_damage: magicDmg,
    attack_bonus: mod + style + magicAtk, damage_mod: dmgAbility + magicDmg,
    ranged, thrown, reach: props.has('reach'), range: d?.weapon?.range ?? null,
    needs_ammo: needsAmmo, ammo, advantage: combineAdvantage(...adv), notes, off_hand: offHand,
  };
}

const M_PER_FT = 0.3048;

/**
 * ¿Llega a un objetivo a `distM` metros, en otro punto (`samePoint` false) o en
 * el mismo? Decide cuerpo a cuerpo o a distancia, y la desventaja por alcance
 * largo o por disparar con el objetivo encima.
 */
export function reachCheck(p: AttackProfile, samePoint: boolean, distM: number): { ok: true; mode: 'melee' | 'ranged'; advantage: Advantage; note: string | null } | { ok: false; reason: string } {
  if (samePoint) {
    // A quemarropa con un arco o una ballesta: desventaja (SRD, enemigo a 1,5 m).
    if (p.ranged) return { ok: true, mode: 'ranged', advantage: 'disadvantage', note: `disparar con ${p.name} con el objetivo encima: desventaja` };
    return { ok: true, mode: 'melee', advantage: 'none', note: null };
  }
  const ft = distM / M_PER_FT;
  if (p.reach && ft <= 10) return { ok: true, mode: 'melee', advantage: 'none', note: `${p.name} tiene alcance: llega a 3 m` };
  if (!p.ranged && !p.thrown) return { ok: false, reason: `fuera del alcance de ${p.name}, que es de cuerpo a cuerpo` };
  const [normal, long] = p.range ?? [Infinity, Infinity];
  if (ft > long) return { ok: false, reason: `fuera del alcance de ${p.name} (${Math.round(long * M_PER_FT)} m como mucho)` };
  if (ft > normal) return { ok: true, mode: 'ranged', advantage: 'disadvantage', note: `más allá del alcance normal de ${p.name}: desventaja` };
  return { ok: true, mode: 'ranged', advantage: 'none', note: null };
}

// ---------------------------------------------------------------------------
// Munición y armas arrojadizas
// ---------------------------------------------------------------------------

/**
 * Gasta la munición de un disparo. La mitad se recupera (SRD): uno de cada dos
 * disparos deja la flecha en el suelo del punto del objetivo, como un objeto
 * de verdad que hay que ir a recoger.
 */
export function spendAmmo(world: World, ammo: ItemInstance, targetSpotId: Id | null): { left: number; recoverable: boolean } {
  const fired = (typeof ammo.state['fired'] === 'number' ? ammo.state['fired'] : 0) + 1;
  const itemId = ammo.item_id;
  ammo.quantity -= 1;
  if (ammo.quantity <= 0) world.remove('item_instances', ammo.id);
  else { ammo.state['fired'] = fired; world.touch('item_instances', ammo.id); }
  const recoverable = fired % 2 === 0 && targetSpotId !== null;
  if (recoverable) spawnItem(world, itemId, 1, { type: 'spot', id: targetSpotId! });
  return { left: Math.max(0, ammo.quantity), recoverable };
}

/** El arma arrojada cae donde está el objetivo: hay que ir a por ella. */
export function throwWeapon(world: World, inst: ItemInstance, targetSpotId: Id): void {
  inst.location = { type: 'spot', id: targetSpotId };
  world.touch('item_instances', inst.id);
}

// ---------------------------------------------------------------------------
// Bonos mágicos: CA y conjuros
// ---------------------------------------------------------------------------

/**
 * Lo que suman a la CA los objetos activos: el bono de la armadura puesta, el
 * del escudo embrazado y el de lo que lleva puesto (anillo, capa de protección).
 */
export function itemAcBonus(world: World, c: Character): number {
  return activeItems(world, c).reduce((a, { inst, def }) => {
    if (!def.bonus?.ac || inst.location.type !== 'character') return a;
    const slot = inst.location.slot;
    if (slot.kind === 'hand' && !isShield(def)) return a;
    if (slot.kind === 'equipped' && slot.slot === 'body' && !def.armor) return a;
    if (slot.kind === 'equipped' && slot.slot !== 'body' && def.armor) return a;
    return a + def.bonus.ac;
  }, 0);
}

/** Lo que suman a la CD y al ataque de sus conjuros los focos y varitas activos. */
export function spellItemBonus(world: World, c: Character): { save_dc: number; attack: number } {
  return activeItems(world, c).reduce((a, { def }) => ({ save_dc: a.save_dc + (def.bonus?.save_dc ?? 0), attack: a.attack + (def.bonus?.spell_attack ?? 0) }), { save_dc: 0, attack: 0 });
}

// ---------------------------------------------------------------------------
// Cargas
// ---------------------------------------------------------------------------

const AT_HOUR = { dawn: 6, dusk: 19 } as const;

/** Cuántas veces ha dado una hora del día (las 6 al alba, las 19 al anochecer) entre dos instantes de juego. */
export function timesBetween(fromS: number, toS: number, hour: number): number {
  if (toS <= fromS) return 0;
  const k = (s: number) => Math.floor((s - hour * GAME_HOUR) / GAME_DAY);
  return k(toS) - k(fromS);
}

/**
 * Recarga lo que toca desde la última vez (alba o anochecer, tirando su
 * recarga por cada vez). Lo hace el motor al ir a gastar y al descansar.
 */
export function refreshCharges(world: World, inst: ItemInstance, nowGameS: number, rng?: Rng): number {
  const d = world.itemDef(inst.item_id);
  const left = chargesLeft(d, inst);
  if (left === null || !d.charges) return 0;
  const r = d.charges.recharge;
  const since = typeof inst.state['charges_at_game_s'] === 'number' ? inst.state['charges_at_game_s'] : null;
  if (!r || (r.at !== 'dawn' && r.at !== 'dusk') || since === null || left >= d.charges.max) return left;
  const n = timesBetween(since, nowGameS, AT_HOUR[r.at]);
  if (!n) return left;
  let now = left;
  for (let k = 0; k < n && now < d.charges.max; k++) now = Math.min(d.charges.max, now + Math.max(0, rollExpr(r.amount, rng).total));
  inst.state.charges = now;
  inst.state['charges_at_game_s'] = nowGameS;
  world.touch('item_instances', inst.id);
  return now;
}

/** Al descansar: recargan los objetos que lo hacen con un descanso corto o largo (y lo que toque de alba). */
export function rechargeOnRest(world: World, c: Character, kind: 'short' | 'long', nowGameS: number, rng?: Rng): string[] {
  const out: string[] = [];
  for (const inst of world.itemsCarriedBy(c.id)) {
    const d = world.itemDef(inst.item_id);
    if (!d.charges) continue;
    const before = chargesLeft(d, inst) ?? 0;
    let now = refreshCharges(world, inst, nowGameS, rng);
    const r = d.charges.recharge;
    if (r && (r.at === 'long_rest' || (r.at === 'short_rest')) && (kind === 'long' || r.at === 'short_rest') && now < d.charges.max) {
      now = Math.min(d.charges.max, now + Math.max(0, rollExpr(r.amount, rng).total));
      inst.state.charges = now;
      world.touch('item_instances', inst.id);
    }
    if (now > before) out.push(`${itemName(d, inst, c.id)} (${now}/${d.charges.max} cargas)`);
  }
  return out;
}

/**
 * Gasta cargas. Si el objeto se deshace al vaciarse (`destroy_on_empty`), al
 * gastar la última tira 1d20 y con un 1 desaparece (SRD).
 */
export function spendCharges(world: World, inst: ItemInstance, n: number, nowGameS: number, rng?: Rng): { ok: true; left: number; destroyed: boolean } | { ok: false; error: string } {
  const d = world.itemDef(inst.item_id);
  if (!d.charges) return { ok: false, error: `${d.name} no tiene cargas.` };
  const have = refreshCharges(world, inst, nowGameS, rng);
  const k = Math.max(1, Math.floor(n));
  if (have < k) return { ok: false, error: `${d.name} solo tiene ${have} ${have === 1 ? 'carga' : 'cargas'}${d.charges.recharge ? '; recupera con el tiempo' : ''}.` };
  inst.state.charges = have - k;
  inst.state['charges_at_game_s'] = nowGameS;
  let destroyed = false;
  if (inst.state.charges === 0 && d.charges.destroy_on_empty && rollDie(20, rng) === 1) { world.remove('item_instances', inst.id); destroyed = true; }
  else world.touch('item_instances', inst.id);
  return { ok: true, left: inst.state.charges, destroyed };
}

// ---------------------------------------------------------------------------
// Conjuros desde objetos: pergaminos y varitas
// ---------------------------------------------------------------------------

/**
 * El conjuro de un pergamino, varita o bastón y el nivel al que sale: el de la
 * definición o, en los pergaminos genéricos por nivel del catálogo, el del
 * ejemplar (`state.spell_id`).
 */
export function itemSpell(world: World, inst: ItemInstance): { spell: SpellDef; level: number } | null {
  const d = world.itemDef(inst.item_id);
  if (!d.spell) return null;
  const id = typeof inst.state['spell_id'] === 'string' ? inst.state['spell_id'] : d.spell.spell_id;
  const sp = id ? spellById(id) : undefined;
  return sp ? { spell: sp, level: Math.max(sp.level, d.spell.level) } : null;
}

/** ¿Está el conjuro en la lista de su clase (o se lo suma su patrón)? */
export function onSpellList(c: Character, sp: SpellDef): boolean {
  const cd = casterOf(c);
  return Boolean(cd && (sp.classes.includes(cd.list) || cd.extra?.includes(sp.id)));
}

export interface ItemCast {
  spell: SpellDef;
  cast_level: number;
  save_dc: number;
  attack: number;
  roll: { expr: string; total: number; breakdown: string } | null;
  /** La prueba de característica para un pergamino de nivel mayor del que puede lanzar. */
  check: CheckResult | null;
}

/** CD y ataque de un pergamino (SRD): los del objeto si los dice, si no los de la tabla por nivel. */
export function scrollStats(d: ItemDef, level: number): { save_dc: number; attack: number } {
  const row = SCROLL_TABLE[Math.max(0, Math.min(9, level))]!;
  return { save_dc: d.spell?.save_dc ?? row.save_dc, attack: d.spell?.attack_bonus ?? row.attack };
}

function consumeOne(world: World, inst: ItemInstance): void {
  inst.quantity -= 1;
  if (inst.quantity <= 0) world.remove('item_instances', inst.id);
  else world.touch('item_instances', inst.id);
}

/**
 * Lee un pergamino (SRD): si el conjuro es de su lista y de un nivel que puede
 * lanzar, sale sin componentes; si es de nivel mayor, prueba de su
 * característica de lanzamiento CD 10 + nivel, y si falla se pierde. Si no es
 * de su lista no puede leerlo y no se gasta.
 */
export function useScroll(world: World, c: Character, inst: ItemInstance, rng?: Rng): { ok: true; cast: ItemCast } | { ok: false; error: string; consumed: boolean; check?: CheckResult } {
  const d = world.itemDef(inst.item_id);
  if (!d.spell || d.charges) return { ok: false, error: `${d.name} no es un pergamino de conjuro.`, consumed: false };
  const is = itemSpell(world, inst);
  if (!is) return { ok: false, error: `${d.name} no dice qué conjuro lleva escrito: no se puede leer.`, consumed: false };
  const sp = is.spell;
  const cd = casterOf(c);
  if (!cd || !onSpellList(c, sp)) return { ok: false, error: `${sp.name} no es de la lista de conjuros de ${c.name}: no sabe leer ese pergamino. No se gasta.`, consumed: false };
  const blocked = armorBlocksSpells(world, c);
  if (blocked) return { ok: false, error: blocked, consumed: false };
  const level = is.level;
  identify(world, c, inst);
  let check: CheckResult | null = null;
  if (level > 0 && level > maxSpellLevel(c)) {
    check = rollD20(abilityModifier(c.abilities[cd.ability]), 10 + level, 'none', rng);
    if (!check.success) {
      consumeOne(world, inst);
      return { ok: false, error: `${sp.name} es de nivel ${level}, más del que sabe lanzar: falla la prueba (CD ${10 + level}). Las palabras se borran y no pasa nada.`, consumed: true, check };
    }
  }
  consumeOne(world, inst);
  const st = scrollStats(d, level);
  return { ok: true, cast: { spell: sp, cast_level: level, save_dc: st.save_dc, attack: st.attack, roll: rollSpellDice(c, sp, level, rng), check } };
}

/** Coste de copiar un conjuro al libro (SRD): 50 de oro (oro = 100 de la moneda más pequeña) y 2 horas por nivel. */
export function copyCost(level: number): { coins: number; hours: number } { return { coins: 50 * 100 * level, hours: 2 * level }; }

/**
 * Copiar un pergamino al libro de conjuros (mago, SRD): Arcanos CD 10 + nivel;
 * salga o no, el pergamino se pierde. El coste (copyCost) lo cobra quien llama.
 */
export function copyScroll(world: World, c: Character, inst: ItemInstance, arcanaMod: number, rng?: Rng): { ok: true; copied: boolean; spell: SpellDef; check: CheckResult } | { ok: false; error: string } {
  const d = world.itemDef(inst.item_id);
  const sp = itemSpell(world, inst)?.spell;
  if (!sp || d.charges) return { ok: false, error: `${d.name} no es un pergamino de conjuro.` };
  const cd = casterOf(c);
  if (!cd || cd.mode !== 'book') return { ok: false, error: `${c.name} no tiene libro de conjuros: solo un mago copia pergaminos.` };
  if (!onSpellList(c, sp) || sp.level === 0) return { ok: false, error: `${sp.name} no se puede copiar al libro de ${c.name}.` };
  if (sp.level > maxSpellLevel(c)) return { ok: false, error: `${sp.name} es de nivel ${sp.level}: todavía no puede copiarlo.` };
  const known = spellsOf(c).known;
  if (known.includes(sp.id)) return { ok: false, error: `${sp.name} ya está en su libro.` };
  identify(world, c, inst);
  const check = rollD20(arcanaMod, 10 + sp.level, 'none', rng);
  consumeOne(world, inst);
  if (check.success) { known.push(sp.id); world.touch('characters', c.id); }
  return { ok: true, copied: check.success === true, spell: sp, check };
}

/**
 * Lanza el conjuro de una varita o un bastón: gasta cargas (cada carga de más
 * sube un nivel, como la varita de proyectiles mágicos) y tira sus dados. La
 * CD y el ataque, los del objeto si los dice; si no, los del PJ.
 */
export function castFromCharges(world: World, c: Character, inst: ItemInstance, charges: number, nowGameS: number, own: { save_dc: number; attack: number }, rng?: Rng): { ok: true; cast: ItemCast; left: number; destroyed: boolean } | { ok: false; error: string } {
  const d = world.itemDef(inst.item_id);
  const is = itemSpell(world, inst);
  if (!is) return { ok: false, error: `${d.name} no lanza ningún conjuro.` };
  const sp = is.spell;
  if (!itemActiveFor(inst, d, c)) return { ok: false, error: `${d.name} pide sintonía: sin ella no responde.` };
  const k = Math.max(1, Math.floor(charges));
  const spent = spendCharges(world, inst, k, nowGameS, rng);
  if (!spent.ok) return spent;
  const level = is.level + (k - 1);
  const save = d.spell!.save_dc ?? own.save_dc, attack = d.spell!.attack_bonus ?? own.attack;
  return { ok: true, cast: { spell: sp, cast_level: level, save_dc: save, attack, roll: rollSpellDice(c, sp, level, rng), check: null }, left: spent.left, destroyed: spent.destroyed };
}

// ---------------------------------------------------------------------------
// Pociones y efectos de un uso
// ---------------------------------------------------------------------------

/**
 * Aplica el efecto de una poción (o de un objeto de un uso) a quien la toma:
 * una condición con su duración, que se quita sola al acabar. La resistencia
 * así tomada la cuenta el daño (damageAfterResistance). Null si no tiene efecto.
 */
export function applyItemEffect(world: World, c: Character, d: ItemDef, nowGameS: number): { name: string; expires_game_s: number | null } | null {
  if (!d.effect) return null;
  const name = d.effect.kind === 'condition' ? d.effect.condition : effectText(d.effect);
  const expires = d.duration_s ? nowGameS + d.duration_s : null;
  c.conditions = c.conditions.filter((x) => x.name !== name);
  c.conditions.push({ name, source: d.name, expires_game_s: expires });
  world.touch('characters', c.id);
  return { name, expires_game_s: expires };
}

// ---------------------------------------------------------------------------
// Para la ficha
// ---------------------------------------------------------------------------

/** Líneas de la ficha sobre sus objetos: sintonía, armadura sin competencia, fuerza mínima, efectos y cargas. */
export function gearLines(world: World, c: Character): string[] {
  const out: string[] = [];
  const att = attunedItems(world, c);
  if (att.length) out.push(`Sintonizado con ${att.map((i) => itemName(world.itemDef(i.item_id), i, c.id)).join(', ')} (${att.length}/${MAX_ATTUNED}).`);
  const bad = unproficientArmor(world, c);
  if (bad.length) out.push(`Lleva ${bad.map((d) => d.name).join(' y ')} sin competencia: desventaja en FUE y DES, y no puede lanzar conjuros.`);
  const body = world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'equipped', slot: 'body' } })[0];
  const min = body ? world.itemDef(body.item_id).armor?.str_min : undefined;
  if (min && c.abilities.str < min) out.push(`Su armadura pide FUE ${min}: −10 pies de velocidad.`);
  const fx = activeEffects(world, c);
  if (fx.length) out.push(`Por lo que lleva: ${fx.map(effectText).join('; ')}.`);
  for (const i of world.itemsCarriedBy(c.id)) {
    const d = world.itemDef(i.item_id);
    if (d.charges && isIdentifiedBy(d, i, c.id)) out.push(`${d.name}: ${chargesLeft(d, i)}/${d.charges.max} cargas.`);
  }
  return out;
}
