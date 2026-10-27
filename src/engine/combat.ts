/**
 * Combate (SPEC §9.3): conversacional. El servidor resuelve cada ataque
 * (tirada contra la CA, daño del arma, aplicación) y el master narra.
 */

import { abilityModifier, proficiencyBonus, rollD20, rollExpr, type Advantage, type Rng } from './dice.js';
import type { Character, Id, Npc } from './model.js';
import { damageCharacter, killNpc, worldNow } from './death.js';
import { reportAssault, reportKill } from './crime.js';
import { armorClass } from './rules.js';
import { rangedStyleBonus } from './levels.js';
import { adjustTrust } from './trust.js';
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
export function weaponOf(world: World, c: Character): { name: string; damage: string; damage_type: string; finesse: boolean; ranged: boolean } {
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
  /** Golpe a un PJ ya a 0 PG: fallos de salvación contra muerte que suma (2 si es crítico). */
  death_save_failures?: number;
  /** Ha matado a quien no era hostil (crime.ts): sin PX, con infamia. */
  murder?: boolean;
}

/** `autoHit`: el objetivo no se defiende (un PJ que se deja, reactions.ts): impacta sin tirada de ataque; el daño se tira. */
export function resolveAttack(world: World, attackerId: Id, targetId: Id, advantage: Advantage = 'none', rng?: Rng, nowGameS?: number, opts: { autoHit?: boolean } = {}): AttackOutcome | { error: string } {
  const a = combatant(world, attackerId);
  const t = combatant(world, targetId);
  if (!a || !t) return { error: 'atacante u objetivo desconocido' };
  if (a.kind === 'npc' && (!a.n.stats || a.n.status !== 'alive')) return { error: `${a.n.name} no puede atacar` };
  if (t.kind === 'npc' && (!t.n.stats || t.n.status !== 'alive')) return { error: `${t.n.name} no es un objetivo válido` };
  if (t.kind === 'character' && (t.c.status === 'dead' || t.c.veiled)) return { error: t.c.veiled ? `${t.c.name} está bajo el velo: no puede recibir daño` : `${t.c.name} ya está muerto` };
  if (a.kind === 'character' && a.c.status !== 'active') return { error: `${a.c.name} no puede actuar (${a.c.status})` };
  // SRD: contra alguien inconsciente, ventaja (y el golpe a 0 PG suma fallos de salvación).
  if (t.kind === 'character' && t.c.status === 'unconscious' && advantage === 'none') advantage = 'advantage';

  // Ataque.
  let bonus: number; let dmgExpr: string; let dmgType: string; let weaponName: string; let dmgMod = 0;
  if (a.kind === 'character') {
    const w = weaponOf(world, a.c);
    const str = abilityModifier(a.c.abilities.str), dex = abilityModifier(a.c.abilities.dex);
    const mod = w.ranged ? dex : w.finesse ? Math.max(str, dex) : str;
    bonus = mod + proficiencyBonus(a.c.level) + (w.ranged ? rangedStyleBonus(a.c) : 0); dmgExpr = w.damage; dmgType = w.damage_type; weaponName = w.name; dmgMod = mod;
  } else {
    bonus = a.n.stats!.attack_bonus; dmgExpr = a.n.stats!.damage; dmgType = a.n.stats!.damage_type; weaponName = a.n.stats!.attack_name;
  }
  const ac = acOf(world, t);
  const roll = opts.autoHit
    ? { total: ac, success: true, natural: undefined, breakdown: `sin tirada: no se defiende (CA ${ac})` }
    : rollD20(bonus, ac, advantage, rng);
  const hit = roll.success === true;
  let damage = 0; let dmgBreakdown = '—';
  if (hit) {
    const crit = roll.natural === 20;
    const expr = crit ? `${dmgExpr}+${dmgExpr}` : dmgExpr;
    const d = rollExpr(expr, rng);
    damage = Math.max(1, d.total + dmgMod);
    dmgBreakdown = `${d.breakdown}${dmgMod ? ` ${dmgMod >= 0 ? '+' : '-'} ${Math.abs(dmgMod)}` : ''}${crit ? ' (crítico)' : ''} = ${damage}`;
  }

  // Un PJ que golpea a un NPC que no era hostil con él comete una agresión (crime.ts): testigos y reacciones, ya.
  const nowG = nowGameS ?? worldNow(world);
  if (a.kind === 'character' && t.kind === 'npc') reportAssault(world, a.c, t.n, weaponName, nowG);

  // Aplicar.
  let targetHp = ''; let down = false; let dead = false; let xp = 0; let failures = 0; let murder = false;
  if (t.kind === 'character') {
    const c = t.c;
    if (hit) {
      const r = damageCharacter(world, c, damage, { crit: roll.natural === 20, cause: `${nameOfCombatant(a)} (${weaponName})`, ...(nowGameS === undefined ? {} : { nowGameS }) });
      down = r.down; dead = r.died; failures = r.failures;
    }
    targetHp = `${c.hp_current}/${c.hp_max}`;
  } else {
    const n = t.n; const s = n.stats!;
    if (hit) {
      s.hp = Math.max(0, s.hp - damage);
      if (s.hp === 0) {
        // Muere: su cuerpo se queda y el motor lo anuncia (death.ts).
        killNpc(world, n, nowG, { id: a.kind === 'character' ? a.c.id : a.n.id, name: nameOfCombatant(a) }, `${nameOfCombatant(a)} (${weaponName})`);
        dead = true; down = true; xp = s.xp;
        // Matar a quien no era hostil no da PX, sino infamia (crime.ts).
        if (a.kind === 'character') murder = reportKill(world, a.c, n, nowG).murder;
        if (murder) xp = 0;
        if (a.kind === 'character' && xp) { a.c.xp += xp; world.touch('characters', a.c.id); }
      }
      world.touch('npcs', n.id);
    }
    targetHp = `${s.hp}/${s.hp_max}`;
  }
  // Un NPC atacado pasa a hostil con quien le ataca, y la primera vez pierde buena parte de su confianza (trust.ts);
  // y el que ataca a un PJ, tambiÃ©n pasa a hostil (asÃ­ se sabe quiÃ©n empezÃ³).
  if (t.kind === 'npc' && a.kind === 'character') {
    if (t.n.attitude.by_character[a.c.id] !== 'hostile') adjustTrust(world, t.n, a.c, 'attacked', worldNow(world));
    t.n.attitude.by_character[a.c.id] = 'hostile'; world.touch('npcs', t.n.id);
  }
  if (a.kind === 'npc' && t.kind === 'character') { a.n.attitude.by_character[t.c.id] = 'hostile'; world.touch('npcs', a.n.id); }

  return {
    attacker: nameOfCombatant(a), target: nameOfCombatant(t), weapon: weaponName,
    attack_breakdown: roll.breakdown, attack_total: roll.total, target_ac: ac, hit, natural: roll.natural ?? null,
    damage, damage_breakdown: dmgBreakdown, damage_type: dmgType, target_hp: targetHp, target_down: down, target_dead: dead, xp_gained: xp,
    ...(murder ? { murder: true } : {}),
    ...(failures ? { death_save_failures: failures } : {}),
  };
}

export function attitudeOf(n: Npc, characterId: Id) { return n.attitude.by_character[characterId] ?? n.attitude.default; }

export { stabilizeIfAway } from './death.js';
