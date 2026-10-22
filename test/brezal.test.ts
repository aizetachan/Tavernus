import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authoredSeed, isAuthoredCampaign } from '../src/data/campaigns/index.js';
import { BREZAL } from '../src/data/campaigns/brezal/index.js';
import { validateSnapshot } from '../src/worldgen/validate.js';
import { claimSituation, generateSeed, TONES } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { characterStory, questsOf, storyOf } from '../src/engine/story.js';
import { journalOf } from '../src/engine/journal.js';
import { allRumors } from '../src/engine/rumors.js';
import { allHooks } from '../src/engine/hooks.js';
import { allScheduled } from '../src/engine/schedule.js';
import { parseTrivial } from '../src/engine/fastpath.js';
import { generateMap, mapInputOf } from '../src/adapters/web/mapgen.js';
import { GameManager } from '../src/games/manager.js';
import type { Character, WorldSnapshot } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

/** El mundo nace un 22 de octubre a mediodía real; en el juego, a las 18:00 del día 0. */
const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const H = 3600;

async function boot(): Promise<{ engine: Engine; time: ReturnType<typeof fakeTime> }> {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  // Sin viaje rápido: los trayectos duran lo que duran y no sale la tirada de encuentro.
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  return { engine, time };
}

async function newPc(engine: Engine, name: string, class_id: string): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return r.character;
}

function ctxFor(engine: Engine, c: Character): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] };
}
function tool(engine: Engine, c: Character, name: string, input: Record<string, unknown>): Record<string, unknown> & { ok?: boolean; error?: string } {
  return JSON.parse(executeTool(ctxFor(engine, c), name, input)) as Record<string, unknown> & { ok?: boolean; error?: string };
}

/** Anda hasta un punto por el camino del motor (move_to) y espera a llegar. */
async function walk(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, spotId: string): Promise<void> {
  if (engine.world.characterSpot(c)?.id === spotId) return;
  const r = tool(engine, c, 'move_to', { character_id: c.id, target_spot_id: spotId, pace: 'walk' });
  expect(r.error, `move_to ${spotId}: ${JSON.stringify(r)}`).toBeUndefined();
  if (c.transit) time.advanceGame(c.transit.arrives_game_s - engine.gameNow() + 2);
  await engine.tick();
  expect(engine.world.characterSpot(c)?.id).toBe(spotId);
}

async function take(engine: Engine, c: Character, instanceId: string, slot = 'pocket'): Promise<void> {
  const r = tool(engine, c, 'transfer_item', { instance_id: instanceId, to_type: 'character', to_id: c.id, slot, equip_slot: null, quantity: 1 });
  expect(r.error, `coger ${instanceId}: ${JSON.stringify(r)}`).toBeUndefined();
  await engine.tick();
}

async function drop(engine: Engine, c: Character, itemId: string): Promise<void> {
  const inst = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === itemId)!;
  const r = tool(engine, c, 'transfer_item', { instance_id: inst.id, to_type: 'spot', to_id: engine.world.characterSpot(c)!.id, slot: null, equip_slot: null, quantity: null });
  expect(r.error).toBeUndefined();
}

const stepOf = (engine: Engine, c: Character, questId: string) => questsOf(engine.world, c).find((v) => v.quest.id === questId);
const done = (c: Character) => characterStory(c).done;

// ---------------------------------------------------------------------------

describe('Brezal: la campaña escrita', () => {
  it('valida con el mismo validador que los mundos generados y tiene la riqueza de uno', () => {
    const snap = authoredSeed('brezal', { now: new Date(EPOCH) });
    expect(validateSnapshot(snap)).toEqual([]);
    expect(isAuthoredCampaign('brezal')).toBe(true);
    expect(isAuthoredCampaign('demo')).toBe(false);
    const c = snap.campaign as WorldSnapshot['campaign'] & { schedule: unknown[]; rumors: unknown[]; hooks: unknown[]; encounters: Record<string, unknown[]> };
    expect(snap.locations.length).toBeGreaterThanOrEqual(8);
    const people = snap.npcs.filter((n) => n.attitude.default !== 'hostile' && n.stats?.attack_name !== 'mordisco' && n.role !== 'perro');
    expect(people.length).toBeGreaterThanOrEqual(10);
    expect(people.length).toBeLessThanOrEqual(12);
    for (const n of people) {
      expect(n.secret, n.id).not.toBe('');
      expect(n.stats, n.id).not.toBeNull();
      expect((n as typeof n & { routine?: unknown }).routine, `${n.id} sin horario`).toBeDefined();
    }
    expect(c.bible!.length).toBeGreaterThanOrEqual(5);
    expect(c.laws!.length).toBeGreaterThanOrEqual(3);
    expect(c.situations).toHaveLength(3);
    expect(c.schedule.length).toBeGreaterThanOrEqual(4);
    expect(c.rumors.length).toBeGreaterThanOrEqual(5);
    expect(c.hooks.length).toBeGreaterThan(0);
    expect(Object.keys(c.encounters)).toEqual(expect.arrayContaining(['town', 'forest', 'mountain']));
    const story = (snap.campaign as unknown as { story: { quests: { act: number; exclusive?: string }[]; escalation: unknown[] } }).story;
    expect(new Set(story.quests.map((q) => q.act))).toEqual(new Set([1, 2, 3]));
    expect(story.quests.filter((q) => q.exclusive === 'final').length).toBe(3);
    expect(story.escalation.length).toBeGreaterThanOrEqual(4);
    // Cuarto de alquiler: a la vista, cerrado, y Brenna vende la noche.
    expect(snap.spots.find((s) => s.id === 'sp_tab_habitacion')!.state['locked']).toBe(true);
    expect(snap.npcs.find((n) => n.id === 'npc_brenna')!.sells.some((s) => s.item_id === 'it_noche_posada')).toBe(true);
  });

  it('es determinista: misma campaña y mismo instante, mismo mundo; nada se comparte entre partidas', () => {
    const a = authoredSeed('brezal', { now: new Date(EPOCH) });
    const b = authoredSeed('brezal', { now: new Date(EPOCH) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    a.npcs[0]!.name = 'otra';
    expect(BREZAL.npcs[0]!.name).toBe('Brenna');
    expect(authoredSeed('brezal').npcs[0]!.name).toBe('Brenna');
  });

  it('el validador encuentra lo que está mal', () => {
    const snap = authoredSeed('brezal', { now: new Date(EPOCH) });
    snap.npcs.find((n) => n.id === 'npc_doro')!.location = { type: 'spot', id: 'sp_no_existe' };
    snap.exits = snap.exits.filter((e) => e.id !== 'ex_cuesta_ruinas');
    (snap.campaign as unknown as { story: { quests: { steps: { done_when: unknown }[] }[] } }).story.quests[0]!.steps[0]!.done_when = { kind: 'clue', clue_id: 'clue_nada' };
    const errs = validateSnapshot(snap);
    expect(errs.some((e) => e.includes('npc_doro'))).toBe(true);
    expect(errs.some((e) => e.includes('loc_ruinas') && e.includes('no se llega'))).toBe(true);
    expect(errs.some((e) => e.includes('clue_nada'))).toBe(true);
  });

  it('los mundos generados pasan el mismo validador', async () => {
    for (let seed = 0; seed < 25; seed++) {
      const snap = await generateSeed({ seed, tone: TONES[seed % TONES.length]!, setting: '', client: null, now: () => new Date(EPOCH) });
      expect(validateSnapshot(snap), `semilla ${seed}`).toEqual([]);
    }
  });

  it('los planos de todas las localizaciones salen de mapgen', async () => {
    const { engine } = await boot();
    for (const l of engine.world.locations.values()) {
      const m = generateMap(mapInputOf(engine.world, l.id));
      expect(m.props.length, l.id).toBeGreaterThan(0);
      expect(m.bounds.w * m.bounds.h, l.id).toBeGreaterThan(0);
    }
  });

  it('las situaciones iniciales se reparten por clase y traen su deuda, sus objetos y su reloj', async () => {
    const { engine } = await boot();
    const maga = await newPc(engine, 'Anwen', 'wizard');
    const guerrero = await newPc(engine, 'Bran', 'fighter');
    const picara = await newPc(engine, 'Cora', 'rogue');
    const otra = await newPc(engine, 'Dama', 'cleric');
    expect(maga.situation!.antagonist_npc_id).toBe('npc_osric');
    expect(engine.world.characterSpot(maga)!.id).toBe('sp_pl_pozo');
    expect(engine.world.itemsCarriedBy(maga.id).some((i) => i.item_id === 'it_carta_sello')).toBe(true);
    expect(maga.knows).toContain('npc_ilse');
    expect(engine.world.characterSpot(guerrero)!.id).toBe('sp_he_banco');
    expect(guerrero.knows).toEqual(expect.arrayContaining(['npc_hugo', 'npc_osric']));
    expect(engine.world.characterSpot(picara)!.id).toBe('sp_tab_mesa');
    expect(picara.debts?.[0]).toMatchObject({ npc_id: 'npc_garran', amount: 300 });
    expect(picara.debts![0]!.due_game_s).toBe(picara.situation!.deadline_game_s);
    // Las situaciones de la campaña escrita no se gastan: la clériga recibe la de los letrados.
    expect(otra.situation!.why_here).toBe(maga.situation!.why_here);
    expect(engine.world.campaign.situations).toHaveLength(3);
    // El reloj del mundo nace a las 18:00 y la misa del pozo es a las 20:00.
    expect(engine.clock.format(engine.gameNow())).toMatch(/18:00$/);
    expect(picara.backstory).toContain('Garrán');
  });

  it('los lugares se nombran sin NPC dentro: «salgo hacia…» va por el atajo sin IA', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Lia', 'wizard'); // empieza en el pozo
    const go = (text: string) => parseTrivial(engine.world, c, text);
    expect(go('salgo hacia Casa de las hierbas')).toMatchObject({ kind: 'move', spot_id: 'sp_cu_puerta', exit: true });
    expect(go('voy a la herrería')).toMatchObject({ kind: 'move', spot_id: 'sp_he_puerta', exit: true });
    expect(go('voy a la casona')).toMatchObject({ kind: 'move', spot_id: 'sp_ca_puerta', exit: true });
    expect(go('voy al molino')).toMatchObject({ kind: 'move', spot_id: 'sp_mo_puerta', exit: true });
    expect(go('cojo el agua del pozo')).toMatchObject({ kind: 'take', instance_id: 'ii_agua_pozo' });
    c.location = { type: 'spot', id: 'sp_cl_cuesta' };
    expect(go('salgo hacia Cuesta Gris')).toMatchObject({ kind: 'move', spot_id: 'sp_cs_pie', exit: true });
    c.location = { type: 'spot', id: 'sp_cs_alto' };
    expect(go('salgo hacia Ruinas de Vharn')).toMatchObject({ kind: 'move', spot_id: 'sp_ru_puerta', exit: true });
  });

  it('un personaje recorre todas las localizaciones a pie', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Erro', 'rogue');
    c.abilities.str = 18; // las monedas pesan (50 por libra): que pueda con todo lo que va a llevar
    // La trampilla está oculta y la cripta cerrada: se descubre una y se lleva la llave de la otra.
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_tab_trampilla' }).error).toBeUndefined();
    engine.world.itemInstances.set('ii_test_llave', { id: 'ii_test_llave', item_id: 'it_llave_vharn', quantity: 1, location: { type: 'character', id: c.id, slot: { kind: 'pocket' } }, state: {} });
    const route = ['sp_so_cajas', 'sp_tab_puerta', 'sp_pl_pozo', 'sp_he_fragua', 'sp_ca_despacho', 'sp_cu_caldero', 'sp_mo_muelas', 'sp_cl_roble', 'sp_cs_mirador', 'sp_ru_patio', 'sp_cr_brasa', 'sp_pl_tablon'];
    for (const s of route) await walk(engine, time, c, s);
    const visited = [...engine.world.locations.values()].filter((l) => l.discovery[c.id] === 'visited').map((l) => l.id);
    expect(visited.sort()).toEqual([...engine.world.locations.keys()].sort());
  });

  it('las tres misiones del acto I, el acto II y un final del acto III se completan por tools, en orden', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Fen', 'rogue');
    c.abilities.str = 18; // las recompensas en monedas pesan
    await engine.tick();
    // Al empezar en el Jabalí y conocer a Brenna: el perro perdido.
    expect(characterStory(c).open).toContain('q_perro');

    // --- Acto I: Ceniza en el agua (sin máster: andar, coger, andar) ---
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(characterStory(c).open).toContain('q_agua');
    await take(engine, c, 'ii_agua_pozo');
    expect(stepOf(engine, c, 'q_agua')!.current!.id).toBe('ilse');
    await walk(engine, time, c, 'sp_cu_hierbas');
    expect(done(c)).toContain('q_agua');
    expect(c.clues).toContain('clue_ilse');
    expect(characterStory(c).open).toContain('q_cadena'); // se abre el acto II de Ilse
    await drop(engine, c, 'it_agua_pozo');

    // --- Acto I: Ceniza se ha perdido ---
    await walk(engine, time, c, 'sp_cl_sendero');
    expect(stepOf(engine, c, 'q_perro')!.current!.id).toBe('lobera');
    await walk(engine, time, c, 'sp_cs_cueva');
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_perro', step_id: 'volver' }).error).toMatch(/paso en curso/);
    const r = tool(engine, c, 'advance_story', { quest_id: 'q_perro', step_id: 'sacar' });
    expect(r.ok).toBe(true);
    expect(engine.world.npc('npc_ceniza').location.id).toBe('sp_tab_chimenea');
    await walk(engine, time, c, 'sp_tab_barra');
    expect(done(c)).toContain('q_perro');
    expect(engine.world.npc('npc_brenna').attitude.by_character[c.id]).toBe('friendly');
    expect(characterStory(c).open).toEqual(expect.arrayContaining(['q_sotano', 'q_subida']));

    // --- Acto I: Lo que vio Doro (la pista y la vigilia de las 23:00 en el arroyo) ---
    await walk(engine, time, c, 'sp_pl_porton');
    expect(characterStory(c).open).toContain('q_noche');
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_doro' }).ok).toBe(true);
    await walk(engine, time, c, 'sp_cl_arroyo');
    const day = Math.floor(engine.gameNow() / (24 * H));
    const at23 = day * 24 * H + 23 * H + 5 * 60;
    if (engine.gameNow() < at23) time.advanceGame(at23 - engine.gameNow());
    await engine.tick();
    expect(engine.world.npc('npc_tobias').location.id).toBe('sp_cl_arroyo');
    expect(stepOf(engine, c, 'q_noche')!.current!.id).toBe('que_lleva');
    expect(c.knows).toContain('npc_tobias');
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_mo_desvan' }).error).toBeUndefined();
    await walk(engine, time, c, 'sp_mo_desvan');
    await take(engine, c, 'ii_cartas_tobias');
    expect(done(c)).toContain('q_noche');
    expect(characterStory(c).open).toContain('q_tobias');

    // --- Acto II: Bajo el Jabalí ---
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_tab_trampilla' }).error).toBeUndefined();
    await walk(engine, time, c, 'sp_so_escalera');
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_so_hueco' }).error).toBeUndefined();
    await walk(engine, time, c, 'sp_so_hueco');
    await take(engine, c, 'ii_libro_cuentas');
    expect(c.clues).toContain('clue_libro');
    expect(done(c)).toContain('q_sotano');
    expect(allHooks(engine.world).some((h) => h.id === 'hk_garran_sotano')).toBe(true);

    // --- Acto II: El hijo del molinero (narrativos) ---
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_tobias', step_id: 'confesar' }).ok).toBe(true);
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_tobias', step_id: 'parar' }).ok).toBe(true);
    expect(done(c)).toContain('q_tobias');
    expect(allScheduled(engine.world).some((e) => e.id === 'se_tobias')).toBe(false);

    // --- Acto II: La cadena de hierro frío ---
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_hugo' }).ok).toBe(true);
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_he_losa' }).error).toBeUndefined();
    await walk(engine, time, c, 'sp_he_losa');
    await drop(engine, c, 'it_cartas_tobias');
    await drop(engine, c, 'it_libro_cuentas');
    const mochila = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_mochila')!;
    expect(tool(engine, c, 'transfer_item', { instance_id: 'ii_cadena_fria', to_type: 'container', to_id: mochila.id, slot: null, equip_slot: null, quantity: null }).error).toBeUndefined();
    await walk(engine, time, c, 'sp_cu_puerta');
    expect(done(c)).toContain('q_cadena');

    // --- Acto II: La cuesta gris ---
    await walk(engine, time, c, 'sp_cs_mirador');
    await walk(engine, time, c, 'sp_ru_patio');
    expect(stepOf(engine, c, 'q_subida')!.current!.id).toBe('ysolde');
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_ysolde' }).ok).toBe(true);
    await engine.tick();
    expect(done(c)).toContain('q_subida');

    // --- Acto III: los tres finales abiertos; atar la Brasa ---
    expect(characterStory(c).open).toEqual(expect.arrayContaining(['q_final_atar', 'q_final_verdad', 'q_final_arder']));
    // Con tres pistas y reputación, el logro da la llave de los Vharn.
    expect(c.achievements.some((a) => a.id === 'ach_ceniza')).toBe(true);
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === 'it_llave_vharn')).toBe(true);
    expect(stepOf(engine, c, 'q_final_atar')!.current!.id).toBe('bajar');
    await walk(engine, time, c, 'sp_cr_brasa');
    expect(stepOf(engine, c, 'q_final_atar')!.current!.id).toBe('atar');
    const before = c.coins;
    // Como en una acción del máster: lo que devuelve el tool va al progreso de la acción, y el final, en público.
    const actx = ctxFor(engine, c);
    expect(JSON.parse(executeTool(actx, 'advance_story', { quest_id: 'q_final_atar', step_id: 'atar' })).ok).toBe(true);
    expect(actx.progress.some((e) => e.text.includes('Misión cumplida: «Atar la Brasa»'))).toBe(true);
    expect(actx.progress.some((e) => e.public?.includes('Brasa de Vharn vuelve a dormir') && e.public.includes('Fen'))).toBe(true);
    expect(done(c)).toContain('q_final_atar');
    expect(c.coins).toBe(before + 2000);
    expect(engine.world.spot('sp_cr_brasa').state['atada']).toBe(true);
    // Los otros finales caducan.
    await engine.tick();
    expect(characterStory(c).expired).toEqual(expect.arrayContaining(['q_final_verdad', 'q_final_arder']));
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_arder', step_id: 'osric' }).error).toBeDefined();
    // La consecuencia del mundo se cuenta en público (el temblor junto al pozo).
    expect(engine.events.all().some((e) => e.action_type === 'story' && e.visibility === 'public' && /el agua del cubo sale fría/.test(e.observable ?? ''))).toBe(true);

    // El Diario cuenta las misiones; el máster ve la historia en su contexto.
    const j = journalOf(engine, c.id);
    expect(j.quests.completed.filter((q) => q.kind === 'story').map((q) => q.id)).toEqual(expect.arrayContaining(['q_agua', 'q_perro', 'q_noche', 'q_sotano', 'q_cadena', 'q_tobias', 'q_subida', 'q_final_atar']));
  });

  it('la amenaza escala si nadie interviene, y no si alguien lo evita', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Gil', 'rogue');
    time.advanceGame(19 * H);
    await engine.tick();
    const st = (engine.world.campaign as unknown as { story_state: { escalated: string[] } }).story_state;
    expect(st.escalated).toContain('esc_tos');
    expect(engine.world.location('loc_plaza').state['tos']).toBeDefined();
    expect(allRumors(engine.world).some((r) => r.id === 'rm_maldicion')).toBe(true);
    expect(engine.events.all().some((e) => e.action_type === 'story' && /escupe gris/.test(e.observable ?? ''))).toBe(true);
    // Con el perro rescatado antes de la noche, los lobos no bajan al corral.
    characterStory(c).done.push('q_perro');
    time.advanceGame(12 * H);
    await engine.tick();
    expect(st.escalated).toContain('!esc_lobos');
    expect(engine.world.location('loc_molino').state['corral']).toBeUndefined();
    // Al quinto día, la noche de la Brasa.
    time.advanceGame(5 * 24 * H);
    await engine.tick();
    expect(st.escalated).toEqual(expect.arrayContaining(['esc_tobias', 'esc_herreria', 'esc_brasa']));
    expect(engine.world.exits.get('ex_plaza_herreria')!.state.blocked_by).toBeDefined();
    expect(engine.world.npc('npc_ysolde').location.id).toBe('sp_cr_brasa');
  });

  it('el máster ve la historia del actor: misión, paso en curso y amenaza', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Hela', 'wizard');
    await engine.tick();
    const ctx = actionContext(engine, c, 'miro el agua del pozo');
    expect(ctx).toContain('## Historia escrita');
    expect(ctx).toContain('«Ceniza en el agua» [q_agua]');
    expect(ctx).toContain('Paso en curso [mirar]');
    expect(ctx).toContain('«La tos gris»');
    expect(storyOf(engine.world)!.quests.length).toBeGreaterThanOrEqual(9);
  });
});

describe('menú: «Brezal (demo)» carga la campaña escrita', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tavernus-brezal-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('una partida nueva sin mundo generado es Brezal, con el PJ en su situación', async () => {
    const games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: () => null, log: () => {} });
    const { game, character_id } = await games.create({ name: 'Brezal', mode: 'offline', character: { name: 'Iria', class_id: 'fighter' } });
    expect(game.campaign_id).toBe('brezal');
    expect(game.world ?? null).toBeNull();
    const engine = await games.open(game.slug);
    const c = engine.world.character(character_id!);
    expect(c.situation?.antagonist_npc_id).toBe('npc_osric');
    expect(engine.world.characterSpot(c)!.id).toBe('sp_he_banco');
    expect(engine.world.locations.size).toBe(BREZAL.locations.length);
    expect((await games.info(game)).world).toBeNull();
    // Reabierta desde disco, sigue siendo la misma partida.
    await games.closeAll();
    const again = await games.open(game.slug);
    expect(again.world.character(character_id!).situation?.why_here).toBe(c.situation!.why_here);
    await games.closeAll();
  });
});
