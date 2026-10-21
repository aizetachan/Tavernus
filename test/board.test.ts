import { describe, expect, it } from 'vitest';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { GAME_HOUR } from '../src/clock/clock.js';
import { boardState, clipMap, handleBoardRequest, mapFor } from '../src/adapters/web/board.js';
import { mapCacheOf } from '../src/adapters/web/mapcache.js';
import { revealTrackerOf } from '../src/adapters/web/reveal.js';
import { generateMap, mapInputOf, type MapGenInput, type MapGenSpot } from '../src/adapters/web/mapgen.js';
import { DEMO_MAPS, type LocationMap } from '../src/data/seed/maps.js';
import type { Spot } from '../src/engine/model.js';
import type { World } from '../src/engine/world.js';
import type { Engine } from '../src/engine/engine.js';
import { moveTo, positionOf } from '../src/engine/movement.js';
import { perceive } from '../src/engine/perception.js';
import { bootEngine } from './helpers.js';

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
    expect(engine.world.character('ch_kael').transit?.destination_spot_id).toBe('sp_pl_taberna');
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
    expect(kinds()).toEqual(expect.arrayContaining(['counter', 'fireplace', 'table', 'rug']));
    expect(kinds()).not.toContain('trapdoor');
    expect(kinds()).not.toContain('stairs');
    expect(kinds()).not.toContain('bed');
    expect(JSON.stringify(m)).not.toContain('requires_spot');
    // Sin el cuarto, el plano no reserva hueco al norte de la sala (pared en y = 9).
    expect(m.bounds.y + m.bounds.h).toBeLessThan(11);

    engine.world.spot('sp_tab_trampilla').discovered_by.push('ch_kael');
    engine.world.spot('sp_tab_habitacion').discovered_by.push('ch_kael');
    m = boardState(engine, 'ch_kael').map;
    expect(kinds()).toEqual(expect.arrayContaining(['trapdoor', 'stairs', 'bed', 'chest']));
    expect(m.doors).toHaveLength(2);
    expect(m.bounds).toEqual(DEMO_MAPS['loc_taberna']!.bounds);
  });

  it('cada punto de la demo cae dentro de su plano', async () => {
    const { engine } = await bootEngine();
    for (const loc of engine.world.locations.values()) {
      const m = mapFor(loc, engine.world.spotsOf(loc.id));
      expect(DEMO_MAPS[loc.id], loc.id).toBeDefined();
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
    for (const [locId, m] of Object.entries(DEMO_MAPS)) {
      for (const p of m.props.filter((x) => x.spot_id)) {
        expect(engine.world.spot(p.spot_id!).location_id, `${p.kind} → ${p.spot_id}`).toBe(locId);
      }
    }
    const props = boardState(engine, 'ch_kael').map.props;
    expect(props.find((p) => p.kind === 'fireplace')!.spot_id).toBe('sp_tab_chimenea');
    expect(props.filter((p) => p.spot_id === 'sp_tab_barra').length).toBeGreaterThan(1);
  });

  it('una localización sin plano dibujado recibe uno generado de sus puntos visibles', async () => {
    const { engine } = await bootEngine();
    const taberna = engine.world.location('loc_taberna');
    const visible = engine.world.spotsOf('loc_taberna').filter((s) => !s.hidden);
    const m = mapFor(taberna, visible, {});
    expect(m.background).toBe('void');
    expect(m.walls).toHaveLength(1);
    expect(m.areas[0]!.ground).toBe('wood');
    for (const s of visible) {
      expect(s.x).toBeGreaterThan(m.bounds.x);
      expect(s.y).toBeLessThan(m.bounds.y + m.bounds.h);
    }
    // La habitación oculta (y = 12) no estira el plano.
    expect(m.bounds.y + m.bounds.h).toBeLessThan(12);
    const claro = mapFor(engine.world.location('loc_claro'), engine.world.spotsOf('loc_claro'), {});
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
    expect(m.areas[0]!.ground).toBe('wood');
    expect(m.walls).toHaveLength(1);
    const linked = (kind: string) => m.props.filter((p) => p.kind === kind).map((p) => p.spot_id);
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
    expect([fire.x - x0, x1 - fire.x - fire.w!, fire.y - y0, y1 - fire.y - fire.h!].some((d) => Math.abs(d) < 1e-6)).toBe(true);
    for (const p of m.props) {
      expect(p.x).toBeGreaterThanOrEqual(x0);
      expect(p.x + (p.w ?? 0)).toBeLessThanOrEqual(x1);
      expect(p.y).toBeGreaterThanOrEqual(y0);
      expect(p.y + (p.h ?? 0)).toBeLessThanOrEqual(y1);
    }
    for (const p of m.props.filter((x) => x.w !== undefined)) {
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
    const water = m.areas.find((a) => a.ground === 'water')!;
    const dirt = m.areas.find((a) => a.ground === 'dirt')!;
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

  it('los límites cubren siempre los puntos visibles, también en los planos a mano', async () => {
    const { engine } = await bootEngine();
    addPosadaYVado(engine.world);
    // Un punto nuevo en la taberna, fuera del plano dibujado.
    addSpot(engine.world, 'loc_taberna', { id: 'sp_tab_almacen', name: 'el almacén', x: 18, y: 3 });
    const m = boardState(engine, 'ch_kael').map;
    expect(m.bounds.x + m.bounds.w).toBeGreaterThanOrEqual(18 + 1.2);
    for (const loc of engine.world.locations.values()) {
      const visible = engine.world.spotsOf(loc.id).filter((s) => !s.hidden);
      const cached = mapCacheOf(engine).get(loc.id);
      expectInside(clipMap(cached.map, visible, cached.generated), visible);
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
    expect(b.map.walls).toHaveLength(2);
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
    // Solo lo de la barra, donde está; paredes y puertas, siempre.
    expect([...new Set(m.props.map((p) => p.spot_id))]).toEqual(['sp_po_barra']);
    expect(m.walls).toHaveLength(1);
    expect(m.doors).toHaveLength(2);
    // Todo lo que pone el generador va enlazado a su punto, así el revelado sabe de quién es.
    const full = mapCacheOf(engine).get('loc_posada').map;
    expect(full.props.every((p) => p.spot_id)).toBe(true);

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
    // Los dibujados a mano salen tal cual.
    expect(cache.get('loc_taberna')).toEqual({ map: DEMO_MAPS['loc_taberna'], generated: false });
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
    expect(inside.map.walls).toHaveLength(1);
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
