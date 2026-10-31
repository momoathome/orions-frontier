import { and, between, eq, exists, inArray, or, sql } from 'drizzle-orm';
import { required, type ResourceKey } from '@orions-frontier/shared';
import type { getDb, QueryDb, Tx } from '../../../lib/db/index.js';
import { asteroidAssignments, asteroids, asteroidVeins } from '../../../lib/db/schema/asteroids.js';
import { spacecraftTrips } from '../../../lib/db/schema/spacecraft-trips.js';
import { stations } from '../../../lib/db/schema/stations.js';

/** Narrowed db so world generation and seeding can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;
type ScannerDb = Pick<ReturnType<typeof getDb>, 'select' | 'selectDistinct'>;

export interface ChunkBounds {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

/** Resources a viewer's research reveals; veins of other resources stay hidden. */
type VisibleResources = readonly ResourceKey[];

const visibleKeysSql = (resourceKeys: VisibleResources) =>
  sql.join(
    resourceKeys.map((key) => sql`${key}`),
    sql`, `
  );

// Drizzle renders columns unqualified in single-table selects, so `id` would bind to `v.id`.
const outerAsteroidId = sql.raw('"asteroids"."id"');

/** First visible vein by rank: primary, then secondary, then trace. */
const visiblePrimaryResourceSql = (resourceKeys: VisibleResources) =>
  sql<ResourceKey>`(
    SELECT v.resource_key FROM asteroid_veins v
    WHERE v.asteroid_id = ${outerAsteroidId} AND v.resource_key IN (${visibleKeysSql(resourceKeys)})
    ORDER BY CASE v.vein_type WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, v.id
    LIMIT 1
  )`;

// Only asteroids with visible ore left exist for a viewer; a mined-out one would betray its hidden veins.
const hasVisibleOreSql = (resourceKeys: VisibleResources) =>
  sql`EXISTS (
    SELECT 1 FROM asteroid_veins v
    WHERE v.asteroid_id = ${outerAsteroidId} AND v.resource_key IN (${visibleKeysSql(resourceKeys)})
      AND v.remaining_amount > 0
  )`;

export async function insertAsteroids(db: InsertDb, rows: (typeof asteroids.$inferInsert)[]) {
  await db.insert(asteroids).values(rows);
}

export async function insertAsteroidVeins(
  db: InsertDb,
  rows: (typeof asteroidVeins.$inferInsert)[]
) {
  await db.insert(asteroidVeins).values(rows);
}

/** The asteroid if the viewer can see ore left in it; otherwise it does not exist for them. */
export async function findVisibleAsteroid(db: QueryDb, id: string, resourceKeys: VisibleResources) {
  const [row] = await db
    .select()
    .from(asteroids)
    .where(and(eq(asteroids.id, id), hasVisibleOreSql(resourceKeys)))
    .limit(1);
  return row;
}

export async function findAsteroidForUpdate(tx: Tx, id: string) {
  const [row] = await tx.select().from(asteroids).where(eq(asteroids.id, id)).for('update');
  return row;
}

/**
 * Asteroids in the chunk range with a visible vein, their first visible resource and the
 * remaining fraction of their visible veins.
 */
export function listAsteroidSummariesInChunks(
  db: QueryDb,
  bounds: ChunkBounds,
  resourceKeys: VisibleResources
) {
  return db
    .select({
      id: asteroids.id,
      x: asteroids.x,
      y: asteroids.y,
      chunkX: asteroids.chunkX,
      chunkY: asteroids.chunkY,
      size: asteroids.size,
      primaryResourceKey: visiblePrimaryResourceSql(resourceKeys),
      remainingFraction: sql<number>`(
        SELECT LEAST(1, COALESCE(SUM(v.remaining_amount)::float / NULLIF(SUM(v.initial_amount), 0), 1))
        FROM asteroid_veins v
        WHERE v.asteroid_id = ${outerAsteroidId} AND v.resource_key IN (${visibleKeysSql(resourceKeys)})
      )`,
    })
    .from(asteroids)
    .where(
      and(
        between(asteroids.chunkX, bounds.minChunkX, bounds.maxChunkX),
        between(asteroids.chunkY, bounds.minChunkY, bounds.maxChunkY),
        hasVisibleOreSql(resourceKeys)
      )
    );
}

export function listAsteroidVeins(db: QueryDb, asteroidId: string, resourceKeys: VisibleResources) {
  return db
    .select()
    .from(asteroidVeins)
    .where(
      and(
        eq(asteroidVeins.asteroidId, asteroidId),
        inArray(asteroidVeins.resourceKey, [...resourceKeys])
      )
    );
}

/** Locks the asteroid's visible veins oldest first, so concurrent claims cannot deadlock. */
export function listAsteroidVeinsForUpdate(
  tx: Tx,
  asteroidId: string,
  resourceKeys: VisibleResources
) {
  return tx
    .select({
      id: asteroidVeins.id,
      resourceKey: asteroidVeins.resourceKey,
      remainingAmount: asteroidVeins.remainingAmount,
    })
    .from(asteroidVeins)
    .where(
      and(
        eq(asteroidVeins.asteroidId, asteroidId),
        inArray(asteroidVeins.resourceKey, [...resourceKeys])
      )
    )
    .orderBy(asteroidVeins.createdAt, asteroidVeins.id)
    .for('update');
}

export async function updateAsteroidVeinRemaining(tx: Tx, id: string, remainingAmount: number) {
  await tx.update(asteroidVeins).set({ remainingAmount }).where(eq(asteroidVeins.id, id));
}

/** Total reserve left in the asteroid's veins, only the visible ones if given; 0 if none. */
export async function sumAsteroidRemainingAmount(
  db: QueryDb,
  asteroidId: string,
  resourceKeys?: VisibleResources
) {
  const [reserve] = await db
    .select({ amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::int` })
    .from(asteroidVeins)
    .where(
      and(
        eq(asteroidVeins.asteroidId, asteroidId),
        resourceKeys ? inArray(asteroidVeins.resourceKey, [...resourceKeys]) : undefined
      )
    );
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

/** The station's assignments with asteroid position, size, visible resource and reserve left. */
export function listStationAssignmentsWithAsteroid(
  db: QueryDb,
  stationId: string,
  resourceKeys: VisibleResources
) {
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
      asteroidPrimaryResourceKey: visiblePrimaryResourceSql(resourceKeys),
      asteroidRemainingAmount: sql<number>`(
        SELECT COALESCE(SUM(v.remaining_amount), 0)::int
        FROM asteroid_veins v
        WHERE v.asteroid_id = ${outerAsteroidId} AND v.resource_key IN (${visibleKeysSql(resourceKeys)})
      )`,
    })
    .from(asteroidAssignments)
    .innerJoin(asteroids, eq(asteroids.id, asteroidAssignments.asteroidId))
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
export async function listWorkedAsteroidIdsByUser(db: ScannerDb, userId: string) {
  // EXISTS stops at the first return per assignment, so the trip history does not add up.
  const rows = await db
    .selectDistinct({ asteroidId: asteroidAssignments.asteroidId })
    .from(asteroidAssignments)
    .innerJoin(stations, eq(stations.id, asteroidAssignments.stationId))
    .where(
      and(
        eq(stations.userId, userId),
        exists(
          db
            .select({ one: sql`1` })
            .from(spacecraftTrips)
            .where(
              and(
                eq(spacecraftTrips.assignmentId, asteroidAssignments.id),
                eq(spacecraftTrips.purpose, 'mining_return')
              )
            )
        )
      )
    );
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

/** Locks the assignment and returns it with its station and asteroid positions. */
export async function findAssignmentRouteForUpdate(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: asteroidAssignments.id,
      stationId: asteroidAssignments.stationId,
      asteroidId: asteroidAssignments.asteroidId,
      assignedAmount: asteroidAssignments.assignedAmount,
      spacecraftKey: asteroidAssignments.spacecraftKey,
      stationX: stations.x,
      stationY: stations.y,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
    })
    .from(asteroidAssignments)
    .innerJoin(stations, eq(asteroidAssignments.stationId, stations.id))
    .innerJoin(asteroids, eq(asteroidAssignments.asteroidId, asteroids.id))
    .where(eq(asteroidAssignments.id, id))
    .for('update', { of: asteroidAssignments });
  return row;
}

export async function updateAsteroidAssignment(
  tx: Tx,
  id: string,
  values: Partial<typeof asteroidAssignments.$inferInsert>
) {
  await tx.update(asteroidAssignments).set(values).where(eq(asteroidAssignments.id, id));
}

export async function deleteAsteroidAssignment(tx: Tx, id: string) {
  await tx.delete(asteroidAssignments).where(eq(asteroidAssignments.id, id));
}

export async function hasAsteroidAssignments(db: QueryDb, asteroidId: string) {
  const [row] = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.asteroidId, asteroidId))
    .limit(1);
  return row !== undefined;
}

export async function deleteAsteroid(tx: Tx, id: string) {
  await tx.delete(asteroids).where(eq(asteroids.id, id));
}

export function listAsteroidAssignmentsByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select()
    .from(asteroidAssignments)
    .where(inArray(asteroidAssignments.stationId, stationIds));
}

/** One row per visible vein of every asteroid in any of the chunk ranges. */
export function listAsteroidVeinsInChunks(
  db: QueryDb,
  bounds: readonly ChunkBounds[],
  resourceKeys: VisibleResources
) {
  return db
    .select({
      id: asteroids.id,
      x: asteroids.x,
      y: asteroids.y,
      resourceKey: asteroidVeins.resourceKey,
      remainingAmount: asteroidVeins.remainingAmount,
    })
    .from(asteroids)
    .innerJoin(asteroidVeins, eq(asteroidVeins.asteroidId, asteroids.id))
    .where(
      and(
        inArray(asteroidVeins.resourceKey, [...resourceKeys]),
        or(
          ...bounds.map((bound) =>
            and(
              between(asteroids.chunkX, bound.minChunkX, bound.maxChunkX),
              between(asteroids.chunkY, bound.minChunkY, bound.maxChunkY)
            )
          )
        )
      )
    );
}
