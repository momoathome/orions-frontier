import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stations } from '../lib/db/schema/stations.js';
import { WORLD_CONFIG } from '../lib/world-config.js';
import { calcDistance, calcArrivesAt } from '../lib/travel.js';

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
// calcVeinRate — shared rate formula, exported for reuse in resource summary
//
// Returns the effective yield per hour for a single vein given:
//   miningPower = totalMiningRate × veinAllocation (already applied by caller)
//   purity      = vein.purity
//   yieldPerHour = vein.yieldPerHour (cap)
//   stability   = asteroid.stability
// ============================================================================

export interface VeinRateInput {
  veinType: string;
  purity: number;
  yieldPerHour: number;
  resourceKey: string;
}

export function calcVeinRate(totalMiningRate: number, vein: VeinRateInput): number {
  const allocation =
    VEIN_ALLOCATION[vein.veinType as keyof typeof VEIN_ALLOCATION] ??
    WORLD_CONFIG.VEIN_MODIFIER.primary;
  const miningPower = totalMiningRate * allocation;
  return (
    Math.min(miningPower * vein.purity, vein.yieldPerHour) * WORLD_CONFIG.MINING_RATE_MULTIPLIER
  );
}

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
  const producedResources: Record<string, number> = {};

  for (const vein of veins) {
    const ratePerHour = calcVeinRate(totalMiningRate, vein);
    const effective = ratePerHour * deltaHours;
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
};;

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

  // Check and dispatch miner self-recall if buffer is full
  await checkAndDispatchMinerRecall(asteroidId);
};

// ============================================================================
// checkAndDispatchMinerRecall
//
// Called after every mining tick (both on-demand and cron).
// If the asteroid buffer is >= total miner cargo capacity (buffer full),
// all at_asteroid miners self-recall: they load the buffer into their cargo
// and fly back to their station. Buffer is cleared atomically (SELECT FOR UPDATE
// equivalent via transaction). Assignments stay in DB — miners return automatically
// after Trip arrival processing in the transport tick worker.
// ============================================================================

export const checkAndDispatchMinerRecall = async (asteroidId: string): Promise<void> => {
  const db = getDb();

  // Load asteroid coordinates
  const [asteroid] = await db
    .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId))
    .limit(1);
  if (!asteroid) return;

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
      await tx.insert(spacecraftTrips).values([
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
      ]);

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
