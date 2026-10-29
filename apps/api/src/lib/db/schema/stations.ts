import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { sectors } from './sectors.js';

export const stations = pgTable(
  'stations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 128 }).notNull(),
    sectorId: uuid('sector_id')
      .notNull()
      .references(() => sectors.id),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    chunkX: integer('chunk_x').notNull().default(0),
    chunkY: integer('chunk_y').notNull().default(0),
    /** Stored integrity; regeneration since integrityUpdatedAt is computed on read. */
    integrity: integer('integrity').notNull().default(100),
    integrityUpdatedAt: timestamp('integrity_updated_at').notNull().defaultNow(),
    /** Set once when integrity reaches 0; the row stays for reports and logbook. */
    destroyedAt: timestamp('destroyed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('stations_user_id_idx').on(table.userId),
    index('stations_sector_id_idx').on(table.sectorId),
    index('stations_chunk_idx').on(table.chunkX, table.chunkY),
  ]
);
