import { pgTable, uuid, varchar, integer, index, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { stations } from './stations.js';

export const stationSpacecrafts = pgTable(
  'station_spacecrafts',
  {
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    spacecraftKey: varchar('spacecraft_key', { length: 64 }).notNull(),
    count: integer('count').notNull().default(0),
    lockedCount: integer('locked_count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.stationId, table.spacecraftKey] }),
    stationIdIdx: index('station_spacecrafts_station_id_idx').on(table.stationId),
  }),
);

export const stationSpacecraftsRelations = relations(stationSpacecrafts, ({ one }) => ({
  station: one(stations, {
    fields: [stationSpacecrafts.stationId],
    references: [stations.id],
  }),
}));

export type StationSpacecraft = typeof stationSpacecrafts.$inferSelect;
export type NewStationSpacecraft = typeof stationSpacecrafts.$inferInsert;
