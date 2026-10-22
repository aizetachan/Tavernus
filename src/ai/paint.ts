/**
 * El pincel del jugador: una ilustración de lo que está pasando ahora, a petición
 * (botón de pincel en la web), además de los momentos automáticos de moments.ts.
 *
 * El prompt sale, sin IA y de forma determinista, del último turno del PJ:
 *   - el lugar (nombre, descripción base) y su luz a la hora del turno;
 *   - el punto donde está el PJ y su propio aspecto;
 *   - quién más ve (PJs y NPCs del mismo lugar, por percepción), con su aspecto;
 *   - lo que hizo el jugador y lo que contó el máster, sin diálogo literal;
 *   - la biblia de estilo de la campaña.
 * Ningún id entra en el prompt.
 *
 * Va por la misma cola y caché del ilustrador como una entidad `manual` cuyo id es
 * PJ + seq del evento: repetir el pincel en el mismo turno devuelve la misma imagen
 * sin gastar otra. Límite por PJ (PaintLimits): tantas por día de juego y no más de
 * unas pocas seguidas; con la cuota diaria de Cloudflare agotada no se pinta.
 */

import type { Engine } from '../engine/engine.js';
import type { Character, GameEvent, Id } from '../engine/model.js';
import type { Delivery } from '../engine/events.js';
import { positionOf, type Position } from '../engine/movement.js';
import { lightAt, perceive } from '../engine/perception.js';
import { proseWithout, type DialogueLine } from '../engine/moments.js';
import { GAME_DAY } from '../clock/clock.js';
import { LIGHT_EN, styleBible, type EntityInput } from './illustrate.js';

/** Turnos que no son de la ficción (tiradas, progreso, tablón…): el pincel no los pinta. */
const SYSTEM_TYPES = /^(roll|progress_|announcement|board|admin_|decisive_expired)/;
/** Como mucho tantos presentes en el prompt, los más cercanos. */
const MAX_PRESENT = 5;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t;
}

/**
 * Sin diálogo literal: quita los parlamentos sueltos del cierre (proseWithout) y,
 * además, todo lo que vaya entre comillas o tras raya de diálogo. Sin markdown ni ids.
 */
export function withoutDialogue(text: string, lines: readonly DialogueLine[] = []): string {
  return proseWithout(text, lines)
    .replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, '')
    .replace(/(^|\n)\s*[—–-][^\n]*/g, '$1')
    .replace(/\s—[^—\n]*—/g, '')
    .replace(/\*\*?/g, '')
    .replace(/\b(?:npc|ch|loc|sp|it|ii|ev|zn|rg|ex)_[A-Za-z0-9_]+/g, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,;:]+$/, '')
    .trim();
}

/** Clave del momento en el hilo y id de la entidad en la caché: una por PJ y turno. */
export function paintKey(characterId: Id, seq: number): { key: string; entity_id: Id } {
  return { key: `manual:${characterId}:${seq}`, entity_id: `${characterId}-${seq}` };
}

/** El último turno de la ficción que vivió el PJ (narración del máster o del motor), o null. */
export function lastTurn(engine: Engine, characterId: Id): Delivery | null {
  const ds = engine.events.forCharacter(characterId, null);
  for (let i = ds.length - 1; i >= 0; i--) {
    const d = ds[i]!;
    if (!SYSTEM_TYPES.test(d.event.action_type) && d.text.trim()) return d;
  }
  return null;
}

function looks(c: Character): string {
  return [`${c.name} (${c.race} ${c.class_name})`, c.appearance ? clip(c.appearance, 110) : ''].filter(Boolean).join(': ');
}

/** Quién más ve el PJ en el lugar del turno, del más cercano al más lejano. */
function presentOf(engine: Engine, me: Character, e: GameEvent): string[] {
  const w = engine.world;
  const out: { d: number; text: string }[] = [];
  const add = (at: Position, full: string) => {
    const p = perceive(w, engine.clock, me, at, e.timestamp_game_s);
    if (p.sight === 'full') out.push({ d: p.distance_m ?? 0, text: full });
    else if (p.sight === 'vague') out.push({ d: p.distance_m ?? 0, text: 'a vague figure in the distance' });
  };
  for (const c of w.characters.values()) {
    if (c.id === me.id || c.status === 'dead' || c.status === 'retired' || !w.characterSpot(c)) continue;
    add(positionOf(w, c, e.timestamp_game_s), looks(c));
  }
  for (const n of w.npcs.values()) {
    if (n.status !== 'alive') continue;
    const s = w.spots.get(n.location.id);
    if (!s) continue;
    const known = me.knows.includes(n.id);
    add({ spot_id: s.id, next_spot_id: null, progress: 0, x: s.x, y: s.y, location_id: s.location_id },
      `${known ? `${n.name}, ` : ''}${n.role}: ${clip(n.description, 110)}`);
  }
  return out.sort((a, b) => a.d - b.d).slice(0, MAX_PRESENT).map((x) => x.text);
}

export interface PaintMoment {
  /** El turno pintado. */
  seq: number;
  key: string;
  input: EntityInput;
}

/** Lo que pinta el pincel del PJ ahora: su último turno. null si aún no ha pasado nada. */
export function paintMomentOf(engine: Engine, characterId: Id): PaintMoment | null {
  const w = engine.world;
  const me = w.characters.get(characterId);
  const turn = me ? lastTurn(engine, characterId) : null;
  if (!me || !turn) return null;
  const e = turn.event;
  const loc = w.locations.get(e.location_id);
  if (!loc) return null;
  // El punto: donde está ahora si sigue en ese lugar; si no, donde ocurrió.
  const here = w.characterSpot(me);
  const spot = here?.location_id === loc.id ? here : (e.spot_id ? w.spots.get(e.spot_id) : undefined) ?? null;
  const mine = e.actor_id === characterId;
  const action = mine && e.input_text && !e.input_text.startsWith('(') ? withoutDialogue(e.input_text) : '';
  const lines = Array.isArray(e.payload['lines']) ? e.payload['lines'] as DialogueLine[] : [];
  const what = withoutDialogue(turn.text, lines);
  const present = presentOf(engine, me, e);
  const prompt = [
    `${loc.name} (${loc.indoor ? 'interior' : 'exterior'})`,
    clip(loc.description_base, 200),
    LIGHT_EN[lightAt(engine.clock, loc, e.timestamp_game_s)],
    spot ? `${me.name} stands at ${spot.name}: ${clip(spot.description, 110)}` : '',
    looks(me),
    present.length ? `Also present: ${present.join('; ')}` : '',
    action ? `${me.name} tries to: ${clip(action, 140)}` : '',
    what ? `What happens: ${clip(what, 360)}` : '',
    'the moment as a single wide illustrated scene',
    styleBible(w.campaign),
    'no text, no watermark',
  ].filter(Boolean).join('. ');
  const { key, entity_id } = paintKey(characterId, e.seq);
  return { seq: e.seq, key, input: { kind: 'manual', entity_id, name: spot && spot.name !== loc.name ? `${loc.name} · ${spot.name}` : loc.name, location_id: loc.id, prompt } };
}

/** Día de juego (0, 1, 2…) de un instante. */
export function gameDayOf(gameS: number): number { return Math.floor(gameS / GAME_DAY); }

export interface PaintLimitOptions {
  /** Pinceladas nuevas por PJ y día de juego (por defecto 10). */
  perDay?: number;
  /** Seguidas: como mucho tantas dentro de `burstWindowMs` (por defecto 3 en 10 minutos reales). */
  burst?: number;
  burstWindowMs?: number;
  now?: () => number;
}

export type PaintVerdict = { ok: true; left: number } | { ok: false; text: string; retry_after_s: number | null };

/**
 * Límite del pincel por PJ. Solo cuentan las imágenes nuevas: repetir el pincel en
 * un turno ya pintado sale de la caché y no gasta. En memoria: un reinicio del
 * servidor lo pone a cero (la cuota de Cloudflare sigue mandando).
 */
export class PaintLimits {
  readonly perDay: number;
  readonly burst: number;
  readonly burstWindowMs: number;
  private readonly now: () => number;
  /** Por PJ: día de juego y cuántas lleva; instantes reales de las últimas. */
  private readonly days = new Map<Id, { day: number; used: number }>();
  private readonly recent = new Map<Id, number[]>();

  constructor(opts: PaintLimitOptions = {}) {
    this.perDay = opts.perDay ?? 10;
    this.burst = opts.burst ?? 3;
    this.burstWindowMs = opts.burstWindowMs ?? 10 * 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Cuántas le quedan hoy. */
  left(characterId: Id, day: number): number {
    const d = this.days.get(characterId);
    return this.perDay - (d && d.day === day ? d.used : 0);
  }

  /** ¿Puede pintar otra? Si sí, la cuenta. */
  take(characterId: Id, day: number): PaintVerdict {
    const left = this.left(characterId, day);
    if (left <= 0) return { ok: false, text: `Ya has pintado ${this.perDay} escenas hoy. Mañana (en el juego) tendrás el pincel listo otra vez.`, retry_after_s: null };
    const t = this.now();
    const recent = (this.recent.get(characterId) ?? []).filter((x) => t - x < this.burstWindowMs);
    if (recent.length >= this.burst) {
      const wait = Math.ceil((recent[0]! + this.burstWindowMs - t) / 1000);
      const min = Math.max(1, Math.ceil(wait / 60));
      return { ok: false, text: `${this.burst} pinceladas seguidas: deja que se seque la pintura. Podrás pintar otra en ${min} min.`, retry_after_s: wait };
    }
    recent.push(t);
    this.recent.set(characterId, recent);
    this.days.set(characterId, { day, used: this.perDay - left + 1 });
    return { ok: true, left: left - 1 };
  }

  /** Devuelve una que no llegó a pintarse (falló la generación). */
  refund(characterId: Id, day: number): void {
    const d = this.days.get(characterId);
    if (d && d.day === day && d.used > 0) d.used--;
    const recent = this.recent.get(characterId);
    if (recent?.length) recent.pop();
  }
}
