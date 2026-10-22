import { describe, expect, it } from 'vitest';
import { mapCacheOf } from '../src/adapters/web/mapcache.js';
import { ownerSpot, revealMap, revealTrackerOf } from '../src/adapters/web/reveal.js';
import type { MapProp } from '../src/data/seed/maps.js';
import { bootEngine } from './helpers.js';

describe('plano que se descubre al interactuar', () => {
  it('al empezar solo se ven los muebles del punto donde está el PJ', async () => {
    const { engine } = await bootEngine();
    const visible = engine.world.spotsOf('loc_taberna').filter((s) => !s.hidden);
    const seen = revealTrackerOf(engine).seenBy('ch_kael');
    expect([...seen]).toEqual(['sp_tab_barra']);
    const full = mapCacheOf(engine).get('loc_taberna').map;
    const m = revealMap(full, visible, seen, 'sp_tab_barra');
    const kinds = m.props.map((p) => p.kind);
    expect(kinds).toContain('counter');
    expect(kinds).not.toContain('fireplace');
    expect(m.props.every((p) => ownerSpot(p, visible) === 'sp_tab_barra')).toBe(true);
    // Paredes y puertas, siempre.
    expect(m.walls).toEqual(full.walls);
    expect(m.doors).toEqual(full.doors);
  });

  it('ir a un punto o hacer algo en él lo descubre, y se queda descubierto al irse', async () => {
    const { engine, time } = await bootEngine();
    const t = revealTrackerOf(engine);
    expect(t.seenBy('ch_kael').has('sp_tab_chimenea')).toBe(false);
    expect((await engine.act('ch_kael', 'Ir a la chimenea')).ok).toBe(true);
    time.advanceGame(60);
    await engine.tick();
    expect(engine.world.characterSpot(engine.world.character('ch_kael'))!.id).toBe('sp_tab_chimenea');
    expect(t.seenBy('ch_kael').has('sp_tab_chimenea')).toBe(true);
    expect((await engine.act('ch_kael', 'Ir a la barra')).ok).toBe(true);
    time.advanceGame(60);
    await engine.tick();
    const visible = engine.world.spotsOf('loc_taberna').filter((s) => !s.hidden);
    const m = revealMap(mapCacheOf(engine).get('loc_taberna').map, visible, t.seenBy('ch_kael'), 'sp_tab_barra');
    expect(m.props.map((p) => p.kind)).toEqual(expect.arrayContaining(['counter', 'fireplace']));
    // Lo de Kael no lo ve Mira.
    expect(t.seenBy('ch_mira').has('sp_tab_chimenea')).toBe(false);
  });

  it('los muebles sin punto van con el punto visible más cercano; edificios y árboles se ven siempre', async () => {
    const { engine } = await bootEngine();
    const taberna = engine.world.spotsOf('loc_taberna').filter((s) => !s.hidden);
    const rug: MapProp = { kind: 'rug', x: 8.7, y: 7, w: 2.6, h: 1.8 };
    expect(ownerSpot(rug, taberna)).toBe('sp_tab_mesa');
    const plaza = engine.world.spotsOf('loc_plaza');
    const m = revealMap(mapCacheOf(engine).get('loc_plaza').map, plaza, new Set(), null);
    expect(m.props.every((p) => p.kind === 'building' || p.kind === 'tree' || p.kind === 'text')).toBe(true);
    expect(m.props.some((p) => p.kind === 'building')).toBe(true);
  });
});
