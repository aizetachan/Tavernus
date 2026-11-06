/**
 * Ajuar de los NPC: lo que cada persona lleva encima sin que la campaña lo
 * escriba. Partida «Humo y ceniza» (VPS, 2026-11): el PJ le robó a Garrán «la
 * bolsa de cuero» con buenas tiradas, pero la bolsa no existía; el máster la
 * inventó y luego no apareció en la mochila. Para que robar o registrar a
 * alguien tenga algo real, todo NPC que es una persona lleva al empezar:
 *
 *  - una bolsa (`purse`) con unas monedas dentro (`state.coins`, en la moneda
 *    más pequeña), según lo rico que sea su oficio;
 *  - dentro, dos o tres cosas personales de su oficio (navaja, yesca, llaves,
 *    hierbas, silbato, anillo de sello…);
 *  - su arma, si pelea y su ataque es un arma del catálogo («maza corta» → maza);
 *  - su ropa, puesta (`state.worn`), si su ajuar la dice: el mandil del herrero, la capa del regidor.
 *
 * Quien no lleva bolsa (`purse: false`, los niños) lleva sus cosas sueltas encima y ningún dinero.
 *
 * Regla agnóstica, generada de los datos: el ajuar sale del oficio (`Npc.role`,
 * por palabras) o de `Npc.kit` si la campaña lo dice; la riqueza, del ajuar o de
 * `Npc.wealth`; las monedas, de `campaign.starting_coins` (lo que lleva un PJ al
 * empezar) para que valga con cualquier moneda; los nombres, del género del
 * mundo (fantasía, ciencia ficción, postapocalíptico). Lo que la campaña ya le
 * da a un NPC manda: el ajuar solo completa lo que falta (una bolsa si no lleva
 * ninguna, cada cosa personal que no lleve ya, el arma si no lleva ninguna).
 *
 * Se aplica una vez por NPC al arrancar la partida (engine.ts, `migrate`), sea
 * campaña escrita, demo, mundo generado o partida ya empezada, y queda marcado
 * (`Npc.outfitted`, con la versión del ajuar): lo que le roben no se repone. Un NPC
 * equipado con una versión anterior solo recibe lo nuevo de la versión actual (la
 * ropa y lo que la campaña escrita le pone encima y la partida no tenía).
 *
 * Las monedas de una bolsa pasan al dinero del PJ en cuanto la coge
 * (inventory.ts, `transferItem`).
 */

import type { Id, ItemDef, ItemInstance, Npc, WorldSnapshot } from './model.js';

export type Wealth = NonNullable<Npc['wealth']>;
export type Genre = 'fantasy' | 'scifi' | 'postapoc';

/** Cosas del ajuar: una idea con su nombre en cada género. El id del objeto es `it_kit_<idea>`. */
type Concept =
  | 'purse' | 'knife' | 'fire' | 'food' | 'key' | 'keyring' | 'kerchief' | 'dice' | 'ring' | 'herbs' | 'bandage'
  | 'nails' | 'whistle' | 'beads' | 'charm' | 'ledger' | 'hook' | 'needle'
  | 'toy'
  | 'clothes' | 'fine' | 'apron' | 'robe' | 'tabard' | 'cloak' | 'rags'
  | 'spear' | 'club' | 'scimitar' | 'hammer' | 'pitchfork';

type Base = Omit<ItemDef, 'id' | 'name' | 'aliases' | 'origin' | 'unique'>;
const tiny = (type: ItemDef['type'], weight_lb: number, value: number, extra: Partial<ItemDef> = {}): Base => ({ type, size: 'tiny', weight_lb, value, ...extra });
/** Ropa: se lleva en el cuerpo (un PJ puede ponérsela). */
const wear = (weight_lb: number, value: number): Base => ({ type: 'gear', subtype: 'clothes', size: 'medium', weight_lb, value, equip_slot: 'body' });

/** Nombre (y alias) en cada género; sin variante, el de fantasía. */
type Names = Record<'fantasy', [string, string[]]> & Partial<Record<Exclude<Genre, 'fantasy'>, [string, string[]]>>;

const KIT_ITEMS: Record<Concept, { base: Base; names: Names; description: string }> = {
  purse: {
    base: { type: 'container', size: 'small', weight_lb: 0.5, value: 5, equip_slot: 'belt', container: { slots: 6, max_weight_lb: 3, max_size: 'tiny' } },
    names: { fantasy: ['bolsa de cuero', ['bolsa', 'faltriquera', 'monedero', 'bolsa de dinero', 'bolsita']], scifi: ['riñonera', ['bolsa', 'monedero', 'rinonera']], postapoc: ['riñonera de lona', ['bolsa', 'riñonera', 'rinonera']] },
    description: 'Se lleva al cinto: monedas y cosas pequeñas.',
  },
  knife: { base: tiny('tool', 0.3, 5, { weapon: { damage: '1d4', damage_type: 'piercing', finesse: true } }), names: { fantasy: ['navaja', ['navajita', 'cortaplumas']], scifi: ['navaja multiusos', ['navaja', 'multiusos']], postapoc: ['navaja oxidada', ['navaja']] }, description: 'Para cortar cuerda, pan o lo que haga falta.' },
  fire: { base: tiny('tool', 0.2, 2), names: { fantasy: ['yesca y pedernal', ['yesca', 'pedernal', 'eslabón']], scifi: ['encendedor', ['mechero', 'encendedor']], postapoc: ['mechero', ['encendedor', 'mechero']] }, description: 'Para encender fuego.' },
  food: { base: tiny('consumable', 0.3, 1), names: { fantasy: ['mendrugo de pan', ['mendrugo', 'pan', 'pan duro']], scifi: ['barrita de proteínas', ['barrita', 'proteinas']], postapoc: ['lata de conserva', ['lata', 'conserva']] }, description: 'Algo de comer para el camino.' },
  key: { base: tiny('tool', 0.1, 1), names: { fantasy: ['llave de hierro', ['llave', 'llave de casa']], scifi: ['tarjeta de acceso', ['tarjeta', 'llave']], postapoc: ['llave oxidada', ['llave']] }, description: 'La llave de su casa.' },
  keyring: { base: tiny('tool', 0.4, 3), names: { fantasy: ['manojo de llaves', ['llaves', 'llavero', 'manojo']], scifi: ['llavero de tarjetas', ['tarjetas', 'llavero', 'llaves']], postapoc: ['manojo de llaves', ['llaves', 'llavero']] }, description: 'Las llaves de lo que guarda.' },
  kerchief: { base: tiny('misc', 0.1, 1), names: { fantasy: ['pañuelo', ['panuelo', 'trapo']], postapoc: ['trapo anudado', ['trapo', 'pañuelo']] }, description: 'Un pañuelo usado.' },
  dice: { base: tiny('misc', 0.1, 2), names: { fantasy: ['dados de hueso', ['dados', 'dado']], scifi: ['dados', ['dado']], postapoc: ['dados', ['dado']] }, description: 'Para jugarse algo.' },
  ring: { base: tiny('treasure', 0.1, 500), names: { fantasy: ['anillo de sello', ['anillo', 'sello', 'sortija']], scifi: ['anillo de oro', ['anillo']], postapoc: ['anillo de oro', ['anillo']] }, description: 'Vale dinero, y su dueño lo echaría en falta.' },
  herbs: { base: tiny('consumable', 0.1, 5), names: { fantasy: ['manojo de hierbas secas', ['hierbas', 'hierbas secas', 'manojo de hierbas']], scifi: ['inyector de calmante', ['inyector', 'calmante']], postapoc: ['pastillas sin etiqueta', ['pastillas']] }, description: 'Remedio casero: alivia, no cura heridas.' },
  bandage: { base: tiny('consumable', 0.2, 5), names: { fantasy: ['vendas de lino', ['vendas', 'venda']], scifi: ['parche cicatrizante', ['parche']], postapoc: ['vendas', ['venda']] }, description: 'Para vendar una herida.' },
  nails: { base: tiny('misc', 0.5, 2), names: { fantasy: ['puñado de clavos', ['clavos', 'clavo']], scifi: ['puñado de tornillos', ['tornillos', 'tornillo']], postapoc: ['puñado de tornillos', ['tornillos', 'clavos']] }, description: 'Clavos sueltos del taller.' },
  whistle: { base: tiny('tool', 0.1, 2), names: { fantasy: ['silbato de hueso', ['silbato', 'pito']], scifi: ['silbato', ['pito']], postapoc: ['silbato', ['pito']] }, description: 'Para dar la alarma.' },
  beads: { base: tiny('misc', 0.1, 3), names: { fantasy: ['cuentas de rezo', ['cuentas', 'rosario']] }, description: 'Para rezar.' },
  charm: { base: tiny('misc', 0.1, 3), names: { fantasy: ['amuleto de hueso', ['amuleto', 'talismán', 'talisman']], scifi: ['amuleto', ['talismán']], postapoc: ['amuleto de chapa', ['amuleto', 'chapa']] }, description: 'Un amuleto de la suerte.' },
  ledger: { base: { type: 'misc', size: 'small', weight_lb: 0.5, value: 5 }, names: { fantasy: ['libreta de cuentas', ['libreta', 'cuentas', 'cuaderno']], scifi: ['tableta de cuentas', ['tableta', 'cuentas']], postapoc: ['cuaderno de cuentas', ['cuaderno', 'cuentas']] }, description: 'Quién debe qué y cuánto.' },
  hook: { base: tiny('tool', 0.1, 2), names: { fantasy: ['sedal y anzuelos', ['sedal', 'anzuelos', 'anzuelo']] }, description: 'Para pescar.' },
  needle: { base: tiny('tool', 0.1, 2), names: { fantasy: ['hilo y aguja', ['aguja', 'hilo']] }, description: 'Para remendar.' },
  toy: { base: tiny('misc', 0.1, 1), names: { fantasy: ['peonza de madera', ['peonza', 'trompo', 'juguete']], scifi: ['canicas de cristal', ['canicas', 'juguete']], postapoc: ['muñeco de trapo', ['muñeco', 'juguete']] }, description: 'Un juguete gastado de tanto usarlo.' },
  // Ropa: la lleva puesta (`state.worn`), para que se pueda describir, manchar o quitar.
  clothes: { base: wear(3, 50), names: { fantasy: ['ropa de diario', ['ropa', 'blusón', 'camisa']], scifi: ['mono de trabajo', ['mono', 'ropa']], postapoc: ['ropa remendada', ['ropa', 'harapos']] }, description: 'La ropa de todos los días.' },
  fine: { base: wear(6, 1500), names: { fantasy: ['capa de buen paño', ['capa', 'ropa fina', 'paño']], scifi: ['traje de corte caro', ['traje', 'ropa']], postapoc: ['abrigo de cuero bueno', ['abrigo', 'ropa']] }, description: 'Ropa que dice cuánto tiene su dueño.' },
  apron: { base: wear(3, 100), names: { fantasy: ['mandil de cuero', ['mandil', 'delantal']], scifi: ['delantal de trabajo', ['delantal', 'mandil']], postapoc: ['mandil de cuero', ['mandil', 'delantal']] }, description: 'Mandil de trabajo, con las manchas del oficio.' },
  robe: { base: wear(4, 100), names: { fantasy: ['hábito', ['habito', 'túnica', 'tunica', 'sotana']], scifi: ['túnica', ['tunica', 'hábito']], postapoc: ['túnica', ['tunica', 'hábito']] }, description: 'La ropa de su fe.' },
  tabard: { base: wear(3, 100), names: { fantasy: ['sobreveste de guardia', ['sobreveste', 'uniforme', 'jubón']], scifi: ['uniforme', ['uniforme', 'chaqueta']], postapoc: ['chaleco con brazalete', ['chaleco', 'brazalete', 'uniforme']] }, description: 'Lo que le distingue de un vecino cualquiera.' },
  cloak: { base: wear(4, 100), names: { fantasy: ['capa con capucha', ['capa', 'capucha', 'manto']], scifi: ['gabardina con capucha', ['gabardina', 'capucha']], postapoc: ['poncho con capucha', ['poncho', 'capucha']] }, description: 'Para no dejarse ver la cara.' },
  rags: { base: wear(2, 0), names: { fantasy: ['harapos', ['ropa', 'andrajos']] }, description: 'Lo que le queda de ropa.' },
  // Armas que el catálogo común no trae y los bloques SRD sí nombran (skeleton.ts, ARCHETYPES).
  spear: { base: { type: 'weapon', size: 'large', weight_lb: 3, value: 100, weapon: { damage: '1d6', damage_type: 'piercing' } }, names: { fantasy: ['lanza', ['spear', 'pica']] }, description: '' },
  club: { base: { type: 'weapon', size: 'small', weight_lb: 2, value: 10, weapon: { damage: '1d4', damage_type: 'bludgeoning' } }, names: { fantasy: ['garrote', ['porra', 'club', 'cachiporra']] }, description: '' },
  scimitar: { base: { type: 'weapon', size: 'medium', weight_lb: 3, value: 2500, weapon: { damage: '1d6', damage_type: 'slashing', finesse: true } }, names: { fantasy: ['cimitarra', ['scimitar', 'sable']] }, description: '' },
  hammer: { base: { type: 'weapon', size: 'small', weight_lb: 2, value: 200, weapon: { damage: '1d4', damage_type: 'bludgeoning' } }, names: { fantasy: ['martillo', ['martillo ligero', 'hammer', 'mazo']] }, description: '' },
  pitchfork: { base: { type: 'weapon', size: 'large', weight_lb: 5, value: 50, weapon: { damage: '1d6', damage_type: 'piercing', two_handed: true } }, names: { fantasy: ['horca', ['horquilla', 'bieldo', 'horca de labranza']] }, description: '' },
};

const WEAPON_CONCEPTS: Concept[] = ['spear', 'club', 'scimitar', 'hammer', 'pitchfork'];

export const KIT_PURSE_ID = 'it_kit_purse';
const kitId = (c: Concept) => `it_kit_${c}`;

/** La definición de una cosa del ajuar en un género. */
export function kitItemDef(concept: Concept, genre: Genre): ItemDef {
  const k = KIT_ITEMS[concept];
  const [name, aliases] = k.names[genre] ?? k.names.fantasy;
  return { id: kitId(concept), name, aliases: [...aliases], unique: false, origin: 'custom', ...structuredClone(k.base), ...(k.description ? { description: k.description } : {}) };
}

/** Un ajuar: qué oficios lo llevan (palabras del `role`, sin tildes), cuánto dinero y qué cosas. */
export interface KitDef {
  id: string;
  match: RegExp | null;
  wealth: Wealth;
  /** Ideas del ajuar o ids del catálogo del mundo (si el mundo no lo tiene, no se da). */
  items: (Concept | `it_${string}`)[];
  /** Sin nada encima: animales. */
  empty?: boolean;
  /** Sin bolsa ni dinero (niños): sus cosas van sueltas encima. */
  purse?: false;
  /** La ropa que lleva puesta, si su oficio la distingue. */
  clothes?: Concept;
}

/** Por orden: gana el primero cuyo patrón casa con el oficio. El último es el de cualquier vecino. */
export const KITS: readonly KitDef[] = [
  { id: 'animal', match: /\b(lob[oa]|perr[oa]|jabali|os[oa]|rata|cuervo|bestia|caballo|yegua|mula|gat[oa]|serpiente|arana|zorr[oa]|ciervo)\b/, wealth: 'none', items: [], empty: true },
  { id: 'child', match: /\b(nin[oa]s?|chiquill[oa]s?|zagal(?:a)?|rapaz(?:a)?|chaval(?:a)?|crio|cria)\b/, wealth: 'none', items: ['toy', 'food'], purse: false, clothes: 'clothes' },
  { id: 'prisoner', match: /\b(pres[oa]|prisioner[oa]|cautiv[oa]|esclav[oa])\b/, wealth: 'none', items: ['food'], clothes: 'rags' },
  { id: 'money', match: /(recaudador|cobrador|pagador|cambista|prestamista|usurer|banquer|tesorer)/, wealth: 'rich', items: ['ledger', 'keyring'], clothes: 'fine' },
  { id: 'noble', match: /(regidor|alcald|\bsenor|\bnoble|baron|condes?a?\b|jef[ea] de puerto|gobernador|mayordom)/, wealth: 'rich', items: ['ring', 'keyring', 'kerchief'], clothes: 'fine' },
  { id: 'merchant', match: /(mercader|comerciant|buhoner|tender[oa]|vendedor|patron|jef[ea] de (?:la )?caravana|jef[ea] del refugio)/, wealth: 'comfortable', items: ['ledger', 'key', 'kerchief'], clothes: 'clothes' },
  { id: 'innkeeper', match: /(tabern|posader|mesoner|cantiner|cociner|venter[oa])/, wealth: 'comfortable', items: ['keyring', 'kerchief'], clothes: 'apron' },
  { id: 'jailer', match: /(carceler)/, wealth: 'modest', items: ['keyring', 'whistle'], clothes: 'tabard' },
  { id: 'thief', match: /(ladron|ratero|carterista|bandid|salteador|contrabandist)/, wealth: 'modest', items: ['dice', 'it_ganzuas', 'knife'], clothes: 'cloak' },
  { id: 'guard', match: /(guardia|alguacil|soldad|sargento|capitan|centinela|escolta|agente|vigilante|guardian)/, wealth: 'modest', items: ['whistle', 'food'], clothes: 'tabard' },
  { id: 'healer', match: /(curander|medic|sanador|boticari|herborist|partera|enfermer)/, wealth: 'modest', items: ['herbs', 'bandage'], clothes: 'clothes' },
  { id: 'priest', match: /(sacerdot|capellan|\babad|monj|fraile|herman[oa] |sacristan|prior)/, wealth: 'modest', items: ['beads', 'food'], clothes: 'robe' },
  { id: 'scholar', match: /(bibliotecari|escriban|maestr[oa]|erudit|sabi[oa]|copista)/, wealth: 'modest', items: ['ledger', 'fire'], clothes: 'clothes' },
  { id: 'smith', match: /(herrer|mecanic|carpinter|herrador|calderer|artesan|alfarer|zapater)/, wealth: 'modest', items: ['nails', 'fire', 'knife'], clothes: 'apron' },
  { id: 'traveler', match: /(foraster|viajer|peregrin|buscavidas)/, wealth: 'modest', items: ['charm', 'food', 'fire'], clothes: 'cloak' },
  { id: 'mystic', match: /(hechicer|bruj[oa]|adivin|chaman|ermitan|vidente)/, wealth: 'none', items: ['charm', 'fire'], clothes: 'cloak' },
  { id: 'hunter', match: /(cazador|trampero|explorador|batidor|guardabosque|chatarrer|carroner)/, wealth: 'poor', items: ['knife', 'hook', 'fire'], clothes: 'cloak' },
  { id: 'fisher', match: /(pescador|lonjer|farer|mariner|barquer)/, wealth: 'poor', items: ['hook', 'knife'], clothes: 'clothes' },
  { id: 'laborer', match: /(granjer|campesin|labrador|molinero|miner[oa]|pastor|mozo|enterrador|lenador|jornaler|capataz|superviviente)/, wealth: 'poor', items: ['knife', 'fire', 'food'], clothes: 'clothes' },
  { id: 'commoner', match: null, wealth: 'poor', items: ['knife', 'food'], clothes: 'clothes' },
];

/** Monedas por riqueza, en veces lo que lleva un PJ al empezar: [mínimo, máximo]. */
const WEALTH_RANGE: Record<Wealth, [number, number]> = {
  none: [0, 0], poor: [0.05, 0.2], modest: [0.2, 0.6], comfortable: [0.6, 1.5], rich: [2, 5],
};

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Número estable de 0 a 1 a partir de un texto: el mismo NPC, el mismo ajuar. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/** El ajuar de un NPC: el que diga su campo `kit`, o el de su oficio. */
export function kitOf(n: Pick<Npc, 'role' | 'kit' | 'mute'>): KitDef {
  if (n.kit) return KITS.find((k) => k.id === n.kit) ?? KITS.at(-1)!;
  if (n.mute) return KITS[0]!;
  const role = plain(n.role);
  return KITS.find((k) => k.match?.test(role)) ?? KITS.at(-1)!;
}

/** Lo que lleva en la bolsa un NPC de esa riqueza, en la moneda más pequeña. */
export function purseCoins(npcId: Id, wealth: Wealth, startingCoins: number): number {
  const [lo, hi] = WEALTH_RANGE[wealth];
  if (hi === 0) return 0;
  return Math.max(1, Math.round(startingCoins * (lo + (hi - lo) * hash01(npcId))));
}

/** El arma del catálogo que nombra su ataque («maza corta» → maza; «arco» → arco corto), o null. */
export function weaponFor(attackName: string, defs: readonly ItemDef[]): ItemDef | null {
  const a = plain(attackName).trim();
  if (!a) return null;
  let best: { def: ItemDef; score: number } | null = null;
  for (const d of defs) {
    if (!d.weapon || d.unique) continue;
    for (const raw of [d.name, ...d.aliases]) {
      const w = plain(raw).trim();
      if (!w) continue;
      const score = w === a ? 1000 : a.startsWith(`${w} `) || w.startsWith(`${a} `) ? w.length : 0;
      if (score && (!best || score > best.score)) best = { def: d, score };
    }
  }
  return best?.def ?? null;
}

function genreOf(snap: WorldSnapshot): Genre {
  const g = snap.campaign.generation?.genre;
  return g === 'scifi' || g === 'postapoc' ? g : 'fantasy';
}

/** Lo que lleva un NPC, bajando a sus contenedores. */
function carriedBy(snap: WorldSnapshot, npcId: Id): ItemInstance[] {
  const out: ItemInstance[] = [];
  const walk = (p: { type: 'npc' | 'container'; id: Id }) => {
    for (const i of snap.item_instances) {
      if (i.location.type !== p.type || i.location.id !== p.id) continue;
      out.push(i);
      walk({ type: 'container', id: i.id });
    }
  };
  walk({ type: 'npc', id: npcId });
  return out;
}

/**
 * Versión del ajuar. 1: bolsa, cosas del oficio y arma. 2: la ropa puesta y lo nuevo que la campaña escrita pone
 * encima de cada NPC (la jarra de Brenna, el guante de Ysolde). Un NPC equipado con una versión anterior recibe solo
 * lo de las versiones que le faltan: lo que ya le dieron, si se lo robaron, no se repone.
 */
export const OUTFIT_VERSION = 2;

/** Con qué versión del ajuar va equipado un NPC (`true`: la 1, de antes de numerarlas). */
export function outfitLevel(n: Pick<Npc, 'outfitted'>): number {
  return n.outfitted === true ? 1 : typeof n.outfitted === 'number' ? n.outfitted : 0;
}

/** Si un ejemplar es ropa que alguien lleva puesta. */
export function isWorn(i: ItemInstance): boolean { return i.state['worn'] === true; }

/**
 * Da el ajuar a los NPC que aún no lo tienen, o lo que les falta de la versión actual. Antes, en partidas ya
 * empezadas, les devuelve lo que la campaña escrita les pone encima y la partida no tenía (`seed`). Idempotente.
 * Devuelve si ha cambiado algo.
 */
export function outfitNpcs(snap: WorldSnapshot, seed?: WorldSnapshot): boolean {
  const pending = snap.npcs.filter((n) => outfitLevel(n) < OUTFIT_VERSION);
  if (!pending.length) return false;
  const genre = genreOf(snap);
  const defs = new Map(snap.item_defs.map((d) => [d.id, d]));
  const ids = new Set(snap.item_instances.map((i) => i.id));
  const start = snap.campaign.starting_coins ?? 150;

  const ensureDef = (d: ItemDef): ItemDef => {
    const have = defs.get(d.id);
    if (have) return have;
    snap.item_defs.push(d);
    defs.set(d.id, d);
    return d;
  };
  const add = (i: ItemInstance) => { snap.item_instances.push(i); ids.add(i.id); };
  // Ids estables: el mismo mundo da los mismos ejemplares («ii_kit_garran_bolsa»).
  const newId = (npcId: Id, what: string) => {
    const base = `ii_kit_${npcId.replace(/^npc_/, '')}_${what}`;
    let id = base;
    for (let k = 2; ids.has(id); k++) id = `${base}_${k}`;
    return id;
  };
  const onNpc = (n: Npc, def: ItemDef, state: Record<string, unknown> = {}): ItemInstance =>
    ({ id: newId(n.id, def.id.replace(/^it_(?:kit_)?/, '')), item_id: def.id, quantity: 1, location: { type: 'npc', id: n.id }, state });

  for (const n of pending) {
    const level = outfitLevel(n);
    n.outfitted = OUTFIT_VERSION;
    // Muerto o desaparecido: lo que llevaba ya cayó (death.ts) o se fue con él.
    if (n.status === 'dead' || n.status === 'missing') continue;

    // 1. Lo que la campaña escrita le pone encima y esta partida no tiene (partidas de antes del ajuar, o de antes
    //    de que la campaña se lo pusiera).
    if (seed) {
      const fromSeed = carriedBy(seed, n.id).filter((i) => !ids.has(i.id));
      for (const i of fromSeed) {
        const d = seed.item_defs.find((x) => x.id === i.item_id);
        if (d) ensureDef(structuredClone(d));
        if (defs.has(i.item_id)) add(structuredClone(i));
      }
    }

    const kit = kitOf(n);
    if (kit.empty) continue;
    const carried = carriedBy(snap, n.id);
    const has = (itemId: Id) => carried.some((i) => i.item_id === itemId);

    if (level < 1) {
      // 2. La bolsa con sus monedas, si no lleva ya un contenedor. Sin bolsa (niños), nada de dinero.
      let purse = carried.find((i) => defs.get(i.item_id)?.container && !defs.get(i.item_id)!.container!.fixed) ?? null;
      if (!purse && kit.purse !== false) {
        const def = ensureDef(kitItemDef('purse', genre));
        const coins = purseCoins(n.id, n.wealth ?? kit.wealth, start);
        purse = { id: newId(n.id, 'bolsa'), item_id: def.id, quantity: 1, location: { type: 'npc', id: n.id }, state: coins > 0 ? { coins } : {} };
        add(purse);
        carried.push(purse);
      }

      // 3. Sus cosas personales: dentro de la bolsa si caben (cosas menudas), si no, encima.
      const box = purse ? defs.get(purse.item_id)!.container : undefined;
      for (const what of kit.items) {
        const def = what.startsWith('it_') ? defs.get(what) : ensureDef(kitItemDef(what as Concept, genre));
        if (!def || has(def.id)) continue;
        const inPurse = purse ? carried.filter((i) => i.location.type === 'container' && i.location.id === purse!.id).length : 0;
        const fits = purse && box && def.size === 'tiny' && inPurse < box.slots;
        const inst = onNpc(n, def);
        if (fits) inst.location = { type: 'container', id: purse!.id };
        add(inst);
        carried.push(inst);
      }

      // 4. Su arma, si pelea y la lleva a la vista: la de su ataque, si es un arma de verdad.
      if (n.stats && !n.noncombatant && !carried.some((i) => defs.get(i.item_id)?.weapon && defs.get(i.item_id)!.type === 'weapon')) {
        const pool = [...defs.values(), ...WEAPON_CONCEPTS.map((c) => kitItemDef(c, genre))];
        const w = weaponFor(n.stats.attack_name, pool);
        if (w) {
          const inst = onNpc(n, ensureDef(w));
          add(inst);
          carried.push(inst);
        }
      }
    }

    // 5. Su ropa, puesta, si su ajuar la dice y no lleva ya algo puesto en el cuerpo.
    if (level < 2 && kit.clothes && !carried.some((i) => isWorn(i) && defs.get(i.item_id)?.equip_slot === 'body')) {
      const inst = onNpc(n, ensureDef(kitItemDef(kit.clothes, genre)), { worn: true });
      add(inst);
      carried.push(inst);
    }
  }
  return true;
}

/** Monedas que hay en una bolsa (o en lo que sea). */
export function coinsIn(i: ItemInstance): number {
  const c = i.state['coins'];
  return typeof c === 'number' && c > 0 ? c : 0;
}
