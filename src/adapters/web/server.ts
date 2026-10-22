/**
 * Adaptador web local: un menú de partidas y, por partida, una página con el
 * #pov de cada personaje, botones de acciones sugeridas y 🎲, y la hoja al lado.
 * Mismo motor que Discord y el REPL; un motor por partida, vía el gestor.
 *
 *   GET    /                                   menú (sin ?game) o la partida (con ?game=SLUG)
 *   GET    /api/games                          partidas, opciones de personaje y si hay clave de API
 *   POST   /api/games          {name, mode, character?, race?, class?, hook?, dice_seed?, world?: {seed?, tone?, setting?}}
 *   DELETE /api/games?game=SLUG
 *   POST   /api/games/demo?game=SLUG           grabación → demo
 *   POST   /api/games/reset?game=SLUG          demo desde el principio
 *
 * Todas estas llevan ?game=SLUG (400 si falta):
 *   GET  /api/characters            personajes de la campaña
 *   GET  /api/stream?character=ID   entregas de ese PJ (Server-Sent Events)
 *   GET  /api/sheet?character=ID    hoja viva
 *   GET  /api/journal?character=ID  diario: misiones, conversaciones, crónica y lugares (journal.ts)
 *   GET  /api/board?character=ID    tablero
 *   GET  /api/map?character=ID      mapa de zona y región
 *   GET  /api/scene?character=ID    ilustración de la localización actual (IMAGES=on), o null
 *   GET  /images/<fichero>          ilustraciones descargadas de la partida (data/games/<slug>/images)
 *   GET  /assets/<fichero>          imágenes fijas de la interfaz (public/), sin ?game
 *   POST /api/act      {character, text}
 *   POST /api/roll     {character}
 *   POST /api/command  {character, name}
 *   GET  /api/tts/config  ·  POST /api/tts?game=SLUG   narrador de voz (tts.ts)
 *   GET  /api/sfx?character=ID  ·  GET /api/sfx?key=CLAVE   sonido: estado del PJ y ficheros (sfx.ts)
 *   GET|POST /api/illustrate?character=ID  pincel: ilustrar el momento actual (paint.ts)
 *   GET|POST /api/avatar?character=ID  avatar del PJ: versiones, «Otro», «Descríbelo», elegir (avatar.ts)
 *
 * Sin autenticación: escucha solo en 127.0.0.1 y cualquiera con la página juega con cualquier PJ.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine, ActionResult } from '../../engine/engine.js';
import type { GameEvent, Id } from '../../engine/model.js';
import type { Delivery } from '../../engine/events.js';
import { GameError, GameManager, NEW_GAME_MODES, type NewGameMode, type WorldInput } from '../../games/manager.js';
import { Master } from '../../ai/master.js';
import { sheetView } from '../sheet-view.js';
import { PAGE } from './page.js';
import { MENU } from './page-menu.js';
import { handleBoardRequest } from './board.js';
import { handleMapRequest } from './regionmap.js';
import { handleTtsRequest } from './tts.js';
import { handleSfxRequest } from './sfx.js';
import { soundCuesOf } from './soundmap.js';
import { illustratorOf, MASTER_PORTRAIT_ID, masterPortraitOf, portraitOf, sceneOf, type EntityInput, type Illustrator, type SceneImage } from '../../ai/illustrate.js';
import { type DialogueLine, type Moment } from '../../engine/moments.js';
import { blocksSpeech, novelBlocks, type NovelBlock } from './novel.js';
import { handleJournalRequest, noticeOf, touchesJournal, type WebNotice } from './journal.js';
import { handlePaintRequest } from './paint.js';
import { handleAvatarRequest } from './avatar.js';

const MASTER_TYPES = new Set(['master', 'master_roll_outcome', 'master_intro', 'master_arrival', 'prologue', 'recap']);
const HISTORY = 200;
/** Avisos fuera de la ficción: tiradas, progreso, anuncios, tablón. Lo demás lo cuenta el narrador. */
const SYSTEM_TYPES = /^(roll|progress_|announcement|board|admin_|decisive_expired)/;

/** Un parlamento en modo novela: quién habla (nombre visible para este PJ) y su retrato pequeño si ya existe. */
interface WebLine { speaker: 'npc' | 'actor'; id: Id; name: string; text: string; avatar?: string | null }
/** Momento ilustrado junto al evento (retrato, objeto, combate, descubrimiento); `src` cuando ya está en disco. */
interface WebMoment { kind: Moment['kind']; key: string; entity_id: Id; name?: string; src?: string }

interface WebMessage {
  seq: number;
  kind: 'master' | 'system';
  text: string;
  /** Botones: solo para el actor del evento. */
  roll?: { kind: string; key: string; dc: number | null };
  suggested?: string[];
  decisive_s?: number;
  /** Modo novela (solo para el actor): la narración sin los parlamentos y, aparte, cada parlamento. */
  prose?: string;
  lines?: WebLine[];
  /** El turno en orden (narración, parlamento, narración…): cada bloque es su burbuja. `line` indexa `lines`. */
  blocks?: NovelBlock[];
  /** Lo que lee el narrador de voz: los bloques tal como se pintan. */
  speech?: string;
  moments?: WebMoment[];
  /** Ilustración de la localización: un mensaje más del hilo, en el sitio donde se mostró. */
  scene?: { location_id: Id; name: string; src: string };
  /** Lo que hizo o dijo el propio jugador (su mensaje a la derecha del hilo), si este evento lo responde. */
  input?: string;
  /** Lo cuenta el narrador (burbuja suya); si no, es un aviso del sistema (tirada, progreso, tablón). */
  narrator?: boolean;
  /** Sonido (solo para el actor): claves en orden, de soundmap.ts. */
  sfx?: string[];
  /** Aviso de una línea en lugar de burbuja (tablón, progreso): lleva al Diario. */
  notice?: WebNotice;
  /** Prólogo o «Donde lo dejamos» (docs/PROLOGO.md): página de libro con su título, sin avatar. */
  chapter?: { kind: 'prologue' | 'recap'; title: string };
}

/** Lo que la web cuelga de cada motor abierto: conexiones SSE e historial en memoria. */
interface Runtime {
  engine: Engine;
  streams: Map<Id, Set<ServerResponse>>;
  history: Map<Id, WebMessage[]>;
  /** Pone en el hilo del PJ la escena de donde está, si aún no la tiene ahí. */
  offerScene: (characterId: Id) => void;
  dispose: () => void;
}

export interface WebServer {
  server: Server;
  /** Para el tick, cierra las conexiones y vuelca todas las partidas. */
  stop(): Promise<void>;
}

export function createWebServer(games: GameManager, opts: { tickMs?: number } = {}): WebServer {
  const runtimes = new Map<string, Promise<Runtime>>();

  const timer = setInterval(() => {
    void games.openEngines().then((list) => { for (const [, e] of list) void e.tick(); });
  }, opts.tickMs ?? 10_000);

  const offClose = games.onClose((slug) => {
    const p = runtimes.get(slug);
    runtimes.delete(slug);
    void p?.then((rt) => rt.dispose(), () => {});
  });

  function runtime(slug: string): Promise<Runtime> {
    const existing = runtimes.get(slug);
    if (existing) return existing;
    const p = games.open(slug).then((engine) => attach(engine, slug));
    runtimes.set(slug, p);
    p.catch(() => { if (runtimes.get(slug) === p) runtimes.delete(slug); });
    return p;
  }

  function attach(engine: Engine, slug: string): Runtime {
    for (const c of engine.world.characters.values()) engine.setPresence(c.id, true);
    const streams = new Map<Id, Set<ServerResponse>>();
    const history = new Map<Id, WebMessage[]>();
    // Al abrir la partida, el hilo de cada PJ se reconstruye del log de eventos: un reinicio no borra lo jugado.
    for (const c of engine.world.characters.values()) {
      const past = engine.events.forCharacter(c.id, null).slice(-HISTORY).map((d) => toMessage(d, engine));
      if (past.length) history.set(c.id, past);
    }
    const send = (characterId: Id, type: string, data: unknown) => {
      for (const res of streams.get(characterId) ?? []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const record = (characterId: Id, m: WebMessage) => {
      const h = history.get(characterId) ?? [];
      h.push(m);
      if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
      history.set(characterId, h);
      send(characterId, 'message', withImages(m, illustratorOf(engine), slug));
    };
    // La escena del sitio es un mensaje más del hilo: entra al llegar (o cuando acaba de pintarse) y se queda ahí.
    const sceneShown = new Map<Id, Id>();
    const offerScene = (characterId: Id, image?: SceneImage) => {
      const c = engine.world.characters.get(characterId);
      const loc = c ? engine.world.characterSpot(c)?.location_id : undefined;
      if (!loc || sceneShown.get(characterId) === loc) return;
      const img = image ?? illustratorOf(engine)?.imageFor(loc) ?? null;
      if (!img || img.location_id !== loc) return;
      sceneShown.set(characterId, loc);
      const last = history.get(characterId)?.at(-1);
      record(characterId, { seq: last?.seq ?? 0, kind: 'system', text: '', scene: sceneView(img, slug) });
    };
    // El diario cambia con lo que el PJ vive: se avisa (agrupado) y la página lo vuelve a pedir.
    const journalTimers = new Map<Id, NodeJS.Timeout>();
    const notifyJournal = (characterId: Id) => {
      if (journalTimers.has(characterId)) return;
      journalTimers.set(characterId, setTimeout(() => { journalTimers.delete(characterId); send(characterId, 'journal', {}); }, 300));
    };
    const offDelivery = engine.onDelivery((d: Delivery) => {
      record(d.character_id, toMessage(d, engine));
      offerScene(d.character_id);
      if (touchesJournal(d.event)) notifyJournal(d.character_id);
    });
    const offScene = illustratorOf(engine)?.onIllustrated((r) => offerScene(r.character_id, r.image)) ?? (() => {});
    // Retrato u objeto listo: aparece junto a su evento en el hilo del PJ; los retratos, en cada parlamento.
    const offEntity = illustratorOf(engine)?.onEntity((r) => {
      const src = imageSrc(r.image, slug);
      if (r.image.kind === 'portrait' && r.image.entity_id) for (const id of streams.keys()) send(id, 'portrait', { id: r.image.entity_id, src });
      if (r.character_id && r.moment_key && r.event_seq !== null) {
        send(r.character_id, 'moment', { seq: r.event_seq, key: r.moment_key, kind: r.image.kind, entity_id: r.image.entity_id, name: r.image.name, src });
      }
    }) ?? (() => {});
    // La hoja se refresca cuando cambia algo del PJ o de los ítems (como #hoja en Discord).
    let sheetTimer: NodeJS.Timeout | null = null;
    const offChange = engine.world.onChange((ch) => {
      // Rumores (campaña) y memoria de los NPC: el diario también los recoge.
      if (ch.collection === 'campaign' || ch.collection === 'npcs') for (const id of streams.keys()) notifyJournal(id);
      if (ch.collection !== 'characters' && ch.collection !== 'item_instances') return;
      if (ch.collection === 'characters') notifyJournal(ch.id);
      if (sheetTimer) return;
      sheetTimer = setTimeout(() => { sheetTimer = null; for (const id of streams.keys()) send(id, 'sheet', {}); }, 300);
    });
    return {
      engine, streams, history, offerScene,
      dispose() {
        offDelivery(); offChange(); offScene(); offEntity();
        if (sheetTimer) clearTimeout(sheetTimer);
        for (const t of journalTimers.values()) clearTimeout(t);
        for (const set of streams.values()) for (const res of set) res.end();
        streams.clear();
      },
    };
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof GameError) { if (!res.headersSent) json(res, e.status, { ok: false, text: e.message }); else res.end(); return; }
      console.error('[web]', e);
      if (!res.headersSent) json(res, 500, { ok: false, text: 'Error interno del servidor.' });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const slug = url.searchParams.get('game');

    if (req.method === 'GET' && url.pathname === '/') {
      if (slug && !(await games.get(slug))) { res.writeHead(302, { location: '/' }); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(slug ? PAGE : MENU);
      return;
    }
    if (url.pathname === '/api/games' || url.pathname.startsWith('/api/games/')) { await handleGames(req, res, url, slug); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) { await serveImage(res, url.pathname.slice('/images/'.length), slug); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) { await serveAsset(res, url.pathname.slice('/assets/'.length)); return; }
    if (url.pathname === '/api/tts' || url.pathname.startsWith('/api/tts/')) { await handleTtsRequest(req, res, url, games); return; }
    if (!url.pathname.startsWith('/api/')) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }

    if (!slug) { json(res, 400, { ok: false, text: 'Falta el parámetro game (?game=<partida>): abre una partida desde el menú.' }); return; }
    if (!(await games.get(slug))) { json(res, 404, { ok: false, text: `No existe la partida «${slug}».` }); return; }
    const rt = await runtime(slug);
    const { engine } = rt;
    const characterParam = url.searchParams.get('character');

    if (req.method === 'GET' && url.pathname === '/api/characters') {
      json(res, 200, [...engine.world.characters.values()].filter((c) => c.status !== 'retired').map((c) => ({ id: c.id, name: c.name })));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const id = characterOr404(engine, characterParam, res);
      if (!id) return;
      // Vuelve tras días sin jugar: «Donde lo dejamos» entra en el historial antes de mandarlo.
      await engine.welcomeBack(id).catch((e) => console.error('[web] recap:', e));
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const ill = illustratorOf(engine);
      rt.offerScene(id);
      // En una sola escritura: quién habla y el historial llegan juntos.
      res.write(`event: cast\ndata: ${JSON.stringify(castOf(engine, id, ill, slug))}\n\n`
        + `event: history\ndata: ${JSON.stringify((rt.history.get(id) ?? []).map((m) => withImages(m, ill, slug)))}\n\n`);
      const set = rt.streams.get(id) ?? new Set();
      set.add(res);
      rt.streams.set(id, set);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { clearInterval(ping); set.delete(res); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/board') { handleBoardRequest(engine, req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/journal') { handleJournalRequest(engine, req, res, url, slug); return; }
    if (url.pathname === '/api/avatar') { await handleAvatarRequest(engine, req, res, url, slug); return; }
    if (url.pathname === '/api/illustrate') { await handlePaintRequest(engine, req, res, url, slug, rt.streams); return; }
    if (req.method === 'GET' && url.pathname === '/api/map') { handleMapRequest(engine, req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/sfx') { await handleSfxRequest(engine, res, url, games.paths((await games.get(slug))!).dir); return; }
    if (req.method === 'GET' && url.pathname === '/api/scene') {
      const id = characterOr404(engine, characterParam, res);
      if (!id) return;
      const loc = engine.world.characterSpot(engine.world.character(id))?.location_id;
      const ill = illustratorOf(engine);
      const img = loc && ill ? ill.imageFor(loc) : null;
      // Partidas que ya estaban en marcha al activar IMAGES: la escena actual se encola una vez y llega por el stream.
      if (loc && ill && !img) void ill.illustrate(sceneOf(engine, loc), id);
      json(res, 200, { image: img ? sceneView(img, slug) : null });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sheet') {
      const id = characterOr404(engine, characterParam, res);
      if (id) json(res, 200, sheetView(engine, id));
      return;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const id = characterOr404(engine, typeof body['character'] === 'string' ? body['character'] : null, res);
      if (!id) return;
      switch (url.pathname) {
        case '/api/act': {
          const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
          if (!text) { json(res, 400, { ok: false, text: 'Acción vacía.' }); return; }
          json(res, 200, reply(await engine.act(id, text)));
          return;
        }
        case '/api/roll': json(res, 200, reply(await engine.rollPending(id))); return;
        case '/api/command': {
          const name = typeof body['name'] === 'string' ? body['name'] : '';
          json(res, 200, { ok: true, text: await engine.command(id, name) });
          return;
        }
      }
    }
    json(res, 404, { ok: false, text: 'No encontrado.' });
  }

  /** Solo ficheros de la carpeta images/ de la partida, con nombre plano (sin rutas). */
  async function serveImage(res: ServerResponse, name: string, slug: string | null): Promise<void> {
    const m = slug ? await games.get(slug) : null;
    if (!m || !/^[A-Za-z0-9_-]+\.jpg$/.test(name)) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    let bytes: Buffer;
    try { bytes = await readFile(join(games.paths(m).dir, 'images', name)); } catch { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
    res.end(bytes);
  }

  /** Imágenes fijas de la interfaz: public/ en la raíz del proyecto (vale igual desde src/ que desde dist/). */
  async function serveAsset(res: ServerResponse, name: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+\.jpg$/.test(name)) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    let bytes: Buffer;
    try { bytes = await readFile(new URL('../../../public/' + name, import.meta.url)); } catch { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
    res.end(bytes);
  }

  async function handleGames(req: IncomingMessage, res: ServerResponse, url: URL, slug: string | null): Promise<void> {
    if (url.pathname === '/api/games' && req.method === 'GET') {
      json(res, 200, { games: await games.list(), options: GameManager.characterOptions(), api_key: Master.configured('live') });
      return;
    }
    if (url.pathname === '/api/games' && req.method === 'POST') {
      const body = await readJson(req);
      const mode = body['mode'];
      if (typeof mode !== 'string' || !(NEW_GAME_MODES as readonly string[]).includes(mode)) { json(res, 400, { ok: false, text: 'Elige un modo: real, offline o grabar demo.' }); return; }
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
      const seedRaw = body['dice_seed'];
      const dice_seed = seedRaw === null || seedRaw === undefined || seedRaw === '' ? null : Number(seedRaw);
      const created = await games.create({
        name: str('name'), mode: mode as NewGameMode, dice_seed,
        character: str('character') ? { name: str('character'), ...(str('race') ? { race_id: str('race') } : {}), ...(str('class') ? { class_id: str('class') } : {}), ...(str('hook') ? { hook: str('hook') } : {}), ...(str('appearance') ? { appearance: str('appearance') } : {}) } : null,
        // Mundo nuevo generado (src/worldgen); lo valida el gestor.
        world: body['world'] && typeof body['world'] === 'object' ? body['world'] as WorldInput : null,
      });
      // Con máster, la llegada del PJ nuevo la narra él (como en Discord); llega por el stream.
      const rt = await runtime(created.game.slug);
      if (created.character_id) {
        rt.engine.setPresence(created.character_id, true);
        void rt.engine.introduce(created.character_id).catch((e) => console.error('[web] intro:', e));
      }
      json(res, 200, { ok: true, game: await games.info(created.game), character_id: created.character_id });
      return;
    }
    if (!slug) { json(res, 400, { ok: false, text: 'Falta el parámetro game (?game=<partida>).' }); return; }
    if (url.pathname === '/api/games' && req.method === 'DELETE') {
      await games.delete(slug);
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/games/demo' && req.method === 'POST') {
      json(res, 200, { ok: true, game: await games.info(await games.convertToDemo(slug)) });
      return;
    }
    if (url.pathname === '/api/games/reset' && req.method === 'POST') {
      json(res, 200, { ok: true, game: await games.info(await games.resetDemo(slug)) });
      return;
    }
    json(res, 404, { ok: false, text: 'No encontrado.' });
  }

  return {
    server,
    async stop() {
      clearInterval(timer);
      offClose();
      for (const p of runtimes.values()) void p.then((rt) => rt.dispose(), () => {});
      runtimes.clear();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections(); // keep-alive y SSE: si no, close espera a que caduquen
      await closed;
      await games.closeAll();
    },
  };
}

export async function startWeb(games: GameManager, port: number): Promise<void> {
  const web = createWebServer(games);
  await new Promise<void>((resolve) => web.server.listen(port, '127.0.0.1', resolve));
  console.log(`[web] abre http://localhost:${port}`);
  await new Promise<void>((resolve) => {
    const stop = () => { void web.stop().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

function characterOr404(engine: Engine, id: string | null, res: ServerResponse): Id | null {
  if (id && engine.world.characters.has(id)) return id;
  json(res, 404, { ok: false, text: 'No existe ese personaje.' });
  return null;
}

/** Con evento, la narración ya llegó por el stream; sin él (consultas, errores) va en la respuesta. */
function reply(r: ActionResult): { ok: boolean; text: string | null } {
  if (!r.ok) return { ok: false, text: r.text };
  return { ok: true, text: r.event ? null : r.text };
}

function toMessage(d: Delivery, engine: Engine): WebMessage {
  const e: GameEvent = d.event;
  const m: WebMessage = { seq: e.seq, kind: MASTER_TYPES.has(e.action_type) ? 'master' : 'system', text: d.text };
  // Tablón y progreso: fuera del hilo; queda un aviso de una línea que lleva al Diario (también en el historial restaurado).
  const notice = noticeOf(e);
  if (notice) { m.text = ''; m.notice = notice; return m; }
  if (!SYSTEM_TYPES.test(e.action_type)) m.narrator = true;
  if (e.actor_id !== d.character_id) return m;
  if (e.action_type === 'prologue' || e.action_type === 'recap') {
    m.chapter = { kind: e.action_type, title: typeof e.payload['title'] === 'string' ? e.payload['title'] : '' };
    m.speech = `${m.chapter.title}. ${d.text.replace(/\*\*/g, '')}`;
    return m;
  }
  // La tirada y su desenlace no repiten la acción: ya salió en el mensaje que pidió la tirada.
  if (e.input_text && e.action_type !== 'master_roll_outcome' && !e.input_text.startsWith('(')) m.input = e.input_text;
  const sfx = soundCuesOf(engine, e);
  if (sfx.length) m.sfx = sfx;
  const novel = novelOf(e, engine, d.character_id, d.text);
  if (novel) { m.prose = novel.prose; m.lines = novel.lines; m.blocks = novel.blocks; m.speech = novel.speech; }
  const moments = (Array.isArray(e.payload['moments']) ? e.payload['moments'] as Moment[] : [])
    .filter((x) => x.kind !== 'scene' && x.character_id === d.character_id)
    .map((x) => ({ kind: x.kind, key: x.key, entity_id: x.entity_id }));
  if (moments.length) m.moments = moments;
  const roll = e.payload['requires_roll'] as { kind: string; key: string; dc: number | null } | undefined;
  if (roll) m.roll = { kind: roll.kind, key: roll.key, dc: roll.dc };
  else if (Array.isArray(e.payload['suggested_actions'])) m.suggested = (e.payload['suggested_actions'] as string[]).slice(0, 4);
  const decisive = e.payload['decisive'] as { window_s: number } | undefined;
  if (decisive) m.decisive_s = decisive.window_s;
  return m;
}

/**
 * Parlamentos del cierre para el actor: cada uno con el nombre que ese PJ conoce
 * (si no sabe cómo se llama el NPC, su rol) y la prosa sin esas frases.
 */
function novelOf(e: GameEvent, engine: Engine, characterId: Id, text: string): { prose: string; lines: WebLine[]; blocks: NovelBlock[]; speech: string } | null {
  const raw = e.payload['lines'];
  if (!Array.isArray(raw) || !raw.length) return null;
  const w = engine.world;
  const me = w.characters.get(characterId);
  const lines: WebLine[] = [];
  const kept: DialogueLine[] = [];
  for (const l of raw as DialogueLine[]) {
    if (l.speaker === 'actor' && me) lines.push({ speaker: 'actor', id: me.id, name: me.name, text: l.text });
    else if (l.speaker === 'npc' && l.npc_id) {
      const npc = w.npcs.get(l.npc_id);
      if (!npc) continue;
      const known = me?.knows.includes(npc.id) ?? false;
      lines.push({ speaker: 'npc', id: npc.id, name: known ? npc.name : npc.role.charAt(0).toUpperCase() + npc.role.slice(1), text: l.text });
    } else continue;
    kept.push(l);
  }
  if (!lines.length) return null;
  const blocks = novelBlocks(text, kept);
  return {
    prose: blocks.filter((b) => b.kind === 'prose').map((b) => (b as { text: string }).text).join(' '),
    lines, blocks, speech: blocksSpeech(blocks, kept),
  };
}

/**
 * Quién habla en el hilo de este PJ: el narrador (con su retrato de «ente») y el
 * propio PJ. Si aún no tienen retrato, se encargan una vez y llegan por «portrait».
 */
function castOf(engine: Engine, characterId: Id, ill: Illustrator | null, slug: string): { master: { id: Id; name: string; avatar: string | null }; me: { id: Id; name: string; avatar: string | null } } {
  const c = engine.world.character(characterId);
  const avatar = (id: Id, make: () => EntityInput | null): string | null => {
    if (!ill) return null;
    const img = ill.entityImage('portrait', id);
    if (img) return imageSrc(img, slug);
    const input = make();
    if (input) void ill.illustrateEntity(input);
    return null;
  };
  const loc = engine.world.characterSpot(c)?.location_id ?? '';
  const name = engine.world.campaign.master.name.trim() || 'el Narrador';
  return {
    master: { id: MASTER_PORTRAIT_ID, name: name.charAt(0).toUpperCase() + name.slice(1), avatar: avatar(MASTER_PORTRAIT_ID, () => masterPortraitOf(engine, loc)) },
    me: { id: c.id, name: c.name, avatar: avatar(c.id, () => portraitOf(engine, c.id, loc)) },
  };
}

/** El mensaje con lo que ya esté ilustrado: retratos de quien habla y las imágenes de sus momentos. */
function withImages(m: WebMessage, ill: Illustrator | null, slug: string): WebMessage {
  if (!ill || (!m.lines && !m.moments)) return m;
  const out: WebMessage = { ...m };
  if (m.lines) out.lines = m.lines.map((l) => { const img = ill.entityImage('portrait', l.id); return img ? { ...l, avatar: imageSrc(img, slug) } : l; });
  if (m.moments) {
    out.moments = m.moments.map((x) => {
      const img = x.kind === 'scene' ? null : ill.entityImage(x.kind, x.entity_id);
      return img ? { ...x, name: img.name, src: imageSrc(img, slug) } : x;
    });
  }
  return out;
}

function imageSrc(img: SceneImage, slug: string): string {
  return `/images/${img.file}?game=${encodeURIComponent(slug)}`;
}

/** Lo que pinta la página: el fichero descargado, servido por /images. */
function sceneView(img: SceneImage, slug: string): { location_id: Id; name: string; src: string } {
  return { location_id: img.location_id, name: img.name, src: `/images/${img.file}?game=${encodeURIComponent(slug)}` };
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error('cuerpo demasiado grande');
  }
  try {
    const v: unknown = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
