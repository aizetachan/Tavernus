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
 *
 * Además de la vista de cada sitio, los momentos significativos (src/engine/moments.ts):
 *   - retrato de un NPC (primer encuentro) y del PJ que le habla: uno por entidad;
 *   - objeto cogido o examinado: uno por tipo de objeto;
 *   - escena de combate o descubrimiento: una por evento.
 * El prompt sale de lo guardado (descripción, rol, tipo) y de la biblia de estilo de
 * la campaña; la seed, de la semilla del mundo + el id. Misma caché e índice
 * (<dir>/index.json, con `kind` y `entity_id`). En la cola manda la prioridad:
 * retrato > objeto > escena, sin saltarse los 45 s ni la cuota.
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine, FirstVisit, MomentNotice } from '../engine/engine.js';
import type { Campaign, GameEvent, Id, LightLevel } from '../engine/model.js';
import { lightAt } from '../engine/perception.js';
import type { MasterMode } from './mode.js';
import { assetsFor, writtenImage, type AssetManifest } from './assets.js';

export const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt/';
export const STYLE = 'fantasy illustration, medieval, painterly';
const SUFFIX = 'detailed environment, atmospheric, no text, no watermark';
export const MIN_INTERVAL_MS = 45_000;
export const CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
/** flux-1-schnell admite hasta 8 pasos; 4 da buena imagen y gasta la mitad de cuota. */
export const CLOUDFLARE_STEPS = 4;
const CLOUDFLARE_MAX_PROMPT = 2048;

/** `written`: activo hecho a mano (src/ai/assets.ts), no generado. */
export type ImageProvider = 'cloudflare' | 'pollinations' | 'written';
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

export const LIGHT_EN: Record<LightLevel, string> = {
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

/** Qué muestra la imagen. Las de índices antiguos no lo llevan: son escenas. `manual`: el pincel del jugador (src/ai/paint.ts). */
export type ImageKind = 'scene' | 'portrait' | 'item' | 'combat' | 'discovery' | 'manual';
export type EntityKind = Exclude<ImageKind, 'scene'>;

/** Orden en la cola: retrato > objeto = pincel (lo espera el jugador) > escena. */
export const PRIORITY: Record<ImageKind, number> = { portrait: 3, item: 2, manual: 2, scene: 1, combat: 1, discovery: 1 };

export interface SceneImage {
  key: string;
  /** Localización (escena) o donde ocurrió el momento. */
  location_id: Id;
  /** Nombre de la localización, del NPC, del objeto…, para el pie de la imagen. */
  name: string;
  kind?: ImageKind;
  /** NPC, PJ, tipo de objeto o evento ilustrado (todo menos escenas). */
  entity_id?: Id;
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

/** Retrato, objeto o escena de momento ya en disco; con PJ y evento si viene de un momento. */
export interface EntityIllustrated { image: SceneImage; character_id: Id | null; event_seq: number | null; moment_key: string | null }
export type EntityListener = (r: EntityIllustrated) => void;

/** Lo que se ilustra de una entidad: el prompt ya montado (determinista) y su tamaño en Pollinations. */
export interface EntityInput {
  kind: EntityKind;
  entity_id: Id;
  name: string;
  location_id: Id;
  prompt: string;
  /** Otros ids con los que buscar un activo escrito si no hay uno de `entity_id` (`pc:<raza>-<clase>`, el punto descubierto…). */
  asset_ids?: Id[];
}

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

const TONE_EN: Record<Campaign['tone'], string> = {
  epic: 'heroic, epic', grim: 'grim, gritty, muted colors', comedy: 'whimsical, warm colors', horror: 'eerie, dark, unsettling', pulp: 'pulp adventure, vivid colors',
};

/**
 * Biblia de estilo de la campaña: el estilo fijo más el tono. Si la campaña trae
 * `art_style` (texto libre), manda ese en lugar del fijo.
 */
export function styleBible(c: Pick<Campaign, 'tone'> & { art_style?: unknown }): string {
  const custom = typeof c.art_style === 'string' && c.art_style.trim() ? c.art_style.trim() : STYLE;
  return [custom, TONE_EN[c.tone]].filter(Boolean).join(', ');
}

function clip(s: string, n = 220): string {
  const t = s.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t;
}

/** Retrato de busto de un NPC o PJ, desde lo guardado (nombre, rol, descripción). */
export function portraitPrompt(p: { name: string; role: string; description: string }, style: string): string {
  return [`Portrait of ${p.name}, ${p.role}`, clip(p.description), 'head and shoulders, facing the viewer, dark plain background', style, 'no text, no watermark'].filter(Boolean).join('. ');
}

const ITEM_EN: Record<string, string> = {
  weapon: 'weapon', armor: 'armor', consumable: 'consumable', tool: 'tool', quest: 'curious object', treasure: 'treasure', misc: 'object', container: 'container',
};

/** El objeto en la mano: nombre y tipo del catálogo. */
export function itemPrompt(p: { name: string; type: string }, style: string): string {
  return [`${p.name} (${ITEM_EN[p.type] ?? 'object'})`, 'a single object held in a hand, close-up still life, dark background', style, 'no text, no watermark'].join('. ');
}

/** Escena de un momento (combate, descubrimiento): dónde y qué pasó. */
export function momentPrompt(p: { place: string; what: string; light: LightLevel; kind: 'combat' | 'discovery' }, style: string): string {
  const mood = p.kind === 'combat' ? 'dramatic fight scene, motion' : 'moment of discovery, focused light on the find';
  return [p.place, clip(p.what), LIGHT_EN[p.light], mood, style, 'no text, no watermark'].filter(Boolean).join('. ');
}

/** Clave y fichero de una entidad: `<kind>-<id>-<seed>`. */
export function entityKey(kind: EntityKind, entityId: Id, seed: number): string {
  return `${kind}-${entityId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${seed}`;
}

/** Tamaño en Pollinations (Cloudflare siempre devuelve 1024x1024). */
const SIZE: Record<EntityKind, { width: number; height: number }> = {
  portrait: { width: 512, height: 640 }, item: { width: 512, height: 512 }, combat: { width: 768, height: 512 }, discovery: { width: 768, height: 512 }, manual: { width: 768, height: 512 },
};

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

/** Esperas ordenadas por prioridad (mayor primero) y, a igualdad, por llegada. */
class Waiters {
  private list: { priority: number; n: number; go: () => void }[] = [];
  private n = 0;
  get size(): number { return this.list.length; }
  push(priority: number, go: () => void): void {
    this.list.push({ priority, n: this.n++, go });
    this.list.sort((a, b) => b.priority - a.priority || a.n - b.n);
  }
  next(): void { this.list.shift()?.go(); }
}

/**
 * Cola de peticiones a Pollinations: una cada vez y no antes de `readyAt`. El
 * límite anónimo es por IP, así que todas las partidas del proceso comparten la
 * misma (`SHARED_QUEUE`) salvo que se pase otra (tests). Entre las que esperan,
 * pasa antes la de más prioridad (retrato > objeto > escena).
 */
export class PollinationsQueue {
  private busy = false;
  private readonly waiting = new Waiters();
  readyAt = 0;

  /** De una en una: cada trabajo espera a que termine el que está en marcha. */
  async run<T>(job: () => Promise<T>, priority = 0): Promise<T> {
    // Un microtask antes de arrancar: lo encolado a la vez se ordena por prioridad.
    await Promise.resolve();
    // El turno se pasa de mano en mano: quien termina se lo da al siguiente sin soltarlo.
    if (this.busy) await new Promise<void>((r) => this.waiting.push(priority, r));
    else this.busy = true;
    try { return await job(); } finally {
      if (this.waiting.size) this.waiting.next();
      else this.busy = false;
    }
  }
}

export const SHARED_QUEUE = new PollinationsQueue();

/** Como mucho `max` trabajos a la vez (Cloudflare admite 720/min; no hace falta más), por prioridad. */
export class Limiter {
  private active = 0;
  private readonly waiting = new Waiters();
  constructor(readonly max: number) {}

  async run<T>(job: () => Promise<T>, priority = 0): Promise<T> {
    // Un hueco que se libra pasa directo al siguiente que espera (sin que otro se cuele entre medias).
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(priority, r));
    else this.active++;
    try { return await job(); } finally {
      if (this.waiting.size) this.waiting.next();
      else this.active--;
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
  /** Retratos, objetos y escenas de momento por `<kind>:<entity_id>`. */
  private readonly byEntity = new Map<string, SceneImage>();
  /** Versión elegida de un retrato (avatar del PJ, src/ai/avatar.ts): manda sobre la de `byEntity`. */
  private readonly pinned = new Map<string, SceneImage>();
  private entityListeners: EntityListener[] = [];
  /** Peticiones de red hechas (para /estado y tests). */
  requests = 0;
  /** Activos escritos de la campaña: si hay uno, se sirve ese y no se pide nada (lo pone attachIllustrator). */
  assets: AssetManifest | null = null;

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

  /** Cuota diaria de Cloudflare agotada (hasta la medianoche UTC); siempre false sin Cloudflare. */
  get cloudflareExhausted(): boolean { return this.opts.cloudflare !== null && this.opts.now() < this.cloudflareDownUntil; }

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
    const image = await this.obtain(key, scene.name, () => this.produce(key, seed, scenePrompt(scene),
      { location_id: scene.location_id, name: scene.name }, { width: this.opts.width, height: this.opts.height }, PRIORITY.scene));
    if (image) {
      this.byLocation.set(image.location_id, image);
      if (characterId) for (const l of this.listeners) l({ image, character_id: characterId });
    }
    return image;
  }

  onEntity(l: EntityListener): () => void {
    this.entityListeners.push(l);
    return () => { this.entityListeners = this.entityListeners.filter((x) => x !== l); };
  }

  /** Retrato u objeto ya hecho (combat/discovery: la del evento). */
  entityImage(kind: EntityKind, entityId: Id): SceneImage | null { return this.pinned.get(`${kind}:${entityId}`) ?? this.byEntity.get(`${kind}:${entityId}`) ?? null; }

  /** Fija qué imagen representa a la entidad (la versión elegida de un avatar) y avisa a los oyentes. */
  pin(kind: EntityKind, entityId: Id, image: SceneImage): void {
    const shown = { ...image, entity_id: entityId };
    this.pinned.set(`${kind}:${entityId}`, shown);
    for (const l of this.entityListeners) l({ image: shown, character_id: null, event_seq: null, moment_key: null });
  }

  /**
   * Ilustra una entidad una sola vez (retrato de NPC o PJ, tipo de objeto, escena
   * de un evento) y avisa a los oyentes; `from` dice qué PJ y evento la trajeron.
   */
  async illustrateEntity(e: EntityInput, from: { character_id: Id; event_seq: number; moment_key: string } | null = null): Promise<SceneImage | null> {
    const seed = sceneSeed(this.opts.worldSeed, e.entity_id);
    const key = entityKey(e.kind, e.entity_id, seed);
    const image = await this.obtain(key, e.name, () => this.produce(key, seed, e.prompt,
      { location_id: e.location_id, name: e.name, kind: e.kind, entity_id: e.entity_id }, SIZE[e.kind], PRIORITY[e.kind], e.asset_ids));
    if (image) {
      this.byEntity.set(`${e.kind}:${e.entity_id}`, image);
      // Si hay una versión elegida, el aviso lleva esa (el retrato de base no la pisa en el hilo).
      const shown = this.pinned.get(`${e.kind}:${e.entity_id}`) ?? image;
      for (const l of this.entityListeners) l({ image: shown, character_id: from?.character_id ?? null, event_seq: from?.event_seq ?? null, moment_key: from?.moment_key ?? null });
    }
    return image;
  }

  /** Una sola petición por clave aunque la pidan varios a la vez; si falla, no se reintenta hasta pasado el enfriamiento. */
  private obtain(key: string, label: string, make: () => Promise<SceneImage>): Promise<SceneImage | null> {
    const retryAt = this.failedUntil.get(key);
    if (retryAt !== undefined && this.opts.now() >= retryAt) { this.failedUntil.delete(key); this.memory.delete(key); }
    let p = this.memory.get(key);
    if (!p) {
      p = make().catch((e) => {
        this.opts.log(`[imágenes] ${label}: ${(e as Error).message}; se reintentará más tarde`);
        this.failedUntil.set(key, this.opts.now() + this.opts.failureCooldownMs);
        return null;
      });
      this.memory.set(key, p);
    }
    return p;
  }

  /** Activo escrito: manda sobre la caché y sobre la IA. Se copia a la carpeta de la partida para servirlo como las demás. */
  private async fromAssets(key: string, seed: number, prompt: string, meta: Pick<SceneImage, 'location_id' | 'name' | 'kind' | 'entity_id'>, alt: Id[]): Promise<SceneImage | null> {
    // El pincel del jugador (src/ai/paint.ts) pinta un turno concreto: nunca hay activo escrito.
    if (meta.kind === 'manual') return null;
    const found = writtenImage(this.assets, meta.kind ?? 'scene', [meta.entity_id ?? meta.location_id, ...alt]);
    if (!found) return null;
    const index = await this.loadIndex();
    const file = `${key}-escrito.jpg`;
    await mkdir(this.opts.dir, { recursive: true });
    await copyFile(found.file, join(this.opts.dir, file));
    const image: SceneImage = { key, ...meta, seed, prompt, provider: 'written', url: `asset:${found.rel}`, file };
    index[key] = image;
    await this.saveIndex();
    return image;
  }

  private async produce(key: string, seed: number, prompt: string, meta: Pick<SceneImage, 'location_id' | 'name' | 'kind' | 'entity_id'>, size: { width: number; height: number }, priority: number, alt: Id[] = []): Promise<SceneImage> {
    const written = await this.fromAssets(key, seed, prompt, meta, alt);
    if (written) return written;
    const index = await this.loadIndex();
    const cached = index[key];
    if (cached) return cached;

    const file = `${key}.jpg`;
    let image: SceneImage | null = null;
    const cf = this.opts.cloudflare;
    if (cf && this.opts.now() >= this.cloudflareDownUntil) {
      try {
        await this.generateCloudflare(cf, prompt, file, priority);
        image = { key, ...meta, seed, prompt, provider: 'cloudflare', url: `cloudflare:${CLOUDFLARE_MODEL}`, file };
      } catch (e) {
        const quota = e instanceof CloudflareError && e.quota;
        if (quota) this.cloudflareDownUntil = nextUtcMidnight(this.opts.now());
        this.opts.log(`[imágenes] Cloudflare falló (${(e as Error).message})${quota ? ', cuota agotada hasta medianoche UTC' : ''}: uso Pollinations`);
      }
    }
    if (!image) {
      const url = pollinationsUrl(prompt, seed, { ...size, nologo: this.keyed });
      await this.download(url, file, priority);
      image = { key, ...meta, seed, prompt, provider: 'pollinations', url, file };
    }
    index[key] = image;
    await this.saveIndex();
    return image;
  }

  /** Cloudflare Workers AI: JSON con el JPEG en base64. Sin espaciado; como mucho 2 a la vez. */
  private generateCloudflare(cf: CloudflareCreds, prompt: string, file: string, priority = 0): Promise<void> {
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
    }, priority);
  }

  private download(url: string, file: string, priority = 0): Promise<void> {
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
    }, priority);
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
    for (const img of Object.values(loaded)) {
      if (img.kind && img.kind !== 'scene') { if (img.entity_id) this.byEntity.set(`${img.kind}:${img.entity_id}`, img); }
      else if (!this.byLocation.has(img.location_id)) this.byLocation.set(img.location_id, img);
    }
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

/** Retrato de un NPC o de un PJ desde lo guardado; null si no existe. */
export function portraitOf(engine: Engine, id: Id, locationId: Id): EntityInput | null {
  const w = engine.world;
  const style = styleBible(w.campaign);
  const npc = w.npcs.get(id);
  if (npc) return { kind: 'portrait', entity_id: id, name: npc.name, location_id: locationId, prompt: portraitPrompt({ name: npc.name, role: npc.role, description: npc.description }, style) };
  const c = w.characters.get(id);
  if (c) return { kind: 'portrait', entity_id: id, name: c.name, location_id: locationId, prompt: portraitPrompt({ name: c.name, role: `${c.race} ${c.class_name}`, description: c.appearance }, style), asset_ids: [`pc:${c.race_id}-${c.class_id}`, `pc:${c.race_id}`] };
  return null;
}

/** Id del retrato del narrador en la caché (no es un NPC ni un PJ). */
export const MASTER_PORTRAIT_ID = 'master';

/** Retrato del narrador como un «ente»: su nombre y su voz de la configuración del máster. */
export function masterPortraitOf(engine: Engine, locationId: Id): EntityInput {
  const m = engine.world.campaign.master;
  const name = m.name.trim() || 'el Narrador';
  return {
    kind: 'portrait', entity_id: MASTER_PORTRAIT_ID, name, location_id: locationId,
    prompt: portraitPrompt({ name, role: 'the spirit who narrates this tale, a hooded ethereal being of candle smoke and starlight', description: m.voice[0] ?? '' }, styleBible(engine.world.campaign)),
  };
}

/** Qué ilustrar para un momento del motor (la vista del sitio la pone la primera visita, aquí no). */
export function entityOf(engine: Engine, m: MomentNotice['moment'], e: GameEvent): EntityInput | null {
  const w = engine.world;
  const style = styleBible(w.campaign);
  switch (m.kind) {
    case 'scene': return null;
    case 'portrait': return portraitOf(engine, m.entity_id, e.location_id);
    case 'item': {
      const def = w.itemDefs.get(m.entity_id);
      return def ? { kind: 'item', entity_id: def.id, name: def.name, location_id: e.location_id, prompt: itemPrompt({ name: def.name, type: def.type }, style) } : null;
    }
    case 'combat':
    case 'discovery': {
      const loc = w.locations.get(e.location_id);
      if (!loc) return null;
      const spot = m.subject ? w.spots.get(m.subject) : undefined;
      // Combate: quién lucha contra quién. El texto del evento de la tirada es la línea de dados («🎲 Ataque…: d20 [16] + 5»), no una escena.
      const npc = m.kind === 'combat' && m.subject ? w.npcs.get(m.subject) : undefined;
      const pc = m.kind === 'combat' && m.subject && !npc ? w.characters.get(m.subject) : undefined;
      const foe = npc ? `${npc.name}, ${npc.role}: ${npc.description}` : pc ? `${pc.name}, ${pc.race} ${pc.class_name}: ${pc.appearance}` : null;
      const attacker = w.characters.get(m.character_id);
      const what = spot ? `${spot.name}: ${spot.description}`
        : foe ? `${attacker ? `${attacker.name} (${attacker.race} ${attacker.class_name})` : 'A hero'} fighting ${foe}`
        : (e.observable ?? e.narration_private);
      const fallen = npc?.name ?? pc?.name;
      return {
        kind: m.kind, entity_id: e.id, name: fallen ? `${loc.name} · ${fallen}` : spot?.name ?? loc.name, location_id: loc.id, ...(m.subject ? { asset_ids: [m.subject] } : {}),
        prompt: momentPrompt({ place: `${loc.name} (${loc.indoor ? 'interior' : 'exterior'})`, what, light: lightAt(engine.clock, loc, e.timestamp_game_s), kind: m.kind }, style),
      };
    }
  }
}

/**
 * Engancha un ilustrador al motor: cada primera llegada de un PJ a una localización
 * encola su escena, y cada momento significativo su retrato, objeto o escena. En el
 * primer encuentro con un NPC también se hace el retrato del PJ (para el diálogo).
 */
export function attachIllustrator(engine: Engine, illustrator: Illustrator): Illustrator {
  attached.set(engine, illustrator);
  illustrator.assets ??= assetsFor(engine.world.campaign.id);
  void illustrator.load();
  engine.onFirstVisit((v: FirstVisit) => {
    void illustrator.illustrate(sceneOf(engine, v.location_id, v.game_s), v.character_id);
  });
  engine.onMoment(({ moment, event }) => {
    const input = entityOf(engine, moment, event);
    if (!input) return;
    void illustrator.illustrateEntity(input, { character_id: moment.character_id, event_seq: event.seq, moment_key: moment.key });
    if (moment.kind === 'portrait') {
      const pc = portraitOf(engine, moment.character_id, event.location_id);
      if (pc) void illustrator.illustrateEntity(pc);
    }
  });
  return illustrator;
}
