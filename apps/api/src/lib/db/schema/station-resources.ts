import { pgTable, uuid, varchar, bigint, index, primaryKey } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';

export const stationResources = pgTable(
  'station_resources',
  {
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    resourceKey: varchar('resource_key', { length: 64 }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.stationId, table.resourceKey] }),
    stationIdIdx: index('station_resources_station_id_idx').on(table.stationId),
  })
);
