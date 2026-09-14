/**
 * Persistencia en Firestore (SPEC §14.1). Estructura:
 *
 *   campaigns/{campaignId}                      documento de campaña
 *   campaigns/{campaignId}/{collection}/{id}    regions, zones, locations, spots, exits,
 *                                               characters, npcs, vehicles, item_defs,
 *                                               item_instances, resource_nodes
 *   campaigns/{campaignId}/events/{eventId}     log inmutable
 *   campaigns/{campaignId}/tickers/{name}       estado de tickers
 *
 * Firestore no está en el camino crítico de una acción: el motor escribe
 * cambios sueltos en lotes y solo lee al arrancar.
 */

import { Firestore, type WriteBatch } from '@google-cloud/firestore';
import type { GameEvent, Id, WorldSnapshot } from '../engine/model.js';
import type { Collection } from '../engine/world.js';
import type { TickerState } from '../clock/clock.js';
import type { Change, Repository } from './repository.js';

const COLLECTIONS: Exclude<Collection, 'campaign'>[] = [
  'regions', 'zones', 'locations', 'spots', 'exits', 'characters', 'npcs', 'vehicles', 'item_defs', 'item_instances', 'resource_nodes',
];

const SNAPSHOT_KEYS: Record<Exclude<Collection, 'campaign'>, keyof Omit<WorldSnapshot, 'campaign'>> = {
  regions: 'regions', zones: 'zones', locations: 'locations', spots: 'spots', exits: 'exits', characters: 'characters',
  npcs: 'npcs', vehicles: 'vehicles', item_defs: 'item_defs', item_instances: 'item_instances', resource_nodes: 'resource_nodes',
};

const BATCH_LIMIT = 450;

export class FirestoreRepository implements Repository {
  private db: Firestore;

  constructor(projectId?: string, db?: Firestore) {
    this.db = db ?? new Firestore(projectId ? { projectId } : {});
  }

  private campaignRef(id: Id) { return this.db.collection('campaigns').doc(id); }

  async loadSnapshot(campaignId: Id): Promise<WorldSnapshot | null> {
    const ref = this.campaignRef(campaignId);
    const camp = await ref.get();
    if (!camp.exists) return null;
    const snapshot = { campaign: strip(camp.data()) } as WorldSnapshot;
    for (const col of COLLECTIONS) {
      const qs = await ref.collection(col).get();
      (snapshot as unknown as Record<string, unknown[]>)[SNAPSHOT_KEYS[col]] = qs.docs.map((d) => strip(d.data()));
    }
    return snapshot;
  }

  async saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
    const ref = this.campaignRef(snapshot.campaign.id);
    const writes: ((b: WriteBatch) => void)[] = [(b) => b.set(ref, clean(snapshot.campaign))];
    for (const col of COLLECTIONS) {
      for (const doc of snapshot[SNAPSHOT_KEYS[col]] as { id: Id }[]) {
        writes.push((b) => b.set(ref.collection(col).doc(doc.id), clean(doc)));
      }
    }
    await this.commitAll(writes);
  }

  async write(campaignId: Id, changes: Change[]): Promise<void> {
    const ref = this.campaignRef(campaignId);
    const writes = changes.map((c) => (b: WriteBatch) => {
      if (c.collection === 'campaign') { b.set(ref, clean(c.doc)); return; }
      const d = ref.collection(c.collection).doc(c.id);
      if (c.doc === null) b.delete(d); else b.set(d, clean(c.doc));
    });
    await this.commitAll(writes);
  }

  async appendEvent(event: GameEvent): Promise<void> {
    await this.campaignRef(event.campaign_id).collection('events').doc(event.id).create(clean(event));
  }

  async loadEvents(campaignId: Id, afterSeq: number): Promise<GameEvent[]> {
    const qs = await this.campaignRef(campaignId).collection('events').where('seq', '>', afterSeq).orderBy('seq').get();
    return qs.docs.map((d) => strip(d.data()) as GameEvent);
  }

  async loadTicker(campaignId: Id, name: string): Promise<TickerState | null> {
    const d = await this.campaignRef(campaignId).collection('tickers').doc(name).get();
    return d.exists ? (d.data() as TickerState) : null;
  }

  async saveTicker(campaignId: Id, name: string, state: TickerState): Promise<void> {
    await this.campaignRef(campaignId).collection('tickers').doc(name).set(state);
  }

  private async commitAll(writes: ((b: WriteBatch) => void)[]): Promise<void> {
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
      const batch = this.db.batch();
      for (const w of writes.slice(i, i + BATCH_LIMIT)) w(batch);
      await batch.commit();
    }
  }
}

/** Firestore rechaza `undefined`: se elimina antes de escribir. */
function clean<T>(doc: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

function strip<T>(doc: T): T { return doc; }
