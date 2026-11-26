/**
 * Guardas del cierre, paquete A de docs/PLAN-ARREGLOS-2026-11-26.md: lo que el máster narra sin la tool que lo hace
 * real se rechaza una vez, con el hint de la tool que falta, y a la segunda pasa. Los textos son los de las tandas
 * de pruebas del 25-11 (data/local/autoplay/<tanda>/transcripts, data/local/bench).
 *
 *   - Arreglo 1: descansar, curar, coger del sitio, conjuros, el pasado del PJ, lo que un NPC recordará y el fiado.
 *   - Arreglo 14: el primer trago se paga.
 *   - Arreglo 17: settle_debt y set_debt cuadrados con lo narrado.
 */
import { describe, expect, it } from 'vitest';
import { menuNamed, moneyAmounts, stateWithoutTool, debtMismatch } from '../src/engine/closecheck.js';
import { DEFAULT_CURRENCY } from '../src/engine/money.js';
import { bootEngine } from './helpers.js';
import { ctxOnly, logEvent, rejectsOnceThenPasses, run } from './guardas-helpers.js';

// Tanda 20261125-1051 (13 perfiles con Haiku).
const TIRADOR_28 = { action: 'Me tumbo sobre el banco astillado, respiro hondo y cierro los ojos un momento para recuperar el aliento, con una mano apretando el hombro dolorido.', narration: 'Te tumbas sobre el banco viejo, que cruje pero aguanta, y cierras los ojos un momento. Las astillas te pinchan la espalda. El calor de la fragua te llega a la cara y el hombro te late bajo la mano. Por la rendija de los postigos la niebla sigue igual de gris.' };
const LANZADOR_27 = { action: 'Me siento en el brocal, apoyo la espalda en la pared y dejo que la mano herida descanse sobre el regazo. Cierro los ojos un momento, respirando despacio para que el olor a azufre no me revuelva el estómago.', narration: 'Te sientas en el brocal y apoyas la espalda contra la piedra fría. La mano herida descansa sobre el regazo, envuelta en la tela oscura. Cierras los ojos y respiras despacio, contando, hasta que el olor a azufre se queda en el fondo del pozo.' };
const TIRADOR_13 = { action: 'Aprieto la mano sobre la costilla, saco el vendaje de la mochila y me lo ajusto con los dientes, respirando despacio hasta que deja de temblar.', narration: 'No hay vendaje en la mochila. Sacas la ropa de viaje, rasgas dos tiras con los dientes y te ciñes el costado. El aire vuelve a entrar sin el pinchazo de antes, aunque la costilla sigue dolorida bajo la tela.' };
const TIRADOR_29 = { action: 'Saco el paño limpio de la mochila, vierto agua de la cantimplora sobre él y le presiono el hombro sangrante con firmeza.', narration: 'Mojas el paño en el agua de la cantimplora y lo escurres sobre el hombro. El corte de la palma y el rasguño del brazo escuecen, pero la sangre deja de correr cuando aprietas. Lo sujetas con una tira de la camisa.' };
const EXPLORADOR_16 = { action: 'Me guardo un eslabón en el bolsillo, cierro la losa con el pie y salgo hacia el patio del pozo, donde nadie mire.', narration: 'Te agachas sobre la losa, con la lana engrasada entre los dedos, y tomas uno de los eslabones. Es más grueso de lo que parecía y no cabe en el bolsillo: se te queda en la palma, frío como el agua de pozo.' };
const LANZADOR_33 = { action: 'Saco la daga del brocal de un tirón y, con la otra mano, lanzo «Rayo de escarcha» hacia la sombra, esperando que el hielo la obligue a mostrarse.', narration: '«Rayo de escarcha» Sacas la daga del brocal de un tirón y, con la otra mano, lanzas el rayo de escarcha hacia la sombra. El frío sale de tus dedos en un destello azul y golpea la pared junto a la sombra, no a la sombra misma.' };
// Bench de creatividad de Haiku (25-11), casos c21 y c22: ahí sí llamó a record_character_fact.
const C21 = { action: 'Le cuento a Brenna que mi padre era herrero en la capital y que de él aprendí a juzgar un buen acero.', narration: '«Mi padre era herrero en la capital. De él aprendí a juzgar un buen acero.» Brenna deja de secar la jarra un momento y te mira de arriba abajo, sin prisa. Tarda en contestar, como si pesara la historia antes que a ti.' };
const C22 = { action: 'Le digo a Brenna que busco a mi hermana Lía, que se fue de casa hace tres años con una compañía de cómicos.', narration: '«Busco a mi hermana Lía. Se fue de casa hace tres años con una compañía de cómicos.» Brenna deja de secar la jarra un momento y te mira de arriba abajo, sin prisa.' };

describe('arreglo 1: estado narrado sin su tool', () => {
  it('tirador 28 y lanzador 27: descanso sin take_rest; con take_rest, pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'state_rejections', { action_text: TIRADOR_28.action }), logEvent(TIRADOR_28.narration));
    expect(err).toContain('«te tumbas»');
    expect(err).toContain('take_rest');
    expect(stateWithoutTool({ action: LANZADOR_27.action, narration: LANZADOR_27.narration, okTools: [] })).toEqual({ kind: 'rest', phrase: 'cierras los ojos' });
    expect(run(ctxOnly(engine, 'state_rejections', { action_text: TIRADOR_28.action, ok_tools: ['take_rest'] }), 'log_event', logEvent(TIRADOR_28.narration)).closed).toBe(true);
    // Sin que el jugador pida descansar, sentarse o cerrar los ojos no es un descanso.
    expect(stateWithoutTool({ action: 'Me siento junto al pozo a mirar quién pasa.', narration: 'Te sientas en el brocal y cierras los ojos al sol.', okTools: [] })).toBeNull();
  });

  it('tirador 13 y 29: vendarse sin heal; con heal, pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'state_rejections', { action_text: TIRADOR_13.action }), logEvent(TIRADOR_13.narration));
    expect(err).toContain('«te cines el costado»');
    expect(err).toContain('heal');
    expect(stateWithoutTool({ action: TIRADOR_29.action, narration: TIRADOR_29.narration, okTools: [] })).toEqual({ kind: 'heal', phrase: 'la sangre deja de correr' });
    expect(stateWithoutTool({ action: TIRADOR_29.action, narration: TIRADOR_29.narration, okTools: ['heal'] })).toBeNull();
    expect(stateWithoutTool({ action: 'Le pido a Brenna que me cure.', narration: 'Brenna niega con la cabeza: no te cura nadie aquí.', okTools: [] })).toBeNull();
  });

  it('explorador 16: coger algo del sitio sin transfer_item; con transfer_item, pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'state_rejections', { action_text: EXPLORADOR_16.action }), logEvent(EXPLORADOR_16.narration));
    expect(err).toContain('«tomas uno de los»');
    expect(err).toContain('transfer_item');
    expect(stateWithoutTool({ action: null, narration: 'Recoges un puñado de setas del tocón.', okTools: [] })?.kind).toBe('pick');
    expect(stateWithoutTool({ action: null, narration: 'Recoges un puñado de setas del tocón.', okTools: ['harvest'] })).toBeNull();
    expect(stateWithoutTool({ action: null, narration: 'Tomas asiento junto al fuego y coges aire.', okTools: [] })).toBeNull();
  });

  it('lanzador 33: un conjuro sin cast_spell; con cast_spell, pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'state_rejections', { action_text: LANZADOR_33.action }), logEvent(LANZADOR_33.narration));
    expect(err).toContain('«lanzas el rayo»');
    expect(err).toContain('cast_spell');
    expect(stateWithoutTool({ action: LANZADOR_33.action, narration: LANZADOR_33.narration, okTools: ['cast_spell'] })).toBeNull();
    // Tirador 20: lo que no sabe hacer, negado, no cuenta.
    expect(stateWithoutTool({ action: 'Uso mi Marca del Cazador.', narration: 'Apuntas a la rendija, pero la Marca del Cazador no es algo que sepas hacer todavía.', okTools: [], resources: ['Marca del Cazador'] })).toBeNull();
    expect(stateWithoutTool({ action: 'Entro en furia.', narration: 'Entras en furia y el banco salta de una patada.', okTools: [], resources: ['Furia'] })?.kind).toBe('spell');
  });

  it('bench c21 y c22: el pasado que cuenta el jugador, sin record_character_fact; con él, pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'state_rejections', { action_text: C21.action }), logEvent(C21.narration));
    expect(err).toContain('record_character_fact');
    expect(stateWithoutTool({ action: C22.action, narration: C22.narration, okTools: [] })).toEqual({ kind: 'fact', phrase: 'busco a mi hermana' });
    expect(stateWithoutTool({ action: C22.action, narration: C22.narration, okTools: ['record_character_fact'] })).toBeNull();
    expect(stateWithoutTool({ action: '¿Dónde vive el herrero?', narration: 'Brenna señala la plaza.', okTools: [] })).toBeNull();
  });

  it('lo que un NPC recordará va en npc_memory_note', async () => {
    const { engine } = await bootEngine();
    const close = logEvent('Brenna te sostiene la mirada. No lo olvidará.', { npc_id: 'npc_brenna' });
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'state_rejections', { action_text: 'Le tiro la jarra a los pies.' }), close);
    expect(err).toContain('npc_memory_note');
    expect(run(ctxOnly(engine, 'state_rejections', { action_text: 'Le tiro la jarra a los pies.' }), 'log_event', { ...close, npc_memory_note: 'Kael le tiró una jarra a los pies.' }).closed).toBe(true);
  });

  it('un fiado que se cuela con transfer_item sin set_debt', async () => {
    const { engine } = await bootEngine();
    const close = logEvent('Brenna te deja la jarra delante.', { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Te la apunto en tu cuenta.' }] });
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'state_rejections', { ok_tools: ['transfer_item'] }), close);
    expect(err).toContain('set_debt');
    expect(run(ctxOnly(engine, 'state_rejections', { ok_tools: ['transfer_item', 'set_debt'] }), 'log_event', close).closed).toBe(true);
  });

  it('tras una tirada no se mira (la acción ya se juzgó al pedirla)', async () => {
    const { engine } = await bootEngine();
    expect(run(ctxOnly(engine, 'state_rejections', { action_text: TIRADOR_28.action, roll_category: 'exito_justo' }), 'log_event', logEvent(TIRADOR_28.narration)).closed).toBe(true);
  });
});

// Bench de Haiku bajo (data/local/bench/claude-haiku-5-5-low-*.json), paso a01: «Me apoyo en la barra y le pido a Brenna una cerveza.»
const BENCH_ACTION = 'Me apoyo en la barra y le pido a Brenna una cerveza.';
const BENCH_1 = 'Apoyas los codos en la barra de roble. Brenna deja de secar la jarra, la llena de una cuba sin prisa y la desliza hacia ti. Tiene la quemadura vieja del dorso de la mano recogida contra el mandil.\n\n«Cuatro de cobre.» Te mira un momento, de arriba abajo, como quien tasa una mercancía.';
const BENCH_2 = 'Apoyas los codos en la barra de roble. Brenna deja de secar la jarra un momento, te mira de arriba abajo sin prisa y la vuelve a secar. Sirve una jarra de cerveza turbia y la empuja hacia ti.';

describe('arreglo 14: el primer trago se paga', () => {
  it('bench de Haiku, pasada 1: la jarra servida sin buy_item se rechaza con el precio; a la segunda pasa', async () => {
    const { engine } = await bootEngine();
    const close = logEvent(BENCH_1, { npc_id: 'npc_brenna', tags: 'social, chat', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Cuatro de cobre. ¿De dónde vienes, forastero?' }] });
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'served_rejections', { action_text: BENCH_ACTION }), close);
    expect(err).toContain('«la desliza hacia ti»');
    expect(err).toContain('Brenna vende jarra de cerveza a 4 de cobre');
    expect(err).toContain('buy_item (npc_id npc_brenna, item_id it_cerveza)');
    expect(run(ctxOnly(engine, 'served_rejections', { action_text: BENCH_ACTION, ok_tools: ['buy_item'] }), 'log_event', close).closed).toBe(true);
  });

  it('bench de Haiku, pasada 2: «Sirve una jarra… y la empuja hacia ti»; transfer_item no la cobra', async () => {
    const { engine } = await bootEngine();
    const close = logEvent(BENCH_2, { npc_id: 'npc_brenna', tags: 'social, chat' });
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'served_rejections', { action_text: 'Una cerveza, por favor.', ok_tools: ['transfer_item'] }), close);
    expect(err).toMatch(/«sirve una jarra»|«la empuja hacia ti»/);
    expect(run(ctxOnly(engine, 'served_rejections', { action_text: 'Una cerveza, por favor.', ok_tools: ['set_debt'] }), 'log_event', close).closed).toBe(true);
  });

  it('decir el precio sin servirla no se rechaza; ni servir sin nada de la carta de por medio', async () => {
    const { engine } = await bootEngine();
    expect(run(ctxOnly(engine, 'served_rejections', { action_text: BENCH_ACTION }), 'log_event', logEvent('Brenna te mira. «Cuatro de cobre, y te la pongo cuando pagues.»', { npc_id: 'npc_brenna' })).closed).toBe(true);
    expect(run(ctxOnly(engine, 'served_rejections', { action_text: 'Le pregunto a Brenna por el pozo.' }), 'log_event', logEvent('Brenna te acerca una silla y la desliza hacia ti.', { npc_id: 'npc_brenna' })).closed).toBe(true);
    // Nombrar la cerveza no hace comercio de cualquier «te deja»: tiene que ir lo servido en la frase.
    expect(run(ctxOnly(engine, 'served_rejections', { action_text: 'Le pregunto a Brenna si la cerveza es de aquí.' }), 'log_event', logEvent('Brenna se encoge de hombros y te deja hablar.', { npc_id: 'npc_brenna' })).closed).toBe(true);
    const menu = [{ npc_id: 'npc_brenna', npc: 'Brenna', item_id: 'it_cerveza', name: 'jarra de cerveza', price: '4 de cobre' }];
    expect(menuNamed(menu, ['Le pido otra jarra.'])).toBeNull(); // «jarra» sola es el recipiente
    expect(menuNamed(menu, ['Ponme dos cervezas.'])?.item_id).toBe('it_cerveza');
  });
});

// Pareja de Opus (20261125-1703), turno 5. En el original el acreedor es Garrán; aquí, Brenna (el mundo de demo).
const OPUS_T5 = 'Brenna baja la mano despacio. Mira tu bolsa antes que a ti. Vacías el oro y la plata sobre la tablilla; ella los barre con la palma y los hace desaparecer en su cuero. Debes ahora uno de oro y cinco de plata, a seis días. Tu bolsa queda ligera como una promesa.';

describe('arreglo 17: settle_debt y set_debt cuadrados con lo narrado', () => {
  async function debtor(coins: number) {
    const { engine } = await bootEngine();
    engine.world.itemInstances.get('ii_kael_bolsa')!.state['coins'] = coins;
    const ctx = ctxOnly(engine, 'debt_rejections');
    expect(run(ctx, 'set_debt', { npc_id: 'npc_brenna', amount: 300, reason: 'la cuenta de la posada', due_in_hours: null }).ok).toBe(true);
    ctx.write_calls = [];
    return { engine, ctx };
  }

  it('Opus turno 5: «vacías el oro y la plata» con monedas en la bolsa tras pagar 150 se rechaza; a la segunda pasa', async () => {
    const { ctx } = await debtor(300);
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'coins', amount: 150 })).toMatchObject({ ok: true, paid: 150, remaining: 150 });
    const err = rejectsOnceThenPasses(ctx, logEvent(OPUS_T5, { npc_id: 'npc_brenna' }));
    expect(err).toContain('«el oro y la plata»');
    expect(err).toContain('settle_debt ha cobrado 1 de oro y 5 de plata: le quedan 1 de oro y 5 de plata en la bolsa');
  });

  it('si lo que lleva es justo lo que paga y queda lo que dice, cuadra', async () => {
    const { ctx } = await debtor(150);
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'coins', amount: 150 }).ok).toBe(true);
    expect(run(ctx, 'log_event', logEvent(OPUS_T5, { npc_id: 'npc_brenna' })).closed).toBe(true);
  });

  it('lo que queda de deuda o lo pagado, distinto de la tool; la deuda saldada con resto', async () => {
    const { ctx } = await debtor(1500);
    expect(run(ctx, 'settle_debt', { npc_id: 'npc_brenna', how: 'coins', amount: 150 }).ok).toBe(true);
    const err = rejectsOnceThenPasses(ctx, logEvent('Le das uno de oro y cinco de plata. Debes ahora dos de oro.', { npc_id: 'npc_brenna' }));
    expect(err).toContain('queda de deuda 2 de oro');
    const fmt = (n: number) => `${n}`;
    expect(debtMismatch({ narration: 'Le das tres de oro.', cur: DEFAULT_CURRENCY, fmt, settle: { paid: 150, remaining: 150, coins_left: 1350 } })).toContain('paga 300');
    expect(debtMismatch({ narration: 'Le pagas y la deuda queda saldada.', cur: DEFAULT_CURRENCY, fmt, settle: { paid: 150, remaining: 150, coins_left: 1350 } })).toContain('saldada');
    expect(debtMismatch({ narration: 'Le das uno de oro y cinco de plata. Te faltan uno de oro y cinco de plata.', cur: DEFAULT_CURRENCY, fmt, settle: { paid: 150, remaining: 150, coins_left: 1350 } })).toBeNull();
    expect(debtMismatch({ narration: 'Brenna lo apunta: me debes treinta de cobre.', cur: DEFAULT_CURRENCY, fmt, set: { amount: 30, owes: 30 } })).toBeNull();
    expect(debtMismatch({ narration: 'Brenna lo apunta: me debes tres de plata.', cur: DEFAULT_CURRENCY, fmt, set: { amount: 4, owes: 4 } })).toContain('apunta 30');
  });

  it('cantidades: «uno de oro y cinco de plata» es una sola', () => {
    expect(moneyAmounts('debes ahora uno de oro y cinco de plata, a seis dias', DEFAULT_CURRENCY).map((a) => a.value)).toEqual([150]);
    expect(moneyAmounts('cuatro de cobre y diez monedas', DEFAULT_CURRENCY).map((a) => a.value)).toEqual([4, 10]);
  });
});
