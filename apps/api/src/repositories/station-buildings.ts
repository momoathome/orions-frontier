import { and, eq, inArray } from 'drizzle-orm';
import type { getDb, QueryDb, Tx } from '../lib/db/index.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';

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
