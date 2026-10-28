/**
 * Alta y avance coherentes de las misiones (story.ts, quests.ts, journal.ts):
 * lo que el jugador ve en el Diario y en el chat tiene que cuadrar con lo que
 * ha vivido. Sale de la partida del 2026-10-26, donde las misiones entraban y
 * avanzaban sin que el jugador supiera por qué (docs/BREZAL.md, §3).
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { characterStory, questsOf, storyContext } from '../src/engine/story.js';
import { journalOf } from '../src/engine/journal.js';
import { activeJobs } from '../src/engine/progress.js';
import { noticeOf } from '../src/adapters/web/journal.js';
import { lastOwnEvent, recapTemplate } from '../src/engine/prologue.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(): Promise<{ engine: Engine; time: ReturnType<typeof fakeTime> }> {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  return { engine, time };
}

async function newPc(engine: Engine, name: string): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  r.character.abilities.str = 18;
  return r.character;
}

function tool(engine: Engine, c: Character, name: string, input: Record<string, unknown>): Record<string, unknown> & { ok?: boolean; error?: string; hint?: string } {
  const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
  return JSON.parse(executeTool(ctx, name, input)) as Record<string, unknown> & { ok?: boolean; error?: string };
}

async function walk(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, spotId: string): Promise<void> {
  if (engine.world.characterSpot(c)?.id === spotId) return;
  const r = tool(engine, c, 'move_to', { character_id: c.id, target_spot_id: spotId, pace: 'walk' });
  expect(r.error, `move_to ${spotId}: ${JSON.stringify(r)}`).toBeUndefined();
  if (c.transit) time.advanceGame(c.transit.arrives_game_s - engine.gameNow() + 2);
  await engine.tick();
  expect(engine.world.characterSpot(c)?.id).toBe(spotId);
}

/** Habla con un NPC: va a donde está y abre la charla, como hace el máster al cerrar un turno con npc_id. */
async function talkTo(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, npcId: string): Promise<void> {
  const n = engine.world.npc(npcId);
  await walk(engine, time, c, n.location.id);
  n.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c) };
  await engine.tick();
}

const questEvents = (engine: Engine, c: Character): GameEvent[] => engine.events.all().filter((e) => e.actor_id === c.id && /^progress_/.test(e.action_type) && e.payload['quest']);
const stepOf = (engine: Engine, c: Character, id: string) => questsOf(engine.world, c).find((v) => v.quest.id === id);

describe('misiones: alta coherente', () => {
  it('lo que se oye no entra en el Diario ni abre la misión, y no cuenta de qué va', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Lia');
    await engine.tick();
    await engine.tick();
    // Empieza en el Jabalí: se oye que Brenna busca a alguien; la misión no se abre.
    expect(characterStory(c).open).toEqual(['q_main_deuda']);
    expect(Object.keys(characterStory(c).rumors ?? {})).toEqual(expect.arrayContaining(['q_cena_doro', 'q_perro']));
    const j = journalOf(engine, c.id);
    expect(j.quests.active.some((q) => q.id === 'q_perro')).toBe(false);
    expect(j.quests.active.some((q) => q.id.startsWith('lead:'))).toBe(false);
    // El perro no sale en lo oído: es de lo que va la misión.
    expect(questEvents(engine, c).map((e) => e.narration_private).join('\n')).not.toMatch(/perro/);
    // Cuando Brenna la pide, entra la misión.
    await talkTo(engine, time, c, 'npc_brenna');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_perro', action: 'ask' }).ok).toBe(true);
    expect(journalOf(engine, c.id).quests.active.some((q) => q.id === 'q_perro')).toBe(true);
  });

  it('quien la da la pide al hablar con el PJ y entra en el Diario; el máster lo sabe, y el origen dice la verdad', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Bru');
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(tool(engine, c, 'transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: 1 }).error).toBeUndefined();
    await walk(engine, time, c, 'sp_cu_hierbas');
    // Estar en su casa, sin hablar, no la abre: el máster sabe que Ilse puede pedirla.
    expect(characterStory(c).open).not.toContain('q_agua');
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('Ilse puede pedirle «El agua turbia» [q_agua]');
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_agua', step_id: 'ilse' }).error).toMatch(/no la tiene el actor \(available\)/);
    await talkTo(engine, time, c, 'npc_ilse');
    expect(characterStory(c).open).toContain('q_agua');
    expect(characterStory(c).origins!['q_agua']).toMatchObject({ kind: 'giver', text: 'Ilse nos lo pidió', location_id: 'loc_curandera' });
    expect(c.knows).toContain('npc_ilse'); // quien te pide algo se presenta
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('En curso · acto 1 · «El agua turbia» [q_agua] (nivel 1; la pidió Ilse)');
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('Ilse acaba de pedirle «El agua turbia» [q_agua]');
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('Paso en curso [ilse]');
    // Se la enseña sin dársela: el paso narrativo pide estar con ella, y guarda el porqué que dio el máster.
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_agua', step_id: 'ilse', why: 'le enseñaste a Ilse el agua turbia' }).ok).toBe(true);
    expect(characterStory(c).done).toContain('q_agua');
    const agua = journalOf(engine, c.id).quests.completed.find((x) => x.id === 'q_agua')!;
    expect(agua).toMatchObject({ giver: 'Ilse', origin: { kind: 'giver', text: 'Ilse nos lo pidió' } });
    expect(agua.history.map((h) => [h.kind, h.text, h.why])).toEqual([
      ['added', 'Ilse nos lo pidió', null],
      ['step', '✔ Sacar agua del pozo y mirarla de cerca', 'Llevas agua del pozo'],
      ['step', 'Le dimos el agua a Ilse. La probó y escupió: es ceniza de la cripta.', 'Le enseñaste a Ilse el agua turbia'],
      ['completed', 'Lo hemos conseguido', 'Se lo contamos a Ilse'],
    ]);
  });

  it('give_quest: «te lo pide X» solo con X delante; sin nadie, hace falta decir de dónde le llega', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Ona');
    // Empieza en el Jabalí; Hugo está en la herrería.
    const absent = tool(engine, c, 'give_quest', { title: 'Carbón para la fragua', text: 'Hugo necesita leña.', npc_id: 'npc_hugo', objective: null, reward: null, heard: null });
    expect(absent.error).toBe('bad_quest');
    expect(absent.hint).toMatch(/no está con el actor/);
    expect(tool(engine, c, 'give_quest', { title: 'Algo', text: 'Algo.', npc_id: null, objective: null, reward: null, heard: null }).hint).toMatch(/hace falta heard/);
    const heard = tool(engine, c, 'give_quest', { title: 'Carbón para la fragua', text: 'Hugo necesita leña.', npc_id: null, heard: 'En la barra se comenta que al herrero le falta leña', objective: null, reward: null });
    expect(heard.ok).toBe(true);
    const q = journalOf(engine, c.id).quests.active.find((x) => x.kind === 'given')!;
    expect(q).toMatchObject({ giver: null, origin: { kind: 'heard', text: 'En la barra se comenta que al herrero le falta leña', where: 'Taberna del Jabalí' } });
  });
});

describe('misiones: avance por lo que hace el PJ', () => {
  it('entrar en casa de Ilse con el agua no da el paso: se da al dársela, y lo que dice ella va al máster', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Fen');
    await talkTo(engine, time, c, 'npc_ilse');
    expect(characterStory(c).open).toContain('q_agua');
    engine.world.npc('npc_ilse').talking_to = null;
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(tool(engine, c, 'transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: 1 }).error).toBeUndefined();
    await engine.tick();
    expect(stepOf(engine, c, 'q_agua')!.current!.id).toBe('ilse');
    await walk(engine, time, c, 'sp_cu_hierbas');
    expect(stepOf(engine, c, 'q_agua')!.current!.id).toBe('ilse');
    expect(engine.events.all().some((e) => e.actor_id === c.id && /Ilse huele el agua/.test(e.narration_private))).toBe(false);
    const water = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_agua_pozo')!;
    const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
    const r = JSON.parse(executeTool(ctx, 'transfer_item', { instance_id: water.id, to_type: 'npc', to_id: 'npc_ilse', slot: null, equip_slot: null, quantity: null })) as { story: { tell_now: string } };
    expect(r.story.tell_now).toMatch(/Ilse huele el agua/);
    // Lo ha dado en su casa, pero sin charla abierta: queda lista para entregar a Ilse.
    expect(ctx.progress.map((e) => e.quest).filter(Boolean)).toEqual([
      { id: 'q_agua', title: 'El agua turbia', event: 'step', step: 'Darle el agua a Ilse, la curandera', why: 'Ilse ya tiene agua del pozo' },
      { id: 'q_agua', title: 'El agua turbia', event: 'ready', why: 'tenemos que volver con Ilse' },
    ]);
    expect(c.clues).toContain('clue_ilse');
    await talkTo(engine, time, c, 'npc_ilse');
    expect(characterStory(c).done).toContain('q_agua');
  });

  it('lo que pasa en el mundo lejos del PJ no le da pasos; delante de él (o de su grupo), sí', async () => {
    const { engine, time } = await boot();
    const a = await newPc(engine, 'Ana');
    await talkTo(engine, time, a, 'npc_brenna');
    expect(tool(engine, a, 'story_quest', { quest_id: 'q_perro', action: 'ask' }).ok).toBe(true);
    const st = characterStory(a);
    st.steps.push('q_perro/rastro', 'q_perro/lobera');
    expect(stepOf(engine, a, 'q_perro')!.current!.id).toBe('sacar');
    // Otro mata a la loba en el Soto mientras Ana sigue en el Jabalí: a Ana no le cuenta.
    engine.world.npc('npc_loba').status = 'dead';
    await engine.tick();
    expect(stepOf(engine, a, 'q_perro')!.current!.id).toBe('sacar');
    // Cuando llega a la madriguera y lo ve, sí; y queda lista para entregar a Brenna.
    await walk(engine, time, a, 'sp_cs_cueva');
    expect(stepOf(engine, a, 'q_perro')!.status).toBe('ready');
    const log = characterStory(a).log!.filter((x) => x.quest_id === 'q_perro' && x.kind === 'step');
    expect(log.at(-1)).toMatchObject({ step_id: 'sacar', why: 'la loba ha muerto' });
  });

  it('los avisos de misión son del PJ: a quien está con él no le llegan', async () => {
    const { engine, time } = await boot();
    const a = await newPc(engine, 'Leo');
    const b = await newPc(engine, 'Miau');
    await engine.tick();
    // Los dos en la plaza: «Ceniza en el agua» se abre a cada uno, y cada aviso solo lo recibe su dueño.
    await walk(engine, time, a, 'sp_pl_pozo');
    await walk(engine, time, b, 'sp_pl_taberna');
    const progress = engine.events.all().filter((e) => /^progress_/.test(e.action_type));
    expect(progress.length).toBeGreaterThan(0);
    for (const e of progress) {
      expect(e.visibility).toBe('private');
      expect(e.delivered_to.map((d) => d.character_id)).toEqual([e.actor_id]);
    }
  });
});

describe('misiones: «Donde lo dejamos»', () => {
  it('nombra las misiones de la historia con lo que toca ahora, sin enmascarar el título', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Rui');
    await talkTo(engine, time, c, 'npc_brenna');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_perro', action: 'ask' }).ok).toBe(true);
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(tool(engine, c, 'transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: 1 }).error).toBeUndefined();
    await engine.tick();
    const text = recapTemplate(engine, c, lastOwnEvent(engine, c.id)!, 1);
    // «Ceniza» es también el nombre del perro: dentro del título no se cambia por «el perro».
    expect(text).toContain('«Ceniza se ha perdido»: buscar el rastro del perro en el Soto.');
    // La principal, con el acto en curso.
    expect(text).toContain('La deuda con el regidor: librarte de la deuda con Garrán; quedan 3 días');
  });
});

describe('misiones: el tablón', () => {
  it('los encargos entran en el Diario al leer el tablón (de pie ante él), con aviso; no por rotar', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Teo');
    await engine.tick();
    const posted = activeJobs(engine.world).map((j) => j.id);
    expect(posted.length).toBeGreaterThan(0);
    expect(journalOf(engine, c.id).quests.active.filter((q) => q.kind === 'job')).toEqual([]);
    // Pasar por la plaza no es leerlo.
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(journalOf(engine, c.id).quests.active.filter((q) => q.kind === 'job')).toEqual([]);
    await walk(engine, time, c, 'sp_pl_tablon');
    const jobs = journalOf(engine, c.id).quests.active.filter((q) => q.kind === 'job');
    expect(jobs.map((q) => q.id).sort()).toEqual([...posted].sort());
    expect(jobs.every((q) => q.status === 'available' && q.origin?.kind === 'board')).toBe(true);
    const notices = questEvents(engine, c).filter((e) => (e.payload['quest'] as { event: string }).event === 'available').map((e) => noticeOf(e)!);
    expect(notices).toHaveLength(posted.length);
    expect(notices[0]!.text).toMatch(/^Encargo en el Diario · «/);
    expect(notices[0]!.quest!.why).toMatch(/^Aviso del tablón: lo pide /);
    // Quedarse delante no repite los avisos.
    await engine.tick();
    expect(questEvents(engine, c).filter((e) => (e.payload['quest'] as { event: string }).event === 'available')).toHaveLength(posted.length);
  });

  it('un encargo con «Ir a…» se lee bien («Ir al arroyo») y el paso dado sale en el historial con su porqué', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Pau');
    const toma = engine.world.campaign.jobs.find((j) => j.id === 'job_toma')!;
    engine.world.campaign.board.active_job_ids = [toma.id];
    await walk(engine, time, c, 'sp_pl_tablon');
    let q = journalOf(engine, c.id).quests.active.find((x) => x.id === 'job_toma')!;
    expect(q.steps[0]!.text).toBe('Ir al arroyo (El Soto)');
    await walk(engine, time, c, 'sp_cl_arroyo');
    q = journalOf(engine, c.id).quests.active.find((x) => x.id === 'job_toma')!;
    expect(q.steps[0]!.done).toBe(true);
    expect(q.history.map((h) => h.kind)).toEqual(['added', 'step']);
    expect(q.history[1]).toMatchObject({ text: '✔ Ir al arroyo (El Soto)', why: 'llegaste a el arroyo' });
  });
});
