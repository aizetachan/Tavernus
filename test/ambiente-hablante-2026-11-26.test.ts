/**
 * Arreglo 32 (docs/PLAN-ARREGLOS-2-2026-11-26.md, paquete E): las frases de ambiente las dice quien toca.
 * Casos de las tandas 4 y 5 (data/local/autoplay/20261126-0602/transcripts/deudor.md, T1, T19, T20 y T33):
 *   «El regidor, al pasar: «Si Garrán viene a cobrar otra vez, yo no tengo ni para pan.»»
 *   «La tabernera, al pasar: «Otra jarra, Brenna, que mañana será peor.»»
 *   «La guardia, al pasar: «El agua del pozo sabe a ceniza, te lo digo yo.»» (Doro)
 * Sin IA: la campaña de Brezal en memoria y `tickChatter` a mano.
 */

import { describe, expect, it } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { CHATTER } from '../src/data/campaigns/brezal/reactions.js';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { addChatter, CHATTER_GAP_S, LISTENER_GAP_S, speakerLabel, tickChatter, type ChatterLine } from '../src/engine/chatter.js';
import { nameRe, npcNameForms, roleLabel } from '../src/engine/narrate.js';
import { GAME_DAY, GAME_HOUR } from '../src/clock/clock.js';
import type { Character, Npc } from '../src/engine/model.js';
import type { World } from '../src/engine/world.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const STEP = Math.max(CHATTER_GAP_S, LISTENER_GAP_S) + 60;

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: true, fastTravel: false, rng: () => 0.99 });
  const r = await engine.createCharacter('u_mira', 'Mira', { class_id: 'wizard' });
  if (!r.ok) throw new Error(r.reason);
  r.character.connected = true;
  return { engine, w: engine.world, mira: r.character };
}

function put(spotId: string, ...who: (Character | Npc)[]): void {
  for (const x of who) { x.location = { type: 'spot', id: spotId }; delete (x as Npc & { order?: unknown }).order; }
}

/** Todos los NPC fuera de la aldea (en la cueva), salvo los dados, que quedan en `spotId`. */
function onlyThese(w: World, spotId: string, ids: string[]): void {
  for (const n of w.npcs.values()) put(ids.includes(n.id) ? spotId : 'sp_cs_cueva', n);
}

/** Un día y una hora de juego que no sean de mercado ni misa (sin gente sin cara). */
const at = (day: number, hour: number) => day * GAME_DAY + hour * GAME_HOUR;

function run(w: World, from: number, n: number): ChatterLine[] {
  const out: ChatterLine[] = [];
  for (let i = 0; i < n; i++) out.push(...tickChatter(w, from + i * STEP));
  return out;
}

function named(w: World, text: string): string[] {
  return [...w.npcs.values()].filter((n) => npcNameForms(n.name).some((f) => nameRe(f, 'u').test(text))).map((n) => n.id);
}

describe('arreglo 32: frases de ambiente con hablante', () => {
  it('«Otra jarra, Brenna» no la dice Brenna: con ella sola en la barra, la dice otro o nadie (deudor T19)', async () => {
    const { w, mira } = await boot();
    onlyThese(w, 'sp_tab_barra', ['npc_brenna']);
    put('sp_tab_barra', mira);
    const lines = run(w, at(3, 18), 12);
    const jarra = lines.filter((l) => l.text.includes('Otra jarra, Brenna'));
    for (const l of jarra) expect(l.npc_id).not.toBe('npc_brenna');
    // Lo que sí dice Brenna no la nombra.
    for (const l of lines.filter((x) => x.npc_id === 'npc_brenna')) expect(named(w, l.text)).not.toContain('npc_brenna');
  });

  it('con un parroquiano en la barra, «Otra jarra, Brenna» sale en su boca', async () => {
    const { w, mira } = await boot();
    onlyThese(w, 'sp_tab_barra', ['npc_brenna', 'npc_x_damian']);
    put('sp_tab_barra', mira);
    const jarra = run(w, at(3, 18), 12).filter((l) => l.text.includes('Otra jarra, Brenna'));
    expect(jarra).toHaveLength(1);
    expect(jarra[0]!.npc_id).toBe('npc_x_damian');
  });

  it('«Si Garrán viene a cobrar» no la dicen ni Osric, que manda cobrar, ni Garrán, ni Doro (deudor T1)', async () => {
    const { w, mira } = await boot();
    onlyThese(w, 'sp_pl_pozo', ['npc_osric', 'npc_garran', 'npc_doro']);
    put('sp_pl_pozo', mira);
    const cobro = run(w, at(3, 10), 12).filter((l) => l.text.includes('Si Garrán viene a cobrar'));
    for (const l of cobro) expect(['npc_osric', 'npc_garran', 'npc_doro']).not.toContain(l.npc_id);
    // Con una vecina en la plaza, la dice ella.
    const { w: w2, mira: m2 } = await boot();
    onlyThese(w2, 'sp_pl_pozo', ['npc_osric', 'npc_garran', 'npc_x_fermina']);
    put('sp_pl_pozo', m2);
    const cobro2 = run(w2, at(3, 10), 12).filter((l) => l.text.includes('Si Garrán viene a cobrar'));
    expect(cobro2.map((l) => l.npc_id)).toEqual(['npc_x_fermina']);
  });

  it('solo dentro de la tanda de un NPC: `npc_ids` manda, y si ese no está, la frase calla', async () => {
    const { w, mira } = await boot();
    onlyThese(w, 'sp_mo_muelas', ['npc_tobias']);
    put('sp_mo_muelas', mira);
    // Las del molino son de Mateo; con solo Tobías, nada (ni «Tobías, la reja» en boca de Tobías).
    expect(run(w, at(3, 10), 8).filter((l) => l.location_id === 'loc_molino')).toEqual([]);
  });

  it('una tanda que nombra a alguien con hueco ({npc}) no la dice ese NPC, ni quien va en `not_npc_ids`', async () => {
    const { w, mira } = await boot();
    onlyThese(w, 'sp_pl_pozo', ['npc_hugo', 'npc_doro']);
    put('sp_pl_pozo', mira);
    const now = at(3, 10);
    addChatter(w, { id: 'x_hugo', kind: 'rumor', texts: ['Dicen que {npc} ha vuelto a beber.'], location_ids: ['loc_plaza'], npc_ids: null, fact_id: null, about: null, subject: 'npc_hugo', vars: { npc: 'Hugo' }, from_game_s: now, until_game_s: now + GAME_DAY, per_day: 3 });
    addChatter(w, { id: 'x_doro', kind: 'rumor', texts: ['El portón cruje de noche.'], location_ids: ['loc_plaza'], npc_ids: null, not_npc_ids: ['npc_doro'], fact_id: null, about: null, subject: null, vars: {}, from_game_s: now, until_game_s: now + GAME_DAY, per_day: 3 });
    const lines = run(w, now, 6);
    const hugo = lines.filter((l) => l.set_id === 'x_hugo');
    expect(hugo.map((l) => l.npc_id)).toEqual(['npc_doro']);
    const porton = lines.filter((l) => l.set_id === 'x_doro');
    expect(porton.map((l) => l.npc_id)).toEqual(['npc_hugo']);
  });

  it('nadie dice una frase de Brezal que le nombre ni de una tanda que le excluye, y siempre está en el sitio (todas las horas, varios días)', async () => {
    const { w, mira } = await boot();
    const spots: Record<string, string> = { loc_plaza: 'sp_pl_pozo', loc_taberna: 'sp_tab_barra', loc_molino: 'sp_mo_muelas' };
    const all: ChatterLine[] = [];
    for (const [loc, spot] of Object.entries(spots)) {
      for (const n of w.npcs.values()) {
        if (n.mute) continue;
        onlyThese(w, spot, [n.id]);
        put(spot, mira);
        const got = run(w, at(4 + all.length, 0), 24).filter((l) => l.location_id === loc);
        // Quien la dice está en el sitio en ese momento («El herrero, al pasar» no sale en el Jabalí sin Hugo dentro).
        for (const l of got) if (l.npc_id) expect(w.spot(w.npc(l.npc_id).location.id).location_id).toBe(loc);
        all.push(...got);
      }
    }
    expect(all.length).toBeGreaterThan(5);
    const defOf = (setId: string) => CHATTER.find((d) => `daily:${d.id}` === setId);
    for (const l of all) {
      if (!l.npc_id) continue;
      expect(named(w, l.text)).not.toContain(l.npc_id);
      expect(defOf(l.set_id)?.not_npc_ids ?? []).not.toContain(l.npc_id);
    }
  });

  it('`speakerLabel` con el artículo que toca: «El guardia» para Doro (deudor T20), «La tabernera», «La mujer del ascua»', async () => {
    const { w, mira } = await boot();
    mira.knows = [];
    expect(speakerLabel(w, 'npc_doro', mira.id)).toBe('El guardia');
    expect(speakerLabel(w, 'npc_brenna', mira.id)).toBe('La tabernera');
    expect(speakerLabel(w, 'npc_garran', mira.id)).toBe('El alguacil');
    expect(speakerLabel(w, 'npc_ysolde', mira.id)).toBe('La mujer del ascua');
    expect(speakerLabel(w, 'npc_x_anselmo', mira.id)).toBe('El sereno');
    mira.knows = ['npc_doro'];
    expect(speakerLabel(w, 'npc_doro', mira.id)).toBe('Doro');
    // El género por la primera palabra, no por la última letra del oficio entero.
    expect(roleLabel({ role: 'guardia' })).toBe('el guardia');
    expect(roleLabel({ role: 'mujer del molinero' })).toBe('la mujer del molinero');
    expect(roleLabel({ role: 'hijo de la curandera' })).toBe('el hijo de la curandera');
    expect(roleLabel({ role: 'centinela del portón' })).toBe('el centinela del portón');
  });
});
