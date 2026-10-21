import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { MasterClient } from '../src/ai/master.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import type { Engine, MasterLike, MasterScene, SceneHints } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { parseTrivial } from '../src/engine/fastpath.js';
import { allHooks, plantHook } from '../src/engine/hooks.js';
import { spawnItem } from '../src/engine/inventory.js';
import { bootEngine, fakeTime } from './helpers.js';

const NO_ENCOUNTER = () => 0.99;
const ALWAYS_ENCOUNTER = () => 0;

/** Máster que no debe usarse: si lo llaman, la acción revienta. */
const forbidden: MasterLike = { resolve() { throw new Error('no debería llamarse al master'); } };

/** Máster que apunta cada llamada con las pistas de escena que el motor le pone delante. */
function recorder(engine: Engine) {
  const calls: { text: string; scene: MasterScene | undefined; hints: SceneHints | null }[] = [];
  const master: MasterLike = {
    async resolve(actor, text, _roll, _intro, scene) {
      calls.push({ text, scene, hints: engine.sceneHints(actor.id) });
      return {
        ok: true, usage: {}, calls: [], context: '', model: 'stub',
        closed: { narration_private: 'El master narra.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null },
      };
    },
  };
  return { master, calls };
}

async function boot(rng = NO_ENCOUNTER, time = fakeTime()) {
  const { engine } = await bootEngine(time, { deterministic: true, rng });
  const seen = new Map<string, string[]>();
  engine.onDelivery((d: Delivery) => seen.set(d.character_id, [...(seen.get(d.character_id) ?? []), d.text]));
  return { engine, time, seen: (id: string) => seen.get(id) ?? [] };
}

/** Deja que la cola de la localización procese lo que el tick encoló (llegadas, ganchos). */
async function drain(engine: Engine, id = 'ch_kael') { await engine.act(id, 'inventario'); }

describe('acciones triviales sin master', () => {
  it('"Ir a la barra" mueve sin master, narra y el testigo lo ve por plantilla', async () => {
    const { engine, seen } = await boot();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_mesa' };
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_chimenea' };
    engine.attachMaster(forbidden);

    const r = await engine.act('ch_kael', 'Ir a la barra');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('la barra');
    expect(engine.world.character('ch_kael').transit?.destination_spot_id).toBe('sp_tab_barra');
    expect(r.event!.tags).toContain('deterministic');
    expect(r.event!.payload['master']).toBeNull();
    expect(r.suggested_actions!.length).toBeGreaterThanOrEqual(1);
    expect(r.suggested_actions!.length).toBeLessThanOrEqual(4);
    expect(r.suggested_actions).not.toContain('Ir a la barra');
    expect(seen('ch_mira').at(-1)).toBe('Kael se acerca a la barra.');
  });

  it('la llegada se narra con plantilla y acciones sugeridas, sin llamar al master', async () => {
    const { engine, time, seen } = await boot();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_mesa' };
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);

    await engine.act('ch_kael', 'Ir a la barra');
    time.advanceGame(30);
    await engine.tick();
    await drain(engine);
    expect(calls).toHaveLength(0);
    const ev = engine.events.all().find((e) => e.action_type === 'arrived')!;
    expect(ev.tags).toEqual(['movement', 'deterministic']);
    expect(ev.payload['master']).toBeNull();
    expect(ev.narration_private).toContain('Llegas a la barra.');
    expect(ev.narration_private).toContain('Brenna'); // la conoce: por su nombre
    const sugg = ev.payload['suggested_actions'] as string[];
    expect(sugg.length).toBeGreaterThanOrEqual(3);
    expect(sugg.length).toBeLessThanOrEqual(4);
    expect(sugg).toContain('Hablar con Brenna');
    expect(seen('ch_kael')).toContain(ev.narration_private);
  });

  it('"Salir hacia la plaza" toma la salida y la llegada a la plaza va por plantilla completa', async () => {
    const { engine, time } = await boot();
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);

    const r = await engine.act('ch_kael', 'Salir hacia la plaza');
    expect(r.ok).toBe(true);
    expect(r.event!.tags).toContain('deterministic');
    expect(r.text).toContain('Plaza del Pozo');
    expect(engine.world.character('ch_kael').transit?.destination_spot_id).toBe('sp_pl_taberna');
    time.advanceGame(60);
    await engine.tick();
    await drain(engine);
    expect(calls).toHaveLength(0);
    const ev = engine.events.all().find((e) => e.action_type === 'arrived')!;
    expect(ev.narration_private).toContain('**Plaza del Pozo**');
    expect(ev.narration_private).toContain('Salidas:');
    expect(ev.narration_private).toContain('Mira'); // está en el pozo
  });

  it('el texto canónico del tablero también vale: "Salir hacia Plaza del Pozo"', async () => {
    const { engine } = await boot();
    engine.attachMaster(forbidden);
    const r = await engine.act('ch_kael', 'Salir hacia Plaza del Pozo');
    expect(r.event!.tags).toContain('deterministic');
    expect(engine.world.character('ch_kael').transit?.destination_spot_id).toBe('sp_pl_taberna');
  });

  it('"coger la jarra" en el punto actual la mete en el inventario; "soltar la jarra" la deja', async () => {
    const { engine } = await boot();
    const s = spawnItem(engine.world, 'it_cerveza', 1, { type: 'spot', id: 'sp_tab_barra' });
    expect(s.ok).toBe(true);
    const id = s.ok ? s.moved.id : '';
    engine.attachMaster(forbidden);

    const r = await engine.act('ch_kael', 'coger la jarra');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('jarra de cerveza');
    expect(r.event!.tags).toEqual(['deterministic', 'inventory']);
    expect(engine.world.itemInstance(id).location).toMatchObject({ type: 'character', id: 'ch_kael' });

    const d = await engine.act('ch_kael', 'Soltar la jarra.');
    expect(d.event!.tags).toContain('deterministic');
    expect(engine.world.itemInstance(id).location).toEqual({ type: 'spot', id: 'sp_tab_barra' });
  });

  it('"esperar" no llama al master', async () => {
    const { engine } = await boot();
    engine.attachMaster(forbidden);
    const r = await engine.act('ch_kael', 'Espero un rato');
    expect(r.ok).toBe(true);
    expect(r.event!.action_type).toBe('wait');
    expect(r.event!.payload['master']).toBeNull();
  });
});

describe('lo que sigue en el master', () => {
  it('un texto ambiguo cae al master', async () => {
    const { engine } = await boot();
    spawnItem(engine.world, 'it_espada_larga', 1, { type: 'spot', id: 'sp_tab_barra' });
    spawnItem(engine.world, 'it_espada_corta', 1, { type: 'spot', id: 'sp_tab_barra' });
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    const r = await engine.act('ch_kael', 'coger la espada');
    expect(r.text).toBe('El master narra.');
    expect(calls).toHaveLength(1);
  });

  it('"hablo con Brenna", "Me acerco a Brenna" y encadenar acciones caen al master', async () => {
    const { engine } = await boot();
    const kael = engine.world.character('ch_kael');
    for (const t of ['hablo con Brenna', 'Me acerco a Brenna', 'voy a la mesa y me siento', 'ataco al lobo', 'voy a la mesa, despacio', 'ir a hablar con la tabernera']) {
      expect(parseTrivial(engine.world, kael, t), t).toBeNull();
    }
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    await engine.act('ch_kael', 'hablo con Brenna');
    expect(calls).toHaveLength(1);
  });

  it('escena tensa: con un NPC hostil delante, ir a otro punto va al master', async () => {
    const { engine } = await boot();
    engine.world.npc('npc_brenna').attitude.by_character['ch_kael'] = 'hostile';
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    await engine.act('ch_kael', 'Ir a la mesa del fondo');
    expect(calls).toHaveLength(1);
    expect(engine.world.character('ch_kael').transit).toBeNull();
  });

  it('escena tensa en el destino: salir hacia el claro con el lobo allí va al master', async () => {
    const { engine } = await boot();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_pl_porton' };
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    await engine.act('ch_kael', 'Salir hacia el Claro del Roble');
    expect(calls).toHaveLength(1);
  });

  it('la primera visita a una localización la narra el master', async () => {
    const { engine, time } = await boot();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_pl_porton' };
    engine.world.npc('npc_lobo').status = 'dead';
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    const r = await engine.act('ch_kael', 'Salir hacia el Claro del Roble');
    expect(r.event!.tags).toContain('deterministic');
    time.advanceGame(3600);
    await engine.tick();
    await drain(engine);
    expect(calls.map((c) => c.scene)).toEqual(['arrival']);
  });

  it('master.narrate_arrivals = true devuelve las llegadas a la IA', async () => {
    const { engine, time } = await boot();
    (engine.world.campaign.master as { narrate_arrivals?: boolean }).narrate_arrivals = true;
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_mesa' };
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    await engine.act('ch_kael', 'Ir a la barra');
    time.advanceGame(30);
    await engine.tick();
    await drain(engine);
    expect(calls.map((c) => c.scene)).toEqual(['arrival']);
  });
});

describe('el mundo puede sorprender', () => {
  it('si sale la tirada de imprevisto, la acción trivial va al master con la pista', async () => {
    const { engine } = await boot(ALWAYS_ENCOUNTER);
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    const r = await engine.act('ch_kael', 'Ir a la mesa del fondo');
    expect(r.text).toBe('El master narra.');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe('Ir a la mesa del fondo');
    expect(calls[0]!.hints?.encounter?.chance).toBeCloseTo(1 / 12); // interior
    expect(r.event!.payload['scene_hints']).toMatchObject({ encounter: { roll: 0 } });
    expect(engine.sceneHints('ch_kael')).toBeNull(); // solo durante la llamada
  });

  it('dormir: sin imprevisto no hay master; con imprevisto, el master', async () => {
    const quiet = await boot();
    quiet.engine.attachMaster(forbidden);
    await quiet.engine.act('ch_kael', 'dormir');
    expect(quiet.engine.world.character('ch_kael').status).toBe('asleep');

    const loud = await boot(ALWAYS_ENCOUNTER);
    const { master, calls } = recorder(loud.engine);
    loud.engine.attachMaster(master);
    await loud.engine.act('ch_kael', 'dormir');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.hints?.encounter).not.toBeNull();
  });

  it('gancho de punto: ir a ese punto llama al master con el gancho, que se consume', async () => {
    const { engine } = await boot();
    const p = plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'spot', spot_id: 'sp_tab_mesa', what: 'Un encapuchado se levanta de la mesa justo al llegar.' }, engine.gameNow());
    expect(p.ok).toBe(true);
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    await engine.act('ch_kael', 'Ir a la mesa del fondo');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.hints?.hooks.map((h) => h.what)).toEqual(['Un encapuchado se levanta de la mesa justo al llegar.']);
    expect(allHooks(engine.world)).toHaveLength(0);
    expect(engine.hooksIn('loc_taberna')).toHaveLength(0);
  });

  it('gancho de objeto: coger ese objeto lo dispara', async () => {
    const { engine } = await boot();
    spawnItem(engine.world, 'it_cerveza', 1, { type: 'spot', id: 'sp_tab_barra' });
    plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'item', item_id: 'it_cerveza', what: 'Brenna protesta: esa jarra no es tuya.' }, engine.gameNow());
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    await engine.act('ch_kael', 'coger la jarra');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.hints?.hooks).toHaveLength(1);
  });

  it('gancho de hora: salta en el tick con quien esté allí, sin acción del jugador', async () => {
    const { engine, time } = await boot();
    plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'time', minutes_from_now: 5, what: 'Entra el recaudador.' }, engine.gameNow());
    const { master, calls } = recorder(engine);
    engine.attachMaster(master);
    time.advanceGame(4 * 60);
    await engine.tick();
    expect(calls).toHaveLength(0);
    time.advanceGame(2 * 60);
    await engine.tick();
    await drain(engine);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.scene).toBe('hook');
    expect(calls[0]!.text).toContain('Entra el recaudador.');
    expect(engine.events.all().some((e) => e.action_type === 'master_hook')).toBe(true);
    expect(allHooks(engine.world)).toHaveLength(0);
  });

  it('los ganchos caducan y se validan', async () => {
    const { engine, time } = await boot();
    const now = engine.gameNow();
    expect(plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'spot', spot_id: 'sp_pl_pozo', what: 'x' }, now).ok).toBe(false);
    expect(plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'time', minutes_from_now: 0, what: 'x' }, now).ok).toBe(false);
    expect(plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'location', what: '' }, now).ok).toBe(false);
    expect(plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'location', what: 'Llueve.', expires_in_minutes: 10 }, now).ok).toBe(true);
    time.advanceGame(11 * 60);
    await engine.tick();
    expect(allHooks(engine.world)).toHaveLength(0);
  });
});

describe('coste cero de punta a punta', () => {
  it('cuatro movimientos con sus llegadas no hacen ninguna llamada al cliente del master', async () => {
    const { engine, time } = await boot();
    let requests = 0;
    const base = offlineClient();
    const client: MasterClient = { async create(p) { requests += 1; return base.create(p); } };
    engine.attachMaster(new Master(engine, { client }));
    for (const t of ['Ir a la mesa del fondo', 'Ir a la chimenea', 'Ir a la puerta', 'Salir hacia Plaza del Pozo']) {
      const r = await engine.act('ch_kael', t);
      expect(r.event!.tags, t).toContain('deterministic');
      time.advanceGame(120);
      await engine.tick();
      await drain(engine);
    }
    expect(engine.world.character('ch_kael').location).toEqual({ type: 'spot', id: 'sp_pl_taberna' });
    expect(requests).toBe(0);
    const arrivals = engine.events.all().filter((e) => e.action_type === 'arrived');
    expect(arrivals).toHaveLength(4);
    expect(arrivals.every((e) => e.tags.includes('deterministic'))).toBe(true);
  });
});

describe('ganchos con el master real', () => {
  type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
  const msg = (content: Anthropic.Beta.BetaContentBlock[]) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content, stop_reason: 'tool_use', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage);
  const use = (name: string, input: Record<string, unknown>): Anthropic.Beta.BetaToolUseBlock => ({ type: 'tool_use', id: `tu_${name}`, name, input });
  const close = use('log_event', {
    narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: 'test', suggested_actions: 'Mirar',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null,
  });
  /** Cliente que cierra siempre con log_event (tras el guion opcional) y guarda el contexto de cada petición. */
  function client(script: Anthropic.Beta.BetaMessage[] = []) {
    const contexts: string[] = [];
    const results: string[] = [];
    const c: MasterClient = {
      async create(p: Params) {
        const first = p.messages[0]!.content;
        if (p.messages.length === 1) contexts.push(typeof first === 'string' ? first : JSON.stringify(first));
        else results.push(JSON.stringify(p.messages.at(-1)!.content));
        return script.shift() ?? msg([close]);
      },
    };
    return { c, contexts, results };
  }

  it('el master siembra con plant_hook y el gancho sale en el contexto siguiente', async () => {
    const { engine } = await boot();
    const { c, contexts, results } = client([msg([use('plant_hook', {
      trigger: 'time', location_id: null, minutes_from_now: 30, spot_id: null, item_id: null,
      what: 'Entra un mensajero buscando a Brenna.', for_character_id: null, expires_in_minutes: null,
    })])]);
    engine.attachMaster(new Master(engine, { client: c }));
    await engine.act('ch_kael', 'hablo con Brenna');
    expect(results[0]).toContain('hook_id');
    expect(allHooks(engine.world)).toHaveLength(1);
    expect(allHooks(engine.world)[0]).toMatchObject({ location_id: 'loc_taberna', trigger: { kind: 'time' } });

    await engine.act('ch_kael', 'pregunto a Brenna por el pueblo');
    expect(contexts[1]).toContain('## Ganchos sembrados aquí');
    expect(contexts[1]).toContain('Entra un mensajero buscando a Brenna.');
  });

  it('un gancho de punto llega al master como «Gancho que salta ahora» y no se repite como sembrado', async () => {
    const { engine } = await boot();
    plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'spot', spot_id: 'sp_tab_mesa', what: 'Un encapuchado se levanta de la mesa.' }, engine.gameNow());
    const { c, contexts } = client();
    engine.attachMaster(new Master(engine, { client: c }));
    await engine.act('ch_kael', 'Ir a la mesa del fondo');
    expect(contexts[0]).toContain('## Gancho que salta ahora\n- Un encapuchado se levanta de la mesa.');
    expect(contexts[0]).not.toContain('## Ganchos sembrados aquí');
    expect(allHooks(engine.world)).toHaveLength(0);
  });

  it('un gancho de hora usa la escena «Algo ocurre»; el imprevisto, su bloque', async () => {
    const { engine, time } = await boot();
    plantHook(engine.world, { location_id: 'loc_taberna', trigger: 'time', minutes_from_now: 1, what: 'Se apaga la chimenea de golpe.' }, engine.gameNow());
    const { c, contexts } = client();
    engine.attachMaster(new Master(engine, { client: c }));
    time.advanceGame(120);
    await engine.tick();
    await drain(engine);
    expect(contexts[0]).toContain('## Algo ocurre');
    expect(contexts[0]).toContain('Se apaga la chimenea de golpe.');

    const loud = await boot(ALWAYS_ENCOUNTER);
    const l = client();
    loud.engine.attachMaster(new Master(loud.engine, { client: l.c }));
    await loud.engine.act('ch_kael', 'Ir a la chimenea');
    expect(l.contexts[0]).toContain('## Imprevisto');
    expect(l.contexts[0]).toContain('«Ir a la chimenea»');
  });
});
