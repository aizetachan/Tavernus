/**
 * Progresión SRD 5.1 por clase: experiencia por nivel, rasgos, elecciones,
 * recursos que se gastan y conjuros. Todo lo que el motor (src/engine/levels.ts)
 * da a un PJ al crearlo o al subir de nivel sale de aquí; el motor no sabe nada
 * de ninguna clase en concreto.
 *
 * Cada clase lleva su subclase del SRD (la única que trae): Campeón, Ladrón,
 * Evocación, Vida, Berserker, Conocimiento, Tierra, Mano Abierta, Devoción,
 * Cazador, Linaje dracónico e Infernal. Los rasgos llegan hasta nivel 5; más
 * allá, el PJ sigue ganando PG, espacios, conjuros y mejoras de característica.
 *
 * Las tablas por nivel son listas de 20 (índice = nivel − 1); `byLevel` las
 * escribe por tramos: `byLevel([[1, 'd6'], [5, 'd8']])`.
 */

import type { Ability } from '../../engine/rules.js';
import type { SpellClass } from './spells.js';

/** PX acumulados para llegar a cada nivel (SRD). */
export const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
export const MAX_LEVEL = XP_THRESHOLDS.length;

/** Tabla de 20 niveles por tramos: cada valor vale desde su nivel hasta el siguiente tramo. */
export function byLevel<T>(steps: [number, T][]): T[] {
  return Array.from({ length: MAX_LEVEL }, (_, i) => {
    let v = steps[0]![1];
    for (const [lvl, x] of steps) if (i + 1 >= lvl) v = x;
    return v;
  });
}

/** Efectos de reglas que el motor aplica (CA, PG, velocidad, curación, ataques). Lo demás lo aplica el máster leyendo el texto. */
export interface FeatureEffect {
  /** Sin armadura: CA = base + DES + estas características (escudo aparte). */
  unarmored_ac?: { base: number; add: Ability[] };
  /** PG máximos extra por nivel (Resiliencia dracónica). */
  hp_per_level?: number;
  /** Pies de velocidad extra sin armadura pesada. */
  speed_ft?: number;
  /** Los conjuros de curación curan 2 + el nivel del conjuro más (Discípulo de la vida). */
  heal_bonus?: boolean;
  /** +1 a la CA con armadura (estilo Defensa). */
  armored_ac?: number;
  /** Bonificador a los ataques a distancia con arma (estilo Tiro con arco). */
  ranged_attack?: number;
}

export interface FeatureDef {
  id: string;
  level: number;
  name: string;
  /** Qué hace, en una o dos frases; `{clave}` se sustituye por `values[clave]` a su nivel. */
  text: string;
  values?: Record<string, (string | number)[]>;
  /** Recurso que gasta (clave de `resources`): la hoja enseña cuántos usos quedan. */
  resource?: string;
  effects?: FeatureEffect;
}

export interface OptionDef { id: string; name: string; text: string; effects?: FeatureEffect }

/**
 * Elección del jugador al llegar a un nivel. `asi`: mejora de característica
 * (+2 a una o +1 a dos, hasta 20), definitiva. Las demás traen un valor por
 * defecto que el motor aplica ya y se pueden cambiar en la Hoja.
 */
export interface ChoiceDef {
  key: string;
  level: number;
  kind: 'asi' | 'expertise' | 'option';
  name: string;
  text: string;
  count: number;
  /** `option`: entre qué se elige. `expertise`: de las habilidades con competencia. */
  options?: OptionDef[];
  /** Preferencia para el valor por defecto (las que no valgan se saltan). */
  prefer?: string[];
}

/** Recurso que se gasta (spend_resource) y vuelve al descansar. `max`: por nivel, el nivel, o un modificador. */
export interface ResourceDef {
  key: string;
  label: string;
  from: number;
  recharge: 'short' | 'long';
  /** Desde este nivel vuelve con descanso corto (Inspiración bárdica a nivel 5). */
  short_from?: number;
  max: number[] | { times_level: number } | { ability: Ability; plus?: number };
}

/**
 * Cómo lanza conjuros la clase. `prepared`: prepara cada día de toda su lista
 * (clérigo, druida, paladín); `known`: aprende unos fijos (bardo, hechicero,
 * brujo, explorador); `book`: libro de conjuros y prepara de él (mago).
 */
export interface CasterDef {
  ability: Ability;
  list: SpellClass;
  slots: 'full' | 'half' | 'pact';
  mode: 'prepared' | 'known' | 'book';
  /** Nivel desde el que lanza (paladín y explorador, 2). */
  from: number;
  cantrips?: number[];
  known?: number[];
  /** Preparados: modificador + nivel (`full`) o + medio nivel (`half`); mínimo 1. */
  prepared?: 'full' | 'half';
  book?: { start: number; per_level: number };
  /** Siempre preparados y sin contar (dominio, juramento), desde su nivel. */
  always?: { level: number; spells: string[] }[];
  /** Conjuros que se suman a su lista (patrón del brujo). */
  extra?: string[];
  /** Orden en que el motor elige por defecto: trucos y conjuros. */
  pick_cantrips: string[];
  pick_spells: string[];
}

export interface ClassProgression {
  features: FeatureDef[];
  choices: ChoiceDef[];
  resources: ResourceDef[];
  /** Niveles con mejora de característica. */
  asi: number[];
  caster?: CasterDef;
}

/** Espacios por nivel de PJ: lanzador completo y medio lanzador (índice = nivel de PJ − 1). */
export const FULL_CASTER_SLOTS = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
export const HALF_CASTER_SLOTS = [[], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2]];
/** Brujo: cuántos espacios de pacto y de qué nivel. */
export const PACT_SLOTS = byLevel([[1, 1], [2, 2], [11, 3], [17, 4]]);
export const PACT_SLOT_LEVEL = byLevel([[1, 1], [3, 2], [5, 3], [7, 4], [9, 5]]);

const STANDARD_ASI = [4, 8, 12, 16, 19];

const FIGHTING_STYLES: OptionDef[] = [
  { id: 'defense', name: 'Defensa', text: '+1 a la CA mientras llevas armadura.', effects: { armored_ac: 1 } },
  { id: 'archery', name: 'Tiro con arco', text: '+2 a los ataques con armas a distancia.', effects: { ranged_attack: 2 } },
  { id: 'dueling', name: 'Duelo', text: '+2 al daño con un arma cuerpo a cuerpo a una mano y nada en la otra.' },
  { id: 'great_weapon', name: 'Arma a dos manos', text: 'Con un arma a dos manos, repites los 1 y 2 de los dados de daño.' },
  { id: 'protection', name: 'Protección', text: 'Con escudo, tu reacción impone desventaja a un ataque contra un aliado a tu lado.' },
  { id: 'two_weapon', name: 'Combate con dos armas', text: 'Sumas tu modificador al daño del ataque con la segunda arma.' },
];
const style = (level: number, ids: string[], prefer: string): ChoiceDef => ({
  key: 'fighting_style', level, kind: 'option', name: 'Estilo de combate', text: 'Una forma de luchar que dominas.', count: 1,
  options: FIGHTING_STYLES.filter((o) => ids.includes(o.id)), prefer: [prefer],
});
const expertise = (key: string, level: number, prefer: string[]): ChoiceDef => ({
  key, level, kind: 'expertise', name: 'Pericia', text: 'Dos habilidades con competencia en las que duplicas tu bonificador.', count: 2, prefer,
});
const ALL_SLOT_RECOVERY = 'Una vez al día, en un descanso corto, recuperas espacios de conjuro gastados que sumen hasta la mitad de tu nivel (redondeando arriba), ninguno de nivel 6 o más.';

export const PROGRESSION: Record<string, ClassProgression> = {
  fighter: {
    asi: [4, 6, 8, 12, 14, 16, 19],
    resources: [
      { key: 'second_wind', label: 'Tomar aliento', from: 1, recharge: 'short', max: byLevel([[1, 1]]) },
      { key: 'action_surge', label: 'Oleada de acción', from: 2, recharge: 'short', max: byLevel([[1, 1], [17, 2]]) },
    ],
    choices: [style(1, ['defense', 'archery', 'dueling', 'great_weapon', 'protection', 'two_weapon'], 'defense')],
    features: [
      { id: 'second_wind', level: 1, name: 'Tomar aliento', text: 'Con una acción adicional recuperas 1d10 + tu nivel en PG.', resource: 'second_wind' },
      { id: 'action_surge', level: 2, name: 'Oleada de acción', text: 'En tu turno, una acción más.', resource: 'action_surge' },
      { id: 'improved_critical', level: 3, name: 'Crítico mejorado (Campeón)', text: 'Tus ataques con arma son críticos con 19 o 20.' },
      { id: 'extra_attack', level: 5, name: 'Ataque adicional', text: 'Cuando atacas con tu acción, atacas dos veces.' },
    ],
  },
  rogue: {
    asi: [4, 8, 10, 12, 16, 19],
    resources: [],
    choices: [expertise('expertise', 1, ['stealth', 'perception', 'sleight_of_hand', 'investigation', 'deception', 'acrobatics']), expertise('expertise_6', 6, ['perception', 'investigation', 'deception', 'persuasion', 'acrobatics', 'athletics'])],
    features: [
      { id: 'sneak_attack', level: 1, name: 'Ataque furtivo', text: 'Una vez por turno, {dado} de daño extra al acertar con un arma sutil o a distancia si tienes ventaja o un aliado junto al objetivo.', values: { dado: byLevel([[1, '1d6'], [3, '2d6'], [5, '3d6'], [7, '4d6'], [9, '5d6'], [11, '6d6'], [13, '7d6'], [15, '8d6'], [17, '9d6'], [19, '10d6']]) } },
      { id: 'thieves_cant', level: 1, name: 'Jerga de ladrones', text: 'Señales y palabras en clave que solo entienden los del oficio.' },
      { id: 'cunning_action', level: 2, name: 'Acción astuta', text: 'Correr, retirarte o esconderte con una acción adicional.' },
      { id: 'fast_hands', level: 3, name: 'Manos rápidas (Ladrón)', text: 'Con la acción adicional de Acción astuta: juego de manos, abrir cerraduras, desarmar trampas o usar un objeto.' },
      { id: 'second_story_work', level: 3, name: 'Trepador (Ladrón)', text: 'Trepas sin coste extra y saltas más lejos.' },
      { id: 'uncanny_dodge', level: 5, name: 'Esquiva asombrosa', text: 'Con tu reacción, un ataque que te da hace la mitad de daño.' },
    ],
  },
  wizard: {
    asi: STANDARD_ASI,
    resources: [{ key: 'arcane_recovery', label: 'Recuperación arcana', from: 1, recharge: 'long', max: byLevel([[1, 1]]) }],
    choices: [],
    caster: {
      ability: 'int', list: 'wizard', slots: 'full', mode: 'book', from: 1,
      cantrips: byLevel([[1, 3], [4, 4], [10, 5]]), prepared: 'full', book: { start: 6, per_level: 2 },
      pick_cantrips: ['fire_bolt', 'mage_hand', 'light', 'ray_of_frost', 'prestidigitation', 'minor_illusion', 'shocking_grasp'],
      pick_spells: ['magic_missile', 'shield', 'sleep', 'mage_armor', 'burning_hands', 'detect_magic', 'thunderwave', 'find_familiar', 'misty_step', 'scorching_ray', 'invisibility', 'web', 'hold_person', 'blur', 'fireball', 'counterspell', 'lightning_bolt', 'haste', 'fly', 'dispel_magic', 'identify', 'feather_fall', 'comprehend_languages'],
    },
    features: [
      { id: 'spellcasting', level: 1, name: 'Lanzamiento de conjuros', text: 'Lanzas con INT. Tu libro guarda tus conjuros; cada día preparas unos cuantos y puedes lanzar como ritual los de tu libro que lo permitan.' },
      { id: 'arcane_recovery', level: 1, name: 'Recuperación arcana', text: ALL_SLOT_RECOVERY, resource: 'arcane_recovery' },
      { id: 'evocation_savant', level: 2, name: 'Erudito en evocación (Evocación)', text: 'Copiar conjuros de evocación en tu libro te cuesta la mitad de oro y tiempo.' },
      { id: 'sculpt_spells', level: 2, name: 'Esculpir conjuros (Evocación)', text: 'Tus conjuros de evocación de área no dañan a 1 + nivel del conjuro aliados que elijas.' },
    ],
  },
  cleric: {
    asi: STANDARD_ASI,
    resources: [{ key: 'channel_divinity', label: 'Canalizar divinidad', from: 2, recharge: 'short', max: byLevel([[1, 1], [6, 2], [18, 3]]) }],
    choices: [],
    caster: {
      ability: 'wis', list: 'cleric', slots: 'full', mode: 'prepared', from: 1,
      cantrips: byLevel([[1, 3], [4, 4], [10, 5]]), prepared: 'full',
      always: [{ level: 1, spells: ['bless', 'cure_wounds'] }, { level: 3, spells: ['lesser_restoration', 'spiritual_weapon'] }, { level: 5, spells: ['beacon_of_hope', 'revivify'] }],
      pick_cantrips: ['sacred_flame', 'guidance', 'light', 'spare_the_dying', 'thaumaturgy', 'mending'],
      pick_spells: ['healing_word', 'guiding_bolt', 'shield_of_faith', 'sanctuary', 'command', 'detect_magic', 'inflict_wounds', 'aid', 'prayer_of_healing', 'hold_person', 'silence', 'mass_healing_word', 'spirit_guardians', 'dispel_magic', 'protection_from_evil_and_good'],
    },
    features: [
      { id: 'spellcasting', level: 1, name: 'Lanzamiento de conjuros', text: 'Lanzas con SAB. Cada día preparas conjuros de toda la lista de clérigo; los de tu dominio van siempre preparados.' },
      { id: 'life_domain', level: 1, name: 'Dominio de la Vida', text: 'Competencia con armadura pesada. Conjuros de dominio siempre preparados: Bendecir y Curar heridas (más a niveles 3 y 5).' },
      { id: 'disciple_of_life', level: 1, name: 'Discípulo de la vida', text: 'Tus conjuros de curación curan 2 + el nivel del conjuro más.', effects: { heal_bonus: true } },
      { id: 'channel_divinity', level: 2, name: 'Canalizar divinidad', text: 'Expulsar muertos vivientes (salvación de SAB o huyen un minuto) o Preservar la vida: repartes {pg} PG entre criaturas a 9 m, sin pasar de la mitad de sus PG máximos.', values: { pg: byLevel(Array.from({ length: 20 }, (_, i) => [i + 1, 5 * (i + 1)] as [number, number])) }, resource: 'channel_divinity' },
      { id: 'destroy_undead', level: 5, name: 'Destruir muertos vivientes', text: 'Los muertos vivientes de VD 1/2 o menos que expulsas quedan destruidos.' },
    ],
  },
  barbarian: {
    asi: STANDARD_ASI,
    resources: [{ key: 'rage', label: 'Furia', from: 1, recharge: 'long', max: byLevel([[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]) }],
    choices: [],
    features: [
      { id: 'rage', level: 1, name: 'Furia', text: 'Con una acción adicional, un minuto: ventaja en FUE, +{dano} al daño cuerpo a cuerpo y resistencia a daño contundente, cortante y perforante.', values: { dano: byLevel([[1, 2], [9, 3], [16, 4]]) }, resource: 'rage' },
      { id: 'unarmored_defense', level: 1, name: 'Defensa sin armadura', text: 'Sin armadura, tu CA es 10 + DES + CON (el escudo suma).', effects: { unarmored_ac: { base: 10, add: ['con'] } } },
      { id: 'reckless_attack', level: 2, name: 'Ataque temerario', text: 'Atacas con ventaja en FUE este turno, pero te atacan con ventaja hasta el siguiente.' },
      { id: 'danger_sense', level: 2, name: 'Sentido del peligro', text: 'Ventaja en salvaciones de DES contra lo que ves venir (trampas, conjuros).' },
      { id: 'frenzy', level: 3, name: 'Frenesí (Berserker)', text: 'En furia puedes atacar otra vez con una acción adicional; al acabar, un nivel de agotamiento.' },
      { id: 'extra_attack', level: 5, name: 'Ataque adicional', text: 'Cuando atacas con tu acción, atacas dos veces.' },
      { id: 'fast_movement', level: 5, name: 'Movimiento rápido', text: '+3 m de velocidad sin armadura pesada.', effects: { speed_ft: 10 } },
    ],
  },
  bard: {
    asi: STANDARD_ASI,
    resources: [{ key: 'bardic_inspiration', label: 'Inspiración bárdica', from: 1, recharge: 'long', short_from: 5, max: { ability: 'cha' } }],
    choices: [expertise('expertise', 3, ['persuasion', 'deception', 'performance', 'insight', 'perception', 'stealth']), expertise('expertise_10', 10, ['perception', 'insight', 'stealth', 'investigation', 'history', 'arcana'])],
    caster: {
      ability: 'cha', list: 'bard', slots: 'full', mode: 'known', from: 1,
      cantrips: byLevel([[1, 2], [4, 3], [10, 4]]), known: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
      pick_cantrips: ['vicious_mockery', 'minor_illusion', 'mage_hand', 'light', 'prestidigitation'],
      pick_spells: ['healing_word', 'charm_person', 'faerie_fire', 'sleep', 'thunderwave', 'heroism', 'cure_wounds', 'disguise_self', 'suggestion', 'invisibility', 'hold_person', 'shatter', 'lesser_restoration', 'hypnotic_pattern', 'dispel_magic', 'tongues', 'stinking_cloud'],
    },
    features: [
      { id: 'spellcasting', level: 1, name: 'Lanzamiento de conjuros', text: 'Lanzas con CAR los conjuros que conoces; con instrumento como foco.' },
      { id: 'bardic_inspiration', level: 1, name: 'Inspiración bárdica', text: 'Con una acción adicional, un aliado gana un {dado} que suma a una prueba, ataque o salvación en los próximos diez minutos.', values: { dado: byLevel([[1, 'd6'], [5, 'd8'], [10, 'd10'], [15, 'd12']]) }, resource: 'bardic_inspiration' },
      { id: 'jack_of_all_trades', level: 2, name: 'Polivalente', text: 'Sumas la mitad de tu bonificador de competencia a las pruebas en las que no eres competente.' },
      { id: 'song_of_rest', level: 2, name: 'Canción de descanso', text: 'En un descanso corto, quien gaste dados de golpe cura {dado} más.', values: { dado: byLevel([[1, 'd6'], [9, 'd8'], [13, 'd10'], [17, 'd12']]) } },
      { id: 'cutting_words', level: 3, name: 'Palabras cortantes (Conocimiento)', text: 'Con tu reacción, gastas una Inspiración y restas el dado al ataque, prueba o daño de un enemigo.', resource: 'bardic_inspiration' },
      { id: 'font_of_inspiration', level: 5, name: 'Fuente de inspiración', text: 'La Inspiración bárdica vuelve también con un descanso corto.' },
    ],
  },
  druid: {
    asi: STANDARD_ASI,
    resources: [{ key: 'wild_shape', label: 'Forma salvaje', from: 2, recharge: 'short', max: byLevel([[1, 2]]) }, { key: 'natural_recovery', label: 'Recuperación natural', from: 2, recharge: 'long', max: byLevel([[1, 1]]) }],
    choices: [],
    caster: {
      ability: 'wis', list: 'druid', slots: 'full', mode: 'prepared', from: 1,
      // Círculo de la Tierra: un truco más desde nivel 2.
      cantrips: byLevel([[1, 2], [2, 3], [4, 4], [10, 5]]), prepared: 'full',
      pick_cantrips: ['produce_flame', 'guidance', 'shillelagh', 'druidcraft', 'poison_spray', 'resistance'],
      pick_spells: ['cure_wounds', 'healing_word', 'entangle', 'goodberry', 'faerie_fire', 'thunderwave', 'fog_cloud', 'speak_with_animals', 'moonbeam', 'pass_without_trace', 'lesser_restoration', 'flaming_sphere', 'heat_metal', 'call_lightning', 'conjure_animals', 'dispel_magic', 'plant_growth'],
    },
    features: [
      { id: 'druidic', level: 1, name: 'Druídico', text: 'El idioma secreto de los druidas y sus señales ocultas.' },
      { id: 'spellcasting', level: 1, name: 'Lanzamiento de conjuros', text: 'Lanzas con SAB. Cada día preparas conjuros de toda la lista de druida.' },
      { id: 'wild_shape', level: 2, name: 'Forma salvaje', text: 'Con una acción te conviertes en una bestia que hayas visto (VD {vd}) durante horas.', values: { vd: byLevel([[1, '1/4, sin volar ni nadar'], [4, '1/2, sin volar'], [8, '1']]) }, resource: 'wild_shape' },
      { id: 'natural_recovery', level: 2, name: 'Recuperación natural (Tierra)', text: ALL_SLOT_RECOVERY, resource: 'natural_recovery' },
    ],
  },
  monk: {
    asi: STANDARD_ASI,
    resources: [{ key: 'ki', label: 'Puntos de ki', from: 2, recharge: 'short', max: { times_level: 1 } }],
    choices: [],
    features: [
      { id: 'unarmored_defense', level: 1, name: 'Defensa sin armadura', text: 'Sin armadura ni escudo, tu CA es 10 + DES + SAB.', effects: { unarmored_ac: { base: 10, add: ['wis'] } } },
      { id: 'martial_arts', level: 1, name: 'Artes marciales', text: 'Sin armadura, tus golpes y armas de monje usan DES y hacen {dado}; tras atacar, un golpe sin armas con acción adicional.', values: { dado: byLevel([[1, '1d4'], [5, '1d6'], [11, '1d8'], [17, '1d10']]) } },
      { id: 'ki', level: 2, name: 'Ki', text: 'Ráfaga de golpes (dos golpes más), Defensa paciente (esquivar) o Paso del viento (correr o retirarte), cada uno por 1 ki con acción adicional.', resource: 'ki' },
      { id: 'unarmored_movement', level: 2, name: 'Movimiento sin armadura', text: '+3 m de velocidad sin armadura ni escudo.', effects: { speed_ft: 10 } },
      { id: 'open_hand', level: 3, name: 'Técnica de la mano abierta', text: 'Los golpes de tu Ráfaga pueden derribar, empujar 4,5 m o impedir reacciones.' },
      { id: 'deflect_missiles', level: 3, name: 'Desviar proyectiles', text: 'Con tu reacción reduces el daño de un proyectil y, si llega a 0, lo atrapas.' },
      { id: 'slow_fall', level: 4, name: 'Caída lenta', text: 'Con tu reacción, una caída te hace mucho menos daño.' },
      { id: 'extra_attack', level: 5, name: 'Ataque adicional', text: 'Cuando atacas con tu acción, atacas dos veces.' },
      { id: 'stunning_strike', level: 5, name: 'Golpe aturdidor', text: 'Al acertar, 1 ki: salvación de CON o queda aturdido hasta tu próximo turno.', resource: 'ki' },
    ],
  },
  paladin: {
    asi: STANDARD_ASI,
    resources: [
      { key: 'lay_on_hands', label: 'Imposición de manos (PG)', from: 1, recharge: 'long', max: { times_level: 5 } },
      { key: 'divine_sense', label: 'Sentido divino', from: 1, recharge: 'long', max: { ability: 'cha', plus: 1 } },
      { key: 'channel_divinity', label: 'Canalizar divinidad', from: 3, recharge: 'short', max: byLevel([[1, 1]]) },
    ],
    choices: [style(2, ['defense', 'dueling', 'great_weapon', 'protection'], 'defense')],
    caster: {
      ability: 'cha', list: 'paladin', slots: 'half', mode: 'prepared', from: 2, prepared: 'half',
      always: [{ level: 3, spells: ['protection_from_evil_and_good', 'sanctuary'] }, { level: 5, spells: ['lesser_restoration', 'zone_of_truth'] }],
      pick_cantrips: [],
      pick_spells: ['bless', 'shield_of_faith', 'cure_wounds', 'divine_favor', 'command', 'heroism', 'aid', 'locate_object', 'crusaders_mantle', 'revivify'],
    },
    features: [
      { id: 'divine_sense', level: 1, name: 'Sentido divino', text: 'Con una acción, notas celestiales, infernales y muertos vivientes a 18 m.', resource: 'divine_sense' },
      { id: 'lay_on_hands', level: 1, name: 'Imposición de manos', text: 'Una reserva de PG que repartes al tocar (o 5 para curar una enfermedad o veneno).', resource: 'lay_on_hands' },
      { id: 'spellcasting', level: 2, name: 'Lanzamiento de conjuros', text: 'Lanzas con CAR. Cada día preparas conjuros de la lista de paladín.' },
      { id: 'divine_smite', level: 2, name: 'Castigo divino', text: 'Al acertar con un arma cuerpo a cuerpo, gastas un espacio: 2d8 radiante (+1d8 por nivel de espacio).' },
      { id: 'divine_health', level: 3, name: 'Salud divina', text: 'Las enfermedades no te afectan.' },
      { id: 'devotion', level: 3, name: 'Juramento de Devoción', text: 'Canalizar divinidad: Arma sagrada (+CAR a los ataques un minuto) o Expulsar a los impíos.', resource: 'channel_divinity' },
      { id: 'extra_attack', level: 5, name: 'Ataque adicional', text: 'Cuando atacas con tu acción, atacas dos veces.' },
    ],
  },
  ranger: {
    asi: STANDARD_ASI,
    resources: [],
    choices: [style(2, ['archery', 'defense', 'dueling', 'two_weapon'], 'archery')],
    caster: {
      ability: 'wis', list: 'ranger', slots: 'half', mode: 'known', from: 2,
      known: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
      pick_cantrips: [],
      pick_spells: ['hunters_mark', 'cure_wounds', 'goodberry', 'fog_cloud', 'longstrider', 'pass_without_trace', 'lesser_restoration', 'darkvision', 'silence', 'conjure_animals', 'plant_growth'],
    },
    features: [
      { id: 'favored_enemy', level: 1, name: 'Enemigo predilecto', text: 'Ventaja para rastrear y recordar cosas de un tipo de criatura que conoces bien.' },
      { id: 'natural_explorer', level: 1, name: 'Explorador nato', text: 'En tu terreno predilecto no te pierdes, viajas sigiloso a ritmo normal y doblas la competencia en INT y SAB.' },
      { id: 'spellcasting', level: 2, name: 'Lanzamiento de conjuros', text: 'Lanzas con SAB los conjuros de explorador que conoces.' },
      { id: 'primeval_awareness', level: 3, name: 'Conciencia primigenia', text: 'Gastando un espacio, sabes si hay ciertos tipos de criaturas a 1,5 km.' },
      { id: 'colossus_slayer', level: 3, name: 'Asesino de colosos (Cazador)', text: 'Una vez por turno, 1d8 más a una criatura que ya está herida.' },
      { id: 'extra_attack', level: 5, name: 'Ataque adicional', text: 'Cuando atacas con tu acción, atacas dos veces.' },
    ],
  },
  sorcerer: {
    asi: STANDARD_ASI,
    resources: [{ key: 'sorcery_points', label: 'Puntos de hechicería', from: 2, recharge: 'long', max: { times_level: 1 } }],
    choices: [{
      key: 'metamagic', level: 3, kind: 'option', name: 'Metamagia', text: 'Dos formas de retorcer tus conjuros con puntos de hechicería.', count: 2, prefer: ['quickened', 'twinned'],
      options: [
        { id: 'careful', name: 'Conjuro cuidadoso', text: '1 punto: aliados a tu elección superan solos la salvación.' },
        { id: 'distant', name: 'Conjuro distante', text: '1 punto: dobla el alcance (o toque a 9 m).' },
        { id: 'empowered', name: 'Conjuro potenciado', text: '1 punto: repites hasta CAR dados de daño.' },
        { id: 'extended', name: 'Conjuro prolongado', text: '1 punto: dobla la duración.' },
        { id: 'heightened', name: 'Conjuro intensificado', text: '3 puntos: un objetivo tiene desventaja en la primera salvación.' },
        { id: 'quickened', name: 'Conjuro acelerado', text: '2 puntos: un conjuro de una acción pasa a acción adicional.' },
        { id: 'subtle', name: 'Conjuro sutil', text: '1 punto: sin palabras ni gestos.' },
        { id: 'twinned', name: 'Conjuro gemelo', text: 'Tantos puntos como su nivel: un conjuro de un objetivo alcanza a otro.' },
      ],
    }],
    caster: {
      ability: 'cha', list: 'sorcerer', slots: 'full', mode: 'known', from: 1,
      cantrips: byLevel([[1, 4], [4, 5], [10, 6]]), known: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
      pick_cantrips: ['fire_bolt', 'ray_of_frost', 'mage_hand', 'light', 'prestidigitation', 'shocking_grasp', 'minor_illusion'],
      pick_spells: ['magic_missile', 'shield', 'burning_hands', 'sleep', 'misty_step', 'scorching_ray', 'hold_person', 'fireball', 'haste', 'counterspell', 'fly', 'lightning_bolt'],
    },
    features: [
      { id: 'spellcasting', level: 1, name: 'Lanzamiento de conjuros', text: 'Lanzas con CAR los conjuros que conoces: la magia te sale de dentro.' },
      { id: 'draconic_ancestry', level: 1, name: 'Linaje dracónico', text: 'Hablas dracónico y duplicas la competencia al tratar con dragones.' },
      { id: 'draconic_resilience', level: 1, name: 'Resiliencia dracónica', text: 'Escamas: sin armadura, tu CA es 13 + DES; +1 PG máximo por nivel.', effects: { unarmored_ac: { base: 13, add: [] }, hp_per_level: 1 } },
      { id: 'font_of_magic', level: 2, name: 'Fuente de magia', text: 'Puntos de hechicería: conviertes puntos en espacios y espacios en puntos (acción adicional).', resource: 'sorcery_points' },
      { id: 'metamagic', level: 3, name: 'Metamagia', text: 'Gastas puntos de hechicería para retorcer tus conjuros (las que elegiste).', resource: 'sorcery_points' },
    ],
  },
  warlock: {
    asi: STANDARD_ASI,
    resources: [],
    choices: [
      {
        key: 'invocations', level: 2, kind: 'option', name: 'Invocaciones sobrenaturales', text: 'Fragmentos de saber prohibido que te dio tu patrón.', count: 2, prefer: ['agonizing_blast', 'devils_sight'],
        options: [
          { id: 'agonizing_blast', name: 'Descarga agonizante', text: 'Sumas CAR al daño de Descarga sobrenatural.' },
          { id: 'armor_of_shadows', name: 'Armadura de sombras', text: 'Armadura de mago sobre ti a voluntad, sin espacio.' },
          { id: 'devils_sight', name: 'Vista del diablo', text: 'Ves en la oscuridad, también la mágica, a 36 m.' },
          { id: 'eldritch_sight', name: 'Vista sobrenatural', text: 'Detectar magia a voluntad, sin espacio.' },
          { id: 'mask_of_many_faces', name: 'Máscara de los mil rostros', text: 'Disfrazarse a voluntad, sin espacio.' },
          { id: 'repelling_blast', name: 'Descarga repulsora', text: 'Tu Descarga sobrenatural empuja 3 m.' },
          { id: 'beguiling_influence', name: 'Influencia seductora', text: 'Competencia en Engaño y Persuasión.' },
        ],
      },
      {
        key: 'pact_boon', level: 3, kind: 'option', name: 'Don del pacto', text: 'El regalo de tu patrón.', count: 1, prefer: ['tome'],
        options: [
          { id: 'chain', name: 'Pacto de la cadena', text: 'Encontrar familiar, con formas especiales (diablillo, pseudodragón, quasit).' },
          { id: 'blade', name: 'Pacto del filo', text: 'Haces aparecer un arma de pacto en tu mano y eres competente con ella.' },
          { id: 'tome', name: 'Pacto del tomo', text: 'Un Libro de las sombras con tres trucos de cualquier clase.' },
        ],
      },
    ],
    caster: {
      ability: 'cha', list: 'warlock', slots: 'pact', mode: 'known', from: 1,
      cantrips: byLevel([[1, 2], [4, 3], [10, 4]]), known: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
      extra: ['burning_hands', 'command', 'scorching_ray', 'fireball', 'stinking_cloud'],
      pick_cantrips: ['eldritch_blast', 'minor_illusion', 'mage_hand', 'prestidigitation'],
      pick_spells: ['hex', 'hellish_rebuke', 'charm_person', 'burning_hands', 'misty_step', 'invisibility', 'hold_person', 'suggestion', 'darkness', 'counterspell', 'fireball', 'fly', 'hypnotic_pattern', 'vampiric_touch'],
    },
    features: [
      { id: 'fiend_patron', level: 1, name: 'Patrón: el Infernal', text: 'Tu lista de conjuros suma Manos ardientes, Orden imperiosa, Rayo abrasador, Bola de fuego y Nube apestosa.' },
      { id: 'dark_ones_blessing', level: 1, name: 'Bendición del oscuro', text: 'Al dejar a 0 PG a un enemigo, ganas CAR + tu nivel en PG temporales.' },
      { id: 'pact_magic', level: 1, name: 'Magia del pacto', text: 'Lanzas con CAR. Pocos espacios, todos del nivel más alto que tienes, y vuelven con un descanso corto.' },
      { id: 'invocations', level: 2, name: 'Invocaciones sobrenaturales', text: 'Las que elegiste, siempre activas.' },
      { id: 'pact_boon', level: 3, name: 'Don del pacto', text: 'El regalo de tu patrón que elegiste.' },
    ],
  },
};

export function progressionOf(classId: string): ClassProgression | undefined { return PROGRESSION[classId]; }
