/**
 * Lo que le ronda hoy a un NPC, sin IA: su trabajo y lo que tiene en la agenda,
 * lo que ha puesto en el tablón, lo que pasa en el pueblo y lo que sabe o le
 * debe el PJ que tiene delante. Con esto el NPC saca temas suyos en vez de solo
 * contestar (ai/actor.ts y el contexto del máster, prompt.ts). Todo sale del
 * estado: el motor no sabe de ninguna campaña.
 *
 * Punto de enganche: los hechos del mundo, la opinión numérica y los
 * comentarios (otra rama) entran aquí, en `npcConcerns`, como más líneas.
 */

import type { Character, Npc } from './model.js';
import type { World } from './world.js';
import { allScheduled, isActive, nextStart, whenEs } from './schedule.js';
import { activeJobs } from './progress.js';
import { allIncidents, deedText, npcCrimeLine } from './crime.js';
import { rumorsIn } from './rumors.js';
import { openDebts } from './debts.js';
import { money } from './money.js';
import { attitudeOf } from './combat.js';
import { droppedAt, givenQuests } from './quests.js';
import { questsOf } from './story.js';
import { trustTier } from './trust.js';

/** Hasta cuándo un suceso del pueblo sigue en boca de la gente (2 días de juego). */
const NEWS_S = 2 * 86400;
/** Agenda: lo que empieza en las próximas horas. */
const SOON_S = 12 * 3600;
const RUMORS = 2;

const BOND_ES = { kin: 'de su familia', friend: 'amigo suyo', patron: 'quien le protegía', rival: 'su rival' } as const;

/**
 * Lo que le preocupa hoy, en frases cortas y en tercera persona. `pc` es quien
 * tiene delante (su opinión de él y lo que sabe de lo que ha hecho). Vacío si
 * no hay nada que contar más allá de su motivación.
 */
export function npcConcerns(world: World, n: Npc, pc: Character, nowG: number): string[] {
  const out: string[] = [];
  const locId = world.spots.get(n.location.id)?.location_id;
  // Su trabajo y su agenda.
  for (const e of allScheduled(world).filter((x) => x.npc_ids.includes(n.id))) {
    if (isActive(world, e, nowG)) { out.push(`Ahora mismo está en ${e.title}.`); continue; }
    const next = nextStart(world, e, nowG);
    if (next !== null && next - nowG <= SOON_S) out.push(`Tiene ${e.title} ${whenEs(world, next, nowG)}.`);
  }
  const jobs = activeJobs(world).filter((j) => j.giver_npc_id === n.id);
  if (jobs.length) out.push(`Ha puesto en el tablón ${jobs.map((j) => `«${j.title}»`).join(' y ')}: quiere que alguien lo haga, y a su manera lo puede sacar.`);
  // Lo que pasa en el pueblo: lo que ha visto o le han contado, su gente, lo que se dice.
  for (const i of allIncidents(world)) {
    if (i.perpetrator_id === pc.id || nowG - i.updated_game_s > NEWS_S) continue;
    const k = i.knowers.find((x) => x.npc_id === n.id);
    if (!k) continue;
    out.push(k.how === 'told' ? `Le han contado que alguien ${deedText(i)}.` : `Sabe que ${i.perpetrator_name} ${deedText(i)}: ${k.how === 'saw' ? 'lo vio' : 'llegó después'}.`);
  }
  for (const b of n.bonds ?? []) {
    const o = world.npcs.get(b.npc_id);
    if (o?.status === 'dead') out.push(`Ha muerto ${o.name}, ${BOND_ES[b.kind]}: le pesa.`);
  }
  if (locId) for (const r of rumorsIn(world, locId, nowG).slice(-RUMORS)) out.push(`Se dice por aquí (habladuría, no hecho): ${r.name}: ${r.hint}`);
  // Lo que el PJ tiene entre manos, si es cosa suya o de su gente: «¿encontraste el hacha de Doro?».
  const close = new Set([n.id, ...(n.bonds ?? []).filter((b) => b.kind !== 'rival').map((b) => b.npc_id)]);
  const errands = [
    ...givenQuests(pc).filter((q) => q.status === 'active' && droppedAt(pc, q.id) === null && !q.heard).map((q) => ({ title: q.title, giver: q.giver_npc_id })),
    ...questsOf(world, pc).filter((v) => v.status === 'active' && !v.quest.main_for).map((v) => ({ title: v.quest.title, giver: v.quest.giver_npc_id })),
  ];
  for (const q of errands) {
    if (!q.giver || !close.has(q.giver)) continue;
    out.push(q.giver === n.id ? `Le encargó «${q.title}» y quiere saber cómo va.` : `Se ha enterado de que anda con «${q.title}» para ${world.npcs.get(q.giver)?.name ?? 'alguien'}.`);
  }
  // Quien tiene delante.
  const crime = npcCrimeLine(world, n, pc, nowG);
  if (crime) out.push(crime.replace(/^LO PRIMERO, antes que su carácter: /, 'De quien tiene delante: '));
  const owed = openDebts(pc).filter((d) => d.npc_id === n.id);
  if (owed.length) out.push(`Le debe ${money(world, owed.reduce((s, d) => s + d.amount, 0))} (${owed.map((d) => d.reason).join('; ')}): no se le olvida.`);
  return out;
}

// ---------------------------------------------------------------------------
// Trato: cómo habla según cuánto le conoce y le aprecia
// ---------------------------------------------------------------------------

/**
 * Nivel de trato del NPC con el PJ. Los cuatro de en medio son la confianza
 * por niveles (`trustTier` en trust.ts); esta función solo añade los dos de
 * abajo, que salen de la actitud.
 */
export type TalkTier = 'hostile' | 'wary' | 'stranger' | 'acquaintance' | 'friend' | 'ally';

export function talkTier(n: Npc, pc: Character): TalkTier {
  const att = attitudeOf(n, pc.id);
  if (att === 'hostile') return 'hostile';
  if (att === 'unfriendly') return 'wary';
  return trustTier(n, pc.id);
}

/**
 * Cómo habla cada nivel de trato. Valen para cualquier NPC (cada uno, con su
 * carácter): lo que sabe y puede contar lo decide el director; esto es el tono,
 * la iniciativa y lo que hace con lo delicado.
 */
export const TALK_TIERS: Record<TalkTier, string> = {
  hostile: 'Hostil: corto, frío o amenazante; no da nada gratis y puede cortar la charla o echarle.',
  wary: 'Receloso: contesta lo mínimo y pregunta qué quiere y por qué; de lo delicado, ni media palabra; se le gana con hechos, no con charla.',
  stranger: 'Extraño: educado, curioso o desconfiado según su carácter; pregunta quién es y qué le trae, se presenta si es natural en él; habla de su trabajo y de lo que sabe todo el mundo; lo delicado lo esquiva («eso no se le cuenta a un forastero»). La confianza se gana hablando, haciéndole un favor o con una tirada social que pida el director.',
  acquaintance: 'Conocido: le saluda (por su nombre si se lo sabe), recuerda lo último que hablaron y le pregunta por ello, comenta lo que pasa en el pueblo y chismorrea; con lo delicado duda, pide un motivo o algo a cambio.',
  friend: 'Amigo: cálido y con iniciativa; le pregunta cómo va lo suyo (sus encargos, su búsqueda), se preocupa por él, cuenta lo que sabe de la trama con sentimiento y le dice a quién acudir. Aun así, lo que no le corresponde contar no lo cuenta.',
  ally: 'Aliado: de su parte; se lo cuenta todo lo que puede, le avisa de peligros, le ofrece ayuda sin que la pida.',
};

/**
 * Qué mueve el trato, para que el NPC reaccione a ello en la charla y el
 * director lo registre. Los números (cuánto y con qué tope) son de la confianza
 * por niveles y de la opinión numérica (otras ramas); esto es la lista común.
 */
export const TRUST_MOVES = {
  up: ['cumplir sus encargos y misiones', 'darle lo que necesita (un objeto, dinero, ayuda)', 'ayudar a los suyos', 'adularle con gracia, si su carácter lo agradece (a otros les suena a pelota y les sienta mal)', 'persuadirle con buenas razones (tirada social con éxito)', 'volver a charlar con él y escucharle'],
  down: ['intimidarle o amenazarle', 'atacarle a él o a los suyos', 'insultarle o despreciarle', 'hostigarle (insistir cuando ya dijo que no, presionarle una y otra vez)', 'mentirle y que le pille', 'robarle o cometer un crimen que él vea o le cuenten'],
} as const;

export const TRUST_MOVES_TEXT = `El trato sube con: ${TRUST_MOVES.up.join('; ')}. Baja con: ${TRUST_MOVES.down.join('; ')}.`;

export const TALK_TIER_LABEL: Record<TalkTier, string> = { hostile: 'hostil', wary: 'receloso', stranger: 'extraño', acquaintance: 'conocido', friend: 'amigo', ally: 'aliado' };

/** El trato en una línea: nivel y cómo se habla en él. */
export function tierLine(n: Npc, pc: Character): string {
  return `Trato con ${pc.name}: ${TALK_TIERS[talkTier(n, pc)]}`;
}

/** El bloque «Le ronda hoy», o '' si no hay nada. */
export function concernsLine(world: World, n: Npc, pc: Character, nowG: number, indent = ''): string {
  const c = npcConcerns(world, n, pc, nowG);
  return [`${indent}${tierLine(n, pc)}`, c.length ? `${indent}Le ronda hoy (temas suyos, para sacarlos si viene a cuento; no es un guion): ${c.join(' ')}` : ''].filter(Boolean).join('\n');
}

