/** Prueba real con un personaje recién creado (no conoce a nadie): node --env-file=.env --import tsx scripts/newchar-smoke.ts "acción" ... */
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { Master } from '../src/ai/master.js';

const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed: makeSeed() });
engine.attachMaster(new Master(engine));
const r = await engine.createCharacter('u_test', 'Tamsin', { race_id: 'half-elf', class_id: 'bard', background_id: 'noble', abilities: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }, skills: ['deception', 'insight', 'performance'], death_mode: 'casual' });
if (!r.ok) throw new Error(r.reason);
const c = r.character;
c.location = { type: 'spot', id: process.env['START_SPOT'] ?? 'sp_tab_barra' };
for (const action of process.argv.slice(2)) {
  const t0 = Date.now();
  const res = action === 'tirar' ? await engine.rollPending(c.id) : await engine.act(c.id, action);
  console.log(`\n> ${action}\n${res.ok ? '' : '✗ '}${res.text}`);
  if (res.requires_roll) console.log(`   🎲 ${res.requires_roll.kind}:${res.requires_roll.key} CD ${res.requires_roll.dc}`);
  if (res.suggested_actions?.length) console.log(`   → ${res.suggested_actions.join(' | ')}`);
  console.log(`   [${(Date.now() - t0) / 1000}s · conoce: ${c.knows.join(', ') || 'a nadie'}]`);
}
process.exit(0);
