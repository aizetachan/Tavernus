/**
 * Caché de respuestas del máster (MASTER_MODE=record | replay). Cada petición
 * se identifica por un hash estable de system + tools + messages, sin la parte
 * que cambia con el reloj (hora de juego, marcas de los últimos eventos), y la
 * respuesta se guarda en <dir>/<hash>.json. `record` llama a la API solo si no
 * hay fichero; `replay` nunca la llama: si falta, responde el cliente offline.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { MasterClient } from './master.js';
import { offlineClient } from './offline.js';

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

/** Quita del texto lo que depende del reloj: la línea de tiempo del contexto y las marcas [día, hh:mm] de los eventos. */
export function stripTimestamps(text: string): string {
  return text
    .replace(/^## Tiempo\n.*$/m, '## Tiempo\n<t>')
    .replace(/^- \[[^\]\n]*\d{2}:\d{2}\] /gm, '- [t] ');
}

/** JSON con claves ordenadas, para que el hash no dependa del orden de inserción. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function normalizeMessages(messages: Params['messages']): unknown {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? stripTimestamps(m.content) : m.content.map((b) => {
      if (b.type === 'text') return { type: 'text', text: stripTimestamps(b.text) };
      if (b.type === 'tool_result') return { ...b, content: typeof b.content === 'string' ? stripTimestamps(b.content) : b.content };
      return b;
    }),
  }));
}

/** Hash estable de la petición: modelo, system, tools y mensajes sin marcas de tiempo. */
export function requestHash(params: Params): string {
  const key = stable({ model: params.model, system: params.system ?? null, tools: params.tools ?? null, tool_choice: params.tool_choice ?? null, messages: normalizeMessages(params.messages) });
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

interface CacheEntry {
  hash: string;
  created_at: string;
  model: string;
  /** Primeras líneas de la acción, para reconocer el fichero a ojo. */
  action: string;
  response: Anthropic.Beta.BetaMessage;
}

function actionSnippet(params: Params): string {
  const first = params.messages[0];
  const text = first && typeof first.content === 'string' ? first.content : '';
  const m = /^## (Acción del jugador|Primera escena|Llegada|Resultado de la tirada|Ventana decisiva expirada)\n(.*)$/m.exec(text);
  return m ? `${m[1]}: ${m[2]!.slice(0, 120)}` : '';
}

async function readEntry(dir: string, hash: string): Promise<Anthropic.Beta.BetaMessage | null> {
  try {
    const raw = await readFile(join(dir, `${hash}.json`), 'utf8');
    return (JSON.parse(raw) as CacheEntry).response;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function writeEntry(dir: string, hash: string, params: Params, response: Anthropic.Beta.BetaMessage): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entry: CacheEntry = { hash, created_at: new Date().toISOString(), model: params.model, action: actionSnippet(params), response };
  await writeFile(join(dir, `${hash}.json`), JSON.stringify(entry, null, 2), 'utf8');
}

/** Envuelve el cliente real: devuelve lo cacheado si existe; si no, llama y guarda. */
export function recordClient(inner: MasterClient, dir: string): MasterClient {
  return {
    async create(params) {
      const hash = requestHash(params);
      const hit = await readEntry(dir, hash);
      if (hit) return hit;
      const res = await inner.create(params);
      await writeEntry(dir, hash, params, res);
      return res;
    },
  };
}

/** Solo lee de la caché. Si falta la petición, avisa y responde el cliente de reserva (offline por defecto). */
export function replayClient(dir: string, fallback: MasterClient = offlineClient(), warn: (msg: string) => void = (m) => console.warn(m)): MasterClient {
  return {
    async create(params) {
      const hash = requestHash(params);
      const hit = await readEntry(dir, hash);
      if (hit) return hit;
      warn(`[master] replay: sin caché para ${hash} (${actionSnippet(params) || 'petición'}); respondo en modo offline`);
      return fallback.create(params);
    },
  };
}
