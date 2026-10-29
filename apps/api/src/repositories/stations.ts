import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { QueryDb } from '../lib/db/index.js';
import { stations } from '../lib/db/schema/stations.js';

export type StationRow = typeof stations.$inferSelect;

export async function findStation(db: QueryDb, id: string) {
  const [row] = await db.select().from(stations).where(eq(stations.id, id)).limit(1);
  return row;
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

export function listStationOwners(db: QueryDb, ids: string[]) {
  return db
    .select({ id: stations.id, userId: stations.userId })
    .from(stations)
    .where(inArray(stations.id, ids));
}
