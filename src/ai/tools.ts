/**
 * Tools del master (SPEC §7). Contrato exacto: esquemas estrictos y ejecución
 * contra el motor. El master no puede cambiar nada del mundo salvo por aquí.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Engine } from '../engine/engine.js';
import { rollExpr, type Advantage, type CheckResult, type Rng, type RollResult } from '../engine/dice.js';
import { inventoryDetailed, inventoryView, spawnItem, spotOfPlacement, transferItem } from '../engine/inventory.js';
import type { Character, Id, Npc, Placement, ReactionKind } from '../engine/model.js';
import { approachSpot, distance, moveTo, positionOf, type Approach } from '../engine/movement.js';
import { perceive, witnesses } from '../engine/perception.js';
import type { Position } from '../engine/movement.js';
import { harvest, regenState } from '../engine/resources.js';
import { activeJobs, addPractice, buyFromNpc, completeJob, grantClue, sellToNpc, type ProgressEvent } from '../engine/progress.js';
import { advanceStory } from '../engine/story.js';
import { barrierToward, bounceOff } from '../engine/barrier.js';
import { blockedOnRoute, entrySpot } from '../engine/goto.js';
import { finishQuest, giveQuest } from '../engine/quests.js';
import { attitudeOf, resolveAttack } from '../engine/combat.js';
import { bodyHolding, canLoot, damageCharacter, healCharacter, isDying, medicineDc, stabilize } from '../engine/death.js';
import { spendResource } from '../engine/rest.js';
import { characterCheck, normalizeSkill, SKILLS, type CheckKind } from '../engine/rules.js';
import { aEs, descriptorOf, fmtDuration } from '../engine/narrate.js';
import { cancelHook, plantHook } from '../engine/hooks.js';
import { plantRumor, rumorBudget, RUMOR_KINDS } from '../engine/rumors.js';
import { addScheduledEvent, listSchedule, RECURRENCES } from '../engine/schedule.js';
import { characterFacts, recordFact } from '../engine/facts.js';
import type { DialogueLine } from '../engine/moments.js';
import { fmtCoins, openDebts, pawnItem, setDebt, settleDebt, SETTLE_HOW } from '../engine/debts.js';
import { inventedPlaces } from '../engine/places.js';
import { actedForOthers, actedForRejection, DEAL_REJECTION, dealWithoutState, deathNarration, deathRejection, outcomeMismatch, outcomeRejection, withoutDeathPhrases, type DeathHit, type RollCategory } from '../engine/closecheck.js';
import { othersForCheck, pcName } from '../engine/party.js';
import { npcsHere, talkersOf } from '../engine/scene.js';
import { conversationCheck, conversationOf, conversationRejection, narrationWithLines } from '../engine/conversation.js';
import { formatRuleHits, loadRules, searchRules, type RulesIndex } from '../rules/index.js';

type Tool = Anthropic.Beta.BetaTool;

const str = (description: string) => ({ type: 'string' as const, description });
const nstr = (description: string) => ({ type: ['string', 'null'] as const, description });
const num = (description: string) => ({ type: 'number' as const, description });
const nnum = (description: string) => ({ type: ['number', 'null'] as const, description });
const bool = (description: string) => ({ type: 'boolean' as const, description });
const enm = (values: string[], description: string) => ({ type: 'string' as const, enum: values, description });

/** Sin modo estricto: con tantos campos la API rechaza la gramática ("Schema is too complex"). El servidor valida cada entrada. */
function tool(name: string, description: string, properties: Record<string, unknown>): Tool {
  return {
    name, description, strict: false,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

export const ROLL_KINDS = ['skill', 'save', 'ability', 'attack'];
export const ADV = ['none', 'advantage', 'disadvantage'];

/** Orden fijo y determinista: los tools van al principio del prefijo cacheado. */
export const MASTER_TOOLS: Tool[] = [
  tool('get_location', 'Detalle de una localización: puntos visibles para el actor, salidas, estado, objetos en el suelo, NPCs. Usa "here" para la actual.', {
    location_id: str('ID de la localización o "here"'),
  }),
  tool('get_character', 'Hoja de un personaje jugador. Del actor: completa. De otros: solo lo visible.', { character_id: str('ID del personaje') }),
  tool('get_npc', 'Ficha de un NPC presente.', { npc_id: str('ID del NPC') }),
  tool('get_item', 'Detalle de un objeto (ejemplar) al alcance.', { instance_id: str('ID del ejemplar') }),
  tool('who_is_here', 'Quién percibe el actor a su alrededor y con qué nivel (full/vague/hint).', { unused: nstr('Sin uso; pasa null') }),
  tool('get_recent_events', 'Últimos eventos de la localización que el actor ha percibido.', { n: num('Cuántos, 1-30') }),
  tool('get_campaign_notes', 'Notas de campaña solo para ti: todas las pistas que el actor aún no tiene, con cómo se obtienen y dónde, y los encargos del tablón completos (quién los pide, qué piden, paga). Úsalo cuando el contexto no traiga la pista o el encargo que necesitas.', {
    unused: nstr('Sin uso; pasa null'),
  }),
  tool('lookup_rule', 'Consulta las reglas oficiales (Player\'s Handbook y Dungeon Master\'s Guide, en inglés) cuando dudes de una mecánica, estadística o tabla; no la uses para lo que ya está en el contexto. Devuelve hasta 3 fragmentos.', {
    query: str('Términos en inglés: "grappling", "long rest", "cover"'),
    book: { type: ['string', 'null'], enum: ['phb', 'dmg', null], description: 'phb, dmg o null para buscar en ambos' },
  }),

  tool('roll_dice', 'Tirada de dados genérica del servidor (daño, tablas, NPCs). Para pruebas del propio jugador usa requires_roll en log_event.', {
    expr: str('Expresión: "2d6+3", "1d20+5", "4d6kh3"'),
    reason: str('Para qué es la tirada'),
    dc: nnum('CD a superar, o null'),
  }),
  tool('roll_check', 'Tirada oculta de un personaje (percepción pasiva, sigilo que no se anuncia, NPC contra PJ). No la uses para la acción principal del jugador: eso va con requires_roll en log_event.', {
    character_id: str('ID del personaje que tira'),
    kind: enm(ROLL_KINDS, 'Tipo de prueba'),
    key: str('Skill 5e en inglés (athletics, stealth, perception…), característica (str/dex/…) o "melee"/"ranged" para ataque'),
    dc: nnum('CD, o null si es enfrentada'),
    advantage: enm(ADV, 'Ventaja o desventaja'),
  }),

  tool('move_to', 'Pone al personaje en camino hacia un punto o hacia una localización (entra hasta su punto de entrada, cruzando las que haga falta). El servidor calcula ruta y tiempo; nunca es instantáneo.', {
    character_id: str('ID del personaje'),
    target_spot_id: nstr('ID del punto de destino, o null si vas a una localización'),
    target_location_id: nstr('ID de la localización de destino (entra en ella), o null si das un punto'),
    pace: enm(['stealth', 'walk', 'run'], 'Ritmo'),
  }),
  tool('transfer_item', 'Mueve un objeto entre suelo, personaje (mano/bolsillo/equipado), contenedor o NPC. Atómico; falla con no_space si no cabe.', {
    instance_id: str('ID del ejemplar'),
    to_type: enm(['spot', 'character', 'container', 'npc'], 'Tipo de destino'),
    to_id: str('ID del destino'),
    slot: enm(['hand_main', 'hand_off', 'hand_both', 'pocket', 'equipped'], 'Solo si el destino es un personaje'),
    equip_slot: nstr('Si slot es equipped: head/body/hands/feet/neck/ring1/ring2/back/belt; si no, null'),
    quantity: nnum('Cantidad, o null para todo el stack'),
  }),
  tool('spawn_item', 'Crea un objeto del catálogo en el suelo de un punto. Solo para improvisación razonable (algo que lógicamente estaría ahí).', {
    item_id: str('ID del catálogo de objetos'),
    quantity: num('Cantidad'),
    spot_id: str('Punto donde aparece'),
  }),
  tool('update_spot_state', 'Cambia el estado de un punto (puerta abierta, vidriera rota, sangre en el suelo…). Lo que un jugador altera tiene que quedar aquí.', {
    spot_id: str('ID del punto'),
    patch_json: str('JSON con las claves a cambiar, p. ej. {"window_broken": true}'),
  }),
  tool('update_location_state', 'Cambia el estado de la localización entera.', {
    location_id: str('ID de la localización o "here"'),
    patch_json: str('JSON con las claves a cambiar'),
  }),
  tool('discover_spot', 'Marca un punto oculto como descubierto por un personaje (tras una tirada con éxito).', {
    character_id: str('ID del personaje'), spot_id: str('ID del punto oculto'),
  }),
  tool('harvest', 'Extrae de un nodo de recurso (talar, recolectar, pescar). El servidor tira la skill del nodo contra su CD, calcula rendimiento y regeneración y cuenta la práctica. No pidas requires_roll para esto.', {
    character_id: str('ID del personaje'), node_id: str('ID del nodo'),
  }),
  tool('grant_clue', 'Concede una pista de la demo al actor. SOLO cuando el jugador la ha obtenido de verdad con sus actos (ver "cómo se obtiene" de cada pista). Una vez por personaje.', {
    character_id: str('ID del personaje'), clue_id: str('ID de la pista'),
  }),
  tool('complete_job', 'Cierra un encargo del tablón para el actor al entregárselo al NPC que lo pidió. El servidor valida entrega (quita los objetos), paga y sube reputación. Para encargos narrativos, llámalo solo cuando el objetivo se haya cumplido de verdad en la ficción.', {
    character_id: str('ID del personaje'), job_id: str('ID del encargo'), npc_id: str('ID del NPC al que se entrega'),
  }),
  tool('advance_story', 'Campañas escritas: marca como dado el paso NARRATIVO en curso de una misión del actor (lo dice «Historia escrita» en el contexto: «lo decides tú con advance_story»), SOLO cuando se ha cumplido de verdad en la ficción. Los demás pasos los detecta el servidor solo.', {
    quest_id: str('ID de la misión (q_…)'), step_id: str('ID del paso en curso'),
  }),
  tool('give_quest', 'Un NPC le da al actor un encargo o le pide algo concreto que hacer (fuera del tablón): queda en su Diario «en curso» sin que tenga que aceptarlo, y el jugador ve «Nueva misión». Llámalo en el turno en que se lo piden.', {
    title: str('Título corto, como lo apuntaría el PJ («Las tablas de Hugo»)'),
    text: str('De qué va, en una o dos frases, sin secretos'),
    npc_id: nstr('ID del NPC que la da, o null'),
    objective: nstr('Qué hay que hacer exactamente, o null'),
    reward: nstr('Recompensa si la dijo («20 monedas», «un favor»), o null'),
  }),
  tool('finish_quest', 'Cierra una misión dada con give_quest: cumplida o fallida (ya no se puede).', {
    quest_id: str('ID de la misión (gq_…)'), outcome: enm(['completed', 'failed'], 'Cómo acaba'),
  }),
  tool('sell_item', 'Vende un objeto a un NPC que lo compre, al precio de su lista. Cobra en el acto.', {
    character_id: str('ID del personaje'), npc_id: str('ID del NPC'), instance_id: str('ID del ejemplar'), quantity: nnum('Cantidad, o null para todo'),
  }),
  tool('buy_item', 'Compra a un NPC algo de su lista de venta. Descuenta monedas y lo pone en manos/bolsillo (o en el suelo si no cabe).', {
    character_id: str('ID del personaje'), npc_id: str('ID del NPC'), item_id: str('ID del catálogo'), quantity: num('Cantidad'),
  }),
  tool('set_debt', 'Anota lo que el actor debe a un NPC (una cuenta, un préstamo, un precio fiado) o corrige la deuda abierta con él. Lo que se debe es estado del mundo, no solo narración: sin esto no se puede pagar ni reclamar.', {
    npc_id: str('ID del NPC al que debe'), amount: num('Monedas que debe en total'), reason: str('Por qué, corto: «la cuenta de la posada»'),
    due_in_hours: nnum('Horas de juego hasta que vence (de la noche a mañana por la mañana ≈ 10); null = sin plazo'),
  }),
  tool('pawn_item', 'El actor deja un objeto suyo en prenda a un NPC: el objeto pasa al NPC y queda ligado a la deuda; vuelve al saldarla. Con for_item_id, a cambio de algo que el NPC vende (una noche de posada): se lo entrega fiado y la deuda es su precio. Sin for_item_id, la prenda garantiza la deuda anotada o una nueva de amount.', {
    npc_id: str('ID del NPC que guarda la prenda'), instance_id: str('ID del ejemplar que deja (inventario del actor)'),
    for_item_id: nstr('ID del catálogo de lo que recibe fiado (de su lista «Vende»), o null'), amount: nnum('Sin for_item_id: monedas que garantiza; null si ya hay deuda anotada'),
    reason: str('Por qué, corto: «fianza por una noche»'), due_in_hours: nnum('Horas de juego hasta que vence; null = sin plazo'),
  }),
  tool('settle_debt', 'Salda (o rebaja) la deuda del actor con un NPC: coins paga con sus monedas (amount o todo), work la da por pagada con un trabajo ya hecho, forfeit la da por perdida y el NPC se queda la prenda. Al saldarla, la prenda vuelve al actor.', {
    npc_id: str('ID del NPC'), how: enm([...SETTLE_HOW], 'coins (paga), work (trabajo hecho), forfeit (pierde la prenda)'), amount: nnum('Solo coins: monedas que paga; null = todo'),
  }),
  tool('attack', 'Ataque de un NPC (o de un PJ fuera del flujo de tirada del jugador). El servidor tira contra la CA, calcula y aplica el daño. Para el ataque del propio jugador usa requires_roll con kind=attack y requires_roll_target.', {
    attacker_id: str('ID del que ataca (NPC o personaje)'), target_id: str('ID del objetivo'), advantage: enm(ADV, 'Ventaja o desventaja'),
  }),
  tool('request_reaction', 'El actor hace algo con las manos a OTRO JUGADOR presente (agarrarlo, llevárselo a rastras, empujarlo, sujetarlo, quitarle algo, atacarlo). No lo resuelvas tú: el otro decide en su pantalla si se deja (sin tirada) o se resiste (tirada enfrentada que hace el servidor) y luego te toca narrar el desenlace. Narra SOLO el intento (alarga la mano, se lanza…), nunca cómo reacciona ni el resultado. Dar algo es transfer_item (oferta), no esto.', {
    target_character_id: str('ID del otro PJ (ch_…)'),
    kind: enm(['grapple', 'shove', 'attack', 'other'], 'grapple: agarrar, sujetar, llevárselo; shove: empujar, apartar, derribar; attack: golpear o herir (ataque contra su CA); other: otra cosa física (quitarle algo, taparle la boca…)'),
    attempt: str('Qué intenta, en infinitivo y en segunda persona para el afectado, concreto: «agarrarte del brazo y llevarte a la taberna», «quitarte la daga del cinto»'),
    destination_spot_id: nstr('Si se lo quiere llevar a otro sitio: ID del punto (sp_…); el servidor mueve a los dos si sale bien. null si no'),
    actor_skill: nstr('Solo other: skill 5e de quien actúa (sleight_of_hand, athletics…); null = athletics'),
    target_skills: nstr('Solo other: skills con las que se resiste el afectado, separadas por comas (la mejor de las suyas); null = athletics,acrobatics'),
  }),
  tool('apply_damage', 'Quita puntos de golpe a un personaje o NPC por daño que no es un ataque (caída, fuego, trampa).', {
    target_id: str('ID del personaje o NPC'), amount: num('Daño'), damage_type: str('Tipo: slashing, fire, falling…'), source: str('Qué lo causa'),
  }),
  tool('heal', 'Devuelve puntos de golpe a un personaje o NPC. A un PJ a 0 PG le despierta (cualquier curación).', { target_id: str('ID del personaje o NPC'), amount: num('PG curados'), healer_id: nstr('Quién cura (ID de PJ o NPC); null = el actor') }),
  tool('stabilize', 'Atender a un PJ que está a 0 PG cayendo (salvaciones contra muerte). Si lo atiende un PJ, el servidor tira su Medicina CD 10; un NPC lo logra. Estable: deja de tirar y recupera 1 PG en 1d4 h.', {
    target_id: str('ID del PJ caído'), healer_id: str('Quién le atiende: el actor u otro PJ presente, o un NPC'),
  }),
  tool('take_rest', 'Descanso del actor cuando la ficción lo pide (le acogen, acampan…): short = 1 h (gasta dados de golpe, recursos de descanso corto), long = 8 h (PG completos, uno cada 24 h). El servidor aplica el tiempo, la seguridad del sitio y las interrupciones; narra lo que devuelva.', {
    kind: enm(['short', 'long'], 'short (1 h) o long (8 h)'),
  }),
  tool('spend_resource', 'Gasta usos de un recurso de clase del actor (Tomar aliento, Furia, ki, espacios de conjuro…). Las claves están en el contexto del actor. Sin usos, no puede hacerlo.', {
    key: str('Clave del recurso: second_wind, rage, slot_1…'), amount: nnum('Usos (o PG de Imposición de manos); null = 1'),
  }),
  tool('add_condition', 'Añade una condición a un personaje.', {
    target_id: str('ID del personaje'), name: str('Condición 5e en español: envenenado, asustado, agarrado…'), source: str('Origen'),
    duration_game_min: nnum('Minutos de juego, o null si dura hasta que algo la quite'),
  }),
  tool('remove_condition', 'Quita una condición.', { target_id: str('ID del personaje'), name: str('Condición') }),

  tool('plant_hook', 'Siembra algo que pasará después sin que tengas que estar mirando: a una hora, cuando alguien vaya a un punto, llegue a la localización o coja un objeto. El servidor lo vigila y te llama cuando salta. Para lo que pasa ya, no: eso se narra.', {
    trigger: enm(['time', 'spot', 'location', 'item'], 'Qué lo dispara'),
    location_id: nstr('Localización; null = la del actor'),
    minutes_from_now: nnum('Solo time: minutos de juego desde ahora; null en los demás'),
    spot_id: nstr('Solo spot: el punto; null en los demás'),
    item_id: nstr('Solo item: el tipo de objeto (it_…); null en los demás'),
    what: str('Qué ocurre, para ti: quién, qué hace, qué quiere. El jugador no lo lee'),
    for_character_id: nstr('Solo con este PJ; null = con cualquiera'),
    expires_in_minutes: nnum('Caduca a los N minutos de juego; null = por defecto (1 día, o 1 h después de la hora)'),
  }),
  tool('cancel_hook', 'Anula un gancho sembrado que ya no tiene sentido.', { hook_id: str('ID del gancho (hk_…)') }),
  tool('plant_rumor', 'Siembra un rumor cuando el jugador busca, afirma o inventa algo plausible del mundo compartido que no está en los datos (un tesoro, alguien, un sitio, un pasadizo, un encargo). No crea nada real: queda que «se dice» algo, circulando por esta localización, para que la historia pueda retomarlo. Con el mismo nombre que uno que ya corre aquí, lo retoma sin gastar presupuesto. Presupuesto: pocos rumores nuevos por personaje y día de juego; si se agota, devuelve error.', {
    kind: enm([...RUMOR_KINDS], 'rumor (habladuría), place (lugar), person (persona), item (objeto), quest (empresa o encargo)'),
    name: str('Cómo lo llama la gente, corto: «el tesoro de la croqueta dorada»'),
    hint: str('Lo que se dice, en una frase. Habladuría, no hecho; sin revelar secretos de la campaña'),
    where: nstr('Dónde dicen que está, en palabras de la gente («más allá del portón norte»); null si nadie lo sabe'),
    said_by_actor: bool('true si es el propio personaje quien lo afirma o lo inventa («he oído que…», «en mi pueblo se contaba…»): queda como «lo dice él», sin confirmar. false si es habladuría del mundo'),
  }),
  tool('record_character_fact', 'Guarda algo que el jugador cuenta de SU personaje y que solo le toca a él: su pasado, un recuerdo, alguien de su vida que no está aquí. Se acepta como verdad de ese personaje, no del mundo; no da objetos, monedas, competencias ni favores. Lo que afirme del mundo compartido va con plant_rumor.', {
    kind: enm(['background', 'memory', 'relationship'], 'background (pasado, oficio, origen), memory (un recuerdo), relationship (alguien de su vida fuera de escena)'),
    text: str('En tercera persona y una frase: «Su padre era herrero en la capital y le enseñó a juzgar el acero»'),
  }),

  tool('schedule_event', 'Programa algo que pasa a una hora en un sitio (una misa, un mercado, una reunión, una llegada), sobre todo cuando un NPC lo anuncia: a su hora el servidor trae a la gente y a los NPC, aplica el ruido y lo cuenta a quien esté. Si ya existe uno con ese título en ese sitio, no lo duplica: lo devuelve y anota que el actor lo sabe.', {
    title: str('Con artículo, corto: «la misa», «el mercado», «la reunión del concejo»'),
    location_id: nstr('Localización; null = la del actor'),
    spot_id: nstr('Punto donde se junta la gente; null = el punto principal'),
    start_hour: num('Hora de juego de inicio, decimal: 8, 20.5 (20:30)'),
    duration_min: num('Duración en minutos de juego (5-1380)'),
    recurrence: enm([...RECURRENCES], 'daily (cada día), weekly (un día de la semana), once (una vez)'),
    weekday: nstr('Solo weekly: nombre del día; null en los demás'),
    days_from_now: nnum('Solo once: 0 = hoy (o mañana si ya pasó la hora), 1 = mañana…; null en los demás'),
    description: str('Qué pasa, para ti: quién lo dirige, qué se hace, qué se oye'),
    npc_ids: str('NPC con ficha que acuden, IDs separados por comas; cadena vacía si ninguno'),
    crowd: nstr('Figurantes sin ficha: «feligreses ×12; un fraile ×1»; null si nadie más'),
    noise: nnum('Ruido del lugar mientras dura, 0-1 (mercado 0.5, misa 0.15); null = sin cambio'),
    busy_npc_ids: str('NPC ocupados mientras dura (el que oficia), IDs separados por comas; cadena vacía si ninguno'),
    start_text: nstr('Lo que ve quien está allí al empezar, en tercera persona; null = texto por defecto'),
    end_text: nstr('Lo que ve quien está allí al acabar; null = texto por defecto'),
    told_actor: bool('true si en esta escena se lo han dicho al actor (un NPC se lo anuncia)'),
  }),
  tool('get_schedule', 'Agenda del mundo: qué pasa, dónde, cada cuánto, cuándo es lo próximo y si está en marcha.', {
    location_id: nstr('"here", un ID de localización o null para toda la agenda'),
  }),

  tool('log_event', 'CIERRE OBLIGATORIO de cada acción. Registra lo ocurrido y lo entrega a cada personaje según lo que percibe. Tras llamarlo, termina.', {
    narration_private: str('Lo que ve el actor. Segunda persona. Breve.'),
    observable: nstr('Lo que ve un testigo cercano con detalle completo, en tercera persona con el nombre del actor. null si no hay nada observable.'),
    observable_vague: nstr('Lo mismo para quien solo distingue una figura, sin nombre ni detalle. null si no aplica.'),
    loudness: num('Volumen: 0.15 susurro, 1 normal, 5 grito, 15 estruendo'),
    tags: str('Etiquetas separadas por comas: social, exploration, combat, milestone…'),
    suggested_actions: str('2-4 acciones sugeridas para ESTE personaje, separadas por " | ". Cadena vacía si no procede o si pides tirada (requires_roll): entonces solo se ofrece el dado.'),
    requires_roll_kind: nstr('Si la acción necesita una tirada del jugador antes de resolverse: skill/save/ability/attack. null si no.'),
    requires_roll_key: nstr('Skill, característica o melee/ranged. null si no hay tirada.'),
    requires_roll_dc: nnum('CD oculta. null si no hay tirada.'),
    requires_roll_advantage: nstr('none/advantage/disadvantage. null si no hay tirada.'),
    requires_roll_target: nstr('Si la tirada es un ataque: ID del objetivo (NPC o personaje). El servidor resolverá impacto y daño. null si no.'),
    decisive_threat: nstr('Ventana de respuesta decisiva: SOLO si hay una amenaza real e inmediata contra el actor (un enemigo a punto de golpearle, un suelo que cede). Describe en una frase qué le pasa si no responde en 60 s. null en cualquier otro caso.'),
    decisive_npc_id: nstr('NPC que amenaza en esa ventana, o null.'),
    npc_id: nstr('Si en esta acción el actor ha hablado con un NPC: su ID. Si no, null.'),
    npc_memory_note: nstr('Solo si ha hablado con ese NPC y hay algo que esa persona recordaría del actor (su nombre, qué le preguntó, un favor, una ofensa, una promesa, dinero). Una frase en tercera persona. null si no hay nada que recordar o si no ha habido conversación.'),
    npc_memory_importance: nnum('1 = se olvida en días (una charla, una pregunta); 2 = dura semanas (un favor, un pago, una amenaza); 3 = no se olvida nunca (le salvó la vida, le robó, le humilló). null si no hay nota.'),
    names_learned: nstr('IDs (separados por comas) de NPCs o personajes cuyo NOMBRE el actor ha aprendido en esta acción porque se presentaron o alguien los nombró. null si ninguno.'),
    places_learned: nstr('IDs (separados por comas) de localizaciones de las que el actor ha oído hablar en esta acción porque alguien nombró el sitio o lo leyó en un cartel o mapa. null si ninguna.'),
    introduces_self: bool('true si el actor ha dicho su propio nombre en voz alta en esta acción (los presentes lo aprenden).'),
    target_character_id: nstr('Si la acción se dirige a otro JUGADOR presente (le habla, le mira, se le acerca, le tiende algo): su ID. Recibirá observable_target y opciones para responder. null si no.'),
    observable_target: nstr('Solo con target_character_id: lo que percibe ese jugador, en segunda persona («Kael se acerca a ti y te pregunta…»). Solo lo que hace el actor, nunca lo que hace o piensa ese jugador. null si no.'),
    lines: {
      type: ['array', 'null'],
      description: 'Parlamentos literales de esta acción, en orden (modo novela). speaker "npc" con su npc_id, o "actor" (npc_id null). text: solo las palabras dichas, sin comillas ni acotaciones. null si nadie habla.',
      items: {
        type: 'object',
        properties: { speaker: { type: 'string', enum: ['npc', 'actor', 'pc'] }, npc_id: { type: ['string', 'null'] }, text: { type: 'string' }, character_id: { type: ['string', 'null'], description: 'Solo en conversación de grupo o ronda: speaker "pc" con el ID del PJ que habla.' }, to: { type: ['string', 'null'], description: 'Solo en conversación de grupo: ID del PJ al que responde esta línea del NPC.' } },
        required: ['speaker', 'npc_id', 'text'],
        additionalProperties: false,
      },
    },
  }),
];

/** Tools que cambian el mundo: si fallan, eso no ha ocurrido y no se puede narrar (master.ts). */
export const WRITE_TOOLS = new Set([
  'move_to', 'transfer_item', 'spawn_item', 'update_spot_state', 'update_location_state', 'discover_spot', 'harvest', 'grant_clue', 'complete_job', 'advance_story',
  'give_quest', 'finish_quest', 'sell_item', 'buy_item', 'set_debt', 'pawn_item', 'settle_debt', 'attack', 'apply_damage', 'heal', 'add_condition', 'remove_condition',
  'stabilize', 'take_rest', 'spend_resource', 'request_reaction',
]);

export const MEMORY_CAP_PER_CHARACTER = 8;
export const MEMORY_CAP_PER_NPC = 40;

// ---------------------------------------------------------------------------

export interface ToolContext {
  engine: Engine;
  actor: Character;
  nowGameS: number;
  rng: Rng;
  /** Rellenado por log_event. */
  closed: LogEventInput | null;
  rolls: RollResult[];
  /** Avisos de progreso (pista, encargo, práctica, logro) para emitir como sistema tras la acción. */
  progress: ProgressEvent[];
  /** Texto de la acción del jugador, como procedencia de lo que se siembre (rumores). */
  action_text?: string | null;
  /** Acercamiento que ha hecho el motor en esta acción para que el actor alcance a un NPC. */
  approach?: Approach | null;
  /** Veces que se ha rechazado el cierre por citar un lugar que no existe (una como mucho). */
  place_rejections?: number;
  /** Tools de escritura que han salido bien en esta acción (para el detector de tratos). */
  ok_tools?: string[];
  /** Si es la continuación de una tirada: su categoría (closecheck.ts). */
  roll_category?: RollCategory | null;
  /** Cierres rechazados por trato sin estado o por desenlace contra la tirada (uno de cada como mucho). */
  deal_rejections?: number;
  outcome_rejections?: number;
  /** Cierres rechazados por narración de relleno en conversación (conversation.ts; uno como mucho). */
  conversation_rejections?: number;
  /** Cierres rechazados por narrar lo que hace otro jugador (closecheck.ts; uno como mucho). */
  others_rejections?: number;
  /** Cierres rechazados por narrar una muerte o una vuelta sin estado (closecheck.ts; dos, luego se quitan esas frases). */
  death_rejections?: number;
}

export interface LogEventInput {
  narration_private: string;
  observable: string | null;
  observable_vague: string | null;
  loudness: number;
  tags: string[];
  suggested_actions: string[];
  requires_roll: { kind: CheckKind; key: string; dc: number | null; advantage: Advantage; target?: string } | null;
  decisive: { threat: string; npc_id: string | null } | null;
  /** NPC con quien ha hablado el actor (para el retrato del primer encuentro). */
  npc_id?: string | null;
  /** Parlamentos literales (modo novela); narration_private sigue siendo el texto completo. */
  lines?: DialogueLine[];
  /** Otro jugador al que se dirige la acción y lo que percibe él, en segunda persona (party.ts). */
  target_character_id?: string | null;
  observable_target?: string | null;
}

/** ¿Hay en la sala del actor un NPC hablando con otro PJ? */
function busyHere(engine: Engine, actor: Character, nowGameS: number): boolean {
  const loc = engine.world.characterSpot(actor)?.location_id;
  if (!loc) return false;
  const events = engine.events.recentInLocation(loc, 60);
  return npcsHere(engine.world, actor).some((n) => { const t = talkersOf(engine.world, events, n, nowGameS); return t.length > 0 && !t.includes(actor.id); });
}

/** PJ que comparten el turno del actor (conversación de grupo o ronda, scene.ts); vacío si no. */
function sharedWith(engine: Engine, actorId: string): string[] {
  const h = engine.sceneHints(actorId);
  return [...(h?.group?.members ?? []), ...(h?.round?.members ?? []), ...(h?.round?.hesitant ?? [])].map((m) => m.id);
}

/** Una «línea» del actor que es en realidad su intención («Hablar con Aren», «Preguntarle por…»): no es algo dicho. */
export const INTENT_LINE = /^(?:hablar|hablarle|preguntar|preguntarle|decir|decirle|contar|contarle|saludar|saludarle|responder|responderle)\b/i;

/** Parlamentos válidos del cierre: hablante conocido, texto limpio; como mucho 12. Acepta lista o JSON en texto. */
export function parseLines(raw: unknown, fallbackNpc: string | null, isNpc: (id: string) => boolean, isPc: (id: string) => boolean = () => false): DialogueLine[] {
  let list: unknown = raw;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  const out: DialogueLine[] = [];
  for (const l of list) {
    if (!l || typeof l !== 'object') continue;
    const r = l as Record<string, unknown>;
    const text = cleanText(String(r['text'] ?? '')).replace(/^[«"“—-]\s*|\s*[»"”]$/g, '').trim().slice(0, 600);
    if (!text) continue;
    if (r['speaker'] === 'actor') out.push({ speaker: 'actor', text });
    else if (r['speaker'] === 'pc' && typeof r['character_id'] === 'string' && isPc(r['character_id'])) out.push({ speaker: 'pc', character_id: r['character_id'], text });
    else if (r['speaker'] === 'npc') {
      const id = typeof r['npc_id'] === 'string' && isNpc(r['npc_id']) ? r['npc_id'] : fallbackNpc;
      const to = typeof r['to'] === 'string' && isPc(r['to']) ? r['to'] : null;
      if (id) out.push({ speaker: 'npc', npc_id: id, text, ...(to ? { to } : {}) });
    }
    if (out.length >= 12) break;
  }
  return out;
}

/** PJs que oyen al actor con detalle (banda full de oído). */
function witnessesOf(engine: Engine, at: Position, nowGameS: number, exclude: string): Character[] {
  return witnesses(engine.world, engine.clock, at, nowGameS, 1, exclude).filter((w) => w.perceived.sound === 'full').map((w) => w.character);
}

/** Quita restos de sintaxis de llamada (XML de parámetros) que a veces se cuelan en los textos. */
export function cleanText(t: string): string {
  return t.replace(/<\/?(?:parameter|narration_private|observable|observable_vague|invoke|function_calls)[^>]*>[\s\S]*$/i, '').replace(/<\/?[a-z_]+>\s*$/i, '').trim();
}

let rules: RulesIndex | null = null;

/** Índice de reglas (RULES_DIR o data/local/rules), cargado una sola vez y solo si el máster lo consulta. */
export function rulesIndex(): RulesIndex {
  return (rules ??= loadRules(process.env['RULES_DIR'] ?? 'data/local/rules'));
}

/** Olvida el índice cargado (tests o tras volver a ingerir). */
export function resetRulesIndex(): void {
  rules = null;
}

export function executeTool(ctx: ToolContext, name: string, input: Record<string, unknown>): string {
  try {
    const out = run(ctx, name, input);
    const res = typeof out === 'string' ? out : JSON.stringify(out);
    if (WRITE_TOOLS.has(name) && !res.startsWith('{"error"')) (ctx.ok_tools ??= []).push(name);
    return res;
  } catch (e) {
    return JSON.stringify({ error: unknownIdError(ctx, (e as Error).message) });
  }
}

/** Lo que hay aquí, para los errores de «eso no existe»: el máster lo lee y no inventa. */
function hereList(ctx: ToolContext): string {
  const w = ctx.engine.world;
  const loc = positionOf(w, ctx.actor, ctx.nowGameS).location_id;
  const spots = w.spotsOf(loc).filter((sp) => !sp.hidden || sp.discovered_by.includes(ctx.actor.id)).map((sp) => `${sp.name} [${sp.id}]`);
  const exits = w.spotsOf(loc).flatMap((sp) => w.exitsFrom(sp.id).map(({ to_spot_id }) => `${w.locationOfSpot(to_spot_id).name} [${to_spot_id}]`));
  return `Puntos de aquí: ${spots.join(', ')}.${exits.length ? ` Salidas: ${exits.join(', ')}.` : ''}`;
}

/** «spot not found: sp_cocina» → un mensaje que diga qué hay y que no se invente. */
function unknownIdError(ctx: ToolContext, msg: string): string {
  const m = /^(spot|location|npc|item_instance|character) not found: (.+)$/.exec(msg);
  if (!m) return msg;
  const what = { spot: 'el punto', location: 'la localización', npc: 'el NPC', item_instance: 'el objeto', character: 'el personaje' }[m[1] as 'spot'];
  return `No existe ${what} ${m[2]} en los datos: no está en el mundo. ${m[1] === 'spot' || m[1] === 'location' ? `${hereList(ctx)} ` : ''}Narra que no hay nada así; no lo inventes.`;
}

/** Dónde está un punto respecto al actor: nombre, ID y metros. */
function whereIs(ctx: ToolContext, spotId: Id): { spot_id: Id; name: string; distance_m: number } {
  const w = ctx.engine.world;
  const sp = w.spot(spotId);
  const pos = positionOf(w, ctx.actor, ctx.nowGameS);
  return { spot_id: sp.id, name: sp.name, distance_m: Math.round(Math.hypot(sp.x - pos.x, sp.y - pos.y)) };
}

/**
 * Para tratar con un NPC hay que estar en su punto. Si está en la misma
 * localización y no es hostil, el motor acerca al actor (unos segundos de
 * juego) y lo anota para el evento. Devuelve null si ya lo alcanza, o el
 * error con la distancia y adónde ir.
 */
function reachNpc(ctx: ToolContext, npc: Npc): Record<string, unknown> | null {
  const w = ctx.engine.world;
  if (w.characterSpot(ctx.actor)?.id === npc.location.id) return null;
  const at = whereIs(ctx, npc.location.id);
  const sameLoc = w.spot(npc.location.id).location_id === positionOf(w, ctx.actor, ctx.nowGameS).location_id;
  if (sameLoc && npc.status === 'alive' && attitudeOf(npc, ctx.actor.id) !== 'hostile') {
    const a = approachSpot(w, ctx.actor, npc.location.id);
    if (a) { ctx.approach = ctx.approach ? { ...ctx.approach, to_spot_id: a.to_spot_id, duration_s: ctx.approach.duration_s + a.duration_s } : a; return null; }
  }
  return {
    error: 'not_reachable',
    detail: { reason: sameLoc ? `${npc.name} está en ${at.name}, a ${at.distance_m} m: fuera de alcance` : `${npc.name} no está en esta localización`, distance_m: sameLoc ? at.distance_m : null, go_to: sameLoc ? at.spot_id : null },
    hint: sameLoc ? `move_to ${at.spot_id} primero; hasta que llegue, no ha ocurrido` : 'no está aquí: no lo narres como presente',
  };
}

/**
 * Saquear (death.ts): el cuerpo de quien murió en casual solo lo toca su dueño;
 * a un PJ vivo caído no se le quita nada sin su consentimiento (que te lo dé).
 */
function lootGuard(ctx: ToolContext, instanceId: Id): Record<string, unknown> | null {
  const w = ctx.engine.world;
  const body = bodyHolding(w, instanceId);
  if (body) {
    const ok = canLoot(w, ctx.actor.id, body);
    return ok.ok ? null : { error: 'not_allowed', hint: `No puede: ${ok.reason}. Narra que no lo toca.` };
  }
  const inst = w.itemInstances.get(instanceId);
  if (!inst) return null;
  const holder = [...w.characters.values()].find((o) => o.id !== ctx.actor.id && w.itemsCarriedBy(o.id).some((i) => i.id === inst.id));
  if (holder && holder.status === 'unconscious') return { error: 'not_allowed', hint: `${holder.name} es otro jugador y está vivo: sin su consentimiento no se le quita nada (que te lo dé cuando despierte).` };
  return null;
}

function run(ctx: ToolContext, name: string, input: Record<string, unknown>): unknown {
  const { engine, actor, nowGameS } = ctx;
  const world = engine.world;
  const s = (k: string) => String(input[k] ?? '');
  const here = () => positionOf(world, actor, nowGameS).location_id;

  switch (name) {
    case 'get_location': {
      // Un ID de punto en vez de localización: la suya (el modelo los confunde).
      const id = s('location_id') === 'here' ? here() : world.spots.get(s('location_id'))?.location_id ?? s('location_id');
      const loc = world.location(id);
      const spots = world.spotsOf(id).filter((sp) => !sp.hidden || sp.discovered_by.includes(actor.id)).map((sp) => ({
        id: sp.id, name: sp.name, description: sp.description, x: sp.x, y: sp.y, tags: sp.tags, state: sp.state,
        items: world.itemsIn({ type: 'spot', id: sp.id }).map((i) => `${i.id}: ${world.itemDef(i.item_id).name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`),
        resources: [...world.resourceNodes.values()].filter((n) => n.spot_id === sp.id).map((n) => `${n.id}: ${n.name} (${Math.round(regenState(n, nowGameS) * 100)}%)`),
        npcs: world.npcsAt(sp.id).map((n) => `${n.id}: ${n.name}, ${n.role}`),
      }));
      const exits: string[] = [];
      for (const sp of world.spotsOf(id)) for (const { exit, to_spot_id } of world.exitsFrom(sp.id)) {
        exits.push(`${sp.name} → ${world.locationOfSpot(to_spot_id).name} (${world.spot(to_spot_id).id}), ${exit.distance_m} m${exit.state.blocked_by ? `, bloqueada: ${exit.state.blocked_by}` : ''}`);
      }
      return { id: loc.id, name: loc.name, description_base: loc.description_base, indoor: loc.indoor, ambience: loc.ambience, state: loc.state, spots, exits };
    }
    case 'get_character': {
      const c = world.character(s('character_id'));
      const inv = inventoryView(world, c.id);
      const pos = positionOf(world, c, nowGameS);
      const pub = { id: c.id, name: c.name, race: c.race, class_name: c.class_name, appearance: c.appearance, status: c.status, spot_id: pos.spot_id, hands: inv.hands, equipped: inv.equipped, conditions: c.conditions.map((x) => x.name), hp_hint: c.hp_current >= c.hp_max ? 'ileso' : c.hp_current > c.hp_max / 2 ? 'herido' : 'malherido' };
      if (c.id !== actor.id) return pub;
      return { ...pub, level: c.level, abilities: c.abilities, hp: `${c.hp_current}/${c.hp_max}`, proficiencies: c.proficiencies, inventory: inventoryDetailed(world, c.id), coins: c.coins, encumbrance: inv.encumbrance.level, backstory: c.backstory, facts: characterFacts(c).map((f) => f.text) };
    }
    case 'get_npc': {
      const n = world.npc(s('npc_id'));
      return {
        id: n.id, name: n.name, role: n.role, status: n.status, spot_id: n.location.id, description: n.description, motivation: n.motivation, secret: n.secret,
        attitude_to_actor: attitudeOf(n, actor.id), combat: n.stats ? { ac: n.stats.ac, hp: `${n.stats.hp}/${n.stats.hp_max}`, attack: `${n.stats.attack_name} +${n.stats.attack_bonus}, ${n.stats.damage} ${n.stats.damage_type}` } : null,
        remembers_about_actor: n.memory.filter((m) => m.character_id === actor.id).map((m) => `[${engine.clock.format(m.game_s)}] ${m.note}`),
        remembers_about_others: n.memory.filter((m) => m.character_id !== actor.id && m.importance >= 2).slice(-5).map((m) => `[${engine.clock.format(m.game_s)}] ${world.characters.get(m.character_id)?.name ?? '?'}: ${m.note}`),
        talking_to: n.talking_to ? (world.characters.get(n.talking_to.character_id)?.name ?? null) : null,
      };
    }
    case 'get_item': {
      const i = world.itemInstance(s('instance_id'));
      const d = world.itemDef(i.item_id);
      return { instance_id: i.id, item_id: d.id, name: d.name, type: d.type, size: d.size, weight_lb: d.weight_lb, quantity: i.quantity, state: i.state, location: i.location, container: d.container ?? null };
    }
    case 'who_is_here': {
      const pos = positionOf(world, actor, nowGameS);
      const out: unknown[] = [];
      for (const o of world.characters.values()) {
        if (o.id === actor.id || o.status === 'dead' || o.status === 'retired') continue;
        const op = positionOf(world, o, nowGameS);
        if (op.location_id !== pos.location_id) continue;
        const p = perceive(world, engine.clock, actor, op, nowGameS);
        if (p.level === 'none') continue;
        out.push({ id: o.id, name: p.sight === 'full' ? o.name : '(figura)', level: p.level, sight: p.sight, sound: p.sound, spot_id: op.spot_id, distance_m: Math.round(p.distance_m ?? 0), status: o.status });
      }
      for (const n of world.npcs.values()) {
        const ns = world.spot(n.location.id);
        if (ns.location_id !== pos.location_id || n.status !== 'alive') continue;
        const p = perceive(world, engine.clock, actor, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowGameS);
        if (p.level === 'none') continue;
        out.push({ id: n.id, name: p.sight === 'full' ? n.name : '(figura)', role: n.role, level: p.level, spot_id: ns.id, distance_m: Math.round(p.distance_m ?? 0) });
      }
      return out;
    }
    case 'get_recent_events': {
      const n = Math.max(1, Math.min(30, Number(input['n']) || 10));
      return engine.events.forCharacter(actor.id, null).slice(-n).map((d) => `[${engine.clock.format(d.event.timestamp_game_s)}] ${d.text}`);
    }
    case 'get_campaign_notes': {
      const camp = world.campaign;
      const ach = camp.achievement;
      const placeName = (id: Id) => world.locations.get(id)?.name ?? id;
      const npcName = (id: Id) => world.npcs.get(id)?.name ?? id;
      return {
        reputation: actor.reputation[ach.faction_id] ?? 0,
        achievement: { title: ach.title, clues_required: ach.clues_required, reputation_required: ach.reputation_required, done: actor.achievements.some((a) => a.id === ach.id) },
        clues_obtained: actor.clues.map((id) => camp.clues.find((x) => x.id === id)?.title ?? id),
        clues_pending: camp.clues.filter((x) => !actor.clues.includes(x.id)).map((x) => ({
          id: x.id, title: x.title, how: x.how,
          where: [...(x.location_ids ?? []).map(placeName), ...(x.npc_ids ?? []).map(npcName)],
        })),
        board: activeJobs(world).map((j) => ({
          id: j.id, title: j.title, text: j.text, giver: `${npcName(j.giver_npc_id)} [${j.giver_npc_id}]`, kind: j.kind,
          ...(j.deliver ? { deliver: `${world.itemDef(j.deliver.item_id).name} ×${j.deliver.quantity}` } : {}),
          ...(j.visit_spot_id ? { visit: world.spot(j.visit_spot_id).name } : {}),
          reward_coins: j.reward_coins, reward_reputation: j.reward_reputation, done_by_actor: actor.completed_jobs.includes(j.id),
        })),
      };
    }
    case 'plant_hook': {
      const opt = (k: string) => (input[k] == null || input[k] === '' ? null : String(input[k]));
      const r = plantHook(world, {
        location_id: opt('location_id') ?? here(), trigger: s('trigger') as 'time',
        minutes_from_now: input['minutes_from_now'] == null ? null : Number(input['minutes_from_now']),
        spot_id: opt('spot_id'), item_id: opt('item_id'), what: s('what'), for_character_id: opt('for_character_id'),
        expires_in_minutes: input['expires_in_minutes'] == null ? null : Number(input['expires_in_minutes']),
      }, nowGameS);
      return r.ok ? { ok: true, hook_id: r.hook.id } : { error: r.error };
    }
    case 'cancel_hook': return cancelHook(world, s('hook_id')) ? { ok: true } : { error: `no hay gancho ${s('hook_id')}` };
    case 'plant_rumor': {
      const r = plantRumor(world, {
        kind: s('kind'), name: s('name'), hint: s('hint'), where: input['where'] == null ? null : s('where'),
        location_id: here(), actor_id: actor.id, action: ctx.action_text ?? null, said_by_actor: input['said_by_actor'] === true,
      }, nowGameS);
      if (!r.ok) return { error: r.error };
      return { ok: true, rumor_id: r.rumor.id, existing: r.existing, mentions: r.rumor.mentions, left_today: rumorBudget(world, actor.id, nowGameS).left, note: r.rumor.said_by ? `Es lo que dice ${r.rumor.said_by.name}, no algo que está: no lo confirmes ni lo desmientas; el mundo dirá.` : 'Es algo que se dice, no algo que está: cuéntalo como habladuría y deja a quién preguntar.' };
    }
    case 'record_character_fact': {
      const r = recordFact(world, actor.id, { kind: s('kind'), text: s('text'), action: ctx.action_text ?? null }, nowGameS);
      if (!r.ok) return { error: r.error };
      return { ok: true, fact_id: r.fact.id, existing: r.existing, note: 'Verdad para este personaje, no para el mundo: no le da nada gratis.' };
    }
    case 'schedule_event': {
      const opt = (k: string) => (input[k] == null || input[k] === '' ? null : String(input[k]));
      const ids = (k: string) => s(k).split(',').map((x) => x.trim()).filter(Boolean);
      const r = addScheduledEvent(world, {
        title: s('title'), location_id: opt('location_id') ?? here(), spot_id: opt('spot_id'),
        start_h: Number(input['start_hour']), duration_min: Number(input['duration_min']), recurrence: s('recurrence'),
        weekday: opt('weekday'), days_from_now: input['days_from_now'] == null ? null : Number(input['days_from_now']),
        description: s('description'), npc_ids: ids('npc_ids'), crowd: opt('crowd'),
        noise: input['noise'] == null ? null : Number(input['noise']), busy_npc_ids: ids('busy_npc_ids'),
        start_text: opt('start_text'), end_text: opt('end_text'), announced_to: input['told_actor'] === true ? actor.id : null,
      }, nowGameS);
      if (!r.ok) return { error: r.error };
      return { ok: true, event_id: r.event.id, existing: r.existing, schedule: listSchedule(world, nowGameS, r.event.location_id).find((x) => x['id'] === r.event.id) };
    }
    case 'get_schedule': {
      const loc = input['location_id'] == null || input['location_id'] === '' ? null : s('location_id') === 'here' ? here() : s('location_id');
      return { events: listSchedule(world, nowGameS, loc) };
    }
    case 'lookup_rule': {
      const book = s('book') === 'phb' || s('book') === 'dmg' ? s('book') : null;
      const index = rulesIndex();
      return formatRuleHits(s('query'), searchRules(s('query'), { book, limit: 3 }, index), index);
    }
    case 'roll_dice': {
      const r = rollExpr(s('expr'), ctx.rng);
      ctx.rolls.push(r);
      const dc = input['dc'] == null ? null : Number(input['dc']);
      return { ...r, reason: s('reason'), dc, success: dc === null ? null : r.total >= dc };
    }
    case 'roll_check': {
      const c = world.character(s('character_id'));
      const r: CheckResult & { label: string } = characterCheck(c, s('kind') as CheckKind, s('kind') === 'skill' ? normalizeSkill(s('key')) : s('key'), input['dc'] == null ? null : Number(input['dc']), (s('advantage') || 'none') as Advantage, ctx.rng);
      ctx.rolls.push(r);
      return { character: c.name, check: r.label, breakdown: r.breakdown, total: r.total, success: r.success, natural: r.natural ?? null };
    }
    case 'move_to': {
      // Hacia una localización: hasta su punto de entrada, dentro (goto.ts). Un ID de localización en target_spot_id también vale.
      let targetSpot = s('target_spot_id') === 'null' ? '' : s('target_spot_id');
      const locId = s('target_location_id') && s('target_location_id') !== 'null' ? s('target_location_id') : !world.spots.has(targetSpot) && world.locations.has(targetSpot) ? targetSpot : '';
      const mover = world.characters.get(s('character_id'));
      // A otro jugador no se le mueve: llevárselo es request_reaction con destination_spot_id (él decide).
      if (mover && mover.id !== actor.id && !sharedWith(engine, actor.id).includes(mover.id)) return { error: 'other_player', hint: `${pcName(world, actor.id, mover)} es otro jugador: no lo muevas tú. Si el actor se lo lleva, request_reaction con destination_spot_id.` };
      if (locId && mover && (!targetSpot || world.spots.get(targetSpot)?.location_id !== locId)) {
        if (!world.locations.has(locId)) return { error: 'unknown_location', hint: `${locId} no es una localización. ${hereList(ctx)}` };
        const entry = entrySpot(world, mover, locId, s('pace') as 'walk', nowGameS);
        if (!entry) return { error: 'no_route', hint: `No hay forma de entrar en ${world.location(locId).name} desde aquí.` };
        targetSpot = entry.spot_id;
        if (!entry.reachable && !barrierToward(world, mover, targetSpot)) {
          const cut = blockedOnRoute(world, mover, targetSpot, s('pace') as 'walk', nowGameS);
          if (!cut) return { error: 'no_route', hint: `El paso hacia ${world.location(locId).name} está cerrado desde aquí: narra que no se puede.` };
          targetSpot = cut.spot_id; // hasta donde se puede llegar
        }
      }
      // Hacia el otro lado de una barrera que rebota (el Cerco): se intenta, se pierde el tiempo y se vuelve.
      const barrier = mover ? barrierToward(world, mover, targetSpot) : null;
      const bounce = barrier && mover ? bounceOff(world, mover, barrier, engine.gameNow()) : null;
      if (bounce) return { ok: true, rebound: true, spot: world.spot(bounce.spot_id).name, game_time_lost: fmtDuration(bounce.lost_s), hint: `No se cruza: el motor ya lo ha resuelto. Narra esto, sin añadir otra salida: ${bounce.text}` };
      const r = moveTo(world, s('character_id'), targetSpot, s('pace') as 'walk', nowGameS);
      if (!r.ok && r.error.code === 'unknown_spot') return { error: 'unknown_spot', detail: r.error, hint: `${targetSpot} no es un punto que el actor conozca. ${hereList(ctx)} Narra que no hay nada así; no lo inventes.` };
      if (!r.ok && r.error.code === 'locked') return { error: 'locked', detail: r.error, hint: `${world.spot(r.error.spot_id).name} está cerrado con llave para el actor: hace falta ${r.error.key_item_id ? world.itemDefs.get(r.error.key_item_id)?.name ?? r.error.key_item_id : 'la llave'} (la da quien vende su servicio, con buy_item o pawn_item)` };
      if (!r.ok) return { error: r.error.code, detail: r.error };
      return { ok: true, destination: world.spot(r.transit.destination_spot_id).name, game_time: fmtDuration(r.total_s), real_time: engine.fastTravel && r.transit.legs.some((l) => l.via_exit_id) ? 'ninguno: viaje rápido, llega al acabar esta acción (no le hagas esperar)' : fmtDuration(engine.clock.gameToReal(r.total_s)), legs: r.transit.legs.map((l) => world.spot(l.to_spot_id).name) };
    }
    case 'transfer_item': {
      const toType = s('to_type');
      let to: Placement;
      if (toType === 'character') {
        const slot = s('slot');
        const carry = slot === 'pocket' ? { kind: 'pocket' as const }
          : slot === 'equipped' ? { kind: 'equipped' as const, slot: s('equip_slot') as 'back' }
          : { kind: 'hand' as const, which: (slot === 'hand_off' ? 'off' : slot === 'hand_both' ? 'both' : 'main') as 'main' };
        to = { type: 'character', id: s('to_id'), slot: carry };
      } else to = { type: toType as 'spot', id: s('to_id') };
      if (toType === 'npc') {
        const miss = reachNpc(ctx, world.npc(s('to_id')));
        if (miss) return miss;
      }
      // A otro jugador no se le pone nada en la mano: se le ofrece y él decide (party.ts).
      if (toType === 'character' && s('to_id') !== actor.id && world.characters.has(s('to_id'))) {
        const inst = world.itemInstances.get(s('instance_id'));
        if (!inst || !world.itemsCarriedBy(actor.id).some((i) => i.id === inst.id)) return { error: 'not_carried', hint: 'Solo el actor puede ofrecer a otro jugador algo que lleve encima.' };
        const off = engine.offer(actor.id, s('to_id'), { instance_id: inst.id, ...(input['quantity'] == null ? {} : { quantity: Number(input['quantity']) }), coins: 0 }, ctx.action_text ?? null);
        if (!off.ok) return { error: 'offer_failed', hint: off.error };
        const to = world.character(s('to_id'));
        return { ok: true, pending_offer: true, item: off.offer.label, hint: `Queda OFRECIDO, no entregado: ${pcName(world, actor.id, to)} es otro jugador y decide si lo acepta. Narra que se lo tiendes; no narres que lo coge ni cómo reacciona.` };
      }
      const guard = lootGuard(ctx, s('instance_id'));
      if (guard) return guard;
      const r = transferItem(world, s('instance_id'), to, input['quantity'] == null ? undefined : Number(input['quantity']));
      if (!r.ok && r.error.code === 'not_reachable' && r.error.reason === 'no está a tu alcance') {
        // Lo que no está en el punto del actor: dónde está y adónde ir.
        const inst = world.itemInstances.get(s('instance_id'));
        const mine = world.characterSpot(actor)?.id;
        const from = inst ? world.spotOfItem(inst)?.id : undefined;
        const far = from && from !== mine ? from : spotOfPlacement(world, to)?.id;
        if (far) {
          const at = whereIs(ctx, far);
          return { error: 'not_reachable', detail: { reason: `está en ${at.name}, a ${at.distance_m} m: fuera de alcance`, distance_m: at.distance_m, go_to: at.spot_id }, hint: `move_to ${at.spot_id} primero; hasta que llegue, no ha ocurrido` };
        }
      }
      if (!r.ok) return { error: r.error.code, detail: r.error };
      return { ok: true, item: world.itemDef(r.moved.item_id).name, quantity: r.moved.quantity };
    }
    case 'spawn_item': {
      if (world.campaign.master.improvisation < 3) return { error: 'improvisation_too_low' };
      const r = spawnItem(world, s('item_id'), Math.max(1, Number(input['quantity']) || 1), { type: 'spot', id: s('spot_id') });
      if (!r.ok) return { error: r.error.code, detail: r.error };
      return { ok: true, instance_id: r.moved.id, item: world.itemDef(r.moved.item_id).name };
    }
    case 'update_spot_state': {
      const sp = world.spot(s('spot_id'));
      Object.assign(sp.state, JSON.parse(s('patch_json')) as Record<string, unknown>);
      world.touch('spots', sp.id);
      return { ok: true, state: sp.state };
    }
    case 'update_location_state': {
      const loc = world.location(s('location_id') === 'here' ? here() : s('location_id'));
      Object.assign(loc.state, JSON.parse(s('patch_json')) as Record<string, unknown>);
      world.touch('locations', loc.id);
      return { ok: true, state: loc.state };
    }
    case 'discover_spot': {
      const sp = world.spot(s('spot_id'));
      const cid = s('character_id');
      if (!sp.discovered_by.includes(cid)) { sp.discovered_by.push(cid); world.touch('spots', sp.id); }
      return { ok: true, spot: sp.name };
    }
    case 'harvest': {
      const c = world.character(s('character_id'));
      const node = world.resourceNode(s('node_id'));
      const check = characterCheck(c, 'skill', node.skill, node.dc, 'none', ctx.rng);
      ctx.rolls.push(check);
      const r = harvest(world, c, node.id, check.success === true, nowGameS);
      if (node.dc >= world.campaign.progression.practice_min_dc) { const pe = addPractice(world, c, node.skill); if (pe) ctx.progress.push(pe); }
      if (!r.ok) return { error: r.code, check: check.breakdown, regen: r.regen };
      return { ok: true, check: check.breakdown, quantity: r.quantity, item: world.itemDef(node.resource_item_id).name, regen_after: r.regen_after };
    }
    case 'grant_clue': {
      const r = grantClue(world, world.character(s('character_id')), s('clue_id'));
      if (!r.ok) return { error: r.reason };
      ctx.progress.push(...r.events);
      return { ok: true, events: r.events.map((e) => e.text) };
    }
    case 'advance_story': {
      const r = advanceStory(world, actor, s('quest_id'), s('step_id'), nowGameS);
      if (!r.ok) return { error: r.error };
      const mine = r.output.personal.filter((p) => p.character_id === actor.id).flatMap((p) => p.events);
      ctx.progress.push(...mine);
      engine.emitStory({ personal: r.output.personal.filter((p) => p.character_id !== actor.id), announcements: r.output.announcements });
      return { ok: true, events: mine.map((e) => e.text) };
    }
    case 'complete_job': {
      const missJ = s('character_id') === actor.id ? reachNpc(ctx, world.npc(s('npc_id'))) : null;
      if (missJ) return missJ;
      const r = completeJob(world, world.character(s('character_id')), s('job_id'), s('npc_id'));
      if (!r.ok) return { error: r.reason };
      ctx.progress.push(...r.events);
      return { ok: true, events: r.events.map((e) => e.text), board: activeJobs(world).map((j) => j.title) };
    }
    case 'give_quest': {
      const r = giveQuest(world, actor, { title: s('title'), text: s('text'), giver_npc_id: s('npc_id') || null, objective: s('objective') || null, reward: s('reward') || null }, nowGameS);
      if (!r.ok) return { error: 'bad_quest', hint: r.error };
      const giver = r.quest.giver_npc_id ? world.npcs.get(r.quest.giver_npc_id) : null;
      if (!r.existing) ctx.progress.push({ kind: 'quest', text: `Nueva misión: «${r.quest.title}»${giver ? ` (te la da ${actor.knows.includes(giver.id) ? giver.name : descriptorOf(world, giver.id)})` : ''}.` });
      return { ok: true, quest_id: r.quest.id, existing: r.existing, hint: 'Ya está en su Diario, en curso. No le preguntes si acepta.' };
    }
    case 'finish_quest': {
      const outcome = s('outcome') === 'failed' ? 'failed' : 'completed';
      const r = finishQuest(world, actor, s('quest_id'), outcome, nowGameS);
      if (!r.ok) return { error: 'unknown_quest', hint: r.error };
      ctx.progress.push({ kind: 'quest', text: outcome === 'completed' ? `Misión cumplida: «${r.quest.title}».` : `Misión fallida: «${r.quest.title}».` });
      return { ok: true };
    }
    case 'sell_item': {
      const missS = s('character_id') === actor.id ? reachNpc(ctx, world.npc(s('npc_id'))) : null;
      if (missS) return missS;
      const r = sellToNpc(world, world.character(s('character_id')), s('npc_id'), s('instance_id'), input['quantity'] == null ? undefined : Number(input['quantity']));
      return r.ok ? { ok: true, sold: `${r.item} ×${r.quantity}`, total: r.total } : { error: r.reason };
    }
    case 'buy_item': {
      const missB = s('character_id') === actor.id ? reachNpc(ctx, world.npc(s('npc_id'))) : null;
      if (missB) return missB;
      const r = buyFromNpc(world, world.character(s('character_id')), s('npc_id'), s('item_id'), Number(input['quantity']) || 1);
      return r.ok ? { ok: true, bought: `${r.item} ×${r.quantity}`, total: r.total, ...(r.unlocked.length ? { unlocked: r.unlocked } : {}) } : { error: r.reason };
    }
    case 'set_debt': {
      const due = input['due_in_hours'] == null ? null : nowGameS + Math.max(0, Number(input['due_in_hours'])) * 3600;
      const r = setDebt(world, actor, { npc_id: s('npc_id'), amount: input['amount'], reason: s('reason'), due_game_s: due }, nowGameS);
      return r.ok ? { ok: true, debt_id: r.debt.id, existing: r.existing, owes: fmtCoins(r.debt.amount) } : { error: r.error };
    }
    case 'pawn_item': {
      const npc = world.npc(s('npc_id'));
      const miss = reachNpc(ctx, npc);
      if (miss) return miss;
      const due = input['due_in_hours'] == null ? null : nowGameS + Math.max(0, Number(input['due_in_hours'])) * 3600;
      const r = pawnItem(world, actor, { npc_id: npc.id, instance_id: s('instance_id'), for_item_id: input['for_item_id'] ? s('for_item_id') : null, amount: input['amount'], reason: s('reason'), due_game_s: due }, nowGameS);
      if (!r.ok) return { error: r.error };
      return { ok: true, pawned: r.item, held_by: npc.name, received: r.received, ...(r.unlocked.length ? { unlocked: r.unlocked } : {}), owes: fmtCoins(r.debt.amount), debt_id: r.debt.id };
    }
    case 'settle_debt': {
      const npc = world.npc(s('npc_id'));
      if (s('how') !== 'forfeit') { const miss = reachNpc(ctx, npc); if (miss) return miss; }
      const r = settleDebt(world, actor, { npc_id: npc.id, how: s('how'), amount: input['amount'] }, nowGameS);
      if (!r.ok) return { error: r.error };
      return { ok: true, paid: r.paid, remaining: r.remaining, settled: r.settled, returned: r.returned, kept_by_npc: r.kept, coins_left: actor.coins };
    }
    case 'request_reaction': {
      if (engine.inReactionOutcome(actor.id)) return { error: 'Esto ya es el desenlace de una reacción: narra lo que ha pasado; no pidas otra.' };
      const to = world.characters.get(s('target_character_id'));
      if (!to || to.id === actor.id) return { error: 'target_character_id no es otro jugador presente. A un NPC no se le pide reacción: resuélvelo tú.' };
      const kind = ['grapple', 'shove', 'attack', 'other'].includes(s('kind')) ? s('kind') as ReactionKind : 'other';
      const dest = s('destination_spot_id') && s('destination_spot_id') !== 'null' ? s('destination_spot_id') : null;
      if (dest && !world.spots.has(dest)) return { error: 'unknown_spot', hint: `${dest} no es un punto. ${hereList(ctx)}` };
      const skills = (v: string) => v && v !== 'null' ? v.split(/\s*,\s*/).map(normalizeSkill).filter((k) => SKILLS[k]) : [];
      const contest = kind === 'other' && (skills(s('actor_skill')).length || skills(s('target_skills')).length)
        ? { actor: skills(s('actor_skill'))[0] ?? 'athletics', target: skills(s('target_skills')).length ? skills(s('target_skills')) : ['athletics', 'acrobatics'] }
        : undefined;
      const attempt = s('attempt').trim() || 'ponerte las manos encima';
      const r = engine.requestReaction(actor.id, to.id, { kind, attempt, input: ctx.action_text ?? null, dest_spot_id: dest, prone: kind === 'shove' && /suelo|derrib|tumb/i.test(attempt), ...(contest ? { contest } : {}) }, { announce: false });
      if (!r.ok) return { error: 'reaction_failed', hint: r.error };
      return { ok: true, pending_reaction: true, hint: `Queda PEDIDO, no hecho: ${pcName(world, actor.id, to)} es otro jugador y decide si se deja o se resiste. Narra solo el intento; no narres su reacción ni el resultado. Cierra con log_event sin requires_roll.` };
    }
    case 'attack': {
      const atk = world.characters.get(s('attacker_id'));
      // Un PJ que ataca a otro jugador fuera de una ronda: no se resuelve aquí, el otro decide (reactions.ts).
      const victim = world.characters.get(s('target_id'));
      if (atk && victim && victim.id !== atk.id && atk.id === actor.id && !sharedWith(engine, actor.id).includes(victim.id)) {
        if (engine.inReactionOutcome(actor.id)) return { error: 'El ataque ya está resuelto por el servidor (lo tienes en el resultado): narra lo que ha pasado.' };
        const r = engine.requestReaction(actor.id, victim.id, { kind: 'attack', attempt: 'atacarte', input: ctx.action_text ?? null }, { announce: false });
        if (!r.ok) return { error: 'reaction_failed', hint: r.error };
        return { ok: true, pending_reaction: true, hint: `Contra otro jugador no se ataca sin más: queda PEDIDO y ${pcName(world, actor.id, victim)} decide si se defiende. Narra solo el intento (se lanza, levanta el arma); no narres el golpe ni su reacción.` };
      }
      // Un PJ ausente no ataca ni gasta recursos: solo se defiende.
      if (atk && atk.away) return { error: `${atk.name} está ausente: no ataca ni gasta recursos; si le atacan, se defiende solo` };
      if (atk) {
        // Cuerpo a cuerpo hay que estar en el mismo punto; a distancia basta la misma localización.
        const tc = world.characters.get(s('target_id'));
        const tgtSpot = world.npcs.get(s('target_id'))?.location.id ?? (tc ? world.characterSpot(tc)?.id : undefined);
        const mine = world.characterSpot(atk);
        if (tgtSpot && mine && tgtSpot !== mine.id) {
          const t = world.spot(tgtSpot);
          const d = Math.round(distance(mine, t));
          const ranged = world.itemsCarriedBy(atk.id).some((i) => i.location.type === 'character' && i.location.slot.kind === 'hand' && world.itemDef(i.item_id).weapon?.ranged);
          if (t.location_id !== mine.location_id) return { error: 'not_reachable', detail: { reason: 'el objetivo no está en esta localización', distance_m: null, go_to: null } };
          if (!ranged) return { error: 'not_reachable', detail: { reason: `el objetivo está en ${t.name}, a ${d} m: fuera del alcance de un arma cuerpo a cuerpo`, distance_m: d, go_to: t.id }, hint: `move_to ${t.id} primero (o un arma a distancia); hasta que llegue, no ha atacado` };
        }
      }
      const r = resolveAttack(world, s('attacker_id'), s('target_id'), (ADV.includes(s('advantage')) ? s('advantage') : 'none') as Advantage, ctx.rng, nowGameS);
      if ('error' in r) return { error: r.error };
      ctx.rolls.push({ expr: 'attack', total: r.attack_total, breakdown: r.attack_breakdown, rolls: [] });
      return r;
    }
    case 'apply_damage': {
      const npcT = world.npcs.get(s('target_id'));
      if (npcT) {
        if (!npcT.stats) return { error: 'ese NPC no tiene puntos de golpe' };
        npcT.stats.hp = Math.max(0, npcT.stats.hp - Math.max(0, Math.floor(Number(input['amount']) || 0)));
        if (npcT.stats.hp === 0) { npcT.status = 'dead'; for (const i of world.itemsIn({ type: 'npc', id: npcT.id })) { i.location = { type: 'spot', id: npcT.location.id }; world.touch('item_instances', i.id); } }
        world.touch('npcs', npcT.id);
        return { ok: true, hp: `${npcT.stats.hp}/${npcT.stats.hp_max}`, status: npcT.status };
      }
      const c = world.character(s('target_id'));
      if (c.veiled) return { error: `${c.name} está bajo el velo: no puede recibir daño` };
      if (c.status === 'dead') return { error: `${c.name} ya está muerto` };
      const r = damageCharacter(world, c, Number(input['amount']) || 0, { cause: s('source') || s('damage_type') || 'daño', nowGameS });
      return {
        ok: true, hp: `${c.hp_current}/${c.hp_max}`, status: c.status,
        ...(r.down ? { down: true, note: c.away ? 'está ausente: cae y queda estable (no muere ausente)' : 'cae a 0 PG: inconsciente; el servidor tira sus salvaciones contra muerte' } : {}),
        ...(r.failures ? { death_save_failures: r.failures, note: 'ya estaba a 0 PG: suma fallos de salvación contra muerte' } : {}),
        ...(r.died ? { died: true, note: 'ha muerto: el servidor lo cuenta y deja su cuerpo; narra el golpe, no su vuelta' } : {}),
      };
    }
    case 'heal': {
      const npcH = world.npcs.get(s('target_id'));
      if (npcH) {
        if (!npcH.stats) return { error: 'ese NPC no tiene puntos de golpe' };
        npcH.stats.hp = Math.min(npcH.stats.hp_max, npcH.stats.hp + Math.max(0, Math.floor(Number(input['amount']) || 0)));
        world.touch('npcs', npcH.id);
        return { ok: true, hp: `${npcH.stats.hp}/${npcH.stats.hp_max}` };
      }
      const c = world.character(s('target_id'));
      if (c.status === 'dead') return { error: `${c.name} está muerto: ninguna curación le devuelve; vuelve solo, por el servidor, cuando acabe su espera` };
      const healerId = input['healer_id'] ? s('healer_id') : actor.id;
      const healer = world.characters.get(healerId)?.name ?? world.npcs.get(healerId)?.name ?? actor.name;
      const r = healCharacter(world, c, Number(input['amount']) || 0, healer);
      return { ok: true, hp: `${c.hp_current}/${c.hp_max}`, status: c.status, ...(r.revived ? { revived: true } : {}) };
    }
    case 'stabilize': {
      const c = world.character(s('target_id'));
      if (!isDying(c)) return { error: c.status === 'dead' ? `${c.name} está muerto` : c.hp_current > 0 ? `${c.name} no está a 0 PG` : `${c.name} ya está estable` };
      if (world.characterSpot(c)?.location_id !== here()) return { error: `${c.name} no está aquí` };
      const pc = world.characters.get(s('healer_id'));
      const npc = world.npcs.get(s('healer_id'));
      if (pc) {
        if (pc.status !== 'active') return { error: `${pc.name} no puede atenderle (${pc.status})` };
        const roll = characterCheck(pc, 'skill', 'medicine', medicineDc(), 'none', ctx.rng);
        ctx.rolls.push({ expr: 'medicine', total: roll.total, breakdown: roll.breakdown, rolls: [] });
        if (!roll.success) return { ok: true, stabilized: false, roll: roll.breakdown, note: 'falla la Medicina: sigue cayendo (puede volver a intentarlo)' };
        stabilize(world, c, nowGameS, pc.name, `estabilizado por ${pc.name}`, ctx.rng);
        return { ok: true, stabilized: true, roll: roll.breakdown };
      }
      if (npc && npc.status === 'alive') { stabilize(world, c, nowGameS, npc.name, `estabilizado por ${npc.name}`, ctx.rng); return { ok: true, stabilized: true }; }
      return { error: `nadie llamado ${s('healer_id')} puede atenderle` };
    }
    case 'take_rest': {
      const r = engine.restByMaster(actor, s('kind') === 'long' ? 'long' : 'short');
      return 'error' in r ? { error: r.error } : r;
    }
    case 'spend_resource': {
      const r = spendResource(world, actor, s('key'), input['amount'] == null ? 1 : Number(input['amount']));
      return r.ok ? { ok: true, resource: r.label, left: r.left } : { error: r.error };
    }
    case 'add_condition': {
      const c = world.character(s('target_id'));
      const mins = input['duration_game_min'] == null ? null : Number(input['duration_game_min']);
      c.conditions = c.conditions.filter((x) => x.name !== s('name'));
      c.conditions.push({ name: s('name'), source: s('source'), expires_game_s: mins === null ? null : nowGameS + mins * 60 });
      world.touch('characters', c.id);
      return { ok: true, conditions: c.conditions.map((x) => x.name) };
    }
    case 'remove_condition': {
      const c = world.character(s('target_id'));
      c.conditions = c.conditions.filter((x) => x.name !== s('name'));
      world.touch('characters', c.id);
      return { ok: true, conditions: c.conditions.map((x) => x.name) };
    }
    case 'log_event': {
      const kind = input['requires_roll_kind'];
      const req = kind && ROLL_KINDS.includes(String(kind))
        ? { kind: String(kind) as CheckKind, key: String(kind) === 'skill' ? normalizeSkill(s('requires_roll_key')) : s('requires_roll_key'), dc: input['requires_roll_dc'] == null ? null : Number(input['requires_roll_dc']), advantage: (ADV.includes(s('requires_roll_advantage')) ? s('requires_roll_advantage') : 'none') as Advantage, ...(input['requires_roll_target'] ? { target: s('requires_roll_target') } : {}) }
        : null;
      if (req?.kind === 'attack' && !req.target) return { error: 'un ataque necesita requires_roll_target (ID del objetivo)' };
      if (req?.kind === 'attack' && req.target !== actor.id && world.characters.has(req.target!) && !sharedWith(engine, actor.id).includes(req.target!)) return { error: 'Contra otro jugador no se pide tirada de ataque: usa request_reaction (kind attack) y él decide si se defiende; cierra sin requires_roll.' };
      if (req?.target && !world.npcs.has(req.target) && !world.characters.has(req.target)) return { error: `objetivo desconocido: ${req.target}` };
      if (req && req.kind === 'skill' && !SKILLS[req.key]) return { error: `skill desconocida: ${req.key}. Válidas: ${Object.keys(SKILLS).join(', ')}` };
      // Trato cerrado en la narración sin tool que lo registre, y desenlace que no respeta la tirada: se reescribe una vez cada uno.
      if ((ctx.deal_rejections ?? 0) < 1) {
        const deal = dealWithoutState({ narration: s('narration_private'), lines: parseLines(input['lines'], null, (id) => world.npcs.has(id)), okTools: ctx.ok_tools ?? [], pendingRoll: req !== null, hasOpenDebt: openDebts(actor).length > 0 });
        if (deal.length) {
          ctx.deal_rejections = (ctx.deal_rejections ?? 0) + 1;
          return { error: `${DEAL_REJECTION} (La narración dice ${deal.map((w) => `«${w}»`).join(', ')}.)` };
        }
      }
      if ((ctx.outcome_rejections ?? 0) < 1 && ctx.roll_category) {
        const bad = outcomeMismatch(ctx.roll_category, s('narration_private'));
        if (bad.length) {
          ctx.outcome_rejections = (ctx.outcome_rejections ?? 0) + 1;
          return { error: outcomeRejection(ctx.roll_category, bad) };
        }
      }
      // Muerte o vuelta de un PJ sin estado: se reescribe dos veces; si insiste, esas frases se quitan.
      const deathHits: DeathHit[] = deathNarration({
        texts: [s('narration_private'), input['observable'] == null ? '' : s('observable'), input['observable_target'] == null ? '' : s('observable_target')],
        actor: { name: actor.name, dead: actor.status === 'dead' },
        others: [...world.characters.values()].filter((o) => o.id !== actor.id).map((o) => ({ name: o.name, dead: o.status === 'dead' })),
      });
      if (deathHits.length && (ctx.death_rejections ?? 0) < 2) {
        ctx.death_rejections = (ctx.death_rejections ?? 0) + 1;
        return { error: deathRejection(deathHits) };
      }
      // Otro jugador no lo mueve el máster: ni actos, ni palabras, ni miradas, ni esperas que no consten. Se reescribe una vez.
      if ((ctx.others_rejections ?? 0) < 1) {
        // En un turno compartido, los que participan han dicho qué hacen: se cuenta; los demás, no.
        const shared = sharedWith(engine, actor.id);
        const others = othersForCheck(world, engine.events.recentInLocation(here(), 30), actor).filter((o) => !shared.includes(o.id));
        const npcRefs = [...world.npcs.values()].filter((n) => world.spot(n.location.id).location_id === here()).flatMap((n) => [n.name, n.role]);
        const acted = actedForOthers({ texts: [s('narration_private'), input['observable'] == null ? '' : s('observable'), input['observable_target'] == null ? '' : s('observable_target')], others, actorRefs: [actor.name], npcRefs });
        if (acted.length) {
          ctx.others_rejections = (ctx.others_rejections ?? 0) + 1;
          return { error: actedForRejection(acted) };
        }
      }
      // Lugares que la narración da por existentes y no están en los datos: se reescribe una vez.
      if ((ctx.place_rejections ?? 0) < 1) {
        const invented = inventedPlaces(world, here(), [s('narration_private'), input['observable'] == null ? '' : s('observable')].join('\n'));
        if (invented.length) {
          ctx.place_rejections = (ctx.place_rejections ?? 0) + 1;
          return { error: `La narración cita ${invented.map((w) => `«${w}»`).join(', ')}, que no existe en ${world.location(here()).name}. ${hereList(ctx)} Reescribe log_event sin ese lugar: si el jugador lo busca, di en ficción que no lo hay (o lo que sí hay).` };
        }
      }
      // En conversación el narrador solo entra cuando aporta: relleno o narración larga se reescriben una vez; vacía con lines vale.
      if ((ctx.conversation_rejections ?? 0) < 1) {
        const conv = conversationOf(engine.events.all(), actor.id, positionOf(world, actor, nowGameS));
        const npcId = input['npc_id'] && world.npcs.has(s('npc_id')) ? s('npc_id') : null;
        const lines = parseLines(input['lines'], npcId, (id) => world.npcs.has(id));
        const p = conversationCheck({ conversation: conv, narration: s('narration_private'), lines, npcId, okTools: ctx.ok_tools ?? [], attack: req?.kind === 'attack', rollOutcome: Boolean(ctx.roll_category) });
        if (p && conv) {
          ctx.conversation_rejections = (ctx.conversation_rejections ?? 0) + 1;
          const npc = world.npcs.get(conv.npc_id);
          return { error: conversationRejection(p, !npc ? 'ese personaje' : actor.knows.includes(npc.id) ? npc.name : descriptorOf(world, npc.id)) };
        }
      }
      if (input['npc_id']) {
        const npc = world.npcs.get(s('npc_id'));
        // Habla con alguien de la sala que está a unos metros: el motor lo acerca antes (si no es hostil).
        if (npc && npc.status === 'alive' && world.spot(npc.location.id).location_id === here()) reachNpc(ctx, npc);
        if (npc) {
          // Conversación de grupo (scene.ts): quien habla pasa a llevarla y los demás siguen unidos.
          const prev = npc.talking_to;
          const group = prev && (prev.character_id === actor.id || prev.with?.includes(actor.id)) ? [prev.character_id, ...(prev.with ?? [])].filter((id) => id !== actor.id) : [];
          npc.talking_to = { character_id: actor.id, since_game_s: nowGameS, ...(group.length ? { with: group } : {}) };
          const note = input['npc_memory_note'] == null ? '' : cleanText(s('npc_memory_note'));
          if (note) {
            const imp = Math.min(3, Math.max(1, Math.round(Number(input['npc_memory_importance']) || 1))) as 1 | 2 | 3;
            npc.memory.push({ character_id: actor.id, game_s: nowGameS, note, importance: imp });
            // Topes: por PJ (se descartan las menos importantes y más viejas) y por NPC.
            const mine = npc.memory.filter((m) => m.character_id === actor.id);
            if (mine.length > MEMORY_CAP_PER_CHARACTER) {
              const drop = [...mine].sort((a, b) => a.importance - b.importance || a.game_s - b.game_s)[0]!;
              npc.memory = npc.memory.filter((m) => m !== drop);
            }
            if (npc.memory.length > MEMORY_CAP_PER_NPC) {
              const drop = [...npc.memory].sort((a, b) => a.importance - b.importance || a.game_s - b.game_s)[0]!;
              npc.memory = npc.memory.filter((m) => m !== drop);
            }
          }
          world.touch('npcs', npc.id);
        }
      }
      if (input['names_learned']) {
        for (const id of s('names_learned').split(',').map((x) => x.trim()).filter(Boolean)) {
          if ((world.npcs.has(id) || world.characters.has(id)) && id !== actor.id && !actor.knows.includes(id)) actor.knows.push(id);
        }
        world.touch('characters', actor.id);
      }
      if (input['places_learned']) {
        for (const id of s('places_learned').split(',').map((x) => x.trim()).filter(Boolean)) {
          const loc = world.locations.get(id);
          if (!loc || loc.discovery[actor.id] === 'visited' || loc.discovery[actor.id] === 'heard_of') continue;
          loc.discovery[actor.id] = 'heard_of';
          world.touch('locations', loc.id);
        }
      }
      if (input['introduces_self'] === true) {
        const at = positionOf(world, actor, nowGameS);
        for (const w of witnessesOf(engine, at, nowGameS, actor.id)) {
          if (!w.knows.includes(actor.id)) { w.knows.push(actor.id); world.touch('characters', w.id); }
        }
      }
      const approached = ctx.approach && !/\bacerc/i.test(s('narration_private')) ? `Te acercas ${aEs(world.spot(ctx.approach.to_spot_id).name)}. ` : '';
      const closingNpc = input['npc_id'] && world.npcs.has(s('npc_id')) ? s('npc_id') : null;
      // «Hablar con Aren» es lo que quiere hacer, no algo que diga: fuera de lines.
      const sharedIds = sharedWith(engine, actor.id);
      const closingLines = parseLines(input['lines'], closingNpc, (id) => world.npcs.has(id), (id) => sharedIds.includes(id))
        .map((l) => (l.speaker === 'pc' && l.character_id === actor.id ? { speaker: 'actor' as const, text: l.text } : l))
        .filter((l) => l.speaker !== 'actor' || !INTENT_LINE.test(l.text));
      const targetPc = input['target_character_id'] && world.characters.has(s('target_character_id')) && s('target_character_id') !== actor.id ? s('target_character_id') : null;
      ctx.closed = {
        // Lo dicho que no va citado en la narración (en conversación puede ir vacía) se guarda como citas.
        narration_private: approached + narrationWithLines(withoutDeathPhrases(cleanText(s('narration_private')), deathHits), closingLines),
        observable: input['observable'] == null ? null : withoutDeathPhrases(cleanText(s('observable')), deathHits) || null,
        observable_vague: input['observable_vague'] == null ? null : cleanText(s('observable_vague')) || null,
        loudness: Number(input['loudness']) || 1,
        tags: s('tags').split(',').map((t) => t.trim()).filter(Boolean),
        // Esperar o unirse a un NPC ocupado con otro jugador lo ofrecen los botones del motor (scene.ts), no el máster.
        suggested_actions: s('suggested_actions').split('|').map((t) => t.trim()).filter(Boolean).filter((t) => !(busyHere(engine, actor, nowGameS) && /^(esperar|aguardar|unirme|unirse|sumarme)\b/i.test(t))).slice(0, 4),
        requires_roll: req,
        decisive: input['decisive_threat'] ? { threat: cleanText(s('decisive_threat')), npc_id: input['decisive_npc_id'] ? s('decisive_npc_id') : null } : null,
        npc_id: closingNpc,
        lines: closingLines,
        ...(targetPc ? { target_character_id: targetPc, observable_target: input['observable_target'] == null ? null : cleanText(s('observable_target')) || null } : {}),
      };
      return { ok: true, closed: true };
    }
    default:
      return { error: `tool desconocido: ${name}` };
  }
}

