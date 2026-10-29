import { and, eq } from 'drizzle-orm';
import { calculateScannerRange } from '@orions-frontier/game-config';
import { getDb } from '../../lib/db/index.js';
import { asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { stations } from '../../lib/db/schema/stations.js';

export interface WorldPoint {
  x: number;
  y: number;
}

export interface ScannerCoverage extends WorldPoint {
  stationId: string;
  range: number;
}

export interface ChunkRange {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export interface VisibilityProjectionStats {
  asteroidCandidates?: number;
  stationCandidates?: number;
  debrisCandidates?: number;
}

type ScannerDb = Pick<ReturnType<typeof getDb>, 'select' | 'selectDistinct'>;

export async function getUserScannerCoverages(
  userId: string,
  db: ScannerDb = getDb()
): Promise<ScannerCoverage[]> {
  const rows = await db
    .select({
      stationId: stations.id,
      x: stations.x,
      y: stations.y,
      level: stationBuildings.level,
    })
    .from(stations)
    .innerJoin(
      stationBuildings,
      and(eq(stationBuildings.stationId, stations.id), eq(stationBuildings.buildingKey, 'scanner'))
    )
    .where(eq(stations.userId, userId));

  return rows.map((row) => ({
    stationId: row.stationId,
    x: row.x,
    y: row.y,
    range: calculateScannerRange(row.level),
  }));
}

/** Asteroids outside scanner coverage that the user's own miners have already worked. */
export async function getUserRevealedAsteroidIds(
  userId: string,
  db: ScannerDb = getDb()
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ asteroidId: asteroidAssignments.asteroidId })
    .from(asteroidAssignments)
    .innerJoin(stations, eq(stations.id, asteroidAssignments.stationId))
    .innerJoin(
      spacecraftTrips,
      and(
        eq(spacecraftTrips.assignmentId, asteroidAssignments.id),
        eq(spacecraftTrips.purpose, 'mining_return')
      )
    )
    .where(eq(stations.userId, userId));
  return new Set(rows.map((row) => row.asteroidId));
}

export function isPointVisible(coverages: readonly ScannerCoverage[], point: WorldPoint): boolean {
  return coverages.some((coverage) => {
    const dx = point.x - coverage.x;
    const dy = point.y - coverage.y;
    return dx * dx + dy * dy <= coverage.range * coverage.range;
  });
}

export function visibleChunkBounds(
  coverages: readonly ScannerCoverage[],
  requested: ChunkRange,
  chunkSize: number
): ChunkRange[] {
  return scannerChunkBounds(coverages, chunkSize).flatMap((coverageBounds) => {
    const bounds: ChunkRange = {
      minChunkX: Math.max(requested.minChunkX, coverageBounds.minChunkX),
      maxChunkX: Math.min(requested.maxChunkX, coverageBounds.maxChunkX),
      minChunkY: Math.max(requested.minChunkY, coverageBounds.minChunkY),
      maxChunkY: Math.min(requested.maxChunkY, coverageBounds.maxChunkY),
    };
    return bounds.minChunkX <= bounds.maxChunkX && bounds.minChunkY <= bounds.maxChunkY
      ? [bounds]
      : [];
  });
}

export function scannerChunkBounds(
  coverages: readonly ScannerCoverage[],
  chunkSize: number
): ChunkRange[] {
  return coverages.map((coverage) => ({
    minChunkX: Math.floor((coverage.x - coverage.range) / chunkSize),
    maxChunkX: Math.floor((coverage.x + coverage.range) / chunkSize),
    minChunkY: Math.floor((coverage.y - coverage.range) / chunkSize),
    maxChunkY: Math.floor((coverage.y + coverage.range) / chunkSize),
  }));
}
