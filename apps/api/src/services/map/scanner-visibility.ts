import {
  calculateScannerRange,
  isResearchKey,
  researchModifiers,
} from '@orions-frontier/game-config';
import type { ResearchLevels } from '@orions-frontier/shared';
import { getDb, type QueryDb } from '../../lib/db/index.js';
import { listWorkedAsteroidIdsByUser } from '../../repositories/asteroids.js';
import { listScannerStationsByUser } from '../../repositories/stations.js';
import { listUserResearch } from '../../repositories/user-research.js';

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

/** Map sits beside research in the layers, so it reads levels straight from the repository. */
export async function getUserResearchModifiers(userId: string, db: QueryDb = getDb()) {
  const levels: ResearchLevels = {};
  for (const row of await listUserResearch(db, userId)) {
    if (isResearchKey(row.technologyKey)) levels[row.technologyKey] = row.level;
  }
  return researchModifiers(levels);
}

export async function getUserScannerCoverages(
  userId: string,
  db: QueryDb = getDb()
): Promise<ScannerCoverage[]> {
  const rows = await listScannerStationsByUser(db, userId);
  const modifiers = await getUserResearchModifiers(userId, db);

  return rows.map((row) => ({
    stationId: row.stationId,
    x: row.x,
    y: row.y,
    range: calculateScannerRange(row.level) * modifiers.scannerRange,
  }));
}

/** Asteroids outside scanner coverage that the user's own miners have already worked. */
export async function getUserRevealedAsteroidIds(
  userId: string,
  db: ScannerDb = getDb()
): Promise<Set<string>> {
  return new Set(await listWorkedAsteroidIdsByUser(db, userId));
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
