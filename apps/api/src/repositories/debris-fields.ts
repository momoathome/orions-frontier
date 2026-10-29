import { and, between, eq, ne, or } from 'drizzle-orm';
import { required, type ResourceMap } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { debrisFields, salvageMissions } from '../lib/db/schema/debris-fields.js';

export type DebrisFieldRow = typeof debrisFields.$inferSelect;
export type SalvageMissionRow = typeof salvageMissions.$inferSelect;

export interface ChunkBounds {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export async function findDebrisField(db: QueryDb, id: string) {
  const [row] = await db.select().from(debrisFields).where(eq(debrisFields.id, id)).limit(1);
  return row;
}

export async function findDebrisFieldForUpdate(tx: Tx, id: string) {
  const [row] = await tx.select().from(debrisFields).where(eq(debrisFields.id, id)).for('update');
  return row;
}

export function listDebrisFieldsInChunks(db: QueryDb, bounds: readonly ChunkBounds[]) {
  return db
    .select()
    .from(debrisFields)
    .where(
      or(
        ...bounds.map((bound) =>
          and(
            between(debrisFields.chunkX, bound.minChunkX, bound.maxChunkX),
            between(debrisFields.chunkY, bound.minChunkY, bound.maxChunkY)
          )
        )
      )
    );
}

export async function insertDebrisField(tx: Tx, values: typeof debrisFields.$inferInsert) {
  await tx.insert(debrisFields).values(values);
}

export async function updateDebrisFieldResources(tx: Tx, id: string, resources: ResourceMap) {
  await tx.update(debrisFields).set({ resources }).where(eq(debrisFields.id, id));
}

export async function deleteDebrisField(tx: Tx, id: string) {
  await tx.delete(debrisFields).where(eq(debrisFields.id, id));
}

export function listSalvageMissionsByUser(db: QueryDb, userId: string) {
  return db.select().from(salvageMissions).where(eq(salvageMissions.userId, userId));
}

export async function insertSalvageMission(tx: Tx, values: typeof salvageMissions.$inferInsert) {
  const [row] = await tx.insert(salvageMissions).values(values).returning();
  return required(row, 'mission');
}

/** Locks the mission whose outbound trip this is, while it is still traveling. */
export async function findTravelingSalvageMissionForUpdate(tx: Tx, outboundTripId: string) {
  const [row] = await tx
    .select()
    .from(salvageMissions)
    .where(
      and(
        eq(salvageMissions.outboundTripId, outboundTripId),
        eq(salvageMissions.status, 'traveling')
      )
    )
    .for('update');
  return row;
}

/** Locks the mission whose return trip this is, while it is still returning. */
export async function findReturningSalvageMissionForUpdate(tx: Tx, returnTripId: string) {
  const [row] = await tx
    .select()
    .from(salvageMissions)
    .where(
      and(eq(salvageMissions.returnTripId, returnTripId), eq(salvageMissions.status, 'returning'))
    )
    .for('update');
  return row;
}

export async function updateSalvageMission(
  tx: Tx,
  id: string,
  values: Partial<typeof salvageMissions.$inferInsert>
) {
  await tx.update(salvageMissions).set(values).where(eq(salvageMissions.id, id));
}

export async function hasUnresolvedSalvageOnDebris(tx: Tx, debrisFieldId: string) {
  const [active] = await tx
    .select({ id: salvageMissions.id })
    .from(salvageMissions)
    .where(
      and(eq(salvageMissions.debrisFieldId, debrisFieldId), ne(salvageMissions.status, 'resolved'))
    )
    .limit(1);
  return active !== undefined;
}

/** Resolves the mission flying this trip, whatever its status. */
export async function resolveSalvageMissionByTrip(
  tx: Tx,
  leg: 'outbound' | 'return',
  tripId: string,
  resolvedAt: Date
) {
  const column = leg === 'outbound' ? salvageMissions.outboundTripId : salvageMissions.returnTripId;
  await tx
    .update(salvageMissions)
    .set({ status: 'resolved', resolvedAt })
    .where(eq(column, tripId));
}

export function listUnresolvedSalvageMissionsByUser(db: QueryDb, userId: string) {
  return db
    .select()
    .from(salvageMissions)
    .where(and(eq(salvageMissions.userId, userId), ne(salvageMissions.status, 'resolved')));
}
