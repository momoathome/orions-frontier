import { getDb } from '../../lib/db/index.js';
import {
  findAsteroid,
  listAsteroidAssignmentsWithOwner,
  listAsteroidSummariesInChunks,
  listAsteroidVeins,
} from '../../repositories/asteroids.js';
import { listTravelingTripsByAsteroid } from '../../repositories/spacecraft-trips.js';
import { listCompletedResearchByStations } from '../../repositories/station-research.js';
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
} from './scanner-visibility.js';

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
  const rows = await listAsteroidSummariesInChunks(db, params);
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

  const [row, coverages, revealedIds] = await Promise.all([
    findAsteroid(db, id),
    scannerBypass ? Promise.resolve([]) : getUserScannerCoverages(userId),
    scannerBypass ? Promise.resolve(new Set<string>()) : getUserRevealedAsteroidIds(userId),
  ]);

  if (!row) return null;
  const scanned = scannerBypass || revealedIds.has(id) || isPointVisible(coverages, row);

  const [veins, assignmentRows, travelingTrips] = await Promise.all([
    listAsteroidVeins(db, id),
    listAsteroidAssignmentsWithOwner(db, id),
    listTravelingTripsByAsteroid(db, id),
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
    ownStationIds.length > 0 ? await listCompletedResearchByStations(getDb(), ownStationIds) : [];
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
