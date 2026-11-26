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

import { addressedTo, proseWithout, type DialogueLine } from './moments.js';
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
export const DEAL_TOOLS = new Set(['set_debt', 'pawn_item', 'settle_debt', 'give_coins', 'take_coins', 'transfer_item', 'buy_item', 'sell_item', 'complete_job']);

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
export const COIN_TOOLS = new Set(['give_coins', 'take_coins', 'settle_debt', 'buy_item', 'sell_item', 'set_debt', 'pawn_item', 'complete_job']);
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
// Robos y lo que se sirve, solo de palabra
// ---------------------------------------------------------------------------

/** El jugador quiere quitarle algo a alguien («robarle la bolsa», «birlar la llave», «le quito el cuchillo»). */
const WANTS_THEFT = /\b(?:robar\w*|robo|roba|birl\w*|hurt\w*|sis\w*|mang\w*|quitarle|le quito|cortar(?:le)? la bolsa)\b/;
/** La narración lo da por hecho: el objeto ya está en su mano, su manga o su bolsillo. */
const TELLS_TAKEN = /\b(?:(?:cae|queda|esta)\w* (?:\w+ ){0,2}(?:a|en) tu (?:mano|palma|manga|bolsillo)|(?:te (?:lo|la|los|las) )?(?:guardas|escondes|metes)\b[^.;:]{0,30}\b(?:manga|bolsillo|cinto|mochila|zurron)|escondid[oa] (?:bajo|en) (?:la|tu) manga|(?:lo|la) sacas (?:del|de su)|se suelta del cinto|ya es tuy[oa]|te haces con)\b/;
/** Tools que mueven objetos o monedas de verdad. */
const MOVE_TOOLS = new Set(['transfer_item', 'take_coins', 'give_coins', 'spawn_item', 'buy_item', 'sell_item', 'pawn_item']);

/**
 * El jugador roba algo y la narración lo da por conseguido sin que nada haya cambiado de manos: o el objeto está en
 * lo que lleva el otro y había que moverlo con transfer_item, o no existe (la bolsa de Garrán, partida «Humo y
 * ceniza», 05-11). Devuelve la frase que lo da por hecho, o null. Con una tirada pendiente, todavía no ha pasado.
 */
export function stolenWithoutTool(input: { action: string; narration: string; okTools: readonly string[]; pendingRoll?: boolean }): string | null {
  if (input.pendingRoll || input.okTools.some((t) => MOVE_TOOLS.has(t))) return null;
  if (!WANTS_THEFT.test(norm(input.action).replace(/«[^»]*»/g, ' '))) return null;
  for (const c of clauses(norm(input.narration).replace(/«[^»]*»/g, ' . '))) {
    const m = TELLS_TAKEN.exec(c);
    // Lo niega o lo deja en intento justo antes («no cae a tu mano»); un «sin tirar de la correa» de un robo limpio no.
    if (m && !/\b(no|ni|nunca|nada|nadie|intentas|si)\b[^,]{0,25}$/.test(c.slice(0, m.index))) return m[0];
  }
  return null;
}

export function stolenRejection(phrase: string): string {
  return `La narración da algo por robado («${phrase}») y en este turno no ha cambiado nada de manos. Robarle a alguien lo decide el servidor con conflict_act: con instance_id si está en lo que lleva («Lleva:» en el contexto) o, si no está en los datos y es razonable que lo lleve, con new_item_name; si no es razonable, cuenta que no lo encuentra. Reescribe log_event.`;
}

/** El NPC entrega algo a quien se lo pide («te la pone delante», «te sirve», «te tiende la jarra»). */
const SERVES = new RegExp([
  String.raw`\b(?:te (?:lo |la |los |las )?(?:pone|planta|deja|sirve|tiende|alarga|acerca|pasa|da|entrega|empuja)\b|te (?:pone|sirve|deja|planta) (?:delante|en la barra|en la mesa))`,
  // «la llena de una cuba y la desliza hacia ti», «Sirve una jarra de cerveza turbia y la empuja hacia ti» (bench de Haiku, 25-11).
  String.raw`\b(?:la|lo|las|los) (?:desliza|empuja|pone|deja|planta|acerca|arrastra|sirve|alarga|tiende)\b[^.;:]{0,25}\b(?:hacia ti|delante de ti|ante ti|frente a ti|a tu lado|junto a tu mano|en tu mano)\b`,
  String.raw`\b(?:sirve|escancia) (?:una|la|otra|dos|tu) (?:jarra|cerveza|copa|vaso|taza|racion|cuenco|plato)\b`,
].join('|'));
/** Lo que paga o apunta lo servido: mover el objeto con transfer_item no lo cobra. */
const SERVED_PAID = new Set(['buy_item', 'set_debt', 'pawn_item', 'give_coins', 'take_coins', 'settle_debt']);
/** Giros con «sin» que no niegan que lo sirva: «la llena sin prisa». */
const HARMLESS_SIN = /\bsin (?:prisa|prisas|ceremonia|cuidado|decir nada|una palabra|mirar\w*|levantar la vista|derramar\w*(?: una gota)?)\b/g;

/** Lo que vende quien está delante, como lo cita el cierre: nombre del objeto, ID y precio. */
export interface MenuItem { npc_id: string; npc: string; item_id: string; name: string; price: string }

/**
 * En un trato (comercio), el NPC sirve o entrega lo que vende y nadie lo cobra ni lo apunta: la cerveza de Brenna
 * («Cuatro de cobre», y te la pone delante) sin buy_item ni set_debt, y el jugador se va sin pagar sin que pase
 * nada. Lo que se sirve se cobra al servirlo (buy_item) o se fía (set_debt). Devuelve la frase, o null.
 */
export function servedWithoutPay(input: { narration: string; lines?: readonly DialogueLine[]; okTools: readonly string[]; trade: boolean; pendingRoll?: boolean; goods?: readonly string[] }): string | null {
  if (!input.trade || input.pendingRoll || input.okTools.some((t) => SERVED_PAID.has(t))) return null;
  const said = (input.lines ?? []).filter((l) => l.speaker === 'npc').map((l) => l.text);
  // Con `goods` (el comercio solo se deduce de nombrar algo de la carta), «te deja pasar» no es servir: la frase
  // lleva lo que se entrega («te la pone», «la desliza hacia ti», «sirve una jarra») o nombra el género.
  const goods = input.goods?.length ? new RegExp(`\\b(?:${[...input.goods, ...GENERIC_GOODS].map(esc).join('|')})s?\\b`) : null;
  for (const c of clauses(norm([input.narration.replace(/«[^»]*»/g, ' . '), ...said].join(' . ')))) {
    if (/\b(no|ni|nunca|sin|si|cuando|antes|primero|cuanto)\b/.test(c.replace(HARMLESS_SIN, ' '))) continue;
    const m = SERVES.exec(c);
    if (m && (!goods || /^(?:te (?:lo|la|los|las) |la |lo |las |los |sirve|escancia)/.test(m[0]) || goods.test(c))) return m[0];
  }
  return null;
}

/** Palabras que nombran algo de la carta («jarra de cerveza» → cerveza): sin las del recipiente. */
const GENERIC_GOODS = new Set(['jarra', 'vaso', 'copa', 'plato', 'cuenco', 'racion', 'noche', 'trozo', 'botella', 'pieza', 'bolsa', 'taza']);
export function menuWords(name: string): string[] {
  return norm(name).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length >= 5 && !GENERIC_GOODS.has(w));
}

/** Lo de la carta que nombran estos textos («una cerveza»): el primer trago también se paga (arreglo 14). */
export function menuNamed(menu: readonly MenuItem[], texts: readonly string[]): MenuItem | null {
  const t = norm(texts.join(' . '));
  return menu.find((m) => menuWords(m.name).some((w) => new RegExp(`\\b${esc(w)}s?\\b`).test(t))) ?? null;
}

export function servedRejection(phrase: string, item?: MenuItem | null): string {
  const what = item ? ` ${item.npc} vende ${item.name} a ${item.price}: buy_item (npc_id ${item.npc_id}, item_id ${item.item_id}) al servirlo, o set_debt si se lo fía.` : '';
  return `El NPC entrega lo que vende («${phrase}») y nadie lo cobra: lo que se sirve se paga al servirlo con buy_item (de su lista «Vende») o se fía con set_debt si no puede o no quiere pagar ahora; también el primer trago.${what} Si todavía no se lo da (solo dice el precio), cuéntalo así. Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Efecto mágico narrado sin que el motor lo aplique (PLAN-OBJETOS §4.11)
// ---------------------------------------------------------------------------

/** Tools que aplican el efecto de un objeto mágico. */
export const MAGIC_TOOLS = new Set(['use_item', 'use_scroll', 'cast_spell', 'heal', 'attune_item', 'add_condition']);

/** Lo que el actor lleva que se puede usar con magia: solo eso se vigila, para no confundir un pergamino mágico con una carta. */
export interface MagicAtHand { scroll: boolean; potion: boolean; charged: boolean; attunable: boolean }

const MAGIC_PATTERNS: { kind: keyof MagicAtHand; re: RegExp }[] = [
  { kind: 'scroll', re: /\b(lees|lee|recitas|recita|pronuncias|pronuncia|activas|activa)\b[^,.;]{0,40}\bpergamino\b|\bpergamino\b[^,.;]{0,30}\b(arde|se deshace|se consume|se convierte en ceniza|se desvanece|brilla)\b/ },
  { kind: 'potion', re: /\b(bebes|te bebes|bebe|se bebe|apuras|apura|tragas|traga|vacias|vacia)\b[^,.;]{0,40}\b(pocion|elixir|frasco|frasquito|vial|redoma|brebaje)\b/ },
  { kind: 'charged', re: /\b(la varita|la vara|el baston|el anillo|el amuleto|el cetro)\b[^,.;]{0,30}\b(escupe|lanza|dispara|suelta|despide|se activa|descarga|chisporrotea)\b|\b(agitas|agita|apuntas|apunta|activas|activa|blandes|blande)\b[^,.;]{0,30}\b(varita|vara|cetro)\b/ },
  { kind: 'attunable', re: /\b(te sintonizas|se sintoniza|sintonizas|quedas sintonizad[oa]|queda sintonizad[oa]|te vinculas con|se vincula con)\b/ },
];
/** Lo que no llega a ocurrir: niega, se queda en intento u ocurre en otro momento. */
const MAGIC_NOT_DONE = /\b(no|ni|nunca|sin|si|quieres|intentas|piensas|vas a|antes de|tampoco|podrias|podria|seria|guardas|guarda)\b/;

/**
 * La narración cuenta que un objeto mágico hace efecto (bebe la poción y se vuelve invisible, lee el pergamino,
 * la varita escupe dardos, queda sintonizado) y en el turno no ha pasado por su tool: el motor no lo ha aplicado.
 * Solo se mira lo que el actor tiene a mano (`atHand`). Las palabras entre «» no cuentan.
 */
export function magicWithoutTool(input: { narration: string; okTools: readonly string[]; atHand: MagicAtHand; pendingRoll?: boolean }): string | null {
  if (input.pendingRoll || input.okTools.some((t) => MAGIC_TOOLS.has(t))) return null;
  const acts = norm(input.narration).replace(/«[^»]*»/g, ' . ');
  for (const c of clauses(acts)) {
    if (MAGIC_NOT_DONE.test(c)) continue;
    for (const { kind, re } of MAGIC_PATTERNS) {
      if (!input.atHand[kind]) continue;
      const m = re.exec(c);
      if (m) return m[0];
    }
  }
  return null;
}

export function magicRejection(phrase: string): string {
  return `La narración da por hecho un efecto mágico («${phrase}») que el motor no ha aplicado: lo que no pasa por un tool no ha ocurrido. Usa use_item (poción, varita, objeto con cargas), use_scroll (pergamino), attune_item (sintonizarse o identificar) o cast_spell, y narra lo que devuelva; o narra que no llega a usarlo. Reescribe log_event.`;
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
 * Turno compartido (ronda, conversación de grupo o ventana de turno): cada uno
 * de los que actuaron lee lo suyo en `narration_by_pc` (en segunda persona) y lo
 * común en la narración. Devuelve los que no tienen su parte. Sin `byPc` (el
 * contrato de antes), basta con que salga en la narración por su nombre o con una
 * línea del NPC dirigida a él (`to`).
 */
export function unansweredInShared(input: { narration: string; lines?: readonly DialogueLine[]; acted: readonly { id: string; name: string }[]; byPc?: Readonly<Record<string, string>> }): { id: string; name: string }[] {
  if (input.acted.length < 2) return [];
  if (input.byPc) return input.acted.filter((m) => !input.byPc![m.id]?.trim());
  const text = ` ${norm(input.narration).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return input.acted.filter((m) => {
    const n = norm(m.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (n && text.includes(` ${n} `)) return false;
    return !(input.lines ?? []).some((l) => l.speaker === 'npc' && addressedTo(l, m.id) && l.to !== 'all');
  });
}

export function unansweredRejection(missing: readonly { id?: string; name: string; text: string }[], vague: string | null = null): string {
  const parts: string[] = [];
  if (missing.length) parts.push(`Turno compartido: falta en narration_by_pc lo de ${missing.map((m) => `${m.name}${m.id ? ` [${m.id}]` : ''} («${m.text}»)`).join(' y lo de ')}. Cada jugador que ha actuado lee SU parte en narration_by_pc (por su ID, en segunda persona: lo que hace y lo que le pasa a él; si preguntó algo, la respuesta); lo común, lo que hace el mundo, va en narration_private.`);
  if (vague) parts.push(`narration_private la leen todos y dice «${vague}»: ahí nada de «tú» a secas; en tercera persona o en plural («os mira»). Lo que es de uno, en su narration_by_pc.`);
  return parts.join(' ');
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

/** Turnos del narrador que se miran para no repetir una frase. */
export const NARRATION_MEMORY_TURNS = 4;

/**
 * Lo que el narrador le ha contado a este PJ en sus últimos `n` turnos con máster (los suyos), sin lo dicho:
 * las citas de `lines` que el cierre guarda en la narración no son del narrador.
 */
export function recentNarration(events: readonly GameEvent[], actorId: string, n = NARRATION_MEMORY_TURNS): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < n; i--) {
    const e = events[i]!;
    if (e.actor_id !== actorId || !e.action_type.startsWith('master') || !e.narration_private) continue;
    const lines = Array.isArray(e.payload['lines']) ? e.payload['lines'] as DialogueLine[] : [];
    out.push(proseWithout(e.narration_private, lines.filter((l) => typeof l?.text === 'string')).replace(/«[^»]*»/g, ' '));
  }
  return out.reverse();
}

/** ¿Esta frase ya estaba dicha? Igual, casi igual (sameSaying) o casi entera dentro de una de antes (80 % de sus palabras). */
function saidBefore(w: string[], before: readonly string[][]): boolean {
  return before.some((b) => {
    if (sameSaying(w, b)) return true;
    const B = new Set(b);
    return w.length >= 4 && w.filter((x) => B.has(x)).length / w.length >= 0.8;
  });
}

/**
 * La narración sin las frases que el narrador ya dijo en los últimos turnos (normalizadas: «Ilse sigue sin
 * decir nada.» por tercera vez, «La plaza espera.»). Sin reescritura: la frase se quita y ya. Las de menos de
 * tres palabras no cuentan. Si no quedara nada, la narración se queda como estaba (el cierre no puede ir vacío).
 */
export function withoutRepeatedNarration(narration: string, said: readonly string[]): { narration: string; removed: string[] } {
  const before = said.flatMap((t) => t.split(/[.!?¿¡…:]+/)).map(wordsOf).filter((w) => w.length >= 3);
  if (!before.length || !narration.trim()) return { narration, removed: [] };
  const removed: string[] = [];
  const paras = narration.split('\n').map((para) => {
    const parts = para.match(/[^.!?…]+(?:[.!?…]+[»”"]?|$)/g) ?? [];
    return parts.filter((sentence) => {
      if (/[«»“”"]/.test(sentence)) return true; // lo dicho no es del narrador
      const w = wordsOf(sentence);
      if (w.length < 3 || !saidBefore(w, before)) return true;
      removed.push(sentence.trim());
      return false;
    }).map((x) => x.trim()).join(' ');
  });
  const out = paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out ? { narration: out, removed } : { narration, removed: [] };
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

// ---------------------------------------------------------------------------
// Acciones conflictivas (conflict.ts, docs/CONFLICTOS-NPC.md §11)
// ---------------------------------------------------------------------------

const CONFLICT_ROLLS = new Set(['sleight_of_hand', 'athletics', 'acrobatics']);
/** Lo suyo con el actor (deudas, encargos) o comercio: no es reaccionar a lo que acaba de hacerle. */
const OFF_TOPIC = /\b(deuda|debes|me debes|tu cuenta|la cuenta|el plazo|cobrar\w*|encargo|trabajo para|te pongo|cuesta|vale \d+)\b/;

export interface ConflictCloseInput {
  /** Lo que el motor leyó antes del máster (conflict.ts, conflictPlan). */
  plan: { kind: string; npc_id: string; verdict: { possible: boolean } | null } | null;
  /** El máster ha llamado a conflict_act en este turno, y si se podía. */
  called: boolean;
  possible: boolean | null;
  req: { kind: string; key: string } | null;
  narration: string;
  lines: readonly DialogueLine[];
  /** El NPC que tiene que reaccionar (conflict_act lo resolvió en el acto) y cómo se le nombra. */
  reacts: { name: string; refs: readonly string[] } | null;
  actionText: string | null;
  /** Es la continuación de una tirada: lo ha resuelto el motor y aquí solo se cuenta. */
  rolling: boolean;
}

/**
 * ¿Se salta el cierre una acción conflictiva? Sin conflict_act no hay tirada
 * contra el NPC ni robo; lo que no se puede no lleva tirada; y cuando el NPC
 * reacciona, la narración le nombra y su primera frase no va de deudas,
 * encargos ni comercio. Devuelve el motivo para reescribir, o null.
 */
export function conflictCloseProblems(i: ConflictCloseInput): string | null {
  if (i.rolling) return null;
  const rollsAgainst = Boolean(i.req && i.req.kind === 'skill' && CONFLICT_ROLLS.has(i.req.key));
  if (i.plan && !i.called) {
    if (i.plan.verdict && !i.plan.verdict.possible) {
      return i.req ? 'Lo que intenta el actor NO SE PUEDE (lo dice el bloque «Acción conflictiva»): sin tirada. Cuenta qué lo impide y cierra sin requires_roll.' : null;
    }
    return `El actor intenta algo contra un NPC (${i.plan.kind}): lo decide el servidor. Llama antes a conflict_act (npc_id "${i.plan.npc_id}", kind "${i.plan.kind}") y cierra sin requires_roll; la tirada, si la hay, la pone el servidor.`;
  }
  if (!i.called && rollsAgainst && i.actionText && /\b(rob\w*|birl\w*|hurt\w*|quit\w*|arranc\w*|arrebat\w*|empuj\w*|agarr\w*|sujet\w*)/.test(i.actionText.toLowerCase())) {
    return 'Una tirada de Juego de manos o Atletismo contra un NPC (robarle, empujarle, agarrarle) la decide el servidor: llama a conflict_act y cierra sin requires_roll.';
  }
  if (i.reacts) {
    const said = i.lines.filter((l) => l.speaker === 'npc').map((l) => l.text).join(' ');
    const all = `${i.narration} ${said}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const named = i.reacts.refs.some((r) => all.includes(r.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(el|la|los|las) /, '')));
    if (!named) return `Lo ha resuelto el servidor y ${i.reacts.name} reacciona: cuéntalo (nómbrale y di lo que hace, como en «reaction» de conflict_act). Reescribe log_event.`;
    if (OFF_TOPIC.test(said.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) return `${i.reacts.name} acaba de pillar al actor: su primera frase es la reacción a eso, no deudas, encargos ni precios. Reescribe sus líneas.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Estado narrado sin la tool que lo hace real (PLAN-ARREGLOS-2026-11-26, arreglo 1)
// ---------------------------------------------------------------------------

/** Lo que el máster narra como hecho y solo existe si pasa por su tool. */
export type StateKind = 'rest' | 'heal' | 'pick' | 'spell' | 'fact' | 'memory' | 'debt';

/** Tools que lo hacen real, por clase. `memory` no tiene tool: va en npc_memory_note del propio cierre. */
export const STATE_TOOLS: Record<StateKind, readonly string[]> = {
  rest: ['take_rest'],
  heal: ['heal', 'stabilize', 'use_item', 'cast_spell', 'spend_resource', 'take_rest'],
  pick: ['transfer_item', 'harvest', 'spawn_item', 'take_coins', 'buy_item', 'sell_item', 'pawn_item', 'use_item'],
  spell: ['cast_spell', 'spend_resource', 'use_scroll', 'use_item'],
  fact: ['record_character_fact', 'plant_rumor'],
  memory: [],
  debt: ['set_debt', 'pawn_item', 'settle_debt'],
};

export interface StateMiss { kind: StateKind; phrase: string }

/** El jugador quiere descansar («dejo que la mano descanse», «me tumbo un momento», «para recuperar el aliento»). */
const WANTS_REST = /\b(descans\w*|repos\w*|dormir|duermo|me duermo|cabezada|siesta|recuperar (?:el aliento|fuerzas|las fuerzas)|recupero (?:el aliento|fuerzas)|paso la noche|pasar la noche|hago noche|acamp\w*|me tumbo un (?:momento|rato)|cierro los ojos un (?:momento|rato))\b/;
/** Descanso contado como hecho: con estas basta. */
const TELLS_REST = /\b(descansas|duermes|te duermes|te quedas dormid[oa]|echas una cabezada|das una cabezada|dormitas|pasas la noche|reposas|recuperas (?:el aliento|fuerzas|las fuerzas))\b/;
/** Y estas, si el jugador pedía descansar. */
const TELLS_REST_SOFT = /\b(te tumbas|te echas|te recuestas|cierras los ojos)\b/;
/** El jugador quiere curar o vendar (a sí mismo o a otro). */
const WANTS_HEAL = /\b(curo|me curo|le curo|curar\w*|curame|curale|vendo|me vendo|le vendo|vendar\w*|vendaje|estabiliz\w*|primeros auxilios|tapon\w* la herida|cos\w* la herida|hemorragia|(?:me|le) presiono (?:la herida|el hombro|el costado|la costilla|el brazo|la pierna))\b/;
/** Cura contada como hecha. */
const TELLS_HEAL = /\b(te vendas|le vendas|te venda|le venda|te curas|le curas|te cura|le cura|estabilizas|le estabilizas|cierras la herida|la herida se cierra|deja de sangrar|la sangre deja de (?:correr|salir|manar)|recuperas \d+ (?:pg|puntos de golpe))\b/;
/** Y estas, si el jugador pedía curar: «te ciñes el costado», «el aire vuelve a entrar sin el pinchazo». */
const TELLS_HEAL_SOFT = /\b(?:te cines|cines|te ajustas|le ajustas|te atas|le atas)\b[^.;:]{0,40}\b(?:costado|herida|hombro|brazo|pierna|tira|tiras|venda|vendaje|pano|tela)\b|\bel aire vuelve a entrar\b|\bel dolor (?:cede|afloja|remite)\b/;
/** Coger algo del sitio: «tomas uno de los eslabones», «recoges unas hierbas», «coges la llave de la mesa». */
const TELLS_PICK = new RegExp([
  String.raw`\b(?:tomas|coges|recoges|agarras|arrancas|cosechas|desentierras|levantas|sacas) (?:con cuidado |despacio )?(?:uno|una|unos|unas|un par|dos|tres) de (?:los|las|esos|esas|estos|estas)\b`,
  String.raw`\b(?:tomas|coges|recoges|arrancas|cortas|cosechas|juntas|reunes|desentierras)\b[^.;:]{0,30}\b(?:hierbas?|setas?|bayas?|lena|lenos|raices|flores|frutos?|ramas?|musgo|juncos|hongos|plantas?)\b`,
  String.raw`\b(?:recoges|coges|tomas)\b[^.;:]{0,30}\b(?:del suelo|de la losa|del estante|de la mesa|de la repisa|del cofre|del agua|del barro|de entre)\b`,
].join('|'));
/** Lanzar un conjuro contado como hecho. */
const TELLS_SPELL = /\b(?:lanzas|conjuras|invocas|pronuncias|recitas|canalizas)\b[^.;:]{0,40}\b(?:conjuro|hechizo|rayo|dardo|dardos|proyectil|truco|encantamiento|maleficio|bendicion|plegaria)\b|\b(?:sale|salen|brota|brotan|surge|surgen|nace|salta|escapa)\w* de (?:tus|la punta de tus) (?:dedos|manos|palmas?)\b/;
/** El jugador cuenta algo de su personaje: su pasado, su gente («Mi padre era herrero», «Busco a mi hermana Lía»). */
const TELLS_OWN_PAST = /\bmi (?:padre|madre|abuel[oa]|herman[oa]|tio|tia|maestr[oa]|mentor[a]?|mujer|marido|esposa|esposo|hij[oa]|familia|gente|pueblo|aldea|clan|orden)\b[^.;:!?]{0,25}\b(?:era|fue|es|tenia|tuvo|murio|vivia|se fue|me (?:enseno|dijo|decia|crio|dejo|llevo))\b|\bbusco a mi (?:herman[oa]|padre|madre|hij[oa]|tio|tia|amig[oa]|mujer|marido|esposa|esposo)\b|\b(?:naci|creci|me crie|servi|aprendi|estudie) (?:en|con|de|a|bajo)\b|\bfui (?:aprendiz|soldado|marinero|guardia|sacerdote|novici[oa]|ladron[a]?|herrer[oa]|cazador[a]?|mercenari[oa]|escudero|acolito|monje|pastor[a]?|grumete)\b/;
/** Un NPC que se quedará con algo del actor: eso va en npc_memory_note. */
const TELLS_MEMORY = /\b(lo recordara|la recordara|te recordara|no lo olvidara|no la olvidara|no te olvidara|se acordara de (?:ti|esto|eso|tu cara|tu nombre)|toma nota (?:de|mentalmente)|se le queda grabad[oa]|se lo apunta|lo anota)\b/;
/** Deuda o fiado cerrado. */
const TELLS_DEBT = /\b(me (?:lo |la )?debes|quedas a deber|te (?:lo |la )?fio|fiad[oa]s?|a tu cuenta|en tu cuenta|lo apunto|te (?:lo |la )?apunto|queda apuntad[oa])\b/;
/** Lo que niega, pregunta, ofrece o deja en intento, delante de la frase. */
const STATE_NOT_DONE = /\b(no|ni|nunca|sin|apenas|intentas|intenta|quieres|quiere|si|antes de|vas a|podrias|podria|tampoco)\b/;
/** Una negación justo delante («no te cura»), sin mirar más atrás en la frase. */
const NEGATED_JUST_BEFORE = /\b(?:no|ni|nunca)\b[^,]{0,20}$/;

const outsideQuotes = (t: string) => norm(t).replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, ' . ');

/** La primera frase que lo da por hecho sin negación delante, o null. `strict`: cualquier negación o intento antes, en la frase. */
function firstDone(text: string, re: RegExp, strict = false): string | null {
  for (const c of clauses(text)) {
    const m = re.exec(c);
    if (!m) continue;
    const before = c.slice(0, m.index);
    if (strict ? STATE_NOT_DONE.test(before) : NEGATED_JUST_BEFORE.test(before)) continue;
    return m[0];
  }
  return null;
}

/**
 * Lo que el máster da por hecho y no ha pasado por su tool: descansar sin take_rest, curar o vendar sin heal, coger
 * algo del sitio sin transfer_item, lanzar un conjuro sin cast_spell, aceptar el pasado que cuenta el jugador sin
 * record_character_fact, que un NPC lo recordará sin npc_memory_note, o un fiado sin set_debt. Pasada 1 de las pruebas
 * del 25-11: 25 de 56 tools a cero, casi todas por esto. Lo que dice el actor entre «» no cuenta; lo de los NPC, sí.
 * `skip`: clases que ya mira otra guarda en este cierre.
 */
export function stateWithoutTool(input: {
  action: string | null; narration: string; lines?: readonly DialogueLine[]; okTools: readonly string[]; pendingRoll?: boolean;
  /** Nombres de los conjuros y recursos de clase del actor, para reconocerlos en la narración. */
  spells?: readonly string[]; resources?: readonly string[];
  /** El cierre trae npc_memory_note. */
  memoryNote?: boolean; hasOpenDebt?: boolean; skip?: readonly StateKind[];
}): StateMiss | null {
  if (input.pendingRoll) return null;
  const ok = (k: StateKind) => input.skip?.includes(k) || STATE_TOOLS[k].some((t) => input.okTools.includes(t));
  const narr = outsideQuotes(input.narration);
  const npcSaid = (input.lines ?? []).filter((l) => l.speaker === 'npc').map((l) => norm(l.text)).join(' . ');
  const action = norm(input.action ?? '');
  if (!ok('rest')) {
    const p = firstDone(narr, TELLS_REST, true) ?? (WANTS_REST.test(action) ? firstDone(narr, TELLS_REST_SOFT, true) : null);
    if (p) return { kind: 'rest', phrase: p };
  }
  if (!ok('heal')) {
    const p = firstDone(narr, TELLS_HEAL) ?? (WANTS_HEAL.test(action) ? firstDone(narr, TELLS_HEAL_SOFT) : null);
    if (p) return { kind: 'heal', phrase: p };
  }
  if (!ok('pick')) {
    const p = firstDone(narr, TELLS_PICK, true);
    if (p) return { kind: 'pick', phrase: p };
  }
  if (!ok('spell')) {
    const named = [...(input.spells ?? []), ...(input.resources ?? [])].map((n) => norm(n).trim()).filter((n) => n.length >= 4).map(esc);
    const byName = named.length ? new RegExp(String.raw`\b(?:lanzas|conjuras|invocas|usas|activas|canalizas|gastas|recurres a|entras en)\b[^.;:]{0,20}\b(?:${named.join('|')})\b`) : null;
    const p = firstDone(narr, TELLS_SPELL, true) ?? (byName ? firstDone(narr, byName, true) : null);
    if (p) return { kind: 'spell', phrase: p };
  }
  if (!ok('fact')) {
    const m = TELLS_OWN_PAST.exec(action);
    if (m) return { kind: 'fact', phrase: m[0] };
  }
  if (!ok('memory') && !input.memoryNote) {
    const p = firstDone(`${narr} . ${npcSaid}`, TELLS_MEMORY);
    if (p) return { kind: 'memory', phrase: p };
  }
  // El fiado sin ningún tool de trato ya lo rechaza dealWithoutState: aquí, el que se cuela con otro tool (transfer_item).
  if (!ok('debt') && input.okTools.some((t) => DEAL_TOOLS.has(t))) {
    for (const c of [...clauses(narr), ...clauses(npcSaid)]) {
      const m = TELLS_DEBT.exec(c);
      if (!m || NOT_CLOSED.test(c)) continue;
      if (input.hasOpenDebt && /^(me (?:lo |la )?debes|quedas a deber|queda apuntad[oa])$/.test(m[1]!)) continue;
      return { kind: 'debt', phrase: m[1]! };
    }
  }
  return null;
}

const STATE_HINT: Record<StateKind, string> = {
  rest: 'Descansar lo hace take_rest (short: una hora, gasta dados de golpe; long: la noche entera): el servidor aplica el tiempo, lo que recupera y si alguien le interrumpe. Si solo es un respiro de un momento, cuéntalo así: no recupera nada.',
  heal: 'Curar o vendar lo hace heal (con item_instance_id si gasta una venda, un kit o una poción: el servidor la gasta y tira) o stabilize a quien está a 0 PG. Si es un apaño que no devuelve PG, dilo así en la narración.',
  pick: 'Coger algo del sitio lo hace transfer_item (con su ID: ver lo que hay en el punto) o harvest si es un recurso (hierbas, leña, setas). Si no está en los datos, no lo hay: cuéntalo así.',
  spell: 'Un conjuro lo lanza cast_spell (comprueba que lo tiene, gasta el espacio y tira) y un recurso de clase se gasta con spend_resource. Si no lo tiene o no le quedan usos, cuéntalo así.',
  fact: 'El jugador cuenta algo de su personaje: guárdalo con record_character_fact (es verdad para él, no da nada gratis); si es algo del mundo compartido, plant_rumor. Si no lo das por bueno, dilo en la narración.',
  memory: 'Lo que un NPC recordará del actor va en npc_memory_note de este mismo cierre (una frase en tercera persona); sin eso, lo olvida.',
  debt: 'Una deuda o un fiado lo apunta set_debt (o pawn_item si deja prenda, settle_debt si paga); mover un objeto no lo registra.',
};

export function stateRejection(miss: StateMiss): string {
  return `La narración da por hecho «${miss.phrase}» y en este turno no ha pasado por su tool: lo que no pasa por un tool no ha ocurrido. ${STATE_HINT[miss.kind]} Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Tool fallido narrado como hecho (arreglo 5)
// ---------------------------------------------------------------------------

/** Verbos que cuentan el efecto de cada tool de escritura como hecho (como scripts/judge.ts, sin tildes). */
const FAILED_EFFECT: Record<string, RegExp> = {
  transfer_item: /\b(te (?:da|entrega|tiende|pasa|vende)|recibes|coges|tomas|recoges|guardas|metes|le das|le entregas|entregas)\b/,
  buy_item: /\b(te (?:da|entrega|tiende|pasa|vende|cobra|sirve|pone)|recibes|compras|pagas)\b/,
  sell_item: /\b(vendes|te (?:paga|da)|cobras|le (?:das|entregas))\b/,
  pawn_item: /\b(empenas|en prenda|le (?:das|dejas|entregas)|te (?:da|entrega|fia))\b/,
  give_coins: /\b(pagas|le das|le dejas|le pasas|entregas)\b[^.;:]{0,30}\b(monedas?|cobres?|platas?|oros?)\b/,
  take_coins: /\b(te (?:haces|quedas) con|coges|tomas|vacias)\b[^.;:]{0,30}\b(monedas?|cobres?|platas?|oros?|bolsa)\b/,
  spawn_item: /\b(encuentras|recibes|aparece|te (?:da|entrega))\b/,
  move_to: /\b(llegas|entras|cruzas|alcanzas|te plantas|subes|bajas)\b/,
  attack: /\b(golpeas|impactas|hieres|derribas|le (?:das|clavas|abres))\b/,
  heal: /\b(curas|sanas|recuperas|cierras la herida|te vendas|le vendas)\b/,
  set_debt: /\b(fiad[oa]|te lo fio|queda apuntad[oa]|te lo apunto)\b/,
  settle_debt: /\b(saldad[ao]|pagas|liquidas|cancelas la deuda|en paz)\b/,
  harvest: /\b(recoges|arrancas|cortas|cosechas|pescas|talas)\b/,
  cast_spell: /\b(lanzas|conjuras|invocas)\b/,
  take_rest: /\b(descansas|duermes|te duermes|pasas la noche)\b/,
  use_item: /\b(bebes|te bebes|enciendes)\b/,
  discover_spot: /\b(descubres|encuentras|hallas)\b/,
};
/** Lo que niega o deja en intento (scripts/judge.ts). */
const FAILED_NEGATION = /\b(no|nunca|sin|ni|tampoco|nadie|nada|niega|rechaza|imposible|apenas|intentas|intenta|quieres|podrias)\b/;

export interface FailedTool { name: string; error: string }

/** Frases sueltas (por punto) sin lo citado. */
const sentencesOf = (t: string) => norm(t).replace(/«[^»]*»/g, ' . ').split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/**
 * Tools de escritura que han fallado en este cierre (y no se repitieron bien después) cuyo efecto la narración da
 * por hecho: transfer_item devuelve no_space y «tomas uno de los eslabones» (explorador, acción 16 de la tanda
 * 20261125-1051), o «tienes las manos ocupadas, así que los guardas en la mochila» (dirigido, turno 18).
 */
export function failedToolNarrated(input: { narration: string; failed: readonly FailedTool[]; okTools: readonly string[] }): { name: string; error: string; phrase: string } | null {
  const last = new Map<string, string>();
  for (const f of input.failed) last.set(f.name, f.error);
  for (const [name, error] of last) {
    const re = FAILED_EFFECT[name];
    if (!re) continue;
    const s = sentencesOf(input.narration).find((x) => { const m = re.exec(x); return m !== null && !FAILED_NEGATION.test(x.slice(0, m.index)); });
    if (s) return { name, error, phrase: s.replace(/[.!?…]+$/, '') };
  }
  return null;
}

export function failedToolRejection(hit: { name: string; error: string; phrase: string }): string {
  return `${hit.name} ha fallado en este turno (${hit.error}) y la narración lo da por hecho: «${hit.phrase}». Lo que falla no ha ocurrido. Narra que no puede y por qué (con lo que dijo el error y sus opciones), o arregla lo que falta y vuelve a llamar a ${hit.name} antes de cerrar. Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Desenlace contra la tirada enfrentada de una reacción (arreglo 2)
// ---------------------------------------------------------------------------

/** Lo que cuenta que no lo consigue: la mano que se queda a un dedo, el otro que se libra. */
const NARRATES_FAIL = /\b(tu mano se (?:detiene|queda|para)|se te escapa|no (?:llegas|consigues|logras|alcanzas)|a un dedo de|a un palmo de|se (?:te )?cierra en el aire|te quedas con las manos vacias|retiras la mano vacia|sin tocar(?:le|la|lo)?|se libra|se zafa|te aparta la mano)\b/;
/** Lo que cuenta que lo consigue cuando ha perdido. */
const NARRATES_WIN = /\b(lo consigues|te haces con|ya es tuy[oa]|cae en tu (?:mano|palma)|te lo llevas|se lo quitas|le quitas|le arrebatas|no se entera|no nota nada|no se da cuenta|lo derribas|le derribas|lo tumbas|le tumbas)\b/;

/**
 * El servidor resolvió la reacción de otro jugador (resiste y gana, o pierde) y la narración cuenta lo contrario:
 * «Juego de manos 13 contra Percepción 5: ganas tú. Lo consigues.» y «Tu mano se detiene a un dedo de su cinto»
 * (pareja pícaro con novato, acción 36 de 20261125-1115). Lo que hace el otro al resistirse («aparta la bolsa con el
 * codo») sí se cuenta. Devuelve la frase contraria, o null.
 */
export function reactionOutcomeMismatch(won: boolean, narration: string): string | null {
  // «No lo consigues» o «no llegas» son el fallo mismo: la negación va dentro de la frase buscada.
  for (const c of clauses(outsideQuotes(narration))) {
    const m = (won ? NARRATES_FAIL : NARRATES_WIN).exec(c);
    if (m && !(won ? /\b(?:casi|como si)\b[^,]{0,15}$/ : NEGATED_JUST_BEFORE).test(c.slice(0, m.index))) return m[0];
  }
  return null;
}

export function reactionOutcomeRejection(won: boolean, phrase: string, rolls?: string): string {
  const dice = rolls ? ` (${rolls})` : '';
  return won
    ? `El servidor ya ha resuelto la reacción: el otro jugador se resistió y ha PERDIDO la tirada enfrentada${dice}, así que el actor lo CONSIGUE. La narración dice «${phrase}», que es lo contrario. Cuenta que lo consigue (si le quita algo, transfer_item o take_coins ahora); lo que hizo el otro al resistirse se puede contar. Reescribe log_event.`
    : `El servidor ya ha resuelto la reacción: el otro jugador ha GANADO la tirada enfrentada${dice}, así que el actor NO lo consigue. La narración dice «${phrase}», que es lo contrario. Cuenta que no lo consigue. Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Golpe de un NPC sin attack (arreglo 12)
// ---------------------------------------------------------------------------

const NPC_WEAPON = '(?:martillo|maza|mazo|garrote|porra|cachiporra|tranca|culata|baston|hacha|espada|daga|cuchillo|navaja|lanza|jarra|puno|punos|codo|rodilla|bota|cabeza|hoja|filo|acero|piedra|zarpa|colmillos|dientes)';
const NPC_BODY = '(?:cara|nariz|boca|brazo|costilla|costillas|costado|craneo|cabeza|sien|frente|ceja|pomulo|labio|mandibula|cuello|hombro|pecho|estomago|vientre|espalda|rinones|pierna|rodilla|muneca)';
/** Un NPC que pega al actor: «te mete el martillo en las costillas», «la maza te entra en la sien», «te golpea». */
const NPC_HITS_YOU = new RegExp([
  String.raw`\bte (?:mete|clava|hunde|estrella|descarga|planta|suelta|asesta|arrea|atiza|propina|casca|sacude|lanza|da|pega)\b[^.;:]{0,30}\b(?:${NPC_WEAPON}|${BLOW}|golpe)\b`,
  String.raw`\bte (?:golpea|hiere|muerde|apunala|acuchilla|raja|derriba|tumba)\b`,
  String.raw`\bte (?:alcanza|acierta|parte|rompe|revienta) (?:de lleno )?(?:en )?(?:la|el|las|los) ${NPC_BODY}\b|\bte da (?:de lleno )?en (?:la|el|las|los) ${NPC_BODY}\b`,
  String.raw`\b(?:${NPC_WEAPON}|golpe|${BLOW})\b[^.;:]{0,20}\bte (?:entra|da|alcanza|golpea|acierta|abre|parte|revienta|impacta)\b`,
  String.raw`\b(?:recibes|encajas|te llevas) (?:un|una|el|la) (?:${BLOW}|golpe|${NPC_WEAPON})\b`,
].join('|'));
/** Lo que no llega a ser golpe: amenaza, amago, casi, si, o lo esquiva. */
const HIT_NOT_DONE = /\b(no|ni|casi|amag\w*|amenaz\w*|intenta\w*|pretende|a punto de|si|como si|esquivas|fallas|falla|se queda corto|no llega)\b/;

/** Un NPC presente como lo puede nombrar la narración. */
export interface NpcRef { id: string; refs: readonly string[] }

/**
 * La narración pone a un NPC a pegarle al actor y ese NPC no ha hecho su turno con attack (ni hay conflict_act):
 * el daño se aplica de palabra. Violento, turno 3 de 20261125-1652: Atletismo 11, éxito, y «Hugo no forcejea: se
 * suelta de un tirón y te mete el martillo de fragua en las costillas» (14 → 11 PG sin tirada). Quien pega es el NPC
 * nombrado en la frase antes del golpe o, si no se nombra a nadie, el último nombrado antes. Devuelve el NPC y la
 * frase, o null.
 */
export function npcHitWithoutAttack(input: { narration: string; npcs: readonly NpcRef[]; struck: ReadonlySet<string> }): { npc_id: string; phrase: string } | null {
  if (!input.npcs.length) return null;
  const people = input.npcs.map((n) => {
    const list = n.refs.map((r) => norm(r).replace(/^(?:el|la|los|las|un|una) /, '').trim()).filter((r) => r.length >= 3).map(esc).sort((a, b) => b.length - a.length);
    return { id: n.id, re: list.length ? new RegExp(`\\b(?:${list.join('|')})\\b`, 'g') : null };
  });
  const named = (c: string, upTo: number) => {
    let who: string | null = null; let at = -1;
    for (const p of people) for (const x of p.re ? c.matchAll(p.re) : []) if (x.index! > at && x.index! < upTo) { who = p.id; at = x.index!; }
    return who;
  };
  let last: string | null = null;
  for (const c of clauses(outsideQuotes(input.narration))) {
    const m = NPC_HITS_YOU.exec(c);
    if (m && !HIT_NOT_DONE.test(c.slice(0, m.index))) {
      const npc = named(c, m.index) ?? last;
      if (npc && !input.struck.has(npc)) return { npc_id: npc, phrase: m[0] };
    }
    // El último nombrado en la frase es el sujeto que hereda la siguiente si no nombra a nadie.
    last = named(c, Infinity) ?? last;
  }
  return null;
}

export function npcHitRejection(name: string, npcId: string, phrase: string, actorId: string): string {
  return `La narración dice que ${name} le pega al actor («${phrase}») y ${name} no ha hecho su turno: el golpe de ${name} pasa por attack (attacker_id ${npcId}, target_id ${actorId}). El servidor tira el ataque contra su CA y aplica el daño si impacta; narra lo que devuelva. Si no llega a pegarle (amaga, se contiene, le aparta), cuéntalo así. Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// settle_debt y set_debt que no cuadran con lo narrado (arreglo 17)
// ---------------------------------------------------------------------------

const NUM_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, ciento: 100, doscientas: 200, trescientas: 300, quinientas: 500,
};

/** Cantidades de dinero en un texto ya normalizado («uno de oro y cinco de plata», «30 de cobre», «diez monedas»), con su sitio. */
export function moneyAmounts(text: string, cur: readonly { name: string; value: number }[]): { at: number; end: number; value: number }[] {
  const names = cur.map((d) => esc(norm(d.name)));
  const num = String.raw`(\d+|${Object.keys(NUM_WORDS).join('|')})`;
  const re = new RegExp(String.raw`\b${num} (?:monedas? |piezas? )?de (${names.join('|')})\b|\b${num} monedas?\b`, 'g');
  const n = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM_WORDS[s] ?? 0);
  const parts: { at: number; end: number; value: number; coin: boolean }[] = [];
  for (const m of text.matchAll(re)) {
    const coin = Boolean(m[1]);
    const value = coin ? n(m[1]!) * (cur.find((d) => norm(d.name) === m[2])?.value ?? 1) : n(m[3]!);
    const prev = parts.at(-1);
    // «uno de oro y cinco de plata»: una sola cantidad (solo entre monedas con su metal).
    if (prev && prev.coin && coin && /^\s*(?:,|y)\s*$/.test(text.slice(prev.end, m.index))) { prev.value += value; prev.end = m.index! + m[0].length; }
    else parts.push({ at: m.index!, end: m.index! + m[0].length, value, coin });
  }
  return parts.map(({ at, end, value }) => ({ at, end, value }));
}

/** Lo que el actor entrega («pagas», «vacías», «le das», o quien cobra «los barre», «se queda con»). */
const HANDS_OVER = /\b(pagas|das|le das|entregas|dejas|vacias|vuelcas|pones|cuentas|sueltas|le pasas|barre|recoge|se queda con|cobra|se guarda|se embolsa)\b/;
/** Todo lo que lleva: «vacías el oro y la plata», «vuelcas la bolsa», «hasta la última moneda». */
const ALL_COINS = /\b(?:vacias|vuelcas) (?:la|tu) bolsa\b|\btodo (?:tu|el|lo que llevas)(?: dinero| oro)?\b|\bel oro y la plata\b|\btodas tus monedas\b|\bhasta la ultima moneda\b|\btu bolsa (?:queda )?vacia\b/;
/** Lo que queda de deuda («debes ahora uno de oro y cinco de plata», «te faltan diez de plata»). */
const STILL_OWES = /\b(?:debes|me debes|le debes|quedas a deber|te queda(?:n)? por pagar|te falta(?:n)?|queda(?:n)? de (?:la )?deuda)\b/;
/** Deuda cerrada. */
const SETTLED = /\b(saldad[oa]|estais en paz|estas en paz|no (?:le |me )?debes nada|cuentas claras|deuda (?:queda )?cerrada)\b/;

/**
 * settle_debt y set_debt cuadrados con lo narrado en el mismo cierre: lo que se paga, lo que queda de deuda y si se
 * da todo lo que lleva. Pareja de Opus (20261125-1703, turno 5): «Vacías el oro y la plata sobre la tablilla; él los
 * barre con la palma» y settle_debt cobra 150. Devuelve el motivo, o null.
 */
export function debtMismatch(input: {
  narration: string; cur: readonly { name: string; value: number }[]; fmt: (n: number) => string;
  settle?: { paid: number; remaining: number; coins_left: number } | null; set?: { amount: number; owes: number } | null;
}): string | null {
  if (!input.settle && !input.set) return null;
  for (const c of clauses(outsideQuotes(input.narration))) {
    const amounts = moneyAmounts(c, input.cur);
    const owes = STILL_OWES.exec(c);
    if (owes && !/\b(no|ni)\b[^,]{0,10}$/.test(c.slice(0, owes.index))) {
      const a = amounts.find((x) => x.at > owes.index);
      if (a) {
        const said = c.slice(owes.index, a.end);
        if (input.settle && a.value !== input.settle.remaining) return `la narración dice que queda de deuda ${input.fmt(a.value)} («${said}») y tras settle_debt quedan ${input.fmt(input.settle.remaining)}`;
        if (!input.settle && input.set && a.value !== input.set.owes && a.value !== input.set.amount) return `la narración apunta ${input.fmt(a.value)} («${said}») y set_debt deja la deuda en ${input.fmt(input.set.owes)}`;
        continue;
      }
    }
    const settled = SETTLED.exec(c);
    if (input.settle && settled && input.settle.remaining > 0 && !/\b(no|ni|todavia|aun)\b/.test(c.slice(0, settled.index))) return `la narración da la deuda por saldada («${settled[0]}») y tras settle_debt quedan ${input.fmt(input.settle.remaining)}`;
    const gives = HANDS_OVER.exec(c);
    if (input.settle && gives && !/\b(no|ni|si|quieres|ofreces|propones)\b/.test(c.slice(0, gives.index))) {
      const all = ALL_COINS.exec(c);
      if (all && input.settle.coins_left > 0) return `la narración dice «${all[0]}» (todo lo que lleva) y settle_debt ha cobrado ${input.fmt(input.settle.paid)}: le quedan ${input.fmt(input.settle.coins_left)} en la bolsa`;
      const a = amounts[0];
      if (a && a.value !== input.settle.paid) return `la narración paga ${input.fmt(a.value)} («${c.slice(a.at, a.end)}») y settle_debt ha cobrado ${input.fmt(input.settle.paid)}`;
    }
  }
  return null;
}

export function debtRejection(why: string, tool: 'settle_debt' | 'set_debt'): string {
  return `${tool} y la narración no cuadran: ${why}. El estado manda: narra lo que ha movido el servidor (lo pagado, lo que queda de deuda, lo que le queda en la bolsa) o vuelve a llamar a ${tool} con la cantidad que narras. Reescribe log_event.`;
}

// ---------------------------------------------------------------------------
// Tanda 5 (arreglos 24, 26, 27, 28 y 29): lo que el jugador pide con las palabras justas y el máster acepta de palabra
// ---------------------------------------------------------------------------

const bareText = (t: string) => norm(t).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Lo que dicen los demás en el cierre, frase a frase y sin preguntas: la narración fuera de lo que cita del actor
 * (sus palabras entre «», que suelen repetir la acción, a veces recortadas con «…») y lo que dicen los NPC.
 */
function othersSay(input: { action: string | null; narration: string; lines?: readonly DialogueLine[] }): string[] {
  const actorTexts = [input.action ?? '', ...(input.lines ?? []).filter((l) => l.speaker === 'actor').map((l) => l.text)].map(bareText).filter(Boolean);
  const isActor = (q: string) => {
    const b = bareText(q);
    if (!b) return true;
    if (actorTexts.some((a) => a.includes(b) || b.includes(a))) return true;
    // Recortada o retocada: casi todas sus palabras están en lo que escribió el jugador.
    const words = b.split(' ').filter((w) => w.length > 2);
    return words.length >= 3 && actorTexts.some((a) => { const have = new Set(a.split(' ')); return words.filter((w) => have.has(w)).length / words.length >= 0.8; });
  };
  const noQ = (s: string) => s.replace(/¿[^?]*\?/g, ' . ');
  const narr = noQ(norm(input.narration).replace(/«([^»]*)»|“([^”]*)”/g, (_m, a: string | undefined, b: string | undefined) => (isActor(a ?? b ?? '') ? ' . ' : `. ${a ?? b ?? ''} .`)));
  const npc = (input.lines ?? []).filter((l) => l.speaker === 'npc').map((l) => noQ(norm(l.text)));
  return [...clauses(narr), ...npc.flatMap(clauses)];
}

/** Negación o duda en la frase: no acepta nada. */
const ACCEPT_NOT = /\b(no|ni|nunca|jamas|tampoco|nadie|nada|si|quiza\w*|tal vez|podria\w*|ojala)\b/;
/** Una frase corta que solo dice que sí («De acuerdo», «Vale, muchacha»). */
const BARE_YES = /^(?:de acuerdo|esta bien|vale|hecho|sea|venga|bueno|trato hecho)(?:,? \w+){0,2}$/;

// --- Arreglo 24: fiar es set_debt o no es --------------------------------------------------------------------------

/** El jugador pide fiado: «apúntamela», «te la pago mañana», «a cuenta», «fíame». */
const WANTS_CREDIT = /\b(?:apunt(?:a|as|ame|amela|amelo|amelas|amelos|alo|ala)|anot(?:a|ame|amela|amelo|alo|ala)|fia(?:me|mela|melo|r|rme|rmela|rmelo)|fiad[oa]s?|me (?:lo |la )?fias|a cuenta|en (?:la|mi) cuenta|a deber|(?:te|se) (?:lo |la |los |las )?(?:pago|pagare|devuelvo) (?:manana|luego|otro dia|el \w+|cuando|a la vuelta|pasado|en cuanto)|(?:lo|la|los|las) pago (?:manana|luego|cuando|en cuanto))\b/;
/** El NPC lo acepta: «te lo apunto», «mañana, entonces», «me la pagas mañana», «a tu cuenta». */
const ACCEPTS_CREDIT = /\b(?:te (?:lo |la |los |las )?apunt[oa]|(?:lo|la|se lo|se la) apunt[ao]|apuntad[oa]s?|anotad[oa]s?|lo anot[oa]|te (?:lo |la |los |las )?fi[oa]|fiad[oa]s?|a tu cuenta|en tu cuenta|(?:hasta )?manana,? entonces|hasta manana|(?:me )?(?:lo |la |los |las )?pagas (?:manana|luego|cuando|otro dia)|manana me (?:lo |la |los |las )?pagas|pagame (?:manana|cuando|luego)|ya me (?:lo |la )?pagaras|me (?:lo |la |los |las )?pagaras|cuando puedas|confio en ti)\b/;
/** No fía, en cualquier frase del cierre: entonces no hay trato, diga lo que diga después («Aquí se paga en mano. Hasta mañana»). */
const REFUSES_CREDIT = /\bno\b[^.;:]{0,30}\b(?:fi[aeo]\w*|apunt\w*|anot\w*|cuenta|deb\w*|cobr\w*)\b|\b(?:se paga (?:antes|en mano|al contado|por adelantado|aqui)|en mano|al contado|por adelantado|aqui se paga|sin fiar)\b/;
/** Tools que dejan el fiado (o el pago) en el estado. */
const CREDIT_TOOLS = ['set_debt', 'pawn_item', 'settle_debt', 'buy_item', 'give_coins'];

/**
 * El jugador pide fiado y el NPC lo acepta sin set_debt: «¿Me apuntas una cerveza, que te la pago mañana?» → «Mañana,
 * entonces» (deudor, tanda 20261126-0602, turno 1). Rechazar el fiado («aquí no se apunta nada») pasa sin tool.
 * Devuelve la frase que lo acepta, o null.
 */
export function creditWithoutDebt(input: { action: string | null; narration: string; lines?: readonly DialogueLine[]; okTools: readonly string[]; pendingRoll?: boolean }): string | null {
  if (input.pendingRoll || !input.action || input.okTools.some((t) => CREDIT_TOOLS.includes(t))) return null;
  if (!WANTS_CREDIT.test(norm(input.action))) return null;
  const said = othersSay(input);
  if (said.some((c) => REFUSES_CREDIT.test(c))) return null;
  for (const c of said) {
    if (ACCEPT_NOT.test(c)) continue;
    const m = ACCEPTS_CREDIT.exec(c) ?? BARE_YES.exec(c);
    if (m) return m[0];
  }
  return null;
}

export function creditRejection(phrase: string): string {
  return `El jugador pide fiado y la narración lo acepta («${phrase}») sin set_debt: lo que no pasa por un tool no ha ocurrido. Si el NPC fía, llama a set_debt (npc_id de quien fía, amount en cobre con el precio de lo que se lleva, due_in_hours si dice cuándo: «mañana» son 24) y, si le sirve algo, transfer_item; si deja algo en prenda, pawn_item. Si no fía, que lo diga en la narración, sin tool. Reescribe log_event.`;
}

// --- Arreglo 27: citas con hora --------------------------------------------------------------------------------------

/** El jugador propone verse a una hora: «quedamos mañana al alba junto al pozo», «nos vemos a las ocho». */
const WANTS_MEET = /\b(?:quedamos|quedar|nos vemos|vernos|nos encontramos|te espero|esperame|me esperas|espereme|cita|vente|ven(?:id)? (?:manana|al alba|a las|esta noche)|(?:manana|al alba|al amanecer|esta noche|a las \w+)\b[^.;:]{0,25}\b(?:aqui|alli|junto al?|en el|en la))\b/;
const MEET_TIME = /\b(?:manana|pasado manana|al alba|al amanecer|al anochecer|al atardecer|a medianoche|a mediodia|esta noche|esta tarde|a las (?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|\d{1,2})|al toque|(?:en|tras|despues de|antes de) (?:la|el) (?:misa|mercado|rezo|cena|toque))\b/;
/** El NPC se compromete: «ya estaré junto al pozo», «allí estaré», «te espero», «al alba, entonces». */
const ACCEPTS_MEET = /\b(?:(?:alli|ahi|aqui|ya) estare|estare (?:alli|ahi|aqui|junto|en|a)|te esperare|te espero|nos vemos|alli nos vemos|no faltare|cuenta conmigo|alli ire|ire (?:sin falta|alli|al)|hasta (?:manana|el alba|entonces|la misa)|(?:al alba|manana|a las \w+|tras la misa),? entonces)\b/;
/** Lo rechaza: entonces no hay cita (lo que diga después no la cierra). */
const REFUSES_MEET = /\bno (?:puedo|podre|ire|voy|vendre|estare|quedo|me veras|me esperes|cuentes conmigo)\b|\bolvidalo\b/;

/**
 * Un NPC acepta una cita con hora sin schedule_event: «Mañana, al alba, aquí junto al pozo» → «a la misa de las ocho
 * ya estaré junto al pozo» (cronista, tanda 20261126-0602, turno 6). Si la rechaza, pasa. Devuelve la frase, o null.
 */
export function meetingWithoutSchedule(input: { action: string | null; narration: string; lines?: readonly DialogueLine[]; calledTools: readonly string[]; pendingRoll?: boolean }): string | null {
  if (input.pendingRoll || !input.action || input.calledTools.includes('schedule_event') || input.calledTools.includes('set_npc_order')) return null;
  const a = norm(input.action);
  if (!WANTS_MEET.test(a) || !MEET_TIME.test(a)) return null;
  const said = othersSay(input);
  if (said.some((c) => REFUSES_MEET.test(c))) return null;
  for (const c of said) {
    // «No faltaré» niega y acepta a la vez: cuenta como sí.
    if (ACCEPT_NOT.test(c.replace(/\bno faltare\b/g, ' '))) continue;
    const m = ACCEPTS_MEET.exec(c) ?? BARE_YES.exec(c);
    if (m) return m[0];
  }
  return null;
}

export function meetingRejection(phrase: string): string {
  return `El NPC acepta una cita con hora («${phrase}») y no se ha programado: sin schedule_event, a esa hora no va nadie. Llama a schedule_event (title corto, de cosa y sin el nombre de quien acude: «la charla junto al pozo»; recurrence once; days_from_now 1 si es mañana; start_hour: el alba son las 6, «las ocho» las 8; duration_min 30; npc_ids con quien queda; told_actor true; si ya hay uno con ese título en ese sitio, lo devuelve y apunta que el actor lo sabe). Si no queda, que el NPC lo diga. Reescribe log_event.`;
}

// --- Arreglo 28: lookup_rule cuando el jugador pregunta por una regla ---------------------------------------------

const RULE_EXPLICIT = /\b(?:segun (?:las |los )?(?:reglas|manuales?|reglamento|normas)|que dicen las reglas|cual es la regla|hay (?:alguna )?regla|por (?:las )?reglas)\b/;
const RULE_HOW = /\bcuant[oa]s? (?:dias|horas|millas|leguas|kilometros|kilos|libras|pies|asaltos|turnos|minutos|conjuros|hechizos|espacios|veces|pg|puntos)\b|\bcuanto (?:aguanta\w*|tarda\w*|pesa\w*|cura\w*|dura\w*|se anda|se tarda|puedo (?:llevar|cargar|andar|aguantar))\b|\bcada cuanto\b|\bcomo funciona\w*\b/;
/** Temas con regla en el manual y la consulta en inglés que la encuentra. */
const RULE_TOPICS: { re: RegExp; query: string }[] = [
  { re: /\b(?:comer|comida|beber|bebida|hambre|sed|raciones?|sin agua)\b/, query: 'food and water' },
  { re: /\b(?:viaj\w*|millas?|leguas?|andar|se andan|se recorren|camin\w*|marcha|paso (?:normal|rapido|lento))\b/, query: 'travel pace' },
  { re: /\b(?:descans\w*|dormir|duerm\w*|sueno)\b/, query: 'short rest long rest' },
  { re: /\b(?:carg\w*|peso|pesa\w*|llevar encima)\b/, query: 'carrying capacity' },
  { re: /\b(?:conjur\w*|hechiz\w*|espacios? de conjuro)\b/, query: 'casting a spell spell slots' },
  { re: /\b(?:agotamiento|agotad\w*)\b/, query: 'exhaustion' },
  { re: /\b(?:nadar|trepar|escalar|saltar)\b/, query: 'climbing swimming jumping' },
  { re: /\b(?:caida|caer)\b/, query: 'falling' },
];

/**
 * El jugador pregunta por una regla («Hugo, ¿cuántos días aguanta un hombre sin comer ni beber según las reglas?»,
 * «¿cuántas millas se andan en un día de viaje a paso normal?»: herido, tanda 20261126-0602, nueve veces) y el
 * cierre no la ha consultado. Devuelve la consulta en inglés que la encuentra, o null.
 */
export function ruleQuestionWithoutLookup(input: { action: string | null; calledTools: readonly string[] }): { query: string } | null {
  if (!input.action || input.calledTools.includes('lookup_rule')) return null;
  const a = norm(input.action);
  if (!/[?¿]/.test(input.action) && !/\b(?:pregunto|pregunta)\b/.test(a)) return null;
  const topic = RULE_TOPICS.find((t) => t.re.test(a));
  if (!RULE_EXPLICIT.test(a) && !(RULE_HOW.test(a) && topic)) return null;
  return { query: topic?.query ?? 'el tema, en inglés' };
}

export function ruleQuestionRejection(q: { query: string }): string {
  return `El jugador pregunta por una regla y no la has consultado. Llama a lookup_rule (query en inglés, por ejemplo "${q.query}"; devuelve hasta 3 fragmentos del Player's Handbook o la Dungeon Master's Guide, o te dice que no hay manuales y resuelves con tu criterio) y contesta con lo que diga, con la voz del NPC o del narrador y en la ficción, sin citar el manual. Reescribe log_event.`;
}

// --- Arreglo 29: «esconder» no es robar ------------------------------------------------------------------------------

/** Robar, en la acción («le robo», «le corto la bolsa», «meto la mano en su bolsa»). */
const THEFT_WORDS = /\b(?:rob\w*|hurt\w*|birl\w*|mang\w*|sise\w*|afan\w*|sustra\w*|desvalij\w*|arrebat\w*|quitarle|quitarsel\w*|le quito|se lo quito|se la quito|me lo quedo|me la quedo|le cojo|cojo su|cogerle|meto la mano en su|meterle la mano|cortarle la bolsa|corto su bolsa|le corto la bolsa|le saco|sacarle|registr\w*)\b/;
/** Lo que teme que le roben, o lo que le han robado a él: no es robar («por si alguien me roba»). */
const FEARS_THEFT = /\b(?:por si|para que no|que no|no vaya a ser que|no sea que)\b[^.;:]{0,40}?\b(?:rob\w*|quit\w*|birl\w*)|\b(?:alguien|nadie|cualquiera|ladron\w*|rateros?) (?:me |nos |te )?(?:rob\w*|quit\w*|birl\w*)|\bme (?:han |habian )?rob\w*/g;
/** Sus propias monedas: «mis monedas», «mi bolsa», «las escondo al fondo de la mochila». */
const OWN_COINS = /\b(?:mis (?:monedas|cobres|platas|oros|ahorros|dineros?|cuartos)|mi (?:bolsa|dinero|plata|monedero|faltriquera|bolsita)|(?:escond\w*|guard\w*|pas\w*|met\w*)\b[^.;:]{0,50}\b(?:mochila|zurron|bota|forro|faltriquera|bolsillo))\b/;

/** ¿La acción declara un robo? Lo que teme que le roben a él no cuenta. */
export function declaresTheft(action: string | null | undefined): boolean {
  return Boolean(action) && THEFT_WORDS.test(norm(action!).replace(FEARS_THEFT, ' '));
}

/**
 * El jugador mueve su propio dinero («Saco mis monedas de la bolsa y las escondo al fondo de la mochila, por si alguien
 * me roba»: deudor, tanda 20261126-0602, turno 32, que el máster convirtió en robarle la bolsa a la tabernera).
 */
export function movesOwnCoins(action: string | null | undefined): boolean {
  if (!action) return false;
  const a = norm(action);
  return OWN_COINS.test(a) && /\b(?:monedas?|cobres?|platas?|oros?|dineros?|ahorros|bolsa|monedero)\b/.test(a) && !declaresTheft(action);
}

// --- Arreglo 26: encargos del tablón que se cobran ------------------------------------------------------------------

/** El jugador da el encargo por hecho o lo cobra: «ya lo tienes», «aquí está lo que pediste», «la leña está en la puerta». */
const CLAIMS_JOB = /\b(?:ya (?:lo |la |los |las )?(?:tienes|tiene|tengo|traigo)|aqui (?:esta|estan|tienes|tiene)\b|lo que (?:me )?(?:pediste|pedias|pedia|pidio|encargaste|encargo)|(?:esta|estan|queda|quedan) (?:hech[oa]s?|en (?:la|tu|su) puerta|apilad[oa]s?|entregad[oa]s?|list[oa]s?)\b|(?:lena|encargo|trabajo|recado) (?:hech[oa]|cumplid[oa]|terminad[oa])|te (?:traigo|entrego) (?:lo|la|los|las|el|tu|tus)\b|vengo a cobrar|cobro (?:el|mi) (?:encargo|paga|trabajo)|cobrar el encargo|(?:me )?(?:pagas|debes|debe) el (?:encargo|pago|trabajo)|quiero (?:mi|la) paga|mi paga|el pago del encargo)\b/;
/** El NPC lo da por cumplido o paga: «aquí tienes tu paga», «buen trabajo», «te lo has ganado». */
const TELLS_JOB_PAID = /\b(?:te (?:paga|pago|has ganado|lo has ganado)|aqui tienes tu (?:paga|parte|recompensa|dinero)|toma tu (?:paga|recompensa|parte)|buen trabajo|bien hecho|encargo cumplido|cumplid[oa] el encargo)\b/;

export interface JobAtHand {
  id: string; title: string; giver: string; wants: string | null;
  /** Palabras que lo nombran (del título y de lo que pide), sin tildes: «lena», «posada», «madera». */
  words?: readonly string[];
}
/** Palabras del tablón: sin ellas ni las del encargo, «ya lo tengo» o «aquí tienes» hablan de otra cosa. */
const JOB_WORDS = /\b(?:encargos?|tablon|recompensa)\b/;

/**
 * Con un encargo del tablón sin cobrar y quien lo pidió delante, el jugador lo da por hecho («Ya tengo la leña del Soto»,
 * cronista, tanda 20261126-0602, turnos 4, 14, 24 y 34) o el NPC lo paga de palabra, y el cierre no lleva complete_job.
 * Lo decide el servidor (comprueba que trae lo pedido): se rechaza una vez para que lo intente. Devuelve la frase, o null.
 */
export function jobClaimWithoutComplete(input: { action: string | null; narration: string; lines?: readonly DialogueLine[]; okTools: readonly string[]; failedTools?: readonly string[]; jobs: readonly JobAtHand[]; pendingRoll?: boolean }): string | null {
  if (input.pendingRoll || !input.jobs.length || input.okTools.includes('complete_job') || input.failedTools?.includes('complete_job')) return null;
  const words = input.jobs.flatMap((j) => j.words ?? []).filter((w) => w.length >= 4).map(esc);
  const named = (t: string) => JOB_WORDS.test(t) || (words.length > 0 && new RegExp(String.raw`\b(?:${words.join('|')})\b`).test(t));
  const said = othersSay(input);
  const action = norm(input.action ?? '');
  // El encargo lo nombra el jugador al darlo por hecho, o el NPC al pagarlo: la sala (la fragua de Hugo) no cuenta.
  const claim = named(action) ? CLAIMS_JOB.exec(action.replace(/¿[^?]*\?/g, ' . ')) : null;
  if (claim) return claim[0];
  for (const c of said) {
    if (ACCEPT_NOT.test(c) || !(named(c) || named(action))) continue;
    const m = TELLS_JOB_PAID.exec(c);
    if (m) return m[0];
  }
  return null;
}

export function jobClaimRejection(phrase: string, jobs: readonly JobAtHand[]): string {
  const list = jobs.map((j) => `«${j.title}» (job_id ${j.id}, lo pidió ${j.giver}${j.wants ? `, pide ${j.wants}` : ''})`).join('; ');
  return `El jugador da por hecho un encargo («${phrase}») y no se ha cobrado: un encargo del tablón lo cierra complete_job (character_id del actor, job_id, npc_id de quien lo pidió), que comprueba que trae lo pedido, se lo quita y le paga. Encargos sin cobrar de quien está aquí: ${list}. Si el servidor dice que falta algo, o no es el encargo de nadie de aquí, que el NPC lo diga. Reescribe log_event.`;
}
