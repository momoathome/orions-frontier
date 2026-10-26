import type { SectorRole } from '../../world-gen/types.js';
import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sectors = pgTable(
  'sectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectorX: integer('sector_x').notNull(),
    sectorY: integer('sector_y').notNull(),
    role: varchar('role', { length: 16 }).$type<SectorRole>().notNull(),
    seed: varchar('seed', { length: 256 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sectors_coords_unique').on(table.sectorX, table.sectorY),
    index('sectors_role_idx').on(table.role),
  ]
);
