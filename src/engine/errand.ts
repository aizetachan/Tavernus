/**
 * Ir y hacer en una sola frase: «voy a la plaza a por agua», «voy a la
 * curandera a preguntarle si me puede seguir», «me acerco al pozo y saco
 * agua». La frase trae dos partes: a dónde va (un sitio, un punto o alguien)
 * y qué hace al llegar. El motor hace el viaje (goto.ts) y la acción se
 * resuelve allí en el mismo turno (engine.ts, `tryErrand`).
 *
 * Todo sale del mundo: el destino se resuelve como en goto.ts; si la acción
 * nombra algo o a alguien que está en esa localización (el agua del pozo, la
 * curandera), el destino se afina hasta su punto. Si nombra a alguien con
 * quien tratar que no está allí, se viaja igual y la acción queda pendiente.
 *
 * Regla: solo es un recado si la frase empieza por un verbo de ir, tiene un
 * enlace («a por», «a» o «para» + infinitivo, «y», una coma) y lo de antes
 * del enlace resuelve a exactamente un destino. Si la frase entera ya es un
 * destino, no es un recado: es ir (fastpath.ts).
 */

import { normalize } from './aliases.js';
import { resolveDestination, type Destination } from './goto.js';
import type { Character, Id, Npc, Pace } from './model.js';
import type { World } from './world.js';

export interface Errand {
  dest: Destination;
  pace: Pace;
  /** Lo que va a hacer allí, tal como lo escribió («a por agua», «preguntarle si me puede seguir»). */
  action: string;
  /** Alguien con quien la acción quiere tratar y que no está en el destino. */
  absent_npc_id?: Id;
}

const GO = /^(?:ir|voy|vamos|nos vamos|me voy|ve|vete|me acerco|nos acercamos|acercarme|me dirijo|dirigirme|camino|me muevo|cruzo|vuelvo|volver|regreso|regresar|bajo|subo|paso|corro|entro|entrar)\s+/;
const PACE_WORD = /^(corriendo|deprisa|andando|despacio|sigilosamente|con sigilo)\s+/;
/** «Ir a ver a Ilse», «voy con Hugo», «voy donde la curandera»: el destino es alguien. */
const TO_WHO = /^(?:a ver a|a visitar a|a buscar a|con|donde|adonde esta|a donde esta|a casa de)\s+/;
/**
 * Dónde empieza lo que hace al llegar: «a por…», «a»/«para» + infinitivo
 * (con pronombre: «preguntarle»), «y…», una coma. El enlace «a por» se queda
 * en la acción; los demás se quitan.
 */
const JOIN = /\s+(?=a por\s)|\s+(?:a|para)\s+(?=\S+?(?:ar|er|ir)(?:me|te|le|lo|la|nos|os|les|los|las|se)*(?:\s|$))|\s*,\s*(?:y\s+)?|\s+y\s+(?:luego\s+|despues\s+)?/g;

/** Minúsculas y sin acentos, con la misma longitud que el original (para cortar el texto escrito por el jugador). */
function fold(text: string): string {
  return text.normalize('NFC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Raíz sin género ni número: «curandero» y «curandera» casan. */
function stem(w: string): string {
  return w.length > 4 ? w.replace(/(?:as|os|es|a|o|e)$/, '') : w;
}

function words(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

/** ¿Nombra el texto a este NPC? Por su nombre (o el primero) o por su oficio entero. */
function namesNpc(n: Npc, text: string, byName: boolean): boolean {
  const ws = words(text);
  if (!ws.length) return false;
  const name = normalize(n.name);
  const first = name.split(' ')[0] ?? '';
  if (byName && name && (` ${ws.join(' ')} `.includes(` ${name} `) || (first.length > 2 && ws.includes(first)))) return true;
  const role = words(n.role).map(stem);
  const st = new Set(ws.map(stem));
  return role.length > 0 && role.every((r) => st.has(r));
}

/** ¿Sabe el PJ de este NPC (lo conoce, o conoce o ve el sitio donde está)? */
function heardOf(world: World, c: Character, n: Npc): boolean {
  if (c.knows.includes(n.id)) return true;
  const locId = world.spot(n.location.id).location_id;
  const here = world.characterSpot(c)?.location_id;
  if (locId === here) return true;
  const d = world.location(locId).discovery[c.id];
  if (d === 'visited' || d === 'heard_of') return true;
  return world.spotsOf(here ?? '').some((s) => world.exitsFrom(s.id).some((e) => world.spot(e.to_spot_id).location_id === locId));
}

/** El NPC al que lleva «ir a <who>»: por nombre si le conoce, por oficio si sabe de él. Uno solo. */
function npcTarget(world: World, c: Character, who: string): Npc | null {
  const q = normalize(who);
  if (!q) return null;
  const found = [...world.npcs.values()].filter((n) => n.status === 'alive' && n.location.type === 'spot' && heardOf(world, c, n)
    && (c.knows.includes(n.id) && (normalize(n.name) === q || normalize(n.name).split(' ')[0] === q) || namesNpc(n, who, false) && words(who).length <= words(n.role).length + 1));
  return found.length === 1 ? found[0]! : null;
}

function npcDest(world: World, c: Character, who: string): Destination | null {
  const n = npcTarget(world, c, who);
  if (!n) return null;
  const spot = world.spot(n.location.id);
  if (spot.id === world.characterSpot(c)?.id) return null;
  return { spot_id: spot.id, location_id: spot.location_id, via: 'npc', npc_id: n.id };
}

function destinationOf(world: World, c: Character, text: string, pace: Pace, nowGameS: number): Destination | null {
  const who = text.match(TO_WHO);
  if (who) return npcDest(world, c, text.slice(who[0].length));
  return resolveDestination(world, c, text, { spotsHere: true, pace, nowGameS }) ?? npcDest(world, c, text);
}

/**
 * Dentro del destino, el punto de lo que nombra la acción: el NPC con quien
 * trata o el objeto que va a buscar. null si no nombra nada de allí o si
 * nombra cosas en puntos distintos.
 */
function focusOf(world: World, c: Character, locId: Id, action: string): { spot_id: Id; npc_id?: Id } | null {
  const a = ` ${words(action).join(' ')} `;
  const hits = new Map<Id, Id | undefined>();
  for (const s of world.spotsOf(locId)) {
    if (s.hidden && !s.discovered_by.includes(c.id)) continue;
    for (const n of world.npcsAt(s.id)) if (n.status === 'alive' && namesNpc(n, action, c.knows.includes(n.id))) hits.set(s.id, n.id);
    for (const i of world.itemsIn({ type: 'spot', id: s.id })) {
      const def = world.itemDef(i.item_id);
      if ([def.name, ...def.aliases].some((x) => { const n = words(x).join(' '); return n !== '' && a.includes(` ${n} `); }) && !hits.has(s.id)) hits.set(s.id, undefined);
    }
  }
  if (hits.size !== 1) return null;
  const [spot_id, npc_id] = [...hits.entries()][0]!;
  return npc_id ? { spot_id, npc_id } : { spot_id };
}

/** Verbos de trato: solo con ellos un NPC nombrado es alguien a quien se va a ver (y no un tema o una presa). */
const DEALS = /\b(?:habl|pregunt|ped|pid|dec|dig|salud|cont|ver\b|visit|busc|entreg|dar|dale|doy|llev|compr|vend|consult|avis|pag)/;

/** Alguien a quien la acción se dirige («hablar con Hugo», «pedirle a la curandera») que no está en esa localización. */
function absentOf(world: World, c: Character, locId: Id, action: string): Id | undefined {
  const t = fold(action);
  if (!DEALS.test(t)) return undefined;
  const objects = [...t.matchAll(/\b(?:con|a|al)\s+(?=(.+))/g)].map((x) => x[1]!.split(/\s+(?:y|que|si|para|por)\s+/)[0]!);
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive' || !heardOf(world, c, n)) continue;
    if (n.location.type === 'spot' && world.spot(n.location.id).location_id === locId) continue;
    if (objects.some((o) => namesNpc(n, o, c.knows.includes(n.id)))) return n.id;
  }
  return undefined;
}

/** Reconoce «ir a X y hacer Y». null si la frase no es un recado (va por el camino de siempre). */
export function parseErrand(world: World, c: Character, text: string, nowGameS: number): Errand | null {
  const raw = text.normalize('NFC').trim().replace(/^[¡¿]+/, '').replace(/[.!]+$/, '').trim();
  const t = fold(raw);
  const go = t.match(GO);
  if (!go || !world.characterSpot(c)) return null;
  let start = go[0].length;
  let pace: Pace = 'walk';
  const p = t.slice(start).match(PACE_WORD);
  if (p) {
    pace = p[1] === 'corriendo' || p[1] === 'deprisa' ? 'run' : p[1] === 'sigilosamente' || p[1] === 'con sigilo' ? 'stealth' : 'walk';
    start += p[0].length;
  }
  const body = t.slice(start);
  if (/[?¿"«»()]/.test(body)) return null;
  // La frase entera es un sitio («voy a la casa de Mateo y Tobías»): eso es ir, no un recado.
  if (destinationOf(world, c, body, pace, nowGameS)) return null;
  for (const m of body.matchAll(JOIN)) {
    if (!m.index) continue;
    const destText = body.slice(0, m.index);
    const action = raw.slice(start + m.index + m[0].length).trim();
    if (words(action).filter((w) => w.length > 2).length === 0) continue;
    const d = destinationOf(world, c, destText, pace, nowGameS);
    if (!d) continue;
    let dest = d;
    if (d.via !== 'npc') {
      const f = focusOf(world, c, d.location_id, action);
      if (f && f.spot_id !== world.characterSpot(c)!.id) dest = { spot_id: f.spot_id, location_id: d.location_id, via: f.npc_id ? 'npc' : 'spot', ...(f.npc_id ? { npc_id: f.npc_id } : {}) };
    }
    const absent = dest.via === 'npc' ? undefined : absentOf(world, c, dest.location_id, action);
    return { dest, pace, action, ...(absent ? { absent_npc_id: absent } : {}) };
  }
  return null;
}

/**
 * La acción como la entiende el atajo sin IA: «a por agua», «sacar agua»,
 * «llenar el cubo» → «coger …». Lo demás, tal cual.
 */
export function trivialAction(action: string): string {
  return action.replace(/^(?:a por|a buscar|sacar|saco|llenar|lleno|recoger|recojo|coger|cojo|tomar|tomo)\s+(?:(?:un poco|algo) de\s+)?/i, 'coger ');
}

/** «Lo que ibas a hacer allí (a por agua) queda pendiente.» */
export function pendingLine(action: string): string {
  return `Lo que ibas a hacer («${action}») queda pendiente.`;
}
