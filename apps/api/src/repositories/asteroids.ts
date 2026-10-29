import { and, between, eq, sql } from 'drizzle-orm';
import { required } from '@orions-frontier/shared';
import type { getDb, QueryDb, Tx } from '../lib/db/index.js';
import { asteroidAssignments, asteroids, asteroidVeins } from '../lib/db/schema/asteroids.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stations } from '../lib/db/schema/stations.js';

/** Narrowed db so world generation and seeding can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;
type SelectDistinctDb = Pick<ReturnType<typeof getDb>, 'selectDistinct'>;

export interface ChunkBounds {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export async function insertAsteroids(db: InsertDb, rows: (typeof asteroids.$inferInsert)[]) {
  await db.insert(asteroids).values(rows);
}

export async function insertAsteroidVeins(
  db: InsertDb,
  rows: (typeof asteroidVeins.$inferInsert)[]
) {
  await db.insert(asteroidVeins).values(rows);
}

export async function findAsteroid(db: QueryDb, id: string) {
  const [row] = await db.select().from(asteroids).where(eq(asteroids.id, id)).limit(1);
  return row;
}

export async function findAsteroidForUpdate(tx: Tx, id: string) {
  const [row] = await tx.select().from(asteroids).where(eq(asteroids.id, id)).for('update');
  return row;
}

/** Asteroids in the chunk range with their primary resource and remaining reserve fraction. */
export function listAsteroidSummariesInChunks(db: QueryDb, bounds: ChunkBounds) {
  return db
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
        between(asteroids.chunkX, bounds.minChunkX, bounds.maxChunkX),
        between(asteroids.chunkY, bounds.minChunkY, bounds.maxChunkY)
      )
    );
}

export function listAsteroidVeins(db: QueryDb, asteroidId: string) {
  return db.select().from(asteroidVeins).where(eq(asteroidVeins.asteroidId, asteroidId));
}

/** Locks the asteroid's veins oldest first, so concurrent claims cannot deadlock. */
export function listAsteroidVeinsForUpdate(tx: Tx, asteroidId: string) {
  return tx
    .select({
      id: asteroidVeins.id,
      resourceKey: asteroidVeins.resourceKey,
      remainingAmount: asteroidVeins.remainingAmount,
    })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId))
    .orderBy(asteroidVeins.createdAt, asteroidVeins.id)
    .for('update');
}

export async function updateAsteroidVeinRemaining(tx: Tx, id: string, remainingAmount: number) {
  await tx.update(asteroidVeins).set({ remainingAmount }).where(eq(asteroidVeins.id, id));
}

/** Total reserve left in the asteroid's veins; 0 if it has none. */
export async function sumAsteroidRemainingAmount(db: QueryDb, asteroidId: string) {
  const [reserve] = await db
    .select({ amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::int` })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId));
  return reserve?.amount ?? 0;
}

/** Returns the new assignment's id. */
export async function insertAsteroidAssignment(
  tx: Tx,
  values: typeof asteroidAssignments.$inferInsert
) {
  const [assignment] = await tx
    .insert(asteroidAssignments)
    .values(values)
    .returning({ id: asteroidAssignments.id });
  return required(assignment, 'assignment').id;
}

/**
 * Adds `amount` ships to the recall request of the user's assignment; false if it is not
 * theirs or fewer than that are still unrecalled. Atomic under concurrency.
 */
export async function addAssignmentRecallRequest(
  db: QueryDb,
  params: {
    assignmentId: string;
    asteroidId: string;
    userId: string;
    amount: number;
    requestedAt: Date;
  }
) {
  const { amount } = params;
  const result = await db
    .update(asteroidAssignments)
    .set({
      recallRequestedAt: params.requestedAt,
      recallRequestedAmount: sql`${asteroidAssignments.recallRequestedAmount} + ${amount}`,
    })
    .from(stations)
    .where(
      and(
        eq(asteroidAssignments.id, params.assignmentId),
        eq(asteroidAssignments.asteroidId, params.asteroidId),
        eq(asteroidAssignments.stationId, stations.id),
        eq(stations.userId, params.userId),
        sql`${asteroidAssignments.assignedAmount} - ${asteroidAssignments.recallRequestedAmount} >= ${amount}`
      )
    )
    .returning({ id: asteroidAssignments.id });
  return result.length > 0;
}

/** The station's assignments with asteroid position, size, primary resource and reserve left. */
export function listStationAssignmentsWithAsteroid(db: QueryDb, stationId: string) {
  return db
    .select({
      id: asteroidAssignments.id,
      asteroidId: asteroidAssignments.asteroidId,
      spacecraftKey: asteroidAssignments.spacecraftKey,
      assignedAmount: asteroidAssignments.assignedAmount,
      assignedAt: asteroidAssignments.assignedAt,
      status: asteroidAssignments.status,
      recallRequestedAt: asteroidAssignments.recallRequestedAt,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      asteroidSize: asteroids.size,
      asteroidPrimaryResourceKey: asteroidVeins.resourceKey,
      asteroidRemainingAmount: sql<number>`(
        SELECT COALESCE(SUM(v.remaining_amount), 0)::int
        FROM asteroid_veins v WHERE v.asteroid_id = ${asteroids.id}
      )`,
    })
    .from(asteroidAssignments)
    .innerJoin(asteroids, eq(asteroids.id, asteroidAssignments.asteroidId))
    .leftJoin(
      asteroidVeins,
      and(
        eq(asteroidVeins.asteroidId, asteroidAssignments.asteroidId),
        eq(asteroidVeins.veinType, 'primary')
      )
    )
    .where(eq(asteroidAssignments.stationId, stationId));
}

/** Assignments on one asteroid with the user owning each assigned station. */
export function listAsteroidAssignmentsWithOwner(db: QueryDb, asteroidId: string) {
  return db
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
    .where(eq(asteroidAssignments.asteroidId, asteroidId));
}

/** Asteroids the user's miners have already worked, i.e. returned cargo from. */
export async function listWorkedAsteroidIdsByUser(db: SelectDistinctDb, userId: string) {
  const rows = await db
    .selectDistinct({ asteroidId: asteroidAssignments.asteroidId })
    .from(asteroidAssignments)
    .innerJoin(stations, eq(stations.id, asteroidAssignments.stationId))
    .innerJoin(
      spacecraftTrips,
      and(
        eq(spacecraftTrips.assignmentId, asteroidAssignments.id),
        eq(spacecraftTrips.purpose, 'mining_return')
      )
    )
    .where(eq(stations.userId, userId));
  return rows.map((row) => row.asteroidId);
}

export async function deleteStationAssignments(tx: Tx, stationId: string) {
  await tx.delete(asteroidAssignments).where(eq(asteroidAssignments.stationId, stationId));
}

export function listAsteroidPositionsInSector(db: QueryDb, sectorId: string) {
  return db
    .select({ x: asteroids.x, y: asteroids.y })
    .from(asteroids)
    .where(eq(asteroids.sectorId, sectorId));
}
