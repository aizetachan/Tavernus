/**
 * Varios jugadores en el mismo sitio a la vez (docs/MULTIJUGADOR.md, «Varios a la
 * vez en el mismo sitio»). Funciones puras sobre el mundo y el log; el motor
 * (engine.ts) lleva las colas, los lotes y los temporizadores.
 *
 *   - Con quién habla un NPC: `npc.talking_to` (lo fija el cierre del máster) si
 *     sigue vivo: el que habla está en la sala, quieto, su conversación
 *     (conversation.ts) sigue con ese NPC y no lleva más de TALK_IDLE_S callado.
 *     Los que se han unido van en `talking_to.with`.
 *   - A quién va una acción: el NPC que nombra (por nombre si lo conoce, por su
 *     oficio o su descriptor) o, si no nombra a nadie, con quien ya habla.
 *   - Escena tensa: dos o más PJ presentes y combate reciente, una ventana
 *     decisiva abierta o la marca `tense` de la localización
 *     (la pone la historia, p. ej. la noche de la Brasa).
 */

import { normalize } from './aliases.js';
import { conversationOf } from './conversation.js';
import type { Character, GameEvent, Id, Npc } from './model.js';
import { positionOf } from './movement.js';
import { descriptorOf } from './narrate.js';
import type { World } from './world.js';

/** Un NPC que lleva esto sin hablar con quien le hablaba (segundos de juego) queda libre. */
export const TALK_IDLE_S = 10 * 60;
/** Ventana para agrupar frases de una conversación de grupo (ms reales). */
export const GROUP_WINDOW_MS = 8_000;
/** Tiempo de una ronda en escena tensa (ms reales). */
export const ROUND_MS = 60_000;

/** Quién habla ahora con un NPC: el que lleva la conversación y los que se han unido. Vacío si está libre. */
export function talkersOf(world: World, events: readonly GameEvent[], npc: Npc, nowGameS: number): Id[] {
  const t = npc.talking_to;
  if (!t || nowGameS - t.since_game_s > TALK_IDLE_S) return [];
  const loc = world.spot(npc.location.id).location_id;
  const here = (id: Id) => {
    const c = world.characters.get(id);
    return c && c.status === 'active' && !c.transit && world.characterSpot(c)?.location_id === loc ? c : null;
  };
  const main = here(t.character_id);
  // El que lleva la charla sigue en ella si su conversación es con este NPC (o si aún no ha hablado: turno reservado).
  const mainOk = main && (t.reserved || conversationOf(events, main.id, positionOf(world, main, nowGameS))?.npc_id === npc.id);
  const joined = (t.with ?? []).filter((id) => here(id));
  return [...(mainOk ? [main.id] : []), ...joined];
}

/** Nombres con que el PJ puede referirse a un NPC: su nombre si lo conoce, su oficio y su descriptor. */
function npcNames(c: Character, n: Npc, world: World): string[] {
  return [...(c.knows.includes(n.id) ? [n.name] : []), n.role, descriptorOf(world, n.id)].map((x) => normalize(x)).filter((x) => x.length > 2);
}

/** NPC vivos de la localización del PJ. */
export function npcsHere(world: World, c: Character): Npc[] {
  const loc = world.characterSpot(c)?.location_id;
  return [...world.npcs.values()].filter((n) => n.status === 'alive' && world.spot(n.location.id).location_id === loc);
}

/** El NPC de la sala que nombra el texto, si es uno solo. */
export function namedNpc(world: World, c: Character, text: string): Npc | null {
  const t = ` ${normalize(text)} `;
  const hits = npcsHere(world, c).filter((n) => npcNames(c, n, world).some((name) => t.includes(` ${name} `)));
  // El nombre propio también cuenta aunque no lo conozca (lo habrá oído): si lo escribe, sabe a quién se refiere.
  const byName = hits.length ? hits : npcsHere(world, c).filter((n) => t.includes(` ${normalize(n.name)} `));
  return byName.length === 1 ? byName[0]! : null;
}

/**
 * Otro PJ de la localización al que nombra el texto por su nombre («oye
 * Leodhin…», «pedir a MIAU que…»), si es uno solo. Lo que va a otro jugador no
 * es para el NPC con quien se habla.
 */
export function namedPc(world: World, c: Character, text: string): Character | null {
  const t = ` ${normalize(text)} `;
  const loc = world.characterSpot(c)?.location_id;
  const hits = [...world.characters.values()].filter((o) => o.id !== c.id && o.status !== 'dead' && o.status !== 'retired'
    && world.characterSpot(o)?.location_id === loc && normalize(o.name).length > 1 && t.includes(` ${normalize(o.name)} `));
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * A qué NPC va la acción: el que nombra o, sin nombrar a nadie, aquel con quien
 * ya habla el PJ. Si nombra a otro jugador y a ningún NPC, no va a ningún NPC.
 */
export function npcTarget(world: World, events: readonly GameEvent[], c: Character, text: string, nowGameS: number): Npc | null {
  const named = namedNpc(world, c, text);
  if (named) return named;
  return namedPc(world, c, text) ? null : talkingWith(world, events, c, nowGameS);
}

/** El NPC con el que habla el PJ ahora (como el que lleva la charla o unido a ella). */
export function talkingWith(world: World, events: readonly GameEvent[], c: Character, nowGameS: number): Npc | null {
  return [...world.npcs.values()].find((n) => talkersOf(world, events, n, nowGameS).includes(c.id)) ?? null;
}

/** PJ que cuentan para una ronda: activos, conectados y quietos en la localización. */
export function presentPcs(world: World, locationId: Id): Character[] {
  return world.charactersInLocation(locationId).filter((c) => c.status === 'active' && c.connected && !c.transit);
}

/**
 * ¿Escena tensa con varios jugadores? Motivo o null. `recentTags`: etiquetas de
 * los eventos de los últimos minutos en la localización.
 */
export function tenseScene(world: World, locationId: Id, recentTags: readonly string[]): string | null {
  const pcs = presentPcs(world, locationId);
  // El ausente cuenta (duda) hasta que el motor lo saca de la ronda (Engine.roundMembers).
  if (pcs.length < 2) return null;
  const loc = world.location(locationId);
  if (loc.state['tense'] === true) return typeof loc.state['tense_reason'] === 'string' ? loc.state['tense_reason'] : 'la historia';
  if (pcs.some((c) => c.decisive)) return 'ventana decisiva';
  if (recentTags.some((t) => t === 'combat')) return 'combate';
  return null;
}

/** «dejar la conversación», «me despido», «dejo de hablar con…». */
export function isLeaveTalk(text: string): boolean {
  return /^(?:dejar la conversaci[oó]n|dejo la conversaci[oó]n|salir de la conversaci[oó]n|me despido|despedirme|dejar de hablar|dejo de hablar)\b/i.test(text.trim());
}

/** «Esperar turno con Hugo» y «Unirme a la conversación (con Hugo)»: los botones del NPC ocupado. */
export function parseTurn(text: string): { kind: 'wait' | 'join'; who: string; loose: boolean } | null {
  const t = text.trim().replace(/[.!]+$/, '');
  let m = /^(?:esperar|espero)\s+(?:mi\s+)?turno(?:\s+(?:con|de|para)\s+(.+))?$/i.exec(t);
  if (m) return { kind: 'wait', who: m[1] ?? '', loose: false };
  m = /^(?:unirme|me uno|unirse)\s+a\s+la\s+conversaci[oó]n(?:\s+(?:con|de)\s+(.+))?$/i.exec(t);
  if (m) return { kind: 'join', who: m[1] ?? '', loose: false };
  // Dicho a su manera («Esperar a que la tabernera termine con el elfo», «Unirme a ellos»): el motor
  // solo lo toma por el botón si hay un NPC ocupado con otro (si no, es un «esperar» de siempre).
  m = /^(?:esperar|espero|aguardar|aguardo)\b(.*)$/i.exec(t);
  if (m) return { kind: 'wait', who: m[1]!.trim(), loose: true };
  m = /^(?:unirme|me uno|unirse|sumarme|me sumo)\b(.*)$/i.exec(t);
  if (m) return { kind: 'join', who: m[1]!.trim(), loose: true };
  return null;
}
