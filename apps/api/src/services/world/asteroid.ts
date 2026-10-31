import { getDb } from '../../lib/db/index.js';
import { listTravelingTripsByAsteroid } from '../fleet/index.js';
import { requireSpacecraft, type ResearchModifiers } from '@orions-frontier/game-config';
import {
  isOneOf,
  resourceKeys as allResourceKeys,
  type ResourceKey,
  type ResourceMap,
} from '@orions-frontier/shared';
import type {
  AsteroidDetail,
  AsteroidDetailAssignment,
  AsteroidVein,
  VisibleAsteroid,
} from '@orions-frontier/shared';
import {
  getUserRevealedAsteroidIds,
  isPointVisible,
  type ScannerCoverage,
  type VisibilityProjectionStats,
  findAsteroid,
  listAsteroidAssignmentsWithOwner,
  listAsteroidSummariesInChunks,
  listAsteroidVeins,
} from '../map/index.js';
import { getResearchModifiers } from '../research/index.js';
import { getUserScannerCoverages } from '../station/index.js';

export interface ChunkQueryParams {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

/**
 * Every asteroid with a vein the viewer's research reveals is listed; size, resource and reserve
 * only inside scanner coverage.
 */
export const getVisibleChunkAsteroids = async (
  params: ChunkQueryParams,
  coverages: readonly ScannerCoverage[],
  visibleResources: readonly ResourceKey[],
  stats?: VisibilityProjectionStats,
  scannerBypass = false,
  revealedIds: ReadonlySet<string> = new Set()
): Promise<VisibleAsteroid[]> => {
  const db = getDb();
  const rows = await listAsteroidSummariesInChunks(
    db,
    params,
    scannerBypass ? allResourceKeys : visibleResources
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
          primaryResourceKey: row.primaryResourceKey,
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

  const [row, coverages, revealedIds, modifiers] = await Promise.all([
    findAsteroid(db, id),
    scannerBypass ? Promise.resolve([]) : getUserScannerCoverages(userId),
    scannerBypass ? Promise.resolve(new Set<string>()) : getUserRevealedAsteroidIds(userId),
    getResearchModifiers(userId, db),
  ]);

  if (!row) return null;
  const scanned = scannerBypass || revealedIds.has(id) || isPointVisible(coverages, row);
  const visibleResources: readonly ResourceKey[] = scannerBypass
    ? allResourceKeys
    : modifiers.visibleResources;

  const [veins, assignmentRows, travelingTrips] = await Promise.all([
    listAsteroidVeins(db, id, visibleResources),
    listAsteroidAssignmentsWithOwner(db, id),
    listTravelingTripsByAsteroid(db, id),
  ]);
  // Without visible ore left the asteroid does not exist for this viewer; showing a mined-out one
  // would betray its unresearched veins.
  if (!veins.some((vein) => vein.remainingAmount > 0)) return null;

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
    ...describeOperations(
      assignmentRows,
      travelingTrips,
      userId,
      modifiers,
      visibleResources,
      scanned,
      scannerBypass
    ),
  };
};

type AssignmentRow = Awaited<ReturnType<typeof listAsteroidAssignmentsWithOwner>>[number];
type TravelingTrip = Awaited<ReturnType<typeof listTravelingTripsByAsteroid>>[number];

/**
 * Mining on the asteroid, visible to viewers with an own assignment there. Outside the scanner
 * only the viewer's own assignments and cargo show.
 */
function describeOperations(
  assignmentRows: AssignmentRow[],
  travelingTrips: TravelingTrip[],
  userId: string,
  modifiers: ResearchModifiers,
  visibleResources: readonly ResourceKey[],
  scanned: boolean,
  scannerBypass: boolean
): Pick<AsteroidDetail, 'operationsVisible' | 'assignments' | 'inTransit'> {
  const ownAssignmentIds = new Set(
    assignmentRows.filter((row) => row.ownerUserId === userId).map((row) => row.id)
  );
  const mayObserveOperations = scannerBypass || ownAssignmentIds.size > 0;
  if (!mayObserveOperations) return { operationsVisible: false, assignments: [], inTransit: {} };

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

  // Cargo of unresearched resources stays hidden, also in co-miners' manifests.
  const visibleCargo = (cargo: ResourceMap): ResourceMap =>
    Object.fromEntries(Object.entries(cargo).filter(([key]) => isOneOf(visibleResources, key)));
  const inTransit: Record<string, number> = {};
  const isVisible = (assignmentId: string | null) =>
    scanned || (assignmentId !== null && ownAssignmentIds.has(assignmentId));
  for (const trip of travelingTrips) {
    if (!trip.cargoManifest || !isVisible(trip.assignmentId)) continue;
    for (const [key, amount] of Object.entries(visibleCargo(trip.cargoManifest))) {
      inTransit[key] = (inTransit[key] ?? 0) + amount;
    }
  }

  // Research is account-wide; only the viewer's own assignments show it.
  const assignments = assignmentRows
    .filter((assignment) => isVisible(assignment.id))
    .map((assignment): AsteroidDetailAssignment => {
      const spacecraft = requireSpacecraft(assignment.spacecraftKey);
      const isOwnAssignment = assignment.ownerUserId === userId;
      const miningRate = spacecraft.miningRate * (isOwnAssignment ? modifiers.miningRate : 1);
      const cargo = spacecraft.cargo * (isOwnAssignment ? modifiers.cargo : 1);
      const activeTrip = activeTrips.get(assignment.id);
      return {
        id: assignment.id,
        stationId: isOwnAssignment ? assignment.stationId : null,
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
              cargoManifest: activeTrip.cargoManifest && visibleCargo(activeTrip.cargoManifest),
            }
          : null,
      };
    });
  return { operationsVisible: true, assignments, inTransit };
}
