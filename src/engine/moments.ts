/**
 * Momentos ilustrables. Decide, sin IA y a partir del evento ya registrado, si
 * lo que acaba de pasar merece una imagen y de qué clase:
 *
 *   - portrait:  primera conversación de un PJ con un NPC concreto (su retrato).
 *   - item:      el PJ coge, compra o examina un objeto (el objeto en la mano), salvo los
 *                servicios y lo que los datos marcan `illustrate: false` (`itemIllustrable`).
 *   - scene:     llegada a un sitio que el PJ no había pisado (la vista; la genera la primera visita).
 *   - combat:    desenlace de un combate: alguien cae o muere, o el primer golpe que hiere a un rival.
 *                El rival es siempre el otro: si el golpe lo recibe el PJ, quien lo da.
 *   - discovery: un punto oculto descubierto o una pista encontrada. La pista que llega
 *                hablando con un NPC se *oye*: no es descubrimiento (queda el retrato de quien
 *                habla, si aún no lo tenía), salvo que sus datos digan qué se ve (`Clue.image`).
 *
 * Mirar alrededor, moverse dentro del lugar, esperar o seguir hablando con quien
 * ya tiene retrato no generan nada. Cada momento tiene una clave y no se repite:
 * el motor guarda las claves vistas y las recupera de `payload.moments` de los
 * eventos pasados al arrancar.
 */

import type { Clue, GameEvent, Id, ItemDef } from './model.js';
import type { World } from './world.js';

export type MomentKind = 'portrait' | 'item' | 'scene' | 'combat' | 'discovery';

export interface Moment {
  kind: MomentKind;
  /** Clave única: el mismo momento no se vuelve a dar. */
  key: string;
  character_id: Id;
  /**
   * Qué se ilustra: el NPC (portrait), el tipo de objeto (item), la localización
   * (scene); en combat y discovery, el propio evento (una imagen por evento).
   */
  entity_id: Id;
  /** combat: el rival (nunca el propio PJ); discovery: el punto o la pista. */
  subject?: Id;
}

/** Un parlamento literal del cierre del máster (modo novela). */
export interface DialogueLine {
  /** `pc`: otro PJ que habla en un turno compartido (conversación de grupo o ronda, scene.ts). */
  speaker: 'npc' | 'actor' | 'pc';
  npc_id?: Id;
  /** Solo `pc`: qué PJ. */
  character_id?: Id;
  /** A quién se dirige una línea del NPC en un turno compartido. */
  to?: Id;
  text: string;
}

/** Lo que el clasificador necesita del mundo. */
export interface MomentLookup {
  /** De qué tipo es un ejemplar. */
  itemOfInstance(instanceId: Id): Id | null;
  /** Si ese tipo de objeto se pinta (`itemIllustrable`); sin esto, todos. */
  itemIllustrable?(itemId: Id): boolean;
  /** Los datos de una pista: si dice qué se ve (`image`), es un hallazgo aunque llegue hablando. */
  clue?(clueId: Id): Pick<Clue, 'image'> | null;
}

/** Si un objeto se pinta en la mano: los servicios (noche de posada) no, salvo `illustrate: true`; `illustrate: false`, tampoco. */
export function itemIllustrable(def: Pick<ItemDef, 'service' | 'illustrate'>): boolean {
  return def.illustrate ?? !def.service;
}

/** El lookup del clasificador sobre un mundo: lo que usa el motor. */
export function momentLookupOf(world: World): MomentLookup {
  return {
    itemOfInstance: (id) => world.itemInstances.get(id)?.item_id ?? null,
    itemIllustrable: (id) => { const def = world.itemDefs.get(id); return def ? itemIllustrable(def) : true; },
    clue: (id) => world.campaign.clues.find((c) => c.id === id) ?? null,
  };
}

type Draft = Pick<GameEvent, 'id' | 'actor_id' | 'action_type' | 'input_text' | 'location_id' | 'payload'>;
interface Call { name: string; input: Record<string, unknown>; result: string }

/** Llegadas: la vista del sitio la genera la primera visita (attachIllustrator); aquí solo se anota. */
const ARRIVALS = new Set(['arrived', 'character_joined', 'master_arrival', 'master_intro']);
/** Verbos de examinar un objeto (con get_item del máster). «Mirar alrededor» no pasa por get_item. */
const EXAMINE = /\b(examin|inspeccion|observ|estudi|revis|le[eo]\b|leer|mir[oa]r? (?:el|la|los|las|bien|de cerca)|ense[ñn])/i;

function ok(result: string): Record<string, unknown> | null {
  try {
    const r = JSON.parse(result) as Record<string, unknown>;
    return r && typeof r === 'object' && !('error' in r) ? r : null;
  } catch { return null; }
}

function str(v: unknown): string | null { return typeof v === 'string' && v ? v : null; }

/**
 * Momentos de un evento. Puro: el mismo evento con las mismas claves vistas da
 * el mismo resultado. No marca nada como visto (eso lo hace quien lo llama).
 */
export function classifyMoments(e: Draft, seen: ReadonlySet<string>, lookup: MomentLookup): Moment[] {
  const actor = e.actor_id;
  if (!actor) return [];
  const out: Moment[] = [];
  const add = (m: Omit<Moment, 'character_id'>) => {
    if (seen.has(m.key) || out.some((x) => x.key === m.key)) return;
    out.push({ ...m, character_id: actor });
  };
  const p = e.payload;
  const master = p['master'] as { calls?: Call[] } | null | undefined;
  const calls = Array.isArray(master?.calls) ? master!.calls : [];

  // Llegada a un sitio nuevo.
  if (ARRIVALS.has(e.action_type)) add({ kind: 'scene', key: `scene:${actor}:${e.location_id}`, entity_id: e.location_id });

  // Conversación: el NPC con quien habla (npc_id del cierre) o que habla en los parlamentos.
  const npcs: Id[] = [];
  const npcId = str(p['npc_id']);
  if (npcId) npcs.push(npcId);
  for (const l of (Array.isArray(p['lines']) ? p['lines'] : []) as DialogueLine[]) if (l?.speaker === 'npc' && l.npc_id) npcs.push(l.npc_id);
  for (const id of npcs) add({ kind: 'portrait', key: `portrait:${actor}:${id}`, entity_id: id });

  // Objetos: coger (atajo, parser o transfer_item hacia el actor), comprar, o examinar con get_item.
  const items: Id[] = [];
  if (e.action_type === 'take' || e.action_type === 'take_out') { const it = str(p['item_id']); if (it) items.push(it); }
  for (const c of calls) {
    if (c.name === 'transfer_item' && c.input['to_type'] === 'character' && c.input['to_id'] === actor && ok(c.result)) {
      const it = lookup.itemOfInstance(String(c.input['instance_id'] ?? ''));
      if (it) items.push(it);
    } else if (c.name === 'buy_item' && c.input['character_id'] === actor && ok(c.result)) {
      const it = str(c.input['item_id']);
      if (it) items.push(it);
    } else if (c.name === 'get_item' && EXAMINE.test(e.input_text ?? '')) {
      const r = ok(c.result);
      const it = r ? str(r['item_id']) : null;
      if (it) items.push(it);
    }
  }
  for (const id of items) if (lookup.itemIllustrable?.(id) ?? true) add({ kind: 'item', key: `item:${actor}:${id}`, entity_id: id });

  // Combate: alguien cae o muere (siempre), o el primer golpe que hiere a un rival concreto.
  // El rival es el otro: el objetivo, o quien golpea si el objetivo es el propio PJ; sin otro (daño sin atacante al PJ), nada.
  const blows: { attacker: Id | null; target: Id; damage: boolean; down: boolean }[] = [];
  const atk = p['attack'] as { target_id?: string; hit?: boolean; down?: boolean; dead?: boolean } | undefined;
  if (atk?.target_id) blows.push({ attacker: actor, target: atk.target_id, damage: atk.hit === true, down: atk.down === true || atk.dead === true });
  for (const c of calls) {
    const r = ok(c.result);
    if (!r) continue;
    if (c.name === 'attack') {
      const target = str(c.input['target_id']);
      if (target) blows.push({ attacker: str(c.input['attacker_id']), target, damage: r['hit'] === true && Number(r['damage'] ?? 1) > 0, down: r['target_down'] === true || r['target_dead'] === true });
    } else if (c.name === 'apply_damage') {
      const target = str(c.input['target_id']);
      if (target && Number(c.input['amount']) > 0) blows.push({ attacker: null, target, damage: true, down: r['status'] === 'dead' || r['status'] === 'unconscious' });
    }
  }
  for (const b of blows) {
    const rival = b.target !== actor ? b.target : b.attacker !== actor ? b.attacker : null;
    if (!rival) continue;
    if (b.down) add({ kind: 'combat', key: `combat:${e.id}`, entity_id: e.id, subject: rival });
    else if (b.damage && !seen.has(`combat:${actor}:${rival}`)) {
      add({ kind: 'combat', key: `combat:${actor}:${rival}`, entity_id: e.id, subject: rival });
    }
  }

  // Descubrimientos: punto oculto o pista. La pista que llega hablando con alguien se oye: queda el retrato de arriba.
  const talking = npcs.length > 0;
  for (const c of calls) {
    if (!ok(c.result)) continue;
    if (c.name === 'discover_spot' && c.input['character_id'] === actor) {
      const spot = str(c.input['spot_id']);
      if (spot) add({ kind: 'discovery', key: `discovery:${actor}:${spot}`, entity_id: e.id, subject: spot });
    } else if (c.name === 'grant_clue' && c.input['character_id'] === actor) {
      const clue = str(c.input['clue_id']);
      if (clue && (!talking || lookup.clue?.(clue)?.image)) add({ kind: 'discovery', key: `discovery:${actor}:${clue}`, entity_id: e.id, subject: clue });
    }
  }

  // combat y discovery del mismo evento comparten entity_id: el ilustrador hace una sola imagen (la del primero).
  return out;
}

/** Claves ya vistas en eventos pasados (al arrancar el motor). */
export function seenFromEvents(events: readonly GameEvent[]): Set<string> {
  const seen = new Set<string>();
  for (const e of events) {
    const ms = e.payload['moments'];
    if (Array.isArray(ms)) for (const m of ms as Moment[]) if (m && typeof m.key === 'string') seen.add(m.key);
  }
  return seen;
}

/**
 * Prosa del cierre sin los parlamentos que van aparte: quita cada texto de
 * `lines` que aparezca entre comillas («», “”, "") en la narración. Lo que no
 * esté literal se queda (mejor repetido que perdido).
 */
export function proseWithout(narration: string, lines: readonly DialogueLine[]): string {
  let out = narration;
  for (const l of lines) {
    const t = l.text.trim().replace(/^[«"“]|[»"”]$/g, '').trim();
    if (!t) continue;
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    out = out.replace(new RegExp(`\\s*(?:—\\s*)?[«"“]\\s*${esc}\\s*[»"”]`), '');
  }
  return out
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([,;]){2,}/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((s) => {
      // Lo que quedó tras quitar una frase del principio («Hola», dices → dices): sin la coma y en mayúscula.
      const t = s.replace(/^[\s,;:.]+/, '').trim();
      return t !== s.trim() ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    }).join('\n')
    .trim();
}
