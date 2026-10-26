import { and, between, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { asteroids, asteroidVeins, asteroidAssignments } from '../lib/db/schema/asteroids.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationResearch } from '../lib/db/schema/station-research.js';
import { stations } from '../lib/db/schema/stations.js';
import { requireSpacecraft } from '@orions-frontier/game-config';
import type {
  AsteroidDetail,
  AsteroidDetailAssignment,
  AsteroidVein,
  VisibleAsteroid,
} from '@orions-frontier/shared';
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
            size: row.size,
            primaryResourceKey: row.primaryResourceKey ?? 'carbon',
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
      trip.assignmentId && (trip.purpose === 'mine' || trip.purpose === 'mining_return')
        ? [[trip.assignmentId, { ...trip, purpose: trip.purpose }] as const]
        : []
    )
  );

  const inTransit: Record<string, number> = {};
  for (const trip of travelingTrips) {
    if (!trip.cargoManifest) continue;
    for (const [key, amount] of Object.entries(trip.cargoManifest)) {
      inTransit[key] = (inTransit[key] ?? 0) + amount;
    }
  }

  const mayObserveOperations =
    scannerBypass || assignmentRows.some((assignment) => assignment.ownerUserId === userId);
  const visibleAssignments = mayObserveOperations ? assignmentRows : [];
  const ownStationIds = [
    ...new Set(
      visibleAssignments
        .filter((assignment) => assignment.ownerUserId === userId)
        .map((assignment) => assignment.stationId)
    ),
  ];
  const completedResearch =
    ownStationIds.length > 0
      ? await getDb()
          .select({
            stationId: stationResearch.stationId,
            technologyKey: stationResearch.technologyKey,
          })
          .from(stationResearch)
          .where(
            and(
              inArray(stationResearch.stationId, ownStationIds),
              eq(stationResearch.status, 'completed')
            )
          )
      : [];
  const completedByStation = new Map<string, Set<string>>();
  for (const research of completedResearch) {
    const technologies = completedByStation.get(research.stationId) ?? new Set<string>();
    technologies.add(research.technologyKey);
    completedByStation.set(research.stationId, technologies);
  }
  const assignmentViews = visibleAssignments.map((assignment): AsteroidDetailAssignment => {
    const spacecraft = requireSpacecraft(assignment.spacecraftKey);
    const isOwnAssignment = assignment.ownerUserId === userId;
    const technologies = completedByStation.get(assignment.stationId);
    const miningRate =
      isOwnAssignment && technologies?.has('extraction_algorithms')
        ? spacecraft.miningRate * 1.1
        : spacecraft.miningRate;
    const cargo =
      isOwnAssignment && technologies?.has('modular_cargo_frames')
        ? spacecraft.cargo * 1.1
        : spacecraft.cargo;
    const activeTrip = activeTrips.get(assignment.id);
    return {
      id: assignment.id,
      stationId: assignment.stationId,
      spacecraftKey: assignment.spacecraftKey,
      spacecraftName: spacecraft.name,
      spacecraftMiningRate: miningRate,
      spacecraftCargo: cargo,
      assignedAmount: assignment.assignedAmount,
      assignedAt: assignment.assignedAt.toISOString(),
      recallRequestedAt: assignment.recallRequestedAt?.toISOString() ?? null,
      recallRequestedAmount: assignment.recallRequestedAmount,
      activeTrip: activeTrip
        ? {
            id: activeTrip.id,
            purpose: activeTrip.purpose,
            groupSize: activeTrip.groupSize,
            departedAt: activeTrip.departedAt.toISOString(),
            arrivesAt: activeTrip.arrivesAt.toISOString(),
            cargoManifest: activeTrip.cargoManifest,
          }
        : null,
    };
  });

  return {
    id: row.id,
    x: row.x,
    y: row.y,
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    size: row.size,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    veins: veins.map((v): AsteroidVein => ({
      id: v.id,
      veinType: v.veinType,
      resourceKey: v.resourceKey,
      remainingAmount: v.remainingAmount,
    })),
    operationsVisible: mayObserveOperations,
    assignments: assignmentViews,
    inTransit: mayObserveOperations ? inTransit : {},
  };
};
