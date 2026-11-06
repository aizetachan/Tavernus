/**
 * Brezal: objetos. El catálogo común del generador (equipo SRD, leña, bayas,
 * truchas, la noche de posada y su llave) más lo propio de esta historia: las
 * pruebas, la llave de los Vharn y los eslabones de hierro frío; y lo de la
 * granja de Úrsula (huevos y coles). Dónde está cada cosa al empezar y qué dan
 * el Soto y los Corrales. Lo que cada vecino lleva encima (bolsa, monedas, cosas
 * de su oficio, su arma) lo pone el ajuar al arrancar (src/engine/outfit.ts); aquí
 * solo lo que es de esta historia: la bolsa del diezmo de Garrán.
 */

import type { ItemDef, ResourceNode } from '../../../engine/model.js';
import { CATALOG } from '../../../worldgen/fill.js';
import { kitItemDef } from '../../../engine/outfit.js';
import type { AuthoredInstance } from '../format.js';

const quest = (id: string, name: string, aliases: string[], extra: Partial<ItemDef> = {}): ItemDef =>
  ({ id, name, aliases, type: 'quest', size: 'small', weight_lb: 0.5, value: 0, unique: true, origin: 'custom', ...extra });

/**
 * La tienda del buhonero (shop.ts): equipo de aventurero del SRD que el catálogo común aún no trae, a precios de
 * Brezal. Con los mismos ids que el catálogo SRD (PLAN-OBJETOS §3, bloque B): cuando el catálogo los traiga, mandan
 * los suyos y estos se dejan de añadir (el filtro de ITEM_DEFS), sin ids repetidos.
 */
const SHOP_GOODS: ItemDef[] = [
  { id: 'it_aceite', name: 'frasco de aceite', aliases: ['aceite', 'frasco de aceite', 'oil'], type: 'consumable', size: 'tiny', weight_lb: 1, value: 10, unique: false, origin: 'srd', description: 'Aceite de lámpara: llena un farol o se echa al suelo y se le prende fuego.' },
  { id: 'it_farol', name: 'farol con capucha', aliases: ['farol', 'linterna', 'lámpara', 'lampara', 'lantern'], type: 'misc', size: 'small', weight_lb: 2, value: 500, unique: false, light_source: true, origin: 'srd', description: 'Alumbra más y mejor que una antorcha; se tapa para no ser visto.' },
  { id: 'it_saco', name: 'saco', aliases: ['saco', 'saca', 'costal', 'sack'], type: 'container', size: 'small', weight_lb: 0.5, value: 1, unique: false, container: { slots: 8, max_weight_lb: 30, max_size: 'medium' }, origin: 'srd', description: 'Un saco de arpillera para cargar lo que sea.' },
  { id: 'it_odre', name: 'odre', aliases: ['odre', 'cantimplora', 'bota de vino', 'waterskin'], type: 'misc', size: 'small', weight_lb: 5, value: 20, unique: false, origin: 'srd', description: 'Lleva agua para un día de camino.' },
  { id: 'it_garfio', name: 'garfio de abordaje', aliases: ['garfio', 'gancho', 'rezón', 'grappling hook'], type: 'tool', size: 'small', weight_lb: 4, value: 200, unique: false, origin: 'srd', description: 'Se ata a una cuerda para trepar o engancharse a un muro.' },
  { id: 'it_tiza', name: 'tiza', aliases: ['tiza', 'yeso', 'chalk'], type: 'misc', size: 'tiny', weight_lb: 0, value: 1, unique: false, origin: 'srd', description: 'Para marcar el camino o escribir en la piedra.' },
  { id: 'it_pergamino_curar', name: 'pergamino de curar heridas', aliases: ['pergamino', 'pergamino de conjuro', 'rollo', 'scroll'], type: 'scroll', size: 'tiny', weight_lb: 0, value: 3000, unique: false, origin: 'srd', rarity: 'common', spell: { spell_id: 'cure_wounds', level: 1 }, unidentified: { name: 'pergamino escrito', description: 'Un rollo con letra apretada que no sabes leer.' }, description: 'Un conjuro de nivel 1 escrito en un rollo: quien sepa lanzarlo, lo lee una vez y se gasta.' },
];

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
  // (Si el catálogo común ya la trae, como desde las bolsas de los PJ de la demo, no se repite.)
  // Cosas del ajuar que el buhonero vende (outfit.ts): hilo y aguja, sedal y anzuelos.
  ...[kitItemDef('purse', 'fantasy'), kitItemDef('needle', 'fantasy'), kitItemDef('hook', 'fantasy')].filter((d) => !CATALOG.some((c) => c.id === d.id)),
  // Lo que vende el buhonero y el catálogo común aún no trae (abajo, SHOP_GOODS).
  ...SHOP_GOODS.filter((d) => !CATALOG.some((c) => c.id === d.id)),
  // Los estantes del buhonero: contenedores fijos con dueño (state.owner_id). Lo de dentro está a la venta.
  { id: 'it_estantes_cendal', name: 'estantes del buhonero', aliases: ['estantes', 'estante', 'baldas', 'género', 'mercancía'], type: 'container', size: 'bulky', weight_lb: 60, value: 0, unique: true, container: { slots: 30, max_weight_lb: 300, max_size: 'large', fixed: true }, origin: 'custom', description: 'Lo que le queda al buhonero, a la venta. Cogerlo sin pagar es robar.' },
  { id: 'it_arcon_cendal', name: 'arcón de la trastienda', aliases: ['arcón', 'arcon', 'baúl', 'baul'], type: 'container', size: 'bulky', weight_lb: 60, value: 0, unique: true, container: { slots: 10, max_weight_lb: 100, max_size: 'medium', fixed: true }, origin: 'custom', description: 'Lo caro del buhonero, bajo llave.' },
  { id: 'it_arcon_carro', name: 'arcón del carro', aliases: ['arcón del carro', 'arcon del carro', 'caja del carro', 'lona'], type: 'container', size: 'bulky', weight_lb: 80, value: 0, unique: true, container: { slots: 20, max_weight_lb: 300, max_size: 'large', fixed: true }, origin: 'custom', description: 'Lo que no cabe en la tienda, en el carro de la puerta.' },
  { id: 'it_llaves_cendal', name: 'manojo de llaves del buhonero', aliases: ['llaves', 'manojo de llaves', 'manojo', 'llavero', 'llaves del buhonero'], type: 'tool', size: 'tiny', weight_lb: 0.4, value: 3, unique: true, origin: 'custom', description: 'Las llaves de la trastienda y del candado del carro.' },
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
  // La tienda del buhonero (shop.ts): existencias contadas en sus estantes, en el arcón de la trastienda (lo caro) y en el
  // carro. No repone desde fuera (el valle está sellado): se acaban. Su bolsa, con lo que ha ido cobrando, y las llaves.
  { id: 'ii_cendal_estantes', item_id: 'it_estantes_cendal', quantity: 1, at: { spot: 'sp_ti_estantes' }, state: { owner_id: 'npc_lucio' } },
  { id: 'ii_cendal_tiza', item_id: 'it_tiza', quantity: 5, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_antorchas', item_id: 'it_antorcha', quantity: 6, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_aceite', item_id: 'it_aceite', quantity: 4, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_raciones', item_id: 'it_racion', quantity: 4, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_agujas', item_id: 'it_kit_needle', quantity: 3, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_anzuelos', item_id: 'it_kit_hook', quantity: 2, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_cuerda', item_id: 'it_cuerda', quantity: 2, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_garfio', item_id: 'it_garfio', quantity: 1, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_daga', item_id: 'it_daga', quantity: 1, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_farol', item_id: 'it_farol', quantity: 1, at: { container: 'ii_cendal_estantes' } },
  { id: 'ii_cendal_arcon', item_id: 'it_arcon_cendal', quantity: 1, at: { spot: 'sp_ti_trastienda' }, state: { owner_id: 'npc_lucio' } },
  { id: 'ii_cendal_pocion', item_id: 'it_pocion', quantity: 1, at: { container: 'ii_cendal_arcon' } },
  { id: 'ii_cendal_pergamino', item_id: 'it_pergamino_curar', quantity: 1, at: { container: 'ii_cendal_arcon' } },
  { id: 'ii_cendal_carro', item_id: 'it_arcon_carro', quantity: 1, at: { spot: 'sp_pl_carro' }, state: { owner_id: 'npc_lucio' } },
  { id: 'ii_cendal_sacos', item_id: 'it_saco', quantity: 3, at: { container: 'ii_cendal_carro' } },
  { id: 'ii_cendal_odres', item_id: 'it_odre', quantity: 2, at: { container: 'ii_cendal_carro' } },
  { id: 'ii_cendal_bolsa', item_id: 'it_kit_purse', quantity: 1, at: { npc: 'npc_lucio' }, state: { coins: 600 } },
  { id: 'ii_cendal_llaves', item_id: 'it_llaves_cendal', quantity: 1, at: { container: 'ii_cendal_bolsa' } },
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
