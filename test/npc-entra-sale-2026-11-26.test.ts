/**
 * Arreglo 30, parte del motor (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete E): la salida y la entrada de un NPC se
 * ven, y el evento `npc_move` lleva `move` (quién, de dónde a dónde, salida o llegada, por qué y cuándo) para la
 * guarda de presencia del paquete F. Caso real: charlatán T11 (data/local/autoplay/20261126-0418), «Ilse se va del
 * caldero, camino de la misa del pozo.» y 19 turnos después sigue en el caldero. Sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { tickSchedule } from '../src/engine/schedule.js';
import { setNpcOrder, tickOrders, haciaEs, type NpcMove } from '../src/engine/npcorders.js';
import type { EmitInput } from '../src/engine/events.js';
import type { StoryOutput } from '../src/engine/story.js';
import { GAME_DAY, GAME_HOUR, GAME_MINUTE } from '../src/clock/clock.js';
import type { Character, Id, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  const r = await engine.createCharacter('u_iker', 'Iker', { class_id: 'bard' });
  if (!r.ok) throw new Error(r.reason);
  r.character.connected = true;
  return { engine, w: engine.world, iker: r.character, time };
}

function put(spotId: string, ...who: (Character | Npc)[]): void {
  for (const x of who) { x.location = { type: 'spot', id: spotId }; delete (x as Npc & { order?: unknown }).order; }
}

const moves = (out: EmitInput[], npcId?: Id) => out.filter((e) => e.action_type === 'npc_move' && (!npcId || (e.payload as { npc_id?: Id }).npc_id === npcId));
const moveOf = (e: EmitInput) => (e.payload as { move: NpcMove }).move;

describe('arreglo 30: la salida y la entrada de un NPC se ven y quedan en el evento', () => {
  it('Ilse deja el caldero para la misa (charlatán T11): línea de salida con adónde va y `move` en el evento', async () => {
    const { engine, w, iker } = await boot();
    const day = Math.floor(engine.gameNow() / GAME_DAY) + 1;
    // Por la tarde, Ilse en su caldero y Iker con ella; un tick antes de la misa para que la agenda esté al día.
    put('sp_cu_caldero', iker, w.npc('npc_ilse'));
    const sink: EmitInput[] = [];
    tickSchedule(w, day * GAME_DAY + 19 * GAME_HOUR + 50 * GAME_MINUTE, (i) => { sink.push(i); });
    put('sp_cu_caldero', w.npc('npc_ilse'));
    sink.length = 0;
    tickSchedule(w, day * GAME_DAY + 20 * GAME_HOUR + GAME_MINUTE, (i) => { sink.push(i); });
    const ilse = moves(sink, 'npc_ilse');
    expect(ilse.map((e) => e.observable)).toEqual([
      'Ilse deja el caldero y sale hacia Plaza del Pozo, camino de la misa del pozo.',
      'Ilse llega al pozo para la misa del pozo.',
    ]);
    expect(ilse[0]!.at.location_id).toBe('loc_curandera');
    expect(moveOf(ilse[0]!)).toMatchObject({ npc_id: 'npc_ilse', dir: 'leave', cause: 'schedule', from_spot_id: 'sp_cu_caldero', from_location_id: 'loc_curandera', to_location_id: 'loc_plaza', to_spot_id: 'sp_pl_pozo' });
    expect(moveOf(ilse[1]!)).toMatchObject({ dir: 'arrive', to_location_id: 'loc_plaza' });
    expect(moveOf(ilse[0]!).game_s).toBe(day * GAME_DAY + 20 * GAME_HOUR + GAME_MINUTE);
  });

  it('el relleno que sale de donde hay jugadores se ve; donde no hay nadie, y en su paseo, sigue callado', async () => {
    const { engine, w, iker } = await boot();
    const fermina = w.npc('npc_x_fermina');
    const day = Math.floor(engine.gameNow() / GAME_DAY) + 1;
    const nowS = day * GAME_DAY + 10 * GAME_HOUR + 30 * GAME_MINUTE; // por la mañana, a la rueda del molino
    // Con Iker en la plaza, Fermina sale de ella.
    put('sp_pl_pozo', iker, fermina);
    const sink: EmitInput[] = [];
    tickSchedule(w, nowS, (i) => { sink.push(i); });
    const out = moves(sink, 'npc_x_fermina');
    expect(fermina.location.id).not.toBe('sp_pl_pozo');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.observable).toBe('Fermina deja el pozo y sale hacia el molino.');
    expect(moveOf(out[0]!)).toMatchObject({ npc_id: 'npc_x_fermina', dir: 'leave', cause: 'schedule', from_location_id: 'loc_plaza' });
    // Sin nadie en la plaza ni adonde va, callada.
    put('sp_cs_cueva', iker);
    put('sp_pl_pozo', fermina);
    sink.length = 0;
    tickSchedule(w, nowS + 60, (i) => { sink.push(i); });
    expect(fermina.location.id).not.toBe('sp_pl_pozo');
    expect(moves(sink, 'npc_x_fermina')).toEqual([]);
    // Dentro de la plaza (a su casa, de noche), tampoco: es su paseo, no una salida.
    put('sp_pl_pozo', iker, fermina);
    sink.length = 0;
    tickSchedule(w, day * GAME_DAY + 23 * GAME_HOUR, (i) => { sink.push(i); });
    expect(w.spot(fermina.location.id).location_id).toBe('loc_plaza');
    expect(moves(sink, 'npc_x_fermina')).toEqual([]);
  });

  it('una orden (set_npc_order go) que saca a Hugo de la herrería: salida y llegada con `cause: order`', async () => {
    const { engine, w, iker } = await boot();
    const hugo = w.npc('npc_hugo');
    put('sp_he_fragua', iker, hugo);
    const nowS = engine.gameNow() + 2 * GAME_HOUR;
    expect(setNpcOrder(w, { npc_id: 'npc_hugo', order: 'go', spot_id: 'sp_tab_barra', minutes: 30 }, nowS).ok).toBe(true);
    const sink: EmitInput[] = [];
    tickOrders(w, nowS, (i) => { sink.push(i); });
    const out = moves(sink, 'npc_hugo');
    expect(out.map((e) => e.observable)).toEqual(['Hugo deja la fragua y sale hacia Taberna del Jabalí.', 'Hugo llega a la barra.']);
    expect(out.map((e) => moveOf(e).dir)).toEqual(['leave', 'arrive']);
    expect(moveOf(out[0]!)).toMatchObject({ cause: 'order', from_location_id: 'loc_herreria', to_location_id: 'loc_taberna', game_s: nowS });
  });

  it('la historia escrita mueve a un NPC: deja su `npc_move`; con la línea si la historia no le nombra, sin texto si ya lo cuenta', async () => {
    const { engine, w } = await boot();
    const ysolde = w.npc('npc_ysolde');
    const was = ysolde.location.id;
    const before = new Map<Id, Id>([...w.npcs.values()].map((n) => [n.id, n.location.id]));
    put('sp_pl_pozo', ysolde);
    const from = engine.events.all().at(-1)?.seq ?? 0;
    const empty: StoryOutput = { personal: [], announcements: [], beats: [] };
    (engine as unknown as { emitStoryMoves(b: Map<Id, Id>, o: StoryOutput[], n: number): void }).emitStoryMoves(before, [empty], engine.gameNow());
    const evs = engine.events.all().filter((e) => e.seq > from && e.action_type === 'npc_move');
    expect(evs.map((e) => (e.payload['move'] as NpcMove).dir)).toEqual(['leave', 'arrive']);
    expect(evs[0]!.payload['move']).toMatchObject({ npc_id: 'npc_ysolde', cause: 'story', from_spot_id: was, to_spot_id: 'sp_pl_pozo' });
    expect(evs[1]!.observable).toBe('Ysolde llega al pozo.');
    // Si la historia ya lo cuenta («Ysolde sale del granero…»), el evento queda sin texto: una sola voz.
    put(was, ysolde);
    const from2 = engine.events.all().at(-1)?.seq ?? 0;
    const told: StoryOutput = { personal: [], beats: [], announcements: [{ location_id: 'loc_plaza', spot_id: null, text: 'Ysolde sale del granero de noche, con la capucha echada.', public: false }] };
    put('sp_pl_pozo', ysolde);
    (engine as unknown as { emitStoryMoves(b: Map<Id, Id>, o: StoryOutput[], n: number): void }).emitStoryMoves(before, [told], engine.gameNow());
    const evs2 = engine.events.all().filter((e) => e.seq > from2 && e.action_type === 'npc_move');
    expect(evs2).toHaveLength(2);
    expect(evs2.every((e) => e.observable === null && (e.payload['move'] as NpcMove).npc_id === 'npc_ysolde')).toBe(true);
  });

  it('«hacia» con el artículo del sitio en minúscula', () => {
    expect(haciaEs('El molino')).toBe('hacia el molino');
    expect(haciaEs('La herrería')).toBe('hacia la herrería');
    expect(haciaEs('Plaza del Pozo')).toBe('hacia Plaza del Pozo');
  });
});
