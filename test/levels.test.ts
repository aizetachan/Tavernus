import { describe, expect, it } from 'vitest';
import { noticeOf } from '../src/adapters/web/notice.js';
import { sheetView } from '../src/adapters/sheet-view.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { seededRng } from '../src/engine/dice.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { parseInfo } from '../src/engine/fastpath.js';
import {
  abilitiesForMaster, castSpell, castableSpells, classFeatures, classResources, levelForXp, levelUp, makeChoice, pendingChoices, setSpells, xpForLevel,
} from '../src/engine/levels.js';
import type { Character } from '../src/engine/model.js';
import { armorClass, skillModifier } from '../src/engine/rules.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { bootEngine, fakeTime } from './helpers.js';

const forbidden: MasterLike = { resolve() { throw new Error('no debería llamarse al master'); } };

async function make(classId: string, name = 'Prueba'): Promise<{ engine: Engine; c: Character }> {
  const { engine } = await bootEngine(undefined, { deterministic: true });
  engine.attachMaster(forbidden);
  const r = await engine.createCharacter(`u_${classId}`, name, { class_id: classId });
  if (!r.ok) throw new Error(r.reason);
  return { engine, c: r.character };
}

const names = (c: Character) => classFeatures(c).map((f) => f.name);
const slots = (c: Character) => classResources(c).filter((r) => r.key.startsWith('slot_')).map((r) => r.max);

describe('experiencia y niveles (SRD)', () => {
  it('umbrales de PX', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 300, 900, 2700, 6500]);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(7000)).toBe(5);
    expect(levelForXp(1e9)).toBe(20);
  });
});

describe('mago', () => {
  it('al crearlo: trucos, libro de 6, preparados INT + nivel, espacios y Recuperación arcana; trasfondo de erudito', async () => {
    const { c } = await make('wizard');
    expect(c.abilities.int).toBe(16);
    expect(c.background_id).toBe('sage');
    expect(c.proficiencies.skills).toEqual(expect.arrayContaining(['arcana', 'history']));
    expect(c.proficiencies.skills).not.toContain('athletics');
    expect(c.spells!.cantrips).toEqual(['fire_bolt', 'mage_hand', 'light']);
    expect(c.spells!.known).toEqual(['magic_missile', 'shield', 'sleep', 'mage_armor', 'burning_hands', 'detect_magic']);
    expect(c.spells!.prepared).toEqual(['magic_missile', 'shield', 'sleep', 'mage_armor']);
    expect(castableSpells(c)).toContain('magic_missile');
    expect(castableSpells(c)).not.toContain('burning_hands');
    expect(slots(c)).toEqual([2]);
    expect(names(c)).toEqual(['Lanzamiento de conjuros', 'Recuperación arcana']);
    expect(pendingChoices(c)).toEqual([]);
  });

  it('lanza: gasta el espacio más bajo, tira los dados; sin espacios, no; como ritual, sin espacio', async () => {
    const { c } = await make('wizard');
    const rng = seededRng(7);
    const mm = castSpell(c, 'Proyectil mágico', {}, rng);
    expect(mm).toMatchObject({ ok: true, cast_level: 1, slot: { key: 'slot_1', left: 1 }, roll: { expr: '3d4+3' } });
    expect(castSpell(c, 'fire_bolt', {}, rng)).toMatchObject({ ok: true, slot: null, roll: { expr: '1d10' } });
    expect(castSpell(c, 'escudo', {}, rng)).toMatchObject({ ok: true, slot: { left: 0 } });
    expect(castSpell(c, 'sleep', {}, rng)).toMatchObject({ ok: false, error: expect.stringContaining('No le quedan espacios') });
    expect(castSpell(c, 'Detectar magia', { ritual: true }, rng)).toMatchObject({ ok: true, ritual: true, slot: null });
    expect(castSpell(c, 'Bola de fuego', {}, rng)).toMatchObject({ ok: false, error: expect.stringContaining('Puede lanzar') });
  });

  it('sube a nivel 3: PG, espacios de nivel 2, libro y preparados más grandes, Evocación', async () => {
    const { c } = await make('wizard');
    c.xp = 900;
    const r = levelUp(c)!;
    expect(r).toMatchObject({ from: 1, to: 3, hp_gain: 12, hp_max: 20, slots: '4 de nivel 1, 2 de nivel 2' });
    expect(r.features).toEqual(['Erudito en evocación (Evocación)', 'Esculpir conjuros (Evocación)']);
    expect(r.spells).toEqual(['Onda atronadora', 'Encontrar familiar', 'Paso brumoso', 'Rayo abrasador']);
    expect(r.prepared).toEqual(['Manos ardientes', 'Detectar magia']);
    expect(c.spells!.known).toHaveLength(10);
    expect(c.spells!.prepared).toHaveLength(6);
    expect(levelUp(c)).toBeNull();
    // Cambia lo que prepara: solo de su libro y hasta su máximo.
    expect(setSpells(c, 'prepared', ['magic_missile', 'misty_step'])).toEqual({ ok: true });
    expect(setSpells(c, 'prepared', ['fireball'])).toMatchObject({ ok: false });
    expect(castSpell(c, 'Paso brumoso', {}, seededRng(1))).toMatchObject({ ok: true, cast_level: 2, slot: { key: 'slot_2' } });
  });
});

describe('clérigo', () => {
  it('al crearlo: Dominio de la Vida, conjuros de dominio siempre preparados y curación con Discípulo de la vida', async () => {
    const { c } = await make('cleric');
    expect(c.background_id).toBe('acolyte');
    expect(c.spells!.cantrips).toEqual(['sacred_flame', 'guidance', 'light']);
    expect(c.spells!.prepared).toEqual(['healing_word', 'guiding_bolt', 'shield_of_faith', 'sanctuary']);
    expect(castableSpells(c)).toEqual(expect.arrayContaining(['bless', 'cure_wounds']));
    expect(names(c)).toEqual(['Lanzamiento de conjuros', 'Dominio de la Vida', 'Discípulo de la vida']);
    // 1d8 + SAB (+3) + Discípulo de la vida (2 + nivel del espacio).
    expect(castSpell(c, 'Curar heridas', {}, seededRng(3))).toMatchObject({ ok: true, roll: { expr: '1d8+3+3' } });
    expect(castSpell(c, 'Curar heridas', { slot_level: 2 }, seededRng(3))).toMatchObject({ ok: false });
  });

  it('sube a nivel 3: Canalizar divinidad, más dominio, espacios de nivel 2 y lanza más alto', async () => {
    const { c } = await make('cleric');
    c.xp = 1000;
    const r = levelUp(c)!;
    expect(r.to).toBe(3);
    expect(r.features).toEqual(['Canalizar divinidad']);
    expect(r.resources).toEqual(['Canalizar divinidad 1']);
    expect(slots(c)).toEqual([4, 2]);
    expect(castableSpells(c)).toEqual(expect.arrayContaining(['lesser_restoration', 'spiritual_weapon']));
    expect(c.spells!.prepared).toHaveLength(6);
    expect(castSpell(c, 'Curar heridas', { slot_level: 2 }, seededRng(3))).toMatchObject({ ok: true, cast_level: 2, roll: { expr: '1d8+1d8+3+4' } });
  });
});

describe('guerrero', () => {
  it('al crearlo: Tomar aliento, estilo Defensa por defecto (+1 CA) y sin conjuros', async () => {
    const { c, engine } = await make('fighter');
    expect(names(c)).toEqual(['Tomar aliento']);
    expect(c.picks).toEqual({ fighting_style: ['defense'] });
    expect(armorClass(engine.world, c)).toBe(19);
    expect(c.spells).toBeUndefined();
    expect(classResources(c).map((r) => r.key)).toEqual(['second_wind']);
    // Cambia de estilo: Tiro con arco no suma a la CA.
    expect(makeChoice(c, 'fighting_style', ['archery'])).toMatchObject({ ok: true });
    expect(armorClass(engine.world, c)).toBe(18);
  });

  it('sube a nivel 4: Oleada de acción, Crítico mejorado y una mejora de característica que elige él, una vez', async () => {
    const { c } = await make('fighter');
    c.xp = 2700;
    const r = levelUp(c)!;
    expect(r).toMatchObject({ to: 4, hp_gain: 24, features: ['Oleada de acción', 'Crítico mejorado (Campeón)'], pending: ['Mejora de característica'] });
    expect(r.resources).toEqual(['Oleada de acción 1']);
    expect(makeChoice(c, 'asi_4', ['str'])).toMatchObject({ ok: false });
    expect(makeChoice(c, 'asi_4', ['str', 'str'])).toMatchObject({ ok: true, text: expect.stringContaining('FUE +2 (18)') });
    expect(c.abilities.str).toBe(18);
    expect(makeChoice(c, 'asi_4', ['con', 'con'])).toMatchObject({ ok: false, error: 'Esa mejora ya la elegiste.' });
    expect(pendingChoices(c)).toEqual([]);
  });
});

describe('pícaro', () => {
  it('al crearlo: Pericia por defecto en Sigilo y Percepción, Ataque furtivo 1d6, sin recursos', async () => {
    const { c } = await make('rogue');
    expect(c.background_id).toBe('criminal');
    expect(c.proficiencies.expert).toEqual(['stealth', 'perception']);
    expect(skillModifier(c, 'stealth')).toBe(3 + 4);
    expect(c.passive_perception).toBe(10 + 0 + 4);
    expect(classFeatures(c).find((f) => f.id === 'sneak_attack')!.text).toContain('1d6 de daño extra');
    expect(classResources(c)).toEqual([]);
    // La pericia se cambia, solo entre sus competencias.
    expect(makeChoice(c, 'expertise', ['stealth', 'religion'])).toMatchObject({ ok: false });
    expect(makeChoice(c, 'expertise', ['stealth', 'deception'])).toMatchObject({ ok: true });
    expect(c.proficiencies.expert).toEqual(['stealth', 'deception']);
  });

  it('sube a nivel 6: Ataque furtivo 3d6, Esquiva asombrosa y otra Pericia por defecto', async () => {
    const { c } = await make('rogue');
    c.xp = 14000;
    const r = levelUp(c)!;
    expect(r.to).toBe(6);
    expect(r.features).toEqual(['Acción astuta', 'Manos rápidas (Ladrón)', 'Trepador (Ladrón)', 'Esquiva asombrosa']);
    expect(r.defaults).toEqual(['Pericia: Investigación, Engaño']);
    expect(r.pending).toEqual(['Mejora de característica']);
    expect(classFeatures(c).find((f) => f.id === 'sneak_attack')!.text).toContain('3d6');
    expect(c.proficiencies.expert).toEqual(['stealth', 'perception', 'investigation', 'deception']);
  });
});

describe('en el motor', () => {
  it('al cruzar el umbral sube solo y avisa: al PJ, lo que gana con enlace a la Hoja; a quien está con él, una línea', async () => {
    const { engine } = await bootEngine(undefined, { deterministic: true });
    engine.attachMaster(forbidden);
    const kael = engine.world.character('ch_kael');
    kael.xp = 320;
    await engine.act('ch_kael', '¿qué nivel tengo?');
    expect(kael.level).toBe(2);
    const e = engine.events.all().find((x) => x.action_type === 'progress_level')!;
    expect(e.payload['level_up']).toMatchObject({ level: 2, head: 'Kael sube a nivel 2' });
    const mine = noticeOf(e, 'ch_kael');
    expect(mine).toMatchObject({ text: '⬆ Kael sube a nivel 2', tab: 'sheet', level: { level: 2 } });
    expect(mine!.level!.gains[0]).toMatch(/^PG máximos \d+ \(\+\d+\)/);
    expect(mine!.level!.gains).toContain('Rasgos nuevos: Oleada de acción');
    expect(noticeOf(e, 'ch_mira', e.observable ?? '')).toMatchObject({ text: 'Kael sube a nivel 2' });
  });

  it('la mejora de característica se elige desde la Hoja y deja aviso', async () => {
    const { engine, c } = await make('fighter', 'Brunilda');
    c.xp = 2700;
    await engine.act(c.id, '¿qué nivel tengo?');
    expect(sheetView(engine, c.id).class.choices.find((x) => x.key === 'asi_4')).toMatchObject({ pending: true, final: true });
    expect(await engine.choose(c.id, 'asi_4', ['con', 'str'])).toMatchObject({ ok: true });
    expect(engine.events.all().at(-1)).toMatchObject({ action_type: 'progress_level', narration_private: expect.stringContaining('CON +1') });
    expect(await engine.choose(c.id, 'prepared', ['bless'])).toMatchObject({ ok: false });
  });

  it('la Hoja trae rasgos con usos, conjuros con su texto y lo que se puede cambiar', async () => {
    const { engine, c } = await make('wizard', 'Leodhin');
    const s = sheetView(engine, c.id);
    expect(s.class.features.find((f) => f.name === 'Recuperación arcana')!.uses).toEqual({ left: 1, max: 1, recharge: 'long' });
    expect(s.class.spells).toMatchObject({ ability: 'int', save_dc: 13, attack: 5, slots: [{ label: 'Nivel 1', left: 2, max: 2 }] });
    expect(s.class.spells!.groups.map((g) => g.label)).toEqual(['Trucos', 'Nivel 1']);
    expect(s.class.spells!.groups[1]!.spells[0]).toMatchObject({ name: 'Proyectil mágico', time: 'acción', range: '36 m', text: expect.stringContaining('no fallan') });
    expect(s.class.spells!.edits.map((x) => [x.key, x.count])).toEqual([['cantrips', 3], ['known', 6], ['prepared', 4]]);
    expect(s.fields.find((f) => f.name === 'Conjuros')!.value).toContain('Trucos: Descarga de fuego, Mano de mago, Luz');
  });

  it('«¿qué sé hacer?» y «¿qué hechizos tengo?» lo contestan desde la clase', async () => {
    expect(parseInfo('¿qué sé hacer?')).toEqual({ topic: 'features' });
    expect(parseInfo('mis rasgos')).toEqual({ topic: 'features' });
    expect(parseInfo('¿qué puedo hacer aquí?')).toBeNull();
    const { engine, c } = await make('cleric', 'Miau');
    const f = await engine.act(c.id, '¿qué sé hacer?');
    expect(f.info?.title).toBe('Lo que sabes hacer · clérigo 1');
    expect(f.info?.lines.some((l) => l.startsWith('**Discípulo de la vida**:'))).toBe(true);
    expect(f.info?.lines).toContain('Conjuros: 3 trucos, 6 de nivel 1 (pregunta «¿qué hechizos tengo?»).');
    const sp = await engine.act(c.id, '¿qué hechizos tengo?');
    expect(sp.info?.lines).toContain('**Nivel 1:** Palabra de curación, Saeta guía, Escudo de fe, Santuario, Bendecir (siempre), Curar heridas (siempre).');
    const lv = await engine.act(c.id, '¿qué nivel tengo?');
    expect(lv.info?.lines[1]).toContain('Nivel 2 a los 300 PX: te faltan 300');
  });

  it('el máster lo tiene en su contexto y lanza con cast_spell, que gasta el espacio y enseña la tirada', async () => {
    const { engine, c } = await make('wizard', 'Leodhin');
    const lines = abilitiesForMaster(c);
    expect(lines.some((l) => l.startsWith('Conjuros (cast_spell; lanza con INT, CD 13, ataque +5): Trucos: Descarga de fuego, Mano de mago, Luz; Nivel 1: Proyectil mágico'))).toBe(true);
    expect(lines.some((l) => l.includes('Recuperación arcana [arcane_recovery 1/1]'))).toBe(true);
    const ctx: ToolContext = { engine, actor: c, nowGameS: engine.gameNow(), rng: seededRng(5), closed: null, rolls: [], progress: [] };
    const ok = JSON.parse(executeTool(ctx, 'cast_spell', { spell: 'Proyectil mágico', slot_level: null, ritual: null, target_id: null }));
    expect(ok).toMatchObject({ ok: true, spell: 'Proyectil mágico', level: 1, slot: 'espacios de conjuro de nivel 1: le quedan 1', apply: 'aplícalo con apply_damage' });
    expect(ctx.shown_rolls?.[0]?.label).toBe('Proyectil mágico (daño force)');
    const atk = JSON.parse(executeTool(ctx, 'cast_spell', { spell: 'fire_bolt', slot_level: null, ritual: null, target_id: 'npc_doro' }));
    expect(atk.attack).toMatch(/contra CA \d+/);
    const no = JSON.parse(executeTool(ctx, 'cast_spell', { spell: 'Curar heridas', slot_level: null, ritual: null, target_id: null }));
    expect(no.error).toContain('no tiene Curar heridas');
  });

  it('migrate: un mago guardado sin conjuros los recibe al cargar la partida', async () => {
    const seed = makeSeed();
    const mira = seed.characters.find((x) => x.id === 'ch_mira')!;
    Object.assign(mira, { class_id: 'wizard', class_name: 'maga', hit_die: 6 });
    const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'demo', seed, now: fakeTime().now });
    const c = engine.world.character('ch_mira');
    expect(c.spells!.cantrips).toHaveLength(3);
    expect(c.spells!.known).toHaveLength(6);
    expect(c.spells!.prepared).toHaveLength(2);
    expect(c.picks).toEqual({});
  });
});
