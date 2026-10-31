import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { BuildingUpgradeCost } from '@orions-frontier/shared';
import { stations } from './stations.js';
import { users } from './users.js';

/** Account-wide research level per technology; `completesAt` is set while the next level runs. */
export const userResearch = pgTable(
  'user_research',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    technologyKey: varchar('technology_key', { length: 64 }).notNull(),
    level: integer('level').notNull().default(0),
    startedAt: timestamp('started_at'),
    completesAt: timestamp('completes_at'),
    /** Station that paid for the running level; refunds on cancel go back to it. */
    paidByStationId: uuid('paid_by_station_id').references(() => stations.id, {
      onDelete: 'set null',
    }),
    /** What the running level cost; a cancel refunds exactly this. */
    paidCost: jsonb('paid_cost').$type<BuildingUpgradeCost[]>(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('user_research_user_technology_unique').on(table.userId, table.technologyKey),
    index('user_research_completes_at_idx').on(table.completesAt),
    check(
      'user_research_running_has_cost',
      sql`${table.completesAt} IS NULL OR ${table.paidCost} IS NOT NULL`
    ),
  ]
);
