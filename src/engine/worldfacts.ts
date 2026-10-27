/**
 * Hechos del mundo (bloque I, «Hechos y reglas del mundo»): lo que ha pasado y
 * se puede consultar después, como las bases de hechos de Osiris en Baldur's
 * Gate 3. «Hugo murió a manos de Leodhin», «Ceniza volvió a casa», «el pozo
 * está limpio». Cada hecho lleva quién lo sabe: lo vio o se lo contaron. De ahí
 * salen la opinión de quien no estaba (le llega con retraso, de boca en boca,
 * nunca por adivinación) y los comentarios que se oyen al pasar.
 *
 * Los crea el motor de reglas (worldrules.ts) al detectar un evento (`npc_dead:npc_hugo`,
 * `quest_done:q_perro@pc`) o una regla de los datos con el efecto `fact`
 * (`ceniza_salvado`). Las condiciones de la historia los consultan con
 * `{ kind: 'fact', id }`: así lo que se salva o se condena vuelve más tarde.
 *
 * Módulo hoja (solo tipos): lo importan story.ts y el motor de reglas sin ciclos.
 * Se guardan en la campaña (`campaign.world_facts`), como los rumores: viajan
 * con el snapshot y se persisten al tocar la campaña.
 */

import type { Character, Id } from './model.js';
import type { World } from './world.js';

/** Quién sabe un hecho y cómo: lo vio, o se lo contó alguien (de boca en boca). */
export interface FactKnower {
  npc_id: Id;
  how: 'saw' | 'told';
  /** Quién se lo contó (NPC); null si lo vio. */
  from: Id | null;
  game_s: number;
}

export interface WorldFact {
  /** `npc_dead:npc_hugo`, `quest_done:q_perro@pc_1`, `incident:inc_x`… o el de los datos (`ceniza_salvado`). */
  id: Id;
  /** En palabras del mundo, para el máster: «Hugo, el herrero, murió a manos de Leodhin». Sin él, no va al contexto. */
  text?: string;
  /** PJ que lo hizo, si lo hay. */
  by: Id | null;
  /** Lo que toca: el NPC, la misión, el objeto, el punto. */
  subject: Id | null;
  location_id: Id | null;
  game_s: number;
  knowers: FactKnower[];
  /** Corre de boca en boca (por defecto, sí). Uno de los datos sin testigos no corre. */
  spreads?: boolean;
}

/** Lo que dura una noticia corriendo de boca en boca (como las de crime.ts). */
export const FACT_NEWS_S = 3 * 24 * 3600;
const MAX_FACTS = 600;

type FactCampaign = { world_facts?: WorldFact[] };

function store(world: World): WorldFact[] {
  const camp = world.campaign as typeof world.campaign & FactCampaign;
  camp.world_facts ??= [];
  return camp.world_facts;
}

export function allFacts(world: World): readonly WorldFact[] { return store(world); }

export function factById(world: World, id: Id): WorldFact | null { return store(world).find((f) => f.id === id) ?? null; }

/** ¿Ha pasado? Lo consultan las condiciones (`{ kind: 'fact' }`) y las reglas. */
export function hasFact(world: World, id: Id): boolean { return store(world).some((f) => f.id === id); }

/**
 * Apunta un hecho (o, si ya está, le suma quien lo sabe). Devuelve el hecho.
 * `knowers` son los NPC que lo han visto.
 */
export function setFact(world: World, f: Omit<WorldFact, 'knowers'> & { knowers?: FactKnower[] }): WorldFact {
  const list = store(world);
  const cur = list.find((x) => x.id === f.id);
  if (cur) {
    for (const k of f.knowers ?? []) learnFact(world, cur, k);
    // Lo último que se sabe manda (un incidente que sube de agresión a muerte).
    if (f.text) cur.text = f.text;
    world.touch('campaign', world.campaign.id);
    return cur;
  }
  const fact: WorldFact = { ...f, knowers: [...(f.knowers ?? [])] };
  list.push(fact);
  // Los más viejos sin texto se olvidan primero: los de los datos y los que cuentan algo se quedan.
  while (list.length > MAX_FACTS) {
    const i = list.findIndex((x) => !x.text);
    list.splice(i >= 0 ? i : 0, 1);
  }
  world.touch('campaign', world.campaign.id);
  return fact;
}

export function removeFact(world: World, id: Id): boolean {
  const list = store(world);
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  world.touch('campaign', world.campaign.id);
  return true;
}

/** Un NPC se entera. true si no lo sabía. Quien lo vio no pasa a «se lo contaron». */
export function learnFact(world: World, f: WorldFact, k: FactKnower): boolean {
  if (f.knowers.some((x) => x.npc_id === k.npc_id)) return false;
  f.knowers.push(k);
  world.touch('campaign', world.campaign.id);
  return true;
}

export function knowsFact(f: WorldFact, npcId: Id): boolean { return f.knowers.some((k) => k.npc_id === npcId); }

/** Los hechos con texto que tocan a este PJ o a su sitio, los últimos primero (para el contexto del máster). */
export function factsFor(world: World, c: Character, limit = 6): WorldFact[] {
  return store(world).filter((f) => f.text).slice(-40).reverse()
    .filter((f, i) => f.by === c.id || i < limit).slice(0, limit);
}
