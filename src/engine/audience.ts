/**
 * Quién lee qué en la sala (docs/MULTIJUGADOR.md, «Quién lee qué»). Marcas
 * explícitas del máster, validadas contra el estado; nada de adivinar por el texto.
 *
 *   - Cada línea de NPC lleva `to` (moments.ts): un PJ, varios o `all`.
 *   - El cierre lleva `audience`:
 *       actor    lo privado del actor; los demás de la sala, un aviso de una línea (`observable`).
 *       group    la charla con un NPC: la leen entera los que están en ella (`talking_to`) y a quien le
 *                habla el NPC; el resto de la sala, el aviso.
 *       present  algo que afecta a todos los presentes: la misma narración para todos, que corta las
 *                charlas sueltas de la sala (el NPC que habla a todos pasa a atender al grupo).
 *
 * `settleAudience` lo fija al cerrar el turno (engine.ts); `viewOf` dice cómo lo lee
 * cada PJ (events.ts, notices.ts y la web).
 */

import type { DialogueLine, LineTo } from './moments.js';
import type { Character, GameEvent, Id, Npc } from './model.js';
import type { World } from './world.js';

export type Audience = 'actor' | 'group' | 'present';
export const AUDIENCES: readonly Audience[] = ['actor', 'group', 'present'];

/** Cómo lee un PJ un evento: suyo, el mismo turno que todos, como parte de la charla, o solo el aviso. */
export type View = 'own' | 'shared' | 'party' | 'notice';

/** PJ en la localización que se enteran de lo que pasa en ella (no de viaje, ni muertos ni retirados). */
export function presentIds(world: World, locationId: Id): Id[] {
  return world.charactersInLocation(locationId).filter((c) => c.status !== 'dead' && c.status !== 'retired' && !c.transit).map((c) => c.id);
}

/** A quién va `to`, en ids (`all` son todos los presentes). */
export function lineTargets(to: LineTo | undefined, present: readonly Id[]): Id[] {
  if (!to) return [];
  if (to === 'all') return [...present];
  return Array.isArray(to) ? [...to] : [to];
}

export interface AudienceInput {
  /** Lo que declara el máster en log_event; sin declarar, `actor`. */
  audience?: string | null;
  lines?: DialogueLine[];
  /** NPC con quien ha hablado el actor (cierre). */
  npc_id?: Id | null;
  observable: string | null;
  /** Otro PJ al que se dirige el actor (party.ts). */
  target_character_id?: Id | null;
}

export interface Settled {
  audience: Audience;
  /** PJ, sin el actor, que leen el turno entero (`present`: la narración; `group`: la charla). */
  audience_ids: Id[];
  lines: DialogueLine[];
  observable: string | null;
  /** NPC cuya charla suelta se ha cortado (`present`). */
  interrupted: Id[];
}

/**
 * Fija quién lee el turno y deja `talking_to` como queda: el NPC que habla a otro
 * PJ lo suma a su charla; `present` corta las charlas sueltas de la sala. Valida
 * `to` (solo PJ presentes; `all` solo con dos o más) y, si el actor habla con un
 * NPC y el máster no dejó aviso, pone el de siempre («Isgral habla con Hugo»).
 */
export function settleAudience(world: World, actor: Character, input: AudienceInput, nowGameS: number): Settled {
  const locId = world.characterSpot(actor)?.location_id ?? null;
  const present = locId ? presentIds(world, locId) : [actor.id];
  if (!present.includes(actor.id)) present.unshift(actor.id);
  const many = present.length >= 2;
  const isPresent = (id: Id) => present.includes(id);

  // `to` válido: solo PJ presentes; `all` con uno solo es el actor.
  const lines = (input.lines ?? []).map((l): DialogueLine => {
    if (l.speaker !== 'npc') { const { to: _drop, ...rest } = l; return rest; }
    const { to, ...rest } = l;
    if (!to) return rest;
    if (to === 'all') return { ...rest, to: many ? 'all' : actor.id };
    const ids = [...new Set(Array.isArray(to) ? to : [to])].filter(isPresent);
    if (!ids.length) return rest;
    return { ...rest, to: ids.length === 1 ? ids[0]! : ids };
  });

  let audience: Audience = AUDIENCES.includes(input.audience as Audience) ? input.audience as Audience : 'actor';
  // Un NPC que habla a todos lo oyen todos.
  if (lines.some((l) => l.to === 'all')) audience = 'present';
  if (audience === 'present' && !many) audience = 'actor';

  // Las charlas: el NPC que se dirige a otro PJ lo suma a la suya.
  const speakers = new Set<Id>();
  if (input.npc_id) speakers.add(input.npc_id);
  for (const l of lines) if (l.speaker === 'npc' && l.npc_id) speakers.add(l.npc_id);
  const talkers = new Set<Id>();
  for (const npcId of speakers) {
    const n = world.npcs.get(npcId);
    if (!n || n.status !== 'alive' || (locId && world.spot(n.location.id).location_id !== locId)) continue;
    const addressed = [...new Set(lines.filter((l) => l.speaker === 'npc' && l.npc_id === npcId).flatMap((l) => lineTargets(l.to, present)))];
    const t = n.talking_to;
    if (addressed.some((id) => id !== actor.id && id !== t?.character_id && !t?.with?.includes(id))) {
      const main = t?.character_id && isPresent(t.character_id) ? t.character_id : actor.id;
      const withIds = [...new Set([...(t?.with ?? []), ...addressed, actor.id])].filter((id) => id !== main && isPresent(id));
      const next: NonNullable<Npc['talking_to']> = { ...(t ?? { started_game_s: nowGameS }), character_id: main, since_game_s: nowGameS };
      delete next.reserved;
      if (withIds.length) next.with = withIds; else delete next.with;
      n.talking_to = next;
      world.touch('npcs', n.id);
    }
    const now = n.talking_to;
    if (now) for (const id of [now.character_id, ...(now.with ?? [])]) if (isPresent(id)) talkers.add(id);
  }

  // Algo para todos corta las charlas sueltas de la sala: el NPC que no habla en este turno deja de atender a quien atendía.
  const interrupted: Id[] = [];
  if (audience === 'present' && locId) {
    for (const n of world.npcs.values()) {
      if (!n.talking_to || speakers.has(n.id) || world.spot(n.location.id).location_id !== locId) continue;
      n.talking_to = null;
      world.touch('npcs', n.id);
      interrupted.push(n.id);
    }
  }

  const addressees = lines.filter((l) => l.speaker === 'npc').flatMap((l) => lineTargets(l.to, present));
  const target = input.target_character_id && isPresent(input.target_character_id) ? [input.target_character_id] : [];
  const audienceIds = audience === 'present'
    ? present.filter((id) => id !== actor.id)
    : [...new Set([...talkers, ...addressees, ...target])].filter((id) => id !== actor.id);
  if (audience !== 'present') audience = audienceIds.length ? 'group' : 'actor';

  // Hablar con un NPC delante de otros deja siempre su aviso, aunque el máster no lo escriba.
  let observable = input.observable;
  if (!observable && audience !== 'present' && many && input.npc_id && world.npcs.has(input.npc_id)) {
    observable = `${actor.name} habla con ${world.npc(input.npc_id).name}.`;
  }
  return { audience, audience_ids: audienceIds, lines, observable, interrupted };
}

/**
 * Cómo lee `readerId` un evento. null en lo que no lleva `audience` (lo que no
 * cierra el máster, o eventos de antes): sigue sus reglas de siempre.
 */
export function viewOf(e: Pick<GameEvent, 'actor_id' | 'payload'>, readerId: Id | null): View | null {
  if (readerId !== null && readerId === e.actor_id) return 'own';
  const p = e.payload;
  const group = p['group'];
  if (readerId !== null && Array.isArray(group) && group.includes(readerId)) return 'shared';
  const audience = p['audience'];
  if (typeof audience !== 'string') return null;
  const ids = Array.isArray(p['audience_ids']) ? p['audience_ids'] as Id[] : [];
  if (readerId !== null && ids.includes(readerId)) return audience === 'present' ? 'shared' : 'party';
  if (readerId !== null && p['target_character_id'] === readerId) return 'party';
  return 'notice';
}

