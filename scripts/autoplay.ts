/**
 * Partidas automáticas para recoger errores del máster: un jugador automático (un modelo barato)
 * juega N acciones en mundos generados y luego el juez (scripts/judge.ts) lee los logs.
 *
 *   npm run autoplay -- --dry-run                          clientes falsos para todo, no llama a la API
 *   npm run autoplay -- --games 3 --actions 10             solo imprime la estimación de coste
 *   npm run autoplay -- --games 3 --actions 10 --live      partidas reales (gasta dinero)
 *
 * Modelos: MASTER_MODEL (máster), PLAYER_MODEL (jugador), WORLDGEN_MODEL (mundo) y JUDGE_MODEL (juez);
 * por defecto los cuatro claude-haiku-5-5. Cada partida queda en <games-dir>/auto-<fecha>-<n> (una
 * partida normal del gestor, se puede abrir en la web) y el resumen con tokens y coste en
 * data/local/autoplay/<fecha>/summary.json; el informe del juez, en el mismo sitio (report.md).
 *
 * Partidas completas en Brezal, una por perfil de jugador (PROFILES), hasta un final, un atasco o el tope:
 *   npm run autoplay -- --profiles all --actions 300 --parallel 10 --max-usd-game 1.2 --live
 * Luego scripts/playtest-report.ts analiza conversaciones, misiones, combate, final y fluidez.
 * Para probar los finales sin jugar los actos anteriores, --start-act 2|3 los deja hechos por tools y sin máster:
 *   npm run autoplay -- --profiles dirigido-templar,dirigido-verdad,dirigido-arder --start-act 3 --actions 60 --parallel 3 --no-judge --live
 * Partidas a dos (PAIRS): dos jugadores automáticos juntos en la misma partida, que a veces actúan a la vez (ventana de
 * turno, rondas de pelea), se hablan por el chat y en la escena, se dan cosas, se roban y contestan a las reacciones del otro.
 * Un resumen por jugador (mismo slug); --actions cuenta por jugador:
 *   npm run autoplay -- --pairs all --actions 100 --parallel 5 --live
 *   npm run autoplay -- --pairs picaro:novato,violento:pausado --actions 60 --live
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type Anthropic from '@anthropic-ai/sdk';
import type { ActionResult, Engine } from '../src/engine/engine.js';
import type { Character, GameEvent, Offer, Reaction } from '../src/engine/model.js';
import { readerText } from '../src/engine/events.js';
import { journalOf } from '../src/engine/journal.js';
import { choiceOptions, pendingChoices, spellGroups } from '../src/engine/levels.js';
import { coinsOf, money } from '../src/engine/money.js';
import { resourceLines } from '../src/engine/rest.js';
import { characterStory, questsOf, questStatus, storyOf } from '../src/engine/story.js';
import { seededRng, type Rng } from '../src/engine/dice.js';
import { GameManager } from '../src/games/manager.js';
import { liveClient, Master, type MasterClient } from '../src/ai/master.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { offlineClient } from '../src/ai/offline.js';
import { generateSeed, situationText, TONES } from '../src/worldgen/index.js';
import { CLASSES, RACES } from '../src/data/srd/index.js';
import { BASELINE_CALL, costUsd, usd, type TokenUsage } from './bench-prices.js';
import { judgeRun } from './judge.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** master.ts escribe la caché con ttl 1h, que la API cobra al doble de la entrada. */
export const MASTER_CACHE_WRITE_MULT = 2;
/** Probabilidad de que el jugador elija una acción sugerida (si las hay); si no, escribe una propia. */
export const SUGGESTED_P = 0.6;
/** Segundos reales entre acciones: menos que la ventana decisiva (60 s), como un jugador que contesta. */
const STEP_REAL_S = 20;
const MAX_ROLLS_PER_ACTION = 2;
/** Tantas acciones seguidas sin ningún avance (misión, pista, PX o lugar) y la partida se da por atascada. */
export const STUCK_ACTIONS = 60;
/** Horas de juego tras las que Brezal lanza su epílogo (108), con margen. */
const EPILOGUE_H = 109;
/** A dos: ventana de turno (tiempo real) para que lo mandado a la vez entre en la misma llamada al máster. */
export const PAIR_WINDOW_MS = 2000;
/** A dos: lo que espera una ronda de pelea al que no ha actuado (los dos mandan a la vez: no debería agotarse). */
export const PAIR_ROUND_MS = 5000;
/** A dos: probabilidad de que los dos actúen a la vez estando en el mismo sitio (en pelea, siempre). */
export const TOGETHER_P = 0.3;
/** A dos: probabilidad de que una acción propia vaya dirigida al compañero (chat, hablarle, darle algo, robarle…). */
export const PAIR_WANT_P = 0.35;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/[\uD800-\uDBFF]$/, '')}…` : s);

/** Ganas de liarla: lo que el jugador intenta cuando escribe su propia acción. `dry` es lo que escribe el cliente falso. */
export const IMPULSES: { id: string; prompt: string; dry: string }[] = [
  { id: 'regatear', prompt: 'regatear el precio de algo con quien tengas delante', dry: 'Le digo que eso es un robo y le ofrezco la mitad.' },
  { id: 'mentir', prompt: 'mentir con descaro para sacar ventaja (fingir ser alguien, inventar una excusa)', dry: 'Le aseguro que vengo de parte del alcalde y que me debe un favor.' },
  { id: 'colarse', prompt: 'intentar colarte donde no deberías (una trastienda, un piso de arriba, una puerta cerrada)', dry: 'Me cuelo por la puerta de atrás cuando nadie mira.' },
  { id: 'fiado', prompt: 'pedir algo fiado, prometiendo pagar más tarde', dry: 'Le pido que me lo fíe y prometo pagarle mañana.' },
  { id: 'empenar', prompt: 'empeñar o dejar en prenda algo que lleves a cambio de algo', dry: 'Le dejo mi cuerda en prenda a cambio de una comida caliente.' },
  { id: 'amenazar', prompt: 'amenazar a alguien para conseguir lo que quieres', dry: 'Le agarro del cuello de la camisa y le digo que hable o lo lamentará.' },
  { id: 'inexistente', prompt: 'preguntar por algo que probablemente no existe aquí (un gremio de magos, un dragón dorado, un barco volador, la torre del archimago)', dry: 'Pregunto dónde está la torre del archimago y su biblioteca de pergaminos.' },
];

/** Cómo juega un jugador automático. `game_min`: minutos de juego que pasan entre acciones (el jugador no está siempre delante). */
export interface PlayerProfile {
  id: string;
  label: string;
  class_id: string;
  race_id: string;
  prompt: string;
  /** Probabilidad de elegir una acción sugerida; si no, escribe la suya según `wants`. */
  suggested_p: number;
  game_min: number;
  wants: { id: string; prompt: string; dry: string }[];
  /** Tras tantas negativas seguidas, deja a quien tiene delante y va a otra cosa de su Diario. */
  leaves_after_refusals?: number;
  /** Recorre sus `wants` en orden, uno por acción propia, en vez de al azar (perfiles mecánicos: cobertura, no carácter). */
  cycle?: boolean;
}

const want = (id: string, prompt: string, dry = 'Miro alrededor con calma.') => ({ id, prompt, dry });

const DIRECTED_PROMPT = 'Eres un jugador atento que quiere terminar la historia: haces lo que dice tu Diario, en orden, vas donde te manda y no te quedas discutiendo. Si alguien se niega a contarte algo dos veces, lo dejas y sigues por otro lado.';
const DIRECTED_WANTS = [want('objetivo', 'dar el siguiente paso de tu misión activa, tal como lo dice el Diario', 'Hago lo siguiente que dice mi Diario.'), want('encargo', 'preguntar a quien tengas delante si necesita algo o qué puede contarte de tu misión', '¿Necesitas ayuda con algo?'), want('entregar', 'volver a quien te encargó algo para entregarlo y cobrar', 'Vengo a contarte que está hecho.')];

/** Lo que puede pasar en una sesión normal y ningún perfil de carácter pide a propósito. Cada entrada es una tool o regla del motor. */
const MECHANICS_COMMON = [
  want('objeto', 'beber una poción, comer algo o usar un objeto concreto que lleves, diciendo cuál', 'Bebo una poción de curación.'),
  want('disparar', 'atacar a distancia a alguien o algo con un arma o un conjuro de los que tienes', 'Disparo a la diana con mi arco.'),
  want('esconderse', 'esconderte o moverte con sigilo para que no te vean', 'Me escondo tras el carro y avanzo con sigilo.'),
  want('forzar', 'forzar o abrir una puerta, un cofre o una cerradura que esté cerrada', 'Fuerzo la cerradura del cofre.'),
  want('saquear', 'registrar un cadáver, un cofre o un rincón y llevarte lo que haya', 'Registro el cofre y me llevo lo que hay.'),
  want('trepar', 'trepar, saltar o nadar por algún sitio difícil de la escena', 'Trepo por el muro hasta el tejado.'),
  want('descansar', 'descansar un rato o dormir para recuperarte', 'Me siento a descansar un rato.'),
  want('curar', 'curar o estabilizar a alguien herido, o a ti mismo', 'Vendo la herida de mi compañero.'),
  want('examinar', 'examinar de cerca un objeto raro o una marca para saber qué es', 'Examino el amuleto con detenimiento.'),
  want('cuerpo', 'atacar cuerpo a cuerpo a alguien hostil o a un blanco de práctica', 'Golpeo con mi arma.'),
];
const MECHANICS_CASTER = [
  want('conjuro', 'lanzar un conjuro de los que tienes en tu lista (di cuál) contra alguien o algo de la escena', 'Lanzo Proyectil mágico contra el espantapájaros.'),
  want('truco', 'lanzar un truco (cantrip) de tu lista, diciendo cuál', 'Lanzo Luz sobre mi bastón.'),
  want('recurso', 'usar un rasgo de tu clase que gaste usos (puntos de hechicería, furia, ki, inspiración…), diciendo cuál', 'Uso un punto de hechicería.'),
  ...MECHANICS_COMMON,
];
const MECHANICS_RANGER = [
  want('rastrear', 'buscar huellas o rastrear a alguien o a un animal', 'Busco huellas en el barro.'),
  want('recolectar', 'recolectar plantas, cazar algo o sacar agua o leña de la zona', 'Recojo hierbas junto al arroyo.'),
  want('montar', 'montar un caballo, una mula o un carro si hay alguno cerca, o preguntar por uno', 'Monto en la mula del establo.'),
  want('trampas', 'buscar trampas o algo escondido antes de pasar', 'Busco trampas en el umbral.'),
  want('recurso', 'usar un rasgo de tu clase que gaste usos, diciendo cuál', 'Uso mi Enemigo predilecto.'),
  ...MECHANICS_COMMON,
];

export const PROFILES: PlayerProfile[] = [
  { id: 'metodico', label: 'Metódico', class_id: 'cleric', race_id: 'human', suggested_p: 0.3, game_min: 15,
    prompt: 'Eres un jugador metódico: lees el Diario, sigues el objetivo de cada misión paso a paso, hablas con quien corresponde y no dejas nada a medias antes de empezar otra cosa.',
    wants: [want('objetivo', 'dar el siguiente paso de tu misión activa, tal como lo dice el Diario'), want('preguntar', 'preguntar a quien tengas delante lo que necesitas saber para tu misión'), want('entregar', 'volver a quien te encargó algo para contarle lo que has hecho')] },
  { id: 'impredecible', label: 'Impredecible', class_id: 'sorcerer', race_id: 'tiefling', suggested_p: 0.2, game_min: 15,
    prompt: 'Eres un jugador impredecible: cambias de idea, abandonas un hilo a la mitad, haces cosas raras pero posibles (cantar en la plaza, seguir a un desconocido, dar la vuelta sin motivo). No sigues el guion.',
    wants: [want('capricho', 'hacer algo raro pero posible que nadie espera en esta escena'), want('cambiar', 'dejar lo que estabas haciendo e irte a otro sitio o hablar con otra persona'), want('seguir', 'seguir a alguien o meterte en algo que no tiene que ver con tu misión')] },
  { id: 'pausado', label: 'Pausado', class_id: 'druid', race_id: 'elf', suggested_p: 0.4, game_min: 30,
    prompt: 'Eres un jugador pausado: observas, escuchas, te tomas tu tiempo, descansas, comes y miras cómo vive el pueblo. Cuando hablas lo haces sin prisa. No tienes ninguna urgencia.',
    wants: [want('observar', 'quedarte mirando con calma lo que pasa alrededor o a alguien concreto'), want('descansar', 'descansar, comer algo o esperar a que pase el rato en este sitio'), want('pasear', 'dar un paseo tranquilo hasta otro sitio cercano')] },
  { id: 'violento', label: 'Violento', class_id: 'barbarian', race_id: 'half-orc', suggested_p: 0.15, game_min: 10,
    prompt: 'Eres un jugador violento: resuelves casi todo a golpes. Amenazas, atacas a quien te estorba, entras en peleas y rematas. Si alguien te corta el paso, le pegas.',
    wants: [want('atacar', 'atacar con tu arma a alguien que tengas delante', 'Ataco con mi arma a quien tengo delante.'), want('amenazar', 'amenazar a alguien con hacerle daño para conseguir lo que quieres', 'Le agarro del cuello de la camisa y le digo que hable o lo lamentará.'), want('buscar', 'buscar a alguien que parezca peligroso o que tenga algo que quieras para pelear con él')] },
  { id: 'rapido', label: 'Rápido', class_id: 'monk', race_id: 'halfling', suggested_p: 0.5, game_min: 5,
    prompt: 'Eres un jugador con prisa: escribes como mucho tres o cuatro palabras, sin adornos («hablar con Ilse», «ir al molino», «atacar»). Saltas las charlas y vas a lo que te hace avanzar.',
    wants: [want('directo', 'ir directamente a donde te hace avanzar, en tres o cuatro palabras'), want('corto', 'pedir lo que necesitas a quien tengas delante, en tres o cuatro palabras')] },
  { id: 'picaro', label: 'Pícaro', class_id: 'rogue', race_id: 'half-elf', suggested_p: 0.25, game_min: 15,
    prompt: 'Eres un jugador pícaro: mientes, regateas, robas, te cuelas, pides fiado y empeñas lo que sea. Siempre buscas el atajo y sacar tajada.',
    wants: IMPULSES.filter((x) => x.id !== 'inexistente').concat([want('robar', 'robar algo a alguien o de algún sitio sin que te vean', 'Intento robarle la bolsa sin que se dé cuenta.')]) },
  { id: 'rompejuegos', label: 'Rompejuegos', class_id: 'wizard', race_id: 'gnome', suggested_p: 0.15, game_min: 10,
    prompt: 'Eres un jugador que pone a prueba al narrador: pides lo imposible, das por hecho cosas que no han pasado, dices que ya tienes objetos que no tienes, preguntas por sitios inventados e intentas saltarte la historia.',
    wants: [want('inexistente', 'preguntar por algo que no existe aquí (un gremio, una torre, un barco volador)', 'Pregunto dónde está la torre del archimago.'), want('dar_por_hecho', 'decir que ya tienes algo o ya has hecho algo que no ha pasado', 'Le enseño la llave del granero que ya tengo.'), want('imposible', 'intentar algo imposible para tu personaje (volar, matar de un golpe a todos, comprar el pueblo entero)', 'Compro el pueblo entero.'), want('saltar', 'ir directamente al final de la historia, sin pasar por lo de antes', 'Voy directamente a la cripta y apago la Brasa.')] },
  { id: 'novato', label: 'Novato', class_id: 'fighter', race_id: 'human', suggested_p: 0.5, game_min: 10,
    prompt: 'Eres alguien que nunca ha jugado a rol. No sabes qué se puede hacer, a veces preguntas qué hacer o cómo funciona algo, escribes con dudas y te confundes con los nombres.',
    wants: [want('dudar', 'preguntar qué puedes hacer ahora, adónde ir o qué se espera de ti', '¿Qué puedo hacer ahora?'), want('reglas', 'preguntar cómo funciona algo del juego (las monedas, las tiradas, tu ficha, el Diario)', '¿Cómo funciona lo de las tiradas?'), want('confundir', 'hablar de alguien o algo confundiendo un nombre que te han dicho')] },
  { id: 'charlatan', label: 'Charlatán', class_id: 'bard', race_id: 'dwarf', suggested_p: 0.2, game_min: 10,
    prompt: 'Eres un jugador al que le encanta hablar: quieres conocer a cada persona, le preguntas por su vida, le llevas la contraria, vuelves sobre lo que dijo antes, cuentas tus cosas y sigues la conversación todo lo que se pueda.',
    wants: [want('vida', 'preguntar a quien tengas delante por su vida, su familia o lo que le preocupa', 'Le pregunto por su familia.'), want('contradecir', 'llevar la contraria o insistir en algo que te acaba de decir', 'No me lo creo: insisto en que me lo cuente.'), want('cotillear', 'preguntar a quien tengas delante qué opina de otra persona del pueblo', 'Le pregunto qué opina de la herborista.'), want('volver', 'recordarle algo que te dijo antes y preguntarle más sobre ello', 'Antes dijiste otra cosa, ¿no?')] },
  { id: 'explorador', label: 'Explorador', class_id: 'ranger', race_id: 'dragonborn', suggested_p: 0.35, game_min: 20,
    prompt: 'Eres un jugador explorador: quieres ver cada rincón del valle, registras lo que encuentras, abres puertas, sigues huellas, buscas pasadizos y vas a los sitios más apartados.',
    wants: [want('registrar', 'registrar o examinar de cerca algo concreto de este sitio', 'Registro el rincón con cuidado.'), want('ir', 'ir a un sitio donde aún no hayas estado', 'Voy al sitio más apartado que conozco.'), want('huellas', 'buscar huellas, rastros o algo escondido por aquí', 'Busco huellas por el suelo.')] },
  { id: 'dirigido', label: 'Dirigido', class_id: 'paladin', race_id: 'human', suggested_p: 0.4, game_min: 10, leaves_after_refusals: 2,
    prompt: DIRECTED_PROMPT, wants: DIRECTED_WANTS },
  // Mecánicos: no juegan un carácter, recorren adrede lo que puede pasar en una sesión normal (conjuros, recursos de
  // clase, objetos, disparar, sigilo, forzar, saquear, trepar, descansar…) para que el máster ejercite todas sus tools.
  { id: 'lanzador', label: 'Mecánico, lanzador', class_id: 'sorcerer', race_id: 'half-elf', suggested_p: 0.1, game_min: 10, cycle: true,
    prompt: 'Eres un jugador que quiere probar todo lo que sabe hacer su personaje: cada vez intentas una cosa distinta de tu ficha (un conjuro, un rasgo de clase, un objeto, un ataque) sobre lo que haya en la escena, diciendo exactamente qué usas.',
    wants: MECHANICS_CASTER },
  { id: 'tirador', label: 'Mecánico, tirador', class_id: 'ranger', race_id: 'elf', suggested_p: 0.1, game_min: 10, cycle: true,
    prompt: 'Eres un jugador que quiere probar todo lo que sabe hacer su personaje: cada vez intentas una cosa distinta (disparar, rastrear, esconderte, forzar, registrar, trepar, montar, descansar) sobre lo que haya en la escena, diciendo exactamente qué haces.',
    wants: MECHANICS_RANGER },
];

/** El dirigido, a por un final concreto: para las partidas que empiezan en el acto III. */
export const FINAL_PROFILES: PlayerProfile[] = ([
  ['templar', 'Templar el ascua: Ilse te lo propone; hay que llevar el ascua de Ysolde al pozo y templarla con los eslabones de hierro frío'],
  ['verdad', 'La verdad en el pozo: Brenna te lo propone; ella tiene que contarlo y Ysolde oírlo, las dos en la misa del pozo'],
  ['arder', 'Que arda Vharn: Ysolde te lo propone; hay que entregarle a Osric y dejar que suelte el ascua en la plaza'],
] as const).map(([id, aim]) => ({
  id: `dirigido-${id}`, label: `Dirigido, ${id}`, class_id: 'paladin', race_id: 'human', suggested_p: 0.3, game_min: 10, leaves_after_refusals: 2,
  prompt: `${DIRECTED_PROMPT} Quieres este final y solo este: ${aim}.`, wants: DIRECTED_WANTS,
}));

/**
 * Partidas a dos (--pairs): dos jugadores automáticos en la misma partida, juntos desde el principio. Cada pareja junta
 * dos maneras de jugar que se estorban o se complementan: el que sigue el Diario con el que habla sin parar, el pícaro
 * con el novato al que robar, el violento con el que no tiene prisa, el que rompe el juego con el que quiere acabarlo.
 */
export const PAIRS: [string, string][] = [['metodico', 'charlatan'], ['picaro', 'novato'], ['violento', 'pausado'], ['rompejuegos', 'dirigido'], ['explorador', 'impredecible']];

/** Lo que un jugador hace con su compañero (lo que las partidas del 4-11 y del 11-11 pusieron a prueba). */
const PAIR_WANTS_ALL = [
  want('chat', 'decirle algo a tu compañero por el chat de jugadores (qué hacer ahora, qué has visto, un plan), en una frase', '¿Vamos juntos a la plaza?'),
  want('hablar', 'decirle algo a tu compañero en voz alta, delante de quien esté, como habla tu personaje', 'Ven, que esto no me gusta.'),
  want('dar', 'darle o pasarle a tu compañero algo que lleves (una ración, unas monedas, un objeto)', 'Le doy una ración.'),
  want('seguir', 'ir a donde está tu compañero, o pedirle que venga contigo', 'Voy a donde está mi compañero.'),
];
const PAIR_WANTS_BY_PROFILE: Record<string, { id: string; prompt: string; dry: string }[]> = {
  picaro: [want('robar_pj', 'intentar robarle algo a tu compañero sin que se dé cuenta', 'Intento quitarle la bolsa a mi compañero sin que lo note.')],
  rompejuegos: [want('robar_pj', 'intentar robarle algo a tu compañero sin que se dé cuenta', 'Le quito la bolsa a mi compañero.'), want('mandar', 'dar órdenes a tu compañero como si fuera tu criado', 'Tú, trae agua.')],
  violento: [want('pegar_pj', 'empujar o pegar a tu compañero por algo que ha hecho o dicho', 'Le doy un empujón a mi compañero.')],
  charlatan: [want('cotillear_pj', 'preguntarle a tu compañero por su vida o llevarle la contraria', 'No estoy de acuerdo contigo.')],
};
export function pairWantsFor(profile: PlayerProfile | null): { id: string; prompt: string; dry: string }[] {
  return [...PAIR_WANTS_ALL, ...(profile ? PAIR_WANTS_BY_PROFILE[profile.id] ?? [] : [])];
}

/** Una negativa del NPC, con o sin frase dictada. También cuenta en scripts/playtest-report.ts. */
export const REFUSAL = /no se le cuenta|no te lo (digo|cuento|voy a decir|repito)|eso no (te lo digo|se dice|se cuenta|te importa|es asunto tuyo)|no lo cuento|no es asunto tuyo|no te incumbe|ya te lo (he )?dich?o|ya te he dicho|no tengo nada que decirte/i;
const LEAVE_NPC = { id: 'dejar', prompt: 'dejar a quien tienes delante, que no te va a decir más, e ir a otro sitio o a otra persona de lo que dice tu Diario', dry: 'Lo dejo estar y me voy a otra cosa del Diario.' };

const NAMES = ['Aldara', 'Bruno', 'Ciro', 'Dalia', 'Elmo', 'Fiona', 'Gaspar', 'Hilda', 'Iker', 'Jimena', 'Lope', 'Mirela'];
const HOOKS = [
  'Busca a su hermana, que desapareció hace un mes en este pueblo.',
  'Huye de un acreedor y necesita dinero rápido.',
  'Viene a cobrar una herencia que nadie quiere darle.',
  'Le han contratado para entregar un paquete y ha perdido la dirección.',
  'Quiere hacerse un nombre, cueste lo que cueste.',
];

/** Cliente de texto (jugador y juez): el mismo contrato que el del máster. */
export type TextClient = MasterClient;

export interface PlayerTurn {
  i: number;
  mode: 'suggested' | 'own';
  impulse: string | null;
  text: string;
  /** A dos: qué fue (chat con el compañero, frase en la escena, respuesta a una reacción o a una oferta); sin esto, una acción normal. */
  how?: 'chat' | 'say' | 'reaction' | 'offer';
  /** A dos: entró a la vez que la del compañero (ventana de turno o ronda). */
  together?: true;
  ok: boolean;
  /** Texto que vio el jugador cuando la acción no fue bien (máster sin respuesta, espera, etc.). */
  engine_text: string | null;
  rolls: number;
  usage: TokenUsage;
  /** Eventos del máster que generó esta acción (incluidos los de la tirada). */
  event_ids: string[];
  /** Lo que leyó el jugador tras la acción. */
  reply?: string;
  /** Lo que tardó el juego en responder, sin contar al jugador automático (ms reales). */
  wall_ms?: number;
  state?: TurnState;
}

/** Foto del PJ tras cada acción: para ver el progreso sin reconstruirlo del log. */
export interface TurnState { game_s: number; status: string; hp: number; hp_max: number; level: number; xp: number; coins: number; location: string; open: number; steps: number; done: number; clues: number }

export type GameEnd = 'final' | 'atasco' | 'tope' | 'presupuesto' | 'caido';

export interface GameSummary {
  n: number;
  slug: string;
  dir: string;
  campaign_id: string;
  world: { seed: number; tone: string; model: string; cost_usd: number };
  character: { id: string; name: string; race: string; class: string; hook: string; situation: string | null };
  actions: PlayerTurn[];
  master: TokenUsage & { calls: number; cost_usd: number | null; models: string[] };
  player: TokenUsage & { calls: number; cost_usd: number | null };
  cost_usd: number | null;
  failures: number;
  wall_ms: number;
  /** Partidas con perfil. */
  profile?: string;
  ended?: GameEnd;
  /** Coste real de todas las llamadas del máster, también las que no dejan evento (prólogo, fallos). */
  metered_usd?: number | null;
  quests?: { id: string; title: string; status: string }[];
  escalated?: string[];
  final_quest?: string | null;
  /** Lo que pasó al adelantar el reloj hasta el epílogo. */
  epilogue?: string;
  downs?: number;
  /** Partida preparada: acto en el que empezó y misiones que ya traía. */
  start_act?: number;
  start_done?: number;
  /** Partida a dos: con quién jugó (un resumen por jugador, mismo slug) y cuánto hicieron juntos. */
  pair?: { n: number; partner: string; partner_profile: string; together: number; chats: number; reactions: number };
}

/** Un jugador automático dentro de una partida (uno, o dos en las partidas a dos). */
interface Seat {
  k: number;
  c: Character;
  profile: PlayerProfile | null;
  startDone: number;
  last: string;
  suggested: string[];
  refusals: number;
  leaveNow: boolean;
  actions: PlayerTurn[];
  player: TokenUsage & { calls: number };
  lastUsage?: TokenUsage;
  history: string[];
  ended: GameEnd | null;
  downs: number;
  progressKey: string;
  progressAt: number;
  finalAt: number | null;
  together: number;
  chats: number;
  reactions: number;
  /** Perfiles `cycle`: por dónde va la lista de `wants`. */
  cycleAt: number;
  pending?: { r: ActionResult; p: Planned; fresh: GameEvent[]; rolls: number; wall: number };
}

/** Lo que el jugador va a mandar en esta vuelta. */
interface Planned {
  mode: PlayerTurn['mode'];
  impulse: string | null;
  text: string;
  how?: PlayerTurn['how'];
  reaction?: Reaction;
  offer?: Offer;
}

export interface AutoplayRun {
  version: 1;
  dry_run: boolean;
  stamp: string;
  started_at: string;
  models: { master: string; player: string; worldgen: string; judge: string };
  seed: number;
  games_planned: number;
  actions_per_game: number;
  games: GameSummary[];
  /** Partidas que no llegaron a terminar. */
  errors: string[];
  totals: { cost_usd: number | null; master_usd: number | null; player_usd: number | null; worldgen_usd: number; actions: number; master_calls: number; failures: number };
}

const ZERO = (): TokenUsage => ({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
const addUsage = (a: TokenUsage, b: Partial<TokenUsage>) => { a.input += b.input ?? 0; a.output += b.output ?? 0; a.cache_read += b.cache_read ?? 0; a.cache_write += b.cache_write ?? 0; };
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length]!;
const sumCost = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0));

/** Gasto del máster según sus eventos. La línea de la muerte (`master_line`) guarda solo el modelo: no suma aquí, ya la cuenta el medidor. */
export function masterTally(events: readonly GameEvent[]): TokenUsage & { calls: number; cost_usd: number | null; models: string[] } {
  const master = { ...ZERO(), calls: 0, cost_usd: 0 as number | null, models: [] as string[] };
  const costs: (number | null)[] = [];
  for (const e of events) {
    const m = e.payload['master'] as { model: string; usage?: TokenUsage };
    if (!m.usage) continue;
    addUsage(master, m.usage); master.calls++;
    if (!master.models.includes(m.model)) master.models.push(m.model);
    costs.push(costUsd(m.usage, m.model, MASTER_CACHE_WRITE_MULT));
  }
  master.cost_usd = sumCost(costs);
  return master;
}

function textOf(m: Anthropic.Beta.BetaMessage): string {
  return m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function usageOf(m: Anthropic.Beta.BetaMessage): TokenUsage {
  return { input: m.usage.input_tokens, output: m.usage.output_tokens, cache_read: m.usage.cache_read_input_tokens ?? 0, cache_write: m.usage.cache_creation_input_tokens ?? 0 };
}

function fakeMessage(model: string, text: string, usage: TokenUsage): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_fake_${Math.random().toString(36).slice(2, 10)}`, type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: usage.cache_read, cache_creation_input_tokens: usage.cache_write },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** Máster falso: el offline (log_event plausible desde el contexto) con el consumo base, para que el coste salga. */
export function dryMasterClient(): MasterClient {
  const inner = offlineClient();
  let n = 0;
  return {
    async create(params) {
      const res = await inner.create(params);
      const cold = n++ === 0;
      return { ...res, model: params.model, usage: { ...res.usage, input_tokens: BASELINE_CALL.input, output_tokens: BASELINE_CALL.output, cache_read_input_tokens: cold ? 0 : BASELINE_CALL.cache_read, cache_creation_input_tokens: cold ? BASELINE_CALL.cache_read : 0 } } as Anthropic.Beta.BetaMessage;
    },
  };
}

/** Jugador falso: en modo sugerida contesta un número; en modo propio, la frase de su impulso. */
export function dryPlayerClient(): TextClient {
  return {
    async create(params) {
      const prompt = params.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      const impulse = [...IMPULSES, ...pairWantsFor(null), ...Object.values(PAIR_WANTS_BY_PROFILE).flat(), ...MECHANICS_CASTER, ...MECHANICS_RANGER].find((x) => prompt.includes(x.prompt));
      const text = /Responde SOLO con el número/.test(prompt) ? '1' : /«me dejo» o «me resisto»/.test(prompt) ? 'Me resisto.' : impulse?.dry ?? 'Miro alrededor con calma.';
      return fakeMessage(params.model, text, { input: 450, output: 20, cache_read: 0, cache_write: 0 });
    },
  };
}

// ---------------------------------------------------------------------------
// Jugador automático
// ---------------------------------------------------------------------------

/** Ficha corta: lo que el jugador sabe de su personaje. */
export function playerSheet(engine: Engine, c: Character): string {
  const items = engine.world.itemsCarriedBy(c.id).map((i) => { const d = engine.world.itemDef(i.item_id); return i.quantity > 1 ? `${d.name} ×${i.quantity}` : d.name; });
  const race = RACES.find((r) => r.id === c.race_id)?.name ?? c.race_id;
  // El dinero no es un campo del PJ: es lo que hay en sus bolsas (money.ts). Antes salía «Monedas: undefined» y llegaba a la narración.
  const parts = [`${c.name}, ${race.toLowerCase()} ${c.class_name.toLowerCase()} de nivel ${c.level}. PG ${c.hp_current}/${c.hp_max}.`, `Dinero: ${money(engine.world, coinsOf(engine.world, c.id))}.`];
  const spells = spellGroups(c).map((g) => `${g.label}: ${[...g.spells, ...g.always].map((s) => s.name).join(', ')}`);
  if (spells.length) parts.push(`Conjuros: ${spells.join('; ')}.`);
  const res = resourceLines(c);
  if (res.length) parts.push(`Usos de clase: ${res.join(', ')}.`);
  parts.push(`Lleva: ${items.join(', ') || 'nada'}.`);
  return parts.join(' ');
}

export const PLAYER_SYSTEM = 'Juegas a un juego de rol por chat en castellano: eres el jugador, no el narrador. Contestas solo con lo que hace o dice tu personaje, en primera persona, en una o dos frases (25 palabras como mucho), sin comillas de apertura ni explicaciones. Juegas con ganas: quieres avanzar en tu situación y a veces pones a prueba al narrador.';

export function playerPrompt(o: { sheet: string; situation: string | null; last: string; suggested: string[]; mode: 'suggested' | 'own'; impulse: { prompt: string } | null; profile?: string; diary?: string; history?: string[]; /** A dos: quién es el compañero y qué acaba de hacer. */ partner?: string; /** Sustituye la instrucción final (una reacción que decidir). */ question?: string }): string {
  const parts = [`## Tu personaje\n${o.sheet}`];
  if (o.profile) parts.unshift(`## Cómo juegas\n${o.profile}`);
  if (o.partner) parts.push(`## Con quién juegas\n${o.partner}`);
  if (o.situation) parts.push(`## Tu situación\n${o.situation}`);
  if (o.diary) parts.push(`## Tu Diario\n${o.diary}`);
  if (o.history?.length) parts.push(`## Antes de eso\n${o.history.join('\n')}`);
  parts.push(`## Lo último que ha pasado\n${o.last || '(empieza la partida)'}`);
  if (o.question) { parts.push(`## Te toca decidir\n${o.question}`); return parts.join('\n\n'); }
  if (o.suggested.length) parts.push(`## Acciones sugeridas\n${o.suggested.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  parts.push(o.mode === 'suggested'
    ? 'Elige la acción sugerida que más te apetezca. Responde SOLO con el número.'
    : `Escribe tu propia acción (no copies las sugeridas). Esta vez te apetece ${o.impulse?.prompt ?? 'hacer algo propio'}; hazlo de forma que encaje con la escena.`);
  return parts.join('\n\n');
}

/** Número elegido → acción sugerida; si no se entiende, la primera. */
export function parseSuggestedChoice(text: string, suggested: string[]): string {
  const n = Number(/\d+/.exec(text)?.[0]);
  return suggested[n - 1] ?? suggested.find((s) => text.toLowerCase().includes(s.toLowerCase())) ?? suggested[0]!;
}

/** Limpia la acción propia: una línea, sin comillas sueltas, con tope. */
export function cleanOwnAction(text: string): string {
  const line = (text.split('\n').find((l) => l.trim()) ?? '').trim().replace(/^["«“'\s]+|["»”'\s]+$/g, '');
  return line.slice(0, 300) || 'Miro alrededor.';
}

// ---------------------------------------------------------------------------

export interface AutoplayOptions {
  games: number;
  actions: number;
  seed: number;
  models: AutoplayRun['models'];
  dryRun: boolean;
  gamesDir: string;
  outDir: string;
  stamp: string;
  /** Una partida por perfil (y campaña escrita, no mundo generado). */
  profiles?: PlayerProfile[];
  /** Una partida por pareja, con dos jugadores automáticos juntos; `actions` es por jugador. */
  pairs?: [PlayerProfile, PlayerProfile][];
  campaign?: string;
  /** Partidas a la vez. */
  parallel?: number;
  /** Corta la partida si el máster pasa de este gasto. */
  maxUsdPerGame?: number;
  /** Empieza en este acto de Brezal, con lo anterior hecho por tools y sin máster (prepareBrezalAct). */
  startAct?: 2 | 3;
  /** Clientes reales; en dry-run se usan los falsos. */
  masterClient?: MasterClient;
  playerClient?: TextClient;
  log?: (s: string) => void;
}

/**
 * Lleva a un PJ recién creado al principio del acto II o III de Brezal por el camino de test/brezal.test.ts: las
 * mismas tools y en el mismo orden, sin máster y sin gastar nada. Deja elegibles los tres finales si es el acto III.
 * `advanceGame` adelanta el reloj de la partida. Devuelve lo que ya trae hecho, para contárselo al jugador.
 */
export async function prepareBrezalAct(engine: Engine, c: Character, act: 2 | 3, advanceGame: (gameS: number) => void): Promise<string> {
  const H = 3600;
  const world = engine.world;
  // Sin máster, nada de lo que pase al avanzar el mundo puede llamar a la API. Sin viaje rápido: la hora del mundo y la del PJ van juntas.
  const raw = engine as unknown as { master: unknown; fastTravel: boolean };
  const saved = { master: raw.master, fastTravel: raw.fastTravel, str: c.abilities.str };
  raw.master = null;
  raw.fastTravel = false;
  // El gestor arranca la partida con el reloj parado hasta que alguien está presente (docs/MULTIJUGADOR.md, «Reloj y
  // desconexión»); sin esto el viaje no llega nunca. El jugador automático está: su entrada pone el mundo en marcha.
  engine.setPresence(c.id, true);
  c.abilities.str = 18; // las recompensas en monedas pesan
  const tool = (name: string, input: Record<string, unknown>, tolerated?: RegExp): Record<string, unknown> => {
    const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: '¿Necesitas ayuda?' };
    const r = JSON.parse(executeTool(ctx, name, input)) as Record<string, unknown>;
    if (r['error'] && !tolerated?.test(JSON.stringify(r))) throw new Error(`Preparación del acto ${act}: ${name} ${JSON.stringify(input)} → ${JSON.stringify(r)}`);
    return r;
  };
  const alone = () => { for (const n of world.npcs.values()) if (n.talking_to?.character_id === c.id) n.talking_to = null; };
  const walk = async (spotId: string) => {
    if (world.characterSpot(c)?.id === spotId) return;
    alone();
    tool('move_to', { character_id: c.id, target_spot_id: spotId, pace: 'walk' });
    if (c.transit) advanceGame(c.transit.arrives_game_s - engine.gameNow() + 2);
    await engine.tick();
    if (world.characterSpot(c)?.id !== spotId) throw new Error(`Preparación del acto ${act}: no llega a ${spotId}`);
  };
  const talk = async (npcId: string) => {
    const n = world.npc(npcId);
    await walk(n.location.id);
    alone();
    n.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c), ripe: true };
    await engine.tick();
  };
  const carried = (itemId: string) => world.itemsCarriedBy(c.id).find((i) => i.item_id === itemId);
  const stow = (instanceId: string) => {
    const bag = carried('it_mochila');
    if (!bag) return tool('transfer_item', { instance_id: instanceId, to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: 1 });
    return tool('transfer_item', { instance_id: instanceId, to_type: 'container', to_id: bag.id, slot: null, equip_slot: null, quantity: null });
  };
  const take = async (instanceId: string) => {
    const r = tool('transfer_item', { instance_id: instanceId, to_type: 'character', to_id: c.id, slot: 'pocket', equip_slot: null, quantity: 1 }, /no_space|too_heavy|pesa/);
    if (r['error']) stow(instanceId);
    await engine.tick();
  };
  const give = (itemId: string, npcId: string) => {
    const it = carried(itemId);
    if (!it) throw new Error(`Preparación del acto ${act}: no lleva ${itemId}`);
    tool('transfer_item', { instance_id: it.id, to_type: 'npc', to_id: npcId, slot: null, equip_slot: null, quantity: null });
  };
  const accept = (id: string) => { const st = characterStory(c); if (!st.open.includes(id) && !st.done.includes(id)) tool('story_quest', { quest_id: id, action: 'accept' }); };
  const clue = (id: string) => tool('grant_clue', { character_id: c.id, clue_id: id }, /ya la ten/);
  const hidden = (id: string) => tool('discover_spot', { character_id: c.id, spot_id: id }, /ya /);
  const mustHaveDone = (ids: readonly string[]) => { const missing = ids.filter((id) => !characterStory(c).done.includes(id)); if (missing.length) throw new Error(`Preparación del acto ${act}: sin cumplir ${missing.join(', ')}`); };

  await engine.tick();
  // Acto I: el agua, el perro, la cena y lo que vio Doro.
  await walk('sp_pl_pozo');
  await take('ii_agua_pozo');
  await talk('npc_ilse');
  accept('q_agua');
  give('it_agua_pozo', 'npc_ilse');
  await talk('npc_brenna');
  accept('q_perro');
  await walk('sp_cl_sendero');
  await walk('sp_cs_cueva');
  tool('advance_story', { quest_id: 'q_perro', step_id: 'sacar' });
  await talk('npc_brenna');
  accept('q_cena_doro');
  await walk(world.npc('npc_doro').location.id);
  give('it_racion', 'npc_doro');
  await talk('npc_brenna');
  await talk('npc_doro');
  accept('q_noche');
  clue('clue_doro');
  await walk('sp_cl_arroyo');
  const day = Math.floor(engine.gameNow() / (24 * H));
  const at23 = day * 24 * H + 23 * H + 5 * 60;
  advanceGame((engine.gameNow() < at23 ? at23 : at23 + 24 * H) - engine.gameNow());
  await engine.tick();
  hidden('sp_mo_desvan');
  await walk('sp_mo_desvan');
  await take('ii_cartas_tobias');
  await talk('npc_doro');
  await engine.tick();
  mustHaveDone(['q_agua', 'q_perro', 'q_cena_doro', 'q_noche']);

  if (act === 3) {
    // Acto II: el sótano, Tobías, la cadena y el granero.
    await talk('npc_brenna');
    accept('q_sotano');
    await walk('sp_so_escalera');
    hidden('sp_so_hueco');
    await walk('sp_so_hueco');
    await take('ii_libro_cuentas');
    await talk('npc_brenna');
    await talk('npc_mateo');
    accept('q_tobias');
    tool('advance_story', { quest_id: 'q_tobias', step_id: 'confesar' });
    tool('advance_story', { quest_id: 'q_tobias', step_id: 'parar' });
    await talk('npc_ilse');
    accept('q_cadena');
    await talk('npc_hugo');
    clue('clue_hugo');
    await engine.tick();
    hidden('sp_he_losa');
    await walk('sp_he_losa');
    // Los eslabones pesan: si no caben, se quedan las cartas de Tobías, que ya no hacen falta. El libro no: abre dos finales.
    if (!carried('it_cadena_fria')) {
      const free = tool('transfer_item', { instance_id: 'ii_cadena_fria', to_type: 'container', to_id: carried('it_mochila')?.id ?? '', slot: null, equip_slot: null, quantity: null }, /./);
      if (free['error']) {
        const cartas = carried('it_cartas_tobias');
        if (cartas) tool('transfer_item', { instance_id: cartas.id, to_type: 'spot', to_id: world.characterSpot(c)!.id, slot: null, equip_slot: null, quantity: null });
        stow('ii_cadena_fria');
      }
    }
    await walk('sp_cu_puerta');
    await talk('npc_ilse');
    await talk('npc_hal');
    accept('q_subida');
    await walk('sp_ca_torre');
    await walk('sp_ru_patio');
    await talk('npc_ysolde');
    // Sin charla abierta al darle la pista: si no, Ysolde le pediría ya su final y los otros dos dejarían de estar a la par.
    alone();
    clue('clue_ysolde');
    await talk('npc_hal');
    await engine.tick();
    mustHaveDone(['q_sotano', 'q_tobias', 'q_cadena', 'q_subida']);
    const shut = storyOf(world)!.quests.filter((q) => q.exclusive === 'final' && questStatus(world, c, q) !== 'available');
    if (shut.length) throw new Error(`Preparación del acto 3: finales no elegibles: ${shut.map((q) => `${q.id} (${questStatus(world, c, q)})`).join(', ')}`);
  }

  // Que los NPC recuerden lo hecho: sin esto, tratarían al PJ como a alguien que acaba de llegar.
  const story = storyOf(world)!;
  const nowG = engine.nowFor(c);
  const done = characterStory(c).done.map((id) => story.quests.find((q) => q.id === id)).filter((q): q is NonNullable<typeof q> => Boolean(q));
  for (const q of done) {
    const giver = q.giver_npc_id ? world.npcs.get(q.giver_npc_id) : undefined;
    if (!giver) continue;
    giver.memory.push({ character_id: c.id, game_s: nowG, note: `${c.name} cumplió «${q.title}».`, importance: 2 });
    world.touch('npcs', giver.id);
  }
  alone();
  raw.master = saved.master;
  raw.fastTravel = saved.fastTravel;
  c.abilities.str = saved.str;
  world.touch('characters', c.id);
  await engine.flush();
  return `Llevas unos días en Brezal. Ya has cumplido: ${done.map((q) => `«${q.title}»`).join(', ')}. Tienes ${c.clues.length} pistas y eres de nivel ${c.level}.`;
}

export async function runAutoplay(opts: AutoplayOptions): Promise<AutoplayRun> {
  const log = opts.log ?? (() => undefined);
  const { models } = opts;
  // El máster lee MASTER_MODEL por encima del modelo de la campaña (effectiveModel).
  process.env['MASTER_MODEL'] = models.master;
  const masterClient = opts.dryRun ? dryMasterClient() : opts.masterClient ?? liveClient();
  const playerClient = opts.dryRun ? dryPlayerClient() : opts.playerClient ?? liveClient(30_000);
  // Sin clave en el entorno de la partida en las campañas escritas: no hay comentarios del mundo con modelo, que no se miden aquí.
  const env = { ...process.env, IMAGES: 'off', WORLDGEN_MODEL: models.worldgen, ...(opts.campaign ? { ANTHROPIC_API_KEY: '' } : {}) };
  // Reloj y gestor por partida: pueden jugarse a la vez. Sin cupo diario: el de 200 acciones pasaría al máster offline a media partida.
  const newManager = (now: () => number, client: MasterClient, engineOpts: { turnWindowMs?: number; roundMs?: number } = {}) => new GameManager({
    root: opts.gamesDir, env, log: (m) => log(`    ${m}`), budget: null,
    engine: { now, ...engineOpts },
    masterFor: (engine, _g, _p, rng) => new Master(engine, { client, ...(rng ? { rng } : {}) }),
    // Si el relleno con un modelo pequeño no valida, mundo offline: el piloto mide al máster, no al generador.
    worldgen: async (o) => {
      try { return await generateSeed({ ...o, model: models.worldgen, ...(opts.dryRun ? { client: null } : {}) }); } catch (e) {
        log(`    [worldgen] ${(e as Error).message.slice(0, 160)} → mundo offline`);
        return generateSeed({ ...o, client: null });
      }
    },
  });

  const run: AutoplayRun = {
    version: 1, dry_run: opts.dryRun, stamp: opts.stamp, started_at: new Date().toISOString(), models, seed: opts.seed,
    games_planned: opts.games, actions_per_game: opts.actions, games: [], errors: [],
    totals: { cost_usd: 0, master_usd: 0, player_usd: 0, worldgen_usd: 0, actions: 0, master_calls: 0, failures: 0 },
  };
  mkdirSync(opts.outDir, { recursive: true });
  const save = () => writeFileSync(join(opts.outDir, 'summary.json'), JSON.stringify(run, null, 2));

  const playOne = async (n: number): Promise<void> => {
    const t0 = Date.now();
    const rng = seededRng(opts.seed * 1000 + n);
    const pair = opts.pairs?.[(n - 1) % opts.pairs.length] ?? null;
    const seatProfiles: (PlayerProfile | null)[] = pair ? [pair[0], pair[1]] : [opts.profiles?.[(n - 1) % opts.profiles.length] ?? null];
    const profile = seatProfiles[0]!;
    const name = pick(rng, NAMES);
    const race = RACES.find((r) => r.id === profile?.race_id) ?? pick(rng, RACES);
    const klass = CLASSES.find((k) => k.id === profile?.class_id) ?? pick(rng, CLASSES);
    const hook = pick(rng, HOOKS);
    const tone = opts.campaign ? '' : TONES[(opts.seed + n) % TONES.length]!;
    const tag = pair ? `[${pair[0].id}+${pair[1].id}] ` : profile ? `[${profile.id}] ` : '';
    log(`${tag}partida ${n}/${opts.games}: ${name}, ${race.name} ${klass.name}${tone ? `, tono ${tone}` : ''}`);
    let clock = Date.now();
    // Todo lo que gasta el máster, también lo que no deja evento.
    let metered = 0 as number | null;
    const meter: MasterClient = {
      async create(p) {
        const res = await masterClient.create(p);
        const c = costUsd(usageOf(res), res.model, MASTER_CACHE_WRITE_MULT);
        metered = metered === null || c === null ? null : metered + c;
        return res;
      },
    };
    // A dos: ventana de turno corta (tiempo real) para que lo mandado a la vez vaya en la misma llamada, y rondas de pelea que no esperan medio minuto a nadie.
    const manager = newManager(() => clock, meter, pair ? { turnWindowMs: PAIR_WINDOW_MS, roundMs: PAIR_ROUND_MS } : {});
    try {
      if (opts.startAct && opts.campaign !== 'brezal') throw new Error('--start-act solo vale para Brezal.');
      if (opts.startAct && pair) throw new Error('--start-act no vale para las partidas a dos.');
      const { game, character_id } = await manager.create({
        name: `auto-${opts.stamp}-${pair ? `${pair[0].id}-${pair[1].id}` : profile?.id ?? n}`, mode: 'live', dice_seed: (opts.seed * 1000 + n) >>> 0,
        ...(opts.campaign
          ? { campaign_id: opts.campaign, character: { name, race_id: race.id, class_id: klass.id } }
          : { character: { name, race_id: race.id, class_id: klass.id, hook }, world: { seed: (opts.seed * 7919 + n) >>> 0, tone, setting: '' } }),
      });
      const ids = [character_id!];
      if (pair) {
        const p2 = pair[1];
        const name2 = pick(rng, NAMES.filter((x) => x !== name));
        const race2 = RACES.find((r) => r.id === p2.race_id) ?? pick(rng, RACES);
        const klass2 = CLASSES.find((k) => k.id === p2.class_id) ?? pick(rng, CLASSES);
        ids.push(await manager.addCharacter(game.slug, 'auto:2', { name: name2, race_id: race2.id, class_id: klass2.id, ...(opts.campaign ? {} : { hook: pick(rng, HOOKS) }) }, { near: character_id }));
        log(`${tag}segundo jugador: ${name2}, ${race2.name} ${klass2.name}`);
      }
      const engine = await manager.open(game.slug);
      const gen = engine.world.campaign.generation;

      const masterEvents = (c: Character): GameEvent[] => engine.events.all().filter((e) => e.actor_id === c.id && e.payload['master']);
      /** Los cierres del máster que son de este jugador: los suyos y los compartidos en los que entró (`group`). */
      const turnEvents = (c: Character): GameEvent[] => engine.events.all().filter((e) => e.payload['master'] && (e.actor_id === c.id || (Array.isArray(e.payload['group']) && (e.payload['group'] as string[]).includes(c.id))));
      const settle = async () => { if (profile) await engine.settle(60_000); else for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r)); };
      /** Lo que le ha llegado a un jugador desde `seq`, sin lo que ya está en `seen`: lo suyo entero y, de los demás, lo que lee él (readerText). */
      const seenSince = (c: Character, seq: number, seen: readonly string[]): string[] => engine.events.all()
        .filter((e) => e.seq > seq && (e.actor_id === c.id || e.delivered_to.some((d) => d.character_id === c.id && d.level === 'full')))
        .map((e) => (e.actor_id === c.id ? e.narration_private : readerText(engine.world, e, c.id, 'full') ?? e.observable ?? ''))
        .filter((t) => t && !seen.some((x) => x.includes(t)));
      const lastSeq = () => engine.events.all().at(-1)?.seq ?? 0;
      /** Pasa tiempo de juego a saltos de 5 minutos, como «/time» en offline (engine.command). */
      const passGame = async (minutes: number) => {
        for (let left = minutes * 60; left > 0; left -= 300) {
          const d = Math.min(left, 300);
          engine.clock.shift(d);
          engine.world.campaign.game_epoch_s += d;
          for (const x of engine.world.characters.values()) if (x.death?.respawn_real_ms) x.death.respawn_real_ms -= engine.clock.gameToReal(d) * 1000;
          await engine.tick();
        }
        engine.world.touch('campaign', engine.world.campaign.id);
        await settle();
      };
      const finalDone = (c: Character) => characterStory(c).done.find((id) => id.startsWith('q_final_')) ?? null;
      const stateNow = (c: Character): TurnState => {
        const st = characterStory(c);
        return { game_s: engine.nowFor(c), status: c.status, hp: c.hp_current, hp_max: c.hp_max, level: c.level, xp: c.xp, coins: coinsOf(engine.world, c.id), location: engine.world.characterSpot(c)?.location_id ?? '', open: st.open.length, steps: st.steps.length, done: st.done.length, clues: c.clues.length };
      };
      const diaryNow = (c: Character): string => {
        const j = journalOf(engine, c.id);
        return j.quests.active.slice(0, 5).map((q) => `- ${q.title}${q.summary.next ? `: ${q.summary.next}` : ''}`).join('\n');
      };
      /** Lo que un jugador resuelve en la Hoja al subir de nivel: las primeras opciones. */
      const chooseAtLevelUp = async (c: Character) => {
        for (const ch of pendingChoices(c)) {
          const picks = choiceOptions(c, ch).slice(0, ch.count).map((o) => o.id);
          if (picks.length) await engine.choose(c.id, ch.key, picks);
        }
      };

      const seats: Seat[] = [];
      for (const [k, id] of ids.entries()) {
        const c = engine.world.character(id);
        if (pair) engine.setPresence(c.id, true);
        const p = seatProfiles[k] ?? null;
        // Partida preparada: sin escena de apertura, que ya ha pasado; se cuenta lo que trae hecho.
        const prepared = opts.startAct ? await prepareBrezalAct(engine, c, opts.startAct, (d) => { clock += engine.clock.gameToReal(d) * 1000; }) : null;
        if (prepared) { await chooseAtLevelUp(c); log(`${tag}preparado el acto ${opts.startAct}: ${prepared}`); }
        const startDone = characterStory(c).done.length;
        const intro = prepared ? null : await engine.introduce(c.id);
        seats.push({
          k, c, profile: p, startDone, last: prepared ?? intro?.text ?? c.situation?.opening ?? '', suggested: intro?.suggested_actions ?? [],
          refusals: 0, leaveNow: false, actions: [], player: { ...ZERO(), calls: 0 }, history: [], ended: null, downs: 0, progressKey: '', progressAt: 0, finalAt: null, together: 0, chats: 0, reactions: 0, cycleAt: 0,
        });
      }
      const partnerOf = (s: Seat): Seat | null => seats.find((x) => x !== s) ?? null;
      const samePlace = (a: Seat, b: Seat) => engine.world.characterSpot(a.c)?.location_id === engine.world.characterSpot(b.c)?.location_id;
      const playing = () => seats.filter((s) => s.ended === null);
      const inFight = (s: Seat) => { const loc = engine.world.characterSpot(s.c)?.location_id; return Boolean(loc && engine.roundIn(loc)); };

      /** Pide al jugador automático su texto: una acción, una respuesta a una reacción o una frase para el chat. */
      const ask = async (s: Seat, o: { mode: PlayerTurn['mode']; impulse: { prompt: string } | null; question?: string }): Promise<string> => {
        const other = partnerOf(s);
        const partner = other ? `${other.c.name}, ${other.c.class_name.toLowerCase()}, es otro jugador (no un personaje del narrador)${samePlace(s, other) ? ', y está aquí contigo' : ', y ahora no está contigo'}.${other.actions.at(-1) ? ` Lo último que hizo: «${clip(other.actions.at(-1)!.text, 160)}».` : ''}` : undefined;
        const prompt = playerPrompt({
          sheet: playerSheet(engine, s.c), situation: s.c.situation ? situationText(engine.world, s.c.situation) : null, last: s.last, suggested: s.suggested, mode: o.mode, impulse: o.impulse,
          ...(s.profile ? { profile: s.profile.prompt, diary: diaryNow(s.c), history: s.history.slice(-5) } : {}),
          ...(partner ? { partner } : {}), ...(o.question ? { question: o.question } : {}),
        });
        // Sin pensamiento: Haiku 5.5 piensa por defecto y se comía el tope de salida sin llegar a escribir la acción.
        const res = await playerClient.create({ model: models.player, max_tokens: 200, thinking: { type: 'disabled' }, system: PLAYER_SYSTEM, messages: [{ role: 'user', content: prompt }] });
        const pu = usageOf(res);
        addUsage(s.player, pu); s.player.calls++;
        s.lastUsage = pu;
        return o.mode === 'suggested' ? parseSuggestedChoice(textOf(res), s.suggested) : cleanOwnAction(textOf(res));
      };

      /** Qué va a hacer este jugador en esta vuelta, antes de mandarlo al motor. */
      const decide = async (s: Seat): Promise<Planned> => {
        const nowMs = clock;
        const reaction = (s.c.reactions ?? []).find((x) => x.expires_real_ms > nowMs);
        if (reaction) {
          const who = engine.world.characters.get(reaction.from_id)?.name ?? 'Alguien';
          const text = await ask(s, { mode: 'own', impulse: null, question: `${who} intenta ${reaction.attempt}. Decide si te dejas o te resistes: responde SOLO «me dejo» o «me resisto», según cómo sea tu personaje.` });
          return { mode: 'own', impulse: 'reaccion', text, how: 'reaction', reaction };
        }
        const offer = (s.c.offers ?? []).find((o) => o.expires_real_ms > nowMs);
        if (offer) return { mode: 'own', impulse: 'oferta', text: 'Acepto.', how: 'offer', offer };
        const other = partnerOf(s);
        const mode: PlayerTurn['mode'] = !s.leaveNow && s.suggested.length && rng() < (s.profile?.suggested_p ?? SUGGESTED_P) ? 'suggested' : 'own';
        const pairWant = other && mode === 'own' && !s.leaveNow && rng() < PAIR_WANT_P ? pick(rng, pairWantsFor(s.profile)) : null;
        const ownWant = () => (s.profile?.cycle ? s.profile.wants[s.cycleAt++ % s.profile.wants.length]! : pick(rng, s.profile?.wants ?? IMPULSES));
        const impulse = s.leaveNow ? LEAVE_NPC : pairWant ?? (mode === 'own' ? ownWant() : null);
        s.leaveNow = false;
        const text = await ask(s, { mode, impulse });
        const how: PlayerTurn['how'] | undefined = pairWant?.id === 'chat' ? 'chat' : pairWant?.id === 'hablar' ? 'say' : undefined;
        return { mode, impulse: impulse?.id ?? null, text, ...(how ? { how } : {}) };
      };

      /** Manda lo decidido al motor: acción (con sus tiradas), frase en la escena, chat con el compañero o respuesta a una reacción. */
      const send = async (s: Seat, p: Planned): Promise<{ r: ActionResult; texts: string[]; rolls: number }> => {
        const other = partnerOf(s);
        let r: ActionResult;
        if (p.how === 'reaction') {
          r = await engine.act(s.c.id, p.text);
          if (!r.ok) r = await engine.answerReaction(s.c.id, p.reaction!.id, 'resist');
          s.reactions++;
        } else if (p.how === 'offer') {
          r = await engine.answerOffer(s.c.id, p.offer!.id, true);
        } else if (p.how === 'chat' && other) {
          r = await engine.say(s.c.id, p.text, { to: other.c.id });
          s.chats++;
        } else {
          r = await engine.act(s.c.id, p.text, p.how === 'say' ? { mode: 'say' } : {});
        }
        const texts = [r.text];
        let rolls = 0;
        for (; r.requires_roll && rolls < MAX_ROLLS_PER_ACTION; rolls++) { r = await engine.rollPending(s.c.id); texts.push(r.text); }
        return { r, texts, rolls };
      };

      for (let i = 1; i <= opts.actions && playing().length; i++) {
        // Caído o muerto no se juega: se espera a que se levante o reaparezca, como quien vuelve al cabo de un rato.
        for (const s of playing()) {
          if (!s.profile || s.c.status === 'active') continue;
          if (s.c.status !== 'asleep') s.downs++;
          const seqDown = lastSeq();
          const isUp = () => (s.c.status as string) === 'active';
          for (let k = 0; k < 200 && !isUp(); k++) { clock += 60_000; await engine.tick(); }
          await settle();
          if (!isUp()) { s.ended = 'caido'; continue; }
          s.last = `${s.last}\n\n${seenSince(s.c, seqDown, [s.last]).join('\n')}`.trim();
          s.suggested = [];
        }
        const active = playing();
        if (!active.length) break;
        // A la vez: en pelea siempre (la ronda los espera a los dos); si no, de vez en cuando, estando en el mismo sitio.
        const together = active.length === 2 && samePlace(active[0]!, active[1]!) && (inFight(active[0]!) || rng() < TOGETHER_P);
        const before = new Map(active.map((s) => [s, new Set(turnEvents(s.c).map((e) => e.id))]));
        const seq = lastSeq();
        const t1 = Date.now();
        const plans = new Map<Seat, Planned>();
        const results = new Map<Seat, { r: ActionResult; texts: string[]; rolls: number }>();
        if (together) {
          for (const s of active) plans.set(s, await decide(s));
          const rs = await Promise.all(active.map((s) => send(s, plans.get(s)!)));
          active.forEach((s, k) => results.set(s, rs[k]!));
        } else {
          for (const s of active) {
            plans.set(s, await decide(s));
            results.set(s, await send(s, plans.get(s)!));
            if (active.length > 1) await settle();
          }
        }
        clock += STEP_REAL_S * 1000;
        await engine.tick();
        for (let k = 0; active.some((s) => s.c.transit) && k < 120; k++) { clock += 5000; await engine.tick(); }
        await settle();
        const wall = Date.now() - t1;
        let combat = false;
        for (const s of active) {
          const { r, texts, rolls } = results.get(s)!;
          const p = plans.get(s)!;
          const fresh = turnEvents(s.c).filter((e) => !before.get(s)!.has(e.id));
          const moreEvents = s.profile ? seenSince(s.c, seq, texts) : [];
          combat ||= fresh.some((e) => e.tags.includes('combat') || ((e.payload['master'] as { calls?: { name: string }[] }).calls ?? []).some((x) => x.name === 'attack'));
          s.last = [...texts, ...moreEvents].join('\n\n');
          s.suggested = r.suggested_actions ?? [];
          if (together) s.together++;
          s.pending = { r, p, fresh, rolls, wall };
        }
        const seqAfter = lastSeq();
        // Entre acciones pasa el rato (no en plena pelea ni con la respuesta decisiva o la tirada en el aire).
        const calm = active.every((s) => s.profile && s.c.status === 'active' && !s.c.decisive && !s.pending!.r.requires_roll) && !combat;
        if (calm) {
          await passGame(Math.max(...active.map((s) => s.profile!.game_min)));
          for (const s of active) { const later = seenSince(s.c, seqAfter, [s.last]); if (later.length) s.last = `${s.last}\n\n${later.join('\n')}`; }
        }
        for (const s of active) {
          const { r, p, fresh, rolls, wall: w } = s.pending!;
          if (s.profile) await chooseAtLevelUp(s.c);
          const state = stateNow(s.c);
          s.actions.push({ i, mode: p.mode, impulse: p.impulse, text: p.text, ok: r.ok, engine_text: r.ok ? null : r.text, rolls, usage: s.lastUsage ?? ZERO(), event_ids: fresh.map((e) => e.id), ...(p.how ? { how: p.how } : {}), ...(together ? { together: true as const } : {}), ...(s.profile ? { reply: s.last, wall_ms: w, state } : {}) });
          log(`${tag}${String(i).padStart(3)}${pair ? ` ${s.c.name.padEnd(7).slice(0, 7)}` : ''} ${r.ok ? '✓' : '✗'} [${p.how ?? (p.mode === 'own' ? p.impulse : 'sugerida')}${together ? ', a la vez' : ''}] ${p.text.slice(0, 70)}${rolls ? ` · 🎲×${rolls}` : ''}`);
          if (!s.profile) continue;
          s.history.push(`Tú: ${p.text}\nRespuesta: ${clip(s.last, 260)}`);
          s.refusals = REFUSAL.test(s.last) ? s.refusals + 1 : 0;
          if (s.profile.leaves_after_refusals && s.refusals >= s.profile.leaves_after_refusals) { s.leaveNow = true; s.refusals = 0; }
          const key = `${state.steps}/${state.done}/${state.open}/${state.clues}/${state.xp}/${state.level}/${state.location}`;
          if (key !== s.progressKey) { s.progressKey = key; s.progressAt = i; }
          if (s.finalAt === null && finalDone(s.c)) s.finalAt = i;
          // Tras el final, unas pocas acciones para ver si el mundo lo refleja.
          if (s.finalAt !== null && i >= s.finalAt + 5) s.ended = 'final';
          else if (i - s.progressAt >= STUCK_ACTIONS) s.ended = 'atasco';
        }
        if (opts.maxUsdPerGame && metered !== null && metered >= opts.maxUsdPerGame) { for (const s of playing()) s.ended = 'presupuesto'; }
      }
      for (const s of seats) s.ended ??= 'tope';

      // Hasta el epílogo: los escalones que falten saltan al adelantar el reloj.
      let epilogueFrom: number | null = null;
      const story = engine.world.campaign as { story_state?: { started_game_s: number; escalated: string[] } };
      if (profile && story.story_state) {
        epilogueFrom = lastSeq();
        const left = (story.story_state.started_game_s + EPILOGUE_H * 3600 - engine.gameNow()) / 60;
        if (left > 0) await passGame(Math.ceil(left));
      }
      await engine.flush();

      const worldCost = gen?.cost_usd ?? 0;
      // A dos, lo que no es de un PJ en concreto (lo medido y el mundo) se reparte a partes iguales.
      const share = seats.length;
      for (const s of seats) {
        const c = s.c;
        const quests = s.profile ? questsOf(engine.world, c).map((v) => ({ id: v.quest.id, title: v.quest.title, status: v.status })) : undefined;
        const epilogue = epilogueFrom === null ? undefined : engine.events.all().filter((e) => e.seq > epilogueFrom && (e.action_type === 'announcement' || e.action_type === 'story' || e.payload['master'] || (e.action_type === 'progress_story' && e.actor_id === c.id))).map((e) => e.narration_private || e.observable || '').filter(Boolean).join('\n\n');
        // Coste del máster: todos sus eventos de la partida (intro, acciones, tiradas, llegadas).
        const master = masterTally(masterEvents(c));
        const playerCost = costUsd(s.player, models.player);
        const meteredShare = metered === null ? null : metered / share;
        const other = partnerOf(s);
        const summary: GameSummary = {
          n, slug: game.slug, dir: manager.paths(game).dir, campaign_id: game.campaign_id,
          world: { seed: game.world?.seed ?? 0, tone, model: gen?.model ?? (opts.campaign ?? 'offline'), cost_usd: worldCost / share },
          character: { id: c.id, name: c.name, race: RACES.find((r) => r.id === c.race_id)?.name ?? c.race_id, class: c.class_name, hook: opts.campaign ? '' : s.k === 0 ? hook : '', situation: c.situation ? situationText(engine.world, c.situation) : null },
          actions: s.actions, master, player: { ...s.player, cost_usd: playerCost },
          cost_usd: sumCost([s.profile ? meteredShare : master.cost_usd, playerCost, worldCost / share]),
          failures: s.actions.filter((a) => !a.ok).length,
          wall_ms: Date.now() - t0,
          ...(s.profile ? { profile: s.profile.id, ended: s.ended!, metered_usd: meteredShare, quests: quests!, escalated: story.story_state?.escalated ?? [], final_quest: finalDone(c), epilogue: epilogue ?? '', downs: s.downs } : {}),
          ...(opts.startAct ? { start_act: opts.startAct, start_done: s.startDone } : {}),
          ...(other ? { pair: { n, partner: other.c.name, partner_profile: other.profile?.id ?? '', together: s.together, chats: s.chats, reactions: s.reactions } } : {}),
        };
        run.games.push(summary);
        log(`${tag}→ ${summary.slug}${other ? ` (${c.name})` : ''}: máster ${usd(s.profile ? meteredShare : master.cost_usd)} (${master.calls} llamadas), jugador ${usd(playerCost)}, mundo ${usd(worldCost / share)}; ${summary.failures} fallos${s.profile ? `; fin: ${s.ended}` : ''}${other ? `; a la vez ${s.together}, chats ${s.chats}, reacciones ${s.reactions}` : ''}`);
      }
      await manager.close(game.slug);
      save();
    } catch (e) {
      await manager.closeAll().catch(() => undefined);
      throw e;
    }
  };
  // Una partida que revienta no tumba el piloto: queda anotada y se sigue con la siguiente.
  const pending = Array.from({ length: opts.games }, (_, k) => k + 1);
  const worker = async () => {
    for (let n = pending.shift(); n !== undefined; n = pending.shift()) {
      try { await playOne(n); } catch (e) {
        log(`  ✗ partida ${n}: ${(e as Error).stack ?? (e as Error).message}`);
        run.errors.push(`partida ${n}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.parallel ?? 1) }, worker));
  run.games.sort((x, y) => x.n - y.n);

  const g = run.games;
  run.totals = {
    master_usd: sumCost(g.map((x) => (x.metered_usd !== undefined ? x.metered_usd : x.master.cost_usd))), player_usd: sumCost(g.map((x) => x.player.cost_usd)),
    worldgen_usd: g.reduce((a, x) => a + x.world.cost_usd, 0), cost_usd: sumCost(g.map((x) => x.cost_usd)),
    actions: g.reduce((a, x) => a + x.actions.length, 0), master_calls: g.reduce((a, x) => a + x.master.calls, 0), failures: g.reduce((a, x) => a + x.failures, 0),
  };
  save();
  return run;
}

/**
 * Estimación previa con lo medido: 0,13 céntimos por llamada al máster con Haiku y ~1,4 llamadas por acción
 * (tiradas y llegadas); mundo con Haiku ~0,6 céntimos; jugador y juez, migajas.
 */
export function estimate(games: number, actions: number, models: AutoplayRun['models'], authored = false, seats = 1): { total: number | null; master: number | null; worldgen: number | null; player: number | null; judge: number | null } {
  const scale = (model: string) => { const c = costUsd({ input: 1e6, output: 0, cache_read: 0, cache_write: 0 }, model); return c === null ? null : c / 0.1; };
  const m = scale(models.master); const w = scale(models.worldgen); const p = scale(models.player); const j = scale(models.judge);
  // En Brezal, lo medido el 31-10-2026 (2.840 acciones): 0,27 céntimos por acción de máster y 0,024 de jugador, sin mundo que generar.
  // A dos, cada jugador juega `actions`; lo que va a la vez comparte llamada, pero el contexto es mayor: se cuenta como una acción por jugador.
  const master = m === null ? null : authored ? games * seats * actions * 0.0027 * m : games * seats * (actions + 1) * 1.4 * 0.0013 * m;
  const worldgen = w === null ? null : authored ? 0 : games * 0.006 * w;
  const player = p === null ? null : games * seats * actions * (authored ? 0.00024 : 0.0001) * p;
  const judge = j === null ? null : games * seats * Math.ceil(actions / 10) * 0.0015 * j;
  return { master, worldgen, player, judge, total: sumCost([master, worldgen, player, judge]) };
}

export function stampOf(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      games: { type: 'string', default: '3' }, actions: { type: 'string', default: '10' }, seed: { type: 'string', default: '1' },
      'dry-run': { type: 'boolean', default: false }, live: { type: 'boolean', default: false }, 'no-judge': { type: 'boolean', default: false },
      'games-dir': { type: 'string' }, out: { type: 'string', default: 'data/local/autoplay' },
      profiles: { type: 'string' }, pairs: { type: 'string' }, campaign: { type: 'string' }, parallel: { type: 'string', default: '1' }, 'max-usd-game': { type: 'string' }, 'start-act': { type: 'string' },
    },
  });
  const known = [...PROFILES, ...FINAL_PROFILES];
  const profileOf = (id: string): PlayerProfile => { const p = known.find((x) => x.id === id); if (!p) throw new Error(`Perfil desconocido: ${id} (${known.map((x) => x.id).join(', ')})`); return p; };
  const wanted = values.profiles?.split(',').map((x) => x.trim()) ?? null;
  const profiles = wanted ? (wanted[0] === 'all' ? PROFILES : wanted.map(profileOf)) : null;
  // --pairs all | metodico:charlatan,picaro:novato
  const wantedPairs = values.pairs?.split(',').map((x) => x.trim()) ?? null;
  const pairs = wantedPairs ? (wantedPairs[0] === 'all' ? PAIRS : wantedPairs.map((x) => { const [a, b] = x.split(':'); if (!a || !b) throw new Error(`Pareja mal escrita: ${x} (perfil:perfil)`); return [a, b] as [string, string]; })).map(([a, b]) => [profileOf(a), profileOf(b)] as [PlayerProfile, PlayerProfile]) : null;
  if (profiles && pairs) throw new Error('--profiles y --pairs no van juntos.');
  const games = pairs ? pairs.length : profiles ? profiles.length : Number(values.games); const actions = Number(values.actions); const seed = Number(values.seed);
  const campaign = values.campaign ?? (profiles || pairs ? 'brezal' : undefined);
  if (![games, actions, seed].every((x) => Number.isInteger(x) && x >= 0) || games < 1 || actions < 1) throw new Error('--games, --actions y --seed deben ser enteros positivos');
  const dryRun = values['dry-run'];
  const env = (k: string) => process.env[k]?.trim() || DEFAULT_MODEL;
  const models = { master: env('MASTER_MODEL'), player: env('PLAYER_MODEL'), worldgen: env('WORLDGEN_MODEL'), judge: env('JUDGE_MODEL') };
  if (values['start-act'] && !['2', '3'].includes(values['start-act'])) throw new Error('--start-act debe ser 2 o 3');
  const startAct = values['start-act'] ? Number(values['start-act']) as 2 | 3 : undefined;
  const est = estimate(games, actions, models, Boolean(campaign), pairs ? 2 : 1);
  console.log(`${games} partidas${pairs ? ' a dos' : ''} × ${actions} acciones${pairs ? ' por jugador' : ''} · máster ${models.master} · jugador ${models.player} · mundo ${models.worldgen} · juez ${models.judge}`);
  console.log(`Estimación: ${usd(est.total, 3)} (máster ${usd(est.master, 3)}, mundos ${usd(est.worldgen, 3)}, jugador ${usd(est.player, 3)}, juez ${usd(est.judge, 3)}).`);
  if (!dryRun && !values.live) {
    console.log('\nNo se ha llamado a la API. Para partidas reales añade --live (gasta dinero); para probar el montaje, --dry-run.');
    return;
  }
  if (!dryRun && !Master.configured('live')) throw new Error('Falta ANTHROPIC_API_KEY (o ANTHROPIC_AUTH_TOKEN) para --live.');

  const stamp = `${dryRun ? 'dry-' : ''}${stampOf(new Date())}`;
  const outDir = resolve(values.out, stamp);
  // En dry-run las partidas van junto al resumen: no ensucian el menú de partidas de la web.
  const gamesDir = resolve(values['games-dir'] ?? (dryRun ? join(outDir, 'games') : process.env['GAMES_DIR'] ?? 'data/games'));
  const run = await runAutoplay({ games, actions, seed, models, dryRun, gamesDir, outDir, stamp, log: (s) => console.log(s), parallel: Number(values.parallel), ...(profiles ? { profiles } : {}), ...(pairs ? { pairs } : {}), ...(campaign ? { campaign } : {}), ...(values['max-usd-game'] ? { maxUsdPerGame: Number(values['max-usd-game']) } : {}), ...(startAct ? { startAct } : {}) });
  const t = run.totals;
  console.log(`\n${dryRun ? '[dry-run] ' : ''}${run.games.length} partidas, ${t.actions} acciones, ${t.master_calls} llamadas al máster, ${t.failures} fallos`);
  console.log(`  coste: ${usd(t.cost_usd, 4)} (máster ${usd(t.master_usd, 4)}, jugador ${usd(t.player_usd, 4)}, mundos ${usd(t.worldgen_usd, 4)})`);
  console.log(`  → ${join(outDir, 'summary.json')}`);
  if (values['no-judge']) return;
  const report = await judgeRun({ runDir: outDir, model: models.judge, dryRun, useModel: true, log: (s) => console.log(s) });
  console.log(`  juez: ${report.findings.length} errores (${usd(report.judge_cost_usd, 4)}) → ${report.file}`);
}

if (process.argv[1] && /autoplay\.ts$/.test(process.argv[1])) {
  main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
}
