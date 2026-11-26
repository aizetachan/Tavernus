/**
 * Arreglo 35 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete H; patrón 5 de docs/ANALISIS-PARTIDAS-2026-11-26.md):
 * las respuestas rápidas del motor, sin máster, contestan a lo que se les dice o no salen. Los casos son los de las
 * tandas 4 y 5 (`data/local/autoplay/20261126-0418`, `-0442` y `-0602`).
 */
import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import type { Engine, MasterLike } from '../src/engine/engine.js';
import { Engine as EngineClass } from '../src/engine/engine.js';
import { TRADES } from '../src/engine/extras.js';
import { extraReply } from '../src/engine/extratalk.js';
import type { Character } from '../src/engine/model.js';
import { parseWake } from '../src/engine/rest.js';
import { callsByName, dashForNpc, npcTarget } from '../src/engine/scene.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { bootEngine, fakeTime } from './helpers.js';

// ---------------------------------------------------------------------------
// «Garrán está con Bruno; te hace un gesto para que esperes» cuando la pregunta va al compañero
// ---------------------------------------------------------------------------

/** Máster falso: apunta quién llega y contesta con una línea de Brenna a quien hable. */
function fakeMaster(engine: Engine) {
  const calls: { actor: string; text: string }[] = [];
  const m: MasterLike = {
    async resolve(actor, text) {
      calls.push({ actor: actor.id, text });
      void actionContext(engine, actor, text);
      return {
        ok: true, usage: {}, calls: [], context: '', model: 'falso',
        closed: { narration_private: 'Kael se encoge de hombros.', observable: null, observable_vague: null, loudness: 1, tags: ['social'], suggested_actions: [], requires_roll: null },
      };
    },
  };
  engine.attachMaster(m);
  return calls;
}

/** Kael habla con Brenna en la barra; Mira, su compañera, está al lado. */
async function bar() {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { groupWindowMs: 150, roundMs: 150, turnWindowMs: 0 });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  const calls = fakeMaster(engine);
  engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: '«¿Qué hay?»', observable: null, payload: { npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué hay?' }] } });
  engine.world.npc('npc_brenna').talking_to = { character_id: kael.id, since_game_s: engine.gameNow() };
  return { engine, kael, mira, calls };
}

describe('arreglo 35: el NPC ocupado con el compañero no se traga lo que va al compañero', () => {
  it('callsByName: llamar a alguien no es nombrarle de pasada', () => {
    expect(callsByName('Oye Bruno, ¿cuántas monedas de plata vale una antorcha?', 'Bruno')).toBe(true);
    expect(callsByName('¿Cuánto oro vale una antorcha, Bruno? Y si tiro los dados para convencer a Garrán, ¿eso cómo va?', 'Bruno')).toBe(true);
    expect(callsByName('¿Cuánto oro vale una antorcha, Bruno? Y si tiro los dados para convencer a Garrán, ¿eso cómo va?', 'Garrán')).toBe(false);
    expect(callsByName('¿Me acerco a la barra o me quedo aquí? Y Bruno, ¿tú sabes qué quiere Garrán de verdad?', 'Bruno')).toBe(true);
    expect(callsByName('Garrán, espera. ¿Cuántas monedas de plata vale esa daga?', 'Garrán')).toBe(true);
    expect(callsByName('Le pregunto a Bruno si vio al guardia', 'Bruno')).toBe(true);
    expect(callsByName('Sigo a Bruno hasta la barra', 'Bruno')).toBe(false);
  });

  it('la pregunta al compañero (pareja pícaro C7 y C8) no la bloquea el NPC: va al máster', async () => {
    const { engine, mira, calls } = await bar();
    for (const text of [
      '¿Cuánto oro vale una antorcha, Kael? Y si tiro los dados para convencer a Brenna, ¿eso cómo va?',
      'Oye Kael, ¿cuántas monedas de plata vale una antorcha? Y si tiro los dados para convencer a Brenna, ¿qué número tengo que sacar?',
    ]) {
      expect(npcTarget(engine.world, engine.events.all(), mira, text, engine.gameNow())).toBeNull();
      const r = await engine.act(mira.id, text);
      expect(r.event?.action_type).not.toBe('npc_busy');
      expect(r.text).not.toMatch(/te hace un gesto para que esperes/);
    }
    expect(calls.filter((x) => x.actor === mira.id)).toHaveLength(2);
  });

  it('lo que va de verdad al NPC ocupado sigue esperando su turno (pareja pícaro C5)', async () => {
    const { engine, mira } = await bar();
    const r = await engine.act(mira.id, 'Brenna, espera. ¿Cuántas monedas de plata vale esa daga?');
    expect(r.event?.action_type).toBe('npc_busy');
  });

  it('esperar a que el NPC termine no es hablarle (pareja pausado T16)', async () => {
    const { engine, mira } = await bar();
    const text = 'Me siento en la barra, saco un trozo de ración y espero sin prisa a que Brenna termine con Kael.';
    expect(npcTarget(engine.world, engine.events.all(), mira, text, engine.gameNow())).toBeNull();
    const r = await engine.act(mira.id, text);
    expect(r.event?.action_type).not.toBe('npc_busy');
  });
});

// ---------------------------------------------------------------------------
// Las frases enlatadas de los vecinos de relleno (extratalk.ts)
// ---------------------------------------------------------------------------

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const H = 3600;

/** Brezal con los atajos del motor y sin máster, a la hora `h` del día 1, con un PJ junto a `npcId`. */
async function brezal(h: number, npcId: string) {
  const time = fakeTime(EPOCH);
  const engine = await EngineClass.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: true, fastTravel: false });
  time.advanceGame(24 * H + h * H - engine.gameNow());
  await engine.tick();
  const r = await engine.createCharacter('u_lope', 'Lope', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  const pc: Character = r.character;
  const n = engine.world.npc(npcId);
  pc.location = { type: 'spot', id: n.location.id };
  engine.setPresence(pc.id, true);
  const reply = (text: string) => extraReply(engine.world, engine.events.all(), pc, text, engine.nowFor(pc));
  /** Lo dice de verdad (queda en el log, como en la partida) y devuelve la frase del vecino. */
  const talk = async (text: string) => {
    const from = engine.events.all().at(-1)?.seq ?? 0;
    await engine.act(pc.id, text);
    const ev = engine.events.all().filter((e) => e.seq > from && e.actor_id === pc.id && e.tags.includes('extra')).at(-1);
    return ((ev?.payload['lines'] as { text: string }[] | undefined) ?? [])[0]?.text ?? null;
  };
  return { engine, pc, reply, talk };
}

describe('arreglo 35: las frases de los vecinos contestan o no salen', () => {
  it('a una pregunta, la lavandera no contesta «No tengo tiempo para charlas» (rompejuegos T5)', async () => {
    const { reply } = await brezal(7, 'npc_x_fermina');
    const r = reply('Me acerco a la lavandera y le pregunto en voz baja si el gremio de los Cuervos Blancos tiene algo que ver con la niebla de Brezal.');
    expect(TRADES.washer.lines.brush).not.toContain(r?.line);
    expect(r?.line ?? '').not.toMatch(/No tengo tiempo para charlas/);
  });

  it('lo que no es hablarle lo narra el máster: soltar a Ilse, arrebatar el cubo (rompejuegos T9 y T11)', async () => {
    const { reply } = await brezal(7, 'npc_x_fermina');
    // La agenda («La escapada al granero: cada día a las 23:00») no es respuesta a «llévame al granero».
    expect(reply('Le suelto la muñeca a Ilse, me incorporo y le digo a la lavandera: «Basta de rodeos, sé dónde está la Brasa; llévame al granero ya y acabemos con esto».')).toBeNull();
    expect(reply('Lavandera, llévame al granero ya y acabemos con esto.')?.line ?? '').not.toMatch(/23:00/);
    // A quien pregunta la hora, sí.
    expect(reply('Lavandera, ¿a qué hora es la escapada al granero?')?.line).toMatch(/escapada al granero.*23:00/i);
    expect(reply('Pues ya estoy harto de tanta charla: me planto frente a la lavandera, le arrebato el cubo y le grito que me diga ya dónde está la Brasa.')).toBeNull();
  });

  it('pedirle trabajo a la lavandera lo contesta el máster (cronista T17)', async () => {
    const { reply } = await brezal(7, 'npc_x_fermina');
    expect(reply('Fermina, ¿necesitas algo más antes del cierre? Si hay un encargo pendiente, dímelo y lo hago antes de la misa de las ocho.')).toBeNull();
  });

  it('la criada no contesta «El señor regidor recibe por la mañana» a quien trepa o se bebe una poción (herido T17 y T18)', async () => {
    const { reply } = await brezal(7, 'npc_x_herminia');
    expect(reply('Me subo al muro de la casona del regidor sin pedir permiso, agarrándome a la hiedra mientras el alguacil mira hacia otro lado.')).toBeNull();
    expect(reply('Saco de la mochila una poción de curación, la destapo con los dientes y me la bebo de un trago. Pregunto a la criada: ¿cuánto tarda en hacer efecto esto?')).toBeNull();
    // Lo suyo sí: cuándo recibe el regidor.
    expect(reply('Criada, ¿cuándo recibe el regidor?')?.line).toMatch(/recibe por la mañana/);
  });

  it('al sereno: pedirle el farol no es charla, y lo que va a la vendedora no lo contesta él (pausado T19, recolector T26)', async () => {
    const { reply } = await brezal(23, 'npc_x_anselmo');
    expect(reply('Me acerco al sereno con calma, dejo que vea mis manos vacías y le pregunto si tiene para compartir el farol un rato.')).toBeNull();
    expect(reply('Como no llevo nada encima, no tengo bayas ni truchas que vender; le pregunto a la vendedora del puesto de la plaza si cambia algún encargo por un favor.')).toBeNull();
  });

  it('a la charla, su frase para despachar una vez; a la segunda, al máster, sin repetirla', async () => {
    const { engine, talk, reply } = await brezal(7, 'npc_x_fermina');
    const a = await talk('Qué día más gris, lavandera.');
    expect(engine.world.npc('npc_x_fermina').script.lines.brush).toContain(a);
    expect(reply('Pues sí que hace frío hoy, lavandera.')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// «Ya estás despierto» y «Dices: «…»» sin réplica: lo que hace falta en engine.ts
// ---------------------------------------------------------------------------

describe('arreglo 35: despertar y la raya', () => {
  it('parseWake: solo la orden sola (rompejuegos T35)', () => {
    expect(parseWake('Me despierto')).toBe(true);
    expect(parseWake('despertar.')).toBe(true);
    expect(parseWake('Me despierto en el calabozo y, sin esperar, exijo: ¡Vuela por los aires hasta la Torre de Ámbar!')).toBe(false);
  });

  it('dashForNpc: la raya a Ilse en una partida de uno es para Ilse (charlatán T1); con el compañero al lado y sin NPC nombrado, es chat', async () => {
    const { engine, pc } = await brezal(7, 'npc_x_fermina');
    const ilse = engine.world.npc('npc_ilse');
    ilse.location = { type: 'spot', id: pc.location.id };
    expect(dashForNpc(engine.world, pc, '—Suéltame la muñeca, Ilse, que te conozco de la misa, no de un juicio.')).toBe(true);
    // Solo, sin nombrar a nadie, con alguien delante: también es a quien tiene delante.
    expect(dashForNpc(engine.world, pc, '—¿Por qué te tiembla tanto la voz?')).toBe(true);
    const r = await engine.createCharacter('u_ciro', 'Ciro', { class_id: 'fighter' });
    if (!r.ok) throw new Error(r.reason);
    r.character.location = { type: 'spot', id: pc.location.id };
    expect(dashForNpc(engine.world, pc, '—¿Tú qué dices, Ciro?')).toBe(false);
    expect(dashForNpc(engine.world, pc, '—Esto no me gusta nada.')).toBe(false);
    expect(dashForNpc(engine.world, pc, '—Ilse, suéltame.')).toBe(true);
  });
});

/**
 * Lo mismo por el motor entero. Necesita los tres cambios de una línea en `engine.ts`, que no es de este paquete:
 * `docs/PLAN-ARREGLOS-2-2026-11-26.md`, «Estado del paquete H». Al aplicarlos, quitar el `.skip`.
 */
describe.skip('arreglo 35 por el motor (con el parche de engine.ts)', () => {
  it('la raya a un NPC (charlatán T1) llega al máster y no se queda en «Dices: «…»»', async () => {
    const { engine, kael, calls } = await bar();
    const r = await engine.act(kael.id, '—Brenna, ¿por qué te tiembla tanto la voz al ver un poco de lacre?');
    expect(r.text).not.toMatch(/^Dices:/);
    expect(calls.filter((x) => x.actor === kael.id)).toHaveLength(1);
    // Entre jugadores, la raya sigue siendo el chat, sin máster.
    const s = await engine.act(kael.id, '—Mira, ¿vienes?');
    expect(s.event?.action_type).toBe('say');
  });

  it('«Me despierto en el calabozo y exijo…» despierto no es «Ya estás despierto» (rompejuegos T35)', async () => {
    const { engine, kael, calls } = await bar();
    const r = await engine.act(kael.id, 'Me despierto en el calabozo y, sin esperar, exijo: ¡Vuela por los aires hasta la Torre de Ámbar!');
    expect(r.text).not.toBe('Ya estás despierto.');
    expect(calls.filter((x) => x.actor === kael.id)).toHaveLength(1);
  });

  it('«Esperar turno con Brenna» cuando Brenna ya se ha ido no es «¿Con quién?» (pareja pícaro C9)', async () => {
    const { engine, mira, calls } = await bar();
    engine.world.npc('npc_brenna').location = { type: 'spot', id: 'sp_pl_pozo' };
    const r = await engine.act(mira.id, 'Esperar turno con Brenna');
    expect(r.text).not.toBe('¿Con quién?');
    expect(calls.filter((x) => x.actor === mira.id)).toHaveLength(1);
  });
});
