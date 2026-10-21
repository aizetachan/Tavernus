/**
 * Tamaño del contexto dinámico del máster (actionContext) por sección, en tres situaciones fijas.
 *   node --env-file-if-exists=.env --import tsx scripts/context-size.ts [--json] [--print]
 * Con ANTHROPIC_API_KEY cuenta tokens exactos con messages.countTokens (gratis); sin ella, chars/4.
 * CONTEXT_MODULE=ruta/a/prompt.ts mide otra versión de actionContext (para comparar antes/después).
 */
import Anthropic from '@anthropic-ai/sdk';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { makeSeed, SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import type { RollContext } from '../src/ai/prompt.js';
import { characterCheck } from '../src/engine/rules.js';
import { seededRng } from '../src/engine/dice.js';

const mod = (process.env['CONTEXT_MODULE'] ? await import(pathToFileURL(resolve(process.env['CONTEXT_MODULE'])).href) : await import('../src/ai/prompt.js')) as typeof import('../src/ai/prompt.js');

/**
 * Historial de Kael: longitudes de los 12 últimos textos que recibió en el log real
 * (data/local/demo.events.jsonl): narraciones del máster, resultados de tirada cortos, la llegada.
 */
const HISTORY = [242, 286, 38, 299, 303, 322, 361, 196, 58, 424, 387, 389];
const PROSE = 'Brenna deja la jarra sobre la barra sin mirarte. El humo de la chimenea se queda bajo las vigas y huele a resina vieja. Dos parroquianos callan cuando pasas y vuelven a sus dados. Afuera, el viento empuja la puerta entornada contra el marco. Notas el peso de la daga en la mano y el frío que se cuela por las rendijas. Al fondo, alguien arrastra un banco; la tabernera levanta la vista un instante y vuelve a su jarra, sin prisa.';

async function boot(history: number): Promise<Engine> {
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed: makeSeed(), now: () => SEED_REAL_EPOCH_MS });
  for (const [i, len] of HISTORY.slice(0, history).entries()) {
    engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', input_text: `acción ${i + 1}`, narration_private: `(${i + 1}) ${PROSE}`.slice(0, len), observable: `Kael hace algo (${i + 1}).`, tags: ['master'] }, SEED_REAL_EPOCH_MS);
  }
  // Memoria de Brenna: dos notas de Kael y tres de Mira con importancia 1, 2 y 3.
  engine.world.npc('npc_brenna').memory.push(
    { character_id: 'ch_kael', game_s: 0, note: 'Kael le preguntó por el incendio de Vharn y ella cambió de tema.', importance: 1 },
    { character_id: 'ch_kael', game_s: 0, note: 'Kael pagó dos cervezas sin regatear.', importance: 2 },
    { character_id: 'ch_mira', game_s: 0, note: 'Mira preguntó por habitaciones libres.', importance: 1 },
    { character_id: 'ch_mira', game_s: 0, note: 'Mira le debe treinta monedas de una cena.', importance: 2 },
    { character_id: 'ch_mira', game_s: 0, note: 'Mira le salvó de un borracho con un cuchillo.', importance: 3 },
  );
  return engine;
}

const place = (e: Engine, id: string, spot: string) => { e.world.character(id).location = { type: 'spot', id: spot }; };

interface Situation { name: string; setup: (e: Engine) => void; text: string; roll?: (e: Engine) => RollContext }
const SITUATIONS: Situation[] = [
  { name: 'taberna (barra, Brenna delante)', setup: (e) => { place(e, 'ch_kael', 'sp_tab_barra'); place(e, 'ch_mira', 'sp_pl_pozo'); }, text: 'Le pregunto a Brenna qué sabe del incendio de Vharn.' },
  { name: 'plaza (solo, sin otro PJ)', setup: (e) => { place(e, 'ch_kael', 'sp_pl_tablon'); place(e, 'ch_mira', 'sp_tab_mesa'); }, text: 'Leo los avisos del tablón.' },
  {
    name: 'bosque (tras una tirada)', setup: (e) => { place(e, 'ch_kael', 'sp_cl_sendero'); place(e, 'ch_mira', 'sp_pl_pozo'); }, text: '',
    roll: (e) => ({ original_text: 'Examino el mango del hacha con atención.', result: characterCheck(e.world.character('ch_kael'), 'skill', 'investigation', 10, 'none', seededRng(7)) }),
  },
];

async function contextFor(s: Situation, history: number): Promise<{ ctx: string; model: string }> {
  const engine = await boot(history);
  s.setup(engine);
  return { ctx: mod.actionContext(engine, engine.world.character('ch_kael'), s.text, s.roll?.(engine)), model: engine.world.campaign.master.model };
}

/** Secciones = bloques que empiezan por "## " (lo que va entre medias, como Puntos o Salidas, cuenta con su sección). */
function sections(ctx: string): { name: string; text: string }[] {
  return ctx.split(/\n\n(?=## )/).map((t) => ({ name: t.slice(3).split('\n')[0]!.replace(/[:(].*$/, '').trim(), text: t }));
}

const client = process.env['ANTHROPIC_API_KEY'] ? new Anthropic() : null;
let overhead = 0;
async function tokens(text: string, model: string): Promise<number> {
  if (!client) return Math.round(text.length / 4);
  const r = await client.messages.countTokens({ model, messages: [{ role: 'user', content: text }] });
  return r.input_tokens - overhead;
}

type Row = { chars: number; tokens: number };
const out: Record<string, { total: Row; sections: Record<string, Row> }> = {};
const printed: string[] = [];
for (const s of SITUATIONS) {
  const { ctx, model } = await contextFor(s, HISTORY.length);
  // Lo que cuesta un mensaje casi vacío: se resta para que cada sección cuente solo su texto.
  if (client && !overhead) overhead = (await client.messages.countTokens({ model, messages: [{ role: 'user', content: '.' }] })).input_tokens - 1;
  const rows: Record<string, Row> = {};
  for (const sec of sections(ctx)) rows[sec.name] = { chars: sec.text.length, tokens: await tokens(sec.text, model) };
  out[s.name] = { total: { chars: ctx.length, tokens: await tokens(ctx, model) }, sections: rows };
  printed.push(`\n######## ${s.name}\n${ctx}`);
}
// Media de una sesión en la taberna con 1..11 eventos de historial: la misma forma en que se midió la media del log real (11 contextos).
{
  const sizes: Row[] = [];
  for (let h = 1; h <= 11; h++) {
    const { ctx, model } = await contextFor(SITUATIONS[0]!, h);
    sizes.push({ chars: ctx.length, tokens: await tokens(ctx, model) });
  }
  const avg = (k: keyof Row) => Math.round(sizes.reduce((a, r) => a + r[k], 0) / sizes.length);
  out['taberna, media de sesión (1-11 eventos)'] = { total: { chars: avg('chars'), tokens: avg('tokens') }, sections: {} };
}

if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`Tokens: ${client ? 'exactos (messages.countTokens)' : 'estimados (chars/4)'}\n`);
  for (const [name, r] of Object.entries(out)) {
    console.log(`== ${name}: ${r.total.chars} caracteres, ${r.total.tokens} tokens`);
    for (const [sec, v] of Object.entries(r.sections)) console.log(`   ${sec.padEnd(44)} ${String(v.chars).padStart(6)} c ${String(v.tokens).padStart(6)} t`);
    console.log('');
  }
}
if (process.argv.includes('--print')) console.log(printed.join('\n'));
process.exit(0);
