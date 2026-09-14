/** Prueba real de la primera escena: node --env-file=.env --import tsx scripts/intro-smoke.ts */
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { Master } from '../src/ai/master.js';

const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed: makeSeed() });
engine.attachMaster(new Master(engine));
const r = await engine.createCharacter('u_test', 'Ánxela');
if (!r.ok) throw new Error(r.reason);
const t0 = Date.now();
const intro = await engine.introduce(r.character.id);
console.log(`[${engine.world.characterSpot(r.character)!.name}]\n${intro?.text}\n→ ${intro?.suggested_actions?.join(' | ')}\n[${(Date.now() - t0) / 1000}s]`);
process.exit(0);
