/**
 * Arreglo 34 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete F): el compañero no es un NPC. Pareja pícaro con novato
 * (20261126-0442): Bruno ve al jugador Ciro como «el jornalero» (Ciro el jornalero, npc_x_ciro) de B1 a B31, y el robo
 * a Ciro (B9) lo contesta el jornalero. Aquí, en el mundo de demo, el guardia se llama Mira como la jugadora.
 */
import { describe, expect, it } from 'vitest';
import { handsOnPlayer, homonymPairs, homonymRoleCall } from '../src/engine/closecheck.js';
import type { Engine } from '../src/engine/engine.js';
import { actionContext } from '../src/ai/prompt.js';
import { bootEngine } from './helpers.js';
import { ctxOnly, logEvent, rejectsOnceThenPasses, run } from './guardas-helpers.js';

// B1: lo que lee Bruno de Ciro el jugador.
const B1 = 'El jornalero se inclina sobre la mesa y te pregunta en voz baja si el aguante de Tomar aliento se gasta ya o conviene guardarlo para una pelea.';
// B9: el robo al jugador, contestado por el NPC.
const B9_ACTION = 'Mientras Garrán se levanta, deslizo la mano hacia el bolsillo de Ciro y le saco la bolsa de monedas sin que se note.';

/** Kael y Mira en la taberna; el guardia (fuera, en el portón) pasa a llamarse Mira y a ser jornalero. */
async function homonym(): Promise<Engine> {
  const { engine } = await bootEngine();
  engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_mesa' };
  engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_mesa' };
  const doro = engine.world.npc('npc_doro');
  doro.name = 'Mira';
  doro.role = 'jornalero';
  delete (doro as { role_short?: string }).role_short;
  return engine;
}

describe('arreglo 34: las piezas', () => {
  it('homonymPairs: por el nombre o su primera palabra', () => {
    expect(homonymPairs([{ id: 'ch_ciro', name: 'Ciro' }], [{ id: 'npc_x_ciro', name: 'Ciro' }, { id: 'npc_garran', name: 'Garrán' }])).toEqual([{ pc_id: 'ch_ciro', npc_id: 'npc_x_ciro' }]);
    expect(homonymPairs([{ id: 'ch_ciro', name: 'Ciro el Viejo' }], [{ id: 'npc_x_ciro', name: 'Ciro' }])).toHaveLength(1);
  });

  it('B1: «el jornalero» con el jornalero fuera es el jugador; con el jornalero aquí, no se mira', () => {
    const h = { pc_id: 'ch_ciro', pc_name: 'Ciro', npc_id: 'npc_x_ciro', npc_role: 'el jornalero', npc_present: false };
    expect(homonymRoleCall({ narration: B1, homonyms: [h] })?.phrase).toBe('el jornalero');
    expect(homonymRoleCall({ narration: B1, homonyms: [{ ...h, npc_present: true }] })).toBeNull();
    expect(homonymRoleCall({ narration: 'Ciro se inclina sobre la mesa.', homonyms: [h] })).toBeNull();
  });

  it('B9: robarle o agarrarle al jugador por su nombre; a un NPC, o sin nombrarle, no', () => {
    const pcs = [{ id: 'ch_ciro', name: 'Ciro' }];
    expect(handsOnPlayer(B9_ACTION, pcs)).toEqual({ pc_id: 'ch_ciro', pc_name: 'Ciro', what: 'theft' });
    expect(handsOnPlayer('Agarro a Ciro del brazo y tiro de él hacia la puerta.', pcs)?.what).toBe('grab');
    expect(handsOnPlayer('Le pregunto a Ciro qué opina de Ilse.', pcs)).toBeNull();
    expect(handsOnPlayer('Le robo la bolsa a Garrán.', pcs)).toBeNull();
  });
});

describe('arreglo 34: en log_event', () => {
  it('B1: el cierre que llama a la jugadora por el oficio del NPC se rechaza; a la segunda pasa', async () => {
    const engine = await homonym();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'homonym_rejections', { action_text: 'Espero a ver qué dice Mira.' }), logEvent(B1));
    expect(err).toContain('«el jornalero»');
    expect(err).toContain('JUGADOR Mira [ch_mira]');
  });

  it('B9: el robo a la jugadora sin request_reaction, contestado por el NPC, se rechaza; con request_reaction pasa', async () => {
    const engine = await homonym();
    const action = B9_ACTION.replace('Ciro', 'Mira');
    const close = logEvent('El jornalero contesta sin mirarte apenas.', { lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'De eso no sé nada. Pregúntale a Brenna.' }] });
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'hands_rejections', { action_text: action }), close);
    expect(err).toContain('al JUGADOR Mira [ch_mira]');
    expect(err).toContain('contesta Brenna en su lugar');
    expect(err).toContain('request_reaction (target_character_id ch_mira, kind other, actor_skill sleight_of_hand');
    const ctx = ctxOnly(engine, 'hands_rejections', { action_text: action, ok_tools: ['request_reaction'] });
    expect(run(ctx, 'log_event', logEvent('Deslizas la mano hacia el bolsillo de Mira.')).closed).toBe(true);
  });
});

describe('arreglo 34: el contexto', () => {
  it('cada uno marcado sin ambigüedad: «JUGADOR Mira» y el NPC por su oficio', async () => {
    const engine = await homonym();
    const kael = engine.world.character('ch_kael');
    const text = actionContext(engine, kael, 'Miro a Mira.');
    expect(text).toContain('JUGADOR Mira [ch_mira] (no es el jornalero [npc_doro], el NPC que se llama igual: a él, siempre por su nombre)');
    // Con el jornalero delante, su línea avisa de lo mismo.
    engine.world.npc('npc_doro').location = { type: 'spot', id: 'sp_tab_barra' };
    expect(actionContext(engine, kael, 'Miro a Mira.')).toMatch(/\[npc_doro\][^\n]*OJO: se llama igual que el JUGADOR Mira \[ch_mira\] y NO es él/);
  });
});
