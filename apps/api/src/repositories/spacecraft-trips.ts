import { and, eq, gte, inArray } from 'drizzle-orm';
import { required, type ResourceMap } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { asteroidAssignments } from '../lib/db/schema/asteroids.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';

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
