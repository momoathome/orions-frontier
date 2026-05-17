import { and, between, eq, lte } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { asteroids } from '../lib/db/schema/asteroids.js';
import type { AsteroidDetail, VisibleAsteroid, AsteroidResourceType } from '@orions-frontier/shared';

// ============================================================================
// Asteroid Service
// ============================================================================

export interface ChunkQueryParams {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
  /** Minimum scanner strength: only returns asteroids with hidden_level <= scannerStrength */
  scannerStrength: number;
}

/**
 * Returns all visible asteroids within the requested chunk rectangle.
 * Uses chunk indexes for performant queries — no full-world coordinate scans.
 */
export const getVisibleChunkAsteroids = async (
  params: ChunkQueryParams,
): Promise<VisibleAsteroid[]> => {
  const db = getDb();
  const { minChunkX, maxChunkX, minChunkY, maxChunkY, scannerStrength } = params;

  const rows = await db
    .select({
      id: asteroids.id,
      x: asteroids.x,
      y: asteroids.y,
      chunkX: asteroids.chunkX,
      chunkY: asteroids.chunkY,
      resourceType: asteroids.resourceType,
      richness: asteroids.richness,
    })
    .from(asteroids)
    .where(
      and(
        between(asteroids.chunkX, minChunkX, maxChunkX),
        between(asteroids.chunkY, minChunkY, maxChunkY),
        lte(asteroids.hiddenLevel, scannerStrength),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    x: row.x,
    y: row.y,
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    resourceType: row.resourceType as AsteroidResourceType,
    richness: row.richness,
    isVisible: true as const,
  }));
};
// ============================================================================
// getAsteroidById
// ============================================================================

/**
 * Returns full asteroid detail for the given id, or null if not found or hidden.
 * Only returns the asteroid when hidden_level <= scannerStrength.
 */
export const getAsteroidById = async (
  id: string,
  scannerStrength: number,
): Promise<AsteroidDetail | null> => {
  const db = getDb();

  const rows = await db
    .select()
    .from(asteroids)
    .where(and(eq(asteroids.id, id), lte(asteroids.hiddenLevel, scannerStrength)))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0]!;

  return {
    id: row.id,
    x: row.x,
    y: row.y,
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    resourceType: row.resourceType as AsteroidResourceType,
    richness: row.richness,
    hiddenLevel: row.hiddenLevel,
    isDepleted: row.isDepleted,
    clusterId: row.clusterId,
    stability: row.stability,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // Placeholder mining stats (mining system not yet implemented)
    activeMiningAssignments: 0,
    currentMiningRate: 0,
    estimatedYield: Math.round(row.richness * 8.5),
  };
};
