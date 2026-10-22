import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine/model.js';
import {
  buildReport, detectFailedToolNarrated, detectInventedPlace, detectLongNarration, detectNoResponse, detectNpcOutOfReach,
  detectPromiseWithoutState, detectRepeatedSuggestion, detectTrivialRoll, judgeRun, parseJudge, runDetectors, turnsFromEvents, type GameJudgement, type Turn,
} from '../scripts/judge.js';
import { cleanOwnAction, parseSuggestedChoice, runAutoplay } from '../scripts/autoplay.js';

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
