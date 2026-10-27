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
 *   - `character.story`: misiones abiertas, pasos dados, cumplidas y caducadas
 *     de cada PJ.
 *
 * Alta y avance coherentes (lo que ve el jugador tiene que cuadrar con lo que
 * ha vivido):
 *   - Una misión con quien la da (`giver_npc_id`) se abre cuando se cumple su
 *     condición Y el PJ está hablando con esa persona; o, si la misión trae
 *     `heard`, de oídas, con ese origen a la vista («lo oíste en…»). Sin
 *     ninguna de las dos, espera. Una sin quien la da se abre por su condición.
 *   - Un paso solo cuenta para el PJ si lo ha hecho él (o su grupo, delante):
 *     las condiciones del mundo (que un NPC tenga algo, muera, esté en un
 *     sitio, o el estado de un punto) piden que el PJ esté en ese lugar.
 *   - Cada alta, paso, cierre y caducidad queda en `character.story.log` con
 *     el porqué en palabras del jugador: lo pinta el Diario y va en el aviso.
 *
 * Consecuencias: las que tocan al PJ (pista, objeto, conocer a alguien, un
 * punto descubierto) se aplican a cada PJ que cumple; las del mundo (un NPC
 * que se va, un estado, un evento en la agenda) una sola vez. Las misiones
 * con el mismo `exclusive` son finales que se excluyen: al cumplirse una, las
 * demás caducan para todos.
 */

import { GAME_HOUR } from '../clock/clock.js';
import { attitudeOf } from './combat.js';
import type { Hook } from './hooks.js';
import { spawnItem } from './inventory.js';
import type { Attitude, Character, Id, Npc } from './model.js';
import { addReputation, grantClue, type ProgressEvent } from './progress.js';
import { RUMOR_KINDS, type Rumor, type RumorKind } from './rumors.js';
import type { NpcRoutine, ScheduledEvent } from './schedule.js';
import { money } from './money.js';
import type { World } from './world.js';

// ---------------------------------------------------------------------------
// Definición
// ---------------------------------------------------------------------------

/** Cuándo se da un paso (o se abre una misión). Lo evalúa el motor en cada tick y tras cada acción. */
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
  | { kind: 'npc_has'; npc_id: Id; item_id: Id }
  | { kind: 'npc_status'; npc_id: Id; status: Npc['status'] }
  /** Actitud del NPC hacia el PJ igual o mejor que esta. */
  | { kind: 'attitude'; npc_id: Id; at_least: Attitude }
  /** Clave del estado de un punto: verdadera, o igual a `value` si se da. */
  | { kind: 'spot_state'; spot_id: Id; key: string; value?: string | number | boolean }
  | { kind: 'discovered'; spot_id: Id }
  | { kind: 'knows'; npc_id: Id }
  | { kind: 'job'; job_id: Id }
  /** Misión cumplida (por el PJ; en la amenaza, por cualquiera). */
  | { kind: 'quest'; quest_id: Id }
  /** Lo decide el máster con advance_story; `how` le dice cuándo. */
  | { kind: 'narrative'; how: string }
  | { kind: 'any'; of: StoryCondition[] }
  | { kind: 'all'; of: StoryCondition[] }
  /** No se cumple (en la amenaza: nadie la cumple). */
  | { kind: 'not'; of: StoryCondition };

/** Lo que cambia al dar un paso, abrir o cumplir una misión, o al escalar la amenaza. */
export type StoryEffect =
  // Al PJ que cumple (cada uno)
  | { kind: 'clue'; clue_id: Id }
  | { kind: 'give_item'; item_id: Id; quantity?: number }
  | { kind: 'reveal_spot'; spot_id: Id }
  | { kind: 'learn_place'; location_id: Id }
  | { kind: 'know_npc'; npc_id: Id }
  | { kind: 'attitude'; npc_id: Id; attitude: Attitude }
  /** Aviso privado al PJ. */
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
  /** Objetivo, como lo lee el jugador en el Diario. */
  text: string;
  done_when: StoryCondition;
  on_done?: StoryEffect[];
}

export interface StoryQuest {
  id: Id;
  act: 1 | 2 | 3;
  title: string;
  giver_npc_id: Id | null;
  /** Lo que lee el jugador. */
  text: string;
  /** Solo para el máster: qué hay detrás y cómo empujar sin regalar. */
  notes: string;
  /** Se abre cuando se cumple; sin ella, desde el principio. */
  opens_when?: StoryCondition;
  /**
   * Cómo le llega al PJ sin que se lo pida quien la da: un rumor, algo que se
   * oye o se ve («En el Jabalí se comenta que…»). Con ella se abre de oídas en
   * cuanto se cumple `opens_when`; sin ella, hace falta hablar con quien la da.
   */
  heard?: string;
  /** Finales excluyentes: al cumplirse una del grupo, las demás caducan para todos. */
  exclusive?: string;
  steps: StoryStep[];
  reward: { coins?: number; reputation?: number; xp?: number; item_id?: Id };
  on_open?: StoryEffect[];
  on_complete: StoryEffect[];
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
}

export interface CharacterStory {
  open: Id[];
  /** Pasos dados: `quest/paso`. */
  steps: Id[];
  done: Id[];
  expired: Id[];
  /** Cómo le llegó cada misión (las abiertas antes de esto no lo tienen). */
  origins?: Record<Id, QuestOrigin>;
  /** Altas, pasos, cierres y caducidades, con el porqué (los últimos MAX_LOG). */
  log?: QuestLogEntry[];
}

/** De dónde le viene una misión al PJ: se la pide alguien en persona, de oídas o por su cuenta. */
export interface QuestOrigin {
  kind: 'giver' | 'heard' | 'self';
  game_s: number;
  location_id: Id | null;
  /** En palabras del jugador: «Te lo pide Ilse», «En el Jabalí se comenta que…». */
  text: string;
}

export interface QuestLogEntry {
  quest_id: Id;
  kind: 'open' | 'step' | 'done' | 'expired';
  step_id?: Id;
  game_s: number;
  /** Por qué, en palabras del jugador («conseguiste la pista «La Brasa de Vharn»»). */
  why: string;
}

const MAX_LOG = 200;

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
  return /^(el|la|los|las) /.test(n.role) ? n.role : /a$/.test(n.role) ? `la ${n.role}` : `el ${n.role}`;
}

/** ¿Está ese NPC hablando ahora con el PJ (o el PJ unido a su charla)? */
export function talkingWith(n: Npc, c: Character): boolean {
  const t = n.talking_to;
  if (!t) return false;
  return (t.character_id === c.id && !t.reserved) || (t.with ?? []).includes(c.id);
}

const RANK: Record<Attitude, number> = { hostile: 0, unfriendly: 1, neutral: 2, friendly: 3, allied: 4 };
const stepKey = (q: StoryQuest, s: StoryStep) => `${q.id}/${s.id}`;
const ROMAN = ['', 'I', 'II', 'III'] as const;

// ---------------------------------------------------------------------------
// Condiciones
// ---------------------------------------------------------------------------

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
    case 'npc_has': return [...world.itemInstances.values()].some((i) => i.item_id === cond.item_id && i.location.type === 'npc' && i.location.id === cond.npc_id);
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
    case 'job': return c!.completed_jobs.includes(cond.job_id);
    case 'quest': return characterStory(c!).done.includes(cond.quest_id);
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
 * delante de él. Para los pasos; las aperturas y la amenaza usan `holds`.
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
  switch (cond.kind) {
    case 'clue': return `conseguiste la pista «${world.campaign.clues.find((x) => x.id === cond.clue_id)?.title ?? cond.clue_id}»`;
    case 'visit': return `llegaste a ${spot(cond.spot_id)}`;
    case 'at_location': return `estás en ${loc(cond.location_id)}`;
    case 'visit_location': return `has estado en ${loc(cond.location_id)}`;
    case 'npc_at': return `${npc(cond.npc_id)} está en ${spot(cond.spot_id)}`;
    case 'carry': return `llevas ${item(cond.item_id)}${(cond.quantity ?? 1) > 1 ? ` ×${cond.quantity}` : ''}`;
    case 'npc_has': return `${npc(cond.npc_id)} ya tiene ${item(cond.item_id)}`;
    case 'npc_status': return `${npc(cond.npc_id)} ${cond.status === 'dead' ? 'ha muerto' : cond.status === 'missing' ? 'ha desaparecido' : 'sigue con vida'}`;
    case 'attitude': return `${npc(cond.npc_id)} se fía más de ti`;
    case 'spot_state': return `ha cambiado ${spot(cond.spot_id)}`;
    case 'discovered': return `descubriste ${spot(cond.spot_id)}`;
    case 'knows': return `sabes quién es ${npc(cond.npc_id)}`;
    case 'job': return `cumpliste el encargo «${world.campaign.jobs.find((j) => j.id === cond.job_id)?.title ?? cond.job_id}»`;
    case 'quest': return `cumpliste «${quest(world, cond.quest_id)?.title ?? cond.quest_id}»`;
    case 'narrative': return 'lo has hecho en la escena';
    case 'any': {
      const hit = cond.of.find((x) => credited(world, c, x)) ?? cond.of.find((x) => holds(world, c, x)) ?? cond.of[0];
      return hit ? explain(world, c, hit) : '';
    }
    case 'all': return cond.of.map((x) => explain(world, c, x)).filter(Boolean).join(' y ');
    case 'not': return 'no ha pasado lo que lo impedía';
  }
}

function isPersonal(cond: StoryCondition): boolean {
  return !['npc_has', 'npc_status', 'npc_at', 'spot_state', 'any', 'all', 'not'].includes(cond.kind);
}

// ---------------------------------------------------------------------------
// Consecuencias
// ---------------------------------------------------------------------------

const PERSONAL = new Set<StoryEffect['kind']>(['clue', 'give_item', 'reveal_spot', 'learn_place', 'know_npc', 'attitude', 'tell']);

/** Lo que el motor tiene que contar: al PJ (como progreso) o a una localización. */
export interface StoryOutput {
  personal: { character_id: Id; events: ProgressEvent[] }[];
  announcements: { location_id: Id; spot_id: Id | null; text: string; public: boolean }[];
}

function out(): StoryOutput { return { personal: [], announcements: [] }; }

function tellTo(o: StoryOutput, c: Character, events: ProgressEvent[]): void {
  if (!events.length) return;
  const slot = o.personal.find((p) => p.character_id === c.id);
  if (slot) slot.events.push(...events); else o.personal.push({ character_id: c.id, events: [...events] });
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
    case 'tell': tellTo(o, c, [{ kind: 'story', text: e.text }]); break;
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
// Avance
// ---------------------------------------------------------------------------

function quest(world: World, id: Id): StoryQuest | undefined { return storyOf(world)?.quests.find((q) => q.id === id); }

/** Paso en curso de una misión abierta: el primero sin dar. */
export function currentStep(c: Character, q: StoryQuest): StoryStep | null {
  const st = characterStory(c);
  return q.steps.find((s) => !st.steps.includes(stepKey(q, s))) ?? null;
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

/**
 * De dónde le llegaría ahora una misión que ya cumple su condición: en persona
 * (quien la da está hablando con el PJ), de oídas (`heard`) o, sin quien la
 * dé, por su cuenta. null = aún no: falta hablar con quien la da.
 */
function originFor(world: World, c: Character, q: StoryQuest, nowS: number): QuestOrigin | null {
  const location_id = c.transit ? null : world.characterSpot(c)?.location_id ?? null;
  const giver = q.giver_npc_id ? world.npcs.get(q.giver_npc_id) : undefined;
  if (giver && giver.status === 'alive' && talkingWith(giver, c)) return { kind: 'giver', game_s: nowS, location_id, text: `Te lo pide ${nameFor(world, c, giver.id)}` };
  if (q.heard) return { kind: 'heard', game_s: nowS, location_id, text: q.heard };
  if (giver) return null;
  const why = q.opens_when ? explain(world, c, q.opens_when) : '';
  return { kind: 'self', game_s: nowS, location_id, text: why ? `Por tu cuenta: ${why}` : 'Por tu cuenta' };
}

/** Abre, avanza y cierra las misiones de un PJ. */
function advanceCharacter(world: World, c: Character, nowS: number, o: StoryOutput): void {
  const story = storyOf(world);
  if (!story) return;
  const st = characterStory(c);
  let changed = false;
  for (const q of story.quests) {
    if (st.done.includes(q.id) || st.expired.includes(q.id)) continue;
    const taken = exclusiveTaken(world, q);
    if (taken) {
      const wasOpen = st.open.includes(q.id);
      st.open = st.open.filter((x) => x !== q.id);
      st.expired.push(q.id);
      changed = true;
      if (wasOpen) {
        const why = `el valle ya ha elegido otro final («${taken.title}»)`;
        logStory(world, c, { quest_id: q.id, kind: 'expired', game_s: nowS, why });
        tellTo(o, c, [{ kind: 'story', text: `La misión «${q.title}» se cierra: ${why}.`, quest: { id: q.id, title: q.title, event: 'expired', why } }]);
      }
      continue;
    }
    if (!st.open.includes(q.id)) {
      if (q.opens_when && !holds(world, c, q.opens_when)) continue;
      const origin = originFor(world, c, q, nowS);
      if (!origin) continue;
      st.open.push(q.id);
      st.origins = { ...(st.origins ?? {}), [q.id]: origin };
      changed = true;
      logStory(world, c, { quest_id: q.id, kind: 'open', game_s: nowS, why: origin.text });
      const how = origin.kind === 'heard' ? 'de oídas' : `acto ${ROMAN[q.act]}`;
      tellTo(o, c, [{ kind: 'story', text: `📖 Nueva misión (${how}): «${q.title}». ${origin.text}. ${q.text}`, quest: { id: q.id, title: q.title, event: 'open', why: origin.text } }]);
      applyEffects(world, c, q.on_open, `${q.id}:open`, nowS, o);
    }
    for (let s = currentStep(c, q); s && credited(world, c, s.done_when); s = currentStep(c, q)) {
      markStep(world, c, q, s, nowS, o, explain(world, c, s.done_when));
      changed = true;
    }
    if (!currentStep(c, q)) { complete(world, c, q, nowS, o); changed = true; }
  }
  if (changed) world.touch('characters', c.id);
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
  if (q.steps.length > 1) tellTo(o, c, [{ kind: 'story', text: `✔ «${q.title}»: ${s.text}`, quest: { id: q.id, title: q.title, event: 'step', step: s.text, why } }]);
  // Crédito compartido: quien estaba presente y va por ese mismo paso de la misión, lo da también.
  const st = stateOf(world);
  const shared = companionsOf(world, c).filter((p) => characterStory(p).open.includes(q.id) && currentStep(p, q)?.id === s.id);
  if (!st.credits?.[key]) { st.credits = { ...(st.credits ?? {}), [key]: { by: c.id, with: companionsOf(world, c).map((p) => p.id), game_s: nowS } }; world.touch('campaign', world.campaign.id); }
  for (const p of shared) {
    characterStory(p).steps.push(key);
    const withWhy = `con ${c.name}: ${why}`;
    logStory(world, p, { quest_id: q.id, kind: 'step', step_id: s.id, game_s: nowS, why: withWhy });
    world.touch('characters', p.id);
    tellTo(o, p, [{ kind: 'story', text: `✔ «${q.title}»: ${s.text} (con ${c.name})`, quest: { id: q.id, title: q.title, event: 'step', step: s.text, why: withWhy } }]);
  }
  applyEffects(world, c, s.on_done, key, nowS, o);
}

function complete(world: World, c: Character, q: StoryQuest, nowS: number, o: StoryOutput): void {
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
  if (r.reputation) bits.push(`reputación en Brezal: ${addReputation(world, c, world.campaign.achievement.faction_id, r.reputation)}`);
  if (r.item_id && world.itemDefs.has(r.item_id) && spawnItem(world, r.item_id, 1, { type: 'character', id: c.id, slot: { kind: 'pocket' } }).ok) bits.push(world.itemDef(r.item_id).name);
  const why = q.steps.length > 1 ? 'diste todos los pasos' : (q.steps[0]?.text ?? q.title);
  logStory(world, c, { quest_id: q.id, kind: 'done', game_s: nowS, why });
  tellTo(o, c, [{ kind: 'story', text: `🏁 Misión cumplida: «${q.title}»${bits.length ? ` (${bits.join(', ')})` : ''}.`, quest: { id: q.id, title: q.title, event: 'done', why: bits.length ? `${why} · ${bits.join(', ')}` : why }, ...(q.ending ? { public: q.ending.replaceAll('{name}', c.name) } : {}) }]);
  applyEffects(world, c, q.on_complete, `${q.id}:done`, nowS, o);
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
  findHidden(world, o);
  escalate(world, nowS, o);
  for (const c of world.characters.values()) {
    if (c.status === 'retired' || c.status === 'dead') continue;
    advanceCharacter(world, c, nowS, o);
  }
  return o;
}

/** El máster marca un paso narrativo (tool advance_story). Después avanza lo que haya detrás. */
export function advanceStory(world: World, c: Character, questId: Id, stepId: Id, nowS: number, why?: string | null): { ok: true; output: StoryOutput } | { ok: false; error: string } {
  const q = quest(world, questId);
  if (!q) return { ok: false, error: `misión desconocida: ${questId}` };
  const st = characterStory(c);
  if (st.done.includes(q.id)) return { ok: false, error: 'esa misión ya está cumplida' };
  if (!st.open.includes(q.id)) return { ok: false, error: 'esa misión no está abierta para el actor' };
  const s = currentStep(c, q);
  if (!s || s.id !== stepId) return { ok: false, error: `el paso en curso de «${q.title}» es ${s ? `${s.id} («${s.text}»)` : 'ninguno'}` };
  if (!isNarrative(s.done_when)) return { ok: false, error: `ese paso lo detecta el servidor solo (${describeCondition(world, s.done_when)}); no hace falta advance_story` };
  const o = out();
  markStep(world, c, q, s, nowS, o, why?.trim() || explain(world, c, s.done_when));
  advanceCharacter(world, c, nowS, o);
  world.touch('characters', c.id);
  return { ok: true, output: o };
}

/** Paso que puede marcar el máster: narrativo, o con una alternativa narrativa. */
function isNarrative(cond: StoryCondition): boolean {
  return cond.kind === 'narrative' || ((cond.kind === 'any' || cond.kind === 'all') && cond.of.some(isNarrative));
}

// ---------------------------------------------------------------------------
// Lectura (Diario y contexto del máster)
// ---------------------------------------------------------------------------

/** La condición en castellano, para el máster. */
export function describeCondition(world: World, cond: StoryCondition): string {
  const spot = (id: Id) => world.spots.get(id)?.name ?? id;
  const npc = (id: Id) => world.npcs.get(id)?.name ?? id;
  const item = (id: Id) => world.itemDefs.get(id)?.name ?? id;
  switch (cond.kind) {
    case 'clue': return `pista «${world.campaign.clues.find((x) => x.id === cond.clue_id)?.title ?? cond.clue_id}» [${cond.clue_id}] con grant_clue`;
    case 'visit': return `llegar a ${spot(cond.spot_id)} [${cond.spot_id}]`;
    case 'at_location': return `estar en ${world.locations.get(cond.location_id)?.name ?? cond.location_id}`;
    case 'visit_location': return `haber estado en ${world.locations.get(cond.location_id)?.name ?? cond.location_id}`;
    case 'npc_at': return `${npc(cond.npc_id)} en ${spot(cond.spot_id)}`;
    case 'carry': return `llevar encima ${item(cond.item_id)}${(cond.quantity ?? 1) > 1 ? ` ×${cond.quantity}` : ''} [${cond.item_id}]`;
    case 'npc_has': return `que ${npc(cond.npc_id)} tenga ${item(cond.item_id)} (transfer_item al NPC)`;
    case 'npc_status': return `${npc(cond.npc_id)} ${cond.status === 'dead' ? 'muerto' : cond.status === 'missing' ? 'desaparecido' : 'vivo'}`;
    case 'attitude': return `${npc(cond.npc_id)} con actitud ${cond.at_least} o mejor`;
    case 'spot_state': return `estado de ${spot(cond.spot_id)}: ${cond.key}${cond.value === undefined ? '' : ` = ${JSON.stringify(cond.value)}`} (update_spot_state)`;
    case 'discovered': return `descubrir ${spot(cond.spot_id)} (discover_spot)`;
    case 'knows': return `saber quién es ${npc(cond.npc_id)}`;
    case 'job': return `encargo ${cond.job_id} cumplido`;
    case 'quest': return `misión «${quest(world, cond.quest_id)?.title ?? cond.quest_id}» cumplida`;
    case 'narrative': return `lo decides tú con advance_story: ${cond.how}`;
    case 'any': return cond.of.map((x) => describeCondition(world, x)).join(' O ');
    case 'all': return cond.of.map((x) => describeCondition(world, x)).join(' Y ');
    case 'not': return `que no se cumpla: ${describeCondition(world, cond.of)}`;
  }
}

export interface StoryQuestView {
  quest: StoryQuest;
  status: 'active' | 'completed' | 'expired';
  steps: { step: StoryStep; done: boolean }[];
  current: StoryStep | null;
}

/** Misiones que el PJ conoce (abiertas, cumplidas o caducadas), con sus pasos dados y el actual. Los futuros no salen. */
export function questsOf(world: World, c: Character): StoryQuestView[] {
  const story = storyOf(world);
  if (!story) return [];
  const st = characterStory(c);
  const views: StoryQuestView[] = [];
  for (const q of story.quests) {
    const status = st.done.includes(q.id) ? 'completed' : st.expired.includes(q.id) ? 'expired' : st.open.includes(q.id) ? 'active' : null;
    if (!status) continue;
    const cur = status === 'active' ? currentStep(c, q) : null;
    const steps: StoryQuestView['steps'] = [];
    for (const s of q.steps) {
      const done = st.steps.includes(stepKey(q, s));
      if (!done && s !== cur) break;
      steps.push({ step: s, done });
    }
    views.push({ quest: q, status, steps, current: cur });
  }
  return views;
}

/** Próximo escalón de la amenaza que aún puede pasar. */
export function nextEscalation(world: World, nowS: number): { escalation: StoryEscalation; in_s: number } | null {
  const story = storyOf(world);
  if (!story) return null;
  const st = stateOf(world);
  const e = story.escalation.find((x) => !st.escalated.includes(x.id) && !st.escalated.includes(`!${x.id}`));
  return e ? { escalation: e, in_s: Math.max(0, st.started_game_s + e.after_hours * GAME_HOUR - nowS) } : null;
}

/** Bloque del contexto del máster: misiones del actor con su paso en curso y la amenaza. null sin historia. */
export function storyContext(world: World, c: Character, nowS: number): string | null {
  const story = storyOf(world);
  if (!story) return null;
  const views = questsOf(world, c).filter((v) => v.status === 'active');
  const st = stateOf(world);
  const passed = story.escalation.filter((e) => st.escalated.includes(e.id));
  const next = nextEscalation(world, nowS);
  const L: string[] = ['## Historia escrita (solo tú la ves; los pasos se cumplen con tools, nunca solo con texto)'];
  if (!views.length) L.push('El actor no tiene misiones abiertas: la historia le llega por lo que vea y por quien le hable.');
  const origins = characterStory(c).origins ?? {};
  for (const v of views.slice(0, 4)) {
    const q = v.quest;
    const giver = q.giver_npc_id ? world.npcs.get(q.giver_npc_id)?.name : null;
    const o = origins[q.id];
    // Cómo le llegó: si es de oídas, quien la da aún no se la ha pedido; si acaba de pedírsela, que se note en la charla.
    const how = !o ? '' : o.kind === 'heard' ? `; le llegó de oídas («${o.text}»): ${giver ?? 'nadie'} aún no se la ha pedido en persona`
      : o.kind === 'giver' && nowS - o.game_s <= 15 * 60 ? `; ${giver} se la acaba de pedir: que se le oiga pedirla en la charla si aún no lo ha hecho` : '';
    L.push(`- Acto ${q.act} · «${q.title}» [${q.id}]${giver ? ` (de ${giver}${how})` : how ? ` (${how.slice(2)})` : ''}: ${q.notes}`);
    if (v.current) L.push(`  Paso en curso [${v.current.id}]: ${v.current.text}. Se cumple: ${describeCondition(world, v.current.done_when)}.`);
  }
  // Las que ya podría tener pero esperan a que se las pida quien las da: se abren solas cuando hable con esa persona.
  const st0 = characterStory(c);
  const waiting = story.quests.filter((q) => q.giver_npc_id && !q.heard && !st0.open.includes(q.id) && !st0.done.includes(q.id) && !st0.expired.includes(q.id)
    && (!q.opens_when || holds(world, c, q.opens_when)) && !exclusiveTaken(world, q));
  for (const q of waiting.slice(0, 3)) {
    L.push(`- Pendiente de que se la pidan: «${q.title}» [${q.id}] (de ${world.npcs.get(q.giver_npc_id!)?.name ?? q.giver_npc_id}). Se abre sola cuando el actor hable con esa persona: que ella lo saque en la charla.`);
  }
  if (passed.length) L.push(`Ya ha pasado (la amenaza avanza): ${passed.map((e) => e.title).join('; ')}.`);
  if (next) L.push(`Lo próximo si nadie lo evita: «${next.escalation.title}» en unas ${Math.max(1, Math.round(next.in_s / GAME_HOUR))} h de juego (se evita con: ${describeCondition(world, next.escalation.unless)}).`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Validación (la usa src/worldgen/validate.ts)
// ---------------------------------------------------------------------------

/** Errores de referencias y forma de la historia. Vacío = válida. */
export function validateStory(story: Story, has: { spot: (id: Id) => boolean; location: (id: Id) => boolean; npc: (id: Id) => boolean; item: (id: Id) => boolean; clue: (id: Id) => boolean; job: (id: Id) => boolean; exit: (id: Id) => boolean }): string[] {
  const errs: string[] = [];
  const qids = new Set<Id>();
  for (const q of story.quests) {
    if (qids.has(q.id)) errs.push(`historia: la misión ${q.id} está repetida.`);
    qids.add(q.id);
  }
  const cond = (where: string, c: StoryCondition): void => {
    switch (c.kind) {
      case 'clue': if (!has.clue(c.clue_id)) errs.push(`${where}: la pista ${c.clue_id} no existe.`); break;
      case 'visit': case 'discovered': if (!has.spot(c.spot_id)) errs.push(`${where}: el punto ${c.spot_id} no existe.`); break;
      case 'spot_state': if (!has.spot(c.spot_id)) errs.push(`${where}: el punto ${c.spot_id} no existe.`); break;
      case 'visit_location': case 'at_location': if (!has.location(c.location_id)) errs.push(`${where}: la localización ${c.location_id} no existe.`); break;
      case 'npc_at': if (!has.npc(c.npc_id) || !has.spot(c.spot_id)) errs.push(`${where}: ${c.npc_id} o ${c.spot_id} no existe.`); break;
      case 'carry': if (!has.item(c.item_id)) errs.push(`${where}: el objeto ${c.item_id} no existe.`); break;
      case 'npc_has': if (!has.npc(c.npc_id) || !has.item(c.item_id)) errs.push(`${where}: ${c.npc_id} o ${c.item_id} no existe.`); break;
      case 'npc_status': case 'attitude': case 'knows': if (!has.npc(c.npc_id)) errs.push(`${where}: el NPC ${c.npc_id} no existe.`); break;
      case 'job': if (!has.job(c.job_id)) errs.push(`${where}: el encargo ${c.job_id} no existe.`); break;
      case 'quest': if (!qids.has(c.quest_id)) errs.push(`${where}: la misión ${c.quest_id} no existe.`); break;
      case 'narrative': if (!c.how.trim()) errs.push(`${where}: paso narrativo sin «how».`); break;
      case 'any': case 'all': if (!c.of.length) errs.push(`${where}: ${c.kind} vacío.`); c.of.forEach((x) => cond(where, x)); break;
      case 'not': cond(where, c.of); break;
    }
  };
  const eff = (where: string, e: StoryEffect): void => {
    const npcIds = 'npc_id' in e ? [e.npc_id] : [];
    for (const id of npcIds) if (!has.npc(id)) errs.push(`${where}: el NPC ${id} no existe.`);
    if ('spot_id' in e && e.spot_id !== undefined && !has.spot(e.spot_id)) errs.push(`${where}: el punto ${e.spot_id} no existe.`);
    if ('location_id' in e && !has.location(e.location_id)) errs.push(`${where}: la localización ${e.location_id} no existe.`);
    if (e.kind === 'clue' && !has.clue(e.clue_id)) errs.push(`${where}: la pista ${e.clue_id} no existe.`);
    if (e.kind === 'give_item' && !has.item(e.item_id)) errs.push(`${where}: el objeto ${e.item_id} no existe.`);
    if (e.kind === 'exit_state' && !has.exit(e.exit_id)) errs.push(`${where}: la salida ${e.exit_id} no existe.`);
    if (e.kind === 'rumor' && !RUMOR_KINDS.includes(e.rumor_kind)) errs.push(`${where}: tipo de rumor no válido ${e.rumor_kind}.`);
    if (e.kind === 'hook' && e.trigger === 'spot' && !e.spot_id) errs.push(`${where}: gancho de punto sin spot_id.`);
    if (e.kind === 'schedule') {
      if (!has.location(e.event.location_id) || !has.spot(e.event.spot_id)) errs.push(`${where}: el evento ${e.event.id} apunta a un sitio que no existe.`);
      for (const id of e.event.npc_ids) if (!has.npc(id)) errs.push(`${where}: el evento ${e.event.id} trae a ${id}, que no existe.`);
    }
    if (e.kind === 'npc_status' && e.hideout_spot_id && !has.spot(e.hideout_spot_id)) errs.push(`${where}: el escondite ${e.hideout_spot_id} no existe.`);
    if (e.kind === 'npc_routine' && e.routine) for (const id of Object.values(e.routine)) if (id && !has.spot(id)) errs.push(`${where}: horario con el punto ${id}, que no existe.`);
  };
  for (const q of story.quests) {
    const w = `misión ${q.id}`;
    if (!q.title.trim() || !q.text.trim() || !q.notes.trim()) errs.push(`${w}: falta título, texto o notas.`);
    if (![1, 2, 3].includes(q.act)) errs.push(`${w}: el acto debe ser 1, 2 o 3.`);
    if (q.giver_npc_id && !has.npc(q.giver_npc_id)) errs.push(`${w}: quien la da (${q.giver_npc_id}) no existe.`);
    if (q.heard !== undefined && !q.heard.trim()) errs.push(`${w}: «heard» vacío (di cómo le llega al PJ, o quítalo).`);
    if (!q.steps.length) errs.push(`${w}: sin pasos.`);
    const sids = new Set<Id>();
    for (const s of q.steps) {
      if (sids.has(s.id)) errs.push(`${w}: el paso ${s.id} está repetido.`);
      sids.add(s.id);
      if (!s.text.trim()) errs.push(`${w}/${s.id}: sin texto.`);
      cond(`${w}/${s.id}`, s.done_when);
      (s.on_done ?? []).forEach((e) => eff(`${w}/${s.id}`, e));
    }
    if (q.opens_when) cond(`${w} (apertura)`, q.opens_when);
    if (q.reward.item_id && !has.item(q.reward.item_id)) errs.push(`${w}: el premio ${q.reward.item_id} no existe.`);
    [...(q.on_open ?? []), ...q.on_complete].forEach((e) => eff(w, e));
  }
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
