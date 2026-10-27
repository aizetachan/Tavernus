import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Master, type MasterClient } from '../src/ai/master.js';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine } from '../src/engine/engine.js';
import { debtLine, dueText, fmtCoins, openDebts } from '../src/engine/debts.js';
import { journalOf } from '../src/engine/journal.js';
import { moveTo } from '../src/engine/movement.js';
import { inventedPlaces } from '../src/engine/places.js';
import type { WorldSnapshot } from '../src/engine/model.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { buildSkeleton, generateSeed } from '../src/worldgen/index.js';
import { migrateRentableRooms, ROOM_KEY_ITEM_ID, ROOM_NIGHT_ITEM_ID } from '../src/worldgen/rooms.js';
import { SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import { bootEngine, fakeTime } from './helpers.js';

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function msg(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content, stop_reason: 'tool_use', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
const use = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Anthropic.Beta.BetaToolUseBlock => ({ type: 'tool_use', id, name, input });
const logEvent = (priv: string, extra: Record<string, unknown> = {}) => ({
  narration_private: priv, observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: 'Esperar',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
  decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false, lines: null,
  ...extra,
});

function fakeClient(script: Anthropic.Beta.BetaMessage[]) {
  const requests: Params[] = [];
  const client: MasterClient = {
    async create(p) {
      requests.push(structuredClone(p));
      const next = script.shift();
      if (!next) throw new Error('script agotado');
      return next;
    },
  };
  return { client, requests };
}

function ctxFor(engine: Engine, actorId = 'ch_kael'): ToolContext {
  const actor = engine.world.character(actorId);
  return { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [] };
}
const run = (ctx: ToolContext, name: string, input: Record<string, unknown>) => JSON.parse(executeTool(ctx, name, input)) as Record<string, unknown> & { error?: string; detail?: Record<string, unknown>; hint?: string };

/** Mundo generado offline con posada y posadero (como la partida fdd). */
async function innWorld(): Promise<{ engine: Engine; time: ReturnType<typeof fakeTime>; snap: WorldSnapshot }> {
  let seed = 847858329;
  for (let s = 0; s < 400; s++) {
    const sk = buildSkeleton({ seed: s, tone: 'grim', setting: '' });
    if (sk.npcs.some((n) => n.id === 'npc_innkeeper') && sk.locations.some((l) => l.kind === 'inn')) { seed = s; break; }
  }
  const snap = await generateSeed({ seed, tone: 'grim', setting: '', client: null, now: () => new Date(SEED_REAL_EPOCH_MS) });
  const time = fakeTime(SEED_REAL_EPOCH_MS);
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: snap.campaign.id, seed: structuredClone(snap), now: time.now, deterministic: false });
  const r = await engine.createCharacter('u1', 'ddd');
  if (!r.ok) throw new Error('sin PJ');
  const c = r.character;
  c.location = { type: 'spot', id: 'sp_inn_puerta' };
  c.coins = 1500;
  return { engine, time, snap };
}

// ---------------------------------------------------------------------------

describe('tools fallidos que no se narran', () => {
  it('turno 24 de fdd: transfer_item falla en paralelo con log_event → el cierre se rechaza, se avisa y el evento lleva tool_failed', async () => {
    const { engine } = await bootEngine();
    // Brenna, hostil: el motor no acerca a nadie hacia quien le quiere mal, así que la entrega falla.
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_puerta' };
    engine.world.npc('npc_brenna').attitude.by_character['ch_kael'] = 'hostile';
    const { client, requests } = fakeClient([
      msg([
        use('transfer_item', { instance_id: 'ii_kael_daga', to_type: 'npc', to_id: 'npc_brenna', slot: 'hand_main', equip_slot: null, quantity: null }),
        use('log_event', logEvent('Brenna envuelve la daga en un paño y la guarda tras la barra. Te entrega una llave de cuarto.', { npc_id: 'npc_brenna' })),
      ]),
      msg([use('log_event', logEvent('Le tiendes la daga desde la puerta, pero Brenna no se mueve de la barra ni alarga la mano.'), 'tu_log_2')]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1) }));
    const r = await engine.act('ch_kael', 'dejar la daga como fianza para pasar la noche');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('no se mueve');
    // La daga sigue en la mano de Kael.
    expect(engine.world.itemInstance('ii_kael_daga').location).toMatchObject({ type: 'character', id: 'ch_kael' });
    // Segunda petición: el log_event rechazado y el aviso del tool fallido, antes de seguir.
    const second = requests[1]!.messages.at(-1)!.content as ({ type: string; text?: string; content?: string; tool_use_id?: string; is_error?: boolean })[];
    const logResult = second.find((b) => b.type === 'tool_result' && b.tool_use_id === 'tu_log_event')!;
    expect(logResult.is_error).toBe(true);
    expect(logResult.content).toContain('log_event rechazado');
    const notice = second.find((b) => b.type === 'text')!;
    expect(notice.text).toMatch(/^El tool transfer_item falló: not_reachable: Brenna está en la barra, a \d+ m: fuera de alcance/);
    expect(notice.text).toContain('Narra que NO ha ocurrido o pide lo que falta; no narres el efecto.');
    // El evento: tag y errores en el payload.
    expect(r.event!.tags).toContain('tool_failed');
    const errs = r.event!.payload['tool_errors'] as { name: string; error: string }[];
    expect(errs).toHaveLength(1);
    expect(errs[0]!.name).toBe('transfer_item');
    expect(errs[0]!.error).toContain('"go_to":"sp_tab_barra"');
  });

  it('turno 24 de fdd, con el motor nuevo: la posadera no hostil está a 6 m → se acerca solo y la fianza ocurre de verdad', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_puerta' };
    const { client } = fakeClient([msg([
      use('transfer_item', { instance_id: 'ii_kael_daga', to_type: 'npc', to_id: 'npc_brenna', slot: 'hand_main', equip_slot: null, quantity: null }),
      use('log_event', logEvent('Brenna envuelve la daga en un paño y la guarda tras la barra.', { npc_id: 'npc_brenna' })),
    ])]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1) }));
    const r = await engine.act('ch_kael', 'dejar la daga como fianza');
    expect(r.text).toBe('Te acercas a la barra. Brenna envuelve la daga en un paño y la guarda tras la barra.');
    expect(engine.world.itemInstance('ii_kael_daga').location).toEqual({ type: 'npc', id: 'npc_brenna' });
    expect(engine.world.characterSpot(engine.world.character('ch_kael'))!.id).toBe('sp_tab_barra');
    expect(r.event!.tags).not.toContain('tool_failed');
    expect(r.event!.payload['approach']).toMatchObject({ from_spot_id: 'sp_tab_puerta', to_spot_id: 'sp_tab_barra' });
    expect(r.event!.spot_id).toBe('sp_tab_barra');
  });
});

describe('acercamiento automático', () => {
  it('log_event con npc_id de alguien a unos metros: el PJ pasa a su punto y la narración lo dice (salvo que ya lo diga)', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_puerta' };
    const ctx = ctxFor(engine);
    expect(run(ctx, 'log_event', logEvent('«¿Qué va a ser?», pregunta Brenna.', { npc_id: 'npc_brenna' }))).toEqual({ ok: true, closed: true });
    expect(engine.world.characterSpot(ctx.actor)!.id).toBe('sp_tab_barra');
    expect(ctx.closed!.narration_private).toBe('Te acercas a la barra. «¿Qué va a ser?», pregunta Brenna.');
    expect(ctx.approach!.duration_s).toBeGreaterThan(0);

    const { engine: e2 } = await bootEngine();
    e2.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_puerta' };
    const c2 = ctxFor(e2);
    run(c2, 'log_event', logEvent('Te acercas a la barra y Brenna levanta la vista.', { npc_id: 'npc_brenna' }));
    expect(c2.closed!.narration_private).toBe('Te acercas a la barra y Brenna levanta la vista.');
  });

  it('transfer_item y attack informan de la distancia y del punto al que ir', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_puerta' };
    engine.world.npc('npc_brenna').attitude.by_character['ch_kael'] = 'hostile';
    const ctx = ctxFor(engine);
    const t = run(ctx, 'transfer_item', { instance_id: 'ii_kael_daga', to_type: 'npc', to_id: 'npc_brenna', slot: 'hand_main', equip_slot: null, quantity: null });
    expect(t.error).toBe('not_reachable');
    expect(t.detail).toMatchObject({ go_to: 'sp_tab_barra', distance_m: 6 });
    expect(t.hint).toContain('move_to sp_tab_barra');
    const a = run(ctx, 'attack', { attacker_id: 'ch_kael', target_id: 'npc_brenna', advantage: 'none' });
    expect(a.error).toBe('not_reachable');
    expect(a.detail).toMatchObject({ go_to: 'sp_tab_barra', distance_m: 6 });
    // Coger algo del suelo de otro punto: también dice dónde está.
    const ii = engine.world.itemInstance('ii_kael_daga');
    ii.location = { type: 'spot', id: 'sp_tab_mesa' };
    const far = run(ctx, 'transfer_item', { instance_id: 'ii_kael_daga', to_type: 'character', to_id: 'ch_kael', slot: 'hand_main', equip_slot: null, quantity: null });
    expect(far.detail).toMatchObject({ go_to: 'sp_tab_mesa', reason: expect.stringContaining('la mesa del fondo') });
  });

  it('el contexto marca a los presentes fuera de alcance', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_tab_puerta' };
    expect(actionContext(engine, kael, 'hola')).toContain('(fuera de alcance: move_to sp_tab_barra para hablarle de cerca)');
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    expect(actionContext(engine, kael, 'hola')).not.toContain('fuera de alcance: move_to sp_tab_barra');
  });
});

describe('nada inventado', () => {
  it('detecta un lugar del catálogo dado por existente y respeta negaciones, búsquedas y lo que sí está en los datos', async () => {
    const { engine } = await bootEngine();
    const w = engine.world;
    expect(inventedPlaces(w, 'loc_taberna', 'Señala con el mentón la puerta de la cocina, al fondo de la barra.')).toEqual(['la cocina']);
    expect(inventedPlaces(w, 'loc_taberna', 'Sales al establo por la escalera de atrás.')).toEqual(['al establo', 'la escalera']);
    // La taberna sí tiene sótano (su trampilla): eso no es inventado.
    expect(inventedPlaces(w, 'loc_taberna', 'Bajas al sótano.')).toEqual([]);
    expect(inventedPlaces(w, 'loc_taberna', 'No hay ninguna cocina a la vista: solo la barra y las mesas.')).toEqual([]);
    expect(inventedPlaces(w, 'loc_taberna', 'Buscas con la vista una escalera, pero solo ves la barra.')).toEqual([]);
    expect(inventedPlaces(w, 'loc_taberna', 'Preguntas por la cocina.')).toEqual([]);
    expect(inventedPlaces(w, 'loc_taberna', 'Brenna dice: «En mi pueblo la cocina era así de grande».')).toEqual([]);
    // La habitación de arriba existe (alias «cuarto»): no es inventada.
    expect(inventedPlaces(w, 'loc_taberna', 'Subes al cuarto y cierras la puerta.')).toEqual([]);
    expect(inventedPlaces(w, 'loc_taberna', 'Te sientas junto a la mesa del fondo.')).toEqual([]);
  });

  it('log_event con un lugar inventado se rechaza una vez con la lista de puntos; el segundo intento pasa', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine);
    const r = run(ctx, 'log_event', logEvent('Marisa señala la puerta de la cocina, al fondo.'));
    expect(r.error).toContain('«la cocina»');
    expect(r.error).toContain('la barra [sp_tab_barra]');
    expect(ctx.closed).toBeNull();
    expect(run(ctx, 'log_event', logEvent('Marisa señala la puerta de la cocina, al fondo.'))).toEqual({ ok: true, closed: true });
  });

  it('los tools dicen claro que un punto o una localización no existen', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine);
    const loc = run(ctx, 'get_location', { location_id: 'loc_cocina' });
    expect(loc.error).toMatch(/^No existe la localización loc_cocina en los datos/);
    expect(loc.error).toContain('Puntos de aquí:');
    expect(loc.error).toContain('no lo inventes');
    const mv = run(ctx, 'move_to', { character_id: 'ch_kael', target_spot_id: 'sp_tab_cocina', pace: 'walk' });
    expect(mv.error).toBe('unknown_spot');
    expect(mv.hint).toContain('la mesa del fondo [sp_tab_mesa]');
    const st = run(ctx, 'update_spot_state', { spot_id: 'sp_tab_cocina', patch_json: '{}' });
    expect(st.error).toMatch(/^No existe el punto sp_tab_cocina/);
  });
});

describe('deudas y prendas', () => {
  it('set_debt, pawn_item y settle_debt: la deuda y la prenda son estado del mundo', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine);
    const kael = ctx.actor;
    kael.coins = 300;
    expect(run(ctx, 'set_debt', { npc_id: 'npc_brenna', amount: 1000, reason: 'la cuenta de la taberna', due_in_hours: 24 })).toMatchObject({ ok: true, owes: '10 de oro' });
    expect(run(ctx, 'pawn_item', { npc_id: 'npc_brenna', instance_id: 'ii_kael_daga', for_item_id: null, amount: null, reason: 'fianza', due_in_hours: null })).toMatchObject({ ok: true, pawned: 'daga', owes: '10 de oro' });
    expect(engine.world.itemInstance('ii_kael_daga').location).toEqual({ type: 'npc', id: 'npc_brenna' });
    const d = openDebts(kael)[0]!;
    expect(d).toMatchObject({ npc_id: 'npc_brenna', amount: 1000, collateral_instance_id: 'ii_kael_daga' });
    expect(debtLine(engine.world, d, ctx.nowGameS, (n) => n.name)).toBe('Debes 10 de oro a Brenna, vence mañana, prenda: daga');
    // El contexto lo muestra.
    expect(actionContext(engine, kael, 'pagar')).toContain('- Debes 10 de oro a Brenna [npc_brenna], vence mañana, prenda: daga [ii_kael_daga]. Motivo: la cuenta de la taberna; fianza.');
    // Paga parte: sigue abierta y la prenda no vuelve; sin monedas suficientes, error.
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'coins', amount: 200 })).toMatchObject({ ok: true, paid: 200, remaining: 800, settled: false, returned: null });
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'coins', amount: null }).error).toContain('hacen falta 8 de oro');
    // Trabajada: saldada y la daga vuelve a la mano.
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'work', amount: null })).toMatchObject({ ok: true, settled: true, returned: 'daga' });
    expect(engine.world.itemInstance('ii_kael_daga').location).toMatchObject({ type: 'character', id: 'ch_kael' });
    expect(openDebts(kael)).toEqual([]);
    expect(actionContext(engine, kael, 'pagar')).not.toContain('Deudas');
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'work', amount: null }).error).toContain('no debe nada');
  });

  it('forfeit: el NPC se queda la prenda; el plazo se cuenta en días', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine);
    run(ctx, 'pawn_item', { npc_id: 'npc_brenna', instance_id: 'ii_kael_daga', for_item_id: null, amount: 50, reason: 'una jarra rota', due_in_hours: 1 });
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'forfeit', amount: null })).toMatchObject({ ok: true, settled: true, kept_by_npc: 'daga', returned: null });
    expect(engine.world.itemInstance('ii_kael_daga').location).toEqual({ type: 'npc', id: 'npc_brenna' });
    expect(fmtCoins(1234567)).toBe('1.234.567');
    expect(dueText(100, 200)).toBe('vencida');
    expect(dueText(86400 * 3 + 10, 86400 + 5)).toBe('vence en 2 días');
    expect(dueText(86400 + 20 * 3600, 86400 + 3600)).toBe('vence hoy a las 20:00');
  });

  it('el Diario lista la deuda en Misiones (y la saldada, en completadas)', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine);
    run(ctx, 'set_debt', { npc_id: 'npc_brenna', amount: 1000, reason: 'la cuenta de la taberna', due_in_hours: 24 });
    run(ctx, 'pawn_item', { npc_id: 'npc_brenna', instance_id: 'ii_kael_daga', for_item_id: null, amount: null, reason: 'fianza', due_in_hours: null });
    let q = journalOf(engine, 'ch_kael').quests.active.find((x) => x.kind === 'debt')!;
    expect(q.title).toBe('Deuda con Brenna');
    expect(q.text).toContain('Debes 10 de oro a Brenna, vence mañana, prenda: daga');
    expect(q.steps.map((s) => s.text)).toEqual(['Pagar 10 de oro a Brenna (o saldarla de otro modo)', 'Recuperar la prenda: daga']);
    expect(q.clock).toMatchObject({ days_left: 1, runs_out: 'Brenna puede quedarse la prenda (daga).' });
    run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'work', amount: null });
    const j = journalOf(engine, 'ch_kael');
    expect(j.quests.active.some((x) => x.kind === 'debt')).toBe(false);
    q = j.quests.completed.find((x) => x.kind === 'debt')!;
    expect(q.steps[0]!.text).toBe('Saldada con trabajo');
  });
});

describe('cuarto alquilable en mundos generados', () => {
  it('la habitación de la posada está a la vista y cerrada; el premio del logro es otro punto oculto', () => {
    let inns = 0;
    for (let seed = 0; seed < 300; seed++) {
      const sk = buildSkeleton({ seed, tone: 'grim', setting: '' });
      const room = sk.locations.flatMap((l) => l.spots).find((s) => s.id === 'sp_inn_habitacion');
      expect(sk.reward_spot_id).not.toBe('sp_inn_habitacion');
      if (!room) continue;
      inns++;
      expect(room.hidden).toBe(false);
      expect(room.locked).toBe(true);
      expect(sk.situation_spot_ids).not.toContain(room.id);
      expect(sk.npcs.every((n) => n.spot_id !== room.id)).toBe(true);
    }
    expect(inns).toBeGreaterThan(10);
  });

  it('comprar «noche de posada» entrega la llave y abre el cuarto para ese PJ (y no para otro)', async () => {
    const { engine, snap } = await innWorld();
    const w = engine.world;
    const room = w.spot('sp_inn_habitacion');
    expect(room.hidden).toBe(false);
    expect(room.state).toMatchObject({ locked: true, key_item_id: ROOM_KEY_ITEM_ID });
    expect(w.npc('npc_innkeeper').sells).toContainEqual({ item_id: ROOM_NIGHT_ITEM_ID, price: 20 });
    expect(snap.campaign.achievement.reward_spot_id).not.toBe('sp_inn_habitacion');
    const c = [...w.characters.values()][0]!;
    const ctx = ctxFor(engine, c.id);
    expect(actionContext(engine, c, 'subir')).toContain('Cerrado con llave (llave del cuarto): el actor no puede entrar sin ella.');
    const locked = run(ctx, 'move_to', { character_id: c.id, target_spot_id: room.id, pace: 'walk' });
    expect(locked.error).toBe('locked');
    expect(locked.hint).toContain('llave del cuarto');
    // Compra desde la puerta: el motor la acerca a la barra.
    const b = run(ctx, 'buy_item', { character_id: c.id, npc_id: 'npc_innkeeper', item_id: ROOM_NIGHT_ITEM_ID, quantity: 1 });
    expect(b).toMatchObject({ ok: true, bought: 'noche de posada (llave del cuarto) ×1', total: 20 });
    expect(c.coins).toBe(1480);
    expect(w.itemsCarriedBy(c.id).some((i) => i.item_id === ROOM_KEY_ITEM_ID)).toBe(true);
    expect(w.itemsCarriedBy(c.id).some((i) => i.item_id === ROOM_NIGHT_ITEM_ID)).toBe(false);
    expect(room.state['unlocked_for']).toEqual([c.id]);
    expect(moveTo(w, c.id, room.id, 'walk', ctx.nowGameS).ok).toBe(true);
    // Otro PJ sin llave sigue fuera.
    const r2 = await engine.createCharacter('u2', 'Otro');
    if (!r2.ok) throw new Error('sin PJ');
    r2.character.location = { type: 'spot', id: 'sp_inn_puerta' };
    expect(moveTo(w, r2.character.id, room.id, 'walk', ctx.nowGameS)).toMatchObject({ ok: false, error: { code: 'locked' } });
  });

  it('pawn_item sirve para lo mismo sin monedas: la espada en prenda por una noche', async () => {
    const { engine } = await innWorld();
    const w = engine.world;
    const c = [...w.characters.values()][0]!;
    c.coins = 0;
    const weapon = w.itemsCarriedBy(c.id).find((i) => w.itemDef(i.item_id).weapon)!;
    const ctx = ctxFor(engine, c.id);
    const r = run(ctx, 'pawn_item', { npc_id: 'npc_innkeeper', instance_id: weapon.id, for_item_id: ROOM_NIGHT_ITEM_ID, amount: null, reason: 'fianza por una noche', due_in_hours: 10 });
    expect(r).toMatchObject({ ok: true, received: 'noche de posada (llave del cuarto)', owes: '2 de plata' });
    expect(w.itemInstance(weapon.id).location).toEqual({ type: 'npc', id: 'npc_innkeeper' });
    expect(moveTo(w, c.id, 'sp_inn_habitacion', 'walk', ctx.nowGameS).ok).toBe(true);
    expect(openDebts(c)[0]).toMatchObject({ npc_id: 'npc_innkeeper', amount: 20, collateral_instance_id: weapon.id });
  });

  it('migra un mundo generado antiguo: la habitación premio pasa a visible y cerrada, el premio a la trampilla', async () => {
    const { snap } = await innWorld();
    const old = structuredClone(snap);
    // Como era fdd: habitación oculta, premio del logro, sin cerrojo ni noche a la venta ni objetos nuevos.
    const room = old.spots.find((s) => s.id === 'sp_inn_habitacion')!;
    room.hidden = true; room.state = {};
    old.campaign.achievement.reward_spot_id = room.id;
    old.campaign.achievement.announcement = '{name} ha dicho lo que nadie quería oír. La posada abre la habitación de arriba para quien lo haga.';
    for (const n of old.npcs) n.sells = n.sells.filter((x) => x.item_id !== ROOM_NIGHT_ITEM_ID);
    old.item_defs = old.item_defs.filter((d) => d.id !== ROOM_KEY_ITEM_ID && d.id !== ROOM_NIGHT_ITEM_ID);
    expect(migrateRentableRooms(old)).toBe(true);
    expect(room.hidden).toBe(false);
    expect(room.state).toMatchObject({ locked: true, key_item_id: ROOM_KEY_ITEM_ID });
    expect(old.campaign.achievement.reward_spot_id).toBe('sp_inn_trampilla');
    expect(old.campaign.achievement.announcement).toBe('{name} ha dicho lo que nadie quería oír.');
    expect(old.npcs.find((n) => n.id === 'npc_innkeeper')!.sells.some((x) => x.item_id === ROOM_NIGHT_ITEM_ID)).toBe(true);
    expect(old.item_defs.some((d) => d.id === ROOM_KEY_ITEM_ID)).toBe(true);
    expect(migrateRentableRooms(old)).toBe(false);
    // Al abrir la partida pasa sola, y se persiste.
    const repo = new MemoryRepository();
    const again = structuredClone(old);
    const r2 = again.spots.find((s) => s.id === 'sp_inn_habitacion')!;
    r2.hidden = true; r2.state = {}; again.campaign.achievement.reward_spot_id = r2.id;
    await repo.saveSnapshot(again);
    const engine = await Engine.boot({ repo, campaignId: again.campaign.id, now: fakeTime().now, deterministic: false });
    expect(engine.world.spot('sp_inn_habitacion').hidden).toBe(false);
    expect(engine.world.campaign.achievement.reward_spot_id).toBe('sp_inn_trampilla');
    const saved = await repo.loadSnapshot(again.campaign.id);
    expect(saved!.spots.find((s) => s.id === 'sp_inn_habitacion')!.state['locked']).toBe(true);
  });
});
