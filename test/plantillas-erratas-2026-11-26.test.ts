/**
 * Arreglo 44 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete E): erratas de las plantillas del motor. «el sereno el
 * sereno» (impredecible T6), «el herrero el herrero» (pícaro T23), «el buhonero el buhonero» (pareja C35), «el guardia
 * el guardia» (deudor T19): el máster escribe «el sereno Anselmo» y, para quien no sabe su nombre, el motor tapaba el
 * nombre con el oficio y dejaba los dos. Un pase por las frases que arma el motor con cada NPC de Brezal, que no
 * repiten palabra. Sin IA.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { aEs, descriptorOf, maskUnknownNames, roleLabel } from '../src/engine/narrate.js';
import { npcLabel, npcTag } from '../src/engine/journal.js';
import { speakerLabel } from '../src/engine/chatter.js';
import { npcMoveLines } from '../src/engine/npcorders.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);

async function boot() {
  const time = fakeTime(EPOCH);
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed: authoredSeed('brezal', { now: new Date(EPOCH) }), now: time.now, deterministic: true, fastTravel: false });
  const r = await engine.createCharacter('u_zoe', 'Zoe', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  r.character.knows = [];
  return { engine, w: engine.world, zoe: r.character };
}

/** La primera palabra o pareja de palabras que sale dos veces seguidas, o null. */
function repeated(text: string): string | null {
  const t = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i + 1 < t.length; i++) if (t[i] === t[i + 1]) return t[i]!;
  for (let i = 0; i + 3 < t.length; i++) if (t[i] === t[i + 2] && t[i + 1] === t[i + 3]) return `${t[i]} ${t[i + 1]}`;
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

describe('arreglo 44: erratas de las plantillas', () => {
  it('las frases reales de los transcripts, para quien no sabe los nombres', async () => {
    const { w, zoe } = await boot();
    const mask = (t: string) => maskUnknownNames(w, zoe.id, t);
    expect(mask('Osric Malvez te mira de reojo, con la sonrisa cerrada, y el sereno Anselmo ajusta el farol sin decir palabra.'))
      .toBe('El regidor te mira de reojo, con la sonrisa cerrada, y el sereno ajusta el farol sin decir palabra.');
    expect(mask('Junto a ti están Brenna, que sigue secando su jarra, y el herrero Hugo, que mira la daga y no la toca.'))
      .toBe('Junto a ti están la tabernera, que sigue secando su jarra, y el herrero, que mira la daga y no la toca.');
    expect(mask('El arcón tiene dueño, el buhonero Lucio Cendal, y el candado solo se abre con su llave.'))
      .toBe('El arcón tiene dueño, el buhonero, y el candado solo se abre con su llave.');
    expect(mask('Te acercas a la barra, donde el guardia Doro se ríe de algo a medias.'))
      .toBe('Te acercas a la barra, donde el guardia se ríe de algo a medias.');
    // Con la contracción y con el nombre delante.
    expect(mask('Te acercas al herrero Hugo.')).toBe('Te acercas al herrero.');
    expect(mask('Hugo el herrero no levanta la vista.')).toBe('El herrero no levanta la vista.');
    // Quien sabe el nombre lo lee tal cual.
    zoe.knows = ['npc_x_anselmo'];
    expect(mask('Y el sereno Anselmo ajusta el farol.')).toBe('Y el sereno Anselmo ajusta el farol.');
  });

  it('cada NPC de Brezal: lo que escribe el máster con oficio y nombre, y las plantillas del motor, sin palabras repetidas', async () => {
    const { w, zoe } = await boot();
    const spots = [...w.spots.values()];
    const bad: string[] = [];
    for (const n of w.npcs.values()) {
      zoe.knows = [];
      const role = roleLabel(n);
      const texts = [
        // Lo que escribe el máster, tapado para quien no sabe el nombre.
        ...[`${cap(role)} ${n.name} se ríe.`, `Junto a ti está ${role} ${n.name}, callado.`, `Te acercas ${aEs(role)} ${n.name}.`,
          `${n.name}, ${role}, se ríe.`, `${n.name} ${role} se ríe.`, `Hablas con ${n.name}, ${roleLabel(n, true)}.`].map((t) => maskUnknownNames(w, zoe.id, t)),
        // Plantillas del motor: quién habla al pasar, el Diario, el que entra y sale.
        `${speakerLabel(w, n.id, zoe.id)}, al pasar: «La niebla no levanta.»`,
        `Te lo pide ${npcLabel(zoe, n)}.`, `Conversación con ${npcTag(zoe, n)}.`, `Combate con ${npcLabel(zoe, n)}: le alcanzas.`,
        `${cap(descriptorOf(w, n.id))} no está aquí.`,
      ];
      const from = w.spot(n.location.id);
      const to = spots.find((s) => s.location_id !== from.location_id)!;
      const lines = npcMoveLines(n, from, to, w.location(to.location_id).name, { goal: 'camino de la misa del pozo' });
      texts.push(lines.leave, lines.arrive, lines.within);
      for (const t of texts) {
        const r = repeated(t);
        if (r) bad.push(`${n.id}: «${t}» repite «${r}»`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('las salvaciones contra muerte, sin «·»: «(éxitos 1/3, fallos 0/3)»', async () => {
    const { engine, zoe } = await boot();
    zoe.hp_current = 0;
    zoe.dying = { success: 1, fail: 0, since_game_s: 0, next_game_s: 0, stable_until_game_s: null } as typeof zoe.dying;
    const text = engine.downText(zoe);
    expect(text).toContain('(éxitos 1/3, fallos 0/3)');
    expect(text).not.toContain('·');
  });
});
