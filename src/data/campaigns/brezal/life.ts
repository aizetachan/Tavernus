/**
 * Brezal: lo que pasa aunque nadie mire. La agenda diaria (schedule.ts), los
 * rumores que ya corren cuando llega el jugador (rumors.ts), los ganchos que
 * el máster encuentra sembrados (hooks.ts) y los encuentros de camino por tipo
 * de zona (travel.ts).
 */

import type { ScheduledEvent } from '../../../engine/schedule.js';
import type { EncounterTable } from '../../../engine/travel.js';
import type { AuthoredHook, AuthoredRumor } from '../format.js';

export const SCHEDULE: ScheduledEvent[] = [
  {
    id: 'se_mercado', title: 'el mercado', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo',
    start_h: 9, duration_min: 4 * 60, recurrence: 'daily',
    description: 'Mercado de la mañana alrededor del pozo: buhoneros del valle con cestas, quesos, gallinas y cacharros; Mateo vende harina gris. Regateo a voces y habladurías: buen sitio para oír rumores y para que Garrán vea quién compra qué.',
    npc_ids: ['npc_mateo'], crowd: [{ label: 'vecinos', count: 20 }, { label: 'buhoneros', count: 4 }],
    effects: { noise: 0.5, state: { mercado: 'puestos de quesos, verdura y cacharros alrededor del pozo' } },
    loudness: 3,
    start_text: 'Llegan los buhoneros con sus cestas y montan los puestos alrededor del pozo. Empieza a llegar gente: la plaza se llena de voces, toses y regateo.',
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
    description: 'Cena en el Jabalí: guiso, pan gris y cerveza. Hugo y Doro beben juntos; los vecinos hablan de la tos, de los lobos y de las luces. La mejor hora para oír Brezal entero.',
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
    id: 'se_tobias', title: 'Tobías sube por la senda', location_id: 'loc_claro', spot_id: 'sp_cl_arroyo',
    start_h: 23, duration_min: 60, recurrence: 'daily',
    description: 'Cada noche Tobías cruza el claro por el arroyo con un hatillo de comida, camino de la cuesta y de las ruinas; vuelve antes del alba con una bolsa de ceniza. Sin antorcha. Si alguien le sale al paso, se asusta y miente mal.',
    npc_ids: ['npc_tobias'], crowd: [],
    effects: {},
    loudness: 0.5,
    start_text: 'Unos pasos ligeros chapotean en el arroyo: una figura con un hatillo cruza sin antorcha hacia la cuesta.',
    end_text: 'Los pasos se pierden cuesta arriba.',
    source: 'seed',
  },
];

export const RUMORS: AuthoredRumor[] = [
  { id: 'rm_luces', kind: 'place', name: 'Las luces de Vharn', hint: 'en la torre hundida de la ciudadela se ve luz algunas noches, aunque nadie ha subido en veinte años', where: 'la torre hundida, arriba en Vharn', location_id: 'loc_taberna', days: 30 },
  { id: 'rm_tos', kind: 'rumor', name: 'La tos gris', hint: 'quien bebe del pozo acaba tosiendo ceniza; la curandera da un tónico de corteza que alivia', where: 'el pozo de la plaza', location_id: 'loc_plaza', days: 30 },
  { id: 'rm_diezmo', kind: 'rumor', name: 'El diezmo de la ceniza', hint: 'el regidor cobra un diezmo nuevo «para la guardia», pero la guardia es Doro y no ha visto una moneda', where: null, location_id: 'loc_plaza', days: 30 },
  { id: 'rm_perro', kind: 'quest', name: 'El perro de Brenna', hint: 'a Ceniza, el perro de la tabernera, lo vieron subir hacia la cuesta detrás de un olor; Brenna paga a quien lo traiga', where: 'la cuesta de la ceniza', location_id: 'loc_taberna', days: 30 },
  { id: 'rm_plata', kind: 'item', name: 'La plata de los señores', hint: 'la plata de Vharn no se fundió en el incendio: alguien se la llevó aquella noche', where: null, location_id: 'loc_claro', days: 30 },
  { id: 'rm_rueda', kind: 'rumor', name: 'La rueda que se para', hint: 'el agua del arroyo baja caliente y la rueda del molino se atasca de ceniza', where: 'el molino', location_id: 'loc_molino', days: 30 },
];

export const HOOKS: AuthoredHook[] = [
  { id: 'hk_corriente', location_id: 'loc_taberna', trigger: { kind: 'spot', spot_id: 'sp_tab_mesa' },
    what: 'Sentado en la mesa del fondo, el PJ nota una corriente fría que sube por debajo de la alfombra y un olor a vino agrio. Si mira, que la tirada de Percepción para la trampilla tenga ventaja; no la regales.' },
  { id: 'hk_ruinas', location_id: 'loc_ruinas', trigger: { kind: 'location' },
    what: 'Al llegar a las ruinas, una voz educada desde lo alto de la torre: «¿Quién os manda? ¿El mayordomo?». Es Ysolde, con el ascua en la mano. No ataca si no la atacan; quiere saber a qué viene el PJ.' },
  { id: 'hk_lobera', location_id: 'loc_cuesta', trigger: { kind: 'spot', spot_id: 'sp_cs_cueva' },
    what: 'Al acercarse a la lobera: un gemido de perro dentro y, delante, la loba de ceniza que se levanta despacio, humeando. No ataca aún: enseña los dientes y espera. El PJ tiene un momento para decidir.' },
  { id: 'hk_garran_primera', location_id: 'loc_taberna', trigger: { kind: 'time', after_hours: 1.5 }, expires_hours: 4,
    what: 'Garrán entra en el Jabalí sacudiéndose la ceniza de los hombros, pide cerveza sin pagar y mira uno por uno a los forasteros, como quien cuenta deudas.' },
];

/** Encuentros de camino por tipo de zona: el máster pone el detalle. */
export const ENCOUNTERS: EncounterTable = {
  town: [
    { id: 'vecino', weight: 2, when: 'day', teaser: 'Un vecino con la cara gris de tos te para a mitad de camino.',
      what: 'Un vecino de Brezal (concreto: oficio, algo que lleva) te para para preguntar si eres «el que viene a arreglar lo del agua» o para pedir algo pequeño. Si encaja, trae uno de los rumores que corren.' },
    { id: 'garran_ronda', weight: 1, teaser: 'Unas botas pesadas se paran detrás de ti.',
      what: 'Garrán hace la ronda y se fija en el PJ: pregunta adónde va, recuerda deudas, insinúa que el regidor paga bien a quien sube a la montaña. No pelea en público si no le provocan.' },
    { id: 'ceniza_cae', weight: 1, when: 'night', teaser: 'Empieza a caer algo blando del cielo. No es nieve.',
      what: 'Cae ceniza fina sobre Brezal durante unos minutos. Alguien cierra contraventanas; un perro aúlla hacia la montaña.' },
  ],
  forest: [
    { id: 'lobo', weight: 3, night_weight: 2, teaser: 'Un crujido entre los fresnos, muy cerca del sendero.',
      what: 'Un lobo flaco, con ceniza en el lomo, sigue al PJ a distancia. Ataca solo si el PJ está herido o solo de noche; huye ante el fuego.' },
    { id: 'hal_trampa', weight: 2, when: 'day', teaser: 'Algo metálico brilla entre la hojarasca, junto al sendero.',
      what: 'Un cepo de Hal, el cazador, mal escondido. Si el PJ no lo ve (Percepción CD 12), Destreza CD 12 o 1d6 de daño y Hal aparece al rato, molesto y curioso.' },
    { id: 'huellas', weight: 2, teaser: 'En el barro del camino hay algo que te hace agacharte.',
      what: 'Huellas recientes: botas pequeñas que suben (Tobías) y, encima, las de un lobo enorme. Si el PJ sigue el rastro, lleva al arroyo y a la cuesta.' },
  ],
  mountain: [
    { id: 'pedregal', weight: 2, teaser: 'El pedregal se mueve bajo tus pies.',
      what: 'Un desprendimiento de piedras y ceniza en la senda: Destreza CD 12 o 1d6 de daño contundente; el camino queda más lento.' },
    { id: 'ascuas', weight: 2, night_weight: 2, teaser: 'Un resplandor rojo late entre las grietas de la roca.',
      what: 'Una grieta del suelo exhala aire caliente y ascuas: la Brasa respira. Quien se acerque nota que la montaña está tibia por dentro. Sin daño si no la toca.' },
    { id: 'lobos', weight: 1, night_weight: 3, teaser: 'Dos pares de ojos rojos en la pendiente, más arriba.',
      what: 'Dos lobos de la manada de la loba de ceniza cortan la senda. No atacan si el PJ lleva ceniza de la cripta encima; si no, uno tantea y el otro espera.' },
  ],
};
