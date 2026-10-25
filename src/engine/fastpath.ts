/**
 * Acciones triviales sin IA. El motor ya es determinista en lo mecánico
 * (posición, tiempo, inventario); lo que el master aporta en un paso trivial
 * es la prosa y la ocasión de que el mundo reaccione. Aquí se reconoce lo
 * trivial y se decide si la escena está tranquila; la ocasión de que pase
 * algo la cubren la tirada de encuentro y los ganchos (hooks.ts).
 *
 * Regla: solo se intercepta una frase que sea entera «verbo + nombre» y cuyo
 * nombre resuelva a exactamente una cosa visible. Todo lo demás, al master.
 */

import type { GameClock } from '../clock/clock.js';
import { normalize } from './aliases.js';
import { attitudeOf } from './combat.js';
import type { Character, Id, Location, Pace } from './model.js';
import { enterDestination, exitDestination, nameScore, npcDestination, resolveDestination } from './goto.js';
import { positionOf } from './movement.js';
import { aEs, descriptorOf } from './narrate.js';
import { perceive } from './perception.js';
import type { World } from './world.js';

export type TrivialIntent =
  | { kind: 'move'; spot_id: Id; pace: Pace; exit: boolean }
  | { kind: 'take'; instance_id: Id }
  | { kind: 'drop'; instance_id: Id }
  | { kind: 'wait' };

/**
 * Habla, ataque, trato con NPC o encadenar otra cosa: nunca es trivial. Es un
 * cinturón: el nombre ya tiene que casar con todas sus palabras, así que
 * «voy a la barra a pedir» no resolvería de todas formas.
 */
const NOT_TRIVIAL = /\b(y|e|luego|despues|mientras|pero|para|hablar|hablo|decir|digo|preguntar|pregunto|gritar|grito|saludar|saludo|pedir|pido|comprar|compro|vender|vendo|atacar|ataco|golpear|golpeo|matar|mato|disparar|disparo|amenazar|amenazo|robar|robo|esconder|escondo|abrir|abro|forzar|fuerzo|buscar|busco|mirar|miro|examinar|examino)\b/;

const MOVE = /^(?:ir|voy|vamos|ve|vete|me acerco|acercarme|me dirijo|dirigirme|camino|caminar|me muevo|moverme|cruzo|cruzar|entrar|entro|entra|entramos|volver|vuelvo|vuelve|volvemos|regresar|regreso|regresa)\s+(.+)$/;
const BARE_ENTER = /^(?:entrar|entro|entra|entramos|pasar dentro|paso dentro|entrar dentro|entro dentro)$/;
const BARE_EXIT = /^(?:salir|salgo|sal|salimos|salir fuera|salgo fuera|salir de aqui|salgo de aqui)$/;
const LEAVE = /^(?:salir|salgo|sal|salimos)\s+de(?:l)?\s+(.+)$/;
/** «Ir a ver a Hugo», «voy donde Hugo», «ir con Hugo», «ir a buscar a Hugo». */
const TO_NPC = /^(?:ir|voy|vamos|me voy|ve|vete)\s+(?:a ver a|a visitar a|a buscar a|con|donde|adonde esta|a donde esta|a casa de)\s+(.+)$/;
const EXIT = /^(?:salir|salgo|sal|me voy|marcharme|me marcho|parto|partir)\s+(?:hacia|a|al|para|rumbo a)\s+(.+)$/;
const TAKE = /^(?:coger|cojo|coge|recoger|recojo|recoge|tomar|tomo|agarrar|agarro|pillo|pillar)\s+(.+)$/;
const DROP = /^(?:soltar|suelto|suelta|dejar|dejo|deja)\s+(.+)$/;
const WAIT = /^(?:esperar|espero|espera|aguardar|aguardo|me quedo esperando)(?:\s+(?:un rato|un momento|un poco|aqui))?$/;
const PACE = /\s+(corriendo|andando|despacio|sigilosamente|con sigilo)$/;

/** Minúsculas, sin acentos ni puntuación de cierre. Devuelve null si hay signos que delatan algo más que «verbo + nombre». */
function clean(text: string): string | null {
  const t = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[¡]+/, '').replace(/[.!]+$/, '').trim();
  if (!t || /[,;:?¿"«»()]/.test(t)) return null;
  return t.replace(/\s+/g, ' ');
}

interface Named { id: Id; names: string[] }

/** 2 = nombre exacto (o alias); 1 = todas las palabras del texto están en el nombre; 0 = no. */
function matchScore(query: string, names: string[]): number {
  const q = normalize(query);
  if (!q) return 0;
  const qw = q.split(' ');
  let best = 0;
  for (const raw of names) {
    const n = normalize(raw);
    if (!n) continue;
    if (n === q) return 2;
    const nw = n.split(' ');
    if (qw.every((w) => nw.includes(w))) best = 1;
  }
  return best;
}

/** «Salir de la taberna» estando en la taberna: salir a secas. */
function leavesHere(world: World, c: Character, body: string): boolean {
  const m = body.match(LEAVE);
  const here = world.characterSpot(c);
  return Boolean(m && here && nameScore(m[1]!, [world.location(here.location_id).name, 'aqui']) > 0);
}

/** Exactamente una cosa con la mejor puntuación; si no, null. */
function single(query: string, cands: Named[]): Id | null {
  let best = 0;
  let ids = new Set<Id>();
  for (const c of cands) {
    const s = matchScore(query, c.names);
    if (s === 0 || s < best) continue;
    if (s > best) { best = s; ids = new Set(); }
    ids.add(c.id);
  }
  return ids.size === 1 ? [...ids][0]! : null;
}

/** ¿El texto nombra a alguien (PJ o NPC)? Entonces es trato con personas: al master. */
function mentionsSomeone(world: World, target: string): boolean {
  const q = normalize(target);
  if (!q) return false;
  const qw = q.split(' ');
  const names: string[] = [];
  for (const n of world.npcs.values()) names.push(n.name, n.role);
  for (const c of world.characters.values()) names.push(c.name);
  return names.some((raw) => {
    const n = normalize(raw);
    return n !== '' && (n === q || n.split(' ').some((w) => w.length > 2 && qw.includes(w)));
  });
}

/** Reconoce una acción trivial y resuelve su objetivo contra lo que el PJ tiene delante ahora. */
export function parseTrivial(world: World, c: Character, text: string, nowGameS = 0): TrivialIntent | null {
  const t = clean(text);
  if (!t) return null;
  if (WAIT.test(t)) return { kind: 'wait' };

  let m: RegExpMatchArray | null;
  let pace: Pace = 'walk';
  let body = t;
  const p = body.match(PACE);
  if (p) {
    pace = p[1] === 'corriendo' ? 'run' : p[1] === 'sigilosamente' || p[1] === 'con sigilo' ? 'stealth' : 'walk';
    body = body.slice(0, p.index).trim();
  }

  // «Entrar», «salir», «salir de la taberna», «ir a ver a Hugo»: a dónde lleva lo dice el mundo.
  const bare = BARE_ENTER.test(body) ? enterDestination(world, c, nowGameS)
    : BARE_EXIT.test(body) || leavesHere(world, c, body) ? exitDestination(world, c, nowGameS)
    : body.match(TO_NPC) ? npcDestination(world, c, body.match(TO_NPC)![1]!) : null;
  if (bare) return { kind: 'move', spot_id: bare.spot_id, pace, exit: bare.location_id !== world.characterSpot(c)?.location_id };

  const exitM = body.match(EXIT);
  const moveM = exitM ? null : body.match(MOVE);
  const takeM = exitM || moveM ? null : body.match(TAKE);
  const dropM = exitM || moveM || takeM ? null : body.match(DROP);
  m = exitM ?? moveM ?? takeM ?? dropM;
  if (!m) return null;
  const target = m[1]!.trim();
  // «ir a hablar con…», «coger la jarra y beber», «voy a la barra a por…»: nunca.
  if (NOT_TRIVIAL.test(target) || mentionsSomeone(world, target)) return null;

  const here = world.characterSpot(c);
  if (!here) return null;

  if (exitM || moveM) {
    // Ir a un sitio es llegar y entrar (goto.ts): una localización lleva a su punto de entrada.
    const d = resolveDestination(world, c, target, { spotsHere: Boolean(moveM), pace, nowGameS });
    if (!d) return null;
    return { kind: 'move', spot_id: d.spot_id, pace, exit: d.location_id !== here.location_id };
  }

  if (takeM) {
    const floor = world.itemsIn({ type: 'spot', id: here.id });
    const id = singleItem(world, target, floor.map((i) => i.id));
    return id ? { kind: 'take', instance_id: id } : null;
  }

  const carried = world.itemsCarriedBy(c.id);
  const id = singleItem(world, target, carried.map((i) => i.id));
  return id ? { kind: 'drop', instance_id: id } : null;
}

/** Como `single`, pero dos ejemplares del mismo objeto no son ambiguos. */
function singleItem(world: World, target: string, instanceIds: Id[]): Id | null {
  const byDef = new Map<Id, Id>();
  for (const iid of instanceIds) {
    const inst = world.itemInstance(iid);
    if (!byDef.has(inst.item_id)) byDef.set(inst.item_id, iid);
  }
  const defId = single(target, [...byDef.keys()].map((d) => {
    const def = world.itemDef(d);
    return { id: d, names: [def.name, ...def.aliases] };
  }));
  return defId ? byDef.get(defId)! : null;
}

// ---------------------------------------------------------------------------
// ¿Está tranquila la escena?
// ---------------------------------------------------------------------------

/**
 * Motivo por el que la escena NO está tranquila para este PJ en estas
 * localizaciones, o null si lo está. Con cualquier motivo, la acción va al master.
 * `leaving`: el PJ se va a otra localización; alguien que solo recela no lo para.
 */
export function tension(world: World, c: Character, locationIds: Id[], recentTags: string[], opts: { leaving?: boolean } = {}): string | null {
  if (c.status !== 'active') return `estado ${c.status}`;
  if (c.decisive) return 'ventana decisiva abierta';
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive') continue;
    if (n.talking_to?.character_id === c.id) return `conversación con ${n.name}`;
    if (!locationIds.includes(world.spot(n.location.id).location_id)) continue;
    const a = attitudeOf(n, c.id);
    // Quien solo recela (unfriendly) no impide marcharse a otro sitio; quien es hostil, sí.
    if (a === 'hostile' || (a === 'unfriendly' && !opts.leaving)) return `${n.name} ${a}`;
  }
  if (recentTags.some((t) => t === 'combat' || t === 'danger' || t === 'threat')) return 'combate o peligro reciente';
  return null;
}

/**
 * Probabilidad de imprevisto por acción trivial en una localización.
 * `location.state.encounter_chance` (0-1) manda; si no, según el sitio:
 * interior 1/12, poblado 1/10, lo demás (bosque, camino, mazmorra) 1/6.
 */
export function encounterChance(world: World, loc: Location): number {
  const v = loc.state['encounter_chance'];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  if (loc.indoor) return 1 / 12;
  const kind = world.zones.get(loc.zone_id)?.kind ?? '';
  if (/town|village|city|aldea|pueblo|ciudad/.test(kind)) return 1 / 10;
  return 1 / 6;
}

// ---------------------------------------------------------------------------
// Acciones sugeridas desde el estado
// ---------------------------------------------------------------------------

/** 3-4 acciones con el mismo texto canónico que envía el tablero web. */
export function suggestActions(world: World, clock: GameClock, c: Character, nowGameS: number, max = 4): string[] {
  const pos = positionOf(world, c, nowGameS);
  const out: string[] = [];
  // Alguien con quien hablar, por cómo lo ve el PJ.
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive') continue;
    const ns = world.spot(n.location.id);
    if (ns.location_id !== pos.location_id) continue;
    if (attitudeOf(n, c.id) === 'hostile') continue;
    const p = perceive(world, clock, c, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowGameS);
    if (p.sight !== 'full') continue;
    out.push(`Hablar con ${c.knows.includes(n.id) ? n.name : descriptorOf(world, n.id)}`);
    break;
  }
  // Algo en el suelo.
  const floor = world.itemsIn({ type: 'spot', id: pos.spot_id }).map((i) => world.itemDef(i.item_id)).find((d) => d.size !== 'bulky' && !d.container?.fixed);
  if (floor) out.push(`Coger ${floor.name}`);
  // Una salida.
  const exits: string[] = [];
  for (const s of world.spotsOf(pos.location_id)) {
    for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
      if (exit.state.blocked_by) continue;
      const name = world.locationOfSpot(to_spot_id).name;
      if (!exits.includes(name)) exits.push(name);
    }
  }
  // Los puntos más cercanos hasta llenar.
  const near = world.spotsOf(pos.location_id)
    .filter((s) => s.id !== pos.spot_id && (!s.hidden || s.discovered_by.includes(c.id)))
    .sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y));
  const room = Math.max(1, max - out.length - (exits.length ? 1 : 0));
  for (const s of near.slice(0, room)) out.push(`Ir ${aEs(s.name)}`);
  if (exits.length && out.length < max) out.push(`Salir hacia ${exits[0]}`);
  return out.slice(0, max);
}
