import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actedForOthers, actedForRejection, DEAL_REJECTION, dealWithoutState, outcomeMismatch, RACE_WORDS, recentDone, rollCategory, type DoneEvent } from '../src/engine/closecheck.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRng } from '../src/engine/dice.js';
import type { Engine } from '../src/engine/engine.js';
import { normalizeSkill } from '../src/engine/rules.js';
import { bootEngine } from './helpers.js';

// Textos literales del piloto 20261022-0929 (data/local/autoplay/20261022-0929/report.md).
const P1_T13 = 'Apoyas las manos en la tabla y le sostienes la mirada. Leonor deja el cuchillo, mira alrededor y baja la voz. «Aquí no. Cuando cierre la lonja, y solo tú.» Retoma el filete como si nada. Ha cedido algo, aunque no lo que buscabas.';
const P1_T24 = 'La espada corta ya está en manos de Leonor como prenda de las diez monedas que le debes. No la llevas encima, así que no puedes ofrecerla de nuevo. Leonor espera, con el garrote sobre el hielo, a que digas qué quieres garantizar.';
const P2_T19 = 'Pasas la cuerda por la raíz del sauce, que sale retorcida del barro, y la sujetas con un nudo de cabo que tú misma sabes deshacer. El fardo deja de derivar y queda quieto contra los juncos. El barro no acepta prendas ni promesas. Lo que sí queda es tu arco, que sigue en tu mano si no lo dejas en la orilla. Un sauce no retiene nada que no esté bien anudado, y el tuyo lo está.';
const P2_T24 = 'Deshaces la primera puntada y el hilo encerado cede de golpe. El bolsillo se abre por la costura y el lodo entra. Lo rígido y plano resbala hacia la charca y se hunde entre las raíces, a un palmo de tus dedos. Puedes intentar recuperarlo, aunque ahora el agua está removida y turbia.';
const P2_T28 = 'Las raíces se aprietan en torno a tu muñeca cuando intentas aflojarlas sin prisa. Al tirar, el nudo cede y el agua negra te cubre el antebrazo. Lo blando y frío se escurre entre las raíces y desaparece en el fondo; ya no lo sientes bajo los dedos. Tienes el brazo lleno de lodo y el pulso acelerado.';
const P3_T20 = 'Matías baja el garrote un palmo y tose en el puño, largo rato. «Apúntalo. Y que no sea una de tus palabras de brujo.» Aparta la lona del todo: las cajas de madera con cierres de hierro siguen sin rótulo y sin abrir, pero ahora puedes mirarlas sin que nadie te pare. Matías vuelve a sentarse sobre un fardo, sin soltar el garrote, y espera a que hagas algo más.';
const P3_T20_LINES = [{ speaker: 'actor' as const, text: 'Matías, te pago el doble cuando lleguemos a Cuevacuervos, palabra de brujo. Apunta mi deuda, pero enséñame ya esas cajas.' }, { speaker: 'npc' as const, npc_id: 'npc_merchant', text: 'Apúntalo. Y que no sea una de tus palabras de brujo.' }];
const P4_T19 = 'Dejas la cimitarra de Dorotea a un lado y pones la cuerda de cáñamo sobre la tabla. Ella la mira sin tocarla, con la vista fija en el nudo del extremo, y niega con la cabeza. La cuerda sigue en la tabla, fuera de su alcance y del tuyo.';
const P4_T19_LINES = [{ speaker: 'npc' as const, npc_id: 'npc_thief', text: 'Una cuerda se compra en cualquier puesto de la calle. Lo que quiero es la cifra. Dime cuánto pagó la mujer y hablamos de prendas.' }];
const P10_T13 = 'La niebla no se abre, pero el silencio cambia. Oyes pasos que se alejan hacia el camino, sin prisa, y la correa deja de sonar. Alguien te ha creído lo justo para no atacar todavía. Lo que no sabes es cuánto dura ese crédito.';

describe('trato sin estado', () => {
  it('partida 3 turno 20: «Apúntalo» sin set_debt se rechaza; con set_debt pasa', () => {
    expect(dealWithoutState({ narration: P3_T20, lines: P3_T20_LINES, okTools: [] })).toEqual(['apuntalo']);
    expect(dealWithoutState({ narration: P3_T20, lines: P3_T20_LINES, okTools: ['set_debt'] })).toEqual([]);
  });

  it('partida 1 turno 24: una prenda dada por hecha sin empeño previo; con la deuda ya abierta, recordarla no es trato nuevo', () => {
    expect(dealWithoutState({ narration: P1_T24, okTools: [] })).toEqual(['como prenda']);
    expect(dealWithoutState({ narration: P1_T24, okTools: [], hasOpenDebt: true })).toEqual([]);
  });

  it('partida 2 turno 19 y partida 4 turno 19: rechazar con ingenio (o hablar de prendas) no es cerrar un trato', () => {
    expect(dealWithoutState({ narration: P2_T19, okTools: [] })).toEqual([]);
    expect(dealWithoutState({ narration: P4_T19, lines: P4_T19_LINES, okTools: [] })).toEqual([]);
  });

  it('preguntas, ofertas del actor y tratos pendientes de tirada no cuentan; un NPC que acepta fiado, sí', () => {
    expect(dealWithoutState({ narration: 'El enterrador se ríe. «¿Que te debo yo a ti?»', okTools: [] })).toEqual([]);
    const offer = [{ speaker: 'actor' as const, text: 'Te doy esta daga a cambio de la pala.' }];
    expect(dealWithoutState({ narration: '«Te doy esta daga a cambio de la pala», le dices. El enterrador entorna el ojo bueno.', lines: offer, okTools: [] })).toEqual([]);
    expect(dealWithoutState({ narration: 'Le ofreces la daga a cambio de la pala.', okTools: [] })).toEqual([]);
    expect(dealWithoutState({ narration: 'Brenna te mira. «Te lo fío hasta mañana.»', okTools: [], pendingRoll: true })).toEqual([]);
    expect(dealWithoutState({ narration: 'Brenna te mira. «Te lo fío hasta mañana.»', okTools: [] })).toEqual(['te lo fio']);
    expect(dealWithoutState({ narration: 'Te empeñas en convencerla, pero no cede.', okTools: [] })).toEqual([]);
    expect(dealWithoutState({ narration: '«Trato hecho», dice, y se guarda la daga.', okTools: ['transfer_item'] })).toEqual([]);
  });
});

describe('desenlace contra la tirada', () => {
  it('categoría por margen', () => {
    expect(rollCategory({ total: 24, dc: 15, success: true, natural: 20 })).toBe('critico');
    expect(rollCategory({ total: 19, dc: 13, success: true })).toBe('exito_claro');
    expect(rollCategory({ total: 13, dc: 13, success: true })).toBe('exito_justo');
    expect(rollCategory({ total: 7, dc: 12, success: false })).toBe('fallo');
    expect(rollCategory({ total: 2, dc: 12, success: false })).toBe('pifia');
    expect(rollCategory({ total: 9, dc: 12, success: false, natural: 1 })).toBe('pifia');
    expect(rollCategory({ total: 9, dc: null, success: null })).toBeNull();
  });

  it('partida 1 turno 13 (natural 20) y partida 10 turno 13 (éxito claro) narrados a medias', () => {
    expect(outcomeMismatch('critico', P1_T13)).toEqual(['aunque no']);
    expect(outcomeMismatch('exito_claro', P10_T13)).toEqual(['lo justo para no']);
    expect(outcomeMismatch('exito_justo', P1_T13)).toEqual([]);
    expect(outcomeMismatch('exito_claro', 'Se acerca un paso, lo justo para que solo la oigas: «Baja la voz».')).toEqual([]);
  });

  it('partida 2 turno 28: un fallo simple que hace desaparecer lo buscado; el turno 24 solo complica', () => {
    expect(outcomeMismatch('fallo', P2_T28)).toEqual(['desaparece', 'ya no lo sientes']);
    expect(outcomeMismatch('fallo', P2_T24)).toEqual([]);
    expect(outcomeMismatch('pifia', P2_T28)).toEqual([]);
    expect(outcomeMismatch('fallo', 'La cuerda no se rompe, pero cruje.')).toEqual([]);
  });
});

function ctxFor(engine: Engine, extra: Partial<ToolContext> = {}): ToolContext {
  const actor = engine.world.character('ch_kael');
  return { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [], ...extra };
}
const logEvent = (priv: string, extra: Record<string, unknown> = {}) => ({
  narration_private: priv, observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: 'Esperar',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
  decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false, lines: null, ...extra,
});
const run = (ctx: ToolContext, name: string, input: Record<string, unknown>) => JSON.parse(executeTool(ctx, name, input)) as { ok?: boolean; error?: string };

describe('en el cierre del máster', () => {
  it('rechaza el trato sin registrar una vez; tras set_debt el mismo cierre pasa', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine);
    const ev = logEvent('Brenna asiente. «Te lo apunto: diez monedas.»', { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Te lo apunto: diez monedas.' }] });
    const r = run(ctx, 'log_event', ev);
    expect(r.error).toContain(DEAL_REJECTION);
    expect(r.error).toContain('«te lo apunto»');
    expect(ctx.closed).toBeNull();
    expect(run(ctx, 'set_debt', { npc_id: 'npc_brenna', amount: 10, reason: 'una jarra', due_in_hours: null }).ok).toBe(true);
    const c2 = ctxFor(engine, { ok_tools: ['set_debt'] });
    expect(run(c2, 'log_event', ev)).toEqual({ ok: true, closed: true });
  });

  it('rechaza el crítico narrado a medias; el segundo intento pasa (no se bloquea la acción)', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine, { roll_category: 'critico' });
    const r = run(ctx, 'log_event', logEvent(P1_T13));
    expect(r.error).toMatch(/^La tirada fue un crítico: lo consigue del todo/);
    expect(r.error).toContain('«aunque no»');
    expect(run(ctx, 'log_event', logEvent(P1_T13))).toEqual({ ok: true, closed: true });
  });

  it('el contexto de la tirada lleva la categoría con su instrucción', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const ctx = actionContext(engine, kael, '', { original_text: 'Insistir con Brenna', result: { expr: 'd20', total: 24, natural: 20, breakdown: 'd20 [20] + 4 = 24', rolls: [20], modifier: 4, dc: 15, success: true, advantage: 'none', d20s: [20], label: 'Intimidación' } });
    expect(ctx).toContain('Intimidación: d20 [20] + 4 = 24 → ÉXITO (20 natural).\nCategoría: CRÍTICO (margen +9): lo consigue del todo y además algo a su favor.');
  });

  it('skills escritas a la inglesa o en castellano se entienden («animal handling»)', async () => {
    expect(normalizeSkill('animal handling')).toBe('animal_handling');
    expect(normalizeSkill('Trato con animales')).toBe('animal_handling');
    expect(normalizeSkill('Sleight-of-hand')).toBe('sleight_of_hand');
    const { engine } = await bootEngine();
    const ctx = ctxFor(engine);
    expect(run(ctx, 'log_event', logEvent('Tiendes la carne al lobo, despacio.', { requires_roll_kind: 'skill', requires_roll_key: 'animal handling', requires_roll_dc: 12, requires_roll_advantage: 'none' }))).toEqual({ ok: true, closed: true });
    expect(ctx.closed!.requires_roll!.key).toBe('animal_handling');
  });

  it('get_location con un ID de punto devuelve su localización', async () => {
    const { engine } = await bootEngine();
    expect(JSON.parse(executeTool(ctxFor(engine), 'get_location', { location_id: 'sp_tab_mesa' })).id).toBe('loc_taberna');
  });
});

describe('el máster no actúa por otro jugador (la-noche-del-breazl)', () => {
  type Ev = DoneEvent & { narration_private: string };
  const log = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'la-noche-del-breazl.events.json'), 'utf8')) as Ev[];
  const PCS = {
    ch_aren_mvnrie48: { id: 'ch_aren_mvnrie48', name: 'Aren', refs: ['Aren', 'un humano con pinta de guerrero', ...RACE_WORDS['human']!, 'guerrero'] },
    ch_leodhin_mvnrrvnl: { id: 'ch_leodhin_mvnrrvnl', name: 'Leodhin', refs: ['Leodhin', 'un elfo con pinta de explorador', ...RACE_WORDS['elf']!, 'explorador'] },
  } as const;
  const check = (seq: number) => {
    const i = log.findIndex((e) => e.seq === seq);
    const e = log[i]!;
    const before = log.slice(0, i);
    const actor = PCS[e.actor_id as keyof typeof PCS];
    const others = Object.values(PCS).filter((p) => p.id !== actor.id).map((p) => ({ id: p.id, label: p.name, refs: [...p.refs], ...recentDone(before, actor.id, p) }));
    return actedForOthers({ texts: [e.narration_private, e.observable ?? ''], others, actorRefs: [actor.name], npcRefs: ['Hugo', 'herrero'] });
  };
  const master = log.filter((e) => e.action_type.startsWith('master'));

  it('caza los turnos 23, 24, 25 y 26 y ninguno más', () => {
    const caught = master.filter((e) => check(e.seq).length > 0).map((e) => e.seq);
    expect(caught).toEqual([23, 24, 25, 26]);
  });

  it('dice qué y de quién', () => {
    expect(check(23).map((h) => h.cls)).toContain('look'); // «Te devuelve la mirada»
    expect(check(24).map((h) => h.phrase)).toContain('sin apartar la vista'); // «Aren aguarda junto al yunque, sin apartar la vista de la puerta»
    expect(check(25).map((h) => h.cls)).toContain('look'); // «Él no dice nada todavía; espera, con la vista fija en ti»
    expect(check(26).map((h) => h.cls)).toContain('look'); // «Aren aguarda, con la mirada fija en ti»
    expect(actedForRejection(check(24))).toContain('Aren');
  });

  it('lo que consta en sus eventos sí se puede contar', () => {
    const others = [{ id: 'b', label: 'Mira', refs: ['Mira'], done: new Set<'look'>(['look']), attentive: true }];
    expect(actedForOthers({ texts: ['Mira te observa desde la barra.'], others })).toEqual([]);
    expect(actedForOthers({ texts: ['Le das la daga a Mira. Asiente sin decir nada.'], others }).map((h) => h.cls)).toEqual(['gesture']);
    expect(actedForOthers({ texts: ['Te acercas a Mira. Brenna asiente.'], others, npcRefs: ['Brenna'] })).toEqual([]);
  });
});
