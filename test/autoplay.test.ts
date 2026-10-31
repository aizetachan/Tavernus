import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine/model.js';
import {
  buildReport, detectFailedToolNarrated, detectInventedPlace, detectLongNarration, detectNoResponse, detectNpcOutOfReach,
  detectPromiseWithoutState, detectRepeatedSuggestion, detectTrivialRoll, judgeRun, parseJudge, runDetectors, turnsFromEvents, type GameJudgement, type Turn,
} from '../scripts/judge.js';
import { cleanOwnAction, dryMasterClient, dryPlayerClient, estimate, FINAL_PROFILES, masterTally, parseSuggestedChoice, prepareBrezalAct, PROFILES, runAutoplay, type GameSummary } from '../scripts/autoplay.js';
import { analyzeGame, buildPlaytest, buildWindowSection, dryFunClient, judgeFun, similar, windowMetrics } from '../scripts/playtest-report.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { questStatus, storyOf } from '../src/engine/story.js';
import { claimSituation } from '../src/worldgen/index.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';
import { loadGame } from '../scripts/judge.js';

const PC = 'ch_test';
let seq = 0;
function ev(over: Partial<GameEvent> & { payload?: Record<string, unknown> }): GameEvent {
  seq++;
  return {
    id: `ev_${seq}`, seq, timestamp_real_ms: 0, timestamp_game_s: 0, campaign_id: 'demo', location_id: 'loc', spot_id: 'sp',
    actor_id: PC, action_type: 'master', input_text: 'hago algo', narration_private: 'Pasa algo.', observable: null, visibility: 'location',
    tags: ['master'], delivered_to: [], ...over, payload: over.payload ?? {},
  };
}
const master = (calls: { name: string; input?: Record<string, unknown>; result: string }[], extra: Record<string, unknown> = {}) => ({
  master: { model: 'claude-haiku-5-5', usage: { input: 10, output: 5, cache_read: 0, cache_write: 0 }, calls: calls.map((c) => ({ input: {}, ...c })), context: '## Localización: Plaza\nPuntos: …' }, ...extra,
});
const turnOf = (e: GameEvent): Turn => turnsFromEvents([e], PC)[0]!;
const OK = '{"ok":true,"closed":true}';

describe('juez: eventos → turnos', () => {
  it('toma solo los eventos del máster del PJ y une la tirada con su desenlace', () => {
    const events = [
      ev({ actor_id: 'otro', payload: master([]) }),
      ev({ input_text: 'trepo el muro', payload: master([{ name: 'log_event', result: OK }], { requires_roll: { kind: 'skill', key: 'athletics', dc: 12 } }) }),
      ev({ action_type: 'roll', payload: { roll: { label: 'Atletismo', total: 15, success: true } } }),
      ev({ action_type: 'master_roll_outcome', input_text: 'trepo el muro', narration_private: 'Subes.', payload: master([{ name: 'log_event', result: OK }]) }),
      ev({ action_type: 'move', payload: { master: null } }),
    ];
    const turns = turnsFromEvents(events, PC);
    expect(turns.map((t) => t.action_type)).toEqual(['master', 'master_roll_outcome']);
    expect(turns[1]!.roll).toMatchObject({ label: 'Atletismo', total: 15, dc: 12, success: true });
  });
});

describe('juez: detectores deterministas', () => {
  it('tool fallido narrado como hecho; no salta si la narración lo niega o se repitió bien', () => {
    const fail = '{"error":"not_enough_coins"}';
    const bad = turnOf(ev({ narration_private: 'Pagas al tabernero. Te entrega la jarra.', tags: ['master', 'tool_failed'], payload: master([{ name: 'buy_item', result: fail }, { name: 'log_event', result: OK }]) }));
    expect(detectFailedToolNarrated(bad)).toHaveLength(1);
    expect(detectFailedToolNarrated(bad)[0]!.quote).toBe('Pagas al tabernero.');
    const honest = turnOf(ev({ narration_private: 'El tabernero niega con la cabeza: no te llega. No te entrega nada.', payload: master([{ name: 'buy_item', result: fail }]) }));
    expect(detectFailedToolNarrated(honest)).toEqual([]);
    const retried = turnOf(ev({ narration_private: 'Pagas y te entrega la jarra.', payload: master([{ name: 'buy_item', result: fail }, { name: 'buy_item', result: '{"ok":true}' }]) }));
    expect(detectFailedToolNarrated(retried)).toEqual([]);
  });

  it('lugar inventado rechazado por log_event y move_to a un punto desconocido', () => {
    const t = turnOf(ev({ payload: master([
      { name: 'log_event', input: { narration_private: 'Entras en la torre del mago.' }, result: '{"error":"La narración cita «torre del mago», que no existe en Plaza. …"}' },
      { name: 'move_to', input: { target_spot_id: 'sp_torre' }, result: '{"error":"unknown_spot","detail":{}}' },
      { name: 'log_event', result: OK },
    ]) }));
    const fs = detectInventedPlace(t);
    expect(fs.map((f) => f.type)).toEqual(['lugar_inventado', 'lugar_inventado']);
    expect(fs[0]!.detail).toContain('«torre del mago»');
    expect(fs[1]!.detail).toContain('sp_torre');
  });

  it('NPC fuera de alcance', () => {
    const t = turnOf(ev({ payload: master([{ name: 'buy_item', result: '{"error":"not_reachable","detail":{"reason":"Marisa no está en esta localización"}}' }]) }));
    expect(detectNpcOutOfReach(t)).toMatchObject([{ type: 'npc_fuera_de_alcance', quote: 'Marisa no está en esta localización' }]);
  });

  it('memoria de NPC con prenda o deuda sin tool de estado ni deuda en el estado final', () => {
    const note = { name: 'log_event', input: { npc_id: 'npc_marisa', npc_memory_note: 'Le dejó su daga en prenda por la cena.' }, result: OK };
    const t = turnOf(ev({ payload: master([note]) }));
    expect(detectPromiseWithoutState(t)).toHaveLength(1);
    const withTool = turnOf(ev({ payload: master([{ name: 'pawn_item', result: '{"ok":true}' }, note]) }));
    expect(detectPromiseWithoutState(withTool)).toEqual([]);
    const state = { characters: [{ id: PC, debts: [{ npc_id: 'npc_marisa' }] }] } as never;
    expect(detectPromiseWithoutState(t, state, PC)).toEqual([]);
    // Ofertas, preguntas y negativas: se habla de deuda, pero no hay trato cerrado que anotar.
    for (const n of ['Le ofreció su cuerda a cambio de la cena; ella no la aceptó como pago.', 'Elmo le ha preguntado por la deuda que dice que tiene.', 'Le propuso que le fiara la cena hasta mañana.']) {
      expect(detectPromiseWithoutState(turnOf(ev({ payload: master([{ name: 'log_event', input: { npc_id: 'npc_marisa', npc_memory_note: n }, result: OK }]) })))).toEqual([]);
    }
    expect(detectPromiseWithoutState(turnOf(ev({ payload: master([{ name: 'log_event', input: { npc_id: 'npc_marisa', npc_memory_note: 'Marisa le fió la cena; pagará mañana.' }, result: OK }]) })))).toHaveLength(1);
    const harmless = turnOf(ev({ payload: master([{ name: 'log_event', input: { npc_id: 'npc_marisa', npc_memory_note: 'Preguntó por el camino al molino.' }, result: OK }]) }));
    expect(detectPromiseWithoutState(harmless)).toEqual([]);
  });

  it('tirada trivial: CD muy baja o acción de trámite', () => {
    const low = turnOf(ev({ input_text: 'Examino la puerta', payload: master([], { requires_roll: { kind: 'skill', key: 'investigation', dc: 5 } }) }));
    const greet = turnOf(ev({ input_text: 'Saludo al tabernero', payload: master([], { requires_roll: { kind: 'skill', key: 'persuasion', dc: 10 } }) }));
    const fair = turnOf(ev({ input_text: 'Trepo el muro mojado', payload: master([], { requires_roll: { kind: 'skill', key: 'athletics', dc: 15 } }) }));
    expect(detectTrivialRoll(low)).toHaveLength(1);
    expect(detectTrivialRoll(greet)).toHaveLength(1);
    expect(detectTrivialRoll(fair)).toEqual([]);
    const long = turnOf(ev({ input_text: 'Me acerco a la mula, le susurro y luego ofrezco el laúd al mozo a cambio de que me ayude', payload: master([], { requires_roll: { kind: 'skill', key: 'animal_handling', dc: 10 } }) }));
    expect(detectTrivialRoll(long)).toEqual([]);
  });

  it('sugerida que repite la acción recién hecha (sin tildes ni mayúsculas)', () => {
    const t = turnOf(ev({ input_text: 'Hablar con Leonor', payload: master([], { suggested_actions: ['hablar con leonor', 'Ir al muelle'] }) }));
    expect(detectRepeatedSuggestion(t)).toHaveLength(1);
    const fine = turnOf(ev({ input_text: 'Hablar con Leonor', payload: master([], { suggested_actions: ['Preguntar a Leonor por el barco', 'Ir al muelle'] }) }));
    expect(detectRepeatedSuggestion(fine)).toEqual([]);
  });

  it('narración por encima del tope y acciones sin respuesta del máster', () => {
    const long = turnOf(ev({ narration_private: Array.from({ length: 150 }, () => 'palabra').join(' '), payload: master([]) }));
    expect(detectLongNarration(long, 140)).toMatchObject([{ type: 'narracion_larga', detail: '150 palabras (tope 140)' }]);
    expect(detectLongNarration(long, 200)).toEqual([]);
    const lost = detectNoResponse([{ i: 3, mode: 'own', impulse: 'mentir', text: 'Miento', ok: false, engine_text: 'El narrador no responde ahora mismo.', rolls: 0, usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, event_ids: [] }]);
    expect(lost).toMatchObject([{ type: 'master_sin_respuesta', turn: -3 }]);
  });

  it('runDetectors junta todos los tipos de un turno', () => {
    const t = turnOf(ev({ input_text: 'Ir al muelle', payload: master([{ name: 'move_to', input: { target_spot_id: 'sp_x' }, result: '{"error":"unknown_spot"}' }], { suggested_actions: ['Ir al muelle'] }) }));
    expect(runDetectors([t]).map((f) => f.type).sort()).toEqual(['lugar_inventado', 'sugerida_repetida']);
  });
});

describe('juez modelo: parseo', () => {
  const turns = [turnOf(ev({ narration_private: 'Marisa te sirve gratis una jarra y te cuenta su secreto.', input_text: 'Le pido fiado', payload: master([]) }))];
  const idx = turns[0]!.index;

  it('acepta JSON con bloque de código y texto alrededor, y verifica la cita', () => {
    const text = `Aquí va:\n\`\`\`json\n{"findings":[{"turn":${idx},"type":"npc_fuera_de_personaje","severity":3,"quote":"te cuenta su secreto","why":"Suelta el secreto sin motivo."}]}\n\`\`\``;
    const r = parseJudge(text, turns);
    expect(r.error).toBeNull();
    expect(r.findings).toMatchObject([{ type: 'npc_fuera_de_personaje', severity: 3, quote_ok: true, layer: 'model' }]);
  });

  it('descarta tipos fuera de la lista, turnos fuera del lote y entradas sin cita; marca citas no literales', () => {
    const text = JSON.stringify({ findings: [
      { turn: idx, type: 'mala_ortografia', quote: 'x' },
      { turn: 99, type: 'regla_mal_aplicada', quote: 'x' },
      { turn: idx, type: 'promesa_sin_estado', quote: '' },
      { turn: idx, type: 'promesa_sin_estado', severity: 9, quote: 'te regala la posada', why: 'inventa' },
    ] });
    const r = parseJudge(text, turns);
    expect(r.dropped).toHaveLength(3);
    expect(r.findings).toMatchObject([{ type: 'promesa_sin_estado', severity: 3, quote_ok: false }]);
  });

  it('descarta las entradas que el propio juez desmiente', () => {
    const text = JSON.stringify({ findings: [{ turn: idx, type: 'incoherencia_contexto', severity: 1, quote: 'te cuenta su secreto', why: 'Es coherente con la escena; no hay error claro aquí, lo dejo solo como comprobación.' }] });
    const r = parseJudge(text, turns);
    expect(r.findings).toEqual([]);
    expect(r.dropped).toEqual([`retirado por el propio juez (turno ${idx})`]);
    const other = JSON.stringify({ findings: [{ turn: idx, type: 'promesa_sin_estado', quote: 'te cuenta su secreto', why: 'El turno no tiene error claro, así que este hallazgo no procede y se descarta.' }] });
    expect(parseJudge(other, turns).findings).toEqual([]);
  });

  it('errores de formato', () => {
    expect(parseJudge('no hay nada', turns).error).toBe('sin JSON');
    expect(parseJudge('{"findings": [', turns).error).toBe('sin JSON');
    expect(parseJudge('{"findings": [}', turns).error).toMatch(/JSON inválido/);
    expect(parseJudge('{"otra":1}', turns).error).toBe('falta findings[]');
    expect(parseJudge('{"findings":[]}', turns)).toEqual({ findings: [], dropped: [], error: null });
  });
});

describe('jugador automático', () => {
  it('elige la sugerida por número y limpia la acción propia', () => {
    expect(parseSuggestedChoice('2', ['a', 'b'])).toBe('b');
    expect(parseSuggestedChoice('La 7, claro', ['a', 'b'])).toBe('a');
    expect(cleanOwnAction('«Le digo que me lo fíe.»\nY sonrío.')).toBe('Le digo que me lo fíe.');
  });
});

describe('autoplay en dry-run', () => {
  it('recorre partida, jugador y juez sin API y escribe resumen e informe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-autoplay-'));
    try {
      const out = join(dir, 'run');
      const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
      const run = await runAutoplay({ games: 1, actions: 3, seed: 5, models, dryRun: true, gamesDir: join(dir, 'games'), outDir: out, stamp: 'test' });
      expect(run.games).toHaveLength(1);
      expect(run.games[0]!.actions).toHaveLength(3);
      expect(run.totals.master_calls).toBeGreaterThan(0);
      expect(run.totals.cost_usd).toBeGreaterThan(0);
      const r = await judgeRun({ runDir: out, model: models.judge, dryRun: true, useModel: true });
      const md = await readFile(r.file, 'utf8');
      expect(md).toContain('## Errores por tipo');
      expect(md).toContain('## Coste');
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('la línea de la muerte no rompe el resumen de la partida: solo guarda el modelo', () => {
    const usage = { input: 1000, output: 100, cache_read: 0, cache_write: 0 };
    const tally = masterTally([
      { payload: { master: { model: 'claude-haiku-5-5', usage } } },
      { payload: { master: 'claude-haiku-5-5' } },
    ] as unknown as GameEvent[]);
    expect(tally.calls).toBe(1);
    expect(tally.input).toBe(1000);
    expect(tally.cost_usd).toBeGreaterThan(0);
  });

  it('juega Brezal por perfiles, a la vez, y el análisis saca conversaciones, misiones y combate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-playtest-'));
    try {
      const out = join(dir, 'run');
      const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
      const profiles = PROFILES.filter((p) => p.id === 'violento' || p.id === 'charlatan');
      const run = await runAutoplay({ games: 2, actions: 3, seed: 7, models, dryRun: true, gamesDir: join(dir, 'games'), outDir: out, stamp: 'test', profiles, campaign: 'brezal', parallel: 2 });
      expect(run.errors).toEqual([]);
      expect(run.games.map((g) => g.profile)).toEqual(profiles.map((p) => p.id));
      const g = run.games[0]!;
      expect(g.campaign_id).toBe('brezal');
      expect(g.actions[0]!.state?.hp_max).toBeGreaterThan(0);
      expect(g.escalated).toContain('esc_epilogo');
      const loaded = loadGame(g.dir, g.character.id);
      const m = analyzeGame(g, loaded.events, loaded.state);
      expect(m.actions).toBe(3);
      const judge = await judgeFun(g, m, dryFunClient(), models.judge);
      const md = buildPlaytest(run, [m], [judge], [], 0);
      for (const title of ['## Fluidez', '## Conversaciones', '## Misiones', '## Combate y muerte', '## Final', '## Diversión y fluidez']) expect(md).toContain(title);
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('--start-act prepara el acto sin llamar a nadie y deja elegibles los finales', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-acto-'));
    try {
      const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
      const inner = dryMasterClient();
      let calls = 0;
      let atPrepared = -1;
      const masterClient = { create: (p: Parameters<typeof inner.create>[0]) => { calls++; return inner.create(p); } };
      const profiles = FINAL_PROFILES.filter((p) => p.id === 'dirigido-templar');
      const run = await runAutoplay({
        games: 1, actions: 2, seed: 3, models, dryRun: false, masterClient, playerClient: dryPlayerClient(), gamesDir: join(dir, 'games'), outDir: join(dir, 'run'), stamp: 'test', profiles, campaign: 'brezal', startAct: 3,
        log: (s) => { if (s.includes('preparado el acto')) atPrepared = calls; },
      });
      expect(run.errors).toEqual([]);
      expect(atPrepared).toBe(0);
      const g = run.games[0]!;
      expect(g.start_act).toBe(3);
      expect(g.start_done).toBeGreaterThanOrEqual(8);
      expect(g.actions[0]!.state?.level).toBe(3);
      expect(g.epilogue).toContain('queda abierta');
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it.each(PROFILES.map((p) => p.class_id))('la preparación del acto III vale para %s, con los tres finales elegibles', async (class_id) => {
    const time = fakeTime(Date.UTC(2026, 9, 22, 12, 0, 0));
    const seed = authoredSeed('brezal', { now: new Date(time.now()) });
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false });
    const r = await engine.createCharacter(`u_${class_id}`, 'Fen', { class_id });
    if (!r.ok) throw new Error(r.reason);
    claimSituation(engine.world, r.character.id, engine.gameNow());
    const c = r.character;
    const str = c.abilities.str;
    await prepareBrezalAct(engine, c, 3, (d) => time.advanceGame(d));
    expect(c.level).toBe(3);
    expect(c.abilities.str).toBe(str);
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === 'it_cadena_fria')).toBe(true);
    expect(engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === 'it_libro_cuentas')).toBe(true);
    expect(storyOf(engine.world)!.quests.filter((q) => q.exclusive === 'final').map((q) => questStatus(engine.world, c, q))).toEqual(['available', 'available', 'available']);
  }, 30_000);

  it('el dirigido deja a quien se niega dos veces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-dirigido-'));
    try {
      const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
      const inner = dryMasterClient();
      const says = (res: Awaited<ReturnType<typeof inner.create>>) => ({ ...res, content: res.content.map((b) => (b.type === 'tool_use' && b.name === 'log_event' ? { ...b, input: { ...(b.input as object), narration_private: 'Eso no se le cuenta a un forastero.', suggested_actions: '' } } : b)) });
      const masterClient = { create: async (p: Parameters<typeof inner.create>[0]) => says(await inner.create(p)) as Awaited<ReturnType<typeof inner.create>> };
      const run = await runAutoplay({ games: 1, actions: 4, seed: 3, models, dryRun: false, masterClient, playerClient: dryPlayerClient(), gamesDir: join(dir, 'games'), outDir: join(dir, 'run'), stamp: 'test', profiles: PROFILES.filter((p) => p.id === 'dirigido'), campaign: 'brezal' });
      expect(run.errors).toEqual([]);
      expect(run.games[0]!.actions.map((a) => a.impulse)).toContain('dejar');
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('las métricas del plan salen de los eventos y comparan dos tandas', () => {
    const ev = (seq: number, action_type: string, extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({ id: `e${seq}`, seq, actor_id: 'pc', action_type, input_text: null, narration_private: '', payload, ...extra }) as unknown as GameEvent;
    const say = (seq: number, narration_private: string) => ev(seq, 'master', { input_text: 'Ilse, dime', narration_private }, { npc_id: 'npc_ilse', master: { calls: [{ name: 'log_event', result: '{"ok":true}' }] } });
    const events = [
      say(1, 'Eso no se le cuenta a un forastero.'), say(2, 'Sigue con la corteza.'),
      ev(3, 'master', { input_text: 'Le clavo el hacha' }, { master: { calls: [{ name: 'log_event', result: '{"error":"x"}' }, { name: 'attack', result: '{"ok":true}' }] } }),
      ev(4, 'roll', {}, { roll: { label: 'Persuasión' } }), ev(5, 'down'),
      say(9, 'Eso no se le cuenta a un forastero.'),
    ];
    const turn = (i: number, text: string, ids: string[]) => ({ i, text, event_ids: ids, state: { done: 1, steps: 2, clues: 1 } });
    const g = { n: 1, profile: 'violento', character: { id: 'pc' }, final_quest: null, start_done: 1, actions: [turn(1, 'Ilse, dime', ['e1']), turn(2, 'Ilse, dime', ['e2']), turn(3, 'Le clavo el hacha', ['e3', 'e5']), turn(4, 'Ilse, dime', ['e9'])] } as unknown as GameSummary;
    const m = windowMetrics(g, events, 3);
    expect(m).toMatchObject({ actions: 3, npc_run: 2, refusals: 1, social_rolls: 1, done: 0, attack_verbs: 1, attack_verbs_rolled: 0, npc_attacks: 1, downs: 1, master_turns: 3, rejected_turns: 1 });
    const md = buildWindowSection(3, [m], [{ ...m, npc_run: 54 }]);
    expect(md).toContain('primeras 3 acciones');
    expect(md).toContain('54 → 2');
  });

  it('la estimación de Brezal usa lo medido: 0,27 céntimos por acción', () => {
    const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
    const e = estimate(1, 100, models, true);
    expect(e.master).toBeCloseTo(0.27);
    expect(e.worldgen).toBe(0);
  });

  it('la similitud ignora el orden y las palabras cortas', () => {
    expect(similar('La niebla baja por el valle', 'por el valle baja la niebla')).toBe(1);
    expect(similar('La niebla baja', 'Brenna seca jarras')).toBe(0);
  });

  it('el informe agrega por tipo y saca el top de turnos', () => {
    const g: GameJudgement = {
      slug: 'auto-x-1', character: 'Bruno', actions: 2, turns: 2, cost_usd: 0.01,
      findings: [
        { type: 'tool_fallido_narrado', layer: 'det', turn: 1, event_id: 'ev_1', severity: 3, detail: 'buy_item falló', quote: 'Pagas.', game: 'auto-x-1' },
        { type: 'regla_mal_aplicada', layer: 'model', turn: 0, event_id: 'ev_0', severity: 2, detail: 'CD absurda', quote: 'Tira', quote_ok: true, game: 'auto-x-1' },
      ],
      turn_text: { 0: { action: 'Saludo', narration: 'Tira Persuasión.' }, 1: { action: 'Compro', narration: 'Pagas.' } },
      judge: { usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost_usd: 0.001, calls: 1, parse_errors: [], dropped: [] },
    };
    const md = buildReport([g], null, 'prueba');
    expect(md).toContain('| Tool fallido narrado como hecho (`tool_fallido_narrado`) | determinista | 1 | 1 | 50.0 |');
    expect(md.indexOf('turno 1 (gravedad 3)')).toBeLessThan(md.indexOf('turno 0 (gravedad 2)'));
  });
});
