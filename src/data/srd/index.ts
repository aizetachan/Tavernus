/**
 * Tablas SRD 5e mínimas para la creación de personaje (SPEC §4.6, §4.8).
 * Solo lo necesario para el MVP: 9 razas, 12 clases, 6 trasfondos, array
 * estándar. Nombres en castellano con clave en inglés.
 */

import type { Ability } from '../../engine/rules.js';

export interface RaceDef {
  id: string; name: string; description: string;
  ability_bonus: Partial<Record<Ability, number>>;
  /** Semielfo y humano variante: +1 a dos a elegir. Simplificado: fijos. */
  speed_ft: number; darkvision: boolean;
  skills: string[];
}

export interface ClassDef {
  id: string; name: string; description: string;
  hit_die: number;
  /** Característica con la que lanza conjuros (SRD); sin ella, la clase no los lanza. */
  spellcasting?: Ability;
  saves: Ability[];
  skill_choices: { count: number; from: string[]; /** Las que elige por defecto, por orden (saltando las que ya da el trasfondo). */ prefer: string[] };
  /** Trasfondo por defecto si el jugador no elige (la web no lo pregunta). */
  background: string;
  /** Array estándar recomendado, en orden STR DEX CON INT WIS CHA. */
  recommended: [number, number, number, number, number, number];
  /** Equipo inicial: ids del catálogo y dónde va. */
  equipment: { item_id: string; quantity?: number; slot: 'hand_main' | 'hand_off' | 'body' | 'back' | 'pack' | 'pocket' }[];
}

export interface BackgroundDef { id: string; name: string; description: string; skills: string[] }

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const RACES: RaceDef[] = [
  { id: 'human', name: 'Humano', description: 'Adaptable y ambicioso. +1 a todo.', ability_bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed_ft: 30, darkvision: false, skills: [] },
  { id: 'elf', name: 'Elfo', description: 'Grácil, longevo, ve en la oscuridad. +2 DES; Percepción.', ability_bonus: { dex: 2 }, speed_ft: 30, darkvision: true, skills: ['perception'] },
  { id: 'dwarf', name: 'Enano', description: 'Recio y terco, ve en la oscuridad. +2 CON.', ability_bonus: { con: 2 }, speed_ft: 25, darkvision: true, skills: [] },
  { id: 'halfling', name: 'Mediano', description: 'Pequeño, sigiloso, afortunado. +2 DES.', ability_bonus: { dex: 2 }, speed_ft: 25, darkvision: false, skills: [] },
  { id: 'gnome', name: 'Gnomo', description: 'Curioso e ingenioso, ve en la oscuridad. +2 INT.', ability_bonus: { int: 2 }, speed_ft: 25, darkvision: true, skills: [] },
  { id: 'half-elf', name: 'Semielfo', description: 'Entre dos mundos, ve en la oscuridad. +2 CAR, +1 DES, +1 CON.', ability_bonus: { cha: 2, dex: 1, con: 1 }, speed_ft: 30, darkvision: true, skills: [] },
  { id: 'half-orc', name: 'Semiorco', description: 'Fuerte y temido, ve en la oscuridad. +2 FUE, +1 CON; Intimidación.', ability_bonus: { str: 2, con: 1 }, speed_ft: 30, darkvision: true, skills: ['intimidation'] },
  { id: 'tiefling', name: 'Tiefling', description: 'Sangre infernal, ve en la oscuridad. +2 CAR, +1 INT.', ability_bonus: { cha: 2, int: 1 }, speed_ft: 30, darkvision: true, skills: [] },
  { id: 'dragonborn', name: 'Dracónido', description: 'Orgullo de dragón. +2 FUE, +1 CAR.', ability_bonus: { str: 2, cha: 1 }, speed_ft: 30, darkvision: false, skills: [] },
];

const PACK = [{ item_id: 'it_mochila', slot: 'back' as const }, { item_id: 'it_antorcha', quantity: 5, slot: 'pack' as const }, { item_id: 'it_racion', quantity: 5, slot: 'pack' as const }, { item_id: 'it_cuerda', slot: 'pack' as const }];

export const CLASSES: ClassDef[] = [
  { id: 'fighter', name: 'Guerrero', description: 'Maestro de armas y armaduras. d10.', hit_die: 10, saves: ['str', 'con'], skill_choices: { count: 2, from: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'], prefer: ['survival', 'acrobatics', 'perception', 'athletics'] }, background: 'soldier', recommended: [15, 13, 14, 8, 12, 10], equipment: [{ item_id: 'it_cota_malla', slot: 'body' }, { item_id: 'it_espada_larga', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, ...PACK] },
  { id: 'rogue', name: 'Pícaro', description: 'Sigilo, cerraduras y golpes certeros. d8.', hit_die: 8, saves: ['dex', 'int'], skill_choices: { count: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight_of_hand', 'stealth'], prefer: ['perception', 'sleight_of_hand', 'acrobatics', 'investigation', 'insight', 'athletics'] }, background: 'criminal', recommended: [8, 15, 13, 12, 10, 14], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_espada_corta', slot: 'hand_main' }, { item_id: 'it_daga', quantity: 2, slot: 'pocket' }, { item_id: 'it_ganzuas', slot: 'pocket' }, ...PACK] },
  { id: 'wizard', name: 'Mago', description: 'Estudio arcano. Frágil, poderoso. d6.', hit_die: 6, spellcasting: 'int', saves: ['int', 'wis'], skill_choices: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'], prefer: ['investigation', 'insight', 'arcana', 'history'] }, background: 'sage', recommended: [8, 14, 13, 15, 12, 10], equipment: [{ item_id: 'it_baston', slot: 'hand_main' }, { item_id: 'it_libro_conjuros', slot: 'pack' }, { item_id: 'it_bolsa_componentes', slot: 'pocket' }, ...PACK] },
  { id: 'cleric', name: 'Clérigo', description: 'Fe que cura y golpea. d8.', hit_die: 8, spellcasting: 'wis', saves: ['wis', 'cha'], skill_choices: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'], prefer: ['medicine', 'persuasion', 'history', 'insight'] }, background: 'acolyte', recommended: [14, 8, 13, 10, 15, 12], equipment: [{ item_id: 'it_cota_escamas', slot: 'body' }, { item_id: 'it_maza', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, { item_id: 'it_simbolo_sagrado', slot: 'pocket' }, ...PACK] },
  { id: 'ranger', name: 'Explorador', description: 'Rastreador de los lindes. d10.', hit_die: 10, spellcasting: 'wis', saves: ['str', 'dex'], skill_choices: { count: 3, from: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'], prefer: ['perception', 'stealth', 'nature', 'athletics', 'survival'] }, background: 'folk-hero', recommended: [12, 15, 13, 8, 14, 10], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_arco_corto', slot: 'hand_main' }, { item_id: 'it_flechas', quantity: 20, slot: 'pack' }, { item_id: 'it_espada_corta', slot: 'hand_off' }, ...PACK] },
  { id: 'barbarian', name: 'Bárbaro', description: 'Furia y aguante. d12.', hit_die: 12, saves: ['str', 'con'], skill_choices: { count: 2, from: ['animal_handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'], prefer: ['athletics', 'perception', 'intimidation', 'survival'] }, background: 'folk-hero', recommended: [15, 13, 14, 8, 12, 10], equipment: [{ item_id: 'it_gran_hacha', slot: 'hand_main' }, { item_id: 'it_hacha_mano', quantity: 2, slot: 'pack' }, ...PACK] },
  { id: 'bard', name: 'Bardo', description: 'Palabras que hieren y curan. d8.', hit_die: 8, spellcasting: 'cha', saves: ['dex', 'cha'], skill_choices: { count: 3, from: ['acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight_of_hand', 'stealth', 'survival'], prefer: ['performance', 'deception', 'insight', 'perception', 'persuasion'] }, background: 'noble', recommended: [8, 14, 13, 10, 12, 15], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_estoque', slot: 'hand_main' }, { item_id: 'it_laud', slot: 'pack' }, ...PACK] },
  { id: 'druid', name: 'Druida', description: 'Voz de lo salvaje. d8.', hit_die: 8, spellcasting: 'wis', saves: ['int', 'wis'], skill_choices: { count: 2, from: ['arcana', 'animal_handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'], prefer: ['nature', 'perception', 'medicine', 'insight'] }, background: 'folk-hero', recommended: [10, 14, 13, 12, 15, 8], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_baston', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, ...PACK] },
  { id: 'monk', name: 'Monje', description: 'Disciplina y puños. d8.', hit_die: 8, saves: ['str', 'dex'], skill_choices: { count: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'], prefer: ['acrobatics', 'stealth', 'athletics', 'insight'] }, background: 'acolyte', recommended: [12, 15, 13, 10, 14, 8], equipment: [{ item_id: 'it_baston', slot: 'hand_main' }, { item_id: 'it_daga', quantity: 2, slot: 'pocket' }, ...PACK] },
  { id: 'paladin', name: 'Paladín', description: 'Juramento y acero. d10.', hit_die: 10, spellcasting: 'cha', saves: ['wis', 'cha'], skill_choices: { count: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'], prefer: ['athletics', 'persuasion', 'medicine', 'intimidation'] }, background: 'acolyte', recommended: [15, 8, 13, 10, 12, 14], equipment: [{ item_id: 'it_cota_malla', slot: 'body' }, { item_id: 'it_espada_larga', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, { item_id: 'it_simbolo_sagrado', slot: 'pocket' }, ...PACK] },
  { id: 'sorcerer', name: 'Hechicero', description: 'Magia en la sangre. d6.', hit_die: 6, spellcasting: 'cha', saves: ['con', 'cha'], skill_choices: { count: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'], prefer: ['arcana', 'deception', 'insight', 'intimidation'] }, background: 'noble', recommended: [8, 14, 13, 12, 10, 15], equipment: [{ item_id: 'it_daga', quantity: 2, slot: 'pocket' }, { item_id: 'it_bolsa_componentes', slot: 'pocket' }, ...PACK] },
  { id: 'warlock', name: 'Brujo', description: 'Un pacto y su precio. d8.', hit_die: 8, spellcasting: 'cha', saves: ['wis', 'cha'], skill_choices: { count: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'], prefer: ['deception', 'intimidation', 'investigation', 'nature'] }, background: 'sage', recommended: [8, 14, 13, 12, 10, 15], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_daga', quantity: 2, slot: 'pocket' }, { item_id: 'it_bolsa_componentes', slot: 'pocket' }, ...PACK] },
];

export const BACKGROUNDS: BackgroundDef[] = [
  { id: 'acolyte', name: 'Acólito', description: 'Criado en un templo. Perspicacia, Religión.', skills: ['insight', 'religion'] },
  { id: 'criminal', name: 'Criminal', description: 'Sabes cómo se hacen las cosas fuera de la ley. Engaño, Sigilo.', skills: ['deception', 'stealth'] },
  { id: 'folk-hero', name: 'Héroe del pueblo', description: 'La gente sencilla te recuerda. Trato con animales, Supervivencia.', skills: ['animal_handling', 'survival'] },
  { id: 'noble', name: 'Noble', description: 'Nombre, tierras y deudas. Historia, Persuasión.', skills: ['history', 'persuasion'] },
  { id: 'sage', name: 'Erudito', description: 'Años entre libros. Arcanos, Historia.', skills: ['arcana', 'history'] },
  { id: 'soldier', name: 'Soldado', description: 'Has servido y has visto. Atletismo, Intimidación.', skills: ['athletics', 'intimidation'] },
];

export function raceById(id: string): RaceDef | undefined { return RACES.find((r) => r.id === id); }
export function classById(id: string): ClassDef | undefined { return CLASSES.find((c) => c.id === id); }
export function backgroundById(id: string): BackgroundDef | undefined { return BACKGROUNDS.find((b) => b.id === id); }
