import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadRules, searchRules, stem, normalize } from '../src/rules/index.js';
import { executeTool, resetRulesIndex, type ToolContext } from '../src/ai/tools.js';
import { systemPrompt } from '../src/ai/prompt.js';
import { RULES_CHEATSHEET } from '../src/ai/rules-cheatsheet.js';
import { World } from '../src/engine/world.js';
import { makeSeed } from '../src/data/seed/demo.js';
import { makeVocab, repairWords } from '../scripts/ingest-rules.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'rules');

describe('índice de reglas', () => {
  it('devuelve primero el fragmento relevante', () => {
    const idx = loadRules(FIXTURE);
    expect(idx.chunks).toHaveLength(3);
    const hits = searchRules('grappling', {}, idx);
    expect(hits[0]?.id).toBe('phb-0001');
    expect(hits[0]).toMatchObject({ book: 'phb', title: 'Making an Attack', page: 179 });
    // Recortado alrededor del término, no el fragmento entero.
    expect(hits[0]!.text.length).toBeLessThanOrEqual(602);
    expect(hits[0]!.text).toMatch(/grapple/i);

    const rest = searchRules('long rest', {}, idx);
    expect(rest[0]?.id).toBe('phb-0002');
    expect(rest.map((h) => h.id)).not.toContain('phb-0001');
  });

  it('el stemming une variantes en inglés y español', () => {
    expect(stem('grappling')).toBe(stem('grapple'));
    expect(stem('grappled')).toBe(stem('grapples'));
    expect(stem('rests')).toBe(stem('rest'));
    expect(stem(normalize('acciones'))).toBe(stem(normalize('acción')));
    expect(searchRules('grapples', {}, loadRules(FIXTURE))[0]?.id).toBe('phb-0001');
  });

  it('filtra por libro', () => {
    const idx = loadRules(FIXTURE);
    const hits = searchRules('long rest', { book: 'dmg' }, idx);
    expect(hits.map((h) => h.id)).toEqual(['dmg-0001']);
    expect(searchRules('grappling', { book: 'dmg' }, idx)).toEqual([]);
  });

  it('tolera acentos y mayúsculas', () => {
    const idx = loadRules(FIXTURE);
    expect(searchRules('CURACIÓN', {}, idx)[0]?.id).toBe('dmg-0001');
    expect(searchRules('curacion lenta', {}, idx)[0]?.id).toBe('dmg-0001');
    expect(searchRules('grápplíng', {}, idx)[0]?.id).toBe('phb-0001');
  });

  it('sin directorio carga vacío y no falla', () => {
    const idx = loadRules(join(FIXTURE, 'no-existe'));
    expect(idx.chunks).toEqual([]);
    expect(searchRules('grappling', {}, idx)).toEqual([]);
  });
});

describe('tool lookup_rule', () => {
  const ctx = { engine: { world: {} } } as unknown as ToolContext;
  const prev = process.env['RULES_DIR'];
  afterEach(() => {
    if (prev === undefined) delete process.env['RULES_DIR'];
    else process.env['RULES_DIR'] = prev;
    resetRulesIndex();
  });

  it('sin índice responde con un texto breve, no con un error', () => {
    process.env['RULES_DIR'] = join(FIXTURE, 'no-existe');
    resetRulesIndex();
    const out = executeTool(ctx, 'lookup_rule', { query: 'grappling', book: null });
    expect(out).toMatch(/No hay manuales indexados/);
    expect(out).not.toMatch(/error/i);
  });

  it('con índice devuelve hasta 3 fragmentos con libro, página y título', () => {
    process.env['RULES_DIR'] = FIXTURE;
    resetRulesIndex();
    const out = executeTool(ctx, 'lookup_rule', { query: 'long rest', book: null });
    expect(out.startsWith("[Player's Handbook, p. 171 — Resting]")).toBe(true);
    expect(out.match(/^\[/gm)?.length).toBeLessThanOrEqual(3);
    const dmg = executeTool(ctx, 'lookup_rule', { query: 'long rest', book: 'dmg' });
    expect(dmg).toMatch(/^\[Dungeon Master's Guide, p\. 266/);
    expect(dmg).not.toMatch(/Player's Handbook/);
    expect(executeTool(ctx, 'lookup_rule', { query: 'dragon breath', book: null })).toMatch(/Sin resultados/);
  });
});

describe('chuleta de reglas en el prompt', () => {
  it('va en el bloque de sistema cacheado y remite a lookup_rule para lo demás', () => {
    const sp = systemPrompt(new World(makeSeed()).campaign);
    expect(sp).toContain(RULES_CHEATSHEET);
    expect(RULES_CHEATSHEET).toMatch(/lookup_rule/);
    expect(RULES_CHEATSHEET).toMatch(/agarrado/);
    // Tope de tamaño: unos 1.500 tokens en castellano.
    expect(RULES_CHEATSHEET.length).toBeLessThan(3200);
  });
});

describe('reparación del OCR en la ingesta', () => {
  const dict = ['of', 'the', 'your', 'melee', 'attack', 'making', 'worlds', 'many', 'long', 'rest', 'along', 'chapter', 'with', 'in', 'any', 'one', 'anyone', 'within', 'example', 'exam', 'together', 'get', 'her', 'to'];
  const counts = new Map(Object.entries({ of: 500, the: 900, a: 800, your: 200, melee: 60, attack: 150, making: 30, worlds: 20, many: 40, long: 80, rest: 70, along: 15, chapter: 40, with: 300, in: 400, any: 50, one: 90, anyone: 10, within: 20, example: 40, exam: 5, together: 10, get: 30, her: 30, to: 600 }));
  const v = makeVocab(dict, counts);

  it('une trozos, separa pegotes y mueve espacios mal puestos', () => {
    expect(repairWords('o f the w orlds. M any', v)).toBe('of the worlds. Many');
    expect(repairWords('making am elee attack ofyour', v)).toBe('making a melee attack of your');
    expect(repairWords('for exam ple,', v)).toBe('for example,');
    expect(repairWords('C h a p t e r 10:', v)).toBe('Chapter 10:');
  });

  it('no junta palabras reales que van separadas', () => {
    expect(repairWords('a long rest with in reach, any one', v)).toBe('a long rest with in reach, any one');
    expect(repairWords('to get her', v)).toBe('to get her');
  });

  it('deja intactos números y dados', () => {
    expect(repairWords('roll a d20 and 1d6 at 5th level', v)).toBe('roll a d20 and 1d6 at 5th level');
  });
});
