/**
 * Lo que dice y lo que hace el jugador en una misma acción (fase 5 del plan de la reunión del 11-11-2026,
 * docs/PLAN-REUNION-2026-11-11.md, decisión «B más comillas»). La web tiene tres modos: Hacer, Decir y Chat.
 *
 *   - **Hacer**: lo que escribe es lo que hace. Lo que va entre comillas («…», "…", “…”) es lo que dice, tal cual: va a
 *     `lines` como línea del actor, palabra por palabra, y el máster no le pone en boca nada más.
 *   - **Decir**: todo el texto es su frase. El motor lo envuelve en comillas (`asSpeech`) y sigue el mismo camino que una
 *     acción: lo que hay es una frase, así que el máster no le mueve ni le hace coger nada.
 *   - **Chat**: entre jugadores, sin narrador (party.ts, `engine.say`).
 *
 * Sin comillas todo sigue como antes: lo que escribe es lo que hace, y si suena a hablar («pregunto a Brenna si tiene
 * trabajo») el máster lo pone en primera persona con sus palabras (closecheck.ts, `saidByPlayer`).
 */

export interface SaidDone {
  /** Los fragmentos entrecomillados, sin las comillas, en orden. */
  said: string[];
  /** Lo que queda fuera de las comillas: lo que hace. */
  done: string;
  /** Solo habla: todo el texto está entre comillas (o viene del modo Decir). */
  speech_only: boolean;
}

/** Un fragmento entre comillas: «…», "…" o “…”. Una « o “ sin cerrar llega hasta el final. */
const QUOTED = /«([^«»]*)(?:»|$)|“([^“”]*)(?:”|$)|"([^"]*)"/g;

/** Lo dicho y lo hecho en lo que escribe el jugador. */
export function splitSaidDone(text: string): SaidDone {
  const said: string[] = [];
  const done = text.replace(QUOTED, (_m, a?: string, b?: string, c?: string) => {
    const t = (a ?? b ?? c ?? '').trim();
    if (t) said.push(t);
    return ' ';
  }).replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:]+|[\s,]+$/g, '').trim();
  return { said, done, speech_only: said.length > 0 && !/\p{L}/u.test(done) };
}

/** ¿Lleva comillas (algo dicho tal cual)? */
export function hasQuotes(text: string): boolean {
  return /[«"“]/.test(text);
}

/**
 * El modo Decir: todo el texto es la frase. Se envuelve en «» salvo que ya venga entre comillas; una raya inicial
 * («— hola») se quita, que es la misma convención. Sin texto, cadena vacía.
 */
export function asSpeech(raw: string): string {
  let t = raw.trim().replace(/^[—–-]\s*/, '').trim();
  if (!t) return '';
  if (/^[«"“]/.test(t) && /[»"”]$/.test(t)) return t;
  t = t.replace(/^[«"“]\s*|\s*[»"”]$/g, '').trim();
  return t ? `«${t}»` : '';
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** ¿Es esta frase uno de los fragmentos entrecomillados, tal cual (sin contar mayúsculas, acentos ni puntuación)? */
export function isQuoted(line: string, said: readonly string[]): boolean {
  const l = norm(line);
  return l.length > 0 && said.some((s) => norm(s) === l);
}

/** Los fragmentos que no están entre estas frases (los que el máster se ha dejado). */
export function missingQuotes(said: readonly string[], lines: readonly string[]): string[] {
  const have = lines.map(norm);
  return said.filter((s) => !have.includes(norm(s)));
}

/**
 * Cómo se le cuenta al máster lo que ha escrito el jugador (prompt.ts, «Acción del jugador»). Sin comillas, el texto
 * entre «» como siempre. Con comillas, lo dicho y lo hecho por separado, y la regla de cada parte.
 */
export function playerInputLines(text: string): string[] {
  const sd = splitSaidDone(text);
  if (!sd.said.length) return [`«${text}»`];
  const quotes = sd.said.map((s) => `«${s}»`).join(' ');
  if (sd.speech_only) {
    return [
      `Dice: ${quotes}`,
      'Es su frase literal y lo único que hace este turno: va en lines como "actor" palabra por palabra (no la cambies, no la resumas ni le añadas otra). No le muevas, no le hagas coger, dar ni atacar nada (ningún tool de eso para el actor); quien le oye sí puede reaccionar, también moverse o atacar.',
    ];
  }
  return [
    text,
    `Dice: ${quotes}`,
    `Hace: ${sd.done}`,
    'Lo que dice va en lines como "actor" palabra por palabra, y es lo ÚNICO que dice: no le pongas otra frase en la boca. Lo que hace se narra y se ejecuta (los tools que toque), sin convertirlo en palabras suyas.',
  ];
}
