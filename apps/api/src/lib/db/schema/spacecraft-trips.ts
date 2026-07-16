import { pgTable, uuid, integer, timestamp, jsonb, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { stationSpacecrafts } from './station-spacecrafts.js';

// ============================================================================
// spacecraft_trips — Time-based travel records for all spacecraft movement.
//
// All spacecraft (miners, transporters, fighters) travel in real time.
// Position during travel is interpolated client-side:
//   pos = from + (to - from) × ((now - departedAt) / (arrivesAt - departedAt))
//
// Resources are loaded into cargoManifest at departure (buffer decremented
// immediately) to prevent race conditions on the asteroid resource storage.
// ============================================================================

export const tripPurposeEnum = pgEnum('trip_purpose', [
  'mine', // Miner flying to asteroid to start mining
  'transport', // Transporter picking up resources
  'recall', // Miner self-recall: full buffer, flying resources to station
  'return', // Miner/transporter returning empty to asteroid/idle
  'combat', // Fighter heading to target
]);

export const tripStatusEnum = pgEnum('trip_status', ['traveling', 'arrived', 'cancelled']);

export const tripEndpointTypeEnum = pgEnum('trip_endpoint_type', ['station', 'asteroid']);

/** JSON shape stored in cargoManifest: { resourceKey: amount } */
export type CargoManifest = Record<string, number>;

export const spacecraftTrips = pgTable(
  'spacecraft_trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Which fleet entry owns the traveling ships */
    stationSpacecraftId: uuid('station_spacecraft_id')
      .notNull()
      .references(() => stationSpacecrafts.id, { onDelete: 'cascade' }),
    /** How many ships are part of this trip */
    groupSize: integer('group_size').notNull(),
    fromType: tripEndpointTypeEnum('from_type').notNull(),
    /** UUID of the station or asteroid this trip departs from */
    fromId: uuid('from_id').notNull(),
    toType: tripEndpointTypeEnum('to_type').notNull(),
    /** UUID of the station or asteroid this trip is heading to */
    toId: uuid('to_id').notNull(),
    departedAt: timestamp('departed_at').notNull(),
    /** Calculated: departedAt + (euclidean_distance / speed) * SPEED_FACTOR */
    arrivesAt: timestamp('arrives_at').notNull(),
    purpose: tripPurposeEnum('purpose').notNull(),
    /** Resources being carried. Null for empty legs (mine, return, combat). */
    cargoManifest: jsonb('cargo_manifest').$type<CargoManifest>(),
    status: tripStatusEnum('status').notNull().default('traveling'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    stationSpacecraftIdIdx: index('spacecraft_trips_station_spacecraft_id_idx').on(
      table.stationSpacecraftId
    ),
    statusIdx: index('spacecraft_trips_status_idx').on(table.status),
    arrivesAtIdx: index('spacecraft_trips_arrives_at_idx').on(table.arrivesAt),
    toIdIdx: index('spacecraft_trips_to_id_idx').on(table.toId),
  })
);

export const spacecraftTripsRelations = relations(spacecraftTrips, ({ one }) => ({
  stationSpacecraft: one(stationSpacecrafts, {
    fields: [spacecraftTrips.stationSpacecraftId],
    references: [stationSpacecrafts.id],
  }),
}));

export type SpacecraftTrip = typeof spacecraftTrips.$inferSelect;
export type NewSpacecraftTrip = typeof spacecraftTrips.$inferInsert;
