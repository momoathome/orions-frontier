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
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('stations_user_id_idx').on(table.userId),
    sectorIdIdx: index('stations_sector_id_idx').on(table.sectorId),
    chunkIdx: index('stations_chunk_idx').on(table.chunkX, table.chunkY),
  })
);
