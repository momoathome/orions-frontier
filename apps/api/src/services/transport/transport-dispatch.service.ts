import { and, eq, inArray, max, min, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidAssignments, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { asteroidResourceStorage } from '../../lib/db/schema/asteroids.js';
import { calcMiningRatesByResource, type VeinRateInput } from '../../lib/vein-rates.js';
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

  // Build nominal mining power per asteroid (miningRate × assignedAmount).
  // The actual effective yield is computed after vein data is loaded so we can
  // apply yield caps, purity, and single-vein normalisation via calcMiningRatesByResource.
  const nominalPowerMap = new Map<string, number>();
  for (const row of asteroidCandidates) {
    nominalPowerMap.set(
      row.asteroidId,
      (nominalPowerMap.get(row.asteroidId) ?? 0) + row.miningRate * row.assignedAmount
    );
  }

  if (nominalPowerMap.size === 0) return 0;

  const asteroidIds = [...nominalPowerMap.keys()];
  const asteroidRows = await db
    .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
    .from(asteroids)
    .where(inArray(asteroids.id, asteroidIds));

  // Count committed transport capacity per asteroid: both outbound trips (heading
  // to the asteroid) and return-leg trips (heading back to station). Not counting
  // return-leg ships caused the dispatcher to see 0 active capacity the moment a
  // ship finished its outbound leg and immediately send another one.
  //
  // Also load last dispatch timestamps from the DB so starvation tracking survives
  // process restarts (previously an in-memory Map that reset to epoch on restart).
  const [activeTripRows, , lastDispatchRows, veinRows, miningStartRows] = await Promise.all([
    db
      .select({
        asteroidId: spacecraftTrips.toId,
        groupSize: spacecraftTrips.groupSize,
        cargo: spacecraftDefinitions.cargo,
      })
      .from(spacecraftTrips)
      .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
      .innerJoin(
        spacecraftDefinitions,
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(
        and(
          eq(spacecraftTrips.status, 'traveling'),
          eq(spacecraftTrips.toType, 'asteroid'),
          eq(spacecraftTrips.purpose, 'transport'),
          inArray(spacecraftTrips.toId, asteroidIds)
        )
      ),
    db
      .select({
        asteroidId: spacecraftTrips.fromId,
        groupSize: spacecraftTrips.groupSize,
        cargo: spacecraftDefinitions.cargo,
      })
      .from(spacecraftTrips)
      .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
      .innerJoin(
        spacecraftDefinitions,
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(
        and(
          eq(spacecraftTrips.status, 'traveling'),
          eq(spacecraftTrips.fromType, 'asteroid'),
          eq(spacecraftTrips.purpose, 'return'),
          inArray(spacecraftTrips.fromId, asteroidIds)
        )
      ),
    db
      .select({
        asteroidId: spacecraftTrips.toId,
        lastAt: max(spacecraftTrips.departedAt),
      })
      .from(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.toType, 'asteroid'),
          eq(spacecraftTrips.purpose, 'transport'),
          inArray(spacecraftTrips.toId, asteroidIds)
        )
      )
      .groupBy(spacecraftTrips.toId),
    db
      .select({
        asteroidId: asteroidVeins.asteroidId,
        veinType: asteroidVeins.veinType,
        resourceKey: asteroidVeins.resourceKey,
        yieldPerHour: asteroidVeins.yieldPerHour,
        purity: asteroidVeins.purity,
      })
      .from(asteroidVeins)
      .where(inArray(asteroidVeins.asteroidId, asteroidIds)),
    db
      .select({
        asteroidId: asteroidAssignments.asteroidId,
        minAssignedAt: min(asteroidAssignments.assignedAt),
      })
      .from(asteroidAssignments)
      .where(inArray(asteroidAssignments.asteroidId, asteroidIds))
      .groupBy(asteroidAssignments.asteroidId),
  ]);

  // Only OUTBOUND ships (heading to the asteroid) represent future buffer pickup.
  // Return ships have already loaded their cargo and won't deplete the buffer again,
  // so counting them as committed capacity would overstate how much is already covered.
  const outboundCargoByAsteroid = new Map<string, number>();
  for (const row of activeTripRows) {
    outboundCargoByAsteroid.set(
      row.asteroidId,
      (outboundCargoByAsteroid.get(row.asteroidId) ?? 0) + row.groupSize * row.cargo
    );
  }

  // Map asteroidId → timestamp of last successful dispatch (DB-backed).
  // For asteroids that have never been dispatched, fall back to min(assignedAt)
  // so the starvation timer starts from when mining began, not from epoch 0.
  const miningStartedAtByAsteroid = new Map<string, number>(
    miningStartRows
      .filter((r) => r.minAssignedAt != null)
      .map((r) => [r.asteroidId, new Date(r.minAssignedAt!).getTime()])
  );
  const lastDispatchedAtByAsteroid = new Map<string, number>(
    lastDispatchRows
      .filter((r) => r.lastAt != null)
      .map((r) => [r.asteroidId, new Date(r.lastAt!).getTime()])
  );

  // Compute effective mining rate per asteroid using actual vein yield caps + purity.
  // calcMiningRatesByResource normalises allocation so single-vein asteroids receive
  // 100% of mining power (no 0.70 primary-vein penalty), matching the mining-tick logic.
  const veinsByAsteroid = new Map<string, VeinRateInput[]>();
  for (const row of veinRows) {
    const list = veinsByAsteroid.get(row.asteroidId) ?? [];
    list.push(row);
    veinsByAsteroid.set(row.asteroidId, list);
  }
  const asteroidMap = new Map<string, { totalMiningRate: number }>();
  for (const [asteroidId, nominalPower] of nominalPowerMap) {
    const veins = veinsByAsteroid.get(asteroidId) ?? [];
    const byResource = calcMiningRatesByResource(nominalPower, veins);
    const effectiveTotal = Object.values(byResource).reduce((s, r) => s + r, 0);
    if (effectiveTotal === 0 && nominalPower > 0) {
      logger.warn(
        { asteroidId, nominalPower, veinCount: veins.length },
        'Asteroid has miners but zero effective yield — vein data may be missing'
      );
    }
    asteroidMap.set(asteroidId, { totalMiningRate: effectiveTotal });
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
    // Fallback chain: last dispatch → min(assignedAt) → now (never starve immediately)
    const dispatchAnchor =
      lastDispatchedAtByAsteroid.get(aRow.id) ??
      miningStartedAtByAsteroid.get(aRow.id) ??
      now.getTime();
    const timeSinceDispatch = now.getTime() - dispatchAnchor;

    // Check eligibility per transporter type (prefer larger cargo first).
    // Subtract already-committed outbound cargo from the projected buffer so that
    // a second ship doesn't qualify based on cargo that the first ship will load.
    const outboundCargo = outboundCargoByAsteroid.get(aRow.id) ?? 0;
    const eligibleTransporter = sortedTransporters.find((t) => {
      const travelHours = distance / (t.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
      const projectedBuffer = Math.max(
        0,
        totalBuffer + totalMiningRate * travelHours - outboundCargo
      );
      const projectedFill = projectedBuffer / t.cargo;
      const isIdeal = projectedFill >= WORLD_CONFIG.TRANSPORT_DISPATCH.TARGET_FILL;
      // Starvation dispatch: asteroid hasn't received a pickup in a while but has
      // some buffer — send anyway at a lower fill threshold.
      const isOpportunistic =
        timeSinceDispatch >= WORLD_CONFIG.TRANSPORT_DISPATCH.STARVATION_MS &&
        totalBuffer > 0 &&
        projectedFill >= WORLD_CONFIG.TRANSPORT_DISPATCH.SOFT_MIN_FILL;
      return (isIdeal || isOpportunistic) && (idleByTransporter.get(t.id) ?? 0) > 0;
    });

    if (!eligibleTransporter) continue;

    // Score = projected fill × W_FILL − normalised distance × W_DISTANCE.
    // Projected fill already encodes both the current buffer and mining rate, so
    // no separate W_RATE term is needed. Distance is normalised by DISTANCE_REFERENCE
    // so all three factors contribute on comparable scales.
    const eligibleTravelHours =
      distance / (eligibleTransporter.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
    const projectedBufferForScore = Math.max(
      0,
      totalBuffer + totalMiningRate * eligibleTravelHours - outboundCargo
    );
    const projectedFillForScore = projectedBufferForScore / eligibleTransporter.cargo;
    const score =
      projectedFillForScore * WORLD_CONFIG.TRANSPORT_DISPATCH.W_FILL -
      (distance / WORLD_CONFIG.TRANSPORT_DISPATCH.DISTANCE_REFERENCE) *
        WORLD_CONFIG.TRANSPORT_DISPATCH.W_DISTANCE;

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
    // Pick the best transporter type — same projected-fill-minus-outbound check as scoring loop.
    const candidateOutboundCargo = outboundCargoByAsteroid.get(candidate.asteroidId) ?? 0;
    const transporter = sortedTransporters.find((t) => {
      const idle = idleByTransporter.get(t.id) ?? 0;
      if (idle <= 0) return false;

      const travelHours = candidate.distance / (t.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
      const projectedBuffer = Math.max(
        0,
        candidate.totalBuffer + candidate.totalMiningRate * travelHours - candidateOutboundCargo
      );
      const projectedFill = projectedBuffer / t.cargo;
      const candidateAnchor =
        lastDispatchedAtByAsteroid.get(candidate.asteroidId) ??
        miningStartedAtByAsteroid.get(candidate.asteroidId) ??
        now.getTime();
      return (
        projectedFill >= WORLD_CONFIG.TRANSPORT_DISPATCH.TARGET_FILL ||
        (now.getTime() - candidateAnchor >= WORLD_CONFIG.TRANSPORT_DISPATCH.STARVATION_MS &&
          candidate.totalBuffer > 0 &&
          projectedFill >= WORLD_CONFIG.TRANSPORT_DISPATCH.SOFT_MIN_FILL)
      );
    });
    if (!transporter) continue;

    // ── Throughput-based groupSize ─────────────────────────────────────────
    // How many transporters does this route need to clear mining output?
    const roundTripHours =
      (candidate.distance / (transporter.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR)) * 2;
    const throughputPerShip = transporter.cargo / roundTripHours;
    // Only outbound ships represent uncommitted future pickups — return ships have
    // already loaded and don't contribute to upcoming buffer capacity.
    const activeCapacity = candidateOutboundCargo / roundTripHours;
    const demandGap = Math.max(0, candidate.totalMiningRate - activeCapacity);
    const additionalNeeded = Math.ceil(demandGap / throughputPerShip);

    const idleCount = idleByTransporter.get(transporter.id)!;
    // Send at most 1 additional ship per tick to avoid dispatch bursts
    const groupSize = Math.min(additionalNeeded, idleCount, 1);
    if (groupSize <= 0) continue;

    const nowTx = new Date();
    let didDispatch = false;
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
        // Guard: re-check projected fill with the freshly locked buffer. If the
        // buffer was emptied by a concurrent dispatch (or miners left), abort.
        const txTravelHours =
          candidate.distance / (transporter.speed * WORLD_CONFIG.TRAVEL_SPEED_FACTOR);
        // Use the in-memory outbound cargo (already updated by prior dispatches this tick).
        const txOutboundCargo = outboundCargoByAsteroid.get(candidate.asteroidId) ?? 0;
        const txProjectedBuffer = Math.max(
          0,
          currentTotal + candidate.totalMiningRate * txTravelHours - txOutboundCargo
        );
        const txProjectedFill = txProjectedBuffer / transporter.cargo;
        if (txProjectedFill < WORLD_CONFIG.TRANSPORT_DISPATCH.SOFT_MIN_FILL) return;

        // Buffer is NOT deducted at dispatch. The transporter departs with
        // cargoManifest=null and loads the actual buffer when it arrives at
        // the asteroid (see handleTransportOutbound in trip-handlers.ts).
        const outboundArrivesAt = calcArrivesAt(nowTx, candidate.distance, transporter.speed);
        const returnArrivesAt = calcArrivesAt(
          outboundArrivesAt,
          candidate.distance,
          transporter.speed
        );

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

        didDispatch = true;
      });
    } catch (err) {
      logger.error({ asteroidId: candidate.asteroidId, err }, 'Transport dispatch failed');
    }
    // Mutations only run if the DB transaction committed. Keeping them outside the
    // transaction callback prevents state corruption when the transaction is rolled back.
    if (didDispatch) {
      dispatched += groupSize;
      idleByTransporter.set(transporter.id, idleCount - groupSize);
      outboundCargoByAsteroid.set(
        candidate.asteroidId,
        (outboundCargoByAsteroid.get(candidate.asteroidId) ?? 0) + groupSize * transporter.cargo
      );
      lastDispatchedAtByAsteroid.set(candidate.asteroidId, nowTx.getTime());
    }
  }

  return dispatched;
}
