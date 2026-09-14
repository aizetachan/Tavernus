/**
 * Contrato de persistencia. El mundo vive en RAM; esto solo escribe y carga
 * (SPEC §14.2.5). Firestore es la implementación de producción; la de
 * memoria sirve para tests y para arrancar sin credenciales.
 */

import type { GameEvent, Id, WorldSnapshot } from '../engine/model.js';
import type { Collection } from '../engine/world.js';
import type { TickerState } from '../clock/clock.js';

export interface Change { collection: Collection; id: Id; doc: unknown | null }

export interface Repository {
  loadSnapshot(campaignId: Id): Promise<WorldSnapshot | null>;
  /** Escribe el snapshot completo (semilla inicial o restauración). */
  saveSnapshot(snapshot: WorldSnapshot): Promise<void>;
  /** Escribe cambios sueltos. Puede agrupar; debe ser idempotente por (collection, id). */
  write(campaignId: Id, changes: Change[]): Promise<void>;
  /** Opcional: volcado tras un lote de cambios, con el snapshot actual. */
  flush?(snapshot: WorldSnapshot): Promise<void>;
  appendEvent(event: GameEvent): Promise<void>;
  loadEvents(campaignId: Id, afterSeq: number): Promise<GameEvent[]>;
  loadTicker(campaignId: Id, name: string): Promise<TickerState | null>;
  saveTicker(campaignId: Id, name: string, state: TickerState): Promise<void>;
}
