import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import {
  entriesOf,
  resourceKeys,
  type ResourceKey,
  type ResourceMap,
} from '@orions-frontier/shared';
import { calcTravelHours } from '../../../lib/travel.js';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';
import type { GoalCandidate } from '../goal-driven-v1.js';
import { GOAL_CATEGORY } from '../goal-driven-v1.js';
import {
  buildingUpgradeCost,
  canAfford,
  effectiveCargo,
  freeCrewCapacity,
  getShipyardLevel,
  hasActiveMining,
  hasCompletedTechnology,
  isUpgrading,
  travelFactor,
} from './shared.js';

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------

const COLLECTOR_KEY = 'collector';
const COLLECTOR_COST = getSpacecraft(COLLECTOR_KEY)?.costs ?? [];
const PAYBACK_THRESHOLD = 1.25;

/** Resource preference weights for valuing salvage cargo. */
export const BOT_RESOURCE_PREFERENCE_WEIGHTS: Record<ResourceKey, number> = {
  carbon: 1.0,
  titanium: 1.2,
  hydrogenium: 1.5,
  kyber_crystal: 2.0,
  astatine: 3.0,
};

/** Estimate the total resource value of a debris field using preference weights. */
function debrisValue(resources: ResourceMap): number {
  return entriesOf(resources).reduce(
    (sum, [key, amount]) => sum + amount * BOT_RESOURCE_PREFERENCE_WEIGHTS[key],
    0
  );
}

function usefulSalvageCargo(
  station: StationSnapshot,
  resources: ResourceMap,
  cargoCapacity: number
): ResourceMap {
  let remainingCargo = cargoCapacity;
  const cargo: ResourceMap = {};
  for (const resourceKey of resourceKeys) {
    const storageRoom = Math.max(
      0,
      station.storageCapacity - (station.resources[resourceKey] ?? 0)
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
  resources: ResourceMap,
  cargoCapacity: number
): number {
  const cargo = usefulSalvageCargo(station, resources, cargoCapacity);
  return entriesOf(cargo).reduce((sum, [resourceKey, amount]) => {
    const fillRatio =
      station.storageCapacity > 0
        ? (station.resources[resourceKey] ?? 0) / station.storageCapacity
        : 1;
    const localNeedMultiplier = 1 + Math.max(0, 1 - fillRatio);
    return sum + amount * BOT_RESOURCE_PREFERENCE_WEIGHTS[resourceKey] * localNeedMultiplier;
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
      category: GOAL_CATEGORY.salvage,
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
  const [, debrisId = ''] = targetRef.split(':');

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
      (sum, c) => sum + c.amount * BOT_RESOURCE_PREFERENCE_WEIGHTS[c.resourceKey],
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
