import { pgTable, uuid, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';
import { spacecraftDefinitions } from './spacecraft-definitions.js';

export const spacecraftBuildOrders = pgTable(
  'spacecraft_build_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    spacecraftDefinitionId: uuid('spacecraft_definition_id')
      .notNull()
      .references(() => spacecraftDefinitions.id),
    amount: integer('amount').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    stationIdIdx: index('spacecraft_build_orders_station_id_idx').on(table.stationId),
    definitionIdx: index('spacecraft_build_orders_definition_id_idx').on(
      table.spacecraftDefinitionId
    ),
  })
);
