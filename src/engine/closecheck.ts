/**
 * Comprobaciones del cierre (log_event) que el motor hace con reglas fijas,
 * sin IA, para que la narración no contradiga al estado ni al dado:
 *
 *   - Trato sin estado: la narración (o lo que dice un NPC) da por cerrado un
 *     trato, una deuda, una prenda o un fiado y en el turno no hay ningún tool
 *     que lo registre (set_debt, pawn_item, transfer_item, buy/sell…). Rechazar
 *     con ingenio está bien: las frases con negación no cuentan.
 *   - Desenlace contra la tirada: el motor sabe el margen de la tirada y la
 *     clasifica (rollCategory). Un éxito claro o un crítico no se narra a
 *     medias («aunque no lo que buscabas») y un fallo simple complica pero no
 *     destruye ni hace perder lo esencial («desaparece», «se rompe»).
 *
 * Conservadoras a propósito: frase a frase, saltan las que niegan, preguntan
 * u ofrecen, y las palabras del propio jugador. Comprobadas contra las 10
 * partidas del piloto (scripts/judge.ts las aplica a partidas grabadas).
 */

import type { DialogueLine } from './moments.js';
import type { GameEvent } from './model.js';
import { nameRe, npcNameForms } from './narrate.js';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Frases de un texto ya normalizado (corta también en «;» y «:»). */
function clauses(text: string): string[] {
  return text.split(/[.;:!?¿¡…\n]+/).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Trato sin estado
// ---------------------------------------------------------------------------

/**
 * Expresiones de trato cerrado, normalizadas (sin tildes). Verbos y giros, no
 * sustantivos sueltos: «la deuda» o «hablamos de prendas» nombran, no cierran.
 */
const DEAL = /\b((?:en|como|de) (?:prenda|fianza)|acept\w* (?:la|tu|su|el|esa|ese) (?:prenda|fianza|trato|oferta|fiado|deuda)|(?:dej\w*|doy|da|das|sirv\w*|va|queda\w*|vend\w*|llev\w*|pon\w*)\s+(?:\w+\s+){0,3}?fiad[oa]s?|te (?:lo |la |los |las )?fio|fiarte|te (?:lo |la )?apunto|lo apunto|queda apuntad[oa]|queda anotad[oa]|apuntalo|apuntamelo|anotalo|trato hecho|hecho el trato|cerramos el trato|cerrado el trato|a cambio de|te debo|me debes|me deberas|quedas a deber|empen(?:a|as|o|e|aste|ado|ada)\b(?! en\b))/;
/** Lo que niega, rechaza, pregunta u ofrece: no cierra nada. */
const NOT_CLOSED = /\b(no|ni|nunca|jamas|sin|niega\w*|rechaza\w*|tampoco|nadie|nada|ofreces|ofrece|propones|propone|pides|pide|preguntas|pregunta|quieres|quiere|si|tal vez|quiza\w*|podria\w*|espera\w*|piensa\w*|pesando|ya tengo|ya guarda|sigue\w*|hablamos|al contado|algo|quien|cualquiera|cada uno)\b/;
/** Tools que dejan estado de un trato. */
export const DEAL_TOOLS = new Set(['set_debt', 'pawn_item', 'settle_debt', 'give_coins', 'transfer_item', 'buy_item', 'sell_item', 'complete_job']);

/**
 * Frases que dan un trato por cerrado sin tool que lo respalde. Mira lo que
 * narra el máster y lo que dicen los NPC (no lo que dice el actor: proponer
 * no es cerrar). Vacío si hay un tool de trato hecho en el turno, si la acción
 * queda pendiente de una tirada o si todo es negación u oferta. Con deudas ya
 * abiertas, nombrarlas no es un trato nuevo.
 */
export function dealWithoutState(input: { narration: string; lines?: readonly DialogueLine[]; okTools: readonly string[]; pendingRoll?: boolean; hasOpenDebt?: boolean }): string[] {
  if (input.pendingRoll || input.okTools.some((t) => DEAL_TOOLS.has(t))) return [];
  const bare = (t: string) => norm(t).replace(/[^a-z0-9n ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const actorSaid = (input.lines ?? []).filter((l) => l.speaker === 'actor').map((l) => bare(l.text)).filter(Boolean);
  const isActor = (q: string) => { const b = bare(q); return Boolean(b) && actorSaid.some((a) => a.includes(b) || b.includes(a)); };
  // Lo citado entre «» que es del actor fuera; lo de los NPC, dentro.
  // Las preguntas no cierran nada: fuera antes de partir en frases.
  const noQ = (s: string) => s.replace(/¿[^?]*\?/g, ' . ');
  const narr = noQ(norm(input.narration).replace(/«([^»]*)»/g, (_m, q: string) => (isActor(q) ? ' ' : `. ${q} .`)));
  const npcSaid = (input.lines ?? []).filter((l) => l.speaker === 'npc').map((l) => noQ(norm(l.text)));
  const out = new Set<string>();
  for (const c of [...clauses(narr), ...npcSaid.flatMap(clauses)]) {
    const m = DEAL.exec(c);
    if (!m || NOT_CLOSED.test(c)) continue;
    // Con una deuda ya abierta, recordarla («como prenda de lo que le debes») no es un trato nuevo.
    if (input.hasOpenDebt && /^((en|como|de) (prenda|fianza)|queda apuntad[oa]|queda anotad[oa]|te debo|me debes|me deberas|quedas a deber)$/.test(m[1]!)) continue;
    out.add(m[1]!);
  }
  return [...out];
}

export const DEAL_REJECTION = 'Has narrado un trato sin registrarlo: usa set_debt / pawn_item / transfer_item (o el tool que toque) o narra que no se cierra.';

// ---------------------------------------------------------------------------
// Monedas que cambian de manos solo de palabra
// ---------------------------------------------------------------------------

/** Tools que mueven las monedas del actor. */
export const COIN_TOOLS = new Set(['give_coins', 'settle_debt', 'buy_item', 'sell_item', 'set_debt', 'pawn_item', 'complete_job']);
const COIN = String.raw`(?:monedas?|cobres?|platas?|oros?)`;
/** El actor las suelta («dejas las monedas sobre la mesa», «le das diez de plata», «pagas la cuenta»). */
const HANDS_COINS = new RegExp(String.raw`(?<!\bte )\b(dejas|pones|sueltas|entregas|das|pagas|tiendes|deslizas|empujas|pasas)\b[^,]{0,40}\b${COIN}\b|\b(pagas|saldas)\b`);
/** Quien las recibe se las queda («Brenna recoge la moneda»), si el jugador iba a pagar. */
const TAKES_COINS = new RegExp(String.raw`\b(recoge|coge|se guarda|guarda|se embolsa|hace desaparecer|acepta)\b[^,]{0,30}\b${COIN}\b`);
const WANTS_TO_PAY = new RegExp(String.raw`\b(pago|pagar|pagarte|pagarle|saldo|soborno|sobornar|propina)\b|\b(dejo|pongo|doy|entrego|ofrezco|suelto)\b[^.;:]{0,40}\b${COIN}\b`);
/** Lo que no llega a pagar: niega, se queda en intento u ocurre en otro momento. */
const COINS_NOT_PAID = /\b(no|ni|nunca|sin|si|quieres|intentas|ofreces|propones|vas a|antes de|tampoco|nadie|nada)\b/;

/**
 * La narración da por pagado algo y en el turno no se ha movido ninguna moneda: el jugador pone 200 sobre la mesa,
 * el regidor las cuenta y el jugador sigue con sus 200. Las palabras entre «» no cuentan: decirlo no es pagarlo.
 */
export function coinsWithoutTool(input: { action: string; narration: string; okTools: readonly string[]; pendingRoll?: boolean }): string | null {
  if (input.pendingRoll || input.okTools.some((t) => COIN_TOOLS.has(t))) return null;
  const acts = norm(input.narration).replace(/«[^»]*»/g, ' . ');
  const wants = WANTS_TO_PAY.test(norm(input.action).replace(/«[^»]*»/g, ' '));
  for (const c of clauses(acts)) {
    if (COINS_NOT_PAID.test(c)) continue;
    const m = HANDS_COINS.exec(c) ?? (wants ? TAKES_COINS.exec(c) : null);
    if (m) return m[0];
  }
  return null;
}

export function coinsRejection(phrase: string): string {
  return `La narración da monedas por pagadas («${phrase}») y en este turno no se ha movido ninguna: lo que no pasa por un tool no ha ocurrido. Usa give_coins (propina, soborno, un pago sin precio), settle_debt (una deuda) o buy_item (algo de su lista), o narra que no llega a pagar. Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Golpe declarado sin tirada de ataque
// ---------------------------------------------------------------------------

const WEAPON = '(?:hacha|hachuela|daga|espada|cuchillo|navaja|estoque|filo|punal|lanza|hoja|acero|baston|maza|mazo|martillo|piedra|jarra|flecha|virote|hombro|puno|bota|rodilla|codo|cabeza|dientes)';
const BLOW = String.raw`\w*(?:punetazo|golpe|cabezazo|rodillazo|patada|tajo|hachazo|espadazo|bastonazo|codazo|mazazo|navajazo|bofetada|tortazo|guantazo|mamporro|sopapo|zarpazo)`;
const BODY = '(?:cara|nariz|boca|brazo|brazos|costilla|costillas|craneo|cabeza|muneca|munecas|pierna|piernas|dientes|mandibula|cuello)';
/** Lo que hace el propio PJ, en primera persona o infinitivo de botón. Con persona detrás: «golpeo la mesa» o «me pego a la pared» no son un ataque. */
const STRIKE = new RegExp([
  String.raw`\b(?:ataco|atacar|atacarle|atacarla|atacarlo)\b`,
  String.raw`\b(?:le|la|lo|les|los|las|te)\s+(?:golpeo|apunalo|acuchillo|rajo|pateo|disparo|muerdo)\b`,
  String.raw`\b(?:golpeo|golpear|apunalo|apunalar|disparo|disparar|pateo|embisto|embestir|acuchillo)\s+(?:a|al)\b`,
  String.raw`\b(?:embisto|arremeto)\s+contra\b`,
  String.raw`\bme\s+(?:abalanzo|lanzo|echo)\s+(?:sobre|contra|encima de)\b`,
  String.raw`\b(?:le|te)\s+(?:clavo|hundo|estrello|descargo|lanzo|hinco)\s+(?:(?:el|la|mi|un|una|los|las)\s+)?${WEAPON}\b`,
  String.raw`\b(?:le|les)\s+(?:parto|rompo|reviento)\s+(?:(?:el|la|los|las)\s+)?${BODY}\b`,
  String.raw`\b(?:le|les)\s+corto\s+(?:el cuello|la garganta)\b`,
  String.raw`\b(?:le|te|les)\s+(?:doy|suelto|lanzo|pego|planto|meto|atizo|arreo|casco)\s+(?:un|una|dos)\s+${BLOW}\b`,
  String.raw`\blanzo\s+(?:el|un|mi)\s+golpe\b`,
  String.raw`\blanzo\s+(?:(?:el|la|mi|un|una)\s+)?${WEAPON}\s+(?:de mano\s+)?contra\b`,
  String.raw`\ble\s+aplasto\s+(?:la|el)\s+${BODY}\b`,
  String.raw`\bdescargo\s+(?:(?:el|la|mi|un)\s+)?(?:golpe|${WEAPON})\b`,
].join('|'));
/** Una amenaza, una condición o un plan no es el golpe, si va delante: «si no hablas, le parto el brazo», «o le parto el brazo», «voy a…». */
const NOT_A_STRIKE = /\b(si|como|cuando|proxima|voy a|vas a|quiero|quieres|puedo|podria|deberia|tendria|amenaz\w*|finjo|fingir|amago|amagar|ademan|no|ni|sin|juro|manana|pienso|pretendo|de lo contrario|porque|para que|casi|o (?:te|le|lo|la|les)|que (?:te|le|lo|la|les))\b/;
/** Lo mismo detrás, hasta la coma: «te rompo la cara si no hablas», «le parto el brazo como vuelvas». */
const THEN_THREAT = /\b(si|como|cuando|hasta que|de lo contrario)\b/;
/** Un mueble no es un objetivo: «le clavo el hacha en el tablón», «le doy un golpe a la puerta». */
const AT_A_THING = /\b(?:en|a|contra|sobre)\s+(?:el|la|los|las)\s+(?:tablon|marco|mesa|banco|puerta|pared|suelo|madera|yunque|aldaba|barra|reja|vela|carta|cofre|bolsa|llave)\b/;

/** El golpe que declara el jugador, o null. Lo que dice (entre comillas, entre ¡!, tras «:») no es lo que hace. */
export function declaredStrike(action: string): string | null {
  const acts = norm(action).replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' . ').replace(/¡[^!]*!?|¿[^?]*\??/g, ' . ').replace(/:[^.\n]*/g, ' . ');
  for (const c of clauses(acts)) {
    const m = STRIKE.exec(c);
    if (!m) continue;
    const rest = c.slice(m.index + m[0].length).split(',')[0]!;
    if (!NOT_A_STRIKE.test(c.slice(0, m.index + m[0].length)) && !THEN_THREAT.test(rest) && !AT_A_THING.test(m[0] + rest)) return m[0];
  }
  return null;
}

/** Por qué no hay tirada, dicho en la narración: no está a su alcance, va sin arma o algo se lo impide. */
const STRIKE_REASON = /\b(no (?:llevas|tienes|alcanzas|llegas|hay nadie|esta aqui|esta alli|ves a|puedes)|fuera de (?:tu )?alcance|sin arma|manos vacias|la reja|los barrotes|al otro lado|ya no esta|se ha ido|se ha marchado|te sujeta\w*|te detiene\w*|te frena\w*)\b/;

/**
 * El jugador declara un golpe y el cierre no lo resuelve: sin tirada de ataque y sin que el PJ haya atacado. Un NPC
 * que le pega a él no cuenta. Con una razón en la narración (nadie al alcance, sin arma) vale.
 */
export function strikeWithoutAttack(input: { action: string; narration: string; attackRoll: boolean; pcAttacked: boolean; okTools: readonly string[] }): string | null {
  if (input.attackRoll || input.pcAttacked || input.okTools.some((t) => t === 'cast_spell' || t === 'request_reaction' || t === 'restrain_npc')) return null;
  const strike = declaredStrike(input.action);
  if (!strike) return null;
  return STRIKE_REASON.test(norm(input.narration).replace(/«[^»]*»/g, ' ')) ? null : strike;
}

export function strikeRejection(strike: string): string {
  return `El jugador declara un golpe («${strike}») y este cierre no lo resuelve. El ataque del jugador va con requires_roll_kind=attack, requires_roll_key=melee o ranged y requires_roll_target=ID del objetivo; la narración solo cuenta el momento previo y el servidor tira. Si de verdad no puede (nadie a su alcance, no lleva arma, algo se lo impide), dilo en la narración. Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Desenlace contra la tirada
// ---------------------------------------------------------------------------

export type RollCategory = 'pifia' | 'fallo' | 'exito_justo' | 'exito_claro' | 'critico';

export const ROLL_CATEGORY: Record<RollCategory, { label: string; rule: string }> = {
  pifia: { label: 'fallo grave', rule: 'falla y hay una consecuencia seria (una pérdida, un daño, una alarma).' },
  fallo: { label: 'fallo', rule: 'no lo consigue y la situación se complica, pero no destruye ni hace perder lo esencial.' },
  exito_justo: { label: 'éxito justo', rule: 'lo consigue, quizá con un coste pequeño, pero lo consigue.' },
  exito_claro: { label: 'éxito claro', rule: 'el objetivo se consigue sin peros.' },
  critico: { label: 'crítico', rule: 'lo consigue del todo y además algo a su favor.' },
};

/**
 * Categoría por margen sobre la CD: natural 20 crítico; 5 o más, éxito claro;
 * 0-4, éxito justo; natural 1 o 10 o más por debajo, fallo grave; el resto,
 * fallo. Sin CD ni resultado, null.
 */
export function rollCategory(r: { total: number; dc: number | null; success: boolean | null; natural?: number | null }): RollCategory | null {
  if (r.success === null) return null;
  if (r.success) {
    if (r.natural === 20) return 'critico';
    if (r.dc === null) return 'exito_justo';
    return r.total - r.dc >= 5 ? 'exito_claro' : 'exito_justo';
  }
  if (r.natural === 1 || (r.dc !== null && r.dc - r.total >= 10)) return 'pifia';
  return 'fallo';
}

/** Un éxito claro narrado a medias. */
const PARTIAL = /\b(aunque no|pero no (lo|la|consigues|logras|del todo)|a medias|no lo que (buscabas|querias|pedias|esperabas)|no (consigues|logras)|sin (conseguirlo|lograrlo)|no del todo|solo en parte|lo justo para no)\b/;
/** Un fallo simple que destruye o hace perder lo que se buscaba. */
const LOSS = /\b(desaparece\w*|pierdes|lo pierdes|la pierdes|se rompe|se parte en|se hace anicos|destroz\w*|ya no esta|ya no lo sientes)\b/;

/** Frases que contradicen la categoría de la tirada; vacío si encaja. */
export function outcomeMismatch(category: RollCategory | null, narration: string): string[] {
  if (category !== 'exito_claro' && category !== 'critico' && category !== 'fallo') return [];
  const re = category === 'fallo' ? LOSS : PARTIAL;
  const out: string[] = [];
  for (const c of clauses(norm(narration).replace(/«[^»]*»/g, ' '))) {
    const m = re.exec(c);
    if (!m) continue;
    if (category === 'fallo' && /\b(no|ni|casi|sin que)\b/.test(c.slice(0, m.index))) continue;
    out.push(m[1]!);
  }
  return out;
}

export function outcomeRejection(category: RollCategory, words: readonly string[]): string {
  const c = ROLL_CATEGORY[category];
  return `La tirada fue un ${c.label}: ${c.rule} La narración dice ${words.map((w) => `«${w}»`).join(', ')}, que no encaja. Reescribe log_event respetando el resultado.`;
}

// ---------------------------------------------------------------------------
// El máster no actúa por otro jugador
// ---------------------------------------------------------------------------

/** Lo que el máster puede contar de alguien: mirar, esperar, hablar, gestos, moverse e intenciones. */
export type PcActClass = 'look' | 'wait' | 'speech' | 'gesture' | 'move' | 'intent';

/**
 * Verbos en tercera persona (normalizados, sin tildes) que ponen a alguien a
 * hacer algo, por clase. Se buscan justo detrás de quien hace (o al principio
 * de una frase sin sujeto, que lo hereda) y, una vez es sujeto, en el resto de
 * su frase («aguarda, con la mirada fija en ti»).
 */
const ACT_VERBS: Record<PcActClass, RegExp> = {
  look: /\b(mira|miran|observa|contempla|escruta|vigila|clava (?:la vista|los ojos|la mirada)|(?:te |le )?devuelve la mirada|sin apartar (?:la vista|los ojos|la mirada)|no aparta (?:la vista|los ojos|la mirada)|(?:la |con la )?(?:vista|mirada) fija|los ojos fijos|ojos clavados)\b/,
  wait: /\b(aguarda|espera|esperando|se queda (?:quiet[oa]|inmovil|frente|en silencio|callad[oa]|mirando|ahi|junto)|no se mueve|sigue (?:quiet[oa]|ahi|esperando|en silencio|callad[oa])|permanece)\b/,
  speech: /\b(dice|responde|contesta|pregunta|murmura|susurra|habla|grita|replica|anade|no dice nada|calla|guarda silencio|se presenta|carraspea)\b/,
  gesture: /\b(asiente|niega con la cabeza|se encoge de hombros|sonrie|frunce|suspira|resopla|se rie|levanta (?:la|una) (?:mano|ceja)|cruza los brazos|(?:te|le) tiende|se lleva la mano|apoya la mano|desenvaina|empuna|te agarra|te coge|coge|saca|golpea|ataca|se levanta|se sienta|se inclina|hace un gesto|se tensa|se cruza de brazos|aprieta)\b/,
  move: /\b(se acerca|se aparta|retrocede|da un paso|se va|se marcha|sale|entra|se dirige|cruza|llega|camina|se pone (?:detras|delante|a tu lado))\b/,
  intent: /\b(quiere|pretende|se dispone|parece (?:dispuest[oa]|decidid[oa]|querer|esperar)|decide|duda|piensa|tienes su atencion|cuenta contigo)\b/,
};
const CLASSES = Object.keys(ACT_VERBS) as PcActClass[];

/**
 * Lo mismo, más ancho, para lo que sí consta que hizo ese jugador (sus eventos:
 * lo observable donde él es quien hace, lo que escribió y lo que dijo). Admite
 * infinitivos y primera persona.
 */
const DONE: Record<PcActClass, RegExp> = {
  look: /\b(mir\w*|observ\w*|contempl\w*|escrut\w*|vigil\w*|examin\w*|estudi\w*)\b/,
  wait: /\b(aguard\w*|esper\w*|se queda\w*|me quedo|quedarse|quedarme|permanec\w*|quiet[oa])\b/,
  speech: /\b(dic\w*|dij\w*|decir\w*|digo|habl\w*|pregunt\w*|respond\w*|contest\w*|murmur\w*|susurr\w*|grit\w*|replic\w*|salud\w*|present\w*)\b/,
  gesture: /\b(asient\w*|asentir|neg\w*|sonr\w*|frunc\w*|suspir\w*|gesto|levant\w*|tiend\w*|tender|desenvain\w*|empun\w*|cog\w*|sac\w*|golpe\w*|ataca\w*|dar\w*|da|doy|ofrec\w*|entreg\w*|ayud\w*)\b/,
  move: /\b(acerc\w*|apart\w*|retroced\w*|ir|voy|va|vas|march\w*|sal\w*|entr\w*|dirig\w*|cruz\w*|lleg\w*|camin\w*|segu\w*|sigue)\b/,
  intent: /\b(dispon\w*|quier\w*|pretend\w*|decid\w*)\b/,
};

/** Clases de lo que consta que hizo alguien, a partir del texto de sus eventos. */
export function doneClasses(text: string): Set<PcActClass> {
  const t = norm(text);
  return new Set(CLASSES.filter((k) => DONE[k].test(t)));
}

/** Otro PJ presente, tal como lo puede nombrar la narración, y lo que consta que ha hecho. */
export interface OtherPc {
  id: string;
  /** Cómo lo nombra el aviso al máster (nombre o descriptor). */
  label: string;
  /** Formas de nombrarlo, normalizadas: nombre, descriptor, raza, clase. */
  refs: string[];
  /** Lo que consta en sus eventos recientes. */
  done: Set<PcActClass>;
  /** Su último evento era de atención a la escena (mirar, esperar, hablar, un gesto): «aguarda» no inventa nada. */
  attentive: boolean;
}

export interface ActedFor { id: string; label: string; cls: PcActClass; phrase: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Entre quien hace y su verbo: «de la espada», «, a tu lado,», un adverbio y un pronombre. */
const AFTER = new RegExp(String.raw`^(?:\s+(?:de|del|con)\s+(?:la |el |los |las |un |una |su )?[a-zn]+){0,2}(?:\s*,[^,]{1,30},)?\s*(?:(?:no|ya|todavia|tambien|solo|aun|apenas)\s+)*(?:(?:te|le|les|lo|la|se|me|nos|os)\s+)?`);
/** Una frase que empieza sin sujeto (lo hereda) o con «él/ella». */
const LEAD = /^(?:(?:y|pero|luego|entonces|despues)\s+)?(?:(?:el|ella)\s+(?=(?:no|ya|te|le|se|lo|la|todavia)\b))?(?:(?:no|ya|todavia|aun|solo)\s+)*(?:(?:te|le|les|lo|la|se|me)\s+)?/;
/** Hasta dónde llega la frase de alguien: un relativo o una subordinada con otro sujeto. */
const CUT = /,\s*(?:donde|mientras|que|cuando|aunque)\b|\s+mientras\b/;

function verbAt(s: string): { cls: PcActClass; phrase: string } | null {
  for (const k of CLASSES) {
    const m = new RegExp(`^${ACT_VERBS[k].source}`).exec(s);
    if (m) return { cls: k, phrase: m[0] };
  }
  return null;
}

function verbsIn(s: string): { cls: PcActClass; phrase: string }[] {
  const out: { cls: PcActClass; phrase: string }[] = [];
  for (const k of CLASSES) { const m = ACT_VERBS[k].exec(s); if (m) out.push({ cls: k, phrase: m[0] }); }
  return out;
}

/** Lo que hace quien es sujeto: el verbo de delante y los de su frase hasta otro sujeto. */
function subjectSpan(rest: string, limit = Infinity): { cls: PcActClass; phrase: string }[] {
  const first = verbAt(rest);
  if (!first) return [];
  const cut = rest.search(CUT);
  return [first, ...verbsIn(rest.slice(0, Math.min(cut > 0 ? cut : Infinity, limit)))];
}

/**
 * Frases que ponen a otro jugador a mirar, esperar, hablar, hacer un gesto,
 * moverse o querer algo que no consta en sus eventos. En cada frase busca
 * quién hace: el que va delante del verbo (por nombre, descriptor, raza o
 * clase) o, si la frase empieza por el verbo o por «él», el último nombrado.
 * Un NPC o el actor nombrados cortan la herencia; tras una preposición
 * («a Aren», «frente al elfo») es objeto, no sujeto. Las citas no cuentan
 * (son palabras de alguien). Comprobado con la partida de dos jugadores
 * la-noche-del-breazl (test/closecheck.test.ts).
 */
export function actedForOthers(input: { texts: readonly string[]; others: readonly OtherPc[]; actorRefs?: readonly string[]; npcRefs?: readonly string[] }): ActedFor[] {
  if (!input.others.length) return [];
  const out = new Map<string, ActedFor>();
  const mentionRe = (refs: readonly string[]) => {
    const list = refs.map((r) => norm(r).trim()).filter(Boolean).map(esc).sort((a, b) => b.length - a.length);
    return list.length ? new RegExp(`\\b(?:(?:el|la|al|del|un|una|a la|a)\\s+)?(?:${list.join('|')})\\b`, 'g') : null;
  };
  const people = input.others.map((o) => ({ o, re: mentionRe(o.refs) }));
  const npcRe = mentionRe(input.npcRefs ?? []);
  const actorRe = mentionRe(input.actorRefs ?? []);
  const flag = (o: OtherPc, hit: { cls: PcActClass; phrase: string }) => {
    if (o.done.has(hit.cls) || (hit.cls === 'wait' && o.attentive)) return;
    const key = `${o.id}:${hit.cls}`;
    if (!out.has(key)) out.set(key, { id: o.id, label: o.label, cls: hit.cls, phrase: hit.phrase });
  };
  for (const text of input.texts) {
    let antecedent: OtherPc | null = null;
    const bare = norm(text).replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, ' . ');
    for (const clause of clauses(bare)) {
      type Hit = { at: number; end: number; who: OtherPc | 'other' };
      const hits: Hit[] = [];
      const collect = (re: RegExp | null, who: OtherPc | 'other') => { if (re) for (const m of clause.matchAll(re)) hits.push({ at: m.index!, end: m.index! + m[0].length, who }); };
      for (const { o, re } of people) collect(re, o);
      collect(npcRe, 'other');
      collect(actorRe, 'other');
      hits.sort((a, b) => a.at - b.at || b.end - a.end);
      // Frase sin sujeto delante: hereda el último nombrado.
      if (antecedent && (!hits.length || hits[0]!.at > 0)) {
        const rest = clause.slice(LEAD.exec(clause)![0].length);
        if (!/^(?:el|la|los|las|un|una)\s/.test(rest)) for (const v of subjectSpan(rest, hits.length ? hits[0]!.at : Infinity)) flag(antecedent, v);
      }
      let lastEnd = -1;
      for (const h of hits) {
        if (h.at < lastEnd) continue;
        lastEnd = h.end;
        if (h.who === 'other') { antecedent = null; continue; }
        antecedent = h.who;
        if (/\b(?:a|de|con|hacia|frente|junto|ante|sobre|tras|entre|para|por)\s*$/.test(clause.slice(Math.max(0, h.at - 12), h.at))) continue;
        const after = clause.slice(h.end);
        const gap = AFTER.exec(after)![0].length;
        const next = hits.find((x) => x.at >= h.end);
        for (const v of subjectSpan(after.slice(gap), next ? next.at - h.end - gap : Infinity)) flag(h.who, v);
      }
    }
  }
  return [...out.values()];
}

const CLASS_ES: Record<PcActClass, string> = { look: 'mirar', wait: 'esperar', speech: 'hablar o callar', gesture: 'un gesto', move: 'moverse', intent: 'una intención' };

export function actedForRejection(hits: readonly ActedFor[]): string {
  const list = hits.map((h) => `${h.label} (${CLASS_ES[h.cls]}: «${h.phrase}»)`).join('; ');
  return `Has narrado lo que hace otro jugador: ${list}. Los demás jugadores deciden por sí mismos: no narres sus actos, palabras, miradas, esperas ni intenciones si no constan en los eventos recientes; puedes decir dónde está y lo que ya consta. Reescribe log_event sin eso.`;
}

/** Lo mínimo de un evento para saber qué hizo alguien. */
export interface DoneEvent { seq: number; actor_id: string | null; action_type: string; input_text: string | null; observable: string | null; payload: Record<string, unknown> }

/**
 * Lo que consta que ha hecho `who` desde la acción anterior del actor (o, si
 * no hay nada desde entonces, en su último evento): las frases de lo
 * observable donde él va delante, lo que escribió su jugador y si habló.
 */
export function recentDone(events: readonly DoneEvent[], actorId: string, who: { id: string; name: string }): { done: Set<PcActClass>; attentive: boolean } {
  const mine = events.filter((e) => e.actor_id === who.id);
  const prev = [...events].reverse().find((e) => e.actor_id === actorId)?.seq ?? -1;
  const since = mine.filter((e) => e.seq > prev);
  const window = since.length ? since : mine.slice(-1);
  const classesOf = (e: DoneEvent) => {
    const parts: string[] = [e.input_text && !e.input_text.startsWith('(') ? e.input_text : ''];
    const name = norm(who.name);
    for (const c of clauses(norm(e.observable ?? '').replace(/«[^»]*»/g, ' . '))) {
      if (!c.startsWith(name)) continue;
      const cut = c.search(CUT);
      parts.push(cut > 0 ? c.slice(0, cut) : c);
    }
    const out = doneClasses(parts.join(' . '));
    if (e.action_type === 'say' || (Array.isArray(e.payload['lines']) && (e.payload['lines'] as { speaker?: string }[]).some((l) => l.speaker === 'actor'))) out.add('speech');
    if (/^(move|arrived|passed|follow|character_joined)$/.test(e.action_type)) out.add('move');
    return out;
  };
  const done = new Set<PcActClass>();
  for (const e of window) for (const k of classesOf(e)) done.add(k);
  const last = window.at(-1);
  const attentive = last ? [...classesOf(last)].some((k) => k === 'look' || k === 'wait' || k === 'speech' || k === 'gesture') : false;
  return { done, attentive };
}

/** Formas de nombrar a un PJ por su raza (id SRD) en una narración. */
export const RACE_WORDS: Record<string, string[]> = {
  human: ['hombre', 'mujer', 'humano', 'humana'], elf: ['elfo', 'elfa'], dwarf: ['enano', 'enana'], halfling: ['mediano', 'mediana'],
  gnome: ['gnomo', 'gnoma'], 'half-elf': ['semielfo', 'semielfa'], 'half-orc': ['semiorco', 'semiorca'], tiefling: ['tiefling'], dragonborn: ['draconido', 'draconida'],
};

// ---------------------------------------------------------------------------
// Muerte y vuelta sin estado (death.ts)
// ---------------------------------------------------------------------------

/** Lo que niega, duda o compara: «casi muere», «parece muerto», «si no le atienden, morirá». */
const DEATH_HEDGE = /\b(no|ni|casi|a punto de|podria\w*|puede\w*|si|como si|parece\w*|teme\w*|cree\w*|creia\w*|crees|quiza\w*|tal vez|salvo|sin)\b/;
const DIES = '(?:muere|ha muerto|esta muert[oa]|cae muert[oa]|yace muert[oa]|queda muert[oa]|fallece|ha fallecido|deja de respirar|exhala su ultimo aliento|pierde la vida|se queda sin vida|yace sin vida)';
const RISES = '(?:resucita|ha resucitado|revive|vuelve a la vida|regresa de (?:entre )?los muertos|vuelve de (?:la muerte|entre los muertos)|se levanta de entre los muertos)';
const YOU_DIE = /\b(mueres|has muerto|estas muert[oa]|caes muert[oa]|dejas de respirar|exhalas tu ultimo aliento|pierdes la vida|te matan|te mata|te han matado|tu cadaver)\b/;
const YOU_RISE = /\b(resucitas|has resucitado|revives|vuelves a la vida|regresas de (?:entre )?los muertos|vuelves de (?:la muerte|entre los muertos))\b/;

export interface DeathHit { name: string; kind: 'death' | 'rise'; phrase: string }

/**
 * Frases que matan o devuelven a la vida a un PJ sin que el estado lo diga.
 * Morir solo vale si el PJ ya está muerto (lo mató un tool en este turno o
 * antes); volver de la muerte nunca: eso lo cuenta el servidor. El actor va en
 * segunda persona («mueres»); los demás, por su nombre. Las frases que niegan
 * o dudan no cuentan.
 */
export function deathNarration(input: { texts: readonly string[]; actor: { name: string; dead: boolean }; others: readonly { name: string; dead: boolean }[] }): DeathHit[] {
  const out: DeathHit[] = [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const people = [{ ...input.actor, you: true }, ...input.others.map((o) => ({ ...o, you: false }))];
  for (const raw of input.texts) {
    for (const c of clauses(norm(raw).replace(/«[^»]*»/g, ' . '))) {
      if (DEATH_HEDGE.test(c)) continue;
      for (const p of people) {
        const n = esc(norm(p.name));
        const dies = new RegExp(`\\b${n}(?:\\s+[a-z]+){0,3}\\s+${DIES}\\b|\\b(?:mat\\w*|asesin\\w*) a ${n}\\b|\\b(?:cadaver|cuerpo sin vida) de ${n}\\b`).exec(c) ?? (p.you ? YOU_DIE.exec(c) : null);
        if (dies && !p.dead) out.push({ name: p.name, kind: 'death', phrase: dies[0] });
        const rises = new RegExp(`\\b${n}(?:\\s+[a-z]+){0,3}\\s+${RISES}\\b|\\bresucit\\w* a ${n}\\b`).exec(c) ?? (p.you ? YOU_RISE.exec(c) : null);
        if (rises) out.push({ name: p.name, kind: 'rise', phrase: rises[0] });
      }
    }
  }
  return out;
}

export function deathRejection(hits: readonly DeathHit[]): string {
  const list = hits.map((h) => `${h.name} (${h.kind === 'death' ? 'muerte' : 'vuelta de la muerte'}: «${h.phrase}»)`).join('; ');
  return `Has narrado ${list} sin que el estado lo diga. La muerte de un PJ la deciden el servidor y las reglas (attack o apply_damage devuelven died; a 0 PG cae inconsciente y tira salvaciones), y su vuelta la cuenta el servidor cuando acaba su espera. Reescribe log_event sin eso: a 0 PG está inconsciente, malherido, no muerto.`;
}

/** Quita de un texto las frases con muerte o vuelta sin estado (última salida, si el máster insiste). */
export function withoutDeathPhrases(text: string, hits: readonly DeathHit[]): string {
  if (!hits.length) return text;
  const bad = hits.map((h) => h.phrase);
  return text.split(/(?<=[.!?…])\s+/).filter((s) => !bad.some((b) => norm(s).includes(b))).join(' ').trim();
}

// ---------------------------------------------------------------------------
// Cierre de relleno y turno compartido sin respuesta para alguno
// ---------------------------------------------------------------------------

/**
 * Texto de relleno que no es narración («placeholder», «x», «...», una letra
 * suelta, «[texto]»): el jugador se quedaría sin respuesta. «placeholder» y
 * «lorem ipsum» no son castellano: cuentan aunque vayan dentro de una frase.
 */
const PLACEHOLDER = /^(?:x+|todo|tbd|n\/?a|none|null|undefined|vacio|sin narracion|texto|narracion|observable|test|\.+|…|-+|_+|\?+|\[[^\]]*\]|<[^>]*>|[a-z])$|placeholder|lorem ipsum/;

/** ¿Es relleno este texto? Vacío no cuenta (en conversación vale la narración vacía con lines). */
export function isPlaceholder(text: string | null | undefined): boolean {
  return text != null && text.trim() !== '' && PLACEHOLDER.test(norm(text.trim()));
}

/** Campos del cierre que son relleno. */
export function placeholderFields(fields: Record<string, string | null>): string[] {
  return Object.entries(fields).filter(([, v]) => isPlaceholder(v)).map(([k]) => k);
}

export function placeholderRejection(fields: readonly string[]): string {
  return `${fields.join(', ')} es relleno («placeholder», «x»…), no narración: el jugador se quedaría sin respuesta. Reescribe log_event con la respuesta de verdad a su acción (si en conversación sobra la narración, déjala vacía y pon lo dicho en lines).`;
}

/** Cierre sin nada que leer: ni narración ni nada dicho en lines. */
export function emptyClose(input: { narration: string; lines?: readonly DialogueLine[] }): boolean {
  return input.narration.trim() === '' && !(input.lines ?? []).some((l) => l.text.trim() !== '');
}

export const EMPTY_REJECTION = 'narration_private está vacía y no hay nada en lines: el jugador se quedaría sin respuesta. Reescribe log_event con lo que pasa (o, en conversación, con lo dicho en lines).';

// ---------------------------------------------------------------------------
// Autocorrección del modelo dentro del texto
// ---------------------------------------------------------------------------

/**
 * Arranque en falso que el modelo corrige sobre la marcha y deja escrito:
 * «MIAU Lenzo... no. MIAU se queda junto a la barra». Puntos suspensivos, «no»
 * y una frase que empieza de nuevo (mayúscula).
 */
const SELF_FIX = /(?:\.\.\.|…)\s*no\s*[.,;!]\s+(?=\p{Lu})/u;

/**
 * Quita del texto los arranques en falso: desde el principio de la frase hasta
 * la corrección, y deja lo que viene después. Lo que va entre «» (lo que dice
 * alguien, que sí puede titubear: «Yo... no. No puedo.») no se toca.
 */
export function withoutSelfCorrection(text: string): string {
  return text.split(/(«[^»]*»)/).map((part) => (part.startsWith('«') ? part : fixFalseStarts(part))).join('').replace(/[ \t]{2,}/g, ' ').trim();
}

function fixFalseStarts(part: string): string {
  let t = part;
  for (let i = 0; i < 5; i++) {
    const m = SELF_FIX.exec(t);
    if (!m) break;
    const before = t.slice(0, m.index);
    let start = 0;
    for (const b of before.matchAll(/[.!?](?=\s)/g)) start = b.index + 1;
    t = `${t.slice(0, start)}${start ? ' ' : ''}${t.slice(m.index + m[0].length)}`;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Frases puestas en boca de un jugador
// ---------------------------------------------------------------------------

const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'que', 'en', 'con', 'por', 'para', 'se', 'le', 'les', 'lo', 'me', 'te', 'mi', 'tu', 'su', 'es', 'si', 'ya', 'mas', 'pero', 'muy', 'yo', 'ni']);
const words = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean);

/**
 * ¿Sale esta frase de lo que escribió el jugador? Vale si al menos la mitad de
 * sus palabras con contenido están en su entrada (o empiezan igual: «estás» y
 * «esta»). «yo tambien quiero» de «yo tambien quiero», sí; «¡Quieto!» de «le
 * ataco con la espada», no. Sin entrada (dudó o no actuó), nada es suyo.
 */
export function saidByPlayer(line: string, input: string | null | undefined): boolean {
  if (!input) return false;
  const all = words(line);
  const content = all.filter((w) => w.length > 1 && !STOP.has(w));
  const check = content.length ? content : all;
  if (!check.length) return false;
  const typed = words(input);
  const found = check.filter((w) => typed.some((u) => u === w || (w.length >= 4 && u.length >= 4 && u.slice(0, 4) === w.slice(0, 4))));
  return found.length * 2 >= check.length;
}

/**
 * Turno compartido (ronda o conversación de grupo, scene.ts): la narración la
 * leen todos los que actuaron, así que cada uno tiene que salir en ella por su
 * nombre o con una línea del NPC dirigida a él (`to`). Devuelve los que faltan.
 */
export function unansweredInShared(input: { narration: string; lines?: readonly DialogueLine[]; acted: readonly { id: string; name: string }[] }): { id: string; name: string }[] {
  if (input.acted.length < 2) return [];
  const text = ` ${norm(input.narration).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return input.acted.filter((m) => {
    const n = norm(m.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (n && text.includes(` ${n} `)) return false;
    return !(input.lines ?? []).some((l) => l.speaker === 'npc' && l.to === m.id);
  });
}

export function unansweredRejection(missing: readonly { name: string; text: string }[]): string {
  return `Turno compartido: narration_private la leen todos y no responde a ${missing.map((m) => `${m.name} («${m.text}»)`).join(' ni a ')}. Resuelve lo de CADA uno nombrándolo («${missing[0]!.name}, …») o en plural; nunca «tú» a secas, que cada jugador lo leería como suyo. Si preguntó algo, contéstale a él.`;
}

// ---------------------------------------------------------------------------
// NPC que se repite
// ---------------------------------------------------------------------------

/** Lo que ha dicho un NPC en estos eventos (sus líneas en `lines`), en orden. */
export function recentNpcLines(events: readonly GameEvent[], npcId: string): string[] {
  const out: string[] = [];
  for (const e of events) {
    const ls = e.payload['lines'];
    if (!Array.isArray(ls)) continue;
    for (const l of ls as DialogueLine[]) if (l.speaker === 'npc' && l.npc_id === npcId && typeof l.text === 'string' && l.text.trim()) out.push(l.text.trim());
  }
  return out;
}

const wordsOf = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/** Igual o casi igual: las mismas palabras, o con 4 o más casi todas (80 %). */
function sameSaying(a: string[], b: string[]): boolean {
  if (a.join(' ') === b.join(' ')) return true;
  if (a.length < 4 || b.length < 4) return false;
  const A = new Set(a); const B = new Set(b);
  const common = [...A].filter((w) => B.has(w)).length;
  return common / new Set([...A, ...B]).size >= 0.8;
}

/**
 * Frases de un NPC en este cierre que ya dijo hace poco, igual o casi: Brenna
 * con «Treinta la jarra» seis veces, o la misma advertencia dos turnos
 * seguidos. Frase a frase; las de menos de tres palabras («Sí.», «Treinta.»)
 * no cuentan.
 */
export function repeatedLines(input: { lines: readonly DialogueLine[]; said: (npcId: string) => readonly string[] }): { npc_id: string; text: string }[] {
  const out: { npc_id: string; text: string }[] = [];
  for (const l of input.lines) {
    if (l.speaker !== 'npc' || !l.npc_id) continue;
    const before = input.said(l.npc_id).flatMap((t) => t.split(/[.!?¿¡…]+/)).map(wordsOf).filter((w) => w.length >= 3);
    for (const sentence of l.text.split(/[.!?¿¡…]+/)) {
      const w = wordsOf(sentence);
      if (w.length < 3 || !before.some((b) => sameSaying(w, b))) continue;
      out.push({ npc_id: l.npc_id, text: sentence.trim() });
      break;
    }
  }
  return out;
}

export function repeatedRejection(hits: readonly { who: string; text: string }[]): string {
  return `${hits.map((h) => `${h.who} ya ha dicho «${h.text}» hace nada`).join('; ')}: la gente no repite la misma frase. Si vuelve sobre eso, que lo diga de otra manera, con algo nuevo (un detalle, una pregunta, un gesto) o que calle; reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Recibir algo de otro jugador sin oferta
// ---------------------------------------------------------------------------

const TAKES = '(?:aceptas|acepta|coges|coge|tomas|toma|recibes|recibe|agarras|agarra)';
const GIVES = '(?:que te|que le|que se la|que se lo)\\s+(?:tiende|tendia|ofrece|ofrecia|da|daba|pasa|pasaba|alarga|acerca)';

/**
 * La narración da por hecho que el actor recibe algo de otro jugador («aceptas
 * la jarra que te tiende Leodhin») sin que haya pasado nada: entre jugadores
 * las cosas cambian de mano con la oferta del que da y el «acepto» del que
 * recibe (party.ts), y eso lo hace el motor. Devuelve los nombres citados.
 */
export function receivedWithoutOffer(input: { texts: readonly string[]; givers: readonly string[]; okTools: readonly string[] }): string[] {
  if (input.okTools.includes('transfer_item')) return [];
  const text = input.texts.map(norm).join(' . ');
  return input.givers.filter((name) => {
    const n = norm(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${TAKES}\\b[^.;:]{0,60}\\b(?:${GIVES}|de manos de)\\s+${n}\\b`).test(text);
  });
}

/** Lo que pide el jugador con sus cosas, y lo mismo contado como hecho en la narración. */
const WANTS_ITEM_MOVE = /\b(?:guard|mete|meto|meter|recog|recoj|cog|coj)/;
const TELLS_ITEM_MOVE = /(?<!\bno )(?<!\bno te )\b(?:te )?(guardas|metes|recoges|coges)\b/;

/**
 * El actor pide mover algo suyo y la narración lo da por hecho sin ningún tool que lo haga («lo guardas en la
 * mochila» y el agua sigue en la mano). Devuelve el verbo contado, o null.
 */
export function movedWithoutTool(input: { action: string; narration: string; okTools: readonly string[] }): string | null {
  if (!WANTS_ITEM_MOVE.test(norm(input.action))) return null;
  if (input.okTools.some((t) => t === 'transfer_item' || t === 'spawn_item' || t === 'harvest' || t === 'use_item' || t === 'buy_item' || t === 'sell_item')) return null;
  return TELLS_ITEM_MOVE.exec(norm(input.narration))?.[1] ?? null;
}

export function movedRejection(verb: string): string {
  return `La narración dice «${verb}» y en este turno no se ha movido nada: lo que no pasa por transfer_item no ha ocurrido, y el objeto sigue donde estaba. Llama a transfer_item con su ID (ver Inventario y lo que hay en el suelo); si no cabe, cuéntalo con lo que devuelve. Después reescribe log_event, sin objetos que no estén en el contexto.`;
}

export function receivedRejection(names: readonly string[]): string {
  return `La narración dice que el actor recibe algo de ${names.join(' y ')}, y en este turno no ha cambiado nada de manos: entre jugadores, solo pasa cuando el otro lo ofrece y este lo acepta (lo hace el servidor). Reescribe log_event sin darlo por recibido: como mucho, alarga la mano o se lo pide.`;
}

// ---------------------------------------------------------------------------
// Lo que sabe el PJ: nombres que se dicen delante de él
// ---------------------------------------------------------------------------

/** Un NPC que el cierre puede encontrar nombrado: si está en el sitio, oír su nombre lo presenta. */
export interface NamedNpc { id: string; name: string; present: boolean }

const named = (text: string, name: string) => npcNameForms(name).some((f) => nameRe(f, 'u').test(text));
/** Lo citado («…») y lo que no lo está, por separado. */
const quoted = (t: string) => [...t.matchAll(/«([^»]*)»/g)].map((m) => m[1]!);
const unquoted = (t: string) => t.replace(/«[^»]*»/g, ' ');
/** Giros que presentan a alguien justo antes de su nombre: «se presenta como Hugo», «Brenna te presenta a Hugo». */
const INTRO_BEFORE = /(?:se presenta(?: como)?|dice llamarse|dice que se llama|responde que se llama|se llama|su nombre es|(?:le|lo|la) llaman|(?:te |os |le |les )?presenta a)\s*:?\s*$/;

/**
 * NPC cuyo nombre aprende el actor en este cierre (y los de su turno
 * compartido, que oyen lo mismo):
 *   - el NPC dice su propio nombre en sus `lines` («Soy Hugo», «Brenna, para servirte»);
 *   - otro lo nombra en voz alta (lines o citas de la narración) y está delante: un tercero lo presenta;
 *   - la narración lo presenta con un giro claro («se presenta como Hugo», «te presenta a Hugo»).
 * Lo que dice el propio actor no le enseña nada; las citas que repiten lo que escribió el jugador, tampoco.
 */
export function introducedIn(o: { npcs: readonly NamedNpc[]; lines: readonly DialogueLine[]; narration: string; playerText?: string | null | undefined }): string[] {
  const heard = quoted(o.narration).filter((q) => !saidByPlayer(q, o.playerText));
  const plain = unquoted(o.narration);
  return o.npcs.filter((n) => {
    if (o.lines.some((l) => l.speaker === 'npc' && l.npc_id === n.id && named(l.text, n.name))) return true;
    if (n.present && o.lines.some((l) => l.speaker !== 'actor' && l.npc_id !== n.id && named(l.text, n.name))) return true;
    if (n.present && heard.some((q) => named(q, n.name))) return true;
    return npcNameForms(n.name).some((f) => [...plain.matchAll(nameRe(f))].some((m) => INTRO_BEFORE.test(norm(plain.slice(Math.max(0, m.index! - 40), m.index!)))));
  }).map((n) => n.id);
}

/**
 * `names_learned` del máster, comprobado: solo los NPC cuyo nombre se ha dicho
 * en este turno (narración o lines). Un nombre que no ha sonado no se aprende.
 */
export function confirmedNames(ids: readonly string[], npcs: readonly NamedNpc[], texts: readonly string[]): string[] {
  return ids.filter((id) => {
    const n = npcs.find((x) => x.id === id);
    return n !== undefined && texts.some((t) => named(t, n.name));
  });
}

/** NPC que el jugador nombró al escribir: lo sabe (o lo da por sabido) y no se le tapa en la respuesta. */
export function namedByPlayer(npcs: readonly NamedNpc[], playerText: string | null | undefined): string[] {
  return playerText ? npcs.filter((n) => named(playerText, n.name)).map((n) => n.id) : [];
}
