/**
 * Las Cenizas de Vharn: la aldea de Brezal como campaña escrita. El análisis
 * y la historia completa están en docs/BREZAL.md; aquí se juntan las piezas.
 */

import { DEFAULT_MASTER } from '../../seed/demo.js';
import type { AuthoredCampaign } from '../format.js';
import { ITEM_DEFS, ITEMS, RESOURCES } from './items.js';
import { ENCOUNTERS, HOOKS, RUMORS, SCHEDULE } from './life.js';
import { EXITS, LOCATIONS, REGIONS, ZONES } from './map.js';
import { NPCS } from './people.js';
import { ACHIEVEMENT, BIBLE, CLUES, FACTIONS, JOBS, LAWS, PREMISE, SITUATIONS, STARTING_POINTS, WELCOME } from './plot.js';
import { STORY } from './story.js';

export const BREZAL: AuthoredCampaign = {
  format: 1,
  id: 'brezal',
  start_hour: 18,
  campaign: {
    name: 'Las Cenizas de Vharn',
    time_ratio: 3,
    calendar: {
      day_names: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
      months: [{ name: 'Brotes', days: 30 }, { name: 'Espigas', days: 30 }, { name: 'Cenizas', days: 30 }, { name: 'Escarcha', days: 30 }],
      sunrise_h: 6, sunset_h: 20, twilight_h: 1,
    },
    starting_points: STARTING_POINTS,
    perception_rules: {
      vision_base_m: 30, hearing_base_m: 20,
      light_factor: { day: 1, twilight: 0.5, night_moon: 0.25, night_dark: 0.05, torch: 0.2 },
      torch_fixed_m: 10, darkvision_m: 18, skill_step: 0.05, asleep_factor: 0.2,
    },
    movement_rules: { base_speed_mps: 1.5, pace: { stealth: 0.5, walk: 1, run: 2 } },
    capacity_rules: { pockets_slots: 4, carry_per_str: 15, encumbered_at: 5, heavily_at: 10, coins_per_lb: 50 },
    premise: PREMISE,
    setting: 'Fantasía medieval oscura. Tecnología de hierro y madera; magia rara y temida.',
    tone: 'grim',
    content_rating: 2,
    language: 'es',
    house_rules: '',
    welcome: WELCOME,
    master: structuredClone(DEFAULT_MASTER),
    factions: FACTIONS,
    clues: CLUES,
    jobs: JOBS,
    achievement: ACHIEVEMENT,
    progression: { practice_thresholds: [10, 30, 60], practice_min_dc: 10 },
    bible: BIBLE,
    laws: LAWS,
    situations: SITUATIONS,
    // Quien muere vuelve en el camastro de Ilse (SPEC §4.7): ella le encontró.
    death_rules: {
      respawn_spot_id: 'sp_cu_camastro',
      respawn_story: 'Ilse te encontró y te trajo a la Casa de las hierbas. Dice que tardaste mucho en volver a respirar, y no quiere hablar de lo que murmurabas.',
    },
    schedule: SCHEDULE,
    encounters: ENCOUNTERS,
    story: STORY,
  },
  rumors: RUMORS,
  hooks: HOOKS,
  regions: REGIONS,
  zones: ZONES,
  locations: LOCATIONS,
  exits: EXITS,
  npcs: NPCS,
  vehicles: [
    { id: 'vh_mula', name: 'la mula de Brenna', kind: 'mount', location: { type: 'spot', id: 'sp_pl_taberna' }, speed_ft: 40, capacity: 1, owner_id: 'npc_brenna', terrain_allowed: [] },
  ],
  item_defs: ITEM_DEFS,
  items: ITEMS,
  resource_nodes: RESOURCES,
};
