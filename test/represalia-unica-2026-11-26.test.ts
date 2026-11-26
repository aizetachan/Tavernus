/**
 * Arreglo 19 (docs/INFORME-PASADA-4-2026-11-26.md): una sola represalia por turno. Pasada 4, violento con pausado,
 * turno 1: Fiona empuja a Hugo (Atletismo 16, éxito), Hugo le devuelve el martillazo (represalia del arreglo 12) y,
 * acto seguido, la ronda que se cierra con Elmo (Fiona «duda») le hace atacar otra vez: dos golpes y a 0 PG. La
 * represalia es el turno de Hugo en esa ronda; en la acción siguiente de Fiona, sí vuelve a atacar.
 * Mundo en memoria y máster offline, sin modelo.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { seededRng } from '../src/engine/dice.js';
import type { Character, GameEvent, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** La herrería: Fiona (bárbara) y Elmo en el banco de trabajo con Hugo; rondas cortas para que se cierren solas. */
async function herreria() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99, roundMs: 100, turnWindowMs: 0 });
  const pc = async (user: string, name: string, class_id: string): Promise<Character> => {
    const r = await engine.createCharacter(user, name, { class_id });
    if (!r.ok) throw new Error(r.reason);
    const c = engine.world.character(r.character.id);
    c.location = { type: 'spot', id: 'sp_he_banco' };
    c.hp_max = 60; c.hp_current = 60; // que aguante los golpes que haya, sea cual sea el dado
    return c;
  };
  const fiona = await pc('u_fiona', 'Fiona', 'barbarian');
  const elmo = await pc('u_elmo', 'Elmo', 'rogue');
  const hugo = engine.world.npc('npc_hugo');
  hugo.location = { type: 'spot', id: 'sp_he_banco' };
  expect(setNpcOrder(engine.world, { npc_id: hugo.id, order: 'go', spot_id: 'sp_he_banco', minutes: 600 }, engine.gameNow()).ok).toBe(true);
  engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
  return { engine, fiona, elmo, hugo };
}

/** Ataques de Hugo en los cierres del máster desde `from` (los suyos con attack y los que forzó el motor). */
function hugoAttacks(engine: Engine, hugo: Npc, from: number, target: Character): number {
  const calls = (e: GameEvent) => ((e.payload['master'] as { calls?: { name: string; input: Record<string, unknown> }[] } | null)?.calls ?? []);
  return engine.events.all().filter((e) => e.seq > from)
    .flatMap(calls).filter((c) => c.name === 'attack' && c.input['attacker_id'] === hugo.id && c.input['target_id'] === target.id).length;
}

/** La ronda que abre `who` se cierra sola (roundMs) con el otro dudando. */
async function round(engine: Engine, who: Character, text: string) {
  const r = await engine.act(who.id, text);
  expect(r.ok).toBe(true);
  return r;
}

describe('(19) una sola represalia por turno', () => {
  it('violento con pausado, turno 1: empuja a Hugo con éxito, Hugo le pega una vez y la ronda de Elmo no le repite el golpe; en su acción siguiente, sí', async () => {
    const { engine, fiona, elmo, hugo } = await herreria();
    const a = await engine.act(fiona.id, 'Agarro a Hugo por la pechera y lo empujo contra la pared. «Habla ya, o te juro que la próxima llama te la meto en la garganta.»');
    expect(a.requires_roll?.conflict?.npc_id).toBe(hugo.id);
    const hp0 = fiona.hp_current;
    const from = engine.events.all().at(-1)!.seq;
    await engine.rollPending(fiona.id);
    expect(engine.events.all().filter((e) => e.seq > from && e.action_type === 'roll').at(-1)?.narration_private).toMatch(/éxito/);
    // La represalia: Hugo pega con su tirada (arreglo 12).
    const retaliation = engine.events.all().filter((e) => e.seq > from && e.action_type === 'master_roll_outcome').at(-1)!;
    const ctxText = String((retaliation.payload['master'] as { context?: string }).context ?? '');
    expect(ctxText).toMatch(/Represalia, ya resuelta por el servidor con su tirada/);
    const hpAfter = fiona.hp_current;
    const dmg = /te da (\d+) de daño/.exec(ctxText)?.[1];
    expect(hpAfter).toBe(hp0 - Number(dmg ?? 0));
    expect(hugo.attitude.by_character[fiona.id]).toBe('hostile');
    // Elmo actúa: pelea con dos jugadores, ronda; Fiona duda y la ronda se cierra sin ella.
    const before = engine.events.all().at(-1)!.seq;
    expect(engine.spentTurns(elmo.id)).toEqual([{ npc_id: hugo.id, target_id: fiona.id }]);
    await round(engine, elmo, 'Me quedo junto al fuelle y miro a Hugo sin moverme');
    expect(engine.spentTurns(elmo.id)).toEqual([]);
    const closing = engine.events.all().filter((e) => e.seq > before && e.actor_id === elmo.id && (e.payload['scene_hints'] as { round?: { hesitant: { id: string }[] } } | undefined)?.round).at(-1)!;
    expect(closing).toBeTruthy();
    expect((closing.payload['scene_hints'] as { round: { hesitant: { id: string }[] } }).round.hesitant.map((h) => h.id)).toContain(fiona.id);
    // Hugo ya hizo su turno con la represalia: ni ataca en la ronda ni bajan otra vez los PG de Fiona.
    expect(hugoAttacks(engine, hugo, before, fiona)).toBe(0);
    expect(fiona.hp_current).toBe(hpAfter);
    expect(fiona.status).toBe('active');
    // Y el contexto de esa ronda se lo dice al máster.
    expect(String((closing.payload['master'] as { context?: string }).context)).toMatch(/Ya han hecho su turno en esta ronda\n- (?:Hugo|el herrero) \[npc_hugo\]: su represalia contra Fiona/);
    // Siguiente acción de Fiona (otra ronda, Elmo duda): Hugo vuelve a atacar.
    const next = engine.events.all().at(-1)!.seq;
    await round(engine, fiona, 'Retrocedo un paso y levanto los puños');
    expect(hugoAttacks(engine, hugo, next, fiona)).toBe(1);
  });

  it('sin represalia, la ronda que se cierra con un jugador dudando sigue haciendo atacar a Hugo, como antes', async () => {
    const { engine, fiona, elmo, hugo } = await herreria();
    // Ya hay pelea: Hugo es hostil con Fiona y la sala está en combate, sin tirada ni represalia por medio.
    hugo.attitude.by_character[fiona.id] = 'hostile';
    engine.events.emit({ actor_id: fiona.id, action_type: 'master', input_text: 'le pego a Hugo', narration_private: 'Le das un empujón a Hugo.', observable: null, tags: ['master', 'combat'], payload: { master: null } });
    expect(engine.spentTurns(elmo.id)).toEqual([]);
    const before = engine.events.all().at(-1)!.seq;
    await round(engine, elmo, 'Me quedo junto al fuelle y miro a Hugo sin moverme');
    expect(hugoAttacks(engine, hugo, before, fiona)).toBe(1);
  });

  it('la represalia solo cuenta en la sala donde fue y se borra cuando el que la recibió vuelve a actuar', async () => {
    const { engine, fiona, elmo, hugo } = await herreria();
    await engine.act(fiona.id, 'Agarro a Hugo por la pechera y lo empujo contra la pared.');
    await engine.rollPending(fiona.id);
    expect(engine.spentTurns(elmo.id)).toEqual([{ npc_id: hugo.id, target_id: fiona.id }]);
    // Para ella misma no es un turno gastado de nadie: el suyo ya lo cuenta engineDone.
    expect(engine.spentTurns(fiona.id)).toEqual([]);
    // Elmo, en otra sala, no la ve.
    elmo.location = { type: 'spot', id: 'sp_pl_tablon' };
    expect(engine.spentTurns(elmo.id)).toEqual([]);
    elmo.location = { type: 'spot', id: 'sp_he_banco' };
    // Fiona vuelve a actuar: ya no hay turno gastado.
    await engine.act(fiona.id, 'Retrocedo un paso y levanto los puños');
    expect(engine.spentTurns(elmo.id)).toEqual([]);
  });
});
