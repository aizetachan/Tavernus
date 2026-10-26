/**
 * Brezal sellada: la trama fija. La Biblia (lo que es verdad aunque nadie lo
 * diga, con el origen del Cerco), las leyes del mundo, las facciones, las
 * pistas con su «cómo» para el máster, los encargos del tablón (los bucles
 * cortos), el logro y las tres situaciones iniciales, que se reparten por
 * clase de personaje y vencen a la vez que la amenaza: a los tres días.
 */

import type { Achievement, Campaign, Clue, Faction, Job } from '../../../engine/model.js';

export const PREMISE = 'Hace veinte años el fuego arrasó a los señores de Vharn y nadie ha vuelto a remover sus ruinas. Hace tres semanas una niebla gris bajó del monte y cerró el valle: quien entra en ella sale por donde entró. Dentro, la aldea de Brezal tose ceniza, los lobos rondan los corrales y de noche hay luz en el granero quemado.';

export const WELCOME = [
  'Hay nombres que el valle pronuncia antes de que lleguen. Esta noche ha dicho uno nuevo: {name}.',
  '',
  'Las puertas de Brezal siguen abiertas. Es el mundo el que se ha cerrado. Abajo, en la plaza, encienden las velas para la misa del pozo.',
].join('\n');

/** Verdades ocultas del mundo: explican pistas y secretos. Consulta del máster, nunca se cuentan tal cual. */
export const BIBLE: string[] = [
  'Los señores de Vharn ataban en la cripta de su granero, bajo la capilla, un fuego antiguo, la Brasa, con cadenas de hierro frío; mientras dormía atada, el valle era fértil y el agua del manantial bajaba fría.',
  'El incendio de hace veinte años no fue un accidente: Osric Malvez, entonces mayordomo de Vharn, robó la plata del sello y prendió el granero para taparlo. El fuego llegó a la cripta, rompió las cadenas, la derrumbó y mató a los señores y a medio servicio, entre ellos al herrero de Vharn y al hermano de Brenna.',
  'Brenna, que servía en las cocinas, vio a Osric con la antorcha y sacó del fuego a la niña de los señores, Ysolde. Osric le dio la Taberna del Jabalí a cambio de callar; ella guarda en el sótano el libro de cuentas de Vharn, que apunta la plata entregada a «O. Malvez» aquella noche.',
  'Ysolde Vharn ha vuelto: se esconde en el pajar del Granero Quemado con una ascua de la Brasa en el guante. Recuerda a una mujer con una antorcha llevándosela y cree que Brenna prendió el fuego. Quiere que el valle confiese y, si no, soltar el ascua en la plaza la noche de la Brasa.',
  'La Brasa grande sigue enterrada bajo el granero, fuera de alcance, y respira: calienta el manantial que alimenta el pozo y la caza huye. Además, Tobías, el hijo del molinero, echa cada noche al pozo ceniza de las grietas del altar por encargo de Ysolde: de ahí la tos gris.',
  'El ascua de Ysolde se puede templar: sumergida en el agua fría del manantial, el pozo, con los últimos eslabones de hierro frío sujetos (los guarda Hugo bajo una losa de su herrería) y diciendo las palabras que solo Ilse, la última sacerdotisa, sabe. Templarla apaga la tos y afloja el Cerco, pero no lo abre.',
  'El Cerco de Ceniza es la Guarda de Vharn: un conjuro de contención que los primeros señores levantaron para cerrar el valle cuando la Brasa se agita, y que quedó dormido sin nadie que lo alimentase. Despertó hace tres semanas, cuando Ysolde, la última de la sangre, volvió con el ascua. Es un conjuro protector que se ha vuelto cárcel: no hay villano al que matar para abrirlo.',
  'La Guarda tiene tres anclajes con el sello de Vharn: el del valle (el mojón del Lindero, ligado al pozo y al ascua), el del bosque (la Lobera, al otro lado de la niebla) y el de las minas de plata. Esta historia solo puede templar el primero; los otros dos esperan fuera.',
  'Osric sabe que alguien vive en el granero. Manda a deudores a «apagar las luces» por cuenta suya a través de Garrán, y ha ordenado a Hugo fundir los eslabones. Guarda en su arcón una copa de plata con el sello que no se atrevió a fundir, y en la casona una bodega tapiada por si algún día tiene que esconderse: del valle ya no puede huir nadie.',
  'La loba de ceniza bajó de la montaña cuando empezó a arder por dentro y la niebla la encerró en el Soto, en una madriguera al pie del roble; no ataca a quien lleva encima ceniza del granero. Tiene acorralado a Ceniza, el perro de Brenna.',
];

export const LAWS: string[] = [
  'La magia es rara y temida: solo la lanza quien tiene el conjuro; la Brasa no se usa como un arma, quema a quien la toca sin el guante de Ysolde.',
  'No hay tecnología moderna: ni pólvora, ni motores; hierro, madera, cuerda y fuego.',
  'Nada sale de la nada: lo que el personaje no lleva encima ni está en el mundo no aparece en sus manos.',
  'El cuerpo tiene límites: la fuerza, la velocidad y el aguante son los de la ficha; los prodigios piden tirada y pueden fallar.',
  'Los muertos no vuelven: ni los señores de Vharn ni nadie que caiga en esta historia.',
  'El hierro frío no se calienta ni se funde con fuego de fragua corriente: solo un herrero que conozca el secreto puede trabajarlo.',
  'Nadie cruza el Cerco de Ceniza: quien entra en la niebla sale por donde entró, una hora después, con ceniza en el pelo. Ni la caza, ni los pájaros, ni los muertos.',
];

export const FACTIONS: Faction[] = [
  { id: 'fac_brezal', name: 'la aldea de Brezal', description: 'Los vecinos de Brezal, encerrados por la niebla. Desconfían de los forasteros hasta que hacen algo por la aldea; tosen gris y rezan en el pozo.' },
  { id: 'fac_regidor', name: 'la casona del regidor', description: 'Osric Malvez y los suyos (Garrán, Doro): el diezmo, la ronda del Lindero y el silencio sobre Vharn.' },
  { id: 'fac_vharn', name: 'la casa de Vharn', description: 'Lo que queda de los señores: Ysolde en el Granero Quemado, Tobías que le sirve, y Hal que le lleva caza.' },
];

export const CLUES: Clue[] = [
  { id: 'clue_pozo', title: 'Ceniza en el agua del pozo', reputation: 2, location_ids: ['loc_plaza'],
    how: 'Al sacar agua del pozo o mirar el cubo con atención: el agua trae ceniza fina, está tibia y huele a azufre. El pozo lo alimenta un manantial que pasa por debajo del granero de Vharn. Tirada de Percepción CD 11 o Naturaleza CD 10.' },
  { id: 'clue_hacha', title: 'El hacha con hollín', reputation: 2, location_ids: ['loc_claro'],
    how: 'Examinar de cerca el hacha de leñador del sendero del Soto: el hollín del mango es reciente y huele a resina quemada, no a leña de hogar; en el mango, grabadas a punta de cuchillo, las letras T. M. (Tobías, del molino). Alguien vuelve del Granero Quemado de noche. Investigación CD 10 o Supervivencia CD 10 al examinarla con intención.' },
  { id: 'clue_doro', title: 'Luces en el granero', reputation: 2, npc_ids: ['npc_doro'],
    how: 'Doro confiesa que ha visto luces en el Granero Quemado dos noches seguidas y, una de ellas, una figura por la senda del arroyo con un hatillo, pasadas las once. Sale si el PJ le trata como a un igual, le invita a algo o supera Persuasión CD 13; con Intimidación se cierra.' },
  { id: 'clue_brenna', title: 'La noche del incendio', reputation: 2, npc_ids: ['npc_brenna'],
    how: 'Brenna admite, a medias, que estuvo en Vharn la noche del incendio y que «no fue un accidente». Solo tras confianza ganada (devolverle a Ceniza, varias conversaciones) o Persuasión/Perspicacia CD 16. No da el nombre del culpable: dice que «está escrito, ahí abajo».' },
  { id: 'clue_trampilla', title: 'Lo que hay bajo la taberna', reputation: 2, location_ids: ['loc_taberna'],
    how: 'Descubrir la trampilla oculta bajo la alfombra de la mesa del fondo (Percepción/Investigación CD 14, o que Brenna la enseñe si es amiga) y bajar: un sótano con cajas marcadas con el sello de Vharn, tapadas con sacos. Brenna no quiere que se vea.' },
  { id: 'clue_libro', title: 'El libro de cuentas de Vharn', reputation: 2, location_ids: ['loc_sotano'],
    how: 'Leer el libro de cuentas escondido tras el último barril del sótano: la última página, del día del incendio, con la letra del señor de Vharn, apunta «plata del sello, cuarenta piezas, entregadas a O. Malvez, mayordomo, para su custodia». Al cogerlo lo concede el servidor.' },
  { id: 'clue_ilse', title: 'La Brasa de Vharn', reputation: 2, npc_ids: ['npc_ilse'], location_ids: ['loc_curandera'],
    how: 'Ilse explica, al ver la muestra de agua del pozo (lo concede el servidor) o con Persuasión/Religión CD 13, que los señores ataban en su cripta un fuego antiguo, la Brasa, enterrada ahora bajo el granero; que la tos gris es su ceniza; y que una ascua suelta se templa en el agua fría del pozo con los eslabones de hierro frío y unas palabras que ella enseña. De la niebla dice: «Es un cerrojo. Y los cerrojos tienen llave».' },
  { id: 'clue_hugo', title: 'La cadena de hierro frío', reputation: 2, npc_ids: ['npc_hugo'], location_ids: ['loc_herreria'],
    how: 'Hugo admite que guarda los últimos eslabones de la cadena que su maestro forjó para Vharn y que el regidor le ha ordenado fundirlos. Sale si el PJ le habla de su maestro o de la Brasa (sabiendo lo que contó Ilse), le ayuda con la deuda o supera Persuasión CD 14.' },
  { id: 'clue_tobias', title: 'Las cartas del desván', reputation: 2, location_ids: ['loc_molino'], npc_ids: ['npc_tobias'],
    how: 'Encontrar en el desván del molino (oculto, Investigación CD 12) las cartas firmadas con una brasa: «Echa la ceniza al pozo cada noche. Cuando entreguen al mayordomo, serás señor de Vharn». O que Tobías lo confiese (Intimidación/Persuasión CD 15, o CD 12 con las cartas delante).' },
  { id: 'clue_hal', title: 'Plata vieja en la choza', reputation: 2, npc_ids: ['npc_hal'], location_ids: ['loc_claro'],
    how: 'Hal cuenta que la caza no puede salir del valle, que la loba de la madriguera no es un lobo normal y que el granero «no está tan vacío como dicen». Si se le gana (le ayudan con la loba, le traen cerveza, Persuasión CD 13), admite que le lleva caza a «la mujer del granero» y que le paga con plata del sello.' },
  { id: 'clue_ysolde', title: 'La heredera de Vharn', reputation: 2, npc_ids: ['npc_ysolde'], location_ids: ['loc_ruinas'],
    how: 'Hablar con Ysolde en el Granero Quemado sin atacarla: dice quién es, que vio a «la mujer de la antorcha» llevársela y que la noche de la Brasa soltará el ascua en la plaza si el valle no le entrega al culpable. Si el PJ le enseña el libro de cuentas, duda por primera vez.' },
];

export const JOBS: Job[] = [
  { id: 'job_lena', title: 'Leña para la posada', text: 'Brenna paga por diez leños secos. Los del roble del Soto sirven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 10 }, reward_coins: 900, reward_reputation: 1 },
  { id: 'job_bayas', title: 'Bayas para la despensa', text: 'Brenna quiere diez bayas del Soto antes de que los pájaros se las lleven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_bayas', quantity: 10 }, reward_coins: 500, reward_reputation: 1 },
  { id: 'job_ronda', title: 'Ronda hasta el Soto', text: 'Doro no puede dejar el portón. Paga a quien vaya hasta el roble del Soto, mire si hay alguien y vuelva a contárselo.', giver_npc_id: 'npc_doro', kind: 'visit', visit_spot_id: 'sp_cl_roble', reward_coins: 600, reward_reputation: 1 },
  { id: 'job_fragua', title: 'Carbón para la fragua', text: 'Hugo necesita seis leños para que la fragua no se apague antes del jueves.', giver_npc_id: 'npc_hugo', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 6 }, reward_coins: 600, reward_reputation: 1 },
  { id: 'job_pescado', title: 'Pescado fresco', text: 'Cinco truchas del arroyo del Soto para la cena de la posada.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_pescado', quantity: 5 }, reward_coins: 800, reward_reputation: 1 },
  { id: 'job_toma', title: 'La toma del arroyo', text: 'Mateo paga a quien remonte la senda hasta el arroyo del Soto y mire qué atasca el agua que llega al molino.', giver_npc_id: 'npc_mateo', kind: 'visit', visit_spot_id: 'sp_cl_arroyo', reward_coins: 500, reward_reputation: 1 },
  { id: 'job_huevos', title: 'Huevos para la cena', text: 'Brenna quiere seis huevos de los Corrales de Úrsula para el guiso de mañana.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_huevo', quantity: 6 }, reward_coins: 400, reward_reputation: 1 },
  { id: 'job_cerca', title: 'La cerca del redil', text: 'Úrsula paga a quien le traiga cuatro leños para tapar el boquete del redil antes de que vuelvan los lobos.', giver_npc_id: 'npc_ursula', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 4 }, reward_coins: 450, reward_reputation: 1 },
];

export const ACHIEVEMENT: Achievement = {
  id: 'ach_ceniza', title: 'Quien ha mirado la ceniza', faction_id: 'fac_brezal', clues_required: 3, reputation_required: 5,
  reward_item_id: 'it_llave_vharn', reward_spot_id: 'sp_tab_trampilla',
  announcement: 'En Brezal empiezan a decir que {name} ha mirado la ceniza de frente. Brenna le ha enseñado la trampilla de la mesa del fondo y le ha dado una llave vieja con el sello de Vharn: abre el pasadizo bajo el altar del Granero Quemado.',
};

/**
 * Tres situaciones iniciales y dos de compañero. Todas empiezan a las 18:00 del primer día, con la misa del pozo a
 * dos horas, y vencen la noche de la Brasa. En multijugador no se repiten si hay otra libre; quien entra con
 * «Empezar junto a…» recibe la de compañero de la del otro (`companion_of`, con `{companion}` = su nombre).
 */
export const SITUATIONS: NonNullable<Campaign['situations']> = [
  {
    for_name: '', for_classes: ['wizard', 'sorcerer', 'warlock', 'cleric', 'druid', 'bard'], keep: true,
    situation: {
      id: 'sit_carta',
      why_here: 'Hace un mes te llegó una carta sin remite, lacrada con el sello de Vharn, una casa que ardió hace veinte años: «La Brasa despierta. Ven antes de que se cierre el valle». Llegaste la víspera de que bajara la niebla y ya no has podido irte.',
      wants: 'Saber quién te escribió, qué es la Brasa y qué cerrojo ha cerrado el valle antes de que alguien la use.',
      threat: 'El regidor, Osric Malvez, no quiere eruditos husmeando: dice que la niebla es la maldición de Vharn y vigila a quien pregunte por el granero.',
      clock_days: 3, clock_runs_out: 'Llega la noche de la Brasa: el ascua se suelta en la plaza y lo que ardió hace veinte años vuelve a arder, esta vez con el valle cerrado.',
      antagonist_npc_id: 'npc_osric', start_spot_id: 'sp_pl_pozo', start_hour: 18,
      paths: [
        'Buscar a Ilse, la curandera: es la única que aún reza por los de Vharn.',
        'Enseñar la carta en la taberna y mirar quién se pone pálido.',
        'Ir al Lindero y mirar la niebla de cerca.',
      ],
      opening: 'Llevas tres semanas callando la carta. Esta noche, junto al pozo, una vieja que prepara velas para la misa ve asomar el lacre, se le cae una vela al agua y te agarra la muñeca con una fuerza que no parece suya: «¿Quién te ha mandado eso?».',
      items: [{ item_id: 'it_carta_sello', quantity: 1 }],
      knows: ['npc_ilse'],
    },
  },
  {
    for_name: '', for_classes: ['fighter', 'barbarian', 'paladin', 'ranger', 'monk'], keep: true,
    situation: {
      id: 'sit_herrero',
      why_here: 'Tu padre fue el herrero de Vharn y murió en el incendio. Hugo, que fue su aprendiz, te mandó llamar: dice que tu padre dejó algo para ti y que «no fue el fuego lo que lo mató». Llegaste con el último carro antes de que bajara la niebla.',
      wants: 'Saber cómo murió tu padre y quién tiene la culpa.',
      threat: 'Osric Malvez, el regidor, era el mayordomo de Vharn aquella noche. Tiene a Hugo agarrado por una deuda y quiere que funda lo que guarda.',
      clock_days: 3, clock_runs_out: 'Garrán ha cerrado la herrería por deudas y, la noche de la Brasa, lo que dejó tu padre acaba en el crisol o bajo la ceniza.',
      antagonist_npc_id: 'npc_osric', start_spot_id: 'sp_he_banco', start_hour: 18,
      paths: [
        'Apretar a Hugo hasta que te enseñe lo que guarda.',
        'Pagar la deuda de Hugo con el regidor y mirarle a la cara al hacerlo.',
        'Preguntar en el Jabalí quién estuvo en Vharn aquella noche.',
      ],
      opening: 'Hugo cierra la puerta de la fragua a tu espalda y baja la voz: «Aquí no. El alguacil ha pasado dos veces hoy». Fuera, unas botas se paran delante de la puerta y no se van.',
      knows: ['npc_hugo', 'npc_garran'],
    },
  },
  {
    for_name: '', keep: true,
    situation: {
      id: 'sit_deuda',
      why_here: 'Llegaste a Brezal la víspera de que bajara la niebla, con fiebre y una herida de camino. Brenna te dio cama y la curandera te cosió; no tenías con qué pagar, y ahora tampoco tienes por dónde irte.',
      wants: 'Saldar lo que debes y salir del valle en cuanto la niebla lo permita, antes de que se te pegue su ceniza.',
      threat: 'Garrán, el alguacil del regidor, ha comprado tu deuda a Brenna. O pagas en tres días, o trabajas para el regidor: ir al Granero Quemado a «apagar las luces».',
      clock_days: 3, clock_runs_out: 'Garrán te quita lo que llevas de valor y te manda al Granero Quemado con una lanza en la espalda.',
      antagonist_npc_id: 'npc_garran', start_spot_id: 'sp_tab_mesa', start_hour: 18,
      paths: [
        'Pagar con trabajo honrado: el tablón, Brenna, los Corrales y el Soto dan monedas.',
        'Aceptar el encargo del regidor e ir al Granero Quemado a ver qué hay.',
        'Averiguar por qué el regidor quiere gente en el granero y usarlo contra él.',
      ],
      opening: 'Garrán deja caer en tu mesa una tablilla con tu nombre y una cifra, 300, y se sienta enfrente a esperar. «Tres días», dice, y te bebe la cerveza. «Y no pienses en la niebla: los deudores no pueden huir. Mejor».',
      debt: { npc_id: 'npc_garran', amount: 300, reason: 'la cama, la comida y la curandera del Jabalí; la deuda la compró el regidor' },
      knows: ['npc_brenna', 'npc_garran'],
    },
  },
  {
    for_name: '', keep: true, companion_of: 'sit_herrero',
    situation: {
      id: 'sit_herrero_companero',
      why_here: 'Llegaste con {companion} en el último carro antes de que bajara la niebla. Te pagó el viaje desde Valcruz a cambio de cubrirle la espalda, y de camino te contó lo de su padre, el herrero de Vharn, y lo que le escribió Hugo.',
      wants: 'Cobrar lo prometido y que {companion} sepa qué pasó con su padre; si en esa herrería hay algo de valor, que no se lo quede el regidor.',
      threat: 'Osric Malvez, el regidor, no quiere forasteros removiendo lo de Vharn, y su alguacil ya os ha visto entrar a los dos en la herrería.',
      clock_days: 3, clock_runs_out: 'Garrán cierra la herrería por deudas, lo que guarda Hugo acaba en el crisol y el regidor os señala a los dos como los forasteros que lo removieron todo.',
      antagonist_npc_id: 'npc_osric', start_spot_id: 'sp_he_banco', start_hour: 18,
      paths: [
        'Vigilar la puerta mientras {companion} habla con Hugo, y fijarte en quién ronda fuera.',
        'Preguntar en el Jabalí por el alguacil y por qué vigila la herrería.',
        'Juntar monedas para la deuda de Hugo con el tablón o en los Corrales.',
      ],
      opening: 'Hugo os mete a los dos en la herrería y echa la tranca. A ti apenas te mira: «Tú, a la puerta». Fuera, unas botas se paran delante y no se van.',
      knows: ['npc_hugo'],
    },
  },
  {
    for_name: '', keep: true, companion_of: 'sit_carta',
    situation: {
      id: 'sit_carta_companero',
      why_here: 'Viajas con {companion} desde hace un mes. Viste la carta lacrada con el sello de Vharn y no le dejaste venir solo; llegasteis la víspera de que bajara la niebla y ya no os habéis podido ir.',
      wants: 'Que {companion} averigüe quién le escribió sin acabar en una hoguera, y salir del valle en cuanto la niebla abra.',
      threat: 'El regidor, Osric Malvez, vigila a quien pregunta por el granero, y ya os ha visto juntos junto al pozo.',
      clock_days: 3, clock_runs_out: 'Llega la noche de la Brasa: el ascua se suelta en la plaza y lo que ardió hace veinte años vuelve a arder, esta vez con el valle cerrado.',
      antagonist_npc_id: 'npc_osric', start_spot_id: 'sp_pl_pozo', start_hour: 18,
      paths: [
        'Cubrir a {companion} mientras habla con la vieja de las velas.',
        'Ir a la taberna y escuchar qué se dice de la carta y de Vharn.',
        'Ir al Lindero y mirar la niebla de cerca.',
      ],
      opening: 'Estás a un paso de {companion} junto al pozo cuando una vieja que prepara velas para la misa ve asomar el lacre de la carta, se le cae una vela al agua y agarra a {companion} de la muñeca: «¿Quién te ha mandado eso?». Después te mira a ti, de arriba abajo.',
      knows: ['npc_ilse'],
    },
  },
];

/** Por dónde entra quien llega sin situación (personajes de antes de la historia, la partida principal). */
export const STARTING_POINTS: Campaign['starting_points'] = [
  { spot_id: 'sp_tab_puerta', origin: 'Llegó a Brezal como viajero la víspera de que bajara la niebla, con el polvo del camino del sur encima y la última moneda del último trabajo. Desde entonces no ha podido irse; la Taberna del Jabalí es lo más parecido a una casa que tiene.' },
  { spot_id: 'sp_pl_pozo', origin: 'Es de Brezal, o casi: se crió aquí y se fue joven. Volvió hace un mes, justo antes de que la niebla cerrara el valle, y la aldea le parece más pequeña y más callada de lo que recordaba.' },
  { spot_id: 'sp_cl_sendero', origin: 'Ha pasado la noche en el Soto, cazando o escondiéndose, según a quién se le pregunte. Vuelve hacia el pueblo con hambre y con la sensación de que la niebla, ahí al lado, está más cerca que ayer.' },
];
