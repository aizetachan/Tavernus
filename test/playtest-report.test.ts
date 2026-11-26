import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MasterClient } from '../src/ai/master.js';
import type { GameEvent } from '../src/engine/model.js';
import { dryMasterClient, dryPlayerClient, PROFILES, runAutoplay, type AutoplayRun, type GameSummary, type PlayerProfile, type TextClient } from '../scripts/autoplay.js';
import { loadGame } from '../scripts/judge.js';
import { analyzeGame, buildPlaytest, buildWindowSection, declaresStrike, transcriptOf, trueEnd, windowMetrics, withTrueEnds } from '../scripts/playtest-report.js';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'playtest', name), 'utf8')) as T;

describe('golpes declarados (H2 y H6)', () => {
  it('cuenta los golpes de verdad, también los que no usan «ataco»', () => {
    for (const t of [
      'Atacar a Hugo con el hacha',
      'Le hundo el puño en las costillas al molinero y, cuando se doble, le arranco la camisa.',
      'Ciro sacude al molinero contra los sacos y le planta la frente en la cara: ¡Mentira!',
      'Con el costado ardiendo, me revuelvo y le clavo el hombro en el pecho para tirarle contra el crisol.',
      'Antes de que Hugo lo toque, le pego un empujón contra la pared y le meto el mango en el pecho.',
      'Disparo a la diana con mi arco.',
      'Apuñalo al guardia por la espalda.',
    ]) expect(declaresStrike(t), t).toBe(true);
  });

  it('no cuenta amenazas, condicionales ni lo figurado', () => {
    for (const t of [
      'Hugo, suelta ese martillo o te parto el otro hombro y busco yo lo que guardas en esa fragua.',
      '¡Un paso más y te parto el yelmo, perro del regidor!',
      'Me incorporo de golpe entre los sacos. Si ese cabrón me ha vendido, le parto la cabeza.',
      'Agarro a Hugo por la pechera y lo arrastro hacia la puerta. Quiero ver quién hay ahí fuera, y si es el alguacil, le parto la cara.',
      'Suelto la camisa, pero le agarro del brazo y le clavo el hacha imaginaria en la mirada.',
      'Ciro aprieta más el brazo del molinero, le clava la mirada y le escupe.',
      'Garrán, si el jueves no hay plata, la próxima vez que te vea te parto las rodillas contra el banco.',
      'Le miro como si fuera a pegarle.',
      'Le digo que hable o lo lamentará.',
    ]) expect(declaresStrike(t), t).toBe(false);
  });

  it('en el violento de la tanda 20261125-1051: golpes con tirada de ataque y maniobras, no amenazas', () => {
    const f = fixture<{ game: GameSummary; events: GameEvent[] }>('violento-20261125-1051.json');
    const m = windowMetrics(f.game, f.events, 40);
    // A mano: golpes en las acciones 2, 6, 7, 17, 24 (se lanza sobre él), 29 y 32. Con tirada de ataque, 6 y 29; con
    // conflict_act (empujón o agarre), 2, 7 y 24; 17 sin nada y 32 resuelto como robo. Antes la columna decía «0 de 14».
    expect(m.attack_verbs).toBe(7);
    expect(m.attack_verbs_rolled).toBe(2);
    expect(m.attack_verbs_maneuver).toBe(3);
    // Los `attack` de Hugo son del NPC; ninguno es del PJ.
    expect(m.npc_attacks).toBeGreaterThan(0);
    const md = buildWindowSection(40, [m]);
    expect(md).toContain('| Golpes con tirada de ataque |');
    expect(md).toContain('2 de 7 (+3 maniobra)');
  });

  it('un `attack` con el PJ de atacante cuenta como golpe con tirada aunque no haya evento de tirada', () => {
    const ev = (seq: number, payload: Record<string, unknown>) => ({ id: `e${seq}`, seq, actor_id: 'pc', action_type: 'master', input_text: 'x', narration_private: '', tags: [], payload }) as unknown as GameEvent;
    const events = [ev(1, { master: { calls: [{ name: 'attack', input: { attacker_id: 'pc', target_id: 'npc_hugo' }, result: '{"ok":true}' }] } })];
    const g = { n: 1, profile: 'violento', character: { id: 'pc' }, actions: [{ i: 1, text: 'Le estampo el puño en la cara.', event_ids: ['e1'] }] } as unknown as GameSummary;
    expect(windowMetrics(g, events, 10)).toMatchObject({ attack_verbs: 1, attack_verbs_rolled: 1, npc_attacks: 0 });
  });
});

const MODELS = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
const pairOf = (a: string, b: string) => [PROFILES.find((p) => p.id === a)!, PROFILES.find((p) => p.id === b)!] as [PlayerProfile, PlayerProfile];
const autoplayFixture = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'autoplay', name), 'utf8')) as T;

describe('partidas cortadas por un error (H7)', () => {
  // La tanda 20261125-1557 (Opus) se cortó por el límite de gasto de la API y su summary.json se quedó sin partidas.
  const cut = autoplayFixture<AutoplayRun>('summary-20261125-1557.json');
  const apiError = cut.errors[0]!.replace(/^partida \d+: /, '');

  it('guardan las acciones jugadas y su coste, con fin «error», y el informe las cuenta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-cortada-'));
    try {
      const inner = dryPlayerClient();
      let calls = 0;
      const playerClient: TextClient = { async create(p) { if (++calls > 3) throw new Error(apiError); return inner.create(p); } };
      const profiles = PROFILES.filter((p) => p.id === 'violento');
      const run = await runAutoplay({ games: 1, actions: 10, seed: 4, models: MODELS, dryRun: false, masterClient: dryMasterClient(), playerClient, gamesDir: join(dir, 'games'), outDir: join(dir, 'run'), stamp: 'test', profiles, campaign: 'brezal' });
      expect(run.errors).toEqual([`partida 1: ${apiError}`]);
      const g = run.games[0]!;
      expect(g).toMatchObject({ ended: 'error', error: apiError, profile: 'violento' });
      expect(g.actions).toHaveLength(3);
      expect(g.cost_usd).toBeGreaterThan(0);
      expect(run.totals.actions).toBe(3);
      expect(run.totals.cost_usd).toBeGreaterThan(0);
      // Lo mismo en el summary.json que queda en disco.
      const saved = JSON.parse(await readFile(join(dir, 'run', 'summary.json'), 'utf8')) as AutoplayRun;
      expect(saved.games[0]!.ended).toBe('error');
      expect(saved.totals.cost_usd).toBe(run.totals.cost_usd);
      const loaded = loadGame(g.dir, g.character.id);
      const md = buildPlaytest(run, [analyzeGame(g, loaded.events, loaded.state)], [], [], 0);
      expect(md).toContain('1 partida cortada por un error: van con las acciones y el coste que llevaban');
      expect(md).toMatch(/\| violento \| error \| 3 \|/);
      expect(md).toContain('## Partidas que no terminaron');
      expect(transcriptOf(g)).toContain(`Fin: error (${apiError})`);
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('una tanda de antes, sin resumen de las cortadas, avisa de que su gasto no está en el total', () => {
    const md = buildPlaytest(cut, [], [], [], 0);
    expect(md).toContain('2 partidas no dejaron resumen (tanda anterior a H7): lo que gastaron no está en el total.');
    expect(md).toContain('You have reached your specified API usage limits');
  });
});

describe('tope de gasto en pareja (H8)', () => {
  it('la pareja de 20261125-1703 jugó sus 40 acciones: su fin es «tope», no «presupuesto»', () => {
    const run = autoplayFixture<AutoplayRun>('summary-20261125-1703.json');
    expect(run.games.map((g) => g.ended)).toEqual(['presupuesto', 'presupuesto']);
    expect(withTrueEnds(run).games.map((g) => g.ended)).toEqual(['tope', 'tope']);
    expect(trueEnd({ ended: 'presupuesto', actions: run.games[0]!.actions.slice(0, 12) }, 40)).toBe('presupuesto');
  });

  it('si el tope se pasa en la última vuelta, el fin es «tope»', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-tope-'));
    try {
      const inner = dryMasterClient();
      let expensive = false;
      const masterClient: MasterClient = { async create(p) { const r = await inner.create(p); return expensive ? { ...r, usage: { ...r.usage, input_tokens: 50_000_000 } } as typeof r : r; } };
      const player = dryPlayerClient();
      let calls = 0;
      // 2 acciones de cada uno: 4 llamadas del jugador; desde la tercera (la última vuelta), el máster cuesta un dineral.
      const playerClient: TextClient = { async create(p) { if (++calls >= 3) expensive = true; return player.create(p); } };
      const run = await runAutoplay({ games: 1, actions: 2, seed: 11, models: MODELS, dryRun: false, masterClient, playerClient, gamesDir: join(dir, 'games'), outDir: join(dir, 'run'), stamp: 'test', pairs: [pairOf('violento', 'pausado')], campaign: 'brezal', maxUsdPerGame: 1 });
      expect(run.errors).toEqual([]);
      expect(run.games.map((g) => g.actions.length)).toEqual([2, 2]);
      expect(run.games.reduce((a, g) => a + (g.metered_usd ?? 0), 0)).toBeGreaterThan(2);
      expect(run.games.map((g) => g.ended)).toEqual(['tope', 'tope']);
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('el tope es por jugador: a dos, la partida puede gastar el doble antes de cortar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-tope2-'));
    try {
      const pair = pairOf('violento', 'pausado');
      // Lo que gasta la partida hasta acabar la primera vuelta (prólogos, presentaciones y una acción de cada uno).
      const probe = await runAutoplay({ games: 1, actions: 1, seed: 11, models: MODELS, dryRun: false, masterClient: dryMasterClient(), playerClient: dryPlayerClient(), gamesDir: join(dir, 'g0'), outDir: join(dir, 'r0'), stamp: 'probe', pairs: [pair], campaign: 'brezal' });
      const afterOne = probe.games.reduce((a, g) => a + (g.metered_usd ?? 0), 0);
      // Un tope algo por encima de la mitad: como tope de la partida cortaría tras la primera vuelta; por jugador, sigue.
      const run = await runAutoplay({ games: 1, actions: 6, seed: 11, models: MODELS, dryRun: false, masterClient: dryMasterClient(), playerClient: dryPlayerClient(), gamesDir: join(dir, 'g1'), outDir: join(dir, 'r1'), stamp: 'test', pairs: [pair], campaign: 'brezal', maxUsdPerGame: afterOne * 0.55 });
      expect(run.errors).toEqual([]);
      expect(run.games.every((g) => g.actions.length >= 2 && g.actions.length < 6)).toBe(true);
      expect(run.games.map((g) => g.ended)).toEqual(['presupuesto', 'presupuesto']);
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
