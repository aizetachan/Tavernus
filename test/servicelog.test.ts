import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { accessBanner, createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { ActionLog, actionLine, clean, fields, masterLine, presenceLine } from '../src/adapters/web/servicelog.js';
import type { MasterCall } from '../src/engine/engine.js';
import { waitUntil } from './helpers.js';

const call = (over: Partial<MasterCall> = {}): MasterCall => ({
  character_id: 'ch_ana', action_type: 'master', ok: true, model: 'claude-test', ms: 900,
  usage: { input: 1200, output: 340, cache_read: 8000, cache_write: 10, iterations: 3 }, ...over,
});

describe('formato del registro (servicelog.ts)', () => {
  it('clave=valor, con comillas solo si hace falta y sin vacíos', () => {
    expect(fields({ partida: 'brezal', nombre: 'Ana la Roja', ms: 12, error: null, x: '' })).toBe('partida=brezal nombre="Ana la Roja" ms=12');
  });

  it('una acción con su máster: modelo, latencias, tokens y resultado', () => {
    const line = actionLine({ game: 'brezal', character: 'ch_ana', name: 'Ana', kind: 'act', ms: 1000, result: 'ok', calls: [call()] });
    expect(line).toBe('[acción] partida=brezal pj=ch_ana nombre=Ana tipo=act ms=1000 modelo=claude-test máster_ms=900 iter=3 tokens_in=1200 tokens_out=340 caché_lee=8000 caché_escribe=10 resultado=ok');
  });

  it('sin máster, modelo=-; con varias llamadas, suma y las cuenta', () => {
    expect(actionLine({ game: 'g', character: 'c', name: null, kind: 'say', ms: 5, result: 'ok', calls: [] })).toBe('[acción] partida=g pj=c tipo=say ms=5 modelo=- resultado=ok');
    const two = actionLine({ game: 'g', character: 'c', name: null, kind: 'act', ms: 5, result: 'ok', calls: [call(), call({ action_type: 'master_arrival' })] });
    expect(two).toContain('llamadas=2');
    expect(two).toContain('tokens_in=2400');
  });

  it('un máster que falla es resultado=error con el motivo, aunque al jugador le llegue un «no»', () => {
    const bad = call({ ok: false, model: null, usage: null, error: { reason: 'api_error', message: '529 {"type":"overloaded_error"}' } });
    const line = actionLine({ game: 'g', character: 'c', name: null, kind: 'act', ms: 5, result: 'rechazada', calls: [bad] });
    expect(line).toContain('resultado=error');
    expect(line).toContain('error="api_error: 529 {\\"type\\":\\"overloaded_error\\"}"');
    expect(masterLine('g', 'Ana', bad)).toMatch(/^\[máster\] partida=g pj=ch_ana nombre=Ana tipo=master ms=900 modelo=- .*resultado=error error=/);
  });

  it('el error se limpia: una línea, corto y sin tokens', () => {
    const raw = 'falló\n en /admin?token=abc123secreto y /i/brezal/SeAtToKeN con sk-ant-api03-XXXXXXXXXXXX y Bearer cf_tok_123';
    const out = clean(raw);
    expect(out).not.toMatch(/abc123secreto|SeAtToKeN|XXXXXXXX|cf_tok_123|\n/);
    expect(out).toContain('token=…');
    expect(clean('x'.repeat(1000)).length).toBe(300);
  });

  it('presencia', () => {
    expect(presenceLine('g', 'ch_ana', 'Ana', 'conecta', { pestaña: 'abcd1234', streams: 1 })).toBe('[presencia] partida=g pj=ch_ana nombre=Ana evento=conecta pestaña=abcd1234 streams=1');
  });
});

describe('ActionLog', () => {
  it('las llamadas al máster durante la acción van a su línea; las demás salen solas', async () => {
    const lines: string[] = [];
    const log = new ActionLog('g', (id) => (id === 'ch_ana' ? 'Ana' : null), (l) => lines.push(l));
    let t = 0;
    const r = await log.track('ch_ana', 'act', async () => {
      log.master(call());
      log.master(call({ character_id: 'ch_bo', action_type: 'master_arrival' }));
      t = 250;
      return { ok: true };
    }, (x) => !x.ok, () => t);
    expect(r).toEqual({ ok: true });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[máster\] partida=g pj=ch_bo tipo=master_arrival/);
    expect(lines[1]).toMatch(/^\[acción\] partida=g pj=ch_ana nombre=Ana tipo=act ms=250 modelo=claude-test /);
    // Acabada la acción, las llamadas de ese PJ vuelven a salir solas.
    log.master(call());
    expect(lines[2]).toMatch(/^\[máster\] partida=g pj=ch_ana/);
  });

  it('si la acción lanza, la línea sale igual con el error y la excepción sigue', async () => {
    const lines: string[] = [];
    const log = new ActionLog('g', () => null, (l) => lines.push(l));
    await expect(log.track('c', 'roll', async () => { throw new Error('se rompió'); })).rejects.toThrow('se rompió');
    expect(lines).toEqual([expect.stringMatching(/tipo=roll .*resultado=error error="se rompió"$/)]);
  });

  it('un «no» del motor es resultado=rechazada', async () => {
    const lines: string[] = [];
    const log = new ActionLog('g', () => null, (l) => lines.push(l));
    await log.track('c', 'act', async () => ({ ok: false }), (x) => !x.ok);
    expect(lines[0]).toMatch(/resultado=rechazada$/);
  });
});

describe('aviso de arranque', () => {
  const secret = 'f00dfeedcafe0123456789abcdef';
  it('en invitación dice dónde está el token, sin escribirlo', () => {
    const lines = accessBanner({ mode: 'invite', adminToken: secret, secret: 's' }, 'https://tavernus.example', { ADMIN_TOKEN: secret }, '/var/lib/tavernus/data/games');
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).toContain('https://tavernus.example/admin?token=<token>');
    expect(lines.join('\n')).toContain('sudo grep ^ADMIN_TOKEN /etc/tavernus/env');
  });

  it('sin ADMIN_TOKEN apunta al fichero generado; en público, igual', () => {
    const lines = accessBanner({ mode: 'public', adminToken: secret, secret: 's' }, 'http://localhost:3000', {}, join('data', 'games'));
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).toContain(join('data', 'games', '.admin-token'));
  });

  it('abierto: sin enlace de administración', () => {
    const lines = accessBanner({ mode: 'open', adminToken: null, secret: 's' }, 'http://localhost:3000', {}, 'data/games');
    expect(lines.join('\n')).not.toContain('admin?token');
  });
});

describe('registro de la web', () => {
  let dir: string;
  let games: GameManager;
  let web: WebServer;
  let base: string;
  let lines: string[];
  let failing: boolean;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-log-'));
    lines = [];
    failing = false;
    const masterFor: MasterFactory = (engine) => {
      const m = new Master(engine, { client: offlineClient() });
      const resolve = m.resolve.bind(m);
      m.resolve = (...args) => (failing
        ? Promise.resolve({ ok: false, reason: 'api_error', message: 'Connection error. ANTHROPIC_API_KEY=sk-ant-api03-SECRETO', usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, iterations: 1, ms: 30 } })
        : resolve(...args));
      return m;
    };
    games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor, engine: { deterministic: false }, log: () => {} });
    web = createWebServer(games, { tickMs: 3_600_000, leaveNoticeMs: 20, log: (l) => lines.push(l) });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await web.stop();
    await games.closeAll();
    await rm(dir, { recursive: true, force: true });
  });

  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('una línea por acción con partida, PJ, tipo, modelo, latencia y tokens; sin el texto del jugador', async () => {
    const { game, character_id } = await games.create({ name: 'Registro', mode: 'offline', character: { name: 'Ana' } });
    expect((await post(`/api/act?game=${game.slug}`, { character: character_id, text: 'saludo a la tabernera con una reverencia' })).status).toBe(200);
    const acts = lines.filter((l) => l.startsWith('[acción]'));
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatch(new RegExp(`^\\[acción\\] partida=${game.slug} pj=${character_id} nombre=Ana tipo=act ms=\\d+ modelo=\\S+ máster_ms=\\d+ iter=\\d+ tokens_in=\\d+ tokens_out=\\d+ caché_lee=\\d+ caché_escribe=\\d+ resultado=ok$`));
    expect(lines.join('\n')).not.toContain('reverencia');

    expect((await post(`/api/command?game=${game.slug}`, { character: character_id, name: 'look' })).status).toBe(200);
    expect(lines.at(-1)).toMatch(/tipo=command ms=\d+ modelo=- resultado=ok$/);
  });

  it('un fallo del máster sale como error, con el motivo y sin la clave', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { game, character_id } = await games.create({ name: 'Fallo', mode: 'offline', character: { name: 'Ana' } });
      failing = true;
      await post(`/api/act?game=${game.slug}`, { character: character_id, text: 'abro la puerta del sótano' });
      const act = lines.find((l) => l.startsWith('[acción]'))!;
      expect(act).toMatch(/tipo=act .*resultado=error error="api_error: Connection error\. ANTHROPIC_API_KEY=…"$/);
      expect(lines.join('\n')).not.toContain('SECRETO');
      // Con la web escuchando, el motor no repite el aviso sin partida.
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/^\[master\]/));
    } finally {
      warn.mockRestore();
    }
  });

  it('conexiones, desconexiones y en línea / fuera de línea', async () => {
    const { game, character_id } = await games.create({ name: 'Presencia', mode: 'offline', character: { name: 'Ana' } });
    const ctrl = new AbortController();
    const stream = await fetch(`${base}/api/stream?game=${game.slug}&character=${character_id}&tab=pestana-uno`, { signal: ctrl.signal });
    await stream.body!.getReader().read();
    const mine = () => lines.filter((l) => l.startsWith(`[presencia] partida=${game.slug} pj=${character_id} nombre=Ana`));
    expect(mine().map((l) => l.replace(/.* evento=/, ''))).toEqual(['conecta pestaña=pestana- streams=1', 'en_línea']);
    ctrl.abort();
    await waitUntil(() => expect(mine().map((l) => l.replace(/.* evento=/, ''))).toEqual(['conecta pestaña=pestana- streams=1', 'en_línea', 'desconecta pestaña=pestana- streams=0', 'fuera_de_línea']), { timeout: 2000 });
  });
});
