/**
 * H14 (plan de arreglos 2, 26-11-2026): el transcript decía «misiones N» con las CUMPLIDAS y el análisis lo leyó como
 * abiertas («misiones 0» con «📖 Nueva misión» en pantalla, pausado T11 y el cronista toda la partida). `open` de
 * TurnState sí cuadraba: en las 23 partidas de las tandas 4 y 5, cada aviso 📖 coincide con una misión abierta en esa
 * acción (comprobado con `questNotices` sobre `data/local/autoplay/20261126-0418`, `-0442` y `-0602`).
 */
import { describe, expect, it } from 'vitest';
import type { GameSummary, PlayerTurn, TurnState } from '../scripts/autoplay.js';
import { buildWindowSection, digestOf, questLine, questNotices, transcriptOf } from '../scripts/playtest-report.js';

const state = (over: Partial<TurnState>): TurnState => ({ game_s: 0, status: 'active', hp: 10, hp_max: 10, level: 1, xp: 0, coins: 150, location: 'loc_taberna', open: 1, steps: 0, done: 0, clues: 0, ...over });
const turn = (i: number, reply: string, st: Partial<TurnState>): PlayerTurn => ({ i, mode: 'own', impulse: 'cronica', text: `acción ${i}`, ok: true, engine_text: null, rolls: 0, usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, event_ids: [], reply, wall_ms: 1000, state: state(st) });

/** El cronista de la tanda 5 (20261126-0602): la principal abierta de salida y tres 📖 en las acciones 2, 4 y 27. */
const cronista = {
  n: 3, profile: 'cronista', ended: 'tope', character: { id: 'ch_elmo', name: 'Elmo', race: 'Humano', class: 'Bardo', hook: '', situation: null },
  actions: [
    turn(1, 'Brenna te mira.', { open: 1 }),
    turn(2, 'Ilse te cuenta lo del pozo.\n\n📖 Nueva misión (acto I): «El agua turbia». Te lo pide Ilse.', { open: 2 }),
    turn(3, 'Nada nuevo.', { open: 2 }),
    turn(4, '📖 Nueva misión (acto I): «La cena del portón». Te lo pide Brenna.', { open: 3, steps: 2 }),
  ],
} as unknown as GameSummary;

describe('H14: el contador de misiones', () => {
  it('la línea de estado dice abiertas y cumplidas, con las de la historia y las que da un NPC', () => {
    expect(questLine(state({ open: 3, done: 0 }))).toBe('misiones abiertas 3, cumplidas 0');
    expect(questLine(state({ open: 2, done: 1, given: 1, given_done: 2 }))).toBe('misiones abiertas 3, cumplidas 3');
  });

  it('el transcript y el resumen para el juez ya no dicen «misiones N» a secas', () => {
    const md = transcriptOf(cronista);
    expect(md).toContain('misiones abiertas 3, cumplidas 0');
    expect(md).not.toMatch(/misiones \d/);
    expect(digestOf(cronista)).toContain('misiones abiertas 2, cumplidas 0');
  });

  it('cada «📖 Nueva misión» cuadra con una misión abierta en su acción; si no, lo dice', () => {
    expect(questNotices(cronista)).toEqual([]);
    // Un aviso sin misión nueva (el caso que el análisis creyó ver) y una misión que se abre sin aviso.
    const off = { ...cronista, actions: [...cronista.actions, turn(5, '📖 Nueva misión (acto I): «La carta de Vharn». Te llega.', { open: 3, steps: 2 }), turn(6, 'Nada.', { open: 4, steps: 2 })] } as GameSummary;
    expect(questNotices(off)).toEqual([{ action: 5, notices: 1, opened: 0 }, { action: 6, notices: 0, opened: 1 }]);
    // Abrirla y cumplirla en la misma acción también cuadra; el mismo aviso dos veces en la respuesta cuenta una.
    const both = { ...cronista, actions: [...cronista.actions, turn(5, '📖 Nueva misión (acto I): «Un jarabe». Te lo pide Ilse.\n\n📖 Nueva misión (acto I): «Un jarabe». Te lo pide Ilse.', { open: 3, done: 1, steps: 2 })] } as GameSummary;
    expect(questNotices(both)).toEqual([]);
  });

  it('la tabla de métricas dice que compara misiones cumplidas', () => {
    const md = buildWindowSection(40, [{ profile: 'cronista', actions: 40, steps: 2, done: 0, clues: 1, npc_run: 3, refusals: 0, rolls: 0, social_rolls: 0, attack_verbs: 0, attack_verbs_rolled: 0, attack_verbs_maneuver: 0, npc_attacks: 0, downs: 0, master_turns: 30, rejected_turns: 2, final: null }]);
    expect(md).toContain('| Misiones cumplidas |');
  });
});
