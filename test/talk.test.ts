/**
 * Cómo responde un NPC por situación (src/engine/talk.ts, docs/CONVERSACION-REGLAS.md):
 * señales, situación por prioridad, guion en el contexto del máster, control al cierre
 * y respuestas de plantilla del máster offline.
 */
import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { talkReply } from '../src/ai/offline.js';
import { situationsFor, talkPlan, talkProblems, textSignals, type TalkPlan } from '../src/engine/talk.js';
import type { Engine } from '../src/engine/engine.js';
import { seededRng } from '../src/engine/dice.js';
import { bootEngine } from './helpers.js';

function plan(engine: Engine, text: string): TalkPlan | null {
  const kael = engine.world.character('ch_kael');
  return talkPlan(engine.world, engine.events.all(), kael, text, engine.nowFor(kael));
}

function close(engine: Engine, p: TalkPlan, extra: Record<string, unknown>): { ok?: boolean; error?: string } {
  const kael = engine.world.character('ch_kael');
  const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(7), closed: null, rolls: [], progress: [], talk: p };
  return JSON.parse(executeTool(ctx, 'log_event', {
    narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: 'npc_brenna', ...extra,
  })) as { ok?: boolean; error?: string };
}
const npcSays = (...t: string[]) => t.map((text) => ({ speaker: 'npc', npc_id: 'npc_brenna', text }));

describe('señales del texto', () => {
  it('saludo, despedida, pregunta, comercio, trabajo, entrega e insulto', () => {
    expect(textSignals('Hola, buenas').greeting).toBe(true);
    expect(textSignals('Bueno, me voy ya').farewell).toBe(true);
    expect(textSignals('¿Has visto a Doro?').question).toBe(true);
    expect(textSignals('¿Cuánto cuesta la cerveza?').trade).toBe(true);
    expect(textSignals('¿Tienes algún trabajo para mí?').asks_work).toBe(true);
    expect(textSignals('Aquí tienes la leña').delivery).toBe(true);
    expect(textSignals('Cállate, idiota').hostile).toBe(true);
    expect(Object.values(textSignals('Miro la chimenea')).some(Boolean)).toBe(false);
  });
});

describe('situación del turno', () => {
  it('saludo de un desconocido: primer encuentro, trato extraño', async () => {
    const { engine } = await bootEngine();
    const p = plan(engine, 'Hola, Brenna')!;
    expect(p.npc_id).toBe('npc_brenna');
    expect(p.situation).toBe('greeting');
    expect(p.state.first_meeting).toBe(true);
    expect(p.state.tier).toBe('stranger');
  });

  it('la pregunta manda sobre el saludo, que queda de secundaria', async () => {
    const { engine } = await bootEngine();
    const p = plan(engine, 'Buenas, Brenna. ¿Sabes algo del incendio?')!;
    expect([p.situation, p.second]).toEqual(['question', 'greeting']);
  });

  it('lore: nombra un lugar de los datos y trae lo que sabe todo el mundo', async () => {
    const { engine } = await bootEngine();
    const p = plan(engine, 'Brenna, ¿qué me cuentas del Claro del Roble?')!;
    expect(p.situation).toBe('lore');
    expect(p.topics.map((t) => t.name)).toEqual(['Claro del Roble']);
  });

  it('comercio con quien vende; trabajo con un encargo suyo en el tablón', async () => {
    const { engine } = await bootEngine();
    expect(plan(engine, 'Brenna, ¿cuánto cuesta la cerveza?')!.situation).toBe('trade');
    // El tablón ya tiene su encargo de leña al arrancar.
    const p = plan(engine, 'Brenna, ¿tienes algún trabajo?')!;
    expect(p.situation).toBe('offer');
    expect(p.state.can_offer).toContain('Leña para la posada');
    // Sin nada que dar, pedir trabajo es una pregunta más.
    p.state.can_offer.length = 0;
    expect(situationsFor(p.state, p.text, p.topics)[0]).toBe('question');
  });

  it('el trato hostil va antes que lo que pida', async () => {
    const { engine } = await bootEngine();
    engine.world.npc('npc_brenna').attitude.by_character['ch_kael'] = 'hostile';
    const p = plan(engine, 'Brenna, ¿cuánto cuesta la cerveza?')!;
    expect([p.situation, p.second]).toEqual(['cold', 'trade']);
  });

  it('sin hablar no hay plan; sin señales es charla dudosa', async () => {
    const { engine } = await bootEngine();
    expect(plan(engine, 'miro la chimenea')).toBeNull();
    const p = plan(engine, 'le digo a Brenna que el día está gris')!;
    expect(p.situation).toBe('chat');
    expect(p.doubtful).toBe(true);
  });

  it('la prioridad: peligro, reacción, trato frío, misión, comercio…', () => {
    const st = { first_meeting: false, returning: false, knows_name: true, tier: 'acquaintance', opinion: 0, crime: false, recent: null, busy: false, can_offer: [], pending: ['La leña'], locked: [], debt: false, trades: true } as const;
    const tx = textSignals('Hola. ¿Cuánto cuesta la cerveza?');
    expect(situationsFor({ ...st, can_offer: [], pending: [] }, tx, [])).toEqual(['trade', 'question', 'greeting']);
    expect(situationsFor({ ...st, crime: true }, tx, [])[0]).toBe('danger');
    expect(situationsFor(st, textSignals('Aquí tienes la leña'), [])[0]).toBe('errand');
  });
});

describe('guion en el contexto del máster', () => {
  it('el contexto trae «Cómo responde…» con pasos, prohibido y longitud', async () => {
    const { engine } = await bootEngine();
    const ctx = actionContext(engine, engine.world.character('ch_kael'), 'Hola, Brenna');
    expect(ctx).toContain('## Cómo responde Brenna en este turno (situación: greeting)');
    expect(ctx).toContain('Primera vez que hablan; trato extraño');
    expect(ctx).toContain('Pregunta quién es o qué le trae.');
    expect(ctx).toContain('Longitud: lo que dice, 30 palabras como mucho');
    expect(actionContext(engine, engine.world.character('ch_kael'), 'miro la chimenea')).not.toContain('## Cómo responde');
  });

  it('el máster offline contesta con la plantilla de la situación', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    expect(talkReply(actionContext(engine, kael, 'Hola, Brenna'))).toBe('Buenas. No te había visto por aquí. ¿Qué te trae?');
    expect(talkReply(actionContext(engine, kael, 'Adiós, Brenna'))).toBe('Ve con cuidado.');
    expect(talkReply(actionContext(engine, kael, 'le digo a Brenna que el día está gris'))).toBeNull();
  });
});

describe('control al cierre', () => {
  it('una pregunta sin respuesta del NPC se reescribe una vez', async () => {
    const { engine } = await bootEngine();
    const p = plan(engine, 'Brenna, ¿sabes algo del incendio?')!;
    expect(talkProblems(p, { lines: [], narration: 'Brenna se encoge de hombros.', declared: null, pendingRoll: false, npcName: 'Brenna' })[0]).toContain('no dice nada');
    expect(talkProblems(p, { lines: [], narration: '', declared: null, pendingRoll: true, npcName: 'Brenna' })).toEqual([]);
    expect(close(engine, p, { narration_private: 'Brenna se encoge de hombros.' }).error).toContain('No sigue el guion');
    expect(close(engine, p, { narration_private: 'Brenna se encoge de hombros.', lines: npcSays('Eso no se le cuenta a un forastero.') }).error).toBeUndefined();
  });

  it('un primer saludo no suelta encargos; nada demasiado largo', async () => {
    const { engine } = await bootEngine();
    engine.world.campaign.board.active_job_ids.push('job_lena');
    const p = plan(engine, 'Hola, Brenna')!;
    const lena = talkProblems(p, { lines: npcSays('Buenas. Si buscas faena, lo de la leña para la posada sigue en pie.'), narration: '', declared: null, pendingRoll: false, npcName: 'Brenna' });
    expect(lena.join(' ')).toContain('«Leña para la posada»');
    const long = Array.from({ length: 60 }, () => 'palabra').join(' ');
    expect(talkProblems(p, { lines: npcSays(long), narration: '', declared: null, pendingRoll: false, npcName: 'Brenna' }).join(' ')).toContain('recórtalo');
    expect(talkProblems(p, { lines: npcSays('Buenas. ¿Qué te trae?'), narration: '', declared: null, pendingRoll: false, npcName: 'Brenna' })).toEqual([]);
  });

  it('la situación que declara el máster se comprueba contra el estado', async () => {
    const { engine } = await bootEngine();
    const p = plan(engine, 'le digo a Brenna que el día está gris')!;
    const base = { lines: npcSays('Gris como siempre.'), narration: '', pendingRoll: false, npcName: 'Brenna' };
    expect(talkProblems(p, { ...base, declared: 'errand' })[0]).toContain('no encaja');
    expect(talkProblems(p, { ...base, declared: 'nada' })[0]).toContain('no existe');
    expect(talkProblems(p, { ...base, declared: 'trade' })).toEqual([]);
  });
});
