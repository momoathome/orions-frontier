import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { asteroidResourceStorage } from '../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { stations } from '../../lib/db/schema/stations.js';
import { calcDistance, calcArrivesAt } from '../../lib/travel.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ name: 'transport-dispatch' });

// ============================================================================
// Transport Dispatch Service
//
// checkAndDispatchTransports — for a given station, scores candidate asteroids
// and dispatches idle transporters using predictive fill-rate dispatch.
//
// Dispatch is called by the transport-tick BullMQ worker every minute, and on
// demand from the station dispatch route.
// ============================================================================


// ── Starvation tracker ───────────────────────────────────────────────────────
// Keeps the last successful dispatch timestamp per asteroid (module-level so it
// persists across ticks within the same process lifetime).
const lastDispatchedAt = new Map<string, number>();

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
    .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
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

  // ── Score each asteroid ────────────────────────────────────────────────────
  type ScoredAsteroid = {
    asteroidId: string;
    x: number;
    y: number;
    totalBuffer: number;
    bufferByResource: Array<{ resourceKey: string; amount: number }>;
    score: number;
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
    const timeSinceDispatch = now.getTime() - (lastDispatchedAt.get(aRow.id) ?? 0);

    // Check eligibility per transporter type (prefer larger cargo first)
    const eligibleTransporter = sortedTransporters.find((t) => {
      const travelHours = distance / (t.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
      const projected = totalBuffer + totalMiningRate * travelHours;
      const isIdeal = projected >= t.cargo * WORLD_CONFIG.TRANSPORT_DISPATCH.TARGET_FILL;
      const isOpportunistic =
        timeSinceDispatch >= WORLD_CONFIG.TRANSPORT_DISPATCH.STARVATION_MS &&
        projected >= t.cargo * WORLD_CONFIG.TRANSPORT_DISPATCH.SOFT_MIN_FILL;
      return (isIdeal || isOpportunistic) && (idleByTransporter.get(t.id) ?? 0) > 0;
    });

    if (!eligibleTransporter) continue;

    // Score uses the projected fill for the eligible transporter type
    const eligibleTravelHours =
      distance / (eligibleTransporter.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
    const projectedBuffer = totalBuffer + totalMiningRate * eligibleTravelHours;
    const projectedFill = projectedBuffer / eligibleTransporter.cargo;
    const score =
      projectedFill * WORLD_CONFIG.TRANSPORT_DISPATCH.W_FILL +
      totalMiningRate * WORLD_CONFIG.TRANSPORT_DISPATCH.W_RATE -
      distance * WORLD_CONFIG.TRANSPORT_DISPATCH.W_DISTANCE;

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
    // Pick the best transporter type based on throughput demand
    const transporter = sortedTransporters.find((t) => {
      const idle = idleByTransporter.get(t.id) ?? 0;
      if (idle <= 0) return false;

      const travelHours = candidate.distance / (t.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
      const projected = candidate.totalBuffer + candidate.totalMiningRate * travelHours;
      return (
        projected >= t.cargo * WORLD_CONFIG.TRANSPORT_DISPATCH.TARGET_FILL ||
        (now.getTime() - (lastDispatchedAt.get(candidate.asteroidId) ?? 0) >=
          WORLD_CONFIG.TRANSPORT_DISPATCH.STARVATION_MS &&
          projected >= t.cargo * WORLD_CONFIG.TRANSPORT_DISPATCH.SOFT_MIN_FILL)
      );
    });
    if (!transporter) continue;

    // ── Throughput-based groupSize ─────────────────────────────────────────
    // How many transporters does this route need to clear mining output?
    const roundTripHours =
      (candidate.distance / (transporter.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR)) * 2;
    const throughputPerShip = transporter.cargo / roundTripHours;
    const activeGroups = activeGroupByAsteroid.get(candidate.asteroidId) ?? 0;
    const activeCapacity = activeGroups * throughputPerShip;
    const demandGap = Math.max(0, candidate.totalMiningRate - activeCapacity);
    const additionalNeeded = Math.ceil(demandGap / throughputPerShip);

    const idleCount = idleByTransporter.get(transporter.id)!;
    // Send at most 1 additional ship per tick to avoid dispatch bursts
    const groupSize = Math.min(additionalNeeded, idleCount, 1);
    if (groupSize <= 0) continue;

    try {
      await db.transaction(async (tx) => {
        // Re-read buffer with row lock to guard against concurrent dispatches
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
        if (currentTotal < transporter.cargo * WORLD_CONFIG.TRANSPORT_DISPATCH.SOFT_MIN_FILL) return;

        // Buffer is NOT deducted at dispatch. The transporter departs with
        // cargoManifest=null and loads the actual buffer when it arrives at
        // the asteroid (see handleTransportOutbound in trip-handlers.ts).
        const nowTx = new Date();
        const outboundArrivesAt = calcArrivesAt(nowTx, candidate.distance, transporter.speed);
        const returnArrivesAt = calcArrivesAt(outboundArrivesAt, candidate.distance, transporter.speed);

        // Create both legs up front so the client can animate the full round trip
        await tx.insert(spacecraftTrips).values([
          {
            stationSpacecraftId: transporter.id,
            groupSize,
            fromType: 'station',
            fromId: stationId,
            toType: 'asteroid',
            toId: candidate.asteroidId,
            departedAt: nowTx,
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
          .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${groupSize}` })
          .where(eq(stationSpacecrafts.id, transporter.id));

        dispatched += groupSize;
        idleByTransporter.set(transporter.id, idleCount - groupSize);
        activeGroupByAsteroid.set(
          candidate.asteroidId,
          (activeGroupByAsteroid.get(candidate.asteroidId) ?? 0) + groupSize
        );
        lastDispatchedAt.set(candidate.asteroidId, nowTx.getTime());
      });
    } catch (err) {
      logger.error({ asteroidId: candidate.asteroidId, err }, 'Transport dispatch failed');
    }
  }

  return dispatched;
}
