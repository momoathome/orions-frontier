import type { LogbookEntryType } from '@orions-frontier/shared';
import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const logbookEntries = pgTable(
  'logbook_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Deterministic completion event id; makes recording idempotent. */
    eventId: varchar('event_id', { length: 255 }).notNull(),
    type: varchar('type', { length: 32 }).$type<LogbookEntryType>().notNull(),
    /** Not a foreign key: entries outlive abandoned or destroyed stations. */
    stationId: uuid('station_id'),
    summary: varchar('summary', { length: 255 }).notNull(),
    occurredAt: timestamp('occurred_at').notNull(),
  },
  (table) => [
    uniqueIndex('logbook_entries_user_event_idx').on(table.userId, table.eventId),
    index('logbook_entries_user_occurred_idx').on(table.userId, table.occurredAt),
  ]
);
