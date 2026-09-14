/** Prueba real del master por terminal: node --env-file=.env --import tsx scripts/master-smoke.ts "acción" ["acción2" ...] */
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { Master } from '../src/ai/master.js';

const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed: makeSeed() });
if (process.env['MASTER_EFFORT']) engine.world.campaign.master.effort = process.env['MASTER_EFFORT'] as 'low';
engine.world.character('ch_kael').location = { type: 'spot', id: process.env['START_SPOT'] ?? 'sp_tab_barra' };
engine.attachMaster(new Master(engine));
engine.onDelivery((d) => { if (d.character_id !== 'ch_kael') console.log(`   [${d.character_id}] ${d.text}`); else if (d.event.action_type === 'master_arrival') console.log(`\n[llegada] ${d.text}\n   → ${(d.event.payload['suggested_actions'] as string[] ?? []).join(' | ')}`); });
for (const action of process.argv.slice(2)) {
  const t0 = Date.now();
  if (action === 'esperar') {
    while (engine.world.character('ch_kael').transit) { await new Promise((res) => setTimeout(res, 2000)); await engine.tick(); }
    await engine.act('ch_kael', 'inventario'); // vacía la cola: la llegada narrada va antes
    continue;
  }
  const r = action === 'tirar' ? await engine.rollPending('ch_kael') : await engine.act('ch_kael', action);
  const m = r.event?.payload['master'] as { usage?: Record<string, number>; calls?: { name: string }[] } | undefined;
  console.log(`\n> ${action}\n${r.ok ? '' : '✗ '}${r.text}`);
  if (r.requires_roll) console.log(`   🎲 ${r.requires_roll.kind}:${r.requires_roll.key} CD ${r.requires_roll.dc}`);
  if (r.suggested_actions?.length) console.log(`   → ${r.suggested_actions.join(' | ')}`);
  if (m?.usage) console.log(`   [${(Date.now() - t0) / 1000}s · tools: ${m.calls?.map((c) => c.name).join(', ')} · in ${m.usage['input']} out ${m.usage['output']} cache_read ${m.usage['cache_read']} cache_write ${m.usage['cache_write']}]`);
}
process.exit(0);
