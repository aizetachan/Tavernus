/**
 * H16 (plan de arreglos 2, 26-11-2026): el juez cuenta aparte los patrones 1, 3 y 5 del análisis de las tandas 4 y 5:
 * `npc_ausente`, `ambiente_mal_hablante` y `enlatada_sin_sentido`. Para los dos últimos tiene que ver lo que el motor
 * le dio al jugador sin máster (frases de ambiente y respuestas rápidas), que antes no llegaba al juez.
 */
import { describe, expect, it } from 'vitest';
import type { GameSummary, PlayerTurn } from '../scripts/autoplay.js';
import { JUDGE_SYSTEM, MODEL_TYPES, parseJudge, TYPE_LABEL, turnBlock, turnsFromEvents, type Finding } from '../scripts/judge.js';
import { buildPatternSection, keyOf, type GameMetrics } from '../scripts/playtest-report.js';
import type { GameEvent } from '../src/engine/model.js';

const PC = 'ch_ciro';
let seq = 0;
function ev(over: Partial<GameEvent> & { payload?: Record<string, unknown> }): GameEvent {
  seq++;
  return {
    id: `ev_${seq}`, seq, timestamp_real_ms: 0, timestamp_game_s: 0, campaign_id: 'brezal', location_id: 'loc_taberna', spot_id: 'sp_tab_barra',
    actor_id: PC, action_type: 'master', input_text: 'hago algo', narration_private: 'Pasa algo.', observable: null, visibility: 'location',
    tags: ['master'], delivered_to: [{ character_id: PC, level: 'full' }], ...over, payload: over.payload ?? {},
  };
}
const master = { master: { model: 'claude-haiku-5-5', usage: null, calls: [], context: '## Presentes que el actor percibe\n- Brenna [npc_brenna]' } };
const chatter = (npc: string, text: string, to = PC) => ev({ actor_id: null, action_type: 'chatter', input_text: null, narration_private: '', observable: text, tags: ['chatter'], delivered_to: [{ character_id: to, level: 'full' }], payload: { master: null, chatter: { npc_id: npc, text, kind: 'ambient' } } });
const turn = (i: number, text: string, event_ids: string[], reply: string): PlayerTurn => ({ i, mode: 'own', impulse: null, text, ok: true, engine_text: null, rolls: 0, usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, event_ids, reply });

describe('H16: las tres categorías nuevas', () => {
  it('están en la lista cerrada del juez, con su definición y su etiqueta', () => {
    for (const t of ['npc_ausente', 'ambiente_mal_hablante', 'enlatada_sin_sentido'] as const) {
      expect(MODEL_TYPES[t].def.length).toBeGreaterThan(80);
      expect(JUDGE_SYSTEM).toContain(`- ${t}: ${MODEL_TYPES[t].def}`);
      expect(TYPE_LABEL[t]).toBe(MODEL_TYPES[t].label);
    }
    expect(MODEL_TYPES.npc_ausente.def).toContain('no incoherencia_contexto');
    for (const t of Object.values(MODEL_TYPES)) expect(`${t.label} ${t.def}`).not.toMatch(/[·•]/);
  });

  it('el juez ve las frases de ambiente que le llegaron y las respuestas del motor, en el turno siguiente', () => {
    const first = ev({ input_text: 'Saludo a Brenna', payload: master });
    const amb = chatter('npc_brenna', 'Brenna, al pasar: «Otra jarra, Brenna»');
    const notMine = chatter('npc_hugo', 'El herrero, al pasar: «Hace frío»', 'ch_otro');
    const second = ev({ input_text: 'Pido una jarra', payload: master });
    const late = chatter('npc_garran', 'Garrán, al pasar: «Si Garrán viene a cobrar…»');
    const actions = [turn(1, 'Saludo a Brenna', [first.id], 'Brenna sonríe.'), turn(2, '¿Y tú qué opinas de Ilse?', [], 'No tengo tiempo para charlas.'), turn(3, 'Pido una jarra', [second.id], 'Te sirve.')];
    const turns = turnsFromEvents([first, amb, notMine, second, late], PC, actions);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.ambient).toBeUndefined();
    expect(turns[1]!.ambient).toEqual([{ npc_id: 'npc_brenna', text: 'Brenna, al pasar: «Otra jarra, Brenna»' }, { npc_id: 'npc_garran', text: 'Garrán, al pasar: «Si Garrán viene a cobrar…»' }]);
    expect(turns[1]!.motor).toEqual([{ action: 2, said: '¿Y tú qué opinas de Ilse?', reply: 'No tengo tiempo para charlas.' }]);
    const block = turnBlock(turns[1]!);
    expect(block).toContain('Ambiente (frases del motor, sin máster, antes de este turno):\n- [habla: npc_brenna] Brenna, al pasar: «Otra jarra, Brenna»');
    expect(block).toContain('Respuestas del motor (sin máster) a acciones anteriores:\n- Acción 2, jugador: «¿Y tú qué opinas de Ilse?» → motor: «No tengo tiempo para charlas.»');
    expect(block).toContain('## Presentes que el actor percibe');
    // La cita de una línea de ambiente o de una respuesta del motor cuenta como literal.
    const parsed = parseJudge(JSON.stringify({ findings: [
      { turn: 1, type: 'ambiente_mal_hablante', severity: 2, quote: 'Otra jarra, Brenna', why: 'Brenna se pide la jarra a sí misma.' },
      { turn: 1, type: 'enlatada_sin_sentido', severity: 2, quote: 'No tengo tiempo para charlas.', why: 'No contesta a la pregunta.' },
      { turn: 1, type: 'npc_ausente', severity: 2, quote: 'Pasa algo.', why: 'Garrán contesta y no está.' },
    ] }), turns);
    expect(parsed.error).toBeNull();
    expect(parsed.findings.map((f) => [f.type, f.quote_ok])).toEqual([['ambiente_mal_hablante', true], ['enlatada_sin_sentido', true], ['npc_ausente', true]]);
  });

  it('el informe tiene una columna por categoría y una fila por jugador, también a dos', () => {
    const g = (profile: string, id: string, pair: boolean) => ({ slug: 'auto-x', profile, character: { id }, ...(pair ? { pair: { partner: 'otro' } } : {}) }) as unknown as GameSummary;
    const metric = (s: GameSummary, actions: number) => ({ slug: keyOf(s), profile: s.profile, actions }) as GameMetrics;
    const ms = [metric(g('picaro', 'ch_bruno', true), 40), metric(g('novato', 'ch_ciro', true), 20)];
    const f = (type: Finding['type'], character: string): Finding => ({ type, layer: 'model', turn: 1, event_id: null, severity: 2, detail: '', quote: '', game: 'auto-x', character });
    const md = buildPatternSection(ms, [f('npc_ausente', 'ch_bruno'), f('npc_ausente', 'ch_bruno'), f('enlatada_sin_sentido', 'ch_ciro'), f('incoherencia_contexto', 'ch_ciro')]);
    expect(md).toContain(`| Perfil | ${TYPE_LABEL.npc_ausente} | ${TYPE_LABEL.ambiente_mal_hablante} | ${TYPE_LABEL.enlatada_sin_sentido} | ${TYPE_LABEL.incoherencia_contexto} |`);
    expect(md).toContain('| picaro | 5.0 (2) | 0.0 (0) | 0.0 (0) | 0.0 (0) |');
    expect(md).toContain('| novato | 0.0 (0) | 0.0 (0) | 5.0 (1) | 5.0 (1) |');
    expect(md).toContain('| **Total** | 3.3 (2) | 0.0 (0) | 1.7 (1) | 1.7 (1) |');
  });
});
