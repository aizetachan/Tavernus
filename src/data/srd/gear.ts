/**
 * Lo que lleva un PJ por su trasfondo y su ropa (PLAN-OBJETOS §7): las definiciones de los objetos que no están en
 * el catálogo común (`CATALOG`, worldgen/fill.ts). Pesos y precios del SRD 5.1, en cobre como el resto del catálogo.
 *
 * No van al catálogo común a propósito: así no entran en lo que comercia un mundo generado ni en el prompt del
 * generador. El motor añade a la partida la definición que le falte al crear el PJ (engine.ts, `createCharacter`),
 * en cualquier campaña y en partidas ya empezadas. Cuando el catálogo SRD tenga su módulo propio (bloque B), estas
 * definiciones pasan allí con las mismas ids.
 *
 * Del SRD 5.1 solo es el trasfondo de acólito; los demás trasfondos (criminal, héroe del pueblo, noble, erudito,
 * soldado) siguen la lista de equipo de las reglas básicas de 5e, con nombres propios en castellano.
 */

import type { ItemDef } from '../../engine/model.js';

type Gear = Omit<ItemDef, 'origin' | 'unique'> & { unique?: boolean };
const def = (g: Gear): ItemDef => ({ unique: false, origin: 'srd', ...g });

export const PC_GEAR_ITEMS: readonly ItemDef[] = [
  // Ropa: la que lleva puesta. Va en el cuerpo si la clase no lleva armadura; si la lleva, en la mochila.
  def({ id: 'it_ropa_viaje', name: 'ropa de viaje', aliases: ['ropa', 'muda', 'ropa de camino', 'traveler clothes'], type: 'misc', size: 'medium', weight_lb: 4, value: 200, equip_slot: 'body', description: 'Ropa recia para el camino: botas, calzas, camisa, jubón y una capa con capucha.' }),
  def({ id: 'it_ropa_fina', name: 'ropa fina', aliases: ['ropa', 'ropa buena', 'traje', 'fine clothes'], type: 'misc', size: 'medium', weight_lb: 6, value: 1500, equip_slot: 'body', description: 'Ropa de buen paño, de las que dicen de qué casa eres antes que tú.' }),
  def({ id: 'it_ropa_oscura', name: 'ropa oscura con capucha', aliases: ['ropa', 'ropa oscura', 'capucha', 'dark clothes'], type: 'misc', size: 'medium', weight_lb: 3, value: 50, equip_slot: 'body', description: 'Ropa de diario teñida de oscuro, con capucha: no llama la atención de noche.' }),
  def({ id: 'it_vestiduras', name: 'vestiduras', aliases: ['hábito', 'habito', 'vestimenta', 'vestments'], type: 'misc', size: 'medium', weight_lb: 4, value: 100, equip_slot: 'body', description: 'Las vestiduras de oficiar en el templo.' }),
  // Acólito (SRD)
  def({ id: 'it_libro_oraciones', name: 'libro de oraciones', aliases: ['libro', 'devocionario', 'oraciones', 'prayer book'], type: 'misc', size: 'small', weight_lb: 5, value: 2500, description: 'Oraciones y cantos de tu fe, con las esquinas gastadas.' }),
  def({ id: 'it_incienso', name: 'varita de incienso', aliases: ['incienso', 'varitas de incienso', 'incense'], type: 'consumable', size: 'tiny', weight_lb: 0, value: 1, description: 'Se quema en los ritos y para velar a los muertos.' }),
  // Criminal
  def({ id: 'it_palanca', name: 'palanca', aliases: ['pie de cabra', 'barra', 'crowbar'], type: 'tool', size: 'medium', weight_lb: 5, value: 200, description: 'Ayuda a forzar lo que se deja forzar: ventaja en las pruebas de Fuerza en que sirva hacer palanca.' }),
  // Héroe del pueblo
  def({ id: 'it_herramientas_carpintero', name: 'herramientas de carpintero', aliases: ['herramientas', 'herramientas de artesano', 'carpenter tools'], type: 'tool', size: 'medium', weight_lb: 6, value: 800, description: 'Sierra, martillo, clavos, hacha pequeña, escuadra y cepillo: lo de tu oficio antes de esto.' }),
  def({ id: 'it_pala', name: 'pala', aliases: ['azada', 'shovel'], type: 'tool', size: 'medium', weight_lb: 5, value: 200, description: 'Para cavar.' }),
  def({ id: 'it_olla_hierro', name: 'olla de hierro', aliases: ['olla', 'puchero', 'caldero', 'pot'], type: 'tool', size: 'medium', weight_lb: 10, value: 200, description: 'Para guisar en el camino.' }),
  // Noble
  def({ id: 'it_anillo_sello_pj', name: 'anillo de sello', aliases: ['anillo', 'sello', 'sortija', 'signet ring'], type: 'treasure', size: 'tiny', weight_lb: 0, value: 500, equip_slot: 'ring1', unique: true, description: 'El sello de tu casa. Lacra cartas y abre puertas que el dinero no abre.' }),
  def({ id: 'it_pergamino_linaje', name: 'pergamino de linaje', aliases: ['pergamino', 'linaje', 'genealogía', 'genealogia', 'scroll of pedigree'], type: 'misc', size: 'tiny', weight_lb: 0, value: 0, unique: true, description: 'Tu árbol familiar, con sellos y firmas: quién eres y de dónde vienes.' }),
  // Erudito
  def({ id: 'it_tinta', name: 'frasco de tinta', aliases: ['tinta', 'tintero', 'ink'], type: 'misc', size: 'tiny', weight_lb: 0, value: 1000, description: 'Tinta negra para unas cuantas páginas.' }),
  def({ id: 'it_pluma', name: 'pluma de escribir', aliases: ['pluma', 'cálamo', 'calamo', 'quill'], type: 'misc', size: 'tiny', weight_lb: 0, value: 2, description: 'Para escribir con la tinta.' }),
  def({ id: 'it_cuchillo_pequeno', name: 'cuchillo pequeño', aliases: ['cuchillo', 'cortaplumas', 'navaja'], type: 'tool', size: 'tiny', weight_lb: 0.5, value: 100, weapon: { damage: '1d4', damage_type: 'piercing', finesse: true }, description: 'Para afilar plumas y cortar lacre.' }),
  def({ id: 'it_carta_colega', name: 'carta de un colega muerto', aliases: ['carta', 'carta del colega', 'pregunta', 'letter'], type: 'misc', size: 'tiny', weight_lb: 0, value: 0, unique: true, description: 'La última carta de un colega que ya ha muerto. Termina con una pregunta que nunca pudiste contestarle.' }),
  // Soldado
  def({ id: 'it_insignia', name: 'insignia de rango', aliases: ['insignia', 'galón', 'galon', 'insignia of rank'], type: 'misc', size: 'tiny', weight_lb: 0, value: 0, unique: true, description: 'La insignia del rango que tuviste. Quien ha servido la reconoce.' }),
  def({ id: 'it_trofeo', name: 'trofeo de un enemigo', aliases: ['trofeo', 'recuerdo de guerra', 'trophy'], type: 'misc', size: 'tiny', weight_lb: 0, value: 0, unique: true, description: 'Algo que le quitaste a un enemigo caído: un puñal roto, una hebilla, una insignia ajena.' }),
  def({ id: 'it_dados', name: 'dados de hueso', aliases: ['dados', 'dado', 'dice'], type: 'misc', size: 'tiny', weight_lb: 0, value: 10, description: 'Para pasar las guardias jugándose algo.' }),
];

const BY_ID = new Map(PC_GEAR_ITEMS.map((d) => [d.id, d]));

/** La definición de un objeto de trasfondo o de ropa; `undefined` si no es de aquí. */
export function pcGearDef(id: string): ItemDef | undefined {
  const d = BY_ID.get(id);
  return d ? structuredClone(d) : undefined;
}
