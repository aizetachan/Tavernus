/**
 * La sección «Lleva encima» de las fichas de personaje de la wiki, generada de los datos del juego al construirla
 * (PLAN-OBJETOS §7): así no se desfasa cuando cambia el ajuar (src/engine/outfit.ts) o lo que la campaña escrita
 * pone encima de cada vecino. La ficha dice qué NPC es con `npc: npc_hugo` en sus propiedades; lo que haya escrito en
 * su sección «Lleva encima» se sustituye al construir.
 *
 * Los datos son los de una partida recién empezada: la campaña escrita expandida y el ajuar aplicado, como hace el
 * motor al arrancar (engine.ts, `migrate`).
 */

import { BREZAL } from '../data/campaigns/brezal/index.js';
import { expandAuthored } from '../data/campaigns/format.js';
import type { Id, ItemInstance, WorldSnapshot } from '../engine/model.js';
import { currencyOf, fmtMoney } from '../engine/money.js';
import { coinsIn, isWorn, outfitNpcs } from '../engine/outfit.js';

/** Lo que lleva un NPC, en Markdown; `null` si el NPC no existe. */
export type CarriesFn = (npcId: Id) => string | null;

const MECHANICS = 'Se le puede robar o encontrar al registrarle. Ver [[Mecánicas#Inventario y carga]].';
const GENERATED = '*Sale de los datos del juego al construir la wiki: lo de «el ajuar» se lo da su oficio (src/engine/outfit.ts); lo de «la historia», la campaña (src/data/campaigns/brezal/items.ts).*';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** La tabla de lo que lleva un NPC en un mundo ya equipado, o `null` si no existe. */
export function carriesMarkdown(snap: WorldSnapshot, npcId: Id): string | null {
  if (!snap.npcs.some((n) => n.id === npcId)) return null;
  const defs = new Map(snap.item_defs.map((d) => [d.id, d]));
  const cur = currencyOf(snap.campaign);
  const rows: string[] = [];
  const walk = (p: { type: 'npc' | 'container'; id: Id }, where: string) => {
    const here = snap.item_instances.filter((i) => i.location.type === p.type && i.location.id === p.id);
    // Primero lo puesto, después lo demás, en el orden de los datos.
    const sorted = [...here.filter(isWorn), ...here.filter((i) => !isWorn(i))];
    for (const i of sorted) {
      const d = defs.get(i.item_id);
      if (!d) continue;
      const at = isWorn(i) ? 'puesto' : p.type === 'npc' && d.equip_slot === 'belt' ? 'al cinto' : where;
      const coins = coinsIn(i);
      const detail = coins ? fmtMoney(coins, cur) : fromStory(i) ? d.description ?? '' : '';
      rows.push(`| ${cell(d.name)}${i.quantity > 1 ? ` ×${i.quantity}` : ''} | ${at} | ${cell(detail)} | ${fromStory(i) ? 'la historia' : 'el ajuar'} |`);
      if (d.container) walk({ type: 'container', id: i.id }, d.equip_slot === 'belt' ? 'en la bolsa' : `dentro: ${d.name}`);
    }
  };
  walk({ type: 'npc', id: npcId }, 'encima');
  if (!rows.length) return `No lleva nada encima.\n\n${GENERATED}`;
  return ['| Qué | Dónde | Detalle | Lo pone |', '|---|---|---|---|', ...rows, '', MECHANICS, '', GENERATED].join('\n');
}

/** Lo escribe la campaña, no el ajuar (cuyos ejemplares son `ii_kit_…`). */
function fromStory(i: ItemInstance): boolean { return !i.id.startsWith('ii_kit_'); }

/** Un mundo de Brezal recién empezado, con el ajuar puesto. */
export function brezalOutfitted(): WorldSnapshot {
  const snap = expandAuthored(BREZAL, new Date(Date.UTC(2026, 0, 1)));
  outfitNpcs(snap);
  return snap;
}

/** Lo que lleva cada NPC de Brezal (la wiki es la de Brezal). El mundo se construye una vez, al primer uso. */
export function carriesOf(): CarriesFn {
  let snap: WorldSnapshot | null = null;
  return (npcId) => carriesMarkdown(snap ??= brezalOutfitted(), npcId);
}

/**
 * Sustituye el contenido de una sección `## título` (hasta la siguiente de nivel 1 o 2). Si la página no la tiene,
 * la añade antes de «Relaciones», o al final.
 */
export function replaceSection(md: string, title: string, content: string): string {
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  const heading = (l: string) => /^#{1,2}\s/.test(l);
  const block = [`## ${title}`, '', ...content.split('\n'), ''];
  const at = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (at >= 0) {
    let end = at + 1;
    while (end < lines.length && !heading(lines[end]!)) end++;
    return [...lines.slice(0, at), ...block, ...lines.slice(end)].join(eol);
  }
  const before = lines.findIndex((l) => l.trim() === '## Relaciones');
  if (before >= 0) return [...lines.slice(0, before), ...block, ...lines.slice(before)].join(eol);
  return [...lines, '', ...block].join(eol);
}
