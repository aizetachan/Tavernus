import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENCE_TIMING, PresenceTracker } from '../src/adapters/web/presence.js';

const T = { graceMs: 20_000, staleMs: 45_000, hiddenMs: 4 * 60_000 };

/** Un tracker con reloj falso y la lista de cambios que avisa. */
function tracker() {
  const changes: string[] = [];
  const p = new PresenceTracker(T, (id, online) => changes.push(`${id}:${online ? 'entra' : 'se va'}`));
  return { p, changes };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('presencia en tiempo real (presence.ts)', () => {
  it('entra en el acto al abrir el stream; al cerrarlo, se va pasada la gracia', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    expect(changes).toEqual(['mira:entra']);
    expect(p.online('mira')).toBe(true);
    p.close('mira', 'a');
    vi.advanceTimersByTime(T.graceMs - 1000);
    expect(p.online('mira')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
    expect(p.online('mira')).toBe(false);
  });

  it('una reconexión corta (recarga, corte del stream) no parpadea', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    p.close('mira', 'a');
    vi.advanceTimersByTime(5000);
    p.open('mira', 'a'); // EventSource reconecta con el mismo id
    vi.advanceTimersByTime(T.graceMs * 3);
    p.close('mira', 'a');
    p.open('mira', 'b'); // recarga: otra pestaña nueva
    vi.advanceTimersByTime(T.graceMs * 2);
    expect(changes).toEqual(['mira:entra']);
  });

  it('el stream nuevo se abre antes de que se cierre el viejo: sigue en línea', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    p.open('mira', 'a');
    p.close('mira', 'a');
    vi.advanceTimersByTime(T.graceMs * 2);
    expect(changes).toEqual(['mira:entra']);
    expect(p.online('mira')).toBe(true);
  });

  it('stream colgado tras un proxy: sin latido se va; si vuelve a latir, vuelve', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(15_000); p.beat('mira', 'a', true); }
    expect(p.online('mira')).toBe(true);
    // Deja de latir (el móvil se apaga, el portátil se duerme); el stream sigue «abierto».
    vi.advanceTimersByTime(T.staleMs + T.graceMs - 1000);
    expect(p.online('mira')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
    p.beat('mira', 'a', true);
    expect(changes).toEqual(['mira:entra', 'mira:se va', 'mira:entra']);
  });

  it('pestaña oculta: cuenta un rato; si sigue oculta, se va; al verse otra vez, vuelve', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    p.beat('mira', 'a', false);
    // Oculta no late: no se la da por colgada, manda el tiempo oculta.
    vi.advanceTimersByTime(T.hiddenMs - 1000);
    p.beat('mira', 'a', true);
    vi.advanceTimersByTime(T.graceMs * 2);
    expect(changes).toEqual(['mira:entra']);
    p.beat('mira', 'a', false);
    vi.advanceTimersByTime(30_000);
    p.beat('mira', 'a', false); // otro latido oculta no reinicia la cuenta
    vi.advanceTimersByTime(T.hiddenMs - 30_000 + T.graceMs + 1000);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
    p.beat('mira', 'a', true);
    expect(changes).toEqual(['mira:entra', 'mira:se va', 'mira:entra']);
  });

  it('al cerrar la página (pagehide) se va pasada la gracia aunque el stream siga abierto', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    p.gone('mira', 'a');
    vi.advanceTimersByTime(T.graceMs + 1000);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
    // El stream se cierra luego: ya estaba ida, no hay más avisos.
    p.close('mira', 'a');
    vi.advanceTimersByTime(T.graceMs * 2);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
  });

  it('con dos pestañas, cerrar una no la saca; un latido sin stream no la mete', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    p.open('mira', 'b');
    p.close('mira', 'a');
    vi.advanceTimersByTime(T.graceMs * 2);
    p.beat('mira', 'b', true);
    expect(changes).toEqual(['mira:entra']);
    p.close('mira', 'b');
    vi.advanceTimersByTime(T.graceMs + 1000);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
    p.beat('mira', 'b', true);
    p.beat('tor', 'x', true);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
  });

  it('una página de antes del latido cuenta mientras su stream siga abierto', () => {
    const { p, changes } = tracker();
    p.open('mira', 'viejo', false);
    vi.advanceTimersByTime(T.staleMs * 10);
    expect(changes).toEqual(['mira:entra']);
    p.close('mira', 'viejo');
    vi.advanceTimersByTime(T.graceMs + 1000);
    expect(changes).toEqual(['mira:entra', 'mira:se va']);
  });

  it('por defecto, un vistazo a otra app no es irse: oculta 30 s y visible otra vez, sin cambios', () => {
    expect(PRESENCE_TIMING.hiddenMs).toBeGreaterThanOrEqual(3 * 60_000);
    const changes: string[] = [];
    const p = new PresenceTracker(PRESENCE_TIMING, (id, online) => changes.push(`${id}:${online ? 'entra' : 'se va'}`));
    p.open('maikol', 'a');
    p.beat('maikol', 'a', false);
    vi.advanceTimersByTime(30_000);
    p.beat('maikol', 'a', true);
    vi.advanceTimersByTime(PRESENCE_TIMING.graceMs * 3);
    expect(changes).toEqual(['maikol:entra']);
  });

  it('el móvil oculto pierde el stream y no latía: el corte del stream no lo saca antes de hiddenMs', () => {
    // El caso del 2026-11-04: pantalla apagada, el navegador cierra el stream; con la pestaña oculta 80 s ya se iba.
    const { p, changes } = tracker();
    p.open('maikol', 'a');
    p.beat('maikol', 'a', false);
    p.close('maikol', 'a');
    vi.advanceTimersByTime(T.hiddenMs - 1000);
    expect(p.online('maikol')).toBe(true);
    // Vuelve a mirar: la página late «visible» en el acto y EventSource reconecta (mismo id) unos segundos después.
    // El corte de antes no cuenta desde cuando se cortó: si lo hiciera, aquí ya se iría y al reabrir volvería a entrar.
    p.beat('maikol', 'a', true);
    vi.advanceTimersByTime(3_000);
    expect(changes).toEqual(['maikol:entra']);
    p.open('maikol', 'a');
    p.beat('maikol', 'a', true);
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(15_000); p.beat('maikol', 'a', true); }
    expect(changes).toEqual(['maikol:entra']);
    // Y si no vuelve en todo ese rato, se va (hiddenMs más la gracia) y al volver entra una sola vez.
    p.beat('maikol', 'a', false);
    p.close('maikol', 'a');
    vi.advanceTimersByTime(T.hiddenMs + T.graceMs + 1000);
    expect(changes).toEqual(['maikol:entra', 'maikol:se va']);
    p.open('maikol', 'a');
    expect(changes).toEqual(['maikol:entra', 'maikol:se va', 'maikol:entra']);
  });

  it('cada PJ va por su cuenta', () => {
    const { p, changes } = tracker();
    p.open('mira', 'a');
    p.open('tor', 'b');
    p.close('tor', 'b');
    vi.advanceTimersByTime(T.graceMs + 1000);
    expect(changes).toEqual(['mira:entra', 'tor:entra', 'tor:se va']);
    expect(p.online('mira')).toBe(true);
  });
});
