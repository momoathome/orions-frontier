import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { stations } from './stations.js';
import { sectors } from './sectors.js';

export const spawnSlots = pgTable(
  'spawn_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slotIndex: integer('slot_index').notNull(),
    slotType: varchar('slot_type', { length: 16 }).notNull().default('player'),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    stationId: uuid('station_id').references(() => stations.id),
    sectorId: uuid('sector_id')
      .notNull()
      .references(() => sectors.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('spawn_slots_station_id_idx').on(table.stationId),
    index('spawn_slots_sector_id_idx').on(table.sectorId),
    uniqueIndex('spawn_slots_sector_slot_unique').on(table.sectorId, table.slotIndex),
    uniqueIndex('spawn_slots_station_id_unique').on(table.stationId),
  ]
);
