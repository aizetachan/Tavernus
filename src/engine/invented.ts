/**
 * Gente inventada (docs/PLAN-NPC-RELLENO.md, «El máster no inventa gente»). En «Humo y ceniza» el máster contestó
 * con «un labrador de manos agrietadas» durante la cena, que no existía, y Brenna mandó a llevar la cena a «Tomás, el
 * de la puerta», cuando el guardia es Doro. Con el relleno, la gente de un sitio existe en los datos: el control del
 * cierre rechaza (una vez) que alguien que no está en los datos hable o que se mande al actor a buscarle.
 *
 * Tres casos, sin IA:
 *   - **habla**: «un/una + oficio» (o «un vecino», «una mujer»…) que contesta, dice o murmura en la narración, y no
 *     hay nadie presente con ese oficio. La multitud puede murmurar como multitud («unos vecinos asienten»): eso vale.
 *   - **remite**: «pregunta a un labrador» (indefinido: alguien de aquí) sin nadie presente con ese oficio, o «pregunta
 *     al alcalde» (definido: alguien concreto) sin nadie en todo el mundo con ese oficio.
 *   - **nombre**: un nombre propio que no sale en ningún dato (ni personas, ni lugares, ni la historia, ni lo que ha
 *     escrito el jugador): «Tomás».
 *
 * El fondo sin cara no se toca: «la sala llena de vecinos», «alguien ríe al fondo», «una mujer de chal mira la puerta».
 */

import type { Character, Npc } from './model.js';
import type { World } from './world.js';
import { TRADES } from './extras.js';
import { ROLES } from '../worldgen/catalog.js';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Palabras de persona que no son oficio: si una de estas habla, es alguien de la multitud con cara. */
const GENERIC = [
  'vecino', 'vecina', 'hombre', 'mujer', 'viejo', 'vieja', 'anciano', 'anciana', 'muchacho', 'muchacha', 'chico', 'chica',
  'joven', 'mozo', 'moza', 'nino', 'nina', 'parroquiano', 'parroquiana', 'cliente', 'campesino', 'campesina', 'labriego',
  'labriega', 'aldeano', 'aldeana', 'paisano', 'paisana', 'tipo', 'feligres', 'feligresa', 'forastero', 'forastera',
  'jornalero', 'jornalera', 'buhonero', 'buhonera', 'mercader', 'soldado', 'guardia', 'carretero', 'carretera', 'pescador',
  'pescadora', 'pastor', 'pastora', 'leñador', 'leñadora', 'hortelano', 'hortelana', 'criado', 'criada', 'mendigo',
  'mendiga', 'borracho', 'borracha', 'cazador', 'cazadora', 'herrero', 'herrera', 'tabernero', 'tabernera', 'molinero',
  'molinera', 'granjero', 'granjera', 'panadero', 'panadera', 'carnicero', 'carnicera', 'sacerdote', 'cura', 'monje',
  'monja', 'alcalde', 'alcaldesa', 'regidor', 'regidora', 'alguacil', 'curandero', 'curandera', 'lavandero', 'lavandera',
];

/** Todas las palabras de persona que el control reconoce: las genéricas, los oficios de relleno y los papeles del generador. */
const PERSON_NOUNS: readonly string[] = [...new Set([
  ...GENERIC,
  ...Object.values(TRADES).flatMap((t) => Object.values(t.label).flatMap((l) => [l!.m, l!.f])),
  ...Object.values(ROLES).map((r) => r.label),
].map((w) => norm(w).split(' ')[0]!).filter((w) => w.length > 2))].sort((a, b) => b.length - a.length);

const NOUN = `(${PERSON_NOUNS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
const SPEECH = /\b(contesta|responde|dice|murmura|susurra|explica|cuenta|grita|replica|comenta|anade|asegura|te habla|pregunta)\b|«/;
const SPEAKS = new RegExp(`\\b(?:un|una)\\s+${NOUN}\\b([^.!?]{0,100})`, 'g');
const ASK_VERB = '(?:pregunt\\w*|habl\\w*|acud\\w*|busc\\w*|consult\\w*|llev\\w*(?:\\s+\\S+){0,4})';
const REFER_SOMEONE = new RegExp(`\\b${ASK_VERB}\\s+(?:a|con|por)\\s+(?:un|una)\\s+${NOUN}\\b`, 'g');
const REFER_THE = new RegExp(`\\b${ASK_VERB}\\s+(?:al|a la|a el|con el|con la|por el|por la)\\s+${NOUN}\\b`, 'g');
/** Un nombre propio que no abre frase: tras una minúscula, una coma o un punto y coma. */
const PROPER = /(?<=[a-záéíóúñü,;:] )([A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,})(?![a-záéíóúñüA-ZÁÉÍÓÚÑ])/g;
/** Palabras con mayúscula que no son nombres de nadie. */
const NOT_NAMES = new Set(['dios', 'senor', 'senora', 'don', 'dona', 'madre', 'padre', 'santo', 'santa', 'virgen', 'usted', 'vuestra', 'vuestro']);

export interface PeopleCheckInput {
  /** Narración y observable del cierre. */
  texts: readonly string[];
  /** Lo que dicen los NPC (lines): para nombres y remisiones. */
  lines: readonly string[];
  suggestions: readonly string[];
  /** Oficios de los NPC del sitio (vivos). */
  presentRoles: readonly string[];
  /** Oficios de todos los NPC vivos del mundo. */
  allRoles: readonly string[];
  /** Nombres propios conocidos (normalizados): personas, lugares, la historia y lo que ha escrito el jugador. */
  vocabulary: ReadonlySet<string>;
}

export interface InventedHit { kind: 'speaks' | 'referral' | 'name'; text: string }

const wordsOf = (roles: readonly string[]) => new Set(roles.flatMap((r) => norm(r).split(/[^a-z0-9ñ]+/)).filter((w) => w.length > 2));

/** Gente que no existe y que habla o a la que se remite al actor. Vacío si todo cuadra. */
export function inventedPeople(i: PeopleCheckInput): InventedHit[] {
  const hits: InventedHit[] = [];
  const here = wordsOf(i.presentRoles);
  const anywhere = wordsOf(i.allRoles);
  const seen = new Set<string>();
  const add = (h: InventedHit) => { const k = `${h.kind}:${h.text}`; if (!seen.has(k)) { seen.add(k); hits.push(h); } };
  for (const raw of i.texts) {
    const t = norm(raw);
    for (const m of t.matchAll(SPEAKS)) if (!here.has(m[1]!) && SPEECH.test(m[2] ?? '')) add({ kind: 'speaks', text: `${m[0]!.split(/\s+/).slice(0, 2).join(' ')}` });
  }
  for (const raw of [...i.texts, ...i.lines, ...i.suggestions]) {
    const t = norm(raw);
    for (const m of t.matchAll(REFER_SOMEONE)) if (!here.has(m[1]!)) add({ kind: 'referral', text: `un ${m[1]}` });
    for (const m of t.matchAll(REFER_THE)) if (!anywhere.has(m[1]!)) add({ kind: 'referral', text: `el ${m[1]}` });
  }
  for (const raw of [...i.texts, ...i.lines, ...i.suggestions]) {
    for (const m of raw.matchAll(PROPER)) {
      const w = norm(m[1]!);
      if (!i.vocabulary.has(w) && !NOT_NAMES.has(w)) add({ kind: 'name', text: m[1]! });
    }
  }
  return hits;
}

/** Los nombres propios que salen en los datos del mundo, normalizados: lo que se puede nombrar sin inventar. */
export function nameVocabulary(world: World, extra: readonly string[] = []): Set<string> {
  const out = new Set<string>();
  const take = (s: unknown) => {
    if (typeof s !== 'string') return;
    for (const m of s.matchAll(/[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}/g)) out.add(norm(m[0]));
  };
  // Todo lo escrito en la campaña (historia, Biblia, rumores, misiones, agenda…), los sitios, la gente y los objetos.
  take(JSON.stringify(world.campaign));
  for (const l of world.locations.values()) { take(l.name); take(l.description_base); }
  for (const s of world.spots.values()) { take(s.name); take(s.description); for (const a of s.aliases) take(a); }
  for (const n of world.npcs.values()) { take(n.name); take(n.description); take(n.motivation); take(n.secret); for (const k of n.knowledge ?? []) take(k.text); }
  // Los PJ, con lo que se sabe de ellos (trasfondo y hechos apuntados: su hermana, su pueblo).
  for (const c of world.characters.values()) take(JSON.stringify(c));
  for (const d of world.itemDefs.values()) take(d.name);
  for (const z of world.zones.values()) take(z.name);
  for (const t of extra) take(t);
  return out;
}

/** Los oficios de los NPC vivos de una localización y de todo el mundo, para `inventedPeople`. */
export function rolesFor(world: World, locationId: string): { presentRoles: string[]; allRoles: string[] } {
  const alive = [...world.npcs.values()].filter((n: Npc) => n.status === 'alive' || n.status === 'unconscious');
  return {
    presentRoles: alive.filter((n) => world.spots.get(n.location.id)?.location_id === locationId).map((n) => n.role),
    allRoles: alive.map((n) => n.role),
  };
}

/** El motivo del rechazo, con quién hay de verdad en el sitio. */
export function inventedRejection(hits: readonly InventedHit[], here: readonly string[]): string {
  const what = hits.map((h) => h.kind === 'name' ? `«${h.text}» (ese nombre no sale en ningún dato)`
    : h.kind === 'speaks' ? `«${h.text}» que habla (aquí no hay nadie así)`
      : `mandar al actor a «${h.text}» (no hay nadie así${h.text.startsWith('un ') ? ' aquí' : ''})`).join('; ');
  return `Gente que no existe: ${what}. Solo existe la gente del contexto. ${here.length ? `Aquí están: ${here.join(', ')}. Usa a uno de ellos (con su ID en lines si habla)` : 'Aquí no hay nadie más'}, o deja que la multitud conteste como multitud, sin cara ni nombre. Reescribe log_event.`;
}

/** Lo que ha escrito el jugador y lo que sabe de sí mismo su PJ: sus nombres no son inventos del máster. */
export function playerWords(c: Character, actionText: string | null | undefined): string[] {
  return [actionText ?? '', c.name, c.backstory ?? ''];
}
