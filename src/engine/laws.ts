/**
 * Leyes del mundo: lo que en esta campaña no puede pasar por mucho que el
 * jugador lo pida. El máster las lee en el system prompt para distinguir lo
 * imposible (se rechaza en ficción, con ingenio) de lo posible que aún no
 * existe (se trata con curiosidad y, si acaso, se siembra como rumor).
 *
 * Se guardan en la campaña como propiedad opcional (`campaign.laws`, lista de
 * frases), sin tocar el modelo. Sin ella valen las de fantasía SRD de abajo.
 */

import type { Campaign } from './model.js';

export const DEFAULT_LAWS: readonly string[] = [
  'Nadie vuela por sí mismo: hace falta un conjuro, un objeto mágico de verdad o una criatura que vuele.',
  'No hay tecnología moderna: ni pólvora, ni motores, ni electricidad; hierro, madera, cuerda y fuego.',
  'La magia es rara: la lanza quien sabe y tiene el conjuro, y un objeto solo hace lo que es; un disfraz es un disfraz.',
  'Nada sale de la nada: lo que el personaje no lleva encima ni está en el mundo no aparece en sus manos.',
  'El cuerpo tiene límites: la fuerza, la velocidad y el aguante son los de la ficha; los prodigios piden tirada y pueden fallar.',
  'Los muertos no vuelven ni las heridas se cierran solas: descanso, vendas o magia, y lleva tiempo.',
];

/** Leyes de la campaña: `campaign.laws` si trae alguna; si no, las de fantasía SRD. */
export function worldLaws(c: Campaign): readonly string[] {
  const laws = (c as Campaign & { laws?: unknown }).laws;
  const own = Array.isArray(laws) ? laws.filter((l): l is string => typeof l === 'string' && l.trim() !== '') : [];
  return own.length ? own : DEFAULT_LAWS;
}
