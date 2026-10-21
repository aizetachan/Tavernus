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
import type { Character, GameEvent, Id, Npc, Pace, Placement, WorldSnapshot } from './model.js';
import { interruptTransit, moveTo, positionOf, settleTransit, type MoveError } from './movement.js';
import { aEs, arrivalNarration, describeSurroundings, fmtDuration, whereAmI, whoIsHere } from './narrate.js';
import { encounterChance, parseTrivial, suggestActions, tension, type TrivialIntent } from './fastpath.js';
import { consumeHooks, matchHooks, pendingHooksIn, pruneHooks, type Hook, type HookCue } from './hooks.js';
import type { Rng } from './dice.js';
import { harvest } from './resources.js';
import { spawnItem } from './inventory.js';
import { characterCheck, type CheckKind } from './rules.js';
import { activeJobs, addPractice, rotateBoard, type ProgressEvent } from './progress.js';
import { resolveAttack } from './combat.js';
import { abilityModifier } from './dice.js';
import { passivePerception, type Ability } from './rules.js';
import { ABILITIES, backgroundById, classById, raceById, STANDARD_ARRAY } from '../data/srd/index.js';
import type { Advantage, CheckResult } from './dice.js';
import { World } from './world.js';

export interface ActionResult {
  ok: boolean;
  /** Texto para el actor. */
  text: string;
  event?: GameEvent;
  suggested_actions?: string[];
  requires_roll?: RequiresRoll;
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
  resolve(actor: Character, text: string, roll?: { original_text: string; result: CheckResult & { label: string } }, intro?: { origin: string; welcome: string }, scene?: MasterScene, decisive?: { seconds: number; speed: 'fast' | 'normal'; threat: string }): Promise<MasterResolution>;
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
}

export type MasterResolution =
  | { ok: true; closed: { narration_private: string; observable: string | null; observable_vague: string | null; loudness: number; tags: string[]; suggested_actions: string[]; requires_roll: RequiresRoll | null; decisive?: { threat: string; npc_id: string | null } | null }; usage: unknown; calls: { name: string; input: unknown; result: string }[]; context: string; model: string; progress?: ProgressEvent[] }
  | { ok: false; reason: string; message: string; usage?: unknown; calls?: unknown };

/** Un PJ pisa una localización por primera vez (para ilustrarla, src/ai/illustrate.ts). */
export interface FirstVisit { character_id: Id; location_id: Id; game_s: number }
export type FirstVisitListener = (v: FirstVisit) => void;

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
}

export class Engine {
  readonly world: World;
  readonly clock: GameClock;
  readonly events: EventLog;
  private readonly repo: Repository;
  private readonly now: () => number;
  private pending = new Map<string, Change>();
  private queues = new Map<Id, Promise<unknown>>();
  private tickers: Ticker[] = [];
  private tickerTask: Promise<void> | null = null;
  private master: MasterLike | null = null;
  private pendingRolls = new Map<Id, PendingRoll>();
  private readonly rng: Rng;
  readonly deterministic: boolean;
  private hints = new Map<Id, SceneHints>();
  /** Localización desde la que salió cada viaje iniciado por el motor (para saber si la llegada cruza a otra). */
  private tripFrom = new Map<Id, Id>();
  private firstVisitListeners: FirstVisitListener[] = [];
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
    this.rng = opts.rng ?? Math.random;
    this.deterministic = opts.deterministic ?? true;
    this.realClock = !opts.now;
    this.world = new World(snapshot);
    this.clock = GameClock.fromCampaign(this.world.campaign);
    this.events = new EventLog(this.world, this.clock, lastSeq);
    this.world.onChange((c) => this.pending.set(`${c.collection}/${c.id}`, c));
    this.events.onEvent((e) => { void this.repo.appendEvent(e); });
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
    await engine.installTickers();
    if (migrated) {
      engine.world.touch('campaign', snapshot.campaign.id);
      for (const c of engine.world.characters.values()) engine.world.touch('characters', c.id);
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
      action_type: 'board', narration_private: '', visibility: 'public', tags: ['board'],
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

  /** Consolida viajes de todos los PJs y emite llegadas. */
  private settleAll(nowGameS: number): void {
    for (const c of this.world.characters.values()) {
      if (!c.transit) continue;
      const startLoc = this.world.characterSpot(c)?.location_id;
      const r = settleTransit(this.world, c, nowGameS);
      for (const reached of r.reached) {
        const spot = this.world.spot(reached.spot_id);
        const loc = this.world.location(spot.location_id);
        const firstVisit = loc.discovery[c.id] !== 'visited';
        if (firstVisit) { loc.discovery[c.id] = 'visited'; this.world.touch('locations', loc.id); }
        const last = r.arrived && reached === r.reached[r.reached.length - 1];
        // Con master, la llegada al destino la narra él (escena de llegada) salvo que sea trivial: entonces, plantilla.
        // El aviso plano queda para los tramos intermedios y para quien no está mirando.
        const live = last && this.master !== null && c.status === 'active' && c.connected;
        const crossed = (this.tripFrom.get(c.id) ?? startLoc) !== spot.location_id;
        const plan = live ? this.arrivalPlan(c, spot.id, firstVisit, crossed) : null;
        if (last) this.tripFrom.delete(c.id);
        const template = plan?.kind === 'template';
        this.events.emit({
          actor_id: c.id,
          at: { spot_id: spot.id, next_spot_id: null, progress: 0, x: spot.x, y: spot.y, location_id: spot.location_id },
          action_type: last ? 'arrived' : 'passed',
          narration_private: template ? arrivalNarration(this.world, this.clock, c, reached.at_game_s, crossed)
            : plan ? '' : last ? `Llegas a ${spot.name}.` : `Pasas por ${spot.name}.`,
          observable: last ? `${c.name} llega ${aEs(spot.name)}.` : `${c.name} pasa por ${spot.name}.`,
          tags: template ? ['movement', 'deterministic'] : ['movement'],
          payload: {
            observable_vague: last ? `Una figura llega ${aEs(spot.name)}.` : `Una figura pasa por ${spot.name}.`,
            ...(template ? { master: null, suggested_actions: suggestActions(this.world, this.clock, c, reached.at_game_s) } : {}),
          },
        }, this.clock.realAt(reached.at_game_s));
        if (firstVisit) this.firstVisit({ character_id: c.id, location_id: loc.id, game_s: reached.at_game_s });
        if (plan?.kind === 'master') this.narrateArrival(c, plan.hints);
      }
    }
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
        this.events.emit({ actor_id: c.id, action_type: 'arrived', narration_private: `Llegas a ${spot.name}.\n${describeSurroundings(this.world, this.clock, c, this.gameNow())}`, observable: null, tags: ['movement'] }, this.now());
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
      for (const id of this.presence.keys()) this.refreshConnection(id);
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
    if (this.pending.size === 0) return;
    const changes = [...this.pending.values()];
    this.pending.clear();
    await this.repo.write(this.world.campaign.id, changes);
    if (this.repo.flush) await this.repo.flush(this.world.snapshot());
  }

  // -------------------------------------------------------------------------
  // Cola por localización (SPEC §9): una acción a la vez por localización.
  // -------------------------------------------------------------------------

  private runInLocation<T>(locationId: Id, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(locationId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(locationId, next.catch(() => undefined));
    return next;
  }

  /** Punto de entrada de cualquier cliente: texto libre de un jugador. */
  async act(characterId: Id, text: string): Promise<ActionResult> {
    await this.tick();
    const c = this.world.character(characterId);
    this.lastAction.set(c.id, this.now());
    if (!c.connected) this.setConnected(c.id, true);
    const locId = positionOf(this.world, c, this.gameNow()).location_id;
    return this.runInLocation(locId, async () => {
      const clean = text.trim();
      this.pendingRolls.delete(c.id); // una acción nueva anula la tirada pendiente
      let r: ActionResult;
      let decisive: { seconds: number; speed: 'fast' | 'normal'; threat: string } | undefined;
      if (c.decisive) {
        const seconds = Math.round((this.now() - c.decisive.opened_real_ms) / 1000);
        decisive = { seconds, speed: seconds < Engine.DECISIVE_FAST_S ? 'fast' : 'normal', threat: c.decisive.threat };
        this.closeDecisive(c);
      }
      const fast = decisive ? null : await this.tryTrivial(c, clean);
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
      await this.flush();
      return r;
    });
  }

  private static readonly REST = /^(dormir|duermo|me duermo|descansar|descanso|sleep)\b/i;

  /**
   * Acción trivial sin IA (fastpath.ts). Devuelve null si no lo es y debe seguir
   * el camino de siempre. Aunque sea trivial va al master si la escena está
   * tensa, si salta un gancho o si sale la tirada de imprevisto.
   */
  private async tryTrivial(c: Character, text: string): Promise<ActionResult | null> {
    if (!this.deterministic || !this.master || c.status !== 'active') return null;
    const nowG = this.gameNow();
    const locId = positionOf(this.world, c, nowG).location_id;

    // Dormir y descansar ya no pasan por el master; la noche también puede interrumpirse.
    if (Engine.REST.test(text)) {
      const chance = encounterChance(this.world, this.world.location(locId));
      const tense = tension(this.world, c, [locId], this.recentTags([locId]));
      const roll = tense ? 0 : this.rng();
      if (!tense && roll >= chance) return null;
      const r = await this.resolveWithHints(c, text, tense ? null : { hooks: [], encounter: { chance, roll } });
      return r.ok || r.text !== '' ? r : null;
    }

    const intent = parseTrivial(this.world, c, text);
    if (!intent) return null;
    if (intent.kind === 'move' && intent.pace === 'stealth') return null; // el sigilo es una prueba: al master
    const locs = intent.kind === 'move' && intent.exit ? [locId, this.world.spot(intent.spot_id).location_id] : [locId];
    if (tension(this.world, c, locs, this.recentTags(locs))) return null;

    const cues: HookCue[] = [];
    if (intent.kind === 'move') cues.push({ kind: 'spot', spot_id: intent.spot_id, character_id: c.id });
    if (intent.kind === 'take') cues.push({ kind: 'item', item_id: this.world.itemInstance(intent.instance_id).item_id, location_id: locId, character_id: c.id });
    const hooks = cues.flatMap((cue) => matchHooks(this.world, cue));
    let hints: SceneHints | null = null;
    if (hooks.length) hints = { hooks, encounter: null };
    else {
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
    const nowG = this.gameNow();
    const here = this.world.spot(positionOf(this.world, c, nowG).spot_id);
    switch (intent.kind) {
      case 'move': {
        const res = moveTo(this.world, c.id, intent.spot_id, intent.pace, nowG);
        if (!res.ok) return null;
        this.tripFrom.set(c.id, here.location_id);
        const dest = this.world.spot(intent.spot_id);
        const run = intent.pace === 'run' ? ' a la carrera' : '';
        const eta = res.total_s < 60 ? '' : ` Tardarás ${fmtDuration(res.total_s)} de juego (${fmtDuration(this.clock.gameToReal(res.total_s))} reales).`;
        if (intent.exit) {
          const loc = this.world.location(dest.location_id);
          return this.emitTrivial(c, input, 'move', 'movement', `Te pones en camino hacia ${loc.name}${run}.${eta}`,
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
          `${c.name} coge ${def.name}.`, 'Una figura coge algo.');
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
  private takeToHands(c: Character, instanceId: Id): 'hand' | 'pocket' | null {
    const def = this.world.itemDef(this.world.itemInstance(instanceId).item_id);
    const targets: Placement[] = def.size === 'bulky'
      ? [{ type: 'character', id: c.id, slot: { kind: 'hand', which: 'both' } }]
      : [
        { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } },
        { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } },
        { type: 'character', id: c.id, slot: { kind: 'pocket' } },
      ];
    for (const t of targets) {
      if (transferItem(this.world, instanceId, t).ok) return t.type === 'character' && t.slot.kind === 'pocket' ? 'pocket' : 'hand';
    }
    return null;
  }

  /** Evento determinista: coste cero (master null) y acciones sugeridas desde el estado. */
  private emitTrivial(c: Character, input: string, type: string, tag: string, priv: string, obs: string | null, vague: string | null, skipSpotName?: string): ActionResult {
    const suggested = suggestActions(this.world, this.clock, c, this.gameNow()).filter((s) => !skipSpotName || s !== `Ir ${aEs(skipSpotName)}`);
    const event = this.events.emit({
      actor_id: c.id, action_type: type, input_text: input, narration_private: priv, observable: obs, tags: ['deterministic', tag],
      payload: { master: null, suggested_actions: suggested, ...(vague ? { observable_vague: vague } : {}) },
    }, this.now());
    return { ok: true, text: priv, event, suggested_actions: suggested };
  }

  /** El jugador pulsa 🎲: el servidor tira y el master narra la consecuencia. */
  async rollPending(characterId: Id): Promise<ActionResult> {
    await this.tick();
    const c = this.world.character(characterId);
    const locId = positionOf(this.world, c, this.gameNow()).location_id;
    return this.runInLocation(locId, async () => {
      const pending = this.pendingRolls.get(c.id);
      if (!pending) return { ok: false, text: 'No tienes ninguna tirada pendiente.' };
      this.pendingRolls.delete(c.id);
      let result: CheckResult & { label: string };
      let shown: string;
      if (pending.roll.kind === 'attack' && pending.roll.target) {
        const atk = resolveAttack(this.world, c.id, pending.roll.target, pending.roll.advantage);
        if ('error' in atk) return { ok: false, text: atk.error };
        result = {
          label: `ataque con ${atk.weapon} a ${atk.target}`, expr: 'attack', total: atk.attack_total, rolls: [], d20s: [], modifier: 0, dc: atk.target_ac, advantage: pending.roll.advantage,
          success: atk.hit, ...(atk.natural ? { natural: atk.natural } : {}),
          breakdown: `${atk.attack_breakdown}${atk.hit ? `. Daño: ${atk.damage_breakdown} (${atk.damage_type}). ${atk.target} queda a ${atk.target_hp} PG${atk.target_dead ? ', MUERTO' : atk.target_down ? ', CAE' : ''}. El daño ya está aplicado: no lo apliques otra vez.` : '. Falla.'}`,
        };
        shown = `🎲 Ataque con ${atk.weapon}: ${atk.attack_breakdown.replace(/ vs CD \d+$/, '')} → ${atk.hit ? `impacta${atk.natural === 20 ? ' (crítico)' : ''}: ${atk.damage} de daño` : 'falla'}`;
      } else {
        result = characterCheck(c, pending.roll.kind, pending.roll.key, pending.roll.dc, pending.roll.advantage);
        shown = `🎲 ${result.label}: ${result.breakdown.replace(/ vs CD \d+$/, '')} → ${result.success === null ? '—' : result.success ? 'éxito' : 'fallo'}${result.natural ? ` (${result.natural} natural)` : ''}`;
      }
      this.events.emit({
        actor_id: c.id, action_type: 'roll', input_text: null, narration_private: shown, observable: null,
        tags: ['roll'], payload: { roll: { ...result, dc: undefined } },
      }, this.now());
      if (pending.roll.kind === 'skill' && (pending.roll.dc ?? 0) >= this.world.campaign.progression.practice_min_dc) {
        const pe = addPractice(this.world, c, pending.roll.key);
        if (pe) this.emitProgress(c, [pe]);
      }
      let r = await this.resolveWithMaster(c, pending.text, { original_text: pending.text, result });
      if (!r.ok && r.text === '') r = { ok: false, text: `${shown}\nEl narrador no responde; inténtalo de nuevo.` };
      await this.flush();
      return r;
    });
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
      const r = await this.resolveWithMaster(c, '(sin respuesta)', undefined, undefined, 'decisive_timeout');
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

  /** Avisos de progreso como eventos de sistema: privados al PJ, y públicos en el tablón si procede. */
  private emitProgress(c: Character, events: ProgressEvent[]): void {
    for (const e of events) {
      this.events.emit({ actor_id: c.id, action_type: `progress_${e.kind}`, narration_private: e.text, observable: null, tags: ['progress', e.kind], payload: {} }, this.now());
      if (e.public) {
        const at = positionOf(this.world, c, this.gameNow());
        this.events.emit({ actor_id: null, at, action_type: 'announcement', narration_private: '', observable: e.public, visibility: 'public', tags: ['milestone', e.kind] }, this.now());
      }
    }
  }

  /** Estado del tablón para /tablon. */
  boardText(): string {
    const jobs = activeJobs(this.world);
    return jobs.length ? jobs.map((j) => `• **${j.title}** — ${j.text} (${j.reward_coins} monedas; lo pide ${this.world.npc(j.giver_npc_id).name})`).join('\n') : 'El tablón está vacío.';
  }

  private async resolveWithMaster(c: Character, text: string, roll?: { original_text: string; result: CheckResult & { label: string } }, intro?: { origin: string; welcome: string }, scene?: MasterScene, decisive?: { seconds: number; speed: 'fast' | 'normal'; threat: string }): Promise<ActionResult> {
    const t0 = Date.now();
    const out = await this.master!.resolve(c, text, roll, intro, scene, decisive);
    if (out.ok) { this.masterOk.push({ ts: Date.now(), ms: Date.now() - t0 }); if (this.masterOk.length > 500) this.masterOk.shift(); }
    else { this.masterErr.push({ ts: Date.now(), reason: out.reason, message: out.message.slice(0, 200) }); if (this.masterErr.length > 100) this.masterErr.shift(); }
    if (!out.ok) {
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
    };
    const event = this.events.emit({
      actor_id: c.id, action_type: intro ? 'master_intro' : scene === 'arrival' ? 'master_arrival' : scene === 'hook' ? 'master_hook' : roll ? 'master_roll_outcome' : 'master', input_text: intro || scene ? null : text,
      narration_private: k.narration_private, observable: k.observable, loudness: k.loudness, tags: ['master', ...k.tags], payload,
    }, this.now());
    if (k.requires_roll) this.pendingRolls.set(c.id, { text, roll: k.requires_roll, event_id: event.id });
    if (k.decisive && scene !== 'decisive_timeout' && c.status === 'active') this.openDecisive(c, k.decisive, event.id);
    if (out.progress?.length) this.emitProgress(c, out.progress);
    const r: ActionResult = { ok: true, text: k.narration_private, event, suggested_actions: k.suggested_actions };
    if (k.requires_roll) r.requires_roll = k.requires_roll;
    return r;
  }

  /** Comandos de sistema (SPEC §2.4). Sin LLM, sin cola. */
  async command(characterId: Id, name: string): Promise<string> {
    await this.tick();
    const c = this.world.character(characterId);
    const nowG = this.gameNow();
    switch (name.replace(/^\//, '')) {
      case 'where': return whereAmI(this.world, this.clock, c, nowG);
      case 'who': return whoIsHere(this.world, this.clock, c, nowG);
      case 'inventory': return formatInventory(inventoryView(this.world, c.id));
      case 'look': return describeSurroundings(this.world, this.clock, c, nowG);
      case 'recap': {
        const missed = this.recapFor(c.id);
        return missed.length ? missed.map((d) => `· ${d.text}`).join('\n') : 'No te has perdido nada.';
      }
      case 'time': return `${this.clock.format(nowG)} (ratio ${this.clock.timeRatio}×).`;
      case 'tablon': return this.boardText();
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
  async createCharacter(userId: Id, name: string, spec?: Partial<CharacterSpec>): Promise<{ ok: true; character: Character } | { ok: false; reason: string }> {
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
      observable: `${c.name} llega a ${start.name}.`, tags: ['milestone:join'], payload: { observable_vague: 'Alguien llega.' },
    }, this.now());
    this.firstVisit({ character_id: c.id, location_id: loc.id, game_s: this.gameNow() });
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
   * Primera escena (SPEC §11.2.1): el master narra la llegada con el origen del
   * punto de inicio, la premisa como ambiente y un gancho. El adaptador la pide
   * cuando el canal del jugador ya existe. Sin master, no hay intro.
   */
  async introduce(characterId: Id): Promise<ActionResult | null> {
    if (!this.master) return null;
    await this.tick();
    const c = this.world.character(characterId);
    const spot = this.world.characterSpot(c)!;
    const origin = this.world.campaign.starting_points.find((p) => p.spot_id === spot.id)?.origin ?? c.backstory;
    const locId = spot.location_id;
    return this.runInLocation(locId, async () => {
      const r = await this.resolveWithMaster(c, '(primera escena)', undefined, { origin, welcome: this.world.campaign.welcome.replaceAll('{name}', c.name) });
      await this.flush();
      return r.ok ? r : null;
    });
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
  // Parser de acciones de fase 1
  // -------------------------------------------------------------------------

  private resolveAction(c: Character, text: string): ActionResult {
    const nowG = this.gameNow();
    const lower = text.toLowerCase();

    if (c.status === 'asleep' && !/^(despierto|despertar|me despierto|wake)/.test(lower)) {
      return { ok: false, text: 'Estás dormido. Escribe «despierto» para levantarte.' };
    }
    if (c.status !== 'active' && c.status !== 'asleep') {
      return { ok: false, text: `No puedes actuar (${c.status}).` };
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
    if (/^(dormir|duermo|me duermo|descansar|descanso|sleep)\b/.test(lower)) {
      if (c.transit) interruptTransit(this.world, c, nowG);
      c.status = 'asleep';
      this.world.touch('characters', c.id);
      const spot = this.world.characterSpot(c)!;
      return this.emit(c, text, 'sleep', `Te acomodas en ${spot.name} y te duermes. Un descanso largo son 8 h de juego (${fmtDuration(this.clock.gameToReal(8 * 3600))} reales).`, `${c.name} se tumba y se duerme.`);
    }
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
    return { ok: false, text: 'No entiendo qué quieres hacer. Prueba: mirar, ir a <sitio>, coger <cosa>, soltar <cosa>, guardar <cosa> en <contenedor>, talar <árbol>, decir <texto>, dormir.' };
  }

  private emitPrivate(c: Character, input: string, type: string, priv: string, obs: string): ActionResult {
    return this.emit(c, input, type, priv, obs, 1, {});
  }

  private emit(c: Character, input: string, type: string, priv: string, obs: string | null, loudness = 1, payload: Record<string, unknown> = {}, alsoTo: Id[] = [], channel: 'sight' | 'sound' | 'any' = 'any'): ActionResult {
    const event = this.events.emit({
      actor_id: c.id, action_type: type, input_text: input, narration_private: priv, observable: obs, loudness, payload, also_to: alsoTo, channel,
    }, this.now());
    return { ok: true, text: priv, event };
  }

  private ambiguous<T>(r: Extract<Resolution<T>, { kind: 'many' }>): ActionResult {
    return { ok: false, text: `¿Cuál? ${r.candidates.map((x) => x.matched).join(' / ')}` };
  }

  private doMove(c: Character, input: string, target: string, pace: Pace): ActionResult {
    const r = resolveSpot(this.world, c, target);
    if (r.kind === 'none') return { ok: false, text: `No conoces ningún sitio llamado «${target}».` };
    if (r.kind === 'many') return this.ambiguous(r);
    const nowG = this.gameNow();
    const from = this.world.spot(positionOf(this.world, c, nowG).spot_id);
    const res = moveTo(this.world, c.id, r.value, pace, nowG);
    if (!res.ok) return { ok: false, text: moveErrorText(this.world, res.error) };
    const dest = this.world.spot(r.value);
    const game = fmtDuration(res.total_s);
    const real = fmtDuration(this.clock.gameToReal(res.total_s));
    const paceTxt = pace === 'run' ? 'corriendo' : pace === 'stealth' ? 'con sigilo' : 'andando';
    return this.emit(c, input, 'move', `Te pones en marcha hacia ${dest.name} ${paceTxt}. Tardarás ${game} de juego (${real} reales).`,
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
        return this.emit(c, input, 'take', `Coges ${def.name} ${where}.`, `${c.name} coge ${def.name} del suelo de ${here.name}.`, 1, { observable_vague: 'Una figura se agacha a coger algo.' });
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
      if (res.ok) return this.emit(c, input, 'take_out', `Sacas ${def.name} de ${contDef.name}.`, `${c.name} saca ${def.name} de ${contDef.name}.`);
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
    if (target.status !== 'active') return { ok: false, text: `${target.name} no está en condiciones de recibir nada.` };
    const def = this.world.itemDef(this.world.itemInstance(item.value).item_id);
    // Fase 1: sin doble confirmación (llega con la economía, fase 3). Va a la mano libre o al bolsillo.
    for (const slot of [{ kind: 'hand', which: 'main' }, { kind: 'hand', which: 'off' }, { kind: 'pocket' }] as const) {
      const res = transferItem(this.world, item.value, { type: 'character', id: target.id, slot });
      if (res.ok) {
        return this.emit(c, input, 'give', `Le das ${def.name} a ${target.name}.`, `${c.name} le da ${def.name} a ${target.name}.`, 1, {}, [target.id]);
      }
      if (res.error.code !== 'no_space') return { ok: false, text: transferErrorText(res.error) };
    }
    return { ok: false, text: `${target.name} no tiene dónde meterlo.` };
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
