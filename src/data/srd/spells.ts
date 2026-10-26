/**
 * Conjuros SRD 5.1 de nivel 0 (trucos) a 3: lo que lanza un PJ hasta nivel 5–6.
 * Una selección amplia, no el SRD entero: cada clase lanzadora tiene trucos y
 * conjuros de sobra para elegir en cada nivel. Nombres en castellano con el
 * inglés al lado (el máster y el índice de reglas lo buscan así); el texto es
 * un resumen de una línea, no el del manual.
 *
 * `dice`: lo que tira el servidor al lanzarlo (cast_spell). `upcast`, los dados
 * que suma por cada nivel de espacio por encima del suyo; los trucos escalan
 * solos con el nivel del PJ (×2 a nivel 5, ×3 a 11, ×4 a 17).
 */

import type { Ability } from '../../engine/rules.js';

export type SpellClass = 'bard' | 'cleric' | 'druid' | 'paladin' | 'ranger' | 'sorcerer' | 'warlock' | 'wizard';

export interface SpellDef {
  id: string;
  name: string;
  /** Nombre SRD en inglés. */
  en: string;
  /** 0 = truco. */
  level: number;
  school: string;
  classes: SpellClass[];
  /** «acción», «acción adicional», «reacción», «1 minuto». */
  time: string;
  /** «36 m», «toque», «personal». */
  range: string;
  text: string;
  concentration?: boolean;
  ritual?: boolean;
  /** Ataque de conjuro (cuerpo a cuerpo o a distancia). */
  attack?: 'melee' | 'ranged';
  /** Salvación que pide al objetivo, contra la CD del lanzador. */
  save?: Ability;
  dice?: { expr: string; kind: 'damage' | 'heal' | 'temp_hp' | 'pool'; type?: string; upcast?: string; add_mod?: boolean };
}

const CODES: Record<string, SpellClass> = { B: 'bard', C: 'cleric', D: 'druid', P: 'paladin', R: 'ranger', S: 'sorcerer', K: 'warlock', W: 'wizard' };

/** Fila compacta: id, nombre, inglés, nivel, escuela, clases («B C W»), tiempo, alcance, texto y extras. */
function sp(id: string, name: string, en: string, level: number, school: string, classes: string, time: string, range: string, text: string, extra: Partial<SpellDef> = {}): SpellDef {
  return { id, name, en, level, school, classes: classes.split(' ').map((k) => CODES[k]!), time, range, text, ...extra };
}

const A = 'acción';
const BA = 'acción adicional';
const R = 'reacción';

export const SPELLS: SpellDef[] = [
  // --- Trucos ---
  sp('acid_splash', 'Salpicadura de ácido', 'Acid Splash', 0, 'conjuración', 'S W', A, '18 m', 'Una burbuja de ácido a una o dos criaturas juntas: salvación de DES o 1d6 de ácido.', { save: 'dex', dice: { expr: '1d6', kind: 'damage', type: 'acid' } }),
  sp('chill_touch', 'Toque helado', 'Chill Touch', 0, 'nigromancia', 'S K W', A, '36 m', 'Mano espectral: ataque a distancia, 1d8 necrótico y no puede recuperar PG hasta tu próximo turno.', { attack: 'ranged', dice: { expr: '1d8', kind: 'damage', type: 'necrotic' } }),
  sp('dancing_lights', 'Luces danzantes', 'Dancing Lights', 0, 'evocación', 'B S W', A, '36 m', 'Hasta cuatro luces como antorchas que mueves a voluntad durante un minuto.', { concentration: true }),
  sp('druidcraft', 'Saber druídico', 'Druidcraft', 0, 'transmutación', 'D', A, '9 m', 'Pequeños prodigios de la naturaleza: predecir el tiempo, hacer florecer una planta, encender o apagar una vela.'),
  sp('eldritch_blast', 'Descarga sobrenatural', 'Eldritch Blast', 0, 'evocación', 'K', A, '36 m', 'Un haz de energía crepitante: ataque a distancia, 1d10 de fuerza (más haces al subir de nivel).', { attack: 'ranged', dice: { expr: '1d10', kind: 'damage', type: 'force' } }),
  sp('fire_bolt', 'Descarga de fuego', 'Fire Bolt', 0, 'evocación', 'S W', A, '36 m', 'Una mota de fuego: ataque a distancia, 1d10 de fuego; prende lo inflamable que no lleve nadie.', { attack: 'ranged', dice: { expr: '1d10', kind: 'damage', type: 'fire' } }),
  sp('guidance', 'Orientación divina', 'Guidance', 0, 'adivinación', 'C D', A, 'toque', 'Un aliado suma 1d4 a una prueba de característica antes de un minuto.', { concentration: true }),
  sp('light', 'Luz', 'Light', 0, 'evocación', 'B C S W', A, 'toque', 'Un objeto brilla como una antorcha durante una hora.'),
  sp('mage_hand', 'Mano de mago', 'Mage Hand', 0, 'conjuración', 'B S K W', A, '9 m', 'Una mano espectral que abre, coge o lleva hasta 5 kg a distancia durante un minuto.'),
  sp('mending', 'Reparar', 'Mending', 0, 'transmutación', 'B C D S W', '1 minuto', 'toque', 'Arregla una rotura pequeña: un eslabón, una costura, una llave partida.'),
  sp('message', 'Mensaje', 'Message', 0, 'transmutación', 'B S W', A, '36 m', 'Susurras un mensaje a alguien que ves y solo él lo oye; puede contestarte igual.'),
  sp('minor_illusion', 'Ilusión menor', 'Minor Illusion', 0, 'ilusión', 'B S K W', A, '9 m', 'Un sonido o una imagen quieta del tamaño de un cubo de metro y medio, durante un minuto.'),
  sp('poison_spray', 'Rociada venenosa', 'Poison Spray', 0, 'conjuración', 'D S K W', A, '3 m', 'Una nube de gas tóxico: salvación de CON o 1d12 de veneno.', { save: 'con', dice: { expr: '1d12', kind: 'damage', type: 'poison' } }),
  sp('prestidigitation', 'Prestidigitación', 'Prestidigitation', 0, 'transmutación', 'B S K W', A, '3 m', 'Trucos menores: limpiar, calentar, dar sabor, encender una vela, una marca que dura una hora.'),
  sp('produce_flame', 'Crear llama', 'Produce Flame', 0, 'conjuración', 'D', A, 'personal', 'Una llama en la palma que alumbra; puedes lanzarla: ataque a distancia, 1d8 de fuego.', { attack: 'ranged', dice: { expr: '1d8', kind: 'damage', type: 'fire' } }),
  sp('ray_of_frost', 'Rayo de escarcha', 'Ray of Frost', 0, 'evocación', 'S W', A, '18 m', 'Un rayo helado: ataque a distancia, 1d8 de frío y su velocidad baja 3 m.', { attack: 'ranged', dice: { expr: '1d8', kind: 'damage', type: 'cold' } }),
  sp('resistance', 'Resistencia', 'Resistance', 0, 'abjuración', 'C D', A, 'toque', 'Un aliado suma 1d4 a una tirada de salvación antes de un minuto.', { concentration: true }),
  sp('sacred_flame', 'Llama sagrada', 'Sacred Flame', 0, 'evocación', 'C', A, '18 m', 'Fuego radiante cae sobre una criatura: salvación de DES (sin cobertura) o 1d8 radiante.', { save: 'dex', dice: { expr: '1d8', kind: 'damage', type: 'radiant' } }),
  sp('shillelagh', 'Garrote', 'Shillelagh', 0, 'transmutación', 'D', BA, 'toque', 'Tu bastón o garrote golpea con SAB y hace 1d8 durante un minuto.'),
  sp('shocking_grasp', 'Agarre electrizante', 'Shocking Grasp', 0, 'evocación', 'S W', A, 'toque', 'Ataque cuerpo a cuerpo con ventaja contra armadura de metal: 1d8 de rayo y no puede usar reacciones.', { attack: 'melee', dice: { expr: '1d8', kind: 'damage', type: 'lightning' } }),
  sp('spare_the_dying', 'Piedad con los moribundos', 'Spare the Dying', 0, 'nigromancia', 'C', A, 'toque', 'Estabiliza a una criatura viva a 0 PG.'),
  sp('thaumaturgy', 'Taumaturgia', 'Thaumaturgy', 0, 'transmutación', 'C', A, '9 m', 'Un prodigio menor: voz atronadora, llamas que parpadean, temblores, puertas que se abren de golpe.'),
  sp('true_strike', 'Impacto certero', 'True Strike', 0, 'adivinación', 'B S K W', A, '9 m', 'Lees la defensa de un objetivo: ventaja en tu primer ataque contra él en tu próximo turno.', { concentration: true }),
  sp('vicious_mockery', 'Burla cruel', 'Vicious Mockery', 0, 'encantamiento', 'B', A, '18 m', 'Insultos con magia: salvación de SAB o 1d4 psíquico y desventaja en su próximo ataque.', { save: 'wis', dice: { expr: '1d4', kind: 'damage', type: 'psychic' } }),

  // --- Nivel 1 ---
  sp('alarm', 'Alarma', 'Alarm', 1, 'abjuración', 'R W', '1 minuto', '9 m', 'Una alarma mental o sonora avisa si alguien entra en una zona durante 8 horas.', { ritual: true }),
  sp('bless', 'Bendecir', 'Bless', 1, 'encantamiento', 'C P', A, '9 m', 'Hasta tres criaturas suman 1d4 a sus ataques y salvaciones durante un minuto.', { concentration: true }),
  sp('burning_hands', 'Manos ardientes', 'Burning Hands', 1, 'evocación', 'S W', A, 'cono de 4,5 m', 'Un abanico de llamas: salvación de DES o 3d6 de fuego (la mitad si la supera).', { save: 'dex', dice: { expr: '3d6', kind: 'damage', type: 'fire', upcast: '1d6' } }),
  sp('charm_person', 'Hechizar persona', 'Charm Person', 1, 'encantamiento', 'B D S K W', A, '9 m', 'Salvación de SAB o te ve como un amigo durante una hora; luego sabe que lo hechizaste.', { save: 'wis' }),
  sp('command', 'Orden imperiosa', 'Command', 1, 'encantamiento', 'C P', A, '18 m', 'Una palabra (¡huye!, ¡suelta!, ¡al suelo!): salvación de SAB o la obedece en su turno.', { save: 'wis' }),
  sp('comprehend_languages', 'Comprensión idiomática', 'Comprehend Languages', 1, 'adivinación', 'B S K W', A, 'personal', 'Entiendes cualquier idioma hablado o escrito durante una hora.', { ritual: true }),
  sp('cure_wounds', 'Curar heridas', 'Cure Wounds', 1, 'evocación', 'B C D P R', A, 'toque', 'Una criatura recupera 1d8 + tu modificador PG.', { dice: { expr: '1d8', kind: 'heal', upcast: '1d8', add_mod: true } }),
  sp('detect_magic', 'Detectar magia', 'Detect Magic', 1, 'adivinación', 'B C D P R S W', A, 'personal', 'Notas la magia a 9 m durante diez minutos y ves su aura y su escuela.', { concentration: true, ritual: true }),
  sp('disguise_self', 'Disfrazarse', 'Disguise Self', 1, 'ilusión', 'B S W', A, 'personal', 'Cambias de aspecto (ropa, cara, altura) durante una hora.'),
  sp('divine_favor', 'Favor divino', 'Divine Favor', 1, 'evocación', 'P', BA, 'personal', 'Tus ataques con arma hacen 1d4 radiante más durante un minuto.', { concentration: true }),
  sp('entangle', 'Enmarañar', 'Entangle', 1, 'conjuración', 'D', A, '27 m', 'Plantas que atrapan en un cuadrado de 6 m: salvación de FUE o queda apresado.', { concentration: true, save: 'str' }),
  sp('expeditious_retreat', 'Retirada expeditiva', 'Expeditious Retreat', 1, 'transmutación', 'S K W', BA, 'personal', 'Puedes correr (Dash) como acción adicional durante diez minutos.', { concentration: true }),
  sp('faerie_fire', 'Fuego feérico', 'Faerie Fire', 1, 'evocación', 'B D', A, '18 m', 'Silueta de luz en un cubo de 6 m: salvación de DES o los ataques contra ellos tienen ventaja.', { concentration: true, save: 'dex' }),
  sp('false_life', 'Falsa vida', 'False Life', 1, 'nigromancia', 'S W', A, 'personal', 'Ganas 1d4 + 4 PG temporales durante una hora.', { dice: { expr: '1d4+4', kind: 'temp_hp', upcast: '5' } }),
  sp('feather_fall', 'Caída de pluma', 'Feather Fall', 1, 'transmutación', 'B S W', R, '18 m', 'Hasta cinco criaturas que caen bajan despacio y no se hacen daño.'),
  sp('find_familiar', 'Encontrar familiar', 'Find Familiar', 1, 'conjuración', 'W', '1 hora', '3 m', 'Un espíritu con forma de animal pequeño te sirve, ve por ti y entrega tus conjuros de toque.', { ritual: true }),
  sp('fog_cloud', 'Nube de oscurecimiento', 'Fog Cloud', 1, 'conjuración', 'D R S W', A, '36 m', 'Una esfera de niebla de 6 m de radio que tapa la vista durante una hora.', { concentration: true }),
  sp('goodberry', 'Bayas nutritivas', 'Goodberry', 1, 'transmutación', 'D R', A, 'toque', 'Diez bayas: cada una cura 1 PG y alimenta un día entero.'),
  sp('guiding_bolt', 'Saeta guía', 'Guiding Bolt', 1, 'evocación', 'C', A, '36 m', 'Un rayo de luz: ataque a distancia, 4d6 radiante y el siguiente ataque contra él tiene ventaja.', { attack: 'ranged', dice: { expr: '4d6', kind: 'damage', type: 'radiant', upcast: '1d6' } }),
  sp('healing_word', 'Palabra de curación', 'Healing Word', 1, 'evocación', 'B C D', BA, '18 m', 'Una criatura que ves recupera 1d4 + tu modificador PG.', { dice: { expr: '1d4', kind: 'heal', upcast: '1d4', add_mod: true } }),
  sp('hellish_rebuke', 'Represión infernal', 'Hellish Rebuke', 1, 'evocación', 'K', R, '18 m', 'Cuando te hieren: llamas sobre quien fue, salvación de DES o 2d10 de fuego.', { save: 'dex', dice: { expr: '2d10', kind: 'damage', type: 'fire', upcast: '1d10' } }),
  sp('heroism', 'Heroísmo', 'Heroism', 1, 'encantamiento', 'B P', A, 'toque', 'Inmune a asustado y gana tu modificador en PG temporales cada turno durante un minuto.', { concentration: true }),
  sp('hex', 'Maleficio', 'Hex', 1, 'encantamiento', 'K', BA, '27 m', 'Maldices a una criatura: tus ataques le hacen 1d6 necrótico más y falla más en una característica.', { concentration: true }),
  sp('hunters_mark', 'Marca del cazador', 'Hunter\'s Mark', 1, 'adivinación', 'R', BA, '27 m', 'Marcas una presa: tus ataques le hacen 1d6 más y tienes ventaja para rastrearla.', { concentration: true }),
  sp('identify', 'Identificar', 'Identify', 1, 'adivinación', 'B W', '1 minuto', 'toque', 'Sabes qué hace un objeto mágico y cómo se usa.', { ritual: true }),
  sp('inflict_wounds', 'Infligir heridas', 'Inflict Wounds', 1, 'nigromancia', 'C', A, 'toque', 'Ataque cuerpo a cuerpo: 3d10 necrótico.', { attack: 'melee', dice: { expr: '3d10', kind: 'damage', type: 'necrotic', upcast: '1d10' } }),
  sp('jump', 'Salto', 'Jump', 1, 'transmutación', 'D R S W', A, 'toque', 'Una criatura salta el triple de lejos durante un minuto.'),
  sp('longstrider', 'Zancada prodigiosa', 'Longstrider', 1, 'transmutación', 'B D R W', A, 'toque', 'Una criatura gana 3 m de velocidad durante una hora.'),
  sp('mage_armor', 'Armadura de mago', 'Mage Armor', 1, 'abjuración', 'S W', A, 'toque', 'Sin armadura, su CA pasa a 13 + DES durante ocho horas.'),
  sp('magic_missile', 'Proyectil mágico', 'Magic Missile', 1, 'evocación', 'S W', A, '36 m', 'Tres dardos que no fallan: 1d4 + 1 de fuerza cada uno (un dardo más por nivel de espacio).', { dice: { expr: '3d4+3', kind: 'damage', type: 'force', upcast: '1d4+1' } }),
  sp('protection_from_evil_and_good', 'Protección contra el bien y el mal', 'Protection from Evil and Good', 1, 'abjuración', 'C P K W', A, 'toque', 'Aberraciones, celestiales, elementales, feéricos, infernales y muertos vivientes atacan con desventaja.', { concentration: true }),
  sp('sanctuary', 'Santuario', 'Sanctuary', 1, 'abjuración', 'C', BA, '9 m', 'Quien quiera atacar al protegido debe superar una salvación de SAB o elegir otro objetivo.', { save: 'wis' }),
  sp('shield', 'Escudo', 'Shield', 1, 'abjuración', 'S W', R, 'personal', 'Cuando te van a dar: +5 a la CA hasta tu próximo turno y Proyectil mágico no te alcanza.'),
  sp('shield_of_faith', 'Escudo de fe', 'Shield of Faith', 1, 'abjuración', 'C P', BA, '18 m', 'Una criatura gana +2 a la CA durante diez minutos.', { concentration: true }),
  sp('sleep', 'Dormir', 'Sleep', 1, 'encantamiento', 'B S W', A, '27 m', 'Duermes 5d8 PG de criaturas, de la más débil a la más fuerte, durante un minuto.', { dice: { expr: '5d8', kind: 'pool', type: 'PG de criaturas que duerme', upcast: '2d8' } }),
  sp('speak_with_animals', 'Hablar con los animales', 'Speak with Animals', 1, 'adivinación', 'B D R', A, 'personal', 'Entiendes a los animales y ellos a ti durante diez minutos.', { ritual: true }),
  sp('thunderwave', 'Onda atronadora', 'Thunderwave', 1, 'evocación', 'B D S W', A, 'cubo de 4,5 m', 'Una onda de trueno: salvación de CON o 2d8 de trueno y sale despedido 3 m.', { save: 'con', dice: { expr: '2d8', kind: 'damage', type: 'thunder', upcast: '1d8' } }),
  sp('unseen_servant', 'Sirviente invisible', 'Unseen Servant', 1, 'conjuración', 'B K W', A, '18 m', 'Una fuerza invisible hace recados sencillos durante una hora.', { ritual: true }),

  // --- Nivel 2 ---
  sp('aid', 'Auxilio', 'Aid', 2, 'abjuración', 'C P', A, '9 m', 'Hasta tres criaturas ganan 5 PG máximos y actuales durante ocho horas.'),
  sp('blur', 'Desenfoque', 'Blur', 2, 'ilusión', 'S W', A, 'personal', 'Tu silueta tiembla: los ataques contra ti tienen desventaja durante un minuto.', { concentration: true }),
  sp('darkness', 'Oscuridad', 'Darkness', 2, 'evocación', 'S K W', A, '18 m', 'Oscuridad mágica en una esfera de 4,5 m durante diez minutos.', { concentration: true }),
  sp('darkvision', 'Visión en la oscuridad', 'Darkvision', 2, 'transmutación', 'D R S W', A, 'toque', 'Una criatura ve en la oscuridad a 18 m durante ocho horas.'),
  sp('enhance_ability', 'Potenciar característica', 'Enhance Ability', 2, 'transmutación', 'B C D S', A, 'toque', 'Ventaja en las pruebas de una característica (y otro beneficio) durante una hora.', { concentration: true }),
  sp('flaming_sphere', 'Esfera llameante', 'Flaming Sphere', 2, 'conjuración', 'D W', A, '18 m', 'Una bola de fuego que mueves: salvación de DES o 2d6 de fuego a quien toque.', { concentration: true, save: 'dex', dice: { expr: '2d6', kind: 'damage', type: 'fire', upcast: '1d6' } }),
  sp('heat_metal', 'Calentar metal', 'Heat Metal', 2, 'transmutación', 'B D', A, '18 m', 'Un objeto de metal arde: 2d8 de fuego a quien lo lleve o lo toque.', { concentration: true, dice: { expr: '2d8', kind: 'damage', type: 'fire', upcast: '1d8' } }),
  sp('hold_person', 'Inmovilizar persona', 'Hold Person', 2, 'encantamiento', 'B C D S K W', A, '18 m', 'Un humanoide: salvación de SAB o queda paralizado (repite la salvación cada turno).', { concentration: true, save: 'wis' }),
  sp('invisibility', 'Invisibilidad', 'Invisibility', 2, 'ilusión', 'B S K W', A, 'toque', 'Una criatura es invisible durante una hora o hasta que ataque o lance un conjuro.', { concentration: true }),
  sp('knock', 'Apertura', 'Knock', 2, 'transmutación', 'B S W', A, '18 m', 'Abre una cerradura, cerrojo o candado; se oye un golpe fuerte.'),
  sp('lesser_restoration', 'Restablecimiento menor', 'Lesser Restoration', 2, 'abjuración', 'B C D P R', A, 'toque', 'Quita una enfermedad o una condición: cegado, ensordecido, paralizado o envenenado.'),
  sp('locate_object', 'Localizar objeto', 'Locate Object', 2, 'adivinación', 'B C D P R W', A, 'personal', 'Sientes hacia dónde está un objeto conocido a menos de 300 m durante diez minutos.', { concentration: true }),
  sp('misty_step', 'Paso brumoso', 'Misty Step', 2, 'conjuración', 'S K W', BA, 'personal', 'Te teletransportas hasta 9 m a un sitio que ves.'),
  sp('moonbeam', 'Rayo de luna', 'Moonbeam', 2, 'evocación', 'D', A, '36 m', 'Un haz de luz plateada que mueves: salvación de CON o 2d10 radiante.', { concentration: true, save: 'con', dice: { expr: '2d10', kind: 'damage', type: 'radiant', upcast: '1d10' } }),
  sp('pass_without_trace', 'Pasar sin dejar rastro', 'Pass without Trace', 2, 'abjuración', 'D R', A, 'personal', 'Tú y los que van contigo sumáis +10 a Sigilo y no dejáis huellas durante una hora.', { concentration: true }),
  sp('prayer_of_healing', 'Plegaria de curación', 'Prayer of Healing', 2, 'evocación', 'C', '10 minutos', '9 m', 'Hasta seis criaturas recuperan 2d8 + tu modificador PG cada una.', { dice: { expr: '2d8', kind: 'heal', upcast: '1d8', add_mod: true } }),
  sp('scorching_ray', 'Rayo abrasador', 'Scorching Ray', 2, 'evocación', 'S W', A, '36 m', 'Tres rayos de fuego: un ataque a distancia por rayo, 2d6 de fuego cada uno.', { attack: 'ranged', dice: { expr: '2d6', kind: 'damage', type: 'fire' } }),
  sp('see_invisibility', 'Ver lo invisible', 'See Invisibility', 2, 'adivinación', 'B S W', A, 'personal', 'Ves lo invisible y lo etéreo durante una hora.'),
  sp('shatter', 'Estallar', 'Shatter', 2, 'evocación', 'B S K W', A, '18 m', 'Un estruendo en una esfera de 3 m: salvación de CON o 3d8 de trueno.', { save: 'con', dice: { expr: '3d8', kind: 'damage', type: 'thunder', upcast: '1d8' } }),
  sp('silence', 'Silencio', 'Silence', 2, 'ilusión', 'B C R', A, '36 m', 'Ningún sonido en una esfera de 6 m durante diez minutos: dentro no se lanzan conjuros con palabras.', { concentration: true, ritual: true }),
  sp('spider_climb', 'Trepar cual arácnido', 'Spider Climb', 2, 'transmutación', 'S K W', A, 'toque', 'Una criatura trepa por paredes y techos con las manos libres durante una hora.', { concentration: true }),
  sp('spiritual_weapon', 'Arma espiritual', 'Spiritual Weapon', 2, 'evocación', 'C', BA, '18 m', 'Un arma flotante: ataque cuerpo a cuerpo de conjuro, 1d8 + tu modificador de fuerza; repite con acción adicional.', { attack: 'melee', dice: { expr: '1d8', kind: 'damage', type: 'force', add_mod: true } }),
  sp('suggestion', 'Sugestión', 'Suggestion', 2, 'encantamiento', 'B S K W', A, '9 m', 'Sugieres algo razonable: salvación de SAB o lo hace durante hasta ocho horas.', { concentration: true, save: 'wis' }),
  sp('web', 'Telaraña', 'Web', 2, 'conjuración', 'S W', A, '18 m', 'Telarañas en un cubo de 6 m: salvación de DES o queda apresado.', { concentration: true, save: 'dex' }),
  sp('zone_of_truth', 'Zona de verdad', 'Zone of Truth', 2, 'encantamiento', 'B C P', A, '18 m', 'En una esfera de 4,5 m, quien falle la salvación de CAR no puede mentir a sabiendas.', { save: 'cha' }),

  // --- Nivel 3 ---
  sp('beacon_of_hope', 'Faro de esperanza', 'Beacon of Hope', 3, 'abjuración', 'C', A, '9 m', 'Tus aliados tienen ventaja en salvaciones de SAB y contra muerte y curan al máximo.', { concentration: true }),
  sp('bestow_curse', 'Imponer maldición', 'Bestow Curse', 3, 'nigromancia', 'B C W', A, 'toque', 'Salvación de SAB o una maldición: desventaja, daño extra o pierde turnos.', { concentration: true, save: 'wis' }),
  sp('call_lightning', 'Llamar al relámpago', 'Call Lightning', 3, 'conjuración', 'D', A, '36 m', 'Una nube de tormenta: cada turno un rayo, salvación de DES o 3d10 de rayo.', { concentration: true, save: 'dex', dice: { expr: '3d10', kind: 'damage', type: 'lightning', upcast: '1d10' } }),
  sp('clairvoyance', 'Clarividencia', 'Clairvoyance', 3, 'adivinación', 'B C S W', '10 minutos', '1,5 km', 'Un ojo o un oído invisible en un sitio que conoces durante diez minutos.', { concentration: true }),
  sp('conjure_animals', 'Conjurar animales', 'Conjure Animals', 3, 'conjuración', 'D R', A, '18 m', 'Espíritus con forma de animal luchan a tu lado durante una hora.', { concentration: true }),
  sp('counterspell', 'Contraconjuro', 'Counterspell', 3, 'abjuración', 'S K W', R, '18 m', 'Cortas un conjuro mientras lo lanzan; si es de nivel 4 o más, prueba de tu característica.'),
  sp('crusaders_mantle', 'Manto del cruzado', 'Crusader\'s Mantle', 3, 'evocación', 'P', A, 'personal', 'Tus aliados a 9 m hacen 1d4 radiante más con sus armas durante un minuto.', { concentration: true }),
  sp('daylight', 'Luz del día', 'Daylight', 3, 'evocación', 'C D P R S', A, '18 m', 'Luz del día en una esfera de 18 m durante una hora; disipa la oscuridad mágica menor.'),
  sp('dispel_magic', 'Disipar magia', 'Dispel Magic', 3, 'abjuración', 'B C D P S K W', A, '36 m', 'Acaba con los conjuros de nivel 3 o menos sobre un objetivo; los más altos, con prueba.'),
  sp('fireball', 'Bola de fuego', 'Fireball', 3, 'evocación', 'S W', A, '45 m', 'Estalla en una esfera de 6 m: salvación de DES o 8d6 de fuego (la mitad si la supera).', { save: 'dex', dice: { expr: '8d6', kind: 'damage', type: 'fire', upcast: '1d6' } }),
  sp('fly', 'Volar', 'Fly', 3, 'transmutación', 'S K W', A, 'toque', 'Una criatura vuela a 18 m por turno durante diez minutos.', { concentration: true }),
  sp('haste', 'Acelerar', 'Haste', 3, 'transmutación', 'S W', A, '9 m', 'Velocidad doble, +2 CA, ventaja en DES y una acción más; al acabar, un turno aturdido.', { concentration: true }),
  sp('hypnotic_pattern', 'Patrón hipnótico', 'Hypnotic Pattern', 3, 'ilusión', 'B S K W', A, '36 m', 'Colores en un cubo de 9 m: salvación de SAB o queda hechizado e incapacitado.', { concentration: true, save: 'wis' }),
  sp('lightning_bolt', 'Relámpago', 'Lightning Bolt', 3, 'evocación', 'S W', A, 'línea de 30 m', 'Un rayo en línea: salvación de DES o 8d6 de rayo (la mitad si la supera).', { save: 'dex', dice: { expr: '8d6', kind: 'damage', type: 'lightning', upcast: '1d6' } }),
  sp('mass_healing_word', 'Palabra de curación en masa', 'Mass Healing Word', 3, 'evocación', 'C', BA, '18 m', 'Hasta seis criaturas recuperan 1d4 + tu modificador PG cada una.', { dice: { expr: '1d4', kind: 'heal', upcast: '1d4', add_mod: true } }),
  sp('plant_growth', 'Crecimiento vegetal', 'Plant Growth', 3, 'transmutación', 'B D R', A, '45 m', 'La maleza se espesa en un radio de 30 m: moverse cuesta el cuádruple.'),
  sp('protection_from_energy', 'Protección contra energía', 'Protection from Energy', 3, 'abjuración', 'C D R S W', A, 'toque', 'Resistencia a ácido, frío, fuego, rayo o trueno durante una hora.', { concentration: true }),
  sp('remove_curse', 'Levantar maldición', 'Remove Curse', 3, 'abjuración', 'C P K W', A, 'toque', 'Acaba con las maldiciones que afectan a una criatura o a un objeto.'),
  sp('revivify', 'Revivir', 'Revivify', 3, 'nigromancia', 'C P', A, 'toque', 'Devuelve a la vida con 1 PG a quien murió hace menos de un minuto (gasta un diamante de 300 mo).'),
  sp('sleet_storm', 'Tormenta de aguanieve', 'Sleet Storm', 3, 'conjuración', 'D S W', A, '45 m', 'Aguanieve en un cilindro de 12 m: terreno difícil, resbala y apaga llamas.', { concentration: true }),
  sp('speak_with_dead', 'Hablar con los muertos', 'Speak with Dead', 3, 'nigromancia', 'B C', A, '3 m', 'Un cadáver contesta cinco preguntas con lo que sabía en vida.'),
  sp('spirit_guardians', 'Espíritus guardianes', 'Spirit Guardians', 3, 'conjuración', 'C', A, 'personal', 'Espíritus a 4,5 m de ti: los enemigos van a mitad de velocidad y salvación de SAB o 3d8 radiante.', { concentration: true, save: 'wis', dice: { expr: '3d8', kind: 'damage', type: 'radiant', upcast: '1d8' } }),
  sp('stinking_cloud', 'Nube apestosa', 'Stinking Cloud', 3, 'conjuración', 'B S W', A, '27 m', 'Gas nauseabundo en una esfera de 6 m: salvación de CON o pierde su acción.', { concentration: true, save: 'con' }),
  sp('tongues', 'Don de lenguas', 'Tongues', 3, 'adivinación', 'B C S K W', A, 'toque', 'Una criatura entiende y habla cualquier idioma durante una hora.'),
  sp('vampiric_touch', 'Toque vampírico', 'Vampiric Touch', 3, 'nigromancia', 'K W', A, 'personal', 'Ataque cuerpo a cuerpo de conjuro: 3d6 necrótico y recuperas la mitad; repite cada turno.', { concentration: true, attack: 'melee', dice: { expr: '3d6', kind: 'damage', type: 'necrotic', upcast: '1d6' } }),
  sp('water_breathing', 'Respirar bajo el agua', 'Water Breathing', 3, 'transmutación', 'D R S W', A, '9 m', 'Hasta diez criaturas respiran bajo el agua durante 24 horas.', { ritual: true }),
];

const BY_ID = new Map(SPELLS.map((s) => [s.id, s]));

export function spellById(id: string): SpellDef | undefined { return BY_ID.get(id); }

/** Conjuro por id, nombre castellano o inglés, sin tildes ni mayúsculas. */
export function spellNamed(text: string): SpellDef | undefined {
  const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const t = plain(text);
  return BY_ID.get(text.trim()) ?? SPELLS.find((s) => plain(s.name) === t || plain(s.en) === t || plain(s.id) === t);
}

/** Conjuros de una clase hasta un nivel de conjuro (incluido), trucos aparte. */
export function classSpells(cls: SpellClass, maxLevel: number, cantrips = false): SpellDef[] {
  return SPELLS.filter((s) => s.classes.includes(cls) && (cantrips ? s.level === 0 : s.level >= 1 && s.level <= maxLevel));
}
