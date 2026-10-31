import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager } from '../src/games/manager.js';
import type { AccessOptions } from '../src/adapters/web/access.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { ReportQuota, REPORTS_PER_HOUR, type Report } from '../src/adapters/web/report.js';
import { costOf, releaseOf, ServiceStats } from '../src/adapters/web/status.js';
import type { MasterCall } from '../src/engine/engine.js';

const INVITE: AccessOptions = { mode: 'invite', adminToken: 'token-de-admin-para-los-tests', secret: 'secreto-de-los-tests' };

describe('coste estimado (status.ts)', () => {
  it('por modelo, con la caché a su precio; un modelo sin precio no inventa nada', () => {
    expect(costOf('claude-haiku-5-5', { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 1_000_000 })).toBeCloseTo(0.1 + 0.5 + 0.01 + 0.2);
    expect(costOf('claude-opus-5-5', { input: 1_000_000 })).toBeCloseTo(4);
    // claude-opus-5 no se lleva el precio de claude-opus-5-5 por parecerse.
    expect(costOf('claude-opus-5', { input: 1_000_000 })).toBeCloseTo(5);
    expect(costOf('offline', { input: 100 })).toBeNull();
  });

  it('la versión sale de la carpeta de releases, con barras de cualquier sistema', () => {
    expect(releaseOf('/opt/tavernus/releases/20261031-093930/dist/adapters/web/status.js')).toBe('20261031-093930');
    expect(releaseOf('D:\\MyProjects\\tavernus\\src\\adapters\\web\\status.ts')).toBeNull();
  });
});

describe('contadores del servicio (status.ts)', () => {
  const call = (over: Partial<MasterCall> = {}): MasterCall => ({
    character_id: 'c', action_type: 'master', ok: true, model: 'claude-haiku-5-5', ms: 10,
    usage: { input: 1_000_000, output: 0, cache_read: 0, cache_write: 0, iterations: 1 }, ...over,
  });
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-estado-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('la última hora se vacía con el tiempo; el día, al cambiar de fecha', () => {
    let t = Date.UTC(2026, 9, 31, 10, 0);
    const s = new ServiceStats(null, 'UTC', () => t);
    s.master(call());
    s.action({ game: 'g', character: 'c', name: null, kind: 'act', ms: 1, result: 'ok', calls: [] });
    expect(s.lastHour()).toMatchObject({ master_calls: 1, actions: 1 });
    t += 2 * 3_600_000;
    expect(s.lastHour().master_calls).toBe(0);
    expect(s.today().master_calls).toBe(1);
    t += 24 * 3_600_000;
    expect(s.today().master_calls).toBe(0);
  });

  it('separa los errores del máster de las excepciones, y suma el actor', () => {
    const s = new ServiceStats(null, 'UTC');
    const bad = call({ ok: false, model: null, usage: null, error: { reason: 'api_error', message: 'x' } });
    s.master(bad);
    // La acción de ese máster caído no cuenta otra vez como error del servidor.
    s.action({ game: 'g', character: 'c', name: null, kind: 'act', ms: 1, result: 'error', calls: [bad] });
    s.action({ game: 'g', character: 'c', name: null, kind: 'act', ms: 1, result: 'error', calls: [] });
    s.master(call({ actor: { model: 'claude-haiku-5-5', input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 } }));
    s.master(call({ model: 'offline' }));
    const t = s.today();
    expect(t).toMatchObject({ master_errors: 1, action_errors: 1, master_calls: 3, unpriced: 1 });
    expect(t.usd).toBeCloseTo(0.2);
  });

  it('sobrevive a un reinicio: un despliegue no pone a cero el coste del día', () => {
    const file = join(dir, '.estado.json');
    const a = new ServiceStats(file, 'UTC');
    a.master(call());
    a.flush();
    const b = new ServiceStats(file, 'UTC');
    expect(b.today().master_calls).toBe(1);
    expect(b.today().usd).toBeCloseTo(0.1);
  });

  it('con el fichero roto empieza de cero en vez de no arrancar', async () => {
    const file = join(dir, '.estado.json');
    await writeFile(file, '{ esto no es json');
    expect(new ServiceStats(file, 'UTC').today().master_calls).toBe(0);
  });
});

describe('cupo de reportes', () => {
  it('por PJ y hora', () => {
    let t = 0;
    const q = new ReportQuota(2, () => t);
    expect([q.take('a'), q.take('a'), q.take('a'), q.take('b')]).toEqual([true, true, false, true]);
    t = 3_600_001;
    expect(q.take('a')).toBe(true);
  });
});

describe('reportar y /admin/estado en la web', () => {
  let dir: string;
  let games: GameManager;
  let web: WebServer;
  let base: string;
  let lines: string[];

  async function start(access?: AccessOptions) {
    games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: (e) => new Master(e, { client: offlineClient() }), engine: { deterministic: false }, log: () => {}, budget: null });
    web = createWebServer(games, { tickMs: 3_600_000, log: (l) => lines.push(l), ...(access ? { access } : {}) });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
  }
  const postJson = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

  /** Partida offline con un PJ (invitación: entrando como anfitrión) y un turno jugado: su evento del máster. */
  async function played(cookie = ''): Promise<{ slug: string; pj: string; seq: number }> {
    const made = await (await postJson('/api/games', { name: 'Prueba', mode: 'offline', character: 'Ana' }, cookie)).json() as { game: { slug: string }; character_id: string };
    const slug = made.game.slug, pj = made.character_id;
    const r = await (await postJson(`/api/act?game=${slug}`, { character: pj, text: 'Miro a mi alrededor con calma.' }, cookie)).json() as { ok: boolean };
    expect(r.ok).toBe(true);
    const engine = await games.open(slug);
    const ev = [...engine.events.all()].reverse().find((e) => e.actor_id === pj && (e.payload['master'] as object | null | undefined));
    expect(ev).toBeTruthy();
    return { slug, pj, seq: ev!.seq };
  }

  const reportFiles = (slug: string) => readdir(join(dir, 'games', slug, 'reports')).catch(() => [] as string[]);
  const reportFile = async (slug: string, name: string) => JSON.parse(await readFile(join(dir, 'games', slug, 'reports', name), 'utf8')) as Report;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-report-')); lines = []; });
  afterEach(async () => {
    await web.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('un reporte guarda el evento entero, responde sin él y el registro no lleva el texto', async () => {
    await start();
    const { slug, pj, seq } = await played();
    const said = 'El tabernero habla de una espada que no existe';
    const res = await postJson(`/api/report?game=${slug}`, { character: pj, seq, text: said, at: '2026-10-31T10:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const files = await reportFiles(slug);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp(`^\\d{8}-\\d{6}-${seq}\\.json$`));
    const saved = await reportFile(slug, files[0]!);
    expect(saved).toMatchObject({ game: slug, seq, general: false, text: said, client_at: '2026-10-31T10:00:00.000Z', character: { id: pj, name: 'Ana' } });
    expect(saved.event?.seq).toBe(seq);
    expect(saved.event?.narration_private).toBeTruthy();
    const meta = saved.event?.payload['master'] as { model: string; usage: unknown; calls: unknown[] };
    expect(meta.model).toBe('offline');
    expect(meta.usage).toBeTruthy();
    expect(Array.isArray(meta.calls)).toBe(true);
    expect(saved.recent.at(-1)?.seq).toBe(seq);

    const line = lines.find((l) => l.startsWith('[reporte]'))!;
    expect(line).toContain(`partida=${slug} pj=${pj} nombre=Ana seq=${seq} tipo=mensaje`);
    expect(line).toContain(`fichero=${files[0]}`);
    expect(lines.join('\n')).not.toContain('espada que no existe');
  });

  it('sin burbuja («Algo va mal») adjunta lo último que vivió el PJ', async () => {
    await start();
    const { slug, pj } = await played();
    const res = await postJson(`/api/report?game=${slug}`, { character: pj, text: 'El mapa no carga' });
    expect(res.status).toBe(200);
    const saved = await reportFile(slug, (await reportFiles(slug))[0]!);
    expect(saved.general).toBe(true);
    expect(saved.event).toBeTruthy();
    expect(saved.recent.length).toBeGreaterThan(0);
    expect(lines.find((l) => l.startsWith('[reporte]'))).toContain('tipo=general');
  });

  it('dos reportes del mismo evento no se pisan', async () => {
    await start();
    const { slug, pj, seq } = await played();
    await Promise.all([1, 2, 3].map((n) => postJson(`/api/report?game=${slug}`, { character: pj, seq, text: `Fallo ${n}` })));
    expect(await reportFiles(slug)).toHaveLength(3);
  });

  it('rechaza lo vacío, un evento que el PJ no vivió y un seq que no es un número', async () => {
    await start();
    const { slug, pj } = await played();
    expect((await postJson(`/api/report?game=${slug}`, { character: pj, text: '   ' })).status).toBe(400);
    expect((await postJson(`/api/report?game=${slug}`, { character: pj, seq: 999_999, text: 'x' })).status).toBe(404);
    expect((await postJson(`/api/report?game=${slug}`, { character: pj, seq: 'uno', text: 'x' })).status).toBe(400);
    expect(await reportFiles(slug)).toHaveLength(0);
  });

  it('corta el texto largo y frena a quien manda demasiados', async () => {
    await start();
    const { slug, pj } = await played();
    expect((await postJson(`/api/report?game=${slug}`, { character: pj, text: 'x'.repeat(5000) })).status).toBe(200);
    expect((await reportFile(slug, (await reportFiles(slug))[0]!)).text).toHaveLength(1000);
    for (let i = 1; i < REPORTS_PER_HOUR; i++) expect((await postJson(`/api/report?game=${slug}`, { character: pj, text: `n ${i}` })).status).toBe(200);
    expect((await postJson(`/api/report?game=${slug}`, { character: pj, text: 'uno más' })).status).toBe(429);
  });

  it('/admin/estado enseña el reporte con el evento detrás, y sin dejar pasar su HTML', async () => {
    await start();
    const { slug, pj, seq } = await played();
    await postJson(`/api/report?game=${slug}`, { character: pj, seq, text: '<script>alert("hola")</script> se repite' });
    const res = await fetch(`${base}/admin/estado`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const page = await res.text();
    expect(page).toContain('Estado del servidor');
    expect(page).toContain('Reportes (1)');
    expect(page).toContain('&lt;script&gt;alert(&quot;hola&quot;)&lt;/script&gt; se repite');
    expect(page).not.toContain('<script>alert');
    expect(page).toContain(`evento ${seq}`);
    expect(page).toContain('Narración');
    expect(page).toContain('Tools (');
    expect(page).toContain('<details class="report">');
    // La acción jugada, en los contadores; offline no cuesta nada.
    expect(page).toMatch(/Acciones de los jugadores<\/td><td class="n">1<\/td><td class="n">1<\/td>/);
    expect(page).toContain('Coste estimado del máster');
    expect(page).toContain('0,00 $');
  });

  it('dice quién está conectado por partida', async () => {
    await start();
    const { slug, pj } = await played();
    const before = await (await fetch(`${base}/admin/estado`)).text();
    expect(before).toContain('No hay nadie conectado');
    const ctl = new AbortController();
    const stream = await fetch(`${base}/api/stream?game=${slug}&character=${pj}&tab=pestana-1`, { signal: ctl.signal });
    expect(stream.status).toBe(200);
    const page = await (await fetch(`${base}/admin/estado`)).text();
    expect(page).toContain('Prueba');
    expect(page).toMatch(/<td class="n">1<\/td><td>Ana<\/td>/);
    ctl.abort();
  });

  it('un reporte ilegible no rompe la página', async () => {
    await start();
    const { slug, pj } = await played();
    await postJson(`/api/report?game=${slug}`, { character: pj, text: 'bien' });
    await writeFile(join(dir, 'games', slug, 'reports', '99999999-000000-1.json'), '{ roto');
    const page = await (await fetch(`${base}/admin/estado`)).text();
    expect(page).toContain('No se ha podido leer este reporte');
    expect(page).toContain('bien');
  });

  describe('en modo invitación', () => {
    const inviteOf = async (slug: string, admin: string, pick: (s: { character_id: string | null; link: string }) => boolean) => {
      const seats = await (await fetch(`${base}/api/seats?game=${slug}`, { headers: { cookie: admin } })).json() as { seats: { character_id: string | null; link: string }[] };
      return seats.seats.find(pick)!.link;
    };
    const admin = async () => {
      const r = await fetch(`${base}/admin?token=${INVITE.adminToken}`, { redirect: 'manual' });
      expect(r.status).toBe(302);
      return r.headers.get('set-cookie')!.split(';')[0]!;
    };
    /** Entra por el enlace de un asiento: la cookie de ese navegador. */
    const enter = async (link: string) => (await fetch(base + link, { redirect: 'manual' })).headers.get('set-cookie')!.split(';')[0]!;

    it('un jugador reporta, solo con su PJ, y no puede abrir la página', async () => {
      await start(INVITE);
      const host = await admin();
      const { slug, pj, seq } = await played(host);
      const player = await enter(await inviteOf(slug, host, (s) => s.character_id === pj));

      // Sin cookie, o con la de un jugador: 403. Con la de administrador: la página.
      expect((await fetch(`${base}/admin/estado`)).status).toBe(403);
      expect((await fetch(`${base}/admin/estado`, { headers: { cookie: player } })).status).toBe(403);
      expect((await fetch(`${base}/admin/estado`, { headers: { cookie: host } })).status).toBe(200);

      // Sin asiento no se reporta; con asiento, solo con su PJ.
      expect((await postJson(`/api/report?game=${slug}`, { character: pj, seq, text: 'x' })).status).toBe(403);
      expect((await postJson(`/api/report?game=${slug}`, { character: 'ch_otro', seq, text: 'x' }, player)).status).toBe(403);
      const ok = await postJson(`/api/report?game=${slug}`, { character: pj, seq, text: 'Algo raro' }, player);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true });

      expect(await (await fetch(`${base}/admin/estado`, { headers: { cookie: host } })).text()).toContain('Algo raro');
    });

    it('el menú sabe que quien entra con el enlace de administración administra', async () => {
      await start(INVITE);
      const host = await admin();
      const d = await (await fetch(`${base}/api/games`, { headers: { cookie: host } })).json() as { admin: boolean };
      expect(d.admin).toBe(true);
    });
  });

  it('en modo público, quien crea su partida la manda pero no ve el estado del servidor', async () => {
    await start({ ...INVITE, mode: 'public' });
    const made = await postJson('/api/games', { name: 'Mía', mode: 'offline', character: 'Ana' });
    expect(made.status).toBe(200);
    const cookie = made.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(`${base}/admin/estado`, { headers: { cookie } })).status).toBe(403);
    const d = await (await fetch(`${base}/api/games`, { headers: { cookie } })).json() as { admin: boolean };
    expect(d.admin).toBe(false);
  });
});
