/**
 * Validador de mundos: el mismo para un mundo generado (generateSeed, tras
 * buildSnapshot) y para una campaña escrita (src/data/campaigns,
 * authoredSeed). Comprueba lo que el motor da por hecho al arrancar: ids
 * únicos, referencias que existen, puntos de inicio pisables, todo el mapa
 * alcanzable desde el inicio, NPC con bloque SRD de nivel bajo, comercio con
 * objetos del catálogo, Biblia y leyes en su tamaño, situaciones iniciales
 * completas, agenda, horarios, ganchos, rumores y la historia escrita
 * (story.ts). Las reglas de forma (Biblia de 5 a 10 verdades, tres caminos,
 * plazo de 1 a 30 días, rangos SRD) son las mismas que pide el relleno
 * (fill.ts). Vacío = válido.
 */

import { ATTITUDES } from './fill.js';
import { SRD_STAT_RANGES } from './skeleton.js';
import type { Id, WorldSnapshot } from '../engine/model.js';
import type { Hook } from '../engine/hooks.js';
import { RUMOR_KINDS, type Rumor } from '../engine/rumors.js';
import { RECURRENCES, type NpcRoutine, type ScheduledEvent } from '../engine/schedule.js';
import { validateStory, type Story } from '../engine/story.js';
import type { EncounterTable } from '../engine/travel.js';

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';

type Extras = { schedule?: ScheduledEvent[]; hooks?: Hook[]; rumors?: Rumor[]; encounters?: EncounterTable; story?: Story };

export function validateSnapshot(snap: WorldSnapshot): string[] {
  const errs: string[] = [];
  const c = snap.campaign as WorldSnapshot['campaign'] & Extras;

  const ids = <V extends { id: Id }>(what: string, xs: readonly V[]): Map<Id, V> => {
    const m = new Map<Id, V>();
    for (const x of xs) {
      if (blank(x.id)) errs.push(`${what}: hay una id vacía.`);
      if (m.has(x.id)) errs.push(`${what}: la id ${x.id} está repetida.`);
      m.set(x.id, x);
    }
    return m;
  };
  const unique = (what: string, names: string[]) => {
    const seen = new Set<string>();
    for (const n of names) {
      if (blank(n)) { errs.push(`${what}: hay un nombre vacío.`); continue; }
      if (seen.has(norm(n))) errs.push(`${what}: el nombre «${n}» está repetido.`);
      seen.add(norm(n));
    }
  };

  const regions = ids('regiones', snap.regions);
  const zones = ids('zonas', snap.zones);
  const locs = ids('localizaciones', snap.locations);
  const spots = ids('puntos', snap.spots);
  const exits = ids('salidas', snap.exits);
  const npcs = ids('NPC', snap.npcs);
  const defs = ids('objetos', snap.item_defs);
  const insts = ids('ejemplares', snap.item_instances);
  ids('nodos', snap.resource_nodes);
  ids('vehículos', snap.vehicles);
  const chars = ids('personajes', snap.characters);

  // Mapa
  for (const z of snap.zones) if (!regions.has(z.region_id)) errs.push(`zona ${z.id}: la región ${z.region_id} no existe.`);
  unique('localizaciones', snap.locations.map((l) => l.name));
  for (const l of snap.locations) {
    if (!zones.has(l.zone_id)) errs.push(`${l.id}: la zona ${l.zone_id} no existe.`);
    if (blank(l.description_base)) errs.push(`${l.id}: sin descripción.`);
    if (spots.get(l.default_spot_id)?.location_id !== l.id) errs.push(`${l.id}: su punto de entrada ${l.default_spot_id} no es suyo.`);
    const mine = snap.spots.filter((s) => s.location_id === l.id);
    if (!mine.length) errs.push(`${l.id}: no tiene puntos.`);
    unique(`puntos de ${l.id}`, mine.map((s) => s.name));
  }
  for (const s of snap.spots) {
    if (!locs.has(s.location_id)) errs.push(`${s.id}: la localización ${s.location_id} no existe.`);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) errs.push(`${s.id}: sin coordenadas.`);
    if (blank(s.description)) errs.push(`${s.id}: sin descripción.`);
    for (const k of s.links) {
      const to = spots.get(k.to_spot_id);
      if (!to || to.location_id !== s.location_id) errs.push(`${s.id}: el enlace a ${k.to_spot_id} no es de su localización.`);
    }
    const key = s.state['key_item_id'];
    if (s.state['locked'] === true && (typeof key !== 'string' || !defs.has(key))) errs.push(`${s.id}: cerrado con una llave que no existe.`);
  }
  for (const e of snap.exits) {
    const a = spots.get(e.from_spot_id), b = spots.get(e.to_spot_id);
    if (!a || !b) { errs.push(`${e.id}: une puntos que no existen.`); continue; }
    if (a.location_id === b.location_id) errs.push(`${e.id}: une dos puntos de la misma localización.`);
    if (!(e.distance_m > 0)) errs.push(`${e.id}: distancia no positiva.`);
  }
  const start = c.starting_points.map((p) => p.spot_id);
  if (!start.length) errs.push('La campaña no tiene puntos de inicio.');
  for (const id of start) {
    const s = spots.get(id);
    if (!s) errs.push(`inicio: el punto ${id} no existe.`);
    else if (s.hidden || s.state['locked'] === true) errs.push(`inicio: ${id} está oculto o cerrado.`);
  }
  // Todo alcanzable desde el primer inicio, contando pasos ocultos y cerrados (se abren jugando).
  const first = start.map((id) => spots.get(id)).find(Boolean);
  if (first) {
    const reached = new Set<Id>([first.location_id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of snap.exits) {
        const a = spots.get(e.from_spot_id)?.location_id, b = spots.get(e.to_spot_id)?.location_id;
        if (!a || !b) continue;
        if (reached.has(a) && !reached.has(b)) { reached.add(b); grew = true; }
        if (e.bidirectional && reached.has(b) && !reached.has(a)) { reached.add(a); grew = true; }
      }
    }
    for (const l of snap.locations) if (!reached.has(l.id)) errs.push(`${l.id}: no se llega desde el inicio.`);
  }

  // Gente
  unique('NPC', snap.npcs.map((n) => n.name));
  const [acLo, acHi] = SRD_STAT_RANGES.ac, [hpLo, hpHi] = SRD_STAT_RANGES.hp, [abLo, abHi] = SRD_STAT_RANGES.attack_bonus;
  for (const n of snap.npcs) {
    if (!spots.has(n.location.id)) errs.push(`${n.id}: el punto ${n.location.id} no existe.`);
    if (blank(n.description) || blank(n.motivation) || blank(n.role)) errs.push(`${n.id}: falta descripción, motivación o papel.`);
    if (!(ATTITUDES as readonly string[]).includes(n.attitude.default)) errs.push(`${n.id}: actitud no válida «${n.attitude.default}».`);
    const s = n.stats;
    if (s && (s.ac < acLo || s.ac > acHi || s.hp_max < hpLo || s.hp_max > hpHi || s.hp > s.hp_max || s.attack_bonus < abLo || s.attack_bonus > abHi
      || !(SRD_STAT_RANGES.xp as readonly number[]).includes(s.xp) || !/^\d+d\d+([+-]\d+)?$/.test(s.damage) || blank(s.attack_name))) {
      errs.push(`${n.id}: estadísticas fuera de los rangos SRD.`);
    }
    for (const t of [...n.buys, ...n.sells]) {
      if (!defs.has(t.item_id)) errs.push(`comercio de ${n.id}: el objeto ${t.item_id} no está en el catálogo.`);
      if (!Number.isInteger(t.price) || t.price <= 0) errs.push(`comercio de ${n.id}: el precio de ${t.item_id} debe ser un entero positivo.`);
    }
    const r = (n as typeof n & { routine?: NpcRoutine }).routine;
    for (const id of Object.values(r ?? {})) if (id && !spots.has(id)) errs.push(`horario de ${n.id}: el punto ${id} no existe.`);
  }
  const isPerson = (id: Id) => { const n = npcs.get(id); return !!n && n.attitude.default !== 'hostile'; };

  // Objetos
  for (const d of snap.item_defs) {
    if (d.service && !defs.has(d.service.gives_item_id)) errs.push(`${d.id}: el servicio entrega ${d.service.gives_item_id}, que no existe.`);
  }
  for (const i of snap.item_instances) {
    if (!defs.has(i.item_id)) errs.push(`${i.id}: el objeto ${i.item_id} no existe.`);
    if (!(i.quantity > 0)) errs.push(`${i.id}: cantidad no positiva.`);
    const at = i.location;
    const ok = at.type === 'spot' ? spots.has(at.id) : at.type === 'npc' ? npcs.has(at.id) : at.type === 'container' ? insts.has(at.id) : at.type === 'character' ? chars.has(at.id) : snap.vehicles.some((v) => v.id === at.id);
    if (!ok) errs.push(`${i.id}: está en ${at.type} ${at.id}, que no existe.`);
  }
  for (const r of snap.resource_nodes) {
    if (!spots.has(r.spot_id)) errs.push(`${r.id}: el punto ${r.spot_id} no existe.`);
    if (!defs.has(r.resource_item_id)) errs.push(`${r.id}: da ${r.resource_item_id}, que no existe.`);
    if (r.tool_required && !defs.has(r.tool_required)) errs.push(`${r.id}: pide ${r.tool_required}, que no existe.`);
  }

  // Trama: facciones, pistas, encargos, logro
  const factions = ids('facciones', c.factions);
  const clues = ids('pistas', c.clues);
  const jobs = ids('encargos', c.jobs);
  unique('pistas', c.clues.map((x) => x.title));
  for (const cl of c.clues) {
    if (blank(cl.how)) errs.push(`${cl.id}: falta el «cómo».`);
    for (const id of cl.location_ids ?? []) if (!locs.has(id)) errs.push(`${cl.id}: la localización ${id} no existe.`);
    for (const id of cl.npc_ids ?? []) if (!isPerson(id)) errs.push(`${cl.id}: el NPC ${id} no existe o no habla.`);
  }
  for (const j of c.jobs) {
    if (blank(j.title) || blank(j.text)) errs.push(`${j.id}: falta título o texto.`);
    if (!isPerson(j.giver_npc_id)) errs.push(`${j.id}: quien lo pide (${j.giver_npc_id}) no existe o no habla.`);
    if (j.kind === 'deliver' && (!j.deliver || !defs.has(j.deliver.item_id))) errs.push(`${j.id}: entrega de un objeto que no existe.`);
    if (j.kind === 'visit' && (!j.visit_spot_id || !spots.has(j.visit_spot_id))) errs.push(`${j.id}: visita a un punto que no existe.`);
  }
  const a = c.achievement;
  if (!factions.has(a.faction_id)) errs.push(`logro: la facción ${a.faction_id} no existe.`);
  if (a.reward_item_id && !defs.has(a.reward_item_id)) errs.push(`logro: el premio ${a.reward_item_id} no existe.`);
  if (a.reward_spot_id && !spots.has(a.reward_spot_id)) errs.push(`logro: el punto ${a.reward_spot_id} no existe.`);
  if (!a.announcement.includes('{name}')) errs.push('logro: el anuncio no lleva {name}.');
  if (!c.welcome.includes('{name}')) errs.push('La bienvenida no lleva {name}.');

  // Biblia, leyes y situaciones (mismas reglas que fill.ts)
  if (c.bible && (c.bible.length < 5 || c.bible.length > 10 || c.bible.some(blank))) errs.push(`La Biblia debe tener entre 5 y 10 verdades (tiene ${c.bible.length}).`);
  if (c.laws && (c.laws.length < 3 || c.laws.length > 8 || c.laws.some(blank))) errs.push(`Las leyes del mundo deben ser entre 3 y 8 (hay ${c.laws.length}).`);
  for (const e of c.situations ?? []) {
    const s = e.situation;
    const who = e.for_name || (e.for_classes?.length ? e.for_classes.join('/') : 'reserva');
    if (!isPerson(s.antagonist_npc_id)) errs.push(`situación de ${who}: el antagonista ${s.antagonist_npc_id} no existe o no es una persona.`);
    const sp = spots.get(s.start_spot_id);
    if (!sp || sp.hidden || sp.state['locked'] === true) errs.push(`situación de ${who}: el punto ${s.start_spot_id} no vale para empezar.`);
    if (!Number.isInteger(s.clock_days) || s.clock_days < 1 || s.clock_days > 30) errs.push(`situación de ${who}: clock_days debe ser un entero de 1 a 30.`);
    if (s.start_hour !== undefined && (!Number.isInteger(s.start_hour) || s.start_hour < 0 || s.start_hour > 23)) errs.push(`situación de ${who}: start_hour fuera de 0-23.`);
    if (!Array.isArray(s.paths) || s.paths.length !== 3 || s.paths.some(blank)) errs.push(`situación de ${who}: hacen falta exactamente tres caminos.`);
    for (const k of ['why_here', 'wants', 'threat', 'clock_runs_out', 'opening'] as const) if (blank(s[k])) errs.push(`situación de ${who}: ${k} está vacío.`);
    if (s.debt && (!npcs.has(s.debt.npc_id) || !(s.debt.amount > 0) || blank(s.debt.reason))) errs.push(`situación de ${who}: deuda mal formada.`);
    for (const it of s.items ?? []) if (!defs.has(it.item_id)) errs.push(`situación de ${who}: el objeto ${it.item_id} no existe.`);
    for (const id of s.knows ?? []) if (!npcs.has(id)) errs.push(`situación de ${who}: conoce a ${id}, que no existe.`);
  }

  // Agenda, ganchos, rumores, encuentros
  for (const e of c.schedule ?? []) {
    const sp = spots.get(e.spot_id);
    if (!locs.has(e.location_id) || sp?.location_id !== e.location_id) errs.push(`evento ${e.id}: el punto ${e.spot_id} no es de ${e.location_id}.`);
    if (!RECURRENCES.includes(e.recurrence)) errs.push(`evento ${e.id}: recurrencia no válida.`);
    if (!(e.start_h >= 0 && e.start_h < 24) || !(e.duration_min > 0)) errs.push(`evento ${e.id}: hora o duración no válidas.`);
    for (const id of [...e.npc_ids, ...(e.effects.busy_npc_ids ?? [])]) if (!npcs.has(id)) errs.push(`evento ${e.id}: el NPC ${id} no existe.`);
  }
  for (const h of c.hooks ?? []) {
    if (!locs.has(h.location_id)) errs.push(`gancho ${h.id}: la localización ${h.location_id} no existe.`);
    if (h.trigger.kind === 'spot' && spots.get(h.trigger.spot_id)?.location_id !== h.location_id) errs.push(`gancho ${h.id}: el punto no es de su localización.`);
    if (blank(h.what)) errs.push(`gancho ${h.id}: sin «what».`);
  }
  for (const r of c.rumors ?? []) {
    if (!locs.has(r.location_id)) errs.push(`rumor ${r.id}: la localización ${r.location_id} no existe.`);
    if (!RUMOR_KINDS.includes(r.kind) || blank(r.name) || blank(r.hint)) errs.push(`rumor ${r.id}: mal formado.`);
  }
  for (const [kind, table] of Object.entries(c.encounters ?? {})) {
    for (const e of table) if (blank(e.id) || blank(e.what)) errs.push(`encuentros de ${kind}: una entrada sin id o sin «what».`);
  }
  if (c.story) {
    errs.push(...validateStory(c.story, {
      spot: (id) => spots.has(id), location: (id) => locs.has(id), npc: (id) => npcs.has(id), item: (id) => defs.has(id),
      clue: (id) => clues.has(id), job: (id) => jobs.has(id), exit: (id) => exits.has(id),
    }));
  }
  return errs;
}
