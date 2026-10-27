import { describe, expect, it } from 'vitest';
import { encumbrance, inventoryView, spawnItem, transferItem } from '../src/engine/inventory.js';
import { freshWorld } from './helpers.js';

const hand = (id: string, which: 'main' | 'off' | 'both') => ({ type: 'character' as const, id, slot: { kind: 'hand' as const, which } });
const pocket = (id: string) => ({ type: 'character' as const, id, slot: { kind: 'pocket' as const } });

describe('inventario y capacidad', () => {
  it('un ítem está en exactamente un sitio y se mueve de forma atómica', () => {
    const { world } = freshWorld();
    const r = transferItem(world, 'ii_kael_daga', { type: 'spot', id: 'sp_tab_barra' });
    expect(r.ok).toBe(true);
    expect(world.itemInstance('ii_kael_daga').location).toEqual({ type: 'spot', id: 'sp_tab_barra' });
    expect(world.itemsIn({ type: 'spot', id: 'sp_tab_barra' }).map((i) => i.id)).toEqual(['ii_kael_daga']);
    expect(world.itemsCarriedBy('ch_kael').some((i) => i.id === 'ii_kael_daga')).toBe(false);
  });

  it('no se alcanza lo que está en otro punto', () => {
    const { world } = freshWorld();
    const r = transferItem(world, 'ii_hacha_suelo', hand('ch_kael', 'off'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_reachable');
  });

  it('manos: una por ítem, dos para bulky; no se sobrescriben', () => {
    const { world } = freshWorld();
    const kael = world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_tab_chimenea' };
    // Mano principal ocupada por la daga.
    let r = transferItem(world, 'ii_barril', hand('ch_kael', 'both'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_space');
    // Barril con una mano: slot inválido.
    r = transferItem(world, 'ii_barril', hand('ch_kael', 'off'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_slot');
    // Guardar la daga en el bolsillo y coger el barril con las dos manos.
    expect(transferItem(world, 'ii_kael_daga', pocket('ch_kael')).ok).toBe(true);
    expect(transferItem(world, 'ii_barril', hand('ch_kael', 'both')).ok).toBe(true);
    const v = inventoryView(world, 'ch_kael');
    expect(v.hands).toEqual({ main: 'barril', off: 'barril' });
    expect(v.pockets).toEqual(['daga']);
  });

  it('bolsillos: solo tiny/small y hasta 4 stacks', () => {
    const { world } = freshWorld();
    expect(transferItem(world, 'ii_kael_cuerda', pocket('ch_kael')).ok).toBe(false);
    for (let i = 0; i < 4; i++) expect(spawnItem(world, 'it_pocion', 1, pocket('ch_mira')).ok).toBe(true);
    // 4 pociones se fusionan en un stack: sigue cabiendo otra cosa.
    expect(inventoryView(world, 'ch_mira').pockets).toEqual(['antorcha', 'poción de curación ×4']);
    expect(spawnItem(world, 'it_daga', 1, pocket('ch_mira')).ok).toBe(true);
    expect(spawnItem(world, 'it_bayas', 1, pocket('ch_mira')).ok).toBe(true);
    const r = spawnItem(world, 'it_cuerda', 1, pocket('ch_mira'));
    expect(r.ok).toBe(false);
    const r2 = spawnItem(world, 'it_hacha', 1, pocket('ch_mira'));
    expect(r2.ok).toBe(false);
  });

  it('contenedores: tamaño máximo, slots y peso; bulky nunca cabe', () => {
    const { world } = freshWorld();
    const bag = { type: 'container' as const, id: 'ii_kael_mochila' };
    // Mochila: 20 slots, 30 lb, hasta medium. Ya lleva cuerda (10) + 3 antorchas (3).
    expect(spawnItem(world, 'it_madera', 3, bag).ok).toBe(true);        // +15 → 28 lb
    const heavy = spawnItem(world, 'it_madera', 1, bag);                 // +5 → 33 lb
    expect(heavy.ok).toBe(false);
    if (!heavy.ok) expect(heavy.error.code).toBe('no_space');
    world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_chimenea' };
    const bulky = transferItem(world, 'ii_barril', bag);
    expect(bulky.ok).toBe(false);
    if (!bulky.ok && bulky.error.code === 'no_space') expect(bulky.error.reason).toMatch(/voluminoso/);
  });

  it('un contenedor fijo no se mueve; nada se mete dentro de sí mismo', () => {
    const { world } = freshWorld();
    world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_mesa' };
    const r = transferItem(world, 'ii_cofre', hand('ch_kael', 'both'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('fixed');
    // Cofre grande: la mochila cabe. Meter la mochila en sí misma, no.
    const self = transferItem(world, 'ii_kael_mochila', { type: 'container', id: 'ii_kael_mochila' });
    expect(self.ok).toBe(false);
    // Sacar la poción del cofre a la mano libre.
    expect(transferItem(world, 'ii_cofre_pocion', hand('ch_kael', 'off'), 1).ok).toBe(true);
    expect(world.itemInstance('ii_cofre_pocion').quantity).toBe(1);
    expect(world.itemsIn(hand('ch_kael', 'off'))).toHaveLength(1);
  });

  it('divide y fusiona stacks', () => {
    const { world } = freshWorld();
    // Dos antorchas de la mochila al suelo, luego una vuelve y se fusiona.
    const r = transferItem(world, 'ii_kael_antorchas', { type: 'spot', id: 'sp_tab_barra' }, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.remaining!.quantity).toBe(1);
    expect(r.moved.quantity).toBe(2);
    expect(r.moved.id).not.toBe('ii_kael_antorchas');
    const back = transferItem(world, r.moved.id, { type: 'container', id: 'ii_kael_mochila' }, 1);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.moved.id).toBe('ii_kael_antorchas');
    expect(back.moved.quantity).toBe(2);
    expect(world.itemInstance(r.moved.id).quantity).toBe(1);
    // Cantidad inválida.
    const bad = transferItem(world, 'ii_kael_antorchas', { type: 'spot', id: 'sp_tab_barra' }, 5);
    expect(bad.ok).toBe(false);
  });

  it('carga por Fuerza: cargado, muy cargado, inmóvil', () => {
    const { world } = freshWorld();
    const kael = world.character('ch_kael'); // STR 14: 70 cargado, 140 muy cargado, 210 máximo
    expect(encumbrance(world, kael).level).toBe('ok');
    kael.location = { type: 'spot', id: 'sp_tab_chimenea' };
    transferItem(world, 'ii_kael_daga', pocket('ch_kael'));
    transferItem(world, 'ii_barril', hand('ch_kael', 'both')); // +40 → ~48 (las 1500 de cobre son 15 de oro: 0,3 lb)
    expect(encumbrance(world, kael).level).toBe('ok');
    kael.coins = 150_000; // 1500 de oro: +30 lb
    expect(encumbrance(world, kael).level).toBe('encumbered');
    kael.coins = 500_000; // 5000 de oro: +100 lb
    const e = encumbrance(world, kael);
    expect(e.level).toBe('heavily');
    expect(e.speed_penalty_ft).toBe(20);
    kael.coins = 1_000_000;
    expect(encumbrance(world, kael).level).toBe('immobile');
  });

  it('equipar: slot correcto y libre', () => {
    const { world } = freshWorld();
    const r = spawnItem(world, 'it_mochila', 1, { type: 'character', id: 'ch_kael', slot: { kind: 'equipped', slot: 'back' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_space');
    const bad = spawnItem(world, 'it_daga', 1, { type: 'character', id: 'ch_kael', slot: { kind: 'equipped', slot: 'head' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid_slot');
  });
});
