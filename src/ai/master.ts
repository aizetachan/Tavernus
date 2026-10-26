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
import { cleanText, executeTool, MASTER_TOOLS, WRITE_TOOLS, type LogEventInput, type ToolContext } from './tools.js';
import type { Approach } from '../engine/movement.js';
import { isPlaceholder, rollCategory, withoutSelfCorrection } from '../engine/closecheck.js';
import type { ProgressEvent } from '../engine/progress.js';
import type { ShownRoll } from '../engine/rolls.js';

export interface MasterClient {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
}

export interface MasterUsage { input: number; output: number; cache_read: number; cache_write: number; iterations: number; ms: number }

export interface ToolCallRecord { name: string; input: Record<string, unknown>; result: string }

/** Un tool de escritura que falló en esta acción: lo que el máster no puede narrar como hecho. */
export interface ToolFailure { name: string; input: Record<string, unknown>; error: string }

/** Razón legible de un resultado de error: código, motivo y pista. */
export function failureReason(result: string): string {
  try {
    const r = JSON.parse(result) as { error?: unknown; detail?: { reason?: unknown }; hint?: unknown };
    return [r.error, r.detail?.reason, r.hint].filter((x) => typeof x === 'string' && x).join(': ') || result;
  } catch { return result; }
}

/** Aviso al máster tras un tool de escritura fallido (va antes de que siga). */
export function failureNotice(f: { name: string; error: string }): string {
  return `El tool ${f.name} falló: ${failureReason(f.error)}. Narra que NO ha ocurrido o pide lo que falta; no narres el efecto.`;
}

export type MasterOutcome =
  | { ok: true; closed: LogEventInput; usage: MasterUsage; calls: ToolCallRecord[]; rolls: RollResult[]; context: string; model: string; progress: ProgressEvent[]; shown_rolls: ShownRoll[]; tool_errors?: ToolFailure[]; approach?: Approach }
  | { ok: false; reason: 'refusal' | 'no_log_event' | 'api_error' | 'max_iterations' | 'not_configured'; message: string; usage?: MasterUsage; calls?: ToolCallRecord[] };

export interface MasterOptions {
  client?: MasterClient;
  rng?: Rng;
  /** Tiempo máximo por acción, ms reales. */
  timeoutMs?: number;
}

const CACHE_TTL: Anthropic.Beta.BetaCacheControlEphemeral = { type: 'ephemeral', ttl: '1h' };

/** Haiku no admite el parámetro de fallbacks ante rechazos; el resto de la familia 5 sí. */
function modelSupportsFallbacks(model: string): boolean {
  return !model.startsWith('claude-haiku');
}

/**
 * Modelo y esfuerzo efectivos: la campaña manda, salvo que MASTER_MODEL / MASTER_EFFORT
 * los sobrescriban (pensado para partidas de prueba con un modelo barato).
 */
export function effectiveModel(cfg: { model: string; effort: 'low' | 'medium' | 'high' }, env: NodeJS.ProcessEnv = process.env): { model: string; effort: 'low' | 'medium' | 'high' } {
  const model = env['MASTER_MODEL']?.trim() || cfg.model;
  const e = env['MASTER_EFFORT']?.trim();
  const effort = e === 'low' || e === 'medium' || e === 'high' ? e : cfg.effort;
  return { model, effort };
}

/** Cliente real contra la API (SDK de Anthropic). Lee la clave del entorno. */
export function liveClient(timeoutMs = 90_000): MasterClient {
  const sdk = new Anthropic({ timeout: timeoutMs, maxRetries: 2 });
  return { create: (p) => sdk.beta.messages.create(p) };
}

export class Master {
  private readonly client: MasterClient;
  private readonly rng: Rng;
  private readonly timeoutMs: number;

  constructor(private readonly engine: Engine, opts: MasterOptions = {}) {
    this.rng = opts.rng ?? defaultRng;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.client = opts.client ?? liveClient(this.timeoutMs);
  }

  /** ¿Se puede arrancar el máster? Los modos sin API (offline, replay) siempre; live y record necesitan clave. */
  static configured(mode: 'live' | 'record' | 'replay' | 'offline' = 'live'): boolean {
    if (mode === 'offline' || mode === 'replay') return true;
    return Boolean(process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']);
  }

  /** Resuelve una acción (o la continuación tras una tirada). */
  /**
   * Texto libre en una sola llamada, sin tools (prólogo, recapitulación; docs/PROLOGO.md).
   * null si no sale texto: el cliente offline solo cierra con log_event, y entonces el motor usa su plantilla.
   */
  async write(req: { system: string; prompt: string; max_tokens?: number }): Promise<{ text: string; model: string; usage: { input: number; output: number } } | null> {
    const { model } = effectiveModel(this.engine.world.campaign.master);
    try {
      const res = await this.client.create({
        // La familia 5 piensa siempre (Opus 5.5 no deja apagarlo): esfuerzo bajo y margen para que quede sitio al texto.
        model, max_tokens: req.max_tokens ?? 4000,
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: req.system }],
        messages: [{ role: 'user', content: req.prompt }],
      });
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      return text ? { text, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } } : null;
    } catch (e) {
      console.warn(`[master] write: ${e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message}`);
      return null;
    }
  }

  async resolve(actor: Character, text: string, roll?: RollContext, intro?: { origin: string; welcome: string; prologue?: string }, scene?: Scene, decisive?: DecisiveResponse): Promise<MasterOutcome> {
    const { engine } = this;
    const cfg = engine.world.campaign.master;
    const { model, effort } = effectiveModel(cfg);
    const safeguards: Partial<Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>> = modelSupportsFallbacks(model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
      : {};
    const context = actionContext(engine, actor, text, roll, intro, scene, decisive);
    const ctx: ToolContext = { engine, actor, nowGameS: engine.nowFor(actor), rng: this.rng, closed: null, rolls: [], progress: [], action_text: roll?.original_text ?? (intro || scene ? null : text), roll_category: roll && !/^ataque/i.test(roll.result.label) ? rollCategory(roll.result) : null };
    const calls: ToolCallRecord[] = [];
    const failures: ToolFailure[] = [];
    /** Cierre aceptado: con tool_failed y los errores si algo de escritura falló por el camino. */
    const done = (closed: LogEventInput, m: string): MasterOutcome => ({
      ok: true, closed: failures.length ? { ...closed, tags: [...closed.tags, 'tool_failed'] } : closed, usage, calls, rolls: ctx.rolls, context, model: m, progress: ctx.progress, shown_rolls: ctx.shown_rolls ?? [],
      ...(failures.length ? { tool_errors: failures } : {}), ...(ctx.approach ? { approach: ctx.approach } : {}),
    });
    const usage: MasterUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0, iterations: 0, ms: 0 };
    const t0 = Date.now();

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: context }];

    try {
      for (let i = 0; i < cfg.max_tool_calls + 1; i++) {
        usage.iterations++;
        const res = await this.client.create({
          model,
          max_tokens: 4096,
          ...safeguards,
          output_config: { effort },
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
          // El mismo control mínimo que el cierre: sin relleno y sin arranques en falso.
          const txt = withoutSelfCorrection(cleanText(res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()));
          usage.ms = Date.now() - t0;
          if (!txt || isPlaceholder(txt)) return { ok: false, reason: 'no_log_event', message: txt ? `relleno en lugar de narración: «${txt.slice(0, 40)}»` : 'respuesta vacía', usage, calls };
          return done({ narration_private: txt, observable: null, observable_vague: null, loudness: 1, tags: ['no_log_event'], suggested_actions: [], requires_roll: null, decisive: null }, res.model);
        }

        messages.push({ role: 'assistant', content: res.content });
        // log_event va el último: si un tool de escritura de este mismo mensaje falla, el cierre se rechaza.
        const byId = new Map<string, string>();
        const failedNow: ToolFailure[] = [];
        for (const tu of [...toolUses.filter((t) => t.name !== 'log_event'), ...toolUses.filter((t) => t.name === 'log_event')]) {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          const result = tu.name === 'log_event' && failedNow.length
            ? JSON.stringify({ error: `log_event rechazado: ${failedNow.map((f) => f.name).join(', ')} falló en este mismo mensaje, así que no ha ocurrido. Vuelve a cerrar con log_event narrando que NO ha pasado (o pidiendo lo que falta).` })
            : executeTool(ctx, tu.name, input);
          calls.push({ name: tu.name, input, result });
          byId.set(tu.id, result);
          if (WRITE_TOOLS.has(tu.name) && result.startsWith('{"error"')) failedNow.push({ name: tu.name, input, error: result });
        }
        failures.push(...failedNow);
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((tu) => {
          const result = byId.get(tu.id)!;
          return { type: 'tool_result', tool_use_id: tu.id, content: result, is_error: result.startsWith('{"error"') };
        });
        const notices: Anthropic.Beta.BetaTextBlockParam[] = failedNow.map((f) => ({ type: 'text', text: failureNotice(f) }));
        messages.push({ role: 'user', content: [...results, ...notices] });

        if (ctx.closed) {
          usage.ms = Date.now() - t0;
          return done(ctx.closed, res.model);
        }
      }
      // Tope alcanzado: una última llamada solo con log_event para que cierre narrando lo conseguido y lo que falló.
      messages.push({ role: 'user', content: 'Has agotado las llamadas a tools. Cierra AHORA con log_event: narra lo que sí ha ocurrido y, si algo no fue posible, dilo en ficción. No intentes más cambios.' });
      const fin = await this.client.create({
        model, max_tokens: 2048,
        ...safeguards,
        output_config: { effort },
        system: [{ type: 'text', text: systemPrompt(engine.world.campaign), cache_control: CACHE_TTL }],
        tools: MASTER_TOOLS.filter((t) => t.name === 'log_event'),
        tool_choice: { type: 'auto' },
        messages,
      });
      usage.iterations++;
      usage.input += fin.usage.input_tokens; usage.output += fin.usage.output_tokens;
      for (const tu of fin.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        calls.push({ name: tu.name, input, result: executeTool(ctx, tu.name, input) });
      }
      usage.ms = Date.now() - t0;
      if (ctx.closed) return done({ ...ctx.closed, tags: [...ctx.closed.tags, 'max_iterations'] }, fin.model);
      console.warn('[master] llamadas:', JSON.stringify(calls.map((c) => ({ name: c.name, input: c.input, result: c.result.slice(0, 120) }))));
      return { ok: false, reason: 'max_iterations', message: `más de ${cfg.max_tool_calls} llamadas a tools sin cerrar`, usage, calls };
    } catch (e) {
      usage.ms = Date.now() - t0;
      const msg = e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message;
      return { ok: false, reason: 'api_error', message: msg, usage, calls };
    }
  }
}
