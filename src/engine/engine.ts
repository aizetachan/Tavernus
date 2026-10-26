/**
 * Motor (SPEC §11, §14.2). No sabe qué cliente lo usa. Expone acciones y
 * comandos; encola por localización; corre el reloj; persiste cada cambio.
 *
 * Fase 1: las acciones se resuelven con un parser de verbos y narración
 * plana desde los datos. En fase 2 el mismo punto de entrada llama al master.
 */

import { GameClock, Ticker, GAME_DAY, GAME_MINUTE } from '../clock/clock.js';
import type { Change, Repository } from '../persistence/repository.js';
import { resolveItem, resolveResourceNode, resolveSpot, type Resolution } from './aliases.js';
import { EventLog, type Delivery, type DeliveryListener } from './events.js';
import { inventoryView, spotOfPlacement, transferItem, type InventoryView, type TransferError } from './inventory.js';
import type { Character, GameEvent, Id, Npc, Offer, Pace, Placement, Reaction, ReactionKind, WorldSnapshot } from './model.js';
import { approachSpot, interruptTransit, moveTo, positionOf, settleTransit, type MoveError } from './movement.js';
import { coinsIn, dropOffer, findPresentPc, HELP_TTL_S, OFFER_TTL_MS, parseGive, parseParty, parseSay, pcName, SAY_LOUDNESS, type SayMode } from './party.js';
import { witnesses } from './perception.js';
import { contest, dropReaction, findReaction, fmtLeft, GRAPPLE_S, parseReaction, pendingFrom, PRONE_S, REACTION_TTL_MS, readsAsAccept } from './reactions.js';
import { GROUP_WINDOW_MS, isLeaveTalk, namedNpc, npcsHere, npcTarget, parseTurn, presentPcs, ROUND_MS, talkersOf, talkingWith, tenseScene } from './scene.js';
import { bounceOff, parseCrossing } from './barrier.js';
import { aEs, arrivalNarration, describeSurroundings, descriptorOf, fmtDuration, whereAmI, whoIsHere } from './narrate.js';
import { encounterChance, parseTrivial, suggestActions, tension, type TrivialIntent } from './fastpath.js';
import { blockedOnRoute, crossingLine, interruptionOnRoute, notePassedRun, type RouteCut } from './goto.js';
import { atBoard, dropQuest, readBoard } from './quests.js';
import { consumeHooks, matchHooks, pendingHooksIn, pruneHooks, type Hook, type HookCue } from './hooks.js';
import { tickSchedule } from './schedule.js';
import { tickStory, type StoryOutput } from './story.js';
import { aheadUntil, clearAheadIfCaught, crossesLocations, encounterSuggestions, encounterTeaser, isWaypoint, journeyOf, nowFor, parseTravel, rollTravelEncounter, SAME_TIME_TOLERANCE_S, setAhead, setJourney, stopAtEncounter, travelNote, type TravelEncounter, type TravelHint, type TravelIntent } from './travel.js';
import { seededRng, type Rng } from './dice.js';
import { harvest } from './resources.js';
import { spawnItem } from './inventory.js';
import { classifyMoments, seenFromEvents, type DialogueLine, type Moment } from './moments.js';
import { characterCheck, type CheckKind } from './rules.js';
import { activeJobs, addPractice, rotateBoard, type ProgressEvent } from './progress.js';
import { resolveAttack } from './combat.js';
import { attackRoll, checkRoll, rollAudience, rollTextForOthers, rollTextForRoller, type ShownRoll } from './rolls.js';
import { abilityModifier } from './dice.js';
import { passivePerception, type Ability } from './rules.js';
import { ABILITIES, backgroundById, classById, raceById, STANDARD_ARRAY } from '../data/srd/index.js';
import type { Advantage, CheckResult } from './dice.js';
import { World } from './world.js';
import { bodiesAt, bodyStateOf, canLoot, damageCharacter, deathRules, isDying, isStable, lootBody, respawn, respawnSpotId, respawnWaitS, rollDeathSave, SAVE_EVERY_CALM_S, SAVE_EVERY_THREAT_S, stabilize, stabilizeIfAway, wakeIfRested, type DeathSave } from './death.js';
import { applyRest, cannotRest, parseRest, planRest, type RestKind, type RestPlan } from './rest.js';
import { hhmm } from './schedule.js';
import { migrateRentableRooms } from '../worldgen/rooms.js';
import { absence, absenceRule, acceptPrologue, acceptRecap, forReader, prologueFacts, prologuePrompt, prologueTemplate, RECAP_TITLE, recapPrompt, recapTemplate } from './prologue.js';

export interface ActionResult {
  ok: boolean;
  /** Texto para el actor. */
  text: string;
  event?: GameEvent;
  suggested_actions?: string[];
  requires_roll?: RequiresRoll;
  /** «hablar con <PJ>» sin frase: la web abre el modo Decir hacia ese PJ (party.ts). */
  say_to?: { id: Id; name: string };
}

export interface RequiresRoll { kind: CheckKind; key: string; dc: number | null; advantage: Advantage; target?: Id }

export interface PendingRoll { text: string; roll: RequiresRoll; event_id: Id }

/** Lo que elige el jugador al crear (SPEC §4.6). Todo se valida en el servidor. */
export interface CharacterSpec {
  race_id: string;
  class_id: string;
  background_id: string;
  /** Array estándar asignado. */
  abilities: Record<Ability, number>;
  /** Skills de clase elegidas. */
  skills: string[];
  death_mode: 'casual' | 'hardcore';
  appearance?: string;
}

/** Contrato mínimo del master para el motor (implementado en src/ai/master.ts). */
export interface MasterLike {
  resolve(actor: Character, text: string, roll?: { original_text: string; result: CheckResult & { label: string } }, intro?: { origin: string; welcome: string; prologue?: string }, scene?: MasterScene, decisive?: { seconds: number; speed: 'fast' | 'normal'; threat: string }): Promise<MasterResolution>;
  /** Texto libre en una llamada corta y sin tools (prólogo, recapitulación). null si no hay texto (offline). */
  write?(req: { system: string; prompt: string; max_tokens?: number }): Promise<{ text: string; model: string; usage: { input: number; output: number } } | null>;
}
/** `hook`: salta un gancho sembrado (hooks.ts) sin acción del jugador. */
export type MasterScene = 'arrival' | 'decisive_timeout' | 'hook';

/**
 * Lo que el motor quiere que el master tenga delante en esta llamada, además de
 * la acción: ganchos que saltan ahora o que ha salido la tirada de imprevisto.
 * El master lo lee con `engine.sceneHints(actor.id)` al montar el contexto.
 */
export interface SceneHints {
  hooks: Hook[];
  encounter: { chance: number; roll: number } | null;
  /** Viaje rápido (travel.ts): encuentro en el camino o tiempo que ha costado la llegada. */
  travel?: TravelHint;
  /** Conversación de grupo (scene.ts): lo que ha dicho cada PJ a ese NPC en la ventana. */
  group?: { npc_id: Id; members: { id: Id; name: string; text: string }[] };
  /** Ronda en escena tensa (scene.ts): la acción de cada PJ y quién duda. */
  round?: { n: number; members: { id: Id; name: string; text: string }[]; hesitant: { id: Id; name: string }[] };
  /** Descanso interrumpido (rest.ts): qué le despierta. */
  rest?: { kind: RestKind; what: string; teaser: string };
}

/** Banner de ronda para la web: quién ha actuado, a quién se espera y hasta cuándo. */
export interface SceneNotice { kind: 'round'; location_id: Id; n: number; acted: Id[]; waiting: Id[]; deadline_ms: number; open: boolean }
export type SceneListener = (n: SceneNotice) => void;
interface Batch { items: { id: Id; text: string }[]; members: Id[]; done: Promise<ActionResult>; resolve: (r: ActionResult) => void; timer: NodeJS.Timeout }
interface Round { n: number; items: Map<Id, string>; done: Promise<ActionResult>; resolve: (r: ActionResult) => void; deadline_ms: number; timer: NodeJS.Timeout }

export type MasterResolution =
  | { ok: true; closed: { narration_private: string; observable: string | null; observable_vague: string | null; loudness: number; tags: string[]; suggested_actions: string[]; requires_roll: RequiresRoll | null; decisive?: { threat: string; npc_id: string | null } | null; npc_id?: string | null; lines?: DialogueLine[]; target_character_id?: string | null; observable_target?: string | null }; usage: unknown; calls: { name: string; input: unknown; result: string }[]; context: string; model: string; progress?: ProgressEvent[]; shown_rolls?: ShownRoll[]; tool_errors?: { name: string; input: unknown; error: string }[]; approach?: { from_spot_id: Id; to_spot_id: Id; distance_m: number; duration_s: number } }
  | { ok: false; reason: string; message: string; usage?: unknown; calls?: unknown };

/** Un PJ pisa una localización por primera vez (para ilustrarla, src/ai/illustrate.ts). */
export interface FirstVisit { character_id: Id; location_id: Id; game_s: number }
export type FirstVisitListener = (v: FirstVisit) => void;

/** Momento ilustrable recién registrado (moments.ts), con el evento que lo trajo. */
export interface MomentNotice { moment: Moment; event: GameEvent }
export type MomentListener = (m: MomentNotice) => void;

export interface EngineOptions {
  repo: Repository;
  /** Reloj real inyectable para tests. */
  now?: () => number;
  /** Azar de la tirada de imprevisto; inyectable para tests. */
  rng?: Rng;
  /**
   * Acciones triviales y llegadas sin IA cuando la escena está tranquila
   * (por defecto sí). Con false, todo pasa por el master como antes.
   */
  deterministic?: boolean;
  /**
   * Viaje rápido entre localizaciones (travel.ts; por defecto sí): el PJ llega
   * en el acto y su reloj queda adelantado a la hora de llegada. Con false,
   * el viaje se espera en tiempo real como antes.
   */
  fastTravel?: boolean;
  /** Ventana para juntar frases de una conversación de grupo (ms; GROUP_WINDOW_S, 8 s por defecto). */
  groupWindowMs?: number;
  /** Tiempo de una ronda en escena tensa (ms; ROUND_SECONDS, 60 s por defecto). */
  roundMs?: number;
}

export class Engine {
  readonly world: World;
  readonly clock: GameClock;
  readonly events: EventLog;
  private readonly repo: Repository;
  private readonly now: () => number;
  private pending = new Map<string, Change>();
  private queues = new Map<Id, Promise<unknown>>();
  /** Acciones de jugadores que esperan en la cola de su localización (el máster las ve como «a la vez»). */
  private waiting = new Map<Id, { location_id: Id; text: string; since_ms: number }>();
  private tickers: Ticker[] = [];
  private tickerTask: Promise<void> | null = null;
  private master: MasterLike | null = null;
  private pendingRolls = new Map<Id, PendingRoll>();
  private readonly rng: Rng;
  readonly deterministic: boolean;
  readonly fastTravel: boolean;
  readonly groupWindowMs: number;
  readonly roundMs: number;
  private hints = new Map<Id, SceneHints>();
  /** Localización desde la que salió cada viaje iniciado por el motor (para saber si la llegada cruza a otra). */
  private tripFrom = new Map<Id, Id>();
  private firstVisitListeners: FirstVisitListener[] = [];
  private momentListeners: MomentListener[] = [];
  /** Claves de momentos ya dados (moments.ts): se recuperan de los eventos pasados al arrancar. */
  private readonly seenMoments = new Set<string>();
  /** Verbos mecánicos que no pasan por el master aunque esté configurado. */
  private static readonly MECHANICAL = /^(inventario|inventory|qui[eé]n|who|d[oó]nde|where|dormir|duermo|me duermo|descansar|descanso|sleep|despierto|despertar|me despierto|wake|parar|me paro|me detengo|stop)\b/i;

  attachMaster(m: MasterLike | null): void { this.master = m; }

  /** Salud del proceso para /estado (tiempo real, no de juego). */
  readonly startedMs = Date.now();
  private masterOk: { ts: number; ms: number }[] = [];
  private masterErr: { ts: number; reason: string; message: string }[] = [];

  health(): { started_ms: number; ok_1h: number; err_1h: number; avg_ms_1h: number | null; last_error: { ts: number; reason: string; message: string } | null } {
    const since = Date.now() - 3600_000;
    const ok = this.masterOk.filter((x) => x.ts >= since);
    const err = this.masterErr.filter((x) => x.ts >= since);
    return {
      started_ms: this.startedMs, ok_1h: ok.length, err_1h: err.length,
      avg_ms_1h: ok.length ? Math.round(ok.reduce((a, x) => a + x.ms, 0) / ok.length) : null,
      last_error: this.masterErr.at(-1) ?? null,
    };
  }
  get hasMaster(): boolean { return this.master !== null; }
  pendingRoll(characterId: Id): PendingRoll | null { return this.pendingRolls.get(characterId) ?? null; }

  private constructor(snapshot: WorldSnapshot, opts: EngineOptions, lastSeq: number) {
    this.repo = opts.repo;
    this.now = opts.now ?? (() => Date.now());
    // TAVERNUS_SEED fija el azar del motor (imprevistos, encuentros) para reproducir una partida.
    const seed = Number(process.env['TAVERNUS_SEED']);
    this.rng = opts.rng ?? (process.env['TAVERNUS_SEED'] && Number.isFinite(seed) ? seededRng(seed) : Math.random);
    this.deterministic = opts.deterministic ?? true;
    this.fastTravel = opts.fastTravel ?? true;
    const env = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v * 1000 : d; };
    this.groupWindowMs = opts.groupWindowMs ?? env('GROUP_WINDOW_S', GROUP_WINDOW_MS);
    this.roundMs = opts.roundMs ?? env('ROUND_SECONDS', ROUND_MS);
    this.realClock = !opts.now;
    this.world = new World(snapshot);
    this.clock = GameClock.fromCampaign(this.world.campaign);
    this.events = new EventLog(this.world, this.clock, lastSeq);
    this.world.onChange((c) => this.pending.set(`${c.collection}/${c.id}`, c));
    // Antes de persistir y entregar: el evento sale ya con sus momentos en el payload.
    this.events.onEvent((e) => this.noteMoments(e));
    // Sin esperar; si falla (la partida se borró mientras narraba), se avisa y no tumba el proceso.
    this.events.onEvent((e) => { this.repo.appendEvent(e).catch((err: Error) => console.warn(`[engine] evento ${e.id} sin guardar: ${err.message}`)); });
  }

  /** Momentos ilustrables de un evento: se anotan en `payload.moments` y se avisa a los oyentes (ilustrador). */
  private noteMoments(e: GameEvent): void {
    let moments: Moment[];
    try {
      moments = classifyMoments(e, this.seenMoments, { itemOfInstance: (id) => this.world.itemInstances.get(id)?.item_id ?? null });
    } catch (err) { console.error('[engine] momentos:', err); return; }
    if (!moments.length) return;
    e.payload['moments'] = moments;
    for (const m of moments) this.seenMoments.add(m.key);
    for (const moment of moments) {
      for (const l of this.momentListeners) {
        try { l({ moment, event: e }); } catch (err) { console.error('[engine] momento:', err); }
      }
    }
  }

  /** Momento ilustrable nuevo (primer encuentro, objeto, descubrimiento, desenlace). Sin red: solo avisa. */
  onMoment(l: MomentListener): () => void {
    this.momentListeners.push(l);
    return () => { this.momentListeners = this.momentListeners.filter((x) => x !== l); };
  }

  /** Al arrancar: lo ya dado en eventos pasados y los sitios ya visitados no vuelven a ser momento. */
  private seedMoments(past: readonly GameEvent[]): void {
    for (const k of seenFromEvents(past)) this.seenMoments.add(k);
    for (const loc of this.world.locations.values()) {
      for (const [cid, d] of Object.entries(loc.discovery)) if (d === 'visited') this.seenMoments.add(`scene:${cid}:${loc.id}`);
    }
  }

  /** Arranca desde la persistencia, o desde `seed` si no hay nada guardado. */
  static async boot(opts: EngineOptions & { campaignId: Id; seed?: WorldSnapshot }): Promise<Engine> {
    let snapshot = await opts.repo.loadSnapshot(opts.campaignId);
    if (!snapshot) {
      if (!opts.seed) throw new Error(`no snapshot for campaign ${opts.campaignId} and no seed`);
      snapshot = opts.seed;
      await opts.repo.saveSnapshot(snapshot);
    }
    const migrated = migrate(snapshot, opts.seed);
    const past = await opts.repo.loadEvents(opts.campaignId, 0);
    const lastSeq = past.reduce((m, e) => Math.max(m, e.seq), 0);
    const engine = new Engine(snapshot, opts, lastSeq);
    // Partidas de antes de la regla: los PJ se conocen por su nombre desde que coinciden en la partida.
    engine.meetAll();
    engine.events.restore(past);
    engine.seedMoments(past);
    await engine.installTickers();
    if (migrated) {
      engine.world.touch('campaign', snapshot.campaign.id);
      for (const c of engine.world.characters.values()) engine.world.touch('characters', c.id);
      // La migración también puede tocar puntos, NPCs y el catálogo (cuartos de alquiler).
      for (const n of engine.world.npcs.values()) engine.world.touch('npcs', n.id);
      for (const sp of engine.world.spots.values()) engine.world.touch('spots', sp.id);
      for (const d of engine.world.itemDefs.values()) engine.world.touch('item_defs', d.id);
      await engine.flush();
    }
    return engine;
  }

  gameNow(): number { return this.clock.gameNow(this.now()); }

  onDelivery(l: DeliveryListener): () => void { return this.events.onDelivery(l); }

  /** Primera llegada de un PJ a una localización (al crear el personaje o al viajar). Sin red: solo avisa. */
  onFirstVisit(l: FirstVisitListener): () => void {
    this.firstVisitListeners.push(l);
    return () => { this.firstVisitListeners = this.firstVisitListeners.filter((x) => x !== l); };
  }

  private firstVisit(v: FirstVisit): void {
    for (const l of this.firstVisitListeners) {
      try { l(v); } catch (e) { console.error('[engine] primera visita:', e); }
    }
  }

  // -------------------------------------------------------------------------
  // Reloj y tickers
  // -------------------------------------------------------------------------

  private async installTickers(): Promise<void> {
    const cid = this.world.campaign.id;
    const nowG = this.gameNow();
    const minute = (await this.repo.loadTicker(cid, 'minute')) ?? { last_tick_game_s: Math.floor(nowG / GAME_MINUTE) * GAME_MINUTE };
    this.tickers.push(new Ticker('minute', GAME_MINUTE, minute, (t) => this.onMinute(t)));
    const day = (await this.repo.loadTicker(cid, 'day')) ?? { last_tick_game_s: Math.floor(nowG / GAME_DAY) * GAME_DAY };
    this.tickers.push(new Ticker('day', GAME_DAY, day, (t) => this.onDay(t)));
    if (this.world.campaign.board.active_job_ids.length === 0) this.onDay(nowG);
  }

  /** Un día de juego: rota el tablón y lo anuncia en público. */
  private onDay(tickGameS: number): void {
    const jobs = rotateBoard(this.world, tickGameS, this.world.campaign.board.active_job_ids.length === 0);
    if (!jobs) return;
    const anchor = this.world.spot(this.world.campaign.starting_points[0]!.spot_id);
    this.events.emit({
      actor_id: null, at: { spot_id: anchor.id, next_spot_id: null, progress: 0, x: anchor.x, y: anchor.y, location_id: anchor.location_id },
      action_type: 'board', narration_private: '', visibility: 'public', tags: ['board'], payload: { job_ids: jobs.map((j) => j.id) },
      observable: `📜 Tablón de Brezal, ${this.clock.format(tickGameS)}:\n` + jobs.map((j) => `• **${j.title}** — ${j.text} (${j.reward_coins} monedas; lo pide ${this.world.npc(j.giver_npc_id).name})`).join('\n'),
    }, this.clock.realAt(tickGameS));
  }

  /** Un minuto de juego. Aquí engancharán consumo, regeneración y líneas secundarias. */
  private onMinute(tickGameS: number): void {
    this.settleAll(tickGameS);
    for (const n of this.world.npcs.values()) {
      let changed = false;
      // Olvido natural: importancia 1 a los 3 días de juego; 2 a los 30; 3 nunca.
      const kept = n.memory.filter((m) => m.importance === 3 || tickGameS - m.game_s < (m.importance === 1 ? 3 : 30) * GAME_DAY);
      if (kept.length !== n.memory.length) { n.memory = kept; changed = true; }
      // La conversación termina si el PJ se aleja o pasan 10 min de juego sin hablar.
      if (n.talking_to) {
        const c = this.world.characters.get(n.talking_to.character_id);
        const here = c ? this.world.characterSpot(c)?.id : null;
        if (!c || here !== n.location.id || c.status !== 'active' || tickGameS - n.talking_to.since_game_s > 10 * GAME_MINUTE) { n.talking_to = null; changed = true; }
      }
      if (changed) this.world.touch('npcs', n.id);
    }
    for (const c of this.world.characters.values()) {
      const before = c.conditions.length;
      c.conditions = c.conditions.filter((x) => x.expires_game_s === null || x.expires_game_s > tickGameS);
      if (c.conditions.length !== before) this.world.touch('characters', c.id);
    }
  }

  /** Ahora de un PJ: el del mundo, o su hora de llegada si ha viajado por delante del reloj (travel.ts). */
  nowFor(c: Character | Id): number {
    return nowFor(typeof c === 'string' ? this.world.character(c) : c, this.gameNow());
  }

  /** Instante real con el que se sellan los eventos de un PJ: el de su hora (adelantada si ha viajado). */
  private stampFor(c: Character): number {
    return Math.max(this.now(), this.clock.realAt(this.nowFor(c)));
  }

  /** Sello real del último evento de un PJ: una llegada nunca va antes que la acción que la provocó. */
  private lastStamp(c: Character): number {
    const all = this.events.all();
    for (let i = all.length - 1; i >= 0 && i >= all.length - 50; i--) if (all[i]!.actor_id === c.id) return all[i]!.timestamp_real_ms;
    return 0;
  }

  /**
   * Consolida viajes de todos los PJs y emite llegadas. Con viaje rápido, un
   * tránsito que cruza de localización (o cualquiera, si el PJ ya va por
   * delante del reloj) se completa en el acto: se tira el encuentro, el PJ
   * queda en el destino o en el punto de camino, y su reloj, en esa hora.
   */
  private settleAll(nowGameS: number): void {
    this.syncFollowers(nowGameS);
    // Los líderes antes que quien les sigue: un encuentro en el camino para a los dos.
    const met = new Map<Id, { enc: TravelEncounter; destination: Id }>();
    const order = [...this.world.characters.values()].sort((a, b) => Number(Boolean(a.following)) - Number(Boolean(b.following)));
    for (const c of order) {
      if (clearAheadIfCaught(c, nowGameS)) this.world.touch('characters', c.id);
      if (!c.transit) continue;
      const startLoc = this.world.characterSpot(c)?.location_id;
      let settleAt = nowFor(c, nowGameS);
      let encounter: TravelEncounter | null = null;
      const departed = journeyOf(c)?.started_game_s ?? c.transit.departed_game_s;
      const pace = c.transit.pace;
      const lead = c.following ? met.get(c.following) : undefined;
      const behind = lead && lead.destination === c.transit.destination_spot_id && c.transit.legs.some((l) => l.via_exit_id === lead.enc.exit_id) ? lead.enc : null;
      if (this.fastTravel && (crossesLocations(c.transit) || (aheadUntil(c) ?? -Infinity) > nowGameS)) {
        if (behind) encounter = behind;
        else if (crossesLocations(c.transit)) encounter = rollTravelEncounter(this.world, this.clock, c.transit, this.rng);
        if (encounter && !behind) met.set(c.id, { enc: encounter, destination: c.transit.destination_spot_id });
        if (encounter) stopAtEncounter(this.world, c, encounter);
        settleAt = c.transit.arrives_game_s;
        setAhead(c, settleAt, nowGameS);
      }
      const r = settleTransit(this.world, c, settleAt);
      // Todo el trayecto de una vez (viaje rápido): los puntos de paso del sitio de salida y del de llegada no se cuentan (goto.ts).
      const endLoc = r.arrived && r.reached.length > 1 && this.fastTravel ? this.world.spot(r.reached.at(-1)!.spot_id).location_id : null;
      const passedLocs = new Set<Id>();
      for (const reached of r.reached) {
        const spot = this.world.spot(reached.spot_id);
        const loc = this.world.location(spot.location_id);
        const last = r.arrived && reached === r.reached[r.reached.length - 1];
        if (!last && endLoc && (loc.id === startLoc || loc.id === endLoc || passedLocs.has(loc.id))) continue;
        if (!last && endLoc) passedLocs.add(loc.id); // un sitio de paso, una sola línea con su nombre
        const firstVisit = loc.discovery[c.id] !== 'visited';
        if (firstVisit) { loc.discovery[c.id] = 'visited'; this.world.touch('locations', loc.id); }
        if (last && encounter) { this.tripFrom.delete(c.id); this.stopOnTheRoad(c, encounter, departed, pace, behind ? c.following ?? null : null); continue; }
        if (last && !isWaypoint(spot)) setJourney(c, null);
        // Con master, la llegada al destino la narra él (escena de llegada) salvo que sea trivial: entonces, plantilla.
        // El aviso plano queda para los tramos intermedios y para quien no está mirando.
        const live = last && this.master !== null && c.status === 'active' && c.connected;
        const crossed = (this.tripFrom.get(c.id) ?? startLoc) !== spot.location_id;
        const plan = live ? this.arrivalPlan(c, spot.id, firstVisit, crossed) : null;
        if (last) this.tripFrom.delete(c.id);
        const template = plan?.kind === 'template';
        // Tiempo que ha costado el viaje: lo lee el jugador («has tardado 2 h; anochece») y, si narra él, el master.
        const note = last && crossed ? travelNote(this.clock, departed, reached.at_game_s) : '';
        const travel: TravelHint | null = note ? { kind: 'arrival', departed_game_s: departed, arrived_game_s: reached.at_game_s } : null;
        this.events.emit({
          actor_id: c.id,
          at: { spot_id: spot.id, next_spot_id: null, progress: 0, x: spot.x, y: spot.y, location_id: spot.location_id },
          action_type: last ? 'arrived' : 'passed',
          narration_private: template ? [note, crossed ? crossingLine(this.world, r.reached.filter((x) => x.via_exit_id).at(-1)?.via_exit_id, spot.id) : '', arrivalNarration(this.world, this.clock, c, reached.at_game_s, crossed)].filter(Boolean).join('\n')
            : plan ? note : last ? [note, `Llegas ${aEs(spot.name)}.`].filter(Boolean).join(' ') : `Pasas por ${endLoc ? loc.name : spot.name}.`,
          observable: last ? `${c.name} llega ${aEs(spot.name)}.` : `${c.name} pasa por ${spot.name}.`,
          tags: template ? ['movement', 'deterministic'] : ['movement'],
          payload: {
            observable_vague: last ? `Una figura llega ${aEs(spot.name)}.` : `Una figura pasa por ${spot.name}.`,
            ...(template ? { master: null, suggested_actions: suggestActions(this.world, this.clock, c, reached.at_game_s) } : {}),
            ...(travel ? { travel: { departed_game_s: departed, arrived_game_s: reached.at_game_s } } : {}),
          },
        }, Math.max(this.clock.realAt(reached.at_game_s), this.lastStamp(c)));
        if (firstVisit && !isWaypoint(spot)) this.firstVisit({ character_id: c.id, location_id: loc.id, game_s: reached.at_game_s });
        if (plan?.kind === 'master') this.narrateArrival(c, travel ? { hooks: [], encounter: null, ...plan.hints, travel } : plan.hints);
      }
    }
  }

  /**
   * Encuentro en el camino: el PJ queda en el punto de camino con el viaje a
   * medias. Lo primero que lee sale de la tabla (sin IA); la escena la narra
   * el master con el encuentro delante. Sin master, «Continuar el viaje».
   */
  private stopOnTheRoad(c: Character, enc: TravelEncounter, departed: number, pace: Pace, leaderId: Id | null = null): void {
    const prev = journeyOf(c);
    setJourney(c, {
      destination_spot_id: enc.destination_spot_id, origin_spot_id: prev?.origin_spot_id ?? enc.origin_spot_id,
      pace, started_game_s: departed, waypoint_spot_id: enc.waypoint_spot_id, encounter_id: enc.entry.id,
    });
    this.world.touch('characters', c.id);
    // Quien sigue a otro se para con él; la escena la narra el máster para el líder.
    const leader = leaderId ? this.world.characters.get(leaderId) : null;
    if (leader) {
      const who = pcName(this.world, c.id, leader);
      this.events.emit({
        actor_id: c.id, action_type: 'travel_encounter', narration_private: `${who.charAt(0).toUpperCase()}${who.slice(1)} se detiene en el camino y tú con él.`,
        observable: null, tags: ['movement', 'travel', 'party'], payload: { master: null, suggested_actions: ['Continuar el viaje'] },
      }, this.clock.realAt(enc.at_game_s));
      return;
    }
    const live = this.master !== null && c.status === 'active' && c.connected;
    const suggested = encounterSuggestions(this.world, enc);
    this.events.emit({
      actor_id: c.id, action_type: 'travel_encounter',
      narration_private: live ? encounterTeaser(this.world, enc) : `${encounterTeaser(this.world, enc)}\nCuando quieras: «Continuar el viaje».`,
      observable: `${c.name} se detiene en el camino.`, tags: ['movement', 'travel', 'encounter'],
      payload: {
        observable_vague: 'Una figura se detiene en el camino.',
        travel_encounter: { id: enc.entry.id, chance: enc.chance, roll: enc.roll, remaining_m: enc.remaining_m, remaining_s: enc.remaining_s, destination_spot_id: enc.destination_spot_id },
        ...(live ? {} : { master: null, suggested_actions: suggested }),
      },
    }, this.clock.realAt(enc.at_game_s));
    if (live) this.narrateArrival(c, { hooks: [], encounter: null, travel: { kind: 'encounter', encounter: enc } });
  }

  /**
   * ¿Quién narra esta llegada? El master si se pide en la configuración
   * (`master.narrate_arrivals: true`), si es la primera visita a la localización,
   * si salta un gancho, si la escena está tensa o si al cruzar a otra
   * localización sale la tirada de imprevisto. Si no, plantilla y coste cero.
   */
  private arrivalPlan(c: Character, spotId: Id, firstVisit: boolean, crossed: boolean): { kind: 'template' } | { kind: 'master'; hints: SceneHints | null } {
    const cfg = this.world.campaign.master as { narrate_arrivals?: boolean };
    if (!this.deterministic || cfg.narrate_arrivals === true || firstVisit) return { kind: 'master', hints: null };
    const locId = this.world.spot(spotId).location_id;
    const hooks = [
      ...matchHooks(this.world, { kind: 'spot', spot_id: spotId, character_id: c.id }),
      ...(crossed ? matchHooks(this.world, { kind: 'location', location_id: locId, character_id: c.id }) : []),
    ];
    if (hooks.length) return { kind: 'master', hints: { hooks, encounter: null } };
    if (tension(this.world, c, [locId], this.recentTags([locId]))) return { kind: 'master', hints: null };
    if (crossed) {
      const chance = encounterChance(this.world, this.world.location(locId));
      const roll = this.rng();
      if (roll < chance) return { kind: 'master', hints: { hooks: [], encounter: { chance, roll } } };
    }
    return { kind: 'template' };
  }

  /** Etiquetas de los eventos de los últimos 10 min de juego en esas localizaciones. */
  private recentTags(locationIds: Id[]): string[] {
    const nowG = this.gameNow();
    return locationIds.flatMap((l) => this.events.recentInLocation(l, 12).filter((e) => nowG - e.timestamp_game_s < 600).flatMap((e) => e.tags));
  }

  /** Ganchos e imprevisto que acompañan la llamada en curso del master para este PJ. */
  sceneHints(characterId: Id): SceneHints | null { return this.hints.get(characterId) ?? null; }

  /** Acciones que otros jugadores han mandado en esta localización y esperan en la cola, por orden de llegada. */
  waitingIn(locationId: Id): { character_id: Id; text: string }[] {
    return [...this.waiting].filter(([, w]) => w.location_id === locationId).sort((a, b) => a[1].since_ms - b[1].since_ms)
      .map(([character_id, w]) => ({ character_id, text: w.text }));
  }

  /** Ganchos pendientes en una localización (para el contexto del master). */
  hooksIn(locationId: Id): Hook[] { return pendingHooksIn(this.world, locationId); }

  /** Llama al master con pistas de escena; los ganchos se consumen solo si el master respondió. */
  private async resolveWithHints(c: Character, text: string, hints: SceneHints | null, scene?: MasterScene): Promise<ActionResult> {
    if (hints) this.hints.set(c.id, hints);
    try {
      const r = await this.resolveWithMaster(c, text, undefined, undefined, scene);
      if (r.ok && hints) consumeHooks(this.world, hints.hooks.map((h) => h.id));
      return r;
    } finally {
      this.hints.delete(c.id);
    }
  }

  /** Escena de llegada: el master sitúa al PJ en el destino con lo que hay alrededor y qué puede hacer. */
  private narrateArrival(c: Character, hints: SceneHints | null = null): void {
    const locId = this.world.characterSpot(c)!.location_id;
    void this.runInLocation(locId, async () => {
      const r = await this.resolveWithHints(c, '(llegada)', hints, 'arrival');
      if (!r.ok) {
        const spot = this.world.characterSpot(c)!;
        this.events.emit({ actor_id: c.id, action_type: 'arrived', narration_private: `Llegas ${aEs(spot.name)}.\n${describeSurroundings(this.world, this.clock, c, this.nowFor(c))}`, observable: null, tags: ['movement'] }, this.stampFor(c));
      }
      await this.flush();
    }).catch((e) => console.error('[engine] llegada:', e));
  }

  /** Llamar periódicamente (cron real cada minuto) y antes de cada acción. */
  async tick(): Promise<void> {
    if (this.tickerTask) return this.tickerTask;
    this.tickerTask = (async () => {
      const nowG = this.gameNow();
      for (const t of this.tickers) {
        if (t.run(nowG) > 0) await this.repo.saveTicker(this.world.campaign.id, t.name, t.snapshot());
      }
      this.settleAll(nowG);
      this.tickDeath(nowG);
      // Agenda (schedule.ts): eventos a su hora y horarios de NPC, sin IA.
      tickSchedule(this.world, nowG, (i, s) => { this.events.emit(i, this.clock.realAt(s)); });
      this.advanceStory(nowG);
      for (const id of this.presence.keys()) this.refreshConnection(id);
      this.expireOffers();
      this.expireReactions();
      this.serveQueues();
      this.checkDecisiveWindows();
      this.fireTimeHooks(nowG);
      pruneHooks(this.world, nowG);
      await this.flush();
    })();
    try { await this.tickerTask; } finally { this.tickerTask = null; }
  }

  /**
   * Ganchos de hora vencida: saltan con un PJ despierto y conectado en su
   * localización (el destinatario si lo hay). Sin nadie que lo vea, esperan
   * hasta que caducan.
   */
  private fireTimeHooks(nowG: number): void {
    if (!this.master) return;
    const due = matchHooks(this.world, { kind: 'time', now_game_s: nowG });
    const byLoc = new Map<Id, Hook[]>();
    for (const h of due) byLoc.set(h.location_id, [...(byLoc.get(h.location_id) ?? []), h]);
    for (const [locId, hooks] of byLoc) {
      const here = this.world.charactersInLocation(locId).filter((c) => c.status === 'active' && c.connected && !c.transit);
      const fire: { c: Character; hooks: Hook[] }[] = [];
      for (const h of hooks) {
        const c = h.for_character_id ? here.find((x) => x.id === h.for_character_id) : here[0];
        if (!c) continue;
        const slot = fire.find((f) => f.c.id === c.id);
        if (slot) slot.hooks.push(h); else fire.push({ c, hooks: [h] });
      }
      for (const { c, hooks: hs } of fire) {
        consumeHooks(this.world, hs.map((h) => h.id)); // saltan una vez, aunque el master falle
        void this.runInLocation(locId, async () => {
          await this.resolveWithHints(c, `(sucede: ${hs.map((h) => h.what).join(' / ')})`, { hooks: hs, encounter: null }, 'hook');
          await this.flush();
        }).catch((e) => console.error('[engine] gancho:', e));
      }
    }
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) { await (this.repo as { settled?: () => Promise<void> }).settled?.(); return; }
    const changes = [...this.pending.values()];
    this.pending.clear();
    await this.repo.write(this.world.campaign.id, changes);
    if (this.repo.flush) await this.repo.flush(this.world.snapshot());
  }

  // -------------------------------------------------------------------------
  // Cola por localización (SPEC §9): una acción a la vez por localización.
  // -------------------------------------------------------------------------

  /** Escrituras lanzadas sin esperar (avisos de presencia): cerrar la partida espera a que acaben. */
  private floating = new Set<Promise<unknown>>();
  private background(p: Promise<unknown>): void {
    const q = p.catch((e: Error) => console.warn(`[engine] ${e.message}`)).finally(() => this.floating.delete(q));
    this.floating.add(q);
  }

  /** Espera a que se vacíen las colas de todas las localizaciones (al cerrar la partida). Como mucho `maxMs`. */
  async settle(maxMs = 5000): Promise<void> {
    const until = Date.now() + maxMs;
    // Varias vueltas: lo que esperaba al tick (una presentación, una acción) entra en la cola después.
    for (let i = 0; i < 4 && Date.now() < until; i++) {
      const all = Promise.all([...this.queues.values(), this.tickerTask, ...this.floating]).then(() => undefined);
      await Promise.race([all, new Promise<void>((r) => setTimeout(r, Math.max(1, until - Date.now())))]);
      await new Promise((r) => setImmediate(r));
    }
  }

  private runInLocation<T>(locationId: Id, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(locationId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(locationId, next.catch(() => undefined));
    return next;
  }

  /** Punto de entrada de cualquier cliente: texto libre de un jugador. */
  async act(characterId: Id, text: string): Promise<ActionResult> {
    // Una frase dicha («— hola», «"hola"») no espera a la cola ni al máster.
    const said = parseSay(text);
    if (said) return this.say(characterId, text);
    await this.tick();
    const c = this.world.character(characterId);
    this.lastAction.set(c.id, this.now());
    if (!c.connected) this.setConnected(c.id, true);
    // A 0 PG o muerto no se actúa: se le dice cómo está y qué le espera.
    if (c.status === 'unconscious' || c.status === 'dead') return { ok: false, text: this.downText(c) };
    const locId = positionOf(this.world, c, this.gameNow()).location_id;
    // Quien espera a que otro jugador decida (reactions.ts) no hace otra cosa hasta saberlo (hablar, sí).
    const waiting = this.reactionWait(c);
    if (waiting) return { ok: false, text: waiting };
    // Varios a la vez (scene.ts): ronda, conversación de grupo o NPC ocupado. Lo de entre jugadores sigue sin máster.
    const t0 = text.trim();
    const give = parseGive(t0);
    const party = parseParty(t0);
    const betweenPcs = (c.status === 'active' && parseReaction(this.world, c, t0)) || (give && findPresentPc(this.world, c, give.to)) || (party && (party.kind === 'unfollow' || findPresentPc(this.world, c, party.who)));
    const scene = betweenPcs || parseRest(t0) || this.isDeathAction(c, t0) ? null : this.sceneRoute(c, t0);
    if (scene) return scene;
    // Mientras espera turno en la cola del sitio, quien va delante lo ve en su contexto (no lo resuelve: va después).
    this.waiting.set(c.id, { location_id: locId, text: t0, since_ms: this.now() });
    return this.runInLocation(locId, async () => {
      this.waiting.delete(c.id);
      const clean = text.trim();
      // Llegó «del futuro» a donde otro PJ vive una hora anterior: espera a que el reloj lo alcance (irse sí puede).
      const travel = parseTravel(clean);
      const wait = this.aheadWait(c);
      if (wait && !travel && !this.isLeaving(c, clean)) return { ok: false, text: wait };
      this.pendingRolls.delete(c.id); // una acción nueva anula la tirada pendiente
      let r: ActionResult;
      let decisive: { seconds: number; speed: 'fast' | 'normal'; threat: string } | undefined;
      if (c.decisive) {
        const seconds = Math.round((this.now() - c.decisive.opened_real_ms) / 1000);
        decisive = { seconds, speed: seconds < Engine.DECISIVE_FAST_S ? 'fast' : 'normal', threat: c.decisive.threat };
        this.closeDecisive(c);
      }
      // Quien sigue a otro y se mueve por su cuenta deja de seguirle.
      if (c.following && (travel || this.isMove(c, clean))) { c.following = null; this.world.touch('characters', c.id); }
      const fast = decisive ? null : this.tryReaction(c, clean) ?? this.tryParty(c, clean) ?? (travel ? this.tryTravel(c, clean, travel) : null) ?? this.tryBarrier(c, clean) ?? this.tryDeathAction(c, clean) ?? await this.tryRest(c, clean) ?? await this.tryTrivial(c, clean);
      if (fast) {
        r = fast;
      } else if (this.master && c.status === 'active' && !Engine.MECHANICAL.test(clean)) {
        r = await this.resolveWithMaster(c, clean, undefined, undefined, undefined, decisive);
        if (!r.ok && r.text === '') {
          r = this.resolveAction(c, clean); // fallo del master: parser plano
          if (!r.ok) r = { ok: false, text: 'El narrador no responde ahora mismo. Espera un momento y vuelve a intentarlo.' };
        }
      } else {
        r = this.resolveAction(c, clean);
      }
      this.settleAll(this.gameNow()); // viaje rápido: si la acción (o un tool del master) lo puso en camino, llega ya
      this.advanceStory(this.gameNow());
      this.announceDeathStates();
      await this.flush();
      return r;
    });
  }

  /**
   * Aviso si el PJ va por delante del reloj del mundo (llegó viajando) y en su
   * localización hay otro PJ activo y conectado que vive una hora anterior. Si
   * no, null. Dos PJs juntos ven siempre la misma hora: espera el adelantado.
   */
  private aheadWait(c: Character): string | null {
    const g = this.gameNow();
    const mine = nowFor(c, g);
    if (mine - g <= SAME_TIME_TOLERANCE_S) return null;
    const locId = this.world.characterSpot(c)?.location_id;
    if (!locId) return null;
    const behind = this.world.charactersInLocation(locId)
      .filter((o) => o.id !== c.id && o.status === 'active' && o.connected && mine - nowFor(o, g) > SAME_TIME_TOLERANCE_S);
    if (!behind.length) return null;
    const theirs = Math.min(...behind.map((o) => nowFor(o, g)));
    const hhmm = (s: number) => this.clock.format(s).slice(-5);
    return `⏳ Has llegado antes que el resto: para ti son las ${hhmm(mine)} y aquí aún son las ${hhmm(theirs)}. Podrás actuar en ${fmtDuration(this.clock.gameToReal(mine - g))} reales (marcharte, ya).`;
  }

  /** ¿Es moverse (a otro punto o a otra localización)? */
  private isMove(c: Character, text: string): boolean {
    return parseTrivial(this.world, c, text)?.kind === 'move';
  }

  /** ¿Es salir hacia otra localización? Eso lo puede hacer aunque vaya por delante del reloj. */
  private isLeaving(c: Character, text: string): boolean {
    const intent = parseTrivial(this.world, c, text);
    return intent?.kind === 'move' && intent.exit;
  }

  /**
   * «Continuar el viaje» tras un encuentro y «viajar con cuidado hacia X»
   * (ritmo sigiloso: más tiempo de juego, menos encuentros). Deterministas,
   * sin master. null si no aplica (sigue el camino de siempre).
   */
  private tryTravel(c: Character, text: string, intent: TravelIntent): ActionResult | null {
    if (c.status !== 'active') return null;
    const nowG = this.nowFor(c);
    const here = this.world.spot(positionOf(this.world, c, nowG).spot_id);
    if (intent.kind === 'continue') {
      const j = journeyOf(c);
      if (!j) return { ok: false, text: 'No tienes ningún viaje a medias.' };
      const res = moveTo(this.world, c.id, j.destination_spot_id, intent.careful ? 'stealth' : j.pace, nowG);
      if (!res.ok) return { ok: false, text: moveErrorText(this.world, res.error) };
      this.tripFrom.set(c.id, here.location_id);
      const dest = this.world.locationOfSpot(j.destination_spot_id);
      return this.emitTrivial(c, text, 'move', 'movement', `Sigues tu camino hacia ${dest.name}${intent.careful ? ', con cuidado' : ''}.`,
        `${c.name} sigue su camino hacia ${dest.name}.`, 'Una figura se aleja por el camino.');
    }
    const move = parseTrivial(this.world, c, `salir hacia ${intent.target}`);
    if (!move || move.kind !== 'move' || !move.exit) return null;
    const res = moveTo(this.world, c.id, move.spot_id, 'stealth', nowG);
    if (!res.ok) return { ok: false, text: moveErrorText(this.world, res.error) };
    this.tripFrom.set(c.id, here.location_id);
    const dest = this.world.locationOfSpot(move.spot_id);
    return this.emitTrivial(c, text, 'move', 'movement', `Te pones en camino hacia ${dest.name} con cuidado, atento a cada ruido (unos ${fmtDuration(res.total_s)} de juego).`,
      `${c.name} se marcha hacia ${dest.name} con paso cauteloso.`, 'Una figura se marcha despacio.');
  }

  /**
   * Intentar cruzar una barrera que rebota (barrier.ts, el Cerco de Ceniza):
   * el PJ se mete, pierde el tiempo de la barrera y sale por donde entró. Sin
   * master, aunque la escena esté tensa: la niebla no negocia.
   */
  private tryBarrier(c: Character, text: string): ActionResult | null {
    if (c.status !== 'active') return null;
    const exitId = parseCrossing(this.world, c, text);
    if (!exitId) return null;
    const b = bounceOff(this.world, c, exitId, this.gameNow());
    if (!b) return null;
    return this.emitTrivial(c, text, 'rebound', 'movement', b.text, b.observable, b.observable ? 'Una figura se mete en la niebla y vuelve a salir.' : null, undefined, { lost_s: b.lost_s });
  }

  /**
   * Acción trivial sin IA (fastpath.ts). Devuelve null si no lo es y debe seguir
   * el camino de siempre. Aunque sea trivial va al master si la escena está
   * tensa, si salta un gancho o si sale la tirada de imprevisto.
   */
  private async tryTrivial(c: Character, text: string): Promise<ActionResult | null> {
    if (!this.deterministic || !this.master || c.status !== 'active') return null;
    const nowG = this.gameNow();
    const locId = positionOf(this.world, c, nowG).location_id;

    const intent = parseTrivial(this.world, c, text, this.nowFor(c));
    if (!intent) return null;
    if (intent.kind === 'move' && intent.pace === 'stealth') return null; // el sigilo es una prueba: al master
    const locs = intent.kind === 'move' && intent.exit ? [locId, this.world.spot(intent.spot_id).location_id] : [locId];
    if (tension(this.world, c, locs, this.recentTags(locs), { leaving: intent.kind === 'move' && intent.exit })) return null;

    const cues: HookCue[] = [];
    if (intent.kind === 'move') cues.push({ kind: 'spot', spot_id: intent.spot_id, character_id: c.id });
    if (intent.kind === 'take') cues.push({ kind: 'item', item_id: this.world.itemInstance(intent.instance_id).item_id, location_id: locId, character_id: c.id });
    const hooks = cues.flatMap((cue) => matchHooks(this.world, cue));
    let hints: SceneHints | null = null;
    if (hooks.length) hints = { hooks, encounter: null };
    // Ir a otra localización: el imprevisto lo tiran el camino (travel.ts) y la llegada (arrivalPlan), no la salida.
    else if (!(intent.kind === 'move' && intent.exit)) {
      const chance = encounterChance(this.world, this.world.location(locId));
      const roll = this.rng();
      if (roll < chance) hints = { hooks: [], encounter: { chance, roll } };
    }
    if (hints) {
      const r = await this.resolveWithHints(c, text, hints);
      if (r.ok || r.text !== '') return r;
      // El master no responde: la acción trivial sale igual; los ganchos esperan a la próxima.
    }
    return this.execTrivial(c, text, intent);
  }

  /** Ejecuta con las mismas funciones que usan los tools y narra con plantilla. null si el motor la rechaza (al master). */
  private execTrivial(c: Character, input: string, intent: TrivialIntent): ActionResult | null {
    const nowG = this.nowFor(c);
    const here = this.world.spot(positionOf(this.world, c, nowG).spot_id);
    switch (intent.kind) {
      case 'move': {
        // Ruta entera hasta dentro (goto.ts); se corta antes si el mundo lo interrumpe.
        const goal = this.world.spot(intent.spot_id);
        let cut: RouteCut | null = null;
        let res = moveTo(this.world, c.id, goal.id, intent.pace, nowG);
        if (!res.ok && res.error.code === 'no_route') cut = blockedOnRoute(this.world, c, goal.id, intent.pace, nowG);
        else if (res.ok && intent.exit) cut = interruptionOnRoute(this.world, c, res.transit.legs);
        if (cut) {
          res = moveTo(this.world, c.id, cut.spot_id, intent.pace, nowG);
          if (res.ok && cut.kind === 'event' && cut.run_key) notePassedRun(c, cut.run_key);
        }
        if (!res.ok) return null;
        this.tripFrom.set(c.id, here.location_id);
        const dest = this.world.spot(res.transit.destination_spot_id);
        const run = intent.pace === 'run' ? ' a la carrera' : '';
        // Con viaje rápido no se espera: la llegada sale enseguida y dice cuánto ha costado.
        const instant = this.fastTravel && (intent.exit || nowG > this.gameNow());
        const eta = res.total_s < 60 || instant ? '' : ` Tardarás ${fmtDuration(res.total_s)} de juego (${fmtDuration(this.clock.gameToReal(res.total_s))} reales).`;
        if (intent.exit) {
          const loc = this.world.location(goal.location_id);
          // Trayecto largo: que se note que va andando y cuánto le cuesta.
          const walk = instant && res.total_s >= 600 ? ` Vas a pie, unos ${fmtDuration(res.total_s)} de camino.` : '';
          return this.emitTrivial(c, input, 'move', 'movement', `Te pones en camino hacia ${loc.name}${run}.${eta}${walk}${cut ? ` ${cut.text}` : ''}`,
            `${c.name} se marcha hacia ${loc.name}.`, `Una figura se marcha.`, dest.name);
        }
        return this.emitTrivial(c, input, 'move', 'movement', `Vas hacia ${dest.name}${run}.${eta}`,
          `${c.name} se acerca ${aEs(dest.name)}.`, `Una figura cruza hacia ${dest.name}.`, dest.name);
      }
      case 'take': {
        const inst = this.world.itemInstance(intent.instance_id);
        const def = this.world.itemDef(inst.item_id);
        const where = this.takeToHands(c, inst.id);
        if (!where) return null;
        return this.emitTrivial(c, input, 'take', 'inventory', `Coges ${def.name}${where === 'pocket' ? ' y te lo guardas' : ''}.`,
          `${c.name} coge ${def.name}.`, 'Una figura coge algo.', undefined, { item_id: def.id });
      }
      case 'drop': {
        const def = this.world.itemDef(this.world.itemInstance(intent.instance_id).item_id);
        const res = transferItem(this.world, intent.instance_id, { type: 'spot', id: here.id });
        if (!res.ok) return null;
        return this.emitTrivial(c, input, 'drop', 'inventory', `Dejas ${def.name} en ${here.name}.`,
          `${c.name} deja ${def.name} en ${here.name}.`, 'Una figura deja algo.');
      }
      case 'wait':
        return this.emitTrivial(c, input, 'wait', 'wait', `Esperas un rato en ${here.name}. No ocurre nada.`, null, null);
    }
  }

  /** Mano libre o bolsillo (bulto: las dos manos), como el parser plano. */
  private takeToHands(c: Character, instanceId: Id, quantity?: number): 'hand' | 'pocket' | null {
    const def = this.world.itemDef(this.world.itemInstance(instanceId).item_id);
    const targets: Placement[] = def.size === 'bulky'
      ? [{ type: 'character', id: c.id, slot: { kind: 'hand', which: 'both' } }]
      : [
        { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } },
        { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } },
        { type: 'character', id: c.id, slot: { kind: 'pocket' } },
      ];
    for (const t of targets) {
      if (transferItem(this.world, instanceId, t, quantity).ok) return t.type === 'character' && t.slot.kind === 'pocket' ? 'pocket' : 'hand';
    }
    return null;
  }

  /** Evento determinista: coste cero (master null) y acciones sugeridas desde el estado. */
  private emitTrivial(c: Character, input: string, type: string, tag: string, priv: string, obs: string | null, vague: string | null, skipSpotName?: string, extra: Record<string, unknown> = {}): ActionResult {
    const suggested = suggestActions(this.world, this.clock, c, this.gameNow()).filter((s) => !skipSpotName || s !== `Ir ${aEs(skipSpotName)}`);
    const event = this.events.emit({
      actor_id: c.id, action_type: type, input_text: input, narration_private: priv, observable: obs, tags: ['deterministic', tag],
      payload: { master: null, suggested_actions: suggested, ...(vague ? { observable_vague: vague } : {}), ...extra },
    }, this.stampFor(c));
    return { ok: true, text: priv, event, suggested_actions: suggested };
  }

  /** El jugador pulsa 🎲: el servidor tira y el master narra la consecuencia. */
  async rollPending(characterId: Id): Promise<ActionResult> {
    await this.tick();
    const c = this.world.character(characterId);
    const locId = positionOf(this.world, c, this.gameNow()).location_id;
    return this.runInLocation(locId, async () => {
      const wait = this.aheadWait(c);
      if (wait) return { ok: false, text: wait };
      const pending = this.pendingRolls.get(c.id);
      if (!pending) return { ok: false, text: 'No tienes ninguna tirada pendiente.' };
      this.pendingRolls.delete(c.id);
      // Ayuda de otro PJ (SRD): ventaja en esta tirada; con desventaja, se anulan.
      const helper = this.takeHelp(c);
      if (helper) pending.roll = { ...pending.roll, advantage: pending.roll.advantage === 'disadvantage' ? 'none' : 'advantage' };
      let result: CheckResult & { label: string };
      let roll: ShownRoll;
      let attack: { target_id: Id; hit: boolean; down: boolean; dead: boolean; damage: number } | undefined;
      if (pending.roll.kind === 'attack' && pending.roll.target) {
        const atk = resolveAttack(this.world, c.id, pending.roll.target, pending.roll.advantage, undefined, this.nowFor(c));
        if ('error' in atk) return { ok: false, text: atk.error };
        attack = { target_id: pending.roll.target, hit: atk.hit, down: Boolean(atk.target_down), dead: Boolean(atk.target_dead), damage: atk.damage };
        result = {
          label: `ataque con ${atk.weapon} a ${atk.target}`, expr: 'attack', total: atk.attack_total, rolls: [], d20s: [], modifier: 0, dc: atk.target_ac, advantage: pending.roll.advantage,
          success: atk.hit, ...(atk.natural ? { natural: atk.natural } : {}),
          breakdown: `${atk.attack_breakdown}${atk.hit ? `. Daño: ${atk.damage_breakdown} (${atk.damage_type}). ${atk.target} queda a ${atk.target_hp} PG${atk.target_dead ? ', MUERTO' : atk.target_down ? ', CAE' : ''}. El daño ya está aplicado: no lo apliques otra vez.` : '. Falla.'}`,
        };
        roll = attackRoll(c.id, pending.roll.target, atk);
      } else {
        result = characterCheck(c, pending.roll.kind, pending.roll.key, pending.roll.dc, pending.roll.advantage);
        roll = checkRoll(c.id, result);
      }
      if (helper) roll.note = `con la ayuda de ${pcName(this.world, c.id, helper)}`;
      const shown = rollTextForRoller(roll);
      this.announceRoll(roll, { roll: { ...result, dc: undefined }, ...(attack ? { attack } : {}) });
      if (pending.roll.kind === 'skill' && (pending.roll.dc ?? 0) >= this.world.campaign.progression.practice_min_dc) {
        const pe = addPractice(this.world, c, pending.roll.key);
        if (pe) this.emitProgress(c, [pe]);
      }
      let r = await this.resolveWithMaster(c, pending.text, { original_text: pending.text, result });
      if (!r.ok && r.text === '') r = { ok: false, text: `${shown}\nEl narrador no responde; inténtalo de nuevo.` };
      this.settleAll(this.gameNow());
      this.advanceStory(this.gameNow());
      this.announceDeathStates();
      await this.flush();
      return r;
    });
  }

  /**
   * Una tirada a la vista (rolls.ts): la ve quien tira, los PJ del mismo lugar,
   * el objetivo y quien comparte el turno o la ronda. Aviso de sistema, sin
   * narrador ni coste. Las tiradas ocultas no pasan por aquí.
   */
  announceRoll(r: ShownRoll, payload: Record<string, unknown> = {}, action_type = 'roll', tags: string[] = ['roll']): GameEvent | null {
    const pc = this.world.characters.get(r.roller_id);
    const spot = pc ? this.world.characterSpot(pc) : null;
    if (!pc || !spot) return null;
    const group = [...this.sharing.values()].filter((s) => s.ids.includes(pc.id) || (r.target_id && s.ids.includes(r.target_id))).flatMap((s) => s.ids);
    return this.events.emit({
      actor_id: pc.id, action_type, input_text: null, narration_private: rollTextForRoller(r), observable: rollTextForOthers(this.world, r),
      visibility: 'private', also_to: rollAudience(this.world, spot.location_id, pc.id, group, r.target_id), tags, payload: { master: null, shown_roll: r, ...payload },
    }, this.stampFor(pc));
  }

  private openDecisive(c: Character, d: { threat: string; npc_id: string | null }, eventId: Id): void {
    c.decisive = { opened_real_ms: this.now(), window_s: Engine.DECISIVE_WINDOW_S, threat: d.threat, npc_id: d.npc_id, event_id: eventId };
    this.world.touch('characters', c.id);
    if (this.realClock) {
      const t = setTimeout(() => { void this.expireDecisive(c.id, eventId); }, Engine.DECISIVE_WINDOW_S * 1000);
      this.decisiveTimers.set(c.id, t);
    }
  }

  private closeDecisive(c: Character): void {
    c.decisive = null;
    const t = this.decisiveTimers.get(c.id);
    if (t) { clearTimeout(t); this.decisiveTimers.delete(c.id); }
    this.world.touch('characters', c.id);
  }

  /** La ventana caduca: la amenaza se ejecuta contra el PJ sin que actúe (SPEC §9.3). */
  private async expireDecisive(characterId: Id, eventId: Id): Promise<void> {
    const c = this.world.characters.get(characterId);
    if (!c || !c.decisive || c.decisive.event_id !== eventId || !this.master) return;
    const locId = positionOf(this.world, c, this.gameNow()).location_id;
    await this.runInLocation(locId, async () => {
      if (!c.decisive || c.decisive.event_id !== eventId) return; // respondió justo antes
      this.pendingRolls.delete(c.id);
      // Ausente: no se queda sin acción, se defiende (CA y salvaciones normales); el contexto lo dice.
      const r = await this.resolveWithMaster(c, c.away ? '(ausente: se defiende)' : '(sin respuesta)', undefined, undefined, 'decisive_timeout');
      this.closeDecisive(c);
      if (!r.ok && c.decisive === null) {
        this.events.emit({ actor_id: c.id, action_type: 'decisive_expired', narration_private: 'No reaccionas a tiempo.', observable: null, tags: ['combat'] }, this.now());
      }
      await this.flush();
    }).catch((e) => console.error('[engine] decisiva:', e));
  }

  /** Comprobación desde el tick (para relojes inyectados o si el temporizador se perdió). */
  private checkDecisiveWindows(): void {
    for (const c of this.world.characters.values()) {
      if (c.decisive && this.now() - c.decisive.opened_real_ms >= c.decisive.window_s * 1000 && !this.decisiveTimers.has(c.id)) void this.expireDecisive(c.id, c.decisive.event_id);
    }
  }

  /**
   * Avisos de progreso como eventos de sistema: privados al PJ (los de otro no le llegan a nadie más), y
   * públicos en el tablón si procede. Si tocan una misión, llevan el cambio y su porqué (`payload.quest`).
   */
  private emitProgress(c: Character, events: ProgressEvent[]): void {
    for (const e of events) {
      this.events.emit({ actor_id: c.id, action_type: `progress_${e.kind}`, narration_private: e.text, observable: null, visibility: 'private', tags: ['progress', e.kind], payload: e.quest ? { quest: e.quest } : {} }, this.now());
      if (e.public) {
        const at = positionOf(this.world, c, this.gameNow());
        this.events.emit({ actor_id: null, at, action_type: 'announcement', narration_private: '', observable: e.public, visibility: 'public', tags: ['milestone', e.kind] }, this.now());
      }
    }
  }

  /** Historia escrita (story.ts): la amenaza que avanza y las misiones de cada PJ; y quien está ante el tablón lo lee. */
  private advanceStory(nowG: number): void {
    this.emitStory(tickStory(this.world, nowG));
    for (const c of this.world.characters.values()) {
      if (c.status === 'active' && atBoard(this.world, c)) this.noteBoard(c, this.nowFor(c));
    }
  }

  /** El PJ lee el tablón (ante él o con /tablon): cada encargo que no había visto entra en su Diario como disponible, con aviso. */
  private noteBoard(c: Character, nowG: number): void {
    const fresh = readBoard(this.world, c, nowG);
    this.emitProgress(c, fresh.map((j) => {
      const why = `Aviso del tablón: lo pide ${this.world.npc(j.giver_npc_id).name} · ${j.reward_coins} monedas`;
      return { kind: 'quest', text: `Encargo disponible: «${j.title}». ${why}.`, quest: { id: j.id, title: j.title, event: 'available', why } };
    }));
  }

  /** Avisos de la historia: los del PJ como progreso privado; los del mundo, a quien esté en el lugar (o a todos). */
  emitStory(out: StoryOutput): void {
    for (const p of out.personal) {
      const c = this.world.characters.get(p.character_id);
      if (c) this.emitProgress(c, p.events);
    }
    for (const a of out.announcements) {
      const spot = this.world.spots.get(a.spot_id ?? this.world.location(a.location_id).default_spot_id)!;
      this.events.emit({
        actor_id: null, at: { spot_id: spot.id, next_spot_id: null, progress: 0, x: spot.x, y: spot.y, location_id: spot.location_id },
        action_type: 'story', narration_private: '', observable: a.text, visibility: a.public ? 'public' : 'location', loudness: 5, tags: ['story'], payload: {},
      }, this.now());
    }
  }

  /** Estado del tablón para /tablon. */
  boardText(): string {
    const jobs = activeJobs(this.world);
    return jobs.length ? jobs.map((j) => `• **${j.title}** — ${j.text} (${j.reward_coins} monedas; lo pide ${this.world.npc(j.giver_npc_id).name})`).join('\n') : 'El tablón está vacío.';
  }

  private async resolveWithMaster(c: Character, text: string, roll?: { original_text: string; result: CheckResult & { label: string } }, intro?: { origin: string; welcome: string; prologue?: string }, scene?: MasterScene, decisive?: { seconds: number; speed: 'fast' | 'normal'; threat: string }): Promise<ActionResult> {
    const t0 = Date.now();
    const out = await this.master!.resolve(c, text, roll, intro, scene, decisive);
    if (out.ok) { this.masterOk.push({ ts: Date.now(), ms: Date.now() - t0 }); if (this.masterOk.length > 500) this.masterOk.shift(); }
    else { this.masterErr.push({ ts: Date.now(), reason: out.reason, message: out.message.slice(0, 200) }); if (this.masterErr.length > 100) this.masterErr.shift(); }
    if (!out.ok) {
      this.announcePending(c.id);
      console.warn(`[master] ${out.reason}: ${out.message}`);
      if (out.reason === 'refusal') return { ok: false, text: 'El narrador prefiere no seguir por ahí. Prueba otra cosa.' };
      return { ok: false, text: '' };
    }
    const k = out.closed;
    if (k.requires_roll && decisive?.speed === 'fast' && k.requires_roll.advantage === 'none') k.requires_roll.advantage = 'advantage';
    const payload: Record<string, unknown> = {
      observable_vague: k.observable_vague ?? undefined,
      suggested_actions: k.suggested_actions,
      requires_roll: k.requires_roll ?? undefined,
      master: { model: out.model, usage: out.usage, calls: out.calls, context: out.context },
      ...(this.hints.has(c.id) ? { scene_hints: this.hints.get(c.id) } : {}),
      ...(k.decisive ? { decisive: { threat: k.decisive.threat, window_s: Engine.DECISIVE_WINDOW_S } } : {}),
      ...(k.npc_id ? { npc_id: k.npc_id } : {}),
      ...(k.lines?.length ? { lines: k.lines } : {}),
      // Otro jugador al que se dirige: lo lee en segunda persona y recibe «Responder a…» (party.ts).
      ...(k.target_character_id ? { target_character_id: k.target_character_id, ...(k.observable_target ? { observable_target: k.observable_target } : {}) } : {}),
      // Tools de escritura que fallaron (el cierre lleva tag tool_failed) y acercamiento que hizo el motor.
      ...(out.tool_errors?.length ? { tool_errors: out.tool_errors } : {}),
      ...(out.approach ? { approach: out.approach } : {}),
    };
    // Turno compartido (grupo o ronda): lo reciben todos los que participan, con lo que escribió cada uno.
    const share = this.sharing.get(c.id);
    if (share) { payload['group'] = share.ids; payload['group_inputs'] = share.inputs; }
    const event = this.events.emit({
      actor_id: c.id, action_type: intro ? 'master_intro' : scene === 'arrival' ? 'master_arrival' : scene === 'hook' ? 'master_hook' : roll ? 'master_roll_outcome' : 'master', input_text: intro || scene ? null : share ? share.inputs[c.id] ?? text : text,
      narration_private: k.narration_private, observable: k.observable, loudness: k.loudness, tags: ['master', ...k.tags, ...(share ? ['shared'] : [])], payload,
      ...(share ? { also_to: share.ids.filter((id) => id !== c.id) } : {}),
    }, this.stampFor(c));
    // Lo que el máster pidió a otro jugador (request_reaction): la petición sale después de su narración.
    this.announcePending(c.id);
    if (k.requires_roll) this.pendingRolls.set(c.id, { text, roll: k.requires_roll, event_id: event.id });
    if (k.decisive && scene !== 'decisive_timeout' && c.status === 'active') this.openDecisive(c, k.decisive, event.id);
    for (const sr of out.shown_rolls ?? []) this.announceRoll(sr);
    if (out.progress?.length) this.emitProgress(c, out.progress);
    const r: ActionResult = { ok: true, text: k.narration_private, event, suggested_actions: k.suggested_actions };
    if (k.requires_roll) r.requires_roll = k.requires_roll;
    return r;
  }

  /** «Dejar esta misión» desde el Diario (quests.ts): sin máster; un aviso de una línea en el hilo. */
  async dropQuest(characterId: Id, questId: Id): Promise<{ ok: boolean; text: string }> {
    const c = this.world.character(characterId);
    const r = dropQuest(this.world, c, questId, this.nowFor(c));
    if (!r.ok) return { ok: false, text: r.error };
    this.emitProgress(c, [{ kind: 'quest', text: `Has dejado la misión «${r.title}».`, quest: { id: questId, title: r.title, event: 'dropped', why: 'la dejaste desde el Diario' } }]);
    await this.flush();
    return { ok: true, text: `Has dejado la misión «${r.title}».` };
  }

  /** Comandos de sistema (SPEC §2.4). Sin LLM, sin cola. */
  async command(characterId: Id, name: string): Promise<string> {
    // Depuración, solo en offline: «/time +2h» adelanta el reloj de juego (y lo guarda en la campaña).
    const skip = /^\/?time\s+\+(\d+(?:[.,]\d+)?)\s*(h|m|min|d)?$/i.exec(name.trim());
    if (skip && process.env['MASTER_MODE'] === 'offline') {
      const unit = skip[2]?.toLowerCase() ?? 'h';
      const s = Math.round(Number(skip[1]!.replace(',', '.')) * (unit === 'd' ? GAME_DAY : unit === 'h' ? 3600 : GAME_MINUTE));
      // A saltos de 5 min con tick en cada uno, para que lo que empieza por el camino se cuente a su hora.
      for (let left = s; left > 0; left -= 5 * GAME_MINUTE) {
        const d = Math.min(left, 5 * GAME_MINUTE);
        this.clock.shift(d);
        this.world.campaign.game_epoch_s += d;
        // La espera de quien ha muerto (en tiempo real) se acorta lo equivalente.
        for (const x of this.world.characters.values()) if (x.death?.respawn_real_ms) x.death.respawn_real_ms -= this.clock.gameToReal(d) * 1000;
        await this.tick();
      }
      this.world.touch('campaign', this.world.campaign.id);
      return `Reloj adelantado ${fmtDuration(s)}: ${this.clock.format(this.gameNow())}.`;
    }
    // Depuración, solo en offline: «/daño 5» hiere al propio PJ (para probar caídas y muertes sin combate).
    const hurt = /^\/?da[ñn]o\s+(\d+)$/i.exec(name.trim());
    if (hurt && process.env['MASTER_MODE'] === 'offline') {
      const c = this.world.character(characterId);
      const r = damageCharacter(this.world, c, Number(hurt[1]), { cause: 'una herida (depuración)', nowGameS: this.nowFor(c) });
      this.announceDeathStates();
      await this.flush();
      return r.died ? 'Muere.' : r.down ? 'Cae a 0 PG.' : r.failures ? `Suma ${r.failures} fallo(s) de salvación.` : `PG ${c.hp_current}/${c.hp_max}.`;
    }
    await this.tick();
    const c = this.world.character(characterId);
    const nowG = this.nowFor(c);
    switch (name.replace(/^\//, '')) {
      case 'where': return whereAmI(this.world, this.clock, c, nowG);
      case 'who': return whoIsHere(this.world, this.clock, c, nowG);
      case 'inventory': return formatInventory(inventoryView(this.world, c.id));
      case 'look': return describeSurroundings(this.world, this.clock, c, nowG);
      case 'recap': {
        const missed = this.recapFor(c.id);
        return missed.length ? missed.map((d) => `· ${d.text}`).join('\n') : 'No te has perdido nada.';
      }
      case 'time': return `${this.clock.format(nowG)} (ratio ${this.clock.timeRatio}×).${nowG - this.gameNow() > SAME_TIME_TOLERANCE_S ? ` Vas ${fmtDuration(nowG - this.gameNow())} por delante del reloj del mundo (has viajado).` : ''}`;
      case 'tablon': this.noteBoard(c, nowG); return this.boardText();
      case 'progress': {
        const a = this.world.campaign.achievement;
        const clues = c.clues.map((id) => this.world.campaign.clues.find((x) => x.id === id)?.title ?? id);
        const rep = c.reputation[a.faction_id] ?? 0;
        const practice = Object.entries(c.practice).map(([k, n]) => `${k}: ${n}${c.practice_bonus[k] ? ` (+${c.practice_bonus[k]})` : ''}`);
        return [`Reputación en Brezal: ${rep} (logro a ${a.reputation_required}).`, `Pistas (${c.clues.length}/${a.clues_required} para el logro): ${clues.join(', ') || 'ninguna'}.`, `Encargos completados: ${c.completed_jobs.length}.`, `Práctica: ${practice.join(', ') || 'ninguna'}.`, c.achievements.length ? `Logros: ${c.achievements.map((x) => x.id).join(', ')}.` : ''].filter(Boolean).join('\n');
      }
      default: return `Comando desconocido: ${name}`;
    }
  }

  // -------------------------------------------------------------------------
  // Jugadores: alta, presencia
  // -------------------------------------------------------------------------

  characterByUser(userId: Id): Character | null {
    for (const c of this.world.characters.values()) if (c.user_id === userId && c.status !== 'retired') return c;
    return null;
  }

  /**
   * Alta de personaje (SPEC §4.6, §4.8). El servidor valida contra las tablas SRD,
   * calcula derivados y crea el equipo inicial. Lo que falte de `spec`: humano guerrero
   * soldado con el array recomendado (para pruebas y el REPL).
   */
  /**
   * `opts.place` coloca al PJ recién creado (situación inicial, junto a otro PJ…)
   * antes de anunciar su llegada: así el aviso «llega a…» y la primera visita
   * salen en el sitio donde de verdad empieza, no en el punto de inicio genérico.
   */
  async createCharacter(userId: Id, name: string, spec?: Partial<CharacterSpec>, opts: { place?: (c: Character) => void } = {}): Promise<{ ok: true; character: Character } | { ok: false; reason: string }> {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 24) return { ok: false, reason: 'El nombre debe tener entre 2 y 24 caracteres.' };
    if (this.characterByUser(userId)) return { ok: false, reason: 'Ya tienes un personaje.' };
    if ([...this.world.characters.values()].some((c) => c.name.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: 'Ese nombre ya está en uso.' };

    const race = raceById(spec?.race_id ?? 'human');
    const klass = classById(spec?.class_id ?? 'fighter');
    const bg = backgroundById(spec?.background_id ?? 'soldier');
    if (!race || !klass || !bg) return { ok: false, reason: 'Raza, clase o trasfondo no válidos.' };

    // Características: array estándar asignado (validado) o el recomendado de la clase.
    const base = spec?.abilities ?? Object.fromEntries(ABILITIES.map((a, i) => [a, klass.recommended[i]])) as Record<Ability, number>;
    const sorted = ABILITIES.map((a) => base[a]).sort((x, y) => y - x);
    if (sorted.join(',') !== [...STANDARD_ARRAY].join(',')) return { ok: false, reason: 'Las características deben ser el array estándar 15, 14, 13, 12, 10, 8.' };
    const abilities = Object.fromEntries(ABILITIES.map((a) => [a, base[a] + (race.ability_bonus[a] ?? 0)])) as Record<Ability, number>;

    // Skills: trasfondo + raza fijas; clase elige N de su lista sin repetir.
    const fixed = [...new Set([...bg.skills, ...race.skills])];
    const choices = spec?.skills ?? klass.skill_choices.from.filter((k) => !fixed.includes(k)).slice(0, klass.skill_choices.count);
    if (choices.length !== klass.skill_choices.count) return { ok: false, reason: `Elige ${klass.skill_choices.count} habilidades de clase.` };
    for (const k of choices) {
      if (!klass.skill_choices.from.includes(k)) return { ok: false, reason: `${k} no es una habilidad de ${klass.name}.` };
      if (fixed.includes(k)) return { ok: false, reason: `${k} ya la tienes por trasfondo o raza.` };
    }
    const skills = [...new Set([...fixed, ...choices])];

    const conMod = abilityModifier(abilities.con);
    const hp = klass.hit_die + conMod;
    const id = `ch_${clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`;
    const c: Character = {
      id, user_id: userId, name: clean,
      race: race.name.toLowerCase(), class_name: klass.name.toLowerCase(), race_id: race.id, class_id: klass.id, background_id: bg.id,
      hit_die: klass.hit_die, death_mode: spec?.death_mode ?? 'casual',
      level: 1, appearance: spec?.appearance ?? '', backstory: '',
      hp_max: hp, hp_current: hp, hp_temp: 0, conditions: [],
      proficiencies: { skills, expert: [], saves: [...klass.saves] },
      practice: {}, practice_bonus: {}, reputation: {}, knows: [], clues: [], completed_jobs: [], achievements: [],
      decisive: null, xp: 0,
      location: { type: 'spot', id: this.pickStartingPoint().spot_id },
      transit: null, status: 'active', speed_ft: race.speed_ft,
      abilities, passive_perception: 10, darkvision: race.darkvision, condition_speed_factor: 1,
      coins: 1500, last_seen_event_id: null, recap_from: null, connected: true, veiled: false,
    };
    c.passive_perception = passivePerception(c);
    this.world.characters.set(c.id, c);
    this.world.touch('characters', c.id);
    opts.place?.(c);
    const start = this.world.spot(c.location.id);
    const loc = this.world.location(start.location_id);
    loc.discovery[c.id] = 'visited';
    this.world.touch('locations', loc.id);

    // Equipo inicial de la clase.
    let pack: Id | null = null;
    const pending: { item_id: Id; quantity: number }[] = [];
    for (const eq of klass.equipment) {
      if (!this.world.itemDefs.has(eq.item_id)) continue;
      const qty = eq.quantity ?? 1;
      const to = eq.slot === 'body' ? { type: 'character' as const, id: c.id, slot: { kind: 'equipped' as const, slot: 'body' as const } }
        : eq.slot === 'back' ? { type: 'character' as const, id: c.id, slot: { kind: 'equipped' as const, slot: 'back' as const } }
        : eq.slot === 'hand_main' ? { type: 'character' as const, id: c.id, slot: { kind: 'hand' as const, which: 'main' as const } }
        : eq.slot === 'hand_off' ? { type: 'character' as const, id: c.id, slot: { kind: 'hand' as const, which: 'off' as const } }
        : eq.slot === 'pocket' ? { type: 'character' as const, id: c.id, slot: { kind: 'pocket' as const } }
        : null;
      if (to === null) { pending.push({ item_id: eq.item_id, quantity: qty }); continue; }
      const r = spawnItem(this.world, eq.item_id, qty, to);
      if (r.ok && eq.slot === 'back') pack = r.moved.id;
      if (!r.ok) pending.push({ item_id: eq.item_id, quantity: qty });
    }
    for (const p of pending) {
      const r = pack ? spawnItem(this.world, p.item_id, p.quantity, { type: 'container', id: pack }) : { ok: false as const };
      if (!r.ok) spawnItem(this.world, p.item_id, p.quantity, { type: 'spot', id: start.id });
    }

    this.events.emit({
      actor_id: c.id, action_type: 'character_joined', narration_private: this.master ? '' : `Llegas a ${loc.name}.`,
      observable: `${c.name} llega ${aEs(start.name)}.`, tags: ['milestone:join'], payload: { observable_vague: 'Alguien llega.' },
    }, this.now());
    this.firstVisit({ character_id: c.id, location_id: loc.id, game_s: this.gameNow() });
    this.meetAll();
    await this.flush();
    return { ok: true, character: c };
  }

  /** Punto de inicio en la localización con menos PJs vivos; empate → el primero de la lista. */
  pickStartingPoint(): { spot_id: Id; origin: string } {
    let best: { p: { spot_id: Id; origin: string }; n: number } | null = null;
    for (const p of this.world.campaign.starting_points) {
      const loc = this.world.spot(p.spot_id).location_id;
      const n = this.world.charactersInLocation(loc).filter((c) => c.status !== 'dead' && c.status !== 'retired').length;
      if (!best || n < best.n) best = { p, n };
    }
    return best!.p;
  }

  /**
   * Primera escena (SPEC §11.2.1): antes, el prólogo (docs/PROLOGO.md), una vez
   * por PJ; después el master narra la llegada con el origen del punto de inicio
   * y un gancho, sin repetir el prólogo. El adaptador la pide cuando el canal del
   * jugador ya existe. Sin master, solo el prólogo de plantilla.
   */
  async introduce(characterId: Id): Promise<ActionResult | null> {
    await this.tick();
    const c = this.world.character(characterId);
    const spot = this.world.characterSpot(c)!;
    const origin = this.world.campaign.starting_points.find((p) => p.spot_id === spot.id)?.origin ?? c.backstory;
    const locId = spot.location_id;
    return this.runInLocation(locId, async () => {
      const prologue = await this.writePrologue(c);
      if (!this.master) { await this.flush(); return null; }
      const r = await this.resolveWithMaster(c, '(primera escena)', undefined, { origin, welcome: this.world.campaign.welcome.replaceAll('{name}', c.name), ...(prologue ? { prologue: prologue.narration_private } : {}) });
      await this.flush();
      return r.ok ? r : null;
    });
  }

  private prologuing = new Set<Id>();
  /** El prólogo del PJ (evento `prologue`): el máster lo escribe una vez; si no puede, la plantilla. null si ya lo tenía. */
  private async writePrologue(c: Character): Promise<GameEvent | null> {
    const has = () => this.events.all().some((e) => e.action_type === 'prologue' && e.actor_id === c.id);
    if (has() || this.prologuing.has(c.id)) return null;
    this.prologuing.add(c.id);
    try {
      const facts = prologueFacts(this, c);
      let text: string | null = null;
      let meta: Record<string, unknown> = {};
      if (this.master?.write) {
        const r = await this.master.write(prologuePrompt(facts)).catch(() => null);
        text = acceptPrologue(r?.text);
        if (text && r) meta = { master: { model: r.model, usage: r.usage } };
      }
      if (has()) return null;
      return this.events.emit({
        actor_id: c.id, action_type: 'prologue', narration_private: forReader(this, c, text ?? prologueTemplate(facts)), observable: null,
        tags: ['prologue'], payload: { title: facts.title, source: text ? 'master' : 'template', ...meta },
      }, this.stampFor(c));
    } finally { this.prologuing.delete(c.id); }
  }

  private recapping = new Set<Id>();
  /**
   * «Donde lo dejamos» (docs/PROLOGO.md): si el PJ lleva más de RECAP_AFTER_HOURS
   * horas reales (72) o 7 días de juego sin un evento suyo, un evento `recap` con
   * lo esencial, por plantilla. Con RECAP_POLISH=on y máster, pulido en prosa.
   * El adaptador lo pide al abrir la partida. null si no toca.
   */
  async welcomeBack(characterId: Id, env: NodeJS.ProcessEnv = process.env): Promise<GameEvent | null> {
    const c = this.world.characters.get(characterId);
    if (!c || c.status === 'dead' || c.status === 'retired' || this.recapping.has(c.id)) return null;
    this.recapping.add(c.id);
    try {
      await this.tick();
      const gone = absence(this, c, this.now(), absenceRule(env));
      if (!gone) return null;
      let text = recapTemplate(this, c, gone.since, gone.hours);
      let meta: Record<string, unknown> = {};
      if (env['RECAP_POLISH'] === 'on' && this.master?.write) {
        const r = await this.master.write(recapPrompt(text)).catch(() => null);
        const polished = acceptRecap(r?.text);
        if (polished && r) { text = forReader(this, c, polished); meta = { master: { model: r.model, usage: r.usage } }; }
      }
      const e = this.events.emit({
        actor_id: c.id, action_type: 'recap', narration_private: text, observable: null, tags: ['recap'],
        payload: { title: RECAP_TITLE, source: meta['master'] ? 'master' : 'template', away_hours: Math.round(gone.hours), away_game_days: Math.round(gone.game_days * 10) / 10, since_event_id: gone.since.id, ...meta },
      }, this.stampFor(c));
      await this.flush();
      return e;
    } finally { this.recapping.delete(c.id); }
  }

  /** Baja definitiva (válvula de admin, fase 1). Los eventos quedan; el PJ y sus cosas desaparecen. */
  async deleteCharacter(characterId: Id): Promise<boolean> {
    const c = this.world.characters.get(characterId);
    if (!c) return false;
    for (const i of this.world.itemsCarriedBy(c.id)) this.world.remove('item_instances', i.id);
    this.world.remove('characters', c.id);
    this.presence.delete(c.id);
    this.lastAction.delete(c.id);
    this.events.emit({
      actor_id: null, at: positionOf(this.world, c, this.gameNow()), action_type: 'admin_fix',
      narration_private: `${c.name} desaparece del mundo.`, observable: `${c.name} desaparece del mundo.`, tags: ['admin_fix'],
    }, this.now());
    await this.flush();
    return true;
  }

  private presence = new Map<Id, boolean>();
  private lastAction = new Map<Id, number>();
  /** SPEC §9.1: conectado = presencia online/idle o acción en los últimos 30 min. */
  static readonly CONNECTED_GRACE_MS = 30 * 60 * 1000;
  /** SPEC §9.3: umbrales de respuesta decisiva (iniciales 15/60 s). */
  static readonly DECISIVE_FAST_S = 15;
  static readonly DECISIVE_WINDOW_S = 60;
  private decisiveTimers = new Map<Id, NodeJS.Timeout>();
  private readonly realClock: boolean;

  /** El adaptador informa de la presencia del jugador; el motor decide la conexión efectiva. */
  setPresence(characterId: Id, online: boolean): void {
    this.presence.set(characterId, online);
    this.refreshConnection(characterId);
  }

  private refreshConnection(characterId: Id): void {
    const online = this.presence.get(characterId) ?? false;
    const last = this.lastAction.get(characterId) ?? 0;
    this.setConnected(characterId, online || this.now() - last < Engine.CONNECTED_GRACE_MS);
  }

  /** Marca conexión/desconexión del jugador (SPEC §9.1: velo). */
  setConnected(characterId: Id, connected: boolean): void {
    const c = this.world.character(characterId);
    if (connected === c.connected) return;
    c.connected = connected;
    if (!connected) {
      if (c.status === 'active') c.status = 'asleep';
      c.veiled = true;
      if (!c.recap_from) c.recap_from = { event_id: c.last_seen_event_id };
    } else {
      c.veiled = false;
    }
    this.world.touch('characters', c.id);
  }

  /** Lo que el PJ percibió desde que dejó de mirar (desconexión) y no ha visto aún. Consumirlo lo marca como visto. */
  recapFor(characterId: Id): Delivery[] {
    const c = this.world.character(characterId);
    const from = c.recap_from ? c.recap_from.event_id : c.last_seen_event_id;
    const missed = this.events.forCharacter(c.id, from).filter((d) => d.event.actor_id !== c.id);
    const last = this.events.forCharacter(c.id, from).at(-1);
    if (c.recap_from || last) {
      c.recap_from = null;
      if (last) c.last_seen_event_id = last.event.id;
      this.world.touch('characters', c.id);
    }
    return missed;
  }

  // -------------------------------------------------------------------------
  // Entre jugadores (party.ts, docs/MULTIJUGADOR.md): decir, ofertas, seguir y ayudar. Sin máster.
  // -------------------------------------------------------------------------

  /**
   * Decir sin máster: la frase literal del PJ, al instante. No espera a la cola
   * del sitio (no cambia nada del mundo salvo quién conoce a quién). Llega por el
   * oído: quien la oye bien recibe la frase; quien oye poco, un murmullo. Con
   * destinatario (`to`: id o nombre), él recibe «Responder a…» en su hilo.
   * Quien la oye bien aprende el nombre del que habla si lo dice, y el del
   * destinatario si lo nombra.
   */
  async say(characterId: Id, text: string, opts: { to?: Id | null; mode?: SayMode } = {}): Promise<ActionResult> {
    const c = this.world.character(characterId);
    this.lastAction.set(c.id, this.now());
    if (!c.connected) this.setConnected(c.id, true);
    if (c.status !== 'active') return { ok: false, text: c.status === 'asleep' ? 'Estás dormido.' : `No puedes hablar (${c.status}).` };
    const parsed = parseSay(text, true);
    if (!parsed) return { ok: false, text: '¿Qué dices?' };
    const mode = opts.mode ?? parsed.mode;
    let target: Character | null = null;
    const toId = opts.to ?? null;
    if (toId || parsed.to) {
      target = toId ? this.world.characters.get(toId) ?? null : findPresentPc(this.world, c, parsed.to!);
      if (!target || target.id === c.id || this.world.characterSpot(target)?.location_id !== this.world.characterSpot(c)?.location_id) {
        return { ok: false, text: `No ves aquí a ${parsed.to ?? 'esa persona'}.` };
      }
    }
    const said = parsed.text;
    const nowG = this.nowFor(c);
    const at = positionOf(this.world, c, nowG);
    const loudness = SAY_LOUDNESS[mode];
    // Lo que se oye bien enseña nombres: el de quien habla si lo dice y el del destinatario si lo nombra.
    const named = (n: string) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(said);
    for (const w of witnesses(this.world, this.clock, at, nowG, loudness, c.id)) {
      if (w.perceived.sound !== 'full') continue;
      const learn = [named(c.name) ? c.id : null, target && target.id !== w.character.id && named(target.name) ? target.id : null].filter((x): x is Id => x !== null);
      for (const id of learn) if (!w.character.knows.includes(id)) { w.character.knows.push(id); this.world.touch('characters', w.character.id); }
    }
    if (target && named(target.name) && !c.knows.includes(target.id)) { c.knows.push(target.id); this.world.touch('characters', c.id); }
    const verb = { say: ['Dices', 'dice'], shout: ['Gritas', 'grita'], whisper: ['Susurras', 'susurra'] }[mode];
    const toMe = target ? ` a ${pcName(this.world, c.id, target)}` : '';
    const event = this.events.emit({
      actor_id: c.id, action_type: mode, input_text: said, channel: 'sound', loudness,
      narration_private: `${verb[0]}${toMe}: «${said}»`,
      observable: `${c.name} ${verb[1]}${target ? ` a ${target.name}` : ''}: «${said}»`,
      tags: ['deterministic', 'social', 'say'],
      payload: {
        master: null, say: { text: said, mode, to: target?.id ?? null }, lines: [{ speaker: 'actor', text: said }],
        ...(target ? { target_character_id: target.id } : {}),
        observable_vague: mode === 'shout' ? `Alguien grita: «${said}»` : mode === 'whisper' ? 'Alguien susurra algo que no alcanzas a oír.' : 'Oyes a alguien hablar, pero no entiendes qué dice.',
        observable_hint: mode === 'shout' ? 'Oyes un grito a lo lejos.' : 'Oyes un murmullo de voces.',
      },
    }, this.stampFor(c));
    await this.flush();
    return { ok: true, text: event.narration_private, event };
  }

  /**
   * «hablar con <PJ>», «seguir a <PJ>», «dejar de seguir», «ayudar a <PJ>» y
   * «dar <algo> a <PJ>». Deterministas; null si no es nada de eso (o el otro
   * no es un PJ presente) y sigue el camino de siempre.
   */
  private tryParty(c: Character, text: string): ActionResult | null {
    if (c.status !== 'active') return null;
    const give = parseGive(text);
    if (give) {
      const to = findPresentPc(this.world, c, give.to);
      if (!to) return null;
      const coins = coinsIn(give.what);
      let instance: Id | null = null;
      if (coins === null) {
        const item = resolveItem(this.world, c, give.what, 'carried');
        if (item.kind === 'none') return { ok: false, text: `No llevas «${give.what}».` };
        if (item.kind === 'many') return this.ambiguous(item);
        instance = item.value;
      }
      const r = this.offer(c.id, to.id, { instance_id: instance, coins: coins ?? 0 }, text);
      return r.ok ? r.result : { ok: false, text: r.error };
    }
    const intent = parseParty(text);
    if (!intent) return null;
    if (intent.kind === 'unfollow') {
      const leader = c.following ? this.world.characters.get(c.following) : null;
      if (!leader) return { ok: false, text: 'No sigues a nadie.' };
      c.following = null;
      this.world.touch('characters', c.id);
      return this.emitTrivial(c, text, 'unfollow', 'party', `Dejas de seguir a ${pcName(this.world, c.id, leader)}.`, `${c.name} deja de seguir a ${leader.name}.`, null);
    }
    const who = findPresentPc(this.world, c, intent.who);
    if (!who) return null;
    const name = pcName(this.world, c.id, who);
    if (intent.kind === 'talk') {
      return { ok: true, text: `¿Qué le dices a ${name}? Escríbelo con «Decir» (o empieza por una raya: «— Hola»).`, say_to: { id: who.id, name } };
    }
    if (intent.kind === 'follow') {
      if (who.following === c.id) return { ok: false, text: `${name.charAt(0).toUpperCase() + name.slice(1)} ya te sigue a ti.` };
      c.following = who.id;
      this.world.touch('characters', c.id);
      return this.emitTrivial(c, text, 'follow', 'party', `Te pones detrás de ${name}: irás donde vaya hasta que digas «dejar de seguir».`,
        `${c.name} se pone detrás de ${who.name}, dispuesto a seguirle.`, 'Una figura se pone detrás de otra.', undefined,
        { target_character_id: who.id, observable_target: `${c.name} se pone detrás de ti: te seguirá adonde vayas.` });
    }
    // Ayudar (SRD): ventaja en la siguiente prueba o ataque del ayudado.
    who.helped_by = { character_id: c.id, expires_game_s: this.nowFor(who) + HELP_TTL_S };
    this.world.touch('characters', who.id);
    return this.emitTrivial(c, text, 'help', 'party', `Te pones al lado de ${name} para echarle una mano: su próxima tirada irá con ventaja.`,
      `${c.name} se pone al lado de ${who.name} para echarle una mano.`, null, undefined,
      { target_character_id: who.id, observable_target: `${c.name} se pone a tu lado para echarte una mano: tu próxima tirada irá con ventaja.` });
  }

  /**
   * Oferta de un PJ a otro (party.ts): un ejemplar que lleva encima, monedas o
   * ambas cosas. No mueve nada: el otro acepta o rechaza con botones en su hilo
   * y caduca a los OFFER_TTL_MS. Si están en puntos distintos de la sala, el que
   * da se acerca. La usan «dar X a <PJ>» y el transfer_item del máster.
   */
  offer(fromId: Id, toId: Id, what: { instance_id: Id | null; quantity?: number; coins: number }, input: string | null = null): { ok: true; offer: Offer; result: ActionResult } | { ok: false; error: string } {
    const from = this.world.character(fromId);
    const to = this.world.characters.get(toId);
    if (!to || to.id === from.id) return { ok: false, error: 'No hay a quién dárselo.' };
    const toName = pcName(this.world, from.id, to);
    const here = this.world.characterSpot(from);
    const there = this.world.characterSpot(to);
    if (!here || !there || here.location_id !== there.location_id) return { ok: false, error: `${toName} no está aquí.` };
    if (to.status !== 'active') return { ok: false, error: `${toName} no está en condiciones de recibir nada.` };
    const coins = Math.max(0, Math.floor(what.coins));
    if (coins > from.coins) return { ok: false, error: `No tienes ${coins} monedas (llevas ${from.coins}).` };
    let label = '';
    let quantity = 0;
    if (what.instance_id) {
      const inst = this.world.itemInstances.get(what.instance_id);
      if (!inst || !this.world.itemsCarriedBy(from.id).some((i) => i.id === inst.id)) return { ok: false, error: 'No llevas eso encima.' };
      quantity = Math.max(1, Math.min(inst.quantity, Math.floor(what.quantity ?? inst.quantity)));
      const def = this.world.itemDef(inst.item_id);
      label = quantity > 1 ? `${def.name} ×${quantity}` : def.name;
    }
    if (coins) label = label ? `${label} y ${coins} monedas` : `${coins} monedas`;
    if (!label) return { ok: false, error: '¿Qué le das?' };
    if (here.id !== there.id) approachSpot(this.world, from, there.id);
    const nowMs = this.now();
    const offer: Offer = {
      id: `of_${nowMs.toString(36)}_${Math.floor(this.rng() * 1e6).toString(36)}`, from_id: from.id, to_id: to.id,
      instance_id: what.instance_id, quantity, coins, label, created_real_ms: nowMs, expires_real_ms: nowMs + OFFER_TTL_MS,
    };
    to.offers = [...(to.offers ?? []), offer];
    this.world.touch('characters', to.id);
    const min = Math.round(OFFER_TTL_MS / 60000);
    const event = this.events.emit({
      actor_id: from.id, action_type: 'offer', input_text: input, also_to: [to.id],
      narration_private: `Le tiendes ${label} a ${toName}. Es suyo si lo acepta (tiene ${min} minutos).`,
      observable: `${from.name} le tiende ${label} a ${to.name}.`,
      tags: ['deterministic', 'party', 'inventory'],
      payload: { master: null, offer: { id: offer.id, to: to.id, label }, target_character_id: to.id, observable_target: `${from.name} te ofrece ${label}.`, observable_vague: 'Una figura le tiende algo a otra.' },
    }, this.stampFor(from));
    offer.event_id = event.id;
    return { ok: true, offer, result: { ok: true, text: event.narration_private, event } };
  }

  /**
   * Aceptar o rechazar una oferta. Síncrono de principio a fin: comprueba que
   * sigue en pie (no caducada, los dos en la misma sala, el que da aún lo lleva
   * y le llegan las monedas) y transfiere todo o nada. No espera a la cola: entre
   * comprobar y mover no corre nada más.
   */
  async answerOffer(characterId: Id, offerId: Id, accept: boolean): Promise<ActionResult> {
    const c = this.world.character(characterId);
    const offer = c.offers?.find((o) => o.id === offerId);
    if (!offer) return { ok: false, text: 'Esa oferta ya no está en pie.' };
    dropOffer(this.world, c, offer.id);
    const from = this.world.characters.get(offer.from_id);
    const fromName = from ? pcName(this.world, c.id, from) : 'alguien';
    const done = async (r: ActionResult) => { await this.flush(); return r; };
    if (!from) return done({ ok: false, text: 'Quien te lo ofrecía ya no está.' });
    if (offer.expires_real_ms <= this.now()) return done({ ok: false, text: `La oferta de ${fromName} ha caducado.` });
    const emit = (type: string, priv: string, obs: string, mine: string) => this.events.emit({
      actor_id: c.id, action_type: type, also_to: [from.id], narration_private: priv, observable: obs, tags: ['deterministic', 'party'],
      payload: { master: null, offer: { id: offer.id, to: c.id, label: offer.label, answer: type }, target_character_id: from.id, observable_target: mine },
    }, this.stampFor(c));
    if (!accept) {
      const e = emit('offer_declined', `Rechazas ${offer.label} de ${fromName}.`, `${c.name} rechaza lo que le ofrece ${from.name}.`, `${c.name} no acepta lo que le ofreces (${offer.label}).`);
      return done({ ok: true, text: e.narration_private, event: e });
    }
    const failed = (why: string) => {
      const e = emit('offer_failed', `No llega a pasar a tus manos: ${why}.`, `${c.name} alarga la mano, pero no llega a coger lo que le ofrece ${from.name}.`, `${c.name} quería aceptar ${offer.label}, pero no ha podido: ${why}.`);
      return done({ ok: false, text: e.narration_private, event: e });
    };
    const mySpot = this.world.characterSpot(c);
    const theirSpot = this.world.characterSpot(from);
    if (!mySpot || !theirSpot || mySpot.location_id !== theirSpot.location_id || from.transit) return failed(`${fromName} ya no está aquí`);
    if (offer.coins > from.coins) return failed(`${fromName} ya no tiene esas monedas`);
    const inst = offer.instance_id ? this.world.itemInstances.get(offer.instance_id) : null;
    if (offer.instance_id && (!inst || !this.world.itemsCarriedBy(from.id).some((i) => i.id === inst.id) || inst.quantity < offer.quantity)) return failed(`${fromName} ya no lo tiene`);
    if (mySpot.id !== theirSpot.id) approachSpot(this.world, c, theirSpot.id);
    if (inst && !this.takeToHands(c, inst.id, offer.quantity)) return failed('no tienes dónde llevarlo');
    if (offer.coins) { from.coins -= offer.coins; c.coins += offer.coins; this.world.touch('characters', from.id); this.world.touch('characters', c.id); }
    const e = emit('offer_accepted', `Aceptas ${offer.label} de ${fromName}.`, `${c.name} acepta ${offer.label} de ${from.name}.`, `${c.name} acepta lo que le ofreces: ${offer.label}.`);
    return done({ ok: true, text: e.narration_private, event: e });
  }

  /** Ofertas caducadas: fuera, y aviso a los dos (desde el tick). */
  private expireOffers(): void {
    const nowMs = this.now();
    for (const c of this.world.characters.values()) {
      for (const o of (c.offers ?? []).filter((x) => x.expires_real_ms <= nowMs)) {
        dropOffer(this.world, c, o.id);
        const from = this.world.characters.get(o.from_id);
        if (!from) continue;
        this.events.emit({
          actor_id: c.id, action_type: 'offer_expired', also_to: [from.id], narration_private: `Dejas pasar la oferta de ${pcName(this.world, c.id, from)} (${o.label}).`, observable: null,
          tags: ['deterministic', 'party'], payload: { master: null, offer: { id: o.id, to: c.id, label: o.label, answer: 'offer_expired' }, target_character_id: from.id, observable_target: `${c.name} no ha respondido a tu oferta (${o.label}): sigue siendo tuyo.` },
        }, nowMs);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reacciones (reactions.ts, docs/MULTIJUGADOR.md): lo que un PJ le hace a otro lo decide el otro.
  // -------------------------------------------------------------------------

  /** Temporizadores de las peticiones (con reloj real); el tick las caduca también, por si se pierden. */
  private reactionTimers = new Map<Id, NodeJS.Timeout>();
  /** Peticiones que ya están en la cola para resolverse (no se encolan dos veces). */
  private resolvingReactions = new Set<Id>();
  /** Peticiones que pidió el máster en esta acción: se anuncian después de su narración. */
  private unannounced = new Map<Id, Reaction[]>();
  /** Actores cuya narración del máster es el desenlace de una reacción (no se pide otra encima). */
  private reactionOutcome = new Set<Id>();

  /** ¿Está el máster narrando el desenlace de una reacción de este actor? (tools.ts no deja pedir otra.) */
  inReactionOutcome(characterId: Id): boolean { return this.reactionOutcome.has(characterId); }

  /** Lo que el actor intenta sobre otro PJ (reactions.ts), reconocido por el motor; null si no es eso. */
  private tryReaction(c: Character, text: string): ActionResult | null {
    if (c.status !== 'active') return null;
    const intent = parseReaction(this.world, c, text);
    if (!intent) return null;
    const r = this.requestReaction(c.id, intent.target.id, { kind: intent.kind, attempt: intent.attempt, input: text, dest_spot_id: intent.dest_spot_id, prone: intent.prone });
    return r.ok ? r.result : { ok: false, text: r.error };
  }

  /** «Esperando a que Mira decida…» si el actor tiene una petición en el aire; null si no. */
  private reactionWait(c: Character): string | null {
    const p = pendingFrom(this.world, c.id);
    if (!p) return null;
    return `⏳ Esperando a que ${pcName(this.world, c.id, p.to)} decida (quedan ${fmtLeft(p.reaction.expires_real_ms - this.now())}). Mientras, puedes hablar con «Decir».`;
  }

  /**
   * Petición de reacción: un PJ intenta algo sobre otro (agarrarlo, llevárselo,
   * empujarlo, atacarlo). No resuelve nada: el otro ve quién, qué y los botones
   * «Dejarse» y «Resistirse» (o responde con sus palabras); quien actúa espera.
   * Si el otro no puede responder (ausente, dormido, caído), se resuelve en
   * cuanto acabe la acción en curso. La usan el motor (tryReaction) y el máster
   * (request_reaction, y attack contra un PJ); con `announce: false` el evento
   * sale después de la narración del máster.
   */
  requestReaction(fromId: Id, toId: Id, spec: { kind: ReactionKind; attempt: string; input: string | null; dest_spot_id?: Id | null; prone?: boolean; contest?: { actor: string; target: string[] } }, opts: { announce?: boolean } = {}): { ok: true; reaction: Reaction; result: ActionResult } | { ok: false; error: string } {
    const from = this.world.character(fromId);
    const to = this.world.characters.get(toId);
    if (!to || to.id === from.id) return { ok: false, error: 'No hay nadie así aquí.' };
    const toName = pcName(this.world, from.id, to);
    const here = this.world.characterSpot(from);
    const there = this.world.characterSpot(to);
    if (!here || !there || here.location_id !== there.location_id || to.transit) return { ok: false, error: `${toName} no está aquí.` };
    if (to.status === 'dead' || to.status === 'retired') return { ok: false, error: `${toName} ya no está para eso.` };
    if (to.veiled) return { ok: false, error: `${toName} está bajo el velo: su jugador no está y nadie puede tocarle.` };
    const waiting = this.reactionWait(from);
    if (waiting) return { ok: false, error: waiting };
    if (here.id !== there.id) approachSpot(this.world, from, there.id);
    const nowMs = this.now();
    const reaction: Reaction = {
      id: `rx_${nowMs.toString(36)}_${Math.floor(this.rng() * 1e6).toString(36)}`, from_id: from.id, to_id: to.id, kind: spec.kind,
      attempt: spec.attempt.trim().replace(/[.]+$/, ''), input: spec.input, dest_spot_id: spec.dest_spot_id ?? null,
      ...(spec.prone ? { prone: true } : {}), ...(spec.contest ? { contest: spec.contest } : {}),
      created_real_ms: nowMs, expires_real_ms: nowMs + REACTION_TTL_MS,
    };
    to.reactions = [...(to.reactions ?? []), reaction];
    this.world.touch('characters', to.id);
    if (this.realClock) {
      const t = setTimeout(() => this.reactionDue(reaction.id, 'timeout'), REACTION_TTL_MS);
      t.unref?.();
      this.reactionTimers.set(reaction.id, t);
    }
    let result: ActionResult;
    if (opts.announce === false) {
      this.unannounced.set(from.id, [...(this.unannounced.get(from.id) ?? []), reaction]);
      result = { ok: true, text: `Esperando a que ${toName} decida.` };
    } else result = this.announceReaction(reaction);
    // Quien no puede responder no hace esperar a nadie: se resuelve en cuanto acabe lo que esté en curso.
    const unable = this.reactionUnable(to);
    if (unable) this.reactionDue(reaction.id, unable);
    return { ok: true, reaction, result };
  }

  /** Por qué el afectado no puede decidir ahora (dormido, caído, ausente); null si puede. */
  private reactionUnable(to: Character): 'away' | 'helpless' | null {
    if (to.status === 'unconscious' || to.status === 'asleep') return 'helpless';
    return to.away ? 'away' : null;
  }

  /** El evento de la petición: quien actúa espera; el afectado lee quién, qué y lo que escribió, y tiene los botones. */
  private announceReaction(r: Reaction): ActionResult {
    const from = this.world.character(r.from_id);
    const to = this.world.character(r.to_id);
    const toName = pcName(this.world, from.id, to);
    const ToName = toName.charAt(0).toUpperCase() + toName.slice(1);
    const verb = { attack: ['Te lanzas contra', 'se lanza contra'], grapple: ['Alargas las manos hacia', 'alarga las manos hacia'], shove: ['Cargas con el hombro contra', 'carga con el hombro contra'], other: ['Vas a por', 'va a por'] }[r.kind];
    const said = r.input && !r.input.startsWith('(') ? ` Ha escrito: «${r.input.replace(/[«»]/g, '').trim()}».` : '';
    const event = this.events.emit({
      actor_id: from.id, action_type: 'reaction_request', input_text: r.input, also_to: [to.id],
      narration_private: `${verb[0]} ${toName}. ${ToName} decide si se deja o se resiste.`,
      observable: `${from.name} ${verb[1]} ${to.name}.`,
      tags: ['deterministic', 'party', 'reaction', ...(r.kind === 'attack' ? ['combat'] : [])],
      payload: {
        master: null, reaction: { id: r.id, to: to.id, from: from.id, kind: r.kind, attempt: r.attempt, expires_real_ms: r.expires_real_ms },
        target_character_id: to.id,
        observable_target: `${from.name} intenta ${r.attempt}.${said} ¿Te dejas o te resistes? Si no decides a tiempo, te resistes por instinto.`,
        observable_vague: 'Una figura va a por otra.',
      },
    }, this.stampFor(from));
    r.event_id = event.id;
    this.world.touch('characters', to.id);
    return { ok: true, text: event.narration_private, event };
  }

  /** Las peticiones que pidió el máster en esta acción, tras su narración. */
  private announcePending(actorId: Id): void {
    const list = this.unannounced.get(actorId);
    if (!list) return;
    this.unannounced.delete(actorId);
    for (const r of list) if (this.world.characters.get(r.to_id)?.reactions?.some((x) => x.id === r.id)) this.announceReaction(r);
  }

  /** Encola la resolución de una petición (caducada o sin nadie que decida). Una sola vez. */
  private reactionDue(reactionId: Id, how: 'timeout' | 'away' | 'helpless'): void {
    if (this.resolvingReactions.has(reactionId)) return;
    const found = findReaction(this.world, reactionId);
    if (!found) return;
    this.resolvingReactions.add(reactionId);
    const locId = this.world.characterSpot(found.to)?.location_id ?? positionOf(this.world, found.to, this.gameNow()).location_id;
    this.background(this.runInLocation(locId, async () => {
      try { await this.resolveReaction(reactionId, how, null); } finally { this.resolvingReactions.delete(reactionId); }
    }));
  }

  /** Peticiones caducadas (desde el tick): el afectado se resiste por instinto. */
  private expireReactions(): void {
    const nowMs = this.now();
    for (const c of this.world.characters.values()) {
      for (const r of c.reactions ?? []) if (r.expires_real_ms <= nowMs) this.reactionDue(r.id, 'timeout');
    }
  }

  /**
   * El afectado decide: «Dejarse» (accept), «Resistirse» (resist) o sus
   * palabras (`text`: si se leen como un sí, se deja; si no, se resiste y lo
   * dicho acompaña). Entra en la cola del sitio: el desenlace puede llamar al máster.
   */
  async answerReaction(characterId: Id, reactionId: Id, answer: 'accept' | 'resist' | null, text: string | null = null): Promise<ActionResult> {
    const c = this.world.character(characterId);
    this.lastAction.set(c.id, this.now());
    if (!c.connected) this.setConnected(c.id, true);
    const r = c.reactions?.find((x) => x.id === reactionId);
    if (!r || this.resolvingReactions.has(r.id)) return { ok: false, text: 'Eso ya se ha decidido.' };
    const reply = text?.trim().slice(0, 300) || null;
    const how = answer ?? (reply && readsAsAccept(reply) ? 'accept' : 'resist');
    this.resolvingReactions.add(r.id);
    const locId = this.world.characterSpot(c)?.location_id ?? positionOf(this.world, c, this.gameNow()).location_id;
    try {
      return await this.runInLocation(locId, () => this.resolveReaction(r.id, how, reply));
    } finally { this.resolvingReactions.delete(r.id); }
  }

  /**
   * Resuelve una petición: dejarse sale sin tirada; resistirse (o no responder
   * a tiempo, o no estar), con la tirada enfrentada del SRD o el ataque contra
   * la CA. Aplica lo que el motor sabe aplicar (daño, agarrado, derribado,
   * llevárselo a otro sitio), lo cuenta a los dos y, con máster, le pide que
   * narre el desenlace como tras una tirada (el afectado lo lee como testigo).
   */
  private async resolveReaction(reactionId: Id, how: 'accept' | 'resist' | 'timeout' | 'away' | 'helpless', reply: string | null): Promise<ActionResult> {
    const found = findReaction(this.world, reactionId);
    if (!found) return { ok: false, text: 'Eso ya se ha decidido.' };
    const { reaction: r, to } = found;
    dropReaction(this.world, to, r.id);
    const timer = this.reactionTimers.get(r.id);
    if (timer) { clearTimeout(timer); this.reactionTimers.delete(r.id); }
    const from = this.world.characters.get(r.from_id);
    const fromName = from ? pcName(this.world, to.id, from) : 'alguien';
    const From = fromName.charAt(0).toUpperCase() + fromName.slice(1);
    const emit = (type: string, priv: string, obs: string | null, forActor: string, extra: Record<string, unknown> = {}) => this.events.emit({
      actor_id: to.id, action_type: type, input_text: reply, also_to: from ? [from.id] : [], narration_private: priv, observable: obs,
      tags: ['deterministic', 'party', 'reaction', ...(r.kind === 'attack' ? ['combat'] : [])],
      payload: { master: null, reaction: { id: r.id, to: to.id, from: r.from_id, kind: r.kind, answer: how, ...extra }, target_character_id: r.from_id, observable_target: forActor },
    }, this.stampFor(to));
    const done = async (res: ActionResult) => { this.settleAll(this.gameNow()); this.announceDeathStates(); await this.flush(); return res; };
    // Ya no tiene sentido: quien actuaba no está o no puede, o ya no están en la misma sala.
    const mine = this.world.characterSpot(to);
    const theirs = from ? this.world.characterSpot(from) : undefined;
    if (!from || from.status !== 'active' || !mine || !theirs || mine.location_id !== theirs.location_id || from.transit || to.transit || to.status === 'dead') {
      const e = emit('reaction_cancelled', `${From} ya no está para ${r.attempt}: no pasa nada.`, null, `Ya no puedes: ${pcName(this.world, r.from_id, to)} y tú ya no estáis juntos.`);
      return done({ ok: true, text: e.narration_private, event: e });
    }
    if (mine.id !== theirs.id) approachSpot(this.world, from, mine.id);
    const toName = pcName(this.world, from.id, to);
    const ToName = toName.charAt(0).toUpperCase() + toName.slice(1);
    // Cómo decidió, para el afectado [0] y para quien actúa [1].
    const said = reply ? ` «${reply.replace(/[«»]/g, '').replace(/[.]+$/, '')}».` : '';
    const decided = {
      accept: [`Te dejas.${said}`, `${ToName} se deja.${said}`],
      resist: [`Te resistes.${said}`, `${ToName} se resiste.${said}`],
      timeout: ['No respondes a tiempo: te resistes por instinto.', `${ToName} no responde a tiempo: se resiste por instinto.`],
      away: ['No estás: te resistes por instinto.', `${ToName} no está (su jugador se ha ido): se resiste por instinto.`],
      helpless: [`No puedes resistirte (${to.status === 'asleep' ? 'duermes' : 'estás inconsciente'}).`, `${ToName} no puede resistirse (${to.status === 'asleep' ? 'duerme' : 'está inconsciente'}).`],
    }[how] as [string, string];
    const unopposed = how === 'accept' || how === 'helpless';
    let success: boolean;
    let rollMine = '';
    let rollTheirs = '';
    let check: CheckResult & { label: string };
    const effects: string[] = [];
    if (r.kind === 'attack') {
      const atk = resolveAttack(this.world, from.id, to.id, 'none', this.rng, this.nowFor(from), { autoHit: how === 'accept' });
      if ('error' in atk) {
        const e = emit('reaction_cancelled', `${From} no llega a atacarte: ${atk.error}.`, null, `No llegas a atacar: ${atk.error}.`);
        return done({ ok: true, text: e.narration_private, event: e });
      }
      success = atk.hit;
      const dmg = atk.hit ? `${atk.damage} de daño (${atk.damage_breakdown})${atk.target_dead ? '; cae muerto' : atk.target_down ? '; cae' : ''}` : '';
      const roll = atk.attack_breakdown.replace(/ vs CD \d+$/, '');
      rollTheirs = how === 'accept' ? `Te alcanza sin tirada: ${dmg}.` : `Su ataque con ${atk.weapon}: ${roll} contra tu CA ${atk.target_ac}: ${atk.hit ? `te alcanza, ${dmg}` : 'falla'}.`;
      rollMine = how === 'accept' ? `Le alcanzas sin tirada: ${dmg}.` : `Tu ataque con ${atk.weapon}: ${roll} contra su CA ${atk.target_ac}: ${atk.hit ? `le alcanzas, ${dmg}` : 'fallas'}.`;
      if (atk.hit) effects.push(`${to.name} recibe ${atk.damage} de daño (queda a ${atk.target_hp} PG${atk.target_dead ? ', muerto' : atk.target_down ? ', caído' : ''})`);
      check = { label: `Reacción de ${to.name}: ataque con ${atk.weapon}`, expr: 'attack', total: atk.attack_total, rolls: [], d20s: [], modifier: 0, dc: unopposed ? null : atk.target_ac, advantage: 'none', success, breakdown: `${decided[1]} ${rollMine}`, ...(atk.natural ? { natural: atk.natural } : {}) };
    } else if (unopposed) {
      success = true;
      check = { label: `Reacción de ${to.name}`, expr: '', total: 0, rolls: [], d20s: [], modifier: 0, dc: null, advantage: 'none', success: true, breakdown: `${decided[1]} Sin tirada.` };
    } else {
      const k = contest(from, to, r, this.rng, this.takeHelp(from) ? 'advantage' : 'none');
      success = k.success;
      const show = (x: typeof k.actor) => `${x.label} ${x.breakdown}`;
      rollTheirs = `Tirada enfrentada: tu ${show(k.target)}, contra su ${show(k.actor)}: ${success ? `gana ${fromName}` : 'ganas tú'}.`;
      rollMine = `Tirada enfrentada: tu ${show(k.actor)}, contra su ${show(k.target)}: ${success ? 'ganas tú' : `gana ${toName}`}.`;
      check = { ...k.actor, label: `Reacción de ${to.name}: tu ${k.actor.label} enfrentado a su ${k.target.label}`, dc: k.target.total, success, breakdown: `${decided[1]} ${rollMine}` };
    }
    // Lo que el motor sabe aplicar: llevárselo, agarrado, derribado (el daño ya lo aplicó el ataque).
    let dest: string | null = null;
    if (success && r.kind !== 'attack') {
      if (r.dest_spot_id && this.world.spots.has(r.dest_spot_id)) {
        const spot = this.world.spot(r.dest_spot_id);
        const a = moveTo(this.world, to.id, spot.id, 'walk', this.nowFor(to));
        const b = a.ok ? moveTo(this.world, from.id, spot.id, 'walk', this.nowFor(from)) : a;
        if (a.ok && b.ok) {
          this.tripFrom.set(to.id, mine.location_id);
          this.tripFrom.set(from.id, mine.location_id);
          const loc = this.world.location(spot.location_id);
          dest = spot.location_id !== mine.location_id || loc.default_spot_id === spot.id ? loc.name : spot.name;
          effects.push(`los dos van juntos ${aEs(dest)} (ya en camino)`);
        }
      } else if (r.kind === 'grapple') {
        to.conditions = [...to.conditions.filter((x) => x.name !== 'agarrado'), { name: 'agarrado', source: from.name, expires_game_s: this.nowFor(to) + GRAPPLE_S }];
        effects.push(`${to.name} queda agarrado por ${from.name}`);
      } else if (r.kind === 'shove' && r.prone) {
        to.conditions = [...to.conditions.filter((x) => x.name !== 'derribado'), { name: 'derribado', source: from.name, expires_game_s: this.nowFor(to) + PRONE_S }];
        effects.push(`${to.name} queda en el suelo (derribado)`);
      }
      this.world.touch('characters', to.id);
    }
    // El desenlace: para el afectado, para quien actúa y para los demás.
    const outcome: [string, string, string] = r.kind === 'attack'
      ? [success ? '' : `Esquivas el ataque de ${fromName}.`, success ? '' : `${ToName} esquiva tu ataque.`, success ? `${from.name} alcanza a ${to.name}.` : `${to.name} esquiva el ataque de ${from.name}.`]
      : success
        ? [`${From} consigue ${r.attempt}.`, dest ? `Os vais juntos ${aEs(dest)}.` : 'Lo consigues.', dest ? `${from.name} se lleva a ${to.name} ${aEs(dest)}.` : `${from.name} se sale con la suya con ${to.name}.`]
        : [`${From} no consigue ${r.attempt}.`, 'No lo consigues.', `${to.name} se resiste a ${from.name} y se libra.`];
    const join = (...xs: string[]) => xs.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const e = emit(unopposed ? 'reaction_accepted' : 'reaction_resisted',
      join(decided[0], rollTheirs, outcome[0]), outcome[2], join(decided[1], rollMine, outcome[1]), { success, ...(dest ? { dest } : {}) });
    // Con máster: narra el desenlace para quien actuaba, como tras una tirada.
    if (this.master) {
      check.breakdown = `${check.breakdown}${effects.length ? ` Ya aplicado por el servidor (no lo repitas): ${effects.join('; ')}.` : ''} ${to.name} es otro jugador y ya ha decidido: narra el desenlace sin ponerle palabras, gestos ni intenciones que no estén aquí, y no pidas otra reacción para esto.`;
      this.reactionOutcome.add(from.id);
      try { await this.resolveWithMaster(from, r.input ?? `(intenta ${r.attempt})`, { original_text: r.input ?? r.attempt, result: check }); } finally { this.reactionOutcome.delete(from.id); }
    }
    return done({ ok: true, text: e.narration_private, event: e });
  }

  /**
   * Seguir (party.ts): quien sigue a un líder que se ha puesto en camino sale
   * tras él hacia el mismo sitio, al mismo paso. Si no puede (salida cerrada para
   * él, el líder en otra sala, dormido), deja de seguirle y se le dice por qué.
   */
  private syncFollowers(nowGameS: number): void {
    for (const f of this.world.characters.values()) {
      if (!f.following) continue;
      const leader = this.world.characters.get(f.following);
      const stop = (why: string) => {
        f.following = null;
        this.world.touch('characters', f.id);
        this.events.emit({ actor_id: f.id, action_type: 'unfollow', narration_private: why, observable: null, tags: ['deterministic', 'party'], payload: { master: null } }, this.stampFor(f));
      };
      if (!leader || leader.status === 'dead' || leader.status === 'retired') { stop('Ya no tienes a quién seguir.'); continue; }
      const t = leader.transit;
      if (!t || f.status !== 'active') continue;
      if (f.transit?.destination_spot_id === t.destination_spot_id) continue;
      const name = pcName(this.world, f.id, leader);
      const origin = this.world.spot(t.origin_spot_id).location_id;
      if (positionOf(this.world, f, nowFor(f, nowGameS)).location_id !== origin) { stop(`Pierdes de vista a ${name}: dejas de seguirle.`); continue; }
      const res = moveTo(this.world, f.id, t.destination_spot_id, t.pace, nowFor(f, nowGameS));
      if (!res.ok) { stop(`No puedes seguir a ${name}: ${moveErrorText(this.world, res.error).replace(/\.$/, '')}. Te quedas aquí.`); continue; }
      this.tripFrom.set(f.id, this.world.characterSpot(f)?.location_id ?? origin);
      const dest = this.world.spot(t.destination_spot_id);
      const crossing = dest.location_id !== origin;
      this.events.emit({
        actor_id: f.id, action_type: 'follow_move', narration_private: `Sigues a ${name} hacia ${crossing ? this.world.location(dest.location_id).name : dest.name}.`,
        observable: `${f.name} sigue a ${leader.name}.`, tags: ['deterministic', 'movement', 'party'],
        payload: { master: null, target_character_id: leader.id, observable_target: `${f.name} va detrás de ti.`, observable_vague: 'Una figura va detrás de otra.' },
      }, this.stampFor(f));
    }
  }

  /** Ayuda vigente de otro PJ (y la consume): ventaja para esta tirada. */
  private takeHelp(c: Character): Character | null {
    const h = c.helped_by;
    if (!h) return null;
    c.helped_by = null;
    this.world.touch('characters', c.id);
    const helper = this.world.characters.get(h.character_id);
    return helper && h.expires_game_s >= this.nowFor(c) ? helper : null;
  }

  /**
   * Los PJ de una misma partida se conocen siempre por su nombre, sin presentarse
   * (docs/MULTIJUGADOR.md): al arrancar (migra las partidas de antes) y al entrar uno nuevo.
   */
  meetAll(): void {
    const pcs = [...this.world.characters.values()].filter((c) => c.status !== 'retired');
    for (const c of pcs) {
      const missing = pcs.filter((o) => o.id !== c.id && !c.knows.includes(o.id));
      if (!missing.length) continue;
      c.knows.push(...missing.map((o) => o.id));
      this.world.touch('characters', c.id);
    }
  }

  // -------------------------------------------------------------------------
  // Desconexiones (docs/MULTIJUGADOR.md, «Desconexiones»): el PJ del que se va se queda, ausente.
  // -------------------------------------------------------------------------

  /** Rondas seguidas que un ausente lleva dudando (a la segunda sale de la ronda). */
  private awayHesitations = new Map<Id, number>();
  static readonly AWAY_ROUNDS_OUT = 2;

  /**
   * El jugador se va (sin pestañas pasado el margen) o vuelve. Su PJ se queda
   * donde estaba, ausente: los presentes lo leen en el hilo; sale de la
   * conversación de grupo y de las colas de turno; quien le seguía deja de
   * hacerlo y él deja de seguir; las ofertas pendientes con él se cancelan.
   * A los 30 min llega el velo (setPresence/setConnected, SPEC §9.1).
   */
  setAway(characterId: Id, away: boolean): void {
    const c = this.world.characters.get(characterId);
    if (!c || c.status === 'dead' || c.status === 'retired' || Boolean(c.away) === away) return;
    const spot = this.world.characterSpot(c);
    const present = spot ? this.world.charactersInLocation(spot.location_id).filter((o) => o.id !== c.id && o.status !== 'dead' && o.status !== 'retired').map((o) => o.id) : [];
    const at = spot ? { spot_id: spot.id, next_spot_id: null, progress: 0, x: spot.x, y: spot.y, location_id: spot.location_id } : undefined;
    if (!away) {
      c.away = null;
      this.awayHesitations.delete(c.id);
      this.world.touch('characters', c.id);
      if (at) this.events.emit({ actor_id: c.id, at, action_type: 'back', narration_private: '', observable: `${c.name} ha vuelto.`, also_to: present, tags: ['presence'], payload: { master: null } }, this.now());
      this.background(this.flush());
      return;
    }
    c.away = { since_real_ms: this.now(), since_game_s: this.gameNow(), spot_id: spot?.id ?? null };
    this.world.touch('characters', c.id);
    // Se va mientras cae: queda estable, no muere ausente.
    if (isDying(c)) { stabilizeIfAway(this.world, c, this.nowFor(c)); this.announceDeathStates(); }
    if (at) {
      this.events.emit({
        actor_id: c.id, at, action_type: 'away', narration_private: '', also_to: present, tags: ['presence'],
        observable: `${c.name} se ha ido; su personaje se queda ${spot ? `en ${spot.name}` : 'donde estaba'}.`, payload: { master: null },
      }, this.now());
    }
    // Conversación de grupo y colas: fuera; el NPC sigue con los que quedan.
    this.leaveTalk(c, false);
    // Ronda abierta en su sitio: si solo faltaba él, se cierra ya (no se espera al temporizador).
    const round = spot ? this.rounds.get(spot.location_id) : undefined;
    if (spot && round) {
      if (round.items.size && this.roundComplete(spot.location_id, round)) void this.flushRound(spot.location_id);
      else this.notifyScene(this.roundNotice(spot.location_id, round, true));
    }
    // Seguir: quien le seguía deja de hacerlo, con aviso; él se queda donde está.
    if (c.following) { c.following = null; this.world.touch('characters', c.id); }
    for (const f of this.world.characters.values()) {
      if (f.following !== c.id) continue;
      f.following = null;
      this.world.touch('characters', f.id);
      this.events.emit({ actor_id: f.id, action_type: 'unfollow', narration_private: `${pcName(this.world, f.id, c).replace(/^./, (x) => x.toUpperCase())} se ha ido: dejas de seguirle.`, observable: null, tags: ['deterministic', 'party'], payload: { master: null } }, this.stampFor(f));
    }
    // Ofertas pendientes con él, en cualquier sentido: se cancelan y se avisa a los dos.
    for (const to of this.world.characters.values()) {
      for (const o of [...(to.offers ?? [])]) {
        if (o.to_id !== c.id && o.from_id !== c.id) continue;
        dropOffer(this.world, to, o.id);
        const from = this.world.characters.get(o.from_id);
        if (!from) continue;
        const other = from.id === c.id ? to : from;
        this.events.emit({
          actor_id: other.id, action_type: 'offer_cancelled', also_to: [c.id], tags: ['deterministic', 'party'],
          narration_private: `La oferta ${from.id === c.id ? `de ${pcName(this.world, other.id, c)}` : `que le hiciste a ${pcName(this.world, other.id, c)}`} (${o.label}) se cancela: se ha ido.`,
          observable: null, payload: { master: null, offer: { id: o.id, to: to.id, label: o.label, answer: 'offer_cancelled' }, target_character_id: c.id, observable_target: `Tu oferta pendiente (${o.label}) se canceló al irte.` },
        }, this.now());
      }
    }
    // Reacciones: la que él esperaba se retira; las que le piden a él, se resisten por instinto ya (no hace esperar a nadie).
    const mine = pendingFrom(this.world, c.id);
    if (mine) {
      dropReaction(this.world, mine.to, mine.reaction.id);
      this.events.emit({
        actor_id: mine.to.id, action_type: 'reaction_cancelled', also_to: [c.id], tags: ['deterministic', 'party', 'reaction'], observable: null,
        narration_private: `${pcName(this.world, mine.to.id, c).replace(/^./, (x) => x.toUpperCase())} se ha ido: ya no intenta ${mine.reaction.attempt}.`,
        payload: { master: null, reaction: { id: mine.reaction.id, to: mine.to.id, from: c.id, kind: mine.reaction.kind, answer: 'cancelled' }, target_character_id: c.id, observable_target: 'Lo que intentabas con otro jugador se retira al irte.' },
      }, this.now());
    }
    for (const r of [...(c.reactions ?? [])]) this.reactionDue(r.id, 'away');
    this.background(this.flush());
  }

  /** PJ que cuentan para cerrar una ronda: los presentes, menos los ausentes que ya han dudado AWAY_ROUNDS_OUT rondas seguidas. */
  private roundMembers(locationId: Id): Character[] {
    return presentPcs(this.world, locationId).filter((p) => !(p.away && (this.awayHesitations.get(p.id) ?? 0) >= Engine.AWAY_ROUNDS_OUT));
  }

  // -------------------------------------------------------------------------
  // Varios a la vez en el mismo sitio (scene.ts): turno con el NPC, conversación de grupo y rondas.
  // -------------------------------------------------------------------------

  /** Quien espera turno con cada NPC, en orden (en memoria: un reinicio vacía las colas). */
  private turnQueue = new Map<Id, Id[]>();
  /** Frases de una conversación de grupo que se juntan antes de llamar al máster, por NPC. */
  private batches = new Map<Id, Batch>();
  /** Ronda abierta por localización (escena tensa con varios PJ) y número de la última. */
  private rounds = new Map<Id, Round>();
  private roundNo = new Map<Id, number>();
  /** Quién comparte el turno que está narrando el máster (grupo o ronda), por actor. */
  private sharing = new Map<Id, { ids: Id[]; inputs: Record<Id, string> }>();
  private sceneListeners: SceneListener[] = [];

  /** La web pinta el banner de ronda con esto. */
  onScene(l: SceneListener): () => void {
    this.sceneListeners.push(l);
    return () => { this.sceneListeners = this.sceneListeners.filter((x) => x !== l); };
  }

  /** Ronda abierta en una localización (para la web al conectar). */
  roundIn(locationId: Id): SceneNotice | null {
    const r = this.rounds.get(locationId);
    return r ? this.roundNotice(locationId, r, true) : null;
  }

  private roundNotice(locationId: Id, r: Round, open: boolean): SceneNotice {
    const present = this.roundMembers(locationId);
    return { kind: 'round', location_id: locationId, n: r.n, acted: [...r.items.keys()], waiting: present.filter((p) => !p.away && !r.items.has(p.id)).map((p) => p.id), deadline_ms: r.deadline_ms, open };
  }

  private notifyScene(n: SceneNotice): void { for (const l of this.sceneListeners) l(n); }

  /**
   * Antes de la cola: ronda en escena tensa, conversación de grupo, NPC ocupado
   * con otro PJ, esperar turno, unirse o dejar la conversación. null si la acción
   * sigue el camino de siempre.
   */
  private sceneRoute(c: Character, text: string): Promise<ActionResult> | null {
    if (!this.master || c.status !== 'active' || Engine.MECHANICAL.test(text)) return null;
    const nowG = this.nowFor(c);
    const locId = positionOf(this.world, c, nowG).location_id;
    const events = this.events.recentInLocation(locId, 60);
    // Escena tensa con dos o más jugadores: todo va a la ronda (sin contar a los ausentes que ya salieron de ella).
    if (this.rounds.has(locId) || (tenseScene(this.world, locId, this.recentTags([locId])) && this.roundMembers(locId).length >= 2)) return this.joinRound(c, text, locId);
    if (isLeaveTalk(text)) return Promise.resolve(this.leaveTalk(c, true));
    // Esperar o unirse, con el botón o con sus palabras: sin máster y sin repetir el gesto del NPC.
    const turn = parseTurn(text);
    if (turn && (!turn.loose || this.busyNpcFor(c, turn.who, events, nowG))) return Promise.resolve(this.takeTurn(c, turn.kind, turn.who, events, nowG));
    const current = talkingWith(this.world, events, c, nowG);
    const target = npcTarget(this.world, events, c, text, nowG);
    // Moverse o dirigirse a otro NPC: deja la conversación en la que estaba.
    if (current && (this.isMove(c, text) || parseTravel(text) || (target && target.id !== current.id))) this.leaveTalk(c, false);
    if (!target || this.isMove(c, text)) return null;
    const talkers = talkersOf(this.world, events, target, nowG);
    if (talkers.length && !talkers.includes(c.id)) {
      // Ya en la cola: no se repite el gesto; se le recuerda que espera.
      if (this.turnQueue.get(target.id)?.includes(c.id)) return Promise.resolve(this.emitScene(c, text, 'npc_wait', `Sigues esperando tu turno con ${this.npcLabel(c, target)}.`, null, [`Unirme a la conversación con ${this.npcLabel(c, target)}`], { npc_id: target.id }));
      return Promise.resolve(this.npcBusy(c, target, talkers, text));
    }
    if (talkers.includes(c.id) && talkers.length > 1) return this.groupTalk(c, target, text, talkers);
    return null;
  }

  private npcLabel(c: Character, n: Npc): string {
    return c.knows.includes(n.id) ? n.name : descriptorOf(this.world, n.id);
  }

  /** Evento sin máster con sus propias opciones. */
  private emitScene(c: Character, input: string | null, type: string, priv: string, obs: string | null, suggested: string[], extra: Record<string, unknown> = {}): ActionResult {
    const event = this.events.emit({
      actor_id: c.id, action_type: type, input_text: input, narration_private: priv, observable: obs, tags: ['deterministic', 'social', 'scene'],
      payload: { master: null, suggested_actions: suggested, ...extra },
    }, this.stampFor(c));
    return { ok: true, text: priv, event, suggested_actions: suggested };
  }

  /** El NPC ocupado con otro PJ al que se refiere el texto (o el único ocupado de la sala). */
  private busyNpcFor(c: Character, who: string, events: readonly GameEvent[], nowG: number): Npc | null {
    const busy = npcsHere(this.world, c).filter((n) => { const t = talkersOf(this.world, events, n, nowG); return t.length > 0 && !t.includes(c.id); });
    const named = who ? namedNpc(this.world, c, who) : null;
    if (named) return busy.includes(named) ? named : null;
    return busy.length === 1 ? busy[0]! : null;
  }

  /** El NPC está con otro PJ: no se llama al máster; un gesto y dos botones. */
  private npcBusy(c: Character, n: Npc, talkers: Id[], input: string): ActionResult {
    const who = talkers.map((id) => pcName(this.world, c.id, this.world.character(id)));
    const label = this.npcLabel(c, n);
    const Label = label.charAt(0).toUpperCase() + label.slice(1);
    return this.emitScene(c, input, 'npc_busy', `${Label} está con ${who.join(' y ')}; te hace un gesto para que esperes.`,
      `${c.name} espera a que ${n.name} termine.`, [`Esperar turno con ${label}`, `Unirme a la conversación con ${label}`], { npc_id: n.id, notice_for_others: true });
  }

  /** «Esperar turno» (cola real: aviso cuando quede libre) o «Unirme a la conversación». */
  private takeTurn(c: Character, kind: 'wait' | 'join', who: string, events: readonly GameEvent[], nowG: number): ActionResult {
    const named = who ? namedNpc(this.world, c, who) : null;
    const busy = npcsHere(this.world, c).filter((n) => talkersOf(this.world, events, n, nowG).length > 0);
    const n = named ?? (busy.length === 1 ? busy[0]! : null);
    if (!n) return { ok: false, text: '¿Con quién?' };
    const label = this.npcLabel(c, n);
    const talkers = talkersOf(this.world, events, n, nowG);
    if (!talkers.length || talkers.includes(c.id)) {
      if (talkers.includes(c.id)) return { ok: false, text: `Ya estás hablando con ${label}.` };
      this.turnQueue.delete(n.id);
      return this.emitScene(c, null, 'npc_free', `${label.charAt(0).toUpperCase()}${label.slice(1)} ya puede atenderte.`, null, [`Hablar con ${label}`], { npc_id: n.id });
    }
    const names = talkers.map((id) => pcName(this.world, c.id, this.world.character(id))).join(' y ');
    if (kind === 'wait') {
      const q = this.turnQueue.get(n.id) ?? [];
      if (!q.includes(c.id)) q.push(c.id);
      this.turnQueue.set(n.id, q);
      return this.emitScene(c, null, 'npc_wait', `Esperas tu turno con ${label}, a un paso. Te aviso cuando pueda atenderte.`, `${c.name} espera su turno con ${n.name}.`, [`Unirme a la conversación con ${label}`], { npc_id: n.id, notice_for_others: true });
    }
    n.talking_to = { ...n.talking_to!, with: [...new Set([...(n.talking_to!.with ?? []), c.id])] };
    const q = this.turnQueue.get(n.id);
    if (q?.includes(c.id)) q.splice(q.indexOf(c.id), 1);
    this.world.touch('npcs', n.id);
    const main = this.world.character(talkers[0]!);
    return this.emitScene(c, null, 'npc_join', `Te unes a la conversación de ${names} con ${label}. Lo que digáis a la vez se lo responde de una.`,
      `${c.name} se une a la conversación con ${n.name}.`, [], { npc_id: n.id, target_character_id: main.id, observable_target: `${c.name} se une a vuestra conversación con ${n.name}.` });
  }

  /** Deja la conversación (al irse, al hablar con otro o a petición). Si llevaba la charla, pasa al siguiente unido. */
  private leaveTalk(c: Character, explicit: boolean): ActionResult {
    const nowG = this.nowFor(c);
    const events = this.events.recentInLocation(positionOf(this.world, c, nowG).location_id, 60);
    let left: Npc | null = null;
    for (const n of this.world.npcs.values()) {
      const t = n.talking_to;
      if (!t || (t.character_id !== c.id && !t.with?.includes(c.id))) continue;
      const rest = (t.with ?? []).filter((id) => id !== c.id);
      n.talking_to = t.character_id === c.id ? (rest.length ? { character_id: rest[0]!, since_game_s: nowG, ...(rest.length > 1 ? { with: rest.slice(1) } : {}) } : null) : { ...t, with: rest };
      this.world.touch('npcs', n.id);
      left = n;
    }
    for (const q of this.turnQueue.values()) { const i = q.indexOf(c.id); if (i >= 0) q.splice(i, 1); }
    // Primero se cuenta que se va; después, al que esperaba, que ya le toca.
    let r: ActionResult = { ok: true, text: '' };
    if (explicit) r = left ? this.emitScene(c, null, 'npc_leave', `Dejas la conversación con ${this.npcLabel(c, left)}.`, `${c.name} deja la conversación con ${left.name}.`, []) : { ok: false, text: 'No estás hablando con nadie.' };
    this.serveQueues();
    return r;
  }

  /** NPC que han quedado libres: el primero que esperaba pasa a tener su turno guardado y se le avisa. */
  private serveQueues(): void {
    for (const [npcId, q] of this.turnQueue) {
      const n = this.world.npcs.get(npcId);
      if (!n || n.status !== 'alive') { this.turnQueue.delete(npcId); continue; }
      const loc = this.world.spot(n.location.id).location_id;
      const nowG = this.gameNow();
      if (talkersOf(this.world, this.events.recentInLocation(loc, 60), n, nowG).length) continue;
      while (q.length) {
        const c = this.world.characters.get(q.shift()!);
        if (!c || c.status !== 'active' || this.world.characterSpot(c)?.location_id !== loc) continue;
        n.talking_to = { character_id: c.id, since_game_s: this.nowFor(c), reserved: true };
        this.world.touch('npcs', n.id);
        const label = this.npcLabel(c, n);
        this.emitScene(c, null, 'npc_free', `${label.charAt(0).toUpperCase()}${label.slice(1)} ya puede atenderte.`, null, [`Hablar con ${label}`], { npc_id: n.id });
        break;
      }
      if (!q.length) this.turnQueue.delete(npcId);
    }
  }

  /**
   * Conversación de grupo: las frases dirigidas al NPC dentro de la ventana
   * (GROUP_WINDOW_MS) se juntan y el máster responde una vez a todas. Se cierra
   * antes si ya han hablado todos. Todos reciben la misma respuesta.
   */
  private groupTalk(c: Character, n: Npc, text: string, members: Id[]): Promise<ActionResult> {
    let b = this.batches.get(n.id);
    if (!b) {
      let resolve!: (r: ActionResult) => void;
      const done = new Promise<ActionResult>((r) => { resolve = r; });
      b = { items: [], done, resolve, timer: setTimeout(() => void this.flushBatch(n.id), this.groupWindowMs), members };
      this.batches.set(n.id, b);
    }
    const prev = b.items.find((i) => i.id === c.id);
    if (prev) prev.text = `${prev.text} / ${text}`; else b.items.push({ id: c.id, text });
    if (b.members.every((id) => b!.items.some((i) => i.id === id))) void this.flushBatch(n.id);
    return b.done;
  }

  private async flushBatch(npcId: Id): Promise<void> {
    const b = this.batches.get(npcId);
    if (!b) return;
    this.batches.delete(npcId);
    clearTimeout(b.timer);
    const n = this.world.npc(npcId);
    const actor = this.world.character(b.items[0]!.id);
    const members = b.items.map((i) => ({ id: i.id, name: this.world.character(i.id).name, text: i.text }));
    const ids = [...new Set([...b.members, ...b.items.map((i) => i.id)])];
    const text = `(conversación de grupo con ${n.name}) ${members.map((m) => `${m.name}: ${m.text}`).join(' / ')}`;
    const r = await this.shared(actor, ids, Object.fromEntries(b.items.map((i) => [i.id, i.text])), text, { hooks: [], encounter: null, group: { npc_id: n.id, members } });
    b.resolve(r);
  }

  /**
   * Ronda (escena tensa con varios PJ): cada presente manda su acción; cuando han
   * actuado todos o vence ROUND_MS, el máster resuelve la ronda entera. Quien no
   * actuó duda y pierde la ronda, sin bloquear a nadie.
   */
  private joinRound(c: Character, text: string, locId: Id): Promise<ActionResult> {
    let r = this.rounds.get(locId);
    if (!r) {
      let resolve!: (x: ActionResult) => void;
      const done = new Promise<ActionResult>((x) => { resolve = x; });
      const n = (this.roundNo.get(locId) ?? 0) + 1;
      this.roundNo.set(locId, n);
      r = { n, items: new Map(), done, resolve, deadline_ms: Date.now() + this.roundMs, timer: setTimeout(() => void this.flushRound(locId), this.roundMs) };
      this.rounds.set(locId, r);
    }
    if (r.items.has(c.id)) return Promise.resolve({ ok: false, text: `Ya has actuado en la ronda ${r.n}: espera a que se resuelva.` });
    r.items.set(c.id, text);
    this.notifyScene(this.roundNotice(locId, r, true));
    this.awayHesitations.delete(c.id);
    if (this.roundComplete(locId, r)) void this.flushRound(locId);
    return r.done;
  }

  /** ¿Han actuado todos los que se esperan? Al ausente no se le espera: duda al cerrarse la ronda. */
  private roundComplete(locId: Id, r: Round): boolean {
    return this.roundMembers(locId).every((p) => p.away || r.items.has(p.id));
  }

  private async flushRound(locId: Id): Promise<void> {
    const r = this.rounds.get(locId);
    if (!r) return;
    this.rounds.delete(locId);
    clearTimeout(r.timer);
    const present = this.roundMembers(locId);
    this.notifyScene({ ...this.roundNotice(locId, r, false), waiting: [] });
    const members = [...r.items].map(([id, text]) => ({ id, name: this.world.character(id).name, text }));
    const hesitant = present.filter((p) => !r.items.has(p.id));
    // El ausente duda y no bloquea; tras AWAY_ROUNDS_OUT rondas seguidas, sale de la ronda.
    for (const h of hesitant) if (h.away) this.awayHesitations.set(h.id, (this.awayHesitations.get(h.id) ?? 0) + 1);
    for (const m of members) { const c = this.world.character(m.id); if (c.decisive) this.closeDecisive(c); }
    // Caídos en el sitio: una salvación contra muerte por ronda (y no por minuto mientras haya rondas).
    for (const d of this.world.charactersInLocation(locId)) if (isDying(d)) this.deathSave(d, this.nowFor(d));
    this.announceDeathStates();
    const actor = this.world.character(members[0]!.id);
    const text = `(ronda ${r.n}) ${members.map((m) => `${m.name}: ${m.text}`).join(' / ')}${hesitant.length ? ` / dudan: ${hesitant.map((h) => h.name).join(', ')}` : ''}`;
    const res = await this.shared(actor, [...members.map((m) => m.id), ...hesitant.map((h) => h.id)], Object.fromEntries(r.items), text,
      { hooks: [], encounter: null, round: { n: r.n, members, hesitant: hesitant.map((h) => ({ id: h.id, name: h.name })) } });
    r.resolve(res);
  }

  /** Un turno compartido (grupo o ronda): una llamada al máster, en la cola del sitio, que reciben todos. */
  private shared(actor: Character, ids: Id[], inputs: Record<Id, string>, text: string, hints: SceneHints): Promise<ActionResult> {
    const locId = positionOf(this.world, actor, this.gameNow()).location_id;
    return this.runInLocation(locId, async () => {
      this.sharing.set(actor.id, { ids, inputs });
      let r: ActionResult;
      try { r = await this.resolveWithHints(actor, text, hints); } finally { this.sharing.delete(actor.id); }
      if (!r.ok && r.text === '') r = { ok: false, text: 'El narrador no responde ahora mismo. Espera un momento y vuelve a intentarlo.' };
      this.settleAll(this.gameNow());
      this.advanceStory(this.gameNow());
      this.announceDeathStates();
      await this.flush();
      return r;
    });
  }

  // -------------------------------------------------------------------------
  // Descanso, caída, muerte y vuelta (rest.ts, death.ts; issue #23). Sin IA.
  // -------------------------------------------------------------------------

  /** Cómo está quien no puede actuar (a 0 PG o muerto) y qué le espera. */
  downText(c: Character): string {
    if (c.status === 'dead' && c.death) {
      const left = Math.max(0, c.death.respawn_real_ms - this.now());
      const back = this.world.spot(respawnSpotId(this.world)).name;
      return c.death.respawn_real_ms
        ? `☠ Has muerto. Volverás en ${back} dentro de ${fmtDuration(left / 1000)} reales (${fmtDuration(this.clock.realToGame(left / 1000))} de juego). Mientras, solo puedes mirar.`
        : '☠ Has muerto.';
    }
    if (isStable(c)) {
      const until = c.dying?.stable_until_game_s;
      return `Estás inconsciente pero estable.${until ? ` Recobrarás el sentido con 1 PG hacia las ${hhmm(until)}.` : ''} Si alguien te cura, despiertas antes.`;
    }
    const d = c.dying;
    return `Estás inconsciente, a 0 PG. El servidor tira tus salvaciones contra muerte${d ? ` (éxitos ${d.success}/3 · fallos ${d.fail}/3)` : ''}: tres éxitos te estabilizan, tres fallos te matan. Otro jugador puede estabilizarte (Medicina CD 10) o curarte.`;
  }

  /** ¿Hay amenaza en el sitio del PJ (un NPC hostil vivo o combate reciente)? */
  private threatAt(c: Character): boolean {
    const locId = this.world.characterSpot(c)?.location_id;
    if (!locId) return false;
    const hostile = [...this.world.npcs.values()].some((n) => n.status === 'alive' && n.stats && this.world.spot(n.location.id).location_id === locId && Object.values(n.attitude.by_character).concat(n.attitude.default).includes('hostile'));
    return hostile || this.recentTags([locId]).some((t) => t === 'combat' || t === 'danger' || t === 'threat');
  }

  // --- Descansar ------------------------------------------------------------

  /** «dormir», «descanso corto»…: el descanso entero, con el reloj del PJ adelantado. null si no es un descanso. */
  private async tryRest(c: Character, text: string): Promise<ActionResult | null> {
    const intent = parseRest(text);
    if (!intent || c.status !== 'active') return null;
    const nowG = this.nowFor(c);
    const no = cannotRest(c, intent.kind, nowG);
    if (no) return { ok: false, text: no };
    if (this.threatAt(c) || c.decisive) return { ok: false, text: 'No puedes descansar con una amenaza delante. Aléjate o acaba con ella primero.' };
    if (c.transit) interruptTransit(this.world, c, nowG);
    this.leaveTalk(c, false);
    const plan = planRest(this.world, this.clock, c, intent.kind, nowG, this.rng);
    const res = this.applyPlan(c, plan, intent.dice);
    const spot = this.world.characterSpot(c)!;
    const r = this.emitTrivial(c, text, intent.kind === 'long' ? 'sleep' : 'rest', 'rest', this.restText(c, plan, res),
      plan.interruption ? `${c.name} se acomoda para ${intent.kind === 'long' ? 'dormir' : 'descansar'}.` : `${c.name} ${intent.kind === 'long' ? 'duerme' : 'descansa'} un rato en ${spot.name}.`,
      'Una figura se acomoda para descansar.', undefined, { rest: { kind: plan.kind, completed: res.completed, healed: res.healed, dice_spent: res.dice_spent, recovered: res.recovered, safe: plan.safe, interrupted: plan.interruption?.kind ?? null } });
    const cut = plan.interruption;
    if (!cut || !this.master) return r;
    // Lo que le despierta lo narra el máster si lo hay (sin él, la plantilla ya lo dice).
    const m = await this.resolveWithHints(c, `(mientras ${plan.kind === 'long' ? 'duerme' : 'descansa'}, le despierta algo: ${cut.teaser})`, { hooks: [], encounter: { chance: cut.chance, roll: cut.roll }, rest: { kind: plan.kind, what: cut.what, teaser: cut.teaser } });
    return m.ok || m.text !== '' ? m : r;
  }

  /** Aplica el plan y mueve el reloj del PJ hasta donde llegó el descanso. */
  private applyPlan(c: Character, plan: RestPlan, dice: number | null = null): ReturnType<typeof applyRest> {
    const res = applyRest(this.world, c, plan, this.rng, dice ? { dice } : {});
    setAhead(c, res.end_game_s, this.gameNow());
    this.world.touch('characters', c.id);
    return res;
  }

  private restText(c: Character, plan: RestPlan, res: ReturnType<typeof applyRest>): string {
    const spot = this.world.characterSpot(c)!;
    const where = plan.safe ?? spot.name;
    const until = hhmm(res.end_game_s);
    const rec = res.recovered.length ? ` Vuelves a tener ${res.recovered.join(', ')}.` : '';
    if (plan.interruption) {
      return `Te acomodas en ${where} para ${plan.kind === 'long' ? 'dormir' : 'descansar'}, pero a las ${until} algo te despierta: ${plan.interruption.teaser.replace(/^./, (x) => x.toLowerCase())} El descanso queda a medias y no te cura.${rec}`;
    }
    if (plan.kind === 'long') {
      return `Duermes ocho horas en ${where}${plan.safe ? ', sin que nadie te moleste' : ''}. Te levantas a las ${until}${res.healed ? ` con todos tus PG (${c.hp_current}/${c.hp_max})` : ', descansado'}${res.dice_regained ? ` y recuperas ${res.dice_regained} ${res.dice_regained === 1 ? 'dado' : 'dados'} de golpe` : ''}.${rec}`;
    }
    const heal = res.dice_spent ? ` Gastas ${res.dice_spent} ${res.dice_spent === 1 ? 'dado' : 'dados'} de golpe y recuperas ${res.healed} PG (${c.hp_current}/${c.hp_max}).`
      : c.hp_current < c.hp_max ? ' No te quedan dados de golpe para curarte: hará falta un descanso largo.' : '';
    return `Descansas una hora en ${where}; son las ${until}.${heal}${rec}`;
  }

  /** El tool take_rest: el mismo descanso, contado al máster para que lo narre. */
  restByMaster(c: Character, kind: RestKind): Record<string, unknown> | { error: string } {
    const nowG = this.nowFor(c);
    const no = cannotRest(c, kind, nowG);
    if (no) return { error: no };
    if (this.threatAt(c)) return { error: 'hay una amenaza delante: no puede descansar' };
    const plan = planRest(this.world, this.clock, c, kind, nowG, this.rng);
    const res = this.applyPlan(c, plan);
    return {
      ok: true, kind, completed: res.completed, until: hhmm(res.end_game_s), hp: `${c.hp_current}/${c.hp_max}`, healed: res.healed,
      dice_spent: res.dice_spent, dice_regained: res.dice_regained, recovered: res.recovered, safe: plan.safe,
      ...(plan.interruption ? { interrupted_by: plan.interruption.what, note: 'Le despiertan a medias: narra eso; el descanso no le cura.' } : {}),
    };
  }

  // --- Atender y saquear ----------------------------------------------------

  private static readonly TEND = /^(?:estabilizar|estabilizo|estabiliza|atender|atiendo|socorrer|socorro|reanimar|reanimo|taponar la herida de|primeros auxilios a)\s+(?:a\s+)?(.+)$/i;
  private static readonly LOOT = /^(?:saquear|saqueo|registrar|registro|rebuscar en|rebusco en|recoger|recojo|recuperar|recupero|coger|cojo)\s+(.+)$/i;

  private isDeathAction(c: Character, text: string): boolean {
    return Engine.TEND.test(text.trim()) || this.lootTarget(c, text.trim()) !== null;
  }

  /** «mis cosas», «el cuerpo de Mira», «a Mira»: a quién se refiere, o null si no es saquear. */
  private lootTarget(c: Character, text: string): { owner: Character | null; name: string; explicit: boolean } | null {
    const m = Engine.LOOT.exec(text);
    if (!m) return null;
    const what = m[1]!.trim().toLowerCase().replace(/[.!]+$/, '');
    if (/^(mis cosas|mi cuerpo|lo m[ií]o|mis pertenencias)$/.test(what)) return { owner: c, name: c.name, explicit: true };
    const explicit = /^(el cuerpo de|el cad[aá]ver de|las cosas de|las pertenencias de|lo de)\s+/.test(what) || /^saque/i.test(text);
    const name = what.replace(/^(el cuerpo de|el cad[aá]ver de|las cosas de|las pertenencias de|lo de|a|al)\s+/, '').trim();
    const owner = [...this.world.characters.values()].find((o) => o.name.toLowerCase() === name) ?? null;
    if (!owner && !explicit) return null;
    if (owner && !explicit && !/^(saque|registr|rebusc)/i.test(text)) {
      // «coger Mira» solo es saquear si hay un cuerpo suyo aquí.
      const here = this.world.characterSpot(c);
      if (!here || !bodiesAt(this.world, here.id).some((b) => bodyStateOf(b)!.owner_id === owner.id)) return null;
    }
    return { owner, name, explicit: true };
  }

  /** Estabilizar a un caído (Medicina CD 10) o saquear un cuerpo, sin máster. null si no es eso. */
  private tryDeathAction(c: Character, text: string): ActionResult | null {
    if (c.status !== 'active') return null;
    const nowG = this.nowFor(c);
    const tend = Engine.TEND.exec(text);
    if (tend) {
      const t = findPresentPc(this.world, c, tend[1]!.replace(/[.!]+$/, ''));
      if (!t) return null;
      if (t.status === 'dead') return { ok: false, text: `${t.name} está muerto: ya no hay nada que atender. Volverá por su cuenta.` };
      if (!isDying(t)) return { ok: false, text: t.hp_current > 0 ? `${t.name} no está malherido de muerte.` : `${t.name} ya está estable.` };
      const roll = characterCheck(c, 'skill', 'medicine', 10, 'none', this.rng);
      const shown = `🎲 Medicina: ${roll.breakdown.replace(/ vs CD \d+$/, '')} → ${roll.success ? 'éxito' : 'fallo'}`;
      if (roll.success) stabilize(this.world, t, nowG, c.name, `estabilizado por ${c.name}`, this.rng);
      const r = this.emitTrivial(c, text, 'tend', 'death',
        `${shown}. ${roll.success ? `Taponas la herida de ${t.name} y su respiración se asienta.` : `No consigues cortar la hemorragia; ${t.name} sigue muriéndose. Puedes volver a intentarlo.`}`,
        `${c.name} se arrodilla junto a ${t.name} y le atiende.`, 'Alguien se arrodilla junto a una figura caída.', undefined, { tend: { target: t.id, success: roll.success } });
      this.announceDeathStates();
      return r;
    }
    const target = this.lootTarget(c, text);
    if (!target) return null;
    const here = this.world.characterSpot(c)!;
    const owner = target.owner;
    if (owner && owner.id !== c.id && owner.status !== 'dead' && findPresentPc(this.world, c, owner.name) && !bodiesAt(this.world, here.id).some((b) => bodyStateOf(b)!.owner_id === owner.id)) {
      return { ok: false, text: `${owner.name} está vivo: sin su consentimiento no le quitas nada. Si quiere, que te lo dé.` };
    }
    const bodies = [...this.world.spots.values()].filter((sp) => sp.location_id === here.location_id).flatMap((sp) => bodiesAt(this.world, sp.id))
      .filter((b) => !owner || bodyStateOf(b)!.owner_id === owner.id);
    const body = bodies.find((b) => this.world.spotOfItem(b)?.id === here.id) ?? bodies[0];
    if (!body) return { ok: false, text: owner?.id === c.id ? 'Aquí no están tus cosas.' : `Aquí no hay ningún cuerpo${owner ? ` de ${owner.name}` : ''}.` };
    const at = this.world.spotOfItem(body)!;
    const label = this.world.itemDef(body.item_id).name;
    if (at.id !== here.id) return { ok: false, text: `${label.replace(/^./, (x) => x.toUpperCase())} está en ${at.name}: acércate primero.` };
    const allowed = canLoot(this.world, c.id, body);
    if (!allowed.ok) return { ok: false, text: `No: ${allowed.reason}.` };
    const own = bodyStateOf(body)!.owner_id === c.id;
    const got = lootBody(this.world, c, body, (id) => this.takeToHands(c, id) !== null || this.world.itemsCarriedBy(c.id).some((k) => Boolean(this.world.itemDef(k.item_id).container) && transferItem(this.world, id, { type: 'container', id: k.id }).ok));
    const list = [...got.taken, ...(got.coins ? [`${got.coins} monedas`] : [])];
    if (!list.length) return { ok: false, text: got.left ? 'No te cabe nada más encima.' : `No queda nada en ${label}.` };
    return this.emitTrivial(c, text, own ? 'recover' : 'loot', 'death',
      `${own ? 'Recuperas' : 'Te llevas'} de ${label}: ${list.join(', ')}.${got.left ? ` Se queda${got.left > 1 ? 'n' : ''} ${got.left} ${got.left > 1 ? 'cosas' : 'cosa'} que no te caben.` : ''}`,
      own ? `${c.name} recoge sus cosas.` : `${c.name} registra ${label} y se lleva lo que encuentra.`, 'Una figura rebusca en algo tirado en el suelo.', undefined,
      { loot: { owner_id: bodyStateOf(body)!.owner_id, taken: got.taken, coins: got.coins } });
  }

  // --- Salvaciones, vuelta y avisos -------------------------------------------

  /** Desde el tick: salvaciones fuera de rondas, el estable que despierta y quien vuelve de la muerte. */
  private tickDeath(nowWorldG: number): void {
    for (const c of this.world.characters.values()) {
      const now = nowFor(c, nowWorldG);
      if (isDying(c)) {
        if (c.away || c.veiled) { stabilizeIfAway(this.world, c, now); continue; }
        const locId = this.world.characterSpot(c)?.location_id;
        if (locId && this.rounds.has(locId)) continue; // con rondas, una por ronda
        const every = this.threatAt(c) ? SAVE_EVERY_THREAT_S : SAVE_EVERY_CALM_S;
        for (let n = 0; n < 3 && isDying(c) && c.dying!.next_game_s <= now; n++) {
          const at = c.dying!.next_game_s;
          c.dying!.next_game_s = at + every;
          this.deathSave(c, at);
        }
        if (isDying(c) && c.dying!.next_game_s <= now) c.dying!.next_game_s = now + every;
      } else if (isStable(c)) {
        wakeIfRested(this.world, c, now);
      } else if (c.status === 'dead' && c.death?.told && c.death.respawn_real_ms && this.now() >= c.death.respawn_real_ms) {
        this.comeBack(c);
      }
    }
    this.announceDeathStates();
  }

  /** Una salvación contra muerte, tirada por el servidor: la ve el caído y quien está con él. */
  private deathSave(c: Character, atGameS: number): DeathSave | null {
    const r = rollDeathSave(this.world, c, atGameS, this.rng);
    if (!r) return null;
    if (c.dying) c.dying.next_game_s = Math.max(c.dying.next_game_s, atGameS + SAVE_EVERY_THREAT_S);
    this.announceRoll({
      roller_id: c.id, label: 'Salvación contra muerte', dice: `d20 [${r.natural}]`, total: r.natural,
      outcome: r.outcome === 'revive' ? '20 natural: vuelve en sí' : r.natural === 1 ? 'fallo (1 natural: dos fallos)' : r.outcome === 'success' ? 'éxito' : 'fallo',
      ...(r.outcome === 'revive' || r.died ? {} : { note: `éxitos ${r.success}/3 · fallos ${r.fail}/3` }),
    }, { death_save: r }, 'death_save', ['roll', 'death']);
    return r;
  }

  /** Vuelve de la muerte: en el punto de reaparición, con aviso a los presentes y al grupo. */
  private comeBack(c: Character): void {
    const r = respawn(this.world, c);
    if (!r) return;
    const spot = this.world.spot(r.spot_id);
    const bodyLoc = this.world.locationOfSpot(r.body_spot_id);
    const story = deathRules(this.world).respawn_story || `Alguien te encontró y te trajo ${aEs(spot.name)}.`;
    const things = r.left.length || r.coins_left ? (r.mode === 'casual'
      ? ` Tus cosas siguen donde caíste, en ${this.world.spot(r.body_spot_id).name} (${bodyLoc.name}): nadie más puede tocarlas.`
      : ` No llevas nada encima: lo tuyo se quedó en ${this.world.spot(r.body_spot_id).name} (${bodyLoc.name}), si nadie se lo ha llevado.`) : '';
    const scar = r.penalty ? ` La muerte se cobra algo: −${r.penalty.amount} a ${r.penalty.label} (se recupera al subir de nivel).` : '';
    const ev = this.events.emit({
      actor_id: c.id, action_type: 'respawn',
      narration_private: `${story} Abres los ojos en ${spot.name} con ${c.hp_current}/${c.hp_max} PG.${things}${scar}`,
      observable: `${c.name} está aquí, pálido, como recién vuelto de muy lejos.`, tags: ['death', 'deterministic'],
      payload: { master: null, respawn: { ...r, location_id: spot.location_id }, suggested_actions: suggestActions(this.world, this.clock, c, this.nowFor(c)) },
    }, this.now());
    this.noticeOthers(c, ev, `↺ ${c.name} ha vuelto: está en ${this.world.locationOfSpot(r.spot_id).name}.`);
    this.background(this.masterLine(c, 'respawn', `${c.name} vuelve de la muerte ${aEs(spot.name)}. ${story}`));
  }

  /** Aviso fuera de la ficción a los demás jugadores que no lo han visto. */
  private noticeOthers(c: Character, ev: GameEvent, text: string): void {
    const seen = new Set(ev.delivered_to.map((d) => d.character_id));
    const others = [...this.world.characters.values()].filter((o) => o.id !== c.id && o.status !== 'retired' && !seen.has(o.id)).map((o) => o.id);
    if (!others.length) return;
    const at = this.world.characterSpot(c)!;
    this.events.emit({
      actor_id: null, at: { spot_id: at.id, next_spot_id: null, progress: 0, x: at.x, y: at.y, location_id: at.location_id },
      action_type: 'party_notice', narration_private: '', observable: text, visibility: 'private', also_to: others, tags: ['death', 'presence'], payload: { master: null, about: c.id },
    }, this.now());
  }

  /**
   * Cuenta lo que ha cambiado: caídas, estables, quien vuelve en sí y muertes.
   * Lo llaman la acción, el tick y las rondas: el estado lo cambian también
   * los tools del máster y el combate, que no emiten.
   */
  private announceDeathStates(): void {
    for (const c of this.world.characters.values()) {
      if (c.status === 'dead' && c.death && !c.death.told) { this.announceDeath(c); continue; }
      const d = c.dying;
      if (!d) continue;
      if (d.revived) {
        const via = d.revived;
        const by = d.saved_by;
        c.dying = null;
        this.world.touch('characters', c.id);
        const priv = via === 'save' ? `Un aliento más: abres los ojos con 1 PG.`
          : via === 'rest' ? `Recobras el sentido con ${c.hp_current} PG${by ? `; ${by} te atendió` : ''}.`
          : `Vuelves en ti${by && by !== c.name ? `: ${by} te ha curado` : ''}. ${c.hp_current}/${c.hp_max} PG.`;
        this.events.emit({ actor_id: c.id, action_type: 'revived', narration_private: priv, observable: `${c.name} vuelve en sí.`, tags: ['death', 'deterministic'], payload: { master: null, rescue: { by, via } } }, this.stampFor(c));
        continue;
      }
      const told = (d.told ??= {});
      const stable = d.stable_until_game_s !== null;
      if (!told.down) {
        told.down = true; told.stable = stable;
        this.world.touch('characters', c.id);
        const priv = stable
          ? `Caes al suelo, inconsciente, a 0 PG. ${c.away ? 'Como no estás, quedas estable: no morirás ausente.' : 'Quedas estable.'}${d.stable_until_game_s ? ` Recobrarás el sentido con 1 PG hacia las ${hhmm(d.stable_until_game_s)}.` : ''}`
          : 'Caes al suelo, inconsciente, a 0 PG. El servidor tirará tus salvaciones contra muerte: tres éxitos te estabilizan, tres fallos te matan. Otros pueden estabilizarte (Medicina CD 10) o curarte.';
        this.events.emit({ actor_id: c.id, action_type: 'down', narration_private: priv, observable: `${c.name} cae al suelo y no se mueve.`, tags: ['combat', 'death'], payload: { master: null, down: { stable, cause: d.cause } } }, this.stampFor(c));
      } else if (stable && !told.stable) {
        told.stable = true;
        this.world.touch('characters', c.id);
        this.events.emit({
          actor_id: c.id, action_type: 'stabilized',
          narration_private: `Tu respiración se asienta: estás estable${d.saved_by ? ` (gracias a ${d.saved_by})` : ''}. Recobrarás el sentido con 1 PG hacia las ${hhmm(d.stable_until_game_s!)}.`,
          observable: `${c.name} respira de nuevo, despacio: está estable.`, tags: ['death', 'deterministic'], payload: { master: null, rescue: { by: d.saved_by, via: 'stabilize' } },
        }, this.stampFor(c));
      }
    }
  }

  private announceDeath(c: Character): void {
    const d = c.death!;
    const wait = respawnWaitS(this.world, d.mode);
    d.told = true;
    d.died_real_ms = this.now();
    d.respawn_real_ms = this.now() + wait * 1000;
    this.world.touch('characters', c.id);
    const spot = this.world.spot(d.spot_id);
    const loc = this.world.location(spot.location_id);
    const back = this.world.spot(respawnSpotId(this.world)).name;
    const when = `${fmtDuration(wait)} reales (${fmtDuration(this.clock.realToGame(wait))} de juego)`;
    const things = d.left.length || d.coins_left
      ? d.mode === 'casual' ? ' Lo que llevabas se queda en tu cuerpo, esperándote: solo tú puedes recogerlo.' : ' Lo que llevabas se queda en tu cuerpo, y cualquiera puede llevárselo.'
      : '';
    const scar = d.mode === 'hardcore' && deathRules(this.world).hardcore_ability_penalty > 0 ? ' Volverás con las manos vacías y una cicatriz que no se va.' : '';
    const ev = this.events.emit({
      actor_id: c.id, action_type: 'death',
      narration_private: `☠ Todo se apaga. Has muerto en ${spot.name}. No es el final: volverás en ${back} dentro de ${when}.${things}${scar}`,
      observable: `${c.name} se desploma y deja de respirar.`, tags: ['death', 'combat'],
      payload: { master: null, death: { mode: d.mode, spot_id: d.spot_id, location_id: loc.id, cause: d.cause, left: d.left, coins_left: d.coins_left, respawn_real_ms: d.respawn_real_ms, body_instance_id: d.body_instance_id } },
    }, this.stampFor(c));
    this.noticeOthers(c, ev, `☠ ${c.name} ha muerto en ${loc.name}. Volverá en ${fmtDuration(wait)} reales.`);
    this.background(this.masterLine(c, 'death', `${c.name} acaba de morir en ${spot.name} (${loc.name}) por ${d.cause}. Volverá: la muerte no es el final.`));
  }

  /** Una frase del máster (si lo hay de verdad) tras la plantilla de la muerte o de la vuelta. Sin máster, nada. */
  private async masterLine(c: Character, kind: 'death' | 'respawn', facts: string): Promise<void> {
    if (!this.master?.write) return;
    const out = await this.master.write({
      system: 'Eres el máster de una partida de rol oscura en español. Escribe UNA sola frase, en segunda persona, para el jugador. No inventes hechos, nombres ni lugares que no estén en los datos; no digas cuándo vuelve ni qué pierde: eso ya se le ha dicho.',
      prompt: `${kind === 'death' ? 'Lo último que siente al morir.' : 'Lo primero que siente al volver.'} Datos: ${facts}`,
      max_tokens: 120,
    }).catch(() => null);
    const text = out?.text?.trim();
    if (!text) return;
    this.events.emit({ actor_id: c.id, action_type: 'master_line', narration_private: text.split('\n')[0]!.slice(0, 300), observable: null, tags: ['death'], payload: { master: out!.model } }, this.now());
    await this.flush();
  }

  // -------------------------------------------------------------------------
  // Parser de acciones de fase 1
  // -------------------------------------------------------------------------

  private resolveAction(c: Character, text: string): ActionResult {
    const nowG = this.gameNow();
    const lower = text.toLowerCase();

    if (c.status === 'asleep' && !/^(despierto|despertar|me despierto|wake)/.test(lower)) {
      return { ok: false, text: 'Estás dormido. Escribe «despierto» para levantarte.' };
    }
    if (c.status !== 'active' && c.status !== 'asleep') {
      return { ok: false, text: c.status === 'unconscious' || c.status === 'dead' ? this.downText(c) : `No puedes actuar (${c.status}).` };
    }

    let m: RegExpMatchArray | null;
    if (/^(mirar|miro|mira|look|observar)\b/.test(lower)) {
      return this.emitPrivate(c, text, 'look', describeSurroundings(this.world, this.clock, c, nowG), `${c.name} mira alrededor.`);
    }
    if ((m = lower.match(/^(?:ir|voy|vamos|ve|camino|corro|corre|me acerco|acercarme|salir|salgo|move|go)\s+(?:(?:a la|al|a|hacia|hasta|to)\s+)?(.+?)(?:\s+(sigilosamente|corriendo|andando))?$/))) {
      const pace: Pace = /^corr/.test(lower) || m[2] === 'corriendo' ? 'run' : m[2] === 'sigilosamente' ? 'stealth' : 'walk';
      return this.doMove(c, text, m[1]!, pace);
    }
    if (/^(parar|me paro|me detengo|stop)\b/.test(lower)) {
      if (!c.transit) return { ok: false, text: 'No ibas a ningún sitio.' };
      const stop = interruptTransit(this.world, c, nowG);
      const spot = this.world.spot(stop);
      return this.emit(c, text, 'stop', `Te detienes en ${spot.name}.`, `${c.name} se detiene en ${spot.name}.`);
    }
    if ((m = lower.match(/^(?:coger|cojo|coge|recoger|recojo|tomar|tomo|agarrar|take|pick up|get)\s+(.+)$/))) {
      return this.doTake(c, text, m[1]!);
    }
    if ((m = lower.match(/^(?:soltar|suelto|dejar|dejo|tirar|tiro|drop)\s+(.+)$/))) {
      return this.doDrop(c, text, m[1]!);
    }
    if ((m = lower.match(/^(?:guardar|guardo|meter|meto|put)\s+(.+?)\s+(?:en|dentro de|in|into)\s+(?:la|el|mi|the)?\s*(.+)$/))) {
      return this.doPut(c, text, m[1]!, m[2]!);
    }
    if ((m = lower.match(/^(?:sacar|saco|take out)\s+(.+?)\s+(?:de|del|de la|from)\s+(?:la|el|mi|the)?\s*(.+)$/))) {
      return this.doTakeOut(c, text, m[1]!, m[2]!);
    }
    if ((m = lower.match(/^(?:dar|doy|entregar|entrego|give)\s+(.+?)\s+(?:a|al|a la|to)\s+(.+)$/))) {
      return this.doGive(c, text, m[1]!, m[2]!);
    }
    if ((m = lower.match(/^(?:talar|talo|recolectar|recolecto|extraer|extraigo|picar|pico|pescar|pesco|harvest|chop|mine)\s+(.+)$/))) {
      return this.doHarvest(c, text, m[1]!);
    }
    if (/^(inventario|inventory)\b/.test(lower)) {
      return { ok: true, text: formatInventory(inventoryView(this.world, c.id)) };
    }
    if (/^(quien|quién|who)\b/.test(lower)) return { ok: true, text: whoIsHere(this.world, this.clock, c, nowG) };
    if (/^(donde|dónde|where)\b/.test(lower)) return { ok: true, text: whereAmI(this.world, this.clock, c, nowG) };
    if (/^(despierto|despertar|me despierto|wake)\b/.test(lower)) {
      if (c.status !== 'asleep') return { ok: false, text: 'Ya estás despierto.' };
      c.status = 'active';
      c.veiled = false;
      this.world.touch('characters', c.id);
      return this.emit(c, text, 'wake', 'Te despiertas.', `${c.name} se despierta.`);
    }
    if ((m = lower.match(/^(?:decir|digo|hablar|say)\s+(.+)$/)) || (m = text.match(/^"(.+)"$/))) {
      const said = m[1]!;
      return this.emit(c, text, 'say', `Dices: «${said}»`, `${c.name} dice: «${said}»`, 1, { observable_vague: 'Oyes a alguien hablar cerca.', observable_hint: 'Oyes voces.' }, [], 'sound');
    }
    if ((m = lower.match(/^(?:gritar|grito|shout)\s+(.+)$/))) {
      const said = m[1]!;
      return this.emit(c, text, 'shout', `Gritas: «${said}»`, `${c.name} grita: «${said}»`, 5, { observable_vague: `Alguien grita: «${said}»`, observable_hint: 'Oyes un grito a lo lejos.' }, [], 'sound');
    }
    if ((m = lower.match(/^(?:susurrar|susurro|whisper)\s+(.+)$/))) {
      const said = m[1]!;
      return this.emit(c, text, 'whisper', `Susurras: «${said}»`, `${c.name} susurra: «${said}»`, 0.15, { observable_vague: 'Alguien susurra.', observable_hint: '' }, [], 'sound');
    }
    return { ok: false, text: 'No entiendo qué quieres hacer. Prueba: mirar, ir a <sitio>, coger <cosa>, soltar <cosa>, guardar <cosa> en <contenedor>, talar <árbol>, decir <texto>, dormir, descanso corto.' };
  }

  private emitPrivate(c: Character, input: string, type: string, priv: string, obs: string): ActionResult {
    return this.emit(c, input, type, priv, obs, 1, {});
  }

  private emit(c: Character, input: string, type: string, priv: string, obs: string | null, loudness = 1, payload: Record<string, unknown> = {}, alsoTo: Id[] = [], channel: 'sight' | 'sound' | 'any' = 'any'): ActionResult {
    const event = this.events.emit({
      actor_id: c.id, action_type: type, input_text: input, narration_private: priv, observable: obs, loudness, payload, also_to: alsoTo, channel,
    }, this.stampFor(c));
    return { ok: true, text: priv, event };
  }

  private ambiguous<T>(r: Extract<Resolution<T>, { kind: 'many' }>): ActionResult {
    return { ok: false, text: `¿Cuál? ${r.candidates.map((x) => x.matched).join(' / ')}` };
  }

  private doMove(c: Character, input: string, target: string, pace: Pace): ActionResult {
    const r = resolveSpot(this.world, c, target);
    if (r.kind === 'none') return { ok: false, text: `No conoces ningún sitio llamado «${target}».` };
    if (r.kind === 'many') return this.ambiguous(r);
    const nowG = this.nowFor(c);
    const from = this.world.spot(positionOf(this.world, c, nowG).spot_id);
    const res = moveTo(this.world, c.id, r.value, pace, nowG);
    if (!res.ok) return { ok: false, text: moveErrorText(this.world, res.error) };
    const dest = this.world.spot(r.value);
    const game = fmtDuration(res.total_s);
    const real = this.fastTravel && (crossesLocations(res.transit) || nowG > this.gameNow()) ? 'sin esperar' : `${fmtDuration(this.clock.gameToReal(res.total_s))} reales`;
    const paceTxt = pace === 'run' ? 'corriendo' : pace === 'stealth' ? 'con sigilo' : 'andando';
    return this.emit(c, input, 'move', `Te pones en marcha hacia ${dest.name} ${paceTxt}. Tardarás ${game} de juego (${real}).`,
      `${c.name} se marcha de ${from.name} hacia ${dest.name} ${paceTxt}.`, 1, { observable_vague: `Una figura se aleja de ${from.name}.` });
  }

  private doTake(c: Character, input: string, what: string): ActionResult {
    const here = this.world.characterSpot(c)!;
    const r = resolveItem(this.world, c, what, 'floor');
    if (r.kind === 'none') return { ok: false, text: `No ves nada llamado «${what}» a tu alcance.` };
    if (r.kind === 'many') return this.ambiguous(r);
    const inst = this.world.itemInstance(r.value);
    if (inst.location.type !== 'spot') return { ok: false, text: 'Eso ya lo llevas encima.' };
    const def = this.world.itemDef(inst.item_id);
    const targets: Placement[] = def.size === 'bulky'
      ? [{ type: 'character', id: c.id, slot: { kind: 'hand', which: 'both' } }]
      : [
        { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } },
        { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } },
        { type: 'character', id: c.id, slot: { kind: 'pocket' } },
      ];
    let lastErr: TransferError | null = null;
    for (const t of targets) {
      const res = transferItem(this.world, inst.id, t);
      if (res.ok) {
        const where = t.type === 'character' && t.slot.kind === 'pocket' ? 'y te lo guardas en un bolsillo' : 'con la mano';
        return this.emit(c, input, 'take', `Coges ${def.name} ${where}.`, `${c.name} coge ${def.name} del suelo de ${here.name}.`, 1, { observable_vague: 'Una figura se agacha a coger algo.', item_id: def.id });
      }
      lastErr = res.error;
    }
    return { ok: false, text: transferErrorText(lastErr!) };
  }

  private doDrop(c: Character, input: string, what: string): ActionResult {
    const here = this.world.characterSpot(c)!;
    const r = resolveItem(this.world, c, what, 'carried');
    if (r.kind === 'none') return { ok: false, text: `No llevas nada llamado «${what}».` };
    if (r.kind === 'many') return this.ambiguous(r);
    const inst = this.world.itemInstance(r.value);
    if (inst.location.type === 'spot') return { ok: false, text: 'Eso ya está en el suelo.' };
    const def = this.world.itemDef(inst.item_id);
    const res = transferItem(this.world, inst.id, { type: 'spot', id: here.id });
    if (!res.ok) return { ok: false, text: transferErrorText(res.error) };
    return this.emit(c, input, 'drop', `Dejas ${def.name} en el suelo.`, `${c.name} deja ${def.name} en el suelo de ${here.name}.`, 1, { observable_vague: 'Una figura deja algo en el suelo.' });
  }

  private doPut(c: Character, input: string, what: string, into: string): ActionResult {
    const item = resolveItem(this.world, c, what);
    if (item.kind === 'none') return { ok: false, text: `No tienes «${what}» a mano.` };
    if (item.kind === 'many') return this.ambiguous(item);
    const cont = resolveItem(this.world, c, into);
    if (cont.kind === 'none') return { ok: false, text: `No ves ningún «${into}».` };
    if (cont.kind === 'many') return this.ambiguous(cont);
    const contInst = this.world.itemInstance(cont.value);
    const contDef = this.world.itemDef(contInst.item_id);
    if (!contDef.container) return { ok: false, text: `${contDef.name} no es un contenedor.` };
    const def = this.world.itemDef(this.world.itemInstance(item.value).item_id);
    const res = transferItem(this.world, item.value, { type: 'container', id: contInst.id });
    if (!res.ok) return { ok: false, text: transferErrorText(res.error) };
    return this.emit(c, input, 'put', `Guardas ${def.name} en ${contDef.name}.`, `${c.name} guarda ${def.name} en ${contDef.name}.`);
  }

  private doTakeOut(c: Character, input: string, what: string, from: string): ActionResult {
    const cont = resolveItem(this.world, c, from);
    if (cont.kind === 'none') return { ok: false, text: `No ves ningún «${from}».` };
    if (cont.kind === 'many') return this.ambiguous(cont);
    const contInst = this.world.itemInstance(cont.value);
    const contDef = this.world.itemDef(contInst.item_id);
    const inside = this.world.itemsIn({ type: 'container', id: contInst.id });
    const item = resolveItem(this.world, c, what);
    if (item.kind === 'none' || (item.kind === 'one' && !inside.some((i) => i.id === item.value))) return { ok: false, text: `En ${contDef.name} no hay «${what}».` };
    if (item.kind === 'many') return this.ambiguous(item);
    const def = this.world.itemDef(this.world.itemInstance(item.value).item_id);
    for (const which of ['main', 'off'] as const) {
      const res = transferItem(this.world, item.value, { type: 'character', id: c.id, slot: { kind: 'hand', which } });
      if (res.ok) return this.emit(c, input, 'take_out', `Sacas ${def.name} de ${contDef.name}.`, `${c.name} saca ${def.name} de ${contDef.name}.`, 1, { item_id: def.id });
      if (res.error.code !== 'no_space') return { ok: false, text: transferErrorText(res.error) };
    }
    return { ok: false, text: 'Tienes las manos ocupadas.' };
  }

  private doGive(c: Character, input: string, what: string, whom: string): ActionResult {
    const item = resolveItem(this.world, c, what, 'carried');
    if (item.kind === 'none') return { ok: false, text: `No tienes «${what}».` };
    if (item.kind === 'many') return this.ambiguous(item);
    const here = this.world.characterSpot(c)!;
    const q = whom.trim().toLowerCase();
    const target = this.world.charactersAt(here.id).find((o) => o.id !== c.id && o.name.toLowerCase() === q);
    if (!target) return { ok: false, text: `Aquí no hay nadie que se llame «${whom}».` };
    // Entre jugadores, con consentimiento: una oferta que el otro acepta (party.ts).
    const off = this.offer(c.id, target.id, { instance_id: item.value, coins: 0 }, input);
    return off.ok ? off.result : { ok: false, text: off.error };
  }

  private doHarvest(c: Character, input: string, what: string): ActionResult {
    const r = resolveResourceNode(this.world, c, what);
    if (r.kind === 'none') return { ok: false, text: `Aquí no hay ningún «${what}» que puedas explotar.` };
    if (r.kind === 'many') return this.ambiguous(r);
    const node = this.world.resourceNode(r.value);
    // Fase 1: sin dados. La tirada llega con el master (fase 2); aquí siempre pasa.
    const res = harvest(this.world, c, node.id, true, this.gameNow());
    if (!res.ok) {
      const msg = { not_here: 'No estás junto a eso.', depleted: `${node.name} está agotado; tendrás que esperar a que se recupere.`, missing_tool: `Necesitas ${this.world.itemDef(node.tool_required!).name} para eso.`, failed_check: 'No consigues sacar nada.', not_active: 'No puedes hacer eso ahora.' }[res.code];
      return { ok: false, text: msg };
    }
    const def = this.world.itemDef(node.resource_item_id);
    const where = res.item.ok && res.item.moved.location.type === 'spot' ? ' Lo dejas en el suelo porque tienes las manos ocupadas.' : '';
    return this.emit(c, input, 'harvest', `Obtienes ${def.name} ×${res.quantity} de ${node.name}.${where}`, `${c.name} trabaja en ${node.name}.`, 2, { observable_vague: 'Se oyen golpes.', observable_hint: 'Oyes golpes a lo lejos.' });
  }
}

/** Migraciones de datos guardados con versiones anteriores del modelo. Cada una es idempotente. */
function migrate(snapshot: WorldSnapshot, seed?: WorldSnapshot): boolean {
  let changed = false;
  const camp = snapshot.campaign as WorldSnapshot['campaign'] & { starting_spot_id?: Id; starting_spot_ids?: Id[] };
  if (!Array.isArray(camp.starting_points)) {
    changed = true;
    const ids = camp.starting_spot_ids ?? (camp.starting_spot_id ? [camp.starting_spot_id] : []);
    camp.starting_points = seed?.campaign.starting_points ?? ids.map((spot_id) => ({ spot_id, origin: '' }));
    delete camp.starting_spot_id;
    delete camp.starting_spot_ids;
  }
  for (const c of snapshot.characters as (Character & { recap_from?: unknown })[]) {
    if (c.recap_from === undefined || c.race === undefined || c.hp_max === undefined) changed = true;
    if (c.recap_from === undefined) c.recap_from = null;
    c.race ??= 'humano'; c.class_name ??= 'aventurero'; c.level ??= 1; c.appearance ??= ''; c.backstory ??= '';
    c.hp_max ??= 10; c.hp_current ??= c.hp_max; c.hp_temp ??= 0; c.conditions ??= [];
    c.proficiencies ??= { skills: ['perception', 'athletics'], expert: [], saves: ['str', 'con'] };
    if (c.practice === undefined) changed = true;
    c.practice ??= {}; c.practice_bonus ??= {}; c.reputation ??= {}; c.clues ??= []; c.completed_jobs ??= []; c.achievements ??= [];
    if (c.race_id === undefined || c.knows === undefined) changed = true;
    c.knows ??= [];
    c.race_id ??= 'human'; c.class_id ??= 'fighter'; c.background_id ??= 'soldier'; c.hit_die ??= 10; c.death_mode ??= 'casual';
    if (c.decisive === undefined) changed = true;
    c.decisive ??= null; c.xp ??= 0;
  }
  for (const n of snapshot.npcs as (Npc & { memory?: unknown })[]) {
    if (n.memory === undefined) changed = true;
    n.memory ??= []; n.talking_to ??= null;
    const seedNpc = seed?.npcs.find((x) => x.id === n.id);
    n.description ??= seedNpc?.description ?? ''; n.motivation ??= seedNpc?.motivation ?? ''; n.secret ??= seedNpc?.secret ?? '';
    if (n.buys === undefined || n.stats === undefined) changed = true;
    n.buys ??= seedNpc?.buys ?? []; n.sells ??= seedNpc?.sells ?? [];
    n.stats ??= seedNpc?.stats ?? null; n.attitude ??= seedNpc?.attitude ?? { default: 'neutral', by_character: {} };
  }
  for (const n of seed?.npcs ?? []) if (!snapshot.npcs.some((x) => x.id === n.id)) { snapshot.npcs.push(structuredClone(n)); changed = true; }
  // Datos de la demo (pistas, encargos, logro, nodos, objetos nuevos): se toman de la semilla si faltan.
  if (seed) {
    const c2 = snapshot.campaign;
    if (c2.clues === undefined) changed = true;
    c2.factions ??= seed.campaign.factions; c2.clues ??= seed.campaign.clues; c2.jobs ??= seed.campaign.jobs;
    c2.achievement ??= seed.campaign.achievement; c2.progression ??= seed.campaign.progression; c2.board ??= { active_job_ids: [], last_rotation_day: -1 };
    // Anclas de las pistas (qué localización o NPC trae su "cómo" al contexto): de la semilla si la partida guardada no las tiene.
    for (const cl of c2.clues) {
      const sc = seed.campaign.clues.find((x) => x.id === cl.id);
      if (!sc || cl.location_ids || cl.npc_ids || (!sc.location_ids && !sc.npc_ids)) continue;
      if (sc.location_ids) cl.location_ids = [...sc.location_ids];
      if (sc.npc_ids) cl.npc_ids = [...sc.npc_ids];
      changed = true;
    }
    for (const d of seed.item_defs) {
      const cur = snapshot.item_defs.find((x) => x.id === d.id);
      if (!cur) { snapshot.item_defs.push(d); changed = true; }
      else if (d.weapon && !cur.weapon) { cur.weapon = d.weapon; changed = true; }
    }
    for (const n of seed.resource_nodes) if (!snapshot.resource_nodes.some((x) => x.id === n.id)) { snapshot.resource_nodes.push(n); changed = true; }
    for (const s of seed.spots) if (!snapshot.spots.some((x) => x.id === s.id)) { snapshot.spots.push(s); changed = true; }
  }
  const camp2 = snapshot.campaign;
  if (seed) {
    if (camp2.master === undefined || camp2.premise === undefined || camp2.welcome === undefined) changed = true;
    camp2.welcome ??= seed.campaign.welcome;
    camp2.premise ??= seed.campaign.premise; camp2.setting ??= seed.campaign.setting; camp2.tone ??= seed.campaign.tone;
    camp2.content_rating ??= seed.campaign.content_rating; camp2.language ??= seed.campaign.language; camp2.house_rules ??= seed.campaign.house_rules;
    camp2.master ??= seed.campaign.master;
  }
  // Partidas de antes de la muerte y la reaparición: el punto de vuelta de la campaña escrita.
  if (seed?.campaign.death_rules && !camp2.death_rules) { camp2.death_rules = structuredClone(seed.campaign.death_rules); changed = true; }
  // Partidas de antes de las costumbres de la campaña escrita.
  if (seed?.campaign.customs && !camp2.customs) { camp2.customs = [...seed.campaign.customs]; changed = true; }
  // Mundos generados antes de los cuartos de alquiler: la habitación deja de ser el premio oculto.
  if (migrateRentableRooms(snapshot)) changed = true;
  return changed;
}

export function formatInventory(v: InventoryView): string {
  const lines: string[] = [];
  lines.push(`Manos: ${v.hands.main ?? '—'} / ${v.hands.off ?? '—'}`);
  const eq = Object.entries(v.equipped).map(([k, n]) => `${k}: ${n}`);
  lines.push(`Equipado: ${eq.length ? eq.join(', ') : '—'}`);
  lines.push(`Bolsillos: ${v.pockets.length ? v.pockets.join(', ') : '—'}`);
  for (const c of v.containers) lines.push(`${c.name}: ${c.items.length ? c.items.join(', ') : 'vacía'}`);
  lines.push(`Monedas: ${v.coins}`);
  const e = v.encumbrance;
  const lvl = { ok: '', encumbered: ' (cargado, −10 ft)', heavily: ' (muy cargado, −20 ft)', immobile: ' (no puedes moverte)' }[e.level];
  lines.push(`Peso: ${e.weight_lb.toFixed(1)} / ${e.max_lb} lb${lvl}`);
  return lines.join('\n');
}

export function moveErrorText(world: World, e: MoveError): string {
  switch (e.code) {
    case 'unknown_spot': return 'No conoces ese sitio.';
    case 'already_there': return 'Ya estás ahí.';
    case 'no_route': return `No hay camino hasta ${world.spot(e.to).name} desde donde estás.`;
    case 'spot_full': return `${world.spot(e.spot_id).name} está lleno (caben ${e.capacity}).`;
    case 'not_active': return e.status === 'asleep' ? 'Estás dormido.' : `No puedes moverte (${e.status}).`;
    case 'not_driver': return `No llevas las riendas de ${world.vehicle(e.vehicle_id).name}.`;
    case 'cannot_move': return `No puedes moverte: ${e.reason}.`;
    case 'locked': return `${world.spot(e.spot_id).name} está cerrado con llave${e.key_item_id && world.itemDefs.get(e.key_item_id) ? ` (hace falta ${world.itemDefs.get(e.key_item_id)!.name})` : ''}.`;
  }
}

export function transferErrorText(e: TransferError): string {
  switch (e.code) {
    case 'not_found': return 'Eso no existe.';
    case 'bad_quantity': return 'Cantidad no válida.';
    case 'not_reachable': return `No puedes: ${e.reason}.`;
    case 'fixed': return 'Eso no se puede mover de su sitio.';
    case 'no_space': return `No te cabe: ${e.reason}. Opciones: ${e.options.join(', ')}.`;
    case 'invalid_slot': return `No puedes: ${e.reason}.`;
  }
}

export { spotOfPlacement };
