/**
 * Arreglo 38 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete G): 0 PG es 0 PG. Lo que levanta a un PJ caído, que a 0 PG
 * no actúa, y que el daño se ve con su dado (la lanza del guardia, rompejuegos T34; el 1 natural al trepar, lanzador T9).
 *
 * Lo que se vio en las tandas 4 y 5 (pareja violento F2, pareja metódico E17, recolector T11: «una salvación con éxito
 * y en pie a 1 PG al turno siguiente») no lo hace el motor: el jugador automático (scripts/autoplay.ts, «Caído o muerto
 * no se juega») espera al caído minuto a minuto hasta que se levanta, y lo que pasa mientras (las salvaciones que
 * faltan, la estabilización, las horas, un 20 natural o la muerte y la vuelta) no sale en el transcript. Aquí queda
 * probado lo que hace el motor; lo del transcript es del paquete I.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { damageCharacter, downStateLine, healCharacter, isDying, isStable, rollDeathSave, wakeIfRested } from '../src/engine/death.js';
import { engineNpcTurn, fallDamageExpr, forcedTurnRolls, forcedTurnText, hazardDamageExpr, worldDamage } from '../src/engine/combat.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import { GAME_HOUR } from '../src/clock/clock.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.5 });
  const r = await engine.createCharacter('u_fiona', 'Fiona', { class_id: 'barbarian' });
  if (!r.ok) throw new Error(r.reason);
  const c = engine.world.character(r.character.id);
  c.location = { type: 'spot', id: 'sp_he_banco' };
  return { engine, time, c };
}

/** Un dado que saca siempre `n` en un d20. */
const d20 = (n: number) => () => (n - 1) / 20 + 0.001;

describe('(38) lo que levanta a un PJ a 0 PG', () => {
  it('una salvación con éxito solo suma un éxito: sigue a 0 PG, inconsciente', async () => {
    const { engine, c } = await boot();
    const w = engine.world;
    const now = engine.gameNow();
    expect(damageCharacter(w, c, c.hp_current, { cause: 'el martillo de Hugo', nowGameS: now }).down).toBe(true);
    const s = rollDeathSave(w, c, now, d20(11))!;
    expect(s).toMatchObject({ outcome: 'success', success: 1, fail: 0, stable: false });
    expect(c.hp_current).toBe(0);
    expect(c.status).toBe('unconscious');
    expect(isDying(c)).toBe(true);
    expect(downStateLine(c)).toMatch(/0 PG, INCONSCIENTE y MURIENDO \(salvaciones: éxitos 1\/3, fallos 0\/3\).*Un éxito no le levanta/);
  });

  it('tres éxitos le estabilizan a 0 PG; despierta con 1 PG solo tras sus horas', async () => {
    const { engine, c } = await boot();
    const w = engine.world;
    const now = engine.gameNow();
    damageCharacter(w, c, c.hp_current, { cause: 'golpe', nowGameS: now });
    for (let k = 0; k < 3; k++) rollDeathSave(w, c, now + k * 60, d20(12));
    expect(isStable(c)).toBe(true);
    expect(c.hp_current).toBe(0);
    expect(c.status).toBe('unconscious');
    expect(downStateLine(c)).toMatch(/ESTABLE/);
    expect(wakeIfRested(w, c, now + 60)).toBe(false);
    expect(wakeIfRested(w, c, now + 5 * GAME_HOUR)).toBe(true);
    expect(c.hp_current).toBe(1);
    expect(c.status).toBe('active');
  });

  it('solo un 20 natural le levanta en el acto, a 1 PG (SRD); o una curación', async () => {
    const { engine, c } = await boot();
    const w = engine.world;
    const now = engine.gameNow();
    damageCharacter(w, c, c.hp_current, { cause: 'golpe', nowGameS: now });
    expect(rollDeathSave(w, c, now, d20(20))!.outcome).toBe('revive');
    expect(c.hp_current).toBe(1);
    expect(c.status).toBe('active');
    expect(downStateLine(c)).toBeNull();
    damageCharacter(w, c, 1, { cause: 'golpe', nowGameS: now });
    expect(healCharacter(w, c, 3, 'Ilse').revived).toBe(true);
    expect(c.hp_current).toBe(3);
  });

  it('a 0 PG no actúa: «Curar heridas» (recolector T11) o levantarse y agarrar (pareja violento F2) se rechazan antes del máster', async () => {
    const { engine, c } = await boot();
    const seen: string[] = [];
    const m: MasterLike = { async resolve(_a, text) { seen.push(text); return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: { narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } }; } };
    engine.attachMaster(m);
    damageCharacter(engine.world, c, c.hp_current, { cause: 'golpe', nowGameS: engine.gameNow() });
    // Que el tick no tire salvaciones en medio (con un 20 se levantaría, como manda el SRD).
    c.dying!.next_game_s = engine.gameNow() + 10 * GAME_HOUR;
    for (const t of [
      'Abro los ojos con el sabor a hierro en la boca y, sin levantarme, susurro hacia mi brazo mordido: «Curar heridas», apoyando la mano sobre la sangre del costado.',
      'Me levanto tambaleándome, agarro a Elmo por la capa y le escupo: «¿Y tú qué mirabas por la rendija, eh?»',
    ]) {
      const r = await engine.act(c.id, t);
      expect(r.ok, t).toBe(false);
      expect(r.text).toMatch(/inconsciente, a 0 PG/);
    }
    expect(seen).toHaveLength(0);
    expect(c.hp_current).toBe(0);
  });
});

describe('(38) el daño se ve con su dado', () => {
  it('rompejuegos T34: el golpe de la autoridad hostil lleva su tirada de ataque y su dado de daño a la vista', async () => {
    const { engine, c } = await boot();
    const w = engine.world;
    const doro = w.npc('npc_doro');
    doro.location = { type: 'spot', id: 'sp_he_banco' };
    expect(setNpcOrder(w, { npc_id: doro.id, order: 'go', spot_id: 'sp_he_banco', minutes: 600 }, engine.gameNow()).ok).toBe(true);
    doro.attitude.by_character[c.id] = 'hostile';
    const f = engineNpcTurn(w, doro.id, c.id, () => 0.9, engine.gameNow())!;
    expect(f).not.toBeNull();
    const text = forcedTurnText(w, f, c.id, () => 'el guardia');
    expect(text).toMatch(/^El guardia te ataca con .+ \(d20 \[\d+\][^)]*contra tu CA \d+\) (te da \d+ de daño \(.+\)|falla)\./);
    const rolls = forcedTurnRolls(f, () => 'el guardia');
    expect(rolls[0]!.expr).toMatch(/^El guardia: ataque con /);
    expect(rolls[0]!.breakdown).toMatch(/contra CA \d+: (acierta|falla)$/);
    if (f.outcome.hit) expect(rolls[1]!.expr).toBe('El guardia: daño');
  });

  it('lanzador T9 y T15: el daño del mundo sale de un dado o una regla, no de una cifra a ojo', () => {
    expect(hazardDamageExpr(1, 'setback')).toBe('1d10');
    expect(hazardDamageExpr(1, 'dangerous')).toBe('2d10');
    expect(hazardDamageExpr(5, 'setback')).toBe('2d10');
    expect(fallDamageExpr(2)).toBeNull();
    expect(fallDamageExpr(6)).toBe('2d6');
    expect(fallDamageExpr(100)).toBe('20d6');
    const climb = worldDamage(1, { fall_m: 3 }, () => 0.5)!;
    expect(climb).toMatchObject({ expr: '1d6', total: 4 });
    expect(climb.breakdown).toMatch(/caída de 3 m/);
    const card = worldDamage(1, { severity: 'setback' }, () => 0.1)!;
    expect(card.expr).toBe('1d10');
    expect(card.breakdown).toMatch(/un percance/);
    expect(worldDamage(1, { expr: '1d4' }, () => 0.99)!.total).toBe(4);
    expect(worldDamage(1, {})).toBeNull();
  });
});
