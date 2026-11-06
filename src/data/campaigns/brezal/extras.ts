/**
 * Brezal: los vecinos de relleno (docs/PLAN-NPC-RELLENO.md). Trece personas con oficio, nombre, horario y una
 * historia breve que hacen pueblo sin pesar en la historia: no saben nada del incendio, no dan misiones y remiten a
 * quien sí sabe. Lo demás (cómo se llama su oficio, qué lleva, cómo habla) lo pone la plantilla de su oficio
 * (src/engine/extras.ts); aquí, lo propio de cada uno.
 *
 * Sin contradecir el lore: la única guardia pagada sigue siendo Doro (el sereno hace la ronda por su cuenta), Brenna
 * sigue sola en la barra y no hay sacerdote (el rezo lo dirige Ilse; la beata cambia las velas). Benito y Fermina
 * son el labrador y la mujer de chal de la cena de «Humo y ceniza».
 *
 * Franjas del motor: mañana de 6 a 14, tarde de 14 a 20, noche de 20 a 6. Lo que pasa a una hora concreta (la cena,
 * la misa, la prueba de la niebla) va por los eventos a los que asisten (`attends`), y salen de su multitud.
 */

import type { AuthoredExtra } from '../format.js';

const CASAS = 'sp_pl_casas';

export const EXTRAS: AuthoredExtra[] = [
  {
    id: 'npc_x_anselmo', name: 'Anselmo', trade: 'watchman',
    look: 'Setenta años, capote remendado, un farol de aceite en la mano y un silbato colgado del cuello.',
    story: 'Desde que bajó la niebla hace la ronda de noche por su cuenta, porque «el chico» se va a la taberna. No cobra. Por la tarde se queda dormido en el banco del tablón.',
    routine: { day: CASAS, afternoon: 'sp_pl_tablon', night: 'sp_pl_porton' }, home_spot_id: CASAS,
    attends: ['se_prueba_niebla'], refer_to: ['npc_doro', 'npc_brenna'], wander: ['sp_pl_porton', 'sp_li_barricada'],
    lines: {
      greet: ['¿Quién va? Ah, un forastero. ¿Qué buscas?', 'A estas horas no se pasea. ¿Qué buscas?'],
      scared: ['¡Doro! ¡Doro, a mí!', '¡A la ronda! ¡Aquí!'],
    },
  },
  {
    id: 'npc_x_remedios', name: 'Remedios', trade: 'devout', gender: 'f',
    look: 'Viuda menuda, toca negra, manos con cera de vela en las uñas.',
    story: 'Tañe la campanilla de la misa del pozo y cambia las velas del brocal. Reza por los de Vharn sin decir por quién.',
    routine: { day: 'sp_pl_pozo', afternoon: CASAS, night: CASAS }, home_spot_id: CASAS,
    attends: ['se_misa'], refer_to: ['npc_ilse'],
    lines: { dunno: ['Eso no es para mí. Pregúntale a Ilse, que sabe de todo lo que duele.', 'Yo rezo; no pregunto.'] },
  },
  {
    id: 'npc_x_marta', name: 'Marta', trade: 'baker', gender: 'f',
    look: 'Cuarentona, brazos enharinados hasta el codo, un mandil gris de ceniza y harina.',
    story: 'Cuece con la harina gris de Mateo, cada día menos hornadas. Desconfía de los forasteros porque «comen y se van».',
    routine: { day: 'sp_pl_horno', afternoon: 'sp_pl_horno', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_mercado'], sells: [{ item_id: 'it_pan_gris', price: 2 }], refer_to: ['npc_brenna', 'npc_mateo'],
    lines: { dunno: ['Yo hago pan. Eso pregúntaselo a Brenna, que oye de todo.', 'Ni idea. Y si no compras, aparta.'] },
  },
  {
    id: 'npc_x_benito', name: 'Benito', trade: 'laborer',
    look: 'Manos agrietadas, sombrero de paja aplastado, barro hasta las rodillas.',
    story: 'Su campo quedó al otro lado de la niebla; riega un huerto prestado junto al camino del molino. Habla poco y mira el plato.',
    routine: { day: 'sp_pl_camino_molino', afternoon: 'sp_pl_camino_molino', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_cena'], refer_to: ['npc_mateo'],
    lines: { brush: ['Yo riego coles. Lo demás, Mateo.', 'Déjame comer.'] },
  },
  {
    id: 'npc_x_ciro', name: 'Ciro', trade: 'laborer', role: 'jornalero',
    look: 'Veinte años, flaco, un cubilete de dados asomando del bolsillo.',
    story: 'Juega a los dados en la cena y pierde. Le debe unas monedas a Garrán y se calla en cuanto le ve entrar.',
    routine: { day: 'sp_pl_corrales', afternoon: 'sp_pl_camino_molino', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_cena'], refer_to: ['npc_brenna'],
    lines: {
      greet: ['¿Juegas? No, ¿verdad? Pues nada.', '¿Qué?'],
      brush: ['Déjalo, que si me ve Garrán hablando…', 'No tengo nada que contar.'],
    },
  },
  {
    id: 'npc_x_fermina', name: 'Fermina', trade: 'washer', gender: 'f',
    look: 'Chal oscuro sobre los hombros, las manos rojas de agua fría y un cesto de ropa a la cadera.',
    story: 'Lava para la casona y para el Jabalí; dice que el agua sale gris y la ropa también. Mira mucho a la puerta: su marido, Ramiro, entra en la niebla cada noche atado a una cuerda.',
    routine: { day: 'sp_mo_rueda', afternoon: 'sp_pl_pozo', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_misa'], refer_to: ['npc_brenna'],
    bonds: [{ npc_id: 'npc_x_ramiro', kind: 'kin' }],
    lines: { brush: ['Tengo ropa de la casona que tender, y no espera.', 'No tengo tiempo para charlas.'] },
  },
  {
    id: 'npc_x_gil', name: 'Gil', trade: 'woodcutter',
    look: 'Hombros anchos, un hacha de mano al cinto y astillas en la barba.',
    story: 'Corta leña en el borde del Soto y la vende al Jabalí y a la herrería. No entra más adentro: «ahí hay lobos y algo peor».',
    routine: { day: 'sp_cl_sendero', afternoon: 'sp_pl_taberna', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_cena'], sells: [{ item_id: 'it_madera', price: 3 }], refer_to: ['npc_hal'],
    lines: { dunno: ['¿El Soto? Yo corto en el borde y no entro más. Pregúntale a Hal, que vive dentro.', 'Ni idea.'] },
  },
  {
    id: 'npc_x_lucio', name: 'Lucio', trade: 'peddler',
    look: 'Forastero de Valcruz, sombrero de ala ancha y un fardo de cacharros a la espalda.',
    story: 'La niebla le pilló dentro con el carro a medio vender. Duerme junto a la chimenea del Jabalí por una moneda y pregunta a todo el mundo si sabe cómo salir.',
    routine: { day: 'sp_pl_pozo', afternoon: 'sp_tab_mesa', night: 'sp_tab_chimenea' }, home_spot_id: 'sp_tab_chimenea',
    attends: ['se_mercado', 'se_cena'], refer_to: ['npc_brenna'],
    sells: [{ item_id: 'it_cuerda', price: 80 }, { item_id: 'it_hilo_aguja', price: 3 }, { item_id: 'it_yesca', price: 2 }],
    lines: { greet: ['¡Mira, mira! Cordel, aguja, yesca. Barato, que me quiero ir.', '¿Buscas algo? Lo que queda, barato.'] },
  },
  {
    id: 'npc_x_ines', name: 'Inés', trade: 'shepherd', gender: 'f', role: 'zagala',
    look: 'Catorce años, trenza mal hecha, una honda al cuello y olor a oveja.',
    story: 'Saca las ovejas de Úrsula desde que Pol se quedó al otro lado de la niebla. Habla con las ovejas más que con la gente.',
    routine: { day: 'sp_co_redil', afternoon: 'sp_cl_sendero', night: 'sp_co_casa' }, home_spot_id: 'sp_co_casa',
    refer_to: ['npc_ursula'],
  },
  {
    id: 'npc_x_pia', name: 'Pía', trade: 'child', gender: 'f',
    look: 'Ocho años, rodillas peladas, una cinta roja en el pelo y los bolsillos llenos de canicas de barro.',
    story: 'Vive en las casas del callejón. Corre detrás de los forasteros y repite lo que oye en casa; a la segunda pregunta, sale corriendo.',
    routine: { day: 'sp_pl_pozo', afternoon: 'sp_pl_callejon', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_mercado'], refer_to: ['npc_ilse'], wander: ['sp_pl_pozo', 'sp_pl_tablon', 'sp_pl_callejon'],
  },
  {
    id: 'npc_x_herminia', name: 'Herminia', trade: 'servant', gender: 'f', role: 'criada de la casona',
    look: 'Delantal almidonado, llavero pequeño a la cintura y la mirada en el suelo.',
    story: 'Sirve a Osric desde hace doce años. No dice nada de la casa, y se nota que lo tiene ensayado.',
    routine: { day: 'sp_ca_puerta', afternoon: 'sp_pl_pozo', night: 'sp_ca_banco' }, home_spot_id: 'sp_ca_banco',
    refer_to: ['npc_osric'],
    lines: {
      service: ['El señor regidor recibe por la mañana, en el despacho. Por la tarde, en la plaza, junto al tablón.'],
      dunno: ['De la casa no hablo.', 'Eso tendrá que preguntárselo al señor regidor.'],
    },
  },
  {
    id: 'npc_x_damian', name: 'Damián', trade: 'regular', role: 'viejo del Jabalí',
    look: 'Viejo de nariz roja, pipa de barro apagada entre los dientes y la espalda pegada a la chimenea.',
    story: 'Bebe a cuenta de una pensión que ya no llega. Cuenta lo de las luces del granero a quien le pague una cerveza, y siempre igual.',
    routine: { day: 'sp_tab_chimenea', afternoon: 'sp_tab_chimenea', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_cena'], refer_to: ['npc_brenna'],
    lines: {
      greet: ['Siéntate. ¿Me invitas a una? Te cuento lo de las luces.', '¿Me invitas a algo?'],
      brush: ['Sin cerveza no hay cuento.', 'Déjame beber tranquilo.'],
    },
  },
  {
    id: 'npc_x_ramiro', name: 'Ramiro', trade: 'laborer', role: 'hortelano',
    look: 'Cuarenta años, tos seca, ceniza en el pelo que no se va y un rollo de cuerda al hombro.',
    story: 'El marido de Fermina. Cada noche se ata la cuerda a la cintura y entra en la niebla desde la barricada; sale tosiendo por el mismo sitio y no cuenta nada.',
    routine: { day: 'sp_pl_camino_molino', afternoon: 'sp_pl_corrales', night: CASAS }, home_spot_id: CASAS,
    attends: ['se_prueba_niebla'], refer_to: ['npc_hal'],
    bonds: [{ npc_id: 'npc_x_fermina', kind: 'kin' }],
    lines: { dunno: ['¿La niebla? Entras, das vueltas y sales por donde entraste. Eso es todo.', 'No lo sé.'] },
  },
];
