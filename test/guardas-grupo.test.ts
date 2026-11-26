/**
 * Guardas del cierre, paquete A de docs/PLAN-ARREGLOS-2026-11-26.md, arreglo 8: el cierre de un turno compartido sin
 * la parte de cada jugador que actuó (narration_by_pc) se rechaza hasta dos veces, no una (4 de 23 cierres de grupo en
 * la pasada 1 de Haiku, 1 de 9 con Sonnet y 1 de 12 con Opus). En la pareja violento con pausado (20261125-1115),
 * acción 31, el texto era para quien empuja y lo leyó también el empujado.
 */
import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { MasterLike } from '../src/engine/engine.js';
import { bootEngine, fakeTime, fightAt } from './helpers.js';

const VIOLENTO_31 = 'Trastabillas hacia atrás y el yunque te frena las caderas. Hugo se vuelve hacia ti con el martillo de fragua y no mira al suelo: se lanza contra ti.';

describe('arreglo 8: cierres de grupo sin narration_by_pc', () => {
  it('se rechaza dos veces con el aviso de siempre; a la tercera pasa; con la parte de cada uno, a la primera', async () => {
    const { engine } = await bootEngine(fakeTime(), { groupWindowMs: 150, roundMs: 5000 });
    const kael = engine.world.character('ch_kael');
    const mira = engine.world.character('ch_mira');
    mira.location = { type: 'spot', id: 'sp_tab_barra' };
    kael.knows.push(mira.id); mira.knows.push(kael.id);
    engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
    fightAt(engine);
    const results: { error?: string; ok?: boolean }[] = [];
    let withByPc: { error?: string; ok?: boolean } | null = null;
    const m: MasterLike = {
      async resolve(actor, text) {
        actionContext(engine, actor, text);
        const log = (ctx: ToolContext, byPc: Record<string, string> | null, narration = VIOLENTO_31) => JSON.parse(executeTool(ctx, 'log_event', {
          narration_private: narration, narration_by_pc: byPc, observable: 'Kael y Mira se lanzan a la vez.', observable_vague: null, loudness: 1, tags: 'combat', suggested_actions: '', lines: null,
        })) as { error?: string; ok?: boolean };
        const fresh = (): ToolContext => ({ engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [], npc_turn_rejections: 1 });
        // La pareja del 25-11 cerraba sin narration_by_pc: dos rechazos y luego pasa (el motor no se queda sin cierre).
        const ctx = fresh();
        for (let i = 0; i < 3; i++) results.push(log(ctx, null));
        // Con la parte de cada uno (y lo común en tercera persona), a la primera.
        withByPc = log(fresh(), { [kael.id]: 'Empujas al herrero contra el yunque.', [mira.id]: 'Te apartas del yunque a tiempo.' }, 'El yunque frena al herrero, que se vuelve con el martillo de fragua.');
        return { ok: true as const, usage: {}, calls: [], context: '', model: 'falso', closed: { ...ctx.closed!, requires_roll: null } };
      },
    };
    engine.attachMaster(m);
    await Promise.all([engine.act(kael.id, 'empujo a Hugo contra el yunque'), engine.act(mira.id, 'me aparto del yunque')]);
    expect(results).toHaveLength(3);
    expect(results[0]!.error).toMatch(/^Turno compartido: falta en narration_by_pc lo de Kael \[ch_kael\] .* y lo de Mira \[ch_mira\]/);
    expect(results[1]!.error).toMatch(/^Turno compartido: falta en narration_by_pc lo de Kael/);
    expect(results[2]).toEqual({ ok: true, closed: true });
    expect(withByPc).toEqual({ ok: true, closed: true });
  });
});
