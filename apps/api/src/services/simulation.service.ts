import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { logger as rootLogger } from '../lib/logger.js';
import { publishUserEvent } from '../lib/realtime.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { spacecraftBuildOrders } from '../lib/db/schema/spacecraft-build-orders.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { settleTripArrival } from './transport/trip-arrivals.service.js';

const logger = rootLogger.child({ name: 'simulation' });

export async function runSimulationTick(now = new Date()): Promise<void> {
  const db = getDb();

  // ponytail: one in-memory due set is enough for the current world size; batch when measured.
  const dueTrips = await db
    .select({ trip: spacecraftTrips, userId: stations.userId })
    .from(spacecraftTrips)
    .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
    .innerJoin(stations, eq(stationSpacecrafts.stationId, stations.id))
    .where(and(eq(spacecraftTrips.status, 'traveling'), lte(spacecraftTrips.arrivesAt, now)))
    .orderBy(asc(spacecraftTrips.arrivesAt), asc(spacecraftTrips.id));

  for (const { trip, userId } of dueTrips) {
    try {
      if (await settleTripArrival(trip)) {
        publishUserEvent(userId, 'transport_tick_completed', { settled: 1 });
      }
    } catch (error) {
      logger.error({ tripId: trip.id, error }, 'Failed to settle due trip');
    }
  }

  const dueBuildings = await db
    .select({
      id: stationBuildings.id,
      stationId: stationBuildings.stationId,
      userId: stations.userId,
      buildingKey: buildingDefinitions.key,
      maxLevel: buildingDefinitions.maxLevel,
    })
    .from(stationBuildings)
    .innerJoin(
      buildingDefinitions,
      eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
    )
    .innerJoin(stations, eq(stationBuildings.stationId, stations.id))
    .where(lte(stationBuildings.upgradeEndsAt, now));

  for (const building of dueBuildings) {
    try {
      const [completed] = await db
        .update(stationBuildings)
        .set({
          level: sql`least(${stationBuildings.level} + 1, ${building.maxLevel})`,
          upgradeEndsAt: null,
          updatedAt: now,
        })
        .where(and(eq(stationBuildings.id, building.id), lte(stationBuildings.upgradeEndsAt, now)))
        .returning({ level: stationBuildings.level });
      if (completed) {
        publishUserEvent(building.userId, 'building_upgrade_completed', {
          stationId: building.stationId,
          buildingKey: building.buildingKey,
          newLevel: completed.level,
        });
      }
    } catch (error) {
      logger.error({ buildingId: building.id, error }, 'Failed to complete building upgrade');
    }
  }

  const dueBuildOrders = await db
    .select({
      id: spacecraftBuildOrders.id,
      stationId: spacecraftBuildOrders.stationId,
      spacecraftDefinitionId: spacecraftBuildOrders.spacecraftDefinitionId,
      amount: spacecraftBuildOrders.amount,
      userId: stations.userId,
      spacecraftKey: spacecraftDefinitions.key,
    })
    .from(spacecraftBuildOrders)
    .innerJoin(stations, eq(spacecraftBuildOrders.stationId, stations.id))
    .innerJoin(
      spacecraftDefinitions,
      eq(spacecraftBuildOrders.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(lte(spacecraftBuildOrders.endsAt, now));

  for (const order of dueBuildOrders) {
    try {
      const completed = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .delete(spacecraftBuildOrders)
          .where(
            and(eq(spacecraftBuildOrders.id, order.id), lte(spacecraftBuildOrders.endsAt, now))
          )
          .returning({ id: spacecraftBuildOrders.id });
        if (!claimed) return false;

        await tx
          .update(stationSpacecrafts)
          .set({
            amount: sql`${stationSpacecrafts.amount} + ${order.amount}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(stationSpacecrafts.stationId, order.stationId),
              eq(stationSpacecrafts.spacecraftDefinitionId, order.spacecraftDefinitionId)
            )
          );
        return true;
      });

      if (completed) {
        publishUserEvent(order.userId, 'spacecraft_build_completed', {
          stationId: order.stationId,
          spacecraftKey: order.spacecraftKey,
          amount: order.amount,
          orderId: order.id,
        });
      }
    } catch (error) {
      logger.error({ orderId: order.id, error }, 'Failed to complete spacecraft build');
    }
  }
}

export function startSimulationScheduler(intervalMs = 1_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void runSimulationTick()
      .catch((error) => logger.error({ error }, 'Simulation tick failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
}
