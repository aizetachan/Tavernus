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
import { glanceSees, knownSpots, knowsSpot, lookWouldReveal } from './spots.js';
import { ABILITY_ES, SKILLS, type Ability, type CheckKind } from './rules.js';
import type { World } from './world.js';
import { RULES_CHEATSHEET } from '../ai/rules-cheatsheet.js';

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

/**
 * 3-4 acciones con el mismo texto canónico que envía el tablero web. Si el PJ
 * va de camino, desde su destino: lo que deja atrás ya no le sirve («Coger
 * agua del pozo» al salir de la plaza).
 */
export function suggestActions(world: World, clock: GameClock, c: Character, nowGameS: number, max = 4): string[] {
  const goal = c.transit ? world.spots.get(c.transit.destination_spot_id) : undefined;
  const pos = goal ? { spot_id: goal.id, next_spot_id: null, progress: 0, x: goal.x, y: goal.y, location_id: goal.location_id } : positionOf(world, c, nowGameS);
  const out: string[] = [];
  // Alguien con quien hablar, por cómo lo ve el PJ (de camino, quien hay en el sitio adonde va).
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive') continue;
    const ns = world.spot(n.location.id);
    if (ns.location_id !== pos.location_id) continue;
    if (attitudeOf(n, c.id) === 'hostile') continue;
    const p = goal ? { sight: 'full' } : perceive(world, clock, c, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowGameS);
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
  // Lo que la estancia guarda fuera del primer vistazo (spots.ts): se ve mirando.
  if (!goal && out.length < max - 1 && lookWouldReveal(world, c)) out.push('Mirar alrededor');
  // Los puntos que conoce (de camino, más lo que verá al llegar), los más cercanos hasta llenar.
  const near = (goal ? world.spotsOf(goal.location_id).filter((s) => knowsSpot(c, s) || glanceSees(goal, s)) : knownSpots(world, c, pos.location_id))
    .filter((s) => s.id !== pos.spot_id)
    .sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y));
  const room = Math.max(1, max - out.length - (exits.length ? 1 : 0));
  for (const s of near.slice(0, room)) out.push(`Ir ${aEs(s.name)}`);
  if (exits.length && out.length < max) out.push(`Salir hacia ${exits[0]}`);
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------
// Preguntas sobre el juego: las contesta el sistema (info.ts), no el narrador
// ---------------------------------------------------------------------------

/**
 * Lo que el jugador pregunta de su hoja, de quién tiene al lado o de una
 * tirada: «¿cuánta destreza tengo?», «¿qué hechizos tengo?», «¿cuántos dados
 * tiro para esto?». Lo que pregunta del mundo o de otros («¿qué sabe Ilse del
 * pozo?», «¿tienes cerveza?») sigue al narrador; en la duda, también.
 */
export type InfoIntent =
  | { topic: InfoTopic }
  | { topic: 'ability'; ability: Ability }
  | { topic: 'skill'; skill: string }
  /** `check` null: la tirada pendiente («¿qué tiro para esto?»). */
  | { topic: 'roll'; check: { kind: CheckKind; key: string } | null }
  | { topic: 'rule'; term: string };

export type InfoTopic = 'abilities' | 'skills' | 'features' | 'spells' | 'inventory' | 'coins' | 'hp' | 'armor' | 'level' | 'quests' | 'people' | 'where';

/**
 * Temas y las palabras que los nombran (sin tildes). `words`: dentro de una
 * pregunta; `bare`: también solas («mis hechizos»); `weak`: solo cuentan si
 * no sale otro tema («¿cuánto oro llevo?» es oro, no inventario).
 */
export const INFO_TOPICS: { topic: InfoTopic; words: string[]; bare: string[]; weak?: string[] }[] = [
  { topic: 'spells', words: ['hechizo', 'hechizos', 'conjuro', 'conjuros', 'magia', 'magias', 'trucos', 'espacios de conjuro', 'espacios', 'slots', 'spells'], bare: ['hechizos', 'conjuros', 'espacios de conjuro', 'spells'] },
  { topic: 'coins', words: ['oro', 'monedas', 'moneda', 'dinero', 'pasta', 'plata', 'cobre', 'blanca'], bare: ['oro', 'monedas', 'dinero'] },
  { topic: 'hp', words: ['vida', 'pv', 'pg', 'puntos de vida', 'puntos de golpe', 'salud', 'hp', 'herido', 'herida', 'dados de golpe'], bare: ['vida', 'pv', 'pg', 'puntos de vida', 'puntos de golpe', 'salud', 'hp'], weak: ['como estoy'] },
  { topic: 'armor', words: ['ca', 'clase de armadura', 'defensa'], bare: ['ca', 'clase de armadura'] },
  { topic: 'level', words: ['nivel', 'experiencia', 'px', 'xp'], bare: ['nivel', 'experiencia', 'px', 'xp'] },
  { topic: 'quests', words: ['mision', 'misiones', 'encargo', 'encargos', 'tarea', 'tareas', 'objetivo', 'objetivos', 'trabajos', 'quests'], bare: ['mision', 'misiones', 'encargos', 'tareas', 'objetivos', 'quests'] },
  { topic: 'abilities', words: ['atributos', 'caracteristicas', 'estadisticas', 'stats', 'hoja', 'ficha'], bare: ['atributos', 'caracteristicas', 'estadisticas', 'stats', 'hoja', 'ficha', 'hoja de personaje'] },
  { topic: 'skills', words: ['habilidades', 'competencias', 'pericias'], bare: ['habilidades', 'competencias', 'pericias'] },
  { topic: 'features', words: ['rasgos', 'rasgo', 'rasgos de clase', 'poderes', 'aptitudes', 'talentos', 'dotes', 'se hacer', 'mejora de caracteristica'], bare: ['rasgos', 'rasgos de clase', 'poderes', 'aptitudes', 'talentos', 'que se hacer', 'lo que se hacer'] },
  { topic: 'inventory', words: ['inventario', 'mochila', 'equipo', 'equipaje', 'pertenencias', 'bolsillos', 'zurron', 'alforjas'], bare: ['mochila', 'equipo', 'equipaje', 'pertenencias', 'bolsillos'], weak: ['llevo', 'encima', 'cosas', 'objetos', 'conmigo', 'manos', 'llevo puesto'] },
];

/** Las órdenes de una palabra de siempre (inventario, quién, dónde) siguen su camino (resolveAction). */
const LEGACY = /^(inventario|inventory|quien|who|donde|where)$/;
/** Muletillas al principio: «oye», «a ver», «dime»… */
const FILLER = /^(?:(?:oye|a ver|vale|pues|y|entonces|bueno|venga|ok|eh|perdona|una pregunta|pregunta|master|narrador|sistema|dime|dime una cosa|recuerdame|ensename|muestrame|consultar|ver|mirar|abrir)\s+)+/;
/** Segunda o tercera persona, o el grupo: pregunta a otro o por otro. Al narrador. */
const NOT_INFO = /\b(tienes|tiene|teneis|tienen|tenga|tengas|llevas|lleva|llevan|sabes|sabe|saben|puedes|puede|pueden|vendes|vende|venden|cuesta|cuestan|valen|dame|danos|dadme|deme|das|cobras|cobra|quieres|quiere|le|les|tu|tus|su|sus|usted|tenemos|llevamos|nos)\b/;
const ASK = /^(?:que|cuanto|cuanta|cuantos|cuantas|cual|cuales|como)\b/;
const SELF = /\b(tengo|llevo|me queda|me quedan|cargo|conozco|mi|mis|estoy|puedo lanzar|se lanzar|se hacer)\b/;
const SELF_START = /^(?:tengo|llevo|me queda|me quedan|conozco|estoy)\b/;
const PEOPLE = /^(?:cuanta gente|cuantas personas|cuantos|cuantas|quien|quienes|hay alguien|hay gente|hay mas gente|con quien)(?: (?:hay|esta|estan|somos|estoy|se ve|veo))?(?: (?:aqui|a mi lado|conmigo|cerca|alrededor|a mi alrededor|por aqui|en la sala|aqui dentro|junto a mi|cerca de mi|ahora))+$/;
const WHERE = /^donde (?:estoy|me encuentro|ando)(?: ahora)?$/;
/** «¿Cuántos dados tiro para esto?», «¿qué sumo a sigilo?», «¿qué bonificador tengo en destreza?». */
const ROLL = /^(?:cuantos dados|que dados?|con que dados?|que tirada|que bonificador|que modificador|que bono|cuanto|que)\s+(tiro|tengo que tirar|me toca tirar|hay que tirar|lanzo|sumo|me sumo|hago|tengo|uso|es)(?:\s+(?:para|en|a|al|de|con)\s+(.+))?$/;
const DICE_LEAD = /^(?:cuantos dados|que dados?|con que dados?|que tirada|que bonificador|que modificador|que bono)\b/;
const TIRAR = /^(?:tiro|tengo que tirar|me toca tirar|hay que tirar|sumo|me sumo)$/;
const PENDING = /^(?:esto|eso|esta|esa|ella|la tirada|esta tirada|esa tirada|lo que me pide|lo que me pides|lo que me piden)$/;
const ATTACK = /^(?:atacar|ataque|ataco|atacarle|golpear|golpe|pegar|pegarle|pego|acertar|dar un golpe|un ataque)\b/;
const SAVE = /^(?:salvacion|tirada salvacion|salvarme|salvar)\s+(.+)$/;
const RULE = /^(?:que (?:es|significa|hace|pasa si estoy|pasa cuando estoy|es estar|significa estar|implica)|como funciona)\s+(?:el |la |los |las |un |una |estar )?(.+)$/;

const plainInfo = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Minúsculas, sin tildes ni signos, sin cifras coladas en una palabra («q1ue») y con «q»/«k» como «que». */
function cleanInfo(text: string): string {
  return plainInfo(text)
    .replace(/([a-zñ])\d+(?=[a-zñ])/g, '$1')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\b[qk]\b/g, 'que')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Aparece la frase entera (por palabras) en el texto? */
function hasPhrase(t: string, phrase: string): boolean {
  return ` ${t} `.includes(` ${phrase} `);
}

/** Características y habilidades por su nombre en castellano (rules.ts) o por la clave inglesa. */
function abilityNamed(t: string): Ability | null {
  for (const [k, es] of Object.entries(ABILITY_ES) as [Ability, string][]) if (t === plainInfo(es)) return k;
  return null;
}
function skillNamed(t: string): string | null {
  for (const [k, v] of Object.entries(SKILLS)) if (t === plainInfo(v.es) || t === k.replace(/_/g, ' ')) return k;
  return null;
}
/** Característica o habilidad nombrada dentro del texto (una sola; con dos, null). */
function statIn(t: string): { ability: Ability } | { skill: string } | null {
  const hits: ({ ability: Ability } | { skill: string })[] = [];
  for (const [k, es] of Object.entries(ABILITY_ES) as [Ability, string][]) if (hasPhrase(t, plainInfo(es))) hits.push({ ability: k });
  for (const [k, v] of Object.entries(SKILLS)) if (hasPhrase(t, plainInfo(v.es))) hits.push({ skill: k });
  return hits.length === 1 ? hits[0]! : null;
}

/** Tirada nombrada: habilidad, característica, salvación o ataque. 'pending': «esto». null: no se sabe cuál (al narrador). */
function checkNamed(raw: string | undefined): { kind: CheckKind; key: string } | 'pending' | null {
  const t = (raw ?? '').replace(/^(?:el|la|los|las|un|una|mi|mis)\s+/, '').replace(/^(?:prueba|tirada|chequeo|check)\s+(?:de\s+)?/, '').trim();
  if (!t || PENDING.test(t)) return 'pending';
  if (ATTACK.test(t)) return { kind: 'attack', key: 'weapon' };
  const save = t.match(SAVE);
  if (save) {
    const a = abilityNamed(save[1]!.replace(/^(?:de|contra)\s+/, ''));
    return a ? { kind: 'save', key: a } : null;
  }
  const skill = skillNamed(t);
  if (skill) return { kind: 'skill', key: skill };
  const ability = abilityNamed(t);
  return ability ? { kind: 'ability', key: ability } : null;
}

/**
 * Términos de reglas que el sistema sabe explicar: las condiciones y los
 * apartados («Ventaja:», «Descanso corto (1 h):») de la chuleta SRD, cada uno
 * con su texto. Sale de la chuleta: si crece, crece esto.
 */
export const RULE_TERMS: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>();
  for (const line of RULES_CHEATSHEET.split('\n')) {
    const cond = line.match(/^\s{2}([^:]+):\s*(.+)$/);
    if (cond) {
      for (const name of cond[1]!.replace(/\([^)]*\)/g, '').split('/')) out.set(plainInfo(name.trim()), `${cond[1]!.trim()}: ${cond[2]!.trim()}`);
      continue;
    }
    const body = line.replace(/^-\s*/, '');
    const heads = [...body.matchAll(/(?:^|[.;]\s+)([A-ZÁÉÍÓÚ][a-záéíóúñ]+(?: [a-záéíóúñ]+){0,2})(?: \([^)]*\))?:/g)];
    heads.forEach((h, i) => {
      const from = h.index! + h[0].indexOf(h[1]!);
      const to = i + 1 < heads.length ? heads[i + 1]!.index! + 1 : body.length;
      const term = plainInfo(h[1]!);
      const seg = body.slice(from, to).trim();
      // Un encabezado sin nada detrás («Condiciones (…):») no explica nada.
      if (term.length >= 5 && !out.has(term) && !/:$/.test(seg)) out.set(term, seg);
    });
  }
  return out;
})();

function ruleNamed(raw: string): string | null {
  const t = raw.trim();
  for (const form of [t, t.replace(/s$/, ''), t.replace(/a$/, 'o'), t.replace(/as$/, 'o'), t.replace(/os$/, 'o')]) if (RULE_TERMS.has(form)) return form;
  return null;
}

/** Temas que nombra el texto: los fuertes y, aparte, los flojos. */
function topicsIn(t: string): { strong: InfoTopic[]; weak: InfoTopic[] } {
  const strong: InfoTopic[] = [];
  const weak: InfoTopic[] = [];
  for (const def of INFO_TOPICS) {
    if (def.words.some((w) => hasPhrase(t, w))) strong.push(def.topic);
    else if (def.weak?.some((w) => hasPhrase(t, w))) weak.push(def.topic);
  }
  return { strong, weak };
}

/**
 * ¿Es una pregunta sobre el juego que el sistema sabe contestar? Solo texto:
 * no mira el mundo. Pide que sea del propio PJ («tengo», «mis», «me quedan»)
 * y que nombre un único tema; si no, null y va al narrador.
 */
export function parseInfo(text: string): InfoIntent | null {
  const raw = text.trim();
  let t = cleanInfo(raw);
  if (!t || LEGACY.test(t)) return null;
  t = t.replace(FILLER, '').trim();
  if (!t || t.split(' ').length > 10) return null;

  if (WHERE.test(t)) return { topic: 'where' };
  if (PEOPLE.test(t)) return { topic: 'people' };

  const rule = t.match(RULE);
  if (rule) {
    const term = ruleNamed(rule[1]!);
    return term ? { topic: 'rule', term } : null;
  }
  if (NOT_INFO.test(t)) return null;

  const roll = t.match(ROLL);
  // «¿Qué hago?», «¿qué lanzo?», «¿qué es?» no son tiradas: el verbo de tirar o el dado tienen que estar.
  if (roll && (DICE_LEAD.test(t) || TIRAR.test(roll[1]!) || roll[1] === 'tengo')) {
    const check = checkNamed(roll[2]);
    // «¿Qué tengo en sigilo?»: el valor, no la tirada.
    if (check && check !== 'pending' && roll[1] === 'tengo') {
      if (check.kind === 'skill') return { topic: 'skill', skill: check.key };
      if (check.kind === 'ability') return { topic: 'ability', ability: check.key as Ability };
    }
    if (check === 'pending' && roll[1] !== 'tengo') return { topic: 'roll', check: null };
    if (check && check !== 'pending') return { topic: 'roll', check };
    // «¿Qué tiro para abrir la puerta?»: no se sabe qué tirada es. «¿Qué tengo en la mochila?» sigue abajo.
    if (roll[1] !== 'tengo') return null;
  }

  // Sola: «mis hechizos», «mochila», «mi destreza».
  const mine = /^mis? /.test(t);
  const bare = t.replace(/^(?:mis?|el|la|los|las|lista de|la lista de|mi lista de)\s+/, '');
  for (const def of INFO_TOPICS) if (def.bare.includes(bare)) return { topic: def.topic };
  if (mine) {
    const a = abilityNamed(bare);
    if (a) return { topic: 'ability', ability: a };
    const s = skillNamed(bare);
    if (s) return { topic: 'skill', skill: s };
  }

  // Pregunta del propio PJ: «¿qué hechizos tengo?», «¿cuánta destreza tengo?», «¿me quedan monedas?».
  const asks = ASK.test(t) || (SELF_START.test(t) && /\?/.test(raw));
  if (!asks || !SELF.test(t)) return null;
  const stat = statIn(t);
  const { strong, weak } = topicsIn(t);
  if (stat && strong.length === 0) return 'ability' in stat ? { topic: 'ability', ability: stat.ability } : { topic: 'skill', skill: stat.skill };
  if (stat) return null;
  if (strong.length === 1) return { topic: strong[0]! };
  if (strong.length === 0 && weak.length === 1) return { topic: weak[0]! };
  return null;
}
