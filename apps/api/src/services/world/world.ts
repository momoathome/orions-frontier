import { getDb } from '../../lib/db/index.js';
import { interpolateWorldPosition } from '../../lib/travel.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { gameNow } from '../../lib/game-execution-context.js';
import { listTravelingTripsInBounds } from '../fleet/index.js';
import { listMovingWorldMissionsInBounds } from '../missions/index.js';
import {
  required,
  AppError,
  ErrorCode,
  type VisibleStation,
  type VisibleWorldMovement,
} from '@orions-frontier/shared';
import {
  coarseIntegrity,
  currentIntegrity,
  isAttackProtected,
  requireSpacecraft,
} from '@orions-frontier/game-config';
import {
  isPointVisible,
  type ScannerCoverage,
  type VisibilityProjectionStats,
} from '../map/index.js';
import {
  getStationVisualProfiles,
  starterStationVisualProfile,
  listStationsInChunks,
  getUserScannerCoverages,
} from '../station/index.js';

export interface WorldChunkRange {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export interface VisibleStationCombatDiagnostics {
  now: Date;
  protectedOwnerIds: Set<string>;
}

/** Rohe Query-Werte; leere oder fehlende Werte sind ungültig. */
export type ChunkRangeQuery = Partial<Record<keyof WorldChunkRange, string>>;

export function parseChunkRange(values: ChunkRangeQuery, maxSpan: number): WorldChunkRange {
  const number = (value: string | undefined) =>
    value === undefined || value.trim() === '' ? Number.NaN : Number(value);
  const range = {
    minChunkX: number(values.minChunkX),
    maxChunkX: number(values.maxChunkX),
    minChunkY: number(values.minChunkY),
    maxChunkY: number(values.maxChunkY),
  };

  if (
    // Far beyond any world; larger values would overflow the integer columns they are compared to.
    !Object.values(range).every((v) => Number.isInteger(v) && Math.abs(v) <= 1_000_000) ||
    range.minChunkX > range.maxChunkX ||
    range.minChunkY > range.maxChunkY ||
    range.maxChunkX - range.minChunkX > maxSpan ||
    range.maxChunkY - range.minChunkY > maxSpan
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid or oversized chunk range');
  }

  return range;
}

const worldBounds = (range: WorldChunkRange) => ({
  minX: range.minChunkX * WORLD_CONFIG.CHUNK_SIZE,
  maxX: (range.maxChunkX + 1) * WORLD_CONFIG.CHUNK_SIZE,
  minY: range.minChunkY * WORLD_CONFIG.CHUNK_SIZE,
  maxY: (range.maxChunkY + 1) * WORLD_CONFIG.CHUNK_SIZE,
});

export async function getVisibleChunkStations(
  range: WorldChunkRange,
  userId: string,
  coverages: readonly ScannerCoverage[],
  stats?: VisibilityProjectionStats,
  scannerBypass = false,
  combatDiagnostics?: VisibleStationCombatDiagnostics
): Promise<VisibleStation[]> {
  const db = getDb();
  const rows = await listStationsInChunks(db, range);
  const now = combatDiagnostics?.now ?? gameNow();
  if (stats) stats.stationCandidates = rows.length;

  const visibleRows = rows.flatMap((station) => {
    const isOwn = station.userId === userId;
    const scanned = scannerBypass || isOwn || isPointVisible(coverages, station);
    if (
      scanned &&
      combatDiagnostics &&
      !isOwn &&
      isAttackProtected({ ...station, createdAt: station.ownerCreatedAt }, combatDiagnostics.now)
    ) {
      combatDiagnostics.protectedOwnerIds.add(station.userId);
    }
    return [
      {
        id: station.id,
        name: station.name,
        x: station.x,
        y: station.y,
        chunkX: Math.floor(station.x / WORLD_CONFIG.CHUNK_SIZE),
        chunkY: Math.floor(station.y / WORLD_CONFIG.CHUNK_SIZE),
        ownerType: station.botUserId ? ('bot' as const) : ('player' as const),
        ownerId: station.userId,
        isOwn,
        scanned,
        integrity: scanned
          ? (isOwn ? (value: number) => value : coarseIntegrity)(
              currentIntegrity(station.integrity, station.integrityUpdatedAt, now)
            )
          : null,
      },
    ];
  });
  const visualProfiles = await getStationVisualProfiles(
    visibleRows.filter((station) => station.scanned).map((station) => station.id)
  );

  return visibleRows.map((station) => ({
    ...station,
    visualProfile: station.scanned
      ? required(visualProfiles.get(station.id), `visual profile ${station.id}`)
      : starterStationVisualProfile(),
  }));
}

const isInsideWorldBounds = (
  point: { x: number; y: number },
  bounds: ReturnType<typeof worldBounds>
) =>
  point.x >= bounds.minX &&
  point.x < bounds.maxX &&
  point.y >= bounds.minY &&
  point.y < bounds.maxY;

export async function getVisibleWorldMovements(
  range: WorldChunkRange,
  userId: string,
  now = gameNow(),
  scannerBypass = false
): Promise<VisibleWorldMovement[]> {
  const db = getDb();
  const bounds = worldBounds(range);
  const [trips, missions, coverages] = await Promise.all([
    listTravelingTripsInBounds(db, bounds),
    listMovingWorldMissionsInBounds(db, bounds, WORLD_CONFIG.SECTOR),
    scannerBypass ? Promise.resolve([]) : getUserScannerCoverages(userId),
  ]);

  const viewer = { userId, coverages, bounds, now, scannerBypass };
  return [
    ...trips.map((trip) => projectTrip(trip, viewer)),
    ...missions.map((mission) => projectMission(mission, viewer)),
  ].filter((movement) => movement !== null);
}

type TripRow = Awaited<ReturnType<typeof listTravelingTripsInBounds>>[number];
type MissionRow = Awaited<ReturnType<typeof listMovingWorldMissionsInBounds>>[number];

/** Who looks at the map, and where: decides how much of each movement shows. */
interface MovementViewer {
  userId: string;
  coverages: readonly ScannerCoverage[];
  bounds: ReturnType<typeof worldBounds>;
  now: Date;
  scannerBypass: boolean;
}

function projectTrip(trip: TripRow, viewer: MovementViewer): VisibleWorldMovement | null {
  const position = interpolateWorldPosition(trip, viewer.now);
  if (!isInsideWorldBounds(position, viewer.bounds)) return null;
  const spacecraft = requireSpacecraft(trip.spacecraftKey);
  if (trip.userId !== viewer.userId) {
    // Outside the scanner every movement is a bare blip: seen, but not what or whose.
    const scanned = viewer.scannerBypass || isPointVisible(viewer.coverages, position);
    return {
      kind: 'radar_contact',
      id: trip.id,
      ...position,
      observedAt: viewer.now.toISOString(),
      signature: scanned ? spacecraft.role : null,
    };
  }
  return {
    kind: 'own_trip',
    id: trip.id,
    fromX: trip.fromX,
    fromY: trip.fromY,
    toX: trip.toX,
    toY: trip.toY,
    departedAt: trip.departedAt.toISOString(),
    arrivesAt: trip.arrivesAt.toISOString(),
    purpose: trip.purpose,
    groupSize: trip.groupSize,
    ...(trip.purpose === 'mining_return' && { miningStartedAt: trip.createdAt.toISOString() }),
    ownerType: trip.botUserId ? 'bot' : 'player',
    spacecraft: { name: spacecraft.name, image: spacecraft.image, role: spacecraft.role },
  };
}

function projectMission(mission: MissionRow, viewer: MovementViewer): VisibleWorldMovement | null {
  const spacecraft = requireSpacecraft(mission.spacecraftKey);
  const targetX = mission.targetX ?? mission.targetSectorX * WORLD_CONFIG.SECTOR.WIDTH;
  const targetY = mission.targetY ?? mission.targetSectorY * WORLD_CONFIG.SECTOR.HEIGHT;
  const returning = mission.status === 'returning';
  const fromX = returning ? targetX : mission.fromX;
  const fromY = returning ? targetY : mission.fromY;
  const toX = returning ? mission.fromX : targetX;
  const toY = returning ? mission.fromY : targetY;
  const path = {
    fromX,
    fromY,
    toX,
    toY,
    departedAt: mission.departedAt,
    arrivesAt: mission.arrivesAt,
  };
  const position = interpolateWorldPosition(path, viewer.now);
  if (!isInsideWorldBounds(position, viewer.bounds)) return null;
  if (mission.userId !== viewer.userId) {
    return {
      kind: 'radar_contact',
      id: mission.id,
      ...position,
      observedAt: viewer.now.toISOString(),
      signature:
        viewer.scannerBypass || isPointVisible(viewer.coverages, position) ? spacecraft.role : null,
    };
  }
  return {
    kind: 'own_trip',
    id: mission.id,
    fromX,
    fromY,
    toX,
    toY,
    departedAt: mission.departedAt.toISOString(),
    arrivesAt: mission.arrivesAt.toISOString(),
    purpose: mission.purpose,
    groupSize: 1,
    ownerType: mission.botUserId ? 'bot' : 'player',
    spacecraft: { name: spacecraft.name, image: spacecraft.image, role: spacecraft.role },
  };
}
