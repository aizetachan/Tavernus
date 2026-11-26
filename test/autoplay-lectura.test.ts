/**
 * H13 (plan de arreglos 2, 26-11-2026): qué lee cada jugador automático de un turno. En la tanda de parejas
 * `20261126-0442` Ciro leía «Le preguntas a Garrán qué saca él de esperar tres días» (lo de Bruno, en segunda
 * persona) y lo común dos veces (pareja pícaro C2 y C12), y en las tiradas ocultas el resultado salía antes que la
 * intención (patrón 6). El motor entrega bien (cada uno su `narration_by_pc` y lo común, test/sync.test.ts); era la
 * herramienta: `seenSince` juntaba el `text` del ActionResult (la narración del ACTOR del cierre compartido) con los
 * eventos vistos. Ahora el transcript es lo que la web pinta: las entregas, una vez y en orden.
 */
import { describe, expect, it } from 'vitest';
import { shownSince } from '../scripts/autoplay.js';
import type { MasterLike } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import type { Character } from '../src/engine/model.js';
import { bootEngine, fakeTime, fightAt } from './helpers.js';

/** Cierre del máster falso, con lo que haga falta encima. */
function closed(actor: Character, over: Record<string, unknown> = {}) {
  return {
    ok: true as const, usage: {}, calls: [], context: '', model: 'falso',
    closed: { narration_private: `Respuesta a ${actor.name}.`, observable: `${actor.name} hace algo.`, observable_vague: null, loudness: 1, tags: ['social'], suggested_actions: [], requires_roll: null, ...over },
  };
}

/** Kael y Mira en la barra, conectados y conociéndose; lo que la web le entrega a cada uno, apuntado. */
async function pair(resolve: MasterLike['resolve']) {
  const { engine } = await bootEngine(fakeTime(), { groupWindowMs: 150, roundMs: 5000 });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  if (!kael.knows.includes(mira.id)) kael.knows.push(mira.id);
  if (!mira.knows.includes(kael.id)) mira.knows.push(kael.id);
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  const web = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { web.set(d.character_id, [...(web.get(d.character_id) ?? []), d]); });
  engine.attachMaster({ resolve });
  const webSince = (id: string, seq: number) => (web.get(id) ?? []).filter((d) => d.event.seq > seq && !d.event.tags.includes('on_join')).map((d) => d.text);
  return { engine, kael, mira, webSince };
}

describe('H13: lo que lee cada jugador automático', () => {
  it('turno compartido con narration_by_pc: cada uno lee lo suyo una vez y lo común una vez, como en la web', async () => {
    // Como el evento 29 de la pareja pícaro (C2): lo de Bruno, lo de Ciro y lo común.
    const { engine, kael, mira, webSince } = await pair(async (actor) => closed(actor, {
      narration_private: 'Le preguntas a Garrán qué saca él de esperar tres días.\n\nGarrán sigue en la mesa del fondo. «Tres días, ni uno más.»',
      narration_by_pc: { ch_kael: 'Le preguntas a Garrán qué saca él de esperar tres días.', ch_mira: 'Miras al hombre de la maza: es Garrán, sentado a tu mesa.' },
      narration_common: 'Garrán sigue en la mesa del fondo. «Tres días, ni uno más.»',
      observable: 'Kael habla con Garrán en voz baja.', tags: ['combat'],
    }));
    fightAt(engine);
    const seq = engine.events.all().at(-1)!.seq;
    const [a, b] = await Promise.all([engine.act(kael.id, 'preguntar a Garrán qué gana esperando'), engine.act(mira.id, 'mirar quién es el de la maza')]);
    expect(a.event!.id).toBe(b.event!.id);
    expect(a.event!.payload['group']).toEqual(expect.arrayContaining([kael.id, mira.id]));
    // El motor le devuelve a Mira el mismo ActionResult que a Kael: la narración del actor del cierre. La web no lo pinta (hay evento).
    expect(b.text).toContain('Le preguntas a Garrán');
    // Lo que hacía la herramienta: ese texto delante de lo entregado; lo de Kael en segunda persona y lo común dos veces.
    const before = [b.text, ...shownSince(engine.world, engine.events.all(), mira.id, seq)].join('\n\n');
    expect(before).toContain('Le preguntas a Garrán');
    expect(before.split('«Tres días, ni uno más.»')).toHaveLength(3);
    const toMira = shownSince(engine.world, engine.events.all(), mira.id, seq, [b]).filter((t) => t.includes('Garrán') || t.includes('maza'));
    expect(toMira).toEqual(['Miras al hombre de la maza: es Garrán, sentado a tu mesa.\n\nGarrán sigue en la mesa del fondo. «Tres días, ni uno más.»']);
    const toKael = shownSince(engine.world, engine.events.all(), kael.id, seq, [a]).filter((t) => t.includes('Garrán'));
    expect(toKael).toEqual(['Le preguntas a Garrán qué saca él de esperar tres días.\n\nGarrán sigue en la mesa del fondo. «Tres días, ni uno más.»']);
    // Exactamente lo que la web le entrega a cada uno desde ahí.
    expect(shownSince(engine.world, engine.events.all(), mira.id, seq, [b])).toEqual(webSince(mira.id, seq));
    expect(shownSince(engine.world, engine.events.all(), kael.id, seq, [a])).toEqual(webSince(kael.id, seq));
  });

  it('lo que hace el compañero por su cuenta llega en tercera persona, no en la segunda del otro', async () => {
    const { engine, kael, mira, webSince } = await pair(async (actor) => closed(actor, {
      narration_private: 'Te acercas al jornalero y pones la daga sobre la mesa.', observable: `${actor.name} pone una daga sobre la mesa.`,
    }));
    const seq = engine.events.all().at(-1)!.seq;
    const r = await engine.act(kael.id, 'poner la daga sobre la mesa');
    expect(r.ok).toBe(true);
    const toMira = shownSince(engine.world, engine.events.all(), mira.id, seq);
    expect(toMira.join('\n')).not.toContain('Te acercas');
    expect(toMira).toContain('Kael pone una daga sobre la mesa.');
    expect(toMira).toEqual(webSince(mira.id, seq));
  });

  it('tirada oculta: la intención antes que el resultado, cada una una vez (patrón 6)', async () => {
    let n = 0;
    const { engine, kael, webSince } = await pair(async (actor, _text, roll) => {
      n++;
      return roll
        ? closed(actor, { narration_private: 'Ves una marca de carbón bajo la mesa.' })
        : closed(actor, { narration_private: 'Recorres la sala con la mirada.', requires_roll: { kind: 'skill', key: 'perception', dc: 10, advantage: 'none' } });
    });
    const seq = engine.events.all().at(-1)!.seq;
    const r = await engine.act(kael.id, 'mirar con atención la sala');
    expect(n).toBe(2);
    // La oculta la tira el servidor al cerrar: el ActionResult es solo el resultado.
    expect(r.text).toBe('Ves una marca de carbón bajo la mesa.');
    const shown = shownSince(engine.world, engine.events.all(), kael.id, seq, [r]);
    const intent = shown.indexOf('Recorres la sala con la mirada.');
    const outcome = shown.indexOf('Ves una marca de carbón bajo la mesa.');
    expect(intent).toBeGreaterThanOrEqual(0);
    expect(outcome).toBeGreaterThan(intent);
    expect(shown.filter((t) => t === 'Ves una marca de carbón bajo la mesa.')).toHaveLength(1);
    expect(shown).toEqual(webSince(kael.id, seq));
  });

  it('una respuesta sin evento (rechazo del motor) sale tal cual, como en la web', async () => {
    const { engine, kael } = await pair(async (actor) => closed(actor));
    const seq = engine.events.all().at(-1)!.seq;
    const r = await engine.rollPending(kael.id);
    expect(r.ok).toBe(false);
    expect(shownSince(engine.world, engine.events.all(), kael.id, seq, [r])).toEqual(['No tienes ninguna tirada pendiente.']);
  });
});
