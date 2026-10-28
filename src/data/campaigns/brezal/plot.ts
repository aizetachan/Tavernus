/**
 * Brezal sellada: la trama fija. La Biblia (lo que es verdad aunque nadie lo
 * diga, con el origen del Cerco), las leyes del mundo, las facciones, las
 * pistas con su «cómo» para el máster, los encargos del tablón (los bucles
 * cortos), el logro y las tres situaciones iniciales, que se reparten por
 * clase de personaje y vencen a la vez que la amenaza: a los tres días.
 */

import type { Achievement, Campaign, Clue, Faction, Job, LawRules, TrustTier } from '../../../engine/model.js';
import type { StoryCondition } from '../../../engine/story.js';

export const PREMISE = 'Hace veinte años el fuego arrasó a los señores de Vharn y nadie ha vuelto a remover sus ruinas. Hace tres semanas una niebla gris bajó del monte y cerró el valle: quien entra en ella sale por donde entró. Dentro, la aldea de Brezal tose ceniza, los lobos rondan los corrales y de noche hay luz en el granero quemado.';

export const WELCOME = [
  'Hay nombres que el valle pronuncia antes de que lleguen. Esta noche ha dicho uno nuevo: {name}.',
  '',
  'Las puertas de Brezal siguen abiertas. Es el mundo el que se ha cerrado. Abajo, en la plaza, encienden las velas para la misa del pozo.',
].join('\n');

/** Verdades ocultas del mundo: explican pistas y secretos. Consulta del máster, nunca se cuentan tal cual. */
export const BIBLE: string[] = [
  'Los señores de Vharn ataban en la cripta de su granero, bajo la capilla, un fuego antiguo, la Brasa, con cadenas de hierro frío; mientras dormía atada, el valle era fértil y el agua del manantial bajaba fría.',
  'El incendio de hace veinte años no fue un accidente: Osric Malvez, entonces mayordomo de Vharn, robó la plata del sello y prendió el granero para taparlo, la noche en que el valle prestaba la lumbre. El fuego llegó a la cripta, rompió las cadenas, la derrumbó y mató a los señores y a medio servicio, entre ellos al hermano de Brenna y al herrero de Vharn, que vio a Osric con la plata: Garrán, entonces su mozo, le atrancó la puerta de la fragua.',
  'Brenna, que servía en las cocinas, vio a Osric con la antorcha y sacó del fuego a la niña de los señores, Ysolde. Osric le dio la Taberna del Jabalí a cambio de callar; ella guarda en el sótano el libro de cuentas de Vharn, que apunta la plata entregada a «O. Malvez» aquella noche.',
  'Ysolde Vharn ha vuelto: se esconde en el pajar del Granero Quemado con una ascua de la Brasa en el guante. Recuerda a una mujer con una antorcha llevándosela y cree que Brenna prendió el fuego. Quiere que el valle confiese y, si no, soltar el ascua en la plaza la noche de la Brasa.',
  'La Brasa grande sigue enterrada bajo el granero, fuera de alcance, y respira: calienta el manantial que alimenta el pozo y la caza huye. Además, Tobías, el hijo del molinero, echa cada noche al pozo ceniza de las grietas del altar por encargo de Ysolde: de ahí la tos gris.',
  'El ascua de Ysolde se puede templar: sumergida en el agua fría del manantial, el pozo, con los últimos eslabones de hierro frío sujetos (los guarda Hugo bajo una losa de su herrería) y diciendo las palabras que solo Ilse, la última sacerdotisa, sabe. Templarla apaga la tos y afloja el Cerco, pero no lo abre.',
  'El Cerco de Ceniza es la Guarda de Vharn: un conjuro de contención que los primeros señores levantaron para cerrar el valle cuando la Brasa se agita, y que quedó dormido sin nadie que lo alimentase. Despertó hace tres semanas, cuando Ysolde, la última de la sangre, volvió con el ascua. Es un conjuro protector que se ha vuelto cárcel: no hay villano al que matar para abrirlo.',
  'La Guarda tiene tres anclajes con el sello de Vharn: el del valle (el mojón del Lindero, ligado al pozo y al ascua), el del bosque (la Lobera, al otro lado de la niebla) y el de las minas de plata. Esta historia solo puede templar el primero; los otros dos esperan fuera.',
  'Osric sabe que alguien vive en el granero. Manda a deudores a «apagar las luces» por cuenta suya a través de Garrán, y ha ordenado a Hugo fundir los eslabones. Guarda en su arcón una copa de plata con el sello que no se atrevió a fundir, y en la casona una bodega tapiada por si algún día tiene que esconderse: del valle ya no puede huir nadie.',
  'La loba de ceniza bajó de la montaña cuando empezó a arder por dentro y la niebla la encerró en el Soto, en una madriguera al pie del roble; no ataca a quien lleva encima ceniza del granero. Tiene acorralado a Ceniza, el perro de Brenna.',
];

/** Costumbres de Brezal: lo que la gente hace y dice sin explicarlo. Detalle de fondo para el máster, no pistas. */
export const CUSTOMS: string[] = [
  'Antes el valle se gobernaba con el señor de Vharn y cinco oficios: la llama (la sacerdotisa, hoy Ilse), el pan (el molino), el hierro (la herrería), la tierra (los Corrales) y la mesa (la cocina de Vharn, donde servía Brenna). Osric disolvió ese consejo al comprar el cargo.',
  'Antes del incendio, una noche al año cada hogar subía un ascua al fuego común del granero de Vharn y volvía a por ella al alba: prestar la lumbre («fuego prestado, deuda de un año»). El incendio fue esa noche; desde entonces es la noche muda y no se celebra.',
  'Junto al pozo no se miente, pero se puede callar: por eso allí se habla poco. Un papel solo vale si se lee en voz alta junto al pozo, ante testigos.',
  'En la misa del pozo, Ilse dice cada noche el nombre de uno de los muertos de Vharn con su oficio y una manía, y todos responden «aguarda». Al nombre de Pol, el hijo de Úrsula, se hace silencio: no es del fuego.',
  'El forastero necesita un fiador, que pone la mano abierta sobre su jarra ante dos testigos. Lo primero que se le pregunta es «¿a quién has dejado atrás?», y hasta que contesta nadie le cuenta nada. En el Jabalí su primer plato se paga con una noticia.',
  'Cuando alguien se va, se ata un mechón suyo con hilo rojo al clavo del dintel. Cuando alguien muere, se dice qué le gustaba comer, su jarra del Jabalí se cuelga boca abajo y cada vecino lleva un tizón a su casa para encenderle el fuego.',
  'Es de mala educación tener las manos quietas: las confidencias se cuentan pelando, hilando o trenzando cuerda, sin mirarse a los ojos.',
  'En la mesa del Jabalí, mientras el caldo humea no se cuentan muertos.',
  'Al cruzarse al anochecer se saluda «¿Prendes?» y se responde «Aún». Quien no contesta «aún» ha perdido a alguien.',
  'Los mayores cuentan su edad en años «de antes» y «de después» del fuego. En la casona llaman al incendio «el accidente de Vharn»; en el pueblo, «la Noche del Granero».',
  'Cada noche, en cada casa, se entierra el rescoldo bajo ceniza diciendo «duerme, viejo», y nadie sabe por qué. Bajo el dintel de cada puerta hubo una marca que casi todos han encalado. Los niños cantan una rima de corro que nadie entiende, y las mujeres otra para amasar.',
  'Osric no dice «diezmo» sino «ofrenda de vecindad»; en su boca «apagar las luces» es quemar, «dar aire» es echar de casa y «cerrar la cuenta» es matar. El pueblo los traduce todos.',
  'La ceniza vale: se hace lejía, abono y jabón, se curten pieles y se cura el queso. El brezo da escobas, techos, colchones y cerveza. Se come pan negro con costra de ceniza, gachas de centeno ahumado y queso curado en ceniza.',
  'Refranes: «Cada casa guarda algo que no sabe tirar». «Lo que tapas con ceniza sigue vivo». «No hay mañana en la fragua». «Lo que te sacan del fuego es de quien te sacó». «Si Garrán busca un lobo, lo encuentra».',
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

/**
 * La ley de Brezal (crime.ts). Garrán, el alguacil, y Doro, el guardia del
 * portón, son la autoridad: dan el alto y detienen. Encierran en el calabozo
 * de la casona; lo leve se paga en monedas. Cada local tiene su dueño, que no
 * sirve ni aloja a quien sabe culpable. Hal y Úrsula no se callan: corren a
 * avisar o se meten; Mateo, Tobías e Ilse huyen.
 */
export const LAW: LawRules = {
  faction_id: 'fac_brezal',
  enforcers: ['npc_garran', 'npc_doro'],
  jail_spot_id: 'sp_ca_calabozo',
  fines: { insult: 0, theft: 50, assault: 30, armed_assault: 100, desecration: 100 },
  jail_hours: { armed_assault: 8, desecration: 8, murder: 24 },
  owners: [
    { npc_id: 'npc_brenna', location_ids: ['loc_taberna', 'loc_sotano'] },
    { npc_id: 'npc_hugo', location_ids: ['loc_herreria'] },
    { npc_id: 'npc_osric', location_ids: ['loc_casona'] },
    { npc_id: 'npc_ilse', location_ids: ['loc_curandera'] },
    { npc_id: 'npc_mateo', location_ids: ['loc_molino'] },
    { npc_id: 'npc_ursula', location_ids: ['loc_corrales'] },
  ],
  temperament: { npc_hal: 'brave', npc_ursula: 'brave', npc_mateo: 'timid', npc_tobias: 'timid', npc_ilse: 'timid' },
};

export const FACTIONS: Faction[] = [
  { id: 'fac_brezal', name: 'la aldea de Brezal', description: 'Los vecinos de Brezal, encerrados por la niebla. Desconfían de los forasteros hasta que hacen algo por la aldea; tosen gris y rezan en el pozo.' },
  { id: 'fac_regidor', name: 'la casona del regidor', description: 'Osric Malvez y los suyos (Garrán, Doro): el diezmo, la ronda del Lindero y el silencio sobre Vharn.' },
  { id: 'fac_vharn', name: 'la casa de Vharn', description: 'Lo que queda de los señores: Ysolde en el Granero Quemado, Tobías que le sirve, y Hal que le lleva caza.' },
];

/**
 * Pistas: qué revela cada una (`how`) y por dónde se consigue (`sources`), con lo que pide cada camino. grant_clue
 * solo la da si el PJ tiene abierto alguno; si no, devuelve el motivo para que el máster lo narre. Las que salen de
 * una persona piden su confianza (src/engine/trust.ts): ninguna pista clave sale en la primera charla con un
 * extraño. Las clave (`key`) tienen al menos dos caminos (otra persona, otro sitio o la misión que la da), por si
 * muere quien la sabe o no se fía nunca.
 */
const trust = (npc_id: string, at_least: TrustTier): StoryCondition => ({ kind: 'trust', npc_id, at_least });
const clue = (clue_id: string): StoryCondition => ({ kind: 'clue', clue_id });
const carry = (item_id: string): StoryCondition => ({ kind: 'carry', item_id });

export const CLUES: Clue[] = [
  { id: 'clue_pozo', title: 'El agua turbia del pozo', reputation: 2, location_ids: ['loc_plaza'],
    image: 'un cubo de madera con agua turbia y un poso de ceniza gris fina en el fondo, sobre el brocal de piedra de un pozo',
    how: 'El agua trae ceniza fina, está tibia y huele a azufre. El pozo lo alimenta un manantial que pasa por debajo del granero de Vharn.',
    sources: [{ via: 'Sacar agua del pozo o mirar el cubo con atención: Percepción CD 11 o Naturaleza CD 10.', location_id: 'loc_plaza' }] },
  { id: 'clue_hacha', title: 'El hacha con hollín', reputation: 2, location_ids: ['loc_claro'],
    image: 'el mango de un hacha de leñador manchado de hollín reciente, con las letras T. M. grabadas a punta de cuchillo',
    how: 'El hollín del mango del hacha del sendero es reciente y huele a resina quemada, no a leña de hogar; en el mango, grabadas a punta de cuchillo, las letras T. M. (Tobías, del molino). Alguien vuelve del Granero Quemado de noche.',
    sources: [{ via: 'Examinar de cerca el hacha de leñador del sendero del Soto: Investigación CD 10 o Supervivencia CD 10, mirándola con intención.', location_id: 'loc_claro' }] },
  { id: 'clue_doro', title: 'Luces en el granero', reputation: 2, key: true, npc_ids: ['npc_doro'], location_ids: ['loc_claro'],
    how: 'Doro ha visto luces en el Granero Quemado dos noches seguidas y, una de ellas, una figura por la senda del arroyo con un hatillo, pasadas las once.',
    sources: [
      { via: 'Que Doro lo confiese: hace falta que se fíe (amigo), o que ya le conozca (conocido) después de la cena del portón. Con Intimidación se cierra.', npc_id: 'npc_doro',
        requires: { kind: 'any', of: [trust('npc_doro', 'friend'), { kind: 'all', of: [trust('npc_doro', 'acquaintance'), { kind: 'quest', quest_id: 'q_cena_doro' }] }] },
        refusal: 'Doro se ríe de su propio chiste un poco tarde y mira al suelo: a un desconocido no le cuenta lo que vio' },
      { via: 'Verlo con sus propios ojos: esperar de noche en el arroyo del Soto cuando pasa la figura del hatillo, con las luces del granero al fondo.', location_id: 'loc_claro',
        requires: { kind: 'npc_at', npc_id: 'npc_tobias', spot_id: 'sp_cl_arroyo' },
        refusal: 'por la senda del arroyo no pasa nadie ahora; quizá de noche, más tarde' },
    ] },
  { id: 'clue_brenna', title: 'La noche del incendio', reputation: 2, key: true, npc_ids: ['npc_brenna', 'npc_hugo'],
    how: 'El incendio de Vharn no fue un accidente. Brenna estuvo allí esa noche y dice que «está escrito, ahí abajo»; el maestro de Hugo murió encerrado en la fragua. Ninguno da el nombre del culpable.',
    sources: [
      { via: 'Brenna lo admite a medias si se fía de ti (amigo: devolverle a Ceniza, varias charlas).', npc_id: 'npc_brenna', requires: trust('npc_brenna', 'friend'),
        refusal: 'Brenna seca la jarra más deprisa y cambia de tema hacia el precio de la cerveza: aún no se fía de ti' },
      { via: 'Hugo cuenta, si se fía de ti (amigo), que su maestro dijo antes de morir que no fue el fuego lo que lo mató: lo encerraron.', npc_id: 'npc_hugo', requires: trust('npc_hugo', 'friend'),
        refusal: 'Hugo vuelve al yunque: dos golpes, silencio, otros dos. De su maestro no habla con cualquiera' },
    ] },
  { id: 'clue_trampilla', title: 'Lo que hay bajo la taberna', reputation: 2, location_ids: ['loc_taberna'],
    image: 'una trampilla de madera entreabierta bajo una alfombra apartada, y abajo, en la penumbra, cajas tapadas con sacos con un sello en forma de brasa',
    how: 'Bajo la alfombra de la mesa del fondo, una trampilla al sótano: cajas marcadas con el sello de Vharn, tapadas con sacos. Brenna no quiere que se vea.',
    sources: [
      { via: 'Descubrir la trampilla oculta (Percepción o Investigación CD 14) y bajar.', location_id: 'loc_taberna' },
      { via: 'Que Brenna la enseñe, si es amiga.', npc_id: 'npc_brenna', requires: trust('npc_brenna', 'friend'), refusal: 'Brenna no enseña su casa a quien no conoce' },
    ] },
  { id: 'clue_libro', title: 'El libro de cuentas de Vharn', reputation: 2, key: true, location_ids: ['loc_sotano'],
    image: 'un libro de cuentas viejo abierto por la última página, con letra apretada a tinta y el borde chamuscado',
    how: 'La última página del libro de cuentas, del día del incendio, con la letra del señor de Vharn: «plata del sello, cuarenta piezas, entregadas a O. Malvez, mayordomo, para su custodia».',
    sources: [{ via: 'Leer el libro escondido tras el último barril del sótano (al cogerlo lo concede el servidor; también en «Bajo el Jabalí»).', location_id: 'loc_sotano' }] },
  { id: 'clue_ilse', title: 'La Brasa de Vharn', reputation: 2, key: true, npc_ids: ['npc_ilse', 'npc_ysolde'], location_ids: ['loc_curandera'],
    how: 'Los señores ataban en su cripta un fuego antiguo, la Brasa, enterrada ahora bajo el granero; la tos gris es su ceniza; una ascua suelta se templa en el agua fría del pozo con los eslabones de hierro frío y unas palabras que Ilse enseña. De la niebla: «Es un cerrojo. Y los cerrojos tienen llave».',
    sources: [
      { via: 'Ilse lo explica al ver la muestra de agua del pozo (lo concede el servidor en «El agua turbia») o si se fía de ti (amigo).', npc_id: 'npc_ilse', requires: trust('npc_ilse', 'friend'),
        refusal: 'Ilse te mira con sus ojos de agua y habla de hierbas y de la tos: de lo de Vharn no habla con quien acaba de conocer' },
      { via: 'Ysolde cuenta qué es la Brasa que lleva en el guante y que la grande duerme bajo el granero, si ya te conoce (no sabe templarla).', npc_id: 'npc_ysolde', requires: trust('npc_ysolde', 'acquaintance'),
        refusal: 'Ysolde aprieta el guante y te pregunta otra vez quién te manda' },
    ] },
  { id: 'clue_hugo', title: 'La cadena de hierro frío', reputation: 2, key: true, npc_ids: ['npc_hugo'], location_ids: ['loc_herreria'],
    how: 'Hugo guarda bajo la losa suelta, junto al yunque, los últimos eslabones de la cadena de hierro frío que su maestro forjó para Vharn, y el regidor le ha ordenado fundirlos.',
    sources: [
      { via: 'Hugo lo admite si se fía de ti (amigo), o si ya te conoce y le hablas de su maestro o de la Brasa sabiendo lo que contó Ilse.', npc_id: 'npc_hugo',
        requires: { kind: 'any', of: [trust('npc_hugo', 'friend'), { kind: 'all', of: [trust('npc_hugo', 'acquaintance'), clue('clue_ilse')] }] },
        refusal: 'Hugo dice «mañana» y vuelve al yunque: con un desconocido no habla de la obra de su maestro' },
      { via: 'Encontrar la losa suelta junto al yunque (oculta) y ver los eslabones con la marca del maestro de Vharn.', location_id: 'loc_herreria',
        requires: { kind: 'any', of: [{ kind: 'discovered', spot_id: 'sp_he_losa' }, carry('it_cadena_fria')] },
        refusal: 'en la herrería no hay nada a la vista que no sea hierro corriente' },
    ] },
  { id: 'clue_tobias', title: 'Las cartas del desván', reputation: 2, key: true, location_ids: ['loc_molino'], npc_ids: ['npc_tobias'],
    how: 'Las cartas firmadas con una brasa: «Echa la ceniza al pozo cada noche. Cuando entreguen al mayordomo, serás señor de Vharn». Tobías es quien envenena el pozo.',
    sources: [
      { via: 'Encontrar las cartas en el desván del molino (oculto, Investigación CD 12).', location_id: 'loc_molino',
        requires: { kind: 'any', of: [{ kind: 'discovered', spot_id: 'sp_mo_desvan' }, carry('it_cartas_tobias')] },
        refusal: 'en el molino solo hay harina y sacos a la vista' },
      { via: 'Que Tobías lo confiese: si se fía de ti (amigo) o con las cartas o la bolsa de ceniza delante (Intimidación o Persuasión CD 12).', npc_id: 'npc_tobias',
        requires: { kind: 'any', of: [trust('npc_tobias', 'friend'), carry('it_cartas_tobias'), carry('it_bolsa_ceniza')] },
        refusal: 'Tobías contesta con otra pregunta y se le escapa una sonrisa: no tienes nada contra él' },
    ] },
  { id: 'clue_hal', title: 'Plata vieja en la choza', reputation: 2, key: true, npc_ids: ['npc_hal'], location_ids: ['loc_claro', 'loc_ruinas'],
    how: 'Hal le lleva caza a «la mujer del granero» y ella le paga con plata vieja con el sello de Vharn.',
    sources: [
      { via: 'Hal lo admite si se fía de ti (amigo: le ayudan con la loba, le traen su jarra, varias charlas).', npc_id: 'npc_hal', requires: trust('npc_hal', 'friend'),
        refusal: 'Hal te mira los pies y no suelta prenda: aún no se fía de ti' },
      { via: 'En el Granero Quemado, piezas de caza recién colgadas, atravesadas con las flechas de Hal, y un puñado de plata vieja con el sello.', location_id: 'loc_ruinas' },
    ] },
  { id: 'clue_ysolde', title: 'La heredera de Vharn', reputation: 2, key: true, npc_ids: ['npc_ysolde', 'npc_tobias', 'npc_hal'], location_ids: ['loc_ruinas'],
    how: 'La mujer del granero es Ysolde, la heredera de Vharn: vio a «la mujer de la antorcha» llevársela y la noche de la Brasa soltará el ascua en la plaza si el valle no le entrega al culpable. Si el PJ le enseña el libro de cuentas, duda por primera vez.',
    sources: [
      { via: 'Hablar con Ysolde en el Granero Quemado sin atacarla: dice quién es si ya te conoce o si llegas sabiendo algo (lo que vio Doro, la plata de Hal, las cartas de Tobías, el libro).', npc_id: 'npc_ysolde',
        requires: { kind: 'any', of: [trust('npc_ysolde', 'acquaintance'), clue('clue_doro'), clue('clue_hal'), clue('clue_tobias'), carry('it_libro_cuentas')] },
        refusal: 'Ysolde no parpadea: «¿Quién te manda?». A quien llega sin saber nada no le cuenta su nombre' },
      { via: 'Tobías dice quién es la mujer del granero, si es su aliado.', npc_id: 'npc_tobias', requires: trust('npc_tobias', 'ally'),
        refusal: 'Tobías se calla: a ella no la vende' },
      { via: 'Hal dice que es una Vharn, la cría de los carboneros, si es su aliado.', npc_id: 'npc_hal', requires: trust('npc_hal', 'ally'),
        refusal: 'Hal no habla de sus tratos' },
    ] },
];

export const JOBS: Job[] = [
  { id: 'job_lena', title: 'Leña para la posada', text: 'Brenna paga por diez leños secos. Los del roble del Soto sirven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 10 }, reward_coins: 60, reward_reputation: 1 },
  { id: 'job_bayas', title: 'Bayas para la despensa', text: 'Brenna quiere diez bayas del Soto antes de que los pájaros se las lleven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_bayas', quantity: 10 }, reward_coins: 20, reward_reputation: 1 },
  { id: 'job_ronda', title: 'Ronda hasta el Soto', text: 'Doro no puede dejar el portón. Paga a quien vaya hasta el roble del Soto, mire si hay alguien y vuelva a contárselo.', giver_npc_id: 'npc_doro', kind: 'visit', visit_spot_id: 'sp_cl_roble', reward_coins: 50, reward_reputation: 1 },
  { id: 'job_fragua', title: 'Carbón para la fragua', text: 'Hugo necesita seis leños para que la fragua no se apague antes del jueves.', giver_npc_id: 'npc_hugo', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 6 }, reward_coins: 40, reward_reputation: 1 },
  { id: 'job_pescado', title: 'Pescado fresco', text: 'Cinco truchas del arroyo del Soto para la cena de la posada.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_pescado', quantity: 5 }, reward_coins: 50, reward_reputation: 1 },
  { id: 'job_toma', title: 'La toma del arroyo', text: 'Mateo paga a quien remonte la senda hasta el arroyo del Soto y mire qué atasca el agua que llega al molino.', giver_npc_id: 'npc_mateo', kind: 'visit', visit_spot_id: 'sp_cl_arroyo', reward_coins: 50, reward_reputation: 1 },
  { id: 'job_huevos', title: 'Huevos para la cena', text: 'Brenna quiere seis huevos de los Corrales de Úrsula para el guiso de mañana.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_huevo', quantity: 6 }, reward_coins: 15, reward_reputation: 1 },
  { id: 'job_cerca', title: 'La cerca del redil', text: 'Úrsula paga a quien le traiga cuatro leños para tapar el boquete del redil antes de que vuelvan los lobos.', giver_npc_id: 'npc_ursula', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 4 }, reward_coins: 25, reward_reputation: 1 },
];

export const ACHIEVEMENT: Achievement = {
  id: 'ach_ceniza', title: 'Quien ha mirado la ceniza', faction_id: 'fac_brezal', clues_required: 3, reputation_required: 5,
  // Solo reputación y lo que se dice: la llave de los Vharn y la trampilla salen de «Bajo el Jabalí», con su escena.
  reward_item_id: null, reward_spot_id: null, reward_reputation: 2,
  announcement: 'Se corre la voz por Brezal: {name} ha mirado la ceniza de frente.',
};

/**
 * Tres situaciones iniciales y dos de compañero. Todas empiezan a las 18:00 del primer día, con la misa del pozo a
 * dos horas, y vencen la noche de la Brasa. En multijugador no se repiten si hay otra libre; quien entra con
 * «Empezar junto a…» recibe la de compañero de la del otro (`companion_of`, con `{companion}` = su nombre).
 * Quien sale en la apertura existe y está allí: `with_npc_ids` lo pone junto al PJ al empezar.
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
        'Contarle a Ilse lo de la carta y seguirla a la Casa de las hierbas: es la única que aún reza por los de Vharn.',
        'Enseñar la carta en la taberna y mirar quién se pone pálido.',
        'Ir al Lindero y mirar la niebla de cerca.',
      ],
      opening: 'Llevas tres semanas callando la carta. Esta noche, junto al pozo, Ilse, la curandera, que ha venido temprano a poner las velas de la misa, ve asomar el lacre; se le cae una vela al agua y te agarra la muñeca con una fuerza que no parece suya: «¿Quién te ha mandado eso?».',
      items: [{ item_id: 'it_carta_sello', quantity: 1 }],
      knows: ['npc_ilse'],
      with_npc_ids: ['npc_ilse'],
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
      with_npc_ids: ['npc_hugo'],
    },
  },
  {
    for_name: '', keep: true,
    situation: {
      id: 'sit_deuda',
      why_here: 'Llegaste a Brezal la víspera de que bajara la niebla, con fiebre y una herida de camino. Brenna te dio cama y la curandera te cosió; no tenías con qué pagar, y la cuenta se quedó apuntada en el Jabalí.',
      wants: 'Salir de la aldea: averiguar qué es la niebla y cómo cruzarla, sin que el regidor te cobre antes la deuda a su manera.',
      threat: 'El regidor le ha comprado tu deuda a Brenna y Garrán, su alguacil, la cobra en su nombre. O pagas en tres días, o trabajas para el regidor: ir al Granero Quemado a «apagar las luces».',
      clock_days: 3, clock_runs_out: 'Garrán te quita lo que llevas de valor y te manda al Granero Quemado con una lanza en la espalda.',
      antagonist_npc_id: 'npc_garran', start_spot_id: 'sp_tab_mesa', start_hour: 18,
      paths: [
        'Pagar con trabajo honrado: el tablón, Brenna, los Corrales y el Soto dan monedas.',
        'Aceptar el encargo del regidor e ir al Granero Quemado a ver qué hay.',
        'Averiguar por qué el regidor quiere gente en el granero y usarlo contra él.',
      ],
      opening: 'Garrán deja caer en tu mesa una tablilla con tu nombre y una cifra, 300, y se sienta enfrente a esperar. «Lo tuyo ahora es del regidor, y lo cobro yo. Tres días», dice, y te bebe la cerveza. «Y no pienses en la niebla: los deudores no pueden huir. Mejor».',
      debt: { npc_id: 'npc_garran', on_behalf_of: 'npc_osric', amount: 300, reason: 'la cama, la comida y la curandera del Jabalí; el regidor compró la deuda y Garrán la cobra en su nombre' },
      knows: ['npc_brenna', 'npc_garran'],
      with_npc_ids: ['npc_garran'],
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
      with_npc_ids: ['npc_hugo'],
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
        'Cubrir a {companion} mientras habla con Ilse, la curandera.',
        'Ir a la taberna y escuchar qué se dice de la carta y de Vharn.',
        'Ir al Lindero y mirar la niebla de cerca.',
      ],
      opening: 'Estás a un paso de {companion} junto al pozo cuando Ilse, la curandera, que ha venido temprano a poner las velas de la misa, ve asomar el lacre de la carta; se le cae una vela al agua y agarra a {companion} de la muñeca: «¿Quién te ha mandado eso?». Después te mira a ti, de arriba abajo.',
      knows: ['npc_ilse'],
      with_npc_ids: ['npc_ilse'],
    },
  },
];

/** Por dónde entra quien llega sin situación (personajes de antes de la historia, la partida principal). */
export const STARTING_POINTS: Campaign['starting_points'] = [
  { spot_id: 'sp_tab_puerta', origin: 'Llegó a Brezal como viajero la víspera de que bajara la niebla, con el polvo del camino del sur encima y la última moneda del último trabajo. Desde entonces no ha podido irse; la Taberna del Jabalí es lo más parecido a una casa que tiene.' },
  { spot_id: 'sp_pl_pozo', origin: 'Es de Brezal, o casi: se crió aquí y se fue joven. Volvió hace un mes, justo antes de que la niebla cerrara el valle, y la aldea le parece más pequeña y más callada de lo que recordaba.' },
  { spot_id: 'sp_cl_sendero', origin: 'Ha pasado la noche en el Soto, cazando o escondiéndose, según a quién se le pregunte. Vuelve hacia el pueblo con hambre y con la sensación de que la niebla, ahí al lado, está más cerca que ayer.' },
];
