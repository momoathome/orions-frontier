import { getSpacecraft } from '@orions-frontier/game-config';
import { getDb } from '../../lib/db/index.js';
import { findMiningRoute, getUserScannerCoverages } from '../station/index.js';
import { calculateMiningCycle } from '../../lib/mining-cycle.js';
import { calcDistance } from '../../lib/travel.js';
import {
  findVisibleAsteroid,
  getUserRevealedAsteroidIds,
  isPointVisible,
  sumAsteroidRemainingAmount,
} from '../map/index.js';
import { getStationResearchModifiers } from '../research/index.js';

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
  const modifiers = await getStationResearchModifiers(db, stationId);
  const [row, visibleAsteroid, coverages, revealedIds] = await Promise.all([
    findMiningRoute(db, { stationId, userId, spacecraftKey, asteroidId }),
    // Same rule as the asteroid detail: without visible ore left the asteroid does not exist.
    findVisibleAsteroid(db, asteroidId, modifiers.visibleResources),
    getUserScannerCoverages(userId),
    getUserRevealedAsteroidIds(userId),
  ]);

  if (!row || !visibleAsteroid) {
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

  const remainingAmount = await sumAsteroidRemainingAmount(
    db,
    asteroidId,
    modifiers.visibleResources
  );
  const scanned =
    revealedIds.has(asteroidId) ||
    isPointVisible(coverages, { x: row.asteroidX, y: row.asteroidY });
  const distance = calcDistance(
    { x: row.stationX, y: row.stationY },
    { x: row.asteroidX, y: row.asteroidY }
  );
  const effectiveRate = spacecraft.miningRate * modifiers.miningRate;
  const effectiveCargo = spacecraft.cargo * modifiers.cargo;
  const effectiveSpeed = spacecraft.speed * modifiers.speed;

  const mined = calculateMiningCycle({
    distance,
    speed: effectiveSpeed,
    miningRate: effectiveRate,
    cargoCapacity: effectiveCargo,
    minerCount,
    remainingAmount,
  });
  // Deep Core Drilling raises what arrives, not what the asteroid loses.
  const cycle = {
    ...mined,
    deliveryPerHourPerMiner: mined.deliveryPerHourPerMiner * modifiers.yield,
    totalDeliveryPerHour: mined.totalDeliveryPerHour * modifiers.yield,
  };

  // Blind mining: timing is known, the reserve is not.
  const preview = scanned
    ? {
        distance,
        speed: effectiveSpeed,
        miningRate: effectiveRate,
        cargoCapacity: effectiveCargo,
        remainingAmount,
        ...cycle,
      }
    : {
        distance,
        speed: effectiveSpeed,
        miningRate: effectiveRate,
        cargoCapacity: effectiveCargo,
        ...cycle,
        remainingAmount: null,
        estimatedDepletionHours: null,
        finalBatchAmount: null,
      };
  return { ok: true, preview } as const;
}
