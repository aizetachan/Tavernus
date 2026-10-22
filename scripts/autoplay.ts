/**
 * Partidas automáticas para recoger errores del máster: un jugador automático (un modelo barato)
 * juega N acciones en mundos generados y luego el juez (scripts/judge.ts) lee los logs.
 *
 *   npm run autoplay -- --dry-run                          clientes falsos para todo, no llama a la API
 *   npm run autoplay -- --games 3 --actions 10             solo imprime la estimación de coste
 *   npm run autoplay -- --games 3 --actions 10 --live      partidas reales (gasta dinero)
 *
 * Modelos: MASTER_MODEL (máster), PLAYER_MODEL (jugador), WORLDGEN_MODEL (mundo) y JUDGE_MODEL (juez);
 * por defecto los cuatro claude-haiku-5-5. Cada partida queda en <games-dir>/auto-<fecha>-<n> (una
 * partida normal del gestor, se puede abrir en la web) y el resumen con tokens y coste en
 * data/local/autoplay/<fecha>/summary.json; el informe del juez, en el mismo sitio (report.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import type { Engine } from '../src/engine/engine.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import { seededRng, type Rng } from '../src/engine/dice.js';
import { GameManager } from '../src/games/manager.js';
import { liveClient, Master, type MasterClient } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { generateSeed, situationText, TONES } from '../src/worldgen/index.js';
import { CLASSES, RACES } from '../src/data/srd/index.js';
import { BASELINE_CALL, costUsd, usd, type TokenUsage } from './bench-prices.js';
import { judgeRun } from './judge.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** master.ts escribe la caché con ttl 1h, que la API cobra al doble de la entrada. */
export const MASTER_CACHE_WRITE_MULT = 2;
/** Probabilidad de que el jugador elija una acción sugerida (si las hay); si no, escribe una propia. */
export const SUGGESTED_P = 0.6;
/** Segundos reales entre acciones: menos que la ventana decisiva (60 s), como un jugador que contesta. */
const STEP_REAL_S = 20;
const MAX_ROLLS_PER_ACTION = 2;

/** Ganas de liarla: lo que el jugador intenta cuando escribe su propia acción. `dry` es lo que escribe el cliente falso. */
export const IMPULSES: { id: string; prompt: string; dry: string }[] = [
  { id: 'regatear', prompt: 'regatear el precio de algo con quien tengas delante', dry: 'Le digo que eso es un robo y le ofrezco la mitad.' },
  { id: 'mentir', prompt: 'mentir con descaro para sacar ventaja (fingir ser alguien, inventar una excusa)', dry: 'Le aseguro que vengo de parte del alcalde y que me debe un favor.' },
  { id: 'colarse', prompt: 'intentar colarte donde no deberías (una trastienda, un piso de arriba, una puerta cerrada)', dry: 'Me cuelo por la puerta de atrás cuando nadie mira.' },
  { id: 'fiado', prompt: 'pedir algo fiado, prometiendo pagar más tarde', dry: 'Le pido que me lo fíe y prometo pagarle mañana.' },
  { id: 'empenar', prompt: 'empeñar o dejar en prenda algo que lleves a cambio de algo', dry: 'Le dejo mi cuerda en prenda a cambio de una comida caliente.' },
  { id: 'amenazar', prompt: 'amenazar a alguien para conseguir lo que quieres', dry: 'Le agarro del cuello de la camisa y le digo que hable o lo lamentará.' },
  { id: 'inexistente', prompt: 'preguntar por algo que probablemente no existe aquí (un gremio de magos, un dragón dorado, un barco volador, la torre del archimago)', dry: 'Pregunto dónde está la torre del archimago y su biblioteca de pergaminos.' },
];

const NAMES = ['Aldara', 'Bruno', 'Ciro', 'Dalia', 'Elmo', 'Fiona', 'Gaspar', 'Hilda', 'Iker', 'Jimena', 'Lope', 'Mirela'];
const HOOKS = [
  'Busca a su hermana, que desapareció hace un mes en este pueblo.',
  'Huye de un acreedor y necesita dinero rápido.',
  'Viene a cobrar una herencia que nadie quiere darle.',
  'Le han contratado para entregar un paquete y ha perdido la dirección.',
  'Quiere hacerse un nombre, cueste lo que cueste.',
];

/** Cliente de texto (jugador y juez): el mismo contrato que el del máster. */
export type TextClient = MasterClient;

export interface PlayerTurn {
  i: number;
  mode: 'suggested' | 'own';
  impulse: string | null;
  text: string;
  ok: boolean;
  /** Texto que vio el jugador cuando la acción no fue bien (máster sin respuesta, espera, etc.). */
  engine_text: string | null;
  rolls: number;
  usage: TokenUsage;
  /** Eventos del máster que generó esta acción (incluidos los de la tirada). */
  event_ids: string[];
}

export interface GameSummary {
  n: number;
  slug: string;
  dir: string;
  campaign_id: string;
  world: { seed: number; tone: string; model: string; cost_usd: number };
  character: { id: string; name: string; race: string; class: string; hook: string; situation: string | null };
  actions: PlayerTurn[];
  master: TokenUsage & { calls: number; cost_usd: number | null; models: string[] };
  player: TokenUsage & { calls: number; cost_usd: number | null };
  cost_usd: number | null;
  failures: number;
  wall_ms: number;
}

export interface AutoplayRun {
  version: 1;
  dry_run: boolean;
  stamp: string;
  started_at: string;
  models: { master: string; player: string; worldgen: string; judge: string };
  seed: number;
  games_planned: number;
  actions_per_game: number;
  games: GameSummary[];
  /** Partidas que no llegaron a terminar. */
  errors: string[];
  totals: { cost_usd: number | null; master_usd: number | null; player_usd: number | null; worldgen_usd: number; actions: number; master_calls: number; failures: number };
}

const ZERO = (): TokenUsage => ({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
const addUsage = (a: TokenUsage, b: Partial<TokenUsage>) => { a.input += b.input ?? 0; a.output += b.output ?? 0; a.cache_read += b.cache_read ?? 0; a.cache_write += b.cache_write ?? 0; };
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length]!;
const sumCost = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0));

function textOf(m: Anthropic.Beta.BetaMessage): string {
  return m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function usageOf(m: Anthropic.Beta.BetaMessage): TokenUsage {
  return { input: m.usage.input_tokens, output: m.usage.output_tokens, cache_read: m.usage.cache_read_input_tokens ?? 0, cache_write: m.usage.cache_creation_input_tokens ?? 0 };
}

function fakeMessage(model: string, text: string, usage: TokenUsage): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_fake_${Math.random().toString(36).slice(2, 10)}`, type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: usage.cache_read, cache_creation_input_tokens: usage.cache_write },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** Máster falso: el offline (log_event plausible desde el contexto) con el consumo base, para que el coste salga. */
export function dryMasterClient(): MasterClient {
  const inner = offlineClient();
  let n = 0;
  return {
    async create(params) {
      const res = await inner.create(params);
      const cold = n++ === 0;
      return { ...res, model: params.model, usage: { ...res.usage, input_tokens: BASELINE_CALL.input, output_tokens: BASELINE_CALL.output, cache_read_input_tokens: cold ? 0 : BASELINE_CALL.cache_read, cache_creation_input_tokens: cold ? BASELINE_CALL.cache_read : 0 } } as Anthropic.Beta.BetaMessage;
    },
  };
}

/** Jugador falso: en modo sugerida contesta un número; en modo propio, la frase de su impulso. */
export function dryPlayerClient(): TextClient {
  return {
    async create(params) {
      const prompt = params.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      const impulse = IMPULSES.find((x) => prompt.includes(x.prompt));
      const text = /Responde SOLO con el número/.test(prompt) ? '1' : impulse?.dry ?? 'Miro alrededor con calma.';
      return fakeMessage(params.model, text, { input: 450, output: 20, cache_read: 0, cache_write: 0 });
    },
  };
}

// ---------------------------------------------------------------------------
// Jugador automático
// ---------------------------------------------------------------------------

/** Ficha corta: lo que el jugador sabe de su personaje. */
export function playerSheet(engine: Engine, c: Character): string {
  const items = engine.world.itemsCarriedBy(c.id).map((i) => { const d = engine.world.itemDef(i.item_id); return i.quantity > 1 ? `${d.name} ×${i.quantity}` : d.name; });
  const race = RACES.find((r) => r.id === c.race_id)?.name ?? c.race_id;
  return `${c.name}, ${race.toLowerCase()} ${c.class_name.toLowerCase()} de nivel ${c.level}. PG ${c.hp_current}/${c.hp_max}. Monedas: ${c.coins}. Lleva: ${items.join(', ') || 'nada'}.`;
}

export const PLAYER_SYSTEM = 'Juegas a un juego de rol por chat en castellano: eres el jugador, no el narrador. Contestas solo con lo que hace o dice tu personaje, en primera persona, en una o dos frases (25 palabras como mucho), sin comillas de apertura ni explicaciones. Juegas con ganas: quieres avanzar en tu situación y a veces pones a prueba al narrador.';

export function playerPrompt(o: { sheet: string; situation: string | null; last: string; suggested: string[]; mode: 'suggested' | 'own'; impulse: { prompt: string } | null }): string {
  const parts = [`## Tu personaje\n${o.sheet}`];
  if (o.situation) parts.push(`## Tu situación\n${o.situation}`);
  parts.push(`## Lo último que ha pasado\n${o.last || '(empieza la partida)'}`);
  if (o.suggested.length) parts.push(`## Acciones sugeridas\n${o.suggested.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  parts.push(o.mode === 'suggested'
    ? 'Elige la acción sugerida que más te apetezca. Responde SOLO con el número.'
    : `Escribe tu propia acción (no copies las sugeridas). Esta vez te apetece ${o.impulse?.prompt ?? 'hacer algo propio'}; hazlo de forma que encaje con la escena.`);
  return parts.join('\n\n');
}

/** Número elegido → acción sugerida; si no se entiende, la primera. */
export function parseSuggestedChoice(text: string, suggested: string[]): string {
  const n = Number(/\d+/.exec(text)?.[0]);
  return suggested[n - 1] ?? suggested.find((s) => text.toLowerCase().includes(s.toLowerCase())) ?? suggested[0]!;
}

/** Limpia la acción propia: una línea, sin comillas sueltas, con tope. */
export function cleanOwnAction(text: string): string {
  const line = (text.split('\n').find((l) => l.trim()) ?? '').trim().replace(/^["«“'\s]+|["»”'\s]+$/g, '');
  return line.slice(0, 300) || 'Miro alrededor.';
}

// ---------------------------------------------------------------------------

export interface AutoplayOptions {
  games: number;
  actions: number;
  seed: number;
  models: AutoplayRun['models'];
  dryRun: boolean;
  gamesDir: string;
  outDir: string;
  stamp: string;
  /** Clientes reales; en dry-run se usan los falsos. */
  masterClient?: MasterClient;
  playerClient?: TextClient;
  log?: (s: string) => void;
}

export async function runAutoplay(opts: AutoplayOptions): Promise<AutoplayRun> {
  const log = opts.log ?? (() => undefined);
  const { models } = opts;
  // El máster lee MASTER_MODEL por encima del modelo de la campaña (effectiveModel).
  process.env['MASTER_MODEL'] = models.master;
  const masterClient = opts.dryRun ? dryMasterClient() : opts.masterClient ?? liveClient();
  const playerClient = opts.dryRun ? dryPlayerClient() : opts.playerClient ?? liveClient(30_000);
  let clock = Date.now();
  const env = { ...process.env, IMAGES: 'off', WORLDGEN_MODEL: models.worldgen };
  const manager = new GameManager({
    root: opts.gamesDir, env, log: (m) => log(`    ${m}`),
    engine: { now: () => clock },
    masterFor: (engine, _g, _p, rng) => new Master(engine, { client: masterClient, ...(rng ? { rng } : {}) }),
    // Si el relleno con un modelo pequeño no valida, mundo offline: el piloto mide al máster, no al generador.
    worldgen: async (o) => {
      try { return await generateSeed({ ...o, model: models.worldgen, ...(opts.dryRun ? { client: null } : {}) }); } catch (e) {
        log(`    [worldgen] ${(e as Error).message.slice(0, 160)} → mundo offline`);
        return generateSeed({ ...o, client: null });
      }
    },
  });

  const run: AutoplayRun = {
    version: 1, dry_run: opts.dryRun, stamp: opts.stamp, started_at: new Date().toISOString(), models, seed: opts.seed,
    games_planned: opts.games, actions_per_game: opts.actions, games: [], errors: [],
    totals: { cost_usd: 0, master_usd: 0, player_usd: 0, worldgen_usd: 0, actions: 0, master_calls: 0, failures: 0 },
  };
  mkdirSync(opts.outDir, { recursive: true });
  const save = () => writeFileSync(join(opts.outDir, 'summary.json'), JSON.stringify(run, null, 2));

  const playOne = async (n: number): Promise<void> => {
    const t0 = Date.now();
    const rng = seededRng(opts.seed * 1000 + n);
    const name = pick(rng, NAMES);
    const race = pick(rng, RACES);
    const klass = pick(rng, CLASSES);
    const hook = pick(rng, HOOKS);
    const tone = TONES[(opts.seed + n) % TONES.length]!;
    log(`partida ${n}/${opts.games}: ${name}, ${race.name} ${klass.name}, tono ${tone}`);
    const { game, character_id } = await manager.create({
      name: `auto-${opts.stamp}-${n}`, mode: 'live', dice_seed: (opts.seed * 1000 + n) >>> 0,
      character: { name, race_id: race.id, class_id: klass.id, hook },
      world: { seed: (opts.seed * 7919 + n) >>> 0, tone, setting: '' },
    });
    const engine = await manager.open(game.slug);
    const c = engine.world.character(character_id!);
    const gen = engine.world.campaign.generation;

    const masterEvents = (): GameEvent[] => engine.events.all().filter((e) => e.actor_id === c.id && e.payload['master']);
    const settle = async () => { for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r)); };
    const intro = await engine.introduce(c.id);
    let last = intro?.text ?? c.situation?.opening ?? '';
    let suggested = intro?.suggested_actions ?? [];
    const actions: PlayerTurn[] = [];
    const player = { ...ZERO(), calls: 0 };

    for (let i = 1; i <= opts.actions; i++) {
      const mode: PlayerTurn['mode'] = suggested.length && rng() < SUGGESTED_P ? 'suggested' : 'own';
      const impulse = mode === 'own' ? pick(rng, IMPULSES) : null;
      const prompt = playerPrompt({ sheet: playerSheet(engine, c), situation: c.situation ? situationText(engine.world, c.situation) : null, last, suggested, mode, impulse });
      // Sin pensamiento: Haiku 5.5 piensa por defecto y se comía el tope de salida sin llegar a escribir la acción.
      const res = await playerClient.create({ model: models.player, max_tokens: 200, thinking: { type: 'disabled' }, system: PLAYER_SYSTEM, messages: [{ role: 'user', content: prompt }] });
      const pu = usageOf(res);
      addUsage(player, pu); player.calls++;
      const text = mode === 'suggested' ? parseSuggestedChoice(textOf(res), suggested) : cleanOwnAction(textOf(res));

      const before = new Set(masterEvents().map((e) => e.id));
      let r = await engine.act(c.id, text);
      const texts = [r.text];
      let rolls = 0;
      for (; r.requires_roll && rolls < MAX_ROLLS_PER_ACTION; rolls++) { r = await engine.rollPending(c.id); texts.push(r.text); }
      clock += STEP_REAL_S * 1000;
      await engine.tick();
      for (let k = 0; c.transit && k < 120; k++) { clock += 5000; await engine.tick(); }
      await settle();
      const fresh = masterEvents().filter((e) => !before.has(e.id));
      last = texts.join('\n\n');
      suggested = r.suggested_actions ?? [];
      actions.push({ i, mode, impulse: impulse?.id ?? null, text, ok: r.ok, engine_text: r.ok ? null : r.text, rolls, usage: pu, event_ids: fresh.map((e) => e.id) });
      log(`  ${String(i).padStart(2)} ${r.ok ? '✓' : '✗'} [${mode === 'own' ? impulse!.id : 'sugerida'}] ${text.slice(0, 70)}${rolls ? ` · 🎲×${rolls}` : ''}`);
    }
    await engine.flush();

    // Coste del máster: todos sus eventos de la partida (intro, acciones, tiradas, llegadas).
    const master = { ...ZERO(), calls: 0, cost_usd: 0 as number | null, models: [] as string[] };
    const costs: (number | null)[] = [];
    for (const e of masterEvents()) {
      const m = e.payload['master'] as { model: string; usage: TokenUsage };
      addUsage(master, m.usage); master.calls++;
      if (!master.models.includes(m.model)) master.models.push(m.model);
      costs.push(costUsd(m.usage, m.model, MASTER_CACHE_WRITE_MULT));
    }
    master.cost_usd = sumCost(costs);
    const playerCost = costUsd(player, models.player);
    const worldCost = gen?.cost_usd ?? 0;
    const summary: GameSummary = {
      n, slug: game.slug, dir: manager.paths(game).dir, campaign_id: game.campaign_id,
      world: { seed: game.world?.seed ?? 0, tone, model: gen?.model ?? 'offline', cost_usd: worldCost },
      character: { id: c.id, name, race: race.name, class: klass.name, hook, situation: c.situation ? situationText(engine.world, c.situation) : null },
      actions, master, player: { ...player, cost_usd: playerCost },
      cost_usd: sumCost([master.cost_usd, playerCost, worldCost]),
      failures: actions.filter((a) => !a.ok).length,
      wall_ms: Date.now() - t0,
    };
    run.games.push(summary);
    await manager.close(game.slug);
    log(`  → ${summary.slug}: máster ${usd(master.cost_usd)} (${master.calls} llamadas), jugador ${usd(playerCost)}, mundo ${usd(worldCost)}; ${summary.failures} fallos`);
    save();
  };
  // Una partida que revienta no tumba el piloto: queda anotada y se sigue con la siguiente.
  for (let n = 1; n <= opts.games; n++) {
    try { await playOne(n); } catch (e) {
      log(`  ✗ partida ${n}: ${(e as Error).stack ?? (e as Error).message}`);
      run.errors.push(`partida ${n}: ${(e as Error).message}`);
      await manager.closeAll().catch(() => undefined);
    }
  }

  const g = run.games;
  run.totals = {
    master_usd: sumCost(g.map((x) => x.master.cost_usd)), player_usd: sumCost(g.map((x) => x.player.cost_usd)),
    worldgen_usd: g.reduce((a, x) => a + x.world.cost_usd, 0), cost_usd: sumCost(g.map((x) => x.cost_usd)),
    actions: g.reduce((a, x) => a + x.actions.length, 0), master_calls: g.reduce((a, x) => a + x.master.calls, 0), failures: g.reduce((a, x) => a + x.failures, 0),
  };
  save();
  return run;
}

/**
 * Estimación previa con lo medido: 0,13 céntimos por llamada al máster con Haiku y ~1,4 llamadas por acción
 * (tiradas y llegadas); mundo con Haiku ~0,6 céntimos; jugador y juez, migajas.
 */
export function estimate(games: number, actions: number, models: AutoplayRun['models']): { total: number | null; master: number | null; worldgen: number | null; player: number | null; judge: number | null } {
  const scale = (model: string) => { const c = costUsd({ input: 1e6, output: 0, cache_read: 0, cache_write: 0 }, model); return c === null ? null : c / 0.1; };
  const m = scale(models.master); const w = scale(models.worldgen); const p = scale(models.player); const j = scale(models.judge);
  const master = m === null ? null : games * (actions + 1) * 1.4 * 0.0013 * m;
  const worldgen = w === null ? null : games * 0.006 * w;
  const player = p === null ? null : games * actions * 0.0001 * p;
  const judge = j === null ? null : games * Math.ceil(actions / 10) * 0.0015 * j;
  return { master, worldgen, player, judge, total: sumCost([master, worldgen, player, judge]) };
}

export function stampOf(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      games: { type: 'string', default: '3' }, actions: { type: 'string', default: '10' }, seed: { type: 'string', default: '1' },
      'dry-run': { type: 'boolean', default: false }, live: { type: 'boolean', default: false }, 'no-judge': { type: 'boolean', default: false },
      'games-dir': { type: 'string' }, out: { type: 'string', default: 'data/local/autoplay' },
    },
  });
  const games = Number(values.games); const actions = Number(values.actions); const seed = Number(values.seed);
  if (![games, actions, seed].every((x) => Number.isInteger(x) && x >= 0) || games < 1 || actions < 1) throw new Error('--games, --actions y --seed deben ser enteros positivos');
  const dryRun = values['dry-run'];
  const env = (k: string) => process.env[k]?.trim() || DEFAULT_MODEL;
  const models = { master: env('MASTER_MODEL'), player: env('PLAYER_MODEL'), worldgen: env('WORLDGEN_MODEL'), judge: env('JUDGE_MODEL') };
  const est = estimate(games, actions, models);
  console.log(`${games} partidas × ${actions} acciones · máster ${models.master} · jugador ${models.player} · mundo ${models.worldgen} · juez ${models.judge}`);
  console.log(`Estimación: ${usd(est.total, 3)} (máster ${usd(est.master, 3)}, mundos ${usd(est.worldgen, 3)}, jugador ${usd(est.player, 3)}, juez ${usd(est.judge, 3)}).`);
  if (!dryRun && !values.live) {
    console.log('\nNo se ha llamado a la API. Para partidas reales añade --live (gasta dinero); para probar el montaje, --dry-run.');
    return;
  }
  if (!dryRun && !Master.configured('live')) throw new Error('Falta ANTHROPIC_API_KEY (o ANTHROPIC_AUTH_TOKEN) para --live.');

  const stamp = `${dryRun ? 'dry-' : ''}${stampOf(new Date())}`;
  const outDir = resolve(values.out, stamp);
  // En dry-run las partidas van junto al resumen: no ensucian el menú de partidas de la web.
  const gamesDir = resolve(values['games-dir'] ?? (dryRun ? join(outDir, 'games') : process.env['GAMES_DIR'] ?? 'data/games'));
  const run = await runAutoplay({ games, actions, seed, models, dryRun, gamesDir, outDir, stamp, log: (s) => console.log(s) });
  const t = run.totals;
  console.log(`\n${dryRun ? '[dry-run] ' : ''}${run.games.length} partidas, ${t.actions} acciones, ${t.master_calls} llamadas al máster, ${t.failures} fallos`);
  console.log(`  coste: ${usd(t.cost_usd, 4)} (máster ${usd(t.master_usd, 4)}, jugador ${usd(t.player_usd, 4)}, mundos ${usd(t.worldgen_usd, 4)})`);
  console.log(`  → ${join(outDir, 'summary.json')}`);
  if (values['no-judge']) return;
  const report = await judgeRun({ runDir: outDir, model: models.judge, dryRun, useModel: true, log: (s) => console.log(s) });
  console.log(`  juez: ${report.findings.length} errores (${usd(report.judge_cost_usd, 4)}) → ${report.file}`);
}

if (process.argv[1] && /autoplay\.ts$/.test(process.argv[1])) {
  main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
}
