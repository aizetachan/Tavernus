import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyMoments, proseWithout, seenFromEvents, type Moment } from '../src/engine/moments.js';
import type { GameEvent } from '../src/engine/model.js';
import { parseLines } from '../src/ai/tools.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { attachIllustrator, entityKey, Illustrator, illustratorOf, itemPrompt, Limiter, PollinationsQueue, portraitPrompt, sceneSeed, styleBible, STYLE } from '../src/ai/illustrate.js';
import { spawnItem } from '../src/engine/inventory.js';
import { seededRng } from '../src/engine/dice.js';
import { bootEngine, fakeTime, waitUntil } from './helpers.js';

const NONE = { itemOfInstance: () => null };

/** Evento de ejemplo: lo mínimo que mira el clasificador. */
function ev(over: Partial<GameEvent> & { payload?: Record<string, unknown> }): GameEvent {
  return {
    id: 'ev_1', seq: 1, timestamp_real_ms: 0, timestamp_game_s: 0, campaign_id: 'demo', location_id: 'loc_taberna', spot_id: 'sp_tab_barra',
    actor_id: 'ch_kael', action_type: 'master', input_text: null, narration_private: '', observable: null, visibility: 'location', tags: [],
    delivered_to: [], payload: {}, ...over,
  };
}
const call = (name: string, input: Record<string, unknown>, result: unknown = { ok: true }) => ({ name, input, result: JSON.stringify(result) });
const master = (...calls: ReturnType<typeof call>[]) => ({ model: 'stub', usage: {}, calls, context: '' });
const kinds = (ms: Moment[]) => ms.map((m) => m.kind);

describe('clasificador de momentos', () => {
  it('primera conversación con un NPC: retrato, una vez por NPC y personaje', () => {
    const talk = ev({ payload: { npc_id: 'npc_brenna', master: master() } });
    const first = classifyMoments(talk, new Set(), NONE);
    expect(first).toEqual([{ kind: 'portrait', key: 'portrait:ch_kael:npc_brenna', character_id: 'ch_kael', entity_id: 'npc_brenna' }]);
    // Turnos siguientes de la misma conversación: nada.
    expect(classifyMoments(talk, new Set([first[0]!.key]), NONE)).toEqual([]);
    // Otro PJ que habla con ella por primera vez sí tiene su momento.
    expect(kinds(classifyMoments({ ...talk, actor_id: 'ch_mira' }, new Set([first[0]!.key]), NONE))).toEqual(['portrait']);
  });

  it('el NPC que habla en los parlamentos también cuenta, sin repetir', () => {
    const e = ev({ payload: { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Hola' }, { speaker: 'npc', npc_id: 'npc_doro', text: '¡Eh!' }, { speaker: 'actor', text: 'Buenas' }] } });
    expect(classifyMoments(e, new Set(), NONE).map((m) => m.entity_id)).toEqual(['npc_brenna', 'npc_doro']);
  });

  it('coger un objeto (atajo, parser o transfer_item) y examinarlo con get_item: el objeto, una vez por tipo y PJ', () => {
    const take = ev({ action_type: 'take', payload: { item_id: 'it_cerveza', master: null } });
    expect(classifyMoments(take, new Set(), NONE)).toEqual([{ kind: 'item', key: 'item:ch_kael:it_cerveza', character_id: 'ch_kael', entity_id: 'it_cerveza' }]);
    expect(classifyMoments(take, new Set(['item:ch_kael:it_cerveza']), NONE)).toEqual([]);

    const lookup = { itemOfInstance: (id: string) => (id === 'ii_7' ? 'it_cuerda' : null) };
    const viaMaster = ev({ payload: { master: master(call('transfer_item', { instance_id: 'ii_7', to_type: 'character', to_id: 'ch_kael' })) } });
    expect(classifyMoments(viaMaster, new Set(), lookup).map((m) => m.entity_id)).toEqual(['it_cuerda']);
    // A otro, o si falla, no.
    const toNpc = ev({ payload: { master: master(call('transfer_item', { instance_id: 'ii_7', to_type: 'npc', to_id: 'npc_brenna' })) } });
    const failed = ev({ payload: { master: master(call('transfer_item', { instance_id: 'ii_7', to_type: 'character', to_id: 'ch_kael' }, { error: 'no_space' })) } });
    expect(classifyMoments(toNpc, new Set(), lookup)).toEqual([]);
    expect(classifyMoments(failed, new Set(), lookup)).toEqual([]);

    const examine = ev({ input_text: 'Examino la llave con cuidado', payload: { master: master(call('get_item', { instance_id: 'ii_9' }, { instance_id: 'ii_9', item_id: 'it_llave_vharn', name: 'llave' })) } });
    expect(kinds(classifyMoments(examine, new Set(), NONE))).toEqual(['item']);
  });

  it('mirar alrededor, moverse dentro del lugar, esperar o que el máster consulte un objeto: nada', () => {
    expect(classifyMoments(ev({ action_type: 'look', input_text: 'mirar alrededor' }), new Set(), NONE)).toEqual([]);
    expect(classifyMoments(ev({ action_type: 'move', payload: { master: null } }), new Set(), NONE)).toEqual([]);
    expect(classifyMoments(ev({ action_type: 'wait' }), new Set(), NONE)).toEqual([]);
    expect(classifyMoments(ev({ input_text: 'Miro a mi alrededor', payload: { master: master(call('get_location', { location_id: 'here' }), call('get_item', { instance_id: 'ii_1' }, { item_id: 'it_cerveza' })) } }), new Set(), NONE)).toEqual([]);
    // Llegar a otro punto de un sitio ya pisado.
    expect(classifyMoments(ev({ action_type: 'arrived' }), new Set(['scene:ch_kael:loc_taberna']), NONE)).toEqual([]);
  });

  it('llegada a un sitio nuevo: escena', () => {
    expect(classifyMoments(ev({ action_type: 'arrived', location_id: 'loc_claro' }), new Set(), NONE))
      .toEqual([{ kind: 'scene', key: 'scene:ch_kael:loc_claro', character_id: 'ch_kael', entity_id: 'loc_claro' }]);
  });

  it('combate: la caída siempre; el primer golpe que hiere a un rival, una vez', () => {
    const hit = ev({ id: 'ev_5', action_type: 'roll', payload: { attack: { target_id: 'npc_lobo', hit: true, down: false, dead: false } } });
    const first = classifyMoments(hit, new Set(), NONE);
    expect(first).toEqual([{ kind: 'combat', key: 'combat:ch_kael:npc_lobo', character_id: 'ch_kael', entity_id: 'ev_5', subject: 'npc_lobo' }]);
    expect(classifyMoments({ ...hit, id: 'ev_6' }, new Set([first[0]!.key]), NONE)).toEqual([]);
    const miss = ev({ action_type: 'roll', payload: { attack: { target_id: 'npc_lobo', hit: false, down: false, dead: false } } });
    expect(classifyMoments(miss, new Set(), NONE)).toEqual([]);
    const fall = ev({ id: 'ev_7', payload: { master: master(call('attack', { attacker_id: 'npc_lobo', target_id: 'ch_kael' }, { hit: true, damage: 6, target_down: true })) } });
    expect(classifyMoments(fall, new Set([first[0]!.key]), NONE).map((m) => m.key)).toEqual(['combat:ev_7']);
    const burn = ev({ id: 'ev_8', payload: { master: master(call('apply_damage', { target_id: 'npc_lobo', amount: 4 }, { ok: true, status: 'dead' })) } });
    expect(kinds(classifyMoments(burn, new Set(['combat:ch_kael:npc_lobo']), NONE))).toEqual(['combat']);
  });

  it('descubrimiento: punto oculto o pista, una vez cada uno', () => {
    const found = ev({ id: 'ev_9', payload: { master: master(call('discover_spot', { character_id: 'ch_kael', spot_id: 'sp_tab_trampilla' }), call('grant_clue', { character_id: 'ch_kael', clue_id: 'clue_brenna' }, { error: 'ya la tiene' })) } });
    expect(classifyMoments(found, new Set(), NONE)).toEqual([{ kind: 'discovery', key: 'discovery:ch_kael:sp_tab_trampilla', character_id: 'ch_kael', entity_id: 'ev_9', subject: 'sp_tab_trampilla' }]);
    expect(classifyMoments(found, new Set(['discovery:ch_kael:sp_tab_trampilla']), NONE)).toEqual([]);
  });

  it('sin actor (tablón, anuncios) no hay momentos; las claves se recuperan de eventos pasados', () => {
    expect(classifyMoments(ev({ actor_id: null, payload: { npc_id: 'npc_brenna' } }), new Set(), NONE)).toEqual([]);
    const past = [ev({ payload: { moments: [{ kind: 'portrait', key: 'portrait:ch_kael:npc_brenna', character_id: 'ch_kael', entity_id: 'npc_brenna' }] } }), ev({})];
    expect([...seenFromEvents(past)]).toEqual(['portrait:ch_kael:npc_brenna']);
  });
});

describe('modo novela: parlamentos', () => {
  it('parseLines valida hablantes y limpia comillas; acepta JSON en texto', () => {
    const isNpc = (id: string) => id === 'npc_brenna';
    expect(parseLines([{ speaker: 'npc', npc_id: 'npc_brenna', text: '«Hola.»' }, { speaker: 'actor', npc_id: null, text: ' Buenas ' }, { speaker: 'npc', npc_id: 'npc_x', text: 'sin NPC conocido' }, { speaker: 'npc', npc_id: null, text: '' }], null, isNpc))
      .toEqual([{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Hola.' }, { speaker: 'actor', text: 'Buenas' }]);
    // Sin npc_id válido, el NPC del cierre.
    expect(parseLines('[{"speaker":"npc","npc_id":null,"text":"Pasa."}]', 'npc_brenna', isNpc)).toEqual([{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Pasa.' }]);
    expect(parseLines(null, null, isNpc)).toEqual([]);
    expect(parseLines('no es json', null, isNpc)).toEqual([]);
  });

  it('la prosa queda sin los parlamentos que van aparte', () => {
    const lines = [{ speaker: 'actor' as const, text: 'Una cerveza' }, { speaker: 'npc' as const, npc_id: 'npc_brenna', text: 'Marchando, forastero.' }];
    expect(proseWithout('«Una cerveza», dices. Brenna asiente. «Marchando, forastero.»', lines)).toBe('Dices. Brenna asiente.');
    expect(proseWithout('Brenna te mira y dice: “Marchando, forastero.”\nVuelve a la barra.', lines)).toBe('Brenna te mira y dice:\nVuelve a la barra.');
    // Lo que no está literal se queda.
    expect(proseWithout('Brenna gruñe algo.', lines)).toBe('Brenna gruñe algo.');
  });
});

describe('en el motor', () => {
  async function boot() {
    const { engine } = await bootEngine(fakeTime(), { deterministic: true, rng: () => 0.99 });
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
    const moments: Moment[] = [];
    engine.onMoment((m) => moments.push(m.moment));
    return { engine, moments };
  }

  it('coger la jarra da el objeto; hablar con Brenna, su retrato y el diálogo; la segunda vez y mirar alrededor, nada', async () => {
    const { engine, moments } = await boot();
    // Antes de la conversación: con ella abierta, coger algo ya no es trivial (va al máster).
    spawnItem(engine.world, 'it_cerveza', 1, { type: 'spot', id: 'sp_tab_barra' });
    const take = await engine.act('ch_kael', 'coger la jarra');
    expect(take.event!.action_type).toBe('take');
    expect(take.event!.payload['moments']).toEqual([{ kind: 'item', key: 'item:ch_kael:it_cerveza', character_id: 'ch_kael', entity_id: 'it_cerveza' }]);
    expect(kinds(moments)).toEqual(['item']);

    const r = await engine.act('ch_kael', 'Hablo con Brenna: «Una cerveza, por favor»');
    expect(r.event!.payload['npc_id']).toBe('npc_brenna');
    expect(r.event!.payload['lines']).toEqual([{ speaker: 'actor', text: 'Una cerveza, por favor' }, { speaker: 'npc', npc_id: 'npc_brenna', text: expect.stringContaining('Bienvenido') }]);
    expect(r.event!.payload['moments']).toEqual([{ kind: 'portrait', key: 'portrait:ch_kael:npc_brenna', character_id: 'ch_kael', entity_id: 'npc_brenna' }]);
    expect(kinds(moments)).toEqual(['item', 'portrait']);

    const again = await engine.act('ch_kael', 'Le pregunto a Brenna por el incendio');
    expect(again.event!.payload['moments']).toBeUndefined();
    const look = await engine.act('ch_kael', 'mirar alrededor');
    expect(look.event?.payload['moments']).toBeUndefined();
    expect(kinds(moments)).toEqual(['item', 'portrait']);
  });

  it('al reabrir la partida no se repiten los momentos ya dados', async () => {
    const { engine, repo, time } = await bootEngine(fakeTime(), { deterministic: true, rng: () => 0.99 });
    engine.attachMaster(new Master(engine, { client: offlineClient() }));
    await engine.act('ch_kael', 'Hablo con Brenna');
    await engine.flush();
    const { Engine } = await import('../src/engine/engine.js');
    const again = await Engine.boot({ repo, campaignId: 'demo', now: time.now, deterministic: true, rng: () => 0.99 });
    again.attachMaster(new Master(again, { client: offlineClient() }));
    const r = await again.act('ch_kael', 'Hablo con Brenna');
    expect(r.event!.payload['moments']).toBeUndefined();
  });
});

describe('ilustrador por entidad', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-ent-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function fake() {
    let t = 0;
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }) as unknown as typeof globalThis.fetch;
    return { urls, opts: { dir, worldSeed: 'demo', fetch, now: () => t, sleep: async (ms: number) => { await Promise.resolve(); t += ms; }, log: () => {}, queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2) } };
  }

  it('prompts deterministas desde lo guardado y la biblia de estilo', () => {
    expect(styleBible({ tone: 'grim' })).toBe(`${STYLE}, grim, gritty, muted colors`);
    expect(styleBible({ tone: 'epic', art_style: 'ink and watercolor' })).toBe('ink and watercolor, heroic, epic');
    const p = portraitPrompt({ name: 'Brenna', role: 'tabernera', description: 'Mujer recia, de brazos fuertes.' }, 'S');
    expect(p).toBe(portraitPrompt({ name: 'Brenna', role: 'tabernera', description: ' Mujer recia,  de brazos fuertes. ' }, 'S'));
    expect(p).toContain('Portrait of Brenna, tabernera');
    expect(itemPrompt({ name: 'jarra de cerveza', type: 'consumable' }, 'S')).toContain('held in a hand');
    expect(entityKey('portrait', 'npc_brenna', 7)).toBe('portrait-npc_brenna-7');
  });

  it('retratos y objetos: uno por entidad, reutilizados y guardados en el índice', async () => {
    const f = fake();
    const ill = new Illustrator(f.opts);
    const brenna = { kind: 'portrait' as const, entity_id: 'npc_brenna', name: 'Brenna', location_id: 'loc_taberna', prompt: 'p' };
    const [a, b] = await Promise.all([ill.illustrateEntity(brenna), ill.illustrateEntity(brenna)]);
    expect(a).toBe(b);
    expect(f.urls).toHaveLength(1);
    expect(f.urls[0]).toContain(`width=512&height=640&seed=${sceneSeed('demo', 'npc_brenna')}`);
    expect(a!.file).toBe(`portrait-npc_brenna-${sceneSeed('demo', 'npc_brenna')}.jpg`);
    expect(ill.entityImage('portrait', 'npc_brenna')).toBe(a);
    // El retrato no es la escena de ningún sitio.
    expect(ill.imageFor('loc_taberna')).toBeNull();

    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as Record<string, { kind: string; entity_id: string }>;
    expect(Object.values(index)).toEqual([expect.objectContaining({ kind: 'portrait', entity_id: 'npc_brenna' })]);

    const reopened = new Illustrator(fake().opts);
    await reopened.load();
    expect(reopened.entityImage('portrait', 'npc_brenna')?.file).toBe(a!.file);
    expect(reopened.imageFor('loc_taberna')).toBeNull();
  });

  it('en la cola pasa antes el retrato que el objeto y que la escena, aunque lleguen después', async () => {
    const f = fake();
    const ill = new Illustrator(f.opts);
    const order: string[] = [];
    ill.onEntity((r) => order.push(r.image.kind!));
    ill.onIllustrated(() => order.push('scene'));
    const busy = ill.illustrate({ location_id: 'loc_plaza', name: 'Plaza', description: 'x', light: 'day', indoor: false }, 'ch_kael');
    await Promise.resolve(); await Promise.resolve();
    const later = [
      ill.illustrate({ location_id: 'loc_claro', name: 'Claro', description: 'x', light: 'day', indoor: false }, 'ch_kael'),
      ill.illustrateEntity({ kind: 'item', entity_id: 'it_cerveza', name: 'jarra', location_id: 'loc_taberna', prompt: 'i' }),
      ill.illustrateEntity({ kind: 'portrait', entity_id: 'npc_brenna', name: 'Brenna', location_id: 'loc_taberna', prompt: 'p' }),
    ];
    await Promise.all([busy, ...later]);
    expect(order).toEqual(['scene', 'portrait', 'item', 'scene']);
  });

  it('enganchado al motor: el primer encuentro trae el retrato del NPC (con su evento) y el del PJ', async () => {
    const { engine } = await bootEngine(fakeTime(), { deterministic: true, rng: () => 0.99 });
    engine.attachMaster(new Master(engine, { client: offlineClient() }));
    const f = fake();
    const ill = attachIllustrator(engine, new Illustrator(f.opts));
    const got: { kind?: string; entity?: string; seq: number | null }[] = [];
    ill.onEntity((r) => got.push({ kind: r.image.kind, entity: r.image.entity_id, seq: r.event_seq }));
    const r = await engine.act('ch_kael', 'Hablo con Brenna');
    await waitUntil(() => expect(got).toHaveLength(2));
    // Los dos a la vez: cualquiera puede llegar antes.
    expect(got).toEqual(expect.arrayContaining([{ kind: 'portrait', entity: 'npc_brenna', seq: r.event!.seq }, { kind: 'portrait', entity: 'ch_kael', seq: null }]));
    await engine.act('ch_kael', 'mirar alrededor');
    await engine.act('ch_kael', 'Hablo con Brenna otra vez');
    await new Promise((res) => setTimeout(res, 20));
    expect(got).toHaveLength(2);
  });
});

describe('hilo de la web', () => {
  let dir: string;
  let web: import('../src/adapters/web/server.js').WebServer | null = null;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-hilo-')); });
  afterEach(async () => { await web?.stop(); web = null; await rm(dir, { recursive: true, force: true }); });

  /** Lee eventos SSE hasta que `done` diga basta. */
  async function readSse(res: Response, done: (events: { type: string; data: unknown }[]) => boolean) {
    const reader = res.body!.getReader();
    const events: { type: string; data: unknown }[] = [];
    let buf = '';
    while (!done(events)) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += new TextDecoder().decode(value);
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const type = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (type && data) events.push({ type, data: JSON.parse(data) });
      }
    }
    return events;
  }

  it('la vista del sitio va en la burbuja de llegada, también tras reiniciar; lo del jugador va como su acción, sin repetirse', async () => {
    const { GameManager } = await import('../src/games/manager.js');
    const { createWebServer } = await import('../src/adapters/web/server.js');
    const f = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
    const games = new GameManager({
      root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local'), IMAGES: 'on' }, log: () => {},
      masterFor: (engine) => new Master(engine, { client: offlineClient() }), engine: { deterministic: true },
      illustrator: { fetch: f, minIntervalMs: 0, queue: new PollinationsQueue(), cloudflareLimit: new Limiter(2) },
    });
    const { game, character_id } = await games.create({ name: 'Hilo', mode: 'offline', campaign_id: 'demo', character: { name: 'Ana' } });
    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web!.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(web.server.address() as import('node:net').AddressInfo).port}`;
    const engine = await games.open(game.slug);
    const ill = illustratorOf(engine)!;
    await waitUntil(() => expect(ill.imageFor(engine.world.characterSpot(engine.world.character(character_id!))!.location_id)).not.toBeNull());

    const r = await fetch(`${base}/api/act?game=${game.slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character: character_id, text: 'Espero un rato' }) });
    expect((await r.json() as { ok: boolean }).ok).toBe(true);

    const open = async () => {
      const ctrl = new AbortController();
      const res = await fetch(`${base}/api/stream?game=${game.slug}&character=${character_id}`, { signal: ctrl.signal });
      const ev = await readSse(res, (e) => e.some((x) => x.type === 'history'));
      ctrl.abort();
      return ev;
    };
    const first = await open();
    const cast = first.find((x) => x.type === 'cast')!.data as { master: { id: string; name: string }; me: { id: string; name: string } };
    expect(cast.master).toMatchObject({ id: 'master', name: 'El Narrador' });
    expect(cast.me).toMatchObject({ id: character_id, name: 'Ana' });
    const history = first.find((x) => x.type === 'history')!.data as { seq: number; place?: { location_id: string; src?: string }; scene?: unknown; input?: string; narrator?: boolean }[];
    // Una sola llegada (la de empezar) y lleva la vista; no hay mensajes de escena sueltos.
    const places = history.filter((m) => m.place);
    expect(places).toHaveLength(1);
    expect(places[0]!.place!.src).toMatch(/^\/images\/.+\.jpg\?game=/);
    expect(history.some((m) => m.scene)).toBe(false);
    expect(history.find((m) => m.input === 'Espero un rato')).toMatchObject({ narrator: true });
    // Al volver a entrar, igual.
    const again = (await open()).find((x) => x.type === 'history')!.data as typeof history;
    expect(again).toEqual(history);
    // Tras reiniciar el servidor (el historial sale del log de eventos), la vista sigue en su burbuja.
    await games.closeAll();
    // Al abrir, el ilustrador lee su índice sin esperar: hasta que acaba no sabe que la vista existe.
    await illustratorOf(await games.open(game.slug))!.load();
    const reopened = await open();
    expect((reopened.find((x) => x.type === 'history')!.data as typeof history).filter((m) => m.place)).toEqual(places);
    await games.closeAll();
  });
});
