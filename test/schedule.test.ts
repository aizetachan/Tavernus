import { afterEach, describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import { seededRng } from '../src/engine/dice.js';
import type { Delivery } from '../src/engine/events.js';
import type { Engine } from '../src/engine/engine.js';
import { describeSurroundings } from '../src/engine/narrate.js';
import { addScheduledEvent, allScheduled, crowdPhrase, nextStart, occurrenceAt, parseCrowd, routineOf, slotAt } from '../src/engine/schedule.js';
import { bootEngine, fakeTime, freshWorld } from './helpers.js';

/** El mundo arranca a las 08:00 del día 0. Lleva el reloj a esa hora de juego (decimal) del día 0 y ticka. */
async function at(engine: Engine, time: ReturnType<typeof fakeTime>, hour: number, day = 0): Promise<void> {
  time.advanceGame(day * GAME_DAY + hour * GAME_HOUR - engine.gameNow());
  await engine.tick();
}

function listen(engine: Engine): Delivery[] {
  const got: Delivery[] = [];
  engine.events.onDelivery((d) => got.push(d));
  return got;
}

const ctxFor = (engine: Engine, id: string) => actionContext(engine, engine.world.character(id), 'miro alrededor');

describe('agenda: calendario', () => {
  it('un evento está activo solo a su hora, y la recurrencia diaria se repite cada día', () => {
    const { world } = freshWorld();
    const mercado = allScheduled(world).find((e) => e.id === 'se_mercado')!;
    expect(occurrenceAt(world, mercado, 8 * GAME_HOUR)).toBeNull();
    expect(occurrenceAt(world, mercado, 10 * GAME_HOUR)).toEqual({ start_s: 9 * GAME_HOUR, end_s: 13 * GAME_HOUR });
    expect(occurrenceAt(world, mercado, 13 * GAME_HOUR)).toBeNull();
    expect(occurrenceAt(world, mercado, GAME_DAY + 12 * GAME_HOUR)).toEqual({ start_s: GAME_DAY + 9 * GAME_HOUR, end_s: GAME_DAY + 13 * GAME_HOUR });
    expect(nextStart(world, mercado, 10 * GAME_HOUR)).toBe(GAME_DAY + 9 * GAME_HOUR);
  });

  it('semanal solo el día que toca; único una vez y no más', () => {
    const { world } = freshWorld();
    const w = addScheduledEvent(world, { title: 'la feria', location_id: 'loc_plaza', start_h: 10, duration_min: 120, recurrence: 'weekly', weekday: 'Miércoles', description: 'Feria de ganado.' }, 8 * GAME_HOUR);
    expect(w.ok).toBe(true);
    const feria = w.ok ? w.event : null!;
    expect(occurrenceAt(world, feria, 11 * GAME_HOUR)).toBeNull(); // día 0 = Lunes
    expect(occurrenceAt(world, feria, 2 * GAME_DAY + 11 * GAME_HOUR)).not.toBeNull();
    expect(nextStart(world, feria, 8 * GAME_HOUR)).toBe(2 * GAME_DAY + 10 * GAME_HOUR);
    const o = addScheduledEvent(world, { title: 'el pregón', location_id: 'loc_plaza', start_h: 7, duration_min: 30, recurrence: 'once', days_from_now: 0, description: 'Un pregonero.' }, 8 * GAME_HOUR);
    // A las 7 ya pasó: queda para mañana.
    expect(o.ok && o.event.at_game_s).toBe(GAME_DAY + 7 * GAME_HOUR);
    expect(o.ok && nextStart(world, o.event, GAME_DAY + 8 * GAME_HOUR)).toBe(null);
  });

  it('franjas de horario: día, tarde (cae al día si falta) y noche desde la puesta de sol', () => {
    const { world } = freshWorld();
    expect(slotAt(world, 8 * GAME_HOUR)).toBe('day');
    expect(slotAt(world, 15 * GAME_HOUR)).toBe('afternoon');
    expect(slotAt(world, 21 * GAME_HOUR)).toBe('night');
    expect(slotAt(world, 3 * GAME_HOUR)).toBe('night');
    expect(routineOf(world.npc('npc_brenna'))).toEqual({ day: 'sp_tab_barra', night: 'sp_tab_mesa' });
  });

  it('figurantes: «feligreses ×12» se lee y se cuenta en castellano', () => {
    expect(parseCrowd('feligreses ×12; 3 buhoneros; una docena de vecinas')).toEqual([
      { label: 'feligreses', count: 12 }, { label: 'buhoneros', count: 3 }, { label: 'vecinas', count: 12 },
    ]);
    expect(crowdPhrase({ label: 'feligreses', count: 12 })).toBe('una docena de feligreses');
    expect(crowdPhrase({ label: 'personas', count: 30 })).toBe('unas treinta personas');
    expect(crowdPhrase({ label: 'vecinos', count: 20 })).toBe('unos veinte vecinos');
  });
});

describe('agenda: el motor la cumple', () => {
  it('a su hora el NPC va al evento y al acabar vuelve a su sitio (a su franja si tiene horario)', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    await at(engine, time, 19.9);
    expect(engine.world.npc('npc_brenna').location.id).toBe('sp_tab_barra');
    await at(engine, time, 20.1);
    expect(engine.world.npc('npc_brenna').location.id).toBe('sp_pl_pozo');
    await at(engine, time, 21.1);
    // Termina la misa: de noche, Brenna está en la mesa del fondo.
    expect(engine.world.npc('npc_brenna').location.id).toBe('sp_tab_mesa');
    await at(engine, time, 7, 1);
    expect(engine.world.npc('npc_brenna').location.id).toBe('sp_tab_barra');
  });

  it('un NPC sin horario vuelve a donde estaba; un evento único se borra al acabar', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const r = addScheduledEvent(engine.world, { title: 'la caza', location_id: 'loc_claro', spot_id: 'sp_cl_roble', start_h: 10, duration_min: 30, recurrence: 'once', description: 'El lobo ronda el roble.', npc_ids: ['npc_lobo'] }, engine.gameNow());
    expect(r.ok).toBe(true);
    await at(engine, time, 10.1);
    expect(engine.world.npc('npc_lobo').location.id).toBe('sp_cl_roble');
    await at(engine, time, 10.6);
    expect(engine.world.npc('npc_lobo').location.id).toBe('sp_cl_arroyo');
    expect(allScheduled(engine.world).some((e) => e.title === 'la caza')).toBe(false);
  });

  it('los efectos se aplican mientras dura y se deshacen al acabar', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const plaza = engine.world.location('loc_plaza');
    expect(plaza.ambience.noise).toBe(0.2);
    await at(engine, time, 9.5);
    expect(plaza.ambience.noise).toBe(0.5);
    expect(plaza.state['mercado']).toBeTruthy();
    await at(engine, time, 13.2);
    expect(plaza.ambience.noise).toBe(0.2);
    expect('mercado' in plaza.state).toBe(false);
  });

  it('el aviso por plantilla lo recibe quien está allí; quien está al lado solo oye el ruido; quien está lejos, nada', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    // Kael en la taberna (al lado de la plaza), Mira en el pozo. Un tercero lejos: Kael en el claro en la segunda prueba.
    const got = listen(engine);
    await at(engine, time, 9.05);
    const start = (id: string) => got.filter((d) => d.character_id === id && d.event.action_type === 'scheduled_start');
    const echo = (id: string) => got.filter((d) => d.character_id === id && d.event.action_type === 'scheduled_echo');
    expect(start('ch_mira')).toHaveLength(1);
    expect(start('ch_mira')[0]!.text).toMatch(/Empieza a llegar gente/);
    expect(start('ch_mira')[0]!.event.payload['master']).toBeNull();
    expect(start('ch_kael')).toHaveLength(0);
    expect(echo('ch_kael')).toHaveLength(1);
    expect(echo('ch_kael')[0]!.text).toMatch(/Desde Plaza del Pozo llega ruido de gente/);

    // Al día siguiente (recurrencia diaria), con Kael en el claro: a él no le llega nada.
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_roble' };
    got.length = 0;
    await at(engine, time, 9.05, 1);
    expect(start('ch_mira')).toHaveLength(1);
    expect(got.filter((d) => d.character_id === 'ch_kael' && d.event.tags.includes('schedule'))).toHaveLength(0);
  });

  it('quien ve salir o llegar al NPC lo percibe («Brenna se va de la barra»)', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const got = listen(engine);
    await at(engine, time, 20.05);
    const kael = got.filter((d) => d.character_id === 'ch_kael' && d.event.action_type === 'npc_move').map((d) => d.text);
    expect(kael.join(' ')).toMatch(/Brenna se va de la barra, camino de la misa de la tarde/);
    const mira = got.filter((d) => d.character_id === 'ch_mira' && d.event.action_type === 'npc_move').map((d) => d.text);
    expect(mira.join(' ')).toMatch(/llega al pozo para la misa de la tarde/);
  });

  it('un NPC que está hablando con alguien no deja la conversación por su horario; va cuando termina', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const brenna = engine.world.npc('npc_brenna');
    await at(engine, time, 19.95);
    brenna.talking_to = { character_id: 'ch_kael', since_game_s: engine.gameNow() };
    await at(engine, time, 20.02);
    expect(brenna.location.id).toBe('sp_tab_barra');
    brenna.talking_to = null;
    await at(engine, time, 20.1);
    expect(brenna.location.id).toBe('sp_pl_pozo');
  });

  it('un reinicio no repite el arranque: el estado vivo viaja en la campaña', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    await at(engine, time, 9.5);
    const snap = engine.world.snapshot() as { campaign: { schedule_active?: unknown[] } };
    expect(snap.campaign.schedule_active).toHaveLength(1);
    const got = listen(engine);
    await at(engine, time, 10);
    expect(got.filter((d) => d.event.action_type === 'scheduled_start')).toHaveLength(0);
  });
});

describe('agenda: contexto del máster y tools', () => {
  it('«Ahora mismo aquí» con figurantes y NPC ocupados; «Próximo aquí» si falta menos de una hora', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    await at(engine, time, 8.5);
    expect(ctxFor(engine, 'ch_mira')).toMatch(/Próximo aquí: el mercado hoy a las 9:00/);
    expect(ctxFor(engine, 'ch_mira')).not.toMatch(/misa/);
    await at(engine, time, 10);
    const ctx = ctxFor(engine, 'ch_mira');
    expect(ctx).toMatch(/## Agenda/);
    expect(ctx).toMatch(/Ahora mismo aquí: el mercado \(hasta las 13:00, el pozo\), vecinos ×20, buhoneros ×4/);
    // Kael, en la taberna, no tiene el mercado delante.
    expect(ctxFor(engine, 'ch_kael')).not.toMatch(/Ahora mismo aquí/);
    await at(engine, time, 20.2);
    expect(ctxFor(engine, 'ch_mira')).toMatch(/Ahora mismo aquí: la misa de la tarde \(hasta las 21:00, el pozo\), feligreses ×12; ocupados: Brenna \(tabernera\)/);
  });

  it('describeSurroundings cuenta la gente de la agenda como presencia del lugar', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    await at(engine, time, 10);
    const mira = engine.world.character('ch_mira');
    expect(describeSurroundings(engine.world, engine.clock, mira, engine.gameNow())).toMatch(/Ahora mismo: el mercado, con unos veinte vecinos y cuatro buhoneros junto al pozo/);
  });

  it('schedule_event crea (lo anunciado ocurre de verdad), no duplica, y get_schedule lo lista', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const mira = engine.world.character('ch_mira');
    const ctx: ToolContext = { engine, actor: mira, nowGameS: engine.gameNow(), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    const input = {
      title: 'la reunión del concejo', location_id: null, spot_id: 'sp_pl_tablon', start_hour: 18, duration_min: 45, recurrence: 'once',
      weekday: null, days_from_now: 0, description: 'Los vecinos discuten qué hacer con las luces de la montaña.', npc_ids: 'npc_doro',
      crowd: 'vecinos ×8', noise: 0.35, busy_npc_ids: '', start_text: null, end_text: null, told_actor: true,
    };
    const made = JSON.parse(executeTool(ctx, 'schedule_event', input)) as { ok: boolean; event_id: string; existing: boolean };
    expect(made.ok).toBe(true);
    expect(made.existing).toBe(false);
    const again = JSON.parse(executeTool(ctx, 'schedule_event', { ...input, title: 'La reunión del concejo' })) as { event_id: string; existing: boolean };
    expect(again).toMatchObject({ existing: true, event_id: made.event_id });

    const list = JSON.parse(executeTool(ctx, 'get_schedule', { location_id: 'here' })) as { events: { id: string; next: string | null; npcs: string[] }[] };
    expect(list.events.map((e) => e.id)).toEqual(['se_mercado', 'se_misa', made.event_id]);
    expect(list.events.find((e) => e.id === made.event_id)).toMatchObject({ next: 'hoy a las 18:00', npcs: ['Doro (guardia) [npc_doro]'] });
    expect(JSON.parse(executeTool(ctx, 'schedule_event', { ...input, title: 'otra', npc_ids: 'npc_nadie' }))).toMatchObject({ error: expect.stringMatching(/npc_nadie/) });

    // Se lo dijeron a Mira: lo ve como «Próximo aquí» aunque falten horas; Kael no sabe nada.
    expect(ctxFor(engine, 'ch_mira')).toMatch(/Próximo aquí: la reunión del concejo hoy a las 18:00 \(45 min, el tablón\); el actor lo sabe/);
    expect(ctxFor(engine, 'ch_kael')).not.toMatch(/concejo/);

    // A su hora, ocurre: Doro deja el portón, llega gente; al acabar vuelve a su franja.
    const got = listen(engine);
    await at(engine, time, 18.1);
    expect(engine.world.npc('npc_doro').location.id).toBe('sp_pl_tablon');
    expect(got.some((d) => d.character_id === 'ch_mira' && /una docena|unos ocho vecinos/.test(d.text))).toBe(true);
    await at(engine, time, 18.9);
    expect(engine.world.npc('npc_doro').location.id).toBe('sp_pl_porton');
    expect(got.some((d) => d.character_id === 'ch_mira' && /Termina la reunión del concejo/.test(d.text))).toBe(true);
  });
});

describe('agenda: depuración', () => {
  const prev = process.env['MASTER_MODE'];
  afterEach(() => { if (prev === undefined) delete process.env['MASTER_MODE']; else process.env['MASTER_MODE'] = prev; });

  it('/time +2h adelanta el reloj solo en offline, y a esa hora el mercado ya está en marcha', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    delete process.env['MASTER_MODE'];
    await engine.command('ch_mira', '/time +2h');
    expect(Math.round(engine.gameNow() / 60)).toBe(8 * 60);
    process.env['MASTER_MODE'] = 'offline';
    const got = listen(engine);
    const out = await engine.command('ch_mira', '/time +2h');
    expect(out).toMatch(/Reloj adelantado 2 h/);
    expect(Math.round(engine.gameNow() / 60)).toBe(10 * 60);
    expect(engine.world.campaign.game_epoch_s).toBe(10 * GAME_HOUR);
    // Avanza a saltos: el arranque de las 9 se cuenta a su hora a quien está en la plaza.
    expect(got.some((d) => d.character_id === 'ch_mira' && d.event.action_type === 'scheduled_start' && /buhoneros/.test(d.text))).toBe(true);
    expect(engine.world.location('loc_plaza').ambience.noise).toBe(0.5);
  });
});
