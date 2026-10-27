/**
 * Crimen, testigos y reacción del mundo (crime.ts). Sale de la partida del
 * 27-10-2026 (Obsidian, «Revisión partida 2026-10-27», §3 y fallos 12 y 13,
 * plan C): Leodhin mata a Hugo en la barra del Jabalí delante de Brenna,
 * Garrán y la cena (seq 72–98), y no pasa nada. Aquí, lo que el motor
 * garantiza ahora, con Brezal y sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { offlineLogEvent } from '../src/ai/offline.js';
import { seededRng } from '../src/engine/dice.js';
import { allIncidents, enforcerIds, knownBy, lawKnowsWhere, readsAsResisting, parseDesecration, parseSurrender } from '../src/engine/crime.js';
import { encounterAt } from '../src/engine/encounter.js';
import { moveTo } from '../src/engine/movement.js';
import { orderOf, setNpcOrder } from '../src/engine/npcorders.js';
import { planRest } from '../src/engine/rest.js';
import { allRumors } from '../src/engine/rumors.js';
import { World } from '../src/engine/world.js';
import { makeSeed } from '../src/data/seed/demo.js';
import type { Character, GameEvent, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

/** El mundo nace a las 18:00 del día 0; la cena del Jabalí empieza a las 19:00. */
const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  return { engine, time };
}

async function newPc(engine: Engine, name: string, class_id = 'wizard'): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id });
  if (!r.ok) throw new Error(r.reason);
  return r.character;
}

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

const since = (engine: Engine, seq: number): GameEvent[] => engine.events.all().filter((e) => e.seq > seq);
const lastSeq = (engine: Engine) => engine.events.all().at(-1)?.seq ?? 0;

/** Pone a cada uno en su punto y le quita la orden que tuviera (la apertura retiene a alguno). */
function put(engine: Engine, spotId: string, ...who: (Character | Npc)[]): void {
  for (const x of who) {
    x.location = { type: 'spot', id: spotId };
    delete (x as Npc & { order?: unknown }).order;
  }
}

/** Lo retiene allí (orden stay) para que su horario no se lo lleve durante el test. */
function hold(engine: Engine, n: Npc, spotId: string): void {
  n.location = { type: 'spot', id: spotId };
  expect(setNpcOrder(engine.world, { npc_id: n.id, order: 'go', spot_id: spotId, minutes: 600 }, engine.gameNow()).ok).toBe(true);
}

/** La escena de la partida: las 19:20, la cena llena, Hugo cenando en la barra con Brenna y Garrán delante. */
async function laBarra() {
  const { engine, time } = await boot();
  time.advanceGame(80 * 60);
  await engine.tick();
  const leo = await newPc(engine, 'Leodhin');
  const [hugo, brenna, garran, doro] = ['npc_hugo', 'npc_brenna', 'npc_garran', 'npc_doro'].map((id) => engine.world.npc(id));
  put(engine, 'sp_tab_barra', leo);
  for (const n of [hugo!, brenna!, garran!]) hold(engine, n, 'sp_tab_barra');
  hold(engine, doro!, 'sp_pl_porton');
  // Conoce a Brenna; a Hugo y a Garrán, no (como en la partida).
  leo.knows.push('npc_brenna');
  return { engine, time, leo, hugo: hugo!, brenna: brenna!, garran: garran!, doro: doro! };
}

describe('Leodhin mata a Hugo en la barra del Jabalí (partida del 27-10, seq 72–98)', () => {
  it('el primer golpe ya es una agresión con testigos: Hugo se defiende, Brenna no le atiende y Garrán le da el alto', async () => {
    const { engine, leo } = await laBarra();
    // seq 72-73: «luchar con hugo». Hugo no era hostil.
    tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    const [inc] = allIncidents(engine.world);
    expect(inc).toMatchObject({ perpetrator_id: leo.id, victim_id: 'npc_hugo', location_id: 'loc_taberna', spot_id: 'sp_tab_barra' });
    expect(['assault', 'armed_assault']).toContain(inc!.kind);
    // La cena: la gente sin nombre también lo ha visto.
    expect(inc!.crowd).toMatch(/diez vecinos/);
    expect(Object.fromEntries(inc!.knowers.map((k) => [k.npc_id, [k.role, k.response]]))).toMatchObject({
      npc_hugo: ['victim', 'fight'], npc_brenna: ['owner', 'refuse'], npc_garran: ['authority', 'arrest'],
    });
    // Buscado, con su motivo, y detenido en el acto.
    expect(leo.wanted?.reason).toMatch(/Hugo .*en la barra \(Taberna del Jabalí\)$/);
    expect(leo.conditions.find((c) => c.name === 'buscado')).toBeTruthy();
    expect(leo.wanted?.arrest).toMatchObject({ npc_id: 'npc_garran', resisted: false });
  });

  it('el Proyectil mágico que lo mata es suyo: muerte, sin PX, con infamia y reputación −5; el motor cuenta muerte, reacción y alto, en ese orden', async () => {
    const { engine, leo, hugo, brenna } = await laBarra();
    const xp0 = leo.xp;
    const rep0 = leo.reputation['fac_brezal'] ?? 0;
    const from = lastSeq(engine);
    tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    // seq 76-80: el máster aplica el daño del conjuro con apply_damage.
    const kill = tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    expect(kill).toMatchObject({ died: true, murder: true });
    expect(hugo.death).toMatchObject({ by_id: leo.id });
    // Lo que el servidor ya ha decidido, para que la narración lo cuente (sin soltar nombres que Leodhin no sabe).
    expect(kill.incident).toMatch(/El alguacil se planta delante de ti: «¡Alto! Quedas detenido\.»/);
    expect(kill.incident).not.toMatch(/Garrán/);

    const [inc] = allIncidents(engine.world);
    expect(allIncidents(engine.world)).toHaveLength(1);
    expect(inc).toMatchObject({ kind: 'murder', severity: 5 });
    expect(leo.xp).toBe(xp0);
    expect(leo.infamy).toBe(1);
    expect(leo.reputation['fac_brezal']).toBe(rep0 - 5);
    expect(leo.conditions.find((c) => c.name === 'buscado')?.source).toBe('mató a Hugo en la barra (Taberna del Jabalí)');
    // Brenna lo recuerda una sola vez, aunque la muerte también lo apunte.
    await engine.tick();
    expect(brenna.memory.filter((m) => m.character_id === leo.id && /Leodhin mataba a Hugo/.test(m.note))).toHaveLength(1);

    const law = since(engine, from).filter((e) => ['npc_death', 'incident', 'arrest'].includes(e.action_type));
    expect(law.map((e) => e.action_type)).toEqual(['npc_death', 'incident', 'arrest']);
    const [death, incident, arrest] = law as [GameEvent, GameEvent, GameEvent];
    // La muerte ya no dice que «se quedan mirando el cuerpo»: la reacción va en el incidente.
    expect(death.observable).not.toMatch(/se quedan mirando|se apartan/);
    expect(incident.observable).toMatch(/^⚖ Lo han visto: Leodhin mató a Hugo\./);
    expect(incident.observable).toMatch(/Garrán se planta delante de Leodhin: «¡Alto! Quedas detenido\.»/);
    expect(incident.observable).toMatch(/Brenna retrocede sin quitarle ojo: no piensa atender a Leodhin\./);
    expect(incident.observable).toMatch(/Unos diez vecinos gritan y se apartan/);
    // Para él, con los nombres que sabe: no sabe cómo se llaman el herrero ni el alguacil.
    expect(incident.payload['observable_target']).toMatch(/^⚖ Te han visto: has matado al herrero\. El alguacil se planta delante de ti.*Desde ahora te buscan\./);
    expect(arrest.narration_private).toMatch(/^El alguacil se te planta delante: .*Te acusa de esto: Leodhin mató al herrero en la barra/);
    expect(arrest.narration_private).not.toMatch(/Garrán|Hugo/);
    expect(arrest.actor_id).toBe(leo.id);
    expect(arrest.payload['suggested_actions']).toEqual(['Entregarme', 'Resistirme', 'Huir']);
    expect(arrest.narration_private).toMatch(/24 h de calabozo/);
  });

  it('el máster no puede ignorarlo: «se le paró el corazón» se rechaza; contado, pasa y no se vuelve a exigir', async () => {
    const { engine, leo } = await laBarra();
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 5, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    const [inc] = allIncidents(engine.world);
    expect(inc!.kind).toBe('murder');

    // El contexto pone el incidente pendiente y, en cada testigo, lo que vio antes que su carácter.
    const context = actionContext(engine, leo, 'Preguntar a la tabernera por el herrero');
    expect(context).toMatch(/## Incidente pendiente: cuéntalo en esta narración/);
    expect(context).toMatch(/Cuéntalo así \(hechos\): .*El alguacil se planta delante de ti/);
    expect(context).toMatch(/- NPC Brenna \[npc_brenna\], tabernera, en la barra, 0 m\.\n {2}LO PRIMERO, antes que su carácter: vio cómo Leodhin mataba al herrero \(la barra, ahora mismo\) y le tiene miedo: no le atiende con normalidad/);
    expect(context).toMatch(/## Ley\nEl actor está BUSCADO: mató a Hugo en la barra \(Taberna del Jabalí\)\./);
    expect(context).toMatch(/le está DETENIENDO: si se entrega/);
    // get_npc también lo pone primero.
    expect(tool(ctxFor(engine, leo), 'get_npc', { npc_id: 'npc_brenna' }).first_of_all).toMatch(/^LO PRIMERO/);

    // seq 95: Brenna lo niega y nadie reacciona → se rechaza (dos veces como mucho).
    const ctx = ctxFor(engine, leo);
    const bad = tool(ctx, 'log_event', close({ npc_id: 'npc_brenna', narration_private: 'La tabernera sigue secando la jarra. «El corazón se le paró. Pasa con los que cargan hierro.»' }));
    expect(bad.error).toMatch(/Tu narración lo ignora: falta el alguacil/);
    expect(bad.error).toMatch(/Cuéntalo así|sin contradecirlo/);
    expect(inc!.narrated_to).toEqual([]);
    const good = tool(ctx, 'log_event', close({ narration_private: 'El alguacil se levanta de la banqueta con la mano en la porra: «¡Alto!». La tabernera retrocede tras la barra.' }));
    expect(good.ok).toBe(true);
    expect(inc!.narrated_to).toEqual([leo.id]);
    // Contado: ya no se exige ni sale como pendiente.
    expect(actionContext(engine, leo, 'mirar')).not.toMatch(/## Incidente pendiente/);
    expect(actionContext(engine, leo, 'mirar')).toMatch(/## Incidentes recientes aquí \(ya contados\)/);
    expect(tool(ctxFor(engine, leo), 'log_event', close({ narration_private: 'Miras la sala.' })).ok).toBe(true);
  });

  it('el máster offline cuenta la reacción tal como la da el contexto', async () => {
    const { engine, leo } = await laBarra();
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    const out = offlineLogEvent(actionContext(engine, leo, 'mirar alrededor'));
    expect(out['narration_private']).toMatch(/El alguacil se planta delante de ti/);
    expect(tool(ctxFor(engine, leo), 'log_event', close({ narration_private: out['narration_private'] })).ok).toBe(true);
  });

  it('seq 96-98: Brenna no le alquila la habitación y no puede dormir con un alto encima', async () => {
    const { engine, leo } = await laBarra();
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    const coins = leo.coins;
    const room = tool(ctxFor(engine, leo), 'buy_item', { character_id: leo.id, npc_id: 'npc_brenna', item_id: 'it_noche_posada', quantity: 1 });
    expect(room.error).toMatch(/Brenna no quiere tratos con Leodhin: sabe que mató a Hugo/);
    expect(leo.coins).toBe(coins);
    const sleep = await engine.act(leo.id, 'dormir');
    expect(sleep).toMatchObject({ ok: false, text: expect.stringMatching(/Te están deteniendo/) });
  });

  it('se entrega: 24 h de calabozo en la casona; ya no le buscan, pero no puede salir y nadie lo olvida', async () => {
    const { engine, leo, brenna } = await laBarra();
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    await engine.tick();
    expect(parseSurrender('Me entrego')).toBe(true);
    const r = await engine.act(leo.id, 'me entrego');
    expect(r.text).toMatch(/te lleva a el calabozo|te lleva al calabozo|te lleva a .*calabozo/);
    expect(leo.location.id).toBe('sp_ca_calabozo');
    expect(leo.jailed).toMatchObject({ spot_id: 'sp_ca_calabozo' });
    expect(leo.jailed!.until_game_s - engine.nowFor(leo)).toBeGreaterThan(23 * 3600);
    expect(leo.wanted).toBeNull();
    expect(leo.conditions.map((c) => c.name)).toEqual(expect.arrayContaining(['preso']));
    expect(leo.conditions.map((c) => c.name)).not.toContain('buscado');
    expect(allIncidents(engine.world)[0]!.status).toBe('settled');
    expect(moveTo(engine.world, leo.id, 'sp_ca_puerta', 'walk', engine.nowFor(leo))).toMatchObject({ ok: false, error: { code: 'cannot_move' } });
    // Brenna lo sigue sabiendo y sigue sin atenderle.
    expect(knownBy(engine.world, brenna.id, leo.id)?.knower.stance).toBe('afraid');
  });

  it('se resiste: Garrán pasa a hostil y entra en el combate', async () => {
    const { engine, leo } = await laBarra();
    tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    await engine.tick();
    expect(readsAsResisting('le lanzo un proyectil mágico al alguacil')).toBe(true);
    const r = await engine.act(leo.id, 'me resisto');
    expect(r.text).toMatch(/No te entregas/);
    const garran = engine.world.npc('npc_garran');
    expect(garran.attitude.by_character[leo.id]).toBe('hostile');
    expect(leo.wanted?.arrest?.resisted).toBe(true);
    const enc = encounterAt(engine.world, engine.events.recentInLocation('loc_taberna', 100), 'loc_taberna', engine.gameNow());
    expect(enc?.fighters.map((f) => f.id)).toContain('npc_garran');
    // Si le tumba, al calabozo (vivo).
    leo.hp_current = 1;
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: leo.id, amount: 3, damage_type: 'bludgeoning', source: 'porra de Garrán' });
    expect(leo.status).toBe('unconscious');
    await engine.tick();
    expect(leo.location.id).toBe('sp_ca_calabozo');
    expect(leo.jailed).toBeTruthy();
    expect(since(engine, 0).some((e) => e.action_type === 'jailed' && e.actor_id === leo.id)).toBe(true);
  });

  it('seq 90-92: registrar el cadáver delante de todos es profanarlo: otro incidente, más infamia', async () => {
    const { engine, leo } = await laBarra();
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    expect(parseDesecration(engine.world, leo, 'robar las posesiones del herrero')?.id).toBe('npc_hugo');
    expect(parseDesecration(engine.world, leo, 'mirar al herrero')).toBeNull();
    await engine.act(leo.id, 'robar las posesiones del herrero');
    const des = allIncidents(engine.world).find((i) => i.kind === 'desecration');
    expect(des).toMatchObject({ victim_id: 'npc_hugo', severity: 3 });
    expect(des!.knowers.map((k) => k.npc_id)).toEqual(expect.arrayContaining(['npc_brenna', 'npc_garran']));
    expect(leo.infamy).toBe(2);
  });
});

describe('fallo 13: lo que llega después ve lo que ha pasado', () => {
  it('seq 82: el gancho escrito de antemano se adapta al incidente; Doro, que entra luego, ve el cuerpo y se entera', async () => {
    const { engine, leo, doro } = await laBarra();
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    await engine.tick();
    const hook = { id: 'hk_garran', location_id: 'loc_taberna', what: 'Garrán entra sacudiéndose la ceniza y pide cerveza sin sacar moneda.', trigger: { kind: 'location' }, for_character_id: null, created_game_s: 0, expires_game_s: null };
    (engine as unknown as { hints: Map<string, unknown> }).hints.set(leo.id, { hooks: [hook], encounter: null });
    expect(actionContext(engine, leo, '(sucede: Garrán entra)', undefined, undefined, 'hook')).toMatch(/OJO: aquí acaba de pasar algo .*la autoridad pregunta y detiene, no pide una cerveza como si nada/);
    // Doro (allegado de Hugo y autoridad) entra en la taberna: ve el cuerpo y lo sabe.
    hold(engine, doro, 'sp_tab_mesa');
    await engine.tick();
    expect(knownBy(engine.world, doro.id, leo.id)?.knower).toMatchObject({ how: 'found', role: 'authority', stance: 'outraged' });
    expect(actionContext(engine, leo, 'mirar a la guardia')).toMatch(/LO PRIMERO, antes que su carácter: llegó y vio lo que había hecho Leodhin: mató al herrero/);
  });
});

describe('la noticia corre y la autoridad viene', () => {
  it('sin autoridad delante, Úrsula corre a avisar a Garrán; Garrán se entera, le busca y le da el alto donde le vieron', async () => {
    const { engine, time } = await boot();
    const leo = await newPc(engine, 'Leodhin');
    const [hugo, brenna, garran, ursula, doro] = ['npc_hugo', 'npc_brenna', 'npc_garran', 'npc_ursula', 'npc_doro'].map((id) => engine.world.npc(id)) as Npc[];
    put(engine, 'sp_tab_barra', leo);
    for (const n of [hugo!, brenna!, ursula!]) hold(engine, n, 'sp_tab_barra');
    hold(engine, garran!, 'sp_pl_tablon');
    hold(engine, doro!, 'sp_li_barricada');
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    const [inc] = allIncidents(engine.world);
    expect(inc!.knowers.find((k) => k.npc_id === 'npc_ursula')).toMatchObject({ response: 'alert', to: 'npc_garran' });
    expect(orderOf(ursula!)).toMatchObject({ kind: 'go', spot_id: 'sp_pl_tablon' });
    // Aún no le buscan: la autoridad no lo sabe.
    expect(leo.wanted ?? null).toBeNull();
    time.advanceGame(60);
    await engine.tick();
    // Úrsula llega, se lo cuenta y Garrán ya lo sabe: buscado, y va a donde le vieron.
    expect(ursula!.location.id).toBe('sp_pl_tablon');
    expect(knownBy(engine.world, 'npc_garran', leo.id)?.knower).toMatchObject({ how: 'told', from: 'npc_ursula', role: 'authority' });
    expect(leo.wanted?.last_seen).toMatchObject({ location_id: 'loc_taberna' });
    expect(orderOf(garran!)).toMatchObject({ kind: 'go', spot_id: 'sp_tab_barra' });
    // El rumor ya corre por la plaza.
    expect(allRumors(engine.world).some((r) => r.location_id === 'loc_plaza' && /Leodhin mató a Hugo/.test(r.hint))).toBe(true);
    time.advanceGame(60);
    await engine.tick();
    expect(world(engine).spot(garran!.location.id).location_id).toBe('loc_taberna');
    expect(leo.wanted?.arrest).toMatchObject({ npc_id: 'npc_garran' });
    expect(engine.events.all().some((e) => e.action_type === 'arrest' && e.actor_id === leo.id)).toBe(true);
  });

  it('en el cuarto cerrado con su llave tampoco duerme seguro si la autoridad sabe que está ahí', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin');
    const [hugo, brenna, garran] = ['npc_hugo', 'npc_brenna', 'npc_garran'].map((id) => engine.world.npc(id)) as Npc[];
    put(engine, 'sp_tab_barra', leo);
    hold(engine, hugo!, 'sp_tab_barra'); hold(engine, brenna!, 'sp_tab_barra'); hold(engine, garran!, 'sp_pl_tablon');
    tool(ctxFor(engine, leo), 'apply_damage', { target_id: 'npc_hugo', amount: 40, damage_type: 'force', source: 'Proyectil mágico de Leodhin' });
    // Garrán se entera por la gente (sin cena no hay nadie más), lejos de aquí.
    const inc = allIncidents(engine.world)[0]!;
    engine.world.npc('npc_garran').memory.push({ character_id: leo.id, game_s: engine.gameNow(), note: 'x', importance: 1 });
    inc.knowers.push({ npc_id: 'npc_garran', how: 'told', from: null, role: 'authority', response: 'arrest', stance: 'outraged', game_s: engine.gameNow() });
    await engine.tick();
    expect(leo.wanted).toBeTruthy();
    // Sube al cuarto con su llave: Brenna, abajo, le ha visto entrar.
    const key = engine.world.itemDefs.get('it_llave_cuarto') ? 'it_llave_cuarto' : (engine.world.spot('sp_tab_habitacion').state['key_item_id'] as string);
    engine.world.itemInstances.set('ii_test_llave', { id: 'ii_test_llave', item_id: key, quantity: 1, location: { type: 'character', id: leo.id, slot: { kind: 'pocket' } }, state: {} });
    leo.location = { type: 'spot', id: 'sp_tab_habitacion' };
    await engine.tick();
    expect(lawKnowsWhere(engine.world, leo, engine.gameNow())?.id).toBe('npc_garran');
    const plan = planRest(engine.world, engine.clock, leo, 'long', engine.nowFor(leo), () => 0.99);
    expect(plan.safe).toBeNull();
    expect(plan.interruption).toMatchObject({ kind: 'law', what: expect.stringMatching(/Garrán viene a detenerle/) });
  });
});

describe('lo que no es crimen', () => {
  it('defenderse de un lobo que ataca: PX, sin incidente', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin', 'fighter');
    const lobo = engine.world.npc('npc_lobo');
    put(engine, lobo.location.id, leo);
    lobo.stats!.hp = 1;
    const xp0 = leo.xp;
    const r = tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: leo.id, target_id: 'npc_lobo', advantage: 'none' });
    expect(r).toMatchObject({ target_dead: true });
    expect(r['murder']).toBeUndefined();
    expect(leo.xp).toBeGreaterThan(xp0);
    expect(allIncidents(engine.world)).toHaveLength(0);
  });

  it('quien le ataca primero pasa a hostil: devolverle el golpe no es agresión', async () => {
    const { engine, leo } = await laBarra();
    tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: 'npc_hugo', target_id: leo.id, advantage: 'none' });
    expect(engine.world.npc('npc_hugo').attitude.by_character[leo.id]).toBe('hostile');
    tool(ctxFor(engine, leo, { rng: () => 0.99 }), 'attack', { attacker_id: leo.id, target_id: 'npc_hugo', advantage: 'none' });
    expect(allIncidents(engine.world)).toHaveLength(0);
  });

  it('un insulto a la cara: Brenna se ofende, pero nadie le busca', async () => {
    const { engine, leo, brenna } = await laBarra();
    await engine.act(leo.id, 'Brenna, qué tonta eres');
    const [inc] = allIncidents(engine.world);
    expect(inc).toMatchObject({ kind: 'insult', severity: 1, victim_id: 'npc_brenna' });
    expect(brenna.attitude.by_character[leo.id]).toBe('unfriendly');
    expect(leo.wanted ?? null).toBeNull();
    expect(engine.events.all().some((e) => e.action_type === 'incident')).toBe(false);
  });

  it('un mundo sin ley escrita deduce la autoridad por el rol (la guardia de la demo)', () => {
    const w = new World(makeSeed());
    expect(enforcerIds(w)).toContain('npc_doro');
  });
});

const world = (engine: Engine) => engine.world;
