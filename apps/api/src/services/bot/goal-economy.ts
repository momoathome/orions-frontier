import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import {
  getSpacecraft,
  COLONIZATION_COST,
  calculateDefenseUpgradeCost,
  calculateDefenseUpgradeEffect,
  getDefenseUpgrade,
  calculateHangarCapacity,
  SHIPYARD_UNLOCKS,
} from '@orions-frontier/game-config';
import { getResearchDefinition, researchDefinitions } from '@orions-frontier/game-config';
import type { DefenseUpgradeKey } from '@orions-frontier/shared';
import { calculateMiningCycle } from '../../lib/mining-cycle.js';
import { calcDistance } from '../../lib/travel.js';
import type { GoalBotState, StationSnapshot } from './goal-state.js';
import type { GoalCandidate } from './goal-driven-v1.js';
import type { GoalResult } from './goal-lifecycle.service.js';
import { GOAL_CATEGORY } from './goal-driven-v1.js';
import { getFrontierTargets, getKnownSectors } from '../world-mission.service.js';

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
// Research goal — candidate generation and step execution
// ---------------------------------------------------------------------------

const RESEARCH_LAB_CAPACITY_PER_LEVEL = 5;

function researchBenefit(
  station: StationSnapshot,
  techKey: string
): { score: number; reason: string } {
  switch (techKey) {
    case 'automated_shipyard': {
      const hasBuilds = station.builds.length > 0;
      return {
        score: hasBuilds ? 60 : 20,
        reason: hasBuilds ? 'active ship builds benefit' : 'no current ship builds',
      };
    }
    case 'extraction_algorithms': {
      const minerCount = station.fleets.find((f) => f.spacecraftKey === 'mole')?.amount ?? 0;
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
      const activeTrips = station.missions.filter((m) => m.status === 'traveling').length;
      return {
        score: activeTrips > 0 ? 40 + activeTrips * 5 : 15,
        reason: activeTrips > 0 ? `${activeTrips} active trips` : 'no active trips',
      };
    }
    case 'combat_analytics': {
      const fighters = station.fleets.find((f) => f.spacecraftKey === 'javelin')?.amount ?? 0;
      return {
        score: fighters > 0 ? 40 + fighters * 3 : 10,
        reason: fighters > 0 ? `${fighters} fighters` : 'no fighters',
      };
    }
    case 'station_grid_optimization': {
      const upgrading = station.buildings.filter((b) => b.upgradeEndsAt !== null).length;
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
    return {
      type: 'blocked',
      detail: 'no_laboratory',
      reason: `Laboratory required for ${def.name}`,
    };
  }

  // Check lab capacity
  const usedPoints = station.research
    .filter((r) => r.status === 'researching')
    .reduce((sum, r) => sum + (getResearchDefinition(r.technologyKey)?.points ?? 0), 0);
  const capacity = labLevel * RESEARCH_LAB_CAPACITY_PER_LEVEL;
  if (usedPoints + def.points > capacity) {
    return {
      type: 'blocked',
      detail: 'lab_capacity',
      reason: `Lab capacity exceeded for ${def.name}`,
    };
  }

  // Check resources
  if (!canAfford(station, def.costs)) {
    return {
      type: 'saving',
      detail: `research_${techKey}`,
      reason: `Saving resources for ${def.name}`,
    };
  }

  // Start research
  return {
    type: 'success',
    actionLabel: `start_research:${station.id}:${techKey}`,
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
// Exploration & Colonization
// ---------------------------------------------------------------------------

export async function generateExploreSectorCandidate(
  state: GoalBotState,
  station: StationSnapshot
): Promise<GoalCandidate | null> {
  // Check if station already has an active expedition
  const hasActiveExpedition = station.missions.some(
    (m) => m.missionType === 'expedition' && m.status === 'traveling'
  );
  if (hasActiveExpedition) return null;

  // Get frontier targets for this station
  let frontiers: { sectorX: number; sectorY: number; distance: number }[];
  try {
    const targets = await getFrontierTargets(state.userId, station.id);
    frontiers = targets.map((t) => ({
      sectorX: t.sectorX,
      sectorY: t.sectorY,
      distance: t.distance,
    }));
  } catch {
    return null;
  }
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
  station: StationSnapshot
): Promise<GoalCandidate | null> {
  // Check if station already has an active colonization
  const hasActiveColony = station.missions.some(
    (m) => m.missionType === 'colonization' && m.status === 'traveling'
  );
  if (hasActiveColony) return null;

  // Get known sectors and check which are frontier without own station
  let known: {
    sectorX: number;
    sectorY: number;
    distance: number;
    role: string;
    hasOwnStation: boolean;
  }[];
  try {
    const sectors = await getKnownSectors(state.userId, station.id);
    known = sectors
      .filter((s) => s.role === 'frontier' && !s.hasOwnStation)
      .map((s) => ({
        sectorX: s.sectorX,
        sectorY: s.sectorY,
        distance: s.distance,
        role: s.role,
        hasOwnStation: s.hasOwnStation,
      }));
  } catch {
    return null;
  }
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
  const baseNeed = Math.round(
    (canAffordColony ? 60 : 40) * Math.max(0.1, 1 - nearest.distance / maxDist)
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
  const existing = station.missions.find(
    (m) => m.missionType === 'expedition' && m.status === 'traveling'
  );
  if (existing) {
    return {
      type: 'waiting',
      detail: 'expedition_traveling',
      reason: `Expedition to sector ${sectorX}:${sectorY} underway`,
    };
  }

  return {
    type: 'success',
    actionLabel: `start_expedition:${station.id}:${sectorX}:${sectorY}`,
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

  // Check if already colonizing to this specific sector
  const existing = station.missions.find(
    (m) =>
      m.missionType === 'colonization' &&
      m.status === 'traveling' &&
      m.targetSectorX === sectorX &&
      m.targetSectorY === sectorY
  );
  if (existing) {
    return {
      type: 'waiting',
      detail: 'colony_traveling',
      reason: `Colony ship to sector ${sectorX}:${sectorY} underway`,
    };
  }

  // Check if colonization already completed (colony exists)
  const completed = station.missions.find(
    (m) =>
      m.missionType === 'colonization' &&
      m.status !== 'traveling' &&
      m.targetSectorX === sectorX &&
      m.targetSectorY === sectorY
  );
  if (completed) {
    return {
      type: 'complete',
      goalType: 'establish_colony',
      targetRef,
      reason: `Colony at ${sectorX}:${sectorY} founded`,
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
    actionLabel: `start_colonization:${station.id}:${sectorX}:${sectorY}`,
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
  const fleetPower = station.fleets
    .filter((f) => {
      const sc = getSpacecraft(f.spacecraftKey);
      return sc?.role === 'fighter';
    })
    .reduce((sum, f) => sum + f.amount * (getSpacecraft(f.spacecraftKey)?.attack ?? 0), 0);
  const buildPower = station.builds
    .filter((b) => {
      const sc = getSpacecraft(b.spacecraftKey);
      return sc?.role === 'fighter';
    })
    .reduce((sum, b) => sum + b.amount * (getSpacecraft(b.spacecraftKey)?.attack ?? 0), 0);
  return fleetPower + buildPower;
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
    actionLabel: `start_defense_upgrade:${station.id}:${best.upgradeKey}`,
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
      return {
        type: 'success',
        actionLabel: `start_building_upgrade:${station.id}:shipyard`,
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
      return {
        type: 'success',
        actionLabel: `start_building_upgrade:${station.id}:hangar`,
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
  let best: { key: string; attack: number; count: number; aff: boolean } | null = null;

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
      best = { key: f.key, attack: sc.attack, count: 1, aff: true };
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
    actionLabel: `build_spacecrafts:${station.id}:${best.key}:1`,
    reason: `Building 1 ${best.key} (attack ${best.attack}, crew ${getSpacecraft(best.key)?.crew})`,
  };
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
