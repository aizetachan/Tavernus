import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { Illustrator, illustratorOf, Limiter, LIGHT_EN, PollinationsQueue } from '../src/ai/illustrate.js';
import { gameDayOf, paintKey, paintMomentOf, PaintLimits, withoutDialogue } from '../src/ai/paint.js';
import { lightAt } from '../src/engine/perception.js';
import { bootEngine, fakeTime, waitUntil } from './helpers.js';

const IDS = /\b(?:npc|ch|loc|sp|it|ii|ev)_[a-z0-9_]+/i;

async function boot() {
  const { engine, time } = await bootEngine(fakeTime(), { deterministic: true, rng: () => 0.99 });
  engine.attachMaster(new Master(engine, { client: offlineClient() }));
  return { engine, time };
}

describe('prompt del pincel', () => {
  it('el último turno: lugar, luz, punto, presentes y narración; sin diálogo literal ni ids', async () => {
    const { engine } = await boot();
    const r = await engine.act('ch_kael', 'Hablo con Brenna: «Una cerveza, por favor»');
    const m = paintMomentOf(engine, 'ch_kael')!;
    expect(m.seq).toBe(r.event!.seq);
    const p = m.input.prompt;
    const loc = engine.world.location('loc_taberna');
    expect(p).toContain('Taberna del Jabalí (interior)');
    expect(p).toContain(loc.description_base.slice(0, 30));
    expect(p).toContain(LIGHT_EN[lightAt(engine.clock, loc, r.event!.timestamp_game_s)]);
    expect(p).toContain('stands at la barra');
    expect(p).toContain('Also present: Brenna, tabernera');
    expect(p).toContain('Brenna levanta la vista');
    expect(p).toContain('Kael tries to: Hablo con Brenna.');
    // Ni lo que dice el PJ ni lo que contesta Brenna, ni comillas, ni ids.
    expect(p).not.toContain('Una cerveza');
    expect(p).not.toContain('Bienvenido');
    expect(p).not.toMatch(/[«»“”"]/);
    expect(p).not.toMatch(IDS);
    expect(m.input).toMatchObject({ kind: 'manual', name: 'Taberna del Jabalí · la barra', location_id: 'loc_taberna' });
    // Determinista: el mismo turno, el mismo prompt.
    expect(paintMomentOf(engine, 'ch_kael')!.input.prompt).toBe(p);
  });

  it('combate automático: quién lucha contra quién, no la línea de dados', async () => {
    const { engine } = await boot();
    const { entityOf } = await import('../src/ai/illustrate.js');
    const e = { id: 'ev_9', seq: 9, timestamp_real_ms: 0, timestamp_game_s: engine.gameNow(), campaign_id: 'demo', location_id: 'loc_taberna', spot_id: 'sp_tab_barra',
      actor_id: 'ch_kael', action_type: 'roll', input_text: null, narration_private: '🎲 Ataque con espada larga: d20 [16] + 5 = 21 → impacta: 4 de daño', observable: null,
      visibility: 'location' as const, tags: [], delivered_to: [], payload: {} };
    const input = entityOf(engine, { kind: 'combat', key: 'combat:ch_kael:npc_brenna', character_id: 'ch_kael', entity_id: 'ev_9', subject: 'npc_brenna' }, e)!;
    expect(input.prompt).toContain('Kael (humano guerrero) fighting Brenna, tabernera');
    expect(input.prompt).not.toContain('d20');
    expect(input.name).toBe('Taberna del Jabalí · Brenna');
  });

  it('quita la raya de diálogo, las comillas y los ids', () => {
    expect(withoutDialogue('Kael entra.\n—¿Qué quieres? —gruñe el guardia—. Vete.\nLa puerta cruje.')).toBe('Kael entra. La puerta cruje.');
    expect(withoutDialogue('Brenna dice «hola» y sonríe a npc_brenna.')).toBe('Brenna dice y sonríe a.');
    expect(withoutDialogue('**Golpe** certero, "ay".')).toBe('Golpe certero.');
  });
});

describe('caché del pincel', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-paint-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('clave estable por turno; repetir el pincel en el mismo turno no pide otra imagen', async () => {
    const { engine } = await boot();
    await engine.act('ch_kael', 'Hablo con Brenna');
    const a = paintMomentOf(engine, 'ch_kael')!;
    expect(a.key).toBe(`manual:ch_kael:${a.seq}`);
    expect(paintKey('ch_kael', a.seq)).toEqual({ key: a.key, entity_id: a.input.entity_id });
    expect(paintMomentOf(engine, 'ch_kael')!.key).toBe(a.key);

    const fetch = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof globalThis.fetch;
    const ill = new Illustrator({ dir, worldSeed: 'demo', fetch, minIntervalMs: 0, log: () => {}, queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2) });
    const [x, y] = await Promise.all([ill.illustrateEntity(a.input), ill.illustrateEntity(paintMomentOf(engine, 'ch_kael')!.input)]);
    await ill.illustrateEntity(a.input);
    expect(x).toBe(y);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(x!.file).toMatch(/^manual-ch_kael-\d+-\d+\.jpg$/);
    expect(ill.entityImage('manual', a.input.entity_id)).toBe(x);

    // Otro turno: otra clave.
    await engine.act('ch_kael', 'Le pregunto por el incendio');
    expect(paintMomentOf(engine, 'ch_kael')!.key).not.toBe(a.key);
  });
});

describe('límite del pincel', () => {
  it('como mucho 3 seguidas: la cuarta espera a que pase la ventana', () => {
    let t = 0;
    const l = new PaintLimits({ perDay: 10, burst: 3, burstWindowMs: 600_000, now: () => t });
    expect([1, 2, 3].map(() => l.take('ch_kael', 0).ok)).toEqual([true, true, true]);
    const no = l.take('ch_kael', 0);
    expect(no).toMatchObject({ ok: false, retry_after_s: 600 });
    expect(no.ok === false && no.text).toContain('3 pinceladas seguidas');
    // Otro PJ no comparte el límite.
    expect(l.take('ch_mira', 0).ok).toBe(true);
    t = 600_000;
    expect(l.take('ch_kael', 0)).toEqual({ ok: true, left: 6 });
  });

  it('10 por día de juego; al día siguiente vuelve; lo que falla se devuelve', () => {
    const l = new PaintLimits({ perDay: 10, burst: 100 });
    for (let i = 0; i < 10; i++) expect(l.take('ch_kael', 4).ok).toBe(true);
    const no = l.take('ch_kael', 4);
    expect(no.ok).toBe(false);
    expect(no.ok === false && no.text).toContain('10 escenas hoy');
    expect(l.left('ch_kael', 4)).toBe(0);
    l.refund('ch_kael', 4);
    expect(l.left('ch_kael', 4)).toBe(1);
    expect(l.left('ch_kael', 5)).toBe(10);
    expect(gameDayOf(86_400 * 3 + 5)).toBe(3);
  });
});

describe('ruta /api/illustrate', () => {
  let dir: string;
  let web: import('../src/adapters/web/server.js').WebServer | null = null;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-paint-web-')); });
  afterEach(async () => { await web?.stop(); web = null; await rm(dir, { recursive: true, force: true }); });

  it('acuse inmediato, imagen por el stream, el mismo turno sale de la caché y al agotar el límite, 429', async () => {
    const { GameManager } = await import('../src/games/manager.js');
    const { createWebServer } = await import('../src/adapters/web/server.js');
    const { paintStateOf } = await import('../src/adapters/web/paint.js');
    const prompts: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      prompts.push(decodeURIComponent(String(url)));
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }) as unknown as typeof fetch;
    const games = new GameManager({
      root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local'), IMAGES: 'on' }, log: () => {},
      masterFor: (engine) => new Master(engine, { client: offlineClient() }), engine: { deterministic: true },
      illustrator: { fetch: f, minIntervalMs: 0, queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2) },
    });
    const { game, character_id } = await games.create({ name: 'Pincel', mode: 'offline', character: { name: 'Ana' } });
    const id = character_id!;
    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web!.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(web.server.address() as import('node:net').AddressInfo).port}`;
    const engine = await games.open(game.slug);
    const ill = illustratorOf(engine)!;
    paintStateOf(engine, () => new PaintLimits({ perDay: 1 }));
    const act = (text: string) => fetch(`${base}/api/act?game=${game.slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character: id, text }) });
    const paint = () => fetch(`${base}/api/illustrate?game=${game.slug}&character=${id}`, { method: 'POST' });
    await act('Espero un rato');

    const moments: { key: string; kind: string; seq: number }[] = [];
    ill.onEntity((r) => { if (r.moment_key) moments.push({ key: r.moment_key, kind: r.image.kind!, seq: r.event_seq! }); });
    const manualCalls = () => prompts.filter((p) => p.includes('single wide illustrated scene')).length;

    const first = await paint();
    expect(first.status).toBe(202);
    const ack = await first.json() as { ok: boolean; key: string; seq: number; cached: boolean; left: number };
    expect(ack).toMatchObject({ ok: true, cached: false, left: 0, key: `manual:${id}:${ack.seq}` });
    await waitUntil(() => expect(moments).toContainEqual({ key: ack.key, kind: 'manual', seq: ack.seq }));
    expect(manualCalls()).toBe(1);

    // El mismo turno: la cacheada, sin gastar ni pedir otra.
    const again = await paint();
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, cached: true, key: ack.key, moment: { kind: 'manual', src: expect.stringContaining('/images/manual-') } });
    expect(manualCalls()).toBe(1);

    // Lo ya pintado vuelve con el historial.
    const status = await (await fetch(`${base}/api/illustrate?game=${game.slug}&character=${id}`)).json() as { enabled: boolean; left: number; painted: { key: string }[] };
    expect(status).toMatchObject({ enabled: true, left: 0, painted: [{ key: ack.key }] });

    // Otro turno con el límite agotado: 429 y un mensaje claro.
    await act('Espero otro rato');
    const over = await paint();
    expect(over.status).toBe(429);
    expect((await over.json() as { text: string }).text).toContain('escenas hoy');
    expect(manualCalls()).toBe(1);
    await games.closeAll();
  });
});
