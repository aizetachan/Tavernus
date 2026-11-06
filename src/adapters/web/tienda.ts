/**
 * La tienda en la web (PLAN-OBJETOS §6.2). Se compra hablando con el tendero, por el máster (buy_item). Además, para
 * ahorrar tokens: estando en su local, el panel lateral trae un botón «Ver lo que vende» que pone en el chat una
 * burbuja de tienda con lo que le queda, existencias y precio para este PJ, y un botón de comprar por el atajo
 * determinista del motor (Engine.shopBuy), sin máster. El regateo sigue yendo por el chat, al máster.
 *
 *   GET  /api/shop?character=ID                  la tienda de donde está el PJ, o { shop: null }
 *   POST /api/shop/buy {character, npc, item, quantity}   comprar: lo mismo que buy_item
 */

import type { Engine } from '../../engine/engine.js';
import type { Id } from '../../engine/model.js';
import { coinsOf, money } from '../../engine/money.js';
import { shopClosed, shopHere, shopLines } from '../../engine/shop.js';

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
  const have = coinsOf(w, c.id);
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
  #shop-side .shop-who { margin: 0 16px 8px; font-size: 12.5px; color: var(--muted); }
  #shop-side .shop-who b { color: var(--text); font-weight: 600; }
  #shop-side .shop-open { display: flex; align-items: center; gap: 8px; height: 34px; margin: 0 16px 12px; padding: 0 14px; border: 1px solid rgba(230,183,90,.45); border-radius: 999px; background: var(--accent-tint); color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
  #shop-side .shop-open:hover { background: rgba(230,183,90,.24); }
  #shop-side .shop-open svg { width: 15px; height: 15px; }
  .msg.info.shop { max-width: min(520px, calc(100% - 44px)); }
  .msg.info.shop .shop-who { margin: 0 0 6px; color: var(--muted); font-size: 12.5px; }
  .msg.info.shop .shop-closed { margin: 0 0 6px; padding: 6px 9px; border-radius: 8px; background: rgba(255,255,255,.04); font-size: 12.5px; color: var(--muted); }
  .msg.info.shop .shop-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid rgba(255,255,255,.06); }
  .msg.info.shop .shop-row .tt { min-width: 0; flex: 1; }
  .msg.info.shop .shop-row .tt b { display: block; font-size: 13.5px; font-weight: 500; }
  .msg.info.shop .shop-row .tt small { display: block; margin-top: 1px; font-size: 12px; color: var(--muted); }
  .msg.info.shop .shop-row .pr { flex: none; font-size: 12.5px; color: var(--accent); text-align: right; }
  .msg.info.shop .shop-buy { flex: none; height: 28px; padding: 0 11px; border: 1px solid rgba(230,183,90,.45); border-radius: 999px; background: var(--accent-tint); color: var(--accent); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .msg.info.shop .shop-buy:hover:not(:disabled) { background: rgba(230,183,90,.24); }
  .msg.info.shop .shop-buy:disabled { opacity: .45; cursor: default; }
  .msg.info.shop .shop-msg { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
  .msg.info.shop .shop-msg.err { color: #e98f7f; }
  .msg.info.shop .shop-foot { margin: 6px 0 0; font-size: 12px; color: var(--faint); }
  .msg.info.shop.old .shop-buy { display: none; }
`;

export const SHOP_JS = String.raw`
  // --- Tienda (tienda.ts): en el lateral, quién atiende y un botón que pone en el chat la burbuja de tienda; desde
  // ella se compra sin máster. Comprar hablándole también vale: eso va al narrador. ---
  var shopSeq = 0, shopBusy = false, shopBubble = null;
  function renderShopSide(s) {
    var box = $('shop-side');
    if (!s) { box.innerHTML = ''; return; }
    box.innerHTML = '<button type="button" class="sec-t" data-col="shop" aria-expanded="' + !document.body.classList.contains('col-shop') + '"><svg class="i chev"><use href="#i-chev"/></svg>Tienda<span>' + (s.open ? 'Abierta' : 'Cerrada') + '</span></button><div class="sec-b">' +
      '<p class="shop-who">Atiende <b>' + escapeHtml(s.npc.name) + '</b>. Llevas ' + escapeHtml(s.coins) + '.</p>' +
      '<button type="button" class="shop-open" data-shop-open><svg class="i"><use href="#i-coin"/></svg>Ver lo que vende</button></div>';
  }
  function shopBubbleHtml(s, note, err) {
    var h = '<div class="body"><div class="hd"><svg class="i"><use href="#i-coin"/></svg>Lo que vende ' + escapeHtml(s.npc.name) + '<small>tienda</small></div>';
    h += '<p class="shop-who">Llevas ' + escapeHtml(s.coins) + '.</p>';
    if (!s.open && s.closed) h += '<p class="shop-closed">' + escapeHtml(s.closed) + '</p>';
    if (!s.lines.length) h += '<p class="shop-closed">No le queda nada que vender.</p>';
    s.lines.forEach(function (l) {
      var sub = l.service ? 'Servicio' : (l.quantity === 1 ? 'Le queda 1' : 'Le quedan ' + l.quantity);
      h += '<div class="shop-row"><span class="tt"><b>' + escapeHtml(l.name) + '</b><small>' + escapeHtml(sub) + (l.description ? ': ' + escapeHtml(l.description) : '') + '</small></span>' +
        '<span class="pr">' + escapeHtml(l.price) + '</span>' +
        '<button type="button" class="shop-buy" data-buy="' + escapeHtml(l.item_id) + '" data-npc="' + escapeHtml(s.npc.id) + '"' + (!s.open || !l.affordable || shopBusy ? ' disabled' : '') + ' title="' + (l.affordable ? 'Comprar uno, sin narrador' : 'No te llega') + '">Comprar</button></div>';
    });
    if (note) h += '<p class="shop-msg' + (err ? ' err' : '') + '">' + escapeHtml(note) + '</p>';
    h += '<p class="shop-foot">Para regatear, díselo en el chat.</p>';
    return h + '</div>';
  }
  function fetchShop() {
    if (!current) return Promise.resolve(null);
    var id = current;
    return fetch(api('/api/shop?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (r) { return id === current && r ? r.shop : null; }).catch(function () { return null; });
  }
  /** El lateral; y la última burbuja, si sigue abierta, se pone al día (existencias, dinero, horario). */
  function loadShop() {
    var seq = ++shopSeq;
    fetchShop().then(function (s) {
      if (seq !== shopSeq) return;
      renderShopSide(s);
      if (shopBubble && !shopBubble.classList.contains('old')) {
        if (!s || s.npc.id !== shopBubble.getAttribute('data-npc')) shopBubble.classList.add('old');
        else shopBubble.innerHTML = shopBubbleHtml(s, shopBubble.getAttribute('data-note'), shopBubble.getAttribute('data-err') === '1');
      }
    });
  }
  /** Pone en el chat la burbuja de tienda (sin narrador ni tokens). La anterior se queda como estaba, sin botones. */
  function openShopBubble() {
    fetchShop().then(function (s) {
      if (!s) return;
      if (shopBubble) shopBubble.classList.add('old');
      var div = document.createElement('div');
      div.className = 'msg info shop';
      div.setAttribute('data-npc', s.npc.id);
      div.innerHTML = shopBubbleHtml(s, '', false);
      log.appendChild(div);
      shopBubble = div;
      scroll();
    });
  }
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('#shop-side [data-shop-open]')) { showSide(false); openShopBubble(); return; }
    var b = ev.target.closest && ev.target.closest('.msg.info.shop [data-buy]');
    if (!b || b.disabled || shopBusy) return;
    var bubble = b.closest('.msg.info.shop');
    shopBusy = true;
    bubble.querySelectorAll('[data-buy]').forEach(function (x) { x.disabled = true; });
    post('/api/shop/buy', { npc: b.getAttribute('data-npc'), item: b.getAttribute('data-buy'), quantity: 1 }).then(function (r) {
      shopBusy = false;
      bubble.setAttribute('data-note', r.ok ? '' : (r.text || 'No se puede.'));
      bubble.setAttribute('data-err', r.ok ? '0' : '1');
      loadShop();
    });
  });
`;
