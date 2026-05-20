import { eq, sql } from 'drizzle-orm';
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
