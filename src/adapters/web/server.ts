/**
 * Adaptador web local: un menú de partidas y, por partida, una página con el
 * hilo de cada personaje, botones de acciones sugeridas y 🎲, y la hoja al lado.
 * Mismo motor que el REPL; un motor por partida, vía el gestor.
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
 *   GET  /api/tablon?character=ID   encargos del tablón (tablon.ts)  ·  POST /api/tablon/read {character}   abrirlo es leerlo
 *   GET  /api/board/background?character=ID  fondo pintado del plano donde está el PJ (JPEG)
 *   GET  /api/item-art?character=ID&item=ITEM  imagen escrita de un objeto que lleva el PJ (JPEG o PNG)
 *   GET  /api/map?character=ID      mapa de zona y región
 *   GET  /api/scene?character=ID    ilustración de la localización actual (IMAGES=on), o null
 *   GET  /images/<fichero>          ilustraciones descargadas de la partida (data/games/<slug>/images)
 *   GET  /assets/<fichero>          imágenes fijas de la interfaz (public/), sin ?game
 *   POST /api/act      {character, text}
 *   POST /api/say      {character, text, to?, mode?}   decir sin máster: la frase literal del PJ (party.ts); si es una acción, {as_action: true} y no se dice
 *   POST /api/offer    {character, offer, accept}      aceptar o rechazar lo que otro PJ le ofrece
 *   POST /api/presence {character, tab, state}         latido de la pestaña: visible | hidden | gone (presence.ts)
 *   POST /api/reaction {character, reaction, answer, text}  dejarse o resistirse a lo que otro PJ intenta hacerle (answer: accept, resist o null con text)
 *   POST /api/inventory {character, instance, to}      mochila: mover un objeto propio arrastrando (mano, bolsillo, contenedor, equipo)
 *   POST /api/typing   {character}                     «está escribiendo…» a los demás PJ del sitio (SSE «typing»)
 * SSE «round»: ronda abierta en escena tensa (scene.ts): número, quién falta y cuándo vence.
 *   POST /api/roll     {character}
 *   POST /api/choice   {character, key, picks}        Hoja: conjuros (cantrips, known, prepared) o elección de clase (levels.ts)
 *   POST /api/command  {character, name}
 *   POST /api/report   {character, seq?, text, at?}    reportar una burbuja del máster o, sin seq, «Algo va mal» (report.ts)
 *   GET  /api/tts/config  ·  POST /api/tts?game=SLUG   narrador de voz (tts.ts)
 *   GET  /api/sfx?character=ID  ·  GET /api/sfx?key=CLAVE   sonido: estado del PJ y ficheros (sfx.ts)
 *   GET|POST /api/illustrate?character=ID  pincel: ilustrar el momento actual (paint.ts)
 *   GET|POST /api/avatar?character=ID  avatar del PJ: versiones, «Otro», «Descríbelo», elegir (avatar.ts)
 *
 * Acceso (access.ts, docs/MULTIJUGADOR.md, «Cuentas»): fuera de `open` hace falta cuenta (usuario y
 * contraseña, src/accounts). Cada partida tiene dueño y sus asientos se ligan a usuarios con el enlace de
 * invitación; en `invite` solo el administrador crea partidas. En `open` (local), cualquiera con la página
 * juega con cualquier PJ, como antes.
 *   GET  /i/<partida>/<token>       invitación: liga ese asiento a tu cuenta (sin cuenta, pasa por /entrar)
 *   GET  /admin/estado              administrador: versión, conectados, actividad, coste y reportes (page-status.ts)
 *   GET  /admin/usuarios[/<id>], /admin/partidas[/<slug>]   administrador: usuarios, partidas, personajes (page-admin.ts; /api/admin/…)
 *   GET  /entrar                    entrar o crear cuenta (page-account.ts); POST /api/auth/register|login|logout
 *   GET  /api/me, POST /api/me/password   quién soy; cambiar mi contraseña
 *   GET|POST /api/library, POST|DELETE /api/library/<id>   biblioteca de personajes de la cuenta
 *   GET  /api/health                salud para deploy/healthcheck.sh (web y base de datos), sin sesión
 *   GET  /invitaciones?game=SLUG    anfitrión: asientos y enlaces
 *   GET  /api/session?game=SLUG     quién soy: anfitrión o jugador, y mi PJ si estoy ligado
 *   GET|POST /api/seats?game=SLUG, POST /api/seats/regenerate|release   anfitrión: listar, añadir, renovar el enlace, liberar
 *   POST /api/seat/claim?game=SLUG  asiento libre: el PJ del invitado, de su biblioteca ({template_id}) o nuevo
 *   POST /api/character/preview     resumen del asistente de creación: valida y calcula sin crear nada
 * Presencia: SSE «presence» con quién está en línea y dónde respecto a ti; avisos en el hilo al entrar y salir.
 * Una acción a la vez por PJ (409 si ya tiene una en curso) y SSE «queue» si espera a otro PJ del mismo sitio.
 * Registro (servicelog.ts): una línea por acción con su máster, otra por llamada suelta al máster y la presencia.
 */

import { CreditAlarm, webhookAlert, type AlertSender } from './alert.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Engine, ActionResult, CharacterSpec } from '../../engine/engine.js';
import type { InfoAnswer } from '../../engine/info.js';
import type { Character, GameEvent, Id } from '../../engine/model.js';
import type { Delivery } from '../../engine/events.js';
import { GameError, GameManager, NEW_GAME_MODES, type CreateGameInput, type GameManifest, type NewGameMode, type WorldInput } from '../../games/manager.js';
import { Master } from '../../ai/master.js';
import { sheetView } from '../sheet-view.js';
import { PAGE } from './page.js';
import { MENU } from './page-menu.js';
import { handleBoardBackgroundRequest, handleBoardRequest } from './board.js';
import { handleItemArtRequest, withItemArt } from './itemart.js';
import { handleMapRequest } from './regionmap.js';
import { handleTtsRequest } from './tts.js';
import { handleSfxRequest } from './sfx.js';
import { soundCuesOf } from './soundmap.js';
import { illustratorOf, MASTER_PORTRAIT_ID, masterPortraitOf, portraitOf, sceneOf, type EntityInput, type Illustrator, type SceneImage } from '../../ai/illustrate.js';
import { type DialogueLine, type LineTo, type Moment } from '../../engine/moments.js';
import { lineTargets, presentIds, viewOf } from '../../engine/audience.js';
import { blocksSpeech, novelBlocks, type NovelBlock } from './novel.js';
import { handleJournalRequest, touchesJournal } from './journal.js';
import { noticeOf, webNotice, type WebNotice } from './notice.js';
import { handlePaintRequest } from './paint.js';
import { handleAvatarRequest } from './avatar.js';
import { journeyOf } from '../../engine/travel.js';
import { accessFromEnv, checkSeatCookie, clearCookie, cookies, isHostSeat, randomToken, seatCookieName, seatCookieValue, seatIdOf, SESSION_COOKIE_MAX_AGE_S, setCookie, USER_COOKIE, type AccessOptions } from './access.js';
import { invitePage, joinPage, seatsPage } from './page-access.js';
import { accountPage } from './page-account.js';
import { adminPage } from './page-admin.js';
import { AccountError, Accounts, ensureAdmin, type CharacterInput, type Seat, type User } from '../../accounts/accounts.js';
import { describeDbUrl, dbUrlFromEnv, memoryDb, openDb, type Db } from '../../db/db.js';
import { PgWorldStore, worldStoreFromEnv } from '../../games/worlds.js';
import { DbCatalog, ensureGameRow } from '../../db/catalog.js';
import { PRESENCE_TIMING, PresenceTracker, REPEAT_NOTICE_MS, type PresenceTiming } from './presence.js';
import { pcLabel, pcName, sayLooksLikeAction } from '../../engine/party.js';
import { talkingWith } from '../../engine/scene.js';
import { descriptorOf } from '../../engine/narrate.js';
import { speakerLabel } from '../../engine/chatter.js';
import type { SceneNotice } from '../../engine/engine.js';
import { encounterAt, type Encounter } from '../../engine/encounter.js';
import { combatView, type CombatEnd, type CombatView, type TurnContext } from './fight.js';
import { ActionLog, presenceLine, reportLine } from './servicelog.js';
import { AWAY_CARD_MS, awayCard, awayCardEmpty, awayFor, awayText, unreadFrom, type AwayCard } from './whileaway.js';
import { tablonView } from './tablon.js';
import { shopView } from './tienda.js';
import { activeJobs } from '../../engine/progress.js';
import { boardSeen } from '../../engine/quests.js';
import { listReports, REPORT_MAX_TEXT, reportOf, ReportQuota, saveReport } from './report.js';
import { ServiceStats, serverVersion, STATS_FILE, versionLabel, type TokenUsage } from './status.js';
import { statusPage } from './page-status.js';

const MASTER_TYPES = new Set(['master', 'master_roll_outcome', 'master_intro', 'master_arrival', 'prologue', 'recap']);
const HISTORY = 200;
/** Avisos fuera de la ficción: tiradas, progreso, anuncios, tablón. Lo demás lo cuenta el narrador. */
const SYSTEM_TYPES = /^(roll|death_save|progress_|announcement|board|admin_|decisive_expired|budget)/;
/** Y la presencia del motor (SPEC §9.1: dormir con velo) cae a los 30 min, como su gracia por acción. */
const ENGINE_OFFLINE_MS = 30 * 60 * 1000;
/** Plazas libres que se crean con una partida nueva si no se dice otra cosa. */
const DEFAULT_FREE_SEATS = 1;
const MAX_SEATS = 8;
/** Páginas del panel del administrador (page-admin.ts): usuarios, un usuario, partidas, una partida. */
const ADMIN_PAGES = /^\/admin\/(usuarios|partidas)(\/[^/]+)?$/;
/** El PJ con el que el administrador entra en una partida ajena (`adminSeat`). */
const ADMIN_CHARACTER = 'admin';
/** Modo public: partidas nuevas al día que puede crear quien no es administrador (PUBLIC_GAMES_PER_DAY). */
const PUBLIC_GAMES_PER_DAY = 20;

/**
 * Un parlamento en modo novela: quién habla (nombre visible para este PJ) y su retrato pequeño si ya existe.
 * `pc`: otro jugador (lo que dice llega literal a quien lo oye bien); `to`: a quién se lo dice, si lo dirige.
 */
export interface WebLine { speaker: 'npc' | 'actor' | 'pc'; id: Id; name: string; text: string; avatar?: string | null; to?: string }
/** Momento ilustrado junto al evento (retrato, objeto, combate, descubrimiento); `src` cuando ya está en disco. */
interface WebMoment { kind: Moment['kind']; key: string; entity_id: Id; name?: string; src?: string; /** Retrato de un NPC: su oficio («tabernera»), bajo el nombre. */ role?: string }

export interface WebMessage {
  seq: number;
  kind: 'master' | 'system';
  text: string;
  /** Botones: solo para el actor del evento. */
  roll?: { kind: string; key: string; dc: number | null };
  /** En el historial: esta tirada sigue sin tirar y su botón vale aunque haya mensajes después (un aviso de horario, un NPC que llega). */
  roll_pending?: true;
  /** Tirada a la vista (rolls.ts): la propia (anima el dado del botón) o la de otro (solo el aviso). */
  dice?: 'mine' | 'other';
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
  /** Aviso de sistema en lugar de burbuja (notice.ts): quién entra o sale, movimientos, objetos, tiradas, progreso. */
  notice?: WebNotice;
  /** Prólogo o «Donde lo dejamos» (docs/PROLOGO.md): página de libro con su título, sin avatar. */
  chapter?: { kind: 'prologue' | 'recap'; title: string };
  /** Otro jugador se dirige a este: sus burbujas llevan el menú ⌄ con «Responder» (abre el modo Decir) e «Ignorar». */
  reply_to?: { id: Id; name: string };
  /** Oferta de otro jugador a este: «Aceptar» y «Rechazar» mientras siga en pie. */
  offer?: { id: Id; label: string; open: boolean };
  /** Otro jugador intenta algo sobre este (reactions.ts): «Dejarse», «Resistirse» o sus palabras, hasta `expires_ms`. */
  reaction?: { id: Id; from: string; attempt: string; expires_ms: number; open: boolean };
  /** Este jugador espera a que otro decida: «Esperando a que Mira decida…» con la cuenta atrás. */
  reaction_wait?: { id: Id; name: string; expires_ms: number; open: boolean };
  /** Esa petición ya se ha decidido: la web cierra sus botones y su espera. */
  reaction_done?: Id;
  /** Charla ajena en la sala (audience.ts): bajo su aviso de una línea, el botón para unirse. */
  join?: { npc: Id; label: string };
  /** Aviso de combate en el hilo (fight.ts): empieza, o se acaba (o el PJ sale de él). */
  combat?: { phase: 'start' | 'end'; text: string };
  /** Comentario del mundo al pasar (chatter.ts): ambiente, no narración. Quién (como lo conoce el lector) y qué dice. */
  ambient?: { npc_id: Id | null; name: string; text: string; kind: string };
  /** «Mientras no estabas» (whileaway.ts): lo que este PJ percibió durante su ausencia, agrupado. Vive en memoria, como los avisos de presencia. */
  away_card?: AwayCard;
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
  /** Se abre (o cierra) el stream de una pestaña de ese PJ: presencia en la web y en el motor (presence.ts). */
  joined: (characterId: Id, tab: string, beats: boolean) => void;
  left: (characterId: Id, tab: string) => void;
  /** Latido de una pestaña: visible, oculta o cerrándose. */
  beat: (characterId: Id, tab: string, state: 'visible' | 'hidden' | 'gone') => void;
  online: (characterId: Id) => boolean;
  /** Los demás PJ vistos desde este. */
  presenceFor: (viewerId: Id) => PresenceEntry[];
  /** Su jugador está escribiendo: aviso efímero a los demás PJ del sitio. */
  typing: (characterId: Id) => void;
  /** Ronda abierta donde está ese PJ, para pintar el banner al conectar. */
  roundFor: (characterId: Id) => unknown;
  /** Combate en el que está ese PJ, visto por él (fight.ts), para pintarlo al conectar. */
  combatFor: (characterId: Id) => CombatView | null;
  /** Acción en curso por PJ: false si ya tenía una (bloqueo de doble acción). */
  begin: (characterId: Id) => boolean;
  end: (characterId: Id) => void;
  /** Registro de acciones de esta partida (servicelog.ts). */
  actions: ActionLog;
  dispose: () => void;
}

/** Otro PJ de la partida visto desde el tuyo: si su jugador está en línea, si está contigo y con qué NPC habla. */
export interface PresenceEntry {
  id: Id; name: string; online: boolean; where: 'here' | 'travel' | 'away'; text: string; talking_with?: string;
  /** Su jugador se ha ido: el PJ se queda, ausente. */ away?: boolean;
  /** Su retrato, si ya está hecho (avatar en la cabecera). */ avatar?: string;
}

export interface WebServer {
  server: Server;
  /** Para el tick, cierra las conexiones y vuelca todas las partidas. */
  stop(): Promise<void>;
}

export interface WebServerOptions {
  tickMs?: number;
  /** Acceso por invitación (access.ts); por defecto abierto, como en local. */
  access?: AccessOptions;
  /** Esperas de presencia (tests): gracia del aviso de salida, latido y pestaña oculta (presence.ts); caída de la presencia del motor. */
  leaveNoticeMs?: number;
  staleMs?: number;
  hiddenMs?: number;
  /** Tras un «ha vuelto» anunciado, otra ida en este plazo no se anuncia (por defecto 5 min, o PRESENCE_REPEAT_MIN del entorno). */
  repeatNoticeMs?: number;
  engineOfflineMs?: number;
  /** Fuera de línea al menos esto para que salga «Mientras no estabas» (por defecto 30 min, o AWAY_CARD_MIN del entorno). */
  awayCardMs?: number;
  /** Registro del servicio (servicelog.ts); por defecto, la salida estándar (journald en el VPS). */
  log?: (line: string) => void;
  /** Avisos al anfitrión (alert.ts); por defecto, ALERT_WEBHOOK del entorno. */
  alert?: AlertSender;
  /** Carpeta con la wiki ya construida (dist/wiki, de npm run build; docs/WIKI.md). */
  wikiDir?: string;
  /**
   * Base de datos (src/db): cuentas, asientos, biblioteca. Sin ella (tests), una PGlite en memoria que solo
   * se arranca la primera vez que hace falta y se cierra con `stop`.
   */
  db?: Db;
}

export function createWebServer(games: GameManager, opts: WebServerOptions = {}): WebServer {
  const runtimes = new Map<string, Promise<Runtime>>();
  const access: AccessOptions = opts.access ?? { mode: 'open', secret: randomToken(32) };
  // Cuentas: con la base que llega o, si no llega, una en memoria al primer uso (así los tests que no las tocan no la arrancan).
  let ownDb: Promise<Db> | null = null;
  let accountsP: Promise<Accounts> | null = opts.db ? Promise.resolve(new Accounts(opts.db)) : null;
  const accountsOf = (): Promise<Accounts> => accountsP ??= (ownDb = memoryDb()).then((db) => new Accounts(db));
  const claiming = new Set<string>();
  // Minutos del entorno para probar con esperas cortas (como AWAY_CARD_MIN); 0 o ausente, el valor de siempre.
  const envMs = (name: string) => { const n = Number(process.env[name]); return n > 0 ? n * 60_000 : undefined; };
  const timing: PresenceTiming = { graceMs: opts.leaveNoticeMs ?? PRESENCE_TIMING.graceMs, staleMs: opts.staleMs ?? PRESENCE_TIMING.staleMs, hiddenMs: opts.hiddenMs ?? envMs('PRESENCE_HIDDEN_MIN') ?? PRESENCE_TIMING.hiddenMs };
  const repeatNoticeMs = opts.repeatNoticeMs ?? envMs('PRESENCE_REPEAT_MIN') ?? REPEAT_NOTICE_MS;
  const engineOfflineMs = opts.engineOfflineMs ?? ENGINE_OFFLINE_MS;
  const awayMin = Number(process.env['AWAY_CARD_MIN']);
  const awayCardMs = opts.awayCardMs ?? (awayMin > 0 ? awayMin * 60_000 : AWAY_CARD_MS);
  const log =opts.log ?? ((line: string) => console.log(line));
  const credit = new CreditAlarm(opts.alert ?? webhookAlert(process.env, log));
  const startedAt = Date.now();
  const statusTz = process.env['BUDGET_TZ']?.trim() || 'Europe/Madrid';
  const stats = new ServiceStats(join(games.root, STATS_FILE), statusTz);
  const reportQuota = new ReportQuota();
  const wikiDir = opts.wikiDir ?? fileURLToPath(new URL('../../../dist/wiki/', import.meta.url));

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
      send(characterId, 'message', withImages(m, illustratorOf(engine), slug, engine));
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
      scheduleFights();
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
    // La hoja se refresca cuando cambia algo del PJ o de los ítems.
    let sheetTimer: NodeJS.Timeout | null = null;
    const offChange = engine.world.onChange((ch) => {
      // Rumores (campaña) y memoria de los NPC: el diario también los recoge.
      if (ch.collection === 'campaign' || ch.collection === 'npcs') for (const id of streams.keys()) notifyJournal(id);
      if (ch.collection === 'characters' || ch.collection === 'npcs') scheduleFights();
      if (ch.collection !== 'characters' && ch.collection !== 'item_instances') return;
      if (ch.collection === 'characters') notifyJournal(ch.id);
      if (sheetTimer) return;
      sheetTimer = setTimeout(() => { sheetTimer = null; for (const id of streams.keys()) { send(id, 'sheet', {}); send(id, 'presence', presenceFor(id)); } }, 300);
    });
    // Registro: cada llamada al máster va a la acción en curso de su PJ o sale sola (servicelog.ts).
    const charName = (id: Id) => engine.world.characters.get(id)?.name ?? null;
    const actions = new ActionLog(slug, charName, log, (r) => stats.action(r));
    const offMaster = engine.onMaster((c) => { actions.master(c); credit.master(slug, c); stats.master(c); });
    // El prólogo y la recapitulación los escribe el máster fuera de una llamada: solo se ve su gasto en el evento.
    const offWritten = engine.events.onEvent((e) => {
      if (e.action_type !== 'prologue' && e.action_type !== 'recap') return;
      const m = e.payload['master'] as { model: string; usage: TokenUsage } | undefined;
      if (m) stats.spend(m.model, m.usage);
    });
    // Presencia: pestañas que cuentan por PJ (presence.ts). La web avisa al entrar y al irse; el motor (§9.1) duerme y vela al ausente.
    const presence = new PresenceTracker(timing, (id, online) => {
      log(presenceLine(slug, id, charName(id), online ? 'en_línea' : 'fuera_de_línea'));
      if (online) cameOnline(id); else wentOffline(id);
    });
    const tabsOpen = new Map<Id, number>();
    const tabLog = (id: Id, event: 'conecta' | 'desconecta' | 'cierra_pestaña', tab: string, extra: Record<string, string | number> = {}) =>
      log(presenceLine(slug, id, charName(id), event, { pestaña: tab.slice(0, 8), ...extra }));
    /** Quien ya estuvo en línea desde que se abrió la partida: al volver, «ha vuelto» en vez de «ha entrado». */
    const seen = new Set<Id>();
    const offlineTimers = new Map<Id, NodeJS.Timeout>();
    const scheduleOffline = (id: Id) => {
      clearTimeout(offlineTimers.get(id));
      offlineTimers.set(id, setTimeout(() => { offlineTimers.delete(id); if (!presence.online(id)) engine.setPresence(id, false); }, engineOfflineMs));
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
        const online = presence.online(c.id);
        const loc = w.characterSpot(c)?.location_id;
        const where: PresenceEntry['where'] = c.transit || journeyOf(c) ? 'travel' : loc && loc === myLoc && !me?.transit ? 'here' : 'away';
        // Con quién habla (solo si está contigo y lo ves): «Aren está aquí, hablando con Hugo».
        const npc = where === 'here' && me ? talkingWith(w, engine.events.recentInLocation(loc!, 60), c, engine.gameNow()) : null;
        const talk = npc && me ? (me.knows.includes(npc.id) ? npc.name : descriptorOf(w, npc.id)) : undefined;
        const state = c.veiled ? ' (ausente, bajo el velo)' : c.away ? ' (ausente)' : online ? '' : ' (sin conexión)';
        const text = `${c.name} ${where === 'here' ? 'está aquí' : where === 'travel' ? 'está en camino' : 'está en otro lugar'}${talk ? `, hablando con ${talk}` : ''}${state}`;
        const portrait = illustratorOf(engine)?.entityImage('portrait', c.id);
        out.push({ id: c.id, name: c.name, online, where, text, ...(talk ? { talking_with: talk } : {}), ...(c.away ? { away: true } : {}), ...(portrait ? { avatar: imageSrc(portrait, slug) } : {}) });
      }
      return out.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    };
    const sendPresence = () => { for (const id of streams.keys()) send(id, 'presence', presenceFor(id)); };
    /**
     * «Mira se ha marchado» / «Mira ha vuelto» en el hilo de los demás que están en línea, sin pasar por el
     * narrador. A los que están en su mismo sitio ya se lo cuenta el motor («se ha ido; su personaje se queda…»,
     * engine.setAway), también como aviso de sistema.
     */
    const announce = (id: Id, online: boolean, inFiction = !online) => {
      if (quietNow.has(id)) { sendPresence(); return; }
      const notice = webNotice(online ? `${nameOf(id)} ${seen.has(id) ? 'ha vuelto' : 'ha entrado en la partida'}` : `${nameOf(id)} se ha marchado`);
      const where = locOf(id);
      for (const other of streams.keys()) {
        if (other === id || !presence.online(other) || (inFiction && where && locOf(other) === where)) continue;
        record(other, { seq: history.get(other)?.at(-1)?.seq ?? 0, kind: 'system', text: '', notice, presence: { id, online } });
      }
      sendPresence();
    };
    /** «Se ha ido» ya dicho a los demás y aún sin su «ha vuelto»: solo entonces se anuncia la vuelta. */
    const toldGone = new Set<Id>();
    /** Cuándo se dijo el último «ha vuelto» de cada uno (para no repetir ida y vuelta seguidas). */
    const toldBackAt = new Map<Id, number>();
    /** Mientras dura el cambio de estado de ese PJ en el motor, sin texto para nadie (announce solo pone el circulito). */
    const quietNow = new Set<Id>();
    const cameOnline = (id: Id) => {
      clearTimeout(offlineTimers.get(id)); offlineTimers.delete(id);
      const c = engine.world.characters.get(id);
      const wasVeiled = Boolean(c && c.veiled && c.status === 'asleep');
      // Antes de despertarlo: lo que se perdió, con cuánto ha estado fuera (whileaway.ts).
      const welcome = c ? cardFor(c) : null;
      engine.setPresence(id, true);
      // Se durmió al irse (velo): al volver se despierta solo.
      const woken = wasVeiled ? engine.act(id, 'despierto').then(() => {}).catch((e) => console.error(`[web] despertar partida=${slug} pj=${id}:`, e)) : Promise.resolve();
      // Vuelve: deja de estar ausente (los presentes leen «ha vuelto» del motor; el resto, el aviso de la web).
      const wasAway = Boolean(engine.world.characters.get(id)?.away);
      // «Ha vuelto» solo si antes se dijo «se ha ido»; si no, el estado cambia sin avisos. La primera entrada sí se dice.
      const loud = toldGone.has(id) || !seen.has(id);
      if (!loud) quietNow.add(id);
      engine.setAway(id, false, { quiet: !loud });
      announce(id, true, wasAway);
      quietNow.delete(id);
      if (toldGone.delete(id)) toldBackAt.set(id, Date.now());
      seen.add(id);
      // Vuelve sin abrir otro stream (la pestaña oculta que se ve otra vez): el resumen le llega por el que tiene abierto.
      const recap = wasAway ? engine.welcomeBack(id).catch((e) => console.error(`[web] recap partida=${slug} pj=${id}:`, e)) : Promise.resolve(null);
      // Al final del hilo: tras el despertar y «Donde lo dejamos», sin máster de por medio.
      if (welcome) void Promise.all([woken, recap]).then(() => record(id, welcome));
    };
    /** «Mientras no estabas», o una línea si no ha pasado nada; null si no vuelve de una ausencia de verdad. */
    const cardFor = (c: Character): WebMessage | null => {
      const gone = awayFor(engine, c, awayCardMs);
      const from = gone === null ? null : unreadFrom(engine, c);
      if (gone === null || from === null) return null;
      const card = awayCard(engine, c, from, gone);
      const seq = lastSeq(c.id);
      if (!awayCardEmpty(card)) return { seq, kind: 'system', text: '', away_card: card };
      return { seq, kind: 'system', text: '', notice: webNotice(`Has estado fuera ${awayText(gone)}: nada nuevo a tu alrededor`) };
    };
    // Pasada la gracia sin pestañas que cuenten, su PJ se queda ausente donde estaba (docs/MULTIJUGADOR.md, «Desconexiones»).
    const wentOffline = (id: Id) => {
      // Una ida y vuelta justo después de otra ya anunciada no se repite: ni el «se ha ido» ni su «ha vuelto».
      const since = toldBackAt.get(id);
      const loud = since === undefined || Date.now() - since >= repeatNoticeMs;
      if (!loud) quietNow.add(id);
      engine.setAway(id, true, { quiet: !loud });
      announce(id, false);
      quietNow.delete(id);
      if (loud) toldGone.add(id);
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
      scheduleFights();
      return true;
    };
    const end = (id: Id) => {
      const a = inflight.get(id);
      inflight.delete(id);
      if (a) { send(id, 'queue', { waiting_for: [] }); sendQueue(a.loc); }
      for (const [loc, ids] of resolvingRound) { ids.delete(id); if (!ids.size) resolvingRound.delete(loc); }
      scheduleFights();
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
      // Ronda cerrada: el máster la narra hasta que acaban las acciones de los que actuaron.
      if (!n.open && n.acted.length) resolvingRound.set(n.location_id, new Set(n.acted));
      scheduleFights();
    });
    // Combate (fight.ts): sale del log y del mundo (encounter.ts); a cada PJ implicado, su vista cuando cambia,
    // con aviso de inicio y de fin en su hilo. Se recalcula con cada entrega, cambio, ronda o acción en vuelo.
    const resolvingRound = new Map<Id, Set<Id>>();
    /** Combate en el que está cada PJ (ya avisado) y lo último que se le mandó. */
    const fightIn = new Map<Id, string>();
    const fightSent = new Map<Id, string>();
    const avatarOf = (id: Id): string | null => { const img = illustratorOf(engine)?.entityImage('portrait', id); return img ? imageSrc(img, slug) : null; };
    const encounterIn = (loc: Id): Encounter | null => encounterAt(engine.world, engine.events.recentInLocation(loc, 400), loc, engine.gameNow(), Boolean(engine.roundIn(loc)));
    const turnCtx = (loc: Id): TurnContext => ({
      round: engine.roundIn(loc),
      busy: [...inflight].filter(([, a]) => a.loc === loc).sort((x, y) => x[1].since - y[1].since).map(([id]) => id),
      resolving: [...(resolvingRound.get(loc) ?? [])],
      avatar: avatarOf,
    });
    const combatFor = (id: Id): CombatView | null => {
      const loc = locOf(id);
      const enc = loc ? encounterIn(loc) : null;
      return enc && loc ? combatView(engine.world, enc, id, turnCtx(loc)) : null;
    };
    const lastSeq = (id: Id) => history.get(id)?.at(-1)?.seq ?? 0;
    const syncFights = () => {
      const encs = new Map<Id, Encounter | null>();
      const enc = (loc: Id) => { if (!encs.has(loc)) encs.set(loc, encounterIn(loc)); return encs.get(loc) ?? null; };
      for (const c of engine.world.characters.values()) {
        if (c.status === 'retired' || opening.has(c.id)) continue;
        const loc = locOf(c.id);
        const e = loc ? enc(loc) : null;
        const view = e && loc ? combatView(engine.world, e, c.id, turnCtx(loc)) : null;
        const was = fightIn.get(c.id);
        let data: CombatView | CombatEnd | { active: false } = view ?? { active: false };
        if (view && was !== view.key) {
          fightIn.set(c.id, view.key);
          const fresh = e && engine.gameNow() - e.started_game_s < 120;
          const text = fresh ? `⚔ Empieza el combate en ${view.place}` : `⚔ Hay un combate en curso en ${view.place}`;
          record(c.id, { seq: lastSeq(c.id), kind: 'system', text, combat: { phase: 'start', text } });
        } else if (!view && was) {
          fightIn.delete(c.id);
          const wloc = was.slice(0, was.lastIndexOf(':'));
          const still = enc(wloc);
          const left = Boolean(still && `${still.location_id}:${still.started_seq}` === was);
          const text = left ? 'Sales del combate.' : 'Fin del combate.';
          record(c.id, { seq: lastSeq(c.id), kind: 'system', text, combat: { phase: 'end', text } });
          data = { active: false, key: was, why: left ? 'left' : 'ended' };
        }
        const json = JSON.stringify(data);
        if (fightSent.get(c.id) === json || (!view && !was && !fightSent.has(c.id))) continue;
        fightSent.set(c.id, json);
        send(c.id, 'combat', data);
      }
    };
    let fightTimer: NodeJS.Timeout | null = null;
    const scheduleFights = () => {
      if (fightTimer) return;
      fightTimer = setTimeout(() => { fightTimer = null; try { syncFights(); } catch (e) { console.error('[web] combate:', e); } }, 150);
    };
    // El combate también se acaba solo, al pasar el tiempo sin golpes.
    const fightClock = setInterval(scheduleFights, 5_000);
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
        .catch((e) => console.error(`[web] intro partida=${slug} pj=${characterId}:`, e))
        .finally(() => { opening.delete(characterId); releaseHeld(characterId); });
    };
    return {
      engine, streams, history, introduce, presenceFor, begin, end, typing, actions,
      joined: (id, tab, beats) => {
        tabsOpen.set(id, (tabsOpen.get(id) ?? 0) + 1);
        tabLog(id, 'conecta', tab, { streams: tabsOpen.get(id)!, ...(beats ? {} : { latido: 'no' }) });
        presence.open(id, tab, beats);
      },
      left: (id, tab) => {
        const n = Math.max(0, (tabsOpen.get(id) ?? 1) - 1);
        if (n) tabsOpen.set(id, n); else tabsOpen.delete(id);
        tabLog(id, 'desconecta', tab, { streams: n });
        presence.close(id, tab);
      },
      beat: (id, tab, state) => {
        if (state === 'gone') { tabLog(id, 'cierra_pestaña', tab); presence.gone(id, tab); } else presence.beat(id, tab, state === 'visible');
      },
      roundFor: (id: Id) => { const loc = locOf(id); const r = loc ? engine.roundIn(loc) : null; return r ? roundFor(id, r) : null; },
      combatFor,
      isOpening: (id) => opening.has(id),
      online: (id) => presence.online(id),
      dispose() {
        offDelivery(); offChange(); offScene(); offEntity(); offRound(); offMaster(); offWritten();
        presence.dispose();
        clearInterval(fightClock);
        if (fightTimer) clearTimeout(fightTimer);
        for (const t of offlineTimers.values()) clearTimeout(t);
        if (sheetTimer) clearTimeout(sheetTimer);
        for (const t of journalTimers.values()) clearTimeout(t);
        for (const set of streams.values()) for (const res of set) res.end();
        streams.clear();
      },
    };
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof GameError || e instanceof AccountError) { if (!res.headersSent) json(res, e.status, { ok: false, text: e.message }); else res.end(); return; }
      console.error('[web]', e);
      if (!res.headersSent) json(res, 500, { ok: false, text: 'Error interno del servidor.' });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const slug = url.searchParams.get('game');

    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) { await serveAsset(res, url.pathname.slice('/assets/'.length)); return; }
    if (req.method === 'GET' && (url.pathname === '/wiki' || url.pathname.startsWith('/wiki/'))) { await serveWiki(res, url.pathname); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/music/')) { await serveMusic(req, res, url.pathname.slice('/music/'.length)); return; }

    // Salud (deploy/healthcheck.sh): sin sesión; responde 200 si la web y la base contestan.
    if (req.method === 'GET' && url.pathname === '/api/health') {
      try {
        if (opts.db) await opts.db.query('select 1');
        json(res, 200, { ok: true });
      } catch {
        json(res, 503, { ok: false, text: 'La base de datos no responde.' });
      }
      return;
    }

    const open = access.mode === 'open';
    // Modo public: cualquiera con cuenta crea partidas y manda en las suyas.
    const pub = access.mode === 'public';
    const user = await currentUser(req);
    // Administrador: un usuario con `is_admin`. En `open` (local, sin cuentas) todo el mundo administra, como siempre.
    const adminUser = Boolean(user?.is_admin);
    const admin = open || adminUser;
    // Asientos por cookie de navegador (sin cuenta): solo en `open`.
    const byCookie = open;
    // Las cookies de asiento de antes de las cuentas: al entrar con cuenta, sus asientos pasan a ella.
    if (user && hasLegacySeatCookies(req)) await claimLegacySeats(req, res, user);

    // Invitación: con sesión, el asiento queda ligado al usuario; sin ella, primero entrar o registrarse.
    const invite = /^\/i\/([a-z0-9][a-z0-9-]{0,59})\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && invite) {
      const m = await games.get(invite[1]!);
      const seat = m ? await (await accountsOf()).seatByToken(m.slug, invite[2]!) : null;
      if (!m || !seat) { html(res, 403, invitePage('Ese enlace no vale (o lo han renovado). Pide el tuyo a quien organiza la partida.')); return; }
      if (user) {
        try { await (await accountsOf()).bindSeat(seat, user.id); } catch (e) {
          if (e instanceof AccountError) { html(res, e.status, invitePage(e.message)); return; }
          throw e;
        }
      } else if (byCookie) {
        // Local sin cuenta: como antes, la cookie liga este navegador al asiento.
        setCookie(res, access, seatCookieName(m.slug), seatCookieValue(access.secret, m.slug, seat));
      } else {
        redirect(res, `/entrar?invite=${encodeURIComponent(`${m.slug}/${invite[2]!}`)}`);
        return;
      }
      redirect(res, `/?game=${encodeURIComponent(m.slug)}`);
      return;
    }
    // Entrar, registrarse y salir.
    if (req.method === 'GET' && url.pathname === '/entrar') {
      const next = safeNext(url.searchParams.get('next'));
      const inv = await inviteOf(url.searchParams.get('invite'));
      if (user) { redirect(res, inv ? `/i/${inv.slug}/${inv.token}` : next ?? '/'); return; }
      html(res, 200, accountPage({ mode: access.mode, invite: inv ? { game: inv.name, value: `${inv.slug}/${inv.token}`, free: inv.free } : null, next }));
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
      const body = await readJson(req);
      const inv = await inviteOf(typeof body['invite'] === 'string' ? body['invite'] : null);
      const registering = url.pathname === '/api/auth/register';
      // En `invite`, crear cuenta exige un enlace cuyo asiento aún no sea de nadie: un enlace ya usado no es una llave de registro.
      if (registering && access.mode === 'invite' && !inv) { json(res, 403, { ok: false, text: 'En este servidor solo se crea cuenta con un enlace de invitación.' }); return; }
      if (registering && access.mode === 'invite' && inv && !inv.free) { json(res, 403, { ok: false, text: 'Ese enlace ya lo usó otra cuenta. Pide otro a quien organiza la partida (o entra con la tuya, si es la que lo usó).' }); return; }
      const accounts = await accountsOf();
      try {
        const u = registering
          ? await accounts.register(body['username'], body['password'], { ip: clientIp(req) })
          : await accounts.authenticate(body['username'], body['password'], clientIp(req));
        // Si este navegador ya tenía una sesión abierta (otra cuenta, o la misma), se cierra: no quedan sesiones huérfanas.
        await accounts.endSession(cookies(req)[USER_COOKIE]);
        await startSession(req, res, u);
        await claimLegacySeats(req, res, u);
        let next = safeNext(typeof body['next'] === 'string' ? body['next'] : null) ?? '/';
        if (inv) {
          const seat = await accounts.seatByToken(inv.slug, inv.token);
          if (seat) {
            try { await accounts.bindSeat(seat, u.id); next = `/?game=${encodeURIComponent(inv.slug)}`; } catch (e) {
              if (!(e instanceof AccountError)) throw e;
              json(res, 200, { ok: true, next: '/', text: e.message, user: publicUser(u) });
              return;
            }
          }
        }
        json(res, 200, { ok: true, next, user: publicUser(u) });
      } catch (e) {
        if (e instanceof AccountError) { json(res, e.status, { ok: false, text: e.message, ...(e.field ? { field: e.field } : {}) }); return; }
        throw e;
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const token = cookies(req)[USER_COOKIE];
      if (token) await (await accountsOf()).endSession(token);
      clearCookie(res, access, USER_COOKIE);
      json(res, 200, { ok: true });
      return;
    }

    // Sin cuenta, fuera de `open`, solo se ve entrar o registrarse (y la wiki).
    if (!user && !open) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/images/')) {
        const back = url.pathname + url.search;
        redirect(res, back === '/' ? '/entrar' : `/entrar?next=${encodeURIComponent(back)}`);
      } else json(res, 401, { ok: false, text: 'Entra con tu cuenta.' });
      return;
    }

    const manifest = slug ? await games.get(slug) : null;
    let seat = manifest ? await seatFor(req, user, manifest.slug, byCookie) : null;
    const owner = Boolean(manifest && user && (await (await accountsOf()).ownerOf(manifest.slug)) === user.id);
    const allowed = admin || owner || seat !== null;
    const host = admin || owner || (pub && isHostSeat(seat));
    const canCreate = admin || pub || open;

    if (req.method === 'GET' && url.pathname === '/admin/estado') {
      if (!admin) { html(res, 403, invitePage('Esta página es solo para quien administra el servidor.')); return; }
      html(res, 200, await statusHtml());
      return;
    }
    if (ADMIN_PAGES.test(url.pathname) || url.pathname.startsWith('/api/admin/')) {
      if (!admin) {
        if (url.pathname.startsWith('/api/')) json(res, 403, { ok: false, text: 'Solo para quien administra el servidor.' });
        else html(res, 403, invitePage('Esta página es solo para quien administra el servidor.'));
        return;
      }
      if (req.method === 'GET' && ADMIN_PAGES.test(url.pathname)) { html(res, 200, adminPage()); return; }
      await handleAdmin(req, res, url, user);
      return;
    }
    if (url.pathname === '/api/me' || url.pathname === '/api/me/password') {
      if (req.method === 'GET' && url.pathname === '/api/me') {
        json(res, 200, { ok: true, access: access.mode, user: user ? publicUser(user) : null, admin, can_create: canCreate });
        return;
      }
      if (!user) { json(res, 401, { ok: false, text: 'Entra con tu cuenta.' }); return; }
      if (req.method === 'POST' && url.pathname === '/api/me/password') {
        const body = await readJson(req);
        try { await (await accountsOf()).changeOwnPassword(user.id, body['current'], body['password'], cookies(req)[USER_COOKIE] ?? ''); } catch (e) {
          if (e instanceof AccountError) { json(res, e.status, { ok: false, text: e.message, ...(e.field ? { field: e.field } : {}) }); return; }
          throw e;
        }
        json(res, 200, { ok: true });
        return;
      }
      json(res, 404, { ok: false, text: 'No encontrado.' });
      return;
    }
    if (url.pathname === '/api/library' || url.pathname.startsWith('/api/library/')) {
      if (!user) { json(res, 401, { ok: false, text: 'La biblioteca de personajes es de tu cuenta: entra con ella.' }); return; }
      await handleLibrary(req, res, url, user);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      if (!slug) { html(res, 200, MENU); return; }
      if (!manifest) { redirect(res, '/'); return; }
      if (!allowed) { html(res, 403, invitePage('No tienes sitio en esta partida. Pide un enlace de invitación a quien la organiza.')); return; }
      // El administrador sin asiento recibe uno (abajo, `adminSeat`) y elige con qué PJ entra, como un invitado.
      if (adminUser && user && !seat && !manifest.demo) seat = await adminSeat(manifest, user);
      if (seat && !seat.character_id) {
        const engine = (await runtime(manifest.slug)).engine;
        html(res, 200, joinPage({
          game: { slug: manifest.slug, name: manifest.name }, options: GameManager.characterOptions(),
          others: [...engine.world.characters.values()].filter((c) => c.status !== 'retired' && c.status !== 'dead').map((c) => ({ id: c.id, name: c.name })),
          library: user ? (await (await accountsOf()).library(user.id)).map((c) => ({ id: c.id, name: c.name, race_id: c.race_id ?? null, class_id: c.class_id ?? null, taken: engine.characterNameTaken(c.name) })) : null,
          ...(adminUser ? { admin: { name: adminCharacterName(engine) } } : {}),
        }));
        return;
      }
      html(res, 200, PAGE);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/invitaciones') {
      if (!host) { html(res, 403, invitePage()); return; }
      if (!manifest) { redirect(res, '/'); return; }
      html(res, 200, seatsPage(manifest.slug));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/character/preview') {
      if (!canCreate && !user && !(manifest && allowed)) { json(res, 403, { ok: false, text: 'Entra con tu cuenta.' }); return; }
      const input = characterFromBody(await readJson(req), 'name');
      const r = GameManager.previewCharacter(input);
      if (!r.ok) { json(res, 400, { ok: false, text: r.reason, field: r.field }); return; }
      // En una partida ya en marcha (invitación), el nombre no puede estar cogido.
      if (manifest && allowed && (await runtime(manifest.slug)).engine.characterNameTaken(input.name)) { json(res, 400, { ok: false, text: 'Ese nombre ya está en uso.', field: 'name' }); return; }
      json(res, 200, { ok: true, preview: r.preview });
      return;
    }
    if (url.pathname === '/api/games' || url.pathname.startsWith('/api/games/')) {
      // Borrar o convertir una partida: solo su dueño (o el administrador).
      if (!(url.pathname === '/api/games' && (req.method === 'GET' || req.method === 'POST')) && !host) {
        json(res, 403, { ok: false, text: 'Solo quien creó la partida puede hacer eso.' });
        return;
      }
      if (url.pathname === '/api/games' && req.method === 'POST' && !canCreate) {
        json(res, 403, { ok: false, text: 'En este servidor las partidas las crea quien lo administra. Únete a una con un enlace de invitación.' });
        return;
      }
      await handleGames(req, res, url, slug, admin, user);
      return;
    }
    if (url.pathname === '/api/seats' || url.pathname.startsWith('/api/seats/')) {
      if (!host) { json(res, 403, { ok: false, text: 'Solo quien organiza la partida puede repartir invitaciones.' }); return; }
      if (!manifest) { json(res, 404, { ok: false, text: 'No existe esa partida.' }); return; }
      await handleSeats(req, res, url, manifest.slug);
      return;
    }
    if (url.pathname === '/api/tts/config') { await handleTtsRequest(req, res, url, games); return; }
    if (!allowed && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/'))) {
      json(res, 403, { ok: false, text: 'No tienes sitio en esta partida: entra con tu enlace de invitación.' });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) { await serveImage(res, url.pathname.slice('/images/'.length), slug); return; }
    if (url.pathname === '/api/tts' || url.pathname.startsWith('/api/tts/')) { await handleTtsRequest(req, res, url, games); return; }
    if (!url.pathname.startsWith('/api/')) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }

    if (!slug) { json(res, 400, { ok: false, text: 'Falta el parámetro game (?game=<partida>): abre una partida desde el menú.' }); return; }
    if (!manifest) { json(res, 404, { ok: false, text: `No existe la partida «${slug}».` }); return; }
    const rt = await runtime(slug);
    const { engine } = rt;
    // Ligado a un asiento: solo su PJ, en cualquier ruta (query o cuerpo). El administrador, con asiento o sin él,
    // mira y juega con cualquier PJ de la partida (es para comprobar e intervenir, no para jugarla).
    const bound = seat?.character_id ?? null;
    const characterParam = url.searchParams.get('character') ?? bound;
    if (bound && characterParam !== bound && !adminUser) { json(res, 403, { ok: false, text: 'Solo puedes jugar con tu personaje.' }); return; }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      const book = games.budgetOf(engine);
      const me = bound ?? null;
      json(res, 200, {
        ok: true, access: access.mode, role: host ? 'admin' : 'player', character_id: me, can_switch: adminUser || !bound,
        game: { slug: manifest.slug, name: manifest.name, mode: manifest.mode },
        seat: seat ? { id: seat.id, label: seat.label } : null,
        user: user ? publicUser(user) : null,
        budget: me && book ? { ...book.of(me), limit_actions: book.limits.actions, limit_tokens: book.limits.tokens } : null,
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/seat/claim') {
      if (!seat || seat.character_id || claiming.has(seat.id)) { json(res, 400, { ok: false, text: seat ? 'Este asiento ya tiene personaje.' : 'Entra con un enlace de invitación.' }); return; }
      const body = await readJson(req);
      claiming.add(seat.id);
      try {
        // El atajo del administrador: el PJ por defecto «admin» (humano, guerrero), sin pasar por la biblioteca.
        const picked = adminUser && body['default'] === true
          ? { input: { name: adminCharacterName(engine), race_id: 'human', class_id: 'fighter', death_mode: 'casual' as const }, template_id: null }
          : await pickCharacter(user, body, 'name', (c) => {
            if (engine.characterNameTaken(c.name)) throw new AccountError(`Ya hay alguien llamado ${c.name.trim()} en esta partida: cambia el nombre.`, 400, 'name');
          });
        const near = body['near'];
        const id = await games.addCharacter(manifest.slug, `web:${manifest.slug}:${seat.id}`, picked.input, { near: typeof near === 'string' && near ? near : null });
        await (await accountsOf()).setSeatCharacter(seat.id, id, picked.template_id);
        rt.introduce(id);
        json(res, 200, { ok: true, character_id: id });
      } catch (e) {
        if (e instanceof AccountError) { json(res, e.status, { ok: false, text: e.message, ...(e.field ? { field: e.field } : {}) }); return; }
        throw e;
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
      await engine.welcomeBack(id).catch((e) => console.error(`[web] recap partida=${slug} pj=${id}:`, e));
      // no-transform y x-accel-buffering: que ningún proxy (túnel de Cloudflare, nginx) comprima ni retenga el stream; el relleno inicial fuerza el primer envío.
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(':' + ' '.repeat(2048) + '\n\n');
      const ill = illustratorOf(engine);
      // En una sola escritura: quién habla y el historial llegan juntos.
      // Si se está presentando, la página no pide la descripción del sitio: el hilo empieza en el prólogo, que está al llegar.
      res.write(`event: cast\ndata: ${JSON.stringify(castOf(engine, id, ill, slug))}\n\n`
        + (rt.isOpening(id) ? 'event: opening\ndata: {}\n\n' : '')
        // Hasta dónde había leído: la línea «Hasta aquí habías leído» (whileaway.ts).
        + `event: read\ndata: ${JSON.stringify({ seq: engine.world.character(id).read_seq ?? null })}\n\n`
        + `event: history\ndata: ${JSON.stringify(historyFor(engine, id, rt.history.get(id) ?? []).map((m) => withImages(m, ill, slug, engine)))}\n\n`);
      const set = rt.streams.get(id) ?? new Set();
      set.add(res);
      rt.streams.set(id, set);
      // Cada pestaña trae su id: EventSource reconecta con la misma URL, así que un corte corto no la cuenta como nueva.
      // Sin id es una página de antes del latido: cuenta mientras su stream siga abierto.
      const sent = (url.searchParams.get('tab') ?? '').slice(0, 64);
      const tab = sent || randomToken(8);
      rt.joined(id, tab, Boolean(sent));
      res.write(`event: presence\ndata: ${JSON.stringify(rt.presenceFor(id))}\n\n`);
      const round = rt.roundFor(id);
      if (round) res.write(`event: round\ndata: ${JSON.stringify(round)}\n\n`);
      const fight = rt.combatFor(id);
      if (fight) res.write(`event: combat\ndata: ${JSON.stringify(fight)}\n\n`);
      if (seat) void accountsOf().then((a) => a.touchSeat(seat.id)).catch(() => {});
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      // «close» de la respuesta: salta al caerse la conexión (tras un proxy, a más tardar al escribir el ping).
      res.on('close', () => { clearInterval(ping); set.delete(res); rt.left(id, tab); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/board') { handleBoardRequest(engine, req, res, url, slug); return; }
    if (req.method === 'GET' && url.pathname === '/api/board/background') { await handleBoardBackgroundRequest(engine, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/item-art') { await handleItemArtRequest(engine, res, url); return; }
    if (req.method === 'GET' && url.pathname === '/api/journal') { handleJournalRequest(engine, req, res, url, slug); return; }
    if (req.method === 'GET' && url.pathname === '/api/tablon') {
      const id = characterOr404(engine, characterParam, res);
      if (id) json(res, 200, tablonView(engine, id));
      return;
    }
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
    if (req.method === 'GET' && url.pathname === '/api/shop') {
      const id = characterOr404(engine, characterParam, res);
      if (id) json(res, 200, shopView(engine, id));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sheet') {
      const id = characterOr404(engine, characterParam, res);
      if (id) { const s = sheetView(engine, id); json(res, 200, { ...s, pack: withItemArt(engine, s.pack, id, slug) }); }
      return;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const asked = typeof body['character'] === 'string' ? body['character'] : bound;
      if (bound && asked !== bound && !adminUser) { json(res, 403, { ok: false, text: 'Solo puedes jugar con tu personaje.' }); return; }
      const id = characterOr404(engine, asked, res);
      if (!id) return;
      switch (url.pathname) {
        case '/api/act': {
          const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
          if (!text) { json(res, 400, { ok: false, text: 'Acción vacía.' }); return; }
          if (!rt.begin(id)) { json(res, 409, { ok: false, text: 'Ya tienes una acción en curso: espera a que el narrador responda.' }); return; }
          try { json(res, 200, reply(await rt.actions.track(id, 'act', () => engine.act(id, text), refused))); } finally { rt.end(id); }
          return;
        }
        case '/api/say': {
          // Sin bloqueo de doble acción ni cola: decir algo no espera al narrador.
          const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
          if (!text) { json(res, 400, { ok: false, text: '¿Qué dices?' }); return; }
          // El modo Decir se queda puesto: una acción («dar mis monedas») no se dice; la página la manda al narrador.
          if (sayLooksLikeAction(text)) { json(res, 200, { ok: true, text: null, as_action: true }); return; }
          const to = typeof body['to'] === 'string' && body['to'] ? body['to'] : null;
          const mode = body['mode'] === 'shout' || body['mode'] === 'whisper' ? body['mode'] : undefined;
          json(res, 200, reply(await rt.actions.track(id, 'say', () => engine.say(id, text, { to, ...(mode ? { mode } : {}) }), refused)));
          return;
        }
        case '/api/presence': {
          const tab = typeof body['tab'] === 'string' ? body['tab'].slice(0, 64) : '';
          const state = body['state'] === 'hidden' || body['state'] === 'gone' ? body['state'] : 'visible';
          if (tab) rt.beat(id, tab, state);
          // Después del latido: si este le trae de vuelta, su tarjeta cuenta desde lo que tenía leído hasta ahora.
          if (typeof body['read'] === 'number') engine.markRead(id, body['read']);
          json(res, 200, { ok: true });
          return;
        }
        case '/api/tablon/read': {
          // Abrir el Tablón es leerlo, como /tablon; los recién leídos aún salen marcados como nuevos.
          const seenBefore = boardSeen(engine.world.character(id));
          const fresh = activeJobs(engine.world).filter((j) => seenBefore[j.id] === undefined).map((j) => j.id);
          engine.readTablon(id);
          json(res, 200, tablonView(engine, id, fresh));
          return;
        }
        case '/api/typing': {
          rt.typing(id);
          json(res, 200, { ok: true });
          return;
        }
        case '/api/offer': {
          const offer = typeof body['offer'] === 'string' ? body['offer'] : '';
          json(res, 200, reply(await rt.actions.track(id, 'offer', () => engine.answerOffer(id, offer, body['accept'] === true), refused)));
          return;
        }
        case '/api/reaction': {
          const reaction = typeof body['reaction'] === 'string' ? body['reaction'] : '';
          const answer = body['answer'] === 'accept' || body['answer'] === 'resist' ? body['answer'] : null;
          const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
          if (!answer && !text) { json(res, 400, { ok: false, text: '¿Te dejas o te resistes?' }); return; }
          if (!rt.begin(id)) { json(res, 409, { ok: false, text: 'Ya tienes una acción en curso: espera a que el narrador responda.' }); return; }
          try { json(res, 200, reply(await rt.actions.track(id, 'reaction', () => engine.answerReaction(id, reaction, answer, text || null), refused))); } finally { rt.end(id); }
          return;
        }
        case '/api/roll': {
          if (!rt.begin(id)) { json(res, 409, { ok: false, text: 'Ya tienes una acción en curso: espera a que el narrador responda.' }); return; }
          try { json(res, 200, reply(await rt.actions.track(id, 'roll', () => engine.rollPending(id), refused))); } finally { rt.end(id); }
          return;
        }
        case '/api/quest/drop': {
          const quest = typeof body['quest'] === 'string' ? body['quest'] : '';
          json(res, 200, await rt.actions.track(id, 'quest_drop', () => engine.dropQuest(id, quest), refused));
          return;
        }
        // Responder a una misión ofrecida (story.ts): { quest, accept }.
        case '/api/quest/answer': {
          const quest = typeof body['quest'] === 'string' ? body['quest'] : '';
          json(res, 200, await rt.actions.track(id, 'quest_answer', () => engine.answerQuest(id, quest, body['accept'] === true), refused));
          return;
        }
        case '/api/choice': {
          const key = typeof body['key'] === 'string' ? body['key'] : '';
          const picks = Array.isArray(body['picks']) ? body['picks'].filter((x): x is string => typeof x === 'string').slice(0, 40) : [];
          json(res, 200, await engine.choose(id, key, picks));
          return;
        }
        case '/api/inventory': {
          // Arrastrar en la mochila: {instance, to: {kind: 'hand'|'pocket'|'container'|'equipped', which?, id?, slot?}}.
          const inst = typeof body['instance'] === 'string' ? body['instance'] : '';
          const to = (body['to'] ?? {}) as Record<string, unknown>;
          const dest = to['kind'] === 'hand' && (to['which'] === 'main' || to['which'] === 'off') ? { kind: 'hand' as const, which: to['which'] as 'main' | 'off' }
            : to['kind'] === 'pocket' ? { kind: 'pocket' as const }
            : to['kind'] === 'container' && typeof to['id'] === 'string' ? { kind: 'container' as const, id: to['id'] }
            : to['kind'] === 'equipped' && typeof to['slot'] === 'string' ? { kind: 'equipped' as const, slot: to['slot'] } : null;
          if (!inst || !dest) { json(res, 400, { ok: false, text: '¿Adónde lo llevas?' }); return; }
          const r = await engine.moveItem(id, inst, dest);
          json(res, 200, { ok: r.ok, text: r.text });
          return;
        }
        // Comprar con el botón de la tienda (tienda.ts): el atajo determinista del motor, sin máster.
        case '/api/shop/buy': {
          const npc = typeof body['npc'] === 'string' ? body['npc'] : '';
          const item = typeof body['item'] === 'string' ? body['item'] : '';
          const q = Number.isInteger(body['quantity']) ? Math.max(1, Math.min(20, body['quantity'] as number)) : 1;
          if (!npc || !item) { json(res, 400, { ok: false, text: '¿Qué compras?' }); return; }
          if (!rt.begin(id)) { json(res, 409, { ok: false, text: 'Ya tienes una acción en curso: espera a que el narrador responda.' }); return; }
          try { json(res, 200, reply(await rt.actions.track(id, 'shop_buy', () => engine.shopBuy(id, npc, item, q), refused))); } finally { rt.end(id); }
          return;
        }
        case '/api/command': {
          const name = typeof body['name'] === 'string' ? body['name'] : '';
          json(res, 200, { ok: true, text: await rt.actions.track(id, 'command', () => engine.command(id, name)) });
          return;
        }
        case '/api/report': {
          const text = typeof body['text'] === 'string' ? body['text'].trim().slice(0, REPORT_MAX_TEXT) : '';
          if (!text) { json(res, 400, { ok: false, text: '¿Qué ha pasado?' }); return; }
          const sent = body['seq'];
          if (sent !== undefined && sent !== null && !Number.isInteger(sent)) { json(res, 400, { ok: false, text: 'No encuentro ese mensaje.' }); return; }
          if (!reportQuota.take(`${slug}:${id}`)) { json(res, 429, { ok: false, text: 'Ya has mandado muchos reportes esta hora. Prueba dentro de un rato.' }); return; }
          const report = reportOf(engine, manifest.slug, id, {
            seq: typeof sent === 'number' ? sent : null, text,
            client_at: typeof body['at'] === 'string' ? body['at'].slice(0, 40) : null,
            user_agent: req.headers['user-agent']?.slice(0, 300) ?? null,
            server_version: versionLabel(await serverVersion()),
          });
          if (!report) { json(res, 404, { ok: false, text: 'No encuentro ese mensaje.' }); return; }
          const file = await saveReport(games.paths(manifest).dir, report);
          log(reportLine(manifest.slug, id, report.character.name, { seq: report.seq, general: report.general, event_type: report.event?.action_type ?? null, length: text.length, file }));
          json(res, 200, { ok: true });
          return;
        }
      }
    }
    json(res, 404, { ok: false, text: 'No encontrado.' });
  }

  /** /admin/estado. Solo mira las partidas abiertas: las cerradas no tienen a nadie y abrirlas gastaría memoria. */
  async function statusHtml(): Promise<string> {
    const open = new Map<string, Runtime>();
    for (const [name, p] of runtimes) { const rt = await p.catch(() => null); if (rt) open.set(name, rt); }
    const manifests = (await Promise.all((await games.list()).map((g) => games.get(g.slug)))).filter((m) => m !== null);
    const list = await listReports(manifests.map((m) => ({ slug: m.slug, name: m.name, dir: games.paths(m).dir })));
    return statusPage({
      started_at: startedAt, now: Date.now(), tz: statusTz,
      version: versionLabel(await serverVersion()), access: access.mode,
      games: manifests.map((m) => {
        const rt = open.get(m.slug);
        const players = rt ? [...rt.engine.world.characters.values()].filter((c) => rt.online(c.id)).map((c) => c.name) : [];
        return { slug: m.slug, name: m.name, mode: m.mode, players };
      }),
      hour: stats.lastHour(), today: stats.today(),
      reports: { total: list.total, items: list.reports },
    });
  }

  // -------------------------------------------------------------------------
  // Cuentas (src/accounts): sesión, asientos, migración de las cookies de antes
  // -------------------------------------------------------------------------

  /** El usuario de la cookie de sesión, si la hay y vale. Sin cookie no se toca la base. */
  async function currentUser(req: IncomingMessage): Promise<User | null> {
    const token = cookies(req)[USER_COOKIE];
    return token ? (await accountsOf()).sessionUser(token) : null;
  }

  async function startSession(req: IncomingMessage, res: ServerResponse, u: User): Promise<void> {
    const token = await (await accountsOf()).createSession(u.id, { userAgent: String(req.headers['user-agent'] ?? ''), ip: clientIp(req) });
    setCookie(res, access, USER_COOKIE, token, SESSION_COOKIE_MAX_AGE_S);
  }

  /** El asiento del usuario en la partida; sin cuenta en `open`, el de la cookie del navegador. */
  async function seatFor(req: IncomingMessage, user: User | null, slug: string, byCookie: boolean): Promise<Seat | null> {
    if (user) {
      const mine = await (await accountsOf()).seatOfUser(slug, user.id);
      if (mine || access.mode !== 'open') return mine;
    }
    return byCookie || access.mode === 'open' ? legacySeat(req, slug) : null;
  }

  /** El asiento de la cookie antigua del navegador, si su firma es buena (con el token vigente). */
  async function legacySeat(req: IncomingMessage, slug: string): Promise<Seat | null> {
    const value = cookies(req)[seatCookieName(slug)];
    const id = seatIdOf(value);
    if (!id) return null;
    const seat = await (await accountsOf()).seat(slug, id);
    return checkSeatCookie(access.secret, slug, value, seat) ? seat : null;
  }

  function hasLegacySeatCookies(req: IncomingMessage): boolean {
    return Object.keys(cookies(req)).some((k) => k.startsWith('tv_s_'));
  }

  /**
   * Migración (docs/MULTIJUGADOR.md, «Cuentas»): cada cookie de asiento válida de este navegador liga su asiento
   * al usuario si nadie lo tiene; si es el del anfitrión y la partida no tiene dueño, la partida pasa a ser suya.
   * Las cookies se borran después: ya no hacen falta.
   */
  async function claimLegacySeats(req: IncomingMessage, res: ServerResponse, user: User): Promise<number> {
    const accounts = await accountsOf();
    let n = 0;
    for (const name of Object.keys(cookies(req))) {
      if (!name.startsWith('tv_s_')) continue;
      const slug = name.slice(5);
      const m = await games.get(slug);
      const seat = m ? await legacySeat(req, m.slug) : null;
      if (m && seat && !seat.user_id && !(await accounts.seatOfUser(m.slug, user.id))) {
        await accounts.bindSeat(seat, user.id).catch(() => null);
        if (seat.host && !(await accounts.ownerOf(m.slug))) await accounts.setOwner(m.slug, user.id);
        log(`[cuentas] ${user.username} se lleva su asiento de «${m.slug}»${seat.host ? ' (anfitrión)' : ''}`);
        n++;
      }
      // En `open` la cookie sigue sirviendo a quien juega sin cuenta en este navegador; fuera de `open`, ya no.
      if (access.mode !== 'open' || (seat && seat.user_id === null)) clearCookie(res, access, name);
    }
    return n;
  }

  /**
   * El administrador en una partida ajena (docs/MULTIJUGADOR.md, «Administración»): entra como un jugador más,
   * con un asiento suyo (uno libre o, si no lo hay, uno nuevo, como «Añadir asiento libre»). Con el asiento aún
   * sin PJ, la página de unirse le deja elegir uno de su biblioteca, crear uno o el atajo «admin» (humano,
   * guerrero; `/api/seat/claim` con `default`). Dentro, el selector le deja mirar y jugar con cualquier PJ.
   */
  async function adminSeat(manifest: GameManifest, user: User): Promise<Seat> {
    const accounts = await accountsOf();
    await ensureGameRow(accounts.db, manifest);
    const free = (await accounts.seats(manifest.slug)).find((s) => !s.user_id && !s.character_id) ?? null;
    const seat = await accounts.bindSeat(free ?? await accounts.addSeat(manifest.slug, { label: 'Administración' }), user.id);
    log(`[cuentas] ${user.username} (administración) recibe el asiento «${seat.label}» de «${manifest.slug}»`);
    return seat;
  }

  /** El nombre del PJ por defecto del administrador en esa partida: «admin», o «admin 2» si ya hay uno. */
  function adminCharacterName(engine: Engine): string {
    let name = ADMIN_CHARACTER;
    for (let n = 2; engine.characterNameTaken(name); n++) name = `${ADMIN_CHARACTER} ${n}`;
    return name;
  }

  /**
   * «<partida>/<token>» de una invitación pendiente (al registrarse o entrar), si el enlace vale. `free`: el asiento
   * aún no es de ninguna cuenta (solo entonces sirve para crear una en modo `invite`; a quien ya lo tiene le sirve para entrar).
   */
  async function inviteOf(value: string | null): Promise<{ slug: string; token: string; name: string; free: boolean } | null> {
    const mm = value ? /^([a-z0-9][a-z0-9-]{0,59})\/([A-Za-z0-9_-]{20,})$/.exec(value) : null;
    if (!mm) return null;
    const m = await games.get(mm[1]!);
    const seat = m ? await (await accountsOf()).seatByToken(m.slug, mm[2]!) : null;
    return m && seat ? { slug: m.slug, token: mm[2]!, name: m.name, free: seat.user_id === null } : null;
  }

  /**
   * El personaje con el que se entra en una partida: uno de la biblioteca (`template_id`) o uno nuevo con los
   * campos del asistente, que con cuenta queda guardado en la biblioteca (salvo `save: false`).
   */
  async function pickCharacter(user: User | null, body: Record<string, unknown>, nameKey: string, check: (input: CharacterInput) => void = () => {}): Promise<{ input: CharacterInput; template_id: string | null }> {
    const accounts = await accountsOf();
    const tid = typeof body['template_id'] === 'string' ? body['template_id'] : null;
    if (tid) {
      if (!user) throw new AccountError('Entra con tu cuenta para usar tus personajes.', 401);
      const c = await accounts.libraryCharacter(user.id, tid);
      if (!c) throw new AccountError('No existe ese personaje en tu biblioteca.', 404);
      const { id, created_at: _c, updated_at: _u, ...input } = c;
      // Para empezar con otro nombre (el suyo ya está cogido en la partida), sin cambiar la plantilla.
      const rename = typeof body['rename'] === 'string' ? body['rename'].trim() : '';
      const out = rename ? { ...input, name: rename } : input;
      check(out);
      return { input: out, template_id: id };
    }
    const input = characterFromBody(body, nameKey);
    // Antes de guardarlo en la biblioteca: lo que la partida no aceptaría no se guarda.
    const valid = GameManager.previewCharacter(input);
    if (!valid.ok) throw new AccountError(valid.reason, 400, valid.field);
    check(input);
    if (user && body['save'] !== false && input.name.trim()) {
      const saved = await accounts.addCharacter(user.id, input);
      return { input, template_id: saved.id };
    }
    return { input, template_id: null };
  }

  /** Todo PJ de la partida con su asiento (partidas de antes de las invitaciones, o PJ creados por otra vía). */
  async function ensureSeats(slug: string): Promise<Seat[]> {
    const accounts = await accountsOf();
    const engine = (await runtime(slug)).engine;
    const chars = [...engine.world.characters.values()].filter((c) => c.status !== 'retired');
    const have = await accounts.seats(slug);
    const missing = chars.filter((c) => !have.some((s) => s.character_id === c.id));
    if (!missing.length) return have;
    await ensureGameRow(accounts.db, (await games.get(slug))!);
    for (const c of missing) await accounts.addSeat(slug, { label: c.name, character_id: c.id });
    return accounts.seats(slug);
  }

  async function handleSeats(req: IncomingMessage, res: ServerResponse, url: URL, slug: string): Promise<void> {
    const accounts = await accountsOf();
    if (req.method === 'POST' && url.pathname === '/api/seats') {
      const n = (await accounts.seats(slug)).length;
      if (n >= MAX_SEATS) { json(res, 400, { ok: false, text: `Como mucho ${MAX_SEATS} asientos por partida.` }); return; }
      await ensureGameRow(accounts.db, (await games.get(slug))!);
      await accounts.addSeat(slug, { label: `Plaza ${n + 1}` });
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/seats/regenerate' || url.pathname === '/api/seats/release')) {
      const body = await readJson(req);
      const id = typeof body['seat'] === 'string' ? body['seat'] : '';
      const ok = url.pathname === '/api/seats/regenerate' ? await accounts.regenerateSeat(slug, id) : await accounts.unbindSeat(slug, id);
      json(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, text: 'No existe ese asiento.' });
      return;
    }
    if (req.method !== 'GET' || url.pathname !== '/api/seats') { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    const m = (await games.get(slug))!;
    const rt = await runtime(slug);
    const list = await ensureSeats(slug);
    const names = new Map((await accounts.listUsers()).filter((u) => list.some((s) => s.user_id === u.id)).map((u) => [u.id, u.username]));
    json(res, 200, {
      ok: true, game: { slug, name: m.name },
      seats: list.map((s) => ({
        id: s.id, label: s.label, host: s.host, character_id: s.character_id, character_name: s.character_id ? rt.engine.world.characters.get(s.character_id)?.name ?? null : null,
        user: s.user_id ? names.get(s.user_id) ?? null : null,
        link: `/i/${slug}/${s.token}`, last_seen_at: s.last_seen_at, online: s.character_id ? rt.online(s.character_id) : false,
      })),
    });
  }

  /** Biblioteca de personajes del usuario: GET y POST /api/library, POST y DELETE /api/library/<id>. */
  async function handleLibrary(req: IncomingMessage, res: ServerResponse, url: URL, user: User): Promise<void> {
    const accounts = await accountsOf();
    const id = url.pathname.startsWith('/api/library/') ? decodeURIComponent(url.pathname.slice('/api/library/'.length)) : null;
    try {
      if (!id && req.method === 'GET') {
        json(res, 200, { ok: true, characters: await libraryView(user.id) });
        return;
      }
      if (!id && req.method === 'POST') {
        json(res, 200, { ok: true, character: await accounts.addCharacter(user.id, characterFromBody(await readJson(req), 'name')) });
        return;
      }
      if (id && req.method === 'POST') {
        json(res, 200, { ok: true, character: await accounts.updateCharacter(user.id, id, characterFromBody(await readJson(req), 'name')) });
        return;
      }
      if (id && req.method === 'DELETE') {
        await accounts.deleteCharacter(user.id, id);
        json(res, 200, { ok: true });
        return;
      }
    } catch (e) {
      if (e instanceof AccountError) { json(res, e.status, { ok: false, text: e.message, ...(e.field ? { field: e.field } : {}) }); return; }
      throw e;
    }
    json(res, 404, { ok: false, text: 'No encontrado.' });
  }

  /** La biblioteca con las partidas en las que juega cada personaje (sus copias). */
  async function libraryView(userId: string): Promise<unknown[]> {
    const accounts = await accountsOf();
    const lib = await accounts.library(userId);
    const playing = await accounts.db.query<{ template_id: string; slug: string; name: string }>(
      'select s.template_id, g.slug, g.name from seats s join games g on g.slug = s.game_slug where s.user_id = $1 and s.template_id is not null', [userId]);
    return lib.map((c) => ({ ...c, games: playing.filter((p) => p.template_id === c.id).map((p) => ({ slug: p.slug, name: p.name })) }));
  }

  /** Panel del administrador (page-admin.ts). */
  async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, user: User | null): Promise<void> {
    const accounts = await accountsOf();
    const who = user ? { id: user.id, name: user.username } : { id: null, name: 'sin cuenta (modo abierto)' };
    try {
      if (req.method === 'GET' && url.pathname === '/api/admin/users') {
        json(res, 200, { ok: true, me: user?.id ?? null, users: await accounts.listUsers(), log: await accounts.recentLog(30) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/users') {
        const body = await readJson(req);
        const u = await accounts.register(body['username'], body['password']);
        await accounts.log(who, 'creó la cuenta de', u.username);
        json(res, 200, { ok: true, user: u });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/games') {
        const owners = await accounts.owners();
        const seated = await accounts.db.query<{ game_slug: string; id: string; username: string }>('select s.game_slug, u.id, u.username from seats s join users u on u.id = s.user_id order by u.username');
        json(res, 200, {
          ok: true,
          games: (await games.list()).map((g) => ({
            slug: g.slug, name: g.name, mode: g.mode, demo: g.demo, created_at: g.created_at, last_opened_at: g.last_opened_at, characters: g.characters,
            owner: owners.get(g.slug) ?? null, players: seated.filter((s) => s.game_slug === g.slug).map((s) => ({ id: s.id, username: s.username })),
          })),
        });
        return;
      }
      // Una partida: quién es su dueño y quién ocupa cada asiento (con su PJ), para el detalle del panel.
      const gm = /^\/api\/admin\/games\/([a-z0-9][a-z0-9-]{0,59})$/.exec(url.pathname);
      if (gm && req.method === 'GET') {
        const m = await games.get(gm[1]!);
        if (!m) { json(res, 404, { ok: false, text: 'No existe esa partida.' }); return; }
        const info = await games.info(m);
        const rt = await runtime(m.slug);
        const list = await ensureSeats(m.slug);
        const names = new Map((await accounts.listUsers()).map((u) => [u.id, u.username]));
        json(res, 200, {
          ok: true,
          game: { slug: m.slug, name: m.name, mode: m.mode, demo: m.demo, campaign_id: m.campaign_id, created_at: m.created_at, last_opened_at: m.last_opened_at, characters: info.characters },
          owner: (await accounts.owners()).get(m.slug) ?? null,
          seats: list.map((s) => ({
            id: s.id, label: s.label, host: s.host, character_id: s.character_id,
            character_name: s.character_id ? rt.engine.world.characters.get(s.character_id)?.name ?? null : null,
            user: s.user_id ? { id: s.user_id, username: names.get(s.user_id) ?? '?' } : null,
            last_seen_at: s.last_seen_at, online: s.character_id ? rt.online(s.character_id) : false,
          })),
        });
        return;
      }
      // Un personaje de la biblioteca de un usuario: su ficha (como el resumen del asistente), renombrarlo o borrarlo.
      const cm = /^\/api\/admin\/users\/([0-9a-f-]{36})\/characters\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (cm) {
        const owner = await accounts.user(cm[1]!);
        const c = owner ? await accounts.libraryCharacter(owner.id, cm[2]!) : null;
        if (!owner || !c) { json(res, 404, { ok: false, text: 'No existe ese personaje.' }); return; }
        const { id: _id, created_at: _c, updated_at: _u, ...input } = c;
        if (req.method === 'GET') {
          const r = GameManager.previewCharacter(input);
          json(res, 200, { ok: true, character: c, preview: r.ok ? r.preview : null });
          return;
        }
        if (req.method === 'POST') {
          const body = await readJson(req);
          const name = typeof body['name'] === 'string' ? body['name'] : '';
          const updated = await accounts.updateCharacter(owner.id, c.id, { ...input, name });
          await accounts.log(who, `renombró el personaje ${c.name} (ahora ${updated.name}) de`, owner.username);
          json(res, 200, { ok: true, character: updated });
          return;
        }
        if (req.method === 'DELETE') {
          await accounts.deleteCharacter(owner.id, c.id);
          await accounts.log(who, `borró el personaje ${c.name} de`, owner.username);
          json(res, 200, { ok: true });
          return;
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/games/assign') {
        const body = await readJson(req);
        const slugIn = typeof body['game'] === 'string' ? body['game'] : '';
        const m = await games.get(slugIn);
        if (!m) { json(res, 404, { ok: false, text: 'No existe esa partida.' }); return; }
        const name = typeof body['user'] === 'string' ? body['user'].trim() : '';
        const target = name ? await accounts.userByName(name) : null;
        if (name && !target) { json(res, 404, { ok: false, text: `No existe el usuario «${name}».` }); return; }
        await ensureGameRow(accounts.db, m);
        await accounts.assignGame(m.slug, target?.id ?? null);
        await accounts.log(who, target ? `dio a ${target.username} la partida` : 'dejó sin dueño la partida', m.name, target ? { usuario: target.username, partida: m.slug } : { partida: m.slug });
        json(res, 200, { ok: true });
        return;
      }
      const um = /^\/api\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
      const target = um ? await accounts.user(um[1]!) : null;
      if (um && !target) { json(res, 404, { ok: false, text: 'No existe ese usuario.' }); return; }
      if (target && req.method === 'GET') {
        const mine = await accounts.gamesOf(target.id);
        const all = new Map((await games.list()).map((g) => [g.slug, g]));
        const { races, classes } = GameManager.characterOptions();
        json(res, 200, {
          ok: true, me: user?.id ?? null, user: target, characters: await libraryView(target.id),
          games: mine.map((g) => ({ slug: g.slug, name: all.get(g.slug)?.name ?? g.slug, owner: g.owner })),
          options: { races: races.map((r) => ({ id: r.id, name: r.name })), classes: classes.map((c) => ({ id: c.id, name: c.name })) },
        });
        return;
      }
      if (target && req.method === 'POST') {
        const body = await readJson(req);
        if (typeof body['password'] === 'string') { await accounts.setPassword(target.id, body['password']); await accounts.log(who, 'cambió la contraseña de', target.username); }
        if (typeof body['admin'] === 'boolean') {
          if (!body['admin'] && user?.id === target.id) throw new AccountError('No puedes quitarte el administrador a ti mismo.', 409);
          await accounts.setAdmin(target.id, body['admin']); await accounts.log(who, body['admin'] ? 'hizo administrador a' : 'quitó el administrador a', target.username);
        }
        if (typeof body['disabled'] === 'boolean') {
          if (body['disabled'] && user?.id === target.id) throw new AccountError('No puedes desactivarte a ti mismo.', 409);
          await accounts.setDisabled(target.id, body['disabled']); await accounts.log(who, body['disabled'] ? 'desactivó a' : 'reactivó a', target.username);
        }
        json(res, 200, { ok: true, user: await accounts.user(target.id) });
        return;
      }
      if (target && req.method === 'DELETE') {
        if (user?.id === target.id) throw new AccountError('No puedes borrar tu propia cuenta desde aquí.', 409);
        await accounts.deleteUser(target.id);
        await accounts.log(who, 'borró la cuenta de', target.username);
        json(res, 200, { ok: true });
        return;
      }
    } catch (e) {
      if (e instanceof AccountError) { json(res, e.status, { ok: false, text: e.message, ...(e.field ? { field: e.field } : {}) }); return; }
      throw e;
    }
    json(res, 404, { ok: false, text: 'No encontrado.' });
  }

  /** Solo ficheros de la carpeta images/ de la partida, con nombre plano (sin rutas). */
  async function serveImage(res: ServerResponse, name: string, slug: string | null): Promise<void> {
    const m = slug ? await games.get(slug) : null;
    if (!m || !/^[A-Za-z0-9_-]+\.(jpg|png)$/.test(name)) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    let bytes: Buffer;
    try { bytes = await readFile(join(games.paths(m).dir, 'images', name)); } catch { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    res.writeHead(200, { 'content-type': name.endsWith('.png') ? 'image/png' : 'image/jpeg', 'cache-control': 'public, max-age=86400' });
    res.end(bytes);
  }

  /** Imágenes fijas de la interfaz: public/ en la raíz del proyecto (vale igual desde src/ que desde dist/). */
  /**
   * La wiki (docs/WIKI.md): los ficheros de dist/wiki tal cual, pública como la portada. Sin extensión es una
   * página (.html); con barra final, el índice de la carpeta. Nada fuera de la carpeta ni de los tipos de la wiki.
   */
  async function serveWiki(res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/wiki') { res.writeHead(301, { location: '/wiki/' }); res.end(); return; }
    let p = pathname.slice('/wiki/'.length);
    if (p === '' || p.endsWith('/')) p += 'index.html';
    else if (!/\.[a-z0-9]+$/.test(p)) p += '.html';
    const ext = p.slice(p.lastIndexOf('.') + 1);
    const type = WIKI_TYPES[ext];
    if (!type || !/^[a-z0-9][a-z0-9._/-]*$/.test(p) || p.includes('..') || p.includes('//')) { wikiMissing(res); return; }
    let bytes: Buffer;
    try { bytes = await readFile(join(wikiDir, p)); } catch { wikiMissing(res); return; }
    res.writeHead(200, { 'content-type': type, 'cache-control': ext === 'html' ? 'no-cache' : 'public, max-age=86400' });
    res.end(bytes);
  }

  function wikiMissing(res: ServerResponse): void {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>No está · Wiki de Tavernus</title><link rel="stylesheet" href="/wiki/wiki.css"><body><div class="page"><article><h1>No hay esa página</h1><p>Puede que la hayan movido o que la wiki no esté construida. <a href="/wiki/">Ir a la portada de la wiki</a>.</p></article></div></body></html>');
  }

  async function serveAsset(res: ServerResponse, name: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+\.(jpg|png)$/.test(name)) { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    let bytes: Buffer;
    try { bytes = await readFile(new URL('../../../public/' + name, import.meta.url)); } catch { json(res, 404, { ok: false, text: 'No encontrado.' }); return; }
    res.writeHead(200, { 'content-type': name.endsWith('.png') ? 'image/png' : 'image/jpeg', 'cache-control': 'public, max-age=86400' });
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

  async function handleGames(req: IncomingMessage, res: ServerResponse, url: URL, slug: string | null, admin: boolean, user: User | null): Promise<void> {
    if (url.pathname === '/api/games' && req.method === 'GET') {
      // El administrador las ve todas (y en `open` sin cuenta, todo el mundo); con cuenta, las suyas y donde tiene asiento.
      const all = await games.list();
      const seeAll = admin || (access.mode === 'open' && !user);
      const mine = user ? new Map((await (await accountsOf()).gamesOf(user.id)).map((g) => [g.slug, g.owner])) : new Map<string, boolean>();
      const accounts = user || seeAll ? await accountsOf() : null;
      const list = [];
      for (const g of all) {
        if (seeAll) { list.push({ ...g, host: true, mine: mine.has(g.slug) }); continue; }
        if (!mine.has(g.slug)) continue;
        const seat = await accounts!.seatOfUser(g.slug, user!.id);
        list.push({ ...g, host: mine.get(g.slug) === true || (access.mode === 'public' && isHostSeat(seat)), mine: true });
      }
      json(res, 200, {
        games: list, options: GameManager.characterOptions(), api_key: Master.configured('live'), character_optional: admin, admin,
        access: access.mode, user: user ? publicUser(user) : null, can_create: admin || access.mode !== 'invite',
      });
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
        if (typeof body['name'] !== 'string' || !(typeof body['template_id'] === 'string' || (typeof body['character'] === 'string' && (body['character'] as string).trim()))) { json(res, 400, { ok: false, text: 'Elige o crea tu personaje.' }); return; }
      }
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
      const seedRaw = body['dice_seed'];
      const dice_seed = seedRaw === null || seedRaw === undefined || seedRaw === '' ? null : Number(seedRaw);
      // Personaje: de la biblioteca o nuevo (que con cuenta se guarda en ella). Validado antes de crear nada.
      let picked: { input: CharacterInput; template_id: string | null } | null = null;
      try {
        if (typeof body['template_id'] === 'string' || str('character')) {
          if (!(typeof body['template_id'] === 'string')) {
            const check = GameManager.previewCharacter(characterFromBody(body, 'character'));
            if (!check.ok) { json(res, 400, { ok: false, text: check.reason, field: check.field }); return; }
          }
          picked = await pickCharacter(user, body, 'character');
        }
      } catch (e) {
        if (e instanceof AccountError) { json(res, e.status, { ok: false, text: e.message, ...(e.field ? { field: e.field } : {}) }); return; }
        throw e;
      }
      const created = await games.create({
        name: str('name'), mode: mode as NewGameMode, dice_seed,
        character: picked?.input ?? null,
        // Mundo nuevo generado (src/worldgen); lo valida el gestor.
        world: body['world'] && typeof body['world'] === 'object' ? body['world'] as WorldInput : null,
      });
      // Con máster, la llegada del PJ nuevo la narra él; llega por el stream.
      const rt = await runtime(created.game.slug);
      if (created.character_id) {
        rt.engine.setPresence(created.character_id, true);
        rt.introduce(created.character_id);
      }
      // Dueño y asientos: el del anfitrión con su PJ (ligado a su usuario) y plazas libres para invitar.
      const accounts = await accountsOf();
      const free = Math.max(0, Math.min(MAX_SEATS - 1, Number.isInteger(body['seats']) ? body['seats'] as number : DEFAULT_FREE_SEATS));
      await ensureGameRow(accounts.db, created.game);
      if (user) await accounts.setOwner(created.game.slug, user.id);
      const host = created.character_id
        ? await accounts.addSeat(created.game.slug, { label: 'Anfitrión', host: true, character_id: created.character_id, user_id: user?.id ?? null, template_id: picked?.template_id ?? null })
        : null;
      for (let i = 0; i < free; i++) await accounts.addSeat(created.game.slug, { label: `Plaza ${i + (host ? 2 : 1)}` });
      // Sin cuenta (`open`): la cookie liga este navegador al PJ del anfitrión, como antes.
      if (host && !user) setCookie(res, access, seatCookieName(created.game.slug), seatCookieValue(access.secret, created.game.slug, host));
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
      stats.flush();
      if (ownDb) await (await ownDb.catch(() => null))?.close().catch(() => {});
    },
  };
}

/** Lo que la web dice al arrancar sobre el acceso. */
export function accessBanner(access: AccessOptions, base: string): string[] {
  const out = [`[web] abre ${base}`, `[web] la wiki, en ${base}/wiki/`];
  if (access.mode === 'open') {
    out.push('[web] acceso abierto: cualquiera que llegue a esta URL juega con cualquier personaje, sin cuenta (WEB_ACCESS=public o invite para cuentas)');
    return out;
  }
  out.push(access.mode === 'public'
    ? '[web] acceso público: registro libre en /entrar; cada usuario crea y ve sus partidas, y los enlaces de invitación le unen a otras.'
    : '[web] acceso por invitación: solo se crea cuenta con un enlace de invitación; las partidas las crea el administrador.');
  out.push(`[web] administración: entra con un usuario administrador (npm run admin -- <usuario>; en el VPS, sudo tavernus-admin <usuario>) y abre ${base}/admin/usuarios.`);
  return out;
}

/**
 * Arranca la web. WEB_HOST (127.0.0.1) dice dónde escucha; detrás de un proxy con HTTPS basta el de por
 * defecto. El acceso sale de WEB_ACCESS (access.ts); PUBLIC_URL solo sirve para imprimir enlaces.
 */
export async function startWeb(games: GameManager, port: number, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const host = env['WEB_HOST']?.trim() || '127.0.0.1';
  const access = await accessFromEnv(env, games.root, host);
  // La base (src/db): fuera de `open` tiene que ser un PostgreSQL de verdad (DATABASE_URL).
  const url = dbUrlFromEnv(env, games.root, access.mode);
  if (!url) throw new Error(`Falta DATABASE_URL: con WEB_ACCESS=${access.mode} la web guarda cuentas y partidas en PostgreSQL (docs/DESPLIEGUE.md, «Base de datos»).`);
  const db = await openDb(url);
  console.log(`[web] base de datos: ${describeDbUrl(url)}`);
  const catalog = new DbCatalog(db, games.root);
  await catalog.importFolders((m) => console.log(m));
  games.useCatalog(catalog);
  // El mundo de cada partida: en su carpeta (JSON, por defecto) o en esta misma base (WORLD_STORE=pg, src/games/worlds.ts).
  if (worldStoreFromEnv(env) === 'pg') {
    games.useWorldStore(new PgWorldStore(db));
    console.log('[web] mundos de las partidas: en la base (WORLD_STORE=pg); las de antes pasan de su carpeta al abrirlas');
  }
  const accounts = new Accounts(db);
  // Primer administrador sin navegador (también: npm run admin -- <usuario>).
  const adminUser = env['ADMIN_USER']?.trim();
  if (adminUser) {
    const r = await ensureAdmin(accounts, adminUser, env['ADMIN_PASSWORD'] || null);
    console.log(`[web] administrador «${r.user.username}»${r.created ? ' creado' : ''} (ADMIN_USER)`);
  } else if (access.mode !== 'open' && await accounts.adminCount() === 0) {
    console.log('[web] aún no hay ningún usuario administrador: créalo con npm run admin -- <usuario> (docs/DESPLIEGUE.md)');
  }
  const web = createWebServer(games, { access, db });
  await new Promise<void>((resolve) => web.server.listen(port, host, resolve));
  const base = (env['PUBLIC_URL']?.trim() || `http://localhost:${port}`).replace(/\/+$/, '');
  for (const line of accessBanner(access, base)) console.log(line);
  await new Promise<void>((resolve) => {
    const stop = () => { void web.stop().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await db.close();
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

/** Solo rutas de esta web («/…», no «//otro.sitio»): a dónde volver tras entrar. */
function safeNext(v: string | null): string | null {
  return v && /^\/(?!\/)[^\s\\]*$/.test(v) && v.length < 500 ? v : null;
}

/** La IP de quien llama: tras el proxy (Caddy, túnel), la de X-Forwarded-For; si no, la del socket. */
function clientIp(req: IncomingMessage): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return fwd || req.socket.remoteAddress || '';
}

function publicUser(u: User): { id: string; username: string; is_admin: boolean } {
  return { id: u.id, username: u.username, is_admin: u.is_admin };
}

function characterOr404(engine: Engine, id: string | null, res: ServerResponse): Id | null {
  if (id && engine.world.characters.has(id)) return id;
  json(res, 404, { ok: false, text: 'No existe ese personaje.' });
  return null;
}

/** Con evento, la narración ya llegó por el stream; sin él (consultas, errores) va en la respuesta. */
/** El motor dijo que no (para el registro: resultado=rechazada). */
const refused = (r: { ok: boolean }) => !r.ok;

function reply(r: ActionResult): { ok: boolean; text: string | null; say_to?: { id: Id; name: string }; info?: InfoAnswer } {
  if (!r.ok) return { ok: false, text: r.text };
  return { ok: true, text: r.event ? null : r.text, ...(r.say_to ? { say_to: r.say_to } : {}), ...(r.info ? { info: r.info } : {}) };
}

export function toMessage(d: Delivery, engine: Engine): WebMessage {
  const e: GameEvent = d.event;
  const m: WebMessage = { seq: e.seq, kind: MASTER_TYPES.has(e.action_type) ? 'master' : 'system', text: d.text };
  // Lo que la gente comenta al pasar (chatter.ts): una línea de ambiente con quien lo dice, sin burbuja de narrador.
  const chat = e.action_type === 'chatter' ? e.payload['chatter'] as { npc_id: Id | null; text: string; kind: string } | undefined : undefined;
  if (chat) { m.ambient = { npc_id: chat.npc_id, name: speakerLabel(engine.world, chat.npc_id, d.character_id), text: chat.text, kind: chat.kind }; return m; }
  // Lo informativo no es narración (notice.ts): sale como aviso de sistema de una línea, también en el historial
  // restaurado. El tablón y el progreso llevan al Diario. Sigue con sus botones, momentos y sonido.
  const notice = noticeOf(e, d.character_id, d.text);
  // Tirada a la vista (rolls.ts): la propia anima el dado del botón; la de otro jugador es solo el aviso.
  if (e.payload['shown_roll']) m.dice = e.actor_id === d.character_id ? 'mine' : 'other';
  if (notice) { m.kind = 'system'; m.text = ''; m.notice = notice; }
  else if (!SYSTEM_TYPES.test(e.action_type)) m.narrator = true;
  // Se va o vuelve otro jugador (engine.setAway): el aviso, y la cabecera actualiza su circulito.
  if (notice && (e.action_type === 'away' || e.action_type === 'back') && e.actor_id) { m.presence = { id: e.actor_id, online: e.action_type === 'back' }; return m; }
  if (!notice && e.payload['shown_roll']) {
    const sfx = m.dice === 'mine' ? soundCuesOf(engine, e) : [];
    if (sfx.length) m.sfx = sfx;
    return m;
  }
  // Turno compartido (grupo o ronda): cada participante lo ve como suyo, con su propia acción y la de los demás.
  const group = Array.isArray(e.payload['group']) && (e.payload['group'] as Id[]).includes(d.character_id);
  // Algo que afecta a todos los presentes (audience.ts): la misma narración y las mismas frases, cada una con a quién va.
  if (!group && e.actor_id !== d.character_id && viewOf(e, d.character_id) === 'shared') {
    const novel = notice ? null : novelOf(e, engine, d.character_id, d.text);
    if (novel) { m.prose = novel.prose; m.lines = novel.lines; m.blocks = novel.blocks; m.speech = novel.speech; }
    return m;
  }
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
  const novel = notice ? null : novelOf(e, engine, d.character_id, d.text);
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
  reactionView(m, e, engine.world, d.character_id);
  return m;
}

/** El historial que recibe la página al abrir o reconectar el stream: la tirada aún pendiente lleva la marca para que su botón siga vivo. */
export function historyFor(engine: Engine, characterId: Id, history: readonly WebMessage[]): WebMessage[] {
  const pending = engine.pendingRoll(characterId);
  return history.map((m) => (pending && m.roll && m.seq === pending.seq ? { ...m, roll_pending: true } : m));
}

/**
 * Reacciones (reactions.ts): al afectado, los botones de la petición mientras siga en pie; a quien actúa,
 * su espera con la cuenta atrás; a los dos, la marca de que ya se decidió (cierra lo anterior en vivo).
 */
function reactionView(m: WebMessage, e: GameEvent, w: Engine['world'], reader: Id): void {
  const r = e.payload['reaction'] as { id: Id; to: Id; from: Id; attempt?: string; expires_real_ms?: number } | undefined;
  if (!r) return;
  if (e.action_type !== 'reaction_request') { m.reaction_done = r.id; return; }
  const to = w.characters.get(r.to);
  const from = w.characters.get(r.from);
  if (!to || !from) return;
  const open = (to.reactions ?? []).some((x) => x.id === r.id);
  const expires = r.expires_real_ms ?? 0;
  if (reader === r.to) m.reaction = { id: r.id, from: pcName(w, reader, from), attempt: r.attempt ?? '', expires_ms: expires, open };
  else if (reader === r.from) m.reaction_wait = { id: r.id, name: pcName(w, reader, to), expires_ms: expires, open };
}

const SAY_TYPES = new Set(['say', 'shout', 'whisper']);

/**
 * A quién va una línea, visto por `reader`: «ti», «todos», «Isgral» o «Isgral y a ti» (la web pone «a » delante).
 * Vacío si no lleva `to`.
 */
export function toLabel(w: Engine['world'], reader: Id, to: LineTo | undefined, locationId: Id): string {
  if (!to) return '';
  if (to === 'all') return 'todos';
  const ids = lineTargets(to, presentIds(w, locationId)).filter((id) => w.characters.has(id));
  const names = ids.filter((id) => id !== reader).map((id) => pcName(w, reader, w.character(id)));
  if (ids.includes(reader)) names.push('ti');
  return names.join(' y a ');
}

/** ¿Lo leen varios? Entonces cada frase del NPC dice a quién va; en una charla a solas no hace falta. */
function manyReaders(e: GameEvent): boolean {
  return Array.isArray(e.payload['group']) || (typeof e.payload['audience'] === 'string' && e.payload['audience'] !== 'actor');
}

/**
 * Lo que otro PJ hace o dice, visto por este (party.ts): si lo oye bien, sus
 * palabras llegan literales como parlamento suyo (con su avatar y el nombre que
 * este conoce) en vez del estilo indirecto; si se dirige a este, el menú «Responder»;
 * si le ofrece algo, «Aceptar» y «Rechazar».
 */
function witnessMessage(m: WebMessage, d: Delivery, engine: Engine): WebMessage {
  const e = d.event;
  const w = engine.world;
  const actor = e.actor_id ? w.characters.get(e.actor_id) : undefined;
  if (!actor) return m;
  const reader = d.character_id;
  const shown = pcLabel(w, reader, actor);
  const offer = e.payload['offer'] as { id: Id; to: Id; label: string; answer?: string } | undefined;
  if (e.action_type === 'offer' && offer?.to === reader) {
    const open = (w.characters.get(reader)?.offers ?? []).some((o) => o.id === offer.id && o.expires_real_ms > Date.now());
    m.offer = { id: offer.id, label: offer.label, open };
  }
  reactionView(m, e, w, reader);
  const raw = e.payload['lines'];
  // Lo que cierra el máster y este no comparte (audience.ts): solo el aviso de una línea y, si es una charla, «Unirme».
  if (viewOf(e, reader) === 'notice') {
    const npcLine = Array.isArray(raw) ? (raw as DialogueLine[]).find((l) => l.speaker === 'npc' && l.npc_id && w.npcs.has(l.npc_id)) : undefined;
    const talkNpc = npcLine ? w.npcs.get(npcLine.npc_id!)! : typeof e.payload['npc_id'] === 'string' ? w.npcs.get(e.payload['npc_id'] as Id) : undefined;
    if (talkNpc && talkNpc.status === 'alive' && MASTER_TYPES.has(e.action_type)) {
      const label = w.characters.get(reader)?.knows.includes(talkNpc.id) ? talkNpc.name : descriptorOf(w, talkNpc.id);
      m.join = { npc: talkNpc.id, label: `Unirme a la conversación con ${label}` };
    }
    return m;
  }
  // Un aviso (llega, se va, coge algo, espera su turno…) no lleva parlamentos ni «Responder a…».
  if (m.notice) return m;
  const say = e.payload['say'] as { to: Id | null } | undefined;
  const delivered = e.delivered_to.find((x) => x.character_id === reader);
  const heardWell = SAY_TYPES.has(e.action_type) ? d.level === 'full' : delivered?.sound === 'full';
  const target = e.payload['target_character_id'];
  if ((SAY_TYPES.has(e.action_type) && heardWell) || (MASTER_TYPES.has(e.action_type) && target === reader)) {
    if (!say?.to || say.to === reader || target === reader) m.reply_to = { id: actor.id, name: pcName(w, reader, actor) };
  }
  // En la charla (audience_ids) o aquel a quien se dirige el actor: lee las frases enteras, cada una con a quién va.
  const party = viewOf(e, reader) === 'party';
  if ((!heardWell && !party) || !Array.isArray(raw) || !raw.length) return m;
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
      const to = manyReaders(e) ? toLabel(w, reader, l.to, e.location_id) : '';
      lines.push({ speaker: 'npc', id: npc.id, name: known ? npc.name : npc.role.charAt(0).toUpperCase() + npc.role.slice(1), text: l.text, ...(to ? { to } : {}) });
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
    else if (l.speaker === 'npc' && l.npc_id) {
      const npc = w.npcs.get(l.npc_id);
      if (!npc) continue;
      const known = me?.knows.includes(npc.id) ?? false;
      // A quién va, cuando el turno lo leen varios (turno compartido, charla de grupo o algo para todos).
      const to = manyReaders(e) ? toLabel(w, characterId, l.to, e.location_id) : '';
      lines.push({ speaker: 'npc', id: npc.id, name: known ? npc.name : npc.role.charAt(0).toUpperCase() + npc.role.slice(1), text: l.text, ...(to ? { to } : {}) });
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
function withImages(m: WebMessage, ill: Illustrator | null, slug: string, engine?: Engine): WebMessage {
  if (!ill || (!m.lines && !m.moments && !m.place)) return m;
  const out: WebMessage = { ...m };
  if (m.place) { const img = ill.imageFor(m.place.location_id); if (img) out.place = { ...sceneView(img, slug) }; }
  if (m.lines) out.lines = m.lines.map((l) => { const img = ill.entityImage('portrait', l.id); return img ? { ...l, avatar: imageSrc(img, slug) } : l; });
  if (m.moments) {
    out.moments = m.moments.map((x) => {
      const img = x.kind === 'scene' ? null : ill.entityImage(x.kind, x.entity_id);
      if (!img) return x;
      // La charla con un NPC: el nombre con que habla en el turno (nombre y apellidos, si los tiene) y su oficio.
      const npc = x.kind === 'talk' ? engine?.world.npcs.get(x.entity_id) : undefined;
      if (!npc) return { ...x, name: img.name, src: imageSrc(img, slug) };
      const said = m.lines?.find((l) => l.id === x.entity_id)?.name;
      return { ...x, name: said || npc.name, role: npc.role_short?.replace(/^(el|la|los|las)\s+/i, '') || npc.role, src: imageSrc(img, slug) };
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

/** Lo que hay en dist/wiki: páginas, estilos, buscador e imágenes. */
const WIKI_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
};

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/**
 * El personaje que manda el asistente (page-creation.ts) tal cual: el `as` no promete
 * nada, los valores los comprueba chargen.ts. Sin un campo, el valor por defecto;
 * con uno que no sirve (`race: 7`, `abilities: 'x'`), error en vez de un PJ por defecto.
 */
function characterFromBody(body: Record<string, unknown>, nameKey: string): NonNullable<CreateGameInput['character']> {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const given = (k: string) => (body[k] === undefined || body[k] === null || body[k] === '' ? undefined : body[k]);
  const race = given('race'), klass = given('class'), background = given('background'), abilities = given('abilities'), skills = given('skills'), death = given('death_mode');
  return {
    name: str(nameKey),
    ...(race !== undefined ? { race_id: race as string } : {}),
    ...(klass !== undefined ? { class_id: klass as string } : {}),
    ...(background !== undefined ? { background_id: background as string } : {}),
    ...(abilities !== undefined ? { abilities: abilities as CharacterSpec['abilities'] } : {}),
    ...(skills !== undefined ? { skills: skills as string[] } : {}),
    ...(str('hook') ? { hook: str('hook') } : {}),
    ...(str('appearance') ? { appearance: str('appearance') } : {}),
    ...(death !== undefined ? { death_mode: death as 'casual' | 'hardcore' } : {}),
  };
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
