import { and, between, eq, lte } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import {
  asteroids,
  asteroidVeins,
  asteroidResourceStorage,
  asteroidAssignments,
} from '../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import type {
  AsteroidDetail,
  AsteroidDetailAssignment,
  AsteroidSize,
  AsteroidVein,
  AsteroidResourceStorage,
  PurityTier,
  VeinType,
  VisibleAsteroid,
} from '@orions-frontier/shared';
import type { ResourceKey } from '@orions-frontier/shared';
import { tickAsteroidAssignments } from './mining/mining-tick.service.js';

// ============================================================================
// Asteroid Service — asteroid data and map queries
//
// getVisibleChunkAsteroids — chunk-based map query with scanner filter
// getAsteroidById          — full asteroid detail with lazy tick trigger
//
// Assignment management (create/update/remove) lives in:
//   services/mining/assignment.service.ts
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

  const [veins, storage, assignmentRows, travelingTrips] = await Promise.all([
    db.select().from(asteroidVeins).where(eq(asteroidVeins.asteroidId, id)),
    db.select().from(asteroidResourceStorage).where(eq(asteroidResourceStorage.asteroidId, id)),
    db
      .select({
        id: asteroidAssignments.id,
        asteroidId: asteroidAssignments.asteroidId,
        stationId: asteroidAssignments.stationId,
        spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
        spacecraftName: spacecraftDefinitions.name,
        spacecraftMiningRate: spacecraftDefinitions.miningRate,
        spacecraftCargo: spacecraftDefinitions.cargo,
        assignedAmount: asteroidAssignments.assignedAmount,
        assignedAt: asteroidAssignments.assignedAt,
        lastTick: asteroidAssignments.lastTick,
      })
      .from(asteroidAssignments)
      .innerJoin(
        spacecraftDefinitions,
        eq(spacecraftDefinitions.id, asteroidAssignments.spacecraftDefinitionId)
      )
      .where(eq(asteroidAssignments.asteroidId, id)),
    // Traveling trips departing FROM this asteroid carrying cargo
    db
      .select({ cargoManifest: spacecraftTrips.cargoManifest })
      .from(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.fromId, id),
          eq(spacecraftTrips.fromType, 'asteroid'),
          eq(spacecraftTrips.status, 'traveling')
        )
      ),
  ]);

  // Sum cargoManifest amounts across all traveling trips from this asteroid
  const inTransit: Record<string, number> = {};
  for (const trip of travelingTrips) {
    if (!trip.cargoManifest) continue;
    for (const [key, amount] of Object.entries(trip.cargoManifest as Record<string, number>)) {
      inTransit[key] = (inTransit[key] ?? 0) + amount;
    }
  }

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
    assignments: assignmentRows.map(
      (a): AsteroidDetailAssignment => ({
        id: a.id,
        asteroidId: a.asteroidId,
        stationId: a.stationId,
        spacecraftDefinitionId: a.spacecraftDefinitionId,
        spacecraftName: a.spacecraftName,
        spacecraftMiningRate: a.spacecraftMiningRate,
        spacecraftCargo: a.spacecraftCargo,
        assignedAmount: a.assignedAmount,
        assignedAt: a.assignedAt.toISOString(),
        lastTick: a.lastTick.toISOString(),
      })
    ),
    activeMiningAssignments: assignmentRows.length,
    inTransit,
  };
};
