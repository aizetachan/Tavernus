/**
 * Sonido del juego: de cada evento del motor a una secuencia corta de claves
 * («pasos-madera», «puerta-abrir», «puerta-cerrar», «ambiente-plaza»). Las
 * claves se resuelven en el navegador contra el catálogo de sfx.ts (receta
 * procedural o pista grabada de public/sfx; la generación por IA está apagada).
 *
 * Dos piezas:
 *   - `cuesFor(input)`: función pura y determinista; es la que se prueba.
 *   - `soundInputOf(engine, event)`: lee del mundo lo que la pura necesita
 *     (suelo, interior o exterior, ambiente, si se cruza una puerta).
 *
 * Nada está escrito para un mundo concreto: suelo y ambiente salen de los datos
 * de la localización (indoor, ambience.noise, tipo de zona, nombre, descripción,
 * etiquetas de los puntos) y de la hora. Lo que no merece sonido (mirar, hablar,
 * esperar) devuelve [].
 */

import type { Engine } from '../../engine/engine.js';
import type { GameEvent, Id, Location, Spot } from '../../engine/model.js';
import type { World } from '../../engine/world.js';
import { lightAt } from '../../engine/perception.js';

export type Floor = 'madera' | 'piedra' | 'tierra' | 'hierba' | 'agua';

/** Ambientes en bucle del catálogo (clave sin el prefijo «ambiente-»). */
export type Ambience = 'taberna' | 'herreria' | 'interior' | 'plaza' | 'plaza-noche' | 'bosque' | 'bosque-noche' | 'agua' | 'lluvia';

export const EFFECT_KEYS = [
  'pasos-madera', 'pasos-piedra', 'pasos-tierra', 'pasos-hierba', 'pasos-agua',
  'puerta-abrir', 'puerta-cerrar', 'moneda', 'objeto-coger', 'objeto-soltar', 'dado',
  'espada-golpe', 'espada-fallo', 'dano', 'curar', 'hacha', 'descubrir', 'campana',
] as const;
export const AMBIENCE_KEYS = ['taberna', 'herreria', 'interior', 'plaza', 'plaza-noche', 'bosque', 'bosque-noche', 'agua', 'lluvia'].map((a) => `ambiente-${a}`);
export const SOUND_KEYS: readonly string[] = [...EFFECT_KEYS, ...AMBIENCE_KEYS];

/** Lo que el sonido necesita saber de un sitio. */
export interface Place {
  location_id: Id;
  indoor: boolean;
  /** Suelo del punto donde está el PJ. */
  floor: Floor;
  ambience: Ambience;
}

export interface SoundInput {
  /** action_type del evento. */
  type: string;
  /** Dónde ocurre el evento. */
  here: Place;
  /** Si el movimiento cruza a otra localización: adónde y si hay puerta. */
  crossing?: { to: Place; door: boolean } | null;
  /** Tools que llamó el máster en este evento (move_to, attack, roll_check…). */
  calls?: string[];
  /** Tirada del servidor (evento roll). */
  roll?: { success: boolean | null } | null;
  /** Ataque resuelto en la tirada. */
  attack?: { hit: boolean; down: boolean } | null;
  /** El objeto cogido, soltado o dado es dinero. */
  coins?: boolean;
}

const MOVES = new Set(['move']);
const ARRIVALS = new Set(['arrived', 'master_arrival']);
const SCENE_START = new Set(['character_joined', 'master_intro']);

/** Secuencia de claves para un evento. Determinista: mismo evento, mismos sonidos. */
export function cuesFor(i: SoundInput): string[] {
  const out: string[] = [];
  const steps = (f: Floor) => `pasos-${f}`;
  const amb = (p: Place) => `ambiente-${p.ambience}`;
  const calls = new Set(i.calls ?? []);
  const t = i.type;

  // Moverse: pasos sobre el suelo de aquí; si se cruza a otra localización, la puerta y el nuevo ambiente.
  // Los pasos del otro lado los pone la llegada.
  if (MOVES.has(t) || calls.has('move_to')) {
    out.push(steps(i.here.floor));
    if (i.crossing) {
      if (i.crossing.door) out.push('puerta-abrir', 'puerta-cerrar');
      out.push(amb(i.crossing.to));
    }
  }
  // Llegar: unos pasos y el ambiente del sitio (si ya sonaba, el cliente no lo reinicia).
  if (ARRIVALS.has(t)) out.push(steps(i.here.floor), amb(i.here));
  if (SCENE_START.has(t)) out.push(amb(i.here));

  if (t === 'take' || t === 'take_out') out.push(i.coins ? 'moneda' : 'objeto-coger');
  if (t === 'drop' || t === 'put') out.push(i.coins ? 'moneda' : 'objeto-soltar');
  if (t === 'give') out.push(i.coins ? 'moneda' : 'objeto-coger');
  if (t === 'harvest' || calls.has('harvest')) out.push('hacha');
  if (calls.has('buy_item') || calls.has('sell_item') || calls.has('complete_job')) out.push('moneda');
  else if (calls.has('transfer_item') && !out.some((k) => k === 'moneda' || k.startsWith('objeto-'))) out.push('objeto-coger');

  // Dados: la tirada del jugador y las que hace el máster por su cuenta.
  if (t === 'roll') {
    out.push('dado');
    if (i.attack) out.push(i.attack.hit ? 'espada-golpe' : 'espada-fallo');
    if (i.attack?.down) out.push('dano');
  } else if (calls.has('roll_check') || calls.has('roll_dice')) out.push('dado');
  if (calls.has('attack')) out.push('espada-golpe');
  if (calls.has('apply_damage') && !out.includes('dano')) out.push('dano');
  if (calls.has('heal')) out.push('curar');
  if (calls.has('discover_spot') || calls.has('grant_clue')) out.push('descubrir');
  if (t === 'announcement') out.push('campana');
  return out;
}

// ---------------------------------------------------------------------------
// Del mundo a la entrada de la función pura
// ---------------------------------------------------------------------------

const has = (re: RegExp, ...texts: (string | undefined)[]) => texts.some((s) => !!s && re.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()));

/** Suelo del punto: agua por etiqueta; si no, por las palabras de la localización y el punto; si no, interior madera y exterior tierra (o piedra en poblado). */
export function floorOf(world: World, spot: Spot): Floor {
  const loc = world.location(spot.location_id);
  const zone = world.zones.get(loc.zone_id);
  if (spot.tags.includes('water')) return 'agua';
  const words = [loc.name, loc.description_base, spot.name, spot.description, typeof loc.state['floor'] === 'string' ? loc.state['floor'] as string : ''];
  if (typeof loc.state['floor'] === 'string') {
    const f = loc.state['floor'] as string;
    if (['madera', 'piedra', 'tierra', 'hierba', 'agua'].includes(f)) return f as Floor;
  }
  if (loc.indoor) return has(/\b(losas?|marmol|cripta|templo|santuario|cueva|mazmorra|baldosa)/, ...words) ? 'piedra' : 'madera';
  if (has(/\b(empedrad|adoquin|losas?|enlosad|calzada)/, ...words)) return 'piedra';
  if (has(/\b(hierba|prado|pradera|cesped|pastizal)/, ...words)) return 'hierba';
  if (zone?.kind === 'town' || has(/\b(plaza|calle|aldea|pueblo|villa|ciudad)\b/, loc.name)) return 'piedra';
  return 'tierra';
}

/** Ambiente en bucle de una localización a esta hora. */
export function ambienceOf(world: World, engine: Pick<Engine, 'clock'>, loc: Location, nowGameS: number): Ambience {
  const weather = [loc.state['weather'], (world.campaign as { weather?: unknown }).weather].filter((x): x is string => typeof x === 'string');
  if (!loc.indoor && has(/\b(lluvia|llueve|tormenta|chubasco|rain|storm)/, ...weather)) return 'lluvia';
  // Un taller de forja suena a fragua y martillo, dentro o fuera (va antes del ruido: una herrería es ruidosa, no una taberna).
  if (has(/\b(herreria|herrero|forja|fragua|yunque|smithy|blacksmith|forge)\b/, loc.name, loc.id.replace(/_/g, ' '))) return 'herreria';
  if (loc.indoor) {
    const lively = loc.ambience.noise >= 0.25 || has(/\b(taberna|posada|meson|cantina|inn)\b/, loc.name, loc.id);
    return lively ? 'taberna' : 'interior';
  }
  const night = ['night_moon', 'night_dark'].includes(lightAt(engine.clock, loc, nowGameS));
  if (has(/\b(rio|arroyo|orilla|lago|cascada|river)\b/, loc.name, loc.id.replace(/_/g, ' '))) return 'agua';
  const zone = world.zones.get(loc.zone_id);
  const town = zone?.kind === 'town' || has(/\b(plaza|calle|mercado|aldea|pueblo|square|gate|porton|puerto)\b/, loc.name, loc.id.replace(/_/g, ' '));
  return town ? (night ? 'plaza-noche' : 'plaza') : (night ? 'bosque-noche' : 'bosque');
}

export function placeOf(world: World, engine: Pick<Engine, 'clock'>, spotId: Id, nowGameS: number): Place {
  const spot = world.spot(spotId);
  const loc = world.location(spot.location_id);
  return { location_id: loc.id, indoor: loc.indoor, floor: floorOf(world, spot), ambience: ambienceOf(world, engine, loc, nowGameS) };
}

const DOOR_WORDS = /\b(puerta|porton|trampilla|verja|portal|cancela|door|gate|trapdoor)\b/;

/** ¿Pasar de este punto a ese otro suena a puerta? Si hay interior a un lado, o el punto lo dice. */
export function isDoor(world: World, fromSpotId: Id, toSpotId: Id): boolean {
  const a = world.spot(fromSpotId), b = world.spot(toSpotId);
  if (world.location(a.location_id).indoor !== world.location(b.location_id).indoor) return true;
  if (world.location(a.location_id).indoor && world.location(b.location_id).indoor) return true;
  return [a, b].some((s) => s.tags.some((t) => ['door', 'gate', 'trapdoor'].includes(t)) || has(DOOR_WORDS, s.name));
}

/**
 * Entrada de `cuesFor` para el actor de un evento, leída del mundo en el
 * momento de la entrega (el viaje recién trazado sigue en `transit`).
 */
export function soundInputOf(engine: Engine, e: GameEvent): SoundInput | null {
  const w = engine.world;
  const c = e.actor_id ? w.characters.get(e.actor_id) : undefined;
  const spotId = e.spot_id ?? (c ? w.characterSpot(c)?.id : undefined) ?? w.location(e.location_id).default_spot_id;
  if (!w.spots.has(spotId)) return null;
  const now = e.timestamp_game_s;
  const here = placeOf(w, engine, spotId, now);
  const master = e.payload['master'] as { calls?: { name: string }[] } | null | undefined;
  const calls = Array.isArray(master?.calls) ? master!.calls.map((x) => x.name) : [];
  const input: SoundInput = { type: e.action_type, here, calls };

  // El primer tramo del viaje que cambia de localización: ahí está la puerta y el ambiente nuevo.
  if (c?.transit && (e.action_type === 'move' || calls.includes('move_to'))) {
    const leg = c.transit.legs.find((l) => w.spot(l.to_spot_id).location_id !== w.spot(l.from_spot_id).location_id);
    if (leg) input.crossing = { to: placeOf(w, engine, leg.to_spot_id, now), door: isDoor(w, leg.from_spot_id, leg.to_spot_id) };
  }
  const roll = e.payload['roll'] as { success?: boolean | null } | undefined;
  if (roll) input.roll = { success: roll.success ?? null };
  const attack = e.payload['attack'] as { hit: boolean; down: boolean } | undefined;
  if (attack) input.attack = { hit: attack.hit, down: attack.down };
  const item = e.payload['item_id'];
  if (typeof item === 'string') input.coins = has(/\b(moneda|monedas|oro|plata|cobre|bolsa de dinero|coins?)\b/, w.itemDefs.get(item)?.name, item.replace(/_/g, ' '));
  return input;
}

/** Claves de sonido del evento para su actor; [] si no merece sonido. */
export function soundCuesOf(engine: Engine, e: GameEvent): string[] {
  try {
    const input = soundInputOf(engine, e);
    return input ? cuesFor(input) : [];
  } catch {
    return []; // el sonido nunca rompe una entrega
  }
}

/** Ambiente actual de un PJ (para quien abre la página sin historial). */
export function currentAmbience(engine: Engine, characterId: Id): string | null {
  const c = engine.world.characters.get(characterId);
  const spot = c ? engine.world.characterSpot(c) : null;
  if (!spot) return null;
  return `ambiente-${placeOf(engine.world, engine, spot.id, engine.gameNow()).ambience}`;
}
