/**
 * Partida del 2026-11-05 («La noche de Leodhin», Brezal, pícaro con la deuda, máster Haiku a esfuerzo bajo, actor
 * Sonnet). Los textos son los de la partida; el seq del evento real va en cada caso.
 *   1. Botones que adelantan lo que el jugador no sabe: «Preguntar a Brenna por su perro Ceniza» (seq 23) sin haber
 *      oído hablar del perro; y, cuando Brenna dice «Ceniza no vuelve» (seq 27), el botón salía «Preguntar por el
 *      perro»: el nombre cambiado por lo que es, que el jugador tampoco sabía.
 *   2. Dos rumores casi iguales de la curandera al salir a la plaza (seq 36 y 37).
 *   3. Misiones que nadie había dado: «Leña para la posada» en curso porque Brenna dijo «el de la leña» (seq 33), y
 *      «La cena del portón» abierta por el servidor cuando Brenna hablaba de su perro (seq 30-31).
 *   4. Garrán acepta que la deuda se pague subiendo al Granero Quemado (seq 22-23): give_quest se rechazaba, el máster
 *      contaba «El encargo ya consta en tu Diario» y la deuda no apuntaba nada en «Qué ha pasado».
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { talkPlanFor } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { characterStory, questStatus, storyOf, voicedQuest } from '../src/engine/story.js';
import { journalOf } from '../src/engine/journal.js';
import { activeJobs } from '../src/engine/progress.js';
import { openDebts, settleDebt } from '../src/engine/debts.js';
import { noticeOf } from '../src/adapters/web/journal.js';
import type { Character } from '../src/engine/model.js';
import type { DialogueLine } from '../src/engine/moments.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Brezal con un pícaro en la situación de la deuda: empieza en el Jabalí, con Garrán en su mesa. */
async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  const r = await engine.createCharacter('u_leodhin', 'Leodhin', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  engine.world.npc('npc_garran').location = { type: 'spot', id: 'sp_tab_mesa' };
  const c = engine.world.character(r.character.id);
  expect(c.situation?.id).toBe('sit_deuda');
  return { engine, time, c };
}

type Out = Record<string, unknown> & { ok?: boolean; error?: string; hint?: string; debt_id?: string };
const ctxFor = (engine: Engine, c: Character, text: string): ToolContext => ({
  engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: text, talk: talkPlanFor(engine, c, text),
});
const npcSays = (npcId: string, ...t: string[]): DialogueLine[] => t.map((text) => ({ speaker: 'npc', npc_id: npcId, text }));
const close = (extra: Record<string, unknown>) => ({
  narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, ...extra,
});

/** Un turno de charla cerrado por el máster, como queda en el registro, y el tick del servidor de después. */
async function say(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, npcId: string, text: string, reply: string[], suggested = ''): Promise<ToolContext> {
  const ctx = ctxFor(engine, c, text);
  const lines = [{ speaker: 'actor', text }, ...npcSays(npcId, ...reply)];
  const r = JSON.parse(executeTool(ctx, 'log_event', close({ npc_id: npcId, lines, suggested_actions: suggested }))) as Out;
  expect(r.error, JSON.stringify(r)).toBeUndefined();
  engine.events.emit({ actor_id: c.id, action_type: 'master', input_text: text, narration_private: ctx.closed!.narration_private, observable: null, tags: ['master', 'social'], payload: { npc_id: npcId, lines } }, time.now());
  time.advanceGame(60);
  await engine.tick();
  return ctx;
}

const status = (engine: Engine, c: Character, id: string) => questStatus(engine.world, c, storyOf(engine.world)!.quests.find((q) => q.id === id)!);

// Lo que dijo Brenna en la partida.
const BRENNA_SALUDO = ['Ceniza no vuelve. Lleva tres días mirando la puerta, y yo también.', '¿Y tú de dónde vienes, forastero? Aquí nadie llega sin que la niebla lo deje.'];
const BRENNA_PERRO = ['Por Ceniza. Es mi perro: pardo, con una oreja rota. Lo vieron meterse en el Soto detrás de un olor, y desde entonces la puerta es lo único que me queda por mirar.', 'Si lo ves por ahí, no lo llames. Acércate despacio y avísame. Lo demás ya lo hablaremos cuando tengas las manos libres.'];
const BRENNA_DONDE = ['Al Soto. Detrás de un olor, como te dije. Lo vio el de la leña, que volvió con las manos vacías y sin hablar.', 'Ceniza no es de los que se pierden. Si se fue, fue porque el olor le tiró más que la puerta.'];

describe('1. los botones no adelantan lo que el jugador no sabe', () => {
  it('de quien no ha oído hablar (y no tiene sitio fijo), ni nombre ni oficio: el botón se quita (seq 23)', async () => {
    const { engine, c } = await boot();
    expect(c.knows).not.toContain('npc_ceniza');
    const ctx = ctxFor(engine, c, 'de acuerdo, iré');
    executeTool(ctx, 'log_event', close({
      npc_id: 'npc_garran', lines: npcSays('npc_garran', 'Bien. Así no hace falta arrastrarte.'),
      suggested_actions: 'Preguntar a Garrán por dónde está el Soto | Preguntar a Brenna por su perro Ceniza | Ir a la plaza del pozo',
    }));
    // Antes salía «Preguntar a Brenna por su perro el perro».
    expect(ctx.closed!.suggested_actions).toEqual(['Preguntar a Garrán por dónde está el Soto', 'Ir a la plaza del pozo']);
  });

  it('si se lo acaban de decir, el nombre va tal cual: «Preguntar por Ceniza», no «por el perro» (seq 27)', async () => {
    const { engine, time, c } = await boot();
    const ctx = await say(engine, time, c, 'npc_brenna', 'hablar con Brenna', BRENNA_SALUDO, 'Preguntar por Ceniza | Decir de dónde vienes');
    expect(ctx.closed!.suggested_actions).toEqual(['Preguntar por Ceniza', 'Decir de dónde vienes']);
    // Y lo oído vale para los turnos siguientes.
    const next = await say(engine, time, c, 'npc_brenna', 'dame una jarra de cerveza', ['Cuatro de cobre.'], 'Pagar la jarra | Preguntar a Brenna por Ceniza');
    expect(next.closed!.suggested_actions).toEqual(['Pagar la jarra', 'Preguntar a Brenna por Ceniza']);
  });

  it('a quien tiene sitio fijo y no conoce, por su oficio, como antes', async () => {
    const { engine, c } = await boot();
    const ctx = ctxFor(engine, c, 'miro alrededor');
    executeTool(ctx, 'log_event', close({ narration_private: 'Miras la sala.', tags: 'exploration', suggested_actions: 'Hablar con Ilse | Ir a la plaza del pozo' }));
    expect(ctx.closed!.suggested_actions).toEqual(['Hablar con la curandera', 'Ir a la plaza del pozo']);
  });

  it('un nombre que el máster suelta en la narración sin cita no cuenta como oído: el jugador lee «el perro» y el botón no sale', async () => {
    const { engine, c } = await boot();
    const ctx = ctxFor(engine, c, 'hablar con Brenna');
    executeTool(ctx, 'log_event', close({
      npc_id: 'npc_brenna', narration_private: 'Brenna te mira de reojo y vuelve a la puerta, esperando a Ceniza.',
      lines: npcSays('npc_brenna', '¿Y tú de dónde vienes, forastero?'), suggested_actions: 'Preguntar por Ceniza | Decir de dónde vienes',
    }));
    expect(ctx.closed!.narration_private).toContain('esperando al perro');
    expect(ctx.closed!.narration_private).not.toContain('Ceniza');
    expect(ctx.closed!.suggested_actions).toEqual(['Decir de dónde vienes']);
  });
});

describe('2. un rumor que repite otro de la misma persona espera', () => {
  it('en la plaza se oye uno de la curandera; el otro, cuando le pidan el primero (seq 36-37)', async () => {
    const { engine, time, c } = await boot();
    c.location = { type: 'spot', id: 'sp_pl_pozo' };
    engine.world.touch('characters', c.id);
    for (let i = 0; i < 5; i++) { time.advanceGame(10); await engine.tick(); }
    const heard = Object.keys(characterStory(c).rumors ?? {});
    expect(heard.filter((id) => id === 'q_agua' || id === 'q_tonico_mateo')).toEqual(['q_agua']);
    // Le piden «El agua turbia»: ya no está pendiente y el otro rumor puede oírse.
    characterStory(c).open.push('q_agua');
    for (let i = 0; i < 3; i++) { time.advanceGame(10); await engine.tick(); }
    expect(Object.keys(characterStory(c).rumors ?? {})).toContain('q_tonico_mateo');
  });

  it('dos rumores que cuentan cosas distintas de la misma persona sí se oyen: el recado y «mirando a la puerta»', async () => {
    const { engine, time, c } = await boot();
    for (let i = 0; i < 3; i++) { time.advanceGame(10); await engine.tick(); }
    expect(Object.keys(characterStory(c).rumors ?? {})).toEqual(expect.arrayContaining(['q_cena_doro', 'q_perro']));
  });
});

describe('3. una misión entra cuando alguien la da', () => {
  it('«el de la leña» no es hablar del encargo «Leña para la posada» (seq 33)', async () => {
    const { engine, time, c } = await boot();
    expect(activeJobs(engine.world).map((j) => j.id)).toContain('job_lena');
    await say(engine, time, c, 'npc_brenna', 'Preguntar dónde se metió el perro', BRENNA_DONDE);
    expect(journalOf(engine, c.id).quests.active.find((q) => q.id === 'job_lena')).toBeUndefined();
    // Hablar de él con quien lo pide sí lo pone en curso.
    await say(engine, time, c, 'npc_brenna', '¿Necesitas leña para la posada?', ['Diez leños secos, de los del roble. Te los pago bien.']);
    expect(journalOf(engine, c.id).quests.active.find((q) => q.id === 'job_lena')).toMatchObject({ status: 'active', origin: { text: 'Te lo pide Brenna' } });
  });

  it('un encargo cuyo título solo deja una palabra («Ronda hasta el Soto»: el Soto es un sitio) entra con esa sola', async () => {
    const { engine, time, c } = await boot();
    expect(activeJobs(engine.world).map((j) => j.id)).toContain('job_ronda');
    const doro = engine.world.npc('npc_doro');
    c.location = { type: 'spot', id: doro.location.id };
    engine.world.touch('characters', c.id);
    await say(engine, time, c, 'npc_doro', '¿Quieres que haga la ronda hasta el Soto?', ['Sí. Ve, mira y vuelve.']);
    expect(journalOf(engine, c.id).quests.active.find((q) => q.id === 'job_ronda')).toMatchObject({ status: 'active' });
  });

  it('el servidor abre la que Brenna ha contado, no la primera de la lista (seq 30-31)', async () => {
    const { engine, time, c } = await boot();
    await say(engine, time, c, 'npc_brenna', 'hablar con Brenna', BRENNA_SALUDO);
    await say(engine, time, c, 'npc_brenna', 'dame una jarra de cerveza', ['Cuatro de cobre. Y no la bebas de un trago.']);
    // Madura, pero solo sale si el jugador muestra interés: preguntarle qué le pasa lo es (CONVERSACION-FLUJO).
    expect(talkPlanFor(engine, c, '¿Qué te pasa, Brenna? No dejas de mirar la puerta')!.state.ripe).toBe(true);
    await say(engine, time, c, 'npc_brenna', '¿Qué te pasa, Brenna? No dejas de mirar la puerta', BRENNA_PERRO);
    expect(status(engine, c, 'q_cena_doro')).toBe('available');
    expect(status(engine, c, 'q_perro')).toBe('active');
    expect(characterStory(c).origins!['q_perro']).toMatchObject({ kind: 'giver', text: 'Brenna nos lo pidió' });
  });

  it('si en el turno habla de otra cosa, no se abre ninguna', async () => {
    const { engine, c } = await boot();
    const brenna = engine.world.npc('npc_brenna');
    expect(voicedQuest(engine.world, c, brenna, BRENNA_SALUDO.slice(1).join('\n'))).toBeNull();
    expect(voicedQuest(engine.world, c, brenna, BRENNA_PERRO.join('\n'))).toBe('q_perro');
    expect(voicedQuest(engine.world, c, brenna, 'El guardia del portón no ha cenado. ¿Le llevas este plato?')).toBe('q_cena_doro');
  });
});

describe('4. lo que se pacta con quien cobra la deuda queda en la deuda', () => {
  it('Garrán acepta el trabajo del Granero: se apunta en «Qué ha pasado», con su aviso, y el turno sigue (seq 22-23)', async () => {
    const { engine, c } = await boot();
    const text = 'quiero pagar por supuesto! pero ahora mismo me pillas un poco flojo de dinero...puedo hacer algun trabajo por ti?';
    const ctx = ctxFor(engine, c, text);
    expect(ctx.talk?.npc_id).toBe('npc_garran');
    const r = JSON.parse(executeTool(ctx, 'give_quest', {
      title: 'Apagar las luces', npc_id: 'npc_garran', heard: null,
      text: 'Garrán te manda subir al Granero Quemado, al otro lado del Soto, a «apagar las luces». El regidor paga el trabajo y con eso la deuda queda saldada.',
      objective: 'Subir al Granero Quemado, al otro lado del Soto, y apagar las luces.', reward: 'Saldar los 3 de oro que debes a Osric Malvez.',
    })) as Out;
    expect(r).toMatchObject({ ok: true });
    expect(r.hint).toMatch(/no nombres el Diario/);
    // No es un encargo aparte: va en la deuda.
    const debt = journalOf(engine, c.id).quests.active.find((q) => q.kind === 'debt')!;
    expect(r.debt_id).toBe(debt.id);
    expect(journalOf(engine, c.id).quests.active.some((q) => q.kind === 'given')).toBe(false);
    expect(debt.history.map((h) => h.kind)).toEqual(['added', 'changed']);
    expect(debt.history[1]).toMatchObject({ text: 'Garrán acepta que la saldes así: subir al Granero Quemado, al otro lado del Soto, y apagar las luces', why: 'lo hablaste con Garrán' });
    // El aviso del hilo dice lo mismo que el Diario.
    const told = ctx.progress.filter((p) => p.quest?.id === debt.id);
    expect(told).toHaveLength(1);
    const notice = noticeOf({ action_type: 'progress_story', narration_private: told[0]!.text, observable: null, payload: { quest: told[0]!.quest } });
    expect(notice).toMatchObject({ text: 'La misión cambia · «Deuda con el regidor»', tab: 'journal' });
    // Repetirlo no lo apunta dos veces.
    executeTool(ctxFor(engine, c, text), 'give_quest', { title: 'Apagar las luces', npc_id: 'npc_garran', heard: null, text: 'x', objective: 'Subir al Granero Quemado, al otro lado del Soto, y apagar las luces.', reward: null });
    expect(journalOf(engine, c.id).quests.active.find((q) => q.kind === 'debt')!.history).toHaveLength(2);
  });

  it('un pago a cuenta también queda en el historial', async () => {
    const { engine, c } = await boot();
    c.coins = 500;
    const r = settleDebt(engine.world, c, { npc_id: 'npc_garran', how: 'coins', amount: 100 }, engine.gameNow());
    expect(r).toMatchObject({ ok: true, settled: false, remaining: 200 });
    expect(openDebts(c)).toHaveLength(1);
    const debt = journalOf(engine, c.id).quests.active.find((q) => q.kind === 'debt')!;
    expect(debt.history.map((h) => [h.kind, h.text])).toEqual([['added', 'Contraes la deuda'], ['step', '✔ Pagas 1 de oro a cuenta; quedan 2 de oro']]);
  });
});
