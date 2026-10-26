/**
 * Respuestas del sistema a las preguntas sobre el juego (fastpath.ts,
 * `parseInfo`): la hoja, lo que lleva, sus misiones, quién tiene al lado o
 * qué dados tira. Salen del estado, al momento y sin IA, con plantilla; no
 * son narración ni avisan a nadie, y no quedan en el registro de eventos (el
 * máster no las ve). Cada respuesta es un título y unas líneas: la web las
 * pinta como ficha y los demás clientes, como texto.
 */

import { journalOf, npcLabel } from './journal.js';
import type { Engine } from './engine.js';
import { weaponOf } from './combat.js';
import { isDying, isStable } from './death.js';
import { debtLine, fmtCoins, openDebts } from './debts.js';
import { abilityModifier, proficiencyBonus } from './dice.js';
import type { InfoIntent } from './fastpath.js';
import { RULE_TERMS } from './fastpath.js';
import { inventoryView } from './inventory.js';
import type { Character, Id } from './model.js';
import { positionOf } from './movement.js';
import { descriptorOf, whereAmI } from './narrate.js';
import { perceive } from './perception.js';
import { hitDiceLeft, classResources, restState } from './rest.js';
import { ABILITY_ES, SKILLS, armorClass, modifierFor, saveModifier, skillModifier, type Ability, type CheckKind } from './rules.js';
import { classById } from '../data/srd/index.js';

export interface InfoAnswer { title: string; lines: string[] }

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SHORT: Record<Ability, string> = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const DAMAGE_ES: Record<string, string> = {
  bludgeoning: 'contundente', piercing: 'perforante', slashing: 'cortante', fire: 'fuego', cold: 'frío', lightning: 'rayo',
  thunder: 'trueno', poison: 'veneno', acid: 'ácido', necrotic: 'necrótico', radiant: 'radiante', force: 'fuerza', psychic: 'psíquico',
};

/** +3, −1, +0. */
const sign = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
/** 1d20 + 3, 1d20 − 1, 1d20. */
const d20 = (mod: number) => (mod === 0 ? '1d20' : `1d20 ${mod < 0 ? '−' : '+'} ${Math.abs(mod)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Texto plano de una respuesta, para los clientes sin ficha (Discord, consola). */
export function infoText(a: InfoAnswer): string {
  return [`**${a.title}**`, ...a.lines].join('\n');
}

export function answerInfo(engine: Engine, c: Character, intent: InfoIntent): InfoAnswer {
  const w = engine.world;
  switch (intent.topic) {
    case 'abilities': {
      const row = (abs: Ability[]) => abs.map((a) => `${SHORT[a]} ${c.abilities[a]} (${sign(abilityModifier(c.abilities[a]))})`).join(' · ');
      const saves = ABILITIES.filter((a) => c.proficiencies.saves.includes(a)).map((a) => `${ABILITY_ES[a]} ${sign(saveModifier(c, a))}`);
      return {
        title: `${c.name} · ${c.race} ${c.class_name}, nivel ${c.level}`,
        lines: [row(['str', 'dex', 'con']), row(['int', 'wis', 'cha']), `Competencia ${sign(proficiencyBonus(c.level))} · Salvaciones: ${saves.join(', ') || '—'}`],
      };
    }
    case 'ability': {
      const a = intent.ability;
      const mod = abilityModifier(c.abilities[a]);
      const skills = Object.entries(SKILLS).filter(([, v]) => v.ability === a).map(([k, v]) => `${v.es} ${sign(skillModifier(c, k))}`);
      return {
        title: ABILITY_ES[a],
        lines: [
          `${c.abilities[a]} (${sign(mod)}): una prueba de ${ABILITY_ES[a]} es ${d20(mod)}.`,
          `Salvación de ${ABILITY_ES[a]}: ${d20(saveModifier(c, a))}${c.proficiencies.saves.includes(a) ? ' (con competencia)' : ''}.`,
          ...(skills.length ? [`Habilidades: ${skills.join(', ')}.`] : []),
        ],
      };
    }
    case 'skill': {
      const k = intent.skill;
      const def = SKILLS[k]!;
      const parts = [`${ABILITY_ES[def.ability]} ${sign(abilityModifier(c.abilities[def.ability]))}`];
      const pb = proficiencyBonus(c.level);
      if (c.proficiencies.expert.includes(k)) parts.push(`pericia ${sign(pb * 2)}`);
      else if (c.proficiencies.skills.includes(k)) parts.push(`competencia ${sign(pb)}`);
      if (c.practice_bonus[k]) parts.push(`práctica ${sign(c.practice_bonus[k]!)}`);
      return { title: def.es, lines: [`${d20(skillModifier(c, k))} (${parts.join(', ')}).`] };
    }
    case 'skills': {
      const mine = Object.keys(SKILLS).filter((k) => c.proficiencies.skills.includes(k) || c.proficiencies.expert.includes(k));
      return {
        title: 'Tus habilidades',
        lines: [
          mine.length ? mine.map((k) => `${SKILLS[k]!.es} ${sign(skillModifier(c, k))}${c.proficiencies.expert.includes(k) ? ' (pericia)' : ''}`).join(' · ') : 'Ninguna con competencia.',
          'Las demás, con el modificador de su característica.',
        ],
      };
    }
    case 'spells': return spells(engine, c);
    case 'inventory': {
      const v = inventoryView(w, c.id);
      const eq = Object.values(v.equipped).filter(Boolean);
      const lvl = { ok: '', encumbered: ' · cargado', heavily: ' · muy cargado', immobile: ' · no puedes moverte' }[v.encumbrance.level];
      return {
        title: 'Lo que llevas',
        lines: [
          `En las manos: ${v.hands.main === v.hands.off && v.hands.main ? `${v.hands.main} (a dos manos)` : [v.hands.main, v.hands.off].filter(Boolean).join(' y ') || 'nada'}`,
          ...(eq.length ? [`Puesto: ${eq.join(', ')}`] : []),
          ...(v.pockets.length ? [`Bolsillos: ${v.pockets.join(', ')}`] : []),
          ...v.containers.map((k) => `${cap(k.name)}: ${k.items.length ? k.items.join(', ') : 'vacía'}`),
          `Monedas: ${fmtCoins(v.coins)} · Peso ${v.encumbrance.weight_lb.toFixed(1)} / ${v.encumbrance.max_lb} lb${lvl}`,
        ],
      };
    }
    case 'coins': {
      const now = engine.nowFor(c);
      const debts = openDebts(c).map((d) => debtLine(w, d, now, (n) => npcLabel(c, n)));
      return { title: 'Monedas', lines: [`Llevas ${fmtCoins(c.coins)} monedas.`, ...debts.map((d) => `${d}.`)] };
    }
    case 'hp': {
      const state = c.status === 'dead' ? 'Muerto.'
        : isDying(c) ? `Cayendo: ${c.dying!.success} éxitos y ${c.dying!.fail} fallos en las salvaciones contra muerte.`
        : isStable(c) ? 'Inconsciente, pero estable.' : null;
      return {
        title: 'Puntos de golpe',
        lines: [
          `PG ${c.hp_current} de ${c.hp_max}${c.hp_temp ? ` (+${c.hp_temp} temporales)` : ''}.`,
          ...(state ? [state] : []),
          ...(c.conditions.length ? [`Condiciones: ${c.conditions.map((x) => x.name).join(', ')}.`] : []),
          `Dados de golpe: ${hitDiceLeft(c)} de ${c.level} (d${c.hit_die}), para curarte en un descanso corto.`,
        ],
      };
    }
    case 'armor': return { title: 'Clase de Armadura', lines: [`CA ${armorClass(w, c)}: para darte, un ataque tiene que igualarla o superarla.`] };
    case 'level': return { title: 'Nivel', lines: [`Nivel ${c.level} · ${c.xp} PX.`] };
    case 'quests': return quests(engine, c);
    case 'people': return people(engine, c);
    case 'where': return { title: 'Dónde estás', lines: [whereAmI(w, engine.clock, c, engine.nowFor(c))] };
    case 'roll': return roll(engine, c, intent.check);
    case 'rule': return { title: 'Regla', lines: [RULE_TERMS.get(intent.term)!] };
  }
}

/** Espacios de conjuro y recursos de clase; con qué característica lanza (SRD). */
function spells(engine: Engine, c: Character): InfoAnswer {
  const ab = classById(c.class_id)?.spellcasting;
  const res = classResources(c);
  const used = restState(c).used;
  const left = (key: string, max: number) => Math.max(0, max - (used[key] ?? 0));
  const slots = res.filter((r) => r.key.startsWith('slot_'));
  const others = res.filter((r) => !r.key.startsWith('slot_'));
  if (!ab || !slots.length) {
    return { title: 'Conjuros', lines: [`No lanzas conjuros: tu clase (${c.class_name}) no tiene espacios de conjuro.`, ...others.map((r) => `${r.label}: ${left(r.key, r.max)} de ${r.max}.`)] };
  }
  const mod = abilityModifier(c.abilities[ab]) + proficiencyBonus(c.level);
  const book = engine.world.itemsCarriedBy(c.id).map((i) => engine.world.itemDef(i.item_id))
    .find((d) => [d.name, ...d.aliases].some((n) => /conjur|hechiz|grimorio|spellbook/i.test(n)));
  return {
    title: 'Conjuros',
    lines: [
      ...slots.map((r) => `${cap(r.label)}: ${left(r.key, r.max)} de ${r.max} (vuelven con un descanso ${r.recharge === 'short' ? 'corto' : 'largo'}).`),
      `Lanzas con ${ABILITY_ES[ab]}: CD de salvación ${8 + mod}, ataque de conjuro ${d20(mod)}.`,
      ...others.map((r) => `${cap(r.label)}: ${left(r.key, r.max)} de ${r.max}.`),
      `La hoja no apunta qué conjuros conoces${book ? ` (tu ${book.name} va contigo)` : ''}: al lanzar uno, di cuál y el narrador lo resuelve.`,
    ],
  };
}

/** Las del Diario, como las ordena él: primero las que lleva en curso y luego las disponibles, con lo que toca ahora. */
function quests(engine: Engine, c: Character): InfoAnswer {
  const all = journalOf(engine, c.id).quests.active;
  const doing = all.filter((q) => q.status === 'active');
  const offered = all.filter((q) => q.status === 'available');
  const MAX = 6;
  const line = (q: (typeof all)[number]) => `**${q.title}**${q.giver ? ` (${q.giver})` : q.kind === 'achievement' ? ' (logro)' : ''}${q.summary.next ? ` → ${q.summary.next}` : ''}${q.clock ? ` · quedan ${q.clock.days_left} días` : ''}`;
  const lines = [doing.length ? `${doing.length === 1 ? 'Una' : doing.length} en curso:` : 'Ninguna en curso.', ...doing.slice(0, MAX).map(line)];
  const room = Math.max(0, MAX - doing.length);
  if (offered.length && room) lines.push(`Disponibles:`, ...offered.slice(0, room).map(line));
  const rest = Math.max(0, doing.length - MAX) + Math.max(0, offered.length - room);
  if (rest) lines.push(`Y ${rest} más en el Diario.`);
  return { title: 'Tus misiones', lines };
}

/** Quién ve el PJ en su sitio: a su lado (mismo punto) y en el resto del lugar. */
function people(engine: Engine, c: Character): InfoAnswer {
  const w = engine.world;
  const now = engine.nowFor(c);
  const pos = positionOf(w, c, now);
  const near: string[] = [];
  const room: string[] = [];
  let vague = 0;
  const see = (id: Id, label: string, at: ReturnType<typeof positionOf>) => {
    const p = perceive(w, engine.clock, c, at, now);
    if (p.sight === 'vague') { vague++; return; }
    if (p.sight !== 'full') return;
    (at.spot_id === pos.spot_id ? near : room).push(label);
  };
  for (const o of w.characters.values()) {
    if (o.id === c.id || o.veiled || o.status === 'retired') continue;
    const at = positionOf(w, o, now);
    if (at.location_id !== pos.location_id) continue;
    see(o.id, `${o.name}${o.status === 'asleep' ? ' (dormido)' : o.status === 'unconscious' ? ' (inconsciente)' : o.status === 'dead' ? ' (muerto)' : ''}`, at);
  }
  for (const n of w.npcs.values()) {
    if (n.status !== 'alive') continue;
    const s = w.spot(n.location.id);
    if (s.location_id !== pos.location_id) continue;
    const label = c.knows.includes(n.id) ? `${n.name} (${n.role})` : descriptorOf(w, n.id);
    see(n.id, label, { spot_id: s.id, next_spot_id: null, progress: 0, x: s.x, y: s.y, location_id: s.location_id });
  }
  const total = near.length + room.length + vague;
  const loc = w.location(pos.location_id);
  const lines = total === 0 ? [`No ves a nadie en ${loc.name}.`] : [
    `${total === 1 ? 'Una persona' : `${total} personas`} a la vista en ${loc.name}.`,
    ...(near.length ? [`A tu lado, en ${w.spot(pos.spot_id).name}: ${near.join(', ')}.`] : []),
    ...(room.length ? [`${near.length ? 'Más allá' : 'Por el lugar'}: ${room.join(', ')}.`] : []),
    ...(vague ? [`${vague === 1 ? 'Una figura' : `${vague} figuras`} que no distingues bien.`] : []),
  ];
  return { title: 'Quién hay aquí', lines };
}

/** Qué dados tira: la tirada pendiente o la que nombra. Lo que suma, nunca la CD (la sabe el narrador). */
function roll(engine: Engine, c: Character, check: { kind: CheckKind; key: string } | null): InfoAnswer {
  if (!check) {
    const p = engine.pendingRoll(c.id);
    if (!p) return { title: 'Tirada', lines: ['No tienes ninguna tirada pendiente. Cuando haga falta, el narrador te la pedirá con el botón 🎲.'] };
    const r = p.roll;
    const adv = r.advantage === 'advantage' ? ' Con ventaja: tira 2d20 y quédate con el mayor.' : r.advantage === 'disadvantage' ? ' Con desventaja: tira 2d20 y quédate con el menor.' : '';
    const line = r.kind === 'attack' ? attackLine(engine, c) : checkLine(c, r.kind, r.key);
    return { title: 'Tu tirada pendiente', lines: [`${line}${adv}`, 'La dificultad la sabe el narrador. Pulsa 🎲 para tirar.'] };
  }
  return { title: 'Tirada', lines: [check.kind === 'attack' ? attackLine(engine, c) : checkLine(c, check.kind, check.key)] };
}

function checkLine(c: Character, kind: CheckKind, key: string): string {
  const { modifier, label } = modifierFor(c, kind, key);
  return `${cap(label)}: ${d20(modifier)}.`;
}

/** El ataque con el arma que lleva en la mano, como lo resuelve combat.ts. */
function attackLine(engine: Engine, c: Character): string {
  const wpn = weaponOf(engine.world, c);
  const str = abilityModifier(c.abilities.str), dex = abilityModifier(c.abilities.dex);
  const mod = wpn.ranged ? dex : wpn.finesse ? Math.max(str, dex) : str;
  const dmg = mod === 0 ? wpn.damage : `${wpn.damage} ${mod < 0 ? '−' : '+'} ${Math.abs(mod)}`;
  return `Ataque con ${wpn.name}: ${d20(mod + proficiencyBonus(c.level))} · daño ${dmg} (${DAMAGE_ES[wpn.damage_type] ?? wpn.damage_type}).`;
}
