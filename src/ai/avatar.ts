/**
 * Avatar del PJ: el retrato con que aparece en el hilo, hecho por el ilustrador
 * (misma cola, caché e índice que el resto de imágenes) y en manos del jugador.
 *
 *   - Al crear el PJ desde el menú se pinta la versión 1 con nombre, raza, clase,
 *     su aspecto si lo escribió y la biblia de estilo. Es el mismo retrato que el
 *     de `portraitOf` (misma entidad, misma clave): no se pide dos veces.
 *   - «Otro» pinta una versión nueva. Cloudflare no admite seed, así que la
 *     variación va en el prompt: una pose y una luz o atuendo que salen del número
 *     de versión (determinista; distinto en cada una).
 *   - «Descríbelo»: el texto del jugador pasa a ser su `appearance` (también lo usa
 *     la narración) y entra en el prompt entre la raza y clase y la biblia de estilo,
 *     que siempre van.
 *
 * Cada versión es una entidad propia del ilustrador (`<pj>~v<n>`, salvo la 1, que es
 * el propio PJ); la elegida se fija con `Illustrator.pin`, así que el cast del
 * stream, los parlamentos y cualquier adjunto la usan sin saber de versiones.
 * Lo del jugador vive en <dir>/avatars.json: versiones (como mucho MAX_VERSIONS),
 * la elegida y cuántas lleva pedidas hoy (día UTC, el de la cuota de Cloudflare).
 * La primera no cuenta; las demás, AVATAR_DAILY_LIMIT por PJ y AVATAR_GAME_DAILY_LIMIT
 * por partida, y de una en una.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine } from '../engine/engine.js';
import type { Character, Id } from '../engine/model.js';
import { entityKey, styleBible, type EntityInput, type Illustrator, type SceneImage } from './illustrate.js';

export const AVATAR_DAILY_LIMIT = 6;
export const AVATAR_GAME_DAILY_LIMIT = 24;
export const MAX_VERSIONS = 8;
/** Lo que se guarda del texto del jugador. */
export const MAX_LOOK = 300;

const POSES = [
  'three-quarter view, looking slightly aside', 'looking over the shoulder', 'chin raised, proud bearing', 'faint smile, relaxed',
  'stern gaze straight at the viewer', 'head tilted, curious expression', 'determined look, hair stirred by the wind',
];
const LOOKS = ['warm candlelight from the side', 'cool moonlit rim light', 'hooded travel cloak', 'weathered leather and buckles', 'golden evening glow'];

/** Lo que distingue a la versión `v` (>1): una pose y, si no es una descripción del jugador, una luz o atuendo. */
export function avatarVariation(version: number, described = false): string {
  if (version <= 1) return '';
  const i = version - 2;
  const pose = POSES[i % POSES.length]!;
  return described ? pose : `${pose}, ${LOOKS[i % LOOKS.length]}`;
}

/** Texto del jugador limpio: sin controles ni llaves, espacios juntos y como mucho MAX_LOOK caracteres. */
export function cleanLook(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f<>{}[\]\\|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LOOK).trim();
}

/** Prompt del avatar: quién es, cómo se ve, la variación de su versión, el encuadre y la biblia de estilo, en ese orden. */
export function avatarPrompt(p: { name: string; race: string; class_name: string; look: string }, style: string, opts: { version: number; described?: boolean }): string {
  const look = cleanLook(p.look).replace(/[.\s]+$/, '');
  return [
    `Portrait of ${p.name}, ${p.race} ${p.class_name}`, look, avatarVariation(opts.version, opts.described),
    opts.version <= 1 ? 'head and shoulders, facing the viewer, dark plain background' : 'head and shoulders, dark plain background',
    style, 'no text, no watermark',
  ].filter(Boolean).join('. ');
}

/** Entidad del ilustrador para la versión `v` del avatar de un PJ (la 1 es el propio PJ: comparte retrato con `portraitOf`). */
export function versionEntity(characterId: Id, v: number): Id {
  return v <= 1 ? characterId : `${characterId}~v${v}`;
}

export type AvatarSource = 'auto' | 'regenerate' | 'describe';
export interface AvatarVersion { v: number; entity_id: Id; source: AvatarSource; look: string; prompt: string; created_at: string; file: string | null }
interface AvatarRecord { chosen: number; next: number; day: string; used: number; versions: AvatarVersion[] }
interface AvatarFile { day: string; used: number; characters: Record<Id, AvatarRecord> }

export interface AvatarView {
  character_id: Id;
  chosen: number;
  /** Versión que se está pintando (una cada vez). */
  pending: number | null;
  /** Lo último que falló, para decírselo al jugador. */
  error: string | null;
  used: number;
  limit: number;
  left: number;
  versions: { v: number; file: string | null; source: AvatarSource; look: string; chosen: boolean }[];
}

export type AvatarResult = { ok: true; view: AvatarView } | { ok: false; status: number; text: string };

export interface AvatarOptions {
  /** Directorio de imágenes de la partida (el del ilustrador). */
  dir: string;
  now?: () => number;
  limit?: number;
  gameLimit?: number;
  log?: (msg: string) => void;
}

/** Día UTC: el contador se reinicia con la cuota de Cloudflare. */
function dayOf(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

export class AvatarStudio {
  private data: AvatarFile = { day: '', used: 0, characters: {} };
  private readonly pending = new Map<Id, { v: number; done: Promise<void> }>();
  private readonly errors = new Map<Id, string>();
  /** Imagen de cada versión por entidad. */
  private readonly images = new Map<Id, SceneImage>();
  private write: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  readonly limit: number;
  readonly gameLimit: number;
  private readonly log: (msg: string) => void;
  readonly ready: Promise<void>;

  constructor(private readonly engine: Engine, private readonly ill: Illustrator, private readonly opts: AvatarOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.limit = opts.limit ?? AVATAR_DAILY_LIMIT;
    this.gameLimit = opts.gameLimit ?? AVATAR_GAME_DAILY_LIMIT;
    this.log = opts.log ?? ((m) => console.log(m));
    // Un retrato que llega por otro camino (el cast lo encarga al abrir el stream) también es su versión.
    ill.onEntity((r) => {
      if (r.image.kind !== 'portrait') return;
      for (const rec of Object.values(this.data.characters)) {
        const v = rec.versions.find((x) => isVersionImage(r.image, x.entity_id));
        if (v) this.images.set(v.entity_id, r.image);
        if (v && !v.file) { v.file = r.image.file; void this.save(); }
      }
    });
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(join(this.opts.dir, 'avatars.json'), 'utf8')) as AvatarFile;
      if (raw && typeof raw === 'object' && raw.characters) this.data = { day: raw.day ?? '', used: raw.used ?? 0, characters: raw.characters };
    } catch { /* sin avatares todavía */ }
    await this.ill.load();
    for (const [id, rec] of Object.entries(this.data.characters)) {
      // Antes de fijar nada: luego el ilustrador ya solo da la fijada.
      for (const v of rec.versions) v.file = this.rawImage(v.entity_id)?.file ?? v.file;
      // Lo que quedó a medias al apagar el servidor se descarta (la 1 se vuelve a pedir con `ensure`).
      rec.versions = rec.versions.filter((v) => v.file || v.v === 1);
      if (!rec.versions.some((v) => v.v === rec.chosen && v.file)) rec.chosen = rec.versions.find((v) => v.file)?.v ?? 1;
      this.pinChosen(id, rec);
    }
  }

  /** Imagen ya hecha de esa entidad, sin la versión fijada encima (una vez fijada otra, el ilustrador ya no la da). */
  private rawImage(entityId: Id): SceneImage | null {
    const known = this.images.get(entityId);
    if (known) return known;
    const img = this.ill.entityImage('portrait', entityId);
    if (!img || !isVersionImage(img, entityId)) return null;
    this.images.set(entityId, img);
    return img;
  }

  private pinChosen(characterId: Id, rec: AvatarRecord): void {
    const v = rec.versions.find((x) => x.v === rec.chosen);
    const img = v?.file ? this.rawImage(v.entity_id) : null;
    if (img) this.ill.pin('portrait', characterId, img);
  }

  private save(): Promise<void> {
    const out = async () => {
      await mkdir(this.opts.dir, { recursive: true });
      await writeFile(join(this.opts.dir, 'avatars.json'), JSON.stringify(this.data, null, 2), 'utf8');
    };
    this.write = this.write.then(out, out);
    return this.write;
  }

  private character(id: Id): Character | null {
    const c = this.engine.world.characters.get(id);
    return c && c.status !== 'retired' ? c : null;
  }

  /** Registro del PJ; las partidas de antes de los avatares ya pueden tener su retrato: esa es la versión 1. */
  private record(c: Character): AvatarRecord {
    let rec = this.data.characters[c.id];
    if (!rec) {
      const img = this.rawImage(c.id);
      rec = {
        chosen: 1, next: 2, day: '', used: 0,
        versions: [{ v: 1, entity_id: c.id, source: 'auto', look: c.appearance, prompt: img?.prompt ?? '', created_at: new Date(this.now()).toISOString(), file: img?.file ?? null }],
      };
      this.data.characters[c.id] = rec;
    }
    const today = dayOf(this.now());
    if (rec.day !== today) { rec.day = today; rec.used = 0; }
    if (this.data.day !== today) { this.data.day = today; this.data.used = 0; }
    return rec;
  }

  view(characterId: Id): AvatarView | null {
    const c = this.character(characterId);
    if (!c) return null;
    const rec = this.record(c);
    return {
      character_id: c.id, chosen: rec.chosen, pending: this.pending.get(c.id)?.v ?? null, error: this.errors.get(c.id) ?? null,
      used: rec.used, limit: this.limit, left: Math.max(0, Math.min(this.limit - rec.used, this.gameLimit - this.data.used)),
      versions: rec.versions.map((v) => ({ v: v.v, file: v.file, source: v.source, look: v.look, chosen: v.v === rec.chosen })),
    };
  }

  /** La versión 1 del PJ recién creado (no cuenta para el límite). No espera a la imagen. */
  async ensure(characterId: Id): Promise<void> {
    await this.ready;
    const c = this.character(characterId);
    if (!c) return;
    const rec = this.record(c);
    const first = rec.versions.find((v) => v.v === 1);
    if (!first || first.file || this.pending.has(c.id)) return;
    first.look = c.appearance;
    first.prompt = avatarPrompt({ name: c.name, race: c.race, class_name: c.class_name, look: c.appearance }, styleBible(this.engine.world.campaign), { version: 1 });
    this.start(c, rec, first, false);
    await this.save();
  }

  /** «Otro»: una versión nueva con la variación que le toca. */
  async regenerate(characterId: Id): Promise<AvatarResult> {
    return this.generate(characterId, null);
  }

  /** «Descríbelo»: el texto pasa a ser su aspecto y se pinta una versión con él. */
  async describe(characterId: Id, text: string): Promise<AvatarResult> {
    const look = cleanLook(text);
    if (look.length < 3) return { ok: false, status: 400, text: 'Escribe cómo quieres que se vea tu personaje (unas pocas palabras bastan).' };
    return this.generate(characterId, look);
  }

  async choose(characterId: Id, v: number): Promise<AvatarResult> {
    await this.ready;
    const c = this.character(characterId);
    if (!c) return { ok: false, status: 404, text: 'Ese personaje no existe.' };
    const rec = this.record(c);
    const version = rec.versions.find((x) => x.v === v);
    if (!version?.file) return { ok: false, status: 404, text: 'Esa versión del retrato no existe o aún no está pintada.' };
    rec.chosen = v;
    this.pinChosen(c.id, rec);
    await this.save();
    return { ok: true, view: this.view(c.id)! };
  }

  /** Espera a que acabe lo que se esté pintando para ese PJ (tests y comprobaciones). */
  async settled(characterId: Id): Promise<void> {
    await this.ready;
    await this.pending.get(characterId)?.done;
  }

  private async generate(characterId: Id, look: string | null): Promise<AvatarResult> {
    await this.ready;
    const c = this.character(characterId);
    if (!c) return { ok: false, status: 404, text: 'Ese personaje no existe.' };
    const rec = this.record(c);
    if (this.pending.has(c.id)) return { ok: false, status: 409, text: 'Ya se está pintando un retrato; espera a que llegue.' };
    if (rec.used >= this.limit) return { ok: false, status: 429, text: `Ya has pedido ${this.limit} retratos hoy. Mañana podrás pedir más (el contador se reinicia a medianoche UTC).` };
    if (this.data.used >= this.gameLimit) return { ok: false, status: 429, text: `Esta partida ya ha pedido ${this.gameLimit} retratos hoy; hay que esperar a mañana (medianoche UTC).` };
    if (look !== null) {
      c.appearance = look;
      this.engine.world.touch('characters', c.id);
    }
    const v = rec.next++;
    const version: AvatarVersion = {
      v, entity_id: versionEntity(c.id, v), source: look !== null ? 'describe' : 'regenerate', look: c.appearance,
      prompt: avatarPrompt({ name: c.name, race: c.race, class_name: c.class_name, look: c.appearance }, styleBible(this.engine.world.campaign), { version: v, described: look !== null }),
      created_at: new Date(this.now()).toISOString(), file: null,
    };
    rec.versions.push(version);
    rec.used++;
    this.data.used++;
    // Las más viejas salen de la lista (nunca la elegida ni la 1, que es el retrato de base).
    while (rec.versions.length > MAX_VERSIONS) {
      const i = rec.versions.findIndex((x) => x.v !== rec.chosen && x.v !== 1 && x !== version);
      if (i < 0) break;
      rec.versions.splice(i, 1);
    }
    this.start(c, rec, version, true);
    await this.save();
    return { ok: true, view: this.view(c.id)! };
  }

  /** Pide la imagen sin esperarla; al llegar pasa a ser la elegida. Si falla, se devuelve la petición al contador. */
  private start(c: Character, rec: AvatarRecord, version: AvatarVersion, counted: boolean): void {
    this.errors.delete(c.id);
    const loc = this.engine.world.characterSpot(c)?.location_id ?? '';
    const input: EntityInput = { kind: 'portrait', entity_id: version.entity_id, name: c.name, location_id: loc, prompt: version.prompt };
    const done = this.ill.illustrateEntity(input).then(async (img) => {
      if (img && isVersionImage(img, version.entity_id)) {
        version.file = img.file;
        this.images.set(version.entity_id, img);
        if (version.v !== 1 || rec.chosen === 1) { rec.chosen = version.v; this.pinChosen(c.id, rec); }
      } else {
        rec.versions = rec.versions.filter((x) => x !== version || x.v === 1);
        if (counted) { rec.used = Math.max(0, rec.used - 1); this.data.used = Math.max(0, this.data.used - 1); }
        this.errors.set(c.id, 'No se pudo pintar el retrato ahora; inténtalo dentro de un rato (no se ha contado).');
        this.log(`[avatar] ${c.name} v${version.v}: sin imagen`);
      }
      await this.save();
    }).finally(() => { if (this.pending.get(c.id)?.done === done) this.pending.delete(c.id); });
    this.pending.set(c.id, { v: version.v, done });
  }
}

/** ¿Es esta imagen el retrato de esa entidad (y no otra versión fijada encima)? */
function isVersionImage(img: SceneImage, entityId: Id): boolean {
  const prefix = entityKey('portrait', entityId, 0).replace(/0$/, '');
  return img.key.startsWith(prefix) && /^\d+$/.test(img.key.slice(prefix.length));
}

const attached = new WeakMap<Engine, AvatarStudio>();

/** El estudio de avatares de ese motor (solo con ilustraciones activas). */
export function avatarsOf(engine: Engine): AvatarStudio | null {
  return attached.get(engine) ?? null;
}

export function attachAvatars(engine: Engine, ill: Illustrator, opts: AvatarOptions): AvatarStudio {
  const studio = new AvatarStudio(engine, ill, opts);
  attached.set(engine, studio);
  return studio;
}
