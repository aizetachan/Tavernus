/**
 * Lo que sabe el PJ y lo que puede decir el máster (bloque B, segunda parte):
 * confianza por niveles en cada NPC (trust.ts), saber repartido por niveles
 * (`npc.knowledge`) y pistas con requisitos (`clue.sources`). Sale de la partida
 * del 2026-10-27 («La noche del Brezal», Leodhin, mago, solo): en la primera
 * charla, con una Persuasión CD 13, Ilse le contó la Brasa, la cripta, el
 * granero y las cadenas (seq 21–24), porque el máster tenía su secreto entero y
 * grant_clue no comprobaba nada. Obsidian: «Revisión partida 2026-10-27» (§1 y
 * §2, plan B) y «Modelo Baldur's Gate 3».
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { authoredSeed } from '../src/data/campaigns/index.js';
import { claimSituation } from '../src/worldgen/index.js';
import { validateSnapshot } from '../src/worldgen/validate.js';
import { Engine, type MasterLike } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { actionContext } from '../src/ai/prompt.js';
import { seededRng } from '../src/engine/dice.js';
import { characterStory, clueBlocked, validateStory, type Story } from '../src/engine/story.js';
import { adjustTrust, knowledgeFor, knowledgeOf, TALK_GAP_S, trustFromRoll, trustTier } from '../src/engine/trust.js';
import type { Character, Npc } from '../src/engine/model.js';
import { fakeTime } from './helpers.js';

const EPOCH = Date.UTC(2026, 9, 22, 12, 0, 0);
const H = 3600;

async function boot() {
  const time = fakeTime(EPOCH);
  const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
  return { engine, time };
}

async function newPc(engine: Engine, name: string, class_id = 'wizard'): Promise<Character> {
  const r = await engine.createCharacter(`u_${name}`, name, { class_id });
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return r.character;
}

const ctxFor = (engine: Engine, c: Character): ToolContext => ({ engine, actor: c, nowGameS: engine.nowFor(c), rng: seededRng(7), closed: null, rolls: [], progress: [] });
type ToolOut = Record<string, unknown> & { ok?: boolean; error?: string; reason?: string };
const tool = (engine: Engine, c: Character, name: string, input: Record<string, unknown>, ctx = ctxFor(engine, c)): ToolOut =>
  JSON.parse(executeTool(ctx, name, input)) as ToolOut;

/** El PJ junto al NPC y hablando con él (una charla nueva). */
function talk(engine: Engine, c: Character, n: Npc): void {
  c.location = { type: 'spot', id: n.location.id };
  n.talking_to = { character_id: c.id, since_game_s: engine.nowFor(c) };
}

/** La línea del NPC en «Presentes» del contexto del máster (hasta el siguiente presente). */
function npcBlock(ctx: string, npcId: string): string {
  const start = ctx.indexOf(`[${npcId}]`);
  expect(start, `${npcId} en el contexto`).toBeGreaterThan(-1);
  const from = ctx.lastIndexOf('\n- ', start);
  const next = ctx.indexOf('\n- ', start);
  const end = Math.min(...[next, ctx.indexOf('\n##', start)].filter((i) => i > -1));
  return ctx.slice(from, end);
}

/** Lo que Ilse solo cuenta a un amigo: la Brasa, la cripta, el granero y las cadenas (seq 23). */
const ACT_I = [/Brasa/, /cripta/, /granero/, /cadenas/, /sacerdotisa/, /hierro frío/];

afterEach(() => { vi.restoreAllMocks(); });

describe('el caso de Ilse (seq 21–24): un extraño con éxito en Persuasión', () => {
  it('por el motor: la tirada sube como mucho a lo del nivel extraño; el máster no recibe la Brasa y grant_clue la rechaza con motivo', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin');
    await engine.tick(); // la apertura: Ilse le agarra la muñeca junto al pozo
    const ilse = engine.world.npc('npc_ilse');
    expect(ilse.location.id).toBe('sp_pl_pozo');
    talk(engine, leo, ilse);
    expect(trustTier(ilse, leo.id)).toBe('stranger');

    // «¿Qué es la Brasa?» → Persuasión CD 13 con un 20 natural. El máster narra el desenlace con este contexto.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99); // solo el d20 de la tirada
    let seen = '';
    let granted: ToolOut | null = null;
    let success: boolean | null = null;
    const master: MasterLike = {
      resolve: async (actor, text, roll) => {
        seen = actionContext(engine, actor, text, roll);
        success = roll?.result.success ?? null;
        granted = tool(engine, actor, 'grant_clue', { character_id: actor.id, clue_id: 'clue_ilse' });
        return { ok: false, reason: 'test', message: 'sin máster' };
      },
    };
    engine.attachMaster(master);
    (engine as unknown as { pendingRolls: Map<string, unknown> }).pendingRolls.set(leo.id, {
      text: '¿Qué es la Brasa?', roll: { kind: 'skill', key: 'persuasion', dc: 13, advantage: 'none' }, event_id: 'x',
    });
    const res = await engine.rollPending(leo.id);
    expect(seen, JSON.stringify(res)).not.toBe("");

    expect(success).toBe(true);
    expect(trustTier(ilse, leo.id)).toBe('stranger');
    const line = npcBlock(seen, 'npc_ilse');
    expect(line).toContain('Confianza con Leodhin: extraño');
    expect(line).toContain('Cura la tos gris con tónicos');
    for (const re of ACT_I) expect(line).not.toMatch(re);
    expect(line).toContain('Calla algo más que no sabes: lo contaría a un conocido');
    // Ni las pistas de aquí: la de la Brasa no está abierta para él.
    expect(seen).not.toContain('[clue_ilse]');

    expect(granted!.error).toBe('clue_locked');
    expect(granted!.reason).toMatch(/Ilse .*no habla con quien acaba de conocer/);
    expect(leo.clues).not.toContain('clue_ilse');
  });

  it('las demás puertas: get_npc y get_campaign_notes tampoco lo sueltan', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin');
    const ilse = engine.world.npc('npc_ilse');
    talk(engine, leo, ilse);
    const npc = tool(engine, leo, 'get_npc', { npc_id: 'npc_ilse' });
    expect(npc['secret']).toBeUndefined();
    expect(npc['trust_with_actor']).toBe('extraño');
    expect((npc['would_tell_actor'] as string[]).join(' ')).not.toMatch(/Brasa|cripta/);
    const notes = tool(engine, leo, 'get_campaign_notes', {});
    expect((notes['clues_pending'] as { id: string }[]).map((x) => x.id)).not.toContain('clue_ilse');
    expect(notes['clues_locked']).toBeGreaterThan(0);
  });

  it('con tope por charla: dos éxitos en la misma charla cuentan uno; en otra charla, una hora después, ya es conocido (pero no amigo)', async () => {
    const { engine, time } = await boot();
    const leo = await newPc(engine, 'Leodhin');
    const ilse = engine.world.npc('npc_ilse');
    talk(engine, leo, ilse);
    expect(trustFromRoll(engine.world, leo, 'persuasion', true, engine.nowFor(leo))!.delta).toBe(1);
    expect(trustFromRoll(engine.world, leo, 'persuasion', true, engine.nowFor(leo))!.delta).toBe(0);
    expect(tool(engine, leo, 'npc_trust', { npc_id: 'npc_ilse', change: 'favor', why: 'le carga la leña' })['note']).toMatch(/otra charla/);
    expect(trustTier(ilse, leo.id)).toBe('stranger');

    // Despedirse y volver enseguida es la misma charla.
    ilse.talking_to = null;
    time.advanceGame(10 * 60);
    talk(engine, leo, ilse);
    expect(trustFromRoll(engine.world, leo, 'persuasion', true, engine.nowFor(leo))!.delta).toBe(0);

    ilse.talking_to = null;
    time.advanceGame(TALK_GAP_S);
    talk(engine, leo, ilse);
    const r = trustFromRoll(engine.world, leo, 'persuasion', true, engine.nowFor(leo))!;
    expect(r.after).toBe('acquaintance');
    const line = npcBlock(actionContext(engine, leo, 'hablo con Ilse'), 'npc_ilse');
    expect(line).toContain('quiere una muestra para mirarla con calma');
    for (const re of ACT_I) expect(line).not.toMatch(re);
    expect(tool(engine, leo, 'grant_clue', { character_id: leo.id, clue_id: 'clue_ilse' }).error).toBe('clue_locked');
  });

  it('con la misión hecha («El agua turbia»), Ilse ya es amiga: el máster recibe la Brasa y la pista sale', async () => {
    const { engine } = await boot();
    const leo = await newPc(engine, 'Leodhin');
    const ilse = engine.world.npc('npc_ilse');
    talk(engine, leo, ilse);
    ilse.attitude.by_character[leo.id] = 'friendly'; // lo que deja «El agua turbia» al darle el agua
    expect(trustTier(ilse, leo.id)).toBe('friend');
    const line = npcBlock(actionContext(engine, leo, '¿Qué es la Brasa?'), 'npc_ilse');
    expect(line).toMatch(/la Brasa, con cadenas de hierro frío/);
    expect(line).not.toContain('rima de corro'); // lo de aliado, todavía no
    expect(tool(engine, leo, 'grant_clue', { character_id: leo.id, clue_id: 'clue_ilse' }).ok).toBe(true);
  });
});

describe('la confianza sube y baja', () => {
  it('un recado en mano presenta y sube la confianza: Doro, tras la cena del portón, ya es conocido y cuenta lo que vio', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Brin', 'rogue');
    const doro = engine.world.npc('npc_doro');
    talk(engine, c, doro);
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_doro' }).error).toBe('clue_locked');
    characterStory(c).open.push('q_cena_doro');
    const ctx = ctxFor(engine, c);
    const racion = engine.world.itemDefs.get('it_racion')!;
    const inst = engine.world.itemInstances.get([...engine.world.itemInstances.values()].find((i) => i.item_id === racion.id)!.id)!;
    inst.location = { type: 'character', id: c.id, slot: { kind: 'pocket' } };
    expect(tool(engine, c, 'transfer_item', { instance_id: inst.id, to_type: 'npc', to_id: 'npc_doro', slot: null, equip_slot: null, quantity: null }, ctx).error).toBeUndefined();
    await engine.tick();
    expect(trustTier(doro, c.id)).toBe('acquaintance');
    expect(c.knows).toContain('npc_doro');
    // Sin entregarle la cena a Brenna aún no ha cumplido el recado: Doro no lo cuenta.
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_doro' }).error).toBe('clue_locked');
    characterStory(c).done.push('q_cena_doro');
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_doro' }).ok).toBe(true);
  });

  it('ir de parte de Ilse: al aceptar «La cadena de hierro frío», Hugo le recibe como a un conocido y, sabiendo lo de la Brasa, le habla de la cadena', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Leodhin');
    c.clues.push('clue_ilse');
    characterStory(c).done.push('q_agua');
    c.level = 2;
    const ilse = engine.world.npc('npc_ilse');
    talk(engine, c, ilse);
    expect(tool(engine, c, 'story_quest', { quest_id: 'q_cadena', action: 'ask' }).ok).toBe(true);
    const hugo = engine.world.npc('npc_hugo');
    expect(trustTier(hugo, c.id)).toBe('acquaintance');
    ilse.talking_to = null;
    talk(engine, c, hugo);
    expect(tool(engine, c, 'grant_clue', { character_id: c.id, clue_id: 'clue_hugo' }).ok).toBe(true);
  });

  it('baja con amenazas, mentiras pilladas, ataques y crímenes vistos; la actitud hostil o recelosa la deja en extraño', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Brin', 'rogue');
    const brenna = engine.world.npc('npc_brenna');
    (brenna.trust ??= {})[c.id] = { points: 6 };
    expect(trustTier(brenna, c.id)).toBe('friend');
    talk(engine, c, brenna);
    expect(trustFromRoll(engine.world, c, 'intimidation', true, engine.nowFor(c))!.after).toBe('acquaintance'); // 6 − 2
    expect(trustFromRoll(engine.world, c, 'deception', false, engine.nowFor(c))!.after).toBe('acquaintance'); // 4 − 2
    expect(tool(engine, c, 'npc_trust', { npc_id: 'npc_brenna', change: 'insult', why: 'le llama vieja' })['trust']).toBe('extraño'); // 2 − 1
    expect(brenna.trust[c.id]!.points).toBe(1);

    const ilse = engine.world.npc('npc_ilse');
    ilse.attitude.by_character[c.id] = 'friendly';
    expect(trustTier(ilse, c.id)).toBe('friend');
    ilse.attitude.by_character[c.id] = 'unfriendly';
    expect(trustTier(ilse, c.id)).toBe('stranger');
    expect(knowledgeFor(ilse, c.id).map((k) => k.tier)).toEqual(['stranger']);

    const hugo = engine.world.npc('npc_hugo');
    (hugo.trust ??= {})[c.id] = { points: 9 };
    adjustTrust(engine.world, hugo, c, 'witnessed_crime', engine.nowFor(c));
    expect(trustTier(hugo, c.id)).toBe('friend'); // 9 − 3
  });
});

describe('adular y hostigar', () => {
  it('adular sube a quien lo agradece (con el tope de la charla) y resta a quien no lo soporta; hostigar resta cada vez', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Brin', 'rogue');
    const doro = engine.world.npc('npc_doro');
    talk(engine, c, doro);
    expect(tool(engine, c, 'npc_trust', { npc_id: 'npc_doro', change: 'flattery', why: 'le dice que tiene porte de capitán' })['trust']).toBe('extraño');
    expect(doro.trust![c.id]!.points).toBe(1);
    expect(tool(engine, c, 'npc_trust', { npc_id: 'npc_doro', change: 'flattery', why: 'otra vez' })['note']).toMatch(/otra charla/);
    expect(doro.trust![c.id]!.points).toBe(1);

    const hugo = engine.world.npc('npc_hugo');
    expect(hugo.dislikes_flattery).toBe(true);
    (hugo.trust ??= {})[c.id] = { points: 2 };
    doro.talking_to = null;
    talk(engine, c, hugo);
    expect(npcBlock(actionContext(engine, c, 'le hablo a Hugo'), 'npc_hugo')).toContain('No soporta la adulación');
    expect(tool(engine, c, 'npc_trust', { npc_id: 'npc_hugo', change: 'flattery', why: 'le llama el mejor herrero del valle' })['trust']).toBe('extraño');
    expect(hugo.trust[c.id]!.points).toBe(1);

    (doro.trust ??= {})[c.id] = { points: 3 };
    hugo.talking_to = null;
    talk(engine, c, doro);
    tool(engine, c, 'npc_trust', { npc_id: 'npc_doro', change: 'harass', why: 'le insiste con lo del granero tras decir que no' });
    expect(tool(engine, c, 'npc_trust', { npc_id: 'npc_doro', change: 'harass', why: 'y otra vez' })['trust']).toBe('extraño');
    expect(doro.trust[c.id]!.points).toBe(1);
  });
});

describe('pistas con requisitos en los datos de Brezal', () => {
  it('ninguna pista clave sale en la primera charla con un extraño, ni con una tirada buena: cada persona que la da pide algo más', async () => {
    const { engine } = await boot();
    const keys = engine.world.campaign.clues.filter((x) => x.key);
    expect(keys.map((x) => x.id).sort()).toEqual(['clue_brenna', 'clue_doro', 'clue_hal', 'clue_hugo', 'clue_ilse', 'clue_libro', 'clue_tobias', 'clue_ysolde']);
    let n = 0;
    for (const clue of keys) {
      for (const s of clue.sources ?? []) {
        if (!s.npc_id) continue;
        const c = await newPc(engine, `Prueba${n++}`, 'rogue');
        const npc = engine.world.npc(s.npc_id);
        for (const o of engine.world.npcs.values()) if (o.talking_to) o.talking_to = null;
        talk(engine, c, npc);
        trustFromRoll(engine.world, c, 'persuasion', true, engine.nowFor(c));
        expect(trustTier(npc, c.id), `${npc.id} con ${c.name}`).toBe('stranger');
        expect(clueBlocked(engine.world, c, clue), `${clue.id} de ${npc.id}`).not.toBeNull();
      }
    }
  });

  it('a un extraño, nadie de Brezal le cuenta en su línea nada de lo que abre la historia', async () => {
    const { engine } = await boot();
    const c = await newPc(engine, 'Brin', 'rogue');
    for (const n of engine.world.npcs.values()) {
      const told = knowledgeFor(n, c.id).map((k) => k.text).join(' ');
      expect(told, n.id).not.toMatch(/Osric (prendió|Malvez, entonces)|la Brasa, con cadenas|heredera de Vharn|losa suelta|desván del molino|plata vieja con el sello/);
    }
  });

  it('cada persona de Brezal tiene su saber por niveles; el secreto del motor es la suma, solo para el análisis', async () => {
    const { engine } = await boot();
    for (const n of engine.world.npcs.values()) {
      if (!n.stats || n.id === 'npc_lobo' || n.id === 'npc_loba') continue;
      expect(n.knowledge?.length, n.id).toBeGreaterThanOrEqual(3);
      expect(n.knowledge![0]!.tier, n.id).toBe('stranger');
      expect(n.secret).toBe(n.knowledge!.map((k) => k.text).join(' '));
    }
  });

  it('un mundo generado (solo secreto, sin niveles): el secreto cuenta como de amigo', () => {
    const n = { secret: 'Robó el cáliz.', knowledge: undefined, attitude: { default: 'neutral', by_character: {} } } as unknown as Npc;
    expect(knowledgeOf(n)).toEqual([{ tier: 'friend', text: 'Robó el cáliz.' }]);
    expect(knowledgeFor(n, 'ch_x')).toEqual([]);
  });
});

describe('validador: toda pista clave tiene al menos dos caminos', () => {
  it('Brezal pasa; una clave con un solo camino, o con dos de la misma persona, no', async () => {
    const { engine } = await boot();
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    expect(validateSnapshot(seed).filter((e) => e.startsWith('pista'))).toEqual([]);
    const story = (engine.world.campaign as unknown as { story: Story }).story;
    const has = { spot: () => true, location: () => true, npc: () => true, item: () => true, clue: () => true, job: () => true, exit: () => true };
    const clues = structuredClone(engine.world.campaign.clues);
    const doro = clues.find((x) => x.id === 'clue_doro')!;
    doro.sources = doro.sources!.slice(0, 1);
    expect(validateStory(story, { ...has, clues })).toContain('pista clue_doro: es clave y solo tiene un camino; hacen falta dos (otra persona, otro sitio o una misión que la dé).');
    doro.sources = [doro.sources[0]!, { ...doro.sources[0]!, via: 'otra vez Doro' }];
    expect(validateStory(story, { ...has, clues }).some((e) => e.startsWith('pista clue_doro'))).toBe(true);
    doro.sources[1] = { via: 'x', npc_id: 'npc_nadie', requires: { kind: 'trust', npc_id: 'npc_doro', at_least: 'friend' } };
    expect(validateStory(story, { ...has, npc: (id: string) => id !== 'npc_nadie', clues })).toContain('pista clue_doro: la fuente 2 la da npc_nadie, que no existe.');
  });
});

describe('partidas de antes', () => {
  it('una partida guardada sin niveles ni fuentes los toma de la semilla al arrancar', async () => {
    const time = fakeTime(EPOCH);
    const seed = authoredSeed('brezal', { now: new Date(EPOCH) });
    const repo = new MemoryRepository();
    const first = await Engine.boot({ repo, campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
    for (const n of first.world.npcs.values()) delete n.knowledge;
    for (const cl of first.world.campaign.clues) delete cl.sources;
    first.world.touch('campaign', first.world.campaign.id);
    for (const n of first.world.npcs.values()) first.world.touch('npcs', n.id);
    await first.flush();
    const again = await Engine.boot({ repo, campaignId: 'brezal', seed, now: time.now, deterministic: false, fastTravel: false });
    expect(again.world.npc('npc_ilse').knowledge?.[0]?.tier).toBe('stranger');
    expect(again.world.campaign.clues.find((x) => x.id === 'clue_ilse')?.sources?.length).toBe(2);
  });
});

void H;
