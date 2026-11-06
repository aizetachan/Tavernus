/**
 * Cuándo hay combate (encounter.ts). Sale de la partida del 04-11-2026 (Isgral
 * y Maikol con Hugo en la herrería): un robo pillado sacó «Empieza el combate»
 * antes de la tirada de Juego de manos, un forcejeo narrado con la etiqueta
 * `combat` lo volvió a abrir, y «Fin»/«Empieza» se alternaron tres veces sin
 * que nadie pegara a nadie. La regla: combate solo con hostilidad real, y se
 * acaba en cuanto no queda ningún hostil.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { reportIncident } from '../src/engine/crime.js';
import { COMBAT_SETTLE_S, encounterAt, encounterKey } from '../src/engine/encounter.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import type { Character, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Isgral y Maikol en la fragua con Hugo (que aguanta lo que le echen y no se mueve de allí). */
async function laHerreria() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  const pc = async (user: string, name: string): Promise<Character> => {
    const r = await engine.createCharacter(user, name, { class_id: 'fighter' });
    if (!r.ok) throw new Error(r.reason);
    r.character.location = { type: 'spot', id: 'sp_he_fragua' };
    engine.setPresence(r.character.id, true);
    return r.character;
  };
  const isgral = await pc('u_isgral', 'Isgral');
  const maikol = await pc('u_maikol', 'Maikol');
  const hugo = engine.world.npc('npc_hugo');
  hugo.location = { type: 'spot', id: 'sp_he_fragua' };
  expect(setNpcOrder(engine.world, { npc_id: hugo.id, order: 'go', spot_id: 'sp_he_fragua', minutes: 600 }, engine.gameNow()).ok).toBe(true);
  hugo.stats!.hp = hugo.stats!.hp_max = 200;
  for (const c of [isgral, maikol]) c.hp_current = c.hp_max = 200;
  const loc = engine.world.spot('sp_he_fragua').location_id;
  const at = () => encounterAt(engine.world, engine.events.recentInLocation(loc, 400), loc, engine.gameNow());
  /** Un turno del máster: llama a esos tools (de verdad) y deja el evento con sus llamadas, como Master.resolve. */
  const master = (c: Character, calls: [string, Record<string, unknown>][], tags: string[] = ['master']) => {
    const ctx = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
    const done = calls.map(([name, input]) => ({ name, input, result: executeTool(ctx, name, input) }));
    return engine.events.emit({ actor_id: c.id, action_type: 'master', narration_private: '…', observable: '…', tags, payload: { master: { calls: done } } });
  };
  return { engine, time, isgral, maikol, hugo, loc, at, master };
}

const hostileTo = (n: Npc, c: Character) => (n.attitude.by_character[c.id] ?? n.attitude.default) === 'hostile';

describe('cuándo hay combate (partida del 04-11-2026)', () => {
  it('robo pillado: Hugo agarra la muñeca y riñe; ni la tirada ni el incidente ni la etiqueta combat abren combate', async () => {
    const { engine, maikol, hugo, at, master } = await laHerreria();
    // La tirada de Juego de manos (falla) y la narración del máster, etiquetada «combat» a mano.
    engine.events.emit({ actor_id: maikol.id, action_type: 'roll', narration_private: '🎲 Juego de manos: 11', observable: null, tags: ['roll'], payload: { roll: { skill: 'sleight_of_hand', total: 11, success: false } } });
    master(maikol, [], ['master', 'combat', 'crime']);
    // El robo pillado es un incidente: Hugo, la víctima, no pelea por un robo. En su herrería es el dueño y corre a
    // avisar a la autoridad (docs/CONFLICTOS-NPC.md §9: a quien le roban reacciona según su perfil).
    const i = reportIncident(engine.world, { kind: 'theft', perpetrator_id: maikol.id, victim_id: hugo.id, spot_id: hugo.location.id }, engine.gameNow());
    expect(i?.knowers.find((k) => k.npc_id === hugo.id)?.response).toBe('alert');
    await engine.tick();
    expect(engine.events.all().some((e) => e.action_type === 'incident')).toBe(true);
    expect(hostileTo(hugo, maikol)).toBe(false);
    expect(at()).toBeNull();
    // Maikol pide perdón, Hugo lo acepta: sigue sin haber combate.
    master(maikol, [['npc_trust', { npc_id: hugo.id, change: 'calm', why: 'acepta la disculpa' }]], ['master', 'social']);
    expect(at()).toBeNull();
  });

  it('un forcejeo entre jugadores (reacción grapple) narrado con la etiqueta combat no abre nada', async () => {
    const { engine, isgral, maikol, at, master } = await laHerreria();
    engine.events.emit({ actor_id: maikol.id, action_type: 'reaction_resisted', narration_private: 'Te resistes.', observable: 'Maikol se libra de Isgral.', tags: ['deterministic', 'party', 'reaction'], payload: { master: null, reaction: { id: 'r1', to: maikol.id, from: isgral.id, kind: 'grapple', answer: 'resist', success: false } } });
    master(isgral, [], ['master', 'combat']);
    expect(at()).toBeNull();
  });

  it('un ataque de verdad lo abre una sola vez: la clave no cambia con más golpes ni con narración etiquetada', async () => {
    const { time, isgral, hugo, at, master } = await laHerreria();
    expect(at()).toBeNull();
    master(isgral, [['attack', { attacker_id: isgral.id, target_id: hugo.id, advantage: 'none' }]], ['master', 'combat']);
    const first = at()!;
    expect(first).not.toBeNull();
    expect(first.fighters.map((f) => f.id)).toContain(hugo.id);
    expect(hostileTo(hugo, isgral)).toBe(true);
    const key = encounterKey(first);
    for (let k = 0; k < 3; k++) {
      time.advanceGame(20);
      master(isgral, [], ['master', 'combat']);
      time.advanceGame(20);
      master(isgral, [['attack', { attacker_id: hugo.id, target_id: isgral.id, advantage: 'none' }], ['attack', { attacker_id: isgral.id, target_id: hugo.id, advantage: 'none' }]], ['master', 'combat']);
      expect(encounterKey(at()!)).toBe(key);
    }
  });

  it('disculpa aceptada (Hugo deja de ser hostil): se acaba enseguida; si vuelve a atacar, es otro encuentro', async () => {
    const { time, isgral, hugo, at, master } = await laHerreria();
    master(isgral, [['attack', { attacker_id: isgral.id, target_id: hugo.id, advantage: 'none' }]]);
    const key = encounterKey(at()!);
    time.advanceGame(10);
    master(isgral, [['npc_trust', { npc_id: hugo.id, change: 'calm', why: 'acepta la disculpa' }]], ['master', 'social']);
    expect(hostileTo(hugo, isgral)).toBe(false);
    // El último golpe se ve un momento; luego se acaba, no tres turnos después.
    time.advanceGame(COMBAT_SETTLE_S);
    expect(at()).toBeNull();
    // Isgral vuelve a la carga: combate nuevo, con su propia clave.
    time.advanceGame(30);
    master(isgral, [['attack', { attacker_id: isgral.id, target_id: hugo.id, advantage: 'none' }]]);
    const again = at()!;
    expect(again).not.toBeNull();
    expect(encounterKey(again)).not.toBe(key);
  });

  it('el hostil se va de la herrería (a cenar): se acaba', async () => {
    const { engine, time, isgral, hugo, at, master } = await laHerreria();
    master(isgral, [['attack', { attacker_id: isgral.id, target_id: hugo.id, advantage: 'none' }]]);
    expect(at()).not.toBeNull();
    hugo.location = { type: 'spot', id: 'sp_tab_barra' };
    engine.world.touch('npcs', hugo.id);
    time.advanceGame(COMBAT_SETTLE_S);
    expect(at()).toBeNull();
  });

  it('un incidente en el que alguien responde fight sí lo abre (crime.ts), con quien se lanza a pelear', async () => {
    const { engine, maikol, hugo, at } = await laHerreria();
    const i = reportIncident(engine.world, { kind: 'assault', perpetrator_id: maikol.id, victim_id: hugo.id, spot_id: hugo.location.id }, engine.gameNow());
    expect(i?.knowers.find((k) => k.npc_id === hugo.id)?.response).toBe('fight');
    await engine.tick();
    const e = at()!;
    expect(e).not.toBeNull();
    expect(e.fighters.map((f) => f.id)).toEqual(expect.arrayContaining([hugo.id, maikol.id]));
  });
});
