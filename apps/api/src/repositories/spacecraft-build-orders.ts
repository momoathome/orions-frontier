import { and, eq, max } from 'drizzle-orm';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { spacecraftBuildOrders } from '../lib/db/schema/spacecraft-build-orders.js';

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

/** When the station's queue for that spacecraft ends; null or undefined if it is empty. */
export async function findLatestBuildOrderEnd(
  db: QueryDb,
  stationId: string,
  spacecraftKey: string
) {
  const [row] = await db
    .select({ maxEndsAt: max(spacecraftBuildOrders.endsAt) })
    .from(spacecraftBuildOrders)
    .where(
      and(
        eq(spacecraftBuildOrders.stationId, stationId),
        eq(spacecraftBuildOrders.spacecraftKey, spacecraftKey)
      )
    );
  return row?.maxEndsAt;
}

export async function insertBuildOrder(tx: Tx, values: typeof spacecraftBuildOrders.$inferInsert) {
  await tx.insert(spacecraftBuildOrders).values(values);
}
