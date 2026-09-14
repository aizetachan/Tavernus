/**
 * Mundo semilla para desarrollo y tests. Tres localizaciones en dos zonas,
 * dos PJs, dos NPCs, un par de recursos. Todo con coordenadas reales.
 */

import type { MasterConfig, WorldSnapshot } from '../../engine/model.js';

/** Instante real de arranque del reloj: fijo para que los tests sean deterministas. */
export const SEED_REAL_EPOCH_MS = Date.UTC(2026, 8, 1, 10, 0, 0);
/** El mundo arranca a las 08:00 del día 0. */
export const SEED_GAME_EPOCH_S = 8 * 3600;

export const DEFAULT_MASTER: MasterConfig = {
  model: 'claude-opus-5',
  effort: 'low',
  name: 'el Narrador',
  voice: [
    'un mago viejo y sereno que ha visto demasiado: habla con calma, sin prisa y sin adornos',
    'observa más que interpela: cuenta lo que pasa y lo que se ve, sin sermones ni provocaciones al jugador; las conclusiones las saca él',
    'concreto: nombra lo que hay, no lo que podría haber',
    'una pizca de misterio o de ironía seca de vez en cuando, nunca moraliza',
    'frases cortas; párrafos de dos o tres líneas',
  ],
  narration_length: 'short',
  perspective: 'second',
  difficulty: 'normal',
  improvisation: 3,
  max_tool_calls: 8,
};

export function makeSeed(): WorldSnapshot {
  return structuredClone(SEED);
}

const SEED: WorldSnapshot = {
  campaign: {
    id: 'demo',
    name: 'Las Cenizas de Vharn (demo)',
    time_ratio: 3,
    real_epoch_ms: SEED_REAL_EPOCH_MS,
    game_epoch_s: SEED_GAME_EPOCH_S,
    calendar: {
      day_names: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
      months: [
        { name: 'Brotes', days: 30 }, { name: 'Espigas', days: 30 }, { name: 'Cenizas', days: 30 }, { name: 'Escarcha', days: 30 },
      ],
      sunrise_h: 6, sunset_h: 20, twilight_h: 1,
    },
    starting_points: [
      { spot_id: 'sp_tab_puerta', origin: 'Llega a Brezal como viajero, con el polvo del camino del sur encima y la última moneda del último trabajo. La Taberna del Jabalí es lo primero que encuentra con la puerta abierta.' },
      { spot_id: 'sp_pl_pozo', origin: 'Es de Brezal, o casi: se crió aquí y se fue joven. Vuelve tras años fuera y la aldea le parece más pequeña y más callada de lo que recordaba.' },
      { spot_id: 'sp_cl_sendero', origin: 'Ha pasado la noche en el bosque de Fresnos, cazando o escondiéndose, según a quién se le pregunte. Baja hacia el claro con hambre y con la sensación de que algo en la montaña ha cambiado.' },
    ],
    perception_rules: {
      vision_base_m: 30, hearing_base_m: 20,
      light_factor: { day: 1, twilight: 0.5, night_moon: 0.25, night_dark: 0.05, torch: 0.2 },
      torch_fixed_m: 10, darkvision_m: 18, skill_step: 0.05, asleep_factor: 0.2,
    },
    movement_rules: { base_speed_mps: 1.5, pace: { stealth: 0.5, walk: 1, run: 2 } },
    capacity_rules: { pockets_slots: 4, carry_per_str: 15, encumbered_at: 5, heavily_at: 10, coins_per_lb: 50 },
    premise: 'Hace veinte años el fuego arrasó la ciudadela de Vharn y nadie ha vuelto a subir. La aldea de Brezal vive de espaldas a la montaña, pero las cenizas han empezado a moverse.',
    setting: 'Fantasía medieval oscura. Tecnología de hierro y madera; magia rara y temida.',
    tone: 'grim',
    content_rating: 2,
    language: 'es',
    house_rules: '',
    welcome: [
      'Hay nombres que la montaña pronuncia antes de que lleguen. Esta noche ha dicho uno nuevo: {name}.',
      '',
      'Abajo, Brezal duerme con las puertas entornadas. Lo que va a pasar allí no está escrito todavía.',
    ].join('\n'),
    master: DEFAULT_MASTER,
    factions: [{ id: 'fac_brezal', name: 'la aldea de Brezal', description: 'Los vecinos de Brezal. Desconfían de los forasteros hasta que hacen algo por la aldea.' }],
    clues: [
      { id: 'clue_hacha', title: 'El hacha con hollín', how: 'Examinar de cerca el hacha de leñador del claro (o el mango de cualquier hacha del claro): el hollín del mango es reciente y huele a resina quemada, no a leña de hogar. Alguien bajó de la montaña hace pocos días. Se obtiene con una tirada de Investigación CD 10 o Supervivencia CD 10 al examinarla con intención.', reputation: 2 },
      { id: 'clue_brenna', title: 'La noche del incendio', how: 'Brenna admite, a medias, que estuvo en Vharn la noche del incendio y que "no fue un accidente". Solo tras confianza ganada en varias conversaciones o una tirada de Persuasión/Perspicacia CD 16. Nunca da el nombre del culpable.', reputation: 2 },
      { id: 'clue_doro', title: 'Luces en la ciudadela', how: 'Doro confiesa que ha visto luces arriba dos noches seguidas y no lo ha contado. Sale si el jugador le trata como a un igual, le invita a algo o supera Persuasión CD 13; con Intimidación se cierra.', reputation: 2 },
      { id: 'clue_pozo', title: 'Ceniza en el agua del pozo', how: 'Al sacar agua del pozo o mirar el cubo con atención: el agua trae ceniza fina y un olor a azufre. El pozo lo alimenta un arroyo que baja de la montaña. Tirada de Percepción CD 11 o Naturaleza CD 10.', reputation: 2 },
      { id: 'clue_trampilla', title: 'Lo que hay bajo la taberna', how: 'Descubrir la trampilla oculta bajo la alfombra de la mesa del fondo (Percepción/Investigación CD 14) y bajar: un sótano con cajas marcadas con el sello de Vharn, tapadas con sacos. Brenna no quiere que se vea.', reputation: 2 },
    ],
    jobs: [
      { id: 'job_lena', title: 'Leña para la posada', text: 'Brenna paga por diez leños secos. Los del roble del claro sirven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_madera', quantity: 10 }, reward_coins: 900, reward_reputation: 1 },
      { id: 'job_bayas', title: 'Bayas para la despensa', text: 'Brenna quiere diez bayas del claro antes de que las pájaros se las lleven.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_bayas', quantity: 10 }, reward_coins: 500, reward_reputation: 1 },
      { id: 'job_pescado', title: 'Pescado fresco', text: 'Cinco truchas del arroyo del claro para la cena de la posada.', giver_npc_id: 'npc_brenna', kind: 'deliver', deliver: { item_id: 'it_pescado', quantity: 5 }, reward_coins: 800, reward_reputation: 1 },
      { id: 'job_ronda', title: 'Ronda hasta el claro', text: 'Doro no puede dejar el portón. Paga a quien vaya hasta el roble del claro, mire si hay alguien y vuelva a contárselo.', giver_npc_id: 'npc_doro', kind: 'visit', visit_spot_id: 'sp_cl_roble', reward_coins: 600, reward_reputation: 1 },
      { id: 'job_perro', title: 'El perro de la tabernera', text: 'Se ha perdido Ceniza, el perro de Brenna: pardo, una oreja rota. Lo vieron por el bosque. Quien lo traiga cobra.', giver_npc_id: 'npc_brenna', kind: 'narrative', reward_coins: 1000, reward_reputation: 2 },
      { id: 'job_pozo', title: 'Limpiar el pozo', text: 'El agua del pozo baja turbia. Doro paga por sacar diez cubos y limpiar la ceniza del brocal.', giver_npc_id: 'npc_doro', kind: 'narrative', reward_coins: 700, reward_reputation: 1 },
    ],
    achievement: {
      id: 'ach_ceniza', title: 'Quien ha mirado la ceniza', faction_id: 'fac_brezal', clues_required: 3, reputation_required: 5,
      reward_item_id: 'it_llave_vharn', reward_spot_id: 'sp_tab_habitacion',
      announcement: 'En Brezal empiezan a decir que {name} ha mirado la ceniza de frente. Brenna le ha cedido la habitación de arriba de la posada, y le ha dado una llave vieja con el sello de Vharn. Nadie sabe qué abre.',
    },
    progression: { practice_thresholds: [10, 30, 60], practice_min_dc: 10 },
    board: { active_job_ids: [], last_rotation_day: -1 },
  },
  regions: [{ id: 'rg_valle', name: 'Valle de Vharn' }],
  zones: [
    { id: 'zn_brezal', region_id: 'rg_valle', name: 'Aldea de Brezal', kind: 'town' },
    { id: 'zn_fresnos', region_id: 'rg_valle', name: 'Bosque de Fresnos', kind: 'forest' },
  ],
  locations: [
    {
      id: 'loc_taberna', zone_id: 'zn_brezal', name: 'Taberna del Jabalí',
      description_base: 'Una sala baja de vigas negras, con olor a cerveza rancia y humo de leña.',
      default_spot_id: 'sp_tab_puerta', indoor: true,
      ambience: { light: 'twilight', noise: 0.3, smell: 'cerveza y humo' }, state: {}, discovery: { ch_kael: 'visited', ch_mira: 'visited' },
    },
    {
      id: 'loc_plaza', zone_id: 'zn_brezal', name: 'Plaza del Pozo',
      description_base: 'La plaza empedrada de Brezal, con el pozo en el centro y el tablón de avisos junto a la herrería.',
      default_spot_id: 'sp_pl_taberna', indoor: false,
      ambience: { light: 'natural', noise: 0.2 }, state: {}, discovery: { ch_kael: 'visited', ch_mira: 'visited' },
    },
    {
      id: 'loc_claro', zone_id: 'zn_fresnos', name: 'Claro del Roble',
      description_base: 'Un claro amplio rodeado de fresnos. Un roble enorme domina el centro; se oye un arroyo.',
      default_spot_id: 'sp_cl_sendero', indoor: false,
      ambience: { light: 'natural', noise: 0.1 }, state: {}, discovery: { ch_kael: 'heard_of', ch_mira: 'heard_of' },
    },
  ],
  spots: [
    // Taberna
    sp('sp_tab_puerta', 'loc_taberna', 'la puerta', ['puerta', 'entrada', 'door'], 'La puerta de la taberna, siempre entornada.', 0, 0),
    sp('sp_tab_barra', 'loc_taberna', 'la barra', ['barra', 'mostrador', 'bar'], 'Una barra de roble gastado, con jarras colgando.', 6, 2),
    sp('sp_tab_mesa', 'loc_taberna', 'la mesa del fondo', ['mesa', 'mesa del fondo', 'rincón', 'fondo'], 'Una mesa en penumbra, lejos de la puerta.', 10, 6),
    sp('sp_tab_chimenea', 'loc_taberna', 'la chimenea', ['chimenea', 'fuego', 'hogar'], 'Un hogar de piedra con brasas.', 3, 7),
    { ...sp('sp_tab_trampilla', 'loc_taberna', 'la trampilla', ['trampilla', 'sótano', 'trapdoor'], 'Una trampilla bajo la alfombra, con una argolla oxidada.', 10, 8), hidden: true, dc_to_find: 14, capacity: 1 },
    { ...sp('sp_tab_habitacion', 'loc_taberna', 'la habitación de arriba', ['habitacion', 'habitación', 'mi habitación', 'arriba', 'cuarto'], 'Un cuarto pequeño bajo el tejado, con un jergón, un arcón y una puerta que cierra con llave.', 4, 12), hidden: true, capacity: 2, entry_cost_s: 20, links: [{ to_spot_id: 'sp_tab_barra', blocks_sight: true, muffles: 0.8 }, { to_spot_id: 'sp_tab_mesa', blocks_sight: true, muffles: 0.8 }, { to_spot_id: 'sp_tab_chimenea', blocks_sight: true, muffles: 0.8 }, { to_spot_id: 'sp_tab_puerta', blocks_sight: true, muffles: 0.8 }] },
    // Plaza
    sp('sp_pl_taberna', 'loc_plaza', 'la puerta de la taberna', ['taberna', 'puerta de la taberna'], 'El umbral de la Taberna del Jabalí, con un jabalí tallado sobre el dintel.', 0, 0),
    sp('sp_pl_pozo', 'loc_plaza', 'el pozo', ['pozo', 'well'], 'Un pozo de piedra con un cubo de madera.', 15, 10),
    sp('sp_pl_tablon', 'loc_plaza', 'el tablón', ['tablon', 'tablón de avisos', 'avisos', 'board'], 'Un tablón lleno de avisos clavados.', 20, 4),
    sp('sp_pl_porton', 'loc_plaza', 'el portón norte', ['porton', 'portón', 'puerta norte', 'salida norte', 'north gate'], 'El portón que da al camino del bosque.', 30, 20),
    // Claro
    { ...sp('sp_cl_sendero', 'loc_claro', 'el sendero', ['sendero', 'camino', 'path'], 'Donde el sendero desemboca en el claro.', 0, 0), tags: ['road'] },
    { ...sp('sp_cl_roble', 'loc_claro', 'el roble viejo', ['roble', 'árbol grande', 'arbol', 'old oak', 'oak'], 'Un roble centenario de tronco retorcido.', 25, 15), entry_cost_s: 0, tags: ['climbable', 'cover'] },
    sp('sp_cl_piedra', 'loc_claro', 'la piedra grande', ['piedra', 'roca', 'rock'], 'Una piedra plana y musgosa, buena para sentarse.', 12, 20),
    { ...sp('sp_cl_arroyo', 'loc_claro', 'el arroyo', ['arroyo', 'agua', 'río', 'stream'], 'Un arroyo somero de agua fría.', 40, 5), terrain_multiplier: 0.5, tags: ['water'] },
  ],
  exits: [
    { id: 'ex_tab_plaza', from_spot_id: 'sp_tab_puerta', to_spot_id: 'sp_pl_taberna', distance_m: 3, terrain_multiplier: 1, bidirectional: true, state: {} },
    { id: 'ex_plaza_claro', from_spot_id: 'sp_pl_porton', to_spot_id: 'sp_cl_sendero', distance_m: 600, terrain_multiplier: 0.9, bidirectional: true, state: {} },
  ],
  characters: [
    ch('ch_kael', 'u_kael', 'Kael', 'sp_tab_barra', { str: 14, dex: 12, con: 13, int: 10, wis: 12, cha: 8 }, 11),
    ch('ch_mira', 'u_mira', 'Mira', 'sp_pl_pozo', { str: 8, dex: 16, con: 10, int: 13, wis: 15, cha: 12 }, 14),
  ],
  npcs: [
    {
      id: 'npc_brenna', name: 'Brenna', role: 'tabernera', location: { type: 'spot', id: 'sp_tab_barra' }, status: 'alive', passive_perception: 12,
      description: 'Cincuenta años, brazos de amasar, una quemadura vieja en el dorso de la mano izquierda. Seca la misma jarra cuando piensa. Habla poco y mira mucho.',
      motivation: 'Que la taberna siga en pie y que nadie vuelva a subir a la montaña.',
      secret: 'Estuvo en Vharn la noche del incendio. Sabe que no fue un accidente y sabe quién encendió el fuego, pero cree que nombrarlo trae la ruina.',
      memory: [], talking_to: null,
      buys: [{ item_id: 'it_madera', price: 20 }, { item_id: 'it_bayas', price: 5 }, { item_id: 'it_pescado', price: 25 }],
      sells: [{ item_id: 'it_cerveza', price: 30 }, { item_id: 'it_antorcha', price: 10 }, { item_id: 'it_pocion', price: 2500 }],
      stats: { ac: 10, hp_max: 9, hp: 9, attack_bonus: 2, damage: '1d4', damage_type: 'bludgeoning', attack_name: 'jarra', xp: 10 },
      attitude: { default: 'neutral', by_character: {} },
    },
    {
      id: 'npc_doro', name: 'Doro', role: 'guardia', location: { type: 'spot', id: 'sp_pl_porton' }, status: 'alive', passive_perception: 15,
      description: 'Joven, alto, lanza apoyada en el hombro y botas demasiado nuevas. Habla más de la cuenta y se corrige a media frase.',
      motivation: 'Que lo tomen en serio. Cobra por vigilar el portón y no dejar subir a nadie al camino de la montaña.',
      secret: 'Ha visto luces en la ciudadela dos noches seguidas y no lo ha contado por miedo a que lo manden a mirar.',
      memory: [], talking_to: null, buys: [], sells: [],
      stats: { ac: 16, hp_max: 11, hp: 11, attack_bonus: 3, damage: '1d6+1', damage_type: 'piercing', attack_name: 'lanza', xp: 25 },
      attitude: { default: 'neutral', by_character: {} },
    },
    {
      id: 'npc_lobo', name: 'un lobo gris', role: 'lobo', location: { type: 'spot', id: 'sp_cl_arroyo' }, status: 'alive', passive_perception: 13,
      description: 'Un lobo flaco, de pelaje gris con ceniza pegada al lomo. Bebe en el arroyo con las orejas hacia atrás; no huye.',
      motivation: 'Hambre. Bajó de la montaña porque arriba ya no queda caza.',
      secret: '', memory: [], talking_to: null, buys: [], sells: [],
      stats: { ac: 13, hp_max: 11, hp: 11, attack_bonus: 4, damage: '2d4+2', damage_type: 'piercing', attack_name: 'mordisco', xp: 50 },
      attitude: { default: 'hostile', by_character: {} },
    },
  ],
  vehicles: [
    { id: 'vh_mula', name: 'la mula de Brenna', kind: 'mount', location: { type: 'spot', id: 'sp_pl_taberna' }, speed_ft: 40, capacity: 1, owner_id: null, terrain_allowed: [] },
  ],
  item_defs: [
    { id: 'it_mochila', name: 'mochila', aliases: ['backpack', 'bolsa'], type: 'container', size: 'medium', weight_lb: 5, value: 400, unique: false, container: { slots: 20, max_weight_lb: 30, max_size: 'medium' }, equip_slot: 'back', origin: 'srd' },
    { id: 'it_antorcha', name: 'antorcha', aliases: ['torch', 'tea'], type: 'misc', size: 'small', weight_lb: 1, value: 8, unique: false, light_source: true, origin: 'srd' },
    { id: 'it_cuerda', name: 'cuerda de cáñamo', aliases: ['cuerda', 'rope'], type: 'tool', size: 'medium', weight_lb: 10, value: 100, unique: false, origin: 'srd' },
    { id: 'it_daga', name: 'daga', aliases: ['dagger', 'cuchillo'], type: 'weapon', size: 'small', weight_lb: 1, value: 200, unique: false, weapon: { damage: '1d4', damage_type: 'piercing', finesse: true }, origin: 'srd' },
    { id: 'it_hacha', name: 'hacha de leñador', aliases: ['hacha', 'axe'], type: 'tool', size: 'medium', weight_lb: 4, value: 500, unique: false, weapon: { damage: '1d6', damage_type: 'slashing' }, origin: 'srd' },
    { id: 'it_madera', name: 'leña', aliases: ['madera', 'tronco', 'wood', 'leños'], type: 'misc', size: 'medium', weight_lb: 5, value: 5, unique: false, origin: 'custom' },
    { id: 'it_bayas', name: 'bayas', aliases: ['baya', 'berries', 'frutos'], type: 'consumable', size: 'tiny', weight_lb: 0.1, value: 2, unique: false, origin: 'custom' },
    { id: 'it_pocion', name: 'poción de curación', aliases: ['poción', 'pocion', 'potion'], type: 'consumable', size: 'small', weight_lb: 0.5, value: 2500, unique: false, origin: 'srd' },
    { id: 'it_cofre', name: 'cofre de la posada', aliases: ['cofre', 'arcón', 'chest'], type: 'container', size: 'bulky', weight_lb: 60, value: 0, unique: false, container: { slots: 30, max_weight_lb: 200, max_size: 'large', fixed: true }, origin: 'custom' },
    { id: 'it_barril', name: 'barril', aliases: ['barrel', 'tonel'], type: 'misc', size: 'bulky', weight_lb: 40, value: 50, unique: false, origin: 'custom' },
    { id: 'it_pescado', name: 'trucha', aliases: ['pescado', 'pez', 'truchas', 'fish'], type: 'consumable', size: 'small', weight_lb: 1, value: 25, unique: false, origin: 'custom' },
    { id: 'it_llave_vharn', name: 'llave vieja con el sello de Vharn', aliases: ['llave', 'llave de vharn', 'key'], type: 'quest', size: 'tiny', weight_lb: 0.1, value: 0, unique: true, origin: 'custom' },
    { id: 'it_cerveza', name: 'jarra de cerveza', aliases: ['cerveza', 'jarra', 'beer'], type: 'consumable', size: 'small', weight_lb: 1, value: 30, unique: false, origin: 'custom' },
    // Equipo inicial de clase (SRD)
    { id: 'it_racion', name: 'ración', aliases: ['raciones', 'comida', 'ration'], type: 'consumable', size: 'small', weight_lb: 2, value: 50, unique: false, origin: 'srd' },
    { id: 'it_armadura_cuero', name: 'armadura de cuero', aliases: ['cuero', 'leather armor'], type: 'armor', size: 'large', weight_lb: 10, value: 1000, unique: false, equip_slot: 'body', armor: { ac_base: 11, dex_max: null, stealth_disadvantage: false }, origin: 'srd' },
    { id: 'it_cota_escamas', name: 'cota de escamas', aliases: ['escamas', 'scale mail'], type: 'armor', size: 'large', weight_lb: 45, value: 5000, unique: false, equip_slot: 'body', armor: { ac_base: 14, dex_max: 2, stealth_disadvantage: true }, origin: 'srd' },
    { id: 'it_cota_malla', name: 'cota de malla', aliases: ['malla', 'chain mail'], type: 'armor', size: 'large', weight_lb: 55, value: 15000, unique: false, equip_slot: 'body', armor: { ac_base: 16, dex_max: 0, stealth_disadvantage: true }, origin: 'srd' },
    { id: 'it_escudo', name: 'escudo', aliases: ['shield'], type: 'armor', size: 'medium', weight_lb: 6, value: 1000, unique: false, shield_bonus: 2, origin: 'srd' },
    { id: 'it_espada_larga', name: 'espada larga', aliases: ['espada', 'longsword'], type: 'weapon', size: 'medium', weight_lb: 3, value: 1500, unique: false, weapon: { damage: '1d8', damage_type: 'slashing' }, origin: 'srd' },
    { id: 'it_espada_corta', name: 'espada corta', aliases: ['espada', 'shortsword'], type: 'weapon', size: 'medium', weight_lb: 2, value: 1000, unique: false, weapon: { damage: '1d6', damage_type: 'piercing', finesse: true }, origin: 'srd' },
    { id: 'it_estoque', name: 'estoque', aliases: ['rapier'], type: 'weapon', size: 'medium', weight_lb: 2, value: 2500, unique: false, weapon: { damage: '1d8', damage_type: 'piercing', finesse: true }, origin: 'srd' },
    { id: 'it_maza', name: 'maza', aliases: ['mace'], type: 'weapon', size: 'medium', weight_lb: 4, value: 500, unique: false, weapon: { damage: '1d6', damage_type: 'bludgeoning' }, origin: 'srd' },
    { id: 'it_baston', name: 'bastón', aliases: ['vara', 'quarterstaff', 'staff'], type: 'weapon', size: 'large', weight_lb: 4, value: 20, unique: false, weapon: { damage: '1d6', damage_type: 'bludgeoning' }, origin: 'srd' },
    { id: 'it_gran_hacha', name: 'gran hacha', aliases: ['hacha grande', 'greataxe'], type: 'weapon', size: 'large', weight_lb: 7, value: 3000, unique: false, weapon: { damage: '1d12', damage_type: 'slashing', two_handed: true }, origin: 'srd' },
    { id: 'it_hacha_mano', name: 'hacha de mano', aliases: ['hachuela', 'handaxe'], type: 'weapon', size: 'small', weight_lb: 2, value: 500, unique: false, weapon: { damage: '1d6', damage_type: 'slashing' }, origin: 'srd' },
    { id: 'it_arco_corto', name: 'arco corto', aliases: ['arco', 'shortbow'], type: 'weapon', size: 'large', weight_lb: 2, value: 2500, unique: false, weapon: { damage: '1d6', damage_type: 'piercing', ranged: true, two_handed: true }, origin: 'srd' },
    { id: 'it_flechas', name: 'flecha', aliases: ['flechas', 'arrows'], type: 'misc', size: 'tiny', weight_lb: 0.05, value: 5, unique: false, origin: 'srd' },
    { id: 'it_ganzuas', name: 'herramientas de ladrón', aliases: ['ganzuas', 'ganzúas', 'thieves tools'], type: 'tool', size: 'small', weight_lb: 1, value: 2500, unique: false, origin: 'srd' },
    { id: 'it_libro_conjuros', name: 'libro de conjuros', aliases: ['libro', 'grimorio', 'spellbook'], type: 'tool', size: 'small', weight_lb: 3, value: 5000, unique: false, origin: 'srd' },
    { id: 'it_bolsa_componentes', name: 'bolsa de componentes', aliases: ['componentes', 'component pouch'], type: 'tool', size: 'small', weight_lb: 2, value: 2500, unique: false, origin: 'srd' },
    { id: 'it_simbolo_sagrado', name: 'símbolo sagrado', aliases: ['simbolo', 'holy symbol'], type: 'tool', size: 'tiny', weight_lb: 1, value: 500, unique: false, origin: 'srd' },
    { id: 'it_laud', name: 'laúd', aliases: ['laud', 'lute', 'instrumento'], type: 'tool', size: 'medium', weight_lb: 2, value: 3500, unique: false, origin: 'srd' },
    { id: 'it_espada_mira', name: 'espada de Mira', aliases: ['espada', 'sword'], type: 'weapon', size: 'medium', weight_lb: 3, value: 3000, unique: true, weapon: { damage: '1d8', damage_type: 'slashing' }, origin: 'custom' },
  ],
  item_instances: [
    { id: 'ii_kael_mochila', item_id: 'it_mochila', quantity: 1, location: { type: 'character', id: 'ch_kael', slot: { kind: 'equipped', slot: 'back' } }, state: {} },
    { id: 'ii_kael_daga', item_id: 'it_daga', quantity: 1, location: { type: 'character', id: 'ch_kael', slot: { kind: 'hand', which: 'main' } }, state: {} },
    { id: 'ii_kael_cuerda', item_id: 'it_cuerda', quantity: 1, location: { type: 'container', id: 'ii_kael_mochila' }, state: {} },
    { id: 'ii_kael_antorchas', item_id: 'it_antorcha', quantity: 3, location: { type: 'container', id: 'ii_kael_mochila' }, state: {} },
    { id: 'ii_mira_antorcha', item_id: 'it_antorcha', quantity: 1, location: { type: 'character', id: 'ch_mira', slot: { kind: 'pocket' } }, state: {} },
    { id: 'ii_mira_espada', item_id: 'it_espada_mira', quantity: 1, location: { type: 'character', id: 'ch_mira', slot: { kind: 'hand', which: 'main' } }, state: {} },
    { id: 'ii_cofre', item_id: 'it_cofre', quantity: 1, location: { type: 'spot', id: 'sp_tab_mesa' }, state: {} },
    { id: 'ii_cofre_pocion', item_id: 'it_pocion', quantity: 2, location: { type: 'container', id: 'ii_cofre' }, state: {} },
    { id: 'ii_barril', item_id: 'it_barril', quantity: 1, location: { type: 'spot', id: 'sp_tab_chimenea' }, state: {} },
    { id: 'ii_hacha_suelo', item_id: 'it_hacha', quantity: 1, location: { type: 'spot', id: 'sp_cl_sendero' }, state: {} },
  ],
  resource_nodes: [
    { id: 'rn_roble', spot_id: 'sp_cl_roble', name: 'el roble viejo', aliases: ['roble', 'árbol', 'arbol', 'oak'], resource_item_id: 'it_madera', yield_max: 6, regen_time_s: 24 * 3600, last_harvested_game_s: null, regen_state_at_harvest: 1, destructive: true, skill: 'athletics', dc: 10, tool_required: 'it_hacha' },
    { id: 'rn_arroyo', spot_id: 'sp_cl_arroyo', name: 'el arroyo', aliases: ['arroyo', 'agua', 'truchas', 'peces', 'stream'], resource_item_id: 'it_pescado', yield_max: 4, regen_time_s: 24 * 3600, last_harvested_game_s: null, regen_state_at_harvest: 1, destructive: false, skill: 'survival', dc: 11, tool_required: null },
    { id: 'rn_bayas', spot_id: 'sp_cl_piedra', name: 'un arbusto de bayas', aliases: ['arbusto', 'bayas', 'zarzas', 'bush'], resource_item_id: 'it_bayas', yield_max: 5, regen_time_s: 24 * 3600, last_harvested_game_s: null, regen_state_at_harvest: 1, destructive: false, skill: 'survival', dc: 8, tool_required: null },
  ],
};

function sp(id: string, location_id: string, name: string, aliases: string[], description: string, x: number, y: number) {
  return {
    id, location_id, name, aliases, description, x, y,
    capacity: null, hidden: false, discovered_by: [] as string[], state: {}, tags: [] as string[],
    terrain_multiplier: 1, entry_cost_s: 0, links: [] as { to_spot_id: string; blocks_sight?: boolean; muffles?: number }[],
  };
}

function ch(id: string, user_id: string, name: string, spot: string, abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number }, passive: number) {
  return {
    id, user_id, name,
    race: 'humano', class_name: 'guerrero', race_id: 'human', class_id: 'fighter', background_id: 'soldier', hit_die: 10, death_mode: 'casual' as const, level: 1, appearance: '', backstory: '',
    hp_max: 12, hp_current: 12, hp_temp: 0, conditions: [] as { name: string; source: string; expires_game_s: number | null }[],
    proficiencies: { skills: ['athletics', 'perception'], expert: [] as string[], saves: ['str', 'con'] },
    practice: {} as Record<string, number>, practice_bonus: {} as Record<string, number>, reputation: {} as Record<string, number>,
    knows: ['ch_kael', 'ch_mira', 'npc_brenna', 'npc_doro'] as string[],
    decisive: null as null, xp: 0,
    clues: [] as string[], completed_jobs: [] as string[], achievements: [] as { id: string; game_s: number }[],
    location: { type: 'spot' as const, id: spot },
    transit: null, status: 'active' as const, speed_ft: 30, abilities, passive_perception: passive,
    darkvision: false, condition_speed_factor: 1, coins: 1500, last_seen_event_id: null, recap_from: null, connected: true, veiled: false,
  };
}
