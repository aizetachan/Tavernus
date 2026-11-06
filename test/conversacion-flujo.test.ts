/**
 * El flujo de charla de cinco capas (docs/CONVERSACION-FLUJO.md): lo urgente, qué sabe del PJ, cómo le trata,
 * misiones y qué le ha dicho, en cinco huecos (A reacción, B reconocimiento, C respuesta, D misión, E cierre).
 * Los casos salen de la partida «Humo y ceniza» (VPS, 06-11) y de la tabla del documento. Sin API.
 */
import { describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { talkReply } from '../src/ai/offline.js';
import { actionContext } from '../src/ai/prompt.js';
import { introducesAs, intentOf, planWords, talkHoles, talkPlan, talkProblems, talkScript, textSignals, type TalkPlan } from '../src/engine/talk.js';
import { setAlarm, clearAlarm } from '../src/engine/alarm.js';
import { noticeThefts, theftWith } from '../src/engine/stolen.js';
import { Engine } from '../src/engine/engine.js';
import { seededRng } from '../src/engine/dice.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import type { Character } from '../src/engine/model.js';
import { bootEngine } from './helpers.js';

const T0 = Date.UTC(2026, 9, 22, 18);

/** Brezal con un pícaro en la situación de la deuda (conoce a Brenna y a Garrán) y Garrán en su mesa. */
async function deudor(): Promise<{ engine: Engine; c: Character }> {
  const seed = authoredSeed('brezal', { now: new Date(T0) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: () => T0, deterministic: true });
  const r = await engine.createCharacter('u1', 'Pillin', { class_id: 'rogue' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  engine.world.npc('npc_garran').location = { type: 'spot', id: 'sp_tab_mesa' };
  await engine.tick();
  return { engine, c: engine.world.character(r.character.id) };
}

const planOf = (engine: Engine, c: Character, text: string) => talkPlan(engine.world, engine.events.all(), c, text, engine.nowFor(c))!;
const says = (npcId: string, ...t: string[]) => t.map((text) => ({ speaker: 'npc' as const, npc_id: npcId, text }));
const check = (p: TalkPlan, npcId: string, said: string, name = 'el NPC') => talkProblems(p, { lines: says(npcId, said), narration: '', declared: null, pendingRoll: false, npcName: name });

function close(engine: Engine, c: Character, p: TalkPlan, text: string, extra: Record<string, unknown>): { ok?: boolean; error?: string } {
  const ctx: ToolContext = { engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], talk: p, action_text: text };
  return JSON.parse(executeTool(ctx, 'log_event', {
    narration_private: '', observable: null, observable_vague: null, loudness: 1, tags: 'social', suggested_actions: '',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: p.npc_id, ...extra,
  })) as { ok?: boolean; error?: string };
}

/** Un turno ya jugado con un NPC (lo que dijo el jugador y lo que contestó). */
function played(engine: Engine, c: Character, npcId: string, input: string, ...reply: string[]): void {
  engine.events.emit({ actor_id: c.id, action_type: 'master', input_text: input, narration_private: '', observable: null, tags: [], payload: { npc_id: npcId, lines: [{ speaker: 'actor', text: input }, ...says(npcId, ...reply)] } });
}

describe('capa 2: qué sabe del PJ («Humo y ceniza»)', () => {
  it('Garrán le conoce por su situación: nada de «¿y tú quién eres?» (turno 23)', async () => {
    const { engine, c } = await deudor();
    const p = planOf(engine, c, 'ir a hablar con garran');
    expect(p.intent).toBe('open');
    expect(p.state).toMatchObject({ knows: 'known', knows_pc_name: true, first_meeting: false });
    const h = talkHoles(p);
    expect(h.B).toContain('Le llama Pillin');
    expect(h.D).toContain('lo que debe y el plazo');
    expect(talkScript(engine.world, c, p)).toContain('Preguntarle quién es: ya sabe de él.');
    expect(check(p, 'npc_garran', '¿Y tú quién eres, que vienes a sentarte a mi mesa?').join(' ')).toContain('le pregunta quién es');
    expect(check(p, 'npc_garran', 'Pillin. ¿Vienes a pagar? Te quedan tres días.')).toEqual([]);
  });

  it('«¿no sabes quién soy?»: lo que sabe de él, claro y sin contradecirse (turnos 24 y 25)', async () => {
    const { engine, c } = await deudor();
    const p = planOf(engine, c, 'Garrán, ¿no sabes quién soy?');
    expect(p.intent).toBe('identity');
    expect(talkHoles(p).C).toContain('Sabe quién es: Pillin');
    expect(check(p, 'npc_garran', 'No sé quién eres ni me importa.').join(' ')).toContain('dice que no le conoce');
    expect(check(p, 'npc_garran', 'Claro: Pillin, el que debe trescientos al regidor.')).toEqual([]);
  });

  it('un extraño de verdad saluda como tal y pregunta qué le trae; se presenta y lo aprende', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const hi = planOf(engine, kael, 'Hola, Brenna');
    expect(hi.state.knows).toBe('none');
    expect(talkHoles(hi).B).toContain('Saludo de extraño');
    expect(talkHoles(hi).E).toBe('Pregunta quién es o qué le trae.');
    expect(check(hi, 'npc_brenna', 'Buenas, Kael.').join(' ')).toContain('no sabe su nombre');
    expect(introducesAs('Brenna, me llamo Kael', 'Kael')).toBe(true);
    const intro = planOf(engine, kael, 'Brenna, me llamo Kael');
    expect(intro.intent).toBe('identity');
    expect(talkHoles(intro).C).toContain('Se le presenta');
    expect(close(engine, kael, intro, 'Brenna, me llamo Kael', { lines: says('npc_brenna', 'Kael. Bien. ¿Qué te pongo?') }).error).toBeUndefined();
    expect(engine.world.npc('npc_brenna').knows_name_of).toContain('ch_kael');
    expect(planOf(engine, kael, 'Brenna, otra cosa').state.knows_pc_name).toBe(true);
  });
});

describe('capa 5: abrir la charla no es pedir trabajo («Humo y ceniza», turno 47)', () => {
  it('«ir hablar con Brenna»: le reconoce y le pregunta qué quiere; ni misión ni «ya que lo preguntas»', async () => {
    const { engine, c } = await deudor();
    const p = planOf(engine, c, 'ir hablar con Brenna');
    expect(p.intent).toBe('open');
    expect(p.situation).not.toBe('offer');
    expect(talkHoles(p).C).toContain('Una invitación corta');
    expect(check(p, 'npc_brenna', 'Ya que lo preguntas. El de la puerta no ha cenado.').join(' ')).toContain('no ha preguntado');
  });

  it('la línea del actor inventada en la que se apoya el NPC se reescribe', async () => {
    const { engine, c } = await deudor();
    const p = planOf(engine, c, 'ir hablar con Brenna');
    const r = close(engine, c, p, 'ir hablar con Brenna', { lines: [{ speaker: 'actor', npc_id: null, text: 'Brenna, ¿tienes algo que hacer? Lo que sea.' }, ...says('npc_brenna', 'Pues mira, algo hay.')] });
    expect(r.error).toContain('Pones en boca del actor');
  });

  it('señales: abrir, quién es quién, calmar, decir que sí', () => {
    expect(textSignals('ir hablar con Brenna').opens).toBe(true);
    expect(textSignals('ir a hablar con garran').opens).toBe(true);
    expect(textSignals('hablar con Brenna sobre el pozo').opens).toBe(false);
    expect(textSignals('no sabe quien soy?').identity).toBe(true);
    expect(textSignals('vale vale, no te enfades').calm).toBe(true);
    expect(textSignals('Sí, cuéntame').affirmative).toBe(true);
    const st = { pending: [], npc_asked: true, hinted: false };
    expect(intentOf(st, textSignals('Del sur, de Vharn'), [], 'Del sur, de Vharn')).toBe('answer');
    expect(intentOf({ ...st, npc_asked: false }, textSignals('Pedir una jarra a la tabernera'), [], 'Pedir una jarra a la tabernera')).toBe('trade');
  });
});

describe('capa 4: la misión madura se insinúa y espera', () => {
  it('a la tercera la deja caer; con un «sí» a eso, sale', async () => {
    const { engine, time } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    engine.world.campaign.board.active_job_ids.push('job_lena');
    played(engine, kael, 'npc_brenna', 'Hola, Brenna', 'Buenas.');
    time.advanceGame(60);
    played(engine, kael, 'npc_brenna', '¿Qué tal el día?', 'Largo.');
    time.advanceGame(60);
    const p = planOf(engine, kael, 'Qué frío hace esta noche, Brenna');
    expect(p.state.ripe).toBe(true);
    expect(p.situation).not.toBe('offer');
    expect(talkHoles(p).D).toContain('deja caer');
    expect(check(p, 'npc_brenna', 'Y lo que queda. Lo de la leña para la posada sigue en pie.').join(' ')).toContain('sin que el actor la pida');
    played(engine, kael, 'npc_brenna', 'Qué frío hace esta noche, Brenna', 'Y lo que queda. Si quieres ganarte unas monedas, me hace falta leña.');
    time.advanceGame(60);
    const yes = planOf(engine, kael, 'Sí, cuéntame, Brenna');
    expect(yes.intent).toBe('work');
    expect(yes.situation).toBe('offer');
    expect(talkHoles(yes).D).toContain('Le da UNA');
  });
});

describe('capa 1: lo urgente', () => {
  it('con la taberna en llamas no hay precio que valga; la alarma se quita', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const loc = engine.world.spot(engine.world.npc('npc_brenna').location.id).location_id;
    setAlarm(engine.world, loc, { kind: 'fire', text: 'arde la cocina', minutes: null, by: 'master' }, engine.nowFor(kael));
    const p = planOf(engine, kael, 'Brenna, ¿cuánto cuesta la cerveza?');
    expect(p.situation).toBe('danger');
    const h = talkHoles(p);
    expect(h.A).toContain('arde la cocina');
    expect([h.B, h.C, h.D, h.E]).toEqual([null, null, null, null]);
    expect(talkReply(actionContext(engine, kael, 'Brenna, ¿cuánto cuesta la cerveza?'))).toBe('¡Ahora no! ¿No ves lo que pasa?');
    clearAlarm(engine.world, loc);
    expect(planOf(engine, kael, 'Brenna, ¿cuánto cuesta la cerveza?').situation).toBe('trade');
  });

  it('lo robado: lo echa en falta, sospecha de quien estaba cerca y lo reconoce si lo ve', async () => {
    const { engine, c } = await deudor();
    const garran = engine.world.npc('npc_garran');
    const key = engine.world.itemInstances.get('ii_llave_arcon')!;
    const now = engine.nowFor(c);
    key.location = { type: 'character', id: c.id, slot: { kind: 'pocket' } };
    key.state['stolen'] = { from_npc_id: garran.id, game_s: now - 7200, roll_total: 1, near: [c.id] };
    expect(theftWith(engine.world, garran, c)).toBeNull();
    expect(noticeThefts(engine.world, now).map((x) => x.npc.id)).toEqual(['npc_garran']);
    expect(theftWith(engine.world, garran, c)?.kind).toBe('suspects');
    expect(talkHoles(planOf(engine, c, 'Hola, Garrán')).A).toContain('sospecha del actor');
    key.location = { type: 'character', id: c.id, slot: { kind: 'hand', which: 'main' } };
    expect(talkHoles(planOf(engine, c, 'Hola, Garrán')).A).toContain('se lo reclama');
  });

  it('un robo con una tirada alta no se nota', async () => {
    const { engine, c } = await deudor();
    const key = engine.world.itemInstances.get('ii_llave_arcon')!;
    const now = engine.nowFor(c);
    key.location = { type: 'character', id: c.id, slot: { kind: 'pocket' } };
    key.state['stolen'] = { from_npc_id: 'npc_garran', game_s: now - 7200, roll_total: 40, near: [c.id] };
    expect(noticeThefts(engine.world, now)).toEqual([]);
    expect(noticeThefts(engine.world, now + 60)).toEqual([]); // una vez por hora
  });
});

describe('capa 3: la escalada sube y baja', () => {
  it('dos insultos la llevan a harto y el tercero corta; una disculpa la baja', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    played(engine, kael, 'npc_brenna', 'Brenna, eres una inútil', 'Cuidado.');
    expect(planOf(engine, kael, 'Brenna, ¿y la cerveza?').state.escalation).toBe('annoyed');
    played(engine, kael, 'npc_brenna', 'Brenna, idiota', 'Una más y te vas.');
    const third = planOf(engine, kael, 'Brenna, basura');
    expect(third.state.escalation).toBe('fed_up');
    expect(third.cut).toBe(true);
    expect(talkHoles(third).E).toContain('Corta la charla');
    expect(talkReply(actionContext(engine, kael, 'Brenna, basura'))).toBe('Se acabó. Déjame en paz.');
    played(engine, kael, 'npc_brenna', 'Perdona, Brenna, no quería ofender', 'Ya.');
    expect(planOf(engine, kael, 'Brenna, ¿y la cerveza?').state.escalation).toBe('annoyed');
  });

  it('talk_deescalate solo vale si había tensión', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const p = planOf(engine, kael, 'Brenna, ¿qué tal?');
    expect(close(engine, kael, p, 'Brenna, ¿qué tal?', { lines: says('npc_brenna', 'Bien.'), talk_deescalate: 'le arregla la puerta' }).error).toContain('no estaba molesto');
  });
});

describe('nivel de relleno', () => {
  it('un vecino recorre el mismo flujo, sin misiones y en dos frases', async () => {
    const { engine, c } = await deudor();
    const extra = [...engine.world.npcs.values()].find((n) => n.tier === 'extra' && n.status === 'alive');
    if (!extra) return; // sin vecinos de relleno en esta campaña
    c.location = { type: 'spot', id: extra.location.id };
    const first = extra.name.split(/\s+/)[0]!;
    const p = planOf(engine, c, `${first}, ¿tienes trabajo para mí?`);
    expect(p.level).toBe('extra');
    expect(p.situation).not.toBe('offer');
    expect(talkHoles(p).D).toBeNull();
    expect(planWords(p)).toBe(25);
    expect(talkScript(engine.world, c, p)).toContain('vecino de relleno');
  });
});
