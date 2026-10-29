import { and, between, eq, sql } from 'drizzle-orm';
import type { getDb, QueryDb } from '../lib/db/index.js';
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
