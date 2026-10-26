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
const DEAL = /\b((?:en|como|de) (?:prenda|fianza)|acept\w* (?:la|tu|su|el|esa|ese) (?:prenda|fianza|trato|oferta|fiado|deuda)|fiad[oa]s?|te (?:lo |la |los |las )?fio|fiarte|te (?:lo |la )?apunto|lo apunto|queda apuntad[oa]|queda anotad[oa]|apuntalo|apuntamelo|anotalo|trato hecho|hecho el trato|cerramos el trato|cerrado el trato|a cambio de|te debo|me debes|me deberas|quedas a deber|empen(?:a|as|o|e|aste|ado|ada)\b(?! en\b))/;
/** Lo que niega, rechaza, pregunta u ofrece: no cierra nada. */
const NOT_CLOSED = /\b(no|ni|nunca|jamas|sin|niega\w*|rechaza\w*|tampoco|nadie|nada|ofreces|ofrece|propones|propone|pides|pide|preguntas|pregunta|quieres|quiere|si|tal vez|quiza\w*|podria\w*|espera\w*|piensa\w*|pesando|ya tengo|ya guarda|sigue\w*|hablamos)\b/;
/** Tools que dejan estado de un trato. */
export const DEAL_TOOLS = new Set(['set_debt', 'pawn_item', 'settle_debt', 'transfer_item', 'buy_item', 'sell_item', 'complete_job']);

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

/** Texto de relleno que no es narración («placeholder», «x», «...»): el jugador se quedaría sin respuesta. */
const PLACEHOLDER = /^(?:placeholder|x+|todo|tbd|n\/?a|lorem ipsum\b.*|texto|narracion|test|\.+|…|-+|_+|\?+)$/;

/** Campos del cierre que son relleno (vacío no cuenta: en conversación vale la narración vacía con lines). */
export function placeholderFields(fields: Record<string, string | null>): string[] {
  return Object.entries(fields).filter(([, v]) => v != null && v.trim() !== '' && PLACEHOLDER.test(norm(v.trim()))).map(([k]) => k);
}

export function placeholderRejection(fields: readonly string[]): string {
  return `${fields.join(', ')} es relleno («placeholder», «x»…), no narración: el jugador se quedaría sin respuesta. Reescribe log_event con la respuesta de verdad a su acción (si en conversación sobra la narración, déjala vacía y pon lo dicho en lines).`;
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
