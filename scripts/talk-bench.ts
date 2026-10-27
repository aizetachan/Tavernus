/**
 * Banco de conversación con NPC (docs/CONVERSACION.md): las mismas charlas, sacadas de las partidas del
 * 26-10 y del 27-10 más el ejemplo de Doro, con varias maneras de dar voz al NPC, y un juez con rúbrica.
 *
 *   A   Haiku solo, con el prompt de antes (sin reglas de conversación, ni transcripción, ni trato).
 *   B   Haiku solo, con las reglas, la transcripción, lo que le ronda y el trato.
 *   C   Haiku director + Sonnet actor (actor.ts).
 *   C2  Haiku director + Haiku actor (el mismo borrador que C, en una partida igual recién montada).
 *   D   Sonnet para todo el turno: solo si queda presupuesto (si no, se estima con los tokens de B).
 *
 *   node --import tsx scripts/talk-bench.ts                     cliente falso, sin API (comprueba el montaje)
 *   node --env-file=<.env> --import tsx scripts/talk-bench.ts --live [--cap 0.09] [--only doro_ronda]
 *
 * Tope duro de gasto (--cap, dólares): antes de cada llamada se mira lo gastado y, si se ha llegado, no se
 * llama más. Deja un .json y un .md en data/local/bench/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { makeSeed, SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { liveClient, Master, type MasterClient } from '../src/ai/master.js';
import { performNpc, type ActorUsage } from '../src/ai/actor.js';
import type { LogEventInput } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Attitude, Character } from '../src/engine/model.js';
import { costUsd, usd } from './bench-prices.js';
import { allScheduled } from '../src/engine/schedule.js';

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
/** master.ts y actor.ts escriben la caché con ttl 1h: la API la cobra a 2× la entrada. */
const WRITE_MULT = 2;
/** Lo que puede costar la llamada más cara del banco: se deja de llamar antes de que el tope se pueda pasar. */
const RESERVE = 0.012;

export interface Scenario {
  id: string;
  from: string;
  seed: 'demo' | 'brezal';
  npc: string;
  /** Punto donde están los dos (si no, el del NPC). */
  spot?: string;
  knows: string[];
  /** Encargos que tienen que estar en el tablón. */
  jobs?: string[];
  attitude?: Attitude;
  memory?: string[];
  /** Lo que ya se dijeron, en orden: [lo que dijo el PJ (o null), lo que dijo el NPC]. */
  history?: [string | null, string][];
  text: string;
}

export const SCENARIOS: Scenario[] = [
  { id: 'doro_ronda', from: 'ejemplo del usuario (rama de prueba, 27-10)', seed: 'demo', npc: 'npc_doro', knows: ['npc_doro'], jobs: ['job_ronda'], text: '¿De qué va la ronda del claro?' },
  { id: 'brenna_dia', from: 'partida del 26-10, seq 37', seed: 'brezal', npc: 'npc_brenna', knows: [], text: 'Le pregunto a la tabernera qué tal el día' },
  {
    id: 'brenna_amiga', from: 'ejemplo del usuario (charla amistosa)', seed: 'brezal', npc: 'npc_brenna', knows: ['npc_brenna', 'npc_doro'], attitude: 'friendly',
    memory: ['Leodhin le contó que una carta con el sello de Vharn le trajo al valle y que busca a quien la mandó; le cae bien.', 'Leodhin le dejó buena propina dos noches seguidas.'],
    history: [['Buenas noches, Brenna.', 'Buenas. Siéntate donde quieras, que hoy hay sitio.']],
    text: 'Hola Brenna, ¿qué tal va el día?',
  },
  {
    id: 'ilse_brasa', from: 'partida del 27-10, seq 18-23', seed: 'brezal', npc: 'npc_ilse', spot: 'sp_pl_pozo', knows: ['npc_ilse'],
    memory: ['Leodhin le enseñó una carta con el sello de Vharn que le llegó sin remite.'],
    history: [[null, '¿Quién te ha mandado eso?'], ['¿A qué te refieres, mujer?', 'Lo que llevas en la manga, y lo que el cubo se ha tragado.'], ['Es el sello de Vharn. Llegó hace un mes, sin remite.', 'Guárdala. Aquí hasta las piedras tienen oídos, y el tablón tiene ojos.']],
    text: 'Preguntarle a Ilse qué es la Brasa',
  },
  {
    id: 'hugo_eslabones', from: 'partida del 27-10, seq 65-70', seed: 'brezal', npc: 'npc_hugo', spot: 'sp_tab_barra', knows: ['npc_hugo'],
    history: [['Hablemos de la cadena que forjó su maestro.', 'Eslabones. Hierro frío. Los guardo. Osric quiere fundirlos. Yo digo mañana.']],
    text: '¿Dónde los guardas?',
  },
  {
    id: 'brenna_rude', from: 'partida del 26-10, seq 37-42', seed: 'brezal', npc: 'npc_brenna', knows: [],
    history: [['¿Qué tal el día?', 'Igual que ayer. Con ceniza en la jarra.'], ['¿Hay descuento en la bebida?', 'Treinta la jarra. La misma para todos.']],
    text: 'no nos times mujer y danos cerveza',
  },
  {
    id: 'ilse_moribundo', from: 'partida del 26-10, seq 95-96', seed: 'brezal', npc: 'npc_ilse', spot: 'sp_cu_caldero', knows: ['npc_ilse'],
    history: [['¿No me estabas siguiendo, Ilse?', 'Te fuiste tú, corriendo, y me dejaste la olla al fuego. Yo no sigo a nadie, muchacho. Ya es bastante seguir a los muertos.']],
    text: 'pues dame algo para el moribundo',
  },
];

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

export async function setup(s: Scenario): Promise<{ engine: Engine; pc: Character }> {
  let ms = Date.UTC(2026, 9, 22, 18, 0, 0);
  const now = () => ms;
  const seed = s.seed === 'demo' ? makeSeed({ realEpochMs: SEED_REAL_EPOCH_MS }) : authoredSeed('brezal', { now: new Date(ms) });
  if (s.seed === 'demo') ms = SEED_REAL_EPOCH_MS + 3600_000;
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now, deterministic: true, fastTravel: false } as Parameters<typeof Engine.boot>[0]);
  const r = await engine.createCharacter('u_bench', 'Leodhin', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  const pc = r.character;
  const w = engine.world;
  const npc = w.npc(s.npc);
  const spot = s.spot ?? npc.location.id;
  npc.location = { type: 'spot', id: spot };
  // Que su horario no se lo lleve en mitad de la charla (Ilse y Hugo se iban en la primera pasada).
  delete (npc as { routine?: unknown }).routine;
  for (const e of allScheduled(w)) e.npc_ids = e.npc_ids.filter((id) => id !== npc.id);
  for (const id of s.jobs ?? []) if (!w.campaign.board.active_job_ids.includes(id)) w.campaign.board.active_job_ids.push(id);
  pc.location = { type: 'spot', id: spot };
  pc.knows = [...new Set([...pc.knows.filter((id) => !w.npcs.has(id)), ...s.knows])];
  // Que no haya nadie más en el punto que robe la escena: los demás PJ, lejos.
  for (const o of w.characters.values()) if (o.id !== pc.id) o.status = 'retired';
  if (s.attitude) npc.attitude.by_character[pc.id] = s.attitude;
  for (const note of s.memory ?? []) npc.memory.push({ character_id: pc.id, game_s: engine.gameNow() - 3600, note, importance: 2 });
  for (const [said, reply] of s.history ?? []) {
    engine.events.emit({
      actor_id: pc.id, action_type: 'master', input_text: said, narration_private: `${said ? `«${said}» ` : ''}«${reply}»`, observable: null,
      tags: ['social'], payload: { npc_id: npc.id, lines: [...(said ? [{ speaker: 'actor', text: said }] : []), { speaker: 'npc', npc_id: npc.id, text: reply }] },
    }, now());
    ms += 90_000;
  }
  return { engine, pc };
}

// ---------------------------------------------------------------------------
// Cliente con contador y tope; variante A: el prompt de antes
// ---------------------------------------------------------------------------

interface CallLog { model: string; input: number; output: number; cache_read: number; cache_write: number; ms: number; cost: number }

class Meter {
  spent = 0;
  calls: CallLog[] = [];
  constructor(readonly cap: number) {}
  wrap(base: MasterClient, rewrite?: (p: Anthropic.Beta.MessageCreateParamsNonStreaming) => Anthropic.Beta.MessageCreateParamsNonStreaming): MasterClient {
    return {
      create: async (p) => {
        // Margen de una llamada cara (un actor Sonnet ronda 0,01 $): el tope no se pasa ni por la última.
        if (this.spent + RESERVE > this.cap) throw new Error(`tope de gasto alcanzado (${usd(this.spent)} de ${usd(this.cap)})`);
        const t0 = Date.now();
        const res = await base.create(rewrite ? rewrite(p) : p);
        const u = { input: res.usage.input_tokens, output: res.usage.output_tokens, cache_read: res.usage.cache_read_input_tokens ?? 0, cache_write: res.usage.cache_creation_input_tokens ?? 0 };
        const cost = costUsd(u, res.model, WRITE_MULT) ?? 0;
        this.spent += cost;
        this.calls.push({ model: res.model, ...u, ms: Date.now() - t0, cost });
        return res;
      },
    };
  }
}

/** El system y el contexto como eran antes de este cambio (variante A). */
export function legacyParams(p: Anthropic.Beta.MessageCreateParamsNonStreaming): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const sys = (p.system as Anthropic.Beta.BetaTextBlockParam[]).map((b) => ({
    ...b,
    text: b.text
      .replace('uno o dos párrafos cortos de narración, unas 60-90 palabras sin contar lo que se dice', 'uno o dos párrafos cortos, unas 60-90 palabras')
      .replace('La narración, corta y fluida: lo que no haga falta ahora se cuenta cuando el jugador lo busque. Lo que se dice no se recorta: si alguien habla, habla como habla la gente.', 'Mejor un mensaje corto y fluido que uno largo; lo que no haga falta ahora, se cuenta cuando el jugador lo busque.')
      .replace(/NPC QUE CONVERSAN:[\s\S]*?\n(?=NPC QUE DECIDEN:)/, ''),
  }));
  const messages = p.messages.map((m, i) => (i === 0 && typeof m.content === 'string'
    ? { ...m, content: m.content.split('\n').filter((l, j, all) => !/^ {2}(Lo último que se han dicho|Trato con|Le ronda hoy)/.test(l) && !(/^ {4}\S/.test(l) && all.slice(0, j).reverse().find((x) => !/^ {4}\S/.test(x))?.startsWith('  Lo último que se han dicho'))).join('\n') }
    : m));
  return { ...p, system: sys, messages };
}

/** Cliente falso para comprobar el montaje sin gastar: el director cierra con una línea; el actor la adorna. */
function fakeBase(): MasterClient {
  return {
    async create(p) {
      const usage = { input_tokens: 1000, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const ctx = typeof p.messages[0]?.content === 'string' ? p.messages[0].content : '';
      const npc = /\[(npc_[a-z]+)\]/.exec(ctx)?.[1] ?? 'npc_doro';
      if (p.output_config?.format) return { id: 'f', type: 'message', role: 'assistant', model: p.model, content: [{ type: 'text', text: '{"lines": ["Pues mira, te lo cuento a mi manera.", "¿Y tú de dónde sales?"]}', citations: null }], stop_reason: 'end_turn', stop_sequence: null, usage } as unknown as Anthropic.Beta.BetaMessage;
      return {
        id: 'f', type: 'message', role: 'assistant', model: p.model, stop_reason: 'tool_use', stop_sequence: null, usage,
        content: [{ type: 'tool_use', id: 't', name: 'log_event', input: { narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: npc, lines: [{ speaker: 'npc', npc_id: npc, text: 'Respuesta del director.' }] } }],
      } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

export interface Reply { variant: string; ok: boolean; error?: string; narration: string; npc_lines: string[]; draft_lines?: string[]; cost: number; ms: number; models: string[]; actor?: ActorUsage }

async function runTurn(s: Scenario, meter: Meter, base: MasterClient, variant: string, opts: { model: string; actor: { model: string } | null; legacy?: boolean }): Promise<Reply & { draft?: LogEventInput }> {
  const { engine, pc } = await setup(s);
  process.env['MASTER_MODEL'] = opts.model;
  process.env['MASTER_EFFORT'] = 'low';
  const before = meter.calls.length;
  const spent0 = meter.spent;
  const client = meter.wrap(base, opts.legacy ? legacyParams : undefined);
  engine.attachMaster(new Master(engine, { client, rng: seededRng(7), actor: opts.actor ? { model: opts.actor.model, effort: 'low' } : null }));
  const t0 = Date.now();
  const r = await engine.act(pc.id, s.text);
  // El cierre del máster de este turno (detrás puede venir algún aviso del motor).
  const ev = engine.events.all().filter((e) => e.actor_id === pc.id && e.payload['master']).at(-1);
  const master = ev?.payload['master'] as { calls?: { name: string; input: Record<string, unknown> }[]; actor?: ActorUsage } | undefined;
  const lines = ((ev?.payload['lines'] ?? []) as { speaker: string; npc_id?: string; text: string }[]).filter((l) => l.speaker === 'npc').map((l) => l.text);
  const closeIn = master?.calls?.filter((c) => c.name === 'log_event').at(-1)?.input;
  const draftLines = ((closeIn?.['lines'] ?? []) as { speaker: string; text: string }[]).filter((l) => l?.speaker === 'npc').map((l) => l.text);
  const draft: LogEventInput | undefined = closeIn ? {
    narration_private: String(closeIn['narration_private'] ?? ''), observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null, decisive: null,
    npc_id: s.npc, lines: ((closeIn['lines'] ?? []) as { speaker: string; text: string }[]).filter((l) => l?.text).map((l) => (l.speaker === 'npc' ? { speaker: 'npc' as const, npc_id: s.npc, text: l.text } : { speaker: 'actor' as const, text: l.text })),
  } : undefined;
  return {
    variant, ok: r.ok && Boolean(ev), ...(r.ok ? {} : { error: r.text || 'sin respuesta' }), narration: ev?.narration_private ?? r.text, npc_lines: lines,
    ...(opts.actor ? { draft_lines: draftLines } : {}), cost: meter.spent - spent0, ms: Date.now() - t0, models: [...new Set(meter.calls.slice(before).map((c) => c.model))],
    ...(master?.actor ? { actor: master.actor } : {}), ...(draft ? { draft } : {}),
  };
}

/** C2: el actor Haiku sobre el borrador de C, en una partida igual recién montada (sin la respuesta de C). */
async function runActorOnly(s: Scenario, meter: Meter, base: MasterClient, draft: LogEventInput, playerText: string): Promise<Reply> {
  const { engine, pc } = await setup(s);
  const spent0 = meter.spent;
  const t0 = Date.now();
  const n = engine.world.npc(s.npc);
  const r = await performNpc({ model: HAIKU, effort: 'low', client: meter.wrap(base) }, engine, pc, n, draft, playerText, []);
  return { variant: 'C2', ok: !r.usage.kept_draft, ...(r.usage.kept_draft ? { error: r.usage.reason ?? 'se quedó el borrador' } : {}), narration: r.closed.narration_private, npc_lines: (r.closed.lines ?? []).filter((l) => l.speaker === 'npc').map((l) => l.text), draft_lines: (draft.lines ?? []).filter((l) => l.speaker === 'npc').map((l) => l.text), cost: meter.spent - spent0, ms: Date.now() - t0, models: [r.usage.model], actor: r.usage };
}

// ---------------------------------------------------------------------------
// Juez
// ---------------------------------------------------------------------------

export const RUBRIC = ['naturalidad', 'personalidad', 'coherencia', 'no_destripa', 'hilo'] as const;
export interface Verdict { scores: Record<string, Record<(typeof RUBRIC)[number], number>>; comments: Record<string, string> }

async function judge(s: Scenario, replies: Reply[], meter: Meter, base: MasterClient): Promise<Verdict | null> {
  const { engine, pc } = await setup(s);
  const n = engine.world.npc(s.npc);
  const ok = replies.filter((r) => r.ok && r.npc_lines.length);
  if (!ok.length) return null;
  // Etiquetas ciegas: X1, X2… en orden barajado con semilla fija.
  const order = [...ok].sort((a, b) => (a.variant + s.id).localeCompare(b.variant + s.id) * (s.id.length % 2 ? 1 : -1));
  const label = new Map(order.map((r, i) => [`X${i + 1}`, r.variant]));
  const prompt = [
    `Personaje no jugador: ${n.name}, ${n.role}. ${n.description}`,
    `Quiere: ${n.motivation}`,
    `SECRETO (no debe salir sin habérselo ganado el jugador): ${n.secret}`,
    `Trato con el jugador: ${s.attitude ?? n.attitude.default}${s.memory?.length ? `; recuerda: ${s.memory.join(' ')}` : '; primera vez que hablan'}.`,
    `Lo que se han dicho antes:\n${(s.history ?? []).map(([a, b]) => `${a ? `${pc.name}: «${a}»\n` : ''}${n.name}: «${b}»`).join('\n') || '(nada)'}`,
    `El jugador escribe ahora: «${s.text}»`,
    '',
    'Respuestas candidatas (lo que dice el personaje; la narración, solo como contexto):',
    ...order.map((r, i) => `X${i + 1}:\n  Dice: ${r.npc_lines.map((l) => `«${l}»`).join(' ')}\n  Narración: ${r.narration.replace(/\s+/g, ' ').slice(0, 400)}`),
    '',
    'Puntúa cada una de 1 a 5 en: naturalidad (suena a persona hablando en un chat, no a cartel ni a telegrama), personalidad (se nota quién es: carácter, ánimo, intereses, toma la iniciativa o pregunta), coherencia (encaja con el mundo y con lo que dijo antes; no inventa hechos raros), no_destripa (5 = no suelta nada del secreto que no toque; 1 = lo cuenta), hilo (sigue la conversación y contesta a lo que le preguntan). Un comentario de una frase por candidata.',
    'Responde solo con JSON: {"X1": {"naturalidad": n, "personalidad": n, "coherencia": n, "no_destripa": n, "hilo": n, "comentario": "..."}, ...}',
  ].join('\n');
  try {
    const res = await meter.wrap(base).create({ model: HAIKU, max_tokens: 3000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] });
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, Record<string, number | string>>;
    const v: Verdict = { scores: {}, comments: {} };
    for (const [k, row] of Object.entries(json)) {
      const variant = label.get(k);
      if (!variant) continue;
      v.scores[variant] = Object.fromEntries(RUBRIC.map((c) => [c, Number(row[c]) || 0])) as Verdict['scores'][string];
      v.comments[variant] = String(row['comentario'] ?? '');
    }
    return v;
  } catch (e) {
    console.warn(`[juez] ${s.id}: ${(e as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { live: { type: 'boolean', default: false }, cap: { type: 'string', default: '0.09' }, only: { type: 'string' }, 'no-d': { type: 'boolean', default: false } } });
  const live = values.live!;
  if (live && !process.env['ANTHROPIC_API_KEY'] && !process.env['ANTHROPIC_AUTH_TOKEN']) throw new Error('falta ANTHROPIC_API_KEY (node --env-file=<ruta del .env> …)');
  const meter = new Meter(live ? Number(values.cap) : Infinity);
  const base = live ? liveClient(120_000) : fakeBase();
  const scenarios = SCENARIOS.filter((s) => !values.only || values.only.split(',').includes(s.id));
  const results: { scenario: Scenario; replies: Reply[]; verdict: Verdict | null }[] = [];
  for (const s of scenarios) {
    const replies: Reply[] = [];
    const step = async (f: () => Promise<Reply>) => {
      if (meter.spent + RESERVE > meter.cap) return;
      try { replies.push(await f()); } catch (e) { console.warn(`[${s.id}] ${(e as Error).message}`); }
      const r = replies.at(-1)!;
      console.log(`[${s.id}] ${r.variant}: ${usd(r.cost)} ${r.ms} ms ${r.ok ? '' : `(fallo: ${r.error})`} — ${r.npc_lines.join(' / ').slice(0, 160)}`);
    };
    await step(() => runTurn(s, meter, base, 'A', { model: HAIKU, actor: null, legacy: true }));
    await step(() => runTurn(s, meter, base, 'B', { model: HAIKU, actor: null }));
    let draft: LogEventInput | undefined;
    await step(async () => { const r = await runTurn(s, meter, base, 'C', { model: HAIKU, actor: { model: SONNET } }); draft = r.draft; delete r.draft; return r; });
    if (draft?.lines?.some((l) => l.speaker === 'npc')) await step(() => runActorOnly(s, meter, base, draft!, s.text));
    for (const r of replies) delete (r as { draft?: unknown }).draft;
    results.push({ scenario: s, replies, verdict: null });
  }
  // D (Sonnet para todo el turno) solo en el ejemplo de Doro y si queda margen; el juez, al final, con lo que quede.
  if (!values['no-d'] && meter.spent < meter.cap * 0.6) {
    const s = results.find((r) => r.scenario.id === 'doro_ronda');
    if (s) {
      try { s.replies.push(await runTurn(s.scenario, meter, base, 'D', { model: SONNET, actor: null })); } catch (e) { console.warn(`[D] ${(e as Error).message}`); }
    }
  }
  for (const r of results) {
    for (const x of r.replies) delete (x as { draft?: unknown }).draft;
    r.verdict = await judge(r.scenario, r.replies, meter, base);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join('data', 'local', 'bench');
  mkdirSync(dir, { recursive: true });
  const out = { version: 1, live, cap: meter.cap, spent: meter.spent, started_at: stamp, calls: meter.calls, results };
  writeFileSync(join(dir, `talk-${stamp}.json`), JSON.stringify(out, null, 2), 'utf8');
  writeFileSync(join(dir, `talk-${stamp}.md`), report(out), 'utf8');
  console.log(`\nGastado: ${usd(meter.spent)} en ${meter.calls.length} llamadas. Informe: ${join(dir, `talk-${stamp}.md`)}`);
}

/** Informe en markdown: tabla de medias por variante, coste y latencia por turno, y cada charla. */
export function report(o: { live: boolean; spent: number; calls: CallLog[]; results: { scenario: Scenario; replies: Reply[]; verdict: Verdict | null }[] }): string {
  const variants = ['A', 'B', 'C', 'C2', 'D'];
  const L: string[] = [`# Banco de conversación (${o.live ? 'API real' : 'cliente falso'})`, '', `Gastado: ${usd(o.spent)} en ${o.calls.length} llamadas.`, '', '| Variante | Turnos | Naturalidad | Personalidad | Coherencia | No destripa | Hilo | Media | Coste medio | Latencia media |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const v of variants) {
    const reps = o.results.flatMap((r) => r.replies.filter((x) => x.variant === v));
    if (!reps.length) continue;
    const sc = o.results.map((r) => r.verdict?.scores[v]).filter(Boolean) as Verdict['scores'][string][];
    const avg = (k: (typeof RUBRIC)[number]) => (sc.length ? sc.reduce((s, x) => s + x[k], 0) / sc.length : NaN);
    const all = RUBRIC.map(avg);
    L.push(`| ${v} | ${reps.length} | ${all.map((x) => (Number.isNaN(x) ? '—' : x.toFixed(1))).join(' | ')} | ${Number.isNaN(all[0]!) ? '—' : (all.reduce((a, b) => a + b, 0) / all.length).toFixed(2)} | ${usd(reps.reduce((s, x) => s + x.cost, 0) / reps.length)} | ${Math.round(reps.reduce((s, x) => s + x.ms, 0) / reps.length / 100) / 10} s |`);
  }
  for (const r of o.results) {
    L.push('', `## ${r.scenario.id} (${r.scenario.from})`, '', `Jugador: «${r.scenario.text}»`, '');
    for (const x of r.replies) {
      const s = r.verdict?.scores[x.variant];
      L.push(`- **${x.variant}** (${usd(x.cost)}, ${(x.ms / 1000).toFixed(1)} s${s ? `; ${RUBRIC.map((k) => s[k]).join('/')}` : ''}): ${x.npc_lines.map((l) => `«${l}»`).join(' ') || `_${x.error ?? 'sin líneas'}_`}`);
      if (x.draft_lines?.length) L.push(`  - borrador del director: ${x.draft_lines.map((l) => `«${l}»`).join(' ')}`);
      if (r.verdict?.comments[x.variant]) L.push(`  - juez: ${r.verdict.comments[x.variant]}`);
    }
  }
  return L.join('\n');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/talk-bench.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
