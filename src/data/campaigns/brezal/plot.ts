/**
 * Brezal: la trama fija. La Biblia (lo que es verdad aunque nadie lo diga),
 * las leyes del mundo, las facciones, las pistas con su «cómo» para el
 * máster, los encargos del tablón (los bucles cortos), el logro y las tres
 * situaciones iniciales, que se reparten por clase de personaje.
 */

import type { Achievement, Campaign, Clue, Faction, Job } from '../../../engine/model.js';

export const PREMISE = 'Hace veinte años el fuego arrasó la ciudadela de Vharn y nadie ha vuelto a subir. La aldea de Brezal vive de espaldas a la montaña, pero el agua del pozo trae ceniza, los lobos bajan y de noche hay luz en la torre hundida.';

export const WELCOME = [
  'Hay nombres que la montaña pronuncia antes de que lleguen. Esta noche ha dicho uno nuevo: {name}.',
  '',
  'Abajo, Brezal enciende las velas para la misa del pozo. Lo que va a pasar allí no está escrito todavía.',
].join('\n');

/** Verdades ocultas del mundo: explican pistas y secretos. Consulta del máster, nunca se cuentan tal cual. */
export const BIBLE: string[] = [
  'Los señores de Vharn ataban en la cripta de su ciudadela un fuego antiguo, la Brasa, con cadenas de hierro frío; mientras dormía atada, el valle era fértil y el agua del arroyo bajaba fría.',
  'El incendio de hace veinte años no fue un accidente: Osric Malvez, entonces mayordomo de Vharn, robó la plata del sello y prendió el granero para taparlo. El fuego llegó a la cripta, rompió las cadenas y mató a los señores y a medio servicio, entre ellos al herrero de Vharn y al hermano de Brenna.',
  'Brenna, que servía en las cocinas, vio a Osric con la antorcha y sacó del fuego a la niña de los señores, Ysolde. Osric le dio la Taberna del Jabalí a cambio de callar; ella guarda en el sótano el libro de cuentas de Vharn, que apunta la plata entregada a «O. Malvez» aquella noche.',
  'Ysolde Vharn ha vuelto: vive en la torre hundida con una ascua de la Brasa en la mano. Recuerda a una mujer con una antorcha llevándosela y cree que Brenna prendió el fuego. Quiere que el valle confiese y, si no, soltar la Brasa en la noche de luna nueva.',
  'La Brasa despierta: calienta la montaña, la caza huye y los lobos bajan; su ceniza sube por el manantial. Además, Tobías, el hijo del molinero, echa cada noche ceniza de la cripta al pozo por encargo de Ysolde: de ahí la tos gris.',
  'La Brasa solo se vuelve a atar con tres cosas: la llave de los Vharn para abrir la cripta, los últimos eslabones de hierro frío (los guarda Hugo bajo una losa de su herrería) y las palabras del altar, que solo Ilse, la última sacerdotisa, sabe leer y enseñar.',
  'Osric sabe que alguien vive en las ruinas. Manda a deudores a «apagar las luces» por cuenta suya a través de Garrán, y ha ordenado a Hugo fundir los eslabones. Guarda en su arcón una copa de plata con el sello que no se atrevió a fundir.',
  'La loba de ceniza que vive en la lobera de la cuesta bajó de la cumbre caliente; no ataca a quien lleva encima ceniza de la cripta. Tiene acorralado a Ceniza, el perro de Brenna.',
];

export const LAWS: string[] = [
  'La magia es rara y temida: solo la lanza quien tiene el conjuro; la Brasa no se usa como un arma, quema a quien la toca sin el guante de Ysolde.',
  'No hay tecnología moderna: ni pólvora, ni motores; hierro, madera, cuerda y fuego.',
  'Nada sale de la nada: lo que el personaje no lleva encima ni está en el mundo no aparece en sus manos.',
  'El cuerpo tiene límites: la fuerza, la velocidad y el aguante son los de la ficha; los prodigios piden tirada y pueden fallar.',
  'Los muertos no vuelven: ni los señores de Vharn ni nadie que caiga en esta historia.',
  'El hierro frío no se calienta ni se funde con fuego de fragua corriente: solo un herrero que conozca el secreto puede trabajarlo.',
];

export const FACTIONS: Faction[] = [
  { id: 'fac_brezal', name: 'la aldea de Brezal', description: 'Los vecinos de Brezal. Desconfían de los forasteros hasta que hacen algo por la aldea; tosen gris y rezan en el pozo.' },
  { id: 'fac_regidor', name: 'la casona del regidor', description: 'Osric Malvez y los suyos (Garrán, Doro): el diezmo, el portón cerrado y el silencio sobre Vharn.' },
  { id: 'fac_vharn', name: 'la casa de Vharn', description: 'Lo que queda de los señores: Ysolde en la torre, Tobías que le sirve, y Hal que le lleva caza.' },
];

export const CLUES: Clue[] = [
  { id: 'clue_pozo', title: 'Ceniza en el agua del pozo', reputation: 2, location_ids: ['loc_plaza'],
    how: 'Al sacar agua del pozo o mirar el cubo con atención: el agua trae ceniza fina, está tibia y huele a azufre. El pozo lo alimenta un arroyo que baja de la montaña. Tirada de Percepción CD 11 o Naturaleza CD 10.' },
  { id: 'clue_hacha', title: 'El hacha con hollín', reputation: 2, location_ids: ['loc_claro'],
    how: 'Examinar de cerca el hacha de leñador del sendero: el hollín del mango es reciente y huele a resina quemada, no a leña de hogar; en el mango, grabadas a punta de cuchillo, las letras T. M. (Tobías, del molino). Alguien bajó de la montaña hace pocos días. Investigación CD 10 o Supervivencia CD 10 al examinarla con intención.' },
  { id: 'clue_doro', title: 'Luces en la ciudadela', reputation: 2, npc_ids: ['npc_doro'],
    how: 'Doro confiesa que ha visto luces arriba dos noches seguidas y, una de ellas, una figura bajando por la senda del arroyo con un hatillo, pasada la medianoche. Sale si el PJ le trata como a un igual, le invita a algo o supera Persuasión CD 13; con Intimidación se cierra.' },
  { id: 'clue_brenna', title: 'La noche del incendio', reputation: 2, npc_ids: ['npc_brenna'],
    how: 'Brenna admite, a medias, que estuvo en Vharn la noche del incendio y que «no fue un accidente». Solo tras confianza ganada (devolverle a Ceniza, varias conversaciones) o Persuasión/Perspicacia CD 16. No da el nombre del culpable: dice que «está escrito, ahí abajo».' },
  { id: 'clue_trampilla', title: 'Lo que hay bajo la taberna', reputation: 2, location_ids: ['loc_taberna'],
    how: 'Descubrir la trampilla oculta bajo la alfombra de la mesa del fondo (Percepción/Investigación CD 14, o que Brenna la enseñe si es amiga) y bajar: un sótano con cajas marcadas con el sello de Vharn, tapadas con sacos. Brenna no quiere que se vea.' },
  { id: 'clue_libro', title: 'El libro de cuentas de Vharn', reputation: 2, location_ids: ['loc_sotano'],
    how: 'Leer el libro de cuentas escondido tras el último barril del sótano: la última página, del día del incendio, con la letra del señor de Vharn, apunta «plata del sello, cuarenta piezas, entregadas a O. Malvez, mayordomo, para su custodia». Al cogerlo lo concede el servidor.' },
  { id: 'clue_ilse', title: 'La Brasa de Vharn', reputation: 2, npc_ids: ['npc_ilse'], location_ids: ['loc_curandera'],
    how: 'Ilse explica, al ver la muestra de agua del pozo (lo concede el servidor) o con Persuasión/Religión CD 13, que los señores ataban en la cripta un fuego antiguo, la Brasa; que la tos gris es su ceniza; y que se puede volver a atar con la llave de los Vharn, los eslabones de hierro frío y las palabras del altar, que ella enseña.' },
  { id: 'clue_hugo', title: 'La cadena de hierro frío', reputation: 2, npc_ids: ['npc_hugo'], location_ids: ['loc_herreria'],
    how: 'Hugo admite que guarda los últimos eslabones de la cadena que su maestro forjó para Vharn y que el regidor le ha ordenado fundirlos. Sale si el PJ le habla de su maestro o de la Brasa (sabiendo lo que contó Ilse), le ayuda con la deuda o supera Persuasión CD 14.' },
  { id: 'clue_tobias', title: 'Las cartas del desván', reputation: 2, location_ids: ['loc_molino'], npc_ids: ['npc_tobias'],
    how: 'Encontrar en el desván del molino (oculto, Investigación CD 12) las cartas firmadas con una brasa: «Echa la ceniza al pozo cada noche. Cuando entreguen al mayordomo, serás señor de la torre». O que Tobías lo confiese (Intimidación/Persuasión CD 15, o CD 12 con las cartas delante).' },
  { id: 'clue_hal', title: 'Plata vieja en la choza', reputation: 2, npc_ids: ['npc_hal'], location_ids: ['loc_claro'],
    how: 'Hal cuenta que la caza huyó porque la montaña está caliente, que la loba de la lobera no es un lobo normal y enseña el camino seguro de la cuesta. Si se le gana (le ayudan con la loba, le traen cerveza, Persuasión CD 13), admite que le lleva caza a «la mujer de la torre» y que le paga con plata del sello.' },
  { id: 'clue_ysolde', title: 'La heredera de Vharn', reputation: 2, npc_ids: ['npc_ysolde'], location_ids: ['loc_ruinas'],
    how: 'Hablar con Ysolde en las ruinas sin atacarla: dice quién es, que vio a «la mujer de la antorcha» llevársela y que en la noche de luna nueva soltará la Brasa si el valle no le entrega al culpable. Si el PJ le enseña el libro de cuentas, duda por primera vez.' },
];

export const JOBS: Job[] = [
  { id: 'job_lena', title: 'Leña para la posada', text: 'Brenna paga por diez leños secos. Los del roble del claro sirven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 10 }, reward_coins: 900, reward_reputation: 1 },
  { id: 'job_bayas', title: 'Bayas para la despensa', text: 'Brenna quiere diez bayas del claro antes de que los pájaros se las lleven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_bayas', quantity: 10 }, reward_coins: 500, reward_reputation: 1 },
  { id: 'job_ronda', title: 'Ronda hasta el claro', text: 'Doro no puede dejar el portón. Paga a quien vaya hasta el roble del claro, mire si hay alguien y vuelva a contárselo.', giver_npc_id: 'npc_doro', kind: 'visit', visit_spot_id: 'sp_cl_roble', reward_coins: 600, reward_reputation: 1 },
  { id: 'job_fragua', title: 'Carbón para la fragua', text: 'Hugo necesita seis leños para que la fragua no se apague antes del jueves.', giver_npc_id: 'npc_hugo', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 6 }, reward_coins: 600, reward_reputation: 1 },
  { id: 'job_pescado', title: 'Pescado fresco', text: 'Cinco truchas del arroyo del claro para la cena de la posada.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_pescado', quantity: 5 }, reward_coins: 800, reward_reputation: 1 },
  { id: 'job_toma', title: 'La toma del arroyo', text: 'Mateo paga a quien suba por la senda hasta el arroyo del claro y mire qué atasca el agua que llega al molino.', giver_npc_id: 'npc_mateo', kind: 'visit', visit_spot_id: 'sp_cl_arroyo', reward_coins: 500, reward_reputation: 1 },
];

export const ACHIEVEMENT: Achievement = {
  id: 'ach_ceniza', title: 'Quien ha mirado la ceniza', faction_id: 'fac_brezal', clues_required: 3, reputation_required: 5,
  reward_item_id: 'it_llave_vharn', reward_spot_id: 'sp_tab_trampilla',
  announcement: 'En Brezal empiezan a decir que {name} ha mirado la ceniza de frente. Brenna le ha enseñado la trampilla de la mesa del fondo y le ha dado una llave vieja con el sello de Vharn: abre la cripta de la ciudadela.',
};

/** Tres situaciones iniciales. Todas empiezan a las 18:00 del primer día, con la misa del pozo a dos horas. */
export const SITUATIONS: NonNullable<Campaign['situations']> = [
  {
    for_name: '', for_classes: ['wizard', 'sorcerer', 'warlock', 'cleric', 'druid', 'bard'], keep: true,
    situation: {
      why_here: 'Hace un mes te llegó una carta sin remite, lacrada con el sello de Vharn, una casa que ardió hace veinte años: «La Brasa despierta. Sube antes de la luna nueva».',
      wants: 'Saber quién te escribió y qué es la Brasa antes de que alguien la use.',
      threat: 'El regidor, Osric Malvez, no quiere eruditos husmeando: ha dado orden de que nadie suba a la montaña y vigila a quien pregunte por Vharn.',
      clock_days: 5, clock_runs_out: 'Llega la luna nueva: la Brasa se suelta y lo que ardió hace veinte años vuelve a arder, esta vez abajo.',
      antagonist_npc_id: 'npc_osric', start_spot_id: 'sp_pl_pozo', start_hour: 18,
      paths: [
        'Buscar a Ilse, la curandera: es la única que aún reza por los de Vharn.',
        'Enseñar la carta en la taberna y mirar quién se pone pálido.',
        'Subir a la montaña por tu cuenta, de noche, pasando a Doro.',
      ],
      opening: 'Junto al pozo, una vieja prepara velas para la misa. Ve asomar el lacre de tu carta, se le cae una vela al agua y te agarra la muñeca con una fuerza que no parece suya: «¿Quién te ha mandado eso?».',
      items: [{ item_id: 'it_carta_sello', quantity: 1 }],
      knows: ['npc_ilse'],
    },
  },
  {
    for_name: '', for_classes: ['fighter', 'barbarian', 'paladin', 'ranger', 'monk'], keep: true,
    situation: {
      why_here: 'Tu padre fue el herrero de Vharn y murió en el incendio. Hugo, que fue su aprendiz, te ha mandado llamar: dice que tu padre dejó algo para ti y que «no fue el fuego lo que lo mató».',
      wants: 'Saber cómo murió tu padre y quién tiene la culpa.',
      threat: 'Osric Malvez, el regidor, era el mayordomo de Vharn aquella noche. Tiene a Hugo agarrado por una deuda y quiere que funda lo que guarda.',
      clock_days: 4, clock_runs_out: 'Garrán cierra la herrería por deudas y lo que dejó tu padre acaba en el crisol.',
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
      why_here: 'Llegaste a Brezal hace tres noches con fiebre y una herida de camino. Brenna te dio cama y la curandera te cosió; no tenías con qué pagar.',
      wants: 'Saldar lo que debes y largarte del valle antes de que se te pegue su ceniza.',
      threat: 'Garrán, el alguacil del regidor, ha comprado tu deuda a Brenna. O pagas en tres días, o trabajas para el regidor: subir a Vharn a «apagar las luces».',
      clock_days: 3, clock_runs_out: 'Garrán te quita lo que llevas de valor y te manda cuesta arriba con una lanza en la espalda.',
      antagonist_npc_id: 'npc_garran', start_spot_id: 'sp_tab_mesa', start_hour: 18,
      paths: [
        'Pagar con trabajo honrado: el tablón, Brenna y el bosque dan monedas.',
        'Aceptar el encargo del regidor y subir a Vharn a ver qué hay.',
        'Averiguar por qué el regidor quiere gente arriba y usarlo contra él.',
      ],
      opening: 'Garrán deja caer en tu mesa una tablilla con tu nombre y una cifra, 300, y se sienta enfrente a esperar. «Tres días», dice, y te bebe la cerveza.',
      debt: { npc_id: 'npc_garran', amount: 300, reason: 'la cama, la comida y la curandera del Jabalí; la deuda la compró el regidor' },
      knows: ['npc_brenna', 'npc_garran'],
    },
  },
];

/** Por dónde entra quien llega sin situación (personajes de antes de la historia, la partida principal). */
export const STARTING_POINTS: Campaign['starting_points'] = [
  { spot_id: 'sp_tab_puerta', origin: 'Llega a Brezal como viajero, con el polvo del camino del sur encima y la última moneda del último trabajo. La Taberna del Jabalí es lo primero que encuentra con la puerta abierta.' },
  { spot_id: 'sp_pl_pozo', origin: 'Es de Brezal, o casi: se crió aquí y se fue joven. Vuelve tras años fuera y la aldea le parece más pequeña y más callada de lo que recordaba.' },
  { spot_id: 'sp_cl_sendero', origin: 'Ha pasado la noche en el bosque de Fresnos, cazando o escondiéndose, según a quién se le pregunte. Baja hacia el claro con hambre y con la sensación de que algo en la montaña ha cambiado.' },
];
