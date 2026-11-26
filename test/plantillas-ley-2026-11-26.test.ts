/**
 * Arreglo 44, parte de crime.ts (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete G): «El guardia viene a ayudar a detener a
 * ti» (rompejuegos T33). La orden de la autoridad que acude se leía en segunda persona con «a ti» tras el infinitivo.
 * Y un pase por las plantillas de crime.ts, laws.ts y reactions.ts: se construyen para cada NPC de Brezal y dos PJ, en
 * tercera persona y en segunda (para el autor), y ninguna repite palabra, deja «a el» o «de el», pone «a ti» tras un
 * infinitivo o usa «·» o «•» para separar.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import {
  allIncidents, arrestCharge, crimeContext, deedText, enforcerIds, incidentRejection, incidentText, npcCrimeLine, reactionSentences, refusesService,
  reportIncident, resist, sentencePreview, type AssaultDeed, type Incident, type IncidentKind,
} from '../src/engine/crime.js';
import { DEFAULT_LAWS, worldLaws } from '../src/engine/laws.js';
import { attemptText, reactionExplain } from '../src/engine/reactions.js';
import { orderOf, setNpcOrder } from '../src/engine/npcorders.js';
import { secondPerson } from '../src/engine/party.js';
import { maskUnknownNames } from '../src/engine/narrate.js';
import type { Character, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Lo que una plantilla no puede dejar: palabra repetida, contracción sin hacer, «a ti» tras infinitivo, separadores. */
function flaws(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(/«[^»]*»/g, ' ');
  const rep = /(?<![\p{L}])(\p{L}+) \1(?![\p{L}])/iu.exec(t);
  if (rep && !['que', 'muy'].includes(rep[1]!.toLowerCase())) out.push(`repite «${rep[0]}»`);
  if (/(?<![\p{L}])(a|de) el(?![\p{L}])/u.test(t)) out.push('«a el» o «de el»');
  if (/\p{L}+(?:ar|er|ir) a ti\b/u.test(t)) out.push('«a ti» tras un infinitivo');
  if (/\ble te\b/.test(t)) out.push('«le te»');
  if (/[·•]/.test(text)) out.push('separador «·» o «•»');
  if (/\b(undefined|null|NaN)\b/.test(text)) out.push('un hueco sin rellenar');
  return out;
}

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.5 });
  const pcs: Character[] = [];
  for (const [name, cls] of [['Lope', 'wizard'], ['Ciro', 'rogue']] as const) {
    const r = await engine.createCharacter(`u_${name.toLowerCase()}`, name, { class_id: cls });
    if (!r.ok) throw new Error(r.reason);
    pcs.push(engine.world.character(r.character.id));
  }
  return { engine, time, pcs };
}

const KINDS: { kind: IncidentKind; deed?: AssaultDeed; weapon?: string }[] = [
  { kind: 'insult' }, { kind: 'theft_attempt' }, { kind: 'theft' }, { kind: 'assault' },
  { kind: 'assault', deed: 'grab' }, { kind: 'assault', deed: 'shove' }, { kind: 'assault', deed: 'touch' }, { kind: 'assault', deed: 'threat', weapon: 'gran hacha' },
  { kind: 'armed_assault', weapon: 'bastón' }, { kind: 'desecration' }, { kind: 'murder' },
];

describe('(44) «viene a ayudar a detener a ti»', () => {
  it('rompejuegos T33: la autoridad que acude se lee bien en segunda persona y en tercera', async () => {
    const { engine, pcs } = await boot();
    const w = engine.world;
    const lope = pcs[0]!;
    const [garran, doro] = ['npc_garran', 'npc_doro'].map((id) => w.npc(id)) as [Npc, Npc];
    garran.location = { type: 'spot', id: 'sp_pl_porton' };
    expect(setNpcOrder(w, { npc_id: garran.id, order: 'go', spot_id: 'sp_pl_porton', minutes: 600 }, engine.gameNow()).ok).toBe(true);
    doro.location = { type: 'spot', id: 'sp_ca_puerta' };
    lope.location = { type: 'spot', id: 'sp_pl_porton' };
    const now = engine.gameNow();
    reportIncident(w, { kind: 'theft', perpetrator_id: lope.id, victim_id: 'npc_x_anselmo', spot_id: 'sp_pl_porton' }, now);
    for (const i of allIncidents(w)) i.narrated_to.push(lope.id);
    await engine.tick();
    expect(lope.wanted?.arrest?.npc_id).toBe(garran.id);
    resist(w, lope, engine.gameNow());
    const task = orderOf(doro)?.task?.text;
    expect(task).toBeTruthy();
    const third = `El guardia ${task}.`;
    const you = secondPerson(third, lope.name);
    expect(you).toBe('El guardia viene a por ti, a ayudar en la detención.');
    expect(third).toBe('El guardia viene a por Lope, a ayudar en la detención.');
    expect(flaws(you)).toEqual([]);
  });
});

describe('(44) las plantillas de crime.ts, para cada NPC de Brezal y dos PJ', () => {
  it('incidentes de cada tipo: aviso, reacciones, memoria, cargo, contexto y rechazo, sin erratas', async () => {
    const { engine, pcs } = await boot();
    const w = engine.world;
    const npcs = [...w.npcs.values()].filter((n) => n.status === 'alive' && !n.mute);
    expect(npcs.length).toBeGreaterThan(10);
    const bad: string[] = [];
    const check = (where: string, text: string | null | undefined) => {
      if (!text) return;
      for (const f of flaws(text)) bad.push(`${where}: ${f}: ${text}`);
    };
    let now = engine.gameNow();
    let made = 0;
    for (const pc of pcs) {
      for (const victim of npcs) {
        for (const k of KINDS) {
          // Cada caso con su propio incidente: el autor y la víctima, en el sitio de la víctima.
          now += 7200;
          const spot = w.spot(victim.location.id);
          pc.location = { type: 'spot', id: spot.id };
          const i = reportIncident(w, { kind: k.kind, perpetrator_id: pc.id, victim_id: victim.id, spot_id: spot.id, weapon: k.weapon ?? null, deed: k.deed ?? null }, now) as Incident | null;
          if (!i) continue;
          made++;
          const tag = `${pc.name}/${victim.id}/${k.kind}${k.deed ? `/${k.deed}` : ''}`;
          check(`${tag} deedText`, deedText(i));
          check(`${tag} aviso (autor)`, incidentText(w, i, true));
          check(`${tag} aviso (sala)`, incidentText(w, i, false));
          check(`${tag} aviso (autor, enmascarado)`, maskUnknownNames(w, pc.id, incidentText(w, i, true)));
          for (const s of reactionSentences(w, i, true, pc)) check(`${tag} reacción (autor)`, s);
          for (const s of reactionSentences(w, i, false)) check(`${tag} reacción (sala)`, s);
          check(`${tag} rechazo`, incidentRejection(w, i, [victim.name], pc));
          for (const kn of i.knowers) {
            const n = w.npcs.get(kn.npc_id)!;
            check(`${tag} LO PRIMERO de ${n.id}`, npcCrimeLine(w, n, pc, now));
            for (const m of n.memory.filter((x) => x.character_id === pc.id)) check(`${tag} memoria de ${n.id}`, m.note);
            check(`${tag} no le sirve ${n.id}`, refusesService(w, n, pc));
          }
          const ch = arrestCharge(w, pc, null);
          check(`${tag} cargo`, ch?.charge);
          check(`${tag} cargo de antes`, ch?.before);
          check(`${tag} contexto`, crimeContext(w, pc, now));
          check(`${tag} pena`, sentencePreview(w, pc));
          check(`${tag} buscado`, pc.wanted?.reason);
          // Que el siguiente caso empiece limpio.
          i.status = 'settled';
          pc.wanted = null;
          pc.conditions = pc.conditions.filter((x) => x.name !== 'buscado');
        }
      }
    }
    expect(made).toBeGreaterThan(200);
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('la orden de cada autoridad que acude, y la de quien corre a avisar, en segunda y tercera persona', async () => {
    const { engine, pcs } = await boot();
    const w = engine.world;
    for (const pc of pcs) {
      for (const id of enforcerIds(w)) {
        const n = w.npc(id);
        for (const text of [`viene a por ${pc.name}, a ayudar en la detención`, `le cuenta a ${n.name} lo que pasó con ${pc.name}`]) {
          const third = `${n.name} ${text}.`;
          expect(flaws(third), third).toEqual([]);
          expect(flaws(secondPerson(third, pc.name)), secondPerson(third, pc.name)).toEqual([]);
        }
      }
    }
  });
});

describe('(44) las plantillas de laws.ts y reactions.ts', () => {
  it('las leyes del mundo, sin separadores ni huecos', async () => {
    const { engine } = await boot();
    for (const l of [...DEFAULT_LAWS, ...worldLaws(engine.world.campaign)]) expect(flaws(l), l).toEqual([]);
  });

  it('lo que intenta un PJ sobre otro y lo que pasa con cada botón, para cada sitio de Brezal', async () => {
    const { engine } = await boot();
    const w = engine.world;
    for (const kind of ['attack', 'grapple', 'shove', 'other'] as const) {
      for (const prone of [false, true]) {
        check(attemptText(w, kind, null, prone));
        check(reactionExplain({ kind, contest: null, dest_spot_id: null, prone } as Parameters<typeof reactionExplain>[0]));
      }
    }
    for (const spot of w.spots.values()) {
      check(attemptText(w, 'grapple', spot.id));
      check(reactionExplain({ kind: 'grapple', contest: null, dest_spot_id: spot.id, prone: false } as Parameters<typeof reactionExplain>[0]));
    }
    function check(text: string) { expect(flaws(text), text).toEqual([]); }
  });
});
