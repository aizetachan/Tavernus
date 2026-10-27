/**
 * Bloque I · Hechos y reglas del mundo (Obsidian, «Modelo Baldur's Gate 3»,
 * §2–§4). Reglas en los datos (`reactions: [{ when, then }]`), etiquetas del
 * PJ, opinión numérica por NPC y por PJ con umbrales, comentarios al pasar y
 * consecuencias que vuelven. Con Brezal (la muerte de Hugo, Ceniza que vuelve)
 * y con reglas inventadas sobre la semilla demo, para ver que el motor no sabe
 * nada de ninguna campaña. Sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { STORY } from '../src/data/campaigns/brezal/story.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import { killNpc } from '../src/engine/death.js';
import { characterStory, currentStep, holds, stepVisible, storyOf } from '../src/engine/story.js';
import { buyFromNpc } from '../src/engine/progress.js';
import { refusesService } from '../src/engine/crime.js';
import { changeOpinion, opinionOf, priceFor, socialDcShift, tagsOf, trustLevel } from '../src/engine/standing.js';
import { hasFact, factById } from '../src/engine/worldfacts.js';
import { legacyRules, reactionsTable, tagOptions, tickWorld, topicsOf, validateReactions, TELL_DELAY_S, type WorldRule } from '../src/engine/worldrules.js';
import { addChatter, chatterSets, CHATTER_GAP_S, LISTENER_GAP_S, tickChatter } from '../src/engine/chatter.js';
import { chatterWriter, parseChatterLines } from '../src/ai/chatter-writer.js';
import { toMessage } from '../src/adapters/web/server.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { SKILLS } from '../src/engine/rules.js';
import type { Character, GameEvent, Npc } from '../src/engine/model.js';
import { bootEngine, fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  return { engine, time };
}

async function newPc(engine: Engine, name: string, spec: Record<string, string> = {}): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id: 'wizard', ...spec });
  if (!r.ok) throw new Error(r.reason);
  return r.character;
}

function ctxFor(engine: Engine, c: Character, extra: Partial<ToolContext> = {}): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], ...extra };
}

type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string };
const tool = (ctx: ToolContext, name: string, input: Record<string, unknown>): ToolOut => JSON.parse(executeTool(ctx, name, input)) as ToolOut;

function close(over: Record<string, unknown>): Record<string, unknown> {
  return {
    narration_private: 'Asientes.', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
    decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null,
    names_learned: null, places_learned: null, introduces_self: false, target_character_id: null, observable_target: null, lines: null, ...over,
  };
}

function put(spotId: string, ...who: (Character | Npc)[]): void {
  for (const x of who) { x.location = { type: 'spot', id: spotId }; delete (x as Npc & { order?: unknown }).order; }
}

function hold(engine: Engine, n: Npc, spotId: string): void {
  n.location = { type: 'spot', id: spotId };
  expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spotId, minutes: 900 }, engine.gameNow()).ok).toBe(true);
}

const since = (engine: Engine, seq: number): GameEvent[] => engine.events.all().filter((e) => e.seq > seq);
const lastSeq = (engine: Engine) => engine.events.all().at(-1)?.seq ?? 0;
const chatter = (engine: Engine, seq: number) => since(engine, seq).filter((e) => e.action_type === 'chatter');

/** Las 19:20 en el Jabalí: Hugo cenando en la barra con Brenna y Garrán delante; Doro en el portón. */
async function laBarra() {
  const { engine, time } = await boot();
  time.advanceGame(80 * 60);
  await engine.tick();
  const leo = await newPc(engine, 'Leodhin');
  const [hugo, brenna, garran, doro] = ['npc_hugo', 'npc_brenna', 'npc_garran', 'npc_doro'].map((id) => engine.world.npc(id)) as [Npc, Npc, Npc, Npc];
  put('sp_tab_barra', leo);
  for (const n of [hugo, brenna, garran]) hold(engine, n, 'sp_tab_barra');
  hold(engine, doro, 'sp_pl_porton');
  leo.knows.push('npc_brenna');
  await engine.tick();
  return { engine, time, leo, hugo, brenna, garran, doro };
}

async function matarAHugo(engine: Engine, leo: Character): Promise<void> {
  tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
  const kill = tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
  expect(kill).toMatchObject({ died: true, murder: true });
  await engine.tick();
}

describe('la muerte de Hugo a manos de un forastero (Brezal)', () => {
  it('etiqueta «asesino», −5 de quien lo vio y el hecho, con quién lo sabe, en el contexto del máster', async () => {
    const { engine, leo, brenna, doro } = await laBarra();
    const from = lastSeq(engine);
    await matarAHugo(engine, leo);
    expect(tagsOf(engine.world, leo).find((t) => t.id === 'asesino')).toMatchObject({ kind: 'earned', label: 'asesino', why: 'mató a Hugo' });
    expect(since(engine, from).some((e) => e.actor_id === leo.id && /🏷 Etiqueta nueva: «asesino»/.test(e.narration_private))).toBe(true);
    // Brenna lo vio: −5. Doro no estaba: aún nada (no lo adivina).
    expect(opinionOf(brenna, leo.id)).toBe(-5);
    expect(opinionOf(doro, leo.id)).toBe(0);
    expect(hasFact(engine.world, 'npc_dead:npc_hugo')).toBe(true);
    const ctx = actionContext(engine, leo, 'Miro a mi alrededor');
    expect(ctx).toMatch(/## Hechos del mundo \(lo que ha pasado\)\n- Hugo \(el herrero\) murió a manos de Leodhin \[el actor\] \(lo saben: [^)]*Brenna/);
    expect(ctx).not.toMatch(/lo saben: [^)]*Doro/);
    expect(ctx).toMatch(/Etiquetas: elfo|Etiquetas: humano|Etiquetas: [a-záéíóú]+, mago, erudito, asesino \(mató a Hugo\)/);
    // Garrán lo vio: ya le busca, y Brenna, que sabe la etiqueta, le tiene miedo.
    expect(topicsOf(engine.world, 'npc_garran', engine.gameNow()).map((t) => t.text).join(' ')).toMatch(/Busca a Leodhin: le han contado que mató a Hugo/);
    expect(ctx).toMatch(/Reacciona a lo que sabe de Leodhin: asesino → le tiene miedo/);
  });

  it('a Doro, su amigo, le llega de boca en boca: entonces −10, luto y hostilidad; nunca antes', async () => {
    const { engine, time, leo, brenna, doro } = await laBarra();
    await matarAHugo(engine, leo);
    expect(opinionOf(doro, leo.id)).toBe(0);
    expect(topicsOf(engine.world, 'npc_doro', engine.gameNow())).toHaveLength(0);
    // Brenna, que lo vio, sale a la plaza y coincide con Doro en el portón.
    hold(engine, brenna, 'sp_pl_porton');
    time.advanceGame(TELL_DELAY_S + 60);
    await engine.tick();
    await engine.tick();
    expect(factById(engine.world, 'npc_dead:npc_hugo')!.knowers.some((k) => k.npc_id === 'npc_doro')).toBe(true);
    expect(opinionOf(doro, leo.id)).toBe(-10);
    expect(doro.opinion![leo.id]!.log.at(-1)).toMatchObject({ delta: -10, why: 'mató a Hugo, su amigo' });
    expect(['unfriendly', 'hostile']).toContain(doro.attitude.by_character[leo.id]);
    expect(topicsOf(engine.world, 'npc_doro', engine.gameNow()).map((t) => t.text).join(' ')).toMatch(/Hugo era su amigo: está de luto/);
    put('sp_pl_porton', leo);
    const ctx = actionContext(engine, leo, 'Saludo al guardia');
    expect(ctx).toMatch(/Opinión de Leodhin: -10 \(-10 mató a Hugo, su amigo\)\. CD social \+2/);
    expect(ctx).toMatch(/Tiene en la cabeza: Hugo era su amigo/);
  });

  it('muerto de otra cosa (sin culpa de nadie): luto y comentarios, pero nadie pierde opinión ni etiqueta', async () => {
    const { engine, leo, hugo, doro } = await laBarra();
    killNpc(engine.world, hugo, engine.gameNow(), null, 'la tos gris');
    await engine.tick();
    expect(tagsOf(engine.world, leo).some((t) => t.id === 'asesino')).toBe(false);
    expect(opinionOf(doro, leo.id)).toBe(0);
    expect(factById(engine.world, 'npc_dead:npc_hugo')?.text).toBe('Hugo (el herrero) murió');
  });

  it('en la plaza se comenta durante días quien lo sabe; el asesino oye lo suyo; nadie repite la misma frase', async () => {
    const { engine, time, leo, brenna, garran } = await laBarra();
    await matarAHugo(engine, leo);
    const mira = await newPc(engine, 'Mira');
    // Mira en la plaza con Brenna (que lo sabe); a Garrán, que también lo sabe, se lo lleva la ley tras Leodhin: lo apartamos.
    put('sp_pl_pozo', mira);
    hold(engine, brenna, 'sp_pl_pozo');
    leo.wanted = null;
    hold(engine, garran, 'sp_ca_despacho');
    put('sp_tab_barra', leo);
    time.advanceGame(CHATTER_GAP_S);
    let from = lastSeq(engine);
    await engine.tick();
    const [first] = chatter(engine, from).filter((e) => e.location_id === 'loc_plaza');
    expect(first).toBeDefined();
    expect(first!.payload['chatter']).toMatchObject({ npc_id: 'npc_brenna', kind: 'rumor', text: '¿Os habéis enterado de lo del herrero?' });
    expect(first!.observable).toBe('La tabernera, al pasar: «¿Os habéis enterado de lo del herrero?»');
    // La web lo pinta como ambiente, con quien lo dice como lo conoce Mira (no sabe que es Brenna).
    const d = { event: first!, character_id: mira.id, level: 'full' as const, text: first!.observable! };
    expect(toMessage(d, engine)).toMatchObject({ ambient: { npc_id: 'npc_brenna', name: 'La tabernera', text: '¿Os habéis enterado de lo del herrero?', kind: 'rumor' } });
    expect(toMessage(d, engine).narrator).toBeUndefined();
    // Límite de frecuencia: en el mismo rato, nada más en la plaza.
    from = lastSeq(engine);
    time.advanceGame(60);
    await engine.tick();
    expect(chatter(engine, from).filter((e) => e.location_id === 'loc_plaza')).toHaveLength(0);
    // Pasado el rato, otra frase distinta (nadie oye dos veces la misma).
    time.advanceGame(Math.max(CHATTER_GAP_S, LISTENER_GAP_S));
    from = lastSeq(engine);
    await engine.tick();
    const [second] = chatter(engine, from).filter((e) => e.location_id === 'loc_plaza');
    expect((second!.payload['chatter'] as { text: string }).text).not.toBe('¿Os habéis enterado de lo del herrero?');
    // Con Leodhin delante, la gente le señala (reacción a lo que ha hecho) antes que el rumor.
    put('sp_pl_pozo', leo);
    time.advanceGame(Math.max(CHATTER_GAP_S, LISTENER_GAP_S));
    from = lastSeq(engine);
    await engine.tick();
    expect(chatter(engine, from).filter((e) => e.location_id === 'loc_plaza').map((e) => (e.payload['chatter'] as { kind: string; text: string }))).toEqual([expect.objectContaining({ kind: 'reaction', text: expect.stringMatching(/^Ese es (Leodhin|el forastero)… el que mató al herrero|^Ahí va (Leodhin|el forastero)/) })]);
  });

  it('quien no lo sabe no lo comenta: con solo Doro en la plaza (aún sin enterarse), silencio', async () => {
    const { engine, time, leo, brenna, garran, doro } = await laBarra();
    await matarAHugo(engine, leo);
    const mira = await newPc(engine, 'Mira');
    put('sp_pl_porton', mira);
    hold(engine, brenna, 'sp_tab_barra');
    leo.wanted = null;
    hold(engine, garran, 'sp_ca_despacho');
    hold(engine, doro, 'sp_pl_porton');
    for (const id of ['npc_ursula', 'npc_mateo', 'npc_tobias', 'npc_ilse', 'npc_hal', 'npc_osric', 'npc_ysolde']) hold(engine, engine.world.npc(id), 'sp_mo_muelas');
    time.advanceGame(CHATTER_GAP_S);
    const from = lastSeq(engine);
    await engine.tick();
    expect(chatter(engine, from).filter((e) => (e.payload['chatter'] as { kind: string }).kind === 'rumor')).toHaveLength(0);
  });
});

describe('Ceniza vuelve a casa (Brezal)', () => {
  async function devolverCeniza() {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Aren', { class_id: 'ranger', background_id: 'folk-hero' });
    const mira = await newPc(engine, 'Mira');
    put('sp_cl_piedra', mira);
    const brenna = engine.world.npc('npc_brenna');
    hold(engine, brenna, 'sp_tab_barra');
    put('sp_tab_barra', c);
    await engine.tick();
    const st = characterStory(c);
    st.open.push('q_perro');
    st.steps.push('q_perro/rastro', 'q_perro/lobera', 'q_perro/sacar');
    const from = lastSeq(engine);
    brenna.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c) };
    await engine.tick();
    return { engine, time, c, mira, brenna, from };
  }

  it('Brenna +10 (y por eso amistosa), etiqueta «salvó a Ceniza» y el hecho consultable', async () => {
    const { engine, c, mira, brenna, from } = await devolverCeniza();
    expect(characterStory(c).done).toContain('q_perro');
    expect(opinionOf(brenna, c.id)).toBe(10);
    expect(brenna.attitude.by_character[c.id]).toBe('friendly');
    // Cada PJ, su opinión: Mira no estaba.
    expect(opinionOf(brenna, mira.id)).toBe(0);
    expect(tagsOf(engine.world, c).find((t) => t.id === 'salvo_ceniza')).toMatchObject({ label: 'salvó a Ceniza', why: 'le devolvió el perro a Brenna' });
    expect(since(engine, from).some((e) => e.actor_id === c.id && /🏷 Etiqueta nueva: «salvó a Ceniza»/.test(e.narration_private))).toBe(true);
    // Consecuencias que vuelven: un hecho que los datos consultan después.
    expect(hasFact(engine.world, 'ceniza_salvado')).toBe(true);
    expect(holds(engine.world, mira, { kind: 'fact', id: 'ceniza_salvado' })).toBe(true);
    expect(holds(engine.world, c, { kind: 'tag', tag: 'salvo_ceniza' })).toBe(true);
    expect(holds(engine.world, mira, { kind: 'tag', tag: 'salvo_ceniza' })).toBe(false);
    expect(holds(engine.world, c, { kind: 'opinion', npc_id: 'npc_brenna', at_least: 10 })).toBe(true);
    expect(factById(engine.world, 'ceniza_salvado')!.text).toBe('Aren sacó a Ceniza de la madriguera de la loba y se lo devolvió a Brenna');
    // Para el máster: la opinión, el tema y la reacción a la etiqueta.
    const ctx = actionContext(engine, c, 'Le pido otra jarra');
    expect(ctx).toMatch(/Opinión de Aren: \+10 \(\+10 nos devolvió a Ceniza\)\. CD social -2 \(ya la suma el servidor: pon la CD base\); precios −10 %; le trata con confianza\./);
    expect(ctx).toMatch(/Tiene en la cabeza: Ceniza ha vuelto/);
    expect(ctx).toMatch(/salvó a Ceniza → le sirve sin cobrar/);
    expect(trustLevel(engine.world, 'npc_brenna', c.id)).toBe(2);
    expect(trustLevel(engine.world, 'npc_brenna', mira.id)).toBe(1);
  });

  it('la gente lo comenta en el Jabalí, y con Aren delante le señalan', async () => {
    const { engine, time, c, brenna } = await devolverCeniza();
    brenna.talking_to = null;
    time.advanceGame(CHATTER_GAP_S);
    const from = lastSeq(engine);
    await engine.tick();
    const lines = chatter(engine, from).map((e) => e.payload['chatter'] as { kind: string; text: string });
    expect(lines).toEqual([expect.objectContaining({ kind: 'reaction', text: 'Ese es Aren, el que trajo a Ceniza. Invítale a algo, hombre.' })]);
    void c;
  });

  it('el precio, la CD social y el nivel de confianza salen de la opinión', async () => {
    const { engine, c, brenna } = await devolverCeniza();
    const beer = brenna.sells[0]!;
    const before = c.coins;
    const r = buyFromNpc(engine.world, c, 'npc_brenna', beer.item_id, 1);
    expect(r.ok).toBe(true);
    expect(before - c.coins).toBe(priceFor(brenna, c.id, beer.price, 'buy'));
    expect(socialDcShift(brenna, c.id)).toBe(-2);
    // El máster pide Persuasión CD 15 con Brenna: el servidor la deja en 13.
    const ctx = ctxFor(engine, c);
    expect(tool(ctx, 'log_event', close({ narration_private: 'Brenna te escucha.', requires_roll_kind: 'skill', requires_roll_key: 'persuasion', requires_roll_dc: 15, requires_roll_advantage: 'none', npc_id: 'npc_brenna' })).error).toBeUndefined();
    expect(ctx.closed?.requires_roll).toMatchObject({ key: 'persuasion', dc: 13 });
  });
});

describe('opinión: umbrales, actitud y trato', () => {
  it('cada umbral mueve la actitud un paso desde la que haya, sin pisar lo que puso otro sistema', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Aren');
    const w = engine.world;
    const hal = w.npc('npc_hal');
    const now = engine.gameNow();
    expect(changeOpinion(w, hal, c, 5, 'le ayudó', now)!.attitude).toBeNull();
    expect(changeOpinion(w, hal, c, 5, 'le ayudó otra vez', now)!.attitude).toEqual({ from: 'neutral', to: 'friendly' });
    expect(changeOpinion(w, hal, c, -10, 'le mintió', now)!.attitude).toEqual({ from: 'friendly', to: 'neutral' });
    // Lo puso hostil el crimen: bajar la opinión no lo «arregla» a receloso.
    hal.attitude.by_character[c.id] = 'hostile';
    changeOpinion(w, hal, c, -10, 'le robó', now);
    expect(hal.attitude.by_character[c.id]).toBe('hostile');
    expect(trustLevel(w, 'npc_hal', c.id)).toBe(0);
  });

  it('por debajo de −30 no le vende; por debajo de −50 no quiere ni hablar', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Aren');
    const w = engine.world;
    const brenna = w.npc('npc_brenna');
    for (let i = 0; i < 3; i++) changeOpinion(w, brenna, c, -10, 'le insultó', engine.gameNow());
    expect(refusesService(w, brenna, c)).toMatch(/no quiere tratos con Aren: no le soporta|es hostil con Aren/);
    for (let i = 0; i < 2; i++) changeOpinion(w, brenna, c, -10, 'le insultó otra vez', engine.gameNow());
    put('sp_tab_barra', c);
    hold(engine, brenna, 'sp_tab_barra');
    expect(actionContext(engine, c, 'Hola')).toMatch(/NO QUIERE HABLAR con el actor: se da la vuelta y se va/);
  });
});

describe('etiquetas del PJ', () => {
  it('raza, clase y trasfondo; los NPC reaccionan según sus datos y abren una opción con tirada', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Brann', { class_id: 'fighter', race_id: 'dwarf', background_id: 'soldier' });
    expect(tagsOf(engine.world, c).map((t) => [t.id, t.label])).toEqual([['raza:dwarf', 'enano'], ['clase:fighter', 'guerrero'], ['trasfondo:soldier', 'soldado']]);
    const doro = engine.world.npc('npc_doro');
    hold(engine, doro, 'sp_pl_porton');
    // Lejos, Doro no sabe que es soldado.
    put('sp_tab_barra', c);
    await engine.tick();
    expect(opinionOf(doro, c.id)).toBe(0);
    put('sp_pl_porton', c);
    await engine.tick();
    expect(opinionOf(doro, c.id)).toBe(5);
    await engine.tick();
    expect(opinionOf(doro, c.id)).toBe(5); // una sola vez
    expect(tagOptions(engine.world, c, (k) => SKILLS[k]?.es ?? k)).toEqual(['[Soldado] Hablarle de tú a tú, entre soldados (Persuasión CD 12)']);
    // El botón sale al cerrar el turno del máster (si no pide tirada).
    const ctx = ctxFor(engine, c);
    expect(tool(ctx, 'log_event', close({ narration_private: 'El guardia te mira.', suggested_actions: 'Saludar | Seguir', npc_id: 'npc_doro' })).error).toBeUndefined();
    expect(ctx.closed?.suggested_actions).toEqual(['Saludar', 'Seguir', '[Soldado] Hablarle de tú a tú, entre soldados (Persuasión CD 12)']);
  });
});

describe('el motor de reglas no sabe de ninguna campaña (semilla demo con reglas inventadas)', () => {
  it('un objeto que cambia de manos apunta un hecho y da opinión a quien lo vio; una vez por evento', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const w = engine.world;
    const c = await newPc(engine, 'Aren');
    const npc = [...w.npcs.values()].find((n) => n.status === 'alive' && n.stats)!;
    const camp = w.campaign as typeof w.campaign & { reactions?: WorldRule[] };
    camp.reactions = [{
      id: 'regalo', when: { on: 'item', to_npc: npc.id, from: 'character' },
      then: [{ kind: 'opinion', npc_id: npc.id, delta: 5, why: 'le regaló {item}' }, { kind: 'fact', id: 'regalo_hecho', text: '{pc} le regaló {item} a {npc}' }],
    }];
    put(npc.location.id, c);
    await engine.tick();
    const inst = w.itemsCarriedBy(c.id)[0]!;
    inst.location = { type: 'npc', id: npc.id };
    tickWorld(w, engine.gameNow());
    expect(opinionOf(npc, c.id)).toBe(5);
    expect(factById(w, 'regalo_hecho')!.text).toBe(`Aren le regaló ${w.itemDef(inst.item_id).name} a ${npc.name}`);
    tickWorld(w, engine.gameNow());
    expect(opinionOf(npc, c.id)).toBe(5);
  });

  it('`state`: una condición que pasa a cumplirse salta una vez por PJ; `day` y `rest` también son eventos', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const w = engine.world;
    const c = await newPc(engine, 'Aren');
    const npc = [...w.npcs.values()].find((n) => n.status === 'alive')!;
    const camp = w.campaign as typeof w.campaign & { reactions?: WorldRule[] };
    camp.reactions = [
      { id: 'conoce', when: { on: 'state', cond: { kind: 'knows', npc_id: npc.id } }, then: [{ kind: 'topic', npc_id: npc.id, text: 'Le cae bien {pc}' }] },
      { id: 'amanece', when: { on: 'day' }, then: [{ kind: 'fact', id: 'amanecio' }] },
      { id: 'descansa', when: { on: 'rest' }, then: [{ kind: 'tag', tag: 'dormilon', why: 'durmió' }] },
    ];
    await engine.tick();
    c.knows.push(npc.id);
    tickWorld(w, engine.gameNow());
    expect(topicsOf(w, npc.id, engine.gameNow()).map((t) => t.text)).toEqual(['Le cae bien Aren']);
    c.rest = { hit_dice_used: 0, used: {}, last_long_rest_game_s: engine.gameNow() };
    tickWorld(w, engine.gameNow());
    expect(tagsOf(w, c).some((t) => t.id === 'dormilon')).toBe(true);
    tickWorld(w, engine.gameNow() + 24 * 3600);
    expect(hasFact(w, 'amanecio')).toBe(true);
  });

  it('la noticia corre con retraso, nunca por adivinación', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const w = engine.world;
    const c = await newPc(engine, 'Aren');
    const [a, b] = [...w.npcs.values()].filter((n) => n.status === 'alive').slice(0, 2) as [Npc, Npc];
    const camp = w.campaign as typeof w.campaign & { reactions?: WorldRule[] };
    camp.reactions = [
      { id: 'semilla', when: { on: 'item', to_npc: a.id }, then: [{ kind: 'fact', id: 'gesto', text: '{pc} le dio algo a {npc}' }] },
      { id: 'gesto', when: { on: 'fact', id: 'gesto' }, then: [{ kind: 'opinion', npc_id: b.id, delta: 10, why: 'fue generoso con {npc}' }] },
    ];
    put(a.location.id, c);
    await engine.tick();
    // A partir de aquí, sin agenda: b está en otro sitio y a, delante.
    const spotB = [...w.spots.values()].find((s) => s.location_id !== w.spot(a.location.id).location_id)!;
    b.location = { type: 'spot', id: spotB.id };
    const t0 = engine.gameNow();
    w.itemsCarriedBy(c.id)[0]!.location = { type: 'npc', id: a.id };
    tickWorld(w, t0);
    expect(factById(w, 'gesto')!.knowers.map((k) => k.npc_id)).toContain(a.id);
    expect(opinionOf(b, c.id)).toBe(0);
    // b llega donde está a, pero recién enterado nadie lo cuenta aún.
    b.location = { type: 'spot', id: a.location.id };
    tickWorld(w, t0 + 60);
    expect(opinionOf(b, c.id)).toBe(0);
    tickWorld(w, t0 + TELL_DELAY_S + 60);
    expect(opinionOf(b, c.id)).toBe(10);
    expect(factById(w, 'gesto')!.knowers.find((k) => k.npc_id === b.id)).toMatchObject({ how: 'told', from: a.id });
  });

  it('`lead`: una regla abre o cierra una pista de una misión (Brezal, regla inventada)', async () => {
    const { engine } = await boot();
    const w = engine.world;
    const c = await newPc(engine, 'Aren');
    const q = storyOf(w)!.quests.find((x) => x.id === 'q_perro')!;
    characterStory(c).open.push('q_perro');
    await engine.tick();
    expect(currentStep(c, q)!.id).toBe('rastro');
    const camp = w.campaign as typeof w.campaign & { reactions?: WorldRule[] };
    camp.reactions = [{ id: 'atajo', when: { on: 'state', cond: { kind: 'knows', npc_id: 'npc_hal' } }, then: [
      { kind: 'lead', quest_id: 'q_perro', step_id: 'rastro', open: false },
      { kind: 'lead', quest_id: 'q_perro', step_id: 'lobera', open: true },
    ] }];
    c.knows.push('npc_hal');
    tickWorld(w, engine.gameNow());
    expect(stepVisible(w, c, q, q.steps[0]!)).toBe(false);
    expect(stepVisible(w, c, q, q.steps[1]!)).toBe(true);
    expect(currentStep(c, q)!.id).toBe('lobera');
  });

  it('validación: opinión de ±1/5/10, referencias y etiquetas declaradas', () => {
    const has = { spot: () => true, location: () => true, npc: (id: string) => id === 'n1', item: () => true, clue: () => true, job: () => true, exit: () => true, quest: () => false, escalation: () => false, tag: (id: string) => id === 't1' };
    const ids = { quests: new Set<string>(), escalations: new Set<string>() };
    const errs = validateReactions([
      { id: 'a', when: { on: 'npc_status', npc_id: 'nX', status: 'dead' }, then: [{ kind: 'opinion', npc_id: 'n1', delta: 7, why: 'x' }] },
      { id: 'b', when: { on: 'tag', tag: 'tZ' }, then: [{ kind: 'tag', tag: 't1' }] },
      { id: 'b', when: { on: 'quest', quest_id: 'q', event: 'done' }, then: [] },
    ], has, ids);
    expect(errs).toEqual(expect.arrayContaining([
      'regla a: el NPC nX no existe.', 'regla a: la opinión cambia ±1, ±5 o ±10 (no 7).', 'regla b: la etiqueta tZ no está en campaign.tags.',
      'regla b: repetida.', 'regla b: la misión q no existe.', 'regla b: sin efectos.',
    ]));
  });

  it('lo de antes se lee como reglas (sin ejecutarlo dos veces): la tabla junta las de los datos y las traducidas', async () => {
    const legacy = legacyRules(STORY);
    expect(legacy.find((r) => r.id === 'q_perro/sacar:on_done')).toMatchObject({ when: { on: 'quest', quest_id: 'q_perro', event: 'step', step_id: 'sacar' }, legacy: true });
    expect(legacy.some((r) => r.when.on === 'milestone')).toBe(true);
    const { engine } = await boot();
    const table = reactionsTable(engine.world);
    expect(table.some((r) => r.id === 'ceniza_vuelve' && !r.legacy)).toBe(true);
    expect(table.some((r) => r.id === 'q_perro:on_complete' && r.legacy)).toBe(true);
  });
});

describe('comentarios: límites', () => {
  it('una tanda con su máximo al día; quien no tiene a nadie que la diga, calla', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const w = engine.world;
    const c = await newPc(engine, 'Aren');
    const npc = [...w.npcs.values()].find((n) => n.status === 'alive')!;
    put(npc.location.id, c);
    const loc = w.spot(npc.location.id).location_id;
    const now = engine.gameNow();
    addChatter(w, { id: 'x', kind: 'daily', texts: ['Uno', 'Dos', 'Tres'], location_ids: [loc], npc_ids: [npc.id], fact_id: null, about: null, subject: null, vars: {}, from_game_s: now, until_game_s: now + 86400, per_day: 2 });
    const said: string[] = [];
    for (let i = 0; i < 4; i++) said.push(...tickChatter(w, now + i * (CHATTER_GAP_S + LISTENER_GAP_S)).map((l) => l.text));
    expect(said.filter((t) => ['Uno', 'Dos', 'Tres'].includes(t))).toHaveLength(2);
    npc.status = 'dead';
    expect(tickChatter(w, now + 10 * 86400).length).toBe(0);
  });
});

describe('comentarios sin plantillas: el escritor barato', () => {
  it('limpia lo que devuelve el modelo (viñetas, comillas, frases largas)', () => {
    expect(parseChatterLines(['- «¿Habéis visto al forastero?»', '2) Dicen que {pc} es de fiar', '', 'x'.repeat(200)].join('\n'))).toEqual(['¿Habéis visto al forastero?', 'Dicen que {pc} es de fiar']);
  });

  it('una tanda con prompt se escribe una sola vez y luego se dice como las demás', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const w = engine.world;
    const c = await newPc(engine, 'Aren');
    const npc = [...w.npcs.values()].find((n) => n.status === 'alive')!;
    put(npc.location.id, c);
    let calls = 0;
    engine.attachChatterWriter(chatterWriter({ create: async (p) => { calls++; expect(p.model).toBe('claude-haiku-5-5'); return { content: [{ type: 'text', text: ['Qué frío hace hoy', 'Otra vez niebla'].join('\n') }] }; } }));
    const now = engine.gameNow();
    addChatter(w, { id: 'ia', kind: 'daily', texts: [], prompt: 'El tiempo en el pueblo.', location_ids: [w.spot(npc.location.id).location_id], npc_ids: [npc.id], fact_id: null, about: null, subject: null, vars: {}, from_game_s: now, until_game_s: now + 86400, per_day: 3 });
    await engine.tick();
    await engine.settle(1000);
    await engine.tick();
    expect(calls).toBe(1);
    expect(chatterSets(w).find((x) => x.id === 'ia')!.texts).toEqual(['Qué frío hace hoy', 'Otra vez niebla']);
  });
});
