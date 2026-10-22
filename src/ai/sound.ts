/**
 * Efectos y ambientes generados por IA: un proveedor convierte la descripción
 * de una clave del catálogo («puerta-abrir», «ambiente-taberna») en audio. Se
 * genera una vez por partida y clave y se reutiliza (data/games/<slug>/sfx);
 * nunca por acción. Sin proveedor, la web sintetiza cada clave en el navegador.
 *
 * APAGADO por defecto: hace falta elegirlo a propósito, aunque haya claves de
 * API en el entorno para otras cosas.
 *
 *   SFX_PROVIDER=elevenlabs  ELEVENLABS_API_KEY   POST /v1/sound-generation (eleven_text_to_sound_v2, con bucle)
 *   SFX_PROVIDER=stability   STABILITY_API_KEY    POST /v2beta/audio/stable-audio-2/text-to-audio (stable-audio-2.5)
 *   SFX_MAX_GENERATIONS      tope de generaciones por arranque del servidor (40 por defecto; un mundo son 26)
 *
 * Precios, licencias y la comparación con bibliotecas libres: docs/SONIDO.md.
 */

export interface SoundPrompt {
  /** Descripción en inglés (los modelos rinden mejor así). */
  prompt: string;
  seconds: number;
  /** Ambiente que se repite: se pide en bucle si el proveedor sabe. */
  loop: boolean;
}

export interface SoundProvider {
  id: string;
  label: string;
  ext: string;
  contentType: string;
  generate(key: string, p: SoundPrompt): Promise<Buffer>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string | FormData }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const fx = (prompt: string, seconds: number): SoundPrompt => ({ prompt, seconds, loop: false });
const amb = (prompt: string): SoundPrompt => ({ prompt, seconds: 22, loop: true });

/** Una descripción por clave del catálogo (soundmap.ts). Medieval, seco, sin música. */
export const SOUND_PROMPTS: Record<string, SoundPrompt> = {
  'pasos-madera': fx('Four slow footsteps with leather boots on old creaky wooden floorboards, indoor tavern, close, dry, no music', 2),
  'pasos-piedra': fx('Four footsteps with leather boots on cobblestone street, outdoors, close, no music', 2),
  'pasos-tierra': fx('Four footsteps on a dirt forest path with a few twigs, outdoors, close, no music', 2),
  'pasos-hierba': fx('Four footsteps through tall grass, rustling, outdoors, close, no music', 2),
  'pasos-agua': fx('Four footsteps splashing through a shallow stream, outdoors, close, no music', 2),
  'puerta-abrir': fx('Heavy old wooden tavern door, iron latch clicks then long hinge creak as it opens, medieval, no music', 1.5),
  'puerta-cerrar': fx('Heavy old wooden door closing with a short creak and a solid thud, iron latch clicks, medieval, no music', 1),
  'moneda': fx('A few gold coins dropped on a wooden table, metallic clinks, close, no music', 1),
  'objeto-coger': fx('Picking up a small object, cloth and leather rustle, close, no music', 0.6),
  'objeto-soltar': fx('Dropping a small leather pouch on a wooden floor, soft thud, no music', 0.6),
  'dado': fx('Two bone dice rolled on a wooden table, rattling and settling, close, no music', 1.2),
  'espada-golpe': fx('Steel sword swing and hit on a shield, metallic clang, medieval combat, no music', 1.2),
  'espada-fallo': fx('Fast sword swing whoosh through the air, no impact, no music', 0.6),
  'dano': fx('Heavy blunt body impact, punch thud with a short grunt, no music', 0.6),
  'curar': fx('Soft magical healing shimmer, gentle chime sparkle, fantasy, short', 1.5),
  'hacha': fx('Two axe chops into a log, wood impact, outdoors, no music', 1.2),
  'descubrir': fx('Subtle discovery chime, two soft bell notes, fantasy game, short', 1.2),
  'campana': fx('Single distant village church bell strike with long decay, medieval', 3),
  'ambiente-taberna': amb('Medieval tavern ambience, low crowd murmur and indistinct chatter, crackling fireplace, occasional mugs clinking, no music, seamless loop'),
  'ambiente-interior': amb('Quiet old wooden house interior room tone, occasional floorboard creak, faint fire crackle, no music, seamless loop'),
  'ambiente-plaza': amb('Medieval village square during the day, light wind, distant people talking, birds, a far blacksmith hammer, no music, seamless loop'),
  'ambiente-plaza-noche': amb('Medieval village square at night, soft wind, a few crickets, very quiet, no music, seamless loop'),
  'ambiente-bosque': amb('Forest clearing during the day, wind in the leaves, many birds singing, no music, seamless loop'),
  'ambiente-bosque-noche': amb('Forest at night, crickets, gentle wind in trees, an owl hooting in the distance, no music, seamless loop'),
  'ambiente-agua': amb('Small shallow stream flowing over stones, bubbling water, a few birds, no music, seamless loop'),
  'ambiente-lluvia': amb('Steady rain falling outdoors on a village, drops on roofs and puddles, distant soft thunder, no music, seamless loop'),
};

/** ElevenLabs Sound Effects v2: hasta 30 s, con bucle. Precio de API (oct 2026): 0,12 $/min de audio. */
export function elevenLabsSound(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): SoundProvider {
  return {
    id: 'elevenlabs', label: 'ElevenLabs Sound Effects', ext: 'mp3', contentType: 'audio/mpeg',
    async generate(_key, p) {
      const res = await fetchImpl('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text: p.prompt, duration_seconds: Math.min(30, Math.max(0.5, p.seconds)), prompt_influence: 0.5, loop: p.loop, model_id: 'eleven_text_to_sound_v2' }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Stability AI, Stable Audio 2.5: 8 créditos (0,08 $) por generación sea cual sea la duración. Sin bucle nativo. */
export function stabilitySound(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): SoundProvider {
  return {
    id: 'stability', label: 'Stable Audio 2.5', ext: 'mp3', contentType: 'audio/mpeg',
    async generate(_key, p) {
      const form = new FormData();
      form.append('prompt', p.prompt);
      form.append('duration', String(Math.max(1, Math.round(p.loop ? 30 : p.seconds))));
      form.append('model', 'stable-audio-2.5');
      form.append('output_format', 'mp3');
      const res = await fetchImpl('https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, accept: 'audio/*' },
        body: form,
      });
      if (!res.ok) throw new Error(`Stability ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** El proveedor elegido en el entorno, o null (lo normal: sonido procedural, coste cero). */
export function soundProviderFromEnv(env: Record<string, string | undefined> = process.env): SoundProvider | null {
  const id = (env['SFX_PROVIDER'] ?? '').trim().toLowerCase();
  if (!id || id === 'off' || id === 'procedural' || id === 'browser') return null;
  if (id === 'elevenlabs') {
    const k = env['ELEVENLABS_API_KEY'];
    if (!k) throw new Error('SFX_PROVIDER=elevenlabs necesita ELEVENLABS_API_KEY');
    return elevenLabsSound(k);
  }
  if (id === 'stability') {
    const k = env['STABILITY_API_KEY'];
    if (!k) throw new Error('SFX_PROVIDER=stability necesita STABILITY_API_KEY');
    return stabilitySound(k);
  }
  throw new Error(`SFX_PROVIDER desconocido: ${id} (elevenlabs, stability u off)`);
}

/** Coste estimado en dólares de generar el catálogo de un mundo una vez (docs/SONIDO.md). */
export function worldCostUSD(providerId: 'elevenlabs' | 'stability', prompts: SoundPrompt[] = Object.values(SOUND_PROMPTS)): number {
  if (providerId === 'stability') return prompts.length * 0.08;
  return prompts.reduce((s, p) => s + p.seconds, 0) * (0.12 / 60);
}
