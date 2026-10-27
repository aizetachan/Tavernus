/**
 * Misiones progresivas al estilo de Baldur's Gate 3 (story.ts): nada flota sobre
 * nadie; una misión entra en el Diario cuando el PJ se entera en escena (se la
 * piden, la oye), aceptar es implícito y se puede decir que no. La principal es
 * un problema con varias pistas que se abren al mencionarlas alguien. Los plazos
 * van por descansos e hitos. Hay nivel mínimo y la recompensa la da quien la
 * encargó. Sale de la partida del 2026-10-27 («La noche del Brezal», Leodhin,
 * mago, solo): Obsidian, «Revisión partida 2026-10-27» (§1, fallos 6, 10 y 11) y
 * «Modelo Baldur's Gate 3» (§1 y §4). Los casos llevan el seq del evento real.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { characterStory, questLeads, questStatus, questsOf, storyContext, storyOf, validateStory, type CharacterStory, type Story } from '../src/engine/story.js';
import { journalOf } from '../src/engine/journal.js';
import { allHooks } from '../src/engine/hooks.js';
import { noticeOf } from '../src/adapters/web/journal.js';
import { boardState } from '../src/adapters/web/board.js';
import { levelUp } from '../src/engine/levels.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import type { QuestChange } from '../src/engine/progress.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const H = 3600;

async function boot(): Promise<{ engine: Engine; time: ReturnType<typeof fakeTime> }> {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  return { engine, time };
}

/** Clase → situación: el mago llega por la carta (empieza junto al pozo, con Ilse); el pícaro, por la deuda (en el Jabalí). */
async function newPc(engine: Engine, name: string, class_id = 'rogue'): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  r.character.abilities.str = 18;
  return r.character;
}

const ctxFor = (engine: Engine, c: Character): ToolContext => ({ engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] });
type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string; tell_now?: string; story?: { changes: string[]; tell_now?: string } };
function tool(engine: Engine, c: Character, name: string, input: Record<string, unknown>, ctx = ctxFor(engine, c)): ToolOut {
  return JSON.parse(executeTool(ctx, name, input)) as ToolOut;
}

async function walk(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, spotId: string): Promise<void> {
  if (engine.world.characterSpot(c)?.id === spotId) return;
  const r = tool(engine, c, 'move_to', { character_id: c.id, target_spot_id: spotId, pace: 'walk' });
  expect(r.error, `move_to ${spotId}: ${JSON.stringify(r)}`).toBeUndefined();
  if (c.transit) time.advanceGame(c.transit.arrives_game_s - engine.gameNow() + 2);
  await engine.tick();
  expect(engine.world.characterSpot(c)?.id).toBe(spotId);
}

/** Va a donde está y abre la charla, como hace el máster al cerrar un turno con npc_id. */
async function talkTo(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, npcId: string): Promise<void> {
  const n = engine.world.npc(npcId);
  await walk(engine, time, c, n.location.id);
  n.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c) };
  await engine.tick();
}
/** Se acaba la charla (se despiden o el PJ se va). */
const bye = (engine: Engine, npcId: string) => { engine.world.npc(npcId).talking_to = null; };

const give = (engine: Engine, c: Character, itemId: string, npcId: string, ctx?: ToolContext) => {
  const inst = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === itemId)!;
  return tool(engine, c, 'transfer_item', { instance_id: inst.id, to_type: 'npc', to_id: npcId, slot: null, equip_slot: null, quantity: null }, ctx);
};
/** Un descanso largo, como lo apunta rest.ts. */
const sleep = async (engine: Engine, time: ReturnType<typeof fakeTime>, c: Character) => {
  time.advanceGame(8 * H);
  (c as Character & { rest?: { last_long_rest_game_s: number | null } }).rest = { ...((c as unknown as { rest?: object }).rest ?? {}), last_long_rest_game_s: engine.gameNow() } as never;
  await engine.tick();
};

const questEvents = (engine: Engine, c: Character): GameEvent[] => engine.events.all().filter((e) => e.actor_id === c.id && /^progress_/.test(e.action_type) && e.payload['quest']);
const lastQuest = (engine: Engine, c: Character, id: string) => questEvents(engine, c).filter((e) => (e.payload['quest'] as QuestChange).id === id).at(-1)!;
const journalQuest = (engine: Engine, c: Character, id: string) => { const j = journalOf(engine, c.id); return [...j.quests.active, ...j.quests.completed].find((q) => q.id === id); };
const quest = (engine: Engine, id: string) => storyOf(engine.world)!.quests.find((q) => q.id === id)!;
const status = (engine: Engine, c: Character, id: string) => questStatus(engine.world, c, quest(engine, id));

describe('una misión entra en el Diario al enterarse en escena', () => {
  it('«La cena del portón»: lo oído es una pista hacia Brenna; ella la pide al hablar (entra activa), se da en mano y cobra quien la encargó', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Nia');
    // Antes de oír nada, nada flota sobre nadie: tener una misión disponible no se ve.
    expect(questLeads(engine.world, c).size).toBe(0);
    await engine.tick();
    expect(characterStory(c).open).toEqual(['q_main_deuda']);
    expect(status(engine, c, 'q_cena_doro')).toBe('available');
    // Lo que se oye entra en el Diario como una pista que lleva a Brenna, sin contar de qué va.
    const rumor = lastQuest(engine, c, 'q_cena_doro');
    expect(noticeOf(rumor)).toMatchObject({ text: 'Hemos oído algo: En la barra dicen que Brenna busca a alguien de fiar para un recado', quest: { event: 'rumor' } });
    expect(rumor.narration_private).not.toMatch(/Doro|cena/);
    expect(journalQuest(engine, c, 'lead:q_cena_doro')).toMatchObject({ kind: 'lead', title: 'Buscar a Brenna', text: 'Hemos oído en la barra que Brenna busca a alguien de fiar para un recado.', steps: [{ text: 'Hablar con Brenna', done: false }] });
    // El punto discreto: una pista activa lleva a Brenna.
    expect(boardState(engine, c.id).presences.find((p) => p.id === 'npc_brenna')?.lead).toBe(true);

    // Al hablar con ella, se la pide: entra en el Diario, activa, sin mostrador de aceptar.
    await talkTo(engine, time, c, 'npc_brenna');
    expect(status(engine, c, 'q_cena_doro')).toBe('active');
    expect(status(engine, c, 'q_perro')).toBe('available'); // una por charla
    expect(noticeOf(lastQuest(engine, c, 'q_cena_doro'))).toMatchObject({ text: 'Nueva misión · «La cena del portón»', quest: { event: 'open', why: 'Brenna nos lo pidió', declinable: true } });
    expect(characterStory(c).origins!['q_cena_doro']).toMatchObject({ kind: 'giver', text: 'Brenna nos lo pidió', location_id: 'loc_taberna' });
    expect(journalQuest(engine, c, 'q_cena_doro')).toMatchObject({ status: 'active', declinable: true, level: 1, difficulty: 'normal', giver: 'Brenna' });
    expect(journalQuest(engine, c, 'lead:q_cena_doro')).toBeUndefined();
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('Brenna acaba de pedirle «La cena del portón» [q_cena_doro] (ya está en su Diario)');
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === 'it_racion')).toBe(true);
    bye(engine, 'npc_brenna');

    // Estar delante de Doro no basta: el paso se da al dársela.
    await walk(engine, time, c, engine.world.npc('npc_doro').location.id);
    expect(status(engine, c, 'q_cena_doro')).toBe('active');
    expect(questLeads(engine.world, c).has('npc_doro')).toBe(true); // el paso en curso lleva a Doro
    const gctx = ctxFor(engine, c);
    const r = give(engine, c, 'it_racion', 'npc_doro', gctx);
    expect(r.story!.tell_now).toMatch(/Doro destapa el plato/);
    expect(c.knows).toContain('npc_doro');
    expect(status(engine, c, 'q_cena_doro')).toBe('ready');
    expect(journalQuest(engine, c, 'q_cena_doro')!.declinable).toBeUndefined(); // empezada: ya no se puede decir que no
    expect(questLeads(engine.world, c).has('npc_brenna')).toBe(true);
    const ready = gctx.progress.find((e) => e.quest?.event === 'ready')!;
    expect(noticeOf({ action_type: 'progress_story', narration_private: ready.text, observable: null, payload: { quest: ready.quest } })).toMatchObject({ text: 'Lista para entregar · «La cena del portón»', quest: { why: 'Tenemos que volver con Brenna' } });

    // La recompensa la da Brenna, al hablar con ella. El Diario, en primera persona del grupo.
    const coins = c.coins, xp = c.xp;
    await talkTo(engine, time, c, 'npc_brenna');
    expect(status(engine, c, 'q_cena_doro')).toBe('done');
    expect(c.coins).toBe(coins + 20);
    expect(c.xp).toBe(xp + 75);
    const done = journalQuest(engine, c, 'q_cena_doro')!;
    expect(done.history.map((h) => [h.kind, h.text])).toEqual([
      ['added', 'Brenna nos lo pidió'],
      ['step', '✔ Darle la cena al guardia del portón'],
      ['ready', 'Ya lo tenemos todo'],
      ['completed', 'Lo hemos conseguido'],
    ]);
  });

  it('decir que no: el Diario lo apunta, quien la pidió no insiste y el jugador puede cambiar de idea; empezada, ya no', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Oto');
    await talkTo(engine, time, c, 'npc_brenna');
    expect(status(engine, c, 'q_cena_doro')).toBe('active');
    // Desde la web (el aviso o el Diario): sin máster.
    expect(await engine.answerQuest(c.id, 'q_cena_doro', false)).toMatchObject({ ok: true });
    expect(status(engine, c, 'q_cena_doro')).toBe('declined');
    const q = journalQuest(engine, c, 'q_cena_doro')!;
    expect(q.status).toBe('declined');
    expect(q.history.at(-1)).toMatchObject({ kind: 'declined', text: 'No quisimos ayudar a Brenna' });
    // En otra charla no la vuelve a pedir (saca la siguiente); si el jugador cambia de idea, el máster la abre.
    bye(engine, 'npc_brenna');
    time.advanceGame(10 * 60);
    await talkTo(engine, time, c, 'npc_brenna');
    expect(status(engine, c, 'q_cena_doro')).toBe('declined');
    expect(status(engine, c, 'q_perro')).toBe('active');
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('El actor le dijo que no a Brenna con «La cena del portón»');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_cena_doro', action: 'ask' }).error).toMatch(/ya dijo que no/);
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_cena_doro', action: 'accept' }).ok).toBe(true);
    expect(status(engine, c, 'q_cena_doro')).toBe('active');
    // Empezada, no se puede decir que no.
    characterStory(c).steps.push('q_perro/rastro');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_perro', action: 'decline' }).error).toMatch(/ya ha empezado/);
    // Sin quien la da delante, nadie pide nada.
    await walk(engine, time, c, 'sp_pl_pozo');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_agua', action: 'ask' }).error).toMatch(/la pide la curandera, que no está con el actor/);
    expect(tool(engine, c, 'advance_story', { quest_id: 'q_agua', step_id: 'mirar' }).error).toMatch(/no la tiene el actor/);
  });
});

describe('niveles: el acto II pide nivel 2 y su hilo del acto I; el acto III, nivel 3', () => {
  it('«La cadena de hierro frío» se bloquea por nivel aunque «El agua turbia» esté cumplida, y la dificultad sale con color', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Ivo');
    characterStory(c).done.push('q_agua');
    await talkTo(engine, time, c, 'npc_ilse');
    expect(c.level).toBe(1);
    expect(status(engine, c, 'q_cadena')).toBe('locked');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_cadena', action: 'ask' }).error).toMatch(/pide nivel 2 y el actor es de nivel 1/);
    expect(storyContext(engine.world, c, engine.gameNow())).toMatch(/Ilse aún no tiene nada más para el actor \(pide nivel 2/);
    // Sin el hilo del acto I, tampoco: aunque tenga nivel.
    const d = await newPc(engine, 'Ura');
    d.xp = 300; levelUp(d);
    expect(status(engine, d, 'q_cadena')).toBe('locked');

    c.xp = 300;
    await engine.tick(); // sube de nivel
    expect(c.level).toBe(2);
    expect(status(engine, c, 'q_cadena')).toBe('available');
    // En esta charla Ilse ya pidió un recado; en la siguiente, ella misma pide la cadena.
    bye(engine, 'npc_ilse');
    time.advanceGame(10 * 60);
    await talkTo(engine, time, c, 'npc_ilse');
    expect(journalQuest(engine, c, 'q_cadena')).toMatchObject({ status: 'active', level: 3, difficulty: 'hard' });
    // El acto III pide nivel 3.
    c.clues.push('clue_ysolde');
    expect(status(engine, c, 'q_final_arder')).toBe('locked');
    c.xp = 900; levelUp(c);
    expect(status(engine, c, 'q_final_arder')).toBe('available');
  });

  it('cada misión tiene nivel; el acto II pide nivel 2 y una misión del acto I; el acto III, nivel 3; los recados presentan a cada vecino', () => {
    const qs = (storyOf({ campaign: authoredSeed('brezal', { now: new Date(EPOCH) }).campaign } as never) ?? { quests: [] }).quests;
    expect(qs.length).toBeGreaterThan(15);
    for (const q of qs) {
      expect(q.level, q.id).toBeGreaterThanOrEqual(1);
      if (q.act === 2) { expect(q.min_level, q.id).toBe(2); expect(JSON.stringify(q.requires), q.id).toMatch(/"kind":"quest"/); }
      if (q.act === 3) expect(q.min_level, q.id).toBe(3);
      // Nada se abre por pisar un sitio: no hay misiones sin quien las pida, salvo la principal.
      if (!q.main_for) expect(q.giver_npc_id, q.id).toBeTruthy();
    }
    const intros = qs.filter((q) => q.act === 1 && q.level === 1 && !q.main_for && q.id !== 'q_agua');
    const met = new Set(intros.flatMap((q) => [q.giver_npc_id, ...q.steps.flatMap((s) => (s.on_done ?? []).filter((e) => e.kind === 'know_npc').map((e) => (e as { npc_id: string }).npc_id))]));
    for (const npc of ['npc_brenna', 'npc_doro', 'npc_ilse', 'npc_mateo', 'npc_hugo', 'npc_ursula', 'npc_hal']) expect(met, npc).toContain(npc);
  });
});

describe('la misión principal: un problema con varias pistas', () => {
  it('(seq 16–18) llegar a la plaza no abre «El agua turbia»; la carta se abre en pistas que aparecen al mencionarlas alguien y llevan al Granero', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Leodhin', 'wizard');
    await engine.tick();
    expect(characterStory(c).open).toEqual(['q_main_carta']);
    expect(status(engine, c, 'q_agua')).toBe('available');
    const main = journalOf(engine, c.id).quests.active[0]!;
    expect(main).toMatchObject({ kind: 'main', title: 'La carta de Vharn', pinned: true });
    // Ilse ha reaccionado al sello y está en la plaza: esas dos pistas; las demás, cuando alguien las mencione.
    expect(main.steps).toEqual([
      { text: 'Preguntar a Ilse por el sello de Vharn', done: false },
      { text: 'Mirar de cerca el agua del pozo', done: false },
    ]);

    // (seq 51–59) Ilse la pide al hablar; darle el agua: lo que dice ella va en la misma respuesta del máster.
    expect(tool(engine, c, 'transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: 1 }).error).toBeUndefined();
    await talkTo(engine, time, c, 'npc_ilse');
    expect(status(engine, c, 'q_agua')).toBe('active');
    const actx = ctxFor(engine, c);
    const r = give(engine, c, 'it_agua_pozo', 'npc_ilse', actx);
    expect(r.story!.tell_now).toMatch(/Es de la cripta\. La Brasa respira otra vez/);
    expect(actx.progress.some((e) => /Ilse huele el agua/.test(e.text))).toBe(false);
    await engine.tick();
    expect(engine.events.all().some((e) => /Ilse huele el agua/.test(e.narration_private ?? ''))).toBe(false);
    expect(characterStory(c).done).toContain('q_agua');
    // Ni se abre «La cadena de hierro frío» ni se dice que la pide Ilse: es de nivel 2.
    expect(status(engine, c, 'q_cadena')).toBe('locked');
    expect(Object.values(characterStory(c).origins ?? {}).map((o) => o.text)).not.toContain('Te lo pide Ilse');
    // Lo que contó Ilse abre otras pistas de la carta, y todas llevan al Granero.
    const steps = journalOf(engine, c.id).quests.active[0]!.steps;
    expect(steps).toEqual(expect.arrayContaining([
      { text: 'Preguntar a Ilse por el sello de Vharn', done: true },
      { text: 'Preguntar a la tabernera qué pasó en Vharn la noche del incendio', done: false },
      { text: 'Preguntar al herrero por la cadena de su maestro', done: false },
      { text: 'Ir al Granero Quemado y averiguar quién enciende las luces', done: false },
    ]));
    expect(steps.some((s) => /noche de la Brasa/.test(s.text))).toBe(false); // el final, cuando toque
    // Las pistas activas ponen un punto discreto en a quien llevan.
    expect([...questLeads(engine.world, c)]).toEqual(expect.arrayContaining(['npc_brenna', 'npc_hugo']));
    expect(journalOf(engine, c.id).quests.active[0]!.history.some((h) => h.text === 'Ilse nos contó qué es la Brasa: un fuego antiguo que los Vharn ataban en su cripta.')).toBe(true);
  });

  it('(seq 65–69) el logro da reputación y un anuncio cierto: ni la llave de Vharn ni la trampilla', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Leodhin', 'wizard');
    const ctx = ctxFor(engine, c);
    // Aquí se mira el logro, no lo que pide cada pista (eso, en confianza.test.ts).
    for (const cl of engine.world.campaign.clues) delete cl.sources;
    for (const id of ['clue_pozo', 'clue_ilse', 'clue_hugo']) expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: id }, ctx).ok).toBe(true);
    expect(c.achievements.map((a) => a.id)).toContain('ach_ceniza');
    expect(c.reputation['fac_brezal']).toBe(6 + 2);
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === 'it_llave_vharn')).toBe(false);
    expect(engine.world.spot('sp_tab_trampilla').discovered_by).not.toContain(c.id);
    const ach = ctx.progress.find((e) => e.kind === 'achievement')!;
    expect(ach.public).toBe('Se corre la voz por Brezal: Leodhin ha mirado la ceniza de frente.');
    expect(ach.text).toMatch(/\+2 de reputación en la aldea de Brezal/);
  });

  it('(seq 94) «Bajo el Jabalí» no se abre por descubrir la trampilla ni por hablar con Brenna: la pide ella tras el perro y en nivel 2, con la trampilla y la llave en su escena', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Leodhin', 'wizard');
    expect(tool(engine, c, 'discover_spot', { character_id: c.id, spot_id: 'sp_tab_trampilla' }).error).toBeUndefined();
    await talkTo(engine, time, c, 'npc_brenna');
    expect(status(engine, c, 'q_sotano')).toBe('locked');

    const d = await newPc(engine, 'Brin');
    characterStory(d).done.push('q_perro', 'q_cena_doro');
    d.xp = 450;
    await talkTo(engine, time, d, 'npc_brenna');
    expect(d.level).toBe(2);
    expect(status(engine, d, 'q_sotano')).toBe('active'); // se la pide ella, en la charla
    expect(engine.world.spot('sp_tab_trampilla').discovered_by).toContain(d.id);
    expect(allHooks(engine.world).some((h) => h.for_character_id === d.id && /aparta con el pie la alfombra/.test(h.what)) || engine.events.all().some((e) => /aparta con el pie la alfombra/.test(e.narration_private ?? ''))).toBe(true);
    characterStory(d).steps.push('q_sotano/bajar');
    engine.world.itemInstance('ii_libro_cuentas').location = { type: 'character', id: d.id, slot: { kind: 'pocket' } };
    bye(engine, 'npc_brenna');
    await engine.tick();
    expect(status(engine, d, 'q_sotano')).toBe('ready');
    await talkTo(engine, time, d, 'npc_brenna');
    expect(status(engine, d, 'q_sotano')).toBe('done');
    expect(engine.world.itemsCarriedBy(d.id).some((i) => i.item_id === 'it_llave_vharn')).toBe(true);
  });
});

describe('la partida del 2026-10-27: muertes, voz y nombres', () => {
  it('(fallo 11) Hugo muerto con «La cadena de hierro frío» abierta: cambia de camino y el Diario lo escribe; muerta Ilse, se pierde', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Leodhin', 'wizard');
    // El estado real de Leodhin al acabar la partida.
    const real = JSON.parse(readFileSync(new URL('./fixtures/partida-2026-10-27-leodhin.json', import.meta.url), 'utf-8')) as { character: Partial<Character> & { story: CharacterStory }; dead_npcs: string[] };
    Object.assign(c, { ...real.character, story: structuredClone(real.character.story) });
    for (const id of real.dead_npcs) engine.world.npc(id).status = 'dead';
    expect(characterStory(c).open).toContain('q_cadena');
    expect(characterStory(c).steps).toContain('q_cadena/hugo');
    await engine.tick();
    expect(status(engine, c, 'q_cadena')).toBe('active');
    expect(characterStory(c).rerouted).toEqual({ q_cadena: 'npc_hugo' });
    const why = 'Hugo murió antes de enseñarnos los eslabones, pero siguen escondidos en su herrería';
    expect(noticeOf(lastQuest(engine, c, 'q_cadena'))).toMatchObject({ text: 'La misión cambia · «La cadena de hierro frío»', quest: { event: 'changed', why } });
    const q = journalQuest(engine, c, 'q_cadena')!;
    // El Diario no usa nombres que el PJ no sabe: Leodhin no llegó a saber cómo se llamaba el herrero.
    expect(q.history.at(-1)).toMatchObject({ kind: 'changed', text: 'El herrero murió antes de enseñarnos los eslabones, pero siguen escondidos en su herrería' });
    expect(q.steps.map((s) => [s.text, s.done])).toEqual([
      ['Preguntar al herrero por la cadena de su maestro', true],
      ['Buscar los eslabones en la herrería', false],
      ['Volver con Ilse para entregarla', false],
    ]);
    expect(questsOf(engine.world, c).find((v) => v.quest.id === 'q_cadena')!.current!.id).toBe('buscar');
    // La carta entra para quien la tenía antes de esto, con las pistas que ya ha seguido.
    expect(characterStory(c).open).toContain('q_main_carta');
    expect(characterStory(c).steps).toEqual(expect.arrayContaining(['q_main_carta/sello', 'q_main_carta/pozo', 'q_main_carta/cadena']));
    // Muerta Ilse, ya no hay quien enseñe el rito: el Diario escribe la pérdida.
    engine.world.npc('npc_ilse').status = 'dead';
    await engine.tick();
    expect(status(engine, c, 'q_cadena')).toBe('failed');
    expect(journalQuest(engine, c, 'q_cadena')).toMatchObject({ status: 'failed' });
    expect(journalQuest(engine, c, 'q_cadena')!.history.at(-1)).toMatchObject({ kind: 'failed', text: 'Ilse murió, y con ella las palabras que templan el ascua' });
    expect(noticeOf(lastQuest(engine, c, 'q_cadena'))).toMatchObject({ text: 'Se perdió · «La cadena de hierro frío»' });
  });

  it('(fallo 6) lo que pasa en la escena lo cuenta el máster: con máster, un gancho para ese PJ; sin máster, un aviso', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Leodhin', 'wizard');
    engine.setPresence(c.id, true);
    const told: string[] = [];
    const m: MasterLike = {
      async resolve(_a, text) {
        told.push(text);
        return { ok: true as const, usage: {}, calls: [], context: '', model: 'falso', closed: { narration_private: 'Ilse escupe el agua.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
      },
    };
    engine.attachMaster(m);
    engine.emitStory({ personal: [], announcements: [], beats: [{ character_id: c.id, text: 'Ilse escupe: «Es de la cripta».' }] });
    expect(allHooks(engine.world).some((h) => h.for_character_id === c.id && /Es de la cripta/.test(h.what))).toBe(true);
    time.advanceReal(1000);
    await engine.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(told.some((t) => /Es de la cripta/.test(t))).toBe(true);
    expect(engine.events.all().some((e) => e.action_type === 'progress_story' && /Es de la cripta/.test(e.narration_private))).toBe(false);
    engine.attachMaster(null);
    engine.emitStory({ personal: [], announcements: [], beats: [{ character_id: c.id, text: 'Hal silba.' }] });
    expect(engine.events.all().some((e) => e.action_type === 'progress_story' && e.narration_private === 'Hal silba.')).toBe(true);
  });

  it('(fallo 10) un solo hilo se llama «Ceniza»: el del perro', async () => {
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    const story = (seed.campaign as unknown as { story: Story }).story;
    expect(story.quests.filter((q) => /Ceniza/.test(q.title)).map((q) => q.id)).toEqual(['q_perro']);
    expect(seed.campaign.clues.filter((x) => /Ceniza/.test(x.title))).toEqual([]);
  });
});

describe('plazos por descansos e hitos, con aviso antes y la pérdida escrita', () => {
  it('«Ceniza se ha perdido»: al quedar un descanso, aviso; al segundo, el perro no aguanta y el Diario lo escribe (y para todos)', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Pia');
    const d = await newPc(engine, 'Roc');
    for (const pc of [c, d]) { await talkTo(engine, time, pc, 'npc_brenna'); expect(tool(engine, pc, 'story_quest', { quest_id: 'q_perro', action: 'ask' }).ok).toBe(true); bye(engine, 'npc_brenna'); }
    expect(storyContext(engine.world, c, engine.gameNow())).toContain('Plazo de «Ceniza se ha perdido»: se pierde si descansa 2 veces más');
    await sleep(engine, time, c);
    expect(status(engine, c, 'q_perro')).toBe('active');
    expect(noticeOf(lastQuest(engine, c, 'q_perro'))).toMatchObject({ text: 'Queda poco · «Ceniza se ha perdido»', quest: { event: 'warned', why: expect.stringContaining('si descansamos otra vez, será tarde') } });
    await sleep(engine, time, c);
    expect(status(engine, c, 'q_perro')).toBe('failed');
    expect(journalQuest(engine, c, 'q_perro')!.history.at(-1)).toMatchObject({ kind: 'failed', text: 'Nos entretuvimos demasiado: el perro no salió vivo de la madriguera.' });
    // El mundo lo recuerda: el perro ha muerto, y a quien también lo buscaba se le escribe así.
    expect(engine.world.npc('npc_ceniza').status).toBe('dead');
    expect(status(engine, d, 'q_perro')).toBe('failed');
    expect(journalQuest(engine, d, 'q_perro')!.history.at(-1)).toMatchObject({ text: 'El perro murió antes de que pudiéramos sacarlo de la madriguera' });
  });

  it('«La cadena de hierro frío»: un hito, no horas; aviso antes del punto sin vuelta atrás y, al pasarlo, lo perdido queda escrito', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Sol');
    characterStory(c).done.push('q_agua');
    c.xp = 300;
    await talkTo(engine, time, c, 'npc_ilse');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_cadena', action: 'ask' }).ok).toBe(true);
    bye(engine, 'npc_ilse');
    const start = engine.world.campaign.game_epoch_s;
    time.advanceGame(start + 48.5 * H - engine.gameNow());
    await engine.tick();
    expect(status(engine, c, 'q_cadena')).toBe('active');
    expect(noticeOf(lastQuest(engine, c, 'q_cadena'))).toMatchObject({ text: 'Queda poco · «La cadena de hierro frío»' });
    time.advanceGame(start + 54.5 * H - engine.gameNow());
    await engine.tick();
    expect(status(engine, c, 'q_cadena')).toBe('failed');
    expect(journalQuest(engine, c, 'q_cadena')!.history.at(-1)).toMatchObject({ kind: 'failed', text: 'Garrán clavó la herrería antes de que sacáramos los eslabones.' });
  });
});

describe('validación de la historia', () => {
  const has = { spot: () => true, location: () => true, npc: (id: string) => id !== 'npc_nadie', item: () => true, clue: () => true, job: () => true, exit: () => true };
  it('pide nivel, quien la ofrezca (salvo la principal) y reglas de muerte que cambien algo', () => {
    const story = {
      escalation: [],
      quests: [
        { id: 'q_a', act: 1, title: 'A', giver_npc_id: null, text: 't', notes: 'n', steps: [{ id: 's', text: 'S', done_when: { kind: 'clue', clue_id: 'c' } }], reward: {}, on_complete: [] },
        { id: 'q_b', act: 2, title: 'B', giver_npc_id: 'npc_x', level: 2, min_level: 3, text: 't', notes: 'n', steps: [{ id: 's', text: 'S', done_when: { kind: 'talk', npc_id: 'npc_nadie' } }], reward: {}, on_complete: [],
          on_npc_dead: [{ npc_id: 'npc_x', outcome: 'reroute', why: 'x' }] },
      ],
    } as unknown as Story;
    const errs = validateStory(story, has).join('\n');
    expect(errs).toMatch(/q_a: falta el nivel/);
    expect(errs).toMatch(/q_a: sin quien la dé solo puede ser misión principal/);
    expect(errs).toMatch(/q_b: min_level debe ir de 1 al nivel/);
    expect(errs).toMatch(/q_b\/s: el NPC npc_nadie no existe/);
    expect(errs).toMatch(/on_npc_dead \(npc_x\) no cambia nada/);
  });

  it('lista de casos límite: cada NPC del que depende una misión (paso, entrega o pista que solo da él) tiene su plan B', () => {
    const step = (id: string, done_when: unknown) => ({ id, text: id, done_when });
    const story = {
      escalation: [],
      quests: [
        // Depende de Hugo (hablar), de Brenna (una pista que solo da ella) y de quien la recibe (Ilse); solo Ilse tiene regla.
        { id: 'q_x', act: 1, title: 'X', giver_npc_id: 'npc_ilse', level: 1, text: 't', notes: 'n', reward: {}, on_complete: [],
          steps: [step('a', { kind: 'talk', npc_id: 'npc_hugo' }), step('b', { kind: 'clue', clue_id: 'clue_brenna' }), step('c', { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_brenna' }, { kind: 'carry', item_id: 'it_x' }] })],
          on_npc_dead: [{ npc_id: 'npc_ilse', outcome: 'fail', why: 'x' }] },
        // El otro camino vuelve a depender del muerto.
        { id: 'q_y', act: 1, title: 'Y', giver_npc_id: 'npc_ilse', turn_in_npc_id: null, level: 1, text: 't', notes: 'n', reward: {}, on_complete: [],
          steps: [step('a', { kind: 'npc_has', npc_id: 'npc_hugo', item_id: 'it_x' })],
          on_npc_dead: [{ npc_id: 'npc_hugo', outcome: 'reroute', why: 'x', steps: [step('b', { kind: 'talk', npc_id: 'npc_hugo' })] }] },
      ],
    } as unknown as Story;
    const errs = validateStory(story, { ...has, clueNpcs: (id) => (id === 'clue_brenna' ? ['npc_brenna'] : []) }).join('\n');
    expect(errs).toMatch(/q_x: depende de npc_hugo \(el paso a\)/);
    expect(errs).toMatch(/q_x: depende de npc_brenna \(el paso b\)/);
    expect(errs).not.toMatch(/q_x: depende de npc_ilse/);
    expect(errs).toMatch(/q_y: el camino de si muere npc_hugo sigue dependiendo de él \(el paso b\)/);
    // El paso c no depende de Brenna: tiene otro camino (llevar el objeto).
    expect(errs.match(/npc_brenna/g)).toHaveLength(1);
  });

  it('el otro camino puede repetir pasos: muerto Doro a mitad de «Lo que vio Doro», lo ya hecho cuenta y se cumple sin entrega', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Ona');
    characterStory(c).done.push('q_cena_doro');
    await talkTo(engine, time, c, 'npc_doro');
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_noche', action: 'accept' }).ok).toBe(true);
    characterStory(c).steps.push('q_noche/confianza', 'q_noche/vigilar');
    engine.world.npc('npc_doro').status = 'dead';
    await engine.tick();
    expect(status(engine, c, 'q_noche')).toBe('active');
    expect(questsOf(engine.world, c).find((v) => v.quest.id === 'q_noche')!.current!.id).toBe('que_lleva');
    // Lo que contó Doro y la vigilia (dados) y qué lleva; ya sin «volver con Doro».
    expect(journalQuest(engine, c, 'q_noche')!.steps.map((s) => [s.text, s.done])).toEqual([['Que Doro te cuente lo que vio', true], ['Vigilar de noche el arroyo del Soto', true], ['Descubrir qué lleva el hijo del molinero al granero y qué trae', false]]);
    engine.world.itemInstance('ii_cartas_tobias').location = { type: 'character', id: c.id, slot: { kind: 'pocket' } };
    await engine.tick();
    expect(status(engine, c, 'q_noche')).toBe('done');
  });
});
