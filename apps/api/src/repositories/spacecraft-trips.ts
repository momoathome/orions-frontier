import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { required, type ResourceMap } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { asteroidAssignments } from '../lib/db/schema/asteroids.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';

export type TripRow = typeof spacecraftTrips.$inferSelect;

/** Returns the new trip's id. */
export async function insertTrip(tx: Tx, values: typeof spacecraftTrips.$inferInsert) {
  const [row] = await tx
    .insert(spacecraftTrips)
    .values(values)
    .returning({ id: spacecraftTrips.id });
  return required(row, 'trip').id;
}

export async function updateTripCargo(tx: Tx, id: string, cargoManifest: ResourceMap) {
  await tx.update(spacecraftTrips).set({ cargoManifest }).where(eq(spacecraftTrips.id, id));
}

/** Trips still traveling for any assignment on the asteroid. */
export function listTravelingTripsByAsteroid(db: QueryDb, asteroidId: string) {
  return db
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
    .where(
      and(eq(asteroidAssignments.asteroidId, asteroidId), eq(spacecraftTrips.status, 'traveling'))
    );
}

/** Mining returns that reached a station from these fleets since `since`. */
export function listMiningDeliveriesSince(
  db: QueryDb,
  stationSpacecraftIds: string[],
  since: Date
) {
  return db
    .select({
      cargoManifest: spacecraftTrips.cargoManifest,
      arrivesAt: spacecraftTrips.arrivesAt,
    })
    .from(spacecraftTrips)
    .where(
      and(
        inArray(spacecraftTrips.stationSpacecraftId, stationSpacecraftIds),
        eq(spacecraftTrips.status, 'arrived'),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.toType, 'station'),
        gte(spacecraftTrips.arrivesAt, since)
      )
    );
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Traveling trips whose path may cross the bounds, with spacecraft, owner and bot flag. */
export function listTravelingTripsInBounds(db: QueryDb, bounds: WorldBounds) {
  return db
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
      createdAt: spacecraftTrips.createdAt,
      spacecraftKey: stationSpacecrafts.spacecraftKey,
      userId: stations.userId,
      botUserId: botControllers.userId,
    })
    .from(spacecraftTrips)
    .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
    .innerJoin(stations, eq(stationSpacecrafts.stationId, stations.id))
    .leftJoin(botControllers, eq(botControllers.userId, stations.userId))
    .where(
      and(
        eq(spacecraftTrips.status, 'traveling'),
        // A trip's position stays on its straight path, so its bounding box must touch the view.
        sql`least(${spacecraftTrips.fromX}, ${spacecraftTrips.toX}) < ${bounds.maxX}`,
        sql`greatest(${spacecraftTrips.fromX}, ${spacecraftTrips.toX}) >= ${bounds.minX}`,
        sql`least(${spacecraftTrips.fromY}, ${spacecraftTrips.toY}) < ${bounds.maxY}`,
        sql`greatest(${spacecraftTrips.fromY}, ${spacecraftTrips.toY}) >= ${bounds.minY}`
      )
    );
}
