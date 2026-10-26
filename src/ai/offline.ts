/**
 * Máster sin API (MASTER_MODE=offline). Un MasterClient que no llama a nada:
 * lee el contexto de la acción y devuelve un único log_event plausible y
 * determinista. Sirve para probar la web, el motor y el flujo de tiradas sin
 * gastar tokens. No toca el motor: pasa por el mismo bucle de tools que el real.
 */

import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { MasterClient } from './master.js';

export const OFFLINE_MODEL = 'offline';

/** Palabras del texto de la acción que piden una tirada de ataque. */
const ATTACK_RE = /\batac\w*|\bataqu\w*/i;
/** Pedir a un NPC que acompañe al actor, y despedirle (set_npc_order). */
const FOLLOW_RE = /\b(s[ií]gueme|acomp[aá][ñn]a(?:me|nos)|ven conmigo|vente conmigo|venga conmigo|vamos juntos|ven a ayudar\w*)\b/i;
const DISMISS_RE = /\b(puedes irte|ya puedes (?:irte|volver)|vuelve a lo tuyo|ya no hace falta que vengas|deja de seguirme|gracias por acompañarme)\b/i;
/** Verbos de habla: con un solo NPC delante, se entiende que es a él. */
const TALK_RE = /\b(habl\w*|salud\w*|pregunt\w*|dig\w*|dic\w*|charl\w*)/i;

interface ParsedContext {
  actor: string;
  actor_id: string | null;
  action: string | null;
  spots: { id: string; name: string; here: boolean }[];
  exits: { to: string; name: string }[];
  npcs: { id: string; name: string; fights: boolean }[];
  scene: 'intro' | 'arrival' | 'decisive_timeout' | 'roll' | 'action';
  roll: { label: string; outcome: string } | null;
}

/** Extrae del contexto (prompt.ts) lo que necesita la narración. Tolerante: si algo falta, lista vacía. */
export function parseContext(context: string): ParsedContext {
  const actor = /^## Actor: (.+?) \[/m.exec(context)?.[1] ?? 'el personaje';
  const actor_id = /^## Actor: .+? \[([\w-]+)\]/m.exec(context)?.[1] ?? null;
  const action = /^## Acción del jugador\n«([\s\S]*?)»/m.exec(context)?.[1]?.trim() ?? null;
  const spots: ParsedContext['spots'] = [];
  for (const m of context.matchAll(/^- (.+?) \[(sp_[\w-]+)\](?: ← actor aquí| a \d+ m):/gm)) {
    spots.push({ id: m[2]!, name: m[1]!, here: m[0]!.includes('← actor aquí') });
  }
  const exits: ParsedContext['exits'] = [];
  for (const m of context.matchAll(/^- desde .+? a (.+?) \[(sp_[\w-]+)\]/gm)) exits.push({ to: m[2]!, name: m[1]! });
  const npcs: ParsedContext['npcs'] = [];
  for (const m of context.matchAll(/^- NPC (.+?) \[(npc_[\w-]+)\][\s\S]*?(?=^- |^## |(?![\s\S]))/gm)) {
    npcs.push({ id: m[2]!, name: m[1]!, fights: /Combate: CA/.test(m[0]!) });
  }
  const scene: ParsedContext['scene'] = /^## Primera escena/m.test(context) ? 'intro'
    : /^## Llegada/m.test(context) ? 'arrival'
    : /^## Ventana decisiva expirada/m.test(context) ? 'decisive_timeout'
    : /^## Resultado de la tirada/m.test(context) ? 'roll' : 'action';
  const rm = /^## Resultado de la tirada\n.*\n(.+?): .+? → (ÉXITO|FALLO|sin CD)/m.exec(context);
  const roll = rm ? { label: rm[1]!, outcome: rm[2]! } : null;
  return { actor, actor_id, action, spots, exits, npcs, scene, roll };
}

/** 2-3 acciones sacadas de lo que hay en el contexto: un NPC, un punto, una salida. */
function suggestions(p: ParsedContext): string[] {
  const out: string[] = [];
  const npc = p.npcs[0];
  if (npc) out.push(`Hablar con ${npc.name}`);
  const spot = p.spots.find((s) => !s.here);
  if (spot) out.push(`Ir a ${spot.name}`);
  const exit = p.exits[0];
  if (exit) out.push(`Salir hacia ${exit.name}`);
  for (const s of p.spots.filter((x) => !x.here).slice(1)) { if (out.length >= 3) break; out.push(`Examinar ${s.name}`); }
  if (out.length < 2) out.push('Mirar alrededor');
  if (out.length < 2) out.push('Esperar');
  return out.slice(0, 3);
}

function lower(s: string): string { return s.charAt(0).toLowerCase() + s.slice(1); }

/** Construye la entrada del log_event para un contexto. Exportado para tests. */
export function offlineLogEvent(context: string): Record<string, unknown> {
  const p = parseContext(context);
  const base = {
    observable: null, observable_vague: null, loudness: 1, tags: 'offline',
    requires_roll_kind: null, requires_roll_key: null, requires_roll_dc: null, requires_roll_advantage: null, requires_roll_target: null,
    decisive_threat: null, decisive_npc_id: null, npc_id: null, npc_memory_note: null, npc_memory_importance: null, names_learned: null, places_learned: null, introduces_self: false,
  };
  const here = p.spots.find((s) => s.here)?.name ?? 'donde estabas';
  const sug = suggestions(p).join(' | ');
  switch (p.scene) {
    case 'intro':
      return { ...base, narration_private: `Abres los ojos en ${here}. Hace frío y tienes hambre. Nadie te espera, pero el día acaba de empezar.`, suggested_actions: sug };
    case 'arrival':
      return { ...base, narration_private: `Llegas a ${here}. Miras alrededor: todo sigue en su sitio.`, suggested_actions: sug };
    case 'decisive_timeout':
      return { ...base, narration_private: 'Dudas un instante de más. La amenaza pasa de largo esta vez.', suggested_actions: sug };
    case 'roll':
      return { ...base, narration_private: p.roll ? `${p.roll.label}: ${p.roll.outcome === 'ÉXITO' ? 'lo consigues' : p.roll.outcome === 'FALLO' ? 'no lo consigues' : 'el dado habla'}. Nada más cambia.` : 'La tirada se resuelve. Nada más cambia.', suggested_actions: sug };
    case 'action': {
      const action = p.action ?? 'algo';
      if (ATTACK_RE.test(action)) {
        const target = p.npcs.find((n) => n.fights) ?? p.npcs[0];
        if (target) {
          return {
            ...base, narration_private: `Te lanzas contra ${target.name}.`, observable: `${p.actor} se lanza contra ${target.name}.`, observable_vague: 'Una figura se abalanza sobre algo.',
            tags: 'offline,combat', suggested_actions: '',
            requires_roll_kind: 'attack', requires_roll_key: 'melee', requires_roll_dc: null, requires_roll_advantage: 'none', requires_roll_target: target.id,
          };
        }
        return { ...base, narration_private: `Buscas a quién atacar, pero no hay nadie a tu alcance en ${here}.`, suggested_actions: sug };
      }
      // Hablar con un NPC presente (por su nombre, o con un verbo de habla y uno solo delante): diálogo en modo novela.
      const talkTo = addressed(p);
      // Pedirle que venga (o despedirle): lo acepta y queda en orden (set_npc_order, en offlineCalls).
      const order = talkTo ? orderAsked(action) : null;
      if (talkTo && order) {
        const reply = order === 'follow' ? 'Vamos. Tú delante.' : 'Como quieras. Vuelvo a lo mío.';
        return {
          ...base, tags: 'offline,social', npc_id: talkTo.id,
          narration_private: `${talkTo.name} asiente. «${reply}»`,
          observable: `${p.actor} habla con ${talkTo.name}.`,
          lines: [{ speaker: 'npc', npc_id: talkTo.id, text: reply }],
          suggested_actions: sug,
        };
      }
      if (talkTo) {
        // El contexto corta la acción en el primer «»: la comilla de cierre puede faltar.
        const said = /[«"“]([^«»"“”]+)/.exec(action)?.[1]?.trim();
        const reply = 'Bienvenido. Aquí no se pregunta de dónde viene nadie: se paga y se bebe. ¿Qué te pongo?';
        return {
          ...base, tags: 'offline,social', npc_id: talkTo.id,
          narration_private: `${said ? `«${said}», dices. ` : ''}${talkTo.name} levanta la vista. «${reply}»`,
          observable: `${p.actor} habla con ${talkTo.name}.`,
          lines: [...(said ? [{ speaker: 'actor', npc_id: null, text: said }] : []), { speaker: 'npc', npc_id: talkTo.id, text: reply }],
          suggested_actions: sug,
        };
      }
      return { ...base, narration_private: `Haces ${lower(action)}. Nada cambia.`, suggested_actions: sug };
    }
  }
}

function orderAsked(action: string): 'follow' | 'stop' | null {
  return DISMISS_RE.test(action) ? 'stop' : FOLLOW_RE.test(action) ? 'follow' : null;
}

/** El NPC al que se dirige la acción: el nombrado o, con un verbo de habla (o pidiéndole que venga), el único presente. */
function addressed(p: ParsedContext): ParsedContext['npcs'][number] | undefined {
  const action = p.action ?? '';
  return p.npcs.find((n) => action.toLowerCase().includes(n.name.toLowerCase()))
    ?? ((TALK_RE.test(action) || orderAsked(action)) && p.npcs.length === 1 ? p.npcs[0] : undefined);
}

/** Tools antes del cierre: si el jugador pide a un NPC que le acompañe o le despide, set_npc_order. Exportado para tests. */
export function offlineCalls(context: string): { name: string; input: Record<string, unknown> }[] {
  const p = parseContext(context);
  const order = p.scene === 'action' && p.action && !ATTACK_RE.test(p.action) ? orderAsked(p.action) : null;
  const npc = order ? addressed(p) : undefined;
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  if (order && npc) {
    calls.push({ name: 'set_npc_order', input: {
      npc_id: npc.id, order, character_id: p.actor_id, target_spot_id: null, target_location_id: null,
      task_kind: 'none', task_text: null, task_target_id: null, task_amount: null, task_item_id: null, minutes: null,
    } });
  }
  return [...calls, { name: 'log_event', input: offlineLogEvent(context) }];
}

function lastUserText(messages: Anthropic.Beta.BetaMessageParam[]): string {
  const first = messages[0];
  return first && typeof first.content === 'string' ? first.content : '';
}

/**
 * Cliente offline: responde con un tool_use log_event construido desde el
 * primer mensaje (el contexto), precedido de set_npc_order si el jugador pide
 * a un NPC que le acompañe o le despide. Si la conversación ya lleva resultados
 * de tools (segunda iteración, p. ej. porque log_event falló), cierra sin
 * tirada para no bucle.
 */
export function offlineClient(): MasterClient {
  return {
    async create(params) {
      const context = lastUserText(params.messages);
      const calls = params.messages.length > 1
        ? [{ name: 'log_event', input: { ...offlineLogEvent(context), requires_roll_kind: null, requires_roll_key: null, requires_roll_target: null, suggested_actions: 'Mirar alrededor | Esperar' } }]
        : offlineCalls(context);
      const id = createHash('sha256').update(context).digest('hex').slice(0, 12);
      const msg = {
        id: `msg_offline_${id}`, type: 'message', role: 'assistant', model: OFFLINE_MODEL,
        content: calls.map((c, i) => ({ type: 'tool_use', id: `toolu_offline_${id}${i ? `_${i}` : ''}`, name: c.name, input: c.input })),
        stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
      return msg as unknown as Anthropic.Beta.BetaMessage;
    },
  };
}
