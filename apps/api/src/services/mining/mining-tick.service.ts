import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import {
  asteroids,
  asteroidVeins,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { calcMiningRatesByResource } from '../../lib/vein-rates.js';
export type { VeinRateInput } from '../../lib/vein-rates.js';
import { applyAsteroidStabilityTick } from './asteroid-lifecycle.service.js';
import { checkAndDispatchMinerRecall } from './miner-recall.service.js';

// ============================================================================
// Mining Tick Service — Lazy tick production calculation
//
// Production is NOT calculated in real-time. Instead it is triggered on:
//   - Player opens asteroid detail
//   - Player opens station view (ticks all station assignments)
//   - BullMQ cron job every N minutes
//
// Formula per vein (see lib/vein-rates.ts):
//   miningPower  = totalMiningRate × normalizedVeinAllocation
//   rawOutput    = miningPower × purity × deltaHours
//   cappedOutput = min(rawOutput, yieldPerHour × deltaHours)
// ============================================================================

/** Minimum delta to bother calculating (3.6 seconds expressed as hours) */
const MIN_DELTA_HOURS = 0.001;

// ============================================================================
// calculateMiningTick
//
// Calculates and applies one lazy mining tick for a single assignment.
// Updates: assignment lastTick, asteroid_resource_storage (resource production only).
// Stability is NOT updated here — call applyAsteroidStabilityTick separately.
// Returns null if the delta is too small or the assignment/asteroid is missing.
// ============================================================================

export interface TickResult {
  asteroidId: string;
  producedResources: Record<string, number>;
}

export const calculateMiningTick = async (assignmentId: string): Promise<TickResult | null> => {
  const db = getDb();

  // Load assignment
  const [assignment] = await db
    .select()
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.id, assignmentId))
    .limit(1);
  if (!assignment) return null;

  // Skip miners that are currently traveling (not present at the asteroid)
  if (assignment.status !== 'at_asteroid') return null;

  // Load asteroid
  const [asteroid] = await db
    .select()
    .from(asteroids)
    .where(eq(asteroids.id, assignment.asteroidId))
    .limit(1);
  if (!asteroid) return null;

  // Load spacecraft definition for mining rate
  const [scraft] = await db
    .select({ miningRate: spacecraftDefinitions.miningRate })
    .from(spacecraftDefinitions)
    .where(eq(spacecraftDefinitions.id, assignment.spacecraftDefinitionId))
    .limit(1);
  if (!scraft) return null;

  // Delta in hours
  const now = new Date();
  const deltaHours = (now.getTime() - assignment.lastTick.getTime()) / 3_600_000;
  if (deltaHours < MIN_DELTA_HOURS) return null;

  // Load veins
  const veins = await db
    .select()
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroid.id));

  if (veins.length === 0) return null;

  const totalMiningRate = scraft.miningRate * assignment.assignedAmount;

  // calcMiningRatesByResource handles normalization across present veins.
  const ratesByResource = calcMiningRatesByResource(totalMiningRate, veins);
  const producedResources: Record<string, number> = {};
  for (const [key, rate] of Object.entries(ratesByResource)) {
    producedResources[key] = rate * deltaHours;
  }

  // Apply production + lastTick in a transaction (no stability here)
  await db.transaction(async (tx) => {
    // Advance lastTick
    await tx
      .update(asteroidAssignments)
      .set({ lastTick: now })
      .where(eq(asteroidAssignments.id, assignmentId));

    // Upsert produced resources into storage
    for (const [resourceKey, amount] of Object.entries(producedResources)) {
      if (amount <= 0) continue;
      await tx
        .insert(asteroidResourceStorage)
        .values({ asteroidId: asteroid.id, resourceKey, amount, updatedAt: now })
        .onConflictDoUpdate({
          target: [asteroidResourceStorage.asteroidId, asteroidResourceStorage.resourceKey],
          set: {
            amount: sql`${asteroidResourceStorage.amount} + ${amount}`,
            updatedAt: now,
          },
        });
    }
  });

  return { asteroidId: asteroid.id, producedResources };
};

// ============================================================================
// Tick orchestrators
//
// tickAsteroidAssignments — ticks all assignments for one asteroid, applies
//   stability, then checks if buffer is full and dispatches recall if needed.
//   Used when a player opens the asteroid detail view.
//
// tickStationAssignments — ticks all assignments belonging to a station, applies
//   one stability tick per affected asteroid.
//   Used when a player opens the station view.
// ============================================================================

export const tickAsteroidAssignments = async (asteroidId: string): Promise<void> => {
  const db = getDb();
  const assignments = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.asteroidId, asteroidId));

  for (const a of assignments) {
    await calculateMiningTick(a.id);
  }

  await applyAsteroidStabilityTick(asteroidId);
  await checkAndDispatchMinerRecall(asteroidId);
};

export const tickStationAssignments = async (stationId: string): Promise<void> => {
  const db = getDb();
  const assignments = await db
    .select({ id: asteroidAssignments.id, asteroidId: asteroidAssignments.asteroidId })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.stationId, stationId));

  const asteroidIds = new Set<string>();
  for (const a of assignments) {
    await calculateMiningTick(a.id);
    asteroidIds.add(a.asteroidId);
  }

  for (const id of asteroidIds) {
    await applyAsteroidStabilityTick(id);
  }
};

// ============================================================================
// batchCalculateMiningTicks — optimised batch path for the BullMQ worker
//
// Eliminates the N+1 query problem in calculateMiningTick:
//   Old: 4 SELECTs × N assignments  →  4N round trips per tick cycle
//   New: 4 SELECTs total            →  constant round trips regardless of N
//
// Returns a Map of asteroidId → producedResources (for all ticked assignments).
// Only at_asteroid assignments are processed; traveling assignments are skipped.
// ============================================================================

export interface BatchTickResult {
  /** asteroidId → total resources produced across all assignments on it */
  byAsteroid: Map<string, Record<string, number>>;
}

export const batchCalculateMiningTicks = async (
  assignmentIds: string[]
): Promise<BatchTickResult> => {
  const result: BatchTickResult = { byAsteroid: new Map() };
  if (assignmentIds.length === 0) return result;

  const db = getDb();
  const now = new Date();

  // 1. Load all assignments + their spacecraft definition in a single JOIN query.
  const assignmentRows = await db
    .select({
      id: asteroidAssignments.id,
      asteroidId: asteroidAssignments.asteroidId,
      assignedAmount: asteroidAssignments.assignedAmount,
      lastTick: asteroidAssignments.lastTick,
      status: asteroidAssignments.status,
      miningRate: spacecraftDefinitions.miningRate,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(inArray(asteroidAssignments.id, assignmentIds));

  // Filter to at_asteroid only and to meaningful delta
  const active = assignmentRows.filter((a) => {
    if (a.status !== 'at_asteroid') return false;
    const deltaHours = (now.getTime() - a.lastTick.getTime()) / 3_600_000;
    return deltaHours >= MIN_DELTA_HOURS;
  });
  if (active.length === 0) return result;

  // 3. Load all veins for all affected asteroids in a single query.
  const uniqueAsteroidIds = [...new Set(active.map((a) => a.asteroidId))];
  const veinRows = await db
    .select({
      asteroidId: asteroidVeins.asteroidId,
      veinType: asteroidVeins.veinType,
      resourceKey: asteroidVeins.resourceKey,
      yieldPerHour: asteroidVeins.yieldPerHour,
      purity: asteroidVeins.purity,
    })
    .from(asteroidVeins)
    .where(inArray(asteroidVeins.asteroidId, uniqueAsteroidIds));

  // Group veins by asteroidId for O(1) lookup.
  const veinsByAsteroid = new Map<string, typeof veinRows>();
  for (const vein of veinRows) {
    const list = veinsByAsteroid.get(vein.asteroidId) ?? [];
    list.push(vein);
    veinsByAsteroid.set(vein.asteroidId, list);
  }

  // 4. Calculate production for every active assignment in memory.
  //    Accumulate per (asteroidId, resourceKey) so multiple miners on the same
  //    asteroid are merged into one storage upsert.
  const storageAccumulator = new Map<string, Map<string, number>>(); // asteroidId → resourceKey → amount
  const assignmentLastTicks: { id: string; lastTick: Date }[] = [];

  for (const a of active) {
    const veins = veinsByAsteroid.get(a.asteroidId);
    if (!veins || veins.length === 0) continue;

    const deltaHours = (now.getTime() - a.lastTick.getTime()) / 3_600_000;
    const totalMiningRate = a.miningRate * a.assignedAmount;
    const ratesByResource = calcMiningRatesByResource(totalMiningRate, veins);

    const perAsteroid = storageAccumulator.get(a.asteroidId) ?? new Map<string, number>();
    for (const [resourceKey, rate] of Object.entries(ratesByResource)) {
      const produced = rate * deltaHours;
      perAsteroid.set(resourceKey, (perAsteroid.get(resourceKey) ?? 0) + produced);
    }
    storageAccumulator.set(a.asteroidId, perAsteroid);
    assignmentLastTicks.push({ id: a.id, lastTick: now });
  }

  // 5. Write everything in a single transaction:
  //    • Bulk-update lastTick for all ticked assignments
  //    • Upsert into asteroid_resource_storage per (asteroid, resource)
  await db.transaction(async (tx) => {
    // Bulk lastTick update — one UPDATE with CASE … WHEN instead of N updates
    if (assignmentLastTicks.length > 0) {
      await tx
        .update(asteroidAssignments)
        .set({ lastTick: now })
        .where(
          inArray(
            asteroidAssignments.id,
            assignmentLastTicks.map((a) => a.id)
          )
        );
    }

    // Upsert storage accumulators
    for (const [asteroidId, resourceMap] of storageAccumulator) {
      for (const [resourceKey, amount] of resourceMap) {
        if (amount <= 0) continue;
        await tx
          .insert(asteroidResourceStorage)
          .values({ asteroidId, resourceKey, amount, updatedAt: now })
          .onConflictDoUpdate({
            target: [asteroidResourceStorage.asteroidId, asteroidResourceStorage.resourceKey],
            set: {
              amount: sql`${asteroidResourceStorage.amount} + ${amount}`,
              updatedAt: now,
            },
          });
      }

      // Populate result map
      const existing = result.byAsteroid.get(asteroidId) ?? {};
      for (const [resourceKey, amount] of resourceMap) {
        existing[resourceKey] = (existing[resourceKey] ?? 0) + amount;
      }
      result.byAsteroid.set(asteroidId, existing);
    }
  });

  return result;
};
