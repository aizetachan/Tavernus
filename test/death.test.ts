/**
 * Descanso, muerte y reaparición (issue #23; rest.ts, death.ts). Relojes y
 * dados simulados: `dice(...)` da los valores del rng en orden (rollDie(20):
 * 0.6 → 13, 0.3 → 7, 0 → 1, 0.99 → 20) y luego 0.99.
 */

import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { deathNarration, withoutDeathPhrases } from '../src/engine/closecheck.js';
import { bodiesAt, bodyStateOf, damageCharacter, isDying, isStable } from '../src/engine/death.js';
import type { Engine } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { journalOf } from '../src/engine/journal.js';
import { fateSince } from '../src/engine/prologue.js';
import { hitDiceLeft, parseRest } from '../src/engine/rest.js';
import { bootEngine, fakeTime } from './helpers.js';

function dice(...values: number[]) {
  let i = 0;
  return () => (i < values.length ? values[i++]! : 0.99);
}

function collect(engine: Engine) {
  const by = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { by.set(d.character_id, [...(by.get(d.character_id) ?? []), d]); });
  return (id: string) => (by.get(id) ?? []).map((d) => d.text);
}

/** Kael y Mira en la barra de la taberna. */
async function bar(rng: () => number = () => 0.99) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { rng });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  return { engine, time, kael, mira, seen: collect(engine) };
}

function ctxFor(engine: Engine, actorId: string): ToolContext {
  const actor = engine.world.character(actorId);
  return { engine, actor, nowGameS: engine.nowFor(actor), rng: () => 0.99, closed: null, rolls: [], progress: [] };
}

/** Lo deja a 0 PG cayendo (y cuenta la caída). */
async function down(engine: Engine, id: string) {
  const c = engine.world.character(id);
  damageCharacter(engine.world, c, c.hp_current, { cause: 'un golpe', nowGameS: engine.nowFor(c) });
  await engine.tick();
}

describe('descansos', () => {
  it('se reconocen las órdenes', () => {
    expect(parseRest('dormir')).toEqual({ kind: 'long', dice: null });
    expect(parseRest('descanso corto')).toEqual({ kind: 'short', dice: null });
    expect(parseRest('descansar gastando 2 dados')).toEqual({ kind: 'short', dice: 2 });
    expect(parseRest('ir al pozo')).toBeNull();
  });

  it('corto: gasta dados de golpe, cura, recupera Tomar aliento y adelanta 1 h su reloj', async () => {
    const { engine, kael, mira } = await bar();
    mira.location = { type: 'spot', id: 'sp_pl_pozo' }; // a solas: su reloj adelantado no espera a nadie
    kael.hp_current = 2;
    expect(JSON.parse(executeTool(ctxFor(engine, kael.id), 'spend_resource', { key: 'second_wind', amount: null }))).toMatchObject({ ok: true, left: 0 });
    expect(JSON.parse(executeTool(ctxFor(engine, kael.id), 'spend_resource', { key: 'second_wind', amount: null })).error).toMatch(/no le quedan usos/);
    const before = engine.gameNow();
    const r = await engine.act(kael.id, 'descanso corto');
    expect(r.text).toMatch(/^Descansas una hora/);
    expect(kael.hp_current).toBe(kael.hp_max); // d10 (10) + CON +1 desde 2
    expect(hitDiceLeft(kael)).toBe(0);
    expect(kael.rest!.used['second_wind']).toBeUndefined();
    expect(engine.nowFor(kael) - before).toBeGreaterThanOrEqual(3600);
    // Sin dados ya no cura.
    kael.hp_current = 5;
    expect((await engine.act(kael.id, 'descanso corto')).text).toMatch(/No te quedan dados de golpe/);
  });

  it('largo: PG completos y la mitad de los dados; uno cada 24 h de juego', async () => {
    const { engine, time, kael, mira } = await bar();
    mira.location = { type: 'spot', id: 'sp_pl_pozo' };
    kael.hp_current = 1;
    kael.rest = { hit_dice_used: 1, used: {}, last_long_rest_game_s: null };
    const r = await engine.act(kael.id, 'dormir');
    expect(r.text).toMatch(/^Duermes ocho horas/);
    expect(kael.hp_current).toBe(kael.hp_max);
    expect(hitDiceLeft(kael)).toBe(1);
    expect((await engine.act(kael.id, 'dormir')).text).toMatch(/hace menos de 24 h/);
    time.advanceGame(24 * 3600);
    expect((await engine.act(kael.id, 'dormir')).text).toMatch(/^Duermes ocho horas/);
  });

  it('en un sitio inseguro se interrumpe y no cura; en uno seguro, no', async () => {
    const { engine, kael } = await bar(() => 0); // sale el encuentro
    kael.hp_current = 3;
    const r = await engine.act(kael.id, 'dormir');
    expect(r.text).toMatch(/algo te despierta/);
    expect(r.text).toMatch(/no te cura/);
    expect(kael.hp_current).toBe(3);
    expect(kael.rest?.last_long_rest_game_s ?? null).toBeNull();

    const safe = await bar(() => 0);
    safe.engine.world.spot('sp_tab_barra').tags.push('safe_rest');
    safe.kael.hp_current = 3;
    expect((await safe.engine.act('ch_kael', 'dormir')).text).toMatch(/sin que nadie te moleste/);
    expect(safe.kael.hp_current).toBe(safe.kael.hp_max);
  });

  it('con una amenaza delante no se descansa; el máster tiene take_rest', async () => {
    const { engine, kael } = await bar();
    kael.location = { type: 'spot', id: 'sp_cl_arroyo' };
    engine.world.npc('npc_lobo').attitude.by_character[kael.id] = 'hostile';
    expect((await engine.act(kael.id, 'dormir')).text).toMatch(/amenaza delante/);
    expect(JSON.parse(executeTool(ctxFor(engine, kael.id), 'take_rest', { kind: 'short' })).error).toMatch(/amenaza/);
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    kael.hp_current = 4;
    expect(JSON.parse(executeTool(ctxFor(engine, kael.id), 'take_rest', { kind: 'long' }))).toMatchObject({ ok: true, completed: true, hp: '12/12' });
  });
});

describe('0 PG y salvaciones contra muerte', () => {
  it('cae inconsciente; tres éxitos le estabilizan y a las 1d4 h recupera 1 PG', async () => {
    const { engine, time, kael, mira, seen } = await bar(dice(0.6, 0.6, 0.6, 0));
    await down(engine, kael.id);
    expect(isDying(kael)).toBe(true);
    expect(seen(kael.id).at(-1)).toMatch(/^Caes al suelo, inconsciente/);
    expect(seen(mira.id).at(-1)).toBe('Kael cae al suelo y no se mueve.');
    expect((await engine.act(kael.id, 'mirar')).text).toMatch(/Estás inconsciente, a 0 PG/);
    time.advanceGame(60 + 600 * 2);
    await engine.tick();
    expect(seen(kael.id).filter((t) => t.startsWith('🎲 Salvación contra muerte'))).toHaveLength(3);
    expect(isStable(kael)).toBe(true);
    expect(seen(mira.id).at(-1)).toMatch(/está estable/);
    time.advanceGame(3600); // 1d4 con rng 0 → 1 h
    await engine.tick();
    expect(kael.hp_current).toBe(1);
    expect(kael.status).toBe('active');
  });

  it('tres fallos le matan; un 1 natural cuenta como dos', async () => {
    const { engine, time, kael } = await bar(dice(0, 0.3));
    await down(engine, kael.id);
    time.advanceGame(60);
    await engine.tick();
    expect(kael.dying!.fail).toBe(2);
    time.advanceGame(600);
    await engine.tick();
    expect(kael.status).toBe('dead');
  });

  it('un 20 natural le devuelve 1 PG', async () => {
    const { engine, time, kael, seen } = await bar(dice(0.99));
    await down(engine, kael.id);
    time.advanceGame(60);
    await engine.tick();
    expect(kael.hp_current).toBe(1);
    expect(kael.status).toBe('active');
    expect(seen(kael.id)).toContain('Un aliento más: abres los ojos con 1 PG.');
  });

  it('daño a 0 PG es un fallo y un crítico dos; daño masivo mata en el acto', async () => {
    const { engine, kael } = await bar();
    await down(engine, kael.id);
    expect(damageCharacter(engine.world, kael, 2, { cause: 'patada' }).failures).toBe(1);
    expect(damageCharacter(engine.world, kael, 2, { cause: 'patada', crit: true }).died).toBe(true);
    const m = await bar();
    expect(damageCharacter(m.engine.world, m.kael, 12 + 12, { cause: 'una roca' }).died).toBe(true);
  });

  it('otro PJ le estabiliza con Medicina CD 10, o le cura y despierta', async () => {
    const { engine, kael, mira, seen } = await bar(dice(0.6, 0));
    await down(engine, kael.id);
    const r = await engine.act(mira.id, 'estabilizar a Kael');
    expect(r.text).toMatch(/^🎲 Medicina: .*→ éxito/);
    expect(isStable(kael)).toBe(true);
    expect(seen(kael.id).at(-1)).toMatch(/estás estable \(gracias a Mira\)/);

    const b = await bar();
    await down(b.engine, 'ch_kael');
    expect(JSON.parse(executeTool(ctxFor(b.engine, 'ch_mira'), 'heal', { target_id: 'ch_kael', amount: 4, healer_id: 'ch_mira' }))).toMatchObject({ ok: true, revived: true });
    await b.engine.tick();
    expect(b.kael.status).toBe('active');
    expect(b.seen('ch_kael').at(-1)).toBe('Vuelves en ti: Mira te ha curado. 4/12 PG.');
    expect(journalOf(b.engine, 'ch_kael').chronicle.flatMap((d) => d.entries.map((e) => e.text))).toContain('Vuelves en ti: te salvó Mira.');
  });

  it('un ausente no muere ausente: queda estable y el daño no le suma fallos', async () => {
    const { engine, time, kael } = await bar(dice(0, 0, 0));
    await down(engine, kael.id);
    engine.setAway(kael.id, true);
    expect(isStable(kael)).toBe(true);
    expect(damageCharacter(engine.world, kael, 3, { cause: 'otro golpe' })).toMatchObject({ failures: 0, died: false });
    time.advanceGame(3 * 600);
    await engine.tick();
    expect(kael.status).not.toBe('dead');
  });
});

describe('muerte y vuelta', () => {
  it('casual: cuerpo con sus cosas, aviso a todos, vuelve a las 2 h en el punto de reaparición con la mitad de PG y recoge lo suyo', async () => {
    const { engine, time, kael, mira, seen } = await bar(dice(0, 0));
    const far = engine.world.character('ch_mira');
    await down(engine, kael.id);
    time.advanceGame(60 + 600);
    await engine.tick();
    expect(kael.status).toBe('dead');
    expect(seen(kael.id).some((t) => /^☠ Todo se apaga. Has muerto en la barra.* dentro de 2 h reales \(6 h de juego\)/.test(t))).toBe(true);
    expect(seen(far.id)).toContain('Kael se desploma y deja de respirar.');
    const body = bodiesAt(engine.world, 'sp_tab_barra')[0]!;
    expect(engine.world.itemDef(body.item_id).name).toBe('cuerpo de Kael');
    expect(engine.world.itemsIn({ type: 'container', id: body.id }).map((i) => i.id)).toEqual(expect.arrayContaining(['ii_kael_mochila', 'ii_kael_daga']));
    expect(bodyStateOf(body)!.coins).toBe(1500);
    expect(kael.coins).toBe(0);
    // Casual: nadie más lo toca.
    expect((await engine.act(mira.id, 'saquear el cuerpo de Kael')).text).toMatch(/murió en modo casual/);
    expect(JSON.parse(executeTool(ctxFor(engine, mira.id), 'transfer_item', { instance_id: 'ii_kael_daga', to_type: 'character', to_id: mira.id, slot: 'pocket', equip_slot: '', quantity: null })).error).toBe('not_allowed');
    // El máster ve el cuerpo y que no se levanta.
    expect(actionContext(engine, mira, 'mirar')).toMatch(/cuerpo de Kael \[.+\] en la barra: Kael está MUERTO \(modo casual\)/);

    time.advanceReal(2 * 3600 + 1);
    await engine.tick();
    expect(kael.status).toBe('active');
    expect(engine.world.characterSpot(kael)!.id).toBe('sp_tab_puerta');
    expect(kael.hp_current).toBe(6);
    expect(seen(kael.id).some((t) => /Abres los ojos en la puerta con 6\/12 PG\. Tus cosas siguen donde caíste/.test(t))).toBe(true);
    expect(engine.world.itemDef(body.item_id).name).toBe('las cosas de Kael');
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    const r = await engine.act(kael.id, 'recoger mis cosas');
    expect(r.text).toMatch(/^Recuperas de las cosas de Kael: /);
    expect(engine.world.itemInstance('ii_kael_daga').location).toEqual({ type: 'character', id: kael.id, slot: { kind: 'hand', which: 'main' } });
    expect(kael.coins).toBe(1500);
    expect(engine.world.itemInstances.has(body.id)).toBe(false);
    const chron = journalOf(engine, kael.id).chronicle.flatMap((d) => d.entries.map((e) => e.text));
    expect(chron.some((t) => /^Mueres en .+, la barra\. Tu cuerpo queda allí con .*15 de oro/.test(t))).toBe(true);
    expect(chron.some((t) => t.startsWith('Vuelves de la muerte en la puerta. Tus cosas te esperan en la barra.'))).toBe(true);
  });

  it('hardcore: espera 30 min, vuelve sin nada y con −1 en su mejor característica; su cuerpo se saquea libre', async () => {
    const { engine, time, kael, mira } = await bar();
    kael.death_mode = 'hardcore';
    damageCharacter(engine.world, kael, 40, { cause: 'una roca' });
    await engine.tick();
    expect(kael.status).toBe('dead');
    const r = await engine.act(mira.id, 'saquear el cuerpo de Kael');
    expect(r.text).toMatch(/^Te llevas de cuerpo de Kael: .*15 de oro/);
    expect(mira.coins).toBe(3000);
    time.advanceReal(30 * 60 + 1);
    await engine.tick();
    expect(kael.status).toBe('active');
    expect(kael.abilities.str).toBe(13);
    expect(kael.ability_penalties).toEqual({ str: 1 });
    expect(engine.world.itemsCarriedBy(kael.id)).toHaveLength(0);
    const since = engine.events.all()[0]!;
    expect(fateSince(engine, kael, since)).toMatch(/Moriste en .*De lo que llevabas, ya no está: .*Volviste de la muerte en la puerta, con 1 menos de Fuerza\./);
  });

  it('a un PJ vivo caído no se le saquea sin su consentimiento', async () => {
    const { engine, kael, mira } = await bar();
    await down(engine, kael.id);
    expect((await engine.act(mira.id, 'saquear a Kael')).text).toMatch(/está vivo: sin su consentimiento/);
    expect(JSON.parse(executeTool(ctxFor(engine, mira.id), 'transfer_item', { instance_id: 'ii_kael_daga', to_type: 'character', to_id: mira.id, slot: 'pocket', equip_slot: '', quantity: null })).error).toBe('not_allowed');
    expect(actionContext(engine, mira, 'mirar')).toMatch(/A 0 PG, CAYENDO: salvaciones contra muerte 0 éxitos \/ 0 fallos/);
  });
});

describe('el máster no puede matar ni resucitar por narración', () => {
  it('closecheck: muerte sin estado y vuelta de la muerte, sí; dudas y negaciones, no', () => {
    const others = [{ name: 'Mira', dead: false }];
    expect(deathNarration({ texts: ['El lobo le muerde el cuello y Mira muere en el acto.'], actor: { name: 'Kael', dead: false }, others }).map((h) => h.kind)).toEqual(['death']);
    expect(deathNarration({ texts: ['Todo se vuelve negro. Mueres.'], actor: { name: 'Kael', dead: false }, others })).toHaveLength(1);
    expect(deathNarration({ texts: ['Todo se vuelve negro. Mueres.'], actor: { name: 'Kael', dead: true }, others })).toHaveLength(0);
    expect(deathNarration({ texts: ['Kael resucita entre las velas.'], actor: { name: 'Kael', dead: true }, others }).map((h) => h.kind)).toEqual(['rise']);
    expect(deathNarration({ texts: ['Mira casi muere. Si no la atiendes, Mira morirá.', 'Kael mata al lobo.'], actor: { name: 'Kael', dead: false }, others })).toHaveLength(0);
    const hits = deathNarration({ texts: ['El golpe es brutal. Mira muere. El lobo huye.'], actor: { name: 'Kael', dead: false }, others });
    expect(withoutDeathPhrases('El golpe es brutal. Mira muere. El lobo huye.', hits)).toBe('El golpe es brutal. El lobo huye.');
  });

  it('log_event se rechaza dos veces y a la tercera esas frases se quitan', async () => {
    const { engine } = await bar();
    const ctx = ctxFor(engine, 'ch_kael');
    const close = () => JSON.parse(executeTool(ctx, 'log_event', {
      narration_private: 'Descargas el golpe. Mira muere a tus pies.', observable: null, observable_vague: null, loudness: 1, tags: 'combat', suggested_actions: '',
      requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
      decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null,
      introduces_self: false, target_character_id: null, observable_target: null, lines: null,
    })) as { error?: string; ok?: boolean };
    expect(close().error).toMatch(/^Has narrado Mira \(muerte/);
    expect(close().error).toMatch(/^Has narrado Mira/);
    expect(close().ok).toBe(true);
    expect(ctx.closed!.narration_private).toBe('Descargas el golpe.');
  });
});
