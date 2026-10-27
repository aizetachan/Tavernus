/**
 * Imágenes fuera de sitio en «La noche del Brezal» (partida del 27-10-2026,
 * Leodhin, mago, solo), con los eventos reales (brezal.events.jsonl, seq entre
 * paréntesis) y los prompts que salieron (images/index.json). Revisión:
 * Obsidian, «Revisión partida 2026-10-27», sección 5 y plan E.
 */
import { describe, expect, it } from 'vitest';
import { entityOf } from '../src/ai/illustrate.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { classifyMoments, momentLookupOf, type Moment } from '../src/engine/moments.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import { claimSituation } from '../src/worldgen/index.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function partida(): Promise<{ engine: Engine; leodhin: Character }> {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false });
  const r = await engine.createCharacter('u_leodhin', 'Leodhin', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return { engine, leodhin: r.character };
}

const call = (name: string, input: Record<string, unknown>, result: unknown = { ok: true }) => ({ name, input, result: JSON.stringify(result) });

function ev(actor: Character, over: Partial<GameEvent> & { calls?: ReturnType<typeof call>[] }): GameEvent {
  const { calls = [], ...rest } = over;
  return {
    id: 'ev_x', seq: 1, timestamp_real_ms: 0, timestamp_game_s: 0, campaign_id: 'brezal', location_id: 'loc_plaza', spot_id: 'sp_pl_pozo',
    actor_id: actor.id, action_type: 'master', input_text: null, narration_private: '', observable: null, visibility: 'location', tags: [],
    delivered_to: [], ...rest, payload: { master: { model: 'claude-haiku-5-5', usage: {}, calls, context: '' }, ...(rest.payload ?? {}) },
  };
}

/** Momentos y, para cada uno, el prompt que saldría (null si no se ilustra). */
function moments(engine: Engine, e: GameEvent, seen: string[] = []): { m: Moment; prompt: string | null }[] {
  return classifyMoments(e, new Set(seen), momentLookupOf(engine.world)).map((m) => ({ m, prompt: entityOf(engine, m, e)?.prompt ?? null }));
}

describe('descubrimientos: lo hallado, no el sitio', () => {
  it('el cubo con ceniza (seq 51): en primer plano, la plaza solo de fondo y al final, sin la narración', async () => {
    const { engine, leodhin } = await partida();
    const e = ev(leodhin, {
      id: 'ev_0000001f', action_type: 'master_roll_outcome', input_text: 'saca agua del pozo yu mirala de cerca',
      narration_private: 'El agua sale turbia y tibia contra la mano. Bajo la luz de la torre, el poso gris no es barro: es ceniza fina, de grano igual.',
      observable: 'Leodhin inclina el cubo hacia la luz y se queda mirando el poso gris con el ceño fruncido.',
      calls: [call('grant_clue', { character_id: leodhin.id, clue_id: 'clue_pozo' }, { ok: true, events: ['Pista: Ceniza en el agua del pozo (2/11).'] })],
    });
    const out = moments(engine, e);
    expect(out.map((x) => x.m.kind)).toEqual(['discovery']);
    const p = out[0]!.prompt!;
    // Antes: «Plaza del Pozo (exterior). Leodhin inclina el cubo…».
    expect(p.startsWith('Close-up of un cubo de madera con agua turbia y un poso de ceniza gris')).toBe(true);
    expect(p).not.toMatch(/^Plaza del Pozo/);
    expect(p).not.toContain('Leodhin');
    expect(p).toMatch(/blurred background: Plaza del Pozo \(exterior\)\. no text, no watermark$/);
  });

  it('sin `image` en los datos, el título de la pista', async () => {
    const { engine, leodhin } = await partida();
    const clue = engine.world.campaign.clues.find((c) => c.id === 'clue_pozo')!;
    delete clue.image;
    const e = ev(leodhin, { calls: [call('grant_clue', { character_id: leodhin.id, clue_id: 'clue_pozo' })] });
    expect(moments(engine, e)[0]!.prompt!.startsWith('Close-up of Ceniza en el agua del pozo.')).toBe(true);
  });

  it('un punto oculto: el punto de cerca, aunque te lo enseñe alguien hablando', async () => {
    const { engine, leodhin } = await partida();
    const e = ev(leodhin, {
      location_id: 'loc_taberna', spot_id: 'sp_tab_mesa', payload: { npc_id: 'npc_brenna' },
      calls: [call('discover_spot', { character_id: leodhin.id, spot_id: 'sp_tab_trampilla' })],
    });
    const disc = moments(engine, e).find((x) => x.m.kind === 'discovery')!;
    expect(disc.m.subject).toBe('sp_tab_trampilla');
    expect(disc.prompt!.startsWith('Close-up of la trampilla: Una trampilla bajo la alfombra')).toBe(true);
    expect(disc.prompt).toContain('blurred background: Taberna del Jabalí (interior)');
  });
});

describe('pistas que se oyen: el retrato de quien habla o nada', () => {
  it('Ilse cuenta la Brasa (seq 23): su retrato, no un descubrimiento con la plaza', async () => {
    const { engine, leodhin } = await partida();
    const e = ev(leodhin, {
      id: 'ev_0000000n', action_type: 'master_roll_outcome', input_text: 'Preguntarle a Ilse qué es la Brasa', payload: { npc_id: 'npc_ilse' },
      narration_private: '«¿Qué es la Brasa?» Ilse suelta la muñeca, pero no la carta. Se inclina sobre el brocal y habla tan bajo que el agua del cubo parece callar con ella.',
      calls: [call('grant_clue', { character_id: leodhin.id, clue_id: 'clue_ilse' }, { ok: true, events: ['Pista: La Brasa de Vharn (1/11).'] })],
    });
    expect(moments(engine, e).map((x) => x.m.kind)).toEqual(['portrait']);
    // Ya tenía su retrato (seq 18): nada.
    expect(moments(engine, e, [`portrait:${leodhin.id}:npc_ilse`])).toEqual([]);
  });

  it('Hugo habla de la cadena (seq 65): su retrato y ningún descubrimiento', async () => {
    const { engine, leodhin } = await partida();
    const e = ev(leodhin, {
      id: 'ev_0000001t', location_id: 'loc_taberna', spot_id: 'sp_tab_barra', input_text: 'Preguntar al herrero por la cadena de su maestro', payload: { npc_id: 'npc_hugo' },
      narration_private: 'Hugo deja de secarse las manos en el mandil y te mira un rato largo antes de hablar.',
      calls: [call('grant_clue', { character_id: leodhin.id, clue_id: 'clue_hugo' }, { ok: true, events: ['Pista: La cadena de hierro frío (3/11).'] })],
    });
    const out = moments(engine, e);
    expect(out.map((x) => [x.m.kind, x.m.entity_id])).toEqual([['portrait', 'npc_hugo']]);
    expect(out[0]!.prompt).toMatch(/^Portrait of Hugo, herrero/);
  });

  it('una pista que dice qué se ve sigue siendo hallazgo aunque llegue hablando', async () => {
    const { engine, leodhin } = await partida();
    const e = ev(leodhin, { payload: { npc_id: 'npc_ilse' }, calls: [call('grant_clue', { character_id: leodhin.id, clue_id: 'clue_pozo' })] });
    expect(moments(engine, e).map((x) => x.m.kind)).toEqual(['portrait', 'discovery']);
  });
});

describe('combate: el rival es siempre el otro', () => {
  const hugoHits = (leodhin: Character, result: Record<string, unknown>) => ev(leodhin, {
    id: 'ev_00000022', action_type: 'master_roll_outcome', location_id: 'loc_taberna', spot_id: 'sp_tab_barra', input_text: 'luchar con hugo', payload: { npc_id: 'npc_hugo' },
    calls: [call('attack', { attacker_id: 'npc_hugo', target_id: leodhin.id, advantage: 'none' }, { attacker: 'Hugo', target: 'Leodhin', hit: true, damage: 5, ...result })],
  });

  it('Hugo golpea a Leodhin (seq 74): Leodhin contra Hugo, no contra sí mismo', async () => {
    const { engine, leodhin } = await partida();
    const out = moments(engine, hugoHits(leodhin, {}), [`portrait:${leodhin.id}:npc_hugo`]);
    expect(out.map((x) => x.m)).toEqual([{ kind: 'combat', key: `combat:${leodhin.id}:npc_hugo`, character_id: leodhin.id, entity_id: 'ev_00000022', subject: 'npc_hugo' }]);
    // Antes: «Leodhin (humano mago) fighting Leodhin, humano mago:».
    expect(out[0]!.prompt).toContain('Leodhin (humano mago) fighting Hugo, herrero');
    expect(out[0]!.prompt).not.toContain('fighting Leodhin');
  });

  it('el primer golpe de Leodhin a Hugo (seq 73) ya dio la imagen de la pareja: el de Hugo no repite', async () => {
    const { engine, leodhin } = await partida();
    const first = ev(leodhin, { id: 'ev_00000021', action_type: 'roll', location_id: 'loc_taberna', payload: { attack: { target_id: 'npc_hugo', hit: true, down: false, dead: false, damage: 3 } } });
    const [m] = classifyMoments(first, new Set(), momentLookupOf(engine.world));
    expect(m!.key).toBe(`combat:${leodhin.id}:npc_hugo`);
    expect(moments(engine, hugoHits(leodhin, {}), [m!.key, `portrait:${leodhin.id}:npc_hugo`])).toEqual([]);
  });

  it('si Hugo tumba a Leodhin, la caída es contra Hugo; y Leodhin mata a Hugo (seq 87), también', async () => {
    const { engine, leodhin } = await partida();
    const down = moments(engine, hugoHits(leodhin, { target_down: true }), [`portrait:${leodhin.id}:npc_hugo`]);
    expect(down.map((x) => [x.m.key, x.m.subject])).toEqual([['combat:ev_00000022', 'npc_hugo']]);
    const kill = ev(leodhin, { id: 'ev_0000002f', action_type: 'roll', location_id: 'loc_taberna', payload: { attack: { target_id: 'npc_hugo', hit: true, down: true, dead: true, damage: 5 } } });
    expect(moments(engine, kill).map((x) => [x.m.key, x.m.subject])).toEqual([['combat:ev_0000002f', 'npc_hugo']]);
  });

  it('daño al PJ sin nadie que lo dé (una trampa): ningún combate', async () => {
    const { engine, leodhin } = await partida();
    const e = ev(leodhin, { calls: [call('apply_damage', { target_id: leodhin.id, amount: 3 }, { ok: true, status: 'unconscious' })] });
    expect(moments(engine, e)).toEqual([]);
  });

  it('un momento viejo con el propio PJ de rival ya no se pinta', async () => {
    const { engine, leodhin } = await partida();
    const e = ev(leodhin, { id: 'ev_00000022', location_id: 'loc_taberna' });
    const old: Moment = { kind: 'combat', key: `combat:${leodhin.id}:${leodhin.id}`, character_id: leodhin.id, entity_id: e.id, subject: leodhin.id };
    expect(entityOf(engine, old, e)).toBeNull();
  });
});

describe('servicios y consumibles abstractos: no son un objeto en la mano', () => {
  it('la noche de posada (seq 96) no se pinta; la jarra de cerveza sí', async () => {
    const { engine, leodhin } = await partida();
    const buy = (item_id: string) => ev(leodhin, {
      location_id: 'loc_taberna', spot_id: 'sp_tab_barra', payload: { npc_id: 'npc_brenna' },
      calls: [call('buy_item', { character_id: leodhin.id, npc_id: 'npc_brenna', item_id, quantity: 1 }, { ok: true, total: 100 })],
    });
    const seen = [`portrait:${leodhin.id}:npc_brenna`];
    expect(moments(engine, buy('it_noche_posada'), seen)).toEqual([]);
    const beer = moments(engine, buy('it_cerveza'), seen);
    expect(beer.map((x) => x.m.entity_id)).toEqual(['it_cerveza']);
    expect(beer[0]!.prompt).toContain('held in a hand');
    // Aunque llegue un momento suyo (de una partida vieja), no hay imagen.
    expect(entityOf(engine, { kind: 'item', key: 'item:x:it_noche_posada', character_id: leodhin.id, entity_id: 'it_noche_posada' }, buy('it_noche_posada'))).toBeNull();
  });

  it('lo decide el dato: `illustrate: false` lo apaga, `illustrate: true` enciende un servicio', async () => {
    const { engine, leodhin } = await partida();
    const take = (item_id: string) => ev(leodhin, { action_type: 'take', payload: { item_id } });
    engine.world.itemDefs.get('it_cerveza')!.illustrate = false;
    expect(moments(engine, take('it_cerveza'))).toEqual([]);
    engine.world.itemDefs.get('it_noche_posada')!.illustrate = true;
    expect(moments(engine, take('it_noche_posada')).map((x) => x.m.kind)).toEqual(['item']);
  });
});
