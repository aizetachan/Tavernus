import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import type { Engine, MasterLike, SceneNotice } from '../src/engine/engine.js';
import { npcTarget, parseTurn, talkersOf, TALK_IDLE_S, tenseScene } from '../src/engine/scene.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Máster falso: apunta cada llamada (actor, texto y el contexto que vería) y responde con una línea de Brenna. */
function fakeMaster(engine: Engine, delayMs = 0) {
  const calls: { actor: string; text: string; context: string }[] = [];
  const m: MasterLike = {
    async resolve(actor, text) {
      calls.push({ actor: actor.id, text, context: actionContext(engine, actor, text) });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return {
        ok: true, usage: {}, calls: [], context: '', model: 'falso',
        closed: { narration_private: 'Brenna os mira a los dos.', observable: null, observable_vague: null, loudness: 1, tags: ['social'], suggested_actions: ['Pedir otra jarra'], requires_roll: null, npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Una cosa cada vez.' }] },
      };
    },
  };
  engine.attachMaster(m);
  return calls;
}

/** Kael y Mira en la barra con Brenna, conectados. Kael ya está hablando con ella. */
async function bar(opts: { groupWindowMs?: number; roundMs?: number } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { groupWindowMs: opts.groupWindowMs ?? 150, roundMs: opts.roundMs ?? 150 });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  const calls = fakeMaster(engine);
  const brenna = engine.world.npc('npc_brenna');
  const talk = (who: string) => {
    engine.events.emit({ actor_id: who, action_type: 'master', narration_private: '«¿Qué hay?»', observable: null, payload: { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué hay?' }] } });
    brenna.talking_to = { character_id: who, since_game_s: engine.gameNow() };
  };
  return { engine, time, kael, mira, brenna, calls, talk };
}

const now = (e: Engine) => e.gameNow();

describe('consciencia: quién habla con quién', () => {
  it('talkersOf sigue la conversación viva y la suelta tras el silencio', async () => {
    const { engine, kael, brenna, talk, time } = await bar();
    expect(talkersOf(engine.world, engine.events.all(), brenna, now(engine))).toEqual([]);
    talk(kael.id);
    expect(talkersOf(engine.world, engine.events.all(), brenna, now(engine))).toEqual([kael.id]);
    time.advanceGame(TALK_IDLE_S + 60);
    expect(talkersOf(engine.world, engine.events.all(), brenna, now(engine))).toEqual([]);
  });

  it('a quién va la acción: el NPC nombrado o, sin nombrar a nadie, con quien ya habla', async () => {
    const { engine, kael, talk } = await bar();
    expect(npcTarget(engine.world, engine.events.all(), kael, 'preguntar a Brenna por el pozo', now(engine))?.id).toBe('npc_brenna');
    expect(npcTarget(engine.world, engine.events.all(), kael, 'pedir una jarra', now(engine))).toBeNull();
    talk(kael.id);
    expect(npcTarget(engine.world, engine.events.all(), kael, 'pedir una jarra', now(engine))?.id).toBe('npc_brenna');
    expect(parseTurn('Esperar turno con Brenna')).toEqual({ kind: 'wait', who: 'Brenna', loose: false });
    expect(parseTurn('Unirme a la conversación')).toEqual({ kind: 'join', who: '', loose: false });
  });
});

describe('el NPC atiende a uno cada vez', () => {
  it('dos PJ al mismo NPC a la vez: el primero va al máster; el segundo, gesto y dos botones, sin máster', async () => {
    const { engine, kael, mira, calls } = await bar();
    const [a, b] = await Promise.all([engine.act(kael.id, 'preguntar a Brenna por el pozo'), engine.act(mira.id, 'hablar con Brenna')]);
    expect(a.event!.action_type).toBe('master');
    // El segundo llega cuando Brenna ya habla con Kael (el cierre del máster fija talking_to).
    engine.world.npc('npc_brenna').talking_to = { character_id: kael.id, since_game_s: now(engine) };
    const c = await engine.act(mira.id, 'preguntar a Brenna por la cerveza');
    expect(c.event!.action_type).toBe('npc_busy');
    expect(c.text).toBe('Brenna está con Kael; te hace un gesto para que esperes.');
    expect(c.suggested_actions).toEqual(['Esperar turno con Brenna', 'Unirme a la conversación con Brenna']);
    expect(calls.filter((x) => x.actor === mira.id).length).toBe(b.event?.action_type === 'master' ? 1 : 0);
  });

  it('esperar turno: cuando el otro deja la conversación, «Brenna ya puede atenderte» y el turno queda guardado', async () => {
    const { engine, kael, mira, talk, brenna } = await bar();
    talk(kael.id);
    const before = (await engine.act(mira.id, 'Esperar turno con Brenna')).event!;
    expect(before.action_type).toBe('npc_wait');
    await engine.act(kael.id, 'dejar la conversación');
    const free = engine.events.all().filter((e) => e.action_type === 'npc_free' && e.actor_id === mira.id).at(-1)!;
    expect(free.narration_private).toBe('Brenna ya puede atenderte.');
    expect(free.payload['suggested_actions']).toEqual(['Hablar con Brenna']);
    expect(brenna.talking_to).toMatchObject({ character_id: mira.id, reserved: true });
    // Kael vuelve a por ella: ahora es él quien espera.
    expect((await engine.act(kael.id, 'hablar con Brenna')).event!.action_type).toBe('npc_busy');
  });

  it('esperar turno: si el otro se calla un rato, el NPC queda libre y se avisa en el tick', async () => {
    const { engine, time, kael, mira, talk } = await bar();
    talk(kael.id);
    await engine.act(mira.id, 'Esperar turno con Brenna');
    time.advanceGame(TALK_IDLE_S + 60);
    await engine.tick();
    expect(engine.events.all().some((e) => e.action_type === 'npc_free' && e.actor_id === mira.id)).toBe(true);
  });
});

describe('conversación de grupo', () => {
  it('unirse y agrupar: dos frases en la ventana, una sola llamada al máster, la misma respuesta para los dos', async () => {
    // Ventana de una hora: si la esperase, el test no acabaría; ya han hablado todos.
    const { engine, kael, mira, talk, calls } = await bar({ groupWindowMs: 3_600_000 });
    const seen: Record<string, string[]> = {};
    engine.onDelivery((d) => { (seen[d.character_id] ??= []).push(d.text); });
    talk(kael.id);
    expect((await engine.act(mira.id, 'Unirme a la conversación con Brenna')).event!.action_type).toBe('npc_join');
    const [a, b] = await Promise.all([engine.act(kael.id, 'preguntarle por el pozo'), engine.act(mira.id, 'preguntarle por la cerveza')]);
    const group = calls.filter((c) => c.text.startsWith('(conversación de grupo'));
    expect(group).toHaveLength(1);
    expect(group[0]!.context).toContain('## Conversación de grupo con Brenna: responde UNA vez a todos');
    expect(group[0]!.context).toContain('Mira [ch_mira]: preguntarle por la cerveza');
    expect(a.event!.id).toBe(b.event!.id);
    expect(a.event!.payload['group']).toEqual(expect.arrayContaining([kael.id, mira.id]));
    expect(seen[mira.id]!.at(-1)).toContain('Brenna os mira a los dos.');
  });

  it('si solo habla uno, la ventana vence y responde igual; moverse deja la conversación', async () => {
    const { engine, kael, mira, talk, calls, brenna } = await bar({ groupWindowMs: 100 });
    talk(kael.id);
    await engine.act(mira.id, 'Unirme a la conversación');
    const r = await engine.act(kael.id, 'preguntarle por el pozo');
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.text.startsWith('(conversación de grupo'))).toHaveLength(1);
    await engine.act(mira.id, 'ir a la puerta');
    expect(brenna.talking_to?.with ?? []).not.toContain(mira.id);
  });
});

describe('rondas en escenas tensas', () => {
  it('solo con dos o más PJ y escena tensa', async () => {
    const { engine, kael } = await bar();
    expect(tenseScene(engine.world, 'loc_taberna', [])).toBeNull();
    expect(tenseScene(engine.world, 'loc_taberna', ['combat'])).toBe('combate');
    engine.world.location('loc_taberna').state['tense'] = true;
    expect(tenseScene(engine.world, 'loc_taberna', [])).toBe('la historia');
    engine.setPresence('ch_mira', false); engine.setConnected('ch_mira', false);
    expect(tenseScene(engine.world, 'loc_taberna', [])).toBeNull();
    void kael;
  });

  it('ronda con un jugador ausente: vence el temporizador, el que no actuó duda, nadie se bloquea', async () => {
    const { engine, kael, mira, calls } = await bar({ roundMs: 150 });
    const notices: SceneNotice[] = [];
    engine.onScene((n) => notices.push(n));
    engine.world.location('loc_taberna').state['tense'] = true;
    const r = await engine.act(kael.id, 'saltar detrás de la barra');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe('(ronda 1) Kael: saltar detrás de la barra / dudan: Mira');
    expect(calls[0]!.context).toContain('Dudan y pierden la ronda: Mira [ch_mira]');
    expect(notices[0]).toMatchObject({ n: 1, acted: [kael.id], waiting: [mira.id], open: true });
    expect(notices.at(-1)).toMatchObject({ open: false });
    // Mira también recibe cómo se resolvió la ronda.
    expect(r.event!.delivered_to.map((d) => d.character_id)).toContain(mira.id);
  });

  it('ronda completa: si actúan todos no espera al temporizador; una segunda acción en la misma ronda se rechaza', async () => {
    // Temporizador de una hora: si lo esperase, el test no acabaría.
    const { engine, kael, mira, calls } = await bar({ roundMs: 3_600_000 });
    engine.world.location('loc_taberna').state['tense'] = true;
    const first = engine.act(kael.id, 'cubrir la puerta');
    const again = await engine.act(kael.id, 'y además gritar');
    expect(again).toMatchObject({ ok: false, text: 'Ya has actuado en la ronda 1: espera a que se resuelva.' });
    const [a, b] = await Promise.all([first, engine.act(mira.id, 'apagar la vela')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe('(ronda 1) Kael: cubrir la puerta / Mira: apagar la vela');
    expect(a.event!.id).toBe(b.event!.id);
    // La siguiente acción abre la ronda 2.
    const next = engine.act(kael.id, 'mirar por la ventana');
    await engine.act(mira.id, 'esperar');
    await next;
    expect(calls.at(-1)!.text.startsWith('(ronda 2)')).toBe(true);
  });

  it('decir sigue siendo inmediato en plena ronda', async () => {
    const { engine, kael, calls } = await bar({ roundMs: 5000 });
    engine.world.location('loc_taberna').state['tense'] = true;
    const r = await engine.act(kael.id, '— ¡Cuidado!');
    expect(r.event!.action_type).toBe('say');
    expect(calls).toHaveLength(0);
  });
});
