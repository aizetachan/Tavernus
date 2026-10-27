/**
 * Coherencia del mundo: lo que la narración da por hecho tiene que existir y
 * quedar en el estado. Sale de la partida del 2026-10-26 (hallazgos nuevos 5,
 * 6, 8, 10, 11, 13, 14, 15 y 16, y la guardia Doro, que murió sin aviso y
 * desapareció de la escena). Todo con Brezal y sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { BREZAL } from '../src/data/campaigns/brezal/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { validateSnapshot } from '../src/worldgen/validate.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { seededRng } from '../src/engine/dice.js';
import { describeSurroundings } from '../src/engine/narrate.js';
import { suggestActions } from '../src/engine/fastpath.js';
import { journalOf, npcLabel, npcTag } from '../src/engine/journal.js';
import { receivedWithoutOffer, recentNpcLines, repeatedLines } from '../src/engine/closecheck.js';
import { parseOfferAnswer } from '../src/engine/party.js';
import { addScheduledEvent, scheduleTitleProblem } from '../src/engine/schedule.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(fastTravel = false) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel, rng: () => 0.99 });
  return { engine, time };
}

async function newPc(engine: Engine, name: string, class_id = 'rogue', situation = true): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id });
  if (!r.ok) throw new Error(r.reason);
  if (situation) claimSituation(engine.world, r.character.id, engine.gameNow());
  return r.character;
}

function ctxFor(engine: Engine, c: Character, extra: Partial<ToolContext> = {}): ToolContext {
  return { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], ...extra };
}

type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string; hint?: string };
function tool(ctx: ToolContext, name: string, input: Record<string, unknown>): ToolOut {
  const out = JSON.parse(executeTool(ctx, name, input)) as ToolOut;
  if (out.ok) (ctx.ok_tools ??= []).push(name);
  return out;
}

/** Un cierre con lo mínimo; lo demás, a null. */
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
const carries = (engine: Engine, c: Character, itemId: string) => engine.world.itemsCarriedBy(c.id).filter((i) => i.item_id === itemId).reduce((n, i) => n + i.quantity, 0);

describe('n.º 5: una poción cura una vez', () => {
  it('heal con item_instance_id gasta la poción y tira sus dados; sin él, si la acción la nombra, se pide una vez', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin', 'wizard');
    const miau = await newPc(engine, 'Miau', 'cleric');
    miau.location = { type: 'spot', id: leo.location.id };
    miau.hp_current = 2;
    // La poción del cofre, en el bolsillo de Leodhin.
    const potion = engine.world.itemInstances.get('ii_cofre_pocion')!;
    potion.location = { type: 'character', id: leo.id, slot: { kind: 'pocket' } };
    expect(carries(engine, leo, 'it_pocion')).toBe(2);

    const ctx = ctxFor(engine, leo, { action_text: 'hacerle tragar la poción de curación' });
    const asked = tool(ctx, 'heal', { target_id: miau.id, amount: 7, healer_id: null, item_instance_id: null });
    expect(asked.error).toMatch(/poción de curación \[ii_cofre_pocion\].*item_instance_id/);
    expect(miau.hp_current).toBe(2);

    const healed = tool(ctx, 'heal', { target_id: miau.id, amount: 99, healer_id: null, item_instance_id: 'ii_cofre_pocion' });
    expect(healed).toMatchObject({ ok: true, used: 'poción de curación' });
    // 2d4+2, tirado por el servidor (no los 99 que pedía el máster).
    expect(healed['healed']).toBeGreaterThanOrEqual(4);
    expect(healed['healed']).toBeLessThanOrEqual(10);
    expect(ctx.rolls.at(-1)?.expr).toBe('2d4+2');
    expect(carries(engine, leo, 'it_pocion')).toBe(1);

    // La última: el ejemplar desaparece.
    tool(ctxFor(engine, leo), 'heal', { target_id: miau.id, amount: 0, healer_id: null, item_instance_id: 'ii_cofre_pocion' });
    expect(engine.world.itemInstances.has('ii_cofre_pocion')).toBe(false);
    // Sin poción no hay nada que gastar.
    expect(tool(ctxFor(engine, leo), 'heal', { target_id: miau.id, amount: 3, healer_id: null, item_instance_id: 'ii_cofre_pocion' }).error).toBe('not_reachable');
  });

  it('use_item gasta lo que se bebe o se come, y no lo que no se gasta', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Teo');
    const ctx = ctxFor(engine, c);
    const ration = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_racion')!;
    const before = ration.quantity;
    expect(tool(ctx, 'use_item', { instance_id: ration.id, quantity: null })).toMatchObject({ ok: true, used: 'ración', left: before - 1 });
    const rope = engine.world.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_cuerda')!;
    expect(tool(ctx, 'use_item', { instance_id: rope.id, quantity: null }).error).toBe('not_consumable');
  });
});

describe('n.º 6: nada sale de la nada', () => {
  it('Brezal no deja improvisar objetos: spawn_item se rechaza y dice dónde están las cosas', async () => {
    const { engine } = await boot();
    expect(BREZAL.campaign.master.improvisation).toBeLessThan(3);
    const c = await newPc(engine, 'Teo');
    const r = tool(ctxFor(engine, c), 'spawn_item', { item_id: 'it_tonico', quantity: 1, spot_id: 'sp_cu_hierbas' });
    expect(r.error).toBe('improvisation_too_low');
    expect(r.hint).toMatch(/Lleva/);
  });

  it('Ilse lleva lo que vende: el máster lo ve, se le puede robar y comprar le baja las existencias', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Teo');
    c.coins = 10_000;
    const ilse = engine.world.npc('npc_ilse');
    c.location = { type: 'spot', id: ilse.location.id };
    c.knows.push(ilse.id);
    expect(actionContext(engine, c, 'mirar la mesa')).toMatch(/Lleva: tónico de corteza ×3 \[ii_ilse_tonico\], poción de curación \[ii_ilse_pocion\]/);
    const ctx = ctxFor(engine, c);
    expect(tool(ctx, 'get_npc', { npc_id: 'npc_ilse' })['carries']).toEqual(['tónico de corteza ×3 [ii_ilse_tonico]', 'poción de curación ×1 [ii_ilse_pocion]']);
    // El robo: el tónico pasa de Ilse al PJ (lo que antes creaba spawn_item).
    expect(tool(ctx, 'transfer_item', { instance_id: 'ii_ilse_tonico', to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: 1 }).ok).toBe(true);
    expect(engine.world.itemInstances.get('ii_ilse_tonico')!.quantity).toBe(2);
    // La compra sale de lo que lleva.
    expect(tool(ctx, 'buy_item', { character_id: c.id, npc_id: 'npc_ilse', item_id: 'it_pocion', quantity: 1 }).ok).toBe(true);
    expect(engine.world.itemInstances.has('ii_ilse_pocion')).toBe(false);
    expect(carries(engine, c, 'it_pocion')).toBe(1);
  });
});

describe('n.º 8: las sugerencias son del sitio adonde vas', () => {
  it('al ponerse en camino no sugiere lo que deja atrás', async () => {
    // Viaje rápido, como en la partida: «Te pones en camino hacia La herrería» y llega al acabar la acción.
    const { engine } = await boot(true);
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(1) }));
    const c = await newPc(engine, 'Leodhin', 'wizard');
    expect(c.location.id).toBe('sp_pl_pozo');
    const from = lastSeq(engine);
    await engine.act(c.id, 'ir a la herreria');
    const move = since(engine, from).find((e) => e.action_type === 'move' && e.actor_id === c.id)!;
    const sug = move.payload['suggested_actions'] as string[];
    expect(sug.join(' | ')).not.toMatch(/pozo|Osric|tablón|Salir hacia Taberna/);
    // Ya ha llegado: son las mismas que da el sitio.
    expect(sug).toEqual(suggestActions(engine.world, engine.clock, c, engine.nowFor(c)));
    expect(sug.some((s) => /fragua|banco|herrero|Hugo|Plaza del Pozo/.test(s))).toBe(true);
  });
});

describe('n.º 10 y 11: quien sale en la apertura existe y está allí', () => {
  it('toda persona nombrada en una apertura de Brezal es un NPC que la apertura pone con el PJ', () => {
    const npcs = BREZAL.npcs;
    for (const e of BREZAL.campaign.situations ?? []) {
      const s = e.situation;
      const named = npcs.filter((n) => new RegExp(`\\b${n.name}\\b`).test(s.opening));
      for (const n of named) expect(s.with_npc_ids ?? [], `${s.id}: ${n.name}`).toContain(n.id);
      expect(s.opening).not.toMatch(/una vieja/);
      expect(s.paths.join(' ')).not.toMatch(/vieja de las velas/);
    }
    expect(validateSnapshot(authoredSeed('brezal'))).toEqual([]);
  });

  it('la carta: Ilse va al pozo antes de la primera escena (con su npc_move) y el máster la tiene delante', async () => {
    const { engine } = await boot();
    const from = lastSeq(engine);
    const c = await newPc(engine, 'Leodhin', 'wizard');
    await engine.tick(); // lo que hace introduce() antes de la primera escena
    const ilse = engine.world.npc('npc_ilse');
    expect(ilse.location.id).toBe(c.location.id);
    expect(since(engine, from).some((e) => e.action_type === 'npc_move' && e.payload['npc_id'] === 'npc_ilse' && e.location_id === 'loc_plaza')).toBe(true);
    const ctx = actionContext(engine, c, '(primera escena)', undefined, { origin: '', welcome: '' });
    expect(ctx).toMatch(/- NPC Ilse \[npc_ilse\], curandera, en el pozo, 0 m/);
    // Se queda la escena y luego vuelve a lo suyo.
    expect(ctx).toMatch(/se queda en el pozo \d+ min más/);
  });

  it('la deuda: Garrán está en tu mesa, y en la apertura el PJ no se va hacia la barra', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Miau', 'rogue');
    expect(c.situation?.id).toBe('sit_deuda');
    await engine.tick();
    expect(engine.world.npc('npc_garran').location.id).toBe('sp_tab_mesa');
    expect(c.location.id).toBe('sp_tab_mesa');
    // Aunque Garrán estuviera en la barra, la apertura no mueve al PJ («Te acercas a la barra. Sobre tu mesa…»).
    engine.world.npc('npc_garran').location = { type: 'spot', id: 'sp_tab_barra' };
    const ctx = ctxFor(engine, c, { intro: true });
    expect(tool(ctx, 'log_event', close({ narration_private: 'Garrán deja caer una tablilla en tu mesa.', npc_id: 'npc_garran' })).ok).toBe(true);
    expect(ctx.approach ?? null).toBeNull();
    expect(ctx.closed!.narration_private).not.toMatch(/Te acercas/);
  });
});

describe('n.º 13: los títulos de la agenda se leen dentro de frases', () => {
  it('sin artículo o con el nombre de quien acude no vale, ni en los datos ni del máster', async () => {
    expect(scheduleTitleProblem('Tobías va al granero', ['Tobías'])).toMatch(/sin artículo/);
    expect(scheduleTitleProblem('la ronda de Tobías', ['Tobías'])).toMatch(/nombra a Tobías/);
    expect(scheduleTitleProblem('la escapada al granero', ['Tobías'])).toBeNull();
    for (const e of BREZAL.campaign.schedule ?? []) expect(scheduleTitleProblem(e.title, e.npc_ids.map((id) => BREZAL.npcs.find((n) => n.id === id)!.name)), e.id).toBeNull();
    const seed = authoredSeed('brezal');
    (seed.campaign as { schedule: { title: string }[] }).schedule.find((e) => e.title === 'la escapada al granero')!.title = 'Tobías va al granero';
    expect(validateSnapshot(seed).join('\n')).toMatch(/se_tobias: el título «Tobías va al granero» va sin artículo/);
    const { engine } = await boot();
    expect(addScheduledEvent(engine.world, { title: 'reunión del concejo', location_id: 'loc_plaza', start_h: 18, duration_min: 30, recurrence: 'once', description: 'Se reúnen.' }, engine.gameNow())).toMatchObject({ ok: false, error: expect.stringMatching(/sin artículo/) });
  });

  it('Tobías se va «camino de la escapada al granero», no «camino de Tobías va al granero»', async () => {
    const { engine, time } = await boot();
    const c = await newPc(engine, 'Hal', 'ranger', false);
    c.location = { type: 'spot', id: 'sp_mo_desvan' };
    engine.world.npc('npc_tobias').location = { type: 'spot', id: 'sp_mo_desvan' };
    const from = lastSeq(engine);
    // De las 18:00 a las 23:05: empieza su paseo.
    time.advanceGame(5 * 3600 + 5 * 60);
    await engine.tick();
    const moves = since(engine, from).filter((e) => e.action_type === 'npc_move' && e.payload['npc_id'] === 'npc_tobias').map((e) => e.observable);
    expect(moves.join(' ')).toMatch(/Tobías se va del desván, camino de la escapada al granero\./);
    expect(moves.join(' ')).not.toMatch(/Tobías va al granero/);
  });
});

describe('n.º 14: lo que el PJ no sabe no se le escapa', () => {
  it('las sugerencias del máster nombran por el oficio a quien no conoce', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Leodhin', 'wizard');
    expect(c.knows).not.toContain('npc_brenna');
    const ctx = ctxFor(engine, c);
    tool(ctx, 'log_event', close({ suggested_actions: 'Preguntar a Brenna por la ceniza | Brenna, ¿qué tal? | Hablar con Ilse' }));
    expect(ctx.closed!.suggested_actions).toEqual(['Preguntar a la tabernera por la ceniza', 'La tabernera, ¿qué tal?', 'Hablar con Ilse']);
  });

  it('el Diario: «te lo pide la tabernera» a media frase, «Tabernera» como etiqueta, y el texto de una misión sin nombres que no sabe', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Teo', 'rogue', false);
    const brenna = engine.world.npc('npc_brenna');
    expect(npcLabel(c, brenna)).toBe('la tabernera');
    expect(npcTag(c, brenna)).toBe('Tabernera');
    c.knows.push(brenna.id);
    expect(npcLabel(c, brenna)).toBe('Brenna');
    // Las misiones de la historia: no sabe quién es Ilse. Lo que oye en la plaza entra en el Diario como pista hacia ella.
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    await engine.tick();
    const j = journalOf(engine, c.id);
    const water = j.quests.active.find((q) => q.id === 'lead:q_agua');
    expect(water).toBeDefined();
    const all = [water!.text, ...water!.steps.map((s) => s.text)].join(' ');
    expect(all).toMatch(/curandera/);
    expect(all).not.toMatch(/\bIlse\b/);
    expect(all).not.toMatch(/la curandera, la curandera/);
  });
});

describe('n.º 15: entre jugadores nada cambia de manos sin oferta', () => {
  it('«acepto la cerveza» con una oferta en pie la acepta el motor; sin oferta, el máster no puede darla por recibida', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin', 'rogue', false);
    const miau = await newPc(engine, 'Miau', 'rogue', false);
    for (const x of [leo, miau]) { x.location = { type: 'spot', id: 'sp_tab_barra' }; x.knows.push('npc_brenna'); }
    leo.coins = 100;
    expect(tool(ctxFor(engine, leo), 'buy_item', { character_id: leo.id, npc_id: 'npc_brenna', item_id: 'it_cerveza', quantity: 1 }).ok).toBe(true);
    const beer = engine.world.itemsCarriedBy(leo.id).find((i) => i.item_id === 'it_cerveza')!;

    // Sin oferta: el cierre que dice «aceptas la jarra que te tiende Leodhin» se rechaza.
    const ctx = ctxFor(engine, miau, { action_text: 'acepto la cerveza' });
    const r = tool(ctx, 'log_event', close({ narration_private: 'Aceptas la jarra que te tiende Leodhin. Sabe a humo.', observable: 'Miau acepta la jarra que le tiende Leodhin.' }));
    expect(r.error).toMatch(/recibe algo de Leodhin/);

    // Con oferta: lo escrito la resuelve sin máster.
    expect(engine.offer(leo.id, miau.id, { instance_id: beer.id, coins: 0 }).ok).toBe(true);
    const out = await engine.act(miau.id, 'acepto la cerveza');
    expect(out.ok).toBe(true);
    expect(carries(engine, miau, 'it_cerveza')).toBe(1);
    expect(carries(engine, leo, 'it_cerveza')).toBe(0);
  });

  it('las frases de aceptar y la regla de recibir', () => {
    expect(parseOfferAnswer('acepto la cerveza')).toEqual({ accept: true, what: 'la cerveza' });
    expect(parseOfferAnswer('Acepto.')).toEqual({ accept: true, what: null });
    expect(parseOfferAnswer('no, gracias')).toEqual({ accept: false, what: null });
    expect(parseOfferAnswer('acepto que me he equivocado y me voy')).toMatchObject({ accept: true });
    expect(parseOfferAnswer('voy a la barra')).toBeNull();
    expect(receivedWithoutOffer({ texts: ['Coges el frasco que te da Aren.'], givers: ['Aren'], okTools: [] })).toEqual(['Aren']);
    expect(receivedWithoutOffer({ texts: ['Aren te tiende el frasco; no lo coges.'], givers: ['Aren'], okTools: [] })).toEqual([]);
    expect(receivedWithoutOffer({ texts: ['Coges el frasco que te da Aren.'], givers: ['Aren'], okTools: ['transfer_item'] })).toEqual([]);
  });
});

describe('n.º 16: un NPC no repite la misma frase', () => {
  it('detecta la frase repetida (igual o casi) y no las cortas', () => {
    const said = ['Treinta la jarra.', 'Eso se hace fuera. Lo que rompáis, lo pagáis vosotros.'];
    const hit = (text: string) => repeatedLines({ lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text }], said: () => said });
    expect(hit('Treinta la jarra. Y no fío.')).toEqual([{ npc_id: 'npc_brenna', text: 'Treinta la jarra' }]);
    expect(hit('Lo que rompáis lo pagáis vosotros, ¿eh?')).toHaveLength(1);
    expect(hit('Treinta.')).toEqual([]);
    expect(hit('La cerveza, a veinte para ti.')).toEqual([]);
  });

  it('el cierre que repite lo de antes se reescribe una vez; el máster ve lo que ya dijo', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Leodhin', 'rogue', false);
    c.location = { type: 'spot', id: 'sp_tab_barra' };
    c.knows.push('npc_brenna');
    const first = ctxFor(engine, c);
    tool(first, 'log_event', close({ npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Eso se hace fuera. Lo que rompáis, lo pagáis vosotros.' }] }));
    engine.events.emit({ actor_id: c.id, action_type: 'master', narration_private: first.closed!.narration_private, payload: { npc_id: 'npc_brenna', lines: first.closed!.lines } });
    expect(recentNpcLines(engine.events.recentInLocation('loc_taberna', 60), 'npc_brenna')).toHaveLength(1);
    expect(actionContext(engine, c, 'otra vez')).toMatch(/Ya ha dicho hace poco .*«Eso se hace fuera\. Lo que rompáis, lo pagáis vosotros\.»/);

    const again = ctxFor(engine, c);
    const r = tool(again, 'log_event', close({ npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Eso se hace fuera. Lo que rompáis, lo pagáis vosotros.' }] }));
    expect(r.error).toMatch(/Brenna ya ha dicho «Eso se hace fuera» hace nada/);
    // Si insiste, pasa (una sola vez se rechaza).
    expect(tool(again, 'log_event', close({ npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Eso se hace fuera.' }] })).ok).toBe(true);
  });
});

describe('la muerte de un NPC: aviso, cuerpo y reacción del sitio', () => {
  it('Doro muere en la barra: evento para todos, el cuerpo se queda, Brenna lo ha visto y el máster lo sabe', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin', 'rogue', false);
    const miau = await newPc(engine, 'Miau', 'fighter', false);
    const doro = engine.world.npc('npc_doro');
    for (const x of [leo, miau]) x.location = { type: 'spot', id: 'sp_tab_barra' };
    doro.location = { type: 'spot', id: 'sp_tab_barra' };
    leo.knows.push('npc_brenna');
    doro.stats!.hp = 1;
    const from = lastSeq(engine);
    const ctx = ctxFor(engine, miau, { rng: () => 0.99 });
    const hit = tool(ctx, 'attack', { attacker_id: miau.id, target_id: 'npc_doro', advantage: 'none' });
    expect(hit).toMatchObject({ hit: true, target_dead: true });
    expect(doro.status).toBe('dead');
    expect(doro.death).toMatchObject({ by_id: miau.id, by_name: 'Miau' });
    await engine.tick();

    // Un evento, una vez, para los dos.
    const deaths = since(engine, from).filter((e) => e.action_type === 'npc_death');
    expect(deaths).toHaveLength(1);
    const ev = deaths[0]!;
    expect(ev.delivered_to.map((d) => d.character_id).sort()).toEqual([leo.id, miau.id].sort());
    const textFor = (c: Character) => engine.events.forCharacter(c.id, null).find((d) => d.event.id === ev.id)!.text;
    // Leodhin no sabe cómo se llama: «la guardia».
    expect(textFor(leo)).toMatch(/^☠ La guardia cae al suelo|^☠ la guardia cae al suelo/i);
    expect(textFor(leo)).toMatch(/ha muerto por el golpe de Miau\. El cuerpo queda en la barra\./);
    expect(textFor(miau)).toMatch(/ha muerto por tu golpe/);
    // Doro no era hostil: es un crimen (crime.ts). La reacción de la sala no va en la muerte, sino en el incidente que la sigue.
    expect(ev.observable).not.toMatch(/se apartan del cuerpo|se quedan mirando el cuerpo/);
    const inc = since(engine, from).find((e) => e.action_type === 'incident');
    expect(inc?.observable).toMatch(/^⚖ Lo han visto: Miau mató a Doro\. .*Brenna/);
    expect(inc!.seq).toBeGreaterThan(ev.seq);
    await engine.tick();
    expect(engine.events.all().filter((e) => e.action_type === 'npc_death')).toHaveLength(1);

    // Brenna lo ha visto: lo recuerda siempre y recela de Miau.
    const brenna = engine.world.npc('npc_brenna');
    expect(brenna.memory.some((m) => m.character_id === miau.id && m.importance === 3 && /Miau mataba a Doro/.test(m.note))).toBe(true);
    expect(brenna.attitude.by_character[miau.id]).toBe('unfriendly');

    // El cuerpo no desaparece: lo ven who_is_here, el contexto del máster y la descripción del sitio.
    expect(doro.location.id).toBe('sp_tab_barra');
    const who = JSON.parse(executeTool(ctxFor(engine, miau), 'who_is_here', {})) as { id: string; status?: string; name: string }[];
    expect(who.find((x) => x.id === 'npc_doro')).toMatchObject({ status: 'dead', name: 'cuerpo de Doro' });
    expect(actionContext(engine, miau, 'mirar a la guardia')).toMatch(/El cuerpo de la guardia \[npc_doro\] en la barra: MUERTO desde las \d\d:\d\d, a manos de Miau/);
    expect(actionContext(engine, miau, 'mirar a la guardia')).toMatch(/Recuerda de Miau: .*Vio cómo Miau mataba a Doro/);
    expect(describeSurroundings(engine.world, engine.clock, leo, engine.nowFor(leo))).toMatch(/En el suelo: el cuerpo de la guardia aquí mismo\./);
    // Ni se cura ni se vuelve a matar.
    expect(tool(ctxFor(engine, miau), 'heal', { target_id: 'npc_doro', amount: 5, healer_id: null, item_instance_id: null }).error).toMatch(/muerto/);
    expect(tool(ctxFor(engine, miau), 'apply_damage', { target_id: 'npc_doro', amount: 5, damage_type: 'slashing', source: 'espada' }).error).toMatch(/muerto/);
  });

  it('apply_damage que mata también deja evento y cuerpo', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Hal', 'ranger', false);
    const lobo = engine.world.npc('npc_lobo');
    c.location = { type: 'spot', id: lobo.location.id };
    const r = tool(ctxFor(engine, c), 'apply_damage', { target_id: 'npc_lobo', amount: 99, damage_type: 'fire', source: 'una antorcha' });
    expect(r).toMatchObject({ ok: true, status: 'dead', died: true });
    expect(r['note']).toMatch(/cuerpo/);
    const from = lastSeq(engine);
    await engine.tick();
    const ev = since(engine, from).find((e) => e.action_type === 'npc_death')!;
    expect(ev.observable).toMatch(/un lobo flaco cae al suelo y ya no se mueve: ha muerto\./);
    expect(ev.delivered_to.map((d) => d.character_id)).toContain(c.id);
  });
});
