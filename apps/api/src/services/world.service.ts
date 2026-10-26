import { and, between, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { WORLD_CONFIG } from '../lib/world-config.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { users } from '../lib/db/schema/users.js';
import { worldMissions } from '../lib/db/schema/world-missions.js';
import {
  required,
  AppError,
  ErrorCode,
  type VisibleStation,
  type VisibleWorldMovement,
} from '@orions-frontier/shared';
import { ATTACK_PROTECTION_DURATION_MS, requireSpacecraft } from '@orions-frontier/game-config';
import {
  getUserScannerCoverages,
  isPointVisible,
  visibleChunkBounds,
  type ScannerCoverage,
  type VisibilityProjectionStats,
} from './scanner-visibility.service.js';
import { getStationVisualProfiles } from './station-visual.service.js';

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
  const coverageBounds = scannerBypass
    ? [range]
    : visibleChunkBounds(coverages, range, WORLD_CONFIG.CHUNK_SIZE);
  const rows = await db
    .select({
      id: stations.id,
      userId: stations.userId,
      name: stations.name,
      x: stations.x,
      y: stations.y,
      botUserId: botControllers.userId,
      ownerCreatedAt: users.createdAt,
      attackProtectionBrokenAt: users.attackProtectionBrokenAt,
    })
    .from(stations)
    .innerJoin(users, eq(users.id, stations.userId))
    .leftJoin(botControllers, eq(botControllers.userId, stations.userId))
    .where(
      and(
        between(stations.chunkX, range.minChunkX, range.maxChunkX),
        between(stations.chunkY, range.minChunkY, range.maxChunkY),
        or(
          eq(stations.userId, userId),
          ...coverageBounds.map((bound) =>
            and(
              between(stations.chunkX, bound.minChunkX, bound.maxChunkX),
              between(stations.chunkY, bound.minChunkY, bound.maxChunkY)
            )
          )
        )
      )
    );
  if (stats) stats.stationCandidates = rows.length;

  const visibleRows = rows.flatMap((station) => {
    const isOwn = station.userId === userId;
    if (!scannerBypass && !isOwn && !isPointVisible(coverages, station)) return [];
    if (
      combatDiagnostics &&
      !isOwn &&
      !station.attackProtectionBrokenAt &&
      combatDiagnostics.now.getTime() <
        station.ownerCreatedAt.getTime() + ATTACK_PROTECTION_DURATION_MS
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
      },
    ];
  });
  const visualProfiles = await getStationVisualProfiles(visibleRows.map((station) => station.id));

  return visibleRows.map((station) => ({
    ...station,
    visualProfile: required(visualProfiles.get(station.id), `visual profile ${station.id}`),
  }));
}

interface TimedPath {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  departedAt: Date;
  arrivesAt: Date;
}

export function interpolateWorldPosition(path: TimedPath, now: Date) {
  const durationMs = path.arrivesAt.getTime() - path.departedAt.getTime();
  const progress =
    now < path.departedAt
      ? 0
      : durationMs <= 0
        ? 1
        : Math.max(0, Math.min(1, (now.getTime() - path.departedAt.getTime()) / durationMs));
  const moving = now >= path.departedAt && now < path.arrivesAt && durationMs > 0;
  return {
    x: path.fromX + (path.toX - path.fromX) * progress,
    y: path.fromY + (path.toY - path.fromY) * progress,
    velocityX: moving ? ((path.toX - path.fromX) / durationMs) * 1_000 : 0,
    velocityY: moving ? ((path.toY - path.fromY) / durationMs) * 1_000 : 0,
  };
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
  now = new Date(),
  scannerBypass = false
): Promise<VisibleWorldMovement[]> {
  const db = getDb();
  const [trips, missions, coverages] = await Promise.all([
    db
      .select({
        id: spacecraftTrips.id,
        fromX: spacecraftTrips.fromX,
        fromY: spacecraftTrips.fromY,
        toX: spacecraftTrips.toX,
        toY: spacecraftTrips.toY,
        departedAt: spacecraftTrips.departedAt,
        arrivesAt: spacecraftTrips.arrivesAt,
        purpose: spacecraftTrips.purpose,
        groupSize: spacecraftTrips.groupSize,
        spacecraftKey: stationSpacecrafts.spacecraftKey,
        userId: stations.userId,
        botUserId: botControllers.userId,
      })
      .from(spacecraftTrips)
      .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
      .innerJoin(stations, eq(stationSpacecrafts.stationId, stations.id))
      .leftJoin(botControllers, eq(botControllers.userId, stations.userId))
      .where(eq(spacecraftTrips.status, 'traveling')),
    db
      .select({
        id: worldMissions.id,
        fromX: stations.x,
        fromY: stations.y,
        targetSectorX: worldMissions.targetSectorX,
        targetSectorY: worldMissions.targetSectorY,
        targetX: worldMissions.targetX,
        targetY: worldMissions.targetY,
        departedAt: worldMissions.departedAt,
        arrivesAt: worldMissions.arrivesAt,
        status: worldMissions.status,
        purpose: worldMissions.missionType,
        spacecraftKey: worldMissions.spacecraftKey,
        userId: worldMissions.userId,
        botUserId: botControllers.userId,
      })
      .from(worldMissions)
      .innerJoin(stations, eq(worldMissions.originStationId, stations.id))
      .leftJoin(botControllers, eq(botControllers.userId, worldMissions.userId))
      .where(inArray(worldMissions.status, ['traveling', 'returning'])),
    scannerBypass ? Promise.resolve([]) : getUserScannerCoverages(userId),
  ]);
  const bounds = worldBounds(range);

  const visibleTrips = trips.flatMap((trip): VisibleWorldMovement[] => {
    const position = interpolateWorldPosition(trip, now);
    if (!isInsideWorldBounds(position, bounds)) return [];
    const spacecraft = requireSpacecraft(trip.spacecraftKey);
    if (trip.userId !== userId) {
      return scannerBypass || isPointVisible(coverages, position)
        ? [
            {
              kind: 'radar_contact',
              id: trip.id,
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
        id: trip.id,
        fromX: trip.fromX,
        fromY: trip.fromY,
        toX: trip.toX,
        toY: trip.toY,
        departedAt: trip.departedAt.toISOString(),
        arrivesAt: trip.arrivesAt.toISOString(),
        purpose: trip.purpose,
        groupSize: trip.groupSize,
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
