/**
 * Progreso de la demo: reputación, pistas, encargos, práctica por uso y logro
 * (SPEC §3.4, §3.5, §4.11 y decisiones de la sesión 5). Todo lo que aquí
 * cambia se persiste vía world.touch; los eventos los emite el motor.
 */

import { GAME_DAY } from '../clock/clock.js';
import { consumeItem, spawnItem, transferItem } from './inventory.js';
import { refusesService } from './crime.js';
import type { Character, Id, Job, Npc, Placement } from './model.js';
import { money } from './money.js';
import { priceFor } from './standing.js';
import type { World } from './world.js';

export interface ProgressEvent {
  kind: 'clue' | 'job' | 'reputation' | 'practice' | 'achievement' | 'story' | 'quest' | 'level';
  text: string;
  public?: string;
  /** Si toca una misión: cuál, qué le ha pasado y por qué (el aviso del chat y el Diario lo enseñan). */
  quest?: QuestChange;
}

/**
 * Cambio en una misión, con el porqué en palabras del jugador: un rumor que apunta a quien la da, rechazada,
 * alta (se la piden en escena), paso dado, lista para entregar, cambio de camino (alguien ha muerto), aviso de
 * plazo, cumplida, fallida, caducada o dejada. En `rumor`, `title` va vacío: el rumor no dice de qué va.
 * (`offered` solo sale en partidas de antes.)
 */
export interface QuestChange {
  id: Id; title: string; event: 'rumor' | 'offered' | 'declined' | 'open' | 'available' | 'step' | 'ready' | 'changed' | 'warned' | 'done' | 'failed' | 'expired' | 'dropped'; step?: string; why: string;
  /** Se la acaban de pedir en escena: aún puede decir que no (la web lo ofrece en el aviso). */
  declinable?: boolean;
}

export function addReputation(world: World, c: Character, factionId: Id, delta: number): number {
  c.reputation[factionId] = (c.reputation[factionId] ?? 0) + delta;
  world.touch('characters', c.id);
  return c.reputation[factionId];
}

/** Una pista se gana una sola vez por personaje. */
export function grantClue(world: World, c: Character, clueId: Id): { ok: true; events: ProgressEvent[] } | { ok: false; reason: string } {
  const clue = world.campaign.clues.find((x) => x.id === clueId);
  if (!clue) return { ok: false, reason: `pista desconocida: ${clueId}` };
  if (c.clues.includes(clueId)) return { ok: false, reason: 'ya la tenía' };
  c.clues.push(clueId);
  const rep = addReputation(world, c, world.campaign.achievement.faction_id, clue.reputation);
  const events: ProgressEvent[] = [{ kind: 'clue', text: `Pista: ${clue.title} (${c.clues.length}/${world.campaign.clues.length}). Reputación en Brezal: ${rep}.` }];
  const ach = checkAchievement(world, c);
  if (ach) events.push(ach);
  return { ok: true, events };
}

/** Completa un encargo del tablón. Los de entrega se validan y cobran aquí. */
export function completeJob(world: World, c: Character, jobId: Id, npcId: Id | null): { ok: true; events: ProgressEvent[] } | { ok: false; reason: string } {
  const job = world.campaign.jobs.find((x) => x.id === jobId);
  if (!job) return { ok: false, reason: `encargo desconocido: ${jobId}` };
  if (!world.campaign.board.active_job_ids.includes(jobId)) return { ok: false, reason: 'ese encargo no está en el tablón ahora' };
  if (c.completed_jobs.includes(jobId)) return { ok: false, reason: 'ya lo completó; cada encargo suma una vez' };
  const giver = world.npc(job.giver_npc_id);
  if (npcId !== job.giver_npc_id) return { ok: false, reason: `hay que entregarlo a ${giver.name}` };
  if (world.characterSpot(c)?.id !== giver.location.id) return { ok: false, reason: `${giver.name} no está aquí` };
  if (job.kind === 'deliver' && job.deliver) {
    const have = world.itemsCarriedBy(c.id).filter((i) => i.item_id === job.deliver!.item_id);
    const total = have.reduce((a, i) => a + i.quantity, 0);
    if (total < job.deliver.quantity) return { ok: false, reason: `faltan ${job.deliver.quantity - total} de ${world.itemDef(job.deliver.item_id).name}` };
    let left = job.deliver.quantity;
    for (const i of have) {
      if (left <= 0) break;
      const q = Math.min(left, i.quantity);
      const r = transferItem(world, i.id, { type: 'npc', id: giver.id }, q);
      if (!r.ok) return { ok: false, reason: `no se pudo entregar: ${r.error.code}` };
      left -= q;
    }
  }
  c.completed_jobs.push(jobId);
  c.coins += job.reward_coins;
  const rep = addReputation(world, c, world.campaign.achievement.faction_id, job.reward_reputation);
  const events: ProgressEvent[] = [{ kind: 'job', text: `Encargo completado: ${job.title}. +${money(world, job.reward_coins)}. Reputación en Brezal: ${rep}.`, quest: { id: job.id, title: job.title, event: 'done', why: `se lo ${job.kind === 'deliver' ? 'entregaste' : 'contaste'} a ${giver.name} · +${money(world, job.reward_coins)}` } }];
  const ach = checkAchievement(world, c);
  if (ach) events.push(ach);
  return { ok: true, events };
}

/** Un uso significativo de una skill (tirada con CD ≥ mínimo). Devuelve el aviso si cruza un umbral. */
export function addPractice(world: World, c: Character, skill: string): ProgressEvent | null {
  const th = world.campaign.progression.practice_thresholds;
  c.practice[skill] = (c.practice[skill] ?? 0) + 1;
  const n = c.practice[skill];
  let ev: ProgressEvent | null = null;
  if (n === th[0] && !c.proficiencies.skills.includes(skill) && !c.proficiencies.expert.includes(skill)) {
    c.proficiencies.skills.push(skill);
    ev = { kind: 'practice', text: `De tanto practicar, ${c.name} ya es competente en ${skill}.` };
  } else if (n === th[1] && (c.practice_bonus[skill] ?? 0) < 1) {
    c.practice_bonus[skill] = 1;
    ev = { kind: 'practice', text: `La práctica se nota: +1 en ${skill}.` };
  } else if (n === th[2] && (c.practice_bonus[skill] ?? 0) < 2) {
    c.practice_bonus[skill] = 2;
    ev = { kind: 'practice', text: `Maestría por oficio: +2 en ${skill}.` };
  }
  world.touch('characters', c.id);
  return ev;
}

export function checkAchievement(world: World, c: Character): ProgressEvent | null {
  const a = world.campaign.achievement;
  if (c.achievements.some((x) => x.id === a.id)) return null;
  if (c.clues.length < a.clues_required || (c.reputation[a.faction_id] ?? 0) < a.reputation_required) return null;
  c.achievements.push({ id: a.id, game_s: 0 });
  if (a.reward_item_id) {
    // Al bolsillo; si no cabe, a una mano libre o a sus pies: el premio no se pierde.
    const spot = world.characterSpot(c);
    const targets: Placement[] = [
      { type: 'character', id: c.id, slot: { kind: 'pocket' } },
      { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } },
      { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } },
      ...(spot ? [{ type: 'spot' as const, id: spot.id }] : []),
    ];
    targets.some((t) => spawnItem(world, a.reward_item_id!, 1, t).ok);
  }
  if (a.reward_spot_id) {
    const sp = world.spot(a.reward_spot_id);
    if (!sp.discovered_by.includes(c.id)) { sp.discovered_by.push(c.id); world.touch('spots', sp.id); }
  }
  const rep = a.reward_reputation ? addReputation(world, c, a.faction_id, a.reward_reputation) : null;
  world.touch('characters', c.id);
  const faction = world.campaign.factions.find((f) => f.id === a.faction_id)?.name ?? a.faction_id;
  return { kind: 'achievement', text: `Logro: ${a.title}.${rep !== null ? ` +${a.reward_reputation} de reputación en ${faction} (${rep}).` : ''}`, public: a.announcement.replaceAll('{name}', c.name) };
}

/** Rotación diaria del tablón: 3 encargos, en orden, sin repetir el día anterior. */
export function rotateBoard(world: World, nowGameS: number, force = false): Job[] | null {
  const day = Math.floor(nowGameS / GAME_DAY);
  const b = world.campaign.board;
  if (!force && b.last_rotation_day === day) return null;
  const jobs = world.campaign.jobs;
  if (jobs.length === 0) return null;
  const n = Math.min(3, jobs.length);
  const start = (day * n) % jobs.length;
  b.active_job_ids = Array.from({ length: n }, (_, i) => jobs[(start + i) % jobs.length]!.id);
  b.last_rotation_day = day;
  world.touch('campaign', world.campaign.id);
  return b.active_job_ids.map((id) => jobs.find((j) => j.id === id)!);
}

export function activeJobs(world: World): Job[] {
  return world.campaign.board.active_job_ids.map((id) => world.campaign.jobs.find((j) => j.id === id)).filter((j): j is Job => Boolean(j));
}

/** Venta a un NPC: el precio lo fija su lista. */
export function sellToNpc(world: World, c: Character, npcId: Id, instanceId: Id, quantity?: number): { ok: true; item: string; quantity: number; total: number } | { ok: false; reason: string } {
  const npc = world.npc(npcId);
  if (world.characterSpot(c)?.id !== npc.location.id) return { ok: false, reason: `${npc.name} no está aquí` };
  // Quien sabe lo que ha hecho no trata con él (crime.ts).
  const no = refusesService(world, npc, c);
  if (no) return { ok: false, reason: no };
  const inst = world.itemInstances.get(instanceId);
  if (!inst) return { ok: false, reason: 'ese objeto no existe' };
  const offer = npc.buys.find((b) => b.item_id === inst.item_id);
  if (!offer) return { ok: false, reason: `${npc.name} no compra ${world.itemDef(inst.item_id).name}` };
  const q = quantity ?? inst.quantity;
  const r = transferItem(world, inst.id, { type: 'npc', id: npc.id }, q);
  if (!r.ok) return { ok: false, reason: r.error.code };
  // Lo que piensa de él cambia el precio (standing.ts).
  const total = priceFor(npc, c.id, offer.price, 'sell') * q;
  c.coins += total;
  world.touch('characters', c.id);
  return { ok: true, item: world.itemDef(inst.item_id).name, quantity: q, total };
}

export function buyFromNpc(world: World, c: Character, npcId: Id, itemId: Id, quantity: number): { ok: true; item: string; quantity: number; total: number; unlocked: string[] } | { ok: false; reason: string } {
  const npc = world.npc(npcId);
  if (world.characterSpot(c)?.id !== npc.location.id) return { ok: false, reason: `${npc.name} no está aquí` };
  const offer = npc.sells.find((s) => s.item_id === itemId);
  if (!offer) return { ok: false, reason: `${npc.name} no vende eso` };
  // Ni le vende ni le aloja quien sabe lo que ha hecho (crime.ts).
  const no = refusesService(world, npc, c);
  if (no) return { ok: false, reason: no };
  const q = Math.max(1, Math.floor(quantity));
  const total = priceFor(npc, c.id, offer.price, 'buy') * q;
  if (c.coins < total) return { ok: false, reason: `faltan ${money(world, total - c.coins)}` };
  const r = deliverGoods(world, c, npc, itemId, q);
  if (!r.ok) return r;
  c.coins -= total; world.touch('characters', c.id);
  return { ok: true, item: r.item, quantity: q, total, unlocked: r.unlocked };
}

/**
 * Entrega al PJ lo que vende un NPC (comprado o fiado): en manos o bolsillo y,
 * si no cabe, al suelo. Un servicio (noche de posada) entrega su llave y abre
 * para el PJ los puntos del vendedor cerrados con ella. No cobra.
 */
export function deliverGoods(world: World, c: Character, npc: Npc, itemId: Id, q: number): { ok: true; item: string; unlocked: string[] } | { ok: false; reason: string } {
  const def = world.itemDef(itemId);
  const give = def.service ? world.itemDef(def.service.gives_item_id) : def;
  const targets: Placement[] = give.size === 'bulky'
    ? [{ type: 'character', id: c.id, slot: { kind: 'hand', which: 'both' } }]
    : [
      { type: 'character', id: c.id, slot: { kind: 'pocket' } },
      { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } },
      { type: 'character', id: c.id, slot: { kind: 'hand', which: 'off' } },
    ];
  // Lo de comprar va a la mano; una llave, mejor al bolsillo.
  if (!def.service) targets.push(targets.shift()!);
  let placed = false;
  for (const t of targets) if (spawnItem(world, give.id, def.service ? 1 : q, t).ok) { placed = true; break; }
  if (!placed && !spawnItem(world, give.id, def.service ? 1 : q, { type: 'spot', id: npc.location.id }).ok) return { ok: false, reason: 'no hay dónde ponerlo' };
  // Lo que vende y lleva encima (sus existencias, campaign data) sale de ahí: no se puede comprar y luego robarle el mismo frasco.
  let owed = def.service ? 0 : q;
  for (const i of world.itemsIn({ type: 'npc', id: npc.id }).filter((x) => x.item_id === itemId)) {
    if (owed <= 0) break;
    const take = Math.min(owed, i.quantity);
    consumeItem(world, i.id, take);
    owed -= take;
  }
  const unlocked: string[] = [];
  if (def.service) {
    const locId = world.spot(npc.location.id).location_id;
    for (const sp of world.spotsOf(locId)) {
      if (sp.state['key_item_id'] !== give.id) continue;
      const open = Array.isArray(sp.state['unlocked_for']) ? (sp.state['unlocked_for'] as Id[]) : [];
      if (!open.includes(c.id)) { sp.state['unlocked_for'] = [...open, c.id]; world.touch('spots', sp.id); }
      unlocked.push(sp.name);
    }
  }
  return { ok: true, item: def.service ? `${def.name} (${give.name})` : def.name, unlocked };
}
