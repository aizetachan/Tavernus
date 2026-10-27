import { describe, expect, it } from 'vitest';
import { actionContext, systemPrompt } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { moveTo } from '../src/engine/movement.js';
import { OFFER_TTL_MS, parseParty, parseSay, secondPerson } from '../src/engine/party.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Lo que recibe cada PJ, con el evento. */
function collect(engine: Engine) {
  const by = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { by.set(d.character_id, [...(by.get(d.character_id) ?? []), d]); });
  return (id: string) => by.get(id) ?? [];
}

/** Kael y Mira juntos en la barra de la taberna, sin conocerse. */
async function together(opts: { know?: boolean } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time);
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  if (!opts.know) { kael.knows = kael.knows.filter((id) => id !== mira.id); mira.knows = mira.knows.filter((id) => id !== kael.id); }
  return { engine, time, kael, mira, seen: collect(engine) };
}

/** Un máster que falla el test si lo llaman: lo de entre jugadores no gasta. */
const noMaster = { resolve: () => { throw new Error('no debería llamar al máster'); } };

describe('decir sin máster', () => {
  it('reconoce la raya, las comillas y el destinatario; sin ellas no es decir', () => {
    expect(parseSay('— Hola, forastero')).toEqual({ text: 'Hola, forastero', mode: 'say', to: null });
    expect(parseSay('«¿Vienes de la niebla?»')).toEqual({ text: '¿Vienes de la niebla?', mode: 'say', to: null });
    expect(parseSay('— a Aren: ¿vienes?')).toEqual({ text: '¿vienes?', mode: 'say', to: 'Aren' });
    expect(parseSay('— (susurra) cuidado')).toMatchObject({ mode: 'whisper', text: 'cuidado' });
    expect(parseSay('mirar alrededor')).toBeNull();
    expect(parseSay('mirar alrededor', true)).toMatchObject({ text: 'mirar alrededor' });
  });

  it('la frase llega literal a quien la oye bien, con cero llamadas al máster', async () => {
    const { engine, kael, mira, seen } = await together();
    engine.attachMaster(noMaster);
    const r = await engine.act(kael.id, '— ¿Vienes de la niebla?');
    expect(r.ok).toBe(true);
    const e = r.event!;
    expect(e.action_type).toBe('say');
    expect(e.payload['master']).toBeNull();
    expect(e.payload['lines']).toEqual([{ speaker: 'actor', text: '¿Vienes de la niebla?' }]);
    // Los PJ se conocen por su nombre: a Mira le llega «Kael», con la frase tal cual.
    expect(seen(mira.id).at(-1)!.text).toBe('Kael dice: «¿Vienes de la niebla?»');
    expect(e.delivered_to.find((d) => d.character_id === mira.id)).toMatchObject({ level: 'full', sound: 'full' });
  });

  it('de lejos solo un murmullo; dirigida, el destinatario la lee en segunda persona', async () => {
    const { engine, kael, mira, seen } = await together({ know: true });
    const tam = (await engine.createCharacter('u_tam', 'Tamsin')).ok ? [...engine.world.characters.values()].find((c) => c.name === 'Tamsin')! : null;
    tam!.location = { type: 'spot', id: 'sp_pl_porton' }; // en la plaza, lejos
    engine.world.character(kael.id).location = { type: 'spot', id: 'sp_pl_pozo' };
    mira.location = { type: 'spot', id: 'sp_pl_pozo' };
    const r = await engine.say(kael.id, '— a Mira: Nos vamos ya.');
    expect(r.event!.payload['say']).toEqual({ text: 'Nos vamos ya.', mode: 'say', to: mira.id });
    expect(seen(mira.id).at(-1)!.text).toBe('Kael te dice: «Nos vamos ya.»');
    const far = seen(tam!.id).at(-1);
    if (far) expect(far.text).not.toContain('Nos vamos');
  });

  it('decir el propio nombre lo enseña a quien lo oye bien', async () => {
    const { engine, kael, mira } = await together();
    expect(mira.knows).not.toContain(kael.id);
    await engine.say(kael.id, 'Me llamo Kael, del camino del sur.');
    expect(mira.knows).toContain(kael.id);
  });

  it('«hablar con <PJ>» sin frase no se narra ni gasta: abre el modo Decir', async () => {
    const { engine, kael, mira, seen } = await together({ know: true });
    engine.attachMaster(noMaster);
    const before = engine.events.all().length;
    const r = await engine.act(kael.id, 'hablar con Mira');
    expect(r).toMatchObject({ ok: true, say_to: { id: mira.id, name: 'Mira' } });
    expect(engine.events.all().length).toBe(before);
    expect(seen(mira.id)).toHaveLength(0);
    expect(parseParty('hablar con Aren')).toEqual({ kind: 'talk', who: 'Aren' });
  });
});

describe('el máster no actúa por otro jugador', () => {
  it('regla en el prompt y marca JUGADOR en cada PJ presente', async () => {
    const { engine, kael } = await together();
    expect(systemPrompt(engine.world.campaign)).toContain('Tampoco por los demás JUGADORES presentes');
    expect(actionContext(engine, kael, 'mirar')).toContain('JUGADOR: no narres sus actos, palabras, gestos ni intenciones; solo lo que ya consta en los eventos.');
  });

  it('el cierre que pone a otro PJ a esperar o mirar se rechaza una vez', async () => {
    const { engine, kael } = await together({ know: true });
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    const close = (priv: string) => JSON.parse(executeTool(ctx, 'log_event', { narration_private: priv, observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '', lines: null })) as { error?: string };
    expect(close('Te acercas a la barra. Mira aguarda con la vista fija en ti.').error).toMatch(/^Has narrado lo que hace otro jugador: Mira/);
    expect(close('Te acercas a la barra. Mira aguarda con la vista fija en ti.').error).toBeUndefined();
  });

  it('«Hablar con Aren» no es una línea dicha', async () => {
    const { engine, kael } = await together();
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    executeTool(ctx, 'log_event', { narration_private: 'Te vuelves hacia la barra.', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '', lines: [{ speaker: 'actor', npc_id: null, text: 'Hablar con Mira' }] });
    expect(ctx.closed!.lines).toEqual([]);
  });
});

describe('observables por lector', () => {
  it('el que es nombrado lo lee en segunda persona', () => {
    expect(secondPerson('Leodhin se acerca a Aren junto al yunque.', 'Aren')).toBe('Leodhin se acerca a ti junto al yunque.');
    expect(secondPerson('Leodhin mira a Aren y habla con Aren.', 'Aren')).toBe('Leodhin te mira y habla contigo.');
    expect(secondPerson('Leodhin toca la mano de Aren.', 'Aren')).toBe('Leodhin toca tu mano.');
    expect(secondPerson('Leodhin dice: «Aren, ven».', 'Aren')).toBe('Leodhin dice: «Aren, ven».');
  });

  it('target_character_id y observable_target: el destinatario recibe lo suyo', async () => {
    const { engine, kael, mira, seen } = await together({ know: true });
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    executeTool(ctx, 'log_event', { narration_private: 'Le tiendes la mano a Mira.', observable: 'Kael le tiende la mano a Mira.', observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '', lines: null, target_character_id: mira.id, observable_target: 'Kael te tiende la mano.' });
    expect(ctx.closed).toMatchObject({ target_character_id: mira.id, observable_target: 'Kael te tiende la mano.' });
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: ctx.closed!.narration_private, observable: ctx.closed!.observable, payload: { target_character_id: mira.id, observable_target: 'Kael te tiende la mano.' } });
    expect(seen(mira.id).at(-1)!.text).toBe('Kael te tiende la mano.');
  });
});

describe('ofertas con consentimiento', () => {
  it('dar es ofrecer: el otro acepta y se transfiere todo junto', async () => {
    const { engine, kael, mira, seen } = await together({ know: true });
    engine.attachMaster(noMaster);
    await engine.act(kael.id, 'dar 20 monedas a Mira');
    const offer = mira.offers![0]!;
    expect(offer).toMatchObject({ from_id: kael.id, coins: 20, label: '2 de plata', instance_id: null });
    expect(seen(mira.id).at(-1)!.text).toBe('Kael te ofrece 2 de plata.');
    const [k0, m0] = [kael.coins, mira.coins];
    await engine.answerOffer(mira.id, offer.id, true);
    expect([kael.coins, mira.coins]).toEqual([k0 - 20, m0 + 20]);
    expect(mira.offers).toBeUndefined();
    expect((await engine.answerOffer(mira.id, offer.id, true)).text).toBe('Esa oferta ya no está en pie.');
  });

  it('rechazar no mueve nada; sin respuesta caduca y se avisa a los dos', async () => {
    const { engine, time, kael, mira, seen } = await together({ know: true });
    await engine.act(kael.id, 'dar daga a Mira');
    const a = mira.offers![0]!;
    await engine.answerOffer(mira.id, a.id, false);
    expect(engine.world.itemsCarriedBy(kael.id).some((i) => i.item_id === 'it_daga')).toBe(true);
    expect(seen(kael.id).at(-1)!.text).toBe('Mira no acepta lo que le ofreces (daga).');
    await engine.act(kael.id, 'dar daga a Mira');
    time.advanceReal(OFFER_TTL_MS / 1000 + 1);
    await engine.tick();
    expect(mira.offers).toBeUndefined();
    expect(seen(kael.id).at(-1)!.text).toBe('Mira no ha respondido a tu oferta (daga): sigue siendo tuyo.');
  });

  it('transfer_item del máster a otro PJ pasa por la oferta', async () => {
    const { engine, kael, mira } = await together({ know: true });
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    const r = JSON.parse(executeTool(ctx, 'transfer_item', { instance_id: 'ii_kael_daga', to_type: 'character', to_id: mira.id, slot: 'hand_main', equip_slot: null, quantity: null })) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true, pending_offer: true });
    expect(engine.world.itemInstance('ii_kael_daga').location).toMatchObject({ type: 'character', id: kael.id });
    expect(mira.offers![0]!.instance_id).toBe('ii_kael_daga');
  });
});

describe('seguir y ayudar', () => {
  it('quien sigue se mueve con el líder hasta «dejar de seguir»', async () => {
    const { engine, time, kael, mira } = await together({ know: true });
    await engine.act(mira.id, 'seguir a Kael');
    expect(mira.following).toBe(kael.id);
    await engine.act(kael.id, 'ir a la puerta');
    expect(mira.transit?.destination_spot_id).toBe('sp_tab_puerta');
    time.advanceGame(120);
    await engine.tick();
    expect(engine.world.characterSpot(mira)!.id).toBe('sp_tab_puerta');
    await engine.act(mira.id, 'dejar de seguir');
    expect(mira.following).toBeNull();
    await engine.act(kael.id, 'ir a la barra');
    expect(mira.transit).toBeNull();
  });

  it('cruza de localización con el líder (viaje rápido)', async () => {
    const { engine, kael, mira } = await together({ know: true });
    kael.location = { type: 'spot', id: 'sp_tab_puerta' };
    mira.location = { type: 'spot', id: 'sp_tab_puerta' };
    await engine.act(mira.id, 'seguir a Kael');
    moveTo(engine.world, kael.id, 'sp_pl_pozo', 'walk', engine.nowFor(kael));
    await engine.tick();
    expect(engine.world.characterSpot(kael)!.location_id).toBe('loc_plaza');
    expect(engine.world.characterSpot(mira)!.location_id).toBe('loc_plaza');
  });

  it('ayudar da ventaja en la siguiente tirada del ayudado, una vez', async () => {
    const { engine, kael, mira } = await together({ know: true });
    await engine.act(mira.id, 'ayudar a Kael');
    expect(kael.helped_by?.character_id).toBe(mira.id);
    expect(actionContext(engine, kael, 'forzar el arcón')).toContain('Cuenta con la ayuda de Mira');
    (engine as unknown as { pendingRolls: Map<string, unknown> }).pendingRolls.set(kael.id, { text: 'forzar', roll: { kind: 'ability', key: 'str', dc: 10, advantage: 'none' }, event_id: 'x' });
    engine.attachMaster({ resolve: async () => ({ ok: false, reason: 'test', message: 'sin máster' }) });
    await engine.rollPending(kael.id);
    const roll = engine.events.all().filter((e) => e.action_type === 'roll').at(-1)!;
    expect((roll.payload['roll'] as { advantage: string }).advantage).toBe('advantage');
    expect(roll.narration_private).toContain('con la ayuda de Mira');
    expect(kael.helped_by).toBeNull();
  });
});

describe('carreras entre jugadores', () => {
  it('dos say a la vez: los dos llegan, en orden, sin pisarse', async () => {
    const { engine, kael, mira, seen } = await together({ know: true });
    const [a, b] = await Promise.all([engine.say(kael.id, '— ¿Quién va?'), engine.say(mira.id, '— Yo, Mira.')]);
    expect(a.event!.seq + 1).toBe(b.event!.seq);
    expect(seen(mira.id).map((d) => d.text)).toContain('Kael dice: «¿Quién va?»');
    expect(seen(kael.id).map((d) => d.text)).toContain('Mira dice: «Yo, Mira.»');
  });

  it('oferta aceptada mientras el que da se ha ido: falla entera y no mueve nada', async () => {
    const { engine, kael, mira } = await together({ know: true });
    kael.location = { type: 'spot', id: 'sp_tab_puerta' };
    mira.location = { type: 'spot', id: 'sp_tab_puerta' };
    await engine.act(kael.id, 'dar daga a Mira');
    const offer = mira.offers![0]!;
    // Kael sale a la plaza y, a la vez, Mira acepta.
    const [, r] = await Promise.all([
      (async () => { moveTo(engine.world, kael.id, 'sp_pl_pozo', 'walk', engine.nowFor(kael)); await engine.tick(); })(),
      engine.answerOffer(mira.id, offer.id, true),
    ]);
    const kaelHasIt = engine.world.itemsCarriedBy(kael.id).some((i) => i.item_id === 'it_daga');
    const miraHasIt = engine.world.itemsCarriedBy(mira.id).some((i) => i.item_id === 'it_daga');
    expect(kaelHasIt !== miraHasIt).toBe(true); // en un solo sitio, nunca en dos ni en ninguno
    if (!r.ok) expect(r.text).toMatch(/ya no está aquí/);
  });

  it('seguir cruzando una salida que se bloquea tras el líder: el seguidor se queda y deja de seguir', async () => {
    const { engine, kael, mira, seen } = await together({ know: true });
    kael.location = { type: 'spot', id: 'sp_tab_puerta' };
    mira.location = { type: 'spot', id: 'sp_tab_puerta' };
    await engine.act(mira.id, 'seguir a Kael');
    moveTo(engine.world, kael.id, 'sp_pl_pozo', 'walk', engine.nowFor(kael));
    engine.world.exits.get('ex_tab_plaza')!.state.blocked_by = 'un derrumbe';
    await engine.tick();
    expect(engine.world.characterSpot(mira)!.id).toBe('sp_tab_puerta');
    expect(mira.following).toBeNull();
    expect(seen(mira.id).at(-1)!.text).toMatch(/^No puedes seguir a Kael: .*Te quedas aquí\.$/);
  });

  it('seguir a quien tiene la llave de un cuarto cerrado: el seguidor no entra', async () => {
    const { engine, kael, mira, seen } = await together({ know: true });
    const room = engine.world.spot('sp_tab_mesa');
    Object.assign(room.state, { locked: true, key_item_id: 'it_daga' });
    await engine.act(mira.id, 'seguir a Kael');
    moveTo(engine.world, kael.id, 'sp_tab_mesa', 'walk', engine.nowFor(kael));
    await engine.tick();
    expect(mira.transit).toBeNull();
    expect(mira.following).toBeNull();
    expect(seen(mira.id).at(-1)!.text).toMatch(/^No puedes seguir a Kael/);
  });
});

describe('orden de la llegada', () => {
  it('la llegada de un move_to va después (en seq y en hora) de la acción que lo provocó', async () => {
    const { engine, time, kael } = await together();
    moveTo(engine.world, kael.id, 'sp_tab_puerta', 'walk', engine.nowFor(kael));
    time.advanceReal(20);
    const cause = engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Cruzas hacia la puerta.', observable: null }, time.now());
    await engine.tick();
    const arrived = engine.events.all().find((e) => e.action_type === 'arrived' && e.actor_id === kael.id)!;
    expect(arrived.seq).toBeGreaterThan(cause.seq);
    expect(arrived.timestamp_real_ms).toBeGreaterThanOrEqual(cause.timestamp_real_ms);
  });
});
