import { getDb, type Tx } from '../../lib/db/index.js';
import {
  addAssignmentRecallRequest,
  findAsteroid,
  findAsteroidForUpdate,
  insertAsteroidAssignment,
  listAsteroidVeins,
  listStationAssignmentsWithAsteroid,
} from '../../repositories/asteroids.js';
import { insertTrip } from '../../repositories/spacecraft-trips.js';
import {
  findStationSpacecraftByKey,
  reserveSpacecraft,
} from '../../repositories/station-spacecrafts.js';
import { findOwnedStation } from '../../repositories/stations.js';
import { AppError, ErrorCode, type AsteroidSize } from '@orions-frontier/shared';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { getSpacecraft, requireSpacecraft } from '@orions-frontier/game-config';
import { applyTravelSpeed, getStationResearchModifiers } from '../research/index.js';
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

export const createAsteroidAssignment = async (
  params: CreateAssignmentParams,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<{ id: string }> => {
  const db = getDb();
  const { userId, asteroidId, stationId, spacecraftKey, assignedAmount } = params;
  if (!Number.isInteger(assignedAmount) || assignedAmount < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'assignedAmount must be a positive integer');
  }

  // Unscanned asteroids may be mined blind; the scanner only limits what the player knows.
  const [station, asteroid] = await Promise.all([
    findOwnedStation(db, stationId, userId),
    findAsteroid(db, asteroidId),
  ]);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
  // Research reveals veins; an asteroid without a visible one does not exist for this player.
  const { visibleResources } = await getStationResearchModifiers(db, stationId);
  const veins = asteroid ? await listAsteroidVeins(db, asteroidId, visibleResources) : [];
  if (!asteroid || !veins.some((vein) => vein.remainingAmount > 0)) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Asteroid not found');
  }

  const scraft = getSpacecraft(spacecraftKey);
  if (!scraft) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Spacecraft definition not found');
  if (scraft.cargo <= 0 || scraft.miningRate <= 0 || scraft.speed <= 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Spacecraft cannot perform mining trips');
  }

  // Check station has enough available (unlocked) spacecraft of this type
  const stationScraft = await findStationSpacecraftByKey(db, stationId, spacecraftKey);
  if (!stationScraft) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'No spacecraft of this type at station');
  }
  const available = stationScraft.amount - stationScraft.lockedAmount;
  if (available < assignedAmount) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Only ${available} spacecraft available (${assignedAmount} requested)`
    );
  }

  const departedAt = context.now;
  const assignmentId = await db.transaction(async (tx) => {
    if (!(await findAsteroidForUpdate(tx, asteroidId))) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Asteroid not found');
    }
    if (!(await reserveSpacecraft(tx, stationScraft.id, assignedAmount))) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Spacecraft were assigned by another request');
    }
    return launchReservedMiners(
      tx,
      {
        station,
        stationSpacecraftId: stationScraft.id,
        spacecraftKey,
        asteroid,
        amount: assignedAmount,
        departedAt,
      },
      context
    );
  });
  return { id: assignmentId };
};

/** Creates the assignment and its outbound trip for miners already reserved at the station. */
export async function launchReservedMiners(
  tx: Tx,
  params: {
    station: { id: string; x: number; y: number };
    stationSpacecraftId: string;
    spacecraftKey: string;
    asteroid: { id: string; x: number; y: number };
    amount: number;
    departedAt: Date;
  },
  context: GameExecutionContext
): Promise<string> {
  const { station, asteroid, departedAt } = params;
  const assignmentId = await insertAsteroidAssignment(tx, {
    id: context.nextId('assignment'),
    asteroidId: asteroid.id,
    stationId: station.id,
    spacecraftKey: params.spacecraftKey,
    assignedAmount: params.amount,
    assignedAt: departedAt,
    status: 'traveling_to_asteroid',
  });

  // The whole group launches together and fans out around the asteroid on the map.
  const distance = calcDistance(station, asteroid);
  const speed = requireSpacecraft(params.spacecraftKey).speed;
  const baseArrivesAt = calcArrivesAt(departedAt, distance, speed);
  await insertTrip(tx, {
    id: context.nextId('trip'),
    stationSpacecraftId: params.stationSpacecraftId,
    assignmentId,
    groupSize: params.amount,
    fromType: 'station',
    fromId: station.id,
    fromX: station.x,
    fromY: station.y,
    toType: 'asteroid',
    toId: asteroid.id,
    toX: asteroid.x,
    toY: asteroid.y,
    departedAt,
    arrivesAt: await applyTravelSpeed(tx, station.id, baseArrivesAt, departedAt),
    purpose: 'mine',
    createdAt: departedAt,
  });
  return assignmentId;
}

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
  return addAssignmentRecallRequest(db, {
    assignmentId: params.assignmentId,
    asteroidId: params.asteroidId,
    userId: params.userId,
    amount,
    requestedAt: context.now,
  });
};

export interface StationMiningAssignment {
  id: string;
  asteroidId: string;
  asteroidX: number;
  asteroidY: number;
  asteroidSize: AsteroidSize;
  asteroidPrimaryResourceKey: string | null;
  asteroidRemainingAmount: number;
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

  const { visibleResources } = await getStationResearchModifiers(db, stationId);
  const rows = await listStationAssignmentsWithAsteroid(db, stationId, visibleResources);

  return rows.map((r) => ({
    id: r.id,
    asteroidId: r.asteroidId,
    asteroidX: r.asteroidX,
    asteroidY: r.asteroidY,
    asteroidSize: r.asteroidSize,
    asteroidPrimaryResourceKey: r.asteroidPrimaryResourceKey,
    asteroidRemainingAmount: r.asteroidRemainingAmount,
    spacecraftKey: r.spacecraftKey,
    spacecraftName: requireSpacecraft(r.spacecraftKey).name,
    spacecraftMiningRate: requireSpacecraft(r.spacecraftKey).miningRate,
    assignedAmount: r.assignedAmount,
    assignedAt: r.assignedAt.toISOString(),
    status: r.status,
    recallRequestedAt: r.recallRequestedAt?.toISOString() ?? null,
    recallRequestedAmount: r.recallRequestedAmount,
  }));
};
