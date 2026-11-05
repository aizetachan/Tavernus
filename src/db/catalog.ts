/**
 * Catálogo de partidas en la base (tabla `games`): la fuente de verdad de la web. Cada alta o cambio
 * escribe también el game.json de la carpeta como copia legible (el REPL y los scripts lo siguen leyendo).
 * El dueño (`owner_id`) no es parte del manifiesto: lo lleva accounts.ts y aquí no se toca.
 */

import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { readManifestFile, writeManifestFile, type GameCatalog } from '../games/catalog.js';
import type { GameManifest } from '../games/manager.js';
import type { Db, Queryable } from './db.js';

interface GameRow {
  slug: string; name: string; campaign_id: string; mode: string; demo: boolean; main: boolean;
  dice_seed: number | string | null; world: GameManifest['world'] | null; character_id: string | null;
  data_dir: string; cache_dir: string; initial_dir: string | null; created_at: Date | string; last_opened_at: Date | string | null;
}

const iso = (v: Date | string | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function manifestOf(r: GameRow): GameManifest {
  return {
    version: 1, slug: r.slug, name: r.name, created_at: iso(r.created_at)!, last_opened_at: iso(r.last_opened_at),
    campaign_id: r.campaign_id, mode: r.mode as GameManifest['mode'], demo: r.demo, main: r.main,
    data_dir: r.data_dir, cache_dir: r.cache_dir, dice_seed: r.dice_seed === null ? null : Number(r.dice_seed),
    initial_dir: r.initial_dir, character_id: r.character_id, ...(r.world ? { world: r.world } : {}),
  };
}

const COLUMNS = 'slug, name, campaign_id, mode, demo, main, dice_seed, world, character_id, data_dir, cache_dir, initial_dir, created_at, last_opened_at';

/** Alta o cambio de una partida sin tocar su dueño. */
export async function upsertGame(q: Queryable, m: GameManifest): Promise<void> {
  await q.query(
    `insert into games (${COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (slug) do update set name = excluded.name, campaign_id = excluded.campaign_id, mode = excluded.mode,
       demo = excluded.demo, main = excluded.main, dice_seed = excluded.dice_seed, world = excluded.world,
       character_id = excluded.character_id, data_dir = excluded.data_dir, cache_dir = excluded.cache_dir,
       initial_dir = excluded.initial_dir, last_opened_at = excluded.last_opened_at`,
    [m.slug, m.name, m.campaign_id, m.mode, m.demo, m.main, m.dice_seed, m.world ? JSON.stringify(m.world) : null,
      m.character_id, m.data_dir, m.cache_dir, m.initial_dir, m.created_at, m.last_opened_at],
  );
}

export class DbCatalog implements GameCatalog {
  constructor(private readonly db: Db, private readonly root: string) {}

  async get(slug: string): Promise<GameManifest | null> {
    const [r] = await this.db.query<GameRow>(`select ${COLUMNS} from games where slug = $1`, [slug]);
    return r ? manifestOf(r) : null;
  }

  async all(): Promise<GameManifest[]> {
    return (await this.db.query<GameRow>(`select ${COLUMNS} from games`)).map(manifestOf);
  }

  async put(m: GameManifest): Promise<void> {
    await upsertGame(this.db, m);
    await writeManifestFile(join(this.root, m.slug), m);
  }

  async remove(slug: string): Promise<void> {
    await this.db.query('delete from games where slug = $1', [slug]);
  }

  /**
   * Las partidas que solo tienen carpeta (las de antes de la base, o creadas con el REPL) entran en la
   * tabla, con sus asientos de seats.json. Las que ya están no se tocan: manda la base. Nada se borra.
   */
  async importFolders(log: (m: string) => void = () => {}): Promise<number> {
    let names: string[];
    try { names = await readdir(this.root); } catch { return 0; }
    const known = new Set((await this.db.query<{ slug: string }>('select slug from games')).map((r) => r.slug));
    let n = 0;
    for (const name of names) {
      if (name.startsWith('.') || known.has(name)) continue;
      const m = await readManifestFile(join(this.root, name)).catch(() => null);
      if (!m || m.slug !== name) continue;
      const seats = await readSeatsFile(join(this.root, name));
      await this.db.tx(async (q) => {
        await upsertGame(q, m);
        for (const s of seats) {
          await q.query(
            `insert into seats (id, game_slug, token, label, is_host, character_id, created_at, last_seen_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
            [s.id, m.slug, s.token, s.label, Boolean(s.host || s.label === 'Anfitrión'), s.character_id, s.created_at, s.last_seen_at],
          );
        }
      });
      n++;
    }
    if (n) log(`[base] ${n} partida${n === 1 ? '' : 's'} importada${n === 1 ? '' : 's'} de sus carpetas (game.json y seats.json)`);
    return n;
  }
}

interface LegacySeat { id: string; token: string; character_id: string | null; label: string; host?: boolean; created_at: string; last_seen_at: string | null }

async function readSeatsFile(dir: string): Promise<LegacySeat[]> {
  try {
    const f = JSON.parse(await readFile(join(dir, 'seats.json'), 'utf8')) as { seats?: LegacySeat[] };
    return Array.isArray(f.seats) ? f.seats.filter((s) => s && typeof s.id === 'string' && typeof s.token === 'string') : [];
  } catch { return []; }
}

/** Que la partida tenga su fila (asientos y dueño cuelgan de ella), sin tocarla si ya está. Con el catálogo de ficheros (tests, REPL), la crea. */
export async function ensureGameRow(q: Queryable, m: GameManifest): Promise<void> {
  const [r] = await q.query('select 1 from games where slug = $1', [m.slug]);
  if (!r) await upsertGame(q, m);
}
