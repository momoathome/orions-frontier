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
import { WORLD_CONFIG } from '../lib/world-config.js';

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
const W_FILL = 0.9; // projected fill fraction contribution
const W_RATE = 0.6; // mining rate/h advantage
const W_DISTANCE = 0.12; // distance cost per world unit

// ── Predictive dispatch thresholds ───────────────────────────────────────────
//
// TARGET_FILL   — ideal projected fill ratio at arrival (0.85 = ship arrives ~85% full)
// SOFT_MIN_FILL — opportunistic fallback when the asteroid has been starved long enough
// STARVATION_MS — how long an asteroid may go without a dispatch before fallback triggers
const TARGET_FILL = 0.85;
const SOFT_MIN_FILL = 0.3;
const STARVATION_MS = 20 * 60 * 1000; // 20 minutes

// ── Starvation tracker ───────────────────────────────────────────────────────
// Keeps the last successful dispatch timestamp per asteroid (module-level so it
// persists across ticks within the same process lifetime).
const lastDispatchedAt = new Map<string, number>();

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

export async function processTripArrivals(): Promise<number> {
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
}

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
      // Load resources from the asteroid buffer now (at arrival), then update
      // the pre-created return trip with the real cargoManifest.
      // This ensures the transporter carries what is actually present at arrival,
      // not what was in the buffer when it was dispatched (predictive dispatch).
      const asteroidId = trip.toId;
      const stationId = trip.fromId;

      const lockedBuffer = await tx
        .select({
          resourceKey: asteroidResourceStorage.resourceKey,
          amount: asteroidResourceStorage.amount,
        })
        .from(asteroidResourceStorage)
        .where(eq(asteroidResourceStorage.asteroidId, asteroidId))
        .for('update');

      const currentTotal = lockedBuffer.reduce((s, r) => s + r.amount, 0);

      if (currentTotal > 0) {
        // Determine the cargo capacity of this transporter so we don't overload.
        const [defRow] = await tx
          .select({ cargo: spacecraftDefinitions.cargo })
          .from(stationSpacecrafts)
          .innerJoin(
            spacecraftDefinitions,
            eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
          )
          .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId))
          .limit(1);

        const maxLoad = defRow ? trip.groupSize * defRow.cargo : currentTotal;
        const totalToLoad = Math.min(currentTotal, maxLoad);
        const loadFraction = totalToLoad / currentTotal;

        const cargoManifest: CargoManifest = {};
        for (const resource of lockedBuffer) {
          const amount = Math.floor(resource.amount * loadFraction);
          if (amount > 0) cargoManifest[resource.resourceKey] = amount;
        }

        // Decrement asteroid buffer
        for (const resource of lockedBuffer) {
          const deduct = Math.floor(resource.amount * loadFraction);
          if (deduct <= 0) continue;
          const newAmount = resource.amount - deduct;
          if (newAmount <= 0) {
            await tx
              .delete(asteroidResourceStorage)
              .where(
                and(
                  eq(asteroidResourceStorage.asteroidId, asteroidId),
                  eq(asteroidResourceStorage.resourceKey, resource.resourceKey)
                )
              );
          } else {
            await tx
              .update(asteroidResourceStorage)
              .set({ amount: newAmount })
              .where(
                and(
                  eq(asteroidResourceStorage.asteroidId, asteroidId),
                  eq(asteroidResourceStorage.resourceKey, resource.resourceKey)
                )
              );
          }
        }

        // Update the pre-created return trip with the real cargoManifest
        await tx
          .update(spacecraftTrips)
          .set({ cargoManifest })
          .where(
            and(
              eq(spacecraftTrips.stationSpacecraftId, trip.stationSpacecraftId),
              eq(spacecraftTrips.purpose, 'return'),
              eq(spacecraftTrips.fromType, 'asteroid'),
              eq(spacecraftTrips.fromId, asteroidId),
              eq(spacecraftTrips.toType, 'station'),
              eq(spacecraftTrips.toId, stationId),
              eq(spacecraftTrips.status, 'traveling')
            )
          );
      }
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

export async function checkAndDispatchTransports(stationId: string): Promise<number> {
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

  // Count active outbound transport trips per asteroid so we can calculate
  // how much transport capacity is already en-route (throughput saturation).
  const activeTripRows = await db
    .select({
      asteroidId: spacecraftTrips.toId,
      stationSpacecraftId: spacecraftTrips.stationSpacecraftId,
      groupSize: spacecraftTrips.groupSize,
    })
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.status, 'traveling'),
        eq(spacecraftTrips.toType, 'asteroid'),
        eq(spacecraftTrips.purpose, 'transport'),
        inArray(spacecraftTrips.toId, asteroidIds)
      )
    );

  // Map asteroidId → total active groupSize for capacity calculation
  const activeGroupByAsteroid = new Map<string, number>();
  for (const row of activeTripRows) {
    activeGroupByAsteroid.set(
      row.asteroidId,
      (activeGroupByAsteroid.get(row.asteroidId) ?? 0) + row.groupSize
    );
  }

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
    // Throughput info forwarded to dispatch loop
    totalMiningRate: number;
    distance: number;
  };

  const now = new Date();
  const scored: ScoredAsteroid[] = [];

  for (const aRow of asteroidRows) {
    const resources = bufferByAsteroid.get(aRow.id) ?? [];
    const totalBuffer = resources.reduce((s, r) => s + r.amount, 0);
    const { totalMiningRate } = asteroidMap.get(aRow.id)!;
    const distance = calcDistance({ x: station.x, y: station.y }, { x: aRow.x, y: aRow.y });

    // ── Predictive eligibility ─────────────────────────────────────────────
    // Check eligibility per transporter type using that type's own speed.
    // sortedTransporters is ordered by cargo desc, so larger types are preferred.
    const timeSinceDispatch = now.getTime() - (lastDispatchedAt.get(aRow.id) ?? 0);

    const eligibleTransporter = sortedTransporters.find((t) => {
      const travelHours = distance / (t.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
      const projected = totalBuffer + totalMiningRate * travelHours;
      const isIdeal = projected >= t.cargo * TARGET_FILL;
      const isOpportunistic =
        timeSinceDispatch >= STARVATION_MS && projected >= t.cargo * SOFT_MIN_FILL;

      return (isIdeal || isOpportunistic) && (idleByTransporter.get(t.id) ?? 0) > 0;
    });

    if (!eligibleTransporter) continue;

    // Score uses the projected fill for the eligible transporter type so that
    // distant, high-rate asteroids are ranked correctly against nearby ones.
    const eligibleTravelHours =
      distance / (eligibleTransporter.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
    const projectedBuffer = totalBuffer + totalMiningRate * eligibleTravelHours;
    const projectedFill = projectedBuffer / eligibleTransporter.cargo;
    const score = projectedFill * W_FILL + totalMiningRate * W_RATE - distance * W_DISTANCE;

    scored.push({
      asteroidId: aRow.id,
      x: aRow.x,
      y: aRow.y,
      totalBuffer,
      bufferByResource: resources,
      score,
      totalMiningRate,
      distance,
    });
  }

  // Sort highest priority first
  scored.sort((a, b) => b.score - a.score);

  let dispatched = 0;

  for (const candidate of scored) {
    // ── Transporter selection ──────────────────────────────────────────────
    // Pick the best transporter type based on throughput demand:
    // how many ships does this route need vs. how many are already active?
    const transporter = sortedTransporters.find((t) => {
      const idle = idleByTransporter.get(t.id) ?? 0;
      if (idle <= 0) return false;

      // Projected fill for this specific transporter
      const travelHours = candidate.distance / (t.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
      const projected = candidate.totalBuffer + candidate.totalMiningRate * travelHours;
      return (
        projected >= t.cargo * TARGET_FILL ||
        (now.getTime() - (lastDispatchedAt.get(candidate.asteroidId) ?? 0) >= STARVATION_MS &&
          projected >= t.cargo * SOFT_MIN_FILL)
      );
    });
    if (!transporter) continue;

    // ── Throughput-based groupSize ─────────────────────────────────────────
    // How many transporters does this route need to clear mining output?
    const roundTripHours =
      (candidate.distance / (transporter.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR)) * 2;
    const throughputPerShip = transporter.cargo / roundTripHours; // units/h per ship
    const activeGroups = activeGroupByAsteroid.get(candidate.asteroidId) ?? 0;
    const activeCapacity = activeGroups * throughputPerShip;
    const demandGap = Math.max(0, candidate.totalMiningRate - activeCapacity);
    const additionalNeeded = Math.ceil(demandGap / throughputPerShip);

    const idleCount = idleByTransporter.get(transporter.id)!;
    // Send at most 1 additional ship per tick-iteration to avoid dispatch bursts.
    const groupSize = Math.min(additionalNeeded, idleCount, 1);
    if (groupSize <= 0) continue;

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
        // Guard: if another concurrent dispatch drained the buffer below the
        // opportunistic minimum since our eligibility check, skip this trip.
        if (currentTotal < transporter.cargo * SOFT_MIN_FILL) return;

        // ── Load at arrival, not at dispatch ────────────────────────
        // Buffer is NOT deducted here. The transporter departs with an empty
        // cargoManifest (null). When it arrives at the asteroid, settleTripArrival
        // loads the actual buffer, deducts it, and updates the return trip's
        // cargoManifest. This ensures the transporter carries what is truly
        // available at arrival time (predictive dispatch correctness).

        const distance = calcDistance(
          { x: station.x, y: station.y },
          { x: candidate.x, y: candidate.y }
        );
        const now = new Date();
        const outboundArrivesAt = calcArrivesAt(now, distance, transporter.speed);
        const returnArrivesAt = calcArrivesAt(outboundArrivesAt, distance, transporter.speed);

        // Create both legs up front so the client can animate the full round trip.
        // cargoManifest is null on both legs — filled in at asteroid arrival.
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
            cargoManifest: null,
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
            cargoManifest: null,
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
        activeGroupByAsteroid.set(
          candidate.asteroidId,
          (activeGroupByAsteroid.get(candidate.asteroidId) ?? 0) + groupSize
        );
        lastDispatchedAt.set(candidate.asteroidId, now.getTime());
      });
    } catch (err) {
      console.error({ asteroidId: candidate.asteroidId, err }, 'Transport dispatch failed');
    }
  }

  return dispatched;
}
