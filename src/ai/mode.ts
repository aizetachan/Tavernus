/**
 * Modo del máster, por variable de entorno MASTER_MODE:
 *   - live    (por defecto): llama a la API en cada acción.
 *   - record:  llama a la API y guarda cada respuesta en la caché; si ya está, no llama.
 *   - replay:  solo caché; lo que falte lo responde el cliente offline (avisa por consola).
 *   - offline: nunca llama: respuestas deterministas sacadas del contexto.
 * La caché vive en MASTER_CACHE_DIR o, si no, en <DATA_DIR|./data/local>/master-cache.
 */

import { join } from 'node:path';
import { recordClient, replayClient } from './cache.js';
import { liveClient, type MasterClient, type MasterOptions } from './master.js';
import { offlineClient } from './offline.js';

export const MASTER_MODES = ['live', 'record', 'replay', 'offline'] as const;
export type MasterMode = (typeof MASTER_MODES)[number];

export function isMasterMode(v: unknown): v is MasterMode {
  return typeof v === 'string' && (MASTER_MODES as readonly string[]).includes(v);
}

/** Lee MASTER_MODE. Un valor desconocido avisa y cae a `live`. */
export function masterModeFromEnv(env: NodeJS.ProcessEnv = process.env, warn: (m: string) => void = (m) => console.warn(m)): MasterMode {
  const raw = env['MASTER_MODE']?.trim().toLowerCase();
  if (!raw) return 'live';
  if (isMasterMode(raw)) return raw;
  warn(`[master] MASTER_MODE=${raw} no es válido (${MASTER_MODES.join(' | ')}); uso live`);
  return 'live';
}

export function masterCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['MASTER_CACHE_DIR'] ?? join(env['DATA_DIR'] ?? './data/local', 'master-cache');
}

/** ¿Hace falta clave de API para este modo? */
export function needsApiKey(mode: MasterMode): boolean {
  return mode === 'live' || mode === 'record';
}

/** Cliente para el modo; `null` en live (el Master construye el SDK por su cuenta). */
export function masterClientFor(mode: MasterMode, env: NodeJS.ProcessEnv = process.env, timeoutMs?: number): MasterClient | null {
  switch (mode) {
    case 'live': return null;
    case 'offline': return offlineClient();
    case 'record': return recordClient(liveClient(timeoutMs), masterCacheDir(env));
    case 'replay': return replayClient(masterCacheDir(env));
  }
}

/** Opciones para `new Master(engine, …)` según el modo. */
export function masterOptionsFor(mode: MasterMode, env: NodeJS.ProcessEnv = process.env): MasterOptions {
  const client = masterClientFor(mode, env);
  return client ? { client } : {};
}
