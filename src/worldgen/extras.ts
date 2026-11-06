/**
 * Relleno de los mundos generados (docs/PLAN-NPC-RELLENO.md, fase 5): vecinos de paso con oficio, nombre, horario y
 * casa, sacados del tipo de asentamiento con la semilla del mundo, sin IA. Se añaden al montar el mundo
 * (index.ts, buildSnapshot), con un generador de números propio: el esqueleto y el relleno semántico no cambian, así que
 * una semilla de antes da el mismo mundo de antes, con vecinos.
 *
 * Agnóstico: qué oficios hay en cada asentamiento (`EXTRAS_BY_SETTLEMENT`), dónde trabajan (`WORKS_AT`), qué venden
 * (`SELLS`), cómo se llaman (`NAMES`, por género del mundo) y cómo son (`FLAVOR`). Lo demás sale de la plantilla del
 * oficio (src/engine/extras.ts).
 */

import { seededRng, type Rng } from '../engine/dice.js';
import { extraNpc, extraSpotAt, MAX_EXTRAS_PER_SPOT, slotForHour, TRADES, type ExtraDef, type TradeId } from '../engine/extras.js';
import type { Id, ItemDef, Npc, Spot, WorldSnapshot } from '../engine/model.js';
import type { Genre, PlaceKind, SettlementType } from './catalog.js';
import type { Skeleton } from './skeleton.js';

/** Oficios de relleno por tipo de asentamiento: [oficio, mínimo, máximo]. */
export const EXTRAS_BY_SETTLEMENT: Record<SettlementType, readonly (readonly [TradeId, number, number])[]> = {
  village: [['laborer', 2, 3], ['baker', 1, 1], ['child', 1, 2], ['devout', 0, 1], ['woodcutter', 0, 1], ['washer', 0, 1], ['regular', 0, 1]],
  fishing_port: [['fisher', 2, 3], ['washer', 1, 1], ['child', 1, 2], ['regular', 1, 1], ['peddler', 0, 1]],
  walled_city: [['watchman', 1, 2], ['peddler', 1, 2], ['baker', 1, 1], ['servant', 1, 1], ['child', 1, 1], ['regular', 0, 1], ['devout', 0, 1]],
  mining_camp: [['miner', 2, 3], ['regular', 1, 1], ['washer', 0, 1], ['child', 0, 1]],
  monastery: [['devout', 2, 2], ['laborer', 1, 1], ['servant', 1, 1], ['shepherd', 0, 1]],
  caravan: [['peddler', 1, 2], ['child', 1, 1], ['washer', 1, 1], ['regular', 0, 1]],
  border_fortress: [['watchman', 2, 2], ['servant', 1, 1], ['regular', 1, 1], ['washer', 0, 1]],
  crossroads_market: [['peddler', 2, 2], ['baker', 1, 1], ['child', 1, 1], ['regular', 1, 1], ['watchman', 0, 1]],
  abandoned_village: [['regular', 0, 1]],
  cave_settlement: [['miner', 1, 1], ['child', 1, 1], ['devout', 1, 1], ['laborer', 0, 1]],
  space_port: [['regular', 2, 2], ['peddler', 1, 1], ['watchman', 1, 1], ['servant', 1, 1], ['child', 0, 1]],
  mining_station: [['miner', 2, 3], ['regular', 1, 1], ['watchman', 1, 1]],
  shelter_settlement: [['laborer', 2, 2], ['child', 1, 1], ['watchman', 1, 1], ['peddler', 1, 1]],
  scrap_town: [['peddler', 2, 2], ['child', 1, 1], ['regular', 1, 1], ['watchman', 1, 1]],
};

/** Dónde trabaja cada oficio, por preferencia; sin ninguno de estos lugares, en el centro. */
const WORKS_AT: Partial<Record<TradeId, readonly PlaceKind[]>> = {
  baker: ['market', 'square', 'inn'],
  laborer: ['stable', 'animal_pen', 'square', 'garage', 'water_tower', 'cloister'],
  washer: ['dock', 'square', 'inn', 'wagon_circle'],
  woodcutter: ['square', 'smithy'],
  peddler: ['market', 'market_deck', 'scrap_market', 'merchant_wagon', 'square'],
  shepherd: ['animal_pen', 'stable', 'cloister'],
  servant: ['town_hall', 'inn', 'cloister', 'courtyard', 'spaceport'],
  regular: ['inn', 'cantina', 'shelter', 'cook_wagon', 'cave_hall'],
  fisher: ['dock', 'fish_market'],
  miner: ['mine_gallery', 'mine_shaft', 'mine_mouth'],
  devout: ['temple', 'cloister', 'cave_shrine', 'cemetery'],
  watchman: ['gate', 'barricade', 'watchtower', 'courtyard', 'security_office'],
  child: ['square', 'market', 'abandoned_street', 'wagon_circle', 'scrap_market'],
};

/** Por la tarde, donde se junta la gente: la taberna, la cantina o el centro. */
const LEISURE: readonly PlaceKind[] = ['inn', 'cantina', 'cook_wagon', 'shelter', 'cave_hall'];

/** Lo que vende cada oficio (ids del catálogo común); se queda con los que existan en el mundo. */
const SELLS: Partial<Record<TradeId, readonly Id[]>> = {
  baker: ['it_racion'], woodcutter: ['it_madera'], fisher: ['it_pescado'], peddler: ['it_antorcha', 'it_cuerda'],
};

/** Nombres por género del mundo y de persona. */
const NAMES: Record<Genre, { m: readonly string[]; f: readonly string[] }> = {
  fantasy: {
    m: ['Bartolo', 'Ceferino', 'Eusebio', 'Fabián', 'Genaro', 'Lázaro', 'Nicasio', 'Paulino', 'Saturio', 'Teodoro', 'Valentín', 'Zacarías'],
    f: ['Águeda', 'Benita', 'Casilda', 'Dorotea', 'Eulalia', 'Felisa', 'Gertrudis', 'Leocadia', 'Petra', 'Rufina', 'Sabina', 'Tomasa'],
  },
  scifi: {
    m: ['Tarek', 'Joss', 'Bram', 'Ezra', 'Nils', 'Pavel', 'Rook', 'Silas', 'Dorian', 'Ivo', 'Kenji', 'Matteo'],
    f: ['Ivy', 'Nova', 'Lyra', 'Mika', 'Sena', 'Tova', 'Wren', 'Yara', 'Anya', 'Celia', 'Dalia', 'Runa'],
  },
  postapoc: {
    m: ['Gus', 'Moe', 'Rufo', 'Zeke', 'Tobi', 'Hank', 'Lalo', 'Nacho', 'Pipo', 'Quino', 'Rocco', 'Sal'],
    f: ['Nina', 'Pecas', 'Dora', 'Mags', 'Tina', 'Chispa', 'Vera', 'Lola', 'Maru', 'Rita', 'Sole', 'Tula'],
  },
};

/** Cómo es y su historia breve, por oficio: frases que valen para cualquier género. */
const FLAVOR: Record<TradeId, { look: readonly string[]; story: readonly string[] }> = {
  watchman: { look: ['Mayor, con una luz en la mano y un silbato colgado del cuello.', 'Delgado, de pocas palabras, con un abrigo largo y gastado.'], story: ['Hace la ronda de noche desde hace años. Conoce cada puerta y quién entra tarde.'] },
  devout: { look: ['Menuda, vestida de oscuro, con las manos juntas.', 'Callado, con una cuenta de rezo entre los dedos.'], story: ['No falta nunca al rezo y sabe la hora de todo lo que se celebra.'] },
  baker: { look: ['Manos enharinadas y un mandil con quemaduras del horno.'], story: ['Hornea para medio lugar y sabe quién paga y quién no.'] },
  laborer: { look: ['Manos agrietadas y barro hasta las rodillas.', 'Ancho de espaldas, con la cara quemada por el sol.'], story: ['Trabaja de sol a sol y no tiene tiempo para charlas.'] },
  washer: { look: ['Brazos rojos de agua fría y un cesto de ropa a la cadera.'], story: ['Lava para quien pague y se entera de todo por la ropa.'] },
  woodcutter: { look: ['Hombros anchos, astillas en la barba y un hacha de mano.'], story: ['Corta leña en las afueras y la vende a quien la necesite.'] },
  peddler: { look: ['Un fardo a la espalda lleno de cacharros.', 'Sonrisa de vendedor y los bolsillos llenos de baratijas.'], story: ['Va de un sitio a otro vendiendo lo que le queda.'] },
  shepherd: { look: ['Joven, con olor a ganado y una honda al cuello.'], story: ['Saca el ganado cada mañana y habla más con los animales que con la gente.'] },
  child: { look: ['Rodillas peladas y los bolsillos llenos de cosas.', 'Pequeño, rápido, con la cara sucia.'], story: ['Corre detrás de los forasteros y repite lo que oye en casa.'] },
  servant: { look: ['Delantal limpio y la mirada en el suelo.'], story: ['Sirve en la casa importante del lugar y no habla de lo que pasa dentro.'] },
  regular: { look: ['Nariz roja y un vaso siempre a mano.', 'Viejo, pegado a su sitio de siempre.'], story: ['Bebe a cuenta de lo que sea y cuenta lo mismo a quien le invite.'] },
  fisher: { look: ['Manos curtidas por las redes y olor a sal.'], story: ['Sale de madrugada y vende lo que trae antes de mediodía.'] },
  miner: { look: ['Polvo en la cara y una tos seca.', 'Encorvado, con los nudillos pelados.'], story: ['Baja cada turno y sube contando los días que le quedan.'] },
};

/** Las casas del relleno, por género del mundo: [nombre, alias]. */
const DWELLING: Record<Genre, [string, string[]]> = {
  fantasy: ['las casas', ['casas', 'viviendas', 'casas de los vecinos']],
  scifi: ['los camarotes', ['camarotes', 'cabinas', 'viviendas']],
  postapoc: ['las chabolas', ['chabolas', 'refugios', 'casuchas']],
};
const KEY_NAME: Record<Genre, [string, string[]]> = {
  fantasy: ['llave de las casas', ['llave de casa', 'llave de las casas']],
  scifi: ['tarjeta de los camarotes', ['tarjeta de camarote', 'tarjeta de los camarotes']],
  postapoc: ['llave de las chabolas', ['llave de chabola', 'llave de las chabolas']],
};
export const GEN_KEY_ITEM_ID = 'it_llave_casas';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wordsOf = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <V>(rng: Rng, xs: readonly V[]): V => xs[Math.floor(rng() * xs.length)]!;

/**
 * Los vecinos de relleno de un mundo generado, con su casa y su llave, dentro del snapshot. Determinista por la
 * semilla del esqueleto. Un oficio que no cabe (su nombre choca con un sitio, o no queda punto libre) se salta.
 */
export function addExtras(snap: WorldSnapshot, sk: Skeleton): void {
  const conf = EXTRAS_BY_SETTLEMENT[sk.settlement.type];
  if (!conf?.length) return;
  const rng = seededRng((sk.seed ^ 0x6e7a5c) >>> 0);
  const genre = sk.genre;
  const town = sk.locations.filter((l) => l.zone_id === 'zn_town');
  const hub = town[0];
  if (!hub) return;
  const principals = snap.npcs.filter((n) => n.attitude.default !== 'hostile');

  // Cuántos: lo que pida el asentamiento, con tope (vez y media los principales, 16 como mucho).
  const wanted: TradeId[] = conf.flatMap(([t, lo, hi]) => Array.from({ length: int(rng, lo, hi) }, () => t));
  const cap = Math.min(16, Math.ceil(principals.length * 1.5));
  const trades = wanted.slice(0, cap);
  if (!trades.length) return;

  // Las casas, en el centro, cerradas con llave.
  const hubSpots = snap.spots.filter((s) => s.location_id === hub.id);
  const xs = hubSpots.map((s) => s.x), ys = hubSpots.map((s) => s.y);
  const [dName, dAliases] = DWELLING[genre];
  const homeId = `sp_${hub.kind}_casas`;
  const home: Spot = {
    id: homeId, location_id: hub.id, name: dName, aliases: dAliases, description: 'Unas viviendas con las puertas cerradas, donde duerme la gente del lugar.',
    x: Math.round((Math.min(...xs) - 4) * 10) / 10, y: Math.round((Math.max(...ys) + 2) * 10) / 10, capacity: null, hidden: false,
    discovered_by: [], state: { locked: true, key_item_id: GEN_KEY_ITEM_ID }, tags: ['building', 'dwelling'], terrain_multiplier: 1, entry_cost_s: 0, links: [],
  };
  const [kName, kAliases] = KEY_NAME[genre];
  const keyDef: ItemDef = { id: GEN_KEY_ITEM_ID, name: kName, aliases: kAliases, type: 'tool', size: 'tiny', weight_lb: 0.1, value: 1, unique: false, origin: 'custom' };

  // Palabras de sitios (un oficio que las lleva no se lee como persona) y nombres ya usados.
  const placeWords = new Set([...snap.locations.map((l) => l.name), ...snap.spots.flatMap((s) => [s.name, ...s.aliases]), dName, ...dAliases].flatMap(wordsOf));
  const usedNames = new Set(snap.npcs.map((n) => norm(n.name.split(' ')[0]!)));
  const names = { m: [...NAMES[genre].m].sort(() => rng() - 0.5), f: [...NAMES[genre].f].sort(() => rng() - 0.5) };

  // Puntos donde se puede estar: visibles, sin salida, sin cerradura, y con sitio (tope por punto y franja).
  const load = new Map<string, number>();
  const usable = (s: Spot) => !s.hidden && s.state['locked'] !== true && !s.tags.includes('dwelling')
    && !snap.exits.some((e) => e.from_spot_id === s.id || e.to_spot_id === s.id);
  const spotIn = (kinds: readonly PlaceKind[], slot: string): Spot | null => {
    const locs = kinds.map((k) => town.find((l) => l.kind === k)).filter((l): l is NonNullable<typeof l> => Boolean(l));
    for (const l of [...locs, hub]) {
      const options = snap.spots.filter((s) => s.location_id === l.id && usable(s) && (load.get(`${slot}:${s.id}`) ?? 0) < MAX_EXTRAS_PER_SPOT);
      if (!options.length) continue;
      const s = pick(rng, options);
      load.set(`${slot}:${s.id}`, (load.get(`${slot}:${s.id}`) ?? 0) + 1);
      return s;
    }
    return null;
  };

  const refer = principals.slice().sort((a, b) => a.id.localeCompare(b.id));
  const hour = Math.floor((snap.campaign.game_epoch_s / 3600) % 24);
  const slot = slotForHour(hour, snap.campaign.calendar);
  const added: Npc[] = [];
  for (const trade of trades) {
    const gender: 'f' | 'm' = rng() < 0.5 ? 'f' : 'm';
    const label = (TRADES[trade].label[genre] ?? TRADES[trade].label.fantasy)[gender];
    if (wordsOf(label).some((w) => placeWords.has(w))) continue;
    const pool = names[gender];
    const name = pool.find((x) => !usedNames.has(norm(x)));
    if (!name) continue;
    usedNames.add(norm(name));
    const work = spotIn(WORKS_AT[trade] ?? [], 'day');
    const leisure = spotIn(trade === 'watchman' ? WORKS_AT.watchman! : LEISURE, trade === 'watchman' ? 'night' : 'afternoon');
    if (!work || !leisure) continue;
    // El sereno trabaja de noche y duerme de día; los demás, al revés.
    const routine = trade === 'watchman' ? { day: homeId, afternoon: work.id, night: leisure.id } : { day: work.id, afternoon: leisure.id, night: homeId };
    const f = FLAVOR[trade];
    const sells = (SELLS[trade] ?? []).map((id) => snap.item_defs.find((d) => d.id === id)).filter((d): d is ItemDef => Boolean(d))
      .map((d) => ({ item_id: d.id, price: Math.max(1, d.value) }));
    const id = `npc_x_${norm(name).replace(/[^a-z0-9]+/g, '')}`;
    const def: ExtraDef = {
      id, name, trade, gender, look: pick(rng, f.look), story: pick(rng, f.story), routine, home_spot_id: homeId,
      ...(sells.length ? { sells } : {}),
      ...(refer.length ? { refer_to: [refer[Math.floor(rng() * refer.length)]!.id] } : {}),
      ...(trade === 'child' ? { wander: [work.id, ...hubSpots.filter(usable).slice(0, 2).map((s) => s.id)].filter((x, i, a) => a.indexOf(x) === i) } : {}),
    };
    const npc = extraNpc(def, genre, extraSpotAt(def, slot));
    added.push(npc);
    for (const s of sells) snap.item_instances.push({ id: `ii_${id}_${s.item_id}`, item_id: s.item_id, quantity: 3, location: { type: 'npc', id }, state: {} });
  }
  if (!added.length) return;
  snap.spots.push(home);
  snap.item_defs.push(keyDef);
  // La llave de las casas, a la primera persona que vive allí (robarla abre la puerta).
  const keeper = added.find((n) => n.home_spot_id === homeId);
  if (keeper) snap.item_instances.push({ id: `ii_${keeper.id}_llave`, item_id: GEN_KEY_ITEM_ID, quantity: 1, location: { type: 'npc', id: keeper.id }, state: {} });
  snap.npcs.push(...added);
}
