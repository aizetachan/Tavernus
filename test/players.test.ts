import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine.js';
import { sheetView } from '../src/adapters/sheet-view.js';
import { bootEngine, fakeTime } from './helpers.js';

describe('alta de personaje y presencia', () => {
  it('crea un personaje en el punto de inicio con equipo básico y avisa a los presentes', async () => {
    const { engine, repo } = await bootEngine();
    const texts: string[] = [];
    engine.onDelivery((d) => texts.push(`${d.character_id}: ${d.text}`));
    const r = await engine.createCharacter('web:123', 'Ánxela do Mar');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Taberna y plaza ya tienen un PJ cada una; el claro está vacío.
    expect(r.character.location).toEqual({ type: 'spot', id: 'sp_cl_sendero' });
    expect(engine.characterByUser('web:123')?.id).toBe(r.character.id);
    expect(await engine.command(r.character.id, '/inventory')).toContain('mochila: antorcha ×5, ración ×5, cuerda de cáñamo');
    expect(await engine.command(r.character.id, '/inventory')).toContain('Manos: espada larga / escudo');
    // Nadie está en el claro: solo ella recibe su llegada.
    expect(texts).toEqual([`${r.character.id}: Llegas a Claro del Roble.`]);
    // El siguiente reparte: ahora las tres tienen uno; empate → el primero de la lista.
    const r2 = await engine.createCharacter('web:789', 'Bruno');
    expect(r2.ok && r2.character.location.id).toBe('sp_tab_puerta');
    // Los PJ de la partida se conocen por su nombre desde que coinciden: Kael ya sabe quién es Bruno.
    expect(texts).toContain('ch_kael: Bruno llega a la puerta.');
    expect(repo.writes.some((w) => w.collection === 'characters' && w.id === r.character.id)).toBe(true);
    // Validaciones.
    expect(await engine.createCharacter('web:123', 'Otro')).toMatchObject({ ok: false, reason: 'Ya tienes un personaje.' });
    expect(await engine.createCharacter('web:456', 'kael')).toMatchObject({ ok: false, reason: 'Ese nombre ya está en uso.' });
    expect(await engine.createCharacter('web:456', 'X')).toMatchObject({ ok: false });
  });

  it('conectado = presencia online o acción en los últimos 30 min; si no, velo', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    engine.setPresence('ch_kael', false);
    expect(kael.connected).toBe(false);
    expect(kael.veiled).toBe(true);
    expect(kael.status).toBe('asleep');
    // Actuar reconecta aunque la presencia siga offline...
    await engine.act('ch_kael', 'despierto');
    expect(kael.connected).toBe(true);
    expect(kael.veiled).toBe(false);
    // ...durante 30 min reales.
    time.advanceReal(29 * 60);
    await engine.tick();
    expect(kael.connected).toBe(true);
    time.advanceReal(2 * 60);
    await engine.tick();
    expect(kael.connected).toBe(false);
    expect(kael.veiled).toBe(true);
    // Con presencia online no hace falta actuar.
    engine.setPresence('ch_kael', true);
    expect(kael.connected).toBe(true);
    expect(kael.veiled).toBe(false);
    expect(kael.status).toBe('asleep'); // sigue dormido en el juego hasta que diga «despierto»
    expect(Engine.CONNECTED_GRACE_MS).toBe(30 * 60 * 1000);
  });

  it('la hoja viva se renderiza desde los datos', async () => {
    const { engine } = await bootEngine();
    const sheet = sheetView(engine, 'ch_kael');
    expect(sheet.title).toBe('Kael · humano guerrero · nivel 1');
    expect(sheet.fields.find((f) => f.name === 'Combate')?.value).toContain('PG 12/12 · CA 11');
    expect(sheet.description).toContain('Taberna del Jabalí, la barra');
    expect(sheet.fields.find((f) => f.name === 'Manos')?.value).toBe('daga / —');
    expect(sheet.fields.find((f) => f.name === 'mochila')?.value).toBe('cuerda de cáñamo, antorcha ×3');
  });
});

describe('creación con SRD', () => {
  it('valida raza, clase, trasfondo, array estándar y skills; calcula PG, CA y competencias', async () => {
    const { engine } = await bootEngine();
    const { armorClass, skillModifier } = await import('../src/engine/rules.js');
    const bad = await engine.createCharacter('u1', 'Tam', { race_id: 'elf', class_id: 'rogue', background_id: 'criminal', abilities: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 }, skills: ['acrobatics', 'athletics', 'insight', 'investigation'], death_mode: 'casual' });
    expect(bad).toMatchObject({ ok: false, reason: expect.stringContaining('array estándar') });
    const dup = await engine.createCharacter('u1', 'Tam', { race_id: 'elf', class_id: 'rogue', background_id: 'criminal', abilities: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 }, skills: ['stealth', 'athletics', 'insight', 'investigation'], death_mode: 'casual' });
    expect(dup).toMatchObject({ ok: false, reason: expect.stringContaining('ya la tienes') });
    const few = await engine.createCharacter('u1', 'Tam', { race_id: 'elf', class_id: 'rogue', background_id: 'criminal', abilities: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 }, skills: ['acrobatics'], death_mode: 'casual' });
    expect(few).toMatchObject({ ok: false, reason: 'Elige 4 habilidades de clase.' });
    const r = await engine.createCharacter('u1', 'Tam', { race_id: 'elf', class_id: 'rogue', background_id: 'criminal', abilities: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 }, skills: ['acrobatics', 'athletics', 'insight', 'investigation'], death_mode: 'hardcore' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.character;
    expect(c.abilities).toEqual({ str: 8, dex: 17, con: 13, int: 12, wis: 10, cha: 14 }); // elfo +2 DES
    expect(c.hp_max).toBe(8 + 1);
    expect(c.darkvision).toBe(true);
    expect(c.proficiencies.saves).toEqual(['dex', 'int']);
    expect(c.proficiencies.skills.sort()).toEqual(['acrobatics', 'athletics', 'deception', 'insight', 'investigation', 'perception', 'stealth']);
    expect(c.proficiencies.expert).toEqual(['stealth', 'perception']); // Pericia del pícaro, por defecto: Sigilo y Percepción
    expect(c.passive_perception).toBe(10 + 0 + 2 * 2); // SAB 10, competente por raza y con pericia
    expect(skillModifier(c, 'stealth')).toBe(3 + 2 * 2);
    expect(armorClass(engine.world, c)).toBe(11 + 3); // cuero + DES
    expect(c.death_mode).toBe('hardcore');
    const inv = await engine.command(c.id, '/inventory');
    expect(inv).toContain('Manos: espada corta / —');
    expect(inv).toContain('Bolsillos: daga ×2, herramientas de ladrón');
    expect(inv).toContain('body: armadura de cuero');
  });

  it('el guerrero recomendado lleva cota de malla y escudo, con el estilo Defensa: CA 19', async () => {
    const { engine } = await bootEngine();
    const { armorClass } = await import('../src/engine/rules.js');
    const r = await engine.createCharacter('u2', 'Bruno');
    if (!r.ok) throw new Error(r.reason);
    expect(r.character.hp_max).toBe(12); // d10 + CON 14 (13+1 humano)
    expect(armorClass(engine.world, r.character)).toBe(16 + 0 + 2 + 1);
  });
});
