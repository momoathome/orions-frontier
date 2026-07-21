import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidVeins, asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import type { AsteroidSize } from '@orions-frontier/shared';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { getUserScannerStrength } from '../asteroid.service.js';

// ============================================================================
// Assignment Service
//
// Manages the full lifecycle of asteroid mining assignments:
//   createAsteroidAssignment   — assign spacecraft to an asteroid (lock ships)
//   requestAsteroidAssignmentRecall — stop selected ships at their next station arrival
//   getStationMiningAssignments — list all assignments for a station
// ============================================================================

// ── createAsteroidAssignment ─────────────────────────────────────────────────

export interface CreateAssignmentParams {
  userId: string;
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
    | 'INVALID_AMOUNT'
    | 'INSUFFICIENT_SPACECRAFT';
  message: string;
}

type ScheduleTripArrival = (tripId: string, arrivesAt: Date) => Promise<void>;

export const createAsteroidAssignment = async (
  params: CreateAssignmentParams,
  schedule?: ScheduleTripArrival
): Promise<{ id: string } | CreateAssignmentError> => {
  const db = getDb();
  const { userId, asteroidId, stationId, spacecraftDefinitionId, assignedAmount } = params;
  if (!Number.isInteger(assignedAmount) || assignedAmount < 1) {
    return { code: 'INVALID_AMOUNT', message: 'assignedAmount must be a positive integer' };
  }

  const scannerStrength = await getUserScannerStrength(userId);
  // Validate asteroid exists and is visible to this player.
  const [asteroid] = await db
    .select({ id: asteroids.id, size: asteroids.size, x: asteroids.x, y: asteroids.y })
    .from(asteroids)
    .where(and(eq(asteroids.id, asteroidId), sql`${asteroids.hiddenLevel} <= ${scannerStrength}`))
    .limit(1);
  if (!asteroid) return { code: 'ASTEROID_NOT_FOUND', message: 'Asteroid not found' };

  // Validate that the authenticated player owns the station.
  const [station] = await db
    .select({ id: stations.id, x: stations.x, y: stations.y })
    .from(stations)
    .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
    .limit(1);
  if (!station) return { code: 'STATION_NOT_FOUND', message: 'Station not found' };

  // Validate spacecraft definition exists
  const [scraft] = await db
    .select({
      id: spacecraftDefinitions.id,
      cargo: spacecraftDefinitions.cargo,
      miningRate: spacecraftDefinitions.miningRate,
      speed: spacecraftDefinitions.speed,
    })
    .from(spacecraftDefinitions)
    .where(eq(spacecraftDefinitions.id, spacecraftDefinitionId))
    .limit(1);
  if (!scraft) return { code: 'SPACECRAFT_NOT_FOUND', message: 'Spacecraft definition not found' };
  if (scraft.cargo <= 0 || scraft.miningRate <= 0 || scraft.speed <= 0) {
    return { code: 'SPACECRAFT_NOT_FOUND', message: 'Spacecraft cannot perform mining trips' };
  }

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

  const maxSlots = WORLD_CONFIG.MINING_SLOTS[asteroid.size] ?? 1;
  const departedAt = new Date();
  const distance = calcDistance({ x: station.x, y: station.y }, { x: asteroid.x, y: asteroid.y });
  const arrivesAt = calcArrivesAt(departedAt, distance, scraft.speed);
  const created = await db.transaction(async (tx) => {
    const [lockedAsteroid] = await tx
      .select({ id: asteroids.id })
      .from(asteroids)
      .where(eq(asteroids.id, asteroidId))
      .for('update');
    if (!lockedAsteroid) return { kind: 'asteroid_missing' } as const;

    const [existingStation] = await tx
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
      const [slotRow] = await tx
        .select({ count: sql<number>`count(distinct station_id)::int` })
        .from(asteroidAssignments)
        .where(eq(asteroidAssignments.asteroidId, asteroidId));
      const usedSlots = slotRow?.count ?? 0;
      if (usedSlots >= maxSlots) {
        return { kind: 'slots_full', usedSlots } as const;
      }
    }

    const [locked] = await tx
      .update(stationSpacecrafts)
      .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${assignedAmount}` })
      .where(
        and(
          eq(stationSpacecrafts.id, stationScraft.id),
          sql`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount} >= ${assignedAmount}`
        )
      )
      .returning({ id: stationSpacecrafts.id });

    if (!locked) return { kind: 'insufficient_spacecraft' } as const;

    const [assignment] = await tx
      .insert(asteroidAssignments)
      .values({
        asteroidId,
        stationId,
        spacecraftDefinitionId,
        assignedAmount,
        status: 'traveling_to_asteroid',
      })
      .returning({ id: asteroidAssignments.id });

    const [trip] = await tx
      .insert(spacecraftTrips)
      .values({
        stationSpacecraftId: stationScraft.id,
        assignmentId: assignment!.id,
        groupSize: assignedAmount,
        fromType: 'station',
        fromId: stationId,
        toType: 'asteroid',
        toId: asteroidId,
        departedAt,
        arrivesAt,
        purpose: 'mine',
      })
      .returning({ id: spacecraftTrips.id, arrivesAt: spacecraftTrips.arrivesAt });

    return { kind: 'created', assignmentId: assignment!.id, trip: trip! } as const;
  });

  if (created.kind === 'asteroid_missing') {
    return { code: 'ASTEROID_NOT_FOUND', message: 'Asteroid not found' };
  }
  if (created.kind === 'slots_full') {
    return {
      code: 'SLOTS_FULL',
      message: `Asteroid is already claimed by ${created.usedSlots}/${maxSlots} player(s)`,
    };
  }
  if (created.kind === 'insufficient_spacecraft') {
    return {
      code: 'INSUFFICIENT_SPACECRAFT',
      message: 'Spacecraft were assigned by another request',
    };
  }

  if (schedule) await schedule(created.trip.id, created.trip.arrivesAt);

  return { id: created.assignmentId };
};

// ── requestAsteroidAssignmentRecall ──────────────────────────────────────────

export const requestAsteroidAssignmentRecall = async (params: {
  assignmentId: string;
  asteroidId: string;
  userId: string;
  amount?: number;
}): Promise<boolean> => {
  const amount = params.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 1) return false;

  const db = getDb();
  const result = await db
    .update(asteroidAssignments)
    .set({
      recallRequestedAt: new Date(),
      recallRequestedAmount: sql`${asteroidAssignments.recallRequestedAmount} + ${amount}`,
    })
    .from(stations)
    .where(
      and(
        eq(asteroidAssignments.id, params.assignmentId),
        eq(asteroidAssignments.asteroidId, params.asteroidId),
        eq(asteroidAssignments.stationId, stations.id),
        eq(stations.userId, params.userId),
        sql`${asteroidAssignments.assignedAmount} - ${asteroidAssignments.recallRequestedAmount} >= ${amount}`
      )
    )
    .returning({ id: asteroidAssignments.id });
  return result.length > 0;
};

// ── getStationMiningAssignments ───────────────────────────────────────────────

export interface StationMiningAssignment {
  id: string;
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidSize: AsteroidSize;
  asteroidPrimaryResourceKey: string | null;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  spacecraftMiningRate: number;
  assignedAmount: number;
  assignedAt: string;
  status: 'traveling_to_asteroid' | 'at_asteroid' | 'traveling_to_station';
  recallRequestedAt: string | null;
  recallRequestedAmount: number;
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
      status: asteroidAssignments.status,
      recallRequestedAt: asteroidAssignments.recallRequestedAt,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      asteroidSize: asteroids.size,
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
    asteroidPrimaryResourceKey: r.asteroidPrimaryResourceKey ?? null,
    spacecraftDefinitionId: r.spacecraftDefinitionId,
    spacecraftName: r.spacecraftName,
    spacecraftMiningRate: r.spacecraftMiningRate,
    assignedAmount: r.assignedAmount,
    assignedAt: r.assignedAt.toISOString(),
    status: r.status,
    recallRequestedAt: r.recallRequestedAt?.toISOString() ?? null,
    recallRequestedAmount: r.recallRequestedAmount,
  }));
};
