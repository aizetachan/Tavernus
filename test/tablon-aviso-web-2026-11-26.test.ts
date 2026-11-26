/**
 * Arreglo 42, parte de la web (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete H; patrón 12): el evento `board` que
 * emite el motor al rotar el tablón (`engine.ts` onDay) lleva hoy de `observable` la lista entera («📜 Tablón de
 * Brezal, 00:00:» y viñetas «•»). La web no la pinta como texto del máster: sale un aviso de una línea que lleva al
 * Tablón, en directo y en el historial, diga lo que diga el observable (lo cambia el paquete E).
 */
import { describe, expect, it } from 'vitest';
import { noticeOf } from '../src/adapters/web/notice.js';
import { toMessage } from '../src/adapters/web/server.js';
import type { Delivery } from '../src/engine/events.js';
import { bootEngine } from './helpers.js';

describe('arreglo 42: el tablón en la web es un aviso, no narración', () => {
  it('el evento board, con la lista de hoy o con el aviso corto de mañana, llega como aviso al Tablón', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    engine.setPresence(kael.id, true);
    const seen: Delivery[] = [];
    engine.onDelivery((d) => { if (d.character_id === kael.id) seen.push(d); });
    for (const observable of [
      '📜 Tablón de Brezal, 00:00:\n• **Leña para el Jabalí** — Diez haces de leña seca. (6 de plata; lo pide Brenna)\n• **Bayas** — Un cesto. (2 de plata; lo pide Ilse)',
      'Hay avisos nuevos en el tablón de la plaza.',
    ]) {
      const e = engine.events.emit({ actor_id: null, at: { spot_id: kael.location.id, next_spot_id: null, progress: 0, x: 0, y: 0, location_id: engine.world.characterSpot(kael)!.location_id }, action_type: 'board', narration_private: '', visibility: 'public', tags: ['board'], payload: { job_ids: [] }, observable });
      const d = seen.find((x) => x.event.id === e.id)!;
      expect(d).toBeTruthy();
      const m = toMessage(d, engine);
      expect(m.kind).toBe('system');
      expect(m.narrator).toBeFalsy();
      expect(m.text).toBe('');
      expect(m.prose ?? '').toBe('');
      expect(m.notice).toMatchObject({ tab: 'tablon', link: 'ver el Tablón' });
      expect(m.notice!.text).not.toMatch(/[•·📜]|00:00|\*\*/);
    }
  });

  it('noticeOf también por la etiqueta: un aviso del tablón con otro action_type no es narración', () => {
    const n = noticeOf({ action_type: 'notice', narration_private: '', observable: '📜 Tablón de Brezal, 00:00:\n• **Leña**', tags: ['board'] }, 'ch_kael');
    expect(n).toMatchObject({ tab: 'tablon' });
    expect(n!.text).not.toMatch(/[•📜]/);
  });
});
