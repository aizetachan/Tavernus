import { describe, expect, it } from 'vitest';
import { actionContext, NO_WITNESSES, OLD_EVENT_CHARS, RECENT_EVENTS } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Delivery } from '../src/engine/events.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { bootEngine, fakeTime } from './helpers.js';

const place = (e: Engine, id: string, spot: string) => { e.world.character(id).location = { type: 'spot', id: spot }; };
const ctxOf = (e: Engine, text = 'miro alrededor') => actionContext(e, e.world.character('ch_kael'), text);
const section = (ctx: string, title: string) => ctx.split(/\n\n(?=## )/).find((s) => s.startsWith(`## ${title}`)) ?? '';

describe('contexto del máster: pistas y tablón', () => {
  it('trae con su "cómo" las pistas ancladas a la localización o a un NPC presente; las demás, solo contadas', async () => {
    const { engine } = await bootEngine();
    place(engine, 'ch_kael', 'sp_tab_barra');
    const ctx = ctxOf(engine);
    expect(ctx).toContain('[clue_trampilla]: Descubrir la trampilla'); // anclada a la taberna
    expect(ctx).toContain('[clue_brenna]: Brenna admite'); // anclada a Brenna, que está en la barra
    expect(ctx).not.toContain('clue_hacha'); // del claro
    expect(ctx).not.toContain('clue_doro'); // Doro está en la plaza
    expect(ctx).toContain('Otras 3 pistas sin obtener');

    place(engine, 'ch_kael', 'sp_pl_tablon');
    const plaza = ctxOf(engine);
    expect(plaza).toContain('[clue_pozo]');
    expect(plaza).toContain('[clue_doro]');
    expect(plaza).not.toContain('clue_brenna');
    expect(plaza).not.toContain('clue_trampilla');
  });

  it('una pista sin anclas va siempre, y una ya obtenida no se repite', async () => {
    const { engine } = await bootEngine();
    const camp = engine.world.campaign;
    camp.clues.push({ id: 'clue_libre', title: 'Rumor suelto', how: 'Cualquiera puede contarlo.', reputation: 1 });
    engine.world.character('ch_kael').clues.push('clue_trampilla');
    place(engine, 'ch_kael', 'sp_tab_barra');
    const ctx = ctxOf(engine);
    expect(ctx).toContain('[clue_libre]: Cualquiera puede contarlo.');
    expect(ctx).not.toContain('[clue_trampilla]');
    expect(ctx).toContain('Pistas del actor: Lo que hay bajo la taberna.');
  });

  it('los encargos van en una línea, con título e ID', async () => {
    const { engine } = await bootEngine();
    const brezal = section(ctxOf(engine), 'Brezal');
    const jobLines = brezal.split('\n').filter((l) => /\[job_\w+\]/.test(l));
    expect(jobLines).toHaveLength(1);
    expect(jobLines[0]).toMatch(/^Tablón: .+\[job_\w+\] · .+\[job_\w+\] · .+\[job_\w+\]\.$/);
    expect(brezal).not.toContain('Paga');
  });

  it('get_campaign_notes devuelve todas las pistas pendientes con su "cómo" y los encargos completos', async () => {
    const { engine } = await bootEngine();
    const actor = engine.world.character('ch_kael');
    actor.clues.push('clue_pozo');
    const ctx: ToolContext = { engine, actor, nowGameS: engine.gameNow(), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    const notes = JSON.parse(executeTool(ctx, 'get_campaign_notes', { unused: null })) as {
      clues_pending: { id: string; how: string; where: string[] }[]; clues_obtained: string[];
      board: { id: string; text: string; giver: string; reward_coins: number }[];
    };
    expect(notes.clues_pending.map((c) => c.id)).toEqual(['clue_hacha', 'clue_brenna', 'clue_doro', 'clue_trampilla']);
    expect(notes.clues_pending.find((c) => c.id === 'clue_hacha')).toMatchObject({ where: ['Claro del Roble'] });
    expect(notes.clues_pending.every((c) => c.how.length > 20)).toBe(true);
    expect(notes.clues_obtained).toEqual(['Ceniza en el agua del pozo']);
    expect(notes.board).toHaveLength(3);
    expect(notes.board[0]).toMatchObject({ text: expect.any(String), giver: expect.stringMatching(/\[npc_\w+\]$/), reward_coins: expect.any(Number) });
  });

  it('una partida guardada sin anclas las toma de la semilla al arrancar', async () => {
    const repo = new MemoryRepository();
    const saved = makeSeed();
    for (const c of saved.campaign.clues) { delete c.location_ids; delete c.npc_ids; }
    await repo.saveSnapshot(saved);
    const engine = await Engine.boot({ repo, campaignId: 'demo', seed: makeSeed(), now: fakeTime().now });
    expect(engine.world.campaign.clues.find((c) => c.id === 'clue_trampilla')?.location_ids).toEqual(['loc_taberna']);
    expect(engine.world.campaign.clues.find((c) => c.id === 'clue_doro')?.npc_ids).toEqual(['npc_doro']);
  });
});

describe('contexto del máster: testigos', () => {
  it('sin nadie que pueda percibir al actor, avisa de que observable va a null; con un testigo, no', async () => {
    const { engine } = await bootEngine();
    place(engine, 'ch_kael', 'sp_tab_barra');
    place(engine, 'ch_mira', 'sp_pl_pozo'); // otra localización
    expect(ctxOf(engine)).toContain(NO_WITNESSES);
    place(engine, 'ch_mira', 'sp_tab_mesa'); // misma sala
    expect(ctxOf(engine)).not.toContain(NO_WITNESSES);
  });

  it('un NPC delante no cuenta como testigo: observable solo lo reciben personajes', async () => {
    const { engine } = await bootEngine();
    place(engine, 'ch_kael', 'sp_tab_barra'); // con Brenna
    place(engine, 'ch_mira', 'sp_pl_pozo');
    expect(ctxOf(engine)).toContain(NO_WITNESSES);
  });

  it('log_event acepta null en observable y observable_vague, y la entrega no manda nada a los testigos', async () => {
    const { engine } = await bootEngine();
    place(engine, 'ch_mira', 'sp_tab_mesa');
    const actor = engine.world.character('ch_kael');
    const ctx: ToolContext = { engine, actor, nowGameS: engine.gameNow(), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    const r = JSON.parse(executeTool(ctx, 'log_event', {
      narration_private: 'Miras la barra.', observable: null, observable_vague: null, loudness: 1, tags: 'exploration', suggested_actions: '',
      requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
      decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false,
    }));
    expect(r).toMatchObject({ ok: true });
    expect(ctx.closed).toMatchObject({ observable: null, observable_vague: null });

    const got: Delivery[] = [];
    engine.onDelivery((d) => got.push(d));
    const ev = engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', narration_private: ctx.closed!.narration_private, observable: null, payload: { observable_vague: undefined } });
    expect(ev.delivered_to.map((d) => d.character_id)).toContain('ch_mira'); // la percibe…
    expect(got.map((d) => d.character_id)).toEqual(['ch_kael']); // …pero no recibe texto
  });
});

describe('contexto del máster: eventos y memoria', () => {
  it(`trae los ${RECENT_EVENTS} últimos eventos: los dos últimos íntegros y los anteriores recortados`, async () => {
    const { engine } = await bootEngine();
    const long = (i: number) => `Evento ${i}. ${'Pasa algo largo y lento en la taberna mientras el fuego cruje. '.repeat(6)}Fin ${i}.`;
    for (let i = 1; i <= 9; i++) engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', narration_private: long(i), observable: null });
    const lines = section(ctxOf(engine), 'Últimos eventos').split('\n').slice(1);
    expect(lines).toHaveLength(RECENT_EVENTS);
    expect(lines.map((l) => /Evento (\d+)\./.exec(l)?.[1])).toEqual(['4', '5', '6', '7', '8', '9']);
    expect(lines[4]).toContain(long(8));
    expect(lines[5]).toContain(long(9));
    for (const l of lines.slice(0, 4)) {
      const text = l.replace(/^- \[[^\]]+\] /, '');
      expect(text.endsWith('…')).toBe(true);
      expect(text.length).toBeLessThanOrEqual(OLD_EVENT_CHARS + 1);
      expect(text).not.toContain('Fin');
    }
  });

  it('un evento corto anterior a los dos últimos no se recorta ni lleva "…"', async () => {
    const { engine } = await bootEngine();
    engine.events.emit({ actor_id: 'ch_kael', action_type: 'roll', narration_private: 'Tiras Percepción: 14.', observable: null });
    engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', narration_private: 'Uno.', observable: null });
    engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', narration_private: 'Dos.', observable: null });
    expect(section(ctxOf(engine), 'Últimos eventos')).toContain('] Tiras Percepción: 14.\n');
  });

  it('de otros personajes, el NPC solo recuerda lo de importancia 3', async () => {
    const { engine } = await bootEngine();
    engine.world.npc('npc_brenna').memory.push(
      { character_id: 'ch_mira', game_s: 0, note: 'Le debe treinta monedas.', importance: 2 },
      { character_id: 'ch_mira', game_s: 0, note: 'Le salvó la vida.', importance: 3 },
    );
    const ctx = ctxOf(engine);
    expect(ctx).toContain('Recuerda de otros: Mira: Le salvó la vida.');
    expect(ctx).not.toContain('treinta monedas');
    expect(ctx).toContain('Vende: jarra de cerveza');
    expect(ctx).toContain('NUNCA lo reveles ni lo insinúes por tu cuenta): Estuvo en Vharn');
  });
});

describe('places_learned: el máster revela lugares', () => {
  const logEvent = (engine: Engine, places: string | null) => {
    const actor = engine.world.character('ch_kael');
    const ctx: ToolContext = { engine, actor, nowGameS: engine.gameNow(), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    return JSON.parse(executeTool(ctx, 'log_event', {
      narration_private: 'Te hablan de un sitio.', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
      requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
      decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: places, introduces_self: false,
    }));
  };

  it('el contexto lista los lugares desconocidos de la región solo si hay alguno; log_event los pasa a heard_of', async () => {
    const { engine } = await bootEngine();
    const world = engine.world;
    // En la demo Kael ya conoce todo (el claro de oídas): sin línea.
    expect(ctxOf(engine)).not.toContain('Lugares de la región que el actor aún no conoce');
    world.spots.set('sp_cueva', { id: 'sp_cueva', location_id: 'loc_cueva', name: 'la boca', aliases: [], description: 'Boca de cueva.', x: 0, y: 0, capacity: null, hidden: false, discovered_by: [], state: {}, tags: [], terrain_multiplier: 1, entry_cost_s: 0, links: [] });
    world.locations.set('loc_cueva', { id: 'loc_cueva', zone_id: 'zn_fresnos', name: 'Cueva del Hollín', description_base: 'Una cueva.', default_spot_id: 'sp_cueva', indoor: true, ambience: { light: 'night_dark', noise: 0 }, state: {}, discovery: {} });
    expect(ctxOf(engine)).toContain('Lugares de la región que el actor aún no conoce (si alguien los nombra en la ficción, ponlos en places_learned): Cueva del Hollín [loc_cueva] (Bosque de Fresnos)');

    expect(logEvent(engine, 'loc_cueva, loc_nada, loc_plaza')).toMatchObject({ ok: true });
    expect(world.location('loc_cueva').discovery['ch_kael']).toBe('heard_of');
    expect(world.location('loc_plaza').discovery['ch_kael']).toBe('visited'); // no se degrada
    expect(ctxOf(engine)).not.toContain('Lugares de la región que el actor aún no conoce');
    expect(logEvent(engine, null)).toMatchObject({ ok: true });
  });
});
