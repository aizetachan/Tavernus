/**
 * Partida del 2026-10-31 (Brezal, junto al pozo): «guardar el agua en la mochila» respondía que no aguantaba más peso
 * con la carga en 39/135 lb, y las misiones entraban en el Diario sin haber hablado con quien las da.
 *   - Coger agua se llevaba la pila entera (3, 6 lb) a una mochila de 30 lb que ya llevaba 25 de equipo inicial.
 *   - Cerrar un turno con un NPC delante le abría sus misiones, aunque el jugador no le hubiera dicho nada.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { talkPlanFor } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { movedWithoutTool } from '../src/engine/closecheck.js';
import { parseTrivial } from '../src/engine/fastpath.js';
import { checkFits, packView, takeAmount } from '../src/engine/inventory.js';
import { characterStory, questStatus, storyOf } from '../src/engine/story.js';
import type { Character } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(repo = new MemoryRepository()) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo, campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  return { engine, time, repo, seed };
}

async function newPc(engine: Engine, class_id = 'wizard'): Promise<Character> {
  const r = await engine.createCharacter('u_nia', 'Nia', { class_id });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return r.character;
}

type Out = Record<string, unknown> & { ok?: boolean; error?: string; hint?: string; left?: number };
const ctxFor = (engine: Engine, c: Character, text: string): ToolContext => ({
  engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: text, talk: talkPlanFor(engine, c, text),
});
const run = (engine: Engine, c: Character, text: string, name: string, input: Record<string, unknown>): Out => JSON.parse(executeTool(ctxFor(engine, c, text), name, input)) as Out;

/** Un turno de charla: lo que dice el jugador, lo que le contesta el NPC y lo que queda en el registro. */
async function say(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, npcId: string, text: string, reply = 'Ya.'): Promise<Out> {
  const lines = [{ speaker: 'actor', text }, { speaker: 'npc', npc_id: npcId, text: reply }];
  const r = run(engine, c, text, 'log_event', {
    narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: npcId, lines,
  });
  engine.events.emit({ actor_id: c.id, action_type: 'master', input_text: text, narration_private: '', observable: null, tags: [], payload: { npc_id: npcId, lines } }, time.now());
  time.advanceGame(60);
  await engine.tick();
  return r;
}

const status = (engine: Engine, c: Character, id: string) => questStatus(engine.world, c, storyOf(engine.world)!.quests.find((q) => q.id === id)!);
const atWell = (engine: Engine, c: Character) => { c.location = { type: 'spot', id: 'sp_pl_pozo' }; engine.world.touch('characters', c.id); };
const bagOf = (engine: Engine, c: Character) => engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_mochila')!;

describe('la mochila junto al pozo', () => {
  it('coger agua coge una; se guarda en la mochila y la mochila dice lo que lleva', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    atWell(engine, c);
    const water = engine.world.itemInstance('ii_agua_pozo');
    expect(water.quantity).toBe(3);
    const taken = run(engine, c, 'cojo agua del pozo', 'transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: c.id, slot: 'hand_off', equip_slot: null, quantity: null });
    expect(taken).toMatchObject({ ok: true, quantity: 1 });
    expect(water.quantity).toBe(2); // el resto sigue en el pozo
    const carried = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_agua_pozo')!;
    const bag = bagOf(engine, c);
    expect(run(engine, c, 'guardo el agua en la mochila', 'transfer_item', { instance_id: carried.id, to_type: 'container', to_id: bag.id, slot: null, equip_slot: null, quantity: null })).toMatchObject({ ok: true });
    expect(packView(engine.world, c.id).containers[0]).toMatchObject({ name: 'mochila', max_weight_lb: 60 });
  });

  it('si lo pide, se lleva más; las tres caben en la mochila con el equipo inicial', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    atWell(engine, c);
    expect(run(engine, c, 'cojo toda el agua', 'transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: c.id, slot: 'hand_off', equip_slot: null, quantity: 3 })).toMatchObject({ ok: true, quantity: 3 });
    const carried = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_agua_pozo')!;
    expect(checkFits(engine.world, engine.world.itemDef('it_agua_pozo'), 3, { type: 'container', id: bagOf(engine, c).id }, carried.id)).toBeNull();
  });

  it('si de verdad no cabe, dice cuánto lleva, cuánto aguanta y cuántas sí caben', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    const bag = bagOf(engine, c);
    const inside = engine.world.itemsIn({ type: 'container', id: bag.id }).reduce((a, i) => a + i.quantity * engine.world.itemDef(i.item_id).weight_lb, 0);
    engine.world.itemDef('it_mochila').container!.max_weight_lb = inside + 3;
    atWell(engine, c);
    const err = checkFits(engine.world, engine.world.itemDef('it_agua_pozo'), 3, { type: 'container', id: bag.id });
    expect(err).toMatchObject({ code: 'no_space', reason: `mochila lleva ${inside} de ${inside + 3} lb y agua del pozo ×3 pesa 6 lb`, fits: 1 });
  });

  it('«coger» entiende cuántas se piden', () => {
    expect(takeAmount('agua', 3)).toBe(1);
    expect(takeAmount('el agua', 3)).toBe(1);
    expect(takeAmount('las antorchas', 3)).toBe(3);
    expect(takeAmount('todas las antorchas', 3)).toBe(3);
    expect(takeAmount('dos antorchas', 3)).toBe(2);
    expect(takeAmount('9 antorchas', 3)).toBe(3);
  });

  it('una partida de antes (mochila de 30 lb) pasa a 60 al cargar', async () => {
    const { engine, repo, seed, time } = await boot();
    engine.world.itemDef('it_mochila').container!.max_weight_lb = 30;
    engine.world.touch('item_defs', 'it_mochila');
    await engine.flush();
    const again = await Engine.boot({ repo, campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
    expect(again.world.itemDef('it_mochila').container!.max_weight_lb).toBe(60);
  });
});

describe('las misiones llegan con la charla', () => {
  it('estar delante de quien la da no la abre, aunque el turno se cierre con él', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    const ilse = engine.world.npc('npc_ilse');
    c.location = { type: 'spot', id: ilse.location.id };
    // Lo de la captura: el jugador guarda el agua e Ilse «te observa sin decir nada».
    run(engine, c, 'guardar el agua en la mochila', 'log_event', {
      narration_private: 'Ilse te observa sin decir nada.', observable: null, observable_vague: null, loudness: 1, tags: 'world', suggested_actions: '',
      requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: 'npc_ilse',
    });
    await engine.tick();
    expect(status(engine, c, 'q_agua')).toBe('available');
    expect(characterStory(c).open).not.toContain('q_agua');
  });

  it('el primer saludo no la abre: se la pide cuando llevan un rato, y solo una', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'rogue');
    const n = engine.world.npc('npc_brenna');
    c.location = { type: 'spot', id: n.location.id };
    await say(engine, time, c, 'npc_brenna', 'Buenas noches, Brenna');
    expect(status(engine, c, 'q_cena_doro')).toBe('available');
    await say(engine, time, c, 'npc_brenna', 'Qué frío hace ahí fuera');
    expect(status(engine, c, 'q_cena_doro')).toBe('available');
    // Ya le ha contestado dos veces: el guion le toca sacarlo y, si el máster no lo registra, el servidor lo abre.
    expect(talkPlanFor(engine, c, 'Sí, un día largo')!.situation).toBe('offer');
    await say(engine, time, c, 'npc_brenna', 'Sí, un día largo');
    expect(status(engine, c, 'q_cena_doro')).toBe('active');
    expect(status(engine, c, 'q_perro')).toBe('available');
    // Acaba de pedirle una: no le suelta otra en el turno siguiente.
    expect(talkPlanFor(engine, c, 'Vale, me pongo a ello')!.state.ripe).toBe(false);
    await say(engine, time, c, 'npc_brenna', 'Vale, me pongo a ello');
    expect(status(engine, c, 'q_perro')).toBe('available');
  });

  it('si el jugador pregunta por trabajo o por lo que le pasa, no hace falta esperar', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'rogue');
    const n = engine.world.npc('npc_brenna');
    c.location = { type: 'spot', id: n.location.id };
    await say(engine, time, c, 'npc_brenna', 'Buenas, ¿tienes algún trabajo para mí?');
    expect(status(engine, c, 'q_cena_doro')).toBe('active');
  });

  it('el máster tampoco puede pedirla ni improvisar un encargo en el primer saludo', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'rogue');
    const n = engine.world.npc('npc_brenna');
    c.location = { type: 'spot', id: n.location.id };
    expect(run(engine, c, 'Buenas noches', 'story_quest', { quest_id: 'q_cena_doro', action: 'ask' }).error).toBe('too_soon');
    expect(run(engine, c, 'Buenas noches', 'give_quest', { title: 'Un favor', text: 'Trae leña', npc_id: 'npc_brenna', objective: null, reward: null, heard: null }).error).toBe('too_soon');
    expect(run(engine, c, 'Buenas, ¿en qué puedo ayudar?', 'story_quest', { quest_id: 'q_cena_doro', action: 'ask' }).ok).toBe(true);
    // Hablado ya, puede sacarla el máster si viene a cuento.
    await say(engine, time, c, 'npc_brenna', 'Gracias');
    expect(run(engine, c, 'Cuéntame', 'give_quest', { title: 'Un favor', text: 'Trae leña', npc_id: 'npc_brenna', objective: null, reward: null, heard: null }).ok).toBe(true);
  });
});

describe('guardar no depende de lo que cuente el máster', () => {
  it('«guardar el agua en la mochila» lo hace el motor, sin máster', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    atWell(engine, c);
    run(engine, c, 'cojo agua', 'transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: null });
    const bag = bagOf(engine, c);
    const intent = parseTrivial(engine.world, c, 'guardar el agua en la mochila');
    expect(intent).toMatchObject({ kind: 'put', container_id: bag.id });
    expect(parseTrivial(engine.world, c, 'guardo el agua')).toMatchObject({ kind: 'put', container_id: bag.id });
    // Dos cosas en una frase, o lo que no lleva: al máster.
    expect(parseTrivial(engine.world, c, 'guardar el agua en la mochila y coger el bastón')).toBeNull();
    expect(parseTrivial(engine.world, c, 'guardar el dragón en la mochila')).toBeNull();
  });

  it('contarlo sin hacerlo se reescribe; hecho con su tool o contado como intento, no', () => {
    const action = 'guardar el agua en la mochila';
    expect(movedWithoutTool({ action, narration: 'Llenas el odre y lo guardas en la mochila.', okTools: [] })).toBe('guardas');
    expect(movedWithoutTool({ action, narration: 'Lo guardas en la mochila.', okTools: ['transfer_item'] })).toBeNull();
    expect(movedWithoutTool({ action, narration: 'Intentas guardar el agua, pero no cabe.', okTools: [] })).toBeNull();
    expect(movedWithoutTool({ action, narration: 'No guardas nada: no cabe.', okTools: [] })).toBeNull();
    expect(movedWithoutTool({ action: 'mejor lo dejo', narration: 'Dejas el cubo en el brocal.', okTools: [] })).toBeNull();
  });
});
