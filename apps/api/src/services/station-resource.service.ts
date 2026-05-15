import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';
import type { ResourceKey, ResourceMap } from '@orions-frontier/shared';

// ============================================================================
// Initial resource amounts for new stations
// ============================================================================

const INITIAL_RESOURCES: Record<ResourceKey, number> = {
  carbon: 250,
  titanium: 300,
  hydrogenium: 275,
  kyber_crystal: 0,
  astatine: 0,
};

// ============================================================================
// Seed resources for a newly created station
// ============================================================================

export const seedStationResources = async (stationId: string): Promise<void> => {
  const db = getDb();

  const rows = (Object.entries(INITIAL_RESOURCES) as [ResourceKey, number][]).map(
    ([resourceKey, amount]) => ({
      stationId,
      resourceKey,
      amount,
    }),
  );

  await db.insert(stationResources).values(rows);
};

// ============================================================================
// Get resources for a single station as ResourceMap
// ============================================================================

export const getStationResources = async (stationId: string): Promise<ResourceMap> => {
  const db = getDb();

  const rows = await db
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));

  return rows.reduce<ResourceMap>((acc, row) => {
    acc[row.resourceKey as ResourceKey] = row.amount;
    return acc;
  }, {});
};

// ============================================================================
// Aggregate resources across all stations of a user
// ============================================================================

export const getUserAggregatedResources = async (userId: string): Promise<ResourceMap> => {
  const db = getDb();

  const userStations = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.userId, userId));

  if (userStations.length === 0) {
    return {};
  }

  const stationIds = userStations.map((s) => s.id);

  const rows = await db
    .select()
    .from(stationResources)
    .where(inArray(stationResources.stationId, stationIds));

  return rows.reduce<ResourceMap>((acc, row) => {
    const key = row.resourceKey as ResourceKey;
    acc[key] = (acc[key] ?? 0) + row.amount;
    return acc;
  }, {});
};
