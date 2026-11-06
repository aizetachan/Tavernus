/**
 * Brezal: objetos. El catálogo común del generador (equipo SRD, leña, bayas,
 * truchas, la noche de posada y su llave) más lo propio de esta historia: las
 * pruebas, la llave de los Vharn y los eslabones de hierro frío; y lo de la
 * granja de Úrsula (huevos y coles). Dónde está cada cosa al empezar y qué dan
 * el Soto y los Corrales. Lo que cada vecino lleva encima (bolsa, monedas, cosas
 * de su oficio, su arma, su ropa) lo pone el ajuar al arrancar (src/engine/outfit.ts);
 * aquí solo lo que es de esta historia: la bolsa del diezmo de Garrán y lo que la
 * historia nombra de cada vecino (PLAN-OBJETOS §7): la jarra de Brenna, el guante de
 * Ysolde, la cuerda de Úrsula, las botas de Doro, los anillos de Osric y, en la fragua,
 * el martillo del hijo del maestro de Hugo. Lo que se lleva puesto va con `state.worn`.
 */

import type { ItemDef, ResourceNode } from '../../../engine/model.js';
import { CATALOG } from '../../../worldgen/fill.js';
import { kitItemDef } from '../../../engine/outfit.js';
import type { AuthoredInstance } from '../format.js';

const quest = (id: string, name: string, aliases: string[], extra: Partial<ItemDef> = {}): ItemDef =>
  ({ id, name, aliases, type: 'quest', size: 'small', weight_lb: 0.5, value: 0, unique: true, origin: 'custom', ...extra });

export const ITEM_DEFS: ItemDef[] = [
  ...structuredClone(CATALOG as ItemDef[]),
  quest('it_llave_vharn', 'llave vieja con el sello de Vharn', ['llave', 'llave de vharn', 'llave vieja', 'key'], { size: 'tiny', weight_lb: 0.1 }),
  quest('it_libro_cuentas', 'libro de cuentas de Vharn', ['libro', 'libro de cuentas', 'cuentas', 'ledger'], { weight_lb: 2 }),
  quest('it_cadena_fria', 'eslabones de hierro frío', ['eslabones', 'cadena', 'hierro frío', 'hierro frio'], { size: 'medium', weight_lb: 4 }),
  quest('it_cartas_tobias', 'cartas con una brasa dibujada', ['cartas', 'carta', 'cartas de tobías', 'cartas de tobias'], { size: 'tiny', weight_lb: 0.1 }),
  quest('it_bolsa_ceniza', 'bolsa de ceniza del granero', ['bolsa de ceniza', 'ceniza', 'bolsa'], { weight_lb: 1 }),
  quest('it_llave_arcon', 'llave del arcón del regidor', ['llave del arcón', 'llave del arcon', 'llave pequeña'], { type: 'tool', size: 'tiny', weight_lb: 0.1 }),
  { id: 'it_copa_vharn', name: 'copa de plata con el sello de Vharn', aliases: ['copa', 'copa de plata', 'plata'], type: 'treasure', size: 'small', weight_lb: 1, value: 4000, unique: true, origin: 'custom' },
  { id: 'it_agua_pozo', name: 'agua del pozo', aliases: ['agua', 'agua turbia', 'muestra', 'cubo', 'agua del pozo'], type: 'misc', size: 'small', weight_lb: 2, value: 0, unique: false, origin: 'custom' },
  { id: 'it_carta_sello', name: 'carta lacrada con el sello de Vharn', aliases: ['carta', 'carta lacrada', 'lacre'], type: 'quest', size: 'tiny', weight_lb: 0.1, value: 0, unique: false, origin: 'custom' },
  { id: 'it_tonico', name: 'tónico de corteza', aliases: ['tónico', 'tonico', 'remedio', 'jarabe'], type: 'consumable', size: 'tiny', weight_lb: 0.2, value: 50, unique: false, origin: 'custom' },
  { id: 'it_harina', name: 'saco de harina', aliases: ['harina', 'saco'], type: 'misc', size: 'medium', weight_lb: 10, value: 20, unique: false, origin: 'custom' },
  { id: 'it_huevo', name: 'huevo', aliases: ['huevos', 'huevo de gallina', 'egg'], type: 'consumable', size: 'tiny', weight_lb: 0.1, value: 1, unique: false, origin: 'custom' },
  { id: 'it_col', name: 'col', aliases: ['coles', 'repollo', 'verdura', 'nabos'], type: 'consumable', size: 'small', weight_lb: 2, value: 1, unique: false, origin: 'custom' },
  { id: 'it_piel', name: 'piel de lobo', aliases: ['piel', 'pellejo'], type: 'misc', size: 'medium', weight_lb: 5, value: 150, unique: false, origin: 'custom' },
  // La bolsa del ajuar (outfit.ts), para la de Garrán, que va escrita; las demás las pone el ajuar al arrancar.
  kitItemDef('purse', 'fantasy'),
  // Lo que la historia nombra de cada vecino. Las descripciones solo dicen lo que se ve: lo que esconde cada cosa
  // está en su ficha de la wiki (wiki/Personajes/) y en lo que el NPC cuenta según su confianza.
  { id: 'it_jarra_brenna', name: 'jarra de barro con una muesca', aliases: ['jarra', 'jarra de barro', 'jarra con muesca', 'jarra de brenna'], type: 'misc', size: 'small', weight_lb: 1, value: 0, unique: true, description: 'Una jarra de barro vieja, con una muesca en el asa. Brenna la seca cuando piensa; cuanto más le duele lo que oye, más deprisa.', origin: 'custom' },
  { id: 'it_guante_ascua', name: 'guante de cuero con un ascua', aliases: ['guante', 'guante de cuero', 'ascua', 'guante del ascua'], type: 'quest', size: 'small', weight_lb: 0.5, value: 0, unique: true, equip_slot: 'hands', description: 'Un guante de trabajo de cuero, remendado mil veces y demasiado grande para la mano que lo lleva. Dentro brilla un ascua de la Brasa que no se apaga: quema a quien la toca sin el guante.', origin: 'custom' },
  { id: 'it_cuerda_ursula', name: 'cuerda trenzada a mano', aliases: ['cuerda', 'cuerda trenzada', 'cuerda de úrsula', 'cuerda de ursula', 'soga'], type: 'gear', subtype: 'adventuring', size: 'medium', weight_lb: 8, value: 0, unique: true, description: 'Una cuerda trenzada a mano, gastada en los nudos. Úrsula se ata con ella a la cerca para entrar en la niebla.', origin: 'custom' },
  { id: 'it_botas_doro', name: 'botas nuevas', aliases: ['botas', 'botas de cuero', 'botas de doro'], type: 'gear', subtype: 'clothes', size: 'small', weight_lb: 2, value: 300, unique: true, equip_slot: 'feet', description: 'Botas de cuero nuevas, sin una mancha de barro. En la suela, el sello del zapatero de la casona.', origin: 'custom' },
  { id: 'it_anillos_osric', name: 'anillos de plata', aliases: ['anillos', 'anillos de plata', 'sortijas'], type: 'treasure', size: 'tiny', weight_lb: 0.1, value: 3000, unique: true, equip_slot: 'ring2', description: 'Dos anillos de plata maciza, de la de antes. Más plata de la que gana un regidor de aldea.', origin: 'custom' },
  kitItemDef('ring', 'fantasy'),
  { id: 'it_martillo_maestro', name: 'martillo engrasado', aliases: ['martillo', 'martillo engrasado', 'martillo del hijo', 'martillo del maestro'], type: 'weapon', subtype: 'simple_melee', size: 'small', weight_lb: 2, value: 200, unique: true, weapon: { damage: '1d4', damage_type: 'bludgeoning' }, description: 'Un martillo de herrero bien equilibrado, colgado aparte de los demás. Es el único que brilla de grasa: alguien lo cuida.', origin: 'custom' },
  { id: 'it_esparto', name: 'trenza de esparto', aliases: ['esparto', 'trenza', 'trenza de esparto'], type: 'misc', size: 'tiny', weight_lb: 0.1, value: 0, unique: true, description: 'Una trenza de esparto a medio hacer, de las que se hacen a la luz de una vela para no dormirse.', origin: 'custom' },
];

export const ITEMS: AuthoredInstance[] = [
  // Taberna
  { id: 'ii_cofre', item_id: 'it_cofre', quantity: 1, at: { spot: 'sp_tab_mesa' } },
  { id: 'ii_cofre_pocion', item_id: 'it_pocion', quantity: 2, at: { container: 'ii_cofre' } },
  { id: 'ii_barril', item_id: 'it_barril', quantity: 1, at: { spot: 'sp_tab_chimenea' } },
  // Las pruebas, escondidas
  { id: 'ii_libro_cuentas', item_id: 'it_libro_cuentas', quantity: 1, at: { spot: 'sp_so_hueco' } },
  { id: 'ii_cadena_fria', item_id: 'it_cadena_fria', quantity: 1, at: { spot: 'sp_he_losa' } },
  { id: 'ii_cartas_tobias', item_id: 'it_cartas_tobias', quantity: 1, at: { spot: 'sp_mo_desvan' } },
  { id: 'ii_bolsa_ceniza', item_id: 'it_bolsa_ceniza', quantity: 1, at: { spot: 'sp_mo_desvan' } },
  { id: 'ii_copa_vharn', item_id: 'it_copa_vharn', quantity: 1, at: { spot: 'sp_ca_arcon' } },
  { id: 'ii_llave_arcon', item_id: 'it_llave_arcon', quantity: 1, at: { npc: 'npc_garran' } },
  // La bolsa del diezmo, al cinto de Garrán: lo cobrado hoy (life.ts, se_diezmo: «se guarda la bolsa») y la trenza
  // que hace de noche junto a la vela (su secreto de amigo). El ajuar le añade el silbato y el mendrugo.
  { id: 'ii_garran_bolsa', item_id: 'it_kit_purse', quantity: 1, at: { npc: 'npc_garran' }, state: { coins: 430 } },
  { id: 'ii_garran_esparto', item_id: 'it_esparto', quantity: 1, at: { container: 'ii_garran_bolsa' } },
  // Lo que la historia nombra de cada vecino (encima, o puesto). El ajuar completa el resto (bolsa, oficio, ropa).
  { id: 'ii_brenna_jarra', item_id: 'it_jarra_brenna', quantity: 1, at: { npc: 'npc_brenna' } },
  { id: 'ii_ysolde_guante', item_id: 'it_guante_ascua', quantity: 1, at: { npc: 'npc_ysolde' }, state: { worn: true } },
  { id: 'ii_ursula_cuerda', item_id: 'it_cuerda_ursula', quantity: 1, at: { npc: 'npc_ursula' } },
  { id: 'ii_doro_botas', item_id: 'it_botas_doro', quantity: 1, at: { npc: 'npc_doro' }, state: { worn: true } },
  // Anillos en tres dedos: el de sello (el que el ajuar da a quien manda) y dos de plata.
  { id: 'ii_osric_sello', item_id: 'it_kit_ring', quantity: 1, at: { npc: 'npc_osric' }, state: { worn: true } },
  { id: 'ii_osric_anillos', item_id: 'it_anillos_osric', quantity: 1, at: { npc: 'npc_osric' }, state: { worn: true } },
  // El martillo del hijo del maestro: colgado aparte en la fragua, no encima de Hugo. La herrería es suya (plot.ts, LAW).
  { id: 'ii_martillo_maestro', item_id: 'it_martillo_maestro', quantity: 1, at: { spot: 'sp_he_fragua' } },
  // Lo que Ilse vende lo tiene a mano, en su mesa de hierbas: se compra o se roba de aquí.
  { id: 'ii_ilse_tonico', item_id: 'it_tonico', quantity: 3, at: { npc: 'npc_ilse' } },
  { id: 'ii_ilse_pocion', item_id: 'it_pocion', quantity: 1, at: { npc: 'npc_ilse' } },
  // El agua del pozo, a mano para quien quiera llevársela
  { id: 'ii_agua_pozo', item_id: 'it_agua_pozo', quantity: 3, at: { spot: 'sp_pl_pozo' } },
  // Herramientas sueltas
  { id: 'ii_hacha_suelo', item_id: 'it_hacha', quantity: 1, at: { spot: 'sp_cl_sendero' } },
  { id: 'ii_cuerda_torre', item_id: 'it_cuerda', quantity: 1, at: { spot: 'sp_ca_torre' } },
  { id: 'ii_antorchas_ruinas', item_id: 'it_antorcha', quantity: 2, at: { spot: 'sp_ru_torre' } },
];

const node = (id: string, spot_id: string, name: string, aliases: string[], item: string, yield_max: number, skill: string, dc: number, destructive = false, tool: string | null = null): ResourceNode =>
  ({ id, spot_id, name, aliases, resource_item_id: item, yield_max, regen_time_s: 24 * 3600, last_harvested_game_s: null, regen_state_at_harvest: 1, destructive, skill, dc, tool_required: tool });

export const RESOURCES: ResourceNode[] = [
  node('rn_roble', 'sp_cl_roble', 'el roble viejo', ['roble', 'árbol', 'arbol', 'oak'], 'it_madera', 6, 'athletics', 10, true, 'it_hacha'),
  node('rn_arroyo', 'sp_cl_arroyo', 'el arroyo', ['arroyo', 'agua', 'truchas', 'peces', 'stream'], 'it_pescado', 4, 'survival', 11),
  node('rn_bayas', 'sp_cl_piedra', 'un arbusto de bayas', ['arbusto', 'bayas', 'zarzas', 'bush'], 'it_bayas', 5, 'survival', 8),
  node('rn_gallinero', 'sp_co_gallinero', 'el ponedero', ['ponedero', 'nidos', 'huevos', 'gallinero'], 'it_huevo', 6, 'animal_handling', 8),
  node('rn_huerto', 'sp_co_huerto', 'el huerto de coles', ['huerto', 'coles', 'nabos'], 'it_col', 4, 'survival', 8),
  node('rn_canal', 'sp_mo_rueda', 'el canal del molino', ['canal', 'truchas del canal'], 'it_pescado', 2, 'survival', 13),
];
