import { desc, eq } from 'drizzle-orm';
import type { QueryDb } from '../lib/db/index.js';
import { logbookEntries } from '../lib/db/schema/logbook-entries.js';

export type NewLogbookEntry = typeof logbookEntries.$inferInsert;

/** Skips entries whose event was already recorded. */
export async function insertLogbookEntries(db: QueryDb, rows: NewLogbookEntry[]) {
  await db.insert(logbookEntries).values(rows).onConflictDoNothing();
}

export function listLogbookEntriesByUser(db: QueryDb, userId: string, limit: number) {
  return db
    .select()
    .from(logbookEntries)
    .where(eq(logbookEntries.userId, userId))
    .orderBy(desc(logbookEntries.occurredAt), desc(logbookEntries.eventId))
    .limit(limit);
}
