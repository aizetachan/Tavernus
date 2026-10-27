/**
 * Brezal: objetos. El catálogo común del generador (equipo SRD, leña, bayas,
 * truchas, la noche de posada y su llave) más lo propio de esta historia: las
 * pruebas, la llave de los Vharn y los eslabones de hierro frío; y lo de la
 * granja de Úrsula (huevos y coles). Dónde está cada cosa al empezar y qué dan
 * el Soto y los Corrales.
 */

import type { ItemDef, ResourceNode } from '../../../engine/model.js';
import { CATALOG } from '../../../worldgen/fill.js';
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
