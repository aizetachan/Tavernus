/**
 * Cuentas de usuario (docs/MULTIJUGADOR.md, «Cuentas»): usuarios con nombre y contraseña, sesiones,
 * biblioteca de personajes, dueños de partidas y asientos. Todo en la base (src/db), nada en la web:
 * las rutas y las cookies están en src/adapters/web.
 *
 * Contraseñas: scrypt de node:crypto con sal aleatoria por usuario («scrypt$N$r$p$sal$hash»).
 * Sesiones: token aleatorio en la cookie; en la base solo su sha256, así una copia de la base no abre sesiones.
 */

import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { Db, Queryable } from '../db/db.js';
import { GameManager, type CreateGameInput } from '../games/manager.js';

export type CharacterInput = NonNullable<CreateGameInput['character']>;

export interface User {
  id: string;
  username: string;
  is_admin: boolean;
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
}

/** Para el panel del administrador: el usuario con lo que tiene. */
export interface UserSummary extends User { games: number; characters: number; sessions: number }

export interface LibraryCharacter extends CharacterInput {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface Seat {
  id: string;
  game_slug: string;
  token: string;
  /** Para quién es («Anfitrión», «Plaza 2»…). */
  label: string;
  /** Asiento de quien creó la partida. */
  host: boolean;
  /** PJ del asiento en el mundo de la partida; null = libre, quien entre pone el suyo. */
  character_id: string | null;
  /** Usuario que ocupa el asiento; null = nadie aún (se liga al abrir el enlace con sesión). */
  user_id: string | null;
  /** Plantilla de la biblioteca de la que salió el PJ, si salió de una. */
  template_id: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export class AccountError extends Error {
  constructor(message: string, readonly status = 400, readonly field?: string) { super(message); }
}

export const USERNAME_RULE = /^[\p{L}\p{N}._-]{3,24}$/u;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
export const SESSION_DAYS = 180;
const LIBRARY_MAX = 50;
/** Entradas fallidas por usuario e IP antes de esperar. */
const LOGIN_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
/** Altas por IP y hora (registro abierto en modo public). */
const SIGNUPS_PER_HOUR = 5;

// ---------------------------------------------------------------------------
// Contraseñas
// ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(password: string, salt: Buffer, o = SCRYPT): Promise<Buffer> {
  return new Promise((res, rej) => scryptCb(password.normalize('NFC'), salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scrypt(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p), keylen: want.length });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Clave única del nombre: minúsculas y sin tildes («Miguel» y «miguél» son el mismo). */
export function usernameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function checkPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) throw new AccountError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`, 400, 'password');
  if (password.length > PASSWORD_MAX) throw new AccountError('La contraseña es demasiado larga.', 400, 'password');
  return password;
}

function checkUsername(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().normalize('NFC') : '';
  if (!USERNAME_RULE.test(n)) throw new AccountError('El nombre de usuario debe tener entre 3 y 24 letras, cifras, puntos, guiones o guiones bajos, sin espacios.', 400, 'username');
  return n;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

interface UserRow { id: string; username: string; is_admin: boolean; disabled_at: unknown; created_at: unknown; last_login_at: unknown; last_seen_at: unknown; password_hash?: string }
const USER_COLS = 'id, username, is_admin, disabled_at, created_at, last_login_at, last_seen_at';

function userOf(r: UserRow): User {
  return { id: r.id, username: r.username, is_admin: r.is_admin, disabled: r.disabled_at !== null, created_at: iso(r.created_at)!, last_login_at: iso(r.last_login_at), last_seen_at: iso(r.last_seen_at) };
}

interface SeatRow { id: string; game_slug: string; token: string; label: string; is_host: boolean; character_id: string | null; user_id: string | null; template_id: string | null; created_at: unknown; last_seen_at: unknown }
const SEAT_COLS = 'id, game_slug, token, label, is_host, character_id, user_id, template_id, created_at, last_seen_at';

function seatOf(r: SeatRow): Seat {
  return { id: r.id, game_slug: r.game_slug, token: r.token, label: r.label, host: r.is_host, character_id: r.character_id, user_id: r.user_id, template_id: r.template_id, created_at: iso(r.created_at)!, last_seen_at: iso(r.last_seen_at) };
}

interface CharRow { id: string; name: string; race_id: string | null; class_id: string | null; background_id: string | null; abilities: unknown; skills: unknown; hook: string | null; appearance: string | null; death_mode: string; created_at: unknown; updated_at: unknown }
const CHAR_COLS = 'id, name, race_id, class_id, background_id, abilities, skills, hook, appearance, death_mode, created_at, updated_at';

function charOf(r: CharRow): LibraryCharacter {
  return {
    id: r.id, name: r.name,
    ...(r.race_id ? { race_id: r.race_id } : {}), ...(r.class_id ? { class_id: r.class_id } : {}), ...(r.background_id ? { background_id: r.background_id } : {}),
    ...(r.abilities ? { abilities: r.abilities as NonNullable<CharacterInput['abilities']> } : {}), ...(Array.isArray(r.skills) ? { skills: r.skills as string[] } : {}),
    ...(r.hook ? { hook: r.hook } : {}), ...(r.appearance ? { appearance: r.appearance } : {}),
    death_mode: r.death_mode === 'hardcore' ? 'hardcore' : 'casual',
    created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
  };
}

/** Lo que se guarda de un personaje: lo valida el mismo asistente que al crear la partida (chargen.ts). */
export function cleanCharacter(input: CharacterInput): CharacterInput {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new AccountError('Ponle nombre a tu personaje.', 400, 'name');
  const out: CharacterInput = {
    name,
    ...(input.race_id ? { race_id: input.race_id } : {}), ...(input.class_id ? { class_id: input.class_id } : {}),
    ...(input.background_id ? { background_id: input.background_id } : {}), ...(input.abilities ? { abilities: input.abilities } : {}),
    ...(input.skills ? { skills: input.skills } : {}),
    ...(input.hook?.trim() ? { hook: input.hook.trim().slice(0, 400) } : {}),
    ...(input.appearance?.trim() ? { appearance: input.appearance.trim().slice(0, 400) } : {}),
    death_mode: input.death_mode === 'hardcore' ? 'hardcore' : 'casual',
  };
  const check = GameManager.previewCharacter(out);
  if (!check.ok) throw new AccountError(check.reason, 400, check.field);
  return out;
}

export class Accounts {
  private fails = new Map<string, { n: number; until: number }>();
  private signups = new Map<string, number[]>();

  constructor(readonly db: Db, private readonly now: () => number = () => Date.now()) {}

  // -------------------------------------------------------------------------
  // Usuarios
  // -------------------------------------------------------------------------

  async register(username: unknown, password: unknown, opts: { ip?: string; admin?: boolean } = {}): Promise<User> {
    const name = checkUsername(username);
    const pass = checkPassword(password);
    if (opts.ip !== undefined) {
      const t = this.now();
      const recent = (this.signups.get(opts.ip) ?? []).filter((x) => t - x < 3600_000);
      if (recent.length >= SIGNUPS_PER_HOUR) throw new AccountError('Demasiadas cuentas nuevas desde aquí. Prueba dentro de un rato.', 429);
      this.signups.set(opts.ip, [...recent, t]);
    }
    const hash = await hashPassword(pass);
    const rows = await this.db.query<UserRow>(
      `insert into users (id, username, username_key, password_hash, is_admin) values ($1, $2, $3, $4, $5)
       on conflict (username_key) do nothing returning ${USER_COLS}`,
      [randomUUID(), name, usernameKey(name), hash, Boolean(opts.admin)],
    );
    if (!rows[0]) throw new AccountError('Ese nombre de usuario ya existe.', 409, 'username');
    return userOf(rows[0]);
  }

  /** Comprueba usuario y contraseña. Mismo mensaje si no existe o si falla: no se dice qué nombres hay. */
  async authenticate(username: unknown, password: unknown, ip = ''): Promise<User> {
    const name = typeof username === 'string' ? username.trim() : '';
    const key = `${usernameKey(name)}|${ip}`;
    const f = this.fails.get(key);
    if (f && f.n >= LOGIN_FAILS && f.until > this.now()) throw new AccountError('Demasiados intentos. Espera unos minutos y vuelve a probar.', 429);
    const [row] = name ? await this.db.query<UserRow>(`select ${USER_COLS}, password_hash from users where username_key = $1`, [usernameKey(name)]) : [];
    const ok = row && typeof password === 'string' && await verifyPassword(password, row.password_hash!);
    if (!row || !ok) {
      const prev = f && f.until > this.now() ? f.n : 0;
      this.fails.set(key, { n: prev + 1, until: this.now() + LOGIN_WINDOW_MS });
      throw new AccountError('Usuario o contraseña incorrectos.', 401);
    }
    if (row.disabled_at !== null) throw new AccountError('Esta cuenta está desactivada. Habla con quien administra el servidor.', 403);
    this.fails.delete(key);
    const [u] = await this.db.query<UserRow>(`update users set last_login_at = now(), last_seen_at = now() where id = $1 returning ${USER_COLS}`, [row.id]);
    return userOf(u!);
  }

  async user(id: string): Promise<User | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const [r] = await this.db.query<UserRow>(`select ${USER_COLS} from users where id = $1`, [id]);
    return r ? userOf(r) : null;
  }

  async userByName(username: string): Promise<User | null> {
    const [r] = await this.db.query<UserRow>(`select ${USER_COLS} from users where username_key = $1`, [usernameKey(username.trim())]);
    return r ? userOf(r) : null;
  }

  async listUsers(): Promise<UserSummary[]> {
    const rows = await this.db.query<UserRow & { games: number; characters: number; sessions: number }>(
      `select ${USER_COLS.split(', ').map((c) => `u.${c}`).join(', ')},
         (select count(distinct g.slug)::int from games g left join seats s on s.game_slug = g.slug where g.owner_id = u.id or s.user_id = u.id) as games,
         (select count(*)::int from characters c where c.user_id = u.id) as characters,
         (select count(*)::int from sessions x where x.user_id = u.id and x.expires_at > now()) as sessions
       from users u order by u.created_at`,
    );
    return rows.map((r) => ({ ...userOf(r), games: Number(r.games), characters: Number(r.characters), sessions: Number(r.sessions) }));
  }

  async adminCount(): Promise<number> {
    const [r] = await this.db.query<{ n: number }>('select count(*)::int as n from users where is_admin and disabled_at is null');
    return Number(r?.n ?? 0);
  }

  /** Cambia la contraseña y cierra todas sus sesiones (menos `keepSession`, la de quien la cambia). */
  async setPassword(id: string, password: unknown, keepSession?: string): Promise<void> {
    const hash = await hashPassword(checkPassword(password));
    await this.db.tx(async (q) => {
      const r = await q.query('update users set password_hash = $2 where id = $1 returning id', [id, hash]);
      if (!r[0]) throw new AccountError('No existe ese usuario.', 404);
      await q.query('delete from sessions where user_id = $1 and token_hash <> $2', [id, keepSession ? tokenHash(keepSession) : '']);
    });
  }

  async changeOwnPassword(id: string, current: unknown, next: unknown, session: string): Promise<void> {
    const [row] = await this.db.query<{ password_hash: string }>('select password_hash from users where id = $1', [id]);
    if (!row || typeof current !== 'string' || !await verifyPassword(current, row.password_hash)) throw new AccountError('La contraseña actual no es esa.', 400, 'current');
    await this.setPassword(id, next, session);
  }

  async setAdmin(id: string, admin: boolean): Promise<void> {
    const target = await this.user(id);
    if (!target) throw new AccountError('No existe ese usuario.', 404);
    if (!admin && target.is_admin && !target.disabled && await this.adminCount() <= 1) throw new AccountError('Es el último administrador: nombra antes a otro.', 409);
    await this.db.query('update users set is_admin = $2 where id = $1', [id, admin]);
  }

  /** Desactivar cierra sus sesiones; sus partidas y personajes se quedan. */
  async setDisabled(id: string, disabled: boolean): Promise<void> {
    const target = await this.user(id);
    if (!target) throw new AccountError('No existe ese usuario.', 404);
    if (disabled && target.is_admin && !target.disabled && await this.adminCount() <= 1) throw new AccountError('Es el último administrador: nombra antes a otro.', 409);
    await this.db.tx(async (q) => {
      await q.query(`update users set disabled_at = ${disabled ? 'now()' : 'null'} where id = $1`, [id]);
      if (disabled) await q.query('delete from sessions where user_id = $1', [id]);
    });
  }

  /** Borra la cuenta: sesiones y biblioteca se van; sus partidas quedan sin dueño y sus asientos sin usuario (el mundo no se toca). */
  async deleteUser(id: string): Promise<void> {
    const target = await this.user(id);
    if (!target) throw new AccountError('No existe ese usuario.', 404);
    if (target.is_admin && !target.disabled && await this.adminCount() <= 1) throw new AccountError('Es el último administrador: nombra antes a otro.', 409);
    await this.db.query('delete from users where id = $1', [id]);
  }

  // -------------------------------------------------------------------------
  // Sesiones
  // -------------------------------------------------------------------------

  async createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `insert into sessions (id, user_id, token_hash, expires_at, user_agent, ip) values ($1, $2, $3, now() + interval '${SESSION_DAYS} days', $4, $5)`,
      [randomUUID(), userId, tokenHash(token), (meta.userAgent ?? '').slice(0, 300) || null, meta.ip || null],
    );
    // Abrir sesión (al entrar o al registrarse) es un acceso.
    await this.db.query('update users set last_login_at = coalesce(last_login_at, now()), last_seen_at = now() where id = $1', [userId]);
    return token;
  }

  /** El usuario de una sesión válida (no caducada, cuenta activa). Alarga la sesión una vez por hora de uso. */
  async sessionUser(token: string | undefined): Promise<User | null> {
    if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
    const [r] = await this.db.query<UserRow & { last_used: unknown; sid: string }>(
      `select ${USER_COLS.split(', ').map((c) => `u.${c}`).join(', ')}, s.last_seen_at as last_used, s.id as sid
       from sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now() and u.disabled_at is null`,
      [tokenHash(token)],
    );
    if (!r) return null;
    if (this.now() - Date.parse(iso(r.last_used)!) > 3600_000) {
      await this.db.query(`update sessions set last_seen_at = now(), expires_at = now() + interval '${SESSION_DAYS} days' where id = $1`, [r.sid]);
      await this.db.query('update users set last_seen_at = now() where id = $1', [r.id]);
    }
    return userOf(r);
  }

  async endSession(token: string | undefined): Promise<void> {
    if (token) await this.db.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
  }

  // -------------------------------------------------------------------------
  // Biblioteca de personajes
  // -------------------------------------------------------------------------

  async library(userId: string): Promise<LibraryCharacter[]> {
    return (await this.db.query<CharRow>(`select ${CHAR_COLS} from characters where user_id = $1 order by updated_at desc`, [userId])).map(charOf);
  }

  async libraryCharacter(userId: string, id: string): Promise<LibraryCharacter | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const [r] = await this.db.query<CharRow>(`select ${CHAR_COLS} from characters where user_id = $1 and id = $2`, [userId, id]);
    return r ? charOf(r) : null;
  }

  async addCharacter(userId: string, input: CharacterInput): Promise<LibraryCharacter> {
    const c = cleanCharacter(input);
    const [n] = await this.db.query<{ n: number }>('select count(*)::int as n from characters where user_id = $1', [userId]);
    if (Number(n?.n ?? 0) >= LIBRARY_MAX) throw new AccountError(`Como mucho ${LIBRARY_MAX} personajes por cuenta.`, 400);
    const [r] = await this.db.query<CharRow>(
      `insert into characters (id, user_id, name, race_id, class_id, background_id, abilities, skills, hook, appearance, death_mode)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning ${CHAR_COLS}`,
      [randomUUID(), userId, ...charParams(c)],
    );
    return charOf(r!);
  }

  async updateCharacter(userId: string, id: string, input: CharacterInput): Promise<LibraryCharacter> {
    const c = cleanCharacter(input);
    const [r] = /^[0-9a-f-]{36}$/.test(id) ? await this.db.query<CharRow>(
      `update characters set name = $3, race_id = $4, class_id = $5, background_id = $6, abilities = $7, skills = $8, hook = $9, appearance = $10, death_mode = $11, updated_at = now()
       where user_id = $1 and id = $2 returning ${CHAR_COLS}`,
      [userId, id, ...charParams(c)],
    ) : [];
    if (!r) throw new AccountError('No existe ese personaje.', 404);
    return charOf(r);
  }

  /** Borra la plantilla. Las copias que juegan en partidas no se tocan. */
  async deleteCharacter(userId: string, id: string): Promise<void> {
    const r = /^[0-9a-f-]{36}$/.test(id) ? await this.db.query('delete from characters where user_id = $1 and id = $2 returning id', [userId, id]) : [];
    if (!r[0]) throw new AccountError('No existe ese personaje.', 404);
  }

  // -------------------------------------------------------------------------
  // Partidas: dueño y quién juega
  // -------------------------------------------------------------------------

  async ownerOf(slug: string): Promise<string | null> {
    const [r] = await this.db.query<{ owner_id: string | null }>('select owner_id from games where slug = $1', [slug]);
    return r?.owner_id ?? null;
  }

  async setOwner(slug: string, userId: string | null): Promise<void> {
    const r = await this.db.query('update games set owner_id = $2 where slug = $1 returning slug', [slug, userId]);
    if (!r[0]) throw new AccountError('No existe esa partida.', 404);
  }

  /** Partidas del usuario: las suyas y aquellas en las que tiene asiento. */
  async gamesOf(userId: string): Promise<{ slug: string; owner: boolean }[]> {
    return (await this.db.query<{ slug: string; owner: boolean }>(
      `select g.slug, bool_or(g.owner_id = $1) as owner from games g left join seats s on s.game_slug = g.slug
       where g.owner_id = $1 or s.user_id = $1 group by g.slug`,
      [userId],
    )).map((r) => ({ slug: r.slug, owner: Boolean(r.owner) }));
  }

  /**
   * El administrador da la partida a un usuario (o la deja sin dueño): pasa a ser su dueño y, si el usuario no
   * tiene ya asiento en ella y el del anfitrión está sin usuario, ese asiento pasa a ser suyo. Si el asiento del
   * anfitrión ya es de otra cuenta, cambia solo el dueño: nadie pierde su personaje por una asignación.
   */
  async assignGame(slug: string, userId: string | null): Promise<void> {
    await this.db.tx(async (q) => {
      const r = await q.query('update games set owner_id = $2 where slug = $1 returning slug', [slug, userId]);
      if (!r[0]) throw new AccountError('No existe esa partida.', 404);
      if (!userId) return;
      const [mine] = await q.query('select id from seats where game_slug = $1 and user_id = $2', [slug, userId]);
      if (!mine) await q.query('update seats set user_id = $2 where user_id is null and id = (select id from seats where game_slug = $1 and is_host order by created_at limit 1)', [slug, userId]);
    });
  }

  /** Dueño de cada partida, para el panel. */
  async owners(): Promise<Map<string, { id: string; username: string } | null>> {
    const rows = await this.db.query<{ slug: string; id: string | null; username: string | null }>('select g.slug, u.id, u.username from games g left join users u on u.id = g.owner_id');
    return new Map(rows.map((r) => [r.slug, r.id ? { id: r.id, username: r.username! } : null]));
  }

  // -------------------------------------------------------------------------
  // Asientos
  // -------------------------------------------------------------------------

  async seats(slug: string): Promise<Seat[]> {
    return (await this.db.query<SeatRow>(`select ${SEAT_COLS} from seats where game_slug = $1 order by created_at, id`, [slug])).map(seatOf);
  }

  async seat(slug: string, id: string): Promise<Seat | null> {
    const [r] = await this.db.query<SeatRow>(`select ${SEAT_COLS} from seats where game_slug = $1 and id = $2`, [slug, id]);
    return r ? seatOf(r) : null;
  }

  async seatByToken(slug: string, token: string): Promise<Seat | null> {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
    const rows = await this.db.query<SeatRow>(`select ${SEAT_COLS} from seats where game_slug = $1`, [slug]);
    const hit = rows.find((r) => safeEqual(r.token, token));
    return hit ? seatOf(hit) : null;
  }

  async seatOfUser(slug: string, userId: string): Promise<Seat | null> {
    const [r] = await this.db.query<SeatRow>(`select ${SEAT_COLS} from seats where game_slug = $1 and user_id = $2`, [slug, userId]);
    return r ? seatOf(r) : null;
  }

  async addSeat(slug: string, s: { label: string; host?: boolean; character_id?: string | null; user_id?: string | null; template_id?: string | null }, q: Queryable = this.db): Promise<Seat> {
    const [r] = await q.query<SeatRow>(
      `insert into seats (id, game_slug, token, label, is_host, character_id, user_id, template_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${SEAT_COLS}`,
      [randomBytes(6).toString('base64url'), slug, randomBytes(24).toString('base64url'), s.label, Boolean(s.host), s.character_id ?? null, s.user_id ?? null, s.template_id ?? null],
    );
    return seatOf(r!);
  }

  /**
   * Liga el asiento al usuario. Si ya era suyo, nada; si es de otro, error; si el usuario ya tiene otro
   * asiento en la partida, también (uno por persona).
   */
  async bindSeat(seat: Seat, userId: string): Promise<Seat> {
    if (seat.user_id === userId) return seat;
    if (seat.user_id) throw new AccountError('Ese asiento ya es de otra persona. Pide otro enlace a quien organiza la partida.', 409);
    const other = await this.seatOfUser(seat.game_slug, userId);
    if (other) throw new AccountError('Ya tienes un asiento en esta partida.', 409);
    const [r] = await this.db.query<SeatRow>(`update seats set user_id = $2 where id = $1 and user_id is null returning ${SEAT_COLS}`, [seat.id, userId]);
    if (!r) throw new AccountError('Ese asiento ya es de otra persona. Pide otro enlace a quien organiza la partida.', 409);
    return seatOf(r);
  }

  async unbindSeat(slug: string, seatId: string): Promise<boolean> {
    return (await this.db.query('update seats set user_id = null where game_slug = $1 and id = $2 returning id', [slug, seatId])).length > 0;
  }

  async setSeatCharacter(seatId: string, characterId: string, templateId: string | null): Promise<void> {
    await this.db.query('update seats set character_id = $2, template_id = $3 where id = $1', [seatId, characterId, templateId]);
  }

  async regenerateSeat(slug: string, seatId: string): Promise<boolean> {
    return (await this.db.query('update seats set token = $3 where game_slug = $1 and id = $2 returning id', [slug, seatId, randomBytes(24).toString('base64url')])).length > 0;
  }

  async touchSeat(seatId: string): Promise<void> {
    await this.db.query('update seats set last_seen_at = now() where id = $1', [seatId]);
  }

  // -------------------------------------------------------------------------
  // Registro del administrador
  // -------------------------------------------------------------------------

  async log(admin: { id: string | null; name: string }, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<void> {
    await this.db.query('insert into admin_log (admin_id, admin_name, action, target, detail) values ($1, $2, $3, $4, $5)', [admin.id, admin.name, action, target, JSON.stringify(detail)]);
  }

  async recentLog(limit = 50): Promise<{ at: string; admin: string; action: string; target: string | null }[]> {
    return (await this.db.query<{ at: unknown; admin_name: string; action: string; target: string | null }>('select at, admin_name, action, target from admin_log order by id desc limit $1', [limit]))
      .map((r) => ({ at: iso(r.at)!, admin: r.admin_name, action: r.action, target: r.target }));
  }
}

function charParams(c: CharacterInput): unknown[] {
  return [c.name, c.race_id ?? null, c.class_id ?? null, c.background_id ?? null, c.abilities ? JSON.stringify(c.abilities) : null, c.skills ? JSON.stringify(c.skills) : null, c.hook ?? null, c.appearance ?? null, c.death_mode ?? 'casual'];
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * El primer administrador sin navegador: con ADMIN_USER y ADMIN_PASSWORD en el entorno (al arrancar) o con
 * `--admin <usuario>` (src/index.ts). Si existe, lo hace administrador (y le pone la contraseña solo si se pide);
 * si no, lo crea.
 */
export async function ensureAdmin(accounts: Accounts, username: string, password: string | null, opts: { resetPassword?: boolean } = {}): Promise<{ user: User; created: boolean }> {
  const existing = await accounts.userByName(username);
  if (existing) {
    if (!existing.is_admin) await accounts.setAdmin(existing.id, true);
    if (existing.disabled) await accounts.setDisabled(existing.id, false);
    if (password && opts.resetPassword) await accounts.setPassword(existing.id, password);
    return { user: (await accounts.user(existing.id))!, created: false };
  }
  if (!password) throw new AccountError(`No existe el usuario «${username}»: hace falta una contraseña para crearlo.`);
  return { user: await accounts.register(username, password, { admin: true }), created: true };
}
