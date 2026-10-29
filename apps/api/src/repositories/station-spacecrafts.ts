import { and, eq, inArray, sql } from 'drizzle-orm';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';

export type StationSpacecraftRow = typeof stationSpacecrafts.$inferSelect;

export async function findStationSpacecraft(db: QueryDb, id: string) {
  const [row] = await db
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, id))
    .limit(1);
  return row;
}

export async function findStationSpacecraftByKey(
  db: QueryDb,
  stationId: string,
  spacecraftKey: string
) {
  const [row] = await db
    .select()
    .from(stationSpacecrafts)
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        eq(stationSpacecrafts.spacecraftKey, spacecraftKey)
      )
    )
    .limit(1);
  return row;
}

/** Locks `amount` ships for a trip; false if fewer than that are free. Atomic under concurrency. */
export async function reserveSpacecraft(tx: Tx, id: string, amount: number) {
  const [locked] = await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${amount}` })
    .where(
      and(
        eq(stationSpacecrafts.id, id),
        sql`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount} >= ${amount}`
      )
    )
    .returning({ id: stationSpacecrafts.id });
  return locked !== undefined;
}

/** Frees ships locked by `reserveSpacecraft` once their trip is over. */
export async function releaseSpacecraft(tx: Tx, id: string, amount: number) {
  await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} - ${amount}` })
    .where(eq(stationSpacecrafts.id, id));
}

export function listSpacecraftAmountsByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select({
      stationId: stationSpacecrafts.stationId,
      spacecraftKey: stationSpacecrafts.spacecraftKey,
      amount: stationSpacecrafts.amount,
    })
    .from(stationSpacecrafts)
    .where(inArray(stationSpacecrafts.stationId, stationIds));
}
