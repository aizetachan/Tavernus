/**
 * Prólogo de cada historia y «Donde lo dejamos» al volver (docs/PROLOGO.md).
 *
 *   - Prólogo: la primera página del libro, antes de la primera escena. El mundo
 *     y su tono (premisa y tono de la campaña, nunca la Biblia), el lugar y el
 *     momento, el porqué del personaje (su situación inicial o, sin ella, el
 *     origen del punto de inicio), la amenaza y el reloj. 120-200 palabras. Lo
 *     escribe el máster una vez con `prologuePrompt`; si no puede (offline, sin
 *     máster, respuesta inválida), `prologueTemplate` con los mismos datos.
 *   - Recapitulación: tras una ausencia larga, dónde está, qué hora es, qué
 *     estaba haciendo, qué tiene entre manos, a quién conoce y qué ha pasado
 *     entretanto. Plantilla sobre el Diario y el log; sin IA.
 *
 * Aquí no se emite nada: el motor (engine.ts) decide cuándo y guarda el evento.
 */

import { GAME_DAY } from '../clock/clock.js';
import type { Engine } from './engine.js';
import { journalOf } from './journal.js';
import type { Campaign, Character, GameEvent } from './model.js';
import { descriptorOf, maskUnknownNames } from './narrate.js';
import { characterStory, finalsMissedBy } from './story.js';

export const PROLOGUE_WORDS = { min: 120, max: 200 } as const;
export const RECAP_TITLE = 'Donde lo dejamos';
/** Horas reales sin jugar a partir de las que se recapitula (RECAP_AFTER_HOURS). */
export const RECAP_AFTER_HOURS = 72;
/** Días de juego sin jugar a partir de los que también se recapitula. */
export const RECAP_AFTER_GAME_DAYS = 7;

const TONE_LINE: Record<Campaign['tone'], string> = {
  epic: 'Es un tiempo de juramentos y caminos largos, en el que una sola persona todavía puede inclinar la balanza.',
  grim: 'Es un tiempo de inviernos largos y lealtades cortas, en el que nadie regala nada y todo se cobra.',
  comedy: 'Es un lugar donde lo serio dura poco, lo absurdo dura demasiado y nadie está seguro de cuál es cuál.',
  horror: 'Es un lugar donde la gente cierra las contraventanas antes de que anochezca, y no es por el frío.',
  pulp: 'Es un tiempo de golpes rápidos, tesoros dudosos y gente que no pregunta dos veces.',
};

export interface PrologueFacts {
  name: string;
  title: string;
  premise: string;
  tone_line: string;
  /** «miércoles 4 de Escarcha, al caer la tarde». */
  when: string;
  spot: string;
  location: string;
  description: string;
  /** De la situación inicial, en segunda persona. null sin situación. */
  why: string | null;
  wants: string | null;
  threat: string | null;
  clock: { days: number; runs_out: string } | null;
  antagonist: { name: string; role: string } | null;
  /** Sin situación: el origen del punto de inicio, en tercera persona («Llega a Brezal como viajero…»). */
  origin: string | null;
  /** Nombres propios del mundo (NPC, sitios): no se les baja la inicial al encadenar frases. */
  names: string[];
}

/** Minúscula inicial para seguir una frase, salvo si empieza por un nombre propio («Tadeo Arenas se encarga…»). */
function lowerFirst(s: string, names: readonly string[] = []): string {
  if (/^\p{Lu}\p{Ll}+ (?:de |del |la )?\p{Lu}/u.test(s) || names.some((n) => n && s.startsWith(n))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const noDot = (s: string) => s.trim().replace(/[.\s]+$/, '');
const dot = (s: string) => (/[.!?…»]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
function sentences(s: string): string[] {
  return s.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+(?:[»"”)]+)?|[^.!?…]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
}
export function firstSentence(s: string): string { return sentences(s)[0] ?? s.trim(); }

/** «al caer la tarde», «de madrugada»… para una hora de juego. */
export function dayPart(hour: number): string {
  if (hour < 5) return 'de madrugada';
  if (hour < 7) return 'al amanecer';
  if (hour < 12) return 'por la mañana';
  if (hour < 14) return 'a mediodía';
  if (hour < 18) return 'por la tarde';
  if (hour < 21) return 'al caer la tarde';
  return 'de noche';
}

function whenText(engine: Engine, gameS: number): string {
  const d = engine.clock.dateTime(gameS);
  return `${d.weekday.toLowerCase()} ${d.day_of_month} de ${d.month}, ${dayPart(d.hour)}`;
}

/** Los datos del prólogo: solo lo que el personaje puede saber. Nada de la Biblia, secretos ni caminos. */
export function prologueFacts(engine: Engine, c: Character): PrologueFacts {
  const w = engine.world;
  const spot = w.characterSpot(c);
  const loc = spot ? w.locations.get(spot.location_id) : undefined;
  const s = c.situation;
  const ant = s ? w.npcs.get(s.antagonist_npc_id) : undefined;
  const origin = w.campaign.starting_points.find((p) => p.spot_id === spot?.id)?.origin ?? w.campaign.starting_points[0]?.origin ?? null;
  return {
    name: c.name,
    title: `Capítulo 1: ${upperFirst(loc?.name ?? w.campaign.name)}`,
    premise: w.campaign.premise.trim(),
    tone_line: TONE_LINE[w.campaign.tone] ?? TONE_LINE.grim,
    when: whenText(engine, engine.nowFor(c)),
    spot: spot?.name ?? '',
    location: loc?.name ?? '',
    description: loc?.description_base ?? spot?.description ?? '',
    why: s?.why_here ?? null,
    wants: s?.wants ?? null,
    threat: s?.threat ?? null,
    clock: s ? { days: s.clock_days, runs_out: s.clock_runs_out } : null,
    antagonist: ant && c.knows.includes(ant.id) ? { name: ant.name, role: ant.role } : null,
    origin: s ? null : origin,
    names: [...[...w.npcs.values()].flatMap((n) => [n.name, n.name.split(' ')[0]!]), ...[...w.locations.values()].map((l) => l.name)],
  };
}

/** El prólogo por plantilla: tres párrafos (mundo; lugar y momento; porqué, amenaza y reloj). */
export function prologueTemplate(f: PrologueFacts): string {
  const world = [dot(f.premise), f.tone_line].join(' ');
  const desc = sentences(f.description);
  const placeLine = f.spot && f.location && f.spot !== f.location ? `${f.spot}, en ${f.location}` : f.location || f.spot;
  const third = f.why === null;
  const place = [`Es ${f.when}.`, placeLine ? `${third ? `${f.name} está en` : 'Estás en'} ${placeLine}.` : '', desc[0] ?? ''].filter(Boolean);
  let why: string[];
  if (!third) {
    why = [dot(f.why!)];
    if (f.wants) why.push(`Lo que quieres es ${lowerFirst(noDot(f.wants), f.names)}.`);
    if (f.threat) why.push(`Pero ${lowerFirst(dot(f.threat), f.names)}`);
    if (f.clock) why.push(`Tienes ${f.clock.days} día${f.clock.days === 1 ? '' : 's'}; si se acaban, ${lowerFirst(dot(f.clock.runs_out), f.names)}`);
    why.push('Lo que pase a partir de aquí lo decides tú.');
  } else {
    why = [f.origin ? `${f.name} ${lowerFirst(dot(f.origin))}` : `${f.name} acaba de llegar.`, 'Nadie le espera, y eso, aquí, puede ser una suerte o una condena.', 'Lo que pase a partir de aquí lo decides tú.'];
  }
  // Por debajo del mínimo, otra frase del sitio (antes que inventar).
  if (wordCount([world, ...place, ...why].join(' ')) < PROLOGUE_WORDS.min && desc[1]) place.push(desc[1]);
  return [world, place.join(' '), why.join(' ')].join('\n\n');
}

/** El bloque de prompt para que el máster escriba el prólogo (una llamada corta, sin tools). */
export function prologuePrompt(f: PrologueFacts): { system: string; prompt: string } {
  const system = [
    'Escribes la primera página de una novela interactiva en español: el prólogo que lee el jugador antes de su primera escena.',
    'Es un texto de libro, no un turno de juego: no preguntas qué hace, no le sugieres acciones, no le haces hablar.',
  ].join(' ');
  const facts = [
    `Personaje: ${f.name}.`,
    `Mundo (premisa): ${f.premise}`,
    `Tono: ${f.tone_line}`,
    `Momento: ${f.when}.`,
    `Lugar: ${f.spot}${f.location && f.location !== f.spot ? `, en ${f.location}` : ''}. ${f.description}`,
    f.why ? `Por qué está aquí: ${f.why}` : `Origen (en tercera persona): ${f.origin ?? 'acaba de llegar.'}`,
    f.wants ? `Qué quiere: ${f.wants}` : '',
    f.threat ? `Qué le amenaza: ${f.threat}` : '',
    f.clock ? `Plazo: ${f.clock.days} días; si vence, ${lowerFirst(f.clock.runs_out, f.names)}` : '',
    f.antagonist ? `Conoce a su antagonista: ${f.antagonist.name} (${f.antagonist.role}).` : '',
  ].filter(Boolean);
  const prompt = [
    '## Prólogo',
    'Datos (son todo lo que el personaje sabe; no añadas hechos, secretos ni nombres que no estén aquí):',
    ...facts.map((x) => `- ${x}`),
    '',
    `Escribe el prólogo: ${PROLOGUE_WORDS.min}-${PROLOGUE_WORDS.max} palabras, tres párrafos cortos separados por una línea en blanco.`,
    '1) El mundo y su tono en dos o tres frases. 2) El lugar y el momento, con uno o dos detalles concretos. 3) Por qué está aquí, qué quiere, qué le amenaza y cuánto tiempo tiene.',
    f.why ? 'En segunda persona y en presente («Estás…», «Quieres…»).' : `En tercera persona y en presente, con el nombre de ${f.name}.`,
    'Sin título (ya lo pone la página), sin listas ni negritas, sin pregunta final, sin contar lo que pasa en el primer instante: eso lo narra la escena que viene después.',
    'Devuelve solo el texto del prólogo.',
  ].join('\n');
  return { system, prompt };
}

/** ¿Vale lo que devolvió el máster? Ni vacío ni fuera de medida (con margen). */
export function acceptPrologue(text: string | null | undefined): string | null {
  const t = (text ?? '').replace(/^#+\s.*\n+/, '').trim();
  const n = wordCount(t);
  return n >= PROLOGUE_WORDS.min - 30 && n <= PROLOGUE_WORDS.max + 60 ? t : null;
}

/** Cualquier nombre que el personaje no conoce, por su oficio (como en el resto de la partida). */
export function forReader(engine: Engine, c: Character, text: string): string {
  return maskUnknownNames(engine.world, c.id, text);
}

// ---------------------------------------------------------------------------
// Donde lo dejamos
// ---------------------------------------------------------------------------

/** El último evento del propio personaje: lo último que hizo o que le narraron como actor. */
/** Avisos de presencia (irse y volver): no son un turno suyo. */
const PRESENCE = /^(away|back)$/;
/** Lo que le llega a su nombre sin que actúe (historia, ofertas, seguir, turno libre): tampoco es un turno suyo. */
const HAPPENS_TO = /^(away|back|progress_|offer_cancelled|offer_expired|unfollow|npc_free)/;

export function lastOwnEvent(engine: Engine, characterId: string): GameEvent | null {
  const all = engine.events.all();
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i]!;
    if (e.actor_id === characterId && !HAPPENS_TO.test(e.action_type)) return e;
    // Un turno compartido (ronda o conversación de grupo) en el que escribió también es suyo.
    const inputs = e.payload['group_inputs'] as Record<string, string> | undefined;
    if (inputs && typeof inputs[characterId] === 'string') return e;
  }
  return null;
}

/**
 * Lo que pasó mientras no estaba y le afecta (docs/MULTIJUGADOR.md, «Desconexiones»):
 * combate en su sitio, rondas que se resolvieron con él dudando, lo que otros le
 * hicieron a él (objetivo de una acción, un ataque), ofertas canceladas, seguir
 * que se cortó y su historia (pasos compartidos, misiones que se cierran).
 * Textos como los leyó él.
 */
export function relevantWhileAway(engine: Engine, c: Character, since: GameEvent): string[] {
  const out: string[] = [];
  for (const d of engine.events.forCharacter(c.id, since.id)) {
    const e = d.event;
    const mine = e.actor_id === c.id;
    const hit = (e.payload['attack'] as { target_id?: string } | undefined)?.target_id === c.id;
    const shared = Array.isArray(e.payload['group']) && (e.payload['group'] as string[]).includes(c.id) && e.tags.includes('shared');
    if (mine ? /^(offer_cancelled|unfollow|progress_story)$/.test(e.action_type) : (e.tags.includes('combat') || hit || shared || e.payload['target_character_id'] === c.id || e.action_type === 'offer_cancelled')) {
      out.push(firstSentence(d.text.replace(/\*\*/g, '')));
    }
  }
  return [...new Set(out)];
}

export interface AbsenceRule { hours: number; game_days: number }

export function absenceRule(env: NodeJS.ProcessEnv = process.env): AbsenceRule {
  const h = Number(env['RECAP_AFTER_HOURS']);
  return { hours: Number.isFinite(h) && h > 0 ? h : RECAP_AFTER_HOURS, game_days: RECAP_AFTER_GAME_DAYS };
}

/** ¿Lleva lo bastante sin jugar? Horas reales desde su último evento o días de juego. null si no. */
export function absence(engine: Engine, c: Character, nowMs: number, rule: AbsenceRule): { since: GameEvent; hours: number; game_days: number } | null {
  const since = lastOwnEvent(engine, c.id);
  if (!since) return null;
  const hours = (nowMs - since.timestamp_real_ms) / 3_600_000;
  const gameDays = (engine.nowFor(c) - since.timestamp_game_s) / GAME_DAY;
  if (hours >= rule.hours || gameDays >= rule.game_days) return { since, hours, game_days: gameDays };
  // Antes de las 72 h, solo si se fue (multijugador) y entretanto pasó algo que le afecta o se cerró un final sin él.
  const left = engine.events.all().some((e) => e.actor_id === c.id && e.action_type === 'away' && e.seq > since.seq);
  if (!left) return null;
  const affected = relevantWhileAway(engine, c, since).length > 0 || finalsMissedBy(engine.world, c, since.timestamp_game_s).length > 0;
  return affected ? { since, hours, game_days: gameDays } : null;
}

function agoText(hours: number): string {
  if (hours < 1) { const m = Math.max(1, Math.round(hours * 60)); return `${m} minuto${m === 1 ? '' : 's'}`; }
  if (hours < 1.5) return 'una hora';
  if (hours < 48) return `${Math.round(hours)} horas`;
  const d = Math.round(hours / 24);
  return d >= 14 ? `${Math.round(d / 7)} semanas` : `${d} días`;
}

/** «Donde lo dejamos» por plantilla, desde el Diario y el log. */
export function recapTemplate(engine: Engine, c: Character, since: GameEvent, hours: number): string {
  const w = engine.world;
  const nowS = engine.nowFor(c);
  const d = engine.clock.dateTime(nowS);
  const hhmm = `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
  const spot = w.characterSpot(c);
  const loc = spot ? w.locations.get(spot.location_id) : undefined;
  const j = journalOf(engine, c.id);
  const out: string[] = [];

  // Un final excluyente que otro cerró mientras no estaba: lo primero, con quién y qué significa para él.
  for (const f of finalsMissedBy(w, c, since.timestamp_game_s)) {
    const who = (id: string) => w.characters.get(id)?.name ?? id;
    const closers = [f.by, ...f.with].map(who);
    const mine = f.quest.exclusive ? characterStory(c).expired.map((id) => (w.campaign as { story?: { quests: { id: string; title: string; exclusive?: string }[] } }).story?.quests.find((q) => q.id === id)).filter((q) => q && q.exclusive === f.quest.exclusive).map((q) => `«${q!.title}»`) : [];
    const ending = f.quest.ending ? ` ${dot(f.quest.ending.replaceAll('{name}', who(f.by)))}` : '';
    out.push(`**Lo primero.** Mientras no estabas, ${closers.length > 1 ? `${closers.slice(0, -1).join(', ')} y ${closers.at(-1)}` : closers[0]} cerr${closers.length > 1 ? 'aron' : 'ó'} «${f.quest.title}».${ending}${mine.length ? ` Para ti, eso cierra ${mine.join(' y ')}: el valle ya ha elegido.` : ''}`);
  }

  out.push(`**Dónde estás.** Han pasado ${agoText(hours)} desde la última vez. Es ${d.weekday.toLowerCase()} ${d.day_of_month} de ${d.month}, ${dayPart(d.hour)} (${hhmm}). ${spot ? `Estás en ${spot.name}${loc && loc.name !== spot.name ? `, en ${loc.name}` : ''}.` : ''}`.trim());

  // Último turno: lo que dijo o hizo y la primera frase de lo que pasó.
  // Sus turnos, también los compartidos (ronda o grupo) en los que escribió: lo que escribió él.
  const ownInput = (e: GameEvent) => (e.payload['group_inputs'] as Record<string, string> | undefined)?.[c.id] ?? (e.actor_id === c.id ? e.input_text : null);
  const mine = engine.events.forCharacter(c.id, null).filter((x) => (x.event.actor_id === c.id || ownInput(x.event)) && !/^(prologue|recap)$/.test(x.event.action_type) && !HAPPENS_TO.test(x.event.action_type));
  const lastTurn = [...mine].reverse().find((x) => { const t = ownInput(x.event); return t && !t.startsWith('('); }) ?? mine.at(-1);
  if (lastTurn) {
    const own = ownInput(lastTurn.event);
    const said = own && !own.startsWith('(') ? `«${noDot(own)}». ` : '';
    out.push(`**Qué estabas haciendo.** ${said}${firstSentence(lastTurn.text)}`);
  }

  const doing: string[] = [];
  for (const q of j.quests.active) {
    if (q.kind === 'main') {
      const left = q.clock ? (q.clock.days_left > 0 ? `; quedan ${q.clock.days_left} día${q.clock.days_left === 1 ? '' : 's'} (vence el ${lowerFirst(q.clock.deadline)})` : '; el plazo ya ha vencido') : '';
      doing.push(`${q.title}: ${lowerFirst(noDot(q.steps[0]?.text ?? q.text))}${left}.`);
    } else if (q.kind === 'debt') {
      doing.push(`${dot(q.text.split('. ')[0]!)}`);
    } else if (q.kind === 'job' && q.status === 'active') {
      doing.push(`Encargo: ${q.title}${q.giver ? ` (lo pide ${q.giver})` : ''}.`);
    } else if (q.kind === 'achievement' && q.status === 'active') {
      doing.push(`${q.title}: ${lowerFirst(q.steps.filter((s) => !s.done).map((s) => s.text).join('; ') || 'en marcha')}.`);
    }
  }
  if (doing.length) out.push(`**Lo que tienes entre manos.** ${doing.join(' ')}`);

  const people = j.conversations.slice(0, 3).map((cv) => {
    const last = cv.exchanges.at(-1)?.replied.at(-1);
    // Sin nombre, como lo llama el narrador: «El enterrador».
    const who = cv.known ? `${cv.name} (${lowerFirst(cv.role)})` : cap(descriptorOf(w, cv.npc_id).replace(/^(el|la) (\S)/, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`));
    return last ? `${who} te dijo: «${noDot(firstSentence(last))}».` : `${who}.`;
  });
  if (people.length) out.push(`**A quién conoces.** ${people.join(' ')}`);

  // Lo que le llegó sin que él actuara desde su último evento: anuncios, tablón, lo que hicieron otros.
  const meanwhile = engine.events.forCharacter(c.id, since.id)
    .filter((x) => x.event.actor_id !== c.id && !PRESENCE.test(x.event.action_type))
    .map((x) => (x.event.action_type === 'board' ? 'El tablón de avisos ha cambiado.' : firstSentence(x.text.replace(/\*\*/g, ''))));
  // Lo que le afecta va delante (combate en su sitio, lo que le hicieron, su historia); luego, lo último del resto.
  const relevant = relevantWhileAway(engine, c, since);
  const uniq = [...new Set([...relevant.slice(-6), ...meanwhile.filter((m) => !relevant.includes(m)).slice(-Math.max(0, 4 - relevant.length))])];
  out.push(`**Entretanto.** ${uniq.length ? uniq.join(' ') : 'Nada que te afecte de cerca ha cambiado mientras no estabas.'}`);

  return forReader(engine, c, out.join('\n\n'));
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Para pulir la recapitulación con el máster (RECAP_POLISH=on): en prosa, sin añadir nada. */
export function recapPrompt(template: string): { system: string; prompt: string } {
  return {
    system: 'Eres el narrador de una partida de rol por chat, en español. Recuerdas al jugador dónde dejó su historia.',
    prompt: [
      '## Donde lo dejamos',
      'Cuenta este resumen en prosa, en segunda persona y en presente, en 100-180 palabras. No añadas hechos, nombres ni secretos que no estén en él; no sugieras acciones ni hagas preguntas.',
      '',
      template.replace(/\*\*/g, ''),
      '',
      'Devuelve solo el texto.',
    ].join('\n'),
  };
}

export function acceptRecap(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  const n = wordCount(t);
  return n >= 40 && n <= 260 ? t : null;
}
