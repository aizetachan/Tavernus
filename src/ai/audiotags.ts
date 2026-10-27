/**
 * Acotaciones de voz para Eleven v3: antes de pedir el audio, un modelo barato (Haiku) marca dónde
 * conviene un susurro, una risa o un suspiro con etiquetas entre corchetes ([whispers], [sighs]…),
 * que v3 interpreta y no lee. El texto del chat no cambia: las etiquetas solo viajan a ElevenLabs.
 *
 *   - Solo con modelos de ElevenLabs que las entienden (eleven_v3); el resto las leería en alto.
 *   - Lista cerrada de etiquetas en inglés (las que ElevenLabs documenta y mejor responden), una o
 *     dos por trozo como mucho: con todas las frases etiquetadas la voz suena forzada.
 *   - Si el modelo cambia una sola palabra, usa una etiqueta fuera de la lista o tarda, se manda el
 *     trozo tal cual: la narración nunca se pierde ni se altera.
 *
 * TTS_AUDIO_TAGS=off lo apaga; TTS_TAGS_MODEL cambia el modelo (claude-haiku-5-5). Necesita
 * ANTHROPIC_API_KEY. Guía de ElevenLabs: docs/NARRADOR-VOZ.md › Acotaciones de v3.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SpeechRequest } from './narrator.js';

/** Modelos de ElevenLabs que interpretan las etiquetas [..] en vez de leerlas. */
export function supportsAudioTags(model: string): boolean {
  return /^eleven_v3/.test(model);
}

/** Emoción y forma de decir (delante de la frase) y reacciones (donde ocurren). */
export const AUDIO_TAGS = [
  'whispers', 'softly', 'calmly', 'slowly', 'mysteriously', 'ominously', 'dramatically', 'excited', 'curious',
  'sarcastic', 'mischievously', 'nervous', 'fearful', 'sad', 'angry', 'shouts', 'tired',
  'sighs', 'exhales', 'gasps', 'laughs', 'chuckles', 'gulps', 'clears throat', 'pause',
] as const;

export const DEFAULT_TAGS_MODEL = 'claude-haiku-5-5';
const MAX_TAGS_PER_PART = 2;

const SYSTEM = `Preparas narraciones en castellano de una partida de rol para que las lea en voz alta ElevenLabs v3, que entiende acotaciones de voz entre corchetes.

Recibes un JSON {"parts": [{"role": "narrator" | "dialogue", "speaker": ..., "text": ...}]} y devuelves {"parts": [...]} con el mismo número de textos, en el mismo orden, con acotaciones añadidas donde den intención a la lectura.

Reglas:
- Solo estas acotaciones, en inglés, en minúscula y entre corchetes: ${AUDIO_TAGS.map((t) => `[${t}]`).join(', ')}.
- No cambies, quites, añadas ni reordenes ninguna palabra ni signo del texto: solo insertas acotaciones.
- Como mucho ${MAX_TAGS_PER_PART} por texto, y muchos textos sin ninguna. Úsalas donde la escena lo pida: un secreto se susurra, una amenaza suena ominosa, un alivio se suspira, una broma se ríe.
- Las de forma de decir ([whispers], [ominously], [excited]...) van justo delante de la frase que afectan; las reacciones ([sighs], [laughs], [gasps]...) donde ocurren.
- El narrador es sobrio: prefiere [softly], [slowly], [mysteriously], [ominously], [dramatically], [pause]. Los personajes ("dialogue") admiten emociones y reacciones.
- Nunca describas sonidos del entorno ni efectos: solo la voz de quien habla.`;

const SCHEMA = {
  type: 'object',
  properties: { parts: { type: 'array', items: { type: 'string' } } },
  required: ['parts'],
  additionalProperties: false,
} as const;

export interface TaggerClient {
  create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface AudioTagger {
  model: string;
  /** Los mismos trozos con etiquetas donde aporten; ante cualquier fallo, los originales. */
  tag(parts: SpeechRequest[]): Promise<SpeechRequest[]>;
}

/** Tagger según el entorno; null si está apagado o no hay clave de Anthropic. */
export function audioTaggerFromEnv(env: Record<string, string | undefined>, client?: TaggerClient): AudioTagger | null {
  if ((env['TTS_AUDIO_TAGS'] ?? 'on').trim().toLowerCase() === 'off') return null;
  if (!client && !env['ANTHROPIC_API_KEY']?.trim()) return null;
  return audioTagger(client ?? liveTaggerClient(), env['TTS_TAGS_MODEL']?.trim() || DEFAULT_TAGS_MODEL);
}

function liveTaggerClient(): TaggerClient {
  const sdk = new Anthropic({ timeout: 10_000, maxRetries: 1 });
  return { create: (p) => sdk.messages.create(p) };
}

export function audioTagger(client: TaggerClient, model = DEFAULT_TAGS_MODEL): AudioTagger {
  return {
    model,
    async tag(parts) {
      if (!parts.length) return parts;
      let tagged: unknown;
      try {
        const res = await client.create({
          model, max_tokens: 4000,
          thinking: { type: 'disabled' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
          system: SYSTEM,
          messages: [{ role: 'user', content: JSON.stringify({ parts: parts.map((p) => ({ role: p.role, speaker: p.speaker, text: p.text })) }) }],
        });
        const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
        tagged = res.stop_reason === 'end_turn' ? (JSON.parse(text) as { parts?: unknown }).parts : null;
      } catch (e) {
        console.error('[tts] acotaciones:', (e as Error).message, '— se lee sin ellas.');
        return parts;
      }
      if (!Array.isArray(tagged) || tagged.length !== parts.length) return parts;
      return parts.map((p, i) => {
        const t = tagged[i];
        return typeof t === 'string' && validTagging(p.text, t) ? { ...p, text: t.replace(/\s+/g, ' ').trim() } : p;
      });
    },
  };
}

const TAG_RE = /\[([^\]]*)\]/g;

/** El texto etiquetado es el original más etiquetas permitidas (y no demasiadas). */
export function validTagging(original: string, tagged: string): boolean {
  const tags = [...tagged.matchAll(TAG_RE)].map((m) => m[1]!.trim());
  if (tags.length > MAX_TAGS_PER_PART) return false;
  if (!tags.every((t) => (AUDIO_TAGS as readonly string[]).includes(t))) return false;
  return words(tagged.replace(TAG_RE, ' ')) === words(original);
}

/** Para comparar solo palabras y signos: los espacios alrededor de una etiqueta no cuentan. */
function words(s: string): string {
  return s.replace(/\s+/g, '');
}
