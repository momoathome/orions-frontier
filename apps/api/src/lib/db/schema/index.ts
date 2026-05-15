export * from './users.js';
export * from './stations.js';
export * from './station-spacecrafts.js';
export * from './station-resources.js';

// ============================================================================
// Cross-table relations (defined here to avoid circular imports)
// ============================================================================

import { relations } from 'drizzle-orm';
import { stations } from './stations.js';
import { stationSpacecrafts } from './station-spacecrafts.js';
import { stationResources } from './station-resources.js';

export const stationsManyRelations = relations(stations, ({ many }) => ({
  spacecrafts: many(stationSpacecrafts),
  resources: many(stationResources),
}));
