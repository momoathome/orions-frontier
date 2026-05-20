import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import {
  asteroids,
  asteroidVeins,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stations } from '../../lib/db/schema/stations.js';
import type { AsteroidSize } from '@orions-frontier/shared';
import { WORLD_CONFIG } from '../../lib/world-config.js';

// ============================================================================
// Assignment Service
//
// Manages the full lifecycle of asteroid mining assignments:
//   createAsteroidAssignment   — assign spacecraft to an asteroid (lock ships)
//   removeAsteroidAssignment   — full recall (unlock ships, transfer buffer)
//   updateAsteroidAssignment   — change assigned amount (partial recall or increase)
//   getStationMiningAssignments — list all assignments for a station
//
// transferBufferShareToStation is a private helper used by remove/update to
// credit a proportional slice of the asteroid buffer to the station when
// miners physically return.
// ============================================================================

// ── createAsteroidAssignment ─────────────────────────────────────────────────

export interface CreateAssignmentParams {
  asteroidId: string;
  stationId: string;
  spacecraftDefinitionId: string;
  assignedAmount: number;
}

export interface CreateAssignmentError {
  code:
    | 'ASTEROID_NOT_FOUND'
    | 'SLOTS_FULL'
    | 'STATION_NOT_FOUND'
    | 'SPACECRAFT_NOT_FOUND'
    | 'INSUFFICIENT_SPACECRAFT';
  message: string;
}

export const createAsteroidAssignment = async (
  params: CreateAssignmentParams
): Promise<{ id: string } | CreateAssignmentError> => {
  const db = getDb();
  const { asteroidId, stationId, spacecraftDefinitionId, assignedAmount } = params;

  // Validate asteroid exists
  const [asteroid] = await db
    .select({ id: asteroids.id, size: asteroids.size })
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId))
    .limit(1);
  if (!asteroid) return { code: 'ASTEROID_NOT_FOUND', message: 'Asteroid not found' };

  // Validate station exists
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.id, stationId))
    .limit(1);
  if (!station) return { code: 'STATION_NOT_FOUND', message: 'Station not found' };

  // Validate spacecraft definition exists
  const [scraft] = await db
    .select({ id: spacecraftDefinitions.id })
    .from(spacecraftDefinitions)
    .where(eq(spacecraftDefinitions.id, spacecraftDefinitionId))
    .limit(1);
  if (!scraft) return { code: 'SPACECRAFT_NOT_FOUND', message: 'Spacecraft definition not found' };

  // Check station has enough available (unlocked) spacecraft of this type
  const [stationScraft] = await db
    .select({
      id: stationSpacecrafts.id,
      amount: stationSpacecrafts.amount,
      lockedAmount: stationSpacecrafts.lockedAmount,
    })
    .from(stationSpacecrafts)
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitionId)
      )
    )
    .limit(1);
  if (!stationScraft) {
    return { code: 'INSUFFICIENT_SPACECRAFT', message: 'No spacecraft of this type at station' };
  }
  const available = stationScraft.amount - stationScraft.lockedAmount;
  if (available < assignedAmount) {
    return {
      code: 'INSUFFICIENT_SPACECRAFT',
      message: `Only ${available} spacecraft available (${assignedAmount} requested)`,
    };
  }

  // Slots limit the number of distinct players (stations) per asteroid.
  // A player already present may assign any additional number of miners.
  const maxSlots = WORLD_CONFIG.MINING_SLOTS[asteroid.size] ?? 1;
  const [existingStation] = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(
      and(
        eq(asteroidAssignments.asteroidId, asteroidId),
        eq(asteroidAssignments.stationId, stationId)
      )
    )
    .limit(1);

  if (!existingStation) {
    // New player — check if a slot is still available
    const [slotRow] = await db
      .select({ count: sql<number>`count(distinct station_id)::int` })
      .from(asteroidAssignments)
      .where(eq(asteroidAssignments.asteroidId, asteroidId));
    const usedSlots = slotRow?.count ?? 0;
    if (usedSlots >= maxSlots) {
      return {
        code: 'SLOTS_FULL',
        message: `Asteroid is already claimed by ${usedSlots}/${maxSlots} player(s)`,
      };
    }
  }

  // Same spacecraft type already assigned — increase amount instead of new row
  const [existingByType] = await db
    .select({ id: asteroidAssignments.id, assignedAmount: asteroidAssignments.assignedAmount })
    .from(asteroidAssignments)
    .where(
      and(
        eq(asteroidAssignments.asteroidId, asteroidId),
        eq(asteroidAssignments.stationId, stationId),
        eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitionId)
      )
    )
    .limit(1);

  if (existingByType) {
    const [updated] = await db
      .update(asteroidAssignments)
      .set({ assignedAmount: existingByType.assignedAmount + assignedAmount })
      .where(eq(asteroidAssignments.id, existingByType.id))
      .returning({ id: asteroidAssignments.id });
    await db
      .update(stationSpacecrafts)
      .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${assignedAmount}` })
      .where(eq(stationSpacecrafts.id, stationScraft.id));
    return { id: updated!.id };
  }

  const [inserted] = await db
    .insert(asteroidAssignments)
    .values({ asteroidId, stationId, spacecraftDefinitionId, assignedAmount })
    .returning({ id: asteroidAssignments.id });
  await db
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${assignedAmount}` })
    .where(eq(stationSpacecrafts.id, stationScraft.id));

  return { id: inserted!.id };
};

// ── transferBufferShareToStation (private) ────────────────────────────────────
//
// When miners return to their station they carry a proportional share of the
// asteroid buffer with them (based on their cargo capacity vs. total capacity
// of ALL currently assigned miners).
//
//   recalledCargo   = returning miners' total cargo capacity
//   totalMinerCargo = all assigned miners' total cargo capacity (BEFORE removal)

const transferBufferShareToStation = async (
  asteroidId: string,
  stationId: string,
  recalledCargo: number,
  totalMinerCargo: number
): Promise<void> => {
  if (recalledCargo <= 0 || totalMinerCargo <= 0) return;
  const db = getDb();

  const buffer = await db
    .select()
    .from(asteroidResourceStorage)
    .where(eq(asteroidResourceStorage.asteroidId, asteroidId));

  if (buffer.length === 0) return;

  const totalBuffer = buffer.reduce((s, r) => s + r.amount, 0);
  if (totalBuffer <= 0) return;

  // How much of the buffer do these recalled miners carry back?
  const share = recalledCargo / totalMinerCargo;
  const toCarry = Math.min(recalledCargo, totalBuffer * share);
  if (toCarry <= 0) return;

  await db.transaction(async (tx) => {
    for (const resource of buffer) {
      // Each resource type contributes proportionally to the cargo
      const resourceFraction = resource.amount / totalBuffer;
      const amount = Math.floor(toCarry * resourceFraction);
      if (amount <= 0) continue;

      await tx
        .insert(stationResources)
        .values({ stationId, resourceKey: resource.resourceKey, amount })
        .onConflictDoUpdate({
          target: [stationResources.stationId, stationResources.resourceKey],
          set: { amount: sql`${stationResources.amount} + ${amount}` },
        });

      await tx
        .update(asteroidResourceStorage)
        .set({ amount: sql`GREATEST(0, ${asteroidResourceStorage.amount} - ${amount})` })
        .where(
          and(
            eq(asteroidResourceStorage.asteroidId, asteroidId),
            eq(asteroidResourceStorage.resourceKey, resource.resourceKey)
          )
        );
    }
  });
};

// ── removeAsteroidAssignment ──────────────────────────────────────────────────

export const removeAsteroidAssignment = async (
  assignmentId: string,
  stationId: string
): Promise<boolean> => {
  const db = getDb();

  // Load assignment + spacecraft cargo before deleting
  const [assignment] = await db
    .select({
      asteroidId: asteroidAssignments.asteroidId,
      assignedAmount: asteroidAssignments.assignedAmount,
      spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
      cargo: spacecraftDefinitions.cargo,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(spacecraftDefinitions.id, asteroidAssignments.spacecraftDefinitionId)
    )
    .where(
      and(eq(asteroidAssignments.id, assignmentId), eq(asteroidAssignments.stationId, stationId))
    )
    .limit(1);

  if (!assignment) return false;

  // Total cargo of ALL miners on this asteroid (before deletion, to compute share)
  const allAssignments = await db
    .select({
      assignedAmount: asteroidAssignments.assignedAmount,
      cargo: spacecraftDefinitions.cargo,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(spacecraftDefinitions.id, asteroidAssignments.spacecraftDefinitionId)
    )
    .where(eq(asteroidAssignments.asteroidId, assignment.asteroidId));

  const totalMinerCargo = allAssignments.reduce((s, a) => s + a.assignedAmount * a.cargo, 0);
  const recalledCargo = assignment.assignedAmount * assignment.cargo;

  const result = await db
    .delete(asteroidAssignments)
    .where(
      and(eq(asteroidAssignments.id, assignmentId), eq(asteroidAssignments.stationId, stationId))
    )
    .returning({ id: asteroidAssignments.id });

  if (result.length > 0) {
    await transferBufferShareToStation(
      assignment.asteroidId,
      stationId,
      recalledCargo,
      totalMinerCargo
    );

    await db
      .update(stationSpacecrafts)
      .set({
        lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${assignment.assignedAmount})`,
      })
      .where(
        and(
          eq(stationSpacecrafts.stationId, stationId),
          eq(stationSpacecrafts.spacecraftDefinitionId, assignment.spacecraftDefinitionId)
        )
      );
  }

  return result.length > 0;
};

// ── updateAsteroidAssignment ──────────────────────────────────────────────────

export const updateAsteroidAssignment = async (
  assignmentId: string,
  stationId: string,
  assignedAmount: number
): Promise<{ id: string } | { code: 'INSUFFICIENT_SPACECRAFT'; message: string } | null> => {
  const db = getDb();

  // Load old assignment + cargo
  const [old] = await db
    .select({
      asteroidId: asteroidAssignments.asteroidId,
      assignedAmount: asteroidAssignments.assignedAmount,
      spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
      cargo: spacecraftDefinitions.cargo,
    })
    .from(asteroidAssignments)
    .innerJoin(
      spacecraftDefinitions,
      eq(spacecraftDefinitions.id, asteroidAssignments.spacecraftDefinitionId)
    )
    .where(
      and(eq(asteroidAssignments.id, assignmentId), eq(asteroidAssignments.stationId, stationId))
    )
    .limit(1);

  // If increasing assignment, ensure station has enough available spacecraft
  if (old && assignedAmount > old.assignedAmount) {
    const delta = assignedAmount - old.assignedAmount;
    const [stationScraft] = await db
      .select({
        id: stationSpacecrafts.id,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
      })
      .from(stationSpacecrafts)
      .where(
        and(
          eq(stationSpacecrafts.stationId, stationId),
          eq(stationSpacecrafts.spacecraftDefinitionId, old.spacecraftDefinitionId)
        )
      )
      .limit(1);

    if (!stationScraft) {
      return { code: 'INSUFFICIENT_SPACECRAFT', message: 'No spacecraft of this type at station' };
    }

    const available = stationScraft.amount - stationScraft.lockedAmount;
    if (available < delta) {
      return {
        code: 'INSUFFICIENT_SPACECRAFT',
        message: `Only ${available} spacecraft available (${delta} requested)`,
      };
    }
  }

  const result = await db
    .update(asteroidAssignments)
    .set({ assignedAmount })
    .where(
      and(eq(asteroidAssignments.id, assignmentId), eq(asteroidAssignments.stationId, stationId))
    )
    .returning({ id: asteroidAssignments.id });

  if (result[0] && old) {
    const delta = assignedAmount - old.assignedAmount; // negative = partial recall

    if (delta < 0) {
      const recalledCount = -delta;
      const recalledCargo = recalledCount * old.cargo;

      // Total cargo BEFORE the update (restore delta for this assignment)
      const allAssignments = await db
        .select({
          id: asteroidAssignments.id,
          assignedAmount: asteroidAssignments.assignedAmount,
          cargo: spacecraftDefinitions.cargo,
        })
        .from(asteroidAssignments)
        .innerJoin(
          spacecraftDefinitions,
          eq(spacecraftDefinitions.id, asteroidAssignments.spacecraftDefinitionId)
        )
        .where(eq(asteroidAssignments.asteroidId, old.asteroidId));

      const totalMinerCargo = allAssignments.reduce((s, a) => {
        const amt = a.id === assignmentId ? old.assignedAmount : a.assignedAmount;
        return s + amt * a.cargo;
      }, 0);

      await transferBufferShareToStation(old.asteroidId, stationId, recalledCargo, totalMinerCargo);
    }

    if (delta !== 0) {
      await db
        .update(stationSpacecrafts)
        .set({ lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} + ${delta})` })
        .where(
          and(
            eq(stationSpacecrafts.stationId, stationId),
            eq(stationSpacecrafts.spacecraftDefinitionId, old.spacecraftDefinitionId)
          )
        );
    }
  }

  return result[0] ?? null;
};

// ── getStationMiningAssignments ───────────────────────────────────────────────

export interface StationMiningAssignment {
  id: string;
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidSize: AsteroidSize;
  asteroidStability: number;
  asteroidPrimaryResourceKey: string | null;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  spacecraftMiningRate: number;
  assignedAmount: number;
  assignedAt: string;
  lastTick: string;
}

export const getStationMiningAssignments = async (
  stationId: string
): Promise<StationMiningAssignment[]> => {
  const db = getDb();

  const rows = await db
    .select({
      id: asteroidAssignments.id,
      asteroidId: asteroidAssignments.asteroidId,
      spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
      assignedAmount: asteroidAssignments.assignedAmount,
      assignedAt: asteroidAssignments.assignedAt,
      lastTick: asteroidAssignments.lastTick,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      asteroidSize: asteroids.size,
      asteroidStability: asteroids.stability,
      asteroidPrimaryResourceKey: asteroidVeins.resourceKey,
      spacecraftName: spacecraftDefinitions.name,
      spacecraftMiningRate: spacecraftDefinitions.miningRate,
    })
    .from(asteroidAssignments)
    .innerJoin(asteroids, eq(asteroids.id, asteroidAssignments.asteroidId))
    .innerJoin(
      spacecraftDefinitions,
      eq(spacecraftDefinitions.id, asteroidAssignments.spacecraftDefinitionId)
    )
    .leftJoin(
      asteroidVeins,
      and(
        eq(asteroidVeins.asteroidId, asteroidAssignments.asteroidId),
        eq(asteroidVeins.veinType, 'primary')
      )
    )
    .where(eq(asteroidAssignments.stationId, stationId));

  return rows.map((r) => ({
    id: r.id,
    asteroidId: r.asteroidId,
    asteroidX: r.asteroidX,
    asteroidY: r.asteroidY,
    asteroidSize: r.asteroidSize as AsteroidSize,
    asteroidStability: r.asteroidStability,
    asteroidPrimaryResourceKey: r.asteroidPrimaryResourceKey ?? null,
    spacecraftDefinitionId: r.spacecraftDefinitionId,
    spacecraftName: r.spacecraftName,
    spacecraftMiningRate: r.spacecraftMiningRate,
    assignedAmount: r.assignedAmount,
    assignedAt: r.assignedAt.toISOString(),
    lastTick: r.lastTick.toISOString(),
  }));
};
