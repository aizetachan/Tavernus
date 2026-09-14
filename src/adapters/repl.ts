/**
 * Adaptador de terminal (fase 1). Dos o más personajes desde la misma consola.
 *
 *   > as Kael            cambia de personaje
 *   > mirar              acción de texto libre
 *   > /where /who /inventory /recap /time /look
 *   > tick               fuerza un tick del reloj (también corre solo cada 10 s reales)
 */

import { createInterface } from 'node:readline';
import type { Engine } from '../engine/engine.js';

export async function startRepl(engine: Engine): Promise<void> {
  let current = [...engine.world.characters.values()][0];
  if (!current) throw new Error('la campaña no tiene personajes');
  for (const c of engine.world.characters.values()) engine.setPresence(c.id, true);

  engine.onDelivery((d) => {
    const c = engine.world.character(d.character_id);
    console.log(`  [#pov-${c.name.toLowerCase()}] ${d.text}`);
  });

  const timer = setInterval(() => { void engine.tick(); }, 10_000);

  console.log(`Personajes: ${[...engine.world.characters.values()].map((c) => c.name).join(', ')}. Hablas como ${current.name}.`);
  console.log(await engine.command(current.id, '/look'));

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `${current.name}> ` });
  const handle = async (line: string): Promise<boolean> => {
    const text = line.trim();
    if (!text) return true;
    const as = text.match(/^as\s+(.+)$/i);
    if (as) {
      const found = [...engine.world.characters.values()].find((c) => c.name.toLowerCase() === as[1]!.toLowerCase());
      if (found) { current = found; rl.setPrompt(`${current.name}> `); console.log(await engine.command(current.id, '/look')); }
      else console.log('No existe ese personaje.');
    } else if (text === 'tirar' || text === 'roll') {
      const r = await engine.rollPending(current!.id);
      if (!r.ok) console.log(`✗ ${r.text}`);
    } else if (text === 'tick') {
      await engine.tick();
      console.log(engine.clock.format(engine.gameNow()));
    } else if (text === 'quit' || text === 'salir') {
      return false;
    } else if (text.startsWith('/')) {
      console.log(await engine.command(current!.id, text));
    } else {
      const r = await engine.act(current!.id, text);
      if (!r.ok) console.log(`✗ ${r.text}`);
      else if (!r.event) console.log(r.text);
      if (r.requires_roll) console.log('  🎲 escribe «tirar» para tirar los dados');
      if (r.suggested_actions?.length) console.log(`  → ${r.suggested_actions.join(' | ')}`);
    }
    return true;
  };

  let chain: Promise<void> = Promise.resolve();
  let quit = false;
  let closed = false;
  rl.prompt();
  rl.on('line', (line) => {
    chain = chain.then(async () => {
      if (quit) return;
      if (!(await handle(line))) { quit = true; if (!closed) rl.close(); return; }
      if (!closed) rl.prompt();
    });
  });
  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      closed = true;
      void chain.then(async () => { clearInterval(timer); await engine.flush(); resolve(); });
    });
  });
}
