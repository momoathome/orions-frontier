import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { stationResearch } from '../lib/db/schema/station-research.js';
import { stations } from '../lib/db/schema/stations.js';

export function listStationResearch(db: QueryDb, stationId: string) {
  return db.select().from(stationResearch).where(eq(stationResearch.stationId, stationId));
}

export function listCompletedResearchByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select({ stationId: stationResearch.stationId, technologyKey: stationResearch.technologyKey })
    .from(stationResearch)
    .where(
      and(inArray(stationResearch.stationId, stationIds), eq(stationResearch.status, 'completed'))
    );
}

export async function hasCompletedResearch(
  db: QueryDb,
  stationId: string,
  technologyKey: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: stationResearch.id })
    .from(stationResearch)
    .where(
      and(
        eq(stationResearch.stationId, stationId),
        eq(stationResearch.technologyKey, technologyKey),
        eq(stationResearch.status, 'completed')
      )
    );
  return Boolean(row);
}

export async function insertStationResearch(tx: Tx, values: typeof stationResearch.$inferInsert) {
  await tx.insert(stationResearch).values(values);
}

/** Research due by `now`, oldest first, with the station owner. */
export function listDueResearch(db: QueryDb, now: Date) {
  return db
    .select({
      id: stationResearch.id,
      stationId: stationResearch.stationId,
      userId: stations.userId,
      technologyKey: stationResearch.technologyKey,
      completesAt: stationResearch.completesAt,
    })
    .from(stationResearch)
    .innerJoin(stations, eq(stations.id, stationResearch.stationId))
    .where(and(eq(stationResearch.status, 'researching'), lte(stationResearch.completesAt, now)))
    .orderBy(asc(stationResearch.completesAt), asc(stationResearch.id));
}

/** Marks due research completed; false if another worker already did. Atomic under concurrency. */
export async function claimDueResearch(db: QueryDb, id: string, completedAt: Date, now: Date) {
  const [claimed] = await db
    .update(stationResearch)
    .set({ status: 'completed', completedAt })
    .where(
      and(
        eq(stationResearch.id, id),
        eq(stationResearch.status, 'researching'),
        lte(stationResearch.completesAt, now)
      )
    )
    .returning({ id: stationResearch.id });
  return claimed !== undefined;
}
