/**
 * Banco de creatividad del máster: corre los prompts de scripts/creativity-bench.json (imposibles,
 * plausibles que no existen, ambiguos, provocaciones, peticiones meta e inventiva del jugador) contra el máster con Kael en
 * la barra de la taberna, cada uno en una partida nueva, y guarda por prompt la narración, los tools
 * llamados y si cumplió el criterio esperado. Deja un .json y un .md en data/local/bench/.
 *
 *   npm run bench:creativity -- --dry-run                                  cliente falso, no llama a la API
 *   npm run bench:creativity -- --model claude-haiku-5-5 --effort low      solo imprime la estimación de coste
 *   npm run bench:creativity -- --model claude-haiku-5-5 --effort low --live   pasada real (gasta dinero)
 *
 * El juicio es automático y a propósito simple (tools llamados, signos de pregunta, negativas secas,
 * palabras que rompen la cuarta pared): sirve de primer filtro; el ingenio se lee en el .md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import { makeSeed } from '../src/data/seed/demo.js';
import { liveClient, Master, type MasterClient } from '../src/ai/master.js';
import { BASELINE_CALL, CACHE_WRITE_MULT, estimateRun, priceFor, usd } from './bench-prices.js';
import { runBench, type Route, type StepRecord } from './model-bench.js';

export type Expect = 'witty_refusal' | 'rumor' | 'question' | 'in_fiction' | 'character_fact' | 'player_rumor' | 'conditional';
export interface CreativityPrompt { id: string; kind: string; expect: Expect; text: string }
export interface CreativityBench { name: string; description: string; character_id: string; start_spot: string; seed: number; step_real_s: number; max_rolls_per_action: number; prompts: CreativityPrompt[] }

export interface Verdict { pass: boolean; notes: string[] }

export interface CreativityResult {
  id: string; kind: string; expect: Expect; text: string;
  pass: boolean; notes: string[];
  narration: string;
  suggested_actions: string[];
  tools: string[];
  rumors: { name: string; kind: string; hint: string; where: string | null; said_by_actor: boolean; result: string }[];
  facts: { kind: string; text: string; result: string }[];
  requested_roll: unknown;
  cost_usd: number | null;
  ms: number;
}

export interface CreativityRun {
  version: 1; dry_run: boolean; model: string; effort: string; started_at: string;
  bench: { name: string; prompts: number };
  results: CreativityResult[];
  totals: { pass: number; total: number; by_expect: Record<string, { pass: number; total: number }>; cost_usd: number | null; ms: number };
}

/** Tools que no cambian el mundo. */
const READ_TOOLS = new Set(['get_location', 'get_character', 'get_npc', 'get_item', 'who_is_here', 'get_recent_events', 'get_campaign_notes', 'lookup_rule', 'log_event']);
/** Dar o crear cosas: nunca para una provocación ni para algo imposible. */
const GIVING_TOOLS = new Set(['spawn_item', 'transfer_item', 'buy_item', 'sell_item', 'complete_job', 'grant_clue', 'heal']);
const FLAT_NO = /\bno puedes\b|\bno es posible\b|\bes imposible\b|\bno se puede\b|\bno está permitido\b/i;
const META = /\b(?:IA|inteligencia artificial|modelo de lenguaje|prompt|instrucciones del sistema|Claude|Anthropic|base de datos|tools?)\b/i;
const HP_NUMBERS = /\b\d+\s*(?:PG|puntos de golpe)\b/i;

/** ¿Cumplió el criterio? Mira tools (con su resultado), tirada pedida y narración. */
export function judge(expect: Expect, step: StepRecord): Verdict {
  const notes: string[] = [];
  if (step.calls.length === 0) return { pass: false, notes: ['no pasó por el máster (lo resolvió el motor)'] };
  if (step.failures) notes.push(`${step.failures} llamada(s) fallida(s)`);
  const calls = step.calls.flatMap((c) => c.tool_calls);
  const okCall = (name: string) => calls.filter((c) => c.name === name && !c.result.startsWith('{"error"'));
  const rumorOk = okCall('plant_rumor').length > 0;
  const playerRumorOk = okCall('plant_rumor').some((c) => c.input['said_by_actor'] === true);
  const factOk = okCall('record_character_fact').length > 0;
  const writes = calls.filter((c) => !READ_TOOLS.has(c.name) && c.name !== 'plant_rumor' && c.name !== 'record_character_fact').map((c) => c.name);
  const giving = writes.filter((n) => GIVING_TOOLS.has(n));
  const text = step.narration;
  const flatNo = FLAT_NO.exec(text)?.[0];
  const ok = (cond: boolean, note: string) => { if (!cond) notes.push(note); return cond; };

  let pass: boolean;
  switch (expect) {
    case 'witty_refusal':
      pass = [
        ok(!rumorOk, 'sembró un rumor para algo imposible'),
        ok(!factOk, 'guardó como hecho algo imposible'),
        ok(giving.length === 0, `dio o creó cosas: ${giving.join(', ')}`),
        ok(!flatNo, `negativa seca: «${flatNo}»`),
        ok(!step.requested_roll, 'pidió tirada para algo imposible'),
        ok(text.length >= 60, 'respuesta demasiado corta para tener ingenio'),
      ].every(Boolean);
      break;
    case 'rumor':
      pass = [
        ok(rumorOk, calls.some((c) => c.name === 'plant_rumor') ? 'plant_rumor devolvió error' : 'no sembró rumor'),
        ok(!writes.includes('spawn_item'), 'creó un objeto real'),
      ].every(Boolean);
      if (flatNo) notes.push(`(aviso) negativa seca: «${flatNo}»`);
      break;
    case 'question':
      pass = [
        ok(/[¿?]/.test(text), 'no pregunta'),
        ok(writes.length === 0, `ejecutó cambios: ${writes.join(', ')}`),
        ok(!rumorOk, 'sembró un rumor sin saber qué pedía'),
        ok(!step.requested_roll, 'pidió tirada sin saber qué pedía'),
      ].every(Boolean);
      break;
    case 'character_fact':
      pass = [
        ok(factOk, calls.some((c) => c.name === 'record_character_fact') ? 'record_character_fact devolvió error' : 'no guardó el hecho del personaje'),
        ok(giving.length === 0, `dio o creó cosas: ${giving.join(', ')}`),
        ok(!flatNo, `negativa seca: «${flatNo}»`),
      ].every(Boolean);
      break;
    case 'player_rumor':
      pass = [
        ok(playerRumorOk, rumorOk ? 'sembró el rumor sin said_by_actor' : 'no sembró lo que afirma el jugador'),
        ok(writes.length === 0, `lo hizo real: ${writes.join(', ')}`),
        ok(!factOk, 'lo guardó como hecho del personaje, pero toca al mundo'),
      ].every(Boolean);
      break;
    case 'conditional':
      pass = [
        ok(giving.length === 0, `le dio la ventaja gratis: ${giving.join(', ')}`),
        ok(Boolean(step.requested_roll) || rumorOk || factOk || /[¿?]/.test(text), 'ni tirada, ni coste, ni lo deja como dicho'),
        ok(!flatNo, `negativa seca: «${flatNo}»`),
      ].every(Boolean);
      break;
    case 'in_fiction': {
      const meta = META.exec(text)?.[0];
      pass = [
        ok(!meta, `rompe la cuarta pared: «${meta}»`),
        ok(!HP_NUMBERS.test(text), 'da cifras de reglas'),
        ok(giving.length === 0, `dio o creó cosas: ${giving.join(', ')}`),
        ok(!rumorOk, 'sembró un rumor'),
        ok(!factOk, 'guardó un hecho'),
      ].every(Boolean);
      break;
    }
  }
  if (step.failures) pass = false;
  return { pass, notes };
}

/** Cliente falso: la respuesta ideal para cada criterio (con plant_rumor de verdad en los plausibles). */
export function creativityDryClient(bench: CreativityBench): MasterClient {
  const byText = new Map(bench.prompts.map((p) => [p.text, p]));
  const say: Record<Expect, string> = {
    witty_refusal: '[dry-run] Lo intentas con toda la convicción del mundo; el mundo, con la suya, sigue exactamente igual, y Brenna enarca una ceja.',
    rumor: '[dry-run] Brenna se encoge de hombros: algo de eso se oyó una vez, entre jarra y jarra. Quizá Doro, en el portón, sepa más.',
    question: '[dry-run] Te quedas a medio gesto. ¿Qué quieres hacer exactamente, y con qué?',
    in_fiction: '[dry-run] El fuego chasquea; Brenna sigue secando jarras como si no hubieras dicho nada.',
    character_fact: '[dry-run] Brenna asiente despacio, como quien guarda una historia ajena en el mismo cajón que las suyas.',
    player_rumor: '[dry-run] Brenna te mira por encima de la jarra: eso del pozo no lo había oído. Ahora lo ha oído.',
    conditional: '[dry-run] Brenna cruza los brazos. Si tu tío es el dueño, tendrás que convencerla de ello.',
  };
  /** Primera llamada de los que siembran algo: el tool que toca antes del cierre. */
  const firstTool = (expect: Expect, id: string): { name: string; input: Record<string, unknown> } | null =>
    expect === 'rumor' ? { name: 'plant_rumor', input: { kind: 'rumor', name: `lo que busca Kael (${id})`, hint: 'alguien lo mencionó una vez, entre jarra y jarra', where: null, said_by_actor: false } }
    : expect === 'player_rumor' ? { name: 'plant_rumor', input: { kind: 'place', name: `lo que cuenta Kael (${id})`, hint: 'un pasadizo bajo el pozo que baja a la montaña', where: 'el pozo de la plaza', said_by_actor: true } }
    : expect === 'character_fact' ? { name: 'record_character_fact', input: { kind: 'background', text: `Lo que Kael cuenta de sí (${id}).` } }
    : null;
  let n = 0;
  return {
    async create(params: Anthropic.Beta.MessageCreateParamsNonStreaming) {
      n++;
      const first = params.messages[0];
      const context = first && typeof first.content === 'string' ? first.content : '';
      const action = /^## Acción del jugador\n«([\s\S]*?)»/m.exec(context)?.[1] ?? '';
      const p = byText.get(action);
      const expect = p?.expect ?? 'in_fiction';
      const pre = params.messages.length === 1 ? firstTool(expect, p?.id ?? '?') : null;
      const roll = expect === 'conditional' && params.messages.length === 1;
      const block = pre
        ? { type: 'tool_use', id: `toolu_dry_${n}`, ...pre }
        : {
            type: 'tool_use', id: `toolu_dry_${n}`, name: 'log_event',
            input: {
              narration_private: say[expect], observable: null, observable_vague: null, loudness: 1, tags: 'dry-run',
              suggested_actions: roll ? '' : expect === 'rumor' ? 'Preguntar a Doro en el portón | Mirar el tablón' : 'Mirar alrededor | Pedir una cerveza',
              requires_roll_kind: roll ? 'skill' : null, requires_roll_key: roll ? 'deception' : null, requires_roll_dc: roll ? 15 : null, requires_roll_advantage: roll ? 'none' : null, requires_roll_target: null,
              decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false,
            },
          };
      const cold = n === 1;
      return {
        id: `msg_dry_${n}`, type: 'message', role: 'assistant', model: params.model, content: [block], stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: BASELINE_CALL.input, output_tokens: BASELINE_CALL.output, cache_read_input_tokens: cold ? 0 : BASELINE_CALL.cache_read, cache_creation_input_tokens: cold ? BASELINE_CALL.cache_read : 0 },
      } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

/** Llamadas esperadas: una por prompt, y otra más en los que siembran algo (el tool y luego log_event) o piden tirada. */
export function expectedCalls(bench: CreativityBench): number {
  return bench.prompts.length + bench.prompts.filter((p) => ['rumor', 'player_rumor', 'character_fact', 'conditional'].includes(p.expect)).length;
}

/** Corre el banco. Cada prompt en una partida nueva, para que no arrastre rumores ni presupuesto. */
export async function runCreativity(opts: { bench: CreativityBench; model: string; effort: string; dryRun: boolean; client?: MasterClient; writeMult?: number; log?: (s: string) => void }): Promise<CreativityRun> {
  const { bench, model, effort, dryRun } = opts;
  const client = dryRun ? creativityDryClient(bench) : opts.client;
  if (!client) throw new Error('runCreativity: falta el cliente (o dryRun)');
  const log = opts.log ?? (() => undefined);
  const started = new Date().toISOString();
  const results: CreativityResult[] = [];
  for (const [i, p] of bench.prompts.entries()) {
    const route: Route = {
      name: `${bench.name}/${p.id}`, description: p.kind, character_id: bench.character_id, start_spot: bench.start_spot,
      seed: bench.seed + i, step_real_s: bench.step_real_s, max_rolls_per_action: bench.max_rolls_per_action,
      actions: [{ id: p.id, kind: p.kind, text: p.text }],
    };
    const run = await runBench({ route, model, effort, dryRun: false, client, ...(opts.writeMult ? { writeMult: opts.writeMult } : {}) });
    const step = run.steps[0]!;
    const v = judge(p.expect, step);
    const rumors = step.calls.flatMap((c) => c.tool_calls).filter((c) => c.name === 'plant_rumor').map((c) => ({
      name: String(c.input['name'] ?? ''), kind: String(c.input['kind'] ?? ''), hint: String(c.input['hint'] ?? ''), said_by_actor: c.input['said_by_actor'] === true,
      where: c.input['where'] == null ? null : String(c.input['where']), result: c.result,
    }));
    const facts = step.calls.flatMap((c) => c.tool_calls).filter((c) => c.name === 'record_character_fact').map((c) => ({
      kind: String(c.input['kind'] ?? ''), text: String(c.input['text'] ?? ''), result: c.result,
    }));
    results.push({
      id: p.id, kind: p.kind, expect: p.expect, text: p.text, pass: v.pass, notes: v.notes, facts,
      narration: step.narration || step.engine_text, suggested_actions: step.suggested_actions, tools: step.tools, rumors,
      requested_roll: step.requested_roll, cost_usd: step.cost_usd, ms: step.ms,
    });
    log(`${p.id} ${v.pass ? '✓' : '✗'} ${p.expect.padEnd(13)} ${usd(step.cost_usd)} · ${step.tools.join(',')}${v.notes.length ? ` · ${v.notes.join('; ')}` : ''}`);
  }
  const by_expect: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    const b = (by_expect[r.expect] ??= { pass: 0, total: 0 });
    b.total++; if (r.pass) b.pass++;
  }
  const costs = results.map((r) => r.cost_usd);
  return {
    version: 1, dry_run: dryRun, model, effort, started_at: started,
    bench: { name: bench.name, prompts: bench.prompts.length },
    results,
    totals: {
      pass: results.filter((r) => r.pass).length, total: results.length, by_expect,
      cost_usd: costs.some((c) => c === null) ? null : costs.reduce<number>((a, c) => a + (c ?? 0), 0),
      ms: results.reduce((a, r) => a + r.ms, 0),
    },
  };
}

const EXPECT_ES: Record<Expect, string> = { witty_refusal: 'rechazo ingenioso', rumor: 'rumor sembrado', question: 'pregunta', in_fiction: 'en ficción', character_fact: 'hecho del personaje', player_rumor: 'rumor del jugador', conditional: 'invento con condiciones' };

/** Informe legible: resumen por criterio y, por prompt, narración, tools y rumores. */
export function creativityReport(run: CreativityRun): string {
  const t = run.totals;
  const L = [
    `# Banco de creatividad: ${run.model} / ${run.effort}${run.dry_run ? ' (dry-run)' : ''}`,
    '',
    `${run.started_at} · ${t.pass}/${t.total} cumplen · coste ${usd(t.cost_usd)} · ${(t.ms / 1000).toFixed(0)} s de máster`,
    '',
    '| criterio | cumplen |', '|---|---|',
    ...Object.entries(t.by_expect).map(([k, v]) => `| ${EXPECT_ES[k as Expect]} | ${v.pass}/${v.total} |`),
    '',
  ];
  for (const r of run.results) {
    L.push(`## ${r.id} ${r.pass ? '✓' : '✗'} ${r.kind} → ${EXPECT_ES[r.expect]}`, '', `> ${r.text}`, '', r.narration.trim(), '');
    L.push(`Tools: ${r.tools.join(', ') || '—'}${r.suggested_actions.length ? ` · Sugerencias: ${r.suggested_actions.join(' | ')}` : ''}`);
    for (const f of r.facts) L.push(`Hecho (${f.kind}): ${f.text}${f.result.startsWith('{"error"') ? ` → ${f.result}` : ''}`);
    for (const rm of r.rumors) L.push(`Rumor${rm.said_by_actor ? ' del jugador' : ''} (${rm.kind}) «${rm.name}»: ${rm.hint}${rm.where ? ` — ${rm.where}` : ''}${rm.result.startsWith('{"error"') ? ` → ${rm.result}` : ''}`);
    if (r.notes.length) L.push(`Notas: ${r.notes.join('; ')}`);
    L.push('');
  }
  return L.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string' }, effort: { type: 'string' },
      'dry-run': { type: 'boolean', default: false }, live: { type: 'boolean', default: false },
      bench: { type: 'string', default: 'scripts/creativity-bench.json' },
      out: { type: 'string', default: 'data/local/bench' },
      'cache-write-mult': { type: 'string' },
    },
  });
  const seedMaster = makeSeed().campaign.master;
  const model = values.model ?? seedMaster.model;
  const effort = values.effort ?? seedMaster.effort;
  const dryRun = values['dry-run'];
  const writeMult = values['cache-write-mult'] ? Number(values['cache-write-mult']) : CACHE_WRITE_MULT;
  if (!priceFor(model)) console.warn(`⚠ ${model} no está en la tabla de precios: el coste saldrá como —`);
  const bench = JSON.parse(readFileSync(values.bench, 'utf8')) as CreativityBench;

  const calls = expectedCalls(bench);
  const est = estimateRun(model, calls, writeMult);
  console.log(`Banco ${bench.name}: ${bench.prompts.length} prompts, ~${calls} llamadas al máster. ${model} / ${effort}.`);
  console.log(`Estimación con el consumo medido de opus-5 low: ${usd(est?.total ?? null)} la pasada (${usd(est?.per_call ?? null)} por llamada).`);
  if (!dryRun && !values.live) {
    console.log('\nNo se ha llamado a la API. Para una pasada real añade --live (gasta dinero); para probar el script, --dry-run.');
    return;
  }
  if (!dryRun && !Master.configured('live')) throw new Error('Falta ANTHROPIC_API_KEY (o ANTHROPIC_AUTH_TOKEN) para --live.');

  const run = await runCreativity({ bench, model, effort, dryRun, ...(dryRun ? {} : { client: liveClient() }), writeMult, log: (s) => console.log(`  ${s}`) });
  mkdirSync(values.out, { recursive: true });
  const stamp = run.started_at.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const base = join(values.out, `creativity-${dryRun ? 'dry-run-' : ''}${model}-${effort}-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(run, null, 2));
  writeFileSync(`${base}.md`, creativityReport(run));
  console.log(`\n${run.totals.pass}/${run.totals.total} cumplen · ${Object.entries(run.totals.by_expect).map(([k, v]) => `${EXPECT_ES[k as Expect]} ${v.pass}/${v.total}`).join(' · ')} · coste ${usd(run.totals.cost_usd)}`);
  console.log(`  → ${base}.json\n  → ${base}.md`);
}

if (process.argv[1] && /creativity-bench\.ts$/.test(process.argv[1])) {
  main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
