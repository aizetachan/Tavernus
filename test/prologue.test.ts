import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Engine } from '../src/engine/engine.js';
import { MemoryRepository } from '../src/persistence/memory.js';
import { SEED_REAL_EPOCH_MS } from '../src/data/seed/demo.js';
import { claimSituation, generateSeed } from '../src/worldgen/index.js';
import { Master, type MasterClient } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { journalOf } from '../src/engine/journal.js';
import { setDebt } from '../src/engine/debts.js';
import { GAME_DAY } from '../src/clock/clock.js';
import { PROLOGUE_WORDS, RECAP_TITLE, wordCount } from '../src/engine/prologue.js';
import type { GameEvent } from '../src/engine/model.js';
import { bootEngine, fakeTime } from './helpers.js';

const sentencesOf = (s: string) => (s.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]+/g) ?? []).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 12);
const prologues = (engine: Engine, id: string) => engine.events.all().filter((e) => e.action_type === 'prologue' && e.actor_id === id);

/** Mundo generado offline con Ana y su situación, y un máster con el cliente que se pase (offline por defecto). */
async function generated(client: MasterClient = offlineClient()) {
  const seed = await generateSeed({ seed: 77, tone: 'grim', setting: 'Fantasía medieval de baja magia.', client: null, now: () => new Date(SEED_REAL_EPOCH_MS), characters: [{ name: 'Ana' }] });
  const time = fakeTime();
  const engine = await Engine.boot({ repo: new MemoryRepository(), campaignId: seed.campaign.id, seed, now: time.now, deterministic: false });
  const contexts: string[] = [];
  engine.attachMaster(new Master(engine, { client: { create: (p) => { contexts.push(String(p.messages[0]!.content)); return client.create(p); } } }));
  const r = await engine.createCharacter('u1', 'Ana');
  if (!r.ok) throw new Error(r.reason);
  claimSituation(engine.world, r.character.id, engine.gameNow());
  return { engine, time, c: engine.world.character(r.character.id), contexts };
}

/** Cliente que responde a `write` (sin tools) con un texto fijo y al resto como el offline. */
function writer(text: string, seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []): MasterClient {
  const off = offlineClient();
  return {
    async create(p) {
      if (p.tools) return off.create(p);
      seen.push(p);
      return { id: 'msg_w', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 400, output_tokens: 220 } } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}

describe('prólogo', () => {
  it('offline: una sola vez por personaje, antes de la primera escena; cuenta lugar, porqué y amenaza sin secretos de la Biblia', async () => {
    const { engine, c, contexts } = await generated();
    const s = c.situation!;
    const intro = await engine.introduce(c.id);
    expect(intro?.ok).toBe(true);
    const [p] = prologues(engine, c.id);
    expect(p).toBeDefined();
    // Antes que la primera escena y solo para él.
    const firstScene = engine.events.all().find((e) => e.action_type === 'master_intro')!;
    expect(p!.seq).toBeLessThan(firstScene.seq);
    expect(p!.delivered_to).toEqual([{ character_id: c.id, level: 'full' }]);
    expect(p!.payload).toMatchObject({ source: 'template' });

    const loc = engine.world.location(engine.world.characterSpot(c)!.location_id);
    expect(p!.payload["title"]).toBe(`Capítulo 1: ${loc.name.charAt(0).toUpperCase()}${loc.name.slice(1)}`);
    const text = p!.narration_private;
    expect(text).toContain(loc.name);
    expect(text).toContain(s.why_here.split(';')[0]!);
    expect(text.toLowerCase()).toContain(s.threat.toLowerCase().replace(/\.$/, ''));
    expect(text).toContain(`${s.clock_days} días`);
    expect(text).toContain(engine.world.campaign.premise);
    const n = wordCount(text);
    expect(n).toBeGreaterThanOrEqual(PROLOGUE_WORDS.min);
    expect(n).toBeLessThanOrEqual(PROLOGUE_WORDS.max);

    // Nada de la Biblia, de los secretos de los NPC ni de los caminos; ningún nombre que no conozca.
    for (const truth of engine.world.campaign.bible!) expect(text).not.toContain(truth.replace(/\.$/, ''));
    for (const npc of engine.world.npcs.values()) {
      if (npc.secret) expect(text).not.toContain(npc.secret);
      if (!c.knows.includes(npc.id)) expect(text).not.toContain(npc.name);
    }
    for (const path of s.paths) expect(text).not.toContain(path);
    expect(text).not.toContain(s.opening);

    // La primera escena lo sabe, es más corta y no lo repite.
    const ctx = contexts.at(-1)!;
    expect(ctx).toContain('Acaba de leer este prólogo');
    expect(ctx).toContain('No repitas nada de él');
    expect(ctx).toContain('50 palabras como máximo');
    const shared = sentencesOf(firstScene.narration_private).filter((x) => sentencesOf(text).includes(x));
    expect(shared).toEqual([]);

    // Una segunda primera escena (reconexión, reinicio) no escribe otro.
    await engine.introduce(c.id);
    expect(prologues(engine, c.id)).toHaveLength(1);
  });

  it('en el Diario abre la crónica del primer día', async () => {
    const { engine, c } = await generated();
    await engine.introduce(c.id);
    const day = journalOf(engine, c.id).chronicle.at(-1)!;
    expect(day.entries[0]).toMatchObject({ kind: 'chapter' });
    expect(day.entries[0]!.text).toMatch(/^Capítulo 1: /);
  });

  it('con máster en vivo lo escribe él con su bloque propio, sin la Biblia; los nombres que no conoce salen por su oficio', async () => {
    const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
    // El texto del máster nombra a alguien que Ana no conoce: el motor lo enmascara.
    const probe = await generated();
    const stranger = [...probe.engine.world.npcs.values()].find((n) => !probe.c.knows.includes(n.id) && n.status === 'alive')!;
    const body = `El invierno aprieta y la gente cuenta las monedas dos veces. ${stranger.name} te mira desde lejos. `.repeat(1)
      + 'Palabra '.repeat(130) + 'fin.';
    const { engine, c } = await generated(writer(body, seen));
    await engine.introduce(c.id);
    const [p] = prologues(engine, c.id);
    expect(p!.payload).toMatchObject({ source: 'master', master: { model: 'claude-haiku-5-5', usage: { input: 400, output: 220 } } });
    expect(p!.narration_private).not.toContain(stranger.name);
    expect(seen).toHaveLength(1);
    const prompt = String(seen[0]!.messages[0]!.content);
    expect(prompt).toMatch(/^## Prólogo/);
    expect(prompt).toContain(c.situation!.why_here);
    expect(prompt).toContain(`${PROLOGUE_WORDS.min}-${PROLOGUE_WORDS.max} palabras`);
    for (const truth of engine.world.campaign.bible!) expect(prompt).not.toContain(truth);
    for (const npc of engine.world.npcs.values()) if (npc.secret) expect(prompt).not.toContain(npc.secret);
    expect(seen[0]!.tools).toBeUndefined();
  });

  it('si el máster devuelve algo que no vale (muy corto), queda la plantilla', async () => {
    const { engine, c } = await generated(writer('Hola.'));
    await engine.introduce(c.id);
    expect(prologues(engine, c.id)[0]!.payload).toMatchObject({ source: 'template' });
  });

  it('la demo sin situación ni máster: plantilla en tercera persona con el origen del punto de inicio', async () => {
    const { engine } = await bootEngine();
    const r = await engine.createCharacter('u9', 'Iria');
    if (!r.ok) throw new Error(r.reason);
    expect(await engine.introduce(r.character.id)).toBeNull();
    const [p] = prologues(engine, r.character.id);
    const spot = engine.world.characterSpot(r.character)!;
    const origin = engine.world.campaign.starting_points.find((x) => x.spot_id === spot.id)!.origin;
    expect(p!.narration_private).toContain(`Iria ${origin.charAt(0).toLowerCase()}${origin.slice(1, 30)}`);
    expect(p!.narration_private).toContain('ciudadela de Vharn');
    expect(wordCount(p!.narration_private)).toBeGreaterThanOrEqual(PROLOGUE_WORDS.min - 30);
  });
});

describe('Donde lo dejamos', () => {
  /** Kael habla con Brenna, debe dinero y lo deja ahí. */
  async function played() {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    const kael = engine.world.character('ch_kael');
    engine.events.emit({
      actor_id: kael.id, action_type: 'master', input_text: 'Pregunto a Brenna por la montaña', narration_private: 'Brenna deja el trapo sobre la barra y baja la voz.', observable: null,
      tags: ['master', 'social'], payload: { lines: [{ speaker: 'actor', text: '¿Qué pasa en la montaña?' }, { speaker: 'npc', npc_id: 'npc_brenna', text: 'Las cenizas se mueven. No subas de noche.' }], npc_id: 'npc_brenna' },
    }, time.now());
    const debt = setDebt(engine.world, kael, { npc_id: 'npc_brenna', amount: 300, reason: 'una noche de cama y cena', due_game_s: engine.gameNow() + 3 * GAME_DAY }, engine.gameNow());
    expect(debt.ok).toBe(true);
    return { engine, time, kael };
  }
  const recaps = (engine: Engine): GameEvent[] => engine.events.all().filter((e) => e.action_type === 'recap');

  it('aparece tras la ausencia y no antes, una sola vez, con lugar, último turno, deudas y lo que le dijeron', async () => {
    const { engine, time, kael } = await played();
    time.advanceReal(20 * 3600);
    expect(await engine.welcomeBack(kael.id, {})).toBeNull();
    // 20 h reales son 2,5 días de juego: ni las 72 h ni la semana de juego.
    time.advanceReal(53 * 3600);
    const e = await engine.welcomeBack(kael.id, {});
    expect(e).not.toBeNull();
    expect(e!.payload).toMatchObject({ title: RECAP_TITLE, source: 'template', away_hours: 73 });
    expect(e!.delivered_to).toEqual([{ character_id: kael.id, level: 'full' }]);
    const t = e!.narration_private;
    expect(t).toContain('Han pasado 3 días');
    expect(t).toContain(`Estás en ${engine.world.characterSpot(kael)!.name}`);
    expect(t).toContain('«Pregunto a Brenna por la montaña»');
    expect(t).toMatch(/Debes 3 de oro a Brenna/);
    expect(t).toContain('Brenna (tabernera) te dijo: «Las cenizas se mueven»');
    expect(t).toContain('**Entretanto.**');
    expect(t).toContain('El tablón de avisos ha cambiado.');
    expect(recaps(engine)).toHaveLength(1);
    // Ya ha vuelto: la siguiente apertura no repite.
    time.advanceReal(3600);
    expect(await engine.welcomeBack(kael.id, {})).toBeNull();
  });

  it('una semana de juego también cuenta, y el umbral de horas se configura', async () => {
    const a = await played();
    a.time.advanceGame(7 * GAME_DAY + 60);
    expect(await a.engine.welcomeBack(a.kael.id, {})).not.toBeNull();
    const b = await played();
    b.time.advanceReal(25 * 3600);
    expect(await b.engine.welcomeBack(b.kael.id, {})).toBeNull();
    expect(await b.engine.welcomeBack(b.kael.id, { RECAP_AFTER_HOURS: '24' })).not.toBeNull();
  });

  it('resume la misión principal con su reloj en un mundo generado; offline, el pulido se queda en plantilla', async () => {
    const { engine, time, c } = await generated();
    await engine.introduce(c.id);
    // Umbral bajo para que el reloj de la situación siga corriendo.
    time.advanceReal(2 * 3600);
    const e = await engine.welcomeBack(c.id, { RECAP_POLISH: 'on', RECAP_AFTER_HOURS: '1' });
    expect(e!.payload).toMatchObject({ source: 'template' });
    expect(e!.narration_private).toContain('**Lo que tienes entre manos.** Lo que te trae aquí:');
    expect(e!.narration_private).toMatch(/quedan \d+ días? \(vence el /);
    for (const truth of engine.world.campaign.bible!) expect(e!.narration_private).not.toContain(truth);
  });

  it('con RECAP_POLISH=on y máster en vivo, el máster lo cuenta en prosa', async () => {
    const prose = 'Vuelves a la taberna donde lo dejaste. '.repeat(12);
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.attachMaster(new Master(engine, { client: writer(prose) }));
    engine.events.emit({ actor_id: 'ch_kael', action_type: 'master', input_text: 'Miro el fuego', narration_private: 'El fuego crepita.', observable: null, tags: ['master'], payload: {} }, time.now());
    time.advanceReal(100 * 3600);
    const e = await engine.welcomeBack('ch_kael', { RECAP_POLISH: 'on' });
    expect(e!.payload).toMatchObject({ source: 'master' });
    expect(e!.narration_private).toBe(prose.trim());
  });
});
