import { getDb } from '../../lib/db/index.js';
import { interpolateWorldPosition } from '../../lib/travel.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { listTravelingTripsInBounds } from '../../repositories/spacecraft-trips.js';
import { listStationsInChunks } from '../../repositories/stations.js';
import { listMovingWorldMissions } from '../../repositories/world-missions.js';
import {
  required,
  AppError,
  ErrorCode,
  type VisibleStation,
  type VisibleWorldMovement,
  type WorldTripPurpose,
} from '@orions-frontier/shared';
import {
  ATTACK_PROTECTION_DURATION_MS,
  coarseIntegrity,
  currentIntegrity,
  requireSpacecraft,
} from '@orions-frontier/game-config';
import {
  getUserScannerCoverages,
  isPointVisible,
  type ScannerCoverage,
  type VisibilityProjectionStats,
} from '../map/index.js';
import { getStationVisualProfiles, starterStationVisualProfile } from '../station/index.js';

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
    !Object.values(range).every(Number.isInteger) ||
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
  const now = combatDiagnostics?.now ?? new Date();
  if (stats) stats.stationCandidates = rows.length;

  const visibleRows = rows.flatMap((station) => {
    const isOwn = station.userId === userId;
    const scanned = scannerBypass || isOwn || isPointVisible(coverages, station);
    if (
      scanned &&
      combatDiagnostics &&
      !isOwn &&
      !station.attackProtectionBrokenAt &&
      combatDiagnostics.now.getTime() <
        Math.max(
          station.ownerCreatedAt.getTime() + ATTACK_PROTECTION_DURATION_MS,
          station.protectedUntil?.getTime() ?? 0
        )
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

const MILITARY_TRIP_PURPOSES = new Set<WorldTripPurpose>(['combat', 'combat_return', 'relocate']);

export async function getVisibleWorldMovements(
  range: WorldChunkRange,
  userId: string,
  now = new Date(),
  scannerBypass = false
): Promise<VisibleWorldMovement[]> {
  const db = getDb();
  const bounds = worldBounds(range);
  const [trips, missions, coverages] = await Promise.all([
    listTravelingTripsInBounds(db, bounds),
    listMovingWorldMissions(db),
    scannerBypass ? Promise.resolve([]) : getUserScannerCoverages(userId),
  ]);

  const visibleTrips = trips.flatMap((trip): VisibleWorldMovement[] => {
    const position = interpolateWorldPosition(trip, now);
    if (!isInsideWorldBounds(position, bounds)) return [];
    const spacecraft = requireSpacecraft(trip.spacecraftKey);
    if (trip.userId !== userId) {
      const scanned = scannerBypass || isPointVisible(coverages, position);
      // Civil traffic outside the scanner is a bare blip; military traffic stays dark.
      if (!scanned && MILITARY_TRIP_PURPOSES.has(trip.purpose)) return [];
      return [
        {
          kind: 'radar_contact',
          id: trip.id,
          ...position,
          observedAt: now.toISOString(),
          signature: scanned ? spacecraft.role : null,
        },
      ];
    }
    return [
      {
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
      },
    ];
  });

  const visibleMissions = missions.flatMap((mission): VisibleWorldMovement[] => {
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
    const position = interpolateWorldPosition(path, now);
    if (!isInsideWorldBounds(position, bounds)) return [];
    if (mission.userId !== userId) {
      return scannerBypass || isPointVisible(coverages, position)
        ? [
            {
              kind: 'radar_contact',
              id: mission.id,
              ...position,
              observedAt: now.toISOString(),
              signature: spacecraft.role,
            },
          ]
        : [];
    }
    return [
      {
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
      },
    ];
  });

  return [...visibleTrips, ...visibleMissions];
}
