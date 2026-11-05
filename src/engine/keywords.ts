/**
 * Palabras con peso de un texto, para casar sin IA lo que se dice en la charla con
 * una misión o un encargo: sin tildes, sin plurales simples, sin palabras vacías.
 *
 * Los nombres propios del mundo (NPC y lugares) no cuentan: «Lo vio el de la leña
 * en el Soto» no habla del encargo «Leña para la posada» porque comparta «Soto»,
 * ni «Brenna» liga cualquier frase con todo lo que pide Brenna.
 */

import type { World } from './world.js';

const STOP = new Set(['para', 'como', 'desde', 'hasta', 'hacia', 'entre', 'sobre', 'sin', 'con', 'una', 'unos', 'unas', 'del', 'los', 'las', 'que', 'por', 'pero', 'cada', 'este', 'esta', 'esto', 'tras', 'ante', 'antes', 'donde', 'quien', 'quién', 'algo', 'nada', 'nadie', 'alguien', 'todo', 'toda', 'más', 'menos', 'otro', 'otra']);

export const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Palabras con peso de un texto, sin tildes ni plurales simples, para casar textos entre sí. */
export function keywords(s: string, skip?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const w of norm(s).match(/[a-zñ]{4,}/g) ?? []) {
    if (STOP.has(w)) continue;
    const k = w.replace(/(es|s)$/, '').slice(0, 6);
    if (!skip?.has(k)) out.add(k);
  }
  return out;
}

export function shares(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** Cuántas palabras comparten. */
export function sharedCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** Las palabras de los nombres propios del mundo (NPC y lugares), para quitarlas al casar textos. */
export function properNameWords(world: World): Set<string> {
  return keywords([...world.npcs.values(), ...world.locations.values()].map((x) => x.name).join(' '));
}
