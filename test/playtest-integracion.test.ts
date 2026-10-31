/**
 * Las piezas de docs/PLAN-ARREGLOS-PLAYTEST.md conectadas por el máster de verdad, con un cliente falso: la negativa
 * que corta la charla, el camino tras una tirada social y el daño que no mata de quien no es de pelear.
 */
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Master, type MasterClient } from '../src/ai/master.js';
import { actionContext } from '../src/ai/prompt.js';
import { rollD20 } from '../src/engine/dice.js';
import { bootEngine, fakeTime } from './helpers.js';

const msg = (content: Anthropic.Beta.BetaContentBlock[]) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content, stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}) as unknown as Anthropic.Beta.BetaMessage;
const use = (name: string, input: Record<string, unknown>): Anthropic.Beta.BetaToolUseBlock => ({ type: 'tool_use', id: `tu_${name}`, name, input });
const close = (text: string, line: string, suggested = 'Mirar la barra') => use('log_event', {
  narration_private: text, observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: suggested,
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
  npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: line }],
});
const always = (m: Anthropic.Beta.BetaMessage): MasterClient => ({ create: async () => m });

describe('arreglos de la tanda, por el máster', () => {
  it('la tercera negativa seguida corta la charla', async () => {
    const { engine } = await bootEngine(fakeTime());
    engine.attachMaster(new Master(engine, { client: always(msg([close('Brenna seca la jarra.', 'Eso no te lo digo.')])) }));
    const brenna = engine.world.npc('npc_brenna');
    await engine.act('ch_kael', 'Brenna, ¿qué pasó en el incendio?');
    expect(brenna.talking_to?.character_id).toBe('ch_kael');
    await engine.act('ch_kael', 'Brenna, dime qué pasó en el incendio');
    expect(brenna.talking_to?.character_id).toBe('ch_kael');
    await engine.act('ch_kael', 'Brenna, ¿quién prendió el incendio?');
    expect(brenna.talking_to).toBeNull();
  });

  it('los botones no vuelven a ofrecer lo que ya se le ha negado', async () => {
    const { engine } = await bootEngine(fakeTime());
    engine.attachMaster(new Master(engine, { client: always(msg([close('Brenna seca la jarra.', 'Eso no te lo digo.', 'Preguntar a Brenna por el incendio | Mirar la barra')])) }));
    await engine.act('ch_kael', 'Brenna, ¿qué pasó en el incendio?');
    const r = await engine.act('ch_kael', 'Brenna, dime qué pasó en el incendio');
    expect(r.suggested_actions).toContain('Mirar la barra');
    expect(r.suggested_actions).not.toContain('Preguntar a Brenna por el incendio');
  });

  it('el resultado de una tirada social llega al máster en su contexto; el de otra habilidad, no', async () => {
    const { engine } = await bootEngine(fakeTime());
    const kael = engine.world.character('ch_kael');
    engine.world.npc('npc_brenna').talking_to = { character_id: kael.id, since_game_s: engine.gameNow() };
    const failed = { ...rollD20(0, 30), success: false };
    const social = actionContext(engine, kael, 'la convenzo', { original_text: 'la convenzo', result: { ...failed, label: 'Persuasión' } });
    expect(social).toContain('Tirada social fallida');
    const other = actionContext(engine, kael, 'miro', { original_text: 'miro', result: { ...failed, label: 'Percepción' } });
    expect(other).not.toContain('Tirada social');
  });

  it('el daño de quien no es de pelear, narrado con apply_damage, deja caído y no mata', async () => {
    const { engine } = await bootEngine(fakeTime());
    const kael = engine.world.character('ch_kael');
    engine.world.npc('npc_brenna').noncombatant = true;
    const script = [msg([use('apply_damage', { target_id: kael.id, amount: 500, damage_type: 'bludgeoning', source: 'Brenna' })]), msg([close('Brenna te tumba.', 'Fuera.')])];
    engine.attachMaster(new Master(engine, { client: { create: async () => script.shift() ?? msg([close('Nada.', 'Fuera.')]) } }));
    await engine.act('ch_kael', 'Brenna, aparta o te rompo la jarra');
    expect(kael.status).toBe('unconscious');
    expect(kael.death ?? null).toBeNull();
  });
});
