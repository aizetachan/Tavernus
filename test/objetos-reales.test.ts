/**
 * Partida «Humo y ceniza» (05-11): el PJ le roba a Garrán una bolsa de cuero que no existía (el máster la describió
 * al mirarle el cinto, la tirada salió bien y luego no estaba en ningún sitio), y Brenna le pone una jarra delante
 * («Cuatro de cobre») sin cobrarla ni apuntarla, así que irse sin pagar no tiene consecuencia.
 */
import { describe, expect, it } from 'vitest';
import { actionContext } from '../src/ai/prompt.js';
import { servedWithoutPay, stolenWithoutTool } from '../src/engine/closecheck.js';
import { textSignals } from '../src/engine/talk.js';
import { bootEngine } from './helpers.js';

describe('robar solo de palabra', () => {
  it('el robo contado como hecho sin transfer_item se reescribe; con el objeto movido, en el intento o con la tirada pendiente, no', () => {
    const action = 'robarle también la bolsa de cuero';
    expect(stolenWithoutTool({ action, narration: 'La bolsa de cuero se suelta del cinto sin tirar de la correa y cae limpia a tu mano.', okTools: [] })).toBeTruthy();
    expect(stolenWithoutTool({ action: 'guardar la bolsa y salir de la mesa', narration: 'Te levantas con la bolsa escondida bajo la manga.', okTools: [] })).toBeNull();
    expect(stolenWithoutTool({ action: 'birlar la bolsa', narration: 'Te levantas con la bolsa escondida bajo la manga.', okTools: [] })).toBe('escondida bajo la manga');
    expect(stolenWithoutTool({ action, narration: 'La llave cae limpia a tu mano.', okTools: ['transfer_item'] })).toBeNull();
    expect(stolenWithoutTool({ action, narration: 'Acercas los dedos al cordel, despacio.', okTools: [], pendingRoll: true })).toBeNull();
    expect(stolenWithoutTool({ action, narration: 'Buscas en su cinto, pero no lleva ninguna bolsa: nada cae a tu mano.', okTools: [] })).toBeNull();
  });
});

describe('servir sin cobrar', () => {
  it('en un trato, entregar lo que vende sin buy_item ni set_debt se reescribe; decir solo el precio, no', () => {
    const narration = 'Brenna saca una jarra de barro del clavo. «Cuatro de cobre.» Te la pone delante con un golpe seco.';
    expect(servedWithoutPay({ narration, okTools: [], trade: true })).toBe('te la pone');
    expect(servedWithoutPay({ narration, okTools: ['buy_item'], trade: true })).toBeNull();
    expect(servedWithoutPay({ narration, okTools: ['set_debt'], trade: true })).toBeNull();
    expect(servedWithoutPay({ narration, okTools: [], trade: false })).toBeNull();
    expect(servedWithoutPay({ narration: 'Brenna te mira. «Cuatro de cobre, y te la pongo cuando pagues.»', okTools: [], trade: true })).toBeNull();
  });

  it('pedir algo de beber es comercio', () => {
    expect(textSignals('Pedir una jarra a la tabernera').trade).toBe(true);
    expect(textSignals('pido otra cerveza').trade).toBe(true);
    expect(textSignals('pedir trabajo a Brenna').trade).toBe(false);
  });
});

describe('lo que lleva un NPC es lo único que lleva', () => {
  it('el contexto dice lo que lleva y que no hay nada más, o que no lleva nada que se pueda coger', async () => {
    const { engine } = await bootEngine();
    const kael = engine.world.character('ch_kael');
    const brenna = engine.world.npc('npc_brenna');
    kael.location = { type: 'spot', id: brenna.location.id };
    for (const i of engine.world.itemsIn({ type: 'npc', id: brenna.id })) engine.world.itemInstances.delete(i.id);
    expect(actionContext(engine, kael, 'Miro el delantal de Brenna')).toContain('No lleva nada que se pueda coger o robar: ni bolsas, ni monedas, ni llaves.');
  });
});
