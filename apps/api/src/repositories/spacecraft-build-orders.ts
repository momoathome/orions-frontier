import { and, asc, eq, inArray, lte, max } from 'drizzle-orm';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { spacecraftBuildOrders } from '../lib/db/schema/spacecraft-build-orders.js';
import { stations } from '../lib/db/schema/stations.js';

export type BuildOrderRow = typeof spacecraftBuildOrders.$inferSelect;

export function listBuildOrders(db: QueryDb, stationId: string) {
  return db
    .select()
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));
}

export function listBuildOrderAmounts(db: QueryDb, stationId: string) {
  return db
    .select({
      spacecraftKey: spacecraftBuildOrders.spacecraftKey,
      amount: spacecraftBuildOrders.amount,
    })
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));
}

/** When the station's shipyard queue ends; null or undefined if it is empty. */
export async function findLatestBuildOrderEnd(db: QueryDb, stationId: string) {
  const [row] = await db
    .select({ maxEndsAt: max(spacecraftBuildOrders.endsAt) })
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  return row?.maxEndsAt;
}

export async function insertBuildOrder(tx: Tx, values: typeof spacecraftBuildOrders.$inferInsert) {
  await tx.insert(spacecraftBuildOrders).values(values);
}

export async function deleteBuildOrders(tx: Tx, stationId: string) {
  await tx.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
}

export function listBuildOrdersByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select()
    .from(spacecraftBuildOrders)
    .where(inArray(spacecraftBuildOrders.stationId, stationIds));
}

/** Build orders due by `now`, oldest first, with the station owner. */
export function listDueBuildOrders(db: QueryDb, now: Date) {
  return db
    .select({
      id: spacecraftBuildOrders.id,
      stationId: spacecraftBuildOrders.stationId,
      spacecraftKey: spacecraftBuildOrders.spacecraftKey,
      amount: spacecraftBuildOrders.amount,
      endsAt: spacecraftBuildOrders.endsAt,
      userId: stations.userId,
    })
    .from(spacecraftBuildOrders)
    .innerJoin(stations, eq(spacecraftBuildOrders.stationId, stations.id))
    .where(lte(spacecraftBuildOrders.endsAt, now))
    .orderBy(asc(spacecraftBuildOrders.endsAt), asc(spacecraftBuildOrders.id));
}

/** Deletes the order if it is still due; false if another tick completed it first. */
export async function claimDueBuildOrder(tx: Tx, id: string, now: Date) {
  const [claimed] = await tx
    .delete(spacecraftBuildOrders)
    .where(and(eq(spacecraftBuildOrders.id, id), lte(spacecraftBuildOrders.endsAt, now)))
    .returning({ id: spacecraftBuildOrders.id });
  return claimed !== undefined;
}
