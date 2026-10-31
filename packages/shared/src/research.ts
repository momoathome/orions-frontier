import type { BuildingKey, QueuedJob } from './building.js';
import type { ResourceKey } from './resource.js';

export const researchKeys = [
  'extraction_algorithms',
  'cargo_compression',
  'auto_reroute',
  'deep_core_drilling',
  'autonomous_fleet',
  'ion_propulsion',
  'sensor_arrays',
  'spectral_analysis',
  'long_range_survey',
  'signature_analysis',
  'colony_logistics',
  'deep_spectral_analysis',
  'frontier_charter',
  'construction_robotics',
  'fabrication_lines',
  'parallel_construction',
  'research_network',
  'nanite_assembly',
  'weapons',
  'armor',
  'shields',
  'fleet_coordination',
] as const;

export type ResearchKey = (typeof researchKeys)[number];
export type ResearchLane = 'extraction' | 'sensors' | 'engineering' | 'military';
export type ResearchKind = 'stat' | 'capability';
export type ResearchTier = 1 | 2 | 3 | 4 | 5;

/** Reached level per research; a missing key means level 0. */
export type ResearchLevels = Partial<Record<ResearchKey, number>>;
export type BuildingLevels = Partial<Record<BuildingKey, number>>;

export interface Requirements {
  research?: ResearchLevels;
  buildings?: BuildingLevels;
}

/** Why something cannot be started or built yet, in the order a player should fix it. */
export type RequirementBlocker =
  | { type: 'maxed' }
  | { type: 'research'; key: ResearchKey; level: number; current: number }
  | { type: 'building'; key: BuildingKey; level: number; current: number }
  /** Research levels never exceed the highest Laboratory level. */
  | { type: 'lab_cap'; level: number; current: number };

/** How a stat research reads in the UI: "+5% Mining rate" per level. */
export interface ResearchEffect {
  label: string;
  perLevel: number;
  format: 'percent' | 'percent_less' | 'count';
}

export interface ResearchDefinition {
  key: ResearchKey;
  name: string;
  description: string;
  lane: ResearchLane;
  tier: ResearchTier;
  kind: ResearchKind;
  maxLevel: number;
  /** Requirements for level 1, on top of the tier gate. */
  requirements: Requirements;
  /** Extra requirements for higher levels, e.g. Parallel Construction 2 needs Core 12. */
  levelRequirements?: Record<number, Requirements>;
  effect: ResearchEffect | null;
}

export interface ResearchCost {
  resourceKey: ResourceKey;
  amount: number;
}

export interface ResearchTechnology {
  definition: ResearchDefinition;
  level: number;
  startedAt: string | null;
  completesAt: string | null;
  /** Level once running and queued research is done. */
  queuedLevel: number;
  /** The next level to order, `queuedLevel + 1`; null once maxed. */
  next: {
    level: number;
    costs: ResearchCost[];
    durationSeconds: number;
    requirements: Requirements;
  } | null;
  /** Against queued levels, so a level whose prerequisite is queued can be queued too. */
  blockers: RequirementBlocker[];
}

/** Response of `GET /api/me/research`. */
export interface ResearchState {
  slots: number;
  highestLaboratory: number;
  /** Research waiting for a slot, in order. */
  queue: QueuedJob[];
  technologies: ResearchTechnology[];
}
