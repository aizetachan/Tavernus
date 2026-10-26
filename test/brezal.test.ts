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
import { characterStory, hideoutOf, questsOf, storyContext, storyOf } from '../src/engine/story.js';
import { journalOf } from '../src/engine/journal.js';
import { allRumors } from '../src/engine/rumors.js';
import { allHooks } from '../src/engine/hooks.js';
import { allScheduled, routineOf } from '../src/engine/schedule.js';
import { parseTrivial } from '../src/engine/fastpath.js';
import { parseCrossing } from '../src/engine/barrier.js';
import { generateMap, mapInputOf } from '../src/adapters/web/mapgen.js';
import { GameManager } from '../src/games/manager.js';
import type { Character, WorldSnapshot } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

/** El mundo nace un 22 de octubre a mediodía real; en el juego, a las 18:00 del día 0. */
const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const H = 3600;
/** Los diez lugares de la demo sellada (la taberna con su sótano). */
const PLAYABLE = ['loc_taberna', 'loc_sotano', 'loc_plaza', 'loc_herreria', 'loc_casona', 'loc_curandera', 'loc_molino', 'loc_corrales', 'loc_claro', 'loc_ruinas', 'loc_lindero'];

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

/** Habla con un NPC: va a donde está y abre la charla, como hace el máster al cerrar un turno con npc_id. */
async function talkTo(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, npcId: string): Promise<void> {
  const n = engine.world.npc(npcId);
  await walk(engine, time, c, n.location.id);
  n.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c) };
  await engine.tick();
}

/** Lleva el reloj del mundo hasta tantas horas después de su nacimiento (18:00 del día 0). */
async function until(engine: Engine, time: ReturnType<typeof fakeTime>, hours: number): Promise<void> {
  const target = engine.world.campaign.game_epoch_s + hours * H;
  if (engine.gameNow() < target) time.advanceGame(target - engine.gameNow());
  await engine.tick();
}

const stepOf = (engine: Engine, c: Character, questId: string) => questsOf(engine.world, c).find((v) => v.quest.id === questId);
const done = (c: Character) => characterStory(c).done;
const storyState = (engine: Engine) => (engine.world.campaign as unknown as { story_state: { escalated: string[] } }).story_state;
const publicSaid = (engine: Engine, re: RegExp) => engine.events.all().some((e) => e.visibility === 'public' && re.test(e.observable ?? ''));

// ---------------------------------------------------------------------------

describe('Brezal sellada: la campaña escrita', () => {
  it('valida con el mismo validador que los mundos generados y tiene la riqueza de uno', () => {
    const snap = authoredSeed('brezal', { now: new Date(EPOCH) });
    expect(validateSnapshot(snap)).toEqual([]);
    expect(isAuthoredCampaign('brezal')).toBe(true);
    expect(isAuthoredCampaign('demo')).toBe(false);
    const c = snap.campaign as WorldSnapshot['campaign'] & { schedule: unknown[]; rumors: { id: string }[]; hooks: unknown[]; encounters: Record<string, unknown[]> };
    // Diez lugares (la taberna con su sótano) en una sola zona; al otro lado del Cerco, un camino sellado.
    const playable = snap.locations.filter((l) => l.zone_id === 'zn_brezal');
    expect(playable.map((l) => l.id).sort()).toEqual([...PLAYABLE].sort());
    expect(snap.locations.filter((l) => l.zone_id !== 'zn_brezal').map((l) => l.id)).toEqual(['loc_valcruz']);
    for (const cut of ['loc_cuesta', 'loc_cripta']) expect(snap.locations.some((l) => l.id === cut)).toBe(false);
    const cerco = snap.exits.find((e) => e.id === 'ex_lindero_cerco')!;
    expect(cerco.state.blocked_by).toBe('El Cerco de Ceniza');
    expect(cerco.state['rebound']).toMatchObject({ hours: 1 });
    // Los ids de siempre: el Soto y el Granero conservan los del claro y las ruinas; la madriguera, el de la lobera.
    expect(snap.locations.find((l) => l.id === 'loc_claro')!.name).toBe('El Soto');
    expect(snap.locations.find((l) => l.id === 'loc_ruinas')!.name).toBe('El Granero Quemado');
    expect(snap.spots.find((s) => s.id === 'sp_cs_cueva')!.location_id).toBe('loc_claro');
    expect(snap.spots.find((s) => s.id === 'sp_cs_mojon')!.location_id).toBe('loc_lindero');
    const people = snap.npcs.filter((n) => n.attitude.default !== 'hostile' && n.stats?.attack_name !== 'mordisco' && n.role !== 'perro');
    expect(people.length).toBe(11);
    expect(people.some((n) => n.id === 'npc_ursula' && n.location.id === 'sp_co_gallinero')).toBe(true);
    for (const n of people) {
      expect(n.secret, n.id).not.toBe('');
      expect(n.stats, n.id).not.toBeNull();
      expect((n as typeof n & { routine?: unknown }).routine, `${n.id} sin horario`).toBeDefined();
    }
    expect(c.bible!.length).toBeLessThanOrEqual(10);
    expect(c.bible!.some((b) => b.includes('Guarda de Vharn') && b.includes('tres semanas'))).toBe(true);
    expect(c.bible!.some((b) => b.includes('tres anclajes') && b.includes('minas de plata'))).toBe(true);
    expect(c.laws!.length).toBeGreaterThanOrEqual(3);
    // Costumbres del pueblo (docs/BREZAL.md): van al system prompt.
    expect(c.customs!.some((x) => x.includes('duerme, viejo'))).toBe(true);
    expect(c.customs!.some((x) => x.includes('prestar la lumbre'))).toBe(true);
    expect(c.situations).toHaveLength(5);
    expect(c.situations!.map((s) => s.situation.clock_days)).toEqual([3, 3, 3, 3, 3]);
    expect(c.schedule.length).toBeGreaterThanOrEqual(5);
    // Lo que dice cada vecino del Cerco: nueve rumores de partida.
    expect(c.rumors.filter((r) => r.id.startsWith('rm_cerco_'))).toHaveLength(9);
    expect(c.hooks.length).toBeGreaterThan(0);
    expect(Object.keys(c.encounters)).toEqual(['town']);
    const story = (snap.campaign as unknown as { story: { quests: { id: string; act: number; exclusive?: string }[]; escalation: { id: string; after_hours: number }[] } }).story;
    expect(new Set(story.quests.map((q) => q.act))).toEqual(new Set([1, 2, 3]));
    expect(story.quests.filter((q) => q.exclusive === 'final').map((q) => q.id)).toEqual(['q_final_templar', 'q_final_verdad', 'q_final_arder']);
    // La amenaza en tres días; el epílogo, al amanecer del día 6.
    expect(Object.fromEntries(story.escalation.map((e) => [e.id, e.after_hours]))).toMatchObject({ esc_tos: 10, esc_lobos: 20, esc_tobias: 34, esc_herreria: 54, esc_brasa: 72, esc_epilogo: 108 });
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
    snap.exits = snap.exits.filter((e) => e.id !== 'ex_claro_ruinas');
    const story = (snap.campaign as unknown as { story: { quests: { id: string; steps: { done_when: unknown }[]; on_complete: unknown[] }[] } }).story;
    story.quests[0]!.steps[0]!.done_when = { kind: 'clue', clue_id: 'clue_nada' };
    story.quests.find((q) => q.id === 'q_final_verdad')!.on_complete.push({ kind: 'npc_status', npc_id: 'npc_osric', status: 'missing', hideout_spot_id: 'sp_ningun_sitio' });
    const errs = validateSnapshot(snap);
    expect(errs.some((e) => e.includes('npc_doro'))).toBe(true);
    expect(errs.some((e) => e.includes('loc_ruinas') && e.includes('no se llega'))).toBe(true);
    expect(errs.some((e) => e.includes('clue_nada'))).toBe(true);
    expect(errs.some((e) => e.includes('sp_ningun_sitio'))).toBe(true);
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

  it('las situaciones iniciales se reparten por clase, traen su deuda, sus objetos y vencen a la vez, a los tres días', async () => {
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
    // Las tres vencen la noche de la Brasa: 72 h después de las 18:00 del primer día.
    for (const c of [maga, guerrero, picara]) expect(c.situation!.deadline_game_s).toBe(engine.world.campaign.game_epoch_s + 72 * H);
    // Las situaciones de la campaña escrita no se gastan: la clériga recibe la de los letrados.
    expect(otra.situation!.why_here).toBe(maga.situation!.why_here);
    expect(engine.world.campaign.situations).toHaveLength(5);
    // El reloj del mundo nace a las 18:00 y la misa del pozo es a las 20:00.
    expect(engine.clock.format(engine.gameNow())).toMatch(/18:00$/);
    expect(picara.backstory).toContain('Garrán');
  });

  it('los lugares se nombran sin NPC dentro: «salgo hacia…» va por el atajo sin IA; el Cerco no', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Lia', 'wizard'); // empieza en el pozo
    const go = (text: string) => parseTrivial(engine.world, c, text);
    expect(go('salgo hacia Casa de las hierbas')).toMatchObject({ kind: 'move', spot_id: 'sp_cu_puerta', exit: true });
    expect(go('voy a la herrería')).toMatchObject({ kind: 'move', spot_id: 'sp_he_puerta', exit: true });
    expect(go('voy a la casona')).toMatchObject({ kind: 'move', spot_id: 'sp_ca_puerta', exit: true });
    expect(go('voy al molino')).toMatchObject({ kind: 'move', spot_id: 'sp_mo_puerta', exit: true });
    expect(go('salgo hacia Los Corrales')).toMatchObject({ kind: 'move', spot_id: 'sp_co_cancela', exit: true });
    expect(go('salgo hacia El Soto')).toMatchObject({ kind: 'move', spot_id: 'sp_cl_sendero', exit: true });
    expect(go('salgo hacia El Lindero')).toMatchObject({ kind: 'move', spot_id: 'sp_li_camino', exit: true });
    expect(go('cojo el agua del pozo')).toMatchObject({ kind: 'take', instance_id: 'ii_agua_pozo' });
    c.location = { type: 'spot', id: 'sp_cl_roble' };
    expect(go('salgo hacia El Granero Quemado')).toMatchObject({ kind: 'move', spot_id: 'sp_ru_puerta', exit: true });
    // Una salida bloqueada nunca es trivial: el Cerco lo resuelve barrier.ts.
    c.location = { type: 'spot', id: 'sp_li_barricada' };
    expect(go('salgo hacia Camino de Valcruz')).toBeNull();
  });

  it('un personaje recorre a pie los diez lugares; al otro lado del Cerco no se llega', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Erro', 'rogue');
    c.abilities.str = 18; // las monedas pesan (50 por libra): que pueda con todo lo que va a llevar
    // La trampilla está oculta y el pasadizo del Granero cerrado: se descubre una y se lleva la llave del otro.
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_tab_trampilla' }).error).toBeUndefined();
    engine.world.itemInstances.set('ii_test_llave', { id: 'ii_test_llave', item_id: 'it_llave_vharn', quantity: 1, location: { type: 'character', id: c.id, slot: { kind: 'pocket' } }, state: {} });
    const route = ['sp_so_cajas', 'sp_tab_puerta', 'sp_pl_pozo', 'sp_he_fragua', 'sp_ca_torre', 'sp_cu_caldero', 'sp_mo_tejado', 'sp_co_gallinero', 'sp_cl_roble', 'sp_cs_cueva', 'sp_ru_cripta', 'sp_ru_patio', 'sp_li_barricada', 'sp_cs_mojon', 'sp_pl_tablon'];
    for (const s of route) await walk(engine, time, c, s);
    const visited = [...engine.world.locations.values()].filter((l) => l.discovery[c.id] === 'visited').map((l) => l.id);
    expect(visited.sort()).toEqual([...PLAYABLE].sort());
    // Desde la plaza, el camino de Valcruz no tiene ruta: el Cerco es una pared.
    expect(tool(engine, c, 'move_to', { character_id: c.id, target_spot_id: 'sp_va_camino', pace: 'walk' }).error).toBe('no_route');
  });

  it('el acto I, el acto II y el final «Templar el ascua» se completan por tools, en orden', async () => {
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
    // Entrar en casa de Ilse con el agua no basta: el paso se da al dársela, y ahí habla ella.
    await walk(engine, time, c, 'sp_cu_hierbas');
    expect(stepOf(engine, c, 'q_agua')!.current!.id).toBe('ilse');
    expect(c.clues).not.toContain('clue_ilse');
    await talkTo(engine, time, c, 'npc_ilse');
    const water = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_agua_pozo')!;
    expect(tool(engine, c, 'transfer_item', { instance_id: water.id, to_type: 'npc', to_id: 'npc_ilse', slot: null, equip_slot: null, quantity: null }).error).toBeUndefined();
    await engine.tick();
    expect(done(c)).toContain('q_agua');
    expect(c.clues).toContain('clue_ilse');
    expect(characterStory(c).open).toContain('q_cadena'); // se abre el acto II de Ilse: se la pide ella, en la charla
    expect(characterStory(c).origins!['q_cadena']).toMatchObject({ kind: 'giver', text: 'Te lo pide Ilse' });
    expect(characterStory(c).origins!['q_agua']).toMatchObject({ kind: 'heard' });

    // --- Acto I: Ceniza se ha perdido (la madriguera al pie del roble del Soto) ---
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
    expect(characterStory(c).open).toContain('q_subida'); // de oídas
    expect(characterStory(c).open).not.toContain('q_sotano'); // la pide Brenna: hasta que no hable con ella, no
    await talkTo(engine, time, c, 'npc_brenna');
    expect(characterStory(c).open).toContain('q_sotano');

    // --- Acto I: Lo que vio Doro (la pista y la vigilia de las 23:00 en el arroyo del Soto) ---
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
    expect(characterStory(c).open).not.toContain('q_tobias');
    await talkTo(engine, time, c, 'npc_mateo');
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

    // --- Acto II: El Granero Quemado (la torre del reloj sustituye al mirador) ---
    await walk(engine, time, c, 'sp_ca_torre');
    expect(stepOf(engine, c, 'q_subida')!.current!.id).toBe('ruinas');
    await walk(engine, time, c, 'sp_ru_patio');
    expect(stepOf(engine, c, 'q_subida')!.current!.id).toBe('ysolde');
    await talkTo(engine, time, c, 'npc_ysolde');
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_ysolde' }).ok).toBe(true);
    await engine.tick();
    expect(done(c)).toContain('q_subida');

    // --- Acto III: cada final lo abre quien lo da, al hablar con el PJ; templar el ascua ---
    expect(characterStory(c).open).toContain('q_final_arder'); // Ysolde, que está delante
    expect(characterStory(c).open).not.toContain('q_final_templar');
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('Pendiente de que se la pidan: «Templar el ascua»');
    await talkTo(engine, time, c, 'npc_ilse');
    await talkTo(engine, time, c, 'npc_brenna');
    expect(characterStory(c).open).toEqual(expect.arrayContaining(['q_final_templar', 'q_final_verdad', 'q_final_arder']));
    // Con tres pistas y reputación, el logro da la llave de los Vharn, que abre el pasadizo del altar.
    expect(c.achievements.some((a) => a.id === 'ach_ceniza')).toBe(true);
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === 'it_llave_vharn')).toBe(true);
    await walk(engine, time, c, 'sp_ru_cripta');
    expect(stepOf(engine, c, 'q_final_templar')!.current!.id).toBe('ascua');
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_templar', step_id: 'ascua' }).ok).toBe(true);
    expect(engine.world.spot('sp_pl_pozo').state['ascua']).toBe(true);
    expect(stepOf(engine, c, 'q_final_templar')!.current!.id).toBe('pozo');
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(stepOf(engine, c, 'q_final_templar')!.current!.id).toBe('templar');
    const before = c.coins;
    const rep = c.reputation['fac_brezal'] ?? 0;
    // Como en una acción del máster: lo que devuelve el tool va al progreso de la acción, y el final, en público.
    const actx = ctxFor(engine, c);
    expect(JSON.parse(executeTool(actx, 'advance_story', { quest_id: 'q_final_templar', step_id: 'templar' })).ok).toBe(true);
    expect(actx.progress.some((e) => e.text.includes('Misión cumplida: «Templar el ascua»'))).toBe(true);
    expect(actx.progress.some((e) => e.public?.includes('ascua de Ysolde se apagó') && e.public.includes('Fen'))).toBe(true);
    expect(done(c)).toContain('q_final_templar');
    expect(c.coins).toBe(before + 2000);
    expect(c.reputation['fac_brezal']).toBe(rep + 3);
    expect(engine.world.spot('sp_pl_pozo').state['templado']).toBe(true);
    expect(engine.world.npc('npc_ysolde').location.id).toBe('sp_ru_capilla');
    // Los otros finales caducan.
    await engine.tick();
    expect(characterStory(c).expired).toEqual(expect.arrayContaining(['q_final_verdad', 'q_final_arder']));
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_arder', step_id: 'osric' }).error).toBeDefined();
    // La consecuencia del mundo se cuenta en público (el vapor del pozo).
    expect(engine.events.all().some((e) => e.action_type === 'story' && e.visibility === 'public' && /el agua del cubo sale fría/.test(e.observable ?? ''))).toBe(true);
    // Al amanecer del día 6: la niebla se retira un paso, pero Brezal sigue sellada.
    await until(engine, time, 108);
    expect(storyState(engine).escalated).toEqual(expect.arrayContaining(['esc_epilogo_templar', '!esc_epilogo_verdad', '!esc_epilogo_arder', 'esc_epilogo', '!esc_brasa']));
    expect(engine.world.spot('sp_li_niebla').state['retirada']).toBe('un paso');
    expect(publicSaid(engine, /Cambia\. Pero sigue cerrada.*Brezal sigue sellada\. La Guarda de Vharn tiene más nudos\./)).toBe(true);
    expect(engine.world.exits.get('ex_lindero_cerco')!.state.blocked_by).toBe('El Cerco de Ceniza');

    // El Diario cuenta las misiones; el máster ve la historia en su contexto.
    const j = journalOf(engine, c.id);
    expect(j.quests.completed.filter((q) => q.kind === 'story').map((q) => q.id)).toEqual(expect.arrayContaining(['q_agua', 'q_perro', 'q_noche', 'q_sotano', 'q_cadena', 'q_tobias', 'q_subida', 'q_final_templar']));
  });

  it('«La verdad en el pozo»: Osric no puede huir y se esconde en el pueblo, vivo, hasta que alguien da con él', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Gala', 'rogue');
    characterStory(c).done.push('q_sotano');
    c.clues.push('clue_ysolde');
    await engine.tick();
    expect(characterStory(c).open).not.toContain('q_final_verdad');
    await talkTo(engine, time, c, 'npc_brenna');
    expect(characterStory(c).open).toContain('q_final_verdad');
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_verdad', step_id: 'brenna' }).ok).toBe(true);
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_verdad', step_id: 'ysolde' }).ok).toBe(true);
    expect(engine.world.npc('npc_ysolde').location.id).toBe('sp_pl_pozo');
    await walk(engine, time, c, 'sp_pl_pozo');
    // La misa de las 20:00 trae a Brenna al pozo.
    await until(engine, time, 2 + 5 / 60);
    expect(done(c)).toContain('q_final_verdad');
    expect(publicSaid(engine, /Brenna cuenta en voz alta/)).toBe(true);

    const osric = engine.world.npc('npc_osric');
    expect(osric.status).toBe('missing');
    expect(osric.location.id).toBe('sp_ca_bodega');
    expect(hideoutOf(osric)).toBe('sp_ca_bodega');
    expect(routineOf(osric)).toBeNull();
    expect(engine.world.npc('npc_garran').attitude.default).toBe('neutral');
    // En la casona no se le ve ni se le oye, y el horario no lo mueve.
    await walk(engine, time, c, 'sp_ca_despacho');
    const here = JSON.parse(executeTool(ctxFor(engine, c), 'who_is_here', {})) as { id: string }[];
    expect(here.some((x) => x.id === 'npc_osric')).toBe(false);
    await until(engine, time, 16); // las 10:00 del día siguiente: su franja de despacho
    expect(osric.location.id).toBe('sp_ca_bodega');
    expect(osric.status).toBe('missing');
    // Quien da con la bodega tapiada, da con él.
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_ca_bodega' }).error).toBeUndefined();
    await walk(engine, time, c, 'sp_ca_bodega');
    expect(osric.status).toBe('alive');
    expect(hideoutOf(osric)).toBeNull();
    expect(c.knows).toContain('npc_osric');
    expect(engine.events.all().some((e) => e.actor_id === c.id && /Das con Osric Malvez, escondido en la bodega tapiada/.test(e.narration_private ?? ''))).toBe(true);
    const nowHere = JSON.parse(executeTool(ctxFor(engine, c), 'who_is_here', {})) as { id: string }[];
    expect(nowHere.some((x) => x.id === 'npc_osric')).toBe(true);
    // Epílogo: una voz al otro lado de la niebla.
    await until(engine, time, 108);
    expect(storyState(engine).escalated).toEqual(expect.arrayContaining(['esc_epilogo_verdad', '!esc_epilogo_templar', 'esc_epilogo']));
    expect(engine.world.spot('sp_li_niebla').state['voz']).toBeDefined();
  });

  it('«Que arda Vharn»: el ascua cae en la plaza, la casona arde y el humo no sale del valle', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Ruy', 'fighter');
    c.clues.push('clue_ysolde');
    await engine.tick();
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_arder', step_id: 'osric' }).error).toMatch(/no está abierta/);
    engine.world.npc('npc_ysolde').location = { type: 'spot', id: engine.world.characterSpot(c)!.id }; // baja a verle
    await talkTo(engine, time, c, 'npc_ysolde');
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_arder', step_id: 'osric' }).ok).toBe(true);
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_final_arder', step_id: 'soltar' }).ok).toBe(true);
    expect(done(c)).toContain('q_final_arder');
    expect(engine.world.npc('npc_osric').status).toBe('dead');
    expect(engine.world.npc('npc_brenna').attitude.default).toBe('hostile');
    expect(engine.world.location('loc_casona').state['incendio']).toBeDefined();
    expect(String(engine.world.location('loc_plaza').state['cielo'])).toMatch(/no sale del valle/);
    await engine.tick();
    expect(characterStory(c).expired).toEqual(expect.arrayContaining(['q_final_verdad', 'q_final_templar']));
    await until(engine, time, 108);
    expect(storyState(engine).escalated).toEqual(expect.arrayContaining(['esc_epilogo_arder', 'esc_epilogo']));
    expect(engine.world.spot('sp_li_niebla').state['color']).toBe('roja');
  });

  it('la amenaza escala en tres días si nadie interviene, y no si alguien lo evita', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Gil', 'rogue');
    const st = storyState(engine);
    await until(engine, time, 9.5);
    expect(st.escalated).not.toContain('esc_tos');
    await until(engine, time, 10.5);
    expect(st.escalated).toContain('esc_tos');
    expect(engine.world.location('loc_plaza').state['tos']).toBeDefined();
    expect(allRumors(engine.world).some((r) => r.id === 'rm_maldicion')).toBe(true);
    expect(engine.events.all().some((e) => e.action_type === 'story' && /escupe gris/.test(e.observable ?? ''))).toBe(true);
    // Con el perro rescatado antes, los lobos no bajan a los Corrales.
    characterStory(c).done.push('q_perro');
    await until(engine, time, 20.5);
    expect(st.escalated).toContain('!esc_lobos');
    expect(engine.world.location('loc_corrales').state['gallinero']).toBeUndefined();
    await until(engine, time, 33.5);
    expect(st.escalated).not.toContain('esc_tobias');
    await until(engine, time, 34.5);
    expect(st.escalated).toContain('esc_tobias');
    expect(engine.world.npc('npc_tobias').location.id).toBe('sp_ru_patio');
    await until(engine, time, 54.5);
    expect(st.escalated).toContain('esc_herreria');
    expect(engine.world.exits.get('ex_plaza_herreria')!.state.blocked_by).toBeDefined();
    await until(engine, time, 71.5);
    expect(st.escalated).not.toContain('esc_brasa');
    await until(engine, time, 72.5);
    expect(st.escalated).toContain('esc_brasa');
    expect(engine.world.npc('npc_ysolde').location.id).toBe('sp_pl_pozo');
    expect(String(engine.world.location('loc_plaza').state['cielo'])).toMatch(/no sale del valle/);
    // Sin final, el epílogo común igual: la niebla sigue.
    await until(engine, time, 108.5);
    expect(st.escalated).toEqual(expect.arrayContaining(['esc_epilogo', '!esc_epilogo_templar', '!esc_epilogo_verdad', '!esc_epilogo_arder']));
    expect(publicSaid(engine, /Brezal sigue sellada/)).toBe(true);
  });

  it('sin nadie que lo evite, los lobos atacan los Corrales de Úrsula', async () => {
    const { engine, time } = await boot();
    await newPc(engine, 'Ivo', 'rogue');
    await until(engine, time, 20.5);
    expect(storyState(engine).escalated).toContain('esc_lobos');
    expect(engine.world.location('loc_corrales').state['gallinero']).toBeDefined();
    expect(engine.world.npc('npc_lobo').location.id).toBe('sp_co_redil');
  });

  it('chocar con la niebla: quien intenta cruzar el Cerco sale por donde entró, una hora después, sin máster', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Nia', 'rogue');
    // Desde la plaza, la niebla queda lejos: no es un intento de cruzarla.
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(parseCrossing(engine.world, c, 'cruzo la niebla')).toBeNull();
    await walk(engine, time, c, 'sp_li_barricada');
    expect(parseCrossing(engine.world, c, 'me meto en la niebla')).toBe('ex_lindero_cerco');
    expect(parseCrossing(engine.world, c, 'salgo hacia Camino de Valcruz')).toBe('ex_lindero_cerco');
    expect(parseCrossing(engine.world, c, 'salgo del valle')).toBe('ex_lindero_cerco');
    // Acercarse al borde no es cruzar.
    expect(parseCrossing(engine.world, c, 'voy a la niebla')).toBeNull();
    expect(parseCrossing(engine.world, c, 'voy al borde de la niebla')).toBeNull();
    // El máster ve el Cerco como salida bloqueada y sabe que el motor lo resuelve.
    expect(actionContext(engine, c, 'miro la niebla')).toContain('bloqueada (El Cerco de Ceniza): no se cruza');

    const t0 = engine.nowFor(c);
    const r = await engine.act(c.id, 'Cruzo la niebla');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('con ceniza en el pelo');
    expect(engine.world.characterSpot(c)!.id).toBe('sp_li_niebla');
    expect(engine.nowFor(c) - t0).toBe(H);
    const ev = engine.events.all().find((e) => e.action_type === 'rebound')!;
    expect(ev.tags).toEqual(expect.arrayContaining(['deterministic', 'movement']));
    expect(ev.observable).toContain('Nia se mete en la niebla');
    // Por el tool del máster, lo mismo: otra hora y de vuelta al borde.
    const m = tool(engine, c, 'move_to', { character_id: c.id, target_spot_id: 'sp_va_camino', pace: 'walk' });
    expect(m).toMatchObject({ ok: true, rebound: true, spot: 'el borde de la niebla' });
    expect(engine.nowFor(c) - t0).toBe(2 * H);
    expect(engine.world.characterSpot(c)!.location_id).toBe('loc_lindero');
    expect(engine.world.locations.get('loc_valcruz')!.discovery[c.id]).not.toBe('visited');
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
