/**
 * Arreglo 36 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete F, parte del máster): un turno con tirada son dos cierres, el
 * de la intención y el del resultado (la web enseña los dos; el orden invertido de los transcripts era de la
 * herramienta, veredicto de H13 del paquete I). El segundo continúa al primero: no lo vuelve a contar.
 */
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Master, type MasterClient } from '../src/ai/master.js';
import { withoutIntentRepeat } from '../src/engine/closecheck.js';
import { seededRng } from '../src/engine/dice.js';
import { bootEngine } from './helpers.js';

// Tirador (20261126-0418), T5: la intención y, después, el resultado que la vuelve a contar.
const TIRADOR_5_INTENT = 'Deslizas la punta de la espada corta bajo el borde de la losa y la haces girar despacio. Hugo sigue de espaldas al yunque, martilleando, y el golpe de su martillo tapa el roce del hierro contra la piedra. La losa cede un palmo, lo justo para que la lana engrasada se asome por la rendija.';
const TIRADOR_5_RESULT = 'Levantas la losa un palmo con la punta de la espada. Bajo la lana engrasada hay unos eslabones de hierro oscuro, medianos, pesados. En uno de ellos, a la luz de las brasas, distingues una marca grabada.';

function msg(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaMessage {
  return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Beta.BetaMessage;
}
const close = (priv: string, extra: Record<string, unknown> = {}): Anthropic.Beta.BetaToolUseBlock => ({
  type: 'tool_use', id: 'tu_log', name: 'log_event',
  input: { narration_private: priv, observable: null, observable_vague: null, loudness: 1, tags: 'exploration', suggested_actions: 'Mirar', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, ...extra },
});

describe('arreglo 36: el resultado continúa a la intención', () => {
  it('withoutIntentRepeat: tirador T5, se va la frase que vuelve a levantar la losa; lo nuevo se queda', () => {
    const r = withoutIntentRepeat(TIRADOR_5_INTENT, TIRADOR_5_RESULT);
    expect(r.removed).toEqual(['Levantas la losa un palmo con la punta de la espada.']);
    expect(r.narration).toBe('Bajo la lana engrasada hay unos eslabones de hierro oscuro, medianos, pesados. En uno de ellos, a la luz de las brasas, distingues una marca grabada.');
    // Lo dicho entre comillas se queda, y si todo repite, no se toca.
    expect(withoutIntentRepeat(TIRADOR_5_INTENT, '«La losa cede un palmo, lo justo», murmuras.').removed).toEqual([]);
    expect(withoutIntentRepeat(TIRADOR_5_INTENT, 'Levantas la losa un palmo con la punta de la espada.').narration).toBe('Levantas la losa un palmo con la punta de la espada.');
  });

  it('con el máster: el segundo cierre sale sin lo que ya contó el primero, y el contexto le enseña la intención', async () => {
    const { engine } = await bootEngine();
    const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    const script = [
      msg([close(TIRADOR_5_INTENT, { requires_roll_kind: 'skill', requires_roll_key: 'sleight_of_hand', requires_roll_dc: 12, requires_roll_advantage: 'none' })]),
      msg([close(TIRADOR_5_RESULT)]),
    ];
    const client: MasterClient = { async create(p) { requests.push(structuredClone(p)); return script.shift()!; } };
    engine.attachMaster(new Master(engine, { client, rng: seededRng(5) }));
    const action = 'Levanto la losa suelta con la punta de la espada corta, sin hacer ruido, y miro qué se arrastró por debajo.';
    const r = await engine.act('ch_kael', action);
    expect(r.ok).toBe(true);
    const r2 = await engine.rollPending('ch_kael');
    expect(r2.ok).toBe(true);
    expect(r2.text).toContain('Bajo la lana engrasada hay unos eslabones');
    expect(r2.text).not.toContain('Levantas la losa un palmo');
    expect(String(requests[1]!.messages[0]!.content)).toContain('Antes de tirar, el jugador ya ha leído esto (la intención): «Deslizas la punta de la espada corta');
  });
});
