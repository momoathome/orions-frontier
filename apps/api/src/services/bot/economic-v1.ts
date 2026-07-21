import {
  calculateBuildingUpgradeCost,
  spacecrafts as spacecraftConfig,
} from '@orions-frontier/game-config';
import type { BuildingUpgradeCost, ResourceKey, ResourceMap } from '@orions-frontier/shared';
import { resourceKeys } from '@orions-frontier/shared';
import { calculateMiningCycle } from '../../lib/mining-cycle.js';
import { calcDistance } from '../../lib/travel.js';

export interface BotMiningShip {
  definitionId: string;
  key: 'mole' | 'titan';
  amount: number;
  lockedAmount: number;
  inBuild: number;
  cargo: number;
  speed: number;
  miningRate: number;
}

export interface BotAsteroidCandidate {
  id: string;
  x: number;
  y: number;
  remainingByResource: ResourceMap;
  remainingAmount: number;
  hasOwnAssignment: boolean;
  freeSlots: number;
}

export interface EconomicBotState {
  userId: string;
  station: { id: string; x: number; y: number };
  resources: ResourceMap;
  shipyardLevel: number;
  shipyardUpgradeInProgress: boolean;
  ships: Partial<Record<'mole' | 'titan', BotMiningShip>>;
  asteroids: BotAsteroidCandidate[];
}

export type BotIntent =
  | {
      type: 'assign_miner';
      stationId: string;
      asteroidId: string;
      spacecraftDefinitionId: string;
      amount: 1;
      reason: string;
    }
  | {
      type: 'build_spacecraft';
      stationId: string;
      spacecraftKey: 'mole' | 'titan';
      amount: 1;
      reason: string;
    }
  | {
      type: 'upgrade_building';
      stationId: string;
      buildingKey: 'shipyard';
      reason: string;
    }
  | { type: 'wait'; reason: string };

const MOLE_TARGET = 3;
const TITAN_TARGET = 1;
const TITAN_SHIPYARD_LEVEL = 5;

const spacecraftCosts = (key: 'mole' | 'titan'): BuildingUpgradeCost[] =>
  spacecraftConfig.find((spacecraft) => spacecraft.key === key)?.costs ?? [];

const canAfford = (resources: ResourceMap, costs: readonly BuildingUpgradeCost[]): boolean =>
  costs.every((cost) => (resources[cost.resourceKey] ?? 0) >= cost.amount);

const totalShips = (ship: BotMiningShip | undefined): number =>
  (ship?.amount ?? 0) + (ship?.inBuild ?? 0);

function nextGoalCosts(state: EconomicBotState): readonly BuildingUpgradeCost[] {
  if (totalShips(state.ships.mole) < MOLE_TARGET) return spacecraftCosts('mole');
  if (state.shipyardLevel < TITAN_SHIPYARD_LEVEL) {
    return calculateBuildingUpgradeCost('shipyard', state.shipyardLevel + 1);
  }
  if (totalShips(state.ships.titan) < TITAN_TARGET) return spacecraftCosts('titan');
  return [];
}

function resourceWeights(state: EconomicBotState): Record<ResourceKey, number> {
  const costs = nextGoalCosts(state);
  if (costs.length === 0)
    return Object.fromEntries(resourceKeys.map((key) => [key, 1])) as Record<ResourceKey, number>;

  const result = Object.fromEntries(resourceKeys.map((key) => [key, 0.1])) as Record<
    ResourceKey,
    number
  >;
  for (const cost of costs) {
    const missingRatio =
      Math.max(0, cost.amount - (state.resources[cost.resourceKey] ?? 0)) / cost.amount;
    result[cost.resourceKey] = 1 + missingRatio * 2;
  }
  return result;
}

function selectAsteroid(
  state: EconomicBotState,
  ship: BotMiningShip
): BotAsteroidCandidate | undefined {
  const weights = resourceWeights(state);
  return state.asteroids
    .filter(
      (asteroid) =>
        asteroid.remainingAmount > 0 && (asteroid.hasOwnAssignment || asteroid.freeSlots > 0)
    )
    .map((asteroid) => {
      const distance = calcDistance(state.station, asteroid);
      const delivery = calculateMiningCycle({
        distance,
        speed: ship.speed,
        miningRate: ship.miningRate,
        cargoCapacity: ship.cargo,
        minerCount: 1,
        remainingAmount: asteroid.remainingAmount,
      }).totalDeliveryPerHour;
      const need = Object.entries(asteroid.remainingByResource).reduce(
        (sum, [resourceKey, amount]) =>
          sum + (amount / asteroid.remainingAmount) * weights[resourceKey as ResourceKey],
        0
      );
      return { asteroid, score: delivery * need };
    })
    .sort(
      (left, right) => right.score - left.score || left.asteroid.id.localeCompare(right.asteroid.id)
    )[0]?.asteroid;
}

function assignmentIntent(
  state: EconomicBotState,
  ship: BotMiningShip | undefined
): BotIntent | undefined {
  if (!ship || ship.amount - ship.lockedAmount < 1) return undefined;
  const asteroid = selectAsteroid(state, ship);
  if (!asteroid) return undefined;
  return {
    type: 'assign_miner',
    stationId: state.station.id,
    asteroidId: asteroid.id,
    spacecraftDefinitionId: ship.definitionId,
    amount: 1,
    reason: `${ship.key} assigned to the best available mining yield`,
  };
}

export function decideEconomicAction(state: EconomicBotState): BotIntent {
  const assignment =
    assignmentIntent(state, state.ships.titan) ?? assignmentIntent(state, state.ships.mole);
  if (assignment) return assignment;

  const moleCount = totalShips(state.ships.mole);
  if (moleCount < MOLE_TARGET) {
    if ((state.ships.mole?.inBuild ?? 0) > 0) {
      return { type: 'wait', reason: 'Waiting for Mole construction' };
    }
    if (canAfford(state.resources, spacecraftCosts('mole'))) {
      return {
        type: 'build_spacecraft',
        stationId: state.station.id,
        spacecraftKey: 'mole',
        amount: 1,
        reason: `Expanding mining fleet to ${MOLE_TARGET} Mole`,
      };
    }
    return { type: 'wait', reason: 'Saving resources for a Mole' };
  }

  if (state.shipyardLevel < TITAN_SHIPYARD_LEVEL) {
    if (state.shipyardUpgradeInProgress) {
      return { type: 'wait', reason: 'Waiting for Shipyard upgrade' };
    }
    const costs = calculateBuildingUpgradeCost('shipyard', state.shipyardLevel + 1);
    if (canAfford(state.resources, costs)) {
      return {
        type: 'upgrade_building',
        stationId: state.station.id,
        buildingKey: 'shipyard',
        reason: `Upgrading Shipyard to level ${state.shipyardLevel + 1}`,
      };
    }
    return { type: 'wait', reason: 'Saving resources for the next Shipyard level' };
  }

  if (totalShips(state.ships.titan) < TITAN_TARGET) {
    if ((state.ships.titan?.inBuild ?? 0) > 0) {
      return { type: 'wait', reason: 'Waiting for Titan construction' };
    }
    if (canAfford(state.resources, spacecraftCosts('titan'))) {
      return {
        type: 'build_spacecraft',
        stationId: state.station.id,
        spacecraftKey: 'titan',
        amount: 1,
        reason: 'Building the first Titan',
      };
    }
    return { type: 'wait', reason: 'Saving resources for a Titan' };
  }

  return { type: 'wait', reason: 'Initial economic goals reached' };
}
