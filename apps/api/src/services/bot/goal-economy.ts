import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import {
  getSpacecraft,
  COLONIZATION_COST,
  calculateBuildingUpgradeCost,
  calculateDefenseUpgradeCost,
  calculateDefenseUpgradeEffect,
  getDefenseUpgrade,
  calculateHangarCapacity,
  SHIPYARD_UNLOCKS,
} from '@orions-frontier/game-config';
import { getResearchDefinition, researchDefinitions } from '@orions-frontier/game-config';
import {
  buildingKeys,
  resourceKeys,
  type BuildingKey,
  type DefenseUpgradeKey,
} from '@orions-frontier/shared';
import { calculateMiningCycle } from '../../lib/mining-cycle.js';
import { calcDistance, calcTravelHours } from '../../lib/travel.js';
import type { GoalBotState, StationSnapshot } from './goal-state.js';
import type { GoalCandidate } from './goal-driven-v1.js';
import type { GoalResult } from './goal-lifecycle.service.js';
import { GOAL_CATEGORY } from './goal-driven-v1.js';
import { getFrontierTargets, getKnownSectors } from '../world-mission.service.js';
import {
  calculateHostility,
  calculateReserve,
  estimateDefenseScore,
  availableOffensivePower,
  scoreConflictTarget,
} from './conflict-intel.js';
import { PROFILE_PARAMS } from './bot-profiles.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINER_COST = getSpacecraft('mole')?.costs ?? [];
const TITAN_COST = getSpacecraft('titan')?.costs ?? [];

const hasAvailableShips = (station: StationSnapshot, key: string, minFree = 1): boolean => {
  const fleet = station.fleets.find((f) => f.spacecraftKey === key);
  return fleet !== undefined && fleet.amount - fleet.lockedAmount >= minFree;
};

const hasInBuild = (station: StationSnapshot, key: string): boolean =>
  station.builds.some((b) => b.spacecraftKey === key);

const getShipyardLevel = (station: StationSnapshot): number => {
  const b = station.buildings.find((bld) => bld.buildingKey === 'shipyard');
  return b?.level ?? 0;
};

const getWarehouseLevel = (station: StationSnapshot): number => {
  const b = station.buildings.find((bld) => bld.buildingKey === 'warehouse');
  return b?.level ?? 0;
};

const getHangarLevel = (station: StationSnapshot): number => {
  const b = station.buildings.find((bld) => bld.buildingKey === 'hangar');
  return b?.level ?? 0;
};

const getLaboratoryLevel = (station: StationSnapshot): number => {
  const b = station.buildings.find((bld) => bld.buildingKey === 'laboratory');
  return b?.level ?? 0;
};

const isUpgrading = (station: StationSnapshot, key: string): boolean => {
  const b = station.buildings.find((bld) => bld.buildingKey === key);
  return b?.upgradeEndsAt !== null && b?.upgradeEndsAt !== undefined;
};

const hasActiveMining = (station: StationSnapshot): boolean =>
  station.miningAssignments.some((assignment) => assignment.assignedAmount > 0);

const hasVisibleAsteroids = (_state: GoalBotState): boolean =>
  _state.visibleAsteroids.some((a) => a.remainingAmount > 0);

/** Check if a station can afford a set of costs given its current resources. */
const canAfford = (
  station: StationSnapshot,
  costs: readonly { resourceKey: string; amount: number }[]
): boolean =>
  costs.every(
    (c) => (station.resources[c.resourceKey as keyof typeof station.resources] ?? 0) >= c.amount
  );

const moleCost = () => MINER_COST;
const titanCost = () => TITAN_COST;

function hasCompletedTechnology(station: StationSnapshot, technologyKey: string): boolean {
  return station.research.some(
    (research) => research.technologyKey === technologyKey && research.status === 'completed'
  );
}

function effectiveCargo(station: StationSnapshot, baseCargo: number): number {
  return hasCompletedTechnology(station, 'modular_cargo_frames') ? baseCargo * 1.1 : baseCargo;
}

function travelFactor(station: StationSnapshot): number {
  return hasCompletedTechnology(station, 'vector_navigation') ? 0.9 : 1;
}

const buildingUpgradeCost = (station: StationSnapshot, buildingKey: BuildingKey) => {
  const level =
    station.buildings.find((building) => building.buildingKey === buildingKey)?.level ?? 0;
  return calculateBuildingUpgradeCost(buildingKey, level + 1);
};

const hasStorageHeadroom = (state: GoalBotState, station: StationSnapshot): boolean => {
  if (station.storageCapacity <= 0) return false;
  const assignedResources = station.miningAssignments.flatMap((assignment) => {
    const asteroid = state.visibleAsteroids.find(
      (candidate) => candidate.id === assignment.asteroidId
    );
    return asteroid ? Object.keys(asteroid.remainingByResource) : [];
  });
  const relevantResources =
    assignedResources.length > 0 ? [...new Set(assignedResources)] : Object.keys(station.resources);
  return relevantResources.some(
    (resourceKey) =>
      (station.resources[resourceKey as keyof typeof station.resources] ?? 0) <
      station.storageCapacity
  );
};

// ---------------------------------------------------------------------------
// Goal generators — create GoalCandidate for each economic goal
// ---------------------------------------------------------------------------

export function generateStabilizeCandidate(
  state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  // Check completion: has active mining + warehouse not permanently full
  if (hasActiveMining(station) && hasStorageHeadroom(state, station)) {
    // Station is already stabilized
    return null;
  }

  // Calculate how badly stabilization is needed
  const hasMiner = hasAvailableShips(station, 'mole');
  const hasMinerInBuild = hasInBuild(station, 'mole');

  let baseNeed = 80;
  if (hasMiner) baseNeed -= 20;
  if (hasMinerInBuild) baseNeed -= 10;

  return {
    goalType: 'stabilize_station',
    category: GOAL_CATEGORY['stabilize_station'],
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: hasVisibleAsteroids(state) ? 30 : 0,
    longTermValue: 50,
    commitment: 0,
    cost: hasMiner ? 10 : 30,
    risk: hasMiner ? 10 : 20,
    blockers: hasVisibleAsteroids(state) ? 0 : 40,
  };
}

export function generateIncreaseIncomeCandidate(
  _state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  const moleCount = station.fleets.find((f) => f.spacecraftKey === 'mole')?.amount ?? 0;
  const moleInBuild = Number(hasInBuild(station, 'mole'));
  const totalMoles = moleCount + moleInBuild;
  const hasTitan =
    (station.fleets.find((fleet) => fleet.spacecraftKey === 'titan')?.amount ?? 0) > 0 ||
    hasInBuild(station, 'titan');

  // If both milestones reached, no need for increase_income
  if (totalMoles >= 3 && hasTitan) return null;

  // Calculate progress toward milestones
  const progress = Math.min(1, (totalMoles / 3) * 0.6 + (hasTitan ? 0.4 : 0));
  let baseNeed = Math.round(60 * (1 - Number(progress)));

  return {
    goalType: 'increase_income',
    category: GOAL_CATEGORY['increase_income'],
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: hasVisibleAsteroids(_state) ? 20 : 0,
    longTermValue: 60,
    commitment: 0,
    cost: hasTitan ? 10 : canAfford(station, moleCost()) ? 20 : 40,
    risk: 10,
    blockers: 0,
  };
}

export function generateIncreaseCapacityCandidate(
  _state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  // Find the bottleneck: which building is worth upgrading?
  const warehouse = getWarehouseLevel(station);
  const hangar = getHangarLevel(station);
  const lab = getLaboratoryLevel(station);

  const candidates: { key: string; currentLevel: number; need: number }[] = [];

  const storageTight =
    hasActiveMining(station) &&
    Object.values(station.resources).some(
      (amount) => station.storageCapacity > 0 && amount >= station.storageCapacity * 0.9
    );
  const crewBlocked = freeCrewCapacity(station) <= 0;
  const researchPointsUsed = station.research.reduce(
    (sum, research) => sum + (getResearchDefinition(research.technologyKey)?.points ?? 0),
    0
  );
  const researchCapacityBlocked =
    researchDefinitions.some(
      (definition) =>
        !station.research.some((research) => research.technologyKey === definition.key)
    ) &&
    researchPointsUsed + Math.min(...researchDefinitions.map((definition) => definition.points)) >
      lab * RESEARCH_LAB_CAPACITY_PER_LEVEL;

  // Capacity goals only exist for an observed bottleneck.
  if (storageTight) {
    candidates.push({ key: 'warehouse', currentLevel: warehouse, need: 60 - warehouse * 10 });
  }
  if (crewBlocked) {
    candidates.push({ key: 'hangar', currentLevel: hangar, need: 40 - hangar * 10 });
  }
  if (researchCapacityBlocked) {
    candidates.push({ key: 'laboratory', currentLevel: lab, need: 30 - lab * 10 });
  }

  if (candidates.length === 0) return null;

  // Pick the highest-need bottleneck
  const best = candidates.sort((a, b) => b.need - a.need)[0]!;

  if (isUpgrading(station, best.key)) return null;

  return {
    goalType: 'increase_capacity',
    category: GOAL_CATEGORY['increase_capacity'],
    targetRef: `station:${station.id}:${best.key}`,
    baseNeed: best.need,
    opportunity: 10,
    longTermValue: 30,
    commitment: 0,
    cost: 20,
    risk: 5,
    blockers: 0,
  };
}

/** Generate all economic candidates across all stations. */
export function generateEconomicCandidates(state: GoalBotState): GoalCandidate[] {
  const candidates: GoalCandidate[] = [];

  // Sort stations: unstable colonies first, then higher need, then station ID
  const sorted = [...state.ownStations].sort((a, b) => {
    const aStable = hasActiveMining(a);
    const bStable = hasActiveMining(b);
    if (aStable !== bStable) return aStable ? 1 : -1; // unstable first
    return a.id.localeCompare(b.id);
  });

  for (const station of sorted) {
    const s = generateStabilizeCandidate(state, station);
    if (s) candidates.push(s);

    const inc = generateIncreaseIncomeCandidate(state, station);
    if (inc) candidates.push(inc);

    const cap = generateIncreaseCapacityCandidate(state, station);
    if (cap) candidates.push(cap);

    // Research candidates per station
    const researchCands = generateResearchCandidates(station);
    candidates.push(...researchCands);
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Step executors — determine next action toward an economic goal
// ---------------------------------------------------------------------------

/**
 * Execute the next step for stabilize_station.
 * Returns a GoalResult describing what happened.
 */
export async function stepStabilizeStation(
  _state: GoalBotState,
  station: StationSnapshot,
  _profile: BotProfile
): Promise<GoalResult> {
  if (hasActiveMining(station) && hasStorageHeadroom(_state, station)) {
    return {
      type: 'complete',
      goalType: 'stabilize_station',
      targetRef: `station:${station.id}`,
      reason: `${station.name} has an active mining assignment`,
    };
  }

  if (hasActiveMining(station) && !hasStorageHeadroom(_state, station)) {
    if (isUpgrading(station, 'warehouse')) {
      return {
        type: 'waiting',
        detail: 'warehouse_upgrading',
        reason: `Waiting for Warehouse capacity at ${station.name}`,
      };
    }
    if (canAfford(station, buildingUpgradeCost(station, 'warehouse'))) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'warehouse' },
        reason: `Expanding Warehouse at ${station.name} for mining deliveries`,
      };
    }
    return {
      type: 'saving',
      detail: 'warehouse',
      reason: `Saving for Warehouse capacity at ${station.name}`,
    };
  }

  // 1. Free miner → assign
  if (hasAvailableShips(station, 'mole')) {
    const asteroid = selectBestAsteroid(_state, station, 'mole');
    if (asteroid) {
      return {
        type: 'success',
        intent: {
          type: 'assign_miner',
          stationId: station.id,
          asteroidId: asteroid.id,
          spacecraftKey: 'mole',
          amount: 1,
        },
        reason: `Assigning free Mole at ${station.name} to asteroid ${asteroid.id}`,
      };
    }
    if (isUpgrading(station, 'scanner')) {
      return {
        type: 'waiting',
        detail: 'scanner_upgrading',
        reason: `Waiting for Scanner range at ${station.name}`,
      };
    }
    if (canAfford(station, buildingUpgradeCost(station, 'scanner'))) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'scanner' },
        reason: `Expanding Scanner at ${station.name} to find a mineable asteroid`,
      };
    }
    return {
      type: 'saving',
      detail: 'scanner',
      reason: `Saving for Scanner range at ${station.name}`,
    };
  }

  // 2. No mole → build one
  const moleCount = station.fleets.find((f) => f.spacecraftKey === 'mole')?.amount ?? 0;
  if (moleCount === 0) {
    if (hasInBuild(station, 'mole')) {
      return {
        type: 'waiting',
        detail: 'mole_building',
        reason: `Waiting for first Mole at ${station.name}`,
      };
    }
    if (canAfford(station, moleCost())) {
      return {
        type: 'success',
        intent: {
          type: 'build_spacecraft',
          stationId: station.id,
          spacecraftKey: 'mole',
          amount: 1,
        },
        reason: `Building first Mole at ${station.name} to enable mining`,
      };
    }
    // Check prerequisites
    if (getShipyardLevel(station) < 1) {
      if (canAfford(station, buildingUpgradeCost(station, 'shipyard'))) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
          reason: `Upgrading Shipyard at ${station.name} for Mole construction`,
        };
      }
      return {
        type: 'blocked',
        detail: 'no_shipyard',
        reason: `Shipyard required at ${station.name}`,
      };
    }
    return {
      type: 'saving',
      detail: 'mole',
      reason: `Saving resources for first Mole at ${station.name}`,
    };
  }

  const moleFleet = station.fleets.find((fleet) => fleet.spacecraftKey === 'mole');
  if (
    !hasActiveMining(station) &&
    moleFleet &&
    moleFleet.lockedAmount > 0 &&
    (station.trips.some((trip) => trip.status === 'traveling') ||
      station.missions.some((mission) => mission.status === 'traveling'))
  ) {
    return {
      type: 'waiting',
      detail: 'miner_returning',
      reason: `Waiting for a Mole to return to ${station.name}`,
    };
  }

  // 3. Check warehouse/scanner bottleneck
  if (!hasStorageHeadroom(_state, station) && !isUpgrading(station, 'warehouse')) {
    if (canAfford(station, buildingUpgradeCost(station, 'warehouse'))) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'warehouse' },
        reason: `Expanding Warehouse at ${station.name} for delivery capacity`,
      };
    }
    return {
      type: 'saving',
      detail: 'warehouse',
      reason: `Saving for Warehouse upgrade at ${station.name}`,
    };
  }

  return { type: 'blocked', detail: 'unknown', reason: `Cannot stabilize ${station.name}` };
}

/**
 * Execute the next step for increase_income.
 */
export async function stepIncreaseIncome(
  _state: GoalBotState,
  station: StationSnapshot,
  _profile: BotProfile
): Promise<GoalResult> {
  const moleCnt = station.fleets.find((f) => f.spacecraftKey === 'mole')?.amount ?? 0;
  const moleInBld = Number(hasInBuild(station, 'mole'));
  const totalMls = moleCnt + moleInBld;
  const hasTtn =
    (station.fleets.find((fleet) => fleet.spacecraftKey === 'titan')?.amount ?? 0) > 0 ||
    hasInBuild(station, 'titan');

  // Milestone 1: 3 Moles
  if (totalMls < 3) {
    if (hasInBuild(station, 'mole')) {
      return {
        type: 'waiting',
        detail: 'mole_building',
        reason: `Waiting for Mole construction at ${station.name}`,
      };
    }
    if (getShipyardLevel(station) < 1) {
      if (canAfford(station, buildingUpgradeCost(station, 'shipyard'))) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
          reason: `Upgrading Shipyard at ${station.name} for Mole`,
        };
      }
      return {
        type: 'blocked',
        detail: 'no_shipyard',
        reason: `Shipyard required at ${station.name}`,
      };
    }
    // Check hangar capacity
    if (getHangarLevel(station) < 1 && moleCnt >= 2) {
      if (canAfford(station, buildingUpgradeCost(station, 'hangar'))) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'hangar' },
          reason: `Expanding Hangar at ${station.name} for more miners`,
        };
      }
      return {
        type: 'saving',
        detail: 'hangar',
        reason: `Saving for Hangar upgrade at ${station.name}`,
      };
    }
    if (canAfford(station, moleCost())) {
      return {
        type: 'success',
        intent: {
          type: 'build_spacecraft',
          stationId: station.id,
          spacecraftKey: 'mole',
          amount: 1,
        },
        reason: `Building Mole ${totalMls + 1}/3 at ${station.name}`,
      };
    }
    return { type: 'saving', detail: 'mole', reason: `Saving for Mole at ${station.name}` };
  }

  // Milestone 2: 1 Titan
  if (!hasTtn) {
    if (hasInBuild(station, 'titan')) {
      return {
        type: 'waiting',
        detail: 'titan_building',
        reason: `Waiting for Titan construction at ${station.name}`,
      };
    }
    if (getShipyardLevel(station) < 5) {
      if (canAfford(station, buildingUpgradeCost(station, 'shipyard'))) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
          reason: `Upgrading Shipyard to level ${getShipyardLevel(station) + 1} at ${station.name} for Titan`,
        };
      }
      return {
        type: 'saving',
        detail: 'shipyard',
        reason: `Saving for Shipyard upgrade at ${station.name}`,
      };
    }
    if (canAfford(station, titanCost())) {
      return {
        type: 'success',
        intent: {
          type: 'build_spacecraft',
          stationId: station.id,
          spacecraftKey: 'titan',
          amount: 1,
        },
        reason: `Building first Titan at ${station.name}`,
      };
    }
    return { type: 'saving', detail: 'titan', reason: `Saving for Titan at ${station.name}` };
  }

  // Both milestones reached → goal complete
  return {
    type: 'complete',
    goalType: 'increase_income',
    targetRef: `station:${station.id}`,
    reason: `Income milestones reached at ${station.name}`,
  };
}

/**
 * Execute the next step for increase_capacity.
 */
export async function stepIncreaseCapacity(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  // targetRef format: station:<id>:<buildingKey>
  const parts = targetRef.split(':');
  const buildingKey = parts[2];
  if (!buildingKey) {
    return {
      type: 'complete',
      goalType: 'increase_capacity',
      targetRef,
      reason: 'No building key in target',
    };
  }
  if (!(buildingKeys as readonly string[]).includes(buildingKey)) {
    return {
      type: 'blocked',
      detail: 'invalid_building',
      reason: `Unknown capacity building: ${buildingKey}`,
    };
  }

  if (isUpgrading(station, buildingKey)) {
    return {
      type: 'waiting',
      detail: `${buildingKey}_upgrading`,
      reason: `Waiting for ${buildingKey} upgrade at ${station.name}`,
    };
  }

  const validBuildingKey = buildingKey as BuildingKey;
  if (canAfford(station, buildingUpgradeCost(station, validBuildingKey))) {
    return {
      type: 'success',
      intent: {
        type: 'upgrade_building',
        stationId: station.id,
        buildingKey: validBuildingKey,
      },
      reason: `Upgrading ${buildingKey} at ${station.name} for capacity`,
    };
  }

  return {
    type: 'saving',
    detail: buildingKey,
    reason: `Saving for ${buildingKey} upgrade at ${station.name}`,
  };
}

// ---------------------------------------------------------------------------
// Research goal — candidate generation and step execution
// ---------------------------------------------------------------------------

const RESEARCH_LAB_CAPACITY_PER_LEVEL = 5;

function researchBenefit(
  station: StationSnapshot,
  techKey: string
): { score: number; reason: string } {
  switch (techKey) {
    case 'automated_shipyard': {
      const queuedShips = station.builds.reduce((sum, build) => sum + build.amount, 0);
      return {
        score: queuedShips > 0 ? 50 + Math.min(20, queuedShips * 5) : 20,
        reason: queuedShips > 0 ? `${queuedShips} ships in construction` : 'no current ship builds',
      };
    }
    case 'extraction_algorithms': {
      const minerCount = station.miningAssignments.reduce(
        (sum, assignment) => sum + assignment.assignedAmount,
        0
      );
      const hasActive = hasActiveMining(station);
      return {
        score: hasActive ? 50 + minerCount * 5 : 20,
        reason: hasActive ? `${minerCount} miners active` : 'no active mining',
      };
    }
    case 'modular_cargo_frames': {
      const miners = station.fleets.find((f) => f.spacecraftKey === 'mole')?.amount ?? 0;
      const salvagers = station.fleets.find((f) => f.spacecraftKey === 'collector')?.amount ?? 0;
      const total = miners + salvagers;
      const lowWarehouse = getWarehouseLevel(station) < 2;
      return {
        score: total > 0 ? 30 + total * 5 + (lowWarehouse ? 20 : 0) : 10,
        reason:
          total > 0
            ? `${total} miners/salvagers, warehouse ${lowWarehouse ? 'tight' : 'ok'}`
            : 'no cargo ships',
      };
    }
    case 'vector_navigation': {
      const activeTrips =
        station.trips.filter((trip) => trip.status === 'traveling').length +
        station.missions.filter((mission) => mission.status === 'traveling').length;
      return {
        score: activeTrips > 0 ? 40 + activeTrips * 5 : 15,
        reason: activeTrips > 0 ? `${activeTrips} active trips` : 'no active trips',
      };
    }
    case 'combat_analytics': {
      const fighters = station.fleets
        .filter((fleet) => getSpacecraft(fleet.spacecraftKey)?.role === 'fighter')
        .reduce((sum, fleet) => sum + fleet.amount, 0);
      return {
        score: fighters > 0 ? 40 + fighters * 3 : 10,
        reason: fighters > 0 ? `${fighters} fighters` : 'no fighters',
      };
    }
    case 'station_grid_optimization': {
      const upgrading =
        station.buildings.filter((building) => building.upgradeEndsAt !== null).length +
        station.defense.filter((defense) => defense.upgradeEndsAt !== null).length;
      return {
        score: upgrading > 0 ? 30 + upgrading * 5 : 15,
        reason: upgrading > 0 ? `${upgrading} upgrades in progress` : 'no active upgrades',
      };
    }
    default:
      return { score: 0, reason: 'unknown tech' };
  }
}

export function generateResearchCandidates(station: StationSnapshot): GoalCandidate[] {
  const candidates: GoalCandidate[] = [];
  const started = new Set(station.research.map((r) => r.technologyKey));

  for (const def of researchDefinitions) {
    if (started.has(def.key)) continue;

    const benefit = researchBenefit(station, def.key);
    const affordRatio = canAfford(station, def.costs)
      ? 1.0
      : def.costs.every(
            (c) => (station.resources[c.resourceKey as keyof typeof station.resources] ?? 0) > 0
          )
        ? 0.5
        : 0.0;

    const baseNeed = Math.round(benefit.score * affordRatio);
    if (baseNeed <= 0) continue;

    const totalCost = def.costs.reduce((s, c) => s + c.amount, 0);
    const labOk = getLaboratoryLevel(station) >= 1;

    candidates.push({
      goalType: 'research_technology',
      category: GOAL_CATEGORY['research_technology'],
      targetRef: `tech:${station.id}:${def.key}`,
      baseNeed,
      opportunity: affordRatio >= 1 ? 30 : 10,
      longTermValue: benefit.score,
      commitment: 0,
      cost: Math.round(totalCost / 10),
      risk: 5,
      blockers: affordRatio === 0 ? 80 : labOk ? 0 : 50,
    });
  }

  return candidates;
}

export async function stepResearchTechnology(
  station: StationSnapshot,
  targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  // targetRef format: tech:<stationId>:<key>
  const parts = targetRef.split(':');
  const techKey = parts[2];
  if (!techKey) {
    return {
      type: 'blocked',
      detail: 'invalid_target',
      reason: `Invalid research target: ${targetRef}`,
    };
  }

  const def = getResearchDefinition(techKey);
  if (!def) {
    return { type: 'blocked', detail: 'unknown_tech', reason: `Unknown technology: ${techKey}` };
  }

  // Check if already started or completed
  const existing = station.research.find((r) => r.technologyKey === techKey);
  if (existing) {
    if (existing.status === 'completed') {
      return {
        type: 'complete',
        goalType: 'research_technology',
        targetRef,
        reason: `${def.name} completed`,
      };
    }
    return {
      type: 'waiting',
      detail: `${techKey}_researching`,
      reason: `Waiting for ${def.name} to complete`,
    };
  }

  // Check lab
  const labLevel = getLaboratoryLevel(station);
  if (labLevel < 1) {
    if (isUpgrading(station, 'laboratory')) {
      return {
        type: 'waiting',
        detail: 'laboratory_upgrading',
        reason: `Waiting for Laboratory at ${station.name}`,
      };
    }
    if (canAfford(station, buildingUpgradeCost(station, 'laboratory'))) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'laboratory' },
        reason: `Building Laboratory capacity for ${def.name}`,
      };
    }
    return {
      type: hasActiveMining(station) ? 'saving' : 'blocked',
      detail: 'no_laboratory',
      reason: hasActiveMining(station)
        ? `Saving for Laboratory required by ${def.name}`
        : `Laboratory for ${def.name} is blocked without income`,
    };
  }

  // Check lab capacity
  const usedPoints = station.research.reduce(
    (sum, r) => sum + (getResearchDefinition(r.technologyKey)?.points ?? 0),
    0
  );
  const capacity = labLevel * RESEARCH_LAB_CAPACITY_PER_LEVEL;
  if (usedPoints + def.points > capacity) {
    if (isUpgrading(station, 'laboratory')) {
      return {
        type: 'waiting',
        detail: 'laboratory_upgrading',
        reason: `Waiting for Laboratory capacity for ${def.name}`,
      };
    }
    if (canAfford(station, buildingUpgradeCost(station, 'laboratory'))) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'laboratory' },
        reason: `Expanding Laboratory capacity for ${def.name}`,
      };
    }
    return {
      type: hasActiveMining(station) ? 'saving' : 'blocked',
      detail: 'lab_capacity',
      reason: hasActiveMining(station)
        ? `Saving for Laboratory capacity for ${def.name}`
        : `Laboratory capacity for ${def.name} is blocked without income`,
    };
  }

  // Check resources
  if (!canAfford(station, def.costs)) {
    return {
      type: hasActiveMining(station) ? 'saving' : 'blocked',
      detail: `research_${techKey}`,
      reason: hasActiveMining(station)
        ? `Saving resources for ${def.name}`
        : `Cannot save for ${def.name} without active income`,
    };
  }

  // Start research
  return {
    type: 'success',
    intent: { type: 'start_research', stationId: station.id, technologyKey: techKey },
    reason: `Starting research ${def.name} (${researchBenefit(station, def.key).reason})`,
  };
}

// ---------------------------------------------------------------------------
// Asteroid selection
// ---------------------------------------------------------------------------

function selectBestAsteroid(
  state: GoalBotState,
  station: StationSnapshot,
  spacecraftKey: string
): { id: string; x: number; y: number } | null {
  const spacecraft = getSpacecraft(spacecraftKey);
  if (!spacecraft) return null;

  const candidates = state.visibleAsteroids
    .filter((a) => a.remainingAmount > 0)
    .map((a) => {
      const distance = calcDistance(station, a);
      const miningRate = hasCompletedTechnology(station, 'extraction_algorithms')
        ? spacecraft.miningRate * 1.1
        : spacecraft.miningRate;
      const cargoCapacity = effectiveCargo(station, spacecraft.cargo);
      const delivery = calculateMiningCycle({
        distance,
        speed: spacecraft.speed / travelFactor(station),
        miningRate,
        cargoCapacity,
        minerCount: 1,
        remainingAmount: a.remainingAmount,
      }).totalDeliveryPerHour;
      return { asteroid: a, score: delivery };
    })
    .sort((a, b) => b.score - a.score || a.asteroid.id.localeCompare(b.asteroid.id));

  return candidates[0]?.asteroid ?? null;
}

// ---------------------------------------------------------------------------
// Exploration & Colonization
// ---------------------------------------------------------------------------

export async function generateExploreSectorCandidate(
  state: GoalBotState,
  station: StationSnapshot
): Promise<GoalCandidate | null> {
  // Check if station already has an active expedition
  const hasActiveExpedition = station.missions.some(
    (mission) =>
      mission.missionType === 'expedition' &&
      (mission.status === 'traveling' || mission.status === 'returning')
  );
  if (hasActiveExpedition) return null;

  // Get frontier targets for this station
  const frontiers = (await getFrontierTargets(state.userId, station.id)).map((target) => ({
    sectorX: target.sectorX,
    sectorY: target.sectorY,
    distance: target.distance,
  }));
  if (frontiers.length === 0) return null;

  // Check if we have an available ship for the trip
  const hasShip = station.fleets.some((f) => {
    const sc = getSpacecraft(f.spacecraftKey);
    return sc && sc.role !== 'fighter' && f.amount - f.lockedAmount > 0;
  });
  if (!hasShip) return null;

  const nearest = frontiers[0]!;
  // Base need depends on distance — closer is better
  const maxDist = 100_000;
  const baseNeed = Math.round(50 * Math.max(0.1, 1 - nearest.distance / maxDist));

  return {
    goalType: 'explore_sector',
    category: GOAL_CATEGORY['explore_sector'],
    targetRef: `sector:${nearest.sectorX}:${nearest.sectorY}`,
    baseNeed,
    opportunity: 20,
    longTermValue: 60,
    commitment: 0,
    cost: 15,
    risk: 10,
    blockers: 0,
  };
}

export async function generateEstablishColonyCandidate(
  state: GoalBotState,
  station: StationSnapshot,
  profile: BotProfile = 'industrialist'
): Promise<GoalCandidate | null> {
  // Check if station already has an active colonization
  const hasActiveColony = station.missions.some(
    (m) => m.missionType === 'colonization' && m.status === 'traveling'
  );
  if (hasActiveColony) return null;

  // Get known sectors and check which are frontier without own station
  const known = (await getKnownSectors(state.userId, station.id))
    .filter((sector) => sector.role === 'frontier' && !sector.hasOwnStation)
    .map((sector) => ({
      sectorX: sector.sectorX,
      sectorY: sector.sectorY,
      distance: sector.distance,
      role: sector.role,
      hasOwnStation: sector.hasOwnStation,
    }));
  if (known.length === 0) return null;

  // Check if we can afford colonization
  const canAffordColony = Object.entries(COLONIZATION_COST).every(
    ([key, amount]) => (station.resources[key as keyof typeof station.resources] ?? 0) >= amount
  );
  // Check if station has a miner ship to send
  const hasMiner = station.fleets.some((f) => {
    const sc = getSpacecraft(f.spacecraftKey);
    return sc && sc.role === 'miner' && f.amount - f.lockedAmount > 0;
  });

  const nearest = known[0]!;
  const maxDist = 100_000;
  const baseNeed = Math.min(
    100,
    Math.round(
      (canAffordColony ? 60 : 40) *
        Math.max(0.1, 1 - nearest.distance / maxDist) *
        PROFILE_PARAMS[profile].colonizationFactor
    )
  );

  return {
    goalType: 'establish_colony',
    category: GOAL_CATEGORY['establish_colony'],
    targetRef: `sector:${nearest.sectorX}:${nearest.sectorY}`,
    baseNeed,
    opportunity: hasMiner ? 20 : 5,
    longTermValue: 70,
    commitment: 0,
    cost: canAffordColony ? 20 : 40,
    risk: 15,
    blockers: canAffordColony ? (hasMiner ? 0 : 30) : 50,
  };
}

export async function stepExploreSector(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  const parts = targetRef.split(':');
  const sectorX = Number(parts[1]);
  const sectorY = Number(parts[2]);
  if (isNaN(sectorX) || isNaN(sectorY)) {
    return {
      type: 'blocked',
      detail: 'invalid_coords',
      reason: `Invalid sector target: ${targetRef}`,
    };
  }

  // Check if already traveling there
  const existing = _state.ownStations.some((candidate) =>
    candidate.missions.some(
      (mission) =>
        mission.missionType === 'expedition' &&
        (mission.status === 'traveling' || mission.status === 'returning') &&
        mission.targetSectorX === sectorX &&
        mission.targetSectorY === sectorY
    )
  );
  if (existing) {
    return {
      type: 'waiting',
      detail: 'expedition_traveling',
      reason: `Expedition to sector ${sectorX}:${sectorY} underway`,
    };
  }

  const knownSectors = await getKnownSectors(_state.userId, station.id);
  if (knownSectors.some((known) => known.sectorX === sectorX && known.sectorY === sectorY)) {
    return {
      type: 'complete',
      goalType: 'explore_sector',
      targetRef,
      reason: `Sector ${sectorX}:${sectorY} explored`,
    };
  }

  return {
    type: 'success',
    intent: { type: 'start_expedition', stationId: station.id, sectorX, sectorY },
    reason: `Launching expedition to sector ${sectorX}:${sectorY}`,
  };
}

export async function stepEstablishColony(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  const parts = targetRef.split(':');
  const sectorX = Number(parts[1]);
  const sectorY = Number(parts[2]);
  if (isNaN(sectorX) || isNaN(sectorY)) {
    return {
      type: 'blocked',
      detail: 'invalid_coords',
      reason: `Invalid colony target: ${targetRef}`,
    };
  }

  const colony = _state.ownStations.find(
    (candidate) => candidate.sectorX === sectorX && candidate.sectorY === sectorY
  );
  if (colony) {
    const stabilization = await stepStabilizeStation(_state, colony, _profile);
    if (stabilization.type === 'complete') {
      return {
        type: 'complete',
        goalType: 'establish_colony',
        targetRef,
        reason: `Colony ${colony.name} at ${sectorX}:${sectorY} is self-sustaining`,
      };
    }
    return stabilization;
  }

  // Check if already colonizing to this specific sector
  const existing = _state.ownStations.some((candidate) =>
    candidate.missions.some(
      (mission) =>
        mission.missionType === 'colonization' &&
        mission.status === 'traveling' &&
        mission.targetSectorX === sectorX &&
        mission.targetSectorY === sectorY
    )
  );
  if (existing) {
    return {
      type: 'waiting',
      detail: 'colony_traveling',
      reason: `Colony ship to sector ${sectorX}:${sectorY} underway`,
    };
  }

  // Check resources
  const canAffordColony = Object.entries(COLONIZATION_COST).every(
    ([key, amount]) => (station.resources[key as keyof typeof station.resources] ?? 0) >= amount
  );
  if (!canAffordColony) {
    return {
      type: 'saving',
      detail: 'colony_cost',
      reason: `Saving resources for colony at sector ${sectorX}:${sectorY}`,
    };
  }

  return {
    type: 'success',
    intent: {
      type: 'start_colonization',
      stationId: station.id,
      sectorX,
      sectorY,
      name: `Colony ${sectorX}:${sectorY}`,
    },
    reason: `Founding colony at sector ${sectorX}:${sectorY}`,
  };
}

// ---------------------------------------------------------------------------
// Defense & Strike Force
// ---------------------------------------------------------------------------

const TARGET_DEFENSE_SCORE = 50;
const TARGET_STRIKE_ATTACK = 80;

/** Current defense score for a station from its defense upgrades. */
function defenseScore(station: StationSnapshot): number {
  return station.defense.reduce((sum, d) => {
    const effect = calculateDefenseUpgradeEffect(d.upgradeKey as DefenseUpgradeKey, d.level);
    return sum + effect.reduce((s, e) => s + e.value, 0);
  }, 0);
}

/** Available defense upgrades that can still be raised. */
function upgradeableDefenses(station: StationSnapshot): { upgradeKey: string; level: number }[] {
  return station.defense.filter((d) => {
    const def = getDefenseUpgrade(d.upgradeKey as DefenseUpgradeKey);
    return d.level < def.maxLevel && d.upgradeEndsAt === null;
  });
}

/** Total attack power of all fighters owned + in build at this station. */
function localFighterAttack(station: StationSnapshot): number {
  const analyticsFactor = station.research.some(
    (research) => research.technologyKey === 'combat_analytics' && research.status === 'completed'
  )
    ? 1.1
    : 1;
  const fleetPower = station.fleets
    .filter((f) => {
      const sc = getSpacecraft(f.spacecraftKey);
      return sc?.role === 'fighter';
    })
    .reduce(
      (sum, f) => sum + f.amount * (getSpacecraft(f.spacecraftKey)?.attack ?? 0) * analyticsFactor,
      0
    );
  const buildPower = station.builds
    .filter((b) => {
      const sc = getSpacecraft(b.spacecraftKey);
      return sc?.role === 'fighter';
    })
    .reduce(
      (sum, b) => sum + b.amount * (getSpacecraft(b.spacecraftKey)?.attack ?? 0) * analyticsFactor,
      0
    );
  return Math.floor(fleetPower + buildPower);
}

function availableFighterAttack(station: StationSnapshot): number {
  const analyticsFactor = station.research.some(
    (research) => research.technologyKey === 'combat_analytics' && research.status === 'completed'
  )
    ? 1.1
    : 1;
  return Math.floor(
    station.fleets.reduce((sum, fleet) => {
      const spacecraft = getSpacecraft(fleet.spacecraftKey);
      return spacecraft?.role === 'fighter'
        ? sum + (fleet.amount - fleet.lockedAmount) * spacecraft.attack * analyticsFactor
        : sum;
    }, 0)
  );
}

function wasRecentlyAttacked(state: GoalBotState, station: StationSnapshot, now: Date): boolean {
  const cutoff = now.getTime() - 24 * 3_600_000;
  return state.combatReports.some(
    (report) =>
      report.defenderUserId === state.userId &&
      report.defenderStationId === station.id &&
      new Date(report.createdAt).getTime() >= cutoff
  );
}

/** Fighter types unlocked at the station's shipyard level. */
function unlockedFighters(station: StationSnapshot): { key: string; attack: number }[] {
  const syLevel = getShipyardLevel(station);
  const keys = new Set<string>();
  for (let lvl = 2; lvl <= syLevel; lvl++) {
    const unlocks = SHIPYARD_UNLOCKS[lvl] ?? [];
    for (const k of unlocks) {
      const sc = getSpacecraft(k);
      if (sc?.role === 'fighter') keys.add(k);
    }
  }
  return [...keys].map((k) => ({ key: k, attack: getSpacecraft(k)?.attack ?? 0 }));
}

/** Choose the best defense upgrade by defense gain per cost. */
function bestDefenseUpgrade(
  station: StationSnapshot
): { upgradeKey: string; targetLevel: number; gain: number } | null {
  const candidates = upgradeableDefenses(station);
  if (candidates.length === 0) return null;

  let best: { upgradeKey: string; targetLevel: number; gain: number; score: number } | null = null;

  for (const d of candidates) {
    const targetLevel = d.level + 1;
    const currentEffect = calculateDefenseUpgradeEffect(d.upgradeKey as DefenseUpgradeKey, d.level);
    const nextEffect = calculateDefenseUpgradeEffect(
      d.upgradeKey as DefenseUpgradeKey,
      targetLevel
    );
    const gain =
      nextEffect.reduce((s, e) => s + e.value, 0) - currentEffect.reduce((s, e) => s + e.value, 0);
    const costs = calculateDefenseUpgradeCost(d.upgradeKey as DefenseUpgradeKey, targetLevel);
    const totalCost = costs.reduce((s, c) => s + c.amount, 0);
    const costWeight = totalCost > 0 ? gain / totalCost : gain;
    const score = gain * 10 + costWeight * 100;

    if (!best || score > best.score) {
      best = { upgradeKey: d.upgradeKey, targetLevel, gain, score };
    }
  }

  return best
    ? { upgradeKey: best.upgradeKey, targetLevel: best.targetLevel, gain: best.gain }
    : null;
}

/** Check if station has a shipyard at least at the given level. */
function hasShipyardLevel(station: StationSnapshot, level: number): boolean {
  return getShipyardLevel(station) >= level;
}

/** Check hangar crew capacity remaining at a station. */
function freeCrewCapacity(station: StationSnapshot): number {
  const hangarLvl = getHangarLevel(station);
  const capacity = calculateHangarCapacity(hangarLvl);
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

// ---------------------------------------------------------------------------
// Fortify generators & steps
// ---------------------------------------------------------------------------

export function generateFortifyCandidate(
  _state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  const current = defenseScore(station);
  if (current >= TARGET_DEFENSE_SCORE) return null;
  if (upgradeableDefenses(station).length === 0) return null;

  // Higher base need for new colonies, recently attacked, or valuable stations
  const isNewColony = !hasActiveMining(station);
  const totalBuildings = station.buildings.filter((b) => b.level > 0).length;
  const valueFactor = Math.min(totalBuildings / 10, 1);

  let baseNeed = 30;
  if (isNewColony) baseNeed += 20;
  if (wasRecentlyAttacked(_state, station, _state.now)) baseNeed += 25;
  if (totalBuildings > 5) baseNeed += 15;
  baseNeed += Math.round((1 - current / TARGET_DEFENSE_SCORE) * 30);

  return {
    goalType: 'fortify_station',
    category: GOAL_CATEGORY['fortify_station'],
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: 10,
    longTermValue: Math.round(30 * valueFactor),
    commitment: 0,
    cost: 15,
    risk: 5,
    blockers: 0,
  };
}

export async function stepFortifyStation(
  _state: GoalBotState,
  station: StationSnapshot,
  _targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  const current = defenseScore(station);
  if (current >= TARGET_DEFENSE_SCORE) {
    return {
      type: 'complete',
      goalType: 'fortify_station',
      targetRef: `station:${station.id}`,
      reason: `Station defense ${current} meets target ${TARGET_DEFENSE_SCORE}`,
    };
  }

  const best = bestDefenseUpgrade(station);
  if (!best) {
    return {
      type: 'blocked',
      detail: 'no_upgradeable_defense',
      reason: `All defenses at max level or upgrading`,
    };
  }

  // Check if already upgrading this defense
  const isUpgradingDef = station.defense.some(
    (d) => d.upgradeKey === best.upgradeKey && d.upgradeEndsAt !== null
  );
  if (isUpgradingDef) {
    return {
      type: 'waiting',
      detail: 'defense_upgrading',
      reason: `Defense ${best.upgradeKey} upgrading to level ${best.targetLevel}`,
    };
  }

  const costs = calculateDefenseUpgradeCost(best.upgradeKey as DefenseUpgradeKey, best.targetLevel);
  if (!canAfford(station, costs)) {
    return {
      type: 'saving',
      detail: 'defense_cost',
      reason: `Saving resources for ${best.upgradeKey} level ${best.targetLevel} (+${best.gain} defense)`,
    };
  }

  return {
    type: 'success',
    intent: {
      type: 'upgrade_defense',
      stationId: station.id,
      upgradeKey: best.upgradeKey as DefenseUpgradeKey,
    },
    reason: `Upgrading ${best.upgradeKey} to level ${best.targetLevel} (+${best.gain} defense)`,
  };
}

// ---------------------------------------------------------------------------
// Strike Force generators & steps
// ---------------------------------------------------------------------------

export function generateBuildStrikeForceCandidate(
  _state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  if (!hasShipyardLevel(station, 2)) return null; // Need at least Merlin
  const unlocked = unlockedFighters(station);
  if (unlocked.length === 0) return null;

  const current = localFighterAttack(station);
  if (current >= TARGET_STRIKE_ATTACK) return null;

  // Higher need for warlord, or if station was recently attacked
  const isNewColony = !hasActiveMining(station);
  let baseNeed = 30;
  if (!isNewColony) baseNeed += 10; // Established stations more likely to build force
  baseNeed += Math.round((1 - current / TARGET_STRIKE_ATTACK) * 30);

  return {
    goalType: 'build_strike_force',
    category: GOAL_CATEGORY['build_strike_force'],
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: 15,
    longTermValue: 40,
    commitment: 0,
    cost: 25,
    risk: 10,
    blockers: 0,
  };
}

export async function stepBuildStrikeForce(
  _state: GoalBotState,
  station: StationSnapshot,
  _targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  const current = localFighterAttack(station);
  if (current >= TARGET_STRIKE_ATTACK) {
    return {
      type: 'complete',
      goalType: 'build_strike_force',
      targetRef: `station:${station.id}`,
      reason: `Fighter attack ${current} meets target ${TARGET_STRIKE_ATTACK}`,
    };
  }

  // Need shipyard level 2 for first fighter
  if (!hasShipyardLevel(station, 2)) {
    // Check if shipyard can be upgraded
    const shipyard = station.buildings.find((b) => b.buildingKey === 'shipyard');
    if (shipyard && shipyard.upgradeEndsAt === null) {
      if (!canAfford(station, buildingUpgradeCost(station, 'shipyard'))) {
        return {
          type: 'saving',
          detail: 'shipyard_cost',
          reason: `Saving for Shipyard level ${(shipyard?.level ?? 0) + 1}`,
        };
      }
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
        reason: `Building Shipyard to level ${(shipyard?.level ?? 0) + 1} for fighter unlock`,
      };
    }
    if (shipyard?.upgradeEndsAt !== null) {
      return {
        type: 'waiting',
        detail: 'shipyard_upgrading',
        reason: `Shipyard upgrading for fighter unlock`,
      };
    }
    return {
      type: 'blocked',
      detail: 'no_shipyard',
      reason: `Shipyard level too low for fighters`,
    };
  }

  // If shipyard already at level 2+, check hangar capacity
  const crewCapacity = freeCrewCapacity(station);
  if (crewCapacity <= 0) {
    // Try upgrading hangar
    const hangar = station.buildings.find((b) => b.buildingKey === 'hangar');
    if (hangar && hangar.upgradeEndsAt === null) {
      if (!canAfford(station, buildingUpgradeCost(station, 'hangar'))) {
        return {
          type: 'saving',
          detail: 'hangar_cost',
          reason: `Saving for Hangar level ${(hangar?.level ?? 0) + 1}`,
        };
      }
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'hangar' },
        reason: `Building Hangar to level ${(hangar?.level ?? 0) + 1} for more crew capacity`,
      };
    }
    if (hangar?.upgradeEndsAt !== null) {
      return {
        type: 'waiting',
        detail: 'hangar_upgrading',
        reason: `Hangar upgrading for crew capacity`,
      };
    }
    return {
      type: 'blocked',
      detail: 'no_hangar_capacity',
      reason: `No crew capacity for more fighters`,
    };
  }

  // Pick the best fighter: best attack per crew ratio among unlocked, affordable types
  const unlocked = unlockedFighters(station);
  let best: { key: string; attack: number } | null = null;

  for (const f of unlocked) {
    const sc = getSpacecraft(f.key);
    if (!sc) continue;
    const costs = sc.costs ?? [];
    if (!canAfford(station, costs)) continue;
    const maxCount = Math.min(
      Math.floor(crewCapacity / sc.crew),
      1 // Build one at a time
    );
    if (maxCount < 1) continue;
    const efficiency = sc.attack / sc.crew;
    if (!best || efficiency > best.attack / (getSpacecraft(best.key)?.crew ?? 1)) {
      best = { key: f.key, attack: sc.attack };
    }
  }

  if (!best) {
    return {
      type: 'saving',
      detail: 'fighter_cost',
      reason: `Cannot afford any unlocked fighter`,
    };
  }

  return {
    type: 'success',
    intent: {
      type: 'build_spacecraft',
      stationId: station.id,
      spacecraftKey: best.key,
      amount: 1,
    },
    reason: `Building 1 ${best.key} (attack ${best.attack}, crew ${getSpacecraft(best.key)?.crew})`,
  };
}

// ---------------------------------------------------------------------------
// Raid & Retaliate
// ---------------------------------------------------------------------------

/** Safety margins on estimated target defense per profile (GB-17). */
const SAFETY_MARGIN: Record<BotProfile, number> = {
  industrialist: 1.4,
  pioneer: 1.3,
  technocrat: 1.25,
  warlord: 1.15,
};

/** Cooldown durations in ms. */
const COOLDOWN_WIN_MS = 6 * 3_600_000;
const COOLDOWN_LOSS_MS = 24 * 3_600_000;
const COOLDOWN_RETRY_RETALIATION_MS = 1 * 3_600_000;

/** Find the smallest fighter group that can exceed required attack power. */
function smallestSufficientGroup(
  station: StationSnapshot,
  requiredAttack: number
): { spacecraftKey: string; amount: number; totalAttack: number } | null {
  const groups = station.fleets
    .filter((f) => {
      const sc = getSpacecraft(f.spacecraftKey);
      return sc?.role === 'fighter' && f.amount - f.lockedAmount > 0;
    })
    .map((f) => ({
      spacecraftKey: f.spacecraftKey,
      available: f.amount - f.lockedAmount,
      attackPerShip: Math.floor(
        (getSpacecraft(f.spacecraftKey)?.attack ?? 0) *
          (station.research.some(
            (research) =>
              research.technologyKey === 'combat_analytics' && research.status === 'completed'
          )
            ? 1.1
            : 1)
      ),
    }))
    .filter((f) => f.attackPerShip > 0)
    .map((fighter) => {
      const amount = Math.ceil(requiredAttack / fighter.attackPerShip);
      return {
        spacecraftKey: fighter.spacecraftKey,
        amount,
        available: fighter.available,
        totalAttack: amount * fighter.attackPerShip,
      };
    })
    .filter((group) => group.amount <= group.available)
    .sort(
      (left, right) =>
        left.amount - right.amount ||
        left.totalAttack - right.totalAttack ||
        left.spacecraftKey.localeCompare(right.spacecraftKey)
    );

  const group = groups[0];
  return group
    ? {
        spacecraftKey: group.spacecraftKey,
        amount: group.amount,
        totalAttack: group.totalAttack,
      }
    : null;
}

export function isEligibleAttackSource(
  state: GoalBotState,
  station: StationSnapshot,
  targetStationId: string,
  profile: BotProfile
): boolean {
  const target = state.visibleStations.find((candidate) => candidate.id === targetStationId);
  if (!target) return false;
  const availableAttack = availableFighterAttack(station);
  const reserve = calculateReserve(
    availableAttack,
    profile,
    wasRecentlyAttacked(state, station, state.now),
    !hasActiveMining(station)
  );
  const requiredAttack = Math.max(
    1,
    Math.round(estimateDefenseScore(target.visualProfile) * SAFETY_MARGIN[profile])
  );
  const group = smallestSufficientGroup(station, requiredAttack);
  return group !== null && group.totalAttack <= availableOffensivePower(availableAttack, reserve);
}

/** Check if this station has attacked the given owner recently (cooldown). */
function hasCooldown(
  _station: StationSnapshot,
  state: GoalBotState,
  ownerId: string,
  now: Date
): { onCooldown: boolean; reason?: string } {
  const relevant = state.combatReports.filter(
    (r) =>
      (r.attackerUserId === state.userId || r.defenderUserId === state.userId) &&
      (r.attackerUserId === ownerId || r.defenderUserId === ownerId)
  );
  if (relevant.length === 0) return { onCooldown: false };

  const last = [...relevant].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0]!;

  const elapsed = now.getTime() - new Date(last.createdAt).getTime();
  const isAttacker = last.attackerUserId === state.userId;

  if (isAttacker && last.winner === 'attacker') {
    if (elapsed < COOLDOWN_WIN_MS) {
      return {
        onCooldown: true,
        reason: `Cooldown after won attack (${Math.round((COOLDOWN_WIN_MS - elapsed) / 60_000)}min remaining)`,
      };
    }
  } else if (isAttacker && last.winner !== 'attacker') {
    if (elapsed < COOLDOWN_LOSS_MS) {
      return {
        onCooldown: true,
        reason: `Cooldown after lost attack (${Math.round((COOLDOWN_LOSS_MS - elapsed) / 60_000)}min remaining)`,
      };
    }
  } else if (!isAttacker) {
    const hasRetaliated = relevant.some(
      (r) => r.attackerUserId === state.userId && r.defenderUserId === ownerId
    );
    if (hasRetaliated && elapsed < COOLDOWN_WIN_MS) {
      return { onCooldown: true, reason: `Already retaliated recently` };
    }
    if (elapsed < COOLDOWN_RETRY_RETALIATION_MS) {
      return {
        onCooldown: true,
        reason: `Recent attack, waiting for retaliation window (${Math.round((COOLDOWN_RETRY_RETALIATION_MS - elapsed) / 60_000)}min)`,
      };
    }
  }

  return { onCooldown: false };
}

/** Generate raid candidates for visible foreign stations. */
export function generateRaidCandidates(state: GoalBotState, _profile: BotProfile): GoalCandidate[] {
  const candidates = new Map<string, GoalCandidate>();
  const now = state.now;

  for (const station of state.ownStations) {
    const availableAttack = availableFighterAttack(station);
    const reserve = calculateReserve(
      availableAttack,
      _profile,
      wasRecentlyAttacked(state, station, now),
      !hasActiveMining(station)
    );
    const offensive = availableOffensivePower(availableAttack, reserve);
    if (offensive <= 0) continue;

    for (const target of state.visibleStations) {
      if (target.isOwn) continue;
      if (!target.visualProfile) continue;
      if (!isEligibleAttackSource(state, station, target.id, _profile)) continue;

      const cooldown = hasCooldown(station, state, target.ownerId, now);
      if (cooldown.onCooldown) continue;

      const dist = Math.hypot(target.x - station.x, target.y - station.y);
      const hostility = calculateHostility(state.userId, state.combatReports, now, target.ownerId);
      const scored = scoreConflictTarget({
        targetStationId: target.id,
        ownerId: target.ownerId,
        distance: dist,
        visualProfile: target.visualProfile,
        hostilityScore: hostility,
        profile: _profile,
        ownAttackPower: offensive,
        botUserId: state.userId,
      });
      if (scored.score <= 0) continue;

      const candidate: GoalCandidate = {
        goalType: 'raid',
        category: GOAL_CATEGORY['raid'],
        targetRef: `station:${target.id}`,
        baseNeed: Math.min(scored.score, 100),
        opportunity: scored.breakdown.lootValue,
        longTermValue: Math.round(scored.breakdown.retaliationValue / 2),
        commitment: 0,
        cost: Math.round(scored.breakdown.defensePenalty / 2),
        risk: Math.round(scored.breakdown.defensePenalty),
        blockers: 0,
      };
      const existing = candidates.get(candidate.targetRef);
      if (
        !existing ||
        candidate.baseNeed + candidate.opportunity - candidate.risk >
          existing.baseNeed + existing.opportunity - existing.risk
      ) {
        candidates.set(candidate.targetRef, candidate);
      }
    }
  }

  return [...candidates.values()];
}

/** Generate retaliation candidates from combat reports. */
export function generateRetaliateCandidates(
  state: GoalBotState,
  _profile: BotProfile
): GoalCandidate[] {
  const candidates = new Map<string, GoalCandidate>();
  const now = state.now;
  const recentCutoff = now.getTime() - 24 * 3_600_000;

  const attackerIds = new Set<string>();
  for (const report of state.combatReports) {
    if (
      report.defenderUserId === state.userId &&
      new Date(report.createdAt).getTime() >= recentCutoff
    ) {
      attackerIds.add(report.attackerUserId);
    }
  }

  for (const station of state.ownStations) {
    const availableAttack = availableFighterAttack(station);
    const reserve = calculateReserve(
      availableAttack,
      _profile,
      wasRecentlyAttacked(state, station, now),
      !hasActiveMining(station)
    );
    const offensive = availableOffensivePower(availableAttack, reserve);
    if (offensive <= 0) continue;

    for (const ownerId of attackerIds) {
      const target = state.visibleStations.find((s) => s.ownerId === ownerId && !s.isOwn);
      if (!target) continue;
      if (!isEligibleAttackSource(state, station, target.id, _profile)) continue;

      const cooldown = hasCooldown(station, state, ownerId, now);
      if (cooldown.onCooldown) continue;

      const dist = Math.hypot(target.x - station.x, target.y - station.y);
      const hostility = calculateHostility(state.userId, state.combatReports, now, ownerId);
      const scored = scoreConflictTarget({
        targetStationId: target.id,
        ownerId: target.ownerId,
        distance: dist,
        visualProfile: target.visualProfile,
        hostilityScore: hostility,
        profile: _profile,
        ownAttackPower: offensive,
        botUserId: state.userId,
      });

      const candidate: GoalCandidate = {
        goalType: 'retaliate',
        category: GOAL_CATEGORY['retaliate'],
        targetRef: `user:${ownerId}`,
        baseNeed: Math.min(scored.score + 20, 100),
        opportunity: scored.breakdown.lootValue,
        longTermValue: 50,
        commitment: 0,
        cost: Math.round(scored.breakdown.defensePenalty / 2),
        risk: Math.round(scored.breakdown.defensePenalty),
        blockers: 0,
      };
      const existing = candidates.get(candidate.targetRef);
      if (
        !existing ||
        candidate.baseNeed + candidate.opportunity - candidate.risk >
          existing.baseNeed + existing.opportunity - existing.risk
      ) {
        candidates.set(candidate.targetRef, candidate);
      }
    }
  }

  return [...candidates.values()];
}

/** Execute a raid against a visible target station. */
export async function stepRaid(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  profile: BotProfile
): Promise<GoalResult> {
  const parts = targetRef.split(':');
  const targetStationId = parts[1]!;

  const activeMission = station.combatMissions.find(
    (mission) =>
      mission.defenderStationId === targetStationId &&
      !['resolved', 'cancelled'].includes(mission.status)
  );
  if (activeMission) {
    return {
      type: 'waiting',
      detail: 'attack_underway',
      reason: `Attack on ${targetStationId} is ${activeMission.status}`,
    };
  }

  const attackPower = availableFighterAttack(station);
  if (attackPower <= 0) {
    return {
      type: 'blocked',
      detail: 'no_fighters',
      reason: `No fighter attack power at ${station.name}`,
    };
  }

  const target = _state.visibleStations.find((s) => s.id === targetStationId);
  if (!target) {
    return {
      type: 'blocked',
      detail: 'target_not_visible',
      reason: `Target station ${targetStationId} not visible`,
    };
  }

  const cooldown = hasCooldown(station, _state, target.ownerId, _state.now);
  if (cooldown.onCooldown) {
    return {
      type: 'complete',
      goalType: 'raid',
      targetRef,
      reason: cooldown.reason ?? `Attack on ${targetStationId} completed`,
    };
  }

  const estimatedDefense = estimateDefenseScore(target.visualProfile);
  const margin = SAFETY_MARGIN[profile];
  const requiredAttack = Math.max(1, Math.round(estimatedDefense * margin));

  const reserve = calculateReserve(
    attackPower,
    profile,
    wasRecentlyAttacked(_state, station, _state.now),
    !hasActiveMining(station)
  );
  const offensive = availableOffensivePower(attackPower, reserve);
  if (offensive <= 0) {
    return {
      type: 'blocked',
      detail: 'no_offensive_power',
      reason: `All ${attackPower} attack power reserved (need ${reserve} reserve)`,
    };
  }

  const group = smallestSufficientGroup(station, requiredAttack);
  if (!group || group.totalAttack > offensive) {
    return {
      type: 'saving',
      detail: 'needs_more_fighters',
      reason: `Need ${requiredAttack} attack to breach ${estimatedDefense} defense, have ${offensive} offensive power`,
    };
  }

  return {
    type: 'success',
    intent: {
      type: 'start_attack',
      stationId: station.id,
      targetStationId,
      spacecraftKey: group.spacecraftKey,
      amount: group.amount,
    },
    reason: `Attacking ${target.name || targetStationId} with ${group.amount}x ${group.spacecraftKey} (${group.totalAttack} attack vs est. ${estimatedDefense} defense)`,
  };
}

/** Execute a retaliation against a known attacker. */
export async function stepRetaliate(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  profile: BotProfile
): Promise<GoalResult> {
  const parts = targetRef.split(':');
  const ownerId = parts[1]!;

  const target = [..._state.visibleStations]
    .filter(
      (candidate) =>
        candidate.ownerId === ownerId &&
        !candidate.isOwn &&
        isEligibleAttackSource(_state, station, candidate.id, profile)
    )
    .sort((a, b) => {
      const distanceA = Math.hypot(a.x - station.x, a.y - station.y);
      const distanceB = Math.hypot(b.x - station.x, b.y - station.y);
      return distanceA - distanceB || a.id.localeCompare(b.id);
    })[0];
  if (!target) {
    return {
      type: 'blocked',
      detail: 'retaliate_target_not_visible',
      reason: `No visible station for attacker ${ownerId}`,
    };
  }

  return stepRaid(_state, station, `station:${target.id}`, profile);
}

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------

const COLLECTOR_KEY = 'collector';
const COLLECTOR_COST = getSpacecraft(COLLECTOR_KEY)?.costs ?? [];
const PAYBACK_THRESHOLD = 1.25;

/** Resource preference weights for valuing salvage cargo. */
const RESOURCE_WEIGHT: Record<string, number> = {
  carbon: 1.0,
  titanium: 1.2,
  hydrogenium: 1.5,
  kyber_crystal: 2.0,
  astatine: 3.0,
};

/** Estimate the total resource value of a debris field using preference weights. */
function debrisValue(resources: Record<string, number>): number {
  return Object.entries(resources).reduce(
    (sum, [key, amount]) => sum + amount * (RESOURCE_WEIGHT[key] ?? 0.5),
    0
  );
}

function usefulSalvageCargo(
  station: StationSnapshot,
  resources: Record<string, number>,
  cargoCapacity: number
): Record<string, number> {
  let remainingCargo = cargoCapacity;
  const cargo: Record<string, number> = {};
  for (const resourceKey of resourceKeys) {
    const storageRoom = Math.max(
      0,
      station.storageCapacity -
        (station.resources[resourceKey as keyof typeof station.resources] ?? 0)
    );
    const amount = Math.min(resources[resourceKey] ?? 0, storageRoom, remainingCargo);
    if (amount <= 0) continue;
    cargo[resourceKey] = amount;
    remainingCargo -= amount;
    if (remainingCargo <= 0) break;
  }
  return cargo;
}

function usefulSalvageValue(
  station: StationSnapshot,
  resources: Record<string, number>,
  cargoCapacity: number
): number {
  const cargo = usefulSalvageCargo(station, resources, cargoCapacity);
  return Object.entries(cargo).reduce((sum, [resourceKey, amount]) => {
    const fillRatio =
      station.storageCapacity > 0
        ? (station.resources[resourceKey as keyof typeof station.resources] ?? 0) /
          station.storageCapacity
        : 1;
    const localNeedMultiplier = 1 + Math.max(0, 1 - fillRatio);
    return sum + amount * (RESOURCE_WEIGHT[resourceKey] ?? 0.5) * localNeedMultiplier;
  }, 0);
}

/** Find the best visible asteroid for a station's mining comparison. */
function bestMiningRate(state: GoalBotState, station: StationSnapshot): number {
  const bestAsteroid = state.visibleAsteroids
    .filter((a) => a.remainingAmount > 0)
    .map((a) => ({
      asteroid: a,
      dist: Math.hypot(a.x - station.x, a.y - station.y),
    }))
    .sort((a, b) => a.dist - b.dist || a.asteroid.id.localeCompare(b.asteroid.id))[0];
  if (!bestAsteroid) return 0;

  const mole = getSpacecraft('mole');
  if (!mole) return 0;
  const miningRate = hasCompletedTechnology(station, 'extraction_algorithms')
    ? mole.miningRate * 1.1
    : mole.miningRate;
  const cargo = effectiveCargo(station, mole.cargo);
  const miningHours = cargo / miningRate;
  const roundTripHours =
    2 * calcTravelHours(bestAsteroid.dist, mole.speed) * travelFactor(station) + miningHours;
  return Math.round(cargo / roundTripHours);
}

function salvageNetRate(
  state: GoalBotState,
  station: StationSnapshot,
  debris: GoalBotState['visibleDebris'][number]
): number {
  const collector = getSpacecraft(COLLECTOR_KEY);
  if (!collector) return Number.NEGATIVE_INFINITY;
  const cargo = effectiveCargo(station, collector.cargo);
  const tripValue = usefulSalvageValue(station, debris.resources, cargo);
  if (tripValue <= 0) return Number.NEGATIVE_INFINITY;
  const distance = Math.hypot(debris.x - station.x, debris.y - station.y);
  const roundTripHours = Math.max(
    1 / 3_600,
    2 * calcTravelHours(distance, collector.speed) * travelFactor(station)
  );
  return tripValue / roundTripHours - bestMiningRate(state, station);
}

export function pickBestSalvageStation(
  state: GoalBotState,
  debrisId: string
): StationSnapshot | null {
  const debris = state.visibleDebris.find((candidate) => candidate.id === debrisId);
  if (!debris) return null;
  return (
    [...state.ownStations]
      .map((station) => ({
        station,
        netRate: salvageNetRate(state, station, debris),
        distance: Math.hypot(debris.x - station.x, debris.y - station.y),
      }))
      .filter((candidate) => candidate.netRate > 0)
      .sort(
        (a, b) =>
          b.netRate - a.netRate ||
          a.distance - b.distance ||
          a.station.id.localeCompare(b.station.id)
      )[0]?.station ?? null
  );
}

/** Generate salvage candidates for visible debris fields. */
export function generateSalvageCandidates(
  state: GoalBotState,
  _profile: BotProfile
): GoalCandidate[] {
  const candidates: GoalCandidate[] = [];

  for (const debris of state.visibleDebris) {
    if (debrisValue(debris.resources) <= 0) continue;
    const hasActiveMission = state.ownStations.some((station) =>
      station.salvageMissions.some(
        (mission) => mission.debrisFieldId === debris.id && mission.status !== 'resolved'
      )
    );
    if (hasActiveMission) continue;
    const station = pickBestSalvageStation(state, debris.id);
    if (!station) continue;

    const collector = station.fleets.find((f) => f.spacecraftKey === COLLECTOR_KEY);
    const availableCollectors = collector ? collector.amount - collector.lockedAmount : 0;
    const needsBuild = availableCollectors <= 0;
    const hasCapacity = needsBuild ? canAfford(station, COLLECTOR_COST) : true;

    const baseNeed = needsBuild ? 40 : 60;
    candidates.push({
      goalType: 'salvage',
      category: GOAL_CATEGORY['salvage'],
      targetRef: `debris:${debris.id}`,
      baseNeed,
      opportunity: Math.round(
        usefulSalvageValue(
          station,
          debris.resources,
          effectiveCargo(station, getSpacecraft(COLLECTOR_KEY)?.cargo ?? 0)
        ) / 10
      ),
      longTermValue: 20,
      commitment: 0,
      cost: needsBuild ? 30 : 10,
      risk: 15,
      blockers: hasCapacity ? 0 : 40,
    });
  }

  return candidates;
}

/** Execute a salvage operation on a visible debris field. */
export async function stepSalvage(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  const parts = targetRef.split(':');
  const debrisId = parts[1]!;

  const activeMission = station.salvageMissions.find(
    (mission) => mission.debrisFieldId === debrisId && mission.status !== 'resolved'
  );
  if (activeMission) {
    return {
      type: 'waiting',
      detail: 'salvage_underway',
      reason: `Salvage at ${debrisId} is ${activeMission.status}`,
    };
  }

  // Check if debris is still visible
  const debris = _state.visibleDebris.find((d) => d.id === debrisId);
  if (!debris) {
    return {
      type: 'complete',
      goalType: 'salvage',
      targetRef,
      reason: `Debris field ${debrisId} has been cleared`,
    };
  }

  const collector = station.fleets.find((f) => f.spacecraftKey === COLLECTOR_KEY);
  const availableCollectors = collector ? collector.amount - collector.lockedAmount : 0;

  if (availableCollectors <= 0) {
    // Check payback threshold: weighted value per trip ≥ 125% of build cost
    const weightedValue = usefulSalvageValue(
      station,
      debris.resources,
      effectiveCargo(station, getSpacecraft(COLLECTOR_KEY)?.cargo ?? 0)
    );
    const buildCostWeighted = COLLECTOR_COST.reduce(
      (sum, c) => sum + c.amount * (RESOURCE_WEIGHT[c.resourceKey] ?? 1.0),
      0
    );

    if (weightedValue < buildCostWeighted * PAYBACK_THRESHOLD) {
      return {
        type: 'blocked',
        detail: 'salvage_not_worthwhile',
        reason: `Debris weighted value ${weightedValue} below ${PAYBACK_THRESHOLD}x build cost ${buildCostWeighted}`,
      };
    }

    // Need to build a Collector first
    const canBuild = canAfford(station, COLLECTOR_COST);
    if (!canBuild) {
      return {
        type: hasActiveMining(station) ? 'saving' : 'blocked',
        detail: 'collector_cost',
        reason: hasActiveMining(station)
          ? `Saving resources for Collector build`
          : `Collector build is blocked without active income`,
      };
    }

    // Check shipyard level
    const syLevel = getShipyardLevel(station);
    if (syLevel < 2) {
      if (isUpgrading(station, 'shipyard')) {
        return {
          type: 'waiting',
          detail: 'shipyard_upgrading',
          reason: `Waiting for Shipyard level 2 needed by Collector`,
        };
      }
      if (canAfford(station, buildingUpgradeCost(station, 'shipyard'))) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
          reason: `Upgrading Shipyard to unlock Collector`,
        };
      }
      return {
        type: 'saving',
        detail: 'low_shipyard',
        reason: `Saving for Shipyard level 2 needed by Collector`,
      };
    }

    const collectorCrew = getSpacecraft(COLLECTOR_KEY)?.crew ?? 0;
    if (freeCrewCapacity(station) < collectorCrew) {
      if (isUpgrading(station, 'hangar')) {
        return {
          type: 'waiting',
          detail: 'hangar_upgrading',
          reason: `Waiting for Hangar capacity for Collector`,
        };
      }
      if (canAfford(station, buildingUpgradeCost(station, 'hangar'))) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'hangar' },
          reason: `Expanding Hangar for Collector`,
        };
      }
      return {
        type: 'saving',
        detail: 'hangar_capacity',
        reason: `Saving for Hangar capacity for Collector`,
      };
    }

    return {
      type: 'success',
      intent: {
        type: 'build_spacecraft',
        stationId: station.id,
        spacecraftKey: COLLECTOR_KEY,
        amount: 1,
      },
      reason: `Building Collector for salvage at debris ${debrisId}`,
    };
  }

  // Already have a collector — start salvage
  const minerCount = 1;
  return {
    type: 'success',
    intent: {
      type: 'start_salvage',
      stationId: station.id,
      debrisFieldId: debrisId,
      spacecraftKey: COLLECTOR_KEY,
      amount: minerCount,
    },
    reason: `Starting salvage at debris ${debrisId} with ${minerCount}x ${COLLECTOR_KEY}`,
  };
}
