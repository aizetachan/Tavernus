/**
 * Arreglo 33 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete H; patrón 4 de docs/ANALISIS-PARTIDAS-2026-11-26.md): qué
 * lee cada jugador en un turno compartido. En la pareja pícaro (`data/local/autoplay/20261126-0442`), Ciro leía la parte
 * de Bruno en segunda persona («Le preguntas a Garrán qué saca él de esperar tres días», C2; «Te acercas al jornalero y
 * pones la daga sobre la mesa», C12) y lo común dos veces. Aquí se monta ese mismo cierre en Brezal y se mira qué
 * entrega el motor (readerText) y qué pinta la web (toMessage, novelBlocks, reply).
 *
 * Veredicto: el motor y la web lo hacen bien; cada uno lee su parte y lo común, una vez. Lo que duplica es la
 * herramienta: la ventana de turno resuelve a todos con el ActionResult del primero (`engine.ts`, flushWindow), y
 * `scripts/autoplay.ts` junta ese `r.text` con lo que le llegó (seenSince). La web no usa ese texto (`reply`).
 */
import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { novelBlocks } from '../src/adapters/web/novel.js';
import { reply, toMessage } from '../src/adapters/web/server.js';
import { seededRng } from '../src/engine/dice.js';
import { spawnItem } from '../src/engine/inventory.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import type { Character } from '../src/engine/model.js';
import type { DialogueLine } from '../src/engine/moments.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Máster falso que cierra con log_event (las guardas de verdad); `close` da los intentos, en orden. */
function toolMaster(engine: Engine, close: () => Record<string, unknown>[]) {
  const errors: string[] = [];
  const m: MasterLike = {
    async resolve(actor, text) {
      const ctx: ToolContext = { engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [], action_text: text };
      for (const input of close()) {
        const r = JSON.parse(executeTool(ctx, 'log_event', { observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '', lines: null, ...input })) as { error?: string };
        if (r.error) errors.push(r.error);
        if (ctx.closed) break;
      }
      return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: ctx.closed ?? { narration_private: 'Sin cierre.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
    },
  };
  engine.attachMaster(m);
  return errors;
}

/** Bruno (pícaro) y Ciro (guerrero) en la mesa del fondo del Jabalí, con Garrán; la ventana de turno abierta. */
async function pareja() {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: false, fastTravel: false, turnWindowMs: 3_600_000 });
  const pc = async (name: string, cls: string): Promise<Character> => {
    const r = await engine.createCharacter(`u_${name}`, name, { class_id: cls });
    if (!r.ok) throw new Error(r.reason);
    r.character.location = { type: 'spot', id: 'sp_tab_mesa' };
    r.character.connected = true;
    engine.setPresence(r.character.id, true);
    return r.character;
  };
  const bruno = await pc('Bruno', 'rogue');
  const ciro = await pc('Ciro', 'fighter');
  for (const id of [bruno.id, ciro.id]) for (const o of [bruno.id, ciro.id]) if (id !== o && !engine.world.character(id).knows.includes(o)) engine.world.character(id).knows.push(o);
  engine.world.npc('npc_garran').location = { type: 'spot', id: 'sp_tab_mesa' };
  bruno.knows.push('npc_garran'); ciro.knows.push('npc_garran');
  const seen: Record<string, Delivery[]> = {};
  engine.onDelivery((d) => { (seen[d.character_id] ??= []).push(d); });
  return { engine, bruno, ciro, seen };
}

const count = (text: string, part: string) => text.split(part).length - 1;

describe('arreglo 33: lo que lee cada uno en un turno compartido (pareja pícaro C2)', () => {
  it('cada uno lee su parte y lo común, una vez y en su orden; nada del otro en segunda persona; la web pinta lo mismo', async () => {
    const { engine, bruno, ciro, seen } = await pareja();
    const brunoPart = 'Le preguntas a Garrán qué saca él de esperar tres días. Él te mira de medio lado, sin prisa, y tarda en contestar.';
    const ciroPart = 'Miras al hombre de la maza: es Garrán, sentado aquí mismo, a tu misma mesa, no en la barra.';
    const common = 'Garrán sigue en la mesa del fondo, con la maza al cinto y los dedos quietos sobre el banco. Bruno le ha preguntado qué gana esperando; Ciro le mira, sin saber aún quién es.';
    const garran: DialogueLine[] = [
      { speaker: 'npc', npc_id: 'npc_garran', text: 'Yo no gano nada, forastero. El regidor sí: cada día que esperas le suma intereses a la cuenta.', to: bruno.id },
      { speaker: 'npc', npc_id: 'npc_garran', text: 'Y yo cobro lo que me mandan cobrar. Tres días, ni uno más.' },
    ];
    const errors = toolMaster(engine, () => [{
      narration_private: common, narration_by_pc: { [bruno.id]: brunoPart, [ciro.id]: ciroPart }, npc_id: 'npc_garran', lines: garran,
    }]);
    const [a, b] = await Promise.all([
      engine.act(bruno.id, 'Preguntarle qué ganaría con esperar'),
      engine.act(ciro.id, 'Espera, ¿Garrán es el del Soto o el de la barra? Mejor miro a ese Garrán.'),
    ]);
    expect(errors).toEqual([]);
    const ev = a.event!;
    expect(b.event!.id).toBe(ev.id);
    expect(ev.payload['group']).toEqual([bruno.id, ciro.id]);

    // Motor: un evento, una entrega para cada uno.
    const mine = (id: string) => seen[id]!.filter((d) => d.event.id === ev.id);
    expect(mine(bruno.id)).toHaveLength(1);
    expect(mine(ciro.id)).toHaveLength(1);
    const ciroReads = mine(ciro.id)[0]!.text;
    const brunoReads = mine(bruno.id)[0]!.text;
    // Ciro: lo suyo y después lo común; lo de Bruno solo como lo cuenta lo común, en tercera persona.
    expect(ciroReads.startsWith(ciroPart)).toBe(true);
    expect(ciroReads).not.toContain('Le preguntas a Garrán');
    expect(ciroReads).toContain('Bruno le ha preguntado');
    expect(count(ciroReads, 'Garrán sigue en la mesa del fondo')).toBe(1);
    // Ciro el jugador no es «el jornalero» (el NPC Ciro, que no conoce): su nombre no se enmascara.
    expect(ciroReads).toContain('Ciro le mira');
    expect(ciroReads).not.toContain('jornalero');
    // Bruno, al revés. (Su texto lo abre «Te acercas a la barra.», la línea de aproximación del motor: arreglo 41, paquete E.)
    expect(count(brunoReads, brunoPart)).toBe(1);
    expect(brunoReads.indexOf(brunoPart)).toBeLessThan(brunoReads.indexOf('Garrán sigue en la mesa del fondo'));
    expect(brunoReads).not.toContain('Miras al hombre de la maza');
    expect(count(brunoReads, 'Garrán sigue en la mesa del fondo')).toBe(1);

    // Web: el mensaje de Ciro es su entrega; las burbujas, su parte, lo común y las frases de Garrán, una vez.
    const m = toMessage(mine(ciro.id)[0]!, engine);
    expect(m.text).toBe(ciroReads);
    const blocks = novelBlocks(m.text, (ev.payload['lines'] as DialogueLine[]) ?? []);
    const prose = blocks.filter((x) => x.kind === 'prose').map((x) => (x as { text: string }).text).join(' ');
    expect(prose).not.toContain('Le preguntas');
    expect(count(prose, 'Garrán sigue en la mesa del fondo')).toBe(1);

    // Lo que duplica la herramienta: los dos act() devuelven el mismo ActionResult, el de Bruno (su parte en segunda
    // persona y lo común). La web no lo pinta: con evento, `reply` no devuelve texto y la narración llega por el stream.
    expect(b.text).toBe(a.text);
    expect(b.text).toContain('Le preguntas a Garrán');
    expect(reply(b)).toEqual({ ok: true, text: null });
    expect(reply(a)).toEqual({ ok: true, text: null });
  });

  it('pareja pícaro C12: Ciro no lee «Te acercas al jornalero y pones la daga sobre la mesa», que hizo Bruno', async () => {
    const { engine, bruno, ciro, seen } = await pareja();
    const jornalero = engine.world.npc('npc_x_ciro');
    jornalero.location = { type: 'spot', id: 'sp_tab_barra' };
    for (const c of [bruno, ciro]) c.location = { type: 'spot', id: 'sp_tab_barra' };
    const brunoPart = 'Te acercas al jornalero y pones la daga sobre la mesa. Le hablas bajo. Él mira la hoja, luego a ti, y no dice nada.';
    const ciroPart = 'Te quedas junto a la barra y miras la tablilla de deudas: nombres escritos con tiza y cifras al lado.';
    const common = 'En la barra, el jornalero se encoge sobre su jarra cuando Bruno deja una daga sobre la madera. Los vecinos más cercanos vuelven la cabeza y luego fingen que no.';
    const errors = toolMaster(engine, () => [{ narration_private: common, narration_by_pc: { [bruno.id]: brunoPart, [ciro.id]: ciroPart }, npc_id: 'npc_x_ciro' }]);
    const [a] = await Promise.all([
      engine.act(bruno.id, 'Me acerco al jornalero, le pongo la daga sobre la mesa y susurro: «Dame esas monedas o tu cuello y yo nos llevamos mal».'),
      engine.act(ciro.id, 'Mirar la tablilla de deudas'),
    ]);
    expect(errors).toEqual([]);
    const ciroReads = seen[ciro.id]!.filter((d) => d.event.id === a.event!.id).map((d) => d.text);
    expect(ciroReads).toHaveLength(1);
    expect(ciroReads[0]).not.toContain('Te acercas al jornalero');
    expect(ciroReads[0]!.startsWith(ciroPart)).toBe(true);
    expect(count(ciroReads[0]!, 'el jornalero se encoge')).toBe(1);
  });

  it('el orden es el del turno: la oferta llega antes que «Aceptas…» (pareja violento E6)', async () => {
    const { engine, bruno, ciro, seen } = await pareja();
    expect(spawnItem(engine.world, 'it_pan_gris', 1, { type: 'character', id: bruno.id, slot: { kind: 'pocket' } }).ok).toBe(true);
    const o = await engine.act(bruno.id, 'dar pan gris a Ciro');
    expect(o.ok).toBe(true);
    const r = await engine.act(ciro.id, 'Acepto');
    expect(r.ok).toBe(true);
    const texts = seen[ciro.id]!.map((d) => d.text);
    const offered = texts.findIndex((t) => /te ofrece/.test(t));
    const accepted = texts.findIndex((t) => /^Aceptas/.test(t));
    expect(offered).toBeGreaterThanOrEqual(0);
    expect(accepted).toBeGreaterThan(offered);
    // Lo que se lee va por orden de evento (seq): el que lo junte de otra forma (r.text delante) lo invierte.
    const seqs = seen[ciro.id]!.map((d) => d.event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('el aviso de lo que hace el compañero nombra a Ciro, no a «el jornalero» (pareja pícaro B1 a B31)', async () => {
    const { engine, bruno, ciro, seen } = await pareja();
    expect(bruno.knows).not.toContain('npc_x_ciro');
    const e = engine.events.emit({ actor_id: ciro.id, action_type: 'master', narration_private: 'Le preguntas a Garrán por la deuda.', observable: 'Ciro habla con Garrán en la mesa del fondo.', payload: {} });
    const got = seen[bruno.id]!.filter((d) => d.event.id === e.id).map((d) => d.text);
    expect(got).toEqual(['Ciro habla con Garrán en la mesa del fondo.']);
    // El NPC que no conoce sigue enmascarado: Garrán sí lo conoce; a Tobías no.
    const t = engine.events.emit({ actor_id: ciro.id, action_type: 'master', narration_private: 'Saludas a Tobías.', observable: 'Ciro saluda a Tobías.', payload: {} });
    expect(seen[bruno.id]!.filter((d) => d.event.id === t.id)[0]!.text).not.toContain('Tobías');
  });
});
