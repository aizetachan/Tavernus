/**
 * La deuda de Brezal y la charla con quien la cobra (partida demo-actores del 28-10): una sola deuda y una sola
 * historia (el regidor la compró, Garrán la cobra en su nombre), el Diario sin citas ni logros vacíos, y un NPC
 * receloso que no niega lo público ni lo suyo con el PJ.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { journalOf } from '../src/engine/journal.js';
import { debtLine, openDebts, setDebt } from '../src/engine/debts.js';
import { talkPlan, talkProblems, talkScript } from '../src/engine/talk.js';
import { GAME_DAY } from '../src/clock/clock.js';
import type { Character } from '../src/engine/model.js';
import { bootEngine, fakeTime } from './helpers.js';

const T0 = Date.UTC(2026, 9, 22, 18);

/** Brezal con un pícaro en la situación de la deuda y Garrán en su mesa. */
async function deudor(): Promise<{ engine: Engine; c: Character }> {
  const seed = authoredSeed('brezal', { now: new Date(T0) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: () => T0, deterministic: true });
  const r = await engine.createCharacter('u1', 'Nia', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  engine.world.npc('npc_garran').location = { type: 'spot', id: 'sp_tab_mesa' };
  await engine.tick();
  return { engine, c: engine.world.character(r.character.id) };
}

const plan = (engine: Engine, c: Character, text: string) => talkPlan(engine.world, engine.events.all(), c, text, engine.nowFor(c))!;
const garranSays = (...t: string[]) => t.map((text) => ({ speaker: 'npc' as const, npc_id: 'npc_garran', text }));
const check = (p: ReturnType<typeof plan>, said: string) => talkProblems(p, { lines: garranSays(said), narration: '', declared: null, pendingRoll: false, npcName: 'Garrán' });

describe('una sola deuda, una sola historia', () => {
  it('la deuda es del regidor y la cobra Garrán: una sola entrada, aparte de la principal', async () => {
    const { engine, c } = await deudor();
    expect(c.situation!.id).toBe('sit_deuda');
    const [d] = openDebts(c);
    expect(d).toMatchObject({ npc_id: 'npc_garran', on_behalf_of: 'npc_osric', amount: 300 });
    // El máster lo lee con los dos: a quién se le debe y quién la cobra.
    expect(debtLine(engine.world, d!, engine.gameNow(), (n) => n.name, true)).toBe('Debes 3 de oro a Osric Malvez [npc_osric] (la cobra Garrán [npc_garran] en su nombre), vence en 3 días');
    const debts = journalOf(engine, c.id).quests.active.filter((q) => q.kind === 'debt');
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ title: 'Deuda con el regidor', steps: [{ text: 'Pagar 3 de oro a Garrán, que la cobra en nombre del regidor (o saldarla de otro modo)', done: false }] });
    expect(debts[0]!.clock?.days_left).toBe(3);
  });

  it('la principal es salir de la aldea: solo el primer paso, sin pistas ni a quién preguntar', async () => {
    const { engine, c } = await deudor();
    const main = journalOf(engine, c.id).quests.active.find((q) => q.kind === 'main')!;
    expect(main.title).toBe('Salir de la aldea');
    expect(main.steps).toEqual([{ text: 'Averiguar qué es la niebla y cómo salir', done: false }]);
    expect(main.summary.text).toMatch(/^Salir de la aldea: averiguar qué es la niebla/);
    // Con la pista de la Brasa, el primer paso se cumple y aparece el siguiente.
    c.clues.push('clue_ilse');
    await engine.tick();
    const after = journalOf(engine, c.id).quests.active.find((q) => q.kind === 'main')!;
    expect(after.steps.map((s) => [s.text, s.done])).toEqual([
      ['Averiguar qué es la niebla y cómo salir', true],
      ['Decidir qué pasa con el ascua antes de la noche de la Brasa: de ella depende el cerco', false],
    ]);
  });

  it('agnóstico: sin historia escrita, la deuda de la situación es un paso de la principal y no sale aparte', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    kael.situation = {
      why_here: 'Llegas sin blanca a la posada.', wants: 'Saldar la cuenta.', threat: 'El posadero no fía.',
      clock_days: 2, clock_runs_out: 'Te echan.', antagonist_npc_id: 'npc_brenna', start_spot_id: 'sp_tab_barra',
      paths: ['Trabajar en la posada.'], opening: 'Brenna te mira.', deadline_game_s: engine.gameNow() + 2 * GAME_DAY,
      debt: { npc_id: 'npc_brenna', amount: 40, reason: 'tres noches de cama' },
    };
    expect(setDebt(engine.world, kael, { npc_id: 'npc_brenna', amount: 40, reason: 'tres noches de cama', due_game_s: kael.situation.deadline_game_s! }, engine.gameNow()).ok).toBe(true);
    const j = journalOf(engine, kael.id);
    expect(j.quests.active.some((q) => q.kind === 'debt')).toBe(false);
    expect(j.quests.active.find((q) => q.kind === 'main')!.steps.map((s) => s.text)).toEqual(['Saldar la cuenta.', 'Debes 4 de plata a Brenna, vence en 2 días']);
  });
});

describe('el Diario de misiones', () => {
  it('el logro no sale hasta la primera pista', async () => {
    const { engine, c } = await deudor();
    expect(journalOf(engine, c.id).quests.active.some((q) => q.kind === 'achievement')).toBe(false);
    c.clues.push(engine.world.campaign.clues[0]!.id);
    const ach = journalOf(engine, c.id).quests.active.find((q) => q.kind === 'achievement')!;
    expect(ach).toMatchObject({ title: 'Quien ha mirado la ceniza', status: 'active' });
    expect(ach.text).toMatch(/^Descubrir 3 pistas/);
  });
});

describe('la charla con quien cobra la deuda', () => {
  it('«¿qué trabajo tienes?»: Garrán, receloso, lleva su trato en el guion y lo cuenta claro', async () => {
    const { engine, c } = await deudor();
    const p = plan(engine, c, 'Garrán, ¿qué trabajo tienes para mí?');
    expect([p.situation, p.second, p.state.tier]).toEqual(['cold', 'offer', 'wary']);
    expect(p.state.terms).toContain('ir al Granero Quemado a «apagar las luces»');
    // Un título de misión que es el nombre de un sitio no es secreto; las principales de otras situaciones, tampoco.
    expect(p.state.locked).not.toContain('El Granero Quemado');
    expect(p.state.locked).not.toContain('La carta de Vharn');
    const script = talkScript(engine.world, c, p);
    expect(script).toContain('Lo suyo con el actor (el actor ya lo sabe; si pregunta por ello, lo dice claro; ya está en su Diario, no es un encargo nuevo)');
    expect(script).toContain('Lo público no se niega nunca');
    expect(script).toContain('Nada de «no lo cuento» ni «lo decide otro»');
    // «No lo cuento en una mesa» no vale: se reescribe.
    expect(check(p, 'No lo cuento en una mesa. ¿Y tú por qué lo quieres saber?').join(' ')).toContain('se niega a contar algo público');
    expect(check(p, 'Ir al granero quemado y apagar esas luces, por el regidor. Tres días.')).toEqual([]);
  });

  it('«¿dónde está el regidor?»: por su oficio se sabe quién es y dónde vive, y no se niega', async () => {
    const { engine, c } = await deudor();
    const p = plan(engine, c, 'Garrán, ¿dónde está el regidor?');
    const osric = p.topics.find((t) => t.kind === 'person')!;
    expect(osric.name).toBe('Osric Malvez');
    expect(osric.known).toContain('vive en La casona');
    expect(check(p, 'Eso no te lo digo, forastero.').join(' ')).toContain('se niega a contar algo público');
    expect(check(p, 'En la casona, en la plaza. No le hagas esperar.')).toEqual([]);
  });

  it('la escalada sigue: insultado o ya hostil, puede negarse; y hostigar sigue en la tool', async () => {
    const { engine, c } = await deudor();
    const insulted = plan(engine, c, 'Garrán, imbécil, ¿qué trabajo tienes?');
    expect(insulted.situation).toBe('reaction');
    expect(check(insulted, 'No te lo repito. Una más y te saco a rastras.')).toEqual([]);
    engine.world.npc('npc_garran').attitude.by_character[c.id] = 'hostile';
    const hostile = plan(engine, c, 'Garrán, ¿qué trabajo tienes?');
    expect(hostile.state.tier).toBe('hostile');
    expect(check(hostile, 'Eso no te lo digo. Lárgate.')).toEqual([]);
    expect(talkScript(engine.world, c, hostile)).toContain('Puede cortar la charla o echarle.');
  });

  it('el «¿para qué?», solo al empezar la charla', async () => {
    const { engine, c } = await deudor();
    const first = plan(engine, c, 'Garrán, ¿qué quieres de mí?');
    expect(first.state.new_talk).toBe(true);
    expect(talkScript(engine.world, c, first)).toContain('Pregunta qué quiere y por qué.');
    engine.events.emit({
      actor_id: c.id, action_type: 'master', input_text: '¿Qué quieres de mí?', narration_private: '«Lo que me debes.»', observable: null,
      tags: ['master', 'social'], payload: { npc_id: 'npc_garran', lines: [{ speaker: 'actor', text: '¿Qué quieres de mí?' }, { speaker: 'npc', npc_id: 'npc_garran', text: 'Lo que me debes.' }] },
    });
    const again = plan(engine, c, 'Garrán, ¿qué trabajo tienes?');
    expect(again.state.new_talk).toBe(false);
    expect(talkScript(engine.world, c, again)).toContain('No le vuelvas a preguntar para qué lo quiere');
    expect(check(again, 'Trabajo hay. ¿Para qué lo quieres?').join(' ')).toContain('ya le preguntó para qué lo quiere');
  });
});
