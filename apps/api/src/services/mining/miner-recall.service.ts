import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { scheduleTripArrival } from '../../queue/queues/trip-arrival-queue.js';

const logger = rootLogger.child({ name: 'miner-recall' });
import {
  asteroids,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { stations } from '../../lib/db/schema/stations.js';
import { calcDistance, calcArrivesAt } from '../../lib/travel.js';

// ============================================================================
// checkAndDispatchMinerRecall
//
// Called after every mining tick (both on-demand and cron).
// If the asteroid buffer is >= total miner cargo capacity (buffer full),
// all at_asteroid miners self-recall: they load the buffer into their cargo
// and fly back to their station. Buffer is cleared atomically (SELECT FOR UPDATE
// equivalent via transaction). Assignments stay in DB — miners return automatically
// after trip arrival processing in the transport tick worker.
// ============================================================================

export const checkAndDispatchMinerRecall = async (asteroidId: string): Promise<void> => {
  const db = getDb();

  // Load asteroid coordinates
  const [asteroid] = await db
    .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId))
    .limit(1);
  if (!asteroid) {
    logger.debug({ asteroidId }, 'checkAndDispatchMinerRecall: asteroid not found, skipping');
    return;
  }

  // Load only at_asteroid assignments (traveling miners don't participate)
  const currentAssignments = await db
    .select({
      id: asteroidAssignments.id,
      stationId: asteroidAssignments.stationId,
      spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
      assignedAmount: asteroidAssignments.assignedAmount,
      cargo: spacecraftDefinitions.cargo,
      speed: spacecraftDefinitions.speed,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(
      and(
        eq(asteroidAssignments.asteroidId, asteroidId),
        eq(asteroidAssignments.status, 'at_asteroid')
      )
    );

  if (currentAssignments.length === 0) return;

  const totalMinerCargo = currentAssignments.reduce((s, a) => s + a.assignedAmount * a.cargo, 0);

  const createdTripIds: { id: string; arrivesAt: Date }[] = [];

  await db.transaction(async (tx) => {
    const buffer = await tx
      .select()
      .from(asteroidResourceStorage)
      .where(eq(asteroidResourceStorage.asteroidId, asteroidId))
      .for('update');

    const totalBuffer = buffer.reduce((s, r) => s + r.amount, 0);
    if (totalBuffer < totalMinerCargo) return;

    // Load station coordinates for travel time calculation
    const stationIds = [...new Set(currentAssignments.map((a) => a.stationId))];
    const stationRows = await tx
      .select({ id: stations.id, x: stations.x, y: stations.y })
      .from(stations)
      .where(inArray(stations.id, stationIds));
    const stationMap = new Map(stationRows.map((s) => [s.id, s]));

    const now = new Date();

    // Create one recall trip per assignment group
    for (const assignment of currentAssignments) {
      const station = stationMap.get(assignment.stationId);
      if (!station) continue;

      // Find the stationSpacecrafts row id
      const [ssRow] = await tx
        .select({ id: stationSpacecrafts.id })
        .from(stationSpacecrafts)
        .where(
          and(
            eq(stationSpacecrafts.stationId, assignment.stationId),
            eq(stationSpacecrafts.spacecraftDefinitionId, assignment.spacecraftDefinitionId)
          )
        )
        .limit(1);
      if (!ssRow) continue;

      // Proportional cargo share for this assignment group
      const assignmentCargo = assignment.assignedAmount * assignment.cargo;
      const cargoShare = totalMinerCargo > 0 ? assignmentCargo / totalMinerCargo : 0;

      const cargoManifest: Record<string, number> = {};
      for (const resource of buffer) {
        const amount = Math.floor(resource.amount * cargoShare);
        if (amount > 0) cargoManifest[resource.resourceKey] = amount;
      }

      const distance = calcDistance(
        { x: asteroid.x, y: asteroid.y },
        { x: station.x, y: station.y }
      );
      const recallArrivesAt = calcArrivesAt(now, distance, assignment.speed);
      const returnArrivesAt = calcArrivesAt(recallArrivesAt, distance, assignment.speed);

      // Create recall trip (asteroid→station) and return trip (station→asteroid) together
      // so the client can animate the full round trip without waiting for the next tick.
      const createdTrips = await tx
        .insert(spacecraftTrips)
        .values([
          {
            stationSpacecraftId: ssRow.id,
            groupSize: assignment.assignedAmount,
            fromType: 'asteroid',
            fromId: asteroidId,
            toType: 'station',
            toId: assignment.stationId,
            departedAt: now,
            arrivesAt: recallArrivesAt,
            purpose: 'recall',
            cargoManifest,
            status: 'traveling',
          },
          {
            stationSpacecraftId: ssRow.id,
            groupSize: assignment.assignedAmount,
            fromType: 'station',
            fromId: assignment.stationId,
            toType: 'asteroid',
            toId: asteroidId,
            departedAt: recallArrivesAt,
            arrivesAt: returnArrivesAt,
            purpose: 'return',
            cargoManifest: null,
            status: 'traveling',
          },
        ])
        .returning({ id: spacecraftTrips.id, arrivesAt: spacecraftTrips.arrivesAt });

      // Store for scheduling after the transaction commits
      createdTripIds.push(...createdTrips);

      // Mark assignment as traveling_to_station
      await tx
        .update(asteroidAssignments)
        .set({ status: 'traveling_to_station', lastTick: now })
        .where(eq(asteroidAssignments.id, assignment.id));
    }

    // Clear the asteroid buffer (resources are now in the trip cargoManifests)
    await tx
      .delete(asteroidResourceStorage)
      .where(eq(asteroidResourceStorage.asteroidId, asteroidId));
  });

  // Ticket B: delayed arrival jobs registrieren — ausserhalb der Transaktion,
  // damit BullMQ-Fehler keinen Rollback auslösen können.
  for (const trip of createdTripIds) {
    try {
      await scheduleTripArrival(trip.id, trip.arrivesAt);
    } catch (err) {
      logger.warn(
        { tripId: trip.id, err },
        'scheduleTripArrival failed — reconciliation will recover'
      );
    }
  }
};
