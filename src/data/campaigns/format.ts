/**
 * Formato de campaña escrita: un mundo fijado de antemano (lugares, gente,
 * Biblia, leyes, agenda, rumores, situaciones iniciales e historia en actos)
 * que entra en el motor por el mismo camino que un mundo generado:
 *
 *   AuthoredCampaign (TypeScript tipado) → expandAuthored → WorldSnapshot
 *     → validateSnapshot (el mismo validador que generateSeed) → Engine.boot
 *
 * Reutiliza los tipos del motor tal cual (Spot, Npc, Clue, Job,
 * InitialSituation, ScheduledEvent, EncounterTable, Story…) y solo quita lo
 * que es estado de partida (descubrimientos, memoria, quién habla con quién)
 * o lo que el código sabe poner (la localización de cada punto, el reloj). Los
 * planos siguen saliendo de mapgen con las coordenadas, tags y alias de los
 * puntos: aquí no se dibuja nada.
 */

import type { Attitude, Campaign, Character, Id, ItemDef, Location, Npc, Region, ResourceNode, Spot, Vehicle, WorldSnapshot, Zone } from '../../engine/model.js';
import type { Hook } from '../../engine/hooks.js';
import type { Rumor } from '../../engine/rumors.js';
import type { NpcRoutine, ScheduledEvent } from '../../engine/schedule.js';
import type { Story } from '../../engine/story.js';
import type { EncounterTable } from '../../engine/travel.js';

/** Un punto tal como se escribe: la localización la pone la que lo contiene; lo demás tiene valor por defecto. */
export type AuthoredSpot = Pick<Spot, 'id' | 'name' | 'aliases' | 'description' | 'x' | 'y' | 'tags'>
  & Partial<Pick<Spot, 'capacity' | 'hidden' | 'dc_to_find' | 'state' | 'terrain_multiplier' | 'entry_cost_s' | 'links'>>
  & { /** Para el máster y el análisis: lo que esconde o lo que pasa aquí. No va al motor. */ secret?: string };

/** Una localización con sus puntos dentro; el primero es la entrada. */
export type AuthoredLocation = Omit<Location, 'default_spot_id' | 'state' | 'discovery'> & {
  state?: Record<string, unknown>;
  spots: AuthoredSpot[];
  /** Lo que esconde, para el máster y el análisis. No va al motor. */
  secret?: string;
};

/** Un NPC tal como se escribe: en un punto, con su actitud por defecto, su horario y lo que lleva encima. */
export type AuthoredNpc = Omit<Npc, 'location' | 'status' | 'memory' | 'talking_to' | 'attitude' | 'secret'> & {
  /**
   * Lo que esconde, si no va por niveles. Con `knowledge` (lo que cuenta según la confianza, trust.ts), sobra: el
   * secreto del motor es la unión de los niveles, para el análisis, y al máster solo le llega lo desbloqueado.
   */
  secret?: string;
  spot_id: Id;
  attitude: Attitude;
  routine?: NpcRoutine;
  /** Lo que sabe (para el análisis y el máster vía get_npc). No va al motor. */
  knows?: string;
  /** Con quién se lleva bien o mal, para el análisis. No va al motor. */
  ties?: string;
};

/** Un ejemplar en el mundo: en el suelo de un punto, en manos de un NPC o dentro de otro ejemplar. */
export interface AuthoredInstance {
  id: Id;
  item_id: Id;
  quantity: number;
  at: { spot: Id } | { npc: Id } | { container: Id };
  state?: Record<string, unknown>;
}

/** Rumor que ya corre cuando nace el mundo (rumors.ts). Dura `days` días de juego. */
export type AuthoredRumor = Pick<Rumor, 'id' | 'kind' | 'name' | 'hint' | 'where' | 'location_id'> & { days: number };

/** Gancho sembrado de antemano (hooks.ts). `time` en horas desde que nace el mundo; sin `expires_hours`, no caduca. */
export type AuthoredHook = Pick<Hook, 'id' | 'location_id' | 'what'> & {
  trigger: { kind: 'time'; after_hours: number } | { kind: 'spot'; spot_id: Id } | { kind: 'location' };
  expires_hours?: number;
};

export interface AuthoredCampaign {
  format: 1;
  id: Id;
  /** Hora del día (0-23) a la que nace el mundo: la de las situaciones iniciales. */
  start_hour: number;
  campaign: Omit<Campaign, 'id' | 'real_epoch_ms' | 'game_epoch_s' | 'board' | 'generation'> & {
    bible: string[];
    laws: string[];
    situations: NonNullable<Campaign['situations']>;
    schedule: ScheduledEvent[];
    encounters: EncounterTable;
    story: Story;
  };
  rumors: AuthoredRumor[];
  hooks: AuthoredHook[];
  regions: Region[];
  zones: Zone[];
  locations: AuthoredLocation[];
  exits: { id: Id; from: Id; to: Id; distance_m: number; terrain_multiplier?: number; state?: Record<string, unknown> }[];
  npcs: AuthoredNpc[];
  vehicles: Vehicle[];
  item_defs: ItemDef[];
  items: AuthoredInstance[];
  resource_nodes: ResourceNode[];
  /** PJ ya creados (ninguno en una campaña nueva). */
  characters?: Character[];
}

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

/** La campaña escrita como snapshot del motor. Puro: misma campaña y mismo `now`, mismo mundo. */
export function expandAuthored(a: AuthoredCampaign, now: Date): WorldSnapshot {
  const epoch = a.start_hour * HOUR_S;
  const c = structuredClone(a.campaign);
  const campaign = {
    ...c,
    id: a.id,
    real_epoch_ms: now.getTime(),
    game_epoch_s: epoch,
    board: { active_job_ids: [], last_rotation_day: -1 },
    // Rumores y ganchos con su instante de juego: nacen con el mundo.
    rumors: a.rumors.map(({ days, ...r }): Rumor => ({
      ...r, said_by: null, status: 'open', mentions: 1,
      origin: { actor_id: 'mundo', game_s: epoch, location_id: r.location_id, action: null },
      expires_game_s: epoch + days * DAY_S, thread: null,
    })),
    hooks: a.hooks.map(({ trigger, expires_hours, ...h }): Hook => ({
      ...h,
      trigger: trigger.kind === 'time' ? { kind: 'time', at_game_s: epoch + trigger.after_hours * HOUR_S } : trigger,
      for_character_id: null, created_game_s: epoch,
      expires_game_s: expires_hours !== undefined ? epoch + expires_hours * HOUR_S : trigger.kind === 'time' ? epoch + (trigger.after_hours + 1) * HOUR_S : null,
    })),
    story_state: { started_game_s: epoch, applied: [], escalated: [] },
  };

  const spots: Spot[] = a.locations.flatMap((l) => l.spots.map(({ secret: _s, ...s }): Spot => ({
    capacity: null, hidden: false, state: {}, terrain_multiplier: 1, entry_cost_s: 0, links: [],
    ...structuredClone(s), location_id: l.id, discovered_by: [],
  })));
  const locations: Location[] = a.locations.map(({ spots: ss, secret: _s, state, ...l }) => ({
    ...structuredClone(l), default_spot_id: ss[0]!.id, state: structuredClone(state ?? {}), discovery: {},
  }));
  const npcs: Npc[] = a.npcs.map(({ spot_id, attitude, routine, knows: _k, ties: _t, secret, ...n }) => ({
    ...structuredClone(n), secret: secret ?? (n.knowledge ?? []).map((k) => k.text).join(' '),
    location: { type: 'spot', id: spot_id }, status: 'alive', memory: [], talking_to: null,
    attitude: { default: attitude, by_character: {} },
    ...(routine ? { routine: { ...routine } } : {}),
  }));

  return {
    campaign: campaign as Campaign,
    regions: structuredClone(a.regions),
    zones: structuredClone(a.zones),
    locations,
    spots,
    exits: a.exits.map((e) => ({
      id: e.id, from_spot_id: e.from, to_spot_id: e.to, distance_m: e.distance_m, terrain_multiplier: e.terrain_multiplier ?? 1,
      bidirectional: true, state: structuredClone(e.state ?? {}),
    })),
    characters: structuredClone(a.characters ?? []),
    npcs,
    vehicles: structuredClone(a.vehicles),
    item_defs: structuredClone(a.item_defs),
    item_instances: a.items.map((i) => ({
      id: i.id, item_id: i.item_id, quantity: i.quantity, state: structuredClone(i.state ?? {}),
      location: 'spot' in i.at ? { type: 'spot', id: i.at.spot } : 'npc' in i.at ? { type: 'npc', id: i.at.npc } : { type: 'container', id: i.at.container },
    })),
    resource_nodes: structuredClone(a.resource_nodes),
  };
}
