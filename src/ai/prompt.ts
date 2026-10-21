/**
 * Ensamblado del prompt por acción (SPEC §8). El bloque de sistema es estable
 * por campaña y va cacheado; todo lo que cambia va en el mensaje de usuario.
 */

import type { Engine } from '../engine/engine.js';
import type { CheckResult } from '../engine/dice.js';
import type { Campaign, Character, Clue, Id } from '../engine/model.js';
import { positionOf } from '../engine/movement.js';
import { lightAt, perceive, witnesses } from '../engine/perception.js';
import { regenState } from '../engine/resources.js';
import { inventoryDetailed, inventoryView } from '../engine/inventory.js';
import { SKILLS, armorClass } from '../engine/rules.js';
import { activeJobs } from '../engine/progress.js';
import { descriptorOf } from '../engine/narrate.js';
import { attitudeOf } from '../engine/combat.js';
import { describeHook } from '../engine/hooks.js';
import { RULES_CHEATSHEET } from './rules-cheatsheet.js';

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
    'PRINCIPIO RECTOR: la base de datos es la verdad. Solo existe lo que los tools devuelven. Nunca describas puntos, salidas, objetos, NPCs o personajes que no estén en los datos. Si el jugador menciona algo que no existe, dilo en ficción ("no ves nada así") en vez de inventarlo.',
    '',
    'REGLAS DURAS:',
    '1. Resuelve solo la acción de este mensaje. Una acción por turno. No decidas nada por el jugador ni le hagas hablar.',
    '2. Cualquier cambio en el mundo (posición, objetos, estado de un punto, PG, condiciones) se hace con el tool correspondiente ANTES de narrarlo. Si el tool falla, narra el fallo; no narres lo que no ocurrió.',
    '3. Intención antes de efecto: si la acción es ambigua o le falta objetivo, no ejecutes nada; pregunta en la narración y ofrece opciones en suggested_actions.',
    '4. Si la acción tiene riesgo o resultado incierto, NO la resuelvas: cierra con log_event indicando requires_roll (tipo, skill, CD oculta). La narración de ese cierre describe el momento previo ("te agachas ante la cerradura…"). El servidor tirará y te llamará de nuevo con el resultado para que narres la consecuencia. Lo trivial (andar, hablar, mirar, coger algo del suelo) no requiere tirada.',
    '5. Percepción: el contexto te dice a qué nivel percibe el actor a cada presente (full/vague/hint). En vague no nombres a la persona; en hint solo hay movimiento. Los testigos recibirán tu texto "observable" solo si perciben la acción.',
    '6. Moverse cuesta tiempo. Tras move_to, narra que se pone en camino con el tiempo que devuelve el tool; la llegada la narrará el servidor.',
    '7. No rompas la cuarta pared. No hables de tools, IDs, reglas ni de ti mismo como IA. Si el jugador escribe algo fuera de la ficción, responde brevemente en ficción o redirige.',
    '8. Cierra SIEMPRE con log_event, una sola vez, y no escribas texto fuera de él. Sin log_event la acción no existe.',
    '',
    'PROTOCOLO: lee el contexto; si te falta información concreta (qué hay en un punto, la ficha de un NPC) usa los tools de lectura; ejecuta los cambios con tools de escritura; termina con log_event. Para dudas de reglas mira primero REGLAS DE REFERENCIA; si no está ahí, usa lookup_rule con una consulta concreta y no pidas más de lo necesario.',
    'GANCHOS: lo trivial (moverse entre puntos, salir por una salida, coger o soltar, esperar, llegar a un sitio ya visitado) lo resuelve el servidor sin llamarte. Para que el mundo siga vivo, siembra con plant_hook lo que deba pasar después: alguien que llega a una hora, una consecuencia al acercarse a un sitio o al coger algo. Con mesura: uno o dos por escena como mucho, y nunca para empujar al jugador hacia un secreto.',
    'IMPARCIALIDAD: sabes cosas que los personajes no saben (secretos, motivaciones). Eres neutral: no guías al jugador hacia ellas, no las insinúas con el ambiente ni con las acciones sugeridas, no premias ni castigas por acercarse. El mundo reacciona a lo que el jugador hace, no a lo que tú sabes.',
    'COMBATE: no hay turnos; es conversación. Un NPC hostil en el mismo punto (o que llega hasta el actor) actúa: resuelve su ataque con attack y narra. El ataque del jugador va con requires_roll kind=attack y requires_roll_target; el servidor tira contra la CA y aplica el daño; tú narras el resultado que te devuelve. Huir es move_to (el enemigo puede perseguir). A 0 PG el PJ cae inconsciente. Ventana decisiva (decisive_threat): solo con una amenaza real e inmediata contra el actor, nunca dos seguidas; si no responde en 60 s, la amenaza se ejecuta.',
    'PROGRESO: recolectar (harvest) tira solo y cuenta práctica. Los encargos del tablón se cierran con complete_job al entregarlos al NPC que los pidió; los de entrega los valida el servidor. Las pistas se conceden con grant_clue únicamente cuando el jugador las ha obtenido con sus actos. Vender y comprar: sell_item y buy_item con los precios del NPC; el master no negocia fuera de esa lista salvo una tirada de Persuasión que como mucho mueve un 10 %. El contexto solo trae las pistas de este lugar o de quien está delante y los títulos del tablón: si el jugador busca otra pista, pregunta por un encargo o va a entregarlo, consulta get_campaign_notes antes de responder.',
    'NOMBRES: el actor solo conoce los nombres marcados como conocidos. A los demás los nombras por lo que se ve (la tabernera, el guardia del portón, un humano con pinta de guerrero), también en suggested_actions. Un nombre se aprende cuando alguien se presenta o lo nombra: entonces va en names_learned. Si el actor dice su propio nombre, introduces_self=true.',
    'NPCs: interprétalos según su descripción, lo que quieren y lo que recuerdan. Si el actor habla con uno, pon su ID en npc_id; y solo si esa persona recordaría algo de la conversación, escríbelo en npc_memory_note con su importancia. Un NPC atiende a una persona a la vez: si está ocupado con otro, responde en ficción que espere, salvo motivo de peso.',
    'En log_event: narration_private para el actor; observable para testigos con detalle completo (tercera persona, con nombre); observable_vague para quien solo ve una figura. suggested_actions: 2-4 cosas que ESTE personaje querría hacer AHORA MISMO, en esta situación concreta y desde donde está: reacciones inmediatas a lo que acaba de pasar, no planes ni siguientes pasos de la historia. En infinitivo y breves ("Registrar el cofre", "Preguntar a Brenna por el incendio", "Guardar las bayas").',
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

function boardLine(jobs: string[]): string {
  return jobs.length ? `Tablón: ${jobs.join(' · ')}.` : 'Tablón: vacío.';
}

export function actionContext(engine: Engine, actor: Character, text: string, roll?: RollContext, intro?: { origin: string; welcome: string }, scene?: Scene, decisive?: DecisiveResponse): string {
  const world = engine.world;
  const nowG = engine.gameNow();
  const pos = positionOf(world, actor, nowG);
  const loc = world.location(pos.location_id);
  const spot = world.spot(pos.spot_id);
  const L: string[] = [];

  L.push(`## Tiempo\n${engine.clock.format(nowG)}. Luz: ${lightAt(engine.clock, loc, nowG)}. 1 h real = 3 h de juego.`);

  // La luz real ya va en Tiempo; el estado solo si hay algo.
  L.push(`## Localización: ${loc.name} (${loc.id})\n${loc.description_base}\nAmbiente: ruido ${loc.ambience.noise}${loc.ambience.smell ? `, olor a ${loc.ambience.smell}` : ''}.${Object.keys(loc.state).length ? ` Estado: ${JSON.stringify(loc.state)}` : ''}`);
  const spots = world.spotsOf(loc.id).filter((s) => !s.hidden || s.discovered_by.includes(actor.id));
  L.push('Puntos:\n' + spots.map((s) => {
    const items = world.itemsIn({ type: 'spot', id: s.id }).map((i) => `${world.itemDef(i.item_id).name}${i.quantity > 1 ? ` ×${i.quantity}` : ''} [${i.id}]`);
    const nodes = [...world.resourceNodes.values()].filter((n) => n.spot_id === s.id).map((n) => `${n.name} ${Math.round(regenState(n, nowG) * 100)}% [${n.id}]`);
    const d = Math.round(Math.hypot(s.x - pos.x, s.y - pos.y));
    const st = Object.keys(s.state).length ? ` estado ${JSON.stringify(s.state)}` : '';
    return `- ${s.name} [${s.id}]${s.id === spot.id ? ' ← actor aquí' : ` a ${d} m`}: ${s.description}${st}${items.length ? ` Objetos: ${items.join(', ')}.` : ''}${nodes.length ? ` Recursos: ${nodes.join(', ')}.` : ''}`;
  }).join('\n'));
  const exits: string[] = [];
  for (const s of world.spotsOf(loc.id)) for (const { exit, to_spot_id } of world.exitsFrom(s.id)) {
    exits.push(`- desde ${s.name} a ${world.locationOfSpot(to_spot_id).name} [${to_spot_id}], ${exit.distance_m} m${exit.state.blocked_by ? `, bloqueada (${exit.state.blocked_by})` : ''}`);
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
    const known = actor.knows.includes(o.id);
    const name = p.sight === 'full' ? (known ? `${o.name} [${o.id}], ${o.race} ${o.class_name}` : `${descriptorOf(world, o.id)} [${o.id}] (el actor NO sabe su nombre, que es ${o.name}: no lo uses)`) + (o.appearance ? `, ${o.appearance}` : '') : p.sight === 'vague' ? 'una figura' : 'movimiento';
    present.push(`- ${name} en ${world.spot(op.spot_id).name}, ${Math.round(p.distance_m ?? 0)} m, percepción ${p.level} (vista ${p.sight}, oído ${p.sound})${o.status === 'asleep' ? ', dormido' : ''}${o.transit ? ', en movimiento' : ''}`);
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
    const busy = n.talking_to && n.talking_to.character_id !== actor.id ? ` OCUPADO hablando con ${world.characters.get(n.talking_to.character_id)?.name ?? 'alguien'}: atiende al actor solo si hay motivo, si no le pide que espere.` : '';
    const knownNpc = actor.knows.includes(n.id);
    present.push([
      `- NPC ${knownNpc ? `${n.name} [${n.id}], ${n.role}` : `${descriptorOf(world, n.id)} [${n.id}] (el actor NO sabe su nombre, que es ${n.name}: llámala por lo que se ve; si se presenta o alguien la nombra, ponlo en names_learned)`}, en ${ns.name}, ${Math.round(p.distance_m ?? 0)} m. ${n.description}`,
      `  Quiere: ${dot(n.motivation)} Actitud: ${attitudeOf(n, actor.id)}.${n.stats ? ` Combate: CA ${n.stats.ac}, PG ${n.stats.hp}/${n.stats.hp_max}, ${n.stats.attack_name} +${n.stats.attack_bonus} (${n.stats.damage}).` : ' No combate.'}`,
      n.buys.length ? `  Compra: ${n.buys.map((b) => `${world.itemDef(b.item_id).name} a ${b.price}`).join(', ')}` : '',
      n.sells.length ? `  Vende: ${n.sells.map((b) => `${world.itemDef(b.item_id).name} [${b.item_id}] a ${b.price}`).join(', ')}` : '',
      n.secret ? `  Solo tú sabes (NUNCA lo reveles ni lo insinúes por tu cuenta): ${dot(n.secret)} Sale solo a medias y si se lo gana: confianza en varias charlas, presión creíble o tirada social contra CD alta.` : '',
      `  Recuerda de ${actor.name}: ${mine.length ? mine.join(' · ') : 'nada, es la primera vez que hablan'}`,
      others.length ? `  Recuerda de otros: ${others.join(' · ')}` : '',
      busy,
    ].filter(Boolean).join('\n'));
  }
  // Testigos: otros PJs que percibirían al actor aunque gritara. Sin ninguno, observable no le llega a nadie y es salida tirada.
  if (!witnesses(world, engine.clock, pos, nowG, WITNESS_LOUDNESS, actor.id).length) present.push(NO_WITNESSES);
  L.push('## Presentes que el actor percibe\n' + (present.length ? present.join('\n') : 'Nadie.'));

  const inv = inventoryView(world, actor.id);
  const skills = Object.keys(SKILLS).filter((k) => actor.proficiencies.skills.includes(k) || actor.proficiencies.expert.includes(k)).map((k) => SKILLS[k]!.es);
  L.push([
    `## Actor: ${actor.name} [${actor.id}]`,
    `${actor.race} ${actor.class_name} nivel ${actor.level}. PG ${actor.hp_current}/${actor.hp_max}${actor.hp_temp ? ` (+${actor.hp_temp} temp)` : ''}. CA ${armorClass(world, actor)}. Estado: ${actor.status}${actor.conditions.length ? `; condiciones: ${actor.conditions.map((x) => x.name).join(', ')}` : ''}.`,
    `FUE ${actor.abilities.str} DES ${actor.abilities.dex} CON ${actor.abilities.con} INT ${actor.abilities.int} SAB ${actor.abilities.wis} CAR ${actor.abilities.cha}. Competente en: ${skills.join(', ') || 'nada'}.`,
    actor.appearance ? `Aspecto: ${actor.appearance}` : '',
    actor.backstory ? `Historia: ${actor.backstory}` : '',
    `Manos: ${inv.hands.main ?? '—'} / ${inv.hands.off ?? '—'}. Monedas: ${inv.coins}. Carga: ${inv.encumbrance.level}.`,
    'Inventario (IDs para transfer_item):\n' + (inventoryDetailed(world, actor.id).map((i) => `- ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''} [${i.instance_id}] (${i.where})`).join('\n') || '- nada'),
    actor.transit ? `En camino hacia ${world.spot(actor.transit.destination_spot_id).name}.` : '',
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

  if (intro) {
    L.push([
      '## Primera escena',
      `${actor.name} acaba de entrar en la partida. Origen: ${intro.origin}`,
      `Acaba de leer esta bienvenida, en tono místico: «${intro.welcome.replace(/\s+/g, ' ')}». No repitas sus imágenes ni sus ideas: empieza donde eso termina, con tono serio y concreto.`,
      'Quien lee no conoce todavía este mundo ni sus nombres, y quiere jugar YA. Por eso: nada de dichos, refranes, leyendas ni nombres de lugares como apertura. La primera frase es algo que le está pasando al personaje en este instante, en el cuerpo o en los sentidos (frío, hambre, un ruido, un olor, algo que ve moverse). Los nombres de sitios aparecen solo cuando importan y explicados por lo que son, no por lo que se cuenta de ellos.',
      'Sitúalo donde está tal como está ahora (luz, quién anda por ahí) con dos o tres detalles concretos, no un inventario. Termina con un gancho: algo que acaba de ocurrir o está ocurriendo delante de él y que pide una decisión ahora mismo. La premisa de la campaña puede asomar en ese gancho, nunca explicada.',
      'Exactamente dos párrafos cortos, 80 palabras en total como máximo. Sin tirada. Con 3-4 acciones sugeridas, concretas y con verbo. No lo hagas actuar ni hablar; solo llega.',
    ].join('\n'));
  } else if (scene === 'decisive_timeout') {
    L.push([
      '## Ventana decisiva expirada',
      `${actor.name} NO respondió a tiempo a: «${actor.decisive?.threat ?? 'la amenaza'}». La amenaza se ejecuta contra él sin que actúe (SPEC: no responder es perder de verdad).`,
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
    L.push(`## Resultado de la tirada\nAcción original: «${roll.original_text}»\n${roll.result.label}: ${roll.result.breakdown} → ${roll.result.success === null ? 'sin CD' : roll.result.success ? 'ÉXITO' : 'FALLO'}${roll.result.natural ? ` (${roll.result.natural} natural)` : ''}.\nNarra la consecuencia y aplica los cambios con tools. No pidas otra tirada para esta misma acción.`);
  } else {
    L.push(`## Acción del jugador\n«${text}»${decisive ? `\nRespondió a la ventana decisiva («${decisive.threat}») en ${decisive.seconds} s: ${decisive.speed === 'fast' ? 'RÁPIDA → actúa antes de que la amenaza se resuelva; si pides tirada, el servidor le dará ventaja' : 'normal → su acción y la amenaza se resuelven a la vez; decide el dado'}.` : ''}`);
  }

  // Ganchos e imprevisto que el motor pone delante en esta llamada (hooks.ts, fastpath.ts).
  const hints = engine.sceneHints(actor.id);
  if (hints?.hooks.length) L.push(`## Gancho que salta ahora\n${hints.hooks.map((h) => `- ${h.what}`).join('\n')}\nHazlo ocurrir ahora, encajado con lo que hace el actor (puedes interrumpir su movimiento o dejar la acción a medias). Ya está consumido: no lo repitas.`);
  if (hints?.encounter) L.push('## Imprevisto\nHa salido la tirada de imprevisto del servidor: mientras el actor hace esto pasa algo que no buscaba (alguien llega o se va, un ruido, un animal, un cambio de luz o de tiempo), acorde al lugar y la hora. Pequeño y concreto; combate solo si encaja. Resuelve también la acción.');
  const firing = new Set(hints?.hooks.map((h) => h.id) ?? []);
  const planted = engine.hooksIn(loc.id).filter((h) => !firing.has(h.id));
  if (planted.length) L.push('## Ganchos sembrados aquí (solo tú los ves; el servidor los dispara; cancel_hook si ya no encajan)\n' + planted.map((h) => `- ${describeHook(world, h, (s) => engine.clock.format(s))}`).join('\n'));
  return L.join('\n\n');
}
