/**
 * Interacción entre jugadores de una misma partida (docs/MULTIJUGADOR.md,
 * «Entre jugadores»). Lo que aquí se decide no pasa por el máster:
 *
 *   - Decir: la frase literal del PJ, al instante y sin tokens. Llega por el
 *     oído: quien la oye bien la recibe literal; quien oye poco, un murmullo.
 *   - Ofrecer: dar un objeto o monedas a otro PJ es una oferta que el otro
 *     acepta o rechaza; al aceptar, la transferencia es atómica.
 *   - Seguir: el seguidor se mueve con el líder en cada desplazamiento.
 *   - Ayudar: ventaja en la siguiente tirada del ayudado (regla de ayuda del SRD).
 *   - Segunda persona: el texto que nombra al lector se le da como «a ti».
 *
 * Funciones puras sobre el mundo; el motor (engine.ts) emite los eventos.
 */

import type { Character, Id, Offer } from './model.js';
import { normalize } from './aliases.js';
import { descriptorOf } from './narrate.js';
import { RACE_WORDS, recentDone, type DoneEvent, type OtherPc } from './closecheck.js';
import type { World } from './world.js';

/** Lo que dura una oferta sin respuesta (minutos reales). */
export const OFFER_TTL_MS = 5 * 60 * 1000;
/** Lo que dura la ayuda si el ayudado no tira (segundos de juego). */
export const HELP_TTL_S = 10 * 60;

// ---------------------------------------------------------------------------
// Decir
// ---------------------------------------------------------------------------

export type SayMode = 'say' | 'shout' | 'whisper';
export interface SayIntent { text: string; mode: SayMode; to: string | null }

/** Volumen de cada forma de decir (events.ts: 1 conversación, 0.15 susurro, 5 grito). */
export const SAY_LOUDNESS: Record<SayMode, number> = { say: 1, shout: 5, whisper: 0.15 };

/**
 * ¿Es una frase dicha? Empieza por raya o comillas («— Hola», «"Hola"», «¡Hola!»
 * no). Admite un destinatario delante: «— a Aren: ¿vienes?». Con `forced`
 * (el modo Decir de la web) todo el texto es la frase. null si no lo es.
 */
export function parseSay(raw: string, forced = false): SayIntent | null {
  let t = raw.trim();
  const quoted = /^[—–-]\s*|^[«"“]/.exec(t);
  if (!quoted && !forced) return null;
  if (quoted) t = t.slice(quoted[0].length).trim().replace(/[»"”]\s*$/, '').trim();
  let mode: SayMode = 'say';
  const how = /^\((susurr\w*|grit\w*)\)\s*/i.exec(t);
  if (how) { mode = /^s/i.test(how[1]!) ? 'whisper' : 'shout'; t = t.slice(how[0].length); }
  let to: string | null = null;
  const dest = /^(?:a|para)\s+([^:]{1,40}):\s*/i.exec(t);
  if (dest) { to = dest[1]!.trim(); t = t.slice(dest[0].length); }
  t = t.replace(/^[«"“]\s*|\s*[»"”]$/g, '').trim().slice(0, 600);
  return t ? { text: t, mode, to } : null;
}

/** Infinitivos de acción (con su pronombre: «darle», «acercarme»): así se escribe lo que se manda al narrador. */
const ACTION_VERB = '(?:dar|ir|coger|tomar|atacar|golpear|pegar|pagar|comprar|vender|mirar|examinar|buscar|registrar|abrir|cerrar|entrar|salir|subir|bajar|hablar|preguntar|pedir|entregar|robar|lanzar|beber|sentar|acercar|curar|ayudar|seguir|esperar|descansar|dormir|cargar|llevar|levantar|empujar|saltar|correr|huir|esconder|escuchar|leer|usar|equipar|guardar|sacar|llenar|ofrecer|ensenar|mostrar|empenar|disparar|defender|estabilizar|abrazar|agarrar|soltar|tirar|echar|recoger|cambiar|devolver)(?:le|la|lo|les|las|los|me|te|se|nos)?';
/** «le doy», «cojo», «me acerco»: primera persona de una acción, no algo que se dice. */
const ACTION_FIRST = '(?:(?:le|la|lo|les|las|los|me) )?(?:doy|cojo|ataco|golpeo|pago|compro|busco|abro|entrego|robo|lanzo|bebo|acerco|siento|saco|guardo|registro)';
const LOOKS_LIKE_ACTION = new RegExp(`^(?:${ACTION_VERB}|(?:voy|vamos) a? ?${ACTION_VERB}|${ACTION_FIRST})\\b`);

/**
 * En el modo Decir de la web todo lo escrito sale como frase dicha. Si se le
 * ha quedado puesto y lo escrito es una acción («dar mis monedas», «vamos
 * hablar con la tabernera»), no se dice: va al narrador. Lo que lleva comillas
 * o raya, pregunta o exclama, se dice tal cual.
 */
export function sayLooksLikeAction(raw: string): boolean {
  const t = raw.trim();
  if (!t || /^[—–«"“-]/.test(t) || /[¿?¡!]/.test(t)) return false;
  return LOOKS_LIKE_ACTION.test(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

// ---------------------------------------------------------------------------
// Quién es quién
// ---------------------------------------------------------------------------

/** El nombre de otro PJ para un lector: los PJ de una partida se conocen siempre por su nombre (presentarse es solo para NPC). */
export function pcName(_world: World, _readerId: Id, other: Character): string {
  return other.name;
}

/** Lo mismo con mayúscula, para la cabecera de un parlamento. */
export function pcLabel(world: World, readerId: Id, other: Character): string {
  const n = pcName(world, readerId, other);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Formas de nombrar a un PJ en una narración: nombre, descriptor, raza y clase. */
export function pcRefs(world: World, c: Character): string[] {
  return [c.name, descriptorOf(world, c.id), ...(RACE_WORDS[c.race_id] ?? [c.race]), c.class_name].filter(Boolean);
}

/** Otro PJ presente (el actor lo nombra), por nombre o por cómo se ve, sin ambigüedad. */
export function findPresentPc(world: World, actor: Character, query: string): Character | null {
  const q = normalize(query.replace(/^(?:a|al|con|del|de)\s+/i, ''));
  if (!q) return null;
  const here = world.characterSpot(actor)?.location_id;
  const cands = [...world.characters.values()].filter((o) => o.id !== actor.id && o.status !== 'dead' && o.status !== 'retired' && world.characterSpot(o)?.location_id === here);
  const exact = cands.filter((o) => normalize(o.name) === q || normalize(descriptorOf(world, o.id)) === q);
  if (exact.length === 1) return exact[0]!;
  const words = q.split(' ').filter((w) => w.length > 2 && !['con', 'pinta', 'una', 'uno'].includes(w));
  const loose = cands.filter((o) => words.length > 0 && words.every((w) => pcRefs(world, o).some((r) => normalize(r).split(' ').includes(w))));
  return loose.length === 1 ? loose[0]! : null;
}

/** Los demás PJ que el actor percibe en su localización, con lo que consta que han hecho (para closecheck.ts). */
export function othersForCheck(world: World, events: readonly DoneEvent[], actor: Character): OtherPc[] {
  const here = world.characterSpot(actor)?.location_id;
  const out: OtherPc[] = [];
  for (const o of world.characters.values()) {
    if (o.id === actor.id || o.status === 'dead' || o.status === 'retired' || world.characterSpot(o)?.location_id !== here) continue;
    out.push({ id: o.id, label: pcName(world, actor.id, o), refs: pcRefs(world, o), ...recentDone(events, actor.id, { id: o.id, name: o.name }) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Segunda persona para quien es nombrado
// ---------------------------------------------------------------------------

/** Verbos que con «a X» piden «te»: «mira a Aren» → «te mira». */
const TE_VERBS = 'dice|pregunta|responde|contesta|grita|susurra|murmura|cuenta|explica|pide|ofrece|mira|observa|saluda|empuja|ayuda|sigue|llama|señala|abraza|golpea|ataca|agarra|toca|espera|busca|interrumpe|escucha|aparta|sujeta|detiene|despierta|cura|apunta|vigila';

/**
 * El texto que nombra al lector, en segunda persona para él: «se acerca a
 * Aren» → «se acerca a ti», «mira a Aren» → «te mira», «con Aren» →
 * «contigo», «la mano de Aren» → «tu mano». Lo citado entre «» no se toca
 * (son palabras de alguien). Donde no hay preposición se deja el nombre.
 */
export function secondPerson(text: string, name: string): string {
  if (!name || !text.includes(name)) return text;
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split(/(«[^»]*»)/).map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(new RegExp(`\\b(${TE_VERBS}) a ${n}\\b`, 'g'), 'te $1')
      .replace(new RegExp(`\\b(?:el|la) (\\p{L}+) de ${n}\\b`, 'gu'), 'tu $1')
      .replace(new RegExp(`\\b(?:los|las) (\\p{L}+) de ${n}\\b`, 'gu'), 'tus $1')
      .replace(new RegExp(`\\bcon ${n}\\b`, 'g'), 'contigo')
      .replace(new RegExp(`\\b(a|de|para|hacia|hasta|sobre|ante|tras|sin|por|entre) ${n}\\b`, 'g'), '$1 ti')
      .replace(new RegExp(`\\b([Aa])l lado de ti\\b`, 'g'), '$1 tu lado');
  }).join('');
}

// ---------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------

/** Lo que pide el actor al dar algo a otro PJ: «dar la daga a Aren», «darle 20 monedas a Aren». */
export interface GiveIntent { what: string; to: string }
const GIVE = /^(?:dar|darle|doy|le doy|entregar|entregarle|entrego|le entrego|ofrecer|ofrecerle|ofrezco|le ofrezco|pasar|pasarle|le paso|prestar|prestarle|le presto)\s+(.+?)\s+(?:a|al)\s+([^,.;]+?)[.!]?$/i;

export function parseGive(text: string): GiveIntent | null {
  const m = GIVE.exec(text.trim());
  return m ? { what: m[1]!.trim(), to: m[2]!.trim() } : null;
}

/** Monedas en «20 monedas», «veinte monedas», «unas 50 monedas de cobre». null si no habla de monedas. */
export function coinsIn(what: string): number | null {
  const m = /(\d+)\s*(?:monedas?|mo|piezas?)\b/i.exec(what);
  return m ? Number(m[1]) : null;
}

/** Ofertas vivas que alguien ha recibido. */
export function offersOf(c: Character, nowMs: number): Offer[] {
  return (c.offers ?? []).filter((o) => o.expires_real_ms > nowMs);
}

/** Busca una oferta por id entre las de todos (la recibe un PJ). */
export function findOffer(world: World, offerId: Id): { offer: Offer; to: Character } | null {
  for (const c of world.characters.values()) {
    const o = c.offers?.find((x) => x.id === offerId);
    if (o) return { offer: o, to: c };
  }
  return null;
}

export function dropOffer(world: World, to: Character, offerId: Id): void {
  to.offers = (to.offers ?? []).filter((o) => o.id !== offerId);
  if (!to.offers.length) delete to.offers;
  world.touch('characters', to.id);
}

// ---------------------------------------------------------------------------
// Seguir y ayudar: verbos
// ---------------------------------------------------------------------------

export type PartyIntent =
  | { kind: 'follow'; who: string }
  | { kind: 'unfollow' }
  | { kind: 'help'; who: string }
  | { kind: 'talk'; who: string };

/**
 * «seguir a Aren», «dejar de seguir», «ayudar a Aren» y «hablar con Aren»
 * (sin frase: es intención, no algo dicho). Solo la frase entera; con más
 * cosas («ayudar a Aren a levantar la viga») va al máster.
 */
export function parseParty(text: string): PartyIntent | null {
  const t = text.trim().replace(/[.!]+$/, '').trim();
  if (/^(?:dejar de seguir(?:le)?|dejo de seguir(?:le)?|deja de seguir)(?:\s+a\s+.+)?$/i.test(t)) return { kind: 'unfollow' };
  let m = /^(?:seguir|sigo|seguirle|le sigo|ir detr[aá]s de|voy detr[aá]s de)\s+(?:a\s+)?(.+)$/i.exec(t);
  if (m) return { kind: 'follow', who: m[1]! };
  m = /^(?:ayudar|ayudo|ayudarle|le ayudo|echar una mano)\s+(?:a\s+)?([^,]+)$/i.exec(t);
  if (m && !/\s(?:a|con|en)\s/i.test(m[1]!)) return { kind: 'help', who: m[1]! };
  m = /^(?:hablar|hablo|hablarle|le hablo|charlar|dirigirme|dirigirse|me dirijo)\s+(?:con|a)\s+([^,]+)$/i.exec(t);
  if (m) return { kind: 'talk', who: m[1]! };
  return null;
}
