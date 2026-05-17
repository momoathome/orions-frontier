import {
  pgTable,
  uuid,
  doublePrecision,
  integer,
  varchar,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// asteroid_clusters — World generation influence zones
// NOT gameplay sectors. Influence spawn density and resource bias.
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
    /** Global world coordinate (continuous space) */
    x: doublePrecision('x').notNull(),
    /** Global world coordinate (continuous space) */
    y: doublePrecision('y').notNull(),
    /** Derived chunk coordinate: floor(x / CHUNK_SIZE) */
    chunkX: integer('chunk_x').notNull(),
    /** Derived chunk coordinate: floor(y / CHUNK_SIZE) */
    chunkY: integer('chunk_y').notNull(),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    /** Mining richness 1–100 */
    richness: integer('richness').notNull(),
    /** Mining stability 1–100 — chance of depletion on each mine attempt */
    stability: integer('stability').notNull(),
    /** Minimum scanner strength required to detect; 0 = always visible */
    hiddenLevel: integer('hidden_level').notNull().default(0),
    clusterId: uuid('cluster_id'),
    isDepleted: boolean('is_depleted').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    /** Composite chunk index — primary query path for viewport loading */
    chunkIdx: index('asteroids_chunk_idx').on(table.chunkX, table.chunkY),
    chunkXIdx: index('asteroids_chunk_x_idx').on(table.chunkX),
    chunkYIdx: index('asteroids_chunk_y_idx').on(table.chunkY),
    clusterIdIdx: index('asteroids_cluster_id_idx').on(table.clusterId),
  }),
);

// ============================================================================
// Relations
// ============================================================================

export const asteroidsRelations = relations(asteroids, ({ one }) => ({
  cluster: one(asteroidClusters, {
    fields: [asteroids.clusterId],
    references: [asteroidClusters.id],
  }),
}));

export const asteroidClustersRelations = relations(asteroidClusters, ({ many }) => ({
  asteroids: many(asteroids),
}));

// ============================================================================
// DB-inferred types (used in service layer)
// ============================================================================

export type AsteroidRow = typeof asteroids.$inferSelect;
export type NewAsteroidRow = typeof asteroids.$inferInsert;
export type AsteroidClusterRow = typeof asteroidClusters.$inferSelect;
export type NewAsteroidClusterRow = typeof asteroidClusters.$inferInsert;
