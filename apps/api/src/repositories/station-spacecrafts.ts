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

export function listStationSpacecraftIdsByKeys(db: QueryDb, stationId: string, keys: string[]) {
  return db
    .select({ id: stationSpacecrafts.id, spacecraftKey: stationSpacecrafts.spacecraftKey })
    .from(stationSpacecrafts)
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        inArray(stationSpacecrafts.spacecraftKey, keys)
      )
    );
}

export function listStationSpacecraftsForUpdate(tx: Tx, stationId: string) {
  return tx
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId))
    .for('update');
}

/** Removes ships lost in flight: they leave the fleet and their lock. */
export async function removeLockedSpacecraft(tx: Tx, id: string, amount: number) {
  await tx
    .update(stationSpacecrafts)
    .set({
      amount: sql`${stationSpacecrafts.amount} - ${amount}`,
      lockedAmount: sql`${stationSpacecrafts.lockedAmount} - ${amount}`,
    })
    .where(eq(stationSpacecrafts.id, id));
}

/** Removes docked ships; the caller has verified that enough are free. */
export async function removeSpacecraft(tx: Tx, id: string, amount: number) {
  await tx
    .update(stationSpacecrafts)
    .set({
      amount: sql`${stationSpacecrafts.amount} - ${amount}`,
    })
    .where(eq(stationSpacecrafts.id, id));
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

/** Adds ships as locked (still travelling), creating the fleet row if needed; returns its id. */
export async function addLockedSpacecraft(
  tx: Tx,
  values: {
    id: string;
    stationId: string;
    spacecraftKey: string;
    amount: number;
    createdAt: Date;
    updatedAt: Date;
  }
) {
  const { amount } = values;
  const [row] = await tx
    .insert(stationSpacecrafts)
    .values({ ...values, lockedAmount: amount })
    .onConflictDoUpdate({
      target: [stationSpacecrafts.stationId, stationSpacecrafts.spacecraftKey],
      set: {
        amount: sql`${stationSpacecrafts.amount} + ${amount}`,
        lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${amount}`,
      },
    })
    .returning({ id: stationSpacecrafts.id });
  return row?.id;
}

/** Like `releaseSpacecraft`, but never below zero. */
export async function releaseSpacecraftClamped(tx: Tx, id: string, amount: number) {
  await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`greatest(0, ${stationSpacecrafts.lockedAmount} - ${amount})` })
    .where(eq(stationSpacecrafts.id, id));
}

/** Empties every fleet row of the station. */
export async function clearStationSpacecrafts(tx: Tx, stationId: string, updatedAt: Date) {
  await tx
    .update(stationSpacecrafts)
    .set({ amount: 0, lockedAmount: 0, updatedAt })
    .where(eq(stationSpacecrafts.stationId, stationId));
}
