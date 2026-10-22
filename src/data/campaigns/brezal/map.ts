/**
 * Brezal: el mapa. Tres zonas (la aldea, el bosque de Fresnos y la montaña de
 * Vharn), once localizaciones y sus puntos con coordenadas en metros, tags que
 * mapgen sabe dibujar y alias para que el jugador los nombre como quiera.
 * Las ids de la demo de siempre (taberna, plaza, claro) se conservan.
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
  { id: 'zn_fresnos', region_id: 'rg_valle', name: 'Bosque de Fresnos', kind: 'forest' },
  { id: 'zn_vharn', region_id: 'rg_valle', name: 'Montaña de Vharn', kind: 'mountain' },
];

export const LOCATIONS: AuthoredLocation[] = [
  // --- Aldea de Brezal --------------------------------------------------------
  {
    id: 'loc_taberna', zone_id: 'zn_brezal', name: 'Taberna del Jabalí', indoor: true,
    description_base: 'Una sala baja de vigas negras, con olor a cerveza rancia y humo de leña. Un jabalí disecado mira desde encima de la barra con un ojo de cristal.',
    ambience: { light: 'twilight', noise: 0.3, smell: 'cerveza y humo' },
    secret: 'Bajo la alfombra de la mesa del fondo, la trampilla al sótano donde Brenna esconde el libro de cuentas de Vharn.',
    spots: [
      S('sp_tab_puerta', 'la puerta', ['puerta', 'entrada', 'door'], ['door'], 0, 0, 'La puerta de la taberna, siempre entornada; el umbral está gastado en el centro.'),
      S('sp_tab_barra', 'la barra', ['barra', 'mostrador', 'bar'], ['counter'], 6, 2, 'Una barra de roble gastado, con jarras colgando de clavos y una tablilla de deudas escrita con tiza.'),
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
      S('sp_so_barriles', 'los barriles', ['barriles', 'barril', 'toneles', 'vino'], ['barrel'], 1, 6, 'Una fila de barriles de vino agrio; el último está movido, con la marca del suelo a un palmo.'),
      S('sp_so_hueco', 'el hueco tras el barril', ['hueco', 'hueco de la pared', 'escondrijo', 'pared'], ['chest'], 2, 8, 'Un hueco en la pared de tierra, tapado con una piedra plana, justo detrás del último barril.',
        { hidden: true, dc_to_find: 12, capacity: 1 }),
    ],
  },
  {
    id: 'loc_plaza', zone_id: 'zn_brezal', name: 'Plaza del Pozo', indoor: false,
    description_base: 'La plaza empedrada de Brezal, con el pozo en el centro, el tablón de avisos junto a la herrería y la casona del regidor, la única de dos plantas, mirándolo todo.',
    ambience: { light: 'natural', noise: 0.2 },
    secret: 'El agua del pozo trae ceniza: la echa Tobías cada noche por encargo de Ysolde, y la Brasa calienta el manantial de arriba.',
    spots: [
      S('sp_pl_taberna', 'la puerta de la taberna', ['taberna', 'puerta de la taberna', 'jabali', 'jabalí'], ['door'], 0, 0, 'El umbral de la Taberna del Jabalí, con un jabalí tallado sobre el dintel.'),
      S('sp_pl_pozo', 'el pozo', ['pozo', 'well', 'brocal'], ['well'], 15, 10, 'Un pozo de piedra con un cubo de madera. Hay cera de velas vieja en el brocal y el agua del cubo está turbia.'),
      S('sp_pl_tablon', 'el tablón', ['tablon', 'tablón de avisos', 'avisos', 'board'], ['notice'], 20, 4, 'Un tablón lleno de avisos clavados; el más nuevo, con el sello del regidor, anuncia el «diezmo de la ceniza».'),
      S('sp_pl_porton', 'el portón norte', ['porton', 'portón', 'puerta norte', 'salida norte', 'north gate'], ['gate'], 30, 20, 'El portón que da al camino del bosque y, más allá, a la montaña.'),
      S('sp_pl_herreria', 'la puerta de la herrería', ['fragua', 'martilleo'], ['door'], 24, -4, 'La puerta de la herrería de Hugo, con el hollín de veinte años en el dintel y el martilleo detrás.'),
      S('sp_pl_casona', 'la puerta de la casona', ['casa del regidor', 'aldaba'], ['door'], 6, 22, 'La puerta de roble de la casona del regidor, con aldaba de hierro y un escalón de piedra nueva.'),
      S('sp_pl_callejon', 'el callejón de las hierbas', ['callejón', 'callejon'], ['road'], -6, 14, 'Un callejón estrecho que huele a hierbas cocidas y lleva a la casa de la curandera.'),
      S('sp_pl_camino_molino', 'el camino del molino', ['camino del molino', 'huertos'], ['road'], 36, 6, 'Un camino de carro que baja entre huertos hacia el ruido del agua y la rueda del molino.'),
    ],
  },
  {
    id: 'loc_herreria', zone_id: 'zn_brezal', name: 'La herrería', indoor: true,
    description_base: 'Una fragua de piedra ennegrecida, calor de horno y olor a hierro. Herraduras y hojas a medio hacer cuelgan de las vigas.',
    ambience: { light: 'twilight', noise: 0.5, smell: 'hierro y carbón' },
    secret: 'Bajo la losa suelta, junto al yunque, los últimos eslabones de la cadena de hierro frío que ató la Brasa, forjados por el maestro de Hugo.',
    spots: [
      S('sp_he_puerta', 'la puerta', ['puerta', 'entrada'], ['door'], 0, 0, 'La puerta de la herrería, de tablones chamuscados.'),
      S('sp_he_fragua', 'la fragua', ['fragua', 'fuego', 'horno'], ['fireplace'], 5, 4, 'La fragua, con el fuelle remendado y brasas que nunca se dejan morir.'),
      S('sp_he_yunque', 'el yunque', ['yunque'], ['rock'], 7, 6, 'Un yunque viejo con una marca de Vharn medio borrada a martillazos.'),
      S('sp_he_banco', 'el banco de trabajo', ['banco', 'banco de trabajo', 'herramientas'], ['table'], 3, 8, 'Un banco con tenazas, limas y un cuaderno de pedidos lleno de deudas.'),
      S('sp_he_losa', 'la losa suelta', ['losa', 'losa suelta', 'suelo', 'baldosa'], ['trapdoor'], 9, 9, 'Una losa del suelo que suena a hueco; debajo, envuelto en lana engrasada, algo que pesa.',
        { hidden: true, dc_to_find: 13, capacity: 1 }),
    ],
  },
  {
    id: 'loc_casona', zone_id: 'zn_brezal', name: 'La casona', indoor: true,
    description_base: 'Una casa de piedra con muebles demasiado buenos para Brezal: tapices, una alfombra de lana roja y un reloj de arena con pie de plata.',
    ambience: { light: 'twilight', noise: 0.1, smell: 'cera y lana' },
    secret: 'En el arcón de los registros, con llave que lleva Garrán, una copa de plata con el sello de Vharn: lo último que Osric no se atrevió a fundir.',
    spots: [
      S('sp_ca_puerta', 'la puerta', ['puerta', 'entrada', 'zaguán'], ['door'], 0, 0, 'El zaguán, con una aldaba de hierro y un banco para quien espera.'),
      S('sp_ca_banco', 'el banco de espera', ['banco', 'banco de espera', 'espera'], ['stool'], 2, 4, 'Un banco de madera duro donde se sienta quien viene a pagar o a pedir.'),
      S('sp_ca_despacho', 'la mesa del despacho', ['despacho', 'mesa', 'escritorio', 'mesa del despacho'], ['table'], 7, 5, 'Una mesa ancha con libros de cuentas, un tintero y el sello del regidor.'),
      S('sp_ca_arcon', 'el arcón de los registros', ['arcón', 'arcon', 'registros', 'archivo'], ['chest'], 9, 8, 'Un arcón con herrajes nuevos y una cerradura que no se abre sin su llave.',
        { state: { locked: true, key_item_id: 'it_llave_arcon' }, capacity: 1 }),
      S('sp_ca_alcoba', 'la alcoba de arriba', ['alcoba', 'arriba', 'dormitorio'], ['bed', 'stairs'], 5, 11, 'La alcoba del regidor, con una cama con dosel y una ventana que da a la montaña.',
        { entry_cost_s: 20, ...apart('sp_ca_puerta', 'sp_ca_banco', 'sp_ca_despacho', 'sp_ca_arcon') }),
    ],
  },
  {
    id: 'loc_curandera', zone_id: 'zn_brezal', name: 'Casa de las hierbas', indoor: true,
    description_base: 'Una casa de una sola pieza llena de manojos de hierbas secándose del techo; huele a corteza cocida y a vela de sebo.',
    ambience: { light: 'twilight', noise: 0.05, smell: 'hierbas cocidas' },
    secret: 'Ilse fue la última sacerdotisa de la llama de Vharn: sabe el rito que ata la Brasa y lo guarda en la memoria, no en papel.',
    spots: [
      S('sp_cu_puerta', 'la puerta', ['puerta', 'entrada'], ['door'], 0, 0, 'Una puerta baja con un ramillete de ruda clavado.'),
      S('sp_cu_hierbas', 'las hierbas colgadas', ['hierbas', 'manojos', 'estantes'], ['shelf'], 3, 5, 'Estantes de tarros y manojos de hierbas; un tarro con ceniza lleva una etiqueta: «pozo, día 3».'),
      S('sp_cu_caldero', 'el caldero', ['caldero', 'fuego', 'olla'], ['fireplace'], 5, 2, 'Un caldero donde hierve corteza para la tos gris.'),
      S('sp_cu_camastro', 'el camastro', ['camastro', 'cama', 'jergón'], ['bed'], 7, 7, 'Un camastro limpio para enfermos, con una manta que huele a humo.'),
    ],
  },
  {
    id: 'loc_molino', zone_id: 'zn_brezal', name: 'El molino', indoor: true,
    description_base: 'Un molino de piedra junto al arroyo que baja de la montaña. La rueda chirría y el agua del canal sale tibia y gris.',
    ambience: { light: 'twilight', noise: 0.4, smell: 'harina y agua estancada' },
    secret: 'En el desván, bajo la paja, las cartas de Ysolde a Tobías y una bolsa de ceniza de la cripta.',
    spots: [
      S('sp_mo_puerta', 'la puerta', ['puerta', 'entrada'], ['door'], 0, 0, 'La puerta del molino, enharinada hasta la aldaba.'),
      S('sp_mo_muelas', 'las muelas', ['muelas', 'piedras', 'molienda'], ['rock'], 6, 4, 'Las muelas de piedra, que muelen a trompicones por la ceniza que trae el agua.'),
      S('sp_mo_sacos', 'los sacos de harina', ['sacos', 'harina', 'saco'], ['crate'], 3, 8, 'Sacos de harina apilados contra la pared, algunos con huellas de botas embarradas de gris.'),
      S('sp_mo_rueda', 'la rueda', ['rueda', 'canal', 'arroyo', 'senda del arroyo'], ['water'], 10, 2, 'La rueda y el canal; de aquí sale la senda que remonta el arroyo hacia el bosque.', { terrain_multiplier: 0.8 }),
      S('sp_mo_desvan', 'el desván', ['desván', 'desvan', 'altillo', 'paja'], ['stairs'], 8, 9, 'Un desván bajo con paja vieja, donde duerme Tobías cuando no quiere que le oigan llegar.',
        { hidden: true, dc_to_find: 12, capacity: 1 }),
    ],
  },
  // --- Bosque de Fresnos ------------------------------------------------------
  {
    id: 'loc_claro', zone_id: 'zn_fresnos', name: 'Claro del Roble', indoor: false,
    description_base: 'Un claro amplio rodeado de fresnos. Un roble enorme domina el centro; se oye un arroyo que baja tibio de la montaña.',
    ambience: { light: 'natural', noise: 0.1 },
    secret: 'De noche Tobías cruza el claro por el arroyo hacia la cuesta; el hacha del sendero es suya.',
    spots: [
      S('sp_cl_sendero', 'el sendero', ['sendero', 'camino', 'path'], ['road'], 0, 0, 'Donde el sendero desemboca en el claro; hay huellas de botas y de perro en el barro.'),
      S('sp_cl_roble', 'el roble viejo', ['roble', 'árbol grande', 'arbol', 'old oak', 'oak'], ['tree', 'cover'], 25, 15, 'Un roble centenario de tronco retorcido, con muescas de hacha recientes.'),
      S('sp_cl_piedra', 'la piedra grande', ['piedra', 'roca', 'rock'], ['rock', 'bush'], 12, 20, 'Una piedra plana y musgosa, buena para sentarse, junto a un zarzal de bayas.'),
      S('sp_cl_arroyo', 'el arroyo', ['arroyo', 'agua', 'río', 'stream'], ['water'], 40, 5, 'Un arroyo somero de agua tibia, con una película gris en los remansos.', { terrain_multiplier: 0.5 }),
      S('sp_cl_choza', 'la choza de pieles', ['choza', 'cabaña', 'pieles'], ['building'], 30, 35, 'Una choza de troncos con pieles tendidas y un ahumadero; huele a carne y a resina.'),
      S('sp_cl_cuesta', 'el arranque de la cuesta', ['cuesta', 'subida', 'camino de la montaña', 'montaña'], ['road'], 50, 30, 'Donde el bosque se acaba y empieza a subir una senda pedregosa, gris de ceniza vieja.'),
    ],
  },
  // --- Montaña de Vharn -------------------------------------------------------
  {
    id: 'loc_cuesta', zone_id: 'zn_vharn', name: 'Cuesta Gris', indoor: false,
    description_base: 'Una senda de pedregal que sube en zigzag entre troncos quemados. Todo es gris: la tierra, las piedras, el aire, que huele a azufre.',
    ambience: { light: 'natural', noise: 0.05, smell: 'azufre y ceniza' },
    secret: 'En la lobera vive la loba de ceniza, que bajó de la cumbre caliente; tiene acorralado al perro de Brenna.',
    spots: [
      S('sp_cs_pie', 'el pie de la cuesta', ['pie', 'pie de la cuesta', 'abajo'], ['road'], 0, 0, 'El pie de la cuesta, donde la ceniza empieza a cubrir las piedras.'),
      S('sp_cs_mojon', 'el mojón quemado', ['mojón', 'mojon', 'piedra quemada'], ['rock'], 20, 25, 'Un mojón de piedra con el sello de Vharn ennegrecido; alguien deja aquí comida envuelta en paño.'),
      S('sp_cs_cueva', 'la lobera', ['lobera', 'cueva', 'madriguera', 'agujero'], ['rock', 'dirt'], 12, 45, 'Una boca de roca entre raíces quemadas; huele a fiera y se oye gemir a un perro dentro.'),
      S('sp_cs_mirador', 'el mirador', ['mirador', 'saliente', 'vista'], ['rock'], 35, 50, 'Un saliente desde el que se ve todo el valle: Brezal abajo, pequeño, y arriba las torres negras de Vharn.'),
      S('sp_cs_alto', 'lo alto de la cuesta', ['alto', 'arriba', 'ciudadela', 'vharn'], ['road'], 40, 80, 'Donde la senda llega a la muralla rota de la ciudadela.'),
    ],
  },
  {
    id: 'loc_ruinas', zone_id: 'zn_vharn', name: 'Ruinas de Vharn', indoor: false,
    description_base: 'La ciudadela quemada: muros negros sin tejado, vigas caídas, un patio de armas cubierto de ceniza tibia. De alguna grieta sale un resplandor rojo que late.',
    ambience: { light: 'natural', noise: 0.05, smell: 'ceniza caliente' },
    secret: 'Ysolde Vharn vive en la torre hundida. La puerta de la cripta solo se abre con la llave de los Vharn, o rompiéndola.',
    spots: [
      S('sp_ru_puerta', 'la puerta rota', ['puerta rota', 'entrada', 'muralla'], ['gate'], 0, 0, 'Lo que queda de la puerta: dos goznes retorcidos y un arco de piedra negra.'),
      S('sp_ru_patio', 'el patio quemado', ['patio', 'patio de armas', 'patio quemado'], ['dirt'], 15, 12, 'El patio de armas, con la ceniza tibia hasta el tobillo y huellas recientes de pies pequeños.'),
      S('sp_ru_torre', 'la torre hundida', ['torre', 'torre hundida'], ['building'], 28, 6, 'Una torre sin techo con una lona tendida, un fuego pequeño y un catre: alguien vive aquí.'),
      S('sp_ru_capilla', 'la capilla de los señores', ['capilla', 'altar'], ['building'], 8, 26, 'Una capilla sin bóveda donde aún se reconocen las tumbas de los Vharn; alguien ha dejado flores secas.'),
      S('sp_ru_cripta', 'la puerta de la cripta', ['cripta', 'puerta de la cripta', 'escalera'], ['stairs'], 20, 30, 'Una puerta de hierro en el suelo, caliente al tacto, con el sello de Vharn como cerradura.',
        { state: { locked: true, key_item_id: 'it_llave_vharn' } }),
    ],
  },
  {
    id: 'loc_cripta', zone_id: 'zn_vharn', name: 'Cripta de la Brasa', indoor: true,
    description_base: 'Una cripta abovedada que suda calor. En el centro, sobre un pedestal, la Brasa: una piedra del tamaño de un corazón que arde sin consumirse.',
    ambience: { light: 'twilight', noise: 0.1, smell: 'hierro caliente' },
    secret: 'Las cadenas de hierro frío que ataban la Brasa están rotas desde el incendio: faltan eslabones.',
    spots: [
      S('sp_cr_escalera', 'la escalera', ['escalera', 'escalones', 'salida'], ['stairs'], 0, 0, 'Escalones de piedra que suben a las ruinas.'),
      S('sp_cr_cadenas', 'las cadenas rotas', ['cadenas', 'cadenas rotas', 'argollas'], ['rock'], 6, 6, 'Argollas en el suelo con cadenas de un hierro gris que no se calienta, rotas a la altura de un hombre.'),
      S('sp_cr_brasa', 'la Brasa', ['brasa', 'la brasa', 'pedestal', 'piedra ardiente'], ['fireplace'], 10, 10, 'La Brasa sobre su pedestal: late como algo vivo y la ceniza del suelo se mueve a su ritmo.'),
      S('sp_cr_altar', 'el altar de los Vharn', ['altar', 'altar de los vharn'], ['table'], 4, 12, 'Un altar de piedra con palabras grabadas en una lengua vieja que Ilse sabe leer.'),
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
  { id: 'ex_plaza_claro', from: 'sp_pl_porton', to: 'sp_cl_sendero', distance_m: 600, terrain_multiplier: 0.9 },
  { id: 'ex_molino_claro', from: 'sp_mo_rueda', to: 'sp_cl_arroyo', distance_m: 500, terrain_multiplier: 0.8 },
  { id: 'ex_claro_cuesta', from: 'sp_cl_cuesta', to: 'sp_cs_pie', distance_m: 700, terrain_multiplier: 0.8 },
  { id: 'ex_cuesta_ruinas', from: 'sp_cs_alto', to: 'sp_ru_puerta', distance_m: 400, terrain_multiplier: 0.7 },
  { id: 'ex_ruinas_cripta', from: 'sp_ru_cripta', to: 'sp_cr_escalera', distance_m: 6 },
];
