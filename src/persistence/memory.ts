import type { GameEvent, Id, WorldSnapshot } from '../engine/model.js';
import type { TickerState } from '../clock/clock.js';
import type { Change, Repository } from './repository.js';

/** Persistencia en memoria: para tests y arranque local. */
export class MemoryRepository implements Repository {
  private snapshots = new Map<Id, WorldSnapshot>();
  readonly writes: Change[] = [];
  readonly events: GameEvent[] = [];
  private tickers = new Map<string, TickerState>();

  async loadSnapshot(campaignId: Id): Promise<WorldSnapshot | null> {
    return this.snapshots.get(campaignId) ?? null;
  }
  async saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
    this.snapshots.set(snapshot.campaign.id, structuredClone(snapshot));
  }
  async write(_campaignId: Id, changes: Change[]): Promise<void> {
    this.writes.push(...changes.map((c) => ({ ...c, doc: c.doc === null ? null : structuredClone(c.doc) })));
  }
  async appendEvent(event: GameEvent): Promise<void> { this.events.push(structuredClone(event)); }
  async loadEvents(campaignId: Id, afterSeq: number): Promise<GameEvent[]> {
    return this.events.filter((e) => e.campaign_id === campaignId && e.seq > afterSeq);
  }
  async loadTicker(campaignId: Id, name: string): Promise<TickerState | null> {
    return this.tickers.get(`${campaignId}/${name}`) ?? null;
  }
  async saveTicker(campaignId: Id, name: string, state: TickerState): Promise<void> {
    this.tickers.set(`${campaignId}/${name}`, { ...state });
  }
}
