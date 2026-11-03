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
  buildingCanUpgrade,
  buildingUpgradeCost,
  canAcquireCosts,
  scannerCouldFindCosts,
  canAfford,
  freeCrewCapacity,
  getHangarLevel,
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
  stepTowardBuildingLevel,
  stepTowardSpacecraft,
  storageFillRatio,
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
  // Only the Titan is left and research gates it: the research goal unlocks it first, so the
  // Shipyard is not upgraded for a Titan whose research is still far away.
  const titanBlockers = requirementBlockers(
    requireSpacecraft('titan').requirements,
    station.research,
    stationBuildingLevels(station)
  );
  if (totalMoles >= 3 && titanBlockers.some((blocker) => blocker.type === 'research')) return null;
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
    return (
      !canAfford(station, costs) &&
      !canAcquireCosts(state, station, costs) &&
      scannerCouldFindCosts(state, station, costs)
    );
  });
  const defense = bestDefenseUpgrade(station);
  const defenseCosts = defense
    ? calculateDefenseUpgradeCost(defense.upgradeKey, defense.targetLevel)
    : [];
  const lacksVisibleDefenseResource =
    defenseCosts.length > 0 &&
    !canAfford(station, defenseCosts) &&
    !canAcquireCosts(state, station, defenseCosts) &&
    scannerCouldFindCosts(state, station, defenseCosts);
  const unlockedFighterDefinitions = unlockedFighters(station).flatMap((fighter) => {
    const definition = getSpacecraft(fighter.key);
    return definition ? [definition] : [];
  });
  const lacksVisibleFighterResource =
    unlockedFighterDefinitions.length > 0 &&
    !unlockedFighterDefinitions.some(
      (fighter) =>
        canAfford(station, fighter.costs) || canAcquireCosts(state, station, fighter.costs)
    ) &&
    unlockedFighterDefinitions.some((fighter) =>
      scannerCouldFindCosts(state, station, fighter.costs)
    );
  const lacksVisibleDevelopmentResource =
    nextDevelopmentCosts.length > 0 &&
    !canAfford(station, nextDevelopmentCosts) &&
    !canAcquireCosts(state, station, nextDevelopmentCosts) &&
    scannerCouldFindCosts(state, station, nextDevelopmentCosts);
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

/** Execute the next step for stabilize_station. */
export async function stepStabilizeStation(
  state: GoalBotState,
  station: StationSnapshot,
  _profile: BotProfile
): Promise<GoalResult> {
  if (!hasStorageHeadroom(state, station)) {
    return stepTowardBuildingLevel(state, station, 'warehouse', 'mining deliveries');
  }
  if (hasActiveMining(station)) {
    return {
      type: 'complete',
      goalType: 'stabilize_station',
      targetRef: `station:${station.id}`,
      reason: `${station.name} has an active mining assignment`,
    };
  }

  const availableMinerKey = pickAvailableMinerKey(station);
  if (availableMinerKey) {
    const asteroid = selectBestAsteroid(state, station, availableMinerKey);
    if (!asteroid) return stepTowardBuildingLevel(state, station, 'scanner', 'a mineable asteroid');
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

  if (minerCount(station) === 0) {
    if (hasMinerInBuild(station)) {
      return { type: 'waiting', reason: `Waiting for first miner at ${station.name}` };
    }
    return stepTowardSpacecraft(state, station, 'mole', 'mining');
  }

  if (
    station.fleets.some(
      (fleet) => getSpacecraft(fleet.spacecraftKey)?.role === 'miner' && fleet.lockedAmount > 0
    ) &&
    (station.trips.some((trip) => trip.status === 'traveling') || station.missions.length > 0)
  ) {
    return { type: 'waiting', reason: `Waiting for a Mole to return to ${station.name}` };
  }

  return { type: 'blocked', reason: `Cannot stabilize ${station.name}` };
}

/** Execute the next step for increase_income: three Moles, then a Titan. */
export async function stepIncreaseIncome(
  state: GoalBotState,
  station: StationSnapshot,
  _profile: BotProfile
): Promise<GoalResult> {
  const moles =
    (station.fleets.find((fleet) => fleet.spacecraftKey === 'mole')?.amount ?? 0) +
    Number(hasInBuild(station, 'mole'));
  if (moles < 3) return stepTowardSpacecraft(state, station, 'mole', `income (${moles + 1}/3)`);

  const hasTitan =
    (station.fleets.find((fleet) => fleet.spacecraftKey === 'titan')?.amount ?? 0) > 0 ||
    hasInBuild(station, 'titan');
  if (!hasTitan) return stepTowardSpacecraft(state, station, 'titan', 'income');

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
      reason: `Unknown capacity building: ${buildingKey}`,
    };
  }

  if (isUpgrading(station, buildingKey)) {
    return {
      type: 'waiting',
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

  return stepTowardBuildingLevel(_state, station, buildingKey, 'capacity');
}
