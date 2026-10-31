/**
 * Partidas por perfil del 31-10-2026 (docs/PLAYTEST-2026-10-31.md): frases normales que capturaba el motor, opciones
 * de trasfondo repetidas, el primer instante en cada turno, golpes sin tirada y pagos solo de palabra.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { seededRng } from '../src/engine/dice.js';
import { isLeaveTalk } from '../src/engine/scene.js';
import { freshTagOptions } from '../src/engine/worldrules.js';
import { coinsWithoutTool, dealWithoutState, declaredStrike, strikeWithoutAttack } from '../src/engine/closecheck.js';
import type { Character, GameEvent } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(master?: Parameters<typeof Engine.boot>[0]['master']) {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false, ...(master ? { master } : {}) });
  return { engine, time };
}

async function newPc(engine: Engine, class_id = 'barbarian'): Promise<Character> {
  const r = await engine.createCharacter('u_nia', 'Nia', { class_id });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return r.character;
}

const ctxFor = (engine: Engine, c: Character, text: string): ToolContext => ({ engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: text });
const close = (over: Record<string, unknown> = {}) => ({
  narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: '', suggested_actions: '',
  requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, npc_id: null, lines: [], ...over,
});
const out = (s: string) => JSON.parse(s) as Record<string, unknown> & { ok?: boolean; error?: string };

describe('frases normales que empiezan como una orden', () => {
  it('«me despido» solo es la orden si no sigue contando algo', () => {
    for (const t of ['Me despido', 'me despido.', 'Me despido de Hugo', 'despedirme de la tabernera', 'dejar la conversación', 'Dejo de hablar con Osric Malvez']) expect(isLeaveTalk(t), t).toBe(true);
    for (const t of [
      'Me despido de Hugo con un silbido y echo a correr hacia la plaza',
      'Me despido de Mateo con calma y paseo despacio hacia el Lindero',
      'Me despido de Hugo y salgo',
    ]) expect(isLeaveTalk(t), t).toBe(false);
  });

  it('quieto, «me detengo junto a…» va al máster; la orden sola y de camino, no', async () => {
    const said: string[] = [];
    const master = { resolve: async (_c: Character, text: string) => { said.push(text); return { ok: true, text: 'Narrado.' }; } };
    const { engine } = await boot(master as never);
    const c = await newPc(engine);
    const frase = 'Me detengo junto a la cerca, dejo que el barro me llegue a los tobillos';
    const eng = engine as unknown as { isMechanical(c: Character, t: string): boolean };
    expect(eng.isMechanical(c, frase)).toBe(false);
    expect(eng.isMechanical(c, 'me detengo')).toBe(true);
    expect((await engine.act(c.id, 'me detengo')).text).toBe('No ibas a ningún sitio.');
    c.transit = { destination_spot_id: 'sp_pl_pozo' } as never;
    expect(eng.isMechanical(c, frase)).toBe(true);
  });
});

describe('detector de tratos: lo que no cierra nada', () => {
  it('negarse a fiar y explicar cómo va una prenda no son un trato', () => {
    expect(dealWithoutState({ narration: '«Cuatro de cobre la cerveza. Al contado, que lo fiado ya me pesa bastante.»', okTools: [] })).toEqual([]);
    expect(dealWithoutState({ narration: '«Deja algo en prenda y el regidor decide. Tú no tienes casa aquí, así que no te toca.»', okTools: [] })).toEqual([]);
    expect(dealWithoutState({ narration: 'Son de Hugo: nombres de vecinos, cifras de carbón y clavos fiados.', okTools: [] })).toEqual([]);
  });
  it('un trato de verdad sigue saltando', () => {
    expect(dealWithoutState({ narration: 'Brenna asiente. «Te la dejo fiada hasta mañana.»', okTools: [] })).toHaveLength(1);
    expect(dealWithoutState({ narration: 'Brenna se queda la daga en prenda de lo que debes.', okTools: [] })).toEqual(['en prenda']);
  });
});

describe('opciones de trasfondo', () => {
  const opt = '[Noble] Recordarle con quién está hablando (Intimidación CD 12)';
  const ev = (game_s: number, suggested: string[]) => ({ actor_id: 'pc', timestamp_game_s: game_s, payload: { suggested_actions: suggested } }) as unknown as GameEvent;

  it('se ofrece una vez por charla y vuelve en otra', () => {
    expect(freshTagOptions([opt], [], 'pc', 100)).toEqual([opt]);
    expect(freshTagOptions([opt], [ev(100, [opt])], 'pc', 160)).toEqual([]);
    expect(freshTagOptions([opt], [ev(100, [opt])], 'pc', 100 + 3700)).toEqual([opt]);
    expect(freshTagOptions([opt], [ev(100, [opt])], 'otro', 160)).toEqual([opt]);
  });
});

describe('primer instante', () => {
  it('llega a la apertura y no a los turnos siguientes; el resto de la historia, sí', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    c.backstory = 'Por qué está aquí: una carta.\nCaminos: 1) el pozo.\nPrimer instante: Fuera, unas botas se paran delante de la puerta.';
    const intro = actionContext(engine, c, '', undefined, { origin: 'x', welcome: 'y' });
    const turno = actionContext(engine, c, 'Miro alrededor');
    expect(intro).toContain('unas botas se paran');
    expect(turno).not.toContain('unas botas se paran');
    expect(turno).toContain('Por qué está aquí: una carta.');
  });
});

describe('golpe declarado', () => {
  it('reconoce el golpe y deja fuera amenazas, palabras y muebles', () => {
    for (const t of [
      'Le clavo el hacha en el hombro al alguacil antes de que termine de hablar, y empujo la puerta contra él.',
      'Me abalanzo sobre la figura del despacho y le hundo el filo en el hombro: ¡Esta vez no te escapas!',
      'Atacar a Garrán',
      'Le doy un puñetazo a Hugo en la boca',
      'Me lanzo hacia la reja y le clavo los dientes en el antebrazo mientras grito.',
      'Le lanzo el hacha de mano contra el pecho, y cuando se agache la hundo en la mesa.',
    ]) expect(declaredStrike(t), t).not.toBeNull();
    for (const t of [
      'Te rompo la cara si no hablas',
      'Hugo, o me cuentas qué sabías o te arranco la lengua y la clavo en ese yunque.',
      'Me planto ante Brenna con el hacha al hombro. ¡Siéntate y habla, o te parto la mesa con tu cabeza encima!',
      'Si no me dices ya dónde está, te parto las costillas aquí mismo, herrero.',
      'Agarro el hacha y le grito a Osric: «¡Ven aquí, cobarde, que te parto la cara!»',
      'Me pego a la pared del callejón y sigo la huella.',
      'Hundo la mano en el cubo turbio.',
      'Me planto frente a Osric, le clavo el hacha en el tablón a dos dedos de su cara.',
      'Clavo la mirada en Garrán.',
    ]) expect(declaredStrike(t), t).toBeNull();
  });

  const action = 'Le doy un puñetazo a Hugo en la boca';
  it('pasa con tirada de ataque, con ataque del PJ o con una razón; el golpe de un NPC no cuenta', () => {
    const base = { action, narration: 'Hugo te devuelve la mirada.', attackRoll: false, pcAttacked: false, okTools: ['attack'] };
    expect(strikeWithoutAttack(base)).toBe('le doy un punetazo');
    expect(strikeWithoutAttack({ ...base, attackRoll: true })).toBeNull();
    expect(strikeWithoutAttack({ ...base, pcAttacked: true })).toBeNull();
    expect(strikeWithoutAttack({ ...base, narration: 'Hugo no está aquí: se ha ido a la fragua hace rato. Ya no está.' })).toBeNull();
    expect(strikeWithoutAttack({ ...base, narration: 'Estiras el brazo entre los barrotes: la reja te lo impide.' })).toBeNull();
  });

  it('el cierre lo rechaza una vez y a la segunda deja pasar', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    const hugo = engine.world.npc('npc_hugo');
    c.location = { type: 'spot', id: hugo.location.id };
    const ctx = ctxFor(engine, c, action);
    const first = out(executeTool(ctx, 'log_event', close({ narration_private: 'Hugo te mira.' })));
    expect(first.error).toContain('requires_roll_kind=attack');
    expect(out(executeTool(ctx, 'log_event', close({ narration_private: 'Hugo te mira.' }))).ok).toBe(true);
  });

  it('con tirada de ataque pasa a la primera; tras la tirada, también', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    const hugo = engine.world.npc('npc_hugo');
    c.location = { type: 'spot', id: hugo.location.id };
    expect(out(executeTool(ctxFor(engine, c, action), 'log_event', close({ narration_private: 'Lanzas el puño.', requires_roll_kind: 'attack', requires_roll_key: 'melee', requires_roll_target: hugo.id }))).ok).toBe(true);
    engine.events.emit({ actor_id: c.id, action_type: 'roll', input_text: null, narration_private: '🎲', observable: null, tags: [], payload: {} }, engine.gameNow());
    expect(out(executeTool(ctxFor(engine, c, action), 'log_event', close({ narration_private: 'El puño le alcanza.' }))).ok).toBe(true);
  });
});

describe('monedas', () => {
  const dejar = 'Dejas las monedas sobre la madera, una a una, a la vista del regidor. Osric las cuenta con dos dedos.';

  it('pagar de palabra salta; con un tool, dicho o negado, no', () => {
    expect(coinsWithoutTool({ action: 'Pongo las doscientas monedas sobre la mesa.', narration: dejar, okTools: [] })).toBe('dejas las monedas');
    expect(coinsWithoutTool({ action: 'Pago', narration: 'Pagas la cuenta y te vas.', okTools: [] })).toBe('pagas');
    expect(coinsWithoutTool({ action: 'Te doy diez de plata', narration: 'Brenna recoge la moneda y la hace desaparecer.', okTools: [] })).not.toBeNull();
    expect(coinsWithoutTool({ action: 'x', narration: dejar, okTools: ['give_coins'] })).toBeNull();
    expect(coinsWithoutTool({ action: 'x', narration: dejar, okTools: ['settle_debt'] })).toBeNull();
    expect(coinsWithoutTool({ action: 'x', narration: dejar, okTools: [], pendingRoll: true })).toBeNull();
    expect(coinsWithoutTool({ action: 'x', narration: '«Te doy diez monedas», le dices. Ella no te mira.', okTools: [] })).toBeNull();
    expect(coinsWithoutTool({ action: 'x', narration: 'No le das ni una moneda.', okTools: [] })).toBeNull();
    expect(coinsWithoutTool({ action: 'x', narration: 'Te das cuenta de que las monedas no alcanzan.', okTools: [] })).toBeNull();
    expect(coinsWithoutTool({ action: 'Miro', narration: 'Garrán guarda sus monedas en la bolsa.', okTools: [] })).toBeNull();
  });

  it('give_coins descuenta, valida y necesita tener al NPC delante', async () => {
    const { engine } = await boot();
    const c = await newPc(engine);
    const hugo = engine.world.npc('npc_hugo');
    c.location = { type: 'spot', id: hugo.location.id };
    c.coins = 100;
    const ctx = ctxFor(engine, c, 'Le doy diez a Hugo');
    expect(out(executeTool(ctx, 'give_coins', { npc_id: hugo.id, amount: 1000, reason: 'soborno' })).error).toBe('not_enough_coins');
    expect(c.coins).toBe(100);
    expect(out(executeTool(ctx, 'give_coins', { npc_id: hugo.id, amount: 0, reason: 'soborno' })).error).toBeTruthy();
    expect(out(executeTool(ctx, 'give_coins', { npc_id: hugo.id, amount: 30, reason: 'soborno' })).ok).toBe(true);
    expect(c.coins).toBe(70);
    expect(out(executeTool(ctx, 'log_event', close({ narration_private: 'Le das treinta monedas y las coge sin mirar.' }))).ok).toBe(true);
  });
});
