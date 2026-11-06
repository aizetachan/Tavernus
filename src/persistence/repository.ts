/**
 * Contrato de persistencia. El mundo vive en RAM; esto solo escribe y carga
 * (SPEC §14.2.5). Implementaciones: ficheros JSON (jsonfile.ts, por defecto), PostgreSQL con
 * documentos JSONB (pg.ts, WORLD_STORE=pg), Firestore (firestore.ts) y memoria (tests).
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
  /**
   * Eventos con `seq` > afterSeq, en orden. Sin el contexto del máster (`payload.master.context`,
   * diagnostics.ts): el juego no lo lee y es la mayor parte del registro.
   */
  loadEvents(campaignId: Id, afterSeq: number): Promise<GameEvent[]>;
  /**
   * Opcional: el punto de control, el último `seq` que constaba al guardar el mundo. El motor sigue numerando
   * desde aquí aunque el final del registro se perdiera (un corte al escribirlo): nunca repite un `seq`.
   */
  lastSeq?(campaignId: Id): Promise<number>;
  /** Opcional: espera a que lo pedido (eventos, guardados) esté escrito. */
  settled?(): Promise<void>;
  loadTicker(campaignId: Id, name: string): Promise<TickerState | null>;
  saveTicker(campaignId: Id, name: string, state: TickerState): Promise<void>;
}
