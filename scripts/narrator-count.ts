/**
 * Cuánto habla el narrador en las charlas de partidas grabadas: burbujas del narrador por cada 10 turnos de charla,
 * tal como las pinta la web (novelBlocks: la prosa que presenta un parlamento, `lead`, va dentro de la burbuja del
 * personaje y no cuenta). Sirve para comparar antes y después del modo del narrador (src/engine/narrator.ts).
 * Gratis: solo lee los eventos.
 *
 *   npm run narrator-count -- data/games/<partida> [otra…]   una o varias partidas (carpeta o .events.jsonl)
 *   npm run narrator-count -- --all                          todas las de data/games
 *   npm run narrator-count -- --all --simulate               lo mismo, como lo dejaría hoy el cierre (aprox.)
 *
 * `--simulate` aplica a cada turno de charla lo que hace ahora el servidor al cierre: quita las frases que el
 * narrador ya dijo (closecheck.ts) y recorta según el modo (narrator.ts). El modo se aproxima con lo que queda en el
 * evento: `full` si la charla empieza (nadie de ese NPC le ha hablado en 15 min de juego), si no `silent`, subido por
 * los tools y la tirada del turno (closingMode). No sabe de combates ni incidentes: es una cota, no la partida real.
 *
 * Turno de charla: un turno del máster con lo que escribió el jugador, que suena a hablar (soundsLikeTalk) y en el
 * que contesta algún NPC (`lines`). Sin tiradas ni escenas.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameEvent } from '../src/engine/model.js';
import type { DialogueLine } from '../src/engine/moments.js';
import { applyNarratorMode, closingMode, physicalAction, type NarratorPlan } from '../src/engine/narrator.js';
import { soundsLikeTalk } from '../src/engine/talk.js';
import { recentNarration, withoutRepeatedNarration } from '../src/engine/closecheck.js';
import { narrationWithLines } from '../src/engine/conversation.js';
import { novelBlocks } from '../src/adapters/web/novel.js';

export interface NarratorStats {
  /** Turnos de charla. */
  talk_turns: number;
  /** Burbujas del narrador en esos turnos (sin contar las acotaciones dentro de la burbuja de un personaje). */
  narrator_bubbles: number;
  /** Turnos de charla con al menos una burbuja del narrador. */
  turns_with_narrator: number;
  /** Acotaciones dentro de la burbuja de un personaje (`lead`: dos puntos o `beat`). */
  leads: number;
  /** Palabras del narrador por turno de charla, de media. */
  words_per_turn: number;
}

/** Le habla (talk.ts) y no hace nada más (narrator.ts). */
const talkTurn = (text: string) => soundsLikeTalk(text) && !physicalAction(text);

const wordCount = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Las cuentas de una partida. */
export function narratorStats(events: readonly GameEvent[]): NarratorStats {
  const out: NarratorStats = { talk_turns: 0, narrator_bubbles: 0, turns_with_narrator: 0, leads: 0, words_per_turn: 0 };
  let words = 0;
  for (const e of events) {
    if (e.action_type !== 'master' || !e.input_text || !talkTurn(e.input_text)) continue;
    const lines = (Array.isArray(e.payload['lines']) ? e.payload['lines'] as DialogueLine[] : []).filter((l) => l && typeof l.text === 'string');
    if (!lines.some((l) => l.speaker === 'npc')) continue;
    out.talk_turns++;
    const blocks = novelBlocks(e.narration_private ?? '', lines);
    const prose = blocks.filter((b): b is Extract<typeof b, { kind: 'prose' }> => b.kind === 'prose');
    const bubbles = prose.filter((b) => !b.lead);
    out.narrator_bubbles += bubbles.length;
    out.leads += prose.length - bubbles.length;
    if (bubbles.length) out.turns_with_narrator++;
    words += bubbles.reduce((n, b) => n + wordCount(b.text), 0);
  }
  out.words_per_turn = out.talk_turns ? Math.round((words / out.talk_turns) * 10) / 10 : 0;
  return out;
}

/** Burbujas del narrador por cada 10 turnos de charla. */
export function per10(s: Pick<NarratorStats, 'talk_turns' | 'narrator_bubbles'>): number {
  return s.talk_turns ? Math.round((s.narrator_bubbles / s.talk_turns) * 100) / 10 : 0;
}

/** Una charla «empieza» si ese NPC no le ha hablado a este PJ en los últimos 15 min de juego (talk.ts, new_talk). */
const NEW_TALK_S = 15 * 60;

/** Los eventos como los dejaría hoy el cierre en los turnos de charla (ver `--simulate` arriba). */
export function simulate(events: readonly GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  const lastHeard = new Map<string, number>();
  for (const e of events) {
    const lines = (Array.isArray(e.payload['lines']) ? e.payload['lines'] as DialogueLine[] : []).filter((l) => l && typeof l.text === 'string');
    const npc = lines.find((l) => l.speaker === 'npc' && l.npc_id)?.npc_id;
    const talk = e.action_type === 'master' && e.input_text && talkTurn(e.input_text) && npc;
    if (!talk) { out.push(e); continue; }
    const key = `${e.actor_id}:${npc}`;
    const fresh = !lastHeard.has(key) || e.timestamp_game_s - lastHeard.get(key)! > NEW_TALK_S;
    lastHeard.set(key, e.timestamp_game_s);
    const calls = ((e.payload['master'] as { calls?: { name: string; result?: string }[] } | null)?.calls ?? []).filter((c) => !String(c.result ?? '').startsWith('{"error"'));
    const base: NarratorPlan = fresh ? { mode: 'full', why: 'la charla empieza' } : { mode: 'silent', why: 'charla sin más' };
    const roll = e.payload['requires_roll'] as { kind: string } | undefined;
    const mode = closingMode(base, { okTools: calls.map((c) => c.name), roll: roll ?? null }).mode;
    const prose = proseOf(e.narration_private ?? '', lines);
    const rep = withoutRepeatedNarration(prose, recentNarration(out, e.actor_id ?? ''));
    const copy = lines.map((l) => ({ ...l }));
    const cut = applyNarratorMode(mode, rep.narration, copy, () => []);
    if (cut.beat) { const l = copy.find((x) => x.npc_id === cut.beat!.npc_id); if (l) l.beat = cut.beat.text; }
    out.push({ ...e, narration_private: narrationWithLines(cut.narration, copy), payload: { ...e.payload, lines: copy } });
  }
  return out;
}

/** La prosa del narrador sin las citas de lo dicho (el cierre las vuelve a poner con narrationWithLines). */
function proseOf(narration: string, lines: readonly DialogueLine[]): string {
  const said = lines.map((l) => l.text.trim()).filter(Boolean);
  return narration.replace(/[«“]([^»”]*)[»”]/g, (m, q: string) => (said.some((t) => t.includes(q.trim()) || q.includes(t)) ? ' ' : m)).replace(/\s{2,}/g, ' ').trim();
}

/** Los eventos de una partida: su carpeta (con `data/*.events.jsonl`) o el fichero. */
export function loadEvents(path: string): GameEvent[] {
  let file = path;
  if (statSync(path).isDirectory()) {
    const dir = existsSync(join(path, 'data')) ? join(path, 'data') : path;
    const found = readdirSync(dir).find((f) => f.endsWith('.events.jsonl'));
    if (!found) return [];
    file = join(dir, found);
  }
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as GameEvent);
}

function main(): void {
  const args = process.argv.slice(2);
  const root = resolve('data/games');
  const paths = args.includes('--all')
    ? (existsSync(root) ? readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory()) : [])
    : args.filter((a) => !a.startsWith('--'));
  if (!paths.length) { console.log('Uso: npm run narrator-count -- data/games/<partida> [otra…] | --all'); return; }
  const total: NarratorStats = { talk_turns: 0, narrator_bubbles: 0, turns_with_narrator: 0, leads: 0, words_per_turn: 0 };
  let words = 0;
  console.log('partida | turnos de charla | burbujas del narrador | por 10 turnos | turnos con narrador | acotaciones en burbuja | palabras por turno');
  for (const p of paths) {
    const evs = loadEvents(p);
    const s = narratorStats(args.includes('--simulate') ? simulate(evs) : evs);
    if (!s.talk_turns) continue;
    console.log(`${p.split(/[\\/]/).pop()} | ${s.talk_turns} | ${s.narrator_bubbles} | ${per10(s)} | ${s.turns_with_narrator} | ${s.leads} | ${s.words_per_turn}`);
    total.talk_turns += s.talk_turns; total.narrator_bubbles += s.narrator_bubbles; total.turns_with_narrator += s.turns_with_narrator; total.leads += s.leads;
    words += s.words_per_turn * s.talk_turns;
  }
  total.words_per_turn = total.talk_turns ? Math.round((words / total.talk_turns) * 10) / 10 : 0;
  console.log(`TOTAL | ${total.talk_turns} | ${total.narrator_bubbles} | ${per10(total)} | ${total.turns_with_narrator} | ${total.leads} | ${total.words_per_turn}`);
}

if (process.argv[1] && /narrator-count\.ts$/.test(process.argv[1])) main();
