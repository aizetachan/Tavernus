/**
 * Ley, combate y reacciones tras las tres tandas de pruebas del 25-11-2026 (docs/PLAN-ARREGLOS-2026-11-26.md,
 * paquete B). Cada caso reproduce un turno de los transcripts con el mundo en memoria y sin modelo (funciones del
 * motor, tools a mano o el máster offline).
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { conflictVerdict, resolveConflict, stolenOf } from '../src/engine/conflict.js';
import { allIncidents, inFightWith, reportIncident } from '../src/engine/crime.js';
import { hasTag } from '../src/engine/standing.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import type { Character, ItemDef, ItemInstance, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

const MARTILLO: ItemDef = { id: 't_martillo_cinto', name: 'martillo ligero', aliases: ['martillo'], type: 'weapon', size: 'small', weight_lb: 2, value: 2, unique: false, origin: 'custom', weapon: { damage: '1d4', damage_type: 'bludgeoning' } };

async function boot(rng: () => number = () => 0.99) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng });
  const r = await engine.createCharacter('u_bruno', 'Bruno', { class_id: 'barbarian' });
  if (!r.ok) throw new Error(r.reason);
  return { engine, time, c: engine.world.character(r.character.id) };
}

/** Lo pone allí y lo retiene (orden larga) para que su horario no se lo lleve. */
function hold(engine: Engine, n: Npc, spot: string): void {
  n.location = { type: 'spot', id: spot };
  expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spot, minutes: 600 }, engine.gameNow()).ok).toBe(true);
}

/** El martillo del cinto de Hugo (en la partida lo llevaba encima). */
function martillo(engine: Engine, hugo: Npc): ItemInstance {
  if (!engine.world.itemDefs.has(MARTILLO.id)) engine.world.itemDefs.set(MARTILLO.id, MARTILLO);
  const inst: ItemInstance = { id: 'ii_t_martillo_cinto', item_id: MARTILLO.id, quantity: 1, location: { type: 'npc', id: hugo.id }, state: {} };
  engine.world.itemInstances.set(inst.id, inst);
  return inst;
}

/** La herrería: Bruno y Hugo en el banco de trabajo, sin más gente (la autoridad, lejos). */
async function herreria() {
  const b = await boot();
  const hugo = b.engine.world.npc('npc_hugo');
  hold(b.engine, hugo, 'sp_he_banco');
  b.c.location = { type: 'spot', id: 'sp_he_banco' };
  return { ...b, hugo };
}

describe('(15) desarmar o quitar algo en una pelea abierta no es robo', () => {
  it('Opus, violento 1652, turnos 3 y 4: agarra a Hugo (Atletismo 11) y luego le quita el martillo (Atletismo 12): ni robo ni «ladrón» ni «te buscan» por robo', async () => {
    const { engine, c, hugo } = await herreria();
    const w = engine.world;
    const now = engine.gameNow();
    // Turno 3: le agarra por la pechera. Sin relación, es una agresión y Hugo se lanza contra él.
    const grab = conflictVerdict(w, [], c, hugo, 'grab', null, now)!;
    const g = resolveConflict(w, c, hugo, grab, { total: 11, natural: 6, npc_total: 4 }, now);
    expect(g.response).toBe('crime');
    expect(g.incident?.kind).toBe('assault');
    expect(g.incident?.knowers.find((k) => k.npc_id === hugo.id)?.response).toBe('fight');
    expect(inFightWith(w, c, hugo, now)).toBe(true);
    // Turno 4: le arranca el martillo del cinto en plena pelea.
    const inst = martillo(engine, hugo);
    const snatch = conflictVerdict(w, [], c, hugo, 'snatch', inst, now + 30)!;
    const s = resolveConflict(w, c, hugo, snatch, { total: 30, natural: 7, npc_total: 4 }, now + 30);
    expect(s.response).toBe('disarm');
    expect(s.incident).toBeNull();
    expect(s.facts).toMatch(/no es un robo/);
    expect(s.moved?.instance_id).toBe(inst.id);
    expect(w.itemsCarriedBy(c.id).some((i) => i.id === inst.id)).toBe(true);
    // Ni incidente de robo, ni etiqueta, ni buscado por robo; y Hugo no lo «echa en falta» luego: sabe quién lo tiene.
    expect(allIncidents(w).filter((i) => i.kind === 'theft' || i.kind === 'theft_attempt')).toHaveLength(0);
    expect(hasTag(w, c, 'ladron')).toBe(false);
    expect(c.wanted?.reason ?? '').not.toMatch(/rob/);
    expect(stolenOf(w.itemInstances.get(inst.id)!)?.noticed_game_s).toBe(now + 30);
  });

  it('transfer_item o take_coins en la pelea (reportIncident de un robo) no abren incidente; fuera de la pelea, sí', async () => {
    const { engine, c, hugo } = await herreria();
    const w = engine.world;
    const now = engine.gameNow();
    expect(inFightWith(w, c, hugo, now)).toBe(false);
    // Hostil con él (le ha atacado o se ha lanzado contra él): pelea.
    hugo.attitude.by_character[c.id] = 'hostile';
    expect(reportIncident(w, { kind: 'theft', perpetrator_id: c.id, victim_id: hugo.id }, now)).toBeNull();
    expect(allIncidents(w)).toHaveLength(0);
    // Inconsciente ya no pelea: registrarle es un robo como siempre.
    hugo.status = 'unconscious';
    expect(reportIncident(w, { kind: 'theft', perpetrator_id: c.id, victim_id: hugo.id }, now)?.kind).toBe('theft');
  });

  it('sin pelea, arrancarle algo sigue siendo delito (robo), como antes', async () => {
    const { engine, c, hugo } = await herreria();
    const w = engine.world;
    const now = engine.gameNow();
    const inst = martillo(engine, hugo);
    const v = conflictVerdict(w, [], c, hugo, 'snatch', inst, now)!;
    const r = resolveConflict(w, c, hugo, v, { total: 30, natural: 15, npc_total: 4 }, now);
    expect(r.response).toBe('crime');
    expect(r.incident?.kind).toBe('theft');
  });
});

export type { Character };
