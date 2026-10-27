/**
 * Brezal sellada: la historia en tres actos (src/engine/story.ts). Cada misión
 * la ofrece alguien al hablar con él, si el PJ tiene nivel y cumple lo que pide;
 * lo que se oye por ahí es un rumor que dice a quién buscar. La recompensa la da
 * quien la encargó, al volver a verle (docs/BREZAL.md, §3).
 *
 *   Misión principal: la de la situación inicial de cada PJ (la carta, el padre
 *   herrero, la deuda), que avanza por actos con lo que pasa en las demás.
 *   Acto I · Lo que trae el agua (nivel 1–2): recados que presentan a la gente
 *   (la cena de Doro, el jarabe de Mateo, la reja del molino, la ronda de los
 *   Corrales, los huevos de Ilse, la jarra de Hal) y tres hilos cortos que abren
 *   el mundo (el agua turbia del pozo, el perro de Brenna, lo que vio Doro).
 *   Acto II · Lo que esconde Brezal (nivel 2–3, tras su hilo del acto I): el
 *   sótano, la cadena, el hijo del molinero y el Granero Quemado.
 *   Acto III · La noche de la Brasa (nivel 3–4): tres finales que se excluyen
 *   (templar el ascua, la verdad en el pozo, que arda Vharn).
 *
 * Las recompensas van en cobre (1 de oro = 10 de plata = 100 de cobre): un recado,
 * unas monedas de plata; un final, varias de oro.
 *
 * La amenaza avanza sola si nadie interviene, en tres días: la tos gris, los
 * lobos en los Corrales, Tobías que se esconde, la herrería clavada y la
 * noche de la Brasa. Al amanecer del día 6, pase lo que pase, el epílogo: la
 * niebla sigue ahí.
 */

import type { Story, StoryCondition, StoryEscalation, StoryQuest, StoryStep } from '../../../engine/story.js';

const at = (location_id: string): StoryCondition => ({ kind: 'at_location', location_id });
const FINALS: StoryCondition = { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_final_templar' }, { kind: 'quest', quest_id: 'q_final_verdad' }, { kind: 'quest', quest_id: 'q_final_arder' }] };
const FINAL_STEP: StoryStep = { id: 'final', text: 'Decidir qué pasa con el ascua antes de la noche de la Brasa', done_when: FINALS, journal: 'La noche de la Brasa ya tiene dueño.' };
/** Las pistas del hijo del herrero (y de quien viaja con él). */
const HERRERO_STEPS: StoryStep[] = [
  { id: 'legado', text: 'Que Hugo enseñe lo que dejó tu padre', optional: true, revealed_by: { kind: 'knows', npc_id: 'npc_hugo' },
    done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_hugo' }, { kind: 'carry', item_id: 'it_cadena_fria' }] },
    journal: 'Lo que dejó el padre son los últimos eslabones de hierro frío de Vharn.' },
  { id: 'vharn', text: 'Preguntar a la tabernera qué vio la noche del incendio', optional: true, revealed_by: { kind: 'any', of: [{ kind: 'knows', npc_id: 'npc_brenna' }, { kind: 'clue', clue_id: 'clue_hugo' }] },
    done_when: { kind: 'clue', clue_id: 'clue_brenna' }, journal: 'Brenna estuvo en Vharn esa noche: «no fue un accidente».' },
  { id: 'luces', text: 'Preguntar al guardia del portón por las luces del granero', optional: true, revealed_by: { kind: 'knows', npc_id: 'npc_doro' }, done_when: { kind: 'clue', clue_id: 'clue_doro' },
    journal: 'Doro ha visto luces en el Granero Quemado y una figura por la senda.' },
  { id: 'noche_vharn', text: 'Encontrar la prueba de quién se llevó la plata de Vharn aquella noche',
    revealed_by: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_brenna' }, { kind: 'clue', clue_id: 'clue_hugo' }, { kind: 'quest', quest_id: 'q_perro' }] },
    done_when: { kind: 'clue', clue_id: 'clue_libro' }, journal: 'El libro de cuentas de Vharn lo dice claro: la plata se la llevó Osric Malvez.' },
  { ...FINAL_STEP, revealed_by: { kind: 'clue', clue_id: 'clue_libro' } },
];

// Pasos de «Lo que vio Doro», compartidos con sus caminos de si muere alguien (lo ya hecho cuenta).
const CONFIANZA_DORO: StoryStep = { id: 'confianza', text: 'Que Doro te cuente lo que vio', done_when: { kind: 'clue', clue_id: 'clue_doro' } };
const VIGILAR: StoryStep = { id: 'vigilar', text: 'Vigilar de noche el arroyo del Soto', done_when: { kind: 'all', of: [{ kind: 'visit', spot_id: 'sp_cl_arroyo' }, { kind: 'npc_at', npc_id: 'npc_tobias', spot_id: 'sp_cl_arroyo' }] },
  on_done: [{ kind: 'know_npc', npc_id: 'npc_tobias' }, { kind: 'tell', text: 'La figura del arroyo es un muchacho enharinado con un hatillo: Tobías, el hijo del molinero. Va sin antorcha, como quien conoce el camino de memoria.' }] };
const QUE_LLEVA: StoryStep = { id: 'que_lleva', text: 'Descubrir qué lleva Tobías al granero y qué trae', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_tobias' }, { kind: 'carry', item_id: 'it_cartas_tobias' }, { kind: 'carry', item_id: 'it_bolsa_ceniza' }] } };

const QUESTS: StoryQuest[] = [
  // --- Acto I ------------------------------------------------------------------
  {
    id: 'q_agua', act: 1, title: 'El agua turbia', giver_npc_id: 'npc_ilse', level: 1,
    text: 'El agua del pozo de Brezal baja turbia y tibia, y media aldea tose gris. Ilse, la curandera, quiere una muestra del pozo para mirarla con calma.',
    notes: 'Primer hilo: lleva a Ilse y a la Brasa. El agua del pozo se puede coger (it_agua_pozo, en el pozo). Cuando el PJ se la dé a Ilse en mano (transfer_item a npc_ilse, con el actor allí; o advance_story si se la enseña sin soltarla, con el actor junto a ella), el servidor concede la pista de la Brasa y te pasa lo que ella dice: cuéntalo tú, con su voz de rezo y cocina.',
    rumor: { text: 'junto al pozo dicen que {giver} anda buscando a alguien que no le tenga miedo al agua', where: at('loc_plaza') },
    steps: [
      { id: 'mirar', text: 'Sacar agua del pozo y mirarla de cerca', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_pozo' }, { kind: 'carry', item_id: 'it_agua_pozo' }, { kind: 'npc_has', npc_id: 'npc_ilse', item_id: 'it_agua_pozo' }] } },
      // Se da al dársela (o enseñársela) a Ilse, no al cruzar su puerta: lo que ella dice luego tiene que pasar delante.
      { id: 'ilse', text: 'Darle el agua a Ilse, la curandera', done_when: { kind: 'any', of: [
        { kind: 'npc_has', npc_id: 'npc_ilse', item_id: 'it_agua_pozo' },
        { kind: 'all', of: [{ kind: 'talk', npc_id: 'npc_ilse' }, { kind: 'narrative', how: 'cuando el PJ le enseñe a Ilse el agua del pozo sin dársela (si se la da, lo detecta el servidor)' }] },
      ] },
        journal: 'Le dimos el agua a Ilse. La probó y escupió: es ceniza de la cripta.',
        on_done: [{ kind: 'clue', clue_id: 'clue_ilse' }, { kind: 'attitude', npc_id: 'npc_ilse', attitude: 'friendly' },
          { kind: 'tell', text: 'Ilse huele el agua, la prueba con la punta de la lengua y escupe: «Esto no es ceniza de hogar. Es de la cripta. La Brasa respira otra vez».' }] },
    ],
    reward: { coins: 50, xp: 100 },
    on_complete: [{ kind: 'learn_place', location_id: 'loc_ruinas' }],
    on_npc_dead: [{ npc_id: 'npc_ilse', outcome: 'fail', why: 'Ilse murió antes de poder mirar el agua' }],
  },
  // Recados de nivel 1: cada uno presenta a alguien del pueblo. Quien lo encarga se presenta al darlo; a quien se lo llevas, al recibirlo.
  {
    id: 'q_cena_doro', act: 1, title: 'La cena del portón', giver_npc_id: 'npc_brenna', level: 1,
    text: 'El guardia del portón no puede dejar su puesto y hoy no ha cenado. Brenna te da un plato tapado para que se lo lleves antes de que se enfríe.',
    notes: 'Recado para conocer a Doro. Al aceptarlo, el PJ recibe una ración. Doro está en el portón de día, en la barricada del Lindero por la tarde y en la barra del Jabalí de noche. El paso se da cuando el PJ se la da en mano (transfer_item a npc_doro). Luego hay que volver con Brenna.',
    rumor: { text: 'en la barra dicen que {giver} busca a alguien de fiar para un recado', where: at('loc_taberna') },
    steps: [
      { id: 'llevar', text: 'Darle la cena al guardia del portón', done_when: { kind: 'npc_has', npc_id: 'npc_doro', item_id: 'it_racion' },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_doro' }, { kind: 'tell', text: 'Doro destapa el plato, se quema los dedos y te da las gracias hablando más de la cuenta; dice su nombre dos veces y te pide que se lo agradezcas a Brenna.' }] },
    ],
    reward: { coins: 20, xp: 75 },
    on_accept: [{ kind: 'give_item', item_id: 'it_racion' }],
    on_complete: [],
    on_npc_dead: [
      { npc_id: 'npc_doro', outcome: 'fail', why: 'Doro murió antes de que le lleváramos la cena' },
      { npc_id: 'npc_brenna', outcome: 'fail', why: 'Brenna murió antes de que volviéramos con ella' },
    ],
  },
  {
    id: 'q_perro', act: 1, title: 'Ceniza se ha perdido', giver_npc_id: 'npc_brenna', level: 2, min_level: 1,
    text: 'A Brenna se le ha perdido Ceniza, su perro: pardo, una oreja rota. Lo vieron por el Soto, detrás de un olor. Paga a quien se lo traiga.',
    notes: 'El perro está en la madriguera al pie del roble del Soto, acorralado por la loba de ceniza (hostil, dura para un nivel 1: que el PJ piense antes de pelear; tampoco ella puede salir del valle). Se puede sacar ahuyentándola con fuego, colándose (Sigilo CD 13 mientras duerme), llevando encima ceniza del granero (no ataca a quien la lleva) o matándola. Ceniza vuelve solo al Jabalí; la recompensa, al hablar luego con Brenna, que se ablanda mucho.',
    rumor: { text: 'en el Jabalí dicen que {giver} lleva días con mala cara, mirando a la puerta', where: at('loc_taberna') },
    steps: [
      { id: 'rastro', text: 'Buscar el rastro del perro en el Soto', done_when: at('loc_claro'),
        on_done: [{ kind: 'tell', text: 'En el barro del Soto, entre botas, hay huellas de perro que van hacia el pie del roble, y al lado otras enormes, de lobo.' }] },
      { id: 'lobera', text: 'Encontrar a Ceniza en la madriguera', done_when: { kind: 'visit', spot_id: 'sp_cs_cueva' } },
      { id: 'sacar', text: 'Sacarlo de la madriguera', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando el PJ saque al perro de la madriguera: ahuyentando a la loba (fuego, Intimidación CD 15), colándose sin que le vea (Sigilo CD 13), llevando ceniza del granero encima, o con la loba muerta' },
        { kind: 'npc_status', npc_id: 'npc_loba', status: 'dead' },
      ] },
        on_done: [{ kind: 'npc_move', npc_id: 'npc_ceniza', spot_id: 'sp_tab_chimenea' }, { kind: 'tell', text: 'Ceniza sale disparado de entre las raíces, cojeando, hacia el pueblo. Sabe el camino a casa mejor que tú.' }] },
    ],
    reward: { coins: 100, reputation: 2, xp: 150 },
    // Brenna se ablanda por la opinión (+10, regla `ceniza_vuelve` en reactions.ts), no a mano.
    on_complete: [
      { kind: 'tell', text: 'Brenna se arrodilla junto a la chimenea con el perro entre los brazos y no dice nada durante un rato. Luego te sirve sin cobrar y, al dejar la jarra, murmura: «Hay cosas que te debo contar. Ahora no».' }],
    on_npc_dead: [
      { npc_id: 'npc_ceniza', outcome: 'fail', why: 'Ceniza murió antes de que pudiéramos sacarlo de la madriguera' },
      { npc_id: 'npc_brenna', outcome: 'fail', why: 'Brenna murió antes de que le devolviéramos el perro' },
    ],
    // El perro no aguanta mucho acorralado: dos descansos largos y es tarde.
    deadline: {
      rests: 2,
      warn: 'Ceniza no aguantará mucho más en la madriguera: si descansamos otra vez, será tarde.',
      lost: 'Nos entretuvimos demasiado: Ceniza no salió vivo de la madriguera.',
      on_lost: [{ kind: 'npc_status', npc_id: 'npc_ceniza', status: 'dead' }],
    },
  },
  {
    id: 'q_tonico_mateo', act: 1, title: 'Un jarabe para el molino', giver_npc_id: 'npc_ilse', level: 1,
    text: 'Mateo, el molinero, tose gris desde hace días y no sube a por su jarabe. Ilse te da un frasco de tónico para que se lo lleves al molino.',
    notes: 'Recado para conocer a Mateo. Al aceptarlo, el PJ recibe un tónico de corteza. Se cumple al dárselo a Mateo en mano (transfer_item a npc_mateo). Mateo lo agradece con uno de sus chistes malos. Luego, de vuelta con Ilse.',
    rumor: { text: 'en la plaza dicen que {giver} anda buscando a alguien con buenas piernas', where: at('loc_plaza') },
    steps: [
      { id: 'llevar', text: 'Darle el tónico al molinero', done_when: { kind: 'npc_has', npc_id: 'npc_mateo', item_id: 'it_tonico' },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_mateo' }, { kind: 'tell', text: 'Mateo destapa el frasco, lo huele, tose y se lo bebe de un trago. Se presenta con la mano llena de harina y empieza un chiste que no termina.' }] },
    ],
    reward: { coins: 20, xp: 75 },
    on_accept: [{ kind: 'give_item', item_id: 'it_tonico' }],
    on_complete: [],
    on_npc_dead: [
      { npc_id: 'npc_mateo', outcome: 'fail', why: 'Mateo murió antes de que le lleváramos el jarabe' },
      { npc_id: 'npc_ilse', outcome: 'fail', why: 'Ilse murió antes de que volviéramos con ella' },
    ],
  },
  {
    id: 'q_harina_hugo', act: 1, title: 'La reja del molino', giver_npc_id: 'npc_mateo', level: 1,
    requires: { kind: 'knows', npc_id: 'npc_mateo' },
    text: 'A la rueda del molino se le ha partido una reja y Mateo no puede dejar las muelas. Pregúntale al herrero, en la herrería de la plaza, para cuándo la tendrá.',
    notes: 'Recado para conocer a Hugo: basta con ir a verle (estar con él). Hugo contesta a golpes, como martillea: la reja, el jueves; y que Mateo le debe dos. Luego, de vuelta con Mateo.',
    steps: [
      { id: 'preguntar', text: 'Preguntarle al herrero para cuándo estará la reja', done_when: { kind: 'talk', npc_id: 'npc_hugo' },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_hugo' }, { kind: 'tell', text: 'El herrero deja el martillo, se limpia la mano en el mandil y dice su nombre como quien escupe una chispa: «Hugo. La reja, el jueves. Y que me debe dos».' }] },
    ],
    reward: { coins: 30, xp: 75 },
    on_complete: [],
    on_npc_dead: [
      { npc_id: 'npc_hugo', outcome: 'fail', why: 'Hugo murió antes de que pudiéramos preguntarle por la reja' },
      { npc_id: 'npc_mateo', outcome: 'fail', why: 'Mateo murió antes de que le lleváramos la respuesta del herrero' },
    ],
  },
  {
    id: 'q_ronda_ursula', act: 1, title: 'La ronda de los Corrales', giver_npc_id: 'npc_doro', level: 1,
    requires: { kind: 'knows', npc_id: 'npc_doro' },
    text: 'Doro no puede dejar su puesto y anoche se oyeron lobos hacia los Corrales. Te pide que vayas a ver si Úrsula, la granjera, está bien, y que vuelvas a contárselo.',
    notes: 'Recado para conocer a Úrsula: mirar la cerca del redil (huellas de lobo junto a un boquete) y hablar con ella (estar con ella). Úrsula está bien, pero mira mucho hacia la niebla. De vuelta, Doro escucha y se pone nervioso cuando oye «niebla».',
    steps: [
      { id: 'cerca', text: 'Mirar la cerca del redil de los Corrales', done_when: { kind: 'visit', spot_id: 'sp_co_redil' },
        on_done: [{ kind: 'tell', text: 'En la cerca del redil falta un palo y el barro está lleno de huellas grandes, de lobo, que vienen de la parte de la niebla.' }] },
      { id: 'ver', text: 'Ir a ver a Úrsula, la granjera de los Corrales', done_when: { kind: 'talk', npc_id: 'npc_ursula' },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_ursula' }, { kind: 'tell', text: 'Úrsula sale del gallinero con una horca en la mano y te mira de arriba abajo antes de bajarla. Dice su nombre como quien da un aviso: está bien, pero no duerme desde lo de la cerca.' }] },
    ],
    reward: { coins: 20, xp: 75 },
    on_complete: [],
    on_npc_dead: [
      { npc_id: 'npc_ursula', outcome: 'fail', why: 'Úrsula murió antes de que fuéramos a verla' },
      { npc_id: 'npc_doro', outcome: 'fail', why: 'Doro murió antes de que le contáramos cómo estaba Úrsula' },
    ],
  },
  {
    id: 'q_huevos_ilse', act: 1, title: 'Lo que no cuesta no sana', giver_npc_id: 'npc_ursula', level: 1,
    requires: { kind: 'knows', npc_id: 'npc_ursula' },
    text: 'Úrsula le debe a la curandera la cura de una quemadura, y la curandera nunca cura sin cobrar algo pequeño. Coge dos huevos del ponedero y llévaselos a Ilse.',
    notes: 'Recado para conocer a Ilse. Los huevos se recogen en el ponedero de los Corrales (harvest). Se cumple al dárselos a Ilse en mano (transfer_item a npc_ilse, los dos). Luego, de vuelta con Úrsula.',
    steps: [
      { id: 'recoger', text: 'Coger dos huevos del ponedero de los Corrales', done_when: { kind: 'carry', item_id: 'it_huevo', quantity: 2 } },
      { id: 'llevar', text: 'Darle los dos huevos a Ilse, la curandera', done_when: { kind: 'npc_has', npc_id: 'npc_ilse', item_id: 'it_huevo', quantity: 2 },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_ilse' }, { kind: 'tell', text: 'Ilse coge los huevos con las manos manchadas de corteza, los mira al trasluz y asiente: «Lo que no cuesta no sana. Dile a Úrsula que estamos en paz. Yo soy Ilse».' }] },
    ],
    reward: { coins: 15, xp: 75 },
    on_complete: [],
    on_npc_dead: [
      { npc_id: 'npc_ilse', outcome: 'fail', why: 'Ilse murió antes de que le lleváramos los huevos' },
      { npc_id: 'npc_ursula', outcome: 'fail', why: 'Úrsula murió antes de que volviéramos con ella' },
    ],
  },
  {
    id: 'q_jarra_hal', act: 1, title: 'Una jarra para el cazador', giver_npc_id: 'npc_hal', level: 1,
    text: 'Hal no pisa el pueblo si puede evitarlo, pero echa de menos la cerveza del Jabalí. Paga a quien le suba una jarra al Soto.',
    notes: 'Pedido para conocer a Hal. La cerveza se compra en la barra del Jabalí (Brenna, 30 monedas). Se cumple cuando el PJ se la da a Hal en mano (transfer_item a npc_hal), y Hal paga en el acto.',
    rumor: { text: 'dicen que {giver}, el que vive en el Soto, anda buscando quien le haga un favor', where: at('loc_taberna') },
    steps: [
      { id: 'jarra', text: 'Llevarle al cazador una cerveza del Jabalí', done_when: { kind: 'npc_has', npc_id: 'npc_hal', item_id: 'it_cerveza' },
        on_done: [{ kind: 'tell', text: 'Hal se bebe media jarra de un trago, se limpia la barba con el dorso de la mano y suelta tres palabras seguidas, que para él es mucho: «Buena. Te debo una».' }] },
    ],
    reward: { coins: 30, xp: 75 },
    on_complete: [],
    on_npc_dead: [{ npc_id: 'npc_hal', outcome: 'fail', why: 'Hal murió antes de que le lleváramos la jarra' }],
  },
  {
    id: 'q_noche', act: 1, title: 'Lo que vio Doro', giver_npc_id: 'npc_doro', level: 2, min_level: 1,
    requires: { kind: 'quest', quest_id: 'q_cena_doro' },
    text: 'Doro, el guardia del portón, se pone nervioso cuando alguien mira hacia el granero viejo. Algo ha visto, y por fin se atreve a decírtelo.',
    notes: 'Doro confiesa las luces del Granero Quemado y la figura de la senda (pista clue_doro) si se le trata bien. La figura es Tobías: cada noche, a las 23:00, cruza el arroyo del Soto hacia el granero (evento «la escapada al granero»). Si el PJ espera allí a esa hora, lo ve con su hatillo. Que lo siga o lo pare es cosa suya. La recompensa, al volver con Doro.',
    rumor: { text: 'en la plaza dicen que {giver}, el del portón, no pega ojo de noche', where: at('loc_plaza') },
    steps: [CONFIANZA_DORO, VIGILAR, QUE_LLEVA],
    reward: { coins: 60, reputation: 1, xp: 150 },
    on_complete: [{ kind: 'learn_place', location_id: 'loc_ruinas' }],
    on_npc_dead: [
      { npc_id: 'npc_doro', outcome: 'reroute', why: 'Doro murió, pero lo que vio sigue pasando: vigilaremos nosotros el arroyo', turn_in_npc_id: null, steps: [VIGILAR, QUE_LLEVA] },
      { npc_id: 'npc_tobias', outcome: 'reroute', why: 'Tobías murió; aún podemos averiguar qué llevaba al granero', steps: [CONFIANZA_DORO, QUE_LLEVA] },
    ],
  },
  // --- Acto II: nivel 2 y el hilo del acto I de quien la da ---------------------
  {
    id: 'q_sotano', act: 2, title: 'Bajo el Jabalí', giver_npc_id: 'npc_brenna', level: 3, min_level: 2,
    requires: { kind: 'quest', quest_id: 'q_perro' },
    text: 'Brenna te confía que lo que pasó en Vharn «está escrito, ahí abajo»: en el sótano de su taberna. Te enseña la trampilla y te pide que bajes a leerlo.',
    notes: 'Al aceptarla, Brenna enseña la trampilla de la mesa del fondo (queda descubierta). El libro de cuentas está en el hueco tras el último barril (oculto, CD 12). Al cogerlo, el servidor concede la pista del libro: apunta la plata entregada a O. Malvez. Brenna pide que no se sepa todavía: tiene miedo de Osric. Al volver con ella, te da la llave de los Vharn (abre la losa del altar del Granero Quemado).',
    rumor: { text: 'en el Jabalí dicen que {giver} quiere hablar contigo a solas', where: at('loc_taberna') },
    steps: [
      { id: 'bajar', text: 'Bajar al sótano del Jabalí', done_when: at('loc_sotano') },
      { id: 'libro', text: 'Encontrar lo que Brenna guarda ahí abajo', done_when: { kind: 'carry', item_id: 'it_libro_cuentas' },
        on_done: [{ kind: 'clue', clue_id: 'clue_libro' }] },
    ],
    reward: { coins: 150, xp: 250, item_id: 'it_llave_vharn' },
    on_accept: [{ kind: 'reveal_spot', spot_id: 'sp_tab_trampilla' },
      { kind: 'tell', text: 'Brenna aparta con el pie la alfombra de la mesa del fondo y deja a la vista una trampilla con una argolla oxidada: «Tras el último barril. Léelo y vuelve. Y que nadie te vea bajar».' }],
    on_complete: [
      { kind: 'npc_attitude_all', npc_id: 'npc_osric', attitude: 'unfriendly' },
      { kind: 'tell', text: 'Brenna mira el libro sin tocarlo. Luego saca del delantal una llave vieja con el sello de Vharn y te la pone en la mano: «La cogí aquella noche, del cinto de la señora. Abre la losa del altar del granero. Yo nunca he tenido valor».' },
      { kind: 'hook', id: 'hk_garran_sotano', location_id: 'loc_taberna', trigger: 'location', what: 'Garrán entra en el Jabalí preguntando en voz alta quién ha andado «moviendo barriles» en casa de Brenna. Alguien se ha ido de la lengua. Busca con la mirada al PJ y se sienta a esperar a que salga.', expires_hours: 48 },
    ],
    // Sin Brenna, el libro sigue ahí abajo: se cumple al encontrarlo (sin la llave, que solo ella podía dar).
    on_npc_dead: [{ npc_id: 'npc_brenna', outcome: 'reroute', why: 'Brenna murió, pero lo que guardaba sigue ahí abajo', turn_in_npc_id: null }],
  },
  {
    id: 'q_cadena', act: 2, title: 'La cadena de hierro frío', giver_npc_id: 'npc_ilse', level: 3, min_level: 2,
    requires: { kind: 'quest', quest_id: 'q_agua' },
    text: 'Ilse dice que un fuego de la Brasa solo se templa con hierro frío, y que el único que queda lo forjó el maestro de Hugo, el herrero.',
    notes: 'Hugo guarda los eslabones bajo la losa suelta (oculta, CD 13; él la enseña si confía: discover_spot). El regidor le ha ordenado fundirlos. Ayudarle con su deuda con Osric (set_debt/settle_debt con Garrán, o enfrentarse a Garrán) lo gana del todo. Al llevar los eslabones a Ilse, ella enseña las palabras que templan el ascua.',
    steps: [
      { id: 'hugo', text: 'Preguntar al herrero por la cadena de su maestro', done_when: { kind: 'all', of: [{ kind: 'clue', clue_id: 'clue_hugo' }, { kind: 'talk', npc_id: 'npc_hugo' }] } },
      { id: 'eslabones', text: 'Conseguir los eslabones de hierro frío', done_when: { kind: 'carry', item_id: 'it_cadena_fria' } },
      { id: 'rito', text: 'Llevarle los eslabones a Ilse para aprender el rito', done_when: { kind: 'all', of: [{ kind: 'carry', item_id: 'it_cadena_fria' }, { kind: 'talk', npc_id: 'npc_ilse' }] },
        on_done: [{ kind: 'tell', text: 'Ilse pasa los dedos por los eslabones fríos y te hace repetir, tres veces, unas palabras en una lengua vieja. «Se dicen con el hierro frío en la mano y el ascua bajo el agua del pozo. Sin soltarlo, aunque queme».' }] },
    ],
    reward: { coins: 150, xp: 300 },
    on_complete: [{ kind: 'attitude', npc_id: 'npc_hugo', attitude: 'friendly' }],
    on_npc_dead: [
      // Caso de la partida del 2026-10-27: Hugo muerto con la misión abierta. Los eslabones siguen bajo su losa.
      { npc_id: 'npc_hugo', outcome: 'reroute', why: 'Hugo murió antes de enseñarnos los eslabones, pero siguen escondidos en su herrería', steps: [
        { id: 'buscar', text: 'Buscar los eslabones en la herrería', done_when: { kind: 'carry', item_id: 'it_cadena_fria' }, journal: 'Encontramos los eslabones bajo la losa de la herrería de Hugo.' },
        { id: 'rito_sin_hugo', text: 'Llevarle los eslabones a Ilse para aprender el rito', done_when: { kind: 'all', of: [{ kind: 'carry', item_id: 'it_cadena_fria' }, { kind: 'talk', npc_id: 'npc_ilse' }] },
          on_done: [{ kind: 'tell', text: 'Ilse pasa los dedos por los eslabones fríos y no pregunta de dónde los has sacado. Te hace repetir, tres veces, unas palabras en una lengua vieja: «Con el hierro frío en la mano y el ascua bajo el agua del pozo. Sin soltarlo, aunque queme».' }] },
      ] },
      { npc_id: 'npc_ilse', outcome: 'fail', why: 'Ilse murió, y con ella las palabras que templan el ascua' },
    ],
    // Un hito, no horas: cuando Garrán clava la herrería (la amenaza), los eslabones quedan dentro.
    deadline: {
      milestone: { kind: 'escalated', id: 'esc_herreria' },
      warn_when: { kind: 'world_hours', at_least: 48 },
      warn: 'Garrán ronda la herrería con tablas y clavos: si no sacamos pronto los eslabones, la cerrará.',
      lost: 'Garrán clavó la herrería antes de que sacáramos los eslabones.',
    },
  },
  {
    id: 'q_tobias', act: 2, title: 'El hijo del molinero', giver_npc_id: 'npc_mateo', level: 3, min_level: 2,
    requires: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_noche' }, { kind: 'clue', clue_id: 'clue_tobias' }] },
    text: 'Tobías, el hijo del molinero, sale de noche y vuelve con las uñas negras. Mateo no quiere saberlo, pero tose gris como todos y te pide que hables con él.',
    notes: 'Con las cartas o la bolsa de ceniza delante, Tobías confiesa (CD 12; sin ellas, CD 15): echa al pozo ceniza de las grietas del altar por encargo de «la señora del granero», que le ha prometido hacerle señor de Vharn. Pararlo cura poco a poco el pozo y frena la tos gris. Si se le humilla delante de su padre o se le entrega a Garrán, se esconde en el Granero Quemado. La recompensa, al volver con Mateo.',
    rumor: { text: 'en el molino dicen que {giver} quiere hablar con alguien de fuera del pueblo', where: at('loc_molino') },
    steps: [
      { id: 'confesar', text: 'Hacer que Tobías cuente lo que hace de noche', done_when: { kind: 'narrative', how: 'cuando Tobías confiese que echa ceniza al pozo por encargo de la mujer del granero (Persuasión/Intimidación CD 15, CD 12 con las cartas o la bolsa delante)' } },
      { id: 'parar', text: 'Que deje de echar ceniza al pozo', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando Tobías prometa parar de verdad, o el PJ le quite la bolsa de ceniza y lo deje en manos de su padre' },
        { kind: 'npc_has', npc_id: 'npc_mateo', item_id: 'it_bolsa_ceniza' },
      ] },
        on_done: [
          { kind: 'cancel_schedule', event_id: 'se_tobias' },
          { kind: 'npc_routine', npc_id: 'npc_tobias', routine: { day: 'sp_mo_sacos', night: 'sp_mo_sacos' } },
          { kind: 'spot_state', spot_id: 'sp_pl_pozo', patch: { agua: 'aclarándose: ya no trae ceniza nueva' } },
        ] },
    ],
    reward: { coins: 150, reputation: 2, xp: 250 },
    on_complete: [{ kind: 'attitude', npc_id: 'npc_mateo', attitude: 'allied' }, { kind: 'learn_place', location_id: 'loc_ruinas' },
      { kind: 'rumor', id: 'rm_tobias', location_id: 'loc_plaza', rumor_kind: 'person', name: 'El chico del molino', hint: 'el hijo de Mateo andaba con los del granero y alguien le ha hecho entrar en razón', where: 'el molino', days: 10 }],
    on_npc_dead: [
      { npc_id: 'npc_tobias', outcome: 'fail', why: 'Tobías murió antes de que pudiéramos hacerle entrar en razón' },
      { npc_id: 'npc_mateo', outcome: 'reroute', why: 'Mateo murió, pero su hijo sigue echando ceniza al pozo', turn_in_npc_id: null },
    ],
  },
  {
    id: 'q_subida', act: 2, title: 'El Granero Quemado', giver_npc_id: 'npc_hal', level: 3, min_level: 2,
    requires: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_noche' }, { kind: 'quest', quest_id: 'q_perro' }] },
    text: 'Hal dice que el granero viejo de los Vharn «no está tan vacío como dicen». Alguien tiene que ir a ver quién enciende las luces.',
    notes: 'Hal le lleva caza a «la mujer del granero» y le paga con plata del sello (pista clue_hal, si se le gana). Desde la torre del reloj de la casona o el tejado del molino se ve el humo del granero y la niebla alrededor de todo. Se llega por la senda del arroyo del Soto. En el granero se esconde Ysolde: no ataca de entrada, pregunta quién te manda. Si el PJ la escucha, cuenta quién es (pista clue_ysolde). La recompensa, al volver con Hal.',
    rumor: { text: 'dicen que {giver}, el del Soto, ha visto algo que no quiere contar en el pueblo', where: at('loc_claro') },
    steps: [
      { id: 'mirador', text: 'Subir a la torre del reloj o al tejado del molino y mirar', done_when: { kind: 'any', of: [{ kind: 'visit', spot_id: 'sp_ca_torre' }, { kind: 'visit', spot_id: 'sp_mo_tejado' }] },
        on_done: [{ kind: 'tell', text: 'Desde arriba, Brezal es un puñado de tejados dentro de un anillo de niebla gris que no se mueve. En el Granero Quemado, entre los alisos, hay un fuego encendido a plena luz.' }] },
      { id: 'ruinas', text: 'Llegar al Granero Quemado', done_when: at('loc_ruinas') },
      { id: 'ysolde', text: 'Encontrar a quien enciende las luces', done_when: { kind: 'clue', clue_id: 'clue_ysolde' },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_ysolde' }] },
    ],
    reward: { coins: 200, xp: 300 },
    on_complete: [],
    on_npc_dead: [{ npc_id: 'npc_hal', outcome: 'reroute', why: 'Hal murió, pero alguien sigue encendiendo luces en el granero', turn_in_npc_id: null }],
  },
  // --- Acto III: finales que se excluyen (nivel 3) ------------------------------
  {
    id: 'q_final_templar', act: 3, title: 'Templar el ascua', giver_npc_id: 'npc_ilse', turn_in_npc_id: null, exclusive: 'final', level: 4, min_level: 3,
    requires: { kind: 'all', of: [{ kind: 'quest', quest_id: 'q_cadena' }, { kind: 'quest', quest_id: 'q_subida' }] },
    text: 'La Brasa grande está enterrada, pero Ysolde lleva un ascua suya en el guante. Con los eslabones de hierro frío y las palabras de Ilse, alguien puede templarla en el agua fría del pozo.',
    notes: 'Final de restauración. El ascua llega al pozo si Ysolde acepta bajarla (le han enseñado el libro de cuentas, o Persuasión CD 15) o si se la quitan (combate: CA 12, 22 PG, 2d6 de fuego). En el pozo, con los eslabones sujetos, templar pide Atletismo o Arcanos CD 14; cada fallo, 2d6 de fuego (apply_damage) y se puede repetir. Ilse ayuda si es la hora de la misa. Templarla apaga la tos y afloja el Cerco, pero no lo abre.',
    steps: [
      { id: 'ascua', text: 'Llevar el ascua de Ysolde al pozo', done_when: { kind: 'any', of: [
        { kind: 'spot_state', spot_id: 'sp_pl_pozo', key: 'ascua', value: true },
        { kind: 'narrative', how: 'cuando el ascua llegue al pozo: Ysolde acepta bajarla (le han enseñado el libro de cuentas, o Persuasión CD 15) o el PJ se la quita (combate: CA 12, 22 PG, 2d6 de fuego)' },
        { kind: 'npc_status', npc_id: 'npc_ysolde', status: 'dead' },
      ] },
        on_done: [{ kind: 'spot_state', spot_id: 'sp_pl_pozo', patch: { ascua: true } },
          { kind: 'tell', text: 'El ascua descansa en un cuenco de hierro sobre el brocal del pozo. Late como un corazón pequeño y el agua del cubo humea.' }] },
      { id: 'pozo', text: 'Estar en el pozo con los eslabones de hierro frío', done_when: { kind: 'all', of: [{ kind: 'carry', item_id: 'it_cadena_fria' }, { kind: 'visit', spot_id: 'sp_pl_pozo' }] } },
      { id: 'templar', text: 'Templar el ascua en el agua fría', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando el PJ, en el pozo, sumerja el ascua con los eslabones sujetos y diga las palabras de Ilse (Atletismo o Arcanos CD 14; cada fallo, 2d6 de fuego)' },
        { kind: 'spot_state', spot_id: 'sp_pl_pozo', key: 'templado', value: true },
      ] } },
    ],
    reward: { coins: 1000, reputation: 3, xp: 700 },
    ending: 'El ascua de Ysolde se apagó en el agua fría del pozo con un silbido que se oyó en todo Brezal. Al tercer día el agua bajó clara y la tos gris se fue. Dicen que fue {name} quien la sujetó bajo el agua con las manos quemadas. La niebla sigue en el Lindero.',
    on_complete: [
      { kind: 'spot_state', spot_id: 'sp_pl_pozo', patch: { templado: true, ascua: 'apagada, negra como un carbón frío', agua: 'clara y fría' } },
      { kind: 'location_state', location_id: 'loc_plaza', patch: { pozo: 'el agua baja clara otra vez' } },
      { kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_ru_capilla' },
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Del pozo sube un silbido largo y una nube de vapor blanco. Cuando se aclara, el agua del cubo sale fría y el aire deja de oler a azufre.', public: true },
    ],
  },
  {
    id: 'q_final_verdad', act: 3, title: 'La verdad en el pozo', giver_npc_id: 'npc_brenna', turn_in_npc_id: null, exclusive: 'final', level: 4, min_level: 3,
    requires: { kind: 'all', of: [{ kind: 'quest', quest_id: 'q_sotano' }, { kind: 'clue', clue_id: 'clue_ysolde' }] },
    text: 'Brenna vio quién prendió el fuego. Ysolde cree que fue ella. Si las dos hablan delante de Brezal en la misa del pozo, el valle sabrá la verdad.',
    notes: 'Final de justicia. Brenna habla en público si el PJ le enseña el libro y le promete protegerla (Persuasión CD 14, ventaja si Ceniza volvió). Ysolde baja a la misa si el PJ le ha enseñado el libro o la convence (Persuasión CD 15). La misa es a las 20:00 en el pozo; si los tres están allí, Brezal lo oye. Osric intenta huir esa misma noche, pero del valle no sale nadie: se esconde en el pueblo (la bodega tapiada de la casona). Garrán no le sigue.',
    steps: [
      { id: 'brenna', text: 'Convencer a Brenna de hablar delante de todos', done_when: { kind: 'narrative', how: 'cuando Brenna acepte contar en la misa del pozo lo que vio (Persuasión CD 14 con el libro delante; ventaja si Ceniza volvió a casa)' } },
      { id: 'ysolde', text: 'Traer a Ysolde a la misa del pozo', done_when: { kind: 'narrative', how: 'cuando Ysolde acepte ir a escuchar (le han enseñado el libro de cuentas, o Persuasión CD 15)' },
        on_done: [{ kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_pl_pozo' }, { kind: 'tell', text: 'Ysolde sale del granero de noche, con la capucha echada y el ascua apagada en el guante. Se queda junto al pozo, quieta, a esperar la misa.' }] },
      { id: 'misa', text: 'Que Brezal lo oiga en la misa del pozo', done_when: { kind: 'all', of: [{ kind: 'visit', spot_id: 'sp_pl_pozo' }, { kind: 'npc_at', npc_id: 'npc_brenna', spot_id: 'sp_pl_pozo' }, { kind: 'npc_at', npc_id: 'npc_ysolde', spot_id: 'sp_pl_pozo' }] } },
    ],
    reward: { coins: 800, reputation: 4, xp: 700 },
    ending: 'En la misa del pozo Brenna contó lo que vio la noche de Vharn y el libro de cuentas pasó de mano en mano. Osric Malvez quiso huir antes del alba, pero la niebla no deja salir a nadie: está escondido en algún sitio de Brezal. Ysolde dejó que la Brasa durmiera y Brezal sabe ahora a quién se lo debe: a {name}.',
    on_complete: [
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Junto al pozo, con una vela en la mano, Brenna cuenta en voz alta lo que vio la noche del incendio. Nadie reza. Ysolde, a su lado, se quita el guante: el ascua se ha apagado.', public: true },
      { kind: 'npc_status', npc_id: 'npc_osric', status: 'missing', hideout_spot_id: 'sp_ca_bodega' },
      { kind: 'npc_attitude_all', npc_id: 'npc_ysolde', attitude: 'friendly' },
      { kind: 'npc_attitude_all', npc_id: 'npc_garran', attitude: 'neutral' },
      { kind: 'location_state', location_id: 'loc_casona', patch: { abandonada: 'la casona está vacía y con la puerta abierta; hay quien jura haber oído toser detrás de un tabique' } },
    ],
    on_npc_dead: [
      { npc_id: 'npc_brenna', outcome: 'fail', why: 'Brenna murió, y con ella la única que vio quién prendió el fuego' },
      { npc_id: 'npc_ysolde', outcome: 'fail', why: 'Ysolde murió antes de poder oír la verdad' },
    ],
  },
  {
    id: 'q_final_arder', act: 3, title: 'Que arda Vharn', giver_npc_id: 'npc_ysolde', turn_in_npc_id: null, exclusive: 'final', level: 4, min_level: 3,
    requires: { kind: 'clue', clue_id: 'clue_ysolde' },
    text: 'Ysolde quiere al mayordomo que quemó su casa. Si se lo entregas, soltará el ascua sobre lo que él construyó con la plata robada.',
    notes: 'Final oscuro, para quien se pone del lado de la heredera. Entregarle a Osric (llevarlo al granero atado o engañado, o que muera) y dejarla, o ayudarla, a soltar el ascua en la plaza, junto a la casona. El fuego prende la casona y media aldea; con el Cerco cerrado el humo no sale del valle y lo paga toda Brezal. Ysolde queda como señora de unas ruinas.',
    steps: [
      { id: 'osric', text: 'Entregar a Ysolde al mayordomo de su padre', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando Osric quede en manos de Ysolde: llevado al granero atado o engañado, o entregado a la fuerza' },
        { kind: 'npc_status', npc_id: 'npc_osric', status: 'dead' },
      ] } },
      { id: 'soltar', text: 'Dejar que Ysolde suelte el ascua en la plaza', done_when: { kind: 'narrative', how: 'cuando, en la plaza, Ysolde deje caer el ascua junto al pozo y el PJ la deje hacerlo o la ayude' } },
    ],
    reward: { coins: 500, xp: 450 },
    ending: 'Ysolde soltó el ascua en la plaza. La casona del regidor ardió hasta los cimientos y con ella media aldea, y el humo no encontró por dónde salir del valle. Ysolde es señora de unas ruinas que no se enfrían, y en Brezal nadie pronuncia el nombre de {name} sin escupir al suelo.',
    on_complete: [
      { kind: 'spot_state', spot_id: 'sp_pl_pozo', patch: { ascua: 'suelta: un sol pequeño en el empedrado que no deja mirar' } },
      { kind: 'location_state', location_id: 'loc_casona', patch: { incendio: 'la casona arde por los cuatro costados' } },
      { kind: 'location_state', location_id: 'loc_plaza', patch: { cielo: 'rojo; el humo no sale del valle y se queda bajo la niebla, escociendo los ojos' } },
      { kind: 'npc_status', npc_id: 'npc_osric', status: 'dead' },
      { kind: 'npc_attitude_all', npc_id: 'npc_brenna', attitude: 'hostile' },
      { kind: 'announce', location_id: 'loc_plaza', text: 'El ascua cae en el empedrado y se abre como una flor de fuego. El tejado de la casona prende de golpe; el humo sube, choca con la niebla y vuelve a bajar sobre Brezal.', public: true },
    ],
    on_npc_dead: [{ npc_id: 'npc_ysolde', outcome: 'fail', why: 'Ysolde murió, y su ascua con ella' }],
  },
  // --- Misión principal: un problema con varias pistas (como «Find a Cure» de Baldur's Gate 3) -----
  // Cada pista aparece en el Diario cuando alguien la menciona o algo la abre (revealed_by); se siguen en cualquier
  // orden y todas llevan al Granero Quemado, que cierra el acto, y de ahí al final.
  {
    id: 'q_main_carta', act: 1, title: 'La carta de Vharn', giver_npc_id: null, turn_in_npc_id: null, main_for: ['sit_carta', 'sit_carta_companero'], level: 1, any_order: true,
    text: 'Una carta lacrada con el sello de Vharn, una casa que ardió hace veinte años, trajo a Brezal a quien la recibió, y el valle ya no deja salir a nadie. ¿Quién la escribió y qué es la Brasa?',
    notes: 'Misión principal de quien llegó por la carta (y de quien viaja con él): un problema con pistas. Avanzan solas con lo que pase en las demás misiones: no las empujes tú ni les pongas pasos.',
    steps: [
      { id: 'sello', text: 'Preguntar a Ilse por el sello de Vharn', optional: true, revealed_by: { kind: 'knows', npc_id: 'npc_ilse' }, done_when: { kind: 'clue', clue_id: 'clue_ilse' },
        journal: 'Ilse nos contó qué es la Brasa: un fuego antiguo que los Vharn ataban en su cripta.' },
      { id: 'pozo', text: 'Mirar de cerca el agua del pozo', optional: true, revealed_by: at('loc_plaza'), done_when: { kind: 'clue', clue_id: 'clue_pozo' },
        journal: 'El agua del pozo trae ceniza fina y huele a azufre.' },
      { id: 'vharn', text: 'Preguntar a Brenna qué pasó en Vharn la noche del incendio', optional: true, revealed_by: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_ilse' }, { kind: 'quest', quest_id: 'q_perro' }] },
        done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_brenna' }, { kind: 'clue', clue_id: 'clue_libro' }] },
        journal: 'Brenna estuvo en Vharn la noche del incendio, y no fue un accidente.' },
      { id: 'luces', text: 'Preguntar al guardia del portón por las luces del granero', optional: true, revealed_by: { kind: 'knows', npc_id: 'npc_doro' }, done_when: { kind: 'clue', clue_id: 'clue_doro' },
        journal: 'Doro ha visto luces en el Granero Quemado y una figura por la senda.' },
      { id: 'cadena', text: 'Preguntar al herrero por la cadena de su maestro', optional: true, revealed_by: { kind: 'clue', clue_id: 'clue_ilse' }, done_when: { kind: 'clue', clue_id: 'clue_hugo' },
        journal: 'Hugo guarda los últimos eslabones de hierro frío que forjó su maestro.' },
      { id: 'granero', text: 'Ir al Granero Quemado y averiguar quién enciende las luces',
        revealed_by: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_doro' }, { kind: 'clue', clue_id: 'clue_ilse' }, { kind: 'clue', clue_id: 'clue_hal' }, { kind: 'clue', clue_id: 'clue_tobias' }] },
        done_when: { kind: 'clue', clue_id: 'clue_ysolde' },
        journal: 'En el Granero Quemado vive Ysolde, la heredera de Vharn, con un ascua de la Brasa en el guante.' },
      { ...FINAL_STEP, revealed_by: { kind: 'clue', clue_id: 'clue_ysolde' } },
    ],
    reward: { reputation: 2, xp: 300 },
    on_complete: [],
  },
  {
    id: 'q_main_herrero', act: 1, title: 'Lo que dejó tu padre', giver_npc_id: null, turn_in_npc_id: null, main_for: ['sit_herrero'], level: 1, any_order: true,
    text: 'Tu padre fue el herrero de Vharn y murió en el incendio. Hugo, su aprendiz, dice que dejó algo para ti y que no fue el fuego lo que lo mató. ¿Quién lo mató?',
    notes: 'Misión principal del hijo del herrero de Vharn: un problema con pistas. Avanzan solas con lo que pase en las demás misiones: no las empujes tú ni les pongas pasos.',
    steps: HERRERO_STEPS,
    reward: { reputation: 2, xp: 300 },
    on_complete: [],
  },
  {
    id: 'q_main_escolta', act: 1, title: 'Lo prometido', giver_npc_id: null, turn_in_npc_id: null, main_for: ['sit_herrero_companero'], level: 1, any_order: true,
    text: 'Cubres la espalda a quien te pagó el viaje hasta Brezal, el hijo del herrero de Vharn. Cobrarás cuando sepa qué le pasó a su padre, si la niebla os deja salir.',
    notes: 'Misión principal del compañero del hijo del herrero: las mismas pistas. Avanzan solas con lo que pase en las demás misiones: no las empujes tú ni les pongas pasos.',
    steps: HERRERO_STEPS,
    reward: { reputation: 2, xp: 300 },
    on_complete: [],
  },
  {
    id: 'q_main_deuda', act: 1, title: 'La deuda con el regidor', giver_npc_id: null, turn_in_npc_id: null, main_for: ['sit_deuda'], level: 1, any_order: true,
    text: 'Debes trescientas monedas de cama, comida y curandera, y el regidor ha comprado la deuda. O pagas en tres días o te mandan al Granero Quemado a «apagar las luces». ¿Qué hay en ese granero?',
    notes: 'Misión principal del deudor: un problema con pistas. Avanzan solas con lo que pase en las demás misiones: no las empujes tú ni les pongas pasos.',
    steps: [
      { id: 'pagar', text: 'Librarte de la deuda con Garrán', done_when: { kind: 'any', of: [{ kind: 'debt_paid', npc_id: 'npc_garran' }, { kind: 'npc_status', npc_id: 'npc_garran', status: 'dead' }] },
        journal: 'Ya no le debemos nada a Garrán.' },
      { id: 'luces', text: 'Preguntar al guardia del portón por las luces del granero', optional: true, revealed_by: { kind: 'knows', npc_id: 'npc_doro' }, done_when: { kind: 'clue', clue_id: 'clue_doro' },
        journal: 'Doro ha visto luces en el Granero Quemado y una figura por la senda.' },
      { id: 'hal', text: 'Preguntar al cazador del Soto qué hay en el granero', optional: true, revealed_by: { kind: 'any', of: [at('loc_claro'), { kind: 'knows', npc_id: 'npc_hal' }] }, done_when: { kind: 'clue', clue_id: 'clue_hal' },
        journal: 'Hal le lleva caza a una mujer que vive en el granero y le paga con plata vieja.' },
      { id: 'granero', text: 'Ir al Granero Quemado y averiguar quién enciende las luces', revealed_by: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_doro' }, { kind: 'clue', clue_id: 'clue_hal' }, { kind: 'quest', quest_id: 'q_perro' }] },
        done_when: { kind: 'clue', clue_id: 'clue_ysolde' },
        journal: 'En el Granero Quemado vive Ysolde, la heredera de Vharn. El regidor quiere que alguien «apague» eso.' },
      { ...FINAL_STEP, revealed_by: { kind: 'clue', clue_id: 'clue_ysolde' } },
    ],
    reward: { reputation: 2, xp: 300 },
    on_complete: [],
  },
];

const ESCALATION: StoryEscalation[] = [
  {
    id: 'esc_tos', title: 'La tos gris', after_hours: 10,
    unless: { kind: 'quest', quest_id: 'q_tobias' },
    location_id: 'loc_plaza', spot_id: 'sp_pl_pozo',
    text: 'Junto al pozo una mujer tose y escupe gris; su crío también. Alguien grita que el agua está maldita y dos vecinos empiezan a discutir a empujones.',
    effects: [
      { kind: 'location_state', location_id: 'loc_plaza', patch: { tos: 'media aldea tose gris; hay cola en casa de la curandera' } },
      { kind: 'rumor', id: 'rm_maldicion', location_id: 'loc_plaza', rumor_kind: 'rumor', name: 'La maldición del pozo', hint: 'los de Vharn han maldecido el agua desde la tumba, y la niebla es la tapa', where: 'el pozo', days: 10 },
    ],
  },
  {
    id: 'esc_lobos', title: 'Los lobos bajan a los Corrales', after_hours: 20,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_perro' }, { kind: 'npc_status', npc_id: 'npc_loba', status: 'dead' }] },
    location_id: 'loc_corrales', spot_id: 'sp_co_gallinero',
    text: 'Los lobos han saltado la cerca de los Corrales: el gallinero reventado, plumas por todas partes, dos ovejas muertas en el redil y huellas enormes, de ceniza, en la cancela. Úrsula está en medio con una horca en la mano.',
    effects: [
      { kind: 'location_state', location_id: 'loc_corrales', patch: { gallinero: 'reventado; quedan cuatro gallinas y dos ovejas muertas en el redil' } },
      { kind: 'npc_move', npc_id: 'npc_lobo', spot_id: 'sp_co_redil' },
      { kind: 'rumor', id: 'rm_lobos', location_id: 'loc_taberna', rumor_kind: 'rumor', name: 'La loba de ceniza', hint: 'una loba grande como un poni manda a los lobos y humea al andar; la niebla la ha dejado dentro con nosotros', where: 'el Soto, en una madriguera al pie del roble', days: 10 },
    ],
  },
  {
    id: 'esc_tobias', title: 'Tobías se esconde en el granero', after_hours: 34,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_tobias' }, { kind: 'clue', clue_id: 'clue_tobias' }] },
    location_id: 'loc_molino', spot_id: 'sp_mo_muelas',
    text: 'Mateo da voces por el molino: Tobías no ha vuelto esta mañana y en el desván falta su manta.',
    effects: [
      { kind: 'npc_move', npc_id: 'npc_tobias', spot_id: 'sp_ru_patio' },
      { kind: 'cancel_schedule', event_id: 'se_tobias' },
    ],
  },
  {
    id: 'esc_herreria', title: 'Garrán clava la herrería', after_hours: 54,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_cadena' }, { kind: 'carry', item_id: 'it_cadena_fria' }] },
    location_id: 'loc_plaza', spot_id: 'sp_pl_herreria',
    text: 'Garrán clava dos tablas en cruz sobre la puerta de la herrería y cuelga el sello del regidor. Hugo mira desde la puerta del Jabalí sin decir nada.',
    effects: [
      { kind: 'exit_state', exit_id: 'ex_plaza_herreria', patch: { blocked_by: 'dos tablas clavadas en cruz con el sello del regidor' } },
      { kind: 'npc_move', npc_id: 'npc_hugo', spot_id: 'sp_tab_mesa' },
    ],
  },
  {
    id: 'esc_brasa', title: 'La noche de la Brasa', after_hours: 72,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_final_templar' }, { kind: 'quest', quest_id: 'q_final_verdad' }, { kind: 'quest', quest_id: 'q_final_arder' }] },
    location_id: 'loc_plaza',
    text: 'Es la noche de la Brasa. Del Granero Quemado sube una columna de chispas que choca con la niebla y cae sobre Brezal como ceniza caliente. Ysolde cruza la plaza con el ascua desnuda en la mano.',
    effects: [
      // Escena tensa (scene.ts): con dos o más jugadores en la plaza, se juega por rondas.
      { kind: 'location_state', location_id: 'loc_plaza', patch: { cielo: 'rojo bajo la niebla; cae ceniza caliente que no sale del valle', tense: true, tense_reason: 'la noche de la Brasa' } },
      { kind: 'spot_state', spot_id: 'sp_ru_cripta', patch: { despierta: true, brillo: 'blanco, como hierro en la fragua' } },
      { kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_pl_pozo' },
      { kind: 'hook', id: 'hk_brasa_tejados', location_id: 'loc_plaza', trigger: 'time', minutes: 30, what: 'La ceniza ardiente prende el tejado de paja de una casa junto al pozo. Hay gente dentro. Quien esté en la plaza tiene que decidir ya: cubos, gritos o correr. Ysolde, junto al pozo, mira la casona.', expires_hours: 6 },
      { kind: 'announce', location_id: 'loc_taberna', text: 'Por la ventana del Jabalí entra una luz roja. Alguien abre la puerta y la cierra enseguida: llueve ceniza caliente.' },
    ],
  },
  // --- Epílogo: al amanecer del día 6 (108 h), pase lo que pase -----------------
  {
    id: 'esc_epilogo_templar', title: 'La niebla se retira un paso', after_hours: 108,
    unless: { kind: 'not', of: { kind: 'quest', quest_id: 'q_final_templar' } },
    location_id: 'loc_lindero', spot_id: 'sp_li_niebla',
    text: 'La niebla se ha retirado un paso: el mojón de Vharn, que ayer quedaba en el borde, hoy está limpio de ceniza y frío al tacto.',
    effects: [
      { kind: 'location_state', location_id: 'loc_plaza', patch: { tense: false } },
      { kind: 'spot_state', spot_id: 'sp_li_niebla', patch: { retirada: 'un paso' } },
      { kind: 'spot_state', spot_id: 'sp_cs_mojon', patch: { frio: true } },
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Corre por la plaza que la niebla del Lindero se ha retirado un paso esta noche.', public: true },
    ],
  },
  {
    id: 'esc_epilogo_verdad', title: 'Una voz al otro lado', after_hours: 108,
    unless: { kind: 'not', of: { kind: 'quest', quest_id: 'q_final_verdad' } },
    location_id: 'loc_lindero', spot_id: 'sp_li_niebla',
    text: 'Desde dentro de la niebla llega una voz, lejos, al otro lado, que llama a alguien por su nombre.',
    effects: [
      { kind: 'location_state', location_id: 'loc_plaza', patch: { tense: false } },
      { kind: 'spot_state', spot_id: 'sp_li_niebla', patch: { voz: 'se oye una voz al otro lado' } },
      { kind: 'announce', location_id: 'loc_corrales', spot_id: 'sp_co_casa', text: 'Úrsula sale corriendo hacia la cerca de atrás: dice que ha oído a Pol llamarla desde la niebla.', public: true },
    ],
  },
  {
    id: 'esc_epilogo_arder', title: 'La niebla roja', after_hours: 108,
    unless: { kind: 'not', of: { kind: 'quest', quest_id: 'q_final_arder' } },
    location_id: 'loc_lindero', spot_id: 'sp_li_niebla',
    text: 'La niebla del Lindero se ha vuelto roja, del color del humo que no pudo salir del valle.',
    effects: [
      { kind: 'location_state', location_id: 'loc_plaza', patch: { tense: false } },
      { kind: 'spot_state', spot_id: 'sp_li_niebla', patch: { color: 'roja' } },
      { kind: 'location_state', location_id: 'loc_lindero', patch: { niebla: 'roja como el humo' } },
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Por encima de los tejados del norte, la niebla se ve roja.', public: true },
    ],
  },
  {
    id: 'esc_epilogo', title: 'Brezal sigue sellada', after_hours: 108,
    // Solo se evitaría si el Cerco se abriera (la expansión).
    unless: { kind: 'spot_state', spot_id: 'sp_li_niebla', key: 'abierta' },
    location_id: 'loc_lindero', spot_id: 'sp_li_niebla',
    text: 'Amanece el sexto día. La niebla del Lindero está donde estaba, quieta, sin olor.',
    effects: [
      { kind: 'location_state', location_id: 'loc_plaza', patch: { tense: false } },
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Amanece el sexto día. Ilse sube al tejado del molino, mira la niebla un rato largo y dice: «Cambia. Pero sigue cerrada». Brezal sigue sellada. La Guarda de Vharn tiene más nudos.', public: true },
      { kind: 'rumor', id: 'rm_guarda', location_id: 'loc_plaza', rumor_kind: 'place', name: 'La Guarda de Vharn', hint: 'Ilse dice que la niebla es un cerrojo con más de un nudo, y que alguno está fuera del valle', where: 'el Lindero y más allá', days: 30 },
    ],
  },
];

export const STORY: Story = { quests: QUESTS, escalation: ESCALATION };
