/**
 * Remate del paquete G (docs/PLAN-ARREGLOS-2-2026-11-26.md, arreglo 38): el daño del mundo a un PJ lleva dado o regla.
 * Tanda 5, lanzador T9: «5 PG fijos por un 1 natural al trepar»; T15: «4 a 2 PG porque la carta te muerde las yemas».
 * apply_damage con una cifra fija y sin arma ni conjuro se rechaza una vez pidiendo expr, severity o fall_m; con uno
 * de ellos, el servidor lo tira (worldDamage, combat.ts) y la tirada se ve. El daño de un conjuro ya tirado
 * (cast_spell en el mismo cierre) pasa con su cifra. Mundo en memoria, sin modelo.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Character } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(): Promise<{ engine: Engine; c: Character }> {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.5 });
  const r = await engine.createCharacter('u_lanz', 'Lanz', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  const c = engine.world.character(r.character.id);
  c.hp_max = 20; c.hp_current = 20;
  return { engine, c };
}

function ctxFor(engine: Engine, c: Character, extra: Partial<ToolContext> = {}): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: 'Trepo por el brocal mojado.', ...extra };
}

type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string; hint?: string };
const tool = (ctx: ToolContext, input: Record<string, unknown>): ToolOut => JSON.parse(executeTool(ctx, 'apply_damage', input)) as ToolOut;

describe('el daño del mundo lleva dado o regla', () => {
  it('una cifra fija sin arma ni conjuro se rechaza una vez, con el hint, y a la segunda pasa', async () => {
    const { engine, c } = await boot();
    const ctx = ctxFor(engine, c);
    const first = tool(ctx, { target_id: c.id, amount: 5, damage_type: 'bludgeoning', source: 'la caída al trepar' });
    expect(first.error).toBe('fixed_damage');
    expect(first.hint).toMatch(/expr|severity|fall_m/);
    expect(c.hp_current).toBe(20);
    const second = tool(ctx, { target_id: c.id, amount: 5, damage_type: 'bludgeoning', source: 'la caída al trepar' });
    expect(second.ok).toBe(true);
    expect(c.hp_current).toBe(15);
  });

  it('con severity el servidor pone el dado del nivel y la tirada se ve', async () => {
    const { engine, c } = await boot();
    const ctx = ctxFor(engine, c);
    const r = tool(ctx, { target_id: c.id, amount: 99, damage_type: 'piercing', source: 'la carta te muerde las yemas', severity: 'setback' });
    expect(r.ok).toBe(true);
    expect(ctx.rolls).toHaveLength(1);
    expect(ctx.rolls[0]!.expr).toBe('1d10');
    expect(20 - c.hp_current).toBe(ctx.rolls[0]!.total);
    expect(c.hp_current).toBeGreaterThanOrEqual(10);
  });

  it('con fall_m tira 1d6 por cada 3 m', async () => {
    const { engine, c } = await boot();
    const ctx = ctxFor(engine, c);
    const r = tool(ctx, { target_id: c.id, amount: 0, damage_type: 'falling', source: 'la caída', fall_m: 6 });
    expect(r.ok).toBe(true);
    expect(ctx.rolls[0]!.expr).toBe('2d6');
    expect(20 - c.hp_current).toBe(ctx.rolls[0]!.total);
  });

  it('el daño de un conjuro ya tirado (cast_spell en el cierre) pasa con su cifra', async () => {
    const { engine, c } = await boot();
    const ctx = ctxFor(engine, c, { ok_tools: ['cast_spell'] });
    const r = tool(ctx, { target_id: c.id, amount: 4, damage_type: 'fire', source: 'Descarga de fuego' });
    expect(r.ok).toBe(true);
    expect(c.hp_current).toBe(16);
  });
});
