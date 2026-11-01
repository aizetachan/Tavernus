/**
 * Análisis de una tanda de partidas con perfiles (scripts/autoplay.ts --profiles): fluidez, conversaciones,
 * misiones, combate y final por partida, y un juez modelo que puntúa lo que hace divertida una partida.
 *
 *   node --env-file-if-exists=.env --import tsx scripts/playtest-report.ts --run data/local/autoplay/<fecha>            solo métricas (gratis)
 *   node --env-file-if-exists=.env --import tsx scripts/playtest-report.ts --run data/local/autoplay/<fecha> --live     con el juez modelo (JUDGE_MODEL, por defecto Haiku)
 *   … --reuse                                                                                                          métricas de nuevo y el juez ya guardado (gratis)
 *   … --dry-run                                                                                                        juez falso, sin API
 *   … --window 60 --baseline data/local/autoplay/<otra fecha>                                                          métricas del plan en las primeras 60 acciones, frente a otra tanda (gratis)
 *
 * Deja <run>/playtest.md, <run>/playtest.json, <run>/playtest-judge.json y <run>/transcripts/<perfil>.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import type { GameEvent, WorldSnapshot } from '../src/engine/model.js';
import { liveClient, type MasterClient } from '../src/ai/master.js';
import { REFUSAL, type AutoplayRun, type GameSummary, type PlayerTurn } from './autoplay.js';
import { costUsd, usd, type TokenUsage } from './bench-prices.js';
import { loadGame, norm, TYPE_LABEL, type Finding, type ErrorType } from './judge.js';

/** Sin partir un emoji en dos: la API rechaza el cuerpo con medio carácter (el 🎲 de las tiradas). */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/[\uD800-\uDBFF]$/, '')}…` : s);
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');

/** Parecido por palabras con peso, sin importar el orden. */
export function similar(a: string, b: string): number {
  const set = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 3));
  const A = set(a); const B = set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---------------------------------------------------------------------------
// Métricas de cada partida, sin modelo
// ---------------------------------------------------------------------------

export interface Exchange { action: number | null; said: string; lines: string[]; narration: string }

export interface GameMetrics {
  slug: string;
  profile: string;
  character: string;
  ended: string;
  actions: number;
  level: number;
  xp: number;
  game_hours: number;
  flow: {
    wall_mean_s: number; wall_p95_s: number; motor_share: number; reply_words: number;
    rejected: { text: string; n: number }[]; rejected_total: number; no_response: number;
    repeated_narration: { action: number | null; a: string; b: string }[];
    openers: { text: string; n: number }[];
    longest_no_progress: number; no_suggestions: number; rolls_per_100: number; roll_success: number | null;
  };
  talk: {
    npcs: number; turns: number; top: { npc: string; turns: number }[]; line_words: number;
    repeated_lines: { npc: string; a: string; b: string }[]; turns_without_line: number; by_npc: Record<string, Exchange[]>;
  };
  quests: { statuses: Record<string, string>; rumors: string[]; opened: number; done: number; steps: number; clues: number; first_step_action: number | null; first_done_action: number | null; expired: string[] };
  combat: { pj_attacks: number; npc_attacks: number; unanswered: number; npc_down: number; npc_dead: string[]; pj_down: number; pj_dead: number; death_saves: number; respawns: number; hp_min_ratio: number; law: Record<string, number> };
  end: { final_quest: string | null; escalated: string[]; averted: string[]; epilogue: string };
  cost_usd: number | null;
}

const NPC_ID = /\bnpc_[a-z_]+\b/;

export function analyzeGame(g: GameSummary, events: readonly GameEvent[], state: WorldSnapshot | null): GameMetrics {
  const pc = g.character.id;
  const actions = g.actions;
  const byEvent = new Map<string, PlayerTurn>();
  for (const a of actions) for (const id of a.event_ids) byEvent.set(id, a);
  const npcName = (id: string) => state?.npcs.find((n) => n.id === id)?.name ?? id;
  const own = events.filter((e) => e.actor_id === pc);
  const narrations = own.filter((e) => e.payload['master'] && e.narration_private);

  // Fluidez
  const walls = actions.filter((a) => a.wall_ms !== undefined).map((a) => a.wall_ms! / 1000);
  const rejectedCount = new Map<string, number>();
  for (const a of actions) if (!a.ok) { const t = clip(a.engine_text ?? '', 90); rejectedCount.set(t, (rejectedCount.get(t) ?? 0) + 1); }
  const repeated: GameMetrics['flow']['repeated_narration'] = [];
  for (const [i, e] of narrations.entries()) {
    const prev = narrations.slice(Math.max(0, i - 8), i).find((p) => similar(p.narration_private, e.narration_private) >= 0.6);
    if (prev) repeated.push({ action: byEvent.get(e.id)?.i ?? null, a: clip(prev.narration_private, 140), b: clip(e.narration_private, 140) });
  }
  const openerCount = new Map<string, number>();
  for (const e of narrations) { const o = norm(e.narration_private).split(' ').slice(0, 3).join(' '); if (o) openerCount.set(o, (openerCount.get(o) ?? 0) + 1); }
  let streak = 0; let longest = 0; let key = '';
  for (const a of actions) {
    const s = a.state;
    const k = s ? `${s.steps}/${s.done}/${s.open}/${s.clues}/${s.xp}/${s.level}/${s.location}` : '';
    if (k !== key) { key = k; streak = 0; } else { streak++; longest = Math.max(longest, streak); }
  }
  const rolls = own.filter((e) => e.action_type === 'roll').map((e) => e.payload['roll'] as { label?: string; success?: boolean | null } | undefined);
  const judged = rolls.filter((r) => r && r.success !== null && r.success !== undefined);

  // Conversaciones: cada evento del máster con un NPC y lo que dijo
  const byNpc: Record<string, Exchange[]> = {};
  for (const e of narrations) {
    const npc = e.payload['npc_id'] as string | undefined;
    if (!npc || !e.input_text) continue;
    // `actor` es lo que dice el propio PJ: aquí solo cuenta lo que contesta el NPC.
    const lines = ((e.payload['lines'] as { speaker: string; text: string }[] | undefined) ?? []).filter((l) => l.speaker !== 'actor').map((l) => l.text);
    (byNpc[npcName(npc)] ??= []).push({ action: byEvent.get(e.id)?.i ?? null, said: e.input_text, lines, narration: e.narration_private });
  }
  const repeatedLines: GameMetrics['talk']['repeated_lines'] = [];
  const lineWords: number[] = [];
  let withoutLine = 0;
  for (const [npc, xs] of Object.entries(byNpc)) {
    const seen: string[] = [];
    for (const x of xs) {
      if (!x.lines.length) withoutLine++;
      for (const l of x.lines) {
        lineWords.push(words(l));
        const prev = seen.find((p) => similar(p, l) >= 0.6);
        if (prev) repeatedLines.push({ npc, a: clip(prev, 120), b: clip(l, 120) });
        seen.push(l);
      }
    }
  }

  // Misiones
  const story = (state?.characters.find((c) => c.id === pc) as { story?: { open: string[]; done: string[]; steps: string[]; expired: string[]; rumors?: Record<string, number> }; clues?: string[] } | undefined);
  const firstOf = (test: (a: PlayerTurn) => boolean) => actions.find(test)?.i ?? null;

  // Combate
  const master = own.filter((e) => e.payload['master']);
  const callsOf = (e: GameEvent) => (e.payload['master'] as { calls?: { name: string; result: string; input: Record<string, unknown> }[] }).calls ?? [];
  const okAttack = (e: GameEvent) => callsOf(e).some((c) => c.name === 'attack' && !c.result.startsWith('{"error"'));
  const pjAttacks = rolls.filter((r) => /^ataque/i.test(r?.label ?? '')).length;
  const outcomes = master.filter((e) => e.action_type === 'master_roll_outcome');
  let unanswered = 0;
  for (let i = 0; i < own.length; i++) {
    const e = own[i]!;
    const r = e.action_type === 'roll' ? e.payload['roll'] as { label?: string } | undefined : null;
    if (!r || !/^ataque/i.test(r.label ?? '')) continue;
    const next = own.slice(i + 1).find((x) => x.action_type === 'master_roll_outcome');
    if (next && !okAttack(next) && !/cae|muere|desploma|huye|se rinde/i.test(next.narration_private)) unanswered++;
  }
  const count = (t: string) => events.filter((e) => e.action_type === t && (e.actor_id === pc || e.payload['character_id'] === pc)).length;
  const hpRatios = actions.filter((a) => a.state && a.state.hp_max).map((a) => a.state!.hp / a.state!.hp_max);
  const law: Record<string, number> = {};
  for (const t of ['incident', 'arrest', 'jailed', 'surrender', 'resist']) { const n = events.filter((e) => e.action_type === t).length; if (n) law[t] = n; }

  const last = actions.at(-1)?.state;
  const first = actions[0]?.state;
  const statuses: Record<string, string> = {};
  for (const q of g.quests ?? []) statuses[q.id] = q.status;
  return {
    slug: g.slug, profile: g.profile ?? '', character: `${g.character.name}, ${g.character.class}`, ended: g.ended ?? '', actions: actions.length,
    level: last?.level ?? 1, xp: last?.xp ?? 0, game_hours: last && first ? (last.game_s - first.game_s) / 3600 : 0,
    flow: {
      wall_mean_s: mean(walls), wall_p95_s: quantile(walls, 0.95), motor_share: actions.length ? actions.filter((a) => a.event_ids.length === 0).length / actions.length : 0,
      reply_words: mean(actions.map((a) => words(a.reply ?? ''))),
      rejected: [...rejectedCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([text, n]) => ({ text, n })),
      rejected_total: actions.filter((a) => !a.ok).length, no_response: actions.filter((a) => /narrador no responde/i.test(a.engine_text ?? '')).length,
      repeated_narration: repeated.slice(0, 40),
      openers: [...openerCount.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([text, n]) => ({ text, n })),
      longest_no_progress: longest, no_suggestions: actions.filter((a, i) => i > 0 && a.mode === 'own' && !a.impulse).length,
      rolls_per_100: actions.length ? (rolls.length / actions.length) * 100 : 0, roll_success: judged.length ? judged.filter((r) => r!.success).length / judged.length : null,
    },
    talk: {
      npcs: Object.keys(byNpc).length, turns: Object.values(byNpc).reduce((a, x) => a + x.length, 0),
      top: Object.entries(byNpc).map(([npc, x]) => ({ npc, turns: x.length })).sort((a, b) => b.turns - a.turns).slice(0, 6),
      line_words: mean(lineWords), repeated_lines: repeatedLines.slice(0, 30), turns_without_line: withoutLine, by_npc: byNpc,
    },
    quests: {
      statuses, rumors: Object.keys(story?.story?.rumors ?? {}), opened: (story?.story?.open.length ?? 0) + (story?.story?.done.length ?? 0), done: story?.story?.done.length ?? 0,
      steps: story?.story?.steps.length ?? 0, clues: story?.clues?.length ?? 0,
      first_step_action: firstOf((a) => (a.state?.steps ?? 0) > 0), first_done_action: firstOf((a) => (a.state?.done ?? 0) > 0), expired: story?.story?.expired ?? [],
    },
    combat: {
      pj_attacks: pjAttacks, npc_attacks: master.flatMap(callsOf).filter((c) => c.name === 'attack' && !c.result.startsWith('{"error"')).length, unanswered,
      npc_down: events.filter((e) => e.action_type === 'npc_down').length,
      npc_dead: events.filter((e) => e.action_type === 'npc_death').map((e) => { const id = NPC_ID.exec(JSON.stringify(e.payload))?.[0]; return id ? npcName(id) : '?'; }),
      pj_down: count('down'), pj_dead: count('death'), death_saves: count('death_save'), respawns: count('respawn'),
      hp_min_ratio: hpRatios.length ? Math.min(...hpRatios) : 1, law,
    },
    end: { final_quest: g.final_quest ?? null, escalated: (g.escalated ?? []).filter((x) => !x.startsWith('!')), averted: (g.escalated ?? []).filter((x) => x.startsWith('!')).map((x) => x.slice(1)), epilogue: g.epilogue ?? '' },
    cost_usd: g.cost_usd,
  };
}

// ---------------------------------------------------------------------------
// Métricas del plan (docs/PLAN-ARREGLOS-PLAYTEST.md) sobre las primeras acciones
// ---------------------------------------------------------------------------

/** Declarar un golpe: las palabras con las que el jugador pega, no con las que amenaza. */
export const ATTACK_VERB = /\b(ataco|golpeo|le pego|pego a|apu[nñ]alo|clavo|hundo|estampo|le parto|te parto|rajo|disparo|lanzo el golpe|le doy un pu[nñ]etazo|descargo|arremeto|me abalanzo|embisto)\b/i;
const SOCIAL_ROLL = /Persuasi|Enga|Intimid|Interpret|Perspic/i;

export interface WindowMetrics {
  profile: string; actions: number; steps: number; done: number; clues: number; npc_run: number; refusals: number; rolls: number; social_rolls: number;
  attack_verbs: number; attack_verbs_rolled: number; npc_attacks: number; downs: number; master_turns: number; rejected_turns: number; final: string | null;
}

/** Lo que mide el plan, en las primeras `n` acciones de una partida (las misiones, sin contar las que ya traía si empezó preparada). */
export function windowMetrics(g: GameSummary, events: readonly GameEvent[], n: number): WindowMetrics {
  const pc = g.character.id;
  const actions = g.actions.slice(0, n);
  const seqOf = new Map(events.map((e) => [e.id, e.seq]));
  const lastSeq = actions.flatMap((a) => a.event_ids).reduce((m, id) => Math.max(m, seqOf.get(id) ?? 0), 0);
  const own = events.filter((e) => e.actor_id === pc && e.seq <= lastSeq);
  const roll = (e: GameEvent) => (e.payload['roll'] as { label?: string } | undefined)?.label ?? '';
  const rolls = own.filter((e) => e.action_type === 'roll');
  let cur: string | null = null; let run = 0; let best = 0;
  for (const e of own) {
    const npc = e.payload['npc_id'] as string | undefined;
    if (!npc || !e.input_text) continue;
    run = npc === cur ? run + 1 : 1; cur = npc; best = Math.max(best, run);
  }
  const verbs = actions.filter((a) => ATTACK_VERB.test(a.text));
  const rolled = verbs.filter((a) => {
    const seqs = a.event_ids.map((id) => seqOf.get(id) ?? 0);
    return seqs.length > 0 && rolls.some((r) => /^ataque/i.test(roll(r)) && r.seq >= Math.min(...seqs) && r.seq <= Math.max(...seqs));
  });
  const calls = (e: GameEvent) => (e.payload['master'] as { calls?: { name: string; result: unknown }[] } | null | undefined)?.calls ?? [];
  const masters = own.filter((e) => calls(e).length > 0);
  const end = actions.at(-1)?.state;
  return {
    profile: g.profile ?? String(g.n), actions: actions.length, steps: end?.steps ?? 0, done: (end?.done ?? 0) - (g.start_done ?? 0), clues: end?.clues ?? 0,
    npc_run: best, refusals: own.filter((e) => REFUSAL.test(e.narration_private ?? '')).length, rolls: rolls.length, social_rolls: rolls.filter((r) => SOCIAL_ROLL.test(roll(r))).length,
    attack_verbs: verbs.length, attack_verbs_rolled: rolled.length, npc_attacks: own.flatMap(calls).filter((c) => c.name === 'attack').length, downs: own.filter((e) => e.action_type === 'down').length,
    master_turns: masters.length, rejected_turns: masters.filter((e) => calls(e).some((c) => String(c.result).startsWith('{"error"'))).length, final: g.final_quest ?? null,
  };
}

/** La tabla de comparación: con `base`, cada casilla es «antes → ahora» para los perfiles que estén en las dos tandas. */
export function buildWindowSection(n: number, rows: readonly WindowMetrics[], base: readonly WindowMetrics[] = []): string {
  const cell = (r: WindowMetrics, f: (x: WindowMetrics) => string) => { const b = base.find((x) => x.profile === r.profile); return b ? `${f(b)} → ${f(r)}` : f(r); };
  const share = (x: WindowMetrics) => `${x.master_turns ? Math.round((x.rejected_turns / x.master_turns) * 100) : 0} %`;
  const out = [`## Métricas del plan en las primeras ${n} acciones`, '', base.length ? 'Cada casilla: tanda de referencia → esta tanda.' : '', '',
    '| Perfil | Mayor racha con un NPC | Negativas | Tiradas sociales | Misiones | Pasos | Pistas | Verbos de ataque con tirada | Ataques de NPC | A 0 PG | Turnos con rechazo | Final |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|'];
  for (const r of rows) out.push(`| ${r.profile} | ${cell(r, (x) => String(x.npc_run))} | ${cell(r, (x) => String(x.refusals))} | ${cell(r, (x) => String(x.social_rolls))} | ${cell(r, (x) => String(x.done))} | ${cell(r, (x) => String(x.steps))} | ${cell(r, (x) => String(x.clues))} | ${cell(r, (x) => `${x.attack_verbs_rolled} de ${x.attack_verbs}`)} | ${cell(r, (x) => String(x.npc_attacks))} | ${cell(r, (x) => String(x.downs))} | ${cell(r, share)} | ${r.final ?? '—'} |`);
  const pct = (xs: readonly WindowMetrics[]) => { const t = xs.reduce((a, x) => a + x.master_turns, 0); return t ? Math.round((xs.reduce((a, x) => a + x.rejected_turns, 0) / t) * 100) : 0; };
  out.push('', `Turnos con rechazo del máster, en conjunto: ${base.length ? `${pct(base)} % → ` : ''}${pct(rows)} %.`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Transcripción legible y juez de diversión
// ---------------------------------------------------------------------------

export function digestOf(g: GameSummary, max = 320): string {
  return g.actions.map((a) => {
    const s = a.state;
    return `#${a.i} ${a.mode === 'own' ? `[propia${a.impulse ? `: ${a.impulse}` : ''}]` : '[sugerida]'} Jugador: ${a.text}\nJuego: ${clip((a.reply ?? a.engine_text ?? '').replace(/\s+/g, ' '), max)}${s ? `\n(${s.hp_max ? `PG ${s.hp}/${s.hp_max}, ` : ''}nivel ${s.level}, ${s.location}, misiones ${s.done}, pasos ${s.steps}, pistas ${s.clues})` : ''}`;
  }).join('\n\n');
}

export function transcriptOf(g: GameSummary): string {
  const head = [`# ${g.profile} · ${g.character.name}, ${g.character.race} ${g.character.class}`, '', `Fin: ${g.ended}. Situación: ${g.character.situation ?? '—'}`, ''];
  const body = g.actions.map((a) => `## ${a.i}. ${a.mode === 'own' ? `propia, ${a.impulse ?? ''}` : 'sugerida'}${a.ok ? '' : ' · RECHAZADA'} · ${((a.wall_ms ?? 0) / 1000).toFixed(1)} s\n\n> ${a.text}\n\n${a.reply ?? a.engine_text ?? ''}\n${a.state ? `\n_PG ${a.state.hp}/${a.state.hp_max}, nivel ${a.state.level}, ${a.state.location}, misiones ${a.state.done}, pasos ${a.state.steps}, pistas ${a.state.clues}_\n` : ''}`);
  return [...head, ...body, '## Epílogo', '', g.epilogue ?? ''].join('\n');
}

export const FUN_TYPES: Record<string, string> = {
  repetitivo: 'el juego repite frases, situaciones o respuestas',
  sin_consecuencias: 'lo que hace el jugador no cambia nada: el mundo sigue igual',
  perdido: 'el jugador no sabe qué hacer ni a dónde ir, y el juego no le orienta',
  muro: 'negativa seca que corta la acción sin ofrecer otra salida',
  incoherente: 'contradice lo ya contado o el estado del mundo',
  hilo_perdido: 'olvida un hilo abierto: una promesa, un encargo, algo dicho',
  relleno: 'texto que no aporta nada: descripción vacía, ambiente repetido',
  spoiler: 'revela un secreto o el final de una misión antes de tiempo',
  mision_rota: 'una misión no avanza pese a cumplirla, o avanza sin hacerla',
  combate_plano: 'pelea sin tensión: enemigos pasivos, sin riesgo o sin consecuencias',
  final_flojo: 'desenlace sin peso o que no recoge lo jugado',
};

const FUN_SYSTEM = [
  'Valoras partidas de un juego de rol por chat en castellano como lo haría alguien que busca pasarlo bien. El jugador es automático y tiene un perfil; no le juzgas a él, sino al juego.',
  'Puntúa de 1 (malo) a 5 (muy bueno): ritmo (avanza sin atascarse), claridad (se sabe qué hacer), agencia (las decisiones cambian cosas), sorpresa (pasan cosas interesantes), tension (hay riesgo real), coherencia (el mundo se sostiene), misiones (se entienden y se pueden cumplir), conversaciones (los NPC parecen personas), combate y final (null si no los hay).',
  `Señala hasta 12 problemas, los más graves o frecuentes, con estos tipos:\n${Object.entries(FUN_TYPES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`,
  'Señala también hasta 4 momentos buenos. Cada entrada lleva número de acción y una cita literal corta (como mucho 160 caracteres).',
  'Devuelve SOLO JSON, sin texto alrededor: {"puntuaciones":{"ritmo":n,"claridad":n,"agencia":n,"sorpresa":n,"tension":n,"coherencia":n,"misiones":n,"conversaciones":n,"combate":n|null,"final":n|null},"resumen":"dos frases","problemas":[{"tipo":"…","accion":n,"gravedad":1|2|3,"cita":"…","porque":"una frase"}],"buenos":[{"accion":n,"cita":"…","porque":"una frase"}]}',
].join('\n\n');

export const TALK_TYPES: Record<string, string> = {
  repite: 'dice lo mismo que ya dijo',
  ignora_lo_dicho: 'no contesta a lo que le acaban de decir o preguntar',
  cartel: 'habla como un cartel: informa sin ser una persona',
  fuera_de_personaje: 'no encaja con quien es',
  destripa: 'suelta un secreto sin motivo',
  sin_salida: 'la charla no lleva a ningún sitio, ni da pie a seguir',
  contradice: 'contradice algo dicho antes o lo que sabe',
};

const TALK_SYSTEM = [
  'Valoras conversaciones entre un jugador y personajes no jugadores (NPC) de un juego de rol en castellano. Valoras al NPC, no al jugador.',
  'Para cada conversación puntúa de 1 a 5: natural (suena a persona), personalidad (se distingue de los demás), sigue_el_hilo (responde a lo dicho y recuerda), avanza (da algo: información, un encargo, una reacción).',
  `Señala hasta 5 problemas por conversación con estos tipos:\n${Object.entries(TALK_TYPES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`,
  'Cada problema lleva una cita literal corta. Devuelve SOLO JSON: {"conversaciones":[{"npc":"…","puntuaciones":{"natural":n,"personalidad":n,"sigue_el_hilo":n,"avanza":n},"problemas":[{"tipo":"…","cita":"…","porque":"una frase"}]}]}',
].join('\n\n');

export interface FunJudgement {
  puntuaciones: Record<string, number | null>;
  resumen: string;
  problemas: { tipo: string; accion: number; gravedad: number; cita: string; porque: string }[];
  buenos: { accion: number; cita: string; porque: string }[];
}
export interface TalkJudgement { conversaciones: { npc: string; puntuaciones: Record<string, number>; problemas: { tipo: string; cita: string; porque: string }[] }[] }
export interface GameJudge { slug: string; fun: FunJudgement | null; talk: TalkJudgement | null; errors: string[]; usage: TokenUsage; cost_usd: number | null }

/** JSON de un modelo con envoltorio tolerado. */
export function parseJson<T>(text: string): T | null {
  const body = text.replace(/```(?:json)?/gi, '');
  const a = body.indexOf('{'); const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)) as T; } catch { return null; }
}

export function talkPrompt(m: GameMetrics, top = 4, maxTurns = 30): string {
  const ranked = Object.entries(m.talk.by_npc).sort((a, b) => b[1].length - a[1].length).filter(([, x]) => x.length >= 3).slice(0, top);
  return ranked.map(([npc, xs]) => `## ${npc}\n${xs.slice(0, maxTurns).map((x) => `Jugador: ${clip(x.said, 200)}\n${npc}: ${x.lines.length ? x.lines.map((l) => clip(l, 260)).join(' / ') : `(sin palabras) ${clip(x.narration, 200)}`}`).join('\n')}`).join('\n\n');
}

async function ask(client: MasterClient, model: string, system: string, content: string, usage: TokenUsage): Promise<string> {
  // Sin pensamiento: con él, Haiku gastaba el tope de salida antes de escribir el JSON.
  const res = await client.create({ model, max_tokens: 4000, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content }] });
  usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
  usage.cache_read += res.usage.cache_read_input_tokens ?? 0; usage.cache_write += res.usage.cache_creation_input_tokens ?? 0;
  return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
}

export async function judgeFun(g: GameSummary, m: GameMetrics, client: MasterClient, model: string): Promise<GameJudge> {
  const usage: TokenUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const errors: string[] = [];
  const end = `Final: ${m.end.final_quest ?? 'ninguno'}. Fin de la partida: ${m.ended}. Nivel ${m.level}. Misiones cumplidas ${m.quests.done}.\nEpílogo:\n${clip(m.end.epilogue, 1200)}`;
  const funText = await ask(client, model, FUN_SYSTEM, `Perfil del jugador: ${g.profile}. Personaje: ${m.character}.\n\n${digestOf(g)}\n\n${end}`, usage);
  const fun = parseJson<FunJudgement>(funText);
  if (!fun) errors.push('juez de diversión: JSON inválido');
  const prompt = talkPrompt(m);
  let talk: TalkJudgement | null = null;
  if (prompt) {
    talk = parseJson<TalkJudgement>(await ask(client, model, TALK_SYSTEM, prompt, usage));
    if (!talk) errors.push('juez de conversaciones: JSON inválido');
  }
  return { slug: g.slug, fun, talk, errors, usage, cost_usd: costUsd(usage, model) };
}

export function dryFunClient(): MasterClient {
  return {
    async create(params) {
      const talk = params.system === TALK_SYSTEM;
      const text = JSON.stringify(talk
        ? { conversaciones: [{ npc: 'dry', puntuaciones: { natural: 3, personalidad: 3, sigue_el_hilo: 3, avanza: 3 }, problemas: [{ tipo: 'repite', cita: '[dry-run]', porque: 'ejemplo' }] }] }
        : { puntuaciones: { ritmo: 3, claridad: 3, agencia: 3, sorpresa: 3, tension: 3, coherencia: 3, misiones: 3, conversaciones: 3, combate: null, final: null }, resumen: '[dry-run]', problemas: [{ tipo: 'repetitivo', accion: 1, gravedad: 2, cita: '[dry-run]', porque: 'ejemplo' }], buenos: [] });
      return { id: 'msg_dry', type: 'message', role: 'assistant', model: params.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

export function buildPlaytest(run: AutoplayRun, ms: readonly GameMetrics[], judges: readonly GameJudge[], findings: readonly Finding[], judgeCost: number | null): string {
  const out: string[] = [`# Partidas por perfil · ${run.stamp}`, ''];
  const totalActions = ms.reduce((a, m) => a + m.actions, 0);
  const funCost = judges.reduce<number | null>((a, j) => (a === null || j.cost_usd === null ? null : a + j.cost_usd), 0);
  const play = run.totals.cost_usd;
  const total = play === null || funCost === null ? null : play + funCost + (judgeCost ?? 0);
  out.push(`${ms.length} partidas, ${totalActions} acciones. Modelos: máster ${run.models.master}, jugador ${run.models.player}, juez ${run.models.judge}.`, '', `Coste: partidas ${usd(play, 3)}, juez por turnos ${usd(judgeCost, 3)}, juez de diversión y charlas ${usd(funCost, 3)}. **Total ${usd(total, 3)}** (${usd(total === null || !totalActions ? null : total / totalActions, 5)} por acción).`, '');

  out.push('## Resumen', '', '| Perfil | Fin | Acciones | Nivel | Misiones | Pasos | Pistas | Final | Caídas | Horas de juego | Coste |', '|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|');
  for (const m of ms) out.push(`| ${m.profile} | ${m.ended} | ${m.actions} | ${m.level} | ${m.quests.done} | ${m.quests.steps} | ${m.quests.clues} | ${m.end.final_quest ?? '—'} | ${m.combat.pj_down} | ${m.game_hours.toFixed(0)} | ${usd(m.cost_usd, 3)} |`);

  out.push('', '## Fluidez', '', '| Perfil | Espera media | P95 | Sin máster | Palabras por respuesta | Rechazadas | Sin respuesta | Narración repetida | Mayor racha sin avance | Tiradas por 100 | Éxito |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const m of ms) { const f = m.flow; out.push(`| ${m.profile} | ${f.wall_mean_s.toFixed(1)} s | ${f.wall_p95_s.toFixed(1)} s | ${Math.round(f.motor_share * 100)} % | ${f.reply_words.toFixed(0)} | ${f.rejected_total} | ${f.no_response} | ${f.repeated_narration.length} | ${f.longest_no_progress} | ${f.rolls_per_100.toFixed(0)} | ${f.roll_success === null ? '—' : `${Math.round(f.roll_success * 100)} %`} |`); }
  const rejected = new Map<string, number>();
  for (const m of ms) for (const r of m.flow.rejected) rejected.set(r.text, (rejected.get(r.text) ?? 0) + r.n);
  if (rejected.size) { out.push('', '**Respuestas de rechazo más frecuentes:**', ''); for (const [t, n] of [...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) out.push(`- ${n} × «${esc(t)}»`); }
  const openers = new Map<string, number>();
  for (const m of ms) for (const o of m.flow.openers) openers.set(o.text, (openers.get(o.text) ?? 0) + o.n);
  if (openers.size) { out.push('', '**Arranques de narración más repetidos:**', ''); for (const [t, n] of [...openers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) out.push(`- ${n} × «${esc(t)}…»`); }

  out.push('', '## Conversaciones', '', '| Perfil | NPC | Turnos | Con quién más | Palabras por línea | Líneas repetidas | Turnos sin palabras |', '|---|---:|---:|---|---:|---:|---:|');
  for (const m of ms) out.push(`| ${m.profile} | ${m.talk.npcs} | ${m.talk.turns} | ${esc(m.talk.top.slice(0, 3).map((t) => `${t.npc} (${t.turns})`).join(', '))} | ${m.talk.line_words.toFixed(0)} | ${m.talk.repeated_lines.length} | ${m.talk.turns_without_line} |`);
  const talkScores = judges.flatMap((j) => j.talk?.conversaciones ?? []);
  if (talkScores.length) {
    const axis = ['natural', 'personalidad', 'sigue_el_hilo', 'avanza'];
    out.push('', `**Puntuación media del juez en ${talkScores.length} conversaciones (1 a 5):** ${axis.map((k) => `${k} ${mean(talkScores.map((t) => t.puntuaciones[k] ?? 0).filter(Boolean)).toFixed(1)}`).join(' · ')}.`);
    const types = new Map<string, number>();
    for (const t of talkScores) for (const p of t.problemas) types.set(p.tipo, (types.get(p.tipo) ?? 0) + 1);
    out.push('', '| Problema | Veces |', '|---|---:|');
    for (const [t, n] of [...types.entries()].sort((a, b) => b[1] - a[1])) out.push(`| ${TALK_TYPES[t] ?? t} | ${n} |`);
    out.push('', '**Ejemplos:**', '');
    for (const t of talkScores.flatMap((x) => x.problemas.slice(0, 1).map((p) => ({ npc: x.npc, p }))).slice(0, 12)) out.push(`- ${esc(t.npc)} · ${t.p.tipo}: «${esc(clip(t.p.cita, 140))}». ${esc(t.p.porque)}`);
  }

  out.push('', '## Misiones', '');
  const quests = new Map<string, Record<string, number>>();
  for (const m of ms) for (const [id, st] of Object.entries(m.quests.statuses)) { const r = quests.get(id) ?? {}; r[st] = (r[st] ?? 0) + 1; quests.set(id, r); }
  out.push('| Misión | Conocida en | Activa | Lista | Cumplida | Caducada | Fallida | Rechazada |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [id, r] of [...quests.entries()].sort()) out.push(`| ${id} | ${Object.values(r).reduce((a, x) => a + x, 0)} | ${r['active'] ?? 0} | ${r['ready'] ?? 0} | ${r['completed'] ?? 0} | ${r['expired'] ?? 0} | ${r['failed'] ?? 0} | ${r['declined'] ?? 0} |`);
  out.push('', '| Perfil | Primer paso en la acción | Primera misión cumplida en la acción | Acciones por misión |', '|---|---:|---:|---:|');
  for (const m of ms) out.push(`| ${m.profile} | ${m.quests.first_step_action ?? '—'} | ${m.quests.first_done_action ?? '—'} | ${m.quests.done ? (m.actions / m.quests.done).toFixed(0) : '—'} |`);

  out.push('', '## Combate y muerte', '', '| Perfil | Ataques del PJ | Ataques de NPC | Ataques sin respuesta | NPC derribados | NPC muertos | PJ a 0 PG | PJ muerto | Salvaciones | Reapariciones | PG mínimos | Ley |', '|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|');
  for (const m of ms) { const c = m.combat; out.push(`| ${m.profile} | ${c.pj_attacks} | ${c.npc_attacks} | ${c.unanswered} | ${c.npc_down} | ${esc(c.npc_dead.join(', ')) || '—'} | ${c.pj_down} | ${c.pj_dead} | ${c.death_saves} | ${c.respawns} | ${Math.round(c.hp_min_ratio * 100)} % | ${esc(Object.entries(c.law).map(([k, n]) => `${k} ${n}`).join(', ')) || '—'} |`); }

  out.push('', '## Final', '', '| Perfil | Final | Amenazas que pasaron | Amenazas evitadas |', '|---|---|---|---|');
  for (const m of ms) out.push(`| ${m.profile} | ${m.end.final_quest ?? '—'} | ${m.end.escalated.join(', ') || '—'} | ${m.end.averted.join(', ') || '—'} |`);

  const funs = judges.map((j) => ({ slug: j.slug, f: j.fun })).filter((x): x is { slug: string; f: FunJudgement } => x.f !== null);
  if (funs.length) {
    const axis = ['ritmo', 'claridad', 'agencia', 'sorpresa', 'tension', 'coherencia', 'misiones', 'conversaciones', 'combate', 'final'];
    out.push('', '## Diversión y fluidez según el juez (1 a 5)', '', `| Perfil | ${axis.join(' | ')} |`, `|---|${axis.map(() => '---:').join('|')}|`);
    for (const x of funs) { const m = ms.find((y) => y.slug === x.slug); out.push(`| ${m?.profile ?? x.slug} | ${axis.map((k) => x.f.puntuaciones[k] ?? '—').join(' | ')} |`); }
    out.push(`| **Media** | ${axis.map((k) => { const v = funs.map((x) => x.f.puntuaciones[k]).filter((n): n is number => typeof n === 'number'); return v.length ? mean(v).toFixed(1) : '—'; }).join(' | ')} |`);
    const types = new Map<string, { n: number; sev: number; games: Set<string> }>();
    for (const x of funs) for (const p of x.f.problemas ?? []) { const r = types.get(p.tipo) ?? { n: 0, sev: 0, games: new Set<string>() }; r.n++; r.sev += p.gravedad || 1; r.games.add(x.slug); types.set(p.tipo, r); }
    out.push('', '| Problema | Veces | Partidas | Gravedad media |', '|---|---:|---:|---:|');
    for (const [t, r] of [...types.entries()].sort((a, b) => b[1].sev - a[1].sev)) out.push(`| ${FUN_TYPES[t] ?? t} | ${r.n} | ${r.games.size} | ${(r.sev / r.n).toFixed(1)} |`);
    out.push('', '### Por partida', '');
    for (const x of funs) {
      const m = ms.find((y) => y.slug === x.slug);
      out.push(`**${m?.profile ?? x.slug}.** ${esc(x.f.resumen ?? '')}`, '');
      for (const p of [...(x.f.problemas ?? [])].sort((a, b) => (b.gravedad || 0) - (a.gravedad || 0)).slice(0, 4)) out.push(`- ✗ #${p.accion} ${p.tipo}: «${esc(clip(p.cita ?? '', 150))}». ${esc(p.porque ?? '')}`);
      for (const p of (x.f.buenos ?? []).slice(0, 2)) out.push(`- ✓ #${p.accion}: «${esc(clip(p.cita ?? '', 150))}». ${esc(p.porque ?? '')}`);
      out.push('');
    }
  }

  if (findings.length) {
    const types = new Map<string, { n: number; games: Set<string> }>();
    for (const f of findings) { const r = types.get(f.type) ?? { n: 0, games: new Set<string>() }; r.n++; r.games.add(f.game ?? ''); types.set(f.type, r); }
    out.push('## Errores del máster por turno (detectores y juez)', '', `${findings.length} errores: ${totalActions ? ((findings.length / totalActions) * 100).toFixed(0) : '—'} por cada 100 acciones. Detalle en report.md.`, '', '| Tipo | Errores | Partidas | Por 100 acciones |', '|---|---:|---:|---:|');
    for (const [t, r] of [...types.entries()].sort((a, b) => b[1].n - a[1].n)) out.push(`| ${TYPE_LABEL[t as ErrorType] ?? t} | ${r.n} | ${r.games.size} | ${totalActions ? ((r.n / totalActions) * 100).toFixed(1) : '—'} |`);
    out.push('');
  }
  if (run.errors.length) out.push('## Partidas que no terminaron', '', ...run.errors.map((e) => `- ${esc(e)}`), '');
  return out.join('\n');
}

async function main() {
  const { values } = parseArgs({ options: { run: { type: 'string' }, live: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, reuse: { type: 'boolean', default: false }, window: { type: 'string' }, baseline: { type: 'string' } } });
  if (!values.run) throw new Error('Indica --run <carpeta de la tanda>.');
  const dir = resolve(values.run);
  const run = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as AutoplayRun;
  const model = process.env['JUDGE_MODEL']?.trim() || 'claude-haiku-5-5';
  const judgeFile = join(dir, 'playtest-judge.json');
  const client = values['dry-run'] ? dryFunClient() : values.live ? liveClient(120_000) : null;
  mkdirSync(join(dir, 'transcripts'), { recursive: true });
  const ms: GameMetrics[] = [];
  const judges: GameJudge[] = values.reuse && existsSync(judgeFile) ? JSON.parse(readFileSync(judgeFile, 'utf8')) as GameJudge[] : [];
  await Promise.all(run.games.map(async (g) => {
    const loaded = loadGame(g.dir, g.character.id);
    const m = analyzeGame(g, loaded.events, loaded.state);
    ms.push(m);
    writeFileSync(join(dir, 'transcripts', `${g.profile || g.n}.md`), transcriptOf(g));
    if (client) {
      // Si un juez falla, se pierde su partida, no lo ya pagado en las demás.
      const j = await judgeFun(g, m, client, model).catch((e: unknown): GameJudge => ({ slug: g.slug, fun: null, talk: null, errors: [(e as Error).message.slice(0, 200)], usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd: 0 }));
      judges.push(j);
      console.log(`  ${g.profile}: juez ${usd(j.cost_usd, 4)}${j.errors.length ? ` · ${j.errors.join('; ')}` : ''}`);
    }
  }));
  const order = new Map(run.games.map((g, i) => [g.slug, i]));
  ms.sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
  judges.sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
  if (client) writeFileSync(judgeFile, JSON.stringify(judges, null, 2));
  const findingsFile = join(dir, 'findings.json');
  const judged = existsSync(findingsFile) ? JSON.parse(readFileSync(findingsFile, 'utf8')) as { findings: Finding[]; judge: { cost_usd: number | null } }[] : [];
  const judgeCost = judged.reduce<number | null>((a, g) => (a === null || g.judge.cost_usd === null ? null : a + g.judge.cost_usd), 0);
  const window = values.window ? Number(values.window) : null;
  if (window !== null && !(Number.isInteger(window) && window > 0)) throw new Error('--window debe ser un entero positivo');
  const windowOf = (r: AutoplayRun) => r.games.map((g) => windowMetrics(g, loadGame(g.dir, g.character.id).events, window!));
  const section = window === null ? '' : buildWindowSection(window, windowOf(run), values.baseline ? windowOf(JSON.parse(readFileSync(join(resolve(values.baseline), 'summary.json'), 'utf8')) as AutoplayRun) : []);
  writeFileSync(join(dir, 'playtest.md'), `${buildPlaytest(run, ms, judges, judged.flatMap((g) => g.findings), judgeCost)}\n${section}`);
  writeFileSync(join(dir, 'playtest.json'), JSON.stringify(ms.map(({ talk: { by_npc: _b, ...talk }, ...m }) => ({ ...m, talk })), null, 2));
  console.log(`→ ${join(dir, 'playtest.md')}`);
}

if (process.argv[1] && /playtest-report\.ts$/.test(process.argv[1])) {
  main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
}
