import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { entriesOf, type ResourceKey, type ResourceMap } from '@orions-frontier/shared';
import type { getDb, QueryDb, Tx } from '../lib/db/index.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';

/** Narrowed db so station seeding can pass a transaction or a stub. */
type InsertDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function insertStationResources(
  db: InsertDb,
  rows: (typeof stationResources.$inferInsert)[]
) {
  await db.insert(stationResources).values(rows);
}

export async function insertStationResource(tx: Tx, values: typeof stationResources.$inferInsert) {
  await tx.insert(stationResources).values(values);
}

export function listStationResources(db: QueryDb, stationId: string) {
  return db.select().from(stationResources).where(eq(stationResources.stationId, stationId));
}

/** Resources of the user's station, unless it was destroyed; empty if not theirs. */
export function listOwnedStationResources(db: QueryDb, stationId: string, userId: string) {
  return db
    .select({ resource: stationResources })
    .from(stationResources)
    .innerJoin(stations, eq(stationResources.stationId, stations.id))
    .where(
      and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
    );
}

export function listStationResourcesForUpdate(tx: Tx, stationId: string) {
  return tx
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId))
    .for('update');
}

/** Subtracts without checking; the caller has verified the stock. */
export async function deductStationResource(
  tx: Tx,
  stationId: string,
  resourceKey: ResourceKey,
  amount: number
) {
  await tx
    .update(stationResources)
    .set({ amount: sql`${stationResources.amount} - ${amount}` })
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, resourceKey))
    );
}

/**
 * Subtracts every cost only where the stock covers it, in resource key order so concurrent payers
 * cannot deadlock. Returns the first resource that falls short with its stock, or null once all
 * are paid; on a shortfall the caller must roll back what was already taken.
 */
export async function payStationCosts(
  tx: Tx,
  stationId: string,
  costs: ResourceMap
): Promise<{ resourceKey: ResourceKey; have: number } | null> {
  const ordered = entriesOf(costs).sort(([a], [b]) => a.localeCompare(b));
  for (const [resourceKey, amount] of ordered) {
    if (amount <= 0) continue;
    const row = and(
      eq(stationResources.stationId, stationId),
      eq(stationResources.resourceKey, resourceKey)
    );
    const [paid] = await tx
      .update(stationResources)
      .set({ amount: sql`${stationResources.amount} - ${amount}` })
      .where(and(row, gte(stationResources.amount, amount)))
      .returning({ resourceKey: stationResources.resourceKey });
    if (paid) continue;
    const [stock] = await tx
      .select({ amount: stationResources.amount })
      .from(stationResources)
      .where(row);
    return { resourceKey, have: stock?.amount ?? 0 };
  }
  return null;
}

/** Locks the rows in resource key order, so concurrent writers cannot deadlock. */
export function listStationResourcesInKeyOrderForUpdate(tx: Tx, stationId: string) {
  return tx
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId))
    .orderBy(stationResources.resourceKey)
    .for('update');
}

/** Overwrites the amount; false if the station has no row for that resource yet. */
export async function setStationResourceAmount(
  tx: Tx,
  stationId: string,
  resourceKey: ResourceKey,
  amount: number
) {
  const [updated] = await tx
    .update(stationResources)
    .set({ amount })
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, resourceKey))
    )
    .returning({ resourceKey: stationResources.resourceKey });
  return updated !== undefined;
}

export async function deleteStationResources(tx: Tx, stationId: string) {
  await tx.delete(stationResources).where(eq(stationResources.stationId, stationId));
}

export function listStationResourcesByStations(db: QueryDb, stationIds: string[]) {
  return db.select().from(stationResources).where(inArray(stationResources.stationId, stationIds));
}
