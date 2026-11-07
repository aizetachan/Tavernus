/**
 * El hilo de la partida del 04-11-2026 (Cat en Brezal, Doro detrás). Tres cosas que se veían mal:
 *   1. Tras la tirada de Persuasión, «Habla con Ilse antes de llevarme a nadie, Doro» salía otra vez como burbuja
 *      del jugador: el máster repetía la frase en los parlamentos del desenlace (master_roll_outcome).
 *   2. La ventana decisiva caducó mientras el jugador escribía y solo apareció «Te acercas a la puerta.», sin aviso.
 *   3. Cat pasó del callejón (Plaza del Pozo) a la puerta de la Casa de las hierbas sin que el hilo lo dijera, y el
 *      combate salió como «Hay un combate en curso en Casa de las hierbas» con la ronda otra vez en 1.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { encounterAt, encounterKey, type Encounter } from '../src/engine/encounter.js';
import type { Engine } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import type { Character, GameEvent, Id } from '../src/engine/model.js';
import { GameManager } from '../src/games/manager.js';
import { combatView, fightStart, FIGHT_FOLLOW_S, type CombatView } from '../src/adapters/web/fight.js';
import { withoutEcho, type NovelBlock } from '../src/adapters/web/novel.js';
import { createWebServer, toMessage, type WebServer } from '../src/adapters/web/server.js';
import { bootEngine, fakeTime, readSse, waitUntil } from './helpers.js';

const SAID = 'Habla con Ilse antes de llevarme a nadie, Doro. Ella estaba aquí cuando pasó todo.';

/** El mensaje que ve `reader` de ese evento (como lo arma el servidor). */
function seen(engine: Engine, e: GameEvent, reader: Id): ReturnType<typeof toMessage> {
  const d: Delivery = { character_id: reader, event: e, level: 'full', text: reader === e.actor_id ? e.narration_private : e.observable ?? '' } as Delivery;
  return toMessage(d, engine);
}

describe('1. el desenlace de una tirada no repite la frase del jugador', () => {
  it('withoutEcho: fuera la línea del jugador que repite lo que dijo; lo nuevo y la narración se quedan', () => {
    const lines = [
      { speaker: 'actor', text: SAID },
      { speaker: 'npc', text: 'No me vengas con Ilse.' },
      { speaker: 'actor', text: '¡Pues pregúntale a ella!' },
    ];
    const blocks: NovelBlock[] = [
      { kind: 'line', line: 0 },
      { kind: 'prose', text: 'Doro aprieta la mandíbula.' },
      { kind: 'line', line: 1 },
      { kind: 'line', line: 2 },
    ];
    const k = withoutEcho(lines, blocks, SAID);
    expect(k.lines.map((l) => l.text)).toEqual(['No me vengas con Ilse.', '¡Pues pregúntale a ella!']);
    expect(k.blocks).toEqual([{ kind: 'prose', text: 'Doro aprieta la mandíbula.' }, { kind: 'line', line: 0 }, { kind: 'line', line: 1 }]);
    // Si al quitarla quedan dos trozos de prosa juntos, van en una sola burbuja.
    expect(withoutEcho([{ speaker: 'actor', text: SAID }], [{ kind: 'prose', text: 'Levantas las manos.' }, { kind: 'line', line: 0 }, { kind: 'prose', text: 'Doro no se mueve.' }], SAID).blocks)
      .toEqual([{ kind: 'prose', text: 'Levantas las manos. Doro no se mueve.' }]);
  });

  it('en el servidor: la burbuja sale una vez (al pedir la tirada), también al recargar', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const brenna = engine.world.npc('npc_brenna');
    kael.location = { type: 'spot', id: brenna.location.id };
    const ask = engine.events.emit({
      actor_id: kael.id, action_type: 'master', input_text: SAID, narration_private: `«${SAID}» Levantas las manos vacías y miras a la tabernera.`, observable: null, tags: ['master'],
      payload: { lines: [{ speaker: 'actor', text: SAID }], requires_roll: { kind: 'skill', key: 'persuasion', dc: 15 } },
    });
    const outcome = engine.events.emit({
      actor_id: kael.id, action_type: 'master_roll_outcome', input_text: SAID, narration_private: `«${SAID}» La tabernera aprieta la mandíbula. «No me vengas con esas.»`, observable: null, tags: ['master'],
      payload: { lines: [{ speaker: 'actor', text: SAID }, { speaker: 'npc', npc_id: brenna.id, text: 'No me vengas con esas.' }] },
    });
    const first = seen(engine, ask, kael.id);
    expect(first.lines?.filter((l) => l.speaker === 'actor').map((l) => l.text)).toEqual([SAID]);
    const after = seen(engine, outcome, kael.id);
    expect(after.input).toBeUndefined();
    expect(after.lines?.some((l) => l.speaker === 'actor')).toBe(false);
    expect(after.blocks).toEqual([{ kind: 'prose', text: 'La tabernera aprieta la mandíbula.' }, { kind: 'line', line: 0 }]);
    expect(after.lines?.[0]).toMatchObject({ speaker: 'npc', id: brenna.id, text: 'No me vengas con esas.' });
  });
});

describe('2. el turno de una ventana decisiva caducada se ve', () => {
  it('el motor etiqueta ese turno decisive_timeout y el servidor lo marca solo para quien no reaccionó', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.attachMaster(new Master(engine, { client: offlineClient() }));
    const kael = engine.world.character('ch_kael');
    const mira = engine.world.character('ch_mira');
    mira.location = { ...kael.location };
    kael.decisive = { opened_real_ms: time.now(), window_s: 60, threat: 'Doro te ata', npc_id: null, event_id: 'ev_x' };
    time.advanceReal(61);
    await engine.tick();
    const e = await waitUntil(() => { const x = engine.events.all().find((y) => y.tags.includes('decisive_timeout')); expect(x).toBeTruthy(); return x!; });
    expect(e.actor_id).toBe(kael.id);
    expect(e.input_text).toBeNull();
    expect(seen(engine, e, kael.id).timeout).toBe(true);
    expect(seen(engine, e, mira.id).timeout).toBeUndefined();
  });

  it('la ventana abierta lleva su cierre (para la cuenta atrás al recargar); cerrada, no', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    const e = engine.events.emit({ actor_id: kael.id, action_type: 'master', input_text: 'me asomo', narration_private: 'Doro te ve.', observable: null, tags: ['master'], payload: { decisive: { threat: 'Doro te ata', window_s: 60 } } });
    expect(seen(engine, e, kael.id)).toMatchObject({ decisive_s: 60 });
    expect(seen(engine, e, kael.id).decisive_until_ms).toBeUndefined();
    kael.decisive = { opened_real_ms: time.now(), window_s: 60, threat: 'Doro te ata', npc_id: null, event_id: e.id };
    expect(seen(engine, e, kael.id).decisive_until_ms).toBe(time.now() + 60_000);
  });
});

/** Doro, hostil y armado, al lado de Cat en el callejón de la Plaza del Pozo. */
function inTheAlley(engine: Engine, cat: Character) {
  const doro = engine.world.npc('npc_doro');
  cat.location = { type: 'spot', id: 'sp_pl_callejon' };
  doro.location = { type: 'spot', id: 'sp_pl_callejon' };
  doro.attitude.by_character[cat.id] = 'hostile';
  doro.stats!.hp = doro.stats!.hp_max = 200;
  cat.hp_current = cat.hp_max = 200;
  engine.world.touch('npcs', doro.id);
  return doro;
}

describe('3. combate: el rival que te sigue a otro sitio es el mismo combate', () => {
  const view = (key: string, place: string, round: number): CombatView => ({ active: true, key, place, round, turn: { kind: 'you', who: [], text: 'Te toca', deadline_ms: null }, fighters: [], log: [] });
  const enc = (location_id: Id, started_game_s: number, npcs: Id[]): Encounter => ({
    location_id, started_seq: 9, started_game_s, last_game_s: started_game_s, exchanges: 0, log: [],
    fighters: [{ id: 'ch_cat', kind: 'pc', initiative: 10, hp: 5, hp_max: 9, state: 'hurt' }, ...npcs.map((id) => ({ id, kind: 'npc' as const, initiative: 8, hp: 9, hp_max: 9, state: 'ok' as const }))],
  });
  const trail = { key: 'loc_plaza:3', location_id: 'loc_plaza', rivals: ['npc_doro'], round: 3, game_s: 1000 };

  it('fightStart: mismo rival en otra localización y poco después: «sigue» y la ronda continúa', () => {
    expect(fightStart(enc('loc_curandera', 500, ['npc_doro']), view('loc_curandera:9', 'Casa de las hierbas', 1), trail, 1030))
      .toEqual({ text: '⚔ El combate sigue en Casa de las hierbas', round_offset: 2 });
    // Otro rival, demasiado tarde o el mismo sitio: no es el mismo combate.
    expect(fightStart(enc('loc_curandera', 500, ['npc_ilse']), view('loc_curandera:9', 'Casa de las hierbas', 1), trail, 1030).text).toBe('⚔ Hay un combate en curso en Casa de las hierbas');
    expect(fightStart(enc('loc_curandera', 1100, ['npc_doro']), view('loc_curandera:9', 'Casa de las hierbas', 1), trail, 1000 + FIGHT_FOLLOW_S + 1)).toEqual({ text: '⚔ Empieza el combate en Casa de las hierbas', round_offset: 0 });
    expect(fightStart(enc('loc_plaza', 1020, ['npc_doro']), view('loc_plaza:9', 'Plaza del Pozo', 1), trail, 1030).round_offset).toBe(0);
    expect(fightStart(enc('loc_plaza', 1020, ['npc_doro']), view('loc_plaza:9', 'Plaza del Pozo', 1), null, 1030).text).toBe('⚔ Empieza el combate en Plaza del Pozo');
  });
});

describe('3. en la web: «El combate sigue», la ronda no vuelve a 1 y el cruce deja su línea', () => {
  let dir: string;
  let web: WebServer | undefined;
  afterEach(async () => { await web?.stop(); web = undefined; if (dir) await rm(dir, { recursive: true, force: true }); });

  it('Cat cruza del callejón a la puerta de la Casa de las hierbas con Doro detrás', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-hilo-'));
    // Brezal con el reloj desde ahora: su tablón rota por días de juego y antes de su fecha de inicio no hay día.
    const time = fakeTime(Date.now());
    const games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: (e) => new Master(e, { client: offlineClient() }), engine: { deterministic: false, now: time.now }, log: () => {}, budget: null });
    web = createWebServer(games, { tickMs: 3_600_000 });
    await new Promise<void>((resolve) => web!.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
    const { game, character_id } = await games.create({ name: 'Brezal', mode: 'offline', campaign_id: 'brezal', character: { name: 'Cat', class_id: 'rogue' } });
    const engine = await games.open(game.slug);
    const cat = engine.world.character(character_id);
    const stream = await fetch(`${base}/api/stream?game=${game.slug}&character=${cat.id}`);
    // Un PJ nuevo se presenta primero (prólogo); hasta entonces su hilo no recibe nada más.
    await readSse(stream, (t) => t.includes('event: presence') && (!t.includes('event: opening') || t.includes('"chapter":{"kind":"prologue"')));
    const doro = inTheAlley(engine, cat);
    const combats = (text: string) => [...text.matchAll(/event: combat\ndata: (.*)\n\n/g)].map((m) => JSON.parse(m[1]!) as CombatView);
    const master = (narration: string, calls: [string, Record<string, unknown>][] = [], tags = ['master', 'combat']) => {
      const ctx: ToolContext = { engine, actor: cat, nowGameS: engine.nowFor(cat), rng: seededRng(7), closed: null, rolls: [], progress: [] };
      const done = calls.map(([name, input]) => ({ name, input, result: executeTool(ctx, name, input) }));
      return engine.events.emit({ actor_id: cat.id, action_type: 'master', input_text: 'algo', narration_private: narration, observable: null, tags, payload: { master: { calls: done } } }, time.now());
    };

    // En la plaza: Doro y Cat se las tienen (dos intercambios): ronda 3.
    master('Doro te corta el paso.', [['attack', { attacker_id: doro.id, target_id: cat.id, advantage: 'none' }]]);
    time.advanceGame(10);
    master('Te revuelves.');
    let text = await readSse(stream, (t) => combats(t).some((c) => c.active && c.round === 3));
    expect(text).toContain('⚔ Empieza el combate en Plaza del Pozo');
    const plaza = combats(text).filter((c) => c.active).at(-1)!;
    expect(plaza.round).toBe(3);

    // El máster mueve a Cat a la puerta (otra localización, sin contarlo) y Doro va detrás.
    time.advanceGame(10);
    const moved = master('Te pegas a la pared, sin aliento.', [['move_to', { character_id: cat.id, target_spot_id: 'sp_cu_puerta', pace: 'walk' }]], ['master']);
    expect(moved.location_id).toBe('loc_curandera');
    doro.location = { type: 'spot', id: 'sp_cu_puerta' };
    engine.world.touch('npcs', doro.id);
    // Mientras no haya golpes allí, el combate no se da por acabado: el rival le ha seguido.
    text = await readSse(stream, (t) => t.includes('Cruzas a la puerta'), 2_000);
    await new Promise((r) => setTimeout(r, 400));
    // Cat le mete a Doro un golpe en el umbral: el encuentro de allí es otro (otra clave) y, por sí solo, iría por la ronda 1.
    time.advanceGame(5);
    engine.events.emit({ actor_id: cat.id, action_type: 'roll', narration_private: '🎲 Ataque', observable: null, tags: ['roll'], payload: { attack: { target_id: doro.id, hit: true, down: false, dead: false, damage: 3 } } }, time.now());
    const there = encounterAt(engine.world, engine.events.recentInLocation('loc_curandera', 400), 'loc_curandera', engine.gameNow())!;
    expect(encounterKey(there)).not.toBe(plaza.key);
    expect(combatView(engine.world, there, cat.id, { round: null, busy: [], resolving: [] })!.round).toBe(1);

    text += await readSse(stream, (t) => t.includes('El combate sigue en Casa de las hierbas') && combats(t).some((c) => c.active && c.key !== plaza.key));
    // El cruce deja su línea gris, en vivo; ni «Fin del combate» ni un combate «en curso» como si fuera otro.
    expect(text).toContain('"moved":"Cruzas a la puerta (Casa de las hierbas)"');
    expect(text).not.toContain('Hay un combate en curso');
    expect(text).not.toContain('Fin del combate');
    expect(text).not.toContain('Sales del combate');
    // ...y la ronda sigue donde iba, no vuelve a 1.
    const after = combats(text).filter((c) => c.active && c.key !== plaza.key).at(-1)!;
    expect(after.round).toBe(3);
    await stream.body!.cancel();

    // Al recargar, la misma línea del cruce y el combate con su ronda.
    const again = await fetch(`${base}/api/stream?game=${game.slug}&character=${cat.id}`);
    const reload = await readSse(again, (t) => t.includes('event: combat'));
    expect(reload.match(/"moved":"Cruzas a la puerta \(Casa de las hierbas\)"/g)).toHaveLength(1);
    expect(combats(reload).at(-1)).toMatchObject({ key: after.key, round: after.round });
    await again.body!.cancel();
  }, 40_000);
});
