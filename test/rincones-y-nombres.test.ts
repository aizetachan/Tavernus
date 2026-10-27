/**
 * Lo que sabe el PJ (bloque B1 de la revisión de la partida del 27-10-2026,
 * «La noche del Brezal»): los rincones de un sitio se descubren, los nombres
 * se aprenden al oírlos y la narración no dice los que el PJ no sabe. Los
 * textos son los que escribió el máster en la partida (seq entre paréntesis).
 * Revisión: Obsidian, «Revisión partida 2026-10-27», secciones 2 y 7, fallo 3.
 */
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { seededRng } from '../src/engine/dice.js';
import { claimSituation } from '../src/worldgen/index.js';
import { suggestActions } from '../src/engine/fastpath.js';
import { boardState } from '../src/adapters/web/board.js';
import { contractArticles, descriptorOf, maskUnknownNames } from '../src/engine/narrate.js';
import { confirmedNames, introducedIn, type NamedNpc } from '../src/engine/closecheck.js';
import { knownSpots, lookAround, migrateSpotSight, searchableSpots } from '../src/engine/spots.js';
import { npcLabel, npcTag } from '../src/engine/journal.js';
import { nameFor } from '../src/engine/story.js';
import { validateSnapshot } from '../src/worldgen/validate.js';
import type { Character } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  const r = await engine.createCharacter('u_leodhin', 'Leodhin', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  // Su situación inicial le presenta a alguien: aquí empieza sin conocer a nadie, como Leodhin con Hugo y Brenna.
  r.character.knows = [];
  return { engine, time, pc: r.character };
}

const ctxFor = (engine: Engine, c: Character, action: string | null = null): ToolContext =>
  ({ engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [], action_text: action });
const run = (ctx: ToolContext, name: string, input: Record<string, unknown>) =>
  JSON.parse(executeTool(ctx, name, input)) as Record<string, unknown> & { ok?: boolean; error?: string };

/** Anda hasta un punto por el camino del motor (move_to) y espera a llegar. */
async function walk(engine: Engine, time: ReturnType<typeof fakeTime>, c: Character, spotId: string): Promise<void> {
  const r = run(ctxFor(engine, c), 'move_to', { character_id: c.id, target_spot_id: spotId, pace: 'walk' });
  expect(r.error, `move_to ${spotId}: ${JSON.stringify(r)}`).toBeUndefined();
  if (c.transit) time.advanceGame(c.transit.arrives_game_s - engine.gameNow() + 2);
  await engine.tick();
  expect(engine.world.characterSpot(c)?.id).toBe(spotId);
}

/** El cierre de log_event: lo que no viene, a null. */
const logInput = (fields: Record<string, unknown>): Record<string, unknown> => ({
  observable: null, observable_vague: null, loudness: 1, tags: '', suggested_actions: '', requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null,
  requires_roll_advantage: null, requires_roll_target: null, decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null,
  names_learned: null, places_learned: null, introduces_self: false, target_character_id: null, observable_target: null, lines: null, ...fields,
});

const ids = (engine: Engine, c: Character) => knownSpots(engine.world, c, 'loc_taberna').map((s) => s.id).sort();

describe('rincones que se descubren (sección 7)', () => {
  it('al entrar al Jabalí por la puerta conoce lo que se ve: la mesa en penumbra y la trampilla, no', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_puerta');
    expect(ids(engine, pc)).toEqual(['sp_tab_barra', 'sp_tab_chimenea', 'sp_tab_habitacion', 'sp_tab_puerta']);
    const sug = suggestActions(engine.world, engine.clock, pc, engine.nowFor(pc), 6);
    expect(sug.join(' | ')).not.toMatch(/mesa del fondo|trampilla/);
    expect(sug).toContain('Mirar alrededor');
    // El tablero y el contexto del máster, igual.
    expect(boardState(engine, pc.id).spots.map((s) => s.id).sort()).toEqual(ids(engine, pc));
    const ctx = actionContext(engine, pc, 'mirar');
    const known = ctx.slice(ctx.indexOf('Puntos que el actor conoce:'), ctx.indexOf('Puntos que el actor aún no ha visto'));
    expect(known).toContain('la barra [sp_tab_barra]');
    expect(known).not.toContain('sp_tab_mesa');
    expect(ctx).toMatch(/aún no ha visto[^\n]*la mesa del fondo \[sp_tab_mesa\]/);
    expect(ctx).toMatch(/Ocultos[^\n]*la trampilla \[sp_tab_trampilla\] CD 14/);
    // La salida de la trampilla no sale entre las salidas.
    expect(ctx).not.toMatch(/- desde la trampilla/);
  });

  it('sube al cuarto y baja (seq 98): desde el cuarto no ve la sala, en la barra ve la mesa y la trampilla no sale nunca', async () => {
    const { engine, time, pc } = await boot();
    engine.world.spot('sp_tab_habitacion').state['unlocked_for'] = [pc.id];
    await walk(engine, time, pc, 'sp_tab_puerta');
    await walk(engine, time, pc, 'sp_tab_habitacion');
    expect(ids(engine, pc)).not.toContain('sp_tab_mesa');
    // Se despierta en el cuarto: lo que le sugiere el motor es lo que conoce, sin la trampilla ni la mesa.
    const woke = suggestActions(engine.world, engine.clock, pc, engine.nowFor(pc));
    expect(woke.join(' | ')).not.toMatch(/trampilla|mesa del fondo/);
    expect(woke.join(' | ')).toMatch(/Ir a la (barra|chimenea|puerta)|Salir hacia/);
    await walk(engine, time, pc, 'sp_tab_barra');
    expect(ids(engine, pc)).toContain('sp_tab_mesa');
    await walk(engine, time, pc, 'sp_tab_habitacion');
    const again = suggestActions(engine.world, engine.clock, pc, engine.nowFor(pc), 6);
    expect(again.join(' | ')).not.toMatch(/trampilla/);
    expect(ids(engine, pc)).not.toContain('sp_tab_trampilla');
  });

  it('mirar alrededor descubre la mesa del fondo; lo oculto, solo si su Percepción pasiva llega a la CD', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_puerta');
    pc.passive_perception = 11;
    expect(lookAround(engine.world, pc).map((s) => s.id)).toEqual(['sp_tab_mesa']);
    expect(ids(engine, pc)).not.toContain('sp_tab_trampilla');
    pc.passive_perception = 14;
    expect(lookAround(engine.world, pc).map((s) => s.id)).toEqual(['sp_tab_trampilla']);
  });

  it('«miro alrededor» con máster: el motor descubre la estancia aunque el máster no llame a discover_spot', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_puerta');
    pc.passive_perception = 10;
    const r = run(ctxFor(engine, pc, 'miro alrededor'), 'log_event', logInput({ narration_private: 'La sala es baja, con vigas negras y olor a humo.' }));
    expect(r.ok).toBe(true);
    expect(ids(engine, pc)).toContain('sp_tab_mesa');
    expect(ids(engine, pc)).not.toContain('sp_tab_trampilla');
  });

  it('buscar sin máster: Percepción contra la CD 14 de la trampilla, desde la sala y no desde el cuarto', async () => {
    const { engine, time, pc } = await boot();
    engine.world.spot('sp_tab_habitacion').state['unlocked_for'] = [pc.id];
    await walk(engine, time, pc, 'sp_tab_puerta');
    await walk(engine, time, pc, 'sp_tab_habitacion');
    expect(searchableSpots(engine.world, pc)).toEqual([]);
    await walk(engine, time, pc, 'sp_tab_mesa');
    expect(searchableSpots(engine.world, pc).map((s) => s.id)).toEqual(['sp_tab_trampilla']);
    const r = await engine.act(pc.id, 'busco');
    const total = Number(/= (-?\d+)/.exec(r.text)?.[1]);
    expect(Number.isFinite(total)).toBe(true);
    expect(ids(engine, pc).includes('sp_tab_trampilla')).toBe(total >= 14);
    expect(r.text).toMatch(total >= 14 ? /Encuentras la trampilla/ : /no encuentras nada/);
  });

  it('lo que nombra un NPC queda sabido, aunque esté oculto: «la trampilla de la mesa del fondo»', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_barra');
    const r = run(ctxFor(engine, pc, 'pregunto a la tabernera por el sótano'), 'log_event', logInput({
      narration_private: 'La tabernera baja la voz.', npc_id: 'npc_brenna',
      lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Bajo la alfombra, la trampilla. No se lo digas a nadie.' }],
    }));
    expect(r.ok).toBe(true);
    expect(ids(engine, pc)).toContain('sp_tab_trampilla');
  });

  it('la narración no muestra la trampilla sin buscarla (se reescribe una vez), ni la sugiere', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_barra');
    const ctx = ctxFor(engine, pc, 'me siento a esperar');
    const shown = logInput({ narration_private: 'Bajo la mesa del fondo asoma la argolla de una trampilla.', suggested_actions: 'Ir a la trampilla | Pedir una cerveza' });
    const r1 = run(ctx, 'log_event', shown);
    expect(r1.error).toMatch(/trampilla.*oculto/);
    const r2 = run(ctx, 'log_event', shown);
    expect(r2.ok).toBe(true);
    expect(ids(engine, pc)).not.toContain('sp_tab_trampilla');
    expect(ctx.closed!.suggested_actions).toEqual(['Pedir una cerveza']);
  });

  it('partida guardada de antes: conserva los puntos no ocultos de los sitios donde estuvo, una sola vez', async () => {
    const { engine, pc } = await boot();
    const snap = engine.world.snapshot();
    delete snap.campaign.spot_sight;
    for (const s of snap.spots) s.discovered_by = s.id === 'sp_tab_trampilla' ? [] : s.discovered_by.filter((x) => x !== pc.id);
    snap.locations.find((l) => l.id === 'loc_taberna')!.discovery[pc.id] = 'visited';
    expect(migrateSpotSight(snap)).toBe(true);
    const knows = snap.spots.filter((s) => s.discovered_by.includes(pc.id)).map((s) => s.id);
    expect(knows).toEqual(expect.arrayContaining(['sp_tab_puerta', 'sp_tab_barra', 'sp_tab_mesa', 'sp_tab_chimenea', 'sp_tab_habitacion']));
    expect(knows).not.toContain('sp_tab_trampilla');
    expect(snap.campaign.spot_sight).toBe(true);
    expect(migrateSpotSight(snap)).toBe(false);
  });

  it('visible_from se valida: un punto de otro sitio es un error', async () => {
    const { engine } = await boot();
    const snap = engine.world.snapshot();
    expect(validateSnapshot(snap).filter((e) => /visible_from/.test(e))).toEqual([]);
    snap.spots.find((s) => s.id === 'sp_tab_mesa')!.visible_from = ['sp_pl_pozo'];
    expect(validateSnapshot(snap).some((e) => /sp_tab_mesa: visible_from cita sp_pl_pozo/.test(e))).toBe(true);
  });
});

/** Los NPC de Brezal tal como los ve el cierre, con quién está delante. */
function npcs(engine: Engine, present: string[]): NamedNpc[] {
  return [...engine.world.npcs.values()].map((n) => ({ id: n.id, name: n.name, present: present.includes(n.id) }));
}

describe('conocidos automáticos (sección 2)', () => {
  it('quien dice su nombre en sus lines se presenta (seq 82, Garrán)', async () => {
    const { engine } = await boot();
    const learned = introducedIn({ npcs: npcs(engine, ['npc_garran', 'npc_brenna']), narration: '', lines: [{ speaker: 'npc', npc_id: 'npc_garran', text: 'Cerveza. Y que nadie diga que Garrán no sabe quién debe.' }] });
    expect(learned).toEqual(['npc_garran']);
  });

  it('un tercero lo nombra delante: aprende el nombre; si no está, no sabe quién es', async () => {
    const { engine } = await boot();
    const line = [{ speaker: 'npc' as const, npc_id: 'npc_brenna', text: 'Hugo, ponle otra jarra al forastero.' }];
    expect(introducedIn({ npcs: npcs(engine, ['npc_brenna', 'npc_hugo']), narration: '', lines: line })).toEqual(['npc_hugo']);
    expect(introducedIn({ npcs: npcs(engine, ['npc_brenna']), narration: '', lines: line })).toEqual([]);
    // seq 65: Hugo nombra a Osric, que no está; Hugo no dice su nombre.
    expect(introducedIn({ npcs: npcs(engine, ['npc_hugo']), narration: '', lines: [{ speaker: 'npc', npc_id: 'npc_hugo', text: 'Osric quiere fundirlos. Yo digo mañana.' }] })).toEqual([]);
  });

  it('lo pregunta y se lo dicen; o la narración lo presenta', async () => {
    const { engine } = await boot();
    expect(introducedIn({ npcs: npcs(engine, ['npc_brenna']), narration: '', lines: [{ speaker: 'actor', text: '¿Cómo te llamas?' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Brenna. Y aquí se paga antes de beber.' }] })).toEqual(['npc_brenna']);
    expect(introducedIn({ npcs: npcs(engine, []), narration: 'La mujer de la barra se presenta como Brenna y te sirve.', lines: [] })).toEqual(['npc_brenna']);
    expect(introducedIn({ npcs: npcs(engine, ['npc_brenna', 'npc_hugo']), narration: 'La tabernera te presenta a Hugo con un gesto.', lines: [] })).toEqual(['npc_hugo']);
    // Lo que dice el propio actor no le enseña nada.
    expect(introducedIn({ npcs: npcs(engine, ['npc_hugo']), narration: '', lines: [{ speaker: 'actor', text: '¿Eres Hugo?' }] })).toEqual([]);
  });

  it('names_learned del máster se comprueba: un nombre que no ha sonado no se aprende', async () => {
    const { engine } = await boot();
    const all = npcs(engine, []);
    expect(confirmedNames(['npc_hugo'], all, ['El herrero asiente.'])).toEqual([]);
    expect(confirmedNames(['npc_hugo'], all, ['El herrero dice que se llama Hugo.'])).toEqual(['npc_hugo']);
  });

  it('en log_event lo apunta el motor: al final de la partida tendría a Hugo, Brenna y Garrán', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_barra');
    engine.world.npc('npc_garran').location = { type: 'spot', id: 'sp_tab_barra' };
    run(ctxFor(engine, pc, 'saludo'), 'log_event', logInput({ narration_private: 'Un hombre se planta en la barra.', lines: [{ speaker: 'npc', npc_id: 'npc_garran', text: 'Cerveza. Y que nadie diga que Garrán no sabe quién debe.' }] }));
    run(ctxFor(engine, pc, '¿cómo te llamas?'), 'log_event', logInput({ narration_private: '', npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Brenna. ¿Qué te pongo?' }] }));
    run(ctxFor(engine, pc, 'pregunto por el herrero'), 'log_event', logInput({ narration_private: 'La tabernera señala la fragua.', names_learned: 'npc_hugo', npc_id: 'npc_brenna', lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Se llama Hugo. Trabaja hasta tarde.' }] }));
    expect(pc.knows).toEqual(expect.arrayContaining(['npc_garran', 'npc_brenna', 'npc_hugo']));
  });
});

describe('nombres que el PJ no sabe, fuera de la narración (sección 2)', () => {
  it('seq 39 y 64: el oficio en su lugar, con contracción y mayúscula a principio de frase', async () => {
    const { engine, pc } = await boot();
    const w = engine.world;
    expect(maskUnknownNames(w, pc.id, 'Te quedas junto al pozo. Poco a poco la plaza se vacía: se cierran las puertas y el martilleo de Hugo se aleja.'))
      .toBe('Te quedas junto al pozo. Poco a poco la plaza se vacía: se cierran las puertas y el martilleo del herrero se aleja.');
    expect(maskUnknownNames(w, pc.id, 'Entras en la taberna y te acercas a la barra. Hugo está allí, entre los vecinos de la cena.'))
      .toBe('Entras en la taberna y te acercas a la barra. El herrero está allí, entre los vecinos de la cena.');
  });

  it('lo citado de otros se oye tal cual; el nombre de pila de un nombre compuesto también se tapa', async () => {
    const { engine, pc } = await boot();
    // seq 65.
    expect(maskUnknownNames(engine.world, pc.id, 'Hugo deja de secarse las manos. «Osric quiere fundirlos. Yo digo mañana.»'))
      .toBe('El herrero deja de secarse las manos. «Osric quiere fundirlos. Yo digo mañana.»');
    expect(maskUnknownNames(engine.world, pc.id, 'Dicen que Osric no sale de la casona.')).toBe('Dicen que el regidor no sale de la casona.');
  });

  it('«Ceniza» a principio de frase es la ceniza, no el perro', async () => {
    const { engine, pc } = await boot();
    expect(maskUnknownNames(engine.world, pc.id, 'Ceniza cubre el brocal. Sigues a Ceniza hasta la cueva.')).toBe('Ceniza cubre el brocal. Sigues al perro hasta la cueva.');
  });

  it('en log_event: la narración del máster sale tapada, salvo lo que nombró el jugador', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_barra');
    const ctx = ctxFor(engine, pc, 'Esperar a que se acueste el pueblo');
    run(ctx, 'log_event', logInput({ narration_private: 'Te quedas en la barra. El martilleo de Hugo se aleja.' }));
    expect(ctx.closed!.narration_private).toBe('Te quedas en la barra. El martilleo del herrero se aleja.');
    const named = ctxFor(engine, pc, 'Preguntar a Hugo por la cadena');
    run(named, 'log_event', logInput({ narration_private: 'Hugo no está aquí.' }));
    expect(named.closed!.narration_private).toBe('Hugo no está aquí.');
  });

  it('la línea de la tirada de ataque: «a la tabernera», no «a Brenna» (pendiente del diario del 27)', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_barra');
    engine.attachMaster(new Master(engine, { client: offlineClient(), rng: seededRng(3) }));
    const r = await engine.act(pc.id, 'ataco a la tabernera');
    expect(r.requires_roll?.kind).toBe('attack');
    await engine.rollPending(pc.id);
    const roll = engine.events.all().filter((e) => e.actor_id === pc.id && e.action_type === 'roll').at(-1)!;
    expect(roll.narration_private).toMatch(/^🎲 Ataque con .+ a (la tabernera|el alguacil):/);
    expect(roll.narration_private).not.toMatch(/Brenna|Garrán/);
    // Y lo que cuenta después el máster (offline: «ataque con espada a Brenna: lo consigues»), tapado al cerrar.
    const outcome = engine.events.all().filter((e) => e.actor_id === pc.id && e.action_type === 'master_roll_outcome').at(-1)!;
    expect(outcome.narration_private).not.toMatch(/Brenna|Garrán/);
  });

  it('seq 95: un nombre que el máster pone en boca del PJ sin que lo sepa, también', async () => {
    const { engine, time, pc } = await boot();
    await walk(engine, time, pc, 'sp_tab_barra');
    const ctx = ctxFor(engine, pc, 'Insistir en qué le pasó a el herrero');
    run(ctx, 'log_event', logInput({
      narration_private: '«¿Qué le pasó a Hugo? Lo he visto caer.» «El corazón se le paró. Pasa con los que cargan hierro toda la vida.»', npc_id: 'npc_brenna',
      lines: [{ speaker: 'actor', npc_id: null, text: '¿Qué le pasó a Hugo? Lo he visto caer.' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'El corazón se le paró. Pasa con los que cargan hierro toda la vida.' }],
    }));
    expect(ctx.closed!.narration_private).toContain('«¿Qué le pasó al herrero? Lo he visto caer.»');
    expect(ctx.closed!.lines![0]!.text).toBe('¿Qué le pasó al herrero? Lo he visto caer.');
  });
});

describe('gramática al tapar nombres (fallo 3)', () => {
  it('las sugerencias de la partida (seq 60, 64, 82): «al», «del» y el rol corto', async () => {
    const { engine, pc } = await boot();
    const m = (t: string) => maskUnknownNames(engine.world, pc.id, t);
    expect(m('Ir a la herrería de Hugo a buscar la cadena')).toBe('Ir a la herrería del herrero a buscar la cadena');
    expect(m('Preguntar a Hugo por la cadena de su maestro')).toBe('Preguntar al herrero por la cadena de su maestro');
    expect(m('Preguntarle a Garrán quién paga la cerveza')).toBe('Preguntarle al alguacil quién paga la cerveza');
    expect(m('Ayudar a Hugo antes de que Garrán se acerque')).toBe('Ayudar al herrero antes de que el alguacil se acerque');
    // Lo que ya venía mal también se arregla.
    expect(m('Ir a el roble viejo')).toBe('Ir al roble viejo');
  });

  it('el rol corto en el texto corrido; el largo, como etiqueta. Doro es «el guardia»', async () => {
    const { engine, pc } = await boot();
    const w = engine.world;
    expect(descriptorOf(w, 'npc_garran')).toBe('el alguacil');
    expect(npcTag(pc, w.npc('npc_garran'))).toBe('Alguacil y recaudador');
    expect(npcLabel(pc, w.npc('npc_doro'))).toBe('el guardia');
    expect(nameFor(w, pc, 'npc_doro')).toBe('el guardia');
    expect(nameFor(w, pc, 'npc_ilse')).toBe('la curandera');
    expect(maskUnknownNames(w, pc.id, 'Garrán, el alguacil y recaudador, cuenta monedas.')).toBe('El alguacil, cuenta monedas.');
  });

  it('no toca «a él» ni un nombre propio con «El»', () => {
    expect(contractArticles('Se lo da a él, de él y a El Escorial.')).toBe('Se lo da a él, de él y a El Escorial.');
    expect(contractArticles('A el herrero y de el pozo.')).toBe('Al herrero y del pozo.');
  });
});
