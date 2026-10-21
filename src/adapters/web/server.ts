/**
 * Adaptador web local: un menú de partidas y, por partida, una página con el
 * #pov de cada personaje, botones de acciones sugeridas y 🎲, y la hoja al lado.
 * Mismo motor que Discord y el REPL; un motor por partida, vía el gestor.
 *
 *   GET    /                                   menú (sin ?game) o la partida (con ?game=SLUG)
 *   GET    /api/games                          partidas, opciones de personaje y si hay clave de API
 *   POST   /api/games          {name, mode, character?, race?, class?, dice_seed?}
 *   DELETE /api/games?game=SLUG
 *   POST   /api/games/demo?game=SLUG           grabación → demo
 *   POST   /api/games/reset?game=SLUG          demo desde el principio
 *
 * Todas estas llevan ?game=SLUG (400 si falta):
 *   GET  /api/characters            personajes de la campaña
 *   GET  /api/stream?character=ID   entregas de ese PJ (Server-Sent Events)
 *   GET  /api/sheet?character=ID    hoja viva
 *   GET  /api/board?character=ID    tablero
 *   GET  /api/map?character=ID      mapa de zona y región
 *   GET  /api/scene?character=ID    ilustración de la localización actual (IMAGES=on), o null
 *   GET  /images/<fichero>          ilustraciones descargadas de la partida (data/games/<slug>/images)
 *   POST /api/act      {character, text}
 *   POST /api/roll     {character}
 *   POST /api/command  {character, name}
 *
 * Sin autenticación: escucha solo en 127.0.0.1 y cualquiera con la página juega con cualquier PJ.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine, ActionResult } from '../../engine/engine.js';
import type { GameEvent, Id } from '../../engine/model.js';
import type { Delivery } from '../../engine/events.js';
import { GameError, GameManager, NEW_GAME_MODES, type NewGameMode } from '../../games/manager.js';
import { Master } from '../../ai/master.js';
import { sheetView } from '../sheet-view.js';
import { PAGE } from './page.js';
import { MENU } from './page-menu.js';
import { handleBoardRequest } from './board.js';
import { handleMapRequest } from './regionmap.js';
import { illustratorOf, sceneOf, type SceneImage } from '../../ai/illustrate.js';

const MASTER_TYPES = new Set(['master', 'master_roll_outcome', 'master_intro', 'master_arrival']);
const HISTORY = 200;

interface WebMessage {
  seq: number;
  kind: 'master' | 'system';
  text: string;
  /** Botones: solo para el actor del evento. */
  roll?: { kind: string; key: string; dc: number | null };
  suggested?: string[];
  decisive_s?: number;
}

/** Lo que la web cuelga de cada motor abierto: conexiones SSE e historial en memoria. */
interface Runtime {
  engine: Engine;
  streams: Map<Id, Set<ServerResponse>>;
  history: Map<Id, WebMessage[]>;
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
    const send = (characterId: Id, type: string, data: unknown) => {
      for (const res of streams.get(characterId) ?? []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const offDelivery = engine.onDelivery((d: Delivery) => {
      const m = toMessage(d);
      const h = history.get(d.character_id) ?? [];
      h.push(m);
      if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
      history.set(d.character_id, h);
      send(d.character_id, 'message', m);
    });
    // Ilustración nueva: la escena del PJ cambia sobre el chat.
    const offScene = illustratorOf(engine)?.onIllustrated((r) => {
      const c = engine.world.characters.get(r.character_id);
      if (c && engine.world.characterSpot(c)?.location_id === r.image.location_id) send(r.character_id, 'scene', sceneView(r.image, slug));
    }) ?? (() => {});
    // La hoja se refresca cuando cambia algo del PJ o de los ítems (como #hoja en Discord).
    let sheetTimer: NodeJS.Timeout | null = null;
    const offChange = engine.world.onChange((ch) => {
      if (ch.collection !== 'characters' && ch.collection !== 'item_instances') return;
      if (sheetTimer) return;
      sheetTimer = setTimeout(() => { sheetTimer = null; for (const id of streams.keys()) send(id, 'sheet', {}); }, 300);
    });
    return {
      engine, streams, history,
      dispose() {
        offDelivery(); offChange(); offScene();
        if (sheetTimer) clearTimeout(sheetTimer);
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
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: history\ndata: ${JSON.stringify(rt.history.get(id) ?? [])}\n\n`);
      const set = rt.streams.get(id) ?? new Set();
      set.add(res);
      rt.streams.set(id, set);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { clearInterval(ping); set.delete(res); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/board') { handleBoardRequest(engine, req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/map') { handleMapRequest(engine, req, res, url); return; }
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
        character: str('character') ? { name: str('character'), ...(str('race') ? { race_id: str('race') } : {}), ...(str('class') ? { class_id: str('class') } : {}) } : null,
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

function toMessage(d: Delivery): WebMessage {
  const e: GameEvent = d.event;
  const m: WebMessage = { seq: e.seq, kind: MASTER_TYPES.has(e.action_type) ? 'master' : 'system', text: d.text };
  if (e.actor_id !== d.character_id) return m;
  const roll = e.payload['requires_roll'] as { kind: string; key: string; dc: number | null } | undefined;
  if (roll) m.roll = { kind: roll.kind, key: roll.key, dc: roll.dc };
  else if (Array.isArray(e.payload['suggested_actions'])) m.suggested = (e.payload['suggested_actions'] as string[]).slice(0, 4);
  const decisive = e.payload['decisive'] as { window_s: number } | undefined;
  if (decisive) m.decisive_s = decisive.window_s;
  return m;
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
