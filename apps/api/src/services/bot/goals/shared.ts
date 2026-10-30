import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import {
  getSpacecraft,
  applyBuildingCostDiscount,
  calculateBuildingUpgradeCost,
  getBuilding,
  calculateHangarCapacity,
  researchModifiers,
} from '@orions-frontier/game-config';
import {
  entriesOf,
  type BuildingKey,
  type BuildingLevels,
  type ResourceKey,
} from '@orions-frontier/shared';
import { calculateMiningCycle } from '../../../lib/mining-cycle.js';
import { calcDistance } from '../../../lib/travel.js';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINER_COST = getSpacecraft('mole')?.costs ?? [];
const TITAN_COST = getSpacecraft('titan')?.costs ?? [];

export const hasInBuild = (station: StationSnapshot, key: string): boolean =>
  station.builds.some((b) => b.spacecraftKey === key);

export function pickAvailableMinerKey(station: StationSnapshot): string | null {
  return (
    station.fleets
      .filter((fleet) => {
        const definition = getSpacecraft(fleet.spacecraftKey);
        return definition?.role === 'miner' && fleet.amount - fleet.lockedAmount > 0;
      })
      .sort((left, right) => {
        const leftDefinition = getSpacecraft(left.spacecraftKey);
        const rightDefinition = getSpacecraft(right.spacecraftKey);
        return (
          (rightDefinition?.miningRate ?? 0) - (leftDefinition?.miningRate ?? 0) ||
          left.spacecraftKey.localeCompare(right.spacecraftKey)
        );
      })[0]?.spacecraftKey ?? null
  );
}

export const hasMinerInBuild = (station: StationSnapshot): boolean =>
  station.builds.some((build) => getSpacecraft(build.spacecraftKey)?.role === 'miner');

export const minerCount = (station: StationSnapshot): number =>
  station.fleets
    .filter((fleet) => getSpacecraft(fleet.spacecraftKey)?.role === 'miner')
    .reduce((sum, fleet) => sum + fleet.amount, 0);

export const getShipyardLevel = (station: StationSnapshot): number => {
  const b = station.buildings.find((bld) => bld.buildingKey === 'shipyard');
  return b?.level ?? 0;
};

export const getWarehouseLevel = (station: StationSnapshot): number => {
  const b = station.buildings.find((bld) => bld.buildingKey === 'warehouse');
  return b?.level ?? 0;
};

export const getHangarLevel = (station: StationSnapshot): number => {
  const b = station.buildings.find((bld) => bld.buildingKey === 'hangar');
  return b?.level ?? 0;
};

export const stationBuildingLevels = (station: StationSnapshot): BuildingLevels =>
  Object.fromEntries(station.buildings.map((building) => [building.buildingKey, building.level]));

export const isUpgrading = (station: StationSnapshot, key: string): boolean => {
  const b = station.buildings.find((bld) => bld.buildingKey === key);
  return b?.upgradeEndsAt !== null && b?.upgradeEndsAt !== undefined;
};

export const hasActiveMining = (station: StationSnapshot): boolean =>
  station.miningAssignments.some((assignment) => assignment.assignedAmount > 0);

export const hasVisibleAsteroids = (_state: GoalBotState): boolean =>
  _state.visibleAsteroids.some((a) => a.remainingAmount > 0);

interface ResourceCost {
  resourceKey: ResourceKey;
  amount: number;
}

export function canAcquireCosts(
  state: GoalBotState,
  station: StationSnapshot,
  costs: readonly ResourceCost[]
): boolean {
  const canRedirectMiner = pickAvailableMinerKey(station) !== null || hasMinerInBuild(station);
  return costs
    .filter((cost) => (station.resources[cost.resourceKey] ?? 0) < cost.amount)
    .every((cost) => {
      if (cost.amount > station.storageCapacity) return false;
      const resourceKey = cost.resourceKey;
      const hasVisibleDeposit = state.visibleAsteroids.some(
        (asteroid) => (asteroid.remainingByResource[resourceKey] ?? 0) > 0
      );
      const hasAssignedSupply = station.miningAssignments.some((assignment) => {
        const asteroid = state.visibleAsteroids.find(
          (candidate) => candidate.id === assignment.asteroidId
        );
        return (
          assignment.assignedAmount > 0 && (asteroid?.remainingByResource[resourceKey] ?? 0) > 0
        );
      });
      return hasVisibleDeposit && (canRedirectMiner || hasAssignedSupply);
    });
}

export function waitForCosts(
  state: GoalBotState,
  station: StationSnapshot,
  costs: readonly ResourceCost[],
  detail: string,
  savingReason: string,
  blockedReason: string
): GoalResult {
  const reachable = canAcquireCosts(state, station, costs);
  return {
    type: reachable ? 'saving' : 'blocked',
    detail,
    reason: reachable ? savingReason : blockedReason,
  };
}

export function assignMinerTowardCosts(
  state: GoalBotState,
  station: StationSnapshot,
  costs: readonly ResourceCost[],
  purpose: string
): Extract<GoalResult, { type: 'success' }> | null {
  const missingCosts = costs.filter(
    (cost) => (station.resources[cost.resourceKey] ?? 0) < cost.amount
  );
  if (missingCosts.some((cost) => cost.amount > station.storageCapacity)) return null;
  const missing = new Set(missingCosts.map((cost) => cost.resourceKey));
  if (missing.size === 0) return null;
  const minerKey = pickAvailableMinerKey(station);
  if (!minerKey) return null;
  const usefulAsteroids = state.visibleAsteroids.filter((asteroid) =>
    entriesOf(asteroid.remainingByResource).some(
      ([resourceKey, amount]) =>
        missing.has(resourceKey) &&
        amount > 0 &&
        (station.resources[resourceKey] ?? 0) < station.storageCapacity
    )
  );
  if (usefulAsteroids.length === 0) return null;
  const asteroid = selectBestAsteroid(
    { ...state, visibleAsteroids: usefulAsteroids },
    station,
    minerKey
  );
  if (!asteroid) return null;
  return {
    type: 'success',
    intent: {
      type: 'assign_miner',
      stationId: station.id,
      asteroidId: asteroid.id,
      spacecraftKey: minerKey,
      amount: 1,
    },
    reason: `Assigning ${minerKey} at ${station.name} to resource supply for ${purpose}`,
  };
}

export function storageFillRatio(station: StationSnapshot): number {
  if (station.storageCapacity <= 0) return 1;
  return Math.max(
    0,
    ...Object.values(station.resources).map((amount) => amount / station.storageCapacity)
  );
}

export function buildingCanUpgrade(station: StationSnapshot, key: BuildingKey): boolean {
  const level = station.buildings.find((building) => building.buildingKey === key)?.level ?? 0;
  return level < getBuilding(key).maxLevel;
}

export function nextIncomeCosts(station: StationSnapshot): readonly ResourceCost[] {
  const moleAmount = station.fleets.find((fleet) => fleet.spacecraftKey === 'mole')?.amount ?? 0;
  const moleInBuild = Number(hasInBuild(station, 'mole'));
  if (moleAmount + moleInBuild < 3) {
    if (getShipyardLevel(station) < 1) return buildingUpgradeCost(station, 'shipyard');
    if (freeCrewCapacity(station) < (getSpacecraft('mole')?.crew ?? 0)) {
      return buildingUpgradeCost(station, 'hangar');
    }
    return moleCost();
  }

  const hasTitan =
    (station.fleets.find((fleet) => fleet.spacecraftKey === 'titan')?.amount ?? 0) > 0 ||
    hasInBuild(station, 'titan');
  if (hasTitan) return [];
  if (getShipyardLevel(station) < 5) return buildingUpgradeCost(station, 'shipyard');
  if (freeCrewCapacity(station) < (getSpacecraft('titan')?.crew ?? 0)) {
    return buildingUpgradeCost(station, 'hangar');
  }
  return titanCost();
}

export function initialStationId(state: GoalBotState): string | null {
  return (
    [...state.ownStations].sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
    )[0]?.id ?? null
  );
}

export function seeksMoreForeignContact(state: GoalBotState, profile: BotProfile): boolean {
  return (
    profile === 'warlord' &&
    !state.visibleStations.some((visible) => !visible.isOwn) &&
    state.completedExpeditions < state.ownStations.length * 2
  );
}

export function prioritizeStationsForStabilization(state: GoalBotState): StationSnapshot[] {
  const firstStationId = initialStationId(state);
  return [...state.ownStations].sort((left, right) => {
    const leftUnstable = !hasActiveMining(left) || !hasStorageHeadroom(state, left);
    const rightUnstable = !hasActiveMining(right) || !hasStorageHeadroom(state, right);
    const leftUnstableColony = left.id !== firstStationId && leftUnstable;
    const rightUnstableColony = right.id !== firstStationId && rightUnstable;
    if (leftUnstableColony !== rightUnstableColony) return leftUnstableColony ? -1 : 1;
    if (leftUnstable !== rightUnstable) return leftUnstable ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

/** Check if a station can afford a set of costs given its current resources. */
export const canAfford = (station: StationSnapshot, costs: readonly ResourceCost[]): boolean =>
  costs.every((c) => (station.resources[c.resourceKey] ?? 0) >= c.amount);

export const moleCost = () => MINER_COST;
export const titanCost = () => TITAN_COST;

/** The same research multipliers the services apply to the owner's stations. */
export const stationModifiers = (station: StationSnapshot) => researchModifiers(station.research);

export function effectiveCargo(station: StationSnapshot, baseCargo: number): number {
  return baseCargo * stationModifiers(station).cargo;
}

export function travelFactor(station: StationSnapshot): number {
  return 1 / stationModifiers(station).speed;
}

export const buildingUpgradeCost = (station: StationSnapshot, buildingKey: BuildingKey) => {
  const level =
    station.buildings.find((building) => building.buildingKey === buildingKey)?.level ?? 0;
  return applyBuildingCostDiscount(
    calculateBuildingUpgradeCost(buildingKey, level + 1),
    stationModifiers(station).buildingCost
  );
};

export const hasStorageHeadroom = (state: GoalBotState, station: StationSnapshot): boolean => {
  if (station.storageCapacity <= 0) return false;
  const assignedResources = station.miningAssignments.flatMap((assignment) => {
    const asteroid = state.visibleAsteroids.find(
      (candidate) => candidate.id === assignment.asteroidId
    );
    return asteroid ? entriesOf(asteroid.remainingByResource).map(([key]) => key) : [];
  });
  const relevantResources =
    assignedResources.length > 0
      ? [...new Set(assignedResources)]
      : entriesOf(station.resources).map(([key]) => key);
  return relevantResources.some(
    (resourceKey) => (station.resources[resourceKey] ?? 0) < station.storageCapacity
  );
};

function asteroidStorageFit(
  station: StationSnapshot,
  asteroid: GoalBotState['visibleAsteroids'][number]
) {
  const resources = entriesOf(asteroid.remainingByResource).filter(([, amount]) => amount > 0);
  if (resources.length === 0 || station.storageCapacity <= 0) return 0;
  const total = resources.reduce((sum, [, amount]) => sum + amount, 0);
  const storable = resources.reduce((sum, [resourceKey, amount]) => {
    const room = Math.max(0, station.storageCapacity - (station.resources[resourceKey] ?? 0));
    return sum + Math.min(amount, room);
  }, 0);
  return total > 0 ? storable / total : 0;
}

// ---------------------------------------------------------------------------
// Asteroid selection
// ---------------------------------------------------------------------------

export function selectBestAsteroid(
  state: GoalBotState,
  station: StationSnapshot,
  spacecraftKey: string
): { id: string; x: number; y: number } | null {
  const spacecraft = getSpacecraft(spacecraftKey);
  if (!spacecraft) return null;

  const candidates = state.visibleAsteroids
    .filter((a) => a.remainingAmount > 0)
    .map((a) => {
      const storageFit = asteroidStorageFit(station, a);
      const distance = calcDistance(station, a);
      const miningRate = spacecraft.miningRate * stationModifiers(station).miningRate;
      const cargoCapacity = effectiveCargo(station, spacecraft.cargo);
      const delivery = calculateMiningCycle({
        distance,
        speed: spacecraft.speed / travelFactor(station),
        miningRate,
        cargoCapacity,
        minerCount: 1,
        remainingAmount: a.remainingAmount,
      }).totalDeliveryPerHour;
      return { asteroid: a, score: delivery * storageFit, storageFit };
    })
    .filter((candidate) => candidate.storageFit > 0)
    .sort((a, b) => b.score - a.score || a.asteroid.id.localeCompare(b.asteroid.id));

  return candidates[0]?.asteroid ?? null;
}

/** Check hangar crew capacity remaining at a station. */
export function freeCrewCapacity(station: StationSnapshot): number {
  const hangarLvl = getHangarLevel(station);
  // Fleet Coordination raises the crew the hangar holds, as in the station service.
  const capacity = Math.floor(calculateHangarCapacity(hangarLvl) * stationModifiers(station).crew);
  const used = station.fleets.reduce((s, f) => {
    const sc = getSpacecraft(f.spacecraftKey);
    return s + f.amount * (sc?.crew ?? 0);
  }, 0);
  const queued = station.builds.reduce((s, b) => {
    const sc = getSpacecraft(b.spacecraftKey);
    return s + b.amount * (sc?.crew ?? 0);
  }, 0);
  return capacity - used - queued;
}
