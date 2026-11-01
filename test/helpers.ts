import { vi } from 'vitest';
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

/** Espera a que se cumpla `check`. El plazo es holgado: solo cuenta cuando el test ya va a fallar. */
export function waitUntil<T>(check: () => T): Promise<T> {
  return vi.waitFor(check, { timeout: 15_000, interval: 5 });
}

/** Lo que ya ha llegado de cada stream y aún no se ha leído. */
const unread = new WeakMap<Response, { buf: string; dec: TextDecoder }>();

/**
 * Lee un SSE de evento en evento hasta que el texto leído cumpla `until` (o se acabe el tiempo).
 * Varios eventos pueden llegar en el mismo trozo: lo que sobra queda para la siguiente lectura.
 */
export async function readSse(res: Response, until: (text: string) => boolean, ms = 15_000): Promise<string> {
  const st = unread.get(res) ?? { buf: '', dec: new TextDecoder() };
  unread.set(res, st);
  const reader = res.body!.getReader();
  let text = '';
  const deadline = Date.now() + ms;
  while (!until(text)) {
    const end = st.buf.indexOf('\n\n');
    if (end >= 0) {
      text += st.buf.slice(0, end + 2);
      st.buf = st.buf.slice(end + 2);
      continue;
    }
    if (Date.now() >= deadline) break;
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, deadline - Date.now())))]);
    if (!chunk || chunk.done) break;
    st.buf += st.dec.decode(chunk.value, { stream: true });
  }
  reader.releaseLock();
  return text;
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
