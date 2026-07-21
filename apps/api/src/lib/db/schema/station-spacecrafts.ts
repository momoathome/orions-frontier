import { pgTable, uuid, integer, timestamp, index, unique, varchar } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';

export const stationSpacecrafts = pgTable(
  'station_spacecrafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    spacecraftKey: varchar('spacecraft_key', { length: 64 }).notNull(),
    amount: integer('amount').notNull().default(0),
    lockedAmount: integer('locked_amount').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    stationDefinitionUnique: unique('station_spacecrafts_station_id_spacecraft_key_unique').on(
      table.stationId,
      table.spacecraftKey
    ),
    stationIdIdx: index('station_spacecrafts_station_id_idx').on(table.stationId),
  })
);
