/**
 * Resolución de nombres canónicos + alias (SPEC §3.2 regla 1). El servidor
 * resuelve el texto del jugador antes de que llegue al master. Si no
 * resuelve, se pregunta; nunca se inventa.
 */

import type { Character, Id } from './model.js';
import type { World } from './world.js';

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\b(el|la|los|las|un|una|unos|unas|al|del|de|the|a|an|to|hacia|hasta|en|por)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Candidate<T> { value: T; score: number; matched: string }

function score(query: string, names: string[]): { score: number; matched: string } | null {
  let bestScore = 0;
  let matched = '';
  for (const raw of names) {
    const n = normalize(raw);
    if (!n) continue;
    let s = 0;
    if (n === query) s = 100;
    else if (query.includes(n)) s = 60 + Math.min(30, n.length);
    else if (n.includes(query) && query.length >= 3) s = 40 + Math.min(20, query.length);
    else {
      // Todas las palabras de la query aparecen en el nombre.
      const qw = query.split(' ');
      if (qw.length && qw.every((w) => n.includes(w))) s = 30;
    }
    if (s > bestScore) { bestScore = s; matched = raw; }
  }
  return bestScore > 0 ? { score: bestScore, matched } : null;
}

export type Resolution<T> =
  | { kind: 'one'; value: T; matched: string }
  | { kind: 'many'; candidates: Candidate<T>[] }
  | { kind: 'none' };

function pick<T>(cands: Candidate<T>[]): Resolution<T> {
  if (cands.length === 0) return { kind: 'none' };
  cands.sort((a, b) => b.score - a.score);
  const top = cands[0]!;
  const ties = cands.filter((c) => c.score === top.score);
  if (ties.length === 1) return { kind: 'one', value: top.value, matched: top.matched };
  return { kind: 'many', candidates: ties };
}

/**
 * Puntos alcanzables por nombre desde donde está el PJ: los de su
 * localización (visibles para él) y los destinos de las salidas, más las
 * localizaciones vecinas por nombre (→ su punto por defecto).
 */
export function resolveSpot(world: World, c: Character, text: string): Resolution<Id> {
  const q = normalize(text);
  if (!q) return { kind: 'none' };
  const here = world.characterSpot(c);
  if (!here) return { kind: 'none' };
  const cands: Candidate<Id>[] = [];
  const seen = new Set<Id>();
  const consider = (spotId: Id, extraNames: string[] = [], bonus = 0) => {
    if (seen.has(spotId)) return;
    seen.add(spotId);
    const s = world.spot(spotId);
    if (s.hidden && !s.discovered_by.includes(c.id)) return;
    const m = score(q, [s.name, ...s.aliases, ...extraNames]);
    if (m) cands.push({ value: s.id, score: m.score + bonus, matched: m.matched });
  };
  // 1. Puntos de la localización actual: prioridad en empates.
  for (const s of world.spotsOf(here.location_id)) consider(s.id, [], 1);
  // 2. Localizaciones conocidas: vecinas por salida, visitadas o de oídas.
  const known = new Set<Id>();
  for (const s of world.spotsOf(here.location_id)) {
    for (const { to_spot_id } of world.exitsFrom(s.id)) {
      const loc = world.locationOfSpot(to_spot_id);
      known.add(loc.id);
      consider(to_spot_id, [loc.name]);
    }
  }
  for (const loc of world.locations.values()) {
    if (loc.id === here.location_id) continue;
    const d = loc.discovery[c.id];
    if (d === 'visited' || d === 'heard_of') known.add(loc.id);
  }
  for (const id of known) {
    const loc = world.location(id);
    consider(loc.default_spot_id, [loc.name]);
    for (const s of world.spotsOf(id)) consider(s.id);
  }
  return pick(cands);
}

export type ItemScope = 'reach' | 'carried' | 'floor';

/**
 * Ítems al alcance del PJ: los que lleva (`carried`), los sueltos en su punto
 * (`floor`) o ambos (`reach`). Dos ejemplares del mismo ítem no son ambiguos:
 * se devuelve el primero.
 */
export function resolveItem(world: World, c: Character, text: string, scope: ItemScope = 'reach'): Resolution<Id> {
  const q = normalize(text);
  if (!q) return { kind: 'none' };
  const here = world.characterSpot(c);
  const cands: (Candidate<Id> & { item_id: Id })[] = [];
  const consider = (instId: Id) => {
    const inst = world.itemInstance(instId);
    const def = world.itemDef(inst.item_id);
    const m = score(q, [def.name, ...def.aliases]);
    if (m) cands.push({ value: inst.id, score: m.score, matched: m.matched, item_id: inst.item_id });
  };
  if (scope !== 'floor') for (const i of world.itemsCarriedBy(c.id)) consider(i.id);
  if (scope !== 'carried' && here) for (const i of world.itemsIn({ type: 'spot', id: here.id })) consider(i.id);
  const r = pick(cands);
  if (r.kind === 'many' && new Set(r.candidates.map((x) => (x as typeof cands[number]).item_id)).size === 1) {
    const first = r.candidates[0]!;
    return { kind: 'one', value: first.value, matched: first.matched };
  }
  return r;
}

export function resolveResourceNode(world: World, c: Character, text: string): Resolution<Id> {
  const q = normalize(text);
  const here = world.characterSpot(c);
  if (!q || !here) return { kind: 'none' };
  const cands: Candidate<Id>[] = [];
  for (const n of world.resourceNodes.values()) {
    if (n.spot_id !== here.id) continue;
    const m = score(q, [n.name, ...n.aliases]);
    if (m) cands.push({ value: n.id, score: m.score, matched: m.matched });
  }
  return pick(cands);
}
