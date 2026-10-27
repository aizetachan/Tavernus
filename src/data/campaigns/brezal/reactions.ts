/**
 * Brezal: cómo reacciona el valle (src/engine/worldrules.ts, bloque I). Las
 * etiquetas que se ganan, las reglas «cuando pasa esto, entonces…» y lo que la
 * gente dice al pasar en un día corriente. El motor no sabe quién es Hugo ni
 * Ceniza: lo lee de aquí.
 *
 *   - La muerte de Hugo: Doro, su amigo, guarda luto y, si fue un forastero, le
 *     coge inquina (−10, cuando se entera); en la plaza y en el Jabalí se habla
 *     del herrero unos días. Quien lo mató con nadie atacándole se lleva la
 *     etiqueta *asesino*, y Garrán, en cuanto lo sabe, le busca.
 *   - Devolver a Ceniza: Brenna, +10 (sustituye al «friendly» a mano de antes);
 *     la etiqueta *salvó a Ceniza*, el hecho `ceniza_salvado` y la gente
 *     comentándolo.
 *   - Los recados de Ilse suben su opinión (+5) y, a +25, la etiqueta *amigo de Ilse*.
 */

import type { ChatterDef } from '../../../engine/chatter.js';
import type { TagDef } from '../../../engine/model.js';
import type { WorldRule } from '../../../engine/worldrules.js';

export const TAGS: TagDef[] = [
  { id: 'asesino', label: 'asesino', text: 'ha matado a alguien que no le atacaba' },
  { id: 'ladron', label: 'ladrón', text: 'le han visto robar' },
  { id: 'salvo_ceniza', label: 'salvó a Ceniza', text: 'sacó al perro de Brenna de la madriguera de la loba' },
  { id: 'amigo_ilse', label: 'amigo de Ilse', text: 'la curandera se fía de él' },
];

const PLAZA_Y_JABALI = ['loc_plaza', 'loc_taberna'];

export const REACTIONS: WorldRule[] = [
  // --- La muerte de Hugo ---
  {
    id: 'hugo_muere', note: 'Muera como muera: luto de Doro, Brenna le guarda el sitio y el pueblo habla del herrero.',
    when: { on: 'npc_status', npc_id: 'npc_hugo', status: 'dead' },
    then: [
      { kind: 'topic', npc_id: 'npc_doro', days: 4, text: 'Hugo era su amigo: está de luto, con los ojos rojos; no quiere hablar del herrero y aprieta la lanza cuando alguien lo nombra.' },
      { kind: 'topic', npc_id: 'npc_brenna', days: 4, text: 'Lo de Hugo: le guarda la jarra en la barra y no deja que nadie se siente en su taburete.' },
      { kind: 'comment', comment_kind: 'rumor', location_ids: PLAZA_Y_JABALI, days: 3, texts: [
        '¿Os habéis enterado de lo del herrero?',
        'Ya no se oye el martillo. Sin {npc_role}, ¿quién va a herrar las mulas?',
        'Dicen que a {npc} lo encontraron en {place}. Que en paz descanse.',
        'Doro no ha dicho una palabra desde lo del herrero.',
      ] },
    ],
  },
  {
    id: 'hugo_muere_forastero', note: 'Si lo mató un PJ: Doro le coge inquina en cuanto se entera, y la gente le señala.',
    when: { on: 'npc_status', npc_id: 'npc_hugo', status: 'dead', by: 'pc' },
    then: [
      { kind: 'opinion', npc_id: 'npc_doro', delta: -10, why: 'mató a Hugo, su amigo' },
      { kind: 'comment', comment_kind: 'reaction', location_ids: PLAZA_Y_JABALI, days: 4, about_present: true, texts: [
        'Ese es {pc}… el que mató al herrero. No le mires.',
        'Mira quién se pasea por aquí como si nada, con Hugo aún caliente.',
      ] },
    ],
  },
  // --- Matar a quien no atacaba ---
  {
    id: 'asesinato', note: 'Cualquier muerte que el crimen tiene por asesinato (crime.ts): la etiqueta, y quien lo vio le teme.',
    when: { on: 'incident', kind: 'murder' },
    then: [
      { kind: 'tag', tag: 'asesino', why: 'mató a {victim}' },
      { kind: 'opinion', npc_id: 'witnesses', delta: -5, why: 'le vio matar a {victim}' },
    ],
  },
  {
    id: 'asesino_buscado', note: 'Garrán le busca en cuanto le llega (la caza la hace la ley, crime.ts); aquí, lo que lleva en la cabeza y lo que dice la gente.',
    when: { on: 'tag', tag: 'asesino' },
    then: [
      { kind: 'topic', npc_id: 'npc_garran', days: 5, text: 'Busca a {pc}: le han contado que mató a {victim}. Va adonde le vieron por última vez y pregunta en el Jabalí.' },
      { kind: 'comment', comment_kind: 'reaction', location_ids: PLAZA_Y_JABALI, days: 5, about_present: true, texts: ['Ahí va {pc}. Garrán anda buscándole.', 'Yo que tú no le daba la espalda a {pc}.'] },
    ],
  },
  {
    id: 'robo', note: 'Le han visto robar.',
    when: { on: 'incident', kind: 'theft' },
    then: [{ kind: 'tag', tag: 'ladron', why: 'le vieron robarle a {victim}' }, { kind: 'opinion', npc_id: 'witnesses', delta: -5, why: 'le vio robar' }],
  },
  // --- Ceniza vuelve a casa ---
  {
    id: 'ceniza_vuelve', note: 'Devolver el perro a Brenna: +10, la etiqueta, el hecho y el pueblo comentándolo.',
    when: { on: 'quest', quest_id: 'q_perro', event: 'done' },
    then: [
      { kind: 'opinion', npc_id: 'npc_brenna', delta: 10, why: 'nos devolvió a Ceniza' },
      { kind: 'tag', tag: 'salvo_ceniza', why: 'le devolvió el perro a Brenna' },
      { kind: 'fact', id: 'ceniza_salvado', text: '{pc} sacó a Ceniza de la madriguera de la loba y se lo devolvió a Brenna' },
      { kind: 'topic', npc_id: 'npc_brenna', days: 5, text: 'Ceniza ha vuelto: está de buen humor y se le escapa una sonrisa cuando el perro se le tumba en los pies.' },
      { kind: 'comment', comment_kind: 'rumor', location_ids: PLAZA_Y_JABALI, days: 3, texts: [
        '¿Habéis visto? El perro de Brenna ha vuelto.',
        'Dicen que a Ceniza lo sacó {pc} de la madriguera de la loba, al pie del roble.',
        'Brenna sonríe otra vez. Desde que volvió el perro, hasta fía.',
      ] },
      { kind: 'comment', comment_kind: 'reaction', location_ids: PLAZA_Y_JABALI, days: 4, about_present: true, texts: ['Ese es {pc}, el que trajo a Ceniza. Invítale a algo, hombre.'] },
    ],
  },
  {
    id: 'ceniza_perdido', note: 'Si se pierde (muere o se acaba el plazo): Brenna no quiere hablar de ello.',
    when: { on: 'quest', quest_id: 'q_perro', event: 'failed' }, once: 'world',
    then: [
      { kind: 'topic', npc_id: 'npc_brenna', days: 5, text: 'Ceniza no volvió: no quiere hablar de ello y friega la misma jarra una y otra vez.' },
      { kind: 'comment', comment_kind: 'rumor', location_ids: PLAZA_Y_JABALI, days: 3, texts: ['Pobre Brenna. El perro no volvió.', 'Dicen que la loba del Soto no suelta lo que coge.'] },
    ],
  },
  // --- La confianza de Ilse ---
  ...['q_agua', 'q_tonico_mateo', 'q_cadena'].map((q): WorldRule => ({
    id: `ilse_${q}`, note: 'Cada recado cumplido para Ilse.',
    when: { on: 'quest', quest_id: q, event: 'done' },
    then: [{ kind: 'opinion', npc_id: 'npc_ilse', delta: 5, why: 'le hizo un recado' }],
  })),
  {
    id: 'amigo_de_ilse', note: 'A +25 de opinión, Ilse se fía de él: la etiqueta.',
    when: { on: 'opinion', npc_id: 'npc_ilse', at_least: 25 },
    then: [{ kind: 'tag', tag: 'amigo_ilse', why: 'Ilse se fía de él' }],
  },
];

/** Vida diaria: lo que se oye en un día corriente, sin que pase nada. */
export const CHATTER: ChatterDef[] = [
  { id: 'plaza', location_ids: ['loc_plaza'], hours: [8, 21], texts: [
    'La niebla no levanta. Tres semanas ya.',
    'Si Garrán viene a cobrar otra vez, yo no tengo ni para pan.',
    'Dicen que en los Corrales han oído lobos esta noche.',
  ] },
  { id: 'jabali', location_ids: ['loc_taberna'], hours: [17, 2], texts: [
    'Otra jarra, Brenna, que mañana será peor.',
    'El agua del pozo sabe a ceniza, te lo digo yo.',
    'Ni los pájaros cruzan la niebla. Ni los pájaros.',
  ] },
  { id: 'molino', location_ids: ['loc_molino'], hours: [7, 19], npc_ids: ['npc_mateo'], texts: ['Esta tos no se me quita…', 'Tobías, la reja, que se nos para la rueda.'] },
];
