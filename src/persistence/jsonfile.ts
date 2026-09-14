import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameEvent, Id, WorldSnapshot } from '../engine/model.js';
import type { TickerState } from '../clock/clock.js';
import type { Change, Repository } from './repository.js';

/**
 * Persistencia en ficheros JSON en disco. Para desarrollo local sin Google.
 * Guarda el snapshot completo en cada flush (el mundo del MVP cabe de sobra)
 * y los eventos en un JSONL append-only.
 */
export class JsonFileRepository implements Repository {
  private pending = new Map<string, Change>();
  private snapshot: WorldSnapshot | null = null;

  constructor(private readonly dir: string) {}

  private file(name: string): string { return join(this.dir, name); }

  async loadSnapshot(campaignId: Id): Promise<WorldSnapshot | null> {
    try {
      const raw = await readFile(this.file(`${campaignId}.world.json`), 'utf8');
      this.snapshot = JSON.parse(raw) as WorldSnapshot;
      return this.snapshot;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.snapshot = snapshot;
    await writeFile(this.file(`${snapshot.campaign.id}.world.json`), JSON.stringify(snapshot, null, 1));
  }

  /** Aquí los cambios sueltos se resuelven reescribiendo el snapshot que el motor nos pasa vía `flush`. */
  async write(_campaignId: Id, changes: Change[]): Promise<void> {
    for (const c of changes) this.pending.set(`${c.collection}/${c.id}`, c);
  }

  /** Llamado por el motor con el snapshot actual para volcar lo pendiente. */
  async flush(snapshot: WorldSnapshot): Promise<void> {
    if (this.pending.size === 0) return;
    this.pending.clear();
    await this.saveSnapshot(snapshot);
  }

  async appendEvent(event: GameEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(`${event.campaign_id}.events.jsonl`), JSON.stringify(event) + '\n', { flag: 'a' });
  }

  async loadEvents(campaignId: Id, afterSeq: number): Promise<GameEvent[]> {
    try {
      const raw = await readFile(this.file(`${campaignId}.events.jsonl`), 'utf8');
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as GameEvent).filter((e) => e.seq > afterSeq);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async loadTicker(campaignId: Id, name: string): Promise<TickerState | null> {
    try {
      const raw = await readFile(this.file(`${campaignId}.tickers.json`), 'utf8');
      const all = JSON.parse(raw) as Record<string, TickerState>;
      return all[name] ?? null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async saveTicker(campaignId: Id, name: string, state: TickerState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    let all: Record<string, TickerState> = {};
    try { all = JSON.parse(await readFile(this.file(`${campaignId}.tickers.json`), 'utf8')) as Record<string, TickerState>; } catch { /* first write */ }
    all[name] = state;
    await writeFile(this.file(`${campaignId}.tickers.json`), JSON.stringify(all, null, 1));
  }
}
