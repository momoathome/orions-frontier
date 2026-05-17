import { eq, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import {
  asteroids,
  asteroidVeins,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { WORLD_CONFIG } from '../lib/world-config.js';

// ============================================================================
// Mining Tick Service — Lazy tick production calculation
//
// Production is NOT calculated in real-time. Instead it is triggered on:
//   - Player opens asteroid detail
//   - Player opens station view (ticks all station assignments)
//   - BullMQ cron job every N minutes
//
// Formula per vein:
//   miningPower  = totalMiningRate × veinAllocation
//   rawOutput    = miningPower × purity × deltaHours
//   cappedOutput = min(rawOutput, yieldPerHour × deltaHours)
//   effective    = cappedOutput × stability
// ============================================================================

const VEIN_ALLOCATION = {
  primary:   WORLD_CONFIG.VEIN_MODIFIER.primary,
  secondary: WORLD_CONFIG.VEIN_MODIFIER.secondary,
  trace:     WORLD_CONFIG.VEIN_MODIFIER.trace,
} as const;

/** Minimum delta to bother calculating (3.6 seconds expressed as hours) */
const MIN_DELTA_HOURS = 0.001;

export interface TickResult {
  asteroidId: string;
  producedResources: Record<string, number>;
  newStability: number;
}

/**
 * Calculates and applies one lazy mining tick for a single assignment.
 * Updates: asteroid stability, assignment lastTick, asteroid_resource_storage.
 * Returns null if the delta is too small or the assignment/asteroid is missing.
 */
export const calculateMiningTick = async (assignmentId: string): Promise<TickResult | null> => {
  const db = getDb();

  // Load assignment
  const [assignment] = await db
    .select()
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.id, assignmentId))
    .limit(1);
  if (!assignment) return null;

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
  const producedResources: Record<string, number> = {};
  let totalMiningLoad = 0;
  let totalYieldCap = 0;

  for (const vein of veins) {
    const veinKey = vein.veinType as keyof typeof VEIN_ALLOCATION;
    const allocation = VEIN_ALLOCATION[veinKey] ?? WORLD_CONFIG.VEIN_MODIFIER.primary;

    const miningPower  = totalMiningRate * allocation;
    const rawOutput    = miningPower * vein.purity * deltaHours;
    const yieldCap     = vein.yieldPerHour * deltaHours;
    const cappedOutput = Math.min(rawOutput, yieldCap);
    const effective    = cappedOutput * asteroid.stability;

    producedResources[vein.resourceKey] =
      (producedResources[vein.resourceKey] ?? 0) + effective;

    totalMiningLoad += miningPower;
    totalYieldCap   += yieldCap;
  }

  // Stability update
  let newStability = asteroid.stability;
  if (totalYieldCap > 0 && totalMiningLoad > totalYieldCap) {
    const overRatio = totalMiningLoad / totalYieldCap;
    newStability -= WORLD_CONFIG.STABILITY_DEGRADATION_PER_HOUR * deltaHours * overRatio;
  } else {
    newStability += WORLD_CONFIG.STABILITY_REGEN_PER_HOUR * deltaHours;
  }
  newStability = Math.max(
    WORLD_CONFIG.STABILITY_FLOOR,
    Math.min(1.0, newStability),
  );

  // Apply all changes in a transaction
  await db.transaction(async (tx) => {
    // Update asteroid stability
    await tx
      .update(asteroids)
      .set({ stability: newStability, updatedAt: now })
      .where(eq(asteroids.id, asteroid.id));

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

  return { asteroidId: asteroid.id, producedResources, newStability };
};

/**
 * Ticks all active assignments for a given asteroid.
 * Used when a player opens the asteroid detail view.
 */
export const tickAsteroidAssignments = async (asteroidId: string): Promise<void> => {
  const db = getDb();
  const assignments = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.asteroidId, asteroidId));

  for (const a of assignments) {
    await calculateMiningTick(a.id);
  }
};

/**
 * Ticks all active assignments belonging to a station.
 * Used when a player opens the station view.
 */
export const tickStationAssignments = async (stationId: string): Promise<void> => {
  const db = getDb();
  const assignments = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.stationId, stationId));

  for (const a of assignments) {
    await calculateMiningTick(a.id);
  }
};
