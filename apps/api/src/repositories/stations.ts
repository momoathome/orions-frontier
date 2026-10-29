import { and, between, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { getDb, QueryDb, Tx } from '../lib/db/index.js';
import { asteroids } from '../lib/db/schema/asteroids.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { users } from '../lib/db/schema/users.js';
import type { ChunkBounds } from './asteroids.js';

export type StationRow = typeof stations.$inferSelect;

/** Narrowed db so scanner checks can run on a transaction or a stub. */
type SelectDb = Pick<ReturnType<typeof getDb>, 'select'>;

export async function findStation(db: QueryDb, id: string) {
  const [row] = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
  return row;
}

/** The station, unless it was destroyed. */
export async function findActiveStation(db: QueryDb, id: string) {
  const [row] = await db
    .select()
    .from(stations)
    .where(and(eq(stations.id, id), isNull(stations.destroyedAt)))
    .limit(1);
  return row;
}

export async function updateStation(
  tx: Tx,
  id: string,
  values: Partial<typeof stations.$inferInsert>
) {
  await tx.update(stations).set(values).where(eq(stations.id, id));
}

/** The user's station, unless it was destroyed. */
export async function findOwnedStation(db: QueryDb, stationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(stations)
    .where(
      and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
    )
    .limit(1);
  return row;
}

/** Locks the user's station, unless it was destroyed. */
export async function findOwnedStationForUpdate(tx: Tx, stationId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(stations)
    .where(
      and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
    )
    .for('update');
  return row;
}

export function listStationOwners(db: QueryDb, ids: string[]) {
  return db
    .select({ id: stations.id, userId: stations.userId })
    .from(stations)
    .where(inArray(stations.id, ids));
}

/** Every station that still stands, with its owner and whether a bot controls them. */
export function listActiveStationOwners(db: QueryDb) {
  return db
    .select({
      stationId: stations.id,
      userId: users.id,
      username: users.username,
      botUserId: botControllers.userId,
    })
    .from(stations)
    .innerJoin(users, eq(users.id, stations.userId))
    .leftJoin(botControllers, eq(botControllers.userId, users.id))
    .where(isNull(stations.destroyedAt));
}

/** The user's stations with their scanner level (destroyed stations included). */
export function listScannerStationsByUser(db: SelectDb, userId: string) {
  return db
    .select({
      stationId: stations.id,
      x: stations.x,
      y: stations.y,
      level: stationBuildings.level,
    })
    .from(stations)
    .innerJoin(
      stationBuildings,
      and(eq(stationBuildings.stationId, stations.id), eq(stationBuildings.buildingKey, 'scanner'))
    )
    .where(eq(stations.userId, userId));
}

export async function findStationForUpdate(tx: Tx, id: string) {
  const [row] = await tx.select().from(stations).where(eq(stations.id, id)).for('update');
  return row;
}

/** The user's stations that were not destroyed. */
export function listActiveStationsByUser(db: QueryDb, userId: string) {
  return db
    .select()
    .from(stations)
    .where(and(eq(stations.userId, userId), isNull(stations.destroyedAt)));
}

/** One row per station the user ever founded, destroyed ones included. */
export function listStationDestroyedAtByUser(db: QueryDb, userId: string) {
  return db
    .select({ destroyedAt: stations.destroyedAt })
    .from(stations)
    .where(eq(stations.userId, userId));
}

/** The user's station in that sector, unless it was destroyed. */
export async function findOwnedStationInSector(db: QueryDb, userId: string, sectorId: string) {
  const [row] = await db
    .select()
    .from(stations)
    .where(
      and(
        eq(stations.userId, userId),
        eq(stations.sectorId, sectorId),
        isNull(stations.destroyedAt)
      )
    )
    .limit(1);
  return row;
}

/** Serializes station founding for the rest of the transaction. */
export async function lockStationCreation(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(1869772101)`);
}

export async function insertStation(tx: Tx, values: typeof stations.$inferInsert) {
  const [row] = await tx.insert(stations).values(values).returning();
  return row;
}

/** Standing stations in the chunk range with owner protection, bot flag and integrity. */
export function listStationsInChunks(db: QueryDb, bounds: ChunkBounds) {
  return db
    .select({
      id: stations.id,
      userId: stations.userId,
      name: stations.name,
      x: stations.x,
      y: stations.y,
      botUserId: botControllers.userId,
      ownerCreatedAt: users.createdAt,
      protectedUntil: users.protectedUntil,
      attackProtectionBrokenAt: users.attackProtectionBrokenAt,
      integrity: stations.integrity,
      integrityUpdatedAt: stations.integrityUpdatedAt,
    })
    .from(stations)
    .innerJoin(users, eq(users.id, stations.userId))
    .leftJoin(botControllers, eq(botControllers.userId, stations.userId))
    .where(
      and(
        between(stations.chunkX, bounds.minChunkX, bounds.maxChunkX),
        between(stations.chunkY, bounds.minChunkY, bounds.maxChunkY),
        isNull(stations.destroyedAt)
      )
    );
}

/**
 * Positions of the user's standing station and the asteroid, with the station's free ships of
 * that type; undefined if any of the three is missing.
 */
export async function findMiningRoute(
  db: QueryDb,
  params: { stationId: string; userId: string; spacecraftKey: string; asteroidId: string }
) {
  const { stationId, userId, spacecraftKey, asteroidId } = params;
  const [row] = await db
    .select({
      stationX: stations.x,
      stationY: stations.y,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      available: sql<number>`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount}`,
    })
    .from(stations)
    .innerJoin(
      stationSpacecrafts,
      and(
        eq(stationSpacecrafts.stationId, stations.id),
        eq(stationSpacecrafts.spacecraftKey, spacecraftKey)
      )
    )
    .innerJoin(asteroids, eq(asteroids.id, asteroidId))
    .where(
      and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
    )
    .limit(1);
  return row;
}

/** Positions of the user's other stations that still stand. */
export function listOtherActiveStationPositionsByUser(
  db: QueryDb,
  userId: string,
  exceptStationId: string
) {
  return db
    .select({ id: stations.id, x: stations.x, y: stations.y })
    .from(stations)
    .where(
      and(
        eq(stations.userId, userId),
        ne(stations.id, exceptStationId),
        isNull(stations.destroyedAt)
      )
    );
}
