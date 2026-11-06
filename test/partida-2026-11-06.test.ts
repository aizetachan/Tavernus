/**
 * Partida «Humo y ceniza» (VPS, 06-11): Pillin, mediano pícaro con la deuda, roba a Garrán y luego intenta cuatro
 * veces quitarle los anillos de los dedos a Osric mientras hablaban, hasta que a la cuarta le sale sin
 * consecuencias. Aquí, lo que el motor decide ahora (conflict.ts, docs/CONFLICTOS-NPC.md): si se puede, la tirada,
 * lo que pasa y cómo se lo toma el NPC según la relación (broma, careo o delito), el careo, y lo que el cierre del
 * máster ya no deja pasar. Sin API: funciones puras, tools a mano y el máster offline.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { conflictPlanFor } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import {
  conflictKindOf, conflictPlan, conflictVerdict, confrontAnswer, confrontButtons, confrontOf, confrontRolled, createItem, guardOf,
  resolveConflict, settleConfront, stolenOf,
} from '../src/engine/conflict.js';
import { allIncidents } from '../src/engine/crime.js';
import { conflictCloseProblems } from '../src/engine/closecheck.js';
import { changeOpinion } from '../src/engine/standing.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import type { Character, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(rng: () => number = () => 0.99) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng });
  const r = await engine.createCharacter('u_pillin', 'Pillin', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  const c = engine.world.character(r.character.id);
  return { engine, time, c };
}

function put(spot: string, ...who: (Character | Npc)[]): void {
  for (const x of who) { x.location = { type: 'spot', id: spot }; delete (x as Npc & { order?: unknown }).order; }
}

/** Los anillos de Osric (en la partida no estaban en los datos): los crea el motor, puestos. */
function anillos(engine: Engine) {
  const r = createItem(engine.world, engine.world.npc('npc_osric'), { name: 'anillo de plata', worn: true });
  if (!r.ok) throw new Error(r.reason);
  return r.inst;
}

const ctxFor = (engine: Engine, c: Character, text: string, extra: Partial<ToolContext> = {}): ToolContext => ({
  engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: text, ...extra,
});
type Out = Record<string, unknown> & { ok?: boolean; error?: string; hint?: string };
const tool = (ctx: ToolContext, name: string, input: Record<string, unknown>): Out => JSON.parse(executeTool(ctx, name, input)) as Out;
const close = (extra: Record<string, unknown> = {}) => ({
  narration_private: 'Lo intentas.', observable: null, observable_vague: null, loudness: 1, tags: 'conflict', suggested_actions: '',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null, ...extra,
});

describe('lo que escribe el jugador', () => {
  it('distingue hurtar, arrebatar, agarrar, empujar y tocar; preguntarlo o negarlo no cuenta', () => {
    expect(conflictKindOf('robarle los anillos de los dedos')).toBe('steal');
    expect(conflictKindOf('volve aintenarr orbarle el anillo')).toBe(null);
    expect(conflictKindOf('aprovechar que garran se ha levantado y birlar la bolsa de cuero')).toBe('steal');
    expect(conflictKindOf('le arranco la bolsa de un tirón')).toBe('snatch');
    expect(conflictKindOf('le empujo contra la barra')).toBe('shove');
    expect(conflictKindOf('le agarro del brazo')).toBe('grab');
    expect(conflictKindOf('le toco el pelo')).toBe('touch');
    expect(conflictKindOf('¿le robo la bolsa?')).toBe(null);
    expect(conflictKindOf('no le robo nada, solo miro')).toBe(null);
    expect(conflictKindOf('me han robado la bolsa')).toBe(null);
    expect(conflictKindOf('ir a hablar con garran')).toBe(null);
  });
});

describe('63-74: los anillos de Osric, hablando con él', () => {
  it('no se puede, sin tirada; el contexto lo dice y prohíbe la deuda', async () => {
    const { engine, c } = await boot();
    const osric = engine.world.npc('npc_osric');
    put('sp_pl_tablon', c, osric);
    osric.talking_to = { character_id: c.id, since_game_s: engine.gameNow() };
    anillos(engine);
    const plan = conflictPlanFor(engine, c, 'robarle los anillos de los dedos');
    expect(plan).toMatchObject({ kind: 'steal', npc_id: 'npc_osric' });
    expect(plan!.verdict).toMatchObject({ possible: false, roll: null, known_as: 'heard', relation: 'none' });
  });

  it('el cierre no deja pedir la tirada cuando no se puede', async () => {
    const { engine, c } = await boot();
    const osric = engine.world.npc('npc_osric');
    put('sp_pl_tablon', c, osric);
    osric.talking_to = { character_id: c.id, since_game_s: engine.gameNow() };
    anillos(engine);
    const text = 'robarle los anillos de los dedos';
    const ctx = ctxFor(engine, c, text, { conflict_plan: conflictPlanFor(engine, c, text) });
    const bad = tool(ctx, 'log_event', close({ requires_roll_kind: 'skill', requires_roll_key: 'sleight_of_hand', requires_roll_dc: 13, requires_roll_advantage: 'none' }));
    expect(bad.error).toMatch(/NO SE PUEDE/);
    expect(tool(ctx, 'log_event', close({ narration_private: 'El regidor tiene la mano cerrada sobre el sello y te está mirando: así no hay manera.' })).ok).toBe(true);
    expect(ctx.closed?.requires_roll).toBeNull();
  });

  it('66: si insiste, le pilla sin tirada; sin relación, es delito, y Osric le agarra de la muñeca', async () => {
    const { engine, c } = await boot();
    const osric = engine.world.npc('npc_osric');
    put('sp_pl_tablon', c, osric);
    osric.talking_to = { character_id: c.id, since_game_s: engine.gameNow() };
    const ring = anillos(engine);
    // El primer intento: el motor le dijo que no se podía (queda en el evento).
    engine.events.emit({ actor_id: c.id, action_type: 'master', input_text: 'robarle los anillos', narration_private: 'No hay manera.', observable: null, tags: ['master'], payload: { master: { calls: [], context: `## Acción conflictiva\nPillin quiere hurtar anillo a Osric Malvez [npc_osric].\nVeredicto: NO SE PUEDE, sin tirada.` } } });
    const text = 'volver a intentar robarle el anillo';
    const plan = conflictPlanFor(engine, c, text)!;
    expect(plan.verdict).toMatchObject({ possible: true, roll: null, forced: 'caught' });
    const ctx = ctxFor(engine, c, text, { conflict_plan: plan });
    const out = tool(ctx, 'conflict_act', { npc_id: 'npc_osric', kind: 'steal', instance_id: ring.id, new_item_name: null, new_item_worn: null });
    expect(out).toMatchObject({ ok: true, resolved: true });
    expect(String(out['facts'])).toMatch(/pilla/);
    const inc = allIncidents(engine.world).find((i) => i.victim_id === 'npc_osric')!;
    expect(inc.kind).toBe('theft_attempt');
    expect(inc.knowers.find((k) => k.npc_id === 'npc_osric')?.response).toBe('seize');
    expect(guardOf(osric, c.id, engine.gameNow())).not.toBeNull();
    expect(confrontOf(engine.world, c, engine.gameNow())?.c).toMatchObject({ crime: true });
    // El anillo sigue en su dedo.
    expect(engine.world.itemInstances.get(ring.id)!.location).toEqual({ type: 'npc', id: 'npc_osric' });
    // Contestar con la deuda no vale: primero la reacción.
    const bad = tool(ctx, 'log_event', close({ narration_private: 'Osric te mira.', npc_id: 'npc_osric', lines: [{ speaker: 'npc', npc_id: 'npc_osric', text: 'Ve a la taberna, que Garrán tiene tu cuenta.' }] }));
    expect(bad.error).toBeTruthy();
  });

  it('69 y 72: en guardia, ya no se puede; nunca sale a la cuarta', async () => {
    const { engine, c } = await boot();
    const osric = engine.world.npc('npc_osric');
    put('sp_pl_tablon', c, osric);
    const ring = anillos(engine);
    const v = conflictVerdict(engine.world, [], c, osric, 'steal', ring, engine.gameNow(), { insist: true })!;
    resolveConflict(engine.world, c, osric, v, null, engine.gameNow());
    // Aunque deje de hablarle y se esconda, en guardia no se le hurta (y tampoco algo de su cinto).
    osric.talking_to = null;
    c.sneak = { total: 25, game_s: engine.gameNow(), spot_id: 'sp_pl_tablon' };
    const bolsa = createItem(engine.world, osric, { name: 'bolsa de cuero', size: 'small' });
    if (!bolsa.ok) throw new Error(bolsa.reason);
    expect(conflictVerdict(engine.world, [], c, osric, 'steal', bolsa.inst, engine.gameNow())!.possible).toBe(false);
  });
});

describe('27-36: la llave del cinto de Garrán, a su espalda', () => {
  it('de punta a punta con el máster offline: el motor pone la tirada (ventaja contra su pasiva) y, si sale, la llave va a la mochila', async () => {
    const { engine, c } = await boot(() => 0.99);
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(1) }));
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    expect(setNpcOrder(engine.world, { npc_id: garran.id, order: 'go', spot_id: 'sp_tab_mesa', minutes: 600 }, engine.gameNow()).ok).toBe(true);
    c.sneak = { total: 22, game_s: engine.gameNow(), spot_id: 'sp_tab_mesa' };
    const r = await engine.act(c.id, 'le quito la llave del arcón del cinto a Garrán');
    expect(r.ok).toBe(true);
    expect(r.requires_roll).toMatchObject({ kind: 'skill', key: 'sleight_of_hand', dc: 12, advantage: 'advantage' });
    expect(r.requires_roll?.conflict?.npc_id).toBe('npc_garran');
    const done = await engine.rollPending(c.id);
    expect(done.ok).toBe(true);
    const llave = engine.world.itemInstances.get('ii_llave_arcon')!;
    expect(llave.location.type).toBe('container');
    expect(stolenOf(llave)).toMatchObject({ from_npc_id: 'npc_garran' });
    expect(allIncidents(engine.world)).toHaveLength(0);
  });

  it('con un 3, Garrán le pilla: es autoridad y no le conoce de nada bueno, así que le da el alto', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    c.sneak = { total: 22, game_s: engine.gameNow(), spot_id: 'sp_tab_mesa' };
    const v = conflictVerdict(engine.world, [], c, garran, 'steal', engine.world.itemInstances.get('ii_llave_arcon')!, engine.gameNow())!;
    const res = resolveConflict(engine.world, c, garran, v, { total: 3, natural: null, npc_total: null }, engine.gameNow());
    expect(res.response).toBe('crime');
    expect(res.incident?.kind).toBe('theft_attempt');
    expect(c.wanted?.arrest?.npc_id).toBe('npc_garran');
  });

  it('con un 8 (por 4), casi: se palpa y queda en guardia, sin incidente', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    c.sneak = { total: 22, game_s: engine.gameNow(), spot_id: 'sp_tab_mesa' };
    const v = conflictVerdict(engine.world, [], c, garran, 'steal', engine.world.itemInstances.get('ii_llave_arcon')!, engine.gameNow())!;
    const res = resolveConflict(engine.world, c, garran, v, { total: 8, natural: null, npc_total: null }, engine.gameNow());
    expect(res.response).toBe('near_miss');
    expect(allIncidents(engine.world)).toHaveLength(0);
    expect(guardOf(garran, c.id, engine.gameNow())).not.toBeNull();
  });
});

describe('la relación decide: broma, reproche, careo o delito', () => {
  it('íntima: le arranca la jarra a Brenna y se lo toma a broma; se la quita de vuelta; a la segunda ya no', async () => {
    const { engine, c } = await boot();
    const brenna = engine.world.npc('npc_brenna');
    put('sp_tab_barra', c, brenna);
    for (let i = 0; i < 5; i++) changeOpinion(engine.world, brenna, c, 10, 'le ayudó', engine.gameNow());
    const jarra = createItem(engine.world, brenna, { name: 'jarra con muesca', size: 'small', in_hand: true });
    if (!jarra.ok) throw new Error(jarra.reason);
    const v = conflictVerdict(engine.world, [], c, brenna, 'snatch', jarra.inst, engine.gameNow())!;
    expect(v.relation).toBe('intimate');
    const res = resolveConflict(engine.world, c, brenna, v, { total: 20, natural: null, npc_total: 5 }, engine.gameNow());
    expect(res.response).toBe('joke');
    expect(res.returned).toBe(true);
    expect(engine.world.itemInstances.get(jarra.inst.id)!.location).toEqual({ type: 'npc', id: 'npc_brenna' });
    const again = resolveConflict(engine.world, c, brenna, conflictVerdict(engine.world, [], c, brenna, 'shove', null, engine.gameNow())!, { total: 20, natural: null, npc_total: 5 }, engine.gameNow());
    expect(again.response).toBe('reproach');
  });

  it('conocidos: empuja a Hugo y hay careo (CD 12); disculparse lo deja en un aviso', async () => {
    const { engine, c } = await boot();
    const hugo = engine.world.npc('npc_hugo');
    put('sp_tab_barra', c, hugo);
    hugo.trust = { [c.id]: { points: 3 } } as Npc['trust'];
    const v = conflictVerdict(engine.world, [], c, hugo, 'shove', null, engine.gameNow())!;
    expect(v.relation).toBe('acquainted');
    const res = resolveConflict(engine.world, c, hugo, v, { total: 5, natural: null, npc_total: 15 }, engine.gameNow());
    expect(res.response).toBe('confront');
    expect(confrontOf(engine.world, c, engine.gameNow())?.c.dc).toBe(12);
    expect(confrontButtons(engine.world, c, engine.gameNow())[0]).toMatch(/^Disculparme/);
    expect(confrontAnswer('Perdona, Hugo, no quería')).toBe('persuade');
    expect(confrontAnswer('lo siento')).toBe('apologize');
    const s = settleConfront(engine.world, c, hugo, 'apologize', engine.gameNow());
    expect(s.closed).toBe(true);
    expect(allIncidents(engine.world)).toHaveLength(0);
  });

  it('el careo: devolverlo, pagarlo, convencer (tirada), y huir es delito', async () => {
    const { engine, c } = await boot();
    const hugo = engine.world.npc('npc_hugo');
    put('sp_tab_barra', c, hugo);
    hugo.trust = { [c.id]: { points: 3 } } as Npc['trust'];
    const bolsa = createItem(engine.world, hugo, { name: 'bolsa de clavos', size: 'small' });
    if (!bolsa.ok) throw new Error(bolsa.reason);
    // Se la arrebata: con un conocido, arrebatar es delito igual.
    const v = conflictVerdict(engine.world, [], c, hugo, 'snatch', bolsa.inst, engine.gameNow())!;
    const res = resolveConflict(engine.world, c, hugo, v, { total: 20, natural: null, npc_total: 3 }, engine.gameNow());
    expect(res.response).toBe('crime');
    expect(res.incident?.kind).toBe('theft');
    expect(res.moved?.name).toBe('bolsa de clavos');
    // Hugo, de pelear, le agarra: careo con CD 17 sobre lo que ya es delito. Devolverlo evita la pelea.
    expect(confrontOf(engine.world, c, engine.gameNow())?.c).toMatchObject({ dc: 17, crime: true });
    expect(settleConfront(engine.world, c, hugo, 'apologize', engine.gameNow()).closed).toBe(false);
    const back = settleConfront(engine.world, c, hugo, 'return', engine.gameNow());
    expect(back.closed).toBe(true);
    expect(engine.world.itemInstances.get(bolsa.inst.id)!.location).toEqual({ type: 'npc', id: 'npc_hugo' });
  });

  it('convencer en el careo: con éxito un aviso; si falla, delito', async () => {
    const { engine, c } = await boot();
    const hugo = engine.world.npc('npc_hugo');
    put('sp_tab_barra', c, hugo);
    hugo.trust = { [c.id]: { points: 3 } } as Npc['trust'];
    resolveConflict(engine.world, c, hugo, conflictVerdict(engine.world, [], c, hugo, 'shove', null, engine.gameNow())!, { total: 5, natural: null, npc_total: 15 }, engine.gameNow());
    expect(settleConfront(engine.world, c, hugo, 'persuade', engine.gameNow()).roll).toMatchObject({ key: 'persuasion', dc: 12 });
    const fail = confrontRolled(engine.world, c, hugo, false, engine.gameNow());
    expect(fail.incident?.kind).toBe('assault');
  });

  it('tocar sin permiso: la primera, un aviso según quién es; la segunda, agresión', async () => {
    const { engine, c } = await boot();
    const tobias = engine.world.npc('npc_tobias');
    put('sp_mo_sacos', c, tobias);
    const first = resolveConflict(engine.world, c, tobias, conflictVerdict(engine.world, [], c, tobias, 'touch', null, engine.gameNow())!, null, engine.gameNow());
    expect(first.response).toBe('warned');
    expect(first.reaction).toMatch(/encoge/);
    const second = resolveConflict(engine.world, c, tobias, conflictVerdict(engine.world, [], c, tobias, 'touch', null, engine.gameNow())!, null, engine.gameNow());
    expect(second.response).toBe('crime');
    expect(second.incident?.kind).toBe('assault');
  });
});

describe('lo robado siempre existe', () => {
  it('se crea con límites: nada mágico, nada grande, no más de tres, y el mismo si ya lo lleva', async () => {
    const { engine } = await boot();
    const osric = engine.world.npc('npc_osric');
    const a = createItem(engine.world, osric, { name: 'anillo de plata', worn: true });
    expect(a.ok && a.created).toBe(true);
    const again = createItem(engine.world, osric, { name: 'Anillo de plata' });
    expect(again.ok && !again.created && again.inst.id === (a.ok ? a.inst.id : '')).toBe(true);
    expect(createItem(engine.world, osric, { name: 'anillo mágico de fuego' }).ok).toBe(false);
    expect(createItem(engine.world, osric, { name: 'arcón de hierro', size: 'large' }).ok).toBe(false);
    expect(createItem(engine.world, osric, { name: 'sello de cera' }).ok).toBe(true);
    // El llavero ya lo lleva (el manojo de llaves de su ajuar, outfit.ts): no se crea otro.
    const keys = createItem(engine.world, osric, { name: 'llavero' });
    expect(keys.ok && !keys.created).toBe(true);
    expect(createItem(engine.world, osric, { name: 'cordón de cuero' }).ok).toBe(true);
    expect(createItem(engine.world, osric, { name: 'pañuelo bordado' }).ok).toBe(false);
  });

  it('el máster no lo crea con spawn_item ni lo mueve con transfer_item: va por conflict_act', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    const ctx = ctxFor(engine, c, 'robarle la llave a Garrán');
    expect(tool(ctx, 'transfer_item', { instance_id: 'ii_llave_arcon', to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: null }).error).toBe('conflict_needed');
    expect(tool(ctx, 'spawn_item', { item_id: 'it_llave_arcon', quantity: 1, spot_id: 'sp_tab_mesa' }).error).toBe('conflict_needed');
  });

  it('con conflict_act la tirada la pone el servidor, aunque el máster pida otra', async () => {
    const { engine, c } = await boot();
    const garran = engine.world.npc('npc_garran');
    put('sp_tab_mesa', c, garran);
    const text = 'le birlo la llave del arcón';
    const ctx = ctxFor(engine, c, text, { conflict_plan: conflictPlan(engine.world, [], c, text, engine.gameNow()) });
    expect(tool(ctx, 'conflict_act', { npc_id: 'npc_garran', kind: 'steal', instance_id: 'ii_llave_arcon', new_item_name: null, new_item_worn: null })).toMatchObject({ ok: true, possible: true });
    expect(tool(ctx, 'log_event', close({ requires_roll_kind: 'skill', requires_roll_key: 'sleight_of_hand', requires_roll_dc: 5, requires_roll_advantage: 'advantage' })).ok).toBe(true);
    expect(ctx.closed?.requires_roll).toMatchObject({ key: 'sleight_of_hand', dc: null, advantage: 'none' });
    expect(ctx.closed?.requires_roll?.conflict?.roll?.against).toBe('contest');
  });
});

describe('el cierre', () => {
  const base = { plan: null, called: false, possible: null, req: null, narration: 'x', lines: [], reacts: null, actionText: null, rolling: false };
  it('sin conflict_act, no: ni el plan ni una tirada de Juego de manos para robar', () => {
    expect(conflictCloseProblems({ ...base, plan: { kind: 'steal', npc_id: 'npc_garran', verdict: { possible: true } } })).toMatch(/conflict_act/);
    expect(conflictCloseProblems({ ...base, req: { kind: 'skill', key: 'sleight_of_hand' }, actionText: 'le robo la bolsa' })).toMatch(/conflict_act/);
    expect(conflictCloseProblems({ ...base, req: { kind: 'skill', key: 'sleight_of_hand' }, actionText: 'escondo la carta en la manga' })).toBeNull();
    expect(conflictCloseProblems({ ...base, plan: { kind: 'steal', npc_id: 'npc_osric', verdict: { possible: false } } })).toBeNull();
  });
  it('quien reacciona sale nombrado, y no con la deuda', () => {
    const reacts = { name: 'el regidor', refs: ['Osric Malvez', 'Osric', 'regidor'] };
    expect(conflictCloseProblems({ ...base, called: true, reacts, narration: 'Nada.' })).toMatch(/nómbrale/);
    expect(conflictCloseProblems({ ...base, called: true, reacts, narration: 'El regidor te agarra la muñeca.', lines: [{ speaker: 'npc', npc_id: 'npc_osric', text: 'Suelta. Y paga tu deuda.' }] })).toMatch(/reacción/);
    expect(conflictCloseProblems({ ...base, called: true, reacts, narration: 'El regidor te agarra la muñeca.', lines: [{ speaker: 'npc', npc_id: 'npc_osric', text: '¡Suelta eso, ladrón!' }] })).toBeNull();
  });
  it('tras la tirada lo cuenta el máster: no se comprueba aquí', () => {
    expect(conflictCloseProblems({ ...base, rolling: true, plan: { kind: 'steal', npc_id: 'x', verdict: { possible: true } } })).toBeNull();
  });
});
