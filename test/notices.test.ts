import { describe, expect, it } from 'vitest';
import { noticeOf, webNotice } from '../src/adapters/web/notice.js';
import { toMessage } from '../src/adapters/web/server.js';
import type { Delivery } from '../src/engine/events.js';
import type { MasterLike } from '../src/engine/engine.js';
import { spawnItem } from '../src/engine/inventory.js';
import type { GameEvent } from '../src/engine/model.js';
import { threadKind } from '../src/engine/notices.js';
import { bootEngine, fakeTime } from './helpers.js';

const ACTOR = 'ch_leodhin';
const OTHER = 'ch_miau';

/** Un evento mínimo con la forma de los de la partida del 2026-10-26. */
function ev(action_type: string, narration_private: string, observable: string | null, extra: Partial<GameEvent> = {}): GameEvent {
  return {
    id: 'ev_1', seq: 1, timestamp_real_ms: 0, timestamp_game_s: 0, campaign_id: 'brezal', location_id: 'loc', spot_id: 'sp',
    actor_id: ACTOR, action_type, input_text: null, narration_private, observable, visibility: 'location', tags: [], delivered_to: [], payload: {},
    ...extra,
  };
}

/** Lo que lee cada uno: el actor su narración privada; el testigo lo observable. */
const forActor = (e: GameEvent) => noticeOf(e, ACTOR, e.narration_private);
const forWitness = (e: GameEvent) => noticeOf(e, OTHER, e.observable ?? '');

describe('aviso de sistema o narración (engine/notices.ts)', () => {
  it('quién entra, sale o se mueve es aviso para quien lo ve', () => {
    expect(forWitness(ev('npc_move', '', 'Doro se va del portón norte.', { actor_id: null }))).toEqual({ text: 'Doro se va del portón norte' });
    expect(forWitness(ev('arrived', '', 'Leodhin llega al pozo.'))).toEqual({ text: 'Leodhin llega al pozo' });
    expect(noticeOf(ev('arrived', '', 'Leodhin llega al pozo.'), OTHER, 'Una figura llega a la puerta.')).toEqual({ text: 'Una figura llega a la puerta' });
    expect(forWitness(ev('character_joined', '', 'Leodhin llega al pozo.'))).toEqual({ text: 'Leodhin llega al pozo' });
    expect(forWitness(ev('passed', 'Pasas por Plaza del Pozo.', 'Leodhin pasa por la puerta de la herrería.'))).toEqual({ text: 'Leodhin pasa por la puerta de la herrería' });
    expect(forWitness(ev('move', 'Te pones en camino hacia La herrería.', 'Leodhin se marcha hacia La herrería.'))).toEqual({ text: 'Leodhin se marcha hacia La herrería' });
    expect(forWitness(ev('away', '', 'Leodhin se ha ido; su personaje se queda en la barra.'))).toEqual({ text: 'Leodhin se ha ido; su personaje se queda en la barra.' });
    expect(forWitness(ev('back', '', 'Leodhin ha vuelto.'))).toEqual({ text: 'Leodhin ha vuelto' });
    expect(forWitness(ev('npc_join', 'Te unes a la conversación.', 'Leodhin se une a la conversación con Brenna.'))).toEqual({ text: 'Leodhin se une a la conversación con Brenna' });
    // «Alguien ha entrado en la sala»: la llegada que narra el máster es escena para quien llega y aviso para los demás.
    const arrival = ev('master_arrival', 'Cruzas el umbral de la herrería. El calor del horno te golpea la cara.', 'Leodhin entra en la taberna y se queda junto a la puerta.');
    expect(forActor(arrival)).toBeNull();
    expect(forWitness(arrival)).toEqual({ text: 'Leodhin entra en la taberna y se queda junto a la puerta' });
    // …salvo que alguien hable: entonces es escena, con sus burbujas.
    const greeted = ev('master_arrival', 'Entras.', 'Leodhin entra; Brenna le saluda.', { payload: { lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¡Pasa!' }] } });
    expect(forWitness(greeted)).toBeNull();
  });

  it('lo que el propio jugador hace sin escena (ponerse en camino, coger, esperar, descansar) es aviso', () => {
    expect(forActor(ev('move', 'Te pones en camino hacia La herrería.', 'Leodhin se marcha hacia La herrería.'))).toEqual({ text: 'Te pones en camino hacia La herrería' });
    expect(forActor(ev('passed', 'Pasas por Plaza del Pozo.', null))).toEqual({ text: 'Pasas por Plaza del Pozo' });
    expect(forActor(ev('take', 'Coges la jarra de cerveza y te la guardas.', null))).toEqual({ text: 'Coges la jarra de cerveza y te la guardas' });
    expect(forActor(ev('offer_accepted', 'Aceptas 3 monedas de Mira.', null))).toEqual({ text: 'Aceptas 3 monedas de Mira' });
    expect(forActor(ev('rest', 'Descansas una hora en la barra; son las 15:00.', null))).toEqual({ text: 'Descansas una hora en la barra; son las 15:00.' });
    expect(forActor(ev('arrived', 'Llegas a la barra.', null))).toEqual({ text: 'Llegas a la barra' });
    expect(forActor(ev('arrived', 'Has tardado 2 h; anochece. Llegas a la puerta.', null))).toEqual({ text: 'Has tardado 2 h; anochece. Llegas a la puerta.' });
  });

  it('una llegada que describe el sitio sigue siendo narración para quien llega', () => {
    expect(forActor(ev('arrived', 'Llegas a la barra. La madera huele a cerveza vieja.', null, { tags: ['movement', 'deterministic'] }))).toBeNull();
    expect(forActor(ev('arrived', 'Llegas a la plaza.\n**Plaza del Pozo** — el pozo.', null))).toBeNull();
    expect(threadKind(ev('arrived', 'Llegas a la plaza.\nSalidas: la herrería.', null), ACTOR)).toBe('narration');
  });

  it('tiradas: aviso con el tono del resultado', () => {
    expect(forActor(ev('roll', '🎲 Ataque con bastón: d20 [14] + 1 = 15 → impacta: 3 de daño', null))).toEqual({ text: '🎲 Ataque con bastón: d20 [14] + 1 = 15 → impacta: 3 de daño', tone: 'good' });
    expect(forActor(ev('death_save', '🎲 Salvación contra muerte: 4 → fallo. Éxitos 0/3 · fallos 1/3.', null))).toMatchObject({ tone: 'bad' });
    expect(forActor(ev('roll', '🎲 Persuasión: d20 [9] + 2 = 11', null))).toEqual({ text: '🎲 Persuasión: d20 [9] + 2 = 11' });
  });

  it('el progreso y el tablón llevan al Diario', () => {
    expect(forActor(ev('progress_clue', 'Pista: Ceniza en el agua del pozo (1/11). Reputación en Brezal: 2.', null)))
      .toEqual({ text: 'Pista: Ceniza en el agua del pozo (1/11)', link: 'ver en el Diario', tab: 'journal' });
    expect(forWitness(ev('board', '', '📜 Tablón de Brezal…', { actor_id: null, visibility: 'public' }))).toEqual({ text: 'Tablón actualizado', link: 'ver en el Diario', tab: 'journal' });
  });

  it('el máster, el diálogo, el ambiente y la escena siguen siendo narración', () => {
    expect(forActor(ev('master', 'Cruzas la sala hacia la barra.', 'Leodhin cruza la sala hacia la barra.'))).toBeNull();
    expect(forWitness(ev('master', 'Cruzas la sala hacia la barra.', 'Leodhin cruza la sala hacia la barra.'))).toBeNull();
    expect(forActor(ev('master_arrival', 'Cruzas el umbral de la herrería.', null))).toBeNull();
    expect(forActor(ev('master_roll_outcome', 'El bastón cae sobre el hombro de MIAU.', 'Leodhin descarga el bastón.'))).toBeNull();
    expect(forWitness(ev('say', 'Dices: «hola»', 'Leodhin dice: «hola»'))).toBeNull();
    expect(forWitness(ev('scheduled_start', '', 'Se llena el Jabalí: huele a guiso.', { actor_id: null }))).toBeNull();
    expect(forWitness(ev('down', 'Caes al suelo.', 'MIAU cae al suelo y no se mueve.'))).toBeNull();
    expect(forActor(ev('prologue', 'Veinte años después del incendio…', null))).toBeNull();
  });

  it('recoger: el actor recibe el aviso de lo que obtiene; los demás solo oyen el trabajo', () => {
    const e = ev('harvest', 'Obtienes trucha ×2 de el arroyo.', 'Leodhin trabaja en el arroyo.');
    expect(forActor(e)).toEqual({ text: 'Obtienes trucha ×2 de el arroyo' });
    expect(forWitness(e)).toBeNull();
  });

  it('cualquiera puede marcar un evento como aviso: payload.notice = all | others | actor', () => {
    const all = ev('combat_turn', 'Te toca.', 'Le toca a Leodhin.', { payload: { notice: 'all' } });
    expect(threadKind(all, ACTOR)).toBe('notice');
    expect(threadKind(all, OTHER)).toBe('notice');
    const others = ev('reaction', 'Frunces el ceño.', 'Leodhin frunce el ceño.', { payload: { notice: 'others' } });
    expect(threadKind(others, ACTOR)).toBe('narration');
    expect(threadKind(others, OTHER)).toBe('notice');
    const legacy = ev('custom', 'Esperas.', 'Leodhin espera.', { payload: { notice_for_others: true } });
    expect(threadKind(legacy, ACTOR)).toBe('narration');
    expect(threadKind(legacy, OTHER)).toBe('notice');
    expect(threadKind(ev('custom', 'Algo pasa.', null), ACTOR)).toBe('narration');
  });

  it('webNotice deja una línea limpia, sin negritas ni saltos, y sin punto si es una sola frase', () => {
    expect(webNotice('**Mira** ha\nentrado.')).toEqual({ text: 'Mira ha entrado' });
    expect(webNotice('Sale bien.', { tone: 'good' })).toEqual({ text: 'Sale bien', tone: 'good' });
    expect(webNotice('Vas hacia la barra. Llegas en 1 min.')).toEqual({ text: 'Vas hacia la barra. Llegas en 1 min.' });
    expect(webNotice('Esperas…')).toEqual({ text: 'Esperas…' });
  });
});

describe('aviso de sistema en el hilo de la web (toMessage)', () => {
  async function tavern() {
    const { engine } = await bootEngine(fakeTime(), { deterministic: true, rng: () => 0.99 });
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_mesa' };
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_chimenea' };
    const got: Delivery[] = [];
    engine.onDelivery((d) => got.push(d));
    const last = (id: string) => got.filter((d) => d.character_id === id).at(-1)!;
    return { engine, last };
  }

  it('ir a otro punto: el actor ve su mensaje y un aviso con las opciones; el testigo, solo el aviso', async () => {
    const { engine, last } = await tavern();
    engine.attachMaster({ resolve() { throw new Error('no debería llamarse al master'); } });
    await engine.act('ch_kael', 'Ir a la barra');
    const mine = toMessage(last('ch_kael'), engine);
    expect(mine.kind).toBe('system');
    expect(mine.narrator).toBeUndefined();
    expect(mine.text).toBe('');
    expect(mine.notice?.text).toMatch(/la barra/);
    expect(mine.input).toBe('Ir a la barra');
    expect(mine.suggested?.length).toBeGreaterThan(0);
    const seen = toMessage(last('ch_mira'), engine);
    expect(seen.notice).toEqual({ text: 'Kael se acerca a la barra' });
    expect(seen.narrator).toBeUndefined();
    expect(seen.reply_to).toBeUndefined();
  });

  it('coger un objeto es aviso; la narración del máster sigue en su burbuja', async () => {
    const { engine, last } = await tavern();
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_tab_barra' };
    expect(spawnItem(engine.world, 'it_cerveza', 1, { type: 'spot', id: 'sp_tab_barra' }).ok).toBe(true);
    const master: MasterLike = {
      async resolve() {
        return { ok: true, usage: {}, calls: [], context: '', model: 'stub', closed: { narration_private: 'Brenna te mira de arriba abajo.', observable: null, observable_vague: null, loudness: 1, tags: [], suggested_actions: [], requires_roll: null } };
      },
    };
    engine.attachMaster(master);
    await engine.act('ch_kael', 'coger la jarra');
    expect(toMessage(last('ch_kael'), engine).notice?.text).toMatch(/^Coges .*jarra de cerveza/);
    await engine.act('ch_kael', 'Miro a Brenna a los ojos');
    const told = toMessage(last('ch_kael'), engine);
    expect(told.notice).toBeUndefined();
    expect(told.narrator).toBe(true);
    expect(told.text).toBe('Brenna te mira de arriba abajo.');
  });
});
