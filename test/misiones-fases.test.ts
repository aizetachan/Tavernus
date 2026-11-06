/**
 * Misiones por fases (story.ts, «Fases, vías y desenlaces»): fases en orden con objetivos en cualquier orden, una fase
 * secundaria que se abre cuando pasa algo, vías conocidas o por descubrir, una vía que sale mal y deja su complicación,
 * la improvisada y el desenlace según cómo quedó el mundo. Diseño: Obsidian, «Propuesta misiones por fases y vías».
 * Se prueba con una misión de prueba que da Hal, montada sobre el mundo de Brezal.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import {
  addWorldQuest, advanceNow, advanceStory, characterStory, currentPhase, knownWays, outcomeOf, questStatus, questsOf, storyContext, storyOf,
  storyQuestAction, validateStory, type StoryQuest, type StoryRefs,
} from '../src/engine/story.js';
import { setFact } from '../src/engine/worldfacts.js';
import { journalOf } from '../src/engine/journal.js';
import { STORY } from '../src/data/campaigns/brezal/story.js';
import type { Character } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

const fact = (id: string) => ({ kind: 'fact' as const, id });

/** Dos fases (una con dos objetivos), una secundaria que abre el fallo de la palabra, y dos desenlaces. */
function prueba(): StoryQuest {
  return {
    id: 'q_prueba', act: 1, title: 'La prueba de Hal', giver_npc_id: 'npc_hal', turn_in_npc_id: null, level: 1,
    text: 'Hal quiere ver de qué estás hecho.', notes: 'Misión de prueba.',
    phases: [
      { id: 'uno', title: 'Lo primero', journal: 'Pasamos lo primero.' },
      { id: 'extra', title: 'Lo que se torció', secondary: true, opens_when: fact('t_herido'), reward: { xp: 10 }, journal: 'Arreglamos lo que se torció.' },
      { id: 'dos', title: 'Lo segundo' },
    ],
    steps: [
      { id: 'a', phase: 'uno', text: 'Encontrar la señal', done_when: fact('t_a') },
      { id: 'b', phase: 'uno', text: 'Pasar al otro lado', done_when: { kind: 'narrative', how: 'cuando pase al otro lado' }, ways: [
        { id: 'palabra', kind: 'word', text: 'Se puede convencer al guarda.', how: 'Persuasión al guarda', check: { skill: 'Persuasión', dc: 12 },
          on_fail: { text: 'El guarda se enfadó y alguien salió herido.', facts: ['t_herido'] } },
        { id: 'fuerza', kind: 'force', text: 'Se puede tumbar al guarda.', how: 'pelear con el guarda', done_when: fact('t_fuerza'), facts: ['t_por_la_fuerza'] },
        { id: 'saber', kind: 'lore', text: 'Hay un paso viejo que pocos conocen.', how: 'el paso viejo (Historia CD 10)', check: { skill: 'Historia', dc: 10 }, revealed_by: fact('t_pista') },
      ] },
      { id: 'd', phase: 'extra', text: 'Curar al herido', done_when: fact('t_d') },
      { id: 'c', phase: 'dos', text: 'Volver con la prueba', done_when: fact('t_c') },
    ],
    outcomes: [
      { id: 'duro', title: 'Por las malas', when: { kind: 'way', quest_id: 'q_prueba', step_id: 'b', way_id: 'fuerza' }, journal: 'Pasamos por las malas.', reward: { xp: 5 } },
      { id: 'normal', title: 'Sin más', journal: 'Pasamos sin más.' },
    ],
    reward: { xp: 100 },
    on_complete: [],
  };
}

async function setup(quests: StoryQuest[] = [prueba()]): Promise<{ engine: Engine; c: Character; time: ReturnType<typeof fakeTime> }> {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  storyOf(engine.world)!.quests.push(...quests);
  const r = await engine.createCharacter('u_tester', 'Tester', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  const c = r.character;
  // Al lado de Hal, para que pueda darle la misión.
  const hal = engine.world.npc('npc_hal');
  const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: '' };
  const moved = JSON.parse(executeTool(ctx, 'move_to', { character_id: c.id, target_spot_id: hal.location.id, pace: 'walk' })) as { error?: string };
  expect(moved.error).toBeUndefined();
  if (c.transit) time.advanceGame(c.transit.arrives_game_s - engine.gameNow() + 2);
  await engine.tick();
  hal.location = { type: 'spot', id: engine.world.characterSpot(c)!.id };
  return { engine, c, time };
}

const now = (engine: Engine, c: Character) => engine.nowFor(c);
const mark = (engine: Engine, c: Character, id: string) => {
  setFact(engine.world, { id, by: c.id, subject: null, location_id: null, game_s: now(engine, c) });
  return advanceNow(engine.world, c, now(engine, c));
};
const visible = (engine: Engine, c: Character) => questsOf(engine.world, c).find((v) => v.quest.id === 'q_prueba')!.steps.map((s) => s.step.id);

function refsOf(engine: Engine): StoryRefs {
  const w = engine.world;
  return {
    spot: (id) => w.spots.has(id), location: (id) => w.locations.has(id), npc: (id) => w.npcs.has(id), item: (id) => w.itemDefs.has(id),
    clue: (id) => w.campaign.clues.some((x) => x.id === id), job: (id) => w.campaign.jobs.some((x) => x.id === id), exit: (id) => w.exits.has(id),
  };
}

describe('misiones por fases: fases, vías y desenlaces', () => {
  it('la misión de prueba es válida', async () => {
    const { engine } = await setup();
    expect(validateStory({ quests: [prueba()], escalation: [] }, refsOf(engine))).toEqual([]);
  });

  it('las fases van en orden; los objetivos de la fase, en cualquier orden y a la vista a la vez', async () => {
    const { engine, c } = await setup();
    const w = engine.world;
    const q = storyOf(w)!.quests.find((x) => x.id === 'q_prueba')!;
    expect(storyQuestAction(w, c, 'q_prueba', 'accept', now(engine, c)).ok).toBe(true);
    expect(currentPhase(c, q)?.id).toBe('uno');
    // Los dos objetivos de la primera fase se ven; el de la segunda y el de la secundaria (sin abrir), no.
    expect(visible(engine, c)).toEqual(['a', 'b']);
    // b no se puede dar «a mano» sin vía... sí: es narrativo. Pero primero, a.
    mark(engine, c, 't_a');
    expect(characterStory(c).steps).toContain('q_prueba/a');
    expect(currentPhase(c, q)?.id).toBe('uno');
    // c es de la fase dos: aunque se cumpla su meta, no cuenta todavía.
    mark(engine, c, 't_c');
    expect(characterStory(c).steps).not.toContain('q_prueba/c');
  });

  it('las vías: se conocen las que no piden pista; la fallida deja su complicación y abre la fase secundaria', async () => {
    const { engine, c } = await setup();
    const w = engine.world;
    const q = storyOf(w)!.quests.find((x) => x.id === 'q_prueba')!;
    storyQuestAction(w, c, 'q_prueba', 'accept', now(engine, c));
    const b = q.steps.find((s) => s.id === 'b')!;
    expect(knownWays(w, c, q, b).map((x) => x.way.id)).toEqual(['palabra', 'fuerza']);
    // El máster ve las que no conoce, sin regalarlas.
    const ctx = storyContext(w, c, now(engine, c))!;
    expect(ctx).toContain('Vías que conoce: [palabra]');
    expect(ctx).toContain('Vías que aún no conoce');
    expect(ctx).toContain('[saber]');
    expect(ctx).toContain('improvisada');
    // La palabra sale mal: complicación, hecho y la fase secundaria abierta.
    const r = advanceStory(w, c, 'q_prueba', 'b', now(engine, c), null, { way_id: 'palabra', failed: true });
    expect(r.ok).toBe(true);
    expect(characterStory(c).failed_ways).toEqual(['q_prueba/b/palabra']);
    expect(characterStory(c).steps).not.toContain('q_prueba/b');
    expect(characterStory(c).phases_open).toEqual(['q_prueba/extra']);
    expect(visible(engine, c)).toEqual(['a', 'b', 'd']);
    expect(knownWays(w, c, q, b).find((x) => x.way.id === 'palabra')?.failed).toBe(true);
    // La pista descubre la vía del saber.
    mark(engine, c, 't_pista');
    expect(knownWays(w, c, q, b).map((x) => x.way.id)).toContain('saber');
  });

  it('una vía que ve el motor da el objetivo sola, deja su hecho y elige el desenlace; la secundaria paga su parte', async () => {
    const { engine, c } = await setup();
    const w = engine.world;
    const q = storyOf(w)!.quests.find((x) => x.id === 'q_prueba')!;
    storyQuestAction(w, c, 'q_prueba', 'accept', now(engine, c));
    const xp0 = c.xp;
    // La fuerza la ve el servidor: el máster no la marca.
    const no = advanceStory(w, c, 'q_prueba', 'b', now(engine, c), null, { way_id: 'fuerza' });
    expect(no.ok).toBe(false);
    advanceStory(w, c, 'q_prueba', 'b', now(engine, c), null, { way_id: 'palabra', failed: true });
    mark(engine, c, 't_a');
    mark(engine, c, 't_fuerza');
    expect(characterStory(c).ways?.['q_prueba/b']).toBe('fuerza');
    expect(w.campaign && (w.campaign as { world_facts?: { id: string }[] }).world_facts?.some((f) => f.id === 't_por_la_fuerza')).toBe(true);
    expect(characterStory(c).phases_done).toEqual(['q_prueba/uno']);
    expect(currentPhase(c, q)?.id).toBe('dos');
    expect(visible(engine, c)).toEqual(['a', 'b', 'd', 'c']);
    // La secundaria se cierra con su recompensa.
    mark(engine, c, 't_d');
    expect(characterStory(c).phases_done).toContain('q_prueba/extra');
    expect(c.xp).toBe(xp0 + 10);
    // Se cumple: desenlace «por las malas», con su recompensa sumada.
    mark(engine, c, 't_c');
    expect(questStatus(w, c, q)).toBe('done');
    expect(characterStory(c).outcomes?.['q_prueba']).toBe('duro');
    expect(outcomeOf(w, c, q)?.title).toBe('Por las malas');
    expect(c.xp).toBe(xp0 + 10 + 100 + 5);
    expect(characterStory(c).log?.find((x) => x.quest_id === 'q_prueba' && x.kind === 'done')?.why).toBe('Pasamos por las malas.');
  });

  it('la vía improvisada vale si logra la meta, y el desenlace es el de por defecto', async () => {
    const { engine, c } = await setup();
    const w = engine.world;
    const q = storyOf(w)!.quests.find((x) => x.id === 'q_prueba')!;
    storyQuestAction(w, c, 'q_prueba', 'accept', now(engine, c));
    mark(engine, c, 't_a');
    const unknown = advanceStory(w, c, 'q_prueba', 'b', now(engine, c), null, { way_id: 'volar' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toContain('improvisada');
    const r = advanceStory(w, c, 'q_prueba', 'b', now(engine, c), 'Nos colamos entre los carros del mercado', { way_id: 'improvisada' });
    expect(r.ok).toBe(true);
    expect(characterStory(c).ways?.['q_prueba/b']).toBe('improvisada');
    mark(engine, c, 't_c');
    expect(questStatus(w, c, q)).toBe('done');
    expect(characterStory(c).outcomes?.['q_prueba']).toBe('normal');
  });

  it('Brezal: «Ceniza se ha perdido» en el Diario, con su fase, las formas que conocemos, la fallida y el desenlace', async () => {
    const { engine, c, time } = await setup([]);
    const w = engine.world;
    const brenna = w.npc('npc_brenna');
    brenna.location = { type: 'spot', id: w.characterSpot(c)!.id };
    expect(storyQuestAction(w, c, 'q_perro', 'accept', now(engine, c)).ok).toBe(true);
    // Ya en el Soto (Hal estaba en su piedra): se conocen rastrear, preguntar a Hal y el aullido.
    let j = journalOf(engine, c.id);
    let perro = j.quests.active.find((q) => q.id === 'q_perro')!;
    expect(perro.steps[0]).toMatchObject({ phase: 'Encontrar el rastro', done: false });
    expect(perro.steps[0]!.ways!.map((x) => x.text)).toEqual(expect.arrayContaining(['En el barro del Soto se puede seguir el rastro.']));
    // Rastrear sale mal: tachada en el Diario. Hal lo cuenta.
    expect(advanceStory(w, c, 'q_perro', 'rastro', now(engine, c), null, { way_id: 'rastrear', failed: true }).ok).toBe(true);
    expect(advanceStory(w, c, 'q_perro', 'rastro', now(engine, c), null, { way_id: 'hal' }).ok).toBe(true);
    j = journalOf(engine, c.id);
    perro = j.quests.active.find((q) => q.id === 'q_perro')!;
    expect(perro.steps[0]!.ways!.find((x) => x.text.startsWith('En el barro'))).toMatchObject({ failed: true });
    expect(perro.steps.map((s) => s.phase)).toEqual(['Encontrar el rastro', 'Sacarlo de la madriguera', 'Sacarlo de la madriguera', undefined]); // y volver con Brenna
    expect(perro.history.some((x) => x.kind === 'changed' && x.text.startsWith('Perdimos el rastro'))).toBe(true);
    // El máster: la fase, la meta y las vías (la del fuego ya se conoce: conocemos a Hal).
    const ctx = storyContext(w, c, now(engine, c))!;
    expect(ctx).toContain('Fase en curso: «Sacarlo de la madriguera» (2 de 2)');
    expect(ctx).toContain('[fuego]');
    // El cebo sale mal: Ceniza herido, se abre «La pata de Ceniza».
    expect(advanceStory(w, c, 'q_perro', 'sacar', now(engine, c), null, { way_id: 'cebo', failed: true }).ok).toBe(true);
    expect(characterStory(c).phases_open).toContain('q_perro/pata');
    void time;
  });

  it('paquete versionado: al reabrir, la partida toma la historia del código sin perder el estado; lo que ya no está se cierra', async () => {
    const time = fakeTime(EPOCH);
    const repo = new MemoryRepository();
    const engine = await Engine.boot({ repo, campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: false, fastTravel: false });
    const r = await engine.createCharacter('u_viejo', 'Viejo', { class_id: 'rogue' });
    if (!r.ok) throw new Error(r.reason);
    const c = r.character;
    // Una partida de antes: su copia de la historia era otra (un texto distinto y una misión que ya no existe).
    const old = storyOf(engine.world)!;
    old.version = 1;
    old.quests.find((q) => q.id === 'q_perro')!.text = 'Texto viejo';
    old.quests.push({ ...prueba(), id: 'q_retirada', phases: undefined, outcomes: undefined, steps: [{ id: 'x', text: 'Algo', done_when: fact('nunca') }] });
    characterStory(c).open.push('q_retirada');
    characterStory(c).steps.push('q_perro/rastro');
    engine.world.touch('campaign', engine.world.campaign.id);
    engine.world.touch('characters', c.id);
    await repo.saveSnapshot(engine.world.snapshot());
    const again = await Engine.boot({ repo, campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: false, fastTravel: false });
    const s = storyOf(again.world)!;
    expect(s.version).toBe(2);
    expect(s.quests.find((q) => q.id === 'q_perro')!.text).not.toBe('Texto viejo');
    expect(s.quests.some((q) => q.id === 'q_retirada')).toBe(false);
    const cs = characterStory(again.world.character(c.id));
    expect(cs.steps).toContain('q_perro/rastro');
    expect(cs.open).not.toContain('q_retirada');
    expect(cs.expired).toContain('q_retirada');
    expect(cs.log?.at(-1)).toMatchObject({ quest_id: 'q_retirada', kind: 'expired' });
  });

  it('misiones de la partida: se validan al crearlas, van en la colección `quests` del mundo y vuelven al reabrir', async () => {
    const time = fakeTime(EPOCH);
    const repo = new MemoryRepository();
    const seed = () => authoredSeed('brezal', { now: new Date(EPOCH) });
    const engine = await Engine.boot({ repo, campaignId: 'brezal', seed: seed(), now: time.now, deterministic: false, fastTravel: false });
    const w = engine.world;
    // Repetir la id de una misión de la campaña, no.
    expect(addWorldQuest(w, { ...prueba(), id: 'q_perro' }, { source: 'master', game_s: engine.gameNow() }).ok).toBe(false);
    // Depender de Brenna sin decir qué pasa si muere, no: los mismos casos límite que las escritas.
    const fragil = { ...prueba(), id: 'q_fragil', giver_npc_id: 'npc_brenna', turn_in_npc_id: undefined };
    const bad = addWorldQuest(w, fragil, { source: 'ia', game_s: engine.gameNow() });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toContain('on_npc_dead');
    expect(w.quests.has('q_fragil')).toBe(false);
    // La buena entra, se ve en la historia y se juega como las demás.
    const ok = addWorldQuest(w, prueba(), { source: 'master', game_s: engine.gameNow() });
    expect(ok.ok).toBe(true);
    expect(w.quests.get('q_prueba')).toMatchObject({ source: 'master', rev: 1 });
    expect(storyOf(w)!.quests.some((q) => q.id === 'q_prueba')).toBe(true);
    expect(storyOf(w)!.quests.length).toBe(STORY.quests.length + 1);
    const r = await engine.createCharacter('u_q', 'Quilla', { class_id: 'rogue' });
    if (!r.ok) throw new Error(r.reason);
    const c = r.character;
    w.npc('npc_hal').location = { type: 'spot', id: w.characterSpot(c)!.id };
    expect(storyQuestAction(w, c, 'q_prueba', 'accept', engine.nowFor(c)).ok).toBe(true);
    // Corregirla sube su versión.
    expect(addWorldQuest(w, { ...prueba(), title: 'La prueba de Hal (corregida)' }, { source: 'master', game_s: engine.gameNow() }).ok).toBe(true);
    expect(w.quests.get('q_prueba')!.rev).toBe(2);
    expect(storyOf(w)!.quests.find((q) => q.id === 'q_prueba')!.title).toBe('La prueba de Hal (corregida)');
    // En el snapshot es una colección más (en PostgreSQL, una fila por misión); al reabrir, sigue ahí y la historia escrita no la pisa.
    const snap = w.snapshot();
    expect(snap.quests?.map((q) => q.id)).toEqual(['q_prueba']);
    expect(((snap.campaign as { story?: { quests: { id: string }[] } }).story!.quests).some((q) => q.id === 'q_prueba')).toBe(false);
    await repo.saveSnapshot(snap);
    const again = await Engine.boot({ repo, campaignId: 'brezal', seed: seed(), now: time.now, deterministic: false, fastTravel: false });
    expect(again.world.quests.get('q_prueba')!.rev).toBe(2);
    expect(characterStory(again.world.character(c.id)).open).toContain('q_prueba');
  });

  it('un mundo sin historia escrita (generado) puede tener misiones de la partida', async () => {
    const { engine } = await setup([]);
    const w = engine.world;
    delete (w.campaign as { story?: unknown }).story;
    expect(storyOf(w)).toBeNull();
    expect(addWorldQuest(w, prueba(), { source: 'ia', game_s: engine.gameNow() }).ok).toBe(true);
    expect(storyOf(w)!.quests.map((q) => q.id)).toEqual(['q_prueba']);
    expect(storyOf(w)!.escalation).toEqual([]);
  });

  it('el validador pide al menos dos vías, una que no sea pelear, que cada vía pida algo y un desenlace por defecto al final', async () => {
    const { engine } = await setup([]);
    const bad = prueba();
    const b = bad.steps.find((s) => s.id === 'b')!;
    b.ways = [{ id: 'solo', kind: 'force', text: 'Pelear.', how: 'pelear' }];
    bad.phases![1]!.opens_when = undefined;
    bad.outcomes = [{ id: 'normal', title: 'Sin más', journal: 'Pasamos.' }, { id: 'duro', title: 'Por las malas', journal: 'Por las malas.', when: fact('t_x') }];
    bad.steps.find((s) => s.id === 'c')!.phase = undefined;
    const errs = validateStory({ quests: [bad], escalation: [] }, refsOf(engine)).join('\n');
    expect(errs).toContain('al menos dos');
    expect(errs).toContain('todas sus vías son pelear');
    expect(errs).toContain('no pide nada');
    expect(errs).toContain('opens_when');
    expect(errs).toContain('solo el último va sin when');
    expect(errs).toContain('cada paso lleva una fase');
  });
});
