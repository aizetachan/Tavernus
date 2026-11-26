/**
 * Reacciones entre jugadores tras las tandas del 25-11-2026 (docs/PLAN-ARREGLOS-2026-11-26.md, paquete B, arreglos 2,
 * 9 y 18): el desenlace de la tirada enfrentada llega al cierre como hecho, lo que escribe el afectado es un gesto y no
 * una frase dicha, y el robo a escondidas que la víctima ya notó no se vuelve a tirar. Sin modelo: un máster de prueba
 * que apunta lo que recibe.
 */

import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike, ReactionOutcome } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { pcActionTarget, reactionReply } from '../src/engine/reactions.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine as EngineClass } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { setNpcOrder } from '../src/engine/npcorders.js';
import { conversationCheck } from '../src/engine/conversation.js';
import { bootEngine, fakeTime } from './helpers.js';

function collect(engine: Engine) {
  const by = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { by.set(d.character_id, [...(by.get(d.character_id) ?? []), d]); });
  return (id: string) => by.get(id) ?? [];
}

/** Kael y Mira juntos en la barra, conectados. `rng`: d20 de quien actúa y luego del afectado. */
async function together(rng?: () => number) {
  const { engine } = await bootEngine(fakeTime(), rng ? { rng } : {});
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  for (const c of [kael, mira]) { c.location = { type: 'spot', id: 'sp_tab_barra' }; engine.setConnected(c.id, true); }
  return { engine, kael, mira, seen: collect(engine) };
}

/** Valores del rng en orden; luego, la mitad. */
const dice = (...values: number[]) => { let i = 0; return () => (i < values.length ? values[i++]! : 0.5); };

/** Un máster que no narra nada y apunta la tirada que recibe y el desenlace que ve el motor mientras narra. */
function spyMaster(engine: Engine) {
  const seen: { text: string; breakdown: string; success: boolean | null; outcome: ReactionOutcome | null }[] = [];
  const m: MasterLike = {
    resolve: async (actor, text, roll) => {
      seen.push({ text, breakdown: roll?.result.breakdown ?? '', success: roll?.result.success ?? null, outcome: engine.reactionOutcomeOf(actor.id) as ReactionOutcome | null });
      return { ok: false, reason: 'test', message: '' };
    },
  };
  engine.attachMaster(m);
  engine.onMaster(() => {}); // sin el aviso de consola por cada fallo fingido
  return seen;
}

describe('(9) lo que escribe el afectado es un gesto', () => {
  it('sin el «me resisto» del principio; lo entrecomillado, aparte, como lo que dice', () => {
    expect(reactionReply('Me resisto. Aparto la bolsa de cuero con el codo y le clavo la mirada a Bruno. Ni se te ocurra, que esa plata es para el viaje'))
      .toEqual({ gesture: 'Aparto la bolsa de cuero con el codo y le clavo la mirada a Bruno. Ni se te ocurra, que esa plata es para el viaje', speech: [] });
    expect(reactionReply('Me resisto, clavo los pies en el suelo')).toEqual({ gesture: 'Clavo los pies en el suelo', speech: [] });
    expect(reactionReply('No me dejo: me agarro al brocal y grito «¡Suéltame!»')).toEqual({ gesture: 'Me agarro al brocal y grito', speech: ['¡Suéltame!'] });
    expect(reactionReply('vale')).toEqual({ gesture: null, speech: [] });
    expect(reactionReply('Sí, me dejo')).toEqual({ gesture: null, speech: [] });
    expect(reactionReply(null)).toEqual({ gesture: null, speech: [] });
  });

  it('a quien actúa no le llega como frase dicha; al máster, como gesto en tercera persona y ajustado al resultado', async () => {
    const { engine, kael, mira, seen } = await together();
    const spy = spyMaster(engine);
    await engine.act(kael.id, 'empujo a Mira');
    await engine.answerReaction(mira.id, mira.reactions![0]!.id, null, 'Me resisto, clavo los pies y me agarro al brocal');
    const forKael = seen(kael.id).find((d) => d.event.action_type === 'reaction_resisted')!;
    expect(forKael.text).toMatch(/^Mira se resiste\. Tirada enfrentada/);
    expect(forKael.text).not.toMatch(/«/);
    expect(forKael.text).not.toMatch(/brocal/);
    expect(spy.at(-1)!.breakdown).toMatch(/Cómo se resiste Mira, según su jugador \(en primera persona; es lo que HACE, un gesto, no algo que diga en voz alta/);
    expect(spy.at(-1)!.breakdown).toContain('Clavo los pies y me agarro al brocal.');
    // Lo que sí dice, entre comillas, lo oye.
    await engine.act(kael.id, 'empujo a Mira');
    await engine.answerReaction(mira.id, mira.reactions![0]!.id, null, 'Me agarro al brocal: «¡Ni se te ocurra!»');
    const again = seen(kael.id).filter((d) => d.event.action_type === 'reaction_resisted').at(-1)!;
    expect(again.text).toMatch(/^Mira se resiste: «¡Ni se te ocurra!»\./);
  });
});

describe('(2) el resultado de la enfrentada llega al cierre como hecho', () => {
  it('quien gana, dicho sin margen: el máster lo recibe antes de narrar y el motor lo expone para la guarda del cierre', async () => {
    // El primer valor es el id de la petición; luego, el d20 de quien actúa y el del afectado.
    for (const [d, win] of [[dice(0.5, 0.99, 0.01), true], [dice(0.5, 0.01, 0.99), false]] as const) {
      const { engine, kael, mira } = await together(d);
      const spy = spyMaster(engine);
      await engine.act(kael.id, 'empujo a Mira');
      await engine.answerReaction(mira.id, mira.reactions![0]!.id, 'resist');
      const got = spy.at(-1)!;
      expect(got.success).toBe(win);
      expect(got.breakdown).toMatch(win ? /RESULTADO \(hecho del servidor, no lo contradigas\): gana Kael\. Lo consigue/ : /RESULTADO \(hecho del servidor, no lo contradigas\): gana Mira\. Kael NO lo consigue/);
      expect(got.outcome).toMatchObject({ target_id: mira.id, success: win, kind: 'shove', how: 'resist', rolls: expect.stringMatching(/^Tirada enfrentada: tu Atletismo d20/) });
      // Fuera de esa narración, ya no hay desenlace en curso.
      expect(engine.reactionOutcomeOf(kael.id)).toBeNull();
    }
  });
});

describe('(18) robo a otro jugador: la enfrentada oculta decide', () => {
  const steal = (engine: Engine, kaelId: string, miraId: string) => {
    const c = engine.world.character(kaelId);
    const ctx = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: 'Me acerco a Mira como si fuera a confiarle un secreto y le deslizo la mano hacia su bolsa' } as ToolContext;
    return JSON.parse(executeTool(ctx, 'request_reaction', { target_character_id: miraId, kind: 'other', attempt: 'birlarte una moneda de la bolsa', destination_spot_id: null, actor_skill: 'sleight_of_hand', target_skills: 'perception' })) as Record<string, unknown>;
  };

  it('pareja 1115, acción 36: Mira lo nota y se resiste: no hay segunda tirada y el pícaro no lo consigue; el cierre lo sabe', async () => {
    // El d20 oculto del pícaro, bajo; el de Mira, alto: lo nota. Lo que venga luego (0.99) ganaría una segunda tirada.
    const { engine, kael, mira, seen } = await together(dice(0.01, 0.99, 0.99, 0.01));
    const spy = spyMaster(engine);
    expect(steal(engine, kael.id, mira.id)).toMatchObject({ ok: true, success: false, noticed: true, pending_reaction: true });
    (engine as unknown as { announcePending(id: string): void }).announcePending(kael.id);
    const rx = mira.reactions![0]!;
    expect(rx.noticed).toBe(true);
    const r = await engine.answerReaction(mira.id, rx.id, null, 'Me resisto. Aparto la bolsa de cuero con el codo y le clavo la mirada a Kael. Ni se te ocurra, que esa plata es para el viaje');
    expect(r.event!.payload['reaction']).toMatchObject({ success: false });
    const forKael = seen(kael.id).find((d) => d.event.action_type === 'reaction_resisted')!;
    expect(forKael.text).not.toMatch(/Tirada enfrentada/);
    expect(forKael.text).toMatch(/ya te había pillado/);
    expect(forKael.text).toMatch(/No lo consigues\./);
    const got = spy.at(-1)!;
    expect(got.success).toBe(false);
    expect(got.breakdown).toMatch(/gana Mira\. Kael NO lo consigue/);
    expect(got.outcome).toMatchObject({ success: false, kind: 'other', gesture: expect.stringMatching(/^Aparto la bolsa/) });
  });

  it('si no lo nota, le sale sin preguntarle y el resultado vuelve al máster en el mismo turno', async () => {
    const { engine, kael, mira } = await together(dice(0.99, 0.01));
    const out = steal(engine, kael.id, mira.id);
    expect(out).toMatchObject({ ok: true, success: true, unnoticed: true });
    expect(String(out['hint'])).toMatch(/Juego de manos .* contra su Percepción/);
    expect(mira.reactions ?? []).toHaveLength(0);
  });

  it('si lo nota y se deja, lo consigue sin tirada', async () => {
    const { engine, kael, mira } = await together(dice(0.01, 0.99));
    const spy = spyMaster(engine);
    steal(engine, kael.id, mira.id);
    const r = await engine.answerReaction(mira.id, mira.reactions![0]!.id, 'accept');
    expect(r.event!.payload['reaction']).toMatchObject({ success: true });
    expect(spy.at(-1)!.breakdown).toMatch(/RESULTADO \(hecho del servidor\): Kael lo consigue, sin tirada/);
  });
});

describe('(7) robarle a otro jugador va al máster, no a la charla sin máster', () => {
  /** Brezal en la mesa del fondo del Jabalí: Bruno (pícaro), Ciro (el otro jugador) y Ciro el jornalero, el vecino del mismo nombre. */
  async function jabali() {
    const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
    const time = fakeTime(EPOCH);
    const engine = await EngineClass.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: true, fastTravel: false, rng: () => 0.5 });
    const mk = async (user: string, name: string, klass: string) => { const r = await engine.createCharacter(user, name, { class_id: klass }); if (!r.ok) throw new Error(r.reason); return r.character; };
    const bruno = await mk('u_bruno', 'Bruno', 'rogue');
    const ciro = await mk('u_ciro', 'Ciro', 'fighter');
    for (const c of [bruno, ciro]) { c.location = { type: 'spot', id: 'sp_tab_mesa' }; engine.setConnected(c.id, true); }
    const vecino = engine.world.npc('npc_x_ciro');
    vecino.location = { type: 'spot', id: 'sp_tab_mesa' };
    setNpcOrder(engine.world, { npc_id: vecino.id, order: 'go', spot_id: 'sp_tab_mesa', minutes: 600 }, engine.gameNow());
    return { engine, bruno, ciro, vecino };
  }

  it('pareja 1115, acción 9: «me deslizo tras Ciro y le birlo la bolsa» lo recibe el máster (con el otro jugador como objetivo), no el vecino', async () => {
    const { engine, bruno, ciro } = await jabali();
    const text = 'Me deslizo tras Ciro y le birlo la bolsa de cuero mientras aparenta mirar a Brenna. Si se da cuenta, finjo que quería ayudarle a contar.';
    expect(pcActionTarget(engine.world, bruno, text)?.id).toBe(ciro.id);
    const spy = spyMaster(engine);
    const from = engine.events.all().at(-1)?.seq ?? 0;
    await engine.act(bruno.id, text);
    expect(spy.map((x) => x.text)).toContain(text);
    // Ningún vecino contesta sin máster.
    expect(engine.events.all().filter((e) => e.seq > from && e.tags.includes('extra'))).toHaveLength(0);
  });

  it('lo que no es contra él, sigue su camino: hablar con Ciro o con el vecino no es una acción contra un jugador', async () => {
    const { engine, bruno } = await jabali();
    expect(pcActionTarget(engine.world, bruno, 'Le pregunto a Ciro qué tal la cena')).toBeNull();
    expect(pcActionTarget(engine.world, bruno, 'le robo la bolsa a Brenna')).toBeNull();
    expect(pcActionTarget(engine.world, bruno, 'empujo a Ciro contra la mesa')?.name).toBe('Ciro');
  });

  it('el cierre que pide la reacción no es un turno de charla: el tope de palabras de la conversación no lo rechaza', () => {
    const conv = { npc_id: 'npc_x_ciro', turns: 3, npc_spoke: true, gestures: [] };
    const long = 'Te inclinas hacia Ciro como si fueras a confiarle algo, con la sonrisa de quien cuenta un chisme, y deslizas la mano hacia la bolsa de cuero que le cuelga del cinto, despacio, entre el ruido de las jarras y las risas de la mesa de al lado, sin que nadie parezca mirar.';
    const lines = [{ speaker: 'npc' as const, npc_id: 'npc_x_ciro', text: 'Déjalo.' }];
    expect(conversationCheck({ conversation: conv, narration: long, lines, npcId: 'npc_x_ciro', okTools: [] })?.kind).toBe('long');
    expect(conversationCheck({ conversation: conv, narration: long, lines, npcId: 'npc_x_ciro', okTools: ['request_reaction'] })).toBeNull();
  });
});
