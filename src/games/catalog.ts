/**
 * Catálogo de partidas: dónde vive el manifiesto de cada una (nombre, modo, campaña, rutas…).
 *
 *   - FileCatalog: un game.json en la carpeta de cada partida. El de siempre: el REPL, los scripts y los tests.
 *   - DbCatalog (src/db/catalog.ts): la tabla `games` de la base. El de la web; escribe también el game.json
 *     como copia legible, para que la carpeta de una partida se entienda sola.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameManifest } from './manager.js';

export const MANIFEST = 'game.json';

export interface GameCatalog {
  get(slug: string): Promise<GameManifest | null>;
  all(): Promise<GameManifest[]>;
  /** Alta o cambio (mismo slug). */
  put(m: GameManifest): Promise<void>;
  /** Baja. La carpeta la borra el gestor. */
  remove(slug: string): Promise<void>;
}

/** Lee el game.json de una carpeta; null si no hay o no es válido. */
export async function readManifestFile(dir: string): Promise<GameManifest | null> {
  try {
    return JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as GameManifest;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

export async function writeManifestFile(dir: string, m: GameManifest): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MANIFEST), JSON.stringify(m, null, 2), 'utf8');
}

export class FileCatalog implements GameCatalog {
  constructor(private readonly root: string) {}

  async get(slug: string): Promise<GameManifest | null> {
    const m = await readManifestFile(join(this.root, slug));
    return m && m.slug === slug ? m : null;
  }

  async all(): Promise<GameManifest[]> {
    let names: string[];
    try { names = await readdir(this.root); } catch { return []; }
    const out: GameManifest[] = [];
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const m = await this.get(n).catch(() => null);
      if (m) out.push(m);
    }
    return out;
  }

  put(m: GameManifest): Promise<void> { return writeManifestFile(join(this.root, m.slug), m); }

  async remove(): Promise<void> { /* el game.json se va con la carpeta */ }
}
