/**
 * Brezal sellada: la historia en tres actos (src/engine/story.ts).
 *
 *   Acto I · Lo que trae el agua: tres hilos cortos que abren el mundo (la
 *   ceniza del pozo, el perro de Brenna, las luces que vio Doro).
 *   Acto II · Lo que esconde Brezal: el sótano, la cadena, el hijo del
 *   molinero y el Granero Quemado.
 *   Acto III · La noche de la Brasa: tres finales que se excluyen (templar el
 *   ascua, la verdad en el pozo, que arda Vharn).
 *
 * La amenaza avanza sola si nadie interviene, en tres días: la tos gris, los
 * lobos en los Corrales, Tobías que se esconde, la herrería clavada y la
 * noche de la Brasa. Al amanecer del día 6, pase lo que pase, el epílogo: la
 * niebla sigue ahí.
 */

import type { Story, StoryEscalation, StoryQuest } from '../../../engine/story.js';

const QUESTS: StoryQuest[] = [
  // --- Acto I ------------------------------------------------------------------
  {
    id: 'q_agua', act: 1, title: 'Ceniza en el agua', giver_npc_id: 'npc_ilse',
    text: 'El agua del pozo de Brezal baja turbia y tibia, y media aldea tose gris. Alguien debería llevarle una muestra a Ilse, la curandera.',
    notes: 'Primer hilo: lleva a Ilse y a la Brasa. El agua del pozo se puede coger (it_agua_pozo, en el pozo). Cuando el PJ le dé el agua a Ilse (transfer_item a npc_ilse; o advance_story si se la enseña sin soltarla), el servidor concede la pista de la Brasa y ella explica qué es y cómo se ata: interprétala con su voz de rezo y cocina.',
    opens_when: { kind: 'any', of: [{ kind: 'at_location', location_id: 'loc_plaza' }, { kind: 'knows', npc_id: 'npc_ilse' }, { kind: 'clue', clue_id: 'clue_pozo' }] },
    heard: 'Junto al pozo, los vecinos tosen gris y se quejan del agua: alguien debería llevársela a Ilse, la curandera',
    steps: [
      { id: 'mirar', text: 'Sacar agua del pozo y mirarla de cerca', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_pozo' }, { kind: 'carry', item_id: 'it_agua_pozo' }] } },
      // Se da al dársela (o enseñársela) a Ilse, no al cruzar su puerta: lo que ella dice luego tiene que pasar delante.
      { id: 'ilse', text: 'Llevarle el agua a Ilse, la curandera', done_when: { kind: 'any', of: [
        { kind: 'npc_has', npc_id: 'npc_ilse', item_id: 'it_agua_pozo' },
        { kind: 'narrative', how: 'cuando el PJ le enseñe a Ilse el agua del pozo sin dársela (si se la da, lo detecta el servidor)' },
      ] },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_ilse' }, { kind: 'clue', clue_id: 'clue_ilse' }, { kind: 'attitude', npc_id: 'npc_ilse', attitude: 'friendly' },
          { kind: 'tell', text: 'Ilse huele el agua, la prueba con la punta de la lengua y escupe: «Esto no es ceniza de hogar. Es de la cripta. La Brasa respira otra vez».' }] },
    ],
    reward: { coins: 300, xp: 50 },
    on_complete: [{ kind: 'learn_place', location_id: 'loc_ruinas' }],
  },
  {
    id: 'q_perro', act: 1, title: 'Ceniza se ha perdido', giver_npc_id: 'npc_brenna',
    text: 'Se ha perdido Ceniza, el perro de Brenna: pardo, una oreja rota. Lo vieron por el Soto, detrás de un olor. Quien lo traiga cobra.',
    notes: 'El perro está en la madriguera al pie del roble del Soto, acorralado por la loba de ceniza (hostil, dura para un nivel 1: que el PJ piense antes de pelear; tampoco ella puede salir del valle). Se puede sacar ahuyentándola con fuego, colándose (Sigilo CD 13 mientras duerme), llevando encima ceniza del granero (no ataca a quien la lleva) o matándola. Brenna se ablanda mucho al recuperarlo.',
    opens_when: { kind: 'any', of: [{ kind: 'knows', npc_id: 'npc_brenna' }, { kind: 'at_location', location_id: 'loc_taberna' }] },
    heard: 'En el Jabalí se comenta que a Brenna se le ha perdido el perro y que paga a quien se lo traiga',
    steps: [
      { id: 'rastro', text: 'Buscar el rastro del perro en el Soto', done_when: { kind: 'at_location', location_id: 'loc_claro' },
        on_done: [{ kind: 'tell', text: 'En el barro del Soto, entre botas, hay huellas de perro que van hacia el pie del roble, y al lado otras enormes, de lobo.' }] },
      { id: 'lobera', text: 'Encontrar a Ceniza en la madriguera', done_when: { kind: 'visit', spot_id: 'sp_cs_cueva' } },
      { id: 'sacar', text: 'Sacarlo de la madriguera', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando el PJ saque al perro de la madriguera: ahuyentando a la loba (fuego, Intimidación CD 15), colándose sin que le vea (Sigilo CD 13), llevando ceniza del granero encima, o con la loba muerta' },
        { kind: 'npc_status', npc_id: 'npc_loba', status: 'dead' },
      ] },
        on_done: [{ kind: 'npc_move', npc_id: 'npc_ceniza', spot_id: 'sp_tab_chimenea' }, { kind: 'tell', text: 'Ceniza sale disparado de entre las raíces, cojeando, hacia el pueblo. Sabe el camino a casa mejor que tú.' }] },
      { id: 'volver', text: 'Volver al Jabalí con Brenna', done_when: { kind: 'at_location', location_id: 'loc_taberna' } },
    ],
    reward: { coins: 1000, reputation: 2, xp: 100 },
    on_complete: [{ kind: 'attitude', npc_id: 'npc_brenna', attitude: 'friendly' }, { kind: 'know_npc', npc_id: 'npc_brenna' },
      { kind: 'tell', text: 'Brenna se arrodilla junto a la chimenea con el perro entre los brazos y no dice nada durante un rato. Luego te sirve sin cobrar y, al dejar la jarra, murmura: «Hay cosas que te debo contar. Ahora no».' }],
  },
  {
    id: 'q_noche', act: 1, title: 'Lo que vio Doro', giver_npc_id: 'npc_doro',
    text: 'Doro, el guardia del portón, se pone nervioso cuando alguien mira hacia el granero viejo. Algo ha visto.',
    notes: 'Doro confiesa las luces del Granero Quemado y la figura de la senda (pista clue_doro) si se le trata bien. La figura es Tobías: cada noche, a las 23:00, cruza el arroyo del Soto hacia el granero (evento «Tobías va al granero»). Si el PJ espera allí a esa hora, lo ve con su hatillo. Que lo siga o lo pare es cosa suya.',
    opens_when: { kind: 'any', of: [{ kind: 'knows', npc_id: 'npc_doro' }, { kind: 'visit', spot_id: 'sp_pl_porton' }, { kind: 'clue', clue_id: 'clue_doro' }] },
    heard: 'Lo notas tú mismo: el guardia del portón no le quita ojo al granero viejo',
    steps: [
      { id: 'confianza', text: 'Ganarte la confianza de Doro', done_when: { kind: 'clue', clue_id: 'clue_doro' } },
      { id: 'vigilar', text: 'Vigilar de noche el arroyo del Soto', done_when: { kind: 'all', of: [{ kind: 'visit', spot_id: 'sp_cl_arroyo' }, { kind: 'npc_at', npc_id: 'npc_tobias', spot_id: 'sp_cl_arroyo' }] },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_tobias' }, { kind: 'tell', text: 'La figura del arroyo es un muchacho enharinado con un hatillo: Tobías, el hijo del molinero. Va sin antorcha, como quien conoce el camino de memoria.' }] },
      { id: 'que_lleva', text: 'Descubrir qué lleva Tobías al granero y qué trae', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_tobias' }, { kind: 'carry', item_id: 'it_cartas_tobias' }, { kind: 'carry', item_id: 'it_bolsa_ceniza' }] } },
    ],
    reward: { coins: 600, reputation: 1, xp: 100 },
    on_complete: [{ kind: 'learn_place', location_id: 'loc_ruinas' }],
  },
  // --- Acto II -----------------------------------------------------------------
  {
    id: 'q_sotano', act: 2, title: 'Bajo el Jabalí', giver_npc_id: 'npc_brenna',
    text: 'Brenna sabe qué pasó en Vharn y dice que «está escrito, ahí abajo». Ahí abajo es su taberna.',
    notes: 'El sótano está bajo la trampilla de la mesa del fondo (oculta, CD 14; Brenna la enseña si es amiga: discover_spot). El libro de cuentas está en el hueco tras el último barril (oculto, CD 12). Al cogerlo, el servidor concede la pista del libro: apunta la plata entregada a O. Malvez. Brenna, si la pillan, pide que no se sepa todavía: tiene miedo de Osric.',
    opens_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_brenna' }, { kind: 'clue', clue_id: 'clue_trampilla' }, { kind: 'quest', quest_id: 'q_perro' }, { kind: 'discovered', spot_id: 'sp_tab_trampilla' }] },
    steps: [
      { id: 'bajar', text: 'Bajar al sótano del Jabalí', done_when: { kind: 'at_location', location_id: 'loc_sotano' } },
      { id: 'libro', text: 'Encontrar lo que Brenna esconde', done_when: { kind: 'carry', item_id: 'it_libro_cuentas' },
        on_done: [{ kind: 'clue', clue_id: 'clue_libro' }] },
    ],
    reward: { coins: 500, xp: 150 },
    on_complete: [
      { kind: 'npc_attitude_all', npc_id: 'npc_osric', attitude: 'unfriendly' },
      { kind: 'hook', id: 'hk_garran_sotano', location_id: 'loc_taberna', trigger: 'location', what: 'Garrán entra en el Jabalí preguntando en voz alta quién ha andado «moviendo barriles» en casa de Brenna. Alguien se ha ido de la lengua. Busca con la mirada al PJ y se sienta a esperar a que salga.', expires_hours: 48 },
    ],
  },
  {
    id: 'q_cadena', act: 2, title: 'La cadena de hierro frío', giver_npc_id: 'npc_ilse',
    text: 'Ilse dice que un fuego de la Brasa solo se templa con hierro frío, y que el único que queda lo forjó el maestro de Hugo, el herrero.',
    notes: 'Hugo guarda los eslabones bajo la losa suelta (oculta, CD 13; él la enseña si confía: discover_spot). El regidor le ha ordenado fundirlos. Ayudarle con su deuda con Osric (set_debt/settle_debt con Garrán, o enfrentarse a Garrán) lo gana del todo. Al llevar los eslabones a Ilse, ella enseña las palabras que templan el ascua.',
    opens_when: { kind: 'quest', quest_id: 'q_agua' },
    steps: [
      { id: 'hugo', text: 'Preguntar a Hugo por la cadena de su maestro', done_when: { kind: 'clue', clue_id: 'clue_hugo' } },
      { id: 'eslabones', text: 'Conseguir los eslabones de hierro frío', done_when: { kind: 'carry', item_id: 'it_cadena_fria' } },
      { id: 'rito', text: 'Llevárselos a Ilse para aprender el rito', done_when: { kind: 'all', of: [{ kind: 'carry', item_id: 'it_cadena_fria' }, { kind: 'at_location', location_id: 'loc_curandera' }] },
        on_done: [{ kind: 'tell', text: 'Ilse pasa los dedos por los eslabones fríos y te hace repetir, tres veces, unas palabras en una lengua vieja. «Se dicen con el hierro frío en la mano y el ascua bajo el agua del pozo. Sin soltarlo, aunque queme».' }] },
    ],
    reward: { coins: 400, xp: 150 },
    on_complete: [{ kind: 'attitude', npc_id: 'npc_hugo', attitude: 'friendly' }],
  },
  {
    id: 'q_tobias', act: 2, title: 'El hijo del molinero', giver_npc_id: 'npc_mateo',
    text: 'Tobías, el hijo del molinero, sale de noche y vuelve con las uñas negras. Mateo no quiere saberlo, pero tose gris como todos.',
    notes: 'Con las cartas o la bolsa de ceniza delante, Tobías confiesa (CD 12; sin ellas, CD 15): echa al pozo ceniza de las grietas del altar por encargo de «la señora del granero», que le ha prometido hacerle señor de Vharn. Pararlo cura poco a poco el pozo y frena la tos gris. Si se le humilla delante de su padre o se le entrega a Garrán, se esconde en el Granero Quemado.',
    opens_when: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_noche' }, { kind: 'clue', clue_id: 'clue_tobias' }, { kind: 'carry', item_id: 'it_cartas_tobias' }] },
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
    reward: { coins: 500, reputation: 2, xp: 100 },
    on_complete: [{ kind: 'attitude', npc_id: 'npc_mateo', attitude: 'allied' }, { kind: 'learn_place', location_id: 'loc_ruinas' },
      { kind: 'rumor', id: 'rm_tobias', location_id: 'loc_plaza', rumor_kind: 'person', name: 'El chico del molino', hint: 'el hijo de Mateo andaba con los del granero y alguien le ha hecho entrar en razón', where: 'el molino', days: 10 }],
  },
  {
    id: 'q_subida', act: 2, title: 'El Granero Quemado', giver_npc_id: 'npc_hal',
    text: 'Lo que pasa en Brezal sale del granero viejo de los Vharn, en el borde del pueblo. Alguien tiene que ir a ver quién enciende las luces.',
    notes: 'Hal sabe que el granero «no está tan vacío como dicen» (pista clue_hal). Desde la torre del reloj de la casona o el tejado del molino se ve el humo del granero y la niebla alrededor de todo. Se llega por la senda del arroyo del Soto. En el granero se esconde Ysolde: no ataca de entrada, pregunta quién te manda. Si el PJ la escucha, cuenta quién es (pista clue_ysolde).',
    opens_when: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_noche' }, { kind: 'quest', quest_id: 'q_perro' }, { kind: 'clue', clue_id: 'clue_hal' }, { kind: 'at_location', location_id: 'loc_claro' }] },
    heard: 'Todo apunta al granero viejo de los Vharn: alguien enciende luces donde no debería haber nadie',
    steps: [
      { id: 'hal', text: 'Hablar con Hal, el cazador, del granero viejo', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_hal' }, { kind: 'visit', spot_id: 'sp_ca_torre' }, { kind: 'visit', spot_id: 'sp_mo_tejado' }] } },
      { id: 'mirador', text: 'Subir a la torre del reloj o al tejado del molino y mirar', done_when: { kind: 'any', of: [{ kind: 'visit', spot_id: 'sp_ca_torre' }, { kind: 'visit', spot_id: 'sp_mo_tejado' }] },
        on_done: [{ kind: 'tell', text: 'Desde arriba, Brezal es un puñado de tejados dentro de un anillo de niebla gris que no se mueve. En el Granero Quemado, entre los alisos, hay un fuego encendido a plena luz.' }] },
      { id: 'ruinas', text: 'Llegar al Granero Quemado', done_when: { kind: 'at_location', location_id: 'loc_ruinas' } },
      { id: 'ysolde', text: 'Encontrar a quien enciende las luces', done_when: { kind: 'clue', clue_id: 'clue_ysolde' },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_ysolde' }] },
    ],
    reward: { coins: 600, xp: 200 },
    on_complete: [],
  },
  // --- Acto III: finales que se excluyen ---------------------------------------
  {
    id: 'q_final_templar', act: 3, title: 'Templar el ascua', giver_npc_id: 'npc_ilse', exclusive: 'final',
    text: 'La Brasa grande está enterrada, pero Ysolde lleva un ascua suya en el guante. Con los eslabones de hierro frío y las palabras de Ilse, alguien puede templarla en el agua fría del pozo.',
    notes: 'Final de restauración. El ascua llega al pozo si Ysolde acepta bajarla (le han enseñado el libro de cuentas, o Persuasión CD 15) o si se la quitan (combate: CA 12, 22 PG, 2d6 de fuego). En el pozo, con los eslabones sujetos, templar pide Atletismo o Arcanos CD 14; cada fallo, 2d6 de fuego (apply_damage) y se puede repetir. Ilse ayuda si es la hora de la misa. Templarla apaga la tos y afloja el Cerco, pero no lo abre.',
    opens_when: { kind: 'all', of: [{ kind: 'quest', quest_id: 'q_cadena' }, { kind: 'quest', quest_id: 'q_subida' }] },
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
    reward: { coins: 2000, reputation: 3, xp: 700 },
    ending: 'El ascua de Ysolde se apagó en el agua fría del pozo con un silbido que se oyó en todo Brezal. Al tercer día el agua bajó clara y la tos gris se fue. Dicen que fue {name} quien la sujetó bajo el agua con las manos quemadas. La niebla sigue en el Lindero.',
    on_complete: [
      { kind: 'spot_state', spot_id: 'sp_pl_pozo', patch: { templado: true, ascua: 'apagada, negra como un carbón frío', agua: 'clara y fría' } },
      { kind: 'location_state', location_id: 'loc_plaza', patch: { pozo: 'el agua baja clara otra vez' } },
      { kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_ru_capilla' },
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Del pozo sube un silbido largo y una nube de vapor blanco. Cuando se aclara, el agua del cubo sale fría y el aire deja de oler a azufre.', public: true },
    ],
  },
  {
    id: 'q_final_verdad', act: 3, title: 'La verdad en el pozo', giver_npc_id: 'npc_brenna', exclusive: 'final',
    text: 'Brenna vio quién prendió el fuego. Ysolde cree que fue ella. Si las dos hablan delante de Brezal en la misa del pozo, el valle sabrá la verdad.',
    notes: 'Final de justicia. Brenna habla en público si el PJ le enseña el libro y le promete protegerla (Persuasión CD 14, ventaja si Ceniza volvió). Ysolde baja a la misa si el PJ le ha enseñado el libro o la convence (Persuasión CD 15). La misa es a las 20:00 en el pozo; si los tres están allí, Brezal lo oye. Osric intenta huir esa misma noche, pero del valle no sale nadie: se esconde en el pueblo (la bodega tapiada de la casona). Garrán no le sigue.',
    opens_when: { kind: 'all', of: [{ kind: 'quest', quest_id: 'q_sotano' }, { kind: 'clue', clue_id: 'clue_ysolde' }] },
    steps: [
      { id: 'brenna', text: 'Convencer a Brenna de hablar delante de todos', done_when: { kind: 'narrative', how: 'cuando Brenna acepte contar en la misa del pozo lo que vio (Persuasión CD 14 con el libro delante; ventaja si Ceniza volvió a casa)' } },
      { id: 'ysolde', text: 'Traer a Ysolde a la misa del pozo', done_when: { kind: 'narrative', how: 'cuando Ysolde acepte ir a escuchar (le han enseñado el libro de cuentas, o Persuasión CD 15)' },
        on_done: [{ kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_pl_pozo' }, { kind: 'tell', text: 'Ysolde sale del granero de noche, con la capucha echada y el ascua apagada en el guante. Se queda junto al pozo, quieta, a esperar la misa.' }] },
      { id: 'misa', text: 'Que Brezal lo oiga en la misa del pozo', done_when: { kind: 'all', of: [{ kind: 'visit', spot_id: 'sp_pl_pozo' }, { kind: 'npc_at', npc_id: 'npc_brenna', spot_id: 'sp_pl_pozo' }, { kind: 'npc_at', npc_id: 'npc_ysolde', spot_id: 'sp_pl_pozo' }] } },
    ],
    reward: { coins: 1500, reputation: 4, xp: 700 },
    ending: 'En la misa del pozo Brenna contó lo que vio la noche de Vharn y el libro de cuentas pasó de mano en mano. Osric Malvez quiso huir antes del alba, pero la niebla no deja salir a nadie: está escondido en algún sitio de Brezal. Ysolde dejó que la Brasa durmiera y Brezal sabe ahora a quién se lo debe: a {name}.',
    on_complete: [
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Junto al pozo, con una vela en la mano, Brenna cuenta en voz alta lo que vio la noche del incendio. Nadie reza. Ysolde, a su lado, se quita el guante: el ascua se ha apagado.', public: true },
      { kind: 'npc_status', npc_id: 'npc_osric', status: 'missing', hideout_spot_id: 'sp_ca_bodega' },
      { kind: 'npc_attitude_all', npc_id: 'npc_ysolde', attitude: 'friendly' },
      { kind: 'npc_attitude_all', npc_id: 'npc_garran', attitude: 'neutral' },
      { kind: 'location_state', location_id: 'loc_casona', patch: { abandonada: 'la casona está vacía y con la puerta abierta; hay quien jura haber oído toser detrás de un tabique' } },
    ],
  },
  {
    id: 'q_final_arder', act: 3, title: 'Que arda Vharn', giver_npc_id: 'npc_ysolde', exclusive: 'final',
    text: 'Ysolde quiere al mayordomo que quemó su casa. Si se lo entregas, soltará el ascua sobre lo que él construyó con la plata robada.',
    notes: 'Final oscuro, para quien se pone del lado de la heredera. Entregarle a Osric (llevarlo al granero atado o engañado, o que muera) y dejarla, o ayudarla, a soltar el ascua en la plaza, junto a la casona. El fuego prende la casona y media aldea; con el Cerco cerrado el humo no sale del valle y lo paga toda Brezal. Ysolde queda como señora de unas ruinas.',
    opens_when: { kind: 'clue', clue_id: 'clue_ysolde' },
    steps: [
      { id: 'osric', text: 'Entregar a Ysolde al mayordomo de su padre', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando Osric quede en manos de Ysolde: llevado al granero atado o engañado, o entregado a la fuerza' },
        { kind: 'npc_status', npc_id: 'npc_osric', status: 'dead' },
      ] } },
      { id: 'soltar', text: 'Dejar que Ysolde suelte el ascua en la plaza', done_when: { kind: 'narrative', how: 'cuando, en la plaza, Ysolde deje caer el ascua junto al pozo y el PJ la deje hacerlo o la ayude' } },
    ],
    reward: { coins: 1000, xp: 450 },
    ending: 'Ysolde soltó el ascua en la plaza. La casona del regidor ardió hasta los cimientos y con ella media aldea, y el humo no encontró por dónde salir del valle. Ysolde es señora de unas ruinas que no se enfrían, y en Brezal nadie pronuncia el nombre de {name} sin escupir al suelo.',
    on_complete: [
      { kind: 'spot_state', spot_id: 'sp_pl_pozo', patch: { ascua: 'suelta: un sol pequeño en el empedrado que no deja mirar' } },
      { kind: 'location_state', location_id: 'loc_casona', patch: { incendio: 'la casona arde por los cuatro costados' } },
      { kind: 'location_state', location_id: 'loc_plaza', patch: { cielo: 'rojo; el humo no sale del valle y se queda bajo la niebla, escociendo los ojos' } },
      { kind: 'npc_status', npc_id: 'npc_osric', status: 'dead' },
      { kind: 'npc_attitude_all', npc_id: 'npc_brenna', attitude: 'hostile' },
      { kind: 'announce', location_id: 'loc_plaza', text: 'El ascua cae en el empedrado y se abre como una flor de fuego. El tejado de la casona prende de golpe; el humo sube, choca con la niebla y vuelve a bajar sobre Brezal.', public: true },
    ],
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
