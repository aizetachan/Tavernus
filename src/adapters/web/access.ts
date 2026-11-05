/**
 * Acceso a la web (docs/MULTIJUGADOR.md, «Cuentas»): cuentas de usuario con sesión en cookie, enlaces de
 * invitación por asiento y el enlace de administración de rescate.
 *
 *   /entrar                entrar o registrarse (page-account.ts); la sesión va en la cookie tv_u
 *   /i/<partida>/<token>   invitación: con sesión, liga ese asiento al usuario; sin ella, pasa por /entrar
 *   /admin?token=…         rescate: cookie tv_admin, lo ve todo (por si no hay ningún usuario administrador)
 *
 * Los usuarios, sesiones, asientos y la biblioteca viven en la base (src/accounts, src/db). Modos (WEB_ACCESS):
 *   - open:   local. Sin cuenta se juega con cualquier PJ y se ve todo, como siempre; las cuentas funcionan
 *             si se usan, pero no se piden.
 *   - invite: hace falta cuenta; solo se registra quien llega con una invitación, y crear partidas es del
 *             administrador.
 *   - public: hace falta cuenta; el registro es libre y cada usuario crea sus partidas (queda de dueño).
 * Las cookies de asiento de antes de las cuentas (tv_s_<partida>) ya no dan acceso fuera de `open`: sirven
 * para que su dueño, al entrar con su cuenta, se lleve esos asientos (server.ts, `claimLegacySeats`).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Seat } from '../../accounts/accounts.js';

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

const ADMIN_COOKIE = 'tv_admin';
export const USER_COOKIE = 'tv_u';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;
/** La de sesión dura lo que la sesión en la base (accounts.ts, SESSION_DAYS). */
export const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 180;

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

/** ¿Es el asiento de quien creó la partida? */
export function isHostSeat(seat: Seat | null): boolean {
  return Boolean(seat?.host);
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
export function seatCookieValue(secret: string, slug: string, seat: Pick<Seat, 'id' | 'token'>): string {
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

export function clearCookie(res: ServerResponse, access: AccessOptions, name: string): void {
  setCookie(res, access, name, '', 0);
}

export function setAdminCookie(res: ServerResponse, access: AccessOptions): void {
  if (access.adminToken) setCookie(res, access, ADMIN_COOKIE, adminCookieValue(access.secret, access.adminToken));
}
