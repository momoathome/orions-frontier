import {
  doublePrecision,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { spacecraftDefinitions } from './spacecraft-definitions.js';
import { stationSpacecrafts } from './station-spacecrafts.js';
import { stations } from './stations.js';
import { users } from './users.js';

export const worldMissions = pgTable(
  'world_missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originStationId: uuid('origin_station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    stationSpacecraftId: uuid('station_spacecraft_id')
      .notNull()
      .references(() => stationSpacecrafts.id),
    spacecraftDefinitionId: uuid('spacecraft_definition_id')
      .notNull()
      .references(() => spacecraftDefinitions.id),
    missionType: varchar('mission_type', { length: 16 }).notNull(),
    targetSectorX: integer('target_sector_x').notNull(),
    targetSectorY: integer('target_sector_y').notNull(),
    targetX: doublePrecision('target_x'),
    targetY: doublePrecision('target_y'),
    colonyName: varchar('colony_name', { length: 128 }),
    departedAt: timestamp('departed_at').notNull(),
    arrivesAt: timestamp('arrives_at').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('traveling'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    dueIdx: index('world_missions_due_idx').on(table.status, table.arrivesAt),
    userIdx: index('world_missions_user_id_idx').on(table.userId),
  })
);
