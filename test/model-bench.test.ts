import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { effectiveModel } from '../src/ai/master.js';
import { MASTER_ENV, pinMasterEnv, runBench, type Route } from '../scripts/model-bench.js';

const saved = Object.fromEntries(MASTER_ENV.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of MASTER_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('el --model del bench manda sobre el entorno (H5)', () => {
  it('pinMasterEnv pone lo pedido, quita los modelos de escena y lo deja como estaba', () => {
    const env: NodeJS.ProcessEnv = { MASTER_MODEL: 'claude-haiku-5-5', MASTER_EFFORT: 'low', PROLOGUE_MODEL: 'claude-opus-5-5', OTRA: 'x' };
    const pin = pinMasterEnv('claude-sonnet-5-5', 'medium', env);
    expect(pin.changed).toEqual(['MASTER_MODEL=claude-haiku-5-5', 'MASTER_EFFORT=low', 'PROLOGUE_MODEL=claude-opus-5-5']);
    expect(env).toEqual({ MASTER_MODEL: 'claude-sonnet-5-5', MASTER_EFFORT: 'medium', OTRA: 'x' });
    // Lo que el máster usaría, también en el prólogo.
    expect(effectiveModel({ model: 'claude-haiku-5-5', effort: 'low' }, env, 'prologue')).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' });
    pin.restore();
    expect(env).toEqual({ MASTER_MODEL: 'claude-haiku-5-5', MASTER_EFFORT: 'low', PROLOGUE_MODEL: 'claude-opus-5-5', OTRA: 'x' });
    expect(pinMasterEnv('claude-haiku-5-5', 'low', { MASTER_MODEL: 'claude-haiku-5-5' }).changed).toEqual([]);
  });

  it('con MASTER_MODEL=haiku en el entorno, una pasada pedida con sonnet llama a sonnet, avisa y no deja el entorno tocado', async () => {
    process.env['MASTER_MODEL'] = 'claude-haiku-5-5';
    process.env['MASTER_EFFORT'] = 'low';
    const full = JSON.parse(readFileSync('scripts/bench-route.json', 'utf8')) as Route;
    const route: Route = { ...full, actions: full.actions.slice(0, 2) };
    const logs: string[] = [];
    const run = await runBench({ route, model: 'claude-sonnet-5-5', effort: 'medium', dryRun: true, log: (s) => logs.push(s) });
    // El cliente falso devuelve el modelo con el que le llamaron: es lo que pidió el máster.
    expect(new Set(run.steps.flatMap((s) => s.models))).toEqual(new Set(['claude-sonnet-5-5']));
    expect(logs[0]).toMatch(/El entorno pedía otro máster \(MASTER_MODEL=claude-haiku-5-5, MASTER_EFFORT=low\)/);
    expect(process.env['MASTER_MODEL']).toBe('claude-haiku-5-5');
    expect(process.env['MASTER_EFFORT']).toBe('low');
  }, 30_000);
});
