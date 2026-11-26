import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine/model.js';
import {
  buildReport, detectDealWithoutState, detectFailedToolNarrated, JUDGE_SYSTEM, judgeDropReason, noteClosesDeal, detectInventedPlace, detectLongNarration, detectNoResponse, detectNpcOutOfReach,
  detectPromiseWithoutState, detectRepeatedSuggestion, detectTrivialRoll, judgeRun, parseJudge, runDetectors, turnsFromEvents, type GameJudgement, type Turn,
} from '../scripts/judge.js';
import { applyStart, ATTEND_WANT, cleanOwnAction, dryMasterClient, playerSheet, dryPlayerClient, estimate, FINAL_PROFILES, masterTally, PAIRS, parseSuggestedChoice, playerPrompt, prepareBrezalAct, PROFILES, runAutoplay, type GameSummary, type PlayerProfile } from '../scripts/autoplay.js';
import { analyzeGame, buildPlaytest, buildWindowSection, dryFunClient, judgeFun, keyOf, similar, windowMetrics } from '../scripts/playtest-report.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { questStatus, storyOf } from '../src/engine/story.js';
import { claimSituation } from '../src/worldgen/index.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';
import { loadGame } from '../scripts/judge.js';
import { coinsOf, money } from '../src/engine/money.js';
import { spellGroups } from '../src/engine/levels.js';
import { normalize } from '../src/engine/aliases.js';
import { SPELLS } from '../src/data/srd/spells.js';
import { die } from '../src/engine/death.js';

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

describe('juez: lo inventado, el prólogo y las amenazas (H3)', () => {
  it('negar lo que el jugador inventa no es incoherencia: el prompt lo dice y el parseo lo descarta', () => {
    expect(JUDGE_SYSTEM).toMatch(/lo niega, lo corrige o no le sigue la corriente, lo hace bien/);
    // Falsos positivos de la tanda 20261125-1051 (tirador 18 y 21, informe 1).
    const turns = [
      turnOf(ev({ input_text: 'Salto al tejado del cobertizo', narration_private: 'No hay ningún tejado de cobertizo al otro lado: solo las tejas ennegrecidas de la herrería.', payload: master([]) })),
      turnOf(ev({ input_text: 'Saco un vendaje de la mochila', narration_private: 'No hay vendaje en la mochila. Sacas la ropa de viaje, rasgas dos tiras con los dientes y te ciñes el costado.', payload: master([]) })),
      turnOf(ev({ input_text: 'Busco algo con que cavar', narration_private: 'Lo único que sirve es la olla de hierro que llevas en la mochila.', payload: master([]) })),
    ];
    const text = JSON.stringify({ findings: [
      { turn: turns[0]!.index, type: 'incoherencia_contexto', quote: 'No hay ningún tejado de cobertizo al otro lado', why: 'El jugador salta a un tejado de cobertizo que la narración anterior no describe; el máster lo niega después.' },
      { turn: turns[1]!.index, type: 'incoherencia_contexto', quote: 'No hay vendaje en la mochila.', why: 'El máster niega el vendaje que el jugador dice sacar.' },
      { turn: turns[2]!.index, type: 'incoherencia_contexto', quote: 'la olla de hierro que llevas en la mochila', why: 'Se introduce un objeto que no figura en el inventario del personaje.' },
    ] });
    const r = parseJudge(text, turns);
    expect(r.findings.map((f) => f.turn)).toEqual([turns[2]!.index]);
    expect(r.dropped).toEqual([`niega lo que el jugador inventa (turno ${turns[0]!.index})`, `niega lo que el jugador inventa (turno ${turns[1]!.index})`]);
    // Otro tipo con la misma cita sí cuenta: lo que se descarta es la «incoherencia», no la negativa en seco.
    expect(judgeDropReason('imposible_sin_ingenio', 'No hay ningún tejado', 'El jugador pide saltar y el máster lo niega en seco.')).toBeNull();
  });

  it('un recuerdo de amenaza o un «le dio un aviso» no es una prenda sin estado', () => {
    // Notas reales: violento 48 de 20261125-1051 y pareja violento:pausado 38 y 40 de 20261125-1115.
    for (const n of [
      'Ciro le amenazó con el hacha en los sacos de harina y se plantó entre él y la puerta; Garrán le dio su último aviso.',
      'Fiona la amenazó con partirle el cráneo al alguacil y, tras una charla tensa, Ilse le dio una pista sobre el agua del pozo a cambio de que no pierda los nervios en su casa.',
      'Elmo se arrodilló junto a Fiona y le dio de comer, y luego miró a Hugo con el bastón en la mano.',
    ]) {
      expect(noteClosesDeal(n), n).toBe(false);
      expect(detectPromiseWithoutState(turnOf(ev({ payload: master([{ name: 'log_event', input: { npc_id: 'npc_garran', npc_memory_note: n }, result: OK }]) })))).toEqual([]);
    }
    // Una amenaza que acaba en prenda sí es trato.
    expect(noteClosesDeal('Le amenazó y al final le dejó la daga en prenda por la cena.')).toBe(true);
    expect(noteClosesDeal('Le dio tres monedas de plata por la cuerda.')).toBe(true);
  });

  it('el prólogo cuenta el pasado del PJ: su «a cambio de» no es un trato sin tool, ni cuando la narración lo repite', () => {
    // Pareja violento:pausado de 20261125-1115, turno 0.
    const told = 'Te pagó el viaje desde Valcruz a cambio de que le cubrieras la espalda, y por el camino te contó lo de su padre.';
    const prologue = turnOf(ev({ action_type: 'prologue', input_text: null, narration_private: `Estás en la herrería de Vharn. ${told}`, payload: master([]) }));
    expect(detectDealWithoutState(prologue)).toEqual([]);
    const again = turnOf(ev({ action_type: 'master_intro', input_text: null, narration_private: `Hugo cierra la puerta. ${told}`, payload: master([]) }));
    expect(detectDealWithoutState(again)).toHaveLength(1);
    expect(runDetectors([prologue, again]).filter((f) => f.type === 'trato_sin_estado')).toEqual([]);
    const fresh = turnOf(ev({ narration_private: 'Brenna te deja la jarra a cambio de que le friegues los platos esta noche.', payload: master([]) }));
    expect(runDetectors([prologue, fresh]).filter((f) => f.type === 'trato_sin_estado')).toHaveLength(1);
  });
});

describe('jugador automático', () => {
  it('elige la sugerida por número y limpia la acción propia', () => {
    expect(parseSuggestedChoice('2', ['a', 'b'])).toBe('b');
    expect(parseSuggestedChoice('La 7, claro', ['a', 'b'])).toBe('a');
    expect(cleanOwnAction('«Le digo que me lo fíe.»\nY sonrío.')).toBe('Le digo que me lo fíe.');
  });
});

describe('ficha del jugador automático (H1)', () => {
  const boot = async (class_id: string) => {
    const time = fakeTime(Date.UTC(2026, 9, 22, 12, 0, 0));
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(time.now()) }), now: time.now, deterministic: false });
    const r = await engine.createCharacter(`u_${class_id}`, 'Fen', { class_id });
    if (!r.ok) throw new Error(r.reason);
    return { engine, c: r.character };
  };

  it('el dinero sale de las bolsas, no de un campo que ya no existe', async () => {
    const { engine, c } = await boot('fighter');
    const sheet = playerSheet(engine, c);
    expect(sheet).not.toContain('undefined');
    expect(sheet).not.toContain('Monedas:');
    expect(coinsOf(engine.world, c.id)).toBeGreaterThan(0);
    expect(sheet).toContain(`Dinero: ${money(engine.world, coinsOf(engine.world, c.id))}.`);
  });

  it('un lanzador ve sus conjuros y sus usos de clase', async () => {
    const { engine, c } = await boot('sorcerer');
    const sheet = playerSheet(engine, c);
    expect(sheet).toMatch(/Conjuros: Trucos: [^;.]+/);
    expect(sheet).toMatch(/Nivel 1: /);
    expect(sheet).toMatch(/Usos de clase: [^.]*\d+\/\d+ \((corto|largo)\)/);
    expect(sheet).not.toContain('undefined');
  });

  it('un guerrero sin conjuros no saca la línea vacía', async () => {
    const { engine, c } = await boot('fighter');
    expect(playerSheet(engine, c)).not.toContain('Conjuros:');
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
      for (const title of ['## Fluidez', '## Conversaciones', '## Misiones', '## Combate y muerte', '## Final', '## Cobertura de tools', '## Diversión y fluidez']) expect(md).toContain(title);
      expect(m.tools['log_event']).toBeGreaterThan(0);
      expect(md).toMatch(/\| log_event \| \d+ \| 1 \|/);
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

describe('partidas a dos', () => {
  it('el jugador sabe con quién juega y una reacción sustituye la instrucción final', () => {
    const base = { sheet: 'Bruno, pícaro', situation: null, last: 'Entras en la taberna.', suggested: ['Hablar con Brenna'], mode: 'own' as const, impulse: { prompt: 'regatear' } };
    const p = playerPrompt({ ...base, partner: 'Ciro, guerrero, es otro jugador.' });
    expect(p).toContain('## Con quién juegas\nCiro, guerrero, es otro jugador.');
    expect(p).toContain('Escribe tu propia acción');
    const q = playerPrompt({ ...base, question: 'Ciro intenta quitarte la bolsa. Responde SOLO «me dejo» o «me resisto».' });
    expect(q).toContain('## Te toca decidir');
    expect(q).not.toContain('Acciones sugeridas');
    expect(q).not.toContain('Escribe tu propia acción');
  });

  it('la estimación a dos cuenta una acción por jugador', () => {
    const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
    expect(estimate(1, 50, models, true, 2).master).toBeCloseTo(estimate(1, 50, models, true).master! * 2, 6);
  });

  it('juega una pareja en la misma partida, a veces a la vez, y el informe lo cuenta por jugador', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-pareja-'));
    try {
      const out = join(dir, 'run');
      const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
      const pair = [PROFILES.find((p) => p.id === 'picaro')!, PROFILES.find((p) => p.id === 'novato')!] as [typeof PROFILES[number], typeof PROFILES[number]];
      const run = await runAutoplay({ games: 1, actions: 6, seed: 11, models, dryRun: true, gamesDir: join(dir, 'games'), outDir: out, stamp: 'test', pairs: [pair], campaign: 'brezal' });
      expect(run.errors).toEqual([]);
      expect(run.games).toHaveLength(2);
      const [a, b] = run.games as [GameSummary, GameSummary];
      expect(a.slug).toBe(b.slug);
      expect(a.character.id).not.toBe(b.character.id);
      expect(a.profile).toBe('picaro');
      expect(b.profile).toBe('novato');
      expect(a.pair).toMatchObject({ partner: b.character.name, partner_profile: 'novato' });
      expect(b.pair).toMatchObject({ partner: a.character.name, partner_profile: 'picaro' });
      expect(a.actions).toHaveLength(6);
      expect(b.actions).toHaveLength(6);
      expect(a.pair!.together).toBe(b.pair!.together);
      // Lo que va a la vez entra en la misma llamada: un solo cierre con los dos en `group`.
      expect(a.actions.filter((x) => x.together)).toHaveLength(a.pair!.together);
      expect(b.actions.filter((x) => x.together)).toHaveLength(b.pair!.together);
      expect(keyOf(a)).not.toBe(keyOf(b));
      const loaded = loadGame(a.dir, a.character.id);
      const m = analyzeGame(a, loaded.events, loaded.state);
      // Lo mandado a la vez se junta en un cierre con los dos en `group` (salvo lo que no pasa por el máster: el chat, un atajo del motor).
      expect(m.pair!.shared_turns).toBeGreaterThanOrEqual(1);
      expect(m.pair!.shared_turns).toBeLessThanOrEqual(a.pair!.together);
      const shared = a.actions.find((x) => x.together && x.event_ids.length);
      expect(shared).toBeDefined();
      expect(b.actions.find((x) => x.i === shared!.i)!.event_ids).toEqual(expect.arrayContaining(shared!.event_ids));
      const mb = analyzeGame(b, loadGame(b.dir, b.character.id).events, loaded.state);
      const md = buildPlaytest(run, [m, mb], [], [], 0);
      expect(md).toContain('## A dos');
      expect(md).toContain(`| picaro | ${b.character.name} (novato) |`);
      expect(md).toContain(`| novato | ${a.character.name} (picaro) |`);
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('perfiles mecánicos', () => {
  it('recorren sus wants en orden y cubren conjuros, objetos, disparo, sigilo, forzar, saquear y descansar', () => {
    for (const id of ['lanzador', 'tirador']) {
      const p = PROFILES.find((x) => x.id === id)!;
      expect(p.cycle).toBe(true);
      for (const w of ['objeto', 'disparar', 'esconderse', 'forzar', 'saquear', 'trepar', 'descansar']) expect(p.wants.map((x) => x.id)).toContain(w);
      // A nivel 1 ni la hechicera ni el explorador tienen usos de clase ni con qué curar (H10): eso lo pide el herido.
      for (const w of ['recurso', 'curar']) expect(p.wants.map((x) => x.id)).not.toContain(w);
    }
    expect(PROFILES.find((x) => x.id === 'lanzador')!.wants.map((x) => x.id)).toEqual(expect.arrayContaining(['conjuro', 'truco', 'truco_ataque']));
    expect(PROFILES.find((x) => x.id === 'tirador')!.wants.map((x) => x.id)).toContain('rastrear');
  });

  it('en dry-run, el lanzador pide cada cosa una vez antes de repetir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-mecanico-'));
    try {
      const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
      const profiles = PROFILES.filter((p) => p.id === 'lanzador');
      const run = await runAutoplay({ games: 1, actions: 5, seed: 21, models, dryRun: true, gamesDir: join(dir, 'games'), outDir: join(dir, 'run'), stamp: 'test', profiles, campaign: 'brezal' });
      expect(run.errors).toEqual([]);
      const own = run.games[0]!.actions.filter((a) => a.mode === 'own').map((a) => a.impulse);
      expect(own.length).toBeGreaterThan(2);
      expect(new Set(own).size).toBe(own.length);
      expect(own.slice(0, 3)).toEqual(profiles[0]!.wants.slice(0, 3).map((w) => w.id));
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('perfiles mecánicos de H10 (herido, deudor, cronista, recolector)', () => {
  const H10 = ['herido', 'deudor', 'cronista', 'recolector'];
  const MECH = PROFILES.filter((p) => p.cycle);
  const models = { master: 'claude-haiku-5-5', player: 'claude-haiku-5-5', worldgen: 'claude-haiku-5-5', judge: 'claude-haiku-5-5' };
  const norm = (t: string) => normalize(t).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const mentions = (text: string, name: string) => name.length >= 4 && ` ${norm(text)} `.includes(` ${norm(name)} `);
  const bootAs = async (p: PlayerProfile) => {
    const time = fakeTime(Date.UTC(2026, 9, 22, 12, 0, 0));
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(time.now()) }), now: time.now, deterministic: false });
    const r = await engine.createCharacter(`u_${p.id}`, 'Fen', { class_id: p.class_id, race_id: p.race_id });
    if (!r.ok) throw new Error(r.reason);
    if (p.start) applyStart(engine, r.character, p.start);
    return { engine, c: r.character };
  };

  it('entran en all (PROFILES), recorren su lista en orden y con wants distintos', () => {
    for (const id of H10) {
      const p = PROFILES.find((x) => x.id === id)!;
      expect(p, id).toBeDefined();
      expect(p.cycle).toBe(true);
      expect(new Set(p.wants.map((w) => w.id)).size).toBe(p.wants.length);
      expect(p.wants.length).toBeGreaterThanOrEqual(7);
    }
    // El jugador falso reconoce cada want por su frase: ninguna puede estar dentro de otra.
    const prompts = [...new Set([...MECH.flatMap((p) => p.wants), ATTEND_WANT].map((w) => w.prompt))];
    for (const a of prompts) for (const b of prompts) if (a !== b) expect(a.includes(b), `«${b}» está dentro de «${a}»`).toBe(false);
    // El herido junto al violento, que es quien cae: lo único que provoca `stabilize` (solo se le hace a otro PJ).
    expect(PAIRS).toContainEqual(['herido', 'violento']);
  });

  it('el arranque deja al herido a un tercio de PG con sus pociones y al recolector con pergamino y capa identificados', async () => {
    const herido = await bootAs(PROFILES.find((x) => x.id === 'herido')!);
    expect(herido.c.hp_current).toBe(Math.round(herido.c.hp_max / 3));
    const hSheet = playerSheet(herido.engine, herido.c);
    expect(hSheet).toContain('poción de curación ×2');
    expect(hSheet).toContain('kit de sanador');
    expect(hSheet).toMatch(/Usos de clase: [^.]*Tomar aliento 1\/1/);
    const rec = await bootAs(PROFILES.find((x) => x.id === 'recolector')!);
    const items = rec.engine.world.itemsCarriedBy(rec.c.id);
    const scroll = items.find((i) => i.item_id === 'it_pergamino_1')!;
    expect(scroll.state.spell_id).toBe('speak_with_animals');
    expect(scroll.location.type).toBe('container');
    const capa = items.find((i) => i.item_id === 'it_capa_proteccion')!;
    expect(capa.state.identified_by).toEqual([rec.c.id]);
    expect(rec.engine.world.itemDef('it_capa_proteccion').attunement).toBe(true);
  });

  it('H11: el recolector empieza en la plaza y su primer sitio de campo es la granja, nunca el Soto', () => {
    const p = PROFILES.find((x) => x.id === 'recolector')!;
    const PLACE = /\b(corrales|molino|soto|arroyo)\b/i;
    const field = p.wants.find((w) => PLACE.test(w.dry))!;
    expect(field.id).toBe('ir_campo');
    expect(field.dry).toMatch(/Corrales/);
    // Lo que dice el jugador falso no le lleva nunca al Soto ni al arroyo, y lo de antes de salir se hace en la plaza.
    for (const w of p.wants) expect(w.dry, w.id).not.toMatch(/\b(soto|arroyo)\b/i);
    expect(p.wants.indexOf(field)).toBeGreaterThan(p.wants.findIndex((w) => w.id === 'sintonizar'));
    expect(p.prompt).toMatch(/Al Soto no vas nunca/);
    // Sigue pidiendo lo suyo: harvest (ponedero, huerto, canal), get_item, attune_item, use_scroll, update_spot_state, cast_spell y sell_item.
    for (const id of ['recolectar', 'huerto', 'pescar', 'examinar', 'sintonizar', 'pergamino', 'marcar', 'conjuro', 'vender_cosecha', 'soltar', 'coger']) expect(p.wants.map((w) => w.id)).toContain(id);
  });

  it('H12: la ficha dice qué lleva puesto, en qué bolsa va la capa y si está sintonizada; y, tras morir, dónde quedaron sus cosas', async () => {
    const { engine, c } = await bootAs(PROFILES.find((x) => x.id === 'recolector')!);
    const w = engine.world;
    let sheet = playerSheet(engine, c);
    expect(sheet).toContain('En las manos: bastón, escudo.');
    expect(sheet).toMatch(/Lleva puesto: [^.]*armadura de cuero[^.]*mochila/);
    expect(sheet).toMatch(/En su mochila: [^.]*antorcha ×\d[^.]*capa de protección \(sintonía: sin hacer\)/);
    expect(sheet).toContain('pergamino de conjuro de nivel 1');
    const capa = w.itemsCarriedBy(c.id).find((i) => i.item_id === 'it_capa_proteccion')!;
    capa.state.attuned_to = c.id;
    expect(playerSheet(engine, c)).toContain('capa de protección (sintonía: contigo)');
    // Lo que le pasó en la tanda 5: muere en el arroyo del Soto y su capa se queda en el cuerpo, no en su ficha.
    c.location = { type: 'spot', id: 'sp_cl_arroyo' };
    die(w, c, 0, 'lobo');
    sheet = playerSheet(engine, c);
    expect(w.itemsCarriedBy(c.id)).toEqual([]);
    expect(sheet).toContain('Lleva: nada.');
    expect(sheet).toMatch(/Sintonizado con: capa de protección \(no lo lleva encima\)/);
    expect(sheet).toMatch(/sus cosas se quedaron en su cuerpo, en el arroyo \(El Soto\), y solo él puede recogerlas: [^.]*capa de protección/);
  });

  it('las frases de los mecánicos solo nombran objetos que el PJ lleva y conjuros que tiene', async () => {
    // Lo que no es suyo y sí puede nombrar: lo de la escena que la want busca (el cofre que forzar, el carro tras el que
    // esconderse), lo que va a conseguir (la cerveza fiada, la cama de una noche, lo que recolecta) y las monedas de plata.
    const SCENE = new Set(['cofre', 'carro', 'cerradura', 'cerveza', 'noche', 'cama', 'truchas', 'huevos', 'bayas', 'coles', 'plata']);
    const bad: string[] = [];
    for (const p of MECH) {
      const { engine, c } = await bootAs(p);
      const w = engine.world;
      const carried = new Set(w.itemsCarriedBy(c.id).map((i) => i.item_id));
      const carriedNames = [...carried].flatMap((id) => [w.itemDef(id).name, ...(w.itemDef(id).aliases ?? [])].map(norm));
      const known = new Set(spellGroups(c).flatMap((g) => [...g.spells, ...g.always]).map((x) => x.id));
      for (const k of p.start?.kit ?? []) if (k.spell_id) known.add(k.spell_id);
      for (const wt of p.wants) {
        for (const d of w.itemDefs.values()) {
          if (carried.has(d.id)) continue;
          const hit = [d.name, ...(d.aliases ?? [])].find((n) => mentions(wt.dry, n) && !carriedNames.includes(norm(n)) && !SCENE.has(norm(n)));
          if (hit) bad.push(`${p.id}/${wt.id}: «${wt.dry}» nombra «${hit}» (${d.name}), que no lleva`);
        }
        // Los conjuros van con mayúscula («Dormir»), así no salta con «dormir ocho horas».
        const names = (t: string, n: string) => new RegExp(`(^|[^\p{L}])${n}([^\p{L}]|$)`, 'u').test(t);
        for (const sp of SPELLS) if ((names(wt.dry, sp.name) || names(wt.prompt, sp.name)) && !known.has(sp.id)) bad.push(`${p.id}/${wt.id} nombra el conjuro ${sp.name}, que no tiene`);
      }
    }
    expect(bad).toEqual([]);
  }, 60_000);

  it('en dry-run, cada uno pide su lista en orden sin repetir y lo clave llega al máster', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-h10-'));
    try {
      const profiles = H10.map((id) => PROFILES.find((x) => x.id === id)!);
      const run = await runAutoplay({ games: profiles.length, actions: 12, seed: 23, models, dryRun: true, gamesDir: join(dir, 'games'), outDir: join(dir, 'run'), stamp: 'test', profiles, campaign: 'brezal', parallel: 2 });
      expect(run.errors).toEqual([]);
      for (const g of run.games) {
        const p = profiles.find((x) => x.id === g.profile)!;
        const own = g.actions.filter((a) => a.mode === 'own' && !a.how);
        expect(own.length, p.id).toBeGreaterThanOrEqual(8);
        expect(own.map((a) => a.impulse)).toEqual(own.map((_, i) => p.wants[i % p.wants.length]!.id));
        expect(new Set(own.slice(0, p.wants.length).map((a) => a.impulse)).size).toBe(Math.min(own.length, p.wants.length));
        // Lo que dice el jugador falso es la frase de su want.
        for (const a of own) expect(a.text).toBe(p.wants.find((w) => w.id === a.impulse)!.dry);
      }
      // Las acciones clave no las resuelve el motor solo: dejan un cierre del máster (offline en seco).
      const KEY: [string, string][] = [['herido', 'pocion'], ['herido', 'regla'], ['deudor', 'fiado'], ['deudor', 'prenda'], ['cronista', 'pasado'], ['recolector', 'recolectar'], ['recolector', 'pergamino']];
      for (const [pid, wid] of KEY) {
        const a = run.games.find((g) => g.profile === pid)!.actions.find((x) => x.impulse === wid);
        expect(a, `${pid}/${wid} no se jugó`).toBeDefined();
        expect(a!.event_ids.length, `${pid}/${wid} lo resolvió el motor sin máster`).toBeGreaterThan(0);
      }
      // H11: el recolector no pisa el Soto (los lobos del arroyo). En seco «Voy a los Corrales» solo le lleva al camino de
      // la plaza (el motor anda punto a punto); en vivo lo mueve el máster.
      const rec = run.games.find((g) => g.profile === 'recolector')!;
      expect(rec.actions.map((a) => a.state?.location)).not.toContain('loc_claro');
      const herido = run.games.find((g) => g.profile === 'herido')!;
      expect(herido.actions[0]!.state!.hp).toBeLessThan(herido.actions[0]!.state!.hp_max);
    } finally {
      delete process.env['MASTER_MODEL'];
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
