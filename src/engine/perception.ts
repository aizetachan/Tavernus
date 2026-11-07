/**
 * Luz, ruido y percepción (SPEC §9.2). Radios por PJ calculados por el
 * servidor; degradación por bandas, no corte seco.
 */

import { GAME_MINUTE, type GameClock } from '../clock/clock.js';
import type { Character, Id, LightLevel, Location, Npc, PerceptionLevel, Spot } from './model.js';
import { positionOf, type Position } from './movement.js';
import type { World } from './world.js';

export function lightAt(clock: GameClock, loc: Location, nowGameS: number): LightLevel {
  if (loc.indoor && loc.ambience.light !== 'natural') return loc.ambience.light;
  return clock.outdoorLight(nowGameS);
}

function skillFactor(world: World, passivePerception: number): number {
  return 1 + (passivePerception - 10) * world.campaign.perception_rules.skill_step;
}

export function carriesLitLight(world: World, c: Character): boolean {
  return world.itemsCarriedBy(c.id).some((i) => world.itemDef(i.item_id).light_source && i.state['lit'] === true);
}

export function visionRadius(world: World, c: Character, light: LightLevel): number {
  const r = world.campaign.perception_rules;
  const skill = skillFactor(world, c.passive_perception);
  let radius = r.vision_base_m * r.light_factor[light] * skill;
  if (light !== 'day' && carriesLitLight(world, c)) {
    radius = Math.max(radius, (r.vision_base_m * r.light_factor.torch + r.torch_fixed_m) * skill);
  }
  if (c.darkvision && light !== 'day') radius = Math.max(radius, r.darkvision_m);
  if (c.status === 'asleep') radius *= r.asleep_factor;
  return radius;
}

/** `noise` 0–1: 0 silencio, 1 ruido que lo tapa todo. */
export function hearingRadius(world: World, c: Character, noise: number): number {
  const r = world.campaign.perception_rules;
  let radius = r.hearing_base_m * (1 - Math.min(1, Math.max(0, noise))) * skillFactor(world, c.passive_perception);
  if (c.status === 'asleep') radius *= r.asleep_factor;
  return radius;
}

export function bandFor(distanceM: number, radiusM: number): PerceptionLevel {
  if (radiusM <= 0) return 'none';
  const k = distanceM / radiusM;
  if (k <= 1) return 'full';
  if (k <= 2) return 'vague';
  if (k <= 3) return 'hint';
  return 'none';
}

const RANK: Record<PerceptionLevel, number> = { none: 0, hint: 1, vague: 2, full: 3 };
export function best(a: PerceptionLevel, b: PerceptionLevel): PerceptionLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/** ¿Hay un enlace entre los puntos que bloquee visión o amortigüe sonido? */
function linkBetween(a: Spot, b: Spot): { blocks_sight: boolean; muffles: number } {
  const l = a.links.find((x) => x.to_spot_id === b.id) ?? b.links.find((x) => x.to_spot_id === a.id);
  return { blocks_sight: l?.blocks_sight ?? false, muffles: l?.muffles ?? 0 };
}

export interface Perceived {
  level: PerceptionLevel;
  sight: PerceptionLevel;
  sound: PerceptionLevel;
  distance_m: number | null;
}

/**
 * Cómo percibe `observer` algo que ocurre en `at` (posición del actor).
 * `loudness` 0–1 escala el radio de audición (0.2 susurro, 1 conversación, 5 grito
 * se expresa como hearing_base × loudness; por eso admite > 1).
 */
/**
 * Casas (docs/PLAN-NPC-RELLENO.md): un punto con esta etiqueta es por dentro, con la puerta cerrada. Quien está dentro
 * no se ve ni se oye desde fuera, ni ve lo de fuera; solo quien está en el mismo punto. Es donde duerme el relleno.
 */
export const DWELLING_TAG = 'dwelling';
export function isDwelling(s: Pick<Spot, 'tags'>): boolean { return s.tags.includes(DWELLING_TAG); }

export function perceive(world: World, clock: GameClock, observer: Character, at: Position, nowGameS: number, loudness = 1): Perceived {
  const obsPos = positionOf(world, observer, nowGameS);
  if (obsPos.location_id !== at.location_id) return { level: 'none', sight: 'none', sound: 'none', distance_m: null };
  const loc = world.location(at.location_id);
  const d = Math.hypot(obsPos.x - at.x, obsPos.y - at.y);

  const obsSpot = world.spot(obsPos.spot_id);
  const actSpot = world.spot(at.spot_id);
  if (obsSpot.id !== actSpot.id && (isDwelling(obsSpot) || isDwelling(actSpot))) return { level: 'none', sight: 'none', sound: 'none', distance_m: d };
  const link = obsSpot.id === actSpot.id ? { blocks_sight: false, muffles: 0 } : linkBetween(obsSpot, actSpot);

  // Un punto oculto no descubierto no se ve; sí se oye.
  const hiddenFromMe = actSpot.hidden && !actSpot.discovered_by.includes(observer.id) && obsSpot.id !== actSpot.id;
  const light = lightAt(clock, loc, nowGameS);
  const blocked = link.blocks_sight || hiddenFromMe || (Array.isArray(loc.state['line_of_sight_blocked']) && (loc.state['line_of_sight_blocked'] as Id[]).includes(actSpot.id) && obsSpot.id !== actSpot.id);
  const sight = blocked ? 'none' : bandFor(d, visionRadius(world, observer, light));

  const hearing = hearingRadius(world, observer, loc.ambience.noise) * loudness * (1 - link.muffles);
  const sound = bandFor(d, hearing);

  return { level: best(sight, sound), sight, sound, distance_m: d };
}

/** Todos los PJs que perciben algo en `at`, con su nivel. Excluye a `exclude`. */
export function witnesses(world: World, clock: GameClock, at: Position, nowGameS: number, loudness = 1, exclude?: Id):
  { character: Character; perceived: Perceived }[] {
  const out: { character: Character; perceived: Perceived }[] = [];
  for (const c of world.characters.values()) {
    if (c.id === exclude || c.status === 'dead' || c.status === 'retired') continue;
    const p = perceive(world, clock, c, at, nowGameS, loudness);
    if (p.level !== 'none') out.push({ character: c, perceived: p });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lo que ve un NPC (ley, combate): escondido y línea de visión
// ---------------------------------------------------------------------------

/**
 * ¿Se ve a alguien que está en `to` desde `from` (misma localización)? Sí en el
 * mismo punto; no si un enlace entre ambos tapa la vista, si `to` es un punto
 * oculto o si la localización tiene la vista cortada hacia uno de los dos
 * (`state.line_of_sight_blocked`). El resto de la estancia se ve.
 */
export function sightBetween(world: World, from: Spot, to: Spot): boolean {
  if (from.id === to.id) return true;
  if (from.location_id !== to.location_id) return false;
  if (to.hidden) return false;
  if (linkBetween(from, to).blocks_sight) return false;
  const cut = world.locations.get(to.location_id)?.state['line_of_sight_blocked'];
  return !(Array.isArray(cut) && ((cut as Id[]).includes(to.id) || (cut as Id[]).includes(from.id)));
}

/** Lo que dura ir a escondidas tras un Sigilo que sale bien, si no se mueve de punto (conflict.ts lo reexporta). */
export const SNEAK_S = 10 * GAME_MINUTE;

/**
 * Va a escondidas (`Character.sneak`, lo apunta el motor al sacar bien una
 * tirada de Sigilo): mientras siga en ese punto, sin irse de viaje y dentro
 * de SNEAK_S. Sin `nowG`, no mira el tiempo. null si no.
 */
export function sneakNow(world: World, c: Character, nowG?: number): Character['sneak'] {
  const s = c.sneak;
  if (!s || c.transit) return null;
  if (nowG !== undefined && nowG - s.game_s > SNEAK_S) return null;
  return world.characterSpot(c)?.id === s.spot_id ? s : null;
}

/** El PJ va a escondidas y este NPC no le ha visto: su Sigilo supera (o iguala) la Percepción pasiva del NPC. */
export function sneakingFrom(world: World, c: Character, n: Npc, nowG?: number): boolean {
  const s = sneakNow(world, c, nowG);
  return Boolean(s) && s!.total >= n.passive_perception;
}

/**
 * ¿Ve este NPC al PJ? Vivo y en la misma localización, sin que el PJ vaya a
 * escondidas de él (sneakingFrom, la misma regla que conflict.ts: su Sigilo
 * contra la pasiva del NPC, también en su mismo punto) y con línea de visión
 * entre sus puntos (sightBetween).
 */
export function npcSees(world: World, n: Npc, c: Character, nowG?: number): boolean {
  if (n.status !== 'alive' || c.transit) return false;
  const at = world.characterSpot(c);
  const from = world.spots.get(n.location.id);
  if (!at || !from || from.location_id !== at.location_id) return false;
  if (sneakingFrom(world, c, n, nowG)) return false;
  return sightBetween(world, from, at);
}
