/**
 * Tiradas a la vista: cada tirada abierta es un evento que ven quien tira,
 * los PJ que están en el mismo lugar y los que comparten el turno o la ronda.
 * Sale en el hilo como aviso de sistema, sin pasar por el narrador. Las
 * tiradas ocultas (percepción pasiva, dados del máster, las de los enemigos)
 * no pasan por aquí.
 */

import type { AttackOutcome } from './combat.js';
import type { CheckResult } from './dice.js';
import type { Id } from './model.js';
import type { World } from './world.js';

export interface ShownRoll {
  /** Quién tira: un PJ. */
  roller_id: Id;
  /** Para qué: «Atletismo», «Ataque con bastón a Doro», «Salvación contra muerte». */
  label: string;
  /** Dado, modificador y total: «d20 [6] + 1 = 7». */
  dice: string;
  total: number;
  /** Desenlace: «éxito», «fallo», «impacta: 3 de daño». null si no hay CD. */
  outcome: string | null;
  /** CD si se anuncia; si es oculta, no va. */
  dc?: number | null;
  natural?: 20 | 1;
  /** Si va contra otro (PJ o NPC): también lo ve él aunque no esté en el sitio. */
  target_id?: Id;
  /** Coletilla para el que tira y para todos: «con la ayuda de Aren». */
  note?: string;
}

/** Desglose con el resultado: «d20 [6] + 1 = 7 vs CD 12 → fallo (1 natural)». */
function body(r: ShownRoll): string {
  const dice = r.dice.replace(/ vs CD \d+$/, '');
  const dc = r.dc != null ? ` vs CD ${r.dc}` : '';
  const out = r.outcome ? ` → ${r.outcome}` : '';
  const nat = r.natural && !/natural|crítico/.test(r.outcome ?? '') ? ` (${r.natural} natural)` : '';
  return `${r.label}: ${dice}${dc}${out}${nat}${r.note ? ` · ${r.note}` : ''}`;
}

/** Una prueba de PJ (rules.ts) como tirada a la vista; la CD no se dice (el máster la fija oculta). */
export function checkRoll(rollerId: Id, r: CheckResult & { label: string }): ShownRoll {
  return {
    roller_id: rollerId, label: r.label.charAt(0).toUpperCase() + r.label.slice(1), dice: r.breakdown, total: r.total,
    outcome: r.success === null ? null : r.success ? 'éxito' : 'fallo', ...(r.natural ? { natural: r.natural } : {}),
  };
}

/** Un ataque resuelto por el servidor, como tirada a la vista (la CA del objetivo no se dice). */
export function attackRoll(rollerId: Id, targetId: Id, atk: AttackOutcome): ShownRoll {
  return {
    roller_id: rollerId, target_id: targetId, label: `Ataque con ${atk.weapon} a ${atk.target}`, dice: atk.attack_breakdown, total: atk.attack_total,
    outcome: atk.hit ? `impacta${atk.natural === 20 ? ' (crítico)' : ''}: ${atk.damage} de daño${atk.target_dead ? ', muere' : atk.target_down ? ', cae' : ''}` : `falla${atk.natural === 1 ? ' (1 natural)' : ''}`,
    ...(atk.natural ? { natural: atk.natural } : {}),
  };
}

/** Lo que lee quien tira (sin su nombre: es él). */
export function rollTextForRoller(r: ShownRoll): string {
  return `🎲 ${body(r)}`;
}

/** Lo que leen los demás: quién tira delante. */
export function rollTextForOthers(world: World, r: ShownRoll): string {
  const who = world.characters.get(r.roller_id)?.name ?? 'Alguien';
  return `🎲 ${who} · ${body(r)}`;
}

/**
 * Quién ve la tirada, además del que tira: los PJ en la misma localización
 * (también el muerto, que solo puede mirar), el objetivo si es un PJ y los que
 * comparten el turno o la ronda (`group`). Sin repetidos, sin el que tira y
 * sin los retirados de la partida.
 */
export function rollAudience(world: World, locationId: Id, rollerId: Id, group: readonly Id[] = [], targetId?: Id): Id[] {
  const out = new Set<Id>();
  for (const c of world.charactersInLocation(locationId)) out.add(c.id);
  for (const id of group) out.add(id);
  if (targetId && world.characters.has(targetId)) out.add(targetId);
  out.delete(rollerId);
  return [...out].filter((id) => world.characters.get(id)?.status !== 'retired' && world.characters.has(id));
}
