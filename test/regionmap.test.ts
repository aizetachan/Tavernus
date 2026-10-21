import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMapRequest, idealLength, knowledgeOf, layoutCacheOf, layoutGraph, regionMapState } from '../src/adapters/web/regionmap.js';
import { classifyPlace } from '../src/adapters/web/mapgen.js';
import type { Engine } from '../src/engine/engine.js';
import type { Location, Spot } from '../src/engine/model.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Añade al mundo una localización nueva con su punto por defecto, en la zona dada. */
function addLocation(engine: Engine, id: string, name: string, zone_id: string): Location {
  const world = engine.world;
  const spot: Spot = {
    id: `sp_${id}`, location_id: id, name: 'la entrada', aliases: [], description: 'Entrada.', x: 0, y: 0, capacity: null, hidden: false,
    discovered_by: [], state: {}, tags: [], terrain_multiplier: 1, entry_cost_s: 0, links: [],
  };
  const loc: Location = {
    id, zone_id, name, description_base: 'Un sitio.', default_spot_id: spot.id, indoor: false,
    ambience: { light: 'natural', noise: 0 }, state: {}, discovery: {},
  };
  world.spots.set(spot.id, spot);
  world.locations.set(loc.id, loc);
  world.touch('locations', loc.id);
  return loc;
}

describe('mapa de zona y región', () => {
  it('dibuja lo visitado, lo de oídas y las vecinas de otra zona; lo desconocido no existe', async () => {
    const { engine } = await bootEngine();
    const m = regionMapState(engine, 'ch_kael');
    expect(m.region).toEqual({ id: 'rg_valle', name: 'Valle de Vharn' });
    expect(m.zone).toMatchObject({ id: 'zn_brezal', name: 'Aldea de Brezal', kind: 'town' });
    const byId = Object.fromEntries(m.zone.nodes.map((n) => [n.id, n]));
    expect(byId['loc_taberna']).toMatchObject({ known: 'visited', here: true, kind: 'town', zone_id: 'zn_brezal' });
    expect(byId['loc_plaza']).toMatchObject({ known: 'visited', here: false, kind: 'town' });
    expect(byId['loc_claro']).toMatchObject({ known: 'heard_of', outside: true, kind: 'forest', zone_id: 'zn_fresnos' });
    expect(m.zone.edges.map((e) => [e.from, e.to, e.distance_m, e.blocked])).toEqual([
      ['loc_taberna', 'loc_plaza', 3, false], ['loc_plaza', 'loc_claro', 600, false],
    ]);
    expect(m.actor).toMatchObject({ id: 'ch_kael', location_id: 'loc_taberna', zone_id: 'zn_brezal', transit: null });

    // Una localización nueva sin descubrir ni salida conocida no aparece.
    const cueva = addLocation(engine, 'loc_cueva', 'Cueva del Hollín', 'zn_fresnos');
    expect(regionMapState(engine, 'ch_kael').zone.nodes.map((n) => n.id)).not.toContain('loc_cueva');
    // Con salida desde la plaza (visitada) pasa a conocida de oídas, como vecina.
    engine.world.exits.set('ex_plaza_cueva', { id: 'ex_plaza_cueva', from_spot_id: 'sp_pl_porton', to_spot_id: 'sp_loc_cueva', distance_m: 1200, terrain_multiplier: 1, bidirectional: true, state: { blocked_by: 'un derrumbe' } });
    engine.world.touch('exits', 'ex_plaza_cueva');
    let z = regionMapState(engine, 'ch_kael').zone;
    expect(z.nodes.find((n) => n.id === 'loc_cueva')).toMatchObject({ known: 'heard_of', outside: true, kind: 'cave' });
    expect(z.edges.find((e) => e.id === 'ex_plaza_cueva')).toMatchObject({ from: 'loc_plaza', to: 'loc_cueva', blocked: true });
    // Visitada: relleno.
    cueva.discovery['ch_kael'] = 'visited';
    z = regionMapState(engine, 'ch_kael').zone;
    expect(z.nodes.find((n) => n.id === 'loc_cueva')!.known).toBe('visited');
  });

  it('conocimiento: visitado, de oídas, destino de salida desde lo visitado, y donde están los compañeros', async () => {
    const { engine } = await bootEngine();
    const world = engine.world;
    const kael = world.character('ch_kael');
    world.location('loc_claro').discovery = {};
    expect([...knowledgeOf(world, kael)].sort()).toEqual([['loc_claro', 'heard_of'], ['loc_plaza', 'visited'], ['loc_taberna', 'visited']]);
    world.location('loc_plaza').discovery = {};
    // La plaza sigue siendo destino de la salida de la taberna; el claro ya no cuelga de nada visitado.
    expect([...knowledgeOf(world, kael)].sort()).toEqual([['loc_plaza', 'heard_of'], ['loc_taberna', 'visited']]);
    expect(knowledgeOf(world, kael, ['loc_claro', 'loc_nada']).get('loc_claro')).toBe('heard_of');
    // Mira está en la plaza: aunque Kael no la hubiera visto, sabe dónde está su compañera.
    const m = regionMapState(engine, 'ch_kael');
    expect(m.zone.nodes.find((n) => n.id === 'loc_plaza')!.known).toBe('heard_of');
  });

  it('un camino solo se dibuja entre lugares conocidos', async () => {
    const { engine } = await bootEngine();
    engine.world.location('loc_claro').discovery = {};
    engine.world.location('loc_plaza').discovery = {};
    const z = regionMapState(engine, 'ch_kael').zone;
    expect(z.nodes.map((n) => n.id).sort()).toEqual(['loc_plaza', 'loc_taberna']);
    expect(z.edges.map((e) => e.id)).toEqual(['ex_tab_plaza']);
  });

  it('disposición determinista y estable: descubrir un lugar no mueve los demás', async () => {
    const a = layoutGraph(['b', 'a', 'c'], [{ from: 'a', to: 'b', distance_m: 3 }, { from: 'b', to: 'c', distance_m: 600 }], 'zn');
    const b = layoutGraph(['a', 'b', 'c'], [{ from: 'b', to: 'c', distance_m: 600 }, { from: 'a', to: 'b', distance_m: 3 }], 'zn');
    expect([...a]).toEqual([...b]);
    expect(layoutGraph(['a', 'b', 'c'], [], 'otra')).not.toEqual(a);
    expect(layoutGraph(['solo'], [], 'x').get('solo')).toEqual({ x: 0, y: 0 });
    expect(layoutGraph([], [], 'x').size).toBe(0);
    // Más distancia real, más largo el camino (pero en escala logarítmica).
    const ab = Math.hypot(a.get('a')!.x - a.get('b')!.x, a.get('a')!.y - a.get('b')!.y);
    const bc = Math.hypot(a.get('b')!.x - a.get('c')!.x, a.get('b')!.y - a.get('c')!.y);
    expect(bc).toBeGreaterThan(ab);
    expect(bc / ab).toBeLessThan(10);
    expect(idealLength(600)).toBeLessThan(3 * idealLength(3));

    const { engine } = await bootEngine();
    const before = regionMapState(engine, 'ch_kael');
    engine.world.location('loc_claro').discovery['ch_kael'] = 'visited';
    const after = regionMapState(engine, 'ch_kael');
    for (const n of before.zone.nodes) expect(after.zone.nodes.find((x) => x.id === n.id)).toMatchObject({ x: n.x, y: n.y });
    for (const n of before.world.nodes) expect(after.world.nodes.find((x) => x.id === n.id)).toMatchObject({ x: n.x, y: n.y });
    // Mismos datos, misma disposición en otro motor; y la caché solo calcula una vez por vista.
    const other = await bootEngine();
    expect(regionMapState(other.engine, 'ch_kael').zone.nodes).toEqual(before.zone.nodes);
    expect(layoutCacheOf(engine).computed).toBe(2);
    addLocation(engine, 'loc_ermita', 'Ermita', 'zn_brezal');
    regionMapState(engine, 'ch_kael');
    expect(layoutCacheOf(engine).computed).toBe(4);
  });

  it('clasifica los lugares por su nombre y, si no, por su zona', () => {
    expect(classifyPlace('Aldea de Brezal', 'town')).toBe('town');
    expect(classifyPlace('Claro del Roble', 'forest')).toBe('forest');
    expect(classifyPlace('Cueva del Hollín', 'forest')).toBe('cave');
    expect(classifyPlace('Orilla del río', 'forest')).toBe('water');
    expect(classifyPlace('Taberna del Jabalí', 'town', true)).toBe('town');
    expect(classifyPlace('El Cruce', 'forest')).toBe('forest');
    expect(classifyPlace('El Cruce', null)).toBe('place');
    expect(classifyPlace('El Cruce', null, true)).toBe('town');
    expect(classifyPlace('Páramo de las Grullas', 'wild')).toBe('wild');
  });

  it('presencias: tú en verde, el grupo siempre, NPC solo si los percibes, rojos si son hostiles', async () => {
    const { engine } = await bootEngine();
    const world = engine.world;
    let m = regionMapState(engine, 'ch_kael');
    const rel = (id: string) => m.presences.find((p) => p.id === id);
    expect(rel('ch_kael')).toMatchObject({ relation: 'self', location_id: 'loc_taberna', seen: true });
    // Mira está en la plaza: va siempre, aunque Kael no la vea.
    expect(rel('ch_mira')).toMatchObject({ kind: 'character', relation: 'ally', location_id: 'loc_plaza', zone_id: 'zn_brezal', seen: false, label: 'Mira' });
    // Brenna junto a la barra: aliada; Doro está en la plaza: no se ve desde la taberna.
    expect(rel('npc_brenna')).toMatchObject({ kind: 'npc', relation: 'ally', label: 'Brenna', seen: true });
    expect(rel('npc_doro')).toBeUndefined();
    expect(rel('npc_lobo')).toBeUndefined();
    expect(m.presences.every((p) => p.kind === 'character' || p.kind === 'npc')).toBe(true);

    // Un NPC atacado es hostil para ese PJ.
    world.npc('npc_brenna').attitude.by_character['ch_kael'] = 'hostile';
    m = regionMapState(engine, 'ch_kael');
    expect(rel('npc_brenna')!.relation).toBe('hostile');
    expect(regionMapState(engine, 'ch_mira').presences.find((p) => p.id === 'npc_brenna')).toBeUndefined();

    // En el claro, de día: el lobo del arroyo es hostil y se intuye a lo lejos.
    world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_roble' };
    m = regionMapState(engine, 'ch_kael');
    expect(rel('npc_lobo')).toMatchObject({ relation: 'hostile', seen: true });
    expect(['full', 'vague', 'hint']).toContain(rel('npc_lobo')!.level);
    // En un punto oculto que el actor no ha descubierto, nadie aparece.
    world.npc('npc_lobo').location = { type: 'spot', id: 'sp_tab_trampilla' };
    world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_mesa' };
    m = regionMapState(engine, 'ch_kael');
    expect(rel('npc_lobo')).toBeUndefined();
    world.spot('sp_tab_trampilla').discovered_by.push('ch_kael');
    m = regionMapState(engine, 'ch_kael');
    expect(rel('npc_lobo')).toMatchObject({ relation: 'hostile' });
  });

  it('de camino entre dos lugares: progreso sobre el camino', async () => {
    const { engine, time } = await bootEngine(fakeTime(), { deterministic: true });
    const world = engine.world;
    world.character('ch_kael').location = { type: 'spot', id: 'sp_pl_porton' };
    const r = await engine.act('ch_kael', 'Salir hacia Claro del Roble');
    expect(r.ok).toBe(true);
    const t = world.character('ch_kael').transit!;
    expect(t).not.toBeNull();
    time.advanceGame((t.arrives_game_s - t.departed_game_s) / 2);
    const m = regionMapState(engine, 'ch_kael');
    expect(m.actor.transit).toMatchObject({ from_location_id: 'loc_plaza', to_location_id: 'loc_claro', from_zone_id: 'zn_brezal', to_zone_id: 'zn_fresnos' });
    expect(m.actor.transit!.progress).toBeGreaterThan(0.3);
    expect(m.actor.transit!.progress).toBeLessThan(0.7);
    expect(m.presences.find((p) => p.id === 'ch_kael')).toMatchObject({ moving: true, transit: m.actor.transit });
    // Al llegar: el claro visitado, sin tránsito.
    time.advanceGame(t.arrives_game_s - t.departed_game_s);
    await engine.tick();
    const after = regionMapState(engine, 'ch_kael');
    expect(after.actor).toMatchObject({ location_id: 'loc_claro', zone_id: 'zn_fresnos', transit: null });
    expect(after.zone).toMatchObject({ id: 'zn_fresnos', kind: 'forest' });
    expect(after.zone.nodes.find((n) => n.id === 'loc_claro')).toMatchObject({ known: 'visited', here: true });
    expect(after.zone.nodes.find((n) => n.id === 'loc_plaza')).toMatchObject({ known: 'visited', outside: true });
  });

  it('región: las zonas conocidas y los caminos entre ellas agregados por par', async () => {
    const { engine } = await bootEngine();
    const m = regionMapState(engine, 'ch_kael');
    expect(m.world.nodes.map((n) => [n.id, n.known, n.here, n.kind])).toEqual([
      ['zn_brezal', 'visited', true, 'town'], ['zn_fresnos', 'heard_of', false, 'forest'],
    ]);
    expect(m.world.edges).toEqual([{ id: 'zn_brezal|zn_fresnos', from: 'zn_brezal', to: 'zn_fresnos', distance_m: 600, blocked: false }]);
    // Otra salida al bosque, más corta y bloqueada: el camino agregado toma la mínima y no está bloqueado del todo.
    addLocation(engine, 'loc_senda', 'Senda', 'zn_fresnos');
    engine.world.exits.set('ex_atajo', { id: 'ex_atajo', from_spot_id: 'sp_pl_porton', to_spot_id: 'sp_loc_senda', distance_m: 200, terrain_multiplier: 1, bidirectional: true, state: { locked: true } });
    engine.world.touch('exits', 'ex_atajo');
    expect(regionMapState(engine, 'ch_kael').world.edges[0]).toMatchObject({ distance_m: 200, blocked: false });
    // Una zona de la que no se conoce nada no se dibuja.
    engine.world.zones.set('zn_monte', { id: 'zn_monte', region_id: 'rg_valle', name: 'Monte', kind: 'mountain' });
    engine.world.touch('zones', 'zn_monte');
    expect(regionMapState(engine, 'ch_kael').world.nodes.map((n) => n.id)).toEqual(['zn_brezal', 'zn_fresnos']);
  });

  it('GET /api/map responde el JSON o 404', async () => {
    const { engine } = await bootEngine();
    const fake = () => {
      const out = { status: 0, body: '' };
      const res = { writeHead: (s: number) => { out.status = s; return res; }, end: (b: string) => { out.body = b; } };
      return { out, res: res as unknown as ServerResponse };
    };
    const req = {} as IncomingMessage;
    const ok = fake();
    handleMapRequest(engine, req, ok.res, new URL('http://localhost/api/map?character=ch_kael'));
    expect(ok.out.status).toBe(200);
    expect(JSON.parse(ok.out.body).zone.id).toBe('zn_brezal');
    const missing = fake();
    handleMapRequest(engine, req, missing.res, new URL('http://localhost/api/map?character=nadie'));
    expect(missing.out.status).toBe(404);
  });
});
