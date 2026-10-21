/**
 * Informe comparativo del banco del máster: lee varios JSON de scripts/model-bench.ts y escribe
 * data/local/bench/report.md con la tabla de costes y latencias, la estimación por modelo y,
 * por cada acción de la ruta, las narraciones de cada pasada en columnas para juzgar la calidad.
 *
 *   npm run bench:report -- data/local/bench/a.json data/local/bench/b.json
 *   npm run bench:report                         (todos los .json de data/local/bench)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { BASELINE_CALL, CACHE_WRITE_MULT, estimateRun, PRICES, usd } from './bench-prices.js';

import type { BenchRun, Route } from './model-bench.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string', default: 'data/local/bench/report.md' }, route: { type: 'string', default: 'scripts/bench-route.json' } },
});

const dir = 'data/local/bench';
const files = positionals.length ? positionals : readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, f));
if (files.length === 0) { console.error('No hay JSON que comparar. Ejecuta antes npm run bench -- --dry-run.'); process.exit(1); }
const runs = files.map((f) => ({ file: basename(f), run: JSON.parse(readFileSync(f, 'utf8')) as BenchRun }));
const route = JSON.parse(readFileSync(values.route, 'utf8')) as Route;

/** Celda de tabla markdown: sin barras ni saltos de línea crudos. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const num = (n: number) => String(Math.round(n));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const name = (r: BenchRun) => `${r.dry_run ? '[dry-run] ' : ''}${r.model} / ${r.effort}`;

const out: string[] = [];
out.push('# Banco del máster: comparativa de modelos', '');
out.push(`Ruta **${route.name}** (${route.actions.length} acciones, semilla ${route.seed}): ${route.description}`, '');
out.push(`Generado ${new Date().toISOString()} a partir de ${runs.length} pasada(s).`);
if (runs.some((x) => x.run.dry_run)) out.push('', '> Las pasadas marcadas **[dry-run]** usan un cliente falso con el consumo medio medido de opus-5 low: sus tokens son fijos y su coste solo refleja la tabla de precios, no el comportamiento del modelo. Las narraciones son de relleno.');
out.push('');

// --- Tabla comparativa -------------------------------------------------------
out.push('## Coste, tokens y latencia', '');
out.push('| Pasada | Coste/acción | Total | Entrada media | Salida media | Cache read media | Cache write media | Latencia media/acción | Llamadas | Fallos | Modelos devueltos | Fichero |');
out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
for (const { file, run } of runs) {
  const t = run.totals;
  const n = run.steps.length || 1;
  const returned = [...new Set(run.steps.flatMap((s) => s.models))].join(', ') || '—';
  out.push(`| ${cell(name(run))} | ${usd(t.per_action_usd)} | ${usd(t.cost_usd, 3)} | ${num(t.input / n)} | ${num(t.output / n)} | ${num(t.cache_read / n)} | ${num(t.cache_write / n)} | ${secs(t.avg_ms_per_action)} | ${t.calls} | ${t.failures} | ${cell(returned)} | ${cell(file)} |`);
}
out.push('', 'Tokens medios por acción de la ruta (una acción con tirada suma sus dos llamadas al máster; una llegada narrada tras moverse también cuenta).', '');

const failed = runs.flatMap(({ run }) => run.steps.flatMap((s) => s.calls.filter((c) => !c.ok).map((c) => ({ run, s, c }))));
if (failed.length) {
  out.push('### Fallos', '');
  for (const { run, s, c } of failed) out.push(`- ${name(run)} · ${s.id} (${c.kind}): **${c.reason}** — ${cell(c.message ?? '')}`);
  out.push('');
}

// --- Estimación ---------------------------------------------------------------
const calls = route.actions.length + route.actions.filter((a) => a.expect_roll).length;
out.push('## Estimación de una pasada real', '');
out.push(`Supone ${calls} llamadas al máster (${route.actions.length} acciones + ${calls - route.actions.length} continuación tras tirada), cada una con el consumo medio medido en \`data/local/demo.events.jsonl\` con opus-5 low: ${num(BASELINE_CALL.input)} tokens de entrada, ${num(BASELINE_CALL.output)} de salida y ${num(BASELINE_CALL.cache_read)} leídos de caché. La primera llamada de cada pasada escribe la caché del system prompt en vez de leerla.`, '');
out.push('| Modelo | Entrada / salida ($/M) | Por llamada (caché caliente) | Pasada de 10 acciones | Con salida ×2 (más effort) | Con escritura de caché a 2× |');
out.push('|---|---:|---:|---:|---:|---:|');
for (const [model, p] of Object.entries(PRICES)) {
  const e = estimateRun(model, calls, CACHE_WRITE_MULT)!;
  const e2 = estimateRun(model, calls, 2)!;
  const eOut = estimateRun(model, calls, CACHE_WRITE_MULT, { ...BASELINE_CALL, output: BASELINE_CALL.output * 2 })!;
  const warm = estimateRun(model, 2, CACHE_WRITE_MULT)!;
  out.push(`| ${model} | ${p.input} / ${p.output} | ${usd(warm.total - warm.first_call)} | **${usd(e.total, 3)}** | ${usd(eOut.total, 3)} | ${usd(e2.total, 3)} |`);
}
out.push('');
out.push('Salvedades:');
out.push('- La salida medida es de opus-5 con effort low. Otros modelos y otros esfuerzos piensan más o menos: con effort medium o high la salida puede duplicarse o más, y es la parte cara (cada 1000 tokens de salida extra por llamada son 2,5 céntimos en opus-5 y 0,05 en haiku-5-5); la columna «salida ×2» da una idea.');
out.push('- `master.ts` escribe la caché con `ttl: \'1h\'`, que la API cobra a 2× la entrada, no a 1,25×. Afecta solo a la primera llamada de cada pasada (última columna; `--cache-write-mult 2` en `npm run bench` lo aplica también al coste medido).');
out.push('- Se asume el mismo número de tokens en todos los modelos; si un modelo usa otro tokenizador o encadena más tools por acción, cambia. La pasada real lo medirá.');
out.push('- Avisos conocidos: en opus-5-5 y sonnet-5-5 el `tool_choice` forzado de `master.ts:122` devuelve 400 en la rama de máximo de iteraciones (solo si el modelo agota las llamadas a tools); en haiku-5-5 el parámetro `fallbacks` puede ser rechazado y hacer fallar todas las llamadas. Aparecerán como fallos en la tabla.');
out.push('');

// --- Narraciones por acción ----------------------------------------------------
out.push('## Narraciones por acción', '');
out.push('Una columna por pasada. Debajo de cada narración: tirada (si la hubo), coste, latencia y tools.', '');
for (const a of route.actions) {
  out.push(`### ${a.id} · ${a.kind}${a.expect_roll ? ' · se espera tirada' : ''}`, '', `> ${a.text}`, '');
  out.push(`| ${runs.map(({ run }) => cell(name(run))).join(' | ')} |`);
  out.push(`|${runs.map(() => '---').join('|')}|`);
  const cols = runs.map(({ run }) => {
    const s = run.steps.find((x) => x.id === a.id);
    if (!s) return '_(no está en esta pasada)_';
    const roll = s.rolls.length ? `🎲 ${s.rolls.map((r) => `${r.label}: ${r.breakdown}`).join('; ')}` : s.requested_roll ? '🎲 pidió tirada' : '';
    const meta = [roll, `${usd(s.cost_usd)} · ${secs(s.ms)} · ${s.tools.join(', ') || 'sin tools'}`, s.suggested_actions.length ? `→ ${s.suggested_actions.join(' · ')}` : ''].filter(Boolean);
    return `${s.narration || s.engine_text || '_(vacío)_'}\n\n_${meta.join('_\n_')}_`;
  });
  out.push(`| ${cols.map(cell).join(' | ')} |`, '');
}

writeFileSync(values.out, out.join('\n'));
console.log(`${values.out} (${runs.length} pasadas: ${runs.map(({ run }) => name(run)).join(', ')})`);
