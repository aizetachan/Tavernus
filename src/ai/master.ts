/**
 * El Master (SPEC §2, §7, §8). Una llamada por acción, bucle de tools manual,
 * cierre obligatorio con log_event. No emite eventos: devuelve el cierre y el
 * motor lo registra dentro de la cola de la localización.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Engine } from '../engine/engine.js';
import { defaultRng, type Rng, type RollResult } from '../engine/dice.js';
import type { Character } from '../engine/model.js';
import { actionContext, systemPrompt, type DecisiveResponse, type RollContext, type Scene } from './prompt.js';
import { executeTool, MASTER_TOOLS, type LogEventInput, type ToolContext } from './tools.js';
import type { ProgressEvent } from '../engine/progress.js';

export interface MasterClient {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
}

export interface MasterUsage { input: number; output: number; cache_read: number; cache_write: number; iterations: number; ms: number }

export interface ToolCallRecord { name: string; input: Record<string, unknown>; result: string }

export type MasterOutcome =
  | { ok: true; closed: LogEventInput; usage: MasterUsage; calls: ToolCallRecord[]; rolls: RollResult[]; context: string; model: string; progress: ProgressEvent[] }
  | { ok: false; reason: 'refusal' | 'no_log_event' | 'api_error' | 'max_iterations' | 'not_configured'; message: string; usage?: MasterUsage; calls?: ToolCallRecord[] };

export interface MasterOptions {
  client?: MasterClient;
  rng?: Rng;
  /** Tiempo máximo por acción, ms reales. */
  timeoutMs?: number;
}

const CACHE_TTL: Anthropic.Beta.BetaCacheControlEphemeral = { type: 'ephemeral', ttl: '1h' };

export class Master {
  private readonly client: MasterClient;
  private readonly rng: Rng;
  private readonly timeoutMs: number;

  constructor(private readonly engine: Engine, opts: MasterOptions = {}) {
    this.rng = opts.rng ?? defaultRng;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    if (opts.client) this.client = opts.client;
    else {
      const sdk = new Anthropic({ timeout: this.timeoutMs, maxRetries: 2 });
      this.client = { create: (p) => sdk.beta.messages.create(p) };
    }
  }

  static configured(): boolean {
    return Boolean(process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']);
  }

  /** Resuelve una acción (o la continuación tras una tirada). */
  async resolve(actor: Character, text: string, roll?: RollContext, intro?: { origin: string; welcome: string }, scene?: Scene, decisive?: DecisiveResponse): Promise<MasterOutcome> {
    const { engine } = this;
    const cfg = engine.world.campaign.master;
    const context = actionContext(engine, actor, text, roll, intro, scene, decisive);
    const ctx: ToolContext = { engine, actor, nowGameS: engine.gameNow(), rng: this.rng, closed: null, rolls: [], progress: [] };
    const calls: ToolCallRecord[] = [];
    const usage: MasterUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0, iterations: 0, ms: 0 };
    const t0 = Date.now();

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: context }];

    try {
      for (let i = 0; i < cfg.max_tool_calls + 1; i++) {
        usage.iterations++;
        const res = await this.client.create({
          model: cfg.model,
          max_tokens: 4096,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: cfg.effort },
          system: [{ type: 'text', text: systemPrompt(engine.world.campaign), cache_control: CACHE_TTL }],
          tools: MASTER_TOOLS,
          messages,
        });
        usage.input += res.usage.input_tokens;
        usage.output += res.usage.output_tokens;
        usage.cache_read += res.usage.cache_read_input_tokens ?? 0;
        usage.cache_write += res.usage.cache_creation_input_tokens ?? 0;

        if (res.stop_reason === 'refusal') {
          usage.ms = Date.now() - t0;
          return { ok: false, reason: 'refusal', message: res.stop_details?.explanation ?? 'refusal', usage, calls };
        }

        const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0) {
          // Terminó sin log_event: usamos el texto como narración privada, sin observable.
          const txt = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
          usage.ms = Date.now() - t0;
          if (!txt) return { ok: false, reason: 'no_log_event', message: 'respuesta vacía', usage, calls };
          return { ok: true, closed: { narration_private: txt, observable: null, observable_vague: null, loudness: 1, tags: ['no_log_event'], suggested_actions: [], requires_roll: null, decisive: null }, usage, calls, rolls: ctx.rolls, context, model: res.model, progress: ctx.progress };
        }

        messages.push({ role: 'assistant', content: res.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          const result = executeTool(ctx, tu.name, input);
          calls.push({ name: tu.name, input, result });
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: result, is_error: result.startsWith('{"error"') });
        }
        messages.push({ role: 'user', content: results });

        if (ctx.closed) {
          usage.ms = Date.now() - t0;
          return { ok: true, closed: ctx.closed, usage, calls, rolls: ctx.rolls, context, model: res.model, progress: ctx.progress };
        }
      }
      // Tope alcanzado: una última llamada solo con log_event para que cierre narrando lo conseguido y lo que falló.
      messages.push({ role: 'user', content: 'Has agotado las llamadas a tools. Cierra AHORA con log_event: narra lo que sí ha ocurrido y, si algo no fue posible, dilo en ficción. No intentes más cambios.' });
      const fin = await this.client.create({
        model: cfg.model, max_tokens: 2048,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: cfg.effort },
        system: [{ type: 'text', text: systemPrompt(engine.world.campaign), cache_control: CACHE_TTL }],
        tools: MASTER_TOOLS.filter((t) => t.name === 'log_event'),
        tool_choice: { type: 'tool', name: 'log_event' },
        messages,
      });
      usage.iterations++;
      usage.input += fin.usage.input_tokens; usage.output += fin.usage.output_tokens;
      for (const tu of fin.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        calls.push({ name: tu.name, input, result: executeTool(ctx, tu.name, input) });
      }
      usage.ms = Date.now() - t0;
      if (ctx.closed) return { ok: true, closed: { ...ctx.closed, tags: [...ctx.closed.tags, 'max_iterations'] }, usage, calls, rolls: ctx.rolls, context, model: fin.model, progress: ctx.progress };
      console.warn('[master] llamadas:', JSON.stringify(calls.map((c) => ({ name: c.name, input: c.input, result: c.result.slice(0, 120) }))));
      return { ok: false, reason: 'max_iterations', message: `más de ${cfg.max_tool_calls} llamadas a tools sin cerrar`, usage, calls };
    } catch (e) {
      usage.ms = Date.now() - t0;
      const msg = e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message;
      return { ok: false, reason: 'api_error', message: msg, usage, calls };
    }
  }
}
