import { isOneOf, required, entriesOf } from '@orions-frontier/shared';
import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import { calculateColonizationCost, getSpacecraft } from '@orions-frontier/game-config';
import type { GoalBotState, GoalResult, StationSnapshot } from './goal-state.js';
import { selectGoal } from './goal-driven-v1.js';
import type { CategoryWeights, GoalCandidate } from './goal-driven-v1.js';
import { goalTypes } from '../../repositories/bot-controllers.js';
import {
  generateRaidCandidates,
  generateRetaliateCandidates,
  stepRaid,
  stepRetaliate,
  isEligibleAttackSource,
} from './goals/conflict.js';
import {
  generateEconomicCandidates,
  stepStabilizeStation,
  stepIncreaseIncome,
  stepIncreaseCapacity,
} from './goals/economy.js';
import {
  generateExploreSectorCandidate,
  generateEstablishColonyCandidate,
  stepExploreSector,
  stepEstablishColony,
} from './goals/expansion.js';
import {
  generateFortifyCandidate,
  generateBuildStrikeForceCandidate,
  stepFortifyStation,
  stepBuildStrikeForce,
} from './goals/military.js';
import { stepResearchTechnology } from './goals/research.js';
import { generateSalvageCandidates, stepSalvage, pickBestSalvageStation } from './goals/salvage.js';
import {
  prioritizeStationsForStabilization,
  pickAvailableMinerKey,
  selectBestAsteroid,
} from './goals/shared.js';

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
  _reservedCosts: Record<string, number>,
  activeGoal: { goalType: string; targetRef: string } | null = null
): Promise<GoalResult | null> {
  const activeExpansionStationId =
    activeGoal &&
    (activeGoal.goalType === 'explore_sector' || activeGoal.goalType === 'establish_colony')
      ? findStationForGoal(state, activeGoal.targetRef, activeGoal.goalType, _profile)?.id
      : null;

  for (const station of prioritizeStationsForStabilization(state)) {
    const minerKey = pickAvailableMinerKey(station);
    if (!minerKey) continue;

    const activeMiners = station.miningAssignments.reduce(
      (sum, assignment) => sum + assignment.assignedAmount,
      0
    );
    const totalMiners = station.fleets.reduce((sum, fleet) => {
      const definition = getSpacecraft(fleet.spacecraftKey);
      return definition?.role === 'miner' ? sum + fleet.amount : sum;
    }, 0);
    const freeMiners = station.fleets.reduce((sum, fleet) => {
      const definition = getSpacecraft(fleet.spacecraftKey);
      return definition?.role === 'miner'
        ? sum + Math.max(0, fleet.amount - fleet.lockedAmount)
        : sum;
    }, 0);
    const hasActiveExpansion = station.id === activeExpansionStationId;
    const reservesLastMobileSupport =
      freeMiners <= 1 && (hasActiveExpansion || (activeMiners > 0 && totalMiners >= 3));
    if (reservesLastMobileSupport) continue;

    const asteroid = selectBestAsteroid(state, station, minerKey);
    if (!asteroid) continue;

    return {
      type: 'success',
      intent: {
        type: 'assign_miner',
        stationId: station.id,
        asteroidId: asteroid.id,
        spacecraftKey: minerKey,
        amount: 1,
      },
      reason: `Urgent: assigning free ${minerKey} miner at ${station.name} to asteroid ${asteroid.id}`,
    };
  }
  return null;
}

function availableFighterAttack(station: StationSnapshot): number {
  return station.fleets.reduce((sum, fleet) => {
    const definition = getSpacecraft(fleet.spacecraftKey);
    return definition?.role === 'fighter'
      ? sum + (fleet.amount - fleet.lockedAmount) * definition.attack
      : sum;
  }, 0);
}

function findStationForGoal(
  state: GoalBotState,
  targetRef: string,
  goalType: string,
  profile: BotProfile
): StationSnapshot | undefined {
  if (targetRef.startsWith('station:')) {
    const stationId = targetRef.split(':')[1];
    const ownStation = state.ownStations.find((station) => station.id === stationId);
    if (ownStation) return ownStation;
    if (goalType === 'raid') {
      const target = state.visibleStations.find((station) => station.id === stationId);
      if (!target) return undefined;
      const eligible = [...state.ownStations]
        .filter((station) =>
          isEligibleAttackSource(state, station, required(stationId, 'stationId'), profile)
        )
        .sort((a, b) => {
          const distanceA = Math.hypot(a.x - target.x, a.y - target.y);
          const distanceB = Math.hypot(b.x - target.x, b.y - target.y);
          return distanceA - distanceB || a.id.localeCompare(b.id);
        })[0];
      return (
        eligible ??
        state.ownStations.find((station) =>
          station.combatMissions.some(
            (mission) =>
              mission.defenderStationId === stationId &&
              !['resolved', 'cancelled'].includes(mission.status)
          )
        )
      );
    }
    return undefined;
  }
  if (targetRef.startsWith('tech:')) {
    const stationId = targetRef.split(':')[1];
    return state.ownStations.find((s) => s.id === stationId);
  }
  if (targetRef.startsWith('sector:')) {
    const [, x, y] = targetRef.split(':');
    const sectorX = Number(x);
    const sectorY = Number(y);
    if (!Number.isFinite(sectorX) || !Number.isFinite(sectorY)) return undefined;
    const activeMissionOrigin = state.ownStations.find((station) =>
      station.missions.some(
        (mission) =>
          (mission.status === 'traveling' || mission.status === 'returning') &&
          mission.targetSectorX === sectorX &&
          mission.targetSectorY === sectorY &&
          ((goalType === 'explore_sector' && mission.missionType === 'expedition') ||
            (goalType === 'establish_colony' && mission.missionType === 'colonization'))
      )
    );
    if (activeMissionOrigin) return activeMissionOrigin;
    const colony = state.ownStations.find(
      (station) => station.sectorX === sectorX && station.sectorY === sectorY
    );
    if (goalType === 'establish_colony' && colony) return colony;
    const availableStations = [...state.ownStations].filter((station) => {
      if (goalType === 'establish_colony') {
        return station.fleets.some((fleet) => {
          const definition = getSpacecraft(fleet.spacecraftKey);
          return definition?.role === 'miner' && fleet.amount - fleet.lockedAmount > 0;
        });
      }
      return station.fleets.some((fleet) => {
        const definition = getSpacecraft(fleet.spacecraftKey);
        return definition?.role !== 'fighter' && fleet.amount - fleet.lockedAmount > 0;
      });
    });
    const affordableStations =
      goalType === 'establish_colony'
        ? availableStations.filter((station) =>
            entriesOf(calculateColonizationCost(state.ownStations.length)).every(
              ([resourceKey, amount]) => (station.resources[resourceKey] ?? 0) >= amount
            )
          )
        : availableStations;
    const candidateStations =
      affordableStations.length > 0
        ? affordableStations
        : availableStations.length > 0
          ? availableStations
          : goalType === 'establish_colony' || goalType === 'explore_sector'
            ? [...state.ownStations]
            : [];
    return candidateStations.sort((a, b) => {
      const distanceA = Math.hypot(a.sectorX - sectorX, a.sectorY - sectorY);
      const distanceB = Math.hypot(b.sectorX - sectorX, b.sectorY - sectorY);
      return distanceA - distanceB || a.id.localeCompare(b.id);
    })[0];
  }
  if (targetRef.startsWith('user:')) {
    const ownerId = targetRef.split(':')[1];
    const targets = state.visibleStations.filter(
      (station) => station.ownerId === ownerId && !station.isOwn
    );
    if (targets.length === 0) return undefined;
    return [...state.ownStations]
      .filter((station) => {
        return targets.some((target) => isEligibleAttackSource(state, station, target.id, profile));
      })
      .sort((a, b) => {
        const distanceA = Math.min(
          ...targets
            .filter((target) => isEligibleAttackSource(state, a, target.id, profile))
            .map((target) => Math.hypot(a.x - target.x, a.y - target.y))
        );
        const distanceB = Math.min(
          ...targets
            .filter((target) => isEligibleAttackSource(state, b, target.id, profile))
            .map((target) => Math.hypot(b.x - target.x, b.y - target.y))
        );
        return (
          distanceA - distanceB ||
          availableFighterAttack(b) - availableFighterAttack(a) ||
          a.id.localeCompare(b.id)
        );
      })[0];
  }
  if (targetRef.startsWith('debris:')) {
    const debrisId = targetRef.split(':')[1];
    if (!debrisId) return undefined;
    return (
      pickBestSalvageStation(state, debrisId) ??
      state.ownStations.find((station) =>
        station.salvageMissions.some(
          (mission) => mission.debrisFieldId === debrisId && mission.status !== 'resolved'
        )
      ) ??
      state.ownStations[0]
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

export async function generateGoalCandidates(
  state: GoalBotState,
  profile?: BotProfile
): Promise<GoalCandidate[]> {
  const usedProfile: BotProfile = profile ?? 'industrialist';
  const economic = generateEconomicCandidates(state, usedProfile);
  const expansion: GoalCandidate[] = [];
  const conflict: GoalCandidate[] = [];

  // Each station is independent; avoid serial database round trips for expansion previews.
  const perStationCandidates = await Promise.all(
    state.ownStations.map(async (station) => {
      const [explore, colony] = await Promise.all([
        generateExploreSectorCandidate(state, station, usedProfile),
        generateEstablishColonyCandidate(state, station, usedProfile),
      ]);
      return {
        explore,
        colony,
        fortify: generateFortifyCandidate(state, station),
        strike: generateBuildStrikeForceCandidate(state, station),
      };
    })
  );
  for (const candidates of perStationCandidates) {
    if (candidates.explore) expansion.push(candidates.explore);
    if (candidates.colony) expansion.push(candidates.colony);
    if (candidates.fortify) conflict.push(candidates.fortify);
    if (candidates.strike) conflict.push(candidates.strike);
  }

  // Raid & retaliate candidates (conflict)
  const raidCandidates = generateRaidCandidates(state, usedProfile);
  conflict.push(...raidCandidates);
  const retaliateCandidates = generateRetaliateCandidates(state, usedProfile);
  conflict.push(...retaliateCandidates);

  // Salvage candidates
  const salvageCandidates = generateSalvageCandidates(state, usedProfile);
  economic.push(...salvageCandidates);

  return [...economic, ...expansion, ...conflict];
}

// ---------------------------------------------------------------------------
// Step dispatch
// ---------------------------------------------------------------------------

const missingStation = (targetRef: string): GoalResult => ({
  type: 'blocked',
  detail: 'station_missing',
  reason: `Station for ${targetRef} not found`,
});

export async function determineNextStep(
  state: GoalBotState,
  profile: BotProfile,
  goalType: string,
  targetRef: string
): Promise<GoalResult> {
  const station = findStationForGoal(state, targetRef, goalType, profile);

  switch (goalType) {
    case 'stabilize_station':
      if (!station) return missingStation(targetRef);
      return stepStabilizeStation(state, station, profile);
    case 'increase_income':
      if (!station) return missingStation(targetRef);
      return stepIncreaseIncome(state, station, profile);
    case 'increase_capacity':
      if (!station) return missingStation(targetRef);
      return stepIncreaseCapacity(state, station, targetRef, profile);
    case 'research_technology':
      if (!station) return missingStation(targetRef);
      return stepResearchTechnology(state, station, targetRef, profile);
    case 'explore_sector':
      if (!station) return missingStation(targetRef);
      return stepExploreSector(state, station, targetRef, profile);
    case 'establish_colony':
      if (!station) return missingStation(targetRef);
      return stepEstablishColony(state, station, targetRef, profile);
    case 'fortify_station':
      if (!station) return missingStation(targetRef);
      return stepFortifyStation(state, station, targetRef, profile);
    case 'build_strike_force':
      if (!station) return missingStation(targetRef);
      return stepBuildStrikeForce(state, station, targetRef, profile);
    case 'raid':
      if (!station) return missingStation(targetRef);
      return stepRaid(state, station, targetRef, profile);
    case 'retaliate':
      if (!station) return missingStation(targetRef);
      return stepRetaliate(state, station, targetRef, profile);
    case 'salvage':
      if (!station) return missingStation(targetRef);
      return stepSalvage(state, station, targetRef, profile);
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
  activeGoal: { goalType: string; targetRef: string } | null,
  weights?: CategoryWeights,
  activeCommitment = 25
): Promise<{
  selected: GoalCandidate | null;
  reason: string;
  activeCandidateFound: boolean;
}> {
  const candidates = await generateGoalCandidates(state, profile);
  const typedActive =
    activeGoal && isOneOf(goalTypes, activeGoal.goalType)
      ? { goalType: activeGoal.goalType, targetRef: activeGoal.targetRef }
      : null;
  if (typedActive) {
    const activeCandidate = candidates.find(
      (candidate) =>
        candidate.goalType === typedActive.goalType && candidate.targetRef === typedActive.targetRef
    );
    if (activeCandidate) {
      activeCandidate.commitment = Math.max(activeCandidate.commitment, activeCommitment);
    }
  }
  const result = selectGoal(candidates, profile, typedActive, weights);
  const activeCandidateFound =
    typedActive !== null &&
    candidates.some(
      (candidate) =>
        candidate.goalType === typedActive.goalType && candidate.targetRef === typedActive.targetRef
    );
  return {
    selected: result.selected,
    reason: result.reason,
    activeCandidateFound,
  };
}
