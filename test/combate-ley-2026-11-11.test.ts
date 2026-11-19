/**
 * Combate y ley tras la partida del 11-11-2026 (Pillin y Zhenzet en la Taberna
 * del Jabalí; plan en docs/PLAN-REUNION-2026-11-11.md, fase 4). Lo que pasó:
 * un bofetón a Damián, parroquiano de relleno, abrió «Empieza el combate»
 * porque la víctima respondía `fight` sin poder pelear; Garrán se interpuso
 * (detención, no pelea) y el combate acabó solo por tiempo; y Garrán repitió
 * «¡Alto! Quedas detenido» once veces, una cada hora, mientras el jugador
 * dormía o no estaba.
 *
 * Lo que el motor garantiza ahora:
 *   - Se lanza a pelear solo quien puede (ficha y no es gente de paz); la gente
 *     de relleno grita y se aparta, y eso no abre combate.
 *   - Con la autoridad delante, la víctima que sí pelea se contiene (`hold`):
 *     es una detención, no un combate (salvo que vaya de muerte).
 *   - Un alto por encuentro: si la misma autoridad vuelve a verle antes de seis
 *     horas sin que haya respondido, no lo repite: actúa (le reduce y cobra o
 *     encierra). Dormido o con el jugador ausente, nadie le da el alto.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { ALTO_REPEAT_S, reportIncident } from '../src/engine/crime.js';
import { encounterAt, hostilityOf } from '../src/engine/encounter.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import type { Character, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function laTaberna(opts: { law?: boolean } = {}) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  engine.world.campaign.law = { ...engine.world.campaign.law, enforcers: ['npc_garran'] };
  const r = await engine.createCharacter('u_pillin', 'Pillin', { class_id: 'fighter' });
  if (!r.ok) throw new Error(r.reason);
  const pillin = r.character;
  pillin.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(pillin.id, true);
  const hold = (n: Npc, spotId: string) => {
    n.location = { type: 'spot', id: spotId };
    expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spotId, minutes: 600 }, engine.gameNow()).ok).toBe(true);
  };
  const garran = engine.world.npc('npc_garran');
  const hugo = engine.world.npc('npc_hugo');
  const damian = [...engine.world.npcs.values()].find((n) => n.tier === 'extra' && n.noncombatant && n.stats)!;
  expect(damian).toBeDefined();
  hold(damian, 'sp_tab_barra');
  hold(hugo, 'sp_tab_barra');
  // Garrán delante, o lejos (en la plaza) para ver cómo cambia la víctima.
  hold(garran, opts.law === false ? 'sp_pl_tablon' : 'sp_tab_barra');
  pillin.knows.push('npc_garran', 'npc_hugo');
  const loc = engine.world.spot('sp_tab_barra').location_id;
  const at = () => encounterAt(engine.world, engine.events.recentInLocation(loc, 400), loc, engine.gameNow());
  const arrests = () => engine.events.all().filter((e) => e.action_type === 'arrest');
  return { engine, time, pillin, garran, hugo, damian, loc, at, hold, arrests };
}

const slap = (engine: Engine, who: Character, victim: Npc) => reportIncident(engine.world, { kind: 'assault', perpetrator_id: who.id, victim_id: victim.id, spot_id: victim.location.id }, engine.gameNow())!;

describe('un bofetón al parroquiano con Garrán delante es una detención, no un combate', () => {
  it('Damián (relleno, gente de paz) grita y se aparta: ni él ni el incidente abren combate', async () => {
    const { engine, pillin, damian, at, arrests } = await laTaberna();
    const i = slap(engine, pillin, damian);
    expect(i.knowers.find((k) => k.npc_id === damian.id)?.response).toBe('shout');
    expect(i.knowers.find((k) => k.npc_id === 'npc_garran')?.response).toBe('arrest');
    await engine.tick();
    const incident = engine.events.all().find((e) => e.action_type === 'incident')!;
    expect(incident).toBeDefined();
    expect(hostilityOf(engine.world, incident).open).toBe(false);
    expect(at()).toBeNull();
    // Garrán le da el alto una vez.
    expect(arrests()).toHaveLength(1);
    expect(pillin.wanted?.arrest).toMatchObject({ npc_id: 'npc_garran', announced: true });
  });

  it('Hugo, que sí pelea, se contiene con Garrán delante (hold); sin autoridad a la vista, se lanza (fight)', async () => {
    const withLaw = await laTaberna();
    const i = slap(withLaw.engine, withLaw.pillin, withLaw.hugo);
    expect(i.knowers.find((k) => k.npc_id === 'npc_hugo')?.response).toBe('hold');
    await withLaw.engine.tick();
    expect(withLaw.at()).toBeNull();
    const incident = withLaw.engine.events.all().find((e) => e.action_type === 'incident')!;
    expect(incident.observable).toMatch(/Hugo aprieta los puños, pero no se mueve/);

    const alone = await laTaberna({ law: false });
    const j = slap(alone.engine, alone.pillin, alone.hugo);
    expect(j.knowers.find((k) => k.npc_id === 'npc_hugo')?.response).toBe('fight');
    await alone.engine.tick();
    expect(alone.at()?.fighters.map((f) => f.id)).toEqual(expect.arrayContaining(['npc_hugo', alone.pillin.id]));
  });
});

describe('un alto por encuentro', () => {
  it('Garrán se va y vuelve a verle sin que haya respondido: no repite el alto, le reduce y le cobra', async () => {
    const { engine, time, pillin, garran, hold, arrests } = await laTaberna();
    slap(engine, pillin, engine.world.npc('npc_hugo'));
    await engine.tick();
    expect(arrests()).toHaveLength(1);
    expect(pillin.wanted?.altos).toMatchObject([{ npc_id: 'npc_garran' }]);
    // Garrán sale a la plaza: la detención queda en el aire.
    hold(garran, 'sp_pl_tablon');
    time.advanceGame(1800);
    await engine.tick();
    expect(pillin.wanted?.arrest).toBeNull();
    // Vuelve a la barra una hora después: ni un segundo «¡Alto!», actúa.
    hold(garran, 'sp_tab_barra');
    time.advanceGame(1800);
    await engine.tick();
    expect(arrests()).toHaveLength(1);
    const seized = engine.events.all().filter((e) => e.action_type === 'seized' || e.action_type === 'law_attack');
    expect(seized).toHaveLength(1);
    expect(seized[0]!.narration_private).toMatch(/no te da el alto otra vez/);
  });

  it('pasadas seis horas de juego, un encuentro nuevo vuelve a empezar con el alto', async () => {
    const { engine, time, pillin, garran, hold, arrests } = await laTaberna();
    slap(engine, pillin, engine.world.npc('npc_hugo'));
    await engine.tick();
    hold(garran, 'sp_pl_tablon');
    time.advanceGame(1800);
    await engine.tick();
    hold(garran, 'sp_tab_barra');
    time.advanceGame(ALTO_REPEAT_S);
    await engine.tick();
    expect(arrests()).toHaveLength(2);
  });

  it('con el jugador ausente no hay alto; al volver, sí', async () => {
    const { engine, pillin, arrests } = await laTaberna();
    pillin.away = true;
    slap(engine, pillin, engine.world.npc('npc_hugo'));
    await engine.tick();
    expect(arrests()).toHaveLength(0);
    expect(pillin.wanted?.arrest ?? null).toBeNull();
    pillin.away = false;
    await engine.tick();
    expect(arrests()).toHaveLength(1);
  });
});
