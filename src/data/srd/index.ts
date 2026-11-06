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
  /** Tamaño (SRD): los pequeños atacan con desventaja con armas pesadas. */
  size: 'small' | 'medium';
  /** Competencias de raza: armas concretas (ids del catálogo) o categorías ('simple', 'martial'). */
  weapons?: string[];
  armor?: ArmorProficiency[];
}

/** Categorías de armadura que se saben llevar (SRD). */
export type ArmorProficiency = 'light' | 'medium' | 'heavy' | 'shield';

export interface ClassDef {
  id: string; name: string; description: string;
  hit_die: number;
  /** Característica con la que lanza conjuros (SRD); sin ella, la clase no los lanza. */
  spellcasting?: Ability;
  saves: Ability[];
  skill_choices: { count: number; from: string[]; /** Las que elige por defecto, por orden (saltando las que ya da el trasfondo). */ prefer: string[] };
  /** Trasfondo por defecto si la petición no trae ninguno; el asistente de la web lo marca como sugerido. */
  background: string;
  /** Array estándar recomendado, en orden STR DEX CON INT WIS CHA. */
  recommended: [number, number, number, number, number, number];
  /** Competencia con armas (SRD): 'simple', 'martial' o armas concretas por id del catálogo. */
  weapons: string[];
  /** Competencia con armaduras y escudo (SRD). */
  armor: ArmorProficiency[];
  /** Equipo inicial: ids del catálogo y dónde va. */
  equipment: StartingItem[];
}

/** Un objeto del equipo inicial y dónde va (`ring`: puesto en un dedo). */
export interface StartingItem { item_id: string; quantity?: number; slot: 'hand_main' | 'hand_off' | 'body' | 'back' | 'pack' | 'pocket' | 'ring' }

export interface BackgroundDef {
  id: string; name: string; description: string; skills: string[];
  /** La ropa que lleva puesta (src/data/srd/gear.ts): en el cuerpo, o en la mochila si la clase lleva armadura. */
  clothes: string;
  /** Lo que lleva por su trasfondo, además del equipo de la clase (gear.ts). La bolsa con el dinero va aparte (bloque D). */
  equipment: StartingItem[];
}

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const RACES: RaceDef[] = [
  { id: 'human', name: 'Humano', description: 'Adaptable y ambicioso. +1 a todo.', ability_bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed_ft: 30, darkvision: false, skills: [], size: 'medium' },
  { id: 'elf', name: 'Elfo', description: 'Grácil, longevo, ve en la oscuridad. +2 DES; Percepción.', ability_bonus: { dex: 2 }, speed_ft: 30, darkvision: true, skills: ['perception'], size: 'medium', weapons: ['it_espada_larga', 'it_espada_corta', 'it_arco_corto', 'it_arco_largo'] },
  { id: 'dwarf', name: 'Enano', description: 'Recio y terco, ve en la oscuridad. +2 CON.', ability_bonus: { con: 2 }, speed_ft: 25, darkvision: true, skills: [], size: 'medium', weapons: ['it_hacha_batalla', 'it_hacha_mano', 'it_martillo_ligero', 'it_martillo_guerra'] },
  { id: 'halfling', name: 'Mediano', description: 'Pequeño, sigiloso, afortunado. +2 DES.', ability_bonus: { dex: 2 }, speed_ft: 25, darkvision: false, skills: [], size: 'small' },
  { id: 'gnome', name: 'Gnomo', description: 'Curioso e ingenioso, ve en la oscuridad. +2 INT.', ability_bonus: { int: 2 }, speed_ft: 25, darkvision: true, skills: [], size: 'small' },
  { id: 'half-elf', name: 'Semielfo', description: 'Entre dos mundos, ve en la oscuridad. +2 CAR, +1 DES, +1 CON.', ability_bonus: { cha: 2, dex: 1, con: 1 }, speed_ft: 30, darkvision: true, skills: [], size: 'medium' },
  { id: 'half-orc', name: 'Semiorco', description: 'Fuerte y temido, ve en la oscuridad. +2 FUE, +1 CON; Intimidación.', ability_bonus: { str: 2, con: 1 }, speed_ft: 30, darkvision: true, skills: ['intimidation'], size: 'medium' },
  { id: 'tiefling', name: 'Tiefling', description: 'Sangre infernal, ve en la oscuridad. +2 CAR, +1 INT.', ability_bonus: { cha: 2, int: 1 }, speed_ft: 30, darkvision: true, skills: [], size: 'medium' },
  { id: 'dragonborn', name: 'Dracónido', description: 'Orgullo de dragón. +2 FUE, +1 CAR.', ability_bonus: { str: 2, cha: 1 }, speed_ft: 30, darkvision: false, skills: [], size: 'medium' },
];

const PACK = [{ item_id: 'it_mochila', slot: 'back' as const }, { item_id: 'it_antorcha', quantity: 5, slot: 'pack' as const }, { item_id: 'it_racion', quantity: 5, slot: 'pack' as const }, { item_id: 'it_cuerda', slot: 'pack' as const }];

export const CLASSES: ClassDef[] = [
  { id: 'fighter', name: 'Guerrero', description: 'Maestro de armas y armaduras. d10.', hit_die: 10, saves: ['str', 'con'], skill_choices: { count: 2, from: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'], prefer: ['survival', 'acrobatics', 'perception', 'athletics'] }, background: 'soldier', recommended: [15, 13, 14, 8, 12, 10], weapons: ['simple', 'martial'], armor: ['light', 'medium', 'heavy', 'shield'], equipment: [{ item_id: 'it_cota_malla', slot: 'body' }, { item_id: 'it_espada_larga', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, ...PACK] },
  { id: 'rogue', name: 'Pícaro', description: 'Sigilo, cerraduras y golpes certeros. d8.', hit_die: 8, saves: ['dex', 'int'], skill_choices: { count: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight_of_hand', 'stealth'], prefer: ['perception', 'sleight_of_hand', 'acrobatics', 'investigation', 'insight', 'athletics'] }, background: 'criminal', recommended: [8, 15, 13, 12, 10, 14], weapons: ['simple', 'it_ballesta_mano', 'it_espada_larga', 'it_estoque', 'it_espada_corta'], armor: ['light'], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_espada_corta', slot: 'hand_main' }, { item_id: 'it_daga', quantity: 2, slot: 'pocket' }, { item_id: 'it_ganzuas', slot: 'pocket' }, ...PACK] },
  { id: 'wizard', name: 'Mago', description: 'Estudio arcano. Frágil, poderoso. d6.', hit_die: 6, spellcasting: 'int', saves: ['int', 'wis'], skill_choices: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'], prefer: ['investigation', 'insight', 'arcana', 'history'] }, background: 'sage', recommended: [8, 14, 13, 15, 12, 10], weapons: ['it_daga', 'it_dardo', 'it_honda', 'it_baston', 'it_ballesta_ligera'], armor: [], equipment: [{ item_id: 'it_baston', slot: 'hand_main' }, { item_id: 'it_libro_conjuros', slot: 'pack' }, { item_id: 'it_bolsa_componentes', slot: 'pocket' }, ...PACK] },
  { id: 'cleric', name: 'Clérigo', description: 'Fe que cura y golpea. d8.', hit_die: 8, spellcasting: 'wis', saves: ['wis', 'cha'], skill_choices: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'], prefer: ['medicine', 'persuasion', 'history', 'insight'] }, background: 'acolyte', recommended: [14, 8, 13, 10, 15, 12], weapons: ['simple'], armor: ['light', 'medium', 'shield'], equipment: [{ item_id: 'it_cota_escamas', slot: 'body' }, { item_id: 'it_maza', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, { item_id: 'it_simbolo_sagrado', slot: 'pocket' }, ...PACK] },
  { id: 'ranger', name: 'Explorador', description: 'Rastreador de los lindes. d10.', hit_die: 10, spellcasting: 'wis', saves: ['str', 'dex'], skill_choices: { count: 3, from: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'], prefer: ['perception', 'stealth', 'nature', 'athletics', 'survival'] }, background: 'folk-hero', recommended: [12, 15, 13, 8, 14, 10], weapons: ['simple', 'martial'], armor: ['light', 'medium', 'shield'], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_arco_corto', slot: 'hand_main' }, { item_id: 'it_flechas', quantity: 20, slot: 'pack' }, { item_id: 'it_espada_corta', slot: 'hand_off' }, ...PACK] },
  { id: 'barbarian', name: 'Bárbaro', description: 'Furia y aguante. d12.', hit_die: 12, saves: ['str', 'con'], skill_choices: { count: 2, from: ['animal_handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'], prefer: ['athletics', 'perception', 'intimidation', 'survival'] }, background: 'folk-hero', recommended: [15, 13, 14, 8, 12, 10], weapons: ['simple', 'martial'], armor: ['light', 'medium', 'shield'], equipment: [{ item_id: 'it_gran_hacha', slot: 'hand_main' }, { item_id: 'it_hacha_mano', quantity: 2, slot: 'pack' }, ...PACK] },
  { id: 'bard', name: 'Bardo', description: 'Palabras que hieren y curan. d8.', hit_die: 8, spellcasting: 'cha', saves: ['dex', 'cha'], skill_choices: { count: 3, from: ['acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight_of_hand', 'stealth', 'survival'], prefer: ['performance', 'deception', 'insight', 'perception', 'persuasion'] }, background: 'noble', recommended: [8, 14, 13, 10, 12, 15], weapons: ['simple', 'it_ballesta_mano', 'it_espada_larga', 'it_estoque', 'it_espada_corta'], armor: ['light'], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_estoque', slot: 'hand_main' }, { item_id: 'it_laud', slot: 'pack' }, ...PACK] },
  { id: 'druid', name: 'Druida', description: 'Voz de lo salvaje. d8.', hit_die: 8, spellcasting: 'wis', saves: ['int', 'wis'], skill_choices: { count: 2, from: ['arcana', 'animal_handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'], prefer: ['nature', 'perception', 'medicine', 'insight'] }, background: 'folk-hero', recommended: [10, 14, 13, 12, 15, 8], weapons: ['it_garrote', 'it_daga', 'it_dardo', 'it_jabalina', 'it_maza', 'it_baston', 'it_cimitarra', 'it_hoz', 'it_honda', 'it_lanza'], armor: ['light', 'medium', 'shield'], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_baston', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, ...PACK] },
  { id: 'monk', name: 'Monje', description: 'Disciplina y puños. d8.', hit_die: 8, saves: ['str', 'dex'], skill_choices: { count: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'], prefer: ['acrobatics', 'stealth', 'athletics', 'insight'] }, background: 'acolyte', recommended: [12, 15, 13, 10, 14, 8], weapons: ['simple', 'it_espada_corta'], armor: [], equipment: [{ item_id: 'it_baston', slot: 'hand_main' }, { item_id: 'it_daga', quantity: 2, slot: 'pocket' }, ...PACK] },
  { id: 'paladin', name: 'Paladín', description: 'Juramento y acero. d10.', hit_die: 10, spellcasting: 'cha', saves: ['wis', 'cha'], skill_choices: { count: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'], prefer: ['athletics', 'persuasion', 'medicine', 'intimidation'] }, background: 'acolyte', recommended: [15, 8, 13, 10, 12, 14], weapons: ['simple', 'martial'], armor: ['light', 'medium', 'heavy', 'shield'], equipment: [{ item_id: 'it_cota_malla', slot: 'body' }, { item_id: 'it_espada_larga', slot: 'hand_main' }, { item_id: 'it_escudo', slot: 'hand_off' }, { item_id: 'it_simbolo_sagrado', slot: 'pocket' }, ...PACK] },
  { id: 'sorcerer', name: 'Hechicero', description: 'Magia en la sangre. d6.', hit_die: 6, spellcasting: 'cha', saves: ['con', 'cha'], skill_choices: { count: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'], prefer: ['arcana', 'deception', 'insight', 'intimidation'] }, background: 'noble', recommended: [8, 14, 13, 12, 10, 15], weapons: ['it_daga', 'it_dardo', 'it_honda', 'it_baston', 'it_ballesta_ligera'], armor: [], equipment: [{ item_id: 'it_daga', quantity: 2, slot: 'pocket' }, { item_id: 'it_bolsa_componentes', slot: 'pocket' }, ...PACK] },
  { id: 'warlock', name: 'Brujo', description: 'Un pacto y su precio. d8.', hit_die: 8, spellcasting: 'cha', saves: ['wis', 'cha'], skill_choices: { count: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'], prefer: ['deception', 'intimidation', 'investigation', 'nature'] }, background: 'sage', recommended: [8, 14, 13, 12, 10, 15], weapons: ['simple'], armor: ['light'], equipment: [{ item_id: 'it_armadura_cuero', slot: 'body' }, { item_id: 'it_daga', quantity: 2, slot: 'pocket' }, { item_id: 'it_bolsa_componentes', slot: 'pocket' }, ...PACK] },
];

export const BACKGROUNDS: BackgroundDef[] = [
  { id: 'acolyte', name: 'Acólito', description: 'Criado en un templo. Perspicacia, Religión.', skills: ['insight', 'religion'],
    clothes: 'it_ropa_viaje', equipment: [{ item_id: 'it_simbolo_sagrado', slot: 'pocket' }, { item_id: 'it_libro_oraciones', slot: 'pack' }, { item_id: 'it_incienso', quantity: 5, slot: 'pack' }, { item_id: 'it_vestiduras', slot: 'pack' }] },
  { id: 'criminal', name: 'Criminal', description: 'Sabes cómo se hacen las cosas fuera de la ley. Engaño, Sigilo.', skills: ['deception', 'stealth'],
    clothes: 'it_ropa_oscura', equipment: [{ item_id: 'it_palanca', slot: 'pack' }] },
  { id: 'folk-hero', name: 'Héroe del pueblo', description: 'La gente sencilla te recuerda. Trato con animales, Supervivencia.', skills: ['animal_handling', 'survival'],
    clothes: 'it_ropa_viaje', equipment: [{ item_id: 'it_herramientas_carpintero', slot: 'pack' }, { item_id: 'it_pala', slot: 'pack' }, { item_id: 'it_olla_hierro', slot: 'pack' }] },
  { id: 'noble', name: 'Noble', description: 'Nombre, tierras y deudas. Historia, Persuasión.', skills: ['history', 'persuasion'],
    clothes: 'it_ropa_fina', equipment: [{ item_id: 'it_anillo_sello_pj', slot: 'ring' }, { item_id: 'it_pergamino_linaje', slot: 'pack' }] },
  { id: 'sage', name: 'Erudito', description: 'Años entre libros. Arcanos, Historia.', skills: ['arcana', 'history'],
    clothes: 'it_ropa_viaje', equipment: [{ item_id: 'it_tinta', slot: 'pack' }, { item_id: 'it_pluma', slot: 'pack' }, { item_id: 'it_cuchillo_pequeno', slot: 'pocket' }, { item_id: 'it_carta_colega', slot: 'pack' }] },
  { id: 'soldier', name: 'Soldado', description: 'Has servido y has visto. Atletismo, Intimidación.', skills: ['athletics', 'intimidation'],
    clothes: 'it_ropa_viaje', equipment: [{ item_id: 'it_insignia', slot: 'pocket' }, { item_id: 'it_trofeo', slot: 'pack' }, { item_id: 'it_dados', slot: 'pocket' }] },
];

/**
 * Pergamino de conjuro (SRD): CD de salvación y bonificador de ataque por el
 * nivel del conjuro (índice 0 = truco).
 */
export const SCROLL_TABLE: readonly { save_dc: number; attack: number }[] = [
  { save_dc: 13, attack: 5 }, { save_dc: 13, attack: 5 }, { save_dc: 13, attack: 5 }, { save_dc: 15, attack: 7 }, { save_dc: 15, attack: 7 },
  { save_dc: 17, attack: 9 }, { save_dc: 17, attack: 9 }, { save_dc: 18, attack: 10 }, { save_dc: 18, attack: 10 }, { save_dc: 19, attack: 11 },
];

export function raceById(id: string): RaceDef | undefined { return RACES.find((r) => r.id === id); }
export function classById(id: string): ClassDef | undefined { return CLASSES.find((c) => c.id === id); }
export function backgroundById(id: string): BackgroundDef | undefined { return BACKGROUNDS.find((b) => b.id === id); }
