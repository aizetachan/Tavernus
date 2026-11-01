/**
 * Dónde se vuelve tras morir (varios puntos, el primero donde te acogen) y qué
 * hace quien no es de pelear (Npc.noncombatant): no mata ni remata.
 * docs/PLAN-ARREGLOS-PLAYTEST.md, fase 3. Sale de la tanda del 31-10-2026: el
 * rompejuegos murió 6 veces a manos de Ilse y volvía siempre a su casa.
 */
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { dueNpcTurns, forceNpcTurns, nonLethalSource, resolveAttack } from '../src/engine/combat.js';
import { damageCharacter, die, isDying, isStable, respawn, respawnSpotId } from '../src/engine/death.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine } from '../src/engine/engine.js';
import type { Character } from '../src/engine/model.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(): Promise<{ engine: Engine; c: Character }> {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  const r = await engine.createCharacter('u_tor', 'Tor', { class_id: 'barbarian' });
  if (!r.ok) throw new Error(r.reason);
  return { engine, c: r.character };
}

/** Lo mata en la plaza y lo devuelve. */
function dieAndComeBack(engine: Engine, c: Character) {
  c.location = { type: 'spot', id: 'sp_pl_pozo' };
  die(engine.world, c, engine.gameNow(), 'una prueba');
  const back = respawn(engine.world, c);
  if (!back) throw new Error('no ha vuelto');
  return back;
}

describe('reaparición', () => {
  it('por defecto, en el camastro de Ilse y con su historia', async () => {
    const { engine, c } = await boot();
    const back = dieAndComeBack(engine, c);
    expect(back.spot_id).toBe('sp_cu_camastro');
    expect(back.story).toContain('Ilse');
    expect(c.location.id).toBe('sp_cu_camastro');
  });

  it('si Ilse le quiere mal, vuelve al molino, y la historia ya no es la de Ilse', async () => {
    for (const attitude of ['hostile', 'unfriendly'] as const) {
      const { engine, c } = await boot();
      engine.world.npc('npc_ilse').attitude.by_character[c.id] = attitude;
      expect(respawnSpotId(engine.world, c)).toBe('sp_mo_sacos');
      const back = dieAndComeBack(engine, c);
      expect(back.spot_id).toBe('sp_mo_sacos');
      expect(back.story).toContain('Mateo');
      expect(back.story).not.toContain('Ilse');
    }
  });

  it('si Ilse ha muerto, tampoco vuelve con ella', async () => {
    const { engine, c } = await boot();
    engine.world.npc('npc_ilse').status = 'dead';
    expect(dieAndComeBack(engine, c).spot_id).toBe('sp_mo_sacos');
  });

  it('cuenta también a quien vive allí, aunque ahora ande por otro sitio', async () => {
    const { engine, c } = await boot();
    const ilse = engine.world.npc('npc_ilse');
    ilse.location = { type: 'spot', id: 'sp_pl_pozo' };
    ilse.attitude.by_character[c.id] = 'hostile';
    expect(respawnSpotId(engine.world, c)).toBe('sp_mo_sacos');
  });

  it('otro hostil en la casa también descarta el sitio', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    garran.location = { type: 'spot', id: 'sp_cu_caldero' };
    garran.attitude.by_character[c.id] = 'hostile';
    expect(respawnSpotId(engine.world, c)).toBe('sp_mo_sacos');
  });

  it('el recelo de fábrica de Tobías no cierra el molino: cuenta lo que le ha hecho el PJ', async () => {
    const { engine, c } = await boot();
    engine.world.npc('npc_ilse').attitude.by_character[c.id] = 'hostile';
    expect(engine.world.npc('npc_tobias').attitude.default).toBe('unfriendly');
    expect(respawnSpotId(engine.world, c)).toBe('sp_mo_sacos');
  });

  it('si no le acogen en ninguno, el último, sin que nadie cuente que le ha traído', async () => {
    const { engine, c } = await boot();
    engine.world.npc('npc_ilse').attitude.by_character[c.id] = 'hostile';
    engine.world.npc('npc_mateo').attitude.by_character[c.id] = 'hostile';
    const back = dieAndComeBack(engine, c);
    expect(back.spot_id).toBe('sp_mo_sacos');
    expect(back.story).toBe('');
  });

  it('una partida con solo `respawn_spot_id` sigue volviendo allí, y con su historia', async () => {
    const { engine, c } = await boot();
    engine.world.campaign.death_rules = { respawn_spot_id: 'sp_tab_mesa', respawn_story: 'Te trajo alguien.' };
    engine.world.npc('npc_ilse').attitude.by_character[c.id] = 'hostile';
    const back = dieAndComeBack(engine, c);
    expect(back.spot_id).toBe('sp_tab_mesa');
    expect(back.story).toBe('Te trajo alguien.');
  });

  it('sin `c`, el primero de la campaña; un punto que no existe se salta', async () => {
    const { engine, c } = await boot();
    expect(respawnSpotId(engine.world)).toBe('sp_cu_camastro');
    engine.world.campaign.death_rules = { respawn_points: [{ spot_id: 'sp_no_existe', story: 'x' }, { spot_id: 'sp_mo_sacos', story: 'y' }] };
    expect(respawnSpotId(engine.world, c)).toBe('sp_mo_sacos');
  });
});

describe('quien no es de pelear', () => {
  it('en Brezal lo son la curandera y los del pueblo; el guardia, el alguacil y el regidor pelean', async () => {
    const { engine } = await boot();
    for (const id of ['npc_ilse', 'npc_brenna', 'npc_mateo', 'npc_tobias', 'npc_ursula']) expect(engine.world.npc(id).noncombatant, id).toBe(true);
    for (const id of ['npc_doro', 'npc_garran', 'npc_osric', 'npc_hugo', 'npc_hal', 'npc_ysolde', 'npc_lobo']) expect(engine.world.npc(id).noncombatant, id).toBeUndefined();
  });

  it('su golpe deja caído y estable, sin salvaciones: ni siquiera el daño masivo mata', async () => {
    const { engine, c } = await boot();
    const out = damageCharacter(engine.world, c, c.hp_current + c.hp_max + 10, { cause: 'un cayado', nonLethal: true, rng: seededRng(1) });
    expect(out.down).toBe(true);
    expect(out.died).toBe(false);
    expect(c.status).toBe('unconscious');
    expect(isStable(c)).toBe(true);
    expect(isDying(c)).toBe(false);
    expect(c.death ?? null).toBeNull();
  });

  it('el mismo daño de quien sí pelea mata, como siempre', async () => {
    const { engine, c } = await boot();
    const out = damageCharacter(engine.world, c, c.hp_current + c.hp_max + 10, { cause: 'una maza' });
    expect(out.died).toBe(true);
  });

  it('a quien ya está en el suelo no le hace nada, ni le suma fallos', async () => {
    const { engine, c } = await boot();
    damageCharacter(engine.world, c, c.hp_current, { cause: 'una maza' });
    expect(isDying(c)).toBe(true);
    const out = damageCharacter(engine.world, c, 5, { cause: 'un cayado', nonLethal: true });
    expect(out.failures).toBe(0);
    expect(c.dying?.fail).toBe(0);
    expect(c.status).toBe('unconscious');
  });

  it('nunca mata en una pelea real: golpea hasta dejarle caído y luego no remata', async () => {
    const { engine, c } = await boot();
    c.location = { type: 'spot', id: 'sp_cu_hierbas' };
    const ilse = engine.world.npc('npc_ilse');
    ilse.location = { type: 'spot', id: 'sp_cu_hierbas' };
    ilse.stats!.damage = '100';
    const rng = seededRng(3);
    let downed = false;
    for (let i = 0; i < 40 && !downed; i++) {
      const r = resolveAttack(engine.world, ilse.id, c.id, 'none', rng);
      if ('error' in r) throw new Error(r.error);
      expect(r.target_dead).toBe(false);
      downed = r.target_down;
    }
    expect(downed).toBe(true);
    expect(c.status).toBe('unconscious');
    expect(isStable(c)).toBe(true);
    const again = resolveAttack(engine.world, ilse.id, c.id, 'none', rng);
    expect('error' in again && again.error).toContain('no remata');
    expect(c.status).toBe('unconscious');
  });

  it('tras golpear se queda receloso: no sigue la pelea', async () => {
    const { engine, c } = await boot();
    c.location = { type: 'spot', id: 'sp_cu_hierbas' };
    const ilse = engine.world.npc('npc_ilse');
    ilse.location = { type: 'spot', id: 'sp_cu_hierbas' };
    resolveAttack(engine.world, ilse.id, c.id, 'none', seededRng(3));
    expect(ilse.attitude.by_character[c.id]).toBe('unfriendly');
    expect(dueNpcTurns(engine.world, [c.id], new Set())).toEqual([]);
  });

  it('atacarle sigue siendo una agresión: hostil, con la ley detrás, pero el motor no le hace pelear', async () => {
    const { engine, c } = await boot();
    c.location = { type: 'spot', id: 'sp_cu_hierbas' };
    const ilse = engine.world.npc('npc_ilse');
    ilse.location = { type: 'spot', id: 'sp_cu_hierbas' };
    const r = resolveAttack(engine.world, c.id, ilse.id, 'none', seededRng(2));
    expect('error' in r).toBe(false);
    expect(ilse.attitude.by_character[c.id]).toBe('hostile');
    const incidents = (engine.world.campaign as { incidents?: { perpetrator_id: string; victim_id: string | null }[] }).incidents ?? [];
    expect(incidents.some((x) => x.perpetrator_id === c.id && x.victim_id === ilse.id)).toBe(true);
    expect(dueNpcTurns(engine.world, [c.id], new Set())).toEqual([]);
    expect(forceNpcTurns(engine.world, [c.id], new Set(), seededRng(2))).toEqual([]);
  });

  it('quien sí pelea sigue actuando en cada turno', async () => {
    const { engine, c } = await boot();
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    const garran = engine.world.npc('npc_garran');
    garran.location = { type: 'spot', id: 'sp_pl_pozo' };
    garran.attitude.by_character[c.id] = 'hostile';
    expect(dueNpcTurns(engine.world, [c.id], new Set()).map((d) => d.npc.id)).toContain('npc_garran');
  });

  it('el daño que narra el máster se reconoce por su nombre, o por su arma si está delante', async () => {
    const { engine, c } = await boot();
    c.location = { type: 'spot', id: 'sp_cu_hierbas' };
    const ilse = engine.world.npc('npc_ilse');
    ilse.location = { type: 'spot', id: 'sp_cu_hierbas' };
    expect(nonLethalSource(engine.world, c, 'el cayado de Ilse')).toBe(true);
    expect(nonLethalSource(engine.world, c, 'cayado')).toBe(true);
    expect(nonLethalSource(engine.world, c, 'una caída')).toBe(false);
    ilse.location = { type: 'spot', id: 'sp_pl_pozo' };
    expect(nonLethalSource(engine.world, c, 'cayado')).toBe(false);
    expect(nonLethalSource(engine.world, c, 'la maza de Garrán')).toBe(false);
  });
});
