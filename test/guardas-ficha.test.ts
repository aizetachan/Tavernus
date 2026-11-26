/**
 * Arreglos 40 y 38 (parte de la guarda) de docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete F: lo que el jugador cuenta de sí
 * pasa por record_character_fact, y 0 PG es 0 PG. Casos del herido (20261126-0602, T21), el dirigido (20261126-0418,
 * T7), la pareja metódico (20261126-0442, E17) y el recolector (20261126-0602, T11).
 */
import { describe, expect, it } from 'vitest';
import { downedActs, ownClaimAccepted } from '../src/engine/closecheck.js';
import type { Engine } from '../src/engine/engine.js';
import { bootEngine } from './helpers.js';
import { ctxOnly, logEvent, rejectsOnceThenPasses, run } from './guardas-helpers.js';

const HERIDO_21 = { action: 'Bruno se deja caer junto al yunque, quita la venda sucia de la pierna y la aprieta con el kit de sanador. Hugo, necesito una hora de calma. Vendo esto y respiro hondo.', narration: 'No estás junto al yunque. Estás en la plaza, con la espalda contra el brocal del pozo. La pierna te late bajo la venda sucia. Si quieres curarla, hazlo aquí.' };
const DIRIGIDO_7 = { action: 'Vuelvo a la herrería y le planto las monedas en el yunque a Hugo: «Te he traído lo que te debía. Ahora dime qué dejó mi padre.', narration: '«Te he traído lo que te debía. Ahora dime qué dejó mi padre.» Cruzas la plaza y entras en la herrería. De Hugo no hay ni rastro. Lo que le debías a Hugo sigue en tu bolsa; sin él delante, no hay a quién dárselo.' };
// Pareja metódico (charlatán con metódico), E17: Elmo a 0 PG tras una salvación con éxito.
const METODICO_E17 = 'Abres los ojos con el pecho ardiendo. Sin levantarte del empedrado, buscas la mirada de Mirela y le hablas con la voz rota.';
// Recolector T11: a 0 PG y lanza Curar heridas.
const RECOLECTOR_11 = '«Curar heridas» Susurras el conjuro con la mano sobre el costado y el calor cierra la herida.';

describe('arreglo 40: lo que el jugador cuenta de sí', () => {
  it('herido T21: la herida de la pierna a vida llena, dada por cierta; si le falta vida, no', () => {
    const base = { ...HERIDO_21, okTools: [] as string[] };
    expect(ownClaimAccepted(base)).toMatchObject({ kind: 'wound', accepted: 'la pierna te late' });
    expect(ownClaimAccepted({ ...base, wounded: true })).toBeNull();
    expect(ownClaimAccepted({ ...base, okTools: ['record_character_fact'] })).toBeNull();
    expect(ownClaimAccepted({ ...base, narration: 'No tienes ninguna herida en la pierna: la venda está limpia y la pierna te late solo del cansancio.' })).toBeNull();
  });

  it('dirigido T7: la deuda con Hugo que no consta; con una deuda abierta, no', () => {
    expect(ownClaimAccepted({ ...DIRIGIDO_7, okTools: [] })).toMatchObject({ kind: 'debt', accepted: 'lo que le debias' });
    expect(ownClaimAccepted({ ...DIRIGIDO_7, okTools: [], hasDebt: true })).toBeNull();
  });

  it('un familiar que no consta, dado por cierto por un NPC; si ya consta, no', () => {
    const action = 'Hugo, ¿qué dejó mi padre en la herrería?';
    const lines = [{ speaker: 'npc' as const, npc_id: 'npc_hugo', text: 'Tu padre dejó deudas y una caja cerrada.' }];
    expect(ownClaimAccepted({ action, narration: 'Hugo deja el martillo.', lines, okTools: [] })).toMatchObject({ kind: 'kin', claim: 'mi padre', accepted: 'tu padre' });
    expect(ownClaimAccepted({ action, narration: 'Hugo deja el martillo.', lines, okTools: [], known: 'Su padre fue herrero en Brezal.' })).toBeNull();
  });

  it('en log_event: se rechaza con hint de record_character_fact y a la segunda pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'claim_rejections', { action_text: HERIDO_21.action }), logEvent(HERIDO_21.narration));
    expect(err).toContain('«la venda sucia de la pierna»');
    expect(err).toContain('record_character_fact (kind background');
  });
});

/** Kael a 0 PG, cayendo, con una salvación con éxito. */
function down(engine: Engine, id = 'ch_kael'): void {
  const c = engine.world.character(id);
  c.hp_current = 0;
  c.status = 'unconscious';
  c.dying = { since_game_s: 0, success: 1, fail: 0, stable_until_game_s: null, cause: 'a 0 PG' } as never;
}

describe('arreglo 38: 0 PG es 0 PG', () => {
  it('E17: «Abres los ojos» a 0 PG sin heal ni stabilize; con heal, pasa', () => {
    const d = [{ id: 'ch_elmo', name: 'Elmo', actor: true }];
    expect(downedActs({ narration: METODICO_E17, down: d, okTools: [] })).toMatchObject({ phrase: 'abres los ojos', acts: false });
    expect(downedActs({ narration: METODICO_E17, down: d, okTools: ['heal'] })).toBeNull();
    expect(downedActs({ narration: 'Intentas abrir los ojos y no puedes: todo sigue a oscuras.', down: d, okTools: [] })).toBeNull();
  });

  it('otro PJ a 0 PG que «se incorpora» en la narración del actor', () => {
    const d = [{ id: 'ch_mira', name: 'Mira', actor: false }];
    expect(downedActs({ narration: 'Mira, por fin, se incorpora apoyada en el banco.', down: d, okTools: [] })?.phrase).toBe('Mira, por fin, se incorpora'.toLowerCase());
    expect(downedActs({ narration: 'Mira sigue en el suelo, respirando apenas.', down: d, okTools: [] })).toBeNull();
  });

  it('recolector T11: a 0 PG, cast_spell no lanza y el cierre que lo cuenta se rechaza', async () => {
    const { engine } = await bootEngine();
    down(engine);
    const ctx = ctxOnly(engine, 'downed_rejections', { action_text: 'Abro los ojos y susurro «Curar heridas».' });
    const cast = run(ctx, 'cast_spell', { spell: 'cure_wounds', slot_level: null, ritual: null, target_id: null });
    expect(cast.error).toBe('down');
    expect(run(ctx, 'attack', { attacker_id: 'ch_kael', target_id: 'npc_brenna', advantage: 'none' }).error).toBe('down');
    const err = rejectsOnceThenPasses(ctx, logEvent(RECOLECTOR_11));
    expect(err).toContain('está a 0 PG (cayendo, salvaciones 1 éxitos y 0 fallos)');
    expect(err).toContain('no lanza');
  });

  it('E17 en log_event: levantar al actor a 0 PG se rechaza', async () => {
    const { engine } = await bootEngine();
    down(engine);
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'downed_rejections'), logEvent(METODICO_E17));
    expect(err).toContain('una salvación con éxito no le despierta');
    expect(err).toContain('stabilize');
  });
});
