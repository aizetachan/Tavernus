import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { toMessage } from '../src/adapters/web/server.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { maskUnknownNames } from '../src/engine/narrate.js';
import { perceive } from '../src/engine/perception.js';
import { positionOf } from '../src/engine/movement.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Máster falso: Brenna contesta con una línea. Apunta las llamadas. */
function fakeMaster(engine: Engine, opts: { to?: string } = {}) {
  const calls: string[] = [];
  const m: MasterLike = {
    async resolve(actor, text) {
      calls.push(`${actor.id}: ${text}`);
      // Como el cierre real (tools.ts, npc_id): Brenna pasa a hablar con el actor.
      engine.world.npc('npc_brenna').talking_to = { character_id: actor.id, since_game_s: engine.gameNow() };
      return {
        ok: true, usage: {}, calls: [], context: '', model: 'falso',
        closed: { narration_private: `«${text}», le dices. Brenna seca un vaso. «Poca cosa.»`, observable: `${actor.name} le habla a Brenna en la barra.`, observable_vague: 'Alguien habla en la barra.', loudness: 1, tags: ['social'], suggested_actions: [], requires_roll: null, npc_id: 'npc_brenna', lines: [{ speaker: 'actor', text }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Poca cosa. El pueblo anda callado.', ...(opts.to ? { to: opts.to } : {}) }] },
      };
    },
  };
  engine.attachMaster(m);
  return calls;
}

/** Kael habla con Brenna en la barra; Mira llega a la misma barra. Conectados. */
async function bar(opts: { to?: string } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time);
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  const calls = fakeMaster(engine, opts);
  const got: Delivery[] = [];
  engine.onDelivery((d) => got.push(d));
  const to = (id: string) => got.filter((d) => d.character_id === id);
  return { engine, time, kael, mira, calls, to };
}

describe('1. los PJ se conocen siempre por su nombre', () => {
  it('migra al abrir: dos PJ que no se conocían, se conocen', async () => {
    const seed = makeSeed();
    for (const c of seed.characters) c.knows = c.knows.filter((id) => !id.startsWith('ch_'));
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed, now: fakeTime().now, deterministic: false });
    expect(engine.world.character('ch_kael').knows).toContain('ch_mira');
    expect(engine.world.character('ch_mira').knows).toContain('ch_kael');
  });

  it('nunca se enmascara a otro PJ por su descriptor (narración, contexto)', async () => {
    const { engine, kael, mira } = await bar();
    mira.knows = [];
    expect(maskUnknownNames(engine.world, mira.id, 'Kael se acerca a Brenna.')).toBe('Kael se acerca a la tabernera.');
    expect(actionContext(engine, mira, 'mirar')).toContain('Kael [ch_kael], humano guerrero');
    void kael;
  });
});

describe('2a. sin estilo indirecto duplicado', () => {
  it('quien está en la charla (Brenna le habla también a Mira) lee la frase literal sin «le habla a la tabernera»', async () => {
    const { engine, kael, mira, to } = await bar({ to: 'all' });
    await engine.act(kael.id, '¿Cómo estás, Brenna? ¿Qué se cuenta el pueblo?');
    const d = to(mira.id).at(-1)!;
    const m = toMessage(d, engine);
    expect(m.lines?.map((l) => [l.speaker, l.text, l.to])).toEqual([['pc', '¿Cómo estás, Brenna? ¿Qué se cuenta el pueblo?', undefined], ['npc', 'Poca cosa. El pueblo anda callado.', 'todos']]);
    expect(m.prose ?? '').not.toContain('le habla');
  });

  it('quien no está en la charla solo lee el aviso de una línea, sin las frases', async () => {
    const { engine, kael, mira, to } = await bar();
    await engine.act(kael.id, '¿Cómo estás, Brenna? ¿Qué se cuenta el pueblo?');
    const m = toMessage(to(mira.id).at(-1)!, engine);
    expect(m.notice?.text).toBe('Kael le habla a Brenna en la barra');
    expect(m.lines).toBeUndefined();
  });
});

describe('2b. esperar o unirse con sus palabras: el botón, sin máster ni gesto repetido', () => {
  it('«Esperar a que la tabernera termine con el elfo» es esperar turno; volver a dirigirse a ella recuerda que espera', async () => {
    const { engine, kael, mira, calls } = await bar();
    await engine.act(kael.id, 'Hola, Brenna');
    const r = await engine.act(mira.id, 'Esperar a que la tabernera termine con el elfo');
    expect(r.event!.action_type).toBe('npc_wait');
    expect(calls).toHaveLength(1);
    const again = await engine.act(mira.id, 'Preguntar a la tabernera por la cerveza');
    expect(again.text).toBe('Sigues esperando tu turno con Brenna.');
    expect(engine.events.all().filter((e) => e.action_type === 'npc_busy')).toHaveLength(0);
    // Sin nadie ocupado, «esperar» sigue siendo el esperar de siempre.
    const solo = await bootEngine(fakeTime());
    fakeMaster(solo.engine);
    expect((await solo.engine.act('ch_mira', 'esperar un rato')).event?.action_type).not.toBe('npc_wait');
  });

  it('«Unirme a ellos» es unirse; el máster no sugiere esperar ni unirse con el NPC ocupado', async () => {
    const { engine, kael, mira } = await bar();
    await engine.act(kael.id, 'Hola, Brenna');
    expect((await engine.act(mira.id, 'Unirme a ellos')).event!.action_type).toBe('npc_join');
    const other = await bootEngine(fakeTime());
    const e = other.engine;
    fakeMaster(e);
    e.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    await e.act('ch_kael', 'Hola, Brenna');
    const actor = e.world.character('ch_mira');
    const ctx: ToolContext = { engine: e, actor, nowGameS: e.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    executeTool(ctx, 'log_event', { narration_private: 'Miras la barra.', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: 'Esperar a que la tabernera termine | Unirme a la charla | Pedir una jarra', lines: null });
    expect(ctx.closed!.suggested_actions).toEqual(['Pedir una jarra']);
  });
});

describe('2c. el que habla recibe un aviso corto', () => {
  it('«Mira espera a que Brenna termine», como aviso de sistema, no burbuja del narrador', async () => {
    const { engine, kael, mira, to } = await bar();
    await engine.act(kael.id, 'Hola, Brenna');
    await engine.act(mira.id, 'Preguntar a Brenna por la cerveza');
    const d = to(kael.id).at(-1)!;
    expect(d.text).toBe('Mira espera a que Brenna termine.');
    const m = toMessage(d, engine);
    expect(m.kind).toBe('system');
    expect(m.narrator).toBeUndefined();
  });
});

describe('2d-2e. quien espera ve que hablan, no lo que dicen', () => {
  it('en el mismo punto: el aviso de una línea y «Unirme» siempre, sin las frases; también el segundo intercambio; al acabar, «ya puede atenderte»', async () => {
    const { engine, kael, mira, to } = await bar();
    await engine.act(kael.id, 'Hola, Brenna');
    await engine.act(mira.id, 'Esperar turno con Brenna');
    await engine.act(kael.id, '¿Y el regidor?');
    const heard = to(mira.id).filter((d) => d.event.action_type === 'master');
    expect(heard).toHaveLength(2);
    const m = toMessage(heard[1]!, engine);
    expect(m.notice?.text).toBe('Kael le habla a Brenna en la barra');
    expect(m.join).toEqual({ npc: 'npc_brenna', label: 'Unirme a la conversación con Brenna' });
    expect(m.lines).toBeUndefined();
    // El máster sabe quién escucha.
    expect(actionContext(engine, kael, 'seguir hablando')).toContain('## Quién oye al actor\nMira (lo oye todo)');
    await engine.act(kael.id, 'dejar la conversación');
    expect(to(mira.id).at(-1)!.text).toBe('Brenna ya puede atenderte.');
  });

  it('en otro punto del local, el aviso según lo que percibe, con «Unirme»', async () => {
    const { engine, kael, mira, to } = await bar();
    // Un punto desde el que Mira oye a medias la barra (si no lo hay, el local se vuelve más ruidoso).
    const spots = engine.world.spotsOf('loc_taberna').filter((s) => s.id !== 'sp_tab_barra');
    const tryVague = () => spots.find((s) => {
      mira.location = { type: 'spot', id: s.id };
      return perceive(engine.world, engine.clock, mira, positionOf(engine.world, kael, engine.gameNow()), engine.gameNow(), 1).sound === 'vague';
    });
    let spot = tryVague();
    for (let noise = 0.5; !spot && noise < 0.98; noise += 0.05) { engine.world.location('loc_taberna').ambience.noise = noise; spot = tryVague(); }
    expect(spot).toBeTruthy();
    await engine.act(kael.id, 'Hola, Brenna, ¿qué se cuenta el pueblo?');
    const m = toMessage(to(mira.id).at(-1)!, engine);
    // Le ve hablar (la vista llega entera aunque el oído no): el aviso, nunca trozos de lo que se dice.
    expect(m.notice?.text).toBe('Kael le habla a Brenna en la barra');
    expect(m.join?.npc).toBe('npc_brenna');
    expect(m.lines).toBeUndefined();
  });
});
