import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import {
  asteroids,
  asteroidVeins,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
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
  primary: WORLD_CONFIG.VEIN_MODIFIER.primary,
  secondary: WORLD_CONFIG.VEIN_MODIFIER.secondary,
  trace: WORLD_CONFIG.VEIN_MODIFIER.trace,
} as const;

/** Minimum delta to bother calculating (3.6 seconds expressed as hours) */
const MIN_DELTA_HOURS = 0.001;

// ============================================================================
// destroyAsteroid — called when stability reaches 0
// Distributes buffer resources to stations proportional to cargo capacity,
// then cascade-deletes the asteroid.
// ============================================================================

export const destroyAsteroid = async (asteroidId: string): Promise<void> => {
  const db = getDb();

  // Load all assignments with cargo capacity
  const assignments = await db
    .select({
      stationId: asteroidAssignments.stationId,
      assignedAmount: asteroidAssignments.assignedAmount,
      spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
      cargo: spacecraftDefinitions.cargo,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(asteroidAssignments.asteroidId, asteroidId));

  // Load buffer resources
  const buffer = await db
    .select()
    .from(asteroidResourceStorage)
    .where(eq(asteroidResourceStorage.asteroidId, asteroidId));

  // Cargo capacity per station (sum across all assignment rows)
  const cargoByStation = new Map<string, number>();
  for (const a of assignments) {
    cargoByStation.set(
      a.stationId,
      (cargoByStation.get(a.stationId) ?? 0) + a.assignedAmount * a.cargo
    );
  }
  const totalCargo = [...cargoByStation.values()].reduce((s, v) => s + v, 0);

  // Distribute buffer resources to stations proportional to their cargo share
  if (totalCargo > 0 && buffer.length > 0) {
    await db.transaction(async (tx) => {
      for (const resource of buffer) {
        for (const [stationId, stationCargo] of cargoByStation.entries()) {
          // Each station receives its proportional share; excess is lost
          const rawAmount = resource.amount * (stationCargo / totalCargo);
          const amount = Math.floor(rawAmount);
          if (amount <= 0) continue;
          await tx
            .insert(stationResources)
            .values({ stationId, resourceKey: resource.resourceKey, amount })
            .onConflictDoUpdate({
              target: [stationResources.stationId, stationResources.resourceKey],
              set: { amount: sql`${stationResources.amount} + ${amount}` },
            });
        }
      }
    });
  }

  // Release spacecraft locks for all assignments before cascade-delete
  for (const a of assignments) {
    await db
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

  // Cascade-delete: veins, storage, assignments are deleted automatically
  await db.delete(asteroids).where(eq(asteroids.id, asteroidId));
};

export interface TickResult {
  asteroidId: string;
  producedResources: Record<string, number>;
}

/**
 * Calculates and applies one lazy mining tick for a single assignment.
 * Updates: assignment lastTick, asteroid_resource_storage (resource production only).
 * Stability is NOT updated here — call applyAsteroidStabilityTick separately.
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

  for (const vein of veins) {
    const veinKey = vein.veinType as keyof typeof VEIN_ALLOCATION;
    const allocation = VEIN_ALLOCATION[veinKey] ?? WORLD_CONFIG.VEIN_MODIFIER.primary;

    const miningPower = totalMiningRate * allocation;
    const rawOutput = miningPower * vein.purity * deltaHours;
    const yieldCap = vein.yieldPerHour * deltaHours;
    const cappedOutput = Math.min(rawOutput, yieldCap);
    const effective = cappedOutput * asteroid.stability;

    producedResources[vein.resourceKey] = (producedResources[vein.resourceKey] ?? 0) + effective;
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

/**
 * Applies a single stability tick for one asteroid based on ALL assignments combined.
 * Uses asteroid.updatedAt as the last-stability-tick anchor.
 * Should be called once per asteroid after all assignment production ticks.
 */
export const applyAsteroidStabilityTick = async (asteroidId: string): Promise<void> => {
  const db = getDb();
  const now = new Date();

  const [asteroid] = await db.select().from(asteroids).where(eq(asteroids.id, asteroidId)).limit(1);
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

  let totalMiningLoad = 0;
  let totalYieldCap = 0;
  for (const vein of veins) {
    const allocation =
      VEIN_ALLOCATION[vein.veinType as keyof typeof VEIN_ALLOCATION] ??
      WORLD_CONFIG.VEIN_MODIFIER.primary;
    totalMiningLoad += combinedMiningRate * allocation;
    totalYieldCap += vein.yieldPerHour;
  }

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

  // Asteroid destroyed when stability hits 0
  if (newStability <= 0) {
    await destroyAsteroid(asteroidId);
    return;
  }

  await db
    .update(asteroids)
    .set({ stability: newStability, updatedAt: now })
    .where(eq(asteroids.id, asteroidId));
};

/**
 * Ticks all active assignments for a given asteroid (production only),
 * then applies a single stability tick for the asteroid.
 * After the stability tick, checks if the buffer is full (>= total miner cargo)
 * and triggers an auto-recall if so: resources are distributed to stations,
 * assignments are deleted, and spacecraft locks are released.
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

  // One stability update for the whole asteroid (may destroy it)
  await applyAsteroidStabilityTick(asteroidId);

  // ── Auto-recall check ─────────────────────────────────────────────────────
  // If totalBuffer >= totalMinerCargo all miners are "full" and fly back.

  // Re-load assignments after stability tick (asteroid might have been destroyed)
  const currentAssignments = await db
    .select({
      id: asteroidAssignments.id,
      stationId: asteroidAssignments.stationId,
      spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
      assignedAmount: asteroidAssignments.assignedAmount,
      cargo: spacecraftDefinitions.cargo,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(asteroidAssignments.asteroidId, asteroidId));

  if (currentAssignments.length === 0) return;

  const totalMinerCargo = currentAssignments.reduce((s, a) => s + a.assignedAmount * a.cargo, 0);

  const buffer = await db
    .select()
    .from(asteroidResourceStorage)
    .where(eq(asteroidResourceStorage.asteroidId, asteroidId));

  const totalBuffer = buffer.reduce((s, r) => s + r.amount, 0);

  if (totalBuffer < totalMinerCargo) return;

  // Buffer is full → auto-recall all miners
  // Distribute buffer proportionally by cargo share (same logic as destroyAsteroid)
  const cargoByStation = new Map<string, number>();
  for (const a of currentAssignments) {
    cargoByStation.set(
      a.stationId,
      (cargoByStation.get(a.stationId) ?? 0) + a.assignedAmount * a.cargo
    );
  }

  await db.transaction(async (tx) => {
    for (const resource of buffer) {
      for (const [sid, stationCargo] of cargoByStation.entries()) {
        const rawAmount = resource.amount * (stationCargo / totalMinerCargo);
        const amount = Math.floor(rawAmount);
        if (amount <= 0) continue;
        await tx
          .insert(stationResources)
          .values({ stationId: sid, resourceKey: resource.resourceKey, amount })
          .onConflictDoUpdate({
            target: [stationResources.stationId, stationResources.resourceKey],
            set: { amount: sql`${stationResources.amount} + ${amount}` },
          });
      }
    }
    // Clear the asteroid buffer
    await tx
      .delete(asteroidResourceStorage)
      .where(eq(asteroidResourceStorage.asteroidId, asteroidId));
  });

  // Release spacecraft locks and remove all assignments
  for (const a of currentAssignments) {
    await db
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
    await db.delete(asteroidAssignments).where(eq(asteroidAssignments.id, a.id));
  }
};

/**
 * Ticks all active assignments belonging to a station (production only),
 * then applies one stability tick per affected asteroid.
 * Used when a player opens the station view.
 */
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
