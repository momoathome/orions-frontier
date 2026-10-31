import { and, asc, eq, gt, inArray, isNotNull, lte, min, sql } from 'drizzle-orm';
import type { BuildingUpgradeCost } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { userResearch } from '../../../lib/db/schema/user-research.js';

export type UserResearchRow = typeof userResearch.$inferSelect;

/**
 * Serializes research starts and cancels of one account. An advisory lock instead of the users row,
 * so it cannot form a cycle with station locks or user foreign-key locks taken elsewhere.
 */
export async function lockUserResearch(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'research:' + userId}))`);
}

export function listUserResearch(db: QueryDb, userId: string) {
  return db.select().from(userResearch).where(eq(userResearch.userId, userId));
}

export function listUserResearchByUsers(db: QueryDb, userIds: string[]) {
  return db.select().from(userResearch).where(inArray(userResearch.userId, userIds));
}

/** Research of the station's owner, for effects that start at a station. */
export function listStationOwnerResearch(db: QueryDb, stationId: string) {
  return db
    .select({ technologyKey: userResearch.technologyKey, level: userResearch.level })
    .from(userResearch)
    .innerJoin(stations, eq(stations.userId, userResearch.userId))
    .where(eq(stations.id, stationId));
}

/** Starts the next level unless one is already running; false if it was. */
export async function startResearchLevel(
  tx: Tx,
  values: {
    id: string;
    userId: string;
    technologyKey: string;
    startedAt: Date;
    completesAt: Date;
    paidByStationId: string;
    paidCost: BuildingUpgradeCost[];
  }
): Promise<boolean> {
  const [row] = await tx
    .insert(userResearch)
    .values({ ...values, updatedAt: values.startedAt })
    .onConflictDoUpdate({
      target: [userResearch.userId, userResearch.technologyKey],
      set: {
        startedAt: values.startedAt,
        completesAt: values.completesAt,
        paidByStationId: values.paidByStationId,
        paidCost: values.paidCost,
        updatedAt: values.startedAt,
      },
      setWhere: sql`${userResearch.completesAt} is null`,
    })
    .returning({ id: userResearch.id });
  return row !== undefined;
}

/** Earliest research completion in (after, now]; null if none. */
export async function findNextResearchDueAt(db: QueryDb, after: Date | null, now: Date) {
  const [row] = await db
    .select({ at: min(userResearch.completesAt) })
    .from(userResearch)
    .where(
      and(
        lte(userResearch.completesAt, now),
        after ? gt(userResearch.completesAt, after) : undefined
      )
    );
  return row?.at ?? null;
}

/** Research due by `now`, oldest first. */
export function listDueResearch(db: QueryDb, now: Date) {
  return db
    .select()
    .from(userResearch)
    .where(lte(userResearch.completesAt, now))
    .orderBy(asc(userResearch.completesAt), asc(userResearch.id));
}

/** Raises the level if the research is still due; undefined if another worker or a cancel won. */
export async function completeResearchLevel(db: QueryDb, id: string, now: Date) {
  const [row] = await db
    .update(userResearch)
    .set({
      level: sql`${userResearch.level} + 1`,
      startedAt: null,
      completesAt: null,
      paidByStationId: null,
      paidCost: null,
      updatedAt: now,
    })
    .where(and(eq(userResearch.id, id), lte(userResearch.completesAt, now)))
    .returning({ level: userResearch.level });
  return row;
}

/** Stops research that is not due yet; returns the paying station, undefined if nothing ran. */
export async function cancelResearchLevel(
  tx: Tx,
  userId: string,
  technologyKey: string,
  now: Date
) {
  const [row] = await tx
    .update(userResearch)
    // paid_by_station_id stays, it only counts while completes_at is set.
    .set({ startedAt: null, completesAt: null, updatedAt: now })
    .where(
      and(
        eq(userResearch.userId, userId),
        eq(userResearch.technologyKey, technologyKey),
        isNotNull(userResearch.completesAt),
        gt(userResearch.completesAt, now)
      )
    )
    .returning({
      level: userResearch.level,
      paidByStationId: userResearch.paidByStationId,
      paidCost: userResearch.paidCost,
    });
  return row;
}
