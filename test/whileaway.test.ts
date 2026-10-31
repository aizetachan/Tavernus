import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GAME_DAY } from '../src/clock/clock.js';
import { createWebServer, type WebMessage, type WebServer } from '../src/adapters/web/server.js';
import { tablonView } from '../src/adapters/web/tablon.js';
import { AWAY_CARD_MS, awayCard, awayCardEmpty, awayFor, awayText, unreadFrom } from '../src/adapters/web/whileaway.js';
import { GameManager } from '../src/games/manager.js';
import { activeJobs, leavesBoardAt, rotateBoard } from '../src/engine/progress.js';
import { boardSeen } from '../src/engine/quests.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Kael y Mira juntos en la barra, Mira lo tiene todo leído hasta ahora. */
async function bar() {
  const time = fakeTime();
  const { engine } = await bootEngine(time);
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  const brenna = engine.world.npc('npc_brenna');
  kael.location = { type: 'spot', id: brenna.location.id };
  mira.location = { type: 'spot', id: brenna.location.id };
  kael.knows = [...kael.knows, mira.id];
  mira.knows = [...mira.knows, kael.id];
  const emit = engine.events.emit.bind(engine.events);
  engine.events.emit = (input, realMs = time.now()) => emit(input, realMs);
  mira.read_seq = engine.events.lastSeq;
  return { engine, time, kael, mira, brenna };
}

describe('umbral de ausencia', () => {
  it('a partir de 30 min fuera de línea, los mismos que tarda el velo; un rato no cuenta', async () => {
    const { engine, kael, time } = await bar();
    kael.away = { since_real_ms: time.now(), since_game_s: 0, spot_id: null };
    time.advanceReal(AWAY_CARD_MS / 1000 - 1);
    expect(awayFor(engine, kael)).toBeNull();
    time.advanceReal(1);
    expect(awayFor(engine, kael)).toBe(AWAY_CARD_MS);
    expect(AWAY_CARD_MS).toBe(30 * 60 * 1000);
    kael.away = null;
    expect(awayFor(engine, kael)).toBeNull();
  });

  it('velado sin marca de ausente (se fue antes de un reinicio): fuera desde lo último que leyó', async () => {
    const { engine, kael, time } = await bar();
    const seen = engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Bebes.', observable: null, tags: ['master'] });
    kael.read_seq = seen.seq;
    kael.veiled = true;
    expect(awayFor(engine, kael)).toBe(AWAY_CARD_MS);
    time.advanceReal(3 * 3600);
    expect(awayFor(engine, kael)).toBe(3 * 3_600_000);
  });

  it('dice cuánto de forma legible', () => {
    expect(awayText(35 * 60_000)).toBe('35 min');
    expect(awayText(130 * 60_000)).toBe('2 h 10 min');
    expect(awayText(72 * 3_600_000)).toBe('3 días');
  });
});

describe('marca de leído', () => {
  it('solo avanza y no pasa del último evento', async () => {
    const { engine, kael } = await bar();
    const last = engine.events.lastSeq;
    engine.markRead(kael.id, last + 50);
    expect(kael.read_seq).toBe(last);
    engine.markRead(kael.id, 1);
    expect(kael.read_seq).toBe(last);
    engine.markRead(kael.id, Number.NaN);
    expect(kael.read_seq).toBe(last);
  });

  it('sin marca (partidas de antes) cuenta desde su último turno', async () => {
    const { engine, kael } = await bar();
    const own = engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Bebes.', observable: null, tags: ['master'] });
    expect(unreadFrom(engine, kael)).toBe(own.seq);
    kael.read_seq = 3;
    expect(unreadFrom(engine, kael)).toBe(3);
  });
});

describe('tarjeta «Mientras no estabas»', () => {
  it('agrupa lo percibido: quién va y viene, lo de tu sitio, lo que te dijeron y las misiones', async () => {
    const { engine, kael, mira, brenna } = await bar();
    const from = mira.read_seq!;
    engine.events.emit({ actor_id: kael.id, action_type: 'away', narration_private: '', observable: 'Kael se ha ido; su personaje se queda en la barra.', also_to: [mira.id], tags: ['presence'] });
    engine.events.emit({ actor_id: kael.id, action_type: 'back', narration_private: '', observable: 'Kael ha vuelto.', also_to: [mira.id], tags: ['presence'] });
    await engine.say(kael.id, 'Mira, te espero fuera', { to: mira.id });
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Golpeas la mesa.', observable: 'Kael golpea la mesa. Las jarras saltan.', also_to: [mira.id], tags: ['master'] });
    engine.events.emit({ actor_id: mira.id, action_type: 'progress_quest', narration_private: 'Paso cumplido.', observable: null, tags: ['progress'], payload: { quest: { id: 'q1', title: 'La deuda', event: 'step', step: 'Hablar con el alguacil', why: 'Kael lo dio estando tú' } } });
    engine.events.emit({ actor_id: null, at: { spot_id: brenna.location.id, next_spot_id: null, progress: 0, x: 0, y: 0, location_id: engine.world.spot(brenna.location.id).location_id }, action_type: 'board', narration_private: '', observable: '📜 Tablón', visibility: 'public', tags: ['board'] });

    const c = awayCard(engine, mira, from, 2 * 3_600_000);
    expect(c.away).toBe('2 h');
    expect(c.where).toBe(engine.world.spot(brenna.location.id).name);
    expect(c.people).toEqual(['Kael se ha ido; su personaje se queda en la barra.', 'Kael ha vuelto.']);
    expect(c.said).toEqual([{ who: 'Kael', text: 'Mira, te espero fuera', to_me: true }]);
    expect(c.here).toEqual(['Kael golpea la mesa.']);
    expect(c.changes).toEqual([{ text: 'Paso cumplido · La deuda: Hablar con el alguacil', why: 'Kael lo dio estando tú', link: 'ver en el Diario', tab: 'journal' }]);
    expect(c.board).toBe(true);
    expect(awayCardEmpty(c)).toBe(false);
  });

  it('nada de lo leído antes ni de sus propios turnos; lo que no percibió no sale', async () => {
    const { engine, kael, mira } = await bar();
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'x', observable: 'Kael mira la barra.', also_to: [mira.id], tags: ['master'] });
    mira.read_seq = engine.events.lastSeq;
    engine.events.emit({ actor_id: mira.id, action_type: 'master', narration_private: 'Te levantas.', observable: 'Mira se levanta.', tags: ['master'] });
    // Lejos y sin nadie que lo perciba.
    const far = [...engine.world.locations.values()].find((l) => l.id !== engine.world.characterSpot(mira)!.location_id)!;
    const spot = engine.world.spotsOf(far.id)[0]!;
    engine.events.emit({ actor_id: null, at: { spot_id: spot.id, next_spot_id: null, progress: 0, x: spot.x, y: spot.y, location_id: far.id }, action_type: 'master', narration_private: '', observable: 'Algo cae lejos.', tags: [] });
    expect(awayCardEmpty(awayCard(engine, mira, mira.read_seq, AWAY_CARD_MS))).toBe(true);
  });

  it('el jugador que entra o sale en otro sitio se cuenta fuera de la ficción, sin decir dónde', async () => {
    const { engine, kael, mira } = await bar();
    const far = [...engine.world.locations.values()].find((l) => l.id !== engine.world.characterSpot(mira)!.location_id)!;
    const spot = engine.world.spotsOf(far.id)[0]!;
    const at = { spot_id: spot.id, next_spot_id: null, progress: 0, x: spot.x, y: spot.y, location_id: far.id };
    engine.events.emit({ actor_id: kael.id, at, action_type: 'back', narration_private: '', observable: `Kael ha vuelto a ${spot.name}.`, tags: ['presence'] });
    engine.events.emit({ actor_id: kael.id, at, action_type: 'away', narration_private: '', observable: `Kael se ha ido de ${spot.name}.`, tags: ['presence'] });
    expect(awayCard(engine, mira, mira.read_seq!, AWAY_CARD_MS).people).toEqual(['Kael se ha marchado']);
  });

  it('lo que le toca va delante y lo que no cabe se cuenta en «más»', async () => {
    const { engine, kael, mira } = await bar();
    const from = mira.read_seq!;
    for (let i = 0; i < 8; i++) engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'x', observable: `Kael hace la cosa ${i}.`, also_to: [mira.id], tags: ['master'] });
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'x', observable: 'Kael te empuja.', also_to: [mira.id], tags: ['master'], payload: { target_character_id: mira.id } });
    const c = awayCard(engine, mira, from, AWAY_CARD_MS);
    expect(c.here[0]).toBe('Kael te empuja.');
    expect(c.here).toHaveLength(6);
    expect(c.more).toBe(3);
  });
});

describe('tablón', () => {
  it('enseña los encargos del motor, con quién los pide, recompensa y plazo', async () => {
    const { engine, kael } = await bar();
    rotateBoard(engine.world, engine.gameNow(), true);
    const t = tablonView(engine, kael.id);
    const jobs = activeJobs(engine.world);
    expect(t.available.map((j) => j.id)).toEqual(jobs.map((j) => j.id));
    const first = jobs[0]!;
    const shown = t.available[0]!;
    expect(shown.title).toBe(first.title);
    expect(shown.giver?.name).toBe(engine.world.npc(first.giver_npc_id).name);
    expect(shown.reward).toContain(`+${first.reward_reputation} de reputación`);
    expect(shown.fresh).toBe(true);
    expect(t.taken).toEqual([]);
    expect(shown.deadline).toMatch(leavesBoardAt(engine.world, first.id, engine.gameNow()) === null ? /Sin plazo/ : /Hasta .* quedan \d+ (h|días) de juego/);
  });

  it('el plazo es el día en que sale del tablón, coincide con la rotación y nunca es antes de mañana', async () => {
    const { engine } = await bar();
    const w = engine.world;
    const now = engine.gameNow();
    rotateBoard(w, now, true);
    for (const j of activeJobs(w)) {
      const at = leavesBoardAt(w, j.id, now);
      if (at === null) continue;
      expect(at).toBeGreaterThan(now);
      expect(at % GAME_DAY).toBe(0);
      rotateBoard(w, at - 1, true);
      expect(w.campaign.board.active_job_ids).toContain(j.id);
      rotateBoard(w, at, true);
      expect(w.campaign.board.active_job_ids).not.toContain(j.id);
      rotateBoard(w, now, true);
    }
  });

  it('abrirlo es leerlo: entran en el Diario, con su aviso, y dejan de ser nuevos', async () => {
    const { engine, kael } = await bar();
    rotateBoard(engine.world, engine.gameNow(), true);
    const ids = activeJobs(engine.world).map((j) => j.id);
    const before = engine.events.lastSeq;
    engine.readTablon(kael.id);
    expect(Object.keys(boardSeen(kael)).sort()).toEqual([...ids].sort());
    const notices = engine.events.all().filter((e) => e.seq > before && e.actor_id === kael.id && /^progress_/.test(e.action_type));
    expect(notices.length).toBe(ids.length);
    expect(tablonView(engine, kael.id).available.every((j) => !j.fresh)).toBe(true);
    // Una segunda vez no repite avisos.
    const after = engine.events.lastSeq;
    engine.readTablon(kael.id);
    expect(engine.events.lastSeq).toBe(after);
  });

  it('el que coges pasa a «cogidos» y el cumplido a «cumplidos»; fuera del tablón se dice que no se cobra', async () => {
    const { engine, kael } = await bar();
    rotateBoard(engine.world, engine.gameNow(), true);
    const job = activeJobs(engine.world)[0]!;
    engine.readTablon(kael.id);
    const giver = engine.world.npc(job.giver_npc_id);
    kael.location = { type: 'spot', id: giver.location.id };
    // Se coge hablando de él con quien lo pide (journal.ts).
    engine.events.emit({ actor_id: kael.id, action_type: 'master', input_text: `Sobre ${job.title}`, narration_private: `Te cuenta lo de ${job.title}.`, observable: null, tags: ['master'], payload: { npc_id: giver.id } });
    let t = tablonView(engine, kael.id);
    expect(t.taken.map((j) => j.id)).toEqual([job.id]);
    expect(t.available.map((j) => j.id)).not.toContain(job.id);
    const off = leavesBoardAt(engine.world, job.id, engine.gameNow());
    if (off !== null) {
      engine.world.campaign.board.active_job_ids = engine.world.campaign.board.active_job_ids.filter((id) => id !== job.id);
      t = tablonView(engine, kael.id);
      expect(t.taken[0]).toMatchObject({ id: job.id, off_board: true });
      expect(t.taken[0]!.deadline).toContain('no se puede cobrar');
      rotateBoard(engine.world, engine.gameNow(), true);
    }
    kael.completed_jobs.push(job.id);
    t = tablonView(engine, kael.id);
    expect(t.done.map((j) => j.id)).toEqual([job.id]);
    expect(t.taken).toEqual([]);
  });
});

describe('en la web, dos jugadores', () => {
  let web: WebServer | null = null;
  let dir = '';
  afterEach(async () => { await web?.stop(); web = null; if (dir) await rm(dir, { recursive: true, force: true }); });

  /** Lee el SSE hasta que se cumpla `until`. */
  async function readUntil(res: Response, until: (text: string) => boolean, ms = 4000): Promise<string> {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const deadline = Date.now() + ms;
    while (!until(text) && Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, deadline - Date.now())))]);
      if (!chunk || chunk.done) break;
      text += dec.decode(chunk.value);
    }
    reader.releaseLock();
    return text;
  }
  const messages = (text: string): WebMessage[] => [...text.matchAll(/event: message\ndata: (.*)\n\n/g)].map((m) => JSON.parse(m[1]!) as WebMessage);

  async function start(awayCardMs?: number) {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-away-'));
    const time = fakeTime(Date.now());
    const games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: (e) => new Master(e, { client: offlineClient() }), engine: { deterministic: false, now: time.now }, log: () => {}, budget: null });
    web = createWebServer(games, { tickMs: 3_600_000, leaveNoticeMs: 10, log: () => {}, ...(awayCardMs ? { awayCardMs } : {}) });
    await new Promise<void>((resolve) => web!.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
    const { game, character_id } = await games.create({ name: 'Vuelta', mode: 'offline', campaign_id: 'demo', character: { name: 'Lia' } });
    const lia = character_id!;
    const tor = await games.addCharacter(game.slug, 'web:test:2', { name: 'Tor' }, { near: lia });
    const g = `?game=${game.slug}`;
    const engine = await games.open(game.slug);
    const brenna = engine.world.npc('npc_brenna');
    for (const id of [lia, tor]) engine.world.character(id).location = { type: 'spot', id: brenna.location.id };
    const post = (path: string, body: unknown) => fetch(`${base}${path}${g}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const open = (id: string, tab: string) => fetch(`${base}/api/stream${g}&character=${id}&tab=${tab}`);
    const isGone = async (id: string) => { for (let i = 0; i < 100 && !engine.world.character(id).away; i++) await new Promise((r) => setTimeout(r, 10)); };
    return { base, g, engine, lia, tor, post, open, isGone, time };
  }

  it('el que vuelve tras media hora ve la tarjeta correcta al final y hasta dónde había leído', async () => {
    const { engine, lia, tor, post, open, isGone, time } = await start();
    const liaStream = await open(lia, 'lia');
    await readUntil(liaStream, (t) => t.includes('event: presence'));
    const torStream = await open(tor, 'tor');
    await readUntil(torStream, (t) => t.includes('event: presence'));
    const read = engine.events.lastSeq;
    await post('/api/presence', { character: tor, tab: 'tor', state: 'visible', read });
    expect(engine.world.character(tor).read_seq).toBe(read);
    await post('/api/presence', { character: tor, tab: 'tor', state: 'gone', read });
    await torStream.body!.cancel();
    await isGone(tor);

    await post('/api/say', { character: lia, text: `${engine.world.character(tor).name}, vuelve pronto` });
    await post('/api/say', { character: lia, text: 'Me voy a la plaza' });
    time.advanceReal(31 * 60);

    const back = await open(tor, 'tor2');
    const text = await readUntil(back, (t) => t.includes('away_card'));
    await back.body!.cancel();
    expect(JSON.parse(/event: read\ndata: (.*)\n\n/.exec(text)![1]!)).toEqual({ seq: read });
    const card = messages(text).find((m) => m.away_card)?.away_card;
    expect(card).toBeTruthy();
    expect(card!.said.map((s) => s.text)).toEqual(['Tor, vuelve pronto', 'Me voy a la plaza']);
    expect(card!.said.map((s) => s.who)).toEqual(['Lia', 'Lia']);
    expect(card!.away).toBe('31 min');
    await liaStream.body!.cancel();
  });

  it('quien vuelve del velo se despierta y la tarjeta queda detrás, al final del hilo', async () => {
    const { engine, lia, tor, post, open, isGone, time } = await start();
    const liaStream = await open(lia, 'lia');
    await readUntil(liaStream, (t) => t.includes('event: presence'));
    const torStream = await open(tor, 'tor');
    await readUntil(torStream, (t) => t.includes('event: presence'));
    await post('/api/presence', { character: tor, tab: 'tor', state: 'gone', read: engine.events.lastSeq });
    await torStream.body!.cancel();
    await isGone(tor);
    // Lo que hace el servidor a los 30 min sin pestañas (ENGINE_OFFLINE_MS).
    time.advanceReal(31 * 60);
    engine.setPresence(tor, false);
    expect(engine.world.character(tor).veiled).toBe(true);
    await post('/api/say', { character: lia, text: 'Despierta' });
    const back = await open(tor, 'tor2');
    const text = await readUntil(back, (t) => t.includes('away_card'));
    await back.body!.cancel();
    const live = messages(text);
    expect(live.at(-1)?.away_card?.said.map((s) => s.text)).toEqual(['Despierta']);
    expect(live.length).toBeGreaterThan(1);
    expect(engine.world.character(tor).veiled).toBe(false);
    await liaStream.body!.cancel();
  });

  it('un rato fuera no saca tarjeta; solo la marca de leído', async () => {
    const { engine, lia, tor, post, open, isGone, time } = await start();
    const liaStream = await open(lia, 'lia');
    await readUntil(liaStream, (t) => t.includes('event: presence'));
    const torStream = await open(tor, 'tor');
    await readUntil(torStream, (t) => t.includes('event: presence'));
    await post('/api/presence', { character: tor, tab: 'tor', state: 'gone', read: engine.events.lastSeq });
    await torStream.body!.cancel();
    await isGone(tor);
    await post('/api/say', { character: lia, text: 'Hola' });
    time.advanceReal(5 * 60);
    const back = await open(tor, 'tor2');
    const text = await readUntil(back, (t) => t.includes('event: presence'), 600);
    await new Promise((r) => setTimeout(r, 50));
    await back.body!.cancel();
    expect(text).not.toContain('away_card');
    expect(text).toContain('event: read');
    await liaStream.body!.cancel();
  });

  it('sin nada que contar, una línea en vez de una tarjeta vacía; el Tablón sale por la API', async () => {
    // Un minuto: en más, la gente del pueblo se mueve y ya hay algo que contar.
    const { base, g, engine, lia, tor, post, open, isGone, time } = await start(60_000);
    const torStream = await open(tor, 'tor');
    await readUntil(torStream, (t) => t.includes('event: presence'));
    await post('/api/presence', { character: tor, tab: 'tor', state: 'gone', read: engine.events.lastSeq });
    await torStream.body!.cancel();
    await isGone(tor);
    engine.world.character(tor).read_seq = engine.events.lastSeq;
    time.advanceReal(60);
    const back = await open(tor, 'tor2');
    const text = await readUntil(back, (t) => t.includes('nada nuevo'));
    await back.body!.cancel();
    expect(text).not.toContain('away_card');
    expect(messages(text).find((m) => m.notice)?.notice?.text).toBe('Has estado fuera 1 min: nada nuevo a tu alrededor');

    rotateBoard(engine.world, engine.gameNow(), true);
    const ids = activeJobs(engine.world).map((j) => j.id);
    const view = await (await fetch(`${base}/api/tablon${g}&character=${lia}`)).json() as ReturnType<typeof tablonView>;
    expect(view.available.map((j) => j.id)).toEqual(ids);
    expect(Object.keys(boardSeen(engine.world.character(lia)))).toEqual([]);
    const read = await (await post('/api/tablon/read', { character: lia })).json() as ReturnType<typeof tablonView>;
    expect(read.available.every((j) => j.fresh)).toBe(true);
    expect(Object.keys(boardSeen(engine.world.character(lia))).sort()).toEqual([...ids].sort());
  });
});
