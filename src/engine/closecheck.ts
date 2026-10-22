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
