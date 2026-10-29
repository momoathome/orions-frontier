import { and, eq, inArray, sql } from 'drizzle-orm';
import type { getDb, QueryDb, Tx } from '../lib/db/index.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';

export type StationSpacecraftRow = typeof stationSpacecrafts.$inferSelect;

/** Narrowed db so station seeding can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function insertStationSpacecrafts(
  db: InsertDb,
  rows: (typeof stationSpacecrafts.$inferInsert)[]
) {
  await db.insert(stationSpacecrafts).values(rows);
}

/** Creates the fleet row unless the station already has one for that spacecraft. */
export async function insertStationSpacecraftIfMissing(
  tx: Tx,
  values: typeof stationSpacecrafts.$inferInsert
) {
  await tx.insert(stationSpacecrafts).values(values).onConflictDoNothing();
}

export function listStationSpacecrafts(db: QueryDb, stationId: string) {
  return db.select().from(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
}

export function listSpacecraftAmounts(db: QueryDb, stationId: string) {
  return db
    .select({
      spacecraftKey: stationSpacecrafts.spacecraftKey,
      amount: stationSpacecrafts.amount,
    })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
}

export function listStationSpacecraftIds(db: QueryDb, stationId: string) {
  return db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
}

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
