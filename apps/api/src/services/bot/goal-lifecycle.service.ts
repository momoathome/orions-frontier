import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import type { GoalBotState, StationSnapshot } from './goal-state.js';
import { selectGoal } from './goal-driven-v1.js';
import type { GoalCandidate, GoalType } from './goal-driven-v1.js';
import { goalTypes } from '../../lib/db/schema/bot-controllers.js';
import {
  generateEconomicCandidates,
  stepStabilizeStation,
  stepIncreaseIncome,
  stepIncreaseCapacity,
  stepResearchTechnology,
  generateExploreSectorCandidate,
  generateEstablishColonyCandidate,
  stepExploreSector,
  stepEstablishColony,
  generateFortifyCandidate,
  generateBuildStrikeForceCandidate,
  stepFortifyStation,
  stepBuildStrikeForce,
} from './goal-economy.js';

// Local helpers (mirrored from goal-economy to avoid circular deps)
const hasAvailableShips = (station: StationSnapshot, key: string): boolean => {
  const fleet = station.fleets.find((f) => f.spacecraftKey === key);
  return fleet !== undefined && fleet.amount - fleet.lockedAmount >= 1;
};
const hasActiveMining = (station: StationSnapshot): boolean =>
  station.missions.some((m) => m.missionType === 'mining' && m.status !== 'completed');

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GoalResult =
  | { type: 'success'; actionLabel: string; reason: string }
  | { type: 'waiting'; detail: string; reason: string }
  | { type: 'saving'; detail: string; reason: string }
  | { type: 'blocked'; detail: string; reason: string }
  | { type: 'complete'; goalType: string; targetRef: string; reason: string };

export interface LifecycleOutput {
  result: GoalResult;
  hasProgressThisTick: boolean;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Check for urgent maintenance: reassign an idle miner to a visible asteroid.
 * This is performed before the goal step and does not replace the active goal.
 */
export async function checkUrgentMaintenance(
  state: GoalBotState,
  _profile: BotProfile,
  _reservedCosts: Record<string, number>
): Promise<GoalResult | null> {
  for (const station of state.ownStations) {
    if (!hasAvailableShips(station, 'mole')) continue;

    const spacecraft = getSpacecraft('mole');
    if (!spacecraft) continue;

    const asteroid = pickAsteroidForStation(state, station, 'mole');
    if (!asteroid) continue;

    return {
      type: 'success',
      actionLabel: `assign_miner:${station.id}:${asteroid.id}:mole:1`,
      reason: `Urgent: assigning free Mole at ${station.name} to asteroid ${asteroid.id}`,
    };
  }
  return null;
}

function pickAsteroidForStation(
  state: GoalBotState,
  station: StationSnapshot,
  spacecraftKey: string
): { id: string } | null {
  const spacecraft = getSpacecraft(spacecraftKey);
  if (!spacecraft) return null;

  const best = state.visibleAsteroids
    .filter((a) => a.remainingAmount > 0)
    .map((a) => ({ asteroid: a, dist: Math.hypot(a.x - station.x, a.y - station.y) }))
    .sort((a, b) => a.dist - b.dist || a.asteroid.id.localeCompare(b.asteroid.id))[0];

  return best ? { id: best.asteroid.id } : null;
}

// ---------------------------------------------------------------------------
// Goal completion checks
// ---------------------------------------------------------------------------

const MAX_BLOCKED_INTERVALS = 5;

function isGoalComplete(
  _state: GoalBotState,
  goalType: string,
  targetRef: string,
  station: StationSnapshot | undefined
): boolean {
  if (!station) return false;

  switch (goalType) {
    case 'stabilize_station':
      return hasActiveMining(station);
    case 'increase_income': {
      const moles = station.fleets.find((f) => f.spacecraftKey === 'mole')?.amount ?? 0;
      const hasTitan =
        hasAvailableShips(station, 'titan') ||
        station.builds.some((b) => b.spacecraftKey === 'titan');
      return moles >= 3 && hasTitan;
    }
    case 'increase_capacity': {
      // After one successful upgrade, re-evaluate — so mark complete immediately
      return true;
    }
    case 'explore_sector': {
      // Completed when no active traveling expedition from this station
      return !station.missions.some(
        (m) => m.missionType === 'expedition' && m.status === 'traveling'
      );
    }
    case 'establish_colony': {
      // Completed when colonization mission is no longer traveling (arrived)
      const parts = targetRef.split(':');
      const targetSectorX = Number(parts[1]);
      const targetSectorY = Number(parts[2]);
      if (isNaN(targetSectorX) || isNaN(targetSectorY)) return false;
      const colonyMission = station.missions.find(
        (m) =>
          m.missionType === 'colonization' &&
          m.targetSectorX === targetSectorX &&
          m.targetSectorY === targetSectorY
      );
      if (!colonyMission) return false;
      return colonyMission.status !== 'traveling';
    }
    case 'fortify_station':
    case 'build_strike_force':
      // Completed when target score/attack is reached; step functions handle it
      return false;
    default:
      return false;
  }
}

function findStationForGoal(state: GoalBotState, targetRef: string): StationSnapshot | undefined {
  if (targetRef.startsWith('station:')) {
    const stationId = targetRef.split(':')[1];
    return state.ownStations.find((s) => s.id === stationId);
  }
  if (targetRef.startsWith('tech:')) {
    const stationId = targetRef.split(':')[1];
    return state.ownStations.find((s) => s.id === stationId);
  }
  if (targetRef.startsWith('sector:')) {
    // For sector goals, use the first station (or the one with most available ships)
    // In practice the bot picks the best station during generation
    return state.ownStations[0];
  }
  return undefined;
}

export async function evaluateActiveGoal(
  state: GoalBotState,
  activeGoalType: string,
  activeGoalTarget: string,
  _goalStartedAt: Date | null,
  _lastProgressAt: Date | null,
  blockedCount: number,
  hasProgressThisTick: boolean
): Promise<GoalResult | null> {
  const station = findStationForGoal(state, activeGoalTarget);

  // Check completion
  if (station && isGoalComplete(state, activeGoalType, activeGoalTarget, station)) {
    return {
      type: 'complete',
      goalType: activeGoalType,
      targetRef: activeGoalTarget,
      reason: `Goal ${activeGoalType} target=${activeGoalTarget} completed`,
    };
  }

  if (hasProgressThisTick) return null;

  const newBlockedCount = blockedCount + 1;
  if (newBlockedCount >= MAX_BLOCKED_INTERVALS) {
    return {
      type: 'complete',
      goalType: activeGoalType,
      targetRef: activeGoalTarget,
      reason: `Goal ${activeGoalType} target=${activeGoalTarget} released after ${MAX_BLOCKED_INTERVALS} blocked ticks without progress`,
    };
  }

  return {
    type: 'blocked',
    detail: `No progress for ${newBlockedCount}/${MAX_BLOCKED_INTERVALS} intervals`,
    reason: `Goal ${activeGoalType} target=${activeGoalTarget} blocked (${newBlockedCount}/${MAX_BLOCKED_INTERVALS})`,
  };
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

export async function generateGoalCandidates(state: GoalBotState): Promise<GoalCandidate[]> {
  const economic = generateEconomicCandidates(state);
  const expansion: GoalCandidate[] = [];
  const conflict: GoalCandidate[] = [];

  // Generate explore/colony candidates for each station
  for (const station of state.ownStations) {
    const explore = await generateExploreSectorCandidate(state, station);
    if (explore) expansion.push(explore);

    const colony = await generateEstablishColonyCandidate(state, station);
    if (colony) expansion.push(colony);

    const fortify = generateFortifyCandidate(state, station);
    if (fortify) conflict.push(fortify);

    const strike = generateBuildStrikeForceCandidate(state, station);
    if (strike) conflict.push(strike);
  }

  return [...economic, ...expansion, ...conflict];
}

// ---------------------------------------------------------------------------
// Step dispatch
// ---------------------------------------------------------------------------

export async function determineNextStep(
  state: GoalBotState,
  profile: BotProfile,
  goalType: string,
  targetRef: string
): Promise<GoalResult> {
  const station = findStationForGoal(state, targetRef);

  switch (goalType) {
    case 'stabilize_station':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepStabilizeStation(state, station, profile);
    case 'increase_income':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepIncreaseIncome(state, station, profile);
    case 'increase_capacity':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepIncreaseCapacity(state, station, targetRef, profile);
    case 'research_technology':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepResearchTechnology(station, targetRef, profile);
    case 'explore_sector':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepExploreSector(state, station, targetRef, profile);
    case 'establish_colony':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepEstablishColony(state, station, targetRef, profile);
    case 'fortify_station':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepFortifyStation(state, station, targetRef, profile);
    case 'build_strike_force':
      if (!station)
        return {
          type: 'blocked',
          detail: 'station_missing',
          reason: `Station for ${targetRef} not found`,
        };
      return stepBuildStrikeForce(state, station, targetRef, profile);
    default:
      return {
        type: 'blocked',
        detail: `No step implementation for goal type: ${goalType}`,
        reason: `No step implementation for ${goalType}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Goal selection wrapper
// ---------------------------------------------------------------------------

export async function selectGoalForState(
  state: GoalBotState,
  profile: BotProfile,
  activeGoal: { goalType: string; targetRef: string } | null
): Promise<{
  selected: GoalCandidate | null;
  reason: string;
}> {
  const candidates = await generateGoalCandidates(state);
  const goalTypeList = goalTypes as readonly string[];
  const typedActive =
    activeGoal && goalTypeList.includes(activeGoal.goalType)
      ? (activeGoal as { goalType: GoalType; targetRef: string })
      : null;
  const result = selectGoal(candidates, profile, typedActive);
  return {
    selected: result.selected,
    reason: result.reason,
  };
}
