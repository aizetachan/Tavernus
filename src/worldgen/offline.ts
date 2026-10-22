/**
 * Relleno offline: un WorldFill determinista por semilla, sin API (tests,
 * modo offline, sin clave). Es un mundo de prueba: la estructura sí varía
 * (la pone el esqueleto) y los nombres salen de combinar piezas con la
 * semilla, pero la prosa es de plantilla. El menú lo dice.
 */

import { seededRng } from '../engine/dice.js';
import type { Id } from '../engine/model.js';
import { PLACES, type Genre } from './catalog.js';
import { SPARE_SITUATIONS, TRADE_ITEMS, type PcBrief, type SituationFill, type WorldFill } from './fill.js';
import { skeletonSpots, type Skeleton, type SkLocation, type Tone } from './skeleton.js';

// --- Piezas de nombres ------------------------------------------------------

const ROOTS = ['Val', 'Fuen', 'Torre', 'Peña', 'Monte', 'Villa', 'Roble', 'Hoya', 'Campo', 'Aguas', 'Piedra', 'Castro', 'Mira', 'Cueva', 'Llano', 'Ribera', 'Sierra', 'Pozo'];
const ENDS = ['seca', 'fría', 'negra', 'lobos', 'cuervos', 'mansa', 'rubia', 'alta', 'honda', 'vieja', 'clara', 'umbría', 'hierro', 'sal', 'cenizas', 'espina'];
const SCIFI = ['Kepler', 'Vega', 'Tau', 'Ceres', 'Orión', 'Nadir', 'Próxima', 'Tycho', 'Erebo', 'Halley', 'Gliese', 'Ross'];
const SCIFI_END = ['Prime', 'IV', 'Sur', 'Baja', 'Profunda', 'Dos', 'Vieja', 'Nueva'];
const APOC = ['Refugio', 'Fuerte', 'Campamento', 'Depósito', 'Puesto', 'Barrio', 'Cruce', 'Silo'];
const APOC_END = ['Ceniza', 'Óxido', 'Siete', 'Mosca', 'Gasolina', 'Cuervo', 'Hueso', 'Lata', 'Polvo', 'Esperanza', 'Cero', 'Sequía'];
const FIRST_F = ['Aldra', 'Cora', 'Elvira', 'Gala', 'Inés', 'Leonor', 'Nuria', 'Petra', 'Rosaura', 'Telma', 'Vera', 'Ximena', 'Zoila', 'Brígida', 'Dorotea', 'Fabiola', 'Herminia', 'Julia', 'Marta', 'Olvido'];
const FIRST_M = ['Benigno', 'Dámaso', 'Fermín', 'Hilario', 'Jacinto', 'Matías', 'Osmundo', 'Quirce', 'Sancho', 'Urbano', 'Wences', 'Yago', 'Ciro', 'Eloy', 'Gaspar', 'Ivo', 'Lucio', 'Anselmo', 'Rufo', 'Tadeo'];
const LAST = ['Quintana', 'Valcárcel', 'del Río', 'Ordóñez', 'Mirabel', 'Cuesta', 'Barrios', 'Losada', 'Pardo', 'Ferrer', 'Montaña', 'Salcedo', 'Arenas', 'Bermejo', 'Cano', 'Villar',
  'Grajal', 'Torres', 'Robles', 'Peñalver'];
const NOUNS: [string, 'm' | 'f'][] = [['Cuervo', 'm'], ['Sal', 'f'], ['Ahorcado', 'm'], ['Linterna', 'f'], ['Buey', 'm'], ['Rana', 'f'], ['Gallo', 'm'], ['Luna', 'f'], ['Lobo', 'm'],
  ['Campana', 'f'], ['Ciervo', 'm'], ['Niebla', 'f'], ['Herrero', 'm'], ['Viuda', 'f'], ['Barquero', 'm'], ['Ceniza', 'f'], ['Toro', 'm'], ['Cabra', 'f'], ['Carro', 'm'], ['Espada', 'f']];
const ADJ: [string, string][] = [['Cojo', 'Coja'], ['Negro', 'Negra'], ['Viejo', 'Vieja'], ['Tuerto', 'Tuerta'], ['Manso', 'Mansa'], ['Roto', 'Rota'], ['Ciego', 'Ciega'],
  ['Blanco', 'Blanca'], ['Muerto', 'Muerta'], ['Rojo', 'Roja'], ['Triste', 'Triste'], ['Alegre', 'Alegre'], ['Callado', 'Callada'], ['Hambriento', 'Hambrienta']];
const LOOKS = ['de manos curtidas y mirada que no se queda quieta', 'que habla bajo y se toca una cicatriz al pensar', 'con una tos que no se le va',
  'de sonrisa rápida y ojos que cuentan monedas', 'que nunca se quita los guantes', 'con la ropa demasiado buena para este sitio', 'que tararea cuando miente',
  'de voz ronca de haber gritado mucho', 'que siempre está comiendo algo', 'con un ojo velado y el otro muy atento', 'que se ríe antes de que acabes de hablar', 'con ceniza en el pelo y cara de no dormir'];
const MOTIVES = ['que nada cambie mientras le vaya bien', 'irse de aquí antes del invierno', 'que le tomen en serio', 'pagar lo que debe sin que nadie se entere', 'proteger a su familia',
  'quedarse con lo que otros han dejado', 'averiguar quién le robó', 'mandar más de lo que manda', 'olvidar lo que vio', 'ganar lo bastante para no volver a trabajar'];

const LAWS: Record<Genre, string[]> = {
  fantasy: ['Nadie vuela por sí mismo: hace falta magia de verdad o una criatura que vuele.', 'La magia es rara y la temen; quien la usa a la vista llama la atención.',
    'No hay pólvora ni máquinas: hierro, madera, cuerda y fuego.', 'Nada sale de la nada: lo que no se lleva encima no aparece en las manos.', 'Los muertos no vuelven y las heridas tardan en cerrarse.'],
  scifi: ['No hay teletransporte: todo viaja en naves, y las naves gastan y se rompen.', 'Fuera de los recintos presurizados no se respira sin traje.', 'Las armas de energía necesitan carga y se recalientan.',
    'Las máquinas no piensan por sí mismas: obedecen, fallan o mienten porque alguien las programó.', 'Los muertos no vuelven; la medicina cura, pero cuesta y tarda.'],
  postapoc: ['El agua limpia es escasa y vale más que el dinero.', 'La munición no se fabrica: se encuentra, se roba o se cambia.', 'No hay magia ni milagros; hay suerte, ingenio y herramientas.',
    'Lo que se rompe se arregla con lo que hay, si alguien sabe.', 'Los muertos no vuelven y una herida infectada mata despacio.'],
};
const REWARD: Record<Genre, string> = { fantasy: 'llave vieja de hierro', scifi: 'tarjeta de acceso maestra', postapoc: 'llave del depósito' };
const PREMISE: Record<Tone, string> = {
  epic: 'Algo viejo despierta bajo {T} y solo unos pocos se han dado cuenta.',
  grim: 'En {T} el invierno viene largo y alguien ha empezado a vender lo que no es suyo.',
  comedy: '{T} está de fiesta y todo lo que podía salir mal ya ha salido mal dos veces.',
  horror: 'Desde hace un mes, en {T} desaparece gente de noche y nadie lo dice en voz alta.',
  pulp: 'Un cargamento robado, un mapa partido en dos y un {S} donde todos mienten un poco.',
};
const BIBLE = [
  '{A} vendió en secreto {W} a gente de fuera.', '{A} y {B} enterraron a alguien en {W} hace años y se juraron callar.', 'En {L} se guarda algo que no debería existir.',
  '{B} trabaja para quien quiere recuperar lo que se esconde en {L}.', 'Lo que baja de {W} de noche no es un animal.', '{A} debe dinero a quien no perdona.',
  'Medio {T} sospecha, pero nadie quiere ser el primero en hablar.', '{B} no es quien dice ser: llegó con otro nombre.',
];
const SITUATIONS: { why: string; wants: string; threat: string; runs: string }[] = [
  { why: 'Has venido a {T} a cobrar una deuda: {X} te debe un favor antiguo.', wants: 'Que {X} pague lo que debe.', threat: 'Alguien ha puesto precio a tu cabeza y la noticia corre más deprisa que tú.', runs: 'Los que te buscan llegan a {T}.' },
  { why: 'Buscas a tu hermana, que pasó por {T} y dejó de escribir; su última carta nombraba a {X}.', wants: 'Saber qué le pasó.', threat: '{X} sabe que has llegado y no quiere preguntas.', runs: 'El rastro se borra y {X} se marcha con lo que sabe.' },
  { why: 'Te acusan de un robo que no cometiste: {X} jura que te vio.', wants: 'Limpiar tu nombre.', threat: 'Si no encuentras al culpable, el culpable serás tú.', runs: 'Te juzgan sin pruebas y el castigo es a la vista de todos.' },
  { why: 'Has heredado algo en {T} y {X} dice que es suyo.', wants: 'Quedarte con lo que es tuyo.', threat: '{X} tiene amigos aquí y tú no.', runs: 'Lo subastan y lo pierdes para siempre.' },
  { why: 'Traes una carta sellada para alguien de {T}; {X} pagaría por leerla.', wants: 'Entregarla sin que nadie la abra.', threat: 'Quien la escribió no perdona retrasos.', runs: 'La carta ya no sirve y quien la escribió viene a pedirte cuentas.' },
  { why: 'Huyes de algo que hiciste lejos de aquí, y {X} te ha reconocido.', wants: 'Pasar desapercibido hasta que se calme.', threat: '{X} puede venderte a quien te busca.', runs: 'Llegan quienes te buscan y {X} les dice dónde estás.' },
  { why: 'Alguien a quien quieres está enfermo y dicen que el remedio está en {T}; lo controla {X}.', wants: 'Conseguir el remedio.', threat: 'El precio que pide {X} es más de lo que tienes.', runs: 'Ya no habrá remedio que valga.' },
  { why: 'Te contrataron para un trabajo en {T} y quien te contrató ha muerto; {X} sabe por qué.', wants: 'Cobrar y entender qué ha pasado.', threat: 'Ahora eres tú quien sabe demasiado.', runs: '{X} se encarga de que nadie pregunte más.' },
];
const CLUES_NPC = [
  ['Lo que calla {N}', '{N} lo admite a medias si se le gana la confianza en varias charlas o con Persuasión CD 14.'],
  ['Las manos de {N}', 'Perspicacia CD 12 mientras {N} habla de {W}: miente, y se le nota en las manos.'],
  ['Las cuentas de {N}', 'Investigación CD 13 con los papeles de {N}: pagos que no cuadran con lo que gana.'],
];
const CLUES_LOC = [
  ['Marcas en {L}', 'Investigación CD 13 en {L}: alguien ha forzado algo hace pocos días.'],
  ['Lo que hay en {L}', 'Percepción CD 14 en {L}: un escondite con algo que no es de nadie de aquí.'],
  ['Huellas en {L}', 'Supervivencia CD 11 en {L}: huellas que van y vuelven de noche.'],
];
/** Papeles a los que les cuadra comerciar, por orden. */
const TRADERS = ['merchant', 'innkeeper', 'bartender', 'cook', 'fishmonger', 'smith', 'money_changer', 'scavenger', 'healer', 'medic', 'paymaster', 'mechanic', 'smuggler'];

/** Relleno determinista de plantilla (tests, menú sin API). */
export function offlineFill(sk: Skeleton, pcs: PcBrief[]): WorldFill {
  const rng = seededRng((sk.seed ^ 0x5bd1e995) >>> 0);
  const pick = <V>(xs: readonly V[]): V => xs[Math.floor(rng() * xs.length)]!;
  const shuffled = <V>(xs: readonly V[]): V[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w)\}/g, (_, k: string) => v[k] ?? k);

  const town = sk.genre === 'scifi' ? `${pick(SCIFI)} ${pick(SCIFI_END)}` : sk.genre === 'postapoc' ? `${pick(APOC)} ${pick(APOC_END)}` : pick(ROOTS) + pick(ENDS);
  const phrase = () => { const [n, g] = pick(NOUNS); const [m, f] = pick(ADJ); return g === 'm' ? `del ${n} ${m}` : `de la ${n} ${f}`; };
  /** "la casa del concejo" → "la Casa del Concejo"; con nombre propio detrás. */
  const titled = (label: string) => label.replace(/^(el|la|los|las)\s+(.)/, (_, a: string, c: string) => `${a} ${c.toUpperCase()}`);
  const locName = new Map<Id, string>();
  for (const l of sk.locations) {
    // "la casa de la curandera" ya lleva su «de»: solo admite el del pueblo.
    const own = / del? /.test(l.label);
    let n = '';
    for (let tries = 0; tries < 20 && (!n || [...locName.values()].includes(n)); tries++) n = `${titled(l.label)} ${own || (l.zone_id === 'zn_town' && rng() < 0.4) ? `de ${town}` : phrase()}`;
    locName.set(l.id, n);
  }
  // Nombre del género del papel ("lonjera" → mujer, "posadero" → hombre); nombres y apellidos sin repetir.
  const usedFirst = new Set<string>(), usedLast = new Set<string>();
  const fresh = (xs: readonly string[], used: Set<string>) => { const left = xs.filter((x) => !used.has(x)); const x = pick(left.length ? left : xs); used.add(x); return x; };
  const female = (label: string) => /a$/.test(label.split(' ')[0]!);
  const person = (label: string) => `${fresh(female(label) ? FIRST_F : FIRST_M, usedFirst)} ${fresh(LAST, usedLast)}`;
  const npcName = new Map<Id, string>(sk.npcs.map((n) => [n.id, n.role === 'beast' ? `un ${n.role_label} ${pick(['de lomo cano', 'con una oreja partida', 'flaco y sin miedo', 'de ojos amarillos'])}` : person(n.role_label)]));
  const people = sk.npcs.filter((n) => n.role !== 'beast');
  const town_locs = sk.locations.filter((l) => l.zone_id === 'zn_town');
  const wild = sk.locations.filter((l) => l.zone_id !== 'zn_town');
  const hidden = town_locs.find((l) => l.spots.some((s) => s.hidden)) ?? town_locs[0]!;
  const vars = (a: Id, b: Id): Record<string, string> => ({
    T: town, S: sk.settlement.label, A: npcName.get(a)!, B: npcName.get(b)!, L: locName.get(hidden.id)!, W: locName.get(wild[0]!.id)!,
  });
  const [pa, pb] = shuffled(people);
  const v = vars(pa!.id, (pb ?? pa)!.id);
  const price = (id: Id) => Math.max(1, Math.round((TRADE_ITEMS.find((d) => d.id === id)?.value ?? 10) * 1.1));
  const traders = [...people].sort((a, b) => (TRADERS.indexOf(a.role) + 99) % 99 - (TRADERS.indexOf(b.role) + 99) % 99).slice(0, 2);
  const field = [...new Set(sk.resources.map((r) => r.item_id))];

  // Situaciones: cada una en un sitio distinto, con la hora y la escena que da su tipo de lugar.
  const spotsBy = new Map<Id, SkLocation>(sk.locations.flatMap((l) => l.spots.map((s) => [s.id, l] as const)));
  // Casi siempre dentro del asentamiento; a veces fuera. Nunca dos en el mismo lugar si se puede evitar.
  const inTown = shuffled(sk.situation_spot_ids.filter((id) => spotsBy.get(id)!.zone_id === 'zn_town'));
  const outside = shuffled(sk.situation_spot_ids.filter((id) => spotsBy.get(id)!.zone_id !== 'zn_town'));
  const startLocs = new Set<Id>();
  const nextStart = (): Id => {
    const pool = rng() < 0.8 || !outside.length ? inTown : outside;
    const fresh = pool.find((id) => !startLocs.has(spotsBy.get(id)!.id)) ?? pool[0] ?? sk.situation_spot_ids[0]!;
    startLocs.add(spotsBy.get(fresh)!.id);
    return fresh;
  };
  const plots = shuffled(SITUATIONS);
  const situation = (forName: string, i: number, hook?: string): SituationFill => {
    const ant = people[(i * 3 + 1) % people.length]!;
    const ally = people.find((p) => p !== ant) ?? ant;
    const spot = nextStart();
    const place = PLACES[spotsBy.get(spot)!.kind] as { hours?: number[]; opening?: string };
    const p = plots[i % plots.length]!;
    const sv = { ...v, X: npcName.get(ant.id)! };
    return {
      for_name: forName,
      why_here: (hook ? `${hook.replace(/\.?$/, '.')} ` : '') + fill(p.why, sv),
      wants: fill(p.wants, sv), threat: fill(p.threat, sv), clock_days: 2 + Math.floor(rng() * 9), clock_runs_out: fill(p.runs, sv),
      antagonist_npc_id: ant.id, start_spot_id: spot, start_hour: place.hours?.length ? pick(place.hours) : 8 + Math.floor(rng() * 12),
      paths: [
        `Encarar a ${sv.X} delante de testigos y exigirle respuestas.`,
        `Ganarte a ${npcName.get(ally.id)} para que te ayude o interceda.`,
        `Averiguar qué esconde ${sv.X} en ${locName.get(hidden.id)} y usarlo en su contra.`,
      ],
      opening: place.opening ?? 'Alguien que no conoces pronuncia tu nombre a tu espalda, y cuando te vuelves ya no está.',
    };
  };

  return {
    campaign_name: `${pick(['Las sombras', 'El silencio', 'La deuda', 'Los secretos', 'La última noche', 'Las cenizas'])} de ${town}`,
    town_name: town,
    premise: fill(PREMISE[sk.tone], v),
    welcome: `Hay caminos que llevan a ${town} aunque nadie los busque. Hoy uno trae a {name}.`,
    bible: shuffled(BIBLE).slice(0, 5 + Math.floor(rng() * 2)).map((t) => fill(t, v)),
    laws: [...LAWS[sk.genre]],
    faction: { name: `la gente de ${town}`, description: `Los que viven en ${town}. Desconfían de los de fuera hasta que hacen algo por ellos.` },
    achievement: { title: `Quien destapó lo de ${town}`, announcement: `En ${town} empiezan a decir que {name} ha destapado lo que nadie quería ver.`, reward_item_name: REWARD[sk.genre] },
    locations: sk.locations.map((l) => ({
      id: l.id, name: locName.get(l.id)!,
      description: l.zone_id !== 'zn_town' ? `${cap(l.label)} a las afueras de ${town}.` : l.indoor ? `${cap(l.label)} de ${town}, con poca luz y olor a cerrado.` : `${cap(l.label)} de ${town}, a cielo abierto.`,
      spots: dedupe(l.spots.map((s) => ({
        id: s.id,
        name: s.leads_to ? (s.tags.includes('door') ? `la puerta ${de(locName.get(s.leads_to) ?? 'fuera')}` : `el camino hacia ${locName.get(s.leads_to) ?? 'fuera'}`) : s.name,
        description: `${cap(s.name)}.`,
      }))),
    })),
    npcs: sk.npcs.map((n) => ({
      id: n.id, name: npcName.get(n.id)!,
      description: n.role === 'beast' ? 'Flaco, sucio, con los ojos fijos en ti.' : `${cap(n.role_label)} ${pick(LOOKS)}.`,
      motivation: n.role === 'beast' ? 'Hambre.' : cap(pick(MOTIVES)) + '.',
      secret: n.role === 'beast' ? '' : fill(pick(BIBLE), vars(n.id, pick(people).id)),
      attitude: n.hostile ? 'hostile' : pick(['neutral', 'neutral', 'unfriendly', 'friendly']),
    })),
    trade: [
      ...(traders[0] ? [...field.map((id) => ({ npc_id: traders[0]!.id, buys_or_sells: 'buys', item_id: id, price: price(id) * 3 })),
        ...['it_racion', 'it_antorcha', 'it_cuerda'].map((id) => ({ npc_id: traders[0]!.id, buys_or_sells: 'sells', item_id: id, price: price(id) }))] : []),
      ...(traders[1] ? ['it_daga', 'it_pocion'].map((id) => ({ npc_id: traders[1]!.id, buys_or_sells: 'sells', item_id: id, price: price(id) })) : []),
    ],
    clues: Array.from({ length: sk.clue_count }, (_, i) => {
      if (i % 2 === 0) {
        const n = people[i % people.length]!;
        const [t, h] = CLUES_NPC[i % CLUES_NPC.length]!;
        const cv = { ...v, N: npcName.get(n.id)! };
        return { title: fill(t!, cv), how: fill(h!, cv), location_ids: [], npc_ids: [n.id] };
      }
      const l = sk.locations[(i * 2) % sk.locations.length]!;
      const [t, h] = CLUES_LOC[i % CLUES_LOC.length]!;
      const cv = { ...v, L: locName.get(l.id)! };
      return { title: fill(t!, cv), how: fill(h!, cv), location_ids: [l.id], npc_ids: [] };
    }),
    jobs: sk.jobs.map((j, i) => {
      const giver = people[(i + 1) % people.length]!;
      const g = npcName.get(giver.id)!;
      const item = j.deliver ? TRADE_ITEMS.find((d) => d.id === j.deliver!.item_id)?.name ?? j.deliver.item_id : '';
      const spot = j.visit_spot_id ? skeletonSpots(sk).find((s) => s.id === j.visit_spot_id)!.name : '';
      return {
        id: j.id, giver_npc_id: giver.id,
        title: j.kind === 'deliver' ? `Se busca: ${item}` : j.kind === 'visit' ? 'Ir a mirar' : 'Un recado discreto',
        text: j.kind === 'deliver' ? `${g} paga por ${j.deliver!.quantity} de ${item}.` : j.kind === 'visit' ? `${g} paga a quien vaya hasta ${spot}, mire y vuelva a contarlo.` : `${g} necesita que alguien lleve un mensaje sin que se entere nadie más.`,
      };
    }),
    situations: [...pcs.map((p, i) => situation(p.name, i, p.hook)), ...Array.from({ length: SPARE_SITUATIONS }, (_, i) => situation('', pcs.length + i))],
  };
}

/** "de" + nombre, con contracción: "de el Templo" → "del Templo". */
export function de(name: string): string { return /^el /i.test(name) ? `del ${name.slice(3)}` : `de ${name}`; }

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Nombres de punto únicos dentro de la localización (dos puertas hacia sitios iguales, etc.). */
function dedupe<S extends { name: string }>(spots: S[]): S[] {
  const seen = new Map<string, number>();
  return spots.map((s) => {
    const n = (seen.get(norm(s.name)) ?? 0) + 1;
    seen.set(norm(s.name), n);
    return n === 1 ? s : { ...s, name: `${s.name} (${n})` };
  });
}
