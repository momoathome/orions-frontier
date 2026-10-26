import type { ResourceKey } from '@orions-frontier/shared';
import { pgTable, uuid, varchar, bigint, index, primaryKey } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';

export const stationResources = pgTable(
  'station_resources',
  {
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    resourceKey: varchar('resource_key', { length: 64 }).$type<ResourceKey>().notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.stationId, table.resourceKey] }),
    index('station_resources_station_id_idx').on(table.stationId),
  ]
);
