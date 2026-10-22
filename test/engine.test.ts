import { describe, expect, it } from 'vitest';
import { GAME_HOUR } from '../src/clock/clock.js';
import type { Delivery } from '../src/engine/events.js';
import { regenState } from '../src/engine/resources.js';
import { spawnItem } from '../src/engine/inventory.js';
import { bootEngine, fakeTime } from './helpers.js';

function collect(engine: Awaited<ReturnType<typeof bootEngine>>['engine']) {
  const byChar = new Map<string, string[]>();
  engine.onDelivery((d: Delivery) => {
    const arr = byChar.get(d.character_id) ?? [];
    arr.push(d.text);
    byChar.set(d.character_id, arr);
  });
  return (id: string) => byChar.get(id) ?? [];
}

describe('Engine: fase 1 sin IA', () => {
  it('mirar describe desde los datos con hora, luz, gente, cosas y salidas', async () => {
    const { engine } = await bootEngine();
    const r = await engine.act('ch_kael', 'mirar');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Taberna del Jabalí');
    expect(r.text).toContain('la barra');
    expect(r.text).toContain('08:00');
    expect(r.text).toContain('Brenna (tabernera) aquí mismo');
    expect(r.text).toContain('Salidas: Plaza del Pozo desde la puerta, 3 m');
    expect(r.text).not.toContain('trampilla');
  });

  it('ir a un sitio por alias, con el tiempo y la llegada al pasar el reloj', async () => {
    const time = fakeTime();
    const { engine, repo } = await bootEngine(time);
    const seen = collect(engine);
    const r = await engine.act('ch_kael', 'voy a la mesa del fondo');
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/hacia la mesa del fondo andando\. Tardarás 4 s de juego \(1 s reales\)/);
    // Todavía no ha llegado.
    expect((await engine.command('ch_kael', '/where'))).toContain('la barra');
    time.advanceReal(2);
    await engine.tick();
    expect((await engine.command('ch_kael', '/where'))).toContain('la mesa del fondo');
    expect(seen('ch_kael').at(-1)).toBe('Llegas a la mesa del fondo.');
    // Se ha persistido el cambio del PJ y los eventos.
    expect(repo.writes.some((w) => w.collection === 'characters' && w.id === 'ch_kael')).toBe(true);
    expect(repo.events.map((e) => e.action_type)).toEqual(['board', 'move', 'arrived']);
  });

  it('sin viaje rápido, un viaje largo se vive por tramos y se puede parar', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time, { fastTravel: false });
    const seen = collect(engine);
    const r = await engine.act('ch_kael', 'ir al claro del roble');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('hacia el sendero');
    time.advanceGame(20);
    await engine.tick();
    // Ya cruzó la taberna y está en la plaza, de camino al portón.
    const where = await engine.command('ch_kael', '/where');
    expect(where).toContain('Plaza del Pozo');
    expect(seen('ch_kael')).toContain('Pasas por la puerta de la taberna.');
    const look = await engine.act('ch_kael', 'mirar');
    expect(look.text).toMatch(/Vas de camino hacia el portón norte/);
    const stop = await engine.act('ch_kael', 'me paro');
    expect(stop.text).toMatch(/Te detienes en/);
    expect(engine.world.character('ch_kael').transit).toBeNull();
  });

  it('coger, guardar, sacar y soltar con capacidad real', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_sendero' };
    let r = await engine.act('ch_kael', 'coger el hacha');
    expect(r.text).toBe('Coges hacha de leñador con la mano.');
    expect(await engine.command('ch_kael', '/inventory')).toContain('Manos: daga / hacha de leñador');
    r = await engine.act('ch_kael', 'guardar hacha en la mochila');
    expect(r.text).toBe('Guardas hacha de leñador en mochila.');
    r = await engine.act('ch_kael', 'soltar la daga');
    expect(r.text).toBe('Dejas daga en el suelo.');
    r = await engine.act('ch_kael', 'sacar cuerda de la mochila');
    expect(r.text).toBe('Sacas cuerda de cáñamo de mochila.');
    r = await engine.act('ch_kael', 'sacar hacha de la mochila');
    expect(r.ok).toBe(true);
    r = await engine.act('ch_kael', 'coger daga');
    expect(r.ok).toBe(true);
    // Dos manos ocupadas, bolsillos libres → al bolsillo.
    expect(r.text).toMatch(/bolsillo/);
    r = await engine.act('ch_kael', 'coger cuerda');
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/No ves nada llamado «cuerda»/);
    r = await engine.act('ch_kael', 'coger espada');
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/No ves nada llamado «espada»/);
  });

  it('un stack en el bolsillo no se fusiona con lo que llevas en la mano', async () => {
    const { engine } = await bootEngine();
    spawnItem(engine.world, 'it_antorcha', 1, { type: 'spot', id: 'sp_pl_pozo' });
    const r = await engine.act('ch_mira', 'coger antorcha');
    expect(r.ok).toBe(true);
    const inv = await engine.command('ch_mira', '/inventory');
    expect(inv).toContain('Manos: espada de Mira / antorcha');
    expect(inv).toContain('Bolsillos: antorcha');
  });

  it('el suelo es compartido: lo que uno deja, otro lo encuentra', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    await engine.act('ch_kael', 'soltar daga');
    const look = await engine.act('ch_mira', 'mirar');
    expect(look.text).toContain('Aquí hay: daga');
    const r = await engine.act('ch_mira', 'coger la daga');
    expect(r.ok).toBe(true);
    expect(engine.world.itemInstance('ii_kael_daga').location).toMatchObject({ type: 'character', id: 'ch_mira' });
  });

  it('talar necesita herramienta, agota el nodo y regenera con el reloj', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_cl_roble' };
    let r = await engine.act('ch_kael', 'talar el roble');
    expect(r.text).toMatch(/Necesitas hacha de leñador/);
    spawnItem(engine.world, 'it_hacha', 1, { type: 'container', id: 'ii_kael_mochila' });
    r = await engine.act('ch_kael', 'talar el roble');
    expect(r.text).toMatch(/Obtienes leña ×6 de el roble viejo/);
    r = await engine.act('ch_kael', 'talar roble');
    expect(r.text).toMatch(/agotado/);
    const node = engine.world.resourceNode('rn_roble');
    time.advanceGame(12 * GAME_HOUR);
    expect(regenState(node, engine.gameNow())).toBeCloseTo(0.5, 5);
    r = await engine.act('ch_kael', 'talar roble');
    expect(r.text).toMatch(/Obtienes leña ×3/);
    // Mira ve el estado compartido.
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_cl_roble' };
    const look = await engine.act('ch_mira', 'mirar');
    expect(look.text).toMatch(/el roble viejo, agotado/);
  });

  it('las bayas no se destruyen: solo bajan en proporción', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_cl_piedra' };
    const r = await engine.act('ch_mira', 'recolectar bayas');
    expect(r.text).toMatch(/bayas ×5/);
    expect(engine.world.resourceNode('rn_bayas').regen_state_at_harvest).toBe(0);
  });

  it('cada PJ recibe solo lo que percibe, con el texto de su banda', async () => {
    const { engine } = await bootEngine();
    const seen = collect(engine);
    // Mira en la mesa (mismo local que Kael, a 5.7 m): ve y oye todo.
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_mesa' };
    await engine.act('ch_kael', 'decir hola a todos');
    expect(seen('ch_kael')).toEqual(['Dices: «hola a todos»']);
    expect(seen('ch_mira')).toEqual(['Kael dice: «hola a todos»']);
    // Un susurro no llega a la mesa.
    await engine.act('ch_kael', 'susurrar secreto');
    expect(seen('ch_mira')).toHaveLength(1);
    // Mira en la plaza, Kael en la taberna: nada, ni gritando (otra localización).
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_pl_pozo' };
    await engine.act('ch_kael', 'gritar socorro');
    expect(seen('ch_mira')).toHaveLength(1);
    // Kael sale a la puerta de la taberna (plaza), Mira en el portón: 36 m → figura.
    engine.world.character('ch_kael').location = { type: 'spot', id: 'sp_pl_taberna' };
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_pl_porton' };
    await engine.act('ch_kael', 'ir al pozo');
    expect(seen('ch_mira').at(-1)).toBe('Una figura se aleja de la puerta de la taberna.');
    await engine.act('ch_kael', 'gritar eh tú');
    expect(seen('ch_mira').at(-1)).toBe('Kael grita: «eh tú»');
  });

  it('/who y /recap desde el punto de vista propio', async () => {
    const time = fakeTime();
    const { engine } = await bootEngine(time);
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_mesa' };
    expect(await engine.command('ch_kael', '/who')).toBe('Ves a: Mira.');
    await engine.act('ch_kael', 'decir hola');
    expect(await engine.command('ch_mira', '/recap')).toBe('No te has perdido nada.');
    // Mira se desconecta: se duerme donde está, con velo.
    engine.setConnected('ch_mira', false);
    expect(await engine.command('ch_kael', '/who')).toBe('Ves a: Mira (dormido).');
    await engine.act('ch_kael', 'decir buenas noches');
    await engine.act('ch_kael', 'soltar daga');
    const r = await engine.act('ch_mira', 'ir a la barra');
    expect(r.text).toMatch(/Estás dormido/);
    // Al volver, el recap cuenta lo que percibió dormida: a 5.7 m y con percepción ×0.2, solo lo vago.
    engine.setConnected('ch_mira', true);
    await engine.act('ch_mira', 'despierto');
    const recap = await engine.command('ch_mira', '/recap');
    expect(recap).toBe('· Oyes a alguien hablar cerca.\n· Una figura deja algo en el suelo.');
    // Un segundo recap ya no repite nada.
    expect(await engine.command('ch_mira', '/recap')).toBe('No te has perdido nada.');
  });

  it('desconectar pone el velo y duerme al PJ en el sitio', async () => {
    const { engine } = await bootEngine();
    engine.setConnected('ch_kael', false);
    const c = engine.world.character('ch_kael');
    expect(c.status).toBe('asleep');
    expect(c.veiled).toBe(true);
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    expect(await engine.command('ch_mira', '/look')).toContain('Kael aquí mismo, dormido (bajo un velo)');
    engine.setConnected('ch_kael', true);
    expect(c.veiled).toBe(false);
    expect(c.status).toBe('asleep');
  });

  it('dar un objeto a otro PJ en el mismo punto', async () => {
    const { engine } = await bootEngine();
    const seen = collect(engine);
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    const r = await engine.act('ch_kael', 'dar daga a Mira');
    expect(r.text).toBe('Le das daga a Mira.');
    expect(seen('ch_mira').at(-1)).toBe('Kael le da daga a Mira.');
    expect(await engine.command('ch_mira', '/inventory')).toContain('Manos: espada de Mira / daga');
  });

  it('ambigüedad: el servidor pregunta, no inventa', async () => {
    const { engine } = await bootEngine();
    engine.world.spot('sp_tab_chimenea').aliases.push('rincón');
    const r = await engine.act('ch_kael', 'ir al rincón');
    expect(r.ok).toBe(false);
    expect(r.text).toBe('¿Cuál? rincón / rincón');
  });

  it('las acciones de una misma localización se procesan en orden', async () => {
    const { engine } = await bootEngine();
    engine.world.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    // Los dos intentan coger la misma daga que Kael acaba de soltar: gana el primero de la cola.
    await engine.act('ch_kael', 'soltar daga');
    const [a, b] = await Promise.all([engine.act('ch_mira', 'coger daga'), engine.act('ch_kael', 'coger daga')]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(engine.world.itemInstance('ii_kael_daga').location).toMatchObject({ id: 'ch_mira' });
  });

  it('reinicia desde la persistencia sin repetir ticks ni perder estado', async () => {
    const time = fakeTime();
    const { engine, repo } = await bootEngine(time);
    await engine.act('ch_kael', 'ir a la mesa');
    time.advanceGame(10 * 60);
    await engine.tick();
    const snapshot = engine.world.snapshot();
    await repo.saveSnapshot(snapshot);
    const { Engine } = await import('../src/engine/engine.js');
    const engine2 = await Engine.boot({ repo, campaignId: 'demo', now: time.now });
    expect(engine2.events.lastSeq).toBe(engine.events.lastSeq);
    expect(await engine2.command('ch_kael', '/where')).toContain('la mesa del fondo');
    time.advanceGame(60);
    await engine2.tick();
    // El ticker de minuto retomó desde donde lo dejó: un tick, no diez.
    const ticker = await repo.loadTicker('demo', 'minute');
    expect(ticker!.last_tick_game_s).toBe(Math.floor(engine2.gameNow() / 60) * 60);
  });
});

describe('resolución de destinos lejanos', () => {
  it('desde la taberna, "ir al pozo" va al pozo de la plaza, no a la entrada', async () => {
    const { engine } = await bootEngine(fakeTime(), { fastTravel: false }); // la segunda orden se da aún desde la taberna
    const r = await engine.act('ch_kael', 'ir al pozo');
    expect(r.ok).toBe(true);
    expect(engine.world.character('ch_kael').transit!.destination_spot_id).toBe('sp_pl_pozo');
    // "la puerta" sigue siendo la de aquí, aunque la plaza tenga "la puerta de la taberna".
    const r2 = await engine.act('ch_kael', 'ir a la puerta');
    expect(engine.world.character('ch_kael').transit!.destination_spot_id).toBe('sp_tab_puerta');
    expect(r2.ok).toBe(true);
  });
});
