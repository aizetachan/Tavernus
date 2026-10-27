/**
 * Crimen, testigos y reacción del mundo (revisión de la partida del
 * 27-10-2026, bloque C). Un *incidente* es un hecho del motor, no una opinión
 * del máster: tipo y gravedad, sitio, autor, víctima y quién lo sabe. Las
 * consecuencias las aplica siempre el motor; el máster solo las cuenta.
 *
 *   - Tipos, de menos a más grave: insulto, robo, agresión, agresión con arma,
 *     profanar un cadáver y muerte. Los detecta el motor donde los ve (un
 *     golpe a quien no era hostil, una muerte, registrar un cuerpo, un insulto
 *     dicho a la cara, quitarle algo a alguien) y el máster con report_incident.
 *   - Testigos: los NPC vivos de la localización que pueden verlo u oírlo (lo
 *     violento se oye en toda la sala; lo callado, solo cerca) y la gente de
 *     la agenda que haya («unos diez vecinos»).
 *   - Cada testigo reacciona según su papel, que sale de los datos de campaña
 *     (`campaign.law`, `npc.bonds`): la autoridad da el alto y detiene; el
 *     dueño del local no sirve ni aloja; los allegados de la víctima se
 *     vuelven hostiles o guardan luto; la gente corriente grita, huye o corre
 *     a avisar a la autoridad (con una orden de NPC de verdad).
 *   - Consecuencias: actitud y memoria de cada testigo, reputación con la
 *     facción del pueblo, estado «buscado» con su motivo, rumores que corren
 *     con las rutinas (quien se cruza con alguien que lo sabe, se entera),
 *     tiendas y posada que se niegan, ningún descanso seguro mientras la
 *     autoridad sepa dónde estás y, en vez de PX, infamia.
 *   - Detención: si te entregas, calabozo o multa; si te resistes, la
 *     autoridad pasa a hostil y entra en el combate; si te tumba, calabozo.
 *
 * Funciones sobre el mundo, sin IA ni eventos: el motor (engine.ts) emite las
 * reacciones en el acto (evento `incident`) y el alto (`arrest`); el contexto
 * del máster (prompt.ts) pone el incidente pendiente y lo que vio cada testigo
 * antes que nada; el control de cierre (tools.ts) rechaza el turno que lo
 * ignore. Los incidentes viven en la campaña (`campaign.incidents`), como los
 * rumores: viajan con el snapshot.
 *
 * Bloque D (combate) engancha aquí: los que intervienen (`fight`, y la
 * autoridad cuando te resistes) quedan hostiles y por eso entran en el
 * encuentro (encounter.ts); que ataquen en su turno es cosa del combate.
 */

import { GAME_DAY, GAME_HOUR, GAME_MINUTE } from '../clock/clock.js';
import type { Character, Id, IncidentKind, LawRules, Npc, NpcBond, Spot, Wanted } from './model.js';
import { descriptorOf, fmtDuration } from './narrate.js';
import { orderOf, setNpcOrder } from './npcorders.js';
import type { Rumor } from './rumors.js';
import { crowdHere, routineOf } from './schedule.js';
import { stabilize } from './death.js';
import { opinionRefusal } from './standing.js';
import type { World } from './world.js';

export type { IncidentKind } from './model.js';

export const INCIDENT_KINDS: readonly IncidentKind[] = ['insult', 'theft', 'assault', 'armed_assault', 'desecration', 'murder'];
/** Gravedad de cada tipo (1-5). Desde 2, hay alto, buscado y rumor. */
export const SEVERITY: Record<IncidentKind, number> = { insult: 1, theft: 2, assault: 2, armed_assault: 3, desecration: 3, murder: 5 };
export const KIND_ES: Record<IncidentKind, string> = { insult: 'insulto', theft: 'robo', assault: 'agresión', armed_assault: 'agresión con arma', desecration: 'profanar un cadáver', murder: 'muerte' };

/** Multas por defecto (monedas) y horas de calabozo por defecto, si la campaña no dice otra cosa. */
export const DEFAULT_FINES: Record<IncidentKind, number> = { insult: 0, theft: 50, assault: 30, armed_assault: 100, desecration: 100, murder: 0 };
export const DEFAULT_JAIL_HOURS: Record<IncidentKind, number> = { insult: 0, theft: 0, assault: 0, armed_assault: 8, desecration: 8, murder: 24 };

/** Lo violento, que sube de gravedad dentro del mismo incidente. */
const VIOLENT: readonly IncidentKind[] = ['assault', 'armed_assault', 'murder'];
/** El mismo autor contra la misma víctima en este rato es el mismo incidente, que sube de gravedad. */
export const ESCALATE_S = GAME_HOUR;
/** Mientras tanto, quien llega al sitio ve lo que ha pasado (la sangre, el cuerpo) y se entera. */
export const FRESH_S = GAME_HOUR;
/** Lo que dura la noticia corriendo de boca en boca. */
export const NEWS_S = 3 * GAME_DAY;
/** Si nadie con nombre corre a avisar, la gente del sitio avisa a la autoridad a los N minutos. */
export const CROWD_ALERT_S = 10 * GAME_MINUTE;
/** El máster tiene que contarlo en este rato (control de cierre); luego ya no se exige. */
export const PENDING_S = 30 * GAME_MINUTE;
/** La autoridad sabe dónde estás si alguien que lo sabe te vio aquí hace menos de esto. */
export const SEEN_S = 12 * GAME_HOUR;

/** Papel de un NPC ante un incidente. */
export type CrimeRole = 'victim' | 'authority' | 'kin' | 'owner' | 'commoner';
/** Lo que hace en el acto. */
export type CrimeResponse = 'arrest' | 'fight' | 'alert' | 'flee' | 'shout' | 'refuse' | 'mourn' | 'watch';
/** Cómo queda con el autor. */
export type CrimeStance = 'outraged' | 'hostile' | 'afraid' | 'mourning' | 'wary';

/** Quién sabe del incidente y cómo se ha tomado. */
export interface Knower {
  npc_id: Id;
  /** saw: estaba; found: llegó y vio lo que había pasado; told: se lo contaron. */
  how: 'saw' | 'found' | 'told';
  /** Quién se lo contó (NPC), o null (la gente, el sitio). */
  from: Id | null;
  role: CrimeRole;
  response: CrimeResponse;
  stance: CrimeStance;
  game_s: number;
  /** alert: a quién va a avisar. */
  to?: Id | null;
}

export interface Incident {
  id: Id;
  kind: IncidentKind;
  severity: number;
  game_s: number;
  updated_game_s: number;
  location_id: Id;
  spot_id: Id;
  perpetrator_id: Id;
  perpetrator_name: string;
  victim_id: Id | null;
  victim_name: string | null;
  /** Con qué (agresión con arma): «bastón», «Proyectil mágico». */
  weapon: string | null;
  /** La gente de la agenda que lo vio («unos diez vecinos»). */
  crowd: string | null;
  knowers: Knower[];
  /** Gravedad que el motor ya ha contado con su evento `incident`. */
  announced: number;
  /** PJ a quienes el máster ya lo ha contado (control de cierre). Se vacía si sube de gravedad. */
  narrated_to: Id[];
  /** Cuándo la gente sin nombre avisa a la autoridad, si nadie lo ha hecho; null si ya no hace falta. */
  crowd_alert_game_s: number | null;
  /** Reputación ya restada e infamia ya sumada (para no cobrarlas dos veces al subir de gravedad). */
  rep_applied: number;
  infamy_applied: number;
  status: 'open' | 'settled';
}

export interface IncidentInput {
  kind: IncidentKind;
  perpetrator_id: Id;
  victim_id?: Id | null;
  /** Dónde; sin él, donde está el autor. */
  spot_id?: Id | null;
  weapon?: string | null;
}

// ---------------------------------------------------------------------------
// La ley de la campaña
// ---------------------------------------------------------------------------

/** Rol que hace a alguien autoridad cuando la campaña no dice quién es (mundos generados). */
const AUTHORITY_ROLE = /\b(guardia|alguacil|sheriff|corchete|centinela|soldad[oa]|capit[aá]n|vigilante|carcelero|alcaide|sargento|guard)\b/i;

export function lawOf(world: World): LawRules {
  return world.campaign.law ?? {};
}

/** IDs de quienes hacen cumplir la ley: los de la campaña o, sin ellos, los de rol de guardia. */
export function enforcerIds(world: World): Id[] {
  const law = lawOf(world);
  if (law.enforcers?.length) return law.enforcers.filter((id) => world.npcs.has(id));
  return [...world.npcs.values()].filter((n) => AUTHORITY_ROLE.test(n.role)).map((n) => n.id);
}

export function isEnforcer(world: World, npcId: Id): boolean { return enforcerIds(world).includes(npcId); }

/** ¿Es el dueño de ese local? Los de la campaña o, sin ellos, quien vende algo y tiene su sitio en esa localización. */
export function isOwner(world: World, npcId: Id, locationId: Id): boolean {
  const law = lawOf(world);
  if (law.owners?.length) return law.owners.some((o) => o.npc_id === npcId && o.location_ids.includes(locationId));
  const n = world.npcs.get(npcId);
  if (!n || !n.sells.length) return false;
  const home = routineOf(n)?.night ?? routineOf(n)?.day ?? n.location.id;
  return world.spots.get(home)?.location_id === locationId;
}

/** El vínculo entre dos NPC (lo diga uno u otro). */
export function bondBetween(world: World, a: Id, b: Id): NpcBond | null {
  const na = world.npcs.get(a);
  const nb = world.npcs.get(b);
  return na?.bonds?.find((x) => x.npc_id === b) ?? nb?.bonds?.find((x) => x.npc_id === a) ?? null;
}

function jailSpot(world: World): Spot | null {
  const id = lawOf(world).jail_spot_id;
  return id ? world.spots.get(id) ?? null : null;
}

// ---------------------------------------------------------------------------
// Almacén
// ---------------------------------------------------------------------------

function store(world: World): Incident[] {
  const camp = world.campaign as typeof world.campaign & { incidents?: Incident[] };
  camp.incidents ??= [];
  return camp.incidents;
}

export function allIncidents(world: World): readonly Incident[] { return store(world); }

export function incidentById(world: World, id: Id): Incident | null { return store(world).find((i) => i.id === id) ?? null; }

function touchCampaign(world: World): void { world.touch('campaign', world.campaign.id); }

/** Lo que sabe ese NPC de lo que ha hecho ese PJ: el incidente más grave que conoce. */
export function knownBy(world: World, npcId: Id, characterId: Id): { incident: Incident; knower: Knower } | null {
  let best: { incident: Incident; knower: Knower } | null = null;
  for (const i of store(world)) {
    if (i.perpetrator_id !== characterId) continue;
    const k = i.knowers.find((x) => x.npc_id === npcId);
    if (k && (!best || i.severity > best.incident.severity)) best = { incident: i, knower: k };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Lo que hizo, en pretérito: «mató a Hugo», «atacó a Hugo con un bastón». */
export function deedText(i: Pick<Incident, 'kind' | 'victim_name' | 'weapon'>): string {
  const v = i.victim_name ?? 'alguien';
  switch (i.kind) {
    case 'murder': return `mató ${al(v)}`;
    case 'armed_assault': return `atacó ${al(v)}${i.weapon ? ` (${i.weapon})` : ' con un arma'}`;
    case 'assault': return `golpeó ${al(v)}`;
    case 'theft': return `le robó ${al(v)}`;
    case 'desecration': return `registró el cadáver ${del_(v)}`;
    case 'insult': return `insultó ${al(v)}`;
  }
}

/** Lo que hizo, con la víctima como la llama el lector (su nombre si lo sabe; si no, «el herrero»). */
function deedFor(world: World, i: Incident, reader?: Character | null): string {
  return deedText({ ...i, victim_name: i.victim_id ? label(world, i.victim_id, reader) : i.victim_name });
}

/** En segunda persona: «has matado a Hugo». */
function deedYou(i: Incident): string {
  const v = i.victim_name ?? 'alguien';
  switch (i.kind) {
    case 'murder': return `has matado ${al(v)}`;
    case 'armed_assault': return `has atacado ${al(v)}`;
    case 'assault': return `has golpeado ${al(v)}`;
    case 'theft': return `le has robado ${al(v)}`;
    case 'desecration': return `has registrado el cadáver ${del_(v)}`;
    case 'insult': return `has insultado ${al(v)}`;
  }
}

/** En imperfecto, para la memoria: «Vio cómo Leodhin mataba a Hugo». */
function deedWas(i: Incident): string {
  const v = i.victim_name ?? 'alguien';
  switch (i.kind) {
    case 'murder': return `mataba ${al(v)}`;
    case 'armed_assault': return `atacaba ${al(v)}${i.weapon ? ` (${i.weapon})` : ' con un arma'}`;
    case 'assault': return `golpeaba ${al(v)}`;
    case 'theft': return `le robaba ${al(v)}`;
    case 'desecration': return `registraba el cadáver ${del_(v)}`;
    case 'insult': return `insultaba ${al(v)}`;
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
/** «a Hugo», «al herrero» (y «de Hugo», «del herrero»): la contracción cuando el lector solo ve el rol. */
function al(v: string): string { return /^el /i.test(v) ? `al ${v.slice(3)}` : `a ${v}`; }
function del_(v: string): string { return /^el /i.test(v) ? `del ${v.slice(3)}` : `de ${v}`; }

const STANCE_ES: Record<CrimeStance, string> = {
  outraged: 'es la autoridad y quiere detenerle: si se entrega, calabozo o multa; si se resiste, pelea',
  hostile: 'le odia por ello: no le atiende y, si puede, le hace daño',
  afraid: 'le tiene miedo: no le atiende con normalidad (ni le vende, ni le aloja, ni le da conversación amable)',
  mourning: 'está de luto y no quiere ni verle',
  wary: 'desconfía de él: le atiende lo justo y sin amabilidad',
};

const RESPONSE_ES: Record<CrimeResponse, string> = {
  arrest: 'da el alto y le detiene',
  fight: 'se lanza contra él',
  alert: 'corre a avisar a la autoridad',
  flee: 'huye',
  shout: 'grita y se aparta',
  refuse: 'no le sirve ni le aloja',
  mourn: 'se queda junto a la víctima',
  watch: 'no le quita ojo',
};

const ROLE_ES: Record<CrimeRole, string> = { victim: 'la víctima', authority: 'autoridad', kin: 'allegado de la víctima', owner: 'dueño del local', commoner: 'vecino' };

// ---------------------------------------------------------------------------
// Testigos y reacciones
// ---------------------------------------------------------------------------

/** Lo violento se oye en toda la localización; lo callado (robo, profanar, insultar) solo se ve de cerca. */
function loud(kind: IncidentKind): boolean { return kind === 'assault' || kind === 'armed_assault' || kind === 'murder'; }
const NEAR_M = 12;

/** NPC vivos que pueden ver u oír lo que pasa en ese punto. */
export function witnessesAt(world: World, spot: Spot, kind: IncidentKind, exclude: readonly Id[]): Npc[] {
  return [...world.npcs.values()].filter((n) => {
    if (n.status !== 'alive' || exclude.includes(n.id)) return false;
    const s = world.spots.get(n.location.id);
    if (!s || s.location_id !== spot.location_id) return false;
    if (loud(kind) || s.id === spot.id) return true;
    const link = spot.links.find((l) => l.to_spot_id === s.id) ?? s.links.find((l) => l.to_spot_id === spot.id);
    if (link?.blocks_sight) return false;
    return Math.hypot(s.x - spot.x, s.y - spot.y) <= NEAR_M;
  });
}

function roleOf(world: World, n: Npc, i: Incident): CrimeRole {
  if (n.id === i.victim_id) return 'victim';
  if (isEnforcer(world, n.id)) return 'authority';
  const b = i.victim_id ? bondBetween(world, n.id, i.victim_id) : null;
  if (b && b.kind !== 'rival') return 'kin';
  if (isOwner(world, n.id, i.location_id)) return 'owner';
  return 'commoner';
}

/** Qué hace y cómo queda un NPC ante el incidente, según su papel y si estaba. */
function reactionOf(world: World, n: Npc, i: Incident, how: Knower['how'], alertTaken: boolean, authorityKnows: boolean): Pick<Knower, 'role' | 'response' | 'stance'> {
  const role = roleOf(world, n, i);
  const present = how === 'saw';
  const temper = lawOf(world).temperament?.[n.id];
  if (i.severity < 2) {
    // Un insulto: la víctima se ofende; los demás miran.
    return { role, response: 'watch', stance: 'wary' };
  }
  switch (role) {
    case 'victim':
      return { role, response: n.stats && i.kind !== 'theft' ? 'fight' : 'shout', stance: 'hostile' };
    case 'authority':
      return { role, response: 'arrest', stance: 'outraged' };
    case 'kin': {
      const b = i.victim_id ? bondBetween(world, n.id, i.victim_id) : null;
      // Se mete quien los datos dicen que se mete (y puede pelear); los demás, luto.
      const fight = b?.reaction === 'fight' && Boolean(n.stats) && i.severity >= 3;
      return fight ? { role, response: present ? 'fight' : 'watch', stance: 'hostile' } : { role, response: present ? 'mourn' : 'watch', stance: 'mourning' };
    }
    case 'owner':
      return { role, response: 'refuse', stance: temper === 'brave' ? 'hostile' : 'afraid' };
    case 'commoner':
      if (!present) return { role, response: 'watch', stance: i.severity >= 3 ? 'afraid' : 'wary' };
      if (temper === 'timid') return { role, response: 'flee', stance: 'afraid' };
      // El primero que puede corre a avisar a la autoridad; los demás gritan y se apartan.
      if (!authorityKnows && !alertTaken) return { role, response: 'alert', stance: temper === 'brave' ? 'hostile' : 'afraid' };
      return { role, response: 'shout', stance: temper === 'brave' ? 'hostile' : 'afraid' };
  }
}

const RANK: Record<string, number> = { hostile: 0, unfriendly: 1, neutral: 2, friendly: 3, allied: 4 };

/** Baja la actitud con el autor hasta `to` (nunca la sube). */
function lowerAttitude(n: Npc, characterId: Id, to: 'hostile' | 'unfriendly'): void {
  const cur = n.attitude.by_character[characterId] ?? n.attitude.default;
  if (RANK[cur]! > RANK[to]!) n.attitude.by_character[characterId] = to;
}

function memoryNote(i: Incident, k: Knower, world: World): string {
  const where = world.spots.get(i.spot_id)?.name ?? 'allí';
  if (k.how === 'saw') return `Vio cómo ${i.perpetrator_name} ${deedWas(i)} en ${where}.`;
  if (k.how === 'found') return `Llegó a ${where} y vio lo que había hecho ${i.perpetrator_name}: ${deedText(i)}.`;
  const from = k.from ? world.npcs.get(k.from)?.name : null;
  return `Le han contado${from ? ` (${from})` : ''} que ${i.perpetrator_name} ${deedText(i)} en ${where}.`;
}

/** Aplica a un NPC lo que sabe: actitud, memoria y, si toca, órdenes (avisar, huir). */
function applyKnower(world: World, i: Incident, n: Npc, k: Knower, nowG: number): void {
  const c = world.characters.get(i.perpetrator_id);
  if (c) {
    if (k.response === 'fight') n.attitude.by_character[c.id] = 'hostile';
    else if (i.severity >= 2) lowerAttitude(n, c.id, 'unfriendly');
    else if (k.role === 'victim') lowerAttitude(n, c.id, 'unfriendly');
    const note = memoryNote(i, k, world);
    if (!n.memory.some((m) => m.character_id === c.id && m.note === note)) {
      n.memory.push({ character_id: c.id, game_s: nowG, note, importance: i.severity >= 3 ? 3 : i.severity === 2 ? 2 : 1 });
    }
  }
  if (k.how === 'saw' && k.response === 'alert') {
    const to = k.to ? world.npcs.get(k.to) : null;
    const r = to ? setNpcOrder(world, { npc_id: n.id, order: 'go', task: { kind: 'act', text: `le cuenta a ${to.name} lo que ha hecho ${i.perpetrator_name}`, target_id: to.id }, minutes: 30 }, nowG) : null;
    if (!r?.ok) k.response = 'shout';
  } else if (k.how === 'saw' && k.response === 'flee') {
    const away = fleeSpot(world, n, i.location_id);
    if (!away || !setNpcOrder(world, { npc_id: n.id, order: 'go', spot_id: away, minutes: 60 }, nowG).ok) k.response = 'shout';
  }
  world.touch('npcs', n.id);
}

/** Adónde huye: a su sitio de la rutina fuera de aquí o, sin él, a la entrada de otra localización por la que se sale. */
function fleeSpot(world: World, n: Npc, locationId: Id): Id | null {
  const r = routineOf(n);
  for (const id of [r?.night, r?.day, r?.afternoon]) if (id && world.spots.get(id)?.location_id !== locationId && world.spots.has(id)) return id;
  for (const s of world.spotsOf(locationId)) for (const { to_spot_id } of world.exitsFrom(s.id)) if (world.spot(to_spot_id).location_id !== locationId) return to_spot_id;
  return null;
}

/** Saltos entre localizaciones por sus salidas (lo cerca que está un sitio de otro); Infinity si no se llega. */
export function locationHops(world: World, from: Id, to: Id): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; frontier.length && d < 50; d++) {
    const next: Id[] = [];
    for (const loc of frontier) for (const s of world.spotsOf(loc)) for (const { to_spot_id } of world.exitsFrom(s.id)) {
      const l = world.spot(to_spot_id).location_id;
      if (l === to) return d;
      if (!seen.has(l)) { seen.add(l); next.push(l); }
    }
    frontier = next;
  }
  return Infinity;
}

/** La autoridad más cercana que aún no lo sabe (para ir a avisarla). */
function nearestUninformedEnforcer(world: World, i: Incident, from: Spot): Npc | null {
  const known = new Set(i.knowers.map((k) => k.npc_id));
  const cands = enforcerIds(world).map((id) => world.npcs.get(id)!).filter((e) => e && e.status === 'alive' && !known.has(e.id));
  const d = (e: Npc) => locationHops(world, from.location_id, world.spot(e.location.id).location_id);
  return cands.sort((a, b) => d(a) - d(b))[0] ?? null;
}

/** Añade (o actualiza, si sube la gravedad) lo que sabe un NPC, y lo aplica. */
function learn(world: World, i: Incident, n: Npc, how: Knower['how'], from: Id | null, nowG: number): Knower {
  const authorityKnows = i.knowers.some((k) => k.role === 'authority');
  const alertTaken = i.knowers.some((k) => k.response === 'alert' && k.npc_id !== n.id);
  const r = reactionOf(world, n, i, how, alertTaken, authorityKnows);
  const prev = i.knowers.find((k) => k.npc_id === n.id);
  const k: Knower = { npc_id: n.id, how: prev?.how === 'saw' ? 'saw' : how, from: prev?.from ?? from, ...r, game_s: nowG };
  if (k.response === 'alert') {
    // Si ya iba a avisar a alguien, sigue con lo suyo (no se le da otra orden).
    if (prev?.response === 'alert' && prev.to) { Object.assign(prev, { ...k, to: prev.to }); return prev; }
    const to = nearestUninformedEnforcer(world, i, world.spot(i.spot_id));
    if (to) k.to = to.id; else k.response = 'shout';
  }
  if (prev) Object.assign(prev, k); else i.knowers.push(k);
  applyKnower(world, i, n, prev ?? k, nowG);
  return prev ?? k;
}

// ---------------------------------------------------------------------------
// Consecuencias sobre el autor
// ---------------------------------------------------------------------------

const WANTED_CONDITION = 'buscado';
export const JAILED_CONDITION = 'preso';

function setCondition(c: Character, name: string, source: string, expires: number | null): void {
  const cur = c.conditions.find((x) => x.name === name);
  if (cur) { cur.source = source; cur.expires_game_s = expires; } else c.conditions.push({ name, source, expires_game_s: expires });
}

function dropCondition(c: Character, name: string): void { c.conditions = c.conditions.filter((x) => x.name !== name); }

/** Lo que el autor sufre por un incidente: reputación, infamia, buscado y rumor. Idempotente. */
function applyConsequences(world: World, i: Incident, nowG: number): void {
  const c = world.characters.get(i.perpetrator_id);
  if (!c) return;
  const known = i.knowers.length > 0 || i.crowd !== null;
  // Reputación con la facción del pueblo: lo que se sabe, se paga.
  const fid = lawOf(world).faction_id ?? null;
  if (known && fid && i.rep_applied < i.severity) {
    c.reputation[fid] = (c.reputation[fid] ?? 0) - (i.severity - i.rep_applied);
    i.rep_applied = i.severity;
  }
  // Infamia: matar a quien no era hostil o profanar un cuerpo (en vez de PX).
  const infamy = i.kind === 'murder' || i.kind === 'desecration' ? 1 : 0;
  if (infamy > i.infamy_applied) { c.infamy = (c.infamy ?? 0) + infamy - i.infamy_applied; i.infamy_applied = infamy; }
  // Buscado: en cuanto la autoridad lo sabe.
  if (i.severity >= 2 && i.status === 'open' && i.knowers.some((k) => k.role === 'authority')) markWanted(world, c, i, nowG);
  // Rumor en el sitio: lo que se cuenta de boca en boca.
  if (known && i.severity >= 2) spreadRumor(world, i, i.location_id, nowG);
  world.touch('characters', c.id);
}

/** «la barra (Taberna del Jabalí)»: el punto lleva su artículo; la localización, entre paréntesis. */
function where(world: World, i: Incident): string {
  const loc = world.locations.get(i.location_id)?.name;
  const spot = world.spots.get(i.spot_id)?.name;
  return spot && loc ? `${spot} (${loc})` : loc ?? spot ?? 'el pueblo';
}

function markWanted(world: World, c: Character, i: Incident, nowG: number): void {
  const w: Wanted = c.wanted ?? { since_game_s: nowG, incident_ids: [], reason: '', last_seen: null, arrest: null };
  if (!w.incident_ids.includes(i.id)) w.incident_ids.push(i.id);
  const worst = w.incident_ids.map((id) => incidentById(world, id)).filter((x): x is Incident => Boolean(x)).sort((a, b) => b.severity - a.severity)[0] ?? i;
  w.reason = `${deedText(worst)} en ${where(world, worst)}`;
  c.wanted = w;
  setCondition(c, WANTED_CONDITION, w.reason, null);
}

function rumorName(i: Incident): string {
  const v = i.victim_name ?? 'alguien';
  switch (i.kind) {
    case 'murder': return `la muerte ${del_(v)}`;
    case 'desecration': return `el cadáver ${del_(v)}`;
    case 'theft': return `el robo ${al(v)}`;
    default: return `lo que le hicieron ${al(v)}`;
  }
}

/** Pone (o refresca) el rumor del incidente en una localización. */
function spreadRumor(world: World, i: Incident, locationId: Id, nowG: number): void {
  const camp = world.campaign as typeof world.campaign & { rumors?: Rumor[] };
  camp.rumors ??= [];
  const id = `rm_${i.id}_${locationId}`;
  const hint = `dicen que ${i.perpetrator_name} ${deedText(i)} en ${where(world, i)}.`;
  const cur = camp.rumors.find((r) => r.id === id);
  if (cur) { if (cur.hint !== hint) { cur.hint = hint; cur.name = rumorName(i); touchCampaign(world); } return; }
  camp.rumors.push({
    id, kind: 'rumor', name: rumorName(i), hint, where: world.locations.get(i.location_id)?.name ?? null, said_by: null, location_id: locationId, status: 'open', mentions: 1,
    origin: { actor_id: 'mundo', game_s: nowG, location_id: i.location_id, action: null }, expires_game_s: nowG + NEWS_S, thread: null,
  });
  touchCampaign(world);
}

// ---------------------------------------------------------------------------
// Alta de un incidente
// ---------------------------------------------------------------------------

/**
 * Registra un incidente (o sube de gravedad el que ya hay del mismo autor
 * contra la misma víctima) y aplica todo en el acto: testigos, reacciones,
 * órdenes, reputación, buscado y rumor. Devuelve el incidente, o null si no
 * hay a quién atribuirlo o si es menos grave que el que ya consta.
 */
export function reportIncident(world: World, input: IncidentInput, nowG: number): Incident | null {
  const c = world.characters.get(input.perpetrator_id);
  if (!c) return null;
  const spot = input.spot_id ? world.spots.get(input.spot_id) ?? null : world.characterSpot(c);
  if (!spot) return null;
  const victim = input.victim_id ? world.npcs.get(input.victim_id) ?? null : null;
  const sev = SEVERITY[input.kind];
  const all = store(world);
  // La violencia sube por escalones (agresión → con arma → muerte) dentro del mismo incidente; robar o profanar es otro.
  const ladder = (k: IncidentKind) => (VIOLENT.includes(k) ? 'violence' : k);
  let i = all.find((x) => x.status === 'open' && x.perpetrator_id === c.id && victim !== null && x.victim_id === victim.id && ladder(x.kind) === ladder(input.kind) && nowG - x.updated_game_s < ESCALATE_S);
  if (i && sev <= i.severity) return null;
  if (i) {
    i.kind = input.kind; i.severity = sev; i.updated_game_s = nowG; i.spot_id = spot.id; i.location_id = spot.location_id;
    if (input.weapon) i.weapon = input.weapon;
    i.narrated_to = [];
  } else {
    i = {
      id: `inc_${Math.round(nowG).toString(36)}_${all.length.toString(36)}`, kind: input.kind, severity: sev, game_s: nowG, updated_game_s: nowG,
      location_id: spot.location_id, spot_id: spot.id, perpetrator_id: c.id, perpetrator_name: c.name,
      victim_id: victim?.id ?? null, victim_name: victim?.name ?? null, weapon: input.weapon ?? null, crowd: null,
      knowers: [], announced: 0, narrated_to: [], crowd_alert_game_s: null, rep_applied: 0, infamy_applied: 0, status: 'open',
    };
    all.push(i);
  }
  i.crowd = crowdHere(world, spot.location_id, nowG) ?? i.crowd;
  // Quien lo ve, en este orden: víctima, autoridad, allegados, dueños, el resto (así el primero que puede, corre a avisar).
  const seen = witnessesAt(world, spot, input.kind, [c.id]);
  if (victim && victim.status === 'alive' && !seen.includes(victim)) seen.unshift(victim);
  const order: CrimeRole[] = ['victim', 'authority', 'kin', 'owner', 'commoner'];
  seen.sort((a, b) => order.indexOf(roleOf(world, a, i!)) - order.indexOf(roleOf(world, b, i!)));
  for (const n of seen) learn(world, i, n, 'saw', null, nowG);
  // Sin autoridad que lo sepa y con gente en la sala: alguien acabará avisando.
  if (i.severity >= 2 && i.crowd && !i.knowers.some((k) => k.role === 'authority' || k.response === 'alert')) i.crowd_alert_game_s ??= nowG + CROWD_ALERT_S;
  applyConsequences(world, i, nowG);
  // Quien está delante cuando la autoridad lo ve: le dan el alto ya.
  checkArrest(world, c, nowG);
  touchCampaign(world);
  return i;
}

/**
 * ¿Es el PJ el agresor contra ese NPC? Sí si atacarle ahora es un crimen: el
 * NPC no era hostil con él. Lo llama el combate antes de aplicar el golpe.
 */
export function isUnprovoked(n: Npc, characterId: Id): boolean {
  return (n.attitude.by_character[characterId] ?? n.attitude.default) !== 'hostile';
}

/** Un PJ golpea a un NPC que no era hostil: agresión (con arma si la lleva). */
export function reportAssault(world: World, c: Character, n: Npc, weapon: string | null, nowG: number): Incident | null {
  if (!isUnprovoked(n, c.id) && !store(world).some((x) => x.status === 'open' && x.perpetrator_id === c.id && x.victim_id === n.id && VIOLENT.includes(x.kind))) return null;
  const armed = weapon !== null && weapon !== 'puños';
  return reportIncident(world, { kind: armed ? 'armed_assault' : 'assault', perpetrator_id: c.id, victim_id: n.id, spot_id: n.location.id, weapon: armed ? weapon : null }, nowG);
}

/** ¿Empezó el PJ la pelea con ese NPC? Hay una agresión suya abierta contra él (y entonces vencerle no da PX). */
export function startedBy(world: World, c: Character, n: Npc, nowG: number): boolean {
  return store(world).some((x) => x.status === 'open' && x.perpetrator_id === c.id && x.victim_id === n.id && VIOLENT.includes(x.kind) && nowG - x.updated_game_s < ESCALATE_S);
}

/**
 * Un PJ ha matado a un NPC. Es una muerte (crimen) si él empezó: hay una
 * agresión suya abierta contra ese NPC. Entonces no da PX, sino infamia.
 * Rematar a quien estaba inconsciente o atado (`helpless`) es una muerte
 * siempre, empezara quien empezara la pelea.
 */
export function reportKill(world: World, c: Character, n: Npc, nowG: number, opts: { helpless?: boolean } = {}): { murder: boolean; incident: Incident | null } {
  const open = store(world).find((x) => x.status === 'open' && x.perpetrator_id === c.id && x.victim_id === n.id && VIOLENT.includes(x.kind) && nowG - x.updated_game_s < ESCALATE_S);
  // Matar a quien venía a detenerle también es una muerte, aunque ya peleara con él.
  const lawman = isEnforcer(world, n.id) && c.wanted?.arrest?.npc_id === n.id;
  if (!open && !lawman && !opts.helpless) return { murder: false, incident: null };
  const i = reportIncident(world, { kind: 'murder', perpetrator_id: c.id, victim_id: n.id, spot_id: n.location.id }, nowG) ?? open ?? null;
  return { murder: true, incident: i };
}

// ---------------------------------------------------------------------------
// La noticia corre
// ---------------------------------------------------------------------------

/**
 * Lo que corre de boca en boca, sin IA: quien llega al sitio mientras se ve
 * lo que ha pasado se entera; quien coincide en una localización con alguien
 * que lo sabe, también (las rutinas y la agenda los cruzan); y si nadie fue a
 * avisar a la autoridad, la gente del sitio acaba haciéndolo.
 */
export function spreadNews(world: World, nowG: number): void {
  for (const i of store(world)) {
    if (i.status !== 'open' || i.severity < 2 || nowG - i.game_s > NEWS_S) continue;
    const before = i.knowers.length;
    const known = () => new Set(i.knowers.map((k) => k.npc_id));
    // El sitio: la sangre, el cuerpo de la víctima.
    const victim = i.victim_id ? world.npcs.get(i.victim_id) : undefined;
    const bodyHere = victim?.status === 'dead' && world.spots.get(victim.location.id)?.location_id === i.location_id;
    if (bodyHere || nowG - i.game_s < FRESH_S) {
      const k = known();
      for (const n of world.npcs.values()) {
        if (n.status !== 'alive' || k.has(n.id) || world.spot(n.location.id).location_id !== i.location_id) continue;
        learn(world, i, n, 'found', null, nowG);
      }
    }
    // Boca a boca: quien coincide con alguien que lo sabe.
    for (let guard = 0; guard < 4; guard++) {
      const k = known();
      let grew = false;
      for (const kn of [...i.knowers]) {
        const teller = world.npcs.get(kn.npc_id);
        if (!teller || teller.status !== 'alive') continue;
        const loc = world.spot(teller.location.id).location_id;
        for (const n of world.npcs.values()) {
          if (n.status !== 'alive' || k.has(n.id) || world.spot(n.location.id).location_id !== loc) continue;
          learn(world, i, n, 'told', teller.id, nowG);
          k.add(n.id); grew = true;
          if (loc !== i.location_id) spreadRumor(world, i, loc, nowG);
        }
      }
      if (!grew) break;
    }
    // La gente sin nombre avisa a la autoridad.
    if (i.crowd_alert_game_s !== null && nowG >= i.crowd_alert_game_s) {
      i.crowd_alert_game_s = null;
      if (!i.knowers.some((k) => k.role === 'authority')) {
        const to = nearestUninformedEnforcer(world, i, world.spot(i.spot_id));
        if (to) learn(world, i, to, 'told', null, nowG);
      }
    }
    if (i.knowers.length !== before) { applyConsequences(world, i, nowG); touchCampaign(world); }
  }
}

// ---------------------------------------------------------------------------
// Detención, calabozo y caza
// ---------------------------------------------------------------------------

/** Incidentes abiertos por los que buscan a este PJ. */
export function wantedIncidents(world: World, c: Character): Incident[] {
  return (c.wanted?.incident_ids ?? []).map((id) => incidentById(world, id)).filter((x): x is Incident => Boolean(x) && x!.status === 'open');
}

/** Autoridades vivas que saben de algo de lo que busca a este PJ. */
function authoritiesWhoKnow(world: World, c: Character): Npc[] {
  const ids = new Set(wantedIncidents(world, c).flatMap((i) => i.knowers.filter((k) => k.role === 'authority').map((k) => k.npc_id)));
  return [...ids].map((id) => world.npcs.get(id)).filter((n): n is Npc => Boolean(n) && n!.status === 'alive');
}

/** Si hay delante una autoridad que lo sabe, le da el alto (queda pendiente de anunciar). */
function checkArrest(world: World, c: Character, nowG: number): void {
  if (!c.wanted || c.wanted.arrest || c.jailed || c.status === 'dead' || c.status === 'retired' || c.transit) return;
  const here = world.characterSpot(c);
  if (!here) return;
  const enf = authoritiesWhoKnow(world, c).find((n) => world.spot(n.location.id).location_id === here.location_id);
  if (!enf) return;
  c.wanted.arrest = { npc_id: enf.id, since_game_s: nowG, announced: false, resisted: false };
  // Se le acerca.
  if (enf.location.id !== here.id) setNpcOrder(world, { npc_id: enf.id, order: 'go', spot_id: here.id, minutes: 30 }, nowG);
  world.touch('characters', c.id);
}

export interface Sentence {
  kind: 'fine' | 'jail';
  /** Monedas pagadas (multa). */
  paid: number;
  /** Calabozo: hasta cuándo (juego) y dónde. */
  until_game_s: number | null;
  spot_id: Id | null;
  /** Quién le detuvo. */
  by: Npc | null;
  reason: string;
}

/** La pena por lo que le buscan: calabozo para lo grave (si hay calabozo) y multa para lo demás. */
function sentenceFor(world: World, c: Character): { kind: 'fine' | 'jail'; fine: number; hours: number } {
  const law = lawOf(world);
  const worst = wantedIncidents(world, c).sort((a, b) => b.severity - a.severity)[0];
  if (!worst) return { kind: 'fine', fine: 0, hours: 0 };
  const hours = law.jail_hours?.[worst.kind] ?? DEFAULT_JAIL_HOURS[worst.kind];
  const fine = law.fines?.[worst.kind] ?? DEFAULT_FINES[worst.kind];
  if (jailSpot(world) && (hours > 0 || c.coins < fine)) return { kind: 'jail', fine: 0, hours: Math.max(hours, 8) };
  return { kind: 'fine', fine, hours: 0 };
}

/** Cierra lo que le buscaba: incidentes saldados, fuera el «buscado», la autoridad deja de ir a por él. */
function settle(world: World, c: Character): void {
  for (const i of wantedIncidents(world, c)) i.status = 'settled';
  for (const n of authoritiesWhoKnow(world, c)) {
    if ((n.attitude.by_character[c.id] ?? n.attitude.default) === 'hostile') n.attitude.by_character[c.id] = 'unfriendly';
    world.touch('npcs', n.id);
  }
  c.wanted = null;
  dropCondition(c, WANTED_CONDITION);
  touchCampaign(world);
  world.touch('characters', c.id);
}

/** Le encierran: al calabozo, con el «preso» hasta que cumpla. `nowC`: la hora del PJ. */
function jail(world: World, c: Character, hours: number, reason: string, nowC: number): { until: number; spot: Spot } | null {
  const spot = jailSpot(world);
  if (!spot) return null;
  const until = nowC + hours * GAME_HOUR;
  c.location = { type: 'spot', id: spot.id };
  c.transit = null;
  c.following = null;
  c.jailed = { until_game_s: until, spot_id: spot.id, reason };
  setCondition(c, JAILED_CONDITION, reason, until);
  world.touch('characters', c.id);
  return { until, spot };
}

/** Se entrega: el motor dicta la pena y la cumple (multa o calabozo). null si no le estaban deteniendo. */
export function surrender(world: World, c: Character, nowG: number, nowC: number = nowG): Sentence | null {
  const w = c.wanted;
  if (!w?.arrest) return null;
  const by = world.npcs.get(w.arrest.npc_id) ?? null;
  const reason = w.reason;
  const s = sentenceFor(world, c);
  if (s.kind === 'jail') {
    const j = jail(world, c, s.hours, reason, nowC);
    if (by && j) setNpcOrder(world, { npc_id: by.id, order: 'go', spot_id: j.spot.id, minutes: 15 }, nowG);
    settle(world, c);
    return { kind: 'jail', paid: 0, until_game_s: j?.until ?? null, spot_id: j?.spot.id ?? null, by, reason };
  }
  const paid = Math.min(c.coins, s.fine);
  c.coins -= paid;
  settle(world, c);
  return { kind: 'fine', paid, until_game_s: null, spot_id: null, by, reason };
}

/**
 * Se resiste: la autoridad que le detiene (y la que lo sepa y esté aquí) pasa a
 * hostil y entra en el combate. El resto de la autoridad acude como apoyo: va
 * hacia él y llega ya hostil (combat.ts la hace pelear en cuanto está en la sala).
 */
export function resist(world: World, c: Character, nowG: number): Npc[] {
  const w = c.wanted;
  if (!w?.arrest) return [];
  w.arrest.resisted = true;
  const spot = world.characterSpot(c);
  const here = spot?.location_id;
  const out = authoritiesWhoKnow(world, c).filter((n) => world.spot(n.location.id).location_id === here);
  for (const n of out) { n.attitude.by_character[c.id] = 'hostile'; world.touch('npcs', n.id); }
  for (const id of enforcerIds(world)) {
    const n = world.npcs.get(id);
    if (!n || !spot || n.status !== 'alive' || n.bound || out.includes(n) || !n.stats) continue;
    if (setNpcOrder(world, { npc_id: n.id, order: 'go', spot_id: spot.id, task: { kind: 'act', text: `viene a ayudar a detener a ${c.name}`, target_id: c.id }, minutes: 30 }, nowG).ok) {
      n.attitude.by_character[c.id] = 'hostile';
      world.touch('npcs', n.id);
    }
  }
  world.touch('characters', c.id);
  return out;
}

export interface LawNotice {
  kind: 'arrest' | 'jailed' | 'released';
  character: Character;
  npc: Npc | null;
  sentence?: Sentence;
}

/**
 * Lo que la ley hace sola en cada asentamiento: corre la noticia, se apunta
 * dónde le han visto, se le da el alto si la autoridad le tiene delante, se le
 * encierra si cae ante ella, se le suelta al cumplir y la autoridad va a donde
 * le vieron por última vez. Devuelve lo que el motor tiene que contar.
 * `nowFor`: la hora de cada PJ (puede ir por delante del mundo).
 */
export function lawTick(world: World, nowG: number, nowFor: (c: Character) => number = () => nowG): LawNotice[] {
  spreadNews(world, nowG);
  const out: LawNotice[] = [];
  for (const c of world.characters.values()) {
    if (c.jailed) {
      if (nowFor(c) >= c.jailed.until_game_s) {
        c.jailed = null;
        dropCondition(c, JAILED_CONDITION);
        world.touch('characters', c.id);
        out.push({ kind: 'released', character: c, npc: null });
      }
      continue;
    }
    const w = c.wanted;
    if (!w || c.status === 'dead' || c.status === 'retired') continue;
    if (!wantedIncidents(world, c).length) { c.wanted = null; dropCondition(c, WANTED_CONDITION); world.touch('characters', c.id); continue; }
    const here = c.transit ? null : world.characterSpot(c);
    if (here) {
      // Alguien que lo sabe le ve aquí: la autoridad sabrá dónde está.
      const knowers = new Set(wantedIncidents(world, c).flatMap((i) => i.knowers.map((k) => k.npc_id)));
      const seen = [...knowers].some((id) => { const n = world.npcs.get(id); return n?.status === 'alive' && world.spot(n.location.id).location_id === here.location_id; });
      if (seen && (w.last_seen?.spot_id !== here.id || nowG - w.last_seen.game_s > GAME_MINUTE * 10)) { w.last_seen = { location_id: here.location_id, spot_id: here.id, game_s: nowG }; world.touch('characters', c.id); }
    }
    // Ha caído delante de quien le detenía: al calabozo.
    if (w.arrest && c.status === 'unconscious' && here) {
      const by = world.npcs.get(w.arrest.npc_id);
      if (by?.status === 'alive' && world.spot(by.location.id).location_id === here.location_id) {
        stabilize(world, c, nowG, by.name, `detenido por ${by.name}`);
        const s = sentenceFor(world, c);
        const reason = w.reason;
        const j = jail(world, c, Math.max(s.hours, 8), reason, nowFor(c));
        if (j) {
          setNpcOrder(world, { npc_id: by.id, order: 'go', spot_id: j.spot.id, minutes: 15 }, nowG);
          settle(world, c);
          out.push({ kind: 'jailed', character: c, npc: by, sentence: { kind: 'jail', paid: 0, until_game_s: j.until, spot_id: j.spot.id, by, reason } });
        }
        continue;
      }
    }
    if (c.status !== 'active') continue;
    checkArrest(world, c, nowG);
    if (c.wanted?.arrest && !c.wanted.arrest.announced) {
      c.wanted.arrest.announced = true;
      world.touch('characters', c.id);
      out.push({ kind: 'arrest', character: c, npc: world.npcs.get(c.wanted.arrest.npc_id) ?? null });
      continue;
    }
    // Si se ha ido de delante de quien le detenía, la detención queda en el aire (le siguen buscando).
    if (c.wanted?.arrest && here) {
      const by = world.npcs.get(c.wanted.arrest.npc_id);
      if (!by || by.status !== 'alive' || world.spot(by.location.id).location_id !== here.location_id) { c.wanted.arrest = null; world.touch('characters', c.id); }
    }
    hunt(world, c, nowG);
  }
  return out;
}

/** La autoridad que lo sabe va a donde le vieron por última vez (una sola, la más cercana). */
function hunt(world: World, c: Character, nowG: number): void {
  const w = c.wanted;
  if (!w?.last_seen || w.arrest || nowG - w.last_seen.game_s > SEEN_S) return;
  const target = world.spots.get(w.last_seen.spot_id);
  if (!target) return;
  const auth = authoritiesWhoKnow(world, c);
  if (!auth.length) return;
  const d = (n: Npc) => locationHops(world, world.spot(n.location.id).location_id, target.location_id);
  const hunter = (w.hunter_id ? auth.find((n) => n.id === w.hunter_id) : undefined) ?? auth.sort((a, b) => d(a) - d(b))[0]!;
  if (world.spot(hunter.location.id).location_id === target.location_id) return;
  const o = orderOf(hunter);
  if (o && (o.kind === 'go' || o.kind === 'stay') && o.spot_id === target.id) return;
  if (setNpcOrder(world, { npc_id: hunter.id, order: 'go', spot_id: target.id, minutes: 60 }, nowG).ok) { w.hunter_id = hunter.id; world.touch('characters', c.id); }
}

// ---------------------------------------------------------------------------
// Lo que el mundo ya no hace por el autor
// ---------------------------------------------------------------------------

/** Si ese NPC se niega a tratar (vender, comprar, alojar) con el PJ, por qué; si no, null. */
export function refusesService(world: World, n: Npc, c: Character): string | null {
  const k = knownBy(world, n.id, c.id);
  if (k && k.incident.severity >= 2 && (k.knower.role === 'owner' || k.incident.severity >= 3 || k.knower.stance !== 'wary')) {
    return `${n.name} no quiere tratos con ${c.name}: sabe que ${deedText(k.incident)}`;
  }
  if ((n.attitude.by_character[c.id] ?? n.attitude.default) === 'hostile') return `${n.name} es hostil con ${c.name}: no le vende ni le compra nada`;
  // Lo que piensa de él (standing.ts): por debajo de un umbral, tampoco.
  return opinionRefusal(n, c);
}

/**
 * ¿Sabe la autoridad dónde está? Si le buscan y alguien que lo sabe le ha
 * visto en esta localización hace poco, no hay descanso seguro: vendrán.
 * Devuelve quién vendrá, o null.
 */
export function lawKnowsWhere(world: World, c: Character, nowG: number): Npc | null {
  const w = c.wanted;
  if (!w || c.jailed || !w.last_seen || nowG - w.last_seen.game_s > SEEN_S) return null;
  if (world.characterSpot(c)?.location_id !== w.last_seen.location_id) return null;
  const auth = authoritiesWhoKnow(world, c);
  return (w.hunter_id ? auth.find((n) => n.id === w.hunter_id) : undefined) ?? auth[0] ?? null;
}

/** En el calabozo: ¿puede moverse? Motivo si no. */
export function jailedReason(c: Character, nowC: number): string | null {
  if (!c.jailed || nowC >= c.jailed.until_game_s) return null;
  return `estás encerrado en el calabozo hasta las ${hhmmOf(c.jailed.until_game_s)} (${c.jailed.reason})`;
}

function hhmmOf(s: number): string {
  const r = ((Math.floor(s) % GAME_DAY) + GAME_DAY) % GAME_DAY;
  return `${Math.floor(r / GAME_HOUR)}:${String(Math.floor((r % GAME_HOUR) / GAME_MINUTE)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Lo que lee el máster
// ---------------------------------------------------------------------------

/** Incidentes del sitio que el máster aún tiene que contarle a este PJ (control de cierre). */
export function pendingIncidents(world: World, c: Character, nowG: number): Incident[] {
  const here = world.characterSpot(c)?.location_id;
  if (!here) return [];
  return store(world).filter((i) => i.severity >= 2 && i.location_id === here && !i.narrated_to.includes(c.id) && nowG - i.updated_game_s < PENDING_S && presentReactors(world, i).length > 0);
}

/** Incidentes recientes del sitio (para el contexto y los ganchos), ya contados o no. */
export function recentIncidents(world: World, locationId: Id, nowG: number, within = 2 * GAME_HOUR): Incident[] {
  return store(world).filter((i) => i.severity >= 2 && i.location_id === locationId && nowG - i.updated_game_s < within);
}

/** Testigos que siguen en el sitio y reaccionan de forma visible. */
export function presentReactors(world: World, i: Incident): { npc: Npc; knower: Knower }[] {
  return i.knowers
    .map((k) => ({ npc: world.npcs.get(k.npc_id)!, knower: k }))
    .filter(({ npc, knower }) => npc && npc.status === 'alive' && knower.how !== 'told' && knower.response !== 'watch' && world.spot(npc.location.id).location_id === i.location_id);
}

/** Cómo llama el lector a un NPC: por su nombre si lo sabe; si no, por lo que se ve («la tabernera»). Sin lector, el nombre. */
function label(world: World, id: Id, reader?: Character | null): string {
  const n = world.npcs.get(id);
  if (!n) return 'alguien';
  return !reader || reader.knows.includes(id) ? n.name : descriptorOf(world, id);
}

/**
 * Cómo reacciona cada uno, en una frase por cabeza. `you`: para el autor
 * (segunda persona). `reader`: a quien se le cuenta (el máster escribe para
 * él), para no soltar nombres que no sabe; sin él, nombres (el evento los
 * enmascara al entregarlo).
 */
export function reactionSentences(world: World, i: Incident, you: boolean, reader?: Character | null): string[] {
  const p = you ? 'ti' : i.perpetrator_name;
  const out: string[] = [];
  const victim = i.victim_id ? label(world, i.victim_id, reader) : 'la víctima';
  for (const k of i.knowers) {
    const n = world.npcs.get(k.npc_id);
    if (!n || k.how === 'told' || n.status !== 'alive') continue;
    const name = cap(label(world, n.id, reader));
    switch (k.response) {
      case 'arrest': out.push(`${name} se planta delante de ${p}: «¡Alto! Quedas detenido.»`); break;
      case 'fight': out.push(`${name} se lanza contra ${p}.`); break;
      case 'alert': out.push(`${name} sale corriendo a avisar ${al(k.to && world.npcs.has(k.to) ? label(world, k.to, reader) : 'la autoridad')}.`); break;
      case 'flee': out.push(`${name} huye de allí.`); break;
      case 'shout': out.push(`${name} grita pidiendo ayuda y se aparta.`); break;
      case 'refuse': out.push(you ? `${name} retrocede sin quitarte ojo: no piensa atenderte.` : `${name} retrocede sin quitarle ojo: no piensa atender a ${p}.`); break;
      case 'mourn': out.push(`${name} se queda junto ${al(victim)}, sin voz.`); break;
      case 'watch': out.push(you ? `${name} no te quita ojo.` : `${name} no le quita ojo a ${p}.`); break;
    }
  }
  if (i.crowd) out.push(`${cap(i.crowd)} gritan y se apartan; alguno sale corriendo por la puerta.`);
  return out;
}

/**
 * El texto del evento `incident`: lo que ve la sala (con nombres: el evento
 * los enmascara para quien no los sabe) y, en segunda persona, el autor (ya
 * con los nombres que él sabe).
 */
export function incidentText(world: World, i: Incident, you: boolean): string {
  const c = world.characters.get(i.perpetrator_id);
  const reader = you ? c ?? null : null;
  const head = you ? `⚖ Te han visto: ${deedYou({ ...i, victim_name: i.victim_id ? label(world, i.victim_id, reader) : i.victim_name })}.` : `⚖ Lo han visto: ${i.perpetrator_name} ${deedText(i)}.`;
  const wanted = you && c?.wanted?.incident_ids.includes(i.id) ? ' Desde ahora te buscan.' : '';
  return `${head} ${reactionSentences(world, i, you, reader).join(' ')}${wanted}`.trim();
}

/** Para el control de cierre: con qué palabras se nombra a cada testigo que reacciona (nombre, rol, cómo le ve el actor). */
export function reactorRefs(world: World, i: Incident): { npc_id: Id; refs: string[]; must: boolean }[] {
  return presentReactors(world, i).map(({ npc, knower }) => ({
    npc_id: npc.id,
    refs: [npc.name, descriptorOf(world, npc.id), ...npc.role.split(/\s+y\s+|,\s*/).map((r) => r.trim())].filter((r) => r.length > 2),
    must: knower.response === 'arrest' || knower.response === 'fight',
  }));
}

const nrm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * ¿Cuenta la narración el incidente? Tiene que nombrar (por nombre o rol) a
 * quien da el alto o se lanza contra él, y al menos a uno de los demás que
 * reaccionan. Devuelve a quién falta nombrar; vacío si está bien.
 */
export function unnarratedReactors(world: World, i: Incident, texts: readonly string[], reader?: Character | null): string[] {
  const t = nrm(texts.join('\n'));
  const named = (refs: string[]) => refs.some((r) => new RegExp(`(^|[^a-zñ])${nrm(r).replace(/^(el|la|los|las) /, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zñ]|$)`).test(t));
  const refs = reactorRefs(world, i);
  const missing = refs.filter((r) => r.must && !named(r.refs));
  if (!missing.length && refs.length && !refs.some((r) => named(r.refs))) missing.push(refs[0]!);
  return missing.map((r) => label(world, r.npc_id, reader));
}

export function incidentRejection(world: World, i: Incident, missing: readonly string[], you: Character): string {
  return `Acaba de pasar algo que el motor ya ha decidido: ${i.perpetrator_id === you.id ? 'el actor' : i.perpetrator_name} ${deedFor(world, i, you)} delante de testigos. Tu narración lo ignora: falta ${missing.join(', ')}. Cuéntalo así, sin contradecirlo (nadie dice que fue un accidente ni sigue como si nada): ${reactionSentences(world, i, i.perpetrator_id === you.id, you).join(' ')} Reescribe log_event.`;
}

function ago(nowG: number, at: number): string {
  const s = Math.max(0, nowG - at);
  return s < 60 ? 'ahora mismo' : `hace ${fmtDuration(s)}`;
}

/**
 * La primera línea de un NPC en el contexto del máster si sabe algo de lo que
 * ha hecho el actor: «LO PRIMERO: vio cómo Leodhin mataba a Hugo hace 10 min
 * y le tiene miedo: no le atiende con normalidad». null si no sabe nada.
 */
export function npcCrimeLine(world: World, n: Npc, c: Character, nowG: number): string | null {
  const k = knownBy(world, n.id, c.id);
  if (!k) return null;
  const i = k.incident;
  const v = i.victim_id ? label(world, i.victim_id, c) : i.victim_name;
  const how = k.knower.how === 'saw' ? `vio cómo ${c.name} ${deedWas({ ...i, victim_name: v })}` : k.knower.how === 'found' ? `llegó y vio lo que había hecho ${c.name}: ${deedFor(world, i, c)}` : `le han contado que ${c.name} ${deedFor(world, i, c)}`;
  return `LO PRIMERO, antes que su carácter: ${how} (${world.spots.get(i.spot_id)?.name ?? 'allí'}, ${ago(nowG, i.updated_game_s)}) y ${STANCE_ES[k.knower.stance]}.${i.status === 'settled' ? ' Ya cumplió por ello, pero no lo olvida.' : ''}`;
}

/** El bloque del contexto: incidentes pendientes de contar (con lo que hace cada uno) y si el actor está buscado o detenido. */
export function crimeContext(world: World, c: Character, nowG: number): string | null {
  const L: string[] = [];
  const pending = pendingIncidents(world, c, nowG);
  for (const i of pending) {
    const who = i.knowers.filter((k) => k.how !== 'told' && world.npcs.has(k.npc_id)).map((k) => `${label(world, k.npc_id, c)} [${k.npc_id}] (${ROLE_ES[k.role]}: ${RESPONSE_ES[k.response]})`);
    L.push([
      `## Incidente pendiente: cuéntalo en esta narración`,
      `${cap(ago(nowG, i.updated_game_s))}, en ${world.spots.get(i.spot_id)?.name ?? 'el sitio'}: ${i.perpetrator_id === c.id ? `${c.name} (el actor)` : i.perpetrator_name} ${deedFor(world, i, c)} (${KIND_ES[i.kind]}, gravedad ${i.severity}). Lo ha decidido el motor y ya está aplicado.`,
      `Testigos: ${[...who, ...(i.crowd ? [`${i.crowd} (gritan, alguno corre a avisar)`] : [])].join('; ') || 'nadie con nombre'}.`,
      `Cuéntalo así (hechos): ${reactionSentences(world, i, i.perpetrator_id === c.id, c).join(' ')}`,
      'Nombra a quien reacciona y no lo contradigas: nadie dice que fue un accidente o «se le paró el corazón», nadie le sirve ni le aloja como si nada, la autoridad no se queda mirando.',
    ].join('\n'));
  }
  const recent = recentIncidents(world, world.characterSpot(c)?.location_id ?? '', nowG).filter((i) => !pending.includes(i));
  if (recent.length) L.push(`## Incidentes recientes aquí (ya contados)\n${recent.map((i) => `- ${ago(nowG, i.updated_game_s)}: ${i.perpetrator_name} ${deedFor(world, i, c)} en ${world.spots.get(i.spot_id)?.name ?? 'el sitio'}. Quien lo sabe sigue reaccionando igual (mira «LO PRIMERO» en cada NPC).`).join('\n')}`);
  const lines: string[] = [];
  if (c.jailed) lines.push(`El actor está PRESO en ${world.spots.get(c.jailed.spot_id)?.name ?? 'el calabozo'} hasta las ${hhmmOf(c.jailed.until_game_s)} (${c.jailed.reason}): no sale de ahí; el servidor le suelta a su hora.`);
  if (c.wanted) {
    lines.push(`El actor está BUSCADO: ${c.wanted.reason}. Quien lo sabe no le vende ni le aloja; no descansa tranquilo donde la autoridad sepa que está.`);
    const a = c.wanted.arrest;
    const by = a ? world.npcs.get(a.npc_id) : null;
    if (a && by) lines.push(a.resisted
      ? `Se ha resistido a ${by.name}: la autoridad es hostil y pelea. Si cae, el servidor le lleva al calabozo.`
      : `${by.name} le está DETENIENDO: si se entrega (botón «Entregarme» o lo dice), el servidor dicta la pena (calabozo o multa); si ataca o huye, se resiste y ${by.name} pelea. No lo resuelvas tú: narra el alto y la tensión.`);
  }
  if ((c.infamy ?? 0) > 0) lines.push(`Infamia del actor: ${c.infamy} (ha matado a quien no era hostil o profanado un cuerpo).`);
  if (lines.length) L.push(`## Ley\n${lines.join('\n')}`);
  return L.length ? L.join('\n\n') : null;
}

// ---------------------------------------------------------------------------
// Lo que el jugador escribe
// ---------------------------------------------------------------------------

const plain = (t: string) => nrm(t).replace(/[«»"“”¡!¿?.,;:]/g, ' ').replace(/\s+/g, ' ').trim();

/** «me entrego», «me rindo», «no me resisto», «suelto el arma». */
export function parseSurrender(text: string): boolean {
  return /^(?:vale[, ]+)?(?:me entrego|entregarme|me rindo|rendirme|no me resisto|me dejo detener|dejo que me detenga\w*|suelto (?:el|mi) (?:arma|baston|espada|cuchillo)|levanto las manos|me voy con (?:el|ella)|vale,? voy)\b/.test(plain(text));
}

/** «me resisto», «resistirme», «no me entrego». */
export function parseResist(text: string): boolean {
  return /^(?:me resisto|resistirme|resistirse|no me entrego|no me rindo|ni hablar)\b/.test(plain(text));
}

const LOOT_VERB = /\b(?:rob\w*|registr\w*|saque\w*|rebusc\w*|despoj\w*|hurg\w*|cache\w*|desvalij\w*|vaci\w*|quit\w*)\b/;
const BODY_WORD = /\b(?:cadaver|cuerpo|muerto|difunto|posesiones|bolsillos|cinturon)\b/;

/** ¿Registra o saquea el cuerpo de un NPC muerto que tiene delante? El muerto, o null. */
export function parseDesecration(world: World, c: Character, text: string): Npc | null {
  const t = plain(text);
  if (!LOOT_VERB.test(t)) return null;
  const here = world.characterSpot(c);
  if (!here) return null;
  const dead = [...world.npcs.values()].filter((n) => n.status === 'dead' && world.spot(n.location.id).location_id === here.location_id);
  for (const n of dead) {
    const refs = [n.name, ...n.role.split(/\s+y\s+|,\s*/)].map(plain).filter((r) => r.length > 2);
    if (refs.some((r) => new RegExp(`(^|[^a-zñ])${r}([^a-zñ]|$)`).test(t)) || (dead.length === 1 && BODY_WORD.test(t))) return n;
  }
  return null;
}

const INSULT = /\b(?:idiota|imbecil|estupid[oa]|tont[oa]|cerd[oa]|zorra|puta|bastard[oa]|cabron\w*|gilipollas|inutil|desgraciad[oa]|malnacid[oa]|escoria|rata|asqueros[oa]|mierda|patan|palurd[oa]|paleto|paleta|vieja bruja|bruja)\b/;

/** ¿Insulta a un NPC que tiene delante? El insultado, o null. `target`: a quien se dirige (si lo sabe el motor). */
export function parseInsult(text: string, target: Npc | null): Npc | null {
  if (!target || target.status !== 'alive') return null;
  return INSULT.test(plain(text)) ? target : null;
}

const STEAL = /\b(?:rob\w*|hurt\w*|birl\w*|mang\w*|sise\w*|afan\w*|arrebat\w*|quitarle|quitarsel\w*|le quito|me lo quedo|me la quedo|le cojo|cojo su|meto la mano en su)\b/;

/** ¿La acción es quitarle algo a alguien («le robo la bolsa»)? */
export function readsAsTheft(text: string | null | undefined): boolean {
  return Boolean(text) && STEAL.test(plain(text!));
}

const VIOLENCE = /\b(?:atac\w*|ataqu\w*|golpe\w*|peg(?:o|ar|arle|arla|arlo)|mat(?:o|ar|arle|arla|arlo)|apunal\w*|acuchill\w*|dispar\w*|hier(?:o|e)|herir\w*|lanz\w*|proyectil|descarga|conjuro|hechizo|empuj\w*|derrib\w*|me lanzo|cargo contra|huy\w*|escap\w*|corro|salgo corriendo)\b/;

/** ¿Lo que escribe es pelear o escapar? Ante un alto, eso es resistirse. */
export function readsAsResisting(text: string): boolean {
  return VIOLENCE.test(plain(text));
}

/** La pena que le espera si se entrega, en palabras: «calabozo hasta mañana a estas horas», «una multa de 300 monedas». */
export function sentencePreview(world: World, c: Character): string {
  const s = sentenceFor(world, c);
  if (s.kind === 'jail') return `${s.hours} h de calabozo`;
  return s.fine ? `una multa de ${s.fine} monedas` : 'una advertencia';
}
