/**
 * Ventana de turno por localización (docs/MULTIJUGADOR.md, «Varios a la vez en
 * el mismo sitio»). La primera acción de un PJ abre una ventana corta
 * (TURN_WINDOW_S, 3 s por defecto); lo que manden otros PJ del mismo sitio
 * dentro de ella va al máster en la misma llamada, como un turno compartido.
 * Aquí, lo puro: a qué apunta cada acción y dónde chocan. El motor (engine.ts)
 * lleva el temporizador y la cola.
 */

import { normalize } from './aliases.js';
import type { Character, GameEvent, Id } from './model.js';
import { namedPc, npcTarget } from './scene.js';
import type { World } from './world.js';

/** Ventana de turno (ms reales). Se cierra antes si ya han actuado todos los que pueden. */
export const TURN_WINDOW_MS = 3_000;

/** Lo que llega a la ventana: quién y qué escribió. */
export interface WindowItem { id: Id; text: string }

/** Dos o más PJ que van a por lo mismo en la misma ventana. `what`: cómo se le dice al máster. */
export interface Clash { what: string; ids: Id[] }

/** A qué apunta una acción: NPC, otro PJ u objeto suelto de la localización. Claves estables para comparar. */
export function targetsOf(world: World, events: readonly GameEvent[], c: Character, text: string, nowGameS: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const npc = npcTarget(world, events, c, text, nowGameS);
  if (npc) out.push({ key: `npc:${npc.id}`, label: `${npc.name} [${npc.id}]` });
  const pc = namedPc(world, c, text);
  if (pc) out.push({ key: `pc:${pc.id}`, label: `${pc.name} [${pc.id}]` });
  for (const it of looseItemsNamed(world, c, text)) out.push({ key: `item:${it.id}`, label: `${it.name} [${it.id}]` });
  return out;
}

/** Objetos sueltos (en el suelo de algún punto de la localización) cuyo nombre o alias sale en el texto. */
function looseItemsNamed(world: World, c: Character, text: string): { id: Id; name: string }[] {
  const loc = world.characterSpot(c)?.location_id;
  if (!loc) return [];
  const t = ` ${normalize(text)} `;
  const out: { id: Id; name: string }[] = [];
  for (const i of world.itemInstances.values()) {
    if (i.location.type !== 'spot' || world.spots.get(i.location.id)?.location_id !== loc) continue;
    const d = world.itemDefs.get(i.item_id);
    if (!d) continue;
    const names = [d.name, ...d.aliases].map((x) => normalize(x)).filter((x) => x.length > 2);
    if (names.some((n) => t.includes(` ${n} `))) out.push({ id: i.id, name: d.name });
  }
  return out;
}

/**
 * Choques de la ventana: dos o más PJ con el mismo objetivo (el mismo NPC, el
 * mismo objeto, el mismo PJ) o uno que actúa sobre otro que también actúa. El
 * máster los resuelve a la vez, con tiradas si hace falta.
 */
export function windowClashes(world: World, events: readonly GameEvent[], items: readonly WindowItem[], nowGameS: number): Clash[] {
  const byKey = new Map<string, { label: string; ids: Set<Id> }>();
  const acting = new Set(items.map((i) => i.id));
  for (const it of items) {
    const c = world.characters.get(it.id);
    if (!c) continue;
    for (const t of targetsOf(world, events, c, it.text, nowGameS)) {
      const slot = byKey.get(t.key) ?? { label: t.label, ids: new Set<Id>() };
      slot.ids.add(it.id);
      // Actuar sobre un PJ que también actúa en esta ventana: los dos están en el choque.
      if (t.key.startsWith('pc:') && acting.has(t.key.slice(3))) slot.ids.add(t.key.slice(3));
      byKey.set(t.key, slot);
    }
  }
  return [...byKey.values()].filter((s) => s.ids.size >= 2).map((s) => ({ what: s.label, ids: [...s.ids] }));
}

/**
 * ¿Habla de «tú» en singular, fuera de las citas? En un turno compartido el texto
 * común lo leen todos: «tú», «te», «tu» o «contigo» no dicen a quién.
 */
export function secondPersonSingular(text: string): string | null {
  const bare = text.replace(/«[^»]*»/g, ' ').replace(/"[^"]*"/g, ' ').replace(/“[^”]*”/g, ' ');
  const m = /(?:^|[^\p{L}])(t[uú]|te|ti|contigo|tuy[oa]s?)(?=[^\p{L}]|$)/iu.exec(bare);
  return m ? m[1]! : null;
}
