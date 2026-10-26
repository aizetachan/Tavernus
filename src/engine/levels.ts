/**
 * Clase y nivel de un PJ desde los datos SRD (src/data/srd/progression.ts y
 * spells.ts): rasgos, recursos, espacios y conjuros, elecciones y subida de
 * nivel. Determinista y sin IA; el motor emite los avisos y la Hoja y el
 * máster leen de aquí lo que el PJ sabe hacer.
 *
 *   - Se sube de nivel en cuanto los PX cruzan el umbral del SRD. Los PG suben
 *     la media del dado de golpe + CON (sin tirar: igual para todos).
 *   - Los conjuros y las elecciones con valor por defecto (estilo, pericia,
 *     metamagia…) se rellenan solos al crear y al subir, para que nadie se
 *     quede sin nada; el jugador los cambia en la Hoja cuando quiera.
 *   - La mejora de característica no tiene valor por defecto: queda pendiente
 *     hasta que el jugador la elige, y es definitiva.
 */

import { FULL_CASTER_SLOTS, HALF_CASTER_SLOTS, MAX_LEVEL, PACT_SLOTS, PACT_SLOT_LEVEL, XP_THRESHOLDS, progressionOf, type CasterDef, type ChoiceDef, type FeatureDef, type FeatureEffect, type OptionDef } from '../data/srd/progression.js';
import { SPELLS, spellById, spellNamed, type SpellDef } from '../data/srd/spells.js';
import { abilityModifier, proficiencyBonus, rollExpr, type Rng } from './dice.js';
import type { Character, CharacterSpells, Id } from './model.js';
import { SKILLS, type Ability } from './rules.js';

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_SHORT: Record<Ability, string> = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };

// ---------------------------------------------------------------------------
// Experiencia
// ---------------------------------------------------------------------------

/** PX acumulados que hacen falta para llegar a un nivel. */
export function xpForLevel(level: number): number {
  return XP_THRESHOLDS[Math.max(1, Math.min(MAX_LEVEL, level)) - 1]!;
}

/** Nivel que corresponde a unos PX. */
export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= XP_THRESHOLDS[l]!) l++;
  return l;
}

/** PX del siguiente nivel, o null en el último. */
export function nextLevelXp(c: Character): number | null {
  return c.level >= MAX_LEVEL ? null : xpForLevel(c.level + 1);
}

// ---------------------------------------------------------------------------
// Rasgos y recursos
// ---------------------------------------------------------------------------

export interface ClassResource { key: string; label: string; max: number; recharge: 'short' | 'long' }

const fill = (text: string, values: FeatureDef['values'], level: number) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => String(values?.[k]?.[level - 1] ?? m));

/** Rasgos de su clase hasta su nivel, con el texto ya resuelto para ese nivel. */
export function classFeatures(c: Character, level = c.level): (FeatureDef & { text: string })[] {
  return (progressionOf(c.class_id)?.features ?? []).filter((f) => f.level <= level).map((f) => ({ ...f, text: fill(f.text, f.values, level) }));
}

/** Efectos de reglas activos: los de sus rasgos y los de las opciones elegidas. */
export function effectsOf(c: Character): FeatureEffect[] {
  const out = classFeatures(c).flatMap((f) => (f.effects ? [f.effects] : []));
  for (const ch of classChoices(c)) {
    for (const id of c.picks?.[ch.key] ?? []) {
      const o = ch.options?.find((x) => x.id === id);
      if (o?.effects) out.push(o.effects);
    }
  }
  return out;
}

/** Lo que suma a los ataques con arma a distancia (estilo Tiro con arco). */
export function rangedStyleBonus(c: Character): number {
  return effectsOf(c).reduce((a, e) => a + (e.ranged_attack ?? 0), 0);
}

/** Recursos que gasta y recupera al descansar, según clase y nivel: los de clase y los espacios de conjuro. */
export function classResources(c: Character): ClassResource[] {
  const p = progressionOf(c.class_id);
  if (!p) return [];
  const L = c.level;
  const out: ClassResource[] = [];
  for (const r of p.resources) {
    if (L < r.from) continue;
    const max = Array.isArray(r.max) ? r.max[L - 1]!
      : 'times_level' in r.max ? r.max.times_level * L
      : Math.max(1, abilityModifier(c.abilities[r.max.ability]) + (r.max.plus ?? 0));
    out.push({ key: r.key, label: r.label, max, recharge: r.short_from && L >= r.short_from ? 'short' : r.recharge });
  }
  const cd = casterOf(c);
  if (cd?.slots === 'pact') out.push({ key: 'slot_pact', label: `espacios de pacto (nivel ${PACT_SLOT_LEVEL[L - 1]})`, max: PACT_SLOTS[L - 1]!, recharge: 'short' });
  else if (cd) slotRow(cd, L).forEach((n, i) => out.push({ key: `slot_${i + 1}`, label: `espacios de conjuro de nivel ${i + 1}`, max: n, recharge: 'long' }));
  return out;
}

/** Usos que le quedan de un recurso. */
export function resourceLeft(c: Character, r: ClassResource): number {
  return Math.max(0, r.max - (c.rest?.used[r.key] ?? 0));
}

// ---------------------------------------------------------------------------
// Conjuros
// ---------------------------------------------------------------------------

/** Cómo lanza su clase, si ya lanza a su nivel. */
export function casterOf(c: Character, level = c.level): CasterDef | null {
  const cd = progressionOf(c.class_id)?.caster;
  return cd && level >= cd.from ? cd : null;
}

function slotRow(cd: CasterDef, level: number): number[] {
  if (cd.slots === 'pact') return [];
  return (cd.slots === 'full' ? FULL_CASTER_SLOTS : HALF_CASTER_SLOTS)[level - 1] ?? [];
}

/** Nivel de conjuro más alto que puede lanzar (0 si solo trucos o nada). */
export function maxSpellLevel(c: Character, level = c.level): number {
  const cd = casterOf(c, level);
  if (!cd) return 0;
  return cd.slots === 'pact' ? PACT_SLOT_LEVEL[level - 1]! : slotRow(cd, level).length;
}

export function cantripCount(c: Character, level = c.level): number {
  return casterOf(c, level)?.cantrips?.[level - 1] ?? 0;
}

/** Conocidos (bardo, hechicero, brujo, explorador) o conjuros del libro (mago). */
export function knownCount(c: Character, level = c.level): number {
  const cd = casterOf(c, level);
  if (!cd) return 0;
  if (cd.book) return cd.book.start + cd.book.per_level * (level - 1);
  return cd.known?.[level - 1] ?? 0;
}

/** Cuántos puede tener preparados (modificador + nivel o medio nivel, mínimo 1). */
export function preparedCount(c: Character, level = c.level): number {
  const cd = casterOf(c, level);
  if (!cd?.prepared) return 0;
  const mod = abilityModifier(c.abilities[cd.ability]);
  return Math.max(1, mod + (cd.prepared === 'full' ? level : Math.floor(level / 2)));
}

/** Su lista de clase (y lo que le suma el patrón) hasta un nivel de conjuro. Con 0, los trucos. */
export function spellList(c: Character, maxLevel: number, cantrips = false): SpellDef[] {
  const cd = casterOf(c);
  if (!cd) return [];
  return SPELLS.filter((s) => (s.classes.includes(cd.list) || cd.extra?.includes(s.id)) && (cantrips ? s.level === 0 : s.level >= 1 && s.level <= maxLevel));
}

/** Los de dominio o juramento: siempre preparados, sin contar. */
export function alwaysPrepared(c: Character, level = c.level): Id[] {
  return (casterOf(c, level)?.always ?? []).filter((a) => a.level <= level).flatMap((a) => a.spells);
}

export function spellsOf(c: Character): CharacterSpells {
  return (c.spells ??= { cantrips: [], known: [], prepared: [] });
}

/** Los que puede lanzar hoy: trucos, siempre preparados y conocidos o preparados según su clase. */
export function castableSpells(c: Character): Id[] {
  const cd = casterOf(c);
  if (!cd || !c.spells) return [];
  const s = c.spells;
  return [...new Set([...s.cantrips, ...alwaysPrepared(c), ...(cd.mode === 'known' ? s.known : s.prepared)])];
}

/** Por orden: primero los recomendados de la clase, luego el resto de la lista. */
function ordered(prefer: string[], pool: SpellDef[]): SpellDef[] {
  const ids = new Set(pool.map((s) => s.id));
  const first = prefer.filter((id) => ids.has(id)).map((id) => spellById(id)!);
  return [...first, ...pool.filter((s) => !prefer.includes(s.id))];
}

/**
 * Completa sus conjuros hasta lo que le toca a su nivel con los recomendados
 * de su clase (y recorta los preparados si ya no le caben). Devuelve los
 * nuevos. Al crear, al subir de nivel y al cargar una partida antigua.
 */
export function fillSpells(c: Character): { cantrips: Id[]; known: Id[]; prepared: Id[] } {
  const added = { cantrips: [] as Id[], known: [] as Id[], prepared: [] as Id[] };
  const cd = casterOf(c);
  if (!cd) return added;
  const s = spellsOf(c);
  const max = maxSpellLevel(c);
  const always = new Set(alwaysPrepared(c));
  const take = (into: Id[], n: number, pool: SpellDef[], out: Id[]) => {
    for (const sp of pool) {
      if (into.length >= n) break;
      if (into.includes(sp.id) || always.has(sp.id)) continue;
      into.push(sp.id); out.push(sp.id);
    }
  };
  take(s.cantrips, cantripCount(c), ordered(cd.pick_cantrips, spellList(c, 0, true)), added.cantrips);
  if (cd.mode !== 'prepared') take(s.known, knownCount(c), ordered(cd.pick_spells, spellList(c, max)), added.known);
  if (cd.prepared) {
    const n = preparedCount(c);
    const from = cd.mode === 'book' ? s.known.map((id) => spellById(id)!).filter((x) => x.level <= max) : ordered(cd.pick_spells, spellList(c, max));
    s.prepared = s.prepared.filter((id) => !always.has(id) && from.some((x) => x.id === id)).slice(0, n);
    take(s.prepared, n, from, added.prepared);
  }
  return added;
}

/** Cambia una lista de conjuros desde la Hoja: trucos, conocidos (o el libro) o preparados. */
export function setSpells(c: Character, which: 'cantrips' | 'known' | 'prepared', ids: Id[]): { ok: true } | { ok: false; error: string } {
  const cd = casterOf(c);
  if (!cd) return { ok: false, error: 'Tu clase no lanza conjuros (todavía).' };
  const s = spellsOf(c);
  const uniq = [...new Set(ids)];
  const max = maxSpellLevel(c);
  if (which === 'cantrips') {
    const n = cantripCount(c);
    if (!n) return { ok: false, error: 'Tu clase no tiene trucos.' };
    if (uniq.length !== n) return { ok: false, error: `Elige ${n} trucos.` };
    const pool = spellList(c, 0, true);
    const bad = uniq.find((id) => !pool.some((x) => x.id === id));
    if (bad) return { ok: false, error: `${spellById(bad)?.name ?? bad} no es un truco de tu clase.` };
    s.cantrips = uniq;
    return { ok: true };
  }
  if (which === 'known') {
    if (cd.mode === 'prepared') return { ok: false, error: 'Tu clase prepara de toda su lista: elige los preparados.' };
    const n = knownCount(c);
    if (uniq.length !== n) return { ok: false, error: `Elige ${n} conjuros${cd.mode === 'book' ? ' para tu libro' : ''}.` };
    const pool = spellList(c, max);
    const bad = uniq.find((id) => !pool.some((x) => x.id === id) || alwaysPrepared(c).includes(id));
    if (bad) return { ok: false, error: `${spellById(bad)?.name ?? bad} no está a tu alcance (lista de clase, hasta nivel ${max}).` };
    s.known = uniq;
    if (cd.mode === 'book') { s.prepared = s.prepared.filter((id) => uniq.includes(id)); fillSpells(c); }
    return { ok: true };
  }
  if (!cd.prepared) return { ok: false, error: 'Tu clase no prepara conjuros: lanza los que conoce.' };
  const n = preparedCount(c);
  if (uniq.length < 1 || uniq.length > n) return { ok: false, error: `Puedes preparar hasta ${n}.` };
  const pool = cd.mode === 'book' ? s.known : spellList(c, max).map((x) => x.id);
  const bad = uniq.find((id) => !pool.includes(id) || alwaysPrepared(c).includes(id));
  if (bad) return { ok: false, error: `${spellById(bad)?.name ?? bad} no se puede preparar${cd.mode === 'book' ? ': no está en tu libro' : ''}.` };
  s.prepared = uniq;
  return { ok: true };
}

/** CD de salvación y bonificador de ataque de sus conjuros. */
export function spellStats(c: Character): { ability: Ability; save_dc: number; attack: number } | null {
  const cd = casterOf(c) ?? progressionOf(c.class_id)?.caster;
  if (!cd) return null;
  const mod = abilityModifier(c.abilities[cd.ability]) + proficiencyBonus(c.level);
  return { ability: cd.ability, save_dc: 8 + mod, attack: mod };
}

export type CastResult =
  | { ok: true; spell: SpellDef; cast_level: number; ritual: boolean; slot: { key: string; label: string; left: number } | null; save_dc: number; attack: number; roll: { expr: string; total: number; breakdown: string } | null }
  | { ok: false; error: string };

/** Dados de un truco según el nivel del PJ: ×2 a 5, ×3 a 11, ×4 a 17. */
function cantripDice(expr: string, level: number): string {
  const k = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  return expr.replace(/^(\d+)d/, (_, n: string) => `${Number(n) * k}d`);
}

/**
 * Lanza un conjuro: comprueba que lo tiene, gasta el espacio (el más bajo que
 * sirva, o el que pida) y tira sus dados. Un ritual no gasta espacio. Lo que
 * el conjuro hace en la escena (aplicar el daño, la curación, la condición) lo
 * resuelve el máster con sus tools.
 */
export function castSpell(c: Character, ref: string, opts: { slot_level?: number | null; ritual?: boolean } = {}, rng?: Rng): CastResult {
  const cd = casterOf(c);
  if (!cd) return { ok: false, error: `${c.name} no lanza conjuros${progressionOf(c.class_id)?.caster ? ' todavía' : ''}.` };
  const sp = spellNamed(ref);
  const can = castableSpells(c);
  const names = () => can.map((id) => spellById(id)?.name ?? id).join(', ');
  if (!sp) return { ok: false, error: `No existe el conjuro «${ref}». Puede lanzar: ${names()}.` };
  const ritual = Boolean(opts.ritual) && Boolean(sp.ritual) && sp.level > 0;
  const has = can.includes(sp.id) || (ritual && cd.mode === 'book' && spellsOf(c).known.includes(sp.id));
  if (!has) return { ok: false, error: `${c.name} no tiene ${sp.name} ${cd.mode === 'book' ? 'preparado' : cd.mode === 'known' ? 'entre los que conoce' : 'preparado'}. Puede lanzar: ${names()}.` };
  const stats = spellStats(c)!;
  let castLevel = sp.level;
  let slot: { key: string; label: string; left: number } | null = null;
  if (sp.level > 0 && !ritual) {
    const res = classResources(c);
    const used = (c.rest ??= { hit_dice_used: 0, used: {}, last_long_rest_game_s: null }).used;
    let pick: ClassResource | undefined;
    if (cd.slots === 'pact') {
      pick = res.find((r) => r.key === 'slot_pact');
      castLevel = PACT_SLOT_LEVEL[c.level - 1]!;
      if (sp.level > castLevel) return { ok: false, error: `${sp.name} es de nivel ${sp.level}; tus espacios de pacto son de nivel ${castLevel}.` };
    } else {
      const want = opts.slot_level ?? null;
      if (want !== null && want < sp.level) return { ok: false, error: `${sp.name} es de nivel ${sp.level}: no cabe en un espacio de nivel ${want}.` };
      const slots = res.filter((r) => r.key.startsWith('slot_')).map((r) => ({ r, lvl: Number(r.key.slice(5)) })).filter((x) => x.lvl >= (want ?? sp.level));
      const found = (want !== null ? slots.filter((x) => x.lvl === want) : slots).find((x) => resourceLeft(c, x.r) > 0);
      if (found) { pick = found.r; castLevel = found.lvl; }
      else if (want !== null && slots.some((x) => x.lvl === want)) return { ok: false, error: `No le quedan espacios de nivel ${want}; vuelven con un descanso largo.` };
    }
    if (!pick || resourceLeft(c, pick) <= 0) return { ok: false, error: `No le quedan espacios para ${sp.name} (nivel ${sp.level}); vuelven con un descanso ${cd.slots === 'pact' ? 'corto' : 'largo'}.${sp.ritual ? ' Es un ritual: puede lanzarlo así, sin espacio, tardando 10 minutos más.' : ''}` };
    used[pick.key] = (used[pick.key] ?? 0) + 1;
    slot = { key: pick.key, label: pick.label, left: resourceLeft(c, pick) };
  }
  let roll: { expr: string; total: number; breakdown: string } | null = null;
  if (sp.dice) {
    let expr = sp.level === 0 ? cantripDice(sp.dice.expr, c.level) : sp.dice.expr;
    if (sp.dice.upcast) for (let i = sp.level; i < castLevel; i++) expr += `+${sp.dice.upcast}`;
    const mod = abilityModifier(c.abilities[stats.ability]);
    if (sp.dice.add_mod && mod) expr += mod > 0 ? `+${mod}` : `${mod}`;
    if (sp.dice.kind === 'heal' && effectsOf(c).some((e) => e.heal_bonus)) expr += `+${2 + castLevel}`;
    const r = rollExpr(expr, rng);
    roll = { expr, total: Math.max(0, r.total), breakdown: r.breakdown };
  }
  return { ok: true, spell: sp, cast_level: castLevel, ritual, slot, save_dc: stats.save_dc, attack: stats.attack, roll };
}

// ---------------------------------------------------------------------------
// Elecciones
// ---------------------------------------------------------------------------

/** Las elecciones de su clase hasta su nivel, con las mejoras de característica. */
export function classChoices(c: Character, level = c.level): ChoiceDef[] {
  const p = progressionOf(c.class_id);
  if (!p) return [];
  const asi: ChoiceDef[] = p.asi.filter((l) => l <= level).map((l) => ({
    key: `asi_${l}`, level: l, kind: 'asi', name: 'Mejora de característica', count: 2,
    text: '+2 a una característica o +1 a dos, sin pasar de 20. Es definitiva.',
  }));
  return [...p.choices.filter((ch) => ch.level <= level), ...asi].sort((a, b) => a.level - b.level);
}

/** Opciones de una elección: las suyas, o las habilidades con competencia (pericia), o las características (mejora). */
export function choiceOptions(c: Character, ch: ChoiceDef): OptionDef[] {
  if (ch.kind === 'asi') return ABILITIES.map((a) => ({ id: a, name: ABILITY_SHORT[a], text: `${c.abilities[a]}` }));
  if (ch.kind === 'expertise') {
    const elsewhere = classChoices(c).filter((x) => x.kind === 'expertise' && x.key !== ch.key).flatMap((x) => c.picks?.[x.key] ?? []);
    return c.proficiencies.skills.filter((k) => SKILLS[k] && !elsewhere.includes(k)).map((k) => ({ id: k, name: SKILLS[k]!.es, text: '' }));
  }
  return ch.options ?? [];
}

export function pendingChoices(c: Character): ChoiceDef[] {
  return classChoices(c).filter((ch) => !c.picks?.[ch.key]);
}

/** Pericia = la unión de lo elegido en sus elecciones de pericia. */
function syncExpertise(c: Character): void {
  const exp = classChoices(c).filter((ch) => ch.kind === 'expertise').flatMap((ch) => c.picks?.[ch.key] ?? []);
  c.proficiencies.expert = [...new Set(exp)];
}

/** Rellena con su valor por defecto las elecciones que lo tienen (todas menos la mejora). Devuelve qué ha elegido. */
export function applyDefaultChoices(c: Character): string[] {
  const out: string[] = [];
  for (const ch of pendingChoices(c)) {
    if (ch.kind === 'asi') continue;
    const opts = choiceOptions(c, ch);
    const prefer = [...(ch.prefer ?? []).filter((id) => opts.some((o) => o.id === id)), ...opts.map((o) => o.id)];
    const picks = [...new Set(prefer)].slice(0, ch.count);
    if (picks.length < ch.count) continue;
    (c.picks ??= {})[ch.key] = picks;
    out.push(`${ch.name}: ${picks.map((id) => opts.find((o) => o.id === id)!.name).join(', ')}`);
  }
  syncExpertise(c);
  return out;
}

/**
 * El jugador elige desde la Hoja. Mejora de característica: dos claves (la
 * misma dos veces = +2), una sola vez. Las demás se pueden cambiar.
 */
export function makeChoice(c: Character, key: string, picks: string[]): { ok: true; text: string } | { ok: false; error: string } {
  const ch = classChoices(c).find((x) => x.key === key);
  if (!ch) return { ok: false, error: 'Esa elección no es de tu clase o aún no te toca.' };
  const opts = choiceOptions(c, ch);
  if (ch.kind === 'asi') {
    if (c.picks?.[key]) return { ok: false, error: 'Esa mejora ya la elegiste.' };
    if (picks.length !== 2 || picks.some((a) => !ABILITIES.includes(a as Ability))) return { ok: false, error: 'Elige dos características (o la misma dos veces para +2).' };
    const add: Partial<Record<Ability, number>> = {};
    for (const a of picks as Ability[]) add[a] = (add[a] ?? 0) + 1;
    for (const [a, n] of Object.entries(add) as [Ability, number][]) if (c.abilities[a] + n > 20) return { ok: false, error: `${ABILITY_SHORT[a]} no puede pasar de 20.` };
    const conBefore = abilityModifier(c.abilities.con);
    for (const [a, n] of Object.entries(add) as [Ability, number][]) c.abilities[a] += n;
    const hp = (abilityModifier(c.abilities.con) - conBefore) * c.level;
    if (hp) { c.hp_max += hp; c.hp_current += hp; }
    (c.picks ??= {})[key] = picks;
    fillSpells(c);
    return { ok: true, text: `Mejora de característica: ${Object.entries(add).map(([a, n]) => `${ABILITY_SHORT[a as Ability]} +${n} (${c.abilities[a as Ability]})`).join(', ')}${hp ? `; PG máximos ${c.hp_max}` : ''}.` };
  }
  const uniq = [...new Set(picks)];
  if (uniq.length !== ch.count) return { ok: false, error: `Elige ${ch.count}.` };
  const bad = uniq.find((id) => !opts.some((o) => o.id === id));
  if (bad) return { ok: false, error: `${bad} no es una opción de ${ch.name}.` };
  (c.picks ??= {})[key] = uniq;
  syncExpertise(c);
  return { ok: true, text: `${ch.name}: ${uniq.map((id) => opts.find((o) => o.id === id)!.name).join(', ')}.` };
}

// ---------------------------------------------------------------------------
// Al crear, al cargar y al subir
// ---------------------------------------------------------------------------

/** PG que da subir un nivel: la media del dado + CON (mínimo 1) y lo que sumen sus rasgos. */
function hpPerLevel(c: Character): number {
  return Math.max(1, Math.floor(c.hit_die / 2) + 1 + abilityModifier(c.abilities.con)) + extraHpPerLevel(c);
}
const extraHpPerLevel = (c: Character) => effectsOf(c).reduce((a, e) => a + (e.hp_per_level ?? 0), 0);

/**
 * Lo que da la clase a un PJ recién creado o que viene de una versión sin
 * clase completa: conjuros, elecciones por defecto y PG de sus rasgos. Una
 * sola vez (marca: `picks`). Devuelve si ha cambiado algo.
 */
export function initClass(c: Character): boolean {
  if (c.picks) return false;
  c.picks = {};
  const hp = extraHpPerLevel(c) * c.level;
  if (hp) { c.hp_max += hp; c.hp_current += hp; }
  for (let l = 2; l <= c.level; l++) for (const f of classFeatures(c, l)) if (f.level === l && f.effects?.speed_ft) c.speed_ft += f.effects.speed_ft;
  applyDefaultChoices(c);
  fillSpells(c);
  return true;
}

export interface LevelUpReport {
  from: number;
  to: number;
  hp_gain: number;
  hp_max: number;
  /** Rasgos nuevos («Oleada de acción»). */
  features: string[];
  /** Recursos nuevos o con más usos («Furia 3»). */
  resources: string[];
  /** Espacios de conjuro tras subir («4 de nivel 1, 2 de nivel 2»), si han cambiado. */
  slots: string | null;
  /** Conjuros y trucos nuevos (los elegidos por defecto). */
  spells: string[];
  /** Del libro del mago, los que pasa a tener preparados. */
  prepared: string[];
  /** Elecciones hechas por defecto («Estilo de combate: Defensa»). */
  defaults: string[];
  /** Lo que queda por elegir en la Hoja. */
  pending: string[];
  /** Hardcore: características que vuelven al subir. */
  restored: string[];
}

function slotText(c: Character): string {
  return classResources(c).filter((r) => r.key.startsWith('slot_')).map((r) => `${r.max} ${r.key === 'slot_pact' ? r.label.replace('espacios ', '') : `de nivel ${r.key.slice(5)}`}`).join(', ');
}

/**
 * Sube los niveles que le den sus PX. null si no le toca. Cambia el PJ; el
 * llamante lo marca para guardar, recalcula lo derivado y avisa.
 */
export function levelUp(c: Character): LevelUpReport | null {
  const target = levelForXp(c.xp);
  if (target <= c.level) return null;
  const rep: LevelUpReport = { from: c.level, to: target, hp_gain: 0, hp_max: 0, features: [], resources: [], slots: null, spells: [], prepared: [], defaults: [], pending: [], restored: [] };
  // Hardcore: lo que quitó la muerte vuelve al subir.
  if (c.ability_penalties) {
    const conBefore = abilityModifier(c.abilities.con);
    for (const [a, n] of Object.entries(c.ability_penalties) as [Ability, number][]) {
      if (!n) continue;
      c.abilities[a] += n;
      rep.restored.push(`${ABILITY_SHORT[a]} +${n}`);
    }
    const hp = (abilityModifier(c.abilities.con) - conBefore) * c.level;
    if (hp) { c.hp_max += hp; c.hp_current += hp; }
    delete c.ability_penalties;
  }
  const resBefore = new Map(classResources(c).map((r) => [r.key, r.max]));
  const slotsBefore = slotText(c);
  for (let l = c.level + 1; l <= target; l++) {
    c.level = l;
    const gain = hpPerLevel(c);
    c.hp_max += gain; c.hp_current += gain; rep.hp_gain += gain;
    for (const f of classFeatures(c, l)) {
      if (f.level !== l) continue;
      rep.features.push(f.name);
      if (f.effects?.speed_ft) c.speed_ft += f.effects.speed_ft;
    }
    rep.defaults.push(...applyDefaultChoices(c));
    const added = fillSpells(c);
    const name = (id: Id) => spellById(id)?.name ?? id;
    // Para el mago, preparar uno de su libro no es aprenderlo.
    const book = casterOf(c)?.mode === 'book';
    rep.spells.push(...[...added.cantrips, ...added.known, ...(book ? [] : added.prepared)].map(name));
    if (book) rep.prepared.push(...added.prepared.map(name));
  }
  for (const r of classResources(c)) {
    if (r.key.startsWith('slot_')) continue;
    const before = resBefore.get(r.key);
    if (before === undefined || r.max > before) rep.resources.push(`${r.label} ${r.max}`);
  }
  const slotsNow = slotText(c);
  if (slotsNow !== slotsBefore) rep.slots = slotsNow;
  rep.spells = [...new Set(rep.spells)];
  rep.prepared = [...new Set(rep.prepared)];
  rep.pending = pendingChoices(c).map((ch) => ch.name);
  rep.hp_max = c.hp_max;
  return rep;
}

/** El aviso de la subida, en una línea por apartado. */
export function levelUpText(c: Character, r: LevelUpReport): { head: string; gains: string[] } {
  const gains = [
    `PG máximos ${r.hp_max} (+${r.hp_gain}) · competencia +${proficiencyBonus(r.to)}`,
    ...(r.features.length ? [`Rasgos nuevos: ${r.features.join(', ')}`] : []),
    ...(r.resources.length ? [`Usos: ${r.resources.join(', ')}`] : []),
    ...(r.slots ? [`Espacios de conjuro: ${r.slots}`] : []),
    ...(r.spells.length ? [`Conjuros nuevos: ${r.spells.join(', ')} (puedes cambiarlos en la Hoja)`] : []),
    ...(r.prepared.length ? [`Preparas más: ${r.prepared.join(', ')}`] : []),
    ...(r.defaults.length ? [`${r.defaults.join('; ')} (puedes cambiarlo en la Hoja)`] : []),
    ...(r.restored.length ? [`Recuperas lo que te quitó la muerte: ${r.restored.join(', ')}`] : []),
    ...(r.pending.length ? [`Por elegir en la Hoja: ${r.pending.join(', ')}`] : []),
  ];
  return { head: `${c.name} sube a nivel ${r.to}`, gains };
}

// ---------------------------------------------------------------------------
// Lo que sabe hacer, en texto
// ---------------------------------------------------------------------------

/** Conjuros que puede lanzar, agrupados por nivel: «Trucos: A, B», «Nivel 1: C, D (siempre: E)». */
export function spellGroups(c: Character): { level: number; label: string; spells: SpellDef[]; always: SpellDef[] }[] {
  const can = castableSpells(c).map((id) => spellById(id)).filter((s): s is SpellDef => Boolean(s));
  const always = new Set(alwaysPrepared(c));
  const levels = [...new Set(can.map((s) => s.level))].sort((a, b) => a - b);
  return levels.map((l) => ({
    level: l, label: l === 0 ? 'Trucos' : `Nivel ${l}`,
    spells: can.filter((s) => s.level === l && !always.has(s.id)), always: can.filter((s) => s.level === l && always.has(s.id)),
  }));
}

/** Para el contexto del máster: rasgos (con usos), lo elegido y conjuros, en pocas líneas. */
export function abilitiesForMaster(c: Character): string[] {
  const res = new Map(classResources(c).map((r) => [r.key, r]));
  const used = (key?: string) => { const r = key ? res.get(key) : undefined; return r ? ` [${r.key} ${resourceLeft(c, r)}/${r.max}]` : ''; };
  const L: string[] = [];
  const feats = classFeatures(c);
  if (feats.length) L.push(`Rasgos de clase: ${feats.map((f) => `${f.name}${used(f.resource)}: ${f.text}`).join(' | ')}`);
  const chosen = classChoices(c).filter((ch) => c.picks?.[ch.key] && ch.kind !== 'asi');
  if (chosen.length) L.push(`Elegido: ${chosen.map((ch) => `${ch.name}: ${c.picks![ch.key]!.map((id) => choiceOptions(c, ch).find((o) => o.id === id)?.name ?? id).join(', ')}`).join('; ')}.`);
  const st = spellStats(c);
  const cd = casterOf(c);
  if (cd && st) {
    const groups = spellGroups(c).map((g) => `${g.label}: ${[...g.spells.map((s) => s.name), ...g.always.map((s) => `${s.name} (siempre)`)].join(', ')}`);
    L.push(`Conjuros (cast_spell; lanza con ${ABILITY_SHORT[st.ability]}, CD ${st.save_dc}, ataque +${st.attack}): ${groups.join('; ') || 'ninguno'}. Solo estos: lo que no está aquí no lo sabe lanzar.`);
    if (cd.mode === 'book') {
      const rituals = spellsOf(c).known.map((id) => spellById(id)!).filter((s) => s.ritual && !castableSpells(c).includes(s.id));
      if (rituals.length) L.push(`En su libro, sin preparar (solo como ritual): ${rituals.map((s) => s.name).join(', ')}.`);
    }
  } else if (progressionOf(c.class_id)?.caster) L.push(`Aún no lanza conjuros: empieza a nivel ${progressionOf(c.class_id)!.caster!.from}.`);
  return L;
}

// ---------------------------------------------------------------------------
// Para la Hoja
// ---------------------------------------------------------------------------

export interface SpellCard { id: Id; name: string; level: number; school: string; time: string; range: string; text: string; tags: string[]; always?: boolean }
export interface ChoiceCard { key: string; name: string; text: string; kind: ChoiceDef['kind']; count: number; level: number; picked: Id[]; options: OptionDef[]; pending: boolean; final: boolean }
export interface SpellEdit { key: 'cantrips' | 'known' | 'prepared'; title: string; count: number; exact: boolean; selected: Id[]; options: SpellCard[] }

/** Lo que la Hoja enseña de clase y nivel: PX, rasgos con usos, elecciones y conjuros (con qué hace cada uno y cómo cambiarlos). */
export interface ClassSheet {
  level: number; xp: number; level_xp: number; next_xp: number | null; proficiency: number;
  features: { name: string; text: string; level: number; uses: { left: number; max: number; recharge: 'short' | 'long' } | null }[];
  choices: ChoiceCard[];
  spells: null | {
    ability: Ability; save_dc: number; attack: number; mode: CasterDef['mode'];
    slots: { label: string; left: number; max: number; recharge: 'short' | 'long' }[];
    groups: { label: string; level: number; spells: SpellCard[] }[];
    book: SpellCard[];
    edits: SpellEdit[];
  };
  /** Lanzador que aún no lanza (paladín y explorador a nivel 1): a qué nivel empieza. */
  spells_from: number | null;
}

export function spellCard(s: SpellDef, always = false): SpellCard {
  const tags = [
    s.level === 0 ? 'truco' : `nivel ${s.level}`, s.school,
    ...(s.attack ? [s.attack === 'melee' ? 'ataque cuerpo a cuerpo' : 'ataque a distancia'] : []),
    ...(s.save ? [`salvación de ${ABILITY_SHORT[s.save]}`] : []),
    ...(s.concentration ? ['concentración'] : []), ...(s.ritual ? ['ritual'] : []), ...(always ? ['siempre preparado'] : []),
  ];
  return { id: s.id, name: s.name, level: s.level, school: s.school, time: s.time, range: s.range, text: s.text, tags, ...(always ? { always } : {}) };
}

const defined = (x: SpellDef | undefined): x is SpellDef => Boolean(x);

export function classSheet(c: Character): ClassSheet {
  const res = new Map(classResources(c).map((r) => [r.key, r]));
  const features = classFeatures(c).map((f) => {
    const r = f.resource ? res.get(f.resource) : undefined;
    return { name: f.name, text: f.text, level: f.level, uses: r ? { left: resourceLeft(c, r), max: r.max, recharge: r.recharge } : null };
  });
  const choices = classChoices(c).map((ch) => ({
    key: ch.key, name: ch.name, text: ch.text, kind: ch.kind, count: ch.count, level: ch.level,
    picked: c.picks?.[ch.key] ?? [], options: choiceOptions(c, ch), pending: !c.picks?.[ch.key], final: ch.kind === 'asi',
  }));
  const cd = casterOf(c);
  const st = spellStats(c);
  let spells: ClassSheet['spells'] = null;
  if (cd && st) {
    const s = spellsOf(c);
    const max = maxSpellLevel(c);
    const always = alwaysPrepared(c);
    const book = s.known.map((id) => spellById(id)).filter(defined);
    const edits: SpellEdit[] = [];
    if (cantripCount(c)) edits.push({ key: 'cantrips', title: 'Trucos', count: cantripCount(c), exact: true, selected: s.cantrips, options: spellList(c, 0, true).map((x) => spellCard(x)) });
    if (cd.mode !== 'prepared') edits.push({ key: 'known', title: cd.mode === 'book' ? 'Libro de conjuros' : 'Conjuros conocidos', count: knownCount(c), exact: true, selected: s.known, options: spellList(c, max).filter((x) => !always.includes(x.id)).map((x) => spellCard(x)) });
    if (cd.prepared) edits.push({ key: 'prepared', title: 'Preparados', count: preparedCount(c), exact: false, selected: s.prepared, options: (cd.mode === 'book' ? book.filter((x) => x.level <= max) : spellList(c, max).filter((x) => !always.includes(x.id))).map((x) => spellCard(x)) });
    spells = {
      ability: st.ability, save_dc: st.save_dc, attack: st.attack, mode: cd.mode,
      slots: classResources(c).filter((r) => r.key.startsWith('slot_')).map((r) => ({ label: r.key === 'slot_pact' ? r.label.replace('espacios de pacto', 'Pacto') : `Nivel ${r.key.slice(5)}`, left: resourceLeft(c, r), max: r.max, recharge: r.recharge })),
      groups: spellGroups(c).map((g) => ({ label: g.label, level: g.level, spells: [...g.spells.map((x) => spellCard(x)), ...g.always.map((x) => spellCard(x, true))] })),
      book: cd.mode === 'book' ? book.map((x) => spellCard(x)) : [],
      edits,
    };
  }
  const later = progressionOf(c.class_id)?.caster;
  return {
    level: c.level, xp: c.xp, level_xp: xpForLevel(c.level), next_xp: nextLevelXp(c), proficiency: proficiencyBonus(c.level),
    features, choices, spells, spells_from: !cd && later ? later.from : null,
  };
}
