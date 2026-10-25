/**
 * Límite de gasto por personaje y día (issue #17, docs/MULTIJUGADOR.md).
 *
 * Envuelve al máster real: cada llamada de `resolve` de un PJ cuenta una acción y
 * sus tokens en el día de hoy (zona BUDGET_TZ, por defecto Europe/Madrid). Al
 * pasar del cupo, ese PJ sigue jugando con el máster offline (narración sencilla,
 * sin API) hasta el día siguiente, y lo lee una vez en su hilo. Nada de errores.
 *
 *   DAILY_MASTER_ACTIONS  acciones con máster real por PJ y día (200; 0 = sin límite)
 *   DAILY_MASTER_TOKENS   tokens por PJ y día (0 = sin límite): entrada + salida +
 *                         escritura de caché + una décima parte de la lectura de caché
 *
 * El recuento vive en <partida>/budget.json: un reinicio no regala cupo.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Engine, MasterLike, MasterResolution } from '../engine/engine.js';
import type { Character, Id } from '../engine/model.js';

export interface BudgetLimits {
  /** Acciones con máster real por PJ y día; 0 = sin límite. */
  actions: number;
  /** Tokens por PJ y día; 0 = sin límite. */
  tokens: number;
  /** Zona horaria del cambio de día. */
  tz: string;
}

export interface BudgetUsage { day: string; actions: number; tokens: number; notified: boolean }

export const DEFAULT_DAILY_ACTIONS = 200;

/** Límites del entorno; null si los dos son 0 (sin límite). */
export function budgetFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits | null {
  const num = (k: string, d: number) => {
    const v = env[k]?.trim();
    const n = v === undefined || v === '' ? d : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const actions = num('DAILY_MASTER_ACTIONS', DEFAULT_DAILY_ACTIONS);
  const tokens = num('DAILY_MASTER_TOKENS', 0);
  if (!actions && !tokens) return null;
  return { actions, tokens, tz: env['BUDGET_TZ']?.trim() || 'Europe/Madrid' };
}

/** Día local (AAAA-MM-DD) en esa zona. */
export function dayIn(tz: string, ms: number): string {
  try { return new Date(ms).toLocaleDateString('sv-SE', { timeZone: tz }); } catch { return new Date(ms).toISOString().slice(0, 10); }
}

/** Tokens que cuentan de una llamada (usage del máster: input, output, cache_read, cache_write). */
export function tokensOf(usage: unknown): number {
  const u = (usage ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  return n('input') + n('output') + n('cache_write') + Math.round(n('cache_read') / 10);
}

/** Libro de gasto de una partida: por PJ, lo de hoy. */
export class BudgetBook {
  private usage: Record<Id, BudgetUsage> = {};

  constructor(readonly limits: BudgetLimits, private readonly file: string | null, private readonly now: () => number = Date.now) {
    if (!file) return;
    try { this.usage = JSON.parse(readFileSync(file, 'utf8')) as Record<Id, BudgetUsage>; } catch { this.usage = {}; }
  }

  today(): string { return dayIn(this.limits.tz, this.now()); }

  of(characterId: Id): BudgetUsage {
    const day = this.today();
    const u = this.usage[characterId];
    if (u && u.day === day) return u;
    const fresh = { day, actions: 0, tokens: 0, notified: false };
    this.usage[characterId] = fresh;
    return fresh;
  }

  exhausted(characterId: Id): boolean {
    const u = this.of(characterId);
    return (this.limits.actions > 0 && u.actions >= this.limits.actions) || (this.limits.tokens > 0 && u.tokens >= this.limits.tokens);
  }

  spend(characterId: Id, tokens: number): void {
    const u = this.of(characterId);
    u.actions += 1;
    u.tokens += tokens;
    this.save();
  }

  /** true la primera vez del día que se pregunta tras agotarse (para avisar una sola vez). */
  takeNotice(characterId: Id): boolean {
    const u = this.of(characterId);
    if (u.notified) return false;
    u.notified = true;
    this.save();
    return true;
  }

  private save(): void {
    if (!this.file) return;
    try { writeFileSync(this.file, JSON.stringify(this.usage), 'utf8'); } catch (e) { console.warn('[budget] no se pudo guardar:', (e as Error).message); }
  }
}

/** Texto del aviso al agotar el cupo. */
export function budgetNotice(limits: BudgetLimits): string {
  const what = limits.actions ? `${limits.actions} acciones con el narrador` : `${limits.tokens.toLocaleString('es-ES')} tokens del narrador`;
  return `⏳ Por hoy has gastado tu cupo (${what}). Hasta medianoche sigues jugando en modo sencillo, sin IA: el mundo responde, pero con frases cortas. Mañana el narrador vuelve.`;
}

/**
 * Máster con cupo: el real mientras quede; agotado, el de reserva (offline). Las
 * llamadas sin PJ (prólogo, recapitulación) no cuentan y van siempre al real.
 */
export class BudgetedMaster implements MasterLike {
  constructor(private readonly engine: Engine, private readonly live: MasterLike, private readonly fallback: MasterLike, readonly book: BudgetBook) {}

  /** Sin `write` en el real (cliente de pruebas), null: el motor usa su plantilla. */
  write(req: Parameters<NonNullable<MasterLike['write']>>[0]): ReturnType<NonNullable<MasterLike['write']>> {
    return this.live.write ? this.live.write(req) : Promise.resolve(null);
  }

  async resolve(actor: Character, ...rest: Parameters<MasterLike['resolve']> extends [Character, ...infer R] ? R : never): Promise<MasterResolution> {
    if (this.book.exhausted(actor.id)) {
      if (this.book.takeNotice(actor.id)) {
        this.engine.events.emit({
          actor_id: actor.id, action_type: 'budget_exhausted', visibility: 'private', narration_private: budgetNotice(this.book.limits), observable: null,
          tags: ['budget'], payload: { day: this.book.today(), limits: this.book.limits },
        });
      }
      return this.fallback.resolve(actor, ...rest);
    }
    const out = await this.live.resolve(actor, ...rest);
    this.book.spend(actor.id, tokensOf(out.usage));
    return out;
  }
}
