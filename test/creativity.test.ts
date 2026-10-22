import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionContext, systemPrompt } from '../src/ai/prompt.js';
import { executeTool, MASTER_TOOLS, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine } from '../src/engine/engine.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { JsonFileRepository } from '../src/persistence/jsonfile.js';
import { DEFAULT_LAWS, worldLaws } from '../src/engine/laws.js';
import { allRumors, RUMORS_PER_DAY, RUMOR_LIFETIME_DAYS } from '../src/engine/rumors.js';
import { characterFacts, FACTS_PER_DAY } from '../src/engine/facts.js';
import type { Engine as EngineT } from '../src/engine/engine.js';
import { judge, runCreativity, type CreativityBench } from '../scripts/creativity-bench.js';
import type { StepRecord } from '../scripts/model-bench.js';
import { bootEngine, fakeTime } from './helpers.js';

const ctxFor = (engine: EngineT, text = 'Busco el tesoro de la croqueta dorada.'): ToolContext => ({
  engine, actor: engine.world.character('ch_kael'), nowGameS: engine.gameNow(), rng: seededRng(1), closed: null, rolls: [], progress: [], action_text: text,
});
const plant = (ctx: ToolContext, name: string, extra: Record<string, unknown> = {}) =>
  JSON.parse(executeTool(ctx, 'plant_rumor', { kind: 'item', name, hint: 'un tesoro que nadie ha visto, escondido por un cocinero loco', where: 'más allá del portón norte', ...extra })) as Record<string, unknown>;
const section = (ctx: string, title: string) => ctx.split(/\n\n(?=## )/).find((s) => s.startsWith(`## ${title}`)) ?? '';

describe('plant_rumor', () => {
  it('crea un rumor con procedencia, sin crear puntos ni objetos', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_barra' };
    const spots = engine.world.spots.size;
    const items = engine.world.itemInstances.size;
    const r = plant(ctxFor(engine), 'el tesoro de la croqueta dorada');
    expect(r).toMatchObject({ ok: true, existing: false, left_today: RUMORS_PER_DAY - 1 });
    const [rm] = allRumors(engine.world);
    expect(rm).toMatchObject({
      kind: 'item', name: 'el tesoro de la croqueta dorada', where: 'más allá del portón norte', location_id: 'loc_taberna', status: 'open', mentions: 1,
      origin: { actor_id: 'ch_kael', location_id: 'loc_taberna', action: 'Busco el tesoro de la croqueta dorada.', game_s: engine.gameNow() },
    });
    expect(rm!.expires_game_s - rm!.origin.game_s).toBe(RUMOR_LIFETIME_DAYS * 86400);
    expect(engine.world.spots.size).toBe(spots);
    expect(engine.world.itemInstances.size).toBe(items);
  });

  it('valida la entrada', async () => {
    const { engine } = await bootEngine();
    expect(plant(ctxFor(engine), 'algo', { kind: 'dragon' })['error']).toMatch(/kind/);
    expect(plant(ctxFor(engine), '  ')['error']).toMatch(/name vacío/);
    expect(plant(ctxFor(engine), 'algo', { hint: '' })['error']).toMatch(/hint vacío/);
    expect(allRumors(engine.world)).toHaveLength(0);
  });

  it('respeta el presupuesto por personaje y día de juego; retomar uno no gasta', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    for (let i = 0; i < RUMORS_PER_DAY; i++) expect(plant(ctxFor(engine), `rumor ${i}`)['ok']).toBe(true);
    expect(plant(ctxFor(engine), 'uno de más')['error']).toMatch(/presupuesto agotado/);
    // El mismo nombre (con otra grafía) retoma el que corre, suma mención y no gasta.
    const again = plant(ctxFor(engine), 'RUMOR 0');
    expect(again).toMatchObject({ ok: true, existing: true, mentions: 2, left_today: 0 });
    expect(allRumors(engine.world)).toHaveLength(RUMORS_PER_DAY);
    // Otro personaje tiene su propio presupuesto.
    const other: ToolContext = { ...ctxFor(engine), actor: engine.world.character('ch_mira') };
    expect(plant(other, 'otra cosa')['ok']).toBe(true);
    // Al día siguiente de juego vuelve a haber presupuesto.
    time.advanceGame(24 * 3600);
    expect(plant(ctxFor(engine), 'rumor nuevo')['ok']).toBe(true);
  });

  it('aparece en el contexto del lugar, y en el del actor cuando está en otro sitio', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    expect(section(actionContext(engine, kael, 'miro'), 'Rumores')).toContain('Ninguno corre por aquí');
    plant(ctxFor(engine), 'el tesoro de la croqueta dorada');
    const here = section(actionContext(engine, kael, 'miro'), 'Rumores');
    expect(here).toContain(`quedan ${RUMORS_PER_DAY - 1} de ${RUMORS_PER_DAY}`);
    const lines = here.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^- «el tesoro de la croqueta dorada» \(objeto\): se dice que un tesoro .+\. Dónde, según dicen: más allá del portón norte\. \[rm_\w+\]$/);

    kael.location = { type: 'spot', id: 'sp_pl_pozo' };
    const plaza = section(actionContext(engine, kael, 'miro'), 'Rumores');
    expect(plaza).toContain('Ninguno corre por aquí');
    expect(plaza).toContain('De otros sitios, que Kael ya conoce:');
    expect(plaza).toMatch(/croqueta dorada.+\(en Taberna del Jabalí\)/);
  });

  it('caduca a los días y deja de salir', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    plant(ctxFor(engine), 'el tesoro de la croqueta dorada');
    time.advanceGame((RUMOR_LIFETIME_DAYS + 1) * 86400);
    expect(section(actionContext(engine, kael, 'miro'), 'Rumores')).not.toContain('croqueta');
  });

  it('persiste con la campaña', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-'));
    try {
      const time = fakeTime();
      const engine = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', seed: makeSeed(), now: time.now });
      plant(ctxFor(engine), 'el tesoro de la croqueta dorada');
      await engine.flush();
      const engine2 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now });
      expect(allRumors(engine2.world).map((r) => r.name)).toEqual(['el tesoro de la croqueta dorada']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('el máster lo tiene entre sus tools', () => {
    const t = MASTER_TOOLS.find((x) => x.name === 'plant_rumor');
    expect(Object.keys(t!.input_schema.properties ?? {})).toEqual(['kind', 'name', 'hint', 'where', 'said_by_actor']);
  });

  it('lo que afirma el jugador queda como «lo dice», sin confirmar, y gasta del mismo presupuesto', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    const r = plant(ctxFor(engine, 'Le digo a Brenna que oí que en el pozo hay un pasadizo.'), 'el pasadizo del pozo', { kind: 'place', hint: 'baja desde el pozo de la plaza hasta la montaña', where: 'el pozo de la plaza', said_by_actor: true });
    expect(r).toMatchObject({ ok: true, left_today: RUMORS_PER_DAY - 1 });
    expect(String(r['note'])).toContain('Es lo que dice Kael');
    expect(allRumors(engine.world)[0]!.said_by).toEqual({ id: 'ch_kael', name: 'Kael' });
    expect(section(actionContext(engine, kael, 'miro'), 'Rumores')).toMatch(/«el pasadizo del pozo» \(lugar\): lo dice Kael, sin confirmar: baja desde el pozo/);
    // Sin said_by_actor es habladuría del mundo.
    plant(ctxFor(engine), 'la croqueta dorada');
    expect(allRumors(engine.world)[1]!.said_by).toBeNull();
  });
});

describe('record_character_fact', () => {
  const fact = (ctx: ToolContext, text: string, kind = 'background') => JSON.parse(executeTool(ctx, 'record_character_fact', { kind, text })) as Record<string, unknown>;

  it('guarda el hecho en el personaje con procedencia, sale en su contexto y en get_character, y persiste', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-'));
    try {
      const time = fakeTime();
      const engine = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', seed: makeSeed(), now: time.now });
      const kael = engine.world.character('ch_kael');
      kael.location = { type: 'spot', id: 'sp_tab_barra' };
      const said = 'Le cuento a Brenna que mi padre era herrero en la capital.';
      const r = fact(ctxFor(engine, said), 'Su padre era herrero en la capital y le enseñó a juzgar el acero');
      expect(r).toMatchObject({ ok: true, existing: false });
      expect(characterFacts(kael)).toEqual([expect.objectContaining({ kind: 'background', text: 'Su padre era herrero en la capital y le enseñó a juzgar el acero', action: said, game_s: engine.gameNow() })]);
      // Repetirlo no lo duplica; no crea objetos ni toca el mundo compartido.
      expect(fact(ctxFor(engine), 'su padre era herrero en la capital y le enseñó a juzgar el acero.')).toMatchObject({ ok: true, existing: true });
      expect(characterFacts(kael)).toHaveLength(1);
      expect(allRumors(engine.world)).toHaveLength(0);

      const actorBlock = section(actionContext(engine, kael, 'miro'), 'Actor');
      expect(actorBlock).toContain('Ha contado de sí (verdad para su personaje, no para el mundo; record_character_fact): Su padre era herrero en la capital y le enseñó a juzgar el acero.');
      const sheet = JSON.parse(executeTool(ctxFor(engine), 'get_character', { character_id: 'ch_kael' })) as { facts: string[] };
      expect(sheet.facts).toEqual(['Su padre era herrero en la capital y le enseñó a juzgar el acero']);
      // De otro personaje no se ven.
      const mira = JSON.parse(executeTool(ctxFor(engine), 'get_character', { character_id: 'ch_mira' })) as Record<string, unknown>;
      expect(mira['facts']).toBeUndefined();

      await engine.flush();
      const engine2 = await Engine.boot({ repo: new JsonFileRepository(dir), campaignId: 'demo', now: time.now });
      expect(characterFacts(engine2.world.character('ch_kael')).map((f) => f.text)).toEqual(['Su padre era herrero en la capital y le enseñó a juzgar el acero']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('valida y pone tope diario', async () => {
    const { engine } = await bootEngine();
    expect(fact(ctxFor(engine), 'algo', 'superpoder')['error']).toMatch(/kind/);
    expect(fact(ctxFor(engine), '')['error']).toMatch(/text vacío/);
    for (let i = 0; i < FACTS_PER_DAY; i++) expect(fact(ctxFor(engine), `recuerdo ${i}`, 'memory')['ok']).toBe(true);
    expect(fact(ctxFor(engine), 'uno más', 'memory')['error']).toMatch(/hoy/);
  });
});

describe('leyes del mundo y prompt', () => {
  it('sin campaign.laws valen las de fantasía SRD; con ellas, las de la campaña', async () => {
    const { engine } = await bootEngine();
    const camp = engine.world.campaign;
    expect(worldLaws(camp)).toBe(DEFAULT_LAWS);
    const sp = systemPrompt(camp);
    expect(sp).toContain(`LEYES DEL MUNDO: ${DEFAULT_LAWS.join(' ')}`);
    expect(sp).toMatch(/Nadie vuela por sí mismo/);
    (camp as typeof camp & { laws: string[] }).laws = ['Aquí todo el mundo vuela los martes.'];
    expect(systemPrompt(camp)).toContain('LEYES DEL MUNDO: Aquí todo el mundo vuela los martes.');
  });

  it('el prompt trae el tono ante lo imposible y los tres casos fuera de los datos, sin perder el principio rector', async () => {
    const { engine } = await bootEngine();
    const sp = systemPrompt(engine.world.campaign);
    expect(sp).toContain('PRINCIPIO RECTOR: la base de datos es la verdad.');
    expect(sp).toContain('nunca lo despaches con un «no puedes»');
    expect(sp).toContain('Un rumor (plant_rumor) es algo que se dice, nunca algo que está');
    expect(sp).toMatch(/FUERA DE LOS DATOS, tres casos: \(a\) imposible .+\(b\) Plausible pero desconocido .+plant_rumor.+a quién preguntar.+\(c\) Ambiguo .+pregunta/);
    expect(sp).toMatch(/INVENTIVA DEL JUGADOR: .+record_character_fact.+plant_rumor con said_by_actor=true.+pide una tirada o pon un coste.+se rechaza con ingenio/);
  });
});

describe('banco de creatividad', () => {
  const bench = JSON.parse(readFileSync('scripts/creativity-bench.json', 'utf8')) as CreativityBench;

  it('25 prompts con criterio, incluidos los dos del dueño y la inventiva del jugador', () => {
    expect(bench.prompts).toHaveLength(25);
    expect(new Set(bench.prompts.map((p) => p.expect))).toEqual(new Set(['witty_refusal', 'rumor', 'question', 'in_fiction', 'character_fact', 'player_rumor', 'conditional']));
    expect(new Set(bench.prompts.map((p) => p.id)).size).toBe(25);
    expect(bench.prompts.map((p) => p.text)).toEqual(expect.arrayContaining(['Me pongo la capa de Superman y salgo volando.', 'Busco el tesoro de la croqueta dorada.']));
  });

  it('en dry-run pasa por el motor y el máster de verdad: siembra los rumores y cumple los criterios', async () => {
    const run = await runCreativity({ bench, model: 'claude-haiku-5-5', effort: 'low', dryRun: true });
    expect(run.totals.pass).toBe(25);
    expect(run.results.find((r) => r.expect === 'character_fact')!.facts[0]!.result).toMatch(/"ok":true/);
    expect(run.results.find((r) => r.expect === 'player_rumor')!.rumors[0]!.said_by_actor).toBe(true);
    expect(run.results.find((r) => r.expect === 'conditional')!.requested_roll).toMatchObject({ key: 'deception' });
    const croqueta = run.results.find((r) => r.text.includes('croqueta'))!;
    expect(croqueta.tools).toEqual(['plant_rumor', 'log_event']);
    expect(croqueta.rumors[0]!.result).toMatch(/"ok":true/);
  }, 30_000);

  it('el juez suspende la negativa seca, el rumor que falta y la cuarta pared', () => {
    const step = (narration: string, tools: { name: string; result?: string }[] = [], extra: Partial<StepRecord> = {}): StepRecord => ({
      id: 'x', kind: 'x', text: 'x', expect_roll: false, models: [], iterations: 1, tools: tools.map((t) => t.name), input: 0, output: 0, cache_read: 0, cache_write: 0, ms: 0, cost_usd: 0,
      narration, suggested_actions: [], requested_roll: null, rolls: [], failures: 0, engine_text: '',
      calls: [{ kind: 'action', ok: true, reason: null, message: null, model: 'm', iterations: 1, tools: tools.map((t) => t.name), tool_calls: tools.map((t) => ({ name: t.name, input: {}, result: t.result ?? '{"ok":true}' })), usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, ms: 0, cost_usd: 0, narration, suggested_actions: [], requires_roll: null }],
      ...extra,
    });
    const witty = 'Te anudas la capa al cuello con solemnidad, saltas desde la mesa y aterrizas de bruces entre las jarras.';
    expect(judge('witty_refusal', step(witty, [{ name: 'log_event' }])).pass).toBe(true);
    expect(judge('witty_refusal', step('No puedes volar. Eres humano y aquí no hay magia de esa.', [{ name: 'log_event' }])).notes.join()).toMatch(/negativa seca/);
    expect(judge('rumor', step('Nadie ha oído hablar de eso.', [{ name: 'log_event' }])).pass).toBe(false);
    expect(judge('rumor', step('Algo se dice.', [{ name: 'plant_rumor', result: '{"error":"presupuesto agotado"}' }, { name: 'log_event' }])).pass).toBe(false);
    expect(judge('question', step('¿Qué quieres hacer, y con qué?', [{ name: 'log_event' }])).pass).toBe(true);
    expect(judge('question', step('¿Seguro?', [{ name: 'move_to' }, { name: 'log_event' }])).pass).toBe(false);
    expect(judge('in_fiction', step('Como IA no puedo decirte eso.', [{ name: 'log_event' }])).pass).toBe(false);
    expect(judge('in_fiction', step('Brenna sigue secando jarras.', [{ name: 'spawn_item' }, { name: 'log_event' }])).pass).toBe(false);
    expect(judge('character_fact', step('Brenna asiente.', [{ name: 'log_event' }])).pass).toBe(false);
    expect(judge('player_rumor', step('Brenna arquea una ceja.', [{ name: 'plant_rumor' }, { name: 'log_event' }])).notes.join()).toMatch(/sin said_by_actor/);
    expect(judge('witty_refusal', step(witty, [{ name: 'record_character_fact' }, { name: 'log_event' }])).notes.join()).toMatch(/hecho algo imposible/);
    expect(judge('conditional', step('Brenna te sirve la botella sin rechistar, faltaría más.', [{ name: 'buy_item' }, { name: 'log_event' }])).pass).toBe(false);
    expect(judge('conditional', step('Brenna cruza los brazos y te mide con la mirada.', [{ name: 'log_event' }], { requested_roll: { kind: 'skill', key: 'deception' } })).pass).toBe(true);
  });
});
