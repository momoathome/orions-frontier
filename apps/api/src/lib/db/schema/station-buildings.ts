import { pgTable, uuid, integer, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { stations } from './stations.js';
import { buildingDefinitions } from './building-definitions.js';

export const stationBuildings = pgTable(
  'station_buildings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    buildingDefinitionId: uuid('building_definition_id')
      .notNull()
      .references(() => buildingDefinitions.id),
    level: integer('level').notNull().default(1),
    upgradeEndsAt: timestamp('upgrade_ends_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    stationIdIdx: index('station_buildings_station_id_idx').on(table.stationId),
    uniqueStationBuilding: unique('station_buildings_station_id_building_definition_id_unique').on(
      table.stationId,
      table.buildingDefinitionId
    ),
  })
);
