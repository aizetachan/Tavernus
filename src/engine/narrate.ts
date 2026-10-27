/**
 * Narración plana desde los datos (fase 1, SPEC §12.1). Sin IA: describe lo
 * que hay en la DB con el nivel de detalle que permite la percepción.
 */

import type { GameClock } from '../clock/clock.js';
import type { Character, Id, Npc } from './model.js';
import { positionOf } from './movement.js';
import { lightAt, perceive } from './perception.js';
import { describeNode } from './resources.js';
import { presenceLine } from './schedule.js';
import { knownSpots } from './spots.js';
import type { World } from './world.js';

const LIGHT_ES = { day: 'Es de día', twilight: 'La luz es escasa', night_moon: 'Es de noche, con algo de luna', night_dark: 'Es noche cerrada' } as const;

export function describeSurroundings(world: World, clock: GameClock, c: Character, nowGameS: number): string {
  const pos = positionOf(world, c, nowGameS);
  const loc = world.location(pos.location_id);
  const spot = world.spot(pos.spot_id);
  const lines: string[] = [];

  lines.push(`**${loc.name}** — ${spot.name}. ${clock.format(nowGameS)}. ${LIGHT_ES[lightAt(clock, loc, nowGameS)]}.`);
  lines.push(loc.description_base);
  lines.push(spot.description);
  if (c.transit && pos.next_spot_id) {
    const next = world.spot(pos.next_spot_id);
    const left = Math.max(0, c.transit.arrives_game_s - nowGameS);
    lines.push(`Vas de camino hacia ${next.name} (${Math.round(pos.progress * 100)}% del tramo; llegas a tu destino en ${fmtDuration(left)} de juego, ${fmtDuration(clock.gameToReal(left))} reales).`);
  }

  // Gente, por banda de percepción.
  const people: string[] = [];
  for (const other of world.characters.values()) {
    if (other.id === c.id || other.status === 'dead' || other.status === 'retired') continue;
    const opos = positionOf(world, other, nowGameS);
    if (opos.location_id !== loc.id) continue;
    const p = perceive(world, clock, c, opos, nowGameS);
    const where = opos.spot_id === pos.spot_id ? 'aquí mismo' : `en ${world.spot(opos.spot_id).name}`;
    const state = other.status === 'asleep' ? ', dormido' : other.transit ? ', en movimiento' : '';
    if (p.sight === 'full') people.push(`${other.name} ${where}${state}${other.veiled ? ' (bajo un velo)' : ''}`);
    else if (p.sight === 'vague') people.push(`una figura ${where}${state}`);
    else if (p.sight === 'hint') people.push('algo se mueve a lo lejos');
  }
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive') continue;
    const ns = world.spot(n.location.id);
    if (ns.location_id !== loc.id) continue;
    const p = perceive(world, clock, c, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowGameS);
    const where = ns.id === pos.spot_id ? 'aquí mismo' : `en ${ns.name}`;
    if (p.sight === 'full') people.push(`${n.name} (${n.role}) ${where}`);
    else if (p.sight === 'vague') people.push(`alguien ${where}`);
  }
  if (people.length) lines.push(`Ves: ${people.join('; ')}.`);
  // Cuerpos de NPC muertos: siguen donde cayeron.
  const bodies = [...world.npcs.values()].filter((n) => n.status === 'dead' && world.spots.get(n.location.id)?.location_id === loc.id)
    .map((n) => `${contractArticles(`el cuerpo de ${c.knows.includes(n.id) ? n.name : descriptorOf(world, n.id)}`)}${n.location.id === pos.spot_id ? ' aquí mismo' : ` en ${world.spot(n.location.id).name}`}`);
  // Y los que un golpe no letal dejó inconscientes: vivos, pero en el suelo.
  for (const n of world.npcs.values()) {
    if (n.status !== 'unconscious' || world.spots.get(n.location.id)?.location_id !== loc.id) continue;
    bodies.push(`${c.knows.includes(n.id) ? n.name : descriptorOf(world, n.id)}, inconsciente${n.bound ? ' y atado' : ''}${n.location.id === pos.spot_id ? ', aquí mismo' : `, en ${world.spot(n.location.id).name}`}`);
  }
  if (bodies.length) lines.push(`En el suelo: ${bodies.join('; ')}.`);
  // Gente de la agenda (schedule.ts): el mercado, la misa… como presencia del lugar.
  const crowd = presenceLine(world, loc.id, nowGameS);
  if (crowd) lines.push(crowd);

  // Cosas en este punto.
  const items = world.itemsIn({ type: 'spot', id: spot.id }).map((i) => {
    const d = world.itemDef(i.item_id);
    return i.quantity > 1 ? `${d.name} ×${i.quantity}` : d.name;
  });
  const nodes = [...world.resourceNodes.values()].filter((n) => n.spot_id === spot.id).map((n) => describeNode(n, nowGameS));
  if (items.length || nodes.length) lines.push(`Aquí hay: ${[...items, ...nodes].join(', ')}.`);

  // Otros puntos de la localización y salidas.
  const others = knownSpots(world, c, loc.id).filter((s) => s.id !== spot.id);
  if (others.length) lines.push(`Puntos cercanos: ${others.map((s) => `${s.name} (${Math.round(Math.hypot(s.x - pos.x, s.y - pos.y))} m)`).join(', ')}.`);
  const exits: string[] = [];
  for (const s of world.spotsOf(loc.id)) {
    for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
      const dest = world.locationOfSpot(to_spot_id);
      const via = s.id === spot.id ? '' : ` desde ${s.name}`;
      const blocked = exit.state.blocked_by ? ` (bloqueada: ${exit.state.blocked_by})` : exit.state.locked ? ' (cerrada con llave)' : '';
      exits.push(`${dest.name}${via}, ${exit.distance_m} m${blocked}`);
    }
  }
  if (exits.length) lines.push(`Salidas: ${exits.join('; ')}.`);
  return lines.join('\n');
}

/**
 * Llegada sin IA. `full` al entrar en otra localización: ambiente, luz, dos o
 * tres puntos, quién se ve (por descriptor si no lo conoce) y salidas. Si no,
 * solo el punto y lo que hay en él.
 */
export function arrivalNarration(world: World, clock: GameClock, c: Character, nowGameS: number, full: boolean): string {
  const pos = positionOf(world, c, nowGameS);
  const loc = world.location(pos.location_id);
  const spot = world.spot(pos.spot_id);
  const people = peopleSeen(world, clock, c, nowGameS, full ? null : spot.id);
  const lines: string[] = [];
  if (full) {
    lines.push(`**${loc.name}** — ${spot.name}. ${LIGHT_ES[lightAt(clock, loc, nowGameS)]}.`);
    lines.push(loc.description_base);
    lines.push(spot.description);
    const others = knownSpots(world, c, loc.id)
      .filter((s) => s.id !== spot.id)
      .sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y))
      .slice(0, 3).map((s) => s.name);
    if (others.length) lines.push(`Más allá: ${listEs(others)}.`);
    if (people.length) lines.push(`Ves ${listEs(people.map(aEs))}.`);
    const crowd = presenceLine(world, loc.id, nowGameS);
    if (crowd) lines.push(crowd);
    const exits = new Set<string>();
    for (const s of world.spotsOf(loc.id)) for (const { to_spot_id } of world.exitsFrom(s.id)) exits.add(world.locationOfSpot(to_spot_id).name);
    if (exits.size) lines.push(`Salidas: ${listEs([...exits])}.`);
  } else {
    lines.push(`Llegas ${aEs(spot.name)}. ${spot.description}`);
    if (people.length) lines.push(`Aquí ves ${listEs(people.map(aEs))}.`);
    const items = world.itemsIn({ type: 'spot', id: spot.id }).map((i) => world.itemDef(i.item_id).name);
    if (items.length) lines.push(`Aquí hay: ${items.join(', ')}.`);
  }
  return lines.join('\n');
}

/** Gente que el PJ percibe en su localización (o solo en `spotId`), con el nombre si lo sabe y si no por cómo se ve. */
function peopleSeen(world: World, clock: GameClock, c: Character, nowGameS: number, spotId: Id | null): string[] {
  const pos = positionOf(world, c, nowGameS);
  const out: string[] = [];
  const where = (sid: Id) => (spotId ? '' : sid === pos.spot_id ? ' aquí mismo' : ` en ${world.spot(sid).name}`);
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive') continue;
    const ns = world.spot(n.location.id);
    if (ns.location_id !== pos.location_id || (spotId && ns.id !== spotId)) continue;
    const p = perceive(world, clock, c, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowGameS);
    if (p.sight === 'full') out.push(`${c.knows.includes(n.id) ? n.name : descriptorOf(world, n.id)}${where(ns.id)}`);
    else if (p.sight === 'vague') out.push(`una figura${where(ns.id)}`);
  }
  for (const o of world.characters.values()) {
    if (o.id === c.id || o.status === 'dead' || o.status === 'retired') continue;
    const op = positionOf(world, o, nowGameS);
    if (op.location_id !== pos.location_id || (spotId && op.spot_id !== spotId)) continue;
    const p = perceive(world, clock, c, op, nowGameS);
    const state = o.status === 'asleep' ? ', dormido' : '';
    if (p.sight === 'full') out.push(`${o.name}${where(op.spot_id)}${state}`);
    else if (p.sight === 'vague') out.push(`una figura${where(op.spot_id)}`);
  }
  return out;
}

/** «a» + nombre, con la contracción: «al pozo», «a la barra», «a Mira». */
export function aEs(name: string): string {
  return /^el /i.test(name) ? `al ${name.slice(3)}` : `a ${name}`;
}

export function listEs(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`;
}

export function whoIsHere(world: World, clock: GameClock, c: Character, nowGameS: number): string {
  const pos = positionOf(world, c, nowGameS);
  const names: string[] = [];
  for (const other of world.characters.values()) {
    if (other.id === c.id) continue;
    const opos = positionOf(world, other, nowGameS);
    if (opos.location_id !== pos.location_id) continue;
    const p = perceive(world, clock, c, opos, nowGameS);
    if (p.sight === 'full') names.push(other.name + (other.status === 'asleep' ? ' (dormido)' : ''));
    else if (p.sight === 'vague') names.push('una figura');
  }
  return names.length ? `Ves a: ${names.join(', ')}.` : 'No ves a nadie.';
}

export function whereAmI(world: World, clock: GameClock, c: Character, nowGameS: number): string {
  const pos = positionOf(world, c, nowGameS);
  const loc = world.location(pos.location_id);
  const zone = world.zone(loc.zone_id);
  const spot = world.spot(pos.spot_id);
  return `${zone.name} → ${loc.name} → ${spot.name}. ${clock.format(nowGameS)}.`;
}

export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

/** Cómo ve a alguien quien no sabe su nombre. */
export function descriptorOf(world: World, id: Id): string {
  const c = world.characters.get(id);
  if (c) return c.appearance ? `${c.appearance}` : `${c.race === 'humano' ? 'un humano' : `un ${c.race}`} con pinta de ${c.class_name}`;
  const n = world.npcs.get(id);
  if (n) return roleLabel(n);
  return 'alguien';
}

/**
 * El oficio con artículo, para el texto corrido: la forma corta si los datos
 * la dan («el alguacil» por «alguacil y recaudador», «el guardia»); si no, el
 * oficio entero, con «la» si acaba en «a» («la curandera»).
 */
export function roleLabel(n: Pick<Npc, 'role' | 'role_short'>, long = false): string {
  const r = (long ? null : n.role_short) ?? n.role;
  return /^(el|la|los|las|un|una) /i.test(r) ? r : /a$/.test(r) ? `la ${r}` : `el ${r}`;
}

/**
 * Formas de nombrar a un NPC: su nombre y, si es compuesto, el de pila
 * («Osric» de «Osric Malvez»). Un nombre en minúscula («un lobo flaco») es una
 * descripción: solo él.
 */
export function npcNameForms(name: string): string[] {
  const first = name.split(/\s+/)[0]!;
  return /^\p{Lu}/u.test(name) && first !== name && first.length >= 3 ? [name, first] : [name];
}

/** El nombre suelto en un texto, sin partir palabras (vale con tildes: «Úrsula», «Garrán»). */
export function nameRe(name: string, flags = 'gu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, flags);
}

/** «a el herrero» → «al herrero», «de el» → «del» (no toca «a él» ni «El Escorial»). */
export function contractArticles(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])([Aa]|[Dd]e) el(?![\p{L}\p{N}])/gu, '$1l');
}

/** Palabras de la campaña (descripciones de sitios y puntos, objetos): un nombre que también es palabra («Ceniza») no se tapa a principio de frase. */
const commonWords = new WeakMap<World, Set<string>>();
function isCommonWord(world: World, name: string): boolean {
  let set = commonWords.get(world);
  if (!set) {
    const text = [...world.locations.values()].map((l) => l.description_base)
      .concat([...world.spots.values()].flatMap((s) => [s.name, s.description]), [...world.itemDefs.values()].map((d) => d.name)).join(' ');
    // Solo lo que sale en minúscula: «la fragua de Hugo» no hace de «Hugo» una palabra.
    set = new Set(text.split(/[^\p{L}]+/u).filter((w) => /^\p{Ll}/u.test(w)));
    commonWords.set(world, set);
  }
  return !/\s/.test(name) && set.has(name.toLowerCase());
}

/**
 * Sustituye en un texto los nombres de quienes el lector no conoce por su
 * descripción, con la contracción que toque («habla al herrero»). Lo citado
 * («…») son palabras de alguien y se deja. `keep`: los que no se tapan aunque
 * no los conozca (los que nombró el propio jugador).
 */
export function maskUnknownNames(world: World, readerId: Id, text: string, keep: readonly Id[] = []): string {
  const reader = world.characters.get(readerId);
  if (!reader) return text;
  // Lo citado son palabras de alguien: un nombre dicho en voz alta se oye tal cual.
  if (/«[^»]*»/.test(text)) return text.split(/(«[^»]*»)/).map((part, i) => (i % 2 ? part : maskUnknownNames(world, readerId, part, keep))).join('');
  let out = text;
  // Los PJ de la partida se conocen siempre por su nombre: solo se enmascaran NPC.
  for (const n of world.npcs.values()) {
    if (reader.knows.includes(n.id) || keep.includes(n.id)) continue;
    const desc = descriptorOf(world, n.id);
    const long = roleLabel(n, true);
    const common = isCommonWord(world, n.name);
    // A principio de frase, con mayúscula; «Ceniza cubre la plaza», ahí, es la palabra y no el perro.
    const put = (m: string, at: number, all: string) => {
      const start = /(^\s*|[.!?…]\s+|\n\s*)$/.test(all.slice(0, at));
      if (common && start) return m;
      return start ? desc.charAt(0).toUpperCase() + desc.slice(1) : desc;
    };
    for (const f of npcNameForms(n.name)) {
      // «Ilse, la curandera» → «la curandera» (no «la curandera, la curandera»).
      out = out.replace(new RegExp(`${nameRe(f).source},\\s*(?:${escapeRe(long)}|${escapeRe(desc)})(?![\\p{L}\\p{N}])`, 'gu'), put);
      out = out.replace(nameRe(f), put);
    }
  }
  // La contracción, también donde el texto ya venía mal («Ir a el roble viejo»).
  return contractArticles(out);
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function nameOf(world: World, id: Id): string {
  return world.characters.get(id)?.name ?? world.npcs.get(id)?.name ?? id;
}
