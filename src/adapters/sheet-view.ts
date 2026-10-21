/**
 * Hoja viva (SPEC §4.9) como datos planos, sin cliente: Discord la pinta como
 * embed y la web como panel. Posición, estado, combate, inventario y carga.
 */

import type { Engine } from '../engine/engine.js';
import { inventoryView } from '../engine/inventory.js';
import type { Id } from '../engine/model.js';
import { positionOf } from '../engine/movement.js';
import { ABILITY_ES, SKILLS, armorClass, saveModifier, skillModifier, type Ability } from '../engine/rules.js';

export interface SheetView {
  title: string;
  description: string;
  fields: { name: string; value: string; inline: boolean }[];
  footer: string;
}

const fmt = (n: number) => (n >= 0 ? `+${n}` : String(n));

export function sheetView(engine: Engine, characterId: Id): SheetView {
  const c = engine.world.character(characterId);
  const nowG = engine.gameNow();
  const pos = positionOf(engine.world, c, nowG);
  const loc = engine.world.location(pos.location_id);
  const spot = engine.world.spot(pos.spot_id);
  const inv = inventoryView(engine.world, c.id);
  const status = { active: 'despierto', asleep: c.veiled ? 'dormido (velo)' : 'dormido', unconscious: 'inconsciente', dead: 'muerto', retired: 'retirado' }[c.status];
  const transit = c.transit ? `\nDe camino a ${engine.world.spot(c.transit.destination_spot_id).name}` : '';
  const ab = c.abilities;
  const saves = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]).filter((a) => c.proficiencies.saves.includes(a)).map((a) => `${ABILITY_ES[a].slice(0, 3)} ${fmt(saveModifier(c, a))}`).join(' · ');
  const skills = Object.keys(SKILLS).filter((k) => c.proficiencies.skills.includes(k) || c.proficiencies.expert.includes(k)).map((k) => `${SKILLS[k]!.es} ${fmt(skillModifier(c, k))}`).join(' · ');
  const load = `${inv.encumbrance.weight_lb.toFixed(1)} / ${inv.encumbrance.max_lb} lb` + ({ ok: '', encumbered: ' · cargado', heavily: ' · muy cargado', immobile: ' · inmóvil' }[inv.encumbrance.level]);
  return {
    title: `${c.name} · ${c.race} ${c.class_name} · nivel ${c.level}`,
    description: `${status} · ${loc.name}, ${spot.name}${transit}`,
    fields: [
      { name: 'Combate', value: `PG ${c.hp_current}/${c.hp_max}${c.hp_temp ? ` (+${c.hp_temp})` : ''} · CA ${armorClass(engine.world, c)} · Velocidad ${c.speed_ft} ft · Percepción pasiva ${c.passive_perception}${c.conditions.length ? `\nCondiciones: ${c.conditions.map((x) => x.name).join(', ')}` : ''}`, inline: false },
      { name: 'Características', value: `FUE ${ab.str} · DES ${ab.dex} · CON ${ab.con} · INT ${ab.int} · SAB ${ab.wis} · CAR ${ab.cha}\nSalvaciones: ${saves || '—'}`, inline: false },
      { name: 'Habilidades', value: skills || '—', inline: false },
      { name: 'Manos', value: `${inv.hands.main ?? '—'} / ${inv.hands.off ?? '—'}`, inline: true },
      { name: 'Bolsillos', value: inv.pockets.length ? inv.pockets.join(', ') : '—', inline: true },
      { name: 'Equipado', value: Object.entries(inv.equipped).map(([k, v]) => `${k}: ${v}`).join('\n') || '—', inline: true },
      ...inv.containers.map((k) => ({ name: k.name, value: k.items.length ? k.items.join(', ') : 'vacía', inline: false })),
      { name: 'Monedas', value: String(inv.coins), inline: true },
      { name: 'Carga', value: load, inline: true },
    ],
    footer: engine.clock.format(nowG),
  };
}
