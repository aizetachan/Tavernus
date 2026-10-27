import { describe, expect, it } from 'vitest';
import { GAME_DAY } from '../src/clock/clock.js';
import { activeJobs, addPractice, buyFromNpc, completeJob, grantClue, rotateBoard, sellToNpc } from '../src/engine/progress.js';
import { spawnItem } from '../src/engine/inventory.js';
import { skillModifier } from '../src/engine/rules.js';
import { bootEngine, fakeTime, freshWorld } from './helpers.js';

describe('progreso de la demo', () => {
  it('el tablón arranca con 3 encargos y rota cada día de juego', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const first = activeJobs(engine.world).map((j) => j.id);
    expect(first).toHaveLength(3);
    expect(engine.events.all().some((e) => e.action_type === 'board' && e.visibility === 'public')).toBe(true);
    expect(await engine.command('ch_kael', '/tablon')).toContain(activeJobs(engine.world)[0]!.title);
    time.advanceGame(GAME_DAY);
    await engine.tick();
    const second = activeJobs(engine.world).map((j) => j.id);
    expect(second).toHaveLength(3);
    expect(second).not.toEqual(first);
  });

  it('pistas: una vez por personaje, suman reputación; el logro llega con 3 pistas y reputación 5', () => {
    const { world } = freshWorld();
    rotateBoard(world, 0, true);
    const kael = world.character('ch_kael');
    expect(grantClue(world, kael, 'clue_hacha')).toMatchObject({ ok: true });
    expect(grantClue(world, kael, 'clue_hacha')).toMatchObject({ ok: false });
    expect(grantClue(world, kael, 'clue_x')).toMatchObject({ ok: false });
    grantClue(world, kael, 'clue_pozo');
    const r = grantClue(world, kael, 'clue_doro');
    expect(kael.reputation['fac_brezal']).toBe(6);
    expect(kael.clues).toHaveLength(3);
    if (!r.ok) throw new Error('fail');
    expect(r.events.map((e) => e.kind)).toEqual(['clue', 'achievement']);
    expect(r.events[1]!.public).toContain('Kael ha mirado la ceniza de frente');
    expect(world.itemsCarriedBy(kael.id).some((i) => i.item_id === 'it_llave_vharn')).toBe(true);
    expect(world.spot('sp_tab_habitacion').discovered_by).toContain('ch_kael');
    // Ya no se repite.
    expect(grantClue(world, kael, 'clue_brenna')).toMatchObject({ ok: true });
    expect(kael.achievements).toHaveLength(1);
  });

  it('encargo de entrega: valida cantidad, quita los objetos, paga y sube reputación; no se repite', () => {
    const { world } = freshWorld();
    rotateBoard(world, 0, true);
    const kael = world.character('ch_kael');
    const jobId = 'job_lena';
    world.campaign.board.active_job_ids = [jobId];
    expect(completeJob(world, kael, jobId, 'npc_brenna')).toMatchObject({ ok: false, reason: expect.stringContaining('faltan 10') });
    expect(spawnItem(world, 'it_madera', 2, { type: 'container', id: 'ii_kael_mochila' }).ok).toBe(true); // la mochila no aguanta más peso
    expect(completeJob(world, kael, jobId, 'npc_brenna')).toMatchObject({ ok: false, reason: expect.stringContaining('faltan 8') });
    kael.location = { type: 'spot', id: 'sp_tab_chimenea' };
    spawnItem(world, 'it_madera', 8, { type: 'spot', id: 'sp_tab_chimenea' });
    // Coge los 8 del suelo con las dos manos libres: primero suelta la daga.
    world.itemInstance('ii_kael_daga').location = { type: 'spot', id: 'sp_tab_chimenea' };
    const floor = world.itemsIn({ type: 'spot', id: 'sp_tab_chimenea' }).find((i) => i.item_id === 'it_madera')!;
    floor.location = { type: 'character', id: kael.id, slot: { kind: 'hand', which: 'main' } };
    expect(completeJob(world, kael, jobId, 'npc_brenna')).toMatchObject({ ok: false, reason: 'Brenna no está aquí' });
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    expect(completeJob(world, kael, jobId, 'npc_doro')).toMatchObject({ ok: false });
    const coins = kael.coins;
    const r = completeJob(world, kael, jobId, 'npc_brenna');
    expect(r).toMatchObject({ ok: true });
    expect(kael.coins).toBe(coins + 60);
    expect(kael.reputation['fac_brezal']).toBe(1);
    expect(world.itemsCarriedBy(kael.id).filter((i) => i.item_id === 'it_madera').reduce((a, i) => a + i.quantity, 0)).toBe(0);
    expect(world.itemsIn({ type: 'npc', id: 'npc_brenna' }).reduce((a, i) => a + i.quantity, 0)).toBe(10);
    expect(completeJob(world, kael, jobId, 'npc_brenna')).toMatchObject({ ok: false, reason: expect.stringContaining('ya lo completó') });
  });

  it('práctica: competencia a los 10 usos, +1 a los 30, +2 a los 60', () => {
    const { world } = freshWorld();
    const mira = world.character('ch_mira'); // sin competencia en survival; SAB 15 → +2
    expect(skillModifier(mira, 'survival')).toBe(2);
    let notices = 0;
    for (let i = 0; i < 60; i++) if (addPractice(world, mira, 'survival')) notices++;
    expect(notices).toBe(3);
    expect(mira.proficiencies.skills).toContain('survival');
    expect(mira.practice_bonus['survival']).toBe(2);
    expect(skillModifier(mira, 'survival')).toBe(2 + 2 + 2); // mod + competencia + práctica
  });

  it('vender y comprar con Brenna a precio de lista', () => {
    const { world } = freshWorld();
    const kael = world.character('ch_kael');
    spawnItem(world, 'it_madera', 3, { type: 'container', id: 'ii_kael_mochila' });
    const wood = world.itemsCarriedBy(kael.id).find((i) => i.item_id === 'it_madera')!;
    expect(sellToNpc(world, kael, 'npc_doro', wood.id)).toMatchObject({ ok: false });
    const coins = kael.coins;
    expect(sellToNpc(world, kael, 'npc_brenna', wood.id, 2)).toEqual({ ok: true, item: 'leña', quantity: 2, total: 6 });
    expect(kael.coins).toBe(coins + 6);
    expect(buyFromNpc(world, kael, 'npc_brenna', 'it_cerveza', 1)).toEqual({ ok: true, item: 'jarra de cerveza', quantity: 1, total: 4, unlocked: [] });
    expect(kael.coins).toBe(coins + 2);
    expect(buyFromNpc(world, kael, 'npc_brenna', 'it_daga', 1)).toMatchObject({ ok: false });
    kael.coins = 1;
    expect(buyFromNpc(world, kael, 'npc_brenna', 'it_cerveza', 1)).toMatchObject({ ok: false, reason: 'faltan 3 de cobre' });
  });
});
