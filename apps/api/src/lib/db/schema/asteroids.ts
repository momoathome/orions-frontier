import type { AsteroidSize, ResourceKey, VeinType } from '@orions-frontier/shared';
import {
  pgTable,
  uuid,
  doublePrecision,
  integer,
  varchar,
  timestamp,
  index,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { stations } from './stations.js';
import { sectors } from './sectors.js';

export const assignmentStatusEnum = pgEnum('assignment_status', [
  'traveling_to_asteroid',
  'traveling_to_station',
]);

// asteroids — Persistent runtime asteroid instances

export const asteroids = pgTable(
  'asteroids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    chunkX: integer('chunk_x').notNull(),
    chunkY: integer('chunk_y').notNull(),
    /** Size category: determines its finite reserve range. */
    size: varchar('size', { length: 16 }).$type<AsteroidSize>().notNull(),
    sectorId: uuid('sector_id')
      .notNull()
      .references(() => sectors.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('asteroids_chunk_idx').on(table.chunkX, table.chunkY),
    index('asteroids_chunk_x_idx').on(table.chunkX),
    index('asteroids_chunk_y_idx').on(table.chunkY),
    index('asteroids_sector_id_idx').on(table.sectorId),
  ]
);

// asteroid_veins — Resource veins within an asteroid
// Each asteroid has 1–3 veins (primary, optional secondary, optional trace).

export const asteroidVeins = pgTable(
  'asteroid_veins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asteroidId: uuid('asteroid_id')
      .notNull()
      .references(() => asteroids.id, { onDelete: 'cascade' }),
    /** primary | secondary | trace */
    veinType: varchar('vein_type', { length: 16 }).$type<VeinType>().notNull(),
    resourceKey: varchar('resource_key', { length: 64 }).$type<ResourceKey>().notNull(),
    /** Unclaimed resource units still available for new mining cycles. */
    remainingAmount: integer('remaining_amount').notNull().default(10_000),
    /** Generated reserve; with remainingAmount it shows how far the vein is mined out. */
    initialAmount: integer('initial_amount').notNull().default(10_000),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('asteroid_veins_asteroid_id_idx').on(table.asteroidId),
    check('asteroid_veins_remaining_amount_non_negative', sql`${table.remainingAmount} >= 0`),
  ]
);

// asteroid_assignments — Persistent miner assignments
// Ships from a station permanently assigned to mine an asteroid.

export const asteroidAssignments = pgTable(
  'asteroid_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asteroidId: uuid('asteroid_id')
      .notNull()
      .references(() => asteroids.id, { onDelete: 'cascade' }),
    /** Home station of the assigned miners */
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    /** Which ship type is assigned */
    spacecraftKey: varchar('spacecraft_key', { length: 64 }).notNull(),
    /** Number of ships assigned */
    assignedAmount: integer('assigned_amount').notNull().default(1),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
    /** Current status of the miner group for this assignment */
    status: assignmentStatusEnum('status').notNull().default('traveling_to_asteroid'),
    /** When set, the group stops after reaching its station again. */
    recallRequestedAt: timestamp('recall_requested_at'),
    /** Number of ships that stop at the station after the current round trip. */
    recallRequestedAmount: integer('recall_requested_amount').notNull().default(0),
  },
  (table) => [
    index('asteroid_assignments_asteroid_id_idx').on(table.asteroidId),
    index('asteroid_assignments_station_id_idx').on(table.stationId),
    check(
      'asteroid_assignments_recall_requested_amount_valid',
      sql`${table.recallRequestedAmount} >= 0 AND ${table.recallRequestedAmount} <= ${table.assignedAmount}`
    ),
  ]
);
