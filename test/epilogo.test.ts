import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { characterStory, recapOf, type StoryRecap } from '../src/engine/story.js';
import { claimSituation } from '../src/worldgen/index.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: false, fastTravel: false });
  const r = await engine.createCharacter('u_fen', 'Fen', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return { engine, time, c: r.character };
}

const RECAP: StoryRecap = { done: 'Hecho: {list}.', none: 'Nada hecho.', open: 'Pendiente: {list}.', with_final: 'Final: {final}.', without_final: 'Sin final.', closing: 'Sigue.' };

describe('epílogo por tiempo', () => {
  it('a cada PJ le recoge lo que ha jugado y le deja claro que puede seguir', async () => {
    const { engine, time, c } = await boot();
    characterStory(c).done.push('q_agua', 'q_perro');
    time.advanceGame(109 * 3600);
    await engine.tick();
    const mine = engine.events.all().filter((e) => e.actor_id === c.id && e.action_type === 'progress_story').map((e) => e.narration_private).join('\n');
    expect(mine).toContain('«El agua turbia» y «Ceniza se ha perdido»');
    expect(mine).toContain('Nadie ha decidido todavía qué hacer con el ascua');
    expect(mine).toContain('queda abierta');
  });

  it('solo se cuenta una vez', async () => {
    const { engine, time, c } = await boot();
    time.advanceGame(109 * 3600);
    await engine.tick();
    time.advanceGame(24 * 3600);
    await engine.tick();
    expect(engine.events.all().filter((e) => e.actor_id === c.id && /queda abierta/.test(e.narration_private))).toHaveLength(1);
  });

  it('distingue quien no ha hecho nada, quien tiene pendientes y quien cumplió un final', async () => {
    const { engine, c } = await boot();
    const st = characterStory(c);
    st.open.length = 0;
    expect(recapOf(engine.world, c, RECAP)).toBe('Nada hecho. Sin final. Sigue.');
    st.open.push('q_perro');
    expect(recapOf(engine.world, c, RECAP)).toBe('Nada hecho. Sin final. Pendiente: «Ceniza se ha perdido». Sigue.');
    st.open.length = 0;
    st.done.push('q_agua', 'q_final_verdad');
    expect(recapOf(engine.world, c, RECAP)).toBe('Hecho: «El agua turbia». Final: La verdad en el pozo. Sigue.');
    st.done.length = 0;
    st.done.push('q_final_verdad');
    expect(recapOf(engine.world, c, RECAP)).toBe('Final: La verdad en el pozo. Sigue.');
  });
});
