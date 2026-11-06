import { readFileSync, existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameEvent, Id, WorldSnapshot } from '../engine/model.js';
import type { TickerState } from '../clock/clock.js';
import type { Change, Repository } from './repository.js';
import { joinDiagnostics, splitDiagnostics } from './diagnostics.js';
import type { WorldDump } from './pg.js';

/**
 * Persistencia en ficheros JSON en disco: la de siempre en local y en el VPS (WORLD_STORE=json, por defecto).
 * La otra es PostgreSQL (pg.ts, WORLD_STORE=pg). En la carpeta de datos de cada partida:
 *
 *   <id>.world.json     el mundo entero, reescrito en cada guardado. Se escribe en un temporal y se renombra:
 *                       un corte a mitad deja el anterior, nunca uno roto. Lleva el punto de control del
 *                       registro (`_log.seq`, el último evento escrito cuando se guardó).
 *   <id>.events.jsonl   el registro, una línea por evento, sin el contexto del máster (diagnostics.ts).
 *   <id>.context.jsonl  ese contexto, una línea por evento que lo lleva ({ seq, id, context }). No se lee al
 *                       arrancar; lo leen las herramientas de análisis (readEventsSync).
 *   <id>.tickers.json   el estado de los tickers (atómico, como el mundo).
 *
 * Partidas de antes (el contexto dentro de cada evento del registro) se leen igual: se le quita al cargar.
 */
export class JsonFileRepository implements Repository {
  private pending = new Map<string, Change>();
  /** Último evento escrito en el registro (o leído al arrancar): el punto de control que se guarda con el mundo. */
  private seqWritten = 0;
  /** Punto de control leído del mundo al cargarlo. */
  private checkpoint = 0;
  /** Registros que acabaron a medias (un corte al escribir): la siguiente línea empieza en una línea nueva. */
  private torn = new Set<string>();

  constructor(private readonly dir: string) {}

  private file(name: string): string { return join(this.dir, name); }

  async loadSnapshot(campaignId: Id): Promise<WorldSnapshot | null> {
    await this.dropTemps(campaignId);
    try {
      const raw = await readFile(this.file(`${campaignId}.world.json`), 'utf8');
      const { _log, ...snapshot } = JSON.parse(raw) as WorldSnapshot & { _log?: { seq?: number } };
      this.checkpoint = Number(_log?.seq) || 0;
      this.seqWritten = Math.max(this.seqWritten, this.checkpoint);
      return snapshot as WorldSnapshot;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  /** El punto de control: el `seq` del último evento que estaba escrito cuando se guardó el mundo. */
  async lastSeq(_campaignId: Id): Promise<number> { return this.checkpoint; }

  async saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
    await this.queue(() => this.writeWorld(snapshot));
  }

  /** Aquí los cambios sueltos se resuelven reescribiendo el snapshot que el motor nos pasa vía `flush`. */
  async write(_campaignId: Id, changes: Change[]): Promise<void> {
    for (const c of changes) this.pending.set(`${c.collection}/${c.id}`, c);
  }

  /** Llamado por el motor con el snapshot actual para volcar lo pendiente. */
  async flush(snapshot: WorldSnapshot): Promise<void> {
    await this.appending;
    if (this.pending.size === 0) return;
    this.pending.clear();
    await this.saveSnapshot(snapshot);
  }

  /**
   * Las escrituras del mundo y de los tickers, en fila: dos guardados seguidos no se pisan el temporal, y el
   * último en pedirse es el último en quedar (cada uno escribe el estado que hay al tocarle).
   */
  private saving: Promise<void> = Promise.resolve();
  private queue(fn: () => Promise<void>): Promise<void> {
    const next = this.saving.then(fn);
    this.saving = next.catch(() => undefined);
    return next;
  }

  private async writeWorld(snapshot: WorldSnapshot): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const doc = { ...snapshot, _log: { seq: this.seqWritten } };
    await writeAtomic(this.file(`${snapshot.campaign.id}.world.json`), JSON.stringify(doc, null, 1));
  }

  /** Escrituras del log en fila: dos eventos seguidos no se adelantan en el fichero (uno grande tarda más). */
  private appending: Promise<void> = Promise.resolve();

  /** Espera a que el log y el último guardado estén escritos (al cerrar la partida). */
  async settled(): Promise<void> { await this.appending; await this.saving; }

  appendEvent(event: GameEvent): Promise<void> {
    const { event: light, context } = splitDiagnostics(event);
    const line = JSON.stringify(light) + '\n';
    const extra = context === undefined ? null : JSON.stringify({ seq: event.seq, id: event.id, context }) + '\n';
    const next = this.appending.then(async () => {
      await mkdir(this.dir, { recursive: true });
      // El contexto primero: si el proceso muere entre los dos, sobra una línea de contexto, no falta.
      if (extra) await this.append(`${event.campaign_id}.context.jsonl`, extra);
      await this.append(`${event.campaign_id}.events.jsonl`, line);
      this.seqWritten = Math.max(this.seqWritten, event.seq);
    });
    this.appending = next.catch(() => undefined);
    return next;
  }

  private async append(name: string, line: string): Promise<void> {
    const f = this.file(name);
    const fix = this.torn.delete(f) ? '\n' : '';
    await writeFile(f, fix + line, { flag: 'a' });
  }

  async loadEvents(campaignId: Id, afterSeq: number): Promise<GameEvent[]> {
    const f = this.file(`${campaignId}.events.jsonl`);
    let raw: string;
    try {
      raw = await readFile(f, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const { events, torn } = parseLog(raw, f);
    if (torn) this.torn.add(f);
    // Del contexto solo el último byte: no se carga, pero si quedó a medias la siguiente línea va aparte.
    const ctx = this.file(`${campaignId}.context.jsonl`);
    if (await endsTorn(ctx)) this.torn.add(ctx);
    const out: GameEvent[] = [];
    for (const e of events) {
      this.seqWritten = Math.max(this.seqWritten, e.seq);
      if (e.seq > afterSeq) out.push(splitDiagnostics(e).event);
    }
    return out;
  }

  async loadTicker(campaignId: Id, name: string): Promise<TickerState | null> {
    return (await this.readTickers(campaignId))[name] ?? null;
  }

  async saveTicker(campaignId: Id, name: string, state: TickerState): Promise<void> {
    await this.queue(async () => {
      await mkdir(this.dir, { recursive: true });
      const all = await this.readTickers(campaignId).catch(() => ({} as Record<string, TickerState>));
      all[name] = state;
      await writeAtomic(this.file(`${campaignId}.tickers.json`), JSON.stringify(all, null, 1));
    });
  }

  private async readTickers(campaignId: Id): Promise<Record<string, TickerState>> {
    try {
      return JSON.parse(await readFile(this.file(`${campaignId}.tickers.json`), 'utf8')) as Record<string, TickerState>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }

  /** Temporales de un guardado que no llegó a renombrarse (el proceso murió a mitad): no valen para nada. */
  private async dropTemps(campaignId: Id): Promise<void> {
    let names: string[];
    try { names = await readdir(this.dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith(`${campaignId}.`) && n.endsWith('.tmp')) await rm(this.file(n), { force: true }).catch(() => {});
    }
  }
}

/**
 * Las líneas del registro. Una última línea a medias (el proceso murió escribiéndola) se descarta con un aviso;
 * una rota en medio es un fichero dañado y se dice.
 */
function parseLog(raw: string, file: string): { events: GameEvent[]; torn: boolean } {
  const lines = raw.split('\n');
  const torn = raw.length > 0 && !raw.endsWith('\n');
  const events: GameEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    try {
      events.push(JSON.parse(l) as GameEvent);
    } catch (e) {
      if (torn && i === lines.length - 1) {
        console.warn(`[persistencia] ${file}: la última línea quedó a medias (${l.length} caracteres); se descarta`);
        continue;
      }
      throw new Error(`${file}, línea ${i + 1}: ${(e as Error).message}`);
    }
  }
  return { events, torn };
}

/** ¿El fichero existe y no acaba en salto de línea? Lee un byte. */
async function endsTorn(file: string): Promise<boolean> {
  let fh;
  try { fh = await open(file, 'r'); } catch { return false; }
  try {
    const { size } = await fh.stat();
    if (size === 0) return false;
    const b = Buffer.alloc(1);
    await fh.read(b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } finally { await fh.close(); }
}

let tmpCount = 0;

/** Escribe en un temporal junto al fichero y lo renombra encima: o queda el nuevo entero o el anterior. */
export async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}-${++tmpCount}.tmp`;
  try {
    await writeFile(tmp, data);
    await renameRetry(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** En Windows, renombrar encima de un fichero que alguien tiene abierto (un antivirus, un lector) falla un momento. */
async function renameRetry(from: string, to: string, attempts = 8): Promise<void> {
  for (let i = 0; ; i++) {
    try { await rename(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= attempts - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
      await new Promise((r) => setTimeout(r, 25 * (i + 1)));
    }
  }
}

/**
 * El registro entero de una carpeta de datos, con el contexto del máster de vuelta en cada evento (o sin él,
 * con `context: false`). Síncrono, para las herramientas de análisis (scripts/judge.ts) y la migración.
 */
export function readEventsSync(dir: string, campaignId: Id, opts: { context?: boolean } = {}): GameEvent[] {
  const f = join(dir, `${campaignId}.events.jsonl`);
  if (!existsSync(f)) return [];
  const { events } = parseLog(readFileSync(f, 'utf8'), f);
  if (opts.context === false) return events.map((e) => splitDiagnostics(e).event);
  const cf = join(dir, `${campaignId}.context.jsonl`);
  if (!existsSync(cf)) return events;
  const ctx = new Map<number, unknown>();
  for (const { seq, context } of parseLines<{ seq: number; context: unknown }>(readFileSync(cf, 'utf8'))) ctx.set(seq, context);
  return events.map((e) => (ctx.has(e.seq) ? joinDiagnostics(e, ctx.get(e.seq)) : e));
}

/** Líneas JSON, sin la última si quedó a medias. */
function parseLines<T>(raw: string): T[] {
  const out: T[] = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l) as T); } catch { /* línea a medias */ }
  }
  return out;
}

/** Un mundo entero de una carpeta de datos (para pasarlo a la base), o null si no hay. Lee sin escribir nada. */
export function readJsonWorld(dir: string, campaignId: Id): WorldDump | null {
  const wf = join(dir, `${campaignId}.world.json`);
  if (!existsSync(wf)) return null;
  const { _log, ...snapshot } = JSON.parse(readFileSync(wf, 'utf8')) as WorldSnapshot & { _log?: unknown };
  void _log;
  const tf = join(dir, `${campaignId}.tickers.json`);
  const tickers = existsSync(tf) ? JSON.parse(readFileSync(tf, 'utf8')) as Record<string, TickerState> : {};
  return { snapshot: snapshot as WorldSnapshot, events: readEventsSync(dir, campaignId), tickers };
}

/**
 * Escribe un mundo entero en una carpeta de datos, en el formato de ahora (registro y contexto aparte, punto de
 * control). Sustituye lo que hubiera de esa campaña en la carpeta.
 */
export async function writeJsonWorld(dir: string, w: WorldDump): Promise<void> {
  const id = w.snapshot.campaign.id;
  await mkdir(dir, { recursive: true });
  const log: string[] = [];
  const ctx: string[] = [];
  let seq = 0;
  for (const e of w.events) {
    const { event, context } = splitDiagnostics(e);
    log.push(JSON.stringify(event) + '\n');
    if (context !== undefined) ctx.push(JSON.stringify({ seq: e.seq, id: e.id, context }) + '\n');
    seq = Math.max(seq, e.seq);
  }
  await writeAtomic(join(dir, `${id}.events.jsonl`), log.join(''));
  if (ctx.length) await writeAtomic(join(dir, `${id}.context.jsonl`), ctx.join(''));
  else await rm(join(dir, `${id}.context.jsonl`), { force: true });
  await writeAtomic(join(dir, `${id}.tickers.json`), JSON.stringify(w.tickers, null, 1));
  await writeAtomic(join(dir, `${id}.world.json`), JSON.stringify({ ...w.snapshot, _log: { seq } }, null, 1));
}
