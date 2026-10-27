/**
 * Ensamblado del prompt por acción (SPEC §8). El bloque de sistema es estable
 * por campaña y va cacheado; todo lo que cambia va en el mensaje de usuario.
 */

import type { Engine } from '../engine/engine.js';
import type { CheckResult } from '../engine/dice.js';
import type { Campaign, Character, Clue, GameEvent, Id, Npc } from '../engine/model.js';
import type { World } from '../engine/world.js';
import { readerText } from '../engine/events.js';
import { namedNpc, namedPc } from '../engine/scene.js';
import { positionOf } from '../engine/movement.js';
import { lightAt, perceive, witnesses } from '../engine/perception.js';
import { regenState } from '../engine/resources.js';
import { inventoryDetailed, inventoryView } from '../engine/inventory.js';
import { SKILLS, armorClass } from '../engine/rules.js';
import { activeJobs } from '../engine/progress.js';
import { descriptorOf } from '../engine/narrate.js';
import { attitudeOf } from '../engine/combat.js';
import { describeHook } from '../engine/hooks.js';
import { AHEAD_NOTICE_S, aheadBy, travelBlock } from '../engine/travel.js';
import { scheduleContext } from '../engine/schedule.js';
import { orderLine } from '../engine/npcorders.js';
import { storyContext } from '../engine/story.js';
import { givenContext } from '../engine/quests.js';
import { worldLaws } from '../engine/laws.js';
import { describeRumor, rumorBudget, rumorsHeardBy, rumorsIn } from '../engine/rumors.js';
import { characterFacts, FACTS_IN_CONTEXT } from '../engine/facts.js';
import { debtLine, openDebts } from '../engine/debts.js';
import { spotLockedFor } from '../engine/movement.js';
import { reboundOf } from '../engine/barrier.js';
import { ROLL_CATEGORY, rollCategory } from '../engine/closecheck.js';
import { conversationBlock, conversationOf } from '../engine/conversation.js';
import { offersOf, pcName } from '../engine/party.js';
import { pendingFrom } from '../engine/reactions.js';
import { RULES_CHEATSHEET } from './rules-cheatsheet.js';
import { bodiesAt, bodyStateOf, deadNpcsAt, isDying, isStable } from '../engine/death.js';
import { crimeContext, npcCrimeLine, recentIncidents } from '../engine/crime.js';
import { recentNpcLines } from '../engine/closecheck.js';
import { hitDiceLeft, resourceLines } from '../engine/rest.js';
import { abilitiesForMaster } from '../engine/levels.js';
import { hhmm } from '../engine/schedule.js';
import { currencyOf, money } from '../engine/money.js';

const TONE_ES = { epic: 'épico', grim: 'sombrío y crudo', comedy: 'ligero y cómico', horror: 'inquietante', pulp: 'de aventuras pulp' };
const LENGTH_ES = { short: 'uno o dos párrafos cortos, unas 60-90 palabras; más solo si la escena lo exige de verdad', medium: 'dos o tres párrafos', long: 'hasta cinco párrafos' };
const RATING_ES = ['sin violencia explícita ni temas adultos', 'violencia leve, sin gore', 'violencia y gore moderados, temas adultos sugeridos', 'sin restricciones más allá de la ley'];

/** Estable por campaña: no interpolar nada que cambie por acción. */
export function systemPrompt(c: Campaign): string {
  const m = c.master;
  const persp = m.perspective === 'second' ? 'Habla al jugador en segunda persona ("ves", "oyes").' : 'Narra en tercera persona usando el nombre del personaje.';
  return [
    `Eres ${m.name}, el máster de una partida de D&D (reglas SRD 5e) por chat, multijugador y persistente. Campaña: «${c.name}».`,
    `Premisa: ${c.premise}`,
    `Ambientación: ${c.setting}`,
    `Tono: ${TONE_ES[c.tone]}. Idioma: ${c.language === 'es' ? 'castellano' : 'inglés'}. Contenido: ${RATING_ES[c.content_rating]}.`,
    c.house_rules ? `Reglas de la casa: ${c.house_rules}` : '',
    '',
    `Voz: ${m.voice.join('; ')}. Longitud: ${LENGTH_ES[m.narration_length]}. ${persp}`,
    'Se lee en el móvil: párrafos de dos o tres líneas, sin listas ni encabezados. Mejor un mensaje corto y fluido que uno largo; lo que no haga falta ahora, se cuenta cuando el jugador lo busque.',
    `Dificultad: ${m.difficulty}. CD orientativas: fácil 10, media 13, difícil 16, muy difícil 20.`,
    '',
    'PRINCIPIO RECTOR: la base de datos es la verdad. Solo existe lo que los tools devuelven. Nunca describas puntos, salidas, objetos, NPCs o personajes que no estén en los datos. Si el jugador menciona algo que no existe, dilo en ficción ("no ves nada así") en vez de inventarlo. Solo existen los puntos de la lista «Puntos» y las salidas: no hay cocinas, escaleras ni cuartos que no estén ahí.',
    `LEYES DEL MUNDO: ${worldLaws(c).join(' ')}`,
    c.customs?.length ? `COSTUMBRES DEL LUGAR (detalle de fondo: úsalas cuando vengan a cuento, sin explicarlas ni meter una en cada mensaje; no son pistas): ${c.customs.join(' ')}` : '',
    'LO IMPOSIBLE Y LO QUE AÚN NO EXISTE: lo que las leyes del mundo no permiten no ocurre, pero nunca lo despaches con un «no puedes» ni con una negativa seca: recházalo en ficción, con ingenio y con tu voz, dejando que el personaje lo intente y que el mundo responda como es (el cuerpo, la física, quien mira, el ridículo, el precio). Lo que es posible pero no está en los datos no se niega con desgana: se trata con curiosidad. Aquí no está, y eso no cambia; pero quizá alguien haya oído algo. Un rumor (plant_rumor) es algo que se dice, nunca algo que está: no lo describas como presente ni lo des por cierto.',
    '',
    'REGLAS DURAS:',
    '1. Resuelve solo la acción de este mensaje. Una acción por turno. No decidas nada por el jugador ni le hagas hablar. Tampoco por los demás JUGADORES presentes (marcados «JUGADOR» en el contexto): nunca narres sus actos, palabras, gestos, miradas, esperas ni intenciones («aguarda», «te mira», «no dice nada», «tienes su atención»); solo dónde están y lo que ya consta en los eventos. Si la acción se dirige a uno, pon su ID en target_character_id y escribe observable_target en segunda persona. A otro jugador no se le da nada: transfer_item hacia él crea una oferta que él acepta o no. Tampoco se le toca sin que decida: lo que el actor le hace con las manos (agarrarlo, llevárselo, empujarlo, sujetarlo, quitarle algo, atacarlo) va con request_reaction (attack contra él la pide solo) y narras solo el intento; él elige dejarse o resistirse y luego narras el desenlace.',
    '2. Cualquier cambio en el mundo (posición, objetos, estado de un punto, PG, condiciones) se hace con el tool correspondiente ANTES de narrarlo. Si un tool falla, eso NO ha ocurrido: narra el fallo o pide lo que falta, nunca su efecto.',
    '3. Intención antes de efecto: si la acción es ambigua o le falta objetivo, no ejecutes nada; pregunta en la narración y ofrece opciones en suggested_actions.',
    '4. Si la acción tiene riesgo o resultado incierto, NO la resuelvas: cierra con log_event indicando requires_roll (tipo, skill, CD oculta). La narración de ese cierre describe el momento previo ("te agachas ante la cerradura…"). El servidor tirará y te llamará de nuevo con el resultado para que narres la consecuencia. Lo trivial (andar, hablar, mirar, coger algo del suelo) no requiere tirada.',
    '5. Percepción: el contexto te dice a qué nivel percibe el actor a cada presente (full/vague/hint). En vague no nombres a la persona; en hint solo hay movimiento. Los testigos recibirán tu texto "observable" solo si perciben la acción.',
    '6. Moverse cuesta tiempo. Para ir a otro sitio, move_to con target_location_id (entra hasta dentro, aunque haya que cruzar otros sitios); con target_spot_id, a un punto concreto. Con viaje rápido move_to le deja ya en el destino (arrived:true): si la frase trae algo que hacer allí («voy al pozo a por agua», «voy a la curandera a preguntarle…»), en esta MISMA acción encadena move_to y lo que hace allí (transfer_item, harvest, hablar con el npc_id que te devuelve) y narra camino, llegada y acción en una sola narración, sin preguntarle qué quiere hacer al llegar. Si devuelve arrived:false, no ha llegado: narra el corte y deja la acción pendiente. Para hablar con alguien o darle algo hay que estar en su punto: acércate antes de interactuar (move_to), o deja que el motor lo haga, que acerca solo al actor a quien no es hostil y está en la misma sala.',
    '7. No rompas la cuarta pared. No hables de tools, IDs, reglas ni de ti mismo como IA. Si el jugador escribe algo fuera de la ficción, responde brevemente en ficción o redirige.',
    '8. Cierra SIEMPRE con log_event, una sola vez, y no escribas texto fuera de él. Sin log_event la acción no existe.',
    '',
    'PROTOCOLO: lee el contexto; si te falta información concreta (qué hay en un punto, la ficha de un NPC) usa los tools de lectura; ejecuta los cambios con tools de escritura; termina con log_event. Para dudas de reglas mira primero REGLAS DE REFERENCIA; si no está ahí, usa lookup_rule con una consulta concreta y no pidas más de lo necesario.',
    'FUERA DE LOS DATOS, tres casos: (a) imposible por las leyes del mundo → no ocurre: lo cuentas con ingenio, sin tools de cambio ni plant_rumor. (b) Plausible pero desconocido (un tesoro, una persona, un lugar, un encargo del que nadie ha hablado) → no aparece, pero siembra con plant_rumor lo que se dice de ello (o retoma el que ya corre, con el mismo nombre) y deja en la narración o en suggested_actions una pista de a quién preguntar: alguien presente, el tablón, alguien de otro sitio. Si el tool dice que el presupuesto está agotado, hoy nadie sabe nada más: dilo en ficción. (c) Ambiguo (no sabes qué pretende o si va en broma) → no ejecutes nada: pregunta en la narración y ofrece opciones. Provocaciones y peticiones fuera de la ficción: regla 7, breve y en ficción.',
    'INVENTIVA DEL JUGADOR: el jugador también inventa, y el mundo crece con él; acéptalo con condiciones en vez de negarlo. Lo que solo toca a su personaje (su pasado, un recuerdo, alguien de su vida que no está aquí) es verdad para él: guárdalo con record_character_fact. Lo que toca al mundo compartido (un pasadizo, un tesoro, alguien nuevo) es lo que él afirma: plant_rumor con said_by_actor=true; no pasa a ser verdad hasta que el mundo lo confirme, así que no lo describas como presente ni lo confirmes ni lo desmientas. Inventar no da ventajas gratis: si quiere sacar partido (objetos, dinero, favores, un atajo), pide una tirada o pon un coste. Lo que contradice las leyes del mundo o lo que ya está en los datos se rechaza con ingenio, como lo imposible. Criterio: lo que afirma de sí mismo o de su equipo y los datos contradicen (una daga de plata que no lleva) se niega con una frase, sin sermón. Lo que propone y es plausible (regatear, mentir, colarse, pedir fiado, empeñar) recibe tirada, un precio o un rumor, nunca un «no» seco sin alternativa: si falta quien debe responder, di quién sí podría. Lo imposible por las leyes del mundo, con ingenio.',
    'GANCHOS: lo trivial (moverse entre puntos, salir por una salida, coger o soltar, esperar, llegar a un sitio ya visitado) lo resuelve el servidor sin llamarte. Para que el mundo siga vivo, siembra con plant_hook lo que deba pasar después: alguien que llega a una hora, una consecuencia al acercarse a un sitio o al coger algo. Con mesura: uno o dos por escena como mucho, y nunca para empujar al jugador hacia un secreto.',
    'AGENDA: lo que un NPC anuncia con hora (una misa, un mercado, una reunión, una llegada) prográmalo con schedule_event para que ocurra de verdad: a su hora el servidor trae a la gente y a los NPC, y lo cuenta a quien esté. Para saber qué hay y cuándo, get_schedule. No narres como presente lo que la agenda no tiene en marcha.',
    'IMPARCIALIDAD: sabes cosas que los personajes no saben (secretos, motivaciones). Eres neutral: no guías al jugador hacia ellas, no las insinúas con el ambiente ni con las acciones sugeridas, no premias ni castigas por acercarse. El mundo reacciona a lo que el jugador hace, no a lo que tú sabes.',
    'COMBATE: no hay turnos; es conversación. Un NPC hostil en el mismo punto (o que llega hasta el actor) actúa: resuelve su ataque con attack y narra. El ataque del jugador va con requires_roll kind=attack y requires_roll_target; el servidor tira contra la CA y aplica el daño; tú narras el resultado que te devuelve. Huir es move_to (el enemigo puede perseguir). A 0 PG el PJ cae inconsciente y el servidor tira sus salvaciones contra muerte: tú no las tiras ni decides si muere. MUERTE: un PJ solo muere si attack o apply_damage devuelven died (o el contexto dice MUERTO); nunca narres por tu cuenta que un PJ muere, resucita o vuelve de la muerte: su vuelta la cuenta el servidor. Atender a un caído: stabilize; curarle: heal; descanso que pide la ficción: take_rest; recursos de clase: spend_resource; conjuros: cast_spell (solo los de su lista). Ventana decisiva (decisive_threat): solo con una amenaza real e inmediata contra el actor, nunca dos seguidas; si no responde en 60 s, la amenaza se ejecuta.',
    'PROGRESO: recolectar (harvest) tira solo y cuenta práctica. Los encargos no se aceptan: si un NPC le da uno al actor o le pide algo concreto que hacer, ya es suyo; no le preguntes si acepta ni esperes un «acepto», y hacerlo o no es cosa suya. Uno del tablón queda en su Diario con que lo hablen; cualquier otro, regístralo con give_quest en ese mismo turno (título corto, de qué va, quién lo da, objetivo y recompensa si se dijo), y cuando lo cumpla o ya no se pueda, finish_quest. Los encargos del tablón se cierran con complete_job al entregarlos al NPC que los pidió; los de entrega los valida el servidor. Las pistas se conceden con grant_clue únicamente cuando el jugador las ha obtenido con sus actos. Vender y comprar: sell_item y buy_item con los precios del NPC; el master no negocia fuera de esa lista salvo una tirada de Persuasión que como mucho mueve un 10 %. El contexto solo trae las pistas de este lugar o de quien está delante y los títulos del tablón: si el jugador busca otra pista, pregunta por un encargo o va a entregarlo, consulta get_campaign_notes antes de responder.',
    'NOMBRES: los jugadores de la partida se conocen siempre por su nombre: llámalos por él. De los NPC, el actor solo conoce los nombres marcados como conocidos; a los demás los nombras por lo que se ve (la tabernera, el guardia del portón), también en suggested_actions. El nombre de un NPC se aprende cuando se presenta o alguien lo nombra: entonces va en names_learned.',
    'NPCs: interprétalos según su descripción, lo que quieren y lo que recuerdan. Si el actor habla con uno, pon su ID en npc_id; y solo si esa persona recordaría algo de la conversación, escríbelo en npc_memory_note con su importancia. Un NPC atiende a una persona a la vez: si está ocupado con otro, responde en ficción que espere, salvo motivo de peso.',
    'NPC QUE DECIDEN: lo que un NPC acepta o decide hacer tiene que pasar de verdad. Si acepta acompañar al actor («te sigo», «ve delante»), set_npc_order follow en ese turno; si se va él a otro sitio, set_npc_order go; si además va a hacer algo allí (curar al herido, atenderle, darle algo), ponlo como encargo y lo hace al llegar. Sin eso el servidor lo deja donde está y sigue su horario. Para que deje de acompañar (le despiden, se niega a seguir), set_npc_order stop. Su llegada y su marcha las cuenta el servidor: no las narres.',
    'En log_event: narration_private para el actor; observable para testigos con detalle completo (tercera persona, con nombre); observable_vague para quien solo ve una figura. suggested_actions: 2-4 cosas que ESTE personaje querría hacer AHORA MISMO, en esta situación concreta y desde donde está: reacciones inmediatas a lo que acaba de pasar, no planes ni siguientes pasos de la historia. En infinitivo y breves ("Registrar el cofre", "Preguntar a Brenna por el incendio", "Guardar las bayas").',
    'HABLAR CON OTRO JUGADOR: «hablar con X» sin frase es una intención, no algo dicho: no inventes lo que dice ni lo pongas en lines; acércalo si hace falta y pregunta qué le dice. Lo que los jugadores se dicen entre ellos llega sin ti (modo Decir).',
    'DIÁLOGO: si alguien habla en voz alta en esta acción (un NPC o el propio actor), copia cada parlamento literal, en orden, en lines ({speaker: "npc" con su npc_id, o "actor"; text: solo las palabras dichas, sin comillas ni acotaciones}). Si el actor habla o pregunta, su frase va en lines como "actor", con sus palabras en primera persona. En narration_private las palabras dichas aparecen SOLO como esas mismas citas literales entre «»: nunca en estilo indirecto, resumidas ni parafraseadas; el resto de la narración es lo no verbal (gestos, acciones, ambiente, silencios). Bien: «¿Qué es el círculo vacío?», preguntas. Marisa apoya un dedo sobre el carbón. «Lo que aún no me has pagado.» Vuelve a su paño. Mal: Preguntas a la posadera por el círculo. Marisa te explica que es tu deuda. Sin diálogo, lines = null.',
    'CONVERSACIÓN: si el contexto dice «En conversación con…», el turno es lo que dice el actor y lo que le responden, en lines. narration_private se limita a UNA de estas cosas, o va vacía (""): (a) la primera vez que ese personaje habla en la conversación, una frase que lo presenta; (b) una acción concreta y visible suya o de alguien presente que cambia la escena; (c) algo relevante para el jugador (una amenaza, una oportunidad, un cambio de actitud). Nunca ambiente de relleno ni gestos repetidos (el paño, la jarra, la mirada, encogerse de hombros). Si no hay nada de eso, narration_private vacía y solo lines. Cuando la narración presenta un parlamento, termina presentando a quien habla y con dos puntos («Adiel deja la jarra y se vuelve hacia ti:»), sin citar lo que dice: eso va en lines, y tras las líneas del actor la primera es la de ese personaje. Como mucho 40 palabras sin contar lo dicho. Fuera de conversación, la longitud de siempre.',
    '',
    RULES_CHEATSHEET,
  ].filter((l) => l !== undefined).join('\n');
}

export interface RollContext {
  original_text: string;
  result: CheckResult & { label: string };
}

/** Contexto dinámico de la acción. Va en el mensaje de usuario, después del prefijo cacheado. */
export type Scene = 'arrival' | 'decisive_timeout' | 'hook';
/** Cómo respondió el jugador a una ventana decisiva (SPEC §9.3). */
export interface DecisiveResponse { seconds: number; speed: 'fast' | 'normal'; threat: string }

/** Eventos recientes en el contexto: cuántos, cuántos van íntegros al final y a cuánto se recortan los anteriores. */
export const RECENT_EVENTS = 6;
/** Tope de lugares desconocidos que se listan en el contexto para que el máster pueda revelarlos. */
export const UNKNOWN_PLACES_MAX = 12;
export const RECENT_FULL = 2;
export const OLD_EVENT_CHARS = 200;
/** Volumen con el que se buscan testigos: el máximo de log_event (estruendo), para no quitarle el observable a nadie que pudiera percibirlo. */
const WITNESS_LOUDNESS = 15;
export const NO_WITNESSES = 'No hay testigos: observable y observable_vague van a null.';

function dot(s: string): string {
  const t = s.trim();
  return /[.!?…»"]$/.test(t) ? t : `${t}.`;
}

/** Recorta a unos `max` caracteres por un espacio, en una sola línea, con "…". */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** Lo que el actor tiene con otros jugadores: a quién sigue, quién le ayuda y qué le han ofrecido (party.ts). */
/** Caído o estable: lo que el máster debe saber (y no decidir). */
function downLine(c: Character): string {
  if (isDying(c)) return ` A 0 PG, CAYENDO: salvaciones contra muerte ${c.dying!.success} éxitos / ${c.dying!.fail} fallos (las tira el servidor). Se le puede estabilizar (stabilize) o curar (heal).`;
  if (isStable(c)) return ` A 0 PG, ESTABLE: inconsciente; recobra 1 PG${c.dying?.stable_until_game_s ? ` hacia las ${hhmm(c.dying.stable_until_game_s)}` : ' en unas horas'}.`;
  return '';
}

function partyLines(engine: Engine, actor: Character, nowG: number): string[] {
  const w = engine.world;
  const name = (id: Id) => { const o = w.characters.get(id); return o ? pcName(w, actor.id, o) : id; };
  const out: string[] = [];
  if (actor.following) out.push(`Sigue a ${name(actor.following)} en cada desplazamiento (el servidor lo mueve; «dejar de seguir» lo suelta).`);
  if (actor.helped_by && actor.helped_by.expires_game_s >= nowG) out.push(`Cuenta con la ayuda de ${name(actor.helped_by.character_id)}: su próxima tirada va con ventaja (la aplica el servidor).`);
  for (const o of offersOf(actor, Date.now())) out.push(`${name(o.from_id)} le ofrece ${o.label}: es suyo solo si lo acepta con el botón (no lo des por aceptado).`);
  for (const r of actor.reactions ?? []) out.push(`${name(r.from_id)} intenta ${r.attempt}: decide con los botones si se deja o se resiste (no lo des por hecho).`);
  const asked = pendingFrom(w, actor.id);
  if (asked) out.push(`Espera a que ${name(asked.to.id)} decida si se deja (${asked.reaction.attempt}): aún no ha pasado.`);
  return out;
}

/** Cuántas cosas de los otros jugadores entran en su bloque (las últimas). */
export const OTHERS_RECENT = 6;
const OTHERS_CHARS = 400;

/**
 * Lo que han hecho los demás jugadores de la localización desde la última
 * acción del actor (íntegro, sin el ruido de «Últimos eventos») y lo que han
 * mandado y espera en la cola detrás de él. Con dos jugadores en la misma
 * escena, el máster responde sabiendo lo que el otro acaba de hacer y no
 * contesta fuera de contexto. null si no hay nada.
 */
export function othersBlock(engine: Engine, actor: Character, locationId: Id): string | null {
  const w = engine.world;
  const isOther = (id: Id | null) => id !== null && id !== actor.id && w.characters.has(id);
  const name = (id: Id) => pcName(w, actor.id, w.character(id));
  const events = engine.events.recentInLocation(locationId, 60);
  // Desde la última acción del actor (suya o un turno compartido en el que estaba).
  const inputs = (e: GameEvent) => e.payload['group_inputs'] as Record<Id, string> | undefined;
  const lastOwn = [...events].reverse().find((e) => (e.actor_id === actor.id && e.input_text) || inputs(e)?.[actor.id]);
  const done: string[] = [];
  for (const e of events) {
    if (lastOwn && e.seq <= lastOwn.seq) continue;
    if (!isOther(e.actor_id) || inputs(e)?.[actor.id]) continue;
    const d = e.delivered_to.find((x) => x.character_id === actor.id);
    const seen = d ? readerText(w, e, actor.id, d.level) : null;
    if (!seen && !e.input_text) continue;
    const said = e.input_text && !e.input_text.startsWith('(') ? `«${clip(e.input_text, 160)}»` : '';
    done.push(`- ${name(e.actor_id!)}${said ? ` mandó ${said}` : ''}${seen ? ` → lo que percibió el actor: ${clip(seen, OTHERS_CHARS)}` : ' (el actor no lo percibió)'}`);
  }
  const queued = engine.waitingIn(locationId).filter((q) => isOther(q.character_id))
    .map((q) => `- ${name(q.character_id)} acaba de mandar, a la vez: «${clip(q.text, 160)}». Se resuelve justo después de esta acción: no la narres ni la des por hecha, pero tenla en cuenta (si va con lo del actor, no le pidas que aclare lo que el otro ya ha dicho).`);
  if (!done.length && !queued.length) return null;
  return [
    '## Los otros jugadores aquí, desde la última acción del actor',
    ...done.slice(-OTHERS_RECENT),
    ...queued,
    'Responde a la acción del actor sabiendo esto: es la misma escena y lo leen los presentes. No vuelvas a narrar lo que ya se resolvió para ellos.',
  ].join('\n');
}

/** Una pista sin anclas va siempre; con anclas, solo en su localización o con uno de sus NPCs delante. */
function clueIsHere(c: Clue, locationId: Id, npcIds: Id[]): boolean {
  if (!c.location_ids?.length && !c.npc_ids?.length) return true;
  return (c.location_ids ?? []).includes(locationId) || (c.npc_ids ?? []).some((id) => npcIds.includes(id));
}

/** Pistas sin obtener: las de aquí con su "cómo"; las demás, solo contadas (detalle con get_campaign_notes). */
function cluesBlock(pending: Clue[], locationId: Id, npcIds: Id[]): string[] {
  const here = pending.filter((c) => clueIsHere(c, locationId, npcIds));
  const rest = pending.length - here.length;
  return [
    ...(here.length ? ['Pistas de aquí (secretas, nunca las insinúes; grant_clue SOLO cuando el jugador la obtenga de verdad):', ...here.map((x) => `- ${x.title} [${x.id}]: ${x.how}`)] : []),
    ...(rest ? [`Otras ${rest} pista${rest > 1 ? 's' : ''} sin obtener, de otros sitios (get_campaign_notes).`] : []),
  ];
}

/** Categoría de la tirada por su margen (closecheck.ts) con lo que significa, en una línea. */
function rollLine(r: CheckResult): string {
  const cat = rollCategory(r);
  return cat ? `\nCategoría: ${ROLL_CATEGORY[cat].label.toUpperCase()}${r.dc !== null ? ` (margen ${r.total - r.dc >= 0 ? '+' : ''}${r.total - r.dc})` : ''}: ${ROLL_CATEGORY[cat].rule}` : '';
}

/**
 * Dónde vive un NPC (`home_spot_id`, de los datos) si no es aquí, y por dónde se va desde aquí. Sin esto el
 * máster se inventa la casa: «la casa de Ilse en el Soto», cuando está al fondo del callejón (partida del 27-10, seq 27–30).
 */
export function homeLine(world: World, n: Npc, hereLocId: Id): string {
  const home = n.home_spot_id ? world.spots.get(n.home_spot_id) : undefined;
  if (!home || home.location_id === hereLocId) return '';
  const via = world.spotsOf(hereLocId).find((s) => world.exitsFrom(s.id).some((x) => world.spot(x.to_spot_id).location_id === home.location_id));
  return ` Vive en ${world.location(home.location_id).name}${via ? ` (desde aquí, por ${via.name})` : ''}.`;
}

/**
 * El actor va por delante del mundo (ha dormido o viajado: travel.ts): la gente, los horarios y los ruidos son de la
 * hora del mundo. Sin esto el máster contaba «ocho horas después» con la cena aún en marcha (partida del 27-10, seq 98–106).
 */
function aheadText(engine: Engine, actor: Character): string {
  const g = engine.gameNow();
  if (aheadBy(actor, g) < AHEAD_NOTICE_S) return '';
  return `\nVA POR DELANTE DEL MUNDO: esa es su hora, pero para todos los demás son las ${hhmm(g)}. Los NPC, los horarios y los ruidos son de las ${hhmm(g)}: la gente sigue en lo que hacía a esa hora (para ellos no ha pasado la noche). No narres que el pueblo duerme ni que han pasado horas para nadie más que el actor; si lo nota, es que va adelantado, y el mundo le alcanza solo.`;
}

function boardLine(jobs: string[]): string {
  return jobs.length ? `Tablón: ${jobs.join(' · ')}.` : 'Tablón: vacío.';
}

export function actionContext(engine: Engine, actor: Character, text: string, roll?: RollContext, intro?: { origin: string; welcome: string; prologue?: string }, scene?: Scene, decisive?: DecisiveResponse): string {
  const world = engine.world;
  const nowG = engine.nowFor(actor); // la hora del actor: la del mundo, o la de su llegada si ha viajado (travel.ts)
  const pos = positionOf(world, actor, nowG);
  const loc = world.location(pos.location_id);
  const spot = world.spot(pos.spot_id);
  const L: string[] = [];

  L.push(`## Tiempo\n${engine.clock.format(nowG)}. Luz: ${lightAt(engine.clock, loc, nowG)}. 1 h real = 3 h de juego.${aheadText(engine, actor)}`);

  // La luz real ya va en Tiempo; el estado solo si hay algo.
  L.push(`## Localización: ${loc.name} (${loc.id})\n${loc.description_base}\nAmbiente: ruido ${loc.ambience.noise}${loc.ambience.smell ? `, olor a ${loc.ambience.smell}` : ''}.${Object.keys(loc.state).length ? ` Estado: ${JSON.stringify(loc.state)}` : ''}`);
  const spots = world.spotsOf(loc.id).filter((s) => !s.hidden || s.discovered_by.includes(actor.id));
  L.push('Puntos:\n' + spots.map((s) => {
    const items = world.itemsIn({ type: 'spot', id: s.id }).map((i) => `${world.itemDef(i.item_id).name}${i.quantity > 1 ? ` ×${i.quantity}` : ''} [${i.id}]`);
    const nodes = [...world.resourceNodes.values()].filter((n) => n.spot_id === s.id).map((n) => `${n.name} ${Math.round(regenState(n, nowG) * 100)}% [${n.id}]`);
    const d = Math.round(Math.hypot(s.x - pos.x, s.y - pos.y));
    // Cerrojo (movement.ts): en palabras, no como JSON.
    const { locked, key_item_id, unlocked_for, ...rest } = s.state;
    void unlocked_for;
    const key = typeof key_item_id === 'string' ? world.itemDefs.get(key_item_id)?.name ?? key_item_id : null;
    const lock = locked !== true ? '' : spotLockedFor(world, s, actor) ? ` Cerrado con llave${key ? ` (${key})` : ''}: el actor no puede entrar sin ella.` : ' Cerrado con llave, pero el actor puede entrar (tiene la llave o lo ha pagado).';
    const st = (Object.keys(rest).length ? ` estado ${JSON.stringify(rest)}` : '') + lock;
    return `- ${s.name} [${s.id}]${s.id === spot.id ? ' ← actor aquí' : ` a ${d} m`}: ${s.description}${st}${items.length ? ` Objetos: ${items.join(', ')}.` : ''}${nodes.length ? ` Recursos: ${nodes.join(', ')}.` : ''}`;
  }).join('\n'));
  const exits: string[] = [];
  for (const s of world.spotsOf(loc.id)) for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
    exits.push(`- desde ${s.name} a ${world.locationOfSpot(to_spot_id).name} [${to_spot_id}], ${exit.distance_m} m${exit.state.blocked_by ? `, bloqueada (${exit.state.blocked_by})${reboundOf(exit) ? ': no se cruza; si el actor lo intenta, move_to hacia allí y el motor le hace volver por donde entró' : ''}` : ''}`);
  }
  if (exits.length) L.push('Salidas:\n' + exits.join('\n'));
  // Lugares de la región que el actor no conoce aún y nadie le ha mostrado: el máster los revela con places_learned.
  const exitDests = new Set(world.spotsOf(loc.id).flatMap((s) => world.exitsFrom(s.id).map(({ to_spot_id }) => world.locationOfSpot(to_spot_id).id)));
  const regionId = world.zones.get(loc.zone_id)?.region_id;
  const unknown = [...world.locations.values()]
    .filter((l) => l.id !== loc.id && !exitDests.has(l.id) && world.zones.get(l.zone_id)?.region_id === regionId)
    .filter((l) => { const d = l.discovery[actor.id]; return d !== 'visited' && d !== 'heard_of'; })
    .slice(0, UNKNOWN_PLACES_MAX);
  if (unknown.length) L.push('Lugares de la región que el actor aún no conoce (si alguien los nombra en la ficción, ponlos en places_learned): ' + unknown.map((l) => `${l.name} [${l.id}] (${world.zones.get(l.zone_id)?.name ?? l.zone_id})`).join(', '));

  const present: string[] = [];
  const presentNpcIds: Id[] = [];
  for (const o of world.characters.values()) {
    if (o.id === actor.id || o.status === 'dead' || o.status === 'retired') continue;
    const op = positionOf(world, o, nowG);
    if (op.location_id !== loc.id) continue;
    const p = perceive(world, engine.clock, actor, op, nowG);
    if (p.level === 'none') continue;
    // Los PJ de una partida se conocen siempre por su nombre: presentarse es solo cosa de NPC.
    const name = p.sight === 'full' ? `${o.name} [${o.id}], ${o.race} ${o.class_name}${o.appearance ? `, ${o.appearance}` : ''}` : p.sight === 'vague' ? `una figura (${o.name} [${o.id}])` : 'movimiento';
    // Ausente (su jugador se ha ido) y, a los 30 min, bajo el velo (SPEC §9.1).
    const away = o.veiled ? ' BAJO EL VELO: no es objetivo válido; si alguien va a por él, narra que se aparta o se esconde.'
      : o.away ? ` AUSENTE: no ataca ni gasta recursos; si le atacan se defiende solo (CA y salvaciones normales)${o.status === 'unconscious' ? '; está a 0 PG, estabilizado' : ''}.` : '';
    present.push(`- ${name} en ${world.spot(op.spot_id).name}, ${Math.round(p.distance_m ?? 0)} m, percepción ${p.level} (vista ${p.sight}, oído ${p.sound})${o.status === 'asleep' ? ', dormido' : ''}${o.transit ? ', en movimiento' : ''}. JUGADOR: no narres sus actos, palabras, gestos ni intenciones; solo lo que ya consta en los eventos.${away}${downLine(o)}${o.following === actor.id ? ' Sigue al actor allá donde va.' : ''}`);
  }
  // Muertos y sus cuerpos: no se levantan por narración.
  for (const sp of world.spotsOf(loc.id)) {
    for (const b of bodiesAt(world, sp.id)) {
      const st = bodyStateOf(b)!;
      const owner = world.characters.get(st.owner_id);
      if (!owner) continue;
      const dead = owner.status === 'dead';
      present.push(`- ${world.itemDef(b.item_id).name} [${b.id}] en ${sp.name}: ${dead ? `${owner.name} está MUERTO (modo ${st.mode}); vuelve solo, por el servidor; no narres que se levanta ni que resucita.` : `lo que ${owner.name} dejó al morir (ya ha vuelto).`} ${st.mode === 'casual' ? `Solo ${owner.name} puede coger lo que hay dentro.` : 'Cualquiera puede saquearlo.'}`);
    }
    // NPC muertos: el cuerpo sigue ahí hasta que alguien se lo lleve; los vivos lo ven y reaccionan.
    for (const n of deadNpcsAt(world, sp.id)) {
      const d = n.death;
      const label = actor.knows.includes(n.id) ? n.name : descriptorOf(world, n.id);
      present.push(`- El cuerpo de ${label} [${n.id}] en ${sp.name}: MUERTO${d ? ` desde las ${hhmm(d.died_game_s)}${d.by_name ? `, a manos de ${d.by_name}` : ''}` : ''}. No se levanta, no habla y no desaparece; quien esté y lo vea reacciona (miedo, rabia, avisar a alguien). Lo que llevaba está en el suelo.`);
    }
  }
  for (const n of world.npcs.values()) {
    const ns = world.spot(n.location.id);
    if (ns.location_id !== loc.id || n.status !== 'alive') continue;
    const p = perceive(world, engine.clock, actor, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowG);
    if (p.level === 'none') continue;
    presentNpcIds.push(n.id);
    if (p.sight !== 'full') { present.push(`- NPC: una figura en ${ns.name}, ${Math.round(p.distance_m ?? 0)} m, percepción ${p.level}`); continue; }
    const mine = n.memory.filter((m) => m.character_id === actor.id).slice(-5).map((m) => `${m.note}`);
    // De otros personajes solo lo que no se olvida nunca; el resto, con get_npc.
    const others = n.memory.filter((m) => m.character_id !== actor.id && m.importance >= 3).slice(-3).map((m) => `${world.characters.get(m.character_id)?.name ?? 'alguien'}: ${m.note}`);
    const busy = n.talking_to && n.talking_to.character_id !== actor.id ? ` OCUPADO hablando con ${world.characters.get(n.talking_to.character_id)?.name ?? 'alguien'}: atiende al actor solo si hay motivo, si no le pide que espere. No sugieras esperar ni unirse: eso lo ofrece el servidor.` : '';
    const knownNpc = actor.knows.includes(n.id);
    // Lo que vio o sabe del actor (crime.ts) va antes que su carácter: manda sobre cómo le trata.
    const crime = npcCrimeLine(world, n, actor, nowG);
    present.push([
      `- NPC ${knownNpc ? `${n.name} [${n.id}], ${n.role}` : `${descriptorOf(world, n.id)} [${n.id}] (el actor NO sabe su nombre, que es ${n.name}: llámala por lo que se ve; si se presenta o alguien la nombra, ponlo en names_learned)`}, en ${ns.name}, ${Math.round(p.distance_m ?? 0)} m${ns.id !== spot.id ? ` (fuera de alcance: move_to ${ns.id} para hablarle de cerca)` : ''}.${crime ? `\n  ${crime}\n ` : ''} ${n.description}`,
      `  Quiere: ${dot(n.motivation)}${homeLine(world, n, loc.id)} Actitud: ${attitudeOf(n, actor.id)}.${n.stats ? ` Combate: CA ${n.stats.ac}, PG ${n.stats.hp}/${n.stats.hp_max}, ${n.stats.attack_name} +${n.stats.attack_bonus} (${n.stats.damage}).` : ' No combate.'}`,
      n.buys.length ? `  Compra: ${n.buys.map((b) => `${world.itemDef(b.item_id).name} a ${money(world, b.price)}`).join(', ')}` : '',
      n.sells.length ? `  Vende: ${n.sells.map((b) => `${world.itemDef(b.item_id).name} [${b.item_id}] a ${money(world, b.price)}`).join(', ')}` : '',
      carriedBy(world, n.id),
      saidBy(engine.events.recentInLocation(loc.id, 60), n.id),
      n.secret ? `  Solo tú sabes (NUNCA lo reveles ni lo insinúes por tu cuenta): ${dot(n.secret)} Sale solo a medias y si se lo gana: confianza en varias charlas, presión creíble o tirada social contra CD alta.` : '',
      `  Recuerda de ${actor.name}: ${mine.length ? mine.join(' · ') : 'nada, es la primera vez que hablan'}`,
      others.length ? `  Recuerda de otros: ${others.join(' · ')}` : '',
      busy,
      orderLine(world, n, nowG) ? `  Ahora: ${orderLine(world, n, nowG)}.` : '',
    ].filter(Boolean).join('\n'));
  }
  // Testigos: otros PJs que percibirían al actor aunque gritara. Sin ninguno, observable no le llega a nadie y es salida tirada.
  if (!witnesses(world, engine.clock, pos, nowG, WITNESS_LOUDNESS, actor.id).length) present.push(NO_WITNESSES);
  L.push('## Presentes que el actor percibe\n' + (present.length ? present.join('\n') : 'Nadie.'));
  // Crimen y ley (crime.ts): el incidente que hay que contar, y si el actor está buscado, detenido o preso.
  const law = crimeContext(world, actor, nowG);
  if (law) L.push(law);
  // Quién oye lo que dice el actor (otros jugadores): el NPC puede notarlo (bajar la voz, callarse, mirarlos), sin narrar lo que hacen ellos.
  const ears = witnesses(world, engine.clock, positionOf(world, actor, nowG), nowG, 1, actor.id)
    .filter((w) => w.perceived.sound !== 'none' && w.perceived.sound !== 'hint')
    .map((w) => `${w.character.name} (${w.perceived.sound === 'full' ? 'lo oye todo' : 'oye trozos'}${w.character.away ? ', ausente' : ''})`);
  if (ears.length) L.push(`## Quién oye al actor\n${ears.join('; ')}. El NPC con quien habla puede notarlo y reaccionar; no narres lo que hacen ellos.`);

  const inv = inventoryView(world, actor.id);
  const skills = Object.keys(SKILLS).filter((k) => actor.proficiencies.skills.includes(k) || actor.proficiencies.expert.includes(k)).map((k) => SKILLS[k]!.es);
  L.push([
    `## Actor: ${actor.name} [${actor.id}]`,
    `${actor.race} ${actor.class_name} nivel ${actor.level}. PG ${actor.hp_current}/${actor.hp_max}${actor.hp_temp ? ` (+${actor.hp_temp} temp)` : ''}. CA ${armorClass(world, actor)}. Estado: ${actor.status}${actor.conditions.length ? `; condiciones: ${actor.conditions.map((x) => x.name).join(', ')}` : ''}.${downLine(actor)} Modo de muerte: ${actor.death_mode}.`,
    `Dados de golpe: ${hitDiceLeft(actor)}/${actor.level} (d${actor.hit_die}).${resourceLines(actor).length ? ` Recursos (spend_resource; espacios con cast_spell): ${resourceLines(actor).join('; ')}.` : ''}`,
    ...abilitiesForMaster(actor),
    `FUE ${actor.abilities.str} DES ${actor.abilities.dex} CON ${actor.abilities.con} INT ${actor.abilities.int} SAB ${actor.abilities.wis} CAR ${actor.abilities.cha}. Competente en: ${skills.join(', ') || 'nada'}.`,
    actor.appearance ? `Aspecto: ${actor.appearance}` : '',
    actor.backstory ? `Historia: ${actor.backstory}` : '',
    characterFacts(actor).length ? `Ha contado de sí (verdad para su personaje, no para el mundo; record_character_fact): ${characterFacts(actor).slice(-FACTS_IN_CONTEXT).map((f) => dot(f.text)).join(' ')}` : '',
    `Manos: ${inv.hands.main ?? '—'} / ${inv.hands.off ?? '—'}. Monedas: ${money(world, inv.coins)} (= ${inv.coins} de ${currencyOf(world.campaign).at(-1)!.name}; los amount de los tools van en esa moneda). Carga: ${inv.encumbrance.level}.`,
    openDebts(actor).length ? `Deudas (set_debt, pawn_item, settle_debt; lo que no esté aquí no se debe):\n${openDebts(actor).map((d) => `- ${debtLine(world, d, nowG, (n) => n.name, true)}. Motivo: ${d.reason}.`).join('\n')}` : '',
    'Inventario (IDs para transfer_item):\n' + (inventoryDetailed(world, actor.id).map((i) => `- ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''} [${i.instance_id}] (${i.where})`).join('\n') || '- nada'),
    actor.transit ? `En camino hacia ${world.spot(actor.transit.destination_spot_id).name}.` : '',
    ...partyLines(engine, actor, nowG),
  ].filter(Boolean).join('\n'));

  const camp = world.campaign;
  const ach = camp.achievement;
  const rep = actor.reputation[ach.faction_id] ?? 0;
  L.push([
    `## Brezal: reputación, pistas y tablón`,
    `Reputación con ${camp.factions.find((f) => f.id === ach.faction_id)?.name ?? ach.faction_id}: ${rep} (logro «${ach.title}»: ${ach.clues_required} pistas y ${ach.reputation_required} de reputación${actor.achievements.some((a) => a.id === ach.id) ? '; YA CONSEGUIDO' : ''}).`,
    `Pistas del actor: ${actor.clues.length ? actor.clues.map((id) => camp.clues.find((x) => x.id === id)?.title ?? id).join('; ') : 'ninguna'}.`,
    ...cluesBlock(camp.clues.filter((x) => !actor.clues.includes(x.id)), loc.id, presentNpcIds),
    boardLine(activeJobs(world).map((j) => `${j.title} [${j.id}]${actor.completed_jobs.includes(j.id) ? ' (ya hecho)' : ''}`)),
  ].join('\n'));

  // Los dos últimos íntegros (la continuidad inmediata); los anteriores, recortados. Más atrás: get_recent_events.
  const recent = engine.events.forCharacter(actor.id, null).slice(-RECENT_EVENTS);
  const today = Math.floor(nowG / 86400);
  L.push('## Últimos eventos que el actor ha percibido\n' + (recent.length ? recent.map((d, i) => {
    const ts = d.event.timestamp_game_s;
    const when = Math.floor(ts / 86400) === today ? engine.clock.format(ts).slice(-5) : engine.clock.format(ts);
    return `- [${when}] ${i < recent.length - RECENT_FULL ? clip(d.text, OLD_EVENT_CHARS) : d.text}`;
  }).join('\n') : 'Ninguno.'));
  const others = intro ? null : othersBlock(engine, actor, loc.id);
  if (others) L.push(others);

  // Conversación en curso (conversation.ts): el narrador solo entra cuando aporta.
  const conv = intro || scene ? null : conversationOf(engine.events.all(), actor.id, pos);
  const convNpc = conv ? world.npcs.get(conv.npc_id) : undefined;
  if (conv && convNpc) L.push(conversationBlock(conv, actor.knows.includes(convNpc.id) ? convNpc.name : descriptorOf(world, convNpc.id)));

  if (intro) {
    L.push([
      '## Primera escena',
      `${actor.name} acaba de entrar en la partida. Origen: ${intro.origin}`,
      intro.prologue
        // Prólogo (docs/PROLOGO.md): el mundo, el sitio, el porqué y la amenaza ya están contados.
        ? `Acaba de leer este prólogo: «${intro.prologue.replace(/\s+/g, ' ')}». No repitas nada de él: ni el mundo, ni por qué está aquí, ni la amenaza ni el plazo, ni la descripción del sitio. Empieza en el instante siguiente, con tono serio y concreto.`
        : `Acaba de leer esta bienvenida, en tono místico: «${intro.welcome.replace(/\s+/g, ' ')}». No repitas sus imágenes ni sus ideas: empieza donde eso termina, con tono serio y concreto.`,
      'Quien lee no conoce todavía este mundo ni sus nombres, y quiere jugar YA. Por eso: nada de dichos, refranes, leyendas ni nombres de lugares como apertura. La primera frase es algo que le está pasando al personaje en este instante, en el cuerpo o en los sentidos (frío, hambre, un ruido, un olor, algo que ve moverse). Los nombres de sitios aparecen solo cuando importan y explicados por lo que son, no por lo que se cuenta de ellos.',
      intro.prologue
        ? 'Un detalle concreto de lo que tiene delante (luz, quién anda por ahí) y un gancho: algo que acaba de ocurrir o está ocurriendo delante de él y que pide una decisión ahora mismo.'
        : 'Sitúalo donde está tal como está ahora (luz, quién anda por ahí) con dos o tres detalles concretos, no un inventario. Termina con un gancho: algo que acaba de ocurrir o está ocurriendo delante de él y que pide una decisión ahora mismo. La premisa de la campaña puede asomar en ese gancho, nunca explicada.',
      intro.prologue
        ? 'Un solo párrafo corto, 50 palabras como máximo. Sin tirada. Con 3-4 acciones sugeridas, concretas y con verbo. No lo hagas actuar ni hablar; solo llega.'
        : 'Exactamente dos párrafos cortos, 80 palabras en total como máximo. Sin tirada. Con 3-4 acciones sugeridas, concretas y con verbo. No lo hagas actuar ni hablar; solo llega.',
    ].join('\n'));
  } else if (scene === 'decisive_timeout') {
    L.push([
      '## Ventana decisiva expirada',
      actor.away
        ? `${actor.name} está AUSENTE (su jugador se ha ido) y la amenaza «${actor.decisive?.threat ?? 'la amenaza'}» llega igual: se resuelve, pero su personaje SE DEFIENDE (esquiva o para con su CA y salvaciones normales); no queda indefenso, ni contraataca ni gasta recursos. Si cae a 0 PG, queda estabilizado.`
        : `${actor.name} NO respondió a tiempo a: «${actor.decisive?.threat ?? 'la amenaza'}». La amenaza se ejecuta contra él sin que actúe (SPEC: no responder es perder de verdad).`,
      actor.decisive?.npc_id ? `Usa attack con attacker_id=${actor.decisive.npc_id} y target_id=${actor.id}.` : 'Aplica el daño o la consecuencia con apply_damage o el tool que corresponda.',
      'Narra el resultado en un párrafo corto. Sin tirada del jugador. No abras otra ventana decisiva. Con 2-3 acciones sugeridas para lo que viene ahora.',
    ].join('\n'));
  } else if (scene === 'arrival') {
    L.push([
      '## Llegada',
      `${actor.name} acaba de llegar a ${spot.name} (${loc.name}) tras un desplazamiento. No es una acción suya: sitúalo.`,
      'En un párrafo corto, dos como mucho: qué tiene delante ahora mismo, quién anda por aquí y qué destaca. Concreto y con los pies en el suelo; nada de resúmenes ni de repetir lo que ya sabía. Sin tirada. Con 3-4 acciones sugeridas que se puedan hacer desde este punto. No lo hagas actuar ni hablar.',
    ].join('\n'));
  } else if (scene === 'hook') {
    L.push([
      '## Algo ocurre',
      `Sin que ${actor.name} haga nada, salta lo que sembraste (abajo, en «Gancho que salta ahora»). No es una acción suya: haz que ocurra delante de él.`,
      'Un párrafo corto. Ejecuta los cambios con tools si los hay. Sin tirada del jugador. Con 2-3 acciones sugeridas para reaccionar.',
    ].join('\n'));
  } else if (roll) {
    L.push(`## Resultado de la tirada\nAcción original: «${roll.original_text}»\n${roll.result.label}: ${roll.result.breakdown} → ${roll.result.success === null ? 'sin CD' : roll.result.success ? 'ÉXITO' : 'FALLO'}${roll.result.natural ? ` (${roll.result.natural} natural)` : ''}.${rollLine(roll.result)}\nNarra la consecuencia y aplica los cambios con tools. No pidas otra tirada para esta misma acción.`);
  } else if (engine.sceneHints(actor.id)?.round || engine.sceneHints(actor.id)?.group) {
    // Turno compartido: lo de cada uno va en su bloque (Ronda o Conversación de grupo), no como acción del actor.
    L.push(`## Turno compartido\nLo ha mandado más de un jugador a la vez (abajo, cada uno con lo suyo). El bloque «Actor» es solo el primero que actuó: no le hables a él como si fuera el único; las fichas de los demás, con get_character.`);
  } else {
    const toPc = namedPc(world, actor, text);
    const toOther = toPc && !namedNpc(world, actor, text)
      ? `\nVa dirigida a ${pcName(world, actor.id, toPc)} [${toPc.id}], otro JUGADOR presente, no a ningún NPC: el NPC con quien hablaba no contesta por él ni se da por aludido; lo que responda ${pcName(world, actor.id, toPc)} lo escribe su jugador. Narra solo lo que hace o dice el actor y, si toca, cómo reacciona la sala.`
      : '';
    L.push(`## Acción del jugador\n«${text}»${toOther}${decisive ? `\nRespondió a la ventana decisiva («${decisive.threat}») en ${decisive.seconds} s: ${decisive.speed === 'fast' ? 'RÁPIDA → actúa antes de que la amenaza se resuelva; si pides tirada, el servidor le dará ventaja' : 'normal → su acción y la amenaza se resuelven a la vez; decide el dado'}.` : ''}`);
  }

  // Ganchos e imprevisto que el motor pone delante en esta llamada (hooks.ts, fastpath.ts).
  const hints = engine.sceneHints(actor.id);
  // Un gancho escrito de antemano no sabe lo que acaba de pasar aquí: si hay un incidente reciente, manda el incidente (crime.ts).
  const crimeHere = hints?.hooks.length ? recentIncidents(world, loc.id, nowG) : [];
  if (hints?.hooks.length) L.push(`## Gancho que salta ahora\n${hints.hooks.map((h) => `- ${h.what}`).join('\n')}\nHazlo ocurrir ahora, encajado con lo que hace el actor (puedes interrumpir su movimiento o dejar la acción a medias). Ya está consumido: no lo repitas.${crimeHere.length ? `\nOJO: aquí acaba de pasar algo (ver «Incidente» y «LO PRIMERO» de cada NPC). El gancho se adapta a eso: quien llega ve lo que ha pasado (el cuerpo, la sangre, la gente alterada) y reacciona según quién es; la autoridad pregunta y detiene, no pide una cerveza como si nada. Si el gancho ya no encaja, cuéntalo cambiado o déjalo para otro momento.` : ''}`);
  if (hints?.encounter) L.push('## Imprevisto\nHa salido la tirada de imprevisto del servidor: mientras el actor hace esto pasa algo que no buscaba (alguien llega o se va, un ruido, un animal, un cambio de luz o de tiempo), acorde al lugar y la hora. Pequeño y concreto; combate solo si encaja. Resuelve también la acción.');
  if (hints?.travel) L.push(travelBlock(world, engine.clock, hints.travel));
  if (hints?.errand) {
    L.push([
      '## Viaje ya hecho',
      `El servidor ya ha traído a ${actor.name} hasta ${spot.name} (${loc.name}): «${hints.errand.line}». No uses move_to para venir.${hints.errand.first_visit ? ' Es la primera vez que pisa este sitio: dibújalo en una o dos frases.' : ''}`,
      `Lo que venía a hacer: «${hints.errand.action}». En UNA sola narración: la llegada en una frase y, sin cortar, esa acción resuelta aquí con los tools que haga falta. No le preguntes qué quiere hacer.`,
      hints.errand.obstacle ? `Puede que no lo consiga: ${hints.errand.obstacle}. Decide tú si se lo impide. Si no, hazla sin más. Si sí, cuéntalo en la narración, en ficción y con el motivo concreto («No llegas a sacar el agua: …»), y no la des por hecha.` : '',
    ].filter(Boolean).join('\n'));
  }
  if (hints?.rest) L.push(`## Descanso interrumpido\nEl actor ${hints.rest.kind === 'long' ? 'dormía' : 'descansaba'} y algo le despierta (ya se le ha dicho: «${hints.rest.teaser}»). Lo que pasa, para ti: ${hints.rest.what}. Narra lo que encuentra al despertar; el descanso ya está cortado y el tiempo ya ha pasado.`);
  if (hints?.group) {
    const n = world.npcs.get(hints.group.npc_id);
    L.push([`## Conversación de grupo con ${n?.name ?? hints.group.npc_id}: responde UNA vez a todos`,
      ...hints.group.members.map((m) => `- ${m.name} [${m.id}]: ${m.text}`),
      'Un solo cierre para todos. narration_private la leen todos los que hablan: en segunda persona del plural («os mira») o nombrando a cada uno; nunca «tú» a secas. En lines, lo que dice cada uno: speaker "pc" con su character_id (sus palabras, en primera persona; no añadas nada que no hayan dicho) y la respuesta del NPC con to = ID del PJ al que contesta cada frase. Cada uno recibe respuesta a lo suyo. Lo que un jugador le dice a otro jugador (no al NPC) no lo contesta el NPC. No narres de los PJ más de lo que han dicho o hecho aquí.'].join('\n'));
  }
  if (hints?.round) {
    const r = hints.round;
    L.push([`## Ronda ${r.n} (escena tensa): resuélvela entera, a la vez`,
      ...r.members.map((m) => `- ${m.name} [${m.id}]: ${m.text}`),
      r.hesitant.length ? `Dudan y pierden la ronda: ${r.hesitant.map((h) => `${h.name} [${h.id}]`).join(', ')} (solo ellos; los de arriba sí han actuado). No les inventes acciones: dudan.` : '',
      `Un solo cierre: narration_private la leen TODOS los de la ronda, no solo el actor. Resuelve la acción de CADA uno y nómbralo al hacerlo (${r.members.map((m) => `«${m.name}, tu…»`).join('; ')}) o usa el plural; nunca «tú» a secas, que cada jugador lo leería como suyo. Si alguno pregunta algo (qué conjuros tiene, qué ve), contéstale a él por su nombre. Después, lo que hace el mundo en respuesta. No pidas requires_roll: las pruebas de cada PJ con roll_check (hidden=false: la ven todos) y los ataques de los PJ con attack (attacker_id = ese PJ). Lo que diga cada uno, en lines como speaker "pc" con su character_id.`].filter(Boolean).join('\n'));
  }
  const firing = new Set(hints?.hooks.map((h) => h.id) ?? []);
  const planted = engine.hooksIn(loc.id).filter((h) => !firing.has(h.id));
  const agenda = scheduleContext(world, actor.id, loc.id, nowG);
  if (agenda) L.push(agenda);
  // Campañas escritas (story.ts): misiones del actor con su paso en curso y la amenaza que avanza.
  const story = storyContext(world, actor, nowG);
  if (story) L.push(story);
  const given = givenContext(world, actor);
  if (given) L.push(given);
  if (planted.length) L.push('## Ganchos sembrados aquí (solo tú los ves; el servidor los dispara; cancel_hook si ya no encajan)\n' + planted.map((h) => `- ${describeHook(world, h, (s) => engine.clock.format(s))}`).join('\n'));
  // Rumores (rumors.ts): lo que se dice aquí y lo que el actor ya sembró en otros sitios. Se cuentan como habladuría, nunca como hecho.
  const rumors = rumorsIn(world, loc.id, nowG);
  const heard = rumorsHeardBy(world, actor.id, nowG, loc.id).slice(-5);
  const budget = rumorBudget(world, actor.id, nowG);
  L.push([
    `## Rumores (se dicen, no están; plant_rumor con el mismo nombre para retomar uno; nuevos hoy con ${actor.name}: quedan ${budget.left} de ${budget.limit})`,
    ...(rumors.length ? rumors.map((r) => `- ${describeRumor(r)}`) : ['- Ninguno corre por aquí.']),
    ...(heard.length ? [`De otros sitios, que ${actor.name} ya conoce:`, ...heard.map((r) => `- ${describeRumor(r)} (en ${world.locations.get(r.location_id)?.name ?? r.location_id})`)] : []),
  ].join('\n'));
  return L.join('\n\n');
}

/** Lo que lleva encima un NPC (con IDs, para transfer_item): sin esto el máster lo inventa con spawn_item. */
function carriedBy(world: Engine['world'], npcId: Id): string {
  const items = world.itemsIn({ type: 'npc', id: npcId });
  return items.length ? `  Lleva: ${items.map((i) => `${world.itemDef(i.item_id).name}${i.quantity > 1 ? ` ×${i.quantity}` : ''} [${i.id}]`).join(', ')}` : '';
}

/** Lo último que ha dicho un NPC aquí: para que no repita la misma frase (closecheck.ts lo rechaza). */
function saidBy(events: readonly GameEvent[], npcId: Id): string {
  const said = recentNpcLines(events, npcId).slice(-4);
  return said.length ? `  Ya ha dicho hace poco (no lo repitas; si vuelve al tema, dilo de otra manera o con algo nuevo): ${said.map((t) => `«${t}»`).join(' · ')}` : '';
}
