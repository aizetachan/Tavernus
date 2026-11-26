/**
 * La charla con un vecino de relleno, sin IA (docs/PLAN-NPC-RELLENO.md, «Cómo contestan»). El flujo de charla
 * (talk.ts) ya sabe que el relleno tiene las capas recortadas; aquí, para las charlas simples, el motor elige la frase
 * de su guion (`script.lines`, extras.ts), rellena los huecos con los datos y la dice. No hay llamada al máster.
 *
 *   - lo urgente: miedo al PJ (le agredió o sabe que mató a alguien), le acusa si le robó, o se asusta (alarma);
 *   - saludo o abrir charla: un saludo frío y, si vende, lo que vende; con una noticia reciente, la cuenta;
 *   - lo que su papel le hace contestar: dónde está alguien o algo, a qué hora es algo, o vende;
 *   - lo que no sabe (la historia, secretos): lo dice y remite a quien sabe;
 *   - despedida;
 *   - y todo lo demás, que le despache; a la segunda, ya no le hace caso.
 *
 * Lo que no es charla simple (amenazas, insultos, «¿sabes quién soy?», pedirle que le acompañe…) va al máster con
 * el guion corto de talk.ts. null = no lo contesta el motor.
 */

import { GAME_HOUR, GAME_MINUTE } from '../clock/clock.js';
import { attitudeOf } from './combat.js';
import { allIncidents } from './crime.js';
import { isExtra, type ExtraNpc } from './extras.js';
import type { Character, ExtraLines, GameEvent, Id, Npc } from './model.js';
import { money } from './money.js';
import { descriptorOf, roleLabel } from './narrate.js';
import { buyFromNpc } from './progress.js';
import { allScheduled, hhmm } from './schedule.js';
import { priceFor } from './standing.js';
import { intentOf, talkPlan, type TalkIntent } from './talk.js';
import { allFacts, knowsFact } from './worldfacts.js';
import type { World } from './world.js';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «El molino» a media frase: «el molino». */
const place = (name: string) => name.replace(/^(El|La|Los|Las) /, (a) => a.toLowerCase());
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
/** El texto normalizado, sin signos y con espacios a los lados: para buscar palabras enteras. */
const padded = (s: string) => ` ${norm(s).replace(/[^a-z0-9]+/g, ' ').trim()} `;
/** Pide precio o qué vende. */
const ASKS_PRICE = /\b(cuanto|precio|vale|cuesta|que vendes|que tienes|que hay)\b/;
/** Quiere comprar ya. */
const WANTS = /\b(dame|deme|quiero|me llevo|compro|comprar|ponme|vendeme|vendame|uno|una)\b/;

/** Pregunta cuándo: «¿a qué hora es la misa?», «¿cuándo recibe el regidor?». Sin eso, la agenda no es respuesta. */
const ASKS_WHEN = /\b(cuando|a que hora|que hora|horario|hora de|recibe|abre|cierra|empieza)\b/;
/**
 * Lo que dice con el cuerpo, no con la boca: arrebatar, agarrar, beber, trepar, lanzar… Una frase así no la contesta el
 * vecino con su guion: la narra el máster (rompejuegos T11, herido T17 y T18; arreglo 35).
 */
const DOES = /\b(arrebat\w*|le quito|quitarle|robo|robarle|agarr\w*|suelto|empujo|golpe\w*|ataco|apunal\w*|desenvain\w*|lanzo|disparo|trepo|me subo|subo al|salto|vuelo|bebo|me bebo|destapo|registro|rebusco|forcejeo|le doy un)\b/;
/** Lo que es charla de verdad, a lo que vale su frase para despachar («Tengo faena»). Lo demás pide una respuesta. */
const CHATTY: ReadonlySet<TalkIntent> = new Set(['chat', 'calm', 'flattery']);

/** Una charla «seguida» con el mismo vecino: lo que le ha dicho en estos minutos cuenta para cansarse. */
export const EXTRA_TALK_WINDOW_S = 10 * GAME_MINUTE;
/** Respuestas que da antes de cerrarse en banda (si no es lo suyo: vender, indicar, la hora). */
export const EXTRA_PATIENCE = 2;
/** Una noticia es reciente durante dos días de juego. */
const NEWS_S = 48 * GAME_HOUR;

export interface ExtraReply {
  npc: ExtraNpc;
  /** Lo que dice, o null si ya no contesta. */
  line: string | null;
  /** La prosa corta del turno, para el actor. */
  narration: string;
  observable: string;
  /** Qué ha comprado, si ha comprado. */
  bought?: string;
  /** Se va (le tiene miedo): a su casa, un rato. */
  leaves?: boolean;
  /** El PJ aprende estos nombres (el vecino ha nombrado a alguien). */
  names?: Id[];
  /** No era lo suyo: cuenta para que se canse (`OFFTOPIC_TAG`). */
  offtopic?: boolean;
  /** Le ha mirado: la narración es cómo se le ve (no es charla ni cansa). */
  look?: boolean;
}

/** Cómo contesta, según su carácter: uno distinto cada vez (fase 5 del plan del 11-11: «un gesto distinto cada vez»). */
const GESTURES: Record<ExtraNpc['script']['temper'], readonly string[]> = {
  seco: ['sin levantar la vista', 'sin dejar lo que hace', 'con un gruñido', 'de mala gana', 'sin mirarte apenas'],
  'con prisa': ['sin pararse', 'ya de espaldas', 'mientras recoge sus cosas', 'a medio paso', 'sin soltar lo que lleva'],
  receloso: ['mirándote de arriba abajo', 'entornando los ojos', 'después de un silencio', 'con un paso atrás', 'sin fiarse'],
  parlanchín: ['enseguida', 'encantado de que le hablen', 'acercándose un poco más', 'con una sonrisa ancha', 'antes de que acabes'],
  tímido: ['en voz baja', 'sin mirarte a los ojos', 'casi en un susurro', 'con las manos ocupadas', 'tras dudar un momento'],
};

/** Lo que está haciendo, según su oficio: para la vista («mirar a X»). */
const DOING: Record<ExtraNpc['script']['service'], readonly string[]> = {
  sell: ['Atiende lo suyo sin perder de vista lo que vende.', 'Ordena la mercancía con las manos ocupadas.', 'Le echa un ojo a quien pasa, por si compra.'],
  directions: ['Vigila la calle con cara de haberlo visto todo.', 'Mira a un lado y a otro, como quien está de servicio.', 'Se mantiene en su sitio, atento a quien pasa.'],
  hours: ['Sigue con lo suyo, sin prisa.', 'Está pendiente de la hora, como si esperara algo.', 'Va de un lado a otro con faena.'],
  none: ['Sigue con su faena.', 'Está en lo suyo, sin hacer caso a nadie.', 'Descansa un momento antes de volver a lo suyo.'],
};

/** Le mira: «miro al herrero», «¿qué lleva la panadera?», «cómo va vestido». «¿Qué hace?» al empezar, no «sí que hace frío». */
const LOOKS_AT = /^(?:me fijo en|miro|observo|examino|contemplo|estudio|mirar|observar|examinar|le echo un vistazo|echo un vistazo|(?:y )?que hace)\b|\b(?:que lleva|que llevan|como es|como va vestid\w*|que aspecto|que esta haciendo)\b/;

/**
 * Cómo se le ve: lo que escribió el máster la primera vez (`script.look`), o la frase de sus datos. Más lo que está
 * haciendo. Sin la historia: eso no se ve mirando.
 */
export function lookOf(n: ExtraNpc, label: string, seed: number): string {
  const look = (n.script.look ?? n.description.replace(n.script.story, '')).trim();
  const doing = DOING[n.script.service] ?? DOING.none;
  return `${cap(label)}: ${look} ${doing[seed % doing.length]!}`.replace(/\s+/g, ' ').trim();
}

/** La llamada corta al máster para escribir cómo se le ve (engine.ts, una vez por vecino). */
export function lookPrompt(world: World, n: ExtraNpc): { system: string; prompt: string } {
  return {
    system: 'Escribes descripciones cortas para un juego de rol de texto en español. Contestas solo con el texto pedido, sin título ni comillas.',
    prompt: [
      `Describe cómo se ve a ${n.name}, ${roleLabel(n)}, para un jugador que le mira por primera vez: aspecto, ropa, lo que lleva a la vista y un gesto de lo que está haciendo ahora.`,
      `Lo que ya se sabe de él: ${n.script.look ?? n.description}`,
      `Su historia (NO la cuentes: no se ve mirando; sirve solo para que el aspecto encaje): ${n.script.story}`,
      `Mundo: ${world.campaign.premise}`,
      'Dos o tres frases, 60 palabras como mucho, en presente y en tercera persona. Nada que el jugador no pueda ver desde fuera: ni nombre, ni pensamientos, ni pasado.',
    ].join('\n'),
  };
}

/** Una frase del hueco, con sus huecos rellenos; solo las que tienen todo lo que piden. Estable para un mismo turno. */
function say(lines: readonly string[], vars: Record<string, string | undefined>, seed: number): string | null {
  const ok = lines.filter((l) => [...l.matchAll(/\{(\w+)\}/g)].every((m) => vars[m[1]!]));
  if (!ok.length) return null;
  const out = cap(ok[seed % ok.length]!.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]!)).replace(/([.?!] )([a-záéíóúñ])/g, (_, p: string, c: string) => p + c.toUpperCase());
  return /[.!?…»]$/.test(out) ? out : `${out}.`;
}

function seedOf(n: Npc, events: readonly GameEvent[]): number {
  let h = events.length;
  for (const ch of n.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Etiqueta del turno en que el vecino contesta algo que no es lo suyo: eso es lo que le cansa. */
export const OFFTOPIC_TAG = 'extra_offtopic';

/**
 * Lo que este vecino le ha dicho a este PJ en la charla de ahora (dentro de la ventana). Con `offtopic`, solo lo que
 * no era lo suyo (vender, indicar, la hora, saludar): eso es lo que le cansa.
 */
function recentReplies(events: readonly GameEvent[], pc: Character, n: Npc, nowG: number, offtopic = false): number {
  let k = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.timestamp_game_s < nowG - EXTRA_TALK_WINDOW_S) break;
    if (e.actor_id !== pc.id || (offtopic && !e.tags.includes(OFFTOPIC_TAG))) continue;
    const ls = e.payload['lines'];
    if (Array.isArray(ls) && (ls as { speaker: string; npc_id?: string }[]).some((l) => l.speaker === 'npc' && l.npc_id === n.id)) k++;
  }
  return k;
}

/** Lo que este vecino le ha dicho a este PJ en la charla de ahora (dentro de la ventana). */
function saidLately(events: readonly GameEvent[], pc: Character, n: Npc, nowG: number): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.timestamp_game_s < nowG - EXTRA_TALK_WINDOW_S) break;
    if (e.actor_id !== pc.id) continue;
    const ls = e.payload['lines'];
    if (Array.isArray(ls)) for (const l of ls as { speaker: string; npc_id?: string; text: string }[]) if (l.speaker === 'npc' && l.npc_id === n.id) out.push(l.text);
  }
  return out;
}

/** ¿Ya le dio la espalda en esta charla («ya no te hace caso»)? Eso se dice una vez. */
function ignoredLately(events: readonly GameEvent[], pc: Character, n: Npc, nowG: number): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.timestamp_game_s < nowG - EXTRA_TALK_WINDOW_S) break;
    if (e.actor_id === pc.id && e.tags.includes('extra') && e.payload['npc_id'] === n.id && !Array.isArray(e.payload['lines'])) return true;
  }
  return false;
}

/**
 * ¿Le habla a otro, aunque este vecino sea el único al lado? «Le pregunto a la vendedora del puesto…» con el sereno
 * delante (recolector T26): ni el sereno ni nadie contesta por ella; al máster.
 */
function asksSomeoneElse(world: World, self: Npc, text: string): boolean {
  const m = norm(text).match(/\b(?:pregunto|digo|pido|cuento|comento|grito|susurro|hablo con|me dirijo)\s+a?\s*(?:(?:el|la|los|las|al)\s+)?([a-zñ]+)/);
  if (!m) return false;
  const w = m[1]!;
  const mine = [self.name.split(' ')[0]!, ...words(self.role)].map(norm);
  if (mine.includes(w) || mine.some((x) => x.startsWith(w) || w.startsWith(x))) return false;
  return [...world.npcs.values()].some((x) => x.id !== self.id && [x.name.split(' ')[0]!, ...words(x.role)].map(norm).includes(w))
    || /^(vendedor|vendedora|tendero|tendera|mujer|hombre|chico|chica|nino|nina|senor|senora|viejo|vieja)$/.test(w);
}

/** Le agredió (o sabe que mató o hirió a alguien): le tiene miedo. */
function afraidOf(world: World, n: Npc, pc: Character): boolean {
  if (attitudeOf(n, pc.id) === 'hostile') return true;
  return allIncidents(world).some((i) => i.perpetrator_id === pc.id && (i.kind === 'assault' || i.kind === 'armed_assault' || i.kind === 'murder')
    && (i.victim_id === n.id || i.knowers.some((k) => k.npc_id === n.id)));
}

/** Le robó a él y lo sabe. */
function robbedBy(world: World, n: Npc, pc: Character): boolean {
  return allIncidents(world).some((i) => i.perpetrator_id === pc.id && i.kind === 'theft' && i.victim_id === n.id && i.knowers.some((k) => k.npc_id === n.id));
}

/** Una noticia reciente que sabe y que aún no le ha contado a este PJ. */
function newsFor(world: World, events: readonly GameEvent[], pc: Character, n: Npc, nowG: number): string | null {
  const told = new Set<string>();
  for (const e of events) {
    if (e.actor_id !== pc.id || !Array.isArray(e.payload['lines'])) continue;
    for (const l of e.payload['lines'] as { npc_id?: string; text: string }[]) if (l.npc_id === n.id) told.add(l.text);
  }
  const f = [...allFacts(world)].reverse().find((x) => x.text && x.game_s >= nowG - NEWS_S && knowsFact(x, n.id) && x.by !== pc.id);
  if (!f?.text) return null;
  const text = f.text.replace(/\.$/, '');
  return [...told].some((t) => t.includes(text)) ? null : text;
}

/** Dónde está alguien o algo, en palabras de un vecino; null si no lo sabe o no lo dice. */
function whereIs(world: World, pc: Character, self: Npc, text: string): { where: string; names: Id[] } | null {
  const t = padded(text);
  // Alguien: por su nombre (si el PJ lo sabe o lo dice) o por su oficio.
  const people = [...world.npcs.values()].filter((x) => x.id !== self.id && x.status === 'alive' && !x.mute);
  const hit = people.find((x) => t.includes(` ${norm(x.name.split(' ')[0]!)} `))
    ?? people.filter((x) => x.tier !== 'extra').find((x) => words(x.role).some((w) => t.includes(` ${w} `)));
  if (hit) {
    const spot = world.spot(hit.location.id);
    const loc = world.location(spot.location_id);
    // Solo lo público: quien tiene casa conocida o anda por un sitio que el PJ ya conoce.
    const knownLoc = loc.discovery[pc.id] !== undefined;
    if (!hit.home_spot_id && !knownLoc) return null;
    const home = hit.home_spot_id ? world.spot(hit.home_spot_id) : null;
    const homeLoc = home ? world.location(home.location_id) : null;
    const who = `${hit.name}, ${roleLabel(hit)}`;
    const lives = homeLoc && homeLoc.id !== loc.id ? `; vive en ${place(homeLoc.name)}` : '';
    return { where: `${cap(who)}: ahora está en ${place(loc.name)}${lives}`, names: [hit.id] };
  }
  // Algo: un sitio del mundo por su nombre.
  const here = world.spot(world.characterSpot(pc)!.id).location_id;
  const loc = [...world.locations.values()].find((l) => l.id !== here && words(l.name).some((w) => t.includes(` ${w} `)));
  if (!loc) return null;
  const exit = [...world.exits.values()].find((x) => world.spot(x.from_spot_id).location_id === here && world.spot(x.to_spot_id).location_id === loc.id)
    ?? [...world.exits.values()].find((x) => x.bidirectional && world.spot(x.to_spot_id).location_id === here && world.spot(x.from_spot_id).location_id === loc.id);
  if (!exit) return { where: `${cap(place(loc.name))} queda más allá; pregunta por el camino`, names: [] };
  const door = world.spot(exit.from_spot_id).location_id === here ? world.spot(exit.from_spot_id) : world.spot(exit.to_spot_id);
  return { where: `${cap(place(loc.name))}: sal por ${door.name}`, names: [] };
}

/** A qué hora es algo de la agenda; null si no lo nombra. */
function whenIs(world: World, text: string): string | null {
  const t = padded(text);
  const e = allScheduled(world).find((x) => words(x.title).some((w) => t.includes(` ${w} `)));
  if (!e) return null;
  return `${cap(e.title)}: ${e.recurrence === 'daily' ? 'cada día' : 'a veces'} a las ${hhmm(e.start_h * GAME_HOUR)}, en ${world.spot(e.spot_id).name}`;
}

/** La respuesta de un vecino de relleno a esta acción, o null si no es una charla simple con uno. */
export function extraReply(world: World, events: readonly GameEvent[], pc: Character, text: string, nowG: number): ExtraReply | null {
  const plan = talkPlan(world, events, pc, text, nowG) ?? buyingFrom(world, events, pc, text, nowG);
  if (!plan || plan.level !== 'extra') return null;
  const n = world.npcs.get(plan.npc_id);
  if (!n || !isExtra(n) || n.down || n.bound) return null;
  // Con otro PJ: la cola de la charla la lleva el máster.
  if (n.talking_to && n.talking_to.character_id !== pc.id) return null;
  const L: ExtraLines = n.script.lines;
  const seed = seedOf(n, events);
  const label = pc.knows.includes(n.id) ? n.name : descriptorOf(world, n.id);
  const reply = (line: string | null, narration: string, extra: Partial<ExtraReply> = {}): ExtraReply => ({
    npc: n, line, narration, observable: `${pc.name} habla con ${n.name}.`, ...extra,
  });
  const gestures = GESTURES[n.script.temper] ?? GESTURES.seco;
  const answer = (line: string | null, extra: Partial<ExtraReply> = {}) => reply(line, line ? `${cap(label)} contesta ${gestures[seed % gestures.length]!}.` : `${cap(label)} ya no te hace caso.`, extra);

  // 1. Lo urgente: una alarma o peligro, el miedo al PJ, que le robó.
  if (plan.state.flags.some((f) => f.block)) return reply(say(L.scared, {}, seed), `${cap(label)} no está para charlas.`);
  if (afraidOf(world, n, pc)) return reply(say(L.afraid, {}, seed), `${cap(label)} se aparta de ti y se marcha.`, { leaves: true });
  if (robbedBy(world, n, pc)) return reply(say(L.accuse, {}, seed), `${cap(label)} te señala.`);

  // Mirarle no es charla: cómo se le ve y qué está haciendo, sin que cuente para cansarle (fase 5 del plan del 11-11).
  if (LOOKS_AT.test(norm(text).trim()) && plan.intent !== 'trade' && plan.intent !== 'greeting' && plan.intent !== 'farewell') {
    return { npc: n, line: null, narration: lookOf(n, label, seed), observable: `${pc.name} mira a ${n.name}.`, look: true };
  }

  // Lo que no es charla simple: al máster, con el guion corto.
  if (plan.intent === 'insult' || plan.intent === 'threat' || plan.intent === 'identity') return null;
  // Ni charla: hace otra cosa (trepa, bebe, le arrebata el cubo) o le habla a otro. Al máster (arreglo 35).
  if (plan.talky === false || asksSomeoneElse(world, n, text)) return null;
  if (DOES.test(norm(text)) && plan.intent !== 'trade') return null;
  // Lo que pidió de verdad (el relleno lo resume en «chat»): una pregunta, trabajo o un favor piden respuesta.
  const tx = 'text' in plan ? plan.text : null;
  const asked: TalkIntent = !tx || !('topics' in plan) ? 'trade' : tx.question || tx.request || tx.asks_work ? 'question' : intentOf(plan.state, tx, plan.topics, text);

  const refer = n.script.refer_to.map((id) => world.npcs.get(id)).filter((x): x is Npc => Boolean(x) && x!.status === 'alive');
  const referTo = refer[seed % Math.max(1, refer.length)];
  const referName = referTo?.name;
  // Lo que no es lo suyo: la primera vez contesta; la segunda le despacha; luego ya no le hace caso.
  const off = recentReplies(events, pc, n, nowG, true);

  // 2. Lo suyo: vender, indicar, la hora. Eso lo contesta siempre.
  const t = padded(text);
  const named = n.sells.find((s) => { const d = world.itemDefs.get(s.item_id); return d && [d.name, ...d.aliases].some((a) => t.includes(padded(a))); });
  if ((plan.intent === 'trade' || named) && n.sells.length) {
    const offer = named ?? n.sells[0]!;
    const def = world.itemDef(offer.item_id);
    const price = money(world, priceFor(n, pc.id, offer.price, 'buy'));
    if (!WANTS.test(t) || ASKS_PRICE.test(t)) return answer(say(L.service, { item: def.name, price }, seed));
    const r = buyFromNpc(world, pc, n.id, offer.item_id, 1, nowG);
    if (!r.ok) return answer(`${cap(def.name)}, ${price}. ${r.reason.includes('dinero') || r.reason.includes('monedas') ? 'Y no te llega.' : 'Ahora no me queda.'}`);
    return reply(`Ahí tienes. ${cap(def.name)}, ${price}.`, `${cap(label)} te da ${def.name} y se guarda las monedas.`, { bought: `${r.item} ×${r.quantity}` });
  }
  if (plan.intent === 'public') {
    if (n.script.service === 'directions') {
      const w = whereIs(world, pc, n, text);
      if (w) return answer(say(L.service, { where: w.where }, seed), { names: w.names });
    }
    if (n.script.service === 'hours' && ASKS_WHEN.test(t)) {
      const when = whenIs(world, text);
      if (when || L.service.some((l) => !l.includes('{'))) return answer(say(L.service, { when: when ?? undefined }, seed));
    }
    if (n.script.service === 'sell' && n.sells[0] && ASKS_PRICE.test(t)) {
      const def = world.itemDef(n.sells[0].item_id);
      return answer(say(L.service, { item: def.name, price: money(world, priceFor(n, pc.id, n.sells[0].price, 'buy')) }, seed));
    }
  }

  // 3. Lo que no es lo suyo, una vez por charla (arreglo 35). Ya le contestó algo que no era lo suyo y no es charla, o
  // ya le despachó: que conteste el máster. Ya le dio la espalda: no se repite; al máster.
  const said = saidLately(events, pc, n, nowG);
  const brushed = said.some((l) => L.brush.includes(l));
  const ignored = ignoredLately(events, pc, n, nowG);
  if (off >= EXTRA_PATIENCE) return ignored ? null : answer(null);
  const lead = plan.intent === 'open' || plan.intent === 'greeting' || plan.intent === 'farewell';
  if (off === EXTRA_PATIENCE - 1 && !lead) return CHATTY.has(asked) && !brushed ? answer(say(L.brush, {}, seed), { offtopic: true }) : null;

  // 4. Saludo, lo que no sabe, despedida y lo demás.
  if (plan.intent === 'open' || plan.intent === 'greeting') {
    const news = newsFor(world, events, pc, n, nowG);
    const greet = news ? say(L.news, { news }, seed) : say(L.greet, {}, seed);
    const shop = n.script.service === 'sell' && n.sells[0] ? say(L.service, { item: world.itemDef(n.sells[0].item_id).name, price: money(world, priceFor(n, pc.id, n.sells[0].price, 'buy')) }, seed) : null;
    return answer([greet, shop].filter(Boolean).join(' ') || null);
  }
  if (plan.intent === 'delicate' || plan.intent === 'public') {
    const line = say(L.dunno, { refer: referName }, seed);
    if (line && said.includes(line)) return null;
    return answer(line, { offtopic: true, ...(referTo && line?.includes(referTo.name) ? { names: [referTo.id] } : {}) });
  }
  if (plan.intent === 'farewell') return answer(say(L.bye, {}, seed));
  // «No tengo tiempo para charlas» solo a la charla, y una vez: lo que pide respuesta lo contesta el máster.
  if (!CHATTY.has(asked) || brushed) return null;
  return answer(say(L.brush, {}, seed), { offtopic: true });
}


/**
 * «Dame un pan» sin nombrarle: si hablaba con un vecino de relleno hace nada y pide algo que vende él, es con él.
 * Un plan mínimo de comercio; lo demás lo decide `talkPlan`.
 */
function buyingFrom(world: World, events: readonly GameEvent[], pc: Character, text: string, nowG: number): { npc_id: Id; level: 'extra'; intent: 'trade'; state: { flags: { block: boolean }[] } } | null {
  const here = world.characterSpot(pc)?.location_id;
  const t = padded(text);
  if (!here || !WANTS.test(t)) return null;
  for (const n of world.npcs.values()) {
    if (!isExtra(n) || n.status !== 'alive' || world.spot(n.location.id).location_id !== here || !n.sells.length) continue;
    if (recentReplies(events, pc, n, nowG) === 0) continue;
    const sells = n.sells.some((s) => { const d = world.itemDefs.get(s.item_id); return d && [d.name, ...d.aliases].some((a) => t.includes(padded(a))); });
    if (sells) return { npc_id: n.id, level: 'extra', intent: 'trade', state: { flags: [] } };
  }
  return null;
}
