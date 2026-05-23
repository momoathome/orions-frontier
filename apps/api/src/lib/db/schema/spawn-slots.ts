import { pgTable, uuid, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { stations } from './stations.js';
import { sectors } from './sectors.js';

// ============================================================================
// spawn_slots — Pre-generated station spawn positions in the spawnRing zone.
// Generated once during world gen and stored here.
// A slot is "claimed" when station_id is set.
// ============================================================================

export const spawnSlots = pgTable(
  'spawn_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Deterministic index (0 = first slot, 1 = second slot, …) */
    slotIndex: integer('slot_index').notNull().unique(),
    /** World-space X coordinate of this spawn point */
    x: integer('x').notNull(),
    /** World-space Y coordinate of this spawn point */
    y: integer('y').notNull(),
    /** Set when a station occupies this slot; null = available */
    stationId: uuid('station_id').references(() => stations.id),
    /** Sector this spawn slot belongs to */
    sectorId: uuid('sector_id').references(() => sectors.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    stationIdIdx: index('spawn_slots_station_id_idx').on(table.stationId),
    sectorIdIdx: index('spawn_slots_sector_id_idx').on(table.sectorId),
  })
);

export const spawnSlotsRelations = relations(spawnSlots, ({ one }) => ({
  station: one(stations, {
    fields: [spawnSlots.stationId],
    references: [stations.id],
  }),
}));
