/**
 * Bloque G («Pequeños») de la revisión de la partida «La noche del Brezal» del
 * 27-10-2026 (Leodhin, mago, solo), con los textos reales del máster
 * (brezal.events.jsonl, seq entre paréntesis). Revisión: Obsidian, «Revisión
 * partida 2026-10-27», fallos 1, 2, 4, 5, 8 y 9.
 */
import { describe, expect, it } from 'vitest';
import { historyFor, type WebMessage } from '../src/adapters/web/server.js';
import { actionContext, homeLine } from '../src/ai/prompt.js';
import { Master, type MasterClient } from '../src/ai/master.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { conversationCheck, type Conversation } from '../src/engine/conversation.js';
import { Engine } from '../src/engine/engine.js';
import { encumbrance } from '../src/engine/inventory.js';
import type { Character } from '../src/engine/model.js';
import { coinPieces, fmtMoney, parseMoney } from '../src/engine/money.js';
import { inventedPlaces } from '../src/engine/places.js';
import { aheadBy } from '../src/engine/travel.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { claimSituation } from '../src/worldgen/index.js';
import { bootEngine, fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function brezal() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const repo = new MemoryRepository();
  // Azar fijo: sin él, un imprevisto corta el descanso (planRest) y no se duerme las ocho horas.
  const engine = await Engine.boot({ repo, campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false, rng: () => 0.99 });
  return { engine, time, repo, seed };
}

async function leodhin(engine: Engine): Promise<Character> {
  const r = await engine.createCharacter('u_leo', 'Leodhin', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return r.character;
}

describe('n.º 1: monedas de oro, plata y cobre', () => {
  it('el valor va en cobre; se enseña, se pesa y se lee en monedas de cada metal', () => {
    expect(fmtMoney(1500)).toBe('15 de oro');
    expect(fmtMoney(1700)).toBe('17 de oro');
    expect(fmtMoney(4)).toBe('4 de cobre');
    expect(fmtMoney(125)).toBe('1 de oro, 2 de plata y 5 de cobre');
    expect(fmtMoney(0)).toBe('nada');
    // Las 1700 «monedas» de Leodhin eran 34 lb; en monedas de verdad son 17 piezas.
    expect(coinPieces(1700)).toBe(17);
    expect(parseMoney('dar 3 de oro a Mira')).toBe(300);
    expect(parseMoney('le doy 2 monedas de plata y 5 de cobre')).toBe(25);
    expect(parseMoney('20 monedas')).toBe(20);
    expect(parseMoney('la daga')).toBeNull();
  });

  it('un mago de FUE 9 empieza en Brezal con unas pocas monedas y sin ir cargado', async () => {
    const { engine } = await brezal();
    const leo = await leodhin(engine);
    leo.abilities.str = 9;
    expect(leo.coins).toBe(150);
    expect(fmtMoney(leo.coins)).toBe('1 de oro y 5 de plata');
    expect(encumbrance(engine.world, leo).level).toBe('ok');
    // Ni con las 1700 del final de la partida.
    leo.coins = 1700;
    expect(encumbrance(engine.world, leo).level).toBe('ok');
  });

  it('precios a escala: una cerveza son unas monedas de cobre; el tablón paga en plata', async () => {
    const { engine } = await brezal();
    const w = engine.world;
    const sells = (id: string, item: string) => w.npc(id).sells.find((s) => s.item_id === item)!.price;
    expect(sells('npc_brenna', 'it_cerveza')).toBe(4);
    expect(sells('npc_brenna', 'it_noche_posada')).toBe(20);
    expect(sells('npc_hugo', 'it_espada_corta')).toBe(1000); // 10 de oro, como en el SRD
    const lena = w.campaign.jobs.find((j) => j.id === 'job_lena')!;
    expect(fmtMoney(lena.reward_coins)).toBe('6 de plata'); // antes 900: nueve noches por diez leños
    expect(lena.reward_coins).toBeLessThan(sells('npc_brenna', 'it_noche_posada') * 4);
  });

  it('una partida guardada de antes coge las monedas y los precios nuevos; el dinero del PJ se queda', async () => {
    const { engine, repo, time } = await brezal();
    const leo = await leodhin(engine);
    leo.coins = 1700;
    const snap = structuredClone(engine.world.snapshot());
    // Como estaba en el VPS: sin monedas en la campaña y con los precios viejos.
    delete snap.campaign.currency;
    delete snap.campaign.starting_coins;
    snap.npcs.find((n) => n.id === 'npc_brenna')!.sells.find((s) => s.item_id === 'it_cerveza')!.price = 30;
    snap.campaign.jobs.find((j) => j.id === 'job_lena')!.reward_coins = 900;
    await repo.saveSnapshot(snap);
    const fresh = authoredSeed('brezal', { now: new Date(EPOCH) });
    const again = await Engine.boot({ repo, campaignId: 'brezal', seed: fresh, now: time.now, deterministic: false, fastTravel: false });
    expect(again.world.campaign.currency?.map((d) => d.name)).toEqual(['oro', 'plata', 'cobre']);
    expect(again.world.npc('npc_brenna').sells.find((s) => s.item_id === 'it_cerveza')!.price).toBe(4);
    expect(again.world.campaign.jobs.find((j) => j.id === 'job_lena')!.reward_coins).toBe(60);
    expect(again.world.character(leo.id).coins).toBe(1700);
  });

  it('el máster ve el dinero en monedas y los precios igual', async () => {
    const { engine } = await brezal();
    const leo = await leodhin(engine);
    leo.location = { type: 'spot', id: 'sp_tab_barra' };
    const ctx = actionContext(engine, leo, 'pido una cerveza');
    expect(ctx).toContain('Monedas: 1 de oro y 5 de plata (= 150 de cobre');
    expect(ctx).toContain('jarra de cerveza [it_cerveza] a 4 de cobre');
  });
});

describe('n.º 4: dormir deja al PJ por delante del mundo, y se dice', () => {
  it('al levantarse: su hora, la del pueblo y lo que sigue en marcha; el máster lo sabe', async () => {
    const { engine, time } = await brezal();
    const leo = await leodhin(engine);
    leo.location = { type: 'spot', id: 'sp_tab_habitacion' };
    // Las 19:48, con la cena del Jabalí en marcha (seq 97).
    time.advanceGame(1 * 3600 + 48 * 60);
    await engine.tick();
    const r = await engine.act(leo.id, 'dormir');
    expect(r.ok).toBe(true);
    expect(aheadBy(leo, engine.gameNow())).toBeGreaterThan(7 * 3600);
    expect(r.text).toMatch(/Vas por delante del mundo: para ti son las 0?3:48, pero los demás aún van por las 19:48 \(la cena del Jabalí sigue en marcha\)/);
    expect(r.text).toMatch(/el reloj te alcanza en 2 h 40 min reales/);
    expect((await engine.command(leo.id, '/where'))).toContain('Vas por delante del mundo');
    expect(actionContext(engine, leo, 'bajar a la sala')).toMatch(/VA POR DELANTE DEL MUNDO: .* son las 19:48/);
  });

  it('un trayecto corto no avisa', async () => {
    const { engine } = await brezal();
    const leo = await leodhin(engine);
    (leo as Character & { ahead_until_game_s?: number }).ahead_until_game_s = engine.gameNow() + 5 * 60;
    expect(engine.aheadNotice(leo)).toBeNull();
    expect(actionContext(engine, leo, 'mirar')).not.toContain('VA POR DELANTE');
  });
});

/** Cliente falso del máster: devuelve los cierres en orden. */
function client(closes: Record<string, unknown>[]): MasterClient {
  return {
    async create() {
      const input = closes.shift();
      if (!input) throw new Error('script agotado');
      return {
        id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null,
        content: [{ type: 'tool_use', id: 'tu', name: 'log_event', input: { observable: null, observable_vague: null, loudness: 1, tags: 'exploration', suggested_actions: '', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, ...input } }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as never;
    },
  };
}
const askRoll = { narration_private: 'Recoges el cubo y te inclinas a mirar el agua de cerca.', requires_roll_kind: 'skill', requires_roll_key: 'nature', requires_roll_dc: 10, requires_roll_advantage: 'none' };

describe('n.º 5: la tirada pedida no se pierde (seq 43–49)', () => {
  it('sigue pendiente aunque entren avisos de horario, y tras reiniciar el servidor', async () => {
    const time = fakeTime();
    const { engine, repo } = await bootEngine(time);
    engine.attachMaster(new Master(engine, { client: client([askRoll]) }));
    const r = await engine.act('ch_kael', 'saca agua del pozo y mírala de cerca');
    expect(r.requires_roll).toMatchObject({ kind: 'skill', key: 'nature' });
    // Pasa el tiempo: horarios y NPC que se mueven (seq 44–48) no la tocan.
    time.advanceGame(30 * 60);
    await engine.tick();
    expect(engine.pendingRoll('ch_kael')).toMatchObject({ event_id: r.event!.id, seq: r.event!.seq });
    // El servidor se reinicia: la tirada vivía solo en memoria.
    await engine.flush();
    await repo.saveSnapshot(engine.world.snapshot());
    const again = await Engine.boot({ repo, campaignId: 'demo', now: time.now, deterministic: false });
    expect(again.pendingRoll('ch_kael')).toMatchObject({ event_id: r.event!.id, roll: { key: 'nature', dc: 10 }, text: 'saca agua del pozo y mírala de cerca' });
  });

  it('otra acción la anula, también al reiniciar', async () => {
    const time = fakeTime();
    const { engine, repo } = await bootEngine(time);
    engine.attachMaster(new Master(engine, { client: client([askRoll, { narration_private: 'Dejas el cubo en el brocal.' }]) }));
    await engine.act('ch_kael', 'saca agua del pozo y mírala de cerca');
    await engine.act('ch_kael', 'mejor lo dejo');
    expect(engine.pendingRoll('ch_kael')).toBeNull();
    await engine.flush();
    await repo.saveSnapshot(engine.world.snapshot());
    const again = await Engine.boot({ repo, campaignId: 'demo', now: time.now, deterministic: false });
    expect(again.pendingRoll('ch_kael')).toBeNull();
  });

  it('la web: al reconectar, el botón de la tirada pendiente sigue vivo aunque haya avisos detrás', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.attachMaster(new Master(engine, { client: client([askRoll]) }));
    const r = await engine.act('ch_kael', 'saca agua del pozo y mírala de cerca');
    const seq = r.event!.seq;
    const h: WebMessage[] = [
      { seq: seq - 1, kind: 'master', text: 'antes', roll: { kind: 'skill', key: 'stealth', dc: 12 } },
      { seq, kind: 'master', text: 'el cubo', roll: { kind: 'skill', key: 'nature', dc: 10 } },
      { seq: seq + 1, kind: 'system', text: 'Desde Taberna del Jabalí llega ruido de gente: la cena del Jabalí.' },
    ];
    const out = historyFor(engine, 'ch_kael', h);
    expect(out.map((m) => m.roll_pending ?? false)).toEqual([false, true, false]);
    expect(h[1]!.roll_pending).toBeUndefined(); // no toca el historial guardado
    // Ya tirada (o anulada): ninguna marca.
    await engine.rollPending('ch_kael').catch(() => undefined);
    expect(historyFor(engine, 'ch_kael', h).some((m) => m.roll_pending)).toBe(false);
  });
});

describe('n.º 9: el control de cierre no rechaza lo que estaba bien', () => {
  const talk = (npc: string, gestures: string[]): Conversation => ({ npc_id: npc, turns: 3, npc_spoke: true, gestures });
  const base = { lines: [], npcId: null, okTools: [] as string[] };

  it('seq 39: «las ventanas de la plaza» son fachadas, no un sitio inventado; dentro de casa sí se mira', async () => {
    const { engine } = await brezal();
    const t = 'Te quedas junto al pozo sin mirar a Ilse. Uno a uno, las ventanas de la plaza se van apagando, y las puertas se cierran con aldaba.';
    expect(inventedPlaces(engine.world, 'loc_plaza', t)).toEqual([]);
    expect(inventedPlaces(engine.world, 'loc_herreria', 'Te asomas a la ventana del fondo.')).toEqual(['la ventana']);
  });

  it('seq 39: una espera sin diálogo no tiene tope de palabras de conversación', () => {
    const narration = 'Te quedas junto al pozo sin mirar a Ilse. Poco a poco la plaza se vacía: se cierran las puertas con aldaba y se oye el martilleo, cada vez más lejos. Al fondo, junto al tablón, un hombre sigue con su capa de buen paño. Ilse vuelve a frotar el brocal, con las manos quietas solo cuando nadie mira, y el agua gotea despacio del cubo.';
    expect(conversationCheck({ ...base, conversation: talk('npc_ilse', []), narration, npcId: 'npc_ilse' })).toBeNull();
    // Con diálogo, el tope sigue.
    expect(conversationCheck({ ...base, conversation: talk('npc_ilse', []), narration, npcId: 'npc_ilse', lines: [{ speaker: 'npc', npc_id: 'npc_ilse', text: 'Aún falta.' }] })).toMatchObject({ kind: 'long' });
  });

  it('seq 95: la mirada de otro NPC (Garrán) es una reacción, no relleno de la tabernera', () => {
    const lines = [{ speaker: 'npc' as const, npc_id: 'npc_brenna', text: 'El corazón se le paró.' }];
    const narration = 'Garrán deja de contar con los dedos y te mira de reojo, desde el otro extremo de la barra.';
    expect(conversationCheck({ ...base, conversation: talk('npc_brenna', ['mirada', 'jarra']), narration, npcId: 'npc_brenna', lines, others: ['Garrán', 'Doro'] })).toBeNull();
    // Si la mirada es de la propia tabernera, sigue siendo relleno.
    expect(conversationCheck({ ...base, conversation: talk('npc_brenna', ['mirada']), narration: 'Brenna te mira de reojo.', npcId: 'npc_brenna', lines, others: ['Garrán'] })).toMatchObject({ kind: 'filler' });
  });

  it('seq 96: un gesto repetido junto a una acción concreta pasa', () => {
    const lines = [{ speaker: 'npc' as const, npc_id: 'npc_brenna', text: 'Cien monedas. Y baja la voz, que hay vecinos.' }];
    const narration = 'Brenna no levanta la vista de la jarra. Cuenta cien monedas sobre la tabla y, sin decir palabra, deja una llave de hierro junto al cobre.';
    expect(conversationCheck({ ...base, conversation: talk('npc_brenna', ['mirada', 'jarra']), narration, npcId: 'npc_brenna', lines })).toBeNull();
  });
});

describe('n.º 8: Ilse vive en el callejón de las hierbas, no en el Soto (seq 27–30)', () => {
  it('el máster sabe dónde vive cada NPC y por dónde se va desde aquí', async () => {
    const { engine } = await brezal();
    const w = engine.world;
    expect(homeLine(w, w.npc('npc_ilse'), 'loc_plaza')).toBe(' Vive en Casa de las hierbas (desde aquí, por el callejón de las hierbas).');
    expect(homeLine(w, w.npc('npc_ilse'), 'loc_curandera')).toBe('');
    expect(homeLine(w, w.npc('npc_hal'), 'loc_plaza')).toBe(' Vive en El Soto (desde aquí, por el portón norte).');
    // Sin casa en los datos, nada que decir.
    expect(homeLine(w, w.npc('npc_doro'), 'loc_plaza')).toBe('');
    const leo = await leodhin(engine);
    leo.location = { type: 'spot', id: 'sp_pl_pozo' };
    w.npc('npc_ilse').location = { type: 'spot', id: 'sp_pl_pozo' };
    expect(actionContext(engine, leo, 'preguntar a Ilse por su dintel')).toContain('Vive en Casa de las hierbas (desde aquí, por el callejón de las hierbas).');
  });

  it('los datos no confunden su casa con el Soto', async () => {
    const { engine } = await brezal();
    const w = engine.world;
    // El parto de la noche del incendio sigue en el Soto (trasfondo), pero su casa queda dicha.
    expect(w.npc('npc_ilse').secret).toMatch(/Soto a atender un parto, lejos de su casa de las hierbas/);
    expect(w.spot('sp_pl_callejon').description).toContain('Ilse');
    expect(w.location('loc_curandera').description_base).toContain('callejón de las hierbas');
  });
});
