import { describe, expect, it } from 'vitest';
import { initClass } from '../src/engine/levels.js';
import type { MasterLike } from '../src/engine/engine.js';
import { parseInfo, RULE_TERMS } from '../src/engine/fastpath.js';
import { bootEngine } from './helpers.js';

/**
 * Preguntas sobre el juego (fastpath.ts `parseInfo`, info.ts): las contesta
 * el sistema desde el estado, sin narrador. Las frases marcadas «partida»
 * son de la partida del 2026-10-26 (brezal.events.jsonl), tal cual se
 * escribieron, erratas incluidas.
 */
describe('clasificar preguntas sobre el juego', () => {
  const cases: [string, ReturnType<typeof parseInfo>][] = [
    // partida: en plena ronda, el narrador la tomó por la acción del turno.
    ['q1ue conjuros tengo', { topic: 'spells' }],
    ['¿qué hechizos tengo?', { topic: 'spells' }],
    ['¿Qué conjuros puedo lanzar?', { topic: 'spells' }],
    ['mis hechizos', { topic: 'spells' }],
    ['¿cuántos espacios de conjuro me quedan?', { topic: 'spells' }],
    ['¿cuánta destreza tengo?', { topic: 'ability', ability: 'dex' }],
    ['cuanta fuerza tengo', { topic: 'ability', ability: 'str' }],
    ['mi carisma', { topic: 'ability', ability: 'cha' }],
    ['¿qué tengo en sigilo?', { topic: 'skill', skill: 'stealth' }],
    ['¿tengo percepción?', { topic: 'skill', skill: 'perception' }],
    ['¿qué atributos tengo?', { topic: 'abilities' }],
    ['ficha', { topic: 'abilities' }],
    ['¿qué habilidades tengo?', { topic: 'skills' }],
    ['¿qué llevo en la mochila?', { topic: 'inventory' }],
    ['¿qué llevo encima?', { topic: 'inventory' }],
    ['oye, ¿qué hay en mi mochila?', { topic: 'inventory' }],
    ['¿cuánto oro tengo?', { topic: 'coins' }],
    ['¿cuánto oro llevo?', { topic: 'coins' }],
    ['¿me quedan monedas?', { topic: 'coins' }],
    ['¿cuántos PV tengo?', { topic: 'hp' }],
    ['¿cuánta vida me queda?', { topic: 'hp' }],
    ['¿cómo estoy?', { topic: 'hp' }],
    ['¿estoy herido?', { topic: 'hp' }],
    ['¿qué CA tengo?', { topic: 'armor' }],
    ['¿qué nivel tengo?', { topic: 'level' }],
    ['¿qué misiones tengo?', { topic: 'quests' }],
    ['dime mis misiones', { topic: 'quests' }],
    ['¿cuál es mi objetivo?', { topic: 'quests' }],
    ['¿cuánta gente hay a mi lado?', { topic: 'people' }],
    ['¿quién hay aquí?', { topic: 'people' }],
    ['¿hay alguien cerca?', { topic: 'people' }],
    ['¿dónde estoy?', { topic: 'where' }],
    ['¿cuántos dados tiro para esto?', { topic: 'roll', check: null }],
    ['¿qué tiro?', { topic: 'roll', check: null }],
    ['¿qué tirada es?', { topic: 'roll', check: null }],
    ['¿qué tiro para sigilo?', { topic: 'roll', check: { kind: 'skill', key: 'stealth' } }],
    ['¿cuánto sumo al ataque?', { topic: 'roll', check: { kind: 'attack', key: 'weapon' } }],
    ['¿qué tiro para una salvación de destreza?', { topic: 'roll', check: { kind: 'save', key: 'dex' } }],
    ['¿qué bonificador tengo en atletismo?', { topic: 'skill', skill: 'athletics' }],
    ['¿qué es la ventaja?', { topic: 'rule', term: 'ventaja' }],
    ['¿qué hace derribado?', { topic: 'rule', term: 'derribado' }],
    ['¿qué pasa si estoy asustada?', { topic: 'rule', term: 'asustado' }],
  ];
  it.each(cases)('«%s»', (text, want) => {
    expect(parseInfo(text)).toEqual(want);
  });

  // Al narrador: preguntas del mundo, a otros o por otros, acciones y dudas.
  const toNarrator = [
    'que hora es?', // partida: se la preguntó a la tabernera, que contestó en escena
    'tienes cerveza¿?', // partida
    'hay descuento en bebida?', // partida
    'se ha muerto la guardia ?', // partida
    'como sabes lo que tengo en la bolsa? de todas maneras, fiamela y ahre cualquier trabajo que me pidas', // partida
    'lanza le primer conjuro que tengas en la memoria', // partida
    'pedirt una pocion de curacion a alguien o si alguien le puede lanzar un hechizo', // partida
    'lele lanzxo un hechizo', // partida
    'bola de fuegoi', // partida
    'pues dame algo para el moribundo??', // partida
    '¿qué hay detrás de la puerta?',
    '¿qué sabe Ilse del pozo?',
    '¿qué hechizos tiene Ilse?',
    '¿cuánta vida le queda al guardia?',
    '¿cuánto oro tenemos?',
    '¿cuánto cuesta la cerveza?',
    '¿qué hago?',
    '¿qué es?',
    '¿qué lanzo?',
    '¿qué es la Brasa?',
    '¿qué tiro para abrir la puerta?',
    '¿qué tengo que hacer para entrar al molino?',
    '¿quién hay en la herrería?',
    'lanzo el primer conjuro que tengo',
    'tengo oro, págame',
    'destreza',
    'inventario', // la orden de siempre: sigue su camino
    'quien',
  ];
  it.each(toNarrator)('al narrador: «%s»', (text) => {
    expect(parseInfo(text)).toBeNull();
  });

  it('las reglas que sabe explicar salen de la chuleta', () => {
    expect(RULE_TERMS.get('derribado')).toMatch(/^derribado: se arrastra/);
    expect(RULE_TERMS.get('descanso corto')).toMatch(/^Descanso corto \(1 h\):/);
    expect(RULE_TERMS.has('condiciones')).toBe(false); // un encabezado sin texto no es una regla
  });
});

/** Máster que no debe usarse: si lo llaman, la acción revienta. */
const forbidden: MasterLike = { resolve() { throw new Error('no debería llamarse al master'); } };

describe('el sistema contesta sin narrador', () => {
  it('hoja, inventario, monedas y PG salen del estado, con su ficha', async () => {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    engine.attachMaster(forbidden);
    const before = engine.events.all().length;

    const dex = await engine.act('ch_kael', '¿cuánta destreza tengo?');
    expect(dex.ok).toBe(true);
    expect(dex.info?.title).toBe('Destreza');
    expect(dex.info?.lines[0]).toBe('12 (+1): una prueba de Destreza es 1d20 + 1.');
    expect(dex.event).toBeUndefined();

    const inv = await engine.act('ch_kael', '¿qué llevo en la mochila?');
    expect(inv.info?.title).toBe('Lo que llevas');
    expect(inv.text).toContain('daga');

    const gold = await engine.act('ch_kael', '¿cuánto oro tengo?');
    expect(gold.info?.lines[0]).toBe('Llevas 15 de oro.');

    const hp = await engine.act('ch_kael', '¿cuántos PV me quedan?');
    expect(hp.info?.lines[0]).toBe('PG 12 de 12.');

    // Ni el máster ni el registro: no es narración ni la ven los demás.
    expect(engine.events.all().length).toBe(before);
  });

  it('un guerrero no tiene conjuros; quién hay aquí incluye a los NPCs', async () => {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    engine.attachMaster(forbidden);
    const sp = await engine.act('ch_kael', 'q1ue conjuros tengo');
    expect(sp.info?.lines[0]).toMatch(/^No lanzas conjuros: tu clase \(guerrero\)/);

    const who = await engine.act('ch_kael', '¿quién hay aquí?');
    expect(who.info?.title).toBe('Quién hay aquí');
    expect(who.text).toMatch(/Brenna/);
  });

  it('un mago ve sus espacios y con qué lanza', async () => {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    engine.attachMaster(forbidden);
    const c = engine.world.character('ch_mira');
    c.class_id = 'wizard'; c.class_name = 'maga'; delete c.picks;
    initClass(c);
    const r = await engine.act('ch_mira', '¿qué hechizos tengo?');
    expect(r.info?.lines).toContain('Espacios de conjuro de nivel 1: 2 de 2 (vuelven con un descanso largo).');
    expect(r.info?.lines).toContain('Lanzas con Inteligencia: CD de salvación 11, ataque de conjuro 1d20 + 3 · preparados 2 de 2.');
    expect(r.info?.lines).toContain('**Trucos:** Descarga de fuego, Mano de mago, Luz.');
    expect(r.info?.lines).toContain('**Nivel 1:** Proyectil mágico, Escudo.');
    expect(r.info?.lines.some((l) => l.startsWith('En tu libro (6): Proyectil mágico, Escudo, Dormir, Armadura de mago, Manos ardientes, Detectar magia.') && l.includes('como ritual: Detectar magia'))).toBe(true);
  });

  it('«¿qué tiro para esto?» explica la tirada pendiente y no la gasta', async () => {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    let called = 0;
    engine.attachMaster({
      async resolve() {
        called++;
        return {
          ok: true, usage: {}, calls: [], context: '', model: 'stub',
          closed: { narration_private: 'Tendrás que no hacer ruido.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: { kind: 'skill', key: 'stealth', dc: 12, advantage: 'advantage' } },
        };
      },
    });
    await engine.act('ch_kael', 'me escondo detrás de la barra');
    expect(called).toBe(1);
    expect(engine.pendingRoll('ch_kael')).not.toBeNull();

    const r = await engine.act('ch_kael', '¿cuántos dados tiro para esto?');
    expect(called).toBe(1);
    expect(r.info?.title).toBe('Tu tirada pendiente');
    expect(r.info?.lines[0]).toBe('Sigilo: 1d20 + 1. Con ventaja: tira 2d20 y quédate con el mayor.');
    expect(r.text).not.toMatch(/12/); // la CD no se dice
    expect(engine.pendingRoll('ch_kael')).not.toBeNull();
  });

  it('lo que no es del juego sigue yendo al narrador', async () => {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    let called = 0;
    engine.attachMaster({
      async resolve() {
        called++;
        return { ok: true, usage: {}, calls: [], context: '', model: 'stub', closed: { narration_private: 'Detrás de la puerta, una despensa.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
      },
    });
    const r = await engine.act('ch_kael', '¿qué hay detrás de la puerta?');
    expect(called).toBe(1);
    expect(r.info).toBeUndefined();
  });
});
