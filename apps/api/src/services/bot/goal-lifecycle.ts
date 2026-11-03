import { isOneOf } from '@orions-frontier/shared';
import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import type { GoalBotState, GoalResult, StationSnapshot } from './goal-state.js';
import { selectGoal } from './goal-driven-v1.js';
import type { CategoryWeights, GoalCandidate } from './goal-driven-v1.js';
import { goalTypes } from './repositories/bot-controllers.js';
import {
  generateRaidCandidates,
  generateRetaliateCandidates,
  stepRaid,
  stepRetaliate,
  raidSource,
  retaliationSource,
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
  expansionOrigin,
} from './goals/expansion.js';
import {
  generateFortifyCandidate,
  generateBuildStrikeForceCandidate,
  stepFortifyStation,
  stepBuildStrikeForce,
} from './goals/military.js';
import { stepResearchTechnology } from './goals/research.js';
import { generateSalvageCandidates, stepSalvage, salvageSource } from './goals/salvage.js';
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
  profile: BotProfile,
  activeGoal: { goalType: string; targetRef: string } | null = null
): Promise<GoalResult | null> {
  const activeExpansionStationId =
    activeGoal &&
    (activeGoal.goalType === 'explore_sector' || activeGoal.goalType === 'establish_colony')
      ? findStationForGoal(state, activeGoal.targetRef, activeGoal.goalType, profile)?.id
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

/** The station a goal acts from; each goal family picks its own. */
function findStationForGoal(
  state: GoalBotState,
  targetRef: string,
  goalType: string,
  profile: BotProfile
): StationSnapshot | undefined {
  const [kind, id = ''] = targetRef.split(':');
  switch (kind) {
    case 'station': {
      const ownStation = state.ownStations.find((station) => station.id === id);
      if (ownStation || goalType !== 'raid') return ownStation;
      return raidSource(state, id, profile);
    }
    case 'tech':
      return state.ownStations.find((station) => station.id === id);
    case 'sector':
      return expansionOrigin(state, targetRef, goalType);
    case 'user':
      return retaliationSource(state, id, profile);
    case 'debris':
      return salvageSource(state, id);
    default:
      return undefined;
  }
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
        strike: generateBuildStrikeForceCandidate(state, station, usedProfile),
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

export async function determineNextStep(
  state: GoalBotState,
  profile: BotProfile,
  goalType: string,
  targetRef: string
): Promise<GoalResult> {
  if (!isOneOf(goalTypes, goalType)) {
    return { type: 'blocked', reason: `No step implementation for ${goalType}` };
  }
  const station = findStationForGoal(state, targetRef, goalType, profile);
  if (!station) return { type: 'blocked', reason: `Station for ${targetRef} not found` };

  switch (goalType) {
    case 'stabilize_station':
      return stepStabilizeStation(state, station, profile);
    case 'increase_income':
      return stepIncreaseIncome(state, station, profile);
    case 'increase_capacity':
      return stepIncreaseCapacity(state, station, targetRef, profile);
    case 'research_technology':
      return stepResearchTechnology(state, station, targetRef, profile);
    case 'explore_sector':
      return stepExploreSector(state, station, targetRef, profile);
    case 'establish_colony':
      return stepEstablishColony(state, station, targetRef, profile);
    case 'fortify_station':
      return stepFortifyStation(state, station, targetRef, profile);
    case 'build_strike_force':
      return stepBuildStrikeForce(state, station, targetRef, profile);
    case 'raid':
      return stepRaid(state, station, targetRef, profile);
    case 'retaliate':
      return stepRetaliate(state, station, targetRef, profile);
    case 'salvage':
      return stepSalvage(state, station, targetRef, profile);
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
