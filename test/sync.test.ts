/**
 * Sincronía del máster con varios jugadores (partida online del 26-10-2026,
 * Leodhin y Miau): cada acción de cada uno recibe su respuesta, las que llegan
 * a la vez se ordenan o se resuelven juntas, la narración compartida va a todos
 * y dirigida a cada uno, y el máster ve lo que acaban de hacer los demás.
 */
import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { placeholderFields, unansweredInShared } from '../src/engine/closecheck.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import type { Character } from '../src/engine/model.js';
import { namedPc, npcTarget } from '../src/engine/scene.js';
import { bootEngine, fakeTime } from './helpers.js';

type Call = { actor: string; text: string; context: string };

/** Cierre mínimo del máster falso: responde a quien actúa con lo que mandó. */
function closing(actor: Character, text: string, narration?: string) {
  return {
    ok: true as const, usage: {}, calls: [], context: '', model: 'falso',
    closed: { narration_private: narration ?? `Respuesta a ${actor.name}: ${text}`, observable: `${actor.name} hace algo: ${text}`, observable_vague: null, loudness: 1, tags: ['social'], suggested_actions: [], requires_roll: null },
  };
}

/** Máster falso que apunta cada llamada; `gate` la retiene hasta que el test la suelta. */
function fakeMaster(engine: Engine, opts: { gate?: Promise<void>; delayMs?: number; close?: (actor: Character, text: string) => ReturnType<typeof closing> } = {}) {
  const calls: Call[] = [];
  const m: MasterLike = {
    async resolve(actor, text) {
      calls.push({ actor: actor.id, text, context: actionContext(engine, actor, text) });
      if (opts.gate && calls.length === 1) await opts.gate;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return opts.close ? opts.close(actor, text) : closing(actor, text);
    },
  };
  engine.attachMaster(m);
  return calls;
}

/** Kael y Mira en la barra con Brenna, conectados, conociéndose. Lo que recibe cada uno, apuntado. */
async function bar(opts: { groupWindowMs?: number; roundMs?: number } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { groupWindowMs: opts.groupWindowMs ?? 150, roundMs: opts.roundMs ?? 5000 });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  if (!kael.knows.includes(mira.id)) kael.knows.push(mira.id);
  if (!mira.knows.includes(kael.id)) mira.knows.push(kael.id);
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  const seen = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { seen.set(d.character_id, [...(seen.get(d.character_id) ?? []), d]); });
  const brenna = engine.world.npc('npc_brenna');
  /** El PJ habla con Brenna (como tras un cierre del máster con npc_id). */
  const talk = (who: string, withIds: string[] = []) => {
    engine.events.emit({ actor_id: who, action_type: 'master', narration_private: '«¿Qué hay?»', observable: null, payload: { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué hay?' }] } });
    brenna.talking_to = { character_id: who, since_game_s: engine.gameNow(), ...(withIds.length ? { with: withIds } : {}) };
  };
  return { engine, time, kael, mira, brenna, talk, seen: (id: string) => seen.get(id) ?? [] };
}

describe('dos jugadores mandan a la vez en el mismo sitio', () => {
  it('cada uno recibe su respuesta, en orden, y el segundo la escribe sabiendo lo del primero', async () => {
    const { engine, kael, mira, seen } = await bar();
    const calls = fakeMaster(engine, { delayMs: 10 });
    const [a, b] = await Promise.all([engine.act(kael.id, 'mirar las jarras de la barra'), engine.act(mira.id, 'examinar la tablilla de deudas')]);
    expect(a).toMatchObject({ ok: true, text: 'Respuesta a Kael: mirar las jarras de la barra' });
    expect(b).toMatchObject({ ok: true, text: 'Respuesta a Mira: examinar la tablilla de deudas' });
    expect(a.event!.actor_id).toBe(kael.id);
    expect(b.event!.actor_id).toBe(mira.id);
    expect(calls.map((c) => c.actor)).toEqual([kael.id, mira.id]);
    expect(a.event!.seq).toBeLessThan(b.event!.seq);
    // El máster del segundo ve íntegro lo que mandó el primero y lo que percibió de ello.
    expect(calls[1]!.context).toContain('## Los otros jugadores aquí, desde la última acción del actor');
    expect(calls[1]!.context).toContain('- Kael mandó «mirar las jarras de la barra» → lo que percibió el actor: Kael hace algo: mirar las jarras de la barra');
    // Cada uno lee su respuesta y lo que hace el otro.
    expect(seen(kael.id).map((d) => d.text)).toEqual(expect.arrayContaining(['Respuesta a Kael: mirar las jarras de la barra', 'Mira hace algo: examinar la tablilla de deudas']));
    expect(seen(mira.id).map((d) => d.text)).toEqual(expect.arrayContaining(['Respuesta a Mira: examinar la tablilla de deudas', 'Kael hace algo: mirar las jarras de la barra']));
  });

  it('lo que espera en la cola detrás del máster lo ve quien viene después, y deja de estar al resolverse', async () => {
    const { engine, kael, mira } = await bar();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls = fakeMaster(engine, { gate });
    const first = engine.act(kael.id, 'pedir una jarra');
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toHaveLength(1);
    // Mira manda mientras el máster narra lo de Kael: espera en la cola, a la vista.
    const second = engine.act(mira.id, 'atacar al guardia ahora');
    await new Promise((r) => setTimeout(r, 5));
    expect(engine.waitingIn('loc_taberna')).toEqual([{ character_id: mira.id, text: 'atacar al guardia ahora' }]);
    expect(actionContext(engine, kael, 'ak ataque')).toContain('- Mira acaba de mandar, a la vez: «atacar al guardia ahora». Se resuelve justo después de esta acción');
    // La de Mira no se pierde: tiene su propia respuesta, después de la de Kael.
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.event!.actor_id).toBe(kael.id);
    expect(b.event!.actor_id).toBe(mira.id);
    expect(b.text).toBe('Respuesta a Mira: atacar al guardia ahora');
    expect(engine.waitingIn('loc_taberna')).toEqual([]);
    expect(calls[1]!.context).toContain('- Kael mandó «pedir una jarra»');
  });

  it('lo propio del actor no sale como «de los otros», y lo de antes de su última acción tampoco', async () => {
    const { engine, kael, mira } = await bar();
    const calls = fakeMaster(engine);
    await engine.act(mira.id, 'saludar con la cabeza');
    await engine.act(kael.id, 'beber de la jarra');
    await engine.act(kael.id, 'mirar la chimenea');
    // Lo de Mira fue antes de la última acción de Kael: ya lo vio entonces.
    expect(calls[1]!.context).toContain('- Mira mandó «saludar con la cabeza»');
    expect(calls[2]!.context).not.toContain('## Los otros jugadores aquí');
  });
});

describe('lo que un jugador dice a otro no va al NPC de la conversación', () => {
  it('namedPc y npcTarget: nombrar a otro jugador saca la acción de la charla con el NPC', async () => {
    const { engine, kael, mira, talk } = await bar();
    talk(mira.id);
    const now = engine.gameNow();
    expect(namedPc(engine.world, mira, 'oye kael creo que esta tipa miente')?.id).toBe(kael.id);
    expect(namedPc(engine.world, mira, 'pedir una jarra')).toBeNull();
    expect(npcTarget(engine.world, engine.events.all(), mira, 'pedir una jarra', now)?.id).toBe('npc_brenna');
    expect(npcTarget(engine.world, engine.events.all(), mira, 'oye Kael, creo que esta tipa miente', now)).toBeNull();
    expect(npcTarget(engine.world, engine.events.all(), mira, 'decirle a Kael que pague a Brenna', now)?.id).toBe('npc_brenna');
  });

  it('en una conversación de grupo, a la vez: lo de Kael a Brenna se agrupa; lo de Mira a Kael va aparte y el máster sabe a quién va', async () => {
    const { engine, kael, mira, talk } = await bar({ groupWindowMs: 100 });
    const calls = fakeMaster(engine);
    talk(kael.id, [mira.id]);
    const [a, b] = await Promise.all([engine.act(kael.id, 'pedir una jarra'), engine.act(mira.id, 'oye Kael, creo que esta tipa miente')]);
    expect(a.ok && b.ok).toBe(true);
    const group = calls.find((c) => c.text.startsWith('(conversación de grupo'));
    expect(group?.text).toBe('(conversación de grupo con Brenna) Kael: pedir una jarra');
    const toKael = calls.find((c) => c.actor === mira.id);
    expect(toKael?.text).toBe('oye Kael, creo que esta tipa miente');
    expect(toKael?.context).toContain('Va dirigida a Kael [ch_kael], otro JUGADOR presente, no a ningún NPC');
    expect(b.event!.actor_id).toBe(mira.id);
    expect(b.event!.payload['group']).toBeUndefined();
  });
});

describe('ronda: las dos acciones a la vez se resuelven juntas y la narración es para los dos', () => {
  it('una llamada; el cierre que solo habla a uno se rechaza; los dos leen la narración que nombra a cada uno', async () => {
    const { engine, kael, mira, seen } = await bar();
    engine.world.location('loc_taberna').state['tense'] = true;
    const errors: string[] = [];
    const calls = fakeMaster(engine, {
      close: (actor, text) => {
        const ctx: ToolContext = { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [] };
        const log = (narration: string) => JSON.parse(executeTool(ctx, 'log_event', { narration_private: narration, observable: 'Kael y Mira se lanzan a la vez.', observable_vague: null, loudness: 1, tags: 'combat', suggested_actions: '', lines: null })) as { error?: string };
        // Como en la partida: «tu maza…» a secas, escrito para el primero que actuó.
        const bad = log('Tu espada cae sobre la mesa y la sala se queda en silencio.');
        if (bad.error) errors.push(bad.error);
        expect(log('Kael, tu espada cae sobre la mesa. Mira, tu daga corta la cuerda del farol.').error).toBeUndefined();
        return { ...closing(actor, text), closed: { ...ctx.closed!, requires_roll: null } };
      },
    });
    const [a, b] = await Promise.all([engine.act(kael.id, 'golpear la mesa con la espada'), engine.act(mira.id, 'cortar la cuerda del farol')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe('(ronda 1) Kael: golpear la mesa con la espada / Mira: cortar la cuerda del farol');
    expect(calls[0]!.context).toContain('## Turno compartido');
    expect(calls[0]!.context).not.toContain('## Acción del jugador');
    expect(calls[0]!.context).toContain('«Kael, tu…»; «Mira, tu…»');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Turno compartido: narration_private la leen todos y no responde a Kael \(«golpear la mesa con la espada»\) ni a Mira \(«cortar la cuerda del farol»\)/);
    // Una sola respuesta, la misma, para los dos: con lo que mandó cada uno.
    expect(a.event!.id).toBe(b.event!.id);
    const text = 'Kael, tu espada cae sobre la mesa. Mira, tu daga corta la cuerda del farol.';
    expect(seen(kael.id).at(-1)!.text).toBe(text);
    expect(seen(mira.id).at(-1)!.text).toBe(text);
    expect(a.event!.payload['group_inputs']).toEqual({ [kael.id]: 'golpear la mesa con la espada', [mira.id]: 'cortar la cuerda del farol' });
  });

  it('en una conversación de grupo vale contestar a cada uno con una línea dirigida (to)', () => {
    const acted = [{ id: 'ch_kael', name: 'Kael' }, { id: 'ch_mira', name: 'Mira' }];
    expect(unansweredInShared({ narration: 'Brenna os observa a los dos.', acted }).map((m) => m.name)).toEqual(['Kael', 'Mira']);
    expect(unansweredInShared({ narration: 'Brenna os mira a los dos.', acted, lines: [{ speaker: 'npc', npc_id: 'npc_brenna', to: 'ch_kael', text: 'Treinta.' }, { speaker: 'npc', npc_id: 'npc_brenna', to: 'ch_mira', text: 'Las seis.' }] })).toEqual([]);
    expect(unansweredInShared({ narration: 'Brenna mira a Kael y luego a MIAU.', acted: [...acted.slice(0, 1), { id: 'ch_miau', name: 'MIAU' }] })).toEqual([]);
    // Uno solo no es turno compartido.
    expect(unansweredInShared({ narration: 'Tu maza cae.', acted: acted.slice(0, 1) })).toEqual([]);
  });
});

describe('ninguna acción se queda con relleno por respuesta', () => {
  it('«placeholder» y «x» se rechazan siempre; vacío con lines sigue valiendo', async () => {
    const { engine, mira } = await bar();
    expect(placeholderFields({ narration_private: 'placeholder', observable: 'x' })).toEqual(['narration_private', 'observable']);
    expect(placeholderFields({ narration_private: '', observable: null })).toEqual([]);
    expect(placeholderFields({ narration_private: 'Brenna te sirve.', observable: 'Brenna sirve a Mira.' })).toEqual([]);
    const ctx: ToolContext = { engine, actor: mira, nowGameS: engine.nowFor(mira), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    const log = (narration: string, observable: string | null) => JSON.parse(executeTool(ctx, 'log_event', { narration_private: narration, observable, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '', lines: null })) as { error?: string };
    expect(log('placeholder', 'x').error).toMatch(/^narration_private, observable es relleno/);
    expect(log('placeholder', 'x').error).toMatch(/es relleno/); // no se agota: nunca llega al jugador
    expect(log('Brenna te sirve una jarra.', 'Brenna sirve una jarra a Mira.').error).toBeUndefined();
    expect(ctx.closed!.narration_private).toBe('Brenna te sirve una jarra.');
  });
});
