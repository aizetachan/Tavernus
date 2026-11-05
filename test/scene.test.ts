import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike, SceneNotice } from '../src/engine/engine.js';
import { encounterAt } from '../src/engine/encounter.js';
import { spawnItem } from '../src/engine/inventory.js';
import { npcTarget, parseTurn, talkersOf, TALK_IDLE_S, tenseScene } from '../src/engine/scene.js';
import { windowClashes } from '../src/engine/turnwindow.js';
import { toMessage } from '../src/adapters/web/server.js';
import type { LogEventInput } from '../src/ai/tools.js';
import { settleAudience, viewOf } from '../src/engine/audience.js';
import type { Delivery } from '../src/engine/events.js';
import { bootEngine, fakeTime, fightAt } from './helpers.js';

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
async function bar(opts: { groupWindowMs?: number; roundMs?: number; turnWindowMs?: number } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { groupWindowMs: opts.groupWindowMs ?? 150, roundMs: opts.roundMs ?? 150, turnWindowMs: opts.turnWindowMs ?? 0 });
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
    fightAt(engine);
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
    fightAt(engine);
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
    fightAt(engine);
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
    fightAt(engine);
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

  it('sin observable ni npc_id en el cierre, el aviso sale del NPC que habla en lines y a quien se dirige le llega la frase', async () => {
    const { engine, isgral, maikol, last } = await forge();
    scripted(engine, () => ({ narration_private: 'Brenna mira por encima de tu hombro.', observable: null, npc_id: null, lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Y tú, ¿qué miras?', to: maikol.id }] }));
    await engine.act(isgral.id, 'Hablar con Brenna');
    const d = last(maikol.id);
    expect(d.event.observable).toBe('Kael habla con Brenna.');
    expect(d.event.payload['audience_ids']).toEqual([maikol.id]);
    expect(toMessage(d, engine).lines?.at(-1)).toMatchObject({ speaker: 'npc', text: 'Y tú, ¿qué miras?', to: 'ti' });
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

/**
 * Partida del 2026-11-04 (Isgral y Maikol con Hugo en la herrería), aquí con Kael y Mira en la barra con Brenna.
 * El máster falso cierra con el log_event real (tools.ts): lo que escribe `close` pasa por los mismos controles.
 */
function toolMaster(engine: Engine, close: (ctx: ToolContext, text: string) => Record<string, unknown>[]) {
  const calls: { actor: string; text: string; context: string }[] = [];
  const errors: string[] = [];
  const m: MasterLike = {
    async resolve(actor, text) {
      calls.push({ actor: actor.id, text, context: actionContext(engine, actor, text) });
      const ctx: ToolContext = { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [], action_text: text };
      for (const input of close(ctx, text)) {
        const r = JSON.parse(executeTool(ctx, 'log_event', { observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '', lines: null, ...input })) as { error?: string };
        if (r.error) errors.push(r.error);
        if (ctx.closed) break;
      }
      return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: ctx.closed ?? { narration_private: 'Sin cierre.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
    },
  };
  engine.attachMaster(m);
  return { calls, errors };
}

describe('ventana de turno: varios a la vez en el mismo sitio', () => {
  it('dos acciones dentro de la ventana van en una llamada y cada uno lee su parte y la común', async () => {
    // Ventana de una hora: si la esperase, el test no acabaría; se cierra en cuanto han mandado los dos.
    const { engine, kael, mira } = await bar({ turnWindowMs: 3_600_000 });
    const seen: Record<string, string[]> = {};
    engine.onDelivery((d) => { (seen[d.character_id] ??= []).push(d.text); });
    const { calls, errors } = toolMaster(engine, () => [
      // Como en la partida: todo en un texto con «te» a secas. Se rechaza una vez.
      { narration_private: 'Kael, te unes a la charla y Brenna te responde. Mira, cuentas las monedas.' },
      {
        narration_private: 'Brenna se seca las manos en el delantal y os mira a los dos.',
        narration_by_pc: { [kael.id]: 'Le preguntas por el pozo y ella señala la plaza con la barbilla.', [mira.id]: 'Cuentas las monedas sobre la barra: te llega para dos jarras.' },
        npc_id: 'npc_brenna',
        lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'El pozo está en la plaza.', to: kael.id }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Aquí se paga antes.' }],
      },
    ]);
    const [a, b] = await Promise.all([engine.act(kael.id, 'preguntar a Brenna por el pozo'), engine.act(mira.id, 'contar mis monedas')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe('(a la vez) Kael: preguntar a Brenna por el pozo / Mira: contar mis monedas');
    expect(calls[0]!.context).toContain('## A la vez: 2 jugadores han actuado en el mismo momento');
    expect(calls[0]!.context).toContain('narration_by_pc');
    expect(calls[0]!.context).not.toContain('CHOQUE');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/falta en narration_by_pc lo de Kael .* y lo de Mira/);
    expect(errors[0]).toContain('dice «te»');
    // Un solo evento para los dos; cada uno lee lo suyo y lo común, nada del otro en segunda persona.
    expect(a.event!.id).toBe(b.event!.id);
    expect(seen[kael.id]!.at(-1)).toBe('Le preguntas por el pozo y ella señala la plaza con la barbilla.\n\nBrenna se seca las manos en el delantal y os mira a los dos. «El pozo está en la plaza.» «Aquí se paga antes.»');
    expect(seen[mira.id]!.at(-1)).toMatch(/^Cuentas las monedas sobre la barra: te llega para dos jarras\.\n\nBrenna se seca/);
    expect(seen[mira.id]!.at(-1)).not.toContain('Le preguntas por el pozo');
    // La línea sin destinatario va a los del turno (no a toda la sala); la otra, a Kael.
    expect(a.event!.payload['lines']).toEqual([
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'El pozo está en la plaza.', to: kael.id },
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'Aquí se paga antes.', to: [kael.id, mira.id] },
    ]);
    expect(a.event!.payload['audience']).toBe('group');
  });

  it('tres en la sala: la línea sin destinatario de un turno compartido no llega al tercero ni le corta su charla; «present» le da solo lo común', async () => {
    const { engine, kael, mira } = await bar({ turnWindowMs: 40 });
    const r = await engine.createCharacter('u_tor', 'Tor', undefined, { place: (c) => { c.location = { type: 'spot', id: 'sp_tab_barra' }; } });
    if (!r.ok) throw new Error(r.reason);
    const tor = r.character;
    tor.connected = true;
    engine.setPresence(tor.id, true);
    const doro = engine.world.npc('npc_doro');
    doro.location = { type: 'spot', id: 'sp_tab_barra' };
    doro.talking_to = { character_id: tor.id, since_game_s: engine.gameNow() };
    const seen: Record<string, string[]> = {};
    engine.onDelivery((d) => { (seen[d.character_id] ??= []).push(d.text); });
    let present = false;
    // Dos cierres distintos (el mismo texto dos veces lo rechazaría el control de repeticiones).
    const { errors } = toolMaster(engine, () => [present ? {
      narration_private: 'Brenna golpea la barra con el trapo y mira a los dos.',
      narration_by_pc: { [kael.id]: 'Le insistes por el pozo.', [mira.id]: 'Apilas las monedas.' },
      npc_id: 'npc_brenna', audience: 'present',
      lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Aquí se paga antes de preguntar.' }],
    } : {
      narration_private: 'Brenna os mira a los dos.',
      narration_by_pc: { [kael.id]: 'Le preguntas por el pozo.', [mira.id]: 'Cuentas las monedas.' },
      npc_id: 'npc_brenna',
      lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'El pozo está en la plaza.' }],
    }]);
    // Tor no manda nada: la ventana se cierra por tiempo con los otros dos.
    const [a] = await Promise.all([engine.act(kael.id, 'preguntar a Brenna por el pozo'), engine.act(mira.id, 'contar mis monedas')]);
    expect(a.event!.payload['group']).toEqual([kael.id, mira.id]);
    expect(a.event!.payload['audience']).toBe('group');
    expect(a.event!.payload['audience_ids']).not.toContain(tor.id);
    // Tor lee el aviso de una línea (con los nombres que sabe), sin las frases ni lo de los otros; Doro sigue con él.
    expect(seen[tor.id]!.at(-1)).toMatch(/habla con/);
    expect(seen[tor.id]!.join('\n')).not.toContain('pozo');
    expect(doro.talking_to?.character_id).toBe(tor.id);
    // Algo para todos (present): Tor lee lo común, nunca la parte en segunda persona de Kael.
    present = true;
    engine.world.npc('npc_brenna').talking_to = null; // que la segunda vez vaya otra vez por la ventana, no por la charla de grupo
    const [b] = await Promise.all([engine.act(kael.id, 'insistirle a Brenna por el pozo'), engine.act(mira.id, 'apilar mis monedas')]);
    expect(errors).toEqual([]);
    expect(b.event!.payload['audience']).toBe('present');
    expect(seen[tor.id]!.at(-1)).toContain('golpea la barra con el trapo y mira a los dos. «Aquí se paga antes de preguntar.»');
    expect(seen[tor.id]!.at(-1)).not.toContain('Le insistes');
  });

  it('dos acciones separadas por más de la ventana van una tras otra, cada una con su llamada', async () => {
    const { engine, kael, mira } = await bar({ turnWindowMs: 40 });
    const { calls } = toolMaster(engine, () => [{ narration_private: 'Brenna asiente.' }]);
    const a = await engine.act(kael.id, 'preguntar a Brenna por el pozo');
    const b = await engine.act(mira.id, 'contar mis monedas');
    expect(calls.map((c) => c.text)).toEqual(['preguntar a Brenna por el pozo', 'contar mis monedas']);
    expect(a.event!.id).not.toBe(b.event!.id);
    expect(a.event!.payload['group']).toBeUndefined();
  });

  it('sin otro PJ que pueda actuar en el sitio no hay ventana (ni espera)', async () => {
    const { engine, kael, mira } = await bar({ turnWindowMs: 3_600_000 });
    engine.setAway(mira.id, true);
    const { calls } = toolMaster(engine, () => [{ narration_private: 'Brenna asiente.' }]);
    await engine.act(kael.id, 'preguntar a Brenna por el pozo');
    expect(calls.map((c) => c.text)).toEqual(['preguntar a Brenna por el pozo']);
  });

  it('choque: los dos cogen la misma jarra a la vez; el máster lo sabe y lo resuelve', async () => {
    const { engine, kael, mira } = await bar({ turnWindowMs: 3_600_000 });
    const s = spawnItem(engine.world, 'it_cerveza', 1, { type: 'spot', id: 'sp_tab_barra' });
    const jarra = s.ok ? s.moved.id : '';
    const { calls } = toolMaster(engine, () => [{
      narration_private: 'La jarra se tambalea sobre la barra.',
      narration_by_pc: { [kael.id]: 'Llegas antes y te quedas la jarra.', [mira.id]: 'Kael llega antes: tu mano se cierra en el aire.' },
    }]);
    await Promise.all([engine.act(kael.id, 'coger la jarra'), engine.act(mira.id, 'coger la jarra')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.context).toContain(`CHOQUE: Kael y Mira van a por lo mismo a la vez (jarra de cerveza [${jarra}])`);
    expect(calls[0]!.context).toContain('con tiradas si hace falta');
  });

  it('choques puros: mismo NPC, mismo objeto y uno que actúa sobre otro que también actúa', async () => {
    const { engine, kael, mira } = await bar();
    const ev = engine.events.all();
    const g = engine.gameNow();
    expect(windowClashes(engine.world, ev, [{ id: kael.id, text: 'robarle la bolsa a Brenna' }, { id: mira.id, text: 'distraer a Brenna con un chiste' }], g))
      .toEqual([{ what: 'Brenna [npc_brenna]', ids: [kael.id, mira.id] }]);
    expect(windowClashes(engine.world, ev, [{ id: kael.id, text: 'empujar a Mira' }, { id: mira.id, text: 'beber de mi jarra' }], g))
      .toEqual([{ what: 'Mira [ch_mira]', ids: [kael.id, mira.id] }]);
    expect(windowClashes(engine.world, ev, [{ id: kael.id, text: 'mirar el fuego' }, { id: mira.id, text: 'contar mis monedas' }], g)).toEqual([]);
  });

  it('el máster no inventa frases de jugadores: la línea de un PJ que no está en lo que escribió se quita (también fuera de un turno compartido)', async () => {
    const { engine, kael, mira } = await bar({ turnWindowMs: 3_600_000 });
    toolMaster(engine, () => [{
      narration_private: 'Brenna resopla.',
      narration_by_pc: { [kael.id]: 'Le pides perdón a Brenna.', [mira.id]: 'Sueltas la muñeca de Kael.' },
      npc_id: 'npc_brenna',
      lines: [{ speaker: 'pc', character_id: kael.id, text: 'Perdón, Brenna.' }, { speaker: 'pc', character_id: mira.id, text: 'Error. Ya.' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Error. Ya.', to: 'all' }],
    }]);
    const [a] = await Promise.all([engine.act(kael.id, 'pedirle perdón a Brenna'), engine.act(mira.id, 'soltar la muñeca de Kael')]);
    const lines = a.event!.payload['lines'] as { speaker: string; character_id?: string; text: string }[];
    expect(lines.filter((l) => l.speaker !== 'npc').map((l) => l.text)).toEqual(['Perdón, Brenna.']);
    expect(lines.some((l) => l.speaker === 'pc' && l.character_id === mira.id)).toBe(false);
    // Fuera de un turno compartido, igual: lo que «dice» el actor tiene que estar en lo que escribió.
    const solo: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [], action_text: 'coger de la mano a Mira y huir' };
    JSON.parse(executeTool(solo, 'log_event', { narration_private: 'Tiras de Mira hacia la puerta. «Error. Ya.»', observable: null, observable_vague: null, loudness: 1, tags: '', suggested_actions: '', lines: [{ speaker: 'actor', npc_id: null, text: 'Error. Ya.' }] }));
    expect(solo.closed!.lines).toEqual([]);
    expect(solo.closed!.narration_private).toBe('Tiras de Mira hacia la puerta.');
  });

  it('reacción pendiente: la pregunta ajena del afectado no entra ni se mezcla; quien la pidió espera; «me resisto» es la respuesta', async () => {
    const { engine, kael, mira } = await bar({ turnWindowMs: 3_600_000 });
    const { calls } = toolMaster(engine, () => [{ narration_private: 'Brenna asiente.' }]);
    const grab = await engine.act(kael.id, 'agarro a Mira');
    expect(grab.event!.action_type).toBe('reaction_request');
    // Mira pregunta otra cosa: no va al máster, se le pide que decida antes.
    const q = await engine.act(mira.id, '¿Cuánto debe la fragua, Brenna?');
    expect(q.ok).toBe(false);
    expect(q.text).toMatch(/^⏳ Kael intenta agarrarte: antes decide si te dejas o te resistes/);
    // Kael tampoco hace otra cosa mientras.
    expect((await engine.act(kael.id, 'preguntar a Brenna por el pozo')).text).toMatch(/Esperando a que Mira decida/);
    expect(calls).toHaveLength(0);
    expect(mira.reactions).toHaveLength(1);
    // Con sus palabras, la respuesta: se resiste (tirada enfrentada) y la petición se cierra.
    const ans = await engine.act(mira.id, 'me resisto, suéltame');
    expect(ans.event!.action_type).toMatch(/^reaction_/);
    expect(mira.reactions).toBeUndefined();
  });
});

describe('la ronda solo en pelea de verdad', () => {
  it('la marca tense sola ya no abre ronda: lo simultáneo va por la ventana de turno', async () => {
    const { engine, kael, mira } = await bar({ turnWindowMs: 3_600_000, roundMs: 3_600_000 });
    engine.world.location('loc_taberna').state['tense'] = true;
    const { calls } = toolMaster(engine, () => [{ narration_private: 'La sala contiene el aliento.', narration_by_pc: { [kael.id]: 'Vigilas la puerta.', [mira.id]: 'Apagas la vela.' } }]);
    await Promise.all([engine.act(kael.id, 'vigilar la puerta'), engine.act(mira.id, 'apagar la vela')]);
    expect(engine.roundIn('loc_taberna')).toBeNull();
    expect(calls.map((c) => c.text)).toEqual(['(a la vez) Kael: vigilar la puerta / Mira: apagar la vela']);
    // Con un hostil delante, sí hay ronda.
    fightAt(engine);
    const next = engine.act(kael.id, 'cubrir la puerta');
    await engine.act(mira.id, 'tirar la mesa');
    await next;
    expect(calls.at(-1)!.text).toBe('(ronda 1) Kael: cubrir la puerta / Mira: tirar la mesa');
  });
});
