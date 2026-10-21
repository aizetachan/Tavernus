/**
 * Banco de medición del máster: ejecuta la ruta fija de scripts/bench-route.json con un modelo y esfuerzo
 * y guarda, por acción, tokens, coste, latencia y narración en data/local/bench/<modelo>-<effort>-<fecha>.json.
 *
 *   npm run bench -- --dry-run                                  cliente falso, no llama a la API
 *   npm run bench -- --model claude-haiku-5-5 --effort low      solo imprime la estimación de coste
 *   npm run bench -- --model claude-haiku-5-5 --effort low --live   pasada real (gasta dinero)
 *
 * Reproducible: reloj inyectado (avanza step_real_s por acción) y dados con semilla fija por acción,
 * así cada tirada del jugador saca el mismo d20 con cualquier modelo. Si una acción pide tirada,
 * se llama a engine.rollPending y esa segunda llamada cuenta dentro de la misma acción;
 * las llegadas narradas tras un movimiento también.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { makeSeed, SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import { liveClient, Master, type MasterClient, type MasterOutcome } from '../src/ai/master.js';
import { seededRng } from '../src/engine/dice.js';
import { BASELINE_CALL, CACHE_WRITE_MULT, costUsd, estimateRun, priceFor, usd, type TokenUsage } from './bench-prices.js';

export interface RouteAction { id: string; kind: string; text: string; expect_roll?: boolean; dry_run_roll?: { kind: string; key: string; dc: number | null } }
export interface Route { name: string; description: string; character_id: string; start_spot: string; seed: number; step_real_s: number; max_rolls_per_action: number; actions: RouteAction[] }

export interface CallRecord {
  kind: 'action' | 'roll' | 'arrival' | 'decisive_timeout' | 'intro';
  ok: boolean;
  reason: string | null;
  message: string | null;
  model: string | null;
  iterations: number;
  tools: string[];
  usage: TokenUsage;
  ms: number;
  cost_usd: number | null;
  narration: string | null;
  suggested_actions: string[];
  requires_roll: unknown;
}

export interface StepRecord {
  id: string;
  kind: string;
  text: string;
  expect_roll: boolean;
  /** Modelos devueltos por la API (puede diferir del pedido si saltó un fallback). */
  models: string[];
  iterations: number;
  tools: string[];
  input: number; output: number; cache_read: number; cache_write: number;
  /** Suma de los ms del máster en las llamadas de la acción. */
  ms: number;
  cost_usd: number | null;
  narration: string;
  suggested_actions: string[];
  requested_roll: unknown;
  rolls: { label: string; total: number; natural?: number; success: boolean | null; breakdown: string }[];
  calls: CallRecord[];
  failures: number;
  /** Texto que vio el jugador si la acción falló (fallo del máster o parser plano). */
  engine_text: string;
}

export interface BenchRun {
  version: 1;
  dry_run: boolean;
  model: string;
  effort: string;
  started_at: string;
  route: { name: string; seed: number; actions: number };
  cache_write_mult: number;
  steps: StepRecord[];
  totals: { cost_usd: number | null; per_action_usd: number | null; calls: number; failures: number; input: number; output: number; cache_read: number; cache_write: number; ms: number; avg_ms_per_action: number; avg_ms_per_call: number; wall_ms: number };
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Cliente falso: un log_event fijo con el consumo base; pide la tirada de la ruta cuando toca. */
export function dryRunClient(wantRoll: () => RouteAction['dry_run_roll'] | null): MasterClient {
  let n = 0;
  return {
    async create(params: Anthropic.Beta.MessageCreateParamsNonStreaming) {
      n++;
      const first = params.messages[0];
      const context = first && typeof first.content === 'string' ? first.content : '';
      const isRollOutcome = /^## Resultado de la tirada/m.test(context);
      const roll = !isRollOutcome && params.messages.length === 1 ? wantRoll() : null;
      const input = {
        narration_private: isRollOutcome ? `[dry-run] Resultado de la tirada narrado (llamada ${n}).` : `[dry-run] El narrador asiente y la escena sigue (llamada ${n}).`,
        observable: null, observable_vague: null, loudness: 1, tags: 'dry-run',
        suggested_actions: 'Mirar alrededor | Esperar',
        requires_roll_kind: roll?.kind ?? null, requires_roll_key: roll?.key ?? null, requires_roll_dc: roll?.dc ?? null, requires_roll_advantage: roll ? 'none' : null, requires_roll_target: null,
        decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, introduces_self: false,
      };
      const cold = n === 1;
      const msg = {
        id: `msg_dry_${n}`, type: 'message', role: 'assistant', model: params.model,
        content: [{ type: 'tool_use', id: `toolu_dry_${n}`, name: 'log_event', input }],
        stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: BASELINE_CALL.input, output_tokens: BASELINE_CALL.output, cache_read_input_tokens: cold ? 0 : BASELINE_CALL.cache_read, cache_creation_input_tokens: cold ? BASELINE_CALL.cache_read : 0 },
      };
      return msg as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

function callRecord(kind: CallRecord['kind'], out: MasterOutcome, fallbackModel: string, writeMult: number): CallRecord {
  const u = out.usage ?? { input: 0, output: 0, cache_read: 0, cache_write: 0, iterations: 0, ms: 0 };
  const usage = { input: u.input, output: u.output, cache_read: u.cache_read, cache_write: u.cache_write };
  const model = out.ok ? out.model : null;
  const calls = out.calls ?? [];
  return {
    kind, ok: out.ok, reason: out.ok ? null : out.reason, message: out.ok ? null : out.message, model,
    iterations: u.iterations, tools: calls.map((c) => c.name), usage, ms: u.ms,
    cost_usd: costUsd(usage, model ?? fallbackModel, writeMult),
    narration: out.ok ? out.closed.narration_private : null,
    suggested_actions: out.ok ? out.closed.suggested_actions : [],
    requires_roll: out.ok ? out.closed.requires_roll ?? null : null,
  };
}

function stepRecord(a: RouteAction, calls: CallRecord[], rolls: StepRecord['rolls'], engineText: string): StepRecord {
  const sum = (f: (c: CallRecord) => number) => calls.reduce((acc, c) => acc + f(c), 0);
  const costs = calls.map((c) => c.cost_usd);
  const label: Record<CallRecord['kind'], string> = { action: '', roll: '[tras la tirada] ', arrival: '[llegada] ', decisive_timeout: '[ventana expirada] ', intro: '[intro] ' };
  const lastOk = [...calls].reverse().find((c) => c.ok);
  return {
    id: a.id, kind: a.kind, text: a.text, expect_roll: Boolean(a.expect_roll),
    models: [...new Set(calls.map((c) => c.model).filter((m): m is string => Boolean(m)))],
    iterations: sum((c) => c.iterations),
    tools: calls.flatMap((c) => c.tools),
    input: sum((c) => c.usage.input), output: sum((c) => c.usage.output), cache_read: sum((c) => c.usage.cache_read), cache_write: sum((c) => c.usage.cache_write),
    ms: sum((c) => c.ms),
    cost_usd: costs.some((c) => c === null) ? null : costs.reduce<number>((acc, c) => acc + (c ?? 0), 0),
    narration: calls.map((c) => c.ok ? `${label[c.kind]}${c.narration ?? ''}` : `${label[c.kind]}✗ ${c.reason}: ${c.message}`).join('\n\n'),
    suggested_actions: lastOk?.suggested_actions ?? [],
    requested_roll: calls.find((c) => c.requires_roll)?.requires_roll ?? null,
    rolls, calls,
    failures: calls.filter((c) => !c.ok).length,
    engine_text: engineText,
  };
}

/** Ejecuta la ruta. Exportado para poder probarlo sin la CLI. */
export async function runBench(opts: { route: Route; model: string; effort: string; dryRun: boolean; client?: MasterClient; writeMult?: number; log?: (s: string) => void }): Promise<BenchRun> {
  const { route, model, effort, dryRun } = opts;
  const writeMult = opts.writeMult ?? CACHE_WRITE_MULT;
  const log = opts.log ?? (() => undefined);
  let clock = SEED_REAL_EPOCH_MS;
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed: makeSeed(), now: () => clock });
  engine.world.campaign.master = { ...engine.world.campaign.master, model, effort: effort as 'low' };
  const ch = engine.world.character(route.character_id);
  ch.location = { type: 'spot', id: route.start_spot };

  let dryRoll: RouteAction['dry_run_roll'] | null = null;
  const client = dryRun ? dryRunClient(() => { const r = dryRoll; dryRoll = null; return r ?? null; }) : opts.client;
  if (!client) throw new Error('runBench: falta el cliente (o dryRun)');
  const master = new Master(engine, { client, rng: seededRng(route.seed) });
  let current: CallRecord[] = [];
  const inflight = new Set<Promise<unknown>>();
  engine.attachMaster({
    resolve: (...args: Parameters<Master['resolve']>) => {
      const [, , roll, intro, scene] = args;
      const kind: CallRecord['kind'] = roll ? 'roll' : intro ? 'intro' : scene ?? 'action';
      const p = master.resolve(...args).then((out) => { current.push(callRecord(kind, out, model, writeMult)); return out; });
      inflight.add(p);
      void p.finally(() => inflight.delete(p));
      return p;
    },
  });
  let rolls: StepRecord['rolls'] = [];
  engine.events.onEvent((e) => {
    if (e.action_type === 'roll' && e.actor_id === ch.id) {
      const r = e.payload['roll'] as { label: string; total: number; natural?: number; success: boolean | null; breakdown: string };
      rolls.push({ label: r.label, total: r.total, success: r.success, breakdown: r.breakdown, ...(r.natural ? { natural: r.natural } : {}) });
    }
  });
  /** Espera a las llamadas lanzadas en segundo plano (llegadas narradas). */
  const settle = async () => {
    for (let k = 0; k < 50; k++) {
      await new Promise((res) => setImmediate(res));
      if (inflight.size === 0 && k >= 3) return;
      await Promise.allSettled([...inflight]);
    }
  };

  const steps: StepRecord[] = [];
  const wall0 = Date.now();
  for (const [i, a] of route.actions.entries()) {
    current = []; rolls = [];
    dryRoll = a.dry_run_roll ?? null;
    // Dados del jugador: semilla fija por acción y por tirada, independiente de lo que hicieran las acciones anteriores.
    Math.random = seededRng(route.seed + i * 10);
    let r = await engine.act(ch.id, a.text);
    const texts = [r.text];
    for (let k = 0; r.requires_roll && k < route.max_rolls_per_action; k++) {
      Math.random = seededRng(route.seed + i * 10 + k + 1);
      r = await engine.rollPending(ch.id);
      texts.push(r.text);
    }
    clock += route.step_real_s * 1000;
    await engine.tick();
    for (let k = 0; ch.transit && k < 120; k++) { clock += 5000; await engine.tick(); }
    await settle();
    const step = stepRecord(a, current, rolls, current.every((c) => c.ok) && current.length > 0 ? '' : texts.join('\n'));
    steps.push(step);
    log(`${a.id} ${step.failures ? '✗' : '✓'} ${usd(step.cost_usd)} · ${(step.ms / 1000).toFixed(1)}s · in ${step.input} out ${step.output} cr ${step.cache_read} cw ${step.cache_write} · ${step.tools.join(',')}${step.rolls.length ? ` · 🎲 ${step.rolls.map((x) => `${x.label} ${x.total}${x.success === null ? '' : x.success ? ' ✓' : ' ✗'}`).join(', ')}` : ''}`);
  }

  const all = steps.flatMap((s) => s.calls);
  const sum = (f: (s: StepRecord) => number) => steps.reduce((acc, s) => acc + f(s), 0);
  const cost = steps.some((s) => s.cost_usd === null) ? null : sum((s) => s.cost_usd ?? 0);
  const ms = sum((s) => s.ms);
  return {
    version: 1, dry_run: dryRun, model, effort, started_at: new Date(wall0).toISOString(),
    route: { name: route.name, seed: route.seed, actions: route.actions.length },
    cache_write_mult: writeMult,
    steps,
    totals: {
      cost_usd: cost, per_action_usd: cost === null ? null : cost / steps.length,
      calls: all.length, failures: all.filter((c) => !c.ok).length,
      input: sum((s) => s.input), output: sum((s) => s.output), cache_read: sum((s) => s.cache_read), cache_write: sum((s) => s.cache_write),
      ms, avg_ms_per_action: ms / steps.length, avg_ms_per_call: all.length ? ms / all.length : 0,
      wall_ms: Date.now() - wall0,
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string' }, effort: { type: 'string' },
      'dry-run': { type: 'boolean', default: false }, live: { type: 'boolean', default: false },
      route: { type: 'string', default: 'scripts/bench-route.json' },
      out: { type: 'string', default: 'data/local/bench' },
      'cache-write-mult': { type: 'string' },
    },
  });
  const seedMaster = makeSeed().campaign.master;
  const model = values.model ?? seedMaster.model;
  const effort = values.effort ?? seedMaster.effort;
  const dryRun = values['dry-run'];
  const writeMult = values['cache-write-mult'] ? Number(values['cache-write-mult']) : CACHE_WRITE_MULT;
  if (!EFFORTS.includes(effort)) throw new Error(`--effort debe ser uno de ${EFFORTS.join(', ')}`);
  if (!priceFor(model)) console.warn(`⚠ ${model} no está en la tabla de precios: el coste saldrá como —`);
  const route = JSON.parse(readFileSync(values.route, 'utf8')) as Route;

  const expectedCalls = route.actions.length + route.actions.filter((a) => a.expect_roll).length;
  const est = estimateRun(model, expectedCalls, writeMult);
  console.log(`Ruta ${route.name}: ${route.actions.length} acciones, ~${expectedCalls} llamadas al máster. ${model} / ${effort}.`);
  console.log(`Estimación con el consumo medido de opus-5 low: ${usd(est?.total ?? null)} la pasada (${usd(est?.per_call ?? null)} por llamada).`);

  if (!dryRun && !values.live) {
    console.log('\nNo se ha llamado a la API. Para una pasada real añade --live (gasta dinero); para probar el script, --dry-run.');
    return;
  }
  if (!dryRun && !Master.configured('live')) throw new Error('Falta ANTHROPIC_API_KEY (o ANTHROPIC_AUTH_TOKEN) para --live.');

  const run = await runBench({ route, model, effort, dryRun, ...(dryRun ? {} : { client: liveClient() }), writeMult, log: (s) => console.log(`  ${s}`) });

  mkdirSync(values.out, { recursive: true });
  const stamp = run.started_at.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const file = join(values.out, `${dryRun ? 'dry-run-' : ''}${model}-${effort}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(run, null, 2));

  const t = run.totals;
  console.log(`\n${dryRun ? '[dry-run] ' : ''}${model} / ${effort}`);
  console.log(`  coste total        ${usd(t.cost_usd)}`);
  console.log(`  media por acción   ${usd(t.per_action_usd)}`);
  console.log(`  latencia media     ${(t.avg_ms_per_action / 1000).toFixed(1)} s por acción · ${(t.avg_ms_per_call / 1000).toFixed(1)} s por llamada`);
  console.log(`  llamadas / fallos  ${t.calls} / ${t.failures}`);
  console.log(`  tokens             in ${t.input} · out ${t.output} · cache_read ${t.cache_read} · cache_write ${t.cache_write}`);
  console.log(`  → ${file}`);
}

if (process.argv[1] && /model-bench\.ts$/.test(process.argv[1])) {
  main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
