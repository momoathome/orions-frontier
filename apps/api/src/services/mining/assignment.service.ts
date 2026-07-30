import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidVeins, asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import type { AsteroidSize } from '@orions-frontier/shared';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { getUserScannerCoverages, isPointVisible } from '../scanner-visibility.service.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import { applyVectorNavigation } from '../research-effects.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

// Assignment Service
//
// Manages the full lifecycle of asteroid mining assignments:
//   createAsteroidAssignment   — assign spacecraft to an asteroid (lock ships)
//   requestAsteroidAssignmentRecall — stop selected ships at their next station arrival
//   getStationMiningAssignments — list all assignments for a station

export interface CreateAssignmentParams {
  userId: string;
  asteroidId: string;
  stationId: string;
  spacecraftKey: string;
  assignedAmount: number;
}

export interface CreateAssignmentError {
  code:
    | 'ASTEROID_NOT_FOUND'
    | 'STATION_NOT_FOUND'
    | 'SPACECRAFT_NOT_FOUND'
    | 'INVALID_AMOUNT'
    | 'INSUFFICIENT_SPACECRAFT';
  message: string;
}

export const createAsteroidAssignment = async (
  params: CreateAssignmentParams,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<{ id: string } | CreateAssignmentError> => {
  const db = getDb();
  const { userId, asteroidId, stationId, spacecraftKey, assignedAmount } = params;
  if (!Number.isInteger(assignedAmount) || assignedAmount < 1) {
    return { code: 'INVALID_AMOUNT', message: 'assignedAmount must be a positive integer' };
  }

  const [[station], [asteroid], coverages] = await Promise.all([
    db
      .select({ id: stations.id, x: stations.x, y: stations.y })
      .from(stations)
      .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
      .limit(1),
    db
      .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
      .from(asteroids)
      .where(eq(asteroids.id, asteroidId))
      .limit(1),
    getUserScannerCoverages(userId),
  ]);
  if (!station) return { code: 'STATION_NOT_FOUND', message: 'Station not found' };
  if (!asteroid || !isPointVisible(coverages, asteroid)) {
    return { code: 'ASTEROID_NOT_FOUND', message: 'Asteroid not found' };
  }

  const scraft = getSpacecraft(spacecraftKey);
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
        eq(stationSpacecrafts.spacecraftKey, spacecraftKey)
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

  const departedAt = context.now;
  const distance = calcDistance({ x: station.x, y: station.y }, { x: asteroid.x, y: asteroid.y });
  const created = await db.transaction(async (tx) => {
    const [lockedAsteroid] = await tx
      .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
      .from(asteroids)
      .where(eq(asteroids.id, asteroidId))
      .for('update');
    if (!lockedAsteroid) return { kind: 'asteroid_missing' } as const;
    const currentCoverages = await getUserScannerCoverages(userId, tx);
    if (!isPointVisible(currentCoverages, lockedAsteroid)) {
      return { kind: 'asteroid_missing' } as const;
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

    const baseArrivesAt = calcArrivesAt(departedAt, distance, scraft.speed);
    const arrivesAt = await applyVectorNavigation(tx, stationId, baseArrivesAt, departedAt);

    const [assignment] = await tx
      .insert(asteroidAssignments)
      .values({
        id: context.nextId('assignment'),
        asteroidId,
        stationId,
        spacecraftKey,
        assignedAmount,
        assignedAt: context.now,
        status: 'traveling_to_asteroid',
      })
      .returning({ id: asteroidAssignments.id });

    const [trip] = await tx
      .insert(spacecraftTrips)
      .values({
        id: context.nextId('trip'),
        stationSpacecraftId: stationScraft.id,
        assignmentId: assignment!.id,
        groupSize: assignedAmount,
        fromType: 'station',
        fromId: stationId,
        fromX: station.x,
        fromY: station.y,
        toType: 'asteroid',
        toId: asteroidId,
        toX: asteroid.x,
        toY: asteroid.y,
        departedAt,
        arrivesAt,
        purpose: 'mine',
        createdAt: context.now,
      })
      .returning({ id: spacecraftTrips.id, arrivesAt: spacecraftTrips.arrivesAt });

    return { kind: 'created', assignmentId: assignment!.id, trip: trip! } as const;
  });

  if (created.kind === 'asteroid_missing') {
    return { code: 'ASTEROID_NOT_FOUND', message: 'Asteroid not found' };
  }
  if (created.kind === 'insufficient_spacecraft') {
    return {
      code: 'INSUFFICIENT_SPACECRAFT',
      message: 'Spacecraft were assigned by another request',
    };
  }

  return { id: created.assignmentId };
};

export const requestAsteroidAssignmentRecall = async (
  params: {
    assignmentId: string;
    asteroidId: string;
    userId: string;
    amount?: number;
  },
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<boolean> => {
  const amount = params.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 1) return false;

  const db = getDb();
  const result = await db
    .update(asteroidAssignments)
    .set({
      recallRequestedAt: context.now,
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

export interface StationMiningAssignment {
  id: string;
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidSize: AsteroidSize;
  asteroidPrimaryResourceKey: string | null;
  spacecraftKey: string;
  spacecraftName: string;
  spacecraftMiningRate: number;
  assignedAmount: number;
  assignedAt: string;
  status: 'traveling_to_asteroid' | 'traveling_to_station';
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
      spacecraftKey: asteroidAssignments.spacecraftKey,
      assignedAmount: asteroidAssignments.assignedAmount,
      assignedAt: asteroidAssignments.assignedAt,
      status: asteroidAssignments.status,
      recallRequestedAt: asteroidAssignments.recallRequestedAt,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      asteroidSize: asteroids.size,
      asteroidPrimaryResourceKey: asteroidVeins.resourceKey,
    })
    .from(asteroidAssignments)
    .innerJoin(asteroids, eq(asteroids.id, asteroidAssignments.asteroidId))
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
    spacecraftKey: r.spacecraftKey,
    spacecraftName: getSpacecraft(r.spacecraftKey)!.name,
    spacecraftMiningRate: getSpacecraft(r.spacecraftKey)!.miningRate,
    assignedAmount: r.assignedAmount,
    assignedAt: r.assignedAt.toISOString(),
    status: r.status,
    recallRequestedAt: r.recallRequestedAt?.toISOString() ?? null,
    recallRequestedAmount: r.recallRequestedAmount,
  }));
};
