/**
 * Log de eventos (SPEC §6) y entrega por punto de vista (SPEC §9.6, §11.2).
 *
 * Cada evento es inmutable. El servidor calcula quién lo percibe y con qué
 * banda; a cada PJ le llega solo lo que puede percibir. No hay canal de
 * localización.
 */

import type { GameClock } from '../clock/clock.js';
import type { Character, GameEvent, Id, PerceptionLevel, Visibility } from './model.js';
import { positionOf, type Position } from './movement.js';
import { witnesses } from './perception.js';
import { maskUnknownNames } from './narrate.js';
import type { World } from './world.js';

export interface EmitInput {
  actor_id: Id | null;
  /** Dónde ocurre. Si falta, se toma la posición del actor. */
  at?: Position;
  action_type: string;
  input_text?: string | null;
  narration_private: string;
  observable?: string | null;
  visibility?: Visibility;
  tags?: string[];
  /** Volumen relativo (1 conversación, 0.2 susurro, 5 grito, 15 campanas). */
  loudness?: number;
  /** Por qué sentido se percibe: el habla por el oído, un gesto por la vista, lo demás por cualquiera. */
  channel?: 'sight' | 'sound' | 'any';
  payload?: Record<string, unknown>;
  /** Fuerza la entrega a estos PJs con nivel `full` (p. ej. el objetivo de un intercambio). */
  also_to?: Id[];
}

export interface Delivery {
  event: GameEvent;
  character_id: Id;
  level: PerceptionLevel;
  /** Texto que ve ese PJ. */
  text: string;
}

export type DeliveryListener = (d: Delivery) => void;
export type EventListener = (e: GameEvent) => void;

export class EventLog {
  private seq = 0;
  private events: GameEvent[] = [];
  private deliveryListeners: DeliveryListener[] = [];
  private eventListeners: EventListener[] = [];

  constructor(private readonly world: World, private readonly clock: GameClock, lastSeq = 0) {
    this.seq = lastSeq;
  }

  onDelivery(l: DeliveryListener): () => void {
    this.deliveryListeners.push(l);
    return () => { this.deliveryListeners = this.deliveryListeners.filter((x) => x !== l); };
  }

  /** Para persistir cada evento tal cual. */
  onEvent(l: EventListener): () => void {
    this.eventListeners.push(l);
    return () => { this.eventListeners = this.eventListeners.filter((x) => x !== l); };
  }

  get lastSeq(): number { return this.seq; }

  all(): readonly GameEvent[] { return this.events; }

  /** Eventos que un PJ percibió después de `sinceEventId` (para /recap). */
  forCharacter(characterId: Id, sinceEventId: Id | null = null): Delivery[] {
    let started = sinceEventId === null;
    const out: Delivery[] = [];
    for (const e of this.events) {
      if (!started) { if (e.id === sinceEventId) started = true; continue; }
      const d = e.delivered_to.find((x) => x.character_id === characterId);
      if (!d) continue;
      let text = textFor(e, characterId, d.level);
      if (text && characterId !== e.actor_id) text = maskUnknownNames(this.world, characterId, text);
      if (text) out.push({ event: e, character_id: characterId, level: d.level, text });
    }
    return out;
  }

  recentInLocation(locationId: Id, n: number): GameEvent[] {
    return this.events.filter((e) => e.location_id === locationId).slice(-n);
  }

  emit(input: EmitInput, realMs: number = Date.now()): GameEvent {
    const nowGameS = this.clock.gameNow(realMs);
    const actor = input.actor_id ? this.world.characters.get(input.actor_id) ?? null : null;
    const at = input.at ?? (actor ? positionOf(this.world, actor, nowGameS) : null);
    if (!at) throw new Error('emit: need `at` or an actor with position');
    const visibility = input.visibility ?? 'location';

    const delivered = new Map<Id, PerceptionLevel>();
    if (actor) delivered.set(actor.id, 'full');
    for (const id of input.also_to ?? []) delivered.set(id, 'full');

    if (visibility === 'public') {
      for (const c of this.world.characters.values()) {
        if (c.status !== 'dead' && c.status !== 'retired' && !delivered.has(c.id)) delivered.set(c.id, 'full');
      }
    } else if (visibility === 'location') {
      const channel = input.channel ?? 'any';
      for (const w of witnesses(this.world, this.clock, at, nowGameS, input.loudness ?? 1, actor?.id)) {
        const level = channel === 'sight' ? w.perceived.sight : channel === 'sound' ? w.perceived.sound : w.perceived.level;
        if (level !== 'none' && !delivered.has(w.character.id)) delivered.set(w.character.id, level);
      }
    }

    this.seq += 1;
    const event: GameEvent = {
      id: `ev_${this.seq.toString(36).padStart(8, '0')}`,
      seq: this.seq,
      timestamp_real_ms: realMs,
      timestamp_game_s: nowGameS,
      campaign_id: this.world.campaign.id,
      location_id: at.location_id,
      spot_id: at.spot_id,
      actor_id: input.actor_id,
      action_type: input.action_type,
      input_text: input.input_text ?? null,
      narration_private: input.narration_private,
      observable: input.observable ?? null,
      visibility,
      tags: input.tags ?? [],
      delivered_to: [...delivered].map(([character_id, level]) => ({ character_id, level })),
      payload: input.payload ?? {},
    };
    this.events.push(event);
    for (const l of this.eventListeners) l(event);

    for (const [character_id, level] of delivered) {
      let text = textFor(event, character_id, level);
      if (!text) continue;
      if (character_id !== event.actor_id) text = maskUnknownNames(this.world, character_id, text);
      const d: Delivery = { event, character_id, level, text };
      for (const l of this.deliveryListeners) l(d);
      // Solo cuenta como "visto" si el jugador está conectado (SPEC §4.4, /recap al volver).
      const c = this.world.characters.get(character_id);
      if (c && c.connected) { c.last_seen_event_id = event.id; }
    }
    return event;
  }
}

/**
 * Texto que recibe cada PJ según su banda. El actor ve su narración privada;
 * un testigo en `full` ve lo observable; en `vague` una versión sin identidad;
 * en `hint` solo que algo pasa.
 */
export function textFor(e: GameEvent, characterId: Id, level: PerceptionLevel): string | null {
  if (e.actor_id === characterId) return e.narration_private;
  if (e.visibility === 'public') return e.observable ?? e.narration_private;
  if (e.observable === null) return null;
  switch (level) {
    case 'full': return e.observable;
    case 'vague': return typeof e.payload['observable_vague'] === 'string' ? (e.payload['observable_vague'] as string) : 'Una figura hace algo a lo lejos.';
    case 'hint': return typeof e.payload['observable_hint'] === 'string' ? (e.payload['observable_hint'] as string) : 'Notas movimiento en la distancia.';
    case 'none': return null;
  }
}

export function characterLabel(c: Character, level: PerceptionLevel): string {
  return level === 'full' ? c.name : 'alguien';
}
