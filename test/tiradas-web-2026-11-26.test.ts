/**
 * Arreglo 36, parte de la web (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete H; patrones 6 y 12 de
 * docs/ANALISIS-PARTIDAS-2026-11-26.md): las líneas «🎲 Percepción» sin dado ni resultado dicen que son ocultas, las
 * demás llevan el número, y en la web no queda «·» como separador («🎲 Bruno · Persuasión», «éxitos 1/3 · fallos 0/3»).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { noticeOf, rollNoticeText } from '../src/adapters/web/notice.js';
import { toMessage } from '../src/adapters/web/server.js';
import type { Delivery } from '../src/engine/events.js';
import { checkRoll, hiddenCheckRoll, rollTextForOthers, rollTextForRoller } from '../src/engine/rolls.js';
import { bootEngine } from './helpers.js';

describe('arreglo 36: tiradas con dado y resultado, o que dicen que son ocultas', () => {
  it('la oculta lo dice; la abierta lleva el dado y el resultado; quien mira lee quién tira, sin «·»', async () => {
    const { engine } = await bootEngine();
    const hidden = hiddenCheckRoll('ch_kael', { label: 'percepción', total: 14, breakdown: 'd20 [12] + 2 = 14', success: null, natural: undefined } as never);
    expect(rollTextForRoller(hidden)).toBe('🎲 Percepción (tirada oculta)');
    const open = checkRoll('ch_kael', { label: 'persuasión', total: 5, breakdown: 'd20 [2] + 3 = 5', success: false } as never);
    expect(rollTextForRoller(open)).toBe('🎲 Persuasión: d20 [2] + 3 = 5 → fallo');
    expect(rollTextForOthers(engine.world, open)).toBe('🎲 Kael tira persuasión: d20 [2] + 3 = 5 → fallo');
    // La salvación contra muerte con su cuenta (la coletilla de engine.ts trae «·»): sin él.
    const save = { ...checkRoll('ch_kael', { label: 'salvación contra muerte', total: 12, breakdown: 'd20 [12] + 0 = 12', success: true } as never), note: 'éxitos 1/3 · fallos 0/3' };
    expect(rollTextForRoller(save)).toBe('🎲 Salvación contra muerte: d20 [12] + 0 = 12 → éxito; éxitos 1/3, fallos 0/3');
    expect(rollTextForOthers(engine.world, save)).not.toContain('·');
  });

  it('lo del historial escrito antes se lee como lo nuevo', () => {
    expect(rollNoticeText('🎲 Bruno · Persuasión: d20 [18] + 3 = 21 → éxito', {})).toBe('🎲 Bruno tira persuasión: d20 [18] + 3 = 21 → éxito');
    expect(rollNoticeText('🎲 Salvación contra muerte: d20 [12] + 0 = 12 → éxito · éxitos 1/3 · fallos 0/3', {})).toBe('🎲 Salvación contra muerte: d20 [12] + 0 = 12 → éxito; éxitos 1/3, fallos 0/3');
    expect(rollNoticeText('🎲 Percepción', { hidden: true })).toBe('🎲 Percepción (tirada oculta)');
    expect(rollNoticeText('🎲 Percepción (tirada oculta)', { hidden: true })).toBe('🎲 Percepción (tirada oculta)');
  });

  it('la web pinta la tirada oculta como aviso que dice que es oculta, también la de antes', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const e = engine.events.emit({ actor_id: kael.id, action_type: 'roll', narration_private: '🎲 Percepción', observable: null, visibility: 'private', tags: ['roll'], payload: { master: null, shown_roll: { roller_id: kael.id, hidden: true, label: 'Percepción', dice: '', total: 14, outcome: null } } });
    const d: Delivery = { event: e, character_id: kael.id, level: 'full', text: '🎲 Percepción' };
    const m = toMessage(d, engine);
    expect(m.notice?.text ?? m.text).toBe('🎲 Percepción (tirada oculta)');
  });

  it('los avisos de misión, sin «·»', () => {
    const quest = { id: 'q1', title: 'El perro de Brenna', event: 'open', why: 'te lo pide Brenna' };
    expect(noticeOf({ action_type: 'progress_story', narration_private: '', observable: null, payload: { quest } })?.text).toBe('Nueva misión: «El perro de Brenna»');
    expect(noticeOf({ action_type: 'progress_story', narration_private: '', observable: null, payload: { quest: { ...quest, event: 'step', step: 'Encontrar el rastro' } } })?.text).toBe('Paso cumplido: Encontrar el rastro («El perro de Brenna»)');
  });

  it('ningún texto de la web separa con «·» ni «•» (solo se parte por él lo que llega así del motor)', () => {
    const dir = path.join(__dirname, '../src/adapters/web');
    const bad: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        // Partir lo que manda el motor (la hoja), y los que lo limpian.
        const rest = code.replace(/(?:split|indexOf)\(' · '\)/g, '').replace(/\.replace\(\/(?:[^/\\]|\\.)+\/[gimsuy]*/g, '').replace(/\/\/.*$/, '');
        if (/[·•]/.test(rest)) bad.push(`${f}:${i + 1}: ${code.slice(0, 120)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
