import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { required, type ResourceMap } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../../../lib/db/index.js';
import { asteroidAssignments } from '../../../lib/db/schema/asteroids.js';
import { botControllers } from '../../../lib/db/schema/bot-controllers.js';
import { spacecraftTrips } from '../../../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../../lib/db/schema/stations.js';

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

/** Locks the trips still traveling for these fleet rows. */
export function listTravelingTripsBySpacecraftForUpdate(tx: Tx, stationSpacecraftIds: string[]) {
  return tx
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        inArray(spacecraftTrips.stationSpacecraftId, stationSpacecraftIds),
        eq(spacecraftTrips.status, 'traveling')
      )
    )
    .for('update');
}

export async function cancelTrip(tx: Tx, id: string) {
  await tx.update(spacecraftTrips).set({ status: 'cancelled' }).where(eq(spacecraftTrips.id, id));
}

/** Ships of the assignment that are already flying home. */
export async function sumHomeboundGroupSize(db: QueryDb, assignmentId: string) {
  const [homebound] = await db
    .select({ amount: sql<number>`coalesce(sum(${spacecraftTrips.groupSize}), 0)::int` })
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  return homebound?.amount ?? 0;
}

export function listTravelingTripsBySpacecraft(db: QueryDb, stationSpacecraftIds: string[]) {
  return db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        inArray(spacecraftTrips.stationSpacecraftId, stationSpacecraftIds),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
}

/** Marks a traveling trip arrived; false if another worker or a cancellation got there first. */
export async function claimTripArrival(tx: Tx, id: string) {
  const [claimed] = await tx
    .update(spacecraftTrips)
    .set({ status: 'arrived' })
    .where(and(eq(spacecraftTrips.id, id), eq(spacecraftTrips.status, 'traveling')))
    .returning({ id: spacecraftTrips.id });
  return claimed !== undefined;
}

/** Traveling trips of the stations' fleets, with the station they belong to. */
export function listTravelingTripsByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select({
      id: spacecraftTrips.id,
      stationId: stationSpacecrafts.stationId,
      purpose: spacecraftTrips.purpose,
      status: spacecraftTrips.status,
      arrivesAt: spacecraftTrips.arrivesAt,
      toId: spacecraftTrips.toId,
    })
    .from(spacecraftTrips)
    .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
    .where(
      and(
        inArray(stationSpacecrafts.stationId, stationIds),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
}

/** Traveling trips due by `now`, oldest first, with the owner of the fleet. */
export function listDueTripsWithOwner(db: QueryDb, now: Date) {
  return db
    .select({ trip: spacecraftTrips, userId: stations.userId })
    .from(spacecraftTrips)
    .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
    .innerJoin(stations, eq(stationSpacecrafts.stationId, stations.id))
    .where(
      and(
        eq(spacecraftTrips.status, 'traveling'),
        lte(spacecraftTrips.arrivesAt, now),
        or(isNull(spacecraftTrips.retryAt), lte(spacecraftTrips.retryAt, now))
      )
    )
    .orderBy(asc(spacecraftTrips.arrivesAt), asc(spacecraftTrips.id));
}

/**
 * Counts a failed settle and waits before the next try: 2, 4, 8 … seconds, at most an hour, so
 * a broken trip stops costing every tick but still completes once its cause is fixed.
 */
export async function recordTripSettleFailure(db: QueryDb, id: string, now: Date) {
  const [row] = await db
    .update(spacecraftTrips)
    .set({
      settleFailures: sql`${spacecraftTrips.settleFailures} + 1`,
      retryAt: sql`${now.toISOString()}::timestamp + least(power(2, ${spacecraftTrips.settleFailures} + 1), 3600) * interval '1 second'`,
    })
    .where(eq(spacecraftTrips.id, id))
    .returning({ settleFailures: spacecraftTrips.settleFailures });
  return row?.settleFailures ?? 0;
}
