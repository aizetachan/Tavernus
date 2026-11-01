/** Uso: node --env-file-if-exists=.env --import tsx scripts/delete-character.ts "Nombre" — borra el PJ del mundo de DATA_DIR (el del REPL; las partidas de la web van por su menú). */
import { Engine } from '../src/engine/engine.js';
import { JsonFileRepository } from '../src/persistence/jsonfile.js';
import { makeSeed } from '../src/data/seed/demo.js';

const name = process.argv[2];
if (!name) { console.error('falta el nombre'); process.exit(1); }
const engine = await Engine.boot({ repo: new JsonFileRepository(process.env["DATA_DIR"] ?? "./data/local"), campaignId: process.env["CAMPAIGN_ID"] ?? "demo", seed: makeSeed() });
const c = [...engine.world.characters.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
if (!c) { console.error('no existe', name); process.exit(1); }

await engine.deleteCharacter(c.id);
await engine.flush();
console.log('borrado personaje', c.name);
process.exit(0);
