import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import {
  asteroids,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { spacecraftTrips, type CargoManifest } from '../lib/db/schema/spacecraft-trips.js';
import { stations } from '../lib/db/schema/stations.js';
import { calcDistance, calcArrivesAt } from '../lib/travel.js';

// ============================================================================
// Transport Tick Service
//
// Responsibilities:
//   1. processTripArrivals()      — settle all trips that have arrived
//   2. checkAndDispatchTransports(stationId) — send idle transporters to asteroids
//
// Called by the transport-tick BullMQ cron worker every minute.
// ============================================================================

// ── Priority score weights (tunable) ────────────────────────────────────────
const W_FILL = 0.9; // raw buffer amount
const W_RATE = 60.0; // mining rate/h advantage (1 unit/h = 60 score points)
const W_DISTANCE = 0.1; // distance cost per world unit

// Minimum fill ratio before a transporter is dispatched.
// 0.5 = dispatch when buffer >= 50% of the transporter's cargo capacity.
// Lower values = more frequent trips (partially loaded), higher = more efficient but slower.
const MIN_FILL_RATIO = 0.5;

// ============================================================================
// processTripArrivals
//
// Processes all spacecraft_trips where arrivesAt <= now and status='traveling'.
// Trip types handled:
//   'mine'      → miner arrived at asteroid, set assignment at_asteroid
//   'return'    → miner returned to asteroid after recall, set assignment at_asteroid
//   'recall'    → miner arrived at station with resources, credit + create return trip
//   'transport' → transporter arrived at asteroid (outbound), create return trip
//   'transport-return' (purpose='return' from transporter) → credit station resources
// ============================================================================

export const processTripArrivals = async (): Promise<number> => {
  const db = getDb();
  const now = new Date();

  const arrivedTrips = await db
    .select()
    .from(spacecraftTrips)
    .where(and(eq(spacecraftTrips.status, 'traveling'), lte(spacecraftTrips.arrivesAt, now)));

  let settled = 0;
  for (const trip of arrivedTrips) {
    try {
      await settleTripArrival(trip);
      settled++;
    } catch (err) {
      // Log but continue processing other trips
      console.error({ tripId: trip.id, err }, 'Failed to settle trip arrival');
    }
  }

  // Delete arrived trips older than 24h — keeps the table small while
  // still covering the 1h window used by getTransportEffectiveRates.
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await db
    .delete(spacecraftTrips)
    .where(and(eq(spacecraftTrips.status, 'arrived'), lt(spacecraftTrips.arrivesAt, cutoff)));

  return settled;
};;

async function settleTripArrival(trip: typeof spacecraftTrips.$inferSelect): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    // Mark trip as arrived
    await tx
      .update(spacecraftTrips)
      .set({ status: 'arrived' })
      .where(eq(spacecraftTrips.id, trip.id));

    if ((trip.purpose === 'mine' || trip.purpose === 'return') && trip.toType === 'asteroid') {
      // ── Miner arrived at asteroid ──────────────────────────────────────────
      // Find the assignment linked to this stationSpacecraft + destination asteroid
      await tx
        .update(asteroidAssignments)
        .set({ status: 'at_asteroid', lastTick: trip.arrivesAt })
        .where(
          and(
            eq(asteroidAssignments.asteroidId, trip.toId),
            eq(asteroidAssignments.status, 'traveling_to_asteroid'),
            // Match via stationSpacecraftId → stationId + spacecraftDefinitionId
            sql`${asteroidAssignments.stationId} = (
              SELECT station_id FROM station_spacecrafts WHERE id = ${trip.stationSpacecraftId}
            )`,
            sql`${asteroidAssignments.spacecraftDefinitionId} = (
              SELECT spacecraft_definition_id FROM station_spacecrafts WHERE id = ${trip.stationSpacecraftId}
            )`
          )
        );
    } else if (trip.purpose === 'recall') {
      // ── Miner arrived at station after self-recall ─────────────────────────
      // Credit resources to station
      if (trip.cargoManifest) {
        for (const [resourceKey, amount] of Object.entries(trip.cargoManifest)) {
          if (amount <= 0) continue;
          await tx
            .insert(stationResources)
            .values({ stationId: trip.toId, resourceKey, amount })
            .onConflictDoUpdate({
              target: [stationResources.stationId, stationResources.resourceKey],
              set: { amount: sql`${stationResources.amount} + ${amount}` },
            });
        }
      }

      // Return trip was already created at recall dispatch time.
      // Just update assignment status to traveling_to_asteroid.
      await tx
        .update(asteroidAssignments)
        .set({ status: 'traveling_to_asteroid' })
        .where(
          and(
            eq(asteroidAssignments.asteroidId, trip.fromId),
            sql`${asteroidAssignments.stationId} = ${trip.toId}`,
            sql`${asteroidAssignments.spacecraftDefinitionId} = (
              SELECT spacecraft_definition_id FROM station_spacecrafts WHERE id = ${trip.stationSpacecraftId}
            )`
          )
        );
    } else if (trip.purpose === 'transport' && trip.toType === 'asteroid') {
      // ── Transporter arrived at asteroid (outbound leg) ─────────────────────
      // Return trip was already created at dispatch time — nothing to do here.
    } else if (trip.purpose === 'return' && trip.toType === 'station') {
      // ── Transporter return leg arrived at station ───────────────────────────
      if (trip.cargoManifest) {
        for (const [resourceKey, amount] of Object.entries(trip.cargoManifest)) {
          if (amount <= 0) continue;
          await tx
            .insert(stationResources)
            .values({ stationId: trip.toId, resourceKey, amount })
            .onConflictDoUpdate({
              target: [stationResources.stationId, stationResources.resourceKey],
              set: { amount: sql`${stationResources.amount} + ${amount}` },
            });
        }
      }

      // Release locked ships
      await tx
        .update(stationSpacecrafts)
        .set({
          lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${trip.groupSize})`,
        })
        .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));
    }
  });
}

// ============================================================================
// checkAndDispatchTransports
//
// For a given station: find asteroids with enough buffer to fill at least one
// transporter, prioritize by score, and dispatch idle transporters.
// Resources are deducted from the asteroid buffer at dispatch time (SELECT FOR
// UPDATE equivalent via transaction) to prevent double-loading race conditions.
// ============================================================================

export const checkAndDispatchTransports = async (stationId: string): Promise<number> => {
  const db = getDb();

  // Load station position
  const [station] = await db
    .select({ id: stations.id, x: stations.x, y: stations.y })
    .from(stations)
    .where(eq(stations.id, stationId))
    .limit(1);
  if (!station) return 0;

  // Load all idle transporters for this station (role='transporter')
  const transporterRows = await db
    .select({
      id: stationSpacecrafts.id,
      spacecraftDefinitionId: stationSpacecrafts.spacecraftDefinitionId,
      amount: stationSpacecrafts.amount,
      lockedAmount: stationSpacecrafts.lockedAmount,
      cargo: spacecraftDefinitions.cargo,
      speed: spacecraftDefinitions.speed,
    })
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        eq(spacecraftDefinitions.role, 'transporter'),
        sql`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount} > 0`
      )
    );

  if (transporterRows.length === 0) return 0;

  // Track idle count per transporter row (mutable, decremented as we dispatch)
  const idleByTransporter = new Map(transporterRows.map((t) => [t.id, t.amount - t.lockedAmount]));
  // Sort transporter types by cargo descending so we prefer larger ones first
  const sortedTransporters = [...transporterRows].sort((a, b) => b.cargo - a.cargo);

  // Load all asteroids with at_asteroid assignments belonging to this station
  const asteroidCandidates = await db
    .select({
      asteroidId: asteroidAssignments.asteroidId,
      assignedAmount: asteroidAssignments.assignedAmount,
      miningRate: spacecraftDefinitions.miningRate,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(
      and(
        eq(asteroidAssignments.stationId, stationId),
        eq(asteroidAssignments.status, 'at_asteroid')
      )
    );

  // Group by asteroidId with total mining rate
  const asteroidMap = new Map<string, { totalMiningRate: number }>();
  for (const row of asteroidCandidates) {
    const existing = asteroidMap.get(row.asteroidId) ?? { totalMiningRate: 0 };
    existing.totalMiningRate += row.miningRate * row.assignedAmount;
    asteroidMap.set(row.asteroidId, existing);
  }

  if (asteroidMap.size === 0) return 0;

  // Load asteroid positions + buffer totals
  const asteroidIds = [...asteroidMap.keys()];
  const asteroidRows = await db
    .select({
      id: asteroids.id,
      x: asteroids.x,
      y: asteroids.y,
    })
    .from(asteroids)
    .where(inArray(asteroids.id, asteroidIds));

  const bufferRows = await db
    .select({
      asteroidId: asteroidResourceStorage.asteroidId,
      resourceKey: asteroidResourceStorage.resourceKey,
      amount: asteroidResourceStorage.amount,
    })
    .from(asteroidResourceStorage)
    .where(inArray(asteroidResourceStorage.asteroidId, asteroidIds));

  // Group buffer by asteroid
  const bufferByAsteroid = new Map<string, Array<{ resourceKey: string; amount: number }>>();
  for (const row of bufferRows) {
    const list = bufferByAsteroid.get(row.asteroidId) ?? [];
    list.push({ resourceKey: row.resourceKey, amount: row.amount });
    bufferByAsteroid.set(row.asteroidId, list);
  }

  // Score each asteroid
  type ScoredAsteroid = {
    asteroidId: string;
    x: number;
    y: number;
    totalBuffer: number;
    bufferByResource: Array<{ resourceKey: string; amount: number }>;
    score: number;
  };

  const scored: ScoredAsteroid[] = [];
  for (const aRow of asteroidRows) {
    const resources = bufferByAsteroid.get(aRow.id) ?? [];
    const totalBuffer = resources.reduce((s, r) => s + r.amount, 0);

    // Only consider asteroids where the buffer meets the minimum fill threshold
    // for at least the smallest transporter type.
    const smallestCargo = sortedTransporters[sortedTransporters.length - 1]?.cargo ?? Infinity;
    if (totalBuffer < smallestCargo * MIN_FILL_RATIO) continue;

    const { totalMiningRate } = asteroidMap.get(aRow.id)!;
    const distance = calcDistance({ x: station.x, y: station.y }, { x: aRow.x, y: aRow.y });

    const score = totalBuffer * W_FILL + totalMiningRate * W_RATE - distance * W_DISTANCE;

    scored.push({
      asteroidId: aRow.id,
      x: aRow.x,
      y: aRow.y,
      totalBuffer,
      bufferByResource: resources,
      score,
    });
  }

  // Sort highest priority first
  scored.sort((a, b) => b.score - a.score);

  let dispatched = 0;

  for (const candidate of scored) {
    // Pick the largest transporter type where the buffer meets MIN_FILL_RATIO
    // AND idle ships are available. Prefers larger transporters (sorted desc by cargo).
    const transporter = sortedTransporters.find(
      (t) =>
        candidate.totalBuffer >= t.cargo * MIN_FILL_RATIO && (idleByTransporter.get(t.id) ?? 0) > 0
    );
    if (!transporter) continue;

    const idleCount = idleByTransporter.get(transporter.id)!;
    const n = Math.ceil(candidate.totalBuffer / transporter.cargo);
    const groupSize = Math.min(n, idleCount);

    try {
      await db.transaction(async (tx) => {
        // Re-read buffer with row lock
        const lockedBuffer = await tx
          .select({
            asteroidId: asteroidResourceStorage.asteroidId,
            resourceKey: asteroidResourceStorage.resourceKey,
            amount: asteroidResourceStorage.amount,
          })
          .from(asteroidResourceStorage)
          .where(eq(asteroidResourceStorage.asteroidId, candidate.asteroidId))
          .for('update');

        const currentTotal = lockedBuffer.reduce((s, r) => s + r.amount, 0);
        if (currentTotal < transporter.cargo * MIN_FILL_RATIO) return; // raced out, skip

        // Calculate how much each transporter takes
        const totalToLoad = Math.min(currentTotal, groupSize * transporter.cargo);
        const loadFraction = totalToLoad / currentTotal;

        const cargoManifest: CargoManifest = {};
        for (const resource of lockedBuffer) {
          const amount = Math.floor(resource.amount * loadFraction);
          if (amount > 0) cargoManifest[resource.resourceKey] = amount;
        }

        // Decrement buffer
        for (const resource of lockedBuffer) {
          const deduct = Math.floor(resource.amount * loadFraction);
          if (deduct <= 0) continue;
          const newAmount = resource.amount - deduct;
          if (newAmount <= 0) {
            await tx
              .delete(asteroidResourceStorage)
              .where(
                and(
                  eq(asteroidResourceStorage.asteroidId, candidate.asteroidId),
                  eq(asteroidResourceStorage.resourceKey, resource.resourceKey)
                )
              );
          } else {
            await tx
              .update(asteroidResourceStorage)
              .set({ amount: newAmount })
              .where(
                and(
                  eq(asteroidResourceStorage.asteroidId, candidate.asteroidId),
                  eq(asteroidResourceStorage.resourceKey, resource.resourceKey)
                )
              );
          }
        }

        const distance = calcDistance(
          { x: station.x, y: station.y },
          { x: candidate.x, y: candidate.y }
        );
        const now = new Date();
        const outboundArrivesAt = calcArrivesAt(now, distance, transporter.speed);
        const returnArrivesAt = calcArrivesAt(outboundArrivesAt, distance, transporter.speed);

        // Create both legs up front so the client can animate the full round trip immediately
        await tx.insert(spacecraftTrips).values([
          {
            stationSpacecraftId: transporter.id,
            groupSize,
            fromType: 'station',
            fromId: stationId,
            toType: 'asteroid',
            toId: candidate.asteroidId,
            departedAt: now,
            arrivesAt: outboundArrivesAt,
            purpose: 'transport',
            cargoManifest,
            status: 'traveling',
          },
          {
            stationSpacecraftId: transporter.id,
            groupSize,
            fromType: 'asteroid',
            fromId: candidate.asteroidId,
            toType: 'station',
            toId: stationId,
            departedAt: outboundArrivesAt,
            arrivesAt: returnArrivesAt,
            purpose: 'return',
            cargoManifest,
            status: 'traveling',
          },
        ]);

        // Lock the ships
        await tx
          .update(stationSpacecrafts)
          .set({
            lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${groupSize}`,
          })
          .where(eq(stationSpacecrafts.id, transporter.id));

        dispatched += groupSize;
        idleByTransporter.set(transporter.id, idleCount - groupSize);
      });
    } catch (err) {
      console.error({ asteroidId: candidate.asteroidId, err }, 'Transport dispatch failed');
    }
  }

  return dispatched;
};
