/**
 * Narrador de voz en el servidor: convierte una narración (sus trozos de narrador y de diálogo) en
 * un solo audio con un proveedor de nube.
 *
 *   TTS_PROVIDER=browser   (por defecto) no hay voz en el servidor: la pone el navegador (speechSynthesis).
 *   TTS_PROVIDER=azure     Azure AI Speech (voces neuronales) por REST con AZURE_SPEECH_KEY y AZURE_SPEECH_REGION.
 *
 * Voces (opcionales): TTS_VOICE_NARRATOR y TTS_VOICES_NPC (lista separada por comas; cada hablante
 * toma siempre la misma). TTS_MAX_CHARS limita los caracteres que se mandan a la nube por arranque
 * del servidor (lo cacheado no cuenta). El análisis de opciones y costes está en docs/NARRADOR-VOZ.md.
 */

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
}

export const TTS_PROVIDERS = ['browser', 'azure'] as const;

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
