import type { ResearchLevels, ResourceKey } from '@orions-frontier/shared';

/** Everything research changes, derived from the account's research levels. */
export interface ResearchModifiers {
  miningRate: number;
  cargo: number;
  speed: number;
  scannerRange: number;
  attack: number;
  shipDefense: number;
  stationDefense: number;
  crew: number;
  /** Delivered amount per unit taken from the asteroid. */
  yield: number;
  /** Percent off building and defense upgrade times, added to the Core bonus. */
  constructionBonus: number;
  /** Percent off spacecraft build times, added to the Shipyard bonus. */
  shipBuildBonus: number;
  /** Factor on building upgrade costs. */
  buildingCost: number;
  researchSlots: number;
  buildSlots: number;
  stationLimit: number;
  expeditionLimit: number;
  canExplore: boolean;
  /** Resources scanners reveal and miners can extract. */
  visibleResources: ResourceKey[];
  signatureAnalysis: boolean;
  autoReroute: boolean;
  autonomousFleet: boolean;
}

const BASE_RESOURCES: ResourceKey[] = ['carbon', 'titanium', 'hydrogenium'];

export function researchModifiers(research: ResearchLevels): ResearchModifiers {
  const level = (key: keyof ResearchLevels) => research[key] ?? 0;
  const percent = (key: keyof ResearchLevels, perLevel = 5) => 1 + (level(key) * perLevel) / 100;
  return {
    miningRate: percent('extraction_algorithms'),
    cargo: percent('cargo_compression'),
    speed: percent('ion_propulsion'),
    scannerRange: percent('sensor_arrays'),
    attack: percent('weapons'),
    shipDefense: percent('armor'),
    stationDefense: percent('shields'),
    crew: percent('fleet_coordination'),
    yield: percent('deep_core_drilling', 6),
    constructionBonus: level('construction_robotics') * 3,
    shipBuildBonus: level('fabrication_lines') * 4,
    buildingCost: 1 - level('nanite_assembly') * 0.04,
    researchSlots: 1 + level('research_network'),
    buildSlots: 1 + level('parallel_construction'),
    stationLimit: 1 + level('colony_logistics') + level('frontier_charter'),
    expeditionLimit: 1 + level('frontier_charter'),
    canExplore: level('long_range_survey') > 0,
    visibleResources: [
      ...BASE_RESOURCES,
      ...(level('spectral_analysis') > 0 ? (['kyber_crystal'] as const) : []),
      ...(level('deep_spectral_analysis') > 0 ? (['astatine'] as const) : []),
    ],
    signatureAnalysis: level('signature_analysis') > 0,
    autoReroute: level('auto_reroute') > 0,
    autonomousFleet: level('autonomous_fleet') > 0,
  };
}

/** Nanite Assembly discount on building upgrade costs, rounded like the base costs. */
export const applyBuildingCostDiscount = <T extends { amount: number }>(
  costs: T[],
  factor: number
): T[] =>
  factor >= 1
    ? costs
    : costs.map((cost) => ({
        ...cost,
        amount: Math.max(10, Math.round((cost.amount * factor) / 10) * 10),
      }));
