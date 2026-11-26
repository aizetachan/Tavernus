/**
 * Guardas de la tanda 5 (docs/INFORME-PASADA-4-2026-11-26.md, «Tanda 5»): los perfiles del jugador automático piden con
 * las palabras justas fiar, quedar a una hora, consultar una regla, cobrar un encargo y esconder sus monedas, y el
 * máster (Haiku) lo acepta de palabra. Cada guarda rechaza el cierre una vez con el hint de la tool que falta y a la
 * segunda deja pasar; lo que el NPC rechaza pasa sin tool. Los textos son los de la tanda 20261126-0602
 * (data/local/autoplay/20261126-0602/transcripts/{deudor,cronista,herido}.md).
 *
 *   - Arreglo 24: fiar es set_debt o no es.
 *   - Arreglo 27: citas con hora, schedule_event.
 *   - Arreglo 28: lookup_rule cuando el jugador pregunta por una regla.
 *   - Arreglo 29: «esconder» no es robar (take_coins y conflict_act).
 *   - Arreglo 26 (la guarda): encargos del tablón que se cobran con complete_job.
 */
import { describe, expect, it } from 'vitest';
import { conflictPlanFor } from '../src/ai/prompt.js';
import { executeTool } from '../src/ai/tools.js';
import { creditWithoutDebt, declaresTheft, jobClaimWithoutComplete, meetingWithoutSchedule, movesOwnCoins, ruleQuestionWithoutLookup } from '../src/engine/closecheck.js';
import { coinsOf, newPurse } from '../src/engine/money.js';
import { bootEngine } from './helpers.js';
import { ctxOnly, logEvent, rejectsOnceThenPasses, run } from './guardas-helpers.js';

// Deudor, turno 1 (continuación de la tirada de Acrobacias, la que cerró sin set_debt).
const DEUDOR_1 = {
  action: 'Suelto el lacre a la vista y me zafo despacio: «Nadie, señora. Solo es un recuerdo de viaje. ¿Me apuntas una cerveza en la taberna, que te la pago mañana?',
  narration: '«Nadie, señora. Solo es un recuerdo de viaje. ¿Me apuntas una cerveza en la taberna, que te la pago mañana?» Ella no hace ademán de retenerte; deja la mano en el aire, con las uñas negras de corteza, y tus dedos quedan libres. El lacre se esconde otra vez en tu bolsillo. Ilse vuelve la mirada al cubo, donde la vela sigue flotando, y no te mira de nuevo. «Mañana, entonces. Las deudas de la taberna no envejecen bien.»',
};
// Deudor, turnos 26, 33 y 40: Brenna no fía.
const DEUDOR_26 = { action: 'Ilse, suelto la carta despacio, pero antes de que me sueltes la muñeca: Brenna, apúntame una cerveza, te la pago mañana.', narration: '«Ilse, suelto la carta despacio… Brenna, apúntame una cerveza, te la pago mañana.» Ilse no está aquí, y nadie te sujeta la muñeca; la carta sigue en tu bolsillo. Brenna deja de secar la jarra un momento, te mira por encima del hombro y vuelve a su trabajo. «Ilse anda por el camastro, en la Casa de las hierbas. Y a ti no te apunto nada: aquí se paga con cobre.»' };
const DEUDOR_33 = { action: 'Ilse, perdona, se me cayó la vela, no sé de qué carta hablas. Que no me sujeten así. Brenna, apúntamela, te la pago mañana: una cerveza, por favor.', narration: '«Brenna, apúntamela, te la pago mañana: una cerveza, por favor.» Brenna no levanta la vista de la jarra. Deja la jarra sobre el paño y te mira un instante, de lado, como quien calcula. Sin sacar el cazo de la barra, saca la voz seca. «Aquí no se apunta nada, muchacha. Cuatro de cobre y en mano, como todo el mundo.»' };
const DEUDOR_40 = { action: 'Brenna, apúntamela, te la pago mañana: una cerveza y una ración, que hoy estoy en apuros de cobre.', narration: '«Brenna, apúntamela, te la pago mañana: una cerveza y una ración, que hoy estoy en apuros de cobre.» «Fiar a una que ayer quiso dejarme un anillo en prenda, no. Aquí se paga antes de comer, muchacha.» «Si te sobra alguna cosa que valga más que el cobre, lo hablamos cuando no tenga las manos ocupadas.»' };
// Deudor, turno 32: esconder sus monedas acabó en robarle la bolsa a la tabernera.
const DEUDOR_32 = 'Saco mis monedas de la bolsa y las escondo al fondo de la mochila, bajo la ropa fina, por si alguien me roba.';
const DEUDOR_25 = 'Meto la mano en la bolsa de cuero, saco tres monedas de plata y las escondo al fondo de la mochila, bajo el pergamino de linaje.';

// Cronista, turno 6: Ilse cambia el alba por la misa de las ocho y queda de palabra.
const CRONISTA_6 = {
  action: 'Le suelto la muñeca despacio y le digo a Ilse: "Mañana, al alba, aquí junto al pozo. Traeme lo que sepas de Vharn, y yo te enseño la carta.',
  narration: '«Mañana, al alba, aquí junto al pozo. Tráeme lo que sepas de Vharn, y yo te enseño la carta.» Ilse suelta el cesto de corteza y se frota la muñeca. «Al alba estoy con las hierbas, y no me gusta que me esperen. Pero a la misa de las ocho ya estaré junto al pozo. Allí se habla poco, y se dice lo que hace falta.»',
};
// Cronista, turnos 26 y 37: nadie queda.
const CRONISTA_26 = { action: 'Brenna, no me importa esperar el rezo. Fermina, ¿quedamos mañana al alba junto al pozo? Quiero que me cuentes lo del granero sin testigos.', narration: '«Brenna, no me importa esperar el rezo. Fermina, ¿quedamos mañana al alba junto al pozo? Quiero que me cuentes lo del granero sin testigos.» «Fermina está ahí mismo, con su cesto. Vive en la plaza, así que la encontrarás al alba como a todos. Lo que le digas al pozo, eso ya es cosa vuestra.» «Y el granero no se cuenta en voz baja junto al brocal. Ni en voz alta.»' };
const CRONISTA_37 = { action: 'Acerco el farol al tablón, leo en voz alta el papel de Brenna y digo: «Mañana al alba nos vemos aquí, en el pozo, Ilse. Traed las velas y contadme quién escribió esta carta».', narration: '«Mañana al alba nos vemos aquí, en el pozo, Ilse. Traed las velas y contadme quién escribió esta carta.» Acercas el farol al tablón y lees en voz alta el papel de Brenna: leña para diez leños secos, sesenta de cobre al entregarlos. Tu voz rebota en el empedrado. Nadie responde. Ilse no está en la plaza, y la luz de la taberna sigue al fondo, sin nadie asomado. Lo que has dicho queda para el alba, si alguien llega a oírlo.' };

// Herido: las preguntas de reglas que Hugo contestó de memoria (turnos 3, 7, 12, 16, 20, 24, 29, 33 y 37).
const HERIDO_3 = { action: 'Me cruzo de brazos y miro a Hugo de reojo, sin bajar la guardia. "¿Cuántos días puede aguantar un hombre sin comer ni beber según las reglas? Lo pregunto porque no pienso morirme de hambre mientras tú te andas con secretos.', narration: 'Hugo deja el martillo sobre el yunque. «Tres días sin agua, y una semana sin pan si no te mueves mucho. Pero aquí nadie se muere de hambre.»' };
const HERIDO_RULES = [
  'Hugo, si el Jabalí está en Brezal, ¿cuántas millas se andan en un día de viaje a paso normal? Quiero saber si llego antes de que baje la niebla.',
  'Hugo, ¿cuántos días aguanta un hombre sin comer ni beber? Quiero saber si puedo quedarme aquí encerrado sin morir de hambre mientras busco a Osric.',
  'Oye, cura de pozo, ¿cuántas millas se andan en un día de viaje a paso normal? Quiero saber si llego a Vharn antes de que caiga la niebla.',
  'Entro en el Jabalí, dejo la moneda de plata sobre la barra y grito: ¡Posadero! Y de paso, ¿cuántas millas se andan en un día de viaje a paso normal según las reglas?',
  'Bruno aprieta los dientes y pregunta al tabernero: ¿según las reglas, cuántos días aguanta un hombre sin comer ni beber? Quiero saber cuánto me queda antes de que la pierna me falle.',
];

// Cronista, turnos 4, 14, 24 y 34: da el encargo por hecho y quiere cobrar.
const CRONISTA_24 = { action: 'Me acerco a Brenna en el tablón y le digo: «Ya tengo el agua del pozo para Ilse. ¿Me pagas el encargo del granero antes de que cierre la misa?', narration: '«Ya tengo el agua del pozo para Ilse. ¿Me pagas el encargo del granero antes de que cierre la misa?» Te acercas a Brenna con la voz baja. Ella no levanta la vista: seca la jarra de barro despacio y sigue inclinada hacia las velas.' };
const CRONISTA_34 = 'Me acerco al sereno con el farol, saco la carta de Vharn del cinto y le digo: «Ya tengo la leña del Soto. Dile a Brenna que cobro cuando cierre la posada».';
const CRONISTA_14 = 'Me acerco a Osric, dejo la carta fuera de la vista y le digo: "Leña hecha, regidor. Diez atados, ya están en la posada. Quiero mi paga antes del toque de las nueve.';

describe('arreglo 24: fiar es set_debt o no es', () => {
  it('deudor 1: «Mañana, entonces» sin set_debt se rechaza con el hint; a la segunda pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'credit_rejections', { action_text: DEUDOR_1.action }), logEvent(DEUDOR_1.narration));
    expect(err).toContain('«manana, entonces»');
    expect(err).toContain('set_debt');
    expect(err).toContain('due_in_hours');
    // Con set_debt hecho, pasa a la primera.
    expect(run(ctxOnly(engine, 'credit_rejections', { action_text: DEUDOR_1.action, ok_tools: ['set_debt'] }), 'log_event', logEvent(DEUDOR_1.narration)).closed).toBe(true);
  });

  it('salta en cada acción que lo contiene, no una por partida', async () => {
    const { engine } = await bootEngine();
    for (let i = 0; i < 3; i++) {
      const err = rejectsOnceThenPasses(ctxOnly(engine, 'credit_rejections', { action_text: 'Brenna, apúntamela, te la pago mañana: una cerveza.' }), logEvent('Brenna asiente sin dejar la jarra. «Te la apunto. Mañana me la pagas.»'));
      expect(err).toContain('«te la apunto»');
    }
  });

  it('el NPC que lo acepta con un «de acuerdo», o lo apunta en la narración, también', () => {
    expect(creditWithoutDebt({ action: 'Fíame la cena, Brenna, que mañana cobro.', narration: 'Brenna te mira un rato largo. «De acuerdo.»', okTools: [] })).toBe('de acuerdo');
    expect(creditWithoutDebt({ action: '¿Me lo apuntas a cuenta?', narration: '', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Apuntado queda. Hasta mañana.' }], okTools: [] })).toBe('apuntado');
  });

  it('deudor 26, 33 y 40: Brenna no fía y pasa sin tool; tampoco si nadie lo oye', async () => {
    const { engine } = await bootEngine();
    for (const t of [DEUDOR_26, DEUDOR_33, DEUDOR_40]) {
      expect(creditWithoutDebt({ action: t.action, narration: t.narration, okTools: [] })).toBeNull();
      expect(run(ctxOnly(engine, 'credit_rejections', { action_text: t.action }), 'log_event', logEvent(t.narration)).closed).toBe(true);
    }
    // Deudor 8: no hay nadie.
    expect(creditWithoutDebt({ action: 'Señora Ilse, apúntame una cerveza y una ración en la cuenta, te la pago mañana cuando cobre la carta de Vharn.', narration: 'Miras hacia el callejón por donde se fue Ilse, pero no hay nadie. Si quieres fiar algo, tendrás que buscarla en su casa.', okTools: [] })).toBeNull();
    // Lo rechaza y se despide: «hasta mañana» no es aceptar.
    expect(creditWithoutDebt({ action: 'Apúntamela, que te la pago mañana.', narration: '«Aquí se paga en mano.» Brenna se da la vuelta. «Hasta mañana.»', okTools: [] })).toBeNull();
    // Sin pedir fiado, un «hasta mañana» es una despedida.
    expect(creditWithoutDebt({ action: 'Me despido de Brenna.', narration: '«Hasta mañana», dice sin mirarte.', okTools: [] })).toBeNull();
  });
});

describe('arreglo 27: citas con hora', () => {
  it('cronista 6: «ya estaré junto al pozo» sin schedule_event se rechaza; a la segunda pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'meeting_rejections', { action_text: CRONISTA_6.action }), logEvent(CRONISTA_6.narration));
    expect(err).toContain('«ya estare»');
    expect(err).toContain('schedule_event');
    expect(err).toContain('days_from_now');
    expect(run(ctxOnly(engine, 'meeting_rejections', { action_text: CRONISTA_6.action, called_tools: ['schedule_event'] }), 'log_event', logEvent(CRONISTA_6.narration)).closed).toBe(true);
  });

  it('tras schedule_event de verdad, el cierre pasa', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxOnly(engine, 'meeting_rejections', { action_text: CRONISTA_6.action });
    const r = run(ctx, 'schedule_event', { title: 'la charla en la barra', location_id: null, spot_id: null, start_hour: 8, duration_min: 30, recurrence: 'once', weekday: null, days_from_now: 1, description: 'Kael y Brenna quedan en la barra.', npc_ids: 'npc_brenna', crowd: null, noise: null, busy_npc_ids: '', start_text: null, end_text: null, told_actor: true });
    expect(r).toMatchObject({ ok: true });
    expect(run(ctx, 'log_event', logEvent(CRONISTA_6.narration)).closed).toBe(true);
  });

  it('cronista 26 y 37: nadie queda; y si el NPC dice que no, pasa', () => {
    for (const t of [CRONISTA_26, CRONISTA_37]) expect(meetingWithoutSchedule({ action: t.action, narration: t.narration, calledTools: [] })).toBeNull();
    expect(meetingWithoutSchedule({ action: 'Quedamos mañana al alba en el pozo, Ilse.', narration: '«No puedo, al alba estoy con las hierbas.» Ilse vuelve al cubo. «Hasta mañana.»', calledTools: [] })).toBeNull();
    // Sin hora no es una cita: «nos vemos» de despedida.
    expect(meetingWithoutSchedule({ action: 'Me despido de Ilse.', narration: '«Nos vemos», dice Ilse.', calledTools: [] })).toBeNull();
    expect(meetingWithoutSchedule({ action: 'Nos vemos a las ocho en la plaza, Doro.', narration: 'Doro asiente. «Allí estaré.»', calledTools: [] })).toBe('alli estare');
  });
});

describe('arreglo 28: lookup_rule cuando el jugador pregunta por una regla', () => {
  it('herido 3: Hugo contesta de memoria; se rechaza con la consulta en inglés y a la segunda pasa', async () => {
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'rule_rejections', { action_text: HERIDO_3.action }), logEvent(HERIDO_3.narration));
    expect(err).toContain('lookup_rule');
    expect(err).toContain('"food and water"');
    expect(err).toContain('voz del NPC');
  });

  it('con lookup_rule llamado, pasa a la primera', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxOnly(engine, 'rule_rejections', { action_text: HERIDO_3.action });
    // Sin manuales indexados en los tests, lookup_rule lo dice en texto; cuenta igual como consultada.
    expect(executeTool(ctx, 'lookup_rule', { query: 'food and water', book: 'phb' })).toMatch(/manuales|food/i);
    expect(ctx.called_tools).toContain('lookup_rule');
    expect(run(ctx, 'log_event', logEvent(HERIDO_3.narration)).closed).toBe(true);
  });

  it('las otras preguntas del herido, con su tema', () => {
    const q = HERIDO_RULES.map((a) => ruleQuestionWithoutLookup({ action: a, calledTools: [] })?.query);
    expect(q).toEqual(['travel pace', 'food and water', 'travel pace', 'travel pace', 'food and water']);
  });

  it('lo que no es una regla no se rechaza', () => {
    for (const a of [
      'Hugo, ¿dónde vive la herbolaria? Quiero que me cierre esto de verdad.',
      'Saco la poción de curación de la mochila y me la bebo de un trago. Pregunto: ¿cuánto tarda en hacer efecto?',
      '¿Cuánto cuesta la cerveza?',
      'Me siento en el banco y como mi ración.',
      '¿Cómo funciona este molino, Mateo?',
    ]) expect(ruleQuestionWithoutLookup({ action: a, calledTools: [] })).toBeNull();
  });
});

describe('arreglo 29: «esconder» no es robar', () => {
  it('declaresTheft y movesOwnCoins: el miedo a que le roben no es robar', () => {
    expect(declaresTheft(DEUDOR_32)).toBe(false);
    expect(movesOwnCoins(DEUDOR_32)).toBe(true);
    expect(movesOwnCoins(DEUDOR_25)).toBe(true);
    expect(declaresTheft('Le robo unas monedas de la bolsa a Garrán.')).toBe(true);
    expect(movesOwnCoins('Le robo unas monedas de la bolsa a Brenna y las escondo en la mochila.')).toBe(false);
    expect(declaresTheft('Meto la mano en su bolsa mientras seca la jarra.')).toBe(true);
  });

  it('deudor 32: take_coins de la bolsa de la tabernera se rechaza con el motivo; de la suya, pasa', async () => {
    const { engine } = await bootEngine();
    const w = engine.world;
    const hers = newPurse(w, 'npc_brenna', 300);
    const ctx = ctxOnly(engine, 'credit_rejections', { action_text: DEUDOR_32 });
    const r = run(ctx, 'take_coins', { instance_id: hers.id, amount: null, to_instance_id: null });
    expect(r.error).toBe('not_yours');
    expect(r.hint).toContain('Brenna');
    expect(w.itemInstance(hers.id).state['coins']).toBe(300);
    // Una acción que no dice robar tampoco le saca nada a un NPC.
    expect(run(ctxOnly(engine, 'credit_rejections', { action_text: 'Cuento lo que llevo encima.' }), 'take_coins', { instance_id: hers.id, amount: 10, to_instance_id: null }).error).toBe('not_theft');
    // Con un robo declarado y la tirada ganada, sí (como hasta ahora).
    const before = coinsOf(w, 'ch_kael');
    expect(run(ctxOnly(engine, 'credit_rejections', { action_text: 'Le robo unas monedas de la bolsa a Brenna.', roll_category: 'exito_claro' }), 'take_coins', { instance_id: hers.id, amount: 10, to_instance_id: null }).ok).toBe(true);
    expect(coinsOf(w, 'ch_kael')).toBe(before + 10);
  });

  it('deudor 32: conflict_act steal sobre Brenna se rechaza, y el motor no lo lee como robo', async () => {
    const { engine } = await bootEngine();
    const hers = newPurse(engine.world, 'npc_brenna', 300);
    const ctx = ctxOnly(engine, 'credit_rejections', { action_text: DEUDOR_32 });
    const r = run(ctx, 'conflict_act', { npc_id: 'npc_brenna', kind: 'steal', instance_id: hers.id, new_item_name: null, new_item_worn: null });
    expect(r.error).toBe('not_theft');
    expect(r.hint).toContain('take_coins');
    expect(ctx.conflict).toBeUndefined();
    expect(conflictPlanFor(engine, engine.world.character('ch_kael'), DEUDOR_32)).toBeNull();
  });
});

describe('arreglo 26 (la guarda): encargos del tablón que se cobran', () => {
  const withJob = async () => {
    const { engine } = await bootEngine();
    engine.world.campaign.board.active_job_ids = ['job_lena', 'job_ronda'];
    return engine;
  };

  it('cronista 24: con el encargo de Brenna en el tablón y Brenna delante, «ya tengo» sin complete_job se rechaza; a la segunda pasa', async () => {
    const engine = await withJob();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'job_rejections', { action_text: CRONISTA_24.action }), logEvent(CRONISTA_24.narration));
    expect(err).toContain('«ya tengo»');
    expect(err).toContain('complete_job');
    expect(err).toContain('job_lena');
    expect(err).toContain('npc_brenna');
    // El de Doro no: Doro no está en la taberna.
    expect(err).not.toContain('job_ronda');
  });

  it('con complete_job hecho o fallido (el servidor dice que falta leña), pasa', async () => {
    const engine = await withJob();
    const ctx = ctxOnly(engine, 'job_rejections', { action_text: CRONISTA_24.action });
    const r = run(ctx, 'complete_job', { character_id: 'ch_kael', job_id: 'job_lena', npc_id: 'npc_brenna' });
    expect(r.error).toContain('faltan');
    expect(run(ctx, 'log_event', logEvent('Brenna cuenta con los ojos lo que traes. «Aquí no hay ni un leño, muchacho.»')).closed).toBe(true);
  });

  it('el NPC que lo paga de palabra, también; sin encargo o sin quien lo pidió, pasa', async () => {
    const jobs = [{ id: 'job_lena', title: 'Leña para la posada', giver: 'Brenna (npc_brenna)', wants: '10 de madera', words: ['lena', 'posada', 'madera'] }];
    expect(jobClaimWithoutComplete({ action: 'Dejo la leña junto a la puerta.', narration: 'Brenna los mira. «Buen trabajo. Aquí tienes tu paga.»', okTools: [], jobs })).toBe('buen trabajo');
    expect(jobClaimWithoutComplete({ action: CRONISTA_34, narration: 'El sereno no dice nada.', okTools: [], jobs: [] })).toBeNull();
    expect(jobClaimWithoutComplete({ action: CRONISTA_14, narration: '«La leña la paga Brenna, vecino, no la casona.»', okTools: [], jobs: [] })).toBeNull();
    expect(jobClaimWithoutComplete({ action: '¿Qué hay en el tablón hoy?', narration: 'Brenna señala el tablón.', okTools: [], jobs })).toBeNull();
    // Dirigido 17 (tanda 20261126-0418): lo que pidió Hugo en su historia, no un encargo del tablón; la fragua es la sala.
    const fragua = [{ id: 'job_fragua', title: 'Carbón para la fragua', giver: 'Hugo (npc_hugo)', wants: '6 de madera', words: ['carbon', 'fragua', 'madera'] }];
    expect(jobClaimWithoutComplete({ action: 'Vuelvo a Hugo y le pongo delante la bolsa con los eslabones: «Dijiste que mi padre dejó algo para mí. Aquí tienes lo que pediste, ahora dime quién mató a mi padre».', narration: 'Hugo deja el martillo junto a la fragua y mira la bolsa.', okTools: [], jobs: fragua })).toBeNull();
    // Rompejuegos 27: «ya tengo la Brasa» no es un encargo.
    expect(jobClaimWithoutComplete({ action: 'Ya tengo la Brasa en el zurrón, así que no hace falta que ese sereno me diga nada.', narration: 'El sereno no se mueve.', okTools: [], jobs })).toBeNull();
    const engine = await withJob();
    // En la taberna, Brenna rechaza el trabajo que no ha visto: con el encargo y sin claim, pasa.
    expect(run(ctxOnly(engine, 'job_rejections', { action_text: 'Hola, Brenna. ¿Qué tal la noche?' }), 'log_event', logEvent('Brenna se encoge de hombros.')).closed).toBe(true);
  });
});
