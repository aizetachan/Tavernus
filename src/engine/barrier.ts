/**
 * Barreras que rebotan: salidas bloqueadas que no se pueden cruzar pero sí
 * intentar, como el Cerco de Ceniza de Brezal. Una salida con
 * `state.blocked_by` es una pared para las rutas (movement.ts); si además lleva
 * `state.rebound`, quien intenta cruzarla se mete en ella, pierde el tiempo
 * que diga y sale por donde entró. Sin IA: el motor lo resuelve y lo narra
 * con la plantilla de los datos.
 *
 *   state: {
 *     blocked_by: 'El Cerco de Ceniza',
 *     rebound: { hours: 1, text: '…', observable: '… {name} …', aliases: ['niebla', 'cerco'] },
 *   }
 *
 * Se intenta de dos maneras: con texto del jugador («cruzo la niebla», «salgo
 * hacia el camino de Valcruz»), que el motor intercepta antes del máster, o
 * con el tool move_to hacia el otro lado. El PJ tiene que estar en la
 * localización de la barrera; acaba en el punto de su lado y con el reloj
 * adelantado, igual que tras un viaje rápido (travel.ts).
 */

import { GAME_HOUR } from '../clock/clock.js';
import { normalize } from './aliases.js';
import type { Character, Exit, Id } from './model.js';
import { nowFor, setAhead } from './travel.js';
import type { World } from './world.js';

export interface Rebound {
  /** Horas de juego que pierde quien lo intenta. */
  hours: number;
  /** Lo que lee el PJ. */
  text: string;
  /** Lo que ven los demás; `{name}` es el PJ. */
  observable?: string;
  /** Otros nombres con los que el jugador la nombra («niebla», «cerco»). */
  aliases?: string[];
}

export function reboundOf(exit: Exit): Rebound | null {
  const r = exit.state['rebound'] as Partial<Rebound> | undefined;
  if (!exit.state.blocked_by || !r || typeof r !== 'object' || typeof r.text !== 'string') return null;
  return { hours: typeof r.hours === 'number' && r.hours > 0 ? r.hours : 1, text: r.text, ...(r.observable ? { observable: r.observable } : {}), aliases: Array.isArray(r.aliases) ? r.aliases : [] };
}

/** Una barrera vista desde la localización del PJ: la salida, el punto de este lado y el del otro. */
interface Side { exit: Exit; rebound: Rebound; here_spot_id: Id; far_spot_id: Id }

function barriersAround(world: World, c: Character): Side[] {
  const here = world.characterSpot(c);
  if (!here) return [];
  const out: Side[] = [];
  for (const s of world.spotsOf(here.location_id)) {
    for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
      const rebound = reboundOf(exit);
      if (rebound) out.push({ exit, rebound, here_spot_id: s.id, far_spot_id: to_spot_id });
    }
  }
  return out;
}

/** Cruzar, atravesar, meterse en…: intento de pasar aunque el nombre sea también el de un punto de aquí. */
const CROSS = /^(?:intento |intentar |trato de |tratar de )?(?:cruzo|cruzar|cruza|atravieso|atravesar|atraviesa|entro en|entrar en|me meto en|meterme en|me adentro en|adentrarme en|me interno en|internarme en|paso a traves de|pasar a traves de|paso al otro lado de|pasar al otro lado de)\s+(.+)$/;
/** Salir o ir hacia: solo si el nombre es de la barrera o del otro lado y no de un punto de aquí. */
const LEAVE = /^(?:salgo|salir|sal|me voy|irme|me marcho|marcharme|parto|partir|voy|ir|camino|caminar)\s+(?:de|del|hacia|a|al|para|rumbo a|fuera de|fuera del)\s+(.+)$/;

function namesOf(world: World, side: Side): string[] {
  const far = world.spot(side.far_spot_id);
  return [String(side.exit.state.blocked_by), world.location(far.location_id).name, far.name, ...far.aliases, ...(side.rebound.aliases ?? [])];
}

function matches(query: string, names: string[]): boolean {
  const q = normalize(query);
  if (!q) return false;
  const qw = q.split(' ');
  return names.some((raw) => {
    const n = normalize(raw);
    return n !== '' && (n === q || qw.every((w) => n.split(' ').includes(w)));
  });
}

/** ¿El texto es un intento de cruzar una barrera que rebota, desde donde está el PJ? Devuelve la salida. */
export function parseCrossing(world: World, c: Character, text: string): Id | null {
  if (c.transit) return null;
  const t = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[¡]+/, '').replace(/[.!]+$/, '').trim().replace(/\s+/g, ' ');
  if (!t || /[,;:?¿"«»()]/.test(t)) return null;
  const sides = barriersAround(world, c);
  if (!sides.length) return null;
  const cross = t.match(CROSS);
  const leave = cross ? null : t.match(LEAVE);
  const target = (cross ?? leave)?.[1];
  if (!target) return null;
  const hit = sides.filter((s) => matches(target, namesOf(world, s)));
  if (hit.length !== 1) return null;
  if (leave) {
    const here = world.characterSpot(c)!;
    const local = world.spotsOf(here.location_id).some((s) => matches(target, [s.name, ...s.aliases]));
    if (local) return null; // «voy a la niebla» es acercarse a ella, no meterse
  }
  return hit[0]!.exit.id;
}

/** La barrera que separa al PJ de ese punto (el destino está al otro lado de una que rebota), o null. */
export function barrierToward(world: World, c: Character, spotId: Id): Id | null {
  const target = world.spots.get(spotId);
  if (!target) return null;
  const side = barriersAround(world, c).find((s) => world.spot(s.far_spot_id).location_id === target.location_id);
  return side?.exit.id ?? null;
}

export interface Bounce { text: string; observable: string | null; spot_id: Id; lost_s: number }

/**
 * El PJ se mete en la barrera y sale por donde entró: queda en el punto de su
 * lado, con el reloj `hours` por delante del mundo. null si no está en la
 * localización de la barrera o va de camino.
 */
export function bounceOff(world: World, c: Character, exitId: Id, worldNowS: number): Bounce | null {
  if (c.transit || c.location.type !== 'spot') return null;
  const side = barriersAround(world, c).find((s) => s.exit.id === exitId);
  if (!side) return null;
  const lost = Math.round(side.rebound.hours * GAME_HOUR);
  c.location = { type: 'spot', id: side.here_spot_id };
  setAhead(c, nowFor(c, worldNowS) + lost, worldNowS);
  world.touch('characters', c.id);
  const obs = side.rebound.observable?.replaceAll('{name}', c.name) ?? null;
  return { text: side.rebound.text.replaceAll('{name}', c.name), observable: obs, spot_id: side.here_spot_id, lost_s: lost };
}
