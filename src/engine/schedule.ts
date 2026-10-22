/**
 * Agenda del mundo (SPEC §1.3, §3.1): lo que pasa a su hora aunque nadie mire.
 *
 * Dos piezas, las dos como propiedades opcionales (sin tocar el modelo):
 *   - `campaign.schedule`: eventos programados (la misa de las ocho, el mercado
 *     de la mañana) con sitio, hora, duración, recurrencia, NPC que acuden,
 *     figurantes y efectos sobre el lugar mientras duran.
 *   - `npc.routine`: horario simple por franjas (día, tarde, noche).
 *
 * El motor llama a `tickSchedule` en cada tick: sin IA, calcula qué eventos
 * están activos, aplica y deshace sus efectos, mueve a los NPC a su sitio y de
 * vuelta, y emite eventos por plantilla que perciben los presentes (y, si hay
 * ruido, quien lo oiga desde la localización de al lado). Los figurantes
 * («una docena de vecinos») no son NPC: son presencia agregada del lugar.
 *
 * El estado vivo (qué ocurrencias están en marcha, dónde estaba cada NPC antes
 * de acudir, qué valores tenía el lugar) va en `campaign.schedule_active`, para
 * que un reinicio no repita ni pierda arranques.
 */

import { GAME_DAY, GAME_HOUR, GAME_MINUTE } from '../clock/clock.js';
import type { EmitInput } from './events.js';
import type { Id, LightLevel, Location, Npc, Spot } from './model.js';
import type { Position } from './movement.js';
import type { World } from './world.js';

export type Recurrence = 'daily' | 'weekly' | 'once';
export const RECURRENCES: readonly Recurrence[] = ['daily', 'weekly', 'once'];

/** Figurantes sin ficha: «feligreses ×12». */
export interface Crowd { label: string; count: number }

/** Lo que cambia en el lugar mientras dura. Se deshace al acabar. */
export interface ScheduleEffects {
  /** Ruido ambiente 0–1 (tapa el oído: un mercado, 0.5). */
  noise?: number;
  /** Luz de interior (velas, lámparas). Al aire libre manda el sol. */
  light?: LightLevel;
  /** Claves que se añaden a `location.state` («puestos»: «…»). */
  state?: Record<string, unknown>;
  /** NPC ocupados mientras dura (oficiando, despachando): atienden solo si hay motivo. */
  busy_npc_ids?: Id[];
}

export interface ScheduledEvent {
  id: Id;
  /** Con artículo: «la misa», «el mercado». */
  title: string;
  location_id: Id;
  spot_id: Id;
  /** Hora del día de inicio, decimal (20.5 = 20:30). En `once`, informativa. */
  start_h: number;
  duration_min: number;
  recurrence: Recurrence;
  /** Solo `weekly`: índice en `calendar.day_names`. */
  weekday?: number | null;
  /** Solo `once`: instante de inicio en segundos de juego. */
  at_game_s?: number | null;
  /** Qué pasa, para el máster. */
  description: string;
  /** NPC con ficha que acuden al punto del evento. */
  npc_ids: Id[];
  crowd: Crowd[];
  effects: ScheduleEffects;
  /** Volumen del arranque (1 conversación, 3 gentío, 15 campanas). */
  loudness?: number;
  /** Plantillas para quien está allí; si faltan, se componen. */
  start_text?: string | null;
  end_text?: string | null;
  /** PJs a los que se lo han anunciado (para «Próximo aquí» y lo que sabe el actor). */
  announced_to?: Id[];
  source?: 'seed' | 'master' | 'worldgen';
}

/** Horario de un NPC por franjas. La tarde, si falta, es la del día. Sin franja, se queda donde esté. */
export interface NpcRoutine { day?: Id; afternoon?: Id; night?: Id }
export type Slot = 'day' | 'afternoon' | 'night';

/** Ocurrencia en marcha. */
export interface ActiveRun {
  event_id: Id;
  start_s: number;
  end_s: number;
  /** Dónde estaba cada NPC antes de acudir (también marca quién ya ha llegado). */
  home: Record<Id, Id>;
  /** Valores del lugar antes de los efectos. */
  prev: { noise?: number; light?: Location['ambience']['light']; state?: Record<string, unknown>; missing?: string[] };
}

export const MAX_EVENTS_PER_LOCATION = 8;
export const MAX_EVENTS = 64;
/** A partir de la tarde (hasta la puesta de sol). */
export const AFTERNOON_H = 14;
/** Si un arranque o un final se procesa más tarde que esto (proceso parado), se aplica sin narrarlo. */
export const LATE_S = 15 * GAME_MINUTE;
/** Ventana de «Próximo aquí» para quien no ha sido avisado. */
export const SOON_S = GAME_HOUR;

type Store = { schedule?: ScheduledEvent[]; schedule_active?: ActiveRun[] };
type RoutineNpc = Npc & { routine?: NpcRoutine };

function camp(world: World): Store { return world.campaign as typeof world.campaign & Store; }
function events(world: World): ScheduledEvent[] { return camp(world).schedule ?? []; }
function runs(world: World): ActiveRun[] { return (camp(world).schedule_active ??= []); }

export function allScheduled(world: World): readonly ScheduledEvent[] { return events(world); }
export function activeRuns(world: World): readonly ActiveRun[] { return camp(world).schedule_active ?? []; }
export function routineOf(n: Npc): NpcRoutine | null { return (n as RoutineNpc).routine ?? null; }

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

function weekLen(world: World): number { return world.campaign.calendar.day_names.length || 1; }

/** Inicio de la ocurrencia de `e` en ese día, o null si ese día no toca. */
function startOnDay(world: World, e: ScheduledEvent, day: number): number | null {
  if (e.recurrence === 'once') return null;
  if (e.recurrence === 'weekly' && ((day % weekLen(world)) + weekLen(world)) % weekLen(world) !== (e.weekday ?? 0)) return null;
  return day * GAME_DAY + Math.round(e.start_h * GAME_HOUR);
}

/** Ocurrencia en curso a esa hora, si la hay. */
export function occurrenceAt(world: World, e: ScheduledEvent, nowS: number): { start_s: number; end_s: number } | null {
  const dur = e.duration_min * GAME_MINUTE;
  if (e.recurrence === 'once') {
    const s = e.at_game_s;
    return s != null && s <= nowS && nowS < s + dur ? { start_s: s, end_s: s + dur } : null;
  }
  const today = Math.floor(nowS / GAME_DAY);
  for (const d of [today, today - 1]) {
    const s = startOnDay(world, e, d);
    if (s !== null && s <= nowS && nowS < s + dur) return { start_s: s, end_s: s + dur };
  }
  return null;
}

/** Próximo inicio estrictamente posterior a `nowS`, o null si no hay más. */
export function nextStart(world: World, e: ScheduledEvent, nowS: number): number | null {
  if (e.recurrence === 'once') return e.at_game_s != null && e.at_game_s > nowS ? e.at_game_s : null;
  const today = Math.floor(nowS / GAME_DAY);
  for (let d = today; d <= today + weekLen(world) + 1; d++) {
    const s = startOnDay(world, e, d);
    if (s !== null && s > nowS) return s;
  }
  return null;
}

export function isActive(world: World, e: ScheduledEvent, nowS: number): boolean { return occurrenceAt(world, e, nowS) !== null; }

/** Franja del día: noche entre la puesta y la salida del sol; tarde desde las 14. */
export function slotAt(world: World, nowS: number): Slot {
  const h = (((nowS % GAME_DAY) + GAME_DAY) % GAME_DAY) / GAME_HOUR;
  const { sunrise_h, sunset_h } = world.campaign.calendar;
  if (h >= sunset_h || h < sunrise_h) return 'night';
  return h < AFTERNOON_H ? 'day' : 'afternoon';
}

export function routineSpot(n: Npc, slot: Slot): Id | null {
  const r = routineOf(n);
  if (!r) return null;
  return (slot === 'afternoon' ? r.afternoon ?? r.day : r[slot]) ?? null;
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

const NUM_ES = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];

/** «una docena de vecinos», «unas treinta personas», «un fraile». */
export function crowdPhrase(c: Crowd): string {
  const fem = /as$/i.test(c.label);
  if (c.count <= 1) return `${fem ? 'una' : 'un'} ${c.label}`;
  if (c.count === 12) return `una docena de ${c.label}`;
  if (c.count <= 5) return `${NUM_ES[c.count]} ${c.label}`;
  const rounded = c.count > 20 ? Math.round(c.count / 10) * 10 : c.count;
  const tens: Record<number, string> = { 30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta', 70: 'setenta', 80: 'ochenta', 90: 'noventa' };
  const word = rounded <= 20 ? NUM_ES[rounded]! : rounded >= 100 ? 'un centenar de' : tens[rounded] ?? String(rounded);
  return word === 'un centenar de' ? `${word} ${c.label}` : `${fem ? 'unas' : 'unos'} ${word} ${c.label}`;
}

function crowdList(cs: Crowd[]): string {
  const xs = cs.map(crowdPhrase);
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`;
}

/** «al pozo», «a la barra». */
function aEs(name: string): string { return /^el /i.test(name) ? `al ${name.slice(3)}` : `a ${name}`; }
/** «del pozo», «de la barra». */
function deEs(name: string): string { return /^el /i.test(name) ? `del ${name.slice(3)}` : `de ${name}`; }
/** «junto al pozo», «junto a la barra». */
function juntoA(name: string): string { return `junto ${aEs(name)}`; }

/** «20:00». */
export function hhmm(s: number): string {
  const r = ((Math.floor(s) % GAME_DAY) + GAME_DAY) % GAME_DAY;
  return `${Math.floor(r / GAME_HOUR)}:${String(Math.floor((r % GAME_HOUR) / GAME_MINUTE)).padStart(2, '0')}`;
}

/** «hoy a las 20:00», «mañana a las 9:00», «el Domingo a las 8:00». */
export function whenEs(world: World, s: number, nowS: number): string {
  const d = Math.floor(s / GAME_DAY) - Math.floor(nowS / GAME_DAY);
  const day = d <= 0 ? 'hoy' : d === 1 ? 'mañana' : `el ${world.campaign.calendar.day_names[Math.floor(s / GAME_DAY) % weekLen(world)] ?? `día ${Math.floor(s / GAME_DAY) + 1}`}`;
  return `${day} a las ${hhmm(s)}`;
}

function recurrenceEs(world: World, e: ScheduledEvent): string {
  switch (e.recurrence) {
    case 'daily': return `cada día a las ${hhmm(e.start_h * GAME_HOUR)}`;
    case 'weekly': return `cada ${world.campaign.calendar.day_names[e.weekday ?? 0] ?? 'semana'} a las ${hhmm(e.start_h * GAME_HOUR)}`;
    case 'once': return `una vez, ${e.at_game_s != null ? `día ${Math.floor(e.at_game_s / GAME_DAY) + 1} a las ${hhmm(e.at_game_s)}` : 'sin fecha'}`;
  }
}

function startText(world: World, e: ScheduledEvent): string {
  if (e.start_text) return e.start_text;
  const spot = world.spot(e.spot_id);
  const people = e.crowd.length ? `: ${crowdList(e.crowd)} se juntan ${juntoA(spot.name)}` : '';
  return `Empieza a llegar gente${people}. Empieza ${e.title}.`;
}

function endText(e: ScheduledEvent): string {
  return e.end_text ?? `Termina ${e.title}; la gente se va dispersando.`;
}

function posOf(s: Spot): Position {
  return { spot_id: s.id, next_spot_id: null, progress: 0, x: s.x, y: s.y, location_id: s.location_id };
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/** Emite un evento a la hora de juego dada (el motor lo convierte a real). */
export type ScheduleEmit = (input: EmitInput, atGameS: number) => void;

/**
 * Avanza la agenda hasta `nowS`: cierra lo que ha acabado, arranca lo que
 * empieza, lleva a los NPC pendientes a su sitio y aplica los horarios.
 */
export function tickSchedule(world: World, nowS: number, emit: ScheduleEmit): void {
  const active = runs(world);
  const evs = events(world);
  let touched = false;

  // 1. Finales (o eventos borrados con una ocurrencia en marcha).
  for (const run of [...active]) {
    const e = evs.find((x) => x.id === run.event_id);
    if (e && nowS < run.end_s) continue;
    active.splice(active.indexOf(run), 1);
    touched = true;
    if (e) endRun(world, e, run, nowS, emit);
    if (e?.recurrence === 'once') evs.splice(evs.indexOf(e), 1);
  }
  // Únicos que pasaron enteros sin que nadie los procesara.
  for (const e of [...evs]) {
    if (e.recurrence === 'once' && e.at_game_s != null && e.at_game_s + e.duration_min * GAME_MINUTE <= nowS && !active.some((r) => r.event_id === e.id)) {
      evs.splice(evs.indexOf(e), 1);
      touched = true;
    }
  }

  // 2. Arranques.
  for (const e of evs) {
    const occ = occurrenceAt(world, e, nowS);
    if (!occ || active.some((r) => r.event_id === e.id && r.start_s === occ.start_s)) continue;
    if (!world.locations.has(e.location_id) || !world.spots.has(e.spot_id)) continue;
    const run: ActiveRun = { event_id: e.id, start_s: occ.start_s, end_s: occ.end_s, home: {}, prev: {} };
    active.push(run);
    touched = true;
    startRun(world, e, run, nowS, emit);
  }

  // 3. NPC que aún no han llegado (estaban hablando con alguien).
  for (const run of active) {
    const e = evs.find((x) => x.id === run.event_id);
    if (e) bringAttendees(world, e, run, nowS, emit, nowS - run.start_s > LATE_S);
  }

  // 4. Horarios de quien no está en un evento.
  const attending = new Set(active.flatMap((r) => Object.keys(r.home)));
  const slot = slotAt(world, nowS);
  for (const n of world.npcs.values()) {
    if (n.status !== 'alive' || attending.has(n.id) || n.talking_to) continue;
    const want = routineSpot(n, slot);
    if (want && want !== n.location.id && world.spots.has(want)) moveNpc(world, n, want, nowS, emit, null, false);
  }

  if (touched) world.touch('campaign', world.campaign.id);
}

function startRun(world: World, e: ScheduledEvent, run: ActiveRun, nowS: number, emit: ScheduleEmit): void {
  const late = nowS - run.start_s > LATE_S;
  const loc = world.location(e.location_id);
  const eff = e.effects ?? {};
  if (eff.noise != null) { run.prev.noise = loc.ambience.noise; loc.ambience.noise = eff.noise; }
  if (eff.light) { run.prev.light = loc.ambience.light; loc.ambience.light = eff.light; }
  if (eff.state) {
    run.prev.state = {};
    run.prev.missing = [];
    for (const [k, v] of Object.entries(eff.state)) {
      if (k in loc.state) run.prev.state[k] = loc.state[k]; else run.prev.missing.push(k);
      loc.state[k] = v;
    }
  }
  world.touch('locations', loc.id);
  const at = late ? nowS : run.start_s;
  if (!late) {
    const spot = world.spot(e.spot_id);
    const loud = e.loudness ?? 3;
    const text = startText(world, e);
    emit({
      actor_id: null, at: posOf(spot), action_type: 'scheduled_start', narration_private: '', observable: text,
      loudness: loud, tags: ['schedule', 'deterministic'],
      payload: { master: null, schedule_event_id: e.id, observable_vague: text, observable_hint: `Se oye gente que se junta a lo lejos.` },
    }, at);
    echoToNeighbours(world, e, spot, loud, at, emit);
  }
  bringAttendees(world, e, run, nowS, emit, late);
}

function endRun(world: World, e: ScheduledEvent, run: ActiveRun, nowS: number, emit: ScheduleEmit): void {
  const late = nowS - run.end_s > LATE_S;
  const loc = world.locations.get(e.location_id);
  if (loc) {
    if (run.prev.noise != null && loc.ambience.noise === e.effects?.noise) loc.ambience.noise = run.prev.noise;
    if (run.prev.light && loc.ambience.light === e.effects?.light) loc.ambience.light = run.prev.light;
    for (const [k, v] of Object.entries(run.prev.state ?? {})) loc.state[k] = v;
    for (const k of run.prev.missing ?? []) delete loc.state[k];
    world.touch('locations', loc.id);
  }
  const at = late ? nowS : run.end_s;
  if (!late && world.spots.has(e.spot_id)) {
    emit({
      actor_id: null, at: posOf(world.spot(e.spot_id)), action_type: 'scheduled_end', narration_private: '', observable: endText(e),
      loudness: 1.5, tags: ['schedule', 'deterministic'],
      payload: { master: null, schedule_event_id: e.id, observable_vague: endText(e), observable_hint: 'A lo lejos, la gente se dispersa.' },
    }, at);
  }
  // De vuelta: a su franja si tiene horario; si no, a donde estaba.
  const slot = slotAt(world, nowS);
  for (const [npcId, home] of Object.entries(run.home)) {
    const n = world.npcs.get(npcId);
    if (!n || n.status !== 'alive') continue;
    const back = routineSpot(n, slot) ?? home;
    if (world.spots.has(back) && back !== n.location.id) moveNpc(world, n, back, at, emit, null, late);
  }
}

function bringAttendees(world: World, e: ScheduledEvent, run: ActiveRun, nowS: number, emit: ScheduleEmit, quiet: boolean): void {
  for (const id of e.npc_ids) {
    if (id in run.home) continue;
    const n = world.npcs.get(id);
    if (!n || n.status !== 'alive' || n.talking_to) continue;
    run.home[id] = n.location.id;
    world.touch('campaign', world.campaign.id);
    if (n.location.id !== e.spot_id) moveNpc(world, n, e.spot_id, Math.max(run.start_s, Math.min(nowS, run.end_s)), emit, e, quiet);
  }
}

/** Mueve un NPC al instante y lo cuenta a quien lo vea salir o llegar. */
function moveNpc(world: World, n: Npc, toId: Id, atS: number, emit: ScheduleEmit, e: ScheduledEvent | null, quiet: boolean): void {
  const from = world.spot(n.location.id);
  const to = world.spot(toId);
  n.location = { type: 'spot', id: to.id };
  world.touch('npcs', n.id);
  if (quiet) return;
  const base = { actor_id: null, action_type: 'npc_move', narration_private: '', tags: ['npc', 'schedule', 'deterministic'] };
  const payload = (vague: string) => ({ master: null, npc_id: n.id, ...(e ? { schedule_event_id: e.id } : {}), observable_vague: vague });
  if (from.location_id === to.location_id) {
    emit({ ...base, at: posOf(to), observable: `${n.name} deja ${from.name} y va ${aEs(to.name)}.`, payload: payload(`Alguien cruza hacia ${to.name}.`) }, atS);
    return;
  }
  const goal = e ? `, camino ${deEs(e.title)}` : '';
  emit({ ...base, at: posOf(from), observable: `${n.name} se va ${deEs(from.name)}${goal}.`, payload: payload('Una figura se marcha.') }, atS);
  emit({ ...base, at: posOf(to), observable: `${n.name} llega ${aEs(to.name)}${e ? ` para ${e.title}` : ''}.`, payload: payload(`Una figura llega ${aEs(to.name)}.`) }, atS);
}

/**
 * El ruido del arranque llega a las localizaciones de al lado por sus salidas
 * si cabe en el radio de oído (hearing_base × volumen). Allí se emite como
 * sonido atenuado y lo oye quien lo perciba.
 */
function echoToNeighbours(world: World, e: ScheduledEvent, spot: Spot, loud: number, atS: number, emit: ScheduleEmit): void {
  const reach = world.campaign.perception_rules.hearing_base_m * loud;
  const loc = world.location(e.location_id);
  const done = new Set<Id>();
  for (const s of world.spotsOf(loc.id)) {
    for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
      const far = world.spot(to_spot_id);
      if (far.location_id === loc.id || done.has(far.location_id)) continue;
      const d = Math.hypot(s.x - spot.x, s.y - spot.y) + exit.distance_m;
      if (d >= reach) continue;
      done.add(far.location_id);
      const text = `Desde ${loc.name} llega ruido de gente: ${e.title}.`;
      emit({
        actor_id: null, at: posOf(far), action_type: 'scheduled_echo', narration_private: '', observable: text,
        loudness: loud * (1 - d / reach), channel: 'sound', tags: ['schedule', 'deterministic'],
        payload: { master: null, schedule_event_id: e.id, observable_vague: text, observable_hint: 'Se oye algo a lo lejos, fuera.' },
      }, atS);
    }
  }
}

// ---------------------------------------------------------------------------
// Contexto del máster y presencia
// ---------------------------------------------------------------------------

/** Ocurrencias en marcha en una localización, con su evento. */
export function activeIn(world: World, locationId: Id, nowS: number): { event: ScheduledEvent; run: ActiveRun }[] {
  const out: { event: ScheduledEvent; run: ActiveRun }[] = [];
  for (const run of activeRuns(world)) {
    const event = events(world).find((e) => e.id === run.event_id);
    if (event && event.location_id === locationId && run.start_s <= nowS && nowS < run.end_s) out.push({ event, run });
  }
  return out;
}

/** Una frase para quien está allí (plantillas de llegada y /look). Null si no pasa nada. */
export function presenceLine(world: World, locationId: Id, nowS: number): string | null {
  const now = activeIn(world, locationId, nowS);
  if (!now.length) return null;
  return now.map(({ event }) => `Ahora mismo: ${event.title}${event.crowd.length ? `, con ${crowdList(event.crowd)}` : ''} ${juntoA(world.spot(event.spot_id).name)}.`).join(' ');
}

function npcLabel(world: World, id: Id): string {
  const n = world.npcs.get(id);
  return n ? `${n.name} (${n.role}) [${n.id}]` : id;
}

/**
 * Bloque «## Agenda» del contexto: lo que pasa aquí ahora, lo que viene en
 * menos de una hora (o lo que le anunciaron al actor) y lo que el actor sabe
 * que pasará en otros sitios. Null si no hay nada.
 */
export function scheduleContext(world: World, actorId: Id, locationId: Id, nowS: number): string | null {
  const L: string[] = [];
  for (const { event: e } of activeIn(world, locationId, nowS)) {
    const run = activeRuns(world).find((r) => r.event_id === e.id)!;
    const busy = (e.effects?.busy_npc_ids ?? []).map((id) => npcLabel(world, id));
    const going = e.npc_ids.filter((id) => !(e.effects?.busy_npc_ids ?? []).includes(id)).map((id) => npcLabel(world, id));
    L.push([
      `Ahora mismo aquí: ${e.title} (hasta las ${hhmm(run.end_s)}, ${world.spot(e.spot_id).name})`,
      e.crowd.length ? `, ${e.crowd.map((c) => `${c.label} ×${c.count}`).join(', ')}` : '',
      going.length ? `; acuden ${going.join(', ')}` : '',
      busy.length ? `; ocupados: ${busy.join(', ')}` : '',
      `. ${e.description} [${e.id}]`,
    ].join(''));
  }
  const elsewhere: string[] = [];
  for (const e of events(world)) {
    if (isActive(world, e, nowS) && e.location_id === locationId) continue;
    const next = nextStart(world, e, nowS);
    if (next === null) continue;
    const told = (e.announced_to ?? []).includes(actorId);
    if (e.location_id === locationId && (told || next - nowS <= SOON_S)) {
      L.push(`Próximo aquí: ${e.title} ${whenEs(world, next, nowS)} (${e.duration_min} min, ${world.spot(e.spot_id).name})${told ? '; el actor lo sabe' : ''}. [${e.id}]`);
    } else if (told && e.location_id !== locationId) {
      elsewhere.push(`${e.title} en ${world.locations.get(e.location_id)?.name ?? e.location_id} ${whenEs(world, next, nowS)} [${e.id}]`);
    }
  }
  if (elsewhere.length) L.push(`El actor sabe que habrá: ${elsewhere.join('; ')}.`);
  if (!L.length) return null;
  return `## Agenda (el servidor la cumple: a su hora llega la gente y se mueven los NPC)\n${L.map((l) => `- ${l}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// Alta, consulta, aviso (tools del máster)
// ---------------------------------------------------------------------------

export interface ScheduleInput {
  title: string;
  location_id: Id;
  spot_id?: Id | null;
  start_h: number;
  duration_min: number;
  recurrence: string;
  /** Solo weekly: índice o nombre del día. */
  weekday?: number | string | null;
  /** Solo once: días a partir de hoy (0 = hoy si aún no ha pasado la hora; si ha pasado, mañana). */
  days_from_now?: number | null;
  description: string;
  npc_ids?: Id[];
  crowd?: Crowd[] | string | null;
  noise?: number | null;
  light?: LightLevel | null;
  state?: Record<string, unknown> | null;
  busy_npc_ids?: Id[];
  loudness?: number | null;
  start_text?: string | null;
  end_text?: string | null;
  /** Quién se ha enterado al programarlo (el actor al que se lo anuncian). */
  announced_to?: Id | null;
  source?: ScheduledEvent['source'];
}

/** «feligreses ×12; un fraile», «12 vecinos», «vecinos x 20». */
export function parseCrowd(raw: string | Crowd[] | null | undefined): Crowd[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((c) => c && c.label && c.count > 0).map((c) => ({ label: String(c.label).trim(), count: Math.min(500, Math.round(c.count)) }));
  const out: Crowd[] = [];
  for (const part of raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    let m = /^(.+?)\s*[×x*]\s*(\d+)$/i.exec(part);
    if (m) { out.push({ label: m[1]!.trim(), count: Number(m[2]) }); continue; }
    m = /^(\d+)\s+(.+)$/.exec(part);
    if (m) { out.push({ label: m[2]!.trim(), count: Number(m[1]) }); continue; }
    m = /^una docena de\s+(.+)$/i.exec(part);
    if (m) { out.push({ label: m[1]!.trim(), count: 12 }); continue; }
    m = /^un[ao]?\s+(.+)$/i.exec(part);
    out.push({ label: (m ? m[1]! : part).trim(), count: 1 });
  }
  return out.map((c) => ({ ...c, count: Math.max(1, Math.min(500, c.count)) }));
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(el|la|los|las)\s+/, '').trim();
}

export function findScheduled(world: World, locationId: Id, title: string): ScheduledEvent | null {
  return events(world).find((e) => e.location_id === locationId && norm(e.title) === norm(title)) ?? null;
}

export function announce(world: World, eventId: Id, characterId: Id): boolean {
  const e = events(world).find((x) => x.id === eventId);
  if (!e || !world.characters.has(characterId)) return false;
  e.announced_to ??= [];
  if (!e.announced_to.includes(characterId)) { e.announced_to.push(characterId); world.touch('campaign', world.campaign.id); }
  return true;
}

/**
 * Programa un evento (o, si ya hay uno con ese título en ese sitio, lo
 * devuelve y anota a quién se lo han dicho: lo que un NPC anuncia existe).
 */
export function addScheduledEvent(world: World, input: ScheduleInput, nowS: number): { ok: true; event: ScheduledEvent; existing: boolean } | { ok: false; error: string } {
  const title = (input.title ?? '').trim();
  if (!title || title.length > 80) return { ok: false, error: 'title vacío o demasiado largo (máx. 80)' };
  const loc = world.locations.get(input.location_id);
  if (!loc) return { ok: false, error: `no existe la localización ${input.location_id}` };
  const same = findScheduled(world, loc.id, title);
  if (same) {
    if (input.announced_to) announce(world, same.id, input.announced_to);
    return { ok: true, event: same, existing: true };
  }
  const spotId = input.spot_id || loc.default_spot_id;
  const spot = world.spots.get(spotId);
  if (!spot || spot.location_id !== loc.id) return { ok: false, error: `el punto ${spotId} no está en ${loc.id}` };
  const h = Number(input.start_h);
  if (!Number.isFinite(h) || h < 0 || h >= 24) return { ok: false, error: 'start_h debe estar entre 0 y 23.99' };
  const dur = Math.round(Number(input.duration_min));
  if (!Number.isFinite(dur) || dur < 5 || dur > 23 * 60) return { ok: false, error: 'duration_min debe estar entre 5 y 1380' };
  const recurrence = input.recurrence as Recurrence;
  if (!RECURRENCES.includes(recurrence)) return { ok: false, error: `recurrence debe ser ${RECURRENCES.join(' | ')}` };
  const description = (input.description ?? '').trim();
  if (!description || description.length > 600) return { ok: false, error: 'description vacía o demasiado larga (máx. 600)' };
  const npcIds = [...new Set(input.npc_ids ?? [])];
  const busy = [...new Set(input.busy_npc_ids ?? [])];
  for (const id of [...npcIds, ...busy]) if (!world.npcs.has(id)) return { ok: false, error: `no existe el NPC ${id}` };
  if (events(world).length >= MAX_EVENTS) return { ok: false, error: 'la agenda está llena' };
  if (events(world).filter((e) => e.location_id === loc.id).length >= MAX_EVENTS_PER_LOCATION) return { ok: false, error: 'demasiados eventos en esta localización' };

  let weekday: number | null = null;
  if (recurrence === 'weekly') {
    const names = world.campaign.calendar.day_names.map(norm);
    const w = input.weekday;
    weekday = typeof w === 'number' ? w : w != null && /^\d+$/.test(String(w)) ? Number(w) : names.indexOf(norm(String(w ?? '')));
    if (weekday < 0 || weekday >= weekLen(world)) return { ok: false, error: `weekday debe ser uno de: ${world.campaign.calendar.day_names.join(', ')}` };
  }
  let at: number | null = null;
  if (recurrence === 'once') {
    const days = Math.max(0, Math.round(Number(input.days_from_now ?? 0)) || 0);
    at = (Math.floor(nowS / GAME_DAY) + days) * GAME_DAY + Math.round(h * GAME_HOUR);
    if (at <= nowS) at += GAME_DAY;
  }
  const noise = input.noise == null ? undefined : Math.max(0, Math.min(1, Number(input.noise)));
  const effects: ScheduleEffects = {
    ...(noise != null && Number.isFinite(noise) ? { noise } : {}),
    ...(input.light ? { light: input.light } : {}),
    ...(input.state && Object.keys(input.state).length ? { state: input.state } : {}),
    ...(busy.length ? { busy_npc_ids: busy } : {}),
  };
  const event: ScheduledEvent = {
    id: `se_${Math.round(nowS).toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title, location_id: loc.id, spot_id: spot.id, start_h: h, duration_min: dur, recurrence,
    ...(weekday !== null ? { weekday } : {}), ...(at !== null ? { at_game_s: at } : {}),
    description, npc_ids: npcIds, crowd: parseCrowd(input.crowd), effects,
    ...(input.loudness != null && Number.isFinite(Number(input.loudness)) ? { loudness: Math.max(0.2, Math.min(20, Number(input.loudness))) } : {}),
    ...(input.start_text ? { start_text: input.start_text.trim() } : {}),
    ...(input.end_text ? { end_text: input.end_text.trim() } : {}),
    announced_to: input.announced_to && world.characters.has(input.announced_to) ? [input.announced_to] : [],
    source: input.source ?? 'master',
  };
  (camp(world).schedule ??= []).push(event);
  world.touch('campaign', world.campaign.id);
  return { ok: true, event, existing: false };
}

export function cancelScheduledEvent(world: World, eventId: Id): boolean {
  const evs = events(world);
  const i = evs.findIndex((e) => e.id === eventId);
  if (i < 0) return false;
  evs.splice(i, 1); // si estaba en marcha, el próximo tick la cierra y devuelve a los NPC
  world.touch('campaign', world.campaign.id);
  return true;
}

/** Vista para get_schedule. */
export function listSchedule(world: World, nowS: number, locationId: Id | null = null): Record<string, unknown>[] {
  return events(world).filter((e) => !locationId || e.location_id === locationId).map((e) => {
    const occ = occurrenceAt(world, e, nowS);
    const next = nextStart(world, e, nowS);
    return {
      id: e.id, title: e.title,
      where: `${world.spot(e.spot_id).name}, ${world.locations.get(e.location_id)?.name ?? e.location_id}`,
      when: `${recurrenceEs(world, e)} (${e.duration_min} min)`,
      now: occ ? `en marcha hasta las ${hhmm(occ.end_s)}` : null,
      next: next === null ? null : whenEs(world, next, nowS),
      description: e.description,
      npcs: e.npc_ids.map((id) => npcLabel(world, id)),
      crowd: e.crowd.map((c) => `${c.label} ×${c.count}`),
      busy: (e.effects?.busy_npc_ids ?? []).map((id) => npcLabel(world, id)),
      announced_to: e.announced_to ?? [],
    };
  });
}
