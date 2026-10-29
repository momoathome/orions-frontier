import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import {
  getSpacecraft,
  getResearchDefinition,
  researchDefinitions,
} from '@orions-frontier/game-config';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';
import type { GoalCandidate } from '../goal-driven-v1.js';
import { GOAL_CATEGORY } from '../goal-driven-v1.js';
import {
  assignMinerTowardCosts,
  buildingUpgradeCost,
  canAcquireCosts,
  canAfford,
  getLaboratoryLevel,
  getWarehouseLevel,
  hasActiveMining,
  isUpgrading,
} from './shared.js';

// ---------------------------------------------------------------------------
// Research goal — candidate generation and step execution
// ---------------------------------------------------------------------------

export const RESEARCH_LAB_CAPACITY_PER_LEVEL = 5;

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

export function generateResearchCandidates(
  state: GoalBotState,
  station: StationSnapshot
): GoalCandidate[] {
  const candidates: GoalCandidate[] = [];
  const started = new Set(station.research.map((r) => r.technologyKey));
  const hasIncome = hasActiveMining(station);
  const laboratoryLevel = getLaboratoryLevel(station);
  const usedResearchPoints = station.research.reduce(
    (sum, research) => sum + (getResearchDefinition(research.technologyKey)?.points ?? 0),
    0
  );
  const laboratoryUpgradeCosts = buildingUpgradeCost(station, 'laboratory');
  const laboratoryUpgradeReachable =
    isUpgrading(station, 'laboratory') ||
    canAfford(station, laboratoryUpgradeCosts) ||
    (hasIncome && canAcquireCosts(state, station, laboratoryUpgradeCosts));

  for (const def of researchDefinitions) {
    if (started.has(def.key)) continue;

    const researchAffordable = canAfford(station, def.costs);
    if (!researchAffordable && (!hasIncome || !canAcquireCosts(state, station, def.costs)))
      continue;

    const hasLaboratoryCapacity =
      laboratoryLevel >= 1 &&
      usedResearchPoints + def.points <= laboratoryLevel * RESEARCH_LAB_CAPACITY_PER_LEVEL;
    if (!hasLaboratoryCapacity && !laboratoryUpgradeReachable) continue;

    const benefit = researchBenefit(station, def.key);
    const affordRatio = researchAffordable
      ? 1.0
      : def.costs.every(
            (cost) =>
              (station.resources[cost.resourceKey] ?? 0) > 0 ||
              state.visibleAsteroids.some(
                (asteroid) => (asteroid.remainingByResource[cost.resourceKey] ?? 0) > 0
              )
          )
        ? 0.5
        : 0.0;

    const baseNeed = Math.round(benefit.score * affordRatio);
    if (baseNeed <= 0) continue;

    const totalCost = def.costs.reduce((s, c) => s + c.amount, 0);
    candidates.push({
      goalType: 'research_technology',
      category: GOAL_CATEGORY.research_technology,
      targetRef: `tech:${station.id}:${def.key}`,
      baseNeed,
      opportunity: affordRatio >= 1 ? 30 : 10,
      longTermValue: benefit.score,
      commitment: 0,
      cost: Math.round(totalCost / 10),
      risk: 5,
      blockers: affordRatio === 0 ? 80 : hasLaboratoryCapacity ? 0 : 50,
    });
  }

  return candidates;
}

export async function stepResearchTechnology(
  state: GoalBotState,
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
    const costs = buildingUpgradeCost(station, 'laboratory');
    const reachable = hasActiveMining(station) && canAcquireCosts(state, station, costs);
    const supply = assignMinerTowardCosts(state, station, costs, `Laboratory for ${def.name}`);
    if (supply) return supply;
    return {
      type: reachable ? 'saving' : 'blocked',
      detail: 'no_laboratory',
      reason: reachable
        ? `Saving for Laboratory required by ${def.name}`
        : `Laboratory resources for ${def.name} are not reachable`,
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
    const costs = buildingUpgradeCost(station, 'laboratory');
    const reachable = hasActiveMining(station) && canAcquireCosts(state, station, costs);
    const supply = assignMinerTowardCosts(
      state,
      station,
      costs,
      `Laboratory capacity for ${def.name}`
    );
    if (supply) return supply;
    return {
      type: reachable ? 'saving' : 'blocked',
      detail: 'lab_capacity',
      reason: reachable
        ? `Saving for Laboratory capacity for ${def.name}`
        : `Laboratory capacity resources for ${def.name} are not reachable`,
    };
  }

  // Check resources
  if (!canAfford(station, def.costs)) {
    const reachable = hasActiveMining(station) && canAcquireCosts(state, station, def.costs);
    const supply = assignMinerTowardCosts(state, station, def.costs, def.name);
    if (supply) return supply;
    return {
      type: reachable ? 'saving' : 'blocked',
      detail: `research_${techKey}`,
      reason: reachable
        ? `Saving resources for ${def.name}`
        : `Resources for ${def.name} are not reachable`,
    };
  }

  // Start research
  return {
    type: 'success',
    intent: { type: 'start_research', stationId: station.id, technologyKey: techKey },
    reason: `Starting research ${def.name} (${researchBenefit(station, def.key).reason})`,
  };
}
