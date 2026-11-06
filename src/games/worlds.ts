/**
 * Dónde guarda cada partida su mundo (WORLD_STORE): en la base PostgreSQL de la plataforma (`pg`, por defecto
 * desde el 6-11-2026; src/persistence/pg.ts) o en su carpeta de datos, en JSON (`json`, el escape: como antes).
 * El gestor de partidas (manager.ts) no sabe cuál: arranca, copia, mueve y borra mundos a través de esto.
 *
 * Con `pg`, una partida de antes (su mundo solo en su carpeta, en JSON) queda **obsoleta**: se conserva tal como
 * está y sale en el menú, pero no se pasa sola a la base ni se puede abrir (`obsolete`, `prepare`). Quien quiera
 * seguirla la pasa a mano (`npm run world-store -- to-pg`, src/games/world-cli.ts) o vuelve a WORLD_STORE=json.
 * Las fotos de arranque de las demos (`slug/initial`, `slug/recorded`) sí pasan solas: son la demo, no lo jugado.
 */

import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Id, WorldSnapshot } from '../engine/model.js';
import type { Db } from '../db/db.js';
import type { Repository } from '../persistence/repository.js';
import { JsonFileRepository, readJsonWorld } from '../persistence/jsonfile.js';
import { copyWorld, deleteWorld, hasWorld, importWorld, moveWorld, PgRepository } from '../persistence/pg.js';
import { clipSynopsis, synopsisOf } from './synopsis.js';

export type WorldStoreKind = 'json' | 'pg';

/** Un mundo: su clave en la base (la partida, «slug/initial»…), su carpeta en disco y su campaña. */
export interface WorldRef { key: string; dir: string; campaignId: Id }

export interface WorldStore {
  readonly kind: WorldStoreKind;
  repo(ref: WorldRef): Repository;
  /**
   * Antes de arrancar la partida. Con un mundo obsoleto falla (ObsoleteWorldError), salvo con `ignoreLegacy`: entonces
   * arranca como si no lo hubiera (las demos, que empiezan de su foto o de la semilla).
   */
  prepare(ref: WorldRef, opts?: { ignoreLegacy?: boolean }): Promise<void>;
  /** Si el mundo es de antes y este almacén ya no lo juega: está solo en su carpeta, en JSON (con `pg`). */
  obsolete(ref: WorldRef): Promise<boolean>;
  /** Nombres de los PJ en juego (no retirados), o null si aún no hay mundo guardado. */
  characters(ref: WorldRef): Promise<string[] | null>;
  synopsis(ref: WorldRef): Promise<string | null>;
  exists(ref: WorldRef): Promise<boolean>;
  /** Copia un mundo encima de otro (que se sustituye). */
  copy(from: WorldRef, to: WorldRef): Promise<void>;
  /** Lleva un mundo a otro sitio (el destino se sustituye); sin mundo de origen, el destino queda vacío. */
  move(from: WorldRef, to: WorldRef): Promise<void>;
  remove(ref: WorldRef): Promise<void>;
  /** Todos los mundos de una partida (al borrarla): el suyo, su foto de arranque y lo grabado. */
  removeGame(slug: string): Promise<void>;
}

/** WORLD_STORE: `pg` (por defecto) o `json`. */
export function worldStoreFromEnv(env: NodeJS.ProcessEnv): WorldStoreKind {
  const v = (env['WORLD_STORE'] ?? '').trim().toLowerCase();
  if (!v || v === 'pg' || v === 'postgres' || v === 'postgresql') return 'pg';
  if (v === 'json') return 'json';
  throw new Error(`WORLD_STORE no válido: «${v}» (pg | json).`);
}

/** Arrancar una partida de antes con WORLD_STORE=pg (arriba). */
export class ObsoleteWorldError extends Error {
  constructor(readonly ref: WorldRef) {
    super(`El mundo «${ref.key}» es de antes de guardarse en la base: sigue en ${ref.dir}, pero ya no se juega (npm run world-store -- to-pg para pasarlo, o WORLD_STORE=json).`);
  }
}

/** Si la carpeta tiene un mundo guardado en JSON. */
export function hasJsonWorld(ref: WorldRef): Promise<boolean> {
  return exists(join(ref.dir, `${ref.campaignId}.world.json`));
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** En Windows, renombrar una carpeta recién usada falla un momento con EPERM/EBUSY; si no hay manera, copia y borra. */
async function renameDir(from: string, to: string, attempts = 8): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try { await rename(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw e;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  await cp(from, to, { recursive: true });
  await rm(from, { recursive: true, force: true });
}

/** Lo de siempre: cada mundo en su carpeta (jsonfile.ts). */
export class JsonWorldStore implements WorldStore {
  readonly kind = 'json' as const;
  repo(ref: WorldRef): Repository { return new JsonFileRepository(ref.dir); }
  async prepare(): Promise<void> {}
  async obsolete(): Promise<boolean> { return false; }
  async characters(ref: WorldRef): Promise<string[] | null> {
    try {
      const snap = JSON.parse(await readFile(join(ref.dir, `${ref.campaignId}.world.json`), 'utf8')) as WorldSnapshot;
      return snap.characters.filter((c) => c.status !== 'retired').map((c) => c.name);
    } catch { return null; }
  }
  synopsis(ref: WorldRef): Promise<string | null> { return synopsisOf(join(ref.dir, `${ref.campaignId}.events.jsonl`)); }
  exists(ref: WorldRef): Promise<boolean> { return exists(ref.dir); }
  async copy(from: WorldRef, to: WorldRef): Promise<void> {
    await rm(to.dir, { recursive: true, force: true });
    await cp(from.dir, to.dir, { recursive: true });
  }
  async move(from: WorldRef, to: WorldRef): Promise<void> {
    await rm(to.dir, { recursive: true, force: true });
    if (await exists(from.dir)) await renameDir(from.dir, to.dir);
  }
  async remove(ref: WorldRef): Promise<void> { await rm(ref.dir, { recursive: true, force: true }); }
  /** La carpeta de la partida ya se borra entera (manager.ts). */
  async removeGame(): Promise<void> {}
}

/**
 * El mundo en la base de la plataforma (pg.ts). La carpeta de datos solo se lee: para listar las partidas de antes
 * (obsoletas) y para pasar a la base las fotos de arranque de las demos.
 */
export class PgWorldStore implements WorldStore {
  readonly kind = 'pg' as const;
  constructor(private readonly db: Db, private readonly log: (m: string) => void = (m) => console.log(m)) {}

  repo(ref: WorldRef): Repository { return new PgRepository(this.db, ref.key); }

  /** Sin esta comprobación, el motor arrancaría de la semilla un mundo nuevo encima de la partida de antes y la escondería. */
  async prepare(ref: WorldRef, opts: { ignoreLegacy?: boolean } = {}): Promise<void> {
    if (!opts.ignoreLegacy && await this.obsolete(ref)) throw new ObsoleteWorldError(ref);
  }

  async obsolete(ref: WorldRef): Promise<boolean> {
    return !(await hasWorld(this.db, ref.key)) && await hasJsonWorld(ref);
  }

  /** Las fotos de las demos (clave «slug/…»), no el mundo de una partida. */
  private static photo(ref: WorldRef): boolean { return ref.key.includes('/'); }

  /**
   * Si hay mundo en la base. Una foto de demo que aún está solo en su carpeta (de antes de WORLD_STORE=pg) pasa a la
   * base, sin tocar los ficheros; el mundo de una partida, no (queda obsoleto: arriba).
   */
  private async adopt(ref: WorldRef): Promise<boolean> {
    if (await hasWorld(this.db, ref.key)) return true;
    if (!PgWorldStore.photo(ref)) return false;
    const w = readJsonWorld(ref.dir, ref.campaignId);
    if (!w) return false;
    const r = await importWorld(this.db, ref.key, w);
    this.log(`[mundos] la foto «${ref.key}» pasa de ${ref.dir} a la base: ${r.entities} entidades, ${r.events} eventos${r.skipped ? ` (${r.skipped} con seq repetido, fuera)` : ''}`);
    return true;
  }

  async characters(ref: WorldRef): Promise<string[] | null> {
    if (!(await hasWorld(this.db, ref.key))) return new JsonWorldStore().characters(ref);
    const rows = await this.db.query<{ name: string; status: string | null }>(
      `select doc->>'name' as name, doc->>'status' as status from world_entities where world_id = $1 and collection = 'characters' order by ord`, [ref.key]);
    return rows.filter((r) => r.status !== 'retired').map((r) => r.name);
  }

  /** Como la de JSON (synopsis.ts): la última narración del máster de lo último del registro, o la última que haya. */
  async synopsis(ref: WorldRef): Promise<string | null> {
    if (!(await hasWorld(this.db, ref.key))) return new JsonWorldStore().synopsis(ref);
    const rows = await this.db.query<{ action_type: string; text: string }>(
      `select action_type, doc->>'narration_private' as text from world_events
       where world_id = $1 and coalesce(btrim(doc->>'narration_private'), '') <> '' order by seq desc limit 60`, [ref.key]);
    const pick = rows.find((r) => r.action_type === 'master') ?? rows[0];
    return pick ? clipSynopsis(pick.text.trim()) : null;
  }

  exists(ref: WorldRef): Promise<boolean> { return this.adopt(ref); }

  async copy(from: WorldRef, to: WorldRef): Promise<void> {
    await this.adopt(from);
    await copyWorld(this.db, from.key, to.key);
  }

  /** La copia en disco de antes, si la hay, va con él: si no, el sitio de origen seguiría pareciendo una partida de antes. */
  async move(from: WorldRef, to: WorldRef): Promise<void> {
    await this.adopt(from);
    await moveWorld(this.db, from.key, to.key);
    await new JsonWorldStore().move(from, to);
  }

  /** Y la copia en disco de antes, por lo mismo. */
  async remove(ref: WorldRef): Promise<void> {
    await this.db.tx((q) => deleteWorld(q, ref.key));
    await rm(ref.dir, { recursive: true, force: true });
  }

  async removeGame(slug: string): Promise<void> {
    await this.db.tx(async (q) => {
      for (const t of ['world_entities', 'world_events', 'world_tickers']) {
        await q.query(`delete from ${t} where world_id = $1 or left(world_id, length($1) + 1) = $1 || '/'`, [slug]);
      }
    });
  }
}

/** Las claves de los mundos de una partida: el suyo, la foto de arranque (grabaciones) y lo grabado (demos). */
export function worldKey(slug: string, which: 'data' | 'initial' | 'recorded'): string {
  return which === 'data' ? slug : `${slug}/${which}`;
}

/** Para cuando hace falta una carpeta (la de datos siempre existe en disco, aunque el mundo esté en la base). */
export async function ensureDir(dir: string): Promise<void> { await mkdir(dir, { recursive: true }); }
