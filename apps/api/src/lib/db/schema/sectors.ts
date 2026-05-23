import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  json,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// sectors — Persistent metadata for independently-generated world sectors.
//
// Each sector has its own seed, archetype, and coordinate in the infinite grid.
// Coordinate rules:
//   sectorCenterX = sectorX * SECTOR_WIDTH   (currently 8000 world units)
//   sectorCenterY = sectorY * SECTOR_HEIGHT
//   sector (0,0) is centred at world origin.
// ============================================================================

export const sectors = pgTable(
  'sectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Sector grid column — negative = west of origin */
    sectorX: integer('sector_x').notNull(),
    /** Sector grid row — negative = north of origin */
    sectorY: integer('sector_y').notNull(),
    /** Archetype id (e.g. 'balanced', 'crystal-belt') */
    archetypeId: varchar('archetype_id', { length: 64 }).notNull(),
    /** Deterministic per-sector seed used during generation */
    seed: varchar('seed', { length: 256 }).notNull(),
    /** Gameplay identity tags inherited from the archetype */
    gameplayTags: json('gameplay_tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    coordsUnique:  uniqueIndex('sectors_coords_unique').on(table.sectorX, table.sectorY),
    archetypeIdx:  index('sectors_archetype_id_idx').on(table.archetypeId),
  }),
);
// Cross-table relations (sectors → asteroids / spawn_slots) are defined in
// schema/index.ts to avoid circular imports.
