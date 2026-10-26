/**
 * Tipos de los planos del tablero web y catálogo de muebles. No hay planos a
 * mano: todos salen de los datos del motor (src/adapters/web/mapgen.ts). Solo
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
  /** Lo pone el tablero al recortar: venía de `requires_spot` y el PJ ya lo ve. No está en el fondo pintado del plano. */
  secret?: true;
}
export interface MapWall { points: MapPoint[]; requires_spot?: Id; secret?: true }
export interface MapDoor { from: MapPoint; to: MapPoint; requires_spot?: Id; secret?: true }
/**
 * Rectangulares: (x, y) es la esquina suroeste, con w × h. Redondos (round_table, stool, barrel, well, tree, rock, bush): (x, y) es el centro y r el radio.
 * `label`: nombre para el tooltip (y rótulo en edificios y textos). `spot_id`: el punto al que pertenece; pasar el ratón enseña ese punto y clicar lleva allí.
 */
export interface MapProp {
  kind: PropKind; x: number; y: number; w?: number; h?: number; r?: number; label?: string; spot_id?: Id; requires_spot?: Id; secret?: true;
  /** Chimenea u hoguera: encendida o apagada. */
  lit?: boolean;
}

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
