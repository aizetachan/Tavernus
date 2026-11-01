import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import { journalOf } from '../src/engine/journal.js';
import { activeJobs, completeJob, grantClue } from '../src/engine/progress.js';
import { plantRumor } from '../src/engine/rumors.js';
import { spawnItem } from '../src/engine/inventory.js';
import type { Engine } from '../src/engine/engine.js';
import type { DialogueLine } from '../src/engine/moments.js';
import { handleJournalRequest, noticeOf, touchesJournal } from '../src/adapters/web/journal.js';
import { bootEngine, fakeTime } from './helpers.js';

/** Un turno del máster con diálogo, como lo registra el motor (payload.lines y npc_id). */
function talk(engine: Engine, characterId: string, input: string, narration: string, lines: DialogueLine[], tags: string[] = ['master', 'social']): void {
  const npc = lines.find((l) => l.speaker === 'npc')?.npc_id ?? null;
  engine.events.emit({
    actor_id: characterId, action_type: 'master', input_text: input, narration_private: narration, observable: null,
    tags, payload: { master: {}, suggested_actions: [], lines, ...(npc ? { npc_id: npc } : {}) },
  }, engine['now']());
}

describe('diario: misiones', () => {
  it('los encargos del tablón que el PJ ha leído salen disponibles, con fecha; los que acepta pasan a en curso y suben arriba', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const first = activeJobs(engine.world).map((j) => j.id);
    // Que estén clavados en el tablón no basta: hasta que no lo lee, no están en su Diario.
    let j = journalOf(engine, 'ch_kael');
    expect(j.quests.active.filter((q) => q.kind === 'job')).toEqual([]);
    await engine.command('ch_kael', 'tablon');
    expect(engine.events.all().filter((e) => e.actor_id === 'ch_kael' && e.action_type === 'progress_quest').map((e) => (e.payload['quest'] as { event: string }).event)).toEqual(['available', 'available', 'available']);
    j = journalOf(engine, 'ch_kael');
    const jobs = j.quests.active.filter((q) => q.kind === 'job');
    expect(jobs.every((q) => q.origin?.kind === 'board' && q.history[0]!.kind === 'added')).toBe(true);
    expect(jobs.map((q) => q.id).sort()).toEqual([...first].sort());
    expect(jobs.every((q) => q.status === 'available' && q.seen !== null && q.giver === 'Brenna')).toBe(true);
    expect(jobs.find((q) => q.id === 'job_lena')).toMatchObject({ reward: '6 de plata · +1 de reputación', steps: [{ text: 'Conseguir 10 × leña', done: false }, { text: 'Entregarlo a Brenna', done: false }] });
    // El logro no sale hasta la primera pista: antes no dice nada.
    expect(j.quests.active.some((q) => q.kind === 'achievement')).toBe(false);

    // Kael habla con Brenna y acepta el encargo de la leña.
    time.advanceGame(GAME_HOUR);
    talk(engine, 'ch_kael', 'Aceptar el encargo de la leña', 'Brenna asiente.', [
      { speaker: 'actor', text: 'Me encargo de la leña.' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Diez leños secos. Los del roble del claro sirven.' },
    ], ['master', 'social', 'job']);
    j = journalOf(engine, 'ch_kael');
    expect(j.quests.active[0]).toMatchObject({ id: 'job_lena', status: 'active' });
    expect(j.quests.active.filter((q) => q.id !== 'job_lena').every((q) => q.updated_game_s <= j.quests.active[0]!.updated_game_s)).toBe(true);
    // Mira no ha leído el tablón ni ha hablado de la leña: no lo tiene.
    expect(journalOf(engine, 'ch_mira').quests.active.find((q) => q.id === 'job_lena')).toBeUndefined();
  });

  it('al rotar el tablón los encargos no aceptados caducan y los nuevos, recién vistos, van arriba; el completado pasa a su sección con fecha', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    const first = activeJobs(engine.world).map((j) => j.id);
    await engine.command('ch_kael', 'tablon');
    time.advanceGame(GAME_HOUR);
    talk(engine, 'ch_kael', 'Acepto el encargo de la leña', 'Brenna asiente.', [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Diez leños.' }]);
    // Completa el encargo de la leña: los leños en la mano, Brenna delante.
    engine.world.itemInstance('ii_kael_daga').location = { type: 'spot', id: 'sp_tab_chimenea' };
    const wood = spawnItem(engine.world, 'it_madera', 10, { type: 'spot', id: 'sp_tab_barra' });
    if (!wood.ok) throw new Error('sin leña');
    wood.moved.location = { type: 'character', id: kael.id, slot: { kind: 'hand', which: 'main' } }; // los diez de golpe, como en progress.test
    time.advanceGame(GAME_HOUR);
    const r = completeJob(engine.world, kael, 'job_lena', 'npc_brenna');
    expect(r.ok).toBe(true);
    engine.events.emit({ actor_id: kael.id, action_type: 'progress_job', narration_private: 'Encargo completado: Leña para la posada. +900 monedas. Reputación en Brezal: 1.', observable: null, tags: ['progress', 'job'] }, time.now());
    const doneAt = engine.clock.format(engine.gameNow());

    time.advanceGame(GAME_DAY);
    await engine.tick();
    const second = activeJobs(engine.world).map((j) => j.id);
    expect(second).not.toEqual(first);
    // El tablón ha cambiado, pero los nuevos no entran hasta que lo vuelve a leer.
    expect(journalOf(engine, 'ch_kael').quests.active.filter((q) => second.includes(q.id))).toEqual([]);
    time.advanceGame(60);
    await engine.command('ch_kael', 'tablon');
    const j = journalOf(engine, 'ch_kael');
    expect(j.quests.completed.map((q) => q.id)).toEqual(['job_lena']);
    expect(j.quests.completed[0]).toMatchObject({ status: 'completed', completed: doneAt, steps: [{ done: true }, { done: true }] });
    const active = j.quests.active.filter((q) => q.kind === 'job');
    // Los tres nuevos primero (cambiaron hace menos), luego los dos de ayer, caducados.
    expect(active.slice(0, 3).map((q) => q.id).sort()).toEqual([...second].sort());
    expect(active.slice(0, 3).every((q) => q.status === 'available')).toBe(true);
    expect(active.slice(3).map((q) => q.status)).toEqual(['expired', 'expired']);
    expect(active.slice(3).map((q) => q.id).sort()).toEqual(first.filter((id) => id !== 'job_lena').sort());
  });

  it('las pistas obtenidas son objetivos del logro y los rumores se ligan a la misión que corresponda', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    grantClue(engine.world, kael, 'clue_pozo');
    engine.events.emit({ actor_id: kael.id, action_type: 'progress_clue', narration_private: 'Pista: Ceniza en el agua del pozo (1/5).', observable: null, tags: ['progress', 'clue'] }, time.now());
    // Un rumor sobre el perro de Brenna (encargo del tablón de la demo) y otro suelto.
    const nowS = engine.gameNow();
    expect(plantRumor(engine.world, { kind: 'rumor', name: 'el perro de la tabernera', hint: 'Dicen que a Ceniza lo vieron por el bosque con una cuerda al cuello.', location_id: 'loc_taberna', actor_id: kael.id }, nowS).ok).toBe(true);
    expect(plantRumor(engine.world, { kind: 'place', name: 'la cueva del norte', hint: 'Dicen que hay una cueva al norte donde nadie entra.', location_id: 'loc_taberna', actor_id: kael.id }, nowS).ok).toBe(true);
    const j = journalOf(engine, 'ch_kael');
    const ach = j.quests.active.find((q) => q.kind === 'achievement')!;
    expect(ach.status).toBe('active');
    expect(ach.title).toBe('Quien ha mirado la ceniza');
    expect(ach.text).toBe('Descubrir 3 pistas de lo que pasa y ganarte el respeto de la aldea de Brezal (reputación 5).');
    expect(ach.steps[0]).toEqual({ text: 'Pista: Ceniza en el agua del pozo', done: true });
    expect(ach.steps[1]!.text).toBe('2 pistas más por descubrir');
    const perro = j.quests.active.find((q) => q.id === 'job_perro');
    if (perro) {
      expect(perro.rumors.map((r) => r.name)).toEqual(['el perro de la tabernera']);
      expect(j.rumors.map((r) => r.name)).toEqual(['la cueva del norte']);
    } else {
      // Si ese encargo no está hoy en el tablón, los dos rumores van sueltos.
      expect(j.rumors.map((r) => r.name).sort()).toEqual(['el perro de la tabernera', 'la cueva del norte']);
    }
  });

  it('la situación inicial es la misión principal, fija arriba, con reloj, antagonista conocido y caminos', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    kael.situation = {
      why_here: 'Llegas siguiendo a un arriero que te debe tres semanas de paga.', wants: 'Recuperar tu paga.', threat: 'Te quedan pocas monedas.',
      clock_days: 5, clock_runs_out: 'Te echan de la posada.', antagonist_npc_id: 'npc_doro', start_spot_id: 'sp_tab_barra',
      paths: ['Plantarte ante Doro.', 'Aceptar un encargo.', 'Seguir el rastro.'], opening: 'Te despiertas en la barra.',
      deadline_game_s: engine.gameNow() + 5 * GAME_DAY - 3600,
    };
    const j = journalOf(engine, 'ch_kael');
    const main = j.quests.active[0]!;
    expect(main).toMatchObject({ kind: 'main', pinned: true, status: 'active', antagonist: { id: 'npc_doro', name: 'Doro' }, paths: ['Plantarte ante Doro.', 'Aceptar un encargo.', 'Seguir el rastro.'] });
    expect(main.clock!.days_left).toBe(5);
    expect(main.steps[0]!.text).toBe('Recuperar tu paga.');
    // Vencida: sigue arriba, marcada.
    time.advanceGame(5 * GAME_DAY);
    expect(journalOf(engine, 'ch_kael').quests.active[0]).toMatchObject({ kind: 'main', status: 'expired', clock: { days_left: 0 } });
  });
});

describe('diario: resumen de misiones', () => {
  it('cada misión trae un resumen: de qué va y qué toca ahora, sin citas de lo que le dijeron; la amenaza ya no es un objetivo', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    kael.situation = {
      why_here: 'Llegas siguiendo a un arriero que te debe tres semanas de paga.', wants: 'Recuperar tu paga.', threat: 'Te quedan pocas monedas.',
      clock_days: 5, clock_runs_out: 'Te echan de la posada.', antagonist_npc_id: 'npc_doro', start_spot_id: 'sp_tab_barra',
      paths: ['Plantarte ante Doro.'], opening: 'Te despiertas en la barra.', deadline_game_s: engine.gameNow() + 5 * GAME_DAY,
    };
    const job = activeJobs(engine.world).find((x) => x.giver_npc_id === 'npc_brenna')!;
    // Hablar con quien pide el encargo: lo que dice va en Charlas, no en la ficha del encargo.
    talk(engine, 'ch_kael', `Acepto: ${job.title}`, 'Brenna asiente.', [
      { speaker: 'actor', text: `Me encargo de ${job.title.toLowerCase()}.` }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Trato hecho. Vuelve antes del anochecer.' },
    ], ['master', 'social', 'job']);
    const j = journalOf(engine, 'ch_kael');
    const main = j.quests.active.find((q) => q.kind === 'main')!;
    expect(main.steps.map((s) => s.text)).toEqual(['Recuperar tu paga.']);
    expect(main.summary).toMatchObject({ text: 'Recuperar tu paga.', next: null });
    const mine = j.quests.active.find((q) => q.id === job.id)!;
    expect(mine.summary.text.length).toBeGreaterThan(0);
    expect(mine.summary.next).toBe(mine.steps.find((s) => !s.done)!.text);
    expect(mine.summary).toEqual({ text: mine.summary.text, next: mine.summary.next });
    expect(JSON.stringify(mine)).not.toContain('Trato hecho');
    expect(j.conversations.find((cv) => cv.npc_id === 'npc_brenna')?.exchanges.at(-1)?.replied).toContain('Trato hecho. Vuelve antes del anochecer.');
  });

  it('la vista web no manda al navegador los caminos, quién se opone, qué pasa si vence ni los rumores de cada misión', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.world.character('ch_kael').situation = {
      why_here: 'Llegas siguiendo a un arriero.', wants: 'Recuperar tu paga.', threat: 'Te quedan pocas monedas.',
      clock_days: 5, clock_runs_out: 'Te echan de la posada.', antagonist_npc_id: 'npc_doro', start_spot_id: 'sp_tab_barra',
      paths: ['Plantarte ante Doro.'], opening: 'Te despiertas.', deadline_game_s: engine.gameNow() + 5 * GAME_DAY,
    };
    engine.world.character('ch_kael').knows.push('npc_doro');
    let body = '';
    const res = { writeHead: () => res, end: (b: string) => { body = b; } } as unknown as ServerResponse;
    handleJournalRequest(engine, {} as IncomingMessage, res, new URL('http://x/api/journal?character=ch_kael'), 'demo');
    expect(body).not.toContain('Plantarte ante Doro');
    expect(body).not.toContain('Te echan de la posada');
    const main = (JSON.parse(body) as { quests: { active: { kind: string; antagonist: unknown; paths: unknown[] }[] } }).quests.active.find((q) => q.kind === 'main')!;
    expect(main).toMatchObject({ antagonist: null, paths: [] });
  });
});

describe('diario: conversaciones', () => {
  it('cada intercambio con lines va a la conversación de su NPC: fecha, lugar, lo dicho y la respuesta; y lo que el NPC recuerda', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    talk(engine, 'ch_kael', 'Preguntar a Brenna por el pozo', 'Brenna seca la jarra.', [
      { speaker: 'actor', text: '¿Qué le pasa al agua del pozo?' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Baja turbia desde hace días. No preguntes más.' },
    ]);
    time.advanceGame(10 * 60);
    // Sin frase del jugador: su acción cuenta como lo dicho. Dos NPCs en el mismo turno: cada uno a su conversación.
    engine.world.npc('npc_doro').location = { type: 'spot', id: 'sp_tab_barra' };
    talk(engine, 'ch_kael', 'Mirar a los dos', 'Se miran.', [
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'Doro, cuéntaselo tú.' }, { speaker: 'npc', npc_id: 'npc_doro', text: 'He visto luces arriba.' },
    ]);
    engine.world.npc('npc_brenna').memory.push({ character_id: 'ch_kael', game_s: engine.gameNow(), note: 'Kael preguntó por el agua del pozo.', importance: 2 });
    engine.world.npc('npc_brenna').memory.push({ character_id: 'ch_mira', game_s: engine.gameNow(), note: 'Mira pagó la cena.', importance: 1 });
    const j = journalOf(engine, 'ch_kael');
    expect(j.conversations.map((c) => c.npc_id).sort()).toEqual(['npc_brenna', 'npc_doro']);
    const brenna = j.conversations.find((c) => c.npc_id === 'npc_brenna')!;
    const doro = j.conversations.find((c) => c.npc_id === 'npc_doro')!;
    expect(brenna).toMatchObject({ name: 'Brenna', role: 'tabernera', known: true });
    expect(brenna.exchanges).toHaveLength(2);
    expect(brenna.exchanges[0]).toMatchObject({ location: 'Taberna del Jabalí', said: ['¿Qué le pasa al agua del pozo?'], replied: ['Baja turbia desde hace días. No preguntes más.'] });
    expect(brenna.exchanges[0]!.when).toBe(engine.clock.format(brenna.exchanges[0]!.game_s));
    expect(brenna.exchanges[1]).toMatchObject({ said: ['Mirar a los dos'], replied: ['Doro, cuéntaselo tú.'] });
    expect(brenna.memory.map((m) => m.note)).toEqual(['Kael preguntó por el agua del pozo.']);
    expect(doro.exchanges[0]!.replied).toEqual(['He visto luces arriba.']);
    // La más reciente primero: Brenna vuelve a hablar más tarde y sube.
    time.advanceGame(10 * 60);
    talk(engine, 'ch_kael', 'Despedirse', 'Brenna asiente.', [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Ve con cuidado.' }]);
    expect(journalOf(engine, 'ch_kael').conversations.map((c) => c.npc_id)).toEqual(['npc_brenna', 'npc_doro']);
    // Mira no ha hablado con nadie.
    expect(journalOf(engine, 'ch_mira').conversations).toEqual([]);
  });

  it('un NPC cuyo nombre no conoce sale por su oficio', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    kael.knows = kael.knows.filter((id) => id !== 'npc_doro');
    engine.world.npc('npc_doro').location = { type: 'spot', id: 'sp_tab_barra' };
    talk(engine, 'ch_kael', 'Saludar al guardia', 'El guardia gruñe.', [{ speaker: 'npc', npc_id: 'npc_doro', text: 'Hm.' }]);
    expect(journalOf(engine, 'ch_kael').conversations[0]).toMatchObject({ npc_id: 'npc_doro', name: 'Guardia', known: false, rapport: null });
  });

  it('el trato con quien conoce sale en palabras, sin niveles ni puntos, y cambia con la actitud y la confianza', async () => {
    const { engine } = await bootEngine();
    talk(engine, 'ch_kael', 'Saludar', 'Brenna asiente.', [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Buenas.' }]);
    const brenna = engine.world.npc('npc_brenna');
    const rapport = () => journalOf(engine, 'ch_kael').conversations[0]!.rapport;
    brenna.attitude.by_character['ch_kael'] = 'unfriendly';
    expect(rapport()).toBe('te mira con recelo');
    brenna.attitude.by_character['ch_kael'] = 'hostile';
    expect(rapport()).toBe('te tiene por enemigo');
    brenna.attitude.by_character['ch_kael'] = 'neutral';
    const ladder: [number, string][] = [[0, 'aún no se fía de ti'], [2, 'te conoce, pero no se abre'], [5, 'se fía de ti'], [9, 'está de tu parte']];
    for (const [points, text] of ladder) {
      brenna.trust = { ch_kael: { points } };
      expect(rapport()).toBe(text);
    }
    expect(rapport()).not.toMatch(/\d/);
  });
});

describe('diario: crónica y lugares', () => {
  it('resume por día, el más reciente primero: lugares, gente conocida, tiradas, objetos y progreso', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const first = activeJobs(engine.world).map((x) => x.title).join(', ');
    talk(engine, 'ch_kael', 'Hablar con Brenna', 'Brenna levanta la vista.', [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué te pongo?' }]);
    engine.events.emit({ actor_id: 'ch_kael', action_type: 'roll', narration_private: '🎲 Persuasión: d20 [4] + 0 = 4 → fallo', observable: null, tags: ['roll'] }, time.now());
    talk(engine, 'ch_kael', 'Insistir', 'Brenna niega.', [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'No.' }]);
    // Al día siguiente: va al claro, coge el hacha y gana una pista.
    time.advanceGame(GAME_DAY);
    await engine.act('ch_kael', 'ir a la puerta');
    await engine.tick();
    const day1 = engine.gameNow();
    engine.events.emit({ actor_id: 'ch_kael', at: { spot_id: 'sp_cl_sendero', next_spot_id: null, progress: 0, x: 0, y: 0, location_id: 'loc_claro' }, action_type: 'arrived', narration_private: 'Llegas al sendero.', observable: null, tags: ['movement'] }, time.now());
    engine.events.emit({ actor_id: 'ch_kael', at: { spot_id: 'sp_cl_sendero', next_spot_id: null, progress: 0, x: 0, y: 0, location_id: 'loc_claro' }, action_type: 'take', input_text: 'coger el hacha', narration_private: 'Coges el hacha.', observable: null, tags: ['inventory'], payload: { item_id: 'it_hacha' } }, time.now());
    engine.events.emit({ actor_id: 'ch_kael', at: { spot_id: 'sp_cl_sendero', next_spot_id: null, progress: 0, x: 0, y: 0, location_id: 'loc_claro' }, action_type: 'progress_clue', narration_private: 'Pista: El hacha con hollín (1/5). Reputación en Brezal: 2.', observable: null, tags: ['progress', 'clue'] }, time.now());

    const j = journalOf(engine, 'ch_kael');
    expect(j.chronicle).toHaveLength(2);
    const [today, yesterday] = j.chronicle;
    expect(today!.day_index).toBe(yesterday!.day_index + 1);
    expect(today!.label).toBe(engine.clock.format(day1).replace(/, \d\d:\d\d$/, ''));
    const texts = (d: typeof today) => d!.entries.map((e) => `${e.kind}: ${e.text}`);
    expect(texts(yesterday)).toEqual([
      'board: El tablón cambia: ' + first + '.',
      'person: Conoces a Brenna (tabernera) en Taberna del Jabalí.',
      'roll: Persuasión: d20 [4] + 0 = 4 → fallo',
    ]);
    expect(yesterday!.summary).toBe('1 conversación · 1 tirada');
    expect(texts(today)).toEqual(expect.arrayContaining([
      'board: El tablón cambia: ' + activeJobs(engine.world).map((x) => x.title).join(', ') + '.',
      'place: Llegas a Claro del Roble, el sendero.',
      'item: Consigues hacha de leñador.',
      'progress: Pista: El hacha con hollín (1/5). Reputación en Brezal: 2.',
    ]));
    // Dentro del día, en orden; las horas van en HH:MM.
    expect(today!.entries.map((e) => e.game_s)).toEqual([...today!.entries.map((e) => e.game_s)].sort((a, b) => a - b));
    expect(today!.entries.every((e) => /^\d\d:\d\d$/.test(e.time))).toBe(true);
  });

  it('lugares: los visitados y los de oídas, con dónde está ahora', async () => {
    const { engine } = await bootEngine();
    const j = journalOf(engine, 'ch_kael');
    expect(j.places.map((p) => [p.id, p.status, p.here])).toEqual([
      ['loc_taberna', 'visited', true], ['loc_plaza', 'visited', false], ['loc_claro', 'heard_of', false],
    ]);
    expect(j.places[0]!.zone).toBe('Aldea de Brezal');
  });
});

describe('diario: web', () => {
  it('el tablón y el progreso no generan burbuja: un aviso de una línea que lleva al Diario', () => {
    expect(noticeOf({ action_type: 'board', narration_private: '', observable: '📜 Tablón de Brezal: • **Leña** — …' })).toEqual({ text: 'Hay avisos nuevos en el tablón de la plaza: pásate a leerlos', link: 'ver el Tablón', tab: 'tablon' });
    expect(noticeOf({ action_type: 'progress_job', narration_private: 'Encargo completado: Leña para la posada. +900 monedas. Reputación en Brezal: 1.', observable: null }))
      .toEqual({ text: 'Encargo completado: Leña para la posada', link: 'ver en el Diario', tab: 'journal' });
    expect(noticeOf({ action_type: 'master', narration_private: 'Brenna te mira.', observable: null })).toBeNull();
    // Tiradas y anuncios también son aviso (notice.ts), pero sin enlace: no llevan al Diario.
    expect(noticeOf({ action_type: 'roll', narration_private: '🎲 Persuasión…', observable: null })).toEqual({ text: '🎲 Persuasión…' });
    expect(noticeOf({ action_type: 'announcement', narration_private: '', observable: 'Kael ha mirado la ceniza.' })).toEqual({ text: 'Kael ha mirado la ceniza' });
  });

  it('avisa por el stream con lo que el diario recoge, no con lo trivial', () => {
    expect(touchesJournal({ action_type: 'board', payload: {}, tags: ['board'] })).toBe(true);
    expect(touchesJournal({ action_type: 'master', payload: { lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Hola' }] }, tags: ['master'] })).toBe(true);
    expect(touchesJournal({ action_type: 'progress_clue', payload: {}, tags: ['progress'] })).toBe(true);
    expect(touchesJournal({ action_type: 'master', payload: { master: {} }, tags: ['master', 'exploration'] })).toBe(false);
    expect(touchesJournal({ action_type: 'passed', payload: {}, tags: ['movement'] })).toBe(false);
  });

  it('GET /api/journal responde el JSON o 404', async () => {
    const { engine } = await bootEngine();
    const fake = () => {
      const out = { status: 0, body: '' };
      const res = { writeHead: (s: number) => { out.status = s; return res; }, end: (b: string) => { out.body = b; } };
      return { out, res: res as unknown as ServerResponse };
    };
    const req = {} as IncomingMessage;
    const ok = fake();
    handleJournalRequest(engine, req, ok.res, new URL('http://localhost/api/journal?character=ch_kael'), 'demo');
    expect(ok.out.status).toBe(200);
    const j = JSON.parse(ok.out.body);
    expect(j.character).toEqual({ id: 'ch_kael', name: 'Kael' });
    expect(Array.isArray(j.quests.active)).toBe(true);
    expect(typeof j.version).toBe('string');
    const missing = fake();
    handleJournalRequest(engine, req, missing.res, new URL('http://localhost/api/journal?character=nadie'), 'demo');
    expect(missing.out.status).toBe(404);
  });
});
