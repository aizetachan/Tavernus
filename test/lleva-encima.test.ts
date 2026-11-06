/**
 * Lo que lleva cada personaje (PLAN-OBJETOS §7, bloque F). Sin API.
 *  - PJ: el equipo de su clase, su ropa y lo de su trasfondo; nada cae al suelo y se ve en el resumen.
 *  - Ajuar: niños sin bolsa (`purse: false`), ropa puesta (`state.worn`) y versión del ajuar para partidas ya equipadas.
 *  - Brezal: lo que la historia nombra de cada vecino, encima o en su sitio.
 *  - Mundos generados: un objeto propio por NPC, custom y validado.
 *  - Wiki: la sección «Lleva encima» sale de los datos.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { BACKGROUNDS, CLASSES } from '../src/data/srd/index.js';
import { PC_GEAR_ITEMS } from '../src/data/srd/gear.js';
import { Engine } from '../src/engine/engine.js';
import { previewCharacter, startingEquipment } from '../src/engine/chargen.js';
import { carrierOf, npcCarryList, transferItem } from '../src/engine/inventory.js';
import { isWorn, kitOf, OUTFIT_VERSION, outfitNpcs } from '../src/engine/outfit.js';
import type { Character, ItemInstance, WorldSnapshot } from '../src/engine/model.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { CATALOG, MAX_PART_SCHEMA_CHARS, normalizePeople, PART_SCHEMAS, schemaChars, splitFill, validatePeople } from '../src/worldgen/fill.js';
import { buildSkeleton, buildSnapshot, generateSeed, offlineFill, ownItemOf, validateSnapshot } from '../src/worldgen/index.js';
import { brezalOutfitted, carriesMarkdown, carriesOf, replaceSection } from '../src/wiki/carries.js';
import { buildWiki } from '../src/wiki/build.js';
import { frontmatter } from '../src/wiki/markdown.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot(seed: WorldSnapshot = authoredSeed('brezal', { now: new Date(EPOCH) })) {
  const time = fakeTime(EPOCH);
  return Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
}

/** Lo que lleva encima (en manos, bolsillos, equipado o dentro de lo que lleva) un PJ o NPC. */
function carried(engine: Engine, id: string): ItemInstance[] {
  return [...engine.world.itemInstances.values()].filter((i) => carrierOf(engine.world, i.location)?.id === id);
}
const has = (engine: Engine, id: string, itemId: string) => carried(engine, id).some((i) => i.item_id === itemId);
const slotOf = (engine: Engine, id: string, itemId: string) => {
  const i = carried(engine, id).find((x) => x.item_id === itemId);
  return i?.location.type === 'character' ? i.location.slot : i?.location.type;
};

describe('el PJ lleva lo de su clase, su ropa y lo de su trasfondo', () => {
  it('soldado guerrero: insignia y dados en los bolsillos, trofeo y ropa en la mochila (la cota va en el cuerpo)', async () => {
    const engine = await boot();
    const r = await engine.createCharacter('u_ana', 'Ana', { class_id: 'fighter', background_id: 'soldier' });
    if (!r.ok) throw new Error(r.reason);
    const id = r.character.id;
    expect(slotOf(engine, id, 'it_cota_malla')).toEqual({ kind: 'equipped', slot: 'body' });
    expect(slotOf(engine, id, 'it_insignia')).toEqual({ kind: 'pocket' });
    expect(slotOf(engine, id, 'it_dados')).toEqual({ kind: 'pocket' });
    expect(slotOf(engine, id, 'it_trofeo')).toBe('container');
    expect(slotOf(engine, id, 'it_ropa_viaje')).toBe('container');
    // Brezal no trae estas definiciones en su catálogo: las añade el motor al crear el PJ.
    expect(engine.world.itemDefs.get('it_insignia')?.name).toBe('insignia de rango');
  });

  it('erudito mago: la ropa puesta en el cuerpo; noble hechicero: el anillo en el dedo y ropa fina', async () => {
    const engine = await boot();
    const a = await engine.createCharacter('u_bo', 'Bo', { class_id: 'wizard', background_id: 'sage' });
    const b = await engine.createCharacter('u_cy', 'Cy', { class_id: 'sorcerer', background_id: 'noble' });
    if (!a.ok || !b.ok) throw new Error('no se crearon');
    expect(slotOf(engine, a.character.id, 'it_ropa_viaje')).toEqual({ kind: 'equipped', slot: 'body' });
    expect(has(engine, a.character.id, 'it_carta_colega')).toBe(true);
    expect(slotOf(engine, b.character.id, 'it_ropa_fina')).toEqual({ kind: 'equipped', slot: 'body' });
    expect(slotOf(engine, b.character.id, 'it_anillo_sello_pj')).toEqual({ kind: 'equipped', slot: 'ring1' });
  });

  it('el clérigo acólito lleva un solo símbolo sagrado', () => {
    const cleric = CLASSES.find((c) => c.id === 'cleric')!;
    const acolyte = BACKGROUNDS.find((b) => b.id === 'acolyte')!;
    const kit = startingEquipment(cleric, acolyte);
    expect(kit.filter((e) => e.item_id === 'it_simbolo_sagrado')).toHaveLength(1);
    expect(kit.find((e) => e.item_id === 'it_libro_oraciones')?.from).toBe('background');
  });

  it('ninguna combinación de clase y trasfondo deja nada en el suelo, y todo objeto tiene definición', async () => {
    const gear = new Set(PC_GEAR_ITEMS.map((d) => d.id));
    const catalog = new Set(CATALOG.map((d) => d.id));
    for (const b of BACKGROUNDS) {
      expect(gear.has(b.clothes), b.id).toBe(true);
      for (const e of b.equipment) expect(gear.has(e.item_id) || catalog.has(e.item_id), `${b.id}: ${e.item_id}`).toBe(true);
    }
    const engine = await boot();
    let n = 0;
    for (const k of CLASSES) {
      for (const b of BACKGROUNDS) {
        const r = await engine.createCharacter(`u_${n}`, `Pj ${n++}`, { class_id: k.id, background_id: b.id });
        if (!r.ok) throw new Error(r.reason);
        const c: Character = r.character;
        const floor = [...engine.world.itemInstances.values()].filter((i) => i.location.type === 'spot' && i.location.id === c.location.id && !engine.world.itemDef(i.item_id).container?.fixed);
        expect(floor.filter((i) => gear.has(i.item_id) || k.equipment.some((e) => e.item_id === i.item_id)), `${k.id}/${b.id}`).toEqual([]);
        for (const e of startingEquipment(k, b)) expect(has(engine, c.id, e.item_id), `${k.id}/${b.id}: ${e.item_id}`).toBe(true);
      }
    }
  });

  it('el resumen de la creación enseña lo del trasfondo aparte', () => {
    const r = previewCharacter('Ana', { class_id: 'fighter', background_id: 'soldier' }, CATALOG);
    if (!r.ok) throw new Error(r.reason);
    const bg = r.preview.equipment.filter((e) => e.from === 'background').map((e) => e.name);
    expect(bg).toEqual(['ropa de viaje', 'insignia de rango', 'trofeo de un enemigo', 'dados de hueso']);
    expect(r.preview.equipment.find((e) => e.name === 'cota de malla')?.from).toBe('class');
    // La ropa no cuenta para la CA: la misma que con cualquier otro trasfondo.
    const other = previewCharacter('Ana', { class_id: 'fighter', background_id: 'sage' }, CATALOG);
    expect(other.ok && other.preview.ac).toBe(r.preview.ac);
  });
});

describe('el ajuar: niños sin bolsa, ropa puesta y versión', () => {
  const blank = () => {
    const snap = authoredSeed('brezal', { now: new Date(EPOCH) });
    const nina = structuredClone(snap.npcs.find((n) => n.id === 'npc_tobias')!);
    delete nina.kit;
    delete nina.outfitted;
    snap.npcs.push({ ...nina, id: 'npc_nina', name: 'Nina', role: 'niña del molino' });
    return snap;
  };

  it('una niña no lleva bolsa ni dinero: sus cosas, sueltas encima; y viste su ropa', () => {
    const snap = blank();
    expect(kitOf({ role: 'niña del molino' }).id).toBe('child');
    expect(kitOf({ role: 'mozo de cuadra' }).id).not.toBe('child');
    outfitNpcs(snap);
    const mine = snap.item_instances.filter((i) => i.location.type === 'npc' && i.location.id === 'npc_nina');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.some((i) => snap.item_defs.find((d) => d.id === i.item_id)?.container)).toBe(false);
    expect(mine.some((i) => i.state['coins'])).toBe(false);
    expect(mine.filter(isWorn).map((i) => i.item_id)).toEqual(['it_kit_clothes']);
  });

  it('el máster ve la ropa con «viste» y, al quitársela, deja de estar puesta', async () => {
    const engine = await boot();
    const list = npcCarryList(engine.world, 'npc_hugo').join('; ');
    expect(list).toContain('viste mandil de cuero [ii_kit_hugo_apron]');
    const mandil = carried(engine, 'npc_hugo').find(isWorn)!;
    const moved = transferItem(engine.world, mandil.id, { type: 'spot', id: engine.world.npc('npc_hugo').location.id });
    expect(moved.ok).toBe(true);
    expect(isWorn(engine.world.itemInstance(mandil.id))).toBe(false);
  });

  it('un NPC equipado con la versión 1 recibe solo lo nuevo: ropa y lo que la campaña le pone ahora encima', () => {
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    const old = structuredClone(seed);
    outfitNpcs(old);
    // Así era una partida de la versión 1: sin ropa, sin la jarra de Brenna, y a Hugo le robaron la navaja.
    old.item_instances = old.item_instances.filter((i) => !isWorn(i) && i.id !== 'ii_brenna_jarra' && i.id !== 'ii_kit_hugo_knife');
    for (const n of old.npcs) n.outfitted = true;
    expect(outfitNpcs(old, seed)).toBe(true);
    expect(old.npcs.every((n) => n.outfitted === OUTFIT_VERSION)).toBe(true);
    expect(old.item_instances.find((i) => i.id === 'ii_brenna_jarra')?.location).toEqual({ type: 'npc', id: 'npc_brenna' });
    expect(old.item_instances.some((i) => i.location.type === 'npc' && i.location.id === 'npc_hugo' && isWorn(i))).toBe(true);
    expect(old.item_instances.some((i) => i.id === 'ii_kit_hugo_knife')).toBe(false);
    const size = old.item_instances.length;
    expect(outfitNpcs(old, seed)).toBe(false);
    expect(old.item_instances).toHaveLength(size);
  });
});

describe('Brezal: lo que la historia nombra de cada vecino', () => {
  it('cada cosa encima de su dueño (o en la fragua), con lo puesto marcado', async () => {
    const engine = await boot();
    const on = (npc: string, item: string) => carried(engine, npc).find((i) => i.item_id === item);
    expect(on('npc_brenna', 'it_jarra_brenna')).toBeDefined();
    expect(isWorn(on('npc_ysolde', 'it_guante_ascua')!)).toBe(true);
    expect(on('npc_ursula', 'it_cuerda_ursula')).toBeDefined();
    expect(isWorn(on('npc_doro', 'it_botas_doro')!)).toBe(true);
    expect(isWorn(on('npc_osric', 'it_anillos_osric')!)).toBe(true);
    // Un solo anillo de sello: el de la historia, puesto; el ajuar no le mete otro en la bolsa.
    expect(carried(engine, 'npc_osric').filter((i) => i.item_id === 'it_kit_ring')).toHaveLength(1);
    expect(engine.world.itemInstance('ii_martillo_maestro').location).toEqual({ type: 'spot', id: 'sp_he_fragua' });
    expect(on('npc_hugo', 'it_martillo_maestro')).toBeUndefined();
  });

  it('todo NPC con estadísticas que es persona lleva ropa puesta', async () => {
    const engine = await boot();
    for (const n of engine.world.npcs.values()) {
      if (!n.stats || kitOf(n).empty) continue;
      expect(carried(engine, n.id).some(isWorn), n.id).toBe(true);
    }
  });
});

describe('mundos generados: un objeto propio por NPC', () => {
  it('el esquema de la gente sigue cabiendo', () => {
    expect(schemaChars(PART_SCHEMAS.people)).toBeLessThanOrEqual(MAX_PART_SCHEMA_CHARS);
  });

  it('se valida, se limpia y llega al mundo como objeto custom encima del NPC', () => {
    const sk = buildSkeleton({ seed: 7, tone: 'grim', setting: '' });
    const f = offlineFill(sk, [{ name: 'Ana' }]);
    const parts = splitFill(f);
    const person = sk.npcs.find((n) => n.role !== 'beast')!;
    const beast = sk.npcs.find((n) => n.role === 'beast');
    const people = normalizePeople(sk, {
      ...parts.people,
      npcs: parts.people.npcs.map((n) => n.id === person.id ? { ...n, item: 'un relicario de latón.', item_note: 'Cerrado con un pelo enredado en la bisagra.' }
        : beast && n.id === beast.id ? { ...n, item: 'hueso', item_note: 'x' } : n),
    });
    expect(validatePeople(sk, people)).toEqual([]);
    const mine = people.npcs.find((n) => n.id === person.id)!;
    expect(mine.item).toBe('relicario de latón');
    if (beast) expect(people.npcs.find((n) => n.id === beast.id)!.item).toBe('');
    expect(validatePeople(sk, { ...people, npcs: people.npcs.map((n) => n.id === person.id ? { ...n, item: 'x'.repeat(61) } : n) })[0]).toMatch(/item/);

    const gen = { seed: 7, tone: 'grim' as const, setting: '', model: 'offline', generated_at: new Date(EPOCH).toISOString(), attempts: 0, usage: { input: 0, output: 0 }, cost_usd: 0, skeleton_version: sk.version };
    const snap = buildSnapshot(sk, { ...f, npcs: people.npcs }, gen);
    expect(validateSnapshot(snap)).toEqual([]);
    const key = person.id.replace(/^npc_/, '');
    const def = snap.item_defs.find((d) => d.id === `it_own_${key}`)!;
    expect(def).toMatchObject({ name: 'relicario de latón', type: 'treasure', origin: 'custom', unique: true, description: 'Cerrado con un pelo enredado en la bisagra.' });
    expect(snap.item_instances.find((i) => i.id === `ii_own_${key}`)?.location).toEqual({ type: 'npc', id: person.id });
    // Un objeto con reglas no pasa por propio.
    snap.item_defs = snap.item_defs.map((d) => d.id === def.id ? { ...d, weapon: { damage: '1d4', damage_type: 'piercing' } } : d);
    expect(validateSnapshot(snap).join(' ')).toMatch(/objeto propio/);
  });

  it('un objeto sin valor por su nombre es misc; sin nombre, ninguno', () => {
    expect(ownItemOf('npc_x', 'carta arrugada', '', 150)?.def.type).toBe('misc');
    expect(ownItemOf('npc_x', '  ', 'nada', 150)).toBeNull();
  });

  it('offline no inventa objeto propio: el NPC lleva su ajuar', async () => {
    const seed = await generateSeed({ seed: 2024, tone: 'grim', setting: '', client: null, now: () => new Date(EPOCH), characters: [{ name: 'Ana' }] });
    expect(seed.item_defs.some((d) => d.id.startsWith('it_own_'))).toBe(false);
    const engine = await boot(seed);
    for (const n of engine.world.npcs.values()) if (n.stats && !kitOf(n).empty) expect(carried(engine, n.id).length, n.id).toBeGreaterThan(0);
  });
});

describe('wiki: «Lleva encima» sale de los datos', () => {
  it('la tabla de Garrán: la bolsa del diezmo con su dinero y la trenza son de la historia', () => {
    const md = carriesMarkdown(brezalOutfitted(), 'npc_garran')!;
    expect(md).toMatch(/\| bolsa de cuero \| al cinto \| 4 de oro y 3 de plata \| la historia \|/);
    expect(md).toMatch(/\| trenza de esparto \| en la bolsa \|.*\| la historia \|/);
    expect(md).toMatch(/\| silbato de hueso \| en la bolsa \| {2}\| el ajuar \|/);
    expect(carriesOf()('npc_nadie')).toBeNull();
  });

  it('sustituye la sección, o la añade antes de Relaciones', () => {
    const page = '# T\n\n## Lleva encima\n\nTexto viejo.\n\n## Relaciones\n\n- uno\n';
    expect(replaceSection(page, 'Lleva encima', 'NUEVO')).toBe('# T\n\n## Lleva encima\n\nNUEVO\n\n## Relaciones\n\n- uno\n');
    expect(replaceSection('# T\n\n## Relaciones\n\n- uno', 'Lleva encima', 'NUEVO')).toBe('# T\n\n## Lleva encima\n\nNUEVO\n\n## Relaciones\n\n- uno');
    expect(frontmatter('---\ntitle: Hugo\nnpc: npc_hugo\n---\nx').meta.npc).toBe('npc_hugo');
  });

  it('al construir, la ficha con npc: sale con lo que lleva; un npc que no existe rompe la construcción', async () => {
    const src = await mkdtemp(join(tmpdir(), 'tavernus-carries-src-'));
    const out = await mkdtemp(join(tmpdir(), 'tavernus-carries-out-'));
    try {
      await mkdir(join(src, 'Personajes'), { recursive: true });
      await writeFile(join(src, 'Personajes', 'Hugo.md'), '---\ntitle: Hugo\nnpc: npc_hugo\n---\n\n## Lleva encima\n\nA mano.\n', 'utf8');
      await buildWiki(src, out, { carries: (id) => (id === 'npc_hugo' ? '| Qué |\n|---|\n| mandil de cuero |' : null) });
      const html = await readFile(join(out, 'personajes', 'hugo.html'), 'utf8');
      expect(html).toContain('mandil de cuero');
      expect(html).not.toContain('A mano.');
      await writeFile(join(src, 'Personajes', 'Hugo.md'), '---\ntitle: Hugo\nnpc: npc_nadie\n---\n', 'utf8');
      await expect(buildWiki(src, out, { carries: () => null })).rejects.toThrow(/npc_nadie/);
    } finally {
      await rm(src, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
