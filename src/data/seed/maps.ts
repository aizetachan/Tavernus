/**
 * Planos de las localizaciones de la demo, para el tablero web. Solo
 * presentación: el motor no los lee (movimiento y percepción siguen saliendo
 * de los puntos y sus enlaces). Mismas coordenadas que los puntos, en metros,
 * con +y hacia el norte.
 *
 * `requires_spot`: el elemento solo se dibuja si el PJ ve ese punto (no
 * oculto o descubierto por él). Así un cuarto o una trampilla secretos no se
 * delatan en el plano.
 */

import type { Id } from '../../engine/model.js';

export type MapPoint = [number, number];
export type Ground = 'void' | 'wood' | 'stone' | 'cobble' | 'grass' | 'dirt' | 'water';
export type PropKind =
  | 'table' | 'round_table' | 'chair' | 'stool' | 'counter' | 'shelf' | 'fireplace' | 'barrel' | 'crate'
  | 'bed' | 'chest' | 'rug' | 'stairs' | 'trapdoor' | 'well' | 'notice' | 'building' | 'tree' | 'rock' | 'bush' | 'text';

export interface MapArea {
  ground: Ground;
  /** Polígono cerrado… */
  polygon?: MapPoint[];
  /** …o franja a lo largo de un camino (sendero, arroyo), de `width` metros. */
  path?: MapPoint[];
  width?: number;
  requires_spot?: Id;
}
export interface MapWall { points: MapPoint[]; requires_spot?: Id }
export interface MapDoor { from: MapPoint; to: MapPoint; requires_spot?: Id }
/**
 * Rectangulares: (x, y) es la esquina suroeste, con w × h. Redondos (round_table, stool, barrel, well, tree, rock, bush): (x, y) es el centro y r el radio.
 * `label`: nombre para el tooltip (y rótulo en edificios y textos). `spot_id`: el punto al que pertenece; pasar el ratón enseña ese punto y clicar lleva allí.
 */
export interface MapProp { kind: PropKind; x: number; y: number; w?: number; h?: number; r?: number; label?: string; spot_id?: Id; requires_spot?: Id }

export interface LocationMap {
  /** Lado de la casilla: 5 ft = 1,5 m. */
  cell_m: number;
  bounds: { x: number; y: number; w: number; h: number };
  /** Lo que hay fuera de las áreas (en interiores, nada). */
  background: Ground;
  areas: MapArea[];
  walls: MapWall[];
  doors: MapDoor[];
  props: MapProp[];
}

export function rect(x0: number, y0: number, x1: number, y1: number): MapPoint[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

const HAB = 'sp_tab_habitacion';
const TRAMPILLA = 'sp_tab_trampilla';

export const DEMO_MAPS: Record<Id, LocationMap> = {
  // Taberna: sala de x −1,2…12,3 e y −1…9; puerta al sur; cuarto de arriba dibujado al norte.
  loc_taberna: {
    cell_m: 1.5,
    bounds: { x: -2.4, y: -2.2, w: 15.9, h: 17.6 },
    background: 'void',
    areas: [
      { ground: 'wood', polygon: rect(-1.2, -1, 12.3, 9) },
      { ground: 'stone', polygon: rect(-0.75, -2.2, 0.75, -1) },
      { ground: 'wood', polygon: rect(1.2, 9, 7.2, 14.2), requires_spot: HAB },
    ],
    walls: [
      { points: [[-0.75, -1], [-1.2, -1], [-1.2, 9], [12.3, 9], [12.3, -1], [0.75, -1]] },
      { points: [[1.2, 9], [1.2, 14.2], [7.2, 14.2], [7.2, 11.2]], requires_spot: HAB },
      { points: [[7.2, 10.2], [7.2, 9]], requires_spot: HAB },
    ],
    doors: [
      { from: [-0.75, -1], to: [0.75, -1] },
      { from: [7.2, 10.2], to: [7.2, 11.2], requires_spot: HAB },
    ],
    props: [
      // La barra: mostrador en L con taburetes y estantes detrás.
      { kind: 'counter', x: 4.4, y: 2.8, w: 4.2, h: 0.6, label: 'la barra', spot_id: 'sp_tab_barra' },
      { kind: 'counter', x: 8.0, y: 2.8, w: 0.6, h: 2.0, label: 'la barra', spot_id: 'sp_tab_barra' },
      { kind: 'shelf', x: 4.4, y: 4.6, w: 3.2, h: 0.35 },
      { kind: 'barrel', x: 5.0, y: 4.1, r: 0.35 },
      { kind: 'barrel', x: 5.8, y: 4.1, r: 0.35 },
      { kind: 'stool', x: 4.9, y: 2.2, r: 0.25, spot_id: 'sp_tab_barra' },
      { kind: 'stool', x: 7.1, y: 2.2, r: 0.25, spot_id: 'sp_tab_barra' },
      // La mesa del fondo.
      { kind: 'table', x: 10.5, y: 5.2, w: 1.2, h: 1.6, label: 'la mesa del fondo', spot_id: 'sp_tab_mesa' },
      { kind: 'chair', x: 10.85, y: 7.0, w: 0.5, h: 0.45, spot_id: 'sp_tab_mesa' },
      { kind: 'chair', x: 10.85, y: 4.55, w: 0.5, h: 0.45, spot_id: 'sp_tab_mesa' },
      { kind: 'chair', x: 11.8, y: 5.75, w: 0.45, h: 0.5, spot_id: 'sp_tab_mesa' },
      // La chimenea contra la pared norte.
      { kind: 'fireplace', x: 2.0, y: 8.0, w: 2.0, h: 1.0, spot_id: 'sp_tab_chimenea' },
      // Más mesas de la sala.
      { kind: 'round_table', x: 2.2, y: 3.6, r: 0.75 },
      { kind: 'stool', x: 1.1, y: 3.6, r: 0.25 },
      { kind: 'stool', x: 3.3, y: 3.6, r: 0.25 },
      { kind: 'stool', x: 2.2, y: 4.7, r: 0.25 },
      { kind: 'round_table', x: 9.8, y: 0.8, r: 0.65 },
      { kind: 'stool', x: 8.8, y: 0.8, r: 0.25 },
      { kind: 'stool', x: 10.8, y: 0.8, r: 0.25 },
      // La alfombra se ve siempre; la trampilla, solo si la ha descubierto.
      { kind: 'rug', x: 8.7, y: 7.0, w: 2.6, h: 1.8 },
      { kind: 'trapdoor', x: 9.5, y: 7.5, w: 1.0, h: 1.0, spot_id: TRAMPILLA, requires_spot: TRAMPILLA },
      // Escalera al piso de arriba y el cuarto.
      { kind: 'stairs', x: -1.2, y: 5.6, w: 1.4, h: 3.4, label: 'escalera al piso de arriba', spot_id: HAB, requires_spot: HAB },
      { kind: 'bed', x: 1.6, y: 12.5, w: 1.0, h: 1.5, spot_id: HAB, requires_spot: HAB },
      { kind: 'chest', x: 5.7, y: 13.4, w: 1.0, h: 0.55, spot_id: HAB, requires_spot: HAB },
      { kind: 'text', x: 4.2, y: 9.5, label: 'piso de arriba', requires_spot: HAB },
    ],
  },

  // Plaza: empedrado; la taberna al suroeste, la herrería al sur, la muralla con el portón al norte.
  loc_plaza: {
    cell_m: 1.5,
    bounds: { x: -4, y: -4, w: 38, h: 28 },
    background: 'cobble',
    areas: [],
    walls: [
      { points: [[-4, 22.6], [28.4, 22.6]] },
      { points: [[31.6, 22.6], [34, 22.6]] },
    ],
    doors: [{ from: [28.4, 22.6], to: [31.6, 22.6] }, { from: [-0.7, -1], to: [0.7, -1] }],
    props: [
      { kind: 'building', x: -4, y: -4, w: 9.5, h: 3.0, label: 'Taberna del Jabalí', spot_id: 'sp_pl_taberna' },
      { kind: 'building', x: 16.5, y: -4, w: 9.5, h: 6.4, label: 'Herrería' },
      { kind: 'building', x: -4, y: 9, w: 6.5, h: 10, label: 'Casas' },
      { kind: 'building', x: 29.5, y: 0, w: 4.5, h: 12 },
      { kind: 'notice', x: 19.2, y: 2.4, w: 1.6, h: 0.35, spot_id: 'sp_pl_tablon' },
      { kind: 'well', x: 15, y: 11.3, r: 0.85, spot_id: 'sp_pl_pozo' },
      { kind: 'crate', x: 14.6, y: -0.4, w: 0.9, h: 0.9 },
      { kind: 'barrel', x: 13.7, y: 0.6, r: 0.4 },
      { kind: 'barrel', x: 6.3, y: -0.4, r: 0.4 },
      { kind: 'tree', x: 8, y: 17, r: 1.6 },
      { kind: 'tree', x: 22, y: 19, r: 1.4 },
    ],
  },

  // Claro: hierba, el sendero entra por el suroeste, el roble en medio, el arroyo al este.
  loc_claro: {
    cell_m: 1.5,
    bounds: { x: -4, y: -4, w: 50, h: 30 },
    background: 'grass',
    areas: [
      { ground: 'dirt', path: [[-4, -3], [-1, -1], [1.5, 0.8], [5, 2.5]], width: 2 },
      { ground: 'water', path: [[39, -4], [40.4, 2], [40.2, 8], [39.4, 14], [40.2, 20], [41.5, 26]], width: 2.4 },
    ],
    walls: [],
    doors: [],
    props: [
      { kind: 'tree', x: 25, y: 15, r: 3.2, label: 'el roble viejo', spot_id: 'sp_cl_roble' },
      { kind: 'rock', x: 12, y: 20, r: 1.1, label: 'la piedra grande', spot_id: 'sp_cl_piedra' },
      { kind: 'bush', x: 13.8, y: 21.5, r: 0.7, label: 'un arbusto de bayas', spot_id: 'sp_cl_piedra' },
      // Fresnos alrededor del claro.
      { kind: 'tree', x: -2, y: 8, r: 1.6 }, { kind: 'tree', x: -1.5, y: 15, r: 1.8 }, { kind: 'tree', x: 2, y: 23, r: 1.7 },
      { kind: 'tree', x: 7, y: 25, r: 1.5 }, { kind: 'tree', x: 19, y: 25, r: 1.8 }, { kind: 'tree', x: 30, y: 24.5, r: 1.6 },
      { kind: 'tree', x: 35.5, y: 21, r: 1.5 }, { kind: 'tree', x: 44.5, y: 17, r: 1.7 }, { kind: 'tree', x: 44.5, y: 8, r: 1.6 },
      { kind: 'tree', x: 44, y: -1.5, r: 1.5 }, { kind: 'tree', x: 31, y: -2.5, r: 1.7 }, { kind: 'tree', x: 20, y: -2.8, r: 1.5 },
      { kind: 'tree', x: 10, y: -2.5, r: 1.4 }, { kind: 'tree', x: 4, y: 11, r: 1.3 }, { kind: 'tree', x: 33, y: 9, r: 1.3 },
    ],
  },
};
