/**
 * Modelo de datos del mundo (fase 1).
 *
 * Principios (SPEC §14.2):
 *  - Un solo árbol de contención: todo lo que ocupa espacio tiene un único
 *    campo `location` polimórfico. Nada existe en dos sitios.
 *  - Las salidas son entidades con estado, no aristas.
 *  - Los sistemas (combates, crímenes, líneas secundarias) no son objetos del mundo.
 *
 * Unidades: metros, segundos de tiempo de juego, libras (5e) para peso.
 */

import type { StoryCondition } from './story.js';

export type Id = string;

/** Dónde está algo. Exactamente un sitio (SPEC §5.3, §14.2). */
export type Placement =
  | { type: 'spot'; id: Id }
  | { type: 'character'; id: Id; slot: CarrySlot }
  | { type: 'npc'; id: Id }
  | { type: 'container'; id: Id }
  | { type: 'vehicle'; id: Id };

/** Dónde lleva un PJ un ítem (SPEC §5.4). */
export type CarrySlot =
  | { kind: 'hand'; which: 'main' | 'off' | 'both' }
  | { kind: 'pocket' }
  | { kind: 'equipped'; slot: EquipSlot };

export type EquipSlot =
  | 'head' | 'body' | 'hands' | 'feet' | 'neck' | 'ring1' | 'ring2' | 'back' | 'belt';

export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'head', 'body', 'hands', 'feet', 'neck', 'ring1', 'ring2', 'back', 'belt',
];

// ---------------------------------------------------------------------------
// Campaña y tiempo
// ---------------------------------------------------------------------------

export interface Campaign {
  id: Id;
  name: string;
  /** Segundos de juego por segundo real. SPEC §1.3: 3. */
  time_ratio: number;
  /** Instante real (ms epoch) en que el reloj de juego valía `game_epoch_s`. */
  real_epoch_ms: number;
  /** Segundos de juego transcurridos en `real_epoch_ms`. */
  game_epoch_s: number;
  calendar: Calendar;
  /** Puntos de inicio con su origen narrativo. Un PJ nuevo aparece en el de la localización menos poblada. */
  starting_points: { spot_id: Id; origin: string }[];
  perception_rules: PerceptionRules;
  movement_rules: MovementRules;
  capacity_rules: CapacityRules;
  /** Identidad de la campaña para el master (SPEC §1.1). */
  premise: string;
  setting: string;
  tone: 'epic' | 'grim' | 'comedy' | 'horror' | 'pulp';
  content_rating: 0 | 1 | 2 | 3;
  language: 'es' | 'en';
  house_rules: string;
  /** Bienvenida en voz del master al crear personaje. `{name}` se sustituye por el del PJ. */
  welcome: string;
  master: MasterConfig;
  factions: Faction[];
  /** Pistas del hilo de la demo: descubrimientos personales, no se consumen. */
  clues: Clue[];
  /** Encargos del tablón. Rotan cada día de juego. */
  jobs: Job[];
  achievement: Achievement;
  progression: { practice_thresholds: number[]; practice_min_dc: number };
  /** Estado vivo del tablón. */
  board: { active_job_ids: Id[]; last_rotation_day: number };
  // Mundo generado (src/worldgen). Todo opcional: la semilla demo no lo trae.
  /** Biblia: verdades ocultas del mundo que explican pistas y secretos. Consulta; no va al system prompt. */
  bible?: string[];
  /** Costumbres del lugar (lo que la gente hace y dice sin explicarlo), una entrada cada una. Van al system prompt como detalle de fondo. */
  customs?: string[];
  /** Leyes del mundo, una frase cada una (las lee src/engine/laws.ts). */
  laws?: string[];
  /** Procedencia: cómo y con qué se generó este mundo. */
  generation?: GenerationInfo;
  /**
   * Situaciones iniciales aún sin dueño: la de cada PJ anunciado al generar y alguna de reserva.
   * Campañas escritas: `for_classes` la reserva a esas clases (ids SRD) y `keep` la deja en la bolsa para el siguiente.
   */
  situations?: { for_name: string; for_classes?: string[]; keep?: boolean; companion_of?: string; situation: InitialSituation }[];
  /** Muerte y reaparición (SPEC §4.7, death.ts). Sin campo, los valores por defecto. */
  death_rules?: Partial<DeathRules>;
}

/** Reglas de muerte de la campaña (SPEC §1.2 death_rule, §4.7). Esperas en tiempo real. */
export interface DeathRules {
  /** Segundos reales que espera un PJ casual antes de volver (2 h). */
  casual_respawn_wait_s: number;
  /** Segundos reales que espera un PJ hardcore (30 min). */
  hardcore_respawn_wait_s: number;
  /** Puntos que pierde un PJ hardcore en una característica al volver (1). */
  hardcore_ability_penalty: number;
  /** Dónde vuelve; null = el punto de inicio de la campaña. */
  respawn_spot_id: Id | null;
  /** Quién le encontró y le trajo, para la narración de la vuelta («Ilse te encontró…»). */
  respawn_story: string;
}

/** Evento de generación de un mundo (src/worldgen). */
export interface GenerationInfo {
  seed: number;
  tone: Campaign['tone'];
  setting: string;
  /** Modelo que escribió el relleno, u 'offline' para el relleno determinista. */
  model: string;
  generated_at: string;
  /** Llamadas a la API (1, o 2 si hubo que corregir). 0 offline. */
  attempts: number;
  usage: { input: number; output: number };
  cost_usd: number;
  skeleton_version: number;
  /** Tipo de asentamiento y género que eligió el esqueleto. */
  settlement?: string;
  genre?: string;
}

/**
 * Situación inicial de un PJ en un mundo generado: su porqué. La primera escena
 * del máster parte de aquí.
 */
export interface InitialSituation {
  /** Para no repetirla a dos PJ de la partida y para enlazar las de compañero (`companion_of` en la bolsa). */
  id?: string;
  /** Situación de compañero: el PJ con quien llegó (comparte lugar y reloj). */
  companion_of_character_id?: Id;
  why_here: string;
  wants: string;
  threat: string;
  /** Plazo, en días de juego, antes de que la amenaza se cumpla. */
  clock_days: number;
  /** Qué pasa si vence el plazo. */
  clock_runs_out: string;
  /** NPC cercano que se le opone (no tiene por qué mostrarse hostil). */
  antagonist_npc_id: Id;
  /** Dónde empieza. */
  start_spot_id: Id;
  /** A qué hora de juego (0-23). Fija el reloj del mundo al nacer; quien llega después comparte el reloj. */
  start_hour?: number;
  /** Tres caminos posibles, distintos entre sí. */
  paths: string[];
  /** Lo que le está pasando en el primer instante. */
  opening: string;
  /** Instante de juego en que vence el plazo (lo fija el alta del PJ). */
  deadline_game_s?: number;
  /** Campañas escritas: deuda con la que empieza (vence con el plazo), objetos que trae y a quién conoce ya. */
  debt?: { npc_id: Id; amount: number; reason: string };
  items?: { item_id: Id; quantity: number }[];
  knows?: Id[];
  /** NPC que la apertura pone junto al PJ: el alta los lleva a su punto de inicio y los retiene un rato (npcorders.ts). */
  with_npc_ids?: Id[];
}

export interface Faction { id: Id; name: string; description: string }

export interface Clue {
  id: Id;
  title: string;
  /** Solo para el master: qué revela (y, sin `sources`, cómo se obtiene). */
  how: string;
  reputation: number;
  /** Pista clave: la historia la necesita. El validador de campaña le exige al menos dos fuentes. */
  key?: boolean;
  /**
   * Caminos para conseguirla, cada uno con lo que pide. grant_clue solo la da si se cumple alguno; si no, la
   * rechaza con el motivo (`refusal`) para que el máster lo narre. Sin `sources`, cualquier camino vale.
   */
  sources?: ClueSource[];
  /** Anclas: el contexto del máster solo trae el "cómo" de la pista si el actor está en una de estas localizaciones o tiene delante a uno de estos NPCs. Sin anclas, va siempre. */
  location_ids?: Id[];
  npc_ids?: Id[];
}

/** Un camino para conseguir una pista. */
export interface ClueSource {
  /** Para el máster: de quién o de qué sale y cómo («Ilse lo cuenta si se fía de ti»). */
  via: string;
  /** Quién la da: tiene que estar con el PJ. */
  npc_id?: Id;
  /** Dónde se encuentra: el PJ tiene que estar allí. */
  location_id?: Id;
  /** Lo que hace falta (confianza, paso de misión, objeto…); sin requisito, basta con estar. */
  requires?: StoryCondition;
  /** Por qué no sale aún, en ficción, para que el máster lo narre («Ilse aún no se fía de ti»). */
  refusal?: string;
}

export interface Job {
  id: Id;
  title: string;
  text: string;
  giver_npc_id: Id;
  kind: 'deliver' | 'visit' | 'narrative';
  deliver?: { item_id: Id; quantity: number };
  visit_spot_id?: Id;
  reward_coins: number;
  reward_reputation: number;
}

export interface Achievement {
  id: Id;
  title: string;
  faction_id: Id;
  clues_required: number;
  reputation_required: number;
  /** Lo que da al conseguirlo. En las campañas escritas, mejor nada que se salte la historia (llaves y pasadizos salen de misiones). */
  reward_item_id: Id | null;
  reward_spot_id: Id | null;
  /** Reputación extra con la facción al conseguirlo. */
  reward_reputation?: number;
  /** Lo que se cuenta en público: solo hechos ciertos (que se habla de él), nunca lo que no ha pasado. */
  announcement: string;
}

/** Configuración del master (SPEC §2). Separada de la campaña para poder cambiar de master. */
export interface MasterConfig {
  model: string;
  effort: 'low' | 'medium' | 'high';
  name: string;
  voice: string[];
  narration_length: 'short' | 'medium' | 'long';
  perspective: 'second' | 'third';
  difficulty: 'easy' | 'normal' | 'hard' | 'deadly';
  improvisation: number;
  /** Máximo de llamadas a tools por acción. */
  max_tool_calls: number;
}

export interface Calendar {
  /** Nombres de los días de la semana, en orden. */
  day_names: string[];
  /** Nombres de los meses, con su duración en días. */
  months: { name: string; days: number }[];
  /** Hora en que amanece / anochece (0-24). Para el factor de luz. */
  sunrise_h: number;
  sunset_h: number;
  /** Duración del crepúsculo a cada lado, en horas. */
  twilight_h: number;
}

export interface PerceptionRules {
  vision_base_m: number;
  hearing_base_m: number;
  light_factor: { day: number; twilight: number; night_moon: number; night_dark: number; torch: number };
  torch_fixed_m: number;
  darkvision_m: number;
  /** ±% por punto de percepción pasiva respecto a 10. */
  skill_step: number;
  asleep_factor: number;
}

export interface MovementRules {
  /** m/s a 30 ft de velocidad (5e: 9 m / 6 s). */
  base_speed_mps: number;
  pace: { stealth: number; walk: number; run: number };
}

export interface CapacityRules {
  pockets_slots: number;
  /** Máximo = STR × este factor (libras). */
  carry_per_str: number;
  encumbered_at: number;   // × STR
  heavily_at: number;      // × STR
  coins_per_lb: number;
}

// ---------------------------------------------------------------------------
// Mapa: región → zona → localización → punto (SPEC §3.2)
// ---------------------------------------------------------------------------

export interface Region { id: Id; name: string; }
export interface Zone { id: Id; region_id: Id; name: string; kind: string; }

export interface Location {
  id: Id;
  zone_id: Id;
  name: string;
  description_base: string;
  default_spot_id: Id;
  /** Interior cerrado: la luz no depende del sol sino de `ambience.light`. */
  indoor: boolean;
  ambience: { light: LightLevel | 'natural'; noise: number; smell?: string };
  state: Record<string, unknown>;
  discovery: Record<Id, 'unknown' | 'heard_of' | 'visited'>;
}

export type LightLevel = 'day' | 'twilight' | 'night_moon' | 'night_dark';

export interface Spot {
  id: Id;
  location_id: Id;
  name: string;
  aliases: string[];
  description: string;
  x: number;
  y: number;
  capacity: number | null;
  hidden: boolean;
  dc_to_find?: number;
  discovered_by: Id[];
  state: Record<string, unknown>;
  tags: string[];
  terrain_multiplier: number;
  entry_cost_s: number;
  /** Enlaces internos con bloqueo de visión/sonido (SPEC §9.2). */
  links: { to_spot_id: Id; blocks_sight?: boolean; muffles?: number }[];
}

/** Salida entre localizaciones. Entidad con estado (SPEC §14.2). */
export interface Exit {
  id: Id;
  from_spot_id: Id;
  to_spot_id: Id;
  distance_m: number;
  terrain_multiplier: number;
  bidirectional: boolean;
  state: { blocked_by?: string; locked?: boolean; [k: string]: unknown };
}

// ---------------------------------------------------------------------------
// Entidades con presencia
// ---------------------------------------------------------------------------

export type Pace = 'stealth' | 'walk' | 'run';

export interface Transit {
  origin_spot_id: Id;
  destination_spot_id: Id;
  pace: Pace;
  /** Tramos del camino, en orden, con el instante de juego en que se completa cada uno. */
  legs: TransitLeg[];
  departed_game_s: number;
  arrives_game_s: number;
}

export interface TransitLeg {
  from_spot_id: Id;
  to_spot_id: Id;
  distance_m: number;
  /** Segundos de juego que dura este tramo. */
  duration_s: number;
  /** Instante de juego al terminar el tramo. */
  ends_game_s: number;
  via_exit_id?: Id;
}

export type CharacterStatus = 'active' | 'asleep' | 'unconscious' | 'dead' | 'retired';

export interface Condition { name: string; source: string; expires_game_s: number | null }

export interface Character {
  id: Id;
  user_id: Id;
  name: string;
  /** Identidad para el master (SPEC §4.1). Fase 2: nombre, raza, clase, aspecto, historia. */
  race: string;
  class_name: string;
  /** IDs SRD (race/class/background) para reglas; los nombres de arriba son para mostrar. */
  race_id: string;
  class_id: string;
  background_id: string;
  hit_die: number;
  death_mode: 'casual' | 'hardcore';
  level: number;
  appearance: string;
  backstory: string;
  hp_max: number;
  hp_current: number;
  hp_temp: number;
  conditions: Condition[];
  /** Skills y salvaciones con competencia (claves 5e en inglés: 'athletics', 'str'…). */
  proficiencies: { skills: string[]; expert: string[]; saves: string[] };
  /** Progresión por uso (SPEC §4.11): usos significativos por skill y bonus ganado (+1/+2). */
  practice: Record<string, number>;
  practice_bonus: Record<string, number>;
  reputation: Record<Id, number>;
  /** A quién conoce por su nombre (NPCs y otros PJs). Hasta entonces, solo lo que se ve. */
  knows: Id[];
  clues: Id[];
  completed_jobs: Id[];
  achievements: { id: Id; game_s: number }[];
  /** Solo posición; la hoja completa llega en fase 2. */
  location: Extract<Placement, { type: 'spot' | 'vehicle' }>;
  transit: Transit | null;
  status: CharacterStatus;
  /** Velocidad 5e en pies (30 por defecto). */
  speed_ft: number;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  passive_perception: number;
  darkvision: boolean;
  /** Multiplicador de condiciones (cargado, exhausto…). 1 = normal. */
  condition_speed_factor: number;
  coins: number;
  decisive: DecisiveWindow | null;
  xp: number;
  last_seen_event_id: Id | null;
  /** Fijado al desconectar: desde dónde contar el /recap al volver. null = sin recap pendiente. */
  recap_from: { event_id: Id | null } | null;
  connected: boolean;
  veiled: boolean;
  /** Mundo generado: su situación inicial (src/worldgen). */
  situation?: InitialSituation;
  /** Lo que debe a NPCs (debts.ts): abiertas y, para el Diario, las últimas saldadas. */
  debts?: Debt[];
  /** Entre jugadores (party.ts): ofertas que le han hecho y esperan su respuesta. */
  offers?: Offer[];
  /** Entre jugadores (reactions.ts): lo que otro PJ intenta hacerle y espera que decida si se deja o se resiste. */
  reactions?: Reaction[];
  /** A quién sigue en cada desplazamiento (party.ts); null o ausente, a nadie. */
  following?: Id | null;
  /**
   * Su jugador se ha ido (sin pestañas pasado el margen): el PJ se queda, ausente.
   * Se defiende pero no actúa; a los 30 min, el velo (`veiled`). null o ausente: está.
   */
  away?: { since_real_ms: number; since_game_s: number; spot_id: Id | null } | null;
  /** Ayuda de otro PJ (regla de ayuda del SRD): ventaja en su siguiente tirada hasta ese instante de juego. */
  helped_by?: { character_id: Id; expires_game_s: number } | null;
  /** Descansos (rest.ts): dados de golpe gastados, recursos de clase usados y cuándo acabó el último descanso largo. */
  rest?: RestState;
  /** A 0 PG (death.ts): salvaciones contra muerte; o estable, hasta cuándo. null o ausente: no está cayendo. */
  dying?: DyingState | null;
  /** Muerto (death.ts, SPEC §4.7): cuándo vuelve, dónde quedó el cuerpo y qué se quedó en él. */
  death?: DeathState | null;
  /** Hardcore: puntos perdidos por característica al volver de la muerte (se recuperan al subir de nivel). */
  ability_penalties?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  /** Conjuros (levels.ts). Ausente: la clase no lanza o el PJ es de antes y `migrate` se los da. */
  spells?: CharacterSpells;
  /** Elecciones de clase hechas (levels.ts): clave de la elección → lo elegido (estilo, pericia, mejora de característica). */
  picks?: Record<string, string[]>;
}

/**
 * Conjuros de un PJ (ids de src/data/srd/spells.ts). `known`: los que aprende
 * una clase de conjuros conocidos o, para el mago, los de su libro. `prepared`:
 * los que tiene listos hoy una clase que prepara (mago, clérigo, druida,
 * paladín). Los de dominio o juramento no se apuntan: van siempre preparados.
 */
export interface CharacterSpells {
  cantrips: Id[];
  known: Id[];
  prepared: Id[];
}

export interface RestState {
  hit_dice_used: number;
  /** Usos gastados de cada recurso de clase (rest.ts, CLASS_RESOURCES). */
  used: Record<string, number>;
  last_long_rest_game_s: number | null;
}

export interface DyingState {
  success: number;
  fail: number;
  since_game_s: number;
  /** Próxima tirada fuera de rondas (instante de juego). */
  next_game_s: number;
  /** Estable: recupera 1 PG en este instante de juego (1d4 h). null: sigue tirando. */
  stable_until_game_s: number | null;
  /** Quién le estabilizó o curó (para el Diario). */
  saved_by: string | null;
  cause: string;
  /** Ya tiene PG otra vez: el motor lo cuenta (quién le salvó) y borra el estado. */
  revived?: 'heal' | 'save' | 'rest';
  /** El motor ya ha avisado de la caída y de que está estable. */
  told?: { down?: boolean; stable?: boolean };
}

export interface DeathState {
  died_game_s: number;
  died_real_ms: number;
  respawn_real_ms: number;
  mode: 'casual' | 'hardcore';
  spot_id: Id;
  /** El cuerpo (contenedor fijo en el sitio) con lo que llevaba. */
  body_instance_id: Id | null;
  cause: string;
  /** Lo que quedó en el cuerpo, para el Diario y la vuelta. */
  left: string[];
  coins_left: number;
  /** El motor ya ha contado la muerte (avisos, Diario). */
  told?: boolean;
}

/** Algo que un PJ ofrece a otro: un objeto, monedas o ambas cosas. Se cumple solo si el otro acepta (party.ts). */
export interface Offer {
  id: Id;
  from_id: Id;
  to_id: Id;
  /** Ejemplar ofrecido y cuántos (de una pila); null si solo son monedas. */
  instance_id: Id | null;
  quantity: number;
  coins: number;
  /** Cómo se lee: «una daga», «20 monedas», «una daga y 20 monedas». */
  label: string;
  created_real_ms: number;
  expires_real_ms: number;
  /** Evento que la anuncia (para que la web ponga los botones en su sitio). */
  event_id?: Id;
}

/** Qué le hace un PJ a otro con las manos (reactions.ts). `other`: lo que el máster pide con request_reaction y no es nada de lo anterior. */
export type ReactionKind = 'attack' | 'grapple' | 'shove' | 'other';

/** Lo que un PJ intenta hacerle a otro y espera su decisión: dejarse (sin tirada) o resistirse (tirada enfrentada). */
export interface Reaction {
  id: Id;
  from_id: Id;
  to_id: Id;
  kind: ReactionKind;
  /** Qué intenta, en infinitivo y para el afectado: «agarrarte y llevarte a la taberna». */
  attempt: string;
  /** Lo que escribió quien actúa (o la acción que llevó al máster a pedirla). */
  input: string | null;
  /** Adónde se lo lleva si sale bien; null si no se mueve. */
  dest_spot_id: Id | null;
  /** Empujar para tirarle al suelo (queda derribado). */
  prone?: boolean;
  /** Skills de la tirada enfrentada (claves 5e): la de quien actúa y las que puede usar el afectado (la mejor). Sin ella, Atletismo contra Atletismo o Acrobacias. */
  contest?: { actor: string; target: string[] };
  created_real_ms: number;
  expires_real_ms: number;
  /** Evento que la anuncia (para que la web ponga los botones en su sitio). */
  event_id?: Id;
}

/** Una deuda con un NPC, con su prenda si dejó algo a cambio (debts.ts). */
export interface Debt {
  id: Id;
  npc_id: Id;
  amount: number;
  reason: string;
  /** Instante de juego en que vence; null = sin plazo. */
  due_game_s: number | null;
  /** Ejemplar que el NPC guarda en prenda; vuelve al PJ al saldarla. */
  collateral_instance_id?: Id;
  created_game_s: number;
  /** Saldada: cuándo y cómo (pagada, trabajada o perdida la prenda). */
  settled?: { game_s: number; how: 'coins' | 'work' | 'forfeit' };
}

/** Lo que un NPC recuerda de un PJ (SPEC §3.3). Lo escribe el master solo cuando hablan. */
export interface NpcMemory {
  character_id: Id;
  game_s: number;
  note: string;
  /** 1 se olvida en días; 2 en semanas; 3 nunca. */
  importance: 1 | 2 | 3;
}

export interface Npc {
  id: Id;
  name: string;
  role: string;
  location: Extract<Placement, { type: 'spot' }>;
  status: 'alive' | 'dead' | 'missing';
  passive_perception: number;
  description: string;
  motivation: string;
  /**
   * Lo que esconde, entero: para el análisis y los mundos generados. Al máster no le llega tal cual: le llega
   * `knowledge` por niveles (trust.ts); sin `knowledge`, el secreto cuenta como de nivel amigo.
   */
  secret: string;
  /** Lo que sabe y cuenta según cuánto se fíe del PJ (trust.ts). Cada nivel suma a los de debajo. */
  knowledge?: NpcKnowledge[];
  /** Carácter: la adulación le resta confianza en vez de sumarla (trust.ts). Sin campo, la agradece. */
  dislikes_flattery?: boolean;
  /** Confianza en cada PJ (trust.ts): puntos y lo ganado en la última charla. */
  trust?: Record<Id, NpcTrust>;
  memory: NpcMemory[];
  /** Cola de conversación (SPEC §9.6): con quién habla ahora. */
  talking_to: { character_id: Id; since_game_s: number; /** Otros PJ unidos a la charla (scene.ts). */ with?: Id[]; /** Turno guardado para quien esperaba: aún no ha hablado. */ reserved?: boolean } | null;
  /** Comercio (SPEC §5.6): qué compra y a qué precio; qué vende. */
  buys: { item_id: Id; price: number }[];
  sells: { item_id: Id; price: number }[];
  /** Bloque de combate SRD simplificado (SPEC §3.3). null = no combate. */
  stats: NpcStats | null;
  /** Actitud por PJ; `default` para quien no conoce. */
  attitude: { default: Attitude; by_character: Record<Id, Attitude> };
  /** Cómo murió (death.ts, killNpc): su cuerpo sigue en su punto y el motor lo anuncia una vez (`told`). */
  death?: NpcDeath;
}

export interface NpcDeath {
  died_game_s: number;
  /** Quién lo mató (PJ o NPC), si alguien. */
  by_id: Id | null;
  by_name: string | null;
  cause: string;
  told?: boolean;
}

export type Attitude = 'hostile' | 'unfriendly' | 'neutral' | 'friendly' | 'allied';

/** Nivel de confianza de un NPC en un PJ (trust.ts), de menos a más. */
export type TrustTier = 'stranger' | 'acquaintance' | 'friend' | 'ally';

/** Una parte de lo que sabe un NPC: la cuenta a quien tenga al menos ese nivel de confianza con él. */
export interface NpcKnowledge { tier: TrustTier; text: string }

/** Confianza de un NPC en un PJ. `talk`: lo ganado en la conversación en curso, para el tope por charla. */
export interface NpcTrust { points: number; talk?: { since_game_s: number; gained: number; last_game_s: number } }

export interface NpcStats {
  ac: number;
  hp_max: number;
  hp: number;
  attack_bonus: number;
  damage: string;
  damage_type: string;
  attack_name: string;
  /** XP 5e por derrotarlo. */
  xp: number;
}

export interface Vehicle {
  id: Id;
  name: string;
  kind: 'mount' | 'cart' | 'carriage';
  location: Extract<Placement, { type: 'spot' }>;
  speed_ft: number;
  capacity: number;
  owner_id: Id | null;
  terrain_allowed: string[];
}

// ---------------------------------------------------------------------------
// Ítems (SPEC §5)
// ---------------------------------------------------------------------------

export type ItemSize = 'tiny' | 'small' | 'medium' | 'large' | 'bulky';
export type ItemType = 'weapon' | 'armor' | 'consumable' | 'tool' | 'quest' | 'treasure' | 'misc' | 'container';

export interface ItemDef {
  id: Id;
  name: string;
  aliases: string[];
  type: ItemType;
  size: ItemSize;
  weight_lb: number;
  value: number;
  unique: boolean;
  /** Si es contenedor: capacidad. */
  container?: { slots: number; max_weight_lb: number; max_size: ItemSize; fixed?: boolean };
  /** Si es equipable: slot que ocupa. */
  equip_slot?: EquipSlot;
  /** Armadura (SPEC §5.1): CA base y tope de DES (null = sin tope). */
  armor?: { ac_base: number; dex_max: number | null; stealth_disadvantage: boolean };
  /** Escudo: bonus a la CA cuando va en la mano. */
  shield_bonus?: number;
  weapon?: { damage: string; damage_type: string; finesse?: boolean; ranged?: boolean; two_handed?: boolean };
  /** Fuente de luz cuando `state.lit === true` (antorcha, farol). */
  light_source?: boolean;
  /**
   * Servicio (una noche de posada): no se lleva encima. Al comprarlo se entrega
   * `gives_item_id` (la llave) y se abren para el comprador los puntos del
   * vendedor cerrados con esa llave (`spot.state.key_item_id`).
   */
  service?: { gives_item_id: Id };
  /** Consumible que cura (poción): dados de PG que devuelve al gastarlo («2d4+2»). */
  heals?: string;
  origin: 'srd' | 'custom';
}

/** Un ejemplar concreto en el mundo. Siempre en exactamente un `location`. */
export interface ItemInstance {
  id: Id;
  item_id: Id;
  quantity: number;
  location: Placement;
  state: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Recursos (SPEC §3.2.5)
// ---------------------------------------------------------------------------

export interface ResourceNode {
  id: Id;
  spot_id: Id;
  name: string;
  aliases: string[];
  resource_item_id: Id;
  yield_max: number;
  /** Segundos de juego para regenerarse del todo. */
  regen_time_s: number;
  /** Instante de juego de la última extracción y estado en ese momento. */
  last_harvested_game_s: number | null;
  regen_state_at_harvest: number;
  destructive: boolean;
  skill: string;
  dc: number;
  tool_required: Id | null;
}

// ---------------------------------------------------------------------------
// Eventos (SPEC §6)
// ---------------------------------------------------------------------------

export type Visibility = 'public' | 'location' | 'private';

export interface GameEvent {
  id: Id;
  seq: number;
  timestamp_real_ms: number;
  timestamp_game_s: number;
  campaign_id: Id;
  location_id: Id;
  spot_id: Id | null;
  actor_id: Id | null;
  action_type: string;
  input_text: string | null;
  /** Lo que ve el propio actor. */
  narration_private: string;
  /** Lo que ve un testigo (SPEC §11.2). */
  observable: string | null;
  visibility: Visibility;
  tags: string[];
  /** A quién se ha entregado y con qué nivel de percepción. */
  delivered_to: { character_id: Id; level: PerceptionLevel; sound?: PerceptionLevel }[];
  payload: Record<string, unknown>;
}

export type PerceptionLevel = 'full' | 'vague' | 'hint' | 'none';

/** Ventana de respuesta decisiva (SPEC §9.3). */
export interface DecisiveWindow {
  opened_real_ms: number;
  window_s: number;
  /** Qué amenaza se resuelve contra el PJ si no responde. */
  threat: string;
  /** NPC que amenaza, si lo hay. */
  npc_id: Id | null;
  event_id: Id;
}

// ---------------------------------------------------------------------------
// Snapshot completo (lo que carga el motor en RAM y persiste)
// ---------------------------------------------------------------------------

export interface WorldSnapshot {
  campaign: Campaign;
  regions: Region[];
  zones: Zone[];
  locations: Location[];
  spots: Spot[];
  exits: Exit[];
  characters: Character[];
  npcs: Npc[];
  vehicles: Vehicle[];
  item_defs: ItemDef[];
  item_instances: ItemInstance[];
  resource_nodes: ResourceNode[];
}
