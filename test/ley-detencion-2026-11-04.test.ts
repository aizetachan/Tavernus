/**
 * La ley y la amenaza, partida del 04-11-2026 en Brezal. Cat, buscado por la
 * muerte de Osric Malvez, huye de Doro desde la Casa de las hierbas, se
 * esconde en el callejón (Sigilo 20) y, sin que nadie le vea, el motor le da
 * el alto. Luego encadena cinco turnos bajo ese alto (persuadir dos veces con
 * fallo, gritar a Ilse, «todo ha sido una confusión», huir con Acrobacias
 * fallida) y Doro solo repite «una más y te ato»: cada turno el máster abre
 * una ventana de 60 s y, cuando una caduca, narra «Te acercas a la puerta».
 *
 * Lo que el motor garantiza ahora, sin IA (un máster falso con guion):
 *   - Nadie da el alto a quien está escondido y no le ve.
 *   - Bajo el alto, un intento de ganar tiempo; al segundo, o al primer fallo, la autoridad actúa.
 *   - Quien ya se resistió no recibe otro «¡Alto!»: la autoridad va a por él.
 *   - La ventana que abre la autoridad o un NPC hostil la cumple el motor al caducar.
 *   - Nunca dos ventanas seguidas, y una como mucho por NPC y combate.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine, type MasterLike, type MasterResolution, type RequiresRoll } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { dueNpcTurns } from '../src/engine/combat.js';
import { allIncidents } from '../src/engine/crime.js';
import { conflictVerdict, resolveConflict } from '../src/engine/conflict.js';
import { npcSees } from '../src/engine/perception.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import type { Character, GameEvent, Npc } from '../src/engine/model.js';
import { fakeTime, waitUntil } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

afterEach(() => { vi.restoreAllMocks(); });

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  // Solo Doro hace cumplir la ley aquí (Garrán, lejos, no entra en la escena).
  engine.world.campaign.law = { ...engine.world.campaign.law, enforcers: ['npc_doro'] };
  return { engine, time };
}

type Close = Partial<Extract<MasterResolution, { ok: true }>['closed']>;

/** Un máster con guion: cada llamada toma el siguiente cierre (o «Pasa algo.») y apunta el texto, la escena y el contexto. */
function scripted(engine: Engine, script: Close[] = []) {
  const calls: { text: string; scene?: string; context: string; roll?: boolean }[] = [];
  const m: MasterLike = {
    async resolve(actor, text, roll, intro, scene) {
      calls.push({ text, scene, roll: Boolean(roll), context: actionContext(engine, actor, text, roll, intro, scene) });
      const next = script.shift() ?? {};
      return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: { narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null, ...next } };
    },
  };
  engine.attachMaster(m);
  return calls;
}

function hold(engine: Engine, n: Npc, spotId: string): void {
  n.location = { type: 'spot', id: spotId };
  expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spotId, minutes: 600 }, engine.gameNow()).ok).toBe(true);
}

function put(c: Character, spotId: string): void { c.location = { type: 'spot', id: spotId }; }

function ctxFor(engine: Engine, c: Character, extra: Partial<ToolContext> = {}): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], ...extra };
}

type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string };
function tool(ctx: ToolContext, name: string, input: Record<string, unknown>): ToolOut {
  return JSON.parse(executeTool(ctx, name, input)) as ToolOut;
}

function close(over: Record<string, unknown>): Record<string, unknown> {
  return {
    narration_private: 'Asientes.', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
    decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null,
    names_learned: null, places_learned: null, introduces_self: false, target_character_id: null, observable_target: null, lines: null, ...over,
  };
}

const after = (engine: Engine, seq: number): GameEvent[] => engine.events.all().filter((e) => e.seq > seq);
const lastSeq = (engine: Engine) => engine.events.all().at(-1)?.seq ?? 0;

/** Deja pendiente una tirada como la pediría el máster (requires_roll) tras la acción `text`. */
function pend(engine: Engine, c: Character, text: string, roll: RequiresRoll): void {
  (engine as unknown as { pendingRolls: Map<string, unknown> }).pendingRolls.set(c.id, { text, roll, event_id: 'ev_x', seq: lastSeq(engine) });
}

/** El d20 sale lo que se pida (Math.random de las tiradas del jugador). */
function d20(n: number): void { vi.spyOn(Math, 'random').mockReturnValue((n - 1) / 20 + 0.001); }

/**
 * La escena: Cat mata a Osric en la Casa de las hierbas delante de Doro (y de Ilse). Doro le da el alto.
 * Cat ya conoce a Doro y a Ilse (como en la partida).
 */
async function laCasa() {
  const { engine, time } = await boot();
  const r = await engine.createCharacter('u_cat', 'Cat', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  const cat = r.character;
  cat.hp_max = 60; cat.hp_current = 60;
  const [doro, ilse, osric] = ['npc_doro', 'npc_ilse', 'npc_osric'].map((id) => engine.world.npc(id)) as [Npc, Npc, Npc];
  put(cat, 'sp_cu_hierbas');
  hold(engine, doro, 'sp_cu_hierbas'); hold(engine, ilse, 'sp_cu_hierbas'); hold(engine, osric, 'sp_cu_hierbas');
  cat.knows.push('npc_doro', 'npc_ilse');
  const kill = tool(ctxFor(engine, cat), 'apply_damage', { target_id: 'npc_osric', amount: 100, damage_type: 'piercing', source: 'daga de Cat' });
  expect(kill).toMatchObject({ died: true, murder: true });
  // El máster ya lo contó (el control de cierre del incidente no entra en estos tests).
  for (const i of allIncidents(engine.world)) i.narrated_to.push(cat.id);
  await engine.tick();
  expect(cat.wanted?.arrest).toMatchObject({ npc_id: 'npc_doro', announced: true, resisted: false });
  return { engine, time, cat, doro, ilse };
}

describe('1. escondido: nadie da el alto a quien no ve', () => {
  it('Cat se va, se esconde en el callejón (Sigilo 20) y Doro llega a la plaza: no hay alto; al salir a la vista, sí', async () => {
    const { engine, cat, doro } = await laCasa();
    // Se ha ido de delante de Doro (está en la Casa de las hierbas): la detención queda en el aire.
    put(cat, 'sp_pl_callejon');
    await engine.tick();
    expect(cat.wanted?.arrest).toBeNull();
    expect(cat.wanted?.resisted_by ?? []).toEqual([]);
    // «Esconderte en el callejón» → Sigilo. d20 17 + 3 = 20 (como en la partida), o más con pericia.
    const calls = scripted(engine);
    d20(17);
    pend(engine, cat, 'Esconderte en el callejón', { kind: 'skill', key: 'stealth', dc: 10, advantage: 'none' });
    await engine.rollPending(cat.id);
    expect(cat.sneak).toMatchObject({ spot_id: 'sp_pl_callejon' });
    expect(cat.sneak!.total).toBeGreaterThanOrEqual(20);
    // Doro sale a la plaza dando voces (percepción pasiva 15): no le ve.
    hold(engine, doro, 'sp_pl_pozo');
    expect(npcSees(engine.world, doro, cat)).toBe(false);
    const from = lastSeq(engine);
    await engine.tick();
    expect(cat.wanted?.arrest).toBeNull();
    expect(after(engine, from).some((e) => e.action_type === 'arrest')).toBe(false);
    // El máster sabe que está escondido y de quién.
    expect(actionContext(engine, cat, 'Asomarse a mirar la plaza')).toMatch(/## Escondido\nCat está ESCONDIDO en el callejón de las hierbas \(Sigilo \d+\)\. No le ven: Doro \[npc_doro\]/);
    // «Asomarse a mirar la plaza»: sigue escondido; Doro no le ve ni le da el alto.
    await engine.act(cat.id, 'Asomarse a mirar la plaza');
    expect(calls.at(-1)!.text).toBe('Asomarse a mirar la plaza');
    expect(cat.sneak).not.toBeNull();
    await engine.tick();
    expect(cat.wanted?.arrest).toBeNull();
    // Tampoco el combate le cuenta como objetivo mientras no le ve.
    doro.attitude.by_character[cat.id] = 'hostile';
    expect(dueNpcTurns(engine.world, [cat.id], new Set()).map((d) => d.npc.id)).not.toContain('npc_doro');
    doro.attitude.by_character[cat.id] = 'unfriendly';
    // Doro, sin verle, vuelve a buscarle donde le vieron por última vez (la casa)…
    expect(cat.wanted?.hunter_id).toBe('npc_doro');
    // …y de vuelta en la plaza, Cat sale llamando a gritos: se descubre, Doro le ve y le da el alto.
    await engine.act(cat.id, 'Salgo a la plaza y llamo a Ilse a gritos');
    expect(cat.sneak).toBeNull();
    hold(engine, doro, 'sp_pl_pozo');
    await engine.tick();
    expect(cat.wanted?.arrest).toMatchObject({ npc_id: 'npc_doro', announced: true });
    expect(engine.events.all().filter((e) => e.action_type === 'arrest' && e.actor_id === cat.id)).toHaveLength(2);
  });

  it('el cierre rechaza que un NPC que no le ve le hable o le dé el alto (una vez)', async () => {
    const { engine, cat, doro } = await laCasa();
    put(cat, 'sp_pl_callejon');
    await engine.tick();
    cat.sneak = { spot_id: 'sp_pl_callejon', game_s: engine.nowFor(cat), total: 20 };
    hold(engine, doro, 'sp_pl_pozo');
    const ctx = ctxFor(engine, cat);
    const bad = tool(ctx, 'log_event', close({ narration_private: 'Doro se te planta delante: «¡Alto! Quedas detenido.»', lines: [{ speaker: 'npc', npc_id: 'npc_doro', text: '¡Alto! Quedas detenido.' }] }));
    expect(bad.error).toMatch(/ESCONDIDO \(Sigilo 20\) y Doro no le ve/);
    expect(tool(ctx, 'log_event', close({ narration_private: 'Doro cruza la boca del callejón sin mirar y sigue hacia la plaza, dando voces.' })).ok).toBe(true);
  });

  it('una tirada de Sigilo fallada le deja a la vista', async () => {
    const { engine, cat } = await laCasa();
    put(cat, 'sp_pl_callejon');
    cat.sneak = { spot_id: 'sp_pl_callejon', game_s: engine.nowFor(cat), total: 20 };
    scripted(engine);
    d20(1);
    pend(engine, cat, 'Me pego más a la pared', { kind: 'skill', key: 'stealth', dc: 15, advantage: 'none' });
    await engine.rollPending(cat.id);
    expect(cat.sneak).toBeNull();
  });

  it('a escondidas, si le pillan hurtando ya no está escondido: Doro le ve y le da el alto (conflict.ts y el alto, juntos)', async () => {
    const { engine } = await boot();
    const r = await engine.createCharacter('u_pil', 'Pillin', { class_id: 'rogue' });
    if (!r.ok) throw new Error(r.reason);
    const pil = r.character;
    const doro = engine.world.npc('npc_doro');
    put(pil, 'sp_pl_pozo');
    hold(engine, doro, 'sp_pl_pozo');
    const now = engine.nowFor(pil);
    // Va a escondidas (Sigilo 22 contra la pasiva 15 de Doro): no le ve.
    pil.sneak = { total: 22, game_s: now, spot_id: 'sp_pl_pozo' };
    expect(npcSees(engine.world, doro, pil, now)).toBe(false);
    const inst = { id: 'ii_bolsa_doro', item_id: [...engine.world.itemDefs.keys()][0]!, quantity: 1, location: { type: 'npc' as const, id: doro.id }, state: {} };
    engine.world.itemInstances.set(inst.id, inst);
    const v = conflictVerdict(engine.world, [], pil, doro, 'steal', inst, now)!;
    const res = resolveConflict(engine.world, pil, doro, { ...v, forced: 'caught_red_handed' }, null, now);
    expect(res.response).toBe('crime');
    // Le han visto: se acabó ir a escondidas, y la autoridad (la víctima) le da el alto.
    expect(pil.sneak).toBeNull();
    expect(pil.wanted?.arrest).toMatchObject({ npc_id: 'npc_doro' });
  });
});

describe('2. un intento como mucho bajo el alto', () => {
  it('«Habla con Ilse antes de llevarme a nadie»: el primero se tolera (Doro avisa); la persuasión con 1 natural y Doro le ata y al calabozo', async () => {
    const { engine, cat } = await laCasa();
    const calls = scripted(engine, [{ narration_private: 'Doro aprieta la mandíbula.', requires_roll: { kind: 'skill', key: 'persuasion', dc: 15, advantage: 'none' } }]);
    const r1 = await engine.act(cat.id, 'Habla con Ilse antes de llevarme a nadie, Doro. Ella estaba aquí cuando pasó todo.');
    expect(r1.requires_roll?.key).toBe('persuasion');
    expect(cat.wanted?.arrest).toMatchObject({ attempts: 1 });
    // El máster sabe que es su único intento y que a la siguiente Doro actúa.
    expect(calls[0]!.context).toMatch(/Ya ha gastado su ÚNICO intento de ganar tiempo .*Doro le escucha lo justo y ya le ha avisado una vez; a la siguiente actúa/);
    d20(1);
    const from = lastSeq(engine);
    const r2 = await engine.rollPending(cat.id);
    // El motor actúa en ese mismo turno, sin máster.
    expect(calls).toHaveLength(1);
    expect(r2.text).toMatch(/^No te sale \(.*\)\. Doro te agarra del brazo, te lo retuerce a la espalda y te ata las manos\. Te lleva a empujones .*calabozo/);
    expect(cat.location.id).toBe('sp_ca_calabozo');
    expect(cat.jailed).toBeTruthy();
    expect(cat.wanted).toBeNull();
    const seized = after(engine, from).find((e) => e.action_type === 'seized')!;
    expect(seized.tags).toEqual(expect.arrayContaining(['crime', 'law', 'deterministic']));
    expect(seized.payload['sentence']).toMatchObject({ kind: 'jail', forced: true });
    expect(seized.observable).toBe('Doro reduce a Cat, le ata las manos y se lo lleva detenido.');
  });

  it('dos intentos de hablar, sin tirada: al segundo («Todo ha sido una confusión») Doro le ata; el máster ni se entera', async () => {
    const { engine, cat } = await laCasa();
    const calls = scripted(engine, [{ narration_private: 'Doro no se mueve: «Una más y te ato.»' }]);
    await engine.act(cat.id, '¡Ilse! ¡Sal, por favor! Doro no me deja moverme.');
    expect(calls).toHaveLength(1);
    expect(cat.wanted?.arrest?.attempts).toBe(1);
    const r = await engine.act(cat.id, 'Todo ha sido una confusión, Doro. No hice nada malo.');
    expect(calls).toHaveLength(1);
    expect(r.text).toMatch(/^Doro ya te ha avisado una vez y no te deja seguir\. Doro te agarra del brazo/);
    expect(cat.jailed).toBeTruthy();
  });

  it('una persuasión con éxito compra un intento más, nada más: al tercero, al calabozo', async () => {
    const { engine, cat } = await laCasa();
    const calls = scripted(engine, [{ requires_roll: { kind: 'skill', key: 'persuasion', dc: 10, advantage: 'none' } }]);
    await engine.act(cat.id, 'Doro, escúchame un momento.');
    d20(20);
    await engine.rollPending(cat.id);
    expect(cat.wanted?.arrest).toMatchObject({ attempts: 1, bought: 1 });
    expect(calls).toHaveLength(2);
    await engine.act(cat.id, 'Ilse lo vio todo, pregúntale.');
    expect(calls).toHaveLength(3);
    expect(cat.jailed ?? null).toBeNull();
    expect(calls[2]!.context).toMatch(/Ya ha gastado su ÚNICO intento/);
    await engine.act(cat.id, 'De verdad, no fui yo.');
    expect(calls).toHaveLength(3);
    expect(cat.jailed).toBeTruthy();
  });

  it('entregarse sigue valiendo bajo el alto (no cuenta como intento)', async () => {
    const { engine, cat } = await laCasa();
    scripted(engine);
    const r = await engine.act(cat.id, 'me entrego');
    expect(r.text).toMatch(/Levantas las manos/);
    expect(cat.jailed).toBeTruthy();
  });
});

describe('3. resistido y huido: al volver a verle no hay «¡Alto!», sino ataque', () => {
  it('se resiste, huye a la plaza (Doro le pierde) y Doro, al verle, va a por él sin dar el alto; con una tirada fallada, le ataca de verdad', async () => {
    const { engine, cat, doro } = await laCasa();
    scripted(engine);
    const r = await engine.act(cat.id, 'me resisto');
    expect(r.text).toMatch(/No te entregas/);
    expect(cat.wanted?.resisted_by).toEqual(['npc_doro']);
    // Huye a la plaza: Doro, en la casa, ya no le ve; la detención queda en el aire, pero se recuerda.
    put(cat, 'sp_pl_pozo');
    await engine.tick();
    expect(cat.wanted?.arrest).toBeNull();
    expect(cat.wanted?.resisted_by).toEqual(['npc_doro']);
    // Doro sale a la plaza y le ve.
    hold(engine, doro, 'sp_pl_tablon');
    const from = lastSeq(engine);
    await engine.tick();
    const law = after(engine, from).filter((e) => e.actor_id === cat.id && ['arrest', 'pursuit'].includes(e.action_type));
    expect(law.map((e) => e.action_type)).toEqual(['pursuit']);
    expect(law[0]!.narration_private).toMatch(/^Doro te ve y no te da el alto: ya te resististe una vez\. Viene a por ti/);
    expect(law[0]!.narration_private).not.toMatch(/¡Alto!/);
    expect(law[0]!.tags).toContain('combat');
    expect(cat.wanted?.arrest).toMatchObject({ npc_id: 'npc_doro', resisted: true });
    expect(doro.attitude.by_character[cat.id]).toBe('hostile');
    // El máster lo sabe: le persigue, no negocia.
    expect(actionContext(engine, cat, 'mirar')).toMatch(/Doro le persigue, no negocia\. No le da el alto ni le avisa/);
    // «huir» con Acrobacias fallida: Doro le ataca de verdad (el motor, sin máster).
    d20(3);
    pend(engine, cat, 'huir', { kind: 'skill', key: 'acrobatics', dc: 13, advantage: 'none' });
    const hp = cat.hp_current;
    const hit = await engine.rollPending(cat.id);
    const atk = engine.events.all().filter((e) => e.action_type === 'law_attack').at(-1)!;
    expect(atk).toBeTruthy();
    expect(atk.tags).toEqual(expect.arrayContaining(['combat', 'law', 'deterministic']));
    expect(hit.text).toMatch(/^No te sale \(.*\)\. Doro (se lanza contra ti y )?te ataca/);
    // rng del motor 0.99: siempre le da.
    expect(cat.hp_current).toBeLessThan(hp);
  });
});

describe('4. la ventana decisiva la cumple el motor', () => {
  it('ventana caducada con un alto encima («Tienes 60 s»): Doro le reduce y le ata, sin IA, con la etiqueta decisive_timeout', async () => {
    const { engine, time, cat } = await laCasa();
    const calls = scripted(engine, [{ narration_private: 'Doro aprieta la lanza.', decisive: { threat: 'Doro entra y te ata', npc_id: 'npc_doro' } }]);
    await engine.act(cat.id, 'Miro a Doro a los ojos');
    expect(cat.decisive).toMatchObject({ npc_id: 'npc_doro' });
    const from = lastSeq(engine);
    time.advanceReal(61);
    await engine.tick();
    await waitUntil(() => expect(cat.decisive).toBeNull());
    expect(calls).toHaveLength(1); // el máster no decide nada al caducar
    const seized = after(engine, from).find((e) => e.action_type === 'seized')!;
    expect(seized.tags).toContain('decisive_timeout');
    expect(seized.narration_private).toMatch(/^Se te acaba el tiempo\. Doro te agarra del brazo/);
    expect(cat.jailed).toBeTruthy();
  });

  it('el cierre le pone a la ventana su consecuencia: con el alto, detener; con un NPC hostil, atacar; sin NPC, prosa', async () => {
    const { engine, cat } = await laCasa();
    const ok = (ctx: ToolContext) => ctx.closed?.decisive;
    const a = ctxFor(engine, cat);
    expect(tool(a, 'log_event', close({ decisive_threat: 'Doro te ata', decisive_npc_id: 'npc_doro' })).ok).toBe(true);
    expect(ok(a)).toMatchObject({ npc_id: 'npc_doro', consequence: { kind: 'arrest', npc_id: 'npc_doro' } });
    // Sin alto: Hugo hostil, con bloque de combate.
    cat.wanted = null;
    cat.decisive_log = [];
    const hugo = engine.world.npc('npc_hugo');
    hold(engine, hugo, 'sp_cu_hierbas');
    hugo.attitude.by_character[cat.id] = 'hostile';
    const b = ctxFor(engine, cat);
    expect(tool(b, 'log_event', close({ decisive_threat: 'Hugo levanta el martillo', decisive_npc_id: 'npc_hugo' })).ok).toBe(true);
    expect(ok(b)?.consequence).toEqual({ kind: 'attack', npc_id: 'npc_hugo' });
    cat.decisive_log = [];
    const c = ctxFor(engine, cat);
    expect(tool(c, 'log_event', close({ decisive_threat: 'el suelo cruje bajo tus pies' })).ok).toBe(true);
    expect(ok(c)?.consequence).toBeNull();
  });

  it('ventana caducada de un NPC hostil: ataca el motor (no el máster) y el máster solo lo cuenta, con decisive_timeout', async () => {
    const { engine, time, cat } = await laCasa();
    cat.wanted = null;
    const hugo = engine.world.npc('npc_hugo');
    hold(engine, hugo, 'sp_cu_hierbas');
    hugo.attitude.by_character[cat.id] = 'hostile';
    const calls = scripted(engine, [{ narration_private: 'El martillo cae.' }]);
    cat.decisive = { opened_real_ms: time.now(), window_s: 60, threat: 'Hugo te parte la cabeza', npc_id: 'npc_hugo', event_id: 'ev_d', consequence: { kind: 'attack', npc_id: 'npc_hugo' } };
    const hp = cat.hp_current;
    const from = lastSeq(engine);
    time.advanceReal(61);
    await engine.tick();
    await waitUntil(() => expect(cat.decisive).toBeNull());
    expect(cat.hp_current).toBeLessThan(hp);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.scene).toBe('decisive_timeout');
    expect(calls[0]!.context).toMatch(/El servidor YA ha ejecutado la amenaza: El herrero te ataca .*no llames a attack/);
    const ev = after(engine, from).find((e) => e.action_type === 'master')!;
    expect(ev.tags).toEqual(expect.arrayContaining(['decisive_timeout', 'combat']));
  });

  it('sin máster, la cuenta el motor', async () => {
    const { engine, time, cat } = await laCasa();
    cat.wanted = null;
    const hugo = engine.world.npc('npc_hugo');
    hold(engine, hugo, 'sp_cu_hierbas');
    hugo.attitude.by_character[cat.id] = 'hostile';
    cat.decisive = { opened_real_ms: time.now(), window_s: 60, threat: 'Hugo te parte la cabeza', npc_id: 'npc_hugo', event_id: 'ev_d' };
    time.advanceReal(61);
    await engine.tick();
    await waitUntil(() => expect(cat.decisive).toBeNull());
    const ev = engine.events.all().filter((e) => e.action_type === 'decisive_expired').at(-1)!;
    expect(ev.narration_private).toMatch(/^No reaccionas a tiempo\. El herrero te ataca/);
    expect(ev.tags).toEqual(expect.arrayContaining(['decisive_timeout', 'combat']));
  });
});

describe('5. nunca dos ventanas seguidas; una por NPC y combate', () => {
  async function pelea(hostile = false) {
    const { engine, cat } = await laCasa();
    cat.wanted = null;
    const hugo = engine.world.npc('npc_hugo');
    hold(engine, hugo, 'sp_cu_hierbas');
    if (hostile) hugo.attitude.by_character[cat.id] = 'hostile';
    return { engine, cat, hugo };
  }

  it('la segunda ventana seguida se rechaza con el motivo; si insiste, se ignora', async () => {
    const { engine, cat } = await pelea();
    cat.decisive_log = [{ npc_id: 'npc_doro', location_id: 'loc_curandera', game_s: engine.nowFor(cat), cleared: false }];
    const ctx = ctxFor(engine, cat);
    const bad = tool(ctx, 'log_event', close({ decisive_threat: 'Doro te ata', decisive_npc_id: 'npc_ilse' }));
    expect(bad.error).toMatch(/nunca dos seguidas/);
    expect(tool(ctx, 'log_event', close({ decisive_threat: 'Doro te ata', decisive_npc_id: 'npc_ilse' })).ok).toBe(true);
    expect(ctx.closed?.decisive).toBeNull();
  });

  it('tras una tirada con éxito (o un turno sin ventana) ya no es «seguida»', async () => {
    const { engine, cat } = await pelea();
    cat.decisive_log = [{ npc_id: 'npc_doro', location_id: 'loc_curandera', game_s: engine.nowFor(cat), cleared: false }];
    scripted(engine);
    d20(20);
    pend(engine, cat, 'esquivo', { kind: 'skill', key: 'acrobatics', dc: 10, advantage: 'none' });
    await engine.rollPending(cat.id);
    expect(cat.decisive_log.every((d) => d.cleared)).toBe(true);
    const ctx = ctxFor(engine, cat);
    expect(tool(ctx, 'log_event', close({ decisive_threat: 'el suelo cede', decisive_npc_id: null })).ok).toBe(true);
    expect(ctx.closed?.decisive).toMatchObject({ threat: 'el suelo cede' });
  });

  it('el NPC hostil de la ventana no se libra de su turno: su segunda ventana en el combate se rechaza y ataca', async () => {
    const { engine, cat, hugo } = await pelea(true);
    // Ya tuvo su ventana en este combate (y quedó atrás).
    cat.decisive_log = [{ npc_id: 'npc_hugo', location_id: 'loc_curandera', game_s: engine.nowFor(cat), cleared: true }];
    const ctx = ctxFor(engine, cat, { action_text: 'le pego a Hugo' });
    tool(ctx, 'attack', { attacker_id: cat.id, target_id: 'npc_hugo', advantage: 'none' });
    const bad = tool(ctx, 'log_event', close({ narration_private: 'Hugo levanta el martillo.', decisive_threat: 'Hugo te parte la cabeza', decisive_npc_id: 'npc_hugo' }));
    expect(bad.error).toMatch(/Hugo ya tuvo la suya en este combate/);
    // Insiste: la ventana se ignora y Hugo hace su turno (el motor).
    const r2 = tool(ctx, 'log_event', close({ narration_private: 'Hugo levanta el martillo.', decisive_threat: 'Hugo te parte la cabeza', decisive_npc_id: 'npc_hugo' }));
    expect(r2.error ?? '').toMatch(/Turno de los NPC hostiles|^$/);
    expect((ctx.forced_turns ?? []).map((f) => f.npc_id)).toContain(hugo.id);
  });
});
