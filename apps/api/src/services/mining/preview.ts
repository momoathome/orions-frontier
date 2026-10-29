import { and, eq, isNull, sql } from 'drizzle-orm';
import { getSpacecraft } from '@orions-frontier/game-config';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { calculateMiningCycle } from '../../lib/mining-cycle.js';
import { calcDistance } from '../../lib/travel.js';
import {
  getUserRevealedAsteroidIds,
  getUserScannerCoverages,
  isPointVisible,
} from '../map/index.js';
import {
  effectiveCargoCapacity,
  effectiveMiningRate,
  hasCompletedResearch,
} from '../research/index.js';

export interface MiningPreviewInput {
  userId: string;
  asteroidId: string;
  stationId: string;
  spacecraftKey: string;
  minerCount: number;
}

/** Mining cycle preview for a station's miners on an asteroid; the reserve stays hidden unless scanned. */
export async function getMiningPreview({
  userId,
  asteroidId,
  stationId,
  spacecraftKey,
  minerCount,
}: MiningPreviewInput) {
  const db = getDb();
  const spacecraft = getSpacecraft(spacecraftKey);
  if (!spacecraft) return { ok: false, status: 404, message: 'Spacecraft not found' } as const;
  const [[row], coverages, revealedIds] = await Promise.all([
    db
      .select({
        stationX: stations.x,
        stationY: stations.y,
        asteroidX: asteroids.x,
        asteroidY: asteroids.y,
        available: sql<number>`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount}`,
      })
      .from(stations)
      .innerJoin(
        stationSpacecrafts,
        and(
          eq(stationSpacecrafts.stationId, stations.id),
          eq(stationSpacecrafts.spacecraftKey, spacecraftKey)
        )
      )
      .innerJoin(asteroids, eq(asteroids.id, asteroidId))
      .where(
        and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
      )
      .limit(1),
    getUserScannerCoverages(userId),
    getUserRevealedAsteroidIds(userId),
  ]);

  if (!row) {
    return { ok: false, status: 404, message: 'Station, miner or asteroid not found' } as const;
  }
  if (spacecraft.speed <= 0 || spacecraft.miningRate <= 0 || spacecraft.cargo <= 0) {
    return {
      ok: false,
      status: 400,
      message: 'Selected spacecraft cannot perform mining trips',
    } as const;
  }
  if (minerCount > row.available) {
    return { ok: false, status: 400, message: `Only ${row.available} miners available` } as const;
  }

  const [reserve] = await db
    .select({ amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::int` })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId));
  const remainingAmount = reserve?.amount ?? 0;
  const scanned =
    revealedIds.has(asteroidId) ||
    isPointVisible(coverages, { x: row.asteroidX, y: row.asteroidY });
  const distance = calcDistance(
    { x: row.stationX, y: row.stationY },
    { x: row.asteroidX, y: row.asteroidY }
  );
  const effectiveRate = await effectiveMiningRate(db, stationId, spacecraft.miningRate);
  const effectiveCargo = await effectiveCargoCapacity(db, stationId, spacecraft.cargo);
  const hasVectorNav = await hasCompletedResearch(db, stationId, 'vector_navigation');
  const effectiveSpeed = hasVectorNav ? spacecraft.speed / 0.9 : spacecraft.speed;

  const cycle = calculateMiningCycle({
    distance,
    speed: effectiveSpeed,
    miningRate: effectiveRate,
    cargoCapacity: effectiveCargo,
    minerCount,
    remainingAmount,
  });

  // Blind mining: timing is known, the reserve is not.
  const preview = scanned
    ? {
        distance,
        speed: spacecraft.speed,
        miningRate: effectiveRate,
        cargoCapacity: effectiveCargo,
        remainingAmount,
        ...cycle,
      }
    : {
        distance,
        speed: spacecraft.speed,
        miningRate: effectiveRate,
        cargoCapacity: effectiveCargo,
        ...cycle,
        remainingAmount: null,
        estimatedDepletionHours: null,
        finalBatchAmount: null,
      };
  return { ok: true, preview } as const;
}
