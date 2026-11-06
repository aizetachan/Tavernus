/**
 * NPC de relleno (docs/PLAN-NPC-RELLENO.md): gente de paso con oficio, nombre y horario que hace pueblo sin pesar
 * en la historia. Son `Npc` normales con `tier: 'extra'`, así que el horario, la percepción, el minimapa, el ajuar,
 * el robo, el crimen y la muerte valen para ellos sin código aparte. Lo propio es cómo se escriben: una ficha corta
 * (`ExtraDef`) que se completa con la plantilla de su oficio (`TRADES`), sin secretos, sin misiones y con un guion
 * de frases cortas.
 *
 * Agnóstico: el motor no sabe de ninguna campaña. Una campaña escrita trae sus fichas (Brezal, `extras.ts`); los
 * mundos generados las sacarán del tipo de asentamiento con la semilla (fase 5).
 *
 * Aquí: el catálogo de oficios, el montaje de una ficha en `Npc`, la asistencia a los eventos (el relleno que va a
 * un evento sale de su multitud), el validador y la migración de partidas empezadas.
 */

import type { Calendar, ExtraLines, ExtraScript, ExtraService, ExtraTemper, Id, ItemInstance, Npc, NpcBond, WorldSnapshot } from './model.js';
import { AFTERNOON_H, type NpcRoutine, type ScheduledEvent } from './schedule.js';
import type { Archetype, Genre } from '../worldgen/catalog.js';
import { ARCHETYPES } from '../worldgen/skeleton.js';
import { holdNpcAt } from './npcorders.js';
import type { World } from './world.js';

export type TradeId =
  | 'watchman' | 'devout' | 'baker' | 'laborer' | 'washer' | 'woodcutter' | 'peddler' | 'shepherd' | 'child' | 'servant' | 'regular'
  | 'fisher' | 'miner';

type Wealth = NonNullable<Npc['wealth']>;

/** Un oficio de relleno: cómo se llama en cada género, qué lleva, cómo es y cómo habla. */
export interface TradeDef {
  id: TradeId;
  /** Nombre del oficio por género de mundo y de persona; sin el del género, el de fantasía. */
  label: { fantasy: { m: string; f: string } } & Partial<Record<Genre, { m: string; f: string }>>;
  /** Ajuar (outfit.ts, `KITS`). */
  kit: string;
  wealth: Wealth;
  archetype: Archetype;
  /** PG del bloque, si no son los del arquetipo (un niño). */
  hp?: number;
  perception: number;
  noncombatant: boolean;
  temper: ExtraTemper;
  service: ExtraService;
  /** Lo que quiere, en una frase: es lo único de su motivación. */
  motivation: string;
  lines: ExtraLines;
}

/** Frases comunes a todos los oficios; cada oficio pisa las suyas. */
const COMMON: ExtraLines = {
  greet: ['¿Qué quieres?', '¿Sí?', 'Buenas. ¿Qué pasa?'],
  service: [],
  dunno: ['Ni idea.', 'De eso no sé nada. Pregúntale a {refer}.', 'No es cosa mía. {refer} sabrá.'],
  brush: ['Tengo faena.', 'Déjame, que no tengo tiempo.', 'Ya está bien de preguntas.'],
  known: ['Ya sé quién eres: {fame}.', 'Tú eres el que {fame}. Ya se sabe.'],
  news: ['¿Te has enterado? {news}.', '{news}. Quién lo iba a decir.'],
  scared: ['¡Socorro! ¡A la guardia!', '¡Aparta! ¡Aparta de mí!'],
  accuse: ['¡Eh! ¡Suelta eso! ¡Al ladrón!', '¡Me ha robado! ¡Al ladrón!'],
  afraid: ['Déjame en paz.', 'No quiero nada contigo.'],
  bye: ['Ya.', 'Hala.'],
};

const T = (id: TradeId, label: TradeDef['label'], rest: Omit<TradeDef, 'id' | 'label' | 'lines' | 'perception' | 'noncombatant' | 'archetype'> & Partial<Pick<TradeDef, 'perception' | 'noncombatant' | 'archetype'>> & { lines?: Partial<ExtraLines> }): TradeDef => ({
  id, label, archetype: 'commoner', perception: 10, noncombatant: true, ...rest, lines: { ...COMMON, ...rest.lines },
});

export const TRADES: Record<TradeId, TradeDef> = {
  watchman: T('watchman', { fantasy: { m: 'sereno', f: 'serena' }, scifi: { m: 'vigilante nocturno', f: 'vigilante nocturna' }, postapoc: { m: 'centinela de noche', f: 'centinela de noche' } }, {
    kit: 'guard', wealth: 'poor', perception: 12, temper: 'seco', service: 'directions',
    motivation: 'Que pase la noche sin sustos.',
    lines: {
      greet: ['¿Buscas algo?', '¿Qué se te ha perdido a estas horas?', 'Di qué buscas, que la noche es larga.'],
      service: ['{where}', 'Mira: {where}'],
      dunno: ['Eso no lo sé.', 'Yo solo vigilo. Eso, pregúntaselo a {refer}.'],
      brush: ['Sigue tu camino.', 'Ya te he dicho lo que sé.'],
      bye: ['Ve con cuidado.', 'Y no andes a oscuras.'],
    },
  }),
  devout: T('devout', { fantasy: { m: 'beato', f: 'beata' }, scifi: { m: 'devoto', f: 'devota' }, postapoc: { m: 'devoto', f: 'devota' } }, {
    kit: 'priest', wealth: 'poor', temper: 'tímido', service: 'hours',
    motivation: 'Que no falte nadie al rezo.',
    lines: {
      greet: ['Dios te guarde.', '¿Vienes al rezo?'],
      service: ['{when}', 'Apúntatelo: {when}'],
      brush: ['Tengo que cambiar las velas.', 'Reza tú también, que falta hace.'],
      bye: ['Ve con Dios.'],
    },
  }),
  baker: T('baker', { fantasy: { m: 'panadero', f: 'panadera' }, scifi: { m: 'cocinero', f: 'cocinera' }, postapoc: { m: 'panadero', f: 'panadera' } }, {
    kit: 'baker', wealth: 'modest', temper: 'seco', service: 'sell',
    motivation: 'Vender el pan antes de que se ponga duro.',
    lines: {
      greet: ['¿Llevas o no?', '¿Qué va a ser?'],
      service: ['{item}, {price}. ¿Llevas o no?', '{item} a {price}.'],
      brush: ['Tengo hornada. Si no compras, aparta.', 'No me hagas perder la mañana.'],
      bye: ['Que aproveche.'],
    },
  }),
  laborer: T('laborer', { fantasy: { m: 'labrador', f: 'labradora' }, scifi: { m: 'operario', f: 'operaria' }, postapoc: { m: 'cultivador', f: 'cultivadora' } }, {
    kit: 'laborer', wealth: 'poor', temper: 'seco', service: 'none',
    motivation: 'Sacar algo de la tierra y que le dejen en paz.',
    lines: {
      greet: ['¿Qué?', 'Buenas.'],
      brush: ['Tengo que volver al huerto.', 'Eso no es cosa mía.'],
    },
  }),
  washer: T('washer', { fantasy: { m: 'lavandero', f: 'lavandera' }, scifi: { m: 'operario de lavandería', f: 'operaria de lavandería' } }, {
    kit: 'washer', wealth: 'poor', temper: 'con prisa', service: 'hours',
    motivation: 'Acabar la colada antes de que caiga la ceniza.',
    lines: {
      greet: ['¿Qué quieres, que se me enfría el agua?', '¿Sí?'],
      service: ['{when}'],
      brush: ['Tengo ropa que tender.', 'No tengo tiempo para charlas.'],
    },
  }),
  woodcutter: T('woodcutter', { fantasy: { m: 'leñero', f: 'leñera' }, scifi: { m: 'recolector', f: 'recolectora' }, postapoc: { m: 'leñero', f: 'leñera' } }, {
    kit: 'laborer', wealth: 'poor', temper: 'seco', service: 'sell',
    motivation: 'Que no le falte leña que vender ni tenga que entrar en el monte.',
    lines: {
      greet: ['¿Leña? Tengo.', '¿Qué?'],
      service: ['{item}, {price}.', '{item} a {price}. Seca, de la buena.'],
      brush: ['Tengo que volver a por más.', 'Si no compras, aparta.'],
    },
  }),
  peddler: T('peddler', { fantasy: { m: 'buhonero', f: 'buhonera' }, scifi: { m: 'chamarilero', f: 'chamarilera' }, postapoc: { m: 'trapero', f: 'trapera' } }, {
    kit: 'merchant', wealth: 'modest', temper: 'parlanchín', service: 'sell',
    motivation: 'Vender lo que le queda y salir de aquí.',
    lines: {
      greet: ['¡Mira, mira! Barato, que me quiero ir.', '¿Buscas algo? Lo que queda, barato.'],
      service: ['{item}, {price}. Te lo dejo así.', '{item} a {price}, y es regalado.'],
      dunno: ['Ni idea, yo soy de fuera.', 'Yo no soy de aquí. Pregúntale a {refer}.'],
      brush: ['Si no compras, no me hagas perder la tarde.'],
      bye: ['Si sabes cómo salir de aquí, avísame.'],
    },
  }),
  shepherd: T('shepherd', { fantasy: { m: 'pastor', f: 'pastora' }, scifi: { m: 'cuidador de ganado', f: 'cuidadora de ganado' } }, {
    kit: 'shepherd', wealth: 'poor', perception: 12, temper: 'tímido', service: 'none',
    motivation: 'Que no se le pierda ninguna oveja.',
    lines: {
      greet: ['¿Sí?', 'Hola.'],
      brush: ['Las ovejas se van. Tengo que irme.', 'No sé nada, de verdad.'],
    },
  }),
  child: T('child', { fantasy: { m: 'niño', f: 'niña' } }, {
    kit: 'child', wealth: 'none', hp: 2, perception: 13, temper: 'parlanchín', service: 'directions',
    motivation: 'Jugar y enterarse de todo.',
    lines: {
      greet: ['¿Tú quién eres?', '¡Hala, qué pinta!'],
      service: ['¡Por ahí! {where}', '{where}. ¡Te echo una carrera!'],
      dunno: ['¡No sé!', 'Eso pregúntaselo a {refer}.'],
      brush: ['¡Me voy!', '¡Que me llama mi madre!'],
      scared: ['¡Mamá! ¡Mamá!'],
      accuse: ['¡Ladrón! ¡Ladrón!'],
      afraid: ['¡No! ¡Déjame!'],
      bye: ['¡Adiós!'],
    },
  }),
  servant: T('servant', { fantasy: { m: 'criado', f: 'criada' }, scifi: { m: 'asistente', f: 'asistente' } }, {
    kit: 'servant', wealth: 'poor', temper: 'receloso', service: 'hours',
    motivation: 'Que en la casa no haya quejas de ella.',
    lines: {
      greet: ['¿Qué se le ofrece?', '¿Busca a alguien de la casa?'],
      service: ['{when}'],
      dunno: ['De la casa no hablo.', 'Eso pregúntelo a {refer}.'],
      brush: ['Me esperan dentro.', 'No puedo entretenerme.'],
      bye: ['Buenas.'],
    },
  }),
  fisher: T('fisher', { fantasy: { m: 'pescador', f: 'pescadora' }, scifi: { m: 'recolector de algas', f: 'recolectora de algas' }, postapoc: { m: 'pescador', f: 'pescadora' } }, {
    kit: 'fisher', wealth: 'poor', temper: 'seco', service: 'sell',
    motivation: 'Vender la pesca del día antes de que se eche a perder.',
    lines: {
      greet: ['¿Pescado? Del de hoy.', '¿Qué?'],
      service: ['{item}, {price}. Fresco.', '{item} a {price}.'],
      brush: ['Tengo que remendar las redes.', 'Si no compras, aparta, que huele.'],
    },
  }),
  miner: T('miner', { fantasy: { m: 'minero', f: 'minera' }, scifi: { m: 'perforador', f: 'perforadora' }, postapoc: { m: 'excavador', f: 'excavadora' } }, {
    kit: 'laborer', wealth: 'poor', temper: 'seco', service: 'none',
    motivation: 'Acabar el turno y no quedarse dentro.',
    lines: {
      greet: ['¿Qué?', 'Vengo del turno. ¿Qué quieres?'],
      brush: ['Estoy molido. Déjame.', 'Eso no es cosa mía.'],
    },
  }),
  regular: T('regular', { fantasy: { m: 'parroquiano', f: 'parroquiana' }, scifi: { m: 'cliente', f: 'clienta' } }, {
    kit: 'commoner', wealth: 'poor', temper: 'parlanchín', service: 'none',
    motivation: 'Que alguien le invite a la siguiente.',
    lines: {
      greet: ['¿Me invitas a algo?', 'Siéntate, siéntate.'],
      brush: ['Si no invitas, déjame beber tranquilo.'],
    },
  }),
};

/** Un vecino de relleno tal como se escribe en una campaña. Lo demás lo pone la plantilla de su oficio. */
export interface ExtraDef {
  id: Id;
  name: string;
  trade: TradeId;
  /** Para el nombre del oficio («la panadera»); sin campo, masculino. */
  gender?: 'f' | 'm';
  /** Su oficio con otras palabras («zagala», «viejo del Jabalí»); sin campo, el del oficio. */
  role?: string;
  /** Una frase: cómo se le ve. */
  look: string;
  /** Dos o tres frases: su historia breve. */
  story: string;
  /** Lo que quiere, si no es lo de su oficio. */
  motivation?: string;
  routine: NpcRoutine;
  home_spot_id: Id;
  /** Eventos de la agenda a los que va: sale de la multitud del evento. */
  attends?: Id[];
  sells?: { item_id: Id; price: number }[];
  /** A quién remite lo que no sabe (NPC que existen). */
  refer_to?: Id[];
  /** Frases propias, que pisan las del oficio en ese hueco. */
  lines?: Partial<ExtraLines>;
  temper?: ExtraTemper;
  kit?: string;
  wealth?: Wealth;
  bonds?: NpcBond[];
  /** Puntos por los que se mueve dentro de su franja (fase 2). */
  wander?: Id[];
}

/** Tope de relleno en un mismo punto y franja fuera de los eventos: más, y el sitio deja de parecer un pueblo. */
export const MAX_EXTRAS_PER_SPOT = 4;

export type ExtraNpc = Npc & { tier: 'extra'; script: ExtraScript };

export function isExtra(n: Npc): n is ExtraNpc { return n.tier === 'extra' && !!n.script; }

type Slot = 'day' | 'afternoon' | 'night';

/** Franja de una hora del día, con la misma regla que el horario (schedule.ts, `slotAt`). */
export function slotForHour(h: number, cal: Pick<Calendar, 'sunrise_h' | 'sunset_h'>): Slot {
  if (h >= cal.sunset_h || h < cal.sunrise_h) return 'night';
  return h < AFTERNOON_H ? 'day' : 'afternoon';
}

/** Dónde está en esa franja (la tarde, si no la tiene, es la de la mañana), o en casa. */
export function extraSpotAt(def: Pick<ExtraDef, 'routine' | 'home_spot_id'>, slot: Slot): Id {
  const r = def.routine;
  return (slot === 'afternoon' ? r.afternoon ?? r.day : r[slot]) ?? def.home_spot_id;
}

export function tradeLabel(trade: TradeId, genre: Genre, gender: 'f' | 'm' = 'm'): string {
  const t = TRADES[trade];
  return (t.label[genre] ?? t.label.fantasy)[gender];
}

/** Una ficha de relleno montada como `Npc`, en el punto dado. */
export function extraNpc(def: ExtraDef, genre: Genre, spotId: Id): ExtraNpc & { routine: NpcRoutine } {
  const t = TRADES[def.trade];
  if (!t) throw new Error(`Relleno ${def.id}: el oficio «${def.trade}» no existe (${Object.keys(TRADES).join(', ')}).`);
  const a = ARCHETYPES[t.archetype];
  const hp = t.hp ?? a.hp;
  const lines = { ...t.lines, ...def.lines } as ExtraLines;
  return {
    id: def.id, name: def.name, role: def.role ?? tradeLabel(def.trade, genre, def.gender),
    location: { type: 'spot', id: spotId }, status: 'alive', passive_perception: t.perception,
    description: `${def.look} ${def.story}`.trim(), motivation: def.motivation ?? t.motivation, secret: '',
    ...(t.noncombatant ? { noncombatant: true } : {}),
    memory: [], talking_to: null, home_spot_id: def.home_spot_id,
    buys: [], sells: structuredClone(def.sells ?? []),
    stats: { ...a, hp_max: hp, hp },
    attitude: { default: 'neutral', by_character: {} },
    ...(def.bonds?.length ? { bonds: structuredClone(def.bonds) } : {}),
    kit: def.kit ?? t.kit, wealth: def.wealth ?? t.wealth,
    tier: 'extra',
    script: {
      trade: def.trade, temper: def.temper ?? t.temper, service: t.service, lines: structuredClone(lines),
      refer_to: [...(def.refer_to ?? [])], story: def.story,
      ...(def.wander?.length ? { wander: [...def.wander] } : {}),
    },
    routine: { ...def.routine },
  };
}

/** Una persona menos en la multitud del evento: la primera cuenta es la de la gente sin cara que se junta. */
function thinCrowd(e: ScheduledEvent): void {
  const c = e.crowd[0];
  if (!c) return;
  c.count -= 1;
  if (c.count <= 0) e.crowd.shift();
}

/**
 * El relleno que va a un evento entra en sus asistentes y sale de su multitud: «vecinos ×10» con cinco del relleno
 * en la cena queda en «vecinos ×5» más ellos. Un evento que no existe es un error de los datos.
 */
export function attendExtras(events: ScheduledEvent[], defs: readonly ExtraDef[]): void {
  for (const d of defs) {
    for (const id of d.attends ?? []) {
      const e = events.find((x) => x.id === id);
      if (!e) throw new Error(`Relleno ${d.id}: el evento ${id} no está en la agenda.`);
      if (e.npc_ids.includes(d.id)) continue;
      e.npc_ids.push(d.id);
      thinCrowd(e);
    }
  }
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Lo que el validador (worldgen/validate.ts) comprueba del relleno de un mundo. */
export function extraProblems(snap: WorldSnapshot): string[] {
  const errs: string[] = [];
  const npcs = new Map(snap.npcs.map((n) => [n.id, n]));
  const spots = new Set(snap.spots.map((s) => s.id));
  const principals = new Set(snap.npcs.filter((n) => n.tier !== 'extra').map((n) => norm(n.name)));
  // Palabras de los sitios: un oficio que las lleva («criada de la casona») hace que «voy a la casona» se lea como
  // hablar con alguien (fastpath.ts, mentionsSomeone) y no como ir.
  const placeWords = new Set([...snap.locations.map((l) => l.name), ...snap.spots.flatMap((s) => [s.name, ...s.aliases])]
    .flatMap((t) => norm(t).split(/[^a-z0-9ñ]+/)).filter((w) => w.length > 3));
  const perSpot = new Map<string, Id[]>();
  for (const n of snap.npcs) {
    if (n.tier !== 'extra') continue;
    const s = n.script;
    if (!s) { errs.push(`relleno ${n.id}: le falta el guion (script).`); continue; }
    if (!(s.trade in TRADES)) errs.push(`relleno ${n.id}: el oficio «${s.trade}» no existe (${Object.keys(TRADES).join(', ')}).`);
    for (const id of s.refer_to) {
      const r = npcs.get(id);
      if (!r) errs.push(`relleno ${n.id}: remite a ${id}, que no existe.`);
      else if (r.tier === 'extra') errs.push(`relleno ${n.id}: remite a ${id}, que también es de relleno; remite a un principal.`);
    }
    for (const id of s.wander ?? []) if (!spots.has(id)) errs.push(`relleno ${n.id}: el punto ${id} de sus paseos no existe.`);
    if (!n.home_spot_id || !spots.has(n.home_spot_id)) errs.push(`relleno ${n.id}: necesita una casa (home_spot_id) que exista.`);
    if (principals.has(norm(n.name))) errs.push(`relleno ${n.id}: se llama como un personaje principal (${n.name}).`);
    const clash = norm(n.role).split(/[^a-z0-9ñ]+/).filter((w) => placeWords.has(w));
    if (clash.length) errs.push(`relleno ${n.id}: su oficio («${n.role}») nombra un sitio (${clash.join(', ')}); «voy a…» se leería como hablar con él. Usa otras palabras.`);
    const r = (n as Npc & { routine?: NpcRoutine }).routine ?? {};
    for (const slot of ['day', 'afternoon', 'night'] as const) {
      const at = (slot === 'afternoon' ? r.afternoon ?? r.day : r[slot]) ?? n.home_spot_id;
      if (!at || at === n.home_spot_id) continue;
      const k = `${slot}:${at}`;
      perSpot.set(k, [...(perSpot.get(k) ?? []), n.id]);
    }
  }
  for (const [k, ids] of perSpot) {
    if (ids.length > MAX_EXTRAS_PER_SPOT) {
      const [slot, spot] = k.split(':');
      errs.push(`relleno: ${ids.length} en ${spot} por la ${slot === 'day' ? 'mañana' : slot === 'afternoon' ? 'tarde' : 'noche'} (${ids.join(', ')}); el tope es ${MAX_EXTRAS_PER_SPOT}.`);
    }
  }
  return errs;
}

/** Quién lleva un ejemplar en un snapshot: el NPC que lo tiene o el del contenedor que lo guarda. */
function npcCarrier(snap: WorldSnapshot, inst: ItemInstance, depth = 0): Id | null {
  if (inst.location.type === 'npc') return inst.location.id;
  if (inst.location.type !== 'container' || depth > 8) return null;
  const parent = snap.item_instances.find((x) => x.id === inst.location.id);
  return parent ? npcCarrier(snap, parent, depth + 1) : null;
}

/**
 * Partidas empezadas antes del relleno. El arranque (engine.ts, `migrate`) ya añade los NPC que faltan de la semilla;
 * aquí, a los de relleno que acaban de entrar (`before`: los que había), lo que llevan escrito en la campaña y su sitio
 * en los eventos (y su hueco en la multitud). Una sola vez: un vecino que ya estaba no se toca, aunque le hayan robado.
 */
export function migrateExtras(snap: WorldSnapshot, seed: WorldSnapshot | undefined, before: ReadonlySet<Id>): boolean {
  if (!seed) return false;
  const added = new Set(seed.npcs.filter((n) => n.tier === 'extra' && !before.has(n.id) && snap.npcs.some((x) => x.id === n.id)).map((n) => n.id));
  if (!added.size) return false;
  const have = new Set(snap.item_instances.map((i) => i.id));
  for (const i of seed.item_instances) {
    const who = npcCarrier(seed, i);
    if (who && added.has(who) && !have.has(i.id)) snap.item_instances.push(structuredClone(i));
  }
  const store = snap.campaign as WorldSnapshot['campaign'] & { schedule?: ScheduledEvent[] };
  for (const se of (seed.campaign as typeof store).schedule ?? []) {
    const e = store.schedule?.find((x) => x.id === se.id);
    if (!e) continue;
    for (const id of se.npc_ids) {
      if (!added.has(id) || e.npc_ids.includes(id)) continue;
      e.npc_ids.push(id);
      thinCrowd(e);
    }
  }
  return true;
}

/** Pone a un vecino de relleno en un punto (un encuentro de camino) y lo retiene allí media hora; luego, su horario. */
export function placeExtraAt(world: World, n: Npc, spotId: Id, nowS: number): boolean {
  if (!world.spots.has(spotId) || !holdNpcAt(world, n, spotId, nowS, 30)) return false;
  n.location = { type: 'spot', id: spotId };
  world.touch('npcs', n.id);
  return true;
}
