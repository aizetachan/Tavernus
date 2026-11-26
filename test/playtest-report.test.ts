import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine/model.js';
import type { GameSummary } from '../scripts/autoplay.js';
import { buildWindowSection, declaresStrike, windowMetrics } from '../scripts/playtest-report.js';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'playtest', name), 'utf8')) as T;

describe('golpes declarados (H2 y H6)', () => {
  it('cuenta los golpes de verdad, también los que no usan «ataco»', () => {
    for (const t of [
      'Atacar a Hugo con el hacha',
      'Le hundo el puño en las costillas al molinero y, cuando se doble, le arranco la camisa.',
      'Ciro sacude al molinero contra los sacos y le planta la frente en la cara: ¡Mentira!',
      'Con el costado ardiendo, me revuelvo y le clavo el hombro en el pecho para tirarle contra el crisol.',
      'Antes de que Hugo lo toque, le pego un empujón contra la pared y le meto el mango en el pecho.',
      'Disparo a la diana con mi arco.',
      'Apuñalo al guardia por la espalda.',
    ]) expect(declaresStrike(t), t).toBe(true);
  });

  it('no cuenta amenazas, condicionales ni lo figurado', () => {
    for (const t of [
      'Hugo, suelta ese martillo o te parto el otro hombro y busco yo lo que guardas en esa fragua.',
      '¡Un paso más y te parto el yelmo, perro del regidor!',
      'Me incorporo de golpe entre los sacos. Si ese cabrón me ha vendido, le parto la cabeza.',
      'Agarro a Hugo por la pechera y lo arrastro hacia la puerta. Quiero ver quién hay ahí fuera, y si es el alguacil, le parto la cara.',
      'Suelto la camisa, pero le agarro del brazo y le clavo el hacha imaginaria en la mirada.',
      'Ciro aprieta más el brazo del molinero, le clava la mirada y le escupe.',
      'Garrán, si el jueves no hay plata, la próxima vez que te vea te parto las rodillas contra el banco.',
      'Le miro como si fuera a pegarle.',
      'Le digo que hable o lo lamentará.',
    ]) expect(declaresStrike(t), t).toBe(false);
  });

  it('en el violento de la tanda 20261125-1051: golpes con tirada de ataque y maniobras, no amenazas', () => {
    const f = fixture<{ game: GameSummary; events: GameEvent[] }>('violento-20261125-1051.json');
    const m = windowMetrics(f.game, f.events, 40);
    // A mano: golpes en las acciones 2, 6, 7, 17, 24 (se lanza sobre él), 29 y 32. Con tirada de ataque, 6 y 29; con
    // conflict_act (empujón o agarre), 2, 7 y 24; 17 sin nada y 32 resuelto como robo. Antes la columna decía «0 de 14».
    expect(m.attack_verbs).toBe(7);
    expect(m.attack_verbs_rolled).toBe(2);
    expect(m.attack_verbs_maneuver).toBe(3);
    // Los `attack` de Hugo son del NPC; ninguno es del PJ.
    expect(m.npc_attacks).toBeGreaterThan(0);
    const md = buildWindowSection(40, [m]);
    expect(md).toContain('| Golpes con tirada de ataque |');
    expect(md).toContain('2 de 7 (+3 maniobra)');
  });

  it('un `attack` con el PJ de atacante cuenta como golpe con tirada aunque no haya evento de tirada', () => {
    const ev = (seq: number, payload: Record<string, unknown>) => ({ id: `e${seq}`, seq, actor_id: 'pc', action_type: 'master', input_text: 'x', narration_private: '', tags: [], payload }) as unknown as GameEvent;
    const events = [ev(1, { master: { calls: [{ name: 'attack', input: { attacker_id: 'pc', target_id: 'npc_hugo' }, result: '{"ok":true}' }] } })];
    const g = { n: 1, profile: 'violento', character: { id: 'pc' }, actions: [{ i: 1, text: 'Le estampo el puño en la cara.', event_ids: ['e1'] }] } as unknown as GameSummary;
    expect(windowMetrics(g, events, 10)).toMatchObject({ attack_verbs: 1, attack_verbs_rolled: 1, npc_attacks: 0 });
  });
});
