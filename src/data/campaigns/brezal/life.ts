/**
 * Brezal sellada: lo que pasa aunque nadie mire. La agenda diaria (schedule.ts), los
 * rumores que ya corren cuando llega el jugador (rumors.ts), los ganchos que
 * el máster encuentra sembrados (hooks.ts) y los encuentros de camino por tipo
 * de zona (travel.ts). Los rumores de partida son, sobre todo, lo que cada
 * vecino dice de la niebla: pistas verdaderas y falsas.
 */

import type { ScheduledEvent } from '../../../engine/schedule.js';
import type { EncounterTable } from '../../../engine/travel.js';
import type { AuthoredHook, AuthoredRumor } from '../format.js';

export const SCHEDULE: ScheduledEvent[] = [
  {
    id: 'se_mercado', title: 'el mercado', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo',
    start_h: 9, duration_min: 4 * 60, recurrence: 'daily',
    description: 'Mercado de la mañana alrededor del pozo: los buhoneros que la niebla dejó dentro, con cestas cada vez más vacías; Mateo vende la harina gris que queda y Úrsula, huevos. Regateo a voces y habladurías: buen sitio para oír rumores y para que Garrán vea quién compra qué.',
    npc_ids: ['npc_mateo', 'npc_ursula'], crowd: [{ label: 'vecinos', count: 20 }, { label: 'buhoneros', count: 4 }],
    effects: { noise: 0.5, state: { mercado: 'puestos de quesos, verdura y cacharros alrededor del pozo' } },
    loudness: 3,
    start_text: 'Los buhoneros atrapados montan los puestos alrededor del pozo, con menos género que ayer. Empieza a llegar gente: la plaza se llena de voces, toses y regateo.',
    end_text: 'Los buhoneros recogen los puestos; la plaza se va vaciando y vuelve el silencio.',
    source: 'seed',
  },
  {
    id: 'se_diezmo', title: 'el cobro del diezmo', location_id: 'loc_plaza', spot_id: 'sp_pl_tablon',
    start_h: 13, duration_min: 60, recurrence: 'daily',
    description: 'Garrán cobra junto al tablón el «diezmo de la ceniza» que ha puesto el regidor, con Doro detrás haciendo de pared. Los vecinos pagan de mala gana; quien no puede, deja algo en prenda. Momento para ver cómo trata Garrán a la gente y quién no paga.',
    npc_ids: ['npc_garran', 'npc_doro'], crowd: [{ label: 'vecinos en fila', count: 8 }],
    effects: { noise: 0.3, state: { diezmo: 'una fila de vecinos con monedas en la mano junto al tablón' }, busy_npc_ids: ['npc_garran'] },
    loudness: 2,
    start_text: 'Garrán planta una mesa junto al tablón, abre un libro y dice en voz alta: «El diezmo de la ceniza». Se forma una fila de vecinos callados.',
    end_text: 'Garrán cierra el libro de golpe y se guarda la bolsa. La fila se deshace entre murmullos.',
    source: 'seed',
  },
  {
    id: 'se_cena', title: 'la cena del Jabalí', location_id: 'loc_taberna', spot_id: 'sp_tab_barra',
    start_h: 19, duration_min: 2 * 60, recurrence: 'daily',
    description: 'Cena en el Jabalí: guiso, pan gris y cerveza. Hugo y Doro beben juntos; los vecinos hablan de la tos, de los lobos, de las luces del granero y, sobre todo, de la niebla. La mejor hora para oír Brezal entero.',
    npc_ids: ['npc_hugo'], crowd: [{ label: 'vecinos', count: 10 }],
    effects: { noise: 0.55, state: { cena: 'olor a guiso y la sala llena' } },
    loudness: 3,
    start_text: 'Se llena el Jabalí: huele a guiso, se arrastran bancos y alguien pide la primera ronda a gritos.',
    end_text: 'La sala se vacía poco a poco; quedan los de siempre, mirando el fuego.',
    source: 'seed',
  },
  {
    id: 'se_misa', title: 'la misa del pozo', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo',
    start_h: 20, duration_min: 60, recurrence: 'daily',
    description: 'A las ocho, Ilse dirige el rezo junto al pozo: velas en el brocal, cabezas gachas, un murmullo por los que no volvieron de Vharn. Brenna acude y no habla con nadie mientras dura. Si alguien tiene algo que decir delante de todo Brezal, es aquí.',
    npc_ids: ['npc_ilse', 'npc_brenna'], crowd: [{ label: 'feligreses', count: 12 }],
    effects: { noise: 0.1, state: { velas: 'velas encendidas en el brocal del pozo' }, busy_npc_ids: ['npc_brenna', 'npc_ilse'] },
    loudness: 2,
    start_text: 'Tañe la campanilla del pozo. Una docena de vecinos se juntan junto al brocal con velas; Ilse empieza el rezo con voz de hilo.',
    end_text: 'Termina el rezo. Se apagan las velas una a una y los vecinos vuelven a sus casas.',
    source: 'seed',
  },
  {
    id: 'se_tobias', title: 'la escapada al granero', location_id: 'loc_claro', spot_id: 'sp_cl_arroyo',
    start_h: 23, duration_min: 60, recurrence: 'daily',
    description: 'Cada noche Tobías cruza el Soto por el arroyo con un hatillo de comida, camino del Granero Quemado; vuelve antes del alba con una bolsa de ceniza. Sin antorcha. Si alguien le sale al paso, se asusta y miente mal.',
    npc_ids: ['npc_tobias'], crowd: [],
    effects: {},
    loudness: 0.5,
    start_text: 'Unos pasos ligeros chapotean en el arroyo: una figura con un hatillo cruza sin antorcha hacia el granero viejo.',
    end_text: 'Los pasos se pierden entre los alisos, hacia el granero.',
    source: 'seed',
  },
  {
    id: 'se_prueba_niebla', title: 'la prueba de la niebla', location_id: 'loc_lindero', spot_id: 'sp_li_barricada',
    start_h: 22, duration_min: 60, recurrence: 'daily',
    description: 'Cada noche, alguien lo prueba: dos o tres vecinos con antorchas junto a la barricada, uno se ata una cuerda a la cintura y entra en la niebla; al rato sale por el mismo sitio, con ceniza en el pelo, y la cuerda floja. Se discute si mañana lo intentará otro.',
    npc_ids: [], crowd: [{ label: 'vecinos con antorchas', count: 3 }],
    effects: { noise: 0.2, state: { prueba: 'unos vecinos con antorchas y una cuerda junto a la niebla' } },
    loudness: 1,
    start_text: 'Llegan tres vecinos con antorchas. Uno se ata una cuerda a la cintura y se mete en la niebla mientras los otros sujetan el cabo.',
    end_text: 'El de la cuerda sale por donde entró, tosiendo ceniza. Recogen la cuerda sin hablar y vuelven al pueblo.',
    source: 'seed',
  },
];

export const RUMORS: AuthoredRumor[] = [
  { id: 'rm_luces', kind: 'place', name: 'Las luces del granero', hint: 'en el granero quemado de los Vharn se ve luz algunas noches, aunque nadie entra allí desde el incendio', where: 'el Granero Quemado, al otro lado del Soto', location_id: 'loc_taberna', days: 30 },
  { id: 'rm_tos', kind: 'rumor', name: 'La tos gris', hint: 'quien bebe del pozo acaba tosiendo ceniza; la curandera da un tónico de corteza que alivia', where: 'el pozo de la plaza', location_id: 'loc_plaza', days: 30 },
  { id: 'rm_diezmo', kind: 'rumor', name: 'El diezmo de la ceniza', hint: 'el regidor cobra un diezmo nuevo «para la guardia», pero la guardia es Doro y no ha visto una moneda', where: null, location_id: 'loc_plaza', days: 30 },
  { id: 'rm_perro', kind: 'quest', name: 'El perro de Brenna', hint: 'a Ceniza, el perro de la tabernera, lo vieron meterse en el Soto detrás de un olor; Brenna paga a quien lo traiga', where: 'el Soto', location_id: 'loc_taberna', days: 30 },
  { id: 'rm_plata', kind: 'item', name: 'La plata de los señores', hint: 'la plata de Vharn no se fundió en el incendio: alguien se la llevó aquella noche', where: null, location_id: 'loc_claro', days: 30 },
  { id: 'rm_rueda', kind: 'rumor', name: 'La rueda que se para', hint: 'el agua del arroyo baja caliente y la rueda del molino se atasca de ceniza', where: 'el molino', location_id: 'loc_molino', days: 30 },
  // Lo que dice cada vecino del Cerco de Ceniza (pistas verdaderas y falsas).
  { id: 'rm_cerco_osric', kind: 'rumor', name: 'La maldición de Vharn', hint: 'el regidor Osric dice a quien pregunte por la niebla: «Es la maldición de Vharn. Quietos y callados, vecinos»', where: 'el Lindero', location_id: 'loc_casona', days: 30 },
  { id: 'rm_cerco_ilse', kind: 'rumor', name: 'El cerrojo', hint: 'la curandera Ilse dice de la niebla: «Es un cerrojo. Y los cerrojos tienen llave»', where: 'el Lindero', location_id: 'loc_curandera', days: 30 },
  { id: 'rm_cerco_brenna', kind: 'rumor', name: 'La niña del fuego', hint: 'Brenna, la tabernera, murmura que la niebla «bajó el día que volvió una niña que yo saqué del fuego», y luego cambia de tema', where: null, location_id: 'loc_taberna', days: 30 },
  { id: 'rm_cerco_hugo', kind: 'rumor', name: 'El cinturón de hierro', hint: 'Hugo, el herrero, dice que su maestro hablaba de «un cinturón de hierro que cerraba el valle»', where: 'el mojón del Lindero', location_id: 'loc_herreria', days: 30 },
  { id: 'rm_cerco_hal', kind: 'rumor', name: 'El ciervo que volvió', hint: 'Hal, el cazador, vio un ciervo entrar en la niebla y volver a salir sin soltar el aliento: «Ni la caza pasa»', where: 'el Lindero', location_id: 'loc_claro', days: 30 },
  { id: 'rm_cerco_doro', kind: 'rumor', name: 'El diezmo corto', hint: 'Doro, el guardia, repite que su tío dice que la niebla es «el castigo por cobrar poco diezmo»', where: null, location_id: 'loc_lindero', days: 30 },
  { id: 'rm_cerco_garran', kind: 'rumor', name: 'Deudores sin salida', hint: 'Garrán, el alguacil, se ríe de la niebla: «Los deudores no pueden huir. Mejor»', where: null, location_id: 'loc_plaza', days: 30 },
  { id: 'rm_cerco_mateo', kind: 'rumor', name: 'El grano que no llega', hint: 'Mateo, el molinero, dice que desde que bajó la niebla «el grano no llega ni sale» y vende la harina que queda', where: 'el molino', location_id: 'loc_molino', days: 30 },
  { id: 'rm_cerco_ursula', kind: 'person', name: 'Pol, al otro lado', hint: 'Úrsula, la viuda de los Corrales, dice que su hijo Pol salió al mercado de Valcruz la víspera de que bajara la niebla y está al otro lado', where: 'el camino de Valcruz, al otro lado de la niebla', location_id: 'loc_corrales', days: 30 },
];

export const HOOKS: AuthoredHook[] = [
  { id: 'hk_corriente', location_id: 'loc_taberna', trigger: { kind: 'spot', spot_id: 'sp_tab_mesa' },
    what: 'Sentado en la mesa del fondo, el PJ nota una corriente fría que sube por debajo de la alfombra y un olor a vino agrio. Si mira, que la tirada de Percepción para la trampilla tenga ventaja; no la regales.' },
  { id: 'hk_ruinas', location_id: 'loc_ruinas', trigger: { kind: 'location' },
    what: 'Al llegar al Granero Quemado, una voz educada desde lo alto del pajar: «¿Quién os manda? ¿El mayordomo?». Es Ysolde, con el ascua en la mano. No ataca si no la atacan; quiere saber a qué viene el PJ.' },
  { id: 'hk_lobera', location_id: 'loc_claro', trigger: { kind: 'spot', spot_id: 'sp_cs_cueva' },
    what: 'Al acercarse a la madriguera del roble: un gemido de perro dentro y, delante, la loba de ceniza que se levanta despacio, humeando. No ataca aún: enseña los dientes y espera. El PJ tiene un momento para decidir.' },
  { id: 'hk_lindero', location_id: 'loc_lindero', trigger: { kind: 'location' },
    what: 'Al llegar al Lindero por primera vez: el viento mueve las ramas pero no la niebla, que no huele a nada y apaga los sonidos. Junto a la barricada hay huellas que entran en la niebla y salen por el mismo sitio. Si el PJ intenta cruzarla, el motor lo resuelve solo (sale por donde entró, una hora después): no lo narres tú.' },
  { id: 'hk_garran_primera', location_id: 'loc_taberna', trigger: { kind: 'time', after_hours: 1.5 }, expires_hours: 4,
    what: 'Garrán se planta en la barra del Jabalí, se sacude la ceniza de los hombros, pide cerveza sin pagar y mira uno por uno a los forasteros, como quien cuenta deudas.' },
];

/** Encuentros de camino por tipo de zona: el máster pone el detalle. Toda la demo es aldea. */
export const ENCOUNTERS: EncounterTable = {
  town: [
    { id: 'vecino', weight: 2, when: 'day', teaser: 'Un vecino con la cara gris de tos te para a mitad de camino.',
      what: 'Un vecino de Brezal (concreto: oficio, algo que lleva) te para para preguntar si eres «el que viene a arreglar lo del agua» o si sabes algo de la niebla. Si encaja, trae uno de los rumores que corren.' },
    { id: 'garran_ronda', weight: 1, teaser: 'Unas botas pesadas se paran detrás de ti.',
      what: 'Garrán hace la ronda y se fija en el PJ: pregunta adónde va, recuerda deudas, insinúa que el regidor paga bien a quien va al granero a «apagar las luces». No pelea en público si no le provocan.' },
    { id: 'ceniza_cae', weight: 1, when: 'night', teaser: 'Empieza a caer algo blando del cielo. No es nieve.',
      what: 'Cae ceniza fina sobre Brezal durante unos minutos; no se va con el viento, la niebla la devuelve. Alguien cierra contraventanas; un perro aúlla hacia el granero.' },
    { id: 'lobo', weight: 1, night_weight: 2, teaser: 'Un crujido entre las cercas, muy cerca del camino.',
      what: 'Un lobo flaco, con ceniza en el lomo, sigue al PJ a distancia entre las cercas. Ataca solo si el PJ está herido o solo de noche; huye ante el fuego.' },
    { id: 'buhonero', weight: 1, when: 'day', teaser: 'Un hombre con un fardo a la espalda te mira como quien busca un comprador.',
      what: 'Un buhonero de fuera, atrapado por la niebla, vende barato lo que le queda (algo concreto y pequeño) o pregunta si alguien ha encontrado la manera de salir. Está asustado y lo disimula mal.' },
    { id: 'huellas', weight: 1, teaser: 'En el barro del camino hay algo que te hace agacharte.',
      what: 'Huellas recientes: botas pequeñas que van hacia el Soto (Tobías) y, encima, las de un lobo enorme. Si el PJ sigue el rastro, lleva al arroyo y al granero.' },
  ],
};
