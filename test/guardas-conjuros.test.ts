/**
 * Arreglos 31 (parte de las tools) y 39 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete F): un codazo no es un ataque, y
 * los conjuros y los rasgos van por su lista. Casos de la pareja metódico (20261126-0442, M15 y E16), el lanzador y el
 * tirador (20261126-0418).
 */
import { describe, expect, it } from 'vitest';
import { attackIntent, declaredStrike, spellsNamedIn, stateWithoutTool, strikeWithoutAttack, unknownTrait } from '../src/engine/closecheck.js';
import { Engine } from '../src/engine/engine.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { bootEngine, fakeTime } from './helpers.js';
import { ctxOnly, logEvent, rejectsOnceThenPasses, run } from './guardas-helpers.js';

const CODAZO = 'Tomo la ración y le doy un codazo a Elmo: ¿Y tú qué opinas de Ilse? Mira cómo agarra esa muñeca, como si temiera que le robáramos el lacre.';

/** Mira, maga: Descarga de fuego, Rayo de escarcha y Mano de mago; Proyectil mágico y Escudo preparados. */
async function maga(): Promise<Engine> {
  const seed = makeSeed();
  Object.assign(seed.characters.find((x) => x.id === 'ch_mira')!, { class_id: 'wizard', class_name: 'maga', hit_die: 6 });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed, now: fakeTime().now });
  const mira = engine.world.character('ch_mira');
  mira.spells!.cantrips = ['fire_bolt', 'ray_of_frost', 'mage_hand'];
  mira.spells!.prepared = ['magic_missile', 'shield'];
  return engine;
}

const together = (engine: Engine) => { engine.world.character('ch_mira').location = engine.world.character('ch_kael').location; };

describe('arreglo 31: un codazo no es un ataque', () => {
  it('M15: el codazo para llamar la atención no es ataque; con fuerza o a la cara, sí; con arma, sí', () => {
    expect(declaredStrike(CODAZO)).toBe('le doy un codazo');
    expect(attackIntent(CODAZO)).toBeNull();
    expect(attackIntent('Le doy un codazo en la cara a Elmo.')).toBe('le doy un codazo');
    expect(attackIntent('Le doy un codazo fuerte a Elmo para tumbarle.')).toBe('le doy un codazo');
    expect(attackIntent('Le clavo la daga a Elmo.')).toBe('le clavo la daga');
    expect(attackIntent('Le toco el hombro a Elmo.')).toBeNull();
  });

  it('request_reaction con kind attack y un codazo se rebaja a other, con hint', async () => {
    const { engine } = await bootEngine();
    together(engine);
    const ctx = ctxOnly(engine, 'state_rejections', { action_text: CODAZO.replace('Elmo', 'Mira') });
    const out = run(ctx, 'request_reaction', { target_character_id: 'ch_mira', kind: 'attack', attempt: 'darte un codazo', destination_spot_id: null, actor_skill: null, target_skills: null, character_id: null });
    expect(out.ok).toBe(true);
    expect(out['kind']).toBe('other');
    expect(out.hint).toContain('no es un ataque');
  });

  it('attack contra otro jugador sin verbo de ataque: no hay ataque', async () => {
    const { engine } = await bootEngine();
    together(engine);
    const ctx = ctxOnly(engine, 'state_rejections', { action_text: CODAZO.replace('Elmo', 'Mira') });
    const out = run(ctx, 'attack', { attacker_id: 'ch_kael', target_id: 'ch_mira', advantage: 'none' });
    expect(out.error).toBe('not_an_attack');
  });
});

describe('arreglo 39: conjuros por su lista', () => {
  it('lanzador T2: pide Rayo de escarcha y se lanza Descarga de fuego: se rechaza citando el pedido', async () => {
    const engine = await maga();
    const ctx = ctxOnly(engine, 'state_rejections', { action_text: 'Lanzo Rayo de escarcha contra el agua del pozo, a ver si congela lo que tiembla bajo la superficie.' }, 'ch_mira');
    const out = run(ctx, 'cast_spell', { spell: 'fire_bolt', slot_level: null, ritual: null, target_id: null });
    expect(out.error).toBe('not_the_asked_spell');
    expect(out.hint).toContain('«Rayo de escarcha»');
    expect(out.hint).toContain('spell ray_of_frost');
    expect(run(ctx, 'cast_spell', { spell: 'ray_of_frost', slot_level: null, ritual: null, target_id: null }).ok).toBe(true);
  });

  it('lanzador T2 y T33: un conjuro de ataque sin target_id no hace daño ni enseña tirada de daño', async () => {
    const engine = await maga();
    const ctx = ctxOnly(engine, 'state_rejections', { action_text: 'Lanzo Descarga de fuego contra la superficie turbia.' }, 'ch_mira');
    const out = run(ctx, 'cast_spell', { spell: 'fire_bolt', slot_level: null, ritual: null, target_id: null });
    expect(out.ok).toBe(true);
    expect(out['roll']).toBeUndefined();
    expect(String(out['attack'])).toContain('no hace daño a nadie');
    expect(ctx.shown_rolls ?? []).toEqual([]);
  });

  it('la etiqueta del daño, en español', async () => {
    const engine = await maga();
    const ctx = ctxOnly(engine, 'state_rejections', { action_text: 'Lanzo Proyectil mágico contra Brenna.' }, 'ch_mira');
    const out = run(ctx, 'cast_spell', { spell: 'magic_missile', slot_level: null, ritual: null, target_id: null });
    expect(String(out['roll'])).toMatch(/^daño fuerza: /);
    expect(JSON.stringify(ctx.shown_rolls)).toContain('(daño fuerza)');
    expect(JSON.stringify(ctx.shown_rolls)).not.toContain('force');
  });

  it('spellsNamedIn: los de su lista; «Luz» o «Escudo» solos, solo con mayúscula', () => {
    const names = ['Descarga de fuego', 'Rayo de escarcha', 'Escudo', 'Luz'];
    expect(spellsNamedIn('lanzo rayo de escarcha al pozo', names)).toEqual(['Rayo de escarcha']);
    expect(spellsNamedIn('Me cubro con el escudo y busco luz', names)).toEqual([]);
    expect(spellsNamedIn('Pronuncio Escudo', names)).toEqual(['Escudo']);
  });

  it('la guarda de conjuro sin cast_spell: en el lanzador no saltó porque el cierre decía que no se lanzaba', () => {
    // T21: «Proyectil mágico necesita una criatura, y el cubo no lo es: no lanzas nada ni gastas espacio.» Bien que pase.
    const spells = ['Proyectil mágico', 'Escudo', 'Descarga de fuego'];
    expect(stateWithoutTool({ action: 'Lanzo Proyectil mágico contra el cubo de agua.', narration: 'Proyectil mágico necesita una criatura, y el cubo no lo es: no lanzas nada ni gastas espacio.', okTools: [], spells })).toBeNull();
    // Y si lo da por lanzado sin cast_spell, salta.
    expect(stateWithoutTool({ action: 'Lanzo Proyectil mágico contra la sombra.', narration: 'Lanzas Proyectil mágico y tres dardos de luz se clavan en la sombra.', okTools: [], spells })?.kind).toBe('spell');
  });
});

describe('arreglo 39: rasgos que no están en la ficha', () => {
  it('tirador T20: «Acecho» lo niega spend_resource con la lista de los suyos', async () => {
    const { engine } = await bootEngine();
    const ctx = ctxOnly(engine, 'state_rejections');
    const out = run(ctx, 'spend_resource', { key: 'Acecho', amount: null });
    expect(out.error).toBe('not_in_sheet');
    expect(out.hint).toContain('no tiene «Acecho»');
    expect(out.hint).toContain('Tomar aliento [second_wind]');
    // Por su nombre en español también vale.
    expect(run(ctx, 'spend_resource', { key: 'Tomar aliento', amount: null }).ok).toBe(true);
  });

  it('tirador T20: el cierre que da por bueno «Acecho» sin tenerlo se rechaza; si lo niega, pasa', async () => {
    const action = 'Saco el arco corto y tenso una flecha hacia la puerta, usando mi rastreo de explorador para oír las botas fuera: "Acecho" gastando un uso.';
    expect(unknownTrait({ action, narration: 'Con el arco tenso, el silencio de la plaza se vuelve nítido.', known: ['Tomar aliento'] })).toBe('Acecho');
    expect(unknownTrait({ action, narration: 'No tienes ningún Acecho: tensas el arco y escuchas, sin más.', known: ['Tomar aliento'] })).toBeNull();
    expect(unknownTrait({ action: 'Uso mi Sentido salvaje.', narration: 'Hueles el humo.', known: ['Tomar aliento'] })).toBe('Sentido salvaje');
    expect(unknownTrait({ action: 'Uso mi Tomar aliento.', narration: 'Respiras hondo.', known: ['Tomar aliento'] })).toBeNull();
    const { engine } = await bootEngine();
    const err = rejectsOnceThenPasses(ctxOnly(engine, 'trait_rejections', { action_text: action }), logEvent('«Acecho.» Tensas el arco corto y apuntas a la rendija de la puerta.'));
    expect(err).toContain('«Acecho» y eso no está en la ficha de Kael');
    expect(err).toContain('Tomar aliento');
  });

  it('disparar es atacar (tirador T22); a una cosa o sin soltar la cuerda, no (T7, T40)', () => {
    expect(declaredStrike('Tenso el arco hacia la rendija y disparo una flecha a la sombra que se inclina, al bulto que respira junto a la puerta, sin avisar.')).toBe('disparo una flecha a');
    expect(declaredStrike('Apunto al bandido y disparo.')).toBe('apunto al bandido y disparo');
    expect(declaredStrike('Disparo una flecha al suelo junto a sus botas.')).toBeNull();
    expect(declaredStrike('Tenso el arco corto y apunto una flecha a la figura del portón norte, sin soltar la cuerda.')).toBeNull();
    expect(strikeWithoutAttack({ action: 'Disparo una flecha a la sombra.', narration: 'Mantienes la cuerda tensa un instante más.', attackRoll: false, pcAttacked: false, okTools: [] })).toBe('disparo una flecha a');
  });
});
