import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { WORLD_CONFIG } from '../lib/world-config.js';
import { asteroids } from '../lib/db/schema/asteroids.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import type { VisibleStation, VisibleWorldTrip } from '@orions-frontier/shared';

export interface WorldChunkRange {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

const worldBounds = (range: WorldChunkRange) => ({
  minX: range.minChunkX * WORLD_CONFIG.CHUNK_SIZE,
  maxX: (range.maxChunkX + 1) * WORLD_CONFIG.CHUNK_SIZE,
  minY: range.minChunkY * WORLD_CONFIG.CHUNK_SIZE,
  maxY: (range.maxChunkY + 1) * WORLD_CONFIG.CHUNK_SIZE,
});

export async function getVisibleChunkStations(
  range: WorldChunkRange,
  userId: string
): Promise<VisibleStation[]> {
  const db = getDb();
  const bounds = worldBounds(range);
  const rows = await db
    .select({
      id: stations.id,
      userId: stations.userId,
      name: stations.name,
      x: stations.x,
      y: stations.y,
      botUserId: botControllers.userId,
    })
    .from(stations)
    .leftJoin(botControllers, eq(botControllers.userId, stations.userId))
    .where(
      and(
        gte(stations.x, bounds.minX),
        lt(stations.x, bounds.maxX),
        gte(stations.y, bounds.minY),
        lt(stations.y, bounds.maxY)
      )
    );

  return rows.map((station) => ({
    id: station.id,
    name: station.name,
    x: station.x,
    y: station.y,
    chunkX: Math.floor(station.x / WORLD_CONFIG.CHUNK_SIZE),
    chunkY: Math.floor(station.y / WORLD_CONFIG.CHUNK_SIZE),
    ownerType: station.botUserId ? 'bot' : 'player',
    isOwn: station.userId === userId,
  }));
}

export async function getVisibleWorldTrips(
  range: WorldChunkRange,
  now = new Date()
): Promise<VisibleWorldTrip[]> {
  const db = getDb();
  // ponytail: scanning active trips is sufficient for one sector; add spatial persistence when
  // measured world size makes this query expensive.
  const trips = await db
    .select({
      id: spacecraftTrips.id,
      fromType: spacecraftTrips.fromType,
      fromId: spacecraftTrips.fromId,
      toType: spacecraftTrips.toType,
      toId: spacecraftTrips.toId,
      departedAt: spacecraftTrips.departedAt,
      arrivesAt: spacecraftTrips.arrivesAt,
      purpose: spacecraftTrips.purpose,
      groupSize: spacecraftTrips.groupSize,
      name: spacecraftDefinitions.name,
      image: spacecraftDefinitions.image,
      role: spacecraftDefinitions.role,
      botUserId: botControllers.userId,
    })
    .from(spacecraftTrips)
    .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .innerJoin(stations, eq(stationSpacecrafts.stationId, stations.id))
    .leftJoin(botControllers, eq(botControllers.userId, stations.userId))
    .where(eq(spacecraftTrips.status, 'traveling'));

  const stationIds = [
    ...new Set(
      trips.flatMap((trip) => [
        ...(trip.fromType === 'station' ? [trip.fromId] : []),
        ...(trip.toType === 'station' ? [trip.toId] : []),
      ])
    ),
  ];
  const asteroidIds = [
    ...new Set(
      trips.flatMap((trip) => [
        ...(trip.fromType === 'asteroid' ? [trip.fromId] : []),
        ...(trip.toType === 'asteroid' ? [trip.toId] : []),
      ])
    ),
  ];
  const [stationRows, asteroidRows] = await Promise.all([
    stationIds.length
      ? db
          .select({ id: stations.id, x: stations.x, y: stations.y })
          .from(stations)
          .where(inArray(stations.id, stationIds))
      : [],
    asteroidIds.length
      ? db
          .select({ id: asteroids.id, x: asteroids.x, y: asteroids.y })
          .from(asteroids)
          .where(inArray(asteroids.id, asteroidIds))
      : [],
  ]);
  const positions = new Map(
    [...stationRows, ...asteroidRows].map((position) => [position.id, position])
  );
  const bounds = worldBounds(range);

  return trips.flatMap((trip): VisibleWorldTrip[] => {
    const from = positions.get(trip.fromId);
    const to = positions.get(trip.toId);
    if (!from || !to) return [];
    const duration = trip.arrivesAt.getTime() - trip.departedAt.getTime();
    const progress =
      now < trip.departedAt
        ? 0
        : duration <= 0
          ? 1
          : Math.max(0, Math.min(1, (now.getTime() - trip.departedAt.getTime()) / duration));
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    if (x < bounds.minX || x >= bounds.maxX || y < bounds.minY || y >= bounds.maxY) return [];

    return [
      {
        id: trip.id,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        departedAt: trip.departedAt.toISOString(),
        arrivesAt: trip.arrivesAt.toISOString(),
        purpose: trip.purpose,
        groupSize: trip.groupSize,
        ownerType: trip.botUserId ? 'bot' : 'player',
        spacecraft: {
          name: trip.name,
          image: trip.image,
          role: trip.role as VisibleWorldTrip['spacecraft']['role'],
        },
      },
    ];
  });
}
