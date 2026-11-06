/**
 * Acciones conflictivas del PJ contra un NPC (docs/CONFLICTOS-NPC.md): hurtar,
 * arrebatar, empujar, agarrar y tocar sin permiso. El motor decide si se puede,
 * con qué tirada (Juego de manos contra la Percepción pasiva o enfrentada;
 * Atletismo contra Atletismo o Acrobacias, SRD 5.1), qué pasa después y cómo
 * se lo toma el NPC según quién es el PJ para él y la relación que tienen. El
 * máster solo lo cuenta.
 *
 * Funciones sobre el mundo, sin IA ni eventos. Genérico: todo sale del estado y
 * de los datos (dónde lleva el objeto, su Percepción pasiva, su bloque de
 * combate, `law`, `bonds`, opinión y trato); nada sabe de ninguna campaña.
 */

import { GAME_HOUR, GAME_MINUTE } from '../clock/clock.js';
import { attitudeOf } from './combat.js';
import { talkTier, type TalkTier } from './concerns.js';
import { transcriptOf } from './conversation.js';
import { knownBy, npcProfile, reportIncident, type ConflictProfile, type Incident } from './crime.js';
import type { Advantage } from './dice.js';
import { checkFits, transferItem } from './inventory.js';
import { DEFAULT_STARTING_COINS, money, pay } from './money.js';
import type { Character, ConflictKind, GameEvent, Id, ItemDef, ItemInstance, ItemSize, ItemType, Npc, NpcConfront, NpcGuard, Placement } from './model.js';
import { descriptorOf } from './narrate.js';
import { npcTarget } from './scene.js';
import type { StolenMark } from './stolen.js';
import { changeOpinion, opinionOf } from './standing.js';
import { adjustTrust, type TrustChange } from './trust.js';
import type { World } from './world.js';

export type { ConflictKind } from './model.js';

export const CONFLICT_KINDS: readonly ConflictKind[] = ['steal', 'snatch', 'shove', 'grab', 'touch'];
export const CONFLICT_ES: Record<ConflictKind, string> = { steal: 'hurtar', snatch: 'arrebatar', shove: 'empujar', grab: 'agarrar', touch: 'tocar sin permiso' };

/** Dónde lleva el NPC lo que se le quiere quitar. */
export type CarriedOn = 'worn' | 'hand' | 'belt' | 'pocket' | 'inside' | 'pack';
export const CARRIED_ON: readonly CarriedOn[] = ['worn', 'hand', 'belt', 'pocket', 'inside', 'pack'];
export const CARRIED_ES: Record<CarriedOn, string> = { worn: 'lo lleva puesto', hand: 'lo tiene en la mano', belt: 'lo lleva al cinto', pocket: 'lo lleva en un bolsillo', inside: 'va dentro de algo que lleva', pack: 'va en su fardo o mochila' };

/** En qué estado está el NPC respecto al PJ. */
export type Awareness = 'helpless' | 'unaware' | 'alert' | 'watching' | 'guarded';
export const AWARENESS_ES: Record<Awareness, string> = { helpless: 'está indefenso', unaware: 'está desprevenido', alert: 'está atento', watching: 'le está mirando', guarded: 'está en guardia con él' };

/** Qué sabe el NPC del PJ (la capa 2 de docs/CONVERSACION-FLUJO.md). */
export type KnownAs = 'nothing' | 'heard' | 'met';

/** La relación, que decide si lo que le hace es broma, reproche, careo o delito. */
export type Relation = 'intimate' | 'good' | 'acquainted' | 'none';
export const RELATION_ES: Record<Relation, string> = { intimate: 'íntima', good: 'buena', acquainted: 'de conocidos', none: 'ninguna o mala' };

export type { ConflictProfile } from './crime.js';
export const PROFILE_ES: Record<ConflictProfile, string> = { child: 'niño', authority: 'autoridad', owner: 'dueño del local', fighter: 'de pelear', brave: 'valiente', timid: 'tímido', common: 'gente corriente' };

/** Lo que dura ir a escondidas tras un Sigilo que sale bien, si no se mueve de punto. */
export const SNEAK_S = 10 * GAME_MINUTE;
/** Le está mirando: habla con él ahora, o se han dicho algo en estos minutos. */
export const WATCHING_S = 5 * GAME_MINUTE;
/** En guardia tras pillarle (o casi), un empujón o un toque. */
export const GUARD_S = 12 * GAME_HOUR;
/** La broma solo vale una vez al día: a la segunda, ya no lo es. */
export const JOKE_S = 24 * GAME_HOUR;
/** Fallar por esto o menos estando desprevenido: lo nota a medias («casi»), no le pilla. */
export const NEAR_MISS = 4;
/** CD de convencerle en un careo, por relación. */
export const CONFRONT_DC: Record<Relation, number> = { intimate: 8, good: 10, acquainted: 12, none: 17 };

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------------------------------------------------------------------------
// Dónde lo lleva
// ---------------------------------------------------------------------------

/** Quién lleva un ejemplar (subiendo por contenedores) y por dentro de qué va, si va dentro de algo. */
export function holderOf(world: World, inst: ItemInstance): { type: 'npc' | 'character'; id: Id; via: ItemInstance | null } | null {
  let cur = inst;
  let via: ItemInstance | null = null;
  for (let guard = 0; guard < 16; guard++) {
    const p = cur.location;
    if (p.type === 'npc' || p.type === 'character') return { type: p.type, id: p.id, via };
    if (p.type !== 'container') return null;
    const box = world.itemInstances.get(p.id);
    if (!box) return null;
    via ??= box;
    cur = box;
  }
  return null;
}

const WORN_SLOTS = new Set(['head', 'body', 'hands', 'feet', 'neck', 'ring1', 'ring2']);
const BIG = new Set(['medium', 'large', 'bulky']);

/** ¿Es grande para quitarlo a escondidas (mediano o más: un martillo de fragua, una espada larga, un escudo)? */
export function isBig(def: ItemDef): boolean { return BIG.has(def.size); }

/**
 * Dónde lleva el NPC ese ejemplar: lo que diga el ejemplar (`state.on`) o, sin
 * eso, lo que se deduce del objeto. Joyas, ropa y armadura, puestas; armas y
 * bolsas pequeñas, al cinto; lo diminuto o pequeño, en un bolsillo; lo de dentro
 * de otra cosa, dentro; un contenedor grande o lo que va a la espalda, a la espalda.
 */
export function carriedOn(world: World, inst: ItemInstance): CarriedOn {
  const on = inst.state['on'];
  if (typeof on === 'string' && (CARRIED_ON as readonly string[]).includes(on)) return on as CarriedOn;
  const h = holderOf(world, inst);
  if (h?.via) return isBig(world.itemDef(h.via.item_id)) ? 'pack' : 'inside';
  const def = world.itemDef(inst.item_id);
  const type = def.type as string;
  if ((def.equip_slot && WORN_SLOTS.has(def.equip_slot)) || def.armor || type === 'ring') return 'worn';
  if (def.equip_slot === 'back') return 'pack';
  if (def.weapon || def.equip_slot === 'belt') return 'belt';
  if (def.container) return isBig(def) ? 'pack' : 'belt';
  if (def.size === 'tiny' || def.size === 'small') return 'pocket';
  return 'pack';
}

// ---------------------------------------------------------------------------
// Quién es el PJ para el NPC, y qué relación tienen
// ---------------------------------------------------------------------------

/**
 * Qué sabe el NPC del PJ y cómo le llamaría. `met`: han hablado (memoria o
 * transcripción) o la situación inicial les junta (`knows`, `with_npc_ids`, su
 * antagonista, quien le cobra); `heard`: sabe algo de él (un crimen suyo, o la
 * deuda que compró); `nothing`: nada. El nombre, solo si lo sabe por la
 * situación; si no, por lo que ve.
 */
export function pcKnownAs(world: World, events: readonly GameEvent[], npc: Npc, pc: Character): { as: KnownAs; name: string; knows_name: boolean } {
  const s = pc.situation;
  const bySituation = Boolean(s && (s.knows?.includes(npc.id) || s.with_npc_ids?.includes(npc.id) || s.antagonist_npc_id === npc.id || s.debt?.npc_id === npc.id));
  const talked = npc.memory.some((m) => m.character_id === pc.id) || transcriptOf(events, pc.id, npc.id, 1).length > 0;
  const as: KnownAs = bySituation || talked ? 'met' : knownBy(world, npc.id, pc.id) || s?.debt?.on_behalf_of === npc.id ? 'heard' : 'nothing';
  return { as, name: bySituation ? pc.name : descriptorOf(world, pc.id), knows_name: bySituation };
}

/**
 * La relación (docs/CONFLICTOS-NPC.md §4): la da el trato y la mueve la
 * opinión. Ninguna con un extraño, alguien receloso u hostil, o con una opinión
 * de −10 o menos; íntima con un aliado o una opinión de +40; buena con un amigo
 * o una opinión de +10; de conocidos, el resto.
 */
export function relationOf(npc: Npc, pc: Character): Relation {
  const tier: TalkTier = talkTier(npc, pc);
  const op = opinionOf(npc, pc.id);
  if (tier === 'hostile' || tier === 'wary' || op <= -10) return 'none';
  if (tier === 'ally' || op >= 40) return 'intimate';
  if (tier === 'friend' || op >= 10) return 'good';
  if (tier === 'stranger') return 'none';
  return 'acquainted';
}

/** El perfil del NPC (docs/CONFLICTOS-NPC.md §9); vive en crime.ts, que lo usa para la reacción de la víctima. */
export function conflictProfile(world: World, npc: Npc, locationId: Id): ConflictProfile { return npcProfile(world, npc, locationId); }

/** Percepción del NPC para una tirada enfrentada: su pasiva menos 10. */
export function npcPerception(npc: Npc): number { return npc.passive_perception - 10; }

/** Atletismo o Acrobacias del NPC: el de sus datos o, sin él, su ataque menos 2; +0 si no es de pelear. */
export function npcContest(npc: Npc): number {
  if (typeof npc.contest === 'number') return npc.contest;
  if (!npc.stats || npc.noncombatant || npc.stats.ranged) return 0;
  return Math.max(0, npc.stats.attack_bonus - 2);
}

// ---------------------------------------------------------------------------
// En guardia
// ---------------------------------------------------------------------------

export function guardOf(npc: Npc, pcId: Id, nowG: number): NpcGuard | null {
  const g = npc.guard?.[pcId];
  return g && nowG < g.until_game_s ? g : null;
}

/** Le pone en guardia con el PJ (o alarga la que tenía). */
export function setGuard(world: World, npc: Npc, pcId: Id, nowG: number, reason: string): void {
  npc.guard ??= {};
  const cur = npc.guard[pcId];
  npc.guard[pcId] = { since_game_s: cur && nowG < cur.until_game_s ? cur.since_game_s : nowG, until_game_s: nowG + GUARD_S, reason };
  world.touch('npcs', npc.id);
}

// ---------------------------------------------------------------------------
// El estado del NPC respecto al PJ
// ---------------------------------------------------------------------------

/** Va a escondidas y este NPC no le ha visto: su Sigilo reciente, en el mismo punto, supera la pasiva del NPC. */
export function hiddenFrom(world: World, pc: Character, npc: Npc, nowG: number): boolean {
  const s = pc.sneak;
  if (!s || nowG - s.game_s > SNEAK_S) return false;
  if (world.characterSpot(pc)?.id !== s.spot_id) return false;
  return s.total >= npc.passive_perception;
}

/** Apunta un Sigilo que salió bien (lo llama el motor tras la tirada). */
export function noteSneak(world: World, pc: Character, total: number, nowG: number): void {
  const spot = world.characterSpot(pc);
  if (!spot) return;
  pc.sneak = { total, game_s: nowG, spot_id: spot.id };
  world.touch('characters', pc.id);
}

/**
 * En qué estado está el NPC respecto al PJ, de más a menos fácil para él:
 * indefenso (inconsciente o atado), en guardia (le pilló, es hostil), desprevenido
 * (el PJ va a escondidas y no le ha visto, o está hablando con otro), le está
 * mirando (hablan ahora o se han dicho algo hace nada) o atento.
 */
export function awareness(world: World, events: readonly GameEvent[], pc: Character, npc: Npc, nowG: number): Awareness {
  if (npc.status === 'unconscious' || npc.bound) return 'helpless';
  if (guardOf(npc, pc.id, nowG) || attitudeOf(npc, pc.id) === 'hostile') return 'guarded';
  if (hiddenFrom(world, pc, npc, nowG)) return 'unaware';
  const talking = npc.talking_to?.character_id === pc.id && nowG - npc.talking_to.since_game_s < WATCHING_S;
  const last = transcriptOf(events, pc.id, npc.id, 1).at(-1);
  if (talking || (last && nowG - last.game_s < WATCHING_S)) return 'watching';
  if (npc.talking_to && npc.talking_to.character_id !== pc.id) return 'unaware';
  return 'alert';
}

// ---------------------------------------------------------------------------
// El veredicto
// ---------------------------------------------------------------------------

export interface ConflictRoll {
  /** La habilidad del PJ. */
  key: 'sleight_of_hand' | 'athletics';
  /** Contra la pasiva del NPC (CD fija) o contra una tirada suya. */
  against: 'passive' | 'contest';
  /** CD, si es contra la pasiva. */
  dc: number | null;
  /** Lo que suma el NPC en la enfrentada, y con qué. */
  npc_mod: number;
  npc_key: 'perception' | 'athletics';
  advantage: Advantage;
}

export interface ConflictVerdict {
  kind: ConflictKind;
  npc_id: Id;
  instance_id: Id | null;
  /** Se puede intentar (con tirada, o sin ella si `roll` es null). */
  possible: boolean;
  roll: ConflictRoll | null;
  /** Qué pasa, en una frase para el máster: por qué no se puede, o con qué tirada. */
  reason: string;
  /** Qué haría falta, si no se puede. */
  needs: string | null;
  on: CarriedOn | null;
  awareness: Awareness;
  relation: Relation;
  profile: ConflictProfile;
  known_as: KnownAs;
  /** Cómo le llamaría el NPC: su nombre si lo sabe; si no, lo que ve. */
  pc_label: string;
  /** Lo hace sabiendo que no se puede (insiste tras un «no se puede»): es un intento a la vista y le pilla, sin tirada. */
  forced?: 'caught';
}

type Cell = { ok: false; snatch?: boolean } | { ok: true; against: 'passive' | 'contest' | 'none'; adv: -1 | 0 };
const NO: Cell = { ok: false };
const SNATCH: Cell = { ok: false, snatch: true };
const cell = (against: 'passive' | 'contest' | 'none', adv: -1 | 0 = 0): Cell => ({ ok: true, against, adv });

/** La tabla de hurtar (docs/CONFLICTOS-NPC.md §6): dónde lo lleva × su estado. */
export function stealCell(on: CarriedOn, big: boolean, aw: Awareness): Cell {
  if (aw === 'helpless') return cell('none');
  if (on === 'worn') return NO;
  if (on === 'hand') return SNATCH;
  if (big) return aw === 'unaware' ? cell('passive', -1) : SNATCH;
  switch (on) {
    case 'belt': case 'pocket':
      return aw === 'unaware' ? cell('passive') : aw === 'alert' ? cell('contest') : aw === 'watching' ? cell('contest', -1) : NO;
    case 'inside':
      return aw === 'unaware' ? cell('passive', -1) : aw === 'alert' ? cell('contest', -1) : NO;
    case 'pack':
      return aw === 'unaware' ? cell('passive') : aw === 'alert' ? cell('contest', -1) : NO;
  }
}

/** ¿Vale más de lo que lleva suelto alguien de a pie (lo de un PJ al empezar)? Entonces cuesta más (BG3). */
export function isValuable(world: World, def: ItemDef): boolean {
  return def.value >= (world.campaign.starting_coins ?? DEFAULT_STARTING_COINS);
}

function adv(n: number): Advantage { return n > 0 ? 'advantage' : n < 0 ? 'disadvantage' : 'none'; }

/**
 * Lo que decide el motor antes de nada: si se puede, con qué tirada, y lo que
 * necesita el resto (estado del NPC, relación, perfil, cómo le llama). Para
 * hurtar y arrebatar, `inst` es lo que quiere quitarle (lo tiene que llevar ese
 * NPC). null si el NPC no entra en estas reglas (muerto, mudo o sin cuerpo que
 * empujar: un animal sin bloque).
 */
export function conflictVerdict(world: World, events: readonly GameEvent[], pc: Character, npc: Npc, kind: ConflictKind, inst: ItemInstance | null, nowG: number, opts: { insist?: boolean } = {}): ConflictVerdict | null {
  const v = verdictOf(world, events, pc, npc, kind, inst, nowG);
  // Insistir en lo que no se puede (docs/CONFLICTOS-NPC.md §5): lo hace igualmente, a la vista, y le pilla.
  if (v && !v.possible && opts.insist && (kind === 'steal' || kind === 'snatch') && v.instance_id && v.awareness !== 'helpless') {
    return { ...v, kind: 'steal', possible: true, roll: null, forced: 'caught', reason: `Ya sabía que no se podía y lo hace igualmente, a la vista: ${npc.name} le pilla.`, needs: null };
  }
  return v;
}

/** Lo que dura «ya te dije que no se podía»: si lo intenta otra vez en este rato, insiste. */
export const INSIST_S = 10 * GAME_MINUTE;

/** ¿Le ha dicho ya el motor que no se puede, con este NPC, en estos minutos? Entonces lo que hace ahora es insistir. */
export function refusedBefore(events: readonly GameEvent[], pc: Character, npc: Npc, nowG: number): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.actor_id !== pc.id) continue;
    if (nowG - e.timestamp_game_s > INSIST_S) break;
    const m = e.payload['master'] as { calls?: { name: string; input?: Record<string, unknown>; result?: unknown }[]; context?: string } | null | undefined;
    if (!m) continue;
    if (m.calls?.some((c) => c.name === 'conflict_act' && c.input?.['npc_id'] === npc.id && String(c.result ?? '').includes('"possible":false'))) return true;
    if (typeof m.context === 'string' && m.context.includes('Veredicto: NO SE PUEDE') && m.context.includes(`[${npc.id}]`)) return true;
  }
  return false;
}

function verdictOf(world: World, events: readonly GameEvent[], pc: Character, npc: Npc, kind: ConflictKind, inst: ItemInstance | null, nowG: number): ConflictVerdict | null {
  if (npc.status === 'dead' || npc.status === 'missing' || npc.mute) return null;
  const aw = awareness(world, events, pc, npc, nowG);
  const known = pcKnownAs(world, events, npc, pc);
  const loc = world.spot(npc.location.id).location_id;
  const base = {
    kind, npc_id: npc.id, instance_id: inst?.id ?? null, awareness: aw, relation: relationOf(npc, pc),
    profile: conflictProfile(world, npc, loc), known_as: known.as, pc_label: known.name,
  };
  const who = npc.name;
  if (kind === 'touch') {
    return { ...base, possible: true, roll: null, on: null, reason: `Tocar a ${who} sin su permiso no lleva tirada: pasa, y ${who} reacciona.`, needs: null };
  }
  if (kind === 'shove' || kind === 'grab') {
    if (aw === 'helpless') return { ...base, possible: true, roll: null, on: null, reason: `${who} ${AWARENESS_ES[aw]}: no hace falta tirada.`, needs: null };
    const r: ConflictRoll = { key: 'athletics', against: 'contest', dc: null, npc_mod: npcContest(npc), npc_key: 'athletics', advantage: adv(aw === 'unaware' ? 1 : 0) };
    return { ...base, possible: true, roll: r, on: null, reason: `Atletismo contra el Atletismo o la Acrobacia de ${who} (+${r.npc_mod}).`, needs: null };
  }
  // Hurtar y arrebatar: lo tiene que llevar él.
  if (!inst) return { ...base, possible: false, roll: null, on: null, reason: `No hay nada concreto que quitarle a ${who}.`, needs: 'saber qué lleva (lo que «Lleva» en su línea)' };
  const h = holderOf(world, inst);
  if (!h || h.type !== 'npc' || h.id !== npc.id) return { ...base, possible: false, roll: null, on: null, reason: `${who} no lleva eso.`, needs: null };
  const def = world.itemDef(inst.item_id);
  const on = carriedOn(world, inst);
  const big = isBig(def);
  const valuable = isValuable(world, def);
  if (kind === 'snatch') {
    if (aw === 'helpless') return { ...base, possible: true, roll: null, on, reason: `${who} ${AWARENESS_ES[aw]}: se lo quita sin tirada (quien lo vea, lo ve).`, needs: null };
    if (on === 'worn') return { ...base, possible: false, roll: null, on, reason: `${def.name}: ${CARRIED_ES[on]}; de un tirón no sale.`, needs: 'que esté inconsciente o atado' };
    if (on === 'inside') return { ...base, possible: false, roll: null, on, reason: `${def.name} ${CARRIED_ES[on]}: de un tirón se arranca, como mucho, lo de fuera.`, needs: 'arrebatarle lo que lo contiene' };
    const r: ConflictRoll = { key: 'athletics', against: 'contest', dc: null, npc_mod: npcContest(npc), npc_key: 'athletics', advantage: adv(aw === 'unaware' ? 1 : 0) };
    return { ...base, possible: true, roll: r, on, reason: `Arrebatar a la vista: Atletismo contra el Atletismo o la Acrobacia de ${who} (+${r.npc_mod}). Lo ve siempre.`, needs: null };
  }
  const c = stealCell(on, big, aw);
  const where = `${def.name}: ${CARRIED_ES[on]}${big && on !== 'worn' && on !== 'hand' ? ' y es grande' : ''}; ${who} ${AWARENESS_ES[aw]}`;
  if (!c.ok) {
    const needs = c.snatch ? 'arrebatárselo a la vista (Atletismo), o que esté indefenso'
      : aw === 'guarded' ? 'que se le pase (no le quita ojo)'
      : on === 'worn' ? 'que esté inconsciente, dormido o atado' : 'que se distraiga o no le vea (Sigilo, o que le distraiga otro)';
    return { ...base, possible: false, roll: null, on, reason: `${where}. A escondidas no se puede.`, needs };
  }
  if (c.against === 'none') return { ...base, possible: true, roll: null, on, reason: `${where}: se lo quita sin tirada (quien lo vea, lo ve).`, needs: null };
  const hidden = hiddenFrom(world, pc, npc, nowG);
  const advantage = adv((hidden ? 1 : 0) + c.adv);
  const plus = valuable ? 2 : 0;
  const r: ConflictRoll = c.against === 'passive'
    ? { key: 'sleight_of_hand', against: 'passive', dc: npc.passive_perception + plus, npc_mod: 0, npc_key: 'perception', advantage }
    : { key: 'sleight_of_hand', against: 'contest', dc: null, npc_mod: npcPerception(npc) + plus, npc_key: 'perception', advantage };
  const how = r.against === 'passive' ? `contra su Percepción pasiva (CD ${r.dc})` : `contra una tirada de Percepción suya (+${r.npc_mod})`;
  return { ...base, possible: true, roll: r, on, reason: `${where}. Juego de manos ${how}${advantage === 'advantage' ? ', con ventaja' : advantage === 'disadvantage' ? ', con desventaja' : ''}${valuable ? ' (vale mucho: cuesta más)' : ''}.`, needs: null };
}

// ---------------------------------------------------------------------------
// El resultado
// ---------------------------------------------------------------------------

/** Cómo acaba un intento con tirada: le sale, casi le pilla, o le pilla (con la mano dentro, si saca un 1). */
export type ConflictOutcome = 'success' | 'near_miss' | 'caught' | 'caught_red_handed';

/**
 * El resultado de la tirada del PJ (`total` contra la CD o contra lo que saque
 * el NPC, `npcTotal`): en el SRD, un empate en una tirada enfrentada deja las
 * cosas como estaban, así que pierde quien actúa. Fallar por poco estando
 * desprevenido es «casi»; un 1 natural, con la mano dentro.
 */
export function conflictOutcome(v: ConflictVerdict, total: number, natural: number | null, npcTotal: number | null): ConflictOutcome {
  if (v.forced) return v.forced;
  const r = v.roll;
  if (!r) return 'success';
  const target = r.against === 'passive' ? r.dc ?? 10 : (npcTotal ?? 10) + 1;
  if (natural === 1) return 'caught_red_handed';
  if (total >= target) return 'success';
  if (v.kind === 'steal' && v.awareness === 'unaware' && target - total <= NEAR_MISS) return 'near_miss';
  return 'caught';
}

/** ¿Habla del objeto por su nombre o sus alias? (para leer qué quiere quitarle el jugador). */
export function namesItem(text: string, def: ItemDef): boolean {
  const t = ` ${norm(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return [def.name, ...def.aliases].map((a) => norm(a).replace(/^(el|la|los|las|un|una|unos|unas) /, '').trim()).filter((a) => a.length > 2)
    .some((a) => t.includes(` ${a} `) || t.includes(` ${a}s `) || t.includes(` ${a.replace(/s$/, '')} `));
}

// ---------------------------------------------------------------------------
// Lo robado: a la mochila, marcado, y si no existía, se crea
// ---------------------------------------------------------------------------

/** Lo que guarda un ejemplar robado (`state.stolen`): la forma es la de stolen.ts, que lo lee para echarlo en falta. */
export { stolenMark as stolenOf } from './stolen.js';

/**
 * Dónde guarda el PJ lo que roba: en la mochila (el contenedor que lleva a la
 * espalda), si no en otro contenedor que lleve, si no en un bolsillo, si no en
 * una mano libre. null si no tiene dónde meterlo.
 */
export function stashFor(world: World, pc: Character, def: ItemDef): Placement | null {
  const mine = world.itemsCarriedBy(pc.id).filter((i) => { const d = world.itemDef(i.item_id); return Boolean(d.container && !d.container.fixed); });
  const back = mine.filter((i) => i.location.type === 'character' && i.location.slot.kind === 'equipped' && i.location.slot.slot === 'back');
  for (const box of [...back, ...mine.filter((i) => !back.includes(i))]) {
    const to: Placement = { type: 'container', id: box.id };
    if (!checkFits(world, def, 1, to)) return to;
  }
  const options: Placement[] = [
    { type: 'character', id: pc.id, slot: { kind: 'pocket' } },
    { type: 'character', id: pc.id, slot: { kind: 'hand', which: 'off' } },
    { type: 'character', id: pc.id, slot: { kind: 'hand', which: 'main' } },
    { type: 'character', id: pc.id, slot: { kind: 'hand', which: 'both' } },
  ];
  return options.find((to) => !checkFits(world, def, 1, to)) ?? null;
}

/** Cómo se dice dónde ha ido a parar: «en tu mochila», «en un bolsillo», «en la mano». */
export function stashText(world: World, to: Placement): string {
  if (to.type === 'container') return `en ${world.itemDef(world.itemInstance(to.id).item_id).name}`;
  if (to.type === 'character') return to.slot.kind === 'pocket' ? 'en un bolsillo' : to.slot.kind === 'hand' ? 'en la mano' : 'encima';
  return 'encima';
}

/** Quién estaba cerca (en su punto) cuando pasó: NPC vivos y PJ, sin el autor. */
function nearOf(world: World, pc: Character, npc: Npc): Id[] {
  const spot = npc.location.id;
  return [
    ...[...world.npcs.values()].filter((n) => n.status === 'alive' && n.location.id === spot && n.id !== npc.id).map((n) => n.id),
    ...[...world.characters.values()].filter((c) => c.id !== pc.id && world.characterSpot(c)?.id === spot).map((c) => c.id),
  ];
}

/** Lo pasa a la mochila del PJ y lo marca como robado (y de quién es). */
export function stealInto(world: World, pc: Character, npc: Npc, inst: ItemInstance, total: number | null, nowG: number): { ok: true; inst: ItemInstance; where: string } | { ok: false; reason: string } {
  const def = world.itemDef(inst.item_id);
  const to = stashFor(world, pc, def);
  if (!to) return { ok: false, reason: `no tienes dónde meter ${def.name}: ni en la mochila, ni en un bolsillo, ni una mano libre` };
  const r = transferItem(world, inst.id, to);
  if (!r.ok) return { ok: false, reason: 'reason' in r.error && r.error.reason ? String(r.error.reason) : r.error.code };
  const moved = r.moved;
  moved.state['owner_id'] ??= npc.id;
  // Sin tirada (estaba indefenso), lo nota en cuanto pueda: 0 contra su pasiva.
  const mark: StolenMark = { from_npc_id: npc.id, game_s: nowG, roll_total: total ?? 0, near: nearOf(world, pc, npc) };
  moved.state['stolen'] = mark;
  delete moved.state['on'];
  world.touch('item_instances', moved.id);
  return { ok: true, inst: moved, where: stashText(world, to) };
}

/** Lo que el máster puede pedir que se cree, si el NPC lo lleva y no está en los datos. */
export interface NewItemSpec { name: string; type?: ItemType; size?: ItemSize; worn?: boolean; in_hand?: boolean }

/** Riqueza de un NPC (dato `wealth` del ajuar, si lo hay): multiplica lo que puede valer lo que lleva. */
const WEALTH: Record<NonNullable<Npc['wealth']>, number> = { none: 0.2, poor: 0.5, modest: 1, comfortable: 3, rich: 10 };
const BASE_VALUE: Partial<Record<ItemType, number>> = { treasure: 0.2, weapon: 0.1, tool: 0.05, misc: 0.02, consumable: 0.02, container: 0.02 };
const FORBIDDEN = /(m[aá]gic|encantad|hechizad|maldit|legendari|reliquia|artefacto|divin|sagrad|de poder)/i;
/** Cuántos objetos nuevos se le pueden crear a un mismo NPC: no es un almacén. */
export const MAX_NEW_PER_NPC = 3;
/** Prefijo de los objetos creados en partida (no están en los datos de la campaña). */
export const NEW_PREFIX = 'it_new_';

/** Lo que vale como mucho lo que lleva este NPC: su riqueza por lo que lleva un PJ al empezar. */
export function wealthCap(world: World, npc: Npc): number {
  return Math.round((world.campaign.starting_coins ?? DEFAULT_STARTING_COINS) * (npc.wealth ? WEALTH[npc.wealth] : 1));
}

let made = 0;

/**
 * Crea en el NPC un objeto que no estaba en los datos (docs/CONFLICTOS-NPC.md
 * §8), con límites: nada mágico ni único, tamaño que se pueda llevar encima, no
 * más de MAX_NEW_PER_NPC por NPC, y valor según su riqueza. Si ya lleva algo
 * con ese nombre (o ya se le creó), devuelve ese. Todo objeto nuevo pasa por
 * aquí: si se decide guardarlos en otro sitio (base de datos, JSON aparte), se
 * cambia esta función. La imagen es la provisional hasta que se pinte.
 */
export function createItem(world: World, npc: Npc, spec: NewItemSpec): { ok: true; inst: ItemInstance; created: boolean } | { ok: false; reason: string } {
  const name = spec.name.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 60) return { ok: false, reason: 'el nombre del objeto tiene que ser corto y concreto («anillo de plata», «llave de hierro»)' };
  if (FORBIDDEN.test(name)) return { ok: false, reason: `${npc.name} no lleva nada mágico ni único que no esté en los datos: eso no se inventa` };
  const size: ItemSize = spec.size ?? 'tiny';
  if (size === 'large' || size === 'bulky') return { ok: false, reason: `${npc.name} no lleva encima algo tan grande` };
  const key = norm(name);
  const carried = world.itemsIn({ type: 'npc', id: npc.id });
  const all = [...carried, ...carried.flatMap((i) => world.itemsIn({ type: 'container', id: i.id }))];
  const same = all.find((i) => { const d = world.itemDef(i.item_id); return [d.name, ...d.aliases].some((a) => norm(a) === key); });
  if (same) return { ok: true, inst: same, created: false };
  if (all.filter((i) => i.item_id.startsWith(NEW_PREFIX)).length >= MAX_NEW_PER_NPC) return { ok: false, reason: `a ${npc.name} ya no le queda nada más encima que no esté en los datos` };
  const type: ItemType = spec.type && spec.type !== 'quest' ? spec.type : 'misc';
  const value = Math.max(1, Math.round(wealthCap(world, npc) * (BASE_VALUE[type] ?? 0.02)));
  const id = `${NEW_PREFIX}${npc.id.replace(/^npc_/, '')}_${key.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  const ring = /\banill/.test(key);
  const def: ItemDef = world.itemDefs.get(id) ?? {
    id, name, aliases: [name.split(' ')[0]!.toLowerCase()], type, size, weight_lb: size === 'tiny' ? 0.1 : size === 'small' ? 1 : 3,
    value, unique: false, origin: 'custom', ...(ring ? { equip_slot: 'ring1' as const } : {}),
    description: `Lo llevaba ${npc.name}.`,
  };
  world.itemDefs.set(id, def);
  world.touch('item_defs', id);
  const on = spec.in_hand ? { on: 'hand' } : spec.worn ? { on: 'worn' } : {};
  const inst: ItemInstance = { id: `ii_new_${(++made).toString(36)}_${Date.now().toString(36)}`, item_id: id, quantity: 1, location: { type: 'npc', id: npc.id }, state: { owner_id: npc.id, invented: true, ...on } };
  world.itemInstances.set(inst.id, inst);
  world.touch('item_instances', inst.id);
  return { ok: true, inst, created: true };
}

// ---------------------------------------------------------------------------
// La resolución: qué pasa y cómo se lo toma el NPC
// ---------------------------------------------------------------------------

/** Cómo se lo toma el NPC: no se entera, casi le pilla, le advierte, broma, reproche, careo o delito. */
export type ConflictResponse = 'unnoticed' | 'near_miss' | 'warned' | 'joke' | 'reproach' | 'confront' | 'crime';

export interface ConflictResult {
  outcome: ConflictOutcome;
  response: ConflictResponse;
  /** Lo que ha cambiado de manos (y dónde ha ido a parar), si algo. */
  moved: { instance_id: Id; name: string; where: string } | null;
  /** Se lo ha devuelto (la broma: lo recupera). */
  returned: boolean;
  incident: Incident | null;
  /** Lo que ha pasado, en segunda persona, para el máster: hechos que no puede contradecir. */
  facts: string;
  /** Lo que hace el NPC, el hecho de su reacción (el máster pone las palabras). */
  reaction: string | null;
}

const RELATION_ORDER: Relation[] = ['none', 'acquainted', 'good', 'intimate'];
function lowerRelation(r: Relation): Relation { return RELATION_ORDER[Math.max(0, RELATION_ORDER.indexOf(r) - 1)]!; }

/** Lo que hizo, para la memoria del NPC. */
const DID_ES: Record<ConflictKind, string> = { steal: 'intentó quitarle algo', snatch: 'le arrancó algo de las manos', shove: 'le empujó', grab: 'le agarró', touch: 'le tocó sin permiso' };

const TRUST_BY_KIND: Record<ConflictKind, TrustChange> = { steal: 'caught_stealing', snatch: 'snatched', shove: 'shoved', grab: 'shoved', touch: 'touched' };

/** Lo que hace cada perfil la primera vez que le tocan sin permiso (un escalón, como un insulto). */
const WARNED: Record<ConflictProfile, string> = {
  authority: 'te aparta la mano y te advierte que no vuelvas a hacerlo',
  owner: 'te para en seco: «Aquí, las manos quietas»',
  fighter: 'te aparta de un manotazo y te mira de arriba abajo',
  brave: 'se encara contigo y te pregunta qué te pasa',
  common: 'se aparta y protesta en voz alta',
  timid: 'se encoge y se aparta de ti',
  child: 'se aparta asustado',
};

/** Lo que le exige en el careo, según lo que ha hecho. */
export function demandOf(kind: ConflictKind, moved: boolean): string {
  if (kind === 'steal' || kind === 'snatch') return moved ? 'se lo devuelvas ahora mismo' : 'le des una explicación';
  return 'te disculpes';
}

function memo(world: World, npc: Npc, pc: Character, note: string, importance: 1 | 2 | 3, nowG: number): void {
  if (!npc.memory.some((m) => m.character_id === pc.id && m.note === note)) npc.memory.push({ character_id: pc.id, game_s: nowG, note, importance });
  world.touch('npcs', npc.id);
}

/**
 * Aplica lo que pasa tras el intento (con su tirada, o sin ella si no hacía
 * falta): mueve el objeto, pone en guardia, y decide si es broma, reproche,
 * careo o delito según la relación (docs/CONFLICTOS-NPC.md §4). Repetir con el
 * NPC ya en guardia baja la relación un escalón. Lo grave va por crime.ts:
 * incidente, testigos, alto y calabozo.
 */
export function resolveConflict(world: World, pc: Character, npc: Npc, v: ConflictVerdict, roll: { total: number; natural: number | null; npc_total: number | null } | null, nowG: number): ConflictResult {
  const outcome: ConflictOutcome = v.forced ?? (roll ? conflictOutcome(v, roll.total, roll.natural, roll.npc_total) : 'success');
  const inst = v.instance_id ? world.itemInstances.get(v.instance_id) ?? null : null;
  const what = inst ? world.itemDef(inst.item_id).name : 'eso';
  const who = npc.name;
  const repeat = Boolean(guardOf(npc, pc.id, nowG));
  let moved: ConflictResult['moved'] = null;
  const take = (): string | null => {
    if (!inst) return 'no hay nada que quitarle';
    const r = stealInto(world, pc, npc, inst, roll?.total ?? null, nowG);
    if (!r.ok) return r.reason;
    moved = { instance_id: r.inst.id, name: world.itemDef(r.inst.item_id).name, where: r.where };
    return null;
  };
  const result = (response: ConflictResponse, facts: string, reaction: string | null, incident: Incident | null = null, returned = false): ConflictResult =>
    ({ outcome, response, moved, returned, incident, facts, reaction });

  // Hurto que sale bien: no se entera.
  if (v.kind === 'steal' && outcome === 'success') {
    const err = take();
    if (err) return result('unnoticed', `Lo tienes a mano, pero ${err}: no se lo quitas.`, null);
    return result('unnoticed', `Le quitas ${what} a ${who} sin que se dé cuenta: ya está ${moved!.where}.`, null);
  }
  if (v.kind === 'steal' && outcome === 'near_miss') {
    setGuard(world, npc, pc.id, nowG, `casi le pilla metiéndole la mano (${what})`);
    return result('near_miss', `No llegas a quitárselo: ${who} nota algo, se palpa y se vuelve. No te ha pillado, pero desde ahora no te quita ojo.`, `${who} se palpa y se vuelve, receloso: no sabe qué ha sido, pero no te quita ojo.`);
  }

  // Lo nota: lo que ha hecho y lo que ha conseguido.
  let deed: string;
  switch (v.kind) {
    case 'steal': deed = outcome === 'caught_red_handed' ? `${who} te pilla con la mano en ${what}.` : `${who} te pilla intentando quitarle ${what}.`; break;
    case 'snatch': {
      const err = outcome === 'success' ? take() : 'no';
      deed = outcome === 'success' && !err ? `Le arrancas ${what} a ${who} de un tirón: ya es tuyo (${moved!.where}), y lo ha visto.` : `${who} no lo suelta: forcejeáis y se queda con ${what}.`;
      break;
    }
    case 'shove': deed = outcome === 'success' ? `Empujas a ${who}: trastabilla y retrocede.` : `${who} aguanta el empujón sin moverse.`; break;
    case 'grab': deed = outcome === 'success' ? `Agarras a ${who} del brazo.` : `${who} se suelta de un tirón.`; break;
    case 'touch': deed = `Tocas a ${who} sin su permiso.`; break;
  }
  let rel = repeat ? lowerRelation(v.relation) : v.relation;
  const trust = TRUST_BY_KIND[v.kind];

  // Tocar sin permiso, la primera vez: un escalón, como un insulto.
  if (v.kind === 'touch' && !repeat) {
    setGuard(world, npc, pc.id, nowG, 'le tocó sin permiso');
    if (rel === 'none' || rel === 'acquainted') adjustTrust(world, npc, pc, trust, nowG);
    memo(world, npc, pc, `${pc.name} le tocó sin permiso.`, 1, nowG);
    return result('warned', deed, rel === 'intimate' || rel === 'good' ? `${who} te mira raro, sin darle más importancia.` : `${who} ${WARNED[v.profile]}.`);
  }

  // Arrebatar a quien no es íntimo es siempre delito.
  if (v.kind === 'snatch' && rel !== 'intimate') rel = 'none';
  setGuard(world, npc, pc.id, nowG, `${CONFLICT_ES[v.kind]}: ${pc.name}`);
  const movedId = (): Id | null => (moved as ConflictResult['moved'])?.instance_id ?? null;

  if (rel === 'intimate') {
    let returned = false;
    const id = movedId();
    if (id) {
      const back = transferItem(world, id, { type: 'npc', id: npc.id });
      if (back.ok) { delete back.moved.state['stolen']; returned = true; moved = null; }
    }
    changeOpinion(world, npc, pc, -1, `${CONFLICT_ES[v.kind]} (en broma)`, nowG);
    memo(world, npc, pc, `${pc.name} le gastó una broma pesada (${CONFLICT_ES[v.kind]}); se lo tomó a risa.`, 1, nowG);
    return result('joke', deed, `${who} se lo toma a broma, esta vez: «¡Serás…!»${returned ? `, y te quita ${what} de las manos` : ''}. A la próxima ya no tendrá gracia.`, null, returned);
  }
  if (rel === 'good' || rel === 'acquainted') {
    changeOpinion(world, npc, pc, -5, CONFLICT_ES[v.kind], nowG);
    adjustTrust(world, npc, pc, trust, nowG);
    openConfront(world, npc, pc, v.kind, movedId(), CONFRONT_DC[rel], nowG);
    memo(world, npc, pc, `${pc.name} ${DID_ES[v.kind]}; le encaró.`, 2, nowG);
    const demand = demandOf(v.kind, movedId() !== null);
    return rel === 'good'
      ? result('reproach', deed, `${who} te mira dolido y te lo echa en cara: espera que ${demand}.`)
      : result('confront', deed, `${who} te encara («${v.pc_label}, ¿qué haces?») y te exige que ${demand}. Si no lo arreglas (devolvérselo, disculparte, convencerle o pagarle), irá a por la guardia.`);
  }
  // Ninguna relación o mala: delito (crime.ts).
  changeOpinion(world, npc, pc, -10, CONFLICT_ES[v.kind], nowG);
  adjustTrust(world, npc, pc, trust, nowG);
  const kind = v.kind === 'shove' || v.kind === 'grab' || v.kind === 'touch' ? 'assault' as const : movedId() ? 'theft' as const : 'theft_attempt' as const;
  const incident = reportIncident(world, { kind, perpetrator_id: pc.id, victim_id: npc.id, spot_id: npc.location.id }, nowG);
  const seized = incident?.knowers.some((k) => k.npc_id === npc.id && k.response === 'seize') ?? false;
  if (seized) { openConfront(world, npc, pc, v.kind, movedId(), CONFRONT_DC.none, nowG); npc.confront![pc.id]!.crime = true; }
  return result('crime', `${deed} Para ${who} es un delito.`, seized ? `${who} te agarra de la muñeca y te exige que ${demandOf(v.kind, movedId() !== null)}; si te resistes, pelea.` : null, incident);
}

/** Abre (o renueva) el careo: le ha pillado y le exige que lo arregle. */
export function openConfront(world: World, npc: Npc, pc: Character, kind: ConflictKind, instanceId: Id | null, dc: number, nowG: number): void {
  npc.confront ??= {};
  npc.confront[pc.id] = { kind, instance_id: instanceId, since_game_s: nowG, dc };
  world.touch('npcs', npc.id);
}

/** El careo abierto de este PJ (con quien sea que le encara), o null. Caduca a la hora. */
export function confrontOf(world: World, pc: Character, nowG: number): { npc: Npc; c: NpcConfront } | null {
  for (const npc of world.npcs.values()) {
    const c = npc.confront?.[pc.id];
    if (c && nowG - c.since_game_s < GAME_HOUR && npc.status === 'alive') return { npc, c };
  }
  return null;
}

export function closeConfront(world: World, npc: Npc, pc: Character): void {
  if (npc.confront?.[pc.id]) { delete npc.confront[pc.id]; world.touch('npcs', npc.id); }
}

// ---------------------------------------------------------------------------
// Lo que escribe el jugador: ¿es una acción conflictiva?
// ---------------------------------------------------------------------------

// Empujar, agarrar o tocar van con la persona («le empujo», «empujarle», «empujo a Hugo»): «empujo la puerta» o
// «agarro mi espada» no son contra nadie.
const RE_SNATCH = /\b((le|se lo|se la) (arranc|arrebat)\w*|(arrancarl|arrebatarl|arrancarsel|arrebatarsel)\w*|de un tiron|de un manotazo|se lo quito de las manos|quitarselo de las manos)\b/;
const RE_STEAL = /\b(rob\w*|hurt\w*|birl\w*|mang\w*|sise\w*|afan\w*|sustra\w*|desvalij\w*|quitarle|quitarsel\w*|le quito|se lo quito|se la quito|me lo quedo|me la quedo|le cojo|cojo su|cogerle|meto la mano en su|meterle la mano|cortarle la bolsa|corto su bolsa|le corto la bolsa)\b/;
const RE_SHOVE = /\b((le|la|lo) (empuj|derrib)\w*|(empujarl|derribarl)\w*|empujo a|derribo a|le doy un empujon|darle un empujon|le aparto de un|le tiro al suelo|tirarl[aeo] al suelo|le pongo la zancadilla|ponerle la zancadilla|placo a)\b/;
const RE_GRAB = /\b((le|la|lo) (agarr|sujet|inmoviliz)\w*|(agarrarl|sujetarl|inmovilizarl)\w*|agarro a|sujeto a|le cojo del|le cojo de la|cogerl[ae] del?|le retengo|retenerl[ae])\b/;
/** Coger algo que lleva otro («agarro la bolsa de Garrán»): solo cuenta si lo que nombra lo lleva él. */
const RE_TAKE = /\b(agarr|coj|cog|tom|pill)\w*\b/;
const RE_TOUCH = /\b(le toco|tocarle|la toco|lo toco|le acaricio|acariciarle|le pellizc\w*|pellizcarle|le doy una palmada|darle una palmada|le beso|besarle|le tiro del pelo|tirarle del pelo|le hago cosquillas|hacerle cosquillas|le pincho|pincharle|le despeino|despeinarle)\b/;
/** Quien solo habla de ello, pregunta o lo niega no lo está haciendo. */
const RE_NOT = /\b(no (le |la |lo |se lo |se la )?(robo|quito|empujo|toco|agarro|cojo)|sin (robar|tocar)|si (le|la|lo) (robo|quito|empujo|toco)|quien (me |le |te |nos )?(ha )?robado|me han robado|nos han robado|te han robado|le han robado)\b/;

const plainText = (t: string) => ` ${norm(t).replace(/[«»"“”¡!¿.,;:()]/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** ¿Qué acción conflictiva describe el texto? La primera que encaja: arrebatar, hurtar, agarrar, empujar, tocar. */
export function conflictKindOf(text: string): ConflictKind | null {
  // Preguntarlo, negarlo o contar que le han robado a él no es hacerlo.
  if (/[?¿]/.test(text)) return null;
  const t = plainText(text);
  if (RE_NOT.test(t)) return null;
  if (RE_SNATCH.test(t)) return 'snatch';
  if (RE_STEAL.test(t)) return 'steal';
  if (RE_GRAB.test(t)) return 'grab';
  if (RE_SHOVE.test(t)) return 'shove';
  if (RE_TOUCH.test(t)) return 'touch';
  return null;
}

/** Lo que lleva encima un NPC, también lo que va dentro de lo que lleva. */
export function npcBelongings(world: World, npc: Npc): ItemInstance[] {
  const out: ItemInstance[] = [];
  const queue = world.itemsIn({ type: 'npc', id: npc.id });
  while (queue.length) {
    const i = queue.shift()!;
    out.push(i);
    if (world.itemDef(i.item_id).container) queue.push(...world.itemsIn({ type: 'container', id: i.id }));
  }
  return out;
}

/** Lo que el motor ha leído antes del máster: qué quiere hacerle a quién, y con qué objeto. */
export interface ConflictPlan {
  kind: ConflictKind;
  npc_id: Id;
  /** El objeto, si lo nombra y lo lleva ese NPC (o lo de dentro de lo que lleva). */
  instance_id: Id | null;
  /** Lo nombra pero no está en los datos: el máster lo crea con conflict_act (new_item), si es razonable que lo lleve. */
  item_words: string | null;
  verdict: ConflictVerdict | null;
}

/** Las palabras del objeto que nombra el texto tras el verbo («los anillos de los dedos»), por si hay que crearlo. */
function itemWords(text: string): string | null {
  const t = norm(text);
  const m = /\b(?:rob\w*|birl\w*|hurt\w*|quit\w*|arranc\w*|arrebat\w*|cog\w*|mang\w*)\b(?:\s+(?:le|la|lo|se|sel[oa]s?))?\s+(?:a\s+\S+\s+)?((?:el|la|los|las|su|sus|un|una)\s+[^,.;]+)/.exec(t);
  return m?.[1]?.replace(/\s+(?:a|al)\s+.*$/, '').trim().slice(0, 50) || null;
}

/**
 * Lee si lo que escribe el jugador es una acción conflictiva contra un NPC de
 * su sitio, y le pone el veredicto. El NPC: el que nombra, con quien habla, el
 * que lleva lo que nombra, o el único que tiene al lado. null si no lo es.
 */
export function conflictPlan(world: World, events: readonly GameEvent[], pc: Character, text: string, nowG: number): ConflictPlan | null {
  const found = conflictKindOf(text);
  // «Agarro la bolsa de Garrán»: coger algo que lleva otro, si lo que nombra lo lleva él (se mira abajo).
  const taking = !found && !/[?¿]/.test(text) && RE_TAKE.test(plainText(text));
  if (!found && !taking) return null;
  const kind: ConflictKind = found ?? 'steal';
  const spot = world.characterSpot(pc);
  if (!spot) return null;
  const here = [...world.npcs.values()].filter((n) => (n.status === 'alive' || n.status === 'unconscious') && !n.mute && world.spots.get(n.location.id)?.location_id === spot.location_id);
  if (!here.length) return null;
  const owns = (n: Npc) => npcBelongings(world, n).find((i) => namesItem(text, world.itemDef(i.item_id)));
  let npc = npcTarget(world, events, pc, text, nowG);
  if (npc && !here.includes(npc)) npc = null;
  if (!npc) npc = here.find((n) => owns(n)) ?? null;
  if (!npc) { const at = here.filter((n) => n.location.id === spot.id); if (at.length === 1) npc = at[0]!; }
  if (!npc) return null;
  // Del suelo o de un mueble no es robarle a nadie: si nombra algo que no lleva ese NPC pero está a la vista, no es esto.
  const inst = owns(npc) ?? null;
  if (taking && !inst) return null;
  const steals = kind === 'steal' || kind === 'snatch';
  if (steals && !inst && world.itemsIn({ type: 'spot', id: spot.id }).some((i) => namesItem(text, world.itemDef(i.item_id)))) return null;
  // «Agarro la bolsa»: agarrar algo suyo es arrebatárselo.
  const k: ConflictKind = kind === 'grab' && inst ? 'snatch' : kind;
  const words = steals && !inst ? itemWords(text) : null;
  const verdict = steals && !inst ? null : conflictVerdict(world, events, pc, npc, k, inst, nowG, { insist: refusedBefore(events, pc, npc, nowG) });
  return { kind: k, npc_id: npc.id, instance_id: inst?.id ?? null, item_words: words, verdict };
}

/** El bloque del contexto: lo que ha decidido el motor y lo que el máster no puede hacer. */
export function conflictBlock(world: World, pc: Character, p: ConflictPlan): string {
  const npc = world.npc(p.npc_id);
  const v = p.verdict;
  const who = `${npc.name} [${npc.id}]`;
  const L = ['## Acción conflictiva: la decide el motor, no tú'];
  const inst = p.instance_id ? world.itemInstances.get(p.instance_id) : null;
  const what = inst ? `${world.itemDef(inst.item_id).name} [${inst.id}]` : p.item_words ? `«${p.item_words}» (no está en los datos)` : 'algo';
  L.push(`${pc.name} quiere ${CONFLICT_ES[p.kind]}${p.kind === 'steal' || p.kind === 'snatch' ? ` ${what} a` : ' a'} ${who}.`);
  if (v) {
    L.push(`${npc.name} ${v.known_as === 'met' ? `le conoce${v.pc_label === pc.name ? ` (sabe que es ${pc.name})` : ''}` : v.known_as === 'heard' ? 'sabe de él de oídas' : 'no sabe quién es'}; relación ${RELATION_ES[v.relation]}; ${AWARENESS_ES[v.awareness]}; es ${PROFILE_ES[v.profile]}.`);
    L.push(v.forced
      ? `Veredicto: LE PILLA, sin tirada. ${v.reason} Llama a conflict_act {npc_id: "${npc.id}", kind: "steal"${inst ? `, instance_id: "${inst.id}"` : ''}} para que el servidor lo aplique (cómo se lo toma ${npc.name}, según su relación) y cuéntalo.`
      : v.possible
      ? `Veredicto: SE PUEDE. ${v.reason} Llama a conflict_act {npc_id: "${npc.id}", kind: "${p.kind}"${inst ? `, instance_id: "${inst.id}"` : ''}} y cierra con log_event SIN requires_roll: la tirada la pone el servidor${v.roll ? '' : ' (aquí no hay tirada: el servidor lo resuelve en el acto y te dice qué ha pasado)'}.`
      : `Veredicto: NO SE PUEDE, sin tirada. ${v.reason}${v.needs ? ` Haría falta: ${v.needs}.` : ''} Cuéntalo en la escena: no se lo quita, y por qué. Si el jugador insiste en hacerlo igualmente, es un intento a la vista: llama a conflict_act con kind "touch" (le pilla).`);
  } else {
    L.push(`Lo que nombra no está entre lo que lleva ${npc.name} («Lleva» en su línea). Si es razonable que lo lleve (unos anillos en los dedos de un regidor, una bolsa al cinto), llama a conflict_act con new_item (nombre corto; si lo lleva puesto, worn: true; en la mano, in_hand: true) y el servidor lo crea y te da el veredicto. Si no es razonable, cuenta que no lo lleva.`);
  }
  L.push('Prohibido: pedir tú la tirada; spawn_item o transfer_item para esto; contar que algo cambia de manos sin que lo diga el servidor; contestar con lo suyo con el actor (deudas, encargos), comercio o misiones. Si el NPC reacciona, su primera frase es la reacción.');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// El careo: le ha pillado y le exige que lo arregle
// ---------------------------------------------------------------------------

/** Lo que contesta el PJ en un careo. */
export type ConfrontAnswer = 'return' | 'apologize' | 'persuade' | 'deceive' | 'pay' | 'resist';

const RE_RETURN = /\b(devuelv\w*|devolv\w*|se lo doy|se la doy|toma(lo|la)?,? (es )?tuy\w*|aqui tienes|te lo devuelvo|lo suelto|la suelto|suelto (el|la|los|las))\b/;
const RE_APOLOGIZE = /\b(perdon\w*|disculp\w*|lo siento|lo lamento)\b/;
const RE_PAY = /\b(pag\w*|compens\w*|te lo pago|te doy \d+)\b/;
const RE_DECEIVE = /\b(mient\w*|enga[nñ]\w*|no he sido|yo no he|no era yo|me he confundido|pensaba que era mi\w*|era mi\w*)\b/;
const RE_PERSUADE = /\b(convenc\w*|explic\w*|razon\w*|era una broma|solo era|no queria|ha sido sin querer|me arrepiento)\b/;
const RE_RESIST = /\b(huy\w*|corr\w*|escap\w*|me voy|me largo|salgo corriendo|ni hablar|no te lo devuelvo|no pienso|le pego|le ataco|ataco|golpe\w*|le empujo|me suelto|me zafo)\b/;

/** Lee lo que contesta en el careo; null si hace otra cosa (y entonces es no arreglarlo). */
export function confrontAnswer(text: string): ConfrontAnswer | null {
  const t = plainText(text);
  if (RE_RESIST.test(t)) return 'resist';
  if (RE_RETURN.test(t)) return 'return';
  if (RE_PAY.test(t)) return 'pay';
  if (RE_DECEIVE.test(t)) return 'deceive';
  if (RE_PERSUADE.test(t)) return 'persuade';
  if (RE_APOLOGIZE.test(t)) return 'apologize';
  return null;
}

/** Los botones del careo: lo que puede hacer para arreglarlo, o huir. */
export function confrontButtons(world: World, pc: Character, nowG: number): string[] {
  const o = confrontOf(world, pc, nowG);
  if (!o) return [];
  const name = pc.knows.includes(o.npc.id) ? o.npc.name : descriptorOf(world, o.npc.id);
  const has = o.c.instance_id !== null && world.itemsCarriedBy(pc.id).some((i) => i.id === o.c.instance_id);
  return [has ? `Devolvérselo a ${name}` : `Disculparme con ${name}`, `Convencer a ${name}`, ...(has ? [`Pagarle a ${name}`] : []), 'Salir corriendo'];
}

/** Lo que pasa al contestar un careo: el texto (segunda persona), si queda cerrado y si hay que tirar. */
export interface ConfrontSettlement {
  text: string;
  /** Lo que ve la sala. */
  observable: string;
  closed: boolean;
  /** Persuasión o Engaño: tirada contra la CD del careo. */
  roll: { key: 'persuasion' | 'deception'; dc: number } | null;
  incident: Incident | null;
}

/** El delito que queda cuando no lo arregla: robo, intento de robo o agresión. */
function escalate(world: World, pc: Character, npc: Npc, c: NpcConfront, nowG: number): Incident | null {
  const has = c.instance_id !== null && world.itemsCarriedBy(pc.id).some((i) => i.id === c.instance_id);
  const kind = c.kind === 'steal' || c.kind === 'snatch' ? (has ? 'theft' as const : 'theft_attempt' as const) : 'assault' as const;
  return c.crime ? null : reportIncident(world, { kind, perpetrator_id: pc.id, victim_id: npc.id, spot_id: npc.location.id }, nowG);
}

/**
 * Contesta el careo abierto con este NPC. Devolverlo (o disculparse si no hay
 * nada que devolver) o pagarlo lo deja en advertencia; convencerle o engañarle
 * pide tirada; huir o pelear lo convierte en delito, y quien es de pelear pasa a
 * hostil. Si ya era delito (le agarró de la muñeca), arreglarlo evita la pelea,
 * no el delito.
 */
export function settleConfront(world: World, pc: Character, npc: Npc, answer: ConfrontAnswer, nowG: number): ConfrontSettlement {
  const c = npc.confront?.[pc.id];
  const who = pc.knows.includes(npc.id) ? npc.name : descriptorOf(world, npc.id);
  const Who = who.charAt(0).toUpperCase() + who.slice(1);
  if (!c) return { text: '', observable: '', closed: true, roll: null, incident: null };
  const inst = c.instance_id ? world.itemsCarriedBy(pc.id).find((i) => i.id === c.instance_id) ?? null : null;
  const what = inst ? world.itemDef(inst.item_id).name : null;
  const done = (text: string, observable: string, incident: Incident | null = null): ConfrontSettlement => {
    closeConfront(world, npc, pc);
    return { text, observable, closed: true, roll: null, incident };
  };
  switch (answer) {
    case 'return': {
      if (!inst) return done(`${Who} se queda mirándote: no tienes nada suyo. Le basta con que te largues.`, `${pc.name} se excusa ante ${npc.name}.`);
      const back = transferItem(world, inst.id, { type: 'npc', id: npc.id });
      if (back.ok) { delete back.moved.state['stolen']; world.touch('item_instances', back.moved.id); }
      memo(world, npc, pc, `${pc.name} le devolvió ${what}.`, 2, nowG);
      return done(`Le devuelves ${what} a ${who}. Te lo arranca de la mano y no te quita ojo${c.crime ? ', pero lo que has hecho ya lo sabe quien lo vio' : ': queda en un aviso'}.`, `${pc.name} le devuelve algo a ${npc.name}.`);
    }
    case 'apologize': {
      if (inst) return { text: `${Who} no se conforma con palabras: quiere ${what}.`, observable: `${pc.name} se disculpa ante ${npc.name}.`, closed: false, roll: null, incident: null };
      memo(world, npc, pc, `${pc.name} se disculpó.`, 1, nowG);
      return done(`Te disculpas. ${Who} lo acepta a regañadientes${c.crime ? '' : ': queda en un aviso'}.`, `${pc.name} se disculpa ante ${npc.name}.`);
    }
    case 'pay': {
      const value = inst ? world.itemDef(inst.item_id).value : 0;
      if (!inst) return { text: `${Who} no quiere tu dinero: quiere una disculpa.`, observable: `${pc.name} le ofrece dinero a ${npc.name}.`, closed: false, roll: null, incident: null };
      // El dinero sale de su bolsa y va a la del NPC (money.ts, bloque D: no hay un número de monedas suelto).
      const paid = pay(world, pc.id, value, npc.id);
      if (!paid.ok) return { text: `No llevas bastante para pagárselo (${money(world, value)}). ${Who} sigue esperando.`, observable: `${pc.name} busca dinero.`, closed: false, roll: null, incident: null };
      if (inst.state['stolen']) { delete inst.state['stolen']; inst.state['owner_id'] = pc.id; world.touch('item_instances', inst.id); }
      memo(world, npc, pc, `${pc.name} le pagó ${what} que le había quitado.`, 2, nowG);
      return done(`Le pagas ${money(world, value)} a ${who} por ${what}. Lo cuenta, se lo guarda y te deja ir${c.crime ? '' : ': queda en un aviso'}.`, `${pc.name} le paga a ${npc.name}.`);
    }
    case 'persuade': case 'deceive':
      if (c.argued) return { text: `${Who} ya no quiere oír más excusas.`, observable: '', closed: false, roll: null, incident: null };
      c.argued = true;
      world.touch('npcs', npc.id);
      return { text: '', observable: '', closed: false, roll: { key: answer === 'persuade' ? 'persuasion' : 'deception', dc: c.dc }, incident: null };
    case 'resist': {
      const incident = escalate(world, pc, npc, c, nowG);
      if (npc.stats && !npc.noncombatant) { npc.attitude.by_character[pc.id] = 'hostile'; world.touch('npcs', npc.id); }
      return done(`No lo arreglas. Para ${who} ya es un delito.`, `${pc.name} se revuelve ante ${npc.name}.`, incident);
    }
  }
}

/** La tirada de convencerle en un careo: con éxito, queda en un aviso (y le devuelve lo suyo); si falla, delito. */
export function confrontRolled(world: World, pc: Character, npc: Npc, success: boolean, nowG: number): ConfrontSettlement {
  const c = npc.confront?.[pc.id];
  const who = npc.name;
  if (!c) return { text: '', observable: '', closed: true, roll: null, incident: null };
  if (success) {
    const inst = c.instance_id ? world.itemsCarriedBy(pc.id).find((i) => i.id === c.instance_id) ?? null : null;
    if (inst) { const back = transferItem(world, inst.id, { type: 'npc', id: npc.id }); if (back.ok) delete back.moved.state['stolen']; }
    closeConfront(world, npc, pc);
    memo(world, npc, pc, `${pc.name} le convenció de dejarlo en un aviso.`, 1, nowG);
    return { text: `${who} se lo traga${inst ? ', recupera lo suyo' : ''} y lo deja en un aviso.`, observable: '', closed: true, roll: null, incident: null };
  }
  const incident = escalate(world, pc, npc, c, nowG);
  closeConfront(world, npc, pc);
  if (npc.stats && !npc.noncombatant) { npc.attitude.by_character[pc.id] = 'hostile'; world.touch('npcs', npc.id); }
  return { text: `${who} no se lo cree. Para ${who} ya es un delito.`, observable: '', closed: true, roll: null, incident };
}

/** Un careo sin contestar: hace otra cosa, o se acaba la hora. Es no arreglarlo: delito. */
export function confrontIgnored(world: World, pc: Character, npc: Npc, nowG: number): Incident | null {
  const c = npc.confront?.[pc.id];
  if (!c) return null;
  const incident = escalate(world, pc, npc, c, nowG);
  closeConfront(world, npc, pc);
  return incident;
}
