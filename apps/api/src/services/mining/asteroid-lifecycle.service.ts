import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ name: 'asteroid-lifecycle' });
import {
  asteroids,
  asteroidVeins,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { stations } from '../../lib/db/schema/stations.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { calcMiningLoad } from '../../lib/vein-rates.js';
import { calcDistance, calcArrivesAt } from '../../lib/travel.js';
import { scheduleTripArrival } from '../../queue/queues/trip-arrival-queue.js';

// ============================================================================
// destroyAsteroid — called when stability reaches 0
//
// 1. Creates recall trips for at_asteroid miners so they fly home with cargo.
// 2. Releases locks for miners whose outbound trip is cancelled immediately.
// 3. Cancels & releases locks for pre-created transporter return trips.
// 4. Cancels all outbound trips still en-route to the asteroid.
// 5. Cascade-deletes the asteroid (veins, storage, assignments follow).
// ============================================================================

export const destroyAsteroid = async (asteroidId: string): Promise<void> => {
  const db = getDb();

  // Quick existence check before entering the transaction (cheap read, no lock needed)
  const [asteroidRow] = await db
    .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId))
    .limit(1);
  if (!asteroidRow) {
    logger.warn({ asteroidId }, 'destroyAsteroid: asteroid not found, already deleted?');
    return;
  }

  logger.info({ asteroidId }, 'Destroying asteroid');

  const recallTripIds: { id: string; arrivesAt: Date }[] = [];

  await db.transaction(async (tx) => {
    // Load all assignments with the data needed for recall trips
    const assignments = await tx
      .select({
        stationId: asteroidAssignments.stationId,
        assignedAmount: asteroidAssignments.assignedAmount,
        spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
        status: asteroidAssignments.status,
        cargo: spacecraftDefinitions.cargo,
        speed: spacecraftDefinitions.speed,
      })
      .from(asteroidAssignments)
      .innerJoin(
        spacecraftDefinitions,
        eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(eq(asteroidAssignments.asteroidId, asteroidId));

    // Load buffer resources
    const buffer = await tx
      .select()
      .from(asteroidResourceStorage)
      .where(eq(asteroidResourceStorage.asteroidId, asteroidId));

    const now = new Date();

    // ── Recall trips for miners currently at the asteroid ──────────────────
    // Instead of teleporting resources, send miners home with the buffer.
    // Miners already traveling to the station (status='traveling_to_station')
    // already have a recall trip in flight — we skip them here.
    const atAsteroid = assignments.filter((a) => a.status === 'at_asteroid');

    if (atAsteroid.length > 0) {
      const totalCargo = atAsteroid.reduce((s, a) => s + a.assignedAmount * a.cargo, 0);

      const stationIds = [...new Set(atAsteroid.map((a) => a.stationId))];
      const stationRows = await tx
        .select({ id: stations.id, x: stations.x, y: stations.y })
        .from(stations)
        .where(inArray(stations.id, stationIds));
      const stationMap = new Map(stationRows.map((s) => [s.id, s]));

      for (const assignment of atAsteroid) {
        const station = stationMap.get(assignment.stationId);
        if (!station) continue;

        // Find the stationSpacecrafts row (needed as foreign key on the trip)
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

        // Proportional share of the buffer for this assignment group
        const assignmentCargo = assignment.assignedAmount * assignment.cargo;
        const cargoShare = totalCargo > 0 ? assignmentCargo / totalCargo : 0;

        const cargoManifest: Record<string, number> = {};
        for (const resource of buffer) {
          const amount = Math.floor(resource.amount * cargoShare);
          if (amount > 0) cargoManifest[resource.resourceKey] = amount;
        }

        const distance = calcDistance(
          { x: asteroidRow.x, y: asteroidRow.y },
          { x: station.x, y: station.y }
        );
        const arrivesAt = calcArrivesAt(now, distance, assignment.speed);

        // Recall trip only — no return trip since the asteroid is destroyed.
        // When this trip arrives, the transport tick credits the cargoManifest
        // to the station and releases the lock (asteroid-existence check → gone).
        const [recallTrip] = await tx
          .insert(spacecraftTrips)
          .values({
            stationSpacecraftId: ssRow.id,
            groupSize: assignment.assignedAmount,
            fromType: 'asteroid',
            fromId: asteroidId,
            toType: 'station',
            toId: assignment.stationId,
            departedAt: now,
            arrivesAt,
            purpose: 'recall',
            cargoManifest,
            status: 'traveling',
          })
          .returning({ id: spacecraftTrips.id, arrivesAt: spacecraftTrips.arrivesAt });

        // Schedule the delayed arrival job outside the transaction below.
        if (recallTrip) recallTripIds.push(recallTrip);
      }
    }

    // ── Release locks for miners whose outbound trip we just cancelled ──────
    // Only traveling_to_asteroid miners are freed immediately — their trip is
    // deleted and they'll never arrive. at_asteroid and traveling_to_station
    // miners keep their lock; the transport tick releases it when their recall
    // trip arrives at the station and detects the asteroid is gone.
    const travelingToAsteroid = assignments.filter((a) => a.status === 'traveling_to_asteroid');
    for (const a of travelingToAsteroid) {
      await tx
        .update(stationSpacecrafts)
        .set({
          lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${a.assignedAmount})`,
        })
        .where(
          and(
            eq(stationSpacecrafts.stationId, a.stationId),
            eq(stationSpacecrafts.spacecraftDefinitionId, a.spacecraftDefinitionId)
          )
        );
    }

    // ── Cancel transporter return trips (asteroid → station) immediately ───
    // Pre-created at dispatch time. Miner recall trips (purpose='recall') are
    // intentionally NOT cancelled — they deliver the cargo and release the lock
    // via the transport tick asteroid-existence check.
    const transporterReturnTrips = await tx
      .select({
        stationSpacecraftId: spacecraftTrips.stationSpacecraftId,
        groupSize: spacecraftTrips.groupSize,
      })
      .from(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.fromType, 'asteroid'),
          eq(spacecraftTrips.fromId, asteroidId),
          eq(spacecraftTrips.purpose, 'return'),
          eq(spacecraftTrips.status, 'traveling')
        )
      );

    for (const trip of transporterReturnTrips) {
      await tx
        .update(stationSpacecrafts)
        .set({
          lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${trip.groupSize})`,
        })
        .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));
    }

    await tx
      .delete(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.fromType, 'asteroid'),
          eq(spacecraftTrips.fromId, asteroidId),
          eq(spacecraftTrips.purpose, 'return'),
          eq(spacecraftTrips.status, 'traveling')
        )
      );

    // ── Cancel all trips still flying toward this asteroid ─────────────────
    // Covers: initial mine trips and miner-return trips (station → asteroid).
    await tx
      .delete(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.toType, 'asteroid'),
          eq(spacecraftTrips.toId, asteroidId),
          eq(spacecraftTrips.status, 'traveling')
        )
      );

    // Cascade-delete: veins, storage, assignments are deleted automatically
    await tx.delete(asteroids).where(eq(asteroids.id, asteroidId));
  });

  // Ticket B: delayed arrival jobs für Recall-Trips — ausserhalb der Transaktion
  for (const trip of recallTripIds) {
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

// ============================================================================
// applyAsteroidStabilityTick
//
// Applies a single stability tick for one asteroid based on ALL assignments.
// Uses asteroid.updatedAt as the last-stability-tick anchor.
// Called once per asteroid after all assignment production ticks.
// May trigger destroyAsteroid if stability reaches 0.
// ============================================================================

/** Minimum delta to bother calculating (3.6 seconds expressed as hours) */
const MIN_DELTA_HOURS = 0.001;

export const applyAsteroidStabilityTick = async (asteroidId: string): Promise<void> => {
  const db = getDb();
  const now = new Date();

  const [asteroid] = await db
    .select()
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId))
    .limit(1);
  if (!asteroid) return;

  // Cap at 24 h to avoid giant first-tick jumps on freshly seeded asteroids
  const deltaHours = Math.min((now.getTime() - asteroid.updatedAt.getTime()) / 3_600_000, 24);
  if (deltaHours < MIN_DELTA_HOURS) return;

  // Combined mining rate across ALL assignments
  const allAssignments = await db
    .select({
      assignedAmount: asteroidAssignments.assignedAmount,
      miningRate: spacecraftDefinitions.miningRate,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(asteroidAssignments.asteroidId, asteroidId));

  const veins = await db
    .select()
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId));

  if (veins.length === 0) return;

  const combinedMiningRate = allAssignments.reduce(
    (sum, a) => sum + a.miningRate * a.assignedAmount,
    0
  );

  const { totalMiningLoad, totalYieldCap } = calcMiningLoad(combinedMiningRate, veins);

  let newStability = asteroid.stability;
  if (allAssignments.length === 0) {
    // No miners → passive regen
    newStability += WORLD_CONFIG.STABILITY_REGEN_PER_HOUR * deltaHours;
  } else if (totalYieldCap > 0 && totalMiningLoad > totalYieldCap) {
    const overRatio = totalMiningLoad / totalYieldCap;
    newStability -= WORLD_CONFIG.STABILITY_DEGRADATION_PER_HOUR * deltaHours * overRatio;
  } else {
    newStability += WORLD_CONFIG.STABILITY_REGEN_PER_HOUR * deltaHours;
  }
  newStability = Math.max(WORLD_CONFIG.STABILITY_FLOOR, Math.min(1.0, newStability));

  if (newStability <= 0) {
    await destroyAsteroid(asteroidId);
    return;
  }

  await db
    .update(asteroids)
    .set({ stability: newStability, updatedAt: now })
    .where(eq(asteroids.id, asteroidId));
};
