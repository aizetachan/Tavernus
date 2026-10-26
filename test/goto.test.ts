import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine, type MasterLike, type SceneHints } from '../src/engine/engine.js';
import { parseTrivial } from '../src/engine/fastpath.js';
import { plantHook } from '../src/engine/hooks.js';
import { journalOf } from '../src/engine/journal.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import type { DialogueLine } from '../src/engine/moments.js';
import { activeJobs } from '../src/engine/progress.js';
import { noticeOf } from '../src/adapters/web/journal.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { claimSituation } from '../src/worldgen/index.js';
import { bootEngine, fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const NO_ENCOUNTER = () => 0.99;

/** Máster de prueba: apunta cada llamada y sus pistas de escena; no mueve a nadie. */
function recorder(engine: Engine) {
  const calls: { text: string; hints: SceneHints | null }[] = [];
  const master: MasterLike = {
    async resolve(actor, text) {
      calls.push({ text, hints: engine.sceneHints(actor.id) });
      return {
        ok: true, usage: {}, calls: [], context: '', model: 'stub',
        closed: { narration_private: 'El master narra.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null },
      };
    },
  };
  return { master, calls };
}

/** Brezal con atajos deterministas y viaje rápido; Lia en la plaza, junto al pozo. */
async function brezal() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, rng: NO_ENCOUNTER });
  const r = await engine.createCharacter('u_lia', 'Lia', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  const c = r.character;
  c.location = { type: 'spot', id: 'sp_pl_pozo' };
  const rec = recorder(engine);
  engine.attachMaster(rec.master);
  return { engine, c, calls: rec.calls, time };
}

const locOf = (engine: Engine, c: Character) => engine.world.characterSpot(c)!.location_id;
const mine = (engine: Engine, c: Character, from: number): GameEvent[] => engine.events.all().filter((e) => e.seq > from && e.actor_id === c.id);
const lastSeq = (engine: Engine) => engine.events.all().at(-1)?.seq ?? 0;

describe('ir a un sitio es llegar y entrar', () => {
  it('«voy a la taberna» desde la plaza acaba dentro de la taberna en una sola acción', async () => {
    const { engine, c } = await brezal();
    const from = lastSeq(engine);
    const r = await engine.act(c.id, 'voy a la taberna');
    expect(r.ok).toBe(true);
    expect(c.transit).toBeNull();
    expect(c.location.id).toBe('sp_tab_puerta');
    expect(locOf(engine, c)).toBe('loc_taberna');
    expect(mine(engine, c, from).some((e) => e.action_type === 'arrived' && e.location_id === 'loc_taberna')).toBe(true);
    // La puerta de fuera sigue siendo un sitio si se nombra la puerta.
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    expect(parseTrivial(engine.world, c, 'ir a la puerta de la taberna')).toMatchObject({ spot_id: 'sp_pl_taberna', exit: false });
    expect(parseTrivial(engine.world, c, 'voy al jabalí')).toMatchObject({ spot_id: 'sp_tab_puerta', exit: true });
  });

  it('de vuelta: con plantilla, la llegada dice que cruza la puerta y entra', async () => {
    const { engine, c } = await brezal();
    engine.world.location('loc_herreria').discovery[c.id] = 'visited';
    const from = lastSeq(engine);
    await engine.act(c.id, 'entrar en la herrería');
    const arrived = mine(engine, c, from).find((e) => e.action_type === 'arrived')!;
    expect(arrived.narration_private).toMatch(/^Cruzas la puerta de la herrería y entras en la herrería\./);
    c.location = { type: 'spot', id: 'sp_tab_barra' };
    // «Salir» a secas, desde dentro: a la plaza (no al sótano).
    expect(parseTrivial(engine.world, c, 'salir')).toMatchObject({ spot_id: 'sp_pl_taberna', exit: true });
    expect(parseTrivial(engine.world, c, 'salir de la taberna')).toMatchObject({ spot_id: 'sp_pl_taberna', exit: true });
    await engine.act(c.id, 'volver a la plaza');
    expect(locOf(engine, c)).toBe('loc_plaza');
    // «Entrar» a secas en la puerta de la herrería.
    c.location = { type: 'spot', id: 'sp_pl_herreria' };
    expect(parseTrivial(engine.world, c, 'entrar')).toMatchObject({ spot_id: 'sp_he_puerta', exit: true });
  });

  it('cruza varios sitios de una vez: de la taberna a la herrería, pasando por la plaza', async () => {
    const { engine, c } = await brezal();
    c.location = { type: 'spot', id: 'sp_tab_barra' };
    const from = lastSeq(engine);
    await engine.act(c.id, 'voy a la herrería');
    expect(c.location.id).toBe('sp_he_puerta');
    // Del camino, una sola línea por sitio de paso; nada de los puntos de la taberna ni de la herrería.
    expect(mine(engine, c, from).filter((e) => e.action_type === 'passed').map((e) => e.narration_private)).toEqual(['Pasas por Plaza del Pozo.']);
  });

  it('«ir a ver a Hugo» lleva a la herrería, a su lado', async () => {
    const { engine, c } = await brezal();
    c.knows.push('npc_hugo');
    const hugo = engine.world.npc('npc_hugo');
    expect(parseTrivial(engine.world, c, 'ir a ver a Hugo')).toMatchObject({ spot_id: hugo.location.id, exit: true });
    await engine.act(c.id, 'ir a ver a Hugo');
    expect(c.location.id).toBe(hugo.location.id);
    // Sin conocerle, no hay atajo: al máster.
    const other = await engine.createCharacter('u_ot', 'Otro', { class_id: 'fighter' });
    if (!other.ok) throw new Error(other.reason);
    other.character.location = { type: 'spot', id: 'sp_pl_pozo' };
    expect(parseTrivial(engine.world, other.character, 'ir a ver a Hugo')).toBeNull();
  });

  it('un encuentro en el camino lo para antes de llegar', async () => {
    const { engine, c } = await brezal();
    engine.world.location('loc_lindero').state['travel_encounter_chance'] = 1;
    const from = lastSeq(engine);
    await engine.act(c.id, 'voy al lindero');
    expect(engine.world.spot(c.location.id).tags).toContain('waypoint');
    expect(mine(engine, c, from).some((e) => e.action_type === 'travel_encounter')).toBe(true);
  });

  it('una salida bloqueada (el Cerco) lo deja en el último sitio al que se llega, y lo dice', async () => {
    const { engine, c } = await brezal();
    engine.world.location('loc_valcruz').discovery[c.id] = 'heard_of';
    const r = await engine.act(c.id, 'voy al camino de Valcruz');
    expect(r.text).toMatch(/no se puede cruzar \(El Cerco de Ceniza\)/);
    expect(locOf(engine, c)).toBe('loc_lindero');
    expect(c.location.id).toBe('sp_li_niebla');
  });

  it('un NPC que le aborda en un sitio de paso (gancho) lo para allí y lo narra el máster', async () => {
    const { engine, c, calls } = await brezal();
    c.location = { type: 'spot', id: 'sp_tab_barra' };
    const h = plantHook(engine.world, { location_id: 'loc_plaza', trigger: 'location', what: 'Garrán le corta el paso en la plaza.', for_character_id: c.id }, engine.gameNow());
    expect(h.ok).toBe(true);
    const r = await engine.act(c.id, 'voy a la herrería');
    expect(r.text).toMatch(/Al pasar por Plaza/);
    expect(locOf(engine, c)).toBe('loc_plaza');
    expect(calls.some((x) => x.hints?.hooks.some((k) => k.what.includes('Garrán')))).toBe(true);
  });

  it('el máster puede pedir una localización con move_to', async () => {
    const { engine, c } = await brezal();
    const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
    const out = JSON.parse(executeTool(ctx, 'move_to', { character_id: c.id, target_spot_id: null, target_location_id: 'loc_taberna', pace: 'walk' })) as Record<string, unknown>;
    expect(out['ok']).toBe(true);
    // Viaje rápido: llega en el acto, para que lo que haga después en la misma acción ocurra dentro.
    expect(out['arrived']).toBe(true);
    expect(c.transit).toBeNull();
    expect(c.location.id).toBe('sp_tab_puerta');
  });
});

/** Un turno del máster con diálogo, como lo registra el motor. */
function talk(engine: Engine, characterId: string, input: string, lines: DialogueLine[]): void {
  const npc = lines.find((l) => l.speaker === 'npc')?.npc_id ?? null;
  engine.events.emit({
    actor_id: characterId, action_type: 'master', input_text: input, narration_private: 'Habláis.', observable: null,
    tags: ['master', 'social'], payload: { master: {}, suggested_actions: [], lines, ...(npc ? { npc_id: npc } : {}) },
  }, engine['now']());
}

describe('misiones que se aceptan solas', () => {
  it('un encargo del tablón queda en curso con hablarlo con quien lo pide, sin decir «acepto»', async () => {
    const { engine } = await bootEngine(fakeTime());
    expect(activeJobs(engine.world).some((j) => j.id === 'job_lena')).toBe(true);
    talk(engine, 'ch_kael', '¿Qué hay de la leña?', [
      { speaker: 'actor', text: '¿Qué hay de la leña?' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Diez leños secos. Los del roble del claro sirven.' },
    ]);
    const q = journalOf(engine, 'ch_kael').quests.active.find((x) => x.id === 'job_lena')!;
    expect(q.status).toBe('active');
    expect(q.droppable).toBe(true);
  });

  it('give_quest registra la misión con quién la da, objetivo y recompensa, y avisa con su origen', async () => {
    const { engine } = await bootEngine(fakeTime());
    const c = engine.world.character('ch_kael');
    c.knows.push('npc_brenna');
    const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
    const out = JSON.parse(executeTool(ctx, 'give_quest', { title: 'El perro de Brenna', text: 'Brenna ha perdido a su perro y quiere saber qué fue de él.', npc_id: 'npc_brenna', objective: 'Encontrar al perro', reward: '10 monedas' })) as Record<string, unknown>;
    expect(out['ok']).toBe(true);
    expect(ctx.progress).toEqual([{ kind: 'quest', text: 'Nueva misión: «El perro de Brenna». Te lo pide Brenna.', quest: { id: 'gq_perro_brenna', title: 'El perro de Brenna', event: 'open', why: 'Te lo pide Brenna' } }]);
    expect(noticeOf({ action_type: 'progress_quest', narration_private: ctx.progress[0]!.text, observable: null, payload: { quest: ctx.progress[0]!.quest } }))
      .toEqual({ text: 'Nueva misión · «El perro de Brenna»', link: 'ver en el Diario', tab: 'journal', quest: { id: 'gq_perro_brenna', event: 'open', why: 'Te lo pide Brenna' } });
    const q = journalOf(engine, c.id).quests.active.find((x) => x.kind === 'given')!;
    expect(q).toMatchObject({ title: 'El perro de Brenna', status: 'active', giver: 'Brenna', reward: '10 monedas', steps: [{ text: 'Encontrar al perro', done: false }] });
    expect(q.origin).toMatchObject({ kind: 'giver', text: 'Te lo pide Brenna' });
    expect(q.history).toMatchObject([{ kind: 'added', text: 'Nueva misión', why: 'Te lo pide Brenna' }]);
    // Dársela otra vez no la duplica ni vuelve a avisar.
    const again = JSON.parse(executeTool({ ...ctx, progress: [] }, 'give_quest', { title: 'El perro de Brenna', text: 'Otra vez.', npc_id: 'npc_brenna', objective: null, reward: null })) as Record<string, unknown>;
    expect(again['existing']).toBe(true);
    expect(journalOf(engine, c.id).quests.active.filter((x) => x.kind === 'given')).toHaveLength(1);
  });

  it('el jugador la deja desde el Diario: vuelve a disponible y sale el aviso', async () => {
    const { engine } = await bootEngine(fakeTime());
    const c = engine.world.character('ch_kael');
    const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
    const out = JSON.parse(executeTool(ctx, 'give_quest', { title: 'Recado', text: 'Llevar un recado al molino.', npc_id: null, heard: 'En la barra se comenta que el molinero busca quien le lleve un recado', objective: null, reward: null })) as { quest_id: string };
    const r = await engine.dropQuest(c.id, out.quest_id);
    expect(r).toEqual({ ok: true, text: 'Has dejado la misión «Recado».' });
    const q = journalOf(engine, c.id).quests.active.find((x) => x.id === out.quest_id)!;
    expect(q.status).toBe('available');
    expect(q.droppable).toBe(false);
    expect(engine.events.all().at(-1)).toMatchObject({ action_type: 'progress_quest', narration_private: 'Has dejado la misión «Recado».', visibility: 'private', payload: { quest: { event: 'dropped' } } });
    expect(q.history.map((x) => x.kind)).toEqual(['added', 'dropped']);
    // Un encargo del tablón en curso, también: vuelve a disponible.
    talk(engine, c.id, 'Hablemos de la leña', [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'La leña, sí: diez leños.' }]);
    expect(journalOf(engine, c.id).quests.active.find((x) => x.id === 'job_lena')!.status).toBe('active');
    expect((await engine.dropQuest(c.id, 'job_lena')).ok).toBe(true);
    expect(journalOf(engine, c.id).quests.active.find((x) => x.id === 'job_lena')!.status).toBe('available');
    // La principal no se deja.
    expect((await engine.dropQuest(c.id, 'main')).ok).toBe(false);
  });
});
