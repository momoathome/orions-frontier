import { sql } from 'drizzle-orm';
import { pgTable, uuid, integer, timestamp, index, unique, varchar } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';

export const stationBuildings = pgTable(
  'station_buildings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    buildingKey: varchar('building_key', { length: 64 }).notNull(),
    level: integer('level').notNull().default(1),
    upgradeEndsAt: timestamp('upgrade_ends_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('station_buildings_station_id_idx').on(table.stationId),
    // The simulation polls due upgrades every second; only running upgrades belong in this index.
    index('station_buildings_upgrade_ends_at_idx')
      .on(table.upgradeEndsAt)
      .where(sql`${table.upgradeEndsAt} IS NOT NULL`),
    unique('station_buildings_station_id_building_key_unique').on(
      table.stationId,
      table.buildingKey
    ),
  ]
);
