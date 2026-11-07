/**
 * El modo del narrador por turno (src/engine/narrator.ts, docs/CONVERSACION-REGLAS.md §7): si solo hablan, se ven
 * las conversaciones. El motor decide el modo (talk), el cierre lo hace cumplir sin reescrituras (tools), quita las
 * frases de narración repetidas (closecheck) y la web pinta el gesto de quien habla dentro de su burbuja (novel).
 */
import { describe, expect, it } from 'vitest';
import { actionContext, talkPlanFor } from '../src/ai/prompt.js';
import { executeTool, parseLines, type ToolContext } from '../src/ai/tools.js';
import { Master } from '../src/ai/master.js';
import { narratorModeIn, offlineClient } from '../src/ai/offline.js';
import { applyNarratorMode, clipLineBeat, closingMode, narratorLine, physicalAction, type NarratorPlan } from '../src/engine/narrator.js';
import { recentNarration, withoutRepeatedNarration } from '../src/engine/closecheck.js';
import { talkScript, type TalkPlan } from '../src/engine/talk.js';
import { novelBlocks } from '../src/adapters/web/novel.js';
import type { DialogueLine } from '../src/engine/moments.js';
import type { GameEvent } from '../src/engine/model.js';
import type { Engine } from '../src/engine/engine.js';
import { seededRng } from '../src/engine/dice.js';
import { narratorStats, per10, simulate } from '../scripts/narrator-count.js';
import { bootEngine, fakeTime } from './helpers.js';

const npc = (text: string, extra: Partial<DialogueLine> = {}): DialogueLine => ({ speaker: 'npc', npc_id: 'npc_brenna', text, ...extra });
const silent: NarratorPlan = { mode: 'silent', why: 'charla sin más' };

/** Motor con el máster offline (sin API) y una charla con Brenna ya empezada. */
async function talking() {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { deterministic: true, rng: () => 0.99 });
  engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
  const first = await engine.act('ch_kael', 'Hola, Brenna');
  time.advanceGame(30);
  return { engine, first, time };
}

function planFor(engine: Engine, text: string): TalkPlan | null {
  return talkPlanFor(engine, engine.world.character('ch_kael'), text);
}

function close(engine: Engine, p: TalkPlan | null, extra: Record<string, unknown>, ctxExtra: Partial<ToolContext> = {}) {
  const kael = engine.world.character('ch_kael');
  const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(7), closed: null, rolls: [], progress: [], ...(p ? { talk: p } : {}), ...ctxExtra };
  const res = JSON.parse(executeTool(ctx, 'log_event', {
    narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: 'npc_brenna', ...extra,
  })) as { ok?: boolean; error?: string };
  return { res, closed: ctx.closed };
}

describe('hablar o hacer (physicalAction)', () => {
  it('lo que se dice es charla, aunque nombre robos, caminos o trabajo', () => {
    for (const t of ['¿Qué ha pasado aquí?', 'No he hecho nada, Doro', 'Busco trabajo, ¿tienes algo?', '¿Sabes algo del robo?', 'Espero que me creas', 'Me siento fatal por lo de tu hermano', 'Te voy a contar una cosa', '«Me voy a quedar», le digo']) {
      expect(physicalAction(t), t).toBe(false);
    }
  });
  it('una acción física, aunque vaya con algo dicho, no', () => {
    for (const t of ['Saco la daga y le digo «quieta»', 'Me acerco a la barra', 'Levanto las manos', 'Ataco a Doro', 'Huyo por el callejón', 'Abro la puerta de la trastienda', 'Le robo la bolsa']) {
      expect(physicalAction(t), t).toBe(true);
    }
  });
});

describe('el modo antes de llamar al máster (talk)', () => {
  it('la charla empieza: narración normal, que presenta; luego, charla sin más: en silencio', async () => {
    const { engine, first } = await talking();
    expect((first.event!.payload['master'] as { narrator?: { mode: string } }).narrator?.mode).toBe('full');
    const p = planFor(engine, '¿Y qué tal el día por aquí?')!;
    expect(p.narrator).toEqual({ mode: 'silent', why: 'charla sin más' });
  });

  it('una acción física en mitad de la charla, o con algo pequeño que cambia', async () => {
    const { engine } = await talking();
    expect(planFor(engine, 'Saco la daga y le digo «quieta»')!.narrator!.mode).toBe('full');
    expect(planFor(engine, 'Cállate, idiota')!.narrator).toEqual({ mode: 'beat', why: 'insulto o amenaza: cambia la actitud' });
    expect(planFor(engine, 'Bueno, me despido, hasta luego')!.narrator!.mode).toBe('beat');
    // Pedirle trabajo a quien tiene algo que dar: una misión que se da.
    expect(planFor(engine, '¿Tienes algún trabajo para mí?')!.narrator).toEqual({ mode: 'beat', why: 'le da una misión' });
  });

  it('algo pasa además de la charla (un gancho, un imprevisto): narración normal', async () => {
    const { engine } = await talking();
    (engine as unknown as { hints: Map<string, unknown> }).hints.set('ch_kael', { hooks: [], encounter: { chance: 1 } });
    expect(planFor(engine, '¿Y qué tal el día por aquí?')!.narrator).toEqual({ mode: 'full', why: 'imprevisto' });
  });

  it('el contexto del máster lo dice al final de «Cómo responde…», y la regla CONVERSACIÓN remite a él', async () => {
    const { engine } = await talking();
    const kael = engine.world.character('ch_kael');
    const p = planFor(engine, '¿Y qué tal el día por aquí?')!;
    const ctx = actionContext(engine, kael, '¿Y qué tal el día por aquí?', undefined, undefined, undefined, undefined, p);
    expect(ctx).toContain('Narrador en este turno: en silencio, solo lines');
    expect(talkScript(engine.world, kael, p).split('\n').at(-2)).toMatch(/^Narrador en este turno/);
    expect(narratorModeIn(ctx)).toBe('silent');
    expect(narratorLine({ mode: 'beat', why: 'compra o venta' })).toContain('15 palabras');
    expect(narratorModeIn(actionContext(engine, kael, 'Me acerco a la chimenea'))).toBe('full');
  });
});

describe('el modo al cierre (closingMode)', () => {
  it('lo que pasa en el turno lo sube, nunca lo baja', () => {
    expect(closingMode(silent, { okTools: ['attack'] }).mode).toBe('full');
    expect(closingMode(silent, { okTools: ['move_to'] }).mode).toBe('full');
    expect(closingMode(silent, { okTools: ['npc_trust'] })).toEqual({ mode: 'beat', why: 'tool npc_trust' });
    expect(closingMode(silent, { okTools: ['give_coins', 'get_npc'] }).mode).toBe('beat');
    expect(closingMode(silent, { okTools: [], roll: { kind: 'skill' } }).mode).toBe('beat');
    expect(closingMode(silent, { okTools: [], roll: { kind: 'attack' } }).mode).toBe('full');
    expect(closingMode(silent, { okTools: [], approached: true }).mode).toBe('full');
    expect(closingMode({ mode: 'full', why: 'x' }, { okTools: ['npc_trust'] }).mode).toBe('full');
    expect(closingMode(silent, { okTools: ['get_npc', 'get_character'] })).toBe(silent);
  });
});

describe('la narración según el modo (applyNarratorMode)', () => {
  const refs = () => ['doro', 'alguacil'];
  const lines = [{ speaker: 'actor', text: 'No he hecho nada' } as DialogueLine, { speaker: 'npc', npc_id: 'npc_doro', text: '¡Las manos a la vista!' } as DialogueLine];

  it('en silencio: la frase corta que presenta a quien habla pasa a su acotación', () => {
    const cut = applyNarratorMode('silent', 'Doro vuelve a gritar, con la voz más alta de lo que quiere:', lines, refs);
    expect(cut).toEqual({ narration: '', beat: { npc_id: 'npc_doro', text: 'Doro vuelve a gritar, con la voz más alta de lo que quiere:' }, dropped: '' });
  });

  it('en silencio: lo demás se descarta (queda para depurar), y el relleno no cuenta como frase', () => {
    const long = 'Ilse sigue sin decir nada. La plaza espera. Doro aprieta la mandíbula y mira a los vecinos, que se apartan un paso sin dejar de mirar la escena.';
    const cut = applyNarratorMode('silent', long, lines, refs);
    expect(cut.narration).toBe('');
    expect(cut.beat).toBeUndefined();
    expect(cut.dropped).toBe(long);
    // «Ilse sigue sin decir nada. Doro gruñe.»: el relleno fuera, queda una frase corta que nombra a Doro.
    expect(applyNarratorMode('silent', 'Ilse sigue sin decir nada. Doro gruñe.', lines, refs).beat?.text).toBe('Doro gruñe.');
  });

  it('con acotación: una frase de 15 palabras como mucho, sin relleno', () => {
    const cut = applyNarratorMode('beat', 'La plaza espera. Doro deja caer la bolsa en tu mano, pesada, y se aparta hacia la fuente mientras los vecinos murmuran entre ellos.', lines, refs);
    expect(cut.narration).toBe('Doro deja caer la bolsa en tu mano, pesada.');
    expect(cut.narration.split(/\s+/).length).toBeLessThanOrEqual(15);
    expect(applyNarratorMode('beat', 'Doro sonríe.', lines, refs)).toEqual({ narration: 'Doro sonríe.', dropped: '' });
  });

  it('narración normal, o sin nadie que hable: no se toca', () => {
    const text = 'Sales al umbral. La lluvia cae sobre la plaza y Doro vuelve a gritar.';
    expect(applyNarratorMode('full', text, lines, refs).narration).toBe(text);
    expect(applyNarratorMode('silent', text, [lines[0]!], refs).narration).toBe(text);
  });

  it('el gesto que escribe el máster en la línea: sin comillas y corto', () => {
    expect(clipLineBeat('«baja la voz»')).toBe('baja la voz');
    expect(clipLineBeat('se inclina sobre el mostrador, mira a los lados, baja la voz y te habla casi al oído como si fuera un secreto')).toBe('se inclina sobre el mostrador, mira a los lados');
    expect(parseLines([{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Ven.', beat: 'te hace un gesto' }, { speaker: 'actor', text: 'Voy', beat: 'x' }], null, () => true))
      .toEqual([npc('Ven.', { beat: 'te hace un gesto' }), { speaker: 'actor', text: 'Voy' }]);
  });
});

describe('frases de narración repetidas (closecheck)', () => {
  it('la que ya dijo en los últimos turnos se quita, sin reescritura; lo nuevo y lo dicho se quedan', () => {
    const said = ['Doro levanta la mano. Ilse sigue sin decir nada, con la mirada en el suelo.', 'La plaza espera en silencio.'];
    const r = withoutRepeatedNarration('Ilse sigue sin decir nada, con la mirada en el suelo. Doro da un paso hacia ti. «Quieto.»', said);
    expect(r.narration).toBe('Doro da un paso hacia ti. «Quieto.»');
    expect(r.removed).toEqual(['Ilse sigue sin decir nada, con la mirada en el suelo.']);
    expect(withoutRepeatedNarration('La plaza espera en silencio.', said)).toEqual({ narration: 'La plaza espera en silencio.', removed: [] });
  });

  it('lo que cuenta es la prosa del narrador de los últimos turnos de ese PJ, sin las citas', () => {
    const ev = (seq: number, actor: string, narration: string, lines: DialogueLine[] = []) => ({ seq, actor_id: actor, action_type: 'master', narration_private: narration, payload: { lines } }) as unknown as GameEvent;
    const events = [
      ev(1, 'ch_kael', 'Muy antiguo.'),
      ev(2, 'ch_kael', 'Brenna se seca las manos. «Treinta la jarra.»', [npc('Treinta la jarra.')]),
      ev(3, 'ch_mira', 'Otra cosa.'),
      ev(4, 'ch_kael', 'La plaza espera.'), ev(5, 'ch_kael', 'Uno.'), ev(6, 'ch_kael', 'Dos.'),
    ];
    const r = recentNarration(events, 'ch_kael');
    expect(r).toHaveLength(4);
    expect(r[0]).toBe('Brenna se seca las manos.');
  });
});

describe('el cierre lo hace cumplir (tools)', () => {
  it('en silencio: la narración larga no se rechaza; se vacía y queda en payload.master para depurar', async () => {
    const { engine } = await talking();
    const p = planFor(engine, '¿Y qué tal el día por aquí?')!;
    const long = 'Brenna deja el paño sobre la barra y te mira un rato largo, como si pesara cada palabra antes de soltarla. Fuera, la lluvia sigue cayendo sobre la plaza y alguien cierra un postigo de golpe. Al fondo, el viejo de la mesa del rincón levanta la cabeza un instante y vuelve a su jarra sin decir nada.';
    const { res, closed } = close(engine, p, { narration_private: long, lines: [npc('Largo. Como todos últimamente.', { beat: 'resopla' })] });
    expect(res).toEqual({ ok: true, closed: true });
    expect(closed!.narration_private).toBe('«Largo. Como todos últimamente.»');
    expect(closed!.lines).toEqual([npc('Largo. Como todos últimamente.', { beat: 'resopla' })]);
    expect(closed!.narrator).toMatchObject({ mode: 'silent', dropped: long });
  });

  it('en silencio: la frase corta que presenta a quien habla pasa a su acotación', async () => {
    const { engine } = await talking();
    const p = planFor(engine, '¿Y qué tal el día por aquí?')!;
    const { closed } = close(engine, p, { narration_private: 'Brenna se encoge de hombros:', lines: [npc('Tranquilo.')] });
    expect(closed!.lines).toEqual([npc('Tranquilo.', { beat: 'Brenna se encoge de hombros:' })]);
    expect(closed!.narrator).toMatchObject({ mode: 'silent', to_beat: 'Brenna se encoge de hombros:' });
  });

  it('si el máster ataca, mueve o cambia la confianza, el modo sube al cierre', async () => {
    const { engine } = await talking();
    const p = planFor(engine, '¿Y qué tal el día por aquí?')!;
    const long = 'Brenna golpea la barra con la palma abierta, tan fuerte que las jarras tiemblan, y te señala la puerta sin apartar los ojos de los tuyos.';
    const full = close(engine, p, { narration_private: long, lines: [npc('Fuera.')] }, { ok_tools: ['move_to'] });
    expect(full.closed!.narration_private).toBe(`${long} «Fuera.»`);
    expect(full.closed!.narrator!.mode).toBe('full');
    const beat = close(engine, p, { narration_private: long, lines: [npc('Fuera.')] }, { ok_tools: ['npc_trust'] });
    expect(beat.closed!.narrator!.mode).toBe('beat');
    expect(beat.closed!.narration_private).toBe('Brenna golpea la barra con la palma abierta, tan fuerte que las jarras tiemblan. «Fuera.»');
  });

  it('fuera de una charla (sin plan) la narración solo pierde lo que ya dijo antes', async () => {
    const { engine } = await talking();
    engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', input_text: 'miro', narration_private: 'La lluvia golpea los cristales sin parar.', observable: null, loudness: 1, tags: ['master'], payload: {} }, engine.now());
    const { closed } = close(engine, null, { narration_private: 'La lluvia golpea los cristales sin parar. Un carro pasa por la calle.', npc_id: null });
    expect(closed!.narration_private).toBe('Un carro pasa por la calle.');
    expect(closed!.narrator).toEqual({ mode: 'full', why: null, repeated: ['La lluvia golpea los cristales sin parar.'] });
  });
});

describe('la acotación dentro de la burbuja (novel)', () => {
  it('el beat de la línea va encima de su frase, como la presentación con dos puntos', () => {
    const lines = [{ speaker: 'actor', text: 'No he hecho nada' } as DialogueLine, npc('¡Entrégate, Cat! ¡Las manos a la vista!', { beat: 'vuelve a gritar, con la voz más alta' })];
    expect(novelBlocks('«No he hecho nada» «¡Entrégate, Cat! ¡Las manos a la vista!»', lines)).toEqual([
      { kind: 'line', line: 0 },
      { kind: 'prose', text: 'vuelve a gritar, con la voz más alta', lead: true },
      { kind: 'line', line: 1 },
    ]);
  });

  it('si el narrador ya la presenta con dos puntos, manda la del narrador; una frase partida lleva el beat una vez', () => {
    const lines = [npc('Treinta la jarra. Y no fío.', { beat: 'sin levantar la vista' })];
    expect(novelBlocks('Brenna se vuelve hacia ti: «Treinta la jarra. Y no fío.»', lines)).toEqual([
      { kind: 'prose', text: 'Brenna se vuelve hacia ti:', lead: true },
      { kind: 'line', line: 0 },
    ]);
    const split = novelBlocks('«Treinta la jarra.» Se cruza de brazos. «Y no fío.»', lines);
    expect(split.filter((b) => b.kind === 'prose' && b.lead)).toEqual([{ kind: 'prose', text: 'sin levantar la vista', lead: true }]);
  });

  it('dos NPC que se hablan: cada uno en su burbuja, con su gesto', () => {
    const lines = [npc('Déjalo, Doro. No ha sido él.', { npc_id: 'npc_ilse', beat: 'por fin levanta la cabeza' }), npc('Tú calla, Ilse.', { npc_id: 'npc_doro' })];
    const blocks = novelBlocks('«Déjalo, Doro. No ha sido él.» «Tú calla, Ilse.»', lines);
    expect(blocks.filter((b) => b.kind === 'prose' && !b.lead)).toEqual([]);
    expect(blocks).toHaveLength(3);
  });
});

describe('una charla de cinco turnos con el máster offline', () => {
  it('solo burbujas de personajes salvo una acotación (la presentación del primer turno)', async () => {
    const { engine, first, time } = await talking();
    const turns = [first];
    for (const t of ['¿Y qué tal el día por aquí?', '¿Llueve mucho por aquí en otoño?', 'Ya veo. ¿Y la gente del pueblo?', '¿Qué se cuenta de los caminos?']) {
      turns.push(await engine.act('ch_kael', t));
      time.advanceGame(30);
    }
    const modes = turns.map((r) => (r.event!.payload['master'] as { narrator?: { mode: string } }).narrator?.mode);
    expect(modes).toEqual(['full', 'silent', 'silent', 'silent', 'silent']);
    const blocks = turns.map((r) => novelBlocks(r.event!.narration_private, r.event!.payload['lines'] as DialogueLine[]));
    const narrator = blocks.flat().filter((b) => b.kind === 'prose' && !b.lead);
    const leads = blocks.flat().filter((b) => b.kind === 'prose' && b.lead);
    expect(narrator).toEqual([]);
    expect(leads).toEqual([{ kind: 'prose', text: 'Brenna levanta la vista:', lead: true }]);
    // La medición (scripts/narrator-count.ts) cuenta lo mismo: cero burbujas del narrador por cada 10 turnos de charla.
    const stats = narratorStats(engine.events.all());
    expect(stats).toMatchObject({ talk_turns: 5, narrator_bubbles: 0, leads: 1 });
    expect(per10(stats)).toBe(0);
  });
});

describe('medir (scripts/narrator-count.ts)', () => {
  const ev = (seq: number, g: number, input: string, narration: string, lines: DialogueLine[], calls: string[] = []) => ({
    seq, actor_id: 'ch_cat', action_type: 'master', input_text: input, timestamp_game_s: g, narration_private: narration,
    payload: { lines, master: { calls: calls.map((name) => ({ name, input: {}, result: '{"ok":true}' })) } },
  }) as unknown as GameEvent;
  const doro = (text: string) => ({ speaker: 'npc', npc_id: 'npc_doro', text }) as DialogueLine;

  it('burbujas del narrador por cada 10 turnos de charla, antes y como lo dejaría hoy el cierre', () => {
    const events = [
      ev(1, 0, 'Doro, soy yo', 'Doro se gira hacia ti, la mano en el pomo. La plaza espera. «Quieta ahí.»', [doro('Quieta ahí.')]),
      ev(2, 60, 'No he hecho nada', 'Doro no se mueve. Ilse sigue sin decir nada. La plaza espera. «Eso lo decidirá el regidor.»', [doro('Eso lo decidirá el regidor.')]),
      ev(3, 120, '¿Y Ilse qué dice?', 'Ilse sigue sin decir nada. Doro resopla. «Ilse no tiene nada que decir.»', [doro('Ilse no tiene nada que decir.')]),
      ev(4, 180, 'Saco la daga', 'Desenvainas. «¡Suéltala!»', [doro('¡Suéltala!')]),
    ];
    const before = narratorStats(events);
    expect(before).toMatchObject({ talk_turns: 3, narrator_bubbles: 3 });
    expect(per10(before)).toBe(10);
    const after = narratorStats(simulate(events));
    expect(after).toMatchObject({ talk_turns: 3, narrator_bubbles: 1 });
  });
});
