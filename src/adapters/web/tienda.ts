/**
 * La tienda en la web (PLAN-OBJETOS §6.2): al estar en el local de un tendero (shop.ts), el panel enseña lo que le
 * queda, con existencias y precio para este PJ, y un botón de comprar que va por el atajo determinista del motor
 * (Engine.shopBuy), sin máster ni tokens. El regateo sigue yendo por el chat, al máster.
 *
 *   GET  /api/shop?character=ID                  la tienda de donde está el PJ, o { shop: null }
 *   POST /api/shop/buy {character, npc, item, quantity}   comprar: lo mismo que buy_item
 */

import type { Engine } from '../../engine/engine.js';
import type { Id } from '../../engine/model.js';
import { money } from '../../engine/money.js';
import { pcCoins, shopClosed, shopHere, shopLines } from '../../engine/shop.js';

export interface WebShopLine {
  item_id: Id;
  name: string;
  quantity: number;
  price: string;
  /** Le llega el dinero para una. */
  affordable: boolean;
  description?: string;
  service?: boolean;
}

export interface WebShop {
  npc: { id: Id; name: string; role: string };
  /** Atiende ahora (dentro de su horario y en su tienda). */
  open: boolean;
  /** Por qué no atiende, en palabras del jugador. */
  closed?: string;
  /** El dinero del PJ, en monedas. */
  coins: string;
  lines: WebShopLine[];
}

export function shopView(engine: Engine, characterId: Id): { shop: WebShop | null } {
  const w = engine.world;
  const c = w.character(characterId);
  const npc = shopHere(w, c);
  if (!npc) return { shop: null };
  const nowG = engine.nowFor(c);
  const away = w.spots.get(npc.location.id)?.location_id !== npc.shop!.location_id ? `${npc.name} no está en la tienda` : null;
  const closed = away ?? shopClosed(npc, nowG);
  const have = pcCoins(w, c);
  // El nombre solo si el PJ ya le conoce; si no, su oficio.
  const name = c.knows.includes(npc.id) ? npc.name : (npc.role_short ?? npc.role);
  return {
    shop: {
      npc: { id: npc.id, name, role: npc.role },
      open: !closed,
      ...(closed ? { closed: `${closed.charAt(0).toUpperCase()}${closed.slice(1)}.`.replaceAll(npc.name, name) } : {}),
      coins: money(w, have),
      lines: shopLines(w, npc, c).map((l) => ({
        item_id: l.item_id, name: l.name, quantity: l.quantity, price: money(w, l.price), affordable: have >= l.price,
        ...(l.description ? { description: l.description } : {}), ...(l.service ? { service: true } : {}),
      })),
    },
  };
}

export const SHOP_STYLE = String.raw`
  #shop-side:empty { display: none; }
  body.col-shop #shop-side .sec-b { display: none; }
  body.col-shop #shop-side .sec-t .chev { transform: none; }
  #shop-side .shop-who { margin: 0 16px 6px; font-size: 12.5px; color: var(--muted); }
  #shop-side .shop-who b { color: var(--text); font-weight: 600; }
  #shop-side .shop-closed { margin: 0 16px 8px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.04); font-size: 12.5px; color: var(--muted); }
  #shop-side .shop-row { display: flex; align-items: center; gap: 10px; padding: 8px 14px 8px 16px; border-bottom: 1px solid rgba(255,255,255,.05); }
  #shop-side .shop-row .tt { min-width: 0; flex: 1; }
  #shop-side .shop-row .tt b { display: block; font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #shop-side .shop-row .tt small { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #shop-side .shop-row .pr { flex: none; font-size: 12.5px; color: var(--accent); text-align: right; }
  #shop-side .shop-buy { flex: none; height: 30px; padding: 0 12px; border: 1px solid rgba(230,183,90,.45); border-radius: 999px; background: var(--accent-tint); color: var(--accent); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  #shop-side .shop-buy:hover:not(:disabled) { background: rgba(230,183,90,.24); }
  #shop-side .shop-buy:disabled { opacity: .45; cursor: default; }
  #shop-side .shop-msg { margin: 6px 16px 10px; font-size: 12.5px; color: var(--muted); }
  #shop-side .shop-msg.err { color: #e98f7f; }
  #shop-side .shop-empty { margin: 4px 16px 10px; font-size: 13px; color: var(--muted); }
`;

export const SHOP_JS = String.raw`
  // --- Tienda (tienda.ts): lo que le queda al tendero del sitio, con precio y un botón de comprar sin máster. ---
  var shopSeq = 0, shopNote = '', shopNoteErr = false, shopBusy = false;
  function renderShop(s) {
    var box = $('shop-side');
    if (!s) { box.innerHTML = ''; shopNote = ''; return; }
    var h = '<button type="button" class="sec-t" data-col="shop" aria-expanded="' + !document.body.classList.contains('col-shop') + '"><svg class="i chev"><use href="#i-chev"/></svg>Tienda<span>' + (s.open ? 'Abierta' : 'Cerrada') + '</span></button><div class="sec-b">';
    h += '<p class="shop-who">Atiende <b>' + escapeHtml(s.npc.name) + '</b>. Llevas ' + escapeHtml(s.coins) + '.</p>';
    if (!s.open && s.closed) h += '<p class="shop-closed">' + escapeHtml(s.closed) + '</p>';
    if (!s.lines.length) h += '<p class="shop-empty">No le queda nada que vender.</p>';
    s.lines.forEach(function (l) {
      var sub = l.service ? 'Servicio' : (l.quantity === 1 ? 'Le queda 1' : 'Le quedan ' + l.quantity);
      h += '<div class="shop-row"><span class="tt"><b>' + escapeHtml(l.name) + '</b><small title="' + escapeHtml(l.description || '') + '">' + escapeHtml(sub) + (l.description ? ': ' + escapeHtml(l.description) : '') + '</small></span>' +
        '<span class="pr">' + escapeHtml(l.price) + '</span>' +
        '<button type="button" class="shop-buy" data-buy="' + escapeHtml(l.item_id) + '" data-npc="' + escapeHtml(s.npc.id) + '"' + (!s.open || !l.affordable || shopBusy ? ' disabled' : '') + ' title="' + (l.affordable ? 'Comprar uno' : 'No te llega') + '">Comprar</button></div>';
    });
    if (shopNote) h += '<p class="shop-msg' + (shopNoteErr ? ' err' : '') + '">' + escapeHtml(shopNote) + '</p>';
    box.innerHTML = h + '</div>';
  }
  function loadShop() {
    if (!current) return;
    var seq = ++shopSeq, id = current;
    fetch(api('/api/shop?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; }).then(function (r) {
      if (id !== current || seq !== shopSeq || !r) return;
      renderShop(r.shop);
    }).catch(function () {});
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#shop-side [data-buy]');
    if (!b || b.disabled || shopBusy) return;
    shopBusy = true;
    document.querySelectorAll('#shop-side [data-buy]').forEach(function (x) { x.disabled = true; });
    post('/api/shop/buy', { npc: b.getAttribute('data-npc'), item: b.getAttribute('data-buy'), quantity: 1 }).then(function (r) {
      shopBusy = false;
      shopNote = r.text || ''; shopNoteErr = !r.ok;
      loadShop();
    });
  });
`;
