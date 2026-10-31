/**
 * Registro del servicio web (journald en el VPS, docs/DESPLIEGUE.md): una línea por acción, por
 * llamada suelta al máster y por cambio de presencia, en `clave=valor` para poder filtrar con grep.
 *
 *   [acción] partida=brezal pj=ch_1 nombre=Leodhin tipo=act ms=7342 modelo=claude-… máster_ms=7100 llamadas=1 iter=3 tokens_in=1200 tokens_out=340 caché_lee=8000 caché_escribe=0 resultado=ok
 *   [máster] partida=brezal pj=ch_1 nombre=Leodhin tipo=master_arrival ms=6100 modelo=… resultado=error error="api_error: …"
 *   [presencia] partida=brezal pj=ch_1 nombre=Leodhin evento=conecta pestaña=k3j… pestañas=2
 *
 * Nunca lleva lo que escribe el jugador ni la narración, ni tokens de acceso: el error pasa por `clean`.
 */
import type { MasterCall } from '../../engine/engine.js';
import type { Id } from '../../engine/model.js';

export type LogValue = string | number | null | undefined;

/** Lo que dura una acción del jugador (POST /api/act, /api/roll…) y las llamadas al máster que hizo su PJ entretanto. */
export interface ActionRecord {
  game: string;
  character: Id;
  name: string | null;
  /** act, say, roll, reaction, offer, command, quest_drop. */
  kind: string;
  ms: number;
  /** ok, rechazada (el motor dijo que no) o error (excepción o fallo del máster). */
  result: 'ok' | 'rechazada' | 'error';
  calls: MasterCall[];
  error?: string | null;
}

/** `clave=valor` con comillas solo si hace falta; los vacíos no salen. */
export function fields(rec: Record<string, LogValue>): string {
  return Object.entries(rec)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'number' || /^[^\s"=]+$/.test(v as string) ? v : JSON.stringify(v)}`)
    .join(' ');
}

/** Mensaje de error apto para el registro: una línea, corta y sin nada con pinta de clave o token. */
export function clean(message: string, max = 300): string {
  const one = message.replace(/\s+/g, ' ').trim()
    .replace(/(token=)[^\s&"']+/gi, '$1…')
    .replace(/\b([A-Z_]*(?:KEY|TOKEN|SECRET)=)[^\s&"']+/g, '$1…')
    .replace(/(\/i\/[a-z0-9-]+\/)[A-Za-z0-9_-]+/g, '$1…')
    .replace(/\b(sk-ant-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]*/g, '$1…')
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1…');
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Modelo, latencia del máster y tokens, sumados si hubo varias llamadas. */
function masterFields(calls: MasterCall[]): Record<string, LogValue> {
  if (!calls.length) return { modelo: '-' };
  const sum = (k: 'input' | 'output' | 'cache_read' | 'cache_write' | 'iterations') => calls.reduce((a, c) => a + (c.usage?.[k] ?? 0), 0);
  const models = [...new Set(calls.map((c) => c.model).filter((m): m is string => Boolean(m)))];
  return {
    modelo: models.join(',') || '-',
    máster_ms: calls.reduce((a, c) => a + c.ms, 0),
    llamadas: calls.length > 1 ? calls.length : null,
    iter: sum('iterations'),
    tokens_in: sum('input'), tokens_out: sum('output'), caché_lee: sum('cache_read'), caché_escribe: sum('cache_write'),
  };
}

/** Error del máster en una línea: «razón: mensaje». */
function masterError(calls: MasterCall[]): string | null {
  const bad = calls.filter((c) => !c.ok && c.error);
  return bad.length ? bad.map((c) => `${c.error!.reason}: ${c.error!.message}`).join(' | ') : null;
}

export function actionLine(r: ActionRecord): string {
  const err = r.error ?? masterError(r.calls);
  // Un máster que falla es un error aunque el motor lo convierta en un «no» para el jugador.
  const result = r.calls.some((c) => !c.ok) ? 'error' : r.result;
  return `[acción] ${fields({ partida: r.game, pj: r.character, nombre: r.name, tipo: r.kind, ms: r.ms, ...masterFields(r.calls), resultado: result, error: err ? clean(err) : null })}`;
}

/** Llamada al máster que no viene de una acción del jugador (presentación, llegada, plazo de una escena decisiva…). */
export function masterLine(game: string, name: string | null, c: MasterCall): string {
  const err = masterError([c]);
  return `[máster] ${fields({ partida: game, pj: c.character_id, nombre: name, tipo: c.action_type, ms: c.ms, ...masterFields([c]), resultado: c.ok ? 'ok' : 'error', error: err ? clean(err) : null })}`;
}

/** Un jugador reporta algo (report.ts): quién, de qué evento y dónde está el fichero. Nunca su texto. */
export function reportLine(game: string, character: Id, name: string | null, r: { seq: number | null; general: boolean; event_type: string | null; length: number; file: string }): string {
  return `[reporte] ${fields({ partida: game, pj: character, nombre: name, seq: r.seq, tipo: r.general ? 'general' : 'mensaje', evento: r.event_type, caracteres: r.length, fichero: r.file })}`;
}

export type PresenceEvent = 'conecta' | 'desconecta' | 'cierra_pestaña' | 'en_línea' | 'fuera_de_línea';

export function presenceLine(game: string, character: Id, name: string | null, event: PresenceEvent, extra: Record<string, LogValue> = {}): string {
  return `[presencia] ${fields({ partida: game, pj: character, nombre: name, evento: event, ...extra })}`;
}

/**
 * Junta las llamadas al máster con la acción del jugador que las provocó: mientras un PJ tiene una acción
 * en curso, sus llamadas van a esa línea; si no, cada una sale sola (`masterLine`).
 */
export class ActionLog {
  private readonly open = new Map<Id, MasterCall[]>();

  /** onAction: cada acción acabada, para los contadores de /admin/estado (status.ts). */
  constructor(private readonly game: string, private readonly nameOf: (id: Id) => string | null, private readonly log: (line: string) => void, private readonly onAction: (r: ActionRecord) => void = () => {}) {}

  /** Del motor (engine.onMaster). */
  master(c: MasterCall): void {
    const bucket = this.open.get(c.character_id);
    if (bucket) bucket.push(c);
    else this.log(masterLine(this.game, this.nameOf(c.character_id), c));
  }

  /** Corre la acción y apunta su línea al acabar (también si lanza). `rejected`: el resultado es un «no» del motor. */
  async track<T>(character: Id, kind: string, run: () => Promise<T>, rejected: (r: T) => boolean = () => false, now: () => number = Date.now): Promise<T> {
    // Dos acciones a la vez del mismo PJ (decir mientras actúa): las llamadas van a la primera.
    const mine = !this.open.has(character);
    const calls = mine ? [] : this.open.get(character)!;
    if (mine) this.open.set(character, calls);
    const t0 = now();
    const done = (result: ActionRecord['result'], error: string | null) => {
      if (mine) this.open.delete(character);
      const rec: ActionRecord = { game: this.game, character, name: this.nameOf(character), kind, ms: now() - t0, result, calls: mine ? calls : [], error };
      this.log(actionLine(rec));
      this.onAction(rec);
    };
    let r: T;
    try { r = await run(); } catch (e) { done('error', (e as Error).message ?? String(e)); throw e; }
    done(rejected(r) ? 'rechazada' : 'ok', null);
    return r;
  }
}
