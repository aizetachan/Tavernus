/**
 * Sinopsis de una partida para el menú (sin abrirla): la última narración del máster, en una o dos frases.
 */

import { open as openFile } from 'node:fs/promises';

/** Hasta dónde se lee del final del registro de eventos para la sinopsis (no hace falta el fichero entero). */
const SYNOPSIS_TAIL_BYTES = 96 * 1024;
export const SYNOPSIS_MAX_CHARS = 260;

/**
 * Sinopsis para el menú sin abrir la partida (abrirla cambiaría su «jugada hace…»): la última narración del
 * máster del registro de eventos, recortada a una o dos frases. Si aún no hay narración, la última que haya.
 */
export async function synopsisOf(eventsFile: string): Promise<string | null> {
  let text: string;
  try {
    const fh = await openFile(eventsFile, 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - SYNOPSIS_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally { await fh.close(); }
  } catch { return null; }
  let fallback: string | null = null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let ev: { action_type?: string; narration_private?: string | null };
    try { ev = JSON.parse(line) as typeof ev; } catch { continue; }
    const n = typeof ev.narration_private === 'string' ? ev.narration_private.trim() : '';
    if (!n) continue;
    if (ev.action_type === 'master') return clipSynopsis(n);
    fallback ??= n;
  }
  return fallback ? clipSynopsis(fallback) : null;
}

/** Una o dos frases enteras hasta SYNOPSIS_MAX_CHARS; si una sola ya se pasa, se corta en una palabra con «…». */
export function clipSynopsis(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SYNOPSIS_MAX_CHARS) return flat;
  const sentences = flat.match(/[^.!?…]+[.!?…]+[»"”]?\s*/g) ?? [];
  let out = '';
  for (const sen of sentences) {
    if ((out + sen).trim().length > SYNOPSIS_MAX_CHARS) break;
    out += sen;
  }
  if (out.trim()) return out.trim();
  const cut = flat.slice(0, SYNOPSIS_MAX_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '') + '…';
}
