import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { audioTagger, audioTaggerFromEnv, supportsAudioTags, validTagging, type TaggerClient } from '../src/ai/audiotags.js';
import type { SpeechRequest } from '../src/ai/narrator.js';

const parts: SpeechRequest[] = [
  { text: 'La puerta se abre despacio.', role: 'narrator', speaker: null },
  { text: 'No hagáis ruido, el guardia duerme.', role: 'dialogue', speaker: 'Brenna' },
];

/** Cliente falso que contesta con estos textos (o lanza). */
function reply(texts: unknown, stop: Anthropic.Message['stop_reason'] = 'end_turn'): TaggerClient & { seen: Anthropic.MessageCreateParamsNonStreaming[] } {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    seen,
    async create(p) {
      seen.push(p);
      if (texts instanceof Error) throw texts;
      return { content: [{ type: 'text', text: JSON.stringify({ parts: texts }) }], stop_reason: stop } as unknown as Anthropic.Message;
    },
  };
}

describe('acotaciones de voz', () => {
  it('solo los modelos v3 de ElevenLabs las entienden', () => {
    expect(supportsAudioTags('eleven_v3')).toBe(true);
    expect(supportsAudioTags('eleven_multilingual_v2')).toBe(false);
    expect(supportsAudioTags('eleven_flash_v2_5')).toBe(false);
  });

  it('valida que solo se añadan etiquetas permitidas, sin tocar el texto', () => {
    expect(validTagging('No hagáis ruido.', '[whispers] No hagáis ruido.')).toBe(true);
    expect(validTagging('Ja, qué tontería.', 'Ja, [laughs] qué tontería.')).toBe(true);
    expect(validTagging('No hagáis ruido.', '[whispers] No hagáis nada de ruido.')).toBe(false);
    expect(validTagging('Hola.', '[explosion] Hola.')).toBe(false);
    expect(validTagging('Hola.', '[sighs] [whispers] [softly] Hola.')).toBe(false);
  });

  it('etiqueta con Haiku sin pensar y en esfuerzo bajo, y conserva los trozos que vuelven mal', async () => {
    const client = reply(['[slowly] La puerta se abre despacio.', '[whispers] No hagáis ruido, el guardia ya duerme.']);
    const out = await audioTagger(client).tag(parts);
    expect(out.map((p) => p.text)).toEqual(['[slowly] La puerta se abre despacio.', 'No hagáis ruido, el guardia duerme.']);
    expect(out[1]!.speaker).toBe('Brenna');
    const req = client.seen[0]!;
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.thinking).toEqual({ type: 'disabled' });
    expect(req.output_config?.effort).toBe('low');
  });

  it('si la API falla, corta o devuelve otro número de trozos, lee el original', async () => {
    for (const client of [reply(new Error('caída')), reply(['[sighs] La puerta se abre despacio.']), reply(['a', 'b'], 'max_tokens')]) {
      expect(await audioTagger(client).tag(parts)).toEqual(parts);
    }
  });

  it('TTS_AUDIO_TAGS=off o sin clave de Anthropic, no hay etiquetador', () => {
    expect(audioTaggerFromEnv({})).toBeNull();
    expect(audioTaggerFromEnv({ ANTHROPIC_API_KEY: 'k', TTS_AUDIO_TAGS: 'off' })).toBeNull();
    expect(audioTaggerFromEnv({ ANTHROPIC_API_KEY: 'k', TTS_TAGS_MODEL: 'claude-sonnet-5-5' })?.model).toBe('claude-sonnet-5-5');
  });
});
