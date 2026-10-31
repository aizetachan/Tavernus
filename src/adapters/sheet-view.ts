/**
 * Hoja viva (SPEC §4.9) como datos planos, sin cliente: la web la pinta como
 * panel. Posición, estado, combate, inventario y carga.
 */

import type { Engine } from '../engine/engine.js';
import { inventoryView, packView, type PackView } from '../engine/inventory.js';
import type { Id } from '../engine/model.js';
import { positionOf } from '../engine/movement.js';
import { ABILITY_ES, SKILLS, armorClass, saveModifier, skillModifier, type Ability } from '../engine/rules.js';
import { isDying, isStable, respawnSpotId } from '../engine/death.js';
import { hitDiceLeft, resourceLines } from '../engine/rest.js';
import { hhmm } from '../engine/schedule.js';
import { money } from '../engine/money.js';
import { classSheet, type ClassSheet } from '../engine/levels.js';

export interface SheetView {
  title: string;
  description: string;
  fields: { name: string; value: string; inline: boolean }[];
  footer: string;
  /** Modo de muerte y estado de caída o muerte (la web pinta la cuenta atrás con `respawn_real_ms`). */
  death: { mode: 'casual' | 'hardcore'; state: 'alive' | 'dying' | 'stable' | 'dead'; success?: number; fail?: number; stable_until?: string; respawn_real_ms?: number; respawn_place?: string };
  /** Clase y nivel (levels.ts): PX, rasgos con usos, elecciones y conjuros. La web lo pinta como sección. */
  class: ClassSheet;
  /** Lo que lleva, con sus huecos (la web pinta los libres): manos, cada hueco de equipo, bolsillos y contenedores. */
  pack: PackView & { coins: number; money: string; load: string; carry: Carry };
}

/** La carga para la barra de peso de la web: lo que llevas, el tope y dónde empiezan «cargado» y «muy cargado». */
export interface Carry { weight_lb: number; max_lb: number; encumbered_lb: number; heavily_lb: number; level: 'ok' | 'encumbered' | 'heavily' | 'immobile'; speed_penalty_ft: number }

const fmt = (n: number) => (n >= 0 ? `+${n}` : String(n));

export function sheetView(engine: Engine, characterId: Id): SheetView {
  const c = engine.world.character(characterId);
  const nowG = engine.gameNow();
  const pos = positionOf(engine.world, c, nowG);
  const loc = engine.world.location(pos.location_id);
  const spot = engine.world.spot(pos.spot_id);
  const inv = inventoryView(engine.world, c.id);
  const status = { active: 'despierto', asleep: c.veiled ? 'dormido (velo)' : 'dormido', unconscious: isStable(c) ? 'inconsciente, estable' : 'inconsciente, cayendo', dead: 'muerto', retired: 'retirado' }[c.status];
  const death: SheetView['death'] = c.status === 'dead' && c.death
    ? { mode: c.death_mode, state: 'dead', respawn_real_ms: c.death.respawn_real_ms, respawn_place: engine.world.spot(respawnSpotId(engine.world, c)).name }
    : isDying(c) ? { mode: c.death_mode, state: 'dying', success: c.dying!.success, fail: c.dying!.fail }
    : isStable(c) ? { mode: c.death_mode, state: 'stable', ...(c.dying?.stable_until_game_s ? { stable_until: hhmm(c.dying.stable_until_game_s) } : {}) }
    : { mode: c.death_mode, state: 'alive' };
  const deathLine = `Modo ${c.death_mode}${death.state === 'dying' ? ` · salvaciones: ${death.success} éxitos, ${death.fail} fallos` : death.state === 'stable' ? ` · estable${death.stable_until ? `, despierta hacia las ${death.stable_until}` : ''}` : death.state === 'dead' ? ` · muerto, vuelve en ${death.respawn_place}` : ''}`;
  const transit = c.transit ? `\nDe camino a ${engine.world.spot(c.transit.destination_spot_id).name}` : '';
  const ab = c.abilities;
  const saves = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]).filter((a) => c.proficiencies.saves.includes(a)).map((a) => `${ABILITY_ES[a].slice(0, 3)} ${fmt(saveModifier(c, a))}`).join(' · ');
  const skills = Object.keys(SKILLS).filter((k) => c.proficiencies.skills.includes(k) || c.proficiencies.expert.includes(k)).map((k) => `${SKILLS[k]!.es} ${fmt(skillModifier(c, k))}`).join(' · ');
  const cls = classSheet(c);
  const uses = (u: ClassSheet['features'][number]['uses']) => (u ? ` (${u.left}/${u.max})` : '');
  const pending = cls.choices.filter((ch) => ch.pending).map((ch) => ch.name);
  const spellText = cls.spells
    ? [`CD ${cls.spells.save_dc} · ataque ${fmt(cls.spells.attack)}${cls.spells.slots.length ? ` · espacios ${cls.spells.slots.map((x) => `${x.label.toLowerCase()} ${x.left}/${x.max}`).join(', ')}` : ''}`, ...cls.spells.groups.map((g) => `${g.label}: ${g.spells.map((x) => x.name).join(', ')}`)].join('\n')
    : cls.spells_from ? `Desde nivel ${cls.spells_from}` : '';
  const load = `${inv.encumbrance.weight_lb.toFixed(1)} / ${inv.encumbrance.max_lb} lb` + ({ ok: '', encumbered: ' · cargado', heavily: ' · muy cargado', immobile: ' · inmóvil' }[inv.encumbrance.level]);
  return {
    title: `${c.name} · ${c.race} ${c.class_name} · nivel ${c.level}`,
    description: `${status} · ${loc.name}, ${spot.name}${transit}`,
    fields: [
      { name: 'Combate', value: `PG ${c.hp_current}/${c.hp_max}${c.hp_temp ? ` (+${c.hp_temp})` : ''} · CA ${armorClass(engine.world, c)} · Velocidad ${c.speed_ft} ft · Percepción pasiva ${c.passive_perception}${c.conditions.length ? `\nCondiciones: ${c.conditions.map((x) => x.name).join(', ')}` : ''}`, inline: false },
      { name: 'Descanso', value: `Dados de golpe ${hitDiceLeft(c)}/${c.level} (d${c.hit_die})${resourceLines(c).length ? `\n${resourceLines(c).join(' · ')}` : ''}`, inline: false },
      { name: 'Muerte', value: deathLine, inline: false },
      { name: 'Características', value: `FUE ${ab.str} · DES ${ab.dex} · CON ${ab.con} · INT ${ab.int} · SAB ${ab.wis} · CAR ${ab.cha}\nSalvaciones: ${saves || '—'}`, inline: false },
      { name: 'Habilidades', value: skills || '—', inline: false },
      { name: 'Nivel', value: `${c.level} · ${c.xp} PX${cls.next_xp !== null ? ` (siguiente a ${cls.next_xp})` : ''}${pending.length ? `\nPor elegir: ${pending.join(', ')}` : ''}`, inline: false },
      { name: 'Rasgos', value: cls.features.map((f) => `${f.name}${uses(f.uses)}`).join(' · ') || '—', inline: false },
      ...(spellText ? [{ name: 'Conjuros', value: spellText.slice(0, 1000), inline: false }] : []),
      { name: 'Manos', value: `${inv.hands.main ?? '—'} / ${inv.hands.off ?? '—'}`, inline: true },
      { name: 'Bolsillos', value: inv.pockets.length ? inv.pockets.join(', ') : '—', inline: true },
      { name: 'Equipado', value: Object.entries(inv.equipped).map(([k, v]) => `${k}: ${v}`).join('\n') || '—', inline: true },
      ...inv.containers.map((k) => ({ name: k.name, value: k.items.length ? k.items.join(', ') : 'vacía', inline: false })),
      { name: 'Monedas', value: money(engine.world, inv.coins), inline: true },
      { name: 'Carga', value: load, inline: true },
    ],
    footer: engine.clock.format(nowG),
    death,
    class: cls,
    pack: { ...packView(engine.world, c.id), coins: inv.coins, money: money(engine.world, inv.coins), load, carry: carryOf(engine, c.abilities.str, inv.encumbrance) },
  };
}

function carryOf(engine: Engine, str: number, e: ReturnType<typeof inventoryView>['encumbrance']): Carry {
  const rules = engine.world.campaign.capacity_rules;
  return { weight_lb: Math.round(e.weight_lb * 10) / 10, max_lb: e.max_lb, encumbered_lb: str * rules.encumbered_at, heavily_lb: str * rules.heavily_at, level: e.level, speed_penalty_ft: e.speed_penalty_ft };
}
