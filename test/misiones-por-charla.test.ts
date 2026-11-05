/**
 * Partida del 2026-11-04 (Brezal, junto al pozo): las misiones salían sin conversación que las produjera.
 *   - En la apertura, Ilse agarra la muñeca del PJ («¿Quién te ha mandado eso?») y en ese mismo turno le abre
 *     «El agua turbia»; al turno siguiente, con el jugador negando llevar nada, «Un jarabe para el molino». Dos de golpe.
 *   - Desenvainar y acercarse a Osric, que está junto al tablón, dejaba en el Diario los tres encargos del tablón.
 * La regla (docs/CONVERSACION-REGLAS.md, §5): una misión solo sale de una charla con quien la pide que haya llegado a
 * eso, o de leer el tablón. Nunca por estar cerca de alguien ni del tablón.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { talkPlanFor } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { readsBoard } from '../src/engine/quests.js';
import { questStatus, storyOf } from '../src/engine/story.js';
import { soundsLikeTalk, talkState } from '../src/engine/talk.js';
import { journalOf } from '../src/engine/journal.js';
import type { Character } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  return { engine, time };
}

async function newPc(engine: Engine, class_id = 'wizard'): Promise<Character> {
  const r = await engine.createCharacter('u_nia', 'Nia', { class_id });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return r.character;
}

type Out = Record<string, unknown> & { ok?: boolean; error?: string; hint?: string };
const ctxFor = (engine: Engine, c: Character, text: string | null, extra: Partial<ToolContext> = {}): ToolContext => ({
  engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: text,
  ...(text ? { talk: talkPlanFor(engine, c, text) ?? undefined } : {}), ...extra,
});
const call = (ctx: ToolContext, name: string, input: Record<string, unknown>): Out => JSON.parse(executeTool(ctx, name, input)) as Out;
const run = (engine: Engine, c: Character, text: string, name: string, input: Record<string, unknown>): Out => call(ctxFor(engine, c, text), name, input);
const ask = (id: string) => ({ quest_id: id, action: 'ask' });
const favor = { title: 'Un favor', text: 'Trae leña', npc_id: 'npc_ilse', objective: null, reward: null, heard: null };

/** Un turno con el NPC: lo que dice (o hace) el jugador, lo que le contesta y lo que queda en el registro. */
async function turn(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, npcId: string, text: string, reply = 'Ya.'): Promise<Out> {
  const lines = [{ speaker: 'actor', text }, { speaker: 'npc', npc_id: npcId, text: reply }];
  const r = run(engine, c, text, 'log_event', {
    narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: npcId, lines,
  });
  engine.events.emit({ actor_id: c.id, action_type: 'master', input_text: text, narration_private: '', observable: null, tags: [], payload: { npc_id: npcId, lines } }, time.now());
  time.advanceGame(5);
  await engine.tick();
  // Ilse sigue su rutina: el PJ va con ella, como haría el máster al hablarle (reachNpc).
  c.location = { type: 'spot', id: engine.world.npc(npcId).location.id };
  return r;
}

const status = (engine: Engine, c: Character, id: string) => questStatus(engine.world, c, storyOf(engine.world)!.quests.find((q) => q.id === id)!);
const withIlse = (engine: Engine, c: Character) => { c.location = { type: 'spot', id: engine.world.npc('npc_ilse').location.id }; engine.world.touch('characters', c.id); };
const jobsIn = (engine: Engine, c: Character) => journalOf(engine, c.id).quests.active.filter((q) => q.kind === 'job');

describe('una misión sale de una charla que llega a eso, no de tener al PNJ cerca', () => {
  it('en la apertura, con Ilse agarrándole la muñeca, no le pide nada (ni misión de la historia ni encargo)', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine);
    withIlse(engine, c);
    const intro = ctxFor(engine, c, null, { intro: true });
    expect(call(intro, 'story_quest', ask('q_agua')).error).toBe('too_soon');
    expect(call(intro, 'give_quest', favor).error).toBe('too_soon');
    // Lo que dice Ilse en la apertura queda en el registro, pero no es charla con el PJ: no cuenta para «llevan un rato».
    engine.events.emit({ actor_id: c.id, action_type: 'master_intro', narration_private: '', observable: null, tags: [], payload: { npc_id: 'npc_ilse', lines: [{ speaker: 'npc', npc_id: 'npc_ilse', text: '¿Quién te ha mandado eso?' }] } }, time.now());
    engine.events.emit({ actor_id: c.id, action_type: 'master_intro', narration_private: '', observable: null, tags: [], payload: { npc_id: 'npc_ilse', lines: [{ speaker: 'npc', npc_id: 'npc_ilse', text: 'Contesta.' }] } }, time.now() + 1000);
    expect(talkState(engine.world, engine.events.all(), c, engine.world.npc('npc_ilse'), engine.nowFor(c))).toMatchObject({ talked: false, ripe: false });
    // El jugador niega llevar nada: eso no es pedir trabajo ni una charla que llegue a una misión.
    expect(run(engine, c, 'No llevo nada en el bolsillo', 'story_quest', ask('q_tonico_mateo')).error).toBe('too_soon');
    await turn(engine, time, c, 'npc_ilse', 'No llevo nada en el bolsillo', '¿Y eso que asoma?');
    expect(status(engine, c, 'q_agua')).toBe('available');
    expect(status(engine, c, 'q_tonico_mateo')).toBe('available');
  });

  it('desenvainar o acercarse sin hablarle no le abre nada, aunque la charla ya diera para ello', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine);
    withIlse(engine, c);
    await turn(engine, time, c, 'npc_ilse', 'Buenas noches, Ilse.', 'Buenas.');
    await turn(engine, time, c, 'npc_ilse', '¿Qué tal la misa?', 'Fría.');
    expect(talkState(engine.world, engine.events.all(), c, engine.world.npc('npc_ilse'), engine.nowFor(c)).ripe).toBe(true);
    const sneak = 'Desenvaino la espada suavemente sin que se entere y me acerco sin que me vea';
    expect(soundsLikeTalk(sneak)).toBe(false);
    expect(run(engine, c, sneak, 'story_quest', ask('q_agua')).error).toBe('too_soon');
    expect(run(engine, c, sneak, 'give_quest', favor).error).toBe('too_soon');
    // Cerrar ese turno con ella delante no deja la charla «madura»: el motor no se la saca solo en el tick.
    await turn(engine, time, c, 'npc_ilse', sneak, '¿Qué haces?');
    expect(engine.world.npc('npc_ilse').talking_to?.ripe).toBeFalsy();
    expect(status(engine, c, 'q_agua')).toBe('available');
  });

  it('si la charla lo produce, se la pide; y una cada vez, no dos de golpe', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine);
    withIlse(engine, c);
    await turn(engine, time, c, 'npc_ilse', 'Buenas noches, Ilse.', 'Buenas.');
    const ctx = ctxFor(engine, c, '¿Y a ti qué te preocupa? ¿Puedo ayudarte?');
    expect(call(ctx, 'story_quest', ask('q_agua')).ok).toBe(true);
    const again = call(ctx, 'story_quest', ask('q_tonico_mateo'));
    expect(again.error).toBe('too_soon');
    expect(again.hint).toMatch(/una cada vez/);
    expect(call(ctx, 'give_quest', favor).error).toBe('too_soon');
    expect(status(engine, c, 'q_agua')).toBe('active');
    expect(status(engine, c, 'q_tonico_mateo')).toBe('available');
  });

  it('el jugador que se ofrece la abre si le habla a quien la da; si no le habla, no', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    withIlse(engine, c);
    expect(run(engine, c, 'Desenvaino la espada', 'story_quest', { quest_id: 'q_agua', action: 'accept' }).error).toBe('too_soon');
    expect(run(engine, c, '«Yo te traigo el agua, Ilse»', 'story_quest', { quest_id: 'q_agua', action: 'accept' }).ok).toBe(true);
  });
});

describe('los encargos del tablón entran al leerlo, no por pasar junto a él', () => {
  it('leer es decir que se lee; acercarse a alguien que está allí no', () => {
    for (const t of ['Leo los avisos del tablón', 'Echo un vistazo al tablón', 'Me acerco al tablón a ver qué hay', '¿Qué pone en el tablón?', 'Miro qué encargos hay', 'Consulto el tablón de anuncios']) expect(readsBoard(t), t).toBe(true);
    for (const t of ['Me acerco al tablón', 'Voy al tablón', 'Desenvaino la espada y me acerco a Osric sin que me vea', 'Miro a Osric, que está junto al tablón', 'Me acerco al tablón sin que me vea']) expect(readsBoard(t), t).toBe(false);
  });

  it('pelear o acercarse a Osric junto al tablón no añade encargos; leerlo, sí', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'fighter');
    await engine.tick();
    expect(run(engine, c, 'Voy al tablón', 'move_to', { character_id: c.id, target_spot_id: 'sp_pl_tablon', pace: 'walk' }).error).toBeUndefined();
    if (c.transit) time.advanceGame(c.transit.arrives_game_s - engine.gameNow() + 2);
    await engine.tick();
    expect(engine.world.characterSpot(c)?.id).toBe('sp_pl_tablon');
    await engine.tick();
    expect(jobsIn(engine, c)).toEqual([]);
    await engine.act(c.id, 'Desenvaino la espada y me acerco a Osric sin que me vea');
    expect(jobsIn(engine, c)).toEqual([]);
    await engine.act(c.id, 'Me acerco al tablón a ver qué hay');
    expect(jobsIn(engine, c).length).toBeGreaterThan(0);
    expect(jobsIn(engine, c).every((q) => q.origin?.kind === 'board')).toBe(true);
  });
});
