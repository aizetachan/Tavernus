/**
 * Lugares inventados en la narración. El máster solo puede contar puntos que
 * existen; cuando el jugador busca uno que no hay («subo al cuarto»), el
 * modelo pequeño tiende a sacárselo de la manga («la puerta de la cocina») y
 * luego a usarlo como si fuera real. Esto lo detecta antes de aceptar el
 * log_event, para pedir que lo reescriba.
 *
 * Conservador a propósito, para no rechazar narraciones buenas:
 *   - Solo mira palabras de un catálogo de lugares de interior y de casa
 *     (cocina, escalera, cuarto, sótano, establo, patio, ventana…), no
 *     cualquier sustantivo.
 *   - Solo cuenta el uso definido o señalado («la cocina», «al patio», «esa
 *     escalera»): «buscas una escalera» no afirma que la haya.
 *   - Salta las frases con negación o búsqueda («no hay cocina», «preguntas
 *     por el sótano»), las citas de diálogo entre «» y lo que la localización
 *     ya nombra en cualquier parte: nombres, alias, tags y descripciones de
 *     sus puntos, objetos y NPCs, sus salidas y los nombres de todas las
 *     localizaciones del mundo.
 *   - Al aire libre no mira las fachadas (ventanas, balcones, tejados): son de
 *     las casas de alrededor, no un sitio al que ir («las ventanas de la plaza
 *     se van apagando», partida del 27-10, seq 39).
 */

import type { Id } from './model.js';
import type { World } from './world.js';

/** Palabra de lugar (sin tildes, singular) → formas que se aceptan como la misma. */
export const PLACE_WORDS: Record<string, string[]> = {
  cocina: ['cocina', 'fogon'],
  escalera: ['escalera', 'escalon', 'peldano'],
  cuarto: ['cuarto', 'habitacion', 'alcoba', 'dormitorio'],
  habitacion: ['habitacion', 'cuarto', 'alcoba', 'dormitorio'],
  alcoba: ['alcoba', 'habitacion', 'cuarto', 'dormitorio'],
  dormitorio: ['dormitorio', 'habitacion', 'cuarto', 'alcoba'],
  sotano: ['sotano', 'trampilla', 'bodega'],
  bodega: ['bodega', 'sotano'],
  trampilla: ['trampilla', 'sotano'],
  establo: ['establo', 'cuadra', 'caballeriza'],
  patio: ['patio'],
  ventana: ['ventana', 'ventanuco', 'vidriera'],
  desvan: ['desvan', 'buhardilla'],
  buhardilla: ['buhardilla', 'desvan'],
  almacen: ['almacen'],
  despensa: ['despensa', 'alacena'],
  trastienda: ['trastienda'],
  granero: ['granero', 'pajar'],
  pajar: ['pajar', 'granero'],
  jardin: ['jardin'],
  huerto: ['huerto'],
  pasillo: ['pasillo', 'corredor'],
  corral: ['corral'],
  azotea: ['azotea', 'tejado'],
  balcon: ['balcon'],
  capilla: ['capilla'],
  cripta: ['cripta'],
};

/** Partes de una fachada: al aire libre se ven en las casas de alrededor. */
const FACADE = new Set(['ventana', 'balcon', 'azotea']);

/** Lo que dice el tag de un punto en palabras (el plano dibuja escaleras en un punto `stairs`). */
const TAG_WORDS: Record<string, string[]> = {
  stairs: ['escalera'], bed: ['cuarto', 'habitacion', 'cama'], trapdoor: ['trampilla', 'sotano'], fireplace: ['chimenea', 'fogon'],
};

const DETERMINER = '(?:el|la|los|las|al|del|su|sus|tu|tus|esa|ese|esas|esos|esta|este|estas|estos|aquel|aquella|aquellos|aquellas)';
const NEGATION = /\b(no|ni|ningun[oa]?|nada|nadie|sin|tampoco|jamas|nunca|falta|faltan)\b/;
const SEARCH = /\b(busc\w*|pregunt\w*|quier\w*|quisier\w*|intent\w*|donde|adonde|existe|habra|habria|haya|si hay|imagin\w*|sueñ\w*|suen\w*|recuerd\w*)\b/;

export const normPlace = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Singular aproximado: «escaleras» → «escalera», «habitaciones» → «habitacion». */
function singular(w: string): string {
  if (w.endsWith('ones')) return w.slice(0, -2);
  if (/(n|l|r)es$/.test(w) && w.length > 5) return w.slice(0, -2);
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

/** Palabras que la localización ya nombra (normalizadas, en singular). */
export function placeVocabulary(world: World, locationId: Id): Set<string> {
  const texts: string[] = [];
  const loc = world.locations.get(locationId);
  if (loc) texts.push(loc.name, loc.description_base);
  for (const l of world.locations.values()) texts.push(l.name);
  for (const sp of world.spotsOf(locationId)) {
    texts.push(sp.name, sp.description, ...sp.aliases, ...sp.tags.flatMap((t) => TAG_WORDS[t] ?? []));
    for (const i of world.itemsIn({ type: 'spot', id: sp.id })) texts.push(world.itemDef(i.item_id).name);
    for (const n of world.npcsAt(sp.id)) texts.push(n.description, n.role);
    for (const { to_spot_id } of world.exitsFrom(sp.id)) {
      const to = world.spot(to_spot_id);
      texts.push(to.name, ...to.aliases, world.locationOfSpot(to_spot_id).name);
    }
  }
  for (const n of world.resourceNodes.values()) if (world.spots.get(n.spot_id)?.location_id === locationId) texts.push(n.name, ...n.aliases);
  const out = new Set<string>();
  for (const w of normPlace(texts.join(' ')).match(/[a-zñ]+/g) ?? []) out.add(singular(w));
  return out;
}

/**
 * Lugares del catálogo que la narración da por existentes en la localización
 * y que no están en sus datos. Vacío si todo encaja. Devuelve las palabras
 * tal como aparecen («la cocina»).
 */
export function inventedPlaces(world: World, locationId: Id, text: string): string[] {
  const vocab = placeVocabulary(world, locationId);
  const outdoor = world.locations.get(locationId)?.indoor === false;
  const words = Object.keys(PLACE_WORDS).filter((w) => !(outdoor && FACADE.has(w)) && !PLACE_WORDS[w]!.some((f) => vocab.has(f)));
  if (!words.length) return [];
  const re = new RegExp(`\\b${DETERMINER}\\s+(${words.join('|')})(?:s|es)?\\b`, 'g');
  const found = new Set<string>();
  const plain = normPlace(text).replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' ');
  for (const clause of plain.split(/[.;:!?¿¡…\n()—]+/)) {
    if (NEGATION.test(clause) || SEARCH.test(clause)) continue;
    for (const m of clause.matchAll(re)) found.add(m[0]!.trim());
  }
  return [...found];
}
