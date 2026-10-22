/**
 * Generador de campaña: sustituye a la semilla fija (src/data/seed/demo.ts).
 *
 *   esqueleto (skeleton.ts, código + semilla) → relleno (fill.ts, una llamada
 *   a la API o plantilla offline) → validación → WorldSnapshot
 *
 * `generateSeed` devuelve lo mismo que `makeSeed()`, así que Engine.boot lo
 * acepta tal cual. La Biblia, las leyes, la semilla y la procedencia viajan
 * en la campaña (campos opcionales de model.ts); las situaciones iniciales,
 * en una bolsa de la campaña de la que `claimSituation` saca la de cada PJ.
 */

import type { Attitude, Character, GenerationInfo, Id, InitialSituation, ItemDef, Spot, WorldSnapshot } from '../engine/model.js';
import type { World } from '../engine/world.js';
import { DEFAULT_MASTER, makeSeed } from '../data/seed/demo.js';
import { buildSkeleton, type Skeleton, type Tone } from './skeleton.js';
import { lockedRoomState, ROOM_NIGHT_ITEM_ID, ROOM_NIGHT_PRICE, roomSeller } from './rooms.js';
import { CATALOG, DEFAULT_WORLDGEN_MODEL, fillWorld, GENRE_DEFAULT, liveFillClient, type FillClient, type PcBrief, type WorldFill } from './fill.js';

export { buildSkeleton, TONES, type Skeleton, type Tone } from './skeleton.js';
export { FillError, offlineFill, validateFill, type FillClient, type PcBrief, type WorldFill } from './fill.js';

export const REWARD_ITEM_ID = 'it_reward';
const DAY_S = 24 * 3600;

/** Orígenes de los puntos de inicio genéricos, para quien llegue sin situación propia. */
const ORIGINS: ((town: string, spot: string) => string)[] = [
  (t, s) => `Llega a ${t} con el polvo del camino encima y la última moneda del último trabajo. Lo primero que pisa es ${s}.`,
  (t, s) => `Es de ${t}, o casi: se crió aquí y se fue joven. Vuelve tras años fuera y, junto a ${s}, todo le parece más pequeño y más callado de lo que recordaba.`,
  (t, s) => `Ha pasado la noche al raso y entra en ${t} por ${s} con hambre, frío y la sensación de que alguien le sigue.`,
];

/** Hora de la primera situación con dueño (o de la primera de reserva). */
function startHour(f: WorldFill): number {
  const s = f.situations.find((x) => x.for_name.trim()) ?? f.situations[0];
  return s ? s.start_hour : 8;
}

const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'y', 'en', 'con', 'que', 'por', 'hacia', 'camino', 'puerta']);
/** Alias de un nombre: el nombre sin artículo y sus palabras con peso ("Posada de la Linterna" → posada, linterna). */
function words(name: string): string[] {
  const bare = name.trim().replace(/^(el|la|los|las|un|una)\s+/i, '').toLowerCase();
  const ws = bare.split(/[^a-záéíóúüñ]+/i).filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set([bare, ...ws])];
}

export interface GenerateOptions {
  seed: number;
  tone: Tone;
  setting: string;
  /** Modelo del relleno; si no, WORLDGEN_MODEL o claude-sonnet-5-5 (no MASTER_MODEL: un modelo pequeño da mundos más pobres). */
  model?: string;
  /** PJ que ya se sabe que van a jugar: cada uno sale con su situación inicial. */
  characters?: PcBrief[];
  /** Cliente del relleno. `null` = offline. Sin dar: offline si MASTER_MODE=offline o no hay clave; si no, la API. */
  client?: FillClient | null;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
  now?: () => Date;
}

/** Mundo nuevo, listo para Engine.boot({ seed }). */
export async function generateSeed(opts: GenerateOptions): Promise<WorldSnapshot> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const sk = buildSkeleton({ seed: opts.seed, tone: opts.tone, setting: opts.setting });
  const pcs = opts.characters ?? [];
  let client = opts.client;
  if (client === undefined) {
    const offline = env['MASTER_MODE']?.trim().toLowerCase() === 'offline';
    const key = Boolean(env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_AUTH_TOKEN']);
    if (!offline && !key) log('[worldgen] sin clave de API: relleno offline');
    client = offline || !key ? null : liveFillClient();
  }
  const model = opts.model ?? (env['WORLDGEN_MODEL']?.trim() || DEFAULT_WORLDGEN_MODEL);
  const r = await fillWorld(sk, pcs, { client, model, log });
  log(`[worldgen] mundo ${sk.campaign_id} (semilla ${sk.seed}): «${r.fill.campaign_name}» con ${r.model}${r.attempts ? `, ${r.usage.input} in / ${r.usage.output} out, ${r.cost_usd} $` : ''}`);
  return buildSnapshot(sk, r.fill, {
    seed: sk.seed, tone: sk.tone, setting: sk.setting, model: r.model, generated_at: (opts.now?.() ?? new Date()).toISOString(),
    attempts: r.attempts, usage: r.usage, cost_usd: r.cost_usd, skeleton_version: sk.version, settlement: sk.settlement.label, genre: sk.genre,
  });
}

/** Esqueleto + relleno validado → snapshot del mundo. Puro. */
export function buildSnapshot(sk: Skeleton, f: WorldFill, generation: GenerationInfo): WorldSnapshot {
  const base = makeSeed();
  const fl = new Map(f.locations.map((l) => [l.id, l]));
  const fs = new Map(f.locations.flatMap((l) => l.spots).map((s) => [s.id, s]));
  const fn = new Map(f.npcs.map((n) => [n.id, n]));
  const wild = sk.locations.find((l) => l.zone_id === 'zn_wild');
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const town = f.town_name.trim();

  const spots: Spot[] = sk.locations.flatMap((l) => l.spots.map((s): Spot => {
    const fill = fs.get(s.id)!;
    return {
      id: s.id, location_id: l.id, name: fill.name, aliases: uniq([...s.aliases, ...words(fill.name)]), description: fill.description,
      x: s.x, y: s.y, capacity: s.capacity ?? null, hidden: s.hidden, ...(s.dc_to_find !== undefined ? { dc_to_find: s.dc_to_find } : {}),
      discovered_by: [], state: s.locked ? lockedRoomState() : {}, tags: [...s.tags], terrain_multiplier: s.terrain_multiplier ?? 1, entry_cost_s: s.entry_cost_s ?? 0,
      // La habitación (de alquiler o del logro): arriba, sin vista ni apenas sonido del resto de la posada.
      links: s.id === sk.reward_spot_id || s.locked ? l.spots.filter((o) => o.id !== s.id && !o.hidden).map((o) => ({ to_spot_id: o.id, blocks_sight: true, muffles: 0.8 })) : [],
    };
  }));
  const spotName = (id: Id) => spots.find((s) => s.id === id)!;

  const reward: ItemDef = {
    id: REWARD_ITEM_ID, name: f.achievement.reward_item_name, aliases: words(f.achievement.reward_item_name), type: 'quest', size: 'tiny',
    weight_lb: 0.1, value: 0, unique: true, origin: 'custom',
  };
  const welcome = f.welcome.includes('{name}') ? f.welcome : `${f.welcome}\n\n{name}.`;
  const announcement = f.achievement.announcement.includes('{name}') ? f.achievement.announcement : `{name}: ${f.achievement.announcement}`;

  const snap: WorldSnapshot = {
    campaign: {
      ...base.campaign,
      id: sk.campaign_id, name: f.campaign_name,
      // El mundo nace al generarse, a la hora a la que empieza la primera situación (la del PJ que lo pidió).
      real_epoch_ms: Date.parse(generation.generated_at), game_epoch_s: startHour(f) * 3600,
      starting_points: sk.start_spot_ids.map((id, i) => ({ spot_id: id, origin: ORIGINS[i % ORIGINS.length]!(town, spots.find((s) => s.id === id)!.name) })),
      premise: f.premise, setting: sk.setting || GENRE_DEFAULT[sk.genre], tone: sk.tone, content_rating: 2, language: 'es', house_rules: '',
      welcome, master: structuredClone(DEFAULT_MASTER),
      factions: [{ id: sk.faction_id, name: f.faction.name, description: f.faction.description }],
      clues: f.clues.map((c, i) => ({
        id: `clue_${i + 1}`, title: c.title, how: c.how, reputation: 2,
        ...(c.location_ids.length ? { location_ids: [...c.location_ids] } : {}), ...(c.npc_ids.length ? { npc_ids: [...c.npc_ids] } : {}),
      })),
      jobs: sk.jobs.map((j) => {
        const fj = f.jobs.find((x) => x.id === j.id)!;
        return {
          id: j.id, title: fj.title, text: fj.text, giver_npc_id: fj.giver_npc_id, kind: j.kind,
          ...(j.deliver ? { deliver: { ...j.deliver } } : {}), ...(j.visit_spot_id ? { visit_spot_id: j.visit_spot_id } : {}),
          reward_coins: j.reward_coins, reward_reputation: j.reward_reputation,
        };
      }),
      achievement: {
        id: 'ach_main', title: f.achievement.title, faction_id: sk.faction_id, clues_required: Math.min(3, sk.clue_count), reputation_required: 5,
        reward_item_id: REWARD_ITEM_ID, reward_spot_id: sk.reward_spot_id, announcement,
      },
      board: { active_job_ids: [], last_rotation_day: -1 },
      bible: [...f.bible], laws: [...f.laws], generation,
      situations: f.situations.map(({ for_name, ...s }) => ({ for_name: for_name.trim(), situation: { ...s, paths: [...s.paths] } })),
    },
    regions: [{ id: sk.region_id, name: `la comarca de ${town}` }],
    zones: sk.zones.map((z) => ({
      id: z.id, region_id: sk.region_id, name: z.kind === 'town' ? town : `los alrededores de ${town}`,
      kind: z.kind === 'town' ? 'town' : wild?.kind === 'forest' ? 'forest' : 'wild',
    })),
    locations: sk.locations.map((l) => {
      const fill = fl.get(l.id)!;
      return {
        id: l.id, zone_id: l.zone_id, name: fill.name, description_base: fill.description, default_spot_id: l.default_spot_id, indoor: l.indoor,
        ambience: { light: l.light, noise: l.noise, ...(l.kind === 'inn' ? { smell: 'humo y comida' } : {}) }, state: {}, discovery: {},
      };
    }),
    spots,
    exits: sk.exits.map((e) => ({ id: e.id, from_spot_id: e.from_spot_id, to_spot_id: e.to_spot_id, distance_m: e.distance_m, terrain_multiplier: e.terrain_multiplier, bidirectional: true, state: {} })),
    characters: [],
    npcs: sk.npcs.map((n) => {
      const fill = fn.get(n.id)!;
      return {
        id: n.id, name: fill.name, role: n.role_label, location: { type: 'spot' as const, id: n.spot_id }, status: 'alive' as const,
        passive_perception: n.passive_perception, description: fill.description, motivation: fill.motivation, secret: fill.secret,
        memory: [], talking_to: null,
        buys: f.trade.filter((t) => t.npc_id === n.id && t.buys_or_sells === 'buys').map((t) => ({ item_id: t.item_id, price: t.price })),
        sells: f.trade.filter((t) => t.npc_id === n.id && t.buys_or_sells === 'sells').map((t) => ({ item_id: t.item_id, price: t.price })),
        stats: { ...n.stats },
        attitude: { default: n.hostile ? 'hostile' as const : fill.attitude as Attitude, by_character: {} },
      };
    }),
    vehicles: [],
    item_defs: [...structuredClone(CATALOG as ItemDef[]), reward],
    item_instances: sk.items.map((i) => ({
      id: i.id, item_id: i.item_id, quantity: i.quantity,
      location: { type: 'spot' as const, id: i.spot_id }, state: {},
    })),
    resource_nodes: sk.resources.map((r) => {
      const s = spotName(r.spot_id);
      return {
        id: r.id, spot_id: r.spot_id, name: s.name, aliases: [...s.aliases], resource_item_id: r.item_id, yield_max: r.yield_max,
        regen_time_s: DAY_S, last_harvested_game_s: null, regen_state_at_harvest: 1, destructive: r.destructive, skill: r.skill, dc: r.dc, tool_required: r.tool_required,
      };
    }),
  };
  // Cuartos de alquiler: los vende quien atiende ese lugar; sin nadie que los venda, quedan abiertos.
  for (const room of snap.spots.filter((s) => s.state['locked'] === true)) {
    const seller = roomSeller(snap.npcs, snap.spots, room.location_id);
    if (!seller) { room.state = {}; continue; }
    if (!seller.sells.some((x) => x.item_id === ROOM_NIGHT_ITEM_ID)) seller.sells.push({ item_id: ROOM_NIGHT_ITEM_ID, price: ROOM_NIGHT_PRICE });
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Situación inicial de cada PJ
// ---------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Da al PJ su situación inicial: la que se generó con su nombre o una de
 * reserva (o, si no queda ninguna, una de plantilla). Lo coloca en su punto
 * de inicio, pone en marcha el reloj, le hace conocer a su antagonista y le
 * escribe la historia, que el máster ya lee en el contexto del actor. No hace
 * nada en mundos sin situaciones (la demo). Devuelve la situación o null.
 */
export function claimSituation(world: World, characterId: Id, nowGameS: number, hook?: string): InitialSituation | null {
  const camp = world.campaign;
  if (!camp.situations) return null;
  const c = world.characters.get(characterId);
  if (!c) return null;
  const pool = camp.situations;
  let i = pool.findIndex((s) => s.for_name && norm(s.for_name) === norm(c.name));
  if (i < 0) i = pool.findIndex((s) => !s.for_name);
  const picked = i >= 0 ? pool.splice(i, 1)[0]!.situation : templateSituation(world, c);
  const situation: InitialSituation = { ...picked, deadline_game_s: nowGameS + picked.clock_days * DAY_S };
  world.touch('campaign', camp.id);

  c.situation = situation;
  if (world.spots.has(situation.start_spot_id)) c.location = { type: 'spot', id: situation.start_spot_id };
  if (world.npcs.has(situation.antagonist_npc_id) && !c.knows.includes(situation.antagonist_npc_id)) c.knows.push(situation.antagonist_npc_id);
  c.backstory = [hook?.trim(), situationText(world, situation)].filter(Boolean).join('\n');
  world.touch('characters', c.id);

  // Conoce el pueblo de oídas; donde empieza, de vista.
  const start = world.spots.get(c.location.id);
  for (const l of world.locations.values()) {
    const town = world.zones.get(l.zone_id)?.kind === 'town';
    const before = l.discovery[c.id];
    const now = start && l.id === start.location_id ? 'visited' : town ? (before ?? 'heard_of') : before;
    if (now && now !== before) { l.discovery[c.id] = now; world.touch('locations', l.id); }
  }
  return situation;
}

/** La situación en prosa, para la historia del PJ y el contexto del máster. */
export function situationText(world: World, s: InitialSituation): string {
  const ant = world.npcs.get(s.antagonist_npc_id);
  const day = s.deadline_game_s !== undefined ? ` (vence el día ${Math.floor(s.deadline_game_s / DAY_S)} de juego)` : '';
  const spot = world.spots.get(s.start_spot_id);
  const where = spot ? `${spot.name} (${world.locations.get(spot.location_id)?.name ?? ''})` : '';
  return [
    where ? `Empieza en: ${where}${s.start_hour !== undefined ? `, a las ${String(s.start_hour).padStart(2, '0')}:00` : ''}.` : '',
    `Por qué está aquí: ${s.why_here}`,
    `Quiere: ${s.wants}`,
    `Le amenaza: ${s.threat}`,
    `Plazo: ${s.clock_days} días${day}; si vence, ${lowerFirst(s.clock_runs_out)}`,
    ant ? `Antagonista cercano: ${ant.name} (${ant.role}).` : '',
    `Caminos: ${s.paths.map((p, i) => `${i + 1}) ${p}`).join(' ')}`,
    `Primer instante: ${s.opening}`,
  ].filter(Boolean).join('\n');
}

function lowerFirst(s: string): string { return s.charAt(0).toLowerCase() + s.slice(1); }

/** Sin situaciones en la bolsa: una de plantilla con lo que hay en el mundo. */
function templateSituation(world: World, c: Character): InitialSituation {
  const people = [...world.npcs.values()].filter((n) => n.stats?.attack_name !== 'mordisco' && n.attitude.default !== 'hostile' && n.status === 'alive');
  const h = [...c.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const ant = people[h % Math.max(1, people.length)];
  const town = [...world.locations.values()].filter((l) => world.zones.get(l.zone_id)?.kind === 'town');
  const spot = [...world.spots.values()].find((s) => !s.hidden && town.some((l) => l.id === s.location_id) && !world.campaign.starting_points.some((p) => p.spot_id === s.id));
  const who = ant?.name ?? 'alguien del pueblo';
  return {
    why_here: `Te han citado aquí con la promesa de un trabajo bien pagado, y quien te citó no aparece.`,
    wants: 'Cobrar lo prometido y saber quién te ha hecho venir.',
    threat: `${who} sabe más de lo que dice y no quiere que hagas preguntas.`,
    clock_days: 3, clock_runs_out: 'El trabajo se lo lleva otro y tu nombre queda ligado a lo que pase.',
    antagonist_npc_id: ant?.id ?? '', start_spot_id: spot?.id ?? world.campaign.starting_points[0]!.spot_id,
    paths: [`Preguntar a ${who} sin rodeos.`, 'Buscar en el tablón y entre la gente quién más espera ese trabajo.', 'Esperar escondido a ver quién viene a buscarte.'],
    opening: 'Una nota sin firma, metida en tu bolsillo sin que lo notaras, dice solo: «Ahora no. Esta noche».',
  };
}
