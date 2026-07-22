import { and, eq, sql } from 'drizzle-orm';
import { AppError, ErrorCode, type StationInfluence } from '@orions-frontier/shared';
import { getDb } from '../lib/db/index.js';
import { stationInfluence } from '../lib/db/schema/station-influence.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { getUserScannerCoverages, isPointVisible } from './scanner-visibility.service.js';
import { publishUserEvent } from '../lib/realtime.js';

const REQUIRED_POINTS = 1;

export async function addStationInfluence(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  userId: string,
  stationId: string
): Promise<void> {
  await tx
    .insert(stationInfluence)
    .values({ userId, stationId, points: 1 })
    .onConflictDoUpdate({
      target: [stationInfluence.userId, stationInfluence.stationId],
      set: {
        points: sql`${stationInfluence.points} + 1`,
        updatedAt: new Date(),
      },
    });
}

export async function getStationInfluence(
  userId: string,
  stationId: string
): Promise<StationInfluence> {
  const [station, influence, fleet, coverages] = await Promise.all([
    getDb()
      .select({ userId: stations.userId, x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.id, stationId))
      .then((rows) => rows[0]),
    getDb()
      .select({ points: stationInfluence.points })
      .from(stationInfluence)
      .where(and(eq(stationInfluence.userId, userId), eq(stationInfluence.stationId, stationId)))
      .then((rows) => rows[0]),
    getDb()
      .select({
        amount: sql<number>`coalesce(sum(${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount}), 0)::int`,
      })
      .from(stationSpacecrafts)
      .where(eq(stationSpacecrafts.stationId, stationId))
      .then((rows) => rows[0]),
    getUserScannerCoverages(userId),
  ]);
  if (!station || (station.userId !== userId && !isPointVisible(coverages, station))) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
  }
  const points = influence?.points ?? 0;
  const defendingShips = fleet?.amount ?? 0;
  return {
    stationId,
    points,
    requiredPoints: REQUIRED_POINTS,
    defended: defendingShips > 0,
    canTakeOver: station.userId !== userId && points >= REQUIRED_POINTS && defendingShips === 0,
  };
}

export async function takeOverStation(userId: string, stationId: string): Promise<void> {
  const previousOwnerId = await getDb().transaction(async (tx) => {
    const [station] = await tx
      .select({ userId: stations.userId, x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.id, stationId))
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    if (station.userId === userId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Station is already yours');
    }
    const coverages = await getUserScannerCoverages(userId, tx);
    if (!isPointVisible(coverages, station)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    }

    const [influence, fleet] = await Promise.all([
      tx
        .select({ points: stationInfluence.points })
        .from(stationInfluence)
        .where(and(eq(stationInfluence.userId, userId), eq(stationInfluence.stationId, stationId)))
        .for('update')
        .then((rows) => rows[0]),
      tx
        .select({
          amount: sql<number>`coalesce(sum(${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount}), 0)::int`,
        })
        .from(stationSpacecrafts)
        .where(eq(stationSpacecrafts.stationId, stationId))
        .then((rows) => rows[0]),
    ]);
    if ((influence?.points ?? 0) < REQUIRED_POINTS) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Not enough influence');
    }
    if ((fleet?.amount ?? 0) > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Defending spacecraft remain');
    }

    await tx.update(stations).set({ userId }).where(eq(stations.id, stationId));
    await tx.delete(stationInfluence).where(eq(stationInfluence.stationId, stationId));
    return station.userId;
  });
  const payload = { stationId, previousOwnerId, newOwnerId: userId };
  publishUserEvent(previousOwnerId, 'station_ownership_changed', payload);
  publishUserEvent(userId, 'station_ownership_changed', payload);
}
