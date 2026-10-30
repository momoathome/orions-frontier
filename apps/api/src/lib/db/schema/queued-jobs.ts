import type { BuildingUpgradeCost, QueuedJobKind } from '@orions-frontier/shared';
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { stations } from './stations.js';
import { users } from './users.js';

/** Paid jobs waiting for a slot; building and defense per station, research per account. */
export const queuedJobs = pgTable(
  'queued_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Queue order. */
    seq: serial('seq').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The upgraded station, or the station that paid for research. */
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).$type<QueuedJobKind>().notNull(),
    key: varchar('key', { length: 64 }).notNull(),
    targetLevel: integer('target_level').notNull(),
    /** Refunded in full when the job is removed or dropped. */
    paidCost: jsonb('paid_cost').$type<BuildingUpgradeCost[]>().notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('queued_jobs_station_id_idx').on(table.stationId),
    index('queued_jobs_user_id_idx').on(table.userId),
  ]
);
