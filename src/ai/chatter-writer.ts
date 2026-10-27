/**
 * Escritor barato de comentarios del mundo (chatter.ts): cuando una regla de
 * los datos abre una tanda de comentarios sin plantillas, solo con `prompt`,
 * se le piden unas frases cortas a un modelo pequeño, una sola vez por tanda.
 * No narra ni decide nada: escribe lo que la gente diría al pasar, con los
 * huecos de siempre ({pc}, {npc}…), y el motor los rellena y los limita igual
 * que las plantillas escritas a mano. Sin clave de API o si falla, la tanda calla.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ChatterWriter } from '../engine/chatter.js';

/** El modelo pequeño de la casa: unas frases sueltas no necesitan más. */
export const CHATTER_MODEL = 'claude-haiku-5-5';
const MAX_LINES = 4;

type Create = (p: { model: string; max_tokens: number; system: string; messages: { role: 'user'; content: string }[] }) => Promise<{ content: { type: string; text?: string }[] }>;

const KIND_ES = { rumor: 'un rumor sobre algo que ha pasado', reaction: 'una reacción a lo que ha hecho {pc}, dicha cerca de él', daily: 'vida diaria del lugar' } as const;

/** Las frases que devuelve el modelo, limpias: una por línea, sin viñetas ni comillas, cortas. */
export function parseChatterLines(text: string): string[] {
  return text.split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^[«"“]+|[»"”]+$/g, '').trim())
    .filter((l) => l.length >= 4 && l.length <= 160)
    .slice(0, MAX_LINES);
}

export function chatterWriter(opts: { model?: string; create?: Create; timeoutMs?: number } = {}): ChatterWriter {
  const model = opts.model ?? CHATTER_MODEL;
  const create: Create = opts.create ?? (() => {
    const sdk = new Anthropic({ timeout: opts.timeoutMs ?? 20_000, maxRetries: 1 });
    return (p) => sdk.messages.create(p) as unknown as ReturnType<Create>;
  })();
  return async ({ kind, prompt, vars, language }) => {
    const known = Object.entries(vars).map(([k, v]) => `{${k}} = ${v}`).join('; ');
    try {
      const r = await create({
        model, max_tokens: 300,
        system: `Escribes lo que la gente de un pueblo dice al pasar en un juego de rol (${language === 'en' ? 'en inglés' : 'en español'}). ${MAX_LINES} frases como mucho, una por línea, de menos de 20 palabras, habladas y con sabor del sitio. Sin narrar, sin comillas, sin nombres nuevos y sin inventar hechos que no estén en lo que te cuentan. Puedes usar estos huecos tal cual: ${known || 'ninguno'}.`,
        messages: [{ role: 'user', content: `Tipo: ${KIND_ES[kind]}. ${prompt}` }],
      });
      const text = r.content.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n');
      const lines = parseChatterLines(text);
      return lines.length ? lines : null;
    } catch {
      return null;
    }
  };
}
