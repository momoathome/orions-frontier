import { and, asc, eq, inArray } from 'drizzle-orm';
import type { QueryDb, Tx } from '../../../lib/db/index.js';
import { queuedJobs } from '../../../lib/db/schema/queued-jobs.js';

export type QueuedJobRow = typeof queuedJobs.$inferSelect;

/** Building and defense jobs of one station, in queue order. */
export function listStationQueue(db: QueryDb, stationId: string) {
  return db
    .select()
    .from(queuedJobs)
    .where(
      and(eq(queuedJobs.stationId, stationId), inArray(queuedJobs.kind, ['building', 'defense']))
    )
    .orderBy(asc(queuedJobs.seq));
}

/** Research jobs of one account, in queue order. */
export function listResearchQueue(db: QueryDb, userId: string) {
  return db
    .select()
    .from(queuedJobs)
    .where(and(eq(queuedJobs.userId, userId), eq(queuedJobs.kind, 'research')))
    .orderBy(asc(queuedJobs.seq));
}

export async function insertQueuedJob(tx: Tx, values: typeof queuedJobs.$inferInsert) {
  await tx.insert(queuedJobs).values(values);
}

export async function deleteQueuedJob(tx: Tx, id: string) {
  await tx.delete(queuedJobs).where(eq(queuedJobs.id, id));
}

/** A destroyed station loses its waiting upgrades with the rest of its stock. */
export async function deleteStationQueue(tx: Tx, stationId: string) {
  await tx
    .delete(queuedJobs)
    .where(
      and(eq(queuedJobs.stationId, stationId), inArray(queuedJobs.kind, ['building', 'defense']))
    );
}
