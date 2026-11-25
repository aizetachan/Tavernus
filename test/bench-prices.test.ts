import { describe, expect, it } from 'vitest';
import { BASELINE_CALL, costUsd, estimateRun, priceFor } from '../scripts/bench-prices.js';

describe('precios del banco', () => {
  it('la lectura de caché va por modelo: 10 % en Haiku, 5 % en Opus 5.5 y Sonnet 5.5', () => {
    const u = { input: 0, output: 0, cache_read: 1_000_000, cache_write: 0 };
    expect(costUsd(u, 'claude-haiku-5-5')).toBeCloseTo(0.01, 6);
    expect(costUsd(u, 'claude-opus-5-5')).toBeCloseTo(0.2, 6);
    expect(costUsd(u, 'claude-sonnet-5-5')).toBeCloseTo(0.1, 6);
    expect(costUsd(u, 'claude-sonnet-5')).toBeCloseTo(0.2, 6);
  });
  it('entrada, salida y escritura de caché (1,25× o 2× con ttl de 1 h); el sufijo del modelo no importa', () => {
    const u = { input: 1_000_000, output: 100_000, cache_read: 0, cache_write: 100_000 };
    expect(costUsd(u, 'claude-haiku-5-5-20261001')).toBeCloseTo(0.1 + 0.05 + 0.0125, 6);
    expect(costUsd(u, 'claude-haiku-5-5', 2)).toBeCloseTo(0.1 + 0.05 + 0.02, 6);
    expect(priceFor('claude-fable-5-2')).toBeNull();
    expect(costUsd(u, 'claude-fable-5-2')).toBeNull();
  });
  it('la estimación de una pasada escribe la caché en la primera llamada y la lee en las demás', () => {
    const e = estimateRun('claude-haiku-5-5', 10)!;
    const warm = costUsd(BASELINE_CALL, 'claude-haiku-5-5')!;
    expect(e.first_call).toBeGreaterThan(warm);
    expect(e.total).toBeCloseTo(e.first_call + warm * 9, 9);
    expect(e.per_call).toBeCloseTo(e.total / 10, 9);
  });
});
