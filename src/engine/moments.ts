/**
 * Momentos ilustrables. Decide, sin IA y a partir del evento ya registrado, si
 * lo que acaba de pasar merece una imagen y de qué clase:
 *
 *   - portrait:  primera conversación de un PJ con un NPC concreto (su retrato).
 *   - item:      el PJ coge o examina un objeto (el objeto en la mano).
 *   - scene:     llegada a un sitio que el PJ no había pisado (la vista; la genera la primera visita).
 *   - combat:    desenlace de un combate: alguien cae o muere, o el primer golpe que hiere a un rival.
 *   - discovery: un punto oculto descubierto o una pista concedida.
 *
 * Mirar alrededor, moverse dentro del lugar, esperar o seguir hablando con quien
 * ya tiene retrato no generan nada. Cada momento tiene una clave y no se repite:
 * el motor guarda las claves vistas y las recupera de `payload.moments` de los
 * eventos pasados al arrancar.
 */

import type { GameEvent, Id } from './model.js';

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
  /** combat y discovery: qué ha pasado, para el prompt (el NPC caído, el punto, la pista). */
  subject?: Id;
}

/** Un parlamento literal del cierre del máster (modo novela). */
export interface DialogueLine {
  speaker: 'npc' | 'actor';
  npc_id?: Id;
  text: string;
}

/** Lo que el clasificador necesita del mundo: de qué tipo es un ejemplar. */
export interface MomentLookup {
  itemOfInstance(instanceId: Id): Id | null;
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
  for (const id of items) add({ kind: 'item', key: `item:${actor}:${id}`, entity_id: id });

  // Combate: alguien cae o muere (siempre), o el primer golpe que hiere a un rival concreto.
  const blows: { target: Id; damage: boolean; down: boolean }[] = [];
  const atk = p['attack'] as { target_id?: string; hit?: boolean; down?: boolean; dead?: boolean } | undefined;
  if (atk?.target_id) blows.push({ target: atk.target_id, damage: atk.hit === true, down: atk.down === true || atk.dead === true });
  for (const c of calls) {
    const r = ok(c.result);
    if (!r) continue;
    if (c.name === 'attack') {
      const target = str(c.input['target_id']);
      if (target) blows.push({ target, damage: r['hit'] === true && Number(r['damage'] ?? 1) > 0, down: r['target_down'] === true || r['target_dead'] === true });
    } else if (c.name === 'apply_damage') {
      const target = str(c.input['target_id']);
      if (target && Number(c.input['amount']) > 0) blows.push({ target, damage: true, down: r['status'] === 'dead' || r['status'] === 'unconscious' });
    }
  }
  for (const b of blows) {
    if (b.down) add({ kind: 'combat', key: `combat:${e.id}`, entity_id: e.id, subject: b.target });
    else if (b.damage && !seen.has(`combat:${actor}:${b.target}`)) {
      add({ kind: 'combat', key: `combat:${actor}:${b.target}`, entity_id: e.id, subject: b.target });
    }
  }

  // Descubrimientos: punto oculto o pista.
  for (const c of calls) {
    if (!ok(c.result)) continue;
    if (c.name === 'discover_spot' && c.input['character_id'] === actor) {
      const spot = str(c.input['spot_id']);
      if (spot) add({ kind: 'discovery', key: `discovery:${actor}:${spot}`, entity_id: e.id, subject: spot });
    } else if (c.name === 'grant_clue' && c.input['character_id'] === actor) {
      const clue = str(c.input['clue_id']);
      if (clue) add({ kind: 'discovery', key: `discovery:${actor}:${clue}`, entity_id: e.id, subject: clue });
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
