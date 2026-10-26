import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { toMessage } from '../src/adapters/web/server.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { rollAudience, type ShownRoll } from '../src/engine/rolls.js';
import { damageCharacter } from '../src/engine/death.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Kael en la barra de la taberna, Mira en el pozo de la plaza (otro sitio). Apunta lo que llega a cada uno. */
async function apart() {
  const { engine } = await bootEngine(fakeTime());
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  const got: Delivery[] = [];
  engine.onDelivery((d) => got.push(d));
  const to = (id: string) => got.filter((d) => d.character_id === id);
  return { engine, kael, mira, to };
}

/** Deja una tirada pendiente para el PJ, sin máster (el desenlace no importa aquí). */
function pending(engine: Engine, id: string, roll: Record<string, unknown>) {
  (engine as unknown as { pendingRolls: Map<string, unknown> }).pendingRolls.set(id, { text: 'probar', roll, event_id: 'x' });
  engine.attachMaster({ resolve: async () => ({ ok: false, reason: 'test', message: 'sin máster' }) });
}

const rolls = (ds: Delivery[]) => ds.filter((d) => d.event.payload['shown_roll']);

describe('quién ve una tirada (rollAudience)', () => {
  it('los PJ del mismo lugar, sin el que tira; los de otro sitio no', async () => {
    const { engine, kael, mira } = await apart();
    expect(rollAudience(engine.world, 'loc_taberna', kael.id)).toEqual([]);
    mira.location = { type: 'spot', id: 'sp_tab_chimenea' };
    expect(rollAudience(engine.world, 'loc_taberna', kael.id)).toEqual([mira.id]);
    expect(rollAudience(engine.world, 'loc_plaza', kael.id)).toEqual([]);
  });

  it('el turno compartido y el objetivo PJ la ven aunque estén en otro sitio; el retirado no', async () => {
    const { engine, kael, mira } = await apart();
    expect(rollAudience(engine.world, 'loc_taberna', kael.id, [kael.id, mira.id])).toEqual([mira.id]);
    expect(rollAudience(engine.world, 'loc_plaza', mira.id, [], kael.id)).toEqual([kael.id]);
    mira.status = 'retired';
    expect(rollAudience(engine.world, 'loc_taberna', kael.id, [mira.id], mira.id)).toEqual([]);
  });
});

describe('la tirada del botón 🎲', () => {
  it('la ve quien tira y quien está en el mismo lugar, con quién tira, para qué, dado, modificador, total y resultado', async () => {
    const { engine, kael, mira, to } = await apart();
    mira.location = { type: 'spot', id: 'sp_tab_chimenea' };
    pending(engine, kael.id, { kind: 'ability', key: 'str', dc: 10, advantage: 'none' });
    await engine.rollPending(kael.id);
    const own = rolls(to(kael.id)).at(-1)!;
    const seen = rolls(to(mira.id)).at(-1)!;
    expect(own.text).toMatch(/^🎲 Fuerza: d20 \[\d+\] \+ 2 = \d+ → (éxito|fallo)/);
    expect(seen.text).toMatch(/^🎲 Kael · Fuerza: d20 \[\d+\] \+ 2 = \d+ → (éxito|fallo)/);
    expect(seen.event.id).toBe(own.event.id);
    // La CD la fija el máster en secreto: no se dice.
    expect(seen.text).not.toContain('CD');
  });

  it('desde otra localización no se ve', async () => {
    const { engine, kael, mira, to } = await apart();
    pending(engine, kael.id, { kind: 'skill', key: 'athletics', dc: 12, advantage: 'none' });
    await engine.rollPending(kael.id);
    expect(rolls(to(kael.id))).toHaveLength(1);
    expect(rolls(to(mira.id))).toHaveLength(0);
  });

  it('en la web es un aviso de sistema sin narrador: el propio anima el dado, el ajeno no', async () => {
    const { engine, kael, mira, to } = await apart();
    mira.location = { type: 'spot', id: 'sp_tab_barra' };
    pending(engine, kael.id, { kind: 'attack', key: 'melee', dc: null, advantage: 'none', target: 'npc_brenna' });
    await engine.rollPending(kael.id);
    const mine = toMessage(rolls(to(kael.id)).at(-1)!, engine);
    const other = toMessage(rolls(to(mira.id)).at(-1)!, engine);
    expect(mine).toMatchObject({ kind: 'system', dice: 'mine' });
    expect(other).toMatchObject({ kind: 'system', dice: 'other' });
    expect(mine.narrator).toBeUndefined();
    expect(other.narrator).toBeUndefined();
    expect(other.notice?.text ?? other.text).toMatch(/^🎲 Kael · Ataque con daga a Brenna: d20 \[\d+\] \+ \d+ = \d+ → (impacta|falla)/);
  });
});

describe('las tiradas del máster (turno compartido, ataques, Medicina)', () => {
  function ctxFor(engine: Engine, actorId: string): ToolContext {
    const actor = engine.world.character(actorId);
    return { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(3), closed: null, rolls: [], progress: [] };
  }

  it('roll_check a la vista se apunta; el oculto no', async () => {
    const { engine, kael } = await apart();
    const ctx = ctxFor(engine, kael.id);
    executeTool(ctx, 'roll_check', { character_id: kael.id, kind: 'skill', key: 'perception', dc: 12, advantage: 'none', hidden: true });
    expect(ctx.shown_rolls ?? []).toHaveLength(0);
    executeTool(ctx, 'roll_check', { character_id: kael.id, kind: 'skill', key: 'athletics', dc: 12, advantage: 'none', hidden: false });
    expect(ctx.shown_rolls).toHaveLength(1);
    expect(ctx.shown_rolls![0]).toMatchObject({ roller_id: kael.id, label: 'Atletismo' });
    // roll_dice son los dados del máster: siguen detrás de la pantalla.
    executeTool(ctx, 'roll_dice', { expr: '2d6', reason: 'tabla', dc: null });
    expect(ctx.shown_rolls).toHaveLength(1);
  });

  it('el de un enemigo sigue oculto; el de un PJ a otro fuera de una ronda no se tira: pasa por la reacción (reactions.ts)', async () => {
    const { engine, kael, mira } = await apart();
    mira.location = { type: 'spot', id: 'sp_tab_barra' };
    const ctx = ctxFor(engine, mira.id);
    executeTool(ctx, 'attack', { attacker_id: 'npc_brenna', target_id: kael.id, advantage: 'none' });
    expect(ctx.shown_rolls ?? []).toHaveLength(0);
    executeTool(ctx, 'attack', { attacker_id: mira.id, target_id: kael.id, advantage: 'none' });
    expect(ctx.shown_rolls ?? []).toHaveLength(0);
    expect(engine.world.character(kael.id).reactions ?? []).toHaveLength(1);
  });

  it('la Medicina de un PJ para estabilizar a otro se apunta, con el caído como objetivo', async () => {
    const { engine, kael, mira } = await apart();
    mira.location = { type: 'spot', id: 'sp_tab_barra' };
    damageCharacter(engine.world, mira, mira.hp_current, { cause: 'test', nowGameS: engine.gameNow() });
    const ctx = ctxFor(engine, kael.id);
    executeTool(ctx, 'stabilize', { target_id: mira.id, healer_id: kael.id });
    expect(ctx.shown_rolls).toEqual([expect.objectContaining({ roller_id: kael.id, target_id: mira.id, label: 'Medicina para estabilizar a Mira' })]);
  });

  it('las del cierre del máster salen como evento tras la narración, también para el que tira', async () => {
    const { engine, kael, mira, to } = await apart();
    mira.location = { type: 'spot', id: 'sp_tab_barra' };
    const shown: ShownRoll = { roller_id: mira.id, label: 'Ataque con espada a Brenna', dice: 'd20 [14] + 5 = 19 vs CD 10', total: 19, outcome: 'impacta: 6 de daño', target_id: 'npc_brenna' };
    const master: MasterLike = {
      async resolve() {
        return {
          ok: true, usage: {}, calls: [], context: '', model: 'falso', shown_rolls: [shown],
          closed: { narration_private: 'Mira golpea a Brenna.', observable: 'Mira golpea a Brenna.', observable_vague: null, loudness: 1, tags: ['combat'], suggested_actions: [], requires_roll: null },
        };
      },
    };
    engine.attachMaster(master);
    await engine.act(kael.id, 'miro cómo pelea Mira');
    const own = rolls(to(mira.id)).at(-1)!;
    expect(own.text).toBe('🎲 Ataque con espada a Brenna: d20 [14] + 5 = 19 → impacta: 6 de daño');
    expect(rolls(to(kael.id)).at(-1)!.text).toBe('🎲 Mira · Ataque con espada a Brenna: d20 [14] + 5 = 19 → impacta: 6 de daño');
    const narration = to(kael.id).find((d) => d.event.action_type === 'master')!;
    expect(own.event.seq).toBeGreaterThan(narration.event.seq);
  });
});

describe('salvación contra muerte', () => {
  it('la ven el caído y quien está con él', async () => {
    const { engine, kael, mira, to } = await apart();
    mira.location = { type: 'spot', id: 'sp_tab_barra' };
    damageCharacter(engine.world, kael, kael.hp_current, { cause: 'test', nowGameS: engine.gameNow() });
    (engine as unknown as { deathSave: (c: unknown, at: number) => unknown }).deathSave(kael, engine.gameNow());
    const own = rolls(to(kael.id)).at(-1)!;
    const seen = rolls(to(mira.id)).at(-1)!;
    expect(own.event.action_type).toBe('death_save');
    expect(own.text).toMatch(/^🎲 Salvación contra muerte: d20 \[\d+\]/);
    expect(seen.text).toMatch(/^🎲 Kael · Salvación contra muerte: d20 \[\d+\]/);
    expect(toMessage(seen, engine)).toMatchObject({ kind: 'system', dice: 'other' });
  });
});
