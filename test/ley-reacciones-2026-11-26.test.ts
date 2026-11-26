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
import { reactionReply } from '../src/engine/reactions.js';
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
      expect(got.outcome).toMatchObject({ target_id: mira.id, success: win, kind: 'shove', how: 'resist' });
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
