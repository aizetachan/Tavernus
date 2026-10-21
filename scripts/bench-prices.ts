/**
 * Precios del banco de medición del máster (USD por millón de tokens) y coste de un usage.
 * Tabla del dueño (2026-10): lectura de caché al 10 % de la entrada y escritura al 125 %.
 * Ojo: master.ts escribe la caché con ttl '1h', que la API cobra a 2× la entrada, no a 1,25×;
 * --cache-write-mult 2 en los scripts recalcula con ese precio.
 */

export interface Price { input: number; output: number }

export const PRICES: Record<string, Price> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_MULT = 1.25;

export interface TokenUsage { input: number; output: number; cache_read: number; cache_write: number }

/** Precio por id exacto o por prefijo (el modelo devuelto puede llevar sufijo); el prefijo más largo gana. */
export function priceFor(model: string): Price | null {
  if (PRICES[model]) return PRICES[model]!;
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => model.startsWith(k));
  return key ? PRICES[key]! : null;
}

/** Coste en dólares; null si el modelo no está en la tabla. */
export function costUsd(u: TokenUsage, model: string, writeMult = CACHE_WRITE_MULT): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cache_read * p.input * CACHE_READ_MULT + u.cache_write * p.input * writeMult) / 1e6;
}

/**
 * Consumo medio por llamada al máster medido en data/local/demo.events.jsonl
 * (11 llamadas reales de claude-opus-5 con effort low, todas de 1 iteración y con la caché caliente).
 * Es la base de la estimación y de los números del --dry-run.
 */
export const BASELINE_CALL: TokenUsage & { ms: number } = { input: 4489, output: 870, cache_read: 11378, cache_write: 0, ms: 11822 };

/**
 * Estimación de una pasada de la ruta: `calls` llamadas al máster con el consumo base; la primera
 * escribe la caché del system prompt en vez de leerla (modelo nuevo = caché fría).
 */
export function estimateRun(model: string, calls: number, writeMult = CACHE_WRITE_MULT, base: TokenUsage = BASELINE_CALL): { total: number; per_call: number; first_call: number } | null {
  const warm = costUsd(base, model, writeMult);
  const cold = costUsd({ ...base, cache_read: 0, cache_write: base.cache_read }, model, writeMult);
  if (warm === null || cold === null) return null;
  const total = cold + warm * Math.max(0, calls - 1);
  return { total, per_call: total / calls, first_call: cold };
}

export function usd(n: number | null, digits = 4): string {
  return n === null ? '—' : `$${n.toFixed(digits)}`;
}
