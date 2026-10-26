/**
 * Hallazgos del máster en la partida online del 26-10-2026 (Leodhin y MIAU),
 * con los textos reales que escribió el modelo (brezal.events.jsonl, seq entre
 * paréntesis). Revisión: Obsidian, «Revisión partida 2026-10-26», «Hallazgos
 * nuevos» 1, 2, 3, 4, 7 y 9.
 */
import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, repairToolInput, type ToolContext } from '../src/ai/tools.js';
import { emptyClose, isPlaceholder, saidByPlayer, withoutSelfCorrection } from '../src/engine/closecheck.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike } from '../src/engine/engine.js';
import type { Character } from '../src/engine/model.js';
import { sayLooksLikeAction } from '../src/engine/party.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Los dos PJ del demo con los nombres de la partida: Kael hace de Leodhin y Mira de MIAU. */
async function partida(opts: { tense?: boolean } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { groupWindowMs: 150, roundMs: 5000 });
  const leodhin = engine.world.character('ch_kael');
  const miau = engine.world.character('ch_mira');
  leodhin.name = 'Leodhin'; miau.name = 'MIAU';
  miau.location = { type: 'spot', id: 'sp_tab_barra' };
  leodhin.location = { type: 'spot', id: 'sp_tab_barra' };
  if (!leodhin.knows.includes(miau.id)) leodhin.knows.push(miau.id);
  if (!miau.knows.includes(leodhin.id)) miau.knows.push(leodhin.id);
  engine.setPresence(leodhin.id, true); engine.setPresence(miau.id, true);
  if (opts.tense) engine.world.location('loc_taberna').state['tense'] = true;
  return { engine, time, leodhin, miau };
}

const toolCtx = (engine: Engine, actor: Character): ToolContext => ({ engine, actor, nowGameS: engine.nowFor(actor), rng: seededRng(1), closed: null, rolls: [], progress: [] });

/** Máster falso: cada llamada la resuelve `close` con tools reales; apunta qué se le pidió. */
function fakeMaster(engine: Engine, close: (ctx: ToolContext, text: string) => void) {
  const calls: { actor: string; text: string }[] = [];
  const m: MasterLike = {
    async resolve(actor, text) {
      calls.push({ actor: actor.id, text });
      actionContext(engine, actor, text);
      const ctx = toolCtx(engine, actor);
      close(ctx, text);
      return { ok: true as const, usage: {}, calls: [], context: '', model: 'falso', closed: ctx.closed ?? { narration_private: 'Sin cierre.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
    },
  };
  engine.attachMaster(m);
  return calls;
}

/** El cierre de log_event tal cual lo mandó Haiku: los campos que no vienen, a null. */
const logInput = (fields: Record<string, unknown>): Record<string, unknown> => ({
  observable: null, observable_vague: null, loudness: 1, tags: '', suggested_actions: '', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null,
  requires_roll_advantage: null, requires_roll_target: null, decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null,
  names_learned: null, places_learned: null, introduces_self: false, target_character_id: null, observable_target: null, lines: null, ...fields,
});

describe('n.º 1: ningún cierre pasa sin un control mínimo', () => {
  // seq 50, «yo tambien quiero»: tras el rechazo por relleno de conversación, el segundo cierre.
  const basura = logInput({ narration_private: 'placeholder', observable: 'x', observable_vague: 'x', loudness: 0.3, tags: 'x', suggested_actions: '' });

  it('el cierre «placeholder» / «x» se rechaza aunque los validadores de un solo rechazo ya se hayan gastado', async () => {
    const { engine, miau } = await partida();
    const ctx = toolCtx(engine, miau);
    // Como en la partida: el validador de conversación ya había rechazado una vez (y los demás también).
    Object.assign(ctx, { conversation_rejections: 1, shared_rejections: 1, deal_rejections: 1, others_rejections: 1, place_rejections: 1, order_rejections: 1, death_rejections: 2 });
    const r = JSON.parse(executeTool(ctx, 'log_event', basura)) as { error?: string };
    expect(r.error).toMatch(/^narration_private, observable, observable_vague es relleno/);
    expect(ctx.closed).toBeNull();
    // Insistir no lo hace pasar.
    expect(JSON.parse(executeTool(ctx, 'log_event', basura)).error).toMatch(/es relleno/);
    expect(ctx.closed).toBeNull();
  });

  it('el relleno de un solo campo también cuenta, y las etiquetas «x» se tiran', async () => {
    const { engine, miau } = await partida();
    const ctx = toolCtx(engine, miau);
    expect(JSON.parse(executeTool(ctx, 'log_event', logInput({ narration_private: 'Brenna te sirve una jarra.', observable_vague: 'x' }))).error).toMatch(/^observable_vague es relleno/);
    expect(JSON.parse(executeTool(ctx, 'log_event', logInput({ narration_private: 'Brenna te sirve una jarra.', observable: 'Brenna sirve a MIAU.', tags: 'x, social', suggested_actions: 'x | Pagar la jarra' }))).ok).toBe(true);
    expect(ctx.closed!.tags).toEqual(['social']);
    expect(ctx.closed!.suggested_actions).toEqual(['Pagar la jarra']);
  });

  it('un cierre sin nada que leer se rechaza; vacío con lo dicho en lines sigue valiendo', async () => {
    const { engine, miau } = await partida();
    const ctx = toolCtx(engine, miau);
    expect(JSON.parse(executeTool(ctx, 'log_event', logInput({ narration_private: '' }))).error).toMatch(/^narration_private está vacía/);
    expect(JSON.parse(executeTool(ctx, 'log_event', logInput({ narration_private: '', npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Treinta. Igual para los dos.' }] }))).ok).toBe(true);
  });

  it('isPlaceholder: relleno sí, narración y frases cortas de verdad no', () => {
    for (const t of ['placeholder', 'x', 'XX', '...', '…', 'n/a', 'TODO', '[narración]', 'Placeholder text', 'null']) expect(isPlaceholder(t), t).toBe(true);
    for (const t of ['', 'Sí.', 'Treinta. Igual para los dos.', 'Brenna responde a MIAU con el precio de la jarra y espera.']) expect(isPlaceholder(t), t).toBe(false);
    expect(emptyClose({ narration: '  ' })).toBe(true);
    expect(emptyClose({ narration: '', lines: [{ speaker: 'actor', text: 'yo tambien quiero' }] })).toBe(false);
  });
});

describe('n.º 2: autocorrección del modelo en el texto', () => {
  // seq 169, «vamos»: observable que leyó Leodhin.
  const real = 'MIAU Lenzo... no. MIAU se queda junto a la barra, en silencio, con la mirada puesta en la guardia.';

  it('se quita el arranque en falso y queda la frase buena', () => {
    expect(withoutSelfCorrection(real)).toBe('MIAU se queda junto a la barra, en silencio, con la mirada puesta en la guardia.');
    expect(withoutSelfCorrection('Brenna te mira. Ves a Garrán... no, Hugo bebe solo en la barra.')).toBe('Brenna te mira. Hugo bebe solo en la barra.');
  });

  it('lo que dice alguien entre «» puede titubear y no se toca; la narración normal tampoco', () => {
    expect(withoutSelfCorrection('Ilse baja la vista. «Yo... no. No puedo.»')).toBe('Ilse baja la vista. «Yo... no. No puedo.»');
    expect(withoutSelfCorrection('Garrán ya no está en la sala: se fue de la barra a las 20:00.')).toBe('Garrán ya no está en la sala: se fue de la barra a las 20:00.');
    expect(withoutSelfCorrection('La puerta cede... no del todo: queda entornada.')).toBe('La puerta cede... no del todo: queda entornada.');
  });

  it('el cierre real de seq 169 llega limpio a los dos', async () => {
    const { engine, miau } = await partida();
    const ctx = toolCtx(engine, miau);
    const r = JSON.parse(executeTool(ctx, 'log_event', logInput({
      narration_private: 'Garrán ya no está en la sala: se fue de la barra a las 20:00. Tu «vamos» puede ser un sí a Leodhin o una simple señal, y la sala lo oye todo. Antes de moverte, dime qué quieres hacer.',
      observable: real, observable_vague: 'Una figura junto a la barra se queda quieta, en silencio.', loudness: 0.3, tags: 'social, ambiguous',
      lines: [{ speaker: 'actor', npc_id: null, text: 'vamos' }],
    }))) as { ok?: boolean; error?: string };
    expect(r.error).toBeUndefined();
    expect(ctx.closed!.observable).toBe('MIAU se queda junto a la barra, en silencio, con la mirada puesta en la guardia.');
  });
});

describe('n.º 3: el máster no pone frases en boca de los jugadores en los turnos compartidos', () => {
  it('saidByPlayer con las entradas reales', () => {
    expect(saidByPlayer('Ya lo estoy. Quédate quieto.', 'le doy un abrazo para que no pueda atacar mas')).toBe(false); // seq 133
    expect(saidByPlayer('¡Ahora!', 'lanza le primer conjuro que tengas en la memoria')).toBe(false); // seq 178
    expect(saidByPlayer('¡Quieto!', 'le ataco con la espada !')).toBe(false); // seq 178
    expect(saidByPlayer('yo tambien quiero', 'yo tambien quiero')).toBe(true); // seq 50
    expect(saidByPlayer('Para comprobar si estás vivo.', 'darle un cachete a MIAU para saber si esta vivo')).toBe(true); // seq 133
    expect(saidByPlayer('¡Quieto!', null)).toBe(false); // dudó: no dijo nada
  });

  it('seq 133 (ronda): el abrazo de MIAU no trae «Ya lo estoy. Quédate quieto.»; la frase de Leodhin se queda', async () => {
    const { engine, leodhin, miau } = await partida({ tense: true });
    const results: Record<string, unknown>[] = [];
    fakeMaster(engine, (ctx) => {
      results.push(JSON.parse(executeTool(ctx, 'log_event', logInput({
        narration_private: 'Leodhin, le das un cachete seco a MIAU para comprobar si sigue vivo. La cabeza le cae hacia un lado y vuelve a toser, con los ojos abiertos y sin soltar tu muñeca. MIAU, sin mirarte, te rodea con los brazos y te sujeta contra su pecho con fuerza de sobra: te quedas inmovilizado, sin poder alzar el bastón. Ha sido la única forma de que no vuelva a golpear a nadie.',
        observable: 'Leodhin le da un cachete a MIAU, que vuelve a toser con los ojos abiertos. MIAU rodea a Leodhin con los brazos y lo sujeta contra su pecho, inmovilizándolo.',
        observable_vague: 'Dos figuras forcejean junto a la puerta de la taberna; una se queda abrazada a la otra.', tags: 'combate, social',
        lines: [{ speaker: 'actor', npc_id: null, text: 'Para comprobar si estás vivo.' }, { speaker: 'pc', character_id: miau.id, text: 'Ya lo estoy. Quédate quieto.' }],
      }))));
    });
    const [a] = await Promise.all([engine.act(leodhin.id, 'darle un cachete a MIAU para saber si esta vivo'), engine.act(miau.id, 'le doy un abrazo para que no pueda atacar mas')]);
    expect(results.at(-1)).toEqual({ ok: true, closed: true });
    const ev = a.event!;
    expect(ev.narration_private).not.toContain('Quédate quieto');
    expect(ev.narration_private).toContain('«Para comprobar si estás vivo.»');
    expect(ev.payload['lines']).toEqual([{ speaker: 'actor', text: 'Para comprobar si estás vivo.' }]);
  });

  it('seq 178 (ronda): ni «¡Ahora!» para Leodhin ni «¡Quieto!» para MIAU', async () => {
    const { engine, leodhin, miau } = await partida({ tense: true });
    const errors: string[] = [];
    fakeMaster(engine, (ctx) => {
      const input = logInput({
        narration_private: 'Lo que sale de tu memoria es lo único que tienes preparado: la luz torpe. Se hincha de nuevo en el aire del Jabalí, huele a cuerno quemado y, antes de que tome forma, MIAU ya ha descargado la maza sobre el hombro de la guardia: el golpe atraviesa la cota. La lanza cae con un ruido seco sobre las tablas. «¡Ahora!» «¡Quieto!»',
        observable: 'Leodhin levanta el bastón y la luz torpe vuelve a encenderse sobre la sala. MIAU descarga la maza sobre el hombro de la guardia.',
        observable_vague: 'Un destello y un golpe seco.', loudness: 3, tags: 'combat',
        lines: [{ speaker: 'pc', character_id: leodhin.id, text: '¡Ahora!' }, { speaker: 'pc', character_id: miau.id, text: '¡Quieto!' }],
      });
      // Primero lo rechaza la sincronía (no nombra a Leodhin, «tu memoria» a secas); el segundo intento pasa.
      const first = JSON.parse(executeTool(ctx, 'log_event', input)) as { error?: string };
      if (first.error) errors.push(first.error);
      executeTool(ctx, 'log_event', input);
    });
    const [a] = await Promise.all([engine.act(leodhin.id, 'lanza le primer conjuro que tengas en la memoria'), engine.act(miau.id, 'le ataco con la espada !')]);
    expect(errors[0]).toMatch(/no responde a Leodhin/);
    const ev = a.event!;
    expect(ev.narration_private).not.toMatch(/¡Ahora!|¡Quieto!/);
    expect(ev.narration_private).toMatch(/la lanza cae con un ruido seco sobre las tablas\.$/i);
    expect(ev.payload['lines'] ?? []).toEqual([]);
  });
});

describe('n.º 4: parámetros de tool rotos dentro de otro valor', () => {
  it('seq 124: la nota de memoria se corta y la importancia 2 se rescata', () => {
    const { input, repaired } = repairToolInput({
      npc_memory_note: 'Leodhin le entregó el agua fresca del pozo a cambio de la poción de curación, y ella se la dio.</npc_memory_note>\n<parameter name="npc_memory_importance">2',
      npc_memory_importance: null,
    });
    expect(input['npc_memory_note']).toBe('Leodhin le entregó el agua fresca del pozo a cambio de la poción de curación, y ella se la dio.');
    expect(input['npc_memory_importance']).toBe(2);
    expect(repaired).toEqual(['npc_memory_importance']);
  });

  it('seq 176: observable_vague se corta y el volumen 3 se rescata; lo que no es del tool se descarta', () => {
    const known = new Set(['observable_vague', 'loudness']);
    const { input } = repairToolInput({
      observable_vague: 'Una figura descarga un golpe contra la guardia, que se aparta trastabillando. Otra sostiene algo en alto con una luz torpe entre ambos.</observable_vague>\n<parameter name="loudness">3</parameter>\n<parameter name="inventado">sí',
    }, known);
    expect(input['observable_vague']).toBe('Una figura descarga un golpe contra la guardia, que se aparta trastabillando. Otra sostiene algo en alto con una luz torpe entre ambos.');
    expect(input['loudness']).toBe(3);
    expect(input).not.toHaveProperty('inventado');
  });

  it('un valor que ya venía no se pisa', () => {
    const { input } = repairToolInput({ npc_memory_note: 'Pagó.</npc_memory_note>\n<parameter name="npc_memory_importance">3', npc_memory_importance: 1 });
    expect(input['npc_memory_importance']).toBe(1);
  });

  it('por executeTool: la memoria del NPC guarda la nota limpia con importancia 2 y el cierre lleva volumen 3', async () => {
    const { engine, leodhin } = await partida();
    const ctx = toolCtx(engine, leodhin);
    const r = JSON.parse(executeTool(ctx, 'log_event', logInput({
      narration_private: 'Brenna guarda las monedas sin contarlas.', npc_id: 'npc_brenna', tags: 'social, trade',
      npc_memory_note: 'Leodhin le entregó el agua fresca del pozo a cambio de la poción de curación, y ella se la dio.</npc_memory_note>\n<parameter name="npc_memory_importance">2',
      // En la partida el volumen no venía: estaba dentro de observable_vague.
      observable_vague: 'Alguien habla en la barra.</observable_vague>\n<parameter name="loudness">3', loudness: undefined,
    }))) as { ok?: boolean; error?: string };
    expect(r.error).toBeUndefined();
    const mem = engine.world.npc('npc_brenna').memory.at(-1)!;
    expect(mem).toMatchObject({ note: 'Leodhin le entregó el agua fresca del pozo a cambio de la poción de curación, y ella se la dio.', importance: 2 });
    expect(ctx.closed!.observable_vague).toBe('Alguien habla en la barra.');
    expect(ctx.closed!.loudness).toBe(3);
  });
});

describe('n.º 7: tras un move_to del máster no hay otra narración de llegada', () => {
  it('seq 55 → 59 → 60: «Salir por la puerta» los dos; una sola llamada al máster y ninguna escena de llegada', async () => {
    const { engine, leodhin, miau } = await partida({ tense: true });
    leodhin.location = { type: 'spot', id: 'sp_tab_puerta' };
    miau.location = { type: 'spot', id: 'sp_tab_puerta' };
    const moves: Record<string, unknown>[] = [];
    const calls = fakeMaster(engine, (ctx) => {
      // Como en la partida: el máster mueve a los dos y cierra con una narración para ambos.
      for (const id of [leodhin.id, miau.id]) moves.push(JSON.parse(executeTool(ctx, 'move_to', { character_id: id, target_spot_id: 'sp_pl_taberna', target_location_id: null, pace: 'walk' })));
      executeTool(ctx, 'log_event', logInput({
        narration_private: 'Leodhin y MIAU salen juntos por la puerta de la taberna, uno tras otro, sin mirar atrás. Al cruzar el umbral gastado, el aire frío de la plaza os golpea con olor a ceniza.',
        observable: 'Leodhin y MIAU salen juntos de la taberna.', tags: 'movement',
      }));
    });
    await Promise.all([engine.act(leodhin.id, 'Salir por la puerta'), engine.act(miau.id, 'Salir por la puerta')]);
    await new Promise((r) => setTimeout(r, 30));
    await engine.tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(moves.map((m) => m['arrived'])).toEqual([true, true]);
    expect(engine.world.characterSpot(leodhin)!.id).toBe('sp_pl_taberna');
    expect(engine.world.characterSpot(miau)!.id).toBe('sp_pl_taberna');
    // Antes: 3 narraciones (la del turno y una llegada para cada uno). Ahora, solo la del turno.
    expect(calls).toHaveLength(1);
    const evs = engine.events.all();
    expect(evs.filter((e) => e.action_type === 'master_arrival')).toEqual([]);
    // La llegada queda como aviso para los demás, sin texto para el que llega.
    expect(evs.filter((e) => e.action_type === 'arrived' && e.actor_id === miau.id).map((e) => e.narration_private)).toEqual(['']);
  });
});

describe('n.º 9: el modo Decir no convierte acciones en frases dichas', () => {
  it('las dos acciones que salieron dichas en la partida van al narrador', () => {
    expect(sayLooksLikeAction('vamos hablar con lka tabernera')).toBe(true); // seq 33
    expect(sayLooksLikeAction('dar mis monedas')).toBe(true); // seq 48
    expect(sayLooksLikeAction('le doy un abrazo para que no pueda atacar mas')).toBe(true);
  });

  it('todo lo demás que dijeron en Decir se sigue diciendo', () => {
    for (const t of ['que pasa kiwi', 'hola kiwi', 'hola', 'creo que nos esta timandop', 'que pasa rtio', 'vamos ala taberna tio', 'a tomar un buen etofado', 'y olvidar nuestras rencillas', 'ataquemos a Garran, es debil', 'juntos¿?', 'ataquemos...ahora!', 'hola !']) {
      expect(sayLooksLikeAction(t), t).toBe(false);
    }
    // Con raya o comillas, o preguntando, se dice tal cual aunque empiece por un verbo.
    expect(sayLooksLikeAction('— dar mis monedas, eso te pido')).toBe(false);
    expect(sayLooksLikeAction('¿ir a la plaza ahora?')).toBe(false);
  });
});
