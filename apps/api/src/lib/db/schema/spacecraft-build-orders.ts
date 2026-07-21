import { pgTable, uuid, integer, timestamp, index, varchar } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';

export const spacecraftBuildOrders = pgTable(
  'spacecraft_build_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    spacecraftKey: varchar('spacecraft_key', { length: 64 }).notNull(),
    amount: integer('amount').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    stationIdIdx: index('spacecraft_build_orders_station_id_idx').on(table.stationId),
    spacecraftKeyIdx: index('spacecraft_build_orders_spacecraft_key_idx').on(table.spacecraftKey),
  })
);
