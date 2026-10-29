import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
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
import { asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { combatMissions } from '../../lib/db/schema/combat-missions.js';
import { salvageMissions } from '../../lib/db/schema/debris-fields.js';
import { spacecraftBuildOrders } from '../../lib/db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { spawnSlots } from '../../lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { stationResearch } from '../../lib/db/schema/station-research.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { worldMissions } from '../../lib/db/schema/world-missions.js';
import {
  calcArrivesAt,
  calcDistance,
  interpolateWorldPosition,
  type Coordinate,
} from '../../lib/travel.js';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import { creditStationResources } from '../station/index.js';

type Trip = typeof spacecraftTrips.$inferSelect;

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
  const [row] = await tx
    .insert(stationSpacecrafts)
    .values({
      id: context.nextId('station-spacecraft'),
      stationId,
      spacecraftKey,
      amount,
      lockedAmount: amount,
      createdAt: context.now,
      updatedAt: context.now,
    })
    .onConflictDoUpdate({
      target: [stationSpacecrafts.stationId, stationSpacecrafts.spacecraftKey],
      set: {
        amount: sql`${stationSpacecrafts.amount} + ${amount}`,
        lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${amount}`,
      },
    })
    .returning({ id: stationSpacecrafts.id });
  if (!row) throw new Error('Failed to relocate spacecraft');
  return row.id;
}

/** Ships of one trip per spacecraft key; combat trips carry a mixed fleet. */
async function tripGroups(
  tx: Tx,
  trip: Trip,
  spacecraftKey: string,
  now: Date
): Promise<Record<string, number>> {
  if (trip.purpose === 'combat' || trip.purpose === 'combat_return') {
    const column =
      trip.purpose === 'combat' ? combatMissions.outboundTripId : combatMissions.returnTripId;
    const [mission] = await tx
      .update(combatMissions)
      .set({ status: 'resolved', resolvedAt: now })
      .where(eq(column, trip.id))
      .returning();
    if (mission) {
      return (trip.purpose === 'combat' ? mission.attackerFleet : mission.attackerSurvivors) ?? {};
    }
  }
  if (trip.purpose === 'salvage' || trip.purpose === 'salvage_return') {
    const column =
      trip.purpose === 'salvage' ? salvageMissions.outboundTripId : salvageMissions.returnTripId;
    await tx
      .update(salvageMissions)
      .set({ status: 'resolved', resolvedAt: now })
      .where(eq(column, trip.id));
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
  const fleetRows = await tx
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, station.id))
    .for('update');
  const fleetIds = fleetRows.map((row) => row.id);
  const keyByRow = new Map(fleetRows.map((row) => [row.id, row.spacecraftKey]));
  const dockedShips = new Map<string, number>();
  for (const row of fleetRows) {
    const docked = row.amount - row.lockedAmount;
    if (docked > 0) dockedShips.set(row.spacecraftKey, docked);
  }

  const resources: ResourceMap = {};
  const storage = await tx
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, station.id));
  for (const row of storage) addResources(resources, { [row.resourceKey]: row.amount });

  const levels = await tx
    .select({ key: stationBuildings.buildingKey, level: stationBuildings.level })
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, station.id));
  for (const { key, level } of levels) {
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

  const survivors = await tx
    .select({ id: stations.id, x: stations.x, y: stations.y })
    .from(stations)
    .where(
      and(
        eq(stations.userId, station.userId),
        ne(stations.id, station.id),
        isNull(stations.destroyedAt)
      )
    );
  const nearest = (point: Coordinate) =>
    survivors.reduce<(typeof survivors)[number] | undefined>(
      (best, candidate) =>
        !best || calcDistance(point, candidate) < calcDistance(point, best) ? candidate : best,
      undefined
    );

  const trips =
    fleetIds.length === 0
      ? []
      : await tx
          .select()
          .from(spacecraftTrips)
          .where(
            and(
              inArray(spacecraftTrips.stationSpacecraftId, fleetIds),
              eq(spacecraftTrips.status, 'traveling')
            )
          )
          .for('update');
  for (const trip of trips) {
    await tx
      .update(spacecraftTrips)
      .set({ status: 'cancelled' })
      .where(eq(spacecraftTrips.id, trip.id));
    const groups = await tripGroups(tx, trip, keyByRow.get(trip.stationSpacecraftId) ?? '', now);
    const position = interpolateWorldPosition(trip, now);
    const target = nearest(position);
    if (!target) continue;
    let cargo = trip.cargoManifest;
    for (const [spacecraftKey, amount] of Object.entries(groups)) {
      if (amount <= 0) continue;
      const rowId = await addLockedShips(tx, target.id, spacecraftKey, amount, context);
      await tx.insert(spacecraftTrips).values({
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
    fleetIds.length === 0
      ? []
      : await tx
          .select()
          .from(worldMissions)
          .where(
            and(
              inArray(worldMissions.stationSpacecraftId, fleetIds),
              inArray(worldMissions.status, ['traveling', 'returning'])
            )
          )
          .for('update');
  for (const mission of missions) {
    const [origin] = await tx
      .select({ x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.id, mission.originStationId));
    const target = origin ? nearest(origin) : undefined;
    if (!target) {
      await tx
        .update(worldMissions)
        .set({ status: 'cancelled' })
        .where(eq(worldMissions.id, mission.id));
      continue;
    }
    // ponytail: the mission keeps its timing and only changes home; a returning ship jumps to the new path.
    const rowId = await addLockedShips(tx, target.id, mission.spacecraftKey, 1, context);
    await tx
      .update(worldMissions)
      .set({ stationSpacecraftId: rowId, originStationId: target.id })
      .where(eq(worldMissions.id, mission.id));
  }

  await tx
    .update(stationSpacecrafts)
    .set({ amount: 0, lockedAmount: 0, updatedAt: now })
    .where(eq(stationSpacecrafts.stationId, station.id));
  await tx.delete(stationBuildings).where(eq(stationBuildings.stationId, station.id));
  await tx.delete(stationResources).where(eq(stationResources.stationId, station.id));
  await tx.delete(stationResearch).where(eq(stationResearch.stationId, station.id));
  await tx.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, station.id));
  await tx.delete(asteroidAssignments).where(eq(asteroidAssignments.stationId, station.id));
  await tx.update(spawnSlots).set({ stationId: null }).where(eq(spawnSlots.stationId, station.id));
  await tx
    .update(stations)
    .set({ integrity: 0, integrityUpdatedAt: now, destroyedAt: now })
    .where(eq(stations.id, station.id));

  return { dockedShips, resources };
}

/** Relocated ships join the target station's fleet and deliver any cargo they carried. */
export async function handleRelocateArrival(tx: Tx, trip: Trip): Promise<void> {
  if (trip.cargoManifest) {
    const credited = await creditStationResources(tx, trip.toId, { ...trip.cargoManifest });
    await tx
      .update(spacecraftTrips)
      .set({ cargoManifest: credited })
      .where(eq(spacecraftTrips.id, trip.id));
  }
  await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`greatest(0, ${stationSpacecrafts.lockedAmount} - ${trip.groupSize})` })
    .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));
}
