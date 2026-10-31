/**
 * Reportes de los jugadores (issue #18, docs/DESPLIEGUE.md): «esto ha ido mal» desde una burbuja del
 * máster o, sin burbuja, desde el engranaje («Algo va mal»).
 *
 * Cada reporte es un JSON en <partida>/reports/<fecha>-<seq>.json con lo que escribió el jugador y el
 * evento entero (narración, tools, modelo, tokens): lo que hace falta para entenderlo sin preguntar. Solo
 * lo lee el administrador, en /admin/estado o en el disco; al jugador no se le devuelve nada del evento.
 * En el registro solo sale una línea `[reporte]`, sin su texto (servicelog.ts).
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine } from '../../engine/engine.js';
import type { GameEvent, Id, PerceptionLevel } from '../../engine/model.js';

export const REPORTS_DIR = 'reports';
/** Lo que cabe en el cuadro; lo que pase se corta. */
export const REPORT_MAX_TEXT = 1000;
/** Reportes por PJ y hora: red contra quien llene el disco, no un límite que deba notar nadie. */
export const REPORTS_PER_HOUR = 20;
/** Eventos que el PJ acababa de vivir, para entender de dónde viene el fallo. */
const RECENT = 5;

export interface Report {
  version: 1;
  game: string;
  character: { id: Id; name: string };
  /** El evento de la burbuja, o el último que vivió el PJ si es «Algo va mal» (`general`). */
  seq: number | null;
  general: boolean;
  /** Lo que escribió el jugador. */
  text: string;
  /** Hora del servidor y, aparte, la que dice su navegador. */
  at: string;
  client_at: string | null;
  user_agent: string | null;
  /** Versión en marcha al reportar (status.ts). */
  server_version: string | null;
  /** Lo que leyó ese PJ del evento: si es testigo, no coincide con la narración del actor. */
  read: { level: PerceptionLevel; text: string } | null;
  event: GameEvent | null;
  recent: { seq: number; action_type: string; text: string }[];
}

export interface ReportInput { seq: number | null; text: string; client_at?: string | null; user_agent?: string | null; server_version?: string | null }

/** El reporte de ese PJ, o null si dice un evento que él no vivió: nadie adjunta lo que no ha podido leer. */
export function reportOf(engine: Engine, game: string, characterId: Id, input: ReportInput, now: Date = new Date()): Report | null {
  const lived = engine.events.forCharacter(characterId);
  const at = input.seq === null ? lived.length - 1 : lived.findIndex((d) => d.event.seq === input.seq);
  if (at < 0 && input.seq !== null) return null;
  const d = at >= 0 ? lived[at]! : null;
  return {
    version: 1, game,
    character: { id: characterId, name: engine.world.character(characterId).name },
    seq: d?.event.seq ?? null,
    general: input.seq === null,
    text: input.text,
    at: now.toISOString(),
    client_at: input.client_at ?? null,
    user_agent: input.user_agent ?? null,
    server_version: input.server_version ?? null,
    read: d ? { level: d.level, text: d.text } : null,
    event: d?.event ?? null,
    recent: lived.slice(Math.max(0, at - RECENT + 1), at + 1).map((x) => ({ seq: x.event.seq, action_type: x.event.action_type, text: x.text })),
  };
}

/** <fecha>-<seq>.json, que ordena por fecha. Dos reportes del mismo evento en el mismo segundo no se pisan. */
export async function saveReport(gameDir: string, r: Report): Promise<string> {
  const dir = join(gameDir, REPORTS_DIR);
  await mkdir(dir, { recursive: true });
  const stamp = r.at.slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const body = JSON.stringify(r, null, 2);
  for (let n = 1; ; n++) {
    const name = `${stamp}-${r.seq ?? 0}${n > 1 ? `-${n}` : ''}.json`;
    try {
      await writeFile(join(dir, name), body, { encoding: 'utf8', flag: 'wx' });
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || n >= 50) throw e;
    }
  }
}

export interface StoredReport { file: string; slug: string; game_name: string; report: Report | null }

/**
 * Los más recientes de todas las partidas y cuántos hay en total. Solo se leen los que se van a enseñar:
 * cada uno lleva el contexto entero del máster. Uno ilegible sale con `report: null`, no rompe la página.
 */
export async function listReports(games: readonly { slug: string; name: string; dir: string }[], limit = 50): Promise<{ total: number; reports: StoredReport[] }> {
  const all: { file: string; slug: string; name: string; dir: string }[] = [];
  for (const g of games) {
    const dir = join(g.dir, REPORTS_DIR);
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const file of names) if (file.endsWith('.json')) all.push({ file, slug: g.slug, name: g.name, dir });
  }
  all.sort((a, b) => b.file.localeCompare(a.file));
  const reports = await Promise.all(all.slice(0, limit).map(async (x): Promise<StoredReport> => {
    const report = await readFile(join(x.dir, x.file), 'utf8').then((s) => JSON.parse(s) as Report).catch(() => null);
    return { file: x.file, slug: x.slug, game_name: x.name, report };
  }));
  return { total: all.length, reports };
}

/** Cuenta los reportes de cada PJ en la última hora. */
export class ReportQuota {
  private readonly sent = new Map<string, number[]>();

  constructor(private readonly perHour = REPORTS_PER_HOUR, private readonly now: () => number = Date.now) {}

  /** ¿Puede mandar otro? Si puede, queda apuntado. */
  take(key: string): boolean {
    const since = this.now() - 3_600_000;
    const recent = (this.sent.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.perHour) { this.sent.set(key, recent); return false; }
    recent.push(this.now());
    this.sent.set(key, recent);
    return true;
  }
}
