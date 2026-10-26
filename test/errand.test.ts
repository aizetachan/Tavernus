import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Master, type MasterClient } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { parseErrand } from '../src/engine/errand.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { claimSituation } from '../src/worldgen/index.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const NO_ENCOUNTER = () => 0.99;

/** Brezal con atajos deterministas, viaje rápido y el máster offline; Lia en la casa de las hierbas. */
async function brezal(opts: { deterministic?: boolean; client?: MasterClient } = {}) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: opts.deterministic ?? true, rng: NO_ENCOUNTER });
  const r = await engine.createCharacter('u_lia', 'Lia', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  const c = r.character;
  c.location = { type: 'spot', id: 'sp_cu_puerta' };
  for (const l of ['loc_plaza', 'loc_curandera', 'loc_taberna', 'loc_herreria']) engine.world.location(l).discovery[c.id] = 'visited';
  const requests: string[] = [];
  const base = opts.client ?? offlineClient();
  engine.attachMaster(new Master(engine, { client: { create: (p) => { requests.push(p.messages[0]!.content as string); return base.create(p); } } }));
  return { engine, c, requests, time };
}

const lastSeq = (engine: Engine) => engine.events.all().at(-1)?.seq ?? 0;
/** Lo que lee el propio jugador tras su acción (sin los avisos de progreso). */
const said = (engine: Engine, c: Character, from: number): GameEvent[] => engine.events.all()
  .filter((e) => e.seq > from && e.actor_id === c.id && e.narration_private.trim() !== '' && !e.action_type.startsWith('progress'));
const holds = (engine: Engine, c: Character, itemId: string) => engine.world.itemsCarriedBy(c.id).some((i) => i.item_id === itemId);

describe('ir y hacer en una frase', () => {
  it('separa a dónde va de lo que hace al llegar, con el destino afinado a lo que nombra', async () => {
    const { engine, c } = await brezal();
    const e = (t: string) => parseErrand(engine.world, c, t, engine.gameNow());
    // «a por agua» en la plaza: al pozo, que es donde está el agua.
    expect(e('voy a la plaza a por agua')).toMatchObject({ dest: { spot_id: 'sp_pl_pozo', location_id: 'loc_plaza' }, action: 'a por agua' });
    expect(e('Ir al pozo y sacar agua')).toMatchObject({ dest: { spot_id: 'sp_pl_pozo' }, action: 'sacar agua' });
    expect(e('voy a la taberna')).toBeNull();
    expect(e('voy a la casa de mateo')).toBeNull();
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    // Por oficio, con otro género: a donde está la curandera.
    const ilse = engine.world.npc('npc_ilse');
    expect(e('voy al curandero a preguntarle si me puede seguir')).toMatchObject({ dest: { via: 'npc', npc_id: 'npc_ilse', spot_id: ilse.location.id }, action: 'preguntarle si me puede seguir' });
    expect(e('voy a la casa de las hierbas a ver a Ilse')).toMatchObject({ dest: { npc_id: 'npc_ilse' } });
  });

  it('«voy a la plaza a por agua»: llega al pozo y coge el agua en la misma respuesta, sin IA', async () => {
    const { engine, c, requests } = await brezal();
    const from = lastSeq(engine);
    const r = await engine.act(c.id, 'voy a la plaza a por agua');
    expect(r.ok).toBe(true);
    expect(c.transit).toBeNull();
    expect(c.location.id).toBe('sp_pl_pozo');
    expect(holds(engine, c, 'it_agua_pozo')).toBe(true);
    // Una sola respuesta fluida: el viaje y la acción juntos.
    const out = said(engine, c, from);
    expect(out).toHaveLength(1);
    expect(out[0]!.narration_private).toMatch(/^Sales a Plaza del Pozo\. Te acercas al pozo\. Coges agua del pozo/);
    expect(r.text).toBe(out[0]!.narration_private);
    expect(requests).toHaveLength(0);
  });

  it('«voy al curandero a preguntarle si me puede seguir»: viaja hasta Ilse y el máster resuelve la pregunta allí', async () => {
    const { engine, c, requests } = await brezal();
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    const ilse = engine.world.npc('npc_ilse');
    const from = lastSeq(engine);
    const r = await engine.act(c.id, 'voy al curandero a preguntarle si me puede seguir');
    expect(r.ok).toBe(true);
    expect(c.location.id).toBe(ilse.location.id);
    // Una llamada al máster, con el viaje hecho y lo que queda por hacer.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('## Viaje ya hecho');
    expect(requests[0]).toContain('Lo que venía a hacer: «preguntarle si me puede seguir»');
    const out = said(engine, c, from);
    expect(out).toHaveLength(1);
    expect(out[0]!.action_type).toBe('master');
    expect(out[0]!.narration_private).toMatch(/^Cruzas el callejón de las hierbas y entras en Casa de las hierbas\./);
    expect(out[0]!.narration_private).toContain('Ilse levanta la vista');
    expect(out[0]!.payload['npc_id']).toBe('npc_ilse');
    expect(engine.events.all().some((e) => e.seq > from && e.action_type === 'master_arrival')).toBe(false);
  });

  it('«voy a la taberna» sin acción: solo el viaje, como siempre', async () => {
    const { engine, c, requests } = await brezal();
    const from = lastSeq(engine);
    await engine.act(c.id, 'voy a la taberna');
    expect(c.location.id).toBe('sp_tab_puerta');
    const out = said(engine, c, from);
    expect(out[0]!.action_type).toBe('move');
    expect(out[0]!.narration_private).toBe('Te pones en camino hacia Taberna del Jabalí.');
    expect(out.some((e) => e.tags.includes('pending'))).toBe(false);
    // Si hay máster, como mucho narra la llegada en su escena (como siempre), sin nada pendiente.
    expect(requests.every((x) => x.includes('## Llegada'))).toBe(true);
  });

  it('un paso cerrado por el camino: se queda donde se corta, lo dice y la acción queda pendiente', async () => {
    const { engine, c } = await brezal();
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    engine.world.location('loc_valcruz').discovery[c.id] = 'heard_of';
    const r = await engine.act(c.id, 'voy al camino de Valcruz a buscar ayuda');
    expect(r.text).toMatch(/no se puede cruzar \(El Cerco de Ceniza\)/);
    expect(r.text).toContain('Lo que ibas a hacer («buscar ayuda») queda pendiente.');
    expect(c.location.id).toBe('sp_li_niebla');
    // Para retomarlo, la frase entera es la primera sugerencia.
    expect(r.suggested_actions?.[0]).toBe('voy al camino de Valcruz a buscar ayuda');
  });

  it('un encuentro en el camino lo para y la acción espera', async () => {
    const { engine, c } = await brezal();
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    engine.world.location('loc_lindero').state['travel_encounter_chance'] = 1;
    engine.world.location('loc_lindero').discovery[c.id] = 'heard_of';
    const from = lastSeq(engine);
    const r = await engine.act(c.id, 'voy al lindero a buscar setas');
    expect(engine.world.spot(c.location.id).tags).toContain('waypoint');
    expect(said(engine, c, from).some((e) => e.action_type === 'travel_encounter')).toBe(true);
    expect(r.text).toContain('queda pendiente');
  });

  it('quien buscaba no está: llega, lo dice y la acción queda pendiente', async () => {
    const { engine, c, requests } = await brezal();
    c.knows.push('npc_hugo');
    // Hugo se ha ido a la taberna y su rutina no le devuelve a la fragua.
    const hugo = engine.world.npc('npc_hugo') as { routine?: unknown; location: { type: 'spot'; id: string } };
    hugo.routine = undefined;
    hugo.location = { type: 'spot', id: 'sp_tab_barra' };
    const r = await engine.act(c.id, 'voy a la herrería a hablar con Hugo');
    expect(engine.world.location(engine.world.spot(c.location.id).location_id).id).toBe('loc_herreria');
    expect(r.text).toContain('Hugo no está aquí.');
    expect(r.text).toContain('queda pendiente');
    expect(requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Máster IA: move_to deja al actor en el destino y lo siguiente ocurre allí.
// ---------------------------------------------------------------------------

type Block = Anthropic.Beta.BetaContentBlock;
const use = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Block => ({ type: 'tool_use', id, name, input } as unknown as Block);
const closing = (narration: string): Block => use('log_event', {
  narration_private: narration, observable: null, observable_vague: null, loudness: 1, tags: 'exploration', suggested_actions: '',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
  decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false,
});
/** Máster con guion: cada turno se construye al pedirlo (con el id del actor ya creado). */
function scripted(turns: (() => Block[])[]): MasterClient {
  let i = 0;
  return {
    async create() {
      const content = turns[Math.min(i++, turns.length - 1)]!();
      return { id: `m${i}`, type: 'message', role: 'assistant', model: 'stub', content, stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

describe('el máster IA encadena viaje y acción', () => {
  it('«Ir al pozo y sacar agua» (partida del 26-10): move_to y transfer_item en el mismo mensaje ya no fallan', async () => {
    const actor = { id: '' };
    const client = scripted([
      () => [
        use('move_to', { character_id: actor.id, target_spot_id: 'sp_pl_pozo', target_location_id: null, pace: 'walk' }),
        use('transfer_item', { instance_id: 'ii_agua_pozo', to_type: 'character', to_id: actor.id, slot: 'hand_off', equip_slot: null, quantity: 1 }),
        closing('Cruzas hasta el pozo y llenas el frasco.'),
      ],
    ]);
    // Todo por el máster (sin atajos), como en la partida.
    const { engine, c } = await brezal({ deterministic: false, client });
    actor.id = c.id;
    c.location = { type: 'spot', id: 'sp_pl_taberna' };
    const r = await engine.act(c.id, 'Ir al pozo y sacar agua');
    expect(r.ok).toBe(true);
    expect(c.location.id).toBe('sp_pl_pozo');
    expect(holds(engine, c, 'it_agua_pozo')).toBe(true);
    expect(r.event?.tags).not.toContain('tool_failed');
    expect(r.text).toBe('Cruzas hasta el pozo y llenas el frasco.');
  });

  it('a otra localización: llega dentro y habla allí en la misma acción; sin escena de llegada aparte', async () => {
    const actor = { id: '' };
    const client = scripted([
      () => [use('move_to', { character_id: actor.id, target_spot_id: null, target_location_id: 'loc_curandera', pace: 'walk' })],
      () => [closing('Cruzas el callejón y entras. Ilse te mira desde el caldero.')],
    ]);
    const { engine, c } = await brezal({ deterministic: false, client });
    actor.id = c.id;
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    const from = lastSeq(engine);
    await engine.act(c.id, 'voy a la curandera a preguntarle si me puede seguir');
    await engine.act(c.id, 'inventario');
    expect(engine.world.spot(c.location.id).location_id).toBe('loc_curandera');
    expect(said(engine, c, from).map((e) => e.action_type)).toEqual(['master']);
  });
});
