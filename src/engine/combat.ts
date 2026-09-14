/**
 * Combate (SPEC §9.3): conversacional. El servidor resuelve cada ataque
 * (tirada contra la CA, daño del arma, aplicación) y el master narra.
 */

import { abilityModifier, proficiencyBonus, rollD20, rollExpr, type Advantage, type Rng } from './dice.js';
import type { Character, Id, Npc } from './model.js';
import { armorClass } from './rules.js';
import type { World } from './world.js';

export type Combatant = { kind: 'character'; c: Character } | { kind: 'npc'; n: Npc };

export function combatant(world: World, id: Id): Combatant | null {
  const c = world.characters.get(id);
  if (c) return { kind: 'character', c };
  const n = world.npcs.get(id);
  if (n) return { kind: 'npc', n };
  return null;
}

export function nameOfCombatant(x: Combatant): string { return x.kind === 'character' ? x.c.name : x.n.name; }

function acOf(world: World, x: Combatant): number {
  return x.kind === 'character' ? armorClass(world, x.c) : x.n.stats?.ac ?? 10;
}

/** Arma en la mano principal (o secundaria) del PJ; sin arma, puñetazo. */
function weaponOf(world: World, c: Character): { name: string; damage: string; damage_type: string; finesse: boolean; ranged: boolean } {
  for (const which of ['main', 'both', 'off'] as const) {
    for (const i of world.itemsIn({ type: 'character', id: c.id, slot: { kind: 'hand', which } })) {
      const d = world.itemDef(i.item_id);
      if (d.weapon) return { name: d.name, damage: d.weapon.damage, damage_type: d.weapon.damage_type, finesse: Boolean(d.weapon.finesse), ranged: Boolean(d.weapon.ranged) };
    }
  }
  return { name: 'puños', damage: '1', damage_type: 'bludgeoning', finesse: false, ranged: false };
}

export interface AttackOutcome {
  attacker: string;
  target: string;
  weapon: string;
  attack_breakdown: string;
  attack_total: number;
  target_ac: number;
  hit: boolean;
  natural: 20 | 1 | null;
  damage: number;
  damage_breakdown: string;
  damage_type: string;
  target_hp: string;
  target_down: boolean;
  target_dead: boolean;
  xp_gained: number;
}

export function resolveAttack(world: World, attackerId: Id, targetId: Id, advantage: Advantage = 'none', rng?: Rng): AttackOutcome | { error: string } {
  const a = combatant(world, attackerId);
  const t = combatant(world, targetId);
  if (!a || !t) return { error: 'atacante u objetivo desconocido' };
  if (a.kind === 'npc' && (!a.n.stats || a.n.status !== 'alive')) return { error: `${a.n.name} no puede atacar` };
  if (t.kind === 'npc' && (!t.n.stats || t.n.status !== 'alive')) return { error: `${t.n.name} no es un objetivo válido` };
  if (t.kind === 'character' && (t.c.status === 'dead' || t.c.veiled)) return { error: t.c.veiled ? `${t.c.name} está bajo el velo: no puede recibir daño` : `${t.c.name} ya está muerto` };
  if (a.kind === 'character' && a.c.status !== 'active') return { error: `${a.c.name} no puede actuar (${a.c.status})` };

  // Ataque.
  let bonus: number; let dmgExpr: string; let dmgType: string; let weaponName: string; let dmgMod = 0;
  if (a.kind === 'character') {
    const w = weaponOf(world, a.c);
    const str = abilityModifier(a.c.abilities.str), dex = abilityModifier(a.c.abilities.dex);
    const mod = w.ranged ? dex : w.finesse ? Math.max(str, dex) : str;
    bonus = mod + proficiencyBonus(a.c.level); dmgExpr = w.damage; dmgType = w.damage_type; weaponName = w.name; dmgMod = mod;
  } else {
    bonus = a.n.stats!.attack_bonus; dmgExpr = a.n.stats!.damage; dmgType = a.n.stats!.damage_type; weaponName = a.n.stats!.attack_name;
  }
  const ac = acOf(world, t);
  const roll = rollD20(bonus, ac, advantage, rng);
  const hit = roll.success === true;
  let damage = 0; let dmgBreakdown = '—';
  if (hit) {
    const crit = roll.natural === 20;
    const expr = crit ? `${dmgExpr}+${dmgExpr}` : dmgExpr;
    const d = rollExpr(expr, rng);
    damage = Math.max(1, d.total + dmgMod);
    dmgBreakdown = `${d.breakdown}${dmgMod ? ` ${dmgMod >= 0 ? '+' : '-'} ${Math.abs(dmgMod)}` : ''}${crit ? ' (crítico)' : ''} = ${damage}`;
  }

  // Aplicar.
  let targetHp = ''; let down = false; let dead = false; let xp = 0;
  if (t.kind === 'character') {
    const c = t.c;
    if (hit) {
      let left = damage;
      const fromTemp = Math.min(c.hp_temp, left); c.hp_temp -= fromTemp; left -= fromTemp;
      c.hp_current = Math.max(0, c.hp_current - left);
      if (c.hp_current === 0 && c.status === 'active') { c.status = 'unconscious'; down = true; }
      world.touch('characters', c.id);
    }
    targetHp = `${c.hp_current}/${c.hp_max}`;
  } else {
    const n = t.n; const s = n.stats!;
    if (hit) {
      s.hp = Math.max(0, s.hp - damage);
      if (s.hp === 0) {
        n.status = 'dead'; dead = true; down = true; xp = s.xp;
        // Lo que llevaba cae al suelo.
        for (const i of world.itemsIn({ type: 'npc', id: n.id })) { i.location = { type: 'spot', id: n.location.id }; world.touch('item_instances', i.id); }
        if (a.kind === 'character') { a.c.xp += xp; world.touch('characters', a.c.id); }
      }
      world.touch('npcs', n.id);
    }
    targetHp = `${s.hp}/${s.hp_max}`;
  }
  // Un NPC atacado pasa a hostil con quien le ataca.
  if (t.kind === 'npc' && a.kind === 'character') { t.n.attitude.by_character[a.c.id] = 'hostile'; world.touch('npcs', t.n.id); }

  return {
    attacker: nameOfCombatant(a), target: nameOfCombatant(t), weapon: weaponName,
    attack_breakdown: roll.breakdown, attack_total: roll.total, target_ac: ac, hit, natural: roll.natural ?? null,
    damage, damage_breakdown: dmgBreakdown, damage_type: dmgType, target_hp: targetHp, target_down: down, target_dead: dead, xp_gained: xp,
  };
}

export function attitudeOf(n: Npc, characterId: Id) { return n.attitude.by_character[characterId] ?? n.attitude.default; }
