import {
  buildingKeys,
  defenseUpgradeKeys,
  isOneOf,
  researchKeys,
  type BuildingUpgradeCost,
  type InfluenceBreakdown,
  type ResearchLevels,
} from '@orions-frontier/shared';
import { calculateBuildingUpgradeCost } from './buildings.js';
import { calculateDefenseUpgradeCost, getDefenseUpgrade } from './defense.js';
import { calculateResearchCost } from './research.js';
import { getSpacecraft } from './spacecrafts.js';

/** Resource units per Influence point. */
const INFLUENCE_RESOURCES_PER_POINT = 100;
/** Ships can be lost in a single fight, so the fleet counts at half its build cost. */
const INFLUENCE_FLEET_SHARE = 0.5;
/** Buildings are seeded at level 1 for free; only upgrades beyond it are investments. */
const BUILDING_STARTING_LEVEL = 1;

export interface InfluenceInput {
  /** Building and defense levels keyed by `station_buildings.building_key`. */
  levels: { key: string; level: number }[];
  research: ResearchLevels;
  spacecrafts: { key: string; amount: number }[];
}

const sumAmounts = (costs: { amount: number }[]): number =>
  costs.reduce((sum, cost) => sum + cost.amount, 0);

/** Costs of every upgrade a building or defense has above its free starting level; [] if unknown. */
export function investedUpgradeCosts(key: string, level: number): BuildingUpgradeCost[] {
  const costs: BuildingUpgradeCost[] = [];
  if (isOneOf(buildingKeys, key)) {
    for (let target = BUILDING_STARTING_LEVEL + 1; target <= level; target++) {
      costs.push(...calculateBuildingUpgradeCost(key, target));
    }
  } else if (isOneOf(defenseUpgradeKeys, key)) {
    for (let target = getDefenseUpgrade(key).startingLevel + 1; target <= level; target++) {
      costs.push(...calculateDefenseUpgradeCost(key, target));
    }
  }
  return costs;
}

/** Influence counts the resources invested in stations and fleet, see INFLUENCE_* constants. */
export function calculateInfluence(input: InfluenceInput): InfluenceBreakdown {
  let buildings = 0;
  let defense = 0;
  for (const { key, level } of input.levels) {
    const invested = sumAmounts(investedUpgradeCosts(key, level));
    if (isOneOf(defenseUpgradeKeys, key)) defense += invested;
    else buildings += invested;
  }
  let research = 0;
  for (const key of researchKeys) {
    for (let level = 1; level <= (input.research[key] ?? 0); level++) {
      research += sumAmounts(calculateResearchCost(key, level));
    }
  }
  const fleet = input.spacecrafts.reduce(
    (sum, { key, amount }) =>
      sum + sumAmounts(getSpacecraft(key)?.costs ?? []) * amount * INFLUENCE_FLEET_SHARE,
    0
  );

  const points = (resources: number) => Math.round(resources / INFLUENCE_RESOURCES_PER_POINT);
  const breakdown = {
    buildings: points(buildings),
    research: points(research),
    defense: points(defense),
    fleet: points(fleet),
  };
  return {
    ...breakdown,
    total: breakdown.buildings + breakdown.research + breakdown.defense + breakdown.fleet,
  };
}
