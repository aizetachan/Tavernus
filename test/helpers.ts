import { Engine, type EngineOptions } from '../src/engine/engine.js';
import { World } from '../src/engine/world.js';
import { GameClock } from '../src/clock/clock.js';
import { makeSeed, SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import { MemoryRepository } from '../src/persistence/memory.js';

export function fakeTime(startMs = SEED_REAL_EPOCH_MS) {
  let t = startMs;
  return {
    now: () => t,
    /** Avanza el reloj real en segundos. */
    advanceReal(s: number) { t += s * 1000; },
    /** Avanza el reloj real lo necesario para que pasen `s` segundos de juego (ratio 3). */
    advanceGame(s: number) { t += (s / 3) * 1000; },
    set(ms: number) { t = ms; },
  };
}

export function freshWorld() {
  const world = new World(makeSeed());
  const clock = GameClock.fromCampaign(world.campaign);
  return { world, clock, t0: clock.gameNow(SEED_REAL_EPOCH_MS) };
}

/**
 * Por defecto sin atajos deterministas: los tests del master esperan que toda
 * acción pase por él. Los del atajo (deterministic.test.ts) lo activan.
 *
 * Los PJ empiezan conectados, como con su pestaña abierta (al cargar, el motor no
 * da a nadie por conectado: Engine.boot). `offline: true` los deja como al cargar.
 */
export async function bootEngine(time = fakeTime(), opts: Partial<EngineOptions> & { offline?: boolean } = {}) {
  const { offline, ...rest } = opts;
  const repo = new MemoryRepository();
  const engine = await Engine.boot({ repo, campaignId: 'demo', seed: makeSeed(), now: time.now, deterministic: false, ...rest });
  if (!offline) for (const c of engine.world.characters.values()) c.connected = true;
  return { engine, repo, time };
}
