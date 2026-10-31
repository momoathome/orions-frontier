import { and, asc, eq, gt, inArray, lte, max } from 'drizzle-orm';
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

/** When each busy production slot of the station's shipyard ends its last order. */
export function listBuildSlotEnds(db: QueryDb, stationId: string) {
  return db
    .select({ slot: spacecraftBuildOrders.slot, endsAt: max(spacecraftBuildOrders.endsAt) })
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId))
    .groupBy(spacecraftBuildOrders.slot);
}

export async function insertBuildOrder(tx: Tx, values: typeof spacecraftBuildOrders.$inferInsert) {
  await tx.insert(spacecraftBuildOrders).values(values);
}

/** Deletes the order unless its next ship is due by `now`; returns the ships it still had. */
export async function deleteBuildOrderBefore(tx: Tx, id: string, now: Date) {
  const [deleted] = await tx
    .delete(spacecraftBuildOrders)
    .where(and(eq(spacecraftBuildOrders.id, id), gt(spacecraftBuildOrders.nextAt, now)))
    .returning({ amount: spacecraftBuildOrders.amount });
  return deleted?.amount;
}

export async function updateBuildOrderTimes(tx: Tx, id: string, nextAt: Date, endsAt: Date) {
  await tx
    .update(spacecraftBuildOrders)
    .set({ nextAt, endsAt })
    .where(eq(spacecraftBuildOrders.id, id));
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

/** Build orders with a ship due by `now`, oldest first, with the station owner. */
export function listDueBuildOrders(db: QueryDb, now: Date) {
  return db
    .select({
      id: spacecraftBuildOrders.id,
      stationId: spacecraftBuildOrders.stationId,
      spacecraftKey: spacecraftBuildOrders.spacecraftKey,
      amount: spacecraftBuildOrders.amount,
      orderedAmount: spacecraftBuildOrders.orderedAmount,
      stepMs: spacecraftBuildOrders.stepMs,
      nextAt: spacecraftBuildOrders.nextAt,
      userId: stations.userId,
    })
    .from(spacecraftBuildOrders)
    .innerJoin(stations, eq(spacecraftBuildOrders.stationId, stations.id))
    .where(lte(spacecraftBuildOrders.nextAt, now))
    .orderBy(asc(spacecraftBuildOrders.nextAt), asc(spacecraftBuildOrders.id));
}

/**
 * Takes `built` ships off an order that still has `amount` left, deleting it with the last one.
 * False if another tick or a cancel changed the order first.
 */
export async function claimBuiltShips(
  tx: Tx,
  id: string,
  amount: number,
  built: number,
  nextAt: Date
) {
  const unchanged = and(eq(spacecraftBuildOrders.id, id), eq(spacecraftBuildOrders.amount, amount));
  const [claimed] =
    built >= amount
      ? await tx
          .delete(spacecraftBuildOrders)
          .where(unchanged)
          .returning({ id: spacecraftBuildOrders.id })
      : await tx
          .update(spacecraftBuildOrders)
          .set({ amount: amount - built, nextAt })
          .where(unchanged)
          .returning({ id: spacecraftBuildOrders.id });
  return claimed !== undefined;
}
