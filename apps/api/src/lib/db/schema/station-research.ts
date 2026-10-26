import { index, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';

export const stationResearch = pgTable(
  'station_research',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    technologyKey: varchar('technology_key', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 })
      .$type<'researching' | 'completed'>()
      .notNull()
      .default('researching'),
    completesAt: timestamp('completes_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    unique('station_research_station_technology_unique').on(table.stationId, table.technologyKey),
    index('station_research_status_completes_at_idx').on(table.status, table.completesAt),
  ]
);
