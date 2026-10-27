/**
 * Hechos y reglas del mundo (bloque I), como Osiris en Baldur's Gate 3 o el
 * Story Manager de Skyrim: «SI pasa esto Y se cumple esto ENTONCES…», escrito
 * en los datos de la campaña (`campaign.reactions: [{ when, if, then }]`). El
 * motor no sabe nada de ninguna campaña: detecta eventos, apunta hechos y
 * aplica las reglas que los datos declaran.
 *
 *   - **Eventos** (`when`): el motor los saca comparando el estado del mundo
 *     con el de la pasada anterior, sin enganches en cada sistema: un NPC que
 *     muere, desaparece, vuelve o cambia de estado (`npc_status`, y lo que
 *     añada el combate); un NPC que llega a un sitio; un paso o una misión que
 *     se abre, se cumple, falla, caduca o se rechaza (`quest`); un incidente
 *     del crimen (`incident`); un objeto que cambia de manos (`item`); el
 *     estado de un punto (`spot_state`); una etiqueta ganada (`tag`); una
 *     opinión que cruza un umbral (`opinion`); un descanso largo, un hito de
 *     la amenaza o un día nuevo; un hecho que pone otra regla (`fact`); o una
 *     condición que pasa a cumplirse (`state`, la de la historia).
 *   - **Hechos** (worldfacts.ts): los eventos que importan quedan apuntados,
 *     con quién los vio. Corren de boca en boca con las rutinas (quien coincide
 *     con alguien que lo sabe se entera, con retraso), igual que la noticia de
 *     un crimen. Las condiciones los consultan después (`{ kind: 'fact' }`):
 *     así lo que se salva o se condena vuelve.
 *   - **Efectos** (`then`): los de la historia (story.ts: npc_move, actitud,
 *     spot_state, rumor, hook, announce…) y los nuevos: `opinion` (±1/5/10,
 *     solo a quien lo sabe; a quien no, cuando le llega), `tag`, `topic` (un
 *     tema de conversación para un NPC, para el máster), `comment` (lo que la
 *     gente comenta al pasar, chatter.ts), `lead` (abrir o cerrar una pista de
 *     una misión) y `fact`.
 *
 * Lo de antes sigue igual y se ejecuta donde estaba (los `on_done`, `on_accept`
 * y `on_complete` de cada misión, los escalones de la amenaza y las reacciones
 * por papel de los incidentes): `legacyRules` lo traduce a reglas para verlo
 * todo en una tabla, como la hoja de cálculo de decisiones de Larian, sin
 * aplicarlo dos veces.
 *
 * El estado (lo visto en la pasada anterior, qué reglas han saltado, lo que
 * espera a que llegue una noticia y los temas vivos) va en la campaña
 * (`campaign.world_rules_state`), como el de la historia.
 */

import { GAME_DAY, GAME_MINUTE } from '../clock/clock.js';
import { addChatter, type ChatterKind } from './chatter.js';
import { allIncidents, deedText } from './crime.js';
import type { Character, Id, IncidentKind, Npc } from './model.js';
import { changeOpinion, dropTag, earnTag, opinionEffects, opinionOf, opinionReasons, tagLabel, tagReactionsFor, tagsOf, type OpinionChange } from './standing.js';
import { applyStoryEffects, characterStory, conditionErrors, effectErrors, emptyStoryOutput, holds, storyOf, type Story, type StoryCondition, type StoryEffect, type StoryOutput, type StoryRefs } from './story.js';
import { allFacts, FACT_NEWS_S, factById, knowsFact, learnFact, removeFact, setFact, type WorldFact } from './worldfacts.js';
import type { World } from './world.js';

// ---------------------------------------------------------------------------
// Definición (datos de campaña)
// ---------------------------------------------------------------------------

export type QuestEventKind = 'open' | 'step' | 'done' | 'failed' | 'expired' | 'declined';

/** Lo que dispara una regla. Los filtros que faltan valen para cualquiera. */
export type RuleTrigger =
  /** Un NPC cambia de estado: `dead`, `missing`, `alive` (vuelve a aparecer) o el que traiga el combate (`unconscious`). `by`: quién lo hizo. */
  | { on: 'npc_status'; npc_id?: Id; status: string; by?: 'pc' | 'npc' | 'any' }
  /** Un NPC llega a una localización. */
  | { on: 'npc_arrives'; npc_id?: Id; location_id?: Id }
  | { on: 'quest'; quest_id?: Id; event: QuestEventKind; step_id?: Id }
  /** Un incidente (crime.ts) nuevo o que sube de gravedad. */
  | { on: 'incident'; kind?: IncidentKind | IncidentKind[]; victim_id?: Id; min_severity?: number }
  /** Un objeto cambia de manos: de quién (`from`/`from_npc`) a quién (`to`/`to_npc`). */
  | { on: 'item'; item_id?: Id; to?: 'npc' | 'character' | 'spot'; to_npc?: Id; from?: 'npc' | 'character' | 'spot'; from_npc?: Id }
  | { on: 'spot_state'; spot_id: Id; key: string; value?: string | number | boolean }
  /** Un PJ gana una etiqueta. */
  | { on: 'tag'; tag: Id }
  /** La opinión de un NPC con un PJ cruza un umbral (llega a `at_least` o baja a `at_most`). */
  | { on: 'opinion'; npc_id?: Id; at_least?: number; at_most?: number }
  /** Un PJ termina un descanso largo. */
  | { on: 'rest' }
  /** Pasa un escalón de la amenaza (story.ts). */
  | { on: 'milestone'; id?: Id }
  /** Empieza un día de juego. */
  | { on: 'day' }
  /** Otra regla ha apuntado ese hecho. */
  | { on: 'fact'; id: Id }
  /** Pasa a cumplirse una condición de la historia (para cada PJ). */
  | { on: 'state'; cond: StoryCondition };

/** Lo que hace una regla: los efectos de la historia y los del mundo que reacciona. `{pc}`, `{npc}`, `{npc_role}`, `{place}`, `{quest}`, `{item}`, `{tag}` se rellenan. */
export type RuleEffect =
  | StoryEffect
  /** Opinión de ese NPC (o de quienes lo vieron) con el PJ del evento: ±1, ±5 o ±10. Solo si lo sabe; si no, cuando le llegue. */
  | { kind: 'opinion'; npc_id: Id | 'witnesses'; delta: number; why: string }
  /** El PJ del evento gana (o pierde) una etiqueta. */
  | { kind: 'tag'; tag: Id; remove?: boolean; why?: string }
  /** Un tema que el NPC tiene en la cabeza unos días (para el máster). Si el evento es un hecho, cuando lo sepa. */
  | { kind: 'topic'; npc_id: Id; text: string; days?: number }
  /**
   * Lo que la gente comenta al pasar unos días (chatter.ts): plantillas con huecos. Sin `location_ids`, donde pasó.
   * Sin plantillas, `prompt` se lo pide una vez a un modelo barato (si el motor tiene uno).
   */
  | { kind: 'comment'; comment_kind: ChatterKind; texts: string[]; prompt?: string; location_ids?: Id[]; npc_ids?: Id[]; days?: number; per_day?: number; about_present?: boolean }
  /** Abre o cierra una pista (un paso) de una misión para el PJ del evento (o para quien la tenga abierta). */
  | { kind: 'lead'; quest_id: Id; step_id: Id; open: boolean }
  /** Apunta (o borra) un hecho consultable. */
  | { kind: 'fact'; id: Id; text?: string; remove?: boolean };

export interface WorldRule {
  id: Id;
  when: RuleTrigger;
  /** Condición sobre el estado (la de la historia), para el PJ del evento. */
  if?: StoryCondition;
  then: RuleEffect[];
  /** Cuántas veces: una por evento (por defecto), una por PJ o una en todo el mundo. */
  once?: 'event' | 'character' | 'world';
  /** Para quien escribe la campaña: por qué existe. */
  note?: string;
  /** Traducida de un campo de antes (`legacyRules`): solo para leer, la ejecuta story.ts. */
  legacy?: boolean;
}

/** Un evento del mundo, ya detectado. */
export interface WorldEvent {
  kind: RuleTrigger['on'];
  /** Única por evento: con ella una regla salta una sola vez. */
  key: string;
  /** Hecho que apunta (los eventos que importan), o null. */
  fact_id: Id | null;
  /** PJ que lo hizo o a quien le pasa. */
  character_id: Id | null;
  npc_id: Id | null;
  location_id: Id | null;
  game_s: number;
  /** NPC que lo han visto. */
  witnesses: Id[];
  data: Record<string, unknown>;
  vars: Record<string, string>;
}

interface Seen {
  npc: Record<Id, string>;
  npc_loc: Record<Id, Id>;
  quests: Record<Id, string[]>;
  incidents: Record<Id, number>;
  items: Record<Id, string>;
  spots: Record<Id, string>;
  rests: Record<Id, number | null>;
  escalated: string[];
  day: number;
  /** Reglas `state` que ya se cumplían (`regla@pj`). */
  state: string[];
}

/** Lo que espera a que la noticia llegue a un NPC: entonces cambia su opinión o le entra el tema. */
interface Pending {
  fact_id: Id;
  npc_id: Id;
  character_id: Id | null;
  effect: { kind: 'opinion'; delta: number; why: string } | { kind: 'topic'; text: string; days: number };
  rule_id: Id;
}

export interface Topic { npc_id: Id; text: string; until_game_s: number; rule_id: Id; fact_id: Id | null }

export interface RulesState {
  seen: Seen | null;
  fired: string[];
  pending: Pending[];
  topics: Topic[];
}

type RulesCampaign = { reactions?: WorldRule[]; world_rules_state?: RulesState };

/** Tras cuánto puede contar una noticia quien se acaba de enterar (con retraso, no por arte de magia). */
export const TELL_DELAY_S = 30 * GAME_MINUTE;
const MAX_FIRED = 2000;

export function rulesOf(world: World): WorldRule[] {
  return (world.campaign as typeof world.campaign & RulesCampaign).reactions ?? [];
}

function stateOf(world: World): RulesState {
  const camp = world.campaign as typeof world.campaign & RulesCampaign;
  camp.world_rules_state ??= { seen: null, fired: [], pending: [], topics: [] };
  return camp.world_rules_state;
}

// ---------------------------------------------------------------------------
// Lo que se ve en cada pasada
// ---------------------------------------------------------------------------

function locOfSpot(world: World, spotId: Id | undefined | null): Id | null {
  return spotId ? world.spots.get(spotId)?.location_id ?? null : null;
}

function questKeys(world: World, c: Character): string[] {
  const st = characterStory(c);
  return [
    ...st.open.map((q) => `open:${q}`), ...st.done.map((q) => `done:${q}`), ...st.expired.map((q) => `expired:${q}`),
    ...(st.failed ?? []).map((q) => `failed:${q}`), ...Object.keys(st.declined ?? {}).map((q) => `declined:${q}`),
    ...st.steps.map((k) => `step:${k}`),
  ];
}

function holderOf(world: World, i: { location: { type: string; id: Id } }): string { return `${i.location.type}:${i.location.id}`; }

function observe(world: World, nowS: number, stateRules: WorldRule[]): Seen {
  const s: Seen = { npc: {}, npc_loc: {}, quests: {}, incidents: {}, items: {}, spots: {}, rests: {}, escalated: [], day: Math.floor(nowS / GAME_DAY), state: [] };
  for (const n of world.npcs.values()) { s.npc[n.id] = n.status; const l = locOfSpot(world, n.location.id); if (l) s.npc_loc[n.id] = l; }
  const story = storyOf(world);
  for (const c of world.characters.values()) {
    if (c.status === 'retired') continue;
    if (story) s.quests[c.id] = questKeys(world, c);
    s.rests[c.id] = c.rest?.last_long_rest_game_s ?? null;
    for (const r of stateRules) if (r.when.on === 'state' && holds(world, c, r.when.cond)) s.state.push(`${r.id}@${c.id}`);
  }
  for (const i of allIncidents(world)) s.incidents[i.id] = i.severity;
  for (const i of world.itemInstances.values()) s.items[i.id] = holderOf(world, i);
  for (const sp of world.spots.values()) if (Object.keys(sp.state).length) s.spots[sp.id] = JSON.stringify(sp.state);
  const esc = (world.campaign as typeof world.campaign & { story_state?: { escalated?: string[] } }).story_state?.escalated;
  s.escalated = [...(esc ?? [])];
  return s;
}

const STATUS_ES: Record<string, string> = { dead: 'murió', missing: 'desapareció', alive: 'volvió a aparecer', unconscious: 'quedó inconsciente', asleep: 'se durmió' };

/** NPC vivos que están en esa localización (lo ven), sin los que se dan. */
function npcsIn(world: World, locationId: Id | null, except: Id[] = []): Id[] {
  if (!locationId) return [];
  return [...world.npcs.values()].filter((n) => n.status === 'alive' && !except.includes(n.id) && locOfSpot(world, n.location.id) === locationId).map((n) => n.id);
}

function npcRole(world: World, id: Id): string {
  const n = world.npcs.get(id);
  if (!n) return 'alguien';
  return /^(el|la|los|las) /.test(n.role) ? n.role : /a$/.test(n.role) ? `la ${n.role}` : `el ${n.role}`;
}

function baseVars(world: World, c: Character | null, npcId: Id | null, locationId: Id | null): Record<string, string> {
  const v: Record<string, string> = {};
  if (c) v['pc'] = c.name;
  if (npcId && world.npcs.has(npcId)) { v['npc'] = world.npc(npcId).name; v['npc_role'] = npcRole(world, npcId); }
  if (locationId && world.locations.has(locationId)) v['place'] = world.location(locationId).name;
  return v;
}

function event(world: World, e: Omit<WorldEvent, 'vars'> & { vars?: Record<string, string> }): WorldEvent {
  const c = e.character_id ? world.characters.get(e.character_id) ?? null : null;
  return { ...e, vars: { ...baseVars(world, c, e.npc_id, e.location_id), ...(e.vars ?? {}) } };
}

/** Los eventos de esta pasada: lo que ha cambiado desde la anterior. */
function diff(world: World, prev: Seen, now: Seen, nowS: number, stateRules: WorldRule[]): { ev: WorldEvent; text?: string }[] {
  const out: { ev: WorldEvent; text?: string }[] = [];
  // NPC: estado y sitio.
  for (const n of world.npcs.values()) {
    const before = prev.npc[n.id];
    if (before !== undefined && before !== n.status) {
      const loc = locOfSpot(world, n.location.id);
      const byId = n.status === 'dead' ? n.death?.by_id ?? null : null;
      const byPc = byId && world.characters.has(byId) ? byId : null;
      const byNpc = byId && world.npcs.has(byId) ? byId : null;
      const verb = STATUS_ES[n.status] ?? `pasó a estar ${n.status}`;
      const byName = byPc ? world.character(byPc).name : byNpc ? world.npc(byNpc).name : null;
      out.push({
        ev: event(world, { kind: 'npc_status', key: `npc_${n.status}:${n.id}@${Math.round(nowS)}`, fact_id: `npc_${n.status}:${n.id}`, character_id: byPc, npc_id: n.id, location_id: loc, game_s: nowS, witnesses: npcsIn(world, loc, [n.id]), data: { status: n.status, from: before, by: byPc ? 'pc' : byNpc ? 'npc' : null } }),
        text: `${n.name} (${npcRole(world, n.id)}) ${verb}${byName ? ` a manos de ${byName}` : ''}`,
      });
    }
    const was = prev.npc_loc[n.id];
    const is = now.npc_loc[n.id];
    if (was && is && was !== is && n.status === 'alive') {
      out.push({ ev: event(world, { kind: 'npc_arrives', key: `npc_at:${n.id}:${is}@${Math.round(nowS)}`, fact_id: null, character_id: null, npc_id: n.id, location_id: is, game_s: nowS, witnesses: npcsIn(world, is, [n.id]), data: { from: was } }) });
    }
  }
  // Misiones de cada PJ.
  const story = storyOf(world);
  for (const c of world.characters.values()) {
    const before = prev.quests[c.id];
    const after = now.quests[c.id];
    if (!before || !after || !story) continue;
    const loc = c.transit ? null : world.characterSpot(c)?.location_id ?? null;
    for (const k of after) {
      if (before.includes(k)) continue;
      const [ev, rest] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)] as [string, string];
      const [questId, stepId] = rest.split('/') as [Id, Id | undefined];
      const q = story.quests.find((x) => x.id === questId);
      if (!q) continue;
      const qe = ev as QuestEventKind;
      const text = qe === 'done' ? `${c.name} cumplió «${q.title}»` : qe === 'failed' ? `«${q.title}» se perdió para ${c.name}` : qe === 'declined' ? `${c.name} no quiso ayudar con «${q.title}»` : undefined;
      out.push({
        ev: event(world, { kind: 'quest', key: `quest_${qe}:${rest}@${c.id}`, fact_id: `quest_${qe}:${rest}@${c.id}`, character_id: c.id, npc_id: q.giver_npc_id, location_id: loc, game_s: nowS, witnesses: npcsIn(world, loc), data: { quest_id: questId, step_id: stepId ?? null, event: qe }, vars: { quest: q.title } }),
        ...(text ? { text } : {}),
      });
    }
  }
  // Incidentes del crimen: nuevos o más graves.
  for (const i of allIncidents(world)) {
    const before = prev.incidents[i.id] ?? 0;
    if (i.severity <= before) continue;
    const perp = world.characters.get(i.perpetrator_id) ?? null;
    out.push({
      ev: event(world, { kind: 'incident', key: `incident:${i.id}:${i.severity}`, fact_id: `incident:${i.id}`, character_id: perp?.id ?? null, npc_id: i.victim_id, location_id: i.location_id, game_s: nowS, witnesses: i.knowers.filter((k) => k.how !== 'told').map((k) => k.npc_id), data: { kind: i.kind, severity: i.severity, victim_id: i.victim_id }, vars: { victim: i.victim_name ?? 'alguien' } }),
      text: `${i.perpetrator_name} ${deedText(i)}`,
    });
  }
  // Objetos que cambian de manos.
  for (const inst of world.itemInstances.values()) {
    const was = prev.items[inst.id];
    const is = now.items[inst.id]!;
    if (was === is) continue;
    const [fromT, fromId] = was ? was.split(':') as [string, Id] : [null, null];
    const [toT, toId] = is.split(':') as [string, Id];
    if (fromT === null && toT !== 'npc' && toT !== 'character') continue;
    const pc = toT === 'character' ? toId : fromT === 'character' ? fromId : null;
    const npc = toT === 'npc' ? toId : fromT === 'npc' ? fromId : null;
    const spot = toT === 'spot' ? toId : toT === 'npc' ? world.npcs.get(toId)?.location.id : toT === 'character' && world.characters.has(toId) ? world.characterSpot(world.character(toId))?.id : null;
    const loc = locOfSpot(world, spot ?? null);
    out.push({ ev: event(world, { kind: 'item', key: `item:${inst.id}:${was ?? '-'}>${is}@${Math.round(nowS)}`, fact_id: null, character_id: pc && world.characters.has(pc) ? pc : null, npc_id: npc, location_id: loc, game_s: nowS, witnesses: npcsIn(world, loc), data: { item_id: inst.item_id, from: fromT, from_id: fromId, to: toT, to_id: toId }, vars: { item: world.itemDefs.get(inst.item_id)?.name ?? inst.item_id } }) });
  }
  // Estado de los puntos.
  for (const sp of world.spots.values()) {
    const a = prev.spots[sp.id];
    const b = now.spots[sp.id];
    if (a === b) continue;
    const before = a ? JSON.parse(a) as Record<string, unknown> : {};
    const after = b ? JSON.parse(b) as Record<string, unknown> : {};
    const pc = world.charactersInLocation(sp.location_id).find((c) => c.status === 'active' && !c.transit) ?? null;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      out.push({ ev: event(world, { kind: 'spot_state', key: `spot_state:${sp.id}:${key}=${JSON.stringify(after[key] ?? null)}@${Math.round(nowS)}`, fact_id: null, character_id: pc?.id ?? null, npc_id: null, location_id: sp.location_id, game_s: nowS, witnesses: npcsIn(world, sp.location_id), data: { spot_id: sp.id, key, value: after[key] } }) });
    }
  }
  // Descansos largos.
  for (const c of world.characters.values()) {
    const a = prev.rests[c.id];
    const b = now.rests[c.id];
    if (a === undefined || b === undefined || a === b || b === null) continue;
    out.push({ ev: event(world, { kind: 'rest', key: `rest:${c.id}:${b}`, fact_id: null, character_id: c.id, npc_id: null, location_id: null, game_s: nowS, witnesses: [], data: {} }) });
  }
  // Hitos de la amenaza y días.
  for (const id of now.escalated) {
    if (prev.escalated.includes(id) || id.startsWith('!')) continue;
    const esc = storyOf(world)?.escalation.find((e) => e.id === id);
    out.push({ ev: event(world, { kind: 'milestone', key: `milestone:${id}`, fact_id: `milestone:${id}`, character_id: null, npc_id: null, location_id: esc?.location_id ?? null, game_s: nowS, witnesses: npcsIn(world, esc?.location_id ?? null), data: { id } }), ...(esc ? { text: `Pasó: ${esc.title}` } : {}) });
  }
  if (now.day > prev.day) out.push({ ev: event(world, { kind: 'day', key: `day:${now.day}`, fact_id: null, character_id: null, npc_id: null, location_id: null, game_s: nowS, witnesses: [], data: { day: now.day } }) });
  // Condiciones que pasan a cumplirse.
  for (const k of now.state) {
    if (prev.state.includes(k)) continue;
    const [ruleId, pcId] = k.split('@') as [Id, Id];
    const r = stateRules.find((x) => x.id === ruleId);
    const c = world.characters.get(pcId);
    if (!r || !c) continue;
    const loc = c.transit ? null : world.characterSpot(c)?.location_id ?? null;
    out.push({ ev: event(world, { kind: 'state', key: `state:${ruleId}@${pcId}@${Math.round(nowS)}`, fact_id: null, character_id: c.id, npc_id: null, location_id: loc, game_s: nowS, witnesses: npcsIn(world, loc), data: { rule_id: ruleId } }) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

function matches(t: RuleTrigger, e: WorldEvent, ruleId: Id): boolean {
  if (t.on !== e.kind) return false;
  const d = e.data;
  switch (t.on) {
    case 'npc_status': return (!t.npc_id || t.npc_id === e.npc_id) && t.status === d['status'] && (!t.by || t.by === 'any' || t.by === d['by']);
    case 'npc_arrives': return (!t.npc_id || t.npc_id === e.npc_id) && (!t.location_id || t.location_id === e.location_id);
    case 'quest': return (!t.quest_id || t.quest_id === d['quest_id']) && t.event === d['event'] && (!t.step_id || t.step_id === d['step_id']);
    case 'incident': {
      const kinds = t.kind === undefined ? null : Array.isArray(t.kind) ? t.kind : [t.kind];
      return (!kinds || kinds.includes(d['kind'] as IncidentKind)) && (!t.victim_id || t.victim_id === d['victim_id']) && (t.min_severity === undefined || (d['severity'] as number) >= t.min_severity);
    }
    case 'item': return (!t.item_id || t.item_id === d['item_id']) && (!t.to || t.to === d['to']) && (!t.from || t.from === d['from'])
      && (!t.to_npc || (d['to'] === 'npc' && d['to_id'] === t.to_npc)) && (!t.from_npc || (d['from'] === 'npc' && d['from_id'] === t.from_npc));
    case 'spot_state': return t.spot_id === d['spot_id'] && t.key === d['key'] && (t.value === undefined ? Boolean(d['value']) : d['value'] === t.value);
    case 'tag': return t.tag === d['tag'];
    case 'opinion': {
      if (t.npc_id && t.npc_id !== e.npc_id) return false;
      const from = d['from'] as number;
      const to = d['to'] as number;
      return (t.at_least !== undefined && from < t.at_least && to >= t.at_least) || (t.at_most !== undefined && from > t.at_most && to <= t.at_most);
    }
    case 'rest': case 'day': return true;
    case 'milestone': return !t.id || t.id === d['id'];
    case 'fact': return t.id === d['id'];
    case 'state': return d['rule_id'] === ruleId;
  }
}

/** Rellena los huecos de un texto («{pc} mató a {npc}»). Lo que no se sabe se queda como un genérico. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? (k === 'pc' ? 'el forastero' : k === 'npc' || k === 'npc_role' ? 'alguien' : m));
}

function fillDeep<T>(x: T, vars: Record<string, string>): T {
  if (typeof x === 'string') return fill(x, vars) as T;
  if (Array.isArray(x)) return x.map((v) => fillDeep(v, vars)) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fillDeep(v, vars)])) as T;
  return x;
}

const NEW_KINDS = new Set(['opinion', 'tag', 'topic', 'comment', 'lead', 'fact']);

/** Junta la salida de la historia de un efecto en la de la pasada. */
function merge(o: StoryOutput, x: StoryOutput): void {
  for (const p of x.personal) {
    const slot = o.personal.find((y) => y.character_id === p.character_id);
    if (slot) slot.events.push(...p.events); else o.personal.push({ character_id: p.character_id, events: [...p.events] });
  }
  o.announcements.push(...x.announcements);
  o.beats.push(...x.beats);
}

function tell(o: StoryOutput, c: Character, text: string): void {
  merge(o, { personal: [{ character_id: c.id, events: [{ kind: 'story', text }] }], announcements: [], beats: [] });
}

interface Pass { world: World; nowS: number; out: StoryOutput; queue: WorldEvent[]; opinions: OpinionChange[] }

/** ¿Sabe ese NPC lo del evento? Lo vio, o ya le ha llegado el hecho. */
function knows(world: World, e: WorldEvent, npcId: Id): boolean {
  if (e.witnesses.includes(npcId)) return true;
  const f = e.fact_id ? factById(world, e.fact_id) : null;
  return !!f && knowsFact(f, npcId);
}

function applyOpinion(p: Pass, n: Npc, c: Character, delta: number, why: string): void {
  const ch = changeOpinion(p.world, n, c, delta, why, p.nowS);
  if (!ch) return;
  p.opinions.push(ch);
  // Cruzar un umbral es un evento más (las reglas `opinion`).
  p.queue.push(event(p.world, { kind: 'opinion', key: `opinion:${n.id}@${c.id}:${ch.from}>${ch.to}@${Math.round(p.nowS)}`, fact_id: null, character_id: c.id, npc_id: n.id, location_id: locOfSpot(p.world, n.location.id), game_s: p.nowS, witnesses: [], data: { from: ch.from, to: ch.to } }));
}

function addTopic(world: World, t: Topic): void {
  const st = stateOf(world);
  st.topics = st.topics.filter((x) => !(x.npc_id === t.npc_id && x.text === t.text));
  st.topics.push(t);
  world.touch('campaign', world.campaign.id);
}

function applyEffect(p: Pass, rule: WorldRule, e: WorldEvent, eff: RuleEffect, index: number): void {
  const { world, nowS } = p;
  const c = e.character_id ? world.characters.get(e.character_id) ?? null : null;
  if (!NEW_KINDS.has(eff.kind)) {
    merge(p.out, applyStoryEffects(world, c, [fillDeep(eff as StoryEffect, e.vars)], `rule:${rule.id}|${e.key}|${index}`, nowS));
    return;
  }
  const x = eff as Exclude<RuleEffect, StoryEffect>;
  switch (x.kind) {
    case 'opinion': {
      if (!c) return;
      const why = fill(x.why, e.vars);
      const targets = x.npc_id === 'witnesses' ? e.witnesses : [x.npc_id];
      for (const id of targets) {
        const n = world.npcs.get(id);
        if (!n || n.status === 'dead' || id === e.npc_id && e.data['status'] === 'dead') continue;
        if (knows(world, e, id)) applyOpinion(p, n, c, x.delta, why);
        else if (e.fact_id) stateOf(world).pending.push({ fact_id: e.fact_id, npc_id: id, character_id: c.id, effect: { kind: 'opinion', delta: x.delta, why }, rule_id: rule.id });
      }
      return;
    }
    case 'topic': {
      const text = fill(x.text, e.vars);
      const days = x.days ?? 3;
      if (!e.fact_id || knows(world, e, x.npc_id)) addTopic(world, { npc_id: x.npc_id, text, until_game_s: nowS + days * GAME_DAY, rule_id: rule.id, fact_id: e.fact_id });
      else stateOf(world).pending.push({ fact_id: e.fact_id, npc_id: x.npc_id, character_id: c?.id ?? null, effect: { kind: 'topic', text, days }, rule_id: rule.id });
      return;
    }
    case 'tag': {
      if (!c) return;
      if (x.remove) { dropTag(world, c, x.tag); return; }
      const why = fill(x.why ?? '', e.vars) || 'por lo que hizo';
      if (!earnTag(world, c, x.tag, why, e.fact_id, nowS)) return;
      tell(p.out, c, `🏷 Etiqueta nueva: «${tagLabel(world, x.tag)}» (${why}).`);
      p.queue.push(event(world, { kind: 'tag', key: `tag:${x.tag}@${c.id}`, fact_id: e.fact_id, character_id: c.id, npc_id: e.npc_id, location_id: e.location_id, game_s: nowS, witnesses: e.witnesses, data: { tag: x.tag }, vars: { ...e.vars, tag: tagLabel(world, x.tag) } }));
      return;
    }
    case 'comment': {
      const locs = x.location_ids?.length ? x.location_ids : e.location_id ? [e.location_id] : [];
      if (!locs.length || (!x.texts.length && !x.prompt)) return;
      addChatter(world, {
        id: `${rule.id}|${e.key}|${index}`, kind: x.comment_kind, texts: x.texts, location_ids: locs, npc_ids: x.npc_ids ?? null,
        fact_id: e.fact_id, about: c?.id ?? null, subject: e.npc_id, vars: e.vars, from_game_s: nowS,
        until_game_s: nowS + (x.days ?? 3) * GAME_DAY, per_day: x.per_day ?? 4, ...(x.about_present ? { about_present: true } : {}), ...(x.prompt ? { prompt: fill(x.prompt, e.vars) } : {}),
      });
      return;
    }
    case 'lead': {
      const who = c ? [c] : [...world.characters.values()].filter((y) => characterStory(y).open.includes(x.quest_id));
      for (const y of who) {
        const st = characterStory(y);
        st.leads = { ...(st.leads ?? {}), [`${x.quest_id}/${x.step_id}`]: x.open ? 'open' : 'closed' };
        world.touch('characters', y.id);
      }
      return;
    }
    case 'fact': {
      if (x.remove) { removeFact(world, x.id); return; }
      const isNew = !factById(world, x.id);
      setFact(world, { id: x.id, ...(x.text ? { text: fill(x.text, e.vars) } : {}), by: c?.id ?? null, subject: e.npc_id, location_id: e.location_id, game_s: nowS, knowers: e.witnesses.map((id) => ({ npc_id: id, how: 'saw' as const, from: null, game_s: nowS })), spreads: e.witnesses.length > 0 });
      if (isNew) p.queue.push(event(world, { kind: 'fact', key: `fact:${x.id}`, fact_id: x.id, character_id: c?.id ?? null, npc_id: e.npc_id, location_id: e.location_id, game_s: nowS, witnesses: e.witnesses, data: { id: x.id }, vars: e.vars }));
      return;
    }
  }
}

function fire(p: Pass, rule: WorldRule, e: WorldEvent): void {
  const st = stateOf(p.world);
  const once = rule.once ?? 'event';
  const key = once === 'world' ? rule.id : once === 'character' ? `${rule.id}@${e.character_id ?? '-'}` : `${rule.id}|${e.key}`;
  if (st.fired.includes(key)) return;
  const c = e.character_id ? p.world.characters.get(e.character_id) ?? null : null;
  if (rule.if && !holds(p.world, c, rule.if)) return;
  st.fired.push(key);
  if (st.fired.length > MAX_FIRED) st.fired.splice(0, st.fired.length - MAX_FIRED);
  p.world.touch('campaign', p.world.campaign.id);
  rule.then.forEach((eff, i) => applyEffect(p, rule, e, eff, i));
}

// ---------------------------------------------------------------------------
// La noticia corre
// ---------------------------------------------------------------------------

/** Quien sabe del incidente (crime.ts) sabe el hecho; y, si murió alguien, también su muerte. */
function mirrorIncidents(world: World, nowS: number, learned: (f: WorldFact, npcId: Id) => void): void {
  for (const i of allIncidents(world)) {
    const facts = [factById(world, `incident:${i.id}`), i.kind === 'murder' && i.victim_id ? factById(world, `npc_dead:${i.victim_id}`) : null].filter((f): f is WorldFact => Boolean(f));
    for (const f of facts) for (const k of i.knowers) {
      if (learnFact(world, f, { npc_id: k.npc_id, how: k.how === 'told' ? 'told' : 'saw', from: k.from, game_s: k.game_s ?? nowS })) learned(f, k.npc_id);
    }
  }
}

/**
 * De boca en boca, sin IA: quien coincide en una localización con alguien que
 * lo sabe desde hace un rato (TELL_DELAY_S) se entera; quien llega adonde está
 * el cuerpo de un muerto, también. Los de los incidentes los lleva crime.ts.
 */
function spreadFacts(world: World, nowS: number, learned: (f: WorldFact, npcId: Id) => void): void {
  const where = new Map<Id, Id>();
  for (const n of world.npcs.values()) if (n.status === 'alive') { const l = locOfSpot(world, n.location.id); if (l) where.set(n.id, l); }
  for (const f of allFacts(world)) {
    if (f.spreads === false || f.id.startsWith('incident:') || nowS - f.game_s > FACT_NEWS_S) continue;
    // El cuerpo sigue ahí: quien llega lo ve.
    if (f.id.startsWith('npc_dead:') && f.subject) {
      const body = world.npcs.get(f.subject);
      const at = body?.status === 'dead' ? locOfSpot(world, body.location.id) : null;
      if (at) for (const [id, l] of where) if (l === at && learnFact(world, f, { npc_id: id, how: 'saw', from: null, game_s: nowS })) learned(f, id);
    }
    for (const k of [...f.knowers]) {
      if (nowS - k.game_s < TELL_DELAY_S || world.npcs.get(k.npc_id)?.mute) continue;
      const loc = where.get(k.npc_id);
      if (!loc) continue;
      for (const [id, l] of where) if (l === loc && learnFact(world, f, { npc_id: id, how: 'told', from: k.npc_id, game_s: nowS })) learned(f, id);
    }
  }
}

/** Lo que esperaba a que la noticia llegase a este NPC. */
function deliverPending(p: Pass, f: WorldFact, npcId: Id): void {
  const st = stateOf(p.world);
  const due = st.pending.filter((x) => x.fact_id === f.id && x.npc_id === npcId);
  if (!due.length) return;
  st.pending = st.pending.filter((x) => !due.includes(x));
  p.world.touch('campaign', p.world.campaign.id);
  const n = p.world.npcs.get(npcId);
  if (!n || n.status !== 'alive') return;
  for (const x of due) {
    if (x.effect.kind === 'topic') { addTopic(p.world, { npc_id: npcId, text: x.effect.text, until_game_s: p.nowS + x.effect.days * GAME_DAY, rule_id: x.rule_id, fact_id: f.id }); continue; }
    const c = x.character_id ? p.world.characters.get(x.character_id) : undefined;
    if (c) applyOpinion(p, n, c, x.effect.delta, x.effect.why);
  }
}

/** Reacciones a etiquetas con opinión: la primera vez que el NPC sabe que el PJ la tiene. */
function tagOpinions(p: Pass): void {
  const { world } = p;
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive' || !n.tag_reactions?.some((r) => r.opinion)) continue;
    for (const c of world.characters.values()) {
      if (c.status === 'retired' || c.status === 'dead') continue;
      for (const { reaction, tag } of tagReactionsFor(world, n, c, (fid) => { const f = factById(world, fid); return !!f && knowsFact(f, n.id); })) {
        if (!reaction.opinion || n.opinion?.[c.id]?.tags_seen?.includes(tag.id)) continue;
        applyOpinion(p, n, c, reaction.opinion, `por ser ${tag.label}`);
        const e = n.opinion?.[c.id];
        if (e) e.tags_seen = [...(e.tags_seen ?? []), tag.id];
        world.touch('npcs', n.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// La pasada
// ---------------------------------------------------------------------------

export interface WorldTick { story: StoryOutput; events: WorldEvent[]; opinions: OpinionChange[] }

/**
 * En cada tick y tras cada acción (engine.ts, junto a la historia): detecta lo
 * que ha cambiado, apunta los hechos, aplica las reglas, hace correr las
 * noticias y entrega lo que esperaba a que llegasen. La primera pasada solo
 * mira: lo que ya era así al empezar no es un evento.
 */
export function tickWorld(world: World, nowS: number): WorldTick {
  const st = stateOf(world);
  const rules = rulesOf(world);
  const stateRules = rules.filter((r) => r.when.on === 'state');
  const p: Pass = { world, nowS, out: emptyStoryOutput(), queue: [], opinions: [] };
  const now = observe(world, nowS, stateRules);
  if (!st.seen) { st.seen = now; world.touch('campaign', world.campaign.id); return { story: p.out, events: [], opinions: [] }; }
  // Un PJ nuevo empieza con lo que ya tiene (su misión principal no es un evento).
  for (const id of Object.keys(now.quests)) st.seen.quests[id] ??= now.quests[id]!;
  for (const id of Object.keys(now.rests)) if (!(id in st.seen.rests)) st.seen.rests[id] = now.rests[id]!;
  const found = diff(world, st.seen, now, nowS, stateRules);
  st.seen = now;
  world.touch('campaign', world.campaign.id);
  for (const { ev, text } of found) {
    if (ev.fact_id) setFact(world, { id: ev.fact_id, ...(text ? { text } : {}), by: ev.character_id, subject: ev.npc_id, location_id: ev.location_id, game_s: nowS, knowers: ev.witnesses.map((id) => ({ npc_id: id, how: 'saw' as const, from: null, game_s: nowS })) });
    p.queue.push(ev);
  }
  const learned = (f: WorldFact, npcId: Id) => deliverPending(p, f, npcId);
  mirrorIncidents(world, nowS, learned);
  spreadFacts(world, nowS, learned);
  const done: WorldEvent[] = [];
  const run = () => {
    for (let guard = 0; p.queue.length && guard < 200; guard++) {
      const e = p.queue.shift()!;
      done.push(e);
      for (const r of rules) if (!r.legacy && matches(r.when, e, r.id)) fire(p, r, e);
    }
  };
  run();
  // Las etiquetas ganadas en esta pasada ya cuentan para quien sabe el hecho; y sus umbrales, también.
  tagOpinions(p);
  run();
  // Temas que ya han pasado.
  const live = st.topics.filter((t) => t.until_game_s > nowS && world.npcs.get(t.npc_id)?.status === 'alive');
  if (live.length !== st.topics.length) st.topics = live;
  return { story: p.out, events: done, opinions: p.opinions };
}

// ---------------------------------------------------------------------------
// Lectura: contexto del máster
// ---------------------------------------------------------------------------

export function topicsOf(world: World, npcId: Id, nowS: number): Topic[] {
  return stateOf(world).topics.filter((t) => t.npc_id === npcId && t.until_game_s > nowS);
}

/** Las etiquetas del PJ, para el máster: «Etiquetas: elfo, mago, erudito, salvó a Ceniza». */
export function tagsLine(world: World, c: Character): string {
  return `Etiquetas: ${tagsOf(world, c).map((t) => t.label + (t.kind === 'earned' && t.why ? ` (${t.why})` : '')).join(', ')}.`;
}

/** Lo que va en el bloque de cada NPC presente: opinión, temas y cómo reacciona a las etiquetas del actor. */
export function npcStandingLines(world: World, n: Npc, c: Character, nowS: number): string[] {
  const L: string[] = [];
  const v = opinionOf(n, c.id);
  if (v) {
    const why = opinionReasons(n, c.id);
    const fx = opinionEffects(n, c.id);
    L.push(`  Opinión de ${c.name}: ${v > 0 ? '+' : ''}${v}${why.length ? ` (${why.join('; ')})` : ''}.${fx ? ` ${fx}.` : ''}`);
  }
  const topics = topicsOf(world, n.id, nowS);
  if (topics.length) L.push(`  Tiene en la cabeza: ${topics.map((t) => t.text).join(' / ')}`);
  const reacts = tagReactionsFor(world, n, c, (fid) => { const f = factById(world, fid); return !!f && knowsFact(f, n.id); });
  if (reacts.length) {
    L.push(`  Reacciona a lo que sabe de ${c.name}: ${reacts.map(({ reaction: r, tag }) => `${tag.label} → ${r.note}${r.option ? ` (opción con tirada: «${r.option.text}», ${r.option.skill} CD ${r.option.dc})` : ''}`).join(' · ')}`);
  }
  return L;
}

/** Hechos del mundo para el máster, con quién los sabe (nadie más los sabe: no por adivinación). */
export function factsContext(world: World, c: Character): string | null {
  const facts = allFacts(world).filter((f) => f.text).slice(-8);
  if (!facts.length) return null;
  const who = (f: WorldFact) => {
    const names = f.knowers.map((k) => world.npcs.get(k.npc_id)?.name).filter(Boolean) as string[];
    return names.length ? `lo saben: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}` : 'no lo sabe nadie del pueblo';
  };
  return `## Hechos del mundo (lo que ha pasado)\n${facts.map((f) => `- ${f.text}${f.by === c.id ? ' [el actor]' : ''} (${who(f)}).`).join('\n')}\nSolo lo comenta o actúa por ello quien lo sabe.`;
}

/**
 * Opciones con etiqueta para los botones (como las de BG3): las del NPC con
 * quien habla el actor (o tiene delante), si sabe que tiene esa etiqueta.
 * «[Soldado] Hablarle de tú a tú, entre soldados (Persuasión CD 12)».
 */
export function tagOptions(world: World, c: Character, skillName: (key: string) => string): string[] {
  const here = c.transit ? null : world.characterSpot(c)?.id;
  const out: string[] = [];
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive' || !n.tag_reactions?.length) continue;
    const talking = n.talking_to?.character_id === c.id || (n.talking_to?.with ?? []).includes(c.id);
    if (!talking && n.location.id !== here) continue;
    for (const { reaction: r, tag } of tagReactionsFor(world, n, c, (fid) => { const f = factById(world, fid); return !!f && knowsFact(f, n.id); })) {
      if (r.option) out.push(`[${tag.label.charAt(0).toUpperCase()}${tag.label.slice(1)}] ${r.option.text} (${skillName(r.option.skill)} CD ${r.option.dc})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lo de antes, como reglas (solo para leer)
// ---------------------------------------------------------------------------

/**
 * Las consecuencias escritas a la antigua (`on_accept`, `on_done`,
 * `on_complete`, `deadline.on_lost` y los escalones de la amenaza) como reglas
 * `legacy`: para verlas todas juntas en una tabla y validarlas igual. No se
 * ejecutan aquí (lo hace story.ts), así que no se aplican dos veces.
 */
export function legacyRules(story: Story): WorldRule[] {
  const out: WorldRule[] = [];
  for (const q of story.quests) {
    if (q.on_accept?.length) out.push({ id: `${q.id}:on_accept`, when: { on: 'quest', quest_id: q.id, event: 'open' }, then: q.on_accept, legacy: true });
    for (const s of q.steps) if (s.on_done?.length) out.push({ id: `${q.id}/${s.id}:on_done`, when: { on: 'quest', quest_id: q.id, event: 'step', step_id: s.id }, then: s.on_done, legacy: true });
    if (q.on_complete.length) out.push({ id: `${q.id}:on_complete`, when: { on: 'quest', quest_id: q.id, event: 'done' }, then: q.on_complete, legacy: true });
    if (q.deadline?.on_lost?.length) out.push({ id: `${q.id}:on_lost`, when: { on: 'quest', quest_id: q.id, event: 'failed' }, then: q.deadline.on_lost, legacy: true });
  }
  for (const e of story.escalation) out.push({ id: `${e.id}:escalation`, when: { on: 'milestone', id: e.id }, if: { kind: 'not', of: e.unless }, then: e.effects, legacy: true });
  return out;
}

/** Todas las reacciones del mundo: las reglas de los datos y lo de antes traducido. */
export function reactionsTable(world: World): WorldRule[] {
  const story = storyOf(world);
  return [...rulesOf(world), ...(story ? legacyRules(story) : [])];
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const QUEST_EVENTS: readonly QuestEventKind[] = ['open', 'step', 'done', 'failed', 'expired', 'declined'];

/** Errores de las reglas del mundo (ids, referencias, opinión de ±1/5/10). Vacío = válidas. */
export function validateReactions(rules: readonly WorldRule[], has: StoryRefs & { quest: (id: Id) => boolean; escalation: (id: Id) => boolean; tag?: (id: Id) => boolean }, ids: { quests: ReadonlySet<Id>; escalations: ReadonlySet<Id> }): string[] {
  const errs: string[] = [];
  const seen = new Set<Id>();
  for (const r of rules) {
    const w = `regla ${r.id}`;
    if (seen.has(r.id)) errs.push(`${w}: repetida.`);
    seen.add(r.id);
    const t = r.when;
    const npc = (id: Id | undefined) => { if (id && !has.npc(id)) errs.push(`${w}: el NPC ${id} no existe.`); };
    switch (t.on) {
      case 'npc_status': npc(t.npc_id); if (!t.status) errs.push(`${w}: npc_status sin estado.`); break;
      case 'npc_arrives': npc(t.npc_id); if (t.location_id && !has.location(t.location_id)) errs.push(`${w}: la localización ${t.location_id} no existe.`); break;
      case 'quest': if (t.quest_id && !has.quest(t.quest_id)) errs.push(`${w}: la misión ${t.quest_id} no existe.`); if (!QUEST_EVENTS.includes(t.event)) errs.push(`${w}: evento de misión no válido (${t.event}).`); break;
      case 'incident': npc(t.victim_id); break;
      case 'item': if (t.item_id && !has.item(t.item_id)) errs.push(`${w}: el objeto ${t.item_id} no existe.`); npc(t.to_npc); npc(t.from_npc); break;
      case 'spot_state': if (!has.spot(t.spot_id)) errs.push(`${w}: el punto ${t.spot_id} no existe.`); break;
      case 'tag': if (has.tag && !t.tag.includes(':') && !has.tag(t.tag)) errs.push(`${w}: la etiqueta ${t.tag} no está en campaign.tags.`); break;
      case 'opinion': npc(t.npc_id); if (t.at_least === undefined && t.at_most === undefined) errs.push(`${w}: umbral de opinión sin at_least ni at_most.`); break;
      case 'milestone': if (t.id && !has.escalation(t.id)) errs.push(`${w}: el escalón ${t.id} no existe.`); break;
      case 'fact': if (!t.id) errs.push(`${w}: hecho sin id.`); break;
      case 'state': conditionErrors(w, t.cond, has, ids, errs); break;
      case 'rest': case 'day': break;
    }
    if (r.if) conditionErrors(`${w} (if)`, r.if, has, ids, errs);
    if (!r.then.length) errs.push(`${w}: sin efectos.`);
    for (const e of r.then) {
      if (!NEW_KINDS.has(e.kind)) { effectErrors(w, e as StoryEffect, has, errs); continue; }
      const x = e as Exclude<RuleEffect, StoryEffect>;
      switch (x.kind) {
        case 'opinion':
          if (x.npc_id !== 'witnesses') npc(x.npc_id);
          if (![1, 5, 10].includes(Math.abs(x.delta))) errs.push(`${w}: la opinión cambia ±1, ±5 o ±10 (no ${x.delta}).`);
          if (!x.why.trim()) errs.push(`${w}: opinión sin porqué.`);
          break;
        case 'tag': if (has.tag && !x.tag.includes(':') && !has.tag(x.tag)) errs.push(`${w}: la etiqueta ${x.tag} no está en campaign.tags.`); break;
        case 'topic': npc(x.npc_id); if (!x.text.trim()) errs.push(`${w}: tema vacío.`); break;
        case 'comment':
          if ((!x.texts.length && !x.prompt?.trim()) || x.texts.some((s) => !s.trim())) errs.push(`${w}: comentario sin plantillas ni prompt.`);
          for (const id of x.location_ids ?? []) if (!has.location(id)) errs.push(`${w}: la localización ${id} no existe.`);
          for (const id of x.npc_ids ?? []) npc(id);
          break;
        case 'lead': if (!has.quest(x.quest_id)) errs.push(`${w}: la misión ${x.quest_id} no existe.`); break;
        case 'fact': if (!x.id.trim()) errs.push(`${w}: hecho sin id.`); break;
      }
    }
  }
  return errs;
}

