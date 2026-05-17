import { and, between, eq, lte, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import {
  asteroids,
  asteroidVeins,
  asteroidResourceStorage,
  asteroidAssignments,
} from '../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { stations } from '../lib/db/schema/stations.js';
import type {
  AsteroidDetail,
  AsteroidSize,
  AsteroidVein,
  AsteroidResourceStorage,
  PurityTier,
  VeinType,
  VisibleAsteroid,
} from '@orions-frontier/shared';
import type { ResourceKey } from '@orions-frontier/shared';
import { tickAsteroidAssignments } from './mining-tick.service.js';
import { WORLD_CONFIG } from '../lib/world-config.js';

// ============================================================================
// Asteroid Service
// ============================================================================

export interface ChunkQueryParams {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
  scannerStrength: number;
}

/**
 * Returns all visible asteroids within the requested chunk rectangle.
 * Joins asteroid_veins to get the primary resource key for map rendering.
 */
export const getVisibleChunkAsteroids = async (
  params: ChunkQueryParams
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
      size: asteroids.size,
      primaryResourceKey: asteroidVeins.resourceKey,
    })
    .from(asteroids)
    .leftJoin(
      asteroidVeins,
      and(eq(asteroidVeins.asteroidId, asteroids.id), eq(asteroidVeins.veinType, 'primary'))
    )
    .where(
      and(
        between(asteroids.chunkX, minChunkX, maxChunkX),
        between(asteroids.chunkY, minChunkY, maxChunkY),
        lte(asteroids.hiddenLevel, scannerStrength)
      )
    );

  return rows.map((row) => ({
    id: row.id,
    x: row.x,
    y: row.y,
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    size: row.size as AsteroidSize,
    primaryResourceKey: (row.primaryResourceKey ?? 'carbon') as ResourceKey,
    isVisible: true as const,
  }));
};

// ============================================================================
// getAsteroidById — triggers lazy tick, returns full detail
// ============================================================================

export const getAsteroidById = async (
  id: string,
  scannerStrength: number
): Promise<AsteroidDetail | null> => {
  const db = getDb();

  const [row] = await db
    .select()
    .from(asteroids)
    .where(and(eq(asteroids.id, id), lte(asteroids.hiddenLevel, scannerStrength)))
    .limit(1);

  if (!row) return null;

  // Trigger lazy tick for all assignments (may update stability)
  await tickAsteroidAssignments(id);

  // Reload asteroid after potential stability update
  const [refreshed] = await db.select().from(asteroids).where(eq(asteroids.id, id)).limit(1);

  if (!refreshed) return null;

  const [veins, storage, assignmentRows] = await Promise.all([
    db.select().from(asteroidVeins).where(eq(asteroidVeins.asteroidId, id)),
    db.select().from(asteroidResourceStorage).where(eq(asteroidResourceStorage.asteroidId, id)),
    db
      .select({ id: asteroidAssignments.id })
      .from(asteroidAssignments)
      .where(eq(asteroidAssignments.asteroidId, id)),
  ]);

  return {
    id: refreshed.id,
    x: refreshed.x,
    y: refreshed.y,
    chunkX: refreshed.chunkX,
    chunkY: refreshed.chunkY,
    size: refreshed.size as AsteroidSize,
    stability: refreshed.stability,
    hiddenLevel: refreshed.hiddenLevel,
    clusterId: refreshed.clusterId,
    createdAt: refreshed.createdAt.toISOString(),
    updatedAt: refreshed.updatedAt.toISOString(),
    veins: veins.map(
      (v): AsteroidVein => ({
        id: v.id,
        asteroidId: v.asteroidId,
        veinType: v.veinType as VeinType,
        resourceKey: v.resourceKey as ResourceKey,
        yieldPerHour: v.yieldPerHour,
        purity: v.purity,
        purityTier: v.purityTier as PurityTier,
      })
    ),
    storage: storage.map(
      (s): AsteroidResourceStorage => ({
        id: s.id,
        asteroidId: s.asteroidId,
        resourceKey: s.resourceKey as ResourceKey,
        amount: s.amount,
        updatedAt: s.updatedAt.toISOString(),
      })
    ),
    activeMiningAssignments: assignmentRows.length,
  };
};

// ============================================================================
// createAsteroidAssignment
// ============================================================================

export interface CreateAssignmentParams {
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
    | 'ALREADY_ASSIGNED';
  message: string;
}

export const createAsteroidAssignment = async (
  params: CreateAssignmentParams
): Promise<{ id: string } | CreateAssignmentError> => {
  const db = getDb();
  const { asteroidId, stationId, spacecraftDefinitionId, assignedAmount } = params;

  // Validate asteroid exists
  const [asteroid] = await db
    .select({ id: asteroids.id, size: asteroids.size })
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId))
    .limit(1);
  if (!asteroid) return { code: 'ASTEROID_NOT_FOUND', message: 'Asteroid not found' };

  // Validate station exists
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.id, stationId))
    .limit(1);
  if (!station) return { code: 'STATION_NOT_FOUND', message: 'Station not found' };

  // Validate spacecraft definition exists
  const [scraft] = await db
    .select({ id: spacecraftDefinitions.id })
    .from(spacecraftDefinitions)
    .where(eq(spacecraftDefinitions.id, spacecraftDefinitionId))
    .limit(1);
  if (!scraft) return { code: 'SPACECRAFT_NOT_FOUND', message: 'Spacecraft definition not found' };

  // Check slot capacity
  const maxSlots = WORLD_CONFIG.MINING_SLOTS[asteroid.size] ?? 1;
  const [slotRow] = await db
    .select({ count: sql<number>`count(distinct station_id)::int` })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.asteroidId, asteroidId));
  const usedSlots = slotRow?.count ?? 0;
  if (usedSlots >= maxSlots) {
    return {
      code: 'SLOTS_FULL',
      message: `Asteroid has no free mining slots (${usedSlots}/${maxSlots} used)`,
    };
  }

  // Check station not already assigned to this asteroid
  const [existing] = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(
      and(
        eq(asteroidAssignments.asteroidId, asteroidId),
        eq(asteroidAssignments.stationId, stationId)
      )
    )
    .limit(1);
  if (existing)
    return {
      code: 'ALREADY_ASSIGNED',
      message: 'Station already has miners assigned to this asteroid',
    };

  const [inserted] = await db
    .insert(asteroidAssignments)
    .values({ asteroidId, stationId, spacecraftDefinitionId, assignedAmount })
    .returning({ id: asteroidAssignments.id });

  return { id: inserted!.id };
};

// ============================================================================
// removeAsteroidAssignment
// ============================================================================

export const removeAsteroidAssignment = async (
  assignmentId: string,
  stationId: string
): Promise<boolean> => {
  const db = getDb();
  const result = await db
    .delete(asteroidAssignments)
    .where(
      and(eq(asteroidAssignments.id, assignmentId), eq(asteroidAssignments.stationId, stationId))
    )
    .returning({ id: asteroidAssignments.id });
  return result.length > 0;
};
