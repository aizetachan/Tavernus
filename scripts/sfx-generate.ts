/**
 * Genera con ElevenLabs los sonidos del catálogo que aún no tienen fichero en public/sfx y los deja fijos ahí,
 * para todas las partidas (docs/SONIDO.md). Usa las descripciones de SOUND_PROMPTS (src/ai/sound.ts).
 *
 *   node --env-file=.env --import tsx scripts/sfx-generate.ts            los efectos cortos que faltan
 *   node --env-file=.env --import tsx scripts/sfx-generate.ts --ambientes los ambientes que faltan
 *   node --env-file=.env --import tsx scripts/sfx-generate.ts clave …    solo esas claves (las rehace aunque existan)
 *   node --import tsx scripts/sfx-generate.ts --tidy [clave …]          solo limpia los que ya están
 *
 * Necesita ELEVENLABS_API_KEY. Cada fichero nuevo se limpia con ffmpeg (si está instalado): fuera el silencio
 * del principio (el efecto suena justo cuando pasa la acción), pico a -3 dBFS para que todos suenen parejos y un
 * fundido de 30 ms al final.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { elevenLabsSound, SOUND_PROMPTS } from '../src/ai/sound.js';
import { AMBIENCE_KEYS, EFFECT_KEYS } from '../src/adapters/web/soundmap.js';

const DIR = fileURLToPath(new URL('../public/sfx/', import.meta.url));
const args = process.argv.slice(2);
const tidyOnly = args[0] === '--tidy';
const ambiences = args[0] === '--ambientes';
const asked = tidyOnly || ambiences ? args.slice(1) : args;

/**
 * Efectos: sin silencio inicial, pico a -3 dBFS y fundido final de 30 ms. Ambientes (ya vienen en bucle de
 * ElevenLabs): solo el volumen, a -28 LUFS como los demás, sin tocar principio ni final. Sin ffmpeg, como está.
 */
function tidy(file: string): string {
  if (/\/ambiente-[^/]+$/.test(file)) return level(file);
  const ff = (a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', `${trim},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (probe.error) return 'sin ffmpeg, sin limpiar';
  const stderr = probe.stderr;
  const out = file.replace(/\.mp3$/, '.tmp.mp3');
  const max = Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1] ?? NaN);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
  const gain = Number.isFinite(max) ? -3 - max : 0;
  ff(['-v', 'error', '-y', '-i', file, '-af', `${trim},volume=${gain.toFixed(1)}dB,areverse,afade=t=in:d=0.03,areverse`, '-c:a', 'libmp3lame', '-q:a', '2', out]);
  renameSync(out, file);
  const left = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
  return `${dur.toFixed(2)} s → ${left.toFixed(2)} s, ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`;
}

if (tidyOnly) {
  const keys = asked.length ? asked : EFFECT_KEYS.filter((k) => existsSync(join(DIR, `${k}.mp3`)));
  for (const k of keys) console.log(`${k}: ${tidy(join(DIR, `${k}.mp3`))}`);
  process.exit(0);
}

const key = process.env['ELEVENLABS_API_KEY'];
if (!key) { console.error('Falta ELEVENLABS_API_KEY (en .env).'); process.exit(1); }

const have = new Set(readdirSync(DIR).map((f) => f.replace(/\.[a-z0-9]+$/, '')));
const keys = asked.length ? asked : (ambiences ? AMBIENCE_KEYS : [...EFFECT_KEYS]).filter((k) => !have.has(k));
const eleven = elevenLabsSound(key);

let seconds = 0;
for (const k of keys) {
  const p = SOUND_PROMPTS[k];
  if (!p) { console.warn(`${k}: no hay descripción en SOUND_PROMPTS`); continue; }
  try {
    const bytes = await eleven.generate(k, p);
    const file = join(DIR, `${k}.${eleven.ext}`);
    writeFileSync(file, bytes);
    seconds += p.seconds;
    console.log(`${k}: ${(bytes.length / 1024).toFixed(0)} KB, ${tidy(file)}`);
  } catch (e) {
    console.error(`${k}: ${(e as Error).message}`);
  }
}
console.log(`Hecho: ${seconds.toFixed(1)} s de audio, unos ${(seconds * 0.12 / 60).toFixed(2)} $ a precio de API.`);

/** Volumen de un ambiente a -28 LUFS (loudnorm a dos pasadas, lineal: no cambia la forma de la onda). */
function level(file: string): string {
  const norm = 'loudnorm=I=-28:TP=-3:LRA=11';
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', `${norm}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (probe.error) return 'sin ffmpeg, sin nivelar';
  const m = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(probe.stderr)![0]) as Record<string, string>;
  const out = file.replace(/\.mp3$/, '.tmp.mp3');
  execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', file, '-af',
    `${norm}:measured_I=${m['input_i']}:measured_TP=${m['input_tp']}:measured_LRA=${m['input_lra']}:measured_thresh=${m['input_thresh']}:offset=${m['target_offset']}:linear=true,aresample=48000`,
    '-c:a', 'libmp3lame', '-q:a', '2', out]);
  renameSync(out, file);
  return `${m['input_i']} LUFS → -28 LUFS`;
}
