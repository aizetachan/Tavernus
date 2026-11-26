/**
 * Arreglo 38, parte del motor (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete E): la reaparición se lee. El violento
 * moría en la herrería y salía en el molino a 7/14 sin transición (T4 y T5) y el recolector volvía «al turno siguiente»
 * de un aviso que decía «dentro de 2 h reales» (T11): el aviso de la muerte dice dónde (punto y lugar) y a qué hora
 * vuelve, el muerto no actúa hasta entonces, y la vuelta llega como narración con dónde, a qué hora, cuánto ha pasado
 * y con qué PG. Lo de la salvación y el 1 PG es del paquete G. Sin IA.
 */

import { describe, expect, it } from 'vitest';
import { damageCharacter } from '../src/engine/death.js';
import { hhmm } from '../src/engine/schedule.js';
import type { Delivery, Engine } from '../src/engine/engine.js';
import { bootEngine, fakeTime } from './helpers.js';

function collect(engine: Engine) {
  const by = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { by.set(d.character_id, [...(by.get(d.character_id) ?? []), d]); });
  return (id: string) => (by.get(id) ?? []).map((d) => d.text);
}

async function deadKael() {
  const time = fakeTime();
  const { engine } = await bootEngine(time);
  const kael = engine.world.character('ch_kael');
  engine.setPresence(kael.id, true);
  const seen = collect(engine);
  // Daño masivo: muerte en el acto (como el violento bajo el martillo de Hugo).
  damageCharacter(engine.world, kael, kael.hp_current + kael.hp_max, { cause: 'el martillo de fragua', nowGameS: engine.nowFor(kael) });
  await engine.tick();
  return { engine, time, kael, seen };
}

describe('arreglo 38: la reaparición se lee', () => {
  it('el aviso de la muerte dice dónde vuelve (punto y lugar) y a qué hora, y que hasta entonces no actúa', async () => {
    const { engine, kael, seen } = await deadKael();
    expect(kael.status).toBe('dead');
    const back = hhmm(engine.clock.gameNow(kael.death!.respawn_real_ms));
    const death = seen(kael.id).find((t) => t.startsWith('☠ Todo se apaga.'))!;
    expect(death).toMatch(new RegExp(`volverás en la puerta, en Taberna del Jabalí dentro de 2 h reales \\(6 h de juego, hacia las ${back}\\)\\. Hasta entonces no puedes actuar\\.`));
  });

  it('muerto no actúa ni habla hasta su hora; un minuto después sigue muerto (recolector T11)', async () => {
    const { engine, time, kael } = await deadKael();
    const r = await engine.act(kael.id, 'Me incorporo y agarro al molinero por el brazo');
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/^☠ Has muerto\. Volverás en la puerta, en Taberna del Jabalí dentro de .+ hacia las \d+:\d\d\)\. Hasta entonces no puedes actuar/);
    expect((await engine.say(kael.id, '¿Quién me ha dejado en el suelo?')).ok).toBe(false);
    time.advanceReal(60);
    await engine.tick();
    expect(kael.status).toBe('dead');
    expect((await engine.act(kael.id, 'Lanzo Curar heridas')).ok).toBe(false);
  });

  it('la vuelta llega como narración: dónde, a qué hora, cuánto ha pasado y con qué PG; y el evento lo lleva', async () => {
    const { engine, time, kael, seen } = await deadKael();
    const from = engine.events.all().at(-1)?.seq ?? 0;
    time.advanceReal(2 * 3600 + 1);
    await engine.tick();
    expect(kael.status).toBe('active');
    const ev = engine.events.all().find((e) => e.seq > from && e.action_type === 'respawn' && e.actor_id === kael.id)!;
    expect(ev).toBeDefined();
    const at = hhmm(engine.nowFor(kael));
    expect(ev.narration_private).toMatch(new RegExp(`^↺ .+ Abres los ojos en la puerta \\(Taberna del Jabalí\\) hacia las ${at}, 6 h después de caer, con ${kael.hp_current}/${kael.hp_max} PG\\.`));
    expect(seen(kael.id)).toContain(ev.narration_private);
    expect(ev.payload['respawn']).toMatchObject({ spot_id: 'sp_tab_puerta', location_id: 'loc_taberna', hp: kael.hp_current });
    expect((ev.payload['respawn'] as { away_game_s: number }).away_game_s).toBeCloseTo(6 * 3600, -1);
    expect((ev.payload['respawn'] as { game_s: number }).game_s).toBe(engine.nowFor(kael));
    // Ya puede actuar.
    expect((await engine.act(kael.id, 'miro alrededor')).ok).toBe(true);
  });
});
