import { and, between, eq, lte, max } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { asteroids, asteroidVeins, asteroidAssignments } from '../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stations } from '../lib/db/schema/stations.js';
import { calculateBuildingEffect } from '@orions-frontier/game-config';
import type {
  AsteroidDetail,
  AsteroidDetailAssignment,
  AsteroidSize,
  AsteroidVein,
  VeinType,
  VisibleAsteroid,
} from '@orions-frontier/shared';
import type { ResourceKey } from '@orions-frontier/shared';

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

export const getUserScannerStrength = async (userId: string): Promise<number> => {
  const db = getDb();
  const [row] = await db
    .select({ level: max(stationBuildings.level) })
    .from(stationBuildings)
    .innerJoin(stations, eq(stationBuildings.stationId, stations.id))
    .innerJoin(
      buildingDefinitions,
      eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
    )
    .where(and(eq(stations.userId, userId), eq(buildingDefinitions.key, 'scanner')));
  return (
    calculateBuildingEffect('scanner', row?.level ?? 0).find(
      (effect) => effect.type === 'scanner_strength'
    )?.value ?? 0
  );
};

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
  }));
};

// ============================================================================
// getAsteroidById — returns full detail
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

  const [veins, assignmentRows, travelingTrips] = await Promise.all([
    db.select().from(asteroidVeins).where(eq(asteroidVeins.asteroidId, id)),
    db
      .select({
        id: asteroidAssignments.id,
        stationId: asteroidAssignments.stationId,
        spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId,
        spacecraftName: spacecraftDefinitions.name,
        spacecraftMiningRate: spacecraftDefinitions.miningRate,
        spacecraftCargo: spacecraftDefinitions.cargo,
        assignedAmount: asteroidAssignments.assignedAmount,
        assignedAt: asteroidAssignments.assignedAt,
        recallRequestedAt: asteroidAssignments.recallRequestedAt,
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
    id: row.id,
    x: row.x,
    y: row.y,
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    size: row.size as AsteroidSize,
    hiddenLevel: row.hiddenLevel,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    veins: veins.map((v): AsteroidVein => ({
      id: v.id,
      veinType: v.veinType as VeinType,
      resourceKey: v.resourceKey as ResourceKey,
      remainingAmount: v.remainingAmount,
    })),
    assignments: assignmentRows.map((a): AsteroidDetailAssignment => ({
      id: a.id,
      stationId: a.stationId,
      spacecraftDefinitionId: a.spacecraftDefinitionId,
      spacecraftName: a.spacecraftName,
      spacecraftMiningRate: a.spacecraftMiningRate,
      spacecraftCargo: a.spacecraftCargo,
      assignedAmount: a.assignedAmount,
      assignedAt: a.assignedAt.toISOString(),
      recallRequestedAt: a.recallRequestedAt?.toISOString() ?? null,
    })),
    inTransit,
  };
};
