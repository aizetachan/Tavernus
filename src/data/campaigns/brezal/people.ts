/**
 * Brezal: la gente. Diez personas y tres animales. Cada persona con su
 * aspecto y manera de hablar, lo que quiere, su secreto, lo que sabe, lo que
 * compra y vende, un bloque de combate SRD de nivel bajo (los mismos
 * arquetipos y rangos que el generador, skeleton.ts) y su horario por franjas.
 * `knows` y `ties` son para el análisis (docs/BREZAL.md); al motor llegan
 * descripción, motivación y secreto.
 */

import type { NpcStats } from '../../../engine/model.js';
import { ROOM_NIGHT_ITEM_ID, ROOM_NIGHT_PRICE } from '../../../worldgen/rooms.js';
import { ARCHETYPES } from '../../../worldgen/skeleton.js';
import type { AuthoredNpc } from '../format.js';

/** Bloque SRD de un arquetipo, con sus PG y, si acaso, el nombre de su arma. */
const srd = (a: keyof typeof ARCHETYPES, hp: number, extra: Partial<NpcStats> = {}): NpcStats => ({ ...ARCHETYPES[a], hp_max: hp, hp, ...extra });

export const NPCS: AuthoredNpc[] = [
  {
    id: 'npc_brenna', name: 'Brenna', role: 'tabernera', spot_id: 'sp_tab_barra', passive_perception: 12, attitude: 'neutral',
    description: 'Cincuenta años, brazos de amasar, una quemadura vieja en el dorso de la mano izquierda. Seca la misma jarra cuando piensa. Habla poco, en frases cortas, y mira mucho; cuando algo le duele, cambia de tema hacia el precio de la cerveza.',
    motivation: 'Que la taberna siga en pie, que su perro Ceniza vuelva a casa y que nadie suba a la montaña a remover lo que ella enterró.',
    secret: 'La noche del incendio servía en las cocinas de Vharn. Vio a Osric Malvez, entonces mayordomo, sacar la plata por la poterna y prender el granero para taparlo; el fuego llegó a la cripta. Ella sacó en brazos a la niña de los señores, Ysolde, y la dejó con unos carboneros del sur. Osric le dio la taberna a cambio de callar. Guarda en el sótano el libro de cuentas de Vharn, la prueba, por si algún día tiene valor para usarla.',
    knows: 'Quién prendió el fuego; dónde está el libro; que la niña de Vharn salió viva. No sabe que Ysolde ha vuelto.',
    ties: 'Teme a Osric y desprecia a Garrán. Quiere a Doro como a un sobrino tonto. Respeta a Ilse. Ceniza es su perro.',
    buys: [{ item_id: 'it_madera', price: 20 }, { item_id: 'it_bayas', price: 5 }, { item_id: 'it_pescado', price: 25 }, { item_id: 'it_harina', price: 25 }],
    sells: [{ item_id: 'it_cerveza', price: 30 }, { item_id: 'it_racion', price: 50 }, { item_id: 'it_antorcha', price: 10 }, { item_id: 'it_pocion', price: 2500 }, { item_id: ROOM_NIGHT_ITEM_ID, price: ROOM_NIGHT_PRICE }],
    stats: srd('commoner', 9, { attack_name: 'jarra' }),
    routine: { day: 'sp_tab_barra', night: 'sp_tab_mesa' },
  },
  {
    id: 'npc_doro', name: 'Doro', role: 'guardia', spot_id: 'sp_pl_porton', passive_perception: 15, attitude: 'neutral',
    description: 'Joven, alto, lanza apoyada en el hombro y botas demasiado nuevas. Habla más de la cuenta, se corrige a media frase y se ríe de sus propios chistes antes de acabarlos.',
    motivation: 'Que lo tomen en serio. Cobra de su tío, el regidor, por vigilar el portón y no dejar subir a nadie al camino de la montaña.',
    secret: 'Ha visto luces en la ciudadela dos noches seguidas y, una de ellas, una figura que bajaba por la senda del arroyo con un hatillo. No lo ha contado por miedo a que su tío le mande a mirar.',
    knows: 'Las luces, la figura de la senda, a qué hora cambia la guardia. Que su tío paga a Garrán por algo que no le cuentan.',
    ties: 'Sobrino de Osric, a quien admira y teme. Bebe por las noches en el Jabalí. Garrán se burla de él.',
    buys: [], sells: [],
    stats: srd('guard', 11),
    routine: { day: 'sp_pl_porton', night: 'sp_tab_barra' },
  },
  {
    id: 'npc_osric', name: 'Osric Malvez', role: 'regidor', spot_id: 'sp_ca_despacho', passive_perception: 13, attitude: 'neutral',
    description: 'Sesenta años, bien afeitado, capa de buen paño y anillos en tres dedos. Sonríe con la boca cerrada y llama a todo el mundo «vecino». Nunca levanta la voz: la levanta Garrán por él.',
    motivation: 'Que nadie suba a Vharn, que la aldea siga pagando el diezmo y que lo que vive en las ruinas desaparezca sin ruido.',
    secret: 'Prendió el fuego de Vharn hace veinte años para tapar que se llevaba la plata del sello; con ella compró la casona y el cargo. Sabe que en las ruinas vive alguien con el apellido Vharn y manda a deudores a «apagar las luces» por cuenta suya. Guarda en el arcón una copa de plata con el sello que no se atrevió a fundir.',
    knows: 'Todo lo del incendio. Que alguien vive arriba. Que Hugo guarda algo de la cadena y quiere que lo funda.',
    ties: 'Tío de Doro. Patrón de Garrán. Presta a Hugo para tenerlo agarrado. Sospecha de Brenna desde hace veinte años.',
    buys: [{ item_id: 'it_copa_vharn', price: 6000 }, { item_id: 'it_libro_cuentas', price: 5000 }],
    sells: [],
    stats: srd('noble', 9),
    routine: { day: 'sp_ca_despacho', afternoon: 'sp_pl_tablon', night: 'sp_ca_alcoba' },
  },
  {
    id: 'npc_garran', name: 'Garrán', role: 'alguacil y recaudador', spot_id: 'sp_pl_tablon', passive_perception: 12, attitude: 'unfriendly',
    description: 'Ancho como una puerta, la nariz rota dos veces y una maza corta al cinto. Cuenta con los dedos al hablar, como si todo fuera una deuda. Huele a cebolla y a cuero mojado.',
    motivation: 'Cobrar el diezmo de la ceniza, quedarse su parte y que nadie le haga subir a él a la montaña.',
    secret: 'Le pagan por cada deudor que sube a Vharn y no vuelve. Una noche subió él mismo, vio a una mujer con un fuego en la mano y bajó corriendo; desde entonces no duerme sin vela. Se queda una moneda de cada cinco del diezmo.',
    knows: 'Quién debe qué en Brezal. Que arriba hay alguien. Que el regidor guarda algo en el arcón (lleva la llave).',
    ties: 'Perro de Osric. Se burla de Doro. Ilse le cura la tos y le da miedo. Odia a Hal, que le rompió la nariz la segunda vez.',
    buys: [], sells: [],
    stats: srd('thug', 30),
    routine: { day: 'sp_pl_tablon', afternoon: 'sp_tab_barra', night: 'sp_ca_banco' },
  },
  {
    id: 'npc_ilse', name: 'Ilse', role: 'curandera', spot_id: 'sp_cu_hierbas', passive_perception: 14, attitude: 'neutral',
    description: 'Muy vieja, encorvada, los ojos claros como agua. Habla bajito y despacio, con palabras de rezo mezcladas con las de la cocina. Siempre tiene las manos manchadas de corteza.',
    motivation: 'Curar la tos gris, que el pueblo no vuelva a arder y morirse habiendo dejado el rito en buenas manos.',
    secret: 'Fue la última sacerdotisa de la llama de Vharn. Sabe que los señores ataban en la cripta un fuego antiguo, la Brasa, con cadenas de hierro frío, y sabe el rito para volver a atarla: hacen falta la llave de los Vharn, los eslabones que forjó el maestro de Hugo y alguien que baje a decir las palabras. Ella ya no puede subir la cuesta.',
    knows: 'Qué es la Brasa y cómo se ata. Que la tos gris viene de la ceniza del agua. Que Hugo guarda eslabones. No sabe quién prendió el fuego.',
    ties: 'Dirige la misa del pozo. Cuida a Garrán aunque le asuste. Tiene a Brenna por buena mujer con un peso dentro.',
    buys: [{ item_id: 'it_bayas', price: 8 }, { item_id: 'it_agua_pozo', price: 5 }],
    sells: [{ item_id: 'it_tonico', price: 150 }, { item_id: 'it_pocion', price: 2000 }],
    stats: srd('acolyte', 9, { attack_name: 'cayado' }),
    routine: { day: 'sp_cu_hierbas', afternoon: 'sp_cu_caldero', night: 'sp_cu_camastro' },
  },
  {
    id: 'npc_hugo', name: 'Hugo', role: 'herrero', spot_id: 'sp_he_fragua', passive_perception: 11, attitude: 'neutral',
    description: 'Cuarenta años, calvo, brazos marcados de quemaduras pequeñas. Habla a golpes, como martillea: dos palabras, silencio, otras dos. Se limpia las manos en el mandil antes de dar la mano y casi nunca la da.',
    motivation: 'Pagar al regidor la deuda de la fragua sin traicionar a su maestro, el herrero de Vharn que murió en el incendio.',
    secret: 'Bajo la losa suelta de la herrería guarda los últimos eslabones de la cadena de hierro frío que su maestro forjó para los señores. Osric le ha ordenado fundirlos a cambio de perdonarle la deuda y Hugo lleva un mes diciendo que mañana.',
    knows: 'Para qué servía la cadena. Que su maestro dijo, antes de morir, que «no fue el fuego lo que lo mató»: lo encerraron. Que Garrán viene a cobrar los jueves.',
    ties: 'Debe dinero a Osric. Bebe con Doro. Hizo la lanza de Doro. Su maestro tenía un hijo que se fue del valle.',
    buys: [{ item_id: 'it_madera', price: 25 }],
    sells: [{ item_id: 'it_daga', price: 200 }, { item_id: 'it_hacha', price: 500 }, { item_id: 'it_hacha_mano', price: 500 }, { item_id: 'it_espada_corta', price: 1000 }, { item_id: 'it_escudo', price: 1000 }],
    stats: srd('thug', 28, { attack_name: 'martillo' }),
    routine: { day: 'sp_he_fragua', afternoon: 'sp_he_yunque', night: 'sp_tab_mesa' },
  },
  {
    id: 'npc_mateo', name: 'Mateo', role: 'molinero', spot_id: 'sp_mo_muelas', passive_perception: 10, attitude: 'friendly',
    description: 'Cincuentón redondo, enharinado hasta las cejas, con una tos gris que le corta las frases. Cuenta chistes malos para no hablar de su hijo.',
    motivation: 'Que el molino no se pare: el agua baja tibia y con ceniza, la rueda se atasca y la harina sale gris. Y que su hijo no se meta en líos.',
    secret: 'Sabe que Tobías sale de noche hacia el bosque y lo ha encubierto ante Garrán dos veces. Teme que ande con «los de arriba» y prefiere no saberlo.',
    knows: 'A qué hora sale y vuelve Tobías. Que el agua viene caliente desde hace un mes. Quién compra harina en Brezal.',
    ties: 'Padre de Tobías. Debe el diezmo. Vende harina a Brenna.',
    buys: [{ item_id: 'it_pescado', price: 20 }, { item_id: 'it_madera', price: 15 }],
    sells: [{ item_id: 'it_harina', price: 20 }, { item_id: 'it_racion', price: 40 }],
    stats: srd('commoner', 5),
    routine: { day: 'sp_mo_muelas', night: 'sp_mo_sacos' },
  },
  {
    id: 'npc_tobias', name: 'Tobías', role: 'hijo del molinero', spot_id: 'sp_mo_sacos', passive_perception: 13, attitude: 'unfriendly',
    description: 'Diecisiete años, delgado, el pelo lleno de harina y las uñas negras de otra cosa. Contesta con preguntas y se le escapa una sonrisa cuando alguien habla mal del regidor.',
    motivation: 'Ser alguien. La mujer de la torre le ha prometido que será señor de Vharn cuando caiga el mayordomo.',
    secret: 'Cada noche sube por la senda del arroyo con comida para Ysolde y baja con una bolsa de ceniza de la cripta que echa al pozo, para que el pueblo enferme y entregue al regidor. Guarda sus cartas en el desván del molino. El hacha con hollín del claro es suya.',
    knows: 'Quién vive en las ruinas y qué quiere. El camino seguro de la cuesta. Que la loba de la lobera no ataca a quien lleva ceniza encima.',
    ties: 'Hijo de Mateo. Admira a Ysolde. Desprecia a Doro. Hal le ha visto subir y no ha dicho nada.',
    buys: [], sells: [],
    stats: srd('commoner', 6, { attack_name: 'cuchillo' }),
    routine: { day: 'sp_mo_sacos', afternoon: 'sp_cl_roble', night: 'sp_mo_desvan' },
  },
  {
    id: 'npc_ysolde', name: 'Ysolde', role: 'mujer del ascua', spot_id: 'sp_ru_torre', passive_perception: 15, attitude: 'unfriendly',
    description: 'Veinticinco años, alta, la cara medio cubierta por una cicatriz de quemadura que no esconde. Lleva en la mano izquierda, envuelta en un guante de cuero, una ascua que no se apaga. Habla con educación antigua, como en los libros, y nunca parpadea al escuchar.',
    motivation: 'Justicia para su casa: que el valle confiese quién prendió el fuego y lo pague. Si no la escuchan, soltar la Brasa en la noche de luna nueva y que arda Brezal como ardió Vharn.',
    secret: 'Es la heredera de Vharn, sacada del fuego de niña. Recuerda a una mujer con una antorcha llevándosela y cree que esa mujer, Brenna, prendió el incendio. No sabe que fue Osric ni que Brenna la salvó. Usa a Tobías para echar ceniza al pozo y debilitar al pueblo.',
    knows: 'La historia de su casa. Cómo se despierta la Brasa. Que el mayordomo de su padre vive en la casona. No sabe leer el rito: el altar está en la lengua de los sacerdotes.',
    ties: 'Manipula a Tobías. Hal le lleva caza. Odia a Brenna por error. Quiere ver muerto a Osric.',
    buys: [{ item_id: 'it_racion', price: 60 }, { item_id: 'it_libro_cuentas', price: 3000 }],
    sells: [],
    stats: { ac: 12, hp_max: 22, hp: 22, attack_bonus: 5, damage: '2d6', damage_type: 'fire', attack_name: 'llama de la Brasa', xp: 450 },
    routine: { day: 'sp_ru_torre', night: 'sp_ru_capilla' },
  },
  {
    id: 'npc_hal', name: 'Hal', role: 'cazador', spot_id: 'sp_cl_piedra', passive_perception: 16, attitude: 'neutral',
    description: 'Flaco, barba de semanas, ropa de pieles mal cosidas. Mira antes los pies que la cara. Habla en voz baja, como si hubiera presa cerca, y suelta las palabras de una en una.',
    motivation: 'Que lo dejen en paz en su bosque, que vuelva la caza y que nadie le cobre el diezmo por vivir fuera de la aldea.',
    secret: 'Le lleva caza a la mujer de la torre a cambio de plata vieja con el sello de Vharn, y no se lo ha dicho a nadie. Ha visto subir a Tobías de noche y lo deja pasar.',
    knows: 'El camino seguro de la cuesta y la lobera. Que la caza huyó porque la montaña está caliente. Que la loba no es un lobo normal: lleva ceniza en el pelo y no se cansa.',
    ties: 'Le rompió la nariz a Garrán. Doro le tiene miedo. Vende pieles a Brenna. Es lo más parecido a un amigo que tiene Ysolde.',
    buys: [{ item_id: 'it_piel', price: 150 }, { item_id: 'it_flechas', price: 4 }, { item_id: 'it_cerveza', price: 20 }],
    sells: [{ item_id: 'it_pescado', price: 30 }, { item_id: 'it_flechas', price: 5 }, { item_id: 'it_antorcha', price: 8 }],
    stats: srd('scout', 16, { attack_name: 'arco' }),
    routine: { day: 'sp_cl_piedra', afternoon: 'sp_cl_choza', night: 'sp_cl_choza' },
  },
  {
    id: 'npc_lobo', name: 'un lobo flaco', role: 'lobo', spot_id: 'sp_cl_arroyo', passive_perception: 13, attitude: 'hostile',
    description: 'Un lobo flaco, de pelaje gris con ceniza pegada al lomo. Bebe en el arroyo con las orejas hacia atrás; no huye.',
    motivation: 'Hambre. Bajó de la montaña porque arriba ya no queda caza.',
    secret: '', buys: [], sells: [],
    stats: srd('wolf', 11),
  },
  {
    id: 'npc_loba', name: 'la loba de ceniza', role: 'loba', spot_id: 'sp_cs_cueva', passive_perception: 15, attitude: 'hostile',
    description: 'Una loba enorme, del tamaño de un poni, con el pelo apelmazado de ceniza caliente que humea cuando se mueve. Tiene los ojos rojos como brasas y no gruñe: espera.',
    motivation: 'Defender la lobera. Bajó de la cumbre cuando la montaña empezó a arder por dentro.',
    secret: 'No ataca a quien lleva encima ceniza de la cripta: la huele como suya.',
    buys: [], sells: [],
    stats: { ac: 14, hp_max: 37, hp: 37, attack_bonus: 5, damage: '2d6+3', damage_type: 'piercing', attack_name: 'mordisco', xp: 200 },
  },
  {
    id: 'npc_ceniza', name: 'Ceniza', role: 'perro', spot_id: 'sp_cs_cueva', passive_perception: 14, attitude: 'friendly',
    description: 'Un perro pardo, flaco, con una oreja rota. Tiembla al fondo de la lobera y mueve el rabo en cuanto oye una voz que no gruñe.',
    motivation: 'Volver a casa, a la manta de delante de la chimenea.',
    secret: '', buys: [], sells: [],
    stats: null,
  },
];
