import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import {
  getSpacecraft,
  requireSpacecraft,
  requirementBlockers,
  calculateDefenseUpgradeCost,
} from '@orions-frontier/game-config';
import { buildingKeys, isOneOf, type BuildingKey } from '@orions-frontier/shared';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';
import type { GoalCandidate } from '../goal-driven-v1.js';
import { GOAL_CATEGORY } from '../goal-driven-v1.js';
import { bestDefenseUpgrade, unlockedFighters } from './military.js';
import { generateResearchCandidates } from './research.js';
import {
  assignMinerTowardCosts,
  buildingCanUpgrade,
  buildingUpgradeCost,
  canAcquireCosts,
  canAfford,
  freeCrewCapacity,
  getHangarLevel,
  getShipyardLevel,
  hasActiveMining,
  hasInBuild,
  hasMinerInBuild,
  hasStorageHeadroom,
  hasVisibleAsteroids,
  initialStationId,
  isUpgrading,
  minerCount,
  moleCost,
  nextIncomeCosts,
  pickAvailableMinerKey,
  prioritizeStationsForStabilization,
  seeksMoreForeignContact,
  selectBestAsteroid,
  stationBuildingLevels,
  storageFillRatio,
  titanCost,
  waitForCosts,
} from './shared.js';

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
  const hasMiner = pickAvailableMinerKey(station) !== null;
  const minerInBuild = hasMinerInBuild(station);
  const isColony = station.id !== initialStationId(state);

  let baseNeed = isColony ? 100 : 80;
  if (hasMiner) baseNeed -= 20;
  if (minerInBuild) baseNeed -= 10;

  return {
    goalType: 'stabilize_station',
    category: GOAL_CATEGORY.stabilize_station,
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: hasVisibleAsteroids(state) ? 30 : 0,
    longTermValue: 50,
    commitment: isColony ? 30 : 0,
    cost: hasMiner ? 10 : 30,
    risk: hasMiner ? 10 : 20,
    blockers: hasVisibleAsteroids(state) ? 0 : 40,
  };
}

export function generateIncreaseIncomeCandidate(
  state: GoalBotState,
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
  const nextCosts = nextIncomeCosts(station);
  if (!canAfford(station, nextCosts) && !canAcquireCosts(state, station, nextCosts)) return null;

  // Calculate progress toward milestones
  const progress = Math.min(1, (totalMoles / 3) * 0.6 + (hasTitan ? 0.4 : 0));
  const baseNeed = Math.round(60 * (1 - progress));

  return {
    goalType: 'increase_income',
    category: GOAL_CATEGORY.increase_income,
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: hasVisibleAsteroids(state) ? 20 : 0,
    longTermValue: 60,
    commitment: 0,
    cost: hasTitan ? 10 : canAfford(station, moleCost()) ? 20 : 40,
    risk: 10,
    blockers: 0,
  };
}

export function generateIncreaseCapacityCandidate(
  state: GoalBotState,
  station: StationSnapshot,
  profile: BotProfile = 'industrialist'
): GoalCandidate | null {
  // Find the bottleneck: which building is worth upgrading?
  const hangar = getHangarLevel(station);

  const candidates: { key: BuildingKey; need: number }[] = [];

  const storagePressure = storageFillRatio(station);
  const storageTight = hasActiveMining(station) && storagePressure >= 0.85;
  const crewBlocked = freeCrewCapacity(station) <= 0;
  // Capacity goals only exist for an observed bottleneck.
  if (storageTight && buildingCanUpgrade(station, 'warehouse')) {
    candidates.push({
      key: 'warehouse',
      need: Math.min(100, Math.round(50 + storagePressure * 50)),
    });
  }
  if (crewBlocked && buildingCanUpgrade(station, 'hangar')) {
    candidates.push({ key: 'hangar', need: Math.max(45, 70 - hangar * 5) });
  }

  const contactSearch = seeksMoreForeignContact(state, profile);
  const nextDevelopmentCosts = nextIncomeCosts(station);
  const hasUnreachableCapacityCost = candidates.some((candidate) => {
    const costs = buildingUpgradeCost(station, candidate.key);
    return !canAfford(station, costs) && !canAcquireCosts(state, station, costs);
  });
  const defense = bestDefenseUpgrade(station);
  const defenseCosts = defense
    ? calculateDefenseUpgradeCost(defense.upgradeKey, defense.targetLevel)
    : [];
  const lacksVisibleDefenseResource =
    defenseCosts.length > 0 &&
    !canAfford(station, defenseCosts) &&
    !canAcquireCosts(state, station, defenseCosts);
  const unlockedFighterDefinitions = unlockedFighters(station).flatMap((fighter) => {
    const definition = getSpacecraft(fighter.key);
    return definition ? [definition] : [];
  });
  const lacksVisibleFighterResource =
    unlockedFighterDefinitions.length > 0 &&
    !unlockedFighterDefinitions.some(
      (fighter) =>
        canAfford(station, fighter.costs) || canAcquireCosts(state, station, fighter.costs)
    );
  const lacksVisibleDevelopmentResource =
    nextDevelopmentCosts.length > 0 &&
    !canAfford(station, nextDevelopmentCosts) &&
    !canAcquireCosts(state, station, nextDevelopmentCosts);
  if (
    (hasUnreachableCapacityCost ||
      lacksVisibleDevelopmentResource ||
      lacksVisibleDefenseResource ||
      lacksVisibleFighterResource ||
      contactSearch) &&
    buildingCanUpgrade(station, 'scanner')
  ) {
    candidates.push({
      key: 'scanner',
      need: contactSearch ? 85 : 70,
    });
  }

  if (candidates.length === 0) return null;

  const actionable = candidates.filter(
    (candidate) =>
      !isUpgrading(station, candidate.key) &&
      (canAfford(station, buildingUpgradeCost(station, candidate.key)) ||
        canAcquireCosts(state, station, buildingUpgradeCost(station, candidate.key)))
  );
  // Pick the highest-need reachable bottleneck.
  const best = actionable.sort((a, b) => b.need - a.need || a.key.localeCompare(b.key))[0];
  if (!best) return null;

  return {
    goalType: 'increase_capacity',
    category: GOAL_CATEGORY.increase_capacity,
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
export function generateEconomicCandidates(
  state: GoalBotState,
  profile: BotProfile = 'industrialist'
): GoalCandidate[] {
  const candidates: GoalCandidate[] = [];

  const sorted = prioritizeStationsForStabilization(state);

  for (const station of sorted) {
    const s = generateStabilizeCandidate(state, station);
    if (s) candidates.push(s);

    const inc = generateIncreaseIncomeCandidate(state, station);
    if (inc) candidates.push(inc);

    const cap = generateIncreaseCapacityCandidate(state, station, profile);
    if (cap) candidates.push(cap);

    // Research candidates per station
    const researchCands = generateResearchCandidates(state, station, profile);
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
    const costs = buildingUpgradeCost(station, 'warehouse');
    if (canAfford(station, costs)) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'warehouse' },
        reason: `Expanding Warehouse at ${station.name} for mining deliveries`,
      };
    }
    return waitForCosts(
      _state,
      station,
      costs,
      'warehouse',
      `Saving for Warehouse capacity at ${station.name}`,
      `Warehouse resources are not reachable at ${station.name}`
    );
  }

  // 1. Free miner → assign
  const availableMinerKey = pickAvailableMinerKey(station);
  if (availableMinerKey) {
    const asteroid = selectBestAsteroid(_state, station, availableMinerKey);
    if (asteroid) {
      return {
        type: 'success',
        intent: {
          type: 'assign_miner',
          stationId: station.id,
          asteroidId: asteroid.id,
          spacecraftKey: availableMinerKey,
          amount: 1,
        },
        reason: `Assigning free ${availableMinerKey} miner at ${station.name} to asteroid ${asteroid.id}`,
      };
    }
    if (isUpgrading(station, 'scanner')) {
      return {
        type: 'waiting',
        detail: 'scanner_upgrading',
        reason: `Waiting for Scanner range at ${station.name}`,
      };
    }
    const costs = buildingUpgradeCost(station, 'scanner');
    if (canAfford(station, costs)) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'scanner' },
        reason: `Expanding Scanner at ${station.name} to find a mineable asteroid`,
      };
    }
    return waitForCosts(
      _state,
      station,
      costs,
      'scanner',
      `Saving for Scanner range at ${station.name}`,
      `Scanner resources are not reachable at ${station.name}`
    );
  }

  // 2. No mole → build one
  if (minerCount(station) === 0) {
    if (hasMinerInBuild(station)) {
      return {
        type: 'waiting',
        detail: 'miner_building',
        reason: `Waiting for first miner at ${station.name}`,
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
    return waitForCosts(
      _state,
      station,
      moleCost(),
      'mole',
      `Saving resources for first Mole at ${station.name}`,
      `First Mole resources are not reachable at ${station.name}`
    );
  }

  if (
    !hasActiveMining(station) &&
    station.fleets.some(
      (fleet) => getSpacecraft(fleet.spacecraftKey)?.role === 'miner' && fleet.lockedAmount > 0
    ) &&
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
    const costs = buildingUpgradeCost(station, 'warehouse');
    if (canAfford(station, costs)) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'warehouse' },
        reason: `Expanding Warehouse at ${station.name} for delivery capacity`,
      };
    }
    return waitForCosts(
      _state,
      station,
      costs,
      'warehouse',
      `Saving for Warehouse upgrade at ${station.name}`,
      `Warehouse upgrade resources are not reachable at ${station.name}`
    );
  }

  return { type: 'blocked', detail: 'unknown', reason: `Cannot stabilize ${station.name}` };
}

/**
 * Execute the next step for increase_income.
 */
function prepareCrewCapacity(
  state: GoalBotState,
  station: StationSnapshot,
  requiredCrew: number,
  purpose: string
): GoalResult | null {
  if (freeCrewCapacity(station) >= requiredCrew) return null;
  if (isUpgrading(station, 'hangar')) {
    return {
      type: 'waiting',
      detail: 'hangar_upgrading',
      reason: `Waiting for Hangar capacity for ${purpose} at ${station.name}`,
    };
  }
  if (!buildingCanUpgrade(station, 'hangar')) {
    return {
      type: 'blocked',
      detail: 'hangar_maximum',
      reason: `Hangar at ${station.name} cannot provide capacity for ${purpose}`,
    };
  }
  const costs = buildingUpgradeCost(station, 'hangar');
  if (canAfford(station, costs)) {
    return {
      type: 'success',
      intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'hangar' },
      reason: `Expanding Hangar at ${station.name} for ${purpose}`,
    };
  }
  const supply = assignMinerTowardCosts(state, station, costs, `Hangar capacity for ${purpose}`);
  if (supply) return supply;
  return waitForCosts(
    state,
    station,
    costs,
    'hangar',
    `Saving for Hangar capacity for ${purpose} at ${station.name}`,
    `Hangar resources for ${purpose} are not reachable at ${station.name}`
  );
}

export async function stepIncreaseIncome(
  state: GoalBotState,
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
      const costs = buildingUpgradeCost(station, 'shipyard');
      if (canAfford(station, costs)) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
          reason: `Upgrading Shipyard at ${station.name} for Mole`,
        };
      }
      const supply = assignMinerTowardCosts(state, station, costs, 'the first Mole Shipyard');
      if (supply) return supply;
      return waitForCosts(
        state,
        station,
        costs,
        'no_shipyard',
        `Saving for Shipyard required at ${station.name}`,
        `Shipyard resources are not reachable at ${station.name}`
      );
    }
    const moleCrewPreparation = prepareCrewCapacity(
      state,
      station,
      getSpacecraft('mole')?.crew ?? 0,
      'another Mole'
    );
    if (moleCrewPreparation) return moleCrewPreparation;
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
    const moleSupply = assignMinerTowardCosts(state, station, moleCost(), 'another Mole');
    if (moleSupply) return moleSupply;
    return waitForCosts(
      state,
      station,
      moleCost(),
      'mole',
      `Saving for Mole at ${station.name}`,
      `Mole resources are not reachable at ${station.name}`
    );
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
      const costs = buildingUpgradeCost(station, 'shipyard');
      if (canAfford(station, costs)) {
        return {
          type: 'success',
          intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
          reason: `Upgrading Shipyard to level ${getShipyardLevel(station) + 1} at ${station.name} for Titan`,
        };
      }
      const supply = assignMinerTowardCosts(state, station, costs, 'the Titan Shipyard');
      if (supply) return supply;
      return waitForCosts(
        state,
        station,
        costs,
        'shipyard',
        `Saving for Shipyard upgrade at ${station.name}`,
        `Shipyard resources for Titan are not reachable at ${station.name}`
      );
    }
    if (
      requirementBlockers(
        requireSpacecraft('titan').requirements,
        station.research,
        stationBuildingLevels(station)
      ).length > 0
    ) {
      return { type: 'blocked', detail: 'research_locked', reason: 'Titan needs research' };
    }
    const titanCrewPreparation = prepareCrewCapacity(
      state,
      station,
      getSpacecraft('titan')?.crew ?? 0,
      'a Titan'
    );
    if (titanCrewPreparation) return titanCrewPreparation;
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
    const titanSupply = assignMinerTowardCosts(state, station, titanCost(), 'a Titan');
    if (titanSupply) return titanSupply;
    return waitForCosts(
      state,
      station,
      titanCost(),
      'titan',
      `Saving for Titan at ${station.name}`,
      `Titan resources are not reachable at ${station.name}`
    );
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
  profile: BotProfile
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
  if (!isOneOf(buildingKeys, buildingKey)) {
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

  const currentBottleneck = generateIncreaseCapacityCandidate(_state, station, profile);
  if (currentBottleneck?.targetRef !== targetRef) {
    return {
      type: 'complete',
      goalType: 'increase_capacity',
      targetRef,
      reason: `${buildingKey} is no longer the highest reachable capacity bottleneck at ${station.name}`,
    };
  }

  const validBuildingKey = buildingKey;
  const costs = buildingUpgradeCost(station, validBuildingKey);
  if (canAfford(station, costs)) {
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

  const supply = assignMinerTowardCosts(_state, station, costs, `${buildingKey} capacity`);
  if (supply) return supply;
  return waitForCosts(
    _state,
    station,
    costs,
    buildingKey,
    `Saving for ${buildingKey} upgrade at ${station.name}`,
    `${buildingKey} upgrade resources are not reachable at ${station.name}`
  );
}
