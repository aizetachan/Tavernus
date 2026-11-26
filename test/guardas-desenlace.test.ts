/**
 * Guardas del cierre, paquete A de docs/PLAN-ARREGLOS-2026-11-26.md: el desenlace no contradice lo que ya decidió
 * el servidor. Una vez se rechaza con el motivo; a la segunda pasa.
 *
 *   - Arreglo 5: un tool de escritura que falló, narrado como hecho.
 *   - Arreglo 2: el desenlace contrario a la tirada enfrentada de una reacción.
 *   - Arreglo 12: un NPC que le pega al actor sin attack (en el cierre y en apply_damage).
 */
import { describe, expect, it } from 'vitest';
import { failedToolNarrated, npcHitWithoutAttack, reactionOutcomeMismatch } from '../src/engine/closecheck.js';
import type { Engine } from '../src/engine/engine.js';
import { bootEngine } from './helpers.js';
import { ctxOnly, logEvent, rejectsOnceThenPasses, run } from './guardas-helpers.js';

// Tanda 20261125-1051: explorador, acción 16 (turno 22 del informe), y dirigido, turno 18.
const EXPLORADOR_16 = 'Te agachas sobre la losa, con la lana engrasada entre los dedos, y tomas uno de los eslabones. Es más grueso de lo que parecía y no cabe en el bolsillo: se te queda en la palma, frío como el agua de pozo. Puedes llevarlo en la mano o guardarlo en la mochila.';
const DIRIGIDO_18 = 'Te agachas junto a la losa y apartas la lana engrasada. Dentro hay un manojo de eslabones de hierro oscuro, todavía con la marca del maestro de Vharn grabada en uno de ellos. Tienes las manos ocupadas con la espada y el escudo, así que los guardas en la mochila. Pesan poco, pero no son de hierro corriente.';

describe('arreglo 5: tool fallido narrado como hecho', () => {
  it('explorador 16: transfer_item devuelve no_space y «tomas uno de los eslabones» se rechaza; a la segunda pasa', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxOnly(engine, 'failed_rejections', { action_text: 'Me guardo un eslabón en el bolsillo.' });
    const moved = run(ctx, 'transfer_item', { instance_id: 'ii_kael_mochila', to_type: 'character', to_id: 'ch_kael', slot: 'pocket', equip_slot: null, quantity: 1 });
    expect(moved.error).toBe('no_space');
    const err = rejectsOnceThenPasses(ctx, logEvent(EXPLORADOR_16));
    expect(err).toMatch(/^transfer_item ha fallado en este turno \(no_space: [^)]*bolsillo/);
    expect(err).toContain('«te agachas sobre la losa, con la lana engrasada entre los dedos, y tomas uno de los eslabones»');
  });

  it('dirigido 18: «así que los guardas en la mochila» tras el no_space; si luego sale bien, no', () => {
    const failed = [{ name: 'transfer_item', error: 'no_space: tienes las manos ocupadas' }];
    expect(failedToolNarrated({ narration: DIRIGIDO_18, failed, okTools: [] })?.phrase).toBe('tienes las manos ocupadas con la espada y el escudo, asi que los guardas en la mochila');
    expect(failedToolNarrated({ narration: 'No te cabe en el bolsillo: lo dejas sobre la losa.', failed, okTools: [] })).toBeNull();
    expect(failedToolNarrated({ narration: DIRIGIDO_18, failed: [], okTools: ['transfer_item'] })).toBeNull();
  });

  it('un fallo que se arregla después en el mismo turno no cuenta', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxOnly(engine, 'failed_rejections');
    expect(run(ctx, 'transfer_item', { instance_id: 'ii_kael_mochila', to_type: 'character', to_id: 'ch_kael', slot: 'pocket', equip_slot: null, quantity: 1 }).error).toBe('no_space');
    expect(run(ctx, 'transfer_item', { instance_id: 'ii_kael_daga', to_type: 'character', to_id: 'ch_kael', slot: 'pocket', equip_slot: null, quantity: 1 }).ok).toBe(true);
    expect(run(ctx, 'log_event', logEvent('Te guardas la daga en el bolsillo.')).closed).toBe(true);
  });
});

/** Lo que guarda el motor mientras el máster narra el desenlace de una reacción (engine.ts, resolveReaction). */
function inReactionOutcome(engine: Engine, fromId: string, targetId: string, success: boolean): void {
  (engine as unknown as { reactionOutcome: Map<string, { target_id: string; success: boolean }> }).reactionOutcome.set(fromId, { target_id: targetId, success });
}

// Pareja pícaro con novato (20261125-1115), acción 36: «Juego de manos 13 contra Percepción 5: ganas tú. Lo consigues.»
const PICARO_36 = 'Ciro no se deja: aparta la bolsa con el codo y te clava la mirada. «Ni se te ocurra, que esa plata es para el viaje». Tu mano se detiene a un dedo de su cinto, y la sostienes ahí, sin fingir que no era eso lo que querías. Ciro sigue mirándote, pero no dice nada más.';

describe('arreglo 2: desenlace contra la tirada enfrentada', () => {
  it('pícaro 36: gana la enfrentada y la narración dice que la mano se detiene; se rechaza y a la segunda pasa', async () => {
    const { engine } = await bootEngine();
    inReactionOutcome(engine, 'ch_kael', 'ch_mira', true);
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'reaction_rejections', { roll_category: 'exito_claro' }), logEvent(PICARO_36));
    expect(err).toContain('ha PERDIDO la tirada enfrentada');
    expect(err).toContain('«tu mano se detiene»');
    expect(err).toContain('transfer_item o take_coins');
  });

  it('lo que hace el otro al resistirse sí se cuenta; perder y narrar que lo consigue, no', async () => {
    expect(reactionOutcomeMismatch(true, 'Ciro aparta la bolsa con el codo, tarde: sus monedas ya están en tu manga.')).toBeNull();
    expect(reactionOutcomeMismatch(false, 'Ciro te aparta la mano de un manotazo. No lo consigues.')).toBeNull();
    expect(reactionOutcomeMismatch(false, 'Le quitas la moneda sin que se entere.')).toBe('le quitas');
    const { engine } = await bootEngine();
    inReactionOutcome(engine, 'ch_kael', 'ch_mira', false);
    expect(rejectsOnceThenPasses(ctxOnly(engine, 'reaction_rejections', { roll_category: 'fallo' }), logEvent('Le quitas la moneda sin que se entere.'))).toContain('ha GANADO la tirada enfrentada');
  });

  it('sin reacción de por medio no se mira', async () => {
    const { engine } = await bootEngine();
    expect(run(ctxOnly(engine, 'reaction_rejections'), 'log_event', logEvent(PICARO_36)).closed).toBe(true);
  });
});

// Violento (20261125-1652, Opus), turno 3: Atletismo 11, éxito, y Hugo golpea sin tirada (14 → 11 PG).
const VIOLENTO_3 = 'Le cierras el puño en el brazo y lo arrastras contra el banco. Las limas saltan. Hugo no forcejea: se suelta de un tirón y te mete el martillo de fragua en las costillas. Corto, seco, como quien endereza una herradura. Te duele más de lo que pesa.';
// Pareja violento con pausado (20261125-1115), acción 31.
const VIOLENTO_31 = 'Trastabillas hacia atrás y el yunque te frena las caderas. Hugo se vuelve hacia ti con el martillo de fragua y no mira al suelo: se lanza contra ti. El golpe te alcanza en el costado y te deja sin aire.';

/** Hugo, el herrero, en la barra con Kael (en el mundo de demo es Doro con otro nombre). */
async function withHugo() {
  const { engine } = await bootEngine();
  const hugo = engine.world.npc('npc_doro');
  hugo.name = 'Hugo'; hugo.role = 'herrero'; hugo.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.world.character('ch_kael').knows.push(hugo.id);
  return { engine, hugo };
}

describe('arreglo 12: un NPC que pega sin attack', () => {
  it('violento 3: «te mete el martillo de fragua en las costillas» sin attack de Hugo se rechaza; a la segunda pasa', async () => {
    const { engine } = await withHugo();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'hit_rejections', { roll_category: 'exito_justo' }), logEvent(VIOLENTO_3));
    expect(err).toContain('el golpe de Hugo pasa por attack (attacker_id npc_doro, target_id ch_kael)');
    expect(err).toContain('«te mete el martillo»');
  });

  it('con el attack de Hugo en el turno, pasa; violento 31 en la pareja, igual', async () => {
    const { engine } = await withHugo();
    expect(run(ctxOnly(engine, 'hit_rejections', { npc_turns: new Set(['npc_doro']) }), 'log_event', logEvent(VIOLENTO_3)).closed).toBe(true);
    const npcs = [{ id: 'npc_doro', refs: ['Hugo', 'herrero'] }];
    expect(npcHitWithoutAttack({ narration: VIOLENTO_31, npcs, struck: new Set() })).toEqual({ npc_id: 'npc_doro', phrase: 'golpe te alcanza' });
    expect(npcHitWithoutAttack({ narration: 'Hugo levanta el martillo, pero no llega a golpearte. «Si me vuelves a tocar, te parto la cara.»', npcs, struck: new Set() })).toBeNull();
    expect(npcHitWithoutAttack({ narration: 'Hugo te da la espalda y sigue con la herradura.', npcs, struck: new Set() })).toBeNull();
    expect(npcHitWithoutAttack({ narration: 'Hugo amaga con el martillo y te mete el miedo en el cuerpo.', npcs, struck: new Set() })).toBeNull();
  });

  it('apply_damage al actor con el martillo de Hugo: el golpe va por attack; a la segunda pasa', async () => {
    const { engine } = await withHugo();
    const ctx = ctxOnly(engine, 'hit_rejections', { action_text: 'Agarro a Hugo por la pechera.' });
    const hp = engine.world.character('ch_kael').hp_current;
    const first = run(ctx, 'apply_damage', { target_id: 'ch_kael', amount: 3, damage_type: 'bludgeoning', source: 'martillo de Hugo' });
    expect(first.error).toBe('npc_blow');
    expect(first.hint).toContain('attack (attacker_id npc_doro, target_id ch_kael)');
    expect(engine.world.character('ch_kael').hp_current).toBe(hp);
    expect(run(ctx, 'apply_damage', { target_id: 'ch_kael', amount: 3, damage_type: 'bludgeoning', source: 'martillo de Hugo' }).ok).toBe(true);
    // Lo aplicado por apply_damage ya cuenta como su golpe: el cierre que lo narra pasa.
    expect(run(ctx, 'log_event', logEvent(VIOLENTO_3)).closed).toBe(true);
    // El daño del mundo no pasa por attack; ni el golpe no letal de quien no es de pelear (combat.ts, nonLethalSource).
    // (Con una cifra fija sin dado, el daño del mundo se rechaza una vez y pide expr, severity o fall_m: test/dano-mundo-2026-11-26.test.ts.)
    expect(run(ctxOnly(engine, 'hit_rejections', { action_text: 'Me acerco a la fragua.' }), 'apply_damage', { target_id: 'ch_kael', amount: 1, damage_type: 'fire', source: 'las brasas de la fragua' }).error).toBe('fixed_damage');
    expect(run(ctxOnly(engine, 'hit_rejections', { action_text: 'Me acerco a la fragua.' }), 'apply_damage', { target_id: 'ch_kael', amount: 1, damage_type: 'fire', source: 'las brasas de la fragua', expr: '1d4' }).ok).toBe(true);
    engine.world.npc('npc_brenna').noncombatant = true;
    expect(run(ctxOnly(engine, 'hit_rejections', { action_text: 'Brenna, aparta.' }), 'apply_damage', { target_id: 'ch_kael', amount: 1, damage_type: 'bludgeoning', source: 'Brenna' }).ok).toBe(true);
  });
});
