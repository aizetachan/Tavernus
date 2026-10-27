/**
 * Dinero. El valor se guarda en la moneda más pequeña (`Character.coins`, los
 * precios y las recompensas: cobre, como el catálogo SRD), pero se cuenta, se
 * pesa y se enseña en monedas de cada valor: 1500 son 15 de oro, no mil
 * quinientas piezas en el bolsillo (partida del 27-10: 1700 monedas pesaban
 * 34 lb y dejaban «cargado» a un mago al empezar).
 *
 * Cada campaña puede traer las suyas (`campaign.currency`, de mayor a menor
 * valor; la última vale 1). Sin ellas, las del SRD: oro = 10 de plata = 100 de
 * cobre. Se lleva siempre el menor número de monedas posible (el cambio se da
 * solo), y eso es lo que pesa.
 */

export interface Denomination {
  /** Metal o nombre de la moneda, en singular: «oro», «plata», «cobre». */
  name: string;
  /** Lo que vale en la moneda más pequeña. */
  value: number;
}

export const DEFAULT_CURRENCY: readonly Denomination[] = [
  { name: 'oro', value: 100 },
  { name: 'plata', value: 10 },
  { name: 'cobre', value: 1 },
];

/** Con lo que empieza un PJ nuevo si la campaña no dice otra cosa: unas pocas monedas (1 de oro y 5 de plata). */
export const DEFAULT_STARTING_COINS = 150;

/** Las monedas de la campaña, de mayor a menor valor. */
export function currencyOf(campaign: { currency?: readonly Denomination[] } | null | undefined): readonly Denomination[] {
  const cur = campaign?.currency?.filter((d) => d.value >= 1);
  return cur?.length ? [...cur].sort((a, b) => b.value - a.value) : DEFAULT_CURRENCY;
}

/** Cuántas monedas de cada valor hacen `total`, con el menor número de piezas. Solo las que hay. */
export function coinBreakdown(total: number, cur: readonly Denomination[] = DEFAULT_CURRENCY): { name: string; count: number }[] {
  let left = Math.max(0, Math.round(total));
  const out: { name: string; count: number }[] = [];
  for (const d of cur) {
    const n = Math.floor(left / d.value);
    if (n > 0) { out.push({ name: d.name, count: n }); left -= n * d.value; }
  }
  return out;
}

/** Piezas que hay en la bolsa: lo que pesa. */
export function coinPieces(total: number, cur: readonly Denomination[] = DEFAULT_CURRENCY): number {
  return coinBreakdown(total, cur).reduce((a, x) => a + x.count, 0);
}

/** «15 de oro», «2 de plata y 4 de cobre», «1 de oro, 3 de plata y 2 de cobre»; «nada» si es 0. */
export function fmtMoney(total: number, cur: readonly Denomination[] = DEFAULT_CURRENCY): string {
  const parts = coinBreakdown(total, cur).map((x) => `${x.count} de ${x.name}`);
  if (!parts.length) return 'nada';
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Dinero en lo que escribe el jugador: «3 de oro», «2 monedas de plata y 5 de
 * cobre», «10 oro». Un número con «monedas» a secas va en la moneda más
 * pequeña («20 monedas»). null si no habla de dinero.
 */
export function parseMoney(text: string, cur: readonly Denomination[] = DEFAULT_CURRENCY): number | null {
  const t = norm(text);
  const names = cur.map((d) => norm(d.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let total = 0;
  let found = false;
  const re = new RegExp(`(\\d+)\\s*(?:monedas?\\s+|piezas?\\s+)?(?:de\\s+)?(${names.join('|')})\\b`, 'g');
  for (const m of t.matchAll(re)) {
    const d = cur[names.indexOf(m[2]!)]!;
    total += Number(m[1]) * d.value;
    found = true;
  }
  if (found) return total;
  const plain = /(\d+)\s*(?:monedas?|mo|piezas?)\b/.exec(t);
  return plain ? Number(plain[1]) : null;
}

/** fmtMoney con las monedas de la campaña del mundo. */
export function money(world: { campaign: { currency?: readonly Denomination[] } }, total: number): string {
  return fmtMoney(total, currencyOf(world.campaign));
}
