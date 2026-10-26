/**
 * Presencia en tiempo real de la web (docs/MULTIJUGADOR.md, «Presencia»).
 *
 * Cada pestaña abierta tiene su id (lo pone la página) y cuenta mientras su stream
 * SSE siga abierto y la página dé señales: un latido cada HEARTBEAT_MS mientras se
 * ve, «oculta» al cambiar de pestaña o de app y «me voy» al cerrarse. Detrás de un
 * proxy o en el móvil el stream puede quedarse abierto con el jugador ya ido; el
 * latido y la pestaña oculta lo destapan sin esperar a que nadie actúe.
 *
 * Un PJ está en línea si alguna de sus pestañas cuenta. Al dejar de contar la
 * última, pasa el margen de gracia antes de darle por ido: una recarga o un corte
 * corto del stream (EventSource reconecta con el mismo id) no parpadea.
 */
import type { Id } from '../../engine/model.js';

export interface PresenceTiming {
  /** Margen sin pestañas que cuenten antes de darle por ido. */
  graceMs: number;
  /** Sin latido durante esto, la pestaña visible deja de contar (stream colgado tras un proxy). */
  staleMs: number;
  /** Oculta durante esto, deja de contar (cambió de pestaña o de app y no vuelve). */
  hiddenMs: number;
}

/** Cada cuánto late una pestaña visible (page.ts). */
export const HEARTBEAT_MS = 15_000;
export const PRESENCE_TIMING: PresenceTiming = { graceMs: 20_000, staleMs: 3 * HEARTBEAT_MS, hiddenMs: 60_000 };

interface Tab {
  /** Streams abiertos de esta pestaña (al reconectar, el nuevo puede abrirse antes de que se cierre el viejo). */
  streams: number;
  closedAt: number | null;
  /** Último latido (o apertura del stream). */
  seen: number;
  hiddenSince: number | null;
  /** La página avisó al cerrarse (pagehide). */
  goneAt: number | null;
  /** Late (page.ts); una página de antes del latido solo cuenta por su stream. */
  beats: boolean;
}

export class PresenceTracker {
  private readonly tabs = new Map<Id, Map<string, Tab>>();
  private readonly shown = new Set<Id>();
  private readonly timers = new Map<Id, NodeJS.Timeout>();
  /** Partida cerrada: los streams que se cierran después ya no avisan a nadie. */
  private disposed = false;

  /** onChange: entra (en el acto) o se va (pasada la gracia). */
  constructor(
    private readonly timing: PresenceTiming,
    private readonly onChange: (id: Id, online: boolean) => void,
    private readonly now: () => number = Date.now,
  ) {}

  online(id: Id): boolean { return this.shown.has(id); }

  /** Se abre un stream de esa pestaña; beats=false si la página no late (anterior al latido). */
  open(id: Id, tab: string, beats = true): void {
    const tabs = this.tabs.get(id) ?? new Map<string, Tab>();
    this.tabs.set(id, tabs);
    const t = tabs.get(tab) ?? { streams: 0, closedAt: null, seen: 0, hiddenSince: null, goneAt: null, beats };
    tabs.set(tab, t);
    t.streams++;
    t.closedAt = null;
    t.goneAt = null;
    t.seen = this.now();
    this.check(id);
  }

  /** Se cierra un stream de esa pestaña (lo cerró el navegador o se cayó la conexión). */
  close(id: Id, tab: string): void {
    const t = this.tabs.get(id)?.get(tab);
    if (!t) return;
    t.streams = Math.max(0, t.streams - 1);
    if (!t.streams) t.closedAt = this.now();
    this.check(id);
  }

  /** Latido de la página: visible u oculta. Una pestaña que no tiene stream no cuenta por latir. */
  beat(id: Id, tab: string, visible: boolean): void {
    const t = this.tabs.get(id)?.get(tab);
    if (!t) return;
    t.seen = this.now();
    t.goneAt = null;
    t.hiddenSince = visible ? null : t.hiddenSince ?? this.now();
    this.check(id);
  }

  /** La página se cierra (pagehide): deja de contar ya, aunque el stream tarde en cerrarse tras el proxy. */
  gone(id: Id, tab: string): void {
    const t = this.tabs.get(id)?.get(tab);
    if (!t) return;
    t.goneAt = this.now();
    this.check(id);
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Cuándo dejó (o dejará) de contar una pestaña. */
  private lostAt(t: Tab): number {
    const at = [t.hiddenSince !== null ? t.hiddenSince + this.timing.hiddenMs : t.beats ? t.seen + this.timing.staleMs : Infinity];
    if (!t.streams && t.closedAt !== null) at.push(t.closedAt);
    if (t.goneAt !== null) at.push(t.goneAt);
    return Math.min(...at);
  }

  private check(id: Id): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.disposed) return;
    const now = this.now();
    const tabs = this.tabs.get(id) ?? new Map<string, Tab>();
    let live = false, next = Infinity, lost = -Infinity;
    for (const t of tabs.values()) {
      const at = this.lostAt(t);
      if (at > now) { live = true; next = Math.min(next, at); } else lost = Math.max(lost, at);
    }
    if (live) {
      if (!this.shown.has(id)) { this.shown.add(id); this.onChange(id, true); }
      this.later(id, next - now);
      return;
    }
    const offAt = lost + this.timing.graceMs;
    if (this.shown.has(id) && now < offAt) { this.later(id, offAt - now); return; }
    // Las pestañas sin stream ya no vuelven (una nueva abre stream); las colgadas sí, si vuelven a latir.
    for (const [k, t] of tabs) if (!t.streams) tabs.delete(k);
    if (!tabs.size) this.tabs.delete(id);
    if (this.shown.delete(id)) this.onChange(id, false);
  }

  private later(id: Id, ms: number): void {
    // Solo pestañas sin plazo (no laten y siguen abiertas): nada que vigilar hasta que cambien.
    if (!Number.isFinite(ms)) return;
    const t = setTimeout(() => { this.timers.delete(id); this.check(id); }, Math.max(0, ms) + 1);
    t.unref?.();
    this.timers.set(id, t);
  }
}
