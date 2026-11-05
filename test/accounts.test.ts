/**
 * Cuentas de usuario (src/accounts, src/db; docs/MULTIJUGADOR.md, «Cuentas»): registro, entrada y sesiones,
 * partidas por usuario, biblioteca de personajes, invitaciones con cuenta, migración de las partidas de antes
 * y el panel del administrador. Todo contra PostgreSQL de verdad (PGlite en memoria) y sin clave de API.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager } from '../src/games/manager.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { seatCookieValue, type AccessOptions } from '../src/adapters/web/access.js';
import { AccountError, Accounts, ensureAdmin, hashPassword, usernameKey, verifyPassword } from '../src/accounts/accounts.js';
import { memoryDb, type Db } from '../src/db/db.js';
import { DbCatalog } from '../src/db/catalog.js';

const PASS = 'contraseña-de-pruebas';
const ROGUE = { race: 'elf', class: 'rogue', background: 'criminal', abilities: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 }, skills: ['acrobatics', 'athletics', 'insight', 'investigation'], death_mode: 'casual' };

describe('cuentas: contraseñas, usuarios y sesiones', () => {
  let db: Db;
  let accounts: Accounts;
  let now = Date.now();
  beforeAll(async () => { db = await memoryDb(); });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.query('delete from users');
    now = Date.now();
    accounts = new Accounts(db, () => now);
  });

  it('las contraseñas se guardan con scrypt y sal, nunca en claro', async () => {
    const a = await hashPassword('una contraseña');
    const b = await hashPassword('una contraseña');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('una contraseña', a)).toBe(true);
    expect(await verifyPassword('otra', a)).toBe(false);
    expect(await verifyPassword('una contraseña', 'texto-plano')).toBe(false);
    await accounts.register('Miguel', PASS);
    const [row] = await db.query<{ password_hash: string }>('select password_hash from users');
    expect(row!.password_hash).not.toContain(PASS);
  });

  it('registro: nombre único sin mayúsculas ni tildes, reglas del nombre y de la contraseña', async () => {
    const u = await accounts.register('  Miguel ', PASS);
    expect(u).toMatchObject({ username: 'Miguel', is_admin: false, disabled: false });
    expect(usernameKey('MiguÉl')).toBe('miguel');
    await expect(accounts.register('miguél', PASS)).rejects.toMatchObject({ status: 409, field: 'username' });
    await expect(accounts.register('ab', PASS)).rejects.toMatchObject({ field: 'username' });
    await expect(accounts.register('con espacio', PASS)).rejects.toMatchObject({ field: 'username' });
    await expect(accounts.register('lucía_2', 'corta')).rejects.toMatchObject({ field: 'password' });
    expect(await accounts.register('lucía_2', PASS)).toMatchObject({ username: 'lucía_2' });
  });

  it('entrar: bien, mal (mismo mensaje exista o no) y con demasiados intentos espera', async () => {
    await accounts.register('ana', PASS);
    expect((await accounts.authenticate('ANA', PASS, '1.1.1.1')).last_login_at).not.toBeNull();
    const bad = await accounts.authenticate('ana', 'otra-cosa', '1.1.1.1').catch((e: AccountError) => e);
    const none = await accounts.authenticate('nadie', PASS, '1.1.1.1').catch((e: AccountError) => e);
    expect(bad).toBeInstanceOf(AccountError);
    expect((bad as AccountError).message).toBe((none as AccountError).message);
    for (let i = 0; i < 10; i++) await accounts.authenticate('ana', 'mal', '2.2.2.2').catch(() => {});
    await expect(accounts.authenticate('ana', PASS, '2.2.2.2')).rejects.toMatchObject({ status: 429 });
    // Desde otra IP, sí; y pasado el rato, también.
    await accounts.authenticate('ana', PASS, '3.3.3.3');
    now += 16 * 60_000;
    await accounts.authenticate('ana', PASS, '2.2.2.2');
  });

  it('sesiones: el token vale hasta cerrarla, cambiar la contraseña o desactivar la cuenta', async () => {
    const u = await accounts.register('ana', PASS);
    const t1 = await accounts.createSession(u.id);
    const t2 = await accounts.createSession(u.id);
    expect((await accounts.sessionUser(t1))!.id).toBe(u.id);
    // En la base solo está su hash.
    expect(JSON.stringify(await db.query('select * from sessions'))).not.toContain(t1);
    await accounts.endSession(t1);
    expect(await accounts.sessionUser(t1)).toBeNull();
    // Cambiar la contraseña cierra las demás, menos la de quien la cambia.
    const t3 = await accounts.createSession(u.id);
    await accounts.changeOwnPassword(u.id, PASS, 'otra-contraseña', t3);
    expect(await accounts.sessionUser(t2)).toBeNull();
    expect(await accounts.sessionUser(t3)).not.toBeNull();
    await expect(accounts.changeOwnPassword(u.id, 'no-es', 'otra-mas-larga', t3)).rejects.toMatchObject({ field: 'current' });
    await accounts.setDisabled(u.id, true);
    expect(await accounts.sessionUser(t3)).toBeNull();
    await expect(accounts.authenticate('ana', 'otra-contraseña')).rejects.toMatchObject({ status: 403 });
    expect(await accounts.sessionUser('inventado')).toBeNull();
  });

  it('administradores: el primero sin navegador, y nunca se queda el servidor sin ninguno', async () => {
    const { user, created } = await ensureAdmin(accounts, 'jefa', PASS);
    expect(created).toBe(true);
    expect(user.is_admin).toBe(true);
    const ana = await accounts.register('ana', PASS);
    expect((await ensureAdmin(accounts, 'ANA', null)).user).toMatchObject({ id: ana.id, is_admin: true });
    await accounts.setAdmin(ana.id, false);
    await expect(accounts.setAdmin(user.id, false)).rejects.toMatchObject({ status: 409 });
    await expect(accounts.deleteUser(user.id)).rejects.toMatchObject({ status: 409 });
    await expect(accounts.setDisabled(user.id, true)).rejects.toMatchObject({ status: 409 });
    await expect(ensureAdmin(accounts, 'nadie', null)).rejects.toThrow(/contraseña/);
  });

  it('biblioteca: crear, editar y borrar, validado como en la creación', async () => {
    const u = await accounts.register('ana', PASS);
    const other = await accounts.register('bea', PASS);
    const c = await accounts.addCharacter(u.id, { name: ' Tam ', race_id: 'elf', class_id: 'rogue', background_id: 'criminal', hook: 'Busca a su hermano', death_mode: 'hardcore' });
    expect(c).toMatchObject({ name: 'Tam', race_id: 'elf', class_id: 'rogue', hook: 'Busca a su hermano', death_mode: 'hardcore' });
    await expect(accounts.addCharacter(u.id, { name: 'X' })).rejects.toMatchObject({ field: 'name' });
    await expect(accounts.addCharacter(u.id, { name: 'Tom', race_id: 'orco' })).rejects.toMatchObject({ field: 'race' });
    expect((await accounts.updateCharacter(u.id, c.id, { name: 'Tamsin', race_id: 'elf', class_id: 'rogue' })).name).toBe('Tamsin');
    // Lo de otro usuario ni se ve ni se toca.
    expect(await accounts.library(other.id)).toEqual([]);
    await expect(accounts.updateCharacter(other.id, c.id, { name: 'Robado' })).rejects.toMatchObject({ status: 404 });
    await expect(accounts.deleteCharacter(other.id, c.id)).rejects.toMatchObject({ status: 404 });
    await accounts.deleteCharacter(u.id, c.id);
    expect(await accounts.library(u.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// La web con cuentas
// ---------------------------------------------------------------------------

let dir: string;
let games: GameManager;
let web: WebServer;
let db: Db;
let base: string;
const SECRET = 'secreto-de-tests';

async function start(access: AccessOptions, opts: { importFolders?: boolean } = {}) {
  games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: (e) => new Master(e, { client: offlineClient() }), engine: { deterministic: false }, log: () => {}, budget: null });
  db = await memoryDb();
  // Como startWeb: el catálogo pasa a la base y entran las partidas que ya había en carpetas.
  const catalog = new DbCatalog(db, games.root);
  if (opts.importFolders) await catalog.importFolders();
  games.useCatalog(catalog);
  web = createWebServer(games, { tickMs: 3_600_000, access, db, log: () => {} });
  await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
}

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-cuentas-')); });
afterEach(async () => {
  await web?.stop();
  await db?.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

function browser() {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (r: Response) => {
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';'); const i = kv!.indexOf('=');
      if (/Max-Age=0/.test(c)) jar.delete(kv!.slice(0, i)); else jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    return r;
  };
  const b = {
    jar,
    get: (path: string) => fetch(base + path, { redirect: 'manual', headers: { cookie: cookie() } }).then(keep),
    post: (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { cookie: cookie(), 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(keep),
    del: (path: string) => fetch(base + path, { method: 'DELETE', redirect: 'manual', headers: { cookie: cookie() } }).then(keep),
    json: async <T = Record<string, unknown>>(path: string) => (await b.get(path)).json() as Promise<T>,
    signUp: async (username: string, extra: Record<string, unknown> = {}) => {
      const r = await b.post('/api/auth/register', { username, password: PASS, ...extra });
      expect(r.status, await r.clone().text()).toBe(200);
      return (await r.json()) as { ok: boolean; next: string; text?: string };
    },
    login: (username: string, password = PASS) => b.post('/api/auth/login', { username, password }),
  };
  return b;
}

const PUBLIC: AccessOptions = { mode: 'public', adminToken: 'token-de-admin-para-tests', secret: SECRET };
type GamesList = { games: { slug: string; host: boolean }[]; user: { username: string } | null; can_create: boolean };

describe('la web con cuentas', () => {
  it('registro, entrada, salida y la misma cuenta en dos dispositivos', async () => {
    await start(PUBLIC);
    const pc = browser();
    expect((await pc.get('/')).headers.get('location')).toBe('/entrar');
    expect(await (await pc.get('/entrar')).text()).toContain('Crear cuenta');
    expect((await pc.post('/api/auth/register', { username: 'mi', password: PASS })).status).toBe(400);
    await pc.signUp('Miguel');
    const cookie = (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'miguel', password: PASS }) })).headers.getSetCookie().find((c) => c.startsWith('tv_u='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect((await pc.json<GamesList>('/api/games')).user).toMatchObject({ username: 'Miguel' });
    // Ya dentro, /entrar lleva al menú.
    expect((await pc.get('/entrar')).headers.get('location')).toBe('/');

    // Crea su partida en el PC y la ve desde el móvil al entrar con su cuenta.
    const made = (await (await pc.post('/api/games', { name: 'La de Miguel', mode: 'offline', character: 'Kel', ...ROGUE, seats: 0 })).json()) as { game: { slug: string }; character_id: string };
    const phone = browser();
    expect((await phone.login('miguel', 'mala')).status).toBe(401);
    expect((await phone.login('MIGUEL')).status).toBe(200);
    expect((await phone.json<GamesList>('/api/games')).games.map((g) => [g.slug, g.host])).toEqual([[made.game.slug, true]]);
    expect((await phone.json<{ character_id: string }>(`/api/session?game=${made.game.slug}`)).character_id).toBe(made.character_id);

    // Cerrar sesión en el móvil no cierra la del PC.
    expect((await phone.post('/api/auth/logout')).status).toBe(200);
    expect(phone.jar.has('tv_u')).toBe(false);
    expect((await phone.get('/api/games')).status).toBe(401);
    expect((await pc.get('/api/games')).status).toBe(200);
  });

  it('cada usuario ve sus partidas y aquellas a las que se unió; las ajenas, no', async () => {
    await start(PUBLIC);
    const ana = browser(), bea = browser(), cris = browser();
    await ana.signUp('ana'); await bea.signUp('bea'); await cris.signUp('cris');
    const a = (await (await ana.post('/api/games', { name: 'De Ana', mode: 'offline', character: 'Aren', seats: 1 })).json()) as { game: { slug: string } };
    const b = (await (await bea.post('/api/games', { name: 'De Bea', mode: 'offline', character: 'Tor', seats: 0 })).json()) as { game: { slug: string } };
    expect((await ana.json<GamesList>('/api/games')).games.map((g) => g.slug)).toEqual([a.game.slug]);
    expect((await bea.json<GamesList>('/api/games')).games.map((g) => g.slug)).toEqual([b.game.slug]);
    expect((await cris.json<GamesList>('/api/games')).games).toEqual([]);
    expect((await cris.get(`/api/session?game=${a.game.slug}`)).status).toBe(403);
    expect((await cris.del(`/api/games?game=${a.game.slug}`)).status).toBe(403);
    expect((await cris.get(`/?game=${a.game.slug}`)).status).toBe(403);

    // Bea se une a la de Ana con su enlace: la ve en su lista, sin gestionarla.
    const seats = await ana.json<{ seats: { link: string; character_id: string | null; user: string | null }[] }>(`/api/seats?game=${a.game.slug}`);
    expect(seats.seats.find((s) => s.character_id)!.user).toBe('ana');
    const free = seats.seats.find((s) => !s.character_id)!;
    expect((await bea.get(free.link)).headers.get('location')).toBe(`/?game=${a.game.slug}`);
    expect((await bea.json<GamesList>('/api/games')).games.map((g) => [g.slug, g.host]).sort()).toEqual([[a.game.slug, false], [b.game.slug, true]].sort());
    expect((await ana.json<{ seats: { user: string | null }[] }>(`/api/seats?game=${a.game.slug}`)).seats.map((s) => s.user)).toEqual(['ana', 'bea']);
    // El mismo enlace, ya de Bea, no vale para Cris.
    expect((await cris.get(free.link)).status).toBe(409);
  });

  it('biblioteca: crear partida con un personaje guardado, y la copia de la partida no cambia al editarlo', async () => {
    await start(PUBLIC);
    const ana = browser();
    await ana.signUp('ana');
    expect((await ana.post('/api/library', { name: 'X' })).status).toBe(400);
    const tam = ((await (await ana.post('/api/library', { name: 'Tam', ...ROGUE, appearance: 'Pelo cobrizo', hook: 'Busca a su hermano' })).json()) as { character: { id: string } }).character;
    const made = (await (await ana.post('/api/games', { name: 'Con Tam', mode: 'offline', template_id: tam.id, seats: 0 })).json()) as { ok: boolean; game: { slug: string }; character_id: string };
    expect(made.ok).toBe(true);
    const engine = await games.open(made.game.slug);
    expect(engine.world.character(made.character_id)).toMatchObject({ name: 'Tam', race_id: 'elf', class_id: 'rogue', background_id: 'criminal' });

    // Editar la plantilla no toca la copia que juega.
    expect((await ana.post(`/api/library/${tam.id}`, { name: 'Tamsin', ...ROGUE })).status).toBe(200);
    expect(engine.world.character(made.character_id).name).toBe('Tam');
    const lib = (await ana.json<{ characters: { name: string; games: { slug: string }[] }[] }>('/api/library')).characters;
    expect(lib).toMatchObject([{ name: 'Tamsin', games: [{ slug: made.game.slug }] }]);

    // Un personaje nuevo al crear partida queda en la biblioteca; con save:false, no.
    await ana.post('/api/games', { name: 'Otra', mode: 'offline', character: 'Lia', ...ROGUE, seats: 0 });
    await ana.post('/api/games', { name: 'Y otra', mode: 'offline', character: 'Nadia', ...ROGUE, seats: 0, save: false });
    expect((await ana.json<{ characters: { name: string }[] }>('/api/library')).characters.map((c) => c.name).sort()).toEqual(['Lia', 'Tamsin']);
    // La plantilla de otro usuario no se puede usar.
    const bea = browser();
    await bea.signUp('bea');
    expect((await bea.post('/api/games', { name: 'Robo', mode: 'offline', template_id: tam.id })).status).toBe(404);
    // Borrarla no borra la partida.
    expect((await ana.del(`/api/library/${tam.id}`)).status).toBe(200);
    expect((await ana.get(`/api/session?game=${made.game.slug}`)).status).toBe(200);
    expect((await bea.del(`/api/library/${tam.id}`)).status).toBe(404);
  });

  it('invitación sin cuenta: entrar o registrarse liga el asiento, que se ocupa con un personaje de la biblioteca', async () => {
    await start({ ...PUBLIC, mode: 'invite' });
    const admin = browser();
    await admin.get(`/admin?token=${PUBLIC.adminToken}`);
    const made = (await (await admin.post('/api/games', { name: 'Mesa', mode: 'offline', character: 'Aren', seats: 2 })).json()) as { game: { slug: string }; character_id: string };
    const g = `?game=${made.game.slug}`;
    const free = (await admin.json<{ seats: { link: string; character_id: string | null }[] }>(`/api/seats${g}`)).seats.filter((s) => !s.character_id);

    // Ya tenía cuenta (la creó con otra invitación) y un personaje en la biblioteca.
    const lia = browser();
    const r1 = await lia.get(free[0]!.link);
    expect(r1.headers.get('location')).toBe(`/entrar?invite=${encodeURIComponent(free[0]!.link.slice(3))}`);
    expect((await lia.signUp('lia', { invite: free[0]!.link.slice(3) })).next).toBe(`/${g}`);
    const tam = ((await (await lia.post('/api/library', { name: 'Tam', ...ROGUE })).json()) as { character: { id: string } }).character;
    // Entra en la partida: la página le ofrece su biblioteca.
    const page = await (await lia.get(`/${g}`)).text();
    expect(page).toContain('Te han invitado');
    expect(page).toContain('"name":"Tam"');
    const claim = (await (await lia.post(`/api/seat/claim${g}`, { template_id: tam.id, near: made.character_id })).json()) as { ok: boolean; character_id: string };
    expect(claim.ok).toBe(true);
    expect((await games.open(made.game.slug)).world.character(claim.character_id).name).toBe('Tam');

    // Otra persona: abre el enlace, entra con una cuenta que ya existía y el asiento es suyo.
    const ex = browser();
    const pre = await ex.signUp('otra-cuenta', { invite: free[1]!.link.slice(3) });
    expect(pre.next).toBe(`/${g}`);
    // Con su biblioteca vacía, el asistente; el nombre ya cogido no entra.
    expect((await ex.post(`/api/seat/claim${g}`, { name: 'Tam', ...ROGUE })).status).toBe(400);
    expect((await ex.post(`/api/seat/claim${g}`, { name: 'Bo', ...ROGUE })).status).toBe(200);
    // Ya ocupado: otro usuario con ese enlace no entra; ella sí, aunque abra de nuevo el enlace.
    expect((await ex.get(free[1]!.link)).headers.get('location')).toBe(`/${g}`);
    const late = browser();
    await late.signUp('tarde', { invite: free[1]!.link.slice(3) }).catch(() => null);
    expect((await late.json<GamesList>('/api/games')).games).toEqual([]);
    // Y la invitación inventada no deja crear cuenta en modo invite.
    expect((await browser().post('/api/auth/register', { username: 'cuela', password: PASS, invite: `${made.game.slug}/${'x'.repeat(32)}` })).status).toBe(403);
  });

  it('migración: las partidas de antes entran en la base y su anfitrión se las lleva al entrar con su cuenta', async () => {
    // Una partida de antes de las cuentas: game.json y seats.json en su carpeta, sin dueño.
    const old = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: () => null, log: () => {}, budget: null });
    const made = await old.create({ name: 'La del móvil', mode: 'offline', character: { name: 'Kel' } });
    await old.closeAll();
    const hostSeat = { id: 'asientoAnf1', token: 'tokendeanfitrion0123456789abcdef', character_id: made.character_id, label: 'Anfitrión', host: true, created_at: new Date().toISOString(), last_seen_at: null };
    const guestSeat = { id: 'asientoInv2', token: 'tokendeinvitado0123456789abcdefg', character_id: null, label: 'Plaza 2', created_at: new Date().toISOString(), last_seen_at: null };
    await writeFile(join(dir, 'games', made.game.slug, 'seats.json'), JSON.stringify({ version: 1, seats: [hostSeat, guestSeat] }), 'utf8');

    await start(PUBLIC, { importFolders: true });
    const slug = made.game.slug;
    expect((await db.query<{ slug: string; owner_id: string | null }>('select slug, owner_id from games'))).toEqual([{ slug, owner_id: null }]);
    expect((await db.query('select id from seats order by id')).length).toBe(2);
    // Lo que había en disco sigue ahí.
    expect(JSON.parse(await readFile(join(dir, 'games', slug, 'seats.json'), 'utf8')).seats).toHaveLength(2);

    // Sin cuenta, la cookie de antes ya no abre la partida.
    const phone = browser();
    phone.jar.set(`tv_s_${slug}`, seatCookieValue(SECRET, slug, hostSeat));
    expect((await phone.get(`/?game=${slug}`)).headers.get('location')).toBe(`/entrar?next=${encodeURIComponent(`/?game=${slug}`)}`);
    // Se registra en ese móvil: la partida pasa a ser suya y su asiento, de su cuenta.
    await phone.signUp('miguel');
    expect(phone.jar.has(`tv_s_${slug}`)).toBe(false);
    expect((await phone.json<GamesList>('/api/games')).games.map((g) => [g.slug, g.host])).toEqual([[slug, true]]);
    // Y desde el PC, con su cuenta, también.
    const pc = browser();
    await pc.login('miguel');
    expect((await pc.json<{ character_id: string; role: string }>(`/api/session?game=${slug}`))).toMatchObject({ character_id: made.character_id, role: 'admin' });

    // Una cookie falsificada no se lleva nada.
    const thief = browser();
    thief.jar.set(`tv_s_${slug}`, `${guestSeat.id}.firmafalsa`);
    await thief.signUp('ladron');
    expect((await thief.json<GamesList>('/api/games')).games).toEqual([]);
  });

  it('panel del administrador: solo para administradores; contraseñas, roles, borrar y asignar partidas', async () => {
    await start(PUBLIC);
    await ensureAdmin(new Accounts(db), 'jefa', PASS);
    const boss = browser(), ana = browser(), bea = browser();
    await boss.login('jefa');
    await ana.signUp('ana');
    await bea.signUp('bea');
    const a = (await (await ana.post('/api/games', { name: 'De Ana', mode: 'offline', character: 'Aren', seats: 0 })).json()) as { game: { slug: string } };

    // Un usuario normal: 403 en todo el panel y en el estado del servidor.
    expect((await ana.get('/admin/usuarios')).status).toBe(403);
    expect((await ana.get('/api/admin/users')).status).toBe(403);
    expect((await ana.post('/api/admin/games/assign', { game: a.game.slug, user: 'ana' })).status).toBe(403);
    expect((await ana.get('/admin/estado')).status).toBe(403);
    // La administradora: el panel, todas las partidas y el estado.
    expect(await (await boss.get('/admin/usuarios')).text()).toContain('Administración');
    expect((await boss.get('/admin/estado')).status).toBe(200);
    expect((await boss.json<GamesList>('/api/games')).games.map((g) => g.slug)).toEqual([a.game.slug]);
    expect((await boss.json<{ admin: boolean }>('/api/me')).admin).toBe(true);
    type U = { id: string; username: string; is_admin: boolean; games: number; characters: number };
    const users = (await boss.json<{ users: U[] }>('/api/admin/users')).users;
    expect(users.map((u) => [u.username, u.is_admin, u.games, u.characters])).toEqual([['jefa', true, 0, 0], ['ana', false, 1, 1], ['bea', false, 0, 0]]);
    const anaId = users.find((u) => u.username === 'ana')!.id;
    const detail = await boss.json<{ characters: { name: string }[]; games: { slug: string; owner: boolean }[] }>(`/api/admin/users/${anaId}`);
    expect(detail).toMatchObject({ characters: [{ name: 'Aren' }], games: [{ slug: a.game.slug, owner: true }] });

    // Contraseña nueva: su sesión abierta se cierra y entra con la nueva.
    expect((await boss.post(`/api/admin/users/${anaId}`, { password: 'corta' })).status).toBe(400);
    expect((await boss.post(`/api/admin/users/${anaId}`, { password: 'la-nueva-de-ana' })).status).toBe(200);
    expect((await ana.get('/api/games')).status).toBe(401);
    expect((await ana.login('ana', 'la-nueva-de-ana')).status).toBe(200);
    // Hacerla admin y quitárselo; a sí misma no se lo quita.
    expect((await boss.post(`/api/admin/users/${anaId}`, { admin: true })).status).toBe(200);
    expect((await ana.get('/api/admin/users')).status).toBe(200);
    expect((await boss.post(`/api/admin/users/${anaId}`, { admin: false })).status).toBe(200);
    const bossId = users.find((u) => u.username === 'jefa')!.id;
    expect((await boss.post(`/api/admin/users/${bossId}`, { admin: false })).status).toBe(409);

    // Borrar a Ana: su partida queda sin dueño (y entera); asignarla a Bea se la da con el asiento del anfitrión.
    expect((await boss.del(`/api/admin/users/${anaId}`)).status).toBe(200);
    expect((await ana.get('/api/games')).status).toBe(401);
    expect((await db.query<{ owner_id: string | null }>('select owner_id from games'))[0]!.owner_id).toBeNull();
    expect((await games.open(a.game.slug)).world.characters.size).toBeGreaterThan(0);
    expect((await boss.post('/api/admin/games/assign', { game: a.game.slug, user: 'nadie' })).status).toBe(404);
    expect((await boss.post('/api/admin/games/assign', { game: a.game.slug, user: 'bea' })).status).toBe(200);
    expect((await bea.json<GamesList>('/api/games')).games.map((g) => [g.slug, g.host])).toEqual([[a.game.slug, true]]);
    expect((await bea.json<{ character_id: string | null }>(`/api/session?game=${a.game.slug}`)).character_id).not.toBeNull();

    // Desactivar a Bea la saca; crear una cuenta desde el panel.
    const beaId = (await boss.json<{ users: U[] }>('/api/admin/users')).users.find((u) => u.username === 'bea')!.id;
    expect((await boss.post(`/api/admin/users/${beaId}`, { disabled: true })).status).toBe(200);
    expect((await bea.get('/api/games')).status).toBe(401);
    expect((await bea.login('bea')).status).toBe(403);
    expect((await boss.post('/api/admin/users', { username: 'nueva', password: PASS })).status).toBe(200);
    expect((await browser().login('nueva')).status).toBe(200);
    const log = (await boss.json<{ log: { action: string }[] }>('/api/admin/users')).log.map((l) => l.action);
    expect(log).toEqual(expect.arrayContaining(['cambió la contraseña de', 'borró la cuenta de', 'dio a bea la partida', 'desactivó a', 'creó la cuenta de']));
  });

  it('el enlace de administración sigue valiendo como rescate, sin cuenta', async () => {
    await start(PUBLIC);
    const rescue = browser();
    expect((await rescue.get('/admin?token=otro')).status).toBe(403);
    await rescue.get(`/admin?token=${PUBLIC.adminToken}`);
    expect((await rescue.get('/admin/usuarios')).status).toBe(200);
    expect((await rescue.json<{ ok: boolean }>('/api/admin/users')).ok).toBe(true);
  });
});

describe('modo open (local)', () => {
  it('sin registrarse se ve todo y se juega, como siempre; con cuenta, también hay biblioteca', async () => {
    await start({ mode: 'open', adminToken: null, secret: SECRET });
    const b = browser();
    expect(await (await b.get('/')).text()).toContain('Nueva partida');
    const made = (await (await b.post('/api/games', { name: 'Local', mode: 'offline', character: 'Kel', seats: 0 })).json()) as { ok: boolean; game: { slug: string } };
    expect(made.ok).toBe(true);
    expect((await b.json<GamesList>('/api/games')).games).toHaveLength(1);
    expect((await b.get(`/api/session?game=${made.game.slug}`)).status).toBe(200);
    expect((await b.get('/api/library')).status).toBe(401);
    await b.signUp('local');
    expect((await b.get('/api/library')).status).toBe(200);
  });
});

describe('páginas de las cuentas', () => {
  it('el JavaScript de cada página se puede leer (entrar, panel, unirse, invitaciones y menú)', async () => {
    const { accountPage } = await import('../src/adapters/web/page-account.js');
    const { adminPage } = await import('../src/adapters/web/page-admin.js');
    const { joinPage, seatsPage } = await import('../src/adapters/web/page-access.js');
    const { MENU } = await import('../src/adapters/web/page-menu.js');
    const pages = [
      accountPage({ mode: 'public', invite: { game: 'Mesa <b>', value: 'mesa/abc' }, next: '/?game=mesa' }),
      accountPage({ mode: 'invite', invite: null, next: null }),
      adminPage(),
      joinPage({ game: { slug: 'mesa', name: 'Mesa' }, options: GameManager.characterOptions(), others: [{ id: 'a', name: 'Aren' }], library: [{ id: 'x', name: 'Tam', race_id: 'elf', class_id: 'rogue', taken: false }] }),
      seatsPage('mesa'),
      MENU,
    ];
    for (const html of pages) {
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      expect(scripts.length).toBeGreaterThan(0);
      for (const code of scripts) expect(() => new Function(code)).not.toThrow();
      expect(html).not.toMatch(/ · |•/);
    }
    // El nombre de la partida de la invitación va escapado.
    expect(pages[0]).toContain('Mesa &lt;b&gt;');
  });
});

describe('catálogo de partidas en la base', () => {
  it('crear, listar y borrar van a la tabla; el game.json se escribe como copia', async () => {
    const root = join(dir, 'games');
    const base = await memoryDb();
    try {
      const gm = new GameManager({ root, env: { DATA_DIR: join(dir, 'local') }, masterFor: () => null, log: () => {}, budget: null, catalog: new DbCatalog(base, root) });
      const made = await gm.create({ name: 'En la base', mode: 'offline', dice_seed: 4_000_000_000 });
      const [row] = await base.query<{ name: string; dice_seed: number }>('select name, dice_seed from games where slug = $1', [made.game.slug]);
      expect(row).toEqual({ name: 'En la base', dice_seed: 4_000_000_000 });
      expect(JSON.parse(await readFile(join(root, made.game.slug, 'game.json'), 'utf8')).name).toBe('En la base');
      expect((await gm.list()).map((g) => g.slug)).toEqual([made.game.slug]);
      expect((await gm.get(made.game.slug))!.dice_seed).toBe(4_000_000_000);
      // Un segundo con el mismo nombre no pisa al primero.
      expect((await gm.create({ name: 'En la base', mode: 'offline' })).game.slug).toBe(`${made.game.slug}-2`);
      await gm.delete(made.game.slug);
      expect((await base.query('select slug from games')).length).toBe(1);
      await gm.closeAll();
    } finally { await base.close(); }
  });
});

describe('salud', () => {
  it('/api/health responde sin sesión, también en modo público', async () => {
    await start(PUBLIC);
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
});
