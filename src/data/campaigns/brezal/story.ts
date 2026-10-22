/**
 * Brezal: la historia en tres actos (src/engine/story.ts).
 *
 *   Acto I · Lo que trae el agua: tres hilos cortos que abren el mundo (la
 *   ceniza del pozo, el perro de Brenna, las luces que vio Doro).
 *   Acto II · Lo que esconde Brezal: el sótano, la cadena, el hijo del
 *   molinero y la subida a Vharn.
 *   Acto III · La noche de la Brasa: tres finales que se excluyen (atar la
 *   Brasa, la verdad en el pozo, que arda Vharn).
 *
 * Y la amenaza que avanza sola si nadie interviene: la tos gris, los lobos,
 * Tobías que se va, la herrería clavada y la noche de luna nueva.
 */

import type { Story, StoryEscalation, StoryQuest } from '../../../engine/story.js';

const QUESTS: StoryQuest[] = [
  // --- Acto I ------------------------------------------------------------------
  {
    id: 'q_agua', act: 1, title: 'Ceniza en el agua', giver_npc_id: 'npc_ilse',
    text: 'El agua del pozo de Brezal baja turbia y tibia, y media aldea tose gris. Alguien debería llevarle una muestra a Ilse, la curandera.',
    notes: 'Primer hilo: lleva a Ilse y a la Brasa. El agua del pozo se puede coger (it_agua_pozo, en el pozo). Al entrar en casa de Ilse con el agua, el servidor concede la pista de la Brasa y ella explica qué es y cómo se ata: interprétala con su voz de rezo y cocina.',
    opens_when: { kind: 'any', of: [{ kind: 'at_location', location_id: 'loc_plaza' }, { kind: 'knows', npc_id: 'npc_ilse' }, { kind: 'clue', clue_id: 'clue_pozo' }] },
    steps: [
      { id: 'mirar', text: 'Sacar agua del pozo y mirarla de cerca', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_pozo' }, { kind: 'carry', item_id: 'it_agua_pozo' }] } },
      { id: 'ilse', text: 'Llevarle el agua a Ilse, la curandera', done_when: { kind: 'all', of: [{ kind: 'carry', item_id: 'it_agua_pozo' }, { kind: 'at_location', location_id: 'loc_curandera' }] },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_ilse' }, { kind: 'clue', clue_id: 'clue_ilse' }, { kind: 'attitude', npc_id: 'npc_ilse', attitude: 'friendly' },
          { kind: 'tell', text: 'Ilse huele el agua, la prueba con la punta de la lengua y escupe: «Esto no es ceniza de hogar. Es de la cripta. La Brasa respira otra vez».' }] },
    ],
    reward: { coins: 300, xp: 50 },
    on_complete: [{ kind: 'learn_place', location_id: 'loc_cuesta' }, { kind: 'learn_place', location_id: 'loc_ruinas' }],
  },
  {
    id: 'q_perro', act: 1, title: 'Ceniza se ha perdido', giver_npc_id: 'npc_brenna',
    text: 'Se ha perdido Ceniza, el perro de Brenna: pardo, una oreja rota. Lo vieron por el bosque, cuesta arriba. Quien lo traiga cobra.',
    notes: 'El perro está en la lobera de la cuesta, acorralado por la loba de ceniza (hostil, dura para un nivel 1: que el PJ piense antes de pelear). Se puede sacar ahuyentándola con fuego, colándose (Sigilo CD 13 mientras duerme), llevando encima ceniza de la cripta (no ataca a quien la lleva) o matándola. Brenna se ablanda mucho al recuperarlo.',
    opens_when: { kind: 'any', of: [{ kind: 'knows', npc_id: 'npc_brenna' }, { kind: 'at_location', location_id: 'loc_taberna' }] },
    steps: [
      { id: 'rastro', text: 'Buscar el rastro del perro en el bosque', done_when: { kind: 'at_location', location_id: 'loc_claro' },
        on_done: [{ kind: 'learn_place', location_id: 'loc_cuesta' }, { kind: 'tell', text: 'En el barro del claro, entre botas, hay huellas de perro que suben hacia la cuesta, y al lado otras enormes, de lobo.' }] },
      { id: 'lobera', text: 'Encontrar a Ceniza en la cuesta', done_when: { kind: 'visit', spot_id: 'sp_cs_cueva' } },
      { id: 'sacar', text: 'Sacarlo de la lobera', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando el PJ saque al perro de la lobera: ahuyentando a la loba (fuego, Intimidación CD 15), colándose sin que le vea (Sigilo CD 13), llevando ceniza de la cripta encima, o con la loba muerta' },
        { kind: 'npc_status', npc_id: 'npc_loba', status: 'dead' },
      ] },
        on_done: [{ kind: 'npc_move', npc_id: 'npc_ceniza', spot_id: 'sp_tab_chimenea' }, { kind: 'tell', text: 'Ceniza sale disparado cuesta abajo, cojeando, hacia el pueblo. Sabe el camino a casa mejor que tú.' }] },
      { id: 'volver', text: 'Volver al Jabalí con Brenna', done_when: { kind: 'at_location', location_id: 'loc_taberna' } },
    ],
    reward: { coins: 1000, reputation: 2, xp: 100 },
    on_complete: [{ kind: 'attitude', npc_id: 'npc_brenna', attitude: 'friendly' }, { kind: 'know_npc', npc_id: 'npc_brenna' },
      { kind: 'tell', text: 'Brenna se arrodilla junto a la chimenea con el perro entre los brazos y no dice nada durante un rato. Luego te sirve sin cobrar y, al dejar la jarra, murmura: «Hay cosas que te debo contar. Ahora no».' }],
  },
  {
    id: 'q_noche', act: 1, title: 'Lo que vio Doro', giver_npc_id: 'npc_doro',
    text: 'Doro, el guardia del portón, se pone nervioso cuando alguien mira hacia la montaña. Algo ha visto.',
    notes: 'Doro confiesa las luces y la figura de la senda (pista clue_doro) si se le trata bien. La figura es Tobías: cada noche, a las 23:00, cruza el arroyo del claro (evento «Tobías sube por la senda»). Si el PJ espera allí a esa hora, lo ve con su hatillo. Que lo siga o lo pare es cosa suya.',
    opens_when: { kind: 'any', of: [{ kind: 'knows', npc_id: 'npc_doro' }, { kind: 'visit', spot_id: 'sp_pl_porton' }, { kind: 'clue', clue_id: 'clue_doro' }] },
    steps: [
      { id: 'confianza', text: 'Ganarte la confianza de Doro', done_when: { kind: 'clue', clue_id: 'clue_doro' } },
      { id: 'vigilar', text: 'Vigilar de noche el arroyo del claro', done_when: { kind: 'all', of: [{ kind: 'visit', spot_id: 'sp_cl_arroyo' }, { kind: 'npc_at', npc_id: 'npc_tobias', spot_id: 'sp_cl_arroyo' }] },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_tobias' }, { kind: 'tell', text: 'La figura del arroyo es un muchacho enharinado con un hatillo: Tobías, el hijo del molinero. Sube sin antorcha, como quien conoce el camino de memoria.' }] },
      { id: 'que_lleva', text: 'Descubrir qué lleva Tobías arriba y abajo', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_tobias' }, { kind: 'carry', item_id: 'it_cartas_tobias' }, { kind: 'carry', item_id: 'it_bolsa_ceniza' }] } },
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
    text: 'Ilse dice que la Brasa solo se ata con hierro frío, y que el único que queda lo forjó el maestro de Hugo, el herrero.',
    notes: 'Hugo guarda los eslabones bajo la losa suelta (oculta, CD 13; él la enseña si confía: discover_spot). El regidor le ha ordenado fundirlos. Ayudarle con su deuda con Osric (set_debt/settle_debt con Garrán, o enfrentarse a Garrán) lo gana del todo. Al llevar los eslabones a Ilse, ella enseña las palabras del altar.',
    opens_when: { kind: 'quest', quest_id: 'q_agua' },
    steps: [
      { id: 'hugo', text: 'Preguntar a Hugo por la cadena de su maestro', done_when: { kind: 'clue', clue_id: 'clue_hugo' } },
      { id: 'eslabones', text: 'Conseguir los eslabones de hierro frío', done_when: { kind: 'carry', item_id: 'it_cadena_fria' } },
      { id: 'rito', text: 'Llevárselos a Ilse para aprender el rito', done_when: { kind: 'all', of: [{ kind: 'carry', item_id: 'it_cadena_fria' }, { kind: 'at_location', location_id: 'loc_curandera' }] },
        on_done: [{ kind: 'tell', text: 'Ilse pasa los dedos por los eslabones fríos y te hace repetir, tres veces, unas palabras en una lengua vieja. «En el altar están escritas. Tú solo tienes que decirlas con la cadena puesta y sin soltarla, aunque queme».' }] },
    ],
    reward: { coins: 400, xp: 150 },
    on_complete: [{ kind: 'attitude', npc_id: 'npc_hugo', attitude: 'friendly' }],
  },
  {
    id: 'q_tobias', act: 2, title: 'El hijo del molinero', giver_npc_id: 'npc_mateo',
    text: 'Tobías, el hijo del molinero, sale de noche y vuelve con las uñas negras. Mateo no quiere saberlo, pero tose gris como todos.',
    notes: 'Con las cartas o la bolsa de ceniza delante, Tobías confiesa (CD 12; sin ellas, CD 15): echa ceniza de la cripta al pozo por encargo de «la señora de la torre», que le ha prometido hacerle señor de Vharn. Pararlo cura poco a poco el pozo y frena la tos gris. Si se le humilla delante de su padre o se le entrega a Garrán, huye a las ruinas.',
    opens_when: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_noche' }, { kind: 'clue', clue_id: 'clue_tobias' }, { kind: 'carry', item_id: 'it_cartas_tobias' }] },
    steps: [
      { id: 'confesar', text: 'Hacer que Tobías cuente lo que hace de noche', done_when: { kind: 'narrative', how: 'cuando Tobías confiese que echa ceniza al pozo por encargo de la mujer de la torre (Persuasión/Intimidación CD 15, CD 12 con las cartas o la bolsa delante)' } },
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
      { kind: 'rumor', id: 'rm_tobias', location_id: 'loc_plaza', rumor_kind: 'person', name: 'El chico del molino', hint: 'el hijo de Mateo andaba con los de arriba y alguien le ha hecho entrar en razón', where: 'el molino', days: 10 }],
  },
  {
    id: 'q_subida', act: 2, title: 'La cuesta gris', giver_npc_id: 'npc_hal',
    text: 'Lo que pasa en Brezal baja de la montaña. Alguien tiene que subir a ver quién enciende las luces de Vharn.',
    notes: 'Hal conoce el camino seguro (pista clue_hal). Doro no deja pasar por el portón sin motivo o sin soborno; también se puede ir por la senda del molino. En las ruinas vive Ysolde: no ataca de entrada, pregunta quién te manda. Si el PJ la escucha, cuenta quién es (pista clue_ysolde).',
    opens_when: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_noche' }, { kind: 'quest', quest_id: 'q_perro' }, { kind: 'clue', clue_id: 'clue_hal' }, { kind: 'at_location', location_id: 'loc_cuesta' }] },
    steps: [
      { id: 'hal', text: 'Hablar con Hal, el cazador, del camino de arriba', done_when: { kind: 'any', of: [{ kind: 'clue', clue_id: 'clue_hal' }, { kind: 'visit', spot_id: 'sp_cs_mirador' }] } },
      { id: 'mirador', text: 'Subir hasta el mirador de la cuesta', done_when: { kind: 'visit', spot_id: 'sp_cs_mirador' },
        on_done: [{ kind: 'tell', text: 'Desde el mirador, Brezal es un puñado de tejados. Arriba, en la torre hundida de Vharn, hay un fuego encendido a plena luz.' }] },
      { id: 'ruinas', text: 'Llegar a las ruinas de Vharn', done_when: { kind: 'at_location', location_id: 'loc_ruinas' } },
      { id: 'ysolde', text: 'Encontrar a quien enciende las luces', done_when: { kind: 'clue', clue_id: 'clue_ysolde' },
        on_done: [{ kind: 'know_npc', npc_id: 'npc_ysolde' }] },
    ],
    reward: { coins: 600, xp: 200 },
    on_complete: [{ kind: 'learn_place', location_id: 'loc_cripta' }],
  },
  // --- Acto III: finales que se excluyen ---------------------------------------
  {
    id: 'q_final_atar', act: 3, title: 'Atar la Brasa', giver_npc_id: 'npc_ilse', exclusive: 'final',
    text: 'Con la llave de los Vharn, los eslabones de hierro frío y las palabras de Ilse, alguien puede bajar a la cripta y volver a atar la Brasa.',
    notes: 'Final de restauración. La puerta de la cripta se abre con la llave de los Vharn (el logro la da) o rompiéndola (Atletismo CD 18 → update_spot_state sp_ru_cripta {"locked": false}). Abajo, la Brasa resiste: atar los eslabones a las cadenas rotas pide Atletismo o Arcanos CD 14; cada fallo, 2d6 de fuego (apply_damage) y se puede repetir. Si Ysolde no ha sido convencida, baja a impedirlo.',
    opens_when: { kind: 'all', of: [{ kind: 'quest', quest_id: 'q_cadena' }, { kind: 'quest', quest_id: 'q_subida' }] },
    steps: [
      { id: 'llave', text: 'Abrir la puerta de la cripta', done_when: { kind: 'any', of: [{ kind: 'carry', item_id: 'it_llave_vharn' }, { kind: 'spot_state', spot_id: 'sp_ru_cripta', key: 'locked', value: false }] } },
      { id: 'bajar', text: 'Bajar a la cripta con los eslabones', done_when: { kind: 'all', of: [{ kind: 'at_location', location_id: 'loc_cripta' }, { kind: 'carry', item_id: 'it_cadena_fria' }] } },
      { id: 'atar', text: 'Atar la Brasa con el hierro frío', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando el PJ, junto a la Brasa, ate los eslabones a las cadenas rotas y diga las palabras del altar (Atletismo o Arcanos CD 14; cada fallo, 2d6 de fuego)' },
        { kind: 'spot_state', spot_id: 'sp_cr_brasa', key: 'atada', value: true },
      ] } },
    ],
    reward: { coins: 2000, reputation: 3, xp: 700 },
    ending: 'La Brasa de Vharn vuelve a dormir atada con hierro frío. En Brezal el agua baja clara al tercer día y la tos gris se va. Dicen que fue {name} quien bajó a la cripta y volvió con las manos quemadas.',
    on_complete: [
      { kind: 'spot_state', spot_id: 'sp_cr_brasa', patch: { atada: true, brillo: 'apagado, como una brasa bajo ceniza' } },
      { kind: 'location_state', location_id: 'loc_plaza', patch: { pozo: 'el agua baja clara otra vez' } },
      { kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_ru_capilla' },
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Un temblor sordo baja de la montaña y, de golpe, el aire deja de oler a azufre. En el pozo, el agua del cubo sale fría.', public: true },
    ],
  },
  {
    id: 'q_final_verdad', act: 3, title: 'La verdad en el pozo', giver_npc_id: 'npc_brenna', exclusive: 'final',
    text: 'Brenna vio quién prendió el fuego. Ysolde cree que fue ella. Si las dos hablan delante de Brezal en la misa del pozo, el valle sabrá la verdad.',
    notes: 'Final de justicia. Brenna habla en público si el PJ le enseña el libro y le promete protegerla (Persuasión CD 14, ventaja si Ceniza volvió). Ysolde baja a la misa si el PJ le ha enseñado el libro o la convence (Persuasión CD 15). La misa es a las 20:00 en el pozo; si los tres están allí, Brezal lo oye. Osric intenta huir esa misma noche; Garrán no le sigue.',
    opens_when: { kind: 'all', of: [{ kind: 'quest', quest_id: 'q_sotano' }, { kind: 'clue', clue_id: 'clue_ysolde' }] },
    steps: [
      { id: 'brenna', text: 'Convencer a Brenna de hablar delante de todos', done_when: { kind: 'narrative', how: 'cuando Brenna acepte contar en la misa del pozo lo que vio (Persuasión CD 14 con el libro delante; ventaja si Ceniza volvió a casa)' } },
      { id: 'ysolde', text: 'Traer a Ysolde a la misa del pozo', done_when: { kind: 'narrative', how: 'cuando Ysolde acepte bajar a escuchar (le han enseñado el libro de cuentas, o Persuasión CD 15)' },
        on_done: [{ kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_pl_pozo' }, { kind: 'tell', text: 'Ysolde baja de la montaña de noche, con la capucha echada y el ascua apagada en el guante. Se queda junto al pozo, quieta, a esperar la misa.' }] },
      { id: 'misa', text: 'Que Brezal lo oiga en la misa del pozo', done_when: { kind: 'all', of: [{ kind: 'visit', spot_id: 'sp_pl_pozo' }, { kind: 'npc_at', npc_id: 'npc_brenna', spot_id: 'sp_pl_pozo' }, { kind: 'npc_at', npc_id: 'npc_ysolde', spot_id: 'sp_pl_pozo' }] } },
    ],
    reward: { coins: 1500, reputation: 4, xp: 700 },
    ending: 'En la misa del pozo Brenna contó lo que vio la noche de Vharn y el libro de cuentas pasó de mano en mano. Osric Malvez huyó antes del alba. Ysolde dejó que la Brasa durmiera sola y Brezal sabe ahora a quién se lo debe: a {name}.',
    on_complete: [
      { kind: 'announce', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo', text: 'Junto al pozo, con una vela en la mano, Brenna cuenta en voz alta lo que vio la noche del incendio. Nadie reza. Ysolde, a su lado, se quita el guante: el ascua se ha apagado.', public: true },
      { kind: 'npc_status', npc_id: 'npc_osric', status: 'missing' },
      { kind: 'npc_attitude_all', npc_id: 'npc_ysolde', attitude: 'friendly' },
      { kind: 'npc_attitude_all', npc_id: 'npc_garran', attitude: 'neutral' },
      { kind: 'location_state', location_id: 'loc_casona', patch: { abandonada: 'la casona está vacía y con la puerta abierta' } },
    ],
  },
  {
    id: 'q_final_arder', act: 3, title: 'Que arda Vharn', giver_npc_id: 'npc_ysolde', exclusive: 'final',
    text: 'Ysolde quiere al mayordomo que quemó su casa. Si se lo entregas, soltará la Brasa sobre lo que él construyó con la plata robada.',
    notes: 'Final oscuro, para quien se pone del lado de la heredera. Entregarle a Osric (llevarlo a las ruinas atado o engañado, o que muera) y dejarla, o ayudarla, a romper la última cadena en la cripta. La Brasa suelta quema la casona y medio Brezal; Ysolde queda como señora de las ruinas.',
    opens_when: { kind: 'clue', clue_id: 'clue_ysolde' },
    steps: [
      { id: 'osric', text: 'Entregar a Ysolde al mayordomo de su padre', done_when: { kind: 'any', of: [
        { kind: 'narrative', how: 'cuando Osric quede en manos de Ysolde: llevado a las ruinas atado o engañado, o entregado a la fuerza' },
        { kind: 'npc_status', npc_id: 'npc_osric', status: 'dead' },
      ] } },
      { id: 'soltar', text: 'Dejar que Ysolde suelte la Brasa', done_when: { kind: 'narrative', how: 'cuando en la cripta Ysolde rompa la última cadena y el PJ la deje hacerlo o la ayude' } },
    ],
    reward: { coins: 1000, xp: 450 },
    ending: 'La Brasa de Vharn se soltó. La casona del regidor ardió hasta los cimientos y con ella media aldea. Ysolde es señora de unas ruinas que ya no se enfrían, y en Brezal nadie pronuncia el nombre de {name} sin escupir al suelo.',
    on_complete: [
      { kind: 'spot_state', spot_id: 'sp_cr_brasa', patch: { libre: true, brillo: 'un sol pequeño que no deja mirar' } },
      { kind: 'location_state', location_id: 'loc_casona', patch: { incendio: 'la casona arde por los cuatro costados' } },
      { kind: 'location_state', location_id: 'loc_plaza', patch: { cielo: 'rojo sobre la montaña; cae ceniza caliente' } },
      { kind: 'npc_status', npc_id: 'npc_osric', status: 'dead' },
      { kind: 'npc_attitude_all', npc_id: 'npc_brenna', attitude: 'hostile' },
      { kind: 'announce', location_id: 'loc_plaza', text: 'La montaña se ilumina por dentro como un farol. Un río de chispas baja por la cuesta y el tejado de la casona del regidor prende de golpe.', public: true },
    ],
  },
];

const ESCALATION: StoryEscalation[] = [
  {
    id: 'esc_tos', title: 'La tos gris', after_hours: 18,
    unless: { kind: 'quest', quest_id: 'q_tobias' },
    location_id: 'loc_plaza', spot_id: 'sp_pl_pozo',
    text: 'Junto al pozo una mujer tose y escupe gris; su crío también. Alguien grita que el agua está maldita y dos vecinos empiezan a discutir a empujones.',
    effects: [
      { kind: 'location_state', location_id: 'loc_plaza', patch: { tos: 'media aldea tose gris; hay cola en casa de la curandera' } },
      { kind: 'rumor', id: 'rm_maldicion', location_id: 'loc_plaza', rumor_kind: 'rumor', name: 'La maldición del pozo', hint: 'los de Vharn han maldecido el agua desde la tumba', where: 'el pozo', days: 10 },
    ],
  },
  {
    id: 'esc_lobos', title: 'Los lobos bajan al corral', after_hours: 30,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_perro' }, { kind: 'npc_status', npc_id: 'npc_loba', status: 'dead' }] },
    location_id: 'loc_molino', spot_id: 'sp_mo_sacos',
    text: 'Esta noche los lobos han bajado hasta el corral del molino: tres ovejas muertas y huellas enormes, de ceniza, en la puerta.',
    effects: [
      { kind: 'location_state', location_id: 'loc_molino', patch: { corral: 'tres ovejas muertas y huellas de lobo en la puerta' } },
      { kind: 'npc_move', npc_id: 'npc_lobo', spot_id: 'sp_cl_sendero' },
      { kind: 'rumor', id: 'rm_lobos', location_id: 'loc_taberna', rumor_kind: 'rumor', name: 'La loba de ceniza', hint: 'una loba grande como un poni manda a los lobos y humea al andar', where: 'la cuesta, en una lobera', days: 10 },
    ],
  },
  {
    id: 'esc_tobias', title: 'Tobías se va con los de arriba', after_hours: 54,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_tobias' }, { kind: 'clue', clue_id: 'clue_tobias' }] },
    location_id: 'loc_molino', spot_id: 'sp_mo_muelas',
    text: 'Mateo da voces por el molino: Tobías no ha vuelto esta mañana y en el desván falta su manta.',
    effects: [
      { kind: 'npc_move', npc_id: 'npc_tobias', spot_id: 'sp_ru_patio' },
      { kind: 'cancel_schedule', event_id: 'se_tobias' },
    ],
  },
  {
    id: 'esc_herreria', title: 'Garrán clava la herrería', after_hours: 90,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_cadena' }, { kind: 'carry', item_id: 'it_cadena_fria' }] },
    location_id: 'loc_plaza', spot_id: 'sp_pl_herreria',
    text: 'Garrán clava dos tablas en cruz sobre la puerta de la herrería y cuelga el sello del regidor. Hugo mira desde la puerta del Jabalí sin decir nada.',
    effects: [
      { kind: 'exit_state', exit_id: 'ex_plaza_herreria', patch: { blocked_by: 'dos tablas clavadas en cruz con el sello del regidor' } },
      { kind: 'npc_move', npc_id: 'npc_hugo', spot_id: 'sp_tab_mesa' },
    ],
  },
  {
    id: 'esc_brasa', title: 'La noche de la Brasa', after_hours: 120,
    unless: { kind: 'any', of: [{ kind: 'quest', quest_id: 'q_final_atar' }, { kind: 'quest', quest_id: 'q_final_verdad' }, { kind: 'quest', quest_id: 'q_final_arder' }] },
    location_id: 'loc_plaza',
    text: 'Es noche de luna nueva y la montaña se enciende por dentro. Cae ceniza caliente sobre Brezal; en el tejado de la casona algo empieza a humear.',
    effects: [
      { kind: 'location_state', location_id: 'loc_plaza', patch: { cielo: 'rojo sobre la montaña; cae ceniza caliente' } },
      { kind: 'spot_state', spot_id: 'sp_cr_brasa', patch: { despierta: true, brillo: 'blanco, como hierro en la fragua' } },
      { kind: 'npc_move', npc_id: 'npc_ysolde', spot_id: 'sp_cr_brasa' },
      { kind: 'hook', id: 'hk_brasa_tejados', location_id: 'loc_plaza', trigger: 'time', minutes: 30, what: 'La ceniza ardiente prende el tejado de paja de una casa junto al pozo. Hay gente dentro. Quien esté en la plaza tiene que decidir ya: cubos, gritos o correr.', expires_hours: 6 },
      { kind: 'announce', location_id: 'loc_taberna', text: 'Por la ventana del Jabalí entra una luz roja. Alguien abre la puerta y la cierra enseguida: llueve ceniza caliente.' },
    ],
  },
];

export const STORY: Story = { quests: QUESTS, escalation: ESCALATION };
