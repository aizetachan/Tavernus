import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { BudgetBook, BudgetedMaster, budgetFromEnv, tokensOf } from '../src/ai/budget.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import type { AccessOptions } from '../src/adapters/web/access.js';
import type { MasterLike } from '../src/engine/engine.js';
import { spawnItem } from '../src/engine/inventory.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Máster offline que tarda: deja ver acciones a la vez. */
const slow = (ms: number): MasterFactory => (engine) => {
  const m = new Master(engine, { client: offlineClient() });
  return { resolve: async (...a) => { await new Promise((r) => setTimeout(r, ms)); return m.resolve(...a); } };
};

let dir: string;
let games: GameManager;
let web: WebServer;
let base: string;

async function start(access?: AccessOptions, extra: { masterFor?: MasterFactory; leaveNoticeMs?: number } = {}) {
  games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: extra.masterFor ?? ((e) => new Master(e, { client: offlineClient() })), engine: { deterministic: false }, log: () => {}, budget: null });
  web = createWebServer(games, { tickMs: 3_600_000, ...(access ? { access } : {}), ...(extra.leaveNoticeMs !== undefined ? { leaveNoticeMs: extra.leaveNoticeMs } : {}) });
  await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
}

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-multi-')); });
afterEach(async () => {
  await web?.stop();
  await rm(dir, { recursive: true, force: true });
});

/** Un navegador: guarda sus cookies entre peticiones. */
function browser() {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (r: Response) => {
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv!.indexOf('='); jar.set(kv!.slice(0, i), kv!.slice(i + 1)); }
    return r;
  };
  return {
    jar,
    get: (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: 'manual', ...init, headers: { cookie: cookie(), ...(init.headers ?? {}) } }).then(keep),
    post: (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { cookie: cookie(), 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(keep),
  };
}

/** Lee un SSE hasta que el texto acumulado cumpla `until` (o se acabe el tiempo). */
async function readSse(res: Response, until: (text: string) => boolean, ms = 4000): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  const deadline = Date.now() + ms;
  while (!until(text) && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, deadline - Date.now())))]);
    if (!chunk || chunk.done) break;
    text += dec.decode(chunk.value);
  }
  reader.releaseLock();
  return text;
}

const ACCESS: AccessOptions = { mode: 'invite', adminToken: 'token-de-admin-para-tests', secret: 'secreto-de-tests' };

describe('invitaciones por asiento', () => {
  it('el enlace liga al personaje; no puede actuar por otro; sin enlace no entra', async () => {
    await start(ACCESS);
    const host = browser();
    // Sin enlace: página de invitación y nada de la API.
    expect(await (await host.get('/')).text()).toContain('por invitación');
    expect((await host.get('/api/games')).status).toBe(403);
    expect((await host.get('/admin?token=otro')).status).toBe(403);
    // El anfitrión entra con su enlace de administración: ve los asientos (uno por PJ) y añade uno libre.
    expect((await host.get(`/admin?token=${ACCESS.adminToken}`)).status).toBe(302);
    const created = await games.create({ name: 'Mesa', mode: 'offline', campaign_id: 'demo', character: { name: 'Aren' } });
    const g = `?game=${created.game.slug}`;
    expect((await host.post(`/api/seats${g}`)).status).toBe(200);
    const seats = (await (await host.get(`/api/seats${g}`)).json()) as { seats: { id: string; character_id: string | null; link: string }[] };
    expect(seats.seats.map((s) => s.character_id).sort()).toEqual([created.character_id, 'ch_kael', 'ch_mira', null].sort());
    const free = seats.seats.find((s) => !s.character_id)!;
    // Admin sin asiento: puede mirar cualquier PJ; con su enlace queda ligado al suyo.
    expect(((await (await host.get(`/api/session${g}`)).json()) as { can_switch: boolean }).can_switch).toBe(true);
    expect((await host.get(seats.seats.find((s) => s.character_id === created.character_id)!.link)).status).toBe(302);
    expect(((await (await host.get(`/api/session${g}`)).json()) as { character_id: string; can_switch: boolean })).toMatchObject({ character_id: created.character_id, can_switch: false });

    // El amigo abre su enlace: asiento libre → crea su PJ, junto a Aren.
    const friend = browser();
    const join_ = await friend.get(free.link);
    expect(join_.status).toBe(302);
    expect(join_.headers.get('location')).toBe(`/${g}`);
    expect(await (await friend.get(`/${g}`)).text()).toContain('Te han invitado');
    const claim = (await (await friend.post(`/api/seat/claim${g}`, { name: 'Tor', class: 'fighter', near: created.character_id })).json()) as { ok: boolean; character_id: string };
    expect(claim.ok).toBe(true);
    const kael = claim.character_id;
    const engine = await games.open(created.game.slug);
    expect(engine.world.characterSpot(engine.world.character(kael))!.id).toBe(engine.world.characterSpot(engine.world.character(created.character_id))!.id);
    expect((await friend.post(`/api/seat/claim${g}`, { name: 'Otro' })).status).toBe(400);

    // Ligado: su PJ sí, el de los demás no (ni acción, ni hoja, ni stream, ni avatar).
    const session = (await (await friend.get(`/api/session${g}`)).json()) as { role: string; can_switch: boolean; character_id: string };
    expect(session).toMatchObject({ role: 'player', can_switch: false, character_id: kael });
    for (const other of [created.character_id, 'ch_mira']) {
      expect((await friend.post(`/api/act${g}`, { character: other, text: 'robo la bolsa' })).status).toBe(403);
      expect((await friend.post(`/api/command${g}`, { character: other, name: 'look' })).status).toBe(403);
      expect((await friend.get(`/api/sheet${g}&character=${other}`)).status).toBe(403);
      expect((await friend.get(`/api/stream${g}&character=${other}`)).status).toBe(403);
      expect((await friend.get(`/api/avatar${g}&character=${other}`)).status).toBe(403);
    }
    expect((await friend.post(`/api/act${g}`, { character: kael, text: 'miro alrededor' })).status).toBe(200);
    expect((await friend.post(`/api/act${g}`, { text: 'espero' })).status).toBe(200); // sin character: el suyo
    // Ni el menú ni crear partidas ni los asientos.
    expect((await friend.get('/api/games')).status).toBe(403);
    expect((await friend.get(`/api/seats${g}`)).status).toBe(403);
    expect(await (await friend.get('/')).text()).not.toContain('Nueva partida');

    // Enlace inventado o cookie falsificada: fuera.
    const stranger = browser();
    expect((await stranger.get(`/i/${created.game.slug}/${'x'.repeat(32)}`)).status).toBe(403);
    expect(stranger.jar.size).toBe(0);
    stranger.jar.set(`tv_s_${created.game.slug}`, `${free.id}.firmafalsa`);
    expect((await stranger.get(`/api/session${g}`)).status).toBe(403);
    expect(await (await stranger.get(`/${g}`)).text()).toContain('por invitación');

    // Renovar el enlace saca a quien lo usaba.
    expect((await host.post(`/api/seats/regenerate${g}`, { seat: free.id })).status).toBe(200);
    expect((await friend.post(`/api/act${g}`, { text: 'miro alrededor' })).status).toBe(403);
    expect((await friend.get(free.link)).status).toBe(403);
  });

  it('crear partida por la API reparte asientos y liga al anfitrión a su PJ', async () => {
    await start(ACCESS);
    const host = browser();
    await host.get(`/admin?token=${ACCESS.adminToken}`);
    const created = (await (await host.post('/api/games', { name: 'Mesa', mode: 'offline', character: 'Mira', class: 'rogue', seats: 2 })).json()) as { game: { slug: string }; character_id: string };
    const g = `?game=${created.game.slug}`;
    const seats = (await (await host.get(`/api/seats${g}`)).json()) as { seats: { character_id: string | null }[] };
    expect(seats.seats.map((s) => s.character_id)).toEqual([created.character_id, null, null]);
    expect(((await (await host.get(`/api/session${g}`)).json()) as { character_id: string }).character_id).toBe(created.character_id);
  });

  it('en modo abierto (local) todo sigue como antes', async () => {
    await start();
    const b = browser();
    expect(await (await b.get('/')).text()).toContain('Nueva partida');
    expect((await b.get('/api/games')).status).toBe(200);
  });
});

describe('presencia y cola en la web', () => {
  it('el SSE dice quién está en línea y avisa en el hilo al entrar y al salir', async () => {
    await start(undefined, { leaveNoticeMs: 30 });
    const { game, character_id: mira } = await games.create({ name: 'Dos', mode: 'offline', campaign_id: 'demo', character: { name: 'Lia' } });
    const kael = await games.addCharacter(game.slug, 'web:test:2', { name: 'Tor' }, { near: mira });
    const g = `?game=${game.slug}`;

    const miraStream = await fetch(`${base}/api/stream${g}&character=${mira}`);
    const first = await readSse(miraStream, (t) => t.includes('event: presence'));
    expect(first).toMatch(/event: presence\ndata: \[.*"name":"Tor","online":false,"where":"here","text":"Tor está aquí \(sin conexión\)"/);

    const ctrl = new AbortController();
    const kaelStream = await fetch(`${base}/api/stream${g}&character=${kael}`, { signal: ctrl.signal });
    const kaelFirst = await readSse(kaelStream, (t) => t.includes('event: presence'));
    expect(kaelFirst).toContain('"name":"Lia","online":true');
    const joined = await readSse(miraStream, (t) => t.includes('ha entrado'));
    expect(joined).toContain('Tor ha entrado en la partida');
    expect(joined).toContain('"online":true,"where":"here","text":"Tor está aquí"');

    ctrl.abort();
    // Están en el mismo sitio: el aviso es de la ficción, y su PJ se queda (docs/MULTIJUGADOR.md, «Desconexiones»).
    const leftText = await readSse(miraStream, (t) => t.includes('se ha ido'));
    expect(leftText).toMatch(/Tor se ha ido; su personaje se queda en [^.]+\./);
    expect(leftText).toContain('Tor está aquí (ausente)');
    await miraStream.body!.cancel();
  });

  it('dos acciones a la vez en el mismo sitio: en orden, la segunda «esperando a» la primera; doble acción del mismo PJ, 409', async () => {
    await start(undefined, { masterFor: slow(250) });
    const { game, character_id: mira } = await games.create({ name: 'Cola', mode: 'offline', campaign_id: 'demo', character: { name: 'Lia' } });
    const kael = await games.addCharacter(game.slug, 'web:test:2', { name: 'Tor' }, { near: mira });
    const g = `?game=${game.slug}`;
    const kaelStream = await fetch(`${base}/api/stream${g}&character=${kael}`);
    await readSse(kaelStream, (t) => t.includes('event: history'));
    const post = (body: unknown) => fetch(`${base}/api/act${g}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const a = post({ character: mira, text: 'miro la sala' });
    await new Promise((r) => setTimeout(r, 40));
    const twice = await post({ character: mira, text: 'y otra cosa' });
    expect(twice.status).toBe(409);
    const b = post({ character: kael, text: 'miro la puerta' });
    const waiting = await readSse(kaelStream, (t) => t.includes('"waiting_for":["Lia"]'));
    expect(waiting).toContain('event: queue\ndata: {"waiting_for":["Lia"]}');
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    await kaelStream.body!.cancel();

    const engine = await games.open(game.slug);
    const acts = engine.events.all().filter((e) => e.input_text === 'miro la sala' || e.input_text === 'miro la puerta');
    expect(acts.map((e) => e.input_text)).toEqual(['miro la sala', 'miro la puerta']);
  });
});

describe('cola por localización en el motor', () => {
  it('dos PJ cogen la misma jarra a la vez: uno la tiene, el estado no se corrompe', async () => {
    const { engine } = await bootEngine(fakeTime(), { deterministic: true, rng: () => 0.99 });
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    const s = spawnItem(engine.world, 'it_cerveza', 1, { type: 'spot', id: 'sp_tab_barra' });
    const id = s.ok ? s.moved.id : '';
    const calls: string[] = [];
    const master: MasterLike = {
      async resolve(actor, text) {
        calls.push(`${actor.id}: ${text}`);
        return { ok: true, usage: {}, calls: [], context: '', model: 'stub', closed: { narration_private: 'No queda ninguna jarra.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
      },
    };
    engine.attachMaster(master);
    const [k, m] = await Promise.all([engine.act('ch_kael', 'coger la jarra'), engine.act('ch_mira', 'coger la jarra')]);
    expect(k.text).toContain('jarra de cerveza');
    expect(engine.world.itemInstance(id).location).toMatchObject({ type: 'character', id: 'ch_kael' });
    // La segunda ya no la ve en el suelo: no es trivial y va al máster, que narra el fallo.
    expect(m.text).toBe('No queda ninguna jarra.');
    expect(calls).toEqual(['ch_mira: coger la jarra']);
    expect([...engine.world.itemInstances.values()].filter((i) => i.item_id === 'it_cerveza' && i.id === id)).toHaveLength(1);
    expect(k.event!.seq).toBeLessThan(m.event!.seq);
  });
});

describe('cupo diario del máster', () => {
  const usage = { input: 1000, output: 200, cache_read: 5000, cache_write: 0, iterations: 1, ms: 1 };
  const closed = (text: string) => ({ narration_private: text, observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null });

  it('agotado, el PJ sigue en offline, con un aviso una sola vez; el otro PJ no se ve afectado; al día siguiente vuelve', async () => {
    const time = fakeTime(Date.UTC(2026, 9, 25, 10));
    const { engine } = await bootEngine(time);
    const file = join(dir, 'budget.json');
    let now = time.now();
    const book = new BudgetBook({ actions: 2, tokens: 0, tz: 'Europe/Madrid' }, file, () => now);
    const live: MasterLike = { resolve: async () => ({ ok: true, usage, calls: [], context: '', model: 'live', closed: closed('El narrador real.') }) };
    const fallback: MasterLike = { resolve: async () => ({ ok: true, usage: {}, calls: [], context: '', model: 'offline', closed: closed('Modo sencillo.') }) };
    engine.attachMaster(new BudgetedMaster(engine, live, fallback, book));
    const seen: string[] = [];
    engine.onDelivery((d) => { if (d.character_id === 'ch_kael') seen.push(d.event.action_type); });

    expect((await engine.act('ch_kael', 'uno')).text).toBe('El narrador real.');
    expect((await engine.act('ch_kael', 'dos')).text).toBe('El narrador real.');
    expect((await engine.act('ch_kael', 'tres')).text).toBe('Modo sencillo.');
    expect((await engine.act('ch_kael', 'cuatro')).text).toBe('Modo sencillo.');
    expect(seen.filter((t) => t === 'budget_exhausted')).toHaveLength(1);
    const notice = engine.events.all().find((e) => e.action_type === 'budget_exhausted')!;
    expect(notice.narration_private).toMatch(/cupo \(2 acciones con el narrador\)/);
    expect(notice.delivered_to.map((d) => d.character_id)).toEqual(['ch_kael']);
    expect((await engine.act('ch_mira', 'hola')).text).toBe('El narrador real.');
    expect(book.of('ch_kael')).toMatchObject({ actions: 2, tokens: 2 * tokensOf(usage) });
    expect(tokensOf(usage)).toBe(1700);

    // Un reinicio no regala cupo.
    expect(new BudgetBook(book.limits, file, () => now).exhausted('ch_kael')).toBe(true);
    // Medianoche en Madrid: cupo nuevo.
    now = Date.UTC(2026, 9, 25, 23, 30);
    expect(book.exhausted('ch_kael')).toBe(false);
  });

  it('por tokens, y configurable por entorno', () => {
    expect(budgetFromEnv({})).toEqual({ actions: 200, tokens: 0, tz: 'Europe/Madrid' });
    expect(budgetFromEnv({ DAILY_MASTER_ACTIONS: '0', DAILY_MASTER_TOKENS: '0' })).toBeNull();
    expect(budgetFromEnv({ DAILY_MASTER_ACTIONS: '0', DAILY_MASTER_TOKENS: '50000', BUDGET_TZ: 'UTC' })).toEqual({ actions: 0, tokens: 50000, tz: 'UTC' });
    const book = new BudgetBook({ actions: 0, tokens: 3000, tz: 'UTC' }, null);
    book.spend('ch_kael', 1700);
    expect(book.exhausted('ch_kael')).toBe(false);
    book.spend('ch_kael', 1700);
    expect(book.exhausted('ch_kael')).toBe(true);
  });

  it('el gestor lo pone solo en partidas con máster real', async () => {
    const live = (e: Parameters<MasterFactory>[0]) => ({ resolve: async () => ({ ok: true as const, usage, calls: [], context: '', model: 'live', closed: closed('Real.') }) }) satisfies MasterLike;
    const m = new GameManager({ root: join(dir, 'g2'), env: {}, masterFor: (e) => live(e), engine: { deterministic: false }, log: () => {}, budget: { actions: 1, tokens: 0, tz: 'UTC' } });
    const real = await m.create({ name: 'Real', mode: 'live', campaign_id: 'demo', character: { name: 'Aren' } });
    const engine = await m.open(real.game.slug);
    expect(m.budgetOf(engine)).not.toBeNull();
    await engine.act(real.character_id!, 'uno');
    const r = await engine.act(real.character_id!, 'dos');
    expect(r.text).not.toBe('Real.');
    expect(engine.events.all().some((e) => e.action_type === 'budget_exhausted')).toBe(true);
    const off = await m.create({ name: 'Off', mode: 'offline', campaign_id: 'demo', character: { name: 'Bea' } });
    expect(m.budgetOf(await m.open(off.game.slug))).toBeNull();
    await m.closeAll();
  });
});

describe('entre jugadores en la web', () => {
  it('decir: el otro recibe la frase literal como parlamento del otro jugador, con «Responder a…»', async () => {
    await start();
    const { game, character_id: lia } = await games.create({ name: 'Charla', mode: 'offline', campaign_id: 'demo', character: { name: 'Lia' } });
    const tor = await games.addCharacter(game.slug, 'web:test:2', { name: 'Tor' }, { near: lia });
    const g = `?game=${game.slug}`;
    const liaStream = await fetch(`${base}/api/stream${g}&character=${lia}`);
    await readSse(liaStream, (t) => t.includes('event: history'));
    const r = await (await fetch(`${base}/api/say${g}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character: tor, text: '¿Vamos al pozo?', to: lia }) })).json() as { ok: boolean };
    expect(r.ok).toBe(true);
    const got = await readSse(liaStream, (t) => t.includes('Vamos al pozo'));
    // Empezaron juntos: se conocen por el nombre. La frase, literal y de Tor; y la opción de responderle.
    expect(got).toContain(`"lines":[{"speaker":"pc","id":"${tor}","name":"Tor","text":"¿Vamos al pozo?","to":"ti"}]`);
    expect(got).toContain(`"reply_to":{"id":"${tor}","name":"Tor"}`);
    // «hablar con Lia» sin frase: la web abre el modo Decir.
    const talk = await (await fetch(`${base}/api/act${g}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character: tor, text: 'hablar con Lia' }) })).json();
    expect(talk).toMatchObject({ ok: true, say_to: { id: lia, name: 'Lia' } });
    await liaStream.body!.cancel();
  });

  it('dar: el otro ve «Aceptar» y «Rechazar» y, al aceptar, la transferencia se hace', async () => {
    await start();
    const { game, character_id: lia } = await games.create({ name: 'Trato', mode: 'offline', campaign_id: 'demo', character: { name: 'Lia' } });
    const tor = await games.addCharacter(game.slug, 'web:test:2', { name: 'Tor' }, { near: lia });
    const g = `?game=${game.slug}`;
    const post = (path: string, body: unknown) => fetch(`${base}${path}${g}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ ok: boolean; text: string | null }>);
    const liaStream = await fetch(`${base}/api/stream${g}&character=${lia}`);
    await readSse(liaStream, (t) => t.includes('event: history'));
    expect((await post('/api/act', { character: tor, text: 'dar 25 monedas a Lia' })).ok).toBe(true);
    const got = await readSse(liaStream, (t) => t.includes('"offer"'));
    const id = /"offer":\{"id":"([^"]+)","label":"25 monedas","open":true\}/.exec(got)?.[1];
    expect(id).toBeTruthy();
    const engine = await games.open(game.slug);
    const before = engine.world.character(lia).coins;
    expect((await post('/api/offer', { character: lia, offer: id, accept: true })).ok).toBe(true);
    expect(engine.world.character(lia).coins).toBe(before + 25);
    await liaStream.body!.cancel();
  });

  it('Brezal: dos guerreros no comparten situación; «Empezar junto a…» da la de compañero, con su sitio y su reloj', async () => {
    await start();
    const { game, character_id: aren } = await games.create({ name: 'Brezal a tres', mode: 'offline', campaign_id: 'brezal', character: { name: 'Aren', class_id: 'fighter' } });
    const leo = await games.addCharacter(game.slug, 'web:test:2', { name: 'Leodhin', race_id: 'elf', class_id: 'ranger' }, { near: aren });
    const bran = await games.addCharacter(game.slug, 'web:test:3', { name: 'Bran', class_id: 'fighter' });
    const w = (await games.open(game.slug)).world;
    const [a, l, b] = [w.character(aren), w.character(leo), w.character(bran)];
    expect(a.situation!.id).toBe('sit_herrero');
    expect(l.situation!.id).toBe('sit_herrero_companero');
    expect(l.situation!.why_here).toContain('Llegaste con Aren');
    expect(l.situation!.deadline_game_s).toBe(a.situation!.deadline_game_s);
    expect(w.characterSpot(l)!.id).toBe(w.characterSpot(a)!.id);
    expect(l.knows).toContain(aren);
    expect(a.knows).toContain(leo);
    // «llega al banco de trabajo», no «a el».
    const joined = (await games.open(game.slug)).events.all().find((e) => e.action_type === 'character_joined' && e.actor_id === leo);
    expect(joined!.observable).toBe('Leodhin llega al banco de trabajo.');
    // El otro guerrero, sin «junto a», recibe otra situación libre; a los PJ los conoce igual (se conocen por su nombre).
    expect(b.situation!.id).not.toBe('sit_herrero');
    expect(b.knows).toEqual(expect.arrayContaining([aren, leo]));
  });
});

describe('varios a la vez en la web', () => {
  it('«está escribiendo…» llega a los demás del sitio; la presencia dice con quién habla cada uno', async () => {
    await start();
    const { game, character_id: lia } = await games.create({ name: 'Barra', mode: 'offline', campaign_id: 'demo', character: { name: 'Lia' } });
    const tor = await games.addCharacter(game.slug, 'web:test:2', { name: 'Tor' }, { near: lia });
    const g = `?game=${game.slug}`;
    const engine = await games.open(game.slug);
    const liaStream = await fetch(`${base}/api/stream${g}&character=${lia}`);
    await readSse(liaStream, (t) => t.includes('event: presence'));
    await fetch(`${base}/api/typing${g}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character: tor }) });
    const typing = await readSse(liaStream, (t) => t.includes('event: typing'));
    expect(typing).toContain(`event: typing\ndata: {"id":"${tor}","name":"Tor","ms":4000}`);
    // Tor habla con Brenna: Lia lo ve en la presencia.
    const torC = engine.world.character(tor);
    const brenna = engine.world.npc('npc_brenna');
    torC.location = { type: 'spot', id: brenna.location.id };
    engine.world.character(lia).location = { type: 'spot', id: brenna.location.id };
    engine.events.emit({ actor_id: tor, action_type: 'master', narration_private: '«Hola»', observable: null, payload: { npc_id: brenna.id } });
    brenna.talking_to = { character_id: tor, since_game_s: engine.gameNow() };
    const again = await fetch(`${base}/api/stream${g}&character=${lia}`);
    const pres = await readSse(again, (t) => /event: presence\ndata: .*\n\n/.test(t));
    // Lia no sabe cómo se llama Brenna: la nombra por su oficio.
    expect(pres).toContain('Tor está aquí, hablando con la tabernera');
    await again.body!.cancel();
    await liaStream.body!.cancel();
  });
});
