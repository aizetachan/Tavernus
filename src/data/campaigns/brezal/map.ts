/**
 * Brezal sellada: el mapa. Una sola zona, la aldea, encerrada por el Cerco de
 * Ceniza (un anillo de niebla a unos 600 m de la plaza): diez lugares, el
 * sótano del Jabalí y sus puntos con coordenadas en metros, tags que mapgen
 * sabe dibujar y alias para que el jugador los nombre como quiera.
 * Lo que antes estaba fuera del pueblo se ha reubicado dentro del Cerco (el
 * Soto, antes Claro del Roble; el Granero Quemado, antes Ruinas de Vharn) con
 * sus ids de siempre; la Cuesta Gris y la Cripta se han cortado.
 *
 * Al otro lado de la niebla, el camino de Valcruz: un lugar sellado que solo
 * existe para que el Cerco sea una salida bloqueada (barrier.ts: quien lo
 * intenta, pierde una hora y vuelve por donde entró). La expansión lo abrirá
 * con un exit_state.
 */

import type { Region, Zone } from '../../../engine/model.js';
import { ROOM_KEY_ITEM_ID } from '../../../worldgen/rooms.js';
import type { AuthoredCampaign, AuthoredLocation, AuthoredSpot } from '../format.js';

const S = (id: string, name: string, aliases: string[], tags: string[], x: number, y: number, description: string, extra: Partial<AuthoredSpot> = {}): AuthoredSpot =>
  ({ id, name, aliases, tags, x, y, description, ...extra });
/** Sin vista ni apenas oído desde el resto de la sala (un cuarto arriba, una alcoba). */
const apart = (...ids: string[]) => ({ links: ids.map((to_spot_id) => ({ to_spot_id, blocks_sight: true, muffles: 0.8 })) });

export const REGIONS: Region[] = [{ id: 'rg_valle', name: 'Valle de Vharn' }];

export const ZONES: Zone[] = [
  { id: 'zn_brezal', region_id: 'rg_valle', name: 'Aldea de Brezal', kind: 'town' },
  // Sellada: no se juega en la demo.
  { id: 'zn_fuera', region_id: 'rg_valle', name: 'Más allá del Cerco', kind: 'road' },
];

/** El Cerco de Ceniza: salida bloqueada que rebota (barrier.ts). */
export const CERCO = {
  blocked_by: 'El Cerco de Ceniza',
  rebound: {
    hours: 1,
    text: 'Te metes en la niebla. Dentro no hay viento ni sonido, solo gris; andas un rato largo con la mano por delante, sin tocar nada. Cuando por fin se aclara, estás otra vez en el Lindero, en el mismo sitio por el que entraste, con ceniza en el pelo y una hora menos de luz.',
    observable: '{name} se mete en la niebla y, al cabo de un buen rato, sale por donde entró, con ceniza en el pelo.',
    aliases: ['niebla', 'la niebla', 'cerco', 'el cerco', 'el cerco de ceniza', 'valle', 'el valle', 'fuera del valle', 'el otro lado', 'valcruz'],
  },
};

export const LOCATIONS: AuthoredLocation[] = [
  {
    id: 'loc_taberna', zone_id: 'zn_brezal', name: 'Taberna del Jabalí', indoor: true,
    description_base: 'Una sala baja de vigas negras, con olor a cerveza rancia y humo de leña. Un jabalí disecado mira desde encima de la barra con un ojo de cristal.',
    ambience: { light: 'twilight', noise: 0.3, smell: 'cerveza y humo' },
    secret: 'Bajo la alfombra de la mesa del fondo, la trampilla al sótano donde Brenna esconde el libro de cuentas de Vharn.',
    spots: [
      S('sp_tab_puerta', 'la puerta', ['puerta', 'entrada', 'door'], ['door'], 0, 0, 'La puerta de la taberna, siempre entornada; el umbral está gastado en el centro y el tercer escalón cojea. Al lado, un barril de agua con un cazo atado a una cadena: el agua no se cobra.'),
      S('sp_tab_barra', 'la barra', ['barra', 'mostrador', 'bar'], ['counter'], 6, 2, 'Una barra de roble gastado, con jarras de barro colgando de clavos, cada una con un nombre grabado a fuego y alguna boca abajo, y una tablilla de deudas escrita con tiza. El último taburete, al extremo, siempre está vacío.'),
      S('sp_tab_mesa', 'la mesa del fondo', ['mesa', 'mesa del fondo', 'rincón', 'fondo'], ['table', 'rug'], 10, 6, 'Una mesa en penumbra, lejos de la puerta, sobre una alfombra raída que nadie levanta nunca.'),
      S('sp_tab_chimenea', 'la chimenea', ['chimenea', 'fuego', 'hogar'], ['fireplace'], 3, 7, 'Un hogar de piedra con brasas y una manta vieja de perro delante, vacía.'),
      S('sp_tab_trampilla', 'la trampilla', ['trampilla', 'sótano', 'trapdoor'], ['trapdoor'], 10, 8, 'Una trampilla bajo la alfombra, con una argolla oxidada y escalones que bajan a lo oscuro.',
        { hidden: true, dc_to_find: 14, capacity: 1 }),
      S('sp_tab_habitacion', 'la habitación de arriba', ['habitacion', 'habitación', 'mi habitación', 'arriba', 'cuarto'], ['bed', 'stairs'], 4, 12,
        'Un cuarto pequeño bajo el tejado, con un jergón, un arcón y una puerta que cierra con llave.',
        { capacity: 2, entry_cost_s: 20, state: { locked: true, key_item_id: ROOM_KEY_ITEM_ID }, ...apart('sp_tab_barra', 'sp_tab_mesa', 'sp_tab_chimenea', 'sp_tab_puerta') }),
    ],
  },
  {
    id: 'loc_sotano', zone_id: 'zn_brezal', name: 'Sótano del Jabalí', indoor: true,
    description_base: 'Un sótano de techo bajo que huele a tierra y a vino agrio. Cajas apiladas, tapadas con sacos, llevan un sello que nadie en Brezal nombra en voz alta.',
    ambience: { light: 'night_dark', noise: 0.02, smell: 'tierra húmeda y vino agrio' },
    secret: 'Tras el último barril, en un hueco de la pared, el libro de cuentas de Vharn: la prueba de que Osric se llevó la plata la noche del incendio.',
    spots: [
      S('sp_so_escalera', 'la escalera', ['escalera', 'escalones', 'arriba'], ['stairs'], 0, 0, 'Escalones de piedra que suben a la trampilla.'),
      S('sp_so_cajas', 'las cajas con el sello', ['cajas', 'caja', 'sello', 'sacos'], ['crate'], 4, 3, 'Cajas de madera con una brasa dentro de un círculo grabada a fuego: el sello de Vharn. Dentro, vajilla ahumada y paños quemados.'),
      S('sp_so_barriles', 'los barriles', ['barriles', 'barril', 'toneles', 'vino'], ['barrel'], 1, 6, 'Una fila de barriles de vino agrio; el último está movido, con la marca del suelo a un palmo. Delante, la tierra está apisonada, como si alguien se quedara allí de pie a menudo.'),
      S('sp_so_hueco', 'el hueco tras el barril', ['hueco', 'hueco de la pared', 'escondrijo', 'pared'], ['chest'], 2, 8, 'Un hueco en la pared de tierra, tapado con una piedra plana, justo detrás del último barril.',
        { hidden: true, dc_to_find: 12, capacity: 1 }),
    ],
  },
  {
    id: 'loc_plaza', zone_id: 'zn_brezal', name: 'Plaza del Pozo', indoor: false,
    description_base: 'La plaza empedrada de Brezal, con el pozo en el centro, el tablón de avisos junto a la herrería y la casona del regidor, la única de dos plantas, mirándolo todo. Por encima de los tejados del norte se ve, quieta, una franja de niebla gris.',
    ambience: { light: 'natural', noise: 0.2 },
    secret: 'El agua del pozo trae ceniza: la echa Tobías cada noche por encargo de Ysolde, y el manantial pasa por debajo del granero de Vharn, donde duerme enterrada la Brasa.',
    spots: [
      S('sp_pl_taberna', 'la puerta de la taberna', ['taberna', 'puerta de la taberna', 'jabali', 'jabalí'], ['door'], 0, 0, 'El umbral de la Taberna del Jabalí, con un jabalí tallado sobre el dintel.'),
      S('sp_pl_pozo', 'el pozo', ['pozo', 'well', 'brocal'], ['well'], 15, 10, 'Un pozo de piedra con un cubo de madera. Hay cera de velas vieja en el brocal y el agua del cubo está turbia.'),
      S('sp_pl_tablon', 'el tablón', ['tablon', 'tablón de avisos', 'avisos', 'board'], ['notice'], 20, 4, 'Un tablón lleno de avisos clavados; el más nuevo, con el sello del regidor, anuncia el «diezmo de la ceniza».'),
      S('sp_pl_porton', 'el portón norte', ['porton', 'portón', 'puerta norte', 'salida norte', 'north gate'], ['gate'], 30, 20, 'El portón del norte. El camino se parte enseguida: a un lado la arboleda del Soto, al otro el Lindero, donde empieza la niebla.'),
      S('sp_pl_herreria', 'la puerta de la herrería', ['fragua', 'martilleo'], ['door'], 24, -4, 'La puerta de la herrería de Hugo, con el hollín de veinte años en el dintel y el martilleo detrás.'),
      S('sp_pl_casona', 'la puerta de la casona', ['casa del regidor', 'aldaba'], ['door'], 6, 22, 'La puerta de roble de la casona del regidor, con aldaba de hierro y un escalón de piedra nueva. Encima, la torre del reloj; en la fachada, a la luz de la tarde, se ve la sombra de un escudo picado.'),
      S('sp_pl_callejon', 'el callejón de las hierbas', ['callejón', 'callejon'], ['road'], -6, 14, 'Un callejón estrecho que huele a hierbas cocidas y lleva a la casa de la curandera.'),
      S('sp_pl_camino_molino', 'el camino del molino', ['camino del molino', 'huertos'], ['road'], 36, 6, 'Un camino de carro que baja entre huertos hacia el ruido del agua y la rueda del molino.'),
      S('sp_pl_corrales', 'el camino de los corrales', ['camino de los corrales', 'cercas'], ['road'], -10, -6, 'Un camino de tierra entre cercas de piedra que huele a gallinero y lleva a la granja de la viuda Úrsula.'),
    ],
  },
  {
    id: 'loc_herreria', zone_id: 'zn_brezal', name: 'La herrería', indoor: true,
    description_base: 'Una fragua de piedra ennegrecida, calor de horno y olor a hierro. Herraduras y hojas a medio hacer cuelgan de las vigas; de una cuelgan clavos torcidos con nombres, y aparte, un martillo que brilla de grasa. Los postigos están abiertos aunque haga frío.',
    ambience: { light: 'twilight', noise: 0.5, smell: 'hierro y carbón' },
    secret: 'Bajo la losa suelta, junto al yunque, los últimos eslabones de la cadena de hierro frío que ató la Brasa, forjados por el maestro de Hugo.',
    spots: [
      S('sp_he_puerta', 'la puerta', ['puerta', 'entrada'], ['door'], 0, 0, 'La puerta de la herrería, de tablones chamuscados.'),
      S('sp_he_fragua', 'la fragua', ['fragua', 'fuego', 'horno'], ['fireplace'], 5, 4, 'La fragua, con el fuelle remendado y brasas que nunca se dejan morir.'),
      S('sp_he_yunque', 'el yunque', ['yunque'], ['rock'], 7, 6, 'Un yunque viejo con una marca de Vharn medio borrada a martillazos.'),
      S('sp_he_banco', 'el banco de trabajo', ['banco', 'banco de trabajo', 'herramientas'], ['table'], 3, 8, 'Un banco con tenazas, limas y un cuaderno de pedidos lleno de deudas. Al lado, otro banco más viejo que nadie ocupa.'),
      S('sp_he_losa', 'la losa suelta', ['losa', 'losa suelta', 'suelo', 'baldosa'], ['trapdoor'], 9, 9, 'Una losa del suelo que suena a hueco; debajo, envuelto en lana engrasada, algo que pesa.',
        { hidden: true, dc_to_find: 13, capacity: 1 }),
    ],
  },
  {
    id: 'loc_casona', zone_id: 'zn_brezal', name: 'La casona', indoor: true,
    description_base: 'Una casa de piedra con muebles demasiado buenos para Brezal: tapices, una alfombra de lana roja y un reloj de arena con pie de plata. Media casa tiene los muebles tapados con sábanas y huele a humedad bajo unas bolsitas de hierbas. Una escalera de caracol sube a la torre del reloj.',
    ambience: { light: 'twilight', noise: 0.1, smell: 'cera y lana' },
    secret: 'En el arcón de los registros, con llave que lleva Garrán, una copa de plata con el sello de Vharn: lo último que Osric no se atrevió a fundir. Tras un tabique de la despensa, una bodega tapiada donde Osric se escondería si le buscaran.',
    spots: [
      S('sp_ca_puerta', 'la puerta', ['puerta', 'entrada', 'zaguán'], ['door'], 0, 0, 'El zaguán, con una aldaba de hierro y un banco para quien espera.'),
      S('sp_ca_banco', 'el banco de espera', ['banco', 'banco de espera', 'espera'], ['stool'], 2, 4, 'Un banco de madera duro donde se sienta quien viene a pagar o a pedir.'),
      S('sp_ca_despacho', 'la mesa del despacho', ['despacho', 'mesa', 'escritorio', 'mesa del despacho'], ['table'], 7, 5, 'Una mesa ancha con libros de cuentas, un tintero y el sello del regidor.'),
      S('sp_ca_arcon', 'el arcón de los registros', ['arcón', 'arcon', 'registros', 'archivo'], ['chest'], 9, 8, 'Un arcón con herrajes nuevos y una cerradura que no se abre sin su llave.',
        { state: { locked: true, key_item_id: 'it_llave_arcon' }, capacity: 1 }),
      S('sp_ca_alcoba', 'la alcoba de arriba', ['alcoba', 'dormitorio'], ['bed', 'stairs'], 5, 11, 'La alcoba del regidor, con una cama con dosel sin deshacer, con la colcha hundida de dormir encima, y una ventana que da al norte, a la niebla.',
        { entry_cost_s: 20, ...apart('sp_ca_puerta', 'sp_ca_banco', 'sp_ca_despacho', 'sp_ca_arcon') }),
      S('sp_ca_torre', 'la torre del reloj', ['torre', 'torre del reloj', 'reloj', 'mirador', 'campanario'], ['stairs'], 1, 12,
        'Lo alto de la torre, junto a la maquinaria del reloj parado. Desde aquí se ve Brezal entero, el humo del Granero Quemado y, alrededor de todo, la niebla, quieta como una pared.',
        { entry_cost_s: 40, capacity: 2, ...apart('sp_ca_puerta', 'sp_ca_banco', 'sp_ca_despacho', 'sp_ca_arcon', 'sp_ca_alcoba') }),
      S('sp_ca_bodega', 'la bodega tapiada', ['bodega', 'tabique', 'despensa'], ['barrel'], 10, 2, 'Tras un tabique de la despensa que suena a hueco, una bodega estrecha con dos toneles, una manta y una vela.',
        { hidden: true, dc_to_find: 15, capacity: 2 }),
    ],
  },
  {
    id: 'loc_curandera', zone_id: 'zn_brezal', name: 'Casa de las hierbas', indoor: true,
    description_base: 'Una casa de una sola pieza llena de manojos de hierbas secándose del techo; huele a corteza cocida y a vela de sebo.',
    ambience: { light: 'twilight', noise: 0.05, smell: 'hierbas cocidas' },
    secret: 'Ilse fue la última sacerdotisa de la llama de Vharn: sabe las palabras que templan una ascua de la Brasa y reconoce en la niebla el cerrojo de sus antiguos maestros.',
    spots: [
      S('sp_cu_puerta', 'la puerta', ['puerta', 'entrada'], ['door'], 0, 0, 'Una puerta baja con un ramillete de ruda clavado; bajo el dintel, una marca vieja grabada en la piedra, la única del pueblo sin encalar.'),
      S('sp_cu_hierbas', 'las hierbas colgadas', ['hierbas', 'manojos', 'estantes'], ['shelf'], 3, 5, 'Estantes de tarros y manojos de hierbas; un tarro con ceniza lleva una etiqueta: «pozo, día 3». En un rincón, un cesto con cosas sin valor: un hilo, un botón, una piña.'),
      S('sp_cu_caldero', 'el caldero', ['caldero', 'fuego', 'olla'], ['fireplace'], 5, 2, 'Un caldero donde hierve corteza para la tos gris.'),
      S('sp_cu_camastro', 'el camastro', ['camastro', 'cama', 'jergón'], ['bed'], 7, 7, 'Un camastro limpio para enfermos, con una manta que huele a humo.'),
    ],
  },
  {
    id: 'loc_molino', zone_id: 'zn_brezal', name: 'El molino', indoor: true,
    description_base: 'Un molino de piedra junto al arroyo que baja del Soto. La rueda chirría y el agua del canal sale tibia y gris.',
    ambience: { light: 'twilight', noise: 0.4, smell: 'harina y agua estancada' },
    secret: 'En el desván, bajo la paja, las cartas de Ysolde a Tobías y una bolsa de ceniza del Granero Quemado.',
    spots: [
      S('sp_mo_puerta', 'la puerta', ['puerta', 'entrada'], ['door'], 0, 0, 'La puerta del molino, enharinada hasta la aldaba.'),
      S('sp_mo_muelas', 'las muelas', ['muelas', 'piedras', 'molienda'], ['rock'], 6, 4, 'Las muelas de piedra, que muelen a trompicones por la ceniza que trae el agua.'),
      S('sp_mo_sacos', 'los sacos de harina', ['sacos', 'harina', 'saco'], ['crate'], 3, 8, 'Sacos de harina apilados contra la pared, algunos con huellas de botas embarradas de gris. Al lado, un arcón largo con forma de ataúd y un tonel sellado con cera.'),
      S('sp_mo_rueda', 'la rueda', ['rueda', 'canal', 'arroyo', 'senda del arroyo'], ['water'], 10, 2, 'La rueda y el canal; de aquí sale la senda que remonta el arroyo hacia el Soto.', { terrain_multiplier: 0.8 }),
      S('sp_mo_desvan', 'el desván', ['desván', 'desvan', 'altillo', 'paja'], ['stairs'], 8, 9, 'Un desván bajo con paja vieja, donde duerme Tobías cuando no quiere que le oigan llegar.',
        { hidden: true, dc_to_find: 12, capacity: 1 }),
      S('sp_mo_tejado', 'el tejado del molino', ['tejado', 'tejado del molino', 'tejas'], ['stairs'], 4, 11, 'Por una escalera de mano se sale al tejado de lajas. Desde arriba se ve el Granero Quemado echando humo y, detrás, la niebla.',
        { entry_cost_s: 30, capacity: 2 }),
    ],
  },
  {
    id: 'loc_corrales', zone_id: 'zn_brezal', name: 'Los Corrales', indoor: false,
    description_base: 'La granja de la viuda Úrsula, en el borde del pueblo: cercas de piedra seca, un gallinero de tablas, un redil con una docena de ovejas grises de ceniza y un huerto de coles. Desde la cerca de atrás se ve la niebla.',
    ambience: { light: 'natural', noise: 0.25, smell: 'gallinero y lana mojada' },
    secret: 'Úrsula guarda bajo el colchón la última carta de su hijo Pol, que salió al mercado de Valcruz la víspera de que bajara la niebla. Cada noche deja un farol encendido en la cerca de atrás, por si vuelve.',
    spots: [
      S('sp_co_cancela', 'la cancela', ['cancela', 'entrada', 'portilla'], ['gate'], 0, 0, 'Una cancela de palos atada con cuerda, con un cuenco de agua para los perros que ya no hay.'),
      S('sp_co_gallinero', 'el gallinero', ['gallinero', 'gallinas', 'ponedero', 'huevos'], ['crate'], 8, 4, 'Un gallinero de tablas con una docena de gallinas pardas que cacarean en cuanto alguien se acerca.'),
      S('sp_co_redil', 'el redil', ['redil', 'ovejas', 'corral', 'cerca'], ['dirt'], 18, 10, 'Un redil de piedra seca con ovejas que tosen como la gente; la cerca de atrás tiene un boquete tapado con ramas, tres piedras apiladas y una cuerda gastada colgada de un poste.'),
      S('sp_co_huerto', 'el huerto', ['huerto', 'coles', 'hortalizas'], ['bush'], 6, 14, 'Un huerto de coles y nabos con una película gris en las hojas.'),
      S('sp_co_casa', 'la casa de la granja', ['casa', 'casa de la granja', 'cocina'], ['building'], -4, 10, 'Una casa baja con la puerta abierta, olor a sopa y un farol apagado colgado junto a la ventana, al lado de un tarro de alubias. En el clavo del dintel, un mechón de pelo atado con hilo rojo.'),
    ],
  },
  {
    id: 'loc_claro', zone_id: 'zn_brezal', name: 'El Soto', indoor: false,
    description_base: 'Una arboleda de fresnos y alisos en el borde del pueblo, a un tiro de piedra de las últimas casas. Un roble enorme domina el centro; el arroyo baja tibio entre las raíces.',
    ambience: { light: 'natural', noise: 0.1 },
    secret: 'De noche Tobías cruza el Soto por el arroyo hacia el Granero Quemado; el hacha del sendero es suya. Al pie del roble, en una madriguera, la loba de ceniza tiene acorralado al perro de Brenna: tampoco ella puede salir del valle.',
    spots: [
      S('sp_cl_sendero', 'el sendero', ['sendero', 'camino', 'path'], ['road'], 0, 0, 'Donde el sendero del portón entra en la arboleda; hay huellas de botas y de perro en el barro.'),
      S('sp_cl_roble', 'el roble viejo', ['roble', 'árbol grande', 'arbol', 'old oak', 'oak'], ['tree', 'cover'], 25, 15, 'Un roble centenario de tronco retorcido, con muescas de hacha recientes.'),
      S('sp_cs_cueva', 'la madriguera', ['madriguera', 'lobera', 'cueva', 'agujero', 'raíces'], ['rock', 'dirt'], 29, 20, 'Una boca de tierra entre las raíces del roble; huele a fiera y se oye gemir a un perro dentro.'),
      S('sp_cl_piedra', 'la piedra grande', ['piedra', 'roca', 'rock'], ['rock', 'bush'], 12, 20, 'Una piedra plana y musgosa, buena para sentarse, junto a un zarzal de bayas.'),
      S('sp_cl_arroyo', 'el arroyo', ['arroyo', 'agua', 'río', 'stream'], ['water'], 40, 5, 'Un arroyo somero de agua tibia, con una película gris en los remansos.', { terrain_multiplier: 0.5 }),
      S('sp_cl_choza', 'la choza de pieles', ['choza', 'cabaña', 'pieles'], ['building'], 30, 35, 'Una choza de troncos con pieles tendidas y un ahumadero; huele a carne y a resina. En los árboles de alrededor hay cortes en la corteza y nudos de pelo.'),
      S('sp_cl_senda', 'la senda del granero', ['senda', 'senda del granero', 'granero'], ['road'], 50, 28, 'Una senda que sigue el arroyo hasta las ruinas negras del granero de Vharn, que asoman entre los alisos.'),
    ],
  },
  {
    id: 'loc_ruinas', zone_id: 'zn_brezal', name: 'El Granero Quemado', indoor: false,
    description_base: 'Las ruinas del granero de los señores de Vharn, en el borde del pueblo: muros negros sin tejado, vigas caídas, una era cubierta de ceniza tibia y una capilla derruida. De alguna grieta sale un resplandor rojo que late.',
    ambience: { light: 'natural', noise: 0.05, smell: 'ceniza caliente' },
    secret: 'Ysolde Vharn se esconde en el pajar hundido. Bajo el altar de la capilla, un pasadizo sellado con el sello de Vharn baja hacia la cripta derrumbada donde la Brasa grande duerme enterrada; solo lo abre la llave de los Vharn. Por las grietas del altar sale la ceniza que Tobías echa al pozo.',
    spots: [
      S('sp_ru_puerta', 'el portalón caído', ['portalón', 'portalon', 'entrada', 'puerta rota'], ['gate'], 0, 0, 'Lo que queda del portalón: dos hojas de roble carbonizado tiradas en el barro.'),
      S('sp_ru_patio', 'la era quemada', ['era', 'patio', 'era quemada'], ['dirt'], 15, 12, 'La era del granero, con la ceniza tibia hasta el tobillo y huellas recientes de pies pequeños. En el centro, un círculo de piedras ennegrecidas: el fuego común de la noche de prestar la lumbre.'),
      S('sp_ru_torre', 'el pajar hundido', ['pajar', 'pajar hundido', 'altillo', 'torre'], ['building'], 28, 6, 'Un pajar con media techumbre, una lona tendida, un fuego pequeño y un catre: alguien vive aquí.'),
      S('sp_ru_capilla', 'la capilla derruida', ['capilla', 'altar', 'tumbas'], ['building'], 8, 26, 'Una capilla sin bóveda pegada al granero, con las tumbas de los Vharn y un altar agrietado del que sale calor; alguien ha dejado flores secas. En lo alto de la pared, bajo el hollín, unos signos muy viejos parecidos a las marcas de los dinteles del pueblo.'),
      S('sp_ru_cripta', 'el pasadizo bajo el altar', ['pasadizo', 'sello', 'losa del altar', 'escalera'], ['stairs'], 10, 30,
        'Una losa de hierro detrás del altar, caliente al tacto, con el sello de Vharn como cerradura. Debajo, unos escalones bajan hasta un derrumbe: más allá duerme, enterrada, la Brasa grande.',
        { state: { locked: true, key_item_id: 'it_llave_vharn' } }),
    ],
  },
  {
    id: 'loc_lindero', zone_id: 'zn_brezal', name: 'El Lindero', indoor: false,
    description_base: 'El final del camino del norte, donde acaba el valle: una pared de niebla gris, quieta aunque sople el viento, que apaga los sonidos. Los pájaros no la cruzan y las gallinas ni se acercan.',
    ambience: { light: 'twilight', noise: 0.02, smell: 'nada; la niebla no huele' },
    secret: 'La niebla es el Cerco de Ceniza: la Guarda de Vharn, un conjuro de contención de los primeros señores, despertó hace tres semanas cuando Ysolde volvió con el ascua. El mojón con el sello es su primer anclaje.',
    spots: [
      S('sp_li_camino', 'el final del camino', ['final del camino', 'camino del norte', 'camino'], ['road'], 0, 0, 'El camino del norte, que sigue recto unos pasos más y se mete en la niebla como en el agua.'),
      S('sp_li_barricada', 'la barricada', ['barricada', 'carros', 'hoguera'], ['crate'], 10, 8, 'Dos carros volcados y unos sacos que los vecinos pusieron «por si sale algo»; al lado, una hoguera y un banco. Detrás, un montón de ruedas de carro rotas: las de quienes se fueron del valle para siempre.'),
      S('sp_cs_mojon', 'el mojón de Vharn', ['mojón', 'mojon', 'sello', 'piedra del sello'], ['rock'], 22, 12, 'Un mojón de piedra con el sello de Vharn y lleno de muescas, tibio al tacto aunque haga frío; alguien deja aquí comida envuelta en paño.'),
      S('sp_li_niebla', 'el borde de la niebla', ['borde de la niebla', 'borde', 'pared de niebla', 'linde'], ['dirt'], 16, 24, 'Donde empieza la niebla: un paso más y no se ve la mano. En el suelo, huellas que entran y salen por el mismo sitio.'),
    ],
  },
  {
    id: 'loc_valcruz', zone_id: 'zn_fuera', name: 'Camino de Valcruz', indoor: false,
    description_base: 'El camino que sale del valle hacia el mercado de Valcruz. Desde Brezal no se ve: lo tapa la niebla.',
    ambience: { light: 'natural', noise: 0.1 },
    secret: 'Sellado en la demo: se abrirá en la expansión.',
    spots: [
      S('sp_va_camino', 'el camino de Valcruz', ['camino de valcruz', 'valcruz', 'mercado de valcruz'], ['road'], 0, 0, 'Un camino de carro entre campos, al otro lado de la niebla.'),
    ],
  },
];

export const EXITS: AuthoredCampaign['exits'] = [
  { id: 'ex_tab_plaza', from: 'sp_tab_puerta', to: 'sp_pl_taberna', distance_m: 3 },
  { id: 'ex_tab_sotano', from: 'sp_tab_trampilla', to: 'sp_so_escalera', distance_m: 3 },
  { id: 'ex_plaza_herreria', from: 'sp_pl_herreria', to: 'sp_he_puerta', distance_m: 3 },
  { id: 'ex_plaza_casona', from: 'sp_pl_casona', to: 'sp_ca_puerta', distance_m: 4 },
  { id: 'ex_plaza_curandera', from: 'sp_pl_callejon', to: 'sp_cu_puerta', distance_m: 25 },
  { id: 'ex_plaza_molino', from: 'sp_pl_camino_molino', to: 'sp_mo_puerta', distance_m: 150 },
  { id: 'ex_plaza_corrales', from: 'sp_pl_corrales', to: 'sp_co_cancela', distance_m: 180 },
  { id: 'ex_plaza_claro', from: 'sp_pl_porton', to: 'sp_cl_sendero', distance_m: 250, terrain_multiplier: 0.9 },
  { id: 'ex_plaza_lindero', from: 'sp_pl_porton', to: 'sp_li_camino', distance_m: 450, terrain_multiplier: 0.9 },
  { id: 'ex_molino_claro', from: 'sp_mo_rueda', to: 'sp_cl_arroyo', distance_m: 220, terrain_multiplier: 0.8 },
  { id: 'ex_corrales_claro', from: 'sp_co_redil', to: 'sp_cl_roble', distance_m: 200, terrain_multiplier: 0.9 },
  { id: 'ex_claro_ruinas', from: 'sp_cl_senda', to: 'sp_ru_puerta', distance_m: 180, terrain_multiplier: 0.8 },
  { id: 'ex_lindero_cerco', from: 'sp_li_niebla', to: 'sp_va_camino', distance_m: 600, state: CERCO },
];
