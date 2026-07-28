import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import { calculateMiningCycle } from '../../lib/mining-cycle.js';
import { calcDistance } from '../../lib/travel.js';
import type { GoalBotState, StationSnapshot } from './goal-state.js';
import type { GoalCandidate } from './goal-driven-v1.js';
import type { GoalResult } from './goal-lifecycle.service.js';
import { GOAL_CATEGORY } from './goal-driven-v1.js';

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
  station.missions.some((m) => m.missionType === 'mining' && m.status !== 'completed');

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

// ---------------------------------------------------------------------------
// Goal generators — create GoalCandidate for each economic goal
// ---------------------------------------------------------------------------

export function generateStabilizeCandidate(
  state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  // Check completion: has active mining + warehouse not permanently full
  if (hasActiveMining(station)) {
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
  const hasTitan = hasAvailableShips(station, 'titan') || hasInBuild(station, 'titan');

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

  // Warehouse: needed if station has deliveries but storage is low
  if (hasActiveMining(station) && warehouse < 3) {
    candidates.push({ key: 'warehouse', currentLevel: warehouse, need: 60 - warehouse * 10 });
  }
  // Hangar: needed if ships are blocked by crew capacity
  if (hangar < 3) {
    candidates.push({ key: 'hangar', currentLevel: hangar, need: 40 - hangar * 10 });
  }
  // Laboratory: needed if research is being considered
  if (lab < 2) {
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
  // 1. Free miner → assign
  if (hasAvailableShips(station, 'mole')) {
    const asteroid = selectBestAsteroid(_state, station, 'mole');
    if (asteroid) {
      return {
        type: 'success',
        actionLabel: `assign_miner:${station.id}:${asteroid.id}:mole:1`,
        reason: `Assigning free Mole at ${station.name} to asteroid ${asteroid.id}`,
      };
    }
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
        actionLabel: `build_spacecraft:${station.id}:mole:1`,
        reason: `Building first Mole at ${station.name} to enable mining`,
      };
    }
    // Check prerequisites
    if (getShipyardLevel(station) < 1) {
      if (canAfford(station, [])) {
        return {
          type: 'success',
          actionLabel: `upgrade_building:${station.id}:shipyard`,
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

  // 3. Check warehouse/scanner bottleneck
  if (getWarehouseLevel(station) < 2 && !isUpgrading(station, 'warehouse')) {
    if (canAfford(station, [])) {
      return {
        type: 'success',
        actionLabel: `upgrade_building:${station.id}:warehouse`,
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
  const hasTtn = hasAvailableShips(station, 'titan') || hasInBuild(station, 'titan');

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
      if (canAfford(station, [])) {
        return {
          type: 'success',
          actionLabel: `upgrade_building:${station.id}:shipyard`,
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
      if (canAfford(station, [])) {
        return {
          type: 'success',
          actionLabel: `upgrade_building:${station.id}:hangar`,
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
        actionLabel: `build_spacecraft:${station.id}:mole:1`,
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
      if (canAfford(station, [])) {
        return {
          type: 'success',
          actionLabel: `upgrade_building:${station.id}:shipyard`,
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
        actionLabel: `build_spacecraft:${station.id}:titan:1`,
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

  if (isUpgrading(station, buildingKey)) {
    return {
      type: 'waiting',
      detail: `${buildingKey}_upgrading`,
      reason: `Waiting for ${buildingKey} upgrade at ${station.name}`,
    };
  }

  if (canAfford(station, [])) {
    return {
      type: 'success',
      actionLabel: `upgrade_building:${station.id}:${buildingKey}`,
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
      const delivery = calculateMiningCycle({
        distance,
        speed: spacecraft.speed,
        miningRate: spacecraft.miningRate,
        cargoCapacity: spacecraft.cargo,
        minerCount: 1,
        remainingAmount: a.remainingAmount,
      }).totalDeliveryPerHour;
      return { asteroid: a, score: delivery };
    })
    .sort((a, b) => b.score - a.score || a.asteroid.id.localeCompare(b.asteroid.id));

  return candidates[0]?.asteroid ?? null;
}

// ---------------------------------------------------------------------------
// Multi-station selection
// ---------------------------------------------------------------------------

/**
 * Pick the best station among several for a given economic goal type.
 * Unstable colonies first, then higher local need, then station ID.
 */
export function pickBestStation(state: GoalBotState, goalType: string): StationSnapshot | null {
  const candidates = state.ownStations
    .map((s) => ({ station: s, unstable: !hasActiveMining(s) }))
    .filter(({ station }) => {
      // Filter stations that still need this goal
      if (goalType === 'stabilize_station') return !hasActiveMining(station);
      if (goalType === 'increase_income') {
        const moles = station.fleets.find((f) => f.spacecraftKey === 'mole')?.amount ?? 0;
        const hasTitan = hasAvailableShips(station, 'titan') || hasInBuild(station, 'titan');
        return moles < 3 || !hasTitan;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.unstable !== b.unstable) return a.unstable ? -1 : 1;
      return a.station.id.localeCompare(b.station.id);
    });

  return candidates[0]?.station ?? null;
}
