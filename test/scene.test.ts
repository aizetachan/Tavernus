import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import type { Engine, MasterLike, SceneNotice } from '../src/engine/engine.js';
import { encounterAt } from '../src/engine/encounter.js';
import { npcTarget, parseTurn, talkersOf, TALK_IDLE_S, tenseScene } from '../src/engine/scene.js';
import { toMessage } from '../src/adapters/web/server.js';
import type { LogEventInput } from '../src/ai/tools.js';
import { settleAudience, viewOf } from '../src/engine/audience.js';
import type { Delivery } from '../src/engine/events.js';
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

  it('la etiqueta combat del máster tensa la escena (ronda) pero no abre combate (partida del 04-11)', async () => {
    const { engine, kael } = await bar();
    engine.events.emit({ actor_id: kael.id, action_type: 'master', input_text: 'le robo la bolsa a Brenna', narration_private: 'Brenna te agarra la muñeca.', observable: 'Brenna agarra a Kael de la muñeca.', tags: ['master', 'combat'] });
    const tags = engine.events.recentInLocation('loc_taberna', 12).flatMap((e) => e.tags);
    expect(tenseScene(engine.world, 'loc_taberna', tags)).toBeTruthy();
    expect(encounterAt(engine.world, engine.events.recentInLocation('loc_taberna', 400), 'loc_taberna', engine.gameNow())).toBeNull();
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

// ---------------------------------------------------------------------------
// Quién lee qué en la sala (audience.ts, docs/MULTIJUGADOR.md «Quién lee qué»):
// el guion de la partida del 2026-11-04 (Isgral habla con Hugo, Maikol le roba),
// con Kael en el papel de Isgral, Mira en el de Maikol y Brenna en el de Hugo.
// ---------------------------------------------------------------------------

/** Máster con guion: cada acción cierra con lo que diga `script`; si habla con un NPC, ese NPC pasa a hablar con el actor (como tools.ts). */
function scripted(engine: Engine, script: (actor: string, text: string) => Partial<LogEventInput>) {
  const m: MasterLike = {
    async resolve(actor, text) {
      const k = script(actor.id, text);
      const closed: LogEventInput = { narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: ['social'], suggested_actions: [], requires_roll: null, decisive: null, ...k };
      if (closed.npc_id) {
        const n = engine.world.npc(closed.npc_id);
        const prev = n.talking_to;
        const group = prev && (prev.character_id === actor.id || prev.with?.includes(actor.id)) ? [prev.character_id, ...(prev.with ?? [])].filter((id) => id !== actor.id) : [];
        n.talking_to = { character_id: actor.id, since_game_s: engine.nowFor(actor), ...(group.length ? { with: group } : {}) };
      }
      return { ok: true, usage: {}, calls: [], context: '', model: 'guion', closed };
    },
  };
  engine.attachMaster(m);
}

async function forge(opts: { groupWindowMs?: number } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { groupWindowMs: opts.groupWindowMs ?? 150, roundMs: 3_600_000 });
  const isgral = engine.world.character('ch_kael');
  const maikol = engine.world.character('ch_mira');
  maikol.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(isgral.id, true); engine.setPresence(maikol.id, true);
  const got: Delivery[] = [];
  engine.onDelivery((d) => got.push(d));
  const last = (id: string) => got.filter((d) => d.character_id === id).at(-1)!;
  return { engine, time, isgral, maikol, brenna: engine.world.npc('npc_brenna'), last };
}

describe('quién lee qué: tres niveles para quien está en la sala', () => {
  it('el guion: Isgral habla con Brenna (Maikol, solo el aviso), Brenna se vuelve hacia los dos (lo mismo para ambos), y ya están los dos en la charla', async () => {
    const { engine, isgral, maikol, brenna, last } = await forge();
    scripted(engine, (actor, text) => {
      if (actor === isgral.id && text.startsWith('Hablar')) return { narration_private: 'Brenna deja el trapo.', observable: 'Kael habla con Brenna en voz baja.', npc_id: 'npc_brenna', audience: 'actor', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué te pongo?' }] };
      if (actor === isgral.id) return { narration_private: `«${text}» Brenna frunce el ceño. «De eso no se habla aquí.»`, observable: null, npc_id: 'npc_brenna', lines: [{ speaker: 'actor', text }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'De eso no se habla aquí.' }] };
      return {
        narration_private: 'Mira mete la mano en el mandil de Brenna. Ella le sujeta la muñeca y se vuelve hacia Kael y Mira:',
        observable: 'Brenna pilla a Mira con la mano en su mandil.', npc_id: 'npc_brenna', audience: 'present',
        lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Quieto ahí. Esa mano no es tuya en mi mandil.', to: 'all' }],
      };
    });

    // (a) Isgral habla con Brenna: Maikol, en el mismo punto, recibe un aviso de una línea y «Unirme»; ni una frase.
    await engine.act(isgral.id, 'Hablar con Brenna para distraerla');
    const a = last(maikol.id);
    expect(a.event.payload['audience']).toBe('actor');
    const am = toMessage(a, engine);
    expect(am.notice?.text).toBe('Kael habla con Brenna en voz baja');
    expect(am.kind).toBe('system');
    expect(am.lines).toBeUndefined();
    expect(am.join).toEqual({ npc: 'npc_brenna', label: 'Unirme a la conversación con Brenna' });
    // Sin observable del máster, el aviso de siempre.
    await engine.act(isgral.id, '¿Y el pozo?');
    expect(toMessage(last(maikol.id), engine).notice?.text).toBe('Kael habla con Brenna');
    // Isgral, en cambio, lee sus frases (sin «a ti»: es una charla a solas).
    const own = toMessage(last(isgral.id), engine);
    expect(own.lines?.find((l) => l.speaker === 'npc')).toEqual(expect.objectContaining({ text: 'De eso no se habla aquí.' }));
    expect(own.lines?.find((l) => l.speaker === 'npc')?.to).toBeUndefined();

    // (b) Maikol mete la mano en el mandil y Brenna se vuelve hacia los dos: la misma narración para ambos, «a todos».
    await engine.act(maikol.id, 'Meto la mano en el mandil mientras está distraída');
    const bI = last(isgral.id), bM = last(maikol.id);
    expect(bI.event.id).toBe(bM.event.id);
    expect(bI.event.payload['audience']).toBe('present');
    expect(bI.text).toBe(bM.text);
    const mi = toMessage(bI, engine), mm = toMessage(bM, engine);
    expect(mi.notice).toBeUndefined();
    expect(mi.join).toBeUndefined();
    expect(mi.prose).toBe(mm.prose);
    expect(mi.lines?.at(-1)).toMatchObject({ speaker: 'npc', text: 'Quieto ahí. Esa mano no es tuya en mi mandil.', to: 'todos' });
    expect(mm.lines?.at(-1)).toMatchObject({ speaker: 'npc', to: 'todos' });
    // Brenna atiende al grupo: los dos están ya en su charla.
    expect(talkersOf(engine.world, engine.events.all(), brenna, now(engine)).sort()).toEqual([isgral.id, maikol.id].sort());
  });

  it('«Unirme a la conversación» desde el aviso: desde entonces lee las frases', async () => {
    const { engine, isgral, maikol, last } = await forge({ groupWindowMs: 50 });
    scripted(engine, (_actor, text) => ({ narration_private: 'Brenna os mira a los dos.', observable: null, npc_id: 'npc_brenna', lines: [{ speaker: 'actor', text }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Ya os oigo.' }] }));
    await engine.act(isgral.id, 'Hola, Brenna');
    const join = toMessage(last(maikol.id), engine).join!;
    expect((await engine.act(maikol.id, join.label)).event!.action_type).toBe('npc_join');
    await engine.act(isgral.id, '¿Qué se cuenta el pueblo?');
    const m = toMessage(last(maikol.id), engine);
    expect(m.notice).toBeUndefined();
    expect(m.lines?.map((l) => l.text)).toContain('Ya os oigo.');
  });

  it('el NPC se dirige a otro PJ (to): entra en la charla y la lee con «a ti»; quien la lleva lee «a Mira»', async () => {
    const { engine, isgral, maikol, brenna, last } = await forge();
    scripted(engine, () => ({ narration_private: 'Brenna mira por encima de tu hombro.', observable: 'Kael habla con Brenna.', npc_id: 'npc_brenna', audience: 'actor', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Y tú, ¿qué miras?', to: maikol.id }] }));
    await engine.act(isgral.id, 'Hablar con Brenna');
    const d = last(maikol.id);
    expect(d.event.payload['audience']).toBe('group');
    expect(d.event.payload['audience_ids']).toEqual([maikol.id]);
    const m = toMessage(d, engine);
    expect(m.notice).toBeUndefined();
    expect(m.lines?.at(-1)).toMatchObject({ speaker: 'npc', text: 'Y tú, ¿qué miras?', to: 'ti' });
    expect(brenna.talking_to).toMatchObject({ character_id: isgral.id, with: [maikol.id] });
    expect(toMessage(last(isgral.id), engine).lines?.at(-1)?.to).toBe('Mira');
  });

  it('algo para todos corta las charlas sueltas de la sala', async () => {
    const { engine, isgral, maikol } = await forge();
    const doro = engine.world.npc('npc_doro');
    doro.location = { type: 'spot', id: 'sp_tab_mesa' };
    doro.talking_to = { character_id: isgral.id, since_game_s: engine.gameNow() };
    scripted(engine, () => ({ narration_private: 'Mira tira un taburete: el estruendo hace callar a toda la taberna.', observable: 'Mira tira un taburete.', audience: 'present' }));
    await engine.act(maikol.id, 'Tiro un taburete al suelo');
    expect(doro.talking_to).toBeNull();
  });
});

describe('quién lee qué: el servidor valida las marcas contra el estado', () => {
  it('«all» o «present» con un solo PJ en la sala es cosa del actor; un to a quien no está, fuera', async () => {
    const { engine, isgral, maikol } = await forge();
    maikol.location = { type: 'spot', id: 'sp_pl_porton' };
    const s = settleAudience(engine.world, isgral, { audience: 'present', observable: null, npc_id: 'npc_brenna', lines: [
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'A todos.', to: 'all' },
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'A la que no está.', to: maikol.id },
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'A los dos.', to: [isgral.id, maikol.id] },
    ] }, engine.gameNow());
    expect(s.audience).toBe('actor');
    expect(s.audience_ids).toEqual([]);
    expect(s.lines.map((l) => l.to)).toEqual([isgral.id, undefined, isgral.id]);
    // A solas no hay aviso que dar.
    expect(s.observable).toBeNull();
  });

  it('un to en una línea del actor no cuenta; «group» sin nadie más en la charla es «actor»', async () => {
    const { engine, isgral } = await forge();
    const s = settleAudience(engine.world, isgral, { audience: 'group', observable: 'Kael habla con Brenna.', npc_id: 'npc_brenna', lines: [{ speaker: 'actor', text: 'Hola.', to: 'all' }] }, engine.gameNow());
    expect(s.audience).toBe('actor');
    expect(s.lines[0]!.to).toBeUndefined();
  });

  it('viewOf: suyo, compartido, en la charla o aviso; lo de antes (sin audience), con sus reglas', () => {
    const e = (payload: Record<string, unknown>) => ({ actor_id: 'a', payload });
    expect(viewOf(e({ audience: 'actor' }), 'a')).toBe('own');
    expect(viewOf(e({ audience: 'actor' }), 'b')).toBe('notice');
    expect(viewOf(e({ audience: 'group', audience_ids: ['b'] }), 'b')).toBe('party');
    expect(viewOf(e({ audience: 'group', audience_ids: ['b'] }), 'c')).toBe('notice');
    expect(viewOf(e({ audience: 'present', audience_ids: ['b', 'c'] }), 'c')).toBe('shared');
    expect(viewOf(e({ audience: 'actor', target_character_id: 'b' }), 'b')).toBe('party');
    expect(viewOf(e({ group: ['a', 'b'] }), 'b')).toBe('shared');
    expect(viewOf(e({}), 'b')).toBeNull();
  });
});
