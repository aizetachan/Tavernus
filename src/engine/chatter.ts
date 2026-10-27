/**
 * Comentarios del mundo (bloque I): lo que la gente dice al pasar, sin llamar
 * al máster. «¿Os habéis enterado de lo del herrero?». Hacen sentir vivo el
 * sitio y llevan las noticias: quien está cerca lo oye. Tres tipos, como los
 * «barks» de los juegos de rol:
 *
 *   - `rumor`: lo que ha pasado y corre de boca en boca (una muerte, un perro
 *     que vuelve). Solo lo dice quien lo sabe (worldfacts.ts).
 *   - `reaction`: reacción a lo que ha hecho el PJ; con `about_present`, solo
 *     con él delante («ese es el que trajo al perro de Brenna»).
 *   - `daily`: vida diaria, de los datos de la campaña (`campaign.chatter`).
 *
 * Salen de plantillas con huecos (`{pc}`, `{npc}`, `{npc_role}`, `{place}`…),
 * que ponen los datos: las reglas del mundo (efecto `comment`, worldrules.ts)
 * las abren unos días cuando un hecho cambia algo. Si una tanda no trae
 * plantillas y el motor tiene un escritor barato (`ChatterWriter`, un modelo
 * pequeño), las pide una vez y las guarda; sin él, esa tanda calla.
 *
 * Límites: una frase por localización cada CHATTER_GAP_S, nadie oye dos en
 * menos de LISTENER_GAP_S, cada tanda tiene su máximo al día y nadie oye dos
 * veces la misma frase. El motor las emite como ambiente (evento `chatter`),
 * no como narración: la web las pinta como una línea al margen.
 */

import { GAME_DAY, GAME_HOUR, GAME_MINUTE } from '../clock/clock.js';
import type { Character, Id, Npc } from './model.js';
import { crowdHere } from './schedule.js';
import { factById, knowsFact } from './worldfacts.js';
import type { World } from './world.js';

export type ChatterKind = 'rumor' | 'reaction' | 'daily';

/** Una tanda de comentarios viva: dónde, quién puede decirlos, qué plantillas y hasta cuándo. */
export interface ChatterSet {
  id: Id;
  kind: ChatterKind;
  texts: string[];
  location_ids: Id[];
  /** Quién puede decirlos; null, cualquiera del sitio (que lo sepa, si va de un hecho). */
  npc_ids: Id[] | null;
  /** Hecho del que se habla: solo lo comenta quien lo sabe. */
  fact_id: Id | null;
  /** PJ de quien se habla. */
  about: Id | null;
  /** NPC de quien se habla. */
  subject: Id | null;
  vars: Record<string, string>;
  from_game_s: number;
  until_game_s: number | null;
  per_day: number;
  /** Solo con el PJ de quien se habla delante. */
  about_present?: boolean;
  /** Horas del día en que se oyen (de, a). */
  hours?: [number, number];
  /** Sin plantillas: lo que se le pide al escritor barato (una vez). */
  prompt?: string;
}

/** Vida diaria escrita en los datos de la campaña (`campaign.chatter`). Sin plazo. */
export interface ChatterDef { id: Id; location_ids: Id[]; npc_ids?: Id[]; texts: string[]; hours?: [number, number]; per_day?: number }

/** Lo que se dice: quién, dónde, qué y a quién le llega. */
export interface ChatterLine { set_id: Id; kind: ChatterKind; location_id: Id; spot_id: Id; npc_id: Id | null; text: string; listeners: Id[] }

/** Un modelo barato que escribe plantillas cuando los datos no las traen. Devuelve frases con huecos, o null. */
export type ChatterWriter = (req: { kind: ChatterKind; prompt: string; vars: Record<string, string>; language: string }) => Promise<string[] | null>;

interface ChatterState {
  sets: ChatterSet[];
  said: Record<Id, { day: number; count: number }>;
  last_by_location: Record<Id, number>;
  heard: Record<Id, string[]>;
  last_heard: Record<Id, number>;
}

/** Una frase por localización cada tanto (de juego: unos 7 min reales a ritmo 3). */
export const CHATTER_GAP_S = 20 * GAME_MINUTE;
/** Nadie oye dos comentarios seguidos. */
export const LISTENER_GAP_S = 15 * GAME_MINUTE;
const HEARD_MAX = 400;
const PRIORITY: Record<ChatterKind, number> = { reaction: 0, rumor: 1, daily: 2 };

type ChatterCampaign = { chatter?: ChatterDef[]; chatter_state?: ChatterState };

function stateOf(world: World): ChatterState {
  const camp = world.campaign as typeof world.campaign & ChatterCampaign;
  camp.chatter_state ??= { sets: [], said: {}, last_by_location: {}, heard: {}, last_heard: {} };
  return camp.chatter_state;
}

/** Abre una tanda (o la sustituye si ya hay una con ese id). La llama el efecto `comment` de las reglas. */
export function addChatter(world: World, set: ChatterSet): void {
  const st = stateOf(world);
  st.sets = [...st.sets.filter((s) => s.id !== set.id), set];
  world.touch('campaign', world.campaign.id);
}

export function chatterSets(world: World): readonly ChatterSet[] { return stateOf(world).sets; }

/** Las tandas de vida diaria de los datos, como tandas vivas. */
function dailySets(world: World): ChatterSet[] {
  return ((world.campaign as typeof world.campaign & ChatterCampaign).chatter ?? []).map((d) => ({
    id: `daily:${d.id}`, kind: 'daily' as const, texts: d.texts, location_ids: d.location_ids, npc_ids: d.npc_ids ?? null, fact_id: null, about: null, subject: null,
    vars: {}, from_game_s: 0, until_game_s: null, per_day: d.per_day ?? 2, ...(d.hours ? { hours: d.hours } : {}),
  }));
}

const hourOf = (nowS: number) => Math.floor((nowS % GAME_DAY) / GAME_HOUR);

function inHours(h: [number, number] | undefined, nowS: number): boolean {
  if (!h) return true;
  const x = hourOf(nowS);
  return h[0] <= h[1] ? x >= h[0] && x < h[1] : x >= h[0] || x < h[1];
}

/** «el herrero», «la tabernera». */
function roleOf(n: Npc): string { return /^(el|la|los|las) /.test(n.role) ? n.role : /a$/.test(n.role) ? `la ${n.role}` : `el ${n.role}`; }

/** Cómo llama el que habla al PJ: por su nombre si ha tenido trato con él (lo recuerda, o tiene opinión de él); si no, «el forastero». */
function pcAs(world: World, speaker: Npc | null, pcId: Id | null): string | null {
  const c = pcId ? world.characters.get(pcId) : undefined;
  if (!c) return null;
  const dealt = speaker && (speaker.memory.some((m) => m.character_id === c.id) || (speaker.opinion?.[c.id]?.log.length ?? 0) > 0);
  return dealt ? c.name : 'el forastero';
}

function render(world: World, text: string, set: ChatterSet, speaker: Npc | null): string {
  const vars: Record<string, string> = { ...set.vars };
  const pc = pcAs(world, speaker, set.about);
  if (pc) vars['pc'] = pc;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? (k === 'pc' ? 'el forastero' : k === 'npc' || k === 'npc_role' ? 'alguien' : m)).replace(/^./, (x) => x.toUpperCase());
}

/** Quién puede decirlo ahora: vivo, en el sitio, que hable, sin estar en una charla con un PJ y, si va de un hecho, que lo sepa. */
function speakers(world: World, set: ChatterSet, locationId: Id): Npc[] {
  const fact = set.fact_id ? factById(world, set.fact_id) : null;
  return [...world.npcs.values()].filter((n) => {
    if (n.status !== 'alive' || n.mute || n.talking_to) return false;
    if (world.spots.get(n.location.id)?.location_id !== locationId) return false;
    if (set.npc_ids && !set.npc_ids.includes(n.id)) return false;
    if (fact && set.kind !== 'daily' && !knowsFact(fact, n.id)) return false;
    return true;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function listenersIn(world: World, locationId: Id, nowS: number): Character[] {
  const st = stateOf(world);
  return world.charactersInLocation(locationId).filter((c) => c.status === 'active' && !c.transit && !c.away && c.connected && nowS - (st.last_heard[c.id] ?? -Infinity) >= LISTENER_GAP_S);
}

/**
 * En cada tick (engine.ts): como mucho una frase por localización con
 * jugadores, de la tanda que toca (primero las reacciones, luego los rumores,
 * luego la vida diaria), dicha por alguien que pueda decirla y que ninguno de
 * los que la oyen haya oído antes. Lo que no puede decirse, calla.
 */
export function tickChatter(world: World, nowS: number): ChatterLine[] {
  const st = stateOf(world);
  const day = Math.floor(nowS / GAME_DAY);
  // Lo que ya ha pasado se olvida.
  const live = st.sets.filter((s) => s.until_game_s === null || s.until_game_s > nowS);
  if (live.length !== st.sets.length) { st.sets = live; world.touch('campaign', world.campaign.id); }
  const sets = [...live, ...dailySets(world)].filter((s) => s.from_game_s <= nowS && inHours(s.hours, nowS) && s.texts.length)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.from_game_s - a.from_game_s);
  const out: ChatterLine[] = [];
  const locations = new Set([...world.characters.values()].filter((c) => c.status === 'active' && !c.transit).map((c) => world.characterSpot(c)?.location_id).filter((x): x is Id => Boolean(x)));
  for (const loc of locations) {
    if (nowS - (st.last_by_location[loc] ?? -Infinity) < CHATTER_GAP_S) continue;
    const ears = listenersIn(world, loc, nowS);
    if (!ears.length) continue;
    for (const set of sets) {
      if (!set.location_ids.includes(loc)) continue;
      const said = st.said[set.id];
      if (said && said.day === day && said.count >= set.per_day) continue;
      if (set.about_present && !ears.some((c) => c.id === set.about)) continue;
      const who = speakers(world, set, loc);
      // Sin nadie con nombre, la gente del sitio (si hay) también comenta lo que ya corre, pasada una hora.
      const fact = set.fact_id ? factById(world, set.fact_id) : null;
      const crowd = !set.npc_ids && set.kind !== 'reaction' && crowdHere(world, loc, nowS) && (!fact || nowS - fact.game_s >= GAME_HOUR);
      if (!who.length && !crowd) continue;
      const idx = set.texts.findIndex((_, i) => ears.some((c) => !(st.heard[c.id] ?? []).includes(`${set.id}#${i}`)));
      if (idx < 0) continue;
      const speaker = who.length ? who[(said?.count ?? 0) % who.length]! : null;
      const spot = speaker ? speaker.location.id : world.location(loc).default_spot_id;
      const text = render(world, set.texts[idx]!, set, speaker);
      out.push({ set_id: set.id, kind: set.kind, location_id: loc, spot_id: spot, npc_id: speaker?.id ?? null, text, listeners: ears.map((c) => c.id) });
      for (const c of ears) {
        st.heard[c.id] = [...(st.heard[c.id] ?? []), `${set.id}#${idx}`].slice(-HEARD_MAX);
        st.last_heard[c.id] = nowS;
      }
      st.said[set.id] = { day, count: said && said.day === day ? said.count + 1 : 1 };
      st.last_by_location[loc] = nowS;
      world.touch('campaign', world.campaign.id);
      break;
    }
  }
  return out;
}

/** Tandas sin plantillas que esperan al escritor barato. */
export function setsWanting(world: World): ChatterSet[] {
  return stateOf(world).sets.filter((s) => !s.texts.length && s.prompt);
}

/** Guarda lo que escribió el escritor barato (frases con huecos, sin repetidas). */
export function fillSet(world: World, id: Id, texts: string[]): void {
  const set = stateOf(world).sets.find((s) => s.id === id);
  if (!set) return;
  set.texts = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].slice(0, 6);
  if (!set.texts.length) delete set.prompt;
  world.touch('campaign', world.campaign.id);
}

/** Quién lo dice, como lo conoce el lector: su nombre si lo sabe; si no, su oficio («La tabernera»). */
export function speakerLabel(world: World, npcId: Id | null, readerId: Id | null): string {
  const n = npcId ? world.npcs.get(npcId) : undefined;
  if (!n) return 'Alguien';
  const reader = readerId ? world.characters.get(readerId) : undefined;
  const name = reader && reader.knows.includes(n.id) ? n.name : roleOf(n);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
