/**
 * Arreglo 30 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete F): presencia de NPC en el cierre. Casos de las tandas
 * 20261126-0418 y -0442 (docs/ANALISIS-PARTIDAS-2026-11-26.md, patrón 1).
 */
import { describe, expect, it } from 'vitest';
import { npcMovesSince, npcPresenceProblem } from '../src/engine/closecheck.js';
import type { Engine } from '../src/engine/engine.js';
import { actionContext } from '../src/ai/prompt.js';
import { bootEngine } from './helpers.js';
import { ctxOnly, logEvent, rejectsOnceThenPasses, run } from './guardas-helpers.js';

// Pícaro (20261126-0418), T10 acaba con «Garrán se va de la barra.» (motor) y en T11 Garrán contesta.
const PICARO_11 = '«Garrán, te doy mi palabra de que te pago el día tres, y mientras tanto te fío la cuenta de la cerveza: apúntala a mi nombre, que yo cobro antes.» «Tu palabra ya la tengo apuntada, forastero, y no me paga nada. La cerveza se paga antes de bebérsela, o no se bebe.»';
// Pícaro T13: Garrán actúa en la narración, también fuera de la sala.
const PICARO_13 = 'Garrán deja de mirar la vaina y se queda con la mano sobre la tablilla. Mueve los dedos como si contara, y se inclina un palmo.';
// Pareja violento con pausado (20261126-0442), T2: Hugo sigue en la herrería y el cierre lo manda a cenar.
const VIOLENTO_2 = 'Te levantas tambaleándote y cierras el puño sobre la capa de Elmo. Él no logra zafarse: queda sujeto contra la pared de la puerta, con la tela tirante bajo tu mano. Hugo, que se ha ido a cenar, ya no está para oír lo que dices.';

const garran = (present: boolean, extra: Partial<{ moved_now: boolean; ordered: boolean }> = {}) => [{ id: 'npc_garran', refs: ['Garrán', 'el alguacil'], present, ...extra }];

describe('arreglo 30: npcPresenceProblem', () => {
  it('pícaro 11: Garrán no está y habla en lines', () => {
    const hit = npcPresenceProblem({ narration: '', lines: [{ speaker: 'npc', npc_id: 'npc_garran', text: 'Tu palabra ya la tengo apuntada, forastero.' }], npcs: garran(false) });
    expect(hit?.kind).toBe('absent_speaks');
  });

  it('pícaro 13: Garrán no está y actúa en la narración; si está, nada', () => {
    expect(npcPresenceProblem({ narration: PICARO_13, npcs: garran(false) })).toMatchObject({ kind: 'absent_acts', npc_id: 'npc_garran' });
    expect(npcPresenceProblem({ narration: PICARO_13, npcs: garran(true) })).toBeNull();
  });

  it('pareja violento 2: «Hugo, que se ha ido a cenar» con Hugo aquí y sin moverlo el motor', () => {
    const hugo = [{ id: 'npc_hugo', refs: ['Hugo', 'el herrero'], present: true }];
    expect(npcPresenceProblem({ narration: VIOLENTO_2, npcs: hugo })).toMatchObject({ kind: 'false_exit', npc_id: 'npc_hugo' });
    // Si el motor lo ha movido en este turno, contarlo es lo correcto.
    expect(npcPresenceProblem({ narration: VIOLENTO_2, npcs: [{ ...hugo[0]!, moved_now: true }] })).toBeNull();
    // «se va a enfadar» es futuro, no salida.
    expect(npcPresenceProblem({ narration: 'Hugo se va a enfadar si sigues así.', npcs: hugo })).toBeNull();
  });

  it('lo que no es actuar aquí: hablar de él, lo que hará, lo citado, la ceniza con minúscula', () => {
    const npcs = garran(false);
    expect(npcPresenceProblem({ narration: 'Dices el nombre de Garrán en voz baja, pero el alguacil no está en la taberna.', npcs })).toBeNull();
    expect(npcPresenceProblem({ narration: 'Doro se rasca la nuca. «Garrán está en la casona y vuelve mañana.»', npcs })).toBeNull();
    expect(npcPresenceProblem({ narration: 'Brenna dice que Garrán cuenta las deudas cada jueves.', npcs })).toBeNull();
    expect(npcPresenceProblem({ narration: 'Nadie llamado Garrán está aquí.', npcs })).toBeNull();
    expect(npcPresenceProblem({ narration: 'La ceniza se levanta con el viento.', npcs: [{ id: 'npc_ceniza', refs: ['Ceniza'], present: false }] })).toBeNull();
    expect(npcPresenceProblem({ narration: 'Ceniza se levanta y te mira.', npcs: [{ id: 'npc_ceniza', refs: ['Ceniza'], present: false }] })?.kind).toBe('absent_acts');
  });

  it('entrar sin moverlo: con set_npc_order pasa', () => {
    const narration = 'La puerta se abre y Garrán entra sacudiéndose la lluvia.';
    expect(npcPresenceProblem({ narration, npcs: garran(false) })?.kind).toBe('false_entry');
    expect(npcPresenceProblem({ narration, npcs: garran(false, { ordered: true }) })).toBeNull();
  });
});

/** Brenna sale de la taberna por su rutina (como schedule.ts) después del último turno de Kael. */
function brennaLeaves(engine: Engine): void {
  const kael = engine.world.character('ch_kael');
  kael.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.events.emit({ actor_id: kael.id, action_type: 'master', input_text: 'Miro a Brenna.', narration_private: 'Brenna seca una jarra.', observable: null, payload: {} });
  const at = { spot_id: 'sp_tab_barra', next_spot_id: null, progress: 0, x: 0, y: 0, location_id: 'loc_taberna' };
  engine.events.emit({ actor_id: null, at, action_type: 'npc_move', narration_private: '', observable: 'Brenna se va de la barra, camino de la misa.', tags: ['npc', 'schedule', 'deterministic'], payload: { master: null, npc_id: 'npc_brenna' } });
  engine.world.npc('npc_brenna').location = { type: 'spot', id: 'sp_pl_pozo' };
}

/** El turno siguiente de Kael: ya pasó su turno con la salida delante. */
function nextTurn(engine: Engine): void {
  const kael = engine.world.character('ch_kael');
  engine.events.emit({ actor_id: kael.id, action_type: 'master', input_text: 'Brenna, ¿me fías?', narration_private: 'Brenna no está.', observable: null, payload: {} });
}

describe('arreglo 30: la guarda en log_event', () => {
  it('pícaro 11: quien el motor sacó de la sala no sigue hablando; el hint dice cuándo se fue', async () => {
    const { engine } = await bootEngine();
    brennaLeaves(engine);
    nextTurn(engine);
    const ctx = ctxOnly(engine, 'presence_rejections', { action_text: 'Brenna, te doy mi palabra de que te pago el día tres, y mientras tanto te fío la cuenta de la cerveza: apúntala a mi nombre, que yo cobro antes.' });
    const err = rejectsOnceThenPasses(ctx, logEvent(PICARO_11.replace('Garrán', 'Brenna'), { npc_id: 'npc_brenna' }));
    expect(err).toContain('Brenna [npc_brenna] no está aquí');
    expect(err).toContain('«Brenna se va de la barra, camino de la misa.»');
    expect(err).toContain('set_npc_order');
  });

  it('en el mismo turno de la salida, la despedida vale', async () => {
    const { engine } = await bootEngine();
    brennaLeaves(engine);
    const ctx = ctxOnly(engine, 'presence_rejections', { action_text: 'Brenna, ¿te vas?' });
    expect(run(ctx, 'log_event', logEvent('Brenna se echa el chal por los hombros.', { lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'A la misa, que tarde llego.' }] })).closed).toBe(true);
  });

  it('pareja violento 2: el cierre no manda a cenar a quien sigue aquí', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_barra' };
    const ctx = ctxOnly(engine, 'presence_rejections', { action_text: 'Agarro a Mira de la capa.' });
    const err = rejectsOnceThenPasses(ctx, logEvent(VIOLENTO_2.replace(/Hugo/g, 'Brenna')));
    expect(err).toContain('se va («Brenna, que se ha ido');
    expect(err).toContain('el servidor no lo ha movido');
  });

  it('npcMovesSince: solo los movimientos desde el último turno del actor', async () => {
    const { engine } = await bootEngine();
    brennaLeaves(engine);
    expect(npcMovesSince(engine.events.all(), 'ch_kael').map((e) => e.payload['npc_id'])).toEqual(['npc_brenna']);
    nextTurn(engine);
    expect(npcMovesSince(engine.events.all(), 'ch_kael')).toEqual([]);
  });
});

describe('arreglo 30: el contexto dice quién se ha ido', () => {
  it('«Presentes que el actor percibe» lleva la línea de quien salió desde el turno anterior', async () => {
    const { engine } = await bootEngine();
    brennaLeaves(engine);
    const kael = engine.world.character('ch_kael');
    const text = actionContext(engine, kael, 'Brenna, ¿me fías?');
    expect(text).toMatch(/Se han ido desde el turno anterior[^\n]*Brenna \[npc_brenna\]/);
    nextTurn(engine);
    expect(actionContext(engine, kael, 'Brenna, ¿me fías?')).not.toContain('Se han ido desde el turno anterior');
  });
});
