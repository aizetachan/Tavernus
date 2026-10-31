/**
 * Datos de /admin/estado (page-status.ts): acciones, errores y coste estimado del máster en la última hora
 * y en el día, y qué versión está en marcha.
 *
 * Los contadores van por minutos en <carpeta de partidas>/.estado.json: un despliegue reinicia el servicio y
 * el coste del día no puede volver a cero con él. Si el proceso cae de golpe se pierde como mucho FLUSH_MS.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dayIn } from '../../ai/budget.js';
import type { MasterCall } from '../../engine/engine.js';
import type { ActionRecord } from './servicelog.js';

export const STATS_FILE = '.estado.json';
const FLUSH_MS = 30_000;
const MINUTE_MS = 60_000;
/** Lo que se guarda: basta para «hoy» en cualquier zona horaria. */
const KEEP_MS = 48 * 3_600_000;

/** Dólares por millón de tokens. La escritura de caché es la de 1 h, la que usa el máster. */
export interface ModelPrice { input: number; output: number; cache_read: number; cache_write: number }

/** Tarifa de la API de Anthropic en octubre de 2026 (Haiku 5.5, la de prompts de hasta 100 000 tokens). */
const PRICES: readonly (readonly [string, ModelPrice])[] = [
  ['claude-fable-5-1', { input: 10, output: 50, cache_read: 0.25, cache_write: 20 }],
  ['claude-fable-5', { input: 10, output: 50, cache_read: 1, cache_write: 20 }],
  ['claude-opus-5-5', { input: 4, output: 20, cache_read: 0.2, cache_write: 8 }],
  ['claude-opus-5', { input: 5, output: 25, cache_read: 0.5, cache_write: 10 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cache_read: 0.2, cache_write: 4 }],
  ['claude-sonnet-5', { input: 2, output: 10, cache_read: 0.2, cache_write: 4 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.2 }],
];

export interface TokenUsage { input?: number; output?: number; cache_read?: number; cache_write?: number }

/** Coste en dólares de esos tokens, o null si no se conoce el precio de ese modelo. */
export function costOf(model: string, u: TokenUsage): number | null {
  const p = PRICES.find(([id]) => model === id || model.startsWith(`${id}-20`))?.[1];
  if (!p) return null;
  return ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output + (u.cache_read ?? 0) * p.cache_read + (u.cache_write ?? 0) * p.cache_write) / 1_000_000;
}

export interface Totals {
  /** Acciones de los jugadores (act, say, roll…). */
  actions: number;
  /** Acciones que lanzaron una excepción, sin que el máster tuviera que ver. */
  action_errors: number;
  master_calls: number;
  master_errors: number;
  tokens: number;
  usd: number;
  /** Llamadas con tokens de un modelo sin precio: el coste se queda corto. */
  unpriced: number;
}

const zero = (): Totals => ({ actions: 0, action_errors: 0, master_calls: 0, master_errors: 0, tokens: 0, usd: 0, unpriced: 0 });

export class ServiceStats {
  private readonly minutes = new Map<number, Totals>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string | null, private readonly tz: string, private readonly now: () => number = Date.now) {
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { minutes?: [number, Partial<Totals>][] };
      for (const [t, v] of saved.minutes ?? []) if (t >= this.now() - KEEP_MS) this.minutes.set(t, { ...zero(), ...v });
    } catch { /* primera vez, o fichero roto: se empieza de cero */ }
  }

  /** Del registro de acciones (servicelog.ts). */
  action(r: ActionRecord): void {
    const t = this.current();
    t.actions++;
    if (r.result === 'error' && !r.calls.some((c) => !c.ok)) t.action_errors++;
    this.touch();
  }

  /** Del motor (engine.onMaster), con lo que gastó el actor que dio voz al NPC. */
  master(c: MasterCall): void {
    const t = this.current();
    t.master_calls++;
    if (!c.ok) t.master_errors++;
    if (c.model && c.usage) this.add(t, c.model, c.usage);
    if (c.actor) this.add(t, c.actor.model, c.actor);
    this.touch();
  }

  /** Gasto del máster fuera de una llamada (prólogo y recapitulación, master.write). */
  spend(model: string, u: TokenUsage): void {
    this.add(this.current(), model, u);
    this.touch();
  }

  lastHour(): Totals { const since = this.now() - 3_600_000; return this.sum((t) => t >= since); }

  /** Desde la medianoche en la zona del cupo (BUDGET_TZ). */
  today(): Totals { const day = dayIn(this.tz, this.now()); return this.sum((t) => dayIn(this.tz, t) === day); }

  /** Lo vuelca al disco ya (al parar el servidor). */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.file) return;
    const since = this.now() - KEEP_MS;
    for (const t of this.minutes.keys()) if (t < since) this.minutes.delete(t);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, minutes: [...this.minutes] }), 'utf8');
      renameSync(`${this.file}.tmp`, this.file);
    } catch (e) {
      console.error('[web] estado:', (e as Error).message);
    }
  }

  private add(t: Totals, model: string, u: TokenUsage): void {
    const tokens = (u.input ?? 0) + (u.output ?? 0) + (u.cache_read ?? 0) + (u.cache_write ?? 0);
    t.tokens += tokens;
    const usd = costOf(model, u);
    if (usd !== null) t.usd += usd;
    else if (tokens) t.unpriced++;
  }

  private current(): Totals {
    const at = Math.floor(this.now() / MINUTE_MS) * MINUTE_MS;
    let t = this.minutes.get(at);
    if (!t) { t = zero(); this.minutes.set(at, t); }
    return t;
  }

  private touch(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  private sum(keep: (minute: number) => boolean): Totals {
    const out = zero();
    for (const [at, t] of this.minutes) {
      if (!keep(at)) continue;
      for (const k of Object.keys(out) as (keyof Totals)[]) out[k] += t[k];
    }
    return out;
  }
}

export interface ServerVersion { release: string | null; commit: string | null }

/** La carpeta de versión en la ruta del código: /opt/tavernus/releases/<fecha>/dist/… (deploy/release.sh). */
export function releaseOf(path: string): string | null {
  return /[\\/]releases[\\/]([^\\/]+)[\\/]/.exec(path)?.[1] ?? null;
}

let version: Promise<ServerVersion> | null = null;

/**
 * Qué versión está en marcha: la carpeta de `releases` (Node resuelve el enlace `current`, así que es la que
 * corre, no la última subida) y, fuera del servidor, donde sí hay repositorio, el commit.
 */
export function serverVersion(): Promise<ServerVersion> {
  version ??= (async () => {
    const here = realpathSync(fileURLToPath(import.meta.url));
    const release = releaseOf(here);
    if (release) return { release, commit: null };
    const commit = await promisify(execFile)('git', ['rev-parse', '--short', 'HEAD'], { cwd: dirname(here), timeout: 3000, windowsHide: true })
      .then((r) => r.stdout.trim() || null, () => null);
    return { release: null, commit };
  })();
  return version;
}

/** En una línea, para el reporte y la página. */
export function versionLabel(v: ServerVersion): string | null {
  return v.release ?? (v.commit ? `commit ${v.commit}` : null);
}
