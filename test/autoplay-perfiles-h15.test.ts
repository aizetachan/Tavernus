/**
 * H15 (plan de arreglos 2, 26-11-2026): perfiles mecánicos que miden. El cronista con una sola historia (en la tanda 5
 * tuvo tres pasados y cuatro hermanas), el herido que no se queda a PG máximos (13/13 desde el turno 4) y el jugador
 * automático que sabe que ha muerto y reaparecido (H9: seguía en la escena de antes y «lanzaba» a 0 PG).
 */
import { describe, expect, it } from 'vitest';
import { applyStart, CRONISTA_BIO, PROFILES, reopenWound, wakeNote, type GameSummary } from '../scripts/autoplay.js';
import { transcriptOf } from '../scripts/playtest-report.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import type { GameEvent } from '../src/engine/model.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';

const profile = (id: string) => PROFILES.find((p) => p.id === id)!;

async function bootAs(id: string) {
  const p = profile(id);
  const time = fakeTime(Date.UTC(2026, 9, 22, 12, 0, 0));
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(time.now()) }), now: time.now, deterministic: false });
  const r = await engine.createCharacter(`u_${p.id}`, 'Fen', { class_id: p.class_id, race_id: p.race_id });
  if (!r.ok) throw new Error(r.reason);
  if (p.start) applyStart(engine, r.character, p.start);
  return { engine, c: r.character, p };
}

describe('H15: el cronista tiene una sola historia', () => {
  it('la lleva en su perfil, y lo que cuenta en seco es esa historia', () => {
    const p = profile('cronista');
    expect(p.prompt).toContain(CRONISTA_BIO);
    expect(CRONISTA_BIO).toMatch(/Vadoscuro/);
    expect(CRONISTA_BIO).toMatch(/una sola hermana, Maren/);
    const dry = p.wants.map((w) => w.dry).join(' ');
    expect(dry).toContain('Vadoscuro');
    expect(dry).toContain('Maren');
    // Ni el pueblo de pescadores ni la hermana Lía de antes.
    expect(dry).not.toMatch(/pescadores|Lía/);
    for (const id of ['pasado', 'familia']) expect(p.wants.find((w) => w.id === id)!.prompt).toContain('tu historia');
  });
});

describe('H15: el herido no se queda a PG máximos', () => {
  it('a PG máximos, la herida se reabre a un tercio y el jugador lo lee; por debajo, nada', async () => {
    const { engine, c, p } = await bootAs('herido');
    expect(p.start?.reopen).toBe(true);
    const third = Math.round(c.hp_max / 3);
    expect(c.hp_current).toBe(third);
    expect(reopenWound(engine, c, p.start)).toBeNull();
    c.hp_current = c.hp_max;
    expect(reopenWound(engine, c, p.start)).toBe(`(El tajo del costado se te vuelve a abrir: estás a ${third}/${c.hp_max} PG.)`);
    expect(c.hp_current).toBe(third);
    // Sin `reopen` (el recolector) no se toca.
    const rec = await bootAs('recolector');
    rec.c.hp_current = rec.c.hp_max;
    expect(reopenWound(rec.engine, rec.c, rec.p.start)).toBeNull();
    expect(rec.c.hp_current).toBe(rec.c.hp_max);
    expect(p.prompt).toContain('se te reabre');
  });

  it('el transcript separa lo que dice la herramienta de lo que dice el juego', () => {
    const g = {
      profile: 'herido', ended: 'tope', character: { id: 'ch_x', name: 'Fen', race: 'Enano', class: 'Guerrero', hook: '', situation: null },
      actions: [{ i: 5, mode: 'own', impulse: 'pocion', text: 'Me bebo una poción.', ok: true, engine_text: null, rolls: 0, usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, event_ids: [], before: '(El tajo del costado se te vuelve a abrir: estás a 4/13 PG.)', reply: 'Recuperas 6 PG.' }],
    } as unknown as GameSummary;
    expect(transcriptOf(g)).toContain('_Antes de actuar (lo dice la herramienta): (El tajo del costado se te vuelve a abrir: estás a 4/13 PG.)_\n\n> Me bebo una poción.');
  });
});

describe('H15 y H9: el jugador sabe que ha reaparecido', () => {
  it('tras morir, dónde y con cuántos PG, y que la escena de antes pasó; tras caer sin morir, solo que vuelve en sí', async () => {
    const { engine, c } = await bootAs('recolector');
    const place = engine.world.locations.get(engine.world.characterSpot(c)!.location_id)!.name;
    const ev = (seq: number, action_type: string, actor_id = c.id) => ({ seq, action_type, actor_id }) as unknown as GameEvent;
    const died = wakeNote(engine.world, [ev(3, 'down'), ev(4, 'death'), ev(5, 'respawn')], c, 2);
    expect(died).toBe(`(Has muerto y has reaparecido en ${place}, a ${c.hp_current}/${c.hp_max} PG. Lo de antes de morir ya pasó: no estás donde caíste ni con quien estabas, y lo que pasó allí ya no lo tienes delante.)`);
    // La muerte de antes de caer esta vez, o la de otro, no cuenta.
    expect(wakeNote(engine.world, [ev(1, 'respawn'), ev(4, 'death', 'ch_otro'), ev(5, 'down')], c, 2)).toBe(`(Has estado sin sentido y vuelves en ti en ${place}, a ${c.hp_current}/${c.hp_max} PG.)`);
  });
});
