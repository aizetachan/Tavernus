/**
 * Cómo responde un NPC por situación (src/engine/talk.ts, docs/CONVERSACION-REGLAS.md):
 * señales, situación por prioridad, guion en el contexto del máster, control al cierre
 * y respuestas de plantilla del máster offline.
 */
import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { talkReply } from '../src/ai/offline.js';
import { endsTalk, situationsFor, socialOutcomeLine, talkPlan, talkProblems, talkScript, textSignals, withoutRefused, type TalkPlan } from '../src/engine/talk.js';
import { Engine } from '../src/engine/engine.js';
import { seededRng } from '../src/engine/dice.js';
import { adjustTrust, trustFromRoll, trustTier } from '../src/engine/trust.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import type { Character } from '../src/engine/model.js';
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
    expect(close(engine, p, { narration_private: 'Brenna se encoge de hombros.', lines: npcSays('Eso no lo sé, y mira que oigo cosas.') }).error).toBeUndefined();
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

// Frases reales de la tanda del 31-10 (docs/PLAYTEST-2026-10-31.md): el charlatán pasó 190 turnos con Ilse.
const T0 = Date.UTC(2026, 9, 22, 18);

/** Brezal con un bardo que conoce a Ilse y la tiene delante. */
async function conIlse(): Promise<{ engine: Engine; c: Character }> {
  const seed = authoredSeed('brezal', { now: new Date(T0) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: () => T0, deterministic: true });
  const r = await engine.createCharacter('u1', 'Dalia', { class_id: 'bard' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  await engine.tick();
  const c = engine.world.character(r.character.id);
  c.knows.push('npc_ilse');
  engine.world.npc('npc_ilse').location = { type: 'spot', id: engine.world.characterSpot(c)!.id };
  return { engine, c };
}
const ilsePlan = (engine: Engine, c: Character, text: string) => talkPlan(engine.world, engine.events.all(), c, text, engine.nowFor(c))!;
const ilseSays = (...t: string[]) => t.map((text) => ({ speaker: 'npc' as const, npc_id: 'npc_ilse', text }));
function ilseAnswered(engine: Engine, c: Character, asked: string, said: string, extra: Record<string, unknown> = {}): void {
  engine.events.emit({ actor_id: c.id, action_type: 'master', input_text: asked, narration_private: '', observable: null, tags: [], payload: { npc_id: 'npc_ilse', lines: ilseSays(said), ...extra } }, T0);
}
const closing = (p: TalkPlan, said: string) => talkProblems(p, { lines: ilseSays(said), narration: '', declared: null, pendingRoll: false, npcName: 'Ilse' });
const ASK = 'Ilse, ¿y tú de qué familia eres? Porque conoces a Vharn como si hubieras vivido allí.';
const NO = 'Eso no se le cuenta a un forastero.';

describe('negarse deja una salida', () => {
  it('el guion ya no dicta la frase hecha y trae por dónde seguir', async () => {
    const { engine, c } = await conIlse();
    const p = ilsePlan(engine, c, ASK);
    const script = talkScript(engine.world, c, p);
    expect(script).not.toContain('no se le cuenta');
    expect(p.state.way_out.length).toBeGreaterThan(0);
    expect(script).toContain('Si se niega a algo delicado, la salida');
  });

  it('una salida son títulos y nombres, nunca lo que dice la pista', async () => {
    const { engine, c } = await conIlse();
    const script = talkScript(engine.world, c, ilsePlan(engine, c, ASK));
    const tied = engine.world.campaign.clues.filter((x) => x.npc_ids?.includes('npc_ilse') || x.sources?.some((s) => s.npc_id === 'npc_ilse'));
    expect(tied.length).toBeGreaterThan(0);
    for (const clue of tied) {
      expect(script).not.toContain(clue.how);
      expect(script).not.toContain(`«${clue.title}»`);
    }
  });

  it('negarse sin salida se reescribe; con salida o negando con el NPC hostil, no', async () => {
    const { engine, c } = await conIlse();
    const p = ilsePlan(engine, c, ASK);
    expect(closing(p, NO).join(' ')).toContain('sin dejar salida');
    // Hugo repetía «mañana» durante decenas de turnos: aplazar no lleva a ningún sitio.
    expect(closing(p, 'Eso no te lo digo. Mañana, y con la puerta cerrada.').join(' ')).toContain('sin dejar salida');
    expect(closing(p, 'Eso no se le cuenta a un forastero. Tráeme primero agua del pozo y hablamos.')).toEqual([]);
    engine.world.npc('npc_ilse').attitude.by_character[c.id] = 'hostile';
    expect(closing(ilsePlan(engine, c, ASK), NO)).toEqual([]);
  });

  it('a la segunda cierra el tema y a la tercera corta la charla', async () => {
    const { engine, c } = await conIlse();
    ilseAnswered(engine, c, ASK, NO);
    const second = ilsePlan(engine, c, ASK);
    expect(second.state.refusals).toBe(1);
    expect(talkScript(engine.world, c, second)).toContain('Ya se ha negado una vez');
    expect(endsTalk(second, ilseSays(NO))).toBe(false);
    ilseAnswered(engine, c, ASK, 'Ya te lo he dicho, Dalia: esta noche, junto al pozo.');
    const third = ilsePlan(engine, c, ASK);
    expect(third.state.refusals).toBe(2);
    expect(talkScript(engine.world, c, third)).toContain('La charla termina aquí');
    expect(endsTalk(third, ilseSays('Eso no lo digo, muchacha. Tráeme el agua y vuelve.'))).toBe(true);
    expect(endsTalk(third, ilseSays('Mi madre era de Vharn.'))).toBe(false);
  });

  it('una respuesta de verdad o el paso del tiempo ponen la cuenta a cero', async () => {
    const { engine, c } = await conIlse();
    ilseAnswered(engine, c, ASK, NO);
    ilseAnswered(engine, c, 'Ilse, ¿cuántos años llevas con esas hierbas?', 'Cuarenta, y se me nota en las manos.');
    expect(ilsePlan(engine, c, ASK).state.refusals).toBe(0);
    ilseAnswered(engine, c, ASK, NO);
    expect(talkPlan(engine.world, engine.events.all(), c, ASK, engine.nowFor(c) + 2 * 3600)!.state.refusals).toBe(0);
  });

  it('tras una negativa, lo que tiene para él ya puede salir', async () => {
    const { engine, c } = await conIlse();
    expect(ilsePlan(engine, c, ASK).state.ripe).toBe(false);
    ilseAnswered(engine, c, ASK, NO);
    const p = ilsePlan(engine, c, ASK);
    expect(p.state.can_offer.length).toBeGreaterThan(0);
    expect(p.state.ripe).toBe(true);
    expect(p.second).toBe('offer');
  });

  it('los botones no ofrecen lo que ya se le ha negado; entregar sigue valiendo', async () => {
    const { engine, c } = await conIlse();
    ilseAnswered(engine, c, 'Preguntar a Ilse por la misa del pozo', NO);
    let p = ilsePlan(engine, c, ASK);
    expect(withoutRefused(engine.world, p, ['Preguntar a Ilse por la misa del pozo', 'Ir a la plaza del pozo'])).toEqual(['Ir a la plaza del pozo']);
    ilseAnswered(engine, c, ASK, NO);
    p = ilsePlan(engine, c, ASK);
    expect(withoutRefused(engine.world, p, ['Preguntar a Ilse por el agua', 'Darle el agua a Ilse', 'Salir a la plaza'])).toEqual(['Darle el agua a Ilse', 'Salir a la plaza']);
  });
});

describe('convencer como mecánica', () => {
  it('señales con frases reales: argumentar y apretar no son lo mismo', () => {
    expect(textSignals('Ilse, te juro que no vengo de parte de Osric: dime quién firmó la carta.').argues).toBe(true);
    expect(textSignals('Brenna, si no me dices dónde se perdió Ceniza, le cuento a Garrán que escondes monedas.').presses).toBe(true);
    expect(textSignals('Ilse, no pienso ir a ciegas: dime por dónde queda el granero o te cuento lo del jarabe a Mateo.').presses).toBe(true);
    const plain = textSignals('Ilse, ¿qué opina el regidor de la tos del valle?');
    expect([plain.argues, plain.presses]).toEqual([false, false]);
  });

  it('argumentar pide tirada por el trato; apretar, Intimidación; preguntar sin más, ninguna', async () => {
    const { engine, c } = await conIlse();
    const argues = talkScript(engine.world, c, ilsePlan(engine, c, 'Ilse, te juro que no vengo de parte de Osric: ¿quién firmó la carta?'));
    expect(argues).toContain('requires_roll (skill persuasion');
    expect(argues).toContain('CD 15');
    expect(talkScript(engine.world, c, ilsePlan(engine, c, 'Ilse, ¿quién firmó la carta? Más te vale decirlo.'))).toContain('skill intimidation');
    expect(talkScript(engine.world, c, ilsePlan(engine, c, 'Ilse, ¿quién firmó la carta?'))).not.toContain('requires_roll (skill');
  });

  it('una sola tirada por charla, y con un NPC hostil ninguna', async () => {
    const { engine, c } = await conIlse();
    const text = 'Ilse, te juro que no vengo de parte de Osric: ¿quién firmó la carta?';
    ilseAnswered(engine, c, text, 'A ver qué me cuentas.', { requires_roll: { kind: 'skill', key: 'persuasion', dc: 15, advantage: 'none' } });
    const again = ilsePlan(engine, c, text);
    expect(again.state.social_tried).toBe(true);
    expect(talkScript(engine.world, c, again)).toContain('no pidas otra');
    engine.world.npc('npc_ilse').attitude.by_character[c.id] = 'hostile';
    expect(talkScript(engine.world, c, ilsePlan(engine, c, text))).not.toContain('requires_roll (skill');
  });

  it('con éxito da el camino y no el secreto; fallar cuenta como insistir', async () => {
    const { engine, c } = await conIlse();
    const ilse = engine.world.npc('npc_ilse');
    ilse.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c) };
    const now = engine.nowFor(c);
    const won = socialOutcomeLine(engine.world, engine.events.all(), c, 'persuasion', true, now)!;
    expect(won).toContain('por dónde seguir');
    for (const clue of engine.world.campaign.clues) expect(won).not.toContain(clue.how);
    expect(socialOutcomeLine(engine.world, engine.events.all(), c, 'persuasion', false, now)).toContain('se cierra');
    expect(socialOutcomeLine(engine.world, engine.events.all(), c, 'stealth', true, now)).toBeNull();

    const before = trustTier(ilse, c.id);
    expect(trustFromRoll(engine.world, c, 'persuasion', false, now)).toMatchObject({ change: 'harass', delta: -1 });
    adjustTrust(engine.world, ilse, c, 'favor', now);
    // Con éxito sube con el tope de la charla: no salta niveles.
    expect(trustFromRoll(engine.world, c, 'persuasion', true, now)!.delta).toBeLessThanOrEqual(1);
    expect(trustTier(ilse, c.id)).toBe(before);
  });
});

describe('longitud', () => {
  it('hay 25 palabras de margen: solo se recorta lo que se pasa de verdad', async () => {
    const { engine } = await bootEngine();
    const p = plan(engine, 'Hola, Brenna')!; // saludo: 30 palabras
    const words = (n: number) => Array.from({ length: n }, () => 'palabra').join(' ');
    const check = (n: number) => talkProblems(p, { lines: npcSays(words(n)), narration: '', declared: null, pendingRoll: false, npcName: 'Brenna' }).join(' ');
    expect(check(55)).not.toContain('recórtalo');
    expect(check(56)).toContain('recórtalo');
  });
});
