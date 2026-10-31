/**
 * Creación de personaje sin estado (SPEC §4.6, §4.8): qué combinaciones valen,
 * cómo nace la hoja (PG, CA, salvaciones) y la vista previa del resumen. Lo usan
 * el motor al crear de verdad y la web antes de crear, para que lo que se enseña
 * en el resumen sea lo que luego existe. Nada se fía del cliente: `spec` puede
 * traer cualquier cosa que venga en un JSON.
 */

import { ABILITIES, BACKGROUNDS, CLASSES, RACES, STANDARD_ARRAY, backgroundById, classById, raceById, type BackgroundDef, type ClassDef, type RaceDef } from '../data/srd/index.js';
import { CREATION_STEPS, DEATH_MODE_TEXT } from './creation.js';
import { abilityModifier } from './dice.js';
import type { CharacterSpec } from './engine.js';
import { ABILITY_SHORT, initClass } from './levels.js';
import type { Character, Id, ItemDef } from './model.js';
import { ABILITY_ES, SKILLS, armorClass, passivePerception, saveModifier, skillModifier, type Ability } from './rules.js';

/** Paso del asistente al que pertenece un error (la web vuelve a él). */
export type ChargenField = 'name' | 'race' | 'class' | 'background' | 'abilities' | 'skills' | 'death';

export type ChargenFailure = { ok: false; reason: string; field: ChargenField };

export interface ResolvedSpec {
  race: RaceDef; klass: ClassDef; background: BackgroundDef;
  /** Array estándar asignado, sin los bonus de raza. */
  base: Record<Ability, number>;
  /** Skills de clase elegidas. */
  choices: string[];
  death_mode: 'casual' | 'hardcore';
  appearance: string;
}

const fail = (reason: string, field: ChargenField): ChargenFailure => ({ ok: false, reason, field });

export function cleanCharacterName(name: string): string { return name.trim().replace(/\s+/g, ' '); }

export function characterNameProblem(clean: string): ChargenFailure | null {
  return clean.length < 2 || clean.length > 24 ? fail('El nombre debe tener entre 2 y 24 caracteres.', 'name') : null;
}

/** Valida lo elegido contra las tablas SRD. Lo que falte: humano guerrero soldado con el array recomendado (pruebas, REPL). */
export function resolveCharacterSpec(spec?: Partial<CharacterSpec>): { ok: true; resolved: ResolvedSpec } | ChargenFailure {
  const race = raceById(spec?.race_id ?? 'human');
  const klass = classById(spec?.class_id ?? 'fighter');
  const background = backgroundById(spec?.background_id ?? klass?.background ?? 'soldier');
  if (!race || !klass || !background) return fail('Raza, clase o trasfondo no válidos.', !race ? 'race' : !klass ? 'class' : 'background');

  // Array estándar, y solo números: un «15» de texto ordena igual pero luego «15» + 1 sería «151».
  const given = (spec?.abilities ?? Object.fromEntries(ABILITIES.map((a, i) => [a, klass.recommended[i]]))) as Record<Ability, unknown>;
  const values = ABILITIES.map((a) => given[a]);
  if (!values.every((v): v is number => Number.isInteger(v)) || [...values].sort((x, y) => y - x).join(',') !== [...STANDARD_ARRAY].join(',')) {
    return fail('Las características deben ser el array estándar 15, 14, 13, 12, 10, 8.', 'abilities');
  }
  const base = Object.fromEntries(ABILITIES.map((a, i) => [a, values[i]!])) as Record<Ability, number>;

  // Skills: trasfondo + raza fijas; clase elige N de su lista sin repetir.
  const fixed = fixedSkills(race, background);
  const choices: unknown = spec?.skills ?? [...new Set([...klass.skill_choices.prefer, ...klass.skill_choices.from])].filter((k) => klass.skill_choices.from.includes(k) && !fixed.includes(k)).slice(0, klass.skill_choices.count);
  if (!Array.isArray(choices) || choices.length !== klass.skill_choices.count) return fail(`Elige ${klass.skill_choices.count} habilidades de clase.`, 'skills');
  if (new Set(choices).size !== choices.length) return fail('No repitas habilidades.', 'skills');
  for (const k of choices as string[]) {
    if (!klass.skill_choices.from.includes(k)) return fail(`${String(k)} no es una habilidad de ${klass.name}.`, 'skills');
    if (fixed.includes(k)) return fail(`${k} ya la tienes por trasfondo o raza.`, 'skills');
  }

  const death_mode = spec?.death_mode ?? 'casual';
  if (death_mode !== 'casual' && death_mode !== 'hardcore') return fail('El modo de muerte debe ser casual o hardcore.', 'death');

  return { ok: true, resolved: { race, klass, background, base, choices: choices as string[], death_mode, appearance: spec?.appearance ?? '' } };
}

const fixedSkills = (race: RaceDef, background: BackgroundDef) => [...new Set([...background.skills, ...race.skills])];

/** El PJ recién nacido: derivados y lo de su clase. Falta colocarlo en el mundo y darle el equipo. */
export function newCharacter(id: Id, userId: Id, name: string, r: ResolvedSpec, start: { spot_id: Id; coins: number }): Character {
  const abilities = Object.fromEntries(ABILITIES.map((a) => [a, r.base[a] + (r.race.ability_bonus[a] ?? 0)])) as Record<Ability, number>;
  const hp = r.klass.hit_die + abilityModifier(abilities.con);
  const c: Character = {
    id, user_id: userId, name,
    race: r.race.name.toLowerCase(), class_name: r.klass.name.toLowerCase(), race_id: r.race.id, class_id: r.klass.id, background_id: r.background.id,
    hit_die: r.klass.hit_die, death_mode: r.death_mode,
    level: 1, appearance: r.appearance, backstory: '',
    hp_max: hp, hp_current: hp, hp_temp: 0, conditions: [],
    proficiencies: { skills: [...new Set([...fixedSkills(r.race, r.background), ...r.choices])], expert: [], saves: [...r.klass.saves] },
    practice: {}, practice_bonus: {}, reputation: {}, knows: [], clues: [], completed_jobs: [], achievements: [],
    decisive: null, xp: 0,
    location: { type: 'spot', id: start.spot_id },
    transit: null, status: 'active', speed_ft: r.race.speed_ft,
    abilities, passive_perception: 10, darkvision: r.race.darkvision, condition_speed_factor: 1,
    coins: start.coins, last_seen_event_id: null, recap_from: null, connected: true, veiled: false,
  };
  // Lo de su clase (levels.ts): conjuros, pericia, estilo… con sus valores por defecto.
  initClass(c);
  c.passive_perception = passivePerception(c);
  return c;
}

export interface CharacterPreview {
  name: string; race: string; class_name: string; background: string; death_mode: 'casual' | 'hardcore';
  hp_max: number; ac: number; speed_ft: number; passive_perception: number; darkvision: boolean;
  abilities: { id: Ability; short: string; total: number; modifier: number }[];
  saves: { id: Ability; name: string; modifier: number; proficient: boolean }[];
  /** Solo en las que es competente. */
  skills: { id: string; name: string; modifier: number }[];
  equipment: { name: string; quantity: number }[];
}

/** El resumen antes de confirmar, con los mismos cálculos que `createCharacter`. `defs`: catálogo de objetos de la partida. */
export function previewCharacter(name: string, spec: Partial<CharacterSpec> | undefined, defs: readonly ItemDef[]): { ok: true; preview: CharacterPreview } | ChargenFailure {
  const clean = cleanCharacterName(name);
  const bad = characterNameProblem(clean);
  if (bad) return bad;
  const r = resolveCharacterSpec(spec);
  if (!r.ok) return r;
  const { race, klass, background, death_mode } = r.resolved;
  const c = newCharacter('preview', 'preview', clean, r.resolved, { spot_id: 'preview', coins: 0 });
  const byId = new Map(defs.map((d) => [d.id, d]));
  const owned = klass.equipment.filter((e) => byId.has(e.item_id));
  return {
    ok: true,
    preview: {
      name: clean, race: race.name, class_name: klass.name, background: background.name, death_mode,
      hp_max: c.hp_max, speed_ft: c.speed_ft, passive_perception: c.passive_perception, darkvision: c.darkvision,
      ac: armorClass({
        itemsIn: (p) => owned.filter((e) => e.slot === (p.slot.kind === 'equipped' ? p.slot.slot : p.slot.which === 'main' ? 'hand_main' : p.slot.which === 'off' ? 'hand_off' : null)),
        itemDef: (id) => byId.get(id)!,
      }, c),
      abilities: ABILITIES.map((a) => ({ id: a, short: ABILITY_SHORT[a], total: c.abilities[a], modifier: abilityModifier(c.abilities[a]) })),
      saves: ABILITIES.map((a) => ({ id: a, name: ABILITY_ES[a], modifier: saveModifier(c, a), proficient: c.proficiencies.saves.includes(a) })),
      skills: c.proficiencies.skills.map((s) => ({ id: s, name: SKILLS[s]!.es, modifier: skillModifier(c, s) })),
      equipment: owned.map((e) => ({ name: byId.get(e.item_id)!.name, quantity: e.quantity ?? 1 })),
    },
  };
}

/** Lo que necesita el asistente de la web para ofrecer solo opciones válidas. */
export function chargenCatalog() {
  return {
    steps: CREATION_STEPS,
    death_text: DEATH_MODE_TEXT,
    races: RACES.map((r) => ({ id: r.id, name: r.name, description: r.description, ability_bonus: r.ability_bonus, skills: r.skills })),
    classes: CLASSES.map((c) => ({ id: c.id, name: c.name, description: c.description, background: c.background, recommended: c.recommended, skill_count: c.skill_choices.count, skill_from: c.skill_choices.from })),
    backgrounds: BACKGROUNDS.map((b) => ({ id: b.id, name: b.name, description: b.description, skills: b.skills })),
    abilities: ABILITIES.map((a) => ({ id: a, name: ABILITY_ES[a], short: ABILITY_SHORT[a] })),
    standard_array: [...STANDARD_ARRAY],
    skills: Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, v.es])) as Record<string, string>,
  };
}
export type ChargenCatalog = ReturnType<typeof chargenCatalog>;
