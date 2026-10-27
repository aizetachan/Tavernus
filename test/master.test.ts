import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Master, type MasterClient } from '../src/ai/master.js';
import { MASTER_TOOLS } from '../src/ai/tools.js';
import { systemPrompt } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import type { Delivery } from '../src/engine/events.js';
import { moveTo } from '../src/engine/movement.js';
import { bootEngine, fakeTime } from './helpers.js';

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function msg(content: Anthropic.Beta.BetaContentBlock[], stop: Anthropic.Beta.BetaStopReason = 'tool_use'): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
const use = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Anthropic.Beta.BetaToolUseBlock => ({ type: 'tool_use', id, name, input });
const text = (t: string): Anthropic.Beta.BetaTextBlock => ({ type: 'text', text: t, citations: null } as Anthropic.Beta.BetaTextBlock);

const logEvent = (priv: string, obs: string | null, extra: Record<string, unknown> = {}) => use('log_event', {
  narration_private: priv, observable: obs, observable_vague: obs ? 'Una figura hace algo.' : null, loudness: 1, tags: 'exploration',
  suggested_actions: 'Mirar detrás de la barra | Hablar con Brenna', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null,
  ...extra,
});

/** Cliente falso: devuelve respuestas en orden y guarda las peticiones. */
function fakeClient(script: (Anthropic.Beta.BetaMessage | Error)[]) {
  const requests: Params[] = [];
  const client: MasterClient = {
    async create(p) {
      requests.push(structuredClone(p));
      const next = script.shift();
      if (!next) throw new Error('script agotado');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, requests };
}

function collect(engine: Awaited<ReturnType<typeof bootEngine>>['engine']) {
  const out = new Map<string, string[]>();
  engine.onDelivery((d: Delivery) => out.set(d.character_id, [...(out.get(d.character_id) ?? []), d.text]));
  return (id: string) => out.get(id) ?? [];
}

describe('Master', () => {
  it('lee con tools, cierra con log_event y el evento llega a cada uno según percepción', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_mesa' };
    const seen = collect(engine);
    const { client, requests } = fakeClient([
      msg([use('get_location', { location_id: 'here' }), use('who_is_here', { unused: null })]),
      msg([logEvent('Brenna te mira por encima de la jarra que seca. «¿Qué va a ser?»', 'Kael se acoda en la barra y le dice algo a Brenna.')]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(1) }));

    const r = await engine.act('ch_kael', 'Me acerco a Brenna y le pido una cerveza');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('¿Qué va a ser?');
    expect(r.suggested_actions).toEqual(['Mirar detrás de la barra', 'Hablar con Brenna']);
    expect(seen('ch_kael').at(-1)).toContain('¿Qué va a ser?');
    expect(seen('ch_mira').at(-1)).toBe('Kael se acoda en la barra y le dice algo a Brenna.');

    // Petición: sistema cacheado, tools completos, contexto con la acción.
    const p = requests[0]!;
    expect(p.model).toBe('claude-haiku-5-5');
    expect((p.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(p.tools).toHaveLength(MASTER_TOOLS.length);
    expect(p.messages[0]!.content).toContain('«Me acerco a Brenna y le pido una cerveza»');
    expect(p.messages[0]!.content).toContain('Brenna [npc_brenna]');
    expect(p.messages[0]!.content).toContain('Mira [ch_mira]');
    // Segunda petición: lleva los resultados de los dos tools.
    const second = requests[1]!.messages;
    expect(second).toHaveLength(3);
    const results = second[2]!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((x) => x.tool_use_id)).toEqual(['tu_get_location', 'tu_who_is_here']);
    expect(JSON.parse(results[0]!.content as string).name).toBe('Taberna del Jabalí');
    // El evento guarda uso y llamadas para el panel.
    const m = r.event!.payload['master'] as { usage: { iterations: number; cache_read: number }; calls: { name: string }[] };
    expect(m.usage.iterations).toBe(2);
    expect(m.usage.cache_read).toBe(1600);
    expect(m.calls.map((c) => c.name)).toEqual(['get_location', 'who_is_here', 'log_event']);
  });

  it('acción con riesgo: requires_roll → botón → tirada del servidor → segunda llamada con el resultado', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const seen = collect(engine);
    const { client, requests } = fakeClient([
      msg([logEvent('Te agachas ante la trampilla y metes la ganzúa.', 'Kael se agacha junto a la mesa del fondo.', { requires_roll_kind: 'skill', requires_roll_key: 'sleight_of_hand', requires_roll_dc: 12, requires_roll_advantage: 'none' })]),
      msg([use('update_spot_state', { spot_id: 'sp_tab_mesa', patch_json: '{"trapdoor_open": true}' }), logEvent('La cerradura cede con un chasquido.', 'Se oye un chasquido junto a la mesa del fondo.')]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(5) }));

    const r = await engine.act('ch_kael', 'fuerzo la cerradura de la trampilla');
    expect(r.ok).toBe(true);
    expect(r.requires_roll).toEqual({ kind: 'skill', key: 'sleight_of_hand', dc: 12, advantage: 'none' });
    expect(engine.pendingRoll('ch_kael')).not.toBeNull();
    expect(r.event!.payload['requires_roll']).toBeDefined();

    const r2 = await engine.rollPending('ch_kael');
    expect(r2.ok).toBe(true);
    expect(r2.text).toBe('La cerradura cede con un chasquido.');
    expect(engine.pendingRoll('ch_kael')).toBeNull();
    expect(engine.world.spot('sp_tab_mesa').state['trapdoor_open']).toBe(true);
    // El actor vio la tirada; la segunda llamada llevó el resultado y no la acción cruda.
    expect(seen('ch_kael').some((t) => t.startsWith('🎲 Juego de manos: d20 ['))).toBe(true);
    expect(requests[1]!.messages[0]!.content).toContain('## Resultado de la tirada');
    expect(requests[1]!.messages[0]!.content).toContain('«fuerzo la cerradura de la trampilla»');
    expect(await engine.rollPending('ch_kael')).toMatchObject({ ok: false });
  });

  it('una acción nueva anula la tirada pendiente', async () => {
    const { engine } = await bootEngine();
    const { client } = fakeClient([
      msg([logEvent('Apuntas.', null, { requires_roll_kind: 'attack', requires_roll_key: 'ranged', requires_roll_dc: 13, requires_roll_advantage: 'none', requires_roll_target: 'npc_brenna' })]),
      msg([logEvent('Bajas el arco.', null)]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    await engine.act('ch_kael', 'disparo al barril');
    expect(engine.pendingRoll('ch_kael')).not.toBeNull();
    await engine.act('ch_kael', 'mejor no, bajo el arco');
    expect(engine.pendingRoll('ch_kael')).toBeNull();
  });

  it('el master mueve con move_to y el mundo lo refleja', async () => {
    const { engine } = await bootEngine();
    const { client } = fakeClient([
      msg([use('move_to', { character_id: 'ch_kael', target_spot_id: 'sp_pl_pozo', pace: 'walk' })]),
      msg([logEvent('Sales al fresco de la plaza.', 'Kael sale de la taberna hacia el pozo.')]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    const r = await engine.act('ch_kael', 'salgo a la plaza, hacia el pozo');
    expect(r.ok).toBe(true);
    // Viaje rápido: al acabar la acción ya está en el pozo.
    expect(engine.world.character('ch_kael').location.id).toBe('sp_pl_pozo');
  });

  it('si termina sin log_event, el texto vale como narración privada y queda marcado', async () => {
    const { engine } = await bootEngine();
    const { client } = fakeClient([msg([text('Brenna se encoge de hombros.')], 'end_turn')]);
    engine.attachMaster(new Master(engine, { client }));
    const r = await engine.act('ch_kael', 'le pregunto por el incendio');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Brenna se encoge de hombros.');
    expect(r.event!.tags).toContain('no_log_event');
    expect(r.event!.observable).toBeNull();
  });

  it('si la API falla, responde el parser plano; los verbos mecánicos nunca llaman al master', async () => {
    const { engine } = await bootEngine();
    const { client, requests } = fakeClient([new Error('ECONNRESET')]);
    engine.attachMaster(new Master(engine, { client }));
    const r = await engine.act('ch_kael', 'mirar');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Taberna del Jabalí');
    expect(requests).toHaveLength(1);
    const inv = await engine.act('ch_kael', 'inventario');
    expect(inv.text).toContain('Manos:');
    expect(requests).toHaveLength(1);
  });

  it('un rechazo del modelo se comunica en ficción', async () => {
    const { engine } = await bootEngine();
    const { client } = fakeClient([msg([], 'refusal')]);
    engine.attachMaster(new Master(engine, { client }));
    const r = await engine.act('ch_kael', 'hago algo horrible');
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/prefiere no seguir/);
  });

  it('un tool que falla devuelve el error al master, no rompe el bucle', async () => {
    const { engine } = await bootEngine();
    const { client, requests } = fakeClient([
      msg([use('move_to', { character_id: 'ch_kael', target_spot_id: 'sp_tab_trampilla', pace: 'walk' })]),
      msg([logEvent('No ves ninguna trampilla.', null)]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    const r = await engine.act('ch_kael', 'bajo por la trampilla');
    expect(r.ok).toBe(true);
    const res = (requests[1]!.messages[2]!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!;
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('unknown_spot');
  });

  it('el prompt de sistema es estable entre acciones (cacheable)', async () => {
    const { engine } = await bootEngine();
    const a = systemPrompt(engine.world.campaign);
    await engine.act('ch_kael', 'inventario');
    expect(systemPrompt(engine.world.campaign)).toBe(a);
    expect(a).not.toMatch(/\d{2}:\d{2}/);
    expect(a).toContain('el Narrador');
  });
});

describe('primera escena', () => {
  it('al crear un personaje con master, la llegada la narra el master con el origen del punto de inicio', async () => {
    const { engine } = await bootEngine();
    const seen = collect(engine);
    // Primero el prólogo (una llamada sin tools; docs/PROLOGO.md), luego la primera escena.
    const prologue = `${'El frío baja de la montaña y Brezal cierra pronto. '.repeat(14)}Ana acaba de llegar.`;
    const { client, requests } = fakeClient([
      msg([{ type: 'text', text: prologue, citations: null }], 'end_turn'),
      msg([logEvent('Bajas al claro con el estómago vacío. Junto al roble, alguien ha dejado un hacha clavada en un tocón reciente.', 'Una figura baja por el sendero.')]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    const r = await engine.createCharacter('discord:1', 'Ana');
    if (!r.ok) throw new Error(r.reason);
    // Sin intro aún: el evento de llegada no le dice nada al actor (la intro lo sustituye).
    expect(seen(r.character.id)).toEqual([]);
    const intro = await engine.introduce(r.character.id);
    expect(intro?.ok).toBe(true);
    expect(intro!.event!.action_type).toBe('master_intro');
    expect(seen(r.character.id).at(-1)).toContain('Bajas al claro');
    expect(seen(r.character.id)[0]).toBe(prologue);
    expect(requests[0]!.tools).toBeUndefined();
    expect(requests[0]!.messages[0]!.content as string).toMatch(/^## Prólogo/);
    const ctx = requests[1]!.messages[0]!.content as string;
    expect(ctx).toContain('## Primera escena');
    expect(ctx).toContain('Acaba de leer este prólogo');
    expect(ctx).toContain('Ha pasado la noche en el bosque de Fresnos');
    expect(ctx).not.toContain('## Acción del jugador');
  });
});

describe('memoria y cola de conversación de NPC', () => {
  it('el master apunta lo que el NPC recordaría; el prompt se lo devuelve la próxima vez; se olvida según importancia', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const { client, requests } = fakeClient([
      msg([logEvent('Brenna asiente.', 'Kael habla con Brenna.', { npc_id: 'npc_brenna', npc_memory_note: 'Kael preguntó por el incendio de Vharn y dijo venir del sur.', npc_memory_importance: 2 })]),
      msg([logEvent('Brenna te sirve.', null, { npc_id: 'npc_brenna', npc_memory_note: 'Pidió una cerveza.', npc_memory_importance: 1 })]),
      msg([logEvent('Brenna te mira.', null)]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    await engine.act('ch_kael', 'pregunto a Brenna por el incendio');
    const brenna = engine.world.npc('npc_brenna');
    expect(brenna.memory).toHaveLength(1);
    expect(brenna.talking_to?.character_id).toBe('ch_kael');
    await engine.act('ch_kael', 'pido una cerveza');
    expect(brenna.memory).toHaveLength(2);
    // Tercera acción: el contexto lleva los dos recuerdos.
    await engine.act('ch_kael', 'la miro');
    const ctx = requests[2]!.messages[0]!.content as string;
    expect(ctx).toContain('Recuerda de Kael: Kael preguntó por el incendio de Vharn y dijo venir del sur. · Pidió una cerveza.');
    expect(ctx).toContain('NUNCA lo reveles ni lo insinúes por tu cuenta): Estuvo en Vharn');
    // Pasan 4 días de juego: la de importancia 1 se olvida, la de 2 sigue.
    time.advanceGame(4 * 24 * 3600);
    await engine.tick();
    expect(brenna.memory.map((m) => m.importance)).toEqual([2]);
    expect(brenna.talking_to).toBeNull(); // la conversación caducó
  });

  it('un NPC ocupado con otro no llama al máster para el segundo: gesto y «Esperar turno» / «Unirme» (scene.ts)', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    const { client, requests } = fakeClient([
      msg([logEvent('Brenna te atiende. «¿Qué te pongo?»', 'Kael habla con Brenna.', { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué te pongo?' }] })]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    await engine.act('ch_kael', 'hablo con Brenna');
    const r = await engine.act('ch_mira', 'hablo con Brenna');
    expect(requests).toHaveLength(1);
    expect(r.text).toBe('Brenna está con Kael; te hace un gesto para que esperes.');
  });
});

describe('nombres: los PJ se conocen siempre; los NPC, cuando se aprenden', () => {
  it('entre PJ, el nombre desde que coinciden en la partida; presentarse queda para los NPC', async () => {
    const { engine } = await bootEngine();
    const seen = collect(engine);
    const r = await engine.createCharacter('u9', 'Tamsin'); // conoce a los PJ de la partida desde que entra
    if (!r.ok) throw new Error(r.reason);
    const tam = r.character; // en el claro (menos poblado)
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_sendero' };
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_cl_sendero' };
    const { client, requests } = fakeClient([
      msg([logEvent('Levantas la mano.', 'Tamsin levanta la mano hacia los dos.', { introduces_self: false })]),
      msg([logEvent('Te presentas.', 'Tamsin dice: «Me llamo Tamsin». El viento mueve las hojas del sendero.', { introduces_self: true, names_learned: 'ch_kael' })]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    await engine.act(tam.id, 'saludo con la mano');
    expect(seen('ch_kael').at(-1)).toBe('Tamsin levanta la mano hacia los dos.');
    expect(tam.knows).toEqual(expect.arrayContaining(['ch_kael', 'ch_mira']));
    // En el contexto, Kael aparece por su nombre, sin «no sabe su nombre».
    expect(requests[0]!.messages[0]!.content as string).toContain('Kael [ch_kael], humano guerrero');
    expect(requests[0]!.messages[0]!.content as string).not.toContain('NO sabe su nombre, que es Kael');
    await engine.act(tam.id, 'me presento: soy Tamsin');
    expect(engine.world.character('ch_kael').knows).toContain(tam.id);
    expect(engine.world.character('ch_mira').knows).toContain(tam.id);
    expect(tam.knows).toContain('ch_kael');
    expect(seen('ch_kael').at(-1)).toBe('Tamsin dice: «Me llamo Tamsin». El viento mueve las hojas del sendero.');
  });
});

describe('llegada narrada', () => {
  it('al llegar al destino, el master sitúa al personaje con nuevas acciones', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const seen = collect(engine);
    // Un paseo que se espera (el motor lo pone en camino): la llegada la narra el master en su escena.
    const kael = engine.world.character('ch_kael');
    const { client, requests } = fakeClient([
      msg([logEvent('La mesa del fondo: un cofre cerrado y una vela apagada.', null, { suggested_actions: 'Abrir el cofre | Encender la vela' })]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    moveTo(engine.world, kael.id, 'sp_tab_mesa', 'walk', engine.gameNow());
    time.advanceGame(30);
    await engine.tick();
    // La cola de la localización procesa la llegada; esperamos a que termine.
    await engine.act('ch_kael', 'inventario');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages[0]!.content as string).toContain('## Llegada');
    expect(seen('ch_kael')).toContain('La mesa del fondo: un cofre cerrado y una vela apagada.');
    expect(seen('ch_kael')).not.toContain('Llegas a la mesa del fondo.');
    const ev = engine.events.all().find((e) => e.action_type === 'master_arrival');
    expect(ev?.payload['suggested_actions']).toEqual(['Abrir el cofre', 'Encender la vela']);
  });

  it('con move_to el actor llega en el acto: lo que pide allí sale en la misma acción, sin otra escena de llegada', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const seen = collect(engine);
    const { client, requests } = fakeClient([
      msg([use('move_to', { character_id: 'ch_kael', target_spot_id: 'sp_tab_mesa', pace: 'walk' })]),
      msg([logEvent('Cruzas la sala hasta la mesa del fondo: un cofre cerrado y una vela apagada.', 'Kael se dirige a la mesa del fondo.')]),
    ]);
    engine.attachMaster(new Master(engine, { client }));
    await engine.act('ch_kael', 'voy a la mesa del fondo a ver qué hay');
    const kael = engine.world.character('ch_kael');
    expect(kael.transit).toBeNull();
    expect(kael.location.id).toBe('sp_tab_mesa');
    // El resultado de move_to le dice al master que ya está allí y qué hay.
    const second = requests[1]!.messages.at(-1)!.content as { type: string; content?: string }[];
    const result = JSON.parse(second.find((b) => b.type === 'tool_result')!.content!) as Record<string, unknown>;
    expect(result['arrived']).toBe(true);
    await engine.act('ch_kael', 'inventario');
    expect(requests).toHaveLength(2);
    expect(engine.events.all().some((e) => e.action_type === 'master_arrival')).toBe(false);
    expect(seen('ch_kael')).toContain('Cruzas la sala hasta la mesa del fondo: un cofre cerrado y una vela apagada.');
  });
});


describe('combate', () => {
  it('el ataque del jugador: requires_roll con objetivo → el servidor tira contra la CA, aplica daño y el master narra', async () => {
    const { engine } = await bootEngine();
    const seen = collect(engine);
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_arroyo' };
    const { client, requests } = fakeClient([
      msg([logEvent('Levantas la daga.', 'Kael se lanza contra el lobo.', { requires_roll_kind: 'attack', requires_roll_key: 'melee', requires_roll_dc: null, requires_roll_advantage: 'none', requires_roll_target: 'npc_lobo' })]),
      msg([logEvent('El lobo retrocede.', 'Kael hiere al lobo.')]),
      // El lobo, hostil, hace su turno aunque el máster no le haga atacar: el servidor lo resuelve y pide contarlo (combat.ts).
      msg([logEvent('El lobo retrocede y vuelve a por ti.', 'Kael hiere al lobo.')]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: seededRng(2) }));
    const r = await engine.act('ch_kael', 'ataco al lobo con la daga');
    expect(r.requires_roll?.target).toBe('npc_lobo');
    const r2 = await engine.rollPending('ch_kael');
    expect(r2.ok).toBe(true);
    const turn = requests[2]!.messages.at(-1)!.content as { type: string; content?: string }[];
    expect(turn.find((b) => b.type === 'tool_result')!.content).toMatch(/Turno de los NPC hostiles/);
    const ctx = requests[1]!.messages[0]!.content as string;
    expect(ctx).toContain('ataque con daga a un lobo gris');
    const wolf = engine.world.npc('npc_lobo');
    const hit = ctx.includes('El daño ya está aplicado');
    if (hit) expect(wolf.stats!.hp).toBeLessThan(11); else expect(wolf.stats!.hp).toBe(11);
    expect(seen('ch_kael').some((t) => t.startsWith('🎲 Ataque con daga'))).toBe(true);
    expect(wolf.attitude.by_character['ch_kael']).toBe('hostile');
  });

  it('el NPC ataca con el tool attack; a 0 PG el PJ cae inconsciente', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_cl_arroyo' };
    kael.hp_current = 10; // un crítico máximo (18) deja 8 de sobra: cae, no muere en el acto (daño masivo)
    const { client } = fakeClient([
      msg([use('attack', { attacker_id: 'npc_lobo', target_id: 'ch_kael', advantage: 'none' })]),
      msg([logEvent('El lobo salta.', 'El lobo salta sobre Kael.')]),
    ]);
    const always20 = () => 0.999; // siempre impacta
    engine.attachMaster(new Master(engine, { client, rng: always20 }));
    const r = await engine.act('ch_kael', 'me acerco al lobo');
    expect(r.ok).toBe(true);
    expect(kael.hp_current).toBe(0);
    expect(kael.status).toBe('unconscious');
  });

  it('ventana decisiva: si el jugador no responde en 60 s, la amenaza se ejecuta; si responde rápido, tiene ventaja', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    kael.location = { type: 'spot', id: 'sp_cl_arroyo' };
    const { client, requests } = fakeClient([
      msg([logEvent('El lobo se agazapa para saltar.', 'El lobo se agazapa.', { decisive_threat: 'el lobo te salta al cuello', decisive_npc_id: 'npc_lobo' })]),
      // Expira: el master ejecuta la amenaza.
      msg([use('attack', { attacker_id: 'npc_lobo', target_id: 'ch_kael', advantage: 'none' })]),
      msg([logEvent('Te muerde.', 'El lobo muerde a Kael.')]),
      // Segunda ventana y respuesta rápida con tirada.
      msg([logEvent('Vuelve a la carga.', null, { decisive_threat: 'otro salto', decisive_npc_id: 'npc_lobo' })]),
      msg([logEvent('Golpeas.', null, { requires_roll_kind: 'attack', requires_roll_key: 'melee', requires_roll_dc: null, requires_roll_advantage: 'none', requires_roll_target: 'npc_lobo' })]),
    ]);
    engine.attachMaster(new Master(engine, { client, rng: () => 0.5 })); // d20 = 11: impacta sin crítico
    await engine.act('ch_kael', 'miro al lobo');
    expect(kael.decisive?.threat).toBe('el lobo te salta al cuello');
    time.advanceReal(61);
    await engine.tick();
    await engine.act('ch_kael', 'inventario'); // vacía la cola
    expect(kael.decisive).toBeNull();
    expect(requests[1]!.messages[0]!.content as string).toContain('## Ventana decisiva expirada');
    expect(kael.hp_current).toBeLessThan(12);
    await engine.act('ch_kael', 'me preparo');
    expect(kael.decisive).not.toBeNull();
    time.advanceReal(5);
    const r = await engine.act('ch_kael', 'le clavo la daga');
    expect(requests[4]!.messages[0]!.content as string).toContain('RÁPIDA');
    expect(r.requires_roll?.advantage).toBe('advantage');
    expect(kael.decisive).toBeNull();
  });
});
