/**
 * Dados (SPEC §7). El servidor tira; el master solo pide y narra.
 * Expresiones: "d20", "2d6+3", "1d8-1", "4d6kh3" (keep highest 3), "3+2d4".
 */

export interface RollResult {
  expr: string;
  total: number;
  /** Desglose legible: "2d6 [4, 5] + 3 = 12". */
  breakdown: string;
  rolls: number[];
  /** Solo para d20: 20 natural / 1 natural. */
  natural?: 20 | 1;
}

export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/** RNG determinista para tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(sides: number, rng: Rng = defaultRng): number {
  return 1 + Math.floor(rng() * sides);
}

const TERM = /^(\d*)d(\d+)(?:k([hl])(\d+))?$/i;

export function rollExpr(expr: string, rng: Rng = defaultRng): RollResult {
  const clean = expr.replace(/\s+/g, '').toLowerCase();
  if (!clean || !/^[-+]?[0-9d]+(?:k[hl]\d+)?(?:[-+][0-9d]+(?:k[hl]\d+)?)*$/.test(clean)) throw new Error(`expresión de dados no válida: ${expr}`);
  const parts = clean.match(/[-+]?[^-+]+/g)!;
  let total = 0;
  const pieces: string[] = [];
  const rolls: number[] = [];
  let natural: 20 | 1 | undefined;
  let d20Count = 0;
  for (const raw of parts) {
    const sign = raw.startsWith('-') ? -1 : 1;
    const body = raw.replace(/^[-+]/, '');
    const m = body.match(TERM);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2]!, 10);
      if (n < 1 || n > 100 || sides < 2 || sides > 1000) throw new Error(`dados fuera de rango: ${body}`);
      let dice = Array.from({ length: n }, () => rollDie(sides, rng));
      const shown = [...dice];
      if (m[3]) {
        const k = parseInt(m[4]!, 10);
        dice = [...dice].sort((a, b) => (m[3] === 'h' ? b - a : a - b)).slice(0, k);
      }
      const sum = dice.reduce((a, b) => a + b, 0);
      total += sign * sum;
      rolls.push(...shown);
      pieces.push(`${sign < 0 ? '- ' : pieces.length ? '+ ' : ''}${body} [${shown.join(', ')}]`);
      if (sides === 20 && n === 1) { d20Count++; if (shown[0] === 20) natural = 20; else if (shown[0] === 1) natural = 1; }
    } else {
      const v = parseInt(body, 10);
      if (Number.isNaN(v)) throw new Error(`término no válido: ${body}`);
      total += sign * v;
      pieces.push(`${sign < 0 ? '- ' : pieces.length ? '+ ' : ''}${v}`);
    }
  }
  const r: RollResult = { expr: clean, total, breakdown: `${pieces.join(' ')} = ${total}`, rolls };
  if (d20Count === 1 && natural) r.natural = natural;
  return r;
}

export type Advantage = 'none' | 'advantage' | 'disadvantage';

export interface CheckResult extends RollResult {
  modifier: number;
  dc: number | null;
  success: boolean | null;
  advantage: Advantage;
  d20s: number[];
}

/** Tirada de d20 con modificador, ventaja/desventaja y CD opcional. */
export function rollD20(modifier: number, dc: number | null, advantage: Advantage = 'none', rng: Rng = defaultRng): CheckResult {
  const d20s = advantage === 'none' ? [rollDie(20, rng)] : [rollDie(20, rng), rollDie(20, rng)];
  const kept = advantage === 'advantage' ? Math.max(...d20s) : advantage === 'disadvantage' ? Math.min(...d20s) : d20s[0]!;
  const total = kept + modifier;
  const mod = modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`;
  const advTxt = advantage === 'none' ? '' : advantage === 'advantage' ? ' (ventaja)' : ' (desventaja)';
  const r: CheckResult = {
    expr: `1d20${modifier >= 0 ? '+' : ''}${modifier}`,
    total, rolls: d20s, d20s, modifier, dc, advantage,
    breakdown: `d20 [${d20s.join(', ')}]${advTxt} ${mod} = ${total}${dc !== null ? ` vs CD ${dc}` : ''}`,
    success: dc === null ? null : kept === 20 ? true : kept === 1 ? false : total >= dc,
  };
  if (kept === 20) r.natural = 20; else if (kept === 1) r.natural = 1;
  return r;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}
