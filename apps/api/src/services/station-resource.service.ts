import { eq, inArray, and, gte } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import {
  AppError,
  ErrorCode,
  resourceKeys,
  type ResourceKey,
  type ResourceMap,
} from '@orions-frontier/shared';

// Initial resource amounts for new stations

const INITIAL_RESOURCES: Record<ResourceKey, number> = {
  carbon: 250,
  titanium: 300,
  hydrogenium: 275,
  kyber_crystal: 0,
  astatine: 0,
};

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;

// Seed resources for a newly created station

export const seedStationResources = async (
  stationId: string,
  db: SeedDb = getDb(),
  amounts: ResourceMap = INITIAL_RESOURCES
): Promise<void> => {
  const rows = resourceKeys.map((resourceKey) => ({
    stationId,
    resourceKey,
    amount: amounts[resourceKey] ?? 0,
  }));

  await db.insert(stationResources).values(rows);
};

export const getStationResources = async (
  userId: string,
  stationId: string
): Promise<ResourceMap> => {
  const db = getDb();
  const rows = await db
    .select({ resource: stationResources })
    .from(stationResources)
    .innerJoin(stations, eq(stationResources.stationId, stations.id))
    .where(and(eq(stations.id, stationId), eq(stations.userId, userId)));
  if (rows.length === 0) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  return rows.reduce<ResourceMap>((acc, row) => {
    const key = row.resource.resourceKey as ResourceKey;
    acc[key] = row.resource.amount;
    return acc;
  }, {});
};

// Get actual mining deliveries during the last hour.

export const getDeliveredResourceRates = async (
  userId: string,
  stationId: string
): Promise<ResourceMap> => {
  const db = getDb();
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(and(eq(stations.id, stationId), eq(stations.userId, userId)));
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  const ssRows = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));

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
        eq(spacecraftTrips.purpose, 'mining_return'),
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
