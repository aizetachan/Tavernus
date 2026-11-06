/**
 * El mundo de una partida en PostgreSQL (docs/PLAN-OBJETOS.md §8, bloque G; WORLD_STORE=pg). La misma base que
 * la plataforma (src/db/db.ts), con tres tablas (migración 2):
 *
 *   world_entities (world_id, collection, id, ord, doc jsonb, updated_at)   un documento por entidad; la
 *                                                                           campaña, una fila por clave
 *   world_events   (world_id, seq, game_s, actor_id, action_type, doc jsonb) el registro
 *   world_tickers  (world_id, name, state jsonb)
 *
 * Como Firestore: el motor tiene el mundo en memoria y solo escribe lo que cambia. Cada guardado (`write`) es una
 * transacción con los cambios del lote, unos KB en vez del mundo entero; o entra todo o nada. Los documentos
 * no tienen columnas por campo: esta capa no sabe nada del modelo más allá de `id` y las colecciones del
 * snapshot, así que un campo o una colección nuevos no piden migración.
 *
 * `world_id` es la partida, no la campaña (varias partidas son de «brezal»). Para el REPL, la campaña.
 *
 * JSONB guarda las claves de cada objeto en su propio orden (por longitud y luego alfabético), no en el de
 * inserción; los arrays sí conservan el orden, y el de las entidades lo guarda `ord`. Y no admite el carácter
 * nulo (U+0000) en los textos: se cambia por U+FFFD al guardar.
 */

import type { GameEvent, Id, WorldSnapshot } from '../engine/model.js';
import type { TickerState } from '../clock/clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { Change, Repository } from './repository.js';

/** Fila que lista las colecciones del snapshot (para devolver `[]` en las vacías al cargar). */
const META = '_snapshot';

/**
 * La campaña va en una fila por cada clave de primer nivel (`collection = '_campaign'`, `id` = la clave), no en
 * una sola: lleva lo que casi no cambia (la historia escrita, decenas de KB) junto a lo que cambia a cada paso
 * (estado de la historia, hechos, ganchos, rumores, horarios). Así un cambio en la campaña reescribe solo las
 * claves que cambiaron, sin que esta capa sepa cuáles son.
 */
const CAMPAIGN = '_campaign';

function campaignRows(campaign: object): EntityRow[] {
  return Object.entries(campaign).filter(([, v]) => v !== undefined).map(([k, v]) => ({ c: CAMPAIGN, i: k, d: v }));
}

/** JSON para una columna JSONB: sin el carácter nulo, que PostgreSQL no admite en JSONB. */
export function pgJson(v: unknown): string {
  const s = JSON.stringify(v);
  return s.includes('\\u0000') ? JSON.stringify(v, (_k, x: unknown) => (typeof x === 'string' ? x.replaceAll('\0', '�') : x)) : s;
}

interface EntityRow { c: string; i: string; d: unknown }

/** Las filas de un snapshot entero, en orden: la campaña, la lista de colecciones y cada entidad. */
function snapshotRows(snapshot: WorldSnapshot): EntityRow[] {
  const s = snapshot as unknown as Record<string, unknown>;
  const lists = Object.keys(s).filter((k) => k !== 'campaign' && Array.isArray(s[k]));
  const rows: EntityRow[] = [...campaignRows(snapshot.campaign), { c: META, i: 'collections', d: lists }];
  for (const k of lists) for (const doc of s[k] as { id: Id }[]) rows.push({ c: k, i: doc.id, d: doc });
  return rows;
}

const UPSERT = `insert into world_entities (world_id, collection, id, doc)
  select $1, e->>'c', e->>'i', e->'d' from jsonb_array_elements($2::jsonb) with ordinality as x(e, n) order by n
  on conflict (world_id, collection, id) do update set doc = excluded.doc, updated_at = now()`;

async function insertEntities(q: Queryable, worldId: string, rows: EntityRow[]): Promise<void> {
  // Por tandas: un parámetro enorme no gana nada y PGlite lo lleva peor.
  for (let i = 0; i < rows.length; i += 500) await q.query(UPSERT, [worldId, pgJson(rows.slice(i, i + 500))]);
}

async function insertEvents(q: Queryable, worldId: string, events: readonly GameEvent[]): Promise<void> {
  for (let i = 0; i < events.length; i += 100) {
    const batch = events.slice(i, i + 100);
    await q.query(`insert into world_events (world_id, seq, game_s, actor_id, action_type, doc)
      select $1, (e->>'seq')::int, coalesce((e->>'timestamp_game_s')::double precision, 0), e->>'actor_id', coalesce(e->>'action_type', ''), e
      from jsonb_array_elements($2::jsonb) e`, [worldId, pgJson(batch)]);
  }
}

export class PgRepository implements Repository {
  constructor(private readonly db: Db, private readonly worldId: string) {}

  /**
   * Escrituras en fila: con un servidor hay varias conexiones, y dos guardados seguidos no deben adelantarse (el
   * más viejo pisaría al nuevo). Cada documento se convierte a JSON al pedirse, con el estado de ese momento.
   */
  private chain: Promise<void> = Promise.resolve();
  private queue(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  settled(): Promise<void> { return this.chain; }

  /** Lo último pedido de cada clave de la campaña, en JSON: para escribir solo las que cambian. Vacío = escribirlas todas. */
  private campaignSaved = new Map<string, string>();

  private rememberCampaign(campaign: object): void {
    this.campaignSaved = new Map(Object.entries(campaign).filter(([, v]) => v !== undefined).map(([k, v]) => [k, pgJson(v)]));
  }

  /** La campaña, como cambios de sus claves: las que cambiaron desde lo último pedido y las que ya no están. */
  private campaignChanges(campaign: object): { put: EntityRow[]; gone: string[] } {
    const now = new Map(Object.entries(campaign).filter(([, v]) => v !== undefined).map(([k, v]) => [k, pgJson(v)] as const));
    const put = [...now].filter(([k, j]) => this.campaignSaved.get(k) !== j).map(([k, j]) => ({ c: CAMPAIGN, i: k, d: JSON.parse(j) as unknown }));
    const gone = [...this.campaignSaved.keys()].filter((k) => !now.has(k));
    this.campaignSaved = new Map(now);
    return { put, gone };
  }

  async loadSnapshot(_campaignId: Id): Promise<WorldSnapshot | null> {
    await this.settled();
    const snap = await loadWorldSnapshot(this.db, this.worldId);
    if (snap) this.rememberCampaign(snap.campaign);
    return snap;
  }

  saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
    let rows: EntityRow[];
    try { rows = JSON.parse(pgJson(snapshotRows(snapshot))) as EntityRow[]; } catch (e) { return Promise.reject(e as Error); }
    this.rememberCampaign(snapshot.campaign);
    return this.queue(() => this.db.tx(async (q) => {
      await q.query('delete from world_entities where world_id = $1', [this.worldId]);
      await insertEntities(q, this.worldId, rows);
    })).catch((e: unknown) => { this.campaignSaved.clear(); throw e; });
  }

  /** Un guardado del motor: una transacción con lo que cambió (altas y cambios, y bajas). */
  write(_campaignId: Id, changes: Change[]): Promise<void> {
    const last = new Map<string, Change>();
    for (const c of changes) last.set(`${c.collection}/${c.id}`, c);
    let put: string, del: string;
    try {
      const puts: EntityRow[] = [], dels: { c: string; i: string }[] = [];
      for (const c of last.values()) {
        if (c.collection === 'campaign') {
          if (c.doc === null) continue; // la campaña no se borra
          const cc = this.campaignChanges(c.doc as object);
          puts.push(...cc.put);
          dels.push(...cc.gone.map((k) => ({ c: CAMPAIGN, i: k })));
        } else if (c.doc === null) dels.push({ c: c.collection, i: c.id });
        else puts.push({ c: c.collection, i: c.id, d: c.doc });
      }
      put = pgJson(puts);
      del = pgJson(dels);
    } catch (e) { this.campaignSaved.clear(); return Promise.reject(e as Error); }
    if (put === '[]' && del === '[]') return this.queue(async () => {});
    return this.queue(() => this.db.tx(async (q) => {
      if (del !== '[]') {
        await q.query(`delete from world_entities w using jsonb_array_elements($2::jsonb) e
          where w.world_id = $1 and w.collection = e->>'c' and w.id = e->>'i'`, [this.worldId, del]);
      }
      if (put !== '[]') await q.query(UPSERT, [this.worldId, put]);
    })).catch((e: unknown) => { this.campaignSaved.clear(); throw e; });
  }

  appendEvent(event: GameEvent): Promise<void> {
    let doc: string;
    try { doc = pgJson(event); } catch (e) { return Promise.reject(e as Error); }
    return this.queue(async () => {
      await this.db.query('insert into world_events (world_id, seq, game_s, actor_id, action_type, doc) values ($1, $2, $3, $4, $5, $6::jsonb)',
        [this.worldId, event.seq, event.timestamp_game_s ?? 0, event.actor_id ?? null, event.action_type, doc]);
    });
  }

  /** El registro sin el contexto del máster (diagnostics.ts): la base no llega a mandarlo. */
  async loadEvents(_campaignId: Id, afterSeq: number): Promise<GameEvent[]> {
    await this.settled();
    const rows = await this.db.query<{ doc: GameEvent }>(
      `select doc #- '{payload,master,context}' as doc from world_events where world_id = $1 and seq > $2 order by seq`, [this.worldId, afterSeq]);
    return rows.map((r) => r.doc);
  }

  async loadTicker(_campaignId: Id, name: string): Promise<TickerState | null> {
    await this.settled();
    const rows = await this.db.query<{ state: TickerState }>('select state from world_tickers where world_id = $1 and name = $2', [this.worldId, name]);
    return rows[0]?.state ?? null;
  }

  saveTicker(_campaignId: Id, name: string, state: TickerState): Promise<void> {
    let doc: string;
    try { doc = pgJson(state); } catch (e) { return Promise.reject(e as Error); }
    return this.queue(async () => {
      await this.db.query(`insert into world_tickers (world_id, name, state) values ($1, $2, $3::jsonb)
        on conflict (world_id, name) do update set state = excluded.state`, [this.worldId, name, doc]);
    });
  }
}

/** El mundo guardado de una partida, o null si no hay. */
export async function loadWorldSnapshot(q: Queryable, worldId: string): Promise<WorldSnapshot | null> {
  const rows = await q.query<{ collection: string; id: string; doc: unknown }>('select collection, id, doc from world_entities where world_id = $1 order by ord', [worldId]);
  const campaign: Record<string, unknown> = {};
  let found = false;
  for (const r of rows) if (r.collection === CAMPAIGN) { campaign[r.id] = r.doc; found = true; }
  if (!found) return null;
  const snap: Record<string, unknown> = { campaign };
  for (const k of (rows.find((r) => r.collection === META)?.doc as string[] | undefined) ?? []) snap[k] = [];
  for (const r of rows) {
    if (r.collection === CAMPAIGN || r.collection === META) continue;
    ((snap[r.collection] ??= []) as unknown[]).push(r.doc);
  }
  return snap as unknown as WorldSnapshot;
}

/** Un mundo entero, como se pasa de un sitio a otro (migración, copia): el registro con el contexto del máster. */
export interface WorldDump { snapshot: WorldSnapshot; events: GameEvent[]; tickers: Record<string, TickerState> }

/** ¿Hay mundo guardado con ese `world_id`? */
export async function hasWorld(q: Queryable, worldId: string): Promise<boolean> {
  return (await q.query('select 1 from world_entities where world_id = $1 and collection = $2 limit 1', [worldId, CAMPAIGN])).length > 0;
}

/**
 * Mete un mundo entero en la base, en una transacción. Si ya había uno con ese `world_id`, lo sustituye.
 * Eventos con el mismo `seq` (registros de antes del punto de control) se quedan con el primero.
 */
export async function importWorld(db: Db, worldId: string, w: WorldDump): Promise<{ entities: number; events: number; skipped: number }> {
  const seen = new Set<number>();
  const events = w.events.filter((e) => !seen.has(e.seq) && Boolean(seen.add(e.seq)));
  const rows = snapshotRows(w.snapshot);
  await db.tx(async (q) => {
    await deleteWorld(q, worldId);
    await insertEntities(q, worldId, rows);
    await insertEvents(q, worldId, events);
    for (const [name, state] of Object.entries(w.tickers)) {
      await q.query('insert into world_tickers (world_id, name, state) values ($1, $2, $3::jsonb)', [worldId, name, pgJson(state)]);
    }
  });
  return { entities: rows.filter((r) => r.c !== CAMPAIGN && r.c !== META).length, events: events.length, skipped: w.events.length - events.length };
}

/** Saca un mundo entero de la base (con el contexto del máster en cada evento), o null si no hay. */
export async function exportWorld(q: Queryable, worldId: string): Promise<WorldDump | null> {
  const snapshot = await loadWorldSnapshot(q, worldId);
  if (!snapshot) return null;
  const events = (await q.query<{ doc: GameEvent }>('select doc from world_events where world_id = $1 order by seq', [worldId])).map((r) => r.doc);
  const tickers: Record<string, TickerState> = {};
  for (const r of await q.query<{ name: string; state: TickerState }>('select name, state from world_tickers where world_id = $1 order by name', [worldId])) tickers[r.name] = r.state;
  return { snapshot, events, tickers };
}

export async function deleteWorld(q: Queryable, worldId: string): Promise<void> {
  for (const t of ['world_entities', 'world_events', 'world_tickers']) await q.query(`delete from ${t} where world_id = $1`, [worldId]);
}

/** Copia un mundo (la foto de arranque de una grabación, su vuelta al reiniciar la demo), sustituyendo el destino. */
export async function copyWorld(db: Db, from: string, to: string): Promise<void> {
  await db.tx(async (q) => {
    await deleteWorld(q, to);
    await q.query('insert into world_entities (world_id, collection, id, doc) select $2, collection, id, doc from world_entities where world_id = $1 order by ord', [from, to]);
    await q.query('insert into world_events (world_id, seq, game_s, actor_id, action_type, doc) select $2, seq, game_s, actor_id, action_type, doc from world_events where world_id = $1', [from, to]);
    await q.query('insert into world_tickers (world_id, name, state) select $2, name, state from world_tickers where world_id = $1', [from, to]);
  });
}

/** Cambia de nombre un mundo (lo jugado de una grabación pasa a «recorded»), sustituyendo el destino. */
export async function moveWorld(db: Db, from: string, to: string): Promise<void> {
  await db.tx(async (q) => {
    await deleteWorld(q, to);
    for (const t of ['world_entities', 'world_events', 'world_tickers']) await q.query(`update ${t} set world_id = $2 where world_id = $1`, [from, to]);
  });
}
