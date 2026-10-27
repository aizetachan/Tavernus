/**
 * Combate (SPEC §9.3): conversacional. El servidor resuelve cada ataque
 * (tirada contra la CA, daño del arma, aplicación) y el master narra.
 *
 *   - Un NPC hostil actúa en cada turno del combate: si el máster no le hace
 *     atacar, lo hace el motor al cerrar (forceNpcTurns), con su multiataque.
 *     Un NPC actúa una vez por turno.
 *   - Golpe no letal (SRD): un PJ que deja a un NPC a 0 PG con un arma
 *     contundente, los puños o diciendo «pegar», «golpear» o «reducir» le deja
 *     inconsciente. Le mata si dice que quiere matarle, si el arma corta o
 *     perfora y no dice lo contrario, o si remata a quien ya estaba en el suelo.
 *   - Nadie es inmortal: lo que sostiene la trama tiene su plan B en los datos.
 */

import { abilityModifier, proficiencyBonus, rollD20, rollExpr, type Advantage, type Rng } from './dice.js';
import type { Character, Id, Npc } from './model.js';
import { damageCharacter, helplessNpc, killNpc, knockOutNpc, npcCanAct, worldNow } from './death.js';
import { reportAssault, reportKill, startedBy } from './crime.js';
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
  /** El NPC ha caído inconsciente (golpe no letal), no muerto. */
  knocked_out?: boolean;
  /** Golpe a quien estaba inconsciente o atado: impacta solo y, si le deja a 0, le mata. */
  helpless?: boolean;
  /** Turno de un NPC con multiataque: cada golpe (los campos de arriba suman el daño y dan el estado final). */
  attacks?: AttackOutcome[];
}

// ---------------------------------------------------------------------------
// Golpe letal o no letal
// ---------------------------------------------------------------------------

const word = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu');
/** «sin matarle», «no lo mates», «déjalo inconsciente», «reducirle»: no quiere matar, diga lo que diga después. */
const SPARE_RE = word('sin matar\\p{L}*|no (?:le |lo |la |los |las )?(?:quiero )?mat\\p{L}*|no letal|con el plano|dej(?:o|ar|arl[oae]|al[oae]|árl[oae]) (?:inconsciente|fuera de combate|k\\.?o\\.?|sin sentido)|noque\\p{L}*|reduc\\p{L}*|reduzc\\p{L}*|somet\\p{L}*|somét\\p{L}*|inmoviliz\\p{L}*');
/** «lo mato», «remátalo», «a muerte»: quiere matarle. */
const KILL_RE = word('mat(?:o|ar|arl[eoa]s?|al[eoa]s?|en?|ad)|mát\\p{L}+|remat\\p{L}*|remát\\p{L}*|a muerte|darle muerte|que muera|degoll\\p{L}*|deg[üu]ell\\p{L}*|decapit\\p{L}*|asesin\\p{L}*|acab(?:o|ar|a) con (?:él|ella|su vida)');
/** «pegar», «golpear», puñetazos: pelea, no muerte. */
const BRAWL_RE = word('peg(?:o|ar|arl[eoa]s?|al[eoa]s?|ue|uen)|pég\\p{L}+|golpe(?:o|ar|arl[eoa]s?|al[eoa]s?)|golpé\\p{L}+|puñetazos?|puñadas?|tortazos?|bofet\\p{L}*|patadas?|tumb(?:o|ar|arl[eoa])');

/** En una ronda («(ronda 2) Kael: … / Mira: …»), lo que escribió quien golpea; si no, todo. */
export function intentOf(text: string | null | undefined, attackerName: string): string {
  const t = text ?? '';
  const parts = t.replace(/^\(ronda \d+\)\s*/, '').split(' / ');
  const mine = parts.find((p) => p.startsWith(`${attackerName}: `));
  return mine ? mine.slice(attackerName.length + 2) : t;
}

/**
 * ¿Mata el golpe que deja a un NPC a 0 PG? Primero lo que dice el jugador (no
 * matar, matar, pegar); si no dice nada, el arma: contundente o puños, no.
 */
export function lethalBlow(intent: string | null | undefined, damageType: string): boolean {
  const t = intent ?? '';
  if (SPARE_RE.test(t)) return false;
  if (KILL_RE.test(t)) return true;
  if (BRAWL_RE.test(t)) return false;
  return !/bludgeon|contund/i.test(damageType);
}

/**
 * `autoHit`: el objetivo no se defiende (un PJ que se deja, reactions.ts): impacta sin tirada de ataque; el daño se tira.
 * `intent`: lo que escribió el jugador que ataca, para saber si el golpe a 0 PG mata (lethalBlow).
 */
export function resolveAttack(world: World, attackerId: Id, targetId: Id, advantage: Advantage = 'none', rng?: Rng, nowGameS?: number, opts: { autoHit?: boolean; intent?: string | null } = {}): AttackOutcome | { error: string } {
  const a = combatant(world, attackerId);
  const t = combatant(world, targetId);
  if (!a || !t) return { error: 'atacante u objetivo desconocido' };
  if (a.kind === 'npc' && (!a.n.stats || !npcCanAct(a.n))) return { error: `${a.n.name} no puede atacar${a.n.bound ? ': está atado' : ''}` };
  if (t.kind === 'npc' && (!t.n.stats || (t.n.status !== 'alive' && t.n.status !== 'unconscious'))) return { error: `${t.n.name} no es un objetivo válido` };
  if (t.kind === 'character' && (t.c.status === 'dead' || t.c.veiled)) return { error: t.c.veiled ? `${t.c.name} está bajo el velo: no puede recibir daño` : `${t.c.name} ya está muerto` };
  if (a.kind === 'character' && a.c.status !== 'active') return { error: `${a.c.name} no puede actuar (${a.c.status})` };
  // SRD: contra alguien inconsciente, ventaja (y el golpe a 0 PG suma fallos de salvación).
  if (t.kind === 'character' && t.c.status === 'unconscious' && advantage === 'none') advantage = 'advantage';
  // Un NPC inconsciente o atado no se defiende: el golpe entra solo.
  const helpless = t.kind === 'npc' && helplessNpc(t.n);

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
  const roll = opts.autoHit || helpless
    ? { total: ac, success: true, natural: undefined, breakdown: `sin tirada: ${helpless ? 'está a su merced' : 'no se defiende'} (CA ${ac})` }
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
  let targetHp = ''; let down = false; let dead = false; let xp = 0; let failures = 0; let murder = false; let ko = false;
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
        const by = { id: a.kind === 'character' ? a.c.id : a.n.id, name: nameOfCombatant(a) };
        const cause = `${nameOfCombatant(a)} (${weaponName})`;
        // Golpe no letal: inconsciente, no muerto. Al que ya estaba en el suelo, el golpe le mata (rematar).
        if (a.kind === 'character' && !helpless && !lethalBlow(intentOf(opts.intent, a.c.name), dmgType)) {
          knockOutNpc(world, n, nowG, by, cause);
          ko = true; down = true; xp = startedBy(world, a.c, n, nowG) ? 0 : s.xp;
        } else {
          // Muere: su cuerpo se queda y el motor lo anuncia (death.ts).
          killNpc(world, n, nowG, by, cause);
          dead = true; down = true; xp = helpless ? 0 : s.xp;
          // Matar a quien no era hostil (o rematar a quien no se defendía) no da PX, sino infamia (crime.ts).
          if (a.kind === 'character') murder = reportKill(world, a.c, n, nowG, { helpless }).murder;
          if (murder) xp = 0;
        }
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
    ...(ko ? { knocked_out: true } : {}),
    ...(helpless ? { helpless: true } : {}),
    ...(failures ? { death_save_failures: failures } : {}),
  };
}

// ---------------------------------------------------------------------------
// El turno de un NPC
// ---------------------------------------------------------------------------

/**
 * El turno de un NPC contra un objetivo: tantos ataques como su multiataque
 * (para si el objetivo cae). Devuelve el último golpe con el daño sumado y
 * cada golpe en `attacks`; el registro del combate lo cuenta como uno.
 */
export function npcTurn(world: World, npcId: Id, targetId: Id, advantage: Advantage = 'none', rng?: Rng, nowGameS?: number): AttackOutcome | { error: string } {
  const n = world.npcs.get(npcId);
  const times = Math.max(1, Math.floor(n?.stats?.multiattack ?? 1));
  const attacks: AttackOutcome[] = [];
  for (let i = 0; i < times; i++) {
    const r = resolveAttack(world, npcId, targetId, advantage, rng, nowGameS);
    if ('error' in r) { if (!attacks.length) return r; break; }
    attacks.push(r);
    if (r.target_down || r.target_dead) break;
  }
  if (attacks.length === 1) return attacks[0]!;
  const last = attacks.at(-1)!;
  const failures = attacks.reduce((sum, x) => sum + (x.death_save_failures ?? 0), 0);
  return {
    ...last,
    attack_breakdown: attacks.map((x, k) => `${k + 1}º: ${x.attack_breakdown}`).join(' · '),
    hit: attacks.some((x) => x.hit),
    damage: attacks.reduce((sum, x) => sum + x.damage, 0),
    damage_breakdown: attacks.map((x) => x.damage_breakdown).join(' · '),
    ...(failures ? { death_save_failures: failures } : {}),
    attacks,
  };
}

/** Un NPC del combate que tiene que actuar en este turno, y contra quién. */
export interface DueTurn { npc: Npc; target: Character }

/**
 * NPC que deben actuar en este turno: en pie y sueltos, con bloque de combate,
 * hostiles con alguno de los PJ del turno que siga en pie en su misma
 * localización, y que aún no han actuado (`acted`). Su objetivo, el primero
 * de `pcIds` con quien es hostil (el actor va primero). Sin efectos.
 */
export function dueNpcTurns(world: World, pcIds: readonly Id[], acted: ReadonlySet<Id>): DueTurn[] {
  const pcs = pcIds.map((id) => world.characters.get(id)).filter((c): c is Character => Boolean(c && c.status === 'active' && !c.veiled && !c.transit));
  const out: DueTurn[] = [];
  for (const n of world.npcs.values()) {
    if (!n.stats || !npcCanAct(n) || acted.has(n.id)) continue;
    const loc = world.spots.get(n.location.id)?.location_id;
    const target = pcs.find((c) => world.characterSpot(c)?.location_id === loc && attitudeOf(n, c.id) === 'hostile');
    if (target) out.push({ npc: n, target });
  }
  return out;
}

/** Lo que hizo el motor por un NPC que no actuó: a quién atacó, si tuvo que lanzarse hasta él y el resultado. */
export interface ForcedTurn { npc_id: Id; target_id: Id; moved_to: Id | null; outcome: AttackOutcome }

/**
 * El motor hace actuar a los NPC que deben y no lo han hecho (dueNpcTurns):
 * el que pelea cuerpo a cuerpo y está en otro punto de la sala se lanza hasta
 * su objetivo, y ataca con su multiataque. Los marca en `acted`.
 */
export function forceNpcTurns(world: World, pcIds: readonly Id[], acted: Set<Id>, rng?: Rng, nowGameS?: number): ForcedTurn[] {
  const out: ForcedTurn[] = [];
  for (const { npc, target } of dueNpcTurns(world, pcIds, acted)) {
    acted.add(npc.id);
    if (target.status !== 'active') continue; // ya cayó con un golpe de otro
    const to = world.characterSpot(target)?.id ?? null;
    let moved: Id | null = null;
    if (to && to !== npc.location.id && !npc.stats!.ranged) { npc.location = { type: 'spot', id: to }; npc.talking_to = null; world.touch('npcs', npc.id); moved = to; }
    const r = npcTurn(world, npc.id, target.id, 'none', rng, nowGameS);
    if ('error' in r) continue;
    out.push({ npc_id: npc.id, target_id: target.id, moved_to: moved, outcome: r });
  }
  return out;
}

/**
 * El turno de un NPC en una frase, con el nombre que sabe quien lo lee
 * (`label`) y en segunda persona si el golpe es para él: «El herrero te ataca
 * 2 veces con martillo: el primero te da (6), el segundo falla. Te quedan 2/8 PG.»
 */
export function forcedTurnText(world: World, t: ForcedTurn, readerId: Id | null, label: (npcId: Id) => string): string {
  const you = t.target_id === readerId;
  const tgt = world.characters.get(t.target_id)?.name ?? 'alguien';
  const who = label(t.npc_id);
  const Who = who.charAt(0).toUpperCase() + who.slice(1);
  const hits = t.outcome.attacks ?? [t.outcome];
  const one = (x: AttackOutcome) => (x.hit ? `${you ? 'te da' : 'le da'} (${x.damage})` : 'falla');
  const lead = t.moved_to ? `${Who} se lanza contra ${you ? 'ti' : tgt} y ` : `${Who} `;
  const verb = hits.length > 1
    ? `${you ? 'te ' : ''}ataca ${hits.length} veces con ${t.outcome.weapon}${you ? '' : ` a ${tgt}`}: ${hits.map((x, k) => `${k ? 'el segundo' : 'el primero'} ${one(x)}`).join(', ')}`
    : `${you ? 'te ' : ''}ataca con ${t.outcome.weapon}${you ? '' : ` a ${tgt}`} y ${one(hits[0]!)}`;
  const end = t.outcome.target_dead ? (you ? ' Mueres.' : ` ${tgt} muere.`)
    : t.outcome.target_down ? (you ? ' Caes al suelo, inconsciente.' : ` ${tgt} cae al suelo.`)
    : t.outcome.hit ? (you ? ` Te quedan ${t.outcome.target_hp} PG.` : ` ${tgt} queda a ${t.outcome.target_hp} PG.`) : '';
  return `${lead}${verb}.${end}`;
}

export function attitudeOf(n: Npc, characterId: Id) { return n.attitude.by_character[characterId] ?? n.attitude.default; }

export { stabilizeIfAway } from './death.js';
