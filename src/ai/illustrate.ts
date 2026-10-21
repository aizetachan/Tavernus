/**
 * Ilustraciones de escena. Dos proveedores gratuitos:
 *
 *   - Cloudflare Workers AI (principal si hay CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID):
 *       POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell
 *       { prompt, steps: 4 } -> { result: { image: <JPEG en base64> }, success, errors }
 *     Sale 1024x1024 (el modelo no admite tamaño ni seed: la API rechaza la petición con
 *     HTTP 400 si se envía; la escena solo es reproducible por la caché). Cuota gratuita de 10.000 neuronas al
 *     día, unas 170 imágenes a 4 pasos; agotada, responde 429 o un error en `errors` y
 *     no se vuelve a probar hasta la medianoche UTC. Hasta 2 peticiones a la vez.
 *   - Pollinations (reserva, o principal sin Cloudflare):
 *       GET https://image.pollinations.ai/prompt/{prompt}?width=768&height=512&seed=N
 *
 * Mismo prompt + misma seed = misma imagen, así que la escena se describe de
 * forma determinista (nombre, descripción base, luz y un estilo fijo) y la seed
 * sale de la semilla del mundo + id de la localización.
 *
 * El servidor guarda el JPEG en <dir>/<locId>-<seed>.jpg y los clientes lo
 * reciben de ahí (la web por /images, Discord como adjunto). Con Pollinations:
 *   - Sin POLLINATIONS_API_KEY (anónimo): lleva un logo pequeño y el límite es
 *     ~1 imagen cada 45 s por IP, contados desde que termina la anterior.
 *   - Con POLLINATIONS_API_KEY: Authorization: Bearer y nologo; sin límite.
 * No basta con pasar la URL al cliente: si se pasa del límite, Pollinations le
 * sirve una imagen «Free limit reached» que no se distingue de una buena (probado
 * el 21 oct 2026). Solo quien hace la petición ve el 402 y su Retry-After. Si la
 * descarga falla del todo no se muestra nada (la URL daría ese cartel) y la escena
 * se puede volver a pedir pasados unos minutos.
 *
 * Nunca se genera dos veces la misma escena: caché en memoria y en <dir>/index.json.
 * Las peticiones van de una en una, con un mínimo de 45 s desde que terminó la
 * anterior; un 402/429 respeta Retry-After y reintenta.
 *
 * Lo dispara el motor (primera llegada de un PJ a una localización), no el máster.
 * Solo con IMAGES=on, en cualquier modo del máster (también offline: el modo
 * decide si se usa la API de Anthropic, no si hay imágenes).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine, FirstVisit } from '../engine/engine.js';
import type { Id, LightLevel } from '../engine/model.js';
import { lightAt } from '../engine/perception.js';
import type { MasterMode } from './mode.js';

export const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt/';
export const STYLE = 'fantasy illustration, medieval, painterly';
const SUFFIX = 'detailed environment, atmospheric, no text, no watermark';
export const MIN_INTERVAL_MS = 45_000;
export const CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
/** flux-1-schnell admite hasta 8 pasos; 4 da buena imagen y gasta la mitad de cuota. */
export const CLOUDFLARE_STEPS = 4;
const CLOUDFLARE_MAX_PROMPT = 2048;

export type ImageProvider = 'cloudflare' | 'pollinations';
export interface CloudflareCreds { accountId: string; apiToken: string }

/** Credenciales de Cloudflare del entorno; null si falta alguna. */
export function cloudflareFromEnv(env: NodeJS.ProcessEnv): CloudflareCreds | null {
  const apiToken = env['CLOUDFLARE_API_TOKEN']?.trim();
  const accountId = env['CLOUDFLARE_ACCOUNT_ID']?.trim();
  return apiToken && accountId ? { accountId, apiToken } : null;
}

export function cloudflareUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${CLOUDFLARE_MODEL}`;
}

const LIGHT_EN: Record<LightLevel, string> = {
  day: 'daylight',
  twilight: 'dim warm light, dusk',
  night_moon: 'night, pale moonlight',
  night_dark: 'dark night, flickering torchlight',
};

export interface SceneInput {
  location_id: Id;
  name: string;
  description: string;
  light: LightLevel;
  indoor: boolean;
}

export interface SceneImage {
  key: string;
  location_id: Id;
  /** Nombre de la localización, para el pie de la imagen. */
  name: string;
  seed: number;
  prompt: string;
  /** Quién la generó (índices antiguos: Pollinations). */
  provider?: ImageProvider;
  /** De dónde salió: la URL de Pollinations o `cloudflare:<modelo>` (referencia; los clientes usan el fichero). */
  url: string;
  /** Fichero descargado dentro del directorio de imágenes. */
  file: string;
}

export interface Illustrated { image: SceneImage; character_id: Id }
export type IllustratedListener = (r: Illustrated) => void;

/** ¿Ilustraciones activas? Solo con IMAGES=on; el modo del máster no influye (`mode` se conserva por compatibilidad). */
export function imagesEnabled(env: NodeJS.ProcessEnv, _mode?: MasterMode): boolean {
  return env['IMAGES']?.trim().toLowerCase() === 'on';
}

/** FNV-1a de 32 bits: estable entre procesos y plataformas. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed de la escena: semilla del mundo + localización, en [0, 2^31). */
export function sceneSeed(worldSeed: string | number, locationId: Id): number {
  return fnv1a(`${worldSeed}:${locationId}`) & 0x7fffffff;
}

/** Prompt corto y determinista. La descripción va tal cual (el modelo entiende español), recortada. */
export function scenePrompt(s: SceneInput): string {
  const desc = s.description.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const short = desc.length > 220 ? `${desc.slice(0, 220).replace(/\s+\S*$/, '')}…` : desc;
  const place = s.indoor ? 'interior' : 'exterior';
  return [`${s.name} (${place})`, short, LIGHT_EN[s.light], STYLE, SUFFIX].filter(Boolean).join('. ');
}

export function pollinationsUrl(prompt: string, seed: number, opts: { width?: number; height?: number; nologo?: boolean } = {}): string {
  const q = new URLSearchParams({ width: String(opts.width ?? 768), height: String(opts.height ?? 512), seed: String(seed) });
  if (opts.nologo) q.set('nologo', 'true');
  return `${POLLINATIONS_BASE}${encodeURIComponent(prompt)}?${q.toString()}`;
}

/** Clave y nombre de fichero: `<locId>-<seed>`. */
export function sceneKey(locationId: Id, seed: number): string {
  return `${locationId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${seed}`;
}

/** Retry-After en ms (segundos o fecha HTTP); null si no viene o no se entiende. */
export function retryAfterMs(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const s = Number(header.trim());
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/**
 * Cola de peticiones a Pollinations: una cada vez y no antes de `readyAt`. El
 * límite anónimo es por IP, así que todas las partidas del proceso comparten la
 * misma (`SHARED_QUEUE`) salvo que se pase otra (tests).
 */
export class PollinationsQueue {
  private chain: Promise<unknown> = Promise.resolve();
  readyAt = 0;

  /** De una en una: cada trabajo espera a que termine el anterior. */
  run<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export const SHARED_QUEUE = new PollinationsQueue();

/** Como mucho `max` trabajos a la vez (Cloudflare admite 720/min; no hace falta más). */
export class Limiter {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(readonly max: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    while (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try { return await job(); } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

export const SHARED_CLOUDFLARE_LIMIT = new Limiter(2);

/** Error de Cloudflare; `quota` = cuota diaria agotada. */
class CloudflareError extends Error {
  constructor(message: string, readonly quota: boolean) { super(message); }
}

export interface IllustratorOptions {
  /** Directorio de imágenes (data/games/<slug>/images). */
  dir: string;
  /** Semilla del mundo: la de dados de la partida o, si no hay, el id de campaña. */
  worldSeed: string | number;
  apiKey?: string | null;
  width?: number;
  height?: number;
  /** Mínimo entre el final de una petición y la siguiente (por defecto 45 s, el límite anónimo). */
  minIntervalMs?: number;
  /** Reintentos tras 402/429, error de red o petición colgada. */
  maxRetries?: number;
  /** Tras fallar del todo, cuánto esperar antes de volver a intentar esa escena (por defecto 5 min). */
  failureCooldownMs?: number;
  /** Tiempo máximo de una petición (generar tarda unos segundos; por defecto 90 s). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  /** Por defecto, la del proceso. */
  queue?: PollinationsQueue;
  /** Proveedor principal; sin él, Pollinations. */
  cloudflare?: CloudflareCreds | null;
  /** Por defecto, el del proceso. */
  cloudflareLimit?: Limiter;
}

export class Illustrator {
  private readonly opts: Required<Omit<IllustratorOptions, 'apiKey' | 'cloudflare'>> & { apiKey: string | null; cloudflare: CloudflareCreds | null };
  /** Cuota de Cloudflare agotada: no se le pide nada hasta entonces. */
  private cloudflareDownUntil = 0;
  /** Escenas por clave: una sola petición por escena aunque lleguen varios PJs a la vez. */
  private readonly memory = new Map<string, Promise<SceneImage | null>>();
  /** Escenas que fallaron: no se reintentan hasta ese instante. */
  private readonly failedUntil = new Map<string, number>();
  private readonly byLocation = new Map<Id, SceneImage>();
  private index: Record<string, SceneImage> | null = null;
  private indexWrite: Promise<void> = Promise.resolve();
  private listeners: IllustratedListener[] = [];
  /** Peticiones de red hechas (para /estado y tests). */
  requests = 0;

  constructor(opts: IllustratorOptions) {
    this.opts = {
      width: 768, height: 512, minIntervalMs: MIN_INTERVAL_MS, maxRetries: 4, failureCooldownMs: 5 * 60_000, timeoutMs: 90_000,
      fetch: (...a) => fetch(...a), now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (m) => console.log(m),
      queue: SHARED_QUEUE, cloudflareLimit: SHARED_CLOUDFLARE_LIMIT,
      ...opts,
      apiKey: opts.apiKey?.trim() || null,
      cloudflare: opts.cloudflare ?? null,
    };
  }

  /** Pollinations con clave: sin logo ni límite. */
  get keyed(): boolean { return this.opts.apiKey !== null; }

  /** Proveedor principal. */
  get provider(): ImageProvider { return this.opts.cloudflare ? 'cloudflare' : 'pollinations'; }

  onIllustrated(l: IllustratedListener): () => void {
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }

  /** Imagen ya hecha de esa localización (para pintar la escena actual). */
  imageFor(locationId: Id): SceneImage | null { return this.byLocation.get(locationId) ?? null; }

  /** Ruta absoluta del fichero descargado. */
  pathOf(image: SceneImage): string { return join(this.opts.dir, image.file); }

  /** Carga el índice del disco: las escenas ya hechas quedan disponibles sin pedir nada. */
  async load(): Promise<void> {
    await this.loadIndex();
  }

  /** Ilustra la escena (una sola vez por clave) y avisa a los oyentes para ese PJ. */
  async illustrate(scene: SceneInput, characterId: Id | null = null): Promise<SceneImage | null> {
    const seed = sceneSeed(this.opts.worldSeed, scene.location_id);
    const key = sceneKey(scene.location_id, seed);
    const retryAt = this.failedUntil.get(key);
    if (retryAt !== undefined && this.opts.now() >= retryAt) { this.failedUntil.delete(key); this.memory.delete(key); }
    let p = this.memory.get(key);
    if (!p) {
      p = this.produce(key, seed, scene).catch((e) => {
        this.opts.log(`[imágenes] ${scene.name}: ${(e as Error).message}; se reintentará más tarde`);
        this.failedUntil.set(key, this.opts.now() + this.opts.failureCooldownMs);
        return null;
      });
      this.memory.set(key, p);
    }
    const image = await p;
    if (image) {
      this.byLocation.set(image.location_id, image);
      if (characterId) for (const l of this.listeners) l({ image, character_id: characterId });
    }
    return image;
  }

  private async produce(key: string, seed: number, scene: SceneInput): Promise<SceneImage> {
    const index = await this.loadIndex();
    const cached = index[key];
    if (cached) return cached;

    const prompt = scenePrompt(scene);
    const file = `${key}.jpg`;
    let image: SceneImage | null = null;
    const cf = this.opts.cloudflare;
    if (cf && this.opts.now() >= this.cloudflareDownUntil) {
      try {
        await this.generateCloudflare(cf, prompt, file);
        image = { key, location_id: scene.location_id, name: scene.name, seed, prompt, provider: 'cloudflare', url: `cloudflare:${CLOUDFLARE_MODEL}`, file };
      } catch (e) {
        const quota = e instanceof CloudflareError && e.quota;
        if (quota) this.cloudflareDownUntil = nextUtcMidnight(this.opts.now());
        this.opts.log(`[imágenes] Cloudflare falló (${(e as Error).message})${quota ? ', cuota agotada hasta medianoche UTC' : ''}: uso Pollinations`);
      }
    }
    if (!image) {
      const { width, height } = this.opts;
      const url = pollinationsUrl(prompt, seed, { width, height, nologo: this.keyed });
      await this.download(url, file);
      image = { key, location_id: scene.location_id, name: scene.name, seed, prompt, provider: 'pollinations', url, file };
    }
    index[key] = image;
    await this.saveIndex();
    return image;
  }

  /** Cloudflare Workers AI: JSON con el JPEG en base64. Sin espaciado; como mucho 2 a la vez. */
  private generateCloudflare(cf: CloudflareCreds, prompt: string, file: string): Promise<void> {
    return this.opts.cloudflareLimit.run(async () => {
      this.requests++;
      let res: Response;
      try {
        res = await this.opts.fetch(cloudflareUrl(cf.accountId), {
          method: 'POST',
          signal: AbortSignal.timeout(this.opts.timeoutMs),
          headers: { authorization: `Bearer ${cf.apiToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.slice(0, CLOUDFLARE_MAX_PROMPT), steps: CLOUDFLARE_STEPS }),
        });
      } catch (e) {
        throw new CloudflareError((e as Error).name === 'TimeoutError' ? 'sin respuesta' : (e as Error).message, false);
      }
      if (res.status === 429) throw new CloudflareError('HTTP 429', true);
      const body = await res.json().catch(() => null) as { success?: boolean; result?: { image?: unknown }; errors?: { code?: number; message?: string }[] } | null;
      const errors = body?.errors ?? [];
      const detail = errors.map((x) => `${x.code ?? ''} ${x.message ?? ''}`.trim()).join('; ');
      if (!res.ok || !body?.success || typeof body.result?.image !== 'string') {
        const quota = errors.some((x) => x.code === 4006 || /quota|allocation|neuron/i.test(x.message ?? ''));
        throw new CloudflareError(`HTTP ${res.status}${body?.success === false ? ', success:false' : ''}${detail ? `: ${detail}` : ''}`, quota);
      }
      const bytes = Buffer.from(body.result.image, 'base64');
      if (bytes.length === 0) throw new CloudflareError('imagen vacía', false);
      await mkdir(this.opts.dir, { recursive: true });
      await writeFile(join(this.opts.dir, file), bytes);
      this.opts.log(`[imágenes] ${file} (${Math.round(bytes.length / 1024)} KB, cloudflare)`);
    });
  }

  private download(url: string, file: string): Promise<void> {
    const q = this.opts.queue;
    return q.run(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = q.readyAt - this.opts.now();
        if (wait > 0) await this.opts.sleep(wait);
        this.requests++;
        let res: Response;
        let bytes: Buffer | null = null;
        try {
          res = await this.opts.fetch(url, {
            signal: AbortSignal.timeout(this.opts.timeoutMs),
            ...(this.keyed ? { headers: { authorization: `Bearer ${this.opts.apiKey}` } } : {}),
          });
          // El límite cuenta desde que termina de llegar la imagen.
          if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
        } catch (e) {
          // Sin clave, Pollinations a veces deja la petición colgada: se corta y se reintenta.
          if (attempt >= this.opts.maxRetries) throw e;
          this.opts.log(`[imágenes] ${(e as Error).name === 'TimeoutError' ? 'sin respuesta' : (e as Error).message}: reintento`);
          continue;
        } finally {
          q.readyAt = this.opts.now() + this.opts.minIntervalMs;
        }
        if (res.status === 402 || res.status === 429) {
          if (attempt >= this.opts.maxRetries) throw new Error(`Pollinations ${res.status} tras ${attempt + 1} intentos`);
          // Retry-After manda, pero nunca antes del mínimo: con una petición anterior aún colgada
          // Pollinations repite «Retry-After: 1» una y otra vez.
          const after = retryAfterMs(res.headers.get('retry-after'), this.opts.now());
          if (after !== null) q.readyAt = Math.max(q.readyAt, this.opts.now() + after + 1000);
          this.opts.log(`[imágenes] Pollinations ${res.status}: reintento en ${Math.ceil((q.readyAt - this.opts.now()) / 1000)} s`);
          continue;
        }
        if (!res.ok || !bytes) throw new Error(`Pollinations respondió ${res.status}`);
        const type = res.headers.get('content-type') ?? '';
        if (type && !type.startsWith('image/')) throw new Error(`Pollinations devolvió ${type}, no una imagen`);
        await mkdir(this.opts.dir, { recursive: true });
        await writeFile(join(this.opts.dir, file), bytes);
        this.opts.log(`[imágenes] ${file} (${Math.round(bytes.length / 1024)} KB, pollinations${this.keyed ? '' : ' anónimo'})`);
        return;
      }
    });
  }

  private async loadIndex(): Promise<Record<string, SceneImage>> {
    if (this.index) return this.index;
    let loaded: Record<string, SceneImage> = {};
    try {
      const raw = JSON.parse(await readFile(join(this.opts.dir, 'index.json'), 'utf8')) as Record<string, SceneImage>;
      for (const [k, v] of Object.entries(raw)) if (v && typeof v.file === 'string') loaded[k] = v;
    } catch { /* sin índice todavía */ }
    // Otra llamada pudo cargarlo mientras se leía.
    if (this.index) return this.index;
    this.index = loaded;
    for (const img of Object.values(loaded)) if (!this.byLocation.has(img.location_id)) this.byLocation.set(img.location_id, img);
    return loaded;
  }

  private saveIndex(): Promise<void> {
    const write = async () => {
      await mkdir(this.opts.dir, { recursive: true });
      await writeFile(join(this.opts.dir, 'index.json'), JSON.stringify(this.index ?? {}, null, 2), 'utf8');
    };
    this.indexWrite = this.indexWrite.then(write, write);
    return this.indexWrite;
  }
}

function nextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

// ---------------------------------------------------------------------------
// Enganche con el motor
// ---------------------------------------------------------------------------

const attached = new WeakMap<Engine, Illustrator>();

/** El ilustrador de ese motor, si las imágenes están activas. */
export function illustratorOf(engine: Engine): Illustrator | null {
  return attached.get(engine) ?? null;
}

/** Escena de una localización tal como la ve el motor ahora. */
export function sceneOf(engine: Engine, locationId: Id, gameS: number = engine.gameNow()): SceneInput {
  const loc = engine.world.location(locationId);
  return {
    location_id: loc.id, name: loc.name, description: loc.description_base,
    light: lightAt(engine.clock, loc, gameS), indoor: loc.indoor,
  };
}

/** Engancha un ilustrador al motor: cada primera llegada de un PJ a una localización encola su escena. */
export function attachIllustrator(engine: Engine, illustrator: Illustrator): Illustrator {
  attached.set(engine, illustrator);
  void illustrator.load();
  engine.onFirstVisit((v: FirstVisit) => {
    void illustrator.illustrate(sceneOf(engine, v.location_id, v.game_s), v.character_id);
  });
  return illustrator;
}
