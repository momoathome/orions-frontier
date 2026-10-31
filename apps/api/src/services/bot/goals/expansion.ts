import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import {
  calculateColonizationCost,
  getSpacecraft,
  researchModifiers,
} from '@orions-frontier/game-config';
import { entriesOf } from '@orions-frontier/shared';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';
import type { GoalCandidate } from '../goal-driven-v1.js';
import { GOAL_CATEGORY } from '../goal-driven-v1.js';
import { getFrontierTargets, getKnownSectors, hasColonyPosition } from '../../missions/index.js';
import { PROFILE_PARAMS } from '../profiles.js';
import { stepStabilizeStation } from './economy.js';
import {
  buildingUpgradeCost,
  canAcquireCosts,
  canAfford,
  freeCrewCapacity,
  hasMinerInBuild,
  moleCost,
  nextIncomeCosts,
  pickAvailableMinerKey,
  seeksMoreForeignContact,
  stepTowardSpacecraft,
  waitForCosts,
} from './shared.js';

// ---------------------------------------------------------------------------
// Exploration & Colonization
// ---------------------------------------------------------------------------

function hasAvailableMissionShip(station: StationSnapshot): boolean {
  return station.fleets.some((fleet) => {
    const spacecraft = getSpacecraft(fleet.spacecraftKey);
    return spacecraft?.role !== 'fighter' && fleet.amount - fleet.lockedAmount > 0;
  });
}

function canPrepareMobileSupportShip(
  state: GoalBotState,
  station: StationSnapshot,
  requiresMiner = false
): boolean {
  if (
    (requiresMiner ? pickAvailableMinerKey(station) !== null : hasAvailableMissionShip(station)) ||
    hasMinerInBuild(station)
  ) {
    return true;
  }
  const moleCrew = getSpacecraft('mole')?.crew ?? 0;
  if (freeCrewCapacity(station) < moleCrew) {
    const costs = buildingUpgradeCost(station, 'hangar');
    return canAfford(station, costs) || canAcquireCosts(state, station, costs);
  }
  return canAfford(station, moleCost()) || canAcquireCosts(state, station, moleCost());
}

function prepareMobileSupportShip(
  state: GoalBotState,
  station: StationSnapshot,
  purpose: 'expedition' | 'colonization'
): GoalResult | null {
  const hasSuitableShip =
    purpose === 'colonization'
      ? pickAvailableMinerKey(station) !== null
      : hasAvailableMissionShip(station);
  if (hasSuitableShip) return null;
  if (hasMinerInBuild(station)) {
    return {
      type: 'waiting',
      reason: `Waiting for a mobile support ship for ${purpose} at ${station.name}`,
    };
  }
  return stepTowardSpacecraft(state, station, 'mole', `a ${purpose} support ship`);
}

/** Same price the server charges: colonies still in flight count as stations. */
export function colonizationCost(state: GoalBotState) {
  const inFlight = state.ownStations
    .flatMap((station) => station.missions)
    .filter((mission) => mission.missionType === 'colonization').length;
  return entriesOf(calculateColonizationCost(state.ownStations.length + inFlight)).map(
    ([resourceKey, amount]) => ({ resourceKey, amount })
  );
}

export const canAffordColony = (state: GoalBotState, station: StationSnapshot): boolean =>
  canAfford(station, colonizationCost(state));

/**
 * Origin station for a sector goal: the station already flying there, the colony itself, else
 * the nearest station that has a suitable ship (and for a colony, its price).
 */
export function expansionOrigin(
  state: GoalBotState,
  targetRef: string,
  goalType: string
): StationSnapshot | undefined {
  const [, x, y] = targetRef.split(':');
  const sectorX = Number(x);
  const sectorY = Number(y);
  if (!Number.isFinite(sectorX) || !Number.isFinite(sectorY)) return undefined;
  const colonizing = goalType === 'establish_colony';
  const activeMissionOrigin = state.ownStations.find((station) =>
    station.missions.some(
      (mission) =>
        mission.targetSectorX === sectorX &&
        mission.targetSectorY === sectorY &&
        mission.missionType === (colonizing ? 'colonization' : 'expedition')
    )
  );
  if (activeMissionOrigin) return activeMissionOrigin;
  const colony = state.ownStations.find(
    (station) => station.sectorX === sectorX && station.sectorY === sectorY
  );
  if (colonizing && colony) return colony;
  const availableStations = state.ownStations.filter((station) =>
    colonizing ? pickAvailableMinerKey(station) !== null : hasAvailableMissionShip(station)
  );
  const affordableStations = colonizing
    ? availableStations.filter((station) => canAffordColony(state, station))
    : availableStations;
  // Without a free ship anywhere, act where the generator found one can be prepared.
  const preparingStations = state.ownStations.filter((station) =>
    canPrepareMobileSupportShip(state, station, colonizing)
  );
  const candidateStations =
    affordableStations.length > 0
      ? affordableStations
      : availableStations.length > 0
        ? availableStations
        : preparingStations.length > 0
          ? preparingStations
          : [...state.ownStations];
  return candidateStations.sort((a, b) => {
    const distanceA = Math.hypot(a.sectorX - sectorX, a.sectorY - sectorY);
    const distanceB = Math.hypot(b.sectorX - sectorX, b.sectorY - sectorY);
    return distanceA - distanceB || a.id.localeCompare(b.id);
  })[0];
}

export async function generateExploreSectorCandidate(
  state: GoalBotState,
  station: StationSnapshot,
  profile: BotProfile = 'industrialist'
): Promise<GoalCandidate | null> {
  // Check if station already has an active expedition
  const hasActiveExpedition = station.missions.some(
    (mission) =>
      mission.missionType === 'expedition' &&
      (mission.status === 'traveling' || mission.status === 'returning')
  );
  if (hasActiveExpedition) return null;
  // Without Long-Range Survey or a free expedition slot the research goal carries the need.
  const modifiers = researchModifiers(state.research.levels);
  const expeditions = state.ownStations
    .flatMap((own) => own.missions)
    .filter(
      (mission) =>
        mission.missionType === 'expedition' &&
        (mission.status === 'traveling' || mission.status === 'returning')
    ).length;
  if (!modifiers.canExplore || expeditions >= modifiers.expeditionLimit) return null;

  // Snapshot checks first: the frontier lookup costs database round trips per station.
  const hasShip = hasAvailableMissionShip(station);
  if (!hasShip && !canPrepareMobileSupportShip(state, station)) return null;

  const nearest = (await getFrontierTargets(state.userId, station.id)).targets[0];
  if (!nearest) return null;

  // Base need depends on distance — closer is better
  const maxDist = 100_000;
  const contactSearch = seeksMoreForeignContact(state, profile);
  const developmentCosts = nextIncomeCosts(station);
  const resourceSearch =
    developmentCosts.length > 0 &&
    !canAfford(station, developmentCosts) &&
    !canAcquireCosts(state, station, developmentCosts);
  const baseNeed = Math.min(
    100,
    Math.round(50 * Math.max(0.1, 1 - nearest.distance / maxDist)) +
      (contactSearch ? 35 : 0) +
      (resourceSearch ? 25 : 0)
  );

  return {
    goalType: 'explore_sector',
    category: GOAL_CATEGORY.explore_sector,
    targetRef: `sector:${nearest.sectorX}:${nearest.sectorY}`,
    baseNeed,
    opportunity: 20 + (contactSearch ? 35 : 0) + (resourceSearch ? 25 : 0),
    longTermValue: 60 + (contactSearch ? 20 : 0) + (resourceSearch ? 10 : 0),
    commitment: 0,
    cost: hasShip ? 15 : 30,
    risk: 10,
    blockers: hasShip ? 0 : 15,
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
  const colonizations = state.ownStations
    .flatMap((own) => own.missions)
    .filter((m) => m.missionType === 'colonization' && m.status === 'traveling').length;
  if (
    state.ownStations.length + colonizations >=
    researchModifiers(state.research.levels).stationLimit
  ) {
    return null;
  }

  // Check if we can afford colonization
  const affordable = canAffordColony(state, station);
  if (!affordable && !canAcquireCosts(state, station, colonizationCost(state))) return null;
  // Check if station has a miner ship to send
  const hasMiner = station.fleets.some((f) => {
    const sc = getSpacecraft(f.spacecraftKey);
    return sc?.role === 'miner' && f.amount - f.lockedAmount > 0;
  });
  if (!hasMiner && !canPrepareMobileSupportShip(state, station, true)) return null;

  // Snapshot checks first: the sector lookup costs database round trips per station.
  let nearest = null;
  for (const sector of await getKnownSectors(state.userId, station.id)) {
    if (sector.role !== 'frontier' || sector.hasOwnStation) continue;
    // A full sector stays full for this user (seeded positions), so retrying it never helps.
    if (await hasColonyPosition(state.userId, sector.sectorX, sector.sectorY)) {
      nearest = sector;
      break;
    }
  }
  if (!nearest) return null;

  const maxDist = 100_000;
  const contactSearch = seeksMoreForeignContact(state, profile);
  const baseNeed = Math.min(
    100,
    Math.round(
      (affordable ? 60 : 40) *
        Math.max(0.1, 1 - nearest.distance / maxDist) *
        PROFILE_PARAMS[profile].colonizationFactor
    ) + (contactSearch ? 30 : 0)
  );

  return {
    goalType: 'establish_colony',
    category: GOAL_CATEGORY.establish_colony,
    targetRef: `sector:${nearest.sectorX}:${nearest.sectorY}`,
    baseNeed,
    opportunity: (hasMiner ? 20 : 5) + (contactSearch ? 25 : 0),
    longTermValue: 70 + (contactSearch ? 15 : 0),
    commitment: 0,
    cost: affordable ? 20 : 40,
    risk: 15,
    blockers: affordable ? (hasMiner ? 0 : 15) : 40,
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

  const supportPreparation = prepareMobileSupportShip(_state, station, 'expedition');
  if (supportPreparation) return supportPreparation;

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
      reason: `Colony ship to sector ${sectorX}:${sectorY} underway`,
    };
  }

  const supportPreparation = prepareMobileSupportShip(_state, station, 'colonization');
  if (supportPreparation) return supportPreparation;

  // Check resources
  if (!canAffordColony(_state, station)) {
    return waitForCosts(
      _state,
      station,
      colonizationCost(_state),
      `Saving resources for colony at sector ${sectorX}:${sectorY}`,
      `Colony resources for sector ${sectorX}:${sectorY} are not reachable`
    );
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
