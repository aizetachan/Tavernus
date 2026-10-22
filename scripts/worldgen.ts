/**
 * Genera un mundo y lo resume: nombre, premisa, Biblia, leyes, lugares, NPC,
 * pistas, encargos y la situación inicial del PJ, con tokens y coste.
 *
 *   node --env-file-if-exists=.env --import tsx scripts/worldgen.ts --seed 4242 --tone horror --pc Ana --dry      tamaño, sin llamar
 *   node --env-file-if-exists=.env --import tsx scripts/worldgen.ts --seed 4242 --tone horror --pc Ana --offline
 *   node --env-file-if-exists=.env --import tsx scripts/worldgen.ts --seed 4242 --tone horror --pc Ana            real (WORLDGEN_MODEL o claude-sonnet-5-5)
 *
 * --out FICHERO guarda el snapshot generado.
 */

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { World } from '../src/engine/world.js';
import { buildSkeleton, generateSeed, TONES, type Tone } from '../src/worldgen/index.js';
import { fillPrompt, fillSchema, FILL_SYSTEM, offlineFill } from '../src/worldgen/fill.js';
import { situationText } from '../src/worldgen/index.js';

const { values: a } = parseArgs({
  options: {
    seed: { type: 'string', default: String(Math.floor(Math.random() * 0xffffffff)) },
    tone: { type: 'string', default: 'grim' },
    setting: { type: 'string', default: '' },
    pc: { type: 'string', default: 'Ana' },
    hook: { type: 'string', default: '' },
    model: { type: 'string' },
    dry: { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});
const seed = Number(a.seed);
const tone = a.tone as Tone;
if (!TONES.includes(tone)) throw new Error(`tono: ${TONES.join(' | ')}`);
const pcs = a.pc ? [{ name: a.pc, ...(a.hook ? { hook: a.hook } : {}) }] : [];

if (a.dry) {
  const sk = buildSkeleton({ seed, tone, setting: a.setting });
  const chars = { system: FILL_SYSTEM.length, prompt: fillPrompt(sk, pcs).length, schema: JSON.stringify(fillSchema(sk)).length, salida_offline: JSON.stringify(offlineFill(sk, pcs)).length };
  // ~3,3 caracteres por token en castellano con JSON.
  const tin = Math.round((chars.system + chars.prompt + chars.schema) / 3.3), tout = Math.round(chars.salida_offline / 3.3);
  console.log({ chars, tokens_entrada_aprox: tin, tokens_salida_offline_aprox: tout, localizaciones: sk.locations.length, pistas: sk.clue_count, encargos: sk.jobs.length });
  process.exit(0);
}

const t0 = Date.now();
const snap = await generateSeed({
  seed, tone, setting: a.setting, characters: pcs, log: (m) => console.error(m),
  ...(a.offline ? { client: null } : {}), ...(a.model ? { model: a.model } : {}),
});
const c = snap.campaign;
const world = new World(structuredClone(snap));
const L: string[] = [];
L.push(`# ${c.name}  (semilla ${seed}, ${tone}, ${c.generation?.genre} · ${c.generation?.settlement}, ${c.generation?.model})`, '', c.premise, '', `Bienvenida: ${c.welcome.replace(/\s+/g, ' ')}`, '');
L.push('## Biblia', ...(c.bible ?? []).map((b) => `- ${b}`), '', '## Leyes', ...(c.laws ?? []).map((l) => `- ${l}`), '');
L.push('## Lugares', ...snap.locations.map((l) => `- ${l.name}: ${l.description_base} [${snap.spots.filter((s) => s.location_id === l.id).map((s) => s.name).join(', ')}]`), '');
L.push('## Gente', ...snap.npcs.map((n) => `- ${n.name} (${n.role}, ${n.attitude.default}): ${n.description} Quiere: ${n.motivation} Secreto: ${n.secret || '—'}`), '');
L.push('## Pistas', ...c.clues.map((x) => `- ${x.title}: ${x.how} [${[...(x.location_ids ?? []), ...(x.npc_ids ?? [])].join(', ')}]`), '');
L.push('## Encargos', ...c.jobs.map((j) => `- ${j.title} (${j.kind}, ${world.npc(j.giver_npc_id).name}): ${j.text}`), '');
L.push(`## Facción y logro`, `- ${c.factions[0]!.name}: ${c.factions[0]!.description}`, `- ${c.achievement.title}: ${c.achievement.announcement}`, '');
for (const s of c.situations ?? []) L.push(`## Situación inicial ${s.for_name ? `de ${s.for_name}` : '(reserva)'}`, situationText(world, s.situation), '');
const g = c.generation!;
L.push(`## Generación`, `${g.model}, ${g.attempts} llamada(s), ${g.usage.input} tokens de entrada, ${g.usage.output} de salida, ${g.cost_usd} $, ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(L.join('\n'));
if (a.out) await writeFile(a.out, JSON.stringify(snap, null, 2), 'utf8');
