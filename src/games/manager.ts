/**
 * Gestor de partidas para la web. Una partida es una carpeta
 * <root>/<slug>/ con un manifiesto (game.json) y, normalmente, dentro:
 *
 *   data/          persistencia JSON del motor (JsonFileRepository)
 *   master-cache/  respuestas del máster (record | replay; src/ai/cache.ts)
 *   initial/       copia del estado recién creado (grabaciones y demos), para reiniciar
 *   recorded/      la partida grabada tal como quedó al convertirla en demo
 *   images/        ilustraciones de escena (IMAGES=on; src/ai/illustrate.ts)
 *   world.seed.json mundo generado (src/worldgen): la semilla de la que arranca, en vez de la demo
 *
 * Las rutas del manifiesto son relativas a la carpeta de la partida (o absolutas):
 * la partida «principal» migrada apunta a DATA_DIR sin mover nada de sitio.
 * Los motores se arrancan bajo demanda y se quedan abiertos hasta `close`.
 */

import { cp, mkdir, open as openFile, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine, type EngineOptions } from '../engine/engine.js';
import { seededRng, type Rng } from '../engine/dice.js';
import type { Id, WorldSnapshot } from '../engine/model.js';
import { makeSeed } from '../data/seed/demo.js';
import { authoredSeed, isAuthoredCampaign } from '../data/campaigns/index.js';
import { CLASSES, RACES } from '../data/srd/index.js';
import { JsonFileRepository } from '../persistence/jsonfile.js';
import { claimSituation, generateSeed, TONES, type GenerateOptions, type Tone } from '../worldgen/index.js';
import { Master, noCredit } from '../ai/master.js';
import { isMasterMode, masterCacheDir, masterModeFromEnv, masterOptionsFor, type MasterMode } from '../ai/mode.js';
import { attachIllustrator, cloudflareFromEnv, imagesEnabled, Illustrator, type IllustratorOptions } from '../ai/illustrate.js';
import { attachAvatars, avatarsOf, cleanLook } from '../ai/avatar.js';
import { BudgetBook, budgetFromEnv, BudgetedMaster, type BudgetLimits } from '../ai/budget.js';
import { offlineClient } from '../ai/offline.js';
import type { MasterLike } from '../engine/engine.js';

/**
 * En Windows, renombrar una carpeta falla con EPERM/EBUSY mientras algún
 * descriptor de ficheros recién cerrado sigue vivo unos milisegundos.
 * Reintenta con esperas cortas y, si no hay manera, copia y borra.
 */
async function renameWithRetry(from: string, to: string, attempts = 8): Promise<void> {
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

export const MANIFEST = 'game.json';
export const WORLD_FILE = 'world.seed.json';
export const MAIN_SLUG = 'principal';
export const INITIAL_DEMO_SLUG = 'demo-inicial';
/** Modos que se eligen al crear; `replay` solo lo tienen las demos. */
export const NEW_GAME_MODES = ['live', 'offline', 'record'] as const;
export type NewGameMode = (typeof NEW_GAME_MODES)[number];

export interface GameManifest {
  version: 1;
  slug: string;
  name: string;
  created_at: string;
  last_opened_at: string | null;
  campaign_id: Id;
  mode: MasterMode;
  /** Partida de demostración: modo replay con su caché incluida. */
  demo: boolean;
  /** La partida migrada de DATA_DIR. */
  main: boolean;
  data_dir: string;
  cache_dir: string;
  /** Semilla de dados (motor y máster); null = azar normal. */
  dice_seed: number | null;
  /** Estado recién creado, para que una demo empiece igual que su grabación. */
  initial_dir: string | null;
  /** Personaje creado con la partida, si se creó alguno. */
  character_id: Id | null;
  /** Mundo generado: de qué semilla y dónde está guardado. Sin él (o null), la semilla demo. */
  world?: GameWorld | null;
}

export interface GameWorld { file: string; seed: number; tone: Tone; setting: string; model: string }

/** Lo que pide el formulario para generar un mundo. Semilla vacía o null: al azar. */
export interface WorldInput { seed?: number | string | null; tone?: string; setting?: string }

/** Tonos para el menú, en castellano. */
export const TONE_OPTIONS: { id: Tone; name: string }[] = [
  { id: 'grim', name: 'Sombrío' }, { id: 'epic', name: 'Épico' }, { id: 'horror', name: 'Terror' }, { id: 'pulp', name: 'Pulp' }, { id: 'comedy', name: 'Cómico' },
];

export interface GameInfo {
  slug: string;
  name: string;
  created_at: string;
  last_opened_at: string | null;
  mode: MasterMode;
  demo: boolean;
  main: boolean;
  dice_seed: number | null;
  characters: string[];
  /** Respuestas guardadas en la caché (grabaciones y demos). */
  cache_entries: number;
  open: boolean;
  /** Mundo generado (null: la semilla demo). */
  world: { seed: number; tone: Tone; /** Salió en modo plantilla (sin Claude). */ template: boolean } | null;
  /** Dónde está la partida, para el menú: la última narración, en una o dos frases (null si aún no ha pasado nada). */
  synopsis: string | null;
  /** La última vista de un sitio pintada en la partida, para el menú (null si aún no hay ninguna). */
  cover: string | null;
}

export interface CreateGameInput {
  name: string;
  mode: NewGameMode;
  /** `hook`: lo que el jugador cuenta de por qué viene; en un mundo generado entra en su situación inicial. */
  character?: { name: string; race_id?: string; class_id?: string; hook?: string; /** Cómo se ve: alimenta su primer avatar (src/ai/avatar.ts). */ appearance?: string; /** Al morir (SPEC §4.7): casual por defecto. */ death_mode?: 'casual' | 'hardcore' } | null;
  dice_seed?: number | null;
  campaign_id?: Id;
  /** Mundo nuevo generado en vez de la semilla demo. */
  world?: WorldInput | null;
}

export interface GamePaths { dir: string; data: string; cache: string; initial: string | null }

/** Construye el máster de una partida; `null` = sin máster (narración plana). Inyectable en tests. */
export type MasterFactory = (engine: Engine, game: GameManifest, paths: GamePaths, rng: Rng | undefined) => Master | null;

export interface GameManagerOptions {
  /** Carpeta de partidas (data/games). */
  root: string;
  /** Entorno para la migración y el máster por defecto (DATA_DIR, MASTER_MODE, MASTER_CACHE_DIR, CAMPAIGN_ID). */
  env?: NodeJS.ProcessEnv;
  masterFor?: MasterFactory;
  /** Opciones extra para Engine.boot (reloj, atajos deterministas). */
  engine?: Partial<Omit<EngineOptions, 'repo' | 'rng'>>;
  now?: () => Date;
  log?: (msg: string) => void;
  /** Opciones extra del ilustrador con IMAGES=on (fetch simulado en tests). */
  illustrator?: Partial<IllustratorOptions>;
  /** Generador de mundos (por defecto src/worldgen); inyectable en tests. */
  worldgen?: (opts: GenerateOptions) => Promise<WorldSnapshot>;
  /** Cupo diario del máster real por PJ (src/ai/budget.ts); por defecto, del entorno. null = sin límite. */
  budget?: BudgetLimits | null;
}

export class GameError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function slugify(name: string): string {
  const s = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'partida';
}

/** Máster por defecto: el cliente que toca a su modo (mode.ts), con la caché de la propia partida. */
export function defaultMasterFactory(env: NodeJS.ProcessEnv = process.env): MasterFactory {
  return (engine, game, paths, rng) => {
    if (!Master.configured(game.mode)) return null;
    const opts = masterOptionsFor(game.mode, { ...env, MASTER_CACHE_DIR: paths.cache });
    return new Master(engine, { ...opts, ...(rng ? { rng } : {}) });
  };
}

export class GameManager {
  readonly root: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly masterFor: MasterFactory;
  private readonly engineOpts: Partial<EngineOptions>;
  private readonly illustratorOpts: Partial<IllustratorOptions>;
  private readonly worldgen: (opts: GenerateOptions) => Promise<WorldSnapshot>;
  private readonly budget: BudgetLimits | null;
  private readonly books = new WeakMap<Engine, BudgetBook>();
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;
  private readonly engines = new Map<string, Promise<Engine>>();
  private readonly closeListeners = new Set<(slug: string, engine: Engine) => void>();

  constructor(opts: GameManagerOptions) {
    this.root = resolve(opts.root);
    this.env = opts.env ?? process.env;
    this.masterFor = opts.masterFor ?? defaultMasterFactory(this.env);
    this.engineOpts = opts.engine ?? {};
    this.illustratorOpts = opts.illustrator ?? {};
    this.worldgen = opts.worldgen ?? generateSeed;
    this.budget = opts.budget !== undefined ? opts.budget : budgetFromEnv(this.env);
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? ((m) => console.log(m));
  }

  /** Opciones del formulario de nueva partida. */
  static characterOptions(): { races: { id: string; name: string }[]; classes: { id: string; name: string }[]; tones: { id: Tone; name: string }[] } {
    return { races: RACES.map((r) => ({ id: r.id, name: r.name })), classes: CLASSES.map((c) => ({ id: c.id, name: c.name })), tones: TONE_OPTIONS };
  }

  // -------------------------------------------------------------------------
  // Migración
  // -------------------------------------------------------------------------

  /**
   * Si no hay ninguna partida: la de DATA_DIR pasa a ser «principal» (sin copiar
   * ni mover sus ficheros) y, si hay caché grabada en MASTER_CACHE_DIR, se
   * empaqueta como demo inicial.
   */
  async init(): Promise<{ migrated: boolean; demo: boolean }> {
    await mkdir(this.root, { recursive: true });
    if ((await this.manifests()).length > 0) return { migrated: false, demo: false };

    const env = this.env;
    const mainDir = this.dirOf(MAIN_SLUG);
    const dataDir = resolve(env['DATA_DIR'] ?? './data/local');
    const campaign = env['CAMPAIGN_ID'] ?? 'demo';
    const created = await mtime(join(dataDir, `${campaign}.world.json`));
    await this.writeManifest({
      version: 1, slug: MAIN_SLUG, name: 'Partida principal', created_at: (created ?? this.now()).toISOString(), last_opened_at: null,
      campaign_id: campaign, mode: masterModeFromEnv(env, this.log), demo: false, main: true,
      data_dir: relPath(mainDir, dataDir), cache_dir: relPath(mainDir, resolve(masterCacheDir(env))),
      dice_seed: null, initial_dir: null, character_id: null,
    });
    this.log(`[partidas] migrada la partida de ${dataDir} como «${MAIN_SLUG}»`);

    const cacheDir = resolve(masterCacheDir(env));
    const entries = await countJson(cacheDir);
    if (entries === 0) return { migrated: true, demo: false };
    const demoDir = this.dirOf(INITIAL_DEMO_SLUG);
    await cp(cacheDir, join(demoDir, 'master-cache'), { recursive: true });
    await this.writeManifest({
      version: 1, slug: INITIAL_DEMO_SLUG, name: 'Demo inicial', created_at: this.now().toISOString(), last_opened_at: null,
      campaign_id: campaign, mode: 'replay', demo: true, main: false,
      data_dir: 'data', cache_dir: 'master-cache', dice_seed: null, initial_dir: null, character_id: null,
    });
    this.log(`[partidas] ${entries} respuestas de ${cacheDir} empaquetadas como «${INITIAL_DEMO_SLUG}»`);
    return { migrated: true, demo: true };
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  async get(slug: string): Promise<GameManifest | null> {
    if (!SLUG.test(slug)) return null;
    try {
      const m = JSON.parse(await readFile(join(this.dirOf(slug), MANIFEST), 'utf8')) as GameManifest;
      return m.slug === slug && isMasterMode(m.mode) ? m : null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async require(slug: string): Promise<GameManifest> {
    const m = await this.get(slug);
    if (!m) throw new GameError(`No existe la partida «${slug}».`, 404);
    return m;
  }

  paths(m: GameManifest): GamePaths {
    const dir = this.dirOf(m.slug);
    const at = (p: string) => (isAbsolute(p) ? p : resolve(dir, p));
    return { dir, data: at(m.data_dir), cache: at(m.cache_dir), initial: m.initial_dir ? at(m.initial_dir) : null };
  }

  /** Partidas, la última abierta primero. */
  async list(): Promise<GameInfo[]> {
    const out: GameInfo[] = [];
    for (const m of await this.manifests()) out.push(await this.info(m));
    return out.sort((a, b) => (b.last_opened_at ?? b.created_at).localeCompare(a.last_opened_at ?? a.created_at));
  }

  async info(m: GameManifest): Promise<GameInfo> {
    const p = this.paths(m);
    const open = this.engines.has(m.slug);
    let characters: string[] = [];
    if (open) {
      const engine = await this.engines.get(m.slug)!.catch(() => null);
      if (engine) characters = [...engine.world.characters.values()].filter((c) => c.status !== 'retired').map((c) => c.name);
    } else {
      try {
        const snap = JSON.parse(await readFile(join(p.data, `${m.campaign_id}.world.json`), 'utf8')) as WorldSnapshot;
        characters = snap.characters.filter((c) => c.status !== 'retired').map((c) => c.name);
      } catch { /* aún sin arrancar: la semilla */
        characters = m.world || isAuthoredCampaign(m.campaign_id) ? [] : makeSeed().characters.map((c) => c.name);
      }
    }
    return {
      slug: m.slug, name: m.name, created_at: m.created_at, last_opened_at: m.last_opened_at, mode: m.mode, demo: m.demo, main: m.main,
      dice_seed: m.dice_seed, characters, cache_entries: m.mode === 'record' || m.mode === 'replay' ? await countJson(p.cache) : 0, open,
      world: m.world ? { seed: m.world.seed, tone: m.world.tone, template: m.world.model === 'offline' } : null,
      synopsis: await synopsisOf(join(p.data, `${m.campaign_id}.events.jsonl`)),
      cover: await coverOf(join(p.dir, 'images'), m.slug),
    };
  }

  isOpen(slug: string): boolean { return this.engines.has(slug); }

  /** Motores ya arrancados (para el tick de la web). */
  async openEngines(): Promise<[string, Engine][]> {
    const out: [string, Engine][] = [];
    for (const [slug, p] of this.engines) {
      const e = await p.catch(() => null);
      if (e) out.push([slug, e]);
    }
    return out;
  }

  onClose(l: (slug: string, engine: Engine) => void): () => void {
    this.closeListeners.add(l);
    return () => { this.closeListeners.delete(l); };
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  /** Motor de la partida; lo arranca la primera vez. */
  open(slug: string): Promise<Engine> {
    const existing = this.engines.get(slug);
    if (existing) return existing;
    const p = this.boot(slug);
    this.engines.set(slug, p);
    p.catch(() => { if (this.engines.get(slug) === p) this.engines.delete(slug); });
    return p;
  }

  private async boot(slug: string): Promise<Engine> {
    const m = await this.require(slug);
    const p = this.paths(m);
    // Mundo generado (guardado junto a la partida), campaña escrita (src/data/campaigns) o la semilla de pruebas.
    const seed = m.world ? JSON.parse(await readFile(join(p.dir, m.world.file), 'utf8')) as WorldSnapshot
      : isAuthoredCampaign(m.campaign_id) ? authoredSeed(m.campaign_id, { now: this.now() }) : makeSeed();
    const engine = await Engine.boot({
      ...this.engineOpts,
      repo: new JsonFileRepository(p.data), campaignId: m.campaign_id,
      ...(m.campaign_id === seed.campaign.id ? { seed } : {}),
      ...(m.dice_seed !== null ? { rng: seededRng(m.dice_seed) } : {}),
    });
    // El máster lleva su propia secuencia, derivada de la misma semilla.
    const master = this.masterFor(engine, m, p, m.dice_seed !== null ? seededRng((m.dice_seed ^ 0x9e3779b9) >>> 0) : undefined);
    engine.attachMaster(master && this.budget && (m.mode === 'live' || m.mode === 'record') ? this.withBudget(engine, master, p) : master);
    if (imagesEnabled(this.env, m.mode)) {
      const ill = attachIllustrator(engine, new Illustrator({
        dir: join(p.dir, 'images'), worldSeed: m.dice_seed ?? m.campaign_id,
        apiKey: this.env['POLLINATIONS_API_KEY'] ?? null, cloudflare: cloudflareFromEnv(this.env), log: this.log, ...this.illustratorOpts,
      }));
      attachAvatars(engine, ill, { dir: join(p.dir, 'images'), log: this.log });
    }
    m.last_opened_at = this.now().toISOString();
    await this.writeManifest(m);
    this.log(`[partidas] abierta «${m.slug}» (${m.mode}${master ? '' : ', sin máster: narración plana'}${master && this.budget && (m.mode === 'live' || m.mode === 'record') ? `, cupo ${this.budget.actions || '∞'} acciones${this.budget.tokens ? ` / ${this.budget.tokens} tokens` : ''} por PJ y día` : ''}${imagesEnabled(this.env, m.mode) ? `, ilustraciones con ${cloudflareFromEnv(this.env) ? 'Cloudflare (reserva: Pollinations)' : 'Pollinations'}` : ''}) en ${p.data}`);
    return engine;
  }

  /** El máster real con cupo diario por PJ; agotado, el offline (src/ai/budget.ts). */
  private withBudget(engine: Engine, live: MasterLike, p: GamePaths): MasterLike {
    const book = new BudgetBook(this.budget!, join(p.dir, 'budget.json'), () => this.now().getTime());
    this.books.set(engine, book);
    return new BudgetedMaster(engine, live, new Master(engine, { client: offlineClient() }), book);
  }

  /** Cupo del máster de la partida, si lo tiene (para la web). */
  budgetOf(engine: Engine): BudgetBook | null { return this.books.get(engine) ?? null; }

  /**
   * Un PJ más en una partida ya creada (invitación con asiento libre): como el de
   * la creación, con su situación inicial en campañas escritas y mundos generados.
   * Con `near`, empieza en el punto de ese PJ (para jugar juntos desde el principio).
   */
  async addCharacter(slug: string, userId: Id, input: NonNullable<CreateGameInput['character']>, opts: { near?: Id | null } = {}): Promise<Id> {
    const game = await this.require(slug);
    const engine = await this.open(slug);
    const id = await this.spawnCharacter(engine, game, userId, input, opts.near ?? null);
    await engine.flush();
    void avatarsOf(engine)?.ensure(id);
    return id;
  }

  /**
   * Crea el PJ y lo coloca antes de anunciar su llegada: primero su situación
   * inicial (campañas escritas y mundos generados) y, con `nearId`, junto a ese PJ
   * (para empezar juntos). El motor emite «llega a…» y la primera visita ya ahí.
   */
  private async spawnCharacter(engine: Engine, game: GameManifest, userId: Id, input: NonNullable<CreateGameInput['character']>, nearId: Id | null = null): Promise<Id> {
    const situations = Boolean(game.world || isAuthoredCampaign(game.campaign_id));
    const r = await engine.createCharacter(userId, input.name.trim(), {
      ...(input.race_id ? { race_id: input.race_id } : {}),
      ...(input.class_id ? { class_id: input.class_id } : {}),
      ...(cleanLook(input.appearance ?? '') ? { appearance: cleanLook(input.appearance!) } : {}),
      death_mode: input.death_mode === 'hardcore' ? 'hardcore' : 'casual',
    }, {
      place: (c) => {
        const near = nearId ? engine.world.characters.get(nearId) : null;
        const together = near && near.id !== c.id && near.status !== 'retired' && near.location.type === 'spot' ? near : null;
        // Juntos: situación complementaria (llegasteis juntos, mismo lugar y reloj), no la misma repetida.
        if (situations) claimSituation(engine.world, c.id, engine.gameNow(), input.hook, { companionOf: together?.id ?? null });
        if (together) {
          c.location = { type: 'spot', id: together.location.id };
          // Llegaron juntos: se conocen por su nombre desde el principio.
          if (!c.knows.includes(together.id)) c.knows.push(together.id);
          if (!together.knows.includes(c.id)) { together.knows.push(c.id); engine.world.touch('characters', together.id); }
          engine.world.touch('characters', c.id);
        }
      },
    });
    if (!r.ok) throw new GameError(r.reason);
    return r.character.id;
  }

  /** Vuelca y suelta el motor; los oyentes de `onClose` cierran sus conexiones. */
  async close(slug: string): Promise<void> {
    const p = this.engines.get(slug);
    if (!p) return;
    this.engines.delete(slug);
    const engine = await p.catch(() => null);
    if (!engine) return;
    // Lo que aún corre en sus colas (una presentación, una llegada narrada) termina antes de soltar la partida.
    await engine.settle();
    await engine.flush();
    for (const l of this.closeListeners) l(slug, engine);
  }

  async closeAll(): Promise<void> {
    for (const slug of [...this.engines.keys()]) await this.close(slug);
  }

  async create(input: CreateGameInput): Promise<{ game: GameManifest; character_id: Id | null }> {
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 60) throw new GameError('El nombre de la partida debe tener entre 1 y 60 caracteres.');
    if (!(NEW_GAME_MODES as readonly string[]).includes(input.mode)) throw new GameError(`Modo no válido: ${String(input.mode)} (${NEW_GAME_MODES.join(' | ')}).`);
    const seedIn = input.dice_seed;
    if (seedIn !== undefined && seedIn !== null && (!Number.isInteger(seedIn) || seedIn < 0 || seedIn > 0xffffffff)) throw new GameError('La semilla de dados debe ser un entero entre 0 y 4294967295.');
    const charName = input.character?.name?.trim() ?? '';
    const world = input.world ? parseWorldInput(input.world) : null;

    const slug = await this.freeSlug(slugify(name));
    // Una grabación siempre lleva semilla: así la demo tira los mismos dados.
    const dice_seed = seedIn ?? (input.mode === 'record' ? Math.floor(Math.random() * 0xffffffff) : null);
    const game: GameManifest = {
      version: 1, slug, name, created_at: this.now().toISOString(), last_opened_at: null,
      campaign_id: input.campaign_id ?? 'brezal', mode: input.mode, demo: false, main: false,
      data_dir: 'data', cache_dir: 'master-cache', dice_seed, initial_dir: null, character_id: null,
    };
    await this.writeManifest(game);

    try {
      if (world) {
        // Mundo nuevo: se genera con el PJ dentro (para que nazca con su situación) y se guarda junto a la partida.
        const hook = input.character?.hook?.trim().slice(0, 400);
        const race = RACES.find((r) => r.id === input.character?.race_id)?.name;
        const klass = CLASSES.find((c) => c.id === input.character?.class_id)?.name;
        let snap: WorldSnapshot;
        try {
          snap = await this.worldgen({
            ...world, env: { ...this.env, MASTER_MODE: game.mode }, log: this.log,
            ...(game.mode === 'offline' ? { client: null } : {}),
            characters: charName ? [{ name: charName, ...(race ? { race } : {}), ...(klass ? { class_name: klass } : {}), ...(hook ? { hook } : {}) }] : [],
          });
        } catch (e) {
          this.log(`[partidas] no se pudo generar el mundo: ${(e as Error).message}`);
          throw new GameError(`No se pudo generar el mundo: ${worldgenCause(e)}`, 502);
        }
        if (game.mode !== 'offline' && snap.campaign.generation?.model === 'offline') {
          this.log('[partidas] mundo en modo plantilla: no hay clave de API para generarlo con Claude');
        }
        await writeFile(join(this.dirOf(slug), WORLD_FILE), JSON.stringify(snap), 'utf8');
        game.campaign_id = snap.campaign.id;
        game.world = { file: WORLD_FILE, seed: world.seed, tone: world.tone, setting: world.setting, model: snap.campaign.generation?.model ?? 'offline' };
        await this.writeManifest(game);
      }
      const engine = await this.open(slug);
      if (charName) game.character_id = await this.spawnCharacter(engine, game, `web:${slug}`, { ...input.character!, name: charName });
      await engine.flush();
      if (input.mode === 'record') {
        // Foto del arranque: la demo empezará desde aquí, con el mismo personaje.
        const p = this.paths(game);
        await cp(p.data, join(p.dir, 'initial'), { recursive: true });
        game.initial_dir = 'initial';
      }
      game.last_opened_at = this.now().toISOString();
      await this.writeManifest(game);
      // Su avatar se pinta de fondo: la partida se abre sin esperarlo y llega por el stream («portrait»).
      if (game.character_id) void avatarsOf(engine)?.ensure(game.character_id);
      return { game, character_id: game.character_id };
    } catch (e) {
      await this.close(slug).catch(() => {});
      await rm(this.dirOf(slug), { recursive: true, force: true });
      throw e;
    }
  }

  /** Borra la carpeta de la partida. Los datos fuera de ella (la principal en DATA_DIR) no se tocan. */
  async delete(slug: string): Promise<void> {
    await this.require(slug);
    await this.close(slug);
    await rm(this.dirOf(slug), { recursive: true, force: true });
  }

  /**
   * Grabación → demo: pasa a replay con su caché, guarda lo jugado en recorded/
   * y vuelve al estado del arranque para que la demo se repita desde el principio.
   */
  async convertToDemo(slug: string): Promise<GameManifest> {
    const m = await this.require(slug);
    if (m.demo) throw new GameError('Esa partida ya es una demo.');
    if (m.mode !== 'record') throw new GameError('Solo las grabaciones (modo grabar) se pueden convertir en demo.');
    const p = this.paths(m);
    if (!inside(p.dir, p.data) || !inside(p.dir, p.cache)) throw new GameError('Esta partida guarda sus datos fuera de su carpeta; no se puede convertir en demo.');
    await this.close(slug);
    const recorded = join(p.dir, 'recorded');
    await rm(recorded, { recursive: true, force: true });
    if (await exists(p.data)) await renameWithRetry(p.data, recorded);
    await this.restoreInitial(m);
    m.mode = 'replay';
    m.demo = true;
    await this.writeManifest(m);
    return m;
  }

  /** Demo desde el principio: tira lo jugado y vuelve al estado inicial. */
  async resetDemo(slug: string): Promise<GameManifest> {
    const m = await this.require(slug);
    if (!m.demo) throw new GameError('Solo se pueden reiniciar las demos.');
    const p = this.paths(m);
    if (!inside(p.dir, p.data)) throw new GameError('Esta demo guarda sus datos fuera de su carpeta.');
    await this.close(slug);
    await rm(p.data, { recursive: true, force: true });
    await this.restoreInitial(m);
    return m;
  }

  // -------------------------------------------------------------------------

  private async restoreInitial(m: GameManifest): Promise<void> {
    const p = this.paths(m);
    if (p.initial && await exists(p.initial)) await cp(p.initial, p.data, { recursive: true });
    else await mkdir(p.data, { recursive: true }); // sin foto: arranca de la semilla
  }

  private dirOf(slug: string): string {
    if (!SLUG.test(slug)) throw new GameError(`Identificador de partida no válido: «${slug}».`);
    return join(this.root, slug);
  }

  private async manifests(): Promise<GameManifest[]> {
    let names: string[];
    try { names = await readdir(this.root); } catch { return []; }
    const out: GameManifest[] = [];
    for (const n of names) {
      const m = await this.get(n).catch(() => null);
      if (m) out.push(m);
    }
    return out;
  }

  private async freeSlug(base: string): Promise<string> {
    const trimmed = base.slice(0, 52).replace(/-+$/, '') || 'partida';
    for (let i = 1; ; i++) {
      const s = i === 1 ? trimmed : `${trimmed}-${i}`;
      if (!(await exists(join(this.root, s)))) return s;
    }
  }

  private async writeManifest(m: GameManifest): Promise<void> {
    const dir = this.dirOf(m.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, MANIFEST), JSON.stringify(m, null, 2), 'utf8');
  }
}

/** La causa de un fallo de generación, corta y en castellano, para el formulario. */
export function worldgenCause(e: unknown): string {
  const err = e as { status?: number; message?: string; errors?: string[] };
  const msg = String(err?.message ?? e);
  if (/grammar is too large/i.test(msg)) return 'el esquema es demasiado grande para la API.';
  if (noCredit(msg)) return 'la cuenta de la API no tiene crédito; hay que recargarla.';
  if (err?.status === 401 || err?.status === 403) return 'la clave de API no vale o no tiene permiso.';
  if (err?.status === 429) return 'la API está saturada o sin saldo; prueba en un rato.';
  if (err?.status !== undefined && err.status >= 500) return 'la API no responde ahora mismo; prueba en un rato.';
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) return 'la API ha tardado demasiado.';
  const first = err?.errors?.[0];
  return (first ? `${msg} (${first})` : msg).replace(/^\d{3}\s+/, '').slice(0, 200);
}

/** Valida lo que llega del formulario: semilla entera (vacía = al azar), tono conocido, ambientación corta. */
export function parseWorldInput(w: WorldInput): { seed: number; tone: Tone; setting: string } {
  const raw = typeof w.seed === 'string' ? w.seed.trim() : w.seed;
  const seed = raw === undefined || raw === null || raw === '' ? Math.floor(Math.random() * 0xffffffff) : Number(raw);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new GameError('La semilla del mundo debe ser un entero entre 0 y 4294967295.');
  const tone = (w.tone || 'grim') as Tone;
  if (!TONES.includes(tone)) throw new GameError(`Tono no válido: ${String(w.tone)} (${TONES.join(' | ')}).`);
  const setting = (w.setting ?? '').trim().replace(/\s+/g, ' ');
  if (setting.length > 300) throw new GameError('La ambientación no puede pasar de 300 caracteres.');
  return { seed, tone, setting };
}

function relPath(from: string, to: string): string {
  return relative(from, to).split('\\').join('/') || '.';
}

function inside(dir: string, p: string): boolean {
  const r = relative(dir, p);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function mtime(p: string): Promise<Date | null> {
  try { return (await stat(p)).mtime; } catch { return null; }
}

/** La última vista de un sitio de images/index.json (los retratos y objetos llevan `kind`; los sitios, no). */
export async function coverOf(dir: string, slug: string): Promise<string | null> {
  let index: Record<string, { file?: string; kind?: string }>;
  try { index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as typeof index; } catch { return null; }
  const last = Object.values(index).filter((x) => !x.kind && x.file).pop();
  return last ? `/images/${last.file}?game=${encodeURIComponent(slug)}` : null;
}

async function countJson(dir: string): Promise<number> {
  try { return (await readdir(dir)).filter((f) => f.endsWith('.json')).length; } catch { return 0; }
}

/** Hasta dónde se lee del final del registro de eventos para la sinopsis (no hace falta el fichero entero). */
const SYNOPSIS_TAIL_BYTES = 96 * 1024;
const SYNOPSIS_MAX_CHARS = 260;

/**
 * Sinopsis para el menú sin abrir la partida (abrirla cambiaría su «jugada hace…»): la última narración del
 * máster del registro de eventos, recortada a una o dos frases. Si aún no hay narración, la última que haya.
 */
export async function synopsisOf(eventsFile: string): Promise<string | null> {
  let text: string;
  try {
    const fh = await openFile(eventsFile, 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - SYNOPSIS_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally { await fh.close(); }
  } catch { return null; }
  let fallback: string | null = null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let ev: { action_type?: string; narration_private?: string | null };
    try { ev = JSON.parse(line) as typeof ev; } catch { continue; }
    const n = typeof ev.narration_private === 'string' ? ev.narration_private.trim() : '';
    if (!n) continue;
    if (ev.action_type === 'master') return clipSynopsis(n);
    fallback ??= n;
  }
  return fallback ? clipSynopsis(fallback) : null;
}

/** Una o dos frases enteras hasta SYNOPSIS_MAX_CHARS; si una sola ya se pasa, se corta en una palabra con «…». */
export function clipSynopsis(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SYNOPSIS_MAX_CHARS) return flat;
  const sentences = flat.match(/[^.!?…]+[.!?…]+[»"”]?\s*/g) ?? [];
  let out = '';
  for (const sen of sentences) {
    if ((out + sen).trim().length > SYNOPSIS_MAX_CHARS) break;
    out += sen;
  }
  if (out.trim()) return out.trim();
  const cut = flat.slice(0, SYNOPSIS_MAX_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '') + '…';
}
