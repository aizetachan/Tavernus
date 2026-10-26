import { describe, expect, it } from 'vitest';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { GAME_HOUR } from '../src/clock/clock.js';
import { boardState, clipMap, handleBoardRequest, mapFor } from '../src/adapters/web/board.js';
import { mapCacheOf } from '../src/adapters/web/mapcache.js';
import { ownerSpot, revealTrackerOf } from '../src/adapters/web/reveal.js';
import { generateMap, hash, mapInputOf, mapSeedOf, placeTypeOf, type MapGenInput, type MapGenSpot, type PlaceType } from '../src/adapters/web/mapgen.js';
import type { LocationMap, MapPoint, MapProp } from '../src/data/seed/maps.js';
import type { Spot } from '../src/engine/model.js';
import type { World } from '../src/engine/world.js';
import type { Engine } from '../src/engine/engine.js';
import { moveTo, positionOf } from '../src/engine/movement.js';
import { perceive } from '../src/engine/perception.js';
import { bootEngine, freshWorld } from './helpers.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { World as WorldClass } from '../src/engine/world.js';
import { ensureWaypoint } from '../src/engine/travel.js';
import { ambienceOf } from '../src/adapters/web/soundmap.js';

/** El PJ ya ha pasado por todos los puntos: el revelado (reveal.ts) deja ver todos los muebles. */
function knowAll(engine: Engine, characterId: string): void {
  const t = revealTrackerOf(engine);
  for (const s of engine.world.spots.values()) t.mark(characterId, s.id);
}

describe('tablero web', () => {
  it('localización, actor y puntos visibles; los ocultos no aparecen hasta descubrirlos', async () => {
    const { engine } = await bootEngine();
    const b = boardState(engine, 'ch_kael');
    expect(b.location).toMatchObject({ id: 'loc_taberna', name: 'Taberna del Jabalí', light: 'twilight' });
    expect(b.actor).toMatchObject({ id: 'ch_kael', spot_id: 'sp_tab_barra', x: 6, y: 2, transit: null });
    const ids = b.spots.map((s) => s.id).sort();
    expect(ids).toEqual(['sp_tab_barra', 'sp_tab_chimenea', 'sp_tab_mesa', 'sp_tab_puerta']);
    expect(b.spots.find((s) => s.id === 'sp_tab_mesa')).toMatchObject({ name: 'la mesa del fondo', x: 10, y: 6 });
    expect(b.spots.find((s) => s.id === 'sp_tab_mesa')!.items.length).toBeGreaterThan(0);

    engine.world.spot('sp_tab_trampilla').discovered_by.push('ch_kael');
    expect(boardState(engine, 'ch_kael').spots.map((s) => s.id)).toContain('sp_tab_trampilla');
    // Descubierto por Kael, no por Mira.
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_mesa' };
    expect(boardState(engine, 'ch_mira').spots.map((s) => s.id)).not.toContain('sp_tab_trampilla');
  });

  it('nadie aparece en un punto oculto que el actor no ha descubierto', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_trampilla' };
    const b = boardState(engine, 'ch_kael');
    expect(b.presences.map((p) => p.id)).not.toContain('ch_mira');
    expect(b.presences.some((p) => p.spot_id === 'sp_tab_trampilla')).toBe(false);
  });

  it('recursos del punto en su lista', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_sendero' };
    const b = boardState(engine, 'ch_kael');
    expect(b.spots.find((s) => s.id === 'sp_cl_roble')!.nodes).toEqual(['el roble viejo, intacto']);
    expect(b.spots.find((s) => s.id === 'sp_cl_sendero')!.items).toContain('hacha de leñador');
  });

  it('presentes: nombre si lo conoce, descriptor si no; figura o movimiento según la percepción', async () => {
    const { engine, time } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    // Brenna en la barra, junto a Kael: la ve con detalle.
    let b = boardState(engine, 'ch_kael');
    expect(b.presences.find((p) => p.id === 'npc_brenna')).toMatchObject({ kind: 'npc', spot_id: 'sp_tab_barra', level: 'full', label: 'Brenna' });
    kael.knows = [];
    b = boardState(engine, 'ch_kael');
    expect(b.presences.find((p) => p.id === 'npc_brenna')!.label).toBe('la tabernera');

    // En la plaza, de día: Mira y Doro al otro lado (36 m) se ven vagos.
    kael.location = { type: 'spot', id: 'sp_pl_taberna' };
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_pl_porton' };
    b = boardState(engine, 'ch_kael');
    const mira = b.presences.find((p) => p.id === 'ch_mira')!;
    const doro = b.presences.find((p) => p.id === 'npc_doro')!;
    expect(mira).toMatchObject({ kind: 'character', level: 'vague', label: 'figura', spot_id: 'sp_pl_porton' });
    expect(doro).toMatchObject({ level: 'vague', label: 'figura' });
    // Coincide con lo que dice el motor.
    const nowG = engine.gameNow();
    const at = positionOf(engine.world, engine.world.character('ch_mira'), nowG);
    expect(mira.level).toBe(perceive(engine.world, engine.clock, kael, at, nowG).level);

    // De noche solo se intuye movimiento.
    time.advanceGame(15 * GAME_HOUR);
    b = boardState(engine, 'ch_kael');
    expect(b.location.light).not.toBe('day');
    expect(b.presences.find((p) => p.id === 'ch_mira')).toMatchObject({ level: 'hint', label: 'movimiento' });
    // Y quien no percibe nada no aparece: el lobo está en otra localización.
    expect(b.presences.map((p) => p.id)).not.toContain('npc_lobo');
  });

  it('salidas: desde qué punto, a qué localización y punto, distancia y bloqueo', async () => {
    const { engine } = await bootEngine();
    expect(boardState(engine, 'ch_kael').exits).toEqual([{
      id: 'ex_tab_plaza', from_spot_id: 'sp_tab_puerta',
      to_location_id: 'loc_plaza', to_location_name: 'Plaza del Pozo',
      to_spot_id: 'sp_pl_taberna', to_spot_name: 'la puerta de la taberna',
      distance_m: 3, blocked: false, blocked_by: null,
    }]);

    // Desde la plaza: la bidireccional de vuelta a la taberna y el camino al claro.
    const b = boardState(engine, 'ch_mira');
    expect(b.exits.map((e) => [e.from_spot_id, e.to_location_id, e.to_spot_id, e.distance_m]).sort()).toEqual([
      ['sp_pl_porton', 'loc_claro', 'sp_cl_sendero', 600],
      ['sp_pl_taberna', 'loc_taberna', 'sp_tab_puerta', 3],
    ]);

    engine.world.exit('ex_plaza_claro').state.locked = true;
    expect(boardState(engine, 'ch_mira').exits.find((e) => e.id === 'ex_plaza_claro')).toMatchObject({ blocked: true, blocked_by: 'cerrada con llave' });
    engine.world.exit('ex_plaza_claro').state = { blocked_by: 'un árbol caído' };
    expect(boardState(engine, 'ch_mira').exits.find((e) => e.id === 'ex_plaza_claro')).toMatchObject({ blocked: true, blocked_by: 'un árbol caído' });
  });

  it('en tránsito: posición interpolada, siguiente punto y destino', async () => {
    const { engine, time } = await bootEngine();
    const r = moveTo(engine.world, 'ch_kael', 'sp_tab_mesa', 'walk', engine.gameNow());
    expect(r.ok).toBe(true);
    time.advanceGame(Math.hypot(4, 4) / 1.5 / 2); // mitad del tramo
    const b = boardState(engine, 'ch_kael');
    expect(b.actor.transit).toMatchObject({ to_spot_id: 'sp_tab_mesa', destination_spot_id: 'sp_tab_mesa', destination_name: 'la mesa del fondo' });
    expect(b.actor.transit!.progress).toBeCloseTo(0.5, 2);
    expect(b.actor.x).toBeCloseTo(8, 2);
    expect(b.actor.y).toBeCloseTo(4, 2);
  });

  it('lo que envía el tablero al hacer clic mueve al PJ con el parser plano', async () => {
    const { engine } = await bootEngine();
    const r1 = await engine.act('ch_kael', 'Ir a la mesa del fondo');
    expect(r1.ok).toBe(true);
    expect(engine.world.character('ch_kael').transit?.destination_spot_id).toBe('sp_tab_mesa');
    const r2 = await engine.act('ch_kael', 'Salir hacia Plaza del Pozo');
    expect(r2.ok).toBe(true);
    expect(engine.world.character('ch_kael').location.id).toBe('sp_pl_taberna'); // viaje rápido: ya ha llegado
  });

  it('plano de la taberna: paredes y muebles; el cuarto y la trampilla ocultos no se delatan', async () => {
    const { engine } = await bootEngine();
    knowAll(engine, 'ch_kael');
    let m = boardState(engine, 'ch_kael').map;
    expect(m.cell_m).toBe(1.5);
    expect(m.background).toBe('void');
    expect(m.walls.length).toBeGreaterThan(0);
    expect(m.doors).toHaveLength(1);
    const kinds = () => m.props.map((p) => p.kind);
    expect(kinds()).toEqual(expect.arrayContaining(['counter', 'fireplace', 'table']));
    expect(kinds()).not.toContain('trapdoor');
    expect(kinds()).not.toContain('stairs');
    expect(kinds()).not.toContain('bed');
    expect(JSON.stringify(m)).not.toContain('requires_spot');
    // Sin el cuarto, el plano es el mismo que si no existiera: no reserva hueco al norte de la sala.
    const visible = engine.world.spotsOf('loc_taberna').filter((s) => !s.hidden);
    expect(m.bounds).toEqual(clipMap(generateMap({ ...mapInputOf(engine.world, 'loc_taberna'), spots: visible }), visible).bounds);

    engine.world.spot('sp_tab_trampilla').discovered_by.push('ch_kael');
    engine.world.spot('sp_tab_habitacion').discovered_by.push('ch_kael');
    m = boardState(engine, 'ch_kael').map;
    expect(kinds()).toEqual(expect.arrayContaining(['trapdoor', 'bed']));
    // La puerta del cuarto de arriba, pegado a la sala.
    expect(m.doors).toHaveLength(2);
    expect(m.bounds.y + m.bounds.h).toBeGreaterThanOrEqual(12 + 1.2);
  });

  it('cada punto de la demo cae dentro de su plano, con cualquier semilla', async () => {
    const { engine } = await bootEngine();
    for (const loc of engine.world.locations.values()) for (const seed of [0, 1, 7, 12345]) {
      const m = mapFor(loc, engine.world.spotsOf(loc.id), seed);
      for (const s of engine.world.spotsOf(loc.id)) {
        expect(s.x, s.id).toBeGreaterThanOrEqual(m.bounds.x);
        expect(s.x, s.id).toBeLessThanOrEqual(m.bounds.x + m.bounds.w);
        expect(s.y, s.id).toBeGreaterThanOrEqual(m.bounds.y);
        expect(s.y, s.id).toBeLessThanOrEqual(m.bounds.y + m.bounds.h);
      }
    }
  });

  it('los muebles enlazados apuntan a un punto de su misma localización', async () => {
    const { engine } = await bootEngine();
    knowAll(engine, 'ch_kael');
    for (const locId of engine.world.locations.keys()) {
      const m = mapCacheOf(engine).get(locId).map;
      for (const p of m.props.filter((x) => x.spot_id)) {
        expect(engine.world.spot(p.spot_id!).location_id, `${p.kind} → ${p.spot_id}`).toBe(locId);
      }
    }
    const props = boardState(engine, 'ch_kael').map.props;
    expect(props.find((p) => p.kind === 'fireplace')!.spot_id).toBe('sp_tab_chimenea');
    expect(props.filter((p) => p.spot_id === 'sp_tab_barra').length).toBeGreaterThan(0);
  });

  it('no hay planos a mano: cada localización recibe uno generado de sus puntos visibles', async () => {
    const { engine } = await bootEngine();
    const taberna = engine.world.location('loc_taberna');
    const visible = engine.world.spotsOf('loc_taberna').filter((s) => !s.hidden);
    const m = mapFor(taberna, visible);
    expect(m.background).toBe('void');
    expect(m.walls.length).toBeGreaterThanOrEqual(1);
    expect(['wood', 'stone']).toContain(m.areas[0]!.ground);
    for (const s of visible) {
      expect(s.x).toBeGreaterThan(m.bounds.x);
      expect(s.y).toBeLessThan(m.bounds.y + m.bounds.h);
    }
    // La habitación oculta (y = 12) no estira el plano.
    expect(m.bounds.y + m.bounds.h).toBeLessThan(12);
    const claro = mapFor(engine.world.location('loc_claro'), engine.world.spotsOf('loc_claro'));
    expect(claro).toMatchObject({ background: 'grass', walls: [] });
  });

  it('GET /api/board responde el JSON o 404', async () => {
    const { engine } = await bootEngine();
    const fake = () => {
      const out = { status: 0, body: '' };
      const res = { writeHead: (s: number) => { out.status = s; return res; }, end: (b: string) => { out.body = b; } };
      return { out, res: res as unknown as ServerResponse };
    };
    const req = {} as IncomingMessage;
    const ok = fake();
    handleBoardRequest(engine, req, ok.res, new URL('http://localhost/api/board?character=ch_kael'));
    expect(ok.out.status).toBe(200);
    expect(JSON.parse(ok.out.body).location.id).toBe('loc_taberna');
    const missing = fake();
    handleBoardRequest(engine, req, missing.res, new URL('http://localhost/api/board?character=nadie'));
    expect(missing.out.status).toBe(404);
  });
});

// --- Planos generados, caché y precarga --------------------------------------

type NewSpot = { id: string; name: string; x: number; y: number; aliases?: string[]; tags?: string[]; hidden?: boolean };

function newSpot(locId: string, s: NewSpot): Spot {
  return {
    id: s.id, location_id: locId, name: s.name, aliases: s.aliases ?? [], description: s.name, x: s.x, y: s.y,
    capacity: null, hidden: s.hidden ?? false, discovered_by: [], state: {}, tags: s.tags ?? [],
    terrain_multiplier: 1, entry_cost_s: 0, links: [],
  };
}

/** Añade una localización al mundo como lo haría el máster: documento y aviso de cambio. */
function addLocation(world: World, loc: { id: string; name: string; indoor: boolean; zone_id: string }, spots: NewSpot[]): void {
  world.locations.set(loc.id, {
    ...loc, description_base: loc.name, default_spot_id: spots[0]!.id,
    ambience: { light: loc.indoor ? 'twilight' : 'natural', noise: 0.2 }, state: {}, discovery: {},
  });
  world.touch('locations', loc.id);
  for (const s of spots) addSpot(world, loc.id, s);
}
function addSpot(world: World, locId: string, s: NewSpot): void {
  world.spots.set(s.id, newSpot(locId, s));
  world.touch('spots', s.id);
}
function addExit(world: World, id: string, from: string, to: string, distance_m = 5): void {
  world.exits.set(id, { id, from_spot_id: from, to_spot_id: to, distance_m, terrain_multiplier: 1, bidirectional: true, state: {} });
  world.touch('exits', id);
}

/** Posada (interior) con barra, chimenea, mesa, jergón y puerta a la plaza; vado (exterior, bosque) tras la posada. */
function addPosadaYVado(world: World): void {
  addLocation(world, { id: 'loc_posada', name: 'Posada del Cuervo', indoor: true, zone_id: 'zn_brezal' }, [
    { id: 'sp_po_puerta', name: 'la puerta', aliases: ['entrada'], x: 0, y: 0 },
    { id: 'sp_po_barra', name: 'la barra', aliases: ['mostrador'], x: 5, y: 3 },
    { id: 'sp_po_chimenea', name: 'la chimenea', aliases: ['hogar'], x: 1, y: 7 },
    { id: 'sp_po_mesa', name: 'una mesa', x: 9, y: 5 },
    { id: 'sp_po_cama', name: 'el jergón', x: 9, y: 9 },
  ]);
  addExit(world, 'ex_po_plaza', 'sp_po_puerta', 'sp_pl_pozo', 4);
  addLocation(world, { id: 'loc_vado', name: 'Vado del Arroyo', indoor: false, zone_id: 'zn_fresnos' }, [
    { id: 'sp_va_sendero', name: 'el sendero', tags: ['road'], x: 0, y: 0 },
    { id: 'sp_va_pozo', name: 'el pozo viejo', x: 8, y: 6 },
    { id: 'sp_va_tablon', name: 'el tablón', x: 4, y: 10 },
    { id: 'sp_va_roble', name: 'el roble viejo', aliases: ['árbol'], x: 14, y: 12 },
    { id: 'sp_va_piedra', name: 'una roca', x: 2, y: 14 },
    { id: 'sp_va_arroyo', name: 'el arroyo', aliases: ['agua'], x: 22, y: 6 },
  ]);
  addExit(world, 'ex_po_vado', 'sp_po_cama', 'sp_va_sendero', 300);
}

function expectInside(m: LocationMap, spots: { id: string; x: number; y: number }[], margin = 1): void {
  for (const s of spots) {
    expect(s.x - margin, s.id).toBeGreaterThanOrEqual(m.bounds.x - 1e-9);
    expect(s.x + margin, s.id).toBeLessThanOrEqual(m.bounds.x + m.bounds.w + 1e-9);
    expect(s.y - margin, s.id).toBeGreaterThanOrEqual(m.bounds.y - 1e-9);
    expect(s.y + margin, s.id).toBeLessThanOrEqual(m.bounds.y + m.bounds.h + 1e-9);
  }
}

/** ¿Tiene el mueble un lado sobre algún tramo del contorno? */
function againstWall(p: { x: number; y: number; w?: number; h?: number }, wall: MapPoint[]): boolean {
  const x1 = p.x + p.w!, y1 = p.y + p.h!;
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-6;
  return wall.some((a, i) => {
    const b = wall[(i + 1) % wall.length]!;
    if (near(a[1], b[1])) return (near(p.y, a[1]) || near(y1, a[1])) && p.x >= Math.min(a[0], b[0]) - 1e-6 && x1 <= Math.max(a[0], b[0]) + 1e-6;
    if (near(a[0], b[0])) return (near(p.x, a[0]) || near(x1, a[0])) && p.y >= Math.min(a[1], b[1]) - 1e-6 && y1 <= Math.max(a[1], b[1]) + 1e-6;
    return false;
  });
}

function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe('planos generados', () => {
  it('una localización nueva de interior recibe paredes, puertas y muebles según sus puntos', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    knowAll(engine, 'ch_kael');
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_po_puerta' };
    const b = boardState(engine, 'ch_kael');
    const m = b.map;
    expect(b.location.id).toBe('loc_posada');
    expect(m).toMatchObject({ cell_m: 1.5, background: 'void' });
    expect(['wood', 'stone']).toContain(m.areas[0]!.ground);
    expect(m.walls.length).toBeGreaterThanOrEqual(1);
    const linked = (kind: string) => m.props.filter((p) => p.kind === kind && p.spot_id).map((p) => p.spot_id);
    expect(linked('counter')).toEqual(['sp_po_barra']);
    expect(linked('fireplace')).toEqual(['sp_po_chimenea']);
    expect(linked('table')).toEqual(['sp_po_mesa']);
    expect(linked('chair')).toEqual(['sp_po_mesa', 'sp_po_mesa']);
    expect(linked('bed')).toEqual(['sp_po_cama']);
    expect(m.props.find((p) => p.kind === 'counter')!.label).toBe('la barra');
    // La puerta de la entrada (salida a la plaza) y la del jergón (salida al vado), cada una en su pared más cercana.
    expect(m.doors).toHaveLength(2);
    const doorNear = (sx: number, sy: number) => m.doors.some((d) => Math.hypot((d.from[0] + d.to[0]) / 2 - sx, (d.from[1] + d.to[1]) / 2 - sy) < 2.5);
    expect(doorNear(0, 0)).toBe(true);
    expect(doorNear(9, 9)).toBe(true);
    // La chimenea, contra una pared; los muebles, dentro de la sala y sin tapar su punto.
    const wall = m.walls[0]!.points;
    const x0 = Math.min(...wall.map((p) => p[0])), y0 = Math.min(...wall.map((p) => p[1]));
    const x1 = Math.max(...wall.map((p) => p[0])), y1 = Math.max(...wall.map((p) => p[1]));
    const fire = m.props.find((p) => p.kind === 'fireplace')!;
    expect(againstWall(fire, wall)).toBe(true);
    // Hay luz de velas (twilight): la chimenea está encendida.
    expect(fire.lit).toBe(true);
    for (const p of m.props) {
      expect(p.x).toBeGreaterThanOrEqual(x0);
      expect(p.x + (p.w ?? 0)).toBeLessThanOrEqual(x1);
      expect(p.y).toBeGreaterThanOrEqual(y0);
      expect(p.y + (p.h ?? 0)).toBeLessThanOrEqual(y1);
    }
    for (const p of m.props.filter((x) => x.w !== undefined && x.spot_id)) {
      const s = engine.world.spot(p.spot_id!);
      expect(s.x >= p.x && s.x <= p.x + p.w! && s.y >= p.y && s.y <= p.y + p.h!, `${p.kind} tapa ${s.id}`).toBe(false);
    }
    expectInside(m, b.spots);
  });

  it('una localización nueva de exterior: pozo, tablón, roble, roca, arroyo, sendero y bosque alrededor', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    knowAll(engine, 'ch_kael');
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_va_sendero' };
    const m = boardState(engine, 'ch_kael').map;
    expect(m.background).toBe('grass');
    expect(m.walls).toEqual([]);
    const byKind = (k: string) => m.props.filter((p) => p.kind === k);
    expect(byKind('well')[0]).toMatchObject({ spot_id: 'sp_va_pozo', label: 'el pozo viejo' });
    expect(byKind('notice')[0]!.spot_id).toBe('sp_va_tablon');
    expect(byKind('rock')[0]!.spot_id).toBe('sp_va_piedra');
    expect(byKind('tree').find((t) => t.spot_id === 'sp_va_roble')!.r).toBeGreaterThan(2);
    // Árboles sin enlazar por el borde: es una zona de bosque.
    expect(byKind('tree').filter((t) => !t.spot_id).length).toBeGreaterThan(3);
    const water = m.areas.find((a) => a.ground === 'water' && a.path)!;
    const dirt = m.areas.find((a) => a.ground === 'dirt' && a.path)!;
    expect(water.path!.length).toBeGreaterThan(2);
    expect(dirt.path!.some(([x, y]) => x === 0 && y === 0)).toBe(true);
    // El arroyo pasa junto a su punto, sin taparlo.
    const gap = Math.min(...water.path!.map((p) => Math.abs(p[0] - 22)));
    expect(gap).toBeGreaterThan(0.5);
    expect(gap).toBeLessThan(4);
    expectInside(m, engine.world.spotsOf('loc_vado'));
  });

  it('determinista: mismos datos, mismo plano, sea cual sea el orden de los puntos', async () => {
    const { engine } = await bootEngine();
    const { engine: other } = await bootEngine();
    addPosadaYVado(engine.world);
    addPosadaYVado(other.world);
    for (const loc of ['loc_posada', 'loc_vado']) {
      const input = mapInputOf(engine.world, loc);
      const a = generateMap(input);
      const b = generateMap({ ...input, spots: [...input.spots].reverse(), exits: [...input.exits!].reverse() });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(generateMap(mapInputOf(other.world, loc))).toEqual(a);
    }
  });

  it('tarda milisegundos: 200 localizaciones sintéticas', () => {
    const names = ['la barra', 'la chimenea', 'una mesa', 'el jergón', 'el pozo', 'el tablón', 'un roble', 'la roca', 'el arroyo',
      'el sendero', 'un cofre', 'unos barriles', 'la puerta', 'la escalera', 'un rincón', 'la alfombra', 'el estante', 'la casa'];
    const inputs: MapGenInput[] = [];
    for (let i = 0; i < 200; i++) {
      const spots: MapGenSpot[] = [];
      for (let j = 0; j < 12; j++) {
        spots.push({ id: `sp_${i}_${j}`, name: names[(i * 7 + j * 5) % names.length]!, aliases: [], tags: [], x: (j * 37 + i * 11) % 30, y: (j * 23 + i * 13) % 24, hidden: j === 11 });
      }
      inputs.push({
        location: { id: `loc_${i}`, name: `Sitio ${i}`, indoor: i % 2 === 0 },
        zone: { name: 'Zona', kind: i % 3 ? 'forest' : 'town' },
        spots,
        exits: [{ id: `ex_${i}`, from_spot_id: `sp_${i}_0`, to_location_id: `loc_${i + 1}`, to_location_name: `Sitio ${i + 1}` }],
      });
    }
    const t0 = performance.now();
    const maps = inputs.map(generateMap);
    const ms = performance.now() - t0;
    expect(maps.every((m) => m.props.length > 0)).toBe(true);
    // Holgado: en una máquina normal son unos pocos ms en total.
    expect(ms).toBeLessThan(1000);
  });

  it('los límites cubren siempre los puntos visibles, también los añadidos después', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    // Un punto nuevo en la taberna, fuera del plano dibujado.
    addSpot(engine.world, 'loc_taberna', { id: 'sp_tab_almacen', name: 'el almacén', x: 18, y: 3 });
    const m = boardState(engine, 'ch_kael').map;
    expect(m.bounds.x + m.bounds.w).toBeGreaterThanOrEqual(18 + 1.2);
    for (const loc of engine.world.locations.values()) {
      const visible = engine.world.spotsOf(loc.id).filter((s) => !s.hidden);
      const cached = mapCacheOf(engine).get(loc.id);
      expectInside(clipMap(cached.map, visible), visible);
      expectInside(mapFor(loc, visible), visible);
    }
  });

  it('nada de un punto oculto sin descubrir: el plano queda como si no existiera', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    knowAll(engine, 'ch_kael');
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_po_barra' };
    const without = boardState(engine, 'ch_kael').map;
    // Un cuarto secreto al norte con un cofre y salida propia, y una trampilla dentro de la sala.
    addSpot(engine.world, 'loc_posada', { id: 'sp_po_secreto', name: 'el cuarto secreto', aliases: ['cofre'], x: 5, y: 15, hidden: true });
    addSpot(engine.world, 'loc_posada', { id: 'sp_po_trampilla', name: 'la trampilla', x: 7, y: 6, hidden: true });
    addExit(engine.world, 'ex_po_tunel', 'sp_po_secreto', 'sp_cl_piedra', 800);

    let b = boardState(engine, 'ch_kael');
    expect(b.map).toEqual(without);
    expect(JSON.stringify(b.map)).not.toContain('requires_spot');
    expect(JSON.stringify(b)).not.toContain('sp_po_secreto');
    expect(b.neighbors).not.toContain('loc_claro');

    engine.world.spot('sp_po_secreto').discovered_by.push('ch_kael');
    engine.world.spot('sp_po_trampilla').discovered_by.push('ch_kael');
    knowAll(engine, 'ch_kael');
    b = boardState(engine, 'ch_kael');
    expect(b.map.props.map((p) => p.kind)).toEqual(expect.arrayContaining(['chest', 'trapdoor']));
    expect(b.map.walls).toHaveLength(without.walls.length + 1);
    expect(b.map.doors.length).toBeGreaterThan(without.doors.length);
    expectInside(b.map, b.spots);
    expect(b.neighbors).toContain('loc_claro');
  });

  it('en un plano generado, los muebles aparecen al interactuar con su punto', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    const kael = engine.world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_po_barra' };
    let m = boardState(engine, 'ch_kael').map;
    const visible = engine.world.spotsOf('loc_posada');
    const full = mapCacheOf(engine).get('loc_posada').map;
    // Solo lo de la barra, donde está (el relleno va con el punto más cercano); paredes y puertas, siempre.
    expect([...new Set(m.props.map((p) => ownerSpot(p, visible)))]).toEqual(['sp_po_barra']);
    expect(m.walls).toEqual(full.walls);
    expect(m.doors).toHaveLength(2);
    // Lo que sale de un punto va enlazado a él, así el revelado sabe de quién es.
    for (const k of ['counter', 'fireplace', 'bed']) expect(full.props.find((p) => p.kind === k)!.spot_id).toBeDefined();

    // Va a la mesa: aparecen mesa y sillas, y la barra sigue a la vista.
    kael.location = { type: 'spot', id: 'sp_po_mesa' };
    engine.world.touch('characters', kael.id);
    m = boardState(engine, 'ch_kael').map;
    expect(m.props.map((p) => p.kind)).toEqual(expect.arrayContaining(['counter', 'table', 'chair']));
    expect(m.props.map((p) => p.kind)).not.toContain('bed');
  });
});

describe('caché de planos y precarga', () => {
  it('se invalida al añadir un punto o una salida, y se rehace por detrás', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    const cache = mapCacheOf(engine);
    const first = cache.get('loc_posada');
    expect(cache.get('loc_posada')).toBe(first);
    expect(first.map.props.some((p) => p.kind === 'well')).toBe(false);

    addSpot(engine.world, 'loc_posada', { id: 'sp_po_pozo', name: 'el pozo del patio', x: 4, y: 9 });
    expect(cache.has('loc_posada')).toBe(false);
    await tick();
    expect(cache.has('loc_posada')).toBe(true);
    expect(cache.get('loc_posada').map.props.find((p) => p.kind === 'well')!.spot_id).toBe('sp_po_pozo');

    // Una salida nueva desde un punto le pone puerta.
    const doors = cache.get('loc_posada').map.doors.length;
    addExit(engine.world, 'ex_po_claro', 'sp_po_mesa', 'sp_cl_piedra', 900);
    expect(cache.has('loc_posada')).toBe(false);
    expect(cache.get('loc_posada').map.doors.length).toBe(doors + 1);

    // Lo que no le toca no la invalida.
    cache.get('loc_vado');
    addSpot(engine.world, 'loc_posada', { id: 'sp_po_banco', name: 'un banco', x: 2, y: 2 });
    expect(cache.has('loc_vado')).toBe(true);
    // Ninguno a mano: la taberna sale del generador con la semilla de la campaña.
    expect(cache.get('loc_taberna').map).toEqual(generateMap(mapInputOf(engine.world, 'loc_taberna')));
  });

  it('al llegar a una localización, las vecinas quedan cacheadas antes de cruzar la puerta', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    const cache = mapCacheOf(engine);
    const kael = engine.world.character('ch_kael');

    // Kael llega a la plaza: la posada (vecina, sin plano dibujado) se genera por detrás.
    kael.location = { type: 'spot', id: 'sp_pl_taberna' };
    engine.world.touch('characters', kael.id);
    expect(cache.has('loc_posada')).toBe(false);
    await tick();
    expect(cache.has('loc_posada')).toBe(true);
    expect(cache.has('loc_vado')).toBe(false); // a dos saltos

    const b = boardState(engine, 'ch_kael');
    expect(b.neighbors).toEqual(expect.arrayContaining(['loc_claro', 'loc_posada', 'loc_taberna']));

    // Cruza: el plano ya estaba hecho y no se genera otra vez.
    const before = cache.generatedCount;
    kael.location = { type: 'spot', id: 'sp_po_puerta' };
    const inside = boardState(engine, 'ch_kael');
    expect(inside.location.id).toBe('loc_posada');
    expect(cache.generatedCount).toBe(before);
    expect(inside.map.walls.length).toBeGreaterThanOrEqual(1);
    // Y desde la posada se precarga el vado.
    await tick();
    expect(cache.has('loc_vado')).toBe(true);
  });

  it('al salir de viaje se precarga el destino', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    const cache = mapCacheOf(engine);
    // De la taberna a la posada: dos saltos (por la plaza); la posada no es vecina, pero es el destino.
    const r = moveTo(engine.world, 'ch_kael', 'sp_po_barra', 'walk', engine.gameNow());
    expect(r.ok).toBe(true);
    expect(cache.neighborsOf('loc_taberna')).toEqual(['loc_plaza']);
    expect(cache.has('loc_posada')).toBe(false);
    await tick();
    expect(cache.has('loc_posada')).toBe(true);
    expect(boardState(engine, 'ch_kael').neighbors).toEqual(['loc_plaza', 'loc_posada']);
  });
});

// --- Semilla, variedad y tipos de lugar -----------------------------------------

const DEMO_LOCS = ['loc_taberna', 'loc_plaza', 'loc_claro'];
/** Se pisan: pueden ir bajo una ficha. */
const WALKABLE = new Set(['rug', 'trapdoor']);

/** ¿Tapa el mueble ese sitio? */
function covers(p: MapProp, x: number, y: number): boolean {
  if (p.r !== undefined) return Math.hypot(p.x - x, p.y - y) < p.r - 1e-6;
  return x > p.x + 1e-6 && x < p.x + p.w! - 1e-6 && y > p.y + 1e-6 && y < p.y + p.h! - 1e-6;
}
/** ¿Corta el mueble el camino recto de a a b? (por muestras cada 10 cm) */
function blocks(p: MapProp, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1);
  for (let i = 0; i <= n; i++) if (covers(p, a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)) return true;
  return false;
}
function segDistance(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Lo que nunca cambia con la semilla: nada sobre los puntos ni sobre el camino entre los visibles. */
function expectCoherent(m: LocationMap, spots: { id: string; x: number; y: number; hidden: boolean }[], label: string): void {
  const visible = spots.filter((s) => !s.hidden);
  for (const p of m.props) {
    if (WALKABLE.has(p.kind)) continue;
    // Lo enlazado a un punto no pisa ningún punto; el relleno, ninguno visible.
    for (const s of p.spot_id ? spots : visible) expect(covers(p, s.x, s.y), `${label}: ${p.kind} pisa ${s.id}`).toBe(false);
    if (p.spot_id) continue;
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        expect(blocks(p, visible[i]!, visible[j]!), `${label}: ${p.kind} corta ${visible[i]!.id}–${visible[j]!.id}`).toBe(false);
      }
    }
  }
  expectInside(m, visible);
  for (const v of [m.bounds.x, m.bounds.y, m.bounds.w, m.bounds.h, ...m.props.flatMap((p) => [p.x, p.y])]) expect(Number.isFinite(v)).toBe(true);
}

/** Lo que distingue a dos planos: forma, suelo, paredes, puertas, muebles y ambiente. */
function traits(m: LocationMap): Record<string, string> {
  const j = (x: unknown) => JSON.stringify(x);
  return {
    bounds: j(m.bounds),
    ground: j([m.background, ...m.areas.filter((a) => a.polygon).slice(0, 1).map((a) => a.ground)]),
    shape: j(m.areas.find((a) => a.polygon)?.polygon ?? null),
    walls: j(m.walls),
    doors: j(m.doors),
    filler: j(m.props.filter((p) => !p.spot_id)),
    linked: j(m.props.filter((p) => p.spot_id)),
    ambience: j(m.areas.slice(1)),
  };
}

describe('planos por semilla', () => {
  it('determinista: misma semilla y mismos datos, mismo plano; la semilla sale de la campaña', async () => {
    const { engine } = await bootEngine();
    const { engine: other } = await bootEngine();
    for (const loc of DEMO_LOCS) {
      expect(generateMap(mapInputOf(engine.world, loc, 42))).toEqual(generateMap(mapInputOf(other.world, loc, 42)));
    }
    // Sin semilla del mundo: hash estable del id de la campaña.
    expect(mapSeedOf(engine.world)).toBe(hash(engine.world.campaign.id));
    expect(mapInputOf(engine.world, 'loc_taberna').seed).toBe(hash(engine.world.campaign.id));
    // Con semilla del mundo (propiedad opcional de la campaña), esa.
    (engine.world.campaign as unknown as { world_seed: number }).world_seed = 99;
    expect(mapSeedOf(engine.world)).toBe(99);
    expect(mapInputOf(engine.world, 'loc_taberna').seed).toBe(99);
  });

  it('variedad: dos semillas dan planos distintos en al menos tres propiedades', async () => {
    const { engine } = await bootEngine();
    for (const loc of DEMO_LOCS) {
      for (const [a, b] of [[1, 2], [3, 4], [100, 2000]] as const) {
        const ta = traits(generateMap(mapInputOf(engine.world, loc, a))), tb = traits(generateMap(mapInputOf(engine.world, loc, b)));
        const differ = Object.keys(ta).filter((k) => ta[k] !== tb[k]);
        expect(differ.length, `${loc} ${a}/${b}: ${differ.join(', ')}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('los tres lugares de la demo son de tipos distintos y se ven distintos', async () => {
    const { engine } = await bootEngine();
    const types = DEMO_LOCS.map((l) => placeTypeOf(mapInputOf(engine.world, l)));
    expect(types).toEqual(['tavern', 'square', 'forest']);
    for (const seed of [0, 5, 9]) {
      const [taberna, plaza, claro] = DEMO_LOCS.map((l) => generateMap(mapInputOf(engine.world, l, seed)));
      expect(taberna!.background).toBe('void');
      expect(taberna!.walls.length).toBeGreaterThan(0);
      // La plaza: empedrada o con casas alrededor que no son de ningún punto.
      expect(plaza!.props.some((p) => p.kind === 'building' && !p.spot_id)).toBe(true);
      expect(plaza!.walls.length).toBeGreaterThan(0); // el muro del portón
      // El claro: bosque alrededor, sin muros.
      expect(claro!.walls).toEqual([]);
      expect(claro!.props.filter((p) => p.kind === 'tree' && !p.spot_id).length).toBeGreaterThan(5);
    }
  });

  it('ningún mueble pisa un punto ni corta el camino recto entre dos puntos visibles, con cualquier semilla', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    for (const loc of [...DEMO_LOCS, 'loc_posada', 'loc_vado']) {
      const spots = engine.world.spotsOf(loc);
      for (let seed = 0; seed < 30; seed++) expectCoherent(generateMap(mapInputOf(engine.world, loc, seed)), spots, `${loc}#${seed}`);
    }
  });

  it('cada salida de un interior es una puerta en la pared más cercana a su punto', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    for (const loc of ['loc_taberna', 'loc_posada']) {
      const input = mapInputOf(engine.world, loc);
      for (let seed = 0; seed < 30; seed++) {
        const m = generateMap({ ...input, seed });
        const wall = m.walls[0]!.points.slice(0, -1);
        const edges = wall.map((a, i): [MapPoint, MapPoint] => [a, wall[(i + 1) % wall.length]!]);
        for (const e of input.exits!) {
          const s = engine.world.spot(e.from_spot_id);
          const p: MapPoint = [s.x, s.y];
          const nearest = edges.reduce((best, x) => (segDistance(p, ...x) < segDistance(p, ...best) ? x : best));
          const door = m.doors.reduce((best, d) => {
            const mid = (x: typeof d): MapPoint => [(x.from[0] + x.to[0]) / 2, (x.from[1] + x.to[1]) / 2];
            return Math.hypot(mid(d)[0] - s.x, mid(d)[1] - s.y) < Math.hypot(mid(best)[0] - s.x, mid(best)[1] - s.y) ? d : best;
          });
          expect(segDistance(door.from, ...nearest), `${loc}#${seed} ${s.id}`).toBeLessThan(1e-6);
          expect(segDistance(door.to, ...nearest), `${loc}#${seed} ${s.id}`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('cada salida al aire libre llega al borde del plano: el sendero del claro sale por el lado más cercano', async () => {
    const { engine } = await bootEngine();
    for (let seed = 0; seed < 20; seed++) {
      const m = generateMap(mapInputOf(engine.world, 'loc_claro', seed));
      const trail = m.areas.find((a) => a.ground === 'dirt' && a.path?.some(([x, y]) => x === 0 && y === 0))!;
      const end = trail.path!.at(-1)!;
      const b = m.bounds, w = trail.width! / 2 + 1e-6;
      const atEdge = [end[0] - w - b.x, b.x + b.w - end[0] - w, end[1] - w - b.y, b.y + b.h - end[1] - w].some((d) => Math.abs(d) < 0.02);
      expect(atEdge, `claro#${seed}`).toBe(true);
    }
  });

  it('?mapseed: el tablero usa esa semilla, sin caché ni tocar la campaña; también desde la URL de la página', async () => {
    const { engine } = await bootEngine();
    const call = (url: string, referer?: string) => {
      const out = { body: '' };
      const res = { writeHead: () => res, end: (b: string) => { out.body = b; } } as unknown as ServerResponse;
      handleBoardRequest(engine, { headers: referer ? { referer } : {} } as IncomingMessage, res, new URL(url));
      return JSON.parse(out.body).map as LocationMap;
    };
    const normal = call('http://localhost/api/board?character=ch_kael');
    const seven = call('http://localhost/api/board?character=ch_kael&mapseed=7');
    expect(seven).not.toEqual(normal);
    expect(call('http://localhost/api/board?character=ch_kael', 'http://localhost/play?game=demo&mapseed=7')).toEqual(seven);
    expect(boardState(engine, 'ch_kael').map).toEqual(normal);
    expect(mapCacheOf(engine).get('loc_taberna').map).toEqual(generateMap(mapInputOf(engine.world, 'loc_taberna')));
  });
});

describe('tipos de lugar', () => {
  const spots = (hiddenToo = false): MapGenSpot[] => [
    { id: 'sp_a', name: 'el umbral', aliases: [], tags: [], x: 0, y: 0, hidden: false },
    { id: 'sp_b', name: 'un rincón', aliases: [], tags: [], x: 9, y: 6, hidden: false },
    { id: 'sp_c', name: 'el centro', aliases: [], tags: [], x: 4, y: 3, hidden: false },
    { id: 'sp_d', name: 'el fondo', aliases: [], tags: [], x: 11, y: 1, hidden: false },
    ...(hiddenToo ? [{ id: 'sp_e', name: 'un escondite', aliases: [], tags: [], x: 6, y: 9, hidden: true }] : []),
  ];
  const CASES: [string, boolean, { name: string; kind: string } | null, PlaceType][] = [
    ['Taberna del Cuervo', true, null, 'tavern'],
    ['Casa del molinero', true, null, 'house'],
    ['Tienda de Ulla', true, null, 'shop'],
    ['Plaza Mayor', false, null, 'square'],
    ['Calle del Horno', false, null, 'street'],
    ['Claro de las Hayas', false, null, 'forest'],
    ['Cueva del Oso', true, null, 'cave'],
    ['Boca de la cueva', false, null, 'cave'],
    ['Muelle Viejo', false, null, 'dock'],
    ['El Granero', true, null, 'indoor'],
    ['Las Afueras', false, null, 'outdoor'],
    ['Rincón umbrío', false, { name: 'Bosque Negro', kind: 'forest' }, 'forest'],
    ['El Cruce', false, { name: 'Aldea de Brezal', kind: 'town' }, 'street'],
  ];

  it('reconoce el tipo por nombre, etiquetas y zona; lo desconocido cae a interior o exterior genérico', () => {
    for (const [name, indoor, zone, type] of CASES) expect(placeTypeOf({ location: { id: 'l', name, indoor }, zone }), name).toBe(type);
    expect(placeTypeOf({ location: { id: 'l', name: 'Lugar sin nombre', indoor: false, tags: ['muelle'] } })).toBe('dock');
  });

  it('cada tipo da un plano válido y con su sello', () => {
    for (const [name, indoor, zone, type] of CASES) {
      for (let seed = 0; seed < 8; seed++) {
        const input: MapGenInput = {
          location: { id: `loc_${type}`, name, indoor, ambience: { light: indoor ? 'twilight' : 'natural' } }, zone,
          spots: spots(true), exits: [{ id: 'ex_a', from_spot_id: 'sp_a', to_location_id: 'loc_fuera', to_location_name: 'Fuera' }], seed,
        };
        const m = generateMap(input);
        const label = `${type}#${seed}`;
        expectCoherent(clipMap(m, spots().map((s) => newSpot('l', s))), spots(), label);
        const unlinked = (k: string) => m.props.filter((p) => p.kind === k && !p.spot_id);
        if (indoor) {
          expect(m.background, label).toBe('void');
          expect(m.walls.length, label).toBeGreaterThan(0);
          expect(m.doors.filter((d) => !d.requires_spot).length, label).toBeGreaterThan(0);
        } else if (type !== 'square' && type !== 'street') {
          expect(m.walls, label).toEqual([]);
        }
        if (type === 'cave') expect(m.areas[0]!.ground, label).toBe('stone');
        if (type === 'square' || type === 'street') expect(unlinked('building').length, label).toBeGreaterThan(0);
        if (type === 'forest') expect(unlinked('tree').length, label).toBeGreaterThan(5);
        if (type === 'dock') {
          expect(m.areas.some((a) => a.ground === 'water' && a.polygon), label).toBe(true);
          expect(m.areas.some((a) => a.ground === 'wood'), label).toBe(true);
        }
        if (type === 'cave' && !indoor) expect(unlinked('rock').length, label).toBeGreaterThan(2);
      }
    }
  });

  it('plantillas distintas: el mismo sitio con otro tipo cambia suelo, borde o relleno', () => {
    const base = (name: string, indoor: boolean): MapGenInput => ({ location: { id: 'loc_x', name, indoor }, spots: spots(), seed: 3 });
    const interiors = ['Taberna del Cuervo', 'Casa del molinero', 'Tienda de Ulla', 'Cueva del Oso'].map((n) => JSON.stringify(generateMap(base(n, true))));
    const exteriors = ['Plaza Mayor', 'Calle del Horno', 'Claro de las Hayas', 'Muelle Viejo', 'Las Afueras'].map((n) => JSON.stringify(generateMap(base(n, false))));
    expect(new Set(interiors).size).toBe(interiors.length);
    expect(new Set(exteriors).size).toBe(exteriors.length);
  });
});

describe('tramos de camino', () => {
  it('el tramo entre la plaza y el claro es camino de bosque, no una plaza: sin edificios, y suena a bosque', () => {
    const world = new WorldClass(authoredSeed('brezal'));
    const spot = ensureWaypoint(world, 'ex_plaza_claro');
    const loc = world.location(spot.location_id);
    expect(loc.name).toBe('Camino entre Plaza del Pozo y Claro del Roble');
    const input = mapInputOf(world, loc.id);
    expect(placeTypeOf(input)).toBe('forest');
    expect(generateMap(input).props.some((p) => p.kind === 'building')).toBe(false);
    const { clock, t0 } = freshWorld();
    expect(['bosque', 'bosque-noche']).toContain(ambienceOf(world, { clock }, loc, t0));
  });
});
