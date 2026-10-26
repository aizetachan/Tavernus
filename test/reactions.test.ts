import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { parseReaction, readsAsAccept, REACTION_TTL_MS } from '../src/engine/reactions.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Lo que recibe cada PJ, con el evento. */
function collect(engine: Engine) {
  const by = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { by.set(d.character_id, [...(by.get(d.character_id) ?? []), d]); });
  return (id: string) => by.get(id) ?? [];
}

/** Kael y Mira juntos junto al pozo de la plaza, conectados. */
async function together(opts: { rng?: number } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, opts.rng === undefined ? {} : { rng: seededRng(opts.rng) });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  kael.location = { type: 'spot', id: 'sp_pl_pozo' };
  mira.location = { type: 'spot', id: 'sp_pl_pozo' };
  for (const c of [kael, mira]) engine.setConnected(c.id, true);
  return { engine, time, kael, mira, seen: collect(engine) };
}

/** Un máster que falla el test si lo llaman. */
const noMaster: MasterLike = { resolve: () => { throw new Error('no debería llamar al máster'); } };

describe('detectar lo que un PJ le hace a otro', () => {
  it('agarrar y llevárselo, empujar, atacar; con el nombre tras «a» y en la misma frase', async () => {
    const { engine, kael } = await together();
    const w = engine.world;
    const drag = parseReaction(w, kael, 'Agarro a Mira del brazo y la llevo a la taberna para tomarnos una cerveza');
    expect(drag).toMatchObject({ kind: 'grapple', target: { id: 'ch_mira' } });
    expect(drag!.dest_spot_id).toBeTruthy();
    expect(drag!.attempt).toMatch(/^agarrarte y llevarte a/);
    expect(parseReaction(w, kael, 'empujo a Mira al suelo')).toMatchObject({ kind: 'shove', prone: true, attempt: 'tirarte al suelo de un empujón' });
    expect(parseReaction(w, kael, 'le doy un puñetazo a Mira')).toMatchObject({ kind: 'attack', attempt: 'atacarte' });
    expect(parseReaction(w, kael, 'ataco a Mira con la daga')).toMatchObject({ kind: 'attack' });
    expect(parseReaction(w, kael, 'cojo la jarra y se la doy a Mira')).toBeNull();
    expect(parseReaction(w, kael, 'ataco al lobo con Mira')).toBeNull();
    expect(parseReaction(w, kael, 'miro a Mira')).toBeNull();
    expect(parseReaction(w, kael, 'agarro a Brenna')).toBeNull(); // un NPC no decide: va al máster
  });

  it('lo que se lee como un sí', () => {
    expect(readsAsAccept('Vale, vamos')).toBe(true);
    expect(readsAsAccept('sí')).toBe(true);
    expect(readsAsAccept('Ni lo sueñes')).toBe(false);
  });
});

describe('petición, respuesta y resolución', () => {
  it('la petición le llega al afectado con quién, qué y lo que escribió; quien actúa espera y no hace otra cosa', async () => {
    const { engine, kael, mira, seen } = await together();
    engine.attachMaster(noMaster);
    const r = await engine.act(kael.id, 'agarro a Mira y la llevo a la taberna para tomarnos una cerveza');
    expect(r.ok).toBe(true);
    expect(r.event!.action_type).toBe('reaction_request');
    expect(r.text).toContain('Mira decide si se deja o se resiste');
    const req = mira.reactions![0]!;
    expect(req).toMatchObject({ from_id: kael.id, to_id: mira.id, kind: 'grapple' });
    const got = seen(mira.id).at(-1)!;
    expect(got.event.action_type).toBe('reaction_request');
    expect(got.text).toContain('Kael intenta agarrarte y llevarte a');
    expect(got.text).toContain('«agarro a Mira y la llevo a la taberna para tomarnos una cerveza»');
    expect(got.text).toContain('¿Te dejas o te resistes?');
    // Quien actúa espera: otra acción se le rechaza con «Esperando a que Mira decida…».
    const again = await engine.act(kael.id, 'miro alrededor');
    expect(again.ok).toBe(false);
    expect(again.text).toMatch(/Esperando a que Mira decida \(quedan 1:30\)/);
  });

  it('dejarse: sin tirada, y se van los dos a la taberna; la narración llega a ambos', async () => {
    const { engine, kael, mira, seen } = await together();
    await engine.act(kael.id, 'agarro a Mira y la llevo a la taberna para tomarnos una cerveza');
    const id = mira.reactions![0]!.id;
    const r = await engine.answerReaction(mira.id, id, 'accept');
    expect(r.ok).toBe(true);
    expect(r.event!.action_type).toBe('reaction_accepted');
    expect(r.text).toMatch(/^Te dejas\. Kael consigue agarrarte y llevarte a/);
    expect(r.text).not.toMatch(/Tirada|d20/);
    expect(mira.reactions).toBeUndefined();
    // Los dos acaban en el mismo sitio, el destino.
    expect(engine.world.characterSpot(mira)!.id).toBe(engine.world.characterSpot(kael)!.id);
    expect(engine.world.characterSpot(mira)!.id).not.toBe('sp_pl_pozo');
    // Kael lo lee (y después llega la escena de llegada, como tras cualquier viaje).
    const toKael = seen(kael.id).find((d) => d.event.action_type === 'reaction_accepted')!;
    expect(toKael.text).toMatch(/^Mira se deja\. Os vais juntos a/);
    // Y ya puede actuar otra vez.
    expect((await engine.act(kael.id, 'miro alrededor')).text).not.toMatch(/Esperando/);
  });

  it('resistirse: tirada enfrentada (Atletismo contra el mejor de Atletismo o Acrobacias); el empate lo pierde quien actúa', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { engine, kael, mira, seen } = await together({ rng: seed });
      await engine.act(kael.id, 'agarro a Mira');
      const r = await engine.answerReaction(mira.id, mira.reactions![0]!.id, 'resist');
      expect(r.event!.action_type).toBe('reaction_resisted');
      expect(r.text).toMatch(/^Te resistes\. Tirada enfrentada: tu (Atletismo|Acrobacias) d20 \[\d+\]/);
      expect(r.text).toMatch(/contra su Atletismo d20/);
      const won = r.event!.payload['reaction'] as { success: boolean };
      // Gana el que actúa solo si su total es mayor; si gana, Mira queda agarrada.
      expect(mira.conditions.some((c) => c.name === 'agarrado')).toBe(won.success);
      expect(r.text).toContain(won.success ? 'Kael consigue agarrarte' : 'Kael no consigue agarrarte');
      expect(seen(kael.id).at(-1)!.text).toContain(won.success ? 'ganas tú' : 'gana Mira');
    }
  });

  it('responder con sus palabras: un «vale» es dejarse; lo demás, resistirse con lo dicho', async () => {
    const { engine, kael, mira, seen } = await together();
    await engine.act(kael.id, 'empujo a Mira');
    const r = await engine.answerReaction(mira.id, mira.reactions![0]!.id, null, 'Ni se te ocurra, me agarro al brocal');
    expect(r.event!.action_type).toBe('reaction_resisted');
    expect(seen(kael.id).at(-1)!.text).toContain('Mira se resiste. «Ni se te ocurra, me agarro al brocal».');
    await engine.act(kael.id, 'empujo a Mira');
    const r2 = await engine.answerReaction(mira.id, mira.reactions![0]!.id, null, 'vale, vale');
    expect(r2.event!.action_type).toBe('reaction_accepted');
  });

  it('atacar: dejarse impacta sin tirada de ataque; defenderse es la tirada contra la CA', async () => {
    const { engine, kael, mira } = await together({ rng: 7 });
    const hp = mira.hp_current;
    await engine.act(kael.id, 'ataco a Mira con la daga');
    expect(mira.reactions![0]!.kind).toBe('attack');
    expect(mira.hp_current).toBe(hp); // nada hasta que decida
    const r = await engine.answerReaction(mira.id, mira.reactions![0]!.id, 'accept');
    expect(r.text).toMatch(/^Te dejas\. Te alcanza sin tirada: \d+ de daño/);
    expect(mira.hp_current).toBeLessThan(hp);
    await engine.act(kael.id, 'ataco a Mira');
    const d = await engine.answerReaction(mira.id, mira.reactions![0]!.id, 'resist');
    expect(d.text).toMatch(/Su ataque con daga: d20 \[\d+\] \+ \d+ = \d+ contra tu CA \d+/);
  });

  it('solo una vez: la segunda respuesta ya no vale', async () => {
    const { engine, kael, mira } = await together();
    await engine.act(kael.id, 'agarro a Mira');
    const id = mira.reactions![0]!.id;
    const [a, b] = await Promise.all([engine.answerReaction(mira.id, id, 'accept'), engine.answerReaction(mira.id, id, 'resist')]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(engine.events.all().filter((e) => e.action_type.startsWith('reaction_') && e.action_type !== 'reaction_request')).toHaveLength(1);
  });

  it('si quien actuaba se ha ido de la sala, se cancela sin efecto', async () => {
    const { engine, kael, mira } = await together();
    await engine.act(kael.id, 'agarro a Mira');
    const id = mira.reactions![0]!.id;
    kael.location = { type: 'spot', id: 'sp_tab_barra' };
    const r = await engine.answerReaction(mira.id, id, 'accept');
    expect(r.event!.action_type).toBe('reaction_cancelled');
    expect(mira.conditions.some((c) => c.name === 'agarrado')).toBe(false);
  });
});

describe('tiempo límite y quien no puede decidir', () => {
  it('si no responde en 90 s, se resiste por instinto (tirada enfrentada) y se avisa a los dos', async () => {
    const { engine, time, kael, mira, seen } = await together();
    await engine.act(kael.id, 'agarro a Mira');
    time.advanceReal(REACTION_TTL_MS / 1000 - 1);
    await engine.tick();
    await engine.settle();
    expect(mira.reactions).toHaveLength(1); // aún no
    time.advanceReal(2);
    await engine.tick();
    await engine.settle();
    expect(mira.reactions).toBeUndefined();
    expect(seen(mira.id).at(-1)!.text).toMatch(/^No respondes a tiempo: te resistes por instinto\. Tirada enfrentada/);
    expect(seen(kael.id).at(-1)!.text).toMatch(/^Mira no responde a tiempo: se resiste por instinto\./);
    // Responder tarde ya no vale.
    expect((await engine.answerReaction(mira.id, 'rx_lo_que_sea', 'accept')).ok).toBe(false);
  });

  it('ausente: se resiste por instinto en el acto, sin hacer esperar', async () => {
    const { engine, kael, mira, seen } = await together();
    engine.setAway(mira.id, true);
    await engine.act(kael.id, 'empujo a Mira al suelo');
    await engine.settle();
    expect(mira.reactions).toBeUndefined();
    expect(seen(kael.id).at(-1)!.text).toMatch(/Mira no está \(su jugador se ha ido\): se resiste por instinto/);
  });

  it('bajo el velo no se le puede tocar; a quien duerme se le hace sin tirada', async () => {
    const { engine, kael, mira } = await together();
    mira.veiled = true;
    const v = await engine.act(kael.id, 'agarro a Mira');
    expect(v.ok).toBe(false);
    expect(v.text).toContain('bajo el velo');
    mira.veiled = false;
    mira.status = 'asleep';
    await engine.act(kael.id, 'agarro a Mira');
    await engine.settle();
    expect(mira.conditions.some((c) => c.name === 'agarrado')).toBe(true);
  });

  it('si quien espera se va de la partida, la petición se retira', async () => {
    const { engine, kael, mira } = await together();
    await engine.act(kael.id, 'agarro a Mira');
    engine.setAway(kael.id, true);
    expect(mira.reactions).toBeUndefined();
  });
});

describe('con máster', () => {
  it('request_reaction deja la petición pedida, sin resolver, y sale tras la narración del máster', async () => {
    const { engine, kael, mira, seen } = await together();
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [], action_text: 'cojo a Mira de la mano y me la llevo a bailar' };
    const out = JSON.parse(executeTool(ctx, 'request_reaction', { target_character_id: mira.id, kind: 'grapple', attempt: 'cogerte de la mano y llevarte a bailar', destination_spot_id: null, actor_skill: null, target_skills: null }));
    expect(out).toMatchObject({ ok: true, pending_reaction: true });
    expect(mira.reactions![0]).toMatchObject({ kind: 'grapple', attempt: 'cogerte de la mano y llevarte a bailar' });
    expect(seen(mira.id).some((d) => d.event.action_type === 'reaction_request')).toBe(false); // aún no: tras la narración
    // Un ataque del actor a otro jugador tampoco se resuelve: se convierte en petición.
    const { engine: e2, kael: k2, mira: m2 } = await together();
    const hp = m2.hp_current;
    const atk = JSON.parse(executeTool({ ...ctx, engine: e2, actor: k2 }, 'attack', { attacker_id: k2.id, target_id: m2.id, advantage: 'none' }));
    expect(atk).toMatchObject({ pending_reaction: true });
    expect(m2.hp_current).toBe(hp);
    // Ni moverle por su cuenta.
    expect(JSON.parse(executeTool(ctx, 'move_to', { character_id: mira.id, target_spot_id: 'sp_pl_porton', target_location_id: null, pace: 'walk' }))).toMatchObject({ error: 'other_player' });
    // El contexto del máster lo dice a los dos lados.
    expect(actionContext(engine, mira, 'mirar')).toContain('Kael intenta cogerte de la mano y llevarte a bailar');
  });

  it('el desenlace lo narra el máster como tras una tirada, con lo que decidió el otro y lo ya aplicado', async () => {
    const { engine, kael, mira, seen } = await together();
    const calls: { text: string; roll?: { result: { label: string; breakdown: string; success: boolean | null } } }[] = [];
    engine.attachMaster({
      resolve: async (_c, text, roll) => {
        calls.push({ text, ...(roll ? { roll } : {}) });
        return { ok: true, closed: { narration_private: 'Mira se deja llevar entre risas hasta la taberna.', observable: 'Kael se lleva a Mira hacia la taberna.', observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null }, usage: {}, calls: [], context: '', model: 'test' };
      },
    });
    const r = await engine.act(kael.id, 'agarro a Mira y la llevo a la taberna');
    expect(r.event!.action_type).toBe('reaction_request'); // sin máster: lo detectó el motor
    expect(calls).toHaveLength(0);
    await engine.answerReaction(mira.id, mira.reactions![0]!.id, 'accept');
    // Una llamada con el desenlace (luego, la llegada a la taberna, como tras cualquier viaje).
    expect(calls.filter((c) => c.roll)).toHaveLength(1);
    expect(calls[0]!.roll!.result.label).toBe('Reacción de Mira');
    expect(calls[0]!.roll!.result.breakdown).toContain('Mira se deja. Sin tirada.');
    expect(calls[0]!.roll!.result.breakdown).toContain('Ya aplicado por el servidor');
    // Mira lee la decisión y la narración del máster como testigo.
    const toMira = seen(mira.id).map((d) => d.event.action_type);
    expect(toMira).toContain('reaction_accepted');
    expect(toMira).toContain('master_roll_outcome');
  });
});
