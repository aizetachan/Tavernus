/**
 * G0 (docs/PLAN-OBJETOS.md §8): el mundo se guarda atómico, el registro se carga sin el contexto del máster
 * (que va aparte, en <id>.context.jsonl) y el mundo lleva el punto de control del registro. Una partida larga
 * arranca igual desde el formato nuevo, desde el de antes (contexto dentro de cada evento) y que la que
 * seguía viva.
 */
import { mkdtemp, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { JsonFileRepository, readEventsSync } from '../src/persistence/jsonfile.js';
import { splitDiagnostics } from '../src/persistence/diagnostics.js';
import { journalOf } from '../src/engine/journal.js';
import { fakeTime } from './helpers.js';

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function tmp(): Promise<string> { const d = await mkdtemp(join(tmpdir(), 'tavernus-g0-')); dirs.push(d); return d; }

/** Máster de pruebas con un contexto grande, como el de verdad; cada quinta llamada pide tirada. */
function bulkyMaster(): MasterLike {
  let n = 0;
  return {
    async resolve(_actor, text) {
      n++;
      return {
        ok: true, usage: { input_tokens: 1000 }, calls: [{ name: 'log_event', input: { n }, result: 'ok' }], model: 'stub',
        context: `CONTEXTO-${n} ` + 'x'.repeat(4000),
        closed: {
          narration_private: `El máster narra «${text}» (${n}).`, observable: `Alguien hace algo (${n}).`, observable_vague: null, loudness: 1,
          tags: ['test'], suggested_actions: ['Mirar alrededor'],
          requires_roll: n % 5 === 0 ? { kind: 'skill', key: 'perception', dc: 12, advantage: 'none' } : null,
        },
      };
    },
  };
}

const ACTIONS = ['busco huellas en el suelo', 'pregunto al tabernero por el camino', 'examino la chimenea con cuidado', 'escucho las conversaciones', 'reviso mi equipo despacio'];

async function longGame(dir: string, turns = 60) {
  const time = fakeTime();
  const engine = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', seed: makeSeed(), now: time.now, deterministic: false });
  for (const c of engine.world.characters.values()) c.connected = true;
  engine.attachMaster(bulkyMaster());
  for (let i = 0; i < turns; i++) {
    await engine.act(i % 3 === 2 ? 'ch_mira' : 'ch_kael', ACTIONS[i % ACTIONS.length]!);
    time.advanceGame(45);
    if (i % 10 === 9) await engine.tick();
  }
  await engine.flush();
  return { engine, time };
}

/** Lo que el motor deriva del registro al arrancar y lo que leen el hilo, el diario y el máster. */
function bootState(e: Engine) {
  const pcs = ['ch_kael', 'ch_mira'];
  return {
    world: JSON.parse(JSON.stringify(e.world.snapshot())) as unknown,
    events: e.events.all().map((x) => JSON.parse(JSON.stringify(splitDiagnostics(x).event)) as unknown),
    lastSeq: e.events.lastSeq,
    pending: pcs.map((id) => e.pendingRoll(id)),
    moments: [...(e as unknown as { seenMoments: Set<string> }).seenMoments].sort(),
    threads: pcs.map((id) => e.events.forCharacter(id, null).map((d) => d.text)),
    journals: pcs.map((id) => JSON.parse(JSON.stringify(journalOf(e, id))) as unknown),
  };
}

describe('G0: registro ligero y punto de control', () => {
  it('una partida larga arranca igual que seguía, y desde el formato de antes', async () => {
    const dir = await tmp();
    const { engine: live, time } = await longGame(dir);
    expect(live.events.lastSeq).toBeGreaterThan(60);
    expect(live.pendingRoll('ch_kael') ?? live.pendingRoll('ch_mira')).not.toBeNull();

    // El contexto va aparte: el registro que se carga al arrancar no lo lleva.
    const log = await readFile(join(dir, 'demo.events.jsonl'), 'utf8');
    const ctx = await readFile(join(dir, 'demo.context.jsonl'), 'utf8');
    expect(log).not.toContain('CONTEXTO-');
    expect(ctx).toContain('CONTEXTO-1 ');
    expect(ctx.length).toBeGreaterThan(log.length);
    // Y el análisis lo recupera entero.
    const full = readEventsSync(dir, 'demo');
    const withCtx = full.filter((e) => (e.payload['master'] as { context?: string } | null)?.context?.startsWith('CONTEXTO-'));
    expect(withCtx.length).toBeGreaterThanOrEqual(60);

    // El mundo lleva el punto de control.
    const world = JSON.parse(await readFile(join(dir, 'demo.world.json'), 'utf8')) as { _log?: { seq: number } };
    expect(world._log?.seq).toBe(live.events.lastSeq);

    // Arranque desde el formato nuevo.
    const again = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now, deterministic: false });
    // Arranque desde el formato de antes: el mundo sin punto de control y el contexto dentro de cada evento.
    const old = await tmp();
    const { _log, ...plain } = world;
    void _log;
    await writeFile(join(old, 'demo.world.json'), JSON.stringify(plain, null, 1));
    await writeFile(join(old, 'demo.events.jsonl'), full.map((e) => JSON.stringify(e) + '\n').join(''));
    await cp(join(dir, 'demo.tickers.json'), join(old, 'demo.tickers.json'));
    const legacy = await Engine.boot({ repo: new JsonFileRepository(old), campaignId: 'demo', now: time.now, deterministic: false });

    // Al cargar nadie está conectado (Engine.boot): se compara con eso.
    for (const c of live.world.characters.values()) c.connected = false;
    const expected = bootState(live);
    expect(bootState(again)).toEqual(expected);
    expect(bootState(legacy)).toEqual(expected);
    // Sin el contexto en memoria.
    expect(again.events.all().some((e) => 'context' in ((e.payload['master'] as object | null) ?? {}))).toBe(false);
    expect(legacy.events.all().some((e) => 'context' in ((e.payload['master'] as object | null) ?? {}))).toBe(false);

    // Sigue numerando donde iba.
    again.attachMaster(bulkyMaster());
    const next = await again.act('ch_kael', 'miro alrededor con calma');
    expect(next.event!.seq).toBe(live.events.lastSeq + 1);
  });

  it('una última línea a medias se descarta y lo siguiente va en su línea', async () => {
    const dir = await tmp();
    const { engine: live, time } = await longGame(dir, 8);
    const last = live.events.lastSeq;
    await writeFile(join(dir, 'demo.events.jsonl'), '{"id":"ev_roto","seq":', { flag: 'a' });
    await writeFile(join(dir, 'demo.context.jsonl'), '{"seq":', { flag: 'a' });
    const e2 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now, deterministic: false });
    expect(e2.events.lastSeq).toBe(last);
    e2.attachMaster(bulkyMaster());
    await e2.act('ch_kael', 'busco huellas en el suelo');
    await e2.flush();
    const e3 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now, deterministic: false });
    expect(e3.events.lastSeq).toBe(e2.events.lastSeq);
    expect(e3.events.all().at(-1)!.seq).toBe(e2.events.lastSeq);
    expect(readEventsSync(dir, 'demo').at(-1)!.payload['master']).toMatchObject({ context: expect.stringContaining('CONTEXTO-1 ') });
  });

  it('si el final del registro se pierde, el punto de control evita repetir un seq', async () => {
    const dir = await tmp();
    const { engine: live, time } = await longGame(dir, 10);
    const last = live.events.lastSeq;
    const lines = (await readFile(join(dir, 'demo.events.jsonl'), 'utf8')).split('\n').filter(Boolean);
    await writeFile(join(dir, 'demo.events.jsonl'), lines.slice(0, -2).join('\n') + '\n');
    const e2 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now, deterministic: false });
    expect(e2.events.lastSeq).toBe(last);
    e2.attachMaster(bulkyMaster());
    const r = await e2.act('ch_kael', 'busco huellas en el suelo');
    expect(r.event!.seq).toBe(last + 1);
  });

  it('los guardados son atómicos: en fila, sin temporales, y uno a medias no estorba', async () => {
    const dir = await tmp();
    const { engine, time } = await longGame(dir, 3);
    // Un temporal de un guardado que no llegó a renombrarse (el proceso murió).
    await writeFile(join(dir, 'demo.world.json.999-1.tmp'), '{"campaign":');
    // Muchos guardados a la vez, mundo y tickers: el fichero queda entero.
    const repo = new JsonFileRepository(dir);
    const snap = engine.world.snapshot();
    await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? repo.saveSnapshot(snap) : repo.saveTicker('demo', `t${i}`, { last_tick_game_s: i })));
    const tickers = JSON.parse(await readFile(join(dir, 'demo.tickers.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(tickers).filter((k) => k.startsWith('t'))).toHaveLength(10);
    const e2 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now, deterministic: false });
    expect(e2.world.characters.size).toBe(engine.world.characters.size);
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});
