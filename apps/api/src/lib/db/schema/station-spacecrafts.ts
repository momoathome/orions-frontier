import { pgTable, uuid, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';
import { spacecraftDefinitions } from './spacecraft-definitions.js';

export const stationSpacecrafts = pgTable(
  'station_spacecrafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    spacecraftDefinitionId: uuid('spacecraft_definition_id')
      .notNull()
      .references(() => spacecraftDefinitions.id),
    amount: integer('amount').notNull().default(0),
    lockedAmount: integer('locked_amount').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    stationDefinitionUnique: unique(
      'station_spacecrafts_station_id_spacecraft_definition_id_unique'
    ).on(table.stationId, table.spacecraftDefinitionId),
    stationIdIdx: index('station_spacecrafts_station_id_idx').on(table.stationId),
  })
);

export type StationSpacecraft = typeof stationSpacecrafts.$inferSelect;
export type NewStationSpacecraft = typeof stationSpacecrafts.$inferInsert;
