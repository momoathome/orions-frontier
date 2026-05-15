export * from './users.js';
export * from './stations.js';
export * from './station-spacecrafts.js';
export * from './station-resources.js';
export * from './spacecraft-definitions.js';

// ============================================================================
// Cross-table relations (defined here to avoid circular imports)
// ============================================================================

import { relations } from 'drizzle-orm';
import { stations } from './stations.js';
import { stationSpacecrafts } from './station-spacecrafts.js';
import { stationResources } from './station-resources.js';
import { spacecraftDefinitions, spacecraftDefinitionCosts } from './spacecraft-definitions.js';

export const stationsManyRelations = relations(stations, ({ many }) => ({
  spacecrafts: many(stationSpacecrafts),
  resources: many(stationResources),
}));

export const stationSpacecraftsRelations = relations(stationSpacecrafts, ({ one }) => ({
  station: one(stations, {
    fields: [stationSpacecrafts.stationId],
    references: [stations.id],
  }),
  definition: one(spacecraftDefinitions, {
    fields: [stationSpacecrafts.spacecraftDefinitionId],
    references: [spacecraftDefinitions.id],
  }),
}));

export const spacecraftDefinitionsManyRelations = relations(spacecraftDefinitions, ({ many }) => ({
  costs: many(spacecraftDefinitionCosts),
  stationSpacecrafts: many(stationSpacecrafts),
}));

export const spacecraftDefinitionCostsRelations = relations(
  spacecraftDefinitionCosts,
  ({ one }) => ({
    definition: one(spacecraftDefinitions, {
      fields: [spacecraftDefinitionCosts.spacecraftDefinitionId],
      references: [spacecraftDefinitions.id],
    }),
  })
);
