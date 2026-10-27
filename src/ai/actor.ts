/**
 * El actor de los NPC (docs/CONVERSACION.md). En un turno de conversación el
 * máster hace de director: decide los hechos (qué puede decir el NPC y qué no,
 * qué tools se aplican, si hay tirada) y cierra con log_event, con lo que dice
 * el NPC en `lines` como borrador. Después, una segunda llamada (el actor)
 * reescribe esas líneas con la voz del NPC: su ficha, lo que le ronda hoy, lo
 * que recuerda del PJ y lo último que se han dicho, literal.
 *
 * El actor no ve el secreto del NPC: solo lo que el director ya ha puesto en el
 * borrador y lo que el NPC puede contar (`npcKnowledge`). Sus líneas pasan por
 * los mismos controles del cierre (closecheck.ts, npcorders.ts) más uno de
 * secretos y otro de nombres; si fallan dos veces, se queda el borrador.
 *
 * Modelo: ACTOR_MODEL (por defecto DEFAULT_ACTOR_MODEL; «off» lo apaga) y
 * ACTOR_EFFORT. Sin clave o en offline/replay no hay actor y todo sigue igual.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Engine } from '../engine/engine.js';
import type { Character, Npc } from '../engine/model.js';
import type { DialogueLine } from '../engine/moments.js';
import { dealWithoutState, isPlaceholder, recentNpcLines, repeatedLines } from '../engine/closecheck.js';
import { narratorProse, transcriptOf, transcriptText, TRANSCRIPT_LINES } from '../engine/conversation.js';
import { npcConcerns, tierLine, TRUST_MOVES_TEXT } from '../engine/concerns.js';
import { knowledgeFor } from '../engine/trust.js';
import { orderOf, promisedMove } from '../engine/npcorders.js';
import { positionOf } from '../engine/movement.js';
import { money } from '../engine/money.js';
import { openDebts } from '../engine/debts.js';
import type { LogEventInput } from './tools.js';
import type { MasterClient } from './master.js';

/** Modelo del actor si ACTOR_MODEL no dice otra cosa (sale del banco: docs/CONVERSACION.md). */
export const DEFAULT_ACTOR_MODEL = 'claude-sonnet-5-5';
export type Effort = 'low' | 'medium' | 'high';

export interface ActorConfig { model: string; effort: Effort; client?: MasterClient }

/**
 * Configuración del actor desde el entorno: ACTOR_MODEL (id de modelo, u «off» / «none» / «0» para
 * apagarlo) y ACTOR_EFFORT (low por defecto). null si está apagado.
 */
export function actorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ActorConfig | null {
  const raw = env['ACTOR_MODEL']?.trim();
  if (raw && /^(off|none|no|0|false)$/i.test(raw)) return null;
  const e = env['ACTOR_EFFORT']?.trim();
  return { model: raw || DEFAULT_ACTOR_MODEL, effort: e === 'medium' || e === 'high' ? e : 'low' };
}

export interface ActorUsage { model: string; input: number; output: number; cache_read: number; cache_write: number; ms: number; calls: number; retries: number; kept_draft: boolean; reason?: string }

/** Réplicas por turno y palabras por réplica como mucho (lo que pase se recorta, no se rechaza). */
export const ACTOR_MAX_LINES = 3;
export const ACTOR_MAX_WORDS = 90;

/**
 * Reglas de conversación: las mismas para el actor y, resumidas, para el máster cuando interpreta él
 * (prompt.ts). Estables: van en el system cacheado.
 */
export const TALK_RULES = [
  'Habla como la gente de verdad en un chat del móvil: natural, con frases enteras, de 1 a 4 frases por réplica. Si la escena lo pide (te han preguntado varias cosas, cuentas algo, cambias de tema), dos o tres réplicas seguidas.',
  'Contesta a lo que te dicen, de verdad y primero. Luego reacciona a CÓMO te lo dicen (con prisa, con descaro, con miedo, con educación, con dinero en la mano) y aporta algo tuyo: una opinión, un detalle de tu día, una queja, un recuerdo, algo de lo que te ronda.',
  'Lleva tu parte de la charla: a veces pregunta tú (de dónde viene, qué busca, por qué le interesa), insiste en lo tuyo, pide un favor si lo necesitas o cambia de tema si algo te incomoda. No eres un mostrador de información.',
  'Nunca recites el tablón, un cartel ni una ficha: si hablas de un encargo, cuéntalo como lo contarías tú (por qué te importa, qué te juegas, qué te pasa si no se hace), con tus palabras y sin enumerar condiciones.',
  'Ser callado, seco o desconfiado es decir poco y con intención, no hablar como un telegrama: frases completas, cortas, que pinchan, esquivan o preguntan.',
  'Hay charlas de muchas clases y ninguna es un trámite: un encargo (por qué lo necesitas, qué te juegas, por qué no vas tú), charla sin más (tu día, lo que pasa, lo que le pasa a él), preguntas sobre un tema o sobre la historia del lugar (lo que sabe todo el mundo, contado con tu opinión y tu miedo; lo delicado, según el trato), comercio (el precio, el regateo, lo que opinas de la mercancía).',
  'El trato con quien tienes delante (extraño, conocido, amigo…) manda en el tono, en cuánta iniciativa llevas y en lo que haces con lo delicado. Con un amigo sacas tú los temas (cómo le va lo suyo, lo que se dice); a un extraño lo tanteas. Lo que el trato no permite, no se cuenta: se esquiva con naturalidad, se pide un motivo o algo a cambio.',
  `Lo que hace quien tienes delante te mueve, y se nota en el momento: agradeces, te ablandas, te ofendes, te cierras. ${TRUST_MOVES_TEXT}`,
  'Puedes adornar con detalles pequeños de tu vida (una anécdota, un recuerdo, a quién echas de menos) que encajen con tu ficha. No inventes hechos que el jugador pueda ir a buscar o que cambien la partida: objetos, lugares, personas, precios, pistas, tratos. Eso solo si está en lo que tienes.',
].join('\n');

const SYSTEM = [
  'Eres el actor que da voz a un personaje no jugador en una partida de rol por chat, en castellano. Un director (el máster) ya ha decidido qué pasa en este turno y qué dice tu personaje en sustancia; tú escribes cómo lo dice: sus palabras exactas.',
  'Lo que dice el director es la verdad del turno: no lo contradigas, no lo amplíes con hechos nuevos y no lo dejes sin decir. Si el director dice que se niega, se niega; si da un precio, ese precio; si no da algo, no lo das.',
  'Lo que no está en tu ficha ni en lo que dice el director, tu personaje no lo sabe o no lo cuenta: esquívalo como lo esquivaría él.',
  'No inventes charlas anteriores ni lo que te contó: lo que os habéis dicho y lo que recuerdas de él es todo lo que ha pasado entre vosotros. Si está vacío, es la primera vez que habláis.',
  'Tú solo hablas: nada de acotaciones, gestos ni narración entre paréntesis o asteriscos. Habla en primera persona, a quien tienes delante. Llama a la gente por los nombres que tu personaje conoce y que el jugador ya ha oído, o por lo que se ve («forastero», «chico»); tu propio nombre, solo si te presentas.',
  '',
  'CÓMO HABLAS:',
  TALK_RULES,
  '',
  'Respondes con JSON: {"lines": ["réplica 1", "réplica 2"]}. Cada réplica, solo las palabras dichas, sin comillas.',
].join('\n');

/**
 * Lo que el NPC sabe y puede contar a este PJ, aparte de su ficha pública: lo
 * de su nivel de confianza con él (trust.ts). El resto del secreto no llega al actor.
 */
export function npcKnowledge(_world: Engine['world'], n: Npc, pc: Character): string[] {
  return knowledgeFor(n, pc.id).map((k) => k.text);
}

/** ¿Es un turno para el actor? Un solo NPC vivo habla en un cierre normal, sin tirada pendiente ni turno compartido. */
export function actorTurn(engine: Engine, pc: Character, closed: LogEventInput, opts: { intro?: boolean; scene?: boolean }): Npc | null {
  if (opts.intro || opts.scene || closed.requires_roll || closed.decisive) return null;
  const h = engine.sceneHints(pc.id);
  if (h?.group || h?.round) return null;
  const speakers = new Set((closed.lines ?? []).filter((l) => l.speaker === 'npc' && l.npc_id).map((l) => l.npc_id!));
  if (speakers.size !== 1) return null;
  const n = engine.world.npcs.get([...speakers][0]!);
  return n && n.status === 'alive' ? n : null;
}

/** El mensaje de usuario del actor: escena, ficha, lo que le ronda, el PJ, la transcripción y el borrador del director. */
export function actorContext(engine: Engine, pc: Character, n: Npc, closed: LogEventInput, playerText: string | null, okTools: readonly string[]): string {
  const w = engine.world;
  const nowG = engine.nowFor(pc);
  const pos = positionOf(w, pc, nowG);
  const loc = w.location(pos.location_id);
  const pcKnowsName = pc.knows.includes(n.id);
  const others = [...w.npcs.values()].filter((o) => o.id !== n.id && o.status === 'alive' && w.spot(o.location.id).location_id === loc.id).map((o) => `${o.name} (${o.role})`);
  const pcs = [...w.characters.values()].filter((c) => c.id !== pc.id && c.status !== 'dead' && positionOf(w, c, nowG).location_id === loc.id).map((c) => `${c.name}, ${c.race} ${c.class_name}`);
  const mem = n.memory.filter((m) => m.character_id === pc.id).slice(-6).map((m) => m.note);
  const t = transcriptText(transcriptOf(engine.events.all(), pc.id, n.id, TRANSCRIPT_LINES), pc.name, n.name);
  const npcDraft = (closed.lines ?? []).filter((l) => l.speaker === 'npc');
  const said = (closed.lines ?? []).filter((l) => l.speaker === 'actor').map((l) => `«${l.text}»`);
  const prose = narratorProse(closed.narration_private);
  const knows = npcKnowledge(w, n, pc);
  const debts = openDebts(pc).filter((d) => d.npc_id === n.id);
  return [
    `## Escena\n${engine.clock.format(nowG)}. ${loc.name}, en ${w.spot(n.location.id).name}.${others.length ? ` También están: ${others.join(', ')}.` : ''}${pcs.length ? ` Otros forasteros: ${pcs.join('; ')}.` : ''}`,
    [
      `## Tu personaje: ${n.name}, ${n.role}`,
      n.description,
      `Quiere: ${n.motivation}`,
      n.sells.length ? `Vende: ${n.sells.map((s) => `${w.itemDef(s.item_id).name} a ${money(w, s.price)}`).join(', ')}.` : '',
      n.buys.length ? `Compra: ${n.buys.map((s) => `${w.itemDef(s.item_id).name} a ${money(w, s.price)}`).join(', ')}.` : '',
      knows.length ? `Lo que sabe y puede contar a quien tiene delante: ${knows.join(' ')}` : '',
      `Le ronda hoy (temas suyos para sacar si viene a cuento; no es un guion): ${npcConcerns(w, n, pc, nowG).join(' ')}`,
    ].filter(Boolean).join('\n'),
    [
      `## Quién tiene delante`,
      `${pc.race} ${pc.class_name}${pc.appearance ? `, ${pc.appearance}` : ''}. Se llama ${pc.name}: llámale así solo si se lo ha dicho (sale en lo que recuerda o en lo que se han dicho); si no, por lo que se ve. ${tierLine(n, pc)}`,
      `${pcKnowsName ? `Él ya sabe que se llama ${n.name}.` : `Él aún no sabe cómo se llama ${n.name}: puede presentarse si es natural en él, o no.`}`,
      `Lo que recuerda de él: ${mem.length ? mem.join(' · ') : 'nada, es la primera vez que hablan'}.`,
      debts.length ? `Le debe: ${debts.map((d) => `${money(w, d.amount)} (${d.reason})`).join('; ')}.` : '',
    ].filter(Boolean).join('\n'),
    `## Lo último que os habéis dicho (literal; lo más reciente, al final)\n${t.length ? t.join('\n') : 'Nada: es lo primero que se dicen.'}`,
    [
      '## Este turno',
      playerText ? `Lo que escribió el jugador: «${playerText}»` : '',
      said.length ? `Lo que dice ${pc.name}: ${said.join(' ')}` : '',
      prose ? `Lo que pasa (el narrador): ${prose}` : '',
      okTools.length ? `Hecho en el mundo este turno (ya ha pasado; no lo contradigas): ${[...new Set(okTools)].join(', ')}.` : '',
    ].filter(Boolean).join('\n'),
    [
      `## Lo que dice ${n.name} según el director (la sustancia; las palabras son tuyas)`,
      ...npcDraft.map((l) => `- «${l.text}»`),
      'Di todo esto (los hechos, los precios, las negativas) con su voz, y añade lo suyo según CÓMO HABLAS. Como mucho 3 réplicas.',
    ].join('\n'),
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// Control de las líneas del actor
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean);
/** Palabras demasiado comunes para delatar un secreto. */
const COMMON = new Set(['porque', 'cuando', 'siempre', 'aunque', 'despues', 'entonces', 'alguien', 'nadie', 'nunca', 'tambien', 'mientras', 'contra', 'durante', 'quiere', 'puede', 'tiene', 'sabe', 'noche', 'pueblo', 'casa', 'mano', 'manos', 'gente', 'cosas', 'tiempo', 'hacer', 'decir', 'todos', 'todas', 'otros', 'otras', 'ahora', 'antes', 'hasta', 'desde', 'sobre', 'donde', 'mismo', 'misma', 'cada']);

/**
 * Palabras del secreto del NPC que salen en lo que dice el actor y no en lo que
 * podía saber (borrador del director, transcripción, ficha pública): dos o más
 * palabras raras, o un nombre propio, son una filtración.
 */
export function secretLeaks(secret: string, said: string, allowed: string): string[] {
  if (!secret.trim()) return [];
  const ok = new Set(words(allowed));
  const names = new Set((secret.match(/\b\p{Lu}\p{Ll}{2,}\b/gu) ?? []).map(norm));
  const rare = new Set(words(secret).filter((w) => w.length >= 6 && !COMMON.has(w)));
  const hits = [...new Set(words(said))].filter((w) => !ok.has(w) && (rare.has(w) || names.has(w)));
  const name = hits.some((h) => names.has(h) && h.length >= 3);
  return name || hits.length >= 2 ? hits : [];
}

/** Nombres de NPC que el actor suelta y el jugador no conoce ni salen en el borrador; el suyo propio vale (se presenta). */
export function unknownNames(engine: Engine, pc: Character, n: Npc, said: string, draft: string): string[] {
  const s = ` ${words(said).join(' ')} `;
  const d = ` ${words(draft).join(' ')} `;
  return [...engine.world.npcs.values()]
    .filter((o) => o.id !== n.id && !pc.knows.includes(o.id))
    .map((o) => o.name)
    .filter((name) => { const k = ` ${words(name).join(' ')} `; return k.trim().length > 2 && s.includes(k) && !d.includes(k); });
}

/** Problemas de unas líneas del actor (vacío si valen), para pedirle que las rehaga. */
export function actorProblems(engine: Engine, pc: Character, n: Npc, lines: readonly string[], closed: LogEventInput, okTools: readonly string[]): string[] {
  const out: string[] = [];
  if (!lines.length || lines.every((l) => !l.trim() || isPlaceholder(l))) return ['No has dicho nada.'];
  const draft = (closed.lines ?? []).filter((l) => l.speaker === 'npc').map((l) => l.text).join(' ');
  const said = lines.join(' ');
  const npcLines: DialogueLine[] = lines.map((text) => ({ speaker: 'npc', npc_id: n.id, text }));
  const recent = engine.events.recentInLocation(positionOf(engine.world, pc, engine.nowFor(pc)).location_id, 60);
  const rep = repeatedLines({ lines: npcLines, said: (id) => recentNpcLines(recent, id) });
  if (rep.length) out.push(`Repites lo que ya dijiste hace nada: «${rep[0]!.text}». Dilo de otra manera o di algo nuevo.`);
  const draftDeals = dealWithoutState({ narration: '', lines: (closed.lines ?? []).filter((l) => l.speaker === 'npc'), okTools });
  const deals = dealWithoutState({ narration: '', lines: npcLines, okTools }).filter((d) => !draftDeals.includes(d));
  if (deals.length) out.push(`Das por cerrado un trato que no se ha hecho (${deals.map((d) => `«${d}»`).join(', ')}): no lo cierres; como mucho, ofrécelo o pregúntalo.`);
  const goes = promisedMove({ npcLines: lines.slice(), narration: '', hasOrder: (orderOf(n)?.kind ?? 'stay') !== 'stay', ordered: okTools.includes('set_npc_order') });
  if (goes && !promisedMove({ npcLines: [draft], narration: '', hasOrder: false, ordered: false })) out.push(`Dices que vas o acompañas («${goes}»), y el director no lo ha decidido: no lo prometas.`);
  // Lo que podía saber: el borrador, lo ya dicho, su ficha pública, lo que le ronda, la gente que el PJ conoce y los lugares.
  const w = engine.world;
  const allowed = [draft, ...transcriptOf(engine.events.all(), pc.id, n.id, 40).map((l) => l.text), n.description, n.motivation, n.role, closed.narration_private,
    ...npcConcerns(w, n, pc, engine.nowFor(pc)), ...npcKnowledge(w, n, pc), ...pc.knows.map((id) => w.npcs.get(id)?.name ?? ''), ...[...w.locations.values()].map((l) => l.name)].join(' ');
  const leak = secretLeaks(n.secret, said, allowed);
  if (leak.length) out.push(`Dices cosas que tu personaje no cuenta (${leak.join(', ')}): quítalas.`);
  const names = unknownNames(engine, pc, n, said, draft);
  if (names.length) out.push(`Nombras a ${names.join(', ')}, a quien el jugador no conoce: llámalo por lo que es («el herrero», «mi tío») o no lo nombres.`);
  return out;
}

/** Réplicas limpias: sin comillas ni acotaciones, como mucho ACTOR_MAX_LINES y ACTOR_MAX_WORDS cada una. */
export function tidyActorLines(raw: readonly unknown[]): string[] {
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((t) => t.replace(/\*[^*]*\*|\([^)]*\)/g, ' ').replace(/^[\s«"“—-]+|[\s»"”]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && !isPlaceholder(t))
    .slice(0, ACTOR_MAX_LINES)
    .map((t) => { const w = t.split(' '); return w.length <= ACTOR_MAX_WORDS ? t : `${w.slice(0, ACTOR_MAX_WORDS).join(' ').replace(/[,;:]$/, '')}…`; });
}

/** Lee {"lines": [...]} de la respuesta (o una lista suelta); [] si no se entiende. */
export function parseActorReply(text: string): string[] {
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  for (const cand of [body, body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)]) {
    try {
      const v = JSON.parse(cand) as unknown;
      const list = Array.isArray(v) ? v : (v as { lines?: unknown })?.lines;
      if (Array.isArray(list)) return tidyActorLines(list);
    } catch { /* siguiente */ }
  }
  return [];
}

const FORMAT: Anthropic.Beta.BetaJSONOutputFormat = {
  type: 'json_schema',
  schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } }, required: ['lines'], additionalProperties: false },
};

const CACHE_TTL: Anthropic.Beta.BetaCacheControlEphemeral = { type: 'ephemeral', ttl: '1h' };

/**
 * Cambia en el cierre lo que dice el NPC por las líneas del actor: en `lines`
 * (en el sitio de la primera línea del NPC; las del PJ, igual) y en las citas de
 * la narración y de lo observable (la primera cita del borrador se sustituye
 * por las nuevas y el resto se quita). Si el NPC se presenta, el PJ aprende su nombre.
 */
export function applyActorLines(engine: Engine, pc: Character, n: Npc, closed: LogEventInput, lines: readonly string[]): LogEventInput {
  const old = (closed.lines ?? []).filter((l) => l.speaker === 'npc' && l.npc_id === n.id);
  const fresh: DialogueLine[] = lines.map((text) => ({ speaker: 'npc', npc_id: n.id, text }));
  const first = (closed.lines ?? []).findIndex((l) => l.speaker === 'npc' && l.npc_id === n.id);
  const kept = (closed.lines ?? []).filter((l) => !old.includes(l));
  const at = (closed.lines ?? []).slice(0, first).filter((l) => !old.includes(l)).length;
  const newLines = [...kept.slice(0, at), ...fresh, ...kept.slice(at)];
  const swap = (text: string | null | undefined): string | null => {
    if (text == null) return null;
    let out = text;
    let placed = false;
    for (const l of old) {
      const q = `«${l.text}»`;
      if (!out.includes(q)) continue;
      out = out.replace(q, placed ? '' : fresh.map((f) => `«${f.text}»`).join(' '));
      placed = true;
    }
    return placed ? out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim() : out;
  };
  // Se presenta: el PJ aprende su nombre (el resto de nombres los ha filtrado actorProblems).
  if (!pc.knows.includes(n.id) && ` ${words(lines.join(' ')).join(' ')} `.includes(` ${words(n.name).join(' ')} `)) {
    pc.knows.push(n.id);
    engine.world.touch('characters', pc.id);
  }
  return { ...closed, lines: newLines, narration_private: swap(closed.narration_private) ?? closed.narration_private, observable: swap(closed.observable), ...(closed.observable_target ? { observable_target: swap(closed.observable_target) } : {}) };
}

/**
 * La voz del NPC: llama al actor, revisa sus líneas (una segunda vez con los
 * problemas si hace falta) y devuelve el cierre con ellas. Si el actor falla o
 * no corrige, el cierre queda como lo dejó el director (`kept_draft`).
 */
export async function performNpc(cfg: ActorConfig & { client: MasterClient }, engine: Engine, pc: Character, n: Npc, closed: LogEventInput, playerText: string | null, okTools: readonly string[]): Promise<{ closed: LogEventInput; usage: ActorUsage }> {
  const usage: ActorUsage = { model: cfg.model, input: 0, output: 0, cache_read: 0, cache_write: 0, ms: 0, calls: 0, retries: 0, kept_draft: true };
  const t0 = Date.now();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: actorContext(engine, pc, n, closed, playerText, okTools) }];
  const fallbacks: Partial<Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>> = cfg.model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await cfg.client.create({
        model: cfg.model, max_tokens: 3000, ...fallbacks,
        output_config: { effort: cfg.effort, format: FORMAT },
        system: [{ type: 'text', text: SYSTEM, cache_control: CACHE_TTL }],
        messages,
      });
      usage.calls++;
      usage.model = res.model;
      usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
      usage.cache_read += res.usage.cache_read_input_tokens ?? 0; usage.cache_write += res.usage.cache_creation_input_tokens ?? 0;
      if (res.stop_reason === 'refusal') { usage.reason = 'refusal'; break; }
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
      const lines = parseActorReply(text);
      const problems = actorProblems(engine, pc, n, lines, closed, okTools);
      if (!problems.length) {
        usage.kept_draft = false;
        usage.ms = Date.now() - t0;
        return { closed: applyActorLines(engine, pc, n, closed, lines), usage };
      }
      usage.reason = problems.join(' ');
      if (attempt === 0) {
        usage.retries++;
        messages.push({ role: 'assistant', content: text || '{"lines": []}' }, { role: 'user', content: `Rehazlo: ${problems.join(' ')}` });
      }
    }
  } catch (e) {
    usage.reason = (e as Error).message;
    console.warn(`[actor] ${n.id}: ${usage.reason}`);
  }
  usage.ms = Date.now() - t0;
  return { closed, usage };
}

