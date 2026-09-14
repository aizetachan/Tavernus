/**
 * Tools del master (SPEC §7). Contrato exacto: esquemas estrictos y ejecución
 * contra el motor. El master no puede cambiar nada del mundo salvo por aquí.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Engine } from '../engine/engine.js';
import { rollExpr, type Advantage, type CheckResult, type Rng, type RollResult } from '../engine/dice.js';
import { inventoryDetailed, inventoryView, spawnItem, transferItem } from '../engine/inventory.js';
import type { Character, Id, Placement } from '../engine/model.js';
import { moveTo, positionOf } from '../engine/movement.js';
import { perceive, witnesses } from '../engine/perception.js';
import type { Position } from '../engine/movement.js';
import { harvest, regenState } from '../engine/resources.js';
import { activeJobs, addPractice, buyFromNpc, completeJob, grantClue, sellToNpc, type ProgressEvent } from '../engine/progress.js';
import { attitudeOf, resolveAttack } from '../engine/combat.js';
import { characterCheck, SKILLS, type CheckKind } from '../engine/rules.js';
import { fmtDuration } from '../engine/narrate.js';

type Tool = Anthropic.Beta.BetaTool;

const str = (description: string) => ({ type: 'string' as const, description });
const nstr = (description: string) => ({ type: ['string', 'null'] as const, description });
const num = (description: string) => ({ type: 'number' as const, description });
const nnum = (description: string) => ({ type: ['number', 'null'] as const, description });
const bool = (description: string) => ({ type: 'boolean' as const, description });
const enm = (values: string[], description: string) => ({ type: 'string' as const, enum: values, description });

/** Sin modo estricto: con tantos campos la API rechaza la gramática ("Schema is too complex"). El servidor valida cada entrada. */
function tool(name: string, description: string, properties: Record<string, unknown>): Tool {
  return {
    name, description, strict: false,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

export const ROLL_KINDS = ['skill', 'save', 'ability', 'attack'];
export const ADV = ['none', 'advantage', 'disadvantage'];

/** Orden fijo y determinista: los tools van al principio del prefijo cacheado. */
export const MASTER_TOOLS: Tool[] = [
  tool('get_location', 'Detalle de una localización: puntos visibles para el actor, salidas, estado, objetos en el suelo, NPCs. Usa "here" para la actual.', {
    location_id: str('ID de la localización o "here"'),
  }),
  tool('get_character', 'Hoja de un personaje jugador. Del actor: completa. De otros: solo lo visible.', { character_id: str('ID del personaje') }),
  tool('get_npc', 'Ficha de un NPC presente.', { npc_id: str('ID del NPC') }),
  tool('get_item', 'Detalle de un objeto (ejemplar) al alcance.', { instance_id: str('ID del ejemplar') }),
  tool('who_is_here', 'Quién percibe el actor a su alrededor y con qué nivel (full/vague/hint).', { unused: nstr('Sin uso; pasa null') }),
  tool('get_recent_events', 'Últimos eventos de la localización que el actor ha percibido.', { n: num('Cuántos, 1-30') }),

  tool('roll_dice', 'Tirada de dados genérica del servidor (daño, tablas, NPCs). Para pruebas del propio jugador usa requires_roll en log_event.', {
    expr: str('Expresión: "2d6+3", "1d20+5", "4d6kh3"'),
    reason: str('Para qué es la tirada'),
    dc: nnum('CD a superar, o null'),
  }),
  tool('roll_check', 'Tirada oculta de un personaje (percepción pasiva, sigilo que no se anuncia, NPC contra PJ). No la uses para la acción principal del jugador: eso va con requires_roll en log_event.', {
    character_id: str('ID del personaje que tira'),
    kind: enm(ROLL_KINDS, 'Tipo de prueba'),
    key: str('Skill 5e en inglés (athletics, stealth, perception…), característica (str/dex/…) o "melee"/"ranged" para ataque'),
    dc: nnum('CD, o null si es enfrentada'),
    advantage: enm(ADV, 'Ventaja o desventaja'),
  }),

  tool('move_to', 'Pone al personaje en camino hacia un punto. El servidor calcula ruta y tiempo; nunca es instantáneo.', {
    character_id: str('ID del personaje'),
    target_spot_id: str('ID del punto de destino'),
    pace: enm(['stealth', 'walk', 'run'], 'Ritmo'),
  }),
  tool('transfer_item', 'Mueve un objeto entre suelo, personaje (mano/bolsillo/equipado), contenedor o NPC. Atómico; falla con no_space si no cabe.', {
    instance_id: str('ID del ejemplar'),
    to_type: enm(['spot', 'character', 'container', 'npc'], 'Tipo de destino'),
    to_id: str('ID del destino'),
    slot: enm(['hand_main', 'hand_off', 'hand_both', 'pocket', 'equipped'], 'Solo si el destino es un personaje'),
    equip_slot: nstr('Si slot es equipped: head/body/hands/feet/neck/ring1/ring2/back/belt; si no, null'),
    quantity: nnum('Cantidad, o null para todo el stack'),
  }),
  tool('spawn_item', 'Crea un objeto del catálogo en el suelo de un punto. Solo para improvisación razonable (algo que lógicamente estaría ahí).', {
    item_id: str('ID del catálogo de objetos'),
    quantity: num('Cantidad'),
    spot_id: str('Punto donde aparece'),
  }),
  tool('update_spot_state', 'Cambia el estado de un punto (puerta abierta, vidriera rota, sangre en el suelo…). Lo que un jugador altera tiene que quedar aquí.', {
    spot_id: str('ID del punto'),
    patch_json: str('JSON con las claves a cambiar, p. ej. {"window_broken": true}'),
  }),
  tool('update_location_state', 'Cambia el estado de la localización entera.', {
    location_id: str('ID de la localización o "here"'),
    patch_json: str('JSON con las claves a cambiar'),
  }),
  tool('discover_spot', 'Marca un punto oculto como descubierto por un personaje (tras una tirada con éxito).', {
    character_id: str('ID del personaje'), spot_id: str('ID del punto oculto'),
  }),
  tool('harvest', 'Extrae de un nodo de recurso (talar, recolectar, pescar). El servidor tira la skill del nodo contra su CD, calcula rendimiento y regeneración y cuenta la práctica. No pidas requires_roll para esto.', {
    character_id: str('ID del personaje'), node_id: str('ID del nodo'),
  }),
  tool('grant_clue', 'Concede una pista de la demo al actor. SOLO cuando el jugador la ha obtenido de verdad con sus actos (ver "cómo se obtiene" de cada pista). Una vez por personaje.', {
    character_id: str('ID del personaje'), clue_id: str('ID de la pista'),
  }),
  tool('complete_job', 'Cierra un encargo del tablón para el actor al entregárselo al NPC que lo pidió. El servidor valida entrega (quita los objetos), paga y sube reputación. Para encargos narrativos, llámalo solo cuando el objetivo se haya cumplido de verdad en la ficción.', {
    character_id: str('ID del personaje'), job_id: str('ID del encargo'), npc_id: str('ID del NPC al que se entrega'),
  }),
  tool('sell_item', 'Vende un objeto a un NPC que lo compre, al precio de su lista. Cobra en el acto.', {
    character_id: str('ID del personaje'), npc_id: str('ID del NPC'), instance_id: str('ID del ejemplar'), quantity: nnum('Cantidad, o null para todo'),
  }),
  tool('buy_item', 'Compra a un NPC algo de su lista de venta. Descuenta monedas y lo pone en manos/bolsillo (o en el suelo si no cabe).', {
    character_id: str('ID del personaje'), npc_id: str('ID del NPC'), item_id: str('ID del catálogo'), quantity: num('Cantidad'),
  }),
  tool('attack', 'Ataque de un NPC (o de un PJ fuera del flujo de tirada del jugador). El servidor tira contra la CA, calcula y aplica el daño. Para el ataque del propio jugador usa requires_roll con kind=attack y requires_roll_target.', {
    attacker_id: str('ID del que ataca (NPC o personaje)'), target_id: str('ID del objetivo'), advantage: enm(ADV, 'Ventaja o desventaja'),
  }),
  tool('apply_damage', 'Quita puntos de golpe a un personaje o NPC por daño que no es un ataque (caída, fuego, trampa).', {
    target_id: str('ID del personaje o NPC'), amount: num('Daño'), damage_type: str('Tipo: slashing, fire, falling…'), source: str('Qué lo causa'),
  }),
  tool('heal', 'Devuelve puntos de golpe a un personaje o NPC.', { target_id: str('ID del personaje o NPC'), amount: num('PG curados') }),
  tool('add_condition', 'Añade una condición a un personaje.', {
    target_id: str('ID del personaje'), name: str('Condición 5e en español: envenenado, asustado, agarrado…'), source: str('Origen'),
    duration_game_min: nnum('Minutos de juego, o null si dura hasta que algo la quite'),
  }),
  tool('remove_condition', 'Quita una condición.', { target_id: str('ID del personaje'), name: str('Condición') }),

  tool('log_event', 'CIERRE OBLIGATORIO de cada acción. Registra lo ocurrido y lo entrega a cada personaje según lo que percibe. Tras llamarlo, termina.', {
    narration_private: str('Lo que ve el actor. Segunda persona. Breve.'),
    observable: nstr('Lo que ve un testigo cercano con detalle completo, en tercera persona con el nombre del actor. null si no hay nada observable.'),
    observable_vague: nstr('Lo mismo para quien solo distingue una figura, sin nombre ni detalle. null si no aplica.'),
    loudness: num('Volumen: 0.15 susurro, 1 normal, 5 grito, 15 estruendo'),
    tags: str('Etiquetas separadas por comas: social, exploration, combat, milestone…'),
    suggested_actions: str('2-4 acciones sugeridas para ESTE personaje, separadas por " | ". Cadena vacía si no procede o si pides tirada (requires_roll): entonces solo se ofrece el dado.'),
    requires_roll_kind: nstr('Si la acción necesita una tirada del jugador antes de resolverse: skill/save/ability/attack. null si no.'),
    requires_roll_key: nstr('Skill, característica o melee/ranged. null si no hay tirada.'),
    requires_roll_dc: nnum('CD oculta. null si no hay tirada.'),
    requires_roll_advantage: nstr('none/advantage/disadvantage. null si no hay tirada.'),
    requires_roll_target: nstr('Si la tirada es un ataque: ID del objetivo (NPC o personaje). El servidor resolverá impacto y daño. null si no.'),
    decisive_threat: nstr('Ventana de respuesta decisiva: SOLO si hay una amenaza real e inmediata contra el actor (un enemigo a punto de golpearle, un suelo que cede). Describe en una frase qué le pasa si no responde en 60 s. null en cualquier otro caso.'),
    decisive_npc_id: nstr('NPC que amenaza en esa ventana, o null.'),
    npc_id: nstr('Si en esta acción el actor ha hablado con un NPC: su ID. Si no, null.'),
    npc_memory_note: nstr('Solo si ha hablado con ese NPC y hay algo que esa persona recordaría del actor (su nombre, qué le preguntó, un favor, una ofensa, una promesa, dinero). Una frase en tercera persona. null si no hay nada que recordar o si no ha habido conversación.'),
    npc_memory_importance: nnum('1 = se olvida en días (una charla, una pregunta); 2 = dura semanas (un favor, un pago, una amenaza); 3 = no se olvida nunca (le salvó la vida, le robó, le humilló). null si no hay nota.'),
    names_learned: nstr('IDs (separados por comas) de NPCs o personajes cuyo NOMBRE el actor ha aprendido en esta acción porque se presentaron o alguien los nombró. null si ninguno.'),
    introduces_self: bool('true si el actor ha dicho su propio nombre en voz alta en esta acción (los presentes lo aprenden).'),
  }),
];

export const MEMORY_CAP_PER_CHARACTER = 8;
export const MEMORY_CAP_PER_NPC = 40;

// ---------------------------------------------------------------------------

export interface ToolContext {
  engine: Engine;
  actor: Character;
  nowGameS: number;
  rng: Rng;
  /** Rellenado por log_event. */
  closed: LogEventInput | null;
  rolls: RollResult[];
  /** Avisos de progreso (pista, encargo, práctica, logro) para emitir como sistema tras la acción. */
  progress: ProgressEvent[];
}

export interface LogEventInput {
  narration_private: string;
  observable: string | null;
  observable_vague: string | null;
  loudness: number;
  tags: string[];
  suggested_actions: string[];
  requires_roll: { kind: CheckKind; key: string; dc: number | null; advantage: Advantage; target?: string } | null;
  decisive: { threat: string; npc_id: string | null } | null;
}

/** PJs que oyen al actor con detalle (banda full de oído). */
function witnessesOf(engine: Engine, at: Position, nowGameS: number, exclude: string): Character[] {
  return witnesses(engine.world, engine.clock, at, nowGameS, 1, exclude).filter((w) => w.perceived.sound === 'full').map((w) => w.character);
}

/** Quita restos de sintaxis de llamada (XML de parámetros) que a veces se cuelan en los textos. */
export function cleanText(t: string): string {
  return t.replace(/<\/?(?:parameter|narration_private|observable|observable_vague|invoke|function_calls)[^>]*>[\s\S]*$/i, '').replace(/<\/?[a-z_]+>\s*$/i, '').trim();
}

export function executeTool(ctx: ToolContext, name: string, input: Record<string, unknown>): string {
  try {
    const out = run(ctx, name, input);
    return typeof out === 'string' ? out : JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}

function run(ctx: ToolContext, name: string, input: Record<string, unknown>): unknown {
  const { engine, actor, nowGameS } = ctx;
  const world = engine.world;
  const s = (k: string) => String(input[k] ?? '');
  const here = () => positionOf(world, actor, nowGameS).location_id;

  switch (name) {
    case 'get_location': {
      const id = s('location_id') === 'here' ? here() : s('location_id');
      const loc = world.location(id);
      const spots = world.spotsOf(id).filter((sp) => !sp.hidden || sp.discovered_by.includes(actor.id)).map((sp) => ({
        id: sp.id, name: sp.name, description: sp.description, x: sp.x, y: sp.y, tags: sp.tags, state: sp.state,
        items: world.itemsIn({ type: 'spot', id: sp.id }).map((i) => `${i.id}: ${world.itemDef(i.item_id).name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`),
        resources: [...world.resourceNodes.values()].filter((n) => n.spot_id === sp.id).map((n) => `${n.id}: ${n.name} (${Math.round(regenState(n, nowGameS) * 100)}%)`),
        npcs: world.npcsAt(sp.id).map((n) => `${n.id}: ${n.name}, ${n.role}`),
      }));
      const exits: string[] = [];
      for (const sp of world.spotsOf(id)) for (const { exit, to_spot_id } of world.exitsFrom(sp.id)) {
        exits.push(`${sp.name} → ${world.locationOfSpot(to_spot_id).name} (${world.spot(to_spot_id).id}), ${exit.distance_m} m${exit.state.blocked_by ? `, bloqueada: ${exit.state.blocked_by}` : ''}`);
      }
      return { id: loc.id, name: loc.name, description_base: loc.description_base, indoor: loc.indoor, ambience: loc.ambience, state: loc.state, spots, exits };
    }
    case 'get_character': {
      const c = world.character(s('character_id'));
      const inv = inventoryView(world, c.id);
      const pos = positionOf(world, c, nowGameS);
      const pub = { id: c.id, name: c.name, race: c.race, class_name: c.class_name, appearance: c.appearance, status: c.status, spot_id: pos.spot_id, hands: inv.hands, equipped: inv.equipped, conditions: c.conditions.map((x) => x.name), hp_hint: c.hp_current >= c.hp_max ? 'ileso' : c.hp_current > c.hp_max / 2 ? 'herido' : 'malherido' };
      if (c.id !== actor.id) return pub;
      return { ...pub, level: c.level, abilities: c.abilities, hp: `${c.hp_current}/${c.hp_max}`, proficiencies: c.proficiencies, inventory: inventoryDetailed(world, c.id), coins: c.coins, encumbrance: inv.encumbrance.level, backstory: c.backstory };
    }
    case 'get_npc': {
      const n = world.npc(s('npc_id'));
      return {
        id: n.id, name: n.name, role: n.role, status: n.status, spot_id: n.location.id, description: n.description, motivation: n.motivation, secret: n.secret,
        attitude_to_actor: attitudeOf(n, actor.id), combat: n.stats ? { ac: n.stats.ac, hp: `${n.stats.hp}/${n.stats.hp_max}`, attack: `${n.stats.attack_name} +${n.stats.attack_bonus}, ${n.stats.damage} ${n.stats.damage_type}` } : null,
        remembers_about_actor: n.memory.filter((m) => m.character_id === actor.id).map((m) => `[${engine.clock.format(m.game_s)}] ${m.note}`),
        remembers_about_others: n.memory.filter((m) => m.character_id !== actor.id && m.importance >= 2).slice(-5).map((m) => `[${engine.clock.format(m.game_s)}] ${world.characters.get(m.character_id)?.name ?? '?'}: ${m.note}`),
        talking_to: n.talking_to ? (world.characters.get(n.talking_to.character_id)?.name ?? null) : null,
      };
    }
    case 'get_item': {
      const i = world.itemInstance(s('instance_id'));
      const d = world.itemDef(i.item_id);
      return { instance_id: i.id, item_id: d.id, name: d.name, type: d.type, size: d.size, weight_lb: d.weight_lb, quantity: i.quantity, state: i.state, location: i.location, container: d.container ?? null };
    }
    case 'who_is_here': {
      const pos = positionOf(world, actor, nowGameS);
      const out: unknown[] = [];
      for (const o of world.characters.values()) {
        if (o.id === actor.id || o.status === 'dead' || o.status === 'retired') continue;
        const op = positionOf(world, o, nowGameS);
        if (op.location_id !== pos.location_id) continue;
        const p = perceive(world, engine.clock, actor, op, nowGameS);
        if (p.level === 'none') continue;
        out.push({ id: o.id, name: p.sight === 'full' ? o.name : '(figura)', level: p.level, sight: p.sight, sound: p.sound, spot_id: op.spot_id, distance_m: Math.round(p.distance_m ?? 0), status: o.status });
      }
      for (const n of world.npcs.values()) {
        const ns = world.spot(n.location.id);
        if (ns.location_id !== pos.location_id || n.status !== 'alive') continue;
        const p = perceive(world, engine.clock, actor, { spot_id: ns.id, next_spot_id: null, progress: 0, x: ns.x, y: ns.y, location_id: ns.location_id }, nowGameS);
        if (p.level === 'none') continue;
        out.push({ id: n.id, name: p.sight === 'full' ? n.name : '(figura)', role: n.role, level: p.level, spot_id: ns.id, distance_m: Math.round(p.distance_m ?? 0) });
      }
      return out;
    }
    case 'get_recent_events': {
      const n = Math.max(1, Math.min(30, Number(input['n']) || 10));
      return engine.events.forCharacter(actor.id, null).slice(-n).map((d) => `[${engine.clock.format(d.event.timestamp_game_s)}] ${d.text}`);
    }
    case 'roll_dice': {
      const r = rollExpr(s('expr'), ctx.rng);
      ctx.rolls.push(r);
      const dc = input['dc'] == null ? null : Number(input['dc']);
      return { ...r, reason: s('reason'), dc, success: dc === null ? null : r.total >= dc };
    }
    case 'roll_check': {
      const c = world.character(s('character_id'));
      const r: CheckResult & { label: string } = characterCheck(c, s('kind') as CheckKind, s('key'), input['dc'] == null ? null : Number(input['dc']), (s('advantage') || 'none') as Advantage, ctx.rng);
      ctx.rolls.push(r);
      return { character: c.name, check: r.label, breakdown: r.breakdown, total: r.total, success: r.success, natural: r.natural ?? null };
    }
    case 'move_to': {
      const r = moveTo(world, s('character_id'), s('target_spot_id'), s('pace') as 'walk', nowGameS);
      if (!r.ok) return { error: r.error.code, detail: r.error };
      return { ok: true, destination: world.spot(r.transit.destination_spot_id).name, game_time: fmtDuration(r.total_s), real_time: fmtDuration(engine.clock.gameToReal(r.total_s)), legs: r.transit.legs.map((l) => world.spot(l.to_spot_id).name) };
    }
    case 'transfer_item': {
      const toType = s('to_type');
      let to: Placement;
      if (toType === 'character') {
        const slot = s('slot');
        const carry = slot === 'pocket' ? { kind: 'pocket' as const }
          : slot === 'equipped' ? { kind: 'equipped' as const, slot: s('equip_slot') as 'back' }
          : { kind: 'hand' as const, which: (slot === 'hand_off' ? 'off' : slot === 'hand_both' ? 'both' : 'main') as 'main' };
        to = { type: 'character', id: s('to_id'), slot: carry };
      } else to = { type: toType as 'spot', id: s('to_id') };
      const r = transferItem(world, s('instance_id'), to, input['quantity'] == null ? undefined : Number(input['quantity']));
      if (!r.ok) return { error: r.error.code, detail: r.error };
      return { ok: true, item: world.itemDef(r.moved.item_id).name, quantity: r.moved.quantity };
    }
    case 'spawn_item': {
      if (world.campaign.master.improvisation < 3) return { error: 'improvisation_too_low' };
      const r = spawnItem(world, s('item_id'), Math.max(1, Number(input['quantity']) || 1), { type: 'spot', id: s('spot_id') });
      if (!r.ok) return { error: r.error.code, detail: r.error };
      return { ok: true, instance_id: r.moved.id, item: world.itemDef(r.moved.item_id).name };
    }
    case 'update_spot_state': {
      const sp = world.spot(s('spot_id'));
      Object.assign(sp.state, JSON.parse(s('patch_json')) as Record<string, unknown>);
      world.touch('spots', sp.id);
      return { ok: true, state: sp.state };
    }
    case 'update_location_state': {
      const loc = world.location(s('location_id') === 'here' ? here() : s('location_id'));
      Object.assign(loc.state, JSON.parse(s('patch_json')) as Record<string, unknown>);
      world.touch('locations', loc.id);
      return { ok: true, state: loc.state };
    }
    case 'discover_spot': {
      const sp = world.spot(s('spot_id'));
      const cid = s('character_id');
      if (!sp.discovered_by.includes(cid)) { sp.discovered_by.push(cid); world.touch('spots', sp.id); }
      return { ok: true, spot: sp.name };
    }
    case 'harvest': {
      const c = world.character(s('character_id'));
      const node = world.resourceNode(s('node_id'));
      const check = characterCheck(c, 'skill', node.skill, node.dc, 'none', ctx.rng);
      ctx.rolls.push(check);
      const r = harvest(world, c, node.id, check.success === true, nowGameS);
      if (node.dc >= world.campaign.progression.practice_min_dc) { const pe = addPractice(world, c, node.skill); if (pe) ctx.progress.push(pe); }
      if (!r.ok) return { error: r.code, check: check.breakdown, regen: r.regen };
      return { ok: true, check: check.breakdown, quantity: r.quantity, item: world.itemDef(node.resource_item_id).name, regen_after: r.regen_after };
    }
    case 'grant_clue': {
      const r = grantClue(world, world.character(s('character_id')), s('clue_id'));
      if (!r.ok) return { error: r.reason };
      ctx.progress.push(...r.events);
      return { ok: true, events: r.events.map((e) => e.text) };
    }
    case 'complete_job': {
      const r = completeJob(world, world.character(s('character_id')), s('job_id'), s('npc_id'));
      if (!r.ok) return { error: r.reason };
      ctx.progress.push(...r.events);
      return { ok: true, events: r.events.map((e) => e.text), board: activeJobs(world).map((j) => j.title) };
    }
    case 'sell_item': {
      const r = sellToNpc(world, world.character(s('character_id')), s('npc_id'), s('instance_id'), input['quantity'] == null ? undefined : Number(input['quantity']));
      return r.ok ? { ok: true, sold: `${r.item} ×${r.quantity}`, total: r.total } : { error: r.reason };
    }
    case 'buy_item': {
      const r = buyFromNpc(world, world.character(s('character_id')), s('npc_id'), s('item_id'), Number(input['quantity']) || 1);
      return r.ok ? { ok: true, bought: `${r.item} ×${r.quantity}`, total: r.total } : { error: r.reason };
    }
    case 'attack': {
      const r = resolveAttack(world, s('attacker_id'), s('target_id'), (ADV.includes(s('advantage')) ? s('advantage') : 'none') as Advantage, ctx.rng);
      if ('error' in r) return { error: r.error };
      ctx.rolls.push({ expr: 'attack', total: r.attack_total, breakdown: r.attack_breakdown, rolls: [] });
      return r;
    }
    case 'apply_damage': {
      const npcT = world.npcs.get(s('target_id'));
      if (npcT) {
        if (!npcT.stats) return { error: 'ese NPC no tiene puntos de golpe' };
        npcT.stats.hp = Math.max(0, npcT.stats.hp - Math.max(0, Math.floor(Number(input['amount']) || 0)));
        if (npcT.stats.hp === 0) { npcT.status = 'dead'; for (const i of world.itemsIn({ type: 'npc', id: npcT.id })) { i.location = { type: 'spot', id: npcT.location.id }; world.touch('item_instances', i.id); } }
        world.touch('npcs', npcT.id);
        return { ok: true, hp: `${npcT.stats.hp}/${npcT.stats.hp_max}`, status: npcT.status };
      }
      const c = world.character(s('target_id'));
      let amount = Math.max(0, Math.floor(Number(input['amount']) || 0));
      const fromTemp = Math.min(c.hp_temp, amount);
      c.hp_temp -= fromTemp; amount -= fromTemp;
      c.hp_current = Math.max(0, c.hp_current - amount);
      if (c.hp_current === 0 && c.status === 'active') c.status = 'unconscious';
      world.touch('characters', c.id);
      return { ok: true, hp: `${c.hp_current}/${c.hp_max}`, status: c.status };
    }
    case 'heal': {
      const npcH = world.npcs.get(s('target_id'));
      if (npcH) {
        if (!npcH.stats) return { error: 'ese NPC no tiene puntos de golpe' };
        npcH.stats.hp = Math.min(npcH.stats.hp_max, npcH.stats.hp + Math.max(0, Math.floor(Number(input['amount']) || 0)));
        world.touch('npcs', npcH.id);
        return { ok: true, hp: `${npcH.stats.hp}/${npcH.stats.hp_max}` };
      }
      const c = world.character(s('target_id'));
      c.hp_current = Math.min(c.hp_max, c.hp_current + Math.max(0, Math.floor(Number(input['amount']) || 0)));
      if (c.hp_current > 0 && c.status === 'unconscious') c.status = 'active';
      world.touch('characters', c.id);
      return { ok: true, hp: `${c.hp_current}/${c.hp_max}`, status: c.status };
    }
    case 'add_condition': {
      const c = world.character(s('target_id'));
      const mins = input['duration_game_min'] == null ? null : Number(input['duration_game_min']);
      c.conditions = c.conditions.filter((x) => x.name !== s('name'));
      c.conditions.push({ name: s('name'), source: s('source'), expires_game_s: mins === null ? null : nowGameS + mins * 60 });
      world.touch('characters', c.id);
      return { ok: true, conditions: c.conditions.map((x) => x.name) };
    }
    case 'remove_condition': {
      const c = world.character(s('target_id'));
      c.conditions = c.conditions.filter((x) => x.name !== s('name'));
      world.touch('characters', c.id);
      return { ok: true, conditions: c.conditions.map((x) => x.name) };
    }
    case 'log_event': {
      const kind = input['requires_roll_kind'];
      const req = kind && ROLL_KINDS.includes(String(kind))
        ? { kind: String(kind) as CheckKind, key: s('requires_roll_key'), dc: input['requires_roll_dc'] == null ? null : Number(input['requires_roll_dc']), advantage: (ADV.includes(s('requires_roll_advantage')) ? s('requires_roll_advantage') : 'none') as Advantage, ...(input['requires_roll_target'] ? { target: s('requires_roll_target') } : {}) }
        : null;
      if (req?.kind === 'attack' && !req.target) return { error: 'un ataque necesita requires_roll_target (ID del objetivo)' };
      if (req?.target && !world.npcs.has(req.target) && !world.characters.has(req.target)) return { error: `objetivo desconocido: ${req.target}` };
      if (req && req.kind === 'skill' && !SKILLS[req.key]) return { error: `skill desconocida: ${req.key}. Válidas: ${Object.keys(SKILLS).join(', ')}` };
      if (input['npc_id']) {
        const npc = world.npcs.get(s('npc_id'));
        if (npc) {
          npc.talking_to = { character_id: actor.id, since_game_s: nowGameS };
          const note = input['npc_memory_note'] == null ? '' : cleanText(s('npc_memory_note'));
          if (note) {
            const imp = Math.min(3, Math.max(1, Math.round(Number(input['npc_memory_importance']) || 1))) as 1 | 2 | 3;
            npc.memory.push({ character_id: actor.id, game_s: nowGameS, note, importance: imp });
            // Topes: por PJ (se descartan las menos importantes y más viejas) y por NPC.
            const mine = npc.memory.filter((m) => m.character_id === actor.id);
            if (mine.length > MEMORY_CAP_PER_CHARACTER) {
              const drop = [...mine].sort((a, b) => a.importance - b.importance || a.game_s - b.game_s)[0]!;
              npc.memory = npc.memory.filter((m) => m !== drop);
            }
            if (npc.memory.length > MEMORY_CAP_PER_NPC) {
              const drop = [...npc.memory].sort((a, b) => a.importance - b.importance || a.game_s - b.game_s)[0]!;
              npc.memory = npc.memory.filter((m) => m !== drop);
            }
          }
          world.touch('npcs', npc.id);
        }
      }
      if (input['names_learned']) {
        for (const id of s('names_learned').split(',').map((x) => x.trim()).filter(Boolean)) {
          if ((world.npcs.has(id) || world.characters.has(id)) && id !== actor.id && !actor.knows.includes(id)) actor.knows.push(id);
        }
        world.touch('characters', actor.id);
      }
      if (input['introduces_self'] === true) {
        const at = positionOf(world, actor, nowGameS);
        for (const w of witnessesOf(engine, at, nowGameS, actor.id)) {
          if (!w.knows.includes(actor.id)) { w.knows.push(actor.id); world.touch('characters', w.id); }
        }
      }
      ctx.closed = {
        narration_private: cleanText(s('narration_private')),
        observable: input['observable'] == null ? null : cleanText(s('observable')) || null,
        observable_vague: input['observable_vague'] == null ? null : cleanText(s('observable_vague')) || null,
        loudness: Number(input['loudness']) || 1,
        tags: s('tags').split(',').map((t) => t.trim()).filter(Boolean),
        suggested_actions: s('suggested_actions').split('|').map((t) => t.trim()).filter(Boolean).slice(0, 4),
        requires_roll: req,
        decisive: input['decisive_threat'] ? { threat: cleanText(s('decisive_threat')), npc_id: input['decisive_npc_id'] ? s('decisive_npc_id') : null } : null,
      };
      return { ok: true, closed: true };
    }
    default:
      return { error: `tool desconocido: ${name}` };
  }
}

