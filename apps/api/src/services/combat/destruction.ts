import {
  calculateBuildingUpgradeCost,
  calculateDefenseUpgradeCost,
  getDefenseUpgrade,
  requireSpacecraft,
} from '@orions-frontier/game-config';
import {
  buildingKeys,
  defenseUpgradeKeys,
  entriesOf,
  isOneOf,
  type ResourceMap,
} from '@orions-frontier/shared';
import type { Tx } from '../../lib/db/index.js';
import { deleteStationAssignments } from '../../repositories/asteroids.js';
import { resolveCombatMissionByTrip } from '../../repositories/combat-missions.js';
import { resolveSalvageMissionByTrip } from '../../repositories/debris-fields.js';
import { deleteBuildOrders } from '../../repositories/spacecraft-build-orders.js';
import {
  cancelTrip,
  insertTrip,
  listTravelingTripsBySpacecraftForUpdate,
  updateTripCargo,
  type TripRow,
} from '../../repositories/spacecraft-trips.js';
import { releaseSpawnSlots } from '../../repositories/spawn-slots.js';
import {
  deleteStationBuildings,
  listBuildingLevels,
} from '../../repositories/station-buildings.js';
import { deleteStationResearch } from '../../repositories/station-research.js';
import {
  deleteStationResources,
  listStationResources,
} from '../../repositories/station-resources.js';
import {
  addLockedSpacecraft,
  clearStationSpacecrafts,
  listStationSpacecraftsForUpdate,
  releaseSpacecraftClamped,
} from '../../repositories/station-spacecrafts.js';
import {
  findStation,
  listOtherActiveStationPositionsByUser,
  updateStation,
} from '../../repositories/stations.js';
import {
  listMovingWorldMissionsBySpacecraftForUpdate,
  updateWorldMission,
} from '../../repositories/world-missions.js';
import {
  calcArrivesAt,
  calcDistance,
  interpolateWorldPosition,
  type Coordinate,
} from '../../lib/travel.js';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import { creditStationResources } from '../station/index.js';

type Trip = TripRow;

/** Share of the resources invested in buildings and defense that a destroyed station leaves behind. */
const INVESTMENT_DEBRIS_SHARE = 0.2;

const addResources = (target: ResourceMap, source: ResourceMap, factor = 1) => {
  for (const [key, amount] of entriesOf(source)) {
    const value = Math.floor(amount * factor);
    if (value > 0) target[key] = (target[key] ?? 0) + value;
  }
};

/** Adds ships to a station's fleet row as locked (still travelling) and returns the row id. */
async function addLockedShips(
  tx: Tx,
  stationId: string,
  spacecraftKey: string,
  amount: number,
  context: GameExecutionContext
): Promise<string> {
  const rowId = await addLockedSpacecraft(tx, {
    id: context.nextId('station-spacecraft'),
    stationId,
    spacecraftKey,
    amount,
    createdAt: context.now,
    updatedAt: context.now,
  });
  if (!rowId) throw new Error('Failed to relocate spacecraft');
  return rowId;
}

/** Ships of one trip per spacecraft key; combat trips carry a mixed fleet. */
async function tripGroups(
  tx: Tx,
  trip: Trip,
  spacecraftKey: string,
  now: Date
): Promise<Record<string, number>> {
  if (trip.purpose === 'combat' || trip.purpose === 'combat_return') {
    const leg = trip.purpose === 'combat' ? 'outbound' : 'return';
    const mission = await resolveCombatMissionByTrip(tx, leg, trip.id, now);
    if (mission) {
      return (trip.purpose === 'combat' ? mission.attackerFleet : mission.attackerSurvivors) ?? {};
    }
  }
  if (trip.purpose === 'salvage' || trip.purpose === 'salvage_return') {
    const leg = trip.purpose === 'salvage' ? 'outbound' : 'return';
    await resolveSalvageMissionByTrip(tx, leg, trip.id, now);
  }
  return { [spacecraftKey]: trip.groupSize };
}

/**
 * Destroys a station whose integrity reached 0. Must run inside the transaction that holds the
 * station row lock, so it happens exactly once. Ships in flight relocate to the owner's nearest
 * surviving station; without one they are lost. Returns what the debris field receives.
 */
export async function destroyStation(
  tx: Tx,
  station: { id: string; userId: string },
  context: GameExecutionContext
): Promise<{ dockedShips: Map<string, number>; resources: ResourceMap }> {
  const { now } = context;
  const fleetRows = await listStationSpacecraftsForUpdate(tx, station.id);
  const fleetIds = fleetRows.map((row) => row.id);
  const keyByRow = new Map(fleetRows.map((row) => [row.id, row.spacecraftKey]));
  const dockedShips = new Map<string, number>();
  for (const row of fleetRows) {
    const docked = row.amount - row.lockedAmount;
    if (docked > 0) dockedShips.set(row.spacecraftKey, docked);
  }

  const resources: ResourceMap = {};
  const storage = await listStationResources(tx, station.id);
  for (const row of storage) addResources(resources, { [row.resourceKey]: row.amount });

  const levels = await listBuildingLevels(tx, station.id);
  for (const { buildingKey: key, level } of levels) {
    const costs = isOneOf(buildingKeys, key)
      ? Array.from({ length: Math.max(0, level - 1) }, (_, i) =>
          calculateBuildingUpgradeCost(key, i + 2)
        )
      : isOneOf(defenseUpgradeKeys, key)
        ? Array.from(
            { length: Math.max(0, level - getDefenseUpgrade(key).startingLevel) },
            (_, i) => calculateDefenseUpgradeCost(key, getDefenseUpgrade(key).startingLevel + i + 1)
          )
        : [];
    for (const cost of costs.flat()) {
      addResources(resources, { [cost.resourceKey]: cost.amount }, INVESTMENT_DEBRIS_SHARE);
    }
  }

  const survivors = await listOtherActiveStationPositionsByUser(tx, station.userId, station.id);
  const nearest = (point: Coordinate) =>
    survivors.reduce<(typeof survivors)[number] | undefined>(
      (best, candidate) =>
        !best || calcDistance(point, candidate) < calcDistance(point, best) ? candidate : best,
      undefined
    );

  const trips =
    fleetIds.length === 0 ? [] : await listTravelingTripsBySpacecraftForUpdate(tx, fleetIds);
  for (const trip of trips) {
    await cancelTrip(tx, trip.id);
    const groups = await tripGroups(tx, trip, keyByRow.get(trip.stationSpacecraftId) ?? '', now);
    const position = interpolateWorldPosition(trip, now);
    const target = nearest(position);
    if (!target) continue;
    let cargo = trip.cargoManifest;
    for (const [spacecraftKey, amount] of Object.entries(groups)) {
      if (amount <= 0) continue;
      const rowId = await addLockedShips(tx, target.id, spacecraftKey, amount, context);
      await insertTrip(tx, {
        id: context.nextId('trip'),
        stationSpacecraftId: rowId,
        groupSize: amount,
        fromType: 'station',
        fromId: station.id,
        fromX: position.x,
        fromY: position.y,
        toType: 'station',
        toId: target.id,
        toX: target.x,
        toY: target.y,
        departedAt: now,
        arrivesAt: calcArrivesAt(
          now,
          calcDistance(position, target),
          requireSpacecraft(spacecraftKey).speed
        ),
        purpose: 'relocate',
        cargoManifest: cargo,
        createdAt: now,
      });
      cargo = null;
    }
  }

  const missions =
    fleetIds.length === 0 ? [] : await listMovingWorldMissionsBySpacecraftForUpdate(tx, fleetIds);
  for (const mission of missions) {
    const origin = await findStation(tx, mission.originStationId);
    const target = origin ? nearest(origin) : undefined;
    if (!target) {
      await updateWorldMission(tx, mission.id, { status: 'cancelled' });
      continue;
    }
    // ponytail: the mission keeps its timing and only changes home; a returning ship jumps to the new path.
    const rowId = await addLockedShips(tx, target.id, mission.spacecraftKey, 1, context);
    await updateWorldMission(tx, mission.id, {
      stationSpacecraftId: rowId,
      originStationId: target.id,
    });
  }

  await clearStationSpacecrafts(tx, station.id, now);
  await deleteStationBuildings(tx, station.id);
  await deleteStationResources(tx, station.id);
  await deleteStationResearch(tx, station.id);
  await deleteBuildOrders(tx, station.id);
  await deleteStationAssignments(tx, station.id);
  await releaseSpawnSlots(tx, station.id);
  await updateStation(tx, station.id, { integrity: 0, integrityUpdatedAt: now, destroyedAt: now });

  return { dockedShips, resources };
}

/** Relocated ships join the target station's fleet and deliver any cargo they carried. */
export async function handleRelocateArrival(tx: Tx, trip: Trip): Promise<void> {
  if (trip.cargoManifest) {
    const credited = await creditStationResources(tx, trip.toId, { ...trip.cargoManifest });
    await updateTripCargo(tx, trip.id, credited);
  }
  await releaseSpacecraftClamped(tx, trip.stationSpacecraftId, trip.groupSize);
}
