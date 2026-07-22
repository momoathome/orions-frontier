import { and, between, eq, or } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { asteroids, asteroidVeins, asteroidAssignments } from '../lib/db/schema/asteroids.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stations } from '../lib/db/schema/stations.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import type {
  AsteroidDetail,
  AsteroidDetailAssignment,
  AsteroidSize,
  AsteroidVein,
  VeinType,
  VisibleAsteroid,
} from '@orions-frontier/shared';
import type { ResourceKey } from '@orions-frontier/shared';
import { WORLD_CONFIG } from '../lib/world-config.js';
import {
  getUserScannerCoverages,
  isPointVisible,
  visibleChunkBounds,
  type ScannerCoverage,
  type VisibilityProjectionStats,
} from './scanner-visibility.service.js';

export interface ChunkQueryParams {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export const getVisibleChunkAsteroids = async (
  params: ChunkQueryParams,
  coverages: readonly ScannerCoverage[],
  stats?: VisibilityProjectionStats,
  scannerBypass = false
): Promise<VisibleAsteroid[]> => {
  const db = getDb();
  const bounds = scannerBypass
    ? [params]
    : visibleChunkBounds(coverages, params, WORLD_CONFIG.CHUNK_SIZE);
  if (bounds.length === 0) return [];

  const rows = await db
    .select({
      id: asteroids.id,
      x: asteroids.x,
      y: asteroids.y,
      chunkX: asteroids.chunkX,
      chunkY: asteroids.chunkY,
      size: asteroids.size,
      primaryResourceKey: asteroidVeins.resourceKey,
    })
    .from(asteroids)
    .leftJoin(
      asteroidVeins,
      and(eq(asteroidVeins.asteroidId, asteroids.id), eq(asteroidVeins.veinType, 'primary'))
    )
    .where(
      or(
        ...bounds.map((bound) =>
          and(
            between(asteroids.chunkX, bound.minChunkX, bound.maxChunkX),
            between(asteroids.chunkY, bound.minChunkY, bound.maxChunkY)
          )
        )
      )
    );
  if (stats) stats.asteroidCandidates = rows.length;

  return rows.flatMap((row) =>
    scannerBypass || isPointVisible(coverages, row)
      ? [
          {
            id: row.id,
            x: row.x,
            y: row.y,
            chunkX: row.chunkX,
            chunkY: row.chunkY,
            size: row.size as AsteroidSize,
            primaryResourceKey: (row.primaryResourceKey ?? 'carbon') as ResourceKey,
          },
        ]
      : []
  );
};

export const getAsteroidById = async (
  id: string,
  userId: string,
  scannerBypass = false
): Promise<AsteroidDetail | null> => {
  const db = getDb();

  const [[row], coverages] = await Promise.all([
    db.select().from(asteroids).where(eq(asteroids.id, id)).limit(1),
    scannerBypass ? Promise.resolve([]) : getUserScannerCoverages(userId),
  ]);

  if (!row || (!scannerBypass && !isPointVisible(coverages, row))) return null;

  const [veins, assignmentRows, travelingTrips] = await Promise.all([
    db.select().from(asteroidVeins).where(eq(asteroidVeins.asteroidId, id)),
    db
      .select({
        id: asteroidAssignments.id,
        stationId: asteroidAssignments.stationId,
        spacecraftKey: asteroidAssignments.spacecraftKey,
        assignedAmount: asteroidAssignments.assignedAmount,
        assignedAt: asteroidAssignments.assignedAt,
        recallRequestedAt: asteroidAssignments.recallRequestedAt,
        recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
        ownerUserId: stations.userId,
      })
      .from(asteroidAssignments)
      .innerJoin(stations, eq(stations.id, asteroidAssignments.stationId))
      .where(eq(asteroidAssignments.asteroidId, id)),
    db
      .select({
        id: spacecraftTrips.id,
        assignmentId: spacecraftTrips.assignmentId,
        purpose: spacecraftTrips.purpose,
        groupSize: spacecraftTrips.groupSize,
        departedAt: spacecraftTrips.departedAt,
        arrivesAt: spacecraftTrips.arrivesAt,
        cargoManifest: spacecraftTrips.cargoManifest,
      })
      .from(spacecraftTrips)
      .innerJoin(asteroidAssignments, eq(spacecraftTrips.assignmentId, asteroidAssignments.id))
      .where(and(eq(asteroidAssignments.asteroidId, id), eq(spacecraftTrips.status, 'traveling'))),
  ]);

  const activeTrips = new Map(
    travelingTrips.flatMap((trip) =>
      trip.assignmentId ? [[trip.assignmentId, trip] as const] : []
    )
  );

  const inTransit: Record<string, number> = {};
  for (const trip of travelingTrips) {
    if (!trip.cargoManifest) continue;
    for (const [key, amount] of Object.entries(trip.cargoManifest as Record<string, number>)) {
      inTransit[key] = (inTransit[key] ?? 0) + amount;
    }
  }

  const mayObserveOperations =
    scannerBypass || assignmentRows.some((assignment) => assignment.ownerUserId === userId);
  const visibleAssignments = mayObserveOperations ? assignmentRows : [];

  return {
    id: row.id,
    x: row.x,
    y: row.y,
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    size: row.size as AsteroidSize,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    veins: veins.map((v): AsteroidVein => ({
      id: v.id,
      veinType: v.veinType as VeinType,
      resourceKey: v.resourceKey as ResourceKey,
      remainingAmount: v.remainingAmount,
    })),
    operationsVisible: mayObserveOperations,
    assignments: visibleAssignments.map((a): AsteroidDetailAssignment => {
      const spacecraft = getSpacecraft(a.spacecraftKey)!;
      const activeTrip = activeTrips.get(a.id);
      return {
        id: a.id,
        stationId: a.stationId,
        spacecraftKey: a.spacecraftKey,
        spacecraftName: spacecraft.name,
        spacecraftMiningRate: spacecraft.miningRate,
        spacecraftCargo: spacecraft.cargo,
        assignedAmount: a.assignedAmount,
        assignedAt: a.assignedAt.toISOString(),
        recallRequestedAt: a.recallRequestedAt?.toISOString() ?? null,
        recallRequestedAmount: a.recallRequestedAmount,
        activeTrip: activeTrip
          ? {
              id: activeTrip.id,
              purpose: activeTrip.purpose as 'mine' | 'mining_return',
              groupSize: activeTrip.groupSize,
              departedAt: activeTrip.departedAt.toISOString(),
              arrivesAt: activeTrip.arrivesAt.toISOString(),
              cargoManifest: activeTrip.cargoManifest,
            }
          : null,
      };
    }),
    inTransit: mayObserveOperations ? inTransit : {},
  };
};
