/**
 * Ganchos del master: cosas que el master deja sembradas para más tarde
 * («a las 21:00 entra el recaudador», «si alguien se acerca a la puerta…»).
 * El motor vigila el disparador sin gastar nada y, cuando salta, llama al
 * master con el gancho delante. Así el mundo tiene vida propia aunque las
 * acciones triviales no pasen por la IA.
 *
 * Se guardan en la campaña como propiedad opcional (`campaign.hooks`), sin
 * tocar el modelo: viajan con el snapshot y se persisten al tocar la campaña.
 */

import type { Id } from './model.js';
import type { World } from './world.js';

export type HookTrigger =
  /** A una hora de juego, a quien esté en la localización. */
  | { kind: 'time'; at_game_s: number }
  /** Alguien se dirige a ese punto o llega a él. */
  | { kind: 'spot'; spot_id: Id }
  /** Alguien llega a la localización. */
  | { kind: 'location' }
  /** Alguien coge un objeto de ese tipo en la localización. */
  | { kind: 'item'; item_id: Id };

export interface Hook {
  id: Id;
  location_id: Id;
  trigger: HookTrigger;
  /** Qué ocurre, en palabras del master. Solo lo lee el master. */
  what: string;
  /** Solo salta con este PJ; null = con cualquiera. */
  for_character_id: Id | null;
  created_game_s: number;
  expires_game_s: number | null;
}

export interface PlantInput {
  location_id: Id;
  trigger: 'time' | 'spot' | 'location' | 'item';
  /** Solo `time`: minutos de juego desde ahora. */
  minutes_from_now?: number | null;
  spot_id?: Id | null;
  item_id?: Id | null;
  what: string;
  for_character_id?: Id | null;
  /** Caduca a los N minutos de juego; null = 1 día (o 1 h después de la hora, si es `time`). */
  expires_in_minutes?: number | null;
}

/** Un disparo posible, visto desde el motor. */
export type HookCue =
  | { kind: 'time'; now_game_s: number }
  | { kind: 'spot'; spot_id: Id; character_id: Id }
  | { kind: 'location'; location_id: Id; character_id: Id }
  | { kind: 'item'; item_id: Id; location_id: Id; character_id: Id };

export const MAX_HOOKS_PER_LOCATION = 12;
const DAY_S = 24 * 3600;

function store(world: World): Hook[] {
  const camp = world.campaign as typeof world.campaign & { hooks?: Hook[] };
  camp.hooks ??= [];
  return camp.hooks;
}

export function allHooks(world: World): readonly Hook[] { return store(world); }

export function pendingHooksIn(world: World, locationId: Id): Hook[] {
  return store(world).filter((h) => h.location_id === locationId);
}

export function plantHook(world: World, input: PlantInput, nowGameS: number): { ok: true; hook: Hook } | { ok: false; error: string } {
  const what = (input.what ?? '').trim();
  if (!what) return { ok: false, error: 'what vacío: di qué ocurre' };
  if (what.length > 600) return { ok: false, error: 'what demasiado largo (máx. 600 caracteres)' };
  if (!world.locations.has(input.location_id)) return { ok: false, error: `no existe la localización ${input.location_id}` };
  if (input.for_character_id && !world.characters.has(input.for_character_id)) return { ok: false, error: `no existe el personaje ${input.for_character_id}` };
  if (pendingHooksIn(world, input.location_id).length >= MAX_HOOKS_PER_LOCATION) return { ok: false, error: 'demasiados ganchos en esta localización; cancela alguno' };

  let trigger: HookTrigger;
  switch (input.trigger) {
    case 'time': {
      const m = Number(input.minutes_from_now);
      if (!Number.isFinite(m) || m <= 0 || m > 7 * 24 * 60) return { ok: false, error: 'minutes_from_now debe estar entre 1 y 10080' };
      trigger = { kind: 'time', at_game_s: nowGameS + Math.round(m * 60) };
      break;
    }
    case 'spot': {
      const s = input.spot_id ? world.spots.get(input.spot_id) : undefined;
      if (!s) return { ok: false, error: `no existe el punto ${input.spot_id}` };
      if (s.location_id !== input.location_id) return { ok: false, error: `${s.id} no está en ${input.location_id}` };
      trigger = { kind: 'spot', spot_id: s.id };
      break;
    }
    case 'location': trigger = { kind: 'location' }; break;
    case 'item': {
      if (!input.item_id || !world.itemDefs.has(input.item_id)) return { ok: false, error: `no existe el objeto ${input.item_id}` };
      trigger = { kind: 'item', item_id: input.item_id };
      break;
    }
    default: return { ok: false, error: `trigger desconocido: ${String(input.trigger)}` };
  }

  const exp = input.expires_in_minutes;
  const expires = exp != null && Number.isFinite(Number(exp)) && Number(exp) > 0
    ? nowGameS + Math.round(Number(exp) * 60)
    : trigger.kind === 'time' ? trigger.at_game_s + 3600 : nowGameS + DAY_S;
  const hook: Hook = {
    id: `hk_${Math.round(nowGameS).toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    location_id: input.location_id, trigger, what,
    for_character_id: input.for_character_id ?? null,
    created_game_s: nowGameS, expires_game_s: expires,
  };
  store(world).push(hook);
  world.touch('campaign', world.campaign.id);
  return { ok: true, hook };
}

/**
 * Lo que pasa en la escena por la historia escrita (story.ts, efecto `tell`): un gancho de hora ya vencida
 * para ese PJ, que salta en el mismo tick y lo cuenta el máster con su voz, en vez de narrarlo el motor.
 */
export function plantBeat(world: World, locationId: Id, characterId: Id, what: string, nowGameS: number): Hook {
  const hook: Hook = {
    id: `hk_beat_${Math.round(nowGameS).toString(36)}_${characterId}_${Math.random().toString(36).slice(2, 6)}`,
    location_id: locationId, trigger: { kind: 'time', at_game_s: nowGameS }, what: what.slice(0, 600),
    for_character_id: characterId, created_game_s: nowGameS, expires_game_s: nowGameS + 3600,
  };
  store(world).push(hook);
  world.touch('campaign', world.campaign.id);
  return hook;
}

export function cancelHook(world: World, hookId: Id): boolean {
  const hooks = store(world);
  const i = hooks.findIndex((h) => h.id === hookId);
  if (i < 0) return false;
  hooks.splice(i, 1);
  world.touch('campaign', world.campaign.id);
  return true;
}

/** Quita los caducados. Devuelve cuántos. */
export function pruneHooks(world: World, nowGameS: number): number {
  const hooks = store(world);
  const before = hooks.length;
  const kept = hooks.filter((h) => h.expires_game_s === null || h.expires_game_s > nowGameS);
  if (kept.length === before) return 0;
  hooks.splice(0, hooks.length, ...kept);
  world.touch('campaign', world.campaign.id);
  return before - kept.length;
}

/** Ganchos que salta este disparo (sin consumirlos). */
export function matchHooks(world: World, cue: HookCue): Hook[] {
  return store(world).filter((h) => {
    if (cue.kind !== 'time' && h.for_character_id && h.for_character_id !== cue.character_id) return false;
    switch (cue.kind) {
      case 'time': return h.trigger.kind === 'time' && h.trigger.at_game_s <= cue.now_game_s;
      case 'spot': return h.trigger.kind === 'spot' && h.trigger.spot_id === cue.spot_id;
      case 'location': return h.trigger.kind === 'location' && h.location_id === cue.location_id;
      case 'item': return h.trigger.kind === 'item' && h.trigger.item_id === cue.item_id && h.location_id === cue.location_id;
    }
  });
}

/** Un gancho salta una sola vez. */
export function consumeHooks(world: World, ids: Id[]): void {
  if (!ids.length) return;
  const hooks = store(world);
  const kept = hooks.filter((h) => !ids.includes(h.id));
  if (kept.length === hooks.length) return;
  hooks.splice(0, hooks.length, ...kept);
  world.touch('campaign', world.campaign.id);
}

/** Línea legible para el contexto del master. */
export function describeHook(world: World, h: Hook, fmtGameTime: (s: number) => string): string {
  const t = h.trigger;
  const when = t.kind === 'time' ? `a las ${fmtGameTime(t.at_game_s)}`
    : t.kind === 'spot' ? `cuando alguien vaya a ${world.spots.get(t.spot_id)?.name ?? t.spot_id}`
    : t.kind === 'location' ? `cuando alguien llegue a ${world.locations.get(h.location_id)?.name ?? h.location_id}`
    : `cuando alguien coja ${world.itemDefs.get(t.item_id)?.name ?? t.item_id}`;
  const who = h.for_character_id ? ` (solo con ${world.characters.get(h.for_character_id)?.name ?? h.for_character_id})` : '';
  return `${when}${who}: ${h.what} [${h.id}]`;
}
