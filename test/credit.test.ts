import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Master, noCredit } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager, type MasterFactory, worldgenCause } from '../src/games/manager.js';
import { CreditAlarm, webhookAlert } from '../src/adapters/web/alert.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { Engine, type MasterCall } from '../src/engine/engine.js';

// El texto real de la API cuando la cuenta se queda sin saldo (registro del VPS, 2026-10-27).
const BROKE = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

describe('sin crédito en la API', () => {
  it('se reconoce por el mensaje; un 529 o un 400 cualquiera, no', () => {
    expect(noCredit(BROKE)).toBe(true);
    expect(noCredit('529 {"type":"overloaded_error"}')).toBe(false);
    expect(noCredit('400 max_tokens: field required')).toBe(false);
    expect(worldgenCause(Object.assign(new Error(BROKE), { status: 400 }))).toBe('la cuenta de la API no tiene crédito; hay que recargarla.');
  });

  it('el máster lo devuelve como no_credit, no como api_error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tavernus-credit-'));
    try {
      const games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, engine: { deterministic: false }, log: () => {} });
      const { game, character_id } = await games.create({ name: 'Saldo', mode: 'offline', character: { name: 'Ana' } });
      const engine = await games.open(game.slug);
      const m = new Master(engine, { client: { create: () => Promise.reject(new Error(BROKE)) } as never });
      const out = await m.resolve(engine.world.characters.get(character_id)!, 'abro la puerta');
      expect(out).toMatchObject({ ok: false, reason: 'no_credit' });
      await games.closeAll();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('aviso al anfitrión (alert.ts)', () => {
  const call = (over: Partial<MasterCall> = {}): MasterCall => ({ character_id: 'ch_ana', action_type: 'master', ok: true, model: 'm', ms: 5, usage: null, ...over });
  const broke = call({ ok: false, model: null, error: { reason: 'no_credit', message: BROKE } });

  it('un aviso al quedarse sin saldo y otro al volver; nada por cada acción ni por otros errores', () => {
    const sent: string[] = [];
    const alarm = new CreditAlarm(async (t) => { sent.push(t); });
    alarm.master('brezal', call());
    alarm.master('brezal', call({ ok: false, error: { reason: 'api_error', message: '529' } }));
    expect(sent).toEqual([]);
    alarm.master('brezal', broke);
    alarm.master('brezal', broke);
    alarm.master('otra', broke);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('sin crédito');
    expect(sent[0]).toContain('«brezal»');
    alarm.master('otra', call());
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('vuelve a responder');
  });

  it('cada webhook con su forma; sin webhook, solo el registro', async () => {
    const reqs: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => { reqs.push({ url, init }); return new Response('ok'); }) as unknown as typeof fetch;
    const log: string[] = [];
    await webhookAlert({ ALERT_WEBHOOK: 'https://api.telegram.org/botX/sendMessage?chat_id=1' }, (l) => log.push(l), fake)('hola');
    await webhookAlert({ ALERT_WEBHOOK: 'https://ejemplo.test/hook' }, (l) => log.push(l), fake)('hola');
    await webhookAlert({ ALERT_WEBHOOK: 'https://ntfy.sh/tema' }, (l) => log.push(l), fake)('hola');
    await webhookAlert({}, (l) => log.push(l), fake)('hola');
    expect(reqs).toHaveLength(3);
    expect(String(reqs[0]!.init.body)).toBe('text=%5BTavernus%5D+hola');
    expect(JSON.parse(String(reqs[1]!.init.body))).toEqual({ text: '[Tavernus] hola', content: '[Tavernus] hola' });
    expect(reqs[2]!.init.body).toBe('[Tavernus] hola');
    expect(log).toEqual(Array(4).fill('[aviso] hola'));
  });

  it('si el webhook falla, lo apunta y no lanza', async () => {
    const log: string[] = [];
    const fake = (async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
    await webhookAlert({ ALERT_WEBHOOK: 'https://ejemplo.test/hook' }, (l) => log.push(l), fake)('hola');
    expect(log.at(-1)).toBe('[aviso] no se pudo mandar al webhook: sin red');
  });
});

describe('la web sin crédito', () => {
  let dir: string;
  let games: GameManager;
  let web: WebServer;
  let base: string;
  let broke: boolean;
  let sent: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-credit-web-'));
    broke = false;
    sent = [];
    const masterFor: MasterFactory = (engine) => {
      const m = new Master(engine, { client: offlineClient() });
      const resolve = m.resolve.bind(m);
      m.resolve = (...args) => (broke
        ? Promise.resolve({ ok: false, reason: 'no_credit', message: BROKE, usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, iterations: 1, ms: 30 } })
        : resolve(...args));
      return m;
    };
    games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor, engine: { deterministic: false }, log: () => {} });
    web = createWebServer(games, { tickMs: 3_600_000, log: () => {}, alert: async (t) => { sent.push(t); } });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await web.stop();
    await games.closeAll();
    await rm(dir, { recursive: true, force: true });
  });

  const act = async (slug: string, character: string, text: string) => (await fetch(`${base}/api/act?game=${slug}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character, text }),
  })).json() as Promise<{ ok: boolean; text: string | null }>;

  it('el jugador lee que falta crédito (no «espera un momento») y el anfitrión recibe un solo aviso', async () => {
    const { game, character_id } = await games.create({ name: 'Sin saldo', mode: 'offline', character: { name: 'Ana' } });
    broke = true;
    const r = await act(game.slug, character_id, 'abro la puerta del sótano');
    expect(r).toEqual({ ok: false, text: Engine.NO_CREDIT });
    expect(r.text).not.toContain('Espera un momento');
    await act(game.slug, character_id, 'busco una vela en la mesa');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('sin crédito');

    broke = false;
    expect((await act(game.slug, character_id, 'saludo a la tabernera con una reverencia')).ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('vuelve a responder');
  });
});
