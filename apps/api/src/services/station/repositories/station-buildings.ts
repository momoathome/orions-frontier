import { and, asc, eq, gt, inArray, isNull, lte, min, sql } from 'drizzle-orm';
import type { getDb, QueryDb, Tx } from '../../../lib/db/index.js';
import { stationBuildings } from '../../../lib/db/schema/station-buildings.js';
import { stations } from '../../../lib/db/schema/stations.js';

export type StationBuildingRow = typeof stationBuildings.$inferSelect;

/** Narrowed db so station seeding can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;

/** Skips buildings the station already has. */
export async function insertStationBuildingsIfMissing(
  db: InsertDb,
  rows: (typeof stationBuildings.$inferInsert)[]
) {
  await db.insert(stationBuildings).values(rows).onConflictDoNothing();
}

/** Returns the new row, or undefined if the station already has that building. */
export async function insertStationBuildingIfMissing(
  tx: Tx,
  values: typeof stationBuildings.$inferInsert
) {
  const [row] = await tx.insert(stationBuildings).values(values).onConflictDoNothing().returning();
  return row;
}

export async function deleteStationBuildings(tx: Tx, stationId: string) {
  await tx.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
}

export function listStationBuildings(db: QueryDb, stationId: string) {
  return db.select().from(stationBuildings).where(eq(stationBuildings.stationId, stationId));
}

export function listBuildingLevels(db: QueryDb, stationId: string) {
  return db
    .select({ buildingKey: stationBuildings.buildingKey, level: stationBuildings.level })
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, stationId));
}

export async function findStationBuildingByKeyForUpdate(
  tx: Tx,
  stationId: string,
  buildingKey: string
) {
  const [row] = await tx
    .select()
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, buildingKey))
    )
    .limit(1)
    .for('update');
  return row;
}

export async function updateStationBuilding(
  tx: Tx,
  id: string,
  values: Partial<typeof stationBuildings.$inferInsert>
) {
  await tx.update(stationBuildings).set(values).where(eq(stationBuildings.id, id));
}

export function listBuildingLevelsByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select({
      stationId: stationBuildings.stationId,
      buildingKey: stationBuildings.buildingKey,
      level: stationBuildings.level,
    })
    .from(stationBuildings)
    .where(inArray(stationBuildings.stationId, stationIds));
}

/** Level of one building; undefined if the station has no such row. */
export async function findBuildingLevel(db: QueryDb, stationId: string, buildingKey: string) {
  const [row] = await db
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, buildingKey))
    )
    .limit(1);
  return row?.level;
}

export function listStationBuildingsByStations(db: QueryDb, stationIds: string[]) {
  return db.select().from(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
}

/** Earliest upgrade end in (after, now]; null if none. */
export async function findNextBuildingUpgradeDueAt(db: QueryDb, after: Date | null, now: Date) {
  const [row] = await db
    .select({ at: min(stationBuildings.upgradeEndsAt) })
    .from(stationBuildings)
    .where(
      and(
        lte(stationBuildings.upgradeEndsAt, now),
        after ? gt(stationBuildings.upgradeEndsAt, after) : undefined
      )
    );
  return row?.at ?? null;
}

/** Upgrades due by `now`, oldest first, with the station owner. */
export function listDueBuildingUpgrades(db: QueryDb, now: Date) {
  return db
    .select({
      id: stationBuildings.id,
      stationId: stationBuildings.stationId,
      userId: stations.userId,
      buildingKey: stationBuildings.buildingKey,
      upgradeEndsAt: stationBuildings.upgradeEndsAt,
    })
    .from(stationBuildings)
    .innerJoin(stations, eq(stationBuildings.stationId, stations.id))
    .where(lte(stationBuildings.upgradeEndsAt, now))
    .orderBy(asc(stationBuildings.upgradeEndsAt), asc(stationBuildings.id));
}

/** Raises the level up to `maxLevel` if the upgrade is still due; undefined if it no longer is. */
export async function completeBuildingUpgrade(
  db: QueryDb,
  id: string,
  maxLevel: number,
  completedAt: Date,
  now: Date
) {
  const [completed] = await db
    .update(stationBuildings)
    .set({
      level: sql`least(${stationBuildings.level} + 1, ${maxLevel})`,
      upgradeEndsAt: null,
      upgradePaidCost: null,
      updatedAt: completedAt,
    })
    .where(and(eq(stationBuildings.id, id), lte(stationBuildings.upgradeEndsAt, now)))
    .returning({ level: stationBuildings.level });
  return completed;
}

/** Highest level of each building across the user's active stations. */
export function listHighestBuildingLevelsByUser(db: QueryDb, userId: string) {
  return db
    .select({
      buildingKey: stationBuildings.buildingKey,
      level: sql<number>`max(${stationBuildings.level})::int`,
    })
    .from(stationBuildings)
    .innerJoin(stations, eq(stations.id, stationBuildings.stationId))
    .where(and(eq(stations.userId, userId), isNull(stations.destroyedAt)))
    .groupBy(stationBuildings.buildingKey);
}
