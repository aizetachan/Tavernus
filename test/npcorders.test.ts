import { describe, expect, it } from 'vitest';
import { offlineCalls, offlineClient } from '../src/ai/offline.js';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { Master } from '../src/ai/master.js';
import { toMessage } from '../src/adapters/web/server.js';
import { GAME_MINUTE } from '../src/clock/clock.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import { LINGER_S, orderOf, promisedMove } from '../src/engine/npcorders.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { claimSituation } from '../src/worldgen/index.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Demo con atajos deterministas (moverse no pasa por el máster): Kael en la barra con Brenna; Mira en la plaza, junto al pozo. */
async function tavern() {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { deterministic: true });
  const got: Delivery[] = [];
  engine.events.onDelivery((d) => got.push(d));
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  const brenna = engine.world.npc('npc_brenna');
  return { engine, time, got, kael, mira, brenna };
}

/** Lo que haría el máster: un tool con el actor y la hora de ahora. */
function tool(engine: Engine, actor: Character, name: string, input: Record<string, unknown>, ctx?: ToolContext): Record<string, unknown> {
  const c: ToolContext = ctx ?? { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [] };
  return JSON.parse(executeTool(c, name, input)) as Record<string, unknown>;
}

const ORDER = { character_id: null, target_spot_id: null, target_location_id: null, task_kind: 'none', task_text: null, task_target_id: null, task_amount: null, task_item_id: null, minutes: null };
const since = (engine: Engine, seq: number): GameEvent[] => engine.events.all().filter((e) => e.seq > seq);
const lastSeq = (engine: Engine) => engine.events.all().at(-1)?.seq ?? 0;
const readsOf = (got: Delivery[], id: string, type: string) => got.filter((d) => d.character_id === id && d.event.action_type === type).map((d) => d.text);
const locOf = (engine: Engine, spotId: string) => engine.world.spot(spotId).location_id;

describe('seguir: el NPC que acepta acompañar va con el PJ', () => {
  it('sale con él de la taberna, llega con él a la plaza y lo ven marcharse y llegar', async () => {
    const { engine, got, kael, mira, brenna } = await tavern();
    const r = tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' });
    expect(r).toMatchObject({ ok: true, npc: 'Brenna' });
    expect(orderOf(brenna)).toMatchObject({ kind: 'follow', character_id: 'ch_kael' });
    // Aún no se mueve: espera a que él se mueva.
    await engine.tick();
    expect(brenna.location.id).toBe('sp_tab_barra');

    const from = lastSeq(engine);
    await engine.act(kael.id, 'salir a la plaza');
    expect(locOf(engine, kael.location.id)).toBe('loc_plaza');
    expect(brenna.location.id).toBe(engine.world.characterSpot(kael)!.id);
    const moves = since(engine, from).filter((e) => e.action_type === 'npc_move');
    expect(moves.map((e) => [e.location_id, e.observable])).toEqual([
      ['loc_taberna', 'Brenna se va de la barra con Kael.'],
      ['loc_plaza', 'Brenna llega con Kael a la puerta de la taberna.'],
    ]);
    // La llegada va después de la de Kael, y él la lee en segunda persona; Mira, desde el pozo, la ve llegar.
    const arrived = since(engine, from).find((e) => e.action_type === 'arrived' && e.actor_id === kael.id)!;
    expect(moves[1]!.seq).toBeGreaterThan(arrived.seq);
    expect(readsOf(got, kael.id, 'npc_move')).toContain('Brenna llega contigo a la puerta de la taberna.');
    expect(readsOf(got, mira.id, 'npc_move').length).toBeGreaterThan(0);
  });

  it('va con él de punto en punto, y su horario espera mientras le acompaña', async () => {
    const { engine, time, kael, brenna } = await tavern();
    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' });
    await engine.act(kael.id, 'salir a la plaza');
    await engine.act(kael.id, 'ir al pozo');
    expect(kael.location.id).toBe('sp_pl_pozo');
    expect(brenna.location.id).toBe('sp_pl_pozo');
    // Pasa media hora: su horario la querría en la barra, pero sigue con Kael.
    time.advanceGame(30 * GAME_MINUTE);
    await engine.tick();
    expect(brenna.location.id).toBe('sp_pl_pozo');
    expect(actionContext(engine, kael, 'miro alrededor')).toMatch(/Ahora: va con Kael a donde vaya/);
  });

  it('el máster no puede ponerla a seguir a alguien que no está con ella', async () => {
    const { engine, mira } = await tavern();
    const r = tool(engine, mira, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' });
    expect(String(r['error'])).toMatch(/no está donde Mira/);
  });
});

describe('dejar de seguir', () => {
  it('despedida: se queda un rato donde está y luego vuelve a lo suyo, y se la ve volver', async () => {
    const { engine, time, got, kael, mira, brenna } = await tavern();
    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' });
    await engine.act(kael.id, 'salir a la plaza');
    const r = tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'stop' });
    expect(r).toMatchObject({ ok: true });
    expect(orderOf(brenna)).toMatchObject({ kind: 'stay' });
    // Kael se mueve: ya no le sigue.
    await engine.act(kael.id, 'ir al pozo');
    expect(brenna.location.id).toBe('sp_pl_taberna');
    // Pasado el rato, su horario la devuelve a la barra.
    time.advanceGame(LINGER_S + GAME_MINUTE);
    await engine.tick();
    expect(orderOf(brenna)).toBeNull();
    expect(brenna.location.id).toBe('sp_tab_barra');
    expect(readsOf(got, mira.id, 'npc_move').some((t) => /se va/.test(t))).toBe(true);
  });

  it('se acaba sola si él se va (ausente) o se le acaba el tiempo, y se lo cuenta', async () => {
    const { engine, time, got, kael, brenna } = await tavern();
    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow', minutes: 20 });
    time.advanceGame(21 * GAME_MINUTE);
    await engine.tick();
    expect(orderOf(brenna)).toMatchObject({ kind: 'stay' });
    expect(readsOf(got, kael.id, 'npc_order_end')).toEqual(['Brenna deja de acompañarte: tiene que volver a lo suyo.']);

    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' });
    engine.setAway(kael.id, true);
    await engine.tick();
    expect(orderOf(brenna)).toMatchObject({ kind: 'stay' });
  });

  it('peligro: si le hacen daño mientras acompaña, se aparta', async () => {
    const { engine, kael, brenna } = await tavern();
    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' });
    brenna.stats!.hp -= 3;
    const from = lastSeq(engine);
    await engine.tick();
    expect(orderOf(brenna)).toMatchObject({ kind: 'stay' });
    expect(since(engine, from).find((e) => e.action_type === 'npc_order_end')?.observable).toBe('Brenna deja de acompañar a Kael: le han hecho daño y se aparta.');
    await engine.act(kael.id, 'salir a la plaza');
    expect(brenna.location.id).toBe('sp_tab_barra');
  });
});

describe('moverse por decisión propia', () => {
  it('«voy ahora a la plaza»: se va de verdad al acabar la acción, la ven irse y llegar, y vuelve pasado el rato', async () => {
    const { engine, time, got, kael, mira, brenna } = await tavern();
    const r = tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'go', target_location_id: 'loc_plaza', minutes: 30 });
    expect(r).toMatchObject({ ok: true });
    const from = lastSeq(engine);
    await engine.tick();
    expect(brenna.location.id).toBe('sp_pl_taberna');
    expect(orderOf(brenna)).toMatchObject({ kind: 'stay', spot_id: 'sp_pl_taberna' });
    expect(since(engine, from).filter((e) => e.action_type === 'npc_move').map((e) => e.observable)).toEqual(['Brenna se va de la barra.', 'Brenna llega a la puerta de la taberna.']);
    expect(readsOf(got, kael.id, 'npc_move')).toContain('Brenna se va de la barra.');
    expect(readsOf(got, mira.id, 'npc_move')).toContain('Brenna llega a la puerta de la taberna.');
    time.advanceGame(31 * GAME_MINUTE);
    await engine.tick();
    expect(brenna.location.id).toBe('sp_tab_barra');
  });

  it('con un encargo: va a donde está el herido y le cura al llegar', async () => {
    const { engine, kael, mira, brenna } = await tavern();
    mira.hp_current = 0; mira.status = 'unconscious';
    const r = tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'go', task_kind: 'heal', task_text: 'se arrodilla junto a Mira y le pone un emplasto', task_target_id: 'ch_mira', task_amount: 4 });
    expect(r).toMatchObject({ ok: true });
    const from = lastSeq(engine);
    await engine.tick();
    expect(brenna.location.id).toBe('sp_pl_pozo');
    expect(mira.hp_current).toBe(4);
    expect(mira.status).toBe('active');
    expect(since(engine, from).find((e) => e.action_type === 'npc_task')?.observable).toBe('Brenna se arrodilla junto a Mira y le pone un emplasto.');
    expect(orderOf(brenna)).toMatchObject({ kind: 'stay', task: null });
  });

  it('el encargo al seguir: lo hace en cuanto llega con él donde está el herido, y deja de seguirle', async () => {
    const { engine, kael, mira, brenna } = await tavern();
    mira.hp_current = 0; mira.status = 'unconscious';
    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow', task_kind: 'heal', task_text: 'cura a Mira', task_target_id: 'ch_mira' });
    await engine.tick();
    expect(mira.hp_current).toBe(0); // Mira está en la plaza: aún no
    await engine.act(kael.id, 'salir a la plaza');
    expect(brenna.location.id).toBe('sp_pl_pozo');
    expect(mira.hp_current).toBeGreaterThan(0);
    expect(orderOf(brenna)).toMatchObject({ kind: 'stay' });
  });
});

describe('el cierre del máster', () => {
  it('detecta al NPC que dice que va sin orden', () => {
    expect(promisedMove({ npcLines: ['Lo dices como si ya lo hubieras visto morir. Vamos. Tú delante, y no toques lo que no sepas.'], narration: '', hasOrder: false, ordered: false })).toBe('Tu delante');
    expect(promisedMove({ npcLines: [], narration: 'Brenna deja el trapo y te acompaña hasta la puerta.', hasOrder: false, ordered: false })).toBe('te acompana');
    expect(promisedMove({ npcLines: ['Vamos a ver qué traes.'], narration: 'Brenna te mira.', hasOrder: false, ordered: false })).toBeNull();
    expect(promisedMove({ npcLines: ['Te sigo.'], narration: '', hasOrder: false, ordered: true })).toBeNull();
  });

  it('rechaza una vez el cierre con «tú delante» sin set_npc_order; con la orden, pasa', async () => {
    const { engine, kael } = await tavern();
    const close = { narration_private: 'Brenna deja la jarra.', observable: null, observable_vague: null, loudness: 1, tags: '', suggested_actions: '', npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Vamos. Tú delante.' }] };
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    expect(String(tool(engine, kael, 'log_event', close, ctx)['error'])).toMatch(/set_npc_order con order=follow/);
    const ok: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' }, ok);
    expect(tool(engine, kael, 'log_event', close, ok)).toMatchObject({ ok: true });
  });

  it('en la web, la llegada y la marcha son un aviso de una línea', async () => {
    const { engine, got, kael, mira } = await tavern();
    tool(engine, kael, 'set_npc_order', { ...ORDER, npc_id: 'npc_brenna', order: 'follow' });
    await engine.act(kael.id, 'salir a la plaza');
    const d = got.find((x) => x.character_id === mira.id && x.event.action_type === 'npc_move')!;
    expect(toMessage(d, engine)).toMatchObject({ text: '', notice: { text: expect.stringMatching(/^Brenna llega con Kael/) } });
  });
});

describe('la curandera de la partida del 26 (Brezal, máster offline)', () => {
  it('«acompáñame, hay un herido en la plaza»: Ilse acepta, sale con él y llega a la plaza; su horario no se la lleva', async () => {
    const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
    const time = fakeTime(EPOCH);
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, rng: () => 0.99 });
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(1) }));
    const r = await engine.createCharacter('u_leo', 'Leodhin', { class_id: 'wizard' });
    if (!r.ok) throw new Error(r.reason);
    claimSituation(engine.world, r.character.id, engine.gameNow());
    const leo = r.character;
    const ilse = engine.world.npc('npc_ilse');
    leo.location = { type: 'spot', id: ilse.location.id };
    leo.knows.push(ilse.id);
    const home = ilse.location.id;
    expect(locOf(engine, home)).toBe('loc_curandera');

    // Lo que hace el offline con esa frase: set_npc_order follow antes del cierre.
    const ctx = actionContext(engine, leo, 'Ilse, acompáñame a la plaza, hay un herido');
    expect(offlineCalls(ctx).map((c) => c.name)).toEqual(['set_npc_order', 'log_event']);

    await engine.act(leo.id, 'Ilse, acompáñame a la plaza, hay un herido');
    expect(orderOf(ilse)).toMatchObject({ kind: 'follow', character_id: leo.id });
    const from = lastSeq(engine);
    await engine.act(leo.id, 'ir a la plaza');
    expect(locOf(engine, leo.location.id)).toBe('loc_plaza');
    expect(ilse.location.id).toBe(leo.location.id);
    expect(since(engine, from).filter((e) => e.action_type === 'npc_move').map((e) => e.location_id)).toEqual(['loc_curandera', 'loc_plaza']);
    time.advanceGame(30 * GAME_MINUTE);
    await engine.tick();
    expect(ilse.location.id).toBe(leo.location.id);

    // «Ya puedes volver»: la despide; pasado el rato vuelve a su casa.
    await engine.act(leo.id, 'Ilse, ya puedes volver, gracias');
    expect(orderOf(ilse)).toMatchObject({ kind: 'stay' });
    time.advanceGame(LINGER_S + GAME_MINUTE);
    await engine.tick();
    expect(locOf(engine, ilse.location.id)).toBe('loc_curandera');
  });
});
