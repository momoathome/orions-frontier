import {
  pgTable,
  uuid,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { stationSpacecrafts } from './station-spacecrafts.js';
import { asteroidAssignments } from './asteroids.js';
import { sql } from 'drizzle-orm';
import type { ResourceMap } from '@orions-frontier/shared';

export const tripPurposeEnum = pgEnum('trip_purpose', [
  'mine',
  'mining_return',
  'combat',
  'combat_return',
  'salvage',
  'salvage_return',
  'relocate',
]);

export const tripStatusEnum = pgEnum('trip_status', ['traveling', 'arrived', 'cancelled']);

export const tripEndpointTypeEnum = pgEnum('trip_endpoint_type', ['station', 'asteroid', 'debris']);

/** JSON shape stored in cargoManifest: { resourceKey: amount } */
export type CargoManifest = ResourceMap;

export const spacecraftTrips = pgTable(
  'spacecraft_trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationSpacecraftId: uuid('station_spacecraft_id')
      .notNull()
      .references(() => stationSpacecrafts.id, { onDelete: 'cascade' }),
    /** Exact mining group this trip belongs to; null for other missions. */
    assignmentId: uuid('assignment_id').references(() => asteroidAssignments.id, {
      onDelete: 'set null',
    }),
    groupSize: integer('group_size').notNull(),
    fromType: tripEndpointTypeEnum('from_type').notNull(),
    fromId: uuid('from_id').notNull(),
    fromX: doublePrecision('from_x').notNull().default(0),
    fromY: doublePrecision('from_y').notNull().default(0),
    toType: tripEndpointTypeEnum('to_type').notNull(),
    toId: uuid('to_id').notNull(),
    toX: doublePrecision('to_x').notNull().default(0),
    toY: doublePrecision('to_y').notNull().default(0),
    departedAt: timestamp('departed_at').notNull(),
    arrivesAt: timestamp('arrives_at').notNull(),
    purpose: tripPurposeEnum('purpose').notNull(),
    cargoManifest: jsonb('cargo_manifest').$type<CargoManifest>(),
    status: tripStatusEnum('status').notNull().default('traveling'),
    /** Failed settle attempts; each one pushes `retryAt` further out. */
    settleFailures: integer('settle_failures').notNull().default(0),
    retryAt: timestamp('retry_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('spacecraft_trips_station_spacecraft_id_idx').on(table.stationSpacecraftId),
    index('spacecraft_trips_assignment_id_idx').on(table.assignmentId),
    index('spacecraft_trips_status_idx').on(table.status),
    index('spacecraft_trips_active_arrives_at_idx')
      .on(table.arrivesAt)
      .where(sql`${table.status} = 'traveling'`),
    index('spacecraft_trips_arrives_at_idx').on(table.arrivesAt),
    index('spacecraft_trips_to_id_idx').on(table.toId),
  ]
);
