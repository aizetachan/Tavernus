/**
 * Narrador de voz en el servidor: convierte una narración (sus trozos de narrador y de diálogo) en
 * un solo audio con un proveedor de nube.
 *
 *   TTS_PROVIDER=browser   (por defecto) no hay voz en el servidor: la pone el navegador (speechSynthesis).
 *   TTS_PROVIDER=azure     Azure AI Speech (voces neuronales) por REST con AZURE_SPEECH_KEY y AZURE_SPEECH_REGION.
 *   TTS_PROVIDER=elevenlabs ElevenLabs por REST con ELEVENLABS_API_KEY; las voces son ids de ElevenLabs y el modelo
 *                          ELEVENLABS_MODEL (por defecto eleven_multilingual_v2). Con eleven_v3, la narración se
 *                          etiqueta antes con acotaciones de voz (src/ai/audiotags.ts).
 *
 * Voces (opcionales): TTS_VOICE_NARRATOR y TTS_VOICES_NPC (lista separada por comas; cada hablante
 * toma siempre la misma). TTS_MAX_CHARS limita los caracteres que se mandan a la nube por arranque
 * del servidor (lo cacheado no cuenta). El análisis de opciones y costes está en docs/NARRADOR-VOZ.md.
 */

import { supportsAudioTags } from './audiotags.js';

export type SpeechRole = 'narrator' | 'dialogue';

export interface SpeechRequest {
  text: string;
  role: SpeechRole;
  /** Hablante del parlamento (npc_id, nombre o 'actor'); elige voz entre las de NPC. */
  speaker: string | null;
}

export interface NarratorProvider {
  id: string;
  /** Nombre corto para la interfaz. */
  label: string;
  contentType: string;
  ext: string;
  /** Voz que usaría para este trozo: forma parte de la clave de la caché. */
  voiceFor(req: SpeechRequest): string;
  /** Todos los trozos de una narración, en orden, en un solo audio. */
  synthesize(parts: SpeechRequest[]): Promise<Buffer>;
  /** Entiende acotaciones [whispers], [sighs]… dentro del texto (Eleven v3). */
  audioTags?: boolean;
  /** Modelos entre los que el jugador puede elegir en la página (el primero, el de la partida). */
  models?: { id: string; label: string }[];
  /** El mismo proveedor con otro modelo de `models`. */
  withModel?(model: string): NarratorProvider;
}

/** El proveedor no tiene saldo: hasta que se recargue, la voz la pone el navegador. */
export class NarratorOutOfCredits extends Error {}

export const TTS_PROVIDERS = ['browser', 'azure', 'elevenlabs'] as const;

/** Proveedor de servidor según el entorno; null = voz del navegador. Lanza si falta la clave del elegido. */
export function narratorFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): NarratorProvider | null {
  const id = (env['TTS_PROVIDER'] ?? 'browser').trim().toLowerCase() || 'browser';
  if (id === 'browser') return null;
  if (id === 'azure') {
    const key = env['AZURE_SPEECH_KEY']?.trim();
    const region = env['AZURE_SPEECH_REGION']?.trim();
    if (!key || !region) throw new Error('TTS_PROVIDER=azure necesita AZURE_SPEECH_KEY y AZURE_SPEECH_REGION (ver docs/NARRADOR-VOZ.md).');
    return azureNarrator({
      key, region,
      narrator: env['TTS_VOICE_NARRATOR']?.trim() || AZURE_DEFAULTS.narrator,
      npcs: listOf(env['TTS_VOICES_NPC']) ?? AZURE_DEFAULTS.npcs,
      rate: Number(env['TTS_RATE']) > 0 ? Number(env['TTS_RATE']) : 1,
    }, fetchImpl);
  }
  if (id === 'elevenlabs') {
    const key = env['ELEVENLABS_API_KEY']?.trim();
    if (!key) throw new Error('TTS_PROVIDER=elevenlabs necesita ELEVENLABS_API_KEY (ver docs/NARRADOR-VOZ.md).');
    return elevenLabsNarrator({
      key,
      model: env['ELEVENLABS_MODEL']?.trim() || ELEVENLABS_DEFAULTS.model,
      narrator: env['TTS_VOICE_NARRATOR']?.trim() || ELEVENLABS_DEFAULTS.narrator,
      npcs: listOf(env['TTS_VOICES_NPC']) ?? ELEVENLABS_DEFAULTS.npcs,
      rate: Number(env['TTS_RATE']) > 0 ? Number(env['TTS_RATE']) : 1,
    }, fetchImpl);
  }
  throw new Error(`TTS_PROVIDER desconocido: «${id}». Valores: ${TTS_PROVIDERS.join(', ')}.`);
}

/** Voces neuronales es-ES de Azure (las mismas «Natural» que Edge ofrece gratis en el navegador). */
export const AZURE_DEFAULTS = {
  narrator: 'es-ES-AlvaroNeural',
  npcs: ['es-ES-ElviraNeural', 'es-ES-ArnauNeural', 'es-ES-XimenaNeural', 'es-ES-DarioNeural', 'es-ES-TrianaNeural', 'es-ES-SaulNeural'],
};

export interface AzureNarratorOptions {
  key: string;
  region: string;
  narrator: string;
  npcs: string[];
  /** 1 = velocidad normal. */
  rate: number;
}

export function azureNarrator(o: AzureNarratorOptions, fetchImpl: typeof fetch = fetch): NarratorProvider {
  const voiceFor = (req: SpeechRequest): string => {
    if (req.role === 'narrator' || !o.npcs.length) return o.narrator;
    return o.npcs[hashIndex(req.speaker ?? '', o.npcs.length)]!;
  };
  return {
    id: 'azure', label: 'Azure Neural TTS', contentType: 'audio/mpeg', ext: 'mp3',
    voiceFor: (req) => `${voiceFor(req)}@${o.rate}`,
    async synthesize(parts) {
      const r = await fetchImpl(`https://${o.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'ocp-apim-subscription-key': o.key,
          'content-type': 'application/ssml+xml',
          'x-microsoft-outputformat': 'audio-24khz-48kbitrate-mono-mp3',
          'user-agent': 'tavernus',
        },
        body: azureSsml(parts, voiceFor, o.rate),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`Azure TTS ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200) || r.statusText}`);
      return Buffer.from(await r.arrayBuffer());
    },
  };
}

/**
 * ElevenLabs: voces por id (las de tu cuenta o de la Voice Library) y un modelo. Las voces por defecto son voces
 * prefabricadas de ElevenLabs que hablan castellano con los modelos multilingües; lo normal es poner las tuyas en
 * TTS_VOICE_NARRATOR y TTS_VOICES_NPC.
 */
/** Los que se ofrecen en el selector de voz, además del de ELEVENLABS_MODEL. */
export const ELEVENLABS_MODELS = [
  { id: 'eleven_v3', label: 'ElevenLabs v3' },
  { id: 'eleven_multilingual_v2', label: 'ElevenLabs v2' },
];

export const ELEVENLABS_DEFAULTS = {
  model: 'eleven_multilingual_v2',
  narrator: 'JBFqnCBsd6RMkjVDRZzb',
  npcs: ['EXAVITQu4vr4xnSDxMaL', 'TX3LPaxmHKxFdv7VOQHJ', 'XrExE9yKIg1WjnnlVkGX', 'onwK4e9ZLuTAKqWW03F9', 'pFZP5JQG7iQjIQuC4Bku'],
};

export interface ElevenLabsNarratorOptions {
  key: string;
  model: string;
  narrator: string;
  npcs: string[];
  /** 1 = velocidad normal; ElevenLabs admite de 0,7 a 1,2. */
  rate: number;
}

/**
 * ElevenLabs genera una voz por petición: los trozos seguidos de la misma voz se juntan en uno y cada grupo se
 * pide por separado (POST /v1/text-to-speech/{voz}, mp3). Los mp3 del mismo formato se pueden encadenar tal cual,
 * así que la narración entera sale en un solo audio, como con Azure.
 */
export function elevenLabsNarrator(o: ElevenLabsNarratorOptions, fetchImpl: typeof fetch = fetch): NarratorProvider {
  const voiceFor = (req: SpeechRequest): string => {
    if (req.role === 'narrator' || !o.npcs.length) return o.narrator;
    return o.npcs[hashIndex(req.speaker ?? '', o.npcs.length)]!;
  };
  const speed = Math.min(1.2, Math.max(0.7, o.rate));
  const own = ELEVENLABS_MODELS.find((m) => m.id === o.model) ?? { id: o.model, label: `ElevenLabs ${o.model.replace(/^eleven_/, '')}` };
  return {
    id: 'elevenlabs', label: 'ElevenLabs', contentType: 'audio/mpeg', ext: 'mp3', audioTags: supportsAudioTags(o.model),
    models: [own, ...ELEVENLABS_MODELS.filter((m) => m.id !== o.model)],
    withModel: (model) => elevenLabsNarrator({ ...o, model }, fetchImpl),
    voiceFor: (req) => `${voiceFor(req)}@${o.model}@${speed}`,
    async synthesize(parts) {
      const groups: { voice: string; text: string }[] = [];
      for (const p of parts.slice(0, 50)) {
        const voice = voiceFor(p), last = groups[groups.length - 1];
        if (last && last.voice === voice) last.text += `\n\n${p.text}`;
        else groups.push({ voice, text: p.text });
      }
      const chunks: Buffer[] = [];
      for (const g of groups) {
        const r = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(g.voice)}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': o.key, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text: g.text, model_id: o.model, ...(speed !== 1 ? { voice_settings: { speed } } : {}) }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!r.ok) {
          const body = (await r.text().catch(() => '')).slice(0, 300);
          // Sin créditos: 402 insufficient_credits (o el 401 quota_exceeded de antes).
          if (r.status === 402 || /insufficient_credits|quota_exceeded/.test(body)) throw new NarratorOutOfCredits(`ElevenLabs ${r.status}: sin créditos`);
          throw new Error(`ElevenLabs ${r.status}: ${body.slice(0, 200) || r.statusText}`);
        }
        const buf = Buffer.from(await r.arrayBuffer());
        // Cada mp3 trae su etiqueta ID3 delante: solo se deja la del primero, para que el audio unido no se corte.
        chunks.push(chunks.length ? stripId3(buf) : buf);
      }
      return Buffer.concat(chunks);
    },
  };
}

/** Quita la etiqueta ID3v2 del principio de un mp3 (tamaño «synchsafe» de 4 bytes; +10 si lleva pie). */
export function stripId3(buf: Buffer): Buffer {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return buf;
  const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
  const footer = (buf[5]! & 0x10) ? 10 : 0;
  return buf.subarray(Math.min(buf.length, 10 + size + footer));
}

/** Un <voice> por trozo (Azure admite hasta 50 por petición); pausa algo más larga entre párrafos. */
export function azureSsml(parts: SpeechRequest[], voiceFor: (req: SpeechRequest) => string, rate = 1): string {
  const pct = Math.round((rate - 1) * 100);
  const prosody = (t: string) => (pct ? `<prosody rate="${pct > 0 ? '+' : ''}${pct}%">${t}</prosody>` : t);
  const voices = parts.slice(0, 50).map((p) => `<voice name="${xml(voiceFor(p))}">${prosody(xml(p.text))}<break time="250ms"/></voice>`);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-ES">${voices.join('')}</speak>`;
}

/** Siempre el mismo índice para el mismo hablante. */
export function hashIndex(s: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

function xml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

function listOf(v: string | undefined): string[] | null {
  const l = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return l.length ? l : null;
}
