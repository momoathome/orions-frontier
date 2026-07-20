import { eq, inArray, and, gte } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
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

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;

// ============================================================================
// Seed resources for a newly created station
// ============================================================================

export const seedStationResources = async (
  stationId: string,
  db: SeedDb = getDb()
): Promise<void> => {
  const rows = (Object.entries(INITIAL_RESOURCES) as [ResourceKey, number][]).map(
    ([resourceKey, amount]) => ({
      stationId,
      resourceKey,
      amount,
    })
  );

  await db.insert(stationResources).values(rows);
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

// ============================================================================
// Get actual mining deliveries during the last hour.
// ============================================================================

export const getDeliveredResourceRates = async (userId: string): Promise<ResourceMap> => {
  const db = getDb();

  const userStations = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.userId, userId));

  if (userStations.length === 0) return {};

  const stationIds = userStations.map((s) => s.id);

  // Find all stationSpacecraft IDs for this user
  const ssRows = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(inArray(stationSpacecrafts.stationId, stationIds));

  if (ssRows.length === 0) return {};

  const ssIds = ssRows.map((s) => s.id);

  // Look at all arrived trips heading TO station in the last hour
  const oneHourAgo = new Date(Date.now() - 3_600_000);
  const arrivedTrips = await db
    .select({
      cargoManifest: spacecraftTrips.cargoManifest,
      arrivesAt: spacecraftTrips.arrivesAt,
    })
    .from(spacecraftTrips)
    .where(
      and(
        inArray(spacecraftTrips.stationSpacecraftId, ssIds),
        eq(spacecraftTrips.status, 'arrived'),
        eq(spacecraftTrips.toType, 'station'),
        gte(spacecraftTrips.arrivesAt, oneHourAgo)
      )
    );

  // Sum up all delivered resources and express as /h
  // (all trips are within the 1-hour window, so sum = effective rate)
  const delivered: ResourceMap = {};
  for (const trip of arrivedTrips) {
    if (!trip.cargoManifest) continue;
    for (const [key, amount] of Object.entries(trip.cargoManifest)) {
      delivered[key as ResourceKey] = (delivered[key as ResourceKey] ?? 0) + amount;
    }
  }

  return delivered;
};
