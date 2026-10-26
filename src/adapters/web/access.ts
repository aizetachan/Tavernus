/**
 * Acceso a la web sin cuentas (docs/MULTIJUGADOR.md): un enlace de invitación por
 * asiento y una cookie firmada que liga el navegador a ese asiento.
 *
 *   /i/<partida>/<token>   entra por ese asiento: cookie tv_s_<partida> y a la partida
 *   /admin?token=…         anfitrión: cookie tv_admin y al menú
 *
 * Cada partida guarda sus asientos en <carpeta>/seats.json: id, token largo, el PJ
 * (o null si está libre) y cuándo se usó. Regenerar el token invalida el enlace y
 * las cookies que se firmaron con él. Modos (WEB_ACCESS):
 *   - open:   como antes, cualquiera juega con cualquier PJ (local, pruebas).
 *   - invite: sin enlace válido solo se ve «pide una invitación»; el menú y la
 *             creación quedan para el anfitrión (ADMIN_TOKEN).
 *   - public: cualquiera entra al menú y crea sus partidas (queda de anfitrión en
 *             ellas); cada navegador ve solo las suyas y aquellas a las que se unió
 *             con un enlace. ADMIN_TOKEN sigue viéndolo todo.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Id } from '../../engine/model.js';

export type AccessMode = 'open' | 'invite' | 'public';

export interface AccessOptions {
  mode: AccessMode;
  /** Token del enlace de administración; sin él, en invite nadie entra al menú. */
  adminToken: string | null;
  /** Clave para firmar las cookies. */
  secret: string;
  /** Cookies con Secure (detrás de HTTPS). */
  secureCookies?: boolean;
}

export interface Seat {
  id: string;
  token: string;
  /** PJ del asiento; null = libre, quien entre crea el suyo. */
  character_id: Id | null;
  /** Para quién es («Anfitrión», «Plaza 2»…), solo para el anfitrión. */
  label: string;
  /** Asiento de quien creó la partida: reparte invitaciones y puede borrarla (modo public). */
  host?: boolean;
  created_at: string;
  last_seen_at: string | null;
}

interface SeatsFile { version: 1; seats: Seat[] }

export const SEATS_FILE = 'seats.json';
const ADMIN_COOKIE = 'tv_admin';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/** Cadena aleatoria apta para URL (base64url). 24 bytes = 32 caracteres. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** Lee WEB_ACCESS, ADMIN_TOKEN y SESSION_SECRET; lo que falte se genera y se guarda en la carpeta de partidas. */
export async function accessFromEnv(env: NodeJS.ProcessEnv, root: string, host: string): Promise<AccessOptions> {
  const raw = env['WEB_ACCESS']?.trim().toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const mode: AccessMode = raw === 'open' || raw === 'invite' || raw === 'public' ? raw
    : env['ADMIN_TOKEN']?.trim() || env['NODE_ENV'] === 'production' || !loopback ? 'invite' : 'open';
  const secret = env['SESSION_SECRET']?.trim() || await persisted(join(root, '.session-secret'));
  const adminToken = env['ADMIN_TOKEN']?.trim() || (mode !== 'open' ? await persisted(join(root, '.admin-token')) : null);
  return { mode, adminToken, secret, secureCookies: env['WEB_SECURE_COOKIES'] === 'on' || (env['PUBLIC_URL'] ?? '').startsWith('https:') };
}

async function persisted(file: string): Promise<string> {
  try {
    const v = (await readFile(file, 'utf8')).trim();
    if (v) return v;
  } catch { /* se crea */ }
  const v = randomToken(32);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, v + '\n', { encoding: 'utf8', mode: 0o600 });
  return v;
}

/** Asientos de una partida (seats.json en su carpeta). Escrituras en serie por carpeta. */
export class SeatStore {
  private chain = new Map<string, Promise<unknown>>();

  async list(dir: string): Promise<Seat[]> {
    try {
      const f = JSON.parse(await readFile(join(dir, SEATS_FILE), 'utf8')) as SeatsFile;
      return Array.isArray(f.seats) ? f.seats : [];
    } catch { return []; }
  }

  /** Cambia la lista de asientos con `fn` (en serie: dos entradas a la vez no se pisan). */
  update<T>(dir: string, fn: (seats: Seat[]) => T): Promise<T> {
    const prev = this.chain.get(dir) ?? Promise.resolve();
    const next = prev.then(async () => {
      const seats = await this.list(dir);
      const out = fn(seats);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, SEATS_FILE), JSON.stringify({ version: 1, seats } satisfies SeatsFile, null, 2), 'utf8');
      return out;
    });
    this.chain.set(dir, next.catch(() => undefined));
    return next;
  }

  async byToken(dir: string, token: string): Promise<Seat | null> {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
    for (const s of await this.list(dir)) if (safeEqual(s.token, token)) return s;
    return null;
  }

  async byId(dir: string, id: string): Promise<Seat | null> {
    return (await this.list(dir)).find((s) => s.id === id) ?? null;
  }
}

export function newSeat(label: string, characterId: Id | null, now: Date, host = false): Seat {
  return { id: randomToken(6), token: randomToken(), character_id: characterId, label, ...(host ? { host: true } : {}), created_at: now.toISOString(), last_seen_at: null };
}

/** ¿Es el asiento de quien creó la partida? (Los de antes de `host` se llamaban «Anfitrión».) */
export function isHostSeat(seat: Seat | null): boolean {
  return Boolean(seat && (seat.host || seat.label === 'Anfitrión'));
}

// ---------------------------------------------------------------------------
// Cookies firmadas
// ---------------------------------------------------------------------------

function sign(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function seatCookieName(slug: string): string { return `tv_s_${slug}`; }

/** La cookie del asiento firma también su token: al regenerarlo, la cookie deja de valer. */
export function seatCookieValue(secret: string, slug: string, seat: Seat): string {
  return `${seat.id}.${sign(secret, `seat|${slug}|${seat.id}|${seat.token}`)}`;
}

export function checkSeatCookie(secret: string, slug: string, value: string | undefined, seat: Seat | null): boolean {
  return Boolean(value && seat && safeEqual(value, seatCookieValue(secret, slug, seat)));
}

/** Id del asiento que dice la cookie (sin comprobar la firma: eso, con el asiento delante). */
export function seatIdOf(value: string | undefined): string | null {
  const id = value?.split('.')[0];
  return id && /^[A-Za-z0-9_-]{4,16}$/.test(id) ? id : null;
}

export function adminCookieValue(secret: string, adminToken: string): string {
  return sign(secret, `admin|${adminToken}`);
}

export function isAdmin(access: AccessOptions, req: IncomingMessage): boolean {
  if (access.mode === 'open') return true;
  if (!access.adminToken) return false;
  const v = cookies(req)[ADMIN_COOKIE];
  return Boolean(v && safeEqual(v, adminCookieValue(access.secret, access.adminToken)));
}

export function adminTokenMatches(access: AccessOptions, token: string | null): boolean {
  return Boolean(token && access.adminToken && safeEqual(token, access.adminToken));
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res: ServerResponse, access: AccessOptions, name: string, value: string, maxAgeS = COOKIE_MAX_AGE_S): void {
  const c = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${access.secureCookies ? '; Secure' : ''}`;
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), c]);
}

export function setAdminCookie(res: ServerResponse, access: AccessOptions): void {
  if (access.adminToken) setCookie(res, access, ADMIN_COOKIE, adminCookieValue(access.secret, access.adminToken));
}
