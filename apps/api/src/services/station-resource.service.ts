import { eq, inArray, and, gte } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';
import { asteroidAssignments, asteroidVeins } from '../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import type { ResourceKey, ResourceMap } from '@orions-frontier/shared';
import { calcMiningRatesByResource } from '../lib/vein-rates.js';

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
    })
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

// ============================================================================
// Get theoretical mining rates (units/h) per resource across all stations
// of a user — single JOIN query, no N+1.
// ============================================================================

export const getUserMiningRates = async (userId: string): Promise<ResourceMap> => {
  const db = getDb();

  // One query: assignments → stations (filter userId) → spacecraft_definitions
  //            → asteroid_veins
  const rows = await db
    .select({
      asteroidId: asteroidAssignments.asteroidId,
      assignedAmount: asteroidAssignments.assignedAmount,
      miningRate: spacecraftDefinitions.miningRate,
      veinType: asteroidVeins.veinType,
      purity: asteroidVeins.purity,
      yieldPerHour: asteroidVeins.yieldPerHour,
      resourceKey: asteroidVeins.resourceKey,
    })
    .from(asteroidAssignments)
    .innerJoin(stations, eq(asteroidAssignments.stationId, stations.id))
    .innerJoin(
      spacecraftDefinitions,
      eq(asteroidAssignments.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .innerJoin(asteroidVeins, eq(asteroidAssignments.asteroidId, asteroidVeins.asteroidId))
    .where(eq(stations.userId, userId));

  // Group by asteroid so we can:
  //  a) sum combined mining rate across all assignment rows for the same asteroid
  //  b) normalize vein allocations across only the veins actually present
  // This mirrors calculateMiningTick / calcEffectiveRateByResource exactly.
  type VeinData = { veinType: string; purity: number; yieldPerHour: number; resourceKey: string };
  const byAsteroid = new Map<string, { combinedRate: number; veins: Map<string, VeinData> }>();

  for (const row of rows) {
    let entry = byAsteroid.get(row.asteroidId);
    if (!entry) {
      entry = { combinedRate: 0, veins: new Map() };
      byAsteroid.set(row.asteroidId, entry);
    }
    entry.combinedRate += row.miningRate * row.assignedAmount;
    // Veins are repeated for each assignment row — deduplicate by resourceKey+veinType
    if (!entry.veins.has(row.veinType + ':' + row.resourceKey)) {
      entry.veins.set(row.veinType + ':' + row.resourceKey, {
        veinType: row.veinType,
        purity: row.purity,
        yieldPerHour: row.yieldPerHour,
        resourceKey: row.resourceKey,
      });
    }
  }

  const rates: ResourceMap = {};
  for (const { combinedRate, veins } of byAsteroid.values()) {
    const ratesByResource = calcMiningRatesByResource(combinedRate, [...veins.values()]);
    for (const [key, rate] of Object.entries(ratesByResource)) {
      rates[key as ResourceKey] = (rates[key as ResourceKey] ?? 0) + rate;
    }
  }
  return rates;
};;

// ============================================================================
// Get effective transport delivery rate (units/h) per resource.
// Calculated from arrived trips (recall + transport returns) within the last hour.
// This reflects actual resources delivered to the station — not theoretical mining.
// ============================================================================

export const getTransportEffectiveRates = async (userId: string): Promise<ResourceMap> => {
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
