import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { blocksSpeech, novelBlocks } from '../src/adapters/web/novel.js';
import { conversationCheck, conversationOf, narrationWithLines, type Conversation } from '../src/engine/conversation.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine } from '../src/engine/engine.js';
import type { GameEvent } from '../src/engine/model.js';
import type { DialogueLine } from '../src/engine/moments.js';
import { bootEngine } from './helpers.js';

const HERE = { location_id: 'loc_inn', spot_id: 'sp_inn_barra' };
let seq = 0;
/** Un evento grabado mínimo del PJ ch_ddd, como los de data/games/fdd. */
function ev(action_type: string, extra: { narration?: string; npc_id?: string; lines?: DialogueLine[]; spot_id?: string; location_id?: string; tags?: string[]; payload?: Record<string, unknown>; actor_id?: string | null } = {}): GameEvent {
  seq += 1;
  return {
    id: `ev_${seq}`, seq, timestamp_real_ms: 0, timestamp_game_s: 0, campaign_id: 'c', location_id: extra.location_id ?? HERE.location_id, spot_id: extra.spot_id ?? HERE.spot_id,
    actor_id: extra.actor_id === undefined ? 'ch_ddd' : extra.actor_id, action_type, input_text: null, narration_private: extra.narration ?? 'Algo pasa.', observable: null, visibility: 'location',
    tags: extra.tags ?? [], delivered_to: [],
    payload: { ...(extra.npc_id ? { npc_id: extra.npc_id } : {}), ...(extra.lines ? { lines: extra.lines } : {}), ...extra.payload },
  };
}
const me = (text: string): DialogueLine => ({ speaker: 'actor', text });
const npc = (id: string, text: string): DialogueLine => ({ speaker: 'npc', npc_id: id, text });
const talk = (id: string, narration = 'Marisa escucha.', said = 'Dime.') => ev('master', { narration, npc_id: id, lines: [me('Hola.'), npc(id, said)] });

describe('estado de conversación', () => {
  it('entra tras un turno de diálogo y cuenta los turnos; las tiradas no cuentan ni cortan', () => {
    expect(conversationOf([ev('master_intro')], 'ch_ddd', HERE)).toBeNull();
    const evs = [ev('master_intro'), talk('npc_innkeeper'), talk('npc_innkeeper')];
    expect(conversationOf(evs, 'ch_ddd', HERE)).toMatchObject({ npc_id: 'npc_innkeeper', turns: 2, npc_spoke: true });
    // Petición de tirada + tirada + desenlace: un solo turno más.
    evs.push(ev('master', { npc_id: 'npc_innkeeper', lines: [me('Fíame.')], payload: { requires_roll: { kind: 'skill', key: 'persuasion' } } }), ev('roll'), talk('npc_innkeeper'));
    expect(conversationOf(evs, 'ch_ddd', HERE)!.turns).toBe(3);
    // Lo de otros (el tablón, otro PJ) no cuenta.
    evs.push(ev('board', { actor_id: null }), ev('master', { actor_id: 'ch_otro' }));
    expect(conversationOf(evs, 'ch_ddd', HERE)!.turns).toBe(3);
  });

  it('sabe si el NPC ya ha hablado y qué gestos se han narrado', () => {
    const first = ev('master', { narration: 'Marisa deja el paño y te mira.', npc_id: 'npc_innkeeper', lines: [me('¿Hay cuarto?')] });
    expect(conversationOf([first], 'ch_ddd', HERE)).toMatchObject({ turns: 1, npc_spoke: false, gestures: ['pano', 'mirada'] });
  });

  it('se rompe al moverse, al combatir, al cambiar de interlocutor, en otro punto o tras un turno sin diálogo', () => {
    const base = [talk('npc_innkeeper'), talk('npc_innkeeper')];
    expect(conversationOf([...base, ev('arrived')], 'ch_ddd', HERE)).toBeNull();
    expect(conversationOf([...base, ev('master', { npc_id: 'npc_innkeeper', payload: { master: { calls: [{ name: 'move_to', input: {}, result: '{"ok":true}' }] } } })], 'ch_ddd', HERE)).toBeNull();
    expect(conversationOf([...base, ev('roll', { payload: { attack: { target_id: 'npc_innkeeper', hit: true } } })], 'ch_ddd', HERE)).toBeNull();
    expect(conversationOf([...base, ev('master', { npc_id: 'npc_innkeeper', payload: { master: { calls: [{ name: 'attack', input: {}, result: '{"hit":false}' }] } } })], 'ch_ddd', HERE)).toBeNull();
    // Otro interlocutor: la conversación es con él, desde el turno 1.
    expect(conversationOf([...base, talk('npc_stranger')], 'ch_ddd', HERE)).toMatchObject({ npc_id: 'npc_stranger', turns: 1 });
    expect(conversationOf([...base, ev('master', { narration: 'Miras la cuenta.' })], 'ch_ddd', HERE)).toBeNull();
    expect(conversationOf(base, 'ch_ddd', { location_id: 'loc_inn', spot_id: 'sp_inn_puerta' })).toBeNull();
    // Volver a hablar tras el corte empieza de cero.
    expect(conversationOf([...base, ev('take'), talk('npc_innkeeper')], 'ch_ddd', HERE)!.turns).toBe(1);
  });
});

const conv: Conversation = { npc_id: 'npc_innkeeper', turns: 2, npc_spoke: true, gestures: ['pano', 'mirada'] };
const reply = [me('¿Dónde está el cuarto?'), npc('npc_innkeeper', 'Por ahí. La llave ya la tienes.')];
// fdd, evento 26: 39 palabras de gestos alrededor de una frase de tres.
const FDD_26 = 'Preguntas por el cuarto. Marisa no levanta la vista del paño. Señala con el mentón la puerta de la cocina, al fondo de la barra, y se encoge de hombros. «Por ahí. La llave ya la tienes.» Vuelve a secar el mismo vaso, como si la conversación hubiera terminado.';
// fdd, evento 6: 67 palabras.
const FDD_6 = 'Marisa Quijano deja de secar el vaso y te mira por encima de la barra, sin prisa. Tu tono de sorna no le arranca ni una sonrisa. Señala con la barbilla la cuenta, donde el círculo de carbón sigue sin rellenar. «Lo que no paga la posada no lo guardo yo, y lo que no se ve en mi barra, no lo busco.» Vuelve a su paño. En el rincón del fondo, el forastero gira el anillo de latón entre los dedos y no aparta la vista de ti.';

describe('narración en conversación', () => {
  const check = (narration: string, extra: Partial<Parameters<typeof conversationCheck>[0]> = {}) =>
    conversationCheck({ conversation: conv, narration, lines: reply, npcId: 'npc_innkeeper', okTools: [], ...extra });

  it('rechaza la narración larga (sin contar lo dicho) y la de gestos repetidos', () => {
    expect(check(FDD_6)).toEqual({ kind: 'long', words: 67, max: 40 });
    expect(check(FDD_26)).toEqual({ kind: 'long', words: 42, max: 40 });
    expect(check('Marisa vuelve a su paño y se queda mirándote:')).toEqual({ kind: 'filler', gestures: ['pano', 'mirada'] });
    expect(check('Marisa se encoge de hombros:')).toBeNull(); // primera vez en esta conversación
  });

  it('acepta la narración vacía con lines, una presentación corta y una acción que cambia la escena', () => {
    expect(check('')).toBeNull();
    expect(check('Marisa deja la jarra y se vuelve hacia ti:')).toBeNull();
    expect(check('A tu espalda, la puerta se abre de golpe y entran dos guardias con antorchas.')).toBeNull();
  });

  it('vacía y sin lines no vale: falta al menos la respuesta', () => {
    expect(check('', { lines: [], npcId: null })).toEqual({ kind: 'empty' });
    expect(check('', { lines: [] })).toEqual({ kind: 'empty' });
  });

  it('fuera de conversación, con otro interlocutor, al atacar o al moverse no se comprueba', () => {
    expect(check(FDD_6, { conversation: null })).toBeNull();
    expect(check(FDD_6, { npcId: 'npc_stranger', lines: [npc('npc_stranger', 'Siéntate.')] })).toBeNull();
    expect(check(FDD_6, { attack: true })).toBeNull();
    expect(check(FDD_6, { okTools: ['move_to'] })).toBeNull();
  });

  it('el desenlace de una tirada tiene algo más de margen', () => {
    expect(check(FDD_6.replace(/ ?En el rincón.*$/, ''), { rollOutcome: true, conversation: { ...conv, gestures: [] } })).toBeNull();
    expect(check(FDD_6, { rollOutcome: true })).toEqual({ kind: 'long', words: 67, max: 60 });
  });

  it('lo dicho que no va citado se guarda como citas: el actor delante, los NPC detrás', () => {
    expect(narrationWithLines('', reply)).toBe('«¿Dónde está el cuarto?» «Por ahí. La llave ya la tienes.»');
    expect(narrationWithLines('Marisa deja la jarra y se vuelve hacia ti:', reply)).toBe('«¿Dónde está el cuarto?» Marisa deja la jarra y se vuelve hacia ti: «Por ahí. La llave ya la tienes.»');
    expect(narrationWithLines(FDD_26, reply)).toBe(FDD_26);
    expect(narrationWithLines('Miras la cuenta.', [])).toBe('Miras la cuenta.');
  });
});

describe('en el hilo (bloques) y en la voz', () => {
  const show = (narration: string, lines: DialogueLine[]) =>
    novelBlocks(narration, lines).map((b) => (b.kind === 'prose' ? `${b.lead ? 'N→' : 'N'}: ${b.text}` : `${lines[b.line]!.speaker === 'actor' ? 'YO' : lines[b.line]!.npc_id}: ${b.text ?? lines[b.line]!.text}`));

  it('sin narración no hay burbuja del narrador: solo lo que digo y lo que me responden', () => {
    expect(show(narrationWithLines('', reply), reply)).toEqual(['YO: ¿Dónde está el cuarto?', 'npc_innkeeper: Por ahí. La llave ya la tienes.']);
    expect(show('', reply)).toEqual(['YO: ¿Dónde está el cuarto?', 'npc_innkeeper: Por ahí. La llave ya la tienes.']);
  });

  it('la presentación que acaba en dos puntos va pegada al parlamento que sigue, y la voz los lee seguidos', () => {
    const stored = narrationWithLines('Marisa deja la jarra y se vuelve hacia ti:', reply);
    expect(show(stored, reply)).toEqual(['YO: ¿Dónde está el cuarto?', 'N→: Marisa deja la jarra y se vuelve hacia ti:', 'npc_innkeeper: Por ahí. La llave ya la tienes.']);
    // Sin citas en la narración (el cierre tal como lo escribe el máster), el mismo orden.
    expect(show('Marisa deja la jarra y se vuelve hacia ti:', reply)).toEqual(['YO: ¿Dónde está el cuarto?', 'N→: Marisa deja la jarra y se vuelve hacia ti:', 'npc_innkeeper: Por ahí. La llave ya la tienes.']);
    expect(blocksSpeech(novelBlocks(stored, reply), reply)).toBe('Marisa deja la jarra y se vuelve hacia ti: «Por ahí. La llave ya la tienes.»');
  });

  it('dos puntos antes de lo que dice el propio jugador, o sin parlamento detrás, no es presentación', () => {
    const lines = [me('Quiero una habitación.')];
    expect(novelBlocks('Te aclaras la garganta:', lines).some((b) => b.kind === 'prose' && b.lead)).toBe(false);
    expect(novelBlocks('Marisa señala la puerta: el cuarto está arriba.', reply).some((b) => b.kind === 'prose' && b.lead)).toBe(false);
  });
});

function ctxFor(engine: Engine): ToolContext {
  const actor = engine.world.character('ch_kael');
  return { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [] };
}
const logEvent = (priv: string, extra: Record<string, unknown> = {}) => ({
  narration_private: priv, observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: 'Esperar',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
  decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false, lines: null, ...extra,
});
const run = (ctx: ToolContext, input: Record<string, unknown>) => JSON.parse(executeTool(ctx, 'log_event', input)) as { ok?: boolean; error?: string };

/** Kael lleva un turno hablando con Brenna (emitido en el motor real). */
async function talkingToBrenna() {
  const { engine } = await bootEngine();
  engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', narration_private: 'Brenna deja la jarra en la barra y te mira. «¿Qué te pongo?»', payload: { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué te pongo?' }] } });
  return engine;
}
const brennaLines = [{ speaker: 'actor', text: 'Una cerveza.' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Dos monedas.' }];

describe('en el cierre del máster y en su contexto', () => {
  it('el contexto lleva «En conversación con…» y el turno', async () => {
    const engine = await talkingToBrenna();
    const ctx = actionContext(engine, engine.world.character('ch_kael'), 'Pedir una cerveza');
    expect(ctx).toMatch(/## En conversación con (Brenna|la tabernera)[^\n]* \(turno 2\)/);
    expect(ctx).toContain('Ya ha hablado en esta conversación');
    expect(ctx).toContain('Gestos ya narrados (no los repitas): jarra, mirada.');
    const fresh = (await bootEngine()).engine;
    expect(actionContext(fresh, fresh.world.character('ch_kael'), 'Pedir una cerveza')).not.toContain('En conversación con');
  });

  it('rechaza una vez el relleno; la narración vacía con lines pasa y se guarda con las citas', async () => {
    const engine = await talkingToBrenna();
    const ctx = ctxFor(engine);
    const r = run(ctx, logEvent('Brenna vuelve a mirarte sin prisa.', { npc_id: 'npc_brenna', lines: brennaLines }));
    expect(r.error).toMatch(/^Estás en conversación con .*: la narración repite gestos ya narrados \(mirada\)/);
    expect(ctx.closed).toBeNull();
    expect(run(ctx, logEvent('', { npc_id: 'npc_brenna', lines: brennaLines }))).toEqual({ ok: true, closed: true });
    expect(ctx.closed!.narration_private).toBe('«Una cerveza.» «Dos monedas.»');
  });

  it('en conversación, un cierre sin narración ni lines se rechaza', async () => {
    const engine = await talkingToBrenna();
    const r = run(ctxFor(engine), logEvent('', { npc_id: 'npc_brenna' }));
    expect(r.error).toContain('pon al menos su respuesta en lines');
  });
});
