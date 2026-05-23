import {
  pgTable,
  uuid,
  doublePrecision,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { stations } from './stations.js';
import { spacecraftDefinitions } from './spacecraft-definitions.js';
import { sectors } from './sectors.js';

export const assignmentStatusEnum = pgEnum('assignment_status', [
  'traveling_to_asteroid', // Miner flying to asteroid for the first time or returning after recall
  'at_asteroid', // Miner present and mining (default)
  'traveling_to_station', // Miner self-recall: carrying full buffer back to station
]);

// ============================================================================
// asteroid_clusters — World generation influence zones (optional overlay)
// NOT actively used in generation — zones handle biasing.
// Kept for future named-region features.
// ============================================================================

export const asteroidClusters = pgTable('asteroid_clusters', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  centerX: doublePrecision('center_x').notNull(),
  centerY: doublePrecision('center_y').notNull(),
  radius: doublePrecision('radius').notNull(),
  resourceBias: varchar('resource_bias', { length: 64 }).notNull(),
  seed: varchar('seed', { length: 128 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================================================
// asteroids — Persistent runtime asteroid instances
// ============================================================================

export const asteroids = pgTable(
  'asteroids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    chunkX: integer('chunk_x').notNull(),
    chunkY: integer('chunk_y').notNull(),
    /** Size category: determines yield budget and mining slot count */
    size: varchar('size', { length: 16 }).notNull(),
    /** Stability 0.0–1.0. Degrades on overmining, regens when load < yield */
    stability: doublePrecision('stability').notNull().default(1.0),
    /** Minimum scanner strength required to detect; 0 = always visible */
    hiddenLevel: integer('hidden_level').notNull().default(0),
    clusterId: uuid('cluster_id'),
    /** Sector this asteroid belongs to; null for asteroids generated before sector system */
    sectorId: uuid('sector_id').references(() => sectors.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    chunkIdx: index('asteroids_chunk_idx').on(table.chunkX, table.chunkY),
    chunkXIdx: index('asteroids_chunk_x_idx').on(table.chunkX),
    chunkYIdx: index('asteroids_chunk_y_idx').on(table.chunkY),
    clusterIdIdx: index('asteroids_cluster_id_idx').on(table.clusterId),
    sectorIdIdx: index('asteroids_sector_id_idx').on(table.sectorId),
  })
);

// ============================================================================
// asteroid_veins — Resource veins within an asteroid
// Each asteroid has 1–3 veins (primary, optional secondary, optional trace).
// ============================================================================

export const asteroidVeins = pgTable(
  'asteroid_veins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asteroidId: uuid('asteroid_id')
      .notNull()
      .references(() => asteroids.id, { onDelete: 'cascade' }),
    /** primary | secondary | trace */
    veinType: varchar('vein_type', { length: 16 }).notNull(),
    resourceKey: varchar('resource_key', { length: 64 }).notNull(),
    /** Max yield per hour (baseBudget × tierModifier × veinModifier) */
    yieldPerHour: doublePrecision('yield_per_hour').notNull(),
    /** Purity multiplier 0.4–3.0, applied to miner output */
    purity: doublePrecision('purity').notNull(),
    /** impure | normal | rich | pure | pristine */
    purityTier: varchar('purity_tier', { length: 16 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    asteroidIdIdx: index('asteroid_veins_asteroid_id_idx').on(table.asteroidId),
  }),
);

// ============================================================================
// asteroid_resource_storage — Local resource buffer on each asteroid
// Filled by miner assignments via lazy tick, emptied by transporter runs.
// ============================================================================

export const asteroidResourceStorage = pgTable(
  'asteroid_resource_storage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asteroidId: uuid('asteroid_id')
      .notNull()
      .references(() => asteroids.id, { onDelete: 'cascade' }),
    resourceKey: varchar('resource_key', { length: 64 }).notNull(),
    /** Currently buffered amount (real for fractional accumulation) */
    amount: doublePrecision('amount').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    asteroidIdIdx: index('asteroid_resource_storage_asteroid_id_idx').on(table.asteroidId),
    uniqueAsteroidResource: uniqueIndex('asteroid_resource_storage_unique').on(
      table.asteroidId,
      table.resourceKey,
    ),
  }),
);

// ============================================================================
// asteroid_assignments — Persistent miner assignments
// Ships from a station permanently assigned to mine an asteroid.
// ============================================================================

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
    spacecraftDefinitionId: uuid('spacecraft_definition_id')
      .notNull()
      .references(() => spacecraftDefinitions.id),
    /** Number of ships assigned */
    assignedAmount: integer('assigned_amount').notNull().default(1),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
    /** Last production tick timestamp — used for lazy tick delta calculation */
    lastTick: timestamp('last_tick').notNull().defaultNow(),
    /** Current status of the miner group for this assignment */
    status: assignmentStatusEnum('status').notNull().default('at_asteroid'),
  },
  (table) => ({
    asteroidIdIdx: index('asteroid_assignments_asteroid_id_idx').on(table.asteroidId),
    stationIdIdx: index('asteroid_assignments_station_id_idx').on(table.stationId),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const asteroidsRelations = relations(asteroids, ({ one, many }) => ({
  cluster: one(asteroidClusters, {
    fields: [asteroids.clusterId],
    references: [asteroidClusters.id],
  }),
  veins: many(asteroidVeins),
  storage: many(asteroidResourceStorage),
  assignments: many(asteroidAssignments),
}));

export const asteroidClustersRelations = relations(asteroidClusters, ({ many }) => ({
  asteroids: many(asteroids),
}));

export const asteroidVeinsRelations = relations(asteroidVeins, ({ one }) => ({
  asteroid: one(asteroids, {
    fields: [asteroidVeins.asteroidId],
    references: [asteroids.id],
  }),
}));

export const asteroidResourceStorageRelations = relations(asteroidResourceStorage, ({ one }) => ({
  asteroid: one(asteroids, {
    fields: [asteroidResourceStorage.asteroidId],
    references: [asteroids.id],
  }),
}));

export const asteroidAssignmentsRelations = relations(asteroidAssignments, ({ one }) => ({
  asteroid: one(asteroids, {
    fields: [asteroidAssignments.asteroidId],
    references: [asteroids.id],
  }),
  station: one(stations, {
    fields: [asteroidAssignments.stationId],
    references: [stations.id],
  }),
  spacecraftDefinition: one(spacecraftDefinitions, {
    fields: [asteroidAssignments.spacecraftDefinitionId],
    references: [spacecraftDefinitions.id],
  }),
}));
