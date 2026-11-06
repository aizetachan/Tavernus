/**
 * Base de datos de la web (docs/BASE-DE-DATOS.md): PostgreSQL. Guarda lo que es de la plataforma y no del
 * mundo de una partida: usuarios, sesiones, el catálogo de partidas, los asientos, la biblioteca de
 * personajes y el registro del administrador. El mundo de cada partida va en su carpeta (jsonfile.ts) o, con
 * WORLD_STORE=pg (por defecto), aquí mismo, en documentos JSONB (src/persistence/pg.ts, migración 2).
 *
 * Dos conductores con el mismo SQL:
 *   - `pg` (node-postgres) contra un servidor PostgreSQL: producción. DATABASE_URL=postgresql://…
 *   - PGlite (PostgreSQL compilado a WASM, dentro del proceso): tests y desarrollo local sin servidor.
 *     DATABASE_URL=pglite:<carpeta> o pglite:memory.
 *
 * Las migraciones (migrations.ts) se aplican al abrir, en orden y una sola vez (tabla schema_migrations).
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MIGRATIONS } from './migrations.js';

/** Lo que hace falta para hablar con la base: consultas con parámetros ($1, $2…) y transacciones. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Varias consultas que van juntas o no van. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** «postgres» o «pglite (…)», para el arranque y la página de estado. */
  readonly kind: string;
}

/**
 * Abre la base que dice `url` y la deja migrada.
 *   postgres://… o postgresql://…   servidor PostgreSQL
 *   pglite:memory                    en memoria (tests)
 *   pglite:<carpeta>                 PGlite guardado en esa carpeta (local)
 */
export async function openDb(url: string): Promise<Db> {
  const db = url.startsWith('pglite:') ? await pglite(url.slice('pglite:'.length)) : await postgres(url);
  try {
    await migrate(db);
  } catch (e) {
    await db.close().catch(() => {});
    throw e;
  }
  return db;
}

/** Base en memoria, para tests: PostgreSQL de verdad, vacía y migrada. */
export function memoryDb(): Promise<Db> { return openDb('pglite:memory'); }

/**
 * La URL de la base según el entorno. Sin DATABASE_URL, en modo `open` (local), PGlite en
 * <partidas>/.pgdata; en `public` o `invite` hace falta un servidor de verdad y devuelve null.
 */
export function dbUrlFromEnv(env: NodeJS.ProcessEnv, gamesRoot: string, mode: string): string | null {
  const url = env['DATABASE_URL']?.trim();
  if (url) return url;
  return mode === 'open' ? `pglite:${resolve(gamesRoot, '.pgdata')}` : null;
}

/** Para el registro del arranque: sin usuario ni contraseña. */
export function describeDbUrl(url: string): string {
  if (url.startsWith('pglite:')) return `PGlite (${url.slice(7)})`;
  try {
    const u = new URL(url);
    return `PostgreSQL ${u.pathname.replace(/^\//, '') || '(base por defecto)'}${u.hostname ? ` en ${u.hostname}` : ` por socket ${u.searchParams.get('host') ?? ''}`}`.trim();
  } catch { return 'PostgreSQL'; }
}

async function migrate(db: Db): Promise<void> {
  await db.query('create table if not exists schema_migrations (version integer primary key, name text not null, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ version: number }>('select version from schema_migrations')).map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await db.tx(async (q) => {
      for (const stmt of m.sql) await q.query(stmt);
      await q.query('insert into schema_migrations (version, name) values ($1, $2)', [m.version, m.name]);
    });
  }
}

// ---------------------------------------------------------------------------
// Conductores
// ---------------------------------------------------------------------------

async function postgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  // bigint (int8) como número: aquí solo hay contadores y semillas de dados de 32 bits.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  // Comprobar ya la conexión: si no hay base, que el arranque lo diga y no la primera petición.
  (await pool.connect()).release();
  return {
    kind: 'postgres',
    async query<T>(sql: string, params: readonly unknown[] = []) { return (await pool.query(sql, params as unknown[])).rows as T[]; },
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({ query: async <R>(sql: string, params: readonly unknown[] = []) => (await client.query(sql, params as unknown[])).rows as R[] });
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

async function pglite(where: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const memory = where === 'memory' || where === '';
  if (!memory) await mkdir(resolve(where), { recursive: true });
  const db = memory ? new PGlite() : new PGlite(resolve(where));
  await db.waitReady;
  // PGlite atiende una consulta cada vez; las transacciones van en fila para no mezclarse con otras consultas.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const run = async <T>(sql: string, params: readonly unknown[] = []) => (await db.query<T>(sql, params as unknown[])).rows;
  return {
    kind: memory ? 'pglite (memoria)' : `pglite (${resolve(where)})`,
    query: <T>(sql: string, params?: readonly unknown[]) => serial(() => run<T>(sql, params)),
    tx: <T>(fn: (q: Queryable) => Promise<T>) => serial(() => db.transaction(async (t) => fn({
      query: async <R>(sql: string, params: readonly unknown[] = []) => (await t.query<R>(sql, params as unknown[])).rows,
    }))),
    close: () => db.close(),
  };
}
