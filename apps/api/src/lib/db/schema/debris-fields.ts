import { index, integer, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sectors } from './sectors.js';
import { spacecraftTrips } from './spacecraft-trips.js';
import { stationSpacecrafts } from './station-spacecrafts.js';
import { stations } from './stations.js';
import { users } from './users.js';

export const debrisFields = pgTable(
  'debris_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectorId: uuid('sector_id')
      .notNull()
      .references(() => sectors.id),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    chunkX: integer('chunk_x').notNull(),
    chunkY: integer('chunk_y').notNull(),
    resources: jsonb('resources').$type<Record<string, number>>().notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    chunkIdx: index('debris_fields_chunk_idx').on(table.chunkX, table.chunkY),
    sectorIdx: index('debris_fields_sector_id_idx').on(table.sectorId),
  })
);

export const salvageMissions = pgTable(
  'salvage_missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    debrisFieldId: uuid('debris_field_id').references(() => debrisFields.id),
    stationSpacecraftId: uuid('station_spacecraft_id')
      .notNull()
      .references(() => stationSpacecrafts.id),
    outboundTripId: uuid('outbound_trip_id')
      .notNull()
      .references(() => spacecraftTrips.id),
    returnTripId: uuid('return_trip_id').references(() => spacecraftTrips.id),
    amount: integer('amount').notNull(),
    cargo: jsonb('cargo').$type<Record<string, number>>(),
    status: varchar('status', { length: 16 })
      .$type<'traveling' | 'returning' | 'resolved'>()
      .notNull()
      .default('traveling'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => ({
    userIdx: index('salvage_missions_user_id_idx').on(table.userId),
    debrisIdx: index('salvage_missions_debris_field_id_idx').on(table.debrisFieldId),
  })
);
