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
 *   GET  /api/board/background?character=ID  fondo pintado del plano donde está el PJ (JPEG)
 *   GET  /api/map?character=ID      mapa de zona y región
 *   GET  /api/scene?character=ID    ilustración de la localización actual (IMAGES=on), o null
 *   GET  /images/<fichero>          ilustraciones descargadas de la partida (data/games/<slug>/images)
 *   GET  /assets/<fichero>          imágenes fijas de la interfaz (public/), sin ?game
 *   POST /api/act      {character, text}
 *   POST /api/say      {character, text, to?, mode?}   decir sin máster: la frase literal del PJ (party.ts)
 *   POST /api/offer    {character, offer, accept}      aceptar o rechazar lo que otro PJ le ofrece
 *   POST /api/typing   {character}                     «está escribiendo…» a los demás PJ del sitio (SSE «typing»)
 * SSE «round»: ronda abierta en escena tensa (scene.ts): número, quién falta y cuándo vence.
 *   POST /api/roll     {character}
 *   POST /api/command  {character, name}
 *   GET  /api/tts/config  ·  POST /api/tts?game=SLUG   narrador de voz (tts.ts)
 *   GET  /api/sfx?character=ID  ·  GET /api/sfx?key=CLAVE   sonido: estado del PJ y ficheros (sfx.ts)
 *   GET|POST /api/illustrate?character=ID  pincel: ilustrar el momento actual (paint.ts)
 *   GET|POST /api/avatar?character=ID  avatar del PJ: versiones, «Otro», «Descríbelo», elegir (avatar.ts)
 *
 * Acceso (access.ts, docs/MULTIJUGADOR.md): en modo `invite` cada persona entra con el enlace de su
 * asiento y queda ligada a ese PJ; el menú, crear partidas y los asientos son del anfitrión. En `open`
 * (local), cualquiera con la página juega con cualquier PJ, como antes.
 *   GET  /i/<partida>/<token>       entra por ese asiento (cookie firmada) y abre la partida
 *   GET  /admin?token=ADMIN_TOKEN   anfitrión: cookie y al menú
 *   GET  /invitaciones?game=SLUG    anfitrión: asientos y enlaces
 *   GET  /api/session?game=SLUG     quién soy: anfitrión o jugador, y mi PJ si estoy ligado
 *   GET|POST /api/seats?game=SLUG · POST /api/seats/regenerate   anfitrión: listar, añadir, renovar
 *   POST /api/seat/claim?game=SLUG  asiento libre: crea el PJ del invitado
 * Presencia: SSE «presence» con quién está en línea y dónde respecto a ti; avisos en el hilo al entrar y salir.
 * Una acción a la vez por PJ (409 si ya tiene una en curso) y SSE «queue» si espera a otro PJ del mismo sitio.
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
import { handleBoardBackgroundRequest, handleBoardRequest } from './board.js';
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
import { journeyOf } from '../../engine/travel.js';
import { accessFromEnv, checkSeatCookie, cookies, isAdmin, isHostSeat, adminTokenMatches, newSeat, randomToken, SeatStore, seatCookieName, seatCookieValue, seatIdOf, setAdminCookie, setCookie, type AccessOptions, type Seat } from './access.js';
import { invitePage, joinPage, seatsPage } from './page-access.js';
import { pcLabel, pcName } from '../../engine/party.js';
import { talkingWith } from '../../engine/scene.js';
import { descriptorOf } from '../../engine/narrate.js';
import type { SceneNotice } from '../../engine/engine.js';

const MASTER_TYPES = new Set(['master', 'master_roll_outcome', 'master_intro', 'master_arrival', 'prologue', 'recap']);
const HISTORY = 200;
/** Avisos fuera de la ficción: tiradas, progreso, anuncios, tablón. Lo demás lo cuenta el narrador. */
const SYSTEM_TYPES = /^(roll|progress_|announcement|board|admin_|decisive_expired|budget)/;
/** Tras cerrar la última pestaña, el aviso «ha salido» espera esto (una recarga no cuenta como salir). */
const LEAVE_NOTICE_MS = 20_000;
/** Y la presencia del motor (SPEC §9.1: dormir con velo) cae a los 30 min, como su gracia por acción. */
const ENGINE_OFFLINE_MS = 30 * 60 * 1000;
/** Plazas libres que se crean con una partida nueva si no se dice otra cosa. */
const DEFAULT_FREE_SEATS = 1;
const MAX_SEATS = 8;
/** Modo public: partidas nuevas al día que puede crear quien no es administrador (PUBLIC_GAMES_PER_DAY). */
const PUBLIC_GAMES_PER_DAY = 20;

/**
 * Un parlamento en modo novela: quién habla (nombre visible para este PJ) y su retrato pequeño si ya existe.
 * `pc`: otro jugador (lo que dice llega literal a quien lo oye bien); `to`: a quién se lo dice, si lo dirige.
 */
export interface WebLine { speaker: 'npc' | 'actor' | 'pc'; id: Id; name: string; text: string; avatar?: string | null; to?: string }
/** Momento ilustrado junto al evento (retrato, objeto, combate, descubrimiento); `src` cuando ya está en disco. */
interface WebMoment { kind: Moment['kind']; key: string; entity_id: Id; name?: string; src?: string }

export interface WebMessage {
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
  /** Ilustración de la localización como mensaje suelto (historial en memoria de antes de «place»; ya no se crea). */
  scene?: { location_id: Id; name: string; src: string };
  /**
   * Llegada a otro sitio: la burbuja del narrador que lo cuenta lleva la ilustración del lugar. Sale de los eventos,
   * así que sobrevive a un reinicio; `src` cuando la imagen ya existe (si no, llega luego por el evento «place»).
   */
  place?: { location_id: Id; name?: string; src?: string };
  /** Aviso fuera de la ficción: otro jugador entra o sale de la partida. */
  presence?: { id: Id; online: boolean };
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
  /** Otro jugador se dirige a este: botones «Responder a…» (abre el modo Decir) e «Ignorarle». */
  reply_to?: { id: Id; name: string };
  /** Oferta de otro jugador a este: «Aceptar» y «Rechazar» mientras siga en pie. */
  offer?: { id: Id; label: string; open: boolean };
  /** Conversación ajena que este PJ oye (bien o a trozos): se marca «Escuchas» y se ofrece unirse. */
  overheard?: { npc: string; join: string; well: boolean };
}

/** Lo que la web cuelga de cada motor abierto: conexiones SSE e historial en memoria. */
interface Runtime {
  engine: Engine;
  streams: Map<Id, Set<ServerResponse>>;
  history: Map<Id, WebMessage[]>;
  /** Presenta a un PJ recién creado: su hilo empieza en el prólogo (nada antes) y luego la primera escena del máster, con la vista del sitio. */
  introduce: (characterId: Id) => void;
  /** ¿Se está presentando ese PJ (aún sin prólogo en su hilo)? */
  isOpening: (characterId: Id) => boolean;
  /** Una pestaña más (o menos) mirando a ese PJ: presencia en la web y en el motor. */
  joined: (characterId: Id) => void;
  left: (characterId: Id) => void;
  online: (characterId: Id) => boolean;
  /** Los demás PJ vistos desde este. */
  presenceFor: (viewerId: Id) => PresenceEntry[];
  /** Su jugador está escribiendo: aviso efímero a los demás PJ del sitio. */
  typing: (characterId: Id) => void;
  /** Ronda abierta donde está ese PJ, para pintar el banner al conectar. */
  roundFor: (characterId: Id) => unknown;
  /** Acción en curso por PJ: false si ya tenía una (bloqueo de doble acción). */
  begin: (characterId: Id) => boolean;
  end: (characterId: Id) => void;
  dispose: () => void;
}

/** Otro PJ de la partida visto desde el tuyo: si su jugador está en línea, si está contigo y con qué NPC habla. */
export interface PresenceEntry { id: Id; name: string; online: boolean; where: 'here' | 'travel' | 'away'; text: string; talking_with?: string; /** Su jugador se ha ido: el PJ se queda, ausente. */ away?: boolean }

export interface WebServer {
  server: Server;
  /** Para el tick, cierra las conexiones y vuelca todas las partidas. */
  stop(): Promise<void>;
}

export interface WebServerOptions {
  tickMs?: number;
  /** Acceso por invitación (access.ts); por defecto abierto, como en local. */
  access?: AccessOptions;
  /** Esperas de presencia (tests): aviso de salida y caída de la presencia del motor. */
  leaveNoticeMs?: number;
  engineOfflineMs?: number;
}

export function createWebServer(games: GameManager, opts: WebServerOptions = {}): WebServer {
  const runtimes = new Map<string, Promise<Runtime>>();
  const access: AccessOptions = opts.access ?? { mode: 'open', adminToken: null, secret: randomToken(32) };
  const seats = new SeatStore();
  const claiming = new Set<string>();
  const leaveNoticeMs = opts.leaveNoticeMs ?? LEAVE_NOTICE_MS;
  const engineOfflineMs = opts.engineOfflineMs ?? ENGINE_OFFLINE_MS;

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
    const streams = new Map<Id, Set<ServerResponse>>();
    const history = new Map<Id, WebMessage[]>();
    // Al pasar a otro sitio, la primera burbuja del narrador allí lleva la ilustración del lugar (place). Lo decide el
    // orden de los eventos del PJ, igual al reconstruir el historial que en vivo.
    const lastLoc = new Map<Id, Id>();
    const pendingPlace = new Map<Id, Id>();
    const placed = (d: Delivery, m: WebMessage): WebMessage => {
      const e = d.event, c = d.character_id;
      if (e.actor_id !== c || !e.location_id) return m;
      if (lastLoc.get(c) !== e.location_id) { lastLoc.set(c, e.location_id); pendingPlace.set(c, e.location_id); }
      const loc = pendingPlace.get(c);
      if (loc && loc === e.location_id && m.narrator && m.text && !m.notice && !m.chapter) { m.place = { location_id: loc }; pendingPlace.delete(c); }
      return m;
    };
    // Al abrir la partida, el hilo de cada PJ se reconstruye del log de eventos: un reinicio no borra lo jugado.
    // El hilo de un PJ empieza en su prólogo: lo que el motor emitió antes (la llegada, los NPC colocándose
    // en su horario al arrancar el reloj) no se enseña.
    for (const c of engine.world.characters.values()) {
      const all = engine.events.forCharacter(c.id, null);
      const start = all.findIndex((d) => d.event.action_type === 'prologue' && d.event.actor_id === c.id);
      // Salvo los avisos de misión (la que se abre al llegar): van justo después del prólogo, como en vivo.
      const quests = start > 0 ? all.slice(0, start).filter((d) => d.event.actor_id === c.id && noticeOf(d.event)?.quest) : [];
      const ordered = start > 0 ? [all[start]!, ...quests, ...all.slice(start + 1)] : all;
      const past = ordered.slice(-HISTORY).map((d) => placed(d, toMessage(d, engine)));
      if (past.length) history.set(c.id, past);
    }
    /** PJ que se están presentando: hasta que llega su prólogo, su hilo no recibe nada. */
    const opening = new Set<Id>();
    /** Avisos de misión de mientras se presenta (la que se abre al llegar): salen justo después del prólogo, no se pierden. */
    const held = new Map<Id, WebMessage[]>();
    const send = (characterId: Id, type: string, data: unknown) => {
      for (const res of streams.get(characterId) ?? []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const record = (characterId: Id, m: WebMessage) => {
      if (opening.has(characterId)) {
        if (m.chapter?.kind !== 'prologue') {
          if (m.notice?.quest) held.set(characterId, [...(held.get(characterId) ?? []), m]);
          return;
        }
        opening.delete(characterId);
      }
      const h = history.get(characterId) ?? [];
      h.push(m);
      if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
      history.set(characterId, h);
      send(characterId, 'message', withImages(m, illustratorOf(engine), slug));
      if (m.chapter?.kind === 'prologue') releaseHeld(characterId);
    };
    // El diario cambia con lo que el PJ vive: se avisa (agrupado) y la página lo vuelve a pedir.
    const journalTimers = new Map<Id, NodeJS.Timeout>();
    const notifyJournal = (characterId: Id) => {
      if (journalTimers.has(characterId)) return;
      journalTimers.set(characterId, setTimeout(() => { journalTimers.delete(characterId); send(characterId, 'journal', {}); }, 300));
    };
    const offDelivery = engine.onDelivery((d: Delivery) => {
      const m = toMessage(d, engine);
      // Lo de antes del prólogo de un PJ que se presenta no se enseña: tampoco se lleva la vista del sitio.
      record(d.character_id, opening.has(d.character_id) && m.chapter?.kind !== 'prologue' ? m : placed(d, m));
      if (touchesJournal(d.event)) notifyJournal(d.character_id);
    });
    // La vista de un sitio, recién pintada: entra en las burbujas de llegada a ese sitio que aún no la tienen.
    const offScene = illustratorOf(engine)?.onIllustrated((r) => { for (const id of streams.keys()) send(id, 'place', sceneView(r.image, slug)); }) ?? (() => {});
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
      sheetTimer = setTimeout(() => { sheetTimer = null; for (const id of streams.keys()) { send(id, 'sheet', {}); send(id, 'presence', presenceFor(id)); } }, 300);
    });
    // Presencia: pestañas abiertas por PJ. La web avisa al entrar y salir; el motor (§9.1) duerme y vela al ausente.
    const tabs = new Map<Id, number>();
    const shownOnline = new Set<Id>();
    const leaveTimers = new Map<Id, NodeJS.Timeout>();
    const offlineTimers = new Map<Id, NodeJS.Timeout>();
    const scheduleOffline = (id: Id) => {
      clearTimeout(offlineTimers.get(id));
      offlineTimers.set(id, setTimeout(() => { offlineTimers.delete(id); if (!tabs.get(id)) engine.setPresence(id, false); }, engineOfflineMs));
    };
    // Quien no vuelve tras abrir la partida también acaba dormido; un reinicio no duerme a nadie en el acto.
    for (const c of engine.world.characters.values()) if (c.status !== 'retired' && c.status !== 'dead') scheduleOffline(c.id);
    const nameOf = (id: Id) => engine.world.characters.get(id)?.name ?? 'Alguien';
    const presenceFor = (viewerId: Id): PresenceEntry[] => {
      const w = engine.world;
      const me = w.characters.get(viewerId);
      const myLoc = me ? w.characterSpot(me)?.location_id : undefined;
      const out: PresenceEntry[] = [];
      for (const c of w.characters.values()) {
        if (c.id === viewerId || c.status === 'retired') continue;
        const online = shownOnline.has(c.id);
        const loc = w.characterSpot(c)?.location_id;
        const where: PresenceEntry['where'] = c.transit || journeyOf(c) ? 'travel' : loc && loc === myLoc && !me?.transit ? 'here' : 'away';
        // Con quién habla (solo si está contigo y lo ves): «Aren está aquí, hablando con Hugo».
        const npc = where === 'here' && me ? talkingWith(w, engine.events.recentInLocation(loc!, 60), c, engine.gameNow()) : null;
        const talk = npc && me ? (me.knows.includes(npc.id) ? npc.name : descriptorOf(w, npc.id)) : undefined;
        const state = c.veiled ? ' (ausente, bajo el velo)' : c.away ? ' (ausente)' : online ? '' : ' (sin conexión)';
        const text = `${c.name} ${where === 'here' ? 'está aquí' : where === 'travel' ? 'está en camino' : 'está en otro lugar'}${talk ? `, hablando con ${talk}` : ''}${state}`;
        out.push({ id: c.id, name: c.name, online, where, text, ...(talk ? { talking_with: talk } : {}), ...(c.away ? { away: true } : {}) });
      }
      return out.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    };
    const sendPresence = () => { for (const id of streams.keys()) send(id, 'presence', presenceFor(id)); };
    /**
     * «Mira ha entrado» en el hilo de los demás que están en línea. A los que están en su mismo sitio
     * ya se lo cuenta el motor en la ficción («se ha ido; su personaje se queda…», engine.setAway).
     */
    const announce = (id: Id, online: boolean, inFiction = !online) => {
      const text = online ? `🟢 ${nameOf(id)} ha entrado en la partida.` : `⚪ ${nameOf(id)} ha salido de la partida.`;
      const where = locOf(id);
      for (const other of streams.keys()) {
        if (other === id || !tabs.get(other) || (inFiction && where && locOf(other) === where)) continue;
        record(other, { seq: history.get(other)?.at(-1)?.seq ?? 0, kind: 'system', text, presence: { id, online } });
      }
      sendPresence();
    };
    const joined = (id: Id) => {
      const n = (tabs.get(id) ?? 0) + 1;
      tabs.set(id, n);
      clearTimeout(leaveTimers.get(id)); leaveTimers.delete(id);
      clearTimeout(offlineTimers.get(id)); offlineTimers.delete(id);
      if (n > 1) return;
      const c = engine.world.characters.get(id);
      const wasVeiled = Boolean(c && c.veiled && c.status === 'asleep');
      engine.setPresence(id, true);
      // Se durmió al irse (velo): al volver se despierta solo.
      if (wasVeiled) void engine.act(id, 'despierto').catch((e) => console.error('[web] despertar:', e));
      // Vuelve: deja de estar ausente (los presentes leen «ha vuelto» en la ficción; el resto, el aviso de siempre).
      const wasAway = Boolean(engine.world.characters.get(id)?.away);
      engine.setAway(id, false);
      if (!shownOnline.has(id)) { shownOnline.add(id); announce(id, true, wasAway); } else sendPresence();
    };
    const left = (id: Id) => {
      const n = Math.max(0, (tabs.get(id) ?? 0) - 1);
      tabs.set(id, n);
      if (n > 0) return;
      leaveTimers.set(id, setTimeout(() => {
        leaveTimers.delete(id);
        if (tabs.get(id)) return;
        // Pasado el margen sin pestañas, su PJ se queda ausente donde estaba (docs/MULTIJUGADOR.md, «Desconexiones»).
        engine.setAway(id, true);
        if (shownOnline.delete(id)) announce(id, false);
      }, leaveNoticeMs));
      scheduleOffline(id);
    };
    // Una acción a la vez por PJ; si otro PJ del mismo sitio va delante en la cola del motor, «esperando a…».
    const inflight = new Map<Id, { loc: Id | null; since: number }>();
    const locOf = (id: Id) => { const c = engine.world.characters.get(id); return c ? engine.world.characterSpot(c)?.location_id ?? null : null; };
    const sendQueue = (loc: Id | null) => {
      for (const [id, a] of inflight) {
        if (a.loc !== loc) continue;
        const ahead = [...inflight].filter(([o, b]) => o !== id && b.loc === loc && b.since <= a.since).map(([o]) => nameOf(o));
        send(id, 'queue', { waiting_for: ahead });
      }
    };
    let order = 0;
    const begin = (id: Id) => {
      if (inflight.has(id)) return false;
      const loc = locOf(id);
      inflight.set(id, { loc, since: ++order });
      sendQueue(loc);
      return true;
    };
    const end = (id: Id) => {
      const a = inflight.get(id);
      inflight.delete(id);
      if (a) { send(id, 'queue', { waiting_for: [] }); sendQueue(a.loc); }
    };
    // «está escribiendo…»: a los demás PJ de la misma localización; caduca solo en la página.
    const typing = (id: Id) => {
      const c = engine.world.characters.get(id);
      const loc = locOf(id);
      if (!c || !loc) return;
      for (const other of streams.keys()) {
        if (other === id || locOf(other) !== loc) continue;
        send(other, 'typing', { id, name: pcLabel(engine.world, other, c), ms: 4000 });
      }
    };
    // Ronda en escena tensa (scene.ts): banner para los PJ del sitio, con nombres como los conoce cada uno.
    const roundFor = (viewer: Id, n: SceneNotice) => {
      const name = (id: Id) => { const o = engine.world.characters.get(id); return o ? pcName(engine.world, viewer, o) : id; };
      return { n: n.n, open: n.open, deadline_ms: n.deadline_ms, acted: n.acted.includes(viewer), waiting: n.waiting.filter((id) => id !== viewer).map(name) };
    };
    const offRound = engine.onScene((n) => {
      for (const id of streams.keys()) if (locOf(id) === n.location_id) send(id, 'round', roundFor(id, n));
    });
    function releaseHeld(characterId: Id): void {
      const ms = held.get(characterId);
      held.delete(characterId);
      for (const m of ms ?? []) record(characterId, m);
    }
    const introduce = (characterId: Id) => {
      opening.add(characterId);
      history.delete(characterId);
      held.delete(characterId);
      void engine.introduce(characterId)
        .catch((e) => console.error('[web] intro:', e))
        .finally(() => { opening.delete(characterId); releaseHeld(characterId); });
    };
    return {
      engine, streams, history, introduce, joined, left, presenceFor, begin, end, typing,
      roundFor: (id: Id) => { const loc = locOf(id); const r = loc ? engine.roundIn(loc) : null; return r ? roundFor(id, r) : null; },
      isOpening: (id) => opening.has(id),
      online: (id) => shownOnline.has(id),
      dispose() {
        offDelivery(); offChange(); offScene(); offEntity(); offRound();
        for (const t of [...leaveTimers.values(), ...offlineTimers.values()]) clearTimeout(t);
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

    // Enlaces: el del asiento liga este navegador a su PJ; el de administración, al anfitrión.
    const invite = /^\/i\/([a-z0-9][a-z0-9-]{0,59})\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && invite) {
      const m = await games.get(invite[1]!);
      const seat = m ? await seats.byToken(games.paths(m).dir, invite[2]!) : null;
      if (!m || !seat) { html(res, 403, invitePage('Ese enlace no vale (o lo han renovado). Pide el tuyo a quien organiza la partida.')); return; }
      setCookie(res, access, seatCookieName(m.slug), seatCookieValue(access.secret, m.slug, seat));
      res.writeHead(302, { location: `/?game=${encodeURIComponent(m.slug)}` });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/admin') {
      if (!adminTokenMatches(access, url.searchParams.get('token'))) { html(res, 403, invitePage('Ese enlace de administración no vale.')); return; }
      setAdminCookie(res, access);
      res.writeHead(302, { location: '/' });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) { await serveAsset(res, url.pathname.slice('/assets/'.length)); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/music/')) { await serveMusic(req, res, url.pathname.slice('/music/'.length)); return; }

    const admin = isAdmin(access, req);
    // Modo public: el menú es de todos y cada uno manda en las partidas que creó.
    const pub = access.mode === 'public';
    const manifest = slug ? await games.get(slug) : null;
    const seat = manifest ? await seatOf(req, manifest.slug, games.paths(manifest).dir) : null;
    const allowed = admin || seat !== null;
    const host = admin || (pub && isHostSeat(seat));

    if (req.method === 'GET' && url.pathname === '/') {
      if (!slug) {
        if (admin || pub) { html(res, 200, MENU); return; }
        // Un invitado que vuelve a la raíz: a su partida, si tiene una.
        const mine = await anySeatGame(req);
        if (mine) { res.writeHead(302, { location: `/?game=${encodeURIComponent(mine)}` }); res.end(); return; }
        html(res, 200, invitePage());
        return;
      }
      if (!manifest) { if (admin || pub) { res.writeHead(302, { location: '/' }); res.end(); } else html(res, 404, invitePage()); return; }
      if (!allowed) { html(res, 403, invitePage()); return; }
      if (seat && !seat.character_id) {
        const engine = (await runtime(manifest.slug)).engine;
        html(res, 200, joinPage({
          game: { slug: manifest.slug, name: manifest.name }, options: GameManager.characterOptions(),
          others: [...engine.world.characters.values()].filter((c) => c.status !== 'retired' && c.status !== 'dead').map((c) => ({ id: c.id, name: c.name })),
        }));
        return;
      }
      html(res, 200, PAGE);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/invitaciones') {
      if (!host) { html(res, 403, invitePage()); return; }
      if (!manifest) { res.writeHead(302, { location: '/' }); res.end(); return; }
      html(res, 200, seatsPage(manifest.slug));
      return;
    }
    if (url.pathname === '/api/games' || url.pathname.startsWith('/api/games/')) {
      if (!admin && !pub) { json(res, 403, { ok: false, text: 'Solo quien organiza la partida puede ver y crear partidas.' }); return; }
      // Borrar o convertir una partida: solo su anfitrión.
      if (!(url.pathname === '/api/games' && (req.method === 'GET' || req.method === 'POST')) && !host) {
        json(res, 403, { ok: false, text: 'Solo quien creó la partida puede hacer eso.' });
        return;
      }
      await handleGames(req, res, url, slug, admin);
      return;
    }
    if (url.pathname === '/api/seats' || url.pathname === '/api/seats/regenerate') {
      if (!host) { json(res, 403, { ok: false, text: 'Solo quien organiza la partida puede repartir invitaciones.' }); return; }
      if (!manifest) { json(res, 404, { ok: false, text: 'No existe esa partida.' }); return; }
      await handleSeats(req, res, url, manifest.slug, games.paths(manifest).dir);
      return;
    }
    if (url.pathname === '/api/tts/config') { await handleTtsRequest(req, res, url, games); return; }
    if (!allowed && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/'))) {
      json(res, 403, { ok: false, text: 'Esta partida es por invitación: entra con tu enlace.' });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) { await serveImage(res, url.pathname.slice('/images/'.length), slug); return; }
    if (url.pathname === '/api/tts' || url.pathname.startsWith('/api/tts/')) { await handleTtsRequest(req, res, url, games); return; }
    if (!url.pathname.startsWith('/api/')) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }

    if (!slug) { json(res, 400, { ok: false, text: 'Falta el parámetro game (?game=<partida>): abre una partida desde el menú.' }); return; }
    if (!manifest) { json(res, 404, { ok: false, text: `No existe la partida «${slug}».` }); return; }
    const rt = await runtime(slug);
    const { engine } = rt;
    // Ligado a un asiento: solo su PJ, en cualquier ruta (query o cuerpo).
    const bound = seat?.character_id ?? null;
    const characterParam = url.searchParams.get('character') ?? bound;
    if (bound && characterParam !== bound) { json(res, 403, { ok: false, text: 'Solo puedes jugar con tu personaje.' }); return; }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      const book = games.budgetOf(engine);
      const me = bound ?? null;
      json(res, 200, {
        ok: true, access: access.mode, role: host ? 'admin' : 'player', character_id: me, can_switch: !bound,
        game: { slug: manifest.slug, name: manifest.name, mode: manifest.mode },
        seat: seat ? { id: seat.id, label: seat.label } : null,
        budget: me && book ? { ...book.of(me), limit_actions: book.limits.actions, limit_tokens: book.limits.tokens } : null,
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/seat/claim') {
      if (!seat || seat.character_id || claiming.has(seat.id)) { json(res, 400, { ok: false, text: seat ? 'Este asiento ya tiene personaje.' : 'Entra con un enlace de invitación.' }); return; }
      const body = await readJson(req);
      claiming.add(seat.id);
      try {
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
      const id = await games.addCharacter(manifest.slug, `web:${manifest.slug}:${seat.id}`, {
        name: str('name'), ...(str('race') ? { race_id: str('race') } : {}), ...(str('class') ? { class_id: str('class') } : {}),
        ...(str('hook') ? { hook: str('hook') } : {}), ...(str('appearance') ? { appearance: str('appearance') } : {}),
        death_mode: str('death_mode') === 'hardcore' ? 'hardcore' : 'casual',
      }, { near: str('near') || null });
      await seats.update(games.paths(manifest).dir, (list) => { const s = list.find((x) => x.id === seat.id); if (s) s.character_id = id; });
      rt.introduce(id);
      json(res, 200, { ok: true, character_id: id });
      } finally { claiming.delete(seat.id); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/characters') {
      json(res, 200, [...engine.world.characters.values()].filter((c) => c.status !== 'retired').map((c) => ({ id: c.id, name: c.name })));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const id = characterOr404(engine, characterParam, res);
      if (!id) return;
      // Vuelve tras días sin jugar: «Donde lo dejamos» entra en el historial antes de mandarlo.
      await engine.welcomeBack(id).catch((e) => console.error('[web] recap:', e));
      // no-transform y x-accel-buffering: que ningún proxy (túnel de Cloudflare, nginx) comprima ni retenga el stream; el relleno inicial fuerza el primer envío.
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(':' + ' '.repeat(2048) + '\n\n');
      const ill = illustratorOf(engine);
      // En una sola escritura: quién habla y el historial llegan juntos.
      // Si se está presentando, la página no pide la descripción del sitio: el hilo empieza en el prólogo, que está al llegar.
      res.write(`event: cast\ndata: ${JSON.stringify(castOf(engine, id, ill, slug))}\n\n`
        + (rt.isOpening(id) ? 'event: opening\ndata: {}\n\n' : '')
        + `event: history\ndata: ${JSON.stringify((rt.history.get(id) ?? []).map((m) => withImages(m, ill, slug)))}\n\n`);
      const set = rt.streams.get(id) ?? new Set();
      set.add(res);
      rt.streams.set(id, set);
      rt.joined(id);
      res.write(`event: presence\ndata: ${JSON.stringify(rt.presenceFor(id))}\n\n`);
      const round = rt.roundFor(id);
      if (round) res.write(`event: round\ndata: ${JSON.stringify(round)}\n\n`);
      if (seat) void seats.update(games.paths(manifest).dir, (list) => { const s = list.find((x) => x.id === seat.id); if (s) s.last_seen_at = new Date().toISOString(); });
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { clearInterval(ping); set.delete(res); rt.left(id); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/board') { handleBoardRequest(engine, req, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/board/background') { await handleBoardBackgroundRequest(engine, res, url); return; }
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
      const asked = typeof body['character'] === 'string' ? body['character'] : bound;
      if (bound && asked !== bound) { json(res, 403, { ok: false, text: 'Solo puedes jugar con tu personaje.' }); return; }
      const id = characterOr404(engine, asked, res);
      if (!id) return;
      switch (url.pathname) {
        case '/api/act': {
          const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
          if (!text) { json(res, 400, { ok: false, text: 'Acción vacía.' }); return; }
          if (!rt.begin(id)) { json(res, 409, { ok: false, text: 'Ya tienes una acción en curso: espera a que el narrador responda.' }); return; }
          try { json(res, 200, reply(await engine.act(id, text))); } finally { rt.end(id); }
          return;
        }
        case '/api/say': {
          // Sin bloqueo de doble acción ni cola: decir algo no espera al narrador.
          const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
          if (!text) { json(res, 400, { ok: false, text: '¿Qué dices?' }); return; }
          const to = typeof body['to'] === 'string' && body['to'] ? body['to'] : null;
          const mode = body['mode'] === 'shout' || body['mode'] === 'whisper' ? body['mode'] : undefined;
          json(res, 200, reply(await engine.say(id, text, { to, ...(mode ? { mode } : {}) })));
          return;
        }
        case '/api/typing': {
          rt.typing(id);
          json(res, 200, { ok: true });
          return;
        }
        case '/api/offer': {
          const offer = typeof body['offer'] === 'string' ? body['offer'] : '';
          json(res, 200, reply(await engine.answerOffer(id, offer, body['accept'] === true)));
          return;
        }
        case '/api/roll': {
          if (!rt.begin(id)) { json(res, 409, { ok: false, text: 'Ya tienes una acción en curso: espera a que el narrador responda.' }); return; }
          try { json(res, 200, reply(await engine.rollPending(id))); } finally { rt.end(id); }
          return;
        }
        case '/api/quest/drop': {
          const quest = typeof body['quest'] === 'string' ? body['quest'] : '';
          json(res, 200, await engine.dropQuest(id, quest));
          return;
        }
        case '/api/command': {
          const name = typeof body['name'] === 'string' ? body['name'] : '';
          json(res, 200, { ok: true, text: await engine.command(id, name) });
          return;
        }
      }
    }
    json(res, 404, { ok: false, text: 'No encontrado.' });
  }

  /** El asiento de este navegador en la partida, si su cookie es buena (firmada con el token vigente). */
  async function seatOf(req: IncomingMessage, slug: string, dir: string): Promise<Seat | null> {
    const value = cookies(req)[seatCookieName(slug)];
    const id = seatIdOf(value);
    const seat = id ? await seats.byId(dir, id) : null;
    return checkSeatCookie(access.secret, slug, value, seat) ? seat : null;
  }

  /** Alguna partida en la que este navegador tenga asiento (para quien vuelve a la raíz). */
  async function anySeatGame(req: IncomingMessage): Promise<string | null> {
    for (const name of Object.keys(cookies(req))) {
      if (!name.startsWith('tv_s_')) continue;
      const m = await games.get(name.slice(5));
      if (m && await seatOf(req, m.slug, games.paths(m).dir)) return m.slug;
    }
    return null;
  }

  /** Todo PJ de la partida con su asiento (partidas de antes de las invitaciones, o PJ creados por otra vía). */
  async function ensureSeats(slug: string, dir: string): Promise<Seat[]> {
    const engine = (await runtime(slug)).engine;
    const chars = [...engine.world.characters.values()].filter((c) => c.status !== 'retired');
    const have = await seats.list(dir);
    if (chars.every((c) => have.some((s) => s.character_id === c.id))) return have;
    return seats.update(dir, (list) => {
      for (const c of chars) if (!list.some((s) => s.character_id === c.id)) list.push(newSeat(c.name, c.id, new Date()));
      return [...list];
    });
  }

  async function handleSeats(req: IncomingMessage, res: ServerResponse, url: URL, slug: string, dir: string): Promise<void> {
    if (req.method === 'POST' && url.pathname === '/api/seats') {
      const n = (await seats.list(dir)).length;
      if (n >= MAX_SEATS) { json(res, 400, { ok: false, text: `Como mucho ${MAX_SEATS} asientos por partida.` }); return; }
      await seats.update(dir, (list) => { list.push(newSeat(`Plaza ${list.length + 1}`, null, new Date())); });
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/seats/regenerate') {
      const body = await readJson(req);
      const ok = await seats.update(dir, (list) => {
        const s = list.find((x) => x.id === body['seat']);
        if (s) s.token = randomToken();
        return Boolean(s);
      });
      json(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, text: 'No existe ese asiento.' });
      return;
    }
    if (req.method !== 'GET') { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    const m = (await games.get(slug))!;
    const rt = await runtime(slug);
    const list = await ensureSeats(slug, dir);
    json(res, 200, {
      ok: true, game: { slug, name: m.name },
      seats: list.map((s) => ({
        id: s.id, label: s.label, character_id: s.character_id, character_name: s.character_id ? rt.engine.world.characters.get(s.character_id)?.name ?? null : null,
        link: `/i/${slug}/${s.token}`, last_seen_at: s.last_seen_at, online: s.character_id ? rt.online(s.character_id) : false,
      })),
    });
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

  /**
   * Música fija de la interfaz (public/music, p. ej. la del menú). Con Range: Safari no reproduce audio sin él,
   * y así el navegador no baja la pista entera para empezar a sonar.
   */
  async function serveMusic(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    if (!/^[a-z0-9-]+\.mp3$/.test(name)) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    let bytes: Buffer;
    try { bytes = await readFile(new URL('../../../public/music/' + name, import.meta.url)); } catch { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    const head = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=604800' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      const size = bytes.length;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start); end = Math.min(size - 1, end);
      if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      res.end(bytes.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...head, 'content-length': bytes.length });
    res.end(bytes);
  }

  async function handleGames(req: IncomingMessage, res: ServerResponse, url: URL, slug: string | null, admin: boolean): Promise<void> {
    if (url.pathname === '/api/games' && req.method === 'GET') {
      // El administrador las ve todas; en modo public, cada navegador las suyas (donde tiene asiento).
      const all = await games.list();
      const list = [];
      for (const g of all) {
        if (admin) { list.push({ ...g, host: true }); continue; }
        const m = await games.get(g.slug);
        const s = m ? await seatOf(req, m.slug, games.paths(m).dir) : null;
        if (s) list.push({ ...g, host: isHostSeat(s) });
      }
      json(res, 200, { games: list, options: GameManager.characterOptions(), api_key: Master.configured('live') });
      return;
    }
    if (url.pathname === '/api/games' && req.method === 'POST') {
      const body = await readJson(req);
      const mode = body['mode'];
      if (typeof mode !== 'string' || !(NEW_GAME_MODES as readonly string[]).includes(mode)) { json(res, 400, { ok: false, text: 'Elige un modo: real, offline o grabar demo.' }); return; }
      if (!admin) {
        if (mode === 'record') { json(res, 403, { ok: false, text: 'Grabar demos es solo para quien administra el servidor.' }); return; }
        const perDay = Number(process.env['PUBLIC_GAMES_PER_DAY']) || PUBLIC_GAMES_PER_DAY;
        const since = Date.now() - 24 * 3600 * 1000;
        const today = (await games.list()).filter((g) => Date.parse(g.created_at) >= since).length;
        if (today >= perDay) { json(res, 429, { ok: false, text: 'Hoy ya se han creado muchas partidas en este servidor. Prueba mañana o únete a una con un enlace.' }); return; }
        if (typeof body['name'] !== 'string' || typeof body['character'] !== 'string' || !(body['character'] as string).trim()) { json(res, 400, { ok: false, text: 'Ponle nombre a tu personaje.' }); return; }
      }
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
      const seedRaw = body['dice_seed'];
      const dice_seed = seedRaw === null || seedRaw === undefined || seedRaw === '' ? null : Number(seedRaw);
      const created = await games.create({
        name: str('name'), mode: mode as NewGameMode, dice_seed,
        character: str('character') ? { name: str('character'), ...(str('race') ? { race_id: str('race') } : {}), ...(str('class') ? { class_id: str('class') } : {}), ...(str('hook') ? { hook: str('hook') } : {}), ...(str('appearance') ? { appearance: str('appearance') } : {}), death_mode: str('death_mode') === 'hardcore' ? 'hardcore' : 'casual' } : null,
        // Mundo nuevo generado (src/worldgen); lo valida el gestor.
        world: body['world'] && typeof body['world'] === 'object' ? body['world'] as WorldInput : null,
      });
      // Con máster, la llegada del PJ nuevo la narra él (como en Discord); llega por el stream.
      const rt = await runtime(created.game.slug);
      if (created.character_id) {
        rt.engine.setPresence(created.character_id, true);
        rt.introduce(created.character_id);
      }
      // Asientos: el del anfitrión con su PJ (este navegador queda ligado a él) y plazas libres para invitar.
      const free = Math.max(0, Math.min(MAX_SEATS - 1, Number.isInteger(body['seats']) ? body['seats'] as number : DEFAULT_FREE_SEATS));
      const dir = games.paths(created.game).dir;
      const host = await seats.update(dir, (list) => {
        const mine = created.character_id ? newSeat('Anfitrión', created.character_id, new Date(), true) : null;
        if (mine) list.push(mine);
        for (let i = 0; i < free; i++) list.push(newSeat(`Plaza ${list.length + 1}`, null, new Date()));
        return mine;
      });
      if (host) setCookie(res, access, seatCookieName(created.game.slug), seatCookieValue(access.secret, created.game.slug, host));
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

/**
 * Arranca la web. WEB_HOST (127.0.0.1) dice dónde escucha; detrás de un proxy con HTTPS basta el de por
 * defecto. El acceso sale de WEB_ACCESS / ADMIN_TOKEN (access.ts); PUBLIC_URL solo sirve para imprimir enlaces.
 */
export async function startWeb(games: GameManager, port: number, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const host = env['WEB_HOST']?.trim() || '127.0.0.1';
  const access = await accessFromEnv(env, games.root, host);
  const web = createWebServer(games, { access });
  await new Promise<void>((resolve) => web.server.listen(port, host, resolve));
  const base = (env['PUBLIC_URL']?.trim() || `http://localhost:${port}`).replace(/\/+$/, '');
  console.log(`[web] abre ${base}`);
  if (access.mode === 'public') {
    console.log(`[web] acceso público: cada navegador crea y ve sus partidas; los enlaces de invitación unen a otras. Administración (no la compartas): ${base}/admin?token=${access.adminToken}`);
  } else if (access.mode === 'invite') {
    console.log(`[web] acceso por invitación. Enlace de administración (no lo compartas): ${base}/admin?token=${access.adminToken}`);
  } else {
    console.log('[web] acceso abierto: cualquiera que llegue a esta URL juega con cualquier personaje (WEB_ACCESS=invite o ADMIN_TOKEN para invitaciones)');
  }
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
function reply(r: ActionResult): { ok: boolean; text: string | null; say_to?: { id: Id; name: string } } {
  if (!r.ok) return { ok: false, text: r.text };
  return { ok: true, text: r.event ? null : r.text, ...(r.say_to ? { say_to: r.say_to } : {}) };
}

export function toMessage(d: Delivery, engine: Engine): WebMessage {
  const e: GameEvent = d.event;
  const m: WebMessage = { seq: e.seq, kind: MASTER_TYPES.has(e.action_type) ? 'master' : 'system', text: d.text };
  // Tablón y progreso: fuera del hilo; queda un aviso de una línea que lleva al Diario (también en el historial restaurado).
  const notice = noticeOf(e);
  if (notice) { m.text = ''; m.notice = notice; return m; }
  if (!SYSTEM_TYPES.test(e.action_type)) m.narrator = true;
  // Turno compartido (grupo o ronda): cada participante lo ve como suyo, con su propia acción y la de los demás.
  const group = Array.isArray(e.payload['group']) && (e.payload['group'] as Id[]).includes(d.character_id);
  if (e.actor_id !== d.character_id && !group) return witnessMessage(m, d, engine);
  if (group) {
    const inputs = (e.payload['group_inputs'] as Record<Id, string> | undefined) ?? {};
    const own = inputs[d.character_id]; if (own) m.input = own;
    const novel = novelOf(e, engine, d.character_id, d.text);
    if (novel) { m.prose = novel.prose; m.lines = novel.lines; m.blocks = novel.blocks; m.speech = novel.speech; }
    // Lo que hicieron o dijeron los demás en este turno, delante, con su avatar (si el máster no lo trae ya en lines).
    const w = engine.world;
    const others: WebLine[] = Object.entries(inputs)
      .filter(([id]) => id !== d.character_id && w.characters.has(id) && !(m.lines ?? []).some((l) => l.id === id))
      .map(([id, text]) => ({ speaker: 'pc', id, name: pcLabel(w, d.character_id, w.character(id)), text }));
    if (others.length) {
      const lines = [...others, ...(m.lines ?? [])];
      const shift = (b: NovelBlock): NovelBlock => (b.kind === 'line' ? { ...b, line: b.line + others.length } : b);
      m.lines = lines;
      m.blocks = [...others.map((_, i): NovelBlock => ({ kind: 'line', line: i })), ...(m.blocks ? m.blocks.map(shift) : [{ kind: 'prose' as const, text: d.text }])];
    }
    if (Array.isArray(e.payload['suggested_actions'])) m.suggested = (e.payload['suggested_actions'] as string[]).slice(0, 4);
    return m;
  }
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

const SAY_TYPES = new Set(['say', 'shout', 'whisper']);

/** Trozos sueltos de lo que se dice, para quien oye mal: unas pocas palabras largas, con puntos suspensivos. */
export function fragmentsOf(texts: readonly string[]): string {
  const words = texts.join(' ').split(/\s+/).map((x) => x.replace(/[^\p{L}\p{N}]/gu, '')).filter((x) => x.length >= 5);
  const picked = words.filter((_, i) => i % 3 === 0).slice(0, 4);
  return picked.length ? `…${picked.join('… ')}…` : '';
}

/**
 * Lo que otro PJ hace o dice, visto por este (party.ts): si lo oye bien, sus
 * palabras llegan literales como parlamento suyo (con su avatar y el nombre que
 * este conoce) en vez del estilo indirecto; si se dirige a este, «Responder a…»;
 * si le ofrece algo, «Aceptar» y «Rechazar».
 */
function witnessMessage(m: WebMessage, d: Delivery, engine: Engine): WebMessage {
  const e = d.event;
  const w = engine.world;
  const actor = e.actor_id ? w.characters.get(e.actor_id) : undefined;
  if (!actor) return m;
  const reader = d.character_id;
  const shown = pcLabel(w, reader, actor);
  // Lo que hace otro mientras habla (le hacen esperar, espera su turno): aviso de una línea, sin burbuja del narrador.
  if (e.payload['notice_for_others'] === true) { m.kind = 'system'; delete m.narrator; return m; }
  const offer = e.payload['offer'] as { id: Id; to: Id; label: string; answer?: string } | undefined;
  if (e.action_type === 'offer' && offer?.to === reader) {
    const open = (w.characters.get(reader)?.offers ?? []).some((o) => o.id === offer.id && o.expires_real_ms > Date.now());
    m.offer = { id: offer.id, label: offer.label, open };
  }
  const say = e.payload['say'] as { to: Id | null } | undefined;
  const delivered = e.delivered_to.find((x) => x.character_id === reader);
  const heardWell = SAY_TYPES.has(e.action_type) ? d.level === 'full' : delivered?.sound === 'full';
  const target = e.payload['target_character_id'];
  if ((SAY_TYPES.has(e.action_type) && heardWell) || (MASTER_TYPES.has(e.action_type) && target === reader)) {
    if (!say?.to || say.to === reader || target === reader) m.reply_to = { id: actor.id, name: pcName(w, reader, actor) };
  }
  const raw = e.payload['lines'];
  // Una conversación ajena con un NPC: quien la oye lo sabe («Escuchas») y puede unirse en cualquier momento.
  const npcLine = Array.isArray(raw) ? (raw as DialogueLine[]).find((l) => l.speaker === 'npc' && l.npc_id && w.npcs.has(l.npc_id)) : undefined;
  const talkNpc = npcLine ? w.npcs.get(npcLine.npc_id!)! : typeof e.payload['npc_id'] === 'string' ? w.npcs.get(e.payload['npc_id'] as Id) : undefined;
  const inGroup = Array.isArray(e.payload['group']) && (e.payload['group'] as Id[]).includes(reader);
  if (talkNpc && MASTER_TYPES.has(e.action_type) && !inGroup && (heardWell || delivered?.sound === 'vague')) {
    const me = w.characters.get(reader);
    const label = me && me.knows.includes(talkNpc.id) ? talkNpc.name : descriptorOf(w, talkNpc.id);
    m.overheard = { npc: label, join: `Unirme a la conversación con ${label}`, well: heardWell };
    // Desde otro punto se oyen trozos sueltos, no la conversación.
    if (!heardWell && Array.isArray(raw)) {
      const bits = fragmentsOf((raw as DialogueLine[]).map((l) => l.text));
      if (bits) m.text = `Desde donde estás oyes trozos sueltos de la conversación: «${bits}».`;
    }
  }
  if (!heardWell || !Array.isArray(raw) || !raw.length) return m;
  const toName = say?.to ? (say.to === reader ? 'ti' : (() => { const t = w.characters.get(say.to!); return t ? pcName(w, reader, t) : ''; })()) : '';
  const lines: WebLine[] = [];
  const kept: DialogueLine[] = [];
  for (const l of raw as DialogueLine[]) {
    const other = l.speaker === 'pc' && l.character_id ? w.characters.get(l.character_id) : undefined;
    if (other) { lines.push({ speaker: other.id === reader ? 'actor' : 'pc', id: other.id, name: pcLabel(w, reader, other), text: l.text }); kept.push({ ...l, speaker: 'npc' }); continue; }
    if (l.speaker === 'actor') lines.push({ speaker: 'pc', id: actor.id, name: shown, text: l.text, ...(toName ? { to: toName } : {}) });
    else if (l.speaker === 'npc' && l.npc_id && w.npcs.has(l.npc_id)) {
      const npc = w.npcs.get(l.npc_id)!;
      const known = w.characters.get(reader)?.knows.includes(npc.id) ?? false;
      lines.push({ speaker: 'npc', id: npc.id, name: known ? npc.name : npc.role.charAt(0).toUpperCase() + npc.role.slice(1), text: l.text });
    } else continue;
    kept.push(l);
  }
  if (!lines.length) return m;
  // El estilo indirecto de quien habla sobra: sus palabras ya van en su burbuja.
  const who = pcName(w, reader, actor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // También «le habla a…», «saluda a…», «se dirige a…»: es el mismo acto que la frase literal (no se cuenta dos veces).
  const reported = new RegExp(`^${who}\\s+(?:le\\s+|te\\s+|les\\s+|se\\s+)?(?:habla|charla|conversa|saluda|dirige|cuenta|pide|dice|pregunta|responde|contesta|susurra|murmura|grita|comenta|explica|añade|replica|insiste)\\b`, 'i');
  const prose = d.text.split(/(?<=[.!?…:])\s+/).filter((s) => !reported.test(s.trim())).join(' ');
  const blocks = novelBlocks(prose, kept);
  m.prose = blocks.filter((b) => b.kind === 'prose').map((b) => (b as { text: string }).text).join(' ');
  m.lines = lines;
  m.blocks = blocks;
  m.speech = blocksSpeech(blocks, kept, true);
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
  const say = e.payload['say'] as { to: Id | null } | undefined;
  const to = say?.to ? w.characters.get(say.to) : undefined;
  for (const l of raw as DialogueLine[]) {
    // En un turno compartido, «actor» es quien abrió el turno: para los demás es otro PJ.
    const who = l.speaker === 'pc' ? l.character_id : l.speaker === 'actor' ? e.actor_id : null;
    if (who && who !== characterId && w.characters.has(who)) {
      lines.push({ speaker: 'pc', id: who, name: pcLabel(w, characterId, w.character(who)), text: l.text });
      kept.push({ ...l, speaker: 'npc' });
      continue;
    }
    if ((l.speaker === 'actor' || l.speaker === 'pc') && me) lines.push({ speaker: 'actor', id: me.id, name: me.name, text: l.text, ...(to ? { to: pcName(w, me.id, to) } : {}) });
    else if (l.speaker === 'npc' && l.npc_id && l.to && w.characters.has(l.to)) {
      const npc = w.npcs.get(l.npc_id);
      if (!npc) continue;
      const known = me?.knows.includes(npc.id) ?? false;
      lines.push({ speaker: 'npc', id: npc.id, name: known ? npc.name : npc.role.charAt(0).toUpperCase() + npc.role.slice(1), text: l.text, to: l.to === characterId ? 'ti' : pcName(w, characterId, w.character(l.to)) });
    }
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
  if (!ill || (!m.lines && !m.moments && !m.place)) return m;
  const out: WebMessage = { ...m };
  if (m.place) { const img = ill.imageFor(m.place.location_id); if (img) out.place = { ...sceneView(img, slug) }; }
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

function html(res: ServerResponse, status: number, page: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page);
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
