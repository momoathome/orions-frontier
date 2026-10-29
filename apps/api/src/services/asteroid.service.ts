import { and, between, eq, inArray, sql } from 'drizzle-orm';
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
import {
  getUserRevealedAsteroidIds,
  getUserScannerCoverages,
  isPointVisible,
  type ScannerCoverage,
  type VisibilityProjectionStats,
} from './scanner-visibility.service.js';

export interface ChunkQueryParams {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

/** Every asteroid in the view is listed; size, resource and reserve only inside scanner coverage. */
export const getVisibleChunkAsteroids = async (
  params: ChunkQueryParams,
  coverages: readonly ScannerCoverage[],
  stats?: VisibilityProjectionStats,
  scannerBypass = false,
  revealedIds: ReadonlySet<string> = new Set()
): Promise<VisibleAsteroid[]> => {
  const db = getDb();
  const rows = await db
    .select({
      id: asteroids.id,
      x: asteroids.x,
      y: asteroids.y,
      chunkX: asteroids.chunkX,
      chunkY: asteroids.chunkY,
      size: asteroids.size,
      primaryResourceKey: asteroidVeins.resourceKey,
      remainingFraction: sql<number>`(
        SELECT LEAST(1, COALESCE(SUM(v.remaining_amount)::float / NULLIF(SUM(v.initial_amount), 0), 1))
        FROM asteroid_veins v WHERE v.asteroid_id = ${asteroids.id}
      )`,
    })
    .from(asteroids)
    .leftJoin(
      asteroidVeins,
      and(eq(asteroidVeins.asteroidId, asteroids.id), eq(asteroidVeins.veinType, 'primary'))
    )
    .where(
      and(
        between(asteroids.chunkX, params.minChunkX, params.maxChunkX),
        between(asteroids.chunkY, params.minChunkY, params.maxChunkY)
      )
    );
  if (stats) stats.asteroidCandidates = rows.length;

  return rows.map((row) =>
    scannerBypass || revealedIds.has(row.id) || isPointVisible(coverages, row)
      ? {
          id: row.id,
          x: row.x,
          y: row.y,
          chunkX: row.chunkX,
          chunkY: row.chunkY,
          scanned: true,
          size: row.size,
          primaryResourceKey: row.primaryResourceKey ?? 'carbon',
          remainingFraction: row.remainingFraction,
        }
      : {
          id: row.id,
          x: row.x,
          y: row.y,
          chunkX: row.chunkX,
          chunkY: row.chunkY,
          scanned: false,
          size: null,
          primaryResourceKey: null,
          remainingFraction: null,
        }
  );
};

export const getAsteroidById = async (
  id: string,
  userId: string,
  scannerBypass = false
): Promise<AsteroidDetail | null> => {
  const db = getDb();

  const [[row], coverages, revealedIds] = await Promise.all([
    db.select().from(asteroids).where(eq(asteroids.id, id)).limit(1),
    scannerBypass ? Promise.resolve([]) : getUserScannerCoverages(userId),
    scannerBypass ? Promise.resolve(new Set<string>()) : getUserRevealedAsteroidIds(userId),
  ]);

  if (!row) return null;
  const scanned = scannerBypass || revealedIds.has(id) || isPointVisible(coverages, row);

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

  // Miners fly individually; each assignment shows its next arrival.
  const activeTrips = new Map(
    travelingTrips
      .slice()
      .sort((a, b) => b.arrivesAt.getTime() - a.arrivesAt.getTime())
      .flatMap((trip) =>
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
    scanned,
    size: scanned ? row.size : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    veins: (scanned ? veins : []).map((v): AsteroidVein => ({
      id: v.id,
      veinType: v.veinType,
      resourceKey: v.resourceKey,
      remainingAmount: v.remainingAmount,
      initialAmount: v.initialAmount,
    })),
    operationsVisible: mayObserveOperations,
    assignments: assignmentViews,
    inTransit: mayObserveOperations ? inTransit : {},
  };
};
