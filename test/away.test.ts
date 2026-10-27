import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { executeTool, type ToolContext } from '../src/ai/tools.js';
import { resolveAttack } from '../src/engine/combat.js';
import { seededRng } from '../src/engine/dice.js';
import type { Engine, MasterLike } from '../src/engine/engine.js';
import type { Delivery } from '../src/engine/events.js';
import { moveTo } from '../src/engine/movement.js';
import { recapTemplate, absence, absenceRule, lastOwnEvent } from '../src/engine/prologue.js';
import { advanceStory, characterStory, finalsMissedBy, storyQuestAction, tickStory, type Story } from '../src/engine/story.js';
import { talkersOf } from '../src/engine/scene.js';
import { bootEngine, fakeTime } from './helpers.js';

function collect(engine: Engine) {
  const by = new Map<string, Delivery[]>();
  engine.onDelivery((d) => { by.set(d.character_id, [...(by.get(d.character_id) ?? []), d]); });
  return (id: string) => (by.get(id) ?? []).map((d) => d.text);
}

/** Máster falso que apunta qué le llega (texto y contexto). */
function fakeMaster(engine: Engine) {
  const calls: { actor: string; text: string; context: string }[] = [];
  const m: MasterLike = {
    async resolve(actor, text, _roll, _intro, scene) {
      calls.push({ actor: actor.id, text, context: actionContext(engine, actor, text, undefined, undefined, scene) });
      return { ok: true, usage: {}, calls: [], context: '', model: 'falso', closed: { narration_private: 'Pasa algo.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
    },
  };
  engine.attachMaster(m);
  return calls;
}

/** Kael y Mira en la barra, conectados y conociéndose. */
async function bar(opts: { roundMs?: number } = {}) {
  const time = fakeTime();
  const { engine } = await bootEngine(time, { roundMs: opts.roundMs ?? 100, groupWindowMs: 100 });
  const kael = engine.world.character('ch_kael');
  const mira = engine.world.character('ch_mira');
  mira.location = { type: 'spot', id: 'sp_tab_barra' };
  engine.setPresence(kael.id, true); engine.setPresence(mira.id, true);
  return { engine, time, kael, mira, seen: collect(engine) };
}

describe('1. aviso y estado ausente', () => {
  it('los presentes leen que se ha ido y que su PJ se queda; al volver, que ha vuelto', async () => {
    const { engine, kael, mira, seen } = await bar();
    engine.setAway(mira.id, true);
    expect(seen(kael.id).at(-1)).toBe('Mira se ha ido; su personaje se queda en la barra.');
    expect(engine.world.characterSpot(mira)!.id).toBe('sp_tab_barra');
    expect(mira.away).toMatchObject({ spot_id: 'sp_tab_barra' });
    engine.setAway(mira.id, false);
    expect(seen(kael.id).at(-1)).toBe('Mira ha vuelto.');
    expect(mira.away).toBeNull();
  });
});

describe('2. combate con un ausente', () => {
  it('no ataca; el máster lo ve AUSENTE; si cae a 0 PG queda estabilizado', async () => {
    const { engine, kael, mira } = await bar();
    engine.setAway(mira.id, true);
    const ctx: ToolContext = { engine, actor: kael, nowGameS: engine.nowFor(kael), rng: seededRng(1), closed: null, rolls: [], progress: [] };
    const r = JSON.parse(executeTool(ctx, 'attack', { attacker_id: mira.id, target_id: 'npc_brenna', advantage: 'none' })) as { error?: string };
    expect(r.error).toMatch(/^Mira está ausente: no ataca/);
    expect(actionContext(engine, kael, 'mirar')).toContain('AUSENTE: no ataca ni gasta recursos; si le atacan se defiende solo');
    mira.hp_current = 1;
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) { const a = resolveAttack(engine.world, 'npc_brenna', mira.id, 'advantage'); hit = !('error' in a) && a.hit; }
    expect(mira.status).toBe('unconscious');
    expect(mira.conditions.map((x) => x.name)).toContain('estable');
  });

  it('su ventana decisiva vencida se resuelve «se defiende», no sin acción', async () => {
    const { engine, time, mira } = await bar();
    const calls = fakeMaster(engine);
    mira.decisive = { opened_real_ms: time.now(), window_s: 60, threat: 'el lobo le salta al cuello', npc_id: null, event_id: 'ev_x' };
    engine.setAway(mira.id, true);
    time.advanceReal(61);
    await engine.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls[0]!.text).toBe('(ausente: se defiende)');
    expect(calls[0]!.context).toContain('está AUSENTE');
    expect(calls[0]!.context).toContain('SE DEFIENDE');
  });

  it('a los 30 min ausente, el velo: deja de ser objetivo válido', async () => {
    const { engine, time, kael, mira } = await bar();
    engine.setAway(mira.id, true);
    time.advanceReal(31 * 60);
    engine.setPresence(mira.id, false); // la web lo hace a los 30 min sin pestañas
    expect(mira.veiled).toBe(true);
    expect(resolveAttack(engine.world, 'npc_brenna', mira.id, 'none')).toMatchObject({ error: 'Mira está bajo el velo: no puede recibir daño' });
    expect(actionContext(engine, kael, 'mirar')).toContain('BAJO EL VELO: no es objetivo válido');
  });
});

describe('3. rondas', () => {
  it('el ausente duda y no bloquea; tras dos rondas seguidas ausente, sale y la escena sigue', async () => {
    const { engine, kael, mira } = await bar({ roundMs: 80 });
    const calls = fakeMaster(engine);
    engine.world.location('loc_taberna').state['tense'] = true;
    engine.setAway(mira.id, true);
    await engine.act(kael.id, 'vigilar la puerta');
    await engine.act(kael.id, 'atrancar la puerta');
    expect(calls.map((c) => c.text)).toEqual(['(ronda 1) Kael: vigilar la puerta / dudan: Mira', '(ronda 2) Kael: atrancar la puerta / dudan: Mira']);
    const t0 = Date.now();
    await engine.act(kael.id, 'apagar el fuego');
    expect(Date.now() - t0).toBeLessThan(60); // sin ronda: no espera al temporizador
    expect(calls.at(-1)!.text).toBe('apagar el fuego');
  });

  it('al ausente no se le espera: la ronda se cierra en cuanto actúan los demás, sin temporizador', async () => {
    const { engine, kael, mira } = await bar({ roundMs: 5000 });
    const calls = fakeMaster(engine);
    engine.world.location('loc_taberna').state['tense'] = true;
    engine.setAway(mira.id, true);
    const t0 = Date.now();
    await engine.act(kael.id, 'vigilar la puerta');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(calls.map((c) => c.text)).toEqual(['(ronda 1) Kael: vigilar la puerta / dudan: Mira']);
    expect(engine.roundIn('loc_taberna')).toBeNull();
  });

  it('si se va a mitad de ronda y solo faltaba él, la ronda se cierra ya; el banner deja de esperarle', async () => {
    const { engine, kael, mira } = await bar({ roundMs: 5000 });
    const calls = fakeMaster(engine);
    const banners: string[][] = [];
    engine.onScene((n) => { if (n.open) banners.push(n.waiting); });
    engine.world.location('loc_taberna').state['tense'] = true;
    const t0 = Date.now();
    const acted = engine.act(kael.id, 'vigilar la puerta');
    await new Promise((r) => setTimeout(r, 20));
    expect(banners.at(-1)).toEqual([mira.id]);
    engine.setAway(mira.id, true);
    await acted;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(calls.map((c) => c.text)).toEqual(['(ronda 1) Kael: vigilar la puerta / dudan: Mira']);
  });

  it('8. con la pestaña abierta pero sin actuar, manda el temporizador y nunca sale de la ronda', async () => {
    const { engine, kael } = await bar({ roundMs: 60 });
    const calls = fakeMaster(engine);
    engine.world.location('loc_taberna').state['tense'] = true;
    for (const t of ['uno', 'dos', 'tres']) await engine.act(kael.id, t);
    expect(calls.map((c) => c.text)).toEqual(['(ronda 1) Kael: uno / dudan: Mira', '(ronda 2) Kael: dos / dudan: Mira', '(ronda 3) Kael: tres / dudan: Mira']);
  });
});

describe('4-6. conversación, seguir y ofertas', () => {
  it('4. sale de la conversación de grupo; el NPC sigue con los que quedan', async () => {
    const { engine, kael, mira } = await bar();
    const brenna = engine.world.npc('npc_brenna');
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: '«Hola»', observable: null, payload: { npc_id: brenna.id } });
    brenna.talking_to = { character_id: kael.id, since_game_s: engine.gameNow(), with: [mira.id] };
    engine.setAway(mira.id, true);
    expect(talkersOf(engine.world, engine.events.all(), brenna, engine.gameNow())).toEqual([kael.id]);
  });

  it('5. si se va el líder, el seguidor deja de seguir con aviso; si se va el seguidor, se queda', async () => {
    const { engine, kael, mira, seen } = await bar();
    await engine.act(mira.id, 'seguir a Kael');
    engine.setAway(kael.id, true);
    expect(mira.following).toBeNull();
    expect(seen(mira.id).at(-1)).toBe('Kael se ha ido: dejas de seguirle.');
    engine.setAway(kael.id, false);
    await engine.act(mira.id, 'seguir a Kael');
    engine.setAway(mira.id, true);
    moveTo(engine.world, kael.id, 'sp_tab_puerta', 'walk', engine.nowFor(kael));
    await engine.tick();
    expect(mira.transit).toBeNull();
    expect(engine.world.characterSpot(mira)!.id).toBe('sp_tab_barra');
  });

  it('6. las ofertas pendientes con un ausente se cancelan con aviso a los dos', async () => {
    const { engine, kael, mira, seen } = await bar();
    await engine.act(kael.id, 'dar daga a Mira');
    expect(mira.offers).toHaveLength(1);
    engine.setAway(mira.id, true);
    expect(mira.offers).toBeUndefined();
    expect(seen(kael.id).at(-1)).toBe('La oferta que le hiciste a Mira (daga) se cancela: se ha ido.');
    expect(seen(mira.id).at(-1)).toBe('Tu oferta pendiente (daga) se canceló al irte.');
    expect(engine.world.itemsCarriedBy(kael.id).some((i) => i.item_id === 'it_daga')).toBe(true);
  });
});

describe('7. misiones y finales', () => {
  /** Una historia mínima: un camino compartido y dos finales excluyentes. */
  const STORY: Story = {
    escalation: [],
    quests: [
      { id: 'q_pozo', act: 1, title: 'El pozo', giver_npc_id: 'npc_brenna', turn_in_npc_id: null, level: 1, text: 'Mirad el pozo.', notes: '', steps: [{ id: 'mirar', text: 'Mirar el pozo', done_when: { kind: 'narrative', how: 'lo miran' } }, { id: 'bajar', text: 'Bajar al pozo', done_when: { kind: 'narrative', how: 'bajan' } }], reward: {}, on_complete: [] },
      { id: 'q_fin_a', act: 3, title: 'Cerrar el pozo', giver_npc_id: 'npc_brenna', turn_in_npc_id: null, level: 1, text: '', notes: '', exclusive: 'fin', steps: [{ id: 'cerrar', text: 'Cerrarlo', done_when: { kind: 'narrative', how: 'lo cierran' } }], reward: {}, on_complete: [], ending: 'El pozo quedó cerrado por {name}.' },
      { id: 'q_fin_b', act: 3, title: 'Abrir el pozo', giver_npc_id: 'npc_brenna', turn_in_npc_id: null, level: 1, text: '', notes: '', exclusive: 'fin', steps: [{ id: 'abrir', text: 'Abrirlo', done_when: { kind: 'narrative', how: 'lo abren' } }], reward: {}, on_complete: [] },
    ],
  };
  /** Cada uno acepta lo que le ofrece Brenna (en la barra, con ellos). */
  const accept = (engine: Engine, pcs: import('../src/engine/model.js').Character[], ids: string[]) => {
    for (const pc of pcs) for (const id of ids) expect(storyQuestAction(engine.world, pc, id, 'accept', engine.gameNow()).ok).toBe(true);
  };

  it('crédito compartido: quien estaba presente da el mismo paso; el ausente, no', async () => {
    const { engine, kael, mira } = await bar();
    const tam = (await engine.createCharacter('u_t', 'Tamsin')) as { ok: true; character: import('../src/engine/model.js').Character };
    tam.character.location = { type: 'spot', id: 'sp_tab_barra' };
    (engine.world.campaign as unknown as { story: Story }).story = STORY;
    accept(engine, [kael, mira, tam.character], ['q_pozo']);
    engine.setAway(tam.character.id, true);
    advanceStory(engine.world, kael, 'q_pozo', 'mirar', engine.gameNow());
    expect(characterStory(mira).steps).toContain('q_pozo/mirar');
    expect(characterStory(tam.character).steps).not.toContain('q_pozo/mirar');
    const credits = (engine.world.campaign as unknown as { story_state: { credits: Record<string, { by: string; with: string[] }> } }).story_state.credits;
    expect(credits['q_pozo/mirar']).toMatchObject({ by: kael.id, with: [mira.id] });
  });

  it('un final excluyente cerrado mientras el otro estaba ausente es lo primero de su «Donde lo dejamos»', async () => {
    const { engine, time, kael, mira } = await bar();
    (engine.world.campaign as unknown as { story: Story }).story = STORY;
    accept(engine, [kael], ['q_fin_a']);
    accept(engine, [mira], ['q_fin_b']);
    await engine.say(mira.id, 'Voy un momento fuera.');
    engine.setAway(mira.id, true);
    time.advanceReal(600);
    advanceStory(engine.world, kael, 'q_fin_a', 'cerrar', engine.gameNow());
    engine.emitStory(tickStory(engine.world, engine.gameNow()));
    expect(characterStory(mira).expired).toContain('q_fin_b');
    const since = lastOwnEvent(engine, mira.id)!;
    expect(finalsMissedBy(engine.world, mira, since.timestamp_game_s)).toHaveLength(1);
    // Menos de 72 h, pero se fue y se cerró un final sin él: toca «Donde lo dejamos».
    expect(absence(engine, mira, time.now(), absenceRule({}))).not.toBeNull();
    const text = recapTemplate(engine, mira, since, 0.2);
    expect(text.startsWith('**Lo primero.** Mientras no estabas, Kael cerró «Cerrar el pozo». El pozo quedó cerrado por Kael. Para ti, eso cierra «Abrir el pozo»: el valle ya ha elegido.')).toBe(true);
  });
});

describe('9. «Donde lo dejamos» al volver', () => {
  it('antes de 72 h, solo si se fue y le afectó algo (combate en su sitio); lo que le afecta va delante', async () => {
    const { engine, time, kael, mira } = await bar();
    await engine.say(mira.id, 'Voy un momento fuera.');
    // Se va un rato y no pasa nada: no hay recapitulación.
    engine.setAway(mira.id, true);
    time.advanceReal(300);
    expect(absence(engine, mira, time.now(), absenceRule({}))).toBeNull();
    // Mientras sigue fuera, pelea en su sitio.
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Golpeas al lobo.', observable: 'Kael golpea al lobo junto a la barra.', tags: ['master', 'combat'] });
    const gone = absence(engine, mira, time.now(), absenceRule({}));
    expect(gone).not.toBeNull();
    expect(recapTemplate(engine, mira, gone!.since, gone!.hours)).toContain('**Entretanto.** Kael golpea al lobo junto a la barra.');
    // Sin haberse ido (solo recargar), no hay recapitulación aunque haya pelea.
    engine.setAway(mira.id, false);
    const r = await engine.welcomeBack(mira.id, {});
    expect(r?.action_type).toBe('recap');
    expect(await engine.welcomeBack(mira.id, {})).toBeNull();
  });
});

describe('9b. turnos compartidos en «Donde lo dejamos»', () => {
  it('lo que escribió en una ronda cuenta como su último turno', async () => {
    const { engine, time, kael, mira } = await bar({ roundMs: 5000 });
    fakeMaster(engine);
    engine.world.location('loc_taberna').state['tense'] = true;
    await Promise.all([engine.act(kael.id, 'atrancar la puerta'), engine.act(mira.id, 'apagar las brasas')]);
    engine.setAway(mira.id, true);
    engine.events.emit({ actor_id: kael.id, action_type: 'master', narration_private: 'Golpeas al lobo.', observable: 'Kael golpea al lobo.', tags: ['master', 'combat'] });
    const gone = absence(engine, mira, time.now(), absenceRule({}))!;
    expect(gone.since.payload['group_inputs']).toMatchObject({ [mira.id]: 'apagar las brasas' });
    const text = recapTemplate(engine, mira, gone.since, gone.hours);
    expect(text).toContain('**Qué estabas haciendo.** «apagar las brasas».');
    expect(text).toContain('**Entretanto.** Kael golpea al lobo.');
  });
});
