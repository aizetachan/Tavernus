/**
 * Historia escrita: misiones en actos para las campañas de autor
 * (src/data/campaigns). La historia está fijada de antemano; el jugador la
 * recorre como quiera y el motor reconoce, sin IA, cuándo ha dado cada paso a
 * partir de lo que ya guarda: una pista concedida, un punto pisado, un objeto
 * en el bolsillo o entregado, un NPC caído, el estado de un punto. Solo los
 * pasos `narrative` los marca el máster, con el tool `advance_story`. Así la
 * historia se revela por tools, nunca por texto suelto.
 *
 * Se guarda como las otras piezas opcionales de la campaña (hooks.ts,
 * rumors.ts, schedule.ts), sin tocar el modelo:
 *   - `campaign.story`: la definición (misiones, pasos, consecuencias y la
 *     línea secundaria que escala si nadie interviene). Estática.
 *   - `campaign.story_state`: qué consecuencias del mundo ya se aplicaron y
 *     qué escalones de la amenaza ya pasaron. Una vez por mundo.
 *   - `character.story`: misiones de cada PJ en cada estado y su registro.
 *
 * Ciclo de vida de una misión, al estilo de Baldur's Gate 3 (docs/BREZAL.md, §2.8):
 *   - **Disponible** (no se ve): quien la da (`giver_npc_id`) la tiene si el PJ
 *     cumple sus requisitos: nivel mínimo (`min_level`) y `requires` (misión
 *     previa, reputación, conocerle…). Nada flota sobre nadie.
 *   - **Te la piden en escena**: al hablar con él (o el máster con
 *     `story_quest ask`) entra en el Diario, ya activa. Aceptar es implícito; el
 *     jugador puede decir que no (`decline`) y el Diario lo apunta.
 *   - **Activa** → **lista para entregar** → **entregada**: la recompensa la da
 *     quien la recibe (`turn_in_npc_id`, por defecto quien la dio), al hablar.
 *   Lo que se oye por ahí (`rumor`) es una línea de ambiente en el hilo que dice
 *   a quién buscar, sin contar de qué va; no entra en el Diario. La misión principal (`main_for`) es un problema
 *   con varias pistas: cada paso opcional (`optional`) aparece en el Diario
 *   cuando alguien la menciona o algo la abre (`revealed_by`), se siguen en
 *   cualquier orden y llevan al cierre del acto. Los plazos (`deadline`) van por
 *   descansos largos e hitos, con aviso antes; lo que se pierde queda escrito.
 *   La web pone un punto discreto en quien está al final de una pista activa.
 *
 * Un paso solo cuenta para el PJ si lo ha hecho él (o su grupo, delante): las
 * condiciones del mundo (que un NPC tenga algo, muera, esté en un sitio, o el
 * estado de un punto) piden que el PJ esté en ese lugar. Cada cambio queda en
 * `character.story.log` con el porqué en palabras del jugador.
 *
 * Consecuencias: las que tocan al PJ (pista, objeto, conocer a alguien, un
 * punto descubierto) se aplican a cada PJ que cumple; las del mundo (un NPC
 * que se va, un estado, un evento en la agenda) una sola vez. Lo que «pasa» en
 * la escena (`tell`) no lo narra el motor: va al máster (`beats`), que lo
 * cuenta con su voz. Las misiones con el mismo `exclusive` son finales que se
 * excluyen: al cumplirse una, las demás caducan para todos. Si muere alguien
 * de quien depende una misión, falla o sigue por otro camino (`on_npc_dead`).
 */

import { GAME_HOUR } from '../clock/clock.js';
import { attitudeOf } from './combat.js';
import type { Hook } from './hooks.js';
import { spawnItem } from './inventory.js';
import type { Attitude, Character, Clue, ClueSource, Id, Npc, TrustTier } from './model.js';
import { roleLabel } from './narrate.js';
import { addReputation, checkAchievement, grantClue, type ProgressEvent, type QuestChange } from './progress.js';
import { RUMOR_KINDS, type Rumor, type RumorKind } from './rumors.js';
import type { NpcRoutine, ScheduledEvent } from './schedule.js';
import { money } from './money.js';
import { hasTag, opinionOf } from './standing.js';
import { hasFact } from './worldfacts.js';
import { adjustTrust, TRUST_LABEL, TRUST_THRESHOLD, trustAtLeast, type TrustChange, type TrustResult, trustNotice } from './trust.js';
import type { World } from './world.js';

// ---------------------------------------------------------------------------
// Definición
// ---------------------------------------------------------------------------

/** Cuándo se da un paso (o está disponible una misión). Lo evalúa el motor en cada tick y tras cada acción. */
export type StoryCondition =
  | { kind: 'clue'; clue_id: Id }
  /** El PJ está en ese punto (parado, no de paso). */
  | { kind: 'visit'; spot_id: Id }
  /** El PJ está ahora en esa localización. */
  | { kind: 'at_location'; location_id: Id }
  /** El PJ ha estado en esa localización. */
  | { kind: 'visit_location'; location_id: Id }
  /** Ese NPC está en ese punto (le ha traído su horario, un evento o la historia). */
  | { kind: 'npc_at'; npc_id: Id; spot_id: Id }
  | { kind: 'carry'; item_id: Id; quantity?: number }
  /** Ese NPC tiene el objeto (se lo han dado o vendido). */
  | { kind: 'npc_has'; npc_id: Id; item_id: Id; quantity?: number }
  | { kind: 'npc_status'; npc_id: Id; status: Npc['status'] }
  /** Actitud del NPC hacia el PJ igual o mejor que esta. */
  | { kind: 'attitude'; npc_id: Id; at_least: Attitude }
  /** Clave del estado de un punto: verdadera, o igual a `value` si se da. */
  | { kind: 'spot_state'; spot_id: Id; key: string; value?: string | number | boolean }
  | { kind: 'discovered'; spot_id: Id }
  | { kind: 'knows'; npc_id: Id }
  /** El NPC se fía del PJ al menos hasta ese nivel (trust.ts). */
  | { kind: 'trust'; npc_id: Id; at_least: TrustTier }
  /** El PJ ha dado ese paso de esa misión. */
  | { kind: 'step'; quest_id: Id; step_id: Id }
  /** El PJ está con ese NPC, en persona: hablando con él o en su mismo punto. */
  | { kind: 'talk'; npc_id: Id }
  | { kind: 'level'; at_least: number }
  /** Reputación del PJ con la facción del logro (o con `faction_id`). */
  | { kind: 'reputation'; at_least: number; faction_id?: Id }
  /** La deuda del PJ con ese NPC está saldada. */
  | { kind: 'debt_paid'; npc_id: Id }
  /** Ese escalón de la amenaza ya ha pasado (hito de la historia). */
  | { kind: 'escalated'; id: Id }
  /** Han pasado tantas horas de juego desde que nació el mundo. */
  | { kind: 'world_hours'; at_least: number }
  | { kind: 'job'; job_id: Id }
  /** Misión cumplida (por el PJ; en la amenaza, por cualquiera). */
  | { kind: 'quest'; quest_id: Id }
  /** Ha pasado ese hecho del mundo (worldfacts.ts): «ceniza_salvado», «npc_dead:npc_hugo». */
  | { kind: 'fact'; id: Id }
  /** El PJ tiene esa etiqueta (standing.ts): de origen (`clase:bard`) o ganada (`asesino`). */
  | { kind: 'tag'; tag: Id }
  /** Opinión de ese NPC con el PJ dentro de estos límites (standing.ts). */
  | { kind: 'opinion'; npc_id: Id; at_least?: number; at_most?: number }
  /** Lo decide el máster con advance_story; `how` le dice cuándo. */
  | { kind: 'narrative'; how: string }
  | { kind: 'any'; of: StoryCondition[] }
  /** Todas. Con un `narrative` dentro, el máster solo puede marcarlo si se cumple lo demás. */
  | { kind: 'all'; of: StoryCondition[] }
  /** No se cumple (en la amenaza: nadie la cumple). */
  | { kind: 'not'; of: StoryCondition };

/** Lo que cambia al dar un paso, aceptar o cumplir una misión, o al escalar la amenaza. */
export type StoryEffect =
  // Al PJ que cumple (cada uno)
  | { kind: 'clue'; clue_id: Id }
  | { kind: 'give_item'; item_id: Id; quantity?: number }
  | { kind: 'reveal_spot'; spot_id: Id }
  | { kind: 'learn_place'; location_id: Id }
  | { kind: 'know_npc'; npc_id: Id }
  | { kind: 'attitude'; npc_id: Id; attitude: Attitude }
  /** Mueve la confianza del NPC en el PJ (trust.ts): un cambio con su regla, o subirla al menos hasta un nivel. */
  | { kind: 'trust'; npc_id: Id; change?: TrustChange; at_least?: TrustTier }
  /** Lo que pasa en la escena. No lo narra el motor: se lo pasa al máster, que lo cuenta con su voz. */
  | { kind: 'tell'; text: string }
  // Al mundo (una vez)
  | { kind: 'npc_move'; npc_id: Id; spot_id: Id }
  /**
   * `missing` con `hideout_spot_id`: se esconde allí sin morir. Sale de la
   * percepción, del horario y de la agenda (todo eso mira `status === 'alive'`)
   * y vuelve a estar a la vista cuando un PJ se planta en el escondite.
   */
  | { kind: 'npc_status'; npc_id: Id; status: Npc['status']; hideout_spot_id?: Id }
  | { kind: 'npc_attitude_all'; npc_id: Id; attitude: Attitude }
  | { kind: 'npc_routine'; npc_id: Id; routine: NpcRoutine | null }
  | { kind: 'spot_state'; spot_id: Id; patch: Record<string, unknown> }
  | { kind: 'location_state'; location_id: Id; patch: Record<string, unknown> }
  /** El punto oculto pasa a estar a la vista de todos. */
  | { kind: 'unhide_spot'; spot_id: Id }
  | { kind: 'exit_state'; exit_id: Id; patch: Record<string, unknown> }
  /** Gancho para el máster (hooks.ts), con id fija. `minutes` solo en `time`. */
  | { kind: 'hook'; id: Id; location_id: Id; trigger: 'time' | 'spot' | 'location'; minutes?: number; spot_id?: Id; what: string; for_actor?: boolean; expires_hours?: number }
  /** Evento en la agenda (schedule.ts). `in_hours`: si es `once`, empieza dentro de tantas horas. */
  | { kind: 'schedule'; event: Omit<ScheduledEvent, 'source' | 'announced_to'>; in_hours?: number }
  | { kind: 'cancel_schedule'; event_id: Id }
  | { kind: 'rumor'; id: Id; location_id: Id; rumor_kind: RumorKind; name: string; hint: string; where?: string | null; days?: number }
  /** Se cuenta a quien esté en esa localización (o a todos, `public`). */
  | { kind: 'announce'; location_id: Id; spot_id?: Id; text: string; public?: boolean };

export interface StoryStep {
  id: Id;
  /** Objetivo, como lo lee el jugador en el Diario: la tarea concreta (qué hacer y a quién). */
  text: string;
  done_when: StoryCondition;
  on_done?: StoryEffect[];
  /** Pista: no sale en el Diario hasta que alguien la menciona o algo la abre (se cumple). Dada, sale siempre. */
  revealed_by?: StoryCondition;
  /** No hace falta para cumplir la misión (una pista entre varias de la principal). */
  optional?: boolean;
  /** Lo que apunta el Diario al darlo, en primera persona del grupo («Ilse nos habló del sello»). */
  journal?: string;
}

/**
 * Plazo de una misión abierta, por descansos largos e hitos (no por horas): al cumplirse, se pierde. Antes avisa
 * (`warn`): al quedar un descanso, o cuando se cumple `warn_when`. Lo perdido queda en el Diario (`lost`, en primera
 * persona) y en el mundo (`on_lost`, una vez).
 */
export interface StoryDeadline {
  /** Descansos largos desde que se abrió. */
  rests?: number;
  /** Hito, zona o momento que la cierra (`escalated`, `visit_location`, `quest`…). */
  milestone?: StoryCondition;
  warn_when?: StoryCondition;
  warn: string;
  lost: string;
  on_lost?: StoryEffect[];
}

/**
 * Si muere alguien de quien depende la misión: falla, o sigue por otro camino: otros pasos (sin ellos, los
 * mismos) y quizá otra entrega (`turn_in_npc_id`; null = se cumple sola).
 */
export type StoryNpcDead = { npc_id: Id; why: string } & ({ outcome: 'fail' } | { outcome: 'reroute'; steps?: StoryStep[]; turn_in_npc_id?: Id | null });

export interface StoryQuest {
  id: Id;
  act: 1 | 2 | 3;
  title: string;
  /** Quien la ofrece. null solo en la misión principal (`main_for`). */
  giver_npc_id: Id | null;
  /** Quien da la recompensa al entregarla: por defecto, quien la dio; null = se cumple sola al dar el último paso. */
  turn_in_npc_id?: Id | null;
  /** Misión principal de los PJ con estas situaciones iniciales: la tienen desde el principio, sin que nadie la ofrezca. */
  main_for?: Id[];
  /** Nivel de la misión: lo que ve el jugador como dificultad. */
  level: number;
  /** Nivel mínimo del PJ para que se la ofrezcan (por defecto, 1). */
  min_level?: number;
  /** Lo que lee el jugador (lo que cuenta quien la ofrece). */
  text: string;
  /** Solo para el máster: qué hay detrás y cómo empujar sin regalar. */
  notes: string;
  /** Requisitos para estar disponible (misión previa, reputación, conocer a alguien…), aparte del nivel. Sin ellos, desde el principio. */
  requires?: StoryCondition;
  /**
   * Lo que se oye por ahí cuando está disponible: dice a quién buscar, nunca de
   * qué va. `{giver}` es quien la da, como lo conoce el PJ. Se oye donde se
   * cumple `where`.
   */
  rumor?: { text: string; where: StoryCondition };
  /** Los pasos se dan en cualquier orden (la principal avanza por actos según lo que pase). */
  any_order?: boolean;
  /** Finales excluyentes: al cumplirse una del grupo, las demás caducan para todos. */
  exclusive?: string;
  steps: StoryStep[];
  reward: { coins?: number; reputation?: number; xp?: number; item_id?: Id };
  /** Al aceptarla: quien la da enseña algo, entrega lo que hay que llevar… */
  on_accept?: StoryEffect[];
  on_complete: StoryEffect[];
  /** Sin regla, si muere quien la recibe estando abierta, falla. */
  on_npc_dead?: StoryNpcDead[];
  deadline?: StoryDeadline;
  /** Final de la campaña: lo que queda del valle. Para el Diario y el máster. */
  ending?: string;
}

/** Escalón de la amenaza que avanza sola si nadie interviene. */
export interface StoryEscalation {
  id: Id;
  title: string;
  /** Horas de juego desde que nace el mundo. */
  after_hours: number;
  /** Si se cumple (cualquier PJ o el mundo), el escalón no pasa. */
  unless: StoryCondition;
  location_id: Id;
  spot_id?: Id;
  /** Lo que ve quien esté allí. */
  text: string;
  effects: StoryEffect[];
}

export interface Story {
  quests: StoryQuest[];
  escalation: StoryEscalation[];
}

export interface StoryState {
  started_game_s: number;
  /** Consecuencias del mundo ya aplicadas (`quest:paso#i`). */
  applied: Id[];
  /** Escalones resueltos: `id` si pasó, `!id` si se evitó. */
  escalated: Id[];
  /** Quién dio cada paso (`quest/paso`) y quién estaba con él (crédito compartido, docs/MULTIJUGADOR.md). */
  credits?: Record<Id, { by: Id; with: Id[]; game_s: number }>;
  /** Finales excluyentes cerrados: cuál, quién, con quién y cuándo (para el «Donde lo dejamos» de quien no estaba). */
  finals?: { quest_id: Id; by: Id; with: Id[]; game_s: number }[];
  /** Último instante de juego visto (para `world_hours`). */
  last_game_s?: number;
}

export interface CharacterStory {
  /** Aceptadas (o la principal), sin entregar. */
  open: Id[];
  /** Pasos dados: `quest/paso`. */
  steps: Id[];
  done: Id[];
  expired: Id[];
  failed?: Id[];
  /** Partidas de antes: ofrecidas sin respuesta. Se abren solas (se las pidieron). */
  offered?: Record<Id, number>;
  /** Las que dijo que no, con cuándo. Quien la da no vuelve a pedirla sola; el máster puede, si el PJ cambia de idea. */
  declined?: Record<Id, number>;
  /** Descansos largos contados y el último visto (`character.rest`). */
  rests?: number;
  rest_seen?: number | null;
  /** Descansos que llevaba al abrir cada misión (para los plazos). */
  opened_rests?: Record<Id, number>;
  /** Misiones con plazo de las que ya se avisó. */
  warned?: Id[];
  /** Rumores oídos, con cuándo. */
  rumors?: Record<Id, number>;
  /** Misiones que siguen por otro camino: el NPC muerto cuya regla se aplica. */
  rerouted?: Record<Id, Id>;
  /** Cómo le llegó cada misión (las abiertas antes de esto no lo tienen). */
  origins?: Record<Id, QuestOrigin>;
  /** Cambios con el porqué (los últimos MAX_LOG). */
  log?: QuestLogEntry[];
  /** Pistas (`quest/paso`) que una regla del mundo ha abierto o cerrado (worldrules.ts, efecto `lead`). Cerrada: ni se ve ni cuenta. */
  leads?: Record<Id, 'open' | 'closed'>;
}

/** De dónde le viene una misión al PJ. `heard` solo queda en partidas de antes de los rumores. */
export interface QuestOrigin {
  kind: 'giver' | 'heard' | 'self' | 'main';
  game_s: number;
  location_id: Id | null;
  /** En palabras del jugador: «Te la ofreció Ilse», «Lo que te trae aquí». */
  text: string;
}

export interface QuestLogEntry {
  quest_id: Id;
  /** `open`: aceptada (o la principal, al empezar). */
  kind: 'rumor' | 'offered' | 'declined' | 'open' | 'step' | 'ready' | 'changed' | 'warned' | 'done' | 'failed' | 'expired';
  step_id?: Id;
  game_s: number;
  /** Por qué, en palabras del jugador («conseguiste la pista «La Brasa de Vharn»»). */
  why: string;
}

/** Estado de una misión para un PJ. `locked`: aún no se la puede ofrecer nadie. */
export type StoryStatus = 'locked' | 'available' | 'declined' | 'active' | 'ready' | 'done' | 'failed' | 'expired';

/** Dificultad respecto al nivel del PJ, como el color de los MMO: gris, verde, amarillo, naranja, rojo. */
export type QuestDifficulty = 'trivial' | 'easy' | 'normal' | 'hard' | 'deadly';

const MAX_LOG = 200;
/** Cómo se pide una misión en escena, por fases: el misterio va en la historia, la tarea es concreta. */
const ASK_PHASES = 'primero el gancho (algo que le preocupa), luego el problema; los detalles solo si el jugador los pide; al final, la tarea concreta (qué hacer y a quién). Aceptar es implícito: si el jugador dice que no, story_quest decline.';

type StoryCampaign = { story?: Story; story_state?: StoryState; hooks?: Hook[]; rumors?: Rumor[]; schedule?: ScheduledEvent[] };

/** Finales excluyentes cerrados después de `sinceGameS` en los que `c` no estaba (para su «Donde lo dejamos»). */
export function finalsMissedBy(world: World, c: Character, sinceGameS: number): { quest: StoryQuest; by: Id; with: Id[]; game_s: number }[] {
  const st = (world.campaign as typeof world.campaign & StoryCampaign).story_state;
  return (st?.finals ?? [])
    .filter((f) => f.game_s >= sinceGameS && f.by !== c.id && !f.with.includes(c.id))
    .map((f) => ({ ...f, quest: quest(world, f.quest_id)! })).filter((f) => f.quest);
}

export function storyOf(world: World): Story | null {
  return (world.campaign as typeof world.campaign & StoryCampaign).story ?? null;
}

function stateOf(world: World): StoryState {
  const camp = world.campaign as typeof world.campaign & StoryCampaign;
  camp.story_state ??= { started_game_s: camp.game_epoch_s, applied: [], escalated: [] };
  return camp.story_state;
}

export function characterStory(c: Character): CharacterStory {
  const x = c as Character & { story?: CharacterStory };
  x.story ??= { open: [], steps: [], done: [], expired: [] };
  return x.story;
}

function logStory(world: World, c: Character, e: QuestLogEntry): void {
  const st = characterStory(c);
  st.log = [...(st.log ?? []), e].slice(-MAX_LOG);
  world.touch('characters', c.id);
}

/** Cómo nombra el PJ a un NPC: por su nombre si lo sabe; si no, por su oficio («la curandera»). */
export function nameFor(world: World, c: Character | null, npcId: Id): string {
  const n = world.npcs.get(npcId);
  if (!n) return npcId;
  if (!c || c.knows.includes(n.id)) return n.name;
  return roleLabel(n);
}

/** ¿Está ese NPC hablando ahora con el PJ (o el PJ unido a su charla)? */
export function talkingWith(n: Npc, c: Character): boolean {
  const t = n.talking_to;
  if (!t) return false;
  return (t.character_id === c.id && !t.reserved) || (t.with ?? []).includes(c.id);
}

/** Dificultad de una misión de nivel `level` para un PJ de nivel `pc`. */
export function difficultyOf(level: number, pc: number): QuestDifficulty {
  const d = level - pc;
  return d <= -2 ? 'trivial' : d === -1 ? 'easy' : d === 0 ? 'normal' : d === 1 ? 'hard' : 'deadly';
}

const RANK: Record<Attitude, number> = { hostile: 0, unfriendly: 1, neutral: 2, friendly: 3, allied: 4 };
const stepKey = (q: StoryQuest, s: StoryStep) => `${q.id}/${s.id}`;
const ROMAN = ['', 'I', 'II', 'III'] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Condiciones
// ---------------------------------------------------------------------------

/** ¿Está el PJ con ese NPC en persona? Hablando con él o en su mismo punto. */
function withNpc(world: World, c: Character, npcId: Id): boolean {
  const n = world.npcs.get(npcId);
  if (!n || n.status !== 'alive') return false;
  return talkingWith(n, c) || (!c.transit && world.characterSpot(c)?.id === n.location.id);
}

/** ¿Se cumple para este PJ? Con `c` null, las condiciones de PJ valen si alguno la cumple. */
export function holds(world: World, c: Character | null, cond: StoryCondition): boolean {
  if (!c && isPersonal(cond)) return [...world.characters.values()].some((x) => x.status !== 'retired' && holds(world, x, cond));
  switch (cond.kind) {
    case 'clue': return c!.clues.includes(cond.clue_id);
    case 'visit': return !c!.transit && world.characterSpot(c!)?.id === cond.spot_id;
    case 'at_location': return !c!.transit && world.characterSpot(c!)?.location_id === cond.location_id;
    case 'visit_location': return world.locations.get(cond.location_id)?.discovery[c!.id] === 'visited';
    case 'npc_at': return world.npcs.get(cond.npc_id)?.location.id === cond.spot_id;
    case 'carry': return world.itemsCarriedBy(c!.id).filter((i) => i.item_id === cond.item_id).reduce((a, i) => a + i.quantity, 0) >= (cond.quantity ?? 1);
    case 'npc_has': return [...world.itemInstances.values()].filter((i) => i.item_id === cond.item_id && i.location.type === 'npc' && i.location.id === cond.npc_id).reduce((a, i) => a + i.quantity, 0) >= (cond.quantity ?? 1);
    case 'npc_status': return world.npcs.get(cond.npc_id)?.status === cond.status;
    case 'attitude': {
      const n = world.npcs.get(cond.npc_id);
      return !!n && RANK[attitudeOf(n, c!.id)] >= RANK[cond.at_least];
    }
    case 'spot_state': {
      const v = world.spots.get(cond.spot_id)?.state[cond.key];
      return cond.value === undefined ? Boolean(v) : v === cond.value;
    }
    case 'discovered': return world.spots.get(cond.spot_id)?.discovered_by.includes(c!.id) ?? false;
    case 'knows': return c!.knows.includes(cond.npc_id);
    case 'trust': { const n = world.npcs.get(cond.npc_id); return !!n && trustAtLeast(n, c!.id, cond.at_least); }
    case 'step': return characterStory(c!).steps.includes(`${cond.quest_id}/${cond.step_id}`);
    case 'talk': return withNpc(world, c!, cond.npc_id);
    case 'level': return c!.level >= cond.at_least;
    case 'reputation': return (c!.reputation[cond.faction_id ?? world.campaign.achievement.faction_id] ?? 0) >= cond.at_least;
    case 'debt_paid': return (c!.debts ?? []).some((d) => d.npc_id === cond.npc_id && d.settled);
    case 'escalated': return stateOf(world).escalated.includes(cond.id);
    case 'world_hours': { const s = stateOf(world); return (s.last_game_s ?? s.started_game_s) - s.started_game_s >= cond.at_least * GAME_HOUR; }
    case 'job': return c!.completed_jobs.includes(cond.job_id);
    case 'quest': return characterStory(c!).done.includes(cond.quest_id);
    case 'fact': return hasFact(world, cond.id);
    case 'tag': return hasTag(world, c!, cond.tag);
    case 'opinion': {
      const n = world.npcs.get(cond.npc_id);
      const v = n ? opinionOf(n, c!.id) : 0;
      return !!n && (cond.at_least === undefined || v >= cond.at_least) && (cond.at_most === undefined || v <= cond.at_most);
    }
    case 'narrative': return false;
    case 'any': return cond.of.some((x) => holds(world, c, x));
    case 'all': return cond.of.every((x) => holds(world, c, x));
    case 'not': return !holds(world, c, cond.of);
  }
}

/**
 * ¿Cuenta como hecho por este PJ? Igual que `holds`, pero las condiciones del
 * mundo (que un NPC tenga algo, muera o esté en un sitio; el estado de un
 * punto) solo valen si el PJ está en ese lugar: lo ha hecho él o su grupo,
 * delante de él. Para los pasos; los requisitos y la amenaza usan `holds`.
 */
export function credited(world: World, c: Character, cond: StoryCondition): boolean {
  const here = c.transit ? null : world.characterSpot(c)?.location_id ?? null;
  const npcHere = (id: Id) => { const n = world.npcs.get(id); return !!n && !!here && world.spots.get(n.location.id)?.location_id === here; };
  const spotHere = (id: Id) => !!here && world.spots.get(id)?.location_id === here;
  switch (cond.kind) {
    case 'npc_has': case 'npc_status': return npcHere(cond.npc_id) && holds(world, c, cond);
    case 'npc_at': case 'spot_state': return spotHere(cond.spot_id) && holds(world, c, cond);
    case 'any': return cond.of.some((x) => credited(world, c, x));
    case 'all': return cond.of.every((x) => credited(world, c, x));
    default: return holds(world, c, cond);
  }
}

/** Por qué se cumple, en palabras del jugador (en `any`, la primera rama que vale). */
export function explain(world: World, c: Character, cond: StoryCondition): string {
  const spot = (id: Id) => world.spots.get(id)?.name ?? id;
  const loc = (id: Id) => world.locations.get(id)?.name ?? id;
  const item = (id: Id) => world.itemDefs.get(id)?.name ?? id;
  const npc = (id: Id) => nameFor(world, c, id);
  const qty = (n?: number) => ((n ?? 1) > 1 ? ` ×${n}` : '');
  switch (cond.kind) {
    case 'clue': return `conseguiste la pista «${world.campaign.clues.find((x) => x.id === cond.clue_id)?.title ?? cond.clue_id}»`;
    case 'visit': return `llegaste a ${spot(cond.spot_id)}`;
    case 'at_location': return `estás en ${loc(cond.location_id)}`;
    case 'visit_location': return `has estado en ${loc(cond.location_id)}`;
    case 'npc_at': return `${npc(cond.npc_id)} está en ${spot(cond.spot_id)}`;
    case 'carry': return `llevas ${item(cond.item_id)}${qty(cond.quantity)}`;
    case 'npc_has': return `${npc(cond.npc_id)} ya tiene ${item(cond.item_id)}${qty(cond.quantity)}`;
    case 'npc_status': return `${npc(cond.npc_id)} ${cond.status === 'dead' ? 'ha muerto' : cond.status === 'missing' ? 'ha desaparecido' : 'sigue con vida'}`;
    case 'attitude': return `${npc(cond.npc_id)} se fía más de ti`;
    case 'spot_state': return `ha cambiado ${spot(cond.spot_id)}`;
    case 'discovered': return `descubriste ${spot(cond.spot_id)}`;
    case 'knows': return `sabes quién es ${npc(cond.npc_id)}`;
    case 'trust': return `${npc(cond.npc_id)} te tiene por ${TRUST_LABEL[cond.at_least]}`;
    case 'step': return `diste el paso «${quest(world, cond.quest_id)?.steps.find((x) => x.id === cond.step_id)?.text ?? cond.step_id}»`;
    case 'talk': return `fuiste a ver a ${npc(cond.npc_id)}`;
    case 'level': return `ya eres de nivel ${cond.at_least}`;
    case 'reputation': return `tu reputación llega a ${cond.at_least}`;
    case 'debt_paid': return `saldaste lo que debías a ${npc(cond.npc_id)}`;
    case 'escalated': return 'ha pasado lo que se veía venir';
    case 'world_hours': return 'se ha hecho tarde';
    case 'job': return `cumpliste el encargo «${world.campaign.jobs.find((j) => j.id === cond.job_id)?.title ?? cond.job_id}»`;
    case 'quest': return `cumpliste «${quest(world, cond.quest_id)?.title ?? cond.quest_id}»`;
    case 'fact': return 'ha pasado lo que tenía que pasar';
    case 'tag': return 'por lo que se sabe de ti';
    case 'opinion': return `por lo que ${npc(cond.npc_id)} piensa de ti`;
    case 'narrative': return 'lo has hecho en la escena';
    case 'any': {
      const hit = cond.of.find((x) => credited(world, c, x)) ?? cond.of.find((x) => holds(world, c, x)) ?? cond.of[0];
      return hit ? explain(world, c, hit) : '';
    }
    case 'all': return cond.of.filter((x) => x.kind !== 'talk' || cond.of.length === 1).map((x) => explain(world, c, x)).filter(Boolean).join(' y ');
    case 'not': return 'no ha pasado lo que lo impedía';
  }
}

function isPersonal(cond: StoryCondition): boolean {
  return !['npc_has', 'npc_status', 'npc_at', 'spot_state', 'escalated', 'world_hours', 'fact', 'any', 'all', 'not'].includes(cond.kind);
}

// ---------------------------------------------------------------------------
// Consecuencias
// ---------------------------------------------------------------------------

const PERSONAL = new Set<StoryEffect['kind']>(['clue', 'give_item', 'reveal_spot', 'learn_place', 'know_npc', 'attitude', 'trust', 'tell']);

/**
 * Lo que el motor tiene que contar: al PJ (como progreso), a una localización,
 * y lo que pasa en la escena para que lo narre el máster (`beats`).
 */
export interface StoryOutput {
  personal: { character_id: Id; events: ProgressEvent[] }[];
  announcements: { location_id: Id; spot_id: Id | null; text: string; public: boolean }[];
  beats: { character_id: Id; text: string }[];
}

function out(): StoryOutput { return { personal: [], announcements: [], beats: [] }; }

export function emptyStoryOutput(): StoryOutput { return out(); }

/**
 * Aplica efectos de la historia desde fuera (las reglas del mundo, worldrules.ts): los del PJ a `c` (si lo hay),
 * los del mundo una sola vez por `key`. Lo que haya que contar sale en la salida, como el de un paso.
 */
export function applyStoryEffects(world: World, c: Character | null, effects: readonly StoryEffect[], key: string, nowS: number): StoryOutput {
  const o = out();
  applyEffects(world, c, effects, key, nowS, o);
  return o;
}

/** Efectos que se aplican a cada PJ (los demás, al mundo, una vez). */
export function isPersonalEffect(e: StoryEffect): boolean { return PERSONAL.has(e.kind); }

/** Si la confianza cambia de nivel, se le dice al PJ (los puntos no se enseñan). */
function tellTrust(world: World, c: Character, r: TrustResult, o: StoryOutput): void {
  const text = trustNotice(nameFor(world, c, r.npc_id), r);
  if (text) tellTo(o, c, [{ kind: 'trust', text }]);
}

function tellTo(o: StoryOutput, c: Character, events: ProgressEvent[]): void {
  if (!events.length) return;
  const slot = o.personal.find((p) => p.character_id === c.id);
  if (slot) slot.events.push(...events); else o.personal.push({ character_id: c.id, events: [...events] });
}

function change(q: StoryQuest, event: QuestChange['event'], why: string, step?: string): QuestChange {
  return { id: q.id, title: q.title, event, why, ...(step ? { step } : {}) };
}

function applyEffects(world: World, c: Character | null, effects: readonly StoryEffect[] | undefined, key: string, nowS: number, o: StoryOutput): void {
  const st = stateOf(world);
  (effects ?? []).forEach((e, i) => {
    if (PERSONAL.has(e.kind)) { if (c) applyPersonal(world, c, e, o); return; }
    const k = `${key}#${i}`;
    if (st.applied.includes(k)) return;
    st.applied.push(k);
    world.touch('campaign', world.campaign.id);
    applyWorld(world, e, nowS, o);
  });
}

function applyPersonal(world: World, c: Character, e: StoryEffect, o: StoryOutput): void {
  switch (e.kind) {
    case 'clue': {
      const r = grantClue(world, c, e.clue_id);
      if (r.ok) tellTo(o, c, r.events);
      break;
    }
    case 'give_item': {
      const def = world.itemDefs.get(e.item_id);
      if (!def) break;
      const q = e.quantity ?? 1;
      const placed = spawnItem(world, def.id, q, { type: 'character', id: c.id, slot: { kind: 'pocket' } }).ok
        || spawnItem(world, def.id, q, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } }).ok
        || spawnItem(world, def.id, q, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } }).ok
        || (world.characterSpot(c) && spawnItem(world, def.id, q, { type: 'spot', id: world.characterSpot(c)!.id }).ok);
      if (placed) tellTo(o, c, [{ kind: 'story', text: `Recibes: ${def.name}${q > 1 ? ` ×${q}` : ''}.` }]);
      break;
    }
    case 'reveal_spot': {
      const sp = world.spots.get(e.spot_id);
      if (sp && !sp.discovered_by.includes(c.id)) { sp.discovered_by.push(c.id); world.touch('spots', sp.id); }
      break;
    }
    case 'learn_place': {
      const l = world.locations.get(e.location_id);
      if (l && !l.discovery[c.id]) { l.discovery[c.id] = 'heard_of'; world.touch('locations', l.id); }
      break;
    }
    case 'know_npc':
      if (!c.knows.includes(e.npc_id)) { c.knows.push(e.npc_id); world.touch('characters', c.id); }
      break;
    case 'attitude': {
      const n = world.npcs.get(e.npc_id);
      if (n) { n.attitude.by_character[c.id] = e.attitude; world.touch('npcs', n.id); }
      break;
    }
    case 'trust': {
      const n = world.npcs.get(e.npc_id);
      if (!n) break;
      const nowS = stateOf(world).last_game_s ?? 0;
      if (e.change) tellTrust(world, c, adjustTrust(world, n, c, e.change, nowS), o);
      if (e.at_least && !trustAtLeast(n, c.id, e.at_least)) {
        const st = (n.trust ??= {})[c.id] ??= { points: 0 };
        st.points = Math.max(st.points, TRUST_THRESHOLD[e.at_least]);
        world.touch('npcs', n.id);
      }
      break;
    }
    case 'tell': o.beats.push({ character_id: c.id, text: e.text }); break;
    default: break;
  }
}

function applyWorld(world: World, e: StoryEffect, nowS: number, o: StoryOutput): void {
  const camp = world.campaign as typeof world.campaign & StoryCampaign;
  switch (e.kind) {
    case 'npc_move': {
      const n = world.npcs.get(e.npc_id);
      if (!n || !world.spots.has(e.spot_id)) break;
      // Se queda allí: su horario lo devolvería (otro npc_routine detrás le pone uno nuevo).
      n.location = { type: 'spot', id: e.spot_id }; n.talking_to = null;
      delete (n as Npc & { routine?: NpcRoutine }).routine;
      world.touch('npcs', n.id);
      break;
    }
    case 'npc_status': {
      const n = world.npcs.get(e.npc_id) as HidingNpc | undefined;
      if (!n) break;
      n.status = e.status;
      if (e.status === 'missing' && e.hideout_spot_id && world.spots.has(e.hideout_spot_id)) {
        n.location = { type: 'spot', id: e.hideout_spot_id }; n.talking_to = null;
        n.hideout_spot_id = e.hideout_spot_id;
        delete n.routine;
      } else delete n.hideout_spot_id;
      world.touch('npcs', n.id);
      break;
    }
    case 'npc_attitude_all': {
      const n = world.npcs.get(e.npc_id);
      if (n) { n.attitude.default = e.attitude; n.attitude.by_character = {}; world.touch('npcs', n.id); }
      break;
    }
    case 'npc_routine': {
      const n = world.npcs.get(e.npc_id) as (Npc & { routine?: NpcRoutine }) | undefined;
      if (!n) break;
      if (e.routine) n.routine = { ...e.routine }; else delete n.routine;
      world.touch('npcs', n.id);
      break;
    }
    case 'spot_state': {
      const sp = world.spots.get(e.spot_id);
      if (sp) { Object.assign(sp.state, structuredClone(e.patch)); world.touch('spots', sp.id); }
      break;
    }
    case 'location_state': {
      const l = world.locations.get(e.location_id);
      if (l) { Object.assign(l.state, structuredClone(e.patch)); world.touch('locations', l.id); }
      break;
    }
    case 'unhide_spot': {
      const sp = world.spots.get(e.spot_id);
      if (sp && sp.hidden) { sp.hidden = false; world.touch('spots', sp.id); }
      break;
    }
    case 'exit_state': {
      const x = world.exits.get(e.exit_id);
      if (x) {
        for (const [k, v] of Object.entries(e.patch)) { if (v === null) delete x.state[k]; else x.state[k] = v; }
        world.touch('exits', x.id);
      }
      break;
    }
    case 'hook': {
      if ((camp.hooks ?? []).some((h) => h.id === e.id)) break;
      const trigger: Hook['trigger'] = e.trigger === 'time' ? { kind: 'time', at_game_s: nowS + Math.round((e.minutes ?? 1) * 60) }
        : e.trigger === 'spot' ? { kind: 'spot', spot_id: e.spot_id! } : { kind: 'location' };
      const expires = e.expires_hours !== undefined ? nowS + e.expires_hours * GAME_HOUR : trigger.kind === 'time' ? trigger.at_game_s + GAME_HOUR : null;
      (camp.hooks ??= []).push({ id: e.id, location_id: e.location_id, trigger, what: e.what, for_character_id: null, created_game_s: nowS, expires_game_s: expires });
      break;
    }
    case 'schedule': {
      const list = (camp.schedule ??= []);
      if (list.some((x) => x.id === e.event.id)) break;
      const ev: ScheduledEvent = { ...structuredClone(e.event), source: 'seed' };
      if (ev.recurrence === 'once') ev.at_game_s = nowS + Math.round((e.in_hours ?? 0) * GAME_HOUR);
      list.push(ev);
      break;
    }
    case 'cancel_schedule': {
      const list = camp.schedule ?? [];
      const i = list.findIndex((x) => x.id === e.event_id);
      if (i >= 0) list.splice(i, 1);
      break;
    }
    case 'rumor': {
      const list = (camp.rumors ??= []);
      if (list.some((r) => r.id === e.id)) break;
      list.push({
        id: e.id, kind: e.rumor_kind, name: e.name, hint: e.hint, where: e.where ?? null, said_by: null, location_id: e.location_id,
        status: 'open', mentions: 1, origin: { actor_id: 'mundo', game_s: nowS, location_id: e.location_id, action: null },
        expires_game_s: nowS + (e.days ?? 7) * 24 * GAME_HOUR, thread: null,
      });
      break;
    }
    case 'announce':
      o.announcements.push({ location_id: e.location_id, spot_id: e.spot_id ?? null, text: e.text, public: e.public ?? false });
      break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Estado de cada misión
// ---------------------------------------------------------------------------

function quest(world: World, id: Id): StoryQuest | undefined { return storyOf(world)?.quests.find((q) => q.id === id); }

/** Regla de `on_npc_dead` por la que sigue la misión, si va por otro camino. */
function reroute(c: Character, q: StoryQuest): Extract<StoryNpcDead, { outcome: 'reroute' }> | null {
  const id = characterStory(c).rerouted?.[q.id];
  const r = id ? q.on_npc_dead?.find((x) => x.npc_id === id && x.outcome === 'reroute') : undefined;
  return r && r.outcome === 'reroute' ? r : null;
}

/** Los pasos que valen para este PJ: los de la misión o, si va por otro camino, los de ese camino. */
export function stepsOf(c: Character, q: StoryQuest): StoryStep[] {
  return reroute(c, q)?.steps ?? q.steps;
}

/** Quién recibe la misión al entregarla (null: se cumple sola al dar el último paso). */
export function turnInOf(c: Character, q: StoryQuest): Id | null {
  const r = reroute(c, q);
  if (r && r.turn_in_npc_id !== undefined) return r.turn_in_npc_id;
  return q.turn_in_npc_id !== undefined ? q.turn_in_npc_id : q.giver_npc_id;
}

/** Si una regla del mundo ha abierto o cerrado esta pista para el PJ (worldrules.ts, efecto `lead`). */
export function leadOf(c: Character, q: StoryQuest, s: StoryStep): 'open' | 'closed' | null {
  return characterStory(c).leads?.[stepKey(q, s)] ?? null;
}

/** Paso en curso de una misión abierta: el primero sin dar de los que hacen falta (las pistas opcionales y las cerradas, no). */
export function currentStep(c: Character, q: StoryQuest): StoryStep | null {
  const st = characterStory(c);
  return stepsOf(c, q).find((s) => !s.optional && leadOf(c, q, s) !== 'closed' && !st.steps.includes(stepKey(q, s))) ?? null;
}

/** ¿Alguien cumplió ya una misión de este grupo excluyente? */
function exclusiveTaken(world: World, q: StoryQuest): StoryQuest | null {
  if (!q.exclusive) return null;
  for (const c of world.characters.values()) {
    for (const id of characterStory(c).done) {
      const d = quest(world, id);
      if (d && d.id !== q.id && d.exclusive === q.exclusive) return d;
    }
  }
  return null;
}

/** Por qué nadie le puede pedir ahora esta misión al PJ (para el máster), o null si está disponible. */
export function whyLocked(world: World, c: Character, q: StoryQuest): string | null {
  if (q.main_for || !q.giver_npc_id) return 'no la pide nadie: es una misión principal';
  const g = world.npcs.get(q.giver_npc_id);
  if (!g || g.status !== 'alive') return `${nameFor(world, c, q.giver_npc_id)} ya no puede pedirla`;
  if (c.level < (q.min_level ?? 1)) return `pide nivel ${q.min_level} y el actor es de nivel ${c.level}`;
  if (q.requires && !holds(world, c, q.requires)) return `aún no: falta ${describeCondition(world, q.requires)}`;
  const taken = exclusiveTaken(world, q);
  if (taken) return `el valle ya ha elegido otro final («${taken.title}»)`;
  return null;
}

export function questStatus(world: World, c: Character, q: StoryQuest): StoryStatus {
  const st = characterStory(c);
  if (st.done.includes(q.id)) return 'done';
  if (st.failed?.includes(q.id)) return 'failed';
  if (st.expired.includes(q.id)) return 'expired';
  if (st.open.includes(q.id)) return currentStep(c, q) ? 'active' : 'ready';
  if (st.declined?.[q.id] !== undefined) return 'declined';
  return whyLocked(world, c, q) === null ? 'available' : 'locked';
}

/**
 * ¿Ha pedido ya ese NPC una misión en esta charla? Quien tiene varias, las pide de una en una: si el jugador quiere
 * más, que pregunte, y el máster la pide con story_quest ask.
 */
function askedInTalk(world: World, c: Character, n: Npc): boolean {
  const since = n.talking_to?.since_game_s ?? Infinity;
  return (characterStory(c).log ?? []).some((x) => (x.kind === 'open' || x.kind === 'offered' || x.kind === 'declined') && x.game_s >= since && quest(world, x.quest_id)?.giver_npc_id === n.id);
}

/** NPC al final de un paso: con quien hay que estar, a quien dar algo o quien da su pista. */
function stepNpcs(world: World, cond: StoryCondition): Id[] {
  switch (cond.kind) {
    case 'talk': case 'npc_has': case 'npc_at': return [cond.npc_id];
    case 'clue': return world.campaign.clues.find((x) => x.id === cond.clue_id)?.npc_ids ?? [];
    case 'any': case 'all': return cond.of.flatMap((x) => stepNpcs(world, x));
    default: return [];
  }
}

/** ¿Se ve ya este paso en el Diario? Los dados, sí; una pista, cuando alguien la ha mencionado; si no, el actual. */
export function stepVisible(world: World, c: Character, q: StoryQuest, s: StoryStep): boolean {
  if (characterStory(c).steps.includes(stepKey(q, s))) return true;
  const lead = leadOf(c, q, s);
  if (lead) return lead === 'open';
  if (s.revealed_by) return holds(world, c, s.revealed_by);
  if (!q.any_order) return currentStep(c, q)?.id === s.id;
  return stepsOf(c, q).find((x) => !x.revealed_by && !characterStory(c).steps.includes(stepKey(q, x)))?.id === s.id;
}

/**
 * Lo oído en primera persona del grupo: «En la barra dicen que Brenna busca…» → «Hemos oído en la barra que Brenna
 * busca…»; «Dicen que el cazador…» → «Hemos oído que el cazador…».
 */
export function heardLine(text: string): string {
  const m = /^(.*?)\s*dicen que (.*)$/i.exec(text.trim());
  if (!m) return `Hemos oído que ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return `Hemos oído ${m[1] ? `${m[1].charAt(0).toLowerCase()}${m[1].slice(1)} ` : ''}que ${m[2]}`;
}

/** El texto del rumor, con quien la da como lo conoce el PJ. */
export function rumorText(world: World, c: Character, q: StoryQuest): string {
  return q.rumor ? cap(q.rumor.text.replaceAll('{giver}', q.giver_npc_id ? nameFor(world, c, q.giver_npc_id) : 'alguien')) : '';
}

/**
 * NPC al final de una pista activa del PJ (la web les pone un punto discreto): quien da una misión de la que ha
 * oído hablar, a quien hay que entregar una lista, y con quien lleva el paso en curso o una pista mencionada. Nada
 * por tener una misión disponible: eso no se ve hasta que se la piden.
 */
export function questLeads(world: World, c: Character): Set<Id> {
  const leads = new Set<Id>();
  const st = characterStory(c);
  for (const q of storyOf(world)?.quests ?? []) {
    const s = questStatus(world, c, q);
    if (s === 'available' && st.rumors?.[q.id] !== undefined && q.giver_npc_id) leads.add(q.giver_npc_id);
    else if (s === 'ready') { const t = turnInOf(c, q); if (t) leads.add(t); }
    else if (s === 'active') {
      for (const x of stepsOf(c, q)) {
        if (st.steps.includes(stepKey(q, x)) || !stepVisible(world, c, q, x)) continue;
        for (const id of stepNpcs(world, x.done_when)) leads.add(id);
      }
    }
  }
  for (const id of [...leads]) if (world.npcs.get(id)?.status !== 'alive') leads.delete(id);
  return leads;
}

/** Rumores de misiones que el PJ ha oído y siguen vigentes (la misión aún no la tiene ni se la han ofrecido). */
export function storyRumors(world: World, c: Character): { quest: StoryQuest; text: string; game_s: number }[] {
  const st = characterStory(c);
  return (storyOf(world)?.quests ?? [])
    .filter((q) => st.rumors?.[q.id] !== undefined && questStatus(world, c, q) === 'available')
    .map((q) => ({ quest: q, text: rumorText(world, c, q), game_s: st.rumors![q.id]! }));
}

// ---------------------------------------------------------------------------
// Avance
// ---------------------------------------------------------------------------

/** Abre una misión para el PJ: se la piden en escena (aceptar es implícito), la toma él, o la principal al empezar. */
function openQuest(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput, origin: QuestOrigin): void {
  const st = characterStory(c);
  if (!st.open.includes(q.id)) st.open.push(q.id);
  if (st.offered) delete st.offered[q.id];
  if (st.declined) delete st.declined[q.id];
  st.origins = { ...(st.origins ?? {}), [q.id]: origin };
  st.opened_rests = { ...(st.opened_rests ?? {}), [q.id]: st.rests ?? 0 };
  logStory(world, c, { quest_id: q.id, kind: 'open', game_s: nowS, why: origin.text });
  // La principal no lleva aviso: es la situación con la que llega, y la cuenta su prólogo.
  if (origin.kind !== 'main') tellTo(o, c, [{ kind: 'story', text: `📖 Nueva misión (acto ${ROMAN[q.act]}): «${q.title}». ${origin.text}. ${q.text}`, quest: { ...change(q, 'open', origin.text), ...(origin.kind === 'giver' ? { declinable: true } : {}) } }]);
  // Quien te da una misión se presenta.
  if (q.giver_npc_id) applyPersonal(world, c, { kind: 'know_npc', npc_id: q.giver_npc_id }, o);
  applyEffects(world, c, q.on_accept, `${q.id}:open`, nowS, o);
}

/** Quien la da se la pide al PJ en escena: entra en el Diario, activa. */
function ask(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput): void {
  const name = world.npcs.get(q.giver_npc_id!)?.name ?? nameFor(world, c, q.giver_npc_id!);
  openQuest(world, c, q, nowS, o, { kind: 'giver', game_s: nowS, location_id: c.transit ? null : world.characterSpot(c)?.location_id ?? null, text: `${name} nos lo pidió` });
}

/** Plazo de una misión abierta: se pierde (true) o, si queda poco, avisa una vez. */
function deadlineHit(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput): boolean {
  const d = q.deadline;
  if (!d) return false;
  const st = characterStory(c);
  const left = d.rests !== undefined ? d.rests - ((st.rests ?? 0) - (st.opened_rests?.[q.id] ?? st.rests ?? 0)) : Infinity;
  if (left <= 0 || (d.milestone && holds(world, null, d.milestone))) {
    fail(world, c, q, nowS, o, d.lost);
    applyEffects(world, c, d.on_lost, `${q.id}:lost`, nowS, o);
    return true;
  }
  if ((left === 1 || (d.warn_when && holds(world, null, d.warn_when))) && !st.warned?.includes(q.id)) {
    st.warned = [...(st.warned ?? []), q.id];
    logStory(world, c, { quest_id: q.id, kind: 'warned', game_s: nowS, why: d.warn });
    tellTo(o, c, [{ kind: 'story', text: `⏳ «${q.title}»: ${d.warn}`, quest: change(q, 'warned', d.warn) }]);
  }
  return false;
}

/** Cuenta los descansos largos del PJ (los apunta rest.ts en `character.rest`), para los plazos. */
function countRests(c: Character): void {
  const st = characterStory(c);
  const last = (c as Character & { rest?: { last_long_rest_game_s?: number | null } }).rest?.last_long_rest_game_s ?? null;
  if (st.rest_seen === undefined) { st.rest_seen = last; st.rests ??= 0; return; }
  if (last !== null && last !== st.rest_seen) { st.rests = (st.rests ?? 0) + 1; st.rest_seen = last; }
}

function fail(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput, why: string): void {
  const st = characterStory(c);
  st.open = st.open.filter((x) => x !== q.id);
  if (st.offered) delete st.offered[q.id];
  st.failed = [...(st.failed ?? []), q.id];
  logStory(world, c, { quest_id: q.id, kind: 'failed', game_s: nowS, why });
  tellTo(o, c, [{ kind: 'story', text: `✗ «${q.title}»: ${cap(why).replace(/\.$/, '')}.`, quest: change(q, 'failed', why) }]);
}

/** Muertes que cambian una misión abierta: falla o sigue por otro camino. true si ha fallado. */
function npcDeaths(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput): boolean {
  const st = characterStory(c);
  const dead = (id: Id | null) => !!id && world.npcs.get(id)?.status === 'dead';
  for (const r of q.on_npc_dead ?? []) {
    if (!dead(r.npc_id)) continue;
    if (r.outcome === 'fail') { fail(world, c, q, nowS, o, r.why); return true; }
    if (st.rerouted?.[q.id]) continue;
    st.rerouted = { ...(st.rerouted ?? {}), [q.id]: r.npc_id };
    logStory(world, c, { quest_id: q.id, kind: 'changed', game_s: nowS, why: r.why });
    tellTo(o, c, [{ kind: 'story', text: `La misión «${q.title}» cambia: ${r.why}.`, quest: change(q, 'changed', r.why) }]);
  }
  const t = turnInOf(c, q);
  if (dead(t)) { fail(world, c, q, nowS, o, `${nameFor(world, c, t!)} murió antes de que pudiéramos terminarlo`); return true; }
  return false;
}

/** Pasos y entrega de una misión abierta. */
function progress(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput): void {
  const st = characterStory(c);
  if (q.any_order) {
    for (const s of stepsOf(c, q)) if (!st.steps.includes(stepKey(q, s)) && leadOf(c, q, s) !== 'closed' && credited(world, c, s.done_when)) markStep(world, c, q, s, nowS, o, explain(world, c, s.done_when));
  } else {
    for (let s = currentStep(c, q); s && credited(world, c, s.done_when); s = currentStep(c, q)) markStep(world, c, q, s, nowS, o, explain(world, c, s.done_when));
  }
  if (currentStep(c, q) || !st.open.includes(q.id)) return;
  const t = turnInOf(c, q);
  const n = t ? world.npcs.get(t) : undefined;
  if (!n) { complete(world, c, q, nowS, o, null); return; }
  if (talkingWith(n, c)) { complete(world, c, q, nowS, o, n.id); return; }
  if (!(st.log ?? []).some((x) => x.quest_id === q.id && x.kind === 'ready')) {
    const why = `tenemos que volver con ${nameFor(world, c, n.id)}`;
    logStory(world, c, { quest_id: q.id, kind: 'ready', game_s: nowS, why });
    tellTo(o, c, [{ kind: 'story', text: `«${q.title}»: ya lo tenemos todo; ${why}.`, quest: change(q, 'ready', why) }]);
  }
}

/** Abre, ofrece, avanza y cierra las misiones de un PJ. */
function advanceCharacter(world: World, c: Character, nowS: number, o: StoryOutput): void {
  const story = storyOf(world);
  if (!story) return;
  const st = characterStory(c);
  const here = c.transit ? null : world.characterSpot(c)?.location_id ?? null;
  countRests(c);
  // Un rumor por vez: si en un sitio se oyen varios, llegan en ticks seguidos y no de golpe.
  let heard = false;
  for (const q of story.quests) {
    if (st.done.includes(q.id) || st.expired.includes(q.id) || st.failed?.includes(q.id)) continue;
    const taken = exclusiveTaken(world, q);
    if (taken) {
      const known = st.open.includes(q.id) || st.offered?.[q.id] !== undefined || st.declined?.[q.id] !== undefined;
      st.open = st.open.filter((x) => x !== q.id);
      if (st.offered) delete st.offered[q.id];
      st.expired.push(q.id);
      world.touch('characters', c.id);
      if (known) {
        const why = `el valle ya ha elegido otro final («${taken.title}»)`;
        logStory(world, c, { quest_id: q.id, kind: 'expired', game_s: nowS, why });
        tellTo(o, c, [{ kind: 'story', text: `La misión «${q.title}» se cierra: ${why}.`, quest: change(q, 'expired', why) }]);
      }
      continue;
    }
    // La principal: la del PJ con esa situación, desde el principio.
    if (q.main_for && !st.open.includes(q.id)) {
      const sit = c.situation?.id;
      if (!sit || !q.main_for.includes(sit)) continue;
      openQuest(world, c, q, nowS, o, { kind: 'main', game_s: nowS, location_id: here, text: 'Lo que te trae aquí' });
    }
    // Partidas de antes: una oferta sin respuesta es que se la pidieron.
    if (st.offered?.[q.id] !== undefined && !st.open.includes(q.id)) {
      if (whyLocked(world, c, q)) { delete st.offered[q.id]; world.touch('characters', c.id); continue; }
      ask(world, c, q, nowS, o);
    }
    if (st.open.includes(q.id)) {
      if (!npcDeaths(world, c, q, nowS, o) && !deadlineHit(world, c, q, nowS, o)) progress(world, c, q, nowS, o);
      continue;
    }
    if (st.declined?.[q.id] !== undefined || whyLocked(world, c, q)) continue;
    const giver = world.npcs.get(q.giver_npc_id!)!;
    if (talkingWith(giver, c) && !askedInTalk(world, c, giver)) {
      // Pedida en escena: entra activa y cuenta ya lo que el PJ haya hecho (llevar el agua encima).
      ask(world, c, q, nowS, o);
      if (!npcDeaths(world, c, q, nowS, o)) progress(world, c, q, nowS, o);
      continue;
    }
    if (!heard && q.rumor && st.rumors?.[q.id] === undefined && !talkingWith(giver, c) && holds(world, c, q.rumor.where)) {
      heard = true;
      st.rumors = { ...(st.rumors ?? {}), [q.id]: nowS };
      const text = rumorText(world, c, q);
      logStory(world, c, { quest_id: q.id, kind: 'rumor', game_s: nowS, why: text });
      tellTo(o, c, [{ kind: 'story', text: heardLine(text), quest: { id: q.id, title: '', event: 'rumor', why: text } }]);
    }
  }
}

/** Los que están con él cuando da un paso: PJ activos, presentes (no ausentes) y en su misma localización. */
function companionsOf(world: World, c: Character): Character[] {
  const loc = world.characterSpot(c)?.location_id;
  return [...world.characters.values()].filter((o) => o.id !== c.id && o.status === 'active' && !o.away && !o.transit && world.characterSpot(o)?.location_id === loc);
}

function markStep(world: World, c: Character, q: StoryQuest, s: StoryStep, nowS: number, o: StoryOutput, why: string): void {
  const key = stepKey(q, s);
  characterStory(c).steps.push(key);
  logStory(world, c, { quest_id: q.id, kind: 'step', step_id: s.id, game_s: nowS, why });
  if (stepsOf(c, q).length > 1 || turnInOf(c, q)) tellTo(o, c, [{ kind: 'story', text: `✔ «${q.title}»: ${s.journal ?? s.text}`, quest: change(q, 'step', why, s.text) }]);
  // Crédito compartido: quien estaba presente y va por ese mismo paso de la misión, lo da también.
  const st = stateOf(world);
  const shared = companionsOf(world, c).filter((p) => characterStory(p).open.includes(q.id) && currentStep(p, q)?.id === s.id);
  if (!st.credits?.[key]) { st.credits = { ...(st.credits ?? {}), [key]: { by: c.id, with: companionsOf(world, c).map((p) => p.id), game_s: nowS } }; world.touch('campaign', world.campaign.id); }
  for (const p of shared) {
    characterStory(p).steps.push(key);
    const withWhy = `con ${c.name}: ${why}`;
    logStory(world, p, { quest_id: q.id, kind: 'step', step_id: s.id, game_s: nowS, why: withWhy });
    world.touch('characters', p.id);
    tellTo(o, p, [{ kind: 'story', text: `✔ «${q.title}»: ${s.text} (con ${c.name})`, quest: change(q, 'step', withWhy, s.text) }]);
  }
  applyEffects(world, c, s.on_done, key, nowS, o);
}

/** Cumplida: entregada a `byNpc` (que da la recompensa) o, sin entrega, al dar el último paso. */
function complete(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput, byNpc: Id | null): void {
  if (q.exclusive) {
    const ss = stateOf(world);
    if (!ss.finals?.some((f) => f.quest_id === q.id)) {
      ss.finals = [...(ss.finals ?? []), { quest_id: q.id, by: c.id, with: companionsOf(world, c).map((p) => p.id), game_s: nowS }];
      world.touch('campaign', world.campaign.id);
    }
  }
  const st = characterStory(c);
  st.open = st.open.filter((x) => x !== q.id);
  st.done.push(q.id);
  const r = q.reward;
  const bits: string[] = [];
  if (r.coins) { c.coins += r.coins; bits.push(`+${money(world, r.coins)}`); }
  if (r.xp) { c.xp += r.xp; bits.push(`+${r.xp} PX`); }
  if (r.reputation) bits.push(`reputación en ${world.campaign.factions.find((f) => f.id === world.campaign.achievement.faction_id)?.name ?? 'la aldea'}: ${addReputation(world, c, world.campaign.achievement.faction_id, r.reputation)}`);
  if (r.item_id && world.itemDefs.has(r.item_id)) {
    const spot = world.characterSpot(c);
    const placed = spawnItem(world, r.item_id, 1, { type: 'character', id: c.id, slot: { kind: 'pocket' } }).ok
      || spawnItem(world, r.item_id, 1, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } }).ok
      || spawnItem(world, r.item_id, 1, { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } }).ok
      || (!!spot && spawnItem(world, r.item_id, 1, { type: 'spot', id: spot.id }).ok);
    if (placed) bits.push(world.itemDef(r.item_id).name);
  }
  const steps = stepsOf(c, q);
  const why = byNpc ? `se lo contamos a ${nameFor(world, c, byNpc)}` : 'lo hemos conseguido';
  logStory(world, c, { quest_id: q.id, kind: 'done', game_s: nowS, why });
  const head = byNpc ? `🏁 Misión entregada a ${nameFor(world, c, byNpc)}` : '🏁 Misión cumplida';
  tellTo(o, c, [{ kind: 'story', text: `${head}: «${q.title}»${bits.length ? ` (${bits.join(', ')})` : ''}.`, quest: change(q, 'done', bits.length ? `${why} · ${bits.join(', ')}` : why), ...(q.ending ? { public: q.ending.replaceAll('{name}', c.name) } : {}) }]);
  // Quien la encargó y quien la recibe se fían más (trust.ts): una misión cumplida pesa más que una charla.
  for (const id of new Set([q.giver_npc_id, byNpc].filter((x): x is Id => !!x))) {
    const n = world.npcs.get(id);
    if (n && n.status === 'alive') tellTrust(world, c, adjustTrust(world, n, c, 'quest', nowS), o);
  }
  applyEffects(world, c, q.on_complete, `${q.id}:done`, nowS, o);
  // La reputación de la recompensa también cuenta para el logro.
  if (r.reputation) { const ach = checkAchievement(world, c); if (ach) tellTo(o, c, [ach]); }
}

/** Escalones de la amenaza vencidos: pasan (o se evitan) una sola vez. */
function escalate(world: World, nowS: number, o: StoryOutput): void {
  const story = storyOf(world);
  if (!story) return;
  const st = stateOf(world);
  for (const e of story.escalation) {
    if (st.escalated.includes(e.id) || st.escalated.includes(`!${e.id}`)) continue;
    if (nowS < st.started_game_s + e.after_hours * GAME_HOUR) continue;
    const averted = holds(world, null, e.unless);
    st.escalated.push(averted ? `!${e.id}` : e.id);
    world.touch('campaign', world.campaign.id);
    if (averted) continue;
    o.announcements.push({ location_id: e.location_id, spot_id: e.spot_id ?? null, text: e.text, public: false });
    applyEffects(world, null, e.effects, `esc:${e.id}`, nowS, o);
  }
}

type HidingNpc = Npc & { routine?: NpcRoutine; hideout_spot_id?: Id };

/** Escondite de un NPC desaparecido (efecto npc_status con hideout_spot_id), o null. */
export function hideoutOf(n: Npc): Id | null {
  return n.status === 'missing' ? (n as HidingNpc).hideout_spot_id ?? null : null;
}

/** Un PJ parado en el escondite da con quien se esconde: vuelve a estar a la vista, allí mismo y sin horario. */
function findHidden(world: World, o: StoryOutput): void {
  for (const n of world.npcs.values()) {
    const at = hideoutOf(n);
    if (!at) continue;
    const finder = world.charactersAt(at).find((c) => c.status === 'active' && !c.transit);
    if (!finder) continue;
    n.status = 'alive';
    delete (n as HidingNpc).hideout_spot_id;
    world.touch('npcs', n.id);
    if (!finder.knows.includes(n.id)) { finder.knows.push(n.id); world.touch('characters', finder.id); }
    tellTo(o, finder, [{ kind: 'story', text: `Das con ${n.name}, escondido en ${world.spot(at).name}.` }]);
  }
}

/** En cada tick y tras cada acción: amenaza y misiones de todos los PJ. Sin historia, no hace nada. */
export function tickStory(world: World, nowS: number): StoryOutput {
  const o = out();
  if (!storyOf(world)) return o;
  stateOf(world).last_game_s = nowS;
  findHidden(world, o);
  escalate(world, nowS, o);
  for (const c of world.characters.values()) {
    if (c.status === 'retired' || c.status === 'dead') continue;
    advanceCharacter(world, c, nowS, o);
  }
  return o;
}

/** Las misiones de un PJ, ya (tras un tool del máster que cambia el mundo): lo que pasa va en la misma respuesta. */
export function advanceNow(world: World, c: Character, nowS: number): StoryOutput {
  const o = out();
  if (storyOf(world)) advanceCharacter(world, c, nowS, o);
  return o;
}

type StoryResult = { ok: true; output: StoryOutput } | { ok: false; error: string };

/** El máster marca un paso narrativo (tool advance_story). Después avanza lo que haya detrás. */
export function advanceStory(world: World, c: Character, questId: Id, stepId: Id, nowS: number, why?: string | null): StoryResult {
  const q = quest(world, questId);
  if (!q) return { ok: false, error: `misión desconocida: ${questId}` };
  const st = characterStory(c);
  if (st.done.includes(q.id)) return { ok: false, error: 'esa misión ya está cumplida' };
  if (!st.open.includes(q.id)) return { ok: false, error: `esa misión no la tiene el actor (${questStatus(world, c, q)}): primero se la tienen que ofrecer y la tiene que aceptar` };
  const s = currentStep(c, q);
  const target = q.any_order ? stepsOf(c, q).find((x) => x.id === stepId && !st.steps.includes(stepKey(q, x))) ?? null : s;
  if (!target || target.id !== stepId) return { ok: false, error: `el paso en curso de «${q.title}» es ${s ? `${s.id} («${s.text}»)` : 'ninguno: está lista para entregar'}` };
  if (!isNarrative(target.done_when)) return { ok: false, error: `ese paso lo detecta el servidor solo (${describeCondition(world, target.done_when)}); no hace falta advance_story` };
  if (!markable(world, c, target.done_when)) return { ok: false, error: `aún no se puede dar: ${describeCondition(world, target.done_when)}` };
  const o = out();
  markStep(world, c, q, target, nowS, o, why?.trim() || explain(world, c, target.done_when));
  advanceCharacter(world, c, nowS, o);
  world.touch('characters', c.id);
  return { ok: true, output: o };
}

/** Paso que puede marcar el máster: narrativo, o con una alternativa narrativa. */
function isNarrative(cond: StoryCondition): boolean {
  return cond.kind === 'narrative' || ((cond.kind === 'any' || cond.kind === 'all') && cond.of.some(isNarrative));
}

/** ¿Puede marcarlo ya el máster? En un `all`, lo que no es narrativo tiene que cumplirse (p. ej., estar con quien toca). */
function markable(world: World, c: Character, cond: StoryCondition): boolean {
  switch (cond.kind) {
    case 'narrative': return true;
    case 'any': return cond.of.some((x) => isNarrative(x) && markable(world, c, x));
    case 'all': return cond.of.every((x) => (isNarrative(x) ? markable(world, c, x) : credited(world, c, x)));
    default: return false;
  }
}

/**
 * El ciclo desde el máster (story_quest) o la web: `ask`, quien la da se la pide en escena (entra en el Diario,
 * activa); `accept`, el PJ la toma (se ofrece él, o cambia de idea tras decir que no); `decline`, dice que no
 * (mientras no haya dado ningún paso; el Diario lo apunta); `turn_in`, la entrega a quien la recibe.
 */
export function storyQuestAction(world: World, c: Character, questId: Id, action: 'ask' | 'offer' | 'accept' | 'decline' | 'turn_in', nowS: number): StoryResult {
  const q = quest(world, questId);
  if (!q) return { ok: false, error: `misión desconocida: ${questId}` };
  const st = characterStory(c);
  const status = questStatus(world, c, q);
  const o = out();
  const giverName = q.giver_npc_id ? nameFor(world, c, q.giver_npc_id) : null;
  if (action === 'turn_in') {
    if (status !== 'ready') return { ok: false, error: status === 'active' ? `aún no está lista: falta «${currentStep(c, q)!.text}»` : `no hay nada que entregar (${status})` };
    const t = turnInOf(c, q);
    if (t && !withNpc(world, c, t)) return { ok: false, error: `se entrega a ${nameFor(world, c, t)}, que no está con el actor` };
    complete(world, c, q, nowS, o, t);
    advanceCharacter(world, c, nowS, o);
    return { ok: true, output: o };
  }
  if (action === 'decline') {
    const started = q.steps.some((s) => st.steps.includes(stepKey(q, s)));
    if (q.main_for) return { ok: false, error: 'la misión principal no se puede rechazar' };
    if (status === 'declined') return { ok: true, output: o };
    if (!(status === 'available' || (status === 'active' && !started))) return { ok: false, error: status === 'active' ? 'ya ha empezado: no se puede decir que no' : `no hay nada que rechazar (${status})` };
    if (status === 'available' && !withNpc(world, c, q.giver_npc_id!)) return { ok: false, error: `nadie se la ha pedido: la pide ${giverName}, que no está con el actor` };
    st.open = st.open.filter((x) => x !== q.id);
    st.declined = { ...(st.declined ?? {}), [q.id]: nowS };
    const why = `no quisimos ayudar a ${giverName}`;
    logStory(world, c, { quest_id: q.id, kind: 'declined', game_s: nowS, why });
    tellTo(o, c, [{ kind: 'story', text: `No aceptas «${q.title}». Si cambias de idea, ${giverName} sigue ahí.`, quest: change(q, 'declined', why) }]);
    world.touch('characters', c.id);
    return { ok: true, output: o };
  }
  if (status === 'active' || status === 'ready') return action === 'accept' ? { ok: true, output: o } : { ok: false, error: 'el actor ya tiene esa misión' };
  if (status === 'done' || status === 'failed' || status === 'expired') return { ok: false, error: `esa misión ya está cerrada (${status})` };
  if (status === 'locked') return { ok: false, error: `aún no se la pueden pedir: ${whyLocked(world, c, q)}. No la pidas ni la insinúes.` };
  // Disponible o rechazada: hace falta quien la da delante.
  if (!withNpc(world, c, q.giver_npc_id!)) return { ok: false, error: `la pide ${giverName}, que no está con el actor` };
  if (status === 'declined' && action !== 'accept') return { ok: false, error: 'el actor ya dijo que no: solo se abre si él cambia de idea (accept)' };
  ask(world, c, q, nowS, o);
  advanceCharacter(world, c, nowS, o);
  return { ok: true, output: o };
}

// ---------------------------------------------------------------------------
// Lectura (Diario y contexto del máster)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pistas con requisitos (grant_clue)
// ---------------------------------------------------------------------------

/** ¿Está esta fuente al alcance del PJ ahora: su NPC con él, en su sitio? */
function sourceHere(world: World, c: Character, s: ClueSource): boolean {
  if (s.npc_id && !withNpc(world, c, s.npc_id)) return false;
  if (s.location_id && (c.transit || world.characterSpot(c)?.location_id !== s.location_id)) return false;
  return true;
}

/** Los caminos de la pista que el PJ puede usar ya (al alcance y con lo que piden cumplido). Sin `sources`, ninguno. */
export function openSources(world: World, c: Character, clue: Clue, anywhere = false): ClueSource[] {
  return (clue.sources ?? []).filter((s) => (anywhere || sourceHere(world, c, s)) && (!s.requires || holds(world, c, s.requires)));
}

/** ¿Puede el PJ conseguir esta pista (en algún sitio)? Sin `sources`, sí. */
export function clueReachable(world: World, c: Character, clue: Clue): boolean {
  return !clue.sources?.length || openSources(world, c, clue, true).length > 0;
}

/** Lo que falta, en ficción: la confianza en palabras de la gente; lo demás, como condición. */
function refusalFor(world: World, c: Character, cond: StoryCondition): string {
  if (cond.kind === 'trust') return `${cap(nameFor(world, c, cond.npc_id))} aún no se fía de ti lo bastante para contarlo`;
  if (cond.kind === 'all' || cond.kind === 'any') {
    const miss = cond.of.find((x) => !holds(world, c, x));
    if (miss) return refusalFor(world, c, miss);
  }
  return `aún no: falta ${describeCondition(world, cond)}`;
}

/**
 * grant_clue: null si el PJ puede conseguir la pista aquí y ahora; si no, por qué, para que el máster lo narre
 * («Ilse aún no se fía de ti»). Las pistas que da la historia (un paso, una misión) no pasan por aquí.
 */
export function clueBlocked(world: World, c: Character, clue: Clue): string | null {
  if (!clue.sources?.length || openSources(world, c, clue).length) return null;
  const here = clue.sources.find((s) => sourceHere(world, c, s));
  if (here?.requires) return here.refusal ?? refusalFor(world, c, here.requires);
  return 'esta pista no sale de aquí ni de quien está con el actor: no la des y narra que no consigue nada nuevo';
}

/** La condición en castellano, para el máster. */
export function describeCondition(world: World, cond: StoryCondition): string {
  const spot = (id: Id) => world.spots.get(id)?.name ?? id;
  const npc = (id: Id) => world.npcs.get(id)?.name ?? id;
  const item = (id: Id) => world.itemDefs.get(id)?.name ?? id;
  const qty = (n?: number) => ((n ?? 1) > 1 ? ` ×${n}` : '');
  switch (cond.kind) {
    case 'clue': return `pista «${world.campaign.clues.find((x) => x.id === cond.clue_id)?.title ?? cond.clue_id}» [${cond.clue_id}] con grant_clue`;
    case 'visit': return `llegar a ${spot(cond.spot_id)} [${cond.spot_id}]`;
    case 'at_location': return `estar en ${world.locations.get(cond.location_id)?.name ?? cond.location_id}`;
    case 'visit_location': return `haber estado en ${world.locations.get(cond.location_id)?.name ?? cond.location_id}`;
    case 'npc_at': return `${npc(cond.npc_id)} en ${spot(cond.spot_id)}`;
    case 'carry': return `llevar encima ${item(cond.item_id)}${qty(cond.quantity)} [${cond.item_id}]`;
    case 'npc_has': return `que ${npc(cond.npc_id)} tenga ${item(cond.item_id)}${qty(cond.quantity)} (dárselo en mano: transfer_item al NPC, con el actor allí)`;
    case 'npc_status': return `${npc(cond.npc_id)} ${cond.status === 'dead' ? 'muerto' : cond.status === 'missing' ? 'desaparecido' : 'vivo'}`;
    case 'attitude': return `${npc(cond.npc_id)} con actitud ${cond.at_least} o mejor`;
    case 'spot_state': return `estado de ${spot(cond.spot_id)}: ${cond.key}${cond.value === undefined ? '' : ` = ${JSON.stringify(cond.value)}`} (update_spot_state)`;
    case 'discovered': return `descubrir ${spot(cond.spot_id)} (discover_spot)`;
    case 'knows': return `saber quién es ${npc(cond.npc_id)}`;
    case 'trust': return `que ${npc(cond.npc_id)} le tenga por ${TRUST_LABEL[cond.at_least]} (confianza: misiones, favores, regalos, tiradas sociales)`;
    case 'step': return `el paso «${quest(world, cond.quest_id)?.steps.find((x) => x.id === cond.step_id)?.text ?? cond.step_id}» de «${quest(world, cond.quest_id)?.title ?? cond.quest_id}»`;
    case 'talk': return `estar con ${npc(cond.npc_id)} en persona`;
    case 'level': return `nivel ${cond.at_least}`;
    case 'reputation': return `reputación ${cond.at_least}`;
    case 'debt_paid': return `saldar la deuda con ${npc(cond.npc_id)} (settle_debt)`;
    case 'escalated': return `que pase «${storyOf(world)?.escalation.find((e) => e.id === cond.id)?.title ?? cond.id}»`;
    case 'world_hours': return `${cond.at_least} h de juego desde el principio`;
    case 'job': return `encargo ${cond.job_id} cumplido`;
    case 'quest': return `misión «${quest(world, cond.quest_id)?.title ?? cond.quest_id}» cumplida`;
    case 'fact': return `que haya pasado «${cond.id}» (hecho del mundo)`;
    case 'tag': return `que el actor tenga la etiqueta «${cond.tag}»`;
    case 'opinion': return `opinión de ${npc(cond.npc_id)} con el actor${cond.at_least !== undefined ? ` de ${cond.at_least} o más` : ''}${cond.at_most !== undefined ? ` de ${cond.at_most} o menos` : ''}`;
    case 'narrative': return `lo decides tú con advance_story: ${cond.how}`;
    case 'any': return cond.of.map((x) => describeCondition(world, x)).join(' O ');
    case 'all': return cond.of.map((x) => describeCondition(world, x)).join(' Y ');
    case 'not': return `que no se cumpla: ${describeCondition(world, cond.of)}`;
  }
}

export interface StoryQuestView {
  quest: StoryQuest;
  status: 'declined' | 'active' | 'ready' | 'completed' | 'expired' | 'failed';
  /** Los pasos dados y el actual (los siguientes, no). Si cambió de camino, los dados del primero y luego los del nuevo. */
  steps: { step: StoryStep; done: boolean }[];
  current: StoryStep | null;
  /** Quién la recibe (null si se cumple sola). */
  turn_in_npc_id: Id | null;
}

/** Misiones que el PJ conoce (abiertas, rechazadas o cerradas), con sus pasos dados y los que ya ve. Los futuros no salen. */
export function questsOf(world: World, c: Character): StoryQuestView[] {
  const story = storyOf(world);
  if (!story) return [];
  const st = characterStory(c);
  const views: StoryQuestView[] = [];
  for (const q of story.quests) {
    const s = questStatus(world, c, q);
    const status: StoryQuestView['status'] | null = s === 'done' ? 'completed' : s === 'locked' || s === 'available' ? null : s;
    if (!status) continue;
    const cur = status === 'active' ? currentStep(c, q) : null;
    const steps: StoryQuestView['steps'] = [];
    if (status !== 'declined') {
      const path = stepsOf(c, q);
      const before = path === q.steps ? [] : q.steps.filter((x) => st.steps.includes(stepKey(q, x)) && !path.some((p) => p.id === x.id));
      for (const x of before) steps.push({ step: x, done: true });
      // Los dados y los que ya ve: el actual y, en la principal, las pistas que alguien ha mencionado.
      for (const x of path) {
        const done = st.steps.includes(stepKey(q, x));
        if (done || (status === 'active' && stepVisible(world, c, q, x))) steps.push({ step: x, done });
      }
    }
    views.push({ quest: q, status, steps, current: cur, turn_in_npc_id: turnInOf(c, q) });
  }
  return views;
}

/** La misión principal del PJ (la de su situación inicial), si la historia tiene una. */
export function mainQuestFor(world: World, c: Character): StoryQuest | null {
  const sit = c.situation?.id;
  return sit ? storyOf(world)?.quests.find((q) => q.main_for?.includes(sit)) ?? null : null;
}

/** Próximo escalón de la amenaza que aún puede pasar. */
export function nextEscalation(world: World, nowS: number): { escalation: StoryEscalation; in_s: number } | null {
  const story = storyOf(world);
  if (!story) return null;
  const st = stateOf(world);
  const e = story.escalation.find((x) => !st.escalated.includes(x.id) && !st.escalated.includes(`!${x.id}`));
  return e ? { escalation: e, in_s: Math.max(0, st.started_game_s + e.after_hours * GAME_HOUR - nowS) } : null;
}

/** Bloque del contexto del máster: misiones del actor por estado, lo que pueden ofrecer los presentes y la amenaza. null sin historia. */
export function storyContext(world: World, c: Character, nowS: number): string | null {
  const story = storyOf(world);
  if (!story) return null;
  const st = stateOf(world);
  const cst = characterStory(c);
  const passed = story.escalation.filter((e) => st.escalated.includes(e.id));
  const next = nextEscalation(world, nowS);
  const L: string[] = [`## Historia escrita (solo tú la ves; las misiones avanzan con tools, nunca solo con texto). Nivel del actor: ${c.level}.`];
  const name = (id: Id | null) => (id ? world.npcs.get(id)?.name ?? id : 'nadie');
  const views = questsOf(world, c);
  const active = views.filter((v) => v.status === 'active');
  if (!active.length) L.push('El actor no tiene misiones en curso.');
  for (const v of active.slice(0, 5)) {
    const q = v.quest;
    const by = q.main_for ? 'misión principal del actor' : `la pidió ${name(q.giver_npc_id)}${v.turn_in_npc_id && v.turn_in_npc_id !== q.giver_npc_id ? `; se entrega a ${name(v.turn_in_npc_id)}` : ''}`;
    L.push(`- En curso · acto ${q.act} · «${q.title}» [${q.id}] (nivel ${q.level}; ${by}): ${q.notes}`);
    if (v.current) L.push(`  Paso en curso [${v.current.id}]: ${v.current.text}. Se cumple: ${describeCondition(world, v.current.done_when)}.`);
  }
  for (const v of views.filter((x) => x.status === 'ready')) {
    L.push(`- Lista para entregar: «${v.quest.title}» [${v.quest.id}] a ${name(v.turn_in_npc_id)}. Cuando el actor hable con esa persona, ella le da la recompensa (story_quest turn_in, o lo hace el servidor al cerrar la charla): que se le oiga darla.`);
  }
  const hereLoc = c.transit ? null : world.characterSpot(c)?.location_id ?? null;
  const npcHere = (id: Id | null) => { const n = id ? world.npcs.get(id) : undefined; return !!n && n.status === 'alive' && !!hereLoc && world.spots.get(n.location.id)?.location_id === hereLoc; };
  // La que acaba de pedir alguien en escena (el servidor la abre al hablar): que se le oiga pedirla.
  for (const v of active) {
    const q = v.quest, o = cst.origins?.[q.id];
    if (o?.kind !== 'giver' || nowS - o.game_s > 15 * 60) continue;
    L.push(`- ${name(q.giver_npc_id)} acaba de pedirle «${q.title}» [${q.id}] (ya está en su Diario). Si aún no se le ha oído en la charla, que la pida con su voz, por partes: ${ASK_PHASES} Lo que pide: «${q.text}».`);
  }
  for (const v of active) {
    const d = v.quest.deadline;
    if (!d) continue;
    const left = d.rests !== undefined ? d.rests - ((cst.rests ?? 0) - (cst.opened_rests?.[v.quest.id] ?? 0)) : null;
    L.push(`- Plazo de «${v.quest.title}»: ${left !== null ? `se pierde si descansa ${left === 1 ? 'una vez más' : `${left} veces más`}` : ''}${left !== null && d.milestone ? ' o ' : ''}${d.milestone ? `cuando ${describeCondition(world, d.milestone)}` : ''}. Si se pierde: ${d.lost}`);
  }
  // Lo que pueden ofrecer los que están aquí, y lo que aún no (para que no lo insinúen).
  for (const q of story.quests) {
    if (!q.giver_npc_id || !npcHere(q.giver_npc_id)) continue;
    const s = questStatus(world, c, q);
    if (s === 'available') L.push(`- ${name(q.giver_npc_id)} puede pedirle «${q.title}» [${q.id}] (nivel ${q.level}): «${q.text}». Si viene a cuento en la charla, que la pida con su voz (story_quest ask); si el actor habla con ${name(q.giver_npc_id)}, el servidor se la pide al cerrar el turno.`);
    else if (s === 'declined') L.push(`- El actor le dijo que no a ${name(q.giver_npc_id)} con «${q.title}» [${q.id}]: que no insista; si el actor cambia de idea, story_quest accept.`);
    else if (s === 'locked' && !q.exclusive && cst.done.length + cst.open.length > 0 && q.act > 1) L.push(`- ${name(q.giver_npc_id)} aún no tiene nada más para el actor (${whyLocked(world, c, q)}): que no lo insinúe.`);
  }
  if (passed.length) L.push(`Ya ha pasado (la amenaza avanza): ${passed.map((e) => e.title).join('; ')}.`);
  if (next) L.push(`Lo próximo si nadie lo evita: «${next.escalation.title}» en unas ${Math.max(1, Math.round(next.in_s / GAME_HOUR))} h de juego (se evita con: ${describeCondition(world, next.escalation.unless)}).`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Validación (la usa src/worldgen/validate.ts)
// ---------------------------------------------------------------------------

/**
 * NPC sin los que una condición no se puede cumplir: con quien hay que estar o a quien dar algo, y quien da una
 * pista que no se puede encontrar en ningún sitio. En `any`, los que hacen falta en todas las ramas.
 */
function npcsNeeded(c: StoryCondition, clueNpcs: (id: Id) => Id[]): Set<Id> {
  switch (c.kind) {
    case 'talk': case 'npc_has': case 'npc_at': case 'attitude': case 'opinion': case 'debt_paid': case 'trust': return new Set([c.npc_id]);
    case 'clue': return new Set(clueNpcs(c.clue_id));
    case 'all': return new Set(c.of.flatMap((x) => [...npcsNeeded(x, clueNpcs)]));
    case 'any': {
      const [first, ...rest] = c.of.map((x) => npcsNeeded(x, clueNpcs));
      return new Set([...(first ?? [])].filter((id) => rest.every((r) => r.has(id))));
    }
    default: return new Set();
  }
}

/** Lo que existe en el mundo, para validar referencias de la historia y de las reglas del mundo. */
export interface StoryRefs { spot: (id: Id) => boolean; location: (id: Id) => boolean; npc: (id: Id) => boolean; item: (id: Id) => boolean; clue: (id: Id) => boolean; job: (id: Id) => boolean; exit: (id: Id) => boolean; clueNpcs?: (id: Id) => Id[]; clues?: Clue[] }

/** Errores de referencias de una condición (también la usan las reglas del mundo). */
export function conditionErrors(where: string, c: StoryCondition, has: StoryRefs, ids: { quests: ReadonlySet<Id>; escalations: ReadonlySet<Id>; steps?: ReadonlySet<string> }, errs: string[]): void {
  const cond = (w: string, x: StoryCondition) => conditionErrors(w, x, has, ids, errs);
  switch (c.kind) {
    case 'clue': if (!has.clue(c.clue_id)) errs.push(`${where}: la pista ${c.clue_id} no existe.`); break;
    case 'visit': case 'discovered': if (!has.spot(c.spot_id)) errs.push(`${where}: el punto ${c.spot_id} no existe.`); break;
    case 'spot_state': if (!has.spot(c.spot_id)) errs.push(`${where}: el punto ${c.spot_id} no existe.`); break;
    case 'visit_location': case 'at_location': if (!has.location(c.location_id)) errs.push(`${where}: la localización ${c.location_id} no existe.`); break;
    case 'npc_at': if (!has.npc(c.npc_id) || !has.spot(c.spot_id)) errs.push(`${where}: ${c.npc_id} o ${c.spot_id} no existe.`); break;
    case 'carry': if (!has.item(c.item_id)) errs.push(`${where}: el objeto ${c.item_id} no existe.`); break;
    case 'npc_has': if (!has.npc(c.npc_id) || !has.item(c.item_id)) errs.push(`${where}: ${c.npc_id} o ${c.item_id} no existe.`); break;
    case 'npc_status': case 'attitude': case 'knows': case 'talk': case 'debt_paid': case 'trust': if (!has.npc(c.npc_id)) errs.push(`${where}: el NPC ${c.npc_id} no existe.`); break;
    case 'step': if (ids.steps && !ids.steps.has(`${c.quest_id}/${c.step_id}`)) errs.push(`${where}: el paso ${c.quest_id}/${c.step_id} no existe.`); break;
    case 'level': if (!(c.at_least >= 1)) errs.push(`${where}: nivel no válido.`); break;
    case 'escalated': if (!ids.escalations.has(c.id)) errs.push(`${where}: el escalón ${c.id} no existe.`); break;
    case 'world_hours': if (!(c.at_least > 0)) errs.push(`${where}: horas no válidas.`); break;
    case 'reputation': break;
    case 'job': if (!has.job(c.job_id)) errs.push(`${where}: el encargo ${c.job_id} no existe.`); break;
    case 'quest': if (!ids.quests.has(c.quest_id)) errs.push(`${where}: la misión ${c.quest_id} no existe.`); break;
    case 'fact': if (!c.id.trim()) errs.push(`${where}: hecho sin id.`); break;
    case 'tag': if (!c.tag.trim()) errs.push(`${where}: etiqueta sin id.`); break;
    case 'opinion': if (!has.npc(c.npc_id)) errs.push(`${where}: el NPC ${c.npc_id} no existe.`); if (c.at_least === undefined && c.at_most === undefined) errs.push(`${where}: opinión sin límites.`); break;
    case 'narrative': if (!c.how.trim()) errs.push(`${where}: paso narrativo sin «how».`); break;
    case 'any': case 'all': if (!c.of.length) errs.push(`${where}: ${c.kind} vacío.`); c.of.forEach((x) => cond(where, x)); break;
    case 'not': cond(where, c.of); break;
  }
}

/** Errores de referencias de un efecto (también la usan las reglas del mundo). */
export function effectErrors(where: string, e: StoryEffect, has: StoryRefs, errs: string[]): void {
  const npcIds = 'npc_id' in e ? [e.npc_id] : [];
  for (const id of npcIds) if (!has.npc(id)) errs.push(`${where}: el NPC ${id} no existe.`);
  if ('spot_id' in e && e.spot_id !== undefined && !has.spot(e.spot_id)) errs.push(`${where}: el punto ${e.spot_id} no existe.`);
  if ('location_id' in e && !has.location(e.location_id)) errs.push(`${where}: la localización ${e.location_id} no existe.`);
  if (e.kind === 'clue' && !has.clue(e.clue_id)) errs.push(`${where}: la pista ${e.clue_id} no existe.`);
  if (e.kind === 'give_item' && !has.item(e.item_id)) errs.push(`${where}: el objeto ${e.item_id} no existe.`);
  if (e.kind === 'trust' && !e.change && !e.at_least) errs.push(`${where}: efecto de confianza sin change ni at_least.`);
  if (e.kind === 'exit_state' && !has.exit(e.exit_id)) errs.push(`${where}: la salida ${e.exit_id} no existe.`);
  if (e.kind === 'rumor' && !RUMOR_KINDS.includes(e.rumor_kind)) errs.push(`${where}: tipo de rumor no válido ${e.rumor_kind}.`);
  if (e.kind === 'hook' && e.trigger === 'spot' && !e.spot_id) errs.push(`${where}: gancho de punto sin spot_id.`);
  if (e.kind === 'schedule') {
    if (!has.location(e.event.location_id) || !has.spot(e.event.spot_id)) errs.push(`${where}: el evento ${e.event.id} apunta a un sitio que no existe.`);
    for (const id of e.event.npc_ids) if (!has.npc(id)) errs.push(`${where}: el evento ${e.event.id} trae a ${id}, que no existe.`);
  }
  if (e.kind === 'npc_status' && e.hideout_spot_id && !has.spot(e.hideout_spot_id)) errs.push(`${where}: el escondite ${e.hideout_spot_id} no existe.`);
  if (e.kind === 'npc_routine' && e.routine) for (const id of Object.values(e.routine)) if (id && !has.spot(id)) errs.push(`${where}: horario con el punto ${id}, que no existe.`);
}

/**
 * Errores de referencias y forma de la historia. Vacío = válida. Con `clueNpcs` (quién da cada pista que solo sale
 * de una persona), además, la lista de casos límite: cada NPC del que depende una misión (un paso, la entrega, una
 * pista que solo da él) tiene su `on_npc_dead`, y el otro camino no vuelve a depender de él.
 */
export function validateStory(story: Story, has: StoryRefs): string[] {
  const errs: string[] = [];
  const qids = new Set<Id>();
  for (const q of story.quests) {
    if (qids.has(q.id)) errs.push(`historia: la misión ${q.id} está repetida.`);
    qids.add(q.id);
  }
  const stepIds = new Set(story.quests.flatMap((q) => [...q.steps, ...(q.on_npc_dead ?? []).flatMap((r) => (r.outcome === 'reroute' ? r.steps ?? [] : []))].map((x) => `${q.id}/${x.id}`)));
  const ids = { quests: qids, escalations: new Set(story.escalation.map((e) => e.id)), steps: stepIds };
  const cond = (where: string, c: StoryCondition): void => conditionErrors(where, c, has, ids, errs);
  const eff = (where: string, e: StoryEffect): void => effectErrors(where, e, has, errs);
  const steps = (w: string, list: StoryStep[], sids: Set<Id>, same: StoryStep[] = []): void => {
    for (const s of list) {
      // En un camino alternativo, repetir un paso del principal tal cual vale: lo ya hecho cuenta.
      if (same.some((x) => x.id === s.id && JSON.stringify(x) === JSON.stringify(s))) continue;
      if (sids.has(s.id)) errs.push(`${w}: el paso ${s.id} está repetido.`);
      sids.add(s.id);
      if (!s.text.trim()) errs.push(`${w}/${s.id}: sin texto.`);
      cond(`${w}/${s.id}`, s.done_when);
      (s.on_done ?? []).forEach((e) => eff(`${w}/${s.id}`, e));
    }
  };
  for (const q of story.quests) {
    const w = `misión ${q.id}`;
    if (!q.title.trim() || !q.text.trim() || !q.notes.trim()) errs.push(`${w}: falta título, texto o notas.`);
    if (![1, 2, 3].includes(q.act)) errs.push(`${w}: el acto debe ser 1, 2 o 3.`);
    if (!Number.isInteger(q.level) || q.level < 1) errs.push(`${w}: falta el nivel (entero, 1 o más).`);
    if (q.min_level !== undefined && (!Number.isInteger(q.min_level) || q.min_level < 1 || q.min_level > q.level)) errs.push(`${w}: min_level debe ir de 1 al nivel de la misión.`);
    if (q.giver_npc_id && !has.npc(q.giver_npc_id)) errs.push(`${w}: quien la da (${q.giver_npc_id}) no existe.`);
    if (!q.giver_npc_id && !q.main_for?.length) errs.push(`${w}: sin quien la dé solo puede ser misión principal (main_for).`);
    if (q.main_for && (!q.main_for.length || q.giver_npc_id)) errs.push(`${w}: la principal (main_for) no la da nadie y lleva al menos una situación.`);
    if (q.turn_in_npc_id && !has.npc(q.turn_in_npc_id)) errs.push(`${w}: quien la recibe (${q.turn_in_npc_id}) no existe.`);
    if (q.rumor) {
      if (!q.rumor.text.trim()) errs.push(`${w}: rumor vacío.`);
      cond(`${w} (rumor)`, q.rumor.where);
    }
    if (!q.steps.length) errs.push(`${w}: sin pasos.`);
    const sids = new Set<Id>();
    steps(w, q.steps, sids);
    for (const r of q.on_npc_dead ?? []) {
      if (!has.npc(r.npc_id)) errs.push(`${w}: on_npc_dead con ${r.npc_id}, que no existe.`);
      if (!r.why.trim()) errs.push(`${w}: on_npc_dead sin «why» (el Diario lo cuenta).`);
      if (r.outcome === 'reroute') {
        if (!r.steps?.length && r.turn_in_npc_id === undefined) errs.push(`${w}: on_npc_dead (${r.npc_id}) no cambia nada: da otros pasos o quién la recibe.`);
        steps(`${w} (si muere ${r.npc_id})`, r.steps ?? [], sids, q.steps);
        if (r.turn_in_npc_id && !has.npc(r.turn_in_npc_id)) errs.push(`${w}: on_npc_dead (${r.npc_id}) entrega a ${r.turn_in_npc_id}, que no existe.`);
      }
    }
    if (q.requires) cond(`${w} (requisitos)`, q.requires);
    if (has.clueNpcs) {
      const clueNpcs = has.clueNpcs;
      const needs = (list: StoryStep[], turnIn: Id | null | undefined): Map<Id, string> => {
        const m = new Map<Id, string>();
        for (const s of list) if (!s.optional) for (const id of npcsNeeded(s.done_when, clueNpcs)) if (!m.has(id)) m.set(id, `el paso ${s.id}`);
        if (turnIn && !m.has(turnIn)) m.set(turnIn, 'la entrega');
        return m;
      };
      const turnIn = q.turn_in_npc_id !== undefined ? q.turn_in_npc_id : q.giver_npc_id;
      for (const [id, what] of needs(q.steps, turnIn)) {
        if (!(q.on_npc_dead ?? []).some((r) => r.npc_id === id)) errs.push(`${w}: depende de ${id} (${what}) y no dice qué pasa si muere (on_npc_dead).`);
      }
      for (const r of q.on_npc_dead ?? []) {
        if (r.outcome !== 'reroute') continue;
        const again = needs(r.steps ?? q.steps, r.turn_in_npc_id !== undefined ? r.turn_in_npc_id : turnIn).get(r.npc_id);
        if (again) errs.push(`${w}: el camino de si muere ${r.npc_id} sigue dependiendo de él (${again}).`);
      }
    }
    if (q.reward.item_id && !has.item(q.reward.item_id)) errs.push(`${w}: el premio ${q.reward.item_id} no existe.`);
    for (const s of [...q.steps, ...(q.on_npc_dead ?? []).flatMap((r) => (r.outcome === 'reroute' ? r.steps ?? [] : []))]) if (s.revealed_by) cond(`${w}/${s.id} (pista)`, s.revealed_by);
    if (q.steps.every((s) => s.optional)) errs.push(`${w}: todos los pasos son opcionales: hace falta al menos uno que cierre la misión.`);
    if (q.deadline) {
      const d = q.deadline;
      if (d.rests === undefined && !d.milestone) errs.push(`${w}: plazo sin descansos ni hito.`);
      if (d.rests !== undefined && !(d.rests >= 1)) errs.push(`${w}: plazo con descansos no válidos.`);
      if (!d.warn.trim() || !d.lost.trim()) errs.push(`${w}: el plazo necesita aviso (warn) y lo que se pierde (lost).`);
      if (d.milestone) cond(`${w} (hito del plazo)`, d.milestone);
      if (d.warn_when) cond(`${w} (aviso del plazo)`, d.warn_when);
      (d.on_lost ?? []).forEach((e) => eff(w, e));
    }
    [...(q.on_accept ?? []), ...q.on_complete].forEach((e) => eff(w, e));
  }
  if (has.clues) errs.push(...validateClueSources(story, has.clues, has, cond));
  const eids = new Set<Id>();
  for (const e of story.escalation) {
    const w = `escalón ${e.id}`;
    if (eids.has(e.id)) errs.push(`${w}: repetido.`);
    eids.add(e.id);
    if (!has.location(e.location_id)) errs.push(`${w}: la localización ${e.location_id} no existe.`);
    if (e.spot_id && !has.spot(e.spot_id)) errs.push(`${w}: el punto ${e.spot_id} no existe.`);
    if (!(e.after_hours > 0)) errs.push(`${w}: after_hours debe ser positivo.`);
    cond(w, e.unless);
    e.effects.forEach((x) => eff(w, x));
  }
  return errs;
}

/**
 * Las fuentes de cada pista: que existan su NPC y su sitio y que sus requisitos tengan sentido. Una pista clave
 * (`key`) necesita al menos dos caminos distintos (otra persona, otro sitio o una misión que la da), para que no
 * se cierre la historia si muere quien la sabe o no se fía nunca (Obsidian, «Investigación misiones y
 * reactividad»: siempre otro camino).
 */
function validateClueSources(story: Story, clues: Clue[], has: { npc: (id: Id) => boolean; location: (id: Id) => boolean }, cond: (where: string, c: StoryCondition) => void): string[] {
  const errs: string[] = [];
  // Misiones que dan cada pista con sus efectos (al dar un paso, al cumplirla, al aceptarla).
  const byQuest = new Map<Id, Set<Id>>();
  for (const q of story.quests) {
    const effects = [...q.steps.flatMap((s) => s.on_done ?? []), ...q.on_complete, ...(q.on_accept ?? []), ...(q.on_npc_dead ?? []).flatMap((r) => (r.outcome === 'reroute' ? (r.steps ?? []).flatMap((s) => s.on_done ?? []) : []))];
    for (const e of effects) if (e.kind === 'clue') (byQuest.get(e.clue_id) ?? byQuest.set(e.clue_id, new Set()).get(e.clue_id)!).add(q.id);
  }
  for (const clue of clues) {
    const w = `pista ${clue.id}`;
    for (const [i, s] of (clue.sources ?? []).entries()) {
      if (!s.via.trim()) errs.push(`${w}: la fuente ${i + 1} no dice cómo («via»).`);
      if (s.npc_id && !has.npc(s.npc_id)) errs.push(`${w}: la fuente ${i + 1} la da ${s.npc_id}, que no existe.`);
      if (s.location_id && !has.location(s.location_id)) errs.push(`${w}: la fuente ${i + 1} está en ${s.location_id}, que no existe.`);
      if (s.requires) cond(`${w} (fuente ${i + 1})`, s.requires);
    }
    if (!clue.key) continue;
    const ways = new Set<string>([
      ...(clue.sources ?? []).map((s, i) => (s.npc_id ? `npc:${s.npc_id}` : s.location_id ? `loc:${s.location_id}` : `via:${i}`)),
      ...[...(byQuest.get(clue.id) ?? [])].map((q) => `quest:${q}`),
    ]);
    if (ways.size < 2) errs.push(`${w}: es clave y solo tiene ${ways.size === 1 ? 'un camino' : 'ningún camino'}; hacen falta dos (otra persona, otro sitio o una misión que la dé).`);
  }
  return errs;
}
